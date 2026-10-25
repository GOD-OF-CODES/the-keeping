// LIGHTING lane (REALISM-BACKLOG item 6) — reflections: box-projected per-room cubemaps + an exterior env.
//
// Before: no scene.environment, no envNode, no probe anywhere — night windows were flat, wet porch / drive / car paint
// (roughness 0.25–0.35) and varnish read matte. Now (WebGPU Medium + Max; Low and the WebGL2 fallback have none):
//  - one 128² RGBA16F cube per interior room (+ the car set), captured ONCE at load from the room centre with the
//    lightmapped scene (flashlight off, everything but the level hidden, culling off). Prefilter = the hardware mip
//    chain (box-filtered, generated after each face render) sampled at lod = roughness × 7 (128 px → 1 px): PMREM's
//    textureCubeUV made every glossy shader ~10× slower to compile (warm-up 6 s → 63 s, measured), a single
//    textureLevel costs nothing to compile. 12 cubes × 128² × 6 × 8 B × 4/3 (mips) ≈ 12.6 MB.
//  - every glossy material (spec roughness < 0.5 — GLOSSY_MAX_ROUGHNESS: varnish, enamel, tile, brass, chrome, glass, wet porch/asphalt/mud,
//    car paint …) in that room's group gets a ReflectionNode: radiance = cube(boxProject(R)).level(roughness × 7), with the
//    room's box (getParallaxCorrectNormal, r186) so the reflection of a window, a door or a candle sits where it is.
//    The node adds to context.radiance ONLY (never iblIrradiance): the lightmap / probe grid already is the diffuse.
//    Lightmapped: LightmapMaterial.lmReflection; probe-lit: an instance setupEnvironment override (same node).
//    Materials are shared across rooms, so each (material, room) pair gets its own variant (a clone; the first pair
//    keeps the original) bound to that room's cube. Same WGSL for all → shared GPU programs; only bindings differ.
//    (A per-object texture swap via onObjectUpdate was tried first: every mesh kept sampling the first cube.)
//  - boundary meshes (centre outside the room box: facade-side trim, window glass, wall shells) get a variant that
//    samples the room cube while the camera is in that room and the yard cube otherwise (uInside, per frame).
//  - exterior: one cube from the front yard (1.7 m) with a 60 × 60 × 40 m box — the house, trees and the storm sky
//    (atmosphere.ts background) for the wet drive, porch and car paint; × (1 + 4·flash) during lightning (the
//    sky is × 5 at the flash peak — builder 1's cloud lighting).
//  - glass: physically the reflection is ADDED on top of what shows through (Fresnel ≈ 4 % head-on → 100 % grazing);
//    with ordinary alpha blending the reflection was scaled by the glass opacity 0.15. Glass that gets a probe uses
//    premultiplied-style blending (One, OneMinusSrcAlpha): out = lit glass + background × (1 − α).
// Uniform/binding-only differences between rooms → one shader program per structure (PERF-PLAN P1-6a).

import * as THREE from 'three/webgpu';
import { cameraWorldMatrix, clearcoatRoughness, cubeTexture, getParallaxCorrectNormal, normalView, positionViewDirection, pow4, renderGroup, roughness, uniform } from 'three/tsl';
import type { LevelLayout } from '../shared/layout-types.ts';
import { planToWorld } from '../shared/coords.ts';
import { specById } from '../materials/spec-index.ts';
import { uParlorBake } from './lightmap-material.ts';
import { deferCompileWaits } from './parallel-compile.ts';
import { disposeRenderObjectsFor, noRoGc } from './ro-gc.ts'; // PERF G (ruling f)
import { probeKey } from './probes.ts';
import { LOOK } from './look.ts';
import { REFLECTIONS_VERSION, readReflFile, rgbToRgba, rgbaToRgb, type ReflFile, type ReflState } from './refl-file.ts';

export { REFL_FILE, REFLECTIONS_VERSION } from './refl-file.ts';

/** Global reflection multiplier (look API `reflections`; 1 = physical). */
// FINAL #153b: shared render group (the per-object-group stale-uniform class, lightmap-material.ts); = LOOK.reflections
export const uReflection = uniform(1).setGroup(renderGroup);
/** lod = roughness × this (128² cube: mip 7 = 1 px). Look API `reflLod`. */
export const uReflLod = uniform(7).setGroup(renderGroup); // = LOOK.reflLod
/**
 * Spec roughness below which a material gets a reflection probe. Backlog: < 0.6; < 0.5 here — trim (0.55), doors,
 * furniture, stair treads, shingles (0.5–0.55) cover much of the screen and would only show a mip-3.5 blur, and the
 * parlor views ran ≈ +2 ms over base (Medium budget; deviation). Floors (0.35), glass, wet porch/asphalt/mud, brass,
 * chrome, tile, enamel and car paint keep their reflections.
 */
export const GLOSSY_MAX_ROUGHNESS = 0.5;
const CUBE_SIZE = 128;

export interface ReflectionProbe {
  id: string;
  /** World-space capture point = box centre (getParallaxCorrectNormal returns the hit relative to it). */
  center: any;
  size: any;
  near: number;
  far: number;
  rooms: Set<string>;
  cube: any;
  /** Every cube texture node sampling this probe (swapped to the fresh cube after a re-capture). */
  texNodes: any[];
  uCenter: any;
  uSize: any;
  uIntensity: any;
  /** 1 while the camera is inside this room's box (boundary variants then show the room, else the yard). */
  uInside: any;
  /** The spare cube a re-capture renders into. */
  alt?: any;
  /** World box of the room (+ 0.15 m for the wall thickness): boundary test and the camera-inside test. */
  box: any;
}

/** One cube sample, box-projected into the probe's room box (world space), × the probe's intensity. */
function probeSample(p: ReflectionProbe, rough: any): any {
  // three's EnvironmentNode recipe (rough lobes lean to the normal), then box projection in world space
  const r = positionViewDirection.negate().reflect(normalView);
  const rw = pow4(rough).mix(r, normalView).normalize().transformDirection(cameraWorldMatrix);
  const dir = getParallaxCorrectNormal(rw, p.uSize, p.uCenter);
  const t = cubeTexture(p.cube.texture, dir, rough.mul(uReflLod));
  p.texNodes.push(t); // re-captures render into the other cube and swap these (never sample the cube being drawn)
  return t.rgb.mul(p.uIntensity).mul(uReflection);
}

/**
 * Adds the probe radiance to the specular path only. Boundary variants (facade-side trim, window glass, shells)
 * blend their room's probe (camera inside that room) with the yard probe (camera outside): `edge`.
 */
class ReflectionNode extends (THREE as any).LightingNode {
  probe: ReflectionProbe;
  edge: ReflectionProbe | null;
  constructor(probe: ReflectionProbe, edge: ReflectionProbe | null) {
    super();
    this.probe = probe;
    this.edge = edge;
  }

  setup(builder: any): void {
    const sample = (rough: any) => {
      const room = probeSample(this.probe, rough);
      return this.edge ? probeSample(this.edge, rough).mix(room, this.probe.uInside) : room;
    };
    builder.context.radiance.addAssign(sample(roughness));
    const cc = builder.context.lightingModel?.clearcoatRadiance;
    if (cc) cc.addAssign(sample(clearcoatRoughness));
  }
}

/**
 * LOAD round (#157b): staleness key of the shipped cubes = the level probe key (level / prop / lightmap / collision
 * manifest hashes, layout, material spec, preset — level.ts levelProbeKey: everything the cube capture sees as data)
 * + the cube size + the LOOK values at load (sky, fog, moon, bake and bounce levels … — any tuning change makes the
 * shipped cubes stale, so the game captures at runtime rather than show old light) + REFLECTIONS_VERSION (the code
 * the cubes see; bumped by hand, refl-file.ts). Call it ONCE at load (cutscene bindings change LOOK later).
 */
export function reflectionsKey(levelKey: string): string {
  return probeKey([`refl-v${REFLECTIONS_VERSION}`, levelKey, `cube${CUBE_SIZE}`, JSON.stringify(LOOK)]);
}

/** The tier's shipped cube file, or null (missing / not one / unreadable). Never throws. */
export async function fetchReflFile(url: string): Promise<ReflFile | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await readReflFile(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** The attached RoomReflections (null on Low / WebGL2 / ?refl=0): read when a late node is built. */
let attached: RoomReflections | null = null;

/**
 * R2-6: a reflection for a prop that moves (the cleaver): bound to one room's cube, resolved when the material
 * builds (after attach()); a no-op where there are no reflections. Without it a metal with no radiance source only
 * shows three's multi-scatter term = the probe grid's flat irradiance (the parlor's moonlit window) — on the cleaver's
 * flat blade that was one even blue-grey card.
 */
class RoomEnvNode extends (THREE as any).LightingNode {
  room: string;
  constructor(room: string) {
    super();
    this.room = room;
  }

  setup(builder: any): void {
    const p = attached?.probeFor(this.room);
    // r3 AD review: the cube holds the parlor as baked (all candles lit, the moonlit window); in C5 the bake is
    // dimmed to LOOK.c5Bake (candles out) and the cube must go with it, or the blade mirrors light that has gone out
    // (the blue-grey card was the cube's window, measured: unchanged with every probe grid at 0)
    if (p) builder.context.radiance.addAssign(this.room === 'G2' ? probeSample(p, roughness).mul(uParlorBake) : probeSample(p, roughness));
  }
}

/**
 * Escape fix round (lane CINE): the room cube sampled along a WORLD-space reflection vector, for custom unlit shaders
 * (blood pools: a glossy pool mirrors the room it lies in). Resolved when the material builds; null where there are
 * no reflections (Low / WebGL2 / ?refl=0) — the caller falls back to its own constant.
 */
export function roomRadianceWorld(room: string, reflWorld: any, rough: any): any | null {
  const p = attached?.probeFor(room);
  if (!p) return null;
  const dir = getParallaxCorrectNormal(reflWorld, p.uSize, p.uCenter);
  const t = cubeTexture(p.cube.texture, dir, rough.mul(uReflLod));
  p.texNodes.push(t);
  const c = t.rgb.mul(p.uIntensity).mul(uReflection);
  return room === 'G2' ? c.mul(uParlorBake) : c;
}

/** setupEnvironment factory for a character material that reflects `room`'s cube. */
export function roomEnvironment(room: string): () => any {
  return () => new RoomEnvNode(room);
}

export interface ReflectionsOptions {
  renderer: any;
  scene: any;
  camera: any;
  layout: LevelLayout;
  /** Level.roomGroups (room id → group of that room's static meshes and props). */
  roomGroups: Map<string, any>;
  /** Doors: group + rooms (assigned to their first room's probe). */
  doors?: Iterable<{ group: any; rooms: string[] }>;
  /** Lights to darken during the capture (the flashlight). */
  darken?: any[];
  /** Scene children kept during the capture (the level root); every other child (camera + arms/torch, characters,
   *  rain, dust) is hidden so the probes hold only the static, lightmapped house. */
  keep: any[];
  /** Called for each per-room material clone (e.g. to register it in the level's material lists). */
  extra?: (clone: any, original: any) => void;
}

export class RoomReflections {
  readonly probes = new Map<string, ReflectionProbe>();
  private readonly byRoom = new Map<string, ReflectionProbe>();
  private readonly o: ReflectionsOptions;
  readonly stats = { probes: 0, materials: 0, clones: 0, objects: 0, edge: 0, captureMs: 0, source: 'capture' as 'capture' | 'shipped', recaptures: 0 };
  private exterior: ReflectionProbe | null = null;
  /** LOAD round (#157b): the exterior's shipped states (night = its load-time cube); null = runtime re-captures. */
  private shippedExt: Map<ReflState, any> | null = null;
  private readonly cam = new THREE.Vector3();
  private dawn = false;
  /** PERF G (ruling f): the exterior cube's last capture cameras (kept so the dawn re-capture reuses their states). */
  private extCams: any[] = [];
  /** PERF M-A review: the re-capture in progress (one cube face per frame). */
  private pending: { p: ReflectionProbe; cc: any; face: number } | null = null;

  constructor(o: ReflectionsOptions) {
    this.o = o;
    const floors = new Map(o.layout.floors.map((f) => [f.id, f.elevation]));
    for (const r of o.layout.rooms) {
      if (r.kind === 'exterior') continue;
      const z0 = floors.get(r.floor) ?? 0;
      const h = Math.max(2.2, r.ceiling || 2.6);
      const [x0, y0, x1, y1] = r.rect;
      if (r.id === 'RC9') {
        // runtime lane D (C0 26 "pale dry concrete road"): RC9 is a 1430 × 410 m set; its room-box probe was captured
        // in the field at the rect centre with a 2.6 m "ceiling" and a 40 m far plane, so the wet asphalt reflected a
        // lit ceiling-box of nothing (a pale sheen everywhere). Capture on the road itself (chainage ≈ 516, the truck
        // meeting point, eye 1.2 m) with a huge box = an at-infinity env: the corridor's dark sky slot + tree walls.
        this.addProbe(r.id, [r.id], [513.0, -132.7, 1.2], [4000, 4000, 400], 0.1, 400);
        continue;
      }
      this.addProbe(r.id, [r.id], [(x0 + x1) / 2, (y0 + y1) / 2, z0 + h / 2], [x1 - x0, y1 - y0, h], 0.05, 40);
    }
    // exterior: front yard, 1.7 m eye height, a 60 × 60 × 40 m box (far enough to read as the open world)
    this.exterior = this.addProbe('EXT', o.layout.rooms.filter((r) => r.kind === 'exterior').map((r) => r.id), [4, -9, 1.7], [60, 60, 40], 0.1, 220);
  }

  private addProbe(id: string, rooms: string[], c: [number, number, number], s: [number, number, number], near: number, far: number): ReflectionProbe {
    const center = new THREE.Vector3(...planToWorld(c));
    const size = new THREE.Vector3(s[0], s[2], s[1]); // plan (x, y, z) extents → world (x, z-up → y, y → z)
    const cube = new THREE.CubeRenderTarget(CUBE_SIZE, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    const box = new THREE.Box3().setFromCenterAndSize(center, size).expandByScalar(0.15);
    const p: ReflectionProbe = { id, center, size, near, far, rooms: new Set(rooms), cube, texNodes: [], uCenter: uniform(center.clone()), uSize: uniform(size.clone()), uIntensity: uniform(1), uInside: uniform(0), box };
    this.probes.set(id, p);
    for (const r of rooms) this.byRoom.set(r, p);
    return p;
  }

  /** Room id → probe (exterior rooms share the yard probe). */
  probeFor(room: string): ReflectionProbe | null {
    return this.byRoom.get(room) ?? null;
  }

  /**
   * LOAD round (#157b): fills every cube from the shipped file instead of capture() — and the exterior's dawn /
   * night-again states, so the in-game re-capture becomes a texture swap (no cube-context compile, render or prewarm
   * ever). Mip 0 of each face is written INTO the probe's own CubeRenderTarget (the target the capture renders into:
   * same texture, same sampling path, same orientation) and three's mip generator then builds the chain exactly as
   * after a capture (WebGPUBackend.generateMipmaps = the bundles a capture's last face runs). Returns false — and
   * touches nothing — when the file does not cover every probe at this cube size, or this is not the WebGPU backend.
   */
  applyShipped(f: ReflFile): boolean {
    const { renderer } = this.o;
    const be = renderer.backend;
    const device = be?.device;
    if (!device?.queue || typeof be.generateMipmaps !== 'function' || typeof renderer.initRenderTarget !== 'function' || f.size !== CUBE_SIZE) return false;
    const find = (id: string, state: ReflState) => f.cubes.find((c) => c.id === id && c.state === state) ?? null;
    for (const p of this.probes.values()) if (!find(p.id, 'night')) return false;
    const ext = this.exterior;
    const dawn = ext ? find(ext.id, 'dawn') : null;
    const night2 = ext ? find(ext.id, 'night2') : null;
    if (ext && (!dawn || !night2)) return false;
    const t0 = performance.now();
    const texels = CUBE_SIZE * CUBE_SIZE;
    // LOAD fixer (F1, #157i): `mips` = whether the runtime path's target for this state has a mip chain. The runtime
    // dawn cube does NOT: the spare EXT target (p.alt) is first allocated inside CubeCamera.update, which turns
    // generateMipmaps off for faces 0–4, so three (Textures.needsMipmaps) creates its GPU texture with ONE level — and
    // every surface then samples mip 0 at any roughness (the car hood / wet yard from C5 26.6 to the night change). The
    // night-again cube re-renders into the original load-time target (8 levels, chain generated). Same allocation here =
    // the live sampling: the texture keeps generateMipmaps = true (as CubeCamera.update leaves it) but is created while it
    // is false. (The visible C6 difference the review found was the cube's CONTENT — refl-export.mjs DAWN_BEAT.)
    const fill = (rt: any, rgb: Uint16Array, mips = true) => {
      const gm = rt.texture.generateMipmaps;
      if (!mips) rt.texture.generateMipmaps = false;
      try {
        renderer.initRenderTarget(rt);
      } finally {
        rt.texture.generateMipmaps = gm;
      }
      const gpu = be.get(rt.texture)?.texture;
      if (!gpu) throw new Error('cube target has no GPU texture');
      const rgba = rgbToRgba(rgb, texels * 6);
      device.queue.writeTexture({ texture: gpu, mipLevel: 0, origin: { x: 0, y: 0, z: 0 } }, rgba, { offset: 0, bytesPerRow: CUBE_SIZE * 8, rowsPerImage: CUBE_SIZE }, { width: CUBE_SIZE, height: CUBE_SIZE, depthOrArrayLayers: 6 });
      if (mips) be.generateMipmaps(rt.texture);
    };
    try {
      for (const p of this.probes.values()) fill(p.cube, find(p.id, 'night')!.rgb);
      if (ext && dawn && night2) {
        const mk = () => new THREE.CubeRenderTarget(CUBE_SIZE, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
        const d = mk();
        const n2 = mk();
        fill(d, dawn.rgb, false); // as the runtime spare target: one level (see `fill`)
        fill(n2, night2.rgb);
        this.shippedExt = new Map<ReflState, any>([['night', ext.cube], ['dawn', d], ['night2', n2]]);
      }
    } catch (e) {
      console.warn('[reflections] shipped cubes could not be uploaded — capturing at runtime:', e);
      this.shippedExt = null;
      return false;
    }
    this.stats.source = 'shipped';
    this.stats.captureMs = Math.round(performance.now() - t0);
    console.info(`[reflections] ${this.probes.size} shipped cubes${this.shippedExt ? ' + EXT dawn / night-again' : ''} uploaded in ${this.stats.captureMs} ms (no runtime capture)`);
    return true;
  }

  /**
   * LOAD round (#157b, scripts/qa/refl-export.mjs): mip 0 of every face of the probes' CURRENT cubes (`ids`, default
   * all), RGB half floats as the file stores them. Rows exactly as copyTextureToBuffer returns them (128 × 8 B per row
   * = a 256-byte multiple: no padding), which is what applyShipped's writeTexture expects.
   */
  async exportCubes(ids?: string[]): Promise<Array<{ id: string; rgb: Uint16Array; mips: number | null }>> {
    const { renderer } = this.o;
    const out: Array<{ id: string; rgb: Uint16Array; mips: number | null }> = [];
    const texels = CUBE_SIZE * CUBE_SIZE;
    for (const p of this.probes.values()) {
      if (ids && !ids.includes(p.id)) continue;
      const rgb = new Uint16Array(texels * 6 * 3);
      for (let f = 0; f < 6; f++) {
        const px: Uint16Array = await renderer.readRenderTargetPixelsAsync(p.cube, 0, 0, CUBE_SIZE, CUBE_SIZE, 0, f);
        if (!(px instanceof Uint16Array) || px.length < texels * 4) throw new Error(`cube ${p.id} face ${f}: unexpected readback (${px?.constructor?.name} ${px?.length})`);
        rgb.set(rgbaToRgb(px, texels), f * texels * 3);
      }
      // LOAD fixer (F1): the GPU cube's mip level count (the dawn cube has 1 on both paths — refl-export --verify)
      out.push({ id: p.id, rgb, mips: renderer.backend?.get?.(p.cube.texture)?.texture?.mipLevelCount ?? null });
    }
    return out;
  }

  /** The exterior probe's id (the cube the dawn / night re-captures change). */
  get exteriorId(): string | null {
    return this.exterior?.id ?? null;
  }

  /** LOAD round (#157b): the in-game dawn / night-again change with shipped cubes — swap, no render. */
  private swapShipped(state: ReflState): void {
    const p = this.exterior;
    const rt = this.shippedExt?.get(state);
    if (!p || !rt) return;
    p.cube = rt;
    for (const t of p.texNodes) t.value = rt.texture;
    this.stats.recaptures++;
    console.info(`[reflections] EXT → shipped ${state === 'dawn' ? 'dawn' : 'night'} cube (swap, no re-capture)`);
  }

  /**
   * Tags every mesh with its room's probe and hooks every glossy material. Call AFTER capture() (the capture then
   * renders the materials as they already are — no reflection code is ever built in the cube context) and BEFORE
   * the first compile of the frame context.
   */
  attach(): void {
    attached = this;
    const ext = this.exterior;
    const variants = new Map<any, Map<string, any>>();
    const bb = new THREE.Box3();
    const bc = new THREE.Vector3();
    const variant = (m: any, p: ReflectionProbe, edge: boolean): any => {
      if (!m || !isGlossy(m)) return m;
      let per = variants.get(m);
      if (!per) variants.set(m, (per = new Map()));
      const key = `${p.id}|${edge ? 'e' : 'i'}`;
      let v = per.get(key);
      if (v) return v;
      if (per.size === 0) v = m; // the first (room, kind) keeps the original material
      else {
        try {
          v = m.clone(); // LightmapMaterial is clone-safe (copy() carries the lightmap; NodeMaterial.copy the LightsNode)
          v.userData = m.userData;
          this.o.extra?.(v, m);
          this.stats.clones++;
        } catch (e) {
          console.warn(`[reflections] clone of ${m.name} failed — keeps its first probe:`, e);
          return m;
        }
      }
      per.set(key, v);
      hook(v, p, edge && p !== ext ? ext : null);
      this.stats.materials++;
      return v;
    };
    const tag = (root: any, p: ReflectionProbe) => {
      root.traverse((o: any) => {
        if (!o.isMesh || o.isSprite) return;
        let edge = false;
        if (p !== ext) {
          // boundary mesh: its centre is outside the room box, or it is bigger than the room (shells)
          bb.setFromObject(o);
          edge = !p.box.containsPoint(bb.getCenter(bc)) || bb.getSize(bc).length() > p.size.length();
        }
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        if (!mats.some((m: any) => isGlossy(m))) return;
        if (Array.isArray(o.material)) o.material = o.material.map((m: any) => variant(m, p, edge));
        else o.material = variant(o.material, p, edge);
        this.stats.objects++;
        if (edge) this.stats.edge++;
      });
    };
    for (const [room, g] of this.o.roomGroups) {
      const p = this.probeFor(room);
      if (p) tag(g, p);
    }
    for (const d of this.o.doors ?? []) {
      const p = d.rooms.map((r) => this.probeFor(r)).find(Boolean);
      if (p) tag(d.group, p);
    }
    this.stats.probes = this.probes.size;
  }

  /**
   * Re-captures one probe (C6 / B12 dawn: the yard cube then holds the twilight sky for the car paint and the wet
   * drive). Renders into a second cube and swaps the material texture nodes to it afterwards.
   */
  recapture(id: string): void {
    const p = this.probes.get(id);
    if (!p) return;
    p.alt ??= new THREE.CubeRenderTarget(CUBE_SIZE, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    // PERF M-A review: one cube face per frame (the 6 faces in one frame measured 1895 draws / 7.55 M tris, an 83 ms
    // frame inside C5 / C6); the materials keep sampling the old cube until the 6th face (+ mips) is in, then swap.
    const cc = new THREE.CubeCamera(p.near, p.far, p.alt);
    for (const c of cc.children) c.layers.enable(6); // RUNTIME F2: the yard meshes the window cull parked on layer 6
    cc.position.copy(p.center);
    cc.updateMatrixWorld(true);
    const job = { p, cc, face: -1 };
    this.pending = job;
    void this.precompileJob(job);
  }

  /**
   * PERF M-A review: before the faces render, compile what the dawn / night state draws in the cube context with
   * renderer.compileAsync (r186: the scene is projected synchronously under the capture state, then node builds yield
   * and pipelines compile async off the frame). Measured without it on the real route: objects first drawn in the dawn
   * state (26 node builds at C5 28.9) stalled the next frames 0.9 s (Medium) / 2.4 s (Max).
   */
  private async precompileJob(job: { p: ReflectionProbe; cc: any; face: number }): Promise<void> {
    const { renderer, scene, roomGroups } = this.o;
    const { cc } = job;
    try {
      if (typeof renderer.compileAsync === 'function') {
        if (cc.coordinateSystem !== renderer.coordinateSystem) {
          cc.coordinateSystem = renderer.coordinateSystem;
          cc.updateCoordinateSystem();
        }
        for (let f = 0; f < 6; f++) {
          const groupVis = [...roomGroups.values()].map((g) => [g, g.visible] as const);
          const others = scene.children.filter((c: any) => !this.o.keep.includes(c)).map((c: any) => [c, c.visible] as const);
          const prev = renderer.getRenderTarget();
          const prevFace = renderer.getActiveCubeFace();
          const prevMip = renderer.getActiveMipmapLevel();
          let pr: Promise<void> | null = null;
          try {
            for (const [g] of groupVis) g.visible = true;
            for (const [c] of others) c.visible = false;
            renderer.setRenderTarget(cc.renderTarget, f);
            pr = renderer.compileAsync(scene, cc.children[f]); // its synchronous part projects the scene now
          } finally {
            renderer.setRenderTarget(prev, prevFace, prevMip);
            for (const [g, v] of groupVis) g.visible = v;
            for (const [c, v] of others) c.visible = v;
          }
          await pr;
        }
      }
    } catch (e) {
      console.warn('[reflections] re-capture precompile failed (continuing):', e);
    }
    if (this.pending === job) job.face = 0;
  }

  /** One face of the pending re-capture (same scene state as capture()); the 6th swaps the cube in. */
  private stepRecapture(): void {
    const job = this.pending;
    if (!job || job.face < 0) return; // still compiling (precompileJob)
    const { renderer, scene, roomGroups } = this.o;
    const { p, cc } = job;
    const f = job.face;
    const rt = cc.renderTarget;
    if (cc.coordinateSystem !== renderer.coordinateSystem) {
      cc.coordinateSystem = renderer.coordinateSystem;
      cc.updateCoordinateSystem();
    }
    const groupVis = [...roomGroups.values()].map((g) => [g, g.visible] as const);
    const dark = (this.o.darken ?? []).map((l) => [l, l.intensity] as const);
    const others = scene.children.filter((c: any) => !this.o.keep.includes(c)).map((c: any) => [c, c.visible] as const);
    const prev = renderer.getRenderTarget();
    const prevFace = renderer.getActiveCubeFace();
    const prevMip = renderer.getActiveMipmapLevel();
    const gm = rt.texture.generateMipmaps;
    try {
      for (const [g] of groupVis) g.visible = true;
      for (const [l] of dark) l.intensity = 0;
      for (const [c] of others) c.visible = false;
      rt.texture.generateMipmaps = f === 5 ? gm : false; // as CubeCamera.update: mips on the last face only
      renderer.setRenderTarget(rt, f);
      renderer.render(scene, cc.children[f]);
    } finally {
      rt.texture.generateMipmaps = gm;
      renderer.setRenderTarget(prev, prevFace, prevMip);
      for (const [g, v] of groupVis) g.visible = v;
      for (const [l, i] of dark) l.intensity = i;
      for (const [c, v] of others) c.visible = v;
      // SMOOTH-FIX (#145b, re-verify N3: the torch pool blinked off for 6 frames at C5's end — and in gameplay —
      // whenever the dawn / night re-capture ran): the lightmapped and probe-lit materials light through their own
      // lightsNode lists (level.ts: lights([torch, bounce, …])), which this face render evaluates whatever the scene's
      // visibility — with the torch darkened to 0. three r186's AnalyticLightNode is FRAME-updated (color = light.color ×
      // intensity, once per node frame), so the main render that follows in the SAME frame skipped the update and drew
      // the torch at 0 on every lightmapped surface (its unshadowed bounce left: ×0.19). scratch/fix/r2/n3 (c5refl.mjs):
      // the 6 dark frames are exactly the 6 cube-face frames. A new node frame (as compileAsync and pipeline.ts already
      // do mid-frame) makes the main render re-evaluate them with the restored intensity.
      if (dark.length) renderer._nodes?.nodeFrame?.update();
    }
    if (++job.face < 6) return;
    this.pending = null;
    p.alt = p.cube;
    p.cube = rt;
    for (const t of p.texNodes) t.value = rt.texture;
    this.stats.recaptures++; // LOAD round: refl-export.mjs waits on it
    // ruling f: free what only the previous exterior cameras still own; this camera set stays for the next re-capture
    const drop = this.extCams.flatMap((c) => c.children);
    this.extCams = [cc];
    const freed = noRoGc() ? 0 : disposeRenderObjectsFor(renderer, drop);
    console.info(`[reflections] re-captured ${p.id} (${this.dawn ? 'dawn' : 'night'} sky, 6 frames; freed ${freed})`);
  }

  /**
   * PERF M-A review: at load, behind the loading screen, render the exterior once more into its spare cube AFTER
   * attach() — the hooked (reflection) material variants then have their cube-context render objects + pipelines,
   * which the kept exterior capture cameras hold (ruling f). Measured without it: the in-game dawn re-capture (C5 26.6,
   * C6, any B12 load, and back to night) built 120 nodes and froze 40 s on a cold Metal cache (≈ 0.6 s warm), Medium.
   */
  async prewarmRecapture(): Promise<void> {
    const p = this.exterior;
    if (!p) return;
    p.alt ??= new THREE.CubeRenderTarget(CUBE_SIZE, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    await this.capture([p], p.alt, true);
  }

  /** Renders every cube from the lightmapped scene (load time, once; the mip chain is generated per face). */
  async capture(only?: ReflectionProbe[], into?: any, precompile = !only): Promise<void> {
    const { renderer, scene, roomGroups } = this.o;
    const t0 = performance.now();
    const groupVis = [...roomGroups.values()].map((g) => [g, g.visible] as const);
    const dark = (this.o.darken ?? []).map((l) => [l, l.intensity] as const);
    const others = scene.children.filter((c: any) => !this.o.keep.includes(c)).map((c: any) => [c, c.visible] as const);
    const oneShot: any[] = []; // PERF G: every CubeCamera of this call (each capture makes new ones: never drawn again)
    try {
      for (const [g] of groupVis) g.visible = true;
      for (const [l] of dark) l.intensity = 0;
      for (const [c] of others) c.visible = false;
      // runtime lane E (item 1): precompile the cube context's pipelines in parallel (render/parallel-compile.ts)
      // before the synchronous captures — cold, the 13 cubes' serial first-render compiles took 67 s on Max.
      if (precompile && typeof renderer.compileAsync === 'function') {
        const prev = renderer.getRenderTarget();
        try {
          await deferCompileWaits(async () => {
          for (const p of only ?? this.probes.values()) {
            const cc = new THREE.CubeCamera(p.near, p.far, p.cube);
            oneShot.push(cc);
            cc.coordinateSystem = renderer.coordinateSystem;
            cc.updateCoordinateSystem();
            cc.position.copy(p.center);
            cc.updateMatrixWorld(true);
            for (let f = 0; f < 6; f++) {
              renderer.setRenderTarget(p.cube, f);
              await renderer.compileAsync(scene, cc.children[f]); // serial node builds (no duplicate builds)
            }
          }
          });
        } catch (e) {
          console.warn('[reflections] precompile failed (continuing):', e);
        } finally {
          renderer.setRenderTarget(prev);
        }
      }
      for (const p of only ?? this.probes.values()) {
        const cc = new THREE.CubeCamera(p.near, p.far, into ?? p.cube);
        oneShot.push(cc);
        for (const c of cc.children) c.layers.enable(6); // RUNTIME F2: also the yard meshes the view's window cull parked on layer 6 (src/world/window-cull.ts)
        cc.position.copy(p.center);
        cc.updateMatrixWorld(true);
        cc.update(renderer, scene);
      }
    } finally {
      for (const [g, v] of groupVis) g.visible = v;
      for (const [l, i] of dark) l.intensity = i;
      for (const [c, v] of others) c.visible = v;
    }
    // PERF G (ruling f): the render objects of these one-shot face cameras are garbage the renderer keeps forever
    // (three keys them by camera) — free them; the exterior cube's latest capture set stays (dawn re-capture, C6/B12).
    const ext = this.exterior;
    const keep = ext && (only ?? [...this.probes.values()]).includes(ext) ? oneShot.filter((c) => c.renderTarget === (into ?? ext.cube)).slice(-1) : [];
    const drop = [...oneShot.filter((c) => !keep.includes(c)), ...(keep.length ? this.extCams : [])].flatMap((c) => c.children);
    if (keep.length) this.extCams = keep;
    const freed = noRoGc() ? 0 : disposeRenderObjectsFor(renderer, drop);
    if (!only) this.stats.captureMs = Math.round(performance.now() - t0);
    console.info(`[reflections] freed ${freed} one-shot capture render objects`);
  }

  /** Per frame: the exterior env follows the lightning (sky × 5 at the peak); which room box holds the camera. */
  update(lightning: number, camera: any, skyTint = 0): void {
    if (this.exterior) this.exterior.uIntensity.value = 1 + 4 * lightning;
    // dawn (C6 / B12): the yard cube is re-captured once the twilight sky is up, and again back at night
    if (this.pending) this.stepRecapture();
    else if (this.exterior && skyTint > 0.6 !== this.dawn && (skyTint > 0.6 || skyTint < 0.2)) {
      this.dawn = skyTint > 0.6;
      if (this.shippedExt) this.swapShipped(this.dawn ? 'dawn' : 'night2');
      else this.recapture(this.exterior.id);
    }
    camera.getWorldPosition(this.cam);
    for (const p of this.probes.values()) p.uInside.value = p.box.containsPoint(this.cam) ? 1 : 0;
  }
}

function isGlossy(m: any): boolean {
  const id = m?.userData?.material_id;
  if (typeof id !== 'string') return false;
  const s = specById(id);
  return !!s && s.roughness < GLOSSY_MAX_ROUGHNESS;
}

function hook(m: any, p: ReflectionProbe, edge: ReflectionProbe | null): void {
  const make = () => new ReflectionNode(p, edge);
  if (m.isLightmapMaterial) m.lmReflection = make;
  else m.setupEnvironment = make; // instance override: radiance only (the probe grid is the diffuse)
  if (specById(m.userData.material_id)?.family === 'glass' && m.transparent) {
    // reflection ADDED over the transmitted background: out = lit glass + dst × (1 − α)
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.OneFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.OneFactor;
    m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  }
  m.needsUpdate = true;
}
