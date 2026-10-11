// C2-ESCAPE §2.3 — the beheading, the rise, the stair and her return (all synthesized; lane C item C1). Mono unless
// noted (spatialised by the HRTF panner + room graph). Times and frequencies are the doc's physical numbers.
//
// Contact alignment (for scheduled cues, B12): `cleaver_sever` has its CONTACT at SEVER_CONTACT_S into the buffer
// (the swish precedes it) — schedule it at contact − SEVER_CONTACT_S. Every other one-shot starts on its onset.

import { Rng, buf, click, expDecay, filt, mixInto, pink, white, blip, resonate, stickSlip, sweep, trimTail, modal, makeLoop, adEnv } from './dsp.ts';
import { droplet, thud, woodImpact, woodCreak } from './common.ts';
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
 * Fracture "crunch" (fix round 2): a bone or cartilage breaking is not one resonance but a cascade of micro-fractures
 * — each a sub-millisecond impulse (crack-tip release) filtered by the fragment that rings. `n` impulses spread over
 * `dur` s, their density front-loaded (the main crack runs first, then the fibres/trabeculae fail behind it), each
 * band-passed somewhere in [lo, hi] Hz with random amplitude. The celery / carrot-snap reference foley is exactly this.
 */
function crunch(sr: number, rng: Rng, o: { n: number; dur: number; lo: number; hi: number; q?: number }): Float32Array {
  const out = buf(sr, o.dur + 0.02);
  for (let k = 0; k < o.n; k++) {
    const t = o.dur * Math.pow(rng.next(), 1.8);
    const imp = click(sr, rng, rng.range(0.3, 1.2));
    filt(imp, 'bandpass', sr, o.lo * Math.pow(o.hi / o.lo, rng.next()), o.q ?? 1.4);
    mixInto(out, imp, Math.floor(sr * t), rng.range(0.25, 1) * (1 - 0.5 * (t / o.dur)));
  }
  return out;
}

/**
 * Gurgle (fix round 2): blood welling out of the cut trachea / carotids with the lungs' residual air. Bubbles burst
 * at the free surface with Minnaert frequency f ≈ 3.26 / a (Hz·m): 2–8 mm radius bubbles → 400–1600 Hz, i.e. lower
 * and fatter than the 2 mm drip plip. Poisson rate `rate`/s decaying with time constant `tau`.
 */
function gurgle(sr: number, rng: Rng, dur: number, rate: number, tau: number): Float32Array {
  const out = buf(sr, dur + 0.1);
  let t = rng.exp(1 / rate);
  while (t < dur) {
    const a = rng.range(0.002, 0.008); // bubble radius, m
    const f = 3.26 / a;
    const b = blip(sr, f, f * rng.range(1.1, 1.35), rng.range(0.02, 0.05), 1);
    expDecay(b, sr, 0.006 + a * 2);
    mixInto(out, b, Math.floor(sr * t), rng.range(0.3, 1) * Math.exp(-t / tau));
    t += rng.exp(1 / rate);
  }
  return out;
}

/**
 * C2 7.56 — the severing chop. Rebuilt in fix round 2 from the physics of the event (contact stays at
 * SEVER_CONTACT_S = 110 ms into the buffer; c2-room.ts schedules off it). A ~1 kg butcher's cleaver swung two-handed
 * reaches ≈ 9 m/s at the neck (≈ 40 J). Through a ~11 cm neck it decelerates over ≈ 25 ms:
 *  −110…0 ms  swish: edge/flat aeroacoustics, band-passed noise sweeping 600 → 2600 Hz as the blade accelerates.
 *   0–4 ms    skin: the edge parts tensioned skin — a sharp 2–5 kHz "tchk" (3 ms) — and the blade's flat slaps the
 *             wet neck: a 150–350 Hz flesh thump (soft tissue has a low mechanical impedance → low, short).
 *   2–14 ms   muscle + trachea: wet tearing grains (700–2.5 kHz) and the cartilage rings of the trachea snapping in
 *             sequence (6–10 crisp impulses at ~1 ms spacing, 1.5–4 kHz) — the gristle crunch.
 *   8–28 ms   C4–C5: the vertebral body splits — one dominant snap (cortical shell: a short 1.2–2.5 kHz mode, τ ≈ 5 ms,
 *             plus a 450–800 Hz "wooden" body from the cancellous core) and 25–40 micro-fractures (1.5–6 kHz).
 *  ~24 ms     the edge bites the sawbuck plank: a dull hardwood "chock" (plank modes 280/610 Hz τ 60 ms) and the whole
 *             sawbuck shuddering on its legs (a 60–110 Hz structure mode, τ ≈ 220 ms) — the weight of the blow.
 *  24–400 ms  the steel rings, stuck in the wood: a 3–4 mm cleaver plate's bending modes ~0.9–6 kHz, damped by
 *             the wood and the flesh around it (τ 70–260 ms), a dull "shing" well below the crack — the sound
 *             people remember.
 *  30–600 ms  wet aftermath: blood welling with trachea air (gurgle, 400–1600 Hz bubbles), the cut faces parting
 *             (a squelch through a 300/900 Hz formant pair), drops off the blade.
 *  180–300 ms the body settles: the slack torso's weight drops ~1 cm onto the plank — a soft 90 Hz thud with a
 *             cloth rustle.
 * The parlor reverb adds the room's 0.2–0.9 s tail at runtime (the buffer is dry).
 */
const cleaverSever: Recipe = {
  id: 'cleaver_sever',
  label: 'Cleaver: the severing chop (contact at 110 ms)',
  category: 'harlan',
  bus: 'sfx',
  variants: 2,
  level: 0.95,
  hdr: 8, // the loudest event of the game: the bed dips 8 dB from contact (−110 ms lead is the quiet swish)
  hdrHold: 0.45,
  playGain: 2, // +6 dB: measured −20 LUFS (100 ms) at the camera before; the bed (−21 LUFS) must not rival the strike
  gen(sr, rng) {
    const C = SEVER_CONTACT_S;
    const out = buf(sr, C + 1.1);
    const db = (d: number) => Math.pow(10, d / 20);
    const at = (ms: number) => Math.floor(sr * (C + ms / 1000));
    const T_XF = Math.floor(sr * 0.03);
    // swish (−110…−5 ms)
    const nS = Math.floor(sr * 0.105);
    const sw = white(nS, rng);
    sweep(sw, 'bandpass', sr, (i) => 600 + (2600 - 600) * Math.pow(i / nS, 1.6), 2.2);
    env(sw, sr, (t) => Math.pow(t / 0.105, 2.2));
    mixInto(out, sw, Math.floor(sr * (C - 0.11)), db(-14));
    // skin: the edge "tchk" + the flat of the blade on the wet neck
    const sk = white(Math.floor(sr * 0.012), rng);
    filt(sk, 'bandpass', sr, rng.range(2800, 3600), 0.8);
    env(sk, sr, (t) => adEnv(t, 0.0005, 0.0025));
    mixInto(out, sk, at(0), db(-4));
    mixInto(out, thud(sr, rng, rng.range(180, 240), 0.07, 0.6), at(0), db(-5));
    // muscle tearing + the trachea's cartilage rings (gristle)
    mixInto(out, crunch(sr, rng, { n: rng.int(30, 45), dur: 0.012, lo: 700, hi: 2500, q: 0.9 }), at(2), db(-9));
    for (let k = 0, t = 3; k < rng.int(6, 10); k++, t += rng.range(0.6, 1.4)) {
      const r = click(sr, rng, 0.5);
      filt(r, 'bandpass', sr, rng.range(1500, 4000), 2);
      mixInto(out, r, at(t), db(-6) * rng.range(0.5, 1));
    }
    // C4–C5: the dominant snap (cortical shell + cancellous body) and its micro-fracture tail
    const snapAt = rng.range(9, 13);
    mixInto(out, modal(Math.floor(sr * 0.04), sr, [
      { freq: rng.range(1300, 2300), amp: 1, decay: 0.005 },
      { freq: rng.range(2900, 3600), amp: 0.5, decay: 0.003 },
      { freq: rng.range(480, 760), amp: 0.8, decay: 0.009 },
    ]), at(snapAt), db(-2));
    const snapClick = click(sr, rng, 0.8);
    filt(snapClick, 'highpass', sr, 1200);
    mixInto(out, snapClick, at(snapAt), db(-1));
    mixInto(out, crunch(sr, rng, { n: rng.int(25, 40), dur: 0.018, lo: 1500, hi: 6000 }), at(snapAt + 1), db(-7));
    // the edge bites the plank; the sawbuck shudders
    const bite = 24;
    mixInto(out, woodImpact(sr, rng, { f0: rng.range(260, 300), dur: 0.35, damp: 0.8, hardness: 0.9 }), at(bite), db(-9));
    mixInto(out, modal(Math.floor(sr * 0.9), sr, [
      { freq: rng.range(62, 72), amp: 1, decay: 0.15 },
      { freq: rng.range(98, 110), amp: 0.8, decay: 0.12 },
      { freq: 610 * rng.range(0.97, 1.03), amp: 0.4, decay: 0.06 },
    ]), at(bite), db(-14));
    // the stuck blade rings (steel plate bending modes, damped by wood + flesh)
    mixInto(out, modal(Math.floor(sr * 0.9), sr, [
      { freq: 920 * rng.range(0.97, 1.03), amp: 0.5, decay: 0.26, phase: rng.range(0, 3) },
      { freq: 2330 * rng.range(0.98, 1.02), amp: 1, decay: 0.16, phase: rng.range(0, 3) },
      { freq: 2348 * rng.range(0.98, 1.02), amp: 0.7, decay: 0.15, phase: rng.range(0, 3) }, // doublet → slow beat
      { freq: 3710 * rng.range(0.98, 1.02), amp: 0.7, decay: 0.11, phase: rng.range(0, 3) },
      { freq: 5480 * rng.range(0.98, 1.02), amp: 0.45, decay: 0.07, phase: rng.range(0, 3) },
    ]), at(bite + 1), db(-17));
    // wet aftermath: the cut faces part (squelch), welling + trachea air (gurgle), drops off the blade
    const nW = Math.floor(sr * 0.32);
    const w = resonate(pink(nW, rng), sr, [
      { freq: 300, q: 4, gain: 1 },
      { freq: 900, q: 5, gain: 0.7 },
    ]);
    env(w, sr, (t) => (0.6 + 0.4 * Math.sin(2 * Math.PI * 6 * t)) * Math.sin(Math.PI * Math.min(1, t / 0.32)));
    mixInto(out, w, at(25), db(-14));
    mixInto(out, gurgle(sr, rng, 0.75, 45, 0.35), at(40), db(-15));
    for (let i = rng.int(4, 7); i > 0; i--) mixInto(out, droplet(sr, rng, { size: rng.range(0.5, 1) }), at(rng.range(150, 800)), db(-20));
    // the body settles onto the plank
    const settle = rng.range(190, 280);
    mixInto(out, thud(sr, rng, rng.range(80, 100), 0.25, 0.5), at(settle), db(-13));
    const cloth = pink(Math.floor(sr * 0.14), rng);
    filt(cloth, 'bandpass', sr, 1800, 0.6);
    env(cloth, sr, (t) => adEnv(t, 0.015, 0.04));
    mixInto(out, cloth, at(settle - 10), db(-24));
    // Loudness (fix round 2, measured in the real C2 mix): at 2.7 m through the HRTF panner the peak-normalised
    // chop read only ≈ 4 dB over the room bed — its energy was one 1 ms spike. The real blow is ≈ 115–125 dB SPL
    // peak at the camera, far beyond what a −1 dBFS game mix can carry, so it is mixed the way a film mixer would:
    // a soft tanh clip of the CONTACT ONLY (0–90 ms after contact, tanh drive 2.2: crest 10.5 → 5.9 dB, +4.6 dB rms) — the crack, gristle and snap
    // become dense and loud while the aftermath keeps its natural level relative to them.
    {
      let pk = 0;
      for (const v of out) pk = Math.max(pk, Math.abs(v));
      const d = 2.2;
      const a0 = at(-2), a1 = at(90);
      for (let i = a0; i < Math.min(out.length, a1 + T_XF); i++) {
        const wet = Math.tanh((d * out[i]) / pk) * (pk / Math.tanh(d));
        const m = i < a1 ? 1 : 1 - (i - a1) / T_XF;
        out[i] = out[i] * (1 - m) + wet * m;
      }
    }
    return [trimTail(out, sr)];
  },
};

/**
 * C2 pulses 1–6 (§3.3), rebuilt in fix round 2. A severed common carotid (lumen ≈ 4–6 mm) at the systolic exit speed
 * of the cue (≤ 2.8 m/s): Re = ρvd/μ ≈ 1060·2.8·0.005/0.0035 ≈ 4200 → a turbulent jet, but at Mach 0.002 the free jet
 * itself is nearly silent. What you hear is at the stump: the jet spluttering through the torn flaps of the vessel
 * and skin (a 700–2500 Hz hiss chopped at a 25–60 Hz flap flutter), the residual lung air forced out of the cut
 * trachea bubbling through the blood (gurgle, 400–1600 Hz Minnaert bubbles), and a soft 60–80 Hz "thup" as the
 * pressure wave arrives. Envelope = the arterial pulse: ≈ 40 ms systolic rise, ≈ 0.1 s fall (the pulse lengths in
 * C2_PULSES are 0.16–0.25 s). `strength` (the cue's gain path also scales by v) thins the hiss on the weak pulses.
 */
const arterialSpurt: Recipe = {
  id: 'arterial_spurt',
  label: 'Blood: arterial spurt',
  category: 'ada',
  bus: 'creature',
  variants: 4,
  level: 0.55,
  params: { strength: { min: 0.2, max: 1, default: 1 } },
  gen(sr, rng, p) {
    const dur = 0.3;
    const out = buf(sr, dur + 0.05);
    const n = Math.floor(sr * dur);
    const pulse = (t: number) => adEnv(t, 0.04, 0.09);
    // splutter: hiss through the flaps, chopped by a random flutter
    const hiss = white(n, rng);
    filt(hiss, 'bandpass', sr, rng.range(1100, 1600), 0.7);
    const flutterHz = rng.range(25, 60);
    const ph0 = rng.range(0, 6.28);
    env(hiss, sr, (t) => p.strength * pulse(t) * (0.45 + 0.55 * Math.max(0, Math.sin(2 * Math.PI * flutterHz * t + ph0 + 2 * Math.sin(9 * t)))));
    mixInto(out, hiss, 0, 1);
    // the wet body of the stream at the stump (lower, smoother)
    const wet = pink(n, rng);
    filt(wet, 'lowpass', sr, 900);
    filt(wet, 'highpass', sr, 150);
    env(wet, sr, (t) => pulse(t));
    mixInto(out, wet, 0, 0.8);
    // trachea air through the blood
    mixInto(out, gurgle(sr, rng, 0.22, 70 * (0.4 + 0.6 * p.strength), 0.12), Math.floor(sr * 0.01), 0.6);
    // the pressure "thup"
    mixInto(out, thud(sr, rng, rng.range(60, 80), 0.12, 0.2), 0, 0.5);
    return [trimTail(out, sr)];
  },
};

/**
 * Landings (§2.3), rebuilt in fix round 2. A 25 mL pulse at 2.8 m/s breaks up (Rayleigh–Plateau, drop ≈ 1.9 × the
 * 4–5 mm jet) into ~4 mm drops of ≈ 0.03 mL → several hundred drops, landing over ≈ the pulse length plus the
 * trajectory spread (0.25–0.35 s), at ≈ 4 m/s (√(v² + 2gh), h ≈ 0.8 m). So a big pulse is a continuous wet SPLATTER,
 * not a string of beads; the cue's gain (∝ mL) thins it for the late pulses. Per surface:
 *  - wet boards (default): each drop flattens into a crown on the film → a crisp 2–6 kHz tick + a 5–15 ms broadband
 *    "splat" (the sheet spreading), the boards' low ring under the dense part;
 *  - into the pool (`pool` fraction): only drops in the regular-entrainment window trap a bubble → a Minnaert plip
 *    (1.2–2.4 kHz for 1.4–2.7 mm bubbles), so ≈ 20 % of hits, not all;
 *  - on cloth (`cloth` fraction — the gown, the rubber sheet's folds, an apron): the fabric absorbs the impact over
 *    ~10–30 ms → a dull pat low-passed below ≈ 700 Hz, no tick, no plip.
 */
const bloodPatter: Recipe = {
  id: 'blood_patter',
  label: 'Blood: splatter of a pulse landing',
  category: 'ada',
  bus: 'creature',
  variants: 4,
  level: 0.5,
  params: {
    pool: { min: 0, max: 1, default: 0.2 },
    cloth: { min: 0, max: 1, default: 0 },
  },
  gen(sr, rng, p) {
    const dur = rng.range(0.28, 0.36);
    const out = buf(sr, dur + 0.1);
    // the stream body: dense splats merge into a wet hiss
    const nB = Math.floor(sr * dur);
    const bed = white(nB, rng);
    filt(bed, 'bandpass', sr, 1800, 0.6);
    env(bed, sr, (t) => adEnv(t, 0.02, dur * 0.35) * (1 - p.cloth * 0.8));
    mixInto(out, bed, 0, 0.25);
    const k = rng.int(140, 220);
    for (let i = 0; i < k; i++) {
      const t = dur * Math.pow(rng.next(), 1.5); // dense at first, thinning
      const g = rng.range(0.15, 0.6) * (1 - 0.6 * (t / dur));
      const at = Math.floor(sr * t);
      const r = rng.next();
      if (r < p.cloth) {
        const pat = pink(Math.floor(sr * rng.range(0.01, 0.03)), rng);
        filt(pat, 'lowpass', sr, 700);
        expDecay(pat, sr, 0.006);
        mixInto(out, pat, at, g * 1.2);
        continue;
      }
      const tick = click(sr, rng, rng.range(0.5, 1.5));
      filt(tick, 'bandpass', sr, rng.range(2200, 6000), 1.1);
      mixInto(out, tick, at, g * 0.7);
      const splat = white(Math.floor(sr * rng.range(0.005, 0.015)), rng);
      filt(splat, 'bandpass', sr, rng.range(500, 1500), 0.7);
      expDecay(splat, sr, 0.003);
      mixInto(out, splat, at, g * 0.6);
      if (r < p.cloth + (1 - p.cloth) * p.pool) {
        const f = rng.range(1200, 2400);
        const pl = blip(sr, f, f * 1.12, 0.03, 1);
        expDecay(pl, sr, 0.01);
        mixInto(out, pl, at + Math.floor(sr * 0.002), g * 0.5);
      }
    }
    // the boards' low ring under the dense part (a 22 mm pine board on joists, ≈ 100–180 Hz)
    mixInto(out, modal(Math.floor(sr * 0.3), sr, [{ freq: rng.range(105, 125), amp: 1, decay: 0.05 }, { freq: rng.range(170, 190), amp: 0.5, decay: 0.04 }]), 0, 0.12 * (1 - p.cloth));
    return [trimTail(out, sr)];
  },
};

/**
 * C2 7.90 — the head hits the floor. Rebuilt in fix round 2. A head is ≈ 4.5–5 kg (≈ 8 % of body mass); dropped
 * from the sawbuck's neck height (≈ 0.75–0.8 m) it lands at v = √(2gh) ≈ 3.9 m/s with ≈ 36 J and 18 kg·m/s — a
 * bowling-ball-class blow, but cushioned by scalp and wet hair, so the contact lasts ≈ 6–10 ms and the energy sits
 * below ≈ 150 Hz: a deep floorboard flex (22 mm pine on joists: 55–120 Hz, τ 0.12–0.18 s). On top of it:
 *  - the skull knock, dull because the scalp damps it (a 500–1100 Hz mode pair, τ ≈ 12 ms);
 *  - the wet slap of hair and the cut face on wet boards (a 15–25 ms 600–2000 Hz splat) and a squirt from the stump;
 *  - the jaw clacking shut ≈ 15 ms after impact as the mandible keeps moving (teeth on teeth: a hard 3–5 kHz click);
 *  - one low bounce: restitution ≈ 0.25 → rebound height e²h ≈ 5 cm → it lands again ≈ 0.2 s later at ≈ 1 m/s;
 *  - then the roll: an irregular ellipsoid (nose, cheekbone, crown) rocks to rest over ≈ 0.6–0.9 s — 3–4
 *    decreasing bumps with the wet hair dragging on the boards between them (squelchy friction noise).
 */
const headDrop: Recipe = {
  id: 'head_drop',
  label: 'Head: drops on the boards and rolls',
  category: 'ada',
  bus: 'creature',
  variants: 2,
  level: 0.9,
  hdr: 4,
  hdrHold: 0.2,
  playGain: 1.6, // +4 dB: 36 J into the floor (measured creature bus −28 LUFS at 7.98 s, under the bed)
  gen(sr, rng) {
    const out = buf(sr, 1.4);
    const T = (s: number) => Math.floor(sr * s);
    const floor = (g: number, at: number) => {
      mixInto(out, modal(T(0.7), sr, [
        { freq: rng.range(55, 65), amp: 0.5, decay: 0.16 },
        { freq: rng.range(88, 100), amp: 0.5, decay: 0.13 },
        { freq: rng.range(150, 175), amp: 0.6, decay: 0.07 },
        { freq: rng.range(240, 270), amp: 0.4, decay: 0.04 },
        { freq: rng.range(380, 430), amp: 0.25, decay: 0.03 },
      ]), T(at), g);
      mixInto(out, thud(sr, rng, rng.range(110, 140), 0.15, 0.6), T(at), g * 0.6);
    };
    const skull = (g: number, at: number) => {
      mixInto(out, modal(T(0.08), sr, [
        { freq: rng.range(520, 640), amp: 1, decay: 0.012 },
        { freq: rng.range(900, 1100), amp: 0.6, decay: 0.008 },
      ]), T(at), g);
    };
    const splat = (g: number, at: number, d: number) => {
      const sl = white(T(d), rng);
      filt(sl, 'bandpass', sr, rng.range(800, 1400), 0.6);
      env(sl, sr, (t) => adEnv(t, 0.001, d / 4));
      mixInto(out, sl, T(at), g);
    };
    // impact
    floor(1, 0);
    skull(1, 0.001);
    splat(0.9, 0, 0.022);
    const jaw = click(sr, rng, 0.6);
    filt(jaw, 'bandpass', sr, rng.range(3200, 4600), 2.5);
    mixInto(out, jaw, T(rng.range(0.013, 0.019)), 0.9);
    mixInto(out, gurgle(sr, rng, 0.12, 60, 0.06), T(0.01), 0.25);
    // the bounce
    const b = rng.range(0.18, 0.21);
    floor(0.28, b);
    skull(0.4, b);
    splat(0.35, b, 0.015);
    // the roll: decreasing bumps (nose → cheek → crown) with wet hair dragging between them
    let t = b + rng.range(0.12, 0.16);
    let g = 0.2;
    for (let k = rng.int(3, 4); k > 0; k--) {
      floor(g * 0.6, t);
      skull(g * 1.2, t);
      const drag = pink(T(0.12), rng);
      filt(drag, 'bandpass', sr, rng.range(500, 1100), 0.9);
      env(drag, sr, (x) => Math.sin(Math.PI * Math.min(1, x / 0.12)));
      mixInto(out, drag, T(t - 0.06), g * 0.6);
      t += rng.range(0.11, 0.17);
      g *= 0.6;
    }
    for (let i = rng.int(2, 4); i > 0; i--) mixInto(out, droplet(sr, rng, { size: rng.range(0.8, 1.4) }), T(rng.range(0.02, 0.5)), 0.15);
    return [trimTail(out, sr)];
  },
};

/**
 * C2 9.45: Harlan's boot toe nudges the head (rebuilt in fix round 2). Leather toe on skull through wet hair: a
 * muffled knock (200–240 Hz body, the hair killing the click), then the head ROLLS — continuous, not two taps: an
 * ellipsoid of ≈ 0.2 m rolling ≈ 0.6 m at < 1 m/s turns ≈ once, so 2–3 bumps (nose, cheekbone, crown) on the
 * boards ≈ 0.2–0.3 s apart, decreasing, with the wet hair dragging and squelching all the way to rest at ≈ 0.65 s.
 */
const headNudge: Recipe = {
  id: 'head_nudge',
  label: 'Head: boot nudge and roll',
  category: 'ada',
  bus: 'creature',
  variants: 2,
  level: 0.7,
  gen(sr, rng) {
    const out = buf(sr, 1.3);
    const T = (x: number) => Math.floor(sr * x);
    const k = thud(sr, rng, rng.range(200, 240), 0.12, 0.25);
    mixInto(out, k, 0, 0.8);
    const hair = pink(T(0.05), rng);
    filt(hair, 'bandpass', sr, 1500, 0.7);
    expDecay(hair, sr, 0.012);
    mixInto(out, hair, 0, 0.3);
    // the drag: one continuous wet friction bed from 0.08 s to rest, swelling at each bump
    const rollEnd = rng.range(0.6, 0.75);
    const nD = T(rollEnd);
    const drag = pink(nD, rng);
    sweep(drag, 'bandpass', sr, (i) => 900 - 400 * (i / nD), 0.9);
    const bumps: number[] = [];
    for (let t = rng.range(0.16, 0.22), g = 1; t < rollEnd; t += rng.range(0.2, 0.3), g *= 0.55) bumps.push(t);
    env(drag, sr, (t) => {
      let b = 0;
      for (const x of bumps) b += Math.exp(-Math.abs(t + 0.08 - x) / 0.05);
      return (0.35 + 0.65 * Math.min(1, b)) * Math.min(1, t / 0.05) * Math.max(0, 1 - t / rollEnd);
    });
    mixInto(out, drag, T(0.08), 0.45);
    let g = 0.3;
    for (const at of bumps) {
      mixInto(out, modal(T(0.25), sr, [{ freq: rng.range(90, 105), amp: 1, decay: 0.06 }, { freq: rng.range(170, 190), amp: 0.6, decay: 0.05 }, { freq: rng.range(520, 640), amp: 0.4, decay: 0.01 }]), T(at), g);
      g *= 0.55;
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
    if (p.tread > 0) {
      mixInto(out, modal(Math.floor(sr * 0.25), sr, [{ freq: 120, amp: 1, decay: 0.07 }, { freq: 245, amp: 0.4, decay: 0.04 }]), 0, 0.45 * p.tread);
      // fix round 2: her ≈ 55 kg on an 1890s pine tread — the tread works against its nails / the stringer as the
      // weight rolls from heel to toe: a stick–slip creak (300–480 Hz board, 0.15–0.35 s) on about half the steps.
      if (rng.next() < 0.55) {
        const c = woodCreak(sr, rng, { dur: rng.range(0.15, 0.35), f0: rng.range(300, 480), rate: rng.range(150, 220), speedAt: (t) => Math.sin(Math.PI * t) ** 0.7, pressureAt: (t) => 0.9 + 0.4 * t, q: 14 });
        mixInto(out, c, Math.floor(sr * rng.range(0.04, 0.08)), 0.55 * p.tread);
      }
    }
    return [trimTail(out, sr)];
  },
};

/**
 * Fix round 2: the same wet bare foot ON A STAIR TREAD (tread = 1: the hollow 120 Hz stair box + a weight creak).
 * A separate id because cue params cannot reach a pre-rendered bank (C2c's tread steps should use this id).
 */
const bareFeetWetTread: Recipe = { ...bareFeetWet, id: 'bare_feet_wet_tread', label: 'Ada: wet bare step on a stair tread', params: { tread: { min: 0, max: 1, default: 1 } } };

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

/** C2 7.56, C2c 3.88: the score hit under the picture — 40 Hz for 80 ms (+ an 80–160 Hz body) plus a one-frame (≈ 16 ms) click. Stereo. */
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
    // fix round 2: a 40 Hz hit does not exist on laptop speakers (M1 MacBook drivers roll off below ≈ 100–150 Hz).
    // A gently saturated 2nd/3rd/4th-harmonic body (80/120/160 Hz) carries the same hit there via the missing
    // fundamental, and the felt 40 Hz stays for headphones.
    const body = modal(Math.floor(sr * 0.3), sr, [{ freq: 80, amp: 0.6, decay: 0.07 }, { freq: 120, amp: 0.45, decay: 0.06 }, { freq: 160, amp: 0.3, decay: 0.045 }]);
    for (let i = 0; i < body.length; i++) body[i] = Math.tanh(body[i] * 1.5) / 1.5;
    mixInto(out, body, 0, 1.1);
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
  bareFeetWet, bareFeetWetTread, handrailSqueak, newelKnock, torchKnock, bodyFallStairs, scoreHit, adaHeadLift, adaHeadKnock, parlorKeyTurn,
  ropeZip, heartRestart,
];
