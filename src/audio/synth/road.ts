// County Road 9 (docs/C1-OPENING.md §3 C0, §4 C1, §7.13): the exterior of the opening drive. All synthesized.
//   car_pass_by   our sedan passing a fixed microphone: Doppler, 1/r, tyre hiss on wet asphalt, a little spray
//   rain_leaves   hard rain on a conifer canopy and the forest floor (stereo bed)
//   wire_wind     the aeolian tone of sagging power-line conductors in the wind (Strouhal), with beating
//   knob_click    the headlamp knob's dome detent (pull-switch click)
//   map_paper     a folded road map shuffled on a vinyl seat
//   spray_hit     a sheet of road spray hitting the windscreen (the truck pass, C1 S5)

import { filt, mixInto, pink, white, smoothNoise, expDecay, makeLoop, click, resonate } from './dsp.ts';
import { sawOsc, sineOsc, droplet } from './common.ts';
import type { Recipe } from './types.ts';

const C_SOUND = 343; // m/s at 20 °C

/**
 * A car passing at v = 19 m/s (≈ 42 mph), closest approach d0 (m) at `pass` seconds. Distance r(t) = √(d0² + (v·Δt)²);
 * amplitude ∝ 1/r; Doppler f' = f·c / (c − v_r), v_r = the radial speed (+ approaching): ×1.059 → ×0.948 at 19 m/s.
 * Sources: engine firing at 2200 rpm (straight-4: 2 pulses/rev → 73 Hz) under the muffler; tyre hiss on a wet road
 * (broadband 0.6–6 kHz, the dominant pass-by component on wet asphalt) + spray tail.
 */
const carPassBy: Recipe = {
  id: 'car_pass_by',
  label: 'Car passes by (wet road, Doppler)',
  category: 'car',
  bus: 'sfx',
  variants: 2,
  level: 0.7,
  params: { dur: { min: 3, max: 6, default: 4.5 }, d0: { min: 3, max: 40, default: 8 }, v: { min: 10, max: 30, default: 19 } },
  gen(sr, rng, p) {
    const n = Math.floor(sr * p.dur);
    const pass = 0.5 * p.dur;
    const r = (i: number) => Math.hypot(p.d0, p.v * (i / sr - pass));
    const vr = (i: number) => (p.v * p.v * (pass - i / sr)) / Math.max(0.5, r(i)); // radial speed toward the mic
    const dop = (i: number) => C_SOUND / (C_SOUND - vr(i));
    const engine = sawOsc(n, sr, (i) => 73 * dop(i));
    filt(engine, 'lowpass', sr, 260);
    const hiss = pink(n, rng);
    filt(hiss, 'highpass', sr, 600);
    filt(hiss, 'lowpass', sr, 6000);
    const wob = smoothNoise(n, sr, 9, rng); // tread / puddles
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = p.d0 / r(i); // 1 at the closest point
      // tyre hiss is directional forward/back of the wheel: slightly louder receding (spray)
      const behind = i / sr > pass ? 1.25 : 1;
      x[i] = (engine[i] * 0.35 + hiss[i] * 0.9 * behind * (0.85 + 0.15 * wob[i])) * a;
    }
    // air absorption: distant = duller (a gentle lowpass on the whole event, the near part keeps its top)
    filt(x, 'lowpass', sr, 7000);
    return [x];
  },
};

/** Hard rain (≈ 8 mm/h) on pine needles and the forest floor: dense small drops, needles damp the impact
 *  (lowpass ≈ 4 kHz), a steady pink bed, slow gusts. Stereo, 8 s loop. */
const rainLeaves: Recipe = {
  id: 'rain_leaves',
  renderRate: 0.5,
  label: 'Rain on the forest (loop)',
  category: 'weather',
  bus: 'weather',
  variants: 1,
  loop: true,
  stereo: true,
  level: 0.5,
  params: { dur: { min: 4, max: 12, default: 8 } },
  gen(sr, rng, p) {
    const n = Math.floor(sr * p.dur);
    const ch = [0, 1].map(() => {
      const x = pink(n, rng);
      const gust = smoothNoise(n, sr, 0.15, rng);
      for (let i = 0; i < n; i++) x[i] *= 0.4 * (0.75 + 0.25 * gust[i]);
      let t = 0;
      while (t < p.dur) {
        const d = droplet(sr, rng, { f: rng.range(1800, 4200), size: rng.range(0.3, 0.8), wet: 0.6 });
        mixInto(x, d, t * sr, rng.range(0.02, 0.09));
        t += rng.exp(0.004);
      }
      filt(x, 'lowpass', sr, 4200);
      filt(x, 'highpass', sr, 120);
      return makeLoop(x, sr, 0.5);
    });
    return ch;
  },
};

/** Aeolian tone: vortex shedding off a 12.7 mm conductor, f = St·U/D with St ≈ 0.2. U 6–10 m/s → 95–160 Hz.
 *  Three conductors at slightly different spans beat; gusts sweep the pitch. Mono, 10 s loop (spatial at the pole). */
const wireWind: Recipe = {
  id: 'wire_wind',
  renderRate: 0.5,
  label: 'Power lines humming in the wind (loop)',
  category: 'weather',
  bus: 'ambience',
  variants: 1,
  loop: true,
  level: 0.35,
  params: { dur: { min: 6, max: 14, default: 10 } },
  gen(sr, rng, p) {
    const n = Math.floor(sr * p.dur);
    const D = 0.0127;
    const x = new Float32Array(n);
    for (let k = 0; k < 3; k++) {
      const u = smoothNoise(n, sr, 0.25, rng);
      const amp = smoothNoise(n, sr, 0.4, rng);
      const U0 = 8 + rng.range(-0.6, 0.6);
      const tone = sineOsc(n, sr, (i) => (0.2 * (U0 + 2 * u[i])) / D);
      const h2 = sineOsc(n, sr, (i) => (0.4 * (U0 + 2 * u[i])) / D);
      for (let i = 0; i < n; i++) x[i] += (tone[i] + 0.25 * h2[i]) * Math.max(0, 0.5 + 0.5 * amp[i]) * 0.3;
    }
    const air = pink(n, rng);
    filt(air, 'bandpass', sr, 400, 0.6);
    mixInto(x, air, 0, 0.12);
    return [makeLoop(x, sr, 0.8)];
  },
};

/** A 1970s pull-switch headlamp knob turned to the dome detent: a plastic tick + a metal detent snap. */
const knobClick: Recipe = {
  id: 'knob_click',
  label: 'Headlamp knob detent',
  category: 'car',
  bus: 'sfx',
  variants: 2,
  level: 0.45,
  gen(sr, rng) {
    const x = new Float32Array(Math.floor(sr * 0.12));
    mixInto(x, click(sr, rng, 1.2), 0, 0.6);
    const snap = resonate(click(sr, rng, 0.6), sr, [
      { freq: 3100 * rng.range(0.95, 1.05), q: 18, gain: 0.8 },
      { freq: 5400, q: 14, gain: 0.4 },
    ]);
    expDecay(snap, sr, 0.012);
    mixInto(x, snap, sr * 0.018, 0.9);
    return [x];
  },
};

/** A folded paper road map picked up off a vinyl seat: crinkle bursts (stick-slip of creases) over a soft slide. */
const mapPaper: Recipe = {
  id: 'map_paper',
  label: 'Road map paper',
  category: 'props',
  bus: 'sfx',
  variants: 2,
  level: 0.4,
  gen(sr, rng) {
    const dur = rng.range(0.9, 1.4);
    const n = Math.floor(sr * dur);
    const slide = pink(n, rng);
    const env = smoothNoise(n, sr, 3, rng);
    for (let i = 0; i < n; i++) slide[i] *= 0.15 * Math.max(0, 0.4 + 0.6 * env[i]) * Math.sin((Math.PI * i) / n);
    filt(slide, 'highpass', sr, 900);
    let t = 0.05;
    while (t < dur - 0.05) {
      const c = click(sr, rng, rng.range(2, 9));
      filt(c, 'bandpass', sr, rng.range(2500, 6500), 1.2);
      mixInto(slide, c, t * sr, rng.range(0.1, 0.5));
      t += rng.exp(0.035);
    }
    return [slide];
  },
};

/** A sheet of tyre spray from an oncoming truck (25 m/s) slapping the windscreen: a broadband splash with a
 *  water-on-glass ring, then dripping off. 1.4 s. */
const sprayHit: Recipe = {
  id: 'spray_hit',
  label: 'Road spray hits the windscreen',
  category: 'car',
  bus: 'sfx',
  variants: 1,
  level: 0.75,
  gen(sr, rng) {
    const n = Math.floor(sr * 1.4);
    const x = white(n, rng);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      x[i] *= Math.min(1, t / 0.015) * Math.exp(-t / 0.28);
    }
    filt(x, 'bandpass', sr, 2600, 0.5);
    const thump = sineOsc(Math.floor(sr * 0.15), sr, () => 70);
    expDecay(thump, sr, 0.04);
    mixInto(x, thump, 0, 0.5);
    let t = 0.25;
    while (t < 1.35) {
      mixInto(x, droplet(sr, rng, { f: rng.range(2200, 3800), size: rng.range(0.4, 0.9), wet: 0.8 }), t * sr, rng.range(0.05, 0.15) * (1.4 - t));
      t += rng.exp(0.03);
    }
    return [x];
  },
};

export const ROAD_RECIPES: Recipe[] = [carPassBy, rainLeaves, wireWind, knobClick, mapPaper, sprayHit];
