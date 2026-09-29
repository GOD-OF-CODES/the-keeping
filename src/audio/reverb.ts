// Procedural room impulse responses from the layout's { size, damping, wet } (RoomDef.reverb).
//
// Model (a synthetic "Schroeder/Moorer"-style IR, generated sample by sample — no recorded IRs exist here):
//  - pre-delay ≈ the first reflection path (size / c, capped),
//  - a handful of discrete early reflections whose spacing scales with room size,
//  - a late tail of decorrelated noise with exponential energy decay set by RT60,
//  - frequency-dependent absorption: a one-pole lowpass whose cutoff falls over the tail (soft rooms — curtains,
//    beds, sacks — eat highs faster; `damping` 0 = bare plaster/boards, 1 = very soft / open air),
//  - L/R from independent noise (decorrelation = width).
// Pure: runs under Node for tests; `createConvolver` wraps it for Web Audio.

import { Rng, OnePole, hashSeed } from './synth/dsp.ts';

export interface ReverbParams {
  /** Characteristic room dimension (m) — the layout's `size`. */
  size: number;
  /** 0 = hard/live .. 1 = dead/soft. */
  damping: number;
  /** Suggested wet send level 0..1. */
  wet: number;
}

export interface ImpulseResponse {
  sampleRate: number;
  channels: [Float32Array, Float32Array];
  rt60: number;
  preDelay: number;
  wet: number;
}

const SPEED_OF_SOUND = 343;

/** RT60 (s) estimate: grows with size, shrinks with damping. Tiny closets ~0.25 s; the 9 m hall ~1.2 s. */
export function rt60For(p: ReverbParams): number {
  const s = Math.max(0.5, p.size);
  const base = 0.12 + 0.34 * Math.sqrt(s) - 0.02 * Math.max(0, s - 12) * 0.5;
  const d = Math.min(1, Math.max(0, p.damping));
  return Math.min(3.2, Math.max(0.15, base * (1.35 - 0.95 * d)));
}

export function generateIR(p: ReverbParams, sampleRate: number, seed?: number): ImpulseResponse {
  const rng = new Rng(seed ?? hashSeed(`ir:${p.size}:${p.damping}`));
  const rt60 = rt60For(p);
  const preDelay = Math.min(0.035, Math.max(0.002, (p.size * 0.5) / SPEED_OF_SOUND));
  const len = Math.max(Math.floor(sampleRate * 0.2), Math.floor(sampleRate * (preDelay + rt60 * 1.05)));
  const pre = Math.floor(preDelay * sampleRate);
  // energy decays 60 dB over rt60 → amplitude factor per sample
  const k = Math.pow(10, -3 / (rt60 * sampleRate));
  const d = Math.min(1, Math.max(0, p.damping));
  const fc0 = 9000 - 4500 * d; // brightness of the first reflections
  const fcEnd = 900 - 500 * d; // what's left at the end of the tail
  const chans: Float32Array[] = [];
  for (let c = 0; c < 2; c++) {
    const r = rng.fork(c + 1);
    const x = new Float32Array(len);
    const lp = new OnePole(sampleRate, fc0);
    let g = 1;
    // late tail (starts shortly after pre-delay, diffuse build-up over ~size/c*2)
    const build = Math.max(1, Math.floor(((p.size * 2) / SPEED_OF_SOUND) * sampleRate));
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre);
      if ((i & 63) === 0) lp.setCutoff(sampleRate, fc0 * Math.pow(fcEnd / fc0, t));
      const ramp = Math.min(1, (i - pre) / build);
      x[i] = lp.lp(r.bi()) * g * ramp;
      g *= k;
    }
    // early reflections
    const count = 6 + Math.round(Math.min(8, p.size));
    for (let e = 0; e < count; e++) {
      const delay = preDelay + (r.range(0.3, 2.2) * p.size) / SPEED_OF_SOUND;
      const at = Math.floor(delay * sampleRate);
      if (at >= len) continue;
      const amp = r.range(0.3, 0.9) * Math.pow(k, at - pre) * (r.next() < 0.5 ? -1 : 1) * (1.2 - 0.6 * d);
      x[at] += amp * 1.5;
      if (at + 1 < len) x[at + 1] += amp * 0.6;
    }
    chans.push(x);
  }
  // unit-energy normalisation (per channel average) so the convolver's level is independent of RT60
  let e = 0;
  for (const x of chans) for (let i = 0; i < x.length; i++) e += x[i] * x[i];
  const norm = 1 / Math.sqrt(Math.max(1e-12, e / 2));
  for (const x of chans) for (let i = 0; i < x.length; i++) x[i] *= norm;
  return { sampleRate, channels: [chans[0], chans[1]], rt60, preDelay, wet: p.wet };
}

/** Build a ConvolverNode (normalize=false: the IR is already unit-energy). */
export function createConvolver(ctx: BaseAudioContext, p: ReverbParams, seed?: number): ConvolverNode {
  const ir = generateIR(p, ctx.sampleRate, seed);
  const b = ctx.createBuffer(2, ir.channels[0].length, ctx.sampleRate);
  b.copyToChannel(ir.channels[0] as Float32Array<ArrayBuffer>, 0);
  b.copyToChannel(ir.channels[1] as Float32Array<ArrayBuffer>, 1);
  const conv = ctx.createConvolver();
  conv.normalize = false;
  conv.buffer = b;
  return conv;
}

/**
 * A room reverb "send": input → convolver → wet gain → output. One per room; sources in a room send to it, the
 * engine crossfades the listener's room and occludes other rooms' returns like any source.
 */
export class RoomReverb {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly params: ReverbParams;
  private conv: ConvolverNode;
  constructor(ctx: BaseAudioContext, p: ReverbParams, seed?: number) {
    this.params = p;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    // the unit-energy IR is loud relative to a dry signal; 0.35 lands `wet` roughly at its intended send level
    this.output.gain.value = p.wet * 0.35;
    this.conv = createConvolver(ctx, p, seed);
    this.input.connect(this.conv).connect(this.output);
  }
  dispose(): void {
    this.input.disconnect();
    this.conv.disconnect();
    this.output.disconnect();
  }
}
