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
import type { SynthJob, SynthReply } from './synth-worker.ts';

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

/**
 * Fix round 2 (audio): one module Worker that runs the pure-JS synth for lazy sounds off the main thread
 * (see synth-worker.ts for the measured stalls it removes). Jobs are serial (one worker = one core; the M1 has 4
 * efficiency cores free while the game renders). Falls back to the main thread when Worker is unavailable (Node tests).
 */
export class SynthWorker {
  private w: Worker | null = null;
  private seq = 0;
  private jobs = new Map<number, { id: string; resolve: (r: { channels: Float32Array[]; sampleRate: number }) => void; reject: (e: Error) => void }>();
  /** Worker-side synth time per job (ms) — what the main thread no longer pays. */
  readonly log: { id: string; ms: number }[] = [];

  static available(): boolean {
    return typeof Worker !== 'undefined';
  }

  private worker(): Worker {
    if (this.w) return this.w;
    const w = new Worker(new URL('./synth-worker.ts', import.meta.url), { type: 'module', name: 'synth' });
    w.onmessage = (e: MessageEvent<SynthReply>) => {
      const m = e.data;
      const j = this.jobs.get(m.job);
      if (!j) return;
      this.jobs.delete(m.job);
      if (m.ok) {
        this.log.push({ id: j.id, ms: Math.round(m.ms) });
        j.resolve({ channels: m.channels, sampleRate: m.sampleRate });
      }
      else j.reject(new Error(m.error));
    };
    w.onerror = (e) => {
      // a dead worker must never leave a sound pending forever: fail every job (callers fall back to main thread)
      for (const j of this.jobs.values()) j.reject(new Error(`synth worker: ${e.message || 'error'}`));
      this.jobs.clear();
      this.w = null;
    };
    this.w = w;
    return w;
  }

  render(id: string, variant: number, sampleRate: number, params?: Params): Promise<{ channels: Float32Array[]; sampleRate: number }> {
    const job = ++this.seq;
    return new Promise((resolve, reject) => {
      this.jobs.set(job, { id, resolve, reject });
      const msg: SynthJob = { job, id, variant, sampleRate, params };
      this.worker().postMessage(msg);
    });
  }

  dispose(): void {
    this.w?.terminate();
    this.w = null;
    for (const j of this.jobs.values()) j.reject(new Error('synth worker disposed'));
    this.jobs.clear();
  }
}

/** Render one recipe's variants. Used by the prerender and for lazy (preload:false) sounds. */
export async function renderVariants(
  ctx: BaseAudioContext,
  id: string,
  opts: { variants?: number; params?: Params; variationPass?: boolean; worker?: SynthWorker | null; noFallback?: boolean } = {},
): Promise<AudioBuffer[]> {
  const r = getRecipe(id);
  const count = Math.max(1, opts.variants ?? r.variants);
  const out: AudioBuffer[] = [];
  for (let v = 0; v < count; v++) {
    let res: { channels: Float32Array[]; sampleRate: number } | null = null;
    if (opts.worker) {
      try {
        res = await opts.worker.render(id, v, ctx.sampleRate, opts.params);
      } catch (e) {
        // background warm: never degrade into a bulk main-thread synth during play — the sound just stays lazy
        if (opts.noFallback) throw e;
        console.warn(`[audio] synth worker failed for ${id}; rendering on the main thread`, e);
      }
    }
    if (!res) res = renderRecipe(r, ctx.sampleRate, v, opts.params);
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
