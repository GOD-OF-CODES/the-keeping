// The car (a mid-70s sedan, straight-4): engine idle / sputter / stall / crank / catch, wipers, radio static,
// a radio song, tyres on gravel, fuel glug. The low-fuel chime lives in bells.ts.
//
// Engine (Farnell "Engines"): model combustion, not the waveform. Each firing is an exhaust pressure pulse (a
// short noisy burst with a low thump); the pulse train at the firing frequency (rpm/60 × cylinders/2) is coloured
// by the exhaust pipe (comb-like resonances) and the muffler (lowpass). Per-cylinder amplitude differences give
// the lumpy idle; misfires drop pulses; sputter = misfires + rpm sag.

import { Rng, buf, click, filt, mixInto, pink, white, blip, resonate, stickSlip, smoothNoise, comb, expDecay, makeLoop, Biquad } from './dsp.ts';
import { sawOsc, thud, metalHit, droplet, sineOsc } from './common.ts';
import type { Recipe } from './types.ts';

const CYL = 4;

function firingPulse(sr: number, rng: Rng, load: number): Float32Array {
  const n = Math.floor(sr * 0.05);
  const x = white(n, rng);
  filt(x, 'lowpass', sr, 900 + 1500 * load);
  expDecay(x, sr, 0.006 + 0.004 * load);
  const t = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    ph += (2 * Math.PI * 55) / sr;
    t[i] = Math.sin(ph) * Math.exp(-i / sr / 0.012);
  }
  mixInto(x, t, 0, 0.9);
  return x;
}

interface EngineOpts {
  dur: number;
  rpmAt: (t: number) => number;
  /** 0..1 misfire probability at time t. */
  missAt?: (t: number) => number;
  load?: number;
  loop?: boolean;
}

function engine(sr: number, rng: Rng, o: EngineOpts): Float32Array {
  const n = Math.floor(sr * o.dur);
  const pulses = new Float32Array(n + Math.floor(sr * 0.1));
  const cylAmp = Array.from({ length: CYL }, () => rng.range(0.75, 1.1));
  let t = 0;
  let k = 0;
  const load = o.load ?? 0.3;
  while (t < o.dur) {
    const rpm = o.rpmAt(t);
    if (rpm < 30) break;
    const miss = o.missAt ? o.missAt(t) : 0;
    if (rng.next() >= miss) {
      const p = firingPulse(sr, rng, load);
      const at = Math.floor(t * sr);
      const a = cylAmp[k % CYL] * rng.range(0.9, 1.1);
      for (let i = 0; i < p.length; i++) {
        const j = at + i;
        if (o.loop) pulses[j % n] += p[i] * a;
        else if (j < pulses.length) pulses[j] += p[i] * a;
      }
    } else if (rng.next() < 0.3) {
      // backfire pop on a misfire
      const c = click(sr, rng, 3);
      mixInto(pulses, c, t * sr, 0.8);
    }
    const firingHz = (rpm / 60) * (CYL / 2);
    t += (1 / firingHz) * rng.range(0.985, 1.015);
    k++;
  }
  const x = o.loop ? pulses.slice(0, n) : pulses.slice(0, n);
  // exhaust pipe + muffler
  const pipe = x.slice();
  comb(pipe, sr, rng.range(85, 105), 0.55, 0.4);
  const out = new Float32Array(n);
  mixInto(out, x, 0, 0.6);
  mixInto(out, pipe, 0, 0.5);
  filt(out, 'lowpass', sr, 1400);
  filt(out, 'peaking', sr, 120, 1, 5);
  // mechanical: valve-train tick & fan belt whine, following rpm
  const mech = white(n, rng);
  filt(mech, 'bandpass', sr, 3500, 2);
  for (let i = 0; i < n; i++) {
    const rpm = o.rpmAt(i / sr);
    mech[i] *= 0.04 * Math.min(1, rpm / 800);
  }
  mixInto(out, mech, 0, 1);
  filt(out, 'highpass', sr, 30);
  return out;
}

const idleRpm = 780;

/** Idle loop, heard from inside the cabin. Integer number of engine cycles; events wrap for a seamless loop. */
const engineIdle: Recipe = {
  id: 'engine_idle',
  renderRate: 0.5,
  label: 'Engine idle (loop)',
  category: 'car',
  bus: 'sfx',
  variants: 1,
  loop: true,
  stereo: false,
  level: 0.55,
  params: { rpm: { min: 600, max: 2400, default: idleRpm } },
  gen(sr, rng, p) {
    const cycles = Math.round((p.rpm / 60 / 2) * 3); // ~3 s of 720° cycles
    const dur = cycles / (p.rpm / 60 / 2);
    return [engine(sr, rng, { dur, rpmAt: () => p.rpm, loop: true, load: 0.25 })];
  },
};

/** Sputter: fuel starvation — misfires cluster, rpm sags and recovers, 2–3 s. */
const engineSputter: Recipe = {
  id: 'engine_sputter',
  renderRate: 0.5,
  label: 'Engine sputter',
  category: 'car',
  bus: 'sfx',
  variants: 2,
  level: 0.6,
  gen(sr, rng) {
    const dur = rng.range(2.2, 3);
    const sag = smoothNoise(Math.floor(sr * dur), sr, 3, rng);
    return [engine(sr, rng, {
      dur,
      rpmAt: (t) => idleRpm * (0.8 + 0.2 * sag[Math.min(sag.length - 1, Math.floor(t * sr))]),
      missAt: (t) => 0.25 + 0.35 * Math.max(0, sag[Math.min(sag.length - 1, Math.floor(t * sr))]),
    })];
  },
};

/** Stall: the engine coughs, runs down and dies; the body shudders on its mounts. */
const engineStall: Recipe = {
  id: 'engine_stall',
  renderRate: 0.5,
  label: 'Engine stall',
  category: 'car',
  bus: 'sfx',
  variants: 1,
  level: 0.6,
  gen(sr, rng) {
    const dur = 3.2;
    const x = engine(sr, rng, {
      dur,
      rpmAt: (t) => (t < 1 ? idleRpm * (1 - 0.15 * Math.sin(t * 9)) : idleRpm * Math.max(0, 1 - (t - 1) / 1.6) ** 1.4),
      missAt: (t) => (t < 1 ? 0.3 : 0.45),
    });
    const out = buf(sr, dur + 0.8);
    mixInto(out, x, 0, 1);
    mixInto(out, thud(sr, rng, 38, 0.8, 0.6), 2.6 * sr, 0.8);
    mixInto(out, metalHit(sr, rng, { f0: 900, ratios: [1, 2.3, 4.1], decay: 0.1, dur: 0.4 }), 2.65 * sr, 0.1);
    return [out];
  },
};

/**
 * Starter crank: the starter motor's whine (gear-mesh saw) drags down on every compression stroke (4 per 2 revs
 * at ~200 rpm cranking speed), giving the "rrr-rrr-rrr" rhythm; weak battery = slower.
 */
function crank(sr: number, rng: Rng, dur: number, rate = 7): Float32Array {
  const n = Math.floor(sr * dur);
  const freq = (i: number) => {
    const t = i / sr;
    const comp = 0.5 + 0.5 * Math.cos(2 * Math.PI * rate * t);
    return 130 * (0.75 + 0.25 * comp) * Math.min(1, t * 8 + 0.3);
  };
  const s = sawOsc(n, sr, freq);
  filt(s, 'lowpass', sr, 1600);
  const gear = sawOsc(n, sr, (i) => freq(i) * 9);
  filt(gear, 'bandpass', sr, 1200, 2);
  mixInto(s, gear, 0, 0.2);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    s[i] *= (0.55 + 0.45 * Math.cos(2 * Math.PI * rate * t)) * Math.min(1, t * 20) * Math.min(1, (dur - t) * 10);
  }
  const eng = engine(sr, rng, { dur, rpmAt: () => rate * 30, missAt: () => 1 });
  mixInto(s, eng, 0, 0.2);
  const clunk = thud(sr, rng, 90, 0.15, 0.6);
  mixInto(s, clunk, 0, 0.6);
  return s;
}

const engineCrank: Recipe = {
  id: 'engine_crank',
  renderRate: 0.5,
  label: 'Starter crank (no catch)',
  category: 'car',
  bus: 'sfx',
  variants: 2,
  level: 0.6,
  preload: false,
  gen: (sr, rng) => [crank(sr, rng, rng.range(1.2, 1.8), rng.range(6, 7.5))],
};

/** Crank → two coughs → catch and settle to idle (B12). */
const engineCatch: Recipe = {
  id: 'engine_catch',
  renderRate: 0.5,
  label: 'Crank, cough, catch',
  category: 'car',
  bus: 'sfx',
  variants: 1,
  level: 0.65,
  preload: false,
  gen(sr, rng) {
    const out = buf(sr, 5);
    mixInto(out, crank(sr, rng, 1.3), 0, 1);
    mixInto(out, engine(sr, rng, { dur: 0.35, rpmAt: () => 500, missAt: () => 0.3, load: 0.6 }), 0.6 * sr, 0.9);
    mixInto(out, crank(sr, rng, 0.9), 1.5 * sr, 0.9);
    const e = engine(sr, rng, {
      dur: 2.8,
      rpmAt: (t) => (t < 0.4 ? 400 + t * 3000 : idleRpm + 900 * Math.exp(-(t - 0.4) / 0.5)),
      missAt: (t) => (t < 0.3 ? 0.4 : 0.02),
      load: 0.5,
    });
    mixInto(out, e, 2.1 * sr, 1);
    return [out];
  },
};

/**
 * Wiper sweep: gear-motor hum, rubber blade on wet glass (light stick-slip squeak + smear), thunk at reversal.
 */
const wiper: Recipe = {
  id: 'wiper',
  label: 'Wiper sweep',
  category: 'car',
  bus: 'sfx',
  variants: 3,
  level: 0.45,
  gen(sr, rng) {
    const dur = rng.range(0.95, 1.1);
    const n = Math.floor(sr * dur);
    const out = buf(sr, dur + 0.2);
    const sp = (u: number) => Math.sin(Math.PI * u);
    const tr = stickSlip(n, sr, rng, (i) => sp(i / n), () => 1.2, 700);
    mixInto(out, resonate(tr, sr, [{ freq: rng.range(900, 1300), q: 8, gain: 1 }, { freq: 2700, q: 10, gain: 0.4 }]), 0, 0.25);
    const smear = pink(n, rng);
    filt(smear, 'bandpass', sr, 2500, 0.7);
    for (let i = 0; i < n; i++) smear[i] *= sp(i / n) ** 0.5;
    mixInto(out, smear, 0, 0.3);
    const hum = sawOsc(n, sr, () => 118);
    filt(hum, 'lowpass', sr, 500);
    for (let i = 0; i < n; i++) hum[i] *= 0.05;
    mixInto(out, hum, 0, 1);
    mixInto(out, thud(sr, rng, 140, 0.1, 0.5), (dur - 0.02) * sr, 0.35);
    return [out];
  },
};

/**
 * AM radio static between stations: band-limited hiss (300–3.5 kHz), impulsive atmospheric crackle (it is a
 * thunderstorm), a slowly drifting heterodyne whistle, and fading. Loop.
 */
const radioStatic: Recipe = {
  id: 'radio_static',
  renderRate: 0.5,
  label: 'Radio static (loop)',
  category: 'car',
  bus: 'sfx',
  variants: 1,
  loop: true,
  level: 0.4,
  params: { dur: { min: 2, max: 10, default: 6 } },
  gen(sr, rng, p) {
    const n = Math.floor(sr * p.dur);
    const x = white(n, rng);
    const fade = smoothNoise(n, sr, 0.6, rng);
    for (let i = 0; i < n; i++) x[i] *= 0.35 * (0.7 + 0.3 * fade[i]);
    let t = 0;
    while (t < p.dur) {
      const c = click(sr, rng, rng.range(0.3, 4));
      mixInto(x, c, t * sr, rng.range(0.3, 1.2));
      t += rng.exp(0.09);
    }
    const drift = smoothNoise(n, sr, 0.2, rng);
    const wh = sineOsc(n, sr, (i) => 1450 + 300 * drift[i]);
    mixInto(x, wh, 0, 0.04);
    filt(x, 'highpass', sr, 300);
    filt(x, 'lowpass', sr, 3500);
    filt(x, 'lowpass', sr, 3500);
    return [makeLoop(x, sr, 0.3)];
  },
};

/**
 * "A synthesized song" on the radio (B12, M2): a slow country-ish I–IV–V progression, plucked strings via
 * Karplus-Strong, band-limited to an AM car speaker. 12 s loop.
 */
const radioSong: Recipe = {
  id: 'radio_song',
  renderRate: 0.5,
  label: 'Radio song (AM)',
  category: 'car',
  bus: 'score',
  variants: 1,
  loop: true,
  level: 0.45,
  preload: false,
  gen(sr, rng) {
    const bpm = 84;
    const beat = 60 / bpm;
    const bars = 4;
    const dur = bars * 4 * beat;
    const n = Math.floor(sr * dur);
    const out = new Float32Array(n + sr * 2);
    const chords = [[196, 247, 294], [262, 330, 392], [294, 370, 440], [196, 247, 294]]; // G C D G
    const melody = [392, 440, 494, 440, 392, 330, 294, 330, 392, 392, 440, 494, 587, 494, 440, 392];
    const pluck = (f: number, len: number, bright: number) => {
      const period = Math.floor(sr / f);
      const m = Math.floor(sr * len);
      const y = new Float32Array(m);
      const d = new Float32Array(period);
      for (let i = 0; i < period; i++) d[i] = rng.bi();
      let j = 0;
      for (let i = 0; i < m; i++) {
        const a = d[j];
        const b = d[(j + 1) % period];
        d[j] = (a * bright + b * (1 - bright)) * 0.996;
        y[i] = a;
        j = (j + 1) % period;
      }
      return y;
    };
    for (let b = 0; b < bars; b++) {
      for (let q = 0; q < 4; q++) {
        const t = (b * 4 + q) * beat;
        chords[b].forEach((f, k) => mixInto(out, pluck(f / (q % 2 ? 1 : 2), 1.2, 0.5), (t + k * 0.012) * sr, 0.3));
      }
    }
    melody.forEach((f, i) => mixInto(out, pluck(f, 0.9, 0.3), i * beat * sr, 0.35));
    const loop = out.slice(0, n);
    for (let i = n; i < out.length; i++) loop[i - n] += out[i];
    filt(loop, 'highpass', sr, 250);
    filt(loop, 'lowpass', sr, 3200);
    const hiss = white(n, rng);
    filt(hiss, 'bandpass', sr, 2000, 0.5);
    mixInto(loop, hiss, 0, 0.03);
    return [loop];
  },
};

/** Tyres rolling on gravel (loop): continuous granular crunch whose density follows speed. */
const tyresGravel: Recipe = {
  id: 'tyres_gravel',
  label: 'Tyres on gravel (loop)',
  category: 'car',
  bus: 'sfx',
  variants: 1,
  loop: true,
  level: 0.5,
  preload: false,
  gen(sr, rng) {
    const dur = 4;
    const n = Math.floor(sr * dur);
    const x = new Float32Array(n);
    let t = 0;
    while (t < dur) {
      const c = click(sr, rng, rng.range(0.2, 1));
      filt(c, 'bandpass', sr, rng.range(800, 5000), 2);
      mixInto(x, c, t * sr, rng.range(0.2, 1));
      t += rng.exp(0.003);
    }
    const rumble = pink(n, rng);
    filt(rumble, 'lowpass', sr, 200);
    mixInto(x, rumble, 0, 0.6);
    return [makeLoop(x, sr, 0.3)];
  },
};

/** Pouring the jerry can (B12, M2): liquid stream + glugs as air bubbles back into the can. */
const fuelGlug: Recipe = {
  id: 'fuel_glug',
  label: 'Fuel pour + glug',
  category: 'car',
  bus: 'sfx',
  variants: 1,
  level: 0.55,
  preload: false,
  gen(sr, rng) {
    const dur = 3;
    const out = buf(sr, dur);
    const n = out.length;
    const stream = pink(n, rng);
    const bq = new Biquad('bandpass', sr, 800, 1.2);
    for (let i = 0; i < n; i++) stream[i] = bq.tick(stream[i]) * Math.min(1, i / sr / 0.2) * 0.5;
    mixInto(out, stream, 0, 1);
    let t = 0.2;
    while (t < dur - 0.2) {
      const f = rng.range(120, 220);
      mixInto(out, blip(sr, f, f * 1.6, rng.range(0.06, 0.12)), t * sr, 1);
      mixInto(out, droplet(sr, rng, { size: 1.2 }), (t + 0.02) * sr, 0.2);
      t += rng.range(0.14, 0.22);
    }
    const can = resonate(out, sr, [{ freq: 310, q: 10, gain: 0.3 }, { freq: 640, q: 10, gain: 0.2 }]);
    mixInto(out, can, 0, 1);
    return [out];
  },
};

export const CAR_RECIPES: Recipe[] = [engineIdle, engineSputter, engineStall, engineCrank, engineCatch, wiper, radioStatic, radioSong, tyresGravel, fuelGlug];
