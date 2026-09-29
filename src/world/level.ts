// The real level (docs/PLAN.md §2.5/§2.7, docs/HOUSE.md, docs/PROPS.md): loaded after the preset choice.
//
//  1. tier manifest → download house_<atlas>/details_<atlas>/doors/props_m1/m2/collision GLBs + lm_<atlas>.klm
//     (byte progress from the manifest sizes);
//  2. parse (GLTFLoader + MeshoptDecoder), decode KLM → HalfFloat lightmaps (flash maps on Max);
//  3. place layout props (GLB roots named by layout id, built at the origin: position planToWorld(pos), yaw about
//     +Y), hide collider proxies, build the exterior ground from the layout surface zones;
//  4. bind materials by extras.material_id (src/materials/bind.ts; flat fallback on failure) — house meshes get
//     LightmapMaterial with their atlas's lightmap, everything else is probe-lit;
//  5. per-room groups + visibility sets (culling from the camera's room), doors, collision, runtime lights;
//  6. LightProbeGrids (ground floor, upper floor, exterior; falloff-blended) baked from the lightmapped scene;
//  7. per-atlas LightsNodes: lightmapped surfaces see only the flashlight + their rooms' flicker/lightning lights,
//     probe-lit materials see the flashlight, the grids and the lightning lights.

import * as THREE from 'three/webgpu';
import { lights } from 'three/tsl';
import type { GameContext } from '../game/context.ts';
import type { LevelLayout, PropPlacement } from '../shared/layout-types.ts';
import type { AssetEntry, PresetId } from '../shared/types.ts';
import type { PresetConfig } from '../render/presets.ts';
import { planToWorld } from '../shared/coords.ts';
import { decodeKlm } from '../render/klm.ts';
import { klmToTexture, type LightmapOptions } from '../render/lightmap-material.ts';
import { bakeProbeGrid } from '../render/probes.ts';
import { ByteProgress, assetUrl, fetchBytes, fetchManifest, parseGlb } from './assets.ts';
import { EYE_HEIGHT, RoomIndex, headingToCameraYaw, partitionGround } from './rooms.ts';
import { WorldCollision, groundColliderMesh, propColliderMeshes } from './collision.ts';
import { DoorSystem } from './doors.ts';
import { RuntimeLights } from './lights.ts';
import type { LoadingOverlay } from './loading-overlay.ts';
import { bindFallbackMaterials } from './fallback-materials.ts';

export interface LevelLoadOptions {
  ctx: GameContext;
  renderer: any;
  scene: any;
  preset: PresetConfig;
  presetId: PresetId;
  overlay: LoadingOverlay;
  /** Flashlight light (+ beam) — hidden during the probe bake, first in every LightsNode. */
  flashlight: { light: any; beam: any | null };
}

export interface SpawnPose {
  id: string;
  room: string;
  /** World eye position. */
  eye: [number, number, number];
  /** Camera yaw (rotation.y, YXZ) and pitch. */
  yaw: number;
  pitch: number;
}

export interface GridInfo {
  id: string;
  grid: any | null;
  probes: number;
  ms: number;
  error?: string;
}

/** Sky radiance behind everything (linear). The probe grids capture it as the storm sky. */
export const SKY_COLOR: [number, number, number] = [0.011, 0.013, 0.018];

export class Level {
  readonly layout: LevelLayout;
  readonly index: RoomIndex;
  readonly root: any;
  readonly roomGroups = new Map<string, any>();
  readonly alwaysGroup: any;
  readonly doors: DoorSystem;
  readonly collision: WorldCollision;
  readonly lights: RuntimeLights;
  readonly props = new Map<string, any>();
  readonly grids: GridInfo[] = [];
  readonly lightmapped: any[] = [];
  readonly probeLit: any[] = [];
  readonly missingMaterials: string[] = [];
  readonly stats: Record<string, number | string> = {};
  /** Current camera room (null until known) and the culling set. */
  room: string | null = null;
  visible: Set<string> = new Set();
  cullingEnabled = true;
  private lastKey = '';
  private readonly scene: any;

  constructor(o: {
    layout: LevelLayout;
    index: RoomIndex;
    root: any;
    roomGroups: Map<string, any>;
    alwaysGroup: any;
    doors: DoorSystem;
    collision: WorldCollision;
    lights: RuntimeLights;
    props: Map<string, any>;
    scene: any;
  }) {
    this.layout = o.layout;
    this.index = o.index;
    this.root = o.root;
    this.roomGroups = o.roomGroups;
    this.alwaysGroup = o.alwaysGroup;
    this.doors = o.doors;
    this.collision = o.collision;
    this.lights = o.lights;
    this.props = o.props;
    this.scene = o.scene;
  }

  spawn(id: string): SpawnPose | null {
    const s = this.layout.spawns.find((x) => x.id === id);
    if (!s) return null;
    return { id: s.id, room: s.room, eye: planToWorld(s.pos), yaw: headingToCameraYaw(s.yaw), pitch: s.pitch };
  }

  camera(id: string): { pos: [number, number, number]; target: [number, number, number]; fovDeg: number } | null {
    const c = this.layout.cameras.find((x) => x.id === id);
    return c ? { pos: planToWorld(c.pos), target: planToWorld(c.target), fovDeg: c.fovDeg } : null;
  }

  /** Updates the viewer's room + culling from a PLAN position (feet z). Returns true when the room changed. */
  setViewer(px: number, py: number, feetZ: number): boolean {
    const r = this.index.roomAt(px, py, feetZ);
    const changed = r !== null && r !== this.room;
    if (r !== null) this.room = r;
    const vis = this.index.visibleFrom(this.room, px, py, feetZ);
    const key = [...vis].sort().join(',');
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.visible = vis;
      this.applyVisibility();
    }
    return changed;
  }

  setCulling(on: boolean): void {
    this.cullingEnabled = on;
    this.lastKey = '';
    this.applyVisibility();
  }

  isOutside(): boolean {
    const r = this.room ? this.index.rooms.get(this.room) : null;
    return !r || r.kind !== 'interior';
  }

  private applyVisibility(): void {
    const all = !this.cullingEnabled;
    for (const [id, g] of this.roomGroups) g.visible = all || this.visible.has(id);
    for (const d of this.doors.doors.values()) d.group.visible = all || d.rooms.some((r) => this.visible.has(r));
  }

  update(dt: number, t: number, lightning: number): void {
    this.doors.update(dt);
    this.lights.update(dt, t, this.cullingEnabled ? this.visible : null, lightning, this.isOutside());
  }

  /** Props by layout id (world-placed roots). */
  prop(id: string): any | null {
    return this.props.get(id) ?? null;
  }

  dispose(): void {
    this.doors.dispose();
    this.scene.remove(this.root);
  }
}

// ------------------------------------------------------------------------------------------------ loading

const STEM_RE = /^(house|details)_(.+)$/;

export async function loadLevel(o: LevelLoadOptions): Promise<Level> {
  const { ctx, renderer, scene, preset, overlay } = o;
  const layout = ctx.layout;
  const index = new RoomIndex(layout);
  const tStart = performance.now();

  // ---- 1. manifest + downloads
  overlay.set('download', 0, 'manifest');
  const manifest = await fetchManifest(o.presetId);
  const want = manifest.files.filter(
    (f) =>
      (f.kind === 'level' && f.id.startsWith('house_')) ||
      (f.kind === 'prop' && (f.id.startsWith('details_') || f.id === 'doors' || f.id.startsWith('props_'))) ||
      f.kind === 'collision' ||
      (f.kind === 'lightmap' && f.path.endsWith('.klm') && (preset.lightmaps.lightningFlashMaps || !f.id.endsWith('_flash'))),
  );
  const prog = new ByteProgress();
  for (const f of want) prog.expect(f.bytes);
  prog.onChange = (l, t) => overlay.set('download', l / Math.max(1, t), `${(l / 1048576).toFixed(1)} / ${(t / 1048576).toFixed(1)} MB`);
  const bytes = new Map<string, ArrayBuffer>();
  await Promise.all(
    want.map(async (f: AssetEntry) => {
      bytes.set(f.id, await fetchBytes(assetUrl(f.path), prog, f.id));
    }),
  );
  const tDownloaded = performance.now();
  overlay.set('download', 1);

  // ---- 2. parse + lightmaps
  const glbIds = want.filter((f) => f.path.endsWith('.glb')).map((f) => f.id);
  const gltfs = new Map<string, any>();
  let k = 0;
  for (const id of glbIds) {
    overlay.set('parse', k++ / (glbIds.length + 1), id);
    gltfs.set(id, await parseGlb(bytes.get(id)!, id));
    bytes.delete(id);
  }
  const lmTex = new Map<string, any>();
  for (const f of want.filter((x) => x.kind === 'lightmap')) {
    overlay.set('parse', (k + 0.5) / (glbIds.length + 1), f.id);
    const tex = klmToTexture(await decodeKlm(bytes.get(f.id)!));
    tex.name = f.id;
    lmTex.set(f.id, tex);
    bytes.delete(f.id);
  }
  overlay.set('parse', 1);
  const tParsed = performance.now();

  // ---- 3. assemble
  const root = new THREE.Group();
  root.name = 'level';
  const bindRoot = new THREE.Group(); // everything that needs materials, bound in ONE pass (shared bakes)
  const roomGroups = new Map<string, any>();
  for (const r of layout.rooms) {
    const g = new THREE.Group();
    g.name = `room_${r.id}`;
    roomGroups.set(r.id, g);
    root.add(g);
  }
  const alwaysGroup = new THREE.Group();
  alwaysGroup.name = 'always';
  root.add(alwaysGroup);
  const groupFor = (room: unknown) => roomGroups.get(String(room)) ?? alwaysGroup;
  const placed: Array<{ obj: any; group: any }> = [];

  // house + details: nodes are in world space already
  for (const [id, g] of gltfs) {
    if (!STEM_RE.test(id)) continue;
    for (const n of [...g.scene.children]) {
      const ud = n.userData ?? {};
      n.userData.static = true;
      placed.push({ obj: n, group: groupFor(ud.room) });
      bindRoot.add(n);
    }
  }

  // props (layout placements)
  const placements = new Map<string, PropPlacement>(layout.props.map((p) => [p.id, p]));
  const props = new Map<string, any>();
  const flameAnchors = new Map<string, any>();
  const colliderSources: any[] = [];
  const unplaced: string[] = [];
  for (const [id, g] of gltfs) {
    if (!id.startsWith('props_')) continue;
    for (const n of [...g.scene.children]) {
      const p = placements.get(n.name);
      if (!p) {
        unplaced.push(n.name);
        continue;
      }
      const w = planToWorld(p.pos);
      n.position.set(w[0], w[1], w[2]);
      n.rotation.set(0, p.yaw, 0);
      n.userData.static = p.lighting === 'static';
      n.userData.dynamic = p.lighting === 'dynamic';
      n.traverse((c: any) => {
        if (c.userData?.collider === true || c.userData?.hide_proxy || /-collider$/.test(c.name)) c.visible = false;
        if (c.userData?.flame) flameAnchors.set(c.name, c);
        if (c.isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
        }
      });
      props.set(p.id, n);
      placed.push({ obj: n, group: groupFor(p.room) });
      bindRoot.add(n);
    }
  }
  for (const p of placements.values())
    if (!props.has(p.id) && p.type !== 'porch' && p.type !== 'foundation_skirt' && p.type !== 'fx_drip_emitter' && p.type !== 'harlan_pose_marker')
      unplaced.push(`${p.id}(missing)`);

  // exterior ground from the surface zones (probe-lit; UV0 in metres like every other surface)
  const cells = partitionGround(layout, index.footprint, [-160, -160, 160, 160]);
  const byMat = new Map<string, number[]>();
  for (const c of cells) {
    const list = byMat.get(c.mat) ?? [];
    list.push(...c.rect);
    byMat.set(c.mat, list);
  }
  for (const [mat, rects] of byMat) {
    const mesh = groundMesh(rects, mat);
    placed.push({ obj: mesh, group: groupFor('EXT2') });
    bindRoot.add(mesh);
  }

  // ---- 4. materials
  const lmFor = (mesh: any): LightmapOptions | null => {
    const ud = { ...(mesh.parent?.userData ?? {}), ...mesh.userData };
    if (ud.kind !== 'level' || !ud.lightmap || !mesh.geometry?.attributes?.uv1) return null;
    const base = lmTex.get(String(ud.lightmap));
    if (!base) return null;
    const flash = preset.lightmaps.lightningFlashMaps ? (lmTex.get(`${ud.lightmap}_flash`) ?? null) : null;
    return { base, flash };
  };
  overlay.set('materials', 0, 'textures');
  let bound: { materials: any[]; lightmapped: any[]; missing: string[] };
  let baker: any = undefined;
  const tMat = performance.now();
  try {
    const { bindMaterials } = await import('../materials/bind.ts');
    const r = await bindMaterials(bindRoot, {
      renderer,
      preset,
      lightmapFor: lmFor,
      onProgress: (p: { done: number; total: number; id: string }) => overlay.set('materials', p.done / Math.max(1, p.total), p.id),
    });
    bound = { materials: r.materials, lightmapped: r.lightmapped, missing: r.missing };
    baker = r.baker;
  } catch (e) {
    console.warn('[level] bind.ts failed — flat fallback materials:', e);
    bound = bindFallbackMaterials(bindRoot, lmFor);
  }
  overlay.set('materials', 1);
  const tBound = performance.now();
  if (bound.missing.length) console.warn(`[level] material ids missing from material-spec.json: ${bound.missing.join(', ')}`);

  // reparent into room groups (world transforms are identity/placement already)
  for (const { obj, group } of placed) group.add(obj);
  root.traverse((n: any) => {
    if (n.userData?.static || n.parent?.userData?.static) {
      n.updateMatrix();
      n.updateMatrixWorld(true);
      n.matrixAutoUpdate = false;
    }
    if (n.isMesh && (n.userData?.kind === 'level' || n.parent?.userData?.kind === 'level')) {
      n.castShadow = true;
      n.receiveShadow = true;
    }
  });

  // ---- 5. doors, collision, lights
  const doorsGltf = gltfs.get('doors');
  const doors = new DoorSystem(ctx, doorsGltf ? doorsGltf.scene : new THREE.Group(), layout);
  // door leaves are probe-lit and need materials too
  let doorBound: { materials: any[]; lightmapped: any[]; missing: string[] };
  try {
    const { bindMaterials } = await import('../materials/bind.ts');
    const r = await bindMaterials(doors.group, { renderer, preset, baker, lightmapFor: () => null });
    doorBound = { materials: r.materials, lightmapped: [], missing: r.missing };
  } catch {
    doorBound = bindFallbackMaterials(doors.group, () => null);
  }
  doors.group.traverse((n: any) => {
    if (n.isMesh) {
      n.castShadow = true;
      n.receiveShadow = true;
    }
  });
  root.add(doors.group);

  overlay.set('collision', 0.2);
  const colGltf = gltfs.get('collision');
  if (colGltf) colliderSources.push(colGltf.scene);
  colliderSources.push(groundColliderMesh([-160, -160, 160, 160], 0)); // the player is kept inside the rooms by bounds
  for (const [id, root2] of props) {
    const p = placements.get(id)!;
    if (p.collider === 'none') continue;
    colliderSources.push(...propColliderMeshes(root2));
  }
  const collision = new WorldCollision(colliderSources);
  doors.attachCollision(collision);
  overlay.set('collision', 1);

  const runtimeLights = new RuntimeLights(layout, flameAnchors, { lightningSpots: !preset.lightmaps.lightningFlashMaps });
  root.add(runtimeLights.group);

  scene.add(root);
  scene.background = new THREE.Color(...SKY_COLOR);

  const level = new Level({ layout, index, root, roomGroups, alwaysGroup, doors, collision, lights: runtimeLights, props, scene });
  level.lightmapped.push(...bound.lightmapped);
  const lmSet = new Set(bound.lightmapped);
  level.probeLit.push(...bound.materials.filter((m) => !lmSet.has(m)), ...doorBound.materials);
  level.missingMaterials.push(...new Set([...bound.missing, ...doorBound.missing]));

  // Lightmapped LightsNodes per atlas: flashlight + that atlas's rooms' runtime lights.
  const atlasRooms = new Map<string, Set<string>>();
  for (const a of layout.atlases) atlasRooms.set(a.id.toLowerCase().replace(/^lm_/, 'lm_'), new Set(a.rooms));
  const nodeByAtlas = new Map<string, any>();
  for (const m of bound.lightmapped) {
    const stem = String(m.lmBase?.name ?? '');
    const atlasId = stem.replace(/_flash$/, '');
    let node = nodeByAtlas.get(atlasId);
    if (!node) {
      const rooms = atlasRooms.get(atlasId) ?? new Set<string>();
      node = lights([o.flashlight.light, ...runtimeLights.forRooms(rooms, atlasId === 'lm_exterior')]);
      nodeByAtlas.set(atlasId, node);
    }
    m.lightsNode = node;
    m.needsUpdate = true;
  }

  // ---- 6. probe grids (all rooms visible, runtime lights dark, flashlight hidden)
  level.setCulling(false);
  const flames = runtimeLights.flickers.map((f) => f.flame).filter(Boolean);
  const hide = [o.flashlight.light, o.flashlight.beam, ...flames].filter(Boolean);
  const specs = gridSpecs(layout, preset);
  const tProbe = performance.now();
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    overlay.set('probes', i / specs.length, s.id);
    await nextFrame();
    const r = await bakeProbeGrid(renderer, scene, { size: s.size, center: s.center, counts: s.counts, cubemapSize: preset.probes.cubemapSize, near: 0.05, far: s.far, hide });
    if (r.grid) r.grid.falloff = 0.35;
    level.grids.push({ id: s.id, grid: r.grid, probes: r.probes, ms: r.totalMs, error: r.error });
    if (r.error) console.warn(`[level] probe grid ${s.id} failed: ${r.error}`);
  }
  overlay.set('probes', 1);
  overlay.set('compile', 0, 'first frames');
  const tProbed = performance.now();
  const grids = level.grids.map((g) => g.grid).filter(Boolean);
  for (const g of grids) root.add(g);
  const fill = grids.length ? null : new THREE.HemisphereLight(0x2a3040, 0x0c0906, 0.6);
  if (fill) root.add(fill);
  const probeLights = [o.flashlight.light, runtimeLights.lightningDir, ...runtimeLights.lightningSpots.map((s) => s.light), ...grids, ...(fill ? [fill] : [])];
  const probeNode = lights(probeLights);
  for (const m of level.probeLit) {
    m.lightsNode = probeNode;
    m.needsUpdate = true;
  }

  Object.assign(level.stats, {
    downloadMs: Math.round(tDownloaded - tStart),
    parseMs: Math.round(tParsed - tDownloaded),
    materialsMs: Math.round(tBound - tMat),
    probesMs: Math.round(tProbed - tProbe),
    probes: level.grids.reduce((a, g) => a + (g.grid ? g.probes : 0), 0),
    collisionTris: collision.triangles,
    lightmapped: bound.lightmapped.length,
    probeLitMaterials: level.probeLit.length,
    props: props.size,
    unplaced: unplaced.join(' ') || '-',
    bytes: prog.total,
  });
  console.info(`[level] loaded ${JSON.stringify(level.stats)}`);
  if (unplaced.length) console.warn(`[level] props without a layout placement / missing from the GLBs: ${unplaced.join(', ')}`);
  return level;
}

/** Ground quads (plan rects, flattened) at grade with UV0 in metres (u = x, v = plan y) and an up normal. */
function groundMesh(rects: number[], matId: string): any {
  const n = rects.length / 4;
  const pos = new Float32Array(n * 12);
  const nor = new Float32Array(n * 12);
  const uv = new Float32Array(n * 8);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const [x0, y0, x1, y1] = rects.slice(i * 4, i * 4 + 4);
    const P = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    for (let j = 0; j < 4; j++) {
      pos.set([P[j][0], 0, -P[j][1]], (i * 4 + j) * 3);
      nor.set([0, 1, 0], (i * 4 + j) * 3);
      uv.set([P[j][0], P[j][1]], (i * 4 + j) * 2);
    }
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial();
  mat.userData.material_id = matId;
  const m = new THREE.Mesh(g, mat);
  m.name = `ground_${matId}`;
  m.receiveShadow = true;
  m.userData.static = true;
  return m;
}

interface GridSpec {
  id: string;
  size: [number, number, number];
  center: [number, number, number];
  counts: [number, number, number];
  far: number;
}

/** Probe volumes (world space). Plan boxes: ground floor, upper floor, and the exterior around the drive/porch. */
function gridSpecs(layout: LevelLayout, preset: PresetConfig): GridSpec[] {
  const q = preset.id === 'low' ? 0.7 : 1;
  const box = (id: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, spacing: number, far: number): GridSpec => {
    const c = planToWorld([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
    const cnt = (len: number) => Math.max(2, Math.round((len / spacing) * q) + 1);
    return { id, size: [x1 - x0, z1 - z0, y1 - y0], center: c, counts: [cnt(x1 - x0), 2, cnt(y1 - y0)], far };
  };
  const g = layout.floors.find((f) => f.id === 'ground')?.elevation ?? 0.6;
  const u = layout.floors.find((f) => f.id === 'upper')?.elevation ?? 4.1;
  return [
    box('ground', 0.2, 0.2, g + 0.35, 8.55, 11.45, g + 2.8, 1.45, 12),
    box('upper', 0.2, 0.2, u + 0.35, 8.55, 11.45, u + 2.5, 1.45, 12),
    box('exterior', -9, -32, 0.35, 15, 2.5, 3.6, 3.8, 30),
  ];
}

function nextFrame(): Promise<void> {
  // Visible: one animation frame (lets the loading bar paint). Hidden/occluded tabs never fire rAF and throttle
  // chained timers to once a minute, so yield through a MessageChannel instead (never throttled).
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return new Promise((r) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => r();
      ch.port2.postMessage(0);
    });
  }
  return new Promise((r) => {
    let done = false;
    const go = () => {
      if (!done) {
        done = true;
        r();
      }
    };
    requestAnimationFrame(go);
    setTimeout(go, 100);
  });
}
