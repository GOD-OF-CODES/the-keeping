// JUMPSCARE (#147m): the catch sting under the severed-head clip (docs/STATUS-jumpscare.md Spec §6).
//
// `scare_whoosh` (0.15 s): the lunge before the cut. Reversed-swell pink noise in a band rising 600 → 2000 Hz,
//   +18 dB over 0.15 s, ending abruptly ON the cut (death.ts plays it plain at t = 0 of the cutaway).
// `scare_sting` (2.05 s): the hit lands at buffer 0 = the cut to her face (death.ts schedules it `sched` at 0.15 s, so it
//   is clock-scheduled at the cutaway's start and lands on the cut frame). Layers:
//   - transient: 3 ms attack / 30 ms decay white noise high-passed at 600 Hz + a 2 kHz damped click (the "slam");
//   - shriek 0–1.0 s: four band-limited saws at 740 / 1047 / 1109 / 1568 Hz (F#5, C6, C#6, G6: a tritone + a minor 2nd)
//     plus breath noise, through scream formants 800 / 1150 / 2900 Hz (an open /a/ scream), gliding +2.5 st over 0.6 s
//     with a ragged 6–11 Hz ±40 ct vibrato, tanh drive 2.5, −5.5 dB in the mix, ±7 ct between L and R; a 30 ms fade at
//     1.000 s = the clip's last frame (30 frames at 30 fps), so the voice stops with the cut to black;
//   - low hit: sine 55 → 28 Hz over 0.5 s + a 110 Hz thump (80 ms), τ 0.35 s, tanh 1.5 (it still reads on laptop
//     speakers through the 2nd/3rd harmonics), ringing out by ≈ 1.65 s;
//   - a wet gurgle burst 0.30–0.60 s at −14 dB: the clip's jaw spasm (frames 10–15 = 0.33–0.50 s).
// It layers WITH the brain's `ai:catch` voice (ada_catch + the driver's death breath), not instead of it.
// Loudness targets (tests/jumpscare-audio.test.ts): buffer peak ≤ 0.891 (−1 dBFS), no run of > 2 samples ≥ 0.89,
// |DC| < 0.002; through the default chain (playGain × player bus −2 dB × master 0.9² → the −3 dBFS / 20:1 limiter):
// ≤ 3 dB gain reduction, EBU R128 momentary max −10 ± 1 LUFS in its first 0.4 s — the loudest moment of the game,
// ≈ 3.7 LU over the C2 strike's measured −13.7 (#132).

import { Rng, buf, mixInto, white, pink, filt, sweep, Biquad, dbToGain, envAt, type Channels } from './dsp.ts';
import { sawOsc, sineOsc } from './common.ts';
import type { Recipe } from './types.ts';

/** Seconds of the sting buffer (the low hit's ring dies by ≈ 1.65 s). */
export const SCARE_STING_S = 2.05;
/** The shriek's length = the clip (30 frames at 30 fps): it ends with the cut to black. */
export const SCARE_SHRIEK_S = 1.0;
/** The lunge whoosh: 0.15 s, played at the cutaway's t = 0 so its end meets the sting's hit at 0.15 s. */
export const SCARE_WHOOSH_S = 0.15;
/** The playback gain the engine applies on top of the peak-normalised buffer (Recipe.playGain). */
/** The playback gain the engine applies on top of the peak-normalised buffer (Recipe.playGain): with the player bus' −2 dB
 *  trim and the default master 0.9² the sample peak reaches the limiter at −1.3 dBFS (Spec §6 said 1.6: that put the
 *  white-noise slam's peak at −0.75 dBFS, over the −1 dBTP ceiling, for no loudness gain). */
export const SCARE_STING_PLAY_GAIN = 1.5;

const cents = (c: number) => Math.pow(2, c / 1200);

/** The 0.15 s reversed swell: a decaying band of noise played backwards, its band rising 600 → 2000 Hz. */
function whoosh(sr: number, rng: Rng): Channels {
  const n = Math.floor(sr * SCARE_WHOOSH_S);
  return [0, 1].map((c) => {
    const r = rng.fork(11 + c);
    const x = pink(n, r);
    // band rises with the swell (the air pushed ahead of her, closing on the ear)
    sweep(x, 'bandpass', sr, (i) => 600 * Math.pow(2000 / 600, Math.pow(i / n, 1.3)), 1.1);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      // +18 dB over the 0.15 s, steepest at the end (a reverse decay), then an abrupt stop (the renderer's 10 ms edge)
      x[i] *= dbToGain(-18 + 18 * Math.pow(u, 1.6));
    }
    return x;
  });
}

/** One ear of the shriek: 4 PolyBLEP saws + breath → scream formants → tanh 2.5. `detune` in cents (±7 L/R). */
function shriekEar(sr: number, rng: Rng, detune: number): Float32Array {
  const n = Math.floor(sr * (SCARE_SHRIEK_S + 0.01));
  const base = [740, 1047, 1109, 1568].map((f) => f * (1 + rng.range(-0.006, 0.006)));
  // ragged vibrato: the rate random-walks within 6–11 Hz, the depth within 25–40 ct; recomputed per 64-sample block
  const vib = new Float32Array(n);
  {
    let ph = rng.next() * Math.PI * 2;
    let rate = rng.range(6, 11);
    let depth = rng.range(28, 40);
    for (let i = 0; i < n; i++) {
      if ((i & 63) === 0) {
        rate = Math.min(11, Math.max(6, rate + rng.range(-0.6, 0.6)));
        depth = Math.min(40, Math.max(25, depth + rng.range(-2, 2)));
      }
      ph += (2 * Math.PI * rate) / sr;
      // a sine with a jagged 2nd harmonic: the voice breaks rather than wobbles
      vib[i] = depth * (Math.sin(ph) * 0.85 + Math.sin(2 * ph + 1.3) * 0.15);
    }
  }
  // +2.5 st over 0.6 s (the scream climbs as the lungs empty), held after
  const glide = (i: number) => Math.pow(2, (2.5 / 12) * Math.min(1, i / (sr * 0.6)));
  const src = new Float32Array(n);
  base.forEach((f0, k) => {
    const amp = [1, 0.8, 0.7, 0.45][k];
    const s = sawOsc(n, sr, (i) => f0 * glide(i) * cents(vib[i] + detune), rng.next());
    mixInto(src, s, 0, amp * 0.25);
  });
  // breath / aspiration through the same tract
  const br = pink(n, rng);
  filt(br, 'highpass', sr, 500);
  mixInto(src, br, 0, 0.35);
  // scream formants (parallel bandpasses: F1 800 / F2 1150 / F3 2900 Hz) + a little direct signal
  const out = new Float32Array(n);
  for (const [f, q, g] of [
    [800, 6, 1],
    [1150, 7, 0.8],
    [2900, 8, 0.55],
  ] as const) {
    const y = Float32Array.from(src);
    new Biquad('bandpass', sr, f, q).run(y);
    mixInto(out, y, 0, g * 2.2);
  }
  mixInto(out, src, 0, 0.12);
  // envelope: 6 ms attack ON the hit, a slight swell to 0.25 s, sag, a 30 ms fade at 1.0 s (the cut to black)
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] *= envAt(t, [
      [0, 0],
      [0.006, 0.85],
      [0.25, 1],
      [0.7, 0.88],
      [SCARE_SHRIEK_S - 0.03, 0.8],
      [SCARE_SHRIEK_S, 0],
    ]);
  }
  // tanh drive 2.5 (a throat at its limit), normalised so the drive changes colour, not level
  const d = 2.5;
  let pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(out[i]));
  const k = pk > 1e-9 ? 1 / pk : 1;
  for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * k * d) / Math.tanh(d);
  return out;
}

/** The body hit: 55 → 28 Hz over 0.5 s + a 110 Hz thump (80 ms), τ 0.35 s, tanh 1.5. */
function lowHit(sr: number, rng: Rng): Float32Array {
  const n = Math.floor(sr * 1.7);
  const f0 = 55 * (1 + rng.range(-0.03, 0.03));
  const sub = sineOsc(n, sr, (i) => f0 * Math.pow(28 / 55, Math.min(1, i / (sr * 0.5))));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    sub[i] *= Math.min(1, t / 0.003) * Math.exp(-t / 0.35);
  }
  const th = sineOsc(Math.floor(sr * 0.08), sr, (i) => 110 * Math.pow(0.8, i / (sr * 0.08)));
  for (let i = 0; i < th.length; i++) {
    const t = i / sr;
    th[i] *= Math.min(1, t / 0.002) * Math.exp(-t / 0.022);
  }
  mixInto(sub, th, 0, 0.8);
  const d = 1.5;
  for (let i = 0; i < n; i++) sub[i] = Math.tanh(sub[i] * d) / Math.tanh(d);
  return sub;
}

/** The slam on the cut: 3 ms / 30 ms high-passed noise + a 2 kHz damped click. */
function transient(sr: number, rng: Rng): Float32Array {
  const n = Math.floor(sr * 0.2);
  const x = white(n, rng);
  filt(x, 'highpass', sr, 600);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    x[i] *= t < 0.003 ? t / 0.003 : Math.exp(-(t - 0.003) / 0.03);
  }
  const ck = sineOsc(Math.floor(sr * 0.05), sr, () => 2000 * (1 + rng.range(-0.002, 0.002)));
  for (let i = 0; i < ck.length; i++) {
    const t = i / sr;
    ck[i] *= Math.min(1, t / 0.0005) * Math.exp(-t / 0.008);
  }
  mixInto(x, ck, 0, 0.5);
  return x;
}

/** The jaw spasm: air through water in an open throat — low bubbles over a lowpassed wash, 0.30–0.60 s. */
function gurgleBurst(sr: number, rng: Rng): Float32Array {
  const d = 0.3;
  const n = Math.floor(sr * d);
  const x = pink(n, rng);
  filt(x, 'lowpass', sr, 700);
  filt(x, 'highpass', sr, 90);
  // ragged amplitude (15–30 Hz bubble bursts)
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (2 * Math.PI * (15 + 15 * Math.sin(t * 9))) / sr;
    x[i] *= (0.45 + 0.55 * Math.max(0, Math.sin(ph))) * Math.sin(Math.PI * Math.min(1, t / d));
  }
  // Minnaert bubbles: f ≈ 3.26 / a → 200–700 Hz for 4.7–16 mm bubbles, each a rising chirp as it pinches off
  for (let t = 0.01; t < d - 0.03; t += rng.exp(0.022)) {
    const f = rng.range(200, 700);
    const m = Math.floor(sr * rng.range(0.015, 0.04));
    const b = sineOsc(m, sr, (i) => f * (1 + 0.25 * (i / m)));
    for (let i = 0; i < m; i++) b[i] *= Math.sin((Math.PI * i) / m) * Math.exp(-i / m);
    mixInto(x, b, Math.floor(t * sr), rng.range(0.4, 1));
  }
  return x;
}

const scareWhoosh: Recipe = {
  id: 'scare_whoosh',
  label: 'Jumpscare: the lunge swell (0.15 s, ends on the cut)',
  category: 'player',
  bus: 'player',
  variants: 2,
  stereo: true,
  level: 0.5, // ≈ −6 dBFS: an approach, well under the hit it leads into
  gen(sr, rng) {
    return whoosh(sr, rng);
  },
};

const scareSting: Recipe = {
  id: 'scare_sting',
  label: 'Jumpscare: the sting (hit at 0, shriek to 1.0 s, low ring to 1.65 s)',
  category: 'player',
  bus: 'player',
  variants: 3,
  stereo: true,
  level: 0.891, // MAX_PEAK, −1 dBFS
  playGain: SCARE_STING_PLAY_GAIN,
  hdr: 10, // the bed dips 10 dB for the second of her face: nothing else in the world exists
  hdrHold: 1.0,
  preload: false, // worker-rendered after load (warmLazy) and ensured again when B05 begins (src/world/jumpscare.ts)
  gen(sr, rng) {
    const out: Channels = [buf(sr, SCARE_STING_S), buf(sr, SCARE_STING_S)];
    const hit = transient(sr, rng);
    const low = lowHit(sr, rng);
    const gurg = gurgleBurst(sr, rng);
    // levels (tuned in tests/jumpscare-audio.test.ts' chain model): the slam 0.65 (its white-noise spike sets the sample
    // peak, so it sits under the body or the peak-normalised mix gets quieter), the low hit −3 dB, the shriek −5.5 dB,
    // the gurgle −14 dB
    const sL = shriekEar(sr, rng.fork(21), -7);
    const sR = shriekEar(sr, rng.fork(22), +7);
    out.forEach((ch, c) => {
      mixInto(ch, hit, 0, 0.65);
      mixInto(ch, low, 0, dbToGain(-3));
      mixInto(ch, c === 0 ? sL : sR, 0, dbToGain(-5.5));
      mixInto(ch, gurg, Math.floor(sr * 0.3), dbToGain(-14) * (c === 0 ? 1.1 : 0.9));
    });
    // remove any DC the asymmetric tanh stages left (a 12 Hz high-pass: below anything audible)
    for (const ch of out) filt(ch, 'highpass', sr, 12);
    return out;
  },
};

export const SCARE_RECIPES: readonly Recipe[] = [scareWhoosh, scareSting];
