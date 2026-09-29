// Pure render step shared by offline.ts (browser), the tests and scratch WAV renders (Node):
// recipe → seeded channels → sanitised, edge-faded, peak-normalised to the recipe's level.

import { Rng, hashSeed, normalize, fadeEdges, type Channels } from './dsp.ts';
import { withDefaults, type Params, type Recipe } from './types.ts';

export const DEFAULT_LEVEL = 0.7;
/** Hard ceiling for any bank sound: -1 dBFS (headroom for inter-sample peaks after resampling). */
export const MAX_PEAK = 0.891;

/** Seed for (recipe, variant): stable across sessions so a given variant always sounds the same. */
export function variantSeed(id: string, variant: number, salt = 0): number {
  return (hashSeed(id) ^ Math.imul(variant + 1, 0x9e3779b1) ^ salt) >>> 0;
}

/** The sample rate a recipe actually renders at for a given context rate. */
export function effectiveRate(r: Recipe, contextRate: number): number {
  return Math.round(contextRate * Math.min(1, Math.max(0.25, r.renderRate ?? 1)));
}

export interface Rendered {
  id: string;
  variant: number;
  sampleRate: number;
  channels: Channels;
  ms: number;
}

export function renderRecipe(r: Recipe, sr: number, variant = 0, params?: Params, salt = 0): Rendered {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  sr = effectiveRate(r, sr);
  const rng = new Rng(variantSeed(r.id, variant, salt));
  const chs = r.gen(sr, rng, withDefaults(r, params));
  for (const c of chs) {
    for (let i = 0; i < c.length; i++) if (!Number.isFinite(c[i])) c[i] = 0;
    // loops must not be faded (it would put a dip at the seam); one-shots get click-free edges
    if (!r.loop) fadeEdges(c, sr, 0.5, 10);
  }
  // equalise channel lengths
  const len = Math.max(...chs.map((c) => c.length));
  const out = chs.map((c) => (c.length === len ? c : (() => { const x = new Float32Array(len); x.set(c); return x; })()));
  normalize(out, Math.min(MAX_PEAK, r.level ?? DEFAULT_LEVEL));
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { id: r.id, variant, sampleRate: sr, channels: out, ms: t1 - t0 };
}

/** 16-bit PCM WAV encoder (for scratch renders / debugging downloads from the lab). */
export function encodeWav(chs: Channels, sr: number): Uint8Array {
  const n = chs[0].length;
  const nc = chs.length;
  const bytes = 44 + n * nc * 2;
  const b = new Uint8Array(bytes);
  const v = new DataView(b.buffer);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * nc * 2, true); v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * nc * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
    const s = Math.max(-1, Math.min(1, chs[c][i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    o += 2;
  }
  return b;
}
