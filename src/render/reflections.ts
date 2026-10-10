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
import { cameraWorldMatrix, clearcoatRoughness, cubeTexture, getParallaxCorrectNormal, normalView, positionViewDirection, pow4, roughness, uniform } from 'three/tsl';
import type { LevelLayout } from '../shared/layout-types.ts';
import { planToWorld } from '../shared/coords.ts';
import { specById } from '../materials/spec-index.ts';
import { uParlorBake } from './lightmap-material.ts';
import { deferCompileWaits } from './parallel-compile.ts';
import { disposeRenderObjectsFor, noRoGc } from './ro-gc.ts'; // PERF G (ruling f)

/** Global reflection multiplier (look API `reflections`; 1 = physical). */
export const uReflection = uniform(1);
/** lod = roughness × this (128² cube: mip 7 = 1 px). Look API `reflLod`. */
export const uReflLod = uniform(7);
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
  readonly stats = { probes: 0, materials: 0, clones: 0, objects: 0, edge: 0, captureMs: 0 };
  private exterior: ReflectionProbe | null = null;
  private readonly cam = new THREE.Vector3();
  private dawn = false;
  /** PERF G (ruling f): the exterior cube's last capture cameras (kept so the dawn re-capture reuses their states). */
  private extCams: any[] = [];

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
    const target = p.alt;
    p.alt = p.cube;
    void this.capture([p], target);
    p.cube = target;
    for (const t of p.texNodes) t.value = target.texture;
    console.info(`[reflections] re-captured ${id} (${this.dawn ? 'dawn' : 'night'} sky)`);
  }

  /** Renders every cube from the lightmapped scene (load time, once; the mip chain is generated per face). */
  async capture(only?: ReflectionProbe[], into?: any): Promise<void> {
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
      if (!only && typeof renderer.compileAsync === 'function') {
        const prev = renderer.getRenderTarget();
        try {
          await deferCompileWaits(async () => {
          for (const p of this.probes.values()) {
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
    if (this.exterior && skyTint > 0.6 !== this.dawn && (skyTint > 0.6 || skyTint < 0.2)) {
      this.dawn = skyTint > 0.6;
      this.recapture(this.exterior.id);
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
