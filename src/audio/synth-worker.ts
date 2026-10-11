// Fix round 2 (audio): the lazy-sound synth runs HERE, off the main thread. A lazy recipe (preload:false) used to
// run its pure-JS DSP on the main thread at first play — measured in Node/V8 at 48 kHz: score_blue_hour 173 ms,
// spring_bell_loop 123 ms, doorbell_old 88 ms, score_final_bell 76 ms, ada_sob 53 ms — each a visible frame hitch.
// The worker renders recipe → sanitised/normalised channels (the same renderRecipe the prerender uses, so the result
// is bit-identical) and transfers the Float32Arrays back; the main thread only wraps them in an AudioBuffer
// (a memcpy, < 1 ms for 16 s stereo) and runs the OfflineAudioContext variation pass (rendered by the browser's
// audio thread, not ours).

import { getRecipe } from './synth/index.ts';
import { renderRecipe } from './synth/render.ts';
import type { Params } from './synth/types.ts';

export interface SynthJob {
  job: number;
  id: string;
  variant: number;
  sampleRate: number;
  params?: Params;
}

export type SynthReply =
  | { job: number; ok: true; sampleRate: number; channels: Float32Array[]; ms: number }
  | { job: number; ok: false; error: string };

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<SynthJob>) => void) | null;
  postMessage(msg: SynthReply, transfer?: Transferable[]): void;
};

scope.onmessage = (e) => {
  const j = e.data;
  try {
    const res = renderRecipe(getRecipe(j.id), j.sampleRate, j.variant, j.params);
    scope.postMessage(
      { job: j.job, ok: true, sampleRate: res.sampleRate, channels: res.channels, ms: res.ms },
      res.channels.map((c) => c.buffer as ArrayBuffer),
    );
  } catch (err) {
    scope.postMessage({ job: j.job, ok: false, error: String((err as Error)?.message ?? err) });
  }
};
