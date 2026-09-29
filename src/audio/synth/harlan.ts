// Harlan: rope through pulleys, whetstone rasp, the wet chop, rocking-chair metronome, breath through burlap,
// rubber-apron creak. Mostly heard, not seen — through walls and floors (the runtime occludes them).

import { buf, click, filt, mixInto, pink, resonate, stickSlip, white, blip, makeLoop, expDecay, smoothNoise } from './dsp.ts';
import { woodImpact, thud, metalHit, woodCreak, scrapeNoise, breathPuff, droplet } from './common.ts';
import type { Recipe } from './types.ts';

/**
 * Rope running through pulleys overhead: hemp rope hiss (friction noise, grain-modulated by the lay of the rope —
 * a periodic twist every few cm, so the grain has a rate proportional to speed), wooden sheaves squeaking on their
 * axles (stick-slip), and the pulley blocks knocking. Ends on the latch.
 */
const ropePulleys: Recipe = {
  id: 'rope_pulleys',
  label: 'Rope through pulleys',
  category: 'harlan',
  bus: 'sfx',
  variants: 2,
  level: 0.65,
  params: { dur: { min: 0.8, max: 3, default: 1.6 } },
  gen(sr, rng, p) {
    const dur = p.dur;
    const n = Math.floor(sr * dur);
    const out = buf(sr, dur + 0.4);
    const speed = (u: number) => Math.min(1, u * 5) * (u > 0.85 ? (1 - u) / 0.15 : 1);
    const hiss = white(n, rng);
    filt(hiss, 'bandpass', sr, 2200, 0.7);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const v = speed(i / n);
      ph += (v * 38) / sr; // lay twists passing per second
      hiss[i] *= v * (0.6 + 0.4 * Math.abs(Math.sin(Math.PI * ph)));
    }
    mixInto(out, hiss, 0, 0.45);
    for (let s = 0; s < 3; s++) {
      const tr = stickSlip(n, sr, rng, (i) => speed(i / n) * rng.range(0.9, 1.1), () => 1.1, rng.range(350, 600));
      const f = rng.range(800, 1400);
      mixInto(out, resonate(tr, sr, [{ freq: f, q: 14, gain: 1 }, { freq: f * 2.3, q: 12, gain: 0.4 }]), rng.range(0, 0.1) * sr, 0.3);
    }
    for (let i = rng.int(3, 6); i > 0; i--) mixInto(out, woodImpact(sr, rng, { f0: rng.range(300, 500), dur: 0.1, damp: 2 }), rng.range(0, dur) * sr, 0.25);
    mixInto(out, metalHit(sr, rng, { f0: 1350, ratios: [1, 2.7, 4.6], decay: 0.06, dur: 0.2 }), dur * sr, 0.6);
    return [out];
  },
};

/**
 * Whetstone rasp (a cleaver on a stone, heard through the shutters): each stroke is a steel-on-grit scrape —
 * bright friction noise with grit clicks — plus the blade ringing faintly (thin steel plate modes excited by the
 * scrape). Push/pull strokes differ in pressure and pitch. Loop of several strokes with a human rhythm.
 */
const whetstone: Recipe = {
  id: 'whetstone',
  label: 'Whetstone rasp (loop)',
  category: 'harlan',
  bus: 'sfx',
  variants: 1,
  loop: true,
  level: 0.6,
  params: { strokes: { min: 4, max: 12, default: 8 } },
  gen(sr, rng, p) {
    const strokes = Math.round(p.strokes);
    const period = rng.range(0.62, 0.72);
    const dur = strokes * period;
    const n = Math.floor(sr * (dur + 0.3));
    const out = new Float32Array(n);
    for (let s = 0; s < strokes; s++) {
      const push = s % 2 === 0;
      const len = period * rng.range(0.55, 0.7);
      const m = Math.floor(sr * len);
      const sp = (u: number) => Math.sin(Math.PI * u) ** (push ? 0.6 : 1);
      const x = scrapeNoise(m, sr, rng, { lo: push ? 2200 : 1700, hi: 9500, grain: 1.2, speedAt: sp });
      const ring = resonate(x, sr, [
        { freq: push ? 3150 : 2980, q: 60, gain: 0.4 },
        { freq: 5230, q: 60, gain: 0.25 },
        { freq: 7400, q: 50, gain: 0.15 },
      ]);
      mixInto(x, ring, 0, 1);
      for (let g = rng.int(4, 12); g > 0; g--) {
        const c = click(sr, rng, 0.4);
        filt(c, 'highpass', sr, 3000);
        mixInto(x, c, rng.range(0.1, 0.9) * m, 0.3);
      }
      mixInto(out, x, (s * period + rng.range(0, 0.04)) * sr, push ? 1 : 0.75);
    }
    return [makeLoop(out, sr, 0.25)];
  },
};

/**
 * The wet chop (heard, not seen): a heavy cleaver through wet tissue into bone and the table. Layers: blade entry
 * (sharp broadband transient), squelch (low Minnaert bubbles + wet noise), bone crack (fracture cluster), and the
 * table's heavy wooden thud with a little rattle of things on it.
 */
const wetChop: Recipe = {
  id: 'wet_chop',
  label: 'Wet chop',
  category: 'harlan',
  bus: 'sfx',
  variants: 2,
  level: 0.9,
  gen(sr, rng) {
    const out = buf(sr, 1.4);
    const entry = click(sr, rng, 2.5);
    filt(entry, 'highpass', sr, 800);
    mixInto(out, entry, 0, 1.5);
    const n = Math.floor(sr * 0.35);
    const wet = pink(n, rng);
    filt(wet, 'bandpass', sr, 700, 0.8);
    expDecay(wet, sr, 0.07);
    mixInto(out, wet, 0.002 * sr, 1.2);
    for (let i = rng.int(6, 12); i > 0; i--) {
      const f = rng.range(150, 600);
      mixInto(out, blip(sr, f, f * rng.range(1.3, 2.2), rng.range(0.02, 0.06)), rng.range(0.005, 0.2) * sr, rng.range(0.2, 0.6));
    }
    for (let i = rng.int(2, 4); i > 0; i--) {
      const c = click(sr, rng, 1);
      mixInto(out, resonate(c, sr, [{ freq: rng.range(1200, 2400), q: 6, gain: 6 }]), rng.range(0.008, 0.05) * sr, 0.6);
    }
    mixInto(out, woodImpact(sr, rng, { f0: rng.range(85, 110), dur: 0.6, damp: 0.8, hardness: 0.9 }), 0.03 * sr, 1.1);
    mixInto(out, thud(sr, rng, 55, 0.6, 0.6), 0.03 * sr, 0.8);
    for (let i = rng.int(2, 5); i > 0; i--) mixInto(out, droplet(sr, rng, { size: rng.range(0.6, 1.2) }), rng.range(0.1, 0.8) * sr, 0.25);
    return [out];
  },
};

/**
 * Rocking chair metronome: each half-swing, the curved runners roll on the boards (low, slow stick-slip through
 * the floor) and a loose joint squeaks at the extreme of the swing. Loop of 2 full rocks.
 */
const rockingChair: Recipe = {
  id: 'rocking_chair',
  renderRate: 0.5,
  label: 'Rocking chair (loop)',
  category: 'harlan',
  bus: 'sfx',
  variants: 1,
  loop: true,
  level: 0.55,
  params: { period: { min: 1.2, max: 2.4, default: 1.7 } },
  gen(sr, rng, p) {
    const half = p.period / 2;
    const dur = p.period * 2;
    const n = Math.floor(sr * dur);
    const out = new Float32Array(n + Math.floor(sr * 0.5));
    for (let k = 0; k < 4; k++) {
      const t0 = k * half;
      const back = k % 2 === 1;
      mixInto(out, woodCreak(sr, rng, { dur: half * 0.7, f0: back ? 190 : 215, rate: 90, q: 10, speedAt: (u) => Math.sin(Math.PI * u) }), t0 * sr, 0.6);
      mixInto(out, woodCreak(sr, rng, { dur: 0.18, f0: back ? 610 : 680, rate: 260, q: 18 }), (t0 + half * 0.78) * sr, 0.5);
      mixInto(out, thud(sr, rng, 70, 0.2, 0.2), (t0 + half * 0.05) * sr, 0.25);
    }
    const loop = out.slice(0, n);
    for (let i = n; i < out.length; i++) loop[i - n] += out[i];
    return [loop];
  },
};

/**
 * Breath through a burlap sack: slow heavy nasal/mouth breathing, the coarse weave adding a rough, band-limited
 * rasp and the sack fabric flexing (low cloth rustle on each inhale).
 */
const sackBreath: Recipe = {
  id: 'sack_breath',
  renderRate: 0.5,
  label: 'Harlan: breath through burlap (loop)',
  category: 'harlan',
  bus: 'creature',
  variants: 1,
  loop: true,
  level: 0.45,
  gen(sr, rng) {
    const cycle = rng.range(4.2, 5);
    const n = Math.floor(sr * cycle * 2);
    const out = new Float32Array(n);
    for (let c = 0; c < 2; c++) {
      const t0 = c * cycle;
      const inh = breathPuff(sr, rng, { dur: 1.6, inhale: true, formants: [420, 1000, 2200], rough: 0.25, amp: 0.8 });
      const exh = breathPuff(sr, rng, { dur: 2.1, inhale: false, formants: [350, 900, 2000], rough: 0.35, voiced: 0.12 });
      mixInto(out, inh, t0 * sr, 1);
      mixInto(out, exh, (t0 + 1.8) * sr, 1);
      const cloth = scrapeNoise(Math.floor(sr * 0.8), sr, rng, { lo: 250, hi: 2500, grain: 0.7, speedAt: (u) => Math.sin(Math.PI * u) });
      mixInto(out, cloth, (t0 + 0.4) * sr, 0.15);
    }
    filt(out, 'lowpass', sr, 2800);
    filt(out, 'peaking', sr, 700, 1.2, 4);
    return [out];
  },
};

/** Rubber apron creak: stiff rubber flexing — squeaky stick-slip at mid pitch with a rubbery low body. */
const apronCreak: Recipe = {
  id: 'apron_creak',
  label: 'Harlan: rubber apron creak',
  category: 'harlan',
  bus: 'sfx',
  variants: 3,
  level: 0.4,
  gen(sr, rng) {
    const n = Math.floor(sr * rng.range(0.3, 0.6));
    const tr = stickSlip(n, sr, rng, (i) => Math.sin((Math.PI * i) / n), () => 1.3, rng.range(300, 500));
    const out = resonate(tr, sr, [{ freq: rng.range(500, 800), q: 7, gain: 1 }, { freq: rng.range(1500, 2000), q: 9, gain: 0.4 }]);
    const flex = smoothNoise(n, sr, 20, rng);
    for (let i = 0; i < n; i++) out[i] *= 0.8 + 0.2 * flex[i];
    return [out];
  },
};

export const HARLAN_RECIPES: Recipe[] = [ropePulleys, whetstone, wetChop, rockingChair, sackBreath, apronCreak];
