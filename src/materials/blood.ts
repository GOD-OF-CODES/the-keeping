// C2-ESCAPE B6 (§3.7 "Blood on Harlan / the cleaver / Ada's gown"): wet blood as a TSL MASK on an existing material —
// no new samplers (Harlan already sits at 16 on Max), pure arithmetic on object-space position. The character lane
// applies it to its own materials (src/characters/**): `applyBlood(material, opts)` wraps colorNode / roughnessNode.
//
// The mask is the union of
//   - a SPLASH: a capillary front out from a source point (the neck seen from the apron / the blade's edge), its
//     radius growing with the uniform `amount` (0 → 1 over the shot), broken by value noise (the film is uneven);
//   - SPATTER: hashed object-space cells, each a droplet stain of 2–6 mm, the density falling with distance from the
//     source (medium-velocity impact spatter thins out with range, §3.3);
//   - a DOWNWARD RUN (gravity, −Y in the object's space): what reaches an edge wicks / runs down.
// Wet blood over the base: albedo → blood_wet (0.11, 0.009, 0.008) under a thick film, darkening a cloth by
// absorption where thin (wet cotton goes darker and translucent); roughness → 0.05 (fresh) … 0.25 (clotting, by age).

import { Fn, float, vec3, mix, smoothstep, clamp, floor, fract, dot, sin, length, max, min, uniform, positionLocal } from 'three/tsl';
import { specById } from './spec-index.ts';

type N = any;

const spec = specById('blood_wet');
/** blood_wet albedo (linear) — material-spec K7. */
export const BLOOD_ALBEDO: [number, number, number] = (spec?.avgAlbedo as [number, number, number]) ?? [0.11, 0.009, 0.008];
export const BLOOD_ROUGH = spec?.roughness ?? 0.05;

const hash3 = (p: N) => fract(sin(dot(p, vec3(127.1, 311.7, 74.7))).mul(43758.5453));

export interface BloodMaskOptions {
  /** the source of the splash in the object's local space (m) */
  source: [number, number, number];
  /** max splash radius at amount 1 (m) */
  radius: number;
  /** spatter reach (m) and cell size (m) */
  reach?: number;
  cell?: number;
  /** how far runs go below the splash (m) at amount 1 */
  run?: number;
  seed?: number;
}

/** 0..1 coverage of wet blood at object-space p for `amount` (uniform node, 0..1). */
export function bloodMask(p: N, amount: N, o: BloodMaskOptions): N {
  return Fn(() => {
    const src = vec3(...o.source);
    const d = length(p.sub(src));
    // the splash with an uneven capillary front
    const n1 = hash3(floor(p.mul(37)).add(o.seed ?? 3));
    const front = amount.mul(o.radius).mul(float(0.8).add(n1.mul(0.4)));
    const splash = float(1).sub(smoothstep(front.mul(0.85), front, d));
    // spatter cells: a droplet of 2–6 mm in some cells, denser near the source
    const cell = o.cell ?? 0.012;
    const q = p.div(cell);
    const ci = floor(q);
    const h = hash3(ci.add(17 + (o.seed ?? 3)));
    const fq = fract(q).sub(0.5);
    const rad = float(0.17).add(h.mul(0.33)); // 2–6 mm of a 12 mm cell
    const drop = float(1).sub(smoothstep(rad.mul(0.8), rad, length(fq)));
    const density = clamp(float(1).sub(d.div(o.reach ?? 0.4)), 0, 1).mul(amount);
    const spatter = drop.mul(smoothstep(float(1).sub(density.mul(0.35)), 1, h));
    // runs: below the splash, thin vertical streaks (x-z hash columns)
    const col = hash3(vec3(floor(p.x.mul(90)), 0, floor(p.z.mul(90))).add(o.seed ?? 3));
    const below = src.y.sub(p.y);
    const runLen = amount.mul(o.run ?? 0.15).mul(col);
    const runs = smoothstep(0.7, 0.9, col).mul(step01(below)).mul(float(1).sub(smoothstep(runLen.mul(0.7), runLen, below))).mul(float(1).sub(smoothstep(o.radius * 0.6, o.radius * 1.2, length(p.xz.sub(src.xz)))));
    return clamp(max(max(splash, spatter), runs), 0, 1);
  })();
}

const step01 = (x: N) => smoothstep(0, 0.002, x);

/** Mix a wet blood film over a base albedo / roughness. `thick` 0..1: 1 = an opaque film (apron, steel), 0.4 = soaked
 *  into cotton (darker, the weave still shows). `ageMin` = minutes since the strike (uniform node). */
export function bloodOver(baseColor: N, baseRough: N, mask: N, thick: number, ageMin: N): { color: N; roughness: N } {
  const film = mix(baseColor.mul(vec3(0.35, 0.05, 0.045)), vec3(...BLOOD_ALBEDO), float(thick));
  const clot = clamp(ageMin.sub(3).div(7), 0, 1);
  const r = float(BLOOD_ROUGH).add(clot.mul(0.2));
  return { color: mix(baseColor, film, mask), roughness: mix(baseRough, min(baseRough, r).max(r.mul(float(thick))), mask) };
}

/** One shared clock for every blood mask: amount 0..1 (C2 drives it), minutes since the strike. */
export const BLOOD_UNIFORMS = { amount: uniform(0), ageMin: uniform(0) };

/**
 * Apply to a node material (character lane): colorNode / roughnessNode wrapped; returns false when the material
 * has no colorNode to wrap (plain map materials: the caller converts it first). No samplers are added.
 */
export function applyBlood(material: any, o: BloodMaskOptions & { thick: number }): boolean {
  if (!material?.isNodeMaterial) return false;
  const baseC = material.colorNode ?? (material.color ? vec3(material.color.r, material.color.g, material.color.b) : null);
  if (!baseC) return false;
  const baseR = material.roughnessNode ?? float(material.roughness ?? 0.8);
  const m = bloodMask(positionLocal, BLOOD_UNIFORMS.amount, o);
  const out = bloodOver(baseC.rgb ?? baseC, baseR, m, o.thick, BLOOD_UNIFORMS.ageMin);
  material.colorNode = out.color;
  material.roughnessNode = out.roughness;
  material.needsUpdate = true;
  return true;
}
