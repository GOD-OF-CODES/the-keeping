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

import { installTreeLod } from './tree-lod.ts';
import { geometryInstancing, shareInstancePrograms } from './instance-buckets.ts';
import * as THREE from 'three/webgpu';
import { lights } from 'three/tsl';
import type { GameContext } from '../game/context.ts';
import type { LevelLayout, PropPlacement } from '../shared/layout-types.ts';
import type { AssetEntry, PresetId } from '../shared/types.ts';
import type { PresetConfig } from '../render/presets.ts';
import { planToWorld } from '../shared/coords.ts';
import { decodeKlm } from '../render/klm.ts';
import { klmToTexture, type LightmapOptions } from '../render/lightmap-material.ts';
import { PROBE_FILE, bakeProbeGrid, decodeProbeFile, gridFromData, probeKey, type ProbeFile } from '../render/probes.ts';
import materialSpecJson from '../shared/material-spec.json' with { type: 'json' };
import { perfMark } from '../render/perf.ts';
import { ByteProgress, assetUrl, fetchBytes, fetchManifest, parseGlb } from './assets.ts';
import { EYE_HEIGHT, RoomIndex, headingToCameraYaw, partitionGround } from './rooms.ts';
import { WorldCollision, groundColliderMesh, propColliderMeshes } from './collision.ts';
import { DoorSystem } from './doors.ts';
import { RuntimeLights } from './lights.ts';
import { createWindowCull } from './window-cull.ts';
import { SkySpecularNode, setExteriorGridBox } from './atmosphere.ts';
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
  flashlight: { light: any; beam: any | null; bounce?: any };
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
  /** Built from the shipped public/assets/<tier>/probes.bin (no runtime bake). */
  shipped?: boolean;
  spec?: GridSpec;
}

/** Sky radiance behind everything (linear). The probe grids capture it as the storm sky. */
/** RUNTIME F3: props smaller than this (bounding radius, m) cast no shadow. */
const MIN_CASTER_RADIUS_M = 0.03;

export const SKY_COLOR: [number, number, number] = [0.022, 0.026, 0.036];

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
  /** LightsNode of every probe-lit material (flashlight, lightning, probe grids): characters use it too. */
  probeLightsNode: any = null;
  /** Staleness key the shipped probe data must carry (levelProbeKey; the probe export writes it). */
  probeKey = '';
  /** The lights in probeLightsNode (flashlight first). */
  probeLights: any[] = [];
  /** probeLights without the opening's CAR / RC9 runtime lights (Ada, Harlan, the sack/cleaver props). */
  houseLights: any[] = [];
  /** R2-1: LightsNode of exterior probe-lit materials (exterior grid clamped, no interior grids) + its lights. */
  exteriorLightsNode: any = null;
  exteriorLights: any[] = [];
  /** RC9 road set: the exterior lights minus the clamped yard grid twin, plus the open-sky hemisphere fill. */
  roadLights: any[] = [];
  readonly exteriorMaterials: any[] = [];
  /** Current camera room (null until known) and the culling set. */
  room: string | null = null;
  visible: Set<string> = new Set();
  cullingEnabled = true;
  private dirtyVis = true;
  private visScratch: Set<string> = new Set();
  private readonly scene: any;
  /** RUNTIME F2: indoor window-portal culling of the exterior rooms (src/world/window-cull.ts). */
  private windowCull: ReturnType<typeof createWindowCull> | null = null;

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
    try {
      this.windowCull = createWindowCull(this.layout, this.roomGroups, this.scene);
    } catch (e) {
      console.warn('[level] window cull disabled:', e);
    }
  }

  /** RUNTIME F2: per frame after setViewer, with the render camera's world position (the frame's final eye). */
  updateWindowCull(eye: any, now: number): void {
    this.windowCull?.update(eye, this.cullingEnabled && this.room !== null && !this.isOutside(), this.visible, now);
  }

  setWindowCull(on: boolean): void {
    this.windowCull?.setEnabled(on);
  }

  windowCullStats() {
    return this.windowCull?.stats() ?? null;
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
    // double-buffered: the candidate set is filled in place and swapped in only when it differs (no per-frame Set)
    const vis = this.index.visibleFrom(this.room, px, py, feetZ, undefined, this.visScratch);
    let same = !this.dirtyVis && vis.size === this.visible.size;
    if (same) for (const r of vis) if (!this.visible.has(r)) same = false;
    if (!same) {
      this.dirtyVis = false;
      this.visScratch = this.visible;
      this.visible = vis;
      this.applyVisibility();
    }
    return changed;
  }

  setCulling(on: boolean): void {
    this.cullingEnabled = on;
    this.dirtyVis = true;
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
    this.lights.update(dt, t, this.cullingEnabled ? this.visible : null, lightning, this.isOutside(), this.room ? this.visible : null, this.room);
  }

  /** A layout `mode: runtime` light (L_HEADLIGHT_L/R, L_DASH), created dark at load; null if absent. */
  runtimeLight(id: string): any | null {
    return this.lights.runtime.get(id)?.light ?? null;
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
  perfMark('parse');

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
  perfMark('assemble');

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
      n.updateMatrixWorld(true);
      n.traverse((c: any) => {
        if (c.userData?.collider === true || c.userData?.hide_proxy || /-collider$/.test(c.name)) c.visible = false;
        if (c.userData?.flame) flameAnchors.set(c.name, c);
        if (c.isMesh) {
          // RUNTIME F3 (lead ruling): no shadow casters under 3 cm bounding radius (screws, coins, papers' curl) — their
          // shadow is < 1 texel of the torch's 2048² 90° map beyond 1 m (2·tan45°/2048 ≈ 1 mm/texel/m … 3 cm at 30 m of
          // the candle cube's 512² face: 0.4 cm/texel at 1 m) yet each costs a draw in every shadow pass.
          if (!c.geometry?.boundingSphere) c.geometry?.computeBoundingSphere?.();
          const r = (c.geometry?.boundingSphere?.radius ?? 1) * c.matrixWorld.getMaxScaleOnAxis();
          c.castShadow = !(r < MIN_CASTER_RADIUS_M);
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
  // The baked terrain (house_exterior `EXT2_terrain`, extras terrain/terrainRect) replaces the flat cells inside its
  // rect; outside it they stay as the far field at z = 0 (docs/HOUSE.md "Terrain").
  let terrainRect: [number, number, number, number] | null = null;
  for (const [id, g] of gltfs) {
    if (!STEM_RE.test(id)) continue;
    g.scene.traverse((n: any) => {
      const r = n.userData?.terrainRect;
      if (n.userData?.terrain && Array.isArray(r) && r.length === 4) terrainRect = r.map(Number) as [number, number, number, number];
    });
  }
  const byMat = new Map<string, number[]>();
  for (const c of cells) {
    const list = byMat.get(c.mat) ?? [];
    for (const piece of terrainRect ? subtractRect(c.rect as [number, number, number, number], terrainRect) : [c.rect]) list.push(...piece);
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
  perfMark('materials');
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
  perfMark('doors');
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
  // Door-mounted props ship inside doors.glb as children of their leaf (P_KNOCKER under door_D_FRONT): register them
  // as props so interactions / hints find them, and they swing with the door.
  doors.group.traverse((n: any) => {
    const p = placements.get(n.name);
    if (!p || props.has(p.id)) return;
    n.traverse((c: any) => {
      c.matrixAutoUpdate = true;
    });
    props.set(p.id, n);
    const i = unplaced.indexOf(`${p.id}(missing)`);
    if (i >= 0) unplaced.splice(i, 1);
  });

  const tDoors = performance.now();
  perfMark('collision');
  overlay.set('collision', 0.2);
  const colGltf = gltfs.get('collision');
  if (colGltf) colliderSources.push(colGltf.scene);
  colliderSources.push(groundColliderMesh([-160, -160, 160, 160], 0)); // the player is kept inside the rooms by bounds
  // P1-5: layout `box` props become oriented boxes — unless an interactable sits within their bounds (the can on the
  // shelf, the ledger on the nightstand, the locket at the dress form): interaction line of sight raycasts this
  // octree (interactables.ts), so those keep their exact triangles.
  const interactAt: any[] = [];
  for (const [id, root2] of props) {
    if (!placements.get(id)?.interaction) continue;
    root2.updateMatrixWorld(true);
    interactAt.push(new THREE.Vector3().setFromMatrixPosition(root2.matrixWorld));
  }
  const bb = new THREE.Box3();
  for (const [id, root2] of props) {
    const p = placements.get(id)!;
    const hole = p.type === 'floor_register' ? String((p.params as Record<string, unknown> | undefined)?.hole ?? '').split(',').map(Number) : [];
    if (hole.length === 4 && hole.every(Number.isFinite)) {
      // gameplay-d review: the U2 register's floor hole (0.6 m square) is cut from the collision floor and the grate
      // itself is collider 'none', so a 0.27 m capsule dropped through into the never-free-roamed parlor (G2). Walk on
      // the cast iron: a 4 cm slab flush with the floor top over the hole (LOS slack 0.12 m keeps the peek usable).
      const [x0, y0, x1, y1] = hole;
      const slab = new THREE.BoxGeometry(x1 - x0, 0.04, y1 - y0);
      slab.translate((x0 + x1) / 2, p.pos[2] - 0.02, -(y0 + y1) / 2);
      const m = new THREE.Mesh(slab);
      m.name = `col_${id}_cover`;
      colliderSources.push(m);
    }
    if (p.collider === 'none') continue;
    let kind = p.collider;
    if (kind === 'box') {
      bb.setFromObject(root2).expandByScalar(0.15);
      if (interactAt.some((v) => bb.containsPoint(v))) kind = 'mesh';
    }
    colliderSources.push(...propColliderMeshes(root2, kind, kind !== p.collider)); // gameplay-e: interactable-bearing props stay exact when heavy
  }
  const collision = new WorldCollision(colliderSources);
  doors.attachCollision(collision);
  overlay.set('collision', 1);
  const tCollision = performance.now();
  perfMark('lights');

  // the sedans move in cutscenes (vehicle track): keep their matrices live
  for (const id of ['P_CAR_GATE', 'P_CAR_ROW', 'P_CAR_INTERIOR']) {
    const car = props.get(id);
    car?.traverse((n: any) => {
      n.matrixAutoUpdate = true;
    });
  }
  const runtimeLights = new RuntimeLights(layout, flameAnchors, { lightningSpots: !preset.lightmaps.lightningFlashMaps, props, gateShadow: preset.id !== 'max' });
  root.add(runtimeLights.group);

  scene.add(root);
  scene.background = new THREE.Color(...SKY_COLOR);

  const level = new Level({ layout, index, root, roomGroups, alwaysGroup, doors, collision, lights: runtimeLights, props, scene });
  installTreeLod((id) => props.get(id) ?? null); // runtime lane D item 4: hero-tree far LOD (drawRange prefix)
  // runtime lane E (load time): instance matrices as geometry attributes → one node build per material, not per chunk
  // (?geoinst=0 = the round-D path for A/B)
  const geoInst = new URLSearchParams(globalThis.location?.search ?? '').get('geoinst') === '0' ? { meshes: 0, geometries: 0 } : geometryInstancing(root);
  const inst = shareInstancePrograms(root); // runtime lane D (fz3): one vertex program per material, not per instanced mesh
  console.info(`[level] geometry-instanced meshes: ${geoInst.meshes}; instanced meshes on the attribute path: ${inst.meshes} (${inst.counts} distinct counts)`);
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
      node = lights([o.flashlight.light, ...(o.flashlight.bounce ? [o.flashlight.bounce] : []), ...runtimeLights.forRooms(rooms, atlasId === 'lm_exterior')]); // LIGHTING lane: + torch bounce (item 11)
      nodeByAtlas.set(atlasId, node);
    }
    m.lightsNode = node;
    m.needsUpdate = true;
  }

  // ---- 6. probe grids: shipped data (PERF-PLAN P1-4), else the runtime bake (all rooms visible, runtime lights
  //         dark, flashlight hidden) in chunks so the page never blocks for the whole bake
  const tLights = performance.now();
  perfMark('probes');
  const specs = gridSpecs(layout, preset);
  const tProbe = performance.now();
  const key = levelProbeKey(manifest.files, layout, preset, specs);
  level.probeKey = key;
  const shipped = probeDataParam() === 'bake' ? null : await fetchProbeFile(o.presetId, key);
  const flames = runtimeLights.flickers.map((f) => f.flame).filter(Boolean);
  const hide = [o.flashlight.light, o.flashlight.beam, ...flames].filter(Boolean);
  let baking = false;
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const d = shipped?.grids.find((g) => g.id === s.id && g.counts.join() === s.counts.join());
    if (d) {
      try {
        level.grids.push({ id: s.id, grid: gridFromData(renderer, d), probes: s.counts[0] * s.counts[1] * s.counts[2], ms: 0, shipped: true, spec: s });
        continue;
      } catch (e) {
        console.warn(`[level] shipped probe grid ${s.id} unusable — baking:`, e);
      }
    }
    if (!baking) {
      baking = true;
      level.setCulling(false);
    }
    overlay.set('probes', i / specs.length, s.id);
    await nextFrame();
    const chunk = renderer.backend?.isWebGPUBackend === true ? 48 : 6;
    const r = await bakeProbeGrid(renderer, scene, { size: s.size, center: s.center, counts: s.counts, cubemapSize: preset.probes.cubemapSize, near: 0.05, far: s.far, hide, chunk, yieldFn: nextFrame });
    if (r.grid) r.grid.falloff = 0.35;
    level.grids.push({ id: s.id, grid: r.grid, probes: r.probes, ms: r.totalMs, error: r.error, spec: s });
    if (r.error) console.warn(`[level] probe grid ${s.id} failed: ${r.error}`);
  }
  if (baking) level.setCulling(true);
  overlay.set('probes', 1);
  overlay.set('compile', 0, 'first frames');
  const tProbed = performance.now();
  perfMark('swap');
  const grids = level.grids.map((g) => g.grid).filter(Boolean);
  for (const g of grids) root.add(g);
  const fill = grids.length ? null : new THREE.HemisphereLight(0x2a3040, 0x0c0906, 0.6);
  if (fill) root.add(fill);
  const probeLights = [o.flashlight.light, ...(o.flashlight.bounce ? [o.flashlight.bounce] : []), runtimeLights.lightningDir, ...runtimeLights.lightningSpots.map((s) => s.light), ...[...runtimeLights.runtime.values()].map((r) => r.light), ...grids, ...(fill ? [fill] : [])];
  // Round D perf (runtime lane, bisect bisB in STATUS-r3-review): per-space light sets. The opening's CAR / RC9
  // runtime spots (L_DOME, L_CAB_VEIL, L_DASH, L_TRUCK_HI_L/R) only ever light the car and the road; in the house
  // every probe-lit pixel still looped over them (intensity 0, but shadow/cookie fetches and the loop cost +6 ms in the
  // parlor on Medium). House materials and the characters get a list without them; the cabin (opening.ts) and the FP
  // arms (story-runtime) keep the full level.probeLights. Fixed for the session (CONTRACT-CHANGES #35 holds).
  const openingOnly = new Set([...runtimeLights.runtime.values()].filter((r) => r.room === 'CAR' || r.room === 'RC9').map((r) => r.light));
  level.houseLights = probeLights.filter((l) => !openingOnly.has(l));
  // r3 AD review (R3-1): interior probe-lit materials never see the EXTERIOR grid. Its box (world z −2.5…32) reaches
  // 2.5 m into the house and the node is additive, so the hall/parlor front strip got the ground grid's candle
  // irradiance PLUS the exterior grid's cold sky (b/r 1.47 vs 0.03) — the C2 door rope read lavender under the
  // 3300 K white balance. Exterior probe-lit materials get their own node below (extNode); characters keep all grids
  // (they walk outdoors) via level.probeLights.
  const extGridObj = level.grids.find((g) => g.id === 'exterior')?.grid ?? null;
  // Interior probe-lit materials also drop the yard's runtime spots (L_HEADLIGHT_L/R, EXT1: cookie + 1024² shadow);
  // the walls between keep them out of every interior pixel anyway. Characters keep the headlights (C6/C7 in the yard).
  const allSpots = new Set([...runtimeLights.runtime.values()].map((r) => r.light));
  // props AD review: house props are probe-lit; the grids hold only candle BOUNCE (captured from lightmapped
  // surfaces), so add the unshadowed candle/lamp flicker lights for their DIRECT term (else black beside a candle).
  const probeNode = lights([...probeLights.filter((l) => l !== extGridObj && !allSpots.has(l)), ...runtimeLights.flickers.map((f) => f.light)]);
  level.probeLightsNode = probeNode;
  level.probeLights = probeLights;
  for (const m of level.probeLit) {
    m.lightsNode = probeNode;
    m.needsUpdate = true;
  }
  // R2-1 (round 3): exterior probe-lit surfaces get their own LightsNode — the exterior grid CLAMPED (a twin sharing
  // its atlas with falloff 0, so terrain/trees beyond the grid keep the edge probes' sky irradiance instead of
  // fading to black 0.35 m past it), the lightning directional and the exterior rooms' runtime lights. Interiors
  // never see the twin (they keep probeNode); a material shared by both gets an exterior clone.
  const extGrid = level.grids.find((g) => g.id === 'exterior')?.grid;
  if (extGrid) {
    const twin = clampedGridTwin(extGrid); // not added to the scene: only extNode sees it (the node reads its box)
    setExteriorGridBox(extGrid.boundingBox);
    const extRooms = atlasRooms.get('lm_exterior') ?? new Set(['EXT1', 'EXT2']);
    const extAll = [o.flashlight.light, ...(o.flashlight.bounce ? [o.flashlight.bounce] : []), ...runtimeLights.forRooms(extRooms, true)];
    // runtime lane D (pb4, parlor-table: 270 yard meshes in view carry this list): the RC9-only runtime lights (the
    // logging truck's shadowed high beams) never reach the yard ≈ 500 m away — only the RC9 road node keeps them.
    const rc9Only = new Set([...runtimeLights.runtime.values()].filter((r) => r.room === 'RC9').map((r) => r.light));
    const extLights = [...extAll.filter((l) => !rc9Only.has(l)), twin];
    const extNode = lights(extLights);
    level.exteriorLightsNode = extNode;
    level.exteriorLights = extLights;
    const fp = index.footprint;
    const probeSet = new Set(level.probeLit);
    // runtime lane D (C0 26.5 "pale grey road", diag road3/road4): the RC9 road set sits ≈ 500 m from the yard, so the
    // clamped twin lit the whole road with the yard grid's EDGE probes (porch lantern + house bounce) — an even grey
    // from 5 m to 100 m with no fall-off. RC9 gets its own node: the exterior lights minus the twin, plus the open
    // overcast sky as a hemisphere (irradiance π·L_sky from SKY_COLOR; ground ≈ wet asphalt/grass albedo 0.06 × sky).
    // The corridor is a slot: clearing 2 × 14 m (road-rc9.json) between ≈ 22 m pine walls, H/W ≈ 0.79 → street-canyon
    // sky-view factor √(1 + (H/W)²) − H/W ≈ 0.48 at the centreline.
    const skyPi = SKY_COLOR.map((c) => c * Math.PI * 0.48);
    const roadFill = new THREE.HemisphereLight(new THREE.Color(skyPi[0], skyPi[1], skyPi[2]), new THREE.Color(skyPi[0] * 0.06, skyPi[1] * 0.06, skyPi[2] * 0.06), 1);
    roadFill.name = 'RC9_sky_fill';
    roadFill.updateMatrixWorld(true); // not in the scene: HemisphereLightNode reads the up axis from matrixWorld
    const roadLights = [...extAll, roadFill];
    const roadNode = lights(roadLights);
    level.roadLights = roadLights;
    const use = new Map<any, { ext: any[]; road: any[]; int: number }>();
    const box = new THREE.Box3();
    const c = new THREE.Vector3();
    root.updateMatrixWorld(true);
    root.traverse((n: any) => {
      if (!n.isMesh || n.isSkinnedMesh) return;
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      if (!mats.some((m: any) => probeSet.has(m))) return;
      // room group first (EXT*/CAR outdoors, any other room indoors); unroomed meshes by their bounds: centre
      // outside the house footprint, or bigger than it (the 320 m far-field ground is centred on the house)
      let room: string | null = null;
      for (let p = n.parent; p && room === null; p = p.parent) if (typeof p.name === 'string' && p.name.startsWith('room_')) room = p.name.slice(5);
      let outside: boolean;
      if (room !== null) outside = room.startsWith('EXT') || room === 'CAR' || room === 'RC9'; // round D: RC9 (road set) is outdoors — it needs the truck + our headlights, which probeNode no longer has
      else {
        box.setFromObject(n).getCenter(c);
        const px = c.x;
        const py = -c.z; // plan y = −world z
        outside = px < fp[0] || px > fp[2] || py < fp[1] || py > fp[3] || box.max.x - box.min.x > fp[2] - fp[0] + 2 || box.max.z - box.min.z > fp[3] - fp[1] + 2;
      }
      for (const m of mats) {
        if (!probeSet.has(m)) continue;
        const u = use.get(m) ?? { ext: [], road: [], int: 0 };
        if (room === 'RC9') u.road.push(n);
        else if (outside) u.ext.push(n);
        else u.int++;
        use.set(m, u);
      }
    });
    let own = 0;
    let cloned = 0;
    const skySpecular = () => new SkySpecularNode();
    let road = 0;
    const bind = (m: any, meshes: any[], shared: boolean, node: any): void => {
      let target = m;
      if (shared) {
        target = m.clone();
        target.userData = m.userData; // same identity as the original (like reflections.ts' variants)
        level.probeLit.push(target);
        cloned++;
        for (const n of meshes) {
          if (Array.isArray(n.material)) n.material = n.material.map((x: any) => (x === m ? target : x));
          else n.material = target;
        }
      } else own++;
      target.lightsNode = node;
      // + the overcast sky as specular light (glossy ones get the yard reflection cube from reflections.ts instead,
      // which replaces this override on attach)
      target.setupEnvironment = skySpecular;
      target.needsUpdate = true;
      level.exteriorMaterials.push(target);
    };
    for (const [m, u] of use) {
      if (u.ext.length) bind(m, u.ext, u.int > 0, extNode);
      if (u.road.length) {
        bind(m, u.road, u.int > 0 || u.ext.length > 0, roadNode);
        road++;
      }
    }
    level.stats.exteriorProbeMaterials = `${own}+${cloned} clones (${road} road)`;
  }

  Object.assign(level.stats, {
    downloadMs: Math.round(tDownloaded - tStart),
    parseMs: Math.round(tParsed - tDownloaded),
    materialsMs: Math.round(tBound - tMat),
    probesMs: Math.round(tProbed - tProbe),
    assembleMs: Math.round(tMat - tParsed),
    doorsMs: Math.round(tDoors - tBound),
    collisionMs: Math.round(tCollision - tDoors),
    lightsMs: Math.round(tLights - tCollision),
    swapMs: Math.round(performance.now() - tProbed),
    probes: level.grids.reduce((a, g) => a + (g.grid ? g.probes : 0), 0),
    probeSource: level.grids.map((g) => `${g.id}:${g.shipped ? 'shipped' : g.grid ? 'baked' : 'none'}`).join(' '),
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

/** a − b for axis-aligned plan rects [x0, y0, x1, y1] (0–4 pieces). */
export function subtractRect(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number][] {
  const [ax0, ay0, ax1, ay1] = a;
  const ix0 = Math.max(ax0, b[0]);
  const iy0 = Math.max(ay0, b[1]);
  const ix1 = Math.min(ax1, b[2]);
  const iy1 = Math.min(ay1, b[3]);
  if (ix0 >= ix1 || iy0 >= iy1) return [a];
  const out: [number, number, number, number][] = [];
  if (ay0 < iy0) out.push([ax0, ay0, ax1, iy0]);
  if (iy1 < ay1) out.push([ax0, iy1, ax1, ay1]);
  if (ax0 < ix0) out.push([ax0, iy0, ix0, iy1]);
  if (ix1 < ax1) out.push([ix1, iy0, ax1, iy1]);
  return out;
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

/** ?probes=bake forces the runtime bake (the probe export uses it); anything else uses the shipped data. */
function probeDataParam(): string | null {
  return typeof location !== 'undefined' ? new URLSearchParams(location.search).get('probes') : null;
}

/**
 * Staleness key of the shipped probe data: everything the bake sees — the level files (manifest hashes), the layout
 * (placements, doors, lights), the material spec, the grid specs and the cube size. Material *code* changes are not
 * covered: re-run `npm run probes` after changing materials/bind.ts, the baker or the lightmap material.
 */
export function levelProbeKey(files: AssetEntry[], layout: LevelLayout, preset: PresetConfig, specs: GridSpec[]): string {
  const level = files
    .filter((f) => f.kind === 'level' || f.kind === 'prop' || f.kind === 'lightmap' || f.kind === 'collision')
    .map((f) => `${f.path}:${f.hash}`)
    .sort();
  return probeKey([`v1`, preset.id, `cube${preset.probes.cubemapSize}`, JSON.stringify(specs), JSON.stringify(layout), JSON.stringify(materialSpecJson), ...level]);
}

/** The tier's shipped probe grids, or null (missing, not a probe file, or stale → the caller bakes). */
async function fetchProbeFile(tier: PresetId, key: string): Promise<ProbeFile | null> {
  try {
    const res = await fetch(assetUrl(`assets/${tier}/${PROBE_FILE}`));
    if (!res.ok) return null;
    const f = decodeProbeFile(await res.arrayBuffer());
    if (!f) return null;
    if (f.key !== key) {
      console.info(`[level] shipped probes are stale (key ${f.key}, want ${key}) — runtime bake; run \`npm run probes\``);
      return null;
    }
    return f;
  } catch {
    return null;
  }
}

export interface GridSpec {
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

/** A LightProbeGrid sharing `g`'s baked atlas with falloff 0: LightProbeGridNode clamps the lookup to the box, so
 *  the twin applies its edge probes everywhere outside it (LightProbeGridNode.js r186: the weight is only built
 *  when falloff > 0). Same light class → the renderer's node library already knows it. */
function clampedGridTwin(g: any): any {
  const t = new g.constructor(g.width, g.height, g.depth, g.resolution.x, g.resolution.y, g.resolution.z);
  t.name = `${g.name || 'grid'}_clamped`;
  t.position.copy(g.position);
  t.intensity = g.intensity;
  t.updateMatrixWorld(true);
  t.updateBoundingBox();
  t.texture = g.texture;
  t.falloff = 0;
  return t;
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
