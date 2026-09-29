// CPU mirrors of the periodic (tileable) noise in tsl-noise.ts — plain TypeScript, NO three.js import, so the node
// tests (node --experimental-strip-types) can check periodicity/range, and matlab can compare GPU hash bits with
// these. Every formula here must stay identical to its TSL twin (same constants, same operation order).
//
// Conventions (shared with tsl-noise.ts):
//  - Noise is evaluated at p = uv · freq with an integer period = freq (cells per tile), so the result tiles on the
//    unit square exactly. fBm doubles freq AND period per octave (lacunarity 2 is the only tile-safe lacunarity).
//  - Lattice coordinates are wrapped with a float modulo, then converted to uint and hashed with PCG.
//  - seed → S = pcg(seed) is precomputed in JS and baked into the shader as a constant.

export type V2 = [number, number];

// ---------------------------------------------------------------- hash ----------------------------------------

/** PCG-RXS-M-XS 32-bit hash (Jarzynski & Olano 2020). All arithmetic mod 2^32. */
export function pcg(v: number): number {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> (((s >>> 28) + 4) >>> 0)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

/** Seed pre-hash (JS side). */
export const seedHash = (seed: number): number => pcg(Math.round(seed) >>> 0);

/** 2D lattice hash: pcg(x + pcg(y + S)). x, y are non-negative integers (already wrapped). */
export function hash2u(x: number, y: number, S: number): number {
  return pcg(((x >>> 0) + pcg(((y >>> 0) + S) >>> 0)) >>> 0);
}

/** uint → [0, 1) with 24 bits. */
export const u2f = (h: number): number => (h >>> 8) * (1 / 16777216);

export const hash2f = (x: number, y: number, S: number): number => u2f(hash2u(x, y, S));

/** Integer-lattice modulo into [0, m) (x, m integers). `+0.5` makes floor() immune to fp32 error at exact multiples.
 *  Mirrors TSL `x - m*floor((x+0.5)/m)`. */
export const wrap = (x: number, m: number): number => x - m * Math.floor((x + 0.5) / m);

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------------------------------------------------------------- value / gradient noise --------------------

/** Periodic value noise in [0,1]. p in lattice units, period in cells (integers). */
export function vnoise(p: V2, per: V2, S: number): number {
  const ix = Math.floor(p[0]);
  const iy = Math.floor(p[1]);
  const fx = p[0] - ix;
  const fy = p[1] - iy;
  const x0 = wrap(ix, per[0]);
  const y0 = wrap(iy, per[1]);
  const x1 = wrap(ix + 1, per[0]);
  const y1 = wrap(iy + 1, per[1]);
  const ux = fade(fx);
  const uy = fade(fy);
  const a = hash2f(x0, y0, S);
  const b = hash2f(x1, y0, S);
  const c = hash2f(x0, y1, S);
  const d = hash2f(x1, y1, S);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

const TAU = 6.283185307179586;

function grad(x: number, y: number, S: number, dx: number, dy: number): number {
  const a = hash2f(x, y, S) * TAU;
  return Math.cos(a) * dx + Math.sin(a) * dy;
}

/** Periodic gradient (Perlin) noise, ≈[-1,1] (scaled by √2). */
export function gnoise(p: V2, per: V2, S: number): number {
  const ix = Math.floor(p[0]);
  const iy = Math.floor(p[1]);
  const fx = p[0] - ix;
  const fy = p[1] - iy;
  const x0 = wrap(ix, per[0]);
  const y0 = wrap(iy, per[1]);
  const x1 = wrap(ix + 1, per[0]);
  const y1 = wrap(iy + 1, per[1]);
  const ux = fade(fx);
  const uy = fade(fy);
  const a = grad(x0, y0, S, fx, fy);
  const b = grad(x1, y0, S, fx - 1, fy);
  const c = grad(x0, y1, S, fx, fy - 1);
  const d = grad(x1, y1, S, fx - 1, fy - 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy) * 1.4142135;
}

// ---------------------------------------------------------------- fractal ----------------------------------

export interface FbmOpts {
  octaves: number;
  gain?: number; // amplitude per octave (default 0.5)
  seed: number;
}

/** Periodic fBm of gradient noise at uv (tile space), base frequency freq (integer cells/tile). ≈[-1,1]. */
export function fbm(uv: V2, freq: V2, o: FbmOpts): number {
  const gain = o.gain ?? 0.5;
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let fx = freq[0];
  let fy = freq[1];
  for (let i = 0; i < o.octaves; i++) {
    sum += amp * gnoise([uv[0] * fx, uv[1] * fy], [fx, fy], seedHash(o.seed + i * 101));
    norm += amp;
    amp *= gain;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

/** Ridged multifractal (periodic), [0,1]. */
export function ridged(uv: V2, freq: V2, o: FbmOpts): number {
  const gain = o.gain ?? 0.5;
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let fx = freq[0];
  let fy = freq[1];
  for (let i = 0; i < o.octaves; i++) {
    const n = 1 - Math.abs(gnoise([uv[0] * fx, uv[1] * fy], [fx, fy], seedHash(o.seed + i * 101)));
    sum += amp * n * n;
    norm += amp;
    amp *= gain;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------------- Worley / Voronoi -------------------------

export interface WorleyResult {
  f1: number;
  f2: number;
  id: number; // [0,1) hash of the nearest cell
  edge: number; // distance to the nearest Voronoi edge (lattice units)
}

/** Feature point of lattice cell (cx, cy) in [0,1)² + a third hash (the cell id). */
function feature(cx: number, cy: number, per: V2, S: number, jitter: number): [number, number, number] {
  const wx = wrap(cx, per[0]);
  const wy = wrap(cy, per[1]);
  const h = hash2u(wx, wy, S);
  const h2 = pcg(h);
  return [0.5 + (u2f(h) - 0.5) * jitter, 0.5 + (u2f(h2) - 0.5) * jitter, u2f(pcg(h2))];
}

/** Periodic Worley: F1, F2, nearest-cell id, and edge distance (two-pass, Quilez). */
export function worley(p: V2, per: V2, S: number, jitter = 1): WorleyResult {
  const ix = Math.floor(p[0]);
  const iy = Math.floor(p[1]);
  const fx = p[0] - ix;
  const fy = p[1] - iy;
  let f1 = 8;
  let f2 = 8;
  let id = 0;
  let mrx = 0;
  let mry = 0;
  let mgx = 0;
  let mgy = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const o = feature(ix + i, iy + j, per, S, jitter);
      const rx = i + o[0] - fx;
      const ry = j + o[1] - fy;
      const d = Math.sqrt(rx * rx + ry * ry);
      const h = o[2];
      f2 = Math.min(f2, Math.max(f1, d));
      if (d < f1) {
        id = h;
        mrx = rx;
        mry = ry;
        mgx = i;
        mgy = j;
      }
      f1 = Math.min(f1, d);
    }
  }
  let edge = 8;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = mgx + i;
      const gy = mgy + j;
      const o = feature(ix + gx, iy + gy, per, S, jitter);
      const rx = gx + o[0] - fx;
      const ry = gy + o[1] - fy;
      const dx = rx - mrx;
      const dy = ry - mry;
      const l2 = dx * dx + dy * dy;
      if (l2 > 1e-5) {
        const l = Math.sqrt(l2);
        const e = (0.5 * (mrx + rx) * dx + 0.5 * (mry + ry) * dy) / l;
        edge = Math.min(edge, e);
      }
    }
  }
  return { f1, f2, id, edge };
}

// ---------------------------------------------------------------- domain warp ------------------------------

/** Periodic domain warp in tile space: uv + amp · (fbm_x, fbm_y). amp in tile units. */
export function warp(uv: V2, freq: V2, amp: number, o: FbmOpts): V2 {
  const wx = fbm(uv, freq, o);
  const wy = fbm(uv, freq, { ...o, seed: o.seed + 7919 });
  return [uv[0] + amp * wx, uv[1] + amp * wy];
}

// ---------------------------------------------------------------- colour helpers (shared) -------------------

/** sRGB (display) → linear, per channel. Used for spec params named *_srgb. */
export const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const srgbToLinear3 = (c: number[]): [number, number, number] => [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];

/** Integer cells per tile for a feature of `sizeM` metres on a `tileM` tile (≥1). */
export const cellsPerTile = (tileM: number, sizeM: number): number => Math.max(1, Math.round(tileM / sizeM));

/** Inverse standard-normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function invNorm(p: number): number {
  const q0 = Math.min(1 - 1e-9, Math.max(1e-9, p));
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (q0 < pl) {
    const q = Math.sqrt(-2 * Math.log(q0));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (q0 > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - q0));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = q0 - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** fbm01 threshold that leaves `coverage` (0..1) of the area above it (fbm01 ≈ N(0.5, sd)). */
export const coverThreshold = (coverage: number, sd = 0.25): number => 0.5 + sd * invNorm(1 - Math.min(0.999, Math.max(0.001, coverage)));
