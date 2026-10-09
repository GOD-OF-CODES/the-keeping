// Prop wear rules (docs/PROPS-FINISH.md §2.2) — pure data, no three import (unit-tested under node).
//
// Blender bakes per-vertex masks into COLOR_0 ('wear': R edge, G cavity, B handled, A dust; already scaled by the
// prop's wear_age / grime_age / use / dust_age). The runtime (wear.ts) turns them into material change with ONE shader
// structure for every family: each family is only a different set of numbers (uniforms), so masked materials of
// different specs still share GPU programs (PERF-PLAN P1-6a).
//
// A layer moves the surface toward a target where its amount is 1:
//   albedo → mix(albedo × mul, rgb, abs)   (abs 0 = tint the base, 1 = replace by a physical colour)
//   rough  → mix(rough + dRough, rough target, rAbs)
//   metal  → mix(metal, metal target, mAbs)
//   desat  → mix toward the luminance by `desat`
// Values are albedo (linear) / roughness / metalness; sources are given per family.

import type { MaterialFamily, MaterialSpec } from '../shared/material-types.ts';

export type RGB = [number, number, number];

export interface WearLayer {
  mul: RGB;
  rgb: RGB;
  abs: number;
  rough: number;
  dRough: number;
  rAbs: number;
  metal: number;
  mAbs: number;
  desat: number;
}

export interface WearRule {
  /** Rule name (the family class). */
  kind: string;
  /** Edge: chip threshold on E·(0.55 + 0.45·noise) (= 1 − coverage), smoothstep half-width (0.04 hard chip, 0.15 soft abrasion). */
  edgeCov: number;
  edgeWidth: number;
  /** Chip noise frequency (1/m, object space). */
  chipFreq: number;
  edge: WearLayer;
  /** Second, deeper layer at a higher threshold (painted wood: primer → bare wood). cov2 > 1 = off. */
  cov2: number;
  edge2: WearLayer;
  /** Chip rim (a band just outside the chip): rimAmt 0 = off. */
  rimRGB: RGB;
  rimAmt: number;
  handled: WearLayer;
  /** Cavity coverage scale (0 = off) and the layer. */
  cavAmt: number;
  cavity: WearLayer;
  /** Rust-bloom cavity breakup (Worley) on metals — Medium/Max only. */
  cellular: boolean;
  /** Dust amount when the spec has none (§2.3, §8 R2 default 0.5), and a family multiplier (fabric traps it ×1.3). */
  dustDefault: number;
  dustScale: number;
  /** Albedo ceiling after wear (§2.5: bare wood ≤ 0.35, primer ≤ 0.65; tint layers on bright bases never exceed it). */
  cap: number;
}

const ID: RGB = [1, 1, 1];
const L = (o: Partial<WearLayer>): WearLayer => ({ mul: ID, rgb: [0, 0, 0], abs: 0, rough: 0, dRough: 0, rAbs: 0, metal: 0, mAbs: 0, desat: 0, ...o });
const NONE = L({});
// Rust (Fe2O3 / FeOOH, albedo 0.1–0.3): (0.29, 0.13, 0.06) × 0.6, rough 0.85, non-metal.
const RUST = L({ rgb: [0.174, 0.078, 0.036], abs: 1, rough: 0.85, rAbs: 1, metal: 0, mAbs: 1 });

const base = (kind: string, o: Partial<WearRule>): WearRule => ({
  kind, edgeCov: 0.45, edgeWidth: 0.04, chipFreq: 220, edge: NONE, cov2: 2, edge2: NONE, rimRGB: [0, 0, 0], rimAmt: 0,
  handled: NONE, cavAmt: 0, cavity: NONE, cellular: false, dustDefault: 0.5, dustScale: 1, cap: 0.95, ...o,
});

/** §2.2 table. */
export const WEAR_RULES: Record<string, WearRule> = {
  // Old oil enamel over lead-white primer (0.60 / 0.85) over weathered pine (0.28 / 0.75); chips 1–5 mm (f 220 /m).
  painted: base('painted', {
    edge: L({ rgb: [0.6, 0.59, 0.55], abs: 1, rough: 0.85, rAbs: 1 }),
    cov2: 0.62, edge2: L({ rgb: [0.28, 0.24, 0.19], abs: 1, rough: 0.75, rAbs: 1 }),
    rimRGB: [0.1, 0.085, 0.07], rimAmt: 0.25, cap: 0.65,
    handled: L({ mul: [0.85, 0.8, 0.72], dRough: -0.15 }),
    cavAmt: 1, cavity: L({ mul: [0.55, 0.55, 0.55], dRough: 0.1 }),
  }),
  // Varnish abrades (soft, not flaking): walnut/oak under worn varnish ×1.9 albedo, rough 0.25 → 0.55. Hands re-polish
  // (skin oil + wax: ×0.85, rough 0.22). Joints: old wax + dust ×0.45, rough 0.6.
  varnish: base('varnish', {
    edgeWidth: 0.15, chipFreq: 60,
    edge: L({ mul: [1.9, 1.9, 1.9], rough: 0.55, rAbs: 1 }),
    handled: L({ mul: [0.85, 0.85, 0.85], rough: 0.22, rAbs: 1 }),
    cavAmt: 1, cavity: L({ mul: [0.45, 0.45, 0.45], rough: 0.6, rAbs: 1 }), cap: 0.35,
  }),
  // Raw/sawn wood: arrises lighter (UV-greyed lignin worn off) ×1.15; hands darken ×0.7, rough −0.15; dirt ×0.6.
  raw_wood: base('raw_wood', {
    edgeWidth: 0.15, chipFreq: 60,
    edge: L({ mul: [1.15, 1.15, 1.15], dRough: 0.05 }),
    handled: L({ mul: [0.7, 0.68, 0.66], dRough: -0.15 }),
    cavAmt: 1, cavity: L({ mul: [0.6, 0.6, 0.6] }), cap: 0.45,
  }),
  // Steel: fresh-ground edge F0 ≈ 0.56 (Gulbrandsen), rough 0.1–0.2; handled polish 0.18; rust bloom in crevices.
  steel: base('steel', {
    edgeWidth: 0.12, chipFreq: 90,
    edge: L({ rgb: [0.56, 0.56, 0.56], abs: 1, rough: 0.12, rAbs: 1, metal: 1, mAbs: 1 }),
    handled: L({ rough: 0.18, rAbs: 1 }),
    cavAmt: 1, cavity: RUST, cellular: true,
  }),
  // Galvanised zinc: polished edges brighter, cavities white rust (zinc hydroxide/carbonate ≈ 0.6 grey-white).
  zinc: base('zinc', {
    edgeWidth: 0.12, chipFreq: 90,
    edge: L({ rgb: [0.6, 0.61, 0.62], abs: 1, rough: 0.25, rAbs: 1, metal: 1, mAbs: 1 }),
    handled: L({ rough: 0.3, rAbs: 1 }),
    cavAmt: 0.7, cavity: L({ rgb: [0.55, 0.55, 0.52], abs: 1, rough: 0.9, rAbs: 1, metal: 0, mAbs: 1 }), cellular: true,
  }),
  // Cast iron: stove blacking (0.04–0.06 / 0.55–0.7) worn to bare iron 0.45 grey, metal 0.8, rough 0.35; rust × 0.6.
  cast_iron: base('cast_iron', {
    edgeWidth: 0.12, chipFreq: 90,
    edge: L({ rgb: [0.45, 0.45, 0.45], abs: 1, rough: 0.35, rAbs: 1, metal: 0.8, mAbs: 1 }),
    handled: L({ rough: 0.3, rAbs: 1 }),
    cavAmt: 0.6, cavity: RUST, cellular: true,
  }),
  // Rusted sheet steel (rust spec): only the hardest-worn edges reach bare steel; hands polish to dark steel.
  rust: base('rust', {
    edgeCov: 0.6, edgeWidth: 0.05, chipFreq: 160,
    edge: L({ rgb: [0.32, 0.31, 0.3], abs: 1, rough: 0.4, rAbs: 1, metal: 0.8, mAbs: 1 }),
    handled: L({ rgb: [0.22, 0.2, 0.19], abs: 1, rough: 0.35, rAbs: 1, metal: 0.7, mAbs: 1 }),
    cavAmt: 1, cavity: L({ mul: [0.6, 0.55, 0.5], rough: 0.9, rAbs: 1 }), cellular: true,
  }),
  // Brass: polished F0 (0.91, 0.78, 0.42) rough 0.15; handled 0.12; tarnish Cu2O/CuCO3 (0.08, 0.07, 0.04) / 0.6 / 0.3.
  brass: base('brass', {
    edgeWidth: 0.15, chipFreq: 60,
    edge: L({ rgb: [0.91, 0.78, 0.42], abs: 1, rough: 0.15, rAbs: 1, metal: 1, mAbs: 1 }),
    handled: L({ rgb: [0.91, 0.78, 0.42], abs: 0.8, rough: 0.12, rAbs: 1, metal: 1, mAbs: 1 }),
    cavAmt: 1, cavity: L({ rgb: [0.08, 0.07, 0.04], abs: 1, rough: 0.6, rAbs: 1, metal: 0.3, mAbs: 1 }),
  }),
  // Vitreous enamel: chips to black iron (0.04 / 0.5 / metal 0.6), f 160 /m, with a 0.3 mm rust halo (0.25, 0.11, 0.05).
  enamel: base('enamel', {
    chipFreq: 160,
    edge: L({ rgb: [0.04, 0.04, 0.04], abs: 1, rough: 0.5, rAbs: 1, metal: 0.6, mAbs: 1 }),
    rimRGB: [0.25, 0.11, 0.05], rimAmt: 0.9,
    cavAmt: 1, cavity: RUST, cellular: true,
  }),
  // Painted sheet steel (car bodies, jerry cans): chip to red-oxide primer (0.30, 0.12, 0.07) / 0.7, then bare steel
  // 0.5 / 0.4 / metal 1 above 0.85; handles polished to bare steel 0.3; rust in seams.
  // Round E (look round 2): the first numbers read as pale pink edges on the jerry cans — red-oxide primer is a dark
  // brick (Fe2O3 pigment in oil ≈ 0.15, 0.055, 0.03 linear) and bare steel on a 30-year-old can is a dull grey-brown
  // (oxide film ≈ 0.22 / 0.5), polished only where hands grip (0.35, rough 0.3).
  painted_steel: base('painted_steel', {
    chipFreq: 160,
    edge: L({ rgb: [0.15, 0.055, 0.03], abs: 1, rough: 0.7, rAbs: 1 }),
    cov2: 0.72, edge2: L({ rgb: [0.22, 0.2, 0.18], abs: 1, rough: 0.5, rAbs: 1, metal: 1, mAbs: 1 }),
    handled: L({ rgb: [0.35, 0.34, 0.33], abs: 0.7, rough: 0.3, rAbs: 1, metal: 1, mAbs: 0.7 }),
    cavAmt: 1, cavity: RUST, cellular: true,
  }),
  // Leather: scuffed edges lighter ×1.35, rough +0.15, 30 % desaturated; handled darker ×0.75 glossier 0.35.
  leather: base('leather', {
    edgeWidth: 0.15, chipFreq: 120,
    edge: L({ mul: [1.35, 1.35, 1.35], dRough: 0.15, desat: 0.3 }),
    handled: L({ mul: [0.75, 0.75, 0.75], rough: 0.35, rAbs: 1 }),
    cavAmt: 1, cavity: L({ mul: [0.6, 0.6, 0.6] }), cap: 0.35,
  }),
  // Textiles: pilling / nap loss ×1.08, 15 % desat, rough 1.0; use-shine ×0.85, rough −0.2; stains tinted (0.62,
  // 0.52, 0.38)-ish ×0.7; dust ×1.3 (fabric traps it).
  fabric: base('fabric', {
    edgeWidth: 0.15, chipFreq: 120,
    edge: L({ mul: [1.08, 1.08, 1.08], rough: 1, rAbs: 1, desat: 0.15 }),
    handled: L({ mul: [0.85, 0.85, 0.85], dRough: -0.2 }),
    cavAmt: 1, cavity: L({ mul: [0.72, 0.62, 0.48] }),
    dustScale: 1.3, cap: 0.85,
  }),
  // Props AD review (round E): the wedding gown has stood on a board floor for ~30 years — the hem (wear.py
  // FLOOR_GRIME band) and the deep folds carry floor dirt and dust wicked into the weave. Soiled ivory satin measures
  // ≈ 0.25–0.3 albedo against 0.55 clean, i.e. ×0.48/0.42/0.33 (warm grey-brown); the generic fabric grime (×0.72)
  // read as only a ≈ 15 % gradient at 1–2 m (scratch/pe-review/hemcrop*.jpg).
  fabric_soiled: base('fabric', {
    edgeWidth: 0.15, chipFreq: 120,
    edge: L({ mul: [1.08, 1.08, 1.08], rough: 1, rAbs: 1, desat: 0.15 }),
    handled: L({ mul: [0.85, 0.85, 0.85], dRough: -0.2 }),
    cavAmt: 1, cavity: L({ mul: [0.48, 0.42, 0.33], dRough: 0.15 }),
    dustScale: 1.3, cap: 0.85,
  }),
  // Paper: edge soil / foxing ×0.88 tinted (0.95, 0.88, 0.75); thumb soil ×0.8 grey; no dust (read while held).
  paper: base('paper', {
    edgeWidth: 0.15, chipFreq: 400,
    edge: L({ mul: [0.84, 0.77, 0.66] }),
    handled: L({ mul: [0.8, 0.8, 0.8] }),
    dustDefault: 0, dustScale: 0, cap: 0.85,
  }),
  // Rubber: worn rubber greys (oxidised bloom) ×1.25, rough +0.1; handled ×0.9 slicker; dirt in grooves ×0.7.
  rubber: base('rubber', {
    edgeWidth: 0.15, chipFreq: 120,
    edge: L({ mul: [1.25, 1.25, 1.25], dRough: 0.1 }),
    handled: L({ mul: [0.9, 0.9, 0.9], dRough: -0.1 }),
    cavAmt: 1, cavity: L({ mul: [0.7, 0.68, 0.64] }), cap: 0.3,
  }),
};

const FAMILY_RULE: Partial<Record<MaterialFamily, string>> = {
  wood_painted: 'painted', trim_paint: 'painted',
  wood_bare: 'varnish', wood_floor: 'varnish',
  chrome: 'steel', zinc: 'zinc', cast_iron: 'cast_iron', rust: 'rust', metal_brass: 'brass', enamel: 'enamel',
  car_paint: 'painted_steel', leather: 'leather',
  rug: 'fabric', fabric: 'fabric', crepe: 'fabric', burlap: 'fabric', flannel: 'fabric', nightgown: 'fabric', car_interior: 'fabric',
  paper: 'paper', rubber: 'rubber',
};
/** Spec ids that override their family's rule. */
const ID_RULE: Record<string, string | null> = {
  wood_raw_plank: 'raw_wood', plywood_weathered: 'raw_wood', floor_bare: 'raw_wood', stair_rough: 'raw_wood',
  paint_steel_can: 'painted_steel', paint_steel_sign: 'painted_steel', wood_weathered_post: 'raw_wood',
  wedding_satin: 'fabric_soiled',
  styrofoam: null, plastic_cluster: null, plastic_wheel_tan: null,
};

/** The wear rule for a spec, or null (glass, skin, hair, ground, house envelope, wax, rope… — §2.2 last row). */
export function wearRuleFor(spec: Pick<MaterialSpec, 'id' | 'family'>): WearRule | null {
  const name = spec.id in ID_RULE ? ID_RULE[spec.id] : FAMILY_RULE[spec.family];
  return name ? WEAR_RULES[name] : null;
}

/** Spec dust amount for a masked mesh (§2.3): the spec's own dust params, else the family default. */
export function wearDustAmount(spec: Pick<MaterialSpec, 'params'>, rule: WearRule): number {
  const p = spec.params as Record<string, unknown>;
  const own = Math.max(Number(p.dust ?? 0), Number(p.cobwebDust ?? 0), Number(p.dustOnTop ?? 0));
  return (own > 0 ? own : rule.dustDefault) * rule.dustScale;
}

/** CPU reference of the chip threshold (§2.1) — the TSL in wear.ts mirrors it. */
export function chipAmount(E: number, noise01: number, cov: number, width: number): number {
  const x = E * (0.55 + 0.45 * noise01);
  const t = Math.min(1, Math.max(0, (x - (cov - width)) / (2 * width)));
  return t * t * (3 - 2 * t);
}

/** CPU reference of one layer applied to (albedo, rough, metal) by amount a. */
export function applyLayerCpu(alb: RGB, rough: number, metal: number, Ly: WearLayer, a: number): { alb: RGB; rough: number; metal: number } {
  const t: RGB = [0, 1, 2].map((i) => alb[i] * Ly.mul[i] * (1 - Ly.abs) + Ly.rgb[i] * Ly.abs) as RGB;
  const lum = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
  const d: RGB = t.map((c) => c + (lum - c) * Ly.desat) as RGB;
  const r = (rough + Ly.dRough) * (1 - Ly.rAbs) + Ly.rough * Ly.rAbs;
  return {
    alb: [0, 1, 2].map((i) => alb[i] + (d[i] - alb[i]) * a) as RGB,
    rough: rough + (r - rough) * a,
    metal: metal + (Ly.metal - metal) * Ly.mAbs * a,
  };
}
