// Voice lines: plays src/shared/voice-script.json lines through per-character runtime chains, with word-timed
// subtitles. When a generated clip exists (listed in public/assets/voice/index.json by scripts/voices.mjs) it is
// loaded with its word timings; otherwise the line plays SUBTITLE-ONLY, timed at ~2.7 words/s — the game is fully
// playable before any ElevenLabs key exists.
//
// Chains (voice-types.ts VoiceChain):
//   in_head          driver: non-spatial close-mic EQ (proximity warmth + presence)
//   whisper_in_head  driver hiding: quieter, breathier (lifted air band, less body)
//   sack             Harlan: band-passed "through burlap", positional
//   through_floor    heard through a floor/wall: heavy low-pass + room reverb, positional
//   revenant         Ada: slight pitch-down, 7–11 Hz noise-driven wet wobble (AM), WaveShaper grit, band
//                    resonances, HRTF + the listener room's convolution reverb
//   memory           Ada 1976 reading her letter: clean, intimate, faint room tone + small-room reverb
//   clean            traveler2 / UI

import type { EventBus, GameEvents } from '../core/events.ts';
import type { Settings } from '../shared/types.ts';
import type { VoiceChain, VoiceLine, VoiceScript, VoiceTiming, SpeakerDef } from '../shared/voice-types.ts';
import type { AudioEngine } from './engine.ts';
import type { SpatialEmitter } from './spatial.ts';
import { createConvolver } from './reverb.ts';
import { Rng, Biquad, pink } from './synth/dsp.ts';
import { fallbackTiming, mapTimingToSubtitle, type TimedWord, type VoiceIndex } from './voice-timing.ts';

/** Where subtitles go (src/ui/subtitles.ts implements it). */
export interface SubtitleSink {
  show(cue: { speaker: string; text: string; words?: TimedWord[]; durationMs: number; caption?: boolean }): number;
  clear(token?: number): void;
}

export interface VoicePlayOptions {
  chain?: VoiceChain;
  /** World position for positional chains (sack / through_floor / revenant). */
  pos?: [number, number, number];
  room?: string;
  /** Pick a specific take (default: random, not repeating). */
  variant?: number;
  gain?: number;
}

interface Active {
  line: VoiceLine;
  stop: () => void;
  done: Promise<void>;
}

const POSITIONAL: ReadonlySet<VoiceChain> = new Set(['sack', 'through_floor', 'revenant']);

/**
 * Synth fallbacks for vocal lines (src/shared/voice-script.json ids) until generated takes exist. Unknown vocal
 * ids simply show their caption.
 */
export const VOCAL_FALLBACK: Record<string, { id: string; maxSec?: number; gain?: number; rate?: number }> = {
  drv_breath_calm: { id: 'breath_calm', maxSec: 4.5 },
  drv_breath_scared: { id: 'breath_strained', maxSec: 3.5 },
  drv_breath_hold: { id: 'breath_hold' },
  drv_breath_strain: { id: 'breath_hold', gain: 0.6, rate: 0.9 },
  drv_breath_release: { id: 'breath_release' },
  drv_gasp: { id: 'gasp' },
  drv_startle: { id: 'gasp', gain: 0.8, rate: 1.08 },
  drv_threshold: { id: 'breath_hold' },
  drv_panting: { id: 'panting', maxSec: 4 },
  drv_whimper: { id: 'breath_release', gain: 0.7, rate: 1.1 },
  drv_pry_effort: { id: 'breath_strained', maxSec: 1.6 },
  drv_death: { id: 'gasp', rate: 0.85 },
  drv_relief: { id: 'breath_release', rate: 0.9 },
  ada_not_him: { id: 'ada_gurgle' },
  ada_wet_breath: { id: 'ada_gurgle', gain: 0.6, rate: 0.85 },
  ada_gurgle: { id: 'ada_gurgle' },
  ada_chase_breath: { id: 'ada_gurgle', rate: 1.15 },
  ada_catch: { id: 'ada_gurgle', rate: 1.2 },
  b09_dress_sob: { id: 'ada_sob' },
  b13_gasp: { id: 'gasp', rate: 1.2 },
};

export class VoicePlayer {
  private engine: AudioEngine | null;
  private events: EventBus<GameEvents> | null;
  private script: VoiceScript;
  private sink: SubtitleSink | null;
  private settings: Settings | null;
  private base: string;
  private index: VoiceIndex = { version: 1, clips: {} };
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private timings = new Map<string, Promise<VoiceTiming | null>>();
  private active = new Map<string, Active>();
  private queue = new Map<string, { line: VoiceLine; o: VoicePlayOptions; resolve: () => void }[]>();
  private lastTake = new Map<string, number>();
  private speakers: Map<string, SpeakerDef>;
  private wobble: AudioBuffer | null = null;
  private paused = false;

  constructor(o: { engine: AudioEngine | null; script: VoiceScript; events?: EventBus<GameEvents>; subtitles?: SubtitleSink; settings?: Settings; baseUrl?: string }) {
    this.engine = o.engine;
    this.script = o.script;
    this.events = o.events ?? null;
    this.sink = o.subtitles ?? null;
    this.settings = o.settings ?? null;
    this.base = o.baseUrl ?? `${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}assets/voice/`;
    this.speakers = new Map(o.script.speakers.map((s) => [s.id, s]));
    this.events?.on('pause', ({ paused }) => (this.paused = paused));
  }

  /** Load the clip index (absent or unparsable → subtitle-only mode; Vite's SPA fallback returns HTML, not JSON). */
  async load(): Promise<void> {
    try {
      const r = await fetch(`${this.base}index.json`, { cache: 'no-cache' });
      const type = r.headers.get('content-type') ?? '';
      if (!r.ok || !type.includes('json')) throw new Error(`no index (${r.status} ${type})`);
      const j = (await r.json()) as VoiceIndex;
      if (j?.version === 1 && j.clips) this.index = j;
      console.info(`[voice] ${Object.keys(this.index.clips).length} generated lines available`);
    } catch (e) {
      console.info(`[voice] subtitle-only mode (${e instanceof Error ? e.message : e})`);
    }
  }

  hasAudio(lineId: string): boolean {
    return !!this.index.clips[lineId]?.files.length;
  }

  getLine(id: string): VoiceLine | undefined {
    return this.script.lines.find((l) => l.id === id);
  }

  /** Warm the cache for lines about to play (e.g. a beat's lines on beat:enter). */
  preload(ids: readonly string[]): void {
    for (const id of ids) for (const f of this.index.clips[id]?.files ?? []) void this.fetchBuffer(f);
  }

  /**
   * Play a line. Resolves when it ends (or is interrupted / dropped). Priority: a higher-priority line interrupts
   * a lower one on the same speaker; equal/lower lines queue — except vocals (breaths, barks), which are dropped.
   */
  play(lineId: string, o: VoicePlayOptions = {}): Promise<void> {
    const line = this.getLine(lineId);
    if (!line) {
      console.warn(`[voice] unknown line '${lineId}'`);
      return Promise.resolve();
    }
    const cur = this.active.get(line.speaker);
    if (cur) {
      if (line.priority > cur.line.priority) cur.stop();
      else if (line.kind === 'vocal') return Promise.resolve();
      else {
        return new Promise((resolve) => {
          const q = this.queue.get(line.speaker) ?? [];
          q.push({ line, o, resolve });
          this.queue.set(line.speaker, q);
        });
      }
    }
    return this.start(line, o);
  }

  /** Stop everything (e.g. on death / cutscene skip). */
  stopAll(): void {
    this.queue.clear();
    for (const a of [...this.active.values()]) a.stop();
  }

  private async start(line: VoiceLine, o: VoicePlayOptions): Promise<void> {
    let stopped = false;
    let stopAudio: (() => void) | null = null;
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => (resolveDone = r));
    const act: Active = {
      line,
      done,
      stop: () => {
        stopped = true;
        stopAudio?.();
        resolveDone();
      },
    };
    this.active.set(line.speaker, act);
    this.events?.emit('voice:play', { lineId: line.id });

    const files = this.index.clips[line.id]?.files ?? [];
    let buffer: AudioBuffer | null = null;
    let timing: VoiceTiming | null = null;
    let file: string | null = null;
    if (files.length && this.engine) {
      const take = this.pickTake(line.id, files.length, o.variant);
      file = files[take];
      [buffer, timing] = await Promise.all([this.fetchBuffer(file), this.fetchTiming(file)]);
    }
    if (stopped) return this.finish(line, act, -1);

    const speaker = this.speakers.get(line.speaker)?.displayName ?? line.speaker;
    let words: TimedWord[] | undefined;
    let durationMs: number;
    if (buffer) {
      const chain = o.chain ?? line.chain ?? this.speakers.get(line.speaker)?.defaultChain ?? 'clean';
      const rate = chain === 'revenant' ? 0.92 : 1;
      durationMs = (buffer.duration / rate) * 1000 + 350;
      if (timing && line.subtitle) words = mapTimingToSubtitle(line.subtitle, timing).map((w) => ({ text: w.text, start: w.start / rate, end: w.end / rate }));
      stopAudio = this.playAudio(buffer, chain, o, () => act.stop());
    } else {
      const f = fallbackTiming(line.subtitle || line.caption || stripForTiming(line.text));
      durationMs = f.durationSec * 1000;
      words = line.subtitle ? f.words : undefined;
      // vocals (breaths, gasps, gurgles) fall back to the synthesized banks (PLAN §2.8)
      const fb = VOCAL_FALLBACK[line.id];
      let stopSynth: (() => void) | null = null;
      if (fb && this.engine) {
        const bufs = await this.engine.ensure(fb.id).catch(() => null);
        if (stopped) return this.finish(line, act, -1);
        const b = bufs?.length ? bufs[Math.floor(Math.random() * bufs.length)] : null;
        if (b) {
          durationMs = Math.min(b.duration, fb.maxSec ?? Infinity) * 1000 + 150;
          const chain = o.chain ?? line.chain ?? this.speakers.get(line.speaker)?.defaultChain ?? 'clean';
          const h = this.engine.playBuffer(b, {
            bus: line.speaker === 'driver' ? 'player' : 'creature',
            pos: POSITIONAL.has(chain) ? o.pos : undefined,
            room: o.room,
            gain: (fb.gain ?? 1) * (o.gain ?? 1),
            rate: fb.rate,
          });
          stopSynth = () => h.stop(0.12);
        }
      }
      // subtitle-only (or synth fallback): a pausable timer ends the line
      const stopTimer = this.pausableTimer(durationMs, () => act.stop());
      stopAudio = () => {
        stopTimer();
        stopSynth?.();
      };
    }
    const token = this.showSubtitle(line, speaker, words, durationMs);
    await done;
    return this.finish(line, act, token);
  }

  private finish(line: VoiceLine, act: Active, token: number): void {
    const wasCurrent = this.active.get(line.speaker) === act;
    if (wasCurrent) this.active.delete(line.speaker);
    if (token >= 0) this.sink?.clear(token);
    this.events?.emit('subtitle', null);
    this.events?.emit('voice:end', { lineId: line.id });
    // an interrupted line must not start the queue: its interrupter is already the current line
    if (!wasCurrent) return;
    const q = this.queue.get(line.speaker);
    const next = q?.shift();
    if (next) void this.start(next.line, next.o).then(next.resolve);
  }

  private showSubtitle(line: VoiceLine, speaker: string, words: TimedWord[] | undefined, durationMs: number): number {
    const subsOn = this.settings?.subtitles ?? true;
    const capsOn = this.settings?.captions ?? true;
    if (line.subtitle && subsOn) {
      this.events?.emit('subtitle', { speaker, text: line.subtitle, durationMs });
      return this.sink?.show({ speaker, text: line.subtitle, words, durationMs }) ?? -1;
    }
    if (!line.subtitle && line.caption && capsOn) {
      this.events?.emit('subtitle', { speaker: '', text: line.caption, durationMs });
      return this.sink?.show({ speaker: '', text: line.caption, durationMs, caption: true }) ?? -1;
    }
    return -1;
  }

  private pickTake(id: string, n: number, want?: number): number {
    if (want !== undefined) return Math.min(n - 1, Math.max(0, want));
    if (n === 1) return 0;
    const last = this.lastTake.get(id) ?? -1;
    let k = Math.floor(Math.random() * (n - 1));
    if (k >= last) k++;
    this.lastTake.set(id, k);
    return k;
  }

  private fetchBuffer(file: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(file);
    if (!p) {
      p = (async () => {
        if (!this.engine) return null;
        try {
          const r = await fetch(this.base + file);
          if (!r.ok || (r.headers.get('content-type') ?? '').includes('html')) return null;
          return await this.engine.ctx.decodeAudioData(await r.arrayBuffer());
        } catch (e) {
          console.warn(`[voice] failed to load ${file}`, e);
          return null;
        }
      })();
      this.buffers.set(file, p);
    }
    return p;
  }

  private fetchTiming(file: string): Promise<VoiceTiming | null> {
    const key = file.replace(/\.[a-z0-9]+$/i, '.json');
    let p = this.timings.get(key);
    if (!p) {
      p = fetch(this.base + key)
        .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? (r.json() as Promise<VoiceTiming>) : null))
        .catch(() => null);
      this.timings.set(key, p);
    }
    return p;
  }

  private pausableTimer(ms: number, cb: () => void): () => void {
    let remaining = ms;
    let startedAt = performance.now();
    let handle: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const arm = () => {
      startedAt = performance.now();
      handle = setTimeout(() => !cancelled && cb(), remaining);
    };
    const off = this.events?.on('pause', ({ paused }) => {
      if (cancelled) return;
      if (paused && handle) {
        clearTimeout(handle);
        handle = null;
        remaining -= performance.now() - startedAt;
      } else if (!paused && !handle) arm();
    });
    if (!this.paused) arm();
    return () => {
      cancelled = true;
      if (handle) clearTimeout(handle);
      off?.();
    };
  }

  // ------------------------------------------------------------------ chains

  private playAudio(buffer: AudioBuffer, chain: VoiceChain, o: VoicePlayOptions, onEnd: () => void): () => void {
    const e = this.engine!;
    const c = e.ctx;
    const src = c.createBufferSource();
    src.buffer = buffer;
    const out = c.createGain();
    out.gain.value = o.gain ?? 1;
    let emitter: SpatialEmitter | null = null;
    if (POSITIONAL.has(chain) && o.pos) {
      emitter = e.createEmitter('voice', { refDistance: 1.3, rolloffFactor: 1 });
      emitter.room = o.room ?? null;
      emitter.setPosition(o.pos[0], o.pos[1], o.pos[2]);
      e.refreshOcclusion();
      out.connect(emitter.input);
    } else out.connect(e.buses.voice);
    const extra: AudioNode[] = [];
    const head = this.buildChain(chain, src, out, extra);
    src.connect(head);
    src.onended = () => onEnd();
    src.start();
    return () => {
      src.onended = null;
      const t = c.currentTime;
      out.gain.setTargetAtTime(0, t, 0.02);
      try {
        src.stop(t + 0.1);
      } catch {
        /* already stopped */
      }
      setTimeout(() => {
        out.disconnect();
        extra.forEach((n) => n.disconnect());
        if (emitter) e.releaseEmitter(emitter);
      }, 200);
    };
  }

  /** Builds the chain between `src` and `out`; returns the node the source should connect to. */
  private buildChain(chain: VoiceChain, src: AudioBufferSourceNode, out: AudioNode, keep: AudioNode[]): AudioNode {
    const c = this.engine!.ctx;
    const bq = (type: BiquadFilterType, f: number, q = 0.7, g = 0): BiquadFilterNode => {
      const n = c.createBiquadFilter();
      n.type = type;
      n.frequency.value = f;
      n.Q.value = q;
      n.gain.value = g;
      keep.push(n);
      return n;
    };
    const series = (...nodes: AudioNode[]): AudioNode => {
      for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
      nodes[nodes.length - 1].connect(out);
      return nodes[0];
    };
    switch (chain) {
      case 'in_head':
        return series(bq('highpass', 85), bq('lowshelf', 220, 0.7, 2.5), bq('peaking', 3200, 0.9, 2));
      case 'whisper_in_head': {
        const g = c.createGain();
        g.gain.value = 0.62;
        keep.push(g);
        return series(bq('highpass', 160), bq('lowshelf', 300, 0.7, -3), bq('highshelf', 5000, 0.7, 3.5), bq('lowpass', 10000), g);
      }
      case 'sack':
        // coarse burlap over the mouth: a broad band-pass with the presence band notched and the top rolled off
        return series(bq('highpass', 180), bq('bandpass', 850, 0.7), bq('peaking', 2800, 1.2, -9), bq('lowpass', 3000), bq('peaking', 450, 1.5, 3));
      case 'through_floor': {
        const pre = bq('lowpass', 420, 0.8);
        const shelf = bq('lowshelf', 130, 0.7, 4);
        pre.connect(shelf).connect(out);
        const send = c.createGain();
        send.gain.value = 0.9;
        keep.push(send);
        shelf.connect(send).connect(this.engine!.reverbInput);
        return pre;
      }
      case 'revenant':
        return this.revenant(src, out, keep, bq);
      case 'memory': {
        const hp = bq('highpass', 120);
        const lp = bq('lowpass', 7500);
        hp.connect(lp).connect(out);
        const conv = createConvolver(c, { size: 3.5, damping: 0.6, wet: 0.2 });
        const wet = c.createGain();
        wet.gain.value = 0.12;
        keep.push(conv, wet);
        lp.connect(conv).connect(wet).connect(out);
        this.roomTone(out, keep, src);
        return hp;
      }
      case 'clean':
      default:
        return series(bq('highpass', 70));
    }
  }

  /**
   * Ada's revenant chain: pitch-down (playbackRate 0.92), then
   *   dry ─┬─ resonances ─ wobble(AM) ─┬─ out (→ HRTF emitter)
   *        └─ grit (WaveShaper) ───────┘   └─ send → listener-room reverb
   * The wobble is 7–11 Hz band-limited NOISE (not an LFO) so it gurgles irregularly.
   */
  private revenant(src: AudioBufferSourceNode, out: AudioNode, keep: AudioNode[], bq: (t: BiquadFilterType, f: number, q?: number, g?: number) => BiquadFilterNode): AudioNode {
    const c = this.engine!.ctx;
    src.playbackRate.value = 0.92;
    const input = c.createGain();
    const shaper = c.createWaveShaper();
    shaper.curve = gritCurve(0.9);
    shaper.oversample = '2x';
    const gritBand = bq('bandpass', 1400, 0.6);
    const gritGain = c.createGain();
    gritGain.gain.value = 0.28;
    const r1 = bq('peaking', 330, 3.5, 5);
    const r2 = bq('peaking', 1250, 5, 4);
    const r3 = bq('peaking', 2700, 2, -4);
    const lp = bq('lowpass', 6500);
    const wob = c.createGain();
    wob.gain.value = 0.68;
    const mod = c.createBufferSource();
    mod.buffer = this.wobbleBuffer();
    mod.loop = true;
    mod.loopStart = 0;
    mod.loopEnd = mod.buffer.duration;
    const depth = c.createGain();
    depth.gain.value = 0.32;
    mod.connect(depth).connect(wob.gain);
    mod.start(0, Math.random() * mod.buffer.duration);
    src.addEventListener('ended', () => {
      try {
        mod.stop();
      } catch {
        /* stopped */
      }
    });
    input.connect(r1).connect(r2).connect(r3).connect(lp).connect(wob);
    input.connect(shaper).connect(gritBand).connect(gritGain).connect(wob);
    wob.connect(out);
    const send = c.createGain();
    send.gain.value = 0.8;
    wob.connect(send).connect(this.engine!.reverbInput);
    keep.push(input, shaper, gritGain, wob, depth, send, mod);
    return input;
  }

  /** 4 s loop of 7–11 Hz band-limited noise, normalised to ±1 (the "wet gurgle" modulator). */
  private wobbleBuffer(): AudioBuffer {
    if (this.wobble) return this.wobble;
    const c = this.engine!.ctx;
    const sr = c.sampleRate;
    const n = sr * 4;
    const x = new Float32Array(n);
    const rng = new Rng(0xada);
    const hp = new Biquad('highpass', sr, 7, 0.7);
    const lp = new Biquad('lowpass', sr, 11, 0.7);
    // run 2 s of warm-up so the filters settle, then capture, then crossfade the ends for a seamless loop
    for (let i = 0; i < sr * 2; i++) lp.tick(hp.tick(rng.bi()));
    let pk = 0;
    for (let i = 0; i < n; i++) {
      x[i] = lp.tick(hp.tick(rng.bi()));
      pk = Math.max(pk, Math.abs(x[i]));
    }
    const xf = Math.floor(sr * 0.25);
    for (let i = 0; i < xf; i++) {
      const a = i / xf;
      x[i] = x[i] * a + x[n - xf + i] * (1 - a);
    }
    const b = c.createBuffer(1, n - xf, sr);
    const y = x.subarray(0, n - xf);
    for (let i = 0; i < y.length; i++) y[i] /= pk || 1;
    b.copyToChannel(y as Float32Array<ArrayBuffer>, 0);
    this.wobble = b;
    return b;
  }

  /** Faint room tone under the memory reading (lowpassed pink noise at ≈ -46 dB). */
  private roomTone(out: AudioNode, keep: AudioNode[], src: AudioBufferSourceNode): void {
    const c = this.engine!.ctx;
    const sr = c.sampleRate;
    const n = sr * 3;
    const x = pink(n, new Rng(0x0e0e));
    const b = c.createBuffer(1, n, sr);
    b.copyToChannel(x as Float32Array<ArrayBuffer>, 0);
    const s = c.createBufferSource();
    s.buffer = b;
    s.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = c.createGain();
    g.gain.value = 0.005;
    s.connect(lp).connect(g).connect(out);
    s.start();
    src.addEventListener('ended', () => {
      try {
        s.stop();
      } catch {
        /* stopped */
      }
    });
    keep.push(s, lp, g);
  }
}

/** Soft asymmetric saturation (the wet, torn edge of her voice). */
function gritCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  const k = 1 + drive * 8;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const y = Math.tanh(k * (x + 0.12 * x * x)) / Math.tanh(k);
    curve[i] = y;
  }
  return curve;
}

function stripForTiming(t: string): string {
  return t.replace(/\[[^\]]*\]/g, ' ');
}

/** Load src/shared/voice-script.json lazily (it may not exist yet during development). */
export async function loadVoiceScript(): Promise<VoiceScript | null> {
  try {
    const mods = import.meta.glob('../shared/voice-script.json');
    const loader = mods['../shared/voice-script.json'];
    if (!loader) return null;
    const m = (await loader()) as { default: VoiceScript };
    return m.default;
  } catch (e) {
    console.warn('[voice] voice-script.json failed to load', e);
    return null;
  }
}
