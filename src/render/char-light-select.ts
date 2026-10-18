// PERF round 2 (#150, ROADMAP ruling (aq) "per-character light cost"): which lights can reach a character this frame —
// PURE (no three.js; tests/perf-char-lights.test.ts). src/render/char-lights.ts opens / closes one uniform gate per light
// of the characters' FIXED light list from this (no LightsNode change → no program rebuild, ever).
//
// Exactness (a closed gate must change no pixel):
//   • punctual lights — three's falloff (LightUtils.getDistanceAttenuation, Frostbite eq. 26)
//         E ∝ I · saturate(1 − (d / cutoff)⁴)² / max(d^decay, 0.01)
//     is EXACTLY 0 at d ≥ cutoff, and the light colour uniform is colour × intensity, so a light at intensity 0 (or a
//     black colour) adds exactly 0 — every lighting model's direct() term is a product with lightColor (the physical
//     BRDF, sheen, clearcoat, and src/characters/skin.ts's wrap / translucency / strand lobes);
//   • a directional light has no falloff: open whenever it is lit;
//   • a probe grid (three/examples LightProbeGridNode) weights its irradiance by 1 − smoothstep(0, falloff, distance
//     outside its box) — EXACTLY 0 at ≥ falloff outside; with falloff 0 it applies everywhere (never closed); its
//     irradiance is × intensity.
// A light whose cutoff sphere (grid: box grown by the falloff) misses every subject sphere — bounds that contain every
// pixel of every mesh drawn with the list (each figure's bones + a margin for flesh, cloth, hair and hand-held props) —
// contributes nothing to any character pixel. The spot cone is not tested (conservative: open).

export interface LightCand {
  /** World position. */
  x: number;
  y: number;
  z: number;
  /** Intensity (three units) × max colour channel — 0 = dark. */
  intensity: number;
  /** Cutoff distance (0 = infinite, as in three). */
  distance: number;
  decay: number;
}

/** A sphere around (part of) a character, world space. */
export interface Subject {
  x: number;
  y: number;
  z: number;
  r: number;
}

/** Peak falloff of `c` over the subjects (three's attenuation at the nearest point of the nearest sphere); 0 = no reach. */
export function reachOf(c: LightCand, subs: readonly Subject[]): number {
  if (!(c.intensity > 0)) return 0;
  let best = 0;
  for (const s of subs) {
    const d = Math.max(0, Math.hypot(c.x - s.x, c.y - s.y, c.z - s.z) - s.r);
    if (c.distance > 0 && d >= c.distance) continue;
    let a = 1 / Math.max(Math.pow(d, c.decay), 0.01);
    if (c.distance > 0) {
      const q = 1 - Math.pow(d / c.distance, 4);
      a *= q * q;
    }
    best = Math.max(best, c.intensity * a);
  }
  return best;
}

/** An axis-aligned box (world), e.g. a probe grid's boundingBox. */
export interface Box {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

/** Distance from a point to a box (0 inside). */
export function boxDistance(b: Box, x: number, y: number, z: number): number {
  const dx = Math.max(b.min.x - x, 0, x - b.max.x);
  const dy = Math.max(b.min.y - y, 0, y - b.max.y);
  const dz = Math.max(b.min.z - z, 0, z - b.max.z);
  return Math.hypot(dx, dy, dz);
}

/**
 * Can a probe grid (box, smooth `falloff` m outside it, `intensity`) light any point of the subjects? falloff ≤ 0 =
 * the grid applies everywhere → always true while lit.
 */
export function gridReaches(b: Box, falloff: number, intensity: number, subs: readonly Subject[]): boolean {
  if (!(intensity > 0)) return false;
  if (!(falloff > 0)) return true;
  for (const s of subs) if (boxDistance(b, s.x, s.y, s.z) - s.r < falloff) return true;
  return false;
}
