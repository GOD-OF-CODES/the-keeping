// Weather: rain beds per surface (seamless loops), thunder (near crack / distant roll, duration param), wind,
// gutter, eaves drips, window rattle. Rain loops are stereo beds (non-positional); the "inside" variant is what
// the house sounds like with rain on the roof two floors up.
//
// Rain (Farnell "Rain"): a Poisson process of individual droplet impacts whose spectrum is the SURFACE's response,
// over a dense diffuse bed (thousands of distant drops merge into shaped noise). Surface = what differs:
//  - roof shingles: dull ticks + low drumming of the deck; heard inside it's a lowpassed wash
//  - glass: bright ticks with the pane's high modes + rivulet trickles
//  - porch boards: hollow "tok"s + splashes from puddles
//  - car roof: thin steel panel drumming (dense, pitched ~200–900 Hz resonances) — loud inside the car
//  - gravel: fine hiss + tiny splashes

import {
  Rng, buf, click, expDecay, filt, mixInto, pink, white, brown, resonate, smoothNoise, makeLoop, sweep, Biquad,
  type Channels,
} from './dsp.ts';
import { droplet, woodImpact, metalHit, thud } from './common.ts';
import type { Recipe } from './types.ts';

interface RainSurface {
  bed: { lo: number; hi: number; gain: number };
  rate: number; // drops/s per channel
  drop: (sr: number, rng: Rng) => { x: Float32Array; gain: number };
  body?: { freq: number; q: number; gain: number }[];
}

const SURFACES: Record<string, RainSurface> = {
  roof: {
    bed: { lo: 150, hi: 3500, gain: 0.55 },
    rate: 260,
    drop: (sr, rng) => {
      const c = click(sr, rng, rng.range(1, 3), 'pink');
      filt(c, 'bandpass', sr, rng.range(700, 2400), 1.5);
      return { x: c, gain: rng.range(0.15, 0.6) };
    },
    body: [{ freq: 140, q: 2, gain: 0.3 }, { freq: 380, q: 3, gain: 0.2 }],
  },
  glass: {
    bed: { lo: 1200, hi: 9000, gain: 0.25 },
    rate: 90,
    drop: (sr, rng) => {
      const c = click(sr, rng, rng.range(0.4, 1.2));
      const r = resonate(c, sr, [
        { freq: rng.range(2600, 3400), q: 25, gain: 1 },
        { freq: rng.range(4800, 6200), q: 25, gain: 0.6 },
      ]);
      mixInto(r, c, 0, 0.5);
      if (rng.next() < 0.25) mixInto(r, droplet(sr, rng, { f: rng.range(1800, 3200), size: 0.5 }), 0, 0.4);
      return { x: r, gain: rng.range(0.2, 1) };
    },
  },
  porch: {
    bed: { lo: 250, hi: 6000, gain: 0.45 },
    rate: 140,
    drop: (sr, rng) => {
      if (rng.next() < 0.35) return { x: droplet(sr, rng, { f: rng.range(600, 1400), size: rng.range(0.8, 1.4) }), gain: rng.range(0.2, 0.6) };
      return { x: woodImpact(sr, rng, { f0: rng.range(300, 520), dur: 0.08, damp: 2.5, hardness: 0.8 }), gain: rng.range(0.1, 0.35) };
    },
  },
  car: {
    bed: { lo: 180, hi: 5000, gain: 0.5 },
    rate: 380,
    drop: (sr, rng) => {
      const c = click(sr, rng, rng.range(0.5, 1.5));
      return { x: c, gain: rng.range(0.2, 0.8) };
    },
    // thin steel roof panel: excited by every drop
    body: [
      { freq: 210, q: 14, gain: 0.7 }, { freq: 330, q: 16, gain: 0.6 }, { freq: 470, q: 18, gain: 0.5 },
      { freq: 640, q: 18, gain: 0.4 }, { freq: 910, q: 20, gain: 0.3 }, { freq: 1350, q: 20, gain: 0.2 },
    ],
  },
  gravel: {
    bed: { lo: 800, hi: 11000, gain: 0.5 },
    rate: 220,
    drop: (sr, rng) => (rng.next() < 0.3
      ? { x: droplet(sr, rng, { size: rng.range(0.3, 0.8) }), gain: rng.range(0.1, 0.3) }
      : { x: (() => { const c = click(sr, rng, 0.6); filt(c, 'highpass', sr, 2500); return c; })(), gain: rng.range(0.1, 0.4) }),
  },
};

function rainBed(sr: number, rng: Rng, s: RainSurface, dur: number, intensity: number): Channels {
  const n = Math.floor(sr * dur);
  const chs: Channels = [];
  const swell = smoothNoise(n, sr, 0.25, rng); // gusts sweep the rain across the surface
  for (let c = 0; c < 2; c++) {
    const r = rng.fork(c + 1);
    const bed = pink(n, r);
    filt(bed, 'highpass', sr, s.bed.lo);
    filt(bed, 'lowpass', sr, s.bed.hi);
    const drops = new Float32Array(n);
    let t = r.exp(1 / (s.rate * intensity));
    while (t * sr < n) {
      const d = s.drop(sr, r);
      mixInto(drops, d.x, t * sr, d.gain);
      t += r.exp(1 / (s.rate * intensity));
    }
    const out = new Float32Array(n);
    mixInto(out, bed, 0, s.bed.gain * intensity);
    mixInto(out, drops, 0, 1);
    if (s.body) mixInto(out, resonate(drops, sr, s.body), 0, 1);
    for (let i = 0; i < n; i++) out[i] *= 0.85 + 0.15 * swell[i];
    chs.push(out);
  }
  return chs.map((x) => makeLoop(x, sr, 0.5));
}

function rainRecipe(id: string, label: string, surface: keyof typeof SURFACES, level: number, renderRate = 1): Recipe {
  return {
    id,
    renderRate,
    label,
    category: 'weather',
    bus: 'weather',
    variants: 1,
    loop: true,
    stereo: true,
    level,
    params: { intensity: { min: 0.3, max: 1.5, default: 1 }, dur: { min: 2, max: 12, default: 6 } },
    gen: (sr, rng, p) => rainBed(sr, rng, SURFACES[surface], p.dur, p.intensity),
  };
}

/** Rain on the roof heard from inside the house: the roof deck and attic lowpass everything to a soft wash. */
const rainInside: Recipe = {
  id: 'rain_inside',
  renderRate: 0.5,
  label: 'Rain: inside (muffled roof)',
  category: 'weather',
  bus: 'weather',
  variants: 1,
  loop: true,
  stereo: true,
  level: 0.45,
  params: { dur: { min: 2, max: 12, default: 7 } },
  gen(sr, rng, p) {
    const chs = rainBed(sr, rng, SURFACES.roof, p.dur + 0.5, 1);
    for (const c of chs) {
      filt(c, 'lowpass', sr, 700, 0.6);
      filt(c, 'lowpass', sr, 1100);
      filt(c, 'lowshelf', sr, 180, 0.7, 4);
    }
    return chs;
  },
};

/**
 * Thunder (Farnell "Thunder"): a lightning channel is kilometres of tortuous segments; each segment emits an
 * N-wave, and their arrivals smear over seconds by path length. Near: a sharp tearing crack (dense high-passed
 * N-wave cluster in the first ~0.3 s) then the roll. Distant: only the lowpassed roll survives (air absorbs highs).
 * `dur` sets the roll length; `distance` 0 (overhead) .. 1 (far) blends crack vs roll and darkens the spectrum.
 */
function thunder(sr: number, rng: Rng, dur: number, distance: number): Channels {
  const n = Math.floor(sr * (dur + 0.8));
  const chs: Channels = [];
  const onset = distance * 0.25;
  const env = smoothNoise(n, sr, 3, rng); // shared rumble shape so L/R roll together
  for (let c = 0; c < 2; c++) {
    const r = rng.fork(17 + c);
    const out = new Float32Array(n);
    // N-wave arrivals: density decays over time, amplitude decays, each gets darker the later it arrives
    const segments = Math.floor(260 * dur);
    for (let k = 0; k < segments; k++) {
      const u = Math.pow(r.next(), 1.8); // bunch arrivals early
      const t = onset + u * dur;
      const len = Math.floor(sr * r.range(0.004, 0.03) * (1 + u * 3 + distance * 2));
      const w = new Float32Array(len);
      for (let i = 0; i < len; i++) w[i] = 1 - (2 * i) / len; // N-wave
      const amp = Math.exp(-u * 2.2) * r.range(0.2, 1) * (r.next() < 0.04 ? 3 : 1);
      mixInto(out, w, t * sr, amp * 0.25);
    }
    // rumble bed
    const rum = brown(n, r);
    for (let i = 0; i < n; i++) {
      const tt = i / sr;
      const e = tt < onset ? 0 : Math.min(1, (tt - onset) / 0.4) * Math.exp(-(tt - onset) / (dur * 0.45));
      rum[i] *= e * (0.6 + 0.4 * env[i]) * 2.2;
    }
    mixInto(out, rum, 0, 1);
    const cutoff = 2600 * (1 - distance) + 180;
    sweep(out, 'lowpass', sr, (i) => cutoff * (0.25 + 0.75 * Math.exp(-(i / sr) / (dur * 0.35))) + 90, 0.7);
    if (distance < 0.5) {
      // the crack: tearing high-frequency cluster
      const crackN = Math.floor(sr * 0.5);
      const cr = white(crackN, r);
      filt(cr, 'highpass', sr, 900);
      let g = 0;
      for (let i = 0; i < crackN; i++) {
        if ((i & 63) === 0) g = r.next() < 0.3 ? r.range(0.5, 1) : r.range(0, 0.2);
        cr[i] *= g * Math.exp(-(i / sr) / 0.09);
      }
      mixInto(out, cr, Math.floor(sr * (onset + 0.005)), (1 - distance * 2) * 0.9);
      mixInto(out, thud(sr, r, 45, 1.2, 0.8), Math.floor(sr * onset), (1 - distance * 2) * 0.8);
    }
    filt(out, 'highpass', sr, 22);
    chs.push(out);
  }
  return chs;
}

const thunderNear: Recipe = {
  id: 'thunder_near',
  label: 'Thunder: near crack + roll',
  category: 'weather',
  bus: 'weather',
  variants: 2,
  stereo: true,
  level: 0.95,
  params: { dur: { min: 1.5, max: 8, default: 4 }, distance: { min: 0, max: 0.5, default: 0.1 } },
  gen: (sr, rng, p) => thunder(sr, rng, p.dur * rng.range(0.9, 1.1), p.distance),
};

const thunderDistant: Recipe = {
  id: 'thunder_distant',
  renderRate: 0.5,
  label: 'Thunder: distant roll',
  category: 'weather',
  bus: 'weather',
  variants: 2,
  stereo: true,
  level: 0.7,
  params: { dur: { min: 2, max: 10, default: 5 }, distance: { min: 0.5, max: 1, default: 0.8 } },
  gen: (sr, rng, p) => thunder(sr, rng, p.dur * rng.range(0.9, 1.1), p.distance),
};

/**
 * Wind (Farnell "Wind"): pink noise through a bandpass whose centre and gain follow a slow gust signal, plus
 * "whistle" components — narrow resonances of gaps/keyholes/window frames that only speak above a gust threshold.
 */
const wind: Recipe = {
  id: 'wind',
  renderRate: 0.5,
  label: 'Wind / drafts',
  category: 'weather',
  bus: 'weather',
  variants: 1,
  loop: true,
  stereo: true,
  level: 0.5,
  params: { dur: { min: 4, max: 20, default: 12 }, whistle: { min: 0, max: 1, default: 0.4 } },
  gen(sr, rng, p) {
    const n = Math.floor(sr * p.dur);
    const gust = smoothNoise(n, sr, 0.18, rng);
    const fine = smoothNoise(n, sr, 1.3, rng);
    const chs: Channels = [];
    for (let c = 0; c < 2; c++) {
      const r = rng.fork(c + 5);
      const x = pink(n, r);
      const g = (i: number) => Math.max(0, 0.55 + 0.45 * gust[i] + 0.12 * fine[i]);
      sweep(x, 'bandpass', sr, (i) => 250 + 700 * g(i) ** 2, 0.9);
      for (let i = 0; i < n; i++) x[i] *= 0.3 + 0.9 * g(i);
      if (p.whistle > 0) {
        const w = white(n, r);
        const f = r.range(620, 1100);
        const bq = new Biquad('bandpass', sr, f, 40);
        for (let i = 0; i < n; i++) {
          if ((i & 63) === 0) bq.set(f * (0.97 + 0.06 * g(i)), 40);
          const th = Math.max(0, g(i) - 0.75) * 4;
          x[i] += bq.tick(w[i]) * th * p.whistle * 3;
        }
      }
      chs.push(makeLoop(x, sr, 1.5));
    }
    return chs;
  },
};

/** Gutter/downspout: a stream of water through a metal tube — bubbles + noise through a tube comb resonance. */
const gutter: Recipe = {
  id: 'gutter',
  renderRate: 0.5,
  label: 'Rain: gutter / downspout',
  category: 'weather',
  bus: 'weather',
  variants: 1,
  loop: true,
  level: 0.4,
  params: { dur: { min: 2, max: 10, default: 5 } },
  gen(sr, rng, p) {
    const n = Math.floor(sr * p.dur);
    const x = new Float32Array(n);
    let t = 0;
    while (t < p.dur) {
      mixInto(x, droplet(sr, rng, { f: rng.range(300, 1200), size: rng.range(0.6, 1.6) }), t * sr, rng.range(0.2, 0.7));
      t += rng.exp(0.012);
    }
    const nz = pink(n, rng);
    filt(nz, 'bandpass', sr, 900, 0.8);
    mixInto(x, nz, 0, 0.3);
    const tube = resonate(x, sr, [{ freq: 240, q: 8, gain: 0.6 }, { freq: 480, q: 8, gain: 0.4 }, { freq: 720, q: 8, gain: 0.25 }]);
    mixInto(tube, x, 0, 0.6);
    return [makeLoop(tube, sr, 0.4)];
  },
};

/** Eaves drips after the rain (blue hour): sparse heavy drops onto porch boards and into a puddle. */
const eavesDrip: Recipe = {
  id: 'eaves_drip',
  label: 'Eaves drip',
  category: 'weather',
  bus: 'weather',
  variants: 6,
  level: 0.5,
  gen(sr, rng) {
    const out = buf(sr, 0.3);
    if (rng.next() < 0.5) mixInto(out, woodImpact(sr, rng, { f0: rng.range(350, 500), dur: 0.1, damp: 2, hardness: 0.7 }), 0, 0.5);
    mixInto(out, droplet(sr, rng, { f: rng.range(500, 1200), size: rng.range(1, 1.6) }), 0, 1);
    return [out];
  },
};

/** Window rattle in a thunder pressure wave: loose sash knocking in its frame + glass buzz. */
const windowRattle: Recipe = {
  id: 'window_rattle',
  label: 'Window rattle',
  category: 'weather',
  bus: 'weather',
  variants: 3,
  level: 0.5,
  gen(sr, rng) {
    const out = buf(sr, 1.2);
    let t = 0;
    const k = rng.int(6, 14);
    for (let i = 0; i < k; i++) {
      const a = Math.exp(-t / 0.4);
      mixInto(out, woodImpact(sr, rng, { f0: rng.range(600, 900), dur: 0.06, damp: 3, hardness: 0.9 }), t * sr, a * 0.6);
      mixInto(out, metalHit(sr, rng, { f0: rng.range(1800, 2400), ratios: [1, 2.3, 3.9], decay: 0.02, dur: 0.06 }), t * sr, a * 0.25);
      t += rng.range(0.03, 0.08);
    }
    expDecay(out, sr, 2);
    return [out];
  },
};

export const WEATHER_RECIPES: Recipe[] = [
  rainRecipe('rain_roof', 'Rain: roof (upstairs)', 'roof', 0.5, 0.5),
  rainRecipe('rain_glass', 'Rain: window glass', 'glass', 0.45),
  rainRecipe('rain_porch', 'Rain: porch boards', 'porch', 0.55, 0.5),
  rainRecipe('rain_car', 'Rain: car roof (inside car)', 'car', 0.6, 0.5),
  rainRecipe('rain_gravel', 'Rain: gravel drive', 'gravel', 0.5),
  rainInside,
  thunderNear,
  thunderDistant,
  wind,
  gutter,
  eavesDrip,
  windowRattle,
];
