// Ada's tells (DESIGN "Tells"): every one is mono so the runtime can put it in an HRTF panner and occlude it with
// the same room graph her hearing uses. The drip LOOP itself is scheduled live by engine.ts (rate follows her
// speed); the bank holds individual drips so no two consecutive drops are identical.

import {
  Rng, buf, click, expDecay, filt, mixInto, pink, white, blip, resonate, stickSlip, smoothNoise, sweep, trimTail,
} from './dsp.ts';
import { droplet, thud, scrapeNoise, metalHit } from './common.ts';
import type { Recipe } from './types.ts';

/**
 * One drip off her hair/gown onto boards (Farnell "Water: drips"): the drop hits a thin film of water on wood — a
 * tiny wooden tick, a splash spray of micro-droplets, and one Minnaert bubble ring with rising pitch.
 */
const drip: Recipe = {
  id: 'ada_drip',
  label: 'Ada: drip',
  category: 'ada',
  bus: 'creature',
  variants: 8,
  level: 0.6,
  params: { size: { min: 0.5, max: 2, default: 1 } },
  gen(sr, rng, p) {
    const out = buf(sr, 0.35);
    const size = p.size * rng.range(0.8, 1.25);
    const tick = click(sr, rng, 1.5 + size);
    filt(tick, 'bandpass', sr, rng.range(1800, 3200), 2);
    mixInto(out, tick, 0, 0.8);
    mixInto(out, droplet(sr, rng, { f: rng.range(700, 1600), size }), Math.floor(sr * 0.003), 0.9);
    // micro-splash: 2–5 tiny secondary droplets landing 10–60 ms later
    const k = rng.int(2, 5);
    for (let i = 0; i < k; i++) {
      mixInto(out, droplet(sr, rng, { f: rng.range(2500, 5000), size: 0.4 }), Math.floor(sr * rng.range(0.012, 0.07)), rng.range(0.1, 0.3));
    }
    return [trimTail(out, sr)];
  },
};

/**
 * The drip STOPPING is the tell (she is listening). The runtime simply halts the drip loop; this sound is the last,
 * heavier drop that lands a beat late plus a faint wet intake, so the silence afterwards reads as deliberate.
 */
const dripStop: Recipe = {
  id: 'ada_drip_stop',
  label: 'Ada: drip stops',
  category: 'ada',
  bus: 'creature',
  variants: 3,
  level: 0.55,
  gen(sr, rng) {
    const out = buf(sr, 1.1);
    mixInto(out, drip.gen(sr, rng, { size: 1.6 })[0], 0, 1);
    // a slow, thick drop that hangs and falls
    mixInto(out, droplet(sr, rng, { f: rng.range(500, 800), size: 1.8 }), Math.floor(sr * rng.range(0.35, 0.5)), 0.7);
    // barely-there wet breath in (throat full of water)
    const n = Math.floor(sr * 0.45);
    const air = pink(n, rng);
    filt(air, 'bandpass', sr, 900, 1.2);
    for (let i = 0; i < n; i++) air[i] *= Math.sin((i / n) * Math.PI) * 0.12;
    mixInto(out, air, Math.floor(sr * 0.55), 1);
    return [out];
  },
};

/**
 * Bone crack as her hand lifts her head: a cluster of 3–7 sharp fractures within ~180 ms (Farnell "Bones/snaps":
 * brittle fracture = broadband impulses whose spectra are coloured by the small bony cavities), riding on a dull
 * low "pop" of the joint and a short gristly creak.
 */
const boneCrack: Recipe = {
  id: 'ada_bone_crack',
  label: 'Ada: bone crack',
  category: 'ada',
  bus: 'creature',
  variants: 4,
  level: 0.8,
  gen(sr, rng) {
    const out = buf(sr, 0.6);
    const count = rng.int(3, 7);
    let t = 0.01;
    for (let i = 0; i < count; i++) {
      const c = click(sr, rng, rng.range(0.6, 2.5));
      const body = resonate(c, sr, [
        { freq: rng.range(900, 1500), q: 6, gain: 1 },
        { freq: rng.range(2200, 3400), q: 8, gain: 0.7 },
        { freq: rng.range(4200, 6000), q: 5, gain: 0.4 },
      ]);
      mixInto(out, body, Math.floor(sr * t), (i === 0 ? 1 : rng.range(0.35, 0.9)) * 6);
      mixInto(out, c, Math.floor(sr * t), 0.4);
      t += rng.range(0.012, 0.045) * (i < 2 ? 1 : 1.6);
    }
    mixInto(out, thud(sr, rng, rng.range(90, 140), 0.12, 0.6), Math.floor(sr * 0.012), 0.5);
    // gristle: short high-pressure stick-slip creak through a small cavity
    const n = Math.floor(sr * 0.14);
    const tr = stickSlip(n, sr, rng, (i) => Math.sin((i / n) * Math.PI), () => 1.4, 520);
    const g = resonate(tr, sr, [{ freq: rng.range(600, 900), q: 10, gain: 1 }, { freq: 1900, q: 9, gain: 0.5 }]);
    mixInto(out, g, Math.floor(sr * (t + 0.01)), 0.35);
    return [trimTail(out, sr)];
  },
};

/**
 * Throat gurgle (within ~5 m): air forced through water in the throat. A stream of Minnaert bubbles (low, 90–400 Hz,
 * burst-clustered) passing through a throat/mouth formant, plus the turbulent airflow noise that drives them. The
 * burst rate is modulated by a slow noise so it lurches rather than bubbling evenly.
 */
const gurgle: Recipe = {
  id: 'ada_gurgle',
  label: 'Ada: throat gurgle',
  category: 'ada',
  bus: 'creature',
  variants: 4,
  level: 0.75,
  params: { dur: { min: 0.6, max: 3, default: 1.5 } },
  gen(sr, rng, p) {
    const dur = p.dur * rng.range(0.85, 1.15);
    const n = Math.floor(sr * dur);
    const src = new Float32Array(n);
    const drive = smoothNoise(n, sr, 5, rng);
    let t = 0;
    while (t < dur - 0.05) {
      const u = t / dur;
      const env = Math.sin(Math.PI * Math.min(1, u * 1.2)) ** 0.7;
      const d = 0.5 + 0.5 * drive[Math.floor(t * sr)];
      const f = rng.range(90, 420) * (0.8 + 0.4 * d);
      const b = blip(sr, f, f * rng.range(1.1, 1.8), rng.range(0.02, 0.07), rng.range(0.4, 1) * env);
      mixInto(src, b, Math.floor(t * sr), 1);
      t += rng.exp(0.028 / (0.3 + d * env + 0.05));
    }
    // airflow
    const air = pink(n, rng);
    filt(air, 'bandpass', sr, 500, 0.8);
    for (let i = 0; i < n; i++) air[i] *= (0.5 + 0.5 * drive[i]) * Math.sin(Math.PI * Math.min(1, (i / n) * 1.1)) * 0.5;
    mixInto(src, air, 0, 1);
    // throat + mouth cavity
    const out = resonate(src, sr, [
      { freq: 320, q: 3, gain: 1 },
      { freq: 820, q: 4, gain: 0.6 },
      { freq: 2300, q: 5, gain: 0.25 },
    ]);
    mixInto(out, src, 0, 0.35);
    return [out];
  },
};

/**
 * Wet barefoot slap on boards: sole-on-wood contact (dull flesh body ~120–180 Hz and a bright slap crack from air
 * trapped under the wet sole), followed by a splash of droplets. Heel then ball of foot ~70 ms apart.
 */
const slap: Recipe = {
  id: 'ada_slap',
  label: 'Ada: wet barefoot slap',
  category: 'ada',
  bus: 'creature',
  variants: 8,
  level: 0.7,
  params: { weight: { min: 0.3, max: 1.5, default: 1 } },
  gen(sr, rng, p) {
    const out = buf(sr, 0.45);
    const hits = [0, rng.range(0.05, 0.09)];
    hits.forEach((t0, k) => {
      const amp = (k === 0 ? 1 : 0.65) * p.weight;
      mixInto(out, thud(sr, rng, rng.range(110, 170), 0.18, 0.5), Math.floor(sr * t0), amp * 0.7);
      const s = click(sr, rng, rng.range(2, 4));
      filt(s, 'bandpass', sr, rng.range(1400, 2600), 1.2);
      mixInto(out, s, Math.floor(sr * t0), amp * 1.4);
      const wet = white(Math.floor(sr * 0.05), rng);
      filt(wet, 'highpass', sr, 3000);
      expDecay(wet, sr, 0.012);
      mixInto(out, wet, Math.floor(sr * (t0 + 0.004)), amp * 0.35);
      for (let i = rng.int(2, 5); i > 0; i--) mixInto(out, droplet(sr, rng, { size: rng.range(0.4, 0.9) }), Math.floor(sr * (t0 + rng.range(0.01, 0.12))), 0.25 * amp);
    });
    return [trimTail(out, sr)];
  },
};

/** Sodden gown hem slapping the floor/legs: heavy cloth = low, smeared, no sharp transient. */
const gownSlap: Recipe = {
  id: 'ada_gown_slap',
  label: 'Ada: wet gown slap',
  category: 'ada',
  bus: 'creature',
  variants: 4,
  level: 0.45,
  gen(sr, rng) {
    const n = Math.floor(sr * 0.3);
    const x = pink(n, rng);
    filt(x, 'lowpass', sr, rng.range(900, 1400));
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      x[i] *= (t < 0.015 ? t / 0.015 : Math.exp(-(t - 0.015) / 0.05)) * 1.5;
    }
    mixInto(x, thud(sr, rng, 90, 0.15, 0.3), 0, 0.3);
    for (let i = rng.int(1, 3); i > 0; i--) mixInto(x, droplet(sr, rng, { size: 0.6 }), Math.floor(sr * rng.range(0.02, 0.15)), 0.2);
    return [x];
  },
};

/**
 * Fingernails dragged down plaster (SEARCH): four nails = four parallel stick-slip scrapes with slightly different
 * pressures, each exciting the nail's thin-plate squeal (2–5 kHz) and the hard plaster's hiss. The plaster is
 * gritty, so the friction noise is grain-modulated.
 */
const nailsPlaster: Recipe = {
  id: 'ada_nails_plaster',
  label: 'Ada: nails on plaster',
  category: 'ada',
  bus: 'creature',
  variants: 3,
  level: 0.6,
  params: { dur: { min: 0.6, max: 3, default: 1.6 } },
  gen(sr, rng, p) {
    const dur = p.dur * rng.range(0.9, 1.1);
    const n = Math.floor(sr * dur);
    const out = new Float32Array(n);
    const speed = (u: number) => Math.sin(Math.PI * Math.min(1, u * 1.05)) ** 0.6 * (0.7 + 0.3 * Math.sin(u * 17));
    for (let k = 0; k < 4; k++) {
      const pr = rng.range(0.6, 1.2);
      const tr = stickSlip(n, sr, rng, (i) => speed(i / n) * rng.range(0.95, 1.05), () => pr, rng.range(1800, 3200));
      const sq = resonate(tr, sr, [
        { freq: rng.range(2100, 3200), q: 18, gain: 1 },
        { freq: rng.range(3800, 5200), q: 14, gain: 0.5 },
        { freq: rng.range(900, 1300), q: 6, gain: 0.4 },
      ]);
      mixInto(out, sq, Math.floor(sr * k * rng.range(0.004, 0.02)), 0.25);
    }
    const hiss = scrapeNoise(n, sr, rng, { lo: 1500, hi: 9000, grain: 0.6, speedAt: speed });
    mixInto(out, hiss, 0, 0.35);
    // flecks of plaster falling
    for (let i = rng.int(3, 8); i > 0; i--) {
      const c = click(sr, rng, 0.8);
      filt(c, 'highpass', sr, 3000);
      mixInto(out, c, Math.floor(rng.range(0.1, 0.95) * n), 0.15);
    }
    return [out];
  },
};

/**
 * Scraping at wood (vigil / lured at the parlor door): nails at planks and nail heads. Slower, lower-pressure
 * friction through the plank's low resonances (300–1100 Hz), with small metallic ticks when a nail catches a
 * nail head. Strokes repeat 2–4 times.
 */
const scrapeWood: Recipe = {
  id: 'ada_scrape_wood',
  label: 'Ada: scraping wood',
  category: 'ada',
  bus: 'creature',
  variants: 3,
  level: 0.6,
  params: { dur: { min: 1, max: 5, default: 2.8 } },
  gen(sr, rng, p) {
    const dur = p.dur;
    const n = Math.floor(sr * dur);
    const out = new Float32Array(n);
    const strokes = rng.int(2, 4);
    const f0 = rng.range(280, 380);
    for (let s = 0; s < strokes; s++) {
      const t0 = (s / strokes) * dur + rng.range(0, 0.1);
      const len = (dur / strokes) * rng.range(0.55, 0.85);
      const m = Math.floor(sr * len);
      const sp = (u: number) => Math.sin(Math.PI * u) ** 0.8;
      const tr = stickSlip(m, sr, rng, (i) => sp(i / m), (i) => 1 + 0.4 * Math.sin((i / m) * 9), rng.range(260, 420));
      const body = resonate(tr, sr, [
        { freq: f0, q: 8, gain: 1 },
        { freq: f0 * 2.4, q: 9, gain: 0.6 },
        { freq: f0 * 3.9, q: 10, gain: 0.35 },
        { freq: rng.range(1800, 2600), q: 12, gain: 0.25 },
      ]);
      mixInto(out, body, Math.floor(sr * t0), 0.8);
      const hiss = scrapeNoise(m, sr, rng, { lo: 600, hi: 5000, grain: 0.8, speedAt: sp });
      mixInto(out, hiss, Math.floor(sr * t0), 0.25);
      if (rng.next() < 0.8) {
        const tick = metalHit(sr, rng, { f0: rng.range(2400, 3400), ratios: [1, 2.7, 5.1], decay: 0.03, dur: 0.1, amp: 0.4 });
        mixInto(out, tick, Math.floor(sr * (t0 + len * rng.range(0.3, 0.8))), 1);
      }
    }
    return [out];
  },
};

/**
 * Her near-sob at the dress (M2): no pitched voice (DESIGN) — a long wet in-breath catching in the water in her
 * throat, a shuddering exhale broken into 3–4 pulses, gurgle underneath.
 */
const sob: Recipe = {
  id: 'ada_sob',
  label: 'Ada: wet near-sob',
  category: 'ada',
  bus: 'creature',
  variants: 2,
  level: 0.65,
  preload: false,
  gen(sr, rng) {
    const out = buf(sr, 3.4);
    const inN = Math.floor(sr * 1.1);
    const inh = pink(inN, rng);
    sweep(inh, 'bandpass', sr, (i) => 700 + 900 * (i / inN), 2);
    for (let i = 0; i < inN; i++) inh[i] *= Math.sin((i / inN) * Math.PI * 0.5) * (1 + 0.5 * Math.sin(i / sr * 2 * Math.PI * 9));
    mixInto(out, inh, 0, 0.5);
    let t = 1.25;
    for (let k = 0; k < rng.int(3, 4); k++) {
      const m = Math.floor(sr * rng.range(0.22, 0.36));
      const ex = pink(m, rng);
      filt(ex, 'bandpass', sr, rng.range(380, 520), 1.5);
      for (let i = 0; i < m; i++) ex[i] *= Math.sin((i / m) * Math.PI) ** 0.5 * (0.9 - k * 0.15);
      mixInto(out, ex, Math.floor(sr * t), 0.7);
      t += m / sr + rng.range(0.03, 0.09);
    }
    mixInto(out, gurgle.gen(sr, rng, { dur: 2.2 })[0], Math.floor(sr * 0.9), 0.35);
    return [out];
  },
};

export const ADA_RECIPES: Recipe[] = [drip, dripStop, boneCrack, gurgle, slap, gownSlap, nailsPlaster, scrapeWood, sob];
