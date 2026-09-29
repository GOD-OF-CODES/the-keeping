// Our own PERIODIC (tileable) noise for the texture baker, as TSL functions (docs/PLAN.md §2.5: three's mx_* noises
// have no period, so textures baked from them seam when tiled).
//
// Every primitive is a TSL Fn with setLayout(), so it is emitted ONCE per shader as a real function (the
// MaterialXNoise pattern) instead of being inlined at every call site — this keeps ~50 generator shaders small and
// fast to compile. fBm/ridged/warp are unrolled in JS over those functions.
//
// CPU twins live in noise-cpu.ts (identical formulas/constants); tests/materials-noise.test.ts checks periodicity
// there, and matlab compares the GPU hash bits against the CPU hash.
//
// Usage (tile space): uv ∈ [0,1)² covers one texture repeat. `gn(uv, [fx, fy], seed)` = gradient noise with fx × fy
// lattice cells per tile (integers), period fx × fy → tiles exactly.

import { Fn, abs, cos, dot, float, floor, max, min, mix, select, sin, sqrt, uint, vec2, vec4 } from 'three/tsl';
// NB: never chain .mix()/.smoothstep() — TSL's chained forms take `this` as the factor/x (mixElement(t, a, b)).
import { seedHash } from './noise-cpu.ts';

type N = any; // TSL node

// ---------------------------------------------------------------- hash ----------------------------------------

/** PCG hash (uint → uint). Mirrors noise-cpu.ts pcg(). */
export const tkPcg: (v: N) => N = Fn(([v]: [N]) => {
  const s = v.mul(uint(747796405)).add(uint(2891336453)).toVar();
  const w = s.shiftRight(s.shiftRight(uint(28)).add(uint(4))).bitXor(s).mul(uint(277803737)).toVar();
  return w.shiftRight(uint(22)).bitXor(w);
}).setLayout({ name: 'tk_pcg', type: 'uint', inputs: [{ name: 'v', type: 'uint' }] });

/** 2D lattice hash of wrapped integer coordinates (float-valued, ≥ 0) → uint. */
export const tkHash2u: (c: N, S: N) => N = Fn(([c, S]: [N, N]) => {
  return tkPcg(uint(c.x).add(tkPcg(uint(c.y).add(S))));
}).setLayout({ name: 'tk_hash2u', type: 'uint', inputs: [{ name: 'c', type: 'vec2' }, { name: 'S', type: 'uint' }] });

/** uint → [0,1) with 24 bits. */
export const u2f = (h: N): N => float(h.shiftRight(uint(8))).mul(1 / 16777216);

/** Hash of a wrapped lattice cell → [0,1). */
export const tkHash2f = (c: N, S: N): N => u2f(tkHash2u(c, S));

/** Hash of an arbitrary float value (e.g. a board index) → [0,1). Value is floored first. */
export function hashf(x: N, seed: number): N {
  return u2f(tkPcg(uint(floor(max(x, 0)).add(0.5)).add(uint(seedHash(seed)))));
}

/** Integer-lattice modulo into [0, m) (see noise-cpu.ts wrap). */
export const wrapI = (x: N, m: N): N => x.sub(m.mul(floor(x.add(0.5).div(m))));

const fade = (t: N): N => t.mul(t).mul(t).mul(t.mul(t.mul(6).sub(15)).add(10));
const TAU = 6.283185307179586;

// ---------------------------------------------------------------- value / gradient ---------------------------

/** Periodic value noise [0,1]. p in lattice units, per = period (cells). */
export const tkVnoise: (p: N, per: N, S: N) => N = Fn(([p, per, S]: [N, N, N]) => {
  const i = floor(p).toVar();
  const f = p.sub(i).toVar();
  const i0 = wrapI(i, per).toVar();
  const i1 = wrapI(i.add(1), per).toVar();
  const u = fade(f).toVar();
  const a = tkHash2f(i0, S);
  const b = tkHash2f(vec2(i1.x, i0.y), S);
  const c = tkHash2f(vec2(i0.x, i1.y), S);
  const d = tkHash2f(i1, S);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}).setLayout({ name: 'tk_vnoise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }, { name: 'per', type: 'vec2' }, { name: 'S', type: 'uint' }] });

const tkGrad: (c: N, S: N, d: N) => N = Fn(([c, S, d]: [N, N, N]) => {
  const a = tkHash2f(c, S).mul(TAU).toVar();
  return cos(a).mul(d.x).add(sin(a).mul(d.y));
}).setLayout({ name: 'tk_grad', type: 'float', inputs: [{ name: 'c', type: 'vec2' }, { name: 'S', type: 'uint' }, { name: 'd', type: 'vec2' }] });

/** Periodic gradient (Perlin) noise ≈[-1,1]. */
export const tkGnoise: (p: N, per: N, S: N) => N = Fn(([p, per, S]: [N, N, N]) => {
  const i = floor(p).toVar();
  const f = p.sub(i).toVar();
  const i0 = wrapI(i, per).toVar();
  const i1 = wrapI(i.add(1), per).toVar();
  const u = fade(f).toVar();
  const a = tkGrad(i0, S, f);
  const b = tkGrad(vec2(i1.x, i0.y), S, f.sub(vec2(1, 0)));
  const c = tkGrad(vec2(i0.x, i1.y), S, f.sub(vec2(0, 1)));
  const d = tkGrad(i1, S, f.sub(1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y).mul(1.4142135);
}).setLayout({ name: 'tk_gnoise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }, { name: 'per', type: 'vec2' }, { name: 'S', type: 'uint' }] });

// ---------------------------------------------------------------- Worley ------------------------------------

const tkFeature: (c: N, per: N, S: N, jitter: N) => N = Fn(([c, per, S, jitter]: [N, N, N, N]) => {
  const w = wrapI(c, per);
  const h = tkHash2u(w, S).toVar();
  const h2 = tkPcg(h).toVar();
  return vec4(u2f(h).sub(0.5).mul(jitter).add(0.5), u2f(h2).sub(0.5).mul(jitter).add(0.5), u2f(tkPcg(h2)), 0);
}).setLayout({ name: 'tk_feature', type: 'vec4', inputs: [{ name: 'c', type: 'vec2' }, { name: 'per', type: 'vec2' }, { name: 'S', type: 'uint' }, { name: 'jitter', type: 'float' }] });

/** Periodic Worley → vec4(F1, F2, cellId[0,1), edgeDistance). Lattice units. Mirrors noise-cpu.ts worley(). */
export const tkWorley: (p: N, per: N, S: N, jitter: N) => N = Fn(([p, per, S, jitter]: [N, N, N, N]) => {
  const i = floor(p).toVar();
  const f = p.sub(i).toVar();
  const f1 = float(8).toVar();
  const f2 = float(8).toVar();
  const id = float(0).toVar();
  const mr = vec2(0).toVar();
  const mg = vec2(0).toVar();
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      const g = vec2(x, y);
      const o = tkFeature(i.add(g), per, S, jitter).toVar();
      const r = g.add(o.xy).sub(f).toVar();
      const d = sqrt(dot(r, r)).toVar();
      const closer = d.lessThan(f1);
      f2.assign(min(f2, max(f1, d)));
      id.assign(select(closer, o.z, id));
      mr.assign(select(closer, r, mr));
      mg.assign(select(closer, g, mg));
      f1.assign(min(f1, d));
    }
  }
  const edge = float(8).toVar();
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      const g = mg.add(vec2(x, y)).toVar();
      const o = tkFeature(i.add(g), per, S, jitter);
      const r = g.add(o.xy).sub(f).toVar();
      const dd = r.sub(mr).toVar();
      const l2 = dot(dd, dd).toVar();
      const e = dot(mr.add(r).mul(0.5), dd).div(sqrt(max(l2, 1e-10)));
      edge.assign(select(l2.greaterThan(1e-5), min(edge, e), edge));
    }
  }
  return vec4(f1, f2, id, edge);
}).setLayout({ name: 'tk_worley', type: 'vec4', inputs: [{ name: 'p', type: 'vec2' }, { name: 'per', type: 'vec2' }, { name: 'S', type: 'uint' }, { name: 'jitter', type: 'float' }] });

// ---------------------------------------------------------------- tile-space wrappers ------------------------

export type Freq = number | [number, number];
const fv = (f: Freq): [number, number] => {
  const a: [number, number] = typeof f === 'number' ? [f, f] : f;
  return [Math.max(1, Math.round(a[0])), Math.max(1, Math.round(a[1]))];
};

/** Value noise [0,1] with freq integer cells per tile. */
export function vn(uv: N, freq: Freq, seed: number): N {
  const [fx, fy] = fv(freq);
  return tkVnoise(uv.mul(vec2(fx, fy)), vec2(fx, fy), uint(seedHash(seed)));
}

/** Gradient noise ≈[-1,1] with freq integer cells per tile. */
export function gn(uv: N, freq: Freq, seed: number): N {
  const [fx, fy] = fv(freq);
  return tkGnoise(uv.mul(vec2(fx, fy)), vec2(fx, fy), uint(seedHash(seed)));
}

/** Periodic fBm of gradient noise ≈[-1,1] (normalised by the amplitude sum). Mirrors noise-cpu.ts fbm(). */
export function fbm(uv: N, freq: Freq, octaves: number, seed: number, gain = 0.5): N {
  let [fx, fy] = fv(freq);
  let amp = 1;
  let norm = 0;
  let sum: N = null;
  for (let i = 0; i < octaves; i++) {
    const n = tkGnoise(uv.mul(vec2(fx, fy)), vec2(fx, fy), uint(seedHash(seed + i * 101))).mul(amp);
    sum = sum === null ? n : sum.add(n);
    norm += amp;
    amp *= gain;
    fx *= 2;
    fy *= 2;
  }
  return sum.mul(1 / norm);
}

/** Standard deviation of fbm() (≈0.19, measured in noise-cpu for 3–6 octaves). */
export const FBM_SD = 0.19;
/** fBm remapped to [0,1] with mean 0.5 and σ ≈ FBM01_SD (≈ normal; ~5 % clamps). */
export const FBM01_SD = 0.25;
export const fbm01 = (uv: N, freq: Freq, octaves: number, seed: number, gain = 0.5): N =>
  fbm(uv, freq, octaves, seed, gain).mul(FBM01_SD / FBM_SD).add(0.5).clamp(0, 1);

/** Ridged multifractal [0,1]. Mirrors noise-cpu.ts ridged(). */
export function ridged(uv: N, freq: Freq, octaves: number, seed: number, gain = 0.5): N {
  let [fx, fy] = fv(freq);
  let amp = 1;
  let norm = 0;
  let sum: N = null;
  for (let i = 0; i < octaves; i++) {
    const g = tkGnoise(uv.mul(vec2(fx, fy)), vec2(fx, fy), uint(seedHash(seed + i * 101)));
    const r = float(1).sub(abs(g));
    const n = r.mul(r).mul(amp);
    sum = sum === null ? n : sum.add(n);
    norm += amp;
    amp *= gain;
    fx *= 2;
    fy *= 2;
  }
  return sum.mul(1 / norm);
}

/** Worley in tile space → vec4(F1, F2, id, edge) (distances in lattice cells). */
export function worley(uv: N, freq: Freq, seed: number, jitter = 1): N {
  const [fx, fy] = fv(freq);
  return tkWorley(uv.mul(vec2(fx, fy)), vec2(fx, fy), uint(seedHash(seed)), float(jitter));
}

/** Periodic domain warp: uv + amp·(fbm, fbm). amp in tile units. Mirrors noise-cpu.ts warp(). */
export function warp(uv: N, freq: Freq, amp: number, octaves: number, seed: number): N {
  return uv.add(vec2(fbm(uv, freq, octaves, seed), fbm(uv, freq, octaves, seed + 7919)).mul(amp));
}
