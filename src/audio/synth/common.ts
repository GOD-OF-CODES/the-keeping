// Reusable physical building blocks for the recipes: struck wood and metal bodies, droplets, breath puffs,
// band-limited oscillators. Each follows a Farnell-style "model the physical process, not the waveform" approach:
// an excitation (impulse, noise burst, friction train) feeding a resonant body (modes / filters).

import {
  Rng, Biquad, buf, click, expDecay, filt, mixInto, modal, pink, white, blip, resonate, stickSlip, scale,
  type Mode,
} from './dsp.ts';

/**
 * Struck wooden body (Farnell "Wood" / "Knocking"): wood has low Q, inharmonic plate modes that die fast. A short
 * pink burst supplies the contact noise; `size` scales the fundamental (bigger panel = lower), `damp` shortens
 * decays (a door on its frame vs a loose board).
 */
export function woodImpact(sr: number, rng: Rng, o: { f0: number; dur?: number; damp?: number; hardness?: number; amp?: number }): Float32Array {
  const dur = o.dur ?? 0.35;
  const n = Math.floor(sr * dur);
  const damp = o.damp ?? 1;
  const ratios = [1, 1.58, 2.24, 2.92, 3.87, 5.1, 6.6];
  const modes: Mode[] = ratios.map((r, k) => ({
    freq: o.f0 * r * rng.range(0.96, 1.04),
    amp: (1 / (1 + k * 0.7)) * rng.range(0.6, 1),
    decay: (0.09 / (1 + k * 0.45)) / damp,
    phase: rng.range(0, Math.PI),
  }));
  const body = modal(n, sr, modes);
  const hard = o.hardness ?? 0.5;
  const contact = click(sr, rng, 3 + (1 - hard) * 8, 'pink');
  filt(contact, 'lowpass', sr, 1500 + hard * 6000);
  mixInto(body, contact, 0, 0.9 * hard + 0.2);
  return scale(body, o.amp ?? 1);
}

/** Low "thud" of a heavy soft impact (foot on a floor, body on wood): damped sine with a pitch drop + noise. */
export function thud(sr: number, rng: Rng, f0: number, dur = 0.25, noiseAmt = 0.4): Float32Array {
  const n = Math.floor(sr * dur);
  const x = new Float32Array(n);
  let ph = rng.range(0, 1);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = f0 * (1 + 0.6 * Math.exp(-t * 40));
    ph += (2 * Math.PI * f) / sr;
    x[i] = Math.sin(ph) * Math.exp(-t / (dur * 0.25));
  }
  const nz = pink(n, rng);
  filt(nz, 'lowpass', sr, f0 * 6);
  expDecay(nz, sr, dur * 0.12);
  mixInto(x, nz, 0, noiseAmt);
  return x;
}

/**
 * Metal body (Farnell "Bells", "Metal"): high-Q inharmonic modes, optionally split into close doublets so the
 * tail beats slowly the way real cast/forged metal does.
 */
export function metalHit(sr: number, rng: Rng, o: { f0: number; ratios: number[]; decay: number; dur?: number; split?: number; bright?: number; amp?: number }): Float32Array {
  const dur = o.dur ?? Math.min(6, o.decay * 5);
  const n = Math.floor(sr * dur);
  const modes: Mode[] = [];
  const bright = o.bright ?? 0.6;
  o.ratios.forEach((r, k) => {
    const f = o.f0 * r * rng.range(0.995, 1.005);
    const a = Math.pow(bright, k) * rng.range(0.7, 1);
    const d = o.decay / (1 + k * 0.35);
    modes.push({ freq: f, amp: a, decay: d, phase: rng.range(0, 6.28) });
    if (o.split) modes.push({ freq: f * (1 + o.split * rng.range(0.5, 1.5)), amp: a * 0.6, decay: d, phase: rng.range(0, 6.28) });
  });
  const x = modal(n, sr, modes);
  const tick = click(sr, rng, 1.2);
  filt(tick, 'highpass', sr, 2000);
  mixInto(x, tick, 0, 0.35);
  return scale(x, o.amp ?? 1);
}

/** A water droplet: tiny impact tick + Minnaert bubble whose pitch RISES as the cavity collapses (Farnell "Water"). */
export function droplet(sr: number, rng: Rng, o: { f?: number; size?: number; wet?: number } = {}): Float32Array {
  const size = o.size ?? 1;
  const f = (o.f ?? rng.range(900, 2400)) / size;
  const dur = 0.03 + 0.05 * size;
  const b = blip(sr, f, f * rng.range(1.4, 2.4), dur, 0.8 * (o.wet ?? 1));
  const t = click(sr, rng, 0.8 + size);
  filt(t, 'highpass', sr, 1200);
  const out = buf(sr, dur + 0.01);
  mixInto(out, t, 0, 0.6);
  mixInto(out, b, Math.floor(sr * 0.002), 1);
  return out;
}

/**
 * Breath puff: turbulent airflow through the vocal tract = noise shaped by a few formant band-passes (the vowel
 * the mouth is shaped for) plus an aspiration high band. `voiced` adds a faint glottal buzz (strained / gasp).
 */
export function breathPuff(sr: number, rng: Rng, o: { dur: number; inhale: boolean; amp?: number; voiced?: number; formants?: number[]; attack?: number; release?: number; rough?: number }): Float32Array {
  const n = Math.floor(sr * o.dur);
  const src = white(n, rng);
  const f = o.formants ?? (o.inhale ? [700, 1300, 2600] : [500, 1100, 2400]);
  const shaped = resonate(src, sr, [
    { freq: f[0], q: 3, gain: 0.8 },
    { freq: f[1], q: 4, gain: 0.55 },
    { freq: f[2], q: 5, gain: 0.35 },
  ]);
  const air = white(n, rng);
  filt(air, 'highpass', sr, o.inhale ? 3500 : 2500);
  filt(air, 'lowpass', sr, 9000);
  mixInto(shaped, air, 0, o.inhale ? 0.25 : 0.12);
  if (o.voiced) {
    const f0 = o.inhale ? rng.range(170, 240) : rng.range(110, 150);
    let ph = 0;
    const g = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      ph += (f0 * (1 + 0.02 * Math.sin(i / sr * 30))) / sr;
      const p = ph % 1;
      g[i] = p < 0.4 ? Math.sin((p / 0.4) * Math.PI) : 0; // glottal pulse
    }
    const vg = resonate(g, sr, [
      { freq: f[0], q: 6, gain: 1 },
      { freq: f[1], q: 8, gain: 0.5 },
    ]);
    mixInto(shaped, vg, 0, o.voiced * 0.6);
  }
  const atk = o.attack ?? (o.inhale ? 0.35 : 0.15);
  const rel = o.release ?? 0.5;
  const rough = o.rough ?? 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    let e = t < atk ? Math.sin((t / atk) * Math.PI * 0.5) : Math.pow(Math.max(0, 1 - (t - atk) / (1 - atk)), 1 + rel);
    if (rough) e *= 1 + rough * Math.sin(i / sr * 2 * Math.PI * rng.range(20, 34)) * (rng.next() < 0.5 ? 1 : 0.6);
    shaped[i] *= e;
  }
  return scale(shaped, o.amp ?? 1);
}

/** Band-limited sawtooth via PolyBLEP. */
export function sawOsc(n: number, sr: number, freqAt: (i: number) => number, phase = 0): Float32Array {
  const x = new Float32Array(n);
  let p = phase;
  for (let i = 0; i < n; i++) {
    const dt = freqAt(i) / sr;
    p += dt;
    if (p >= 1) p -= 1;
    let v = 2 * p - 1;
    if (p < dt) {
      const t = p / dt;
      v -= t + t - t * t - 1;
    } else if (p > 1 - dt) {
      const t = (p - 1) / dt;
      v -= t * t + t + t + 1;
    }
    x[i] = v;
  }
  return x;
}

export function sineOsc(n: number, sr: number, freqAt: (i: number) => number, phase = 0): Float32Array {
  const x = new Float32Array(n);
  let p = phase;
  for (let i = 0; i < n; i++) {
    p += (2 * Math.PI * freqAt(i)) / sr;
    x[i] = Math.sin(p);
  }
  return x;
}

/** Friction creak through a wooden body: stick-slip train → board/panel resonances. */
export function woodCreak(sr: number, rng: Rng, o: { dur: number; f0: number; speedAt?: (t: number) => number; pressureAt?: (t: number) => number; rate?: number; q?: number }): Float32Array {
  const n = Math.floor(sr * o.dur);
  const speed = o.speedAt ?? ((t: number) => Math.sin(Math.PI * Math.min(1, t)));
  const press = o.pressureAt ?? (() => 1);
  const train = stickSlip(n, sr, rng, (i) => speed(i / n), (i) => press(i / n), o.rate ?? 180);
  const q = o.q ?? 12;
  const body = resonate(train, sr, [
    { freq: o.f0, q, gain: 1 },
    { freq: o.f0 * 2.03, q: q * 0.9, gain: 0.6 },
    { freq: o.f0 * 3.1, q: q * 0.8, gain: 0.35 },
    { freq: o.f0 * 4.7, q: q * 0.7, gain: 0.2 },
    { freq: o.f0 * 7.3, q: q * 0.6, gain: 0.12 },
  ]);
  filt(body, 'highpass', sr, 60);
  return body;
}

/** Scrape/drag noise: friction noise bandpassed, amplitude-grained by the surface texture. */
export function scrapeNoise(n: number, sr: number, rng: Rng, o: { lo: number; hi: number; grain: number; speedAt: (t: number) => number }): Float32Array {
  const x = white(n, rng);
  const hp = new Biquad('highpass', sr, o.lo);
  const lp = new Biquad('lowpass', sr, o.hi);
  let g = 0;
  for (let i = 0; i < n; i++) {
    const v = o.speedAt(i / n);
    if ((i & 15) === 0) g = 1 + o.grain * (rng.next() * 2 - 1) * (rng.next() < 0.1 ? 3 : 1);
    x[i] = lp.tick(hp.tick(x[i])) * v * g;
  }
  return x;
}
