// Doors & hardware: stick-slip hinge creaks, slam + bolt drop, knocks, the iron knocker, latches, armoire slats.

import { buf, click, filt, mixInto, pink, resonate, trimTail } from './dsp.ts';
import { woodImpact, thud, metalHit, woodCreak, scrapeNoise } from './common.ts';
import type { Recipe } from './types.ts';

/**
 * Door creak (Farnell "Creaking door"): the hinge pin rotates in its knuckle under the door's weight; dry rust
 * gives stick-slip friction whose slip-rate follows angular speed. Each slip excites (a) the hinge's small iron
 * knuckle (high, narrow modes) and (b) the big door panel (low, broad modes) which radiates most of the sound.
 * `speed` 0.3 = a slow, careful opening (long, low-pitched groan), 1.5 = yanked (short, higher squeal).
 */
const doorCreak: Recipe = {
  id: 'door_creak',
  label: 'Door creak (stick-slip)',
  category: 'doors',
  bus: 'sfx',
  variants: 4,
  level: 0.65,
  params: { dur: { min: 0.4, max: 4, default: 1.8 }, speed: { min: 0.3, max: 1.5, default: 0.8 } },
  gen(sr, rng, p) {
    const dur = p.dur * rng.range(0.9, 1.1);
    const n = Math.floor(sr * dur);
    // hand pushes: accelerate, wobble, decelerate
    const wob = rng.range(2, 5);
    const speedAt = (u: number) => (Math.sin(Math.PI * Math.min(1, u * 1.1)) ** 0.8) * (0.8 + 0.2 * Math.sin(u * wob * 6.28)) * p.speed;
    const pressureAt = (u: number) => 0.9 + 0.3 * Math.sin(u * 3.1 + 1);
    const tr = new Float32Array(n);
    {
      // train with hinge-specific rate
      let tension = 0;
      const base = rng.range(160, 260);
      for (let i = 0; i < n; i++) {
        const u = i / n;
        tension += (Math.max(0, speedAt(u)) * base) / sr;
        const th = pressureAt(u) * (0.85 + 0.3 * rng.next());
        if (tension >= th) {
          const s = tension * (0.6 + 0.4 * rng.next());
          tr[i] = s;
          tension -= s;
        }
      }
    }
    const hinge = resonate(tr, sr, [
      { freq: rng.range(1100, 1500), q: 22, gain: 0.6 },
      { freq: rng.range(2300, 2900), q: 26, gain: 0.35 },
      { freq: rng.range(3800, 4600), q: 30, gain: 0.2 },
    ]);
    const f0 = rng.range(170, 240);
    const panel = resonate(tr, sr, [
      { freq: f0, q: 6, gain: 1 },
      { freq: f0 * 1.7, q: 7, gain: 0.7 },
      { freq: f0 * 2.6, q: 8, gain: 0.5 },
      { freq: f0 * 3.7, q: 8, gain: 0.35 },
      { freq: f0 * 5.2, q: 9, gain: 0.2 },
    ]);
    const out = new Float32Array(n);
    mixInto(out, panel, 0, 1);
    mixInto(out, hinge, 0, 0.8);
    filt(out, 'highpass', sr, 80);
    filt(out, 'lowpass', sr, 6500);
    return [out];
  },
};

/**
 * Door slam: heavy leaf hits the frame — a low panel boom (70–120 Hz), frame/jamb crack, latch tongue snapping home,
 * and the house structure answering with a low rattle.
 */
const doorSlam: Recipe = {
  id: 'door_slam',
  label: 'Door slam',
  category: 'doors',
  bus: 'sfx',
  variants: 3,
  level: 0.95,
  gen(sr, rng) {
    const out = buf(sr, 1.4);
    mixInto(out, thud(sr, rng, rng.range(60, 80), 0.9, 0.9), 0, 1);
    mixInto(out, woodImpact(sr, rng, { f0: rng.range(95, 130), dur: 0.7, damp: 0.7, hardness: 1 }), 0, 1.1);
    const crack = click(sr, rng, 4);
    filt(crack, 'bandpass', sr, 1800, 0.8);
    mixInto(out, crack, 0, 1.2);
    mixInto(out, metalHit(sr, rng, { f0: rng.range(1600, 2100), ratios: [1, 2.4, 4.1, 6.3], decay: 0.05, dur: 0.2 }), Math.floor(sr * 0.012), 0.35);
    // structure rattle
    let t = 0.05;
    for (let i = rng.int(4, 8); i > 0; i--) {
      mixInto(out, woodImpact(sr, rng, { f0: rng.range(300, 600), dur: 0.05, damp: 3, hardness: 0.5 }), t * sr, 0.15 * Math.exp(-t * 5));
      t += rng.range(0.02, 0.07);
    }
    return [out];
  },
};

/**
 * Bolt drop: the rope lets go and a heavy iron bar slides through its staples (short metal-on-metal scrape) then
 * falls into the keeper — a hard, ringing clank with a bounce.
 */
const boltDrop: Recipe = {
  id: 'bolt_drop',
  label: 'Bolt drop',
  category: 'doors',
  bus: 'sfx',
  variants: 3,
  level: 0.85,
  gen(sr, rng) {
    const out = buf(sr, 1.3);
    const n = Math.floor(sr * 0.14);
    const sc = scrapeNoise(n, sr, rng, { lo: 1500, hi: 7000, grain: 0.7, speedAt: (u) => u });
    mixInto(out, resonate(sc, sr, [{ freq: 2200, q: 10, gain: 1 }, { freq: 3900, q: 12, gain: 0.5 }]), 0, 0.6);
    const t1 = 0.14;
    const bar = { f0: rng.range(420, 560), ratios: [1, 2.76, 5.4, 8.93, 13.3], decay: 0.35, dur: 1.1, bright: 0.7 };
    mixInto(out, metalHit(sr, rng, bar), t1 * sr, 1);
    mixInto(out, thud(sr, rng, 110, 0.2, 0.6), t1 * sr, 0.6);
    mixInto(out, metalHit(sr, rng, { ...bar, decay: 0.2 }), (t1 + rng.range(0.07, 0.11)) * sr, 0.35);
    return [out];
  },
};

/** Sliding a small iron bolt by hand (passage door, M2). */
const boltSlide: Recipe = {
  id: 'bolt_slide',
  label: 'Bolt slide',
  category: 'doors',
  bus: 'sfx',
  variants: 2,
  level: 0.6,
  gen(sr, rng) {
    const out = buf(sr, 0.7);
    const n = Math.floor(sr * 0.35);
    const sc = scrapeNoise(n, sr, rng, { lo: 1200, hi: 6000, grain: 0.9, speedAt: (u) => Math.sin(Math.PI * u) });
    mixInto(out, resonate(sc, sr, [{ freq: 1700, q: 8, gain: 1 }, { freq: 3100, q: 9, gain: 0.6 }]), 0, 0.8);
    mixInto(out, metalHit(sr, rng, { f0: 1300, ratios: [1, 2.6, 4.9], decay: 0.08, dur: 0.3 }), 0.34 * sr, 0.7);
    return [out];
  },
};

/** A knuckle knock on a solid panel door: soft contact, panel mid resonances. */
const knock: Recipe = {
  id: 'knock',
  label: 'Knock (knuckle)',
  category: 'doors',
  bus: 'sfx',
  variants: 6,
  level: 0.7,
  gen(sr, rng) {
    const out = woodImpact(sr, rng, { f0: rng.range(160, 220), dur: 0.35, damp: 1, hardness: 0.35 });
    mixInto(out, thud(sr, rng, rng.range(90, 120), 0.2, 0.2), 0, 0.5);
    return [trimTail(out, sr)];
  },
};

/** Three slow knocks (her knock on the parlor door — "your knock", B11). */
const knockThree: Recipe = {
  id: 'knock_three',
  label: 'Three slow knocks',
  category: 'doors',
  bus: 'sfx',
  variants: 2,
  level: 0.7,
  preload: false,
  gen(sr, rng) {
    const out = buf(sr, 2.6);
    let t = 0.02;
    for (let i = 0; i < 3; i++) {
      mixInto(out, knock.gen(sr, rng, {})[0], t * sr, 1 - i * 0.05);
      t += rng.range(0.7, 0.85);
    }
    return [out];
  },
};

/** Iron ring knocker on its strike plate: iron clack + the door's thud behind it. */
const knocker: Recipe = {
  id: 'knocker',
  label: 'Iron knocker',
  category: 'doors',
  bus: 'sfx',
  variants: 4,
  level: 0.8,
  gen(sr, rng) {
    const out = buf(sr, 0.8);
    mixInto(out, metalHit(sr, rng, { f0: rng.range(700, 900), ratios: [1, 2.3, 3.7, 5.6, 7.9], decay: 0.12, dur: 0.6, bright: 0.75, split: 0.004 }), 0, 0.8);
    mixInto(out, woodImpact(sr, rng, { f0: rng.range(110, 150), dur: 0.4, damp: 0.9, hardness: 0.9 }), 0, 0.9);
    return [out];
  },
};

/** Latch clack: thumb-latch bar lifting and dropping. */
const latch: Recipe = {
  id: 'latch',
  label: 'Latch clack',
  category: 'doors',
  bus: 'sfx',
  variants: 4,
  level: 0.6,
  gen(sr, rng) {
    const out = buf(sr, 0.4);
    mixInto(out, metalHit(sr, rng, { f0: rng.range(1500, 1900), ratios: [1, 2.5, 4.3], decay: 0.04, dur: 0.12 }), 0, 0.5);
    mixInto(out, metalHit(sr, rng, { f0: rng.range(1200, 1500), ratios: [1, 2.7, 4.6], decay: 0.06, dur: 0.2 }), rng.range(0.06, 0.12) * sr, 0.8);
    mixInto(out, woodImpact(sr, rng, { f0: 260, dur: 0.1, damp: 2, hardness: 0.7 }), rng.range(0.06, 0.12) * sr, 0.3);
    return [out];
  },
};

/** Armoire slat door: loose louvres rattle as the light door swings; soft catch. */
const armoireSlats: Recipe = {
  id: 'armoire_slats',
  label: 'Armoire slats',
  category: 'doors',
  bus: 'sfx',
  variants: 3,
  level: 0.5,
  gen(sr, rng) {
    const out = buf(sr, 0.9);
    mixInto(out, woodCreak(sr, rng, { dur: 0.5, f0: rng.range(380, 520), rate: 260, q: 10 }), 0, 0.5);
    let t = 0.05;
    for (let i = rng.int(5, 10); i > 0; i--) {
      mixInto(out, woodImpact(sr, rng, { f0: rng.range(700, 1100), dur: 0.05, damp: 3, hardness: 0.8 }), t * sr, 0.25);
      t += rng.range(0.03, 0.08);
    }
    mixInto(out, woodImpact(sr, rng, { f0: 330, dur: 0.15, damp: 1.5, hardness: 0.6 }), 0.62 * sr, 0.6);
    return [out];
  },
};

/** The rope's bolt box above the front door: iron pieces rattling in a wooden box. */
const boltBoxClank: Recipe = {
  id: 'bolt_box_clank',
  label: 'Bolt-box clank',
  category: 'doors',
  bus: 'sfx',
  variants: 3,
  level: 0.6,
  gen(sr, rng) {
    const out = buf(sr, 0.7);
    let t = 0;
    for (let i = rng.int(2, 4); i > 0; i--) {
      mixInto(out, metalHit(sr, rng, { f0: rng.range(600, 1000), ratios: [1, 2.6, 4.9, 7.2], decay: 0.08, dur: 0.3 }), t * sr, 0.6);
      mixInto(out, woodImpact(sr, rng, { f0: rng.range(200, 300), dur: 0.12, damp: 1.5, hardness: 0.7 }), t * sr, 0.4);
      t += rng.range(0.05, 0.14);
    }
    return [out];
  },
};

/** Slow front-door swing on its own (rope-opened): a long, low, heavy creak with a soft end bump. */
const doorSwing: Recipe = {
  id: 'door_swing',
  label: 'Front door swings open',
  category: 'doors',
  bus: 'sfx',
  variants: 2,
  level: 0.7,
  preload: true, // PERF G (ruling f): lazy = a JS synth on the main thread at the first door swing (a hitch at a room entry)
  gen(sr, rng) {
    const out = buf(sr, 4);
    const c = doorCreak.gen(sr, rng, { dur: 3.2, speed: 0.4 })[0];
    mixInto(out, c, 0, 1);
    const air = pink(Math.floor(sr * 3), rng);
    filt(air, 'lowpass', sr, 300);
    for (let i = 0; i < air.length; i++) air[i] *= Math.sin((i / air.length) * Math.PI) * 0.3;
    mixInto(out, air, 0.2 * sr, 1);
    mixInto(out, thud(sr, rng, 80, 0.3, 0.3), 3.3 * sr, 0.25);
    return [out];
  },
};

export const DOOR_RECIPES: Recipe[] = [doorCreak, doorSlam, boltDrop, boltSlide, knock, knockThree, knocker, latch, armoireSlats, boltBoxClank, doorSwing];
