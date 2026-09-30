// Material binding (docs/PLAN.md §2.5): glTF material `extras.material_id` → a node material fed by the baked maps.
//
//  - 'generated'    → baked tiling maps (baker.ts), repeat = 1 / tileMetres on UV0 (UV0 is in metres: PROPS/HOUSE.md)
//  - 'baked_unique' → the texture shipped with the asset (glTF map/normalMap/roughnessMap on its own UVs); if the
//                     asset has none yet, falls back to the family generator (skin/hair/nightgown… fallbacks)
//  - 'constant'     → flat PBR from avgAlbedo / roughness / metalness
// Lightmapped static meshes (a lightmap is supplied for the mesh) get LightmapMaterial (render/lightmap-material.ts)
// with the same nodes; everything else a MeshStandardNodeMaterial, or MeshPhysicalNodeMaterial where clearcoat
// (car paint) or sheen (cloth) pays for itself (not on Low).
//
// Runtime layers on top of the baked maps (all cheap, no extra textures):
//  - anti-tiling: world-space macro variation (brightness/hue/roughness, ~1–4 m scale) — hides the repeat;
//  - dust on up-facing surfaces (per-spec `dust`/`cobwebDust` + the global uDust);
//  - dynamic wetness uWet (rain on the player's path, drips): porous darkening + gloss. Spec `wetness` is already
//    baked into the maps (so the ±10 % avgAlbedo check measures what Cycles uses for bounce).
//  - albedo gain from the baker's measurement (matches spec.avgAlbedo, the Blender bounce colour).

import * as THREE from 'three/webgpu';
import { float, mix, mx_fractal_noise_float, mx_noise_float, normalMap, normalWorld, positionWorld, smoothstep, texture, uniform, uv, vec2, vec3 } from 'three/tsl';
import type { MaterialSpec } from '../shared/material-types.ts';
import type { PresetConfig } from '../render/presets.ts';
import { LightmapMaterial, type LightmapOptions } from '../render/lightmap-material.ts';
import { MaterialBaker, textureSizeFor, type BakedMaterial, type BakeProgress } from './baker.ts';
import { generatorFor, superTileFor } from './library/index.ts';
import { MATERIAL_SPECS, specById } from './spec-index.ts';

type N = any;

export { MATERIAL_SPECS, specById };

/** Global runtime material uniforms. */
export const materialUniforms = {
  /** Extra dynamic wetness 0..1 (rain events, drips) on top of the baked spec wetness. */
  wet: uniform(0),
  /** Global dust multiplier (1 = spec). */
  dust: uniform(1),
  /** Macro variation strength (anti-tiling). */
  macro: uniform(1),
};

const FABRIC = new Set(['rug', 'fabric', 'crepe', 'burlap', 'flannel', 'nightgown']);
const DUST_RGB: [number, number, number] = [0.3, 0.285, 0.26];
/**
 * Families whose generators have a gravity direction (rising damp, scuffs low on the wainscot, the tally's top
 * limit, rain streaks on glass): the glTF exporter writes v' = 1 − v, so walls reach us with uv.y DECREASING upward
 * (docs/HOUSE.md). Sample them at 1 − v (= Blender's v = height) so "up" in the texture is up on the wall and height-in-metres effects start at the floor.
 * Clapboard is authored pre-flipped in Blender and is not in this set.
 */
const GRAVITY_FAMILIES = new Set(['wallpaper', 'plaster', 'wood_painted', 'glass']);

export interface SurfaceOptions {
  preset: PresetConfig;
  lightmap?: LightmapOptions | null;
  side?: number;
  /** For baked_unique: the asset's own glTF material (its maps are reused). */
  source?: any;
  /** Override the UV repeat (default 1 / tileMetres). */
  repeat?: number;
  /**
   * The mesh has a vertex `tangent` attribute (character GLBs export tangents). Our maps are authored in three's
   * derivative (no-tangent) frame; GLTFLoader flips normalScale.y between the two frames, so we do too.
   */
  vertexTangents?: boolean;
  /** Disable the runtime layers (matlab A/B). */
  layers?: { macro?: boolean; dust?: boolean };
}

/** Builds the node material for one spec. `baked` null → constant or baked_unique path. */
export function createSurfaceMaterial(spec: MaterialSpec, baked: BakedMaterial | null, o: SurfaceOptions): any {
  const low = o.preset.id === 'low';
  const wantsClearcoat = spec.family === 'car_paint' && !low && !o.lightmap;
  const wantsSheen = FABRIC.has(spec.family) && !low && !o.lightmap;
  const params = { name: spec.id, side: o.side ?? THREE.FrontSide };
  let m: any;
  if (o.lightmap) m = new LightmapMaterial(params, o.lightmap);
  else if (wantsClearcoat || wantsSheen) m = new THREE.MeshPhysicalNodeMaterial(params);
  else m = new THREE.MeshStandardNodeMaterial(params);
  m.userData.material_id = spec.id;

  const src = o.source;
  const uniqueMaps = spec.source === 'baked_unique' && src?.map;
  let albedo: N;
  let rough: N;
  let metal: N = float(spec.metalness);
  let ao: N = null;
  let normal: N = null;
  let opacity: N = null;

  if (uniqueMaps) {
    albedo = texture(src.map).rgb;
    rough = src.roughnessMap ? texture(src.roughnessMap).g.mul(src.roughness ?? 1) : float(spec.roughness);
    if (src.metalnessMap) metal = texture(src.metalnessMap).b.mul(src.metalness ?? 1);
    if (src.normalMap) normal = normalMap(texture(src.normalMap), vec2(src.normalScale?.x ?? 1, src.normalScale?.y ?? 1));
    if (src.aoMap) ao = texture(src.aoMap).r;
  } else if (baked) {
    const rep = o.repeat ?? 1 / baked.repeatM;
    const flipV = GRAVITY_FAMILIES.has(spec.family) && !o.vertexTangents;
    const tuv = flipV ? vec2(uv().x, uv().y.oneMinus()).mul(rep) : uv().mul(rep);
    const A = texture(baked.mapA, tuv);
    const B = texture(baked.mapB, tuv);
    albedo = A.rgb.mul(vec3(...baked.gain));
    rough = A.a;
    // a mirrored V mirrors the tangent frame: flip the normal's green channel with it
    const nm = o.vertexTangents || flipV ? normalMap(B, vec2(1, -1)) : normalMap(B);
    nm.unpackNormalMode = THREE.NormalRGPacking;
    normal = nm;
    ao = B.z;
    if (baked.extraKind === 'metal') metal = B.w; // generators write metalness itself (spec.metalness = its mean)
    if (baked.extraKind === 'opacity') opacity = B.w;
  } else {
    albedo = vec3(...spec.avgAlbedo);
    rough = float(spec.roughness);
  }

  // ---- runtime layers
  const L = o.layers ?? {};
  const isGlass = spec.family === 'glass';
  if (L.macro !== false && !isGlass) {
    // Two non-periodic world-space octaves (runtime-only; never baked, so no tiling concern).
    const pw = positionWorld;
    const big = mx_fractal_noise_float(pw.mul(0.45), 2, 2, 0.5).mul(materialUniforms.macro);
    const hue = mx_noise_float(pw.mul(0.23).add(vec3(3.1, 7.7, 1.3))).mul(materialUniforms.macro);
    albedo = albedo.mul(big.mul(0.16).add(1)).mul(vec3(hue.mul(0.05).add(1), 1, hue.mul(-0.05).add(1)));
    rough = rough.add(big.mul(-0.05));
  }
  const p = spec.params as Record<string, unknown>;
  // World-space water stains (wallpaper / plaster / ceilings): tide-marked brown blotches that never repeat.
  // Walls get more of them near the ceiling when the spec says the water comes from above.
  const stainAmt = Math.max(Number(p.damp ?? 0) * 0.6, Number(p.waterStains ?? 0), Number(p.waterStainFromCeiling ?? 0));
  if (L.macro !== false && stainAmt > 0 && (spec.family === 'wallpaper' || spec.family === 'plaster' || spec.family === 'ceiling_plaster')) {
    const pw = positionWorld;
    const n = mx_fractal_noise_float(pw.mul(vec3(0.9, 0.55, 0.9)), 4, 2, 0.55).mul(0.5).add(0.5);
    const fromTop = Number(p.waterStainFromCeiling ?? 0);
    const bias = fromTop > 0 ? smoothstep(1.2, 2.6, pw.y).mul(fromTop * 0.35) : float(0);
    const t = 1 - stainAmt * 0.42;
    const v = n.add(bias);
    const body = smoothstep(t - 0.01, t + 0.03, v);
    const d1 = v.sub(t).div(0.012);
    const d2 = v.sub(t + 0.06).div(0.009);
    const rim = d1.mul(d1).negate().exp().add(d2.mul(d2).negate().exp().mul(0.5)).clamp(0, 1);
    albedo = mix(albedo, albedo.mul(vec3(0.82, 0.66, 0.44)), body.mul(0.75)).mul(float(1).sub(rim.mul(0.4)));
    rough = rough.add(body.mul(0.04));
  }
  // World-space stains on small-tile textiles/paper (tile-space stains would repeat every few centimetres).
  const clothStain = Math.max(Number(p.stains ?? 0), Number(p.waterDamage ?? 0) * 0.6);
  if (L.macro !== false && clothStain > 0 && spec.tileMetres < 0.5) {
    const n = mx_fractal_noise_float(positionWorld.mul(3.1), 4, 2, 0.55).mul(0.5).add(0.5);
    const t = 1 - clothStain * 0.3;
    const body = smoothstep(t - 0.01, t + 0.03, n);
    const d1 = n.sub(t).div(0.012);
    const rim = d1.mul(d1).negate().exp();
    albedo = mix(albedo, albedo.mul(vec3(0.62, 0.52, 0.38)), body.mul(0.7)).mul(float(1).sub(rim.mul(0.3)));
  }
  const dustAmt = Math.max(Number(p.dust ?? 0), Number(p.cobwebDust ?? 0), Number(p.dustOnTop ?? 0));
  if (L.dust !== false && dustAmt > 0 && !isGlass && spec.wetness < 0.3) {
    const up = smoothstep(0.55, 0.95, normalWorld.y);
    const patch = mx_fractal_noise_float(positionWorld.mul(2.7), 3, 2, 0.5).mul(0.5).add(0.5);
    const d = up.mul(smoothstep(0.25, 0.75, patch.mul(dustAmt).add(dustAmt * 0.35))).mul(materialUniforms.dust).clamp(0, 1).mul(0.75);
    albedo = mix(albedo, vec3(...DUST_RGB), d);
    rough = mix(rough, float(0.95), d);
    metal = metal.mul(float(1).sub(d));
  }
  // Dynamic wetness (porous darkening + gloss), Lagarde-style.
  const w = materialUniforms.wet.mul(rough.clamp(0.1, 1));
  albedo = albedo.mul(float(1).sub(w.mul(0.45)));
  rough = rough.mul(float(1).sub(materialUniforms.wet.mul(0.6)));

  m.colorNode = albedo;
  m.roughnessNode = rough.clamp(0.03, 1);
  m.metalnessNode = metal;
  if (normal) m.normalNode = normal;
  if (ao) m.aoNode = ao;

  if (isGlass) {
    m.transparent = true;
    m.depthWrite = false;
    // IOR 1.52 → F0 ≈ 0.043 ≈ three's default dielectric F0 (0.04): no extra term needed.
    // Clean glass is nearly invisible except its reflection; grime makes it more opaque and rougher.
    m.opacityNode = opacity ? mix(float(0.1), float(0.85), opacity) : float(0.15);
  }
  if (wantsClearcoat) {
    m.clearcoatNode = float(Number(p.clearcoat ?? 0.6)).mul(float(1).sub(rough.mul(0.5)));
    m.clearcoatRoughnessNode = rough.mul(0.35).add(0.03);
  }
  if (wantsSheen) {
    m.sheenNode = albedo.mul(0.6).add(0.08);
    m.sheenRoughnessNode = float(0.6);
  }
  return m;
}

// ---------------------------------------------------------------- scene binding -------------------------------

export interface BindContext {
  renderer: any;
  preset: PresetConfig;
  baker?: MaterialBaker;
  /** Lightmap for a static mesh (null → probe-lit). */
  lightmapFor?: (mesh: any) => LightmapOptions | null;
  onProgress?: (p: BakeProgress) => void;
}

export interface BindResult {
  baker: MaterialBaker;
  materials: any[];
  lightmapped: any[];
  missing: string[];
  bakedIds: string[];
}

function materialIdOf(mat: any): string | null {
  const id = mat?.userData?.material_id;
  return typeof id === 'string' ? id : null;
}

/** Bakes (once) the generated maps a spec needs at this preset. */
export async function ensureBaked(baker: MaterialBaker, spec: MaterialSpec, preset: PresetConfig, force = false): Promise<BakedMaterial | null> {
  if (spec.source === 'constant') return null;
  if (spec.source === 'baked_unique' && !force) return null;
  return baker.bake(spec, generatorFor(spec), textureSizeFor(spec, preset), superTileFor(spec));
}

/**
 * Walks a loaded glTF scene and replaces every material carrying `material_id` with our node material. Materials
 * are shared per (id, side, lightmap). Returns the bound materials (the lightmapped ones need
 * `excludeGridFromLightmapped`, render/probes.ts).
 */
/** One baker (and its texture cache) per renderer, so repeated bindMaterials calls never re-bake a material. */
const BAKERS = new WeakMap<object, MaterialBaker>();
export function sharedBaker(renderer: any, preset: PresetConfig): MaterialBaker {
  let b = BAKERS.get(renderer);
  if (!b) {
    b = new MaterialBaker(renderer, preset.textures.anisotropy);
    BAKERS.set(renderer, b);
  }
  return b;
}

export async function bindMaterials(root: any, bc: BindContext): Promise<BindResult> {
  const baker = bc.baker ?? sharedBaker(bc.renderer, bc.preset);
  const meshes: any[] = [];
  root.traverse((o: any) => {
    if (o.isMesh) meshes.push(o);
  });
  // Collect ids first so the bake can report progress over the whole set.
  const need = new Map<string, { spec: MaterialSpec; unique: boolean; hasMap: boolean }>();
  const missing = new Set<string>();
  for (const mesh of meshes) {
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const id = materialIdOf(mat);
      if (!id) continue;
      const spec = specById(id);
      if (!spec) {
        missing.add(id);
        continue;
      }
      const prev = need.get(spec.id);
      need.set(spec.id, { spec, unique: spec.source === 'baked_unique', hasMap: (prev?.hasMap ?? true) && !!mat.map });
    }
  }
  const todo = [...need.values()].filter((n) => n.spec.source === 'generated' || (n.unique && !n.hasMap));
  let done = 0;
  const baked = new Map<string, BakedMaterial>();
  for (const n of todo) {
    const b = await ensureBaked(baker, n.spec, bc.preset, true);
    if (b) baked.set(n.spec.id, b);
    bc.onProgress?.({ done: ++done, total: todo.length, id: n.spec.id, ms: b?.totalMs ?? 0 });
  }
  baker.releaseScratch(); // HalfFloat scratch + shared bake materials are recreated on demand
  if (todo.length) {
    const ms = [...baked.values()].reduce((a, b) => a + b.totalMs, 0);
    console.info(`[materials] bound ${todo.length} generated materials in ${ms.toFixed(0)} ms · maps ${(baker.totalBytes() / 1048576).toFixed(0)} MB`);
  }

  const shared = new Map<string, any>();
  const lightmapped: any[] = [];
  const materials: any[] = [];
  for (const mesh of meshes) {
    const lm = bc.lightmapFor?.(mesh) ?? null;
    const vt = !!mesh.geometry?.attributes?.tangent;
    const swap = (mat: any) => {
      const id = materialIdOf(mat);
      const spec = id ? specById(id) : undefined;
      if (!spec) return mat;
      const side = mat.side ?? THREE.FrontSide;
      const key = `${spec.id}|${side}|${lm ? lm.base?.uuid : '-'}|${vt ? 't' : ''}|${spec.source === 'baked_unique' && mat.map ? mat.uuid : ''}`;
      let m = shared.get(key);
      if (!m) {
        m = createSurfaceMaterial(spec, baked.get(spec.id) ?? null, { preset: bc.preset, lightmap: lm, side, source: mat, vertexTangents: vt });
        shared.set(key, m);
        materials.push(m);
        if (lm) lightmapped.push(m);
      }
      return m;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  }
  return { baker, materials, lightmapped, missing: [...missing], bakedIds: [...baked.keys()] };
}
