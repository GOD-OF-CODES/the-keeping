// Shared TSL building blocks for the material generators (tile space, periodic — see tsl-noise.ts).
// Every helper takes the tile uv and returns nodes; frequencies are integer cells per tile (ctx.cells(sizeM)).

import { abs, exp, float, floor, fract, max, min, mix, smoothstep, vec2, vec3 } from 'three/tsl';
import type { GenCtx, GenResult, N, RGB } from '../gen-types.ts';
import { fbm, fbm01, gn, hashf, worley } from '../tsl-noise.ts';
import { coverThreshold } from '../noise-cpu.ts';

export const c3 = (c: RGB): N => vec3(c[0], c[1], c[2]);
export const lum = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
export const scale3 = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
export const lerp3 = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Falling smoothstep: 1 for x ≤ lo, 0 for x ≥ hi (never pass smoothstep reversed edges: undefined in WGSL/GLSL). */
export const smoothDown = (hi: number | N, lo: number | N, x: N): N => float(1).sub(smoothstep(lo, hi, x));

/** smooth band: 1 inside [a,b] with soft edges of width w. */
export const band = (x: N, a: number | N, b: number | N, w: number): N => smoothstep(float(a).sub(w), float(a).add(w), x).mul(float(1).sub(smoothstep(float(b).sub(w), float(b).add(w), x)));

/** Thin lines along the zero-crossings of an anisotropic noise (scratches, cracks, fibres). width in noise units. */
export function lines(uv: N, freq: [number, number], width: number, seed: number): N {
  return float(1).sub(smoothstep(0, width, abs(gn(uv, freq, seed))));
}

/** Sparse mask: 1 where fbm01 exceeds 1-coverage (soft). */
export function patches(uv: N, freq: number | [number, number], coverage: number, softness: number, seed: number, octaves = 4): N {
  if (coverage <= 0) return float(0);
  const n = fbm01(uv, freq, octaves, seed);
  const t = coverThreshold(coverage);
  return smoothstep(t - softness, t + softness, n);
}

/**
 * Natural grime/corrosion mask: a low-frequency coverage field broken up by fine noise at the edge, so the
 * boundary is speckled and eroded instead of a clean blob. coverage ≈ area fraction.
 */
export function grunge(c: GenCtx, sizeM: number, coverage: number, seed: number, breakup = 0.45): N {
  if (coverage <= 0) return float(0);
  const lo = fbm01(c.uv, c.cells(sizeM), 4, seed);
  const hi = fbm01(c.uv, c.cells(sizeM / 10), 4, seed + 1);
  const n = lo.add(hi.sub(0.5).mul(breakup));
  const t = coverThreshold(coverage, 0.25 * Math.sqrt(1 + breakup * breakup));
  return smoothstep(t - 0.04, t + 0.04, n);
}

/**
 * Water stain / tide mark: blotch interior (slightly darker/tinted) plus a darker crisp rim where the water front
 * dried, with 1–2 inner tide rings. Returns { body, rim }.
 */
export function tideStain(uv: N, freq: number | [number, number], coverage: number, seed: number): { body: N; rim: N } {
  const n = fbm01(uv, freq, 5, seed);
  const t = coverThreshold(coverage);
  const body = smoothstep(t - 0.01, t + 0.03, n);
  const d1 = n.sub(t).div(0.012);
  const d2 = n.sub(t + 0.07).div(0.01);
  const rim = exp(d1.mul(d1).negate()).add(exp(d2.mul(d2).negate()).mul(0.5)).clamp(0, 1);
  return { body, rim };
}

/** Cracks from Worley cell edges, warped, masked to a coverage. Returns 0..1 crack intensity. */
export function cracks(uv: N, cells: number, widthCells: number, coverage: number, seed: number): N {
  const wuv = uv.add(vec2(fbm(uv, cells, 3, seed + 3), fbm(uv, cells, 3, seed + 5)).mul(0.35 / cells));
  const w = worley(wuv, cells, seed, 0.9);
  const line = float(1).sub(smoothstep(0, widthCells, w.w));
  const mask = patches(uv, Math.max(1, Math.round(cells / 3)), coverage * 0.45, 0.06, seed + 9, 3);
  return line.mul(mask);
}

// ---------------------------------------------------------------- boards -----------------------------------

export interface Boards {
  row: N; // row index (float)
  id: N; // per-board hash 0..1
  id2: N; // second independent per-board hash
  along: N; // 0..1 along the board
  across: N; // 0..1 across the board
  lenM: N; // board length (m)
  widthM: number; // effective board width (m)
  gap: N; // 1 in the gap between boards
  edge: N; // metres to the nearest board edge
  rows: number;
}

/**
 * Floorboard layout in tile space: boards run along u; `rows` = integer rows per tile; each row gets 1..k boards
 * per tile with a random joint offset (tile-safe: joints repeat with the tile).
 */
export function boards(c: GenCtx, widthM: number, lenMin: number, lenMax: number, gapM: number, seed: number): Boards {
  const rows = c.cells(widthM);
  const widthE = c.tile / rows;
  const nMin = Math.max(1, Math.round(c.tile / lenMax));
  const nMax = Math.max(nMin, Math.round(c.tile / lenMin));
  const v = c.uv.y.mul(rows);
  const row = floor(v);
  const across = fract(v);
  const hr = hashf(row, seed);
  const n = floor(mix(float(nMin), float(nMax + 1), hashf(row, seed + 1)).min(nMax));
  const s = c.uv.x.add(hr).mul(n);
  const along = fract(s);
  const idx = floor(s).sub(n.mul(floor(floor(s).add(0.5).div(n)))); // wrap into [0, n)
  const key = row.mul(64).add(idx);
  const id = hashf(key, seed + 2);
  const id2 = hashf(key, seed + 3);
  const lenM = float(c.tile).div(n);
  const dAcross = min(across, float(1).sub(across)).mul(widthE);
  const dAlong = min(along, float(1).sub(along)).mul(lenM);
  const edge = min(dAcross, dAlong);
  const gap = float(1).sub(smoothstep(gapM * 0.35, gapM, edge));
  return { row, id, id2, along, across, lenM, widthM: widthE, gap, edge, rows };
}

// ---------------------------------------------------------------- wood grain -------------------------------

export interface GrainOpts {
  ringsPerBoard: number; // growth rings visible across one board width
  contrast: number; // 0..1
  seed: number;
  figure?: number; // cathedral arch strength
  pores?: number; // oak pore streak strength
}

/**
 * Wood grain as a cone section: each board is cut from a log whose pith lies `D` below the face at an across-offset,
 * rings grow outward with a taper along the length. Where the flat face slices the rings you get cathedral arches;
 * boards with a far pith read as straight (quarter-ish) grain. Ring spacing is irregular (noise on the ring index).
 * Returns 0..1 latewood darkness, fibre streaks, and the ring phase. Tile-periodic (noise in tile space).
 */
export function woodGrain(c: GenCtx, b: Boards, o: GrainOpts): { late: N; streak: N; ring: N } {
  const uv = c.uv;
  const spacing = b.widthM / Math.max(1, o.ringsPerBoard); // metres per ring
  // Per-board log geometry.
  const pithAcross = b.id.mul(2.2).sub(0.6); // in board widths (−0.6 … 1.6): arches or straight
  const depth = b.id2.mul(b.id2).mul(0.12).add(0.012); // m below the face
  const taper = hashf(b.row.mul(131).add(b.id.mul(977)), o.seed + 7).mul(0.02).add(0.004).mul(o.figure ?? 2.5).mul(0.5); // m radius per m length
  const x = b.across.sub(pithAcross).mul(b.widthM);
  const z = b.along.sub(hashf(b.row.mul(17).add(b.id2.mul(313)), o.seed + 8)).mul(b.lenM);
  const r = x.mul(x).add(depth.mul(depth)).sqrt().sub(z.mul(taper));
  // Irregular growth: slow waviness + ring-to-ring spacing jitter.
  const wav = fbm(uv, [c.cells(0.6), Math.max(1, Math.round(b.rows / 2))], 3, o.seed).mul(0.8);
  const ringCoord = r.div(spacing).add(wav).add(b.id.mul(31));
  const jitter = gn(vec2(ringCoord.mul(0.37), b.id.mul(7)), [64, 8], o.seed + 9).mul(0.18);
  const ring = fract(ringCoord.add(jitter));
  // earlywood (wide, light) → latewood (narrow, dark), sharp return at the ring boundary.
  // Broad soft rise into the latewood, crisp drop back to earlywood at the ring boundary.
  const late = smoothstep(0.3, 0.86, ring).pow(1.6).mul(float(1).sub(smoothstep(0.9, 0.995, ring)));
  // Fine fibre streaks (long along u, very thin across).
  const sAlong = c.cells(0.35);
  const sAcross = Math.min(c.cells(0.0016), Math.round(c.size * 0.7));
  const streak = gn(uv, [sAlong, sAcross], o.seed + 11).mul(0.5).add(gn(uv, [sAlong * 2, Math.round(sAcross / 2)], o.seed + 12).mul(0.5));
  let pores: N = float(0);
  if (o.pores) {
    const pAlong = c.cells(0.02);
    pores = smoothstep(0.35, 0.8, gn(uv, [pAlong, sAcross], o.seed + 13)).mul(late.mul(0.5).add(0.5)).mul(o.pores);
  }
  // Oak medullary flecks on boards cut near the quarter (pith far below): short light dashes.
  return { late: late.mul(o.contrast), streak: streak.mul(o.contrast * 0.5).add(pores.mul(-0.6)), ring };
}

// ---------------------------------------------------------------- paint / chips / speckle -----------------

/** 45°-rotated tile coordinate (still tile-periodic: a unit shift maps to an integer lattice shift). */
export const rot45 = (uv: N): N => vec2(uv.x.add(uv.y), uv.x.sub(uv.y));

/**
 * Octave count for an fbm whose BASE frequency is `freq` cells/tile, capped so the top octave stays at or below the
 * texel Nyquist limit (size/2 cells). The baker point-samples each texel: anything finer aliases into a regular
 * lattice that shows as a faint square grid when the tile is magnified ~1:1 (clapboard under the torch, round D).
 */
export function nyqOctaves(c: GenCtx, freq: number | [number, number], octaves: number): number {
  const f = Array.isArray(freq) ? Math.max(freq[0], freq[1]) : freq;
  let n = octaves;
  while (n > 1 && f * 2 ** (n - 1) > c.size / 2) n--;
  return n;
}

/**
 * Chipped / flaking paint mask: 1 where paint is MISSING. Irregular warped flakes plus small pop-off chips.
 * `amount` 0..1 ≈ area fraction. `sizeM` ≈ flake size in metres.
 */
export function chipMask(c: GenCtx, amount: number, sizeM: number, seed: number, aniso: [number, number] = [1, 1]): N {
  if (amount <= 0) return float(0);
  // aniso stretches flakes: [4, 1] = flakes 4× longer along u (paint peeling along the grain).
  const f: [number, number] = [c.cells(sizeM * 4 * aniso[0]), c.cells(sizeM * 4 * aniso[1])];
  const wuv = c.uv.add(vec2(fbm(c.uv, [f[0] * 2, f[1] * 2], 3, seed + 1), fbm(c.uv, [f[0] * 2, f[1] * 2], 3, seed + 2)).mul(vec2(0.25 / f[0], 0.25 / f[1])));
  const n = fbm01(wuv, f, 6, seed + 3, 0.55);
  const t = coverThreshold(amount * 0.85);
  const big = smoothstep(t, t + 0.015, n);
  const w = worley(c.uv, [c.cells(sizeM * 0.6 * aniso[0]), c.cells(sizeM * 0.6 * aniso[1])], seed + 4, 1);
  const small = float(1).sub(smoothstep(0.18, 0.24, w.x)).mul(smoothstep(1 - amount * 0.5, 1, w.z));
  return max(big, small);
}

/** Dots: small round spots (nail heads, flecks, fly specks). radius in cells (0..0.5). density 0..1 of cells. */
export function dots(uv: N, cells: number, radius: number, density: number, seed: number): { mask: N; id: N; d: N } {
  const w = worley(uv, cells, seed, 0.8);
  const on = smoothstep(1 - density - 0.001, 1 - density, w.z);
  const m = float(1).sub(smoothstep(radius * 0.7, radius, w.x)).mul(on);
  return { mask: m, id: w.z, d: w.x.div(radius) };
}

/**
 * A paint layer over a substrate: brush-stroke streaks along `dir`, chipped areas show `under`.
 * Returns albedo/roughness/height contributions and the chip mask (1 = bare).
 */
export function paintOver(
  c: GenCtx,
  o: { color: RGB; under: N; underRough: N; chip: number; chipSizeM: number; gloss: number; dir: 'u' | 'v'; seed: number; thicknessFrac?: number; aniso?: [number, number] },
): { albedo: N; rough: N; height: N; chip: N } {
  const along = c.cells(0.25);
  // Brush ridges ≈ 2.5 mm, but both octaves stay at or below the texel Nyquist limit (size/2 cells): the old cap
  // (0.6·size, octave 2 at 1.2·size) aliased into a regular grid on magnified siding.
  const across = Math.min(c.cells(0.0025), Math.floor(c.size * 0.25));
  const f: [number, number] = o.dir === 'u' ? [along, across] : [across, along];
  const brush = gn(c.uv, f, o.seed + 21).mul(0.6).add(gn(c.uv, [f[0] * 2, f[1] * 2], o.seed + 22).mul(0.4));
  const mott = fbm(c.uv, c.cells(0.3), 4, o.seed + 23);
  const chip = chipMask(c, o.chip, o.chipSizeM, o.seed + 30, o.aniso);
  const paintAlb = c3(o.color).mul(brush.mul(0.035).add(mott.mul(0.07)).add(1));
  const paintRough = float(1 - o.gloss * 0.85).add(mott.mul(0.06)).add(brush.mul(0.03));
  const albedo = mix(paintAlb, o.under, chip);
  const rough = mix(paintRough, o.underRough, chip);
  const th = o.thicknessFrac ?? 0.35;
  const height = float(1 - th).add(float(th).mul(float(1).sub(chip))).add(brush.mul(0.02));
  return { albedo, rough, height, chip };
}

// ---------------------------------------------------------------- generic ----------------------------------

/** Fallback for any family without a dedicated generator: avgAlbedo with mottling. */
export function genericGenerator(c: GenCtx): GenResult {
  const s = c.spec;
  const n = fbm(c.uv, c.cells(0.25), 5, c.seed);
  const fine = gn(c.uv, c.cells(0.01), c.seed + 1);
  const a = c3(s.avgAlbedo as RGB).mul(n.mul(0.18).add(1).add(fine.mul(0.05)));
  return { albedo: a, roughness: float(s.roughness).add(n.mul(0.06)), height: n.mul(0.5).add(0.5), heightDepthM: 0.0006, cavity: 0.2, extra: float(s.metalness) };
}

export { max, abs, floor, fract, float, vec2, vec3, mix, smoothstep, min, exp };
