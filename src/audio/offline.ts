// Bank prerender: every one-shot recipe × its seeded variants → AudioBuffers, during the loading screen.
//
// Pipeline per variant: pure DSP recipe (src/audio/synth, seeded) → AudioBuffer → an OfflineAudioContext
// "variation pass" (seeded playback-rate jitter + a gentle peaking-EQ tilt, so even variants that share a structure
// differ in pitch and colour the way repeated real-world actions do) → final AudioBuffer at the realtime context's
// sample rate (no runtime resampling). Loops skip the variation pass (it would break the seam).
// Work is chunked with macrotask yields so the loading UI keeps painting; progress = variants done / total.

import { RECIPES, getRecipe } from './synth/index.ts';
import { renderRecipe, variantSeed } from './synth/render.ts';
import { Rng } from './synth/dsp.ts';
import type { Params, Recipe } from './synth/types.ts';

export type Bank = Map<string, AudioBuffer[]>;

export interface PrerenderOptions {
  /** Only these recipe ids (default: every recipe with preload !== false). */
  ids?: readonly string[];
  /** 0..1 progress + a label for the loading screen. */
  onProgress?: (fraction: number, label: string) => void;
  /** Apply the OfflineAudioContext variation pass (default true). */
  variationPass?: boolean;
  /** Overrides the per-recipe variant count (e.g. 2 on the Low preset to save memory/time). */
  maxVariants?: number;
  /** Extra params per recipe id. */
  params?: Record<string, Params>;
}

export interface PrerenderTiming {
  totalMs: number;
  perRecipe: { id: string; variants: number; ms: number; seconds: number }[];
  bytes: number;
}

const yieldToUI = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof MessageChannel !== 'undefined') {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => resolve();
      ch.port2.postMessage(0);
    } else setTimeout(resolve, 0);
  });

function toBuffer(ctx: BaseAudioContext, chs: Float32Array[], sr: number): AudioBuffer {
  const b = ctx.createBuffer(chs.length, chs[0].length, sr);
  chs.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return b;
}

/** Seeded variation pass in an OfflineAudioContext. Falls back to the dry buffer when unavailable. */
async function variationPass(src: AudioBuffer, r: Recipe, variant: number): Promise<AudioBuffer> {
  const OAC: typeof OfflineAudioContext | undefined = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!OAC || r.loop || r.variants <= 1) return src;
  const rng = new Rng(variantSeed(r.id, variant, 0x51ed));
  const rate = 1 + rng.range(-0.035, 0.035);
  const len = Math.ceil(src.length / rate) + 16;
  const oc = new OAC(src.numberOfChannels, len, src.sampleRate);
  const s = oc.createBufferSource();
  s.buffer = src;
  s.playbackRate.value = rate;
  const eq = oc.createBiquadFilter();
  eq.type = 'peaking';
  eq.frequency.value = rng.range(400, 4000);
  eq.Q.value = 0.9;
  eq.gain.value = rng.range(-2.5, 2.5);
  s.connect(eq).connect(oc.destination);
  s.start(0);
  try {
    return await oc.startRendering();
  } catch {
    return src;
  }
}

/** Render one recipe's variants. Used by the prerender and for lazy (preload:false) sounds. */
export async function renderVariants(ctx: BaseAudioContext, id: string, opts: { variants?: number; params?: Params; variationPass?: boolean } = {}): Promise<AudioBuffer[]> {
  const r = getRecipe(id);
  const count = Math.max(1, opts.variants ?? r.variants);
  const out: AudioBuffer[] = [];
  for (let v = 0; v < count; v++) {
    const res = renderRecipe(r, ctx.sampleRate, v, opts.params);
    const dry = toBuffer(ctx, res.channels, res.sampleRate);
    out.push(opts.variationPass === false ? dry : await variationPass(dry, r, v));
  }
  return out;
}

export async function prerenderBanks(ctx: BaseAudioContext, opts: PrerenderOptions = {}): Promise<{ bank: Bank; timing: PrerenderTiming }> {
  const t0 = performance.now();
  const list: Recipe[] = opts.ids ? opts.ids.map(getRecipe) : RECIPES.filter((r) => r.preload !== false);
  const counts = list.map((r) => Math.max(1, Math.min(r.variants, opts.maxVariants ?? r.variants)));
  const total = counts.reduce((a, b) => a + b, 0);
  const bank: Bank = new Map();
  const perRecipe: PrerenderTiming['perRecipe'] = [];
  let done = 0;
  let bytes = 0;
  let lastYield = performance.now();
  for (let k = 0; k < list.length; k++) {
    const r = list[k];
    const tr = performance.now();
    const bufs: AudioBuffer[] = [];
    for (let v = 0; v < counts[k]; v++) {
      const res = renderRecipe(r, ctx.sampleRate, v, opts.params?.[r.id]);
      const dry = toBuffer(ctx, res.channels, res.sampleRate);
      const b = opts.variationPass === false ? dry : await variationPass(dry, r, v);
      bufs.push(b);
      bytes += b.length * b.numberOfChannels * 4;
      done++;
      if (performance.now() - lastYield > 12) {
        opts.onProgress?.(done / total, r.label);
        await yieldToUI();
        lastYield = performance.now();
      }
    }
    bank.set(r.id, bufs);
    perRecipe.push({ id: r.id, variants: bufs.length, ms: performance.now() - tr, seconds: bufs.reduce((a, b) => a + b.duration, 0) });
  }
  opts.onProgress?.(1, 'Sound ready');
  const timing: PrerenderTiming = { totalMs: performance.now() - t0, perRecipe, bytes };
  const slowest = [...perRecipe].sort((a, b) => b.ms - a.ms).slice(0, 5).map((p) => `${p.id} ${p.ms.toFixed(0)}ms`).join(', ');
  console.info(
    `[audio] prerendered ${perRecipe.length} sounds / ${total} variants in ${timing.totalMs.toFixed(0)} ms ` +
      `(${(bytes / 1048576).toFixed(1)} MB @ ${ctx.sampleRate} Hz). Slowest: ${slowest}`,
  );
  return { bank, timing };
}
