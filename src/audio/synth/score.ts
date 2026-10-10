// Score: dread drone, chase string cluster, threshold stinger, reveal hit, the final bell/title hit, blue-hour pad
// and sparse synthesized birds. All stereo, on the score bus. Loops are seamless (crossfaded or wrap-summed).

import { Rng, buf, filt, mixInto, pink, white, smoothNoise, makeLoop, sweep, resonate, softclip, type Channels, type Mode, modal } from './dsp.ts';
import { sawOsc, sineOsc, thud } from './common.ts';
import type { Recipe } from './types.ts';

/** Sum a mono voice into a stereo pair at pan -1..1 (equal-power). */
function panInto(chs: Channels, x: Float32Array, pan: number, offset = 0, gain = 1): void {
  const a = ((pan + 1) / 2) * (Math.PI / 2);
  mixInto(chs[0], x, offset, Math.cos(a) * gain);
  mixInto(chs[1], x, offset, Math.sin(a) * gain);
}

/**
 * A bowed-string voice (subtractive): band-limited saw with slow random vibrato → string body resonances
 * (after Farnell's "violin body as a formant filter bank") + bow/rosin noise. `trem` = tremolo rate (Hz, 0 = none).
 */
function stringVoice(sr: number, rng: Rng, n: number, f: number, o: { trem?: number; bright?: number; vib?: number } = {}): Float32Array {
  const vib = smoothNoise(n, sr, 5, rng);
  const drift = smoothNoise(n, sr, 0.3, rng);
  const s = sawOsc(n, sr, (i) => f * (1 + (o.vib ?? 0.004) * vib[i] + 0.002 * drift[i]), rng.next());
  const bow = white(n, rng);
  filt(bow, 'bandpass', sr, f * 4, 1);
  mixInto(s, bow, 0, 0.08);
  const body = resonate(s, sr, [
    { freq: 290, q: 4, gain: 1 },
    { freq: 470, q: 5, gain: 0.8 },
    { freq: 1100, q: 3, gain: 0.7 },
    { freq: 2600, q: 2, gain: 0.5 * (o.bright ?? 1) },
  ]);
  mixInto(body, s, 0, 0.25);
  filt(body, 'lowpass', sr, 3500 + 3000 * (o.bright ?? 0.5));
  if (o.trem) {
    const ph = rng.next();
    const rate = o.trem * rng.range(0.93, 1.07);
    for (let i = 0; i < n; i++) body[i] *= 0.55 + 0.45 * Math.sin(2 * Math.PI * (rate * (i / sr) + ph));
  }
  return body;
}

/**
 * Dread drone: a sub fundamental (D1) against a detuned tritone (G#1), beating slowly; a filtered saw "bowed
 * bass" layer; and a noise wash breathing in and out like the house. 16 s loop.
 */
const drone: Recipe = {
  id: 'score_drone',
  renderRate: 0.5,
  label: 'Score: dread drone (loop)',
  category: 'score',
  bus: 'score',
  variants: 1,
  loop: true,
  stereo: true,
  level: 0.5,
  params: { dur: { min: 8, max: 30, default: 12 } },
  gen(sr, rng, p) {
    const n = Math.floor(sr * (p.dur + 2));
    const chs: Channels = [new Float32Array(n), new Float32Array(n)];
    const breath = smoothNoise(n, sr, 0.12, rng);
    [36.7, 36.85, 51.9, 52.1, 73.4].forEach((f, k) => {
      const s = sineOsc(n, sr, () => f, rng.next() * 6.28);
      panInto(chs, s, k % 2 ? 0.3 : -0.3, 0, k < 2 ? 0.5 : 0.25);
    });
    for (const [f, pan] of [[73.4, -0.6], [103.8, 0.6], [110, 0]] as const) {
      const s = sawOsc(n, sr, () => f * rng.range(0.998, 1.002));
      sweep(s, 'lowpass', sr, (i) => 180 + 220 * (0.5 + 0.5 * breath[i]), 1.5);
      for (let i = 0; i < n; i++) s[i] *= 0.4 + 0.6 * (0.5 + 0.5 * breath[i]);
      panInto(chs, s, pan, 0, 0.18);
    }
    for (let c = 0; c < 2; c++) {
      const w = pink(n, rng.fork(c));
      sweep(w, 'bandpass', sr, (i) => 250 + 400 * (0.5 + 0.5 * breath[i]), 1.2);
      for (let i = 0; i < n; i++) w[i] *= 0.15 * (0.3 + 0.7 * (0.5 + 0.5 * breath[i]));
      mixInto(chs[c], w, 0, 1);
    }
    return chs.map((x) => makeLoop(x, sr, 2));
  },
};

/**
 * Chase cluster: string tremolo on a semitone cluster (D4–F4) doubled an octave down, with a high sul-ponticello
 * screech; paired with the live heartbeat. 8 s loop.
 */
const chaseCluster: Recipe = {
  id: 'score_chase',
  label: 'Score: chase string cluster (loop)',
  category: 'score',
  bus: 'score',
  variants: 1,
  loop: true,
  stereo: true,
  level: 0.6,
  preload: true, // PERF G (ruling f): lazy = a ~400 ms main-thread synth at C2 24.5 s (the chase cue; Medium 417 ms, Max 383 ms)
  params: { dur: { min: 4, max: 16, default: 8 } },
  gen(sr, rng, p) {
    const n = Math.floor(sr * (p.dur + 1));
    const chs: Channels = [new Float32Array(n), new Float32Array(n)];
    const notes = [293.7, 311.1, 329.6, 349.2, 146.8, 155.6, 164.8, 1174.7, 1244.5];
    notes.forEach((f, k) => {
      const v = stringVoice(sr, rng, n, f, { trem: 12, bright: k >= 7 ? 1 : 0.5, vib: k >= 7 ? 0.008 : 0.004 });
      panInto(chs, v, rng.range(-0.8, 0.8), 0, k >= 7 ? 0.08 : 0.14);
    });
    const pulse = smoothNoise(n, sr, 0.5, rng);
    for (const c of chs) for (let i = 0; i < n; i++) c[i] *= 0.8 + 0.2 * pulse[i];
    return chs.map((x) => makeLoop(x, sr, 1));
  },
};

/**
 * Threshold stinger (C2 at the parlor door): a 0.6 s inhaled swell (rising noise + rising cluster), then the hit:
 * sub boom, sforzando string cluster, metallic scrape, all decaying over ~4 s.
 */
function stinger(sr: number, rng: Rng, hitAt: number, weight: number): Channels {
  const len = hitAt + 4.5;
  const n = Math.floor(sr * len);
  const chs: Channels = [new Float32Array(n), new Float32Array(n)];
  const sw = Math.floor(sr * hitAt);
  for (let c = 0; c < 2; c++) {
    const w = white(sw, rng.fork(c + 9));
    sweep(w, 'bandpass', sr, (i) => 300 + 4000 * (i / sw) ** 2, 1.5);
    for (let i = 0; i < sw; i++) w[i] *= (i / sw) ** 3 * 0.6;
    mixInto(chs[c], w, 0, 1);
  }
  const hitS = Math.floor(sr * hitAt);
  const boom = thud(sr, rng, 38, 3.5, 0.5);
  panInto(chs, boom, 0, hitS, 1.1 * weight);
  const m = Math.floor(sr * 4);
  [587, 622, 659, 698, 293, 1397].forEach((f) => {
    const v = stringVoice(sr, rng, m, f, { bright: 1, vib: 0.01 });
    for (let i = 0; i < m; i++) {
      const t = i / sr;
      v[i] = softclip(v[i] * 1.5, 1.5) * Math.exp(-t / 0.9) * Math.min(1, t / 0.01);
    }
    panInto(chs, v, rng.range(-0.7, 0.7), hitS, 0.18);
  });
  const sc = white(Math.floor(sr * 1.5), rng);
  const scr = resonate(sc, sr, [{ freq: 1870, q: 40, gain: 1 }, { freq: 2950, q: 40, gain: 0.6 }, { freq: 4410, q: 40, gain: 0.4 }]);
  for (let i = 0; i < scr.length; i++) scr[i] *= Math.exp(-i / sr / 0.4);
  panInto(chs, scr, 0.2, hitS, 0.25);
  return chs;
}

const thresholdStinger: Recipe = {
  id: 'score_stinger',
  label: 'Score: threshold stinger',
  category: 'score',
  bus: 'score',
  variants: 1,
  stereo: true,
  level: 0.95,
  gen: (sr, rng) => stinger(sr, rng, 0.6, 1),
};

const revealHit: Recipe = {
  id: 'score_reveal',
  label: 'Score: reveal hit',
  category: 'score',
  bus: 'score',
  variants: 2,
  stereo: true,
  level: 0.85,
  // runtime lane E (ROADMAP runtime-D ruling e): pre-rendered with the banks during loading — lazily synthesised at
  // its first cue (C0 20.0 s) it cost a 120–170 ms frame hitch mid-cinematic.
  gen: (sr, rng) => stinger(sr, rng, 0.05, 0.8),
};

/**
 * The final bell / title hit: a large cast bell (minor-third "tierce" bell; partial ratios after the classic
 * hum–prime–tierce–quint–nominal series), mode-split doublets for the slow beating, a long hum, plus a sub boom.
 */
const finalBell: Recipe = {
  id: 'score_final_bell',
  label: 'Score: final bell hit',
  category: 'score',
  bus: 'score',
  variants: 1,
  stereo: true,
  level: 0.9,
  preload: false,
  gen(sr, rng) {
    const dur = 9;
    const n = Math.floor(sr * dur);
    const prime = 146.8; // D3
    const partials = [
      [0.5, 1, 9], [1, 0.8, 6], [1.183, 0.7, 4.5], [1.506, 0.35, 3.5], [2, 0.6, 3],
      [2.514, 0.3, 2], [2.662, 0.25, 1.8], [3.011, 0.2, 1.5], [4.166, 0.12, 1], [5.433, 0.08, 0.7], [6.796, 0.05, 0.5],
    ] as const;
    const chs: Channels = [];
    for (let c = 0; c < 2; c++) {
      const r = rng.fork(c + 40);
      const modes: Mode[] = [];
      for (const [ratio, amp, decay] of partials) {
        modes.push({ freq: prime * ratio, amp, decay: decay / 2.3, phase: r.range(0, 6.28) });
        modes.push({ freq: prime * ratio * (1 + 0.0012 * r.range(0.6, 1.4)), amp: amp * 0.7, decay: decay / 2.3, phase: r.range(0, 6.28) });
      }
      const x = modal(n, sr, modes);
      const strike = white(Math.floor(sr * 0.02), r);
      filt(strike, 'bandpass', sr, 2500, 0.8);
      mixInto(x, strike, 0, 0.5);
      chs.push(x);
    }
    const boom = thud(sr, rng, 36, 4, 0.3);
    mixInto(chs[0], boom, 0, 0.7);
    mixInto(chs[1], boom, 0, 0.7);
    return chs;
  },
};

/**
 * Blue-hour pad: release. A warm open voicing (D–A–E–F#–A) of soft detuned saws through a gentle lowpass, slow
 * chorus-like detune drift, swelling in and out. 16 s loop. Birds are separate one-shots (score_bird).
 */
const blueHourPad: Recipe = {
  id: 'score_blue_hour',
  renderRate: 0.5,
  label: 'Score: blue-hour pad (loop)',
  category: 'score',
  bus: 'score',
  variants: 1,
  loop: true,
  stereo: true,
  level: 0.45,
  preload: false,
  params: { dur: { min: 8, max: 30, default: 16 } },
  gen(sr, rng, p) {
    const n = Math.floor(sr * (p.dur + 2));
    const chs: Channels = [new Float32Array(n), new Float32Array(n)];
    const swell = smoothNoise(n, sr, 0.1, rng);
    [146.8, 220, 329.6, 370, 440].forEach((f, k) => {
      for (let d = 0; d < 2; d++) {
        const drift = smoothNoise(n, sr, 0.2, rng);
        const s = sawOsc(n, sr, (i) => f * (1 + (d ? 0.003 : -0.003) + 0.0015 * drift[i]), rng.next());
        filt(s, 'lowpass', sr, 900, 0.6);
        filt(s, 'lowpass', sr, 1400);
        panInto(chs, s, (k / 4) * 1.2 - 0.6 + (d ? 0.2 : -0.2), 0, 0.09);
      }
    });
    for (const c of chs) for (let i = 0; i < n; i++) c[i] *= 0.7 + 0.3 * swell[i];
    return chs.map((x) => makeLoop(x, sr, 2));
  },
};

/** A distant bird at dawn: FM chirp sequence (2–5 notes), a little room/field air. */
const bird: Recipe = {
  id: 'score_bird',
  label: 'Score: distant bird',
  category: 'score',
  bus: 'ambience',
  variants: 6,
  level: 0.3,
  preload: false,
  gen(sr, rng) {
    const out = buf(sr, 1.4);
    let t = 0.02;
    const base = rng.range(2600, 4200);
    for (let k = rng.int(2, 5); k > 0; k--) {
      const d = rng.range(0.06, 0.16);
      const m = Math.floor(sr * d);
      const up = rng.next() < 0.5;
      const x = sineOsc(m, sr, (i) => {
        const u = i / m;
        const glide = up ? 0.8 + 0.5 * u : 1.3 - 0.5 * u;
        return base * glide * (1 + 0.04 * Math.sin(2 * Math.PI * 60 * (i / sr)));
      });
      for (let i = 0; i < m; i++) x[i] *= Math.sin((Math.PI * i) / m) ** 2;
      mixInto(out, x, t * sr, rng.range(0.5, 1));
      t += d + rng.range(0.03, 0.12);
    }
    filt(out, 'lowpass', sr, 6000);
    return [out];
  },
};

export const SCORE_RECIPES: Recipe[] = [drone, chaseCluster, thresholdStinger, revealHit, finalBell, blueHourPad, bird];
