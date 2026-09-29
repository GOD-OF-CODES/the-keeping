// Bells (modal synthesis). The parlor's servant bell hangs on a coiled steel spring: a pull sets bell + spring
// swinging at a few Hz and the loose clapper strikes on each swing, fading and growing irregular — the classic
// "jangle". Mode ratios for a small cast-brass bell (after measured handbell partials; Farnell "Bells"): the
// fundamental plus strongly inharmonic upper modes, each split into a close doublet (the bell is not perfectly
// round) so the tail beats.

import { Rng, buf, click, filt, mixInto, resonate, scale, stickSlip, type Mode, modal } from './dsp.ts';
import { metalHit, thud, woodImpact, scrapeNoise } from './common.ts';
import type { Recipe } from './types.ts';

const SMALL_BELL = [1, 2.32, 4.25, 6.63, 9.38, 12.6];

function bellStrike(sr: number, rng: Rng, f0: number, force: number, dur: number): Float32Array {
  // harder strikes excite upper modes more (brightness follows force)
  return metalHit(sr, rng, { f0, ratios: SMALL_BELL, decay: 1.1, dur, split: 0.0025, bright: 0.45 + 0.25 * force, amp: force });
}

/**
 * Parlor spring bell. `strikes` ≈ how hard it was pulled. The clapper hits at the spring's swing rate (5–7 Hz),
 * amplitude decaying geometrically with jitter; the coil adds a low metallic "boing" (spring modes ~ 30–90 Hz
 * dispersion is approximated by a few decaying low modes with a downward glide).
 */
const springBell: Recipe = {
  id: 'spring_bell',
  label: 'Parlor spring bell',
  category: 'bells',
  bus: 'sfx',
  variants: 4,
  level: 0.8,
  params: { strikes: { min: 3, max: 30, default: 10 }, f0: { min: 900, max: 1800, default: 1320 } },
  gen(sr, rng, p) {
    const swing = rng.range(5, 7);
    const k = Math.round(p.strikes);
    const len = k / swing + 2.5;
    const out = buf(sr, len);
    const f0 = p.f0 * rng.range(0.98, 1.02);
    let a = 1;
    let t = 0.02;
    for (let i = 0; i < k; i++) {
      if (rng.next() > 0.08 || i < 2) mixInto(out, bellStrike(sr, rng, f0, a, 2.2), t * sr, a);
      t += (1 / swing) * rng.range(0.85, 1.15);
      a *= rng.range(0.82, 0.93);
      if (a < 0.05) break;
    }
    // spring coil
    const n = Math.floor(sr * Math.min(len, 1.6));
    const spring = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const tt = i / sr;
      ph += (2 * Math.PI * (70 - 25 * Math.min(1, tt * 2))) / sr;
      spring[i] = Math.sin(ph) * Math.exp(-tt / 0.35) * (0.5 + 0.5 * Math.sin(tt * swing * 2 * Math.PI));
    }
    mixInto(out, spring, 0, 0.15);
    return [out];
  },
};

/**
 * Nonstop ringing (B10: "the parlor bell starts ringing and does not stop"): a seamless loop of continuous
 * pulling — strikes never decay below ~40%.
 */
const springBellLoop: Recipe = {
  id: 'spring_bell_loop',
  label: 'Parlor bell (nonstop loop)',
  category: 'bells',
  bus: 'sfx',
  variants: 1,
  loop: true,
  level: 0.75,
  preload: false,
  params: { dur: { min: 2, max: 8, default: 4 } },
  gen(sr, rng, p) {
    const n = Math.floor(sr * p.dur);
    const tail = Math.floor(sr * 2);
    const x = new Float32Array(n + tail);
    const f0 = 1320;
    let t = 0;
    while (t < p.dur) {
      const a = rng.range(0.45, 1);
      mixInto(x, bellStrike(sr, rng, f0, a, 2), t * sr, a);
      t += rng.range(0.12, 0.2);
    }
    // wrap the ring-out into the head so the loop is seamless
    const out = x.slice(0, n);
    for (let i = 0; i < tail; i++) out[i % n] += x[n + i];
    return [out];
  },
};

/**
 * The front bell knob: pulling the brass knob draws a wire through cranks along the wall (wire rasp + crank
 * clicks). The bell that answers is the parlor spring bell, positioned in the parlor by the runtime.
 */
const bellKnob: Recipe = {
  id: 'bell_knob',
  label: 'Front bell knob + wire',
  category: 'bells',
  bus: 'sfx',
  variants: 3,
  level: 0.55,
  gen(sr, rng) {
    const out = buf(sr, 0.9);
    const n = Math.floor(sr * 0.45);
    const sc = scrapeNoise(n, sr, rng, { lo: 2000, hi: 8000, grain: 0.8, speedAt: (u) => Math.sin(Math.PI * u) });
    mixInto(out, resonate(sc, sr, [{ freq: 3100, q: 20, gain: 1 }, { freq: 5200, q: 20, gain: 0.5 }]), 0, 0.7);
    for (const t of [0.02, 0.2 + rng.range(0, 0.1), 0.5]) {
      mixInto(out, metalHit(sr, rng, { f0: rng.range(1100, 1500), ratios: [1, 2.5, 4.4], decay: 0.05, dur: 0.15 }), t * sr, 0.4);
    }
    mixInto(out, woodImpact(sr, rng, { f0: 280, dur: 0.1, damp: 2 }), 0.55 * sr, 0.3);
    return [out];
  },
};

/** Bell-pull tassel by Harlan's bed (M2): heavy embroidered cloth + a wire creak running away through the wall. */
const bellPull: Recipe = {
  id: 'bell_pull',
  label: 'Bell-pull tassel',
  category: 'bells',
  bus: 'sfx',
  variants: 2,
  level: 0.5,
  preload: false,
  gen(sr, rng) {
    const out = buf(sr, 1.2);
    const n = Math.floor(sr * 0.6);
    const cloth = scrapeNoise(n, sr, rng, { lo: 300, hi: 3000, grain: 0.5, speedAt: (u) => Math.sin(Math.PI * u) });
    mixInto(out, cloth, 0, 0.5);
    const tr = stickSlip(n, sr, rng, (i) => Math.sin((Math.PI * i) / n), () => 1, 900);
    mixInto(out, resonate(tr, sr, [{ freq: 2400, q: 25, gain: 1 }, { freq: 3900, q: 25, gain: 0.5 }]), 0.1 * sr, 0.35);
    mixInto(out, thud(sr, rng, 150, 0.1, 0.4), 0.02 * sr, 0.3);
    return [out];
  },
};

/**
 * An old mechanical door-bell (twist/clockwork type): a hammer on a spring strikes a pair of domed gongs a few
 * times per turn, "brrring". Two domes tuned a minor third apart.
 */
const doorbellOld: Recipe = {
  id: 'doorbell_old',
  label: 'Old doorbell (twist gong)',
  category: 'bells',
  bus: 'sfx',
  variants: 2,
  level: 0.7,
  preload: false,
  gen(sr, rng) {
    const out = buf(sr, 2.2);
    const dome = [1, 2.14, 3.51, 5.1, 6.9];
    const fA = rng.range(880, 960);
    const fB = fA * 1.19;
    let t = 0.01;
    for (let i = 0; i < 14; i++) {
      const f = i % 2 ? fB : fA;
      mixInto(out, metalHit(sr, rng, { f0: f, ratios: dome, decay: 0.9, dur: 1.5, split: 0.002, bright: 0.55 }), t * sr, 0.35);
      t += rng.range(0.028, 0.036);
    }
    filt(out, 'highpass', sr, 200);
    return [out];
  },
};

/** Low-fuel / door-ajar style dashboard chime (70s sedan): a soft struck tone bar, two partials. */
const fuelChime: Recipe = {
  id: 'fuel_chime',
  label: 'Low-fuel chime',
  category: 'car',
  bus: 'sfx',
  variants: 1,
  level: 0.5,
  gen(sr, rng) {
    const out = buf(sr, 1.6);
    for (const [t, f] of [[0, 1175], [0.35, 988]] as const) {
      const m: Mode[] = [
        { freq: f, amp: 1, decay: 0.35 },
        { freq: f * 2.76, amp: 0.25, decay: 0.12 },
        { freq: f * 5.4, amp: 0.08, decay: 0.05 },
      ];
      const x = modal(Math.floor(sr * 1.2), sr, m);
      const c = click(sr, rng, 1);
      filt(c, 'lowpass', sr, 3000);
      mixInto(x, c, 0, 0.1);
      mixInto(out, x, t * sr, 1);
    }
    // tiny dashboard speaker: bandlimited
    filt(out, 'highpass', sr, 400);
    filt(out, 'lowpass', sr, 5000);
    return [scale(out, 1)];
  },
};

export const BELL_RECIPES: Recipe[] = [springBell, springBellLoop, bellKnob, bellPull, doorbellOld, fuelChime];
