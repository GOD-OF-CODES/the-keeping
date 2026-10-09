// C2-ESCAPE §2.3 — the beheading, the rise, the stair and her return (all synthesized; lane C item C1). Mono unless
// noted (spatialised by the HRTF panner + room graph). Times and frequencies are the doc's physical numbers.
//
// Contact alignment (for scheduled cues, B12): `cleaver_sever` has its CONTACT at SEVER_CONTACT_S into the buffer
// (the swish precedes it) — schedule it at contact − SEVER_CONTACT_S. Every other one-shot starts on its onset.

import { Rng, buf, click, expDecay, filt, mixInto, pink, white, blip, resonate, stickSlip, sweep, trimTail, modal, makeLoop, adEnv } from './dsp.ts';
import { droplet, thud, woodImpact } from './common.ts';
import type { Recipe } from './types.ts';

/** Seconds from the start of `cleaver_sever` to blade contact (the swish leads by 110 ms, §2.3). */
export const SEVER_CONTACT_S = 0.11;

const env = (x: Float32Array, sr: number, f: (t: number) => number): Float32Array => {
  for (let i = 0; i < x.length; i++) x[i] *= f(i / sr);
  return x;
};

/**
 * One drop into blood/water on boards (§2.3 `blood_drip`): a 6 ms impact tick plus the Minnaert "plip" of the
 * entrained bubble, f ≈ 3.26 m·Hz / a → 1.6 kHz for a 2 mm bubble (radius ≈ 2 mm), ~15 ms decay. `depth` 0..1
 * (the pool deepening) drops the pitch by 10 % and softens the tick (the drop lands in liquid, not on wood).
 */
function bloodDrop(sr: number, rng: Rng, depth: number): Float32Array {
  const out = buf(sr, 0.12);
  const tick = click(sr, rng, 6);
  filt(tick, 'bandpass', sr, rng.range(2200, 3400), 1.6);
  expDecay(tick, sr, 0.0025);
  mixInto(out, tick, 0, 0.6 * (1 - 0.6 * depth));
  const f0 = (3.26 / rng.range(0.0018, 0.0023)) * (1 - 0.1 * depth); // Minnaert, a = 1.8–2.3 mm
  // the bubble ring rises in pitch as it pinches off (≈ +15 %), decays in ~15 ms
  const plip = blip(sr, f0, f0 * 1.15, 0.045, 1);
  expDecay(plip, sr, 0.015);
  mixInto(out, plip, Math.floor(sr * 0.002), 0.9);
  return trimTail(out, sr);
}

const bloodDrip: Recipe = {
  id: 'blood_drip',
  label: 'Blood: one drop into the pool',
  category: 'ada',
  bus: 'creature',
  variants: 8,
  level: 0.5,
  params: { depth: { min: 0, max: 1, default: 0.5 } },
  gen(sr, rng, p) {
    return [bloodDrop(sr, rng, p.depth)];
  },
};

/** B03 → C2: the slow drip under the sawbuck heard through the ajar door — about one drop every 0.7 s (§1). Loop. */
const parlorDripLoop: Recipe = {
  id: 'parlor_drip_loop',
  label: 'Parlor: drip into the pool (loop)',
  category: 'ada',
  bus: 'creature',
  variants: 1,
  loop: true,
  level: 0.45,
  gen(sr, rng) {
    const dur = 8.4; // 12 drops × 0.7 s
    const out = buf(sr, dur + 0.3);
    let t = 0.05;
    for (let k = 0; k < 12; k++) {
      mixInto(out, bloodDrop(sr, rng, 0.55 + 0.03 * k), Math.floor(sr * t), rng.range(0.75, 1));
      t += 0.7 + rng.range(-0.12, 0.12);
    }
    return [makeLoop(out, sr, 0.25)];
  },
};

/** B03 `T_B03_HALL`: the first stroke heard from the hall — the `wet_chop` layers, drier and shorter (no table rattle). */
const chopPartial: Recipe = {
  id: 'cleaver_chop_partial',
  label: 'Cleaver: a partial chop (heard from the hall)',
  category: 'harlan',
  bus: 'sfx',
  variants: 2,
  level: 0.8,
  gen(sr, rng) {
    const out = buf(sr, 0.7);
    const entry = click(sr, rng, 2.5);
    filt(entry, 'highpass', sr, 900);
    mixInto(out, entry, 0, 1.2);
    const wet = pink(Math.floor(sr * 0.2), rng);
    filt(wet, 'bandpass', sr, 650, 0.9);
    expDecay(wet, sr, 0.045);
    mixInto(out, wet, 0.002 * sr, 1);
    mixInto(out, woodImpact(sr, rng, { f0: rng.range(90, 110), dur: 0.4, damp: 0.9, hardness: 0.85 }), 0.025 * sr, 0.9);
    mixInto(out, thud(sr, rng, 60, 0.35, 0.5), 0.025 * sr, 0.6);
    return [trimTail(out, sr)];
  },
};

/**
 * C2 7.56 — the severing chop (§2.3 table): swish −110…−5 ms (band-passed noise sweeping 600 → 2400 Hz, blade at
 * 9 m/s, −18 dB); skin entry 0–25 ms (1.5–4 kHz burst, 3 ms attack, 20 ms decay, + 120 Hz thump, −6 dB); bone, the
 * C4–C5 split, 4–30 ms (modes 1.9 / 2.7 / 3.8 kHz, Q 12, τ 8–15 ms, + a 2 ms click, −3 dB); table bite 12–90 ms
 * (280 + 610 Hz plank modes τ 60 ms, rubber-sheet slap: 40 ms noise LP 1.2 kHz, −5 dB); wet squelch 20–220 ms (noise
 * through a 300/900 Hz formant pair, 6 Hz AM, −9 dB). The parlor reverb adds the 0.2–0.9 s tail at runtime.
 */
const cleaverSever: Recipe = {
  id: 'cleaver_sever',
  label: 'Cleaver: the severing chop (contact at 110 ms)',
  category: 'harlan',
  bus: 'sfx',
  variants: 2,
  level: 0.95,
  gen(sr, rng) {
    const C = SEVER_CONTACT_S;
    const out = buf(sr, C + 0.8);
    const db = (d: number) => Math.pow(10, d / 20);
    // swish
    const nS = Math.floor(sr * 0.105);
    const sw = white(nS, rng);
    sweep(sw, 'bandpass', sr, (i) => 600 + (2400 - 600) * Math.pow(i / nS, 1.6), 2.2);
    env(sw, sr, (t) => Math.pow(t / 0.105, 2));
    mixInto(out, sw, Math.floor(sr * (C - 0.11)), db(-18) * 2.5);
    const c0 = Math.floor(sr * C);
    // skin / tissue entry
    const nE = Math.floor(sr * 0.025);
    const sk = white(nE, rng);
    filt(sk, 'bandpass', sr, 2500, 0.9);
    env(sk, sr, (t) => adEnv(t, 0.003, 0.02 / 3));
    mixInto(out, sk, c0, db(-6) * 2);
    mixInto(out, thud(sr, rng, 120, 0.08, 0.3), c0, db(-6));
    // bone: three decaying modes + the dry click
    const bone = modal(Math.floor(sr * 0.08), sr, [
      { freq: 1900 * rng.range(0.97, 1.03), amp: 1, decay: 0.015 },
      { freq: 2700 * rng.range(0.97, 1.03), amp: 0.7, decay: 0.011 },
      { freq: 3800 * rng.range(0.97, 1.03), amp: 0.5, decay: 0.008 },
    ]);
    mixInto(out, bone, c0 + Math.floor(sr * 0.004), db(-3));
    mixInto(out, click(sr, rng, 2), c0 + Math.floor(sr * 0.004), db(-3) * 0.8);
    // table bite + the rubber sheet
    const plank = modal(Math.floor(sr * 0.3), sr, [
      { freq: 280, amp: 1, decay: 0.06 },
      { freq: 610, amp: 0.6, decay: 0.06 },
    ]);
    mixInto(out, plank, c0 + Math.floor(sr * 0.012), db(-5));
    const rub = white(Math.floor(sr * 0.04), rng);
    filt(rub, 'lowpass', sr, 1200);
    expDecay(rub, sr, 0.012);
    mixInto(out, rub, c0 + Math.floor(sr * 0.012), db(-5) * 1.5);
    // wet squelch: a 300 / 900 Hz formant pair, 6 Hz AM
    const nW = Math.floor(sr * 0.2);
    const wet = pink(nW, rng);
    const w = resonate(wet, sr, [
      { freq: 300, q: 4, gain: 1 },
      { freq: 900, q: 5, gain: 0.7 },
    ]);
    env(w, sr, (t) => (0.6 + 0.4 * Math.sin(2 * Math.PI * 6 * t)) * Math.sin(Math.PI * Math.min(1, t / 0.2)));
    mixInto(out, w, c0 + Math.floor(sr * 0.02), db(-9) * 1.5);
    // a few droplets off the blade
    for (let i = rng.int(3, 6); i > 0; i--) mixInto(out, droplet(sr, rng, { size: rng.range(0.5, 1) }), c0 + Math.floor(sr * rng.range(0.15, 0.6)), 0.12);
    return [out];
  },
};

/** C2 pulses 1–6 (§3.3): a 0.18 s noise burst, LP 2.2 kHz, shaped by the pulse envelope (fast rise, slower fall). */
const arterialSpurt: Recipe = {
  id: 'arterial_spurt',
  label: 'Blood: arterial spurt',
  category: 'ada',
  bus: 'creature',
  variants: 4,
  level: 0.55,
  params: { strength: { min: 0.2, max: 1, default: 1 } },
  gen(sr, rng, p) {
    const n = Math.floor(sr * 0.18);
    const x = white(n, rng);
    filt(x, 'lowpass', sr, 2200);
    filt(x, 'highpass', sr, 180);
    // systolic jet: ~30 ms rise, then the pressure falls off; a little hiss of spray riding on it
    env(x, sr, (t) => p.strength * adEnv(t, 0.03, 0.06) * (0.8 + 0.2 * Math.sin(2 * Math.PI * 38 * t)));
    return [x];
  },
};

/** Landings (§2.3): 20–60 Poisson grains over the landing window, each a 3–6 ms tick plus a 1.2–2.4 kHz plip. */
const bloodPatter: Recipe = {
  id: 'blood_patter',
  label: 'Blood: patter of landing drops',
  category: 'ada',
  bus: 'creature',
  variants: 4,
  level: 0.45,
  gen(sr, rng) {
    const dur = 0.45;
    const out = buf(sr, dur + 0.08);
    const k = rng.int(20, 60);
    for (let i = 0; i < k; i++) {
      const t = dur * Math.pow(rng.next(), 1.6); // dense at the start, thinning
      const tick = click(sr, rng, rng.range(3, 6));
      filt(tick, 'bandpass', sr, rng.range(2500, 4500), 1.2);
      expDecay(tick, sr, 0.0015);
      mixInto(out, tick, Math.floor(sr * t), rng.range(0.1, 0.35));
      const f = rng.range(1200, 2400);
      const pl = blip(sr, f, f * 1.12, 0.03, 1);
      expDecay(pl, sr, 0.01);
      mixInto(out, pl, Math.floor(sr * (t + 0.002)), rng.range(0.08, 0.3));
    }
    return [out];
  },
};

/** C2 7.90 off-screen: a 4.5 kg head on boards — 85 + 160 Hz board modes (τ 90 ms), a 20 ms wet slap, a smaller knock 0.18 s later. */
const headDrop: Recipe = {
  id: 'head_drop',
  label: 'Head: drops on the boards',
  category: 'ada',
  bus: 'creature',
  variants: 2,
  level: 0.9,
  gen(sr, rng) {
    const out = buf(sr, 0.9);
    const board = (g: number, at: number) => {
      mixInto(out, modal(Math.floor(sr * 0.5), sr, [
        { freq: 85 * rng.range(0.95, 1.05), amp: 1, decay: 0.09 },
        { freq: 160 * rng.range(0.95, 1.05), amp: 0.7, decay: 0.09 },
        { freq: 410, amp: 0.15, decay: 0.03 },
      ]), Math.floor(sr * at), g);
      const sl = pink(Math.floor(sr * 0.02), rng);
      filt(sl, 'bandpass', sr, 900, 0.8);
      mixInto(out, sl, Math.floor(sr * at), g * 0.9);
    };
    board(1, 0);
    board(0.35, 0.18); // the bounce
    for (let i = rng.int(2, 4); i > 0; i--) mixInto(out, droplet(sr, rng, { size: rng.range(0.8, 1.4) }), Math.floor(sr * rng.range(0.02, 0.4)), 0.2);
    return [trimTail(out, sr)];
  },
};

/** C2 9.45: a boot toe on wet hair and bone (a soft knock), then the roll — two wet rocks 0.6 s apart. */
const headNudge: Recipe = {
  id: 'head_nudge',
  label: 'Head: boot nudge and roll',
  category: 'ada',
  bus: 'creature',
  variants: 2,
  level: 0.7,
  gen(sr, rng) {
    const out = buf(sr, 1.4);
    // leather toe on skull through hair: a muffled 220 Hz knock, the hair damping the click
    const k = thud(sr, rng, rng.range(200, 240), 0.12, 0.25);
    mixInto(out, k, 0, 0.8);
    const hair = pink(Math.floor(sr * 0.05), rng);
    filt(hair, 'bandpass', sr, 1500, 0.7);
    expDecay(hair, sr, 0.012);
    mixInto(out, hair, 0, 0.3);
    // the roll: weight shifts onto the cheek, then the crown (wet boards: squelch + low board mode)
    for (const at of [0.2, 0.8]) {
      mixInto(out, modal(Math.floor(sr * 0.25), sr, [{ freq: 95, amp: 1, decay: 0.06 }, { freq: 180, amp: 0.5, decay: 0.05 }]), Math.floor(sr * at), 0.45);
      const sq = pink(Math.floor(sr * 0.12), rng);
      filt(sq, 'bandpass', sr, 700, 1.2);
      env(sq, sr, (t) => Math.sin(Math.PI * Math.min(1, t / 0.12)));
      mixInto(out, sq, Math.floor(sr * (at + 0.01)), 0.35);
    }
    return [trimTail(out, sr)];
  },
};

/** C2 10.6 and every B05+ head lift: a squelch (noise BP 500–1500 Hz, slow AM) + a light 0.4 s patter. */
function hairWringInto(out: Float32Array, sr: number, rng: Rng, at: number, g: number): void {
  const n = Math.floor(sr * 0.5);
  const sq = pink(n, rng);
  sweep(sq, 'bandpass', sr, (i) => 500 + 1000 * (i / n), 1.1);
  env(sq, sr, (t) => Math.sin(Math.PI * Math.min(1, t / 0.5)) * (0.65 + 0.35 * Math.sin(2 * Math.PI * 4 * t)));
  mixInto(out, sq, Math.floor(sr * at), g);
  for (let i = rng.int(8, 16); i > 0; i--) {
    const d = bloodDrop(sr, rng, 0.2);
    mixInto(out, d, Math.floor(sr * (at + 0.1 + rng.range(0, 0.4))), g * rng.range(0.15, 0.35));
  }
}

const hairWring: Recipe = {
  id: 'hair_wring',
  label: 'Head: wet hair gripped / wrung',
  category: 'ada',
  bus: 'creature',
  variants: 3,
  level: 0.55,
  gen(sr, rng) {
    const out = buf(sr, 0.9);
    hairWringInto(out, sr, rng, 0, 1);
    return [trimTail(out, sr)];
  },
};

/**
 * C2 22.3 → C2c, B05+ (§2.3): the stump breathing. Each exhale 0.9 s: noise through a 570 Hz resonator (a ~15 cm
 * open tube, f = c / 4L ≈ 343 / 0.6 = 572 Hz) with its 3rd partial at 1.7 kHz, plus bubble grains (40–90 /s,
 * 0.8–2.5 kHz) where the airway is flooded. The inhale is a thin hiss. 0.4 Hz → a 2.5 s cycle; loop of 2 cycles.
 */
const stumpBreath: Recipe = {
  id: 'stump_breath',
  label: 'Ada: the stump breathes (loop)',
  category: 'ada',
  bus: 'creature',
  variants: 1,
  loop: true,
  level: 0.5,
  gen(sr, rng) {
    const cyc = 2.5;
    const out = buf(sr, cyc * 2 + 0.3);
    for (let c = 0; c < 2; c++) {
      const t0 = c * cyc + rng.range(-0.05, 0.05) + 0.05;
      // exhale through the tube
      const nX = Math.floor(sr * 0.9);
      const air = white(nX, rng);
      const tube = resonate(air, sr, [
        { freq: 572, q: 9, gain: 1 },
        { freq: 1716, q: 7, gain: 0.45 },
      ]);
      env(tube, sr, (t) => adEnv(t, 0.12, 0.35) * 0.35);
      mixInto(out, tube, Math.floor(sr * t0), 1);
      // flooded airway: bubble grains 40–90 /s over the exhale
      const rate = rng.range(40, 90);
      let t = 0;
      while (t < 0.85) {
        t += rng.exp(1 / rate);
        const f = rng.range(800, 2500);
        const b = blip(sr, f, f * 1.2, 0.025, 1);
        expDecay(b, sr, 0.008);
        mixInto(out, b, Math.floor(sr * (t0 + t)), 0.12 * adEnv(t, 0.1, 0.5));
      }
      // inhale: a thin hiss through the tube, 1.0 s later
      const nI = Math.floor(sr * 0.7);
      const h = white(nI, rng);
      filt(h, 'bandpass', sr, 2600, 1.4);
      env(h, sr, (tt) => Math.sin(Math.PI * Math.min(1, tt / 0.7)) * 0.06);
      mixInto(out, h, Math.floor(sr * (t0 + 1.35)), 1);
    }
    return [makeLoop(out, sr, 0.25)];
  },
};

/**
 * Her bare wet feet (§2.3 `bare_feet_wet`): a heel slap (noise LP 1.8 kHz, 25 ms), 60 ms later the toe press with a
 * squeak on varnish (2.1 → 1.6 kHz, 40 ms) and a squish. `tread` 1 adds the hollow 120 Hz box resonance of the
 * stair (the closet under it).
 */
const bareFeetWet: Recipe = {
  id: 'bare_feet_wet',
  label: 'Ada: wet bare footstep',
  category: 'footsteps',
  bus: 'creature',
  variants: 8,
  level: 0.6,
  params: { tread: { min: 0, max: 1, default: 0 } },
  gen(sr, rng, p) {
    const out = buf(sr, 0.4);
    const heel = white(Math.floor(sr * 0.025), rng);
    filt(heel, 'lowpass', sr, 1800);
    env(heel, sr, (t) => adEnv(t, 0.002, 0.008));
    mixInto(out, heel, 0, 1.2);
    mixInto(out, thud(sr, rng, rng.range(70, 90), 0.1, 0.2), 0, 0.5);
    const toe = Math.floor(sr * rng.range(0.055, 0.065));
    if (rng.next() < 0.7) {
      const sq = blip(sr, 2100, 1600, 0.04, 1);
      env(sq, sr, (t) => Math.sin(Math.PI * Math.min(1, t / 0.04)));
      mixInto(out, sq, toe, 0.18);
    }
    const sh = pink(Math.floor(sr * 0.07), rng);
    filt(sh, 'bandpass', sr, 800, 1);
    env(sh, sr, (t) => Math.sin(Math.PI * Math.min(1, t / 0.07)));
    mixInto(out, sh, toe, 0.35);
    if (p.tread > 0) mixInto(out, modal(Math.floor(sr * 0.25), sr, [{ freq: 120, amp: 1, decay: 0.07 }, { freq: 245, amp: 0.4, decay: 0.04 }]), 0, 0.45 * p.tread);
    return [trimTail(out, sr)];
  },
};

/** C2c 6.85–7.45: her hand on the handrail — stick–slip, a 9–14 Hz train of 1.2 kHz grains. */
const handrailSqueak: Recipe = {
  id: 'handrail_squeak',
  label: 'Ada: wet hand on the handrail',
  category: 'ada',
  bus: 'creature',
  variants: 3,
  level: 0.5,
  gen(sr, rng) {
    const dur = 0.6;
    const out = buf(sr, dur + 0.05);
    const rate = rng.range(9, 14);
    for (let t = 0.01; t < dur; t += 1 / rate + rng.range(-0.008, 0.008)) {
      const g = blip(sr, 1200 * rng.range(0.95, 1.05), 1150, 0.02, 1);
      expDecay(g, sr, 0.006);
      mixInto(out, g, Math.floor(sr * t), rng.range(0.4, 0.9));
    }
    return [out];
  },
};

function knock(sr: number, rng: Rng, metal: number, wood: number): Float32Array {
  const out = buf(sr, 0.35);
  mixInto(out, modal(Math.floor(sr * 0.3), sr, [
    { freq: 1100 * rng.range(0.97, 1.03), amp: 1, decay: 0.04 },
    { freq: 2600 * rng.range(0.97, 1.03), amp: 0.6, decay: 0.04 },
  ]), 0, metal);
  mixInto(out, woodImpact(sr, rng, { f0: 400, dur: 0.15, damp: 0.9, hardness: 0.8 }), 0, wood);
  return trimTail(out, sr);
}

/** C2c 1.80: the torch body cracks against the newel cap (1.1 / 2.6 kHz metal modes τ 40 ms + a 400 Hz wood thock). */
const newelKnock: Recipe = { id: 'newel_knock', label: 'Torch on the newel', category: 'player', bus: 'player', variants: 2, level: 0.7, gen: (sr, rng) => [knock(sr, rng, 0.6, 1)] };
/** C2c 6.62: the torch hits a tread in the fall (more metal). */
const torchKnock: Recipe = { id: 'torch_knock', label: 'Torch on a tread', category: 'player', bus: 'player', variants: 2, level: 0.7, gen: (sr, rng) => [knock(sr, rng, 1, 0.6)] };

/** C2c 6.62: the player falls on the stair — two 150 Hz thuds + a leather slap, the hollow stair box ringing under it. */
const bodyFallStairs: Recipe = {
  id: 'body_fall_stairs',
  label: 'Player: falls on the stair',
  category: 'player',
  bus: 'player',
  variants: 2,
  level: 0.85,
  gen(sr, rng) {
    const out = buf(sr, 0.9);
    for (const [at, g] of [[0, 1], [0.14, 0.75]] as const) {
      mixInto(out, thud(sr, rng, 150 * rng.range(0.92, 1.08), 0.25, 0.4), Math.floor(sr * at), g);
      mixInto(out, modal(Math.floor(sr * 0.35), sr, [{ freq: 120, amp: 1, decay: 0.09 }, { freq: 260, amp: 0.4, decay: 0.05 }]), Math.floor(sr * at), g * 0.6);
    }
    const leather = white(Math.floor(sr * 0.03), rng);
    filt(leather, 'bandpass', sr, 1400, 0.9);
    expDecay(leather, sr, 0.007);
    mixInto(out, leather, Math.floor(sr * 0.012), 0.7);
    return [trimTail(out, sr)];
  },
};

/** C2 7.56, C2c 3.88: the score hit under the picture — 40 Hz for 80 ms plus a one-frame (≈ 16 ms) click. Stereo. */
const scoreHit: Recipe = {
  id: 'score_hit',
  label: 'Score: hit',
  category: 'score',
  bus: 'score',
  variants: 1,
  stereo: true,
  level: 0.85,
  gen(sr, rng) {
    const out = buf(sr, 0.35);
    const sub = modal(Math.floor(sr * 0.3), sr, [{ freq: 40, amp: 1, decay: 0.08 }, { freq: 80, amp: 0.25, decay: 0.05 }]);
    mixInto(out, sub, 0, 1);
    const c = click(sr, rng, 16, 'pink');
    filt(c, 'highpass', sr, 400);
    mixInto(out, c, 0, 0.25);
    const r = new Float32Array(out);
    return [out, r];
  },
};

/**
 * §6.2 gameplay tell (replaces the bone crack): she lifts her head — the creak of the twisted wet hair rope taking
 * the weight, 0.4 s of water pouring out of the hair onto the boards, and a jaw click as the head swings level.
 */
const adaHeadLift: Recipe = {
  id: 'ada_head_lift',
  label: 'Ada: lifts her head (the tell)',
  category: 'ada',
  bus: 'creature',
  variants: 4,
  level: 0.8,
  gen(sr, rng) {
    const out = buf(sr, 1.0);
    // hair rope: high-pressure stick–slip of wet keratin strands (a squeaky creak ~ 0.25 s)
    const n = Math.floor(sr * 0.26);
    const cr = stickSlip(n, sr, rng, (i) => Math.sin((i / n) * Math.PI), () => 1.2, 380);
    const crr = resonate(cr, sr, [{ freq: rng.range(700, 950), q: 9, gain: 1 }, { freq: 2100, q: 8, gain: 0.4 }]);
    mixInto(out, crr, 0, 0.6);
    hairWringInto(out, sr, rng, 0.12, 0.7);
    // the jaw: a small bony click as the mandible drops
    const c = click(sr, rng, 1.2);
    mixInto(out, resonate(c, sr, [{ freq: rng.range(1500, 2100), q: 7, gain: 5 }]), Math.floor(sr * rng.range(0.42, 0.5)), 0.5);
    return [trimTail(out, sr)];
  },
};

/** The carried head knocks against her thigh (walking/running, §4.6): a dull flesh-on-bone thump through wet cotton. */
const adaHeadKnock: Recipe = {
  id: 'ada_head_knock',
  label: 'Ada: carried head knocks on her thigh',
  category: 'ada',
  bus: 'creature',
  variants: 6,
  level: 0.5,
  gen(sr, rng) {
    const out = buf(sr, 0.3);
    mixInto(out, thud(sr, rng, rng.range(110, 150), 0.12, 0.3), 0, 1);
    const cl = pink(Math.floor(sr * 0.03), rng);
    filt(cl, 'bandpass', sr, 600, 0.9);
    expDecay(cl, sr, 0.01);
    mixInto(out, cl, 0, 0.45);
    if (rng.next() < 0.5) mixInto(out, bloodDrop(sr, rng, 0.1), Math.floor(sr * rng.range(0.05, 0.2)), 0.25);
    return [trimTail(out, sr)];
  },
};

/**
 * B05 her return (§4.5): Harlan turns the parlor's mortise lock — the key's bit scraping into the wards, the lever
 * tumbler lifting (two clicks), the bolt shooting back with a dull clack in the door.
 */
const parlorKeyTurn: Recipe = {
  id: 'parlor_key_turn',
  label: 'Parlor door: the key turns',
  category: 'doors',
  bus: 'sfx',
  variants: 2,
  level: 0.7,
  gen(sr, rng) {
    const out = buf(sr, 1.3);
    const nS = Math.floor(sr * 0.22);
    const sc = white(nS, rng);
    filt(sc, 'bandpass', sr, 3200, 2.2);
    env(sc, sr, (t) => 0.25 * Math.sin(Math.PI * Math.min(1, t / 0.22)));
    mixInto(out, sc, 0, 1);
    const tick = (at: number, f: number, g: number) => {
      const c = click(sr, rng, 1);
      mixInto(out, resonate(c, sr, [{ freq: f, q: 10, gain: 6 }, { freq: f * 2.3, q: 8, gain: 3 }]), Math.floor(sr * at), g);
    };
    tick(0.42, rng.range(1800, 2200), 0.45);
    tick(0.58, rng.range(2300, 2700), 0.4);
    // the bolt shoots: metal clack + the door leaf as a wooden box
    tick(0.74, 1500, 0.8);
    mixInto(out, woodImpact(sr, rng, { f0: 140, dur: 0.3, damp: 0.85, hardness: 0.7 }), Math.floor(sr * 0.745), 0.55);
    return [trimTail(out, sr)];
  },
};

/** C2 (the rope released): the rope zips through the pulleys — fast stick–slip rising in rate, ~0.6 s, then stops dead. */
const ropeZip: Recipe = {
  id: 'rope_zip',
  label: 'Rope: zips through the pulleys',
  category: 'doors',
  bus: 'sfx',
  variants: 2,
  level: 0.75,
  gen(sr, rng) {
    const dur = 0.62;
    const n = Math.floor(sr * dur);
    const out = buf(sr, dur + 0.25);
    const sp = (i: number) => Math.min(1, (i / n) * 2.4);
    const s = stickSlip(n, sr, rng, sp, () => 0.8, 900);
    const r = resonate(s, sr, [{ freq: 1300, q: 3, gain: 1 }, { freq: 3100, q: 4, gain: 0.5 }]);
    mixInto(out, r, 0, 0.5);
    const hiss = white(n, rng);
    sweep(hiss, 'bandpass', sr, (i) => 1500 + 3500 * sp(i), 1.5);
    env(hiss, sr, (t) => 0.2 * Math.min(1, t / 0.1));
    mixInto(out, hiss, 0, 1);
    // the pulley wheels ringing (iron sheaves)
    mixInto(out, modal(Math.floor(sr * 0.3), sr, [{ freq: 1850, amp: 1, decay: 0.05 }, { freq: 4400, amp: 0.4, decay: 0.03 }]), Math.floor(sr * (dur - 0.02)), 0.25);
    return [out];
  },
};

/**
 * C2 S10 (the lead's ruling, the body rises): the heart restarts in the headless body — two weak, irregular
 * fibrillating flutters, then three heavy lub–dubs settling to ≈ 70 bpm, each with a wet arterial squirt at the stump.
 */
const heartRestart: Recipe = {
  id: 'heart_restart',
  label: 'Ada: the heart restarts',
  category: 'ada',
  bus: 'creature',
  variants: 1,
  level: 0.85,
  gen(sr, rng) {
    const out = buf(sr, 4.4);
    const beat = (at: number, g: number) => {
      mixInto(out, thud(sr, rng, rng.range(45, 55), 0.14, 0.15), Math.floor(sr * at), g); // lub (S1)
      mixInto(out, thud(sr, rng, rng.range(65, 75), 0.1, 0.15), Math.floor(sr * (at + 0.28)), g * 0.6); // dub (S2)
      const sq = white(Math.floor(sr * 0.12), rng);
      filt(sq, 'lowpass', sr, 2000);
      env(sq, sr, (t) => adEnv(t, 0.02, 0.04));
      mixInto(out, sq, Math.floor(sr * (at + 0.06)), g * 0.25);
    };
    // fibrillation: a quick, weak quiver (8–10 Hz) twice
    for (const at of [0.1, 0.75]) {
      const n = Math.floor(sr * 0.35);
      const q = new Float32Array(n);
      const f = rng.range(8, 10);
      for (let i = 0; i < n; i++) q[i] = Math.sin((2 * Math.PI * 48 * i) / sr) * Math.max(0, Math.sin((2 * Math.PI * f * i) / sr)) * Math.sin((Math.PI * i) / n);
      mixInto(out, q, Math.floor(sr * at), 0.25);
    }
    beat(1.55, 0.7);
    beat(2.5, 0.95);
    beat(3.36, 1);
    return [trimTail(out, sr)];
  },
};

export const ESCAPE_RECIPES: Recipe[] = [
  bloodDrip, parlorDripLoop, chopPartial, cleaverSever, arterialSpurt, bloodPatter, headDrop, headNudge, hairWring, stumpBreath,
  bareFeetWet, handrailSqueak, newelKnock, torchKnock, bodyFallStairs, scoreHit, adaHeadLift, adaHeadKnock, parlorKeyTurn,
  ropeZip, heartRestart,
];
