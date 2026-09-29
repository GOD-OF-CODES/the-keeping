// Props & interactions: pry bite, nail screech, board drop, shears, fabric tear, paper, jerry-can scrape, the hatch
// thump, locket & flashlight clicks, cistern slosh, the tin VACANCY plate.

import { buf, click, filt, mixInto, pink, blip, resonate, stickSlip, smoothNoise, makeLoop, sweep } from './dsp.ts';
import { woodImpact, thud, metalHit, woodCreak, scrapeNoise, droplet } from './common.ts';
import type { Recipe } from './types.ts';

/** Claw hammer biting under a plank: steel-on-wood knock, then the plank groaning as it's levered (low creak). */
const pryBite: Recipe = {
  id: 'pry_bite',
  label: 'Pry: claw bites + lever',
  category: 'props',
  bus: 'sfx',
  variants: 3,
  level: 0.75,
  gen(sr, rng) {
    const out = buf(sr, 1.3);
    mixInto(out, metalHit(sr, rng, { f0: rng.range(1900, 2400), ratios: [1, 2.8, 5.2], decay: 0.04, dur: 0.15 }), 0, 0.6);
    mixInto(out, woodImpact(sr, rng, { f0: rng.range(180, 240), dur: 0.3, damp: 1, hardness: 0.9 }), 0, 0.9);
    mixInto(out, woodCreak(sr, rng, { dur: 0.9, f0: rng.range(160, 230), rate: 70, q: 9, pressureAt: (t) => 1.2 + t }), 0.25 * sr, 1);
    // fibres splitting
    for (let i = rng.int(3, 7); i > 0; i--) {
      const c = click(sr, rng, 0.8);
      filt(c, 'bandpass', sr, rng.range(1500, 4000), 3);
      mixInto(out, c, rng.range(0.4, 1.1) * sr, 1.2);
    }
    return [out];
  },
};

/**
 * Nail screech: a square nail withdrawn from old oak. Very high static friction; the slip rate climbs as it frees,
 * so the pitch of the squeal RISES; excitation drives the nail shank's high modes and the plank. 3 distinct takes.
 */
const nailScreech: Recipe = {
  id: 'nail_screech',
  label: 'Pry: nail screech',
  category: 'props',
  bus: 'sfx',
  variants: 3,
  level: 0.85,
  gen(sr, rng) {
    const dur = rng.range(0.7, 1.2);
    const n = Math.floor(sr * dur);
    const tr = stickSlip(n, sr, rng, (i) => 0.4 + 1.2 * (i / n) ** 1.5, (i) => 1.6 - 0.8 * (i / n), rng.range(500, 800));
    const out = buf(sr, dur + 0.3);
    const f = rng.range(1400, 2100);
    const bq = resonate(tr, sr, [
      { freq: f, q: 30, gain: 1 },
      { freq: f * 2.02, q: 30, gain: 0.5 },
      { freq: f * 3.05, q: 25, gain: 0.25 },
    ]);
    // the squeal glides up as friction drops
    sweep(bq, 'peaking', sr, (i) => f * (1 + 0.5 * (i / n)), 4, 9);
    mixInto(out, bq, 0, 1);
    mixInto(out, woodCreak(sr, rng, { dur, f0: rng.range(200, 280), rate: 120, q: 8 }), 0, 0.5);
    mixInto(out, metalHit(sr, rng, { f0: 2600, ratios: [1, 2.6, 4.9], decay: 0.05, dur: 0.2 }), dur * sr, 0.5);
    return [out];
  },
};

/** Loose board dropping onto the floor: two bounces and a clatter. */
const boardDrop: Recipe = {
  id: 'board_drop',
  label: 'Board drop',
  category: 'props',
  bus: 'sfx',
  variants: 2,
  level: 0.85,
  gen(sr, rng) {
    const out = buf(sr, 1.2);
    const f0 = rng.range(140, 190);
    mixInto(out, woodImpact(sr, rng, { f0, dur: 0.5, damp: 0.8, hardness: 0.9 }), 0, 1);
    mixInto(out, thud(sr, rng, 70, 0.3, 0.4), 0, 0.7);
    mixInto(out, woodImpact(sr, rng, { f0: f0 * 1.1, dur: 0.3, damp: 1, hardness: 0.9 }), rng.range(0.14, 0.2) * sr, 0.5);
    mixInto(out, woodImpact(sr, rng, { f0: f0 * 1.2, dur: 0.2, damp: 1.3, hardness: 0.9 }), rng.range(0.28, 0.33) * sr, 0.25);
    return [out];
  },
};

/** Shears snip: blades sliding (bright metal friction "shhk") closing on a click of the pivot. */
const shears: Recipe = {
  id: 'shears',
  label: 'Shears snip',
  category: 'props',
  bus: 'sfx',
  variants: 4,
  level: 0.6,
  gen(sr, rng) {
    const out = buf(sr, 0.4);
    const n = Math.floor(sr * rng.range(0.1, 0.16));
    const x = scrapeNoise(n, sr, rng, { lo: 3000, hi: 11000, grain: 0.5, speedAt: (u) => u ** 0.5 });
    mixInto(out, resonate(x, sr, [{ freq: 4200, q: 20, gain: 1 }, { freq: 6900, q: 20, gain: 0.5 }]), 0, 0.6);
    mixInto(out, x, 0, 0.4);
    mixInto(out, metalHit(sr, rng, { f0: rng.range(2200, 2800), ratios: [1, 2.4, 4.4], decay: 0.05, dur: 0.2 }), n, 0.6);
    return [out];
  },
};

/** Fabric (old silk hem) tearing: a rapid chain of thread snaps (clicks) over a cloth-noise bed. */
const fabricTear: Recipe = {
  id: 'fabric_tear',
  label: 'Fabric tear',
  category: 'props',
  bus: 'sfx',
  variants: 2,
  level: 0.6,
  gen(sr, rng) {
    const dur = rng.range(0.5, 0.9);
    const n = Math.floor(sr * dur);
    const out = buf(sr, dur + 0.1);
    const bed = scrapeNoise(n, sr, rng, { lo: 800, hi: 7000, grain: 1, speedAt: (u) => Math.sin(Math.PI * u) ** 0.5 });
    mixInto(out, bed, 0, 0.5);
    let t = 0;
    while (t < dur) {
      const c = click(sr, rng, rng.range(0.2, 0.7));
      filt(c, 'bandpass', sr, rng.range(1500, 5000), 1.5);
      mixInto(out, c, t * sr, rng.range(0.4, 1.4));
      t += rng.exp(0.006);
    }
    return [out];
  },
};

/** Paper handling: old ledger/letter page — crinkle impulses in bursts + a soft sliding hiss. */
const paper: Recipe = {
  id: 'paper',
  label: 'Paper',
  category: 'props',
  bus: 'sfx',
  variants: 4,
  level: 0.45,
  gen(sr, rng) {
    const dur = rng.range(0.4, 0.8);
    const n = Math.floor(sr * dur);
    const out = buf(sr, dur + 0.05);
    const slide = scrapeNoise(n, sr, rng, { lo: 1500, hi: 9000, grain: 0.4, speedAt: (u) => Math.sin(Math.PI * u) });
    mixInto(out, slide, 0, 0.3);
    const burst = smoothNoise(n, sr, 12, rng);
    let t = 0;
    while (t < dur) {
      const d = 0.5 + 0.5 * burst[Math.min(n - 1, Math.floor(t * sr))];
      if (d > 0.45) {
        const c = click(sr, rng, rng.range(0.3, 1.5));
        filt(c, 'bandpass', sr, rng.range(2000, 7000), 1.2);
        mixInto(out, c, t * sr, rng.range(0.3, 1) * d);
      }
      t += rng.exp(0.008);
    }
    return [out];
  },
};

/** Jerry can dragged across boards: hollow steel can resonances driven by rough stick-slip + liquid slosh. */
const canScrape: Recipe = {
  id: 'can_scrape',
  label: 'Jerry-can scrape',
  category: 'props',
  bus: 'sfx',
  variants: 2,
  level: 0.7,
  gen(sr, rng) {
    const dur = rng.range(0.8, 1.2);
    const n = Math.floor(sr * dur);
    const out = buf(sr, dur + 0.4);
    const tr = stickSlip(n, sr, rng, (i) => Math.sin((Math.PI * i) / n) ** 0.6, () => 1.1, 160);
    mixInto(out, resonate(tr, sr, [
      { freq: rng.range(280, 340), q: 12, gain: 1 },
      { freq: rng.range(610, 690), q: 14, gain: 0.7 },
      { freq: rng.range(1150, 1300), q: 16, gain: 0.4 },
      { freq: rng.range(2100, 2400), q: 18, gain: 0.25 },
    ]), 0, 1);
    mixInto(out, scrapeNoise(n, sr, rng, { lo: 900, hi: 6000, grain: 0.9, speedAt: (u) => Math.sin(Math.PI * u) }), 0, 0.25);
    for (let i = rng.int(3, 6); i > 0; i--) {
      const f = rng.range(150, 300);
      mixInto(out, blip(sr, f, f * 1.5, 0.08), rng.range(0.1, dur) * sr, 0.2);
    }
    return [out];
  },
};

/** Something thumps against the well hatch from below: heavy, dull, wet, the lid rattling in its frame. */
const hatchThump: Recipe = {
  id: 'hatch_thump',
  renderRate: 0.5,
  label: 'Hatch thump (from below)',
  category: 'props',
  bus: 'creature',
  variants: 2,
  level: 0.95,
  gen(sr, rng) {
    const out = buf(sr, 1.6);
    mixInto(out, thud(sr, rng, rng.range(42, 55), 1, 0.7), 0, 1);
    mixInto(out, woodImpact(sr, rng, { f0: rng.range(85, 105), dur: 0.6, damp: 0.7, hardness: 0.4 }), 0, 0.8);
    mixInto(out, metalHit(sr, rng, { f0: 520, ratios: [1, 2.7, 5.1], decay: 0.15, dur: 0.5 }), 0.01 * sr, 0.25); // padlock
    let t = 0.05;
    for (let i = rng.int(3, 6); i > 0; i--) {
      mixInto(out, woodImpact(sr, rng, { f0: rng.range(200, 320), dur: 0.08, damp: 2 }), t * sr, 0.3 * Math.exp(-t * 6));
      t += rng.range(0.03, 0.06);
    }
    const slosh = pink(Math.floor(sr * 1.2), rng);
    filt(slosh, 'lowpass', sr, 600);
    for (let i = 0; i < slosh.length; i++) slosh[i] *= Math.sin((i / slosh.length) * Math.PI) * 0.4;
    mixInto(out, slosh, 0.1 * sr, 1);
    return [out];
  },
};

/** The locket opening: tiny spring catch + hinge (two very small, very bright metal clicks). */
const locketClick: Recipe = {
  id: 'locket_click',
  label: 'Locket click',
  category: 'props',
  bus: 'sfx',
  variants: 2,
  level: 0.45,
  gen(sr, rng) {
    const out = buf(sr, 0.3);
    mixInto(out, metalHit(sr, rng, { f0: rng.range(3800, 4600), ratios: [1, 2.2, 3.6], decay: 0.02, dur: 0.08 }), 0, 1);
    mixInto(out, metalHit(sr, rng, { f0: rng.range(3000, 3500), ratios: [1, 2.4, 3.9], decay: 0.03, dur: 0.1 }), rng.range(0.05, 0.09) * sr, 0.7);
    return [out];
  },
};

/** Flashlight rocker switch: plastic click with a small spring ping. */
const flashlightClick: Recipe = {
  id: 'flashlight_click',
  label: 'Flashlight click',
  category: 'player',
  bus: 'player',
  variants: 2,
  level: 0.4,
  gen(sr, rng) {
    const c = click(sr, rng, 1.2);
    const x = resonate(c, sr, [{ freq: rng.range(2400, 3000), q: 8, gain: 4 }, { freq: 5200, q: 10, gain: 2 }]);
    mixInto(x, c, 0, 0.6);
    const out = buf(sr, 0.12);
    mixInto(out, x, 0, 1);
    return [out];
  },
};

/** Cistern/well slosh below the kitchen (loop): water moving in a closed stone shaft — low, resonant, hollow. */
const cisternSlosh: Recipe = {
  id: 'cistern_slosh',
  renderRate: 0.5,
  label: 'Cistern slosh (loop)',
  category: 'props',
  bus: 'ambience',
  variants: 1,
  loop: true,
  level: 0.45,
  preload: false,
  gen(sr, rng) {
    const dur = 8;
    const n = Math.floor(sr * dur);
    const x = pink(n, rng);
    const wave = smoothNoise(n, sr, 0.5, rng);
    filt(x, 'lowpass', sr, 700);
    for (let i = 0; i < n; i++) x[i] *= Math.max(0, 0.3 + 0.7 * wave[i]) * 0.6;
    let t = 0;
    while (t < dur) {
      const f = rng.range(90, 300);
      mixInto(x, blip(sr, f, f * 1.7, rng.range(0.05, 0.15)), t * sr, rng.range(0.1, 0.4));
      t += rng.exp(0.25);
    }
    const shaft = resonate(x, sr, [{ freq: 110, q: 6, gain: 0.5 }, { freq: 235, q: 7, gain: 0.3 }, { freq: 370, q: 8, gain: 0.2 }]);
    mixInto(shaft, x, 0, 0.7);
    return [makeLoop(shaft, sr, 0.8)];
  },
};

/** Pump-sink drip in the kitchen: a drop into a shallow iron basin (pitched ring). */
const sinkDrip: Recipe = {
  id: 'sink_drip',
  label: 'Pump-sink drip',
  category: 'props',
  bus: 'ambience',
  variants: 4,
  level: 0.4,
  gen(sr, rng) {
    const out = buf(sr, 0.6);
    mixInto(out, droplet(sr, rng, { f: rng.range(900, 1400) }), 0, 1);
    mixInto(out, metalHit(sr, rng, { f0: rng.range(610, 680), ratios: [1, 1.93, 3.1, 4.4], decay: 0.18, dur: 0.5, amp: 0.25 }), 0, 1);
    return [out];
  },
};

/**
 * Tin VACANCY plate creaking under the ROOMS lantern: two S-hooks rubbing in eye-bolts as the sign swings — thin,
 * high metallic squeaks, alternating direction, plus a faint panel flex.
 */
const vacancyCreak: Recipe = {
  id: 'vacancy_creak',
  label: 'VACANCY plate creak (loop)',
  category: 'props',
  bus: 'ambience',
  variants: 1,
  loop: true,
  level: 0.4,
  gen(sr, rng) {
    const period = rng.range(2.4, 3.2);
    const dur = period * 2;
    const n = Math.floor(sr * dur);
    const out = new Float32Array(n + sr);
    for (let k = 0; k < 4; k++) {
      const m = Math.floor(sr * rng.range(0.25, 0.45));
      const tr = stickSlip(m, sr, rng, (i) => Math.sin((Math.PI * i) / m), () => 1.2, rng.range(600, 900));
      const f = k % 2 ? 1650 : 1880;
      const sq = resonate(tr, sr, [{ freq: f, q: 35, gain: 1 }, { freq: f * 2.1, q: 35, gain: 0.4 }, { freq: 430, q: 6, gain: 0.3 }]);
      mixInto(out, sq, (k * (period / 2) + rng.range(0, 0.2)) * sr, 1);
    }
    const loop = out.slice(0, n);
    for (let i = n; i < out.length; i++) loop[i - n] += out[i];
    return [loop];
  },
};

export const PROP_RECIPES: Recipe[] = [pryBite, nailScreech, boardDrop, shears, fabricTear, paper, canScrape, hatchThump, locketClick, flashlightClick, cisternSlosh, sinkDrip, vacancyCreak];
