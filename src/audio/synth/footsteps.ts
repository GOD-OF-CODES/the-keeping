// The driver's footsteps per acoustic surface (layout AcousticSurface), with seeded variations.
//
// Farnell "Footsteps": a step is not one impact but a short gesture — heel strike, roll, ball/toe contact (and a
// scuff on lift-off) — and the SURFACE decides the excitation: granular crunches for gravel, hollow board
// resonances for wood, damped cloth for the runner, suction for mud. `weight` scales force (crouch 0.5 → run 1.4).

import { Rng, buf, click, filt, mixInto, pink, white, blip, expDecay, trimTail, scale } from './dsp.ts';
import { woodImpact, thud, woodCreak, droplet } from './common.ts';
import type { Recipe, Params } from './types.ts';

/** Heel / ball timing for a step (seconds), jittered. */
function phases(rng: Rng, weight: number): [number, number] {
  return [0, rng.range(0.045, 0.085) / Math.max(0.6, Math.min(1.3, weight))];
}

function shoeScuff(sr: number, rng: Rng, lo: number, hi: number, dur: number): Float32Array {
  const n = Math.floor(sr * dur);
  const x = white(n, rng);
  filt(x, 'highpass', sr, lo);
  filt(x, 'lowpass', sr, hi);
  for (let i = 0; i < n; i++) x[i] *= Math.sin((i / n) * Math.PI) ** 2;
  return x;
}

type StepGen = (sr: number, rng: Rng, p: Params) => Float32Array;

/** Runner carpet over boards: the pile swallows the transient; a dull thud and cloth brush. Quietest (2 m). */
const runner: StepGen = (sr, rng, p) => {
  const out = buf(sr, 0.4);
  const [h, b] = phases(rng, p.weight);
  mixInto(out, thud(sr, rng, rng.range(85, 120), 0.2, 0.25), h * sr, 0.7 * p.weight);
  mixInto(out, thud(sr, rng, rng.range(100, 140), 0.15, 0.2), b * sr, 0.45 * p.weight);
  const s = shoeScuff(sr, rng, 400, 2500, rng.range(0.06, 0.1));
  mixInto(out, s, b * sr, 0.12 * p.weight);
  return out;
};

/** Bare boards: hollow joist-supported planks ring briefly; hard shoe heel click. */
const bareWood: StepGen = (sr, rng, p) => {
  const out = buf(sr, 0.45);
  const [h, b] = phases(rng, p.weight);
  const f0 = rng.range(140, 210);
  mixInto(out, woodImpact(sr, rng, { f0, dur: 0.3, damp: 1.2, hardness: 0.75 }), h * sr, 0.9 * p.weight);
  mixInto(out, thud(sr, rng, rng.range(70, 95), 0.2, 0.2), h * sr, 0.5 * p.weight);
  mixInto(out, woodImpact(sr, rng, { f0: f0 * 1.15, dur: 0.2, damp: 1.6, hardness: 0.5 }), b * sr, 0.5 * p.weight);
  if (rng.next() < 0.25) {
    // a board shifting against its nail
    mixInto(out, woodCreak(sr, rng, { dur: rng.range(0.08, 0.18), f0: rng.range(450, 700), rate: 300 }), (b + 0.02) * sr, 0.25);
  }
  return out;
};

/** The marked creakers: the board flexes and its nail/tongue rubs — a long, loud, pitched groan (7 m). */
const creaker: StepGen = (sr, rng, p) => {
  const out = buf(sr, 0.95);
  mixInto(out, bareWood(sr, rng, p), 0, 0.8);
  const dur = rng.range(0.35, 0.6);
  const c = woodCreak(sr, rng, {
    dur,
    f0: rng.range(230, 330),
    rate: rng.range(110, 170),
    speedAt: (t) => Math.sin(Math.PI * t) ** 0.7,
    pressureAt: (t) => 0.8 + 0.6 * t,
    q: 16,
  });
  mixInto(out, c, rng.range(0.02, 0.06) * sr, 1.1 * Math.max(0.6, p.weight));
  return out;
};

/** Stair treads: a tread over an open riser box — lower, boomier, and more likely to creak. */
const stairWood: StepGen = (sr, rng, p) => {
  const out = buf(sr, 0.6);
  const [h, b] = phases(rng, p.weight);
  const f0 = rng.range(110, 150);
  mixInto(out, woodImpact(sr, rng, { f0, dur: 0.4, damp: 0.9, hardness: 0.7 }), h * sr, 1 * p.weight);
  mixInto(out, thud(sr, rng, rng.range(60, 80), 0.3, 0.3), h * sr, 0.6 * p.weight);
  mixInto(out, woodImpact(sr, rng, { f0: f0 * 1.3, dur: 0.2, damp: 1.5, hardness: 0.4 }), b * sr, 0.4 * p.weight);
  if (rng.next() < 0.45) mixInto(out, woodCreak(sr, rng, { dur: rng.range(0.12, 0.3), f0: rng.range(300, 480), rate: 200 }), (b + 0.03) * sr, 0.45);
  return out;
};

/**
 * Gravel: the sole compresses a bed of stones — dozens of tiny stone-on-stone clicks spread over ~60–120 ms
 * (granular synthesis), their spectrum 1–7 kHz, plus a low thump and wet grit (it's raining).
 */
const gravel: StepGen = (sr, rng, p) => {
  const out = buf(sr, 0.4);
  const [h, b] = phases(rng, p.weight);
  for (const [t0, amt] of [[h, 1], [b, 0.7]] as const) {
    const grains = Math.floor(rng.range(25, 45) * p.weight * amt);
    const spread = rng.range(0.05, 0.11);
    for (let i = 0; i < grains; i++) {
      const c = click(sr, rng, rng.range(0.2, 0.9));
      filt(c, 'bandpass', sr, rng.range(1200, 6500), 3);
      const u = Math.pow(rng.next(), 1.6);
      mixInto(out, c, (t0 + u * spread) * sr, rng.range(0.3, 1) * (1 - u * 0.6) * 1.8 * amt);
    }
    mixInto(out, thud(sr, rng, rng.range(70, 100), 0.12, 0.4), t0 * sr, 0.35 * p.weight * amt);
  }
  const wet = shoeScuff(sr, rng, 2500, 9000, 0.12);
  mixInto(out, wet, h * sr, 0.1);
  return out;
};

/** Porch: exterior boards, wet — hollow and a little looser than the hall, plus a splash from standing water. */
const porch: StepGen = (sr, rng, p) => {
  const out = buf(sr, 0.5);
  const [h, b] = phases(rng, p.weight);
  const f0 = rng.range(120, 170);
  mixInto(out, woodImpact(sr, rng, { f0, dur: 0.35, damp: 1.1, hardness: 0.6 }), h * sr, 0.9 * p.weight);
  mixInto(out, thud(sr, rng, 75, 0.25, 0.3), h * sr, 0.5 * p.weight);
  mixInto(out, woodImpact(sr, rng, { f0: f0 * 1.2, dur: 0.2, damp: 1.5, hardness: 0.4 }), b * sr, 0.45 * p.weight);
  const sp = white(Math.floor(sr * 0.08), rng);
  filt(sp, 'highpass', sr, 2500);
  expDecay(sp, sr, 0.02);
  mixInto(out, sp, (h + 0.003) * sr, 0.25);
  for (let i = rng.int(1, 4); i > 0; i--) mixInto(out, droplet(sr, rng, { size: 0.6 }), (h + rng.range(0.01, 0.08)) * sr, 0.2);
  return out;
};

/**
 * Mud: the sole sinks (low squelch — air pockets popping as low Minnaert bubbles) and on lift-off the suction
 * releases with a wet smack.
 */
const mud: StepGen = (sr, rng, p) => {
  const out = buf(sr, 0.6);
  mixInto(out, thud(sr, rng, rng.range(60, 90), 0.2, 0.6), 0, 0.5 * p.weight);
  for (let i = rng.int(4, 9); i > 0; i--) {
    const f = rng.range(120, 380);
    mixInto(out, blip(sr, f, f * rng.range(1.2, 2), rng.range(0.02, 0.06)), rng.range(0.005, 0.12) * sr, rng.range(0.2, 0.5));
  }
  const n = Math.floor(sr * 0.12);
  const suck = pink(n, rng);
  filt(suck, 'bandpass', sr, rng.range(500, 900), 2);
  for (let i = 0; i < n; i++) suck[i] *= Math.sin((i / n) * Math.PI) ** 3;
  mixInto(out, suck, rng.range(0.25, 0.35) * sr, 0.6);
  const pop = blip(sr, 250, 600, 0.04);
  mixInto(out, pop, rng.range(0.34, 0.4) * sr, 0.5);
  return out;
};

function stepRecipe(id: string, label: string, gen: StepGen, level: number, variants = 8): Recipe {
  return {
    id,
    label,
    category: 'footsteps',
    bus: 'player',
    variants,
    level,
    params: { weight: { min: 0.4, max: 1.5, default: 1 } },
    gen: (sr, rng, p) => [trimTail(scale(gen(sr, rng, p), 1), sr)],
  };
}

export const FOOTSTEP_RECIPES: Recipe[] = [
  stepRecipe('step_runner', 'Step: runner', runner, 0.35),
  stepRecipe('step_bare', 'Step: bare wood', bareWood, 0.55),
  stepRecipe('step_creaker', 'Step: creaker board', creaker, 0.75, 4),
  stepRecipe('step_stair', 'Step: stair wood', stairWood, 0.6),
  stepRecipe('step_gravel', 'Step: gravel', gravel, 0.5),
  stepRecipe('step_porch', 'Step: porch', porch, 0.55),
  stepRecipe('step_mud', 'Step: mud', mud, 0.5, 6),
];

/** Surface → footstep recipe id (layout AcousticSurface names). */
export const SURFACE_STEP: Record<string, string> = {
  runner: 'step_runner',
  carpet: 'step_runner',
  bare_wood: 'step_bare',
  porch_wood: 'step_porch',
  stair_wood: 'step_stair',
  tile: 'step_bare',
  linoleum: 'step_bare',
  gravel: 'step_gravel',
  mud: 'step_mud',
  grass: 'step_mud',
  asphalt: 'step_gravel',
  car: 'step_runner',
};
