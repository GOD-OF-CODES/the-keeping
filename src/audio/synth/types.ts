// Recipe contract shared by every synth file, the bank prerenderer (offline.ts), the lab and the tests.

import type { Channels, Rng } from './dsp.ts';

export const BUS_NAMES = ['ambience', 'weather', 'sfx', 'creature', 'player', 'voice', 'score', 'ui'] as const;
export type BusName = (typeof BUS_NAMES)[number];

export type RecipeCategory =
  | 'ada'
  | 'weather'
  | 'footsteps'
  | 'doors'
  | 'bells'
  | 'harlan'
  | 'car'
  | 'props'
  | 'player'
  | 'score';

export interface ParamSpec {
  min: number;
  max: number;
  default: number;
  label?: string;
}

export type Params = Record<string, number>;

export interface Recipe {
  id: string;
  label: string;
  category: RecipeCategory;
  bus: BusName;
  /** Number of seeded variations pre-rendered into the bank (1 for loops / long one-offs). */
  variants: number;
  /** A seamless loop (texture / bed) rather than a one-shot. */
  loop?: boolean;
  /** Mono recipes are spatialised by an HRTF panner at runtime; stereo ones play non-positional. */
  stereo?: boolean;
  params?: Record<string, ParamSpec>;
  /** Peak level the bank normalises to (linear, default 0.7 ≈ -3 dBFS). Balance between sounds lives here. */
  level?: number;
  /**
   * Render sample-rate factor relative to the context (0.5 = half rate; the browser resamples on playback). For
   * band-limited material (drones, rumbles, muffled beds, breath) it halves memory with no audible loss.
   */
  renderRate?: number;
  /**
   * "HDR audio" duck (fix round 2): when this sound plays, the bed buses (ambience, weather) dip by
   * `hdr` dB (5 ms attack, `hdrHold` s hold, ≈ 1.2 s release) — a very loud event masks the quiet bed (and the
   * ear's acoustic reflex / short threshold shift does the same in reality), so the event reads as loud without
   * exceeding −1 dBFS. Reserved for the few biggest events (the severing chop, the head hitting the floor).
   */
  hdr?: number;
  hdrHold?: number;
  /**
   * Playback gain (linear, default 1) applied by AudioEngine.play on top of the caller's gain (fix round 2). `level`
   * is a PEAK normalisation capped at −1 dBFS, so it cannot express that a cleaver blow is ~30 dB louder at the
   * source than a footstep; positional playback then takes the 1/r loss (−9 dB at 2.7 m). `playGain` restores the
   * reference loudness of the few very loud events (the master limiter catches the peaks), and trims featured
   * film devices (the heard heartbeat) under the diegetic scene.
   */
  playGain?: number;
  /** Render at load (true) or lazily on first use (false). Long / rare sounds are lazy. */
  preload?: boolean;
  /** Produce the sound. `p` always has every param filled with defaults. */
  gen(sr: number, rng: Rng, p: Params): Channels;
}

export function withDefaults(r: Recipe, p?: Params): Params {
  const out: Params = {};
  for (const [k, s] of Object.entries(r.params ?? {})) out[k] = p?.[k] ?? s.default;
  if (p) for (const [k, v] of Object.entries(p)) if (!(k in out)) out[k] = v;
  return out;
}
