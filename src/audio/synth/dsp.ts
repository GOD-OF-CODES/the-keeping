// Sample-level DSP toolkit for the synth recipes. Pure TypeScript (no Web Audio, no DOM) so every recipe runs in
// the browser (fed into AudioBuffers / OfflineAudioContext by src/audio/offline.ts) AND under Node for tests and the
// scratch WAV renders. Everything is deterministic given the seeded Rng.
//
// Technique references (all re-derived here, no code copied):
//  - A. Farnell, "Designing Sound" (MIT Press 2010): noise-shaped textures, modal bells, friction (stick-slip)
//    creaks, rain as sums of shaped droplet impulses, fire/engine "firing pulse" models.
//  - R. Bristow-Johnson, "Audio EQ Cookbook": biquad coefficients.
//  - P. Kellet: economy pink noise filter.

export type Channels = Float32Array[];

// ---------------------------------------------------------------- RNG

/** mulberry32 — small, fast, good enough for audio variation. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Uniform in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  /** Uniform in [-1, 1). */
  bi(): number {
    return this.next() * 2 - 1;
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  /** Approximate gaussian (Irwin–Hall, n=4). */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732;
  }
  /** Exponentially distributed interval with the given mean. */
  exp(mean: number): number {
    return -Math.log(1 - this.next()) * mean;
  }
  fork(salt: number): Rng {
    return new Rng(Math.imul((this.next() * 4294967296) >>> 0, 2654435761) ^ salt);
  }
}

/** FNV-1a string hash → 32-bit seed. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------- buffers

export const buf = (sr: number, seconds: number): Float32Array => new Float32Array(Math.max(1, Math.ceil(sr * seconds)));

export function mixInto(dst: Float32Array, src: Float32Array, offset = 0, gain = 1): void {
  const o = Math.max(0, Math.floor(offset));
  const n = Math.min(src.length, dst.length - o);
  for (let i = 0; i < n; i++) dst[o + i] += src[i] * gain;
}

export function scale(x: Float32Array, g: number): Float32Array {
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

export function peak(chs: Channels | Float32Array): number {
  const list = Array.isArray(chs) ? chs : [chs];
  let p = 0;
  for (const c of list) for (let i = 0; i < c.length; i++) {
    const a = Math.abs(c[i]);
    if (a > p) p = a;
  }
  return p;
}

export function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

/** Normalise every channel jointly to `target` peak (linear). Silent input stays silent. */
export function normalize(chs: Channels, target = 0.7071): Channels {
  const p = peak(chs);
  if (p > 1e-9) for (const c of chs) scale(c, target / p);
  return chs;
}

/** Short linear fades to kill clicks at the edges. */
export function fadeEdges(x: Float32Array, sr: number, inMs = 2, outMs = 8): Float32Array {
  const ni = Math.min(x.length, Math.floor((sr * inMs) / 1000));
  const no = Math.min(x.length, Math.floor((sr * outMs) / 1000));
  for (let i = 0; i < ni; i++) x[i] *= i / ni;
  for (let i = 0; i < no; i++) x[x.length - 1 - i] *= i / no;
  return x;
}

/** Make a buffer loop seamlessly: crossfade the last `xf` seconds into the head, then drop the tail. */
export function makeLoop(x: Float32Array, sr: number, xf: number): Float32Array {
  const n = Math.min(Math.floor(sr * xf), Math.floor(x.length / 3));
  const out = x.slice(0, x.length - n);
  for (let i = 0; i < n; i++) {
    const a = i / n; // equal-power
    const gi = Math.sin(a * Math.PI * 0.5);
    const go = Math.cos(a * Math.PI * 0.5);
    out[i] = out[i] * gi + x[x.length - n + i] * go;
  }
  return out;
}

/** Trim trailing near-silence (keeps at least `minSec`). */
export function trimTail(x: Float32Array, sr: number, thresh = 1e-4, minSec = 0.05): Float32Array {
  let end = x.length;
  while (end > sr * minSec && Math.abs(x[end - 1]) < thresh) end--;
  return end === x.length ? x : x.slice(0, end);
}

/** Linear-interpolating resample by `ratio` (>1 = higher pitch, shorter). */
export function resample(x: Float32Array, ratio: number): Float32Array {
  const n = Math.max(1, Math.floor(x.length / ratio));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ratio;
    const k = Math.floor(p);
    const f = p - k;
    out[i] = (x[k] ?? 0) * (1 - f) + (x[k + 1] ?? 0) * f;
  }
  return out;
}

/** Mono → stereo with a tiny decorrelating delay / level offset for width. */
export function widen(x: Float32Array, sr: number, rng: Rng, widthMs = 0.6): Channels {
  const d = Math.floor((sr * widthMs * rng.range(0.4, 1)) / 1000);
  const l = x.slice();
  const r = new Float32Array(x.length);
  for (let i = d; i < x.length; i++) r[i] = x[i - d];
  const tilt = rng.range(-0.08, 0.08);
  scale(l, 1 + tilt);
  scale(r, 1 - tilt);
  return [l, r];
}

// ---------------------------------------------------------------- noise

export function white(n: number, rng: Rng): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = rng.bi();
  return x;
}

/** Paul Kellet's economy pink filter (−3 dB/oct), ~unit peak. */
export function pink(n: number, rng: Rng): Float32Array {
  const x = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = rng.bi();
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    x[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
  }
  return x;
}

/** Leaky-integrated white (−6 dB/oct). */
export function brown(n: number, rng: Rng): Float32Array {
  const x = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) {
    y = 0.995 * y + rng.bi() * 0.1;
    x[i] = y;
  }
  return x;
}

/** Smooth random control signal: value noise sampled every `rateHz`, cosine-interpolated, in [-1, 1]. */
export function smoothNoise(n: number, sr: number, rateHz: number, rng: Rng): Float32Array {
  const x = new Float32Array(n);
  const step = sr / Math.max(0.01, rateHz);
  let a = rng.bi();
  let b = rng.bi();
  let t = 0;
  for (let i = 0; i < n; i++) {
    const f = t / step;
    const m = (1 - Math.cos(f * Math.PI)) * 0.5;
    x[i] = a + (b - a) * m;
    t++;
    if (t >= step) {
      t -= step;
      a = b;
      b = rng.bi();
    }
  }
  return x;
}

// ---------------------------------------------------------------- filters

export type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'peaking' | 'lowshelf' | 'highshelf' | 'notch';

/** RBJ cookbook biquad, transposed direct form II. Coefficients can be retuned per sample (`set`). */
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private z1 = 0; private z2 = 0;
  private type: BiquadType;
  private sr: number;
  constructor(type: BiquadType, sr: number, freq: number, q = 0.7071, gainDb = 0) {
    this.type = type;
    this.sr = sr;
    this.set(freq, q, gainDb);
  }
  set(freq: number, q = 0.7071, gainDb = 0): void {
    const f = Math.min(Math.max(freq, 5), this.sr * 0.49);
    const w = (2 * Math.PI * f) / this.sr;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const alpha = sw / (2 * Math.max(q, 1e-3));
    const A = Math.pow(10, gainDb / 40);
    let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
    switch (this.type) {
      case 'lowpass': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'highpass': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'bandpass': b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break; // 0 dB peak
      case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha; break;
      case 'peaking': b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A; break;
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * cw + s); b1 = 2 * A * (A - 1 - (A + 1) * cw); b2 = A * (A + 1 - (A - 1) * cw - s);
        a0 = A + 1 + (A - 1) * cw + s; a1 = -2 * (A - 1 + (A + 1) * cw); a2 = A + 1 + (A - 1) * cw - s;
        break;
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cw + s); b1 = -2 * A * (A - 1 + (A + 1) * cw); b2 = A * (A + 1 + (A - 1) * cw - s);
        a0 = A + 1 - (A - 1) * cw + s; a1 = 2 * (A - 1 - (A + 1) * cw); a2 = A + 1 - (A - 1) * cw - s;
        break;
      }
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  tick(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  run(x: Float32Array): Float32Array {
    for (let i = 0; i < x.length; i++) x[i] = this.tick(x[i]);
    return x;
  }
}

/** In-place biquad pass (convenience). */
export function filt(x: Float32Array, type: BiquadType, sr: number, freq: number, q = 0.7071, gainDb = 0): Float32Array {
  return new Biquad(type, sr, freq, q, gainDb).run(x);
}

/** Time-varying biquad: frequency follows `freqAt(i)` (recomputed every 32 samples). */
export function sweep(x: Float32Array, type: BiquadType, sr: number, freqAt: (i: number) => number, q = 0.7071, gainDb = 0): Float32Array {
  const bq = new Biquad(type, sr, freqAt(0), q, gainDb);
  for (let i = 0; i < x.length; i++) {
    if ((i & 31) === 0) bq.set(freqAt(i), q, gainDb);
    x[i] = bq.tick(x[i]);
  }
  return x;
}

export class OnePole {
  private y = 0;
  private a: number;
  constructor(sr: number, cutoff: number) {
    this.a = Math.exp((-2 * Math.PI * cutoff) / sr);
  }
  setCutoff(sr: number, cutoff: number): void {
    this.a = Math.exp((-2 * Math.PI * cutoff) / sr);
  }
  lp(x: number): number {
    this.y = x + this.a * (this.y - x);
    return this.y;
  }
}

/** Feedback comb / delay line (for tubes, cavities, cheap resonances). */
export class Delay {
  private b: Float32Array;
  private w = 0;
  constructor(maxSamples: number) {
    this.b = new Float32Array(Math.max(2, Math.ceil(maxSamples) + 2));
  }
  read(d: number): number {
    const len = this.b.length;
    let p = this.w - d;
    while (p < 0) p += len;
    const k = Math.floor(p);
    const f = p - k;
    return this.b[k % len] * (1 - f) + this.b[(k + 1) % len] * f;
  }
  write(x: number): void {
    this.b[this.w] = x;
    this.w = (this.w + 1) % this.b.length;
  }
}

export function comb(x: Float32Array, sr: number, freq: number, fb: number, damp = 0.3): Float32Array {
  const d = new Delay(sr / 20 + 4);
  const period = sr / freq;
  let lp = 0;
  for (let i = 0; i < x.length; i++) {
    const y = d.read(period);
    lp = lp + (y - lp) * (1 - damp);
    d.write(x[i] + lp * fb);
    x[i] = y;
  }
  return x;
}

// ---------------------------------------------------------------- envelopes & shapes

/** Exponential decay envelope multiplied in place: time constant `tau` seconds, starting at sample `start`. */
export function expDecay(x: Float32Array, sr: number, tau: number, start = 0): Float32Array {
  const k = Math.exp(-1 / (sr * tau));
  let g = 1;
  for (let i = 0; i < x.length; i++) {
    if (i < start) {
      x[i] = 0;
      continue;
    }
    x[i] *= g;
    g *= k;
  }
  return x;
}

/** Attack–decay envelope value at time t (s): linear attack, exponential decay. */
export function adEnv(t: number, attack: number, tau: number): number {
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  return Math.exp(-(t - attack) / tau);
}

/** Piecewise-linear envelope from [time, value] points. */
export function envAt(t: number, pts: readonly (readonly [number, number])[]): number {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [t0, v0] = pts[i - 1];
      const [t1, v1] = pts[i];
      return v0 + ((v1 - v0) * (t - t0)) / Math.max(1e-9, t1 - t0);
    }
  }
  return pts[pts.length - 1][1];
}

export function applyEnv(x: Float32Array, sr: number, pts: readonly (readonly [number, number])[]): Float32Array {
  for (let i = 0; i < x.length; i++) x[i] *= envAt(i / sr, pts);
  return x;
}

export const softclip = (v: number, drive = 1): number => Math.tanh(v * drive) / Math.tanh(drive);

export function shape(x: Float32Array, drive: number): Float32Array {
  for (let i = 0; i < x.length; i++) x[i] = softclip(x[i], drive);
  return x;
}

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(1e-12, g));

// ---------------------------------------------------------------- modal synthesis

export interface Mode {
  freq: number;
  /** Amplitude. */
  amp: number;
  /** T60-style decay time constant (s). */
  decay: number;
  /** Initial phase (radians). */
  phase?: number;
}

/**
 * Sum of exponentially decaying sinusoids (Farnell ch. "Bells"/"Modal synthesis"): each mode is a damped
 * resonance of the struck body. Computed with a rotating phasor (no per-sample sin()).
 */
export function modal(n: number, sr: number, modes: readonly Mode[], startSample = 0): Float32Array {
  const out = new Float32Array(n);
  for (const m of modes) {
    if (m.freq <= 0 || m.freq >= sr * 0.48) continue;
    const w = (2 * Math.PI * m.freq) / sr;
    const cr = Math.cos(w);
    const sn = Math.sin(w);
    let re = Math.cos(m.phase ?? 0) * m.amp;
    let im = Math.sin(m.phase ?? 0) * m.amp;
    const k = Math.exp(-1 / (sr * m.decay));
    for (let i = startSample; i < n; i++) {
      out[i] += im;
      const r2 = (re * cr - im * sn) * k;
      im = (re * sn + im * cr) * k;
      re = r2;
      if (Math.abs(re) + Math.abs(im) < 1e-6) break;
    }
  }
  return out;
}

/**
 * Excite a bank of resonators (2-pole bandpass filters) with an arbitrary signal. Unlike `modal`, the excitation
 * shapes the response (scrapes, rubbing, rain on a panel).
 */
export function resonate(x: Float32Array, sr: number, modes: readonly { freq: number; q: number; gain: number }[]): Float32Array {
  const out = new Float32Array(x.length);
  for (const m of modes) {
    const bq = new Biquad('bandpass', sr, m.freq, m.q);
    for (let i = 0; i < x.length; i++) out[i] += bq.tick(x[i]) * m.gain;
  }
  return out;
}

// ---------------------------------------------------------------- impulses

/** A single short noise burst ("tick"): used for droplets, grains, clicks. */
export function click(sr: number, rng: Rng, durMs: number, color: 'white' | 'pink' = 'white'): Float32Array {
  const n = Math.max(4, Math.floor((sr * durMs) / 1000));
  const x = color === 'pink' ? pink(n, rng) : white(n, rng);
  return expDecay(x, sr, durMs / 1000 / 4);
}

/** A damped sine "blip" with a downward pitch glide (droplet bubble: Minnaert resonance, Farnell "Water"). */
export function blip(sr: number, f0: number, f1: number, dur: number, amp = 1): Float32Array {
  const n = Math.max(4, Math.floor(sr * dur));
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const f = f0 * Math.pow(f1 / f0, t);
    ph += (2 * Math.PI * f) / sr;
    const env = Math.sin(Math.min(1, t * 12) * Math.PI * 0.5) * Math.exp(-t * 5);
    x[i] = Math.sin(ph) * env * amp;
  }
  return x;
}

// ---------------------------------------------------------------- friction

/**
 * Stick-slip friction (Farnell "Creaking door", after the elasto-plastic friction idea): a slowly driven
 * contact point stores tension until it exceeds the static-friction threshold, then slips, emitting an impulse.
 * The impulse train (rate set by drive speed and pressure) excites the body's resonances. Returns the impulse
 * train only; callers push it through `resonate`/`modal`.
 *
 * @param speedAt   relative drive speed (0..1+) at sample i
 * @param pressureAt normal force (0..1+) at sample i — raises the threshold, lowers the rate, makes slips bigger
 */
export function stickSlip(n: number, sr: number, rng: Rng, speedAt: (i: number) => number, pressureAt: (i: number) => number, baseRate = 220): Float32Array {
  const out = new Float32Array(n);
  let tension = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.max(0, speedAt(i));
    const p = Math.max(0.05, pressureAt(i));
    tension += (v * baseRate) / sr;
    const threshold = p * (0.85 + 0.3 * rng.next());
    if (tension >= threshold) {
      const slip = tension * (0.6 + 0.4 * rng.next());
      out[i] += slip * (0.7 + 0.3 * p);
      tension -= slip;
    }
  }
  return out;
}

// ---------------------------------------------------------------- misc

/** Linear ramp helper. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** Sum stereo into mono. */
export function toMono(chs: Channels): Float32Array {
  if (chs.length === 1) return chs[0];
  const n = chs[0].length;
  const out = new Float32Array(n);
  for (const c of chs) for (let i = 0; i < n; i++) out[i] += c[i] / chs.length;
  return out;
}

/** Scatter `count` copies of `make()` over [0, len) with exponential intervals (Poisson process). */
export function scatter(dst: Float32Array, sr: number, rng: Rng, ratePerSec: number, make: (rng: Rng) => { x: Float32Array; gain: number }): void {
  let t = rng.exp(1 / ratePerSec);
  while (t * sr < dst.length) {
    const { x, gain } = make(rng);
    mixInto(dst, x, t * sr, gain);
    t += rng.exp(1 / ratePerSec);
  }
}
