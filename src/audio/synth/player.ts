// The driver's body: synthesized breathing fallbacks (used until/unless ElevenLabs vocal takes exist), heartbeat,
// coat rustle, and the death hit. Non-positional ("in head"), on the player bus.

import { Rng, buf, filt, mixInto, pink, white, expDecay, smoothNoise } from './dsp.ts';
import { breathPuff, thud, scrapeNoise, sineOsc } from './common.ts';
import type { Recipe } from './types.ts';

/**
 * Heartbeat "lub-dub" (as felt in the ears, not a stethoscope): two low, soft thumps — S1 (mitral/tricuspid
 * closure, ~40–60 Hz, stronger) and S2 ~0.3 s later (higher, shorter). The S1–S2 gap shrinks with rate.
 */
function beat(sr: number, rng: Rng, bpm: number): Float32Array {
  const out = buf(sr, 0.6);
  const gap = 0.33 - 0.1 * Math.min(1, Math.max(0, (bpm - 60) / 100));
  mixInto(out, thud(sr, rng, rng.range(42, 50), 0.28, 0.15), 0, 1);
  mixInto(out, thud(sr, rng, rng.range(55, 65), 0.2, 0.15), gap * sr, 0.65);
  filt(out, 'lowpass', sr, 180);
  return out;
}

const heartbeat: Recipe = {
  id: 'heartbeat',
  renderRate: 0.5,
  label: 'Heartbeat (one beat)',
  category: 'player',
  bus: 'player',
  variants: 4,
  level: 0.9,
  params: { bpm: { min: 50, max: 170, default: 90 } },
  gen: (sr, rng, p) => [beat(sr, rng, p.bpm)],
};

function breathCycle(sr: number, rng: Rng, o: { inDur: number; outDur: number; gap: number; amp: number; voiced: number; rough: number; mouth: boolean }): Float32Array {
  const len = o.inDur + o.outDur + o.gap * 2;
  const out = buf(sr, len);
  const fIn = o.mouth ? [800, 1300, 2700] : [1100, 2200, 3400]; // nose = brighter, thinner
  const fOut = o.mouth ? [550, 1150, 2500] : [900, 1900, 3100];
  mixInto(out, breathPuff(sr, rng, { dur: o.inDur, inhale: true, amp: o.amp * 0.8, voiced: o.voiced * 0.5, formants: fIn, rough: o.rough }), 0, 1);
  mixInto(out, breathPuff(sr, rng, { dur: o.outDur, inhale: false, amp: o.amp, voiced: o.voiced, formants: fOut, rough: o.rough }), (o.inDur + o.gap) * sr, 1);
  return out;
}

function breathLoop(sr: number, rng: Rng, cycles: number, make: (r: Rng) => Float32Array): Float32Array {
  const parts = Array.from({ length: cycles }, (_, k) => make(rng.fork(k + 1)));
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Calm, slightly shaky nasal breathing (exploring). ~13 breaths/min. */
const breathCalm: Recipe = {
  id: 'breath_calm',
  renderRate: 0.5,
  label: 'Breath: calm (loop)',
  category: 'player',
  bus: 'player',
  variants: 1,
  loop: true,
  level: 0.3,
  gen: (sr, rng) => [breathLoop(sr, rng, 3, (r) => breathCycle(sr, r, { inDur: r.range(1.3, 1.6), outDur: r.range(1.8, 2.2), gap: r.range(0.3, 0.6), amp: r.range(0.8, 1), voiced: 0, rough: 0.05, mouth: false }))],
};

/** Strained: frightened mouth breathing, faster, a little voiced on the exhale, shaky. */
const breathStrained: Recipe = {
  id: 'breath_strained',
  renderRate: 0.5,
  label: 'Breath: strained (loop)',
  category: 'player',
  bus: 'player',
  variants: 1,
  loop: true,
  level: 0.45,
  gen: (sr, rng) => [breathLoop(sr, rng, 4, (r) => breathCycle(sr, r, { inDur: r.range(0.6, 0.8), outDur: r.range(0.8, 1.1), gap: r.range(0.08, 0.2), amp: 1, voiced: 0.25, rough: 0.4, mouth: true }))],
};

/** Panting after a sprint (2.5 m noise for 4 s): rapid, open-mouthed, voiced. */
const panting: Recipe = {
  id: 'panting',
  renderRate: 0.5,
  label: 'Breath: panting (loop)',
  category: 'player',
  bus: 'player',
  variants: 1,
  loop: true,
  level: 0.55,
  gen: (sr, rng) => [breathLoop(sr, rng, 6, (r) => breathCycle(sr, r, { inDur: r.range(0.25, 0.32), outDur: r.range(0.3, 0.4), gap: r.range(0.02, 0.05), amp: 1, voiced: 0.4, rough: 0.2, mouth: true }))],
};

/** Hold (Space): a sharp inhale that stops dead — the glottis closing — with a tiny click. */
const breathHold: Recipe = {
  id: 'breath_hold',
  label: 'Breath: hold (in + catch)',
  category: 'player',
  bus: 'player',
  variants: 3,
  level: 0.45,
  gen(sr, rng) {
    const out = buf(sr, 0.8);
    const inh = breathPuff(sr, rng, { dur: rng.range(0.35, 0.5), inhale: true, formants: [900, 1500, 2900], attack: 0.5, release: 0.1 });
    // cut hard at the end (glottal stop)
    for (let i = Math.floor(inh.length * 0.85); i < inh.length; i++) inh[i] *= Math.max(0, 1 - (i - inh.length * 0.85) / (inh.length * 0.15)) ** 3;
    mixInto(out, inh, 0, 1);
    const c = white(Math.floor(sr * 0.004), rng);
    filt(c, 'bandpass', sr, 1500, 2);
    mixInto(out, c, inh.length * 0.98, 0.3);
    return [out];
  },
};

/** Releasing a held breath: a controlled, trembling exhale (the tremble is the fear). */
const breathRelease: Recipe = {
  id: 'breath_release',
  label: 'Breath: release (shaky out)',
  category: 'player',
  bus: 'player',
  variants: 3,
  level: 0.45,
  gen(sr, rng) {
    const x = breathPuff(sr, rng, { dur: rng.range(1.2, 1.6), inhale: false, formants: [600, 1200, 2500], rough: 0.6, voiced: 0.08, attack: 0.08 });
    const trem = smoothNoise(x.length, sr, 14, rng);
    for (let i = 0; i < x.length; i++) x[i] *= 0.75 + 0.25 * trem[i];
    return [x];
  },
};

/** Gasp: involuntary, fast, voiced inhale (a hide-breaker — 3 m noise). */
const gasp: Recipe = {
  id: 'gasp',
  label: 'Breath: gasp',
  category: 'player',
  bus: 'player',
  variants: 4,
  level: 0.7,
  gen(sr, rng) {
    const x = breathPuff(sr, rng, { dur: rng.range(0.28, 0.42), inhale: true, voiced: rng.range(0.4, 0.8), formants: [rng.range(700, 900), rng.range(1400, 1800), 2900], attack: 0.15, release: 0.3, rough: 0.2 });
    const out = buf(sr, 0.7);
    mixInto(out, x, 0, 1);
    // shaky half-exhale after the gasp
    mixInto(out, breathPuff(sr, rng, { dur: 0.25, inhale: false, amp: 0.3, rough: 0.5 }), (x.length / sr + 0.05) * sr, 1);
    return [out];
  },
};

/** Coat rustle: waxed-cotton jacket — stiff fabric friction, crackly highs. */
const coatRustle: Recipe = {
  id: 'coat_rustle',
  label: 'Coat rustle',
  category: 'player',
  bus: 'player',
  variants: 6,
  level: 0.3,
  gen(sr, rng) {
    const dur = rng.range(0.25, 0.5);
    const n = Math.floor(sr * dur);
    const x = scrapeNoise(n, sr, rng, { lo: 700, hi: 6000, grain: 1.2, speedAt: (u) => Math.sin(Math.PI * u) ** 0.7 });
    return [x];
  },
};

/** Death: the grab — a close, wet body impact + everything pitched down into a drowning rush. */
const grabHit: Recipe = {
  id: 'grab_hit',
  label: 'Death: grab hit',
  category: 'player',
  bus: 'player',
  variants: 2,
  level: 1,
  gen(sr, rng) {
    const out = buf(sr, 1.6);
    mixInto(out, thud(sr, rng, 48, 1.2, 1), 0, 1);
    const n = Math.floor(sr * 0.5);
    const hit = pink(n, rng);
    filt(hit, 'lowpass', sr, 3500);
    expDecay(hit, sr, 0.06);
    mixInto(out, hit, 0, 1);
    const sw = sineOsc(Math.floor(sr * 1.4), sr, (i) => 180 * Math.exp(-i / sr / 0.4) + 30);
    for (let i = 0; i < sw.length; i++) sw[i] *= Math.exp(-i / sr / 0.5);
    mixInto(out, sw, 0, 0.5);
    return [out];
  },
};

/** Drowning rush: water closing over the head — a swelling lowpassed roar with bubbles, ears filling. */
const drowningRush: Recipe = {
  id: 'drowning_rush',
  renderRate: 0.5,
  label: 'Death: drowning rush',
  category: 'player',
  bus: 'player',
  variants: 1,
  stereo: true,
  level: 0.9,
  preload: false,
  gen(sr, rng) {
    const dur = 3;
    const n = Math.floor(sr * dur);
    const chs = [0, 1].map((c) => {
      const r = rng.fork(c + 3);
      const x = pink(n, r);
      filt(x, 'lowpass', sr, 500);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        x[i] *= Math.min(1, t * 4) * (1 - Math.max(0, t - 0.7) / 0.3) * 1.8;
      }
      let t = 0.1;
      while (t < dur - 0.3) {
        const f = r.range(150, 700);
        const m = Math.floor(sr * r.range(0.02, 0.06));
        const b = sineOsc(m, sr, (i) => f * (1 + i / m));
        for (let i = 0; i < m; i++) b[i] *= Math.sin((Math.PI * i) / m);
        mixInto(x, b, t * sr, r.range(0.05, 0.2));
        t += r.exp(0.03);
      }
      return x;
    });
    return chs;
  },
};

export const PLAYER_RECIPES: Recipe[] = [heartbeat, breathCalm, breathStrained, panting, breathHold, breathRelease, gasp, coatRustle, grabHit, drowningRush];
