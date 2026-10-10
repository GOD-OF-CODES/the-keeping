// C2-ESCAPE §3.3–3.7 (B4/B5) — the blood, as physics. PURE (no three.js, no DOM): node tests run it.
// PLAN space (metres, z up). The same closed-form ballistic runs here (terminations, at load) and in the TSL vertex
// shader (src/world/blood-fx.ts), so a particle dies exactly where its stain appears.
//
// Linear drag (time constant τ = v_terminal / g): v(t) = v_T + (v0 − v_T)·e^(−t/τ), v_T = (0, 0, −g·τ),
// p(t) = p0 + v_T·t + (v0 − v_T)·τ·(1 − e^(−t/τ)).
// Terminal speed of a water-like drop (Atlas et al. 1973, d in mm): v_T ≈ 9.65 − 10.3·e^(−0.6·d) m/s
//   (0.5 mm → 2.0, 1 mm → 4.0, 2 mm → 6.5, 4 mm → 8.7).
// Stains: maximum spread D ≈ 0.6·d·We^¼ (We = ρv²d/σ, ρ 1060 kg/m³, σ 0.055 N/m); the impact angle α (to the
// surface) stretches it: width/length = sin α (Balthazard). Pools settle 2.75 mm thick (capillary length 2.3 mm):
// 200 mL ≈ 0.07 m² (r ≈ 15 cm).

import type { P3 } from '../cutscenes/types.ts';

export const G = 9.81;
export const RHO = 1060;
export const SIGMA = 0.055;
export const POOL_THICK = 0.00275;

export type Receiver = 'floor' | 'table' | 'harlan' | 'ada' | 'tread';
export type Kind = 0 | 1 | 2; // 0 jet element, 1 drop, 2 mist

export interface Particle {
  kind: Kind;
  t0: number;
  p0: P3;
  v0: P3;
  /** radius (m) */
  r: number;
  /** drag time constant (s) */
  tau: number;
  /** death time (absolute, s) */
  tEnd: number;
  /** volume (mL) it carries */
  ml: number;
  hit: { p: P3; v: P3; rec: Receiver } | null;
}

export interface Stain {
  t: number;
  p: P3;
  /** surface normal (PLAN) */
  n: P3;
  /** length, width (m) and heading of the long axis (radians CCW from +x) */
  len: number;
  wid: number;
  yaw: number;
  /** 'splat' (a drop), 'streak' (a jet line), 'pool', 'print' */
  shape: 'splat' | 'streak' | 'pool' | 'print';
  ml: number;
  rec: Receiver;
}

export const vTerminal = (dMm: number): number => Math.max(0.3, 9.65 - 10.3 * Math.exp(-0.6 * dMm));
/** Linear-drag time constant matched to quadratic drag at the launch speed: the drag deceleration of a drop moving at
 *  u is g·(u/v_T)², so the equivalent linear τ = v_T² / (g·u) (u ≥ v_T/4; τ = 4·v_T/g for a drop starting from rest).
 *  A plain τ = v_T/g overstates the drag 3× on a 2.8 m/s jet (range 0.93 m instead of the 1.1 m of §3.3). */
export const tauFor = (r: number, speed = 0): number => {
  const vt = vTerminal(r * 2000);
  return (vt * vt) / (G * Math.max(vt * 0.25, speed));
};

/** Position at time t after launch (PLAN). */
export function ballistic(p0: P3, v0: P3, tau: number, t: number): P3 {
  const vtz = -G * tau;
  const k = tau * (1 - Math.exp(-t / tau));
  return [p0[0] + v0[0] * k, p0[1] + v0[1] * k, p0[2] + vtz * t + (v0[2] - vtz) * k];
}

export function velocityAt(v0: P3, tau: number, t: number): P3 {
  const e = Math.exp(-t / tau);
  const vtz = -G * tau;
  return [v0[0] * e, v0[1] * e, vtz + (v0[2] - vtz) * e];
}

/** Deterministic RNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Log-normal sample (median m, σ of ln). */
export function logNormal(r: () => number, median: number, sigma: number): number {
  const u = Math.max(1e-9, r());
  const v = r();
  return median * Math.exp(sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v));
}

// ------------------------------------------------------------------------------------------------ the C2 stage proxies

/** Static receivers of C2 (PLAN): the parlor floor, the sawbuck top with the rubber sheet, Harlan's body box while he
 *  stands at the strike root, Ada's torso across the table (before she rises). */
export interface Collider {
  rec: Receiver;
  /** box min / max (PLAN); the hit is on the top face when it enters from above, else the side it crosses */
  min: P3;
  max: P3;
  /** active time window */
  from: number;
  to: number;
}

export const C2_FLOOR_Z = 0.6;
export const C2_COLLIDERS: Collider[] = [
  { rec: 'table', min: [5.3, 2.2, 0.6], max: [5.9, 4.4, 1.4], from: -1, to: 1e9 },
  { rec: 'ada', min: [5.33, 2.95, 1.4], max: [6.0, 3.55, 1.66], from: -1, to: 21.9 },
  { rec: 'harlan', min: [4.95, 3.76, 0.6], max: [5.36, 4.16, 2.15], from: -1, to: 17.9 },
];

/** Step a particle at 240 Hz until it hits the floor or a collider (or 3 s pass); fills tEnd + hit. */
export function terminate(p: Particle, colliders: Collider[] = C2_COLLIDERS, floorZ = C2_FLOOR_Z): Particle {
  const dt = 1 / 240;
  let prev = p.p0;
  for (let s = dt; s < 3; s += dt) {
    const q = ballistic(p.p0, p.v0, p.tau, s);
    const tAbs = p.t0 + s;
    if (q[2] <= floorZ) {
      const f = (prev[2] - floorZ) / Math.max(1e-9, prev[2] - q[2]);
      const hp: P3 = [prev[0] + (q[0] - prev[0]) * f, prev[1] + (q[1] - prev[1]) * f, floorZ];
      p.tEnd = p.t0 + s - dt * (1 - f);
      p.hit = { p: hp, v: velocityAt(p.v0, p.tau, s), rec: 'floor' };
      return p;
    }
    for (const c of colliders) {
      if (tAbs < c.from || tAbs > c.to) continue;
      const inside = q[0] >= c.min[0] && q[0] <= c.max[0] && q[1] >= c.min[1] && q[1] <= c.max[1] && q[2] >= c.min[2] && q[2] <= c.max[2];
      const wasInside = prev[0] >= c.min[0] && prev[0] <= c.max[0] && prev[1] >= c.min[1] && prev[1] <= c.max[1] && prev[2] >= c.min[2] && prev[2] <= c.max[2];
      if (inside && !wasInside) {
        const top = prev[2] > c.max[2];
        p.tEnd = tAbs;
        p.hit = { p: top ? [q[0], q[1], c.max[2]] : q, v: velocityAt(p.v0, p.tau, s), rec: c.rec };
        return p;
      }
    }
    prev = q;
  }
  p.tEnd = p.t0 + 3;
  return p;
}

/** The stain a landing leaves (§3.4: D = 0.6·d·We^¼, width/length = sin α). Horizontal receivers only (z-up normal)
 *  except Harlan / Ada, whose stains live in their TSL masks (B6). */
export function stainOf(p: Particle): Stain | null {
  if (!p.hit || p.hit.rec === 'harlan' || p.hit.rec === 'ada') return null;
  const v = p.hit.v;
  const sp = Math.hypot(v[0], v[1], v[2]);
  const d = p.r * 2;
  const we = (RHO * sp * sp * d) / SIGMA;
  const D = Math.max(d * 1.2, 0.6 * d * Math.pow(Math.max(1, we), 0.25));
  const sinA = Math.min(1, Math.max(0.25, Math.abs(v[2]) / Math.max(1e-6, sp)));
  return { t: p.tEnd, p: p.hit.p, n: [0, 0, 1], len: D / sinA, wid: D, yaw: Math.atan2(v[1], v[0]), shape: p.kind === 0 ? 'streak' : 'splat', ml: p.ml, rec: p.hit.rec };
}

// ------------------------------------------------------------------------------------------------ the C2 seed

export interface PulseDef {
  t: number;
  v: number;
  d: number;
  ml: number;
}

export interface BloodTier {
  /** impact spatter drops (Max 250 / Medium 120 / Low 40) */
  spatter: number;
  /** jet element spacing (s) */
  jetDt: number;
  /** mist satellites per jet element (0 on Low) */
  mist: number;
  /** particle cap (Max 1750 / Medium 720 / Low 100; fix round: two carotid jets) */
  cap: number;
  /** stain cap (80 / 40 / 12) */
  stains: number;
}

export const BLOOD_TIERS: Record<'low' | 'medium' | 'max', BloodTier> = {
  low: { spatter: 40, jetDt: 0.012, mist: 0, cap: 100, stains: 12 },
  medium: { spatter: 120, jetDt: 0.004, mist: 0.35, cap: 720, stains: 40 },
  max: { spatter: 250, jetDt: 0.0025, mist: 0.9, cap: 1750, stains: 80 },
};

/** Pulse envelope: 40 ms ramp, hold, 80 ms fall (§3.3). */
export const pulseEnv = (u: number, d: number): number => (u < 0 || u > d ? 0 : Math.min(1, u / 0.04, (d - u) / 0.08));

export interface SeedOptions {
  neck: P3;
  pulses: readonly PulseDef[];
  contact: number;
  /** the heel of the raised blade (cast-off) and its drop times */
  castoff: { p: P3; t: number[] };
  /** the sheet corner drip (seep 1 mL/s, one drop every 0.5 s) */
  seep: { p: P3; from: number; to: number };
  tier: BloodTier;
  seed?: number;
}

/** Every particle of C2, launched and terminated (deterministic). Sorted by t0; capped to tier.cap (mist first out). */
export function seedC2(o: SeedOptions): Particle[] {
  const r = rng(o.seed ?? 7562);
  const out: Particle[] = [];
  const add = (kind: Kind, t0: number, p0: P3, v0: P3, rad: number, ml: number) => {
    out.push(terminate({ kind, t0, p0, v0, r: rad, tau: tauFor(rad, Math.hypot(v0[0], v0[1], v0[2])), tEnd: t0, ml, hit: null }));
  };
  // cast-off: a 4 mm drop pinches off the heel of the raised blade
  for (const t of o.castoff.t) add(1, t, o.castoff.p, [0, 0, -0.05], 0.002, 0.03);
  // the chop's impact spatter (medium velocity): log-normal 1–4 mm (median 1.8), 2–6 m/s, a 70° cone down-west
  const axis = norm([-0.72, 0.05, -0.69]);
  for (let i = 0; i < o.tier.spatter; i++) {
    const dMm = Math.min(4, Math.max(0.6, logNormal(r, 1.8, 0.45)));
    const sp = 2 + r() * 4;
    const dir = coneSample(r, axis, (35 * Math.PI) / 180);
    add(1, o.contact + r() * 0.012, jitter(r, o.neck, 0.02), [dir[0] * sp, dir[1] * sp, dir[2] * sp], dMm / 2000, ((Math.PI / 6) * Math.pow(dMm / 10, 3)) * 1000);
  }
  // the arterial pulses: a 4–5 mm jet west along the neck's axis, 0–15° below horizontal, wobbling ±4° at 9 Hz; it
  // breaks into 7–9 mm drops after ≈ 9 diameters (the element spacing + the capsule stretch read as one stream)
  o.pulses.forEach((pu, k) => {
    const n = Math.max(3, Math.round(pu.d / o.tier.jetDt));
    const ml = pu.ml / n;
    const el = -((4 + k * 3.5) * Math.PI) / 180;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) * (pu.d / n);
      const env = pulseEnv(u, pu.d);
      if (env <= 0.02) continue;
      const az = Math.PI + ((4 * Math.PI) / 180) * Math.sin(2 * Math.PI * 9 * u) + (r() - 0.5) * 0.02;
      const s = pu.v * (0.55 + 0.45 * env);
      // escape fix round (lane CINE): TWO jets, the left and right common carotids (≈ 2.2 cm either side of the
      // midline, on the anterior = lower side as she lies face down), diverging ±6°. Volume check (pulse 1): 25 mL in
      // 0.22 s = 114 mL/s at 2.8 m/s needs 41 mm² of stream; two 6 mm lumens (r 3 mm) = 57 mm² × the envelope ≈ ok
      // (was ONE r 2.25 mm jet = 16 mm²: a 2–3 px thread at 2.6 m on Medium)
      const v: P3 = [Math.cos(az) * Math.cos(el) * s, Math.sin(az) * Math.cos(el) * s, Math.sin(el) * s]; // the mist's mean
      for (const side of [-1, 1]) {
        const azs = az + side * ((6 * Math.PI) / 180);
        const v: P3 = [Math.cos(azs) * Math.cos(el) * s, Math.sin(azs) * Math.cos(el) * s, Math.sin(el) * s];
        add(0, pu.t + u, [o.neck[0], o.neck[1] + side * 0.022, o.neck[2] - 0.01], v, 0.003, ml / 2);
      }
      if (o.tier.mist > 0 && r() < o.tier.mist) {
        const mr = (0.25 + r() * 0.75) / 1000;
        add(2, pu.t + u, jitter(r, o.neck, 0.004), [v[0] + (r() - 0.5) * 0.8, v[1] + (r() - 0.5) * 0.8, v[2] + (r() - 0.3) * 0.6], mr, 0.0005);
      }
    }
  });
  // the seep after the heart stops: 1 mL/s, a drop every 0.5 s off the sheet corner
  for (let t = o.seep.from; t < o.seep.to; t += 0.5) add(1, t, o.seep.p, [0, 0, 0], 0.0039, 0.5);
  out.sort((a, b) => a.t0 - b.t0);
  if (out.length > o.tier.cap) {
    // over the cap: drop mist first, then thin the jet elements evenly
    const mist = out.filter((p) => p.kind === 2);
    const keep = out.filter((p) => p.kind !== 2);
    const room = o.tier.cap - keep.length;
    const res = room >= 0 ? keep.concat(mist.slice(0, room)) : keep.filter((_, i) => i % Math.ceil(keep.length / o.tier.cap) === 0);
    return res.sort((a, b) => a.t0 - b.t0).slice(0, o.tier.cap);
  }
  return out;
}

/** Stains from the landings: individual splats for drops; jet landings merge into streak/pool stains on a 4 cm grid
 *  (summed volume). Capped to tier.stains, keeping the biggest. */
export function stainsOf(ps: Particle[], cap: number): Stain[] {
  const out: Stain[] = [];
  const cells = new Map<string, { t: number; p: P3; ml: number; vx: number; vy: number; rec: Receiver; n: number }>();
  for (const p of ps) {
    if (!p.hit) continue;
    if (p.kind === 0 && p.hit.rec === 'floor') {
      const k = `${Math.round(p.hit.p[0] / 0.04)}:${Math.round(p.hit.p[1] / 0.04)}`;
      const c = cells.get(k);
      if (c) {
        c.ml += p.ml;
        c.t = Math.min(c.t, p.tEnd);
        c.n++;
        c.vx += p.hit.v[0];
        c.vy += p.hit.v[1];
      } else cells.set(k, { t: p.tEnd, p: p.hit.p, ml: p.ml, vx: p.hit.v[0], vy: p.hit.v[1], rec: p.hit.rec, n: 1 });
      continue;
    }
    if (p.kind === 2) continue; // mist leaves sub-mm dots (the stain atlas carries them inside the splats)
    const s = stainOf(p);
    if (s) out.push(s);
  }
  for (const c of cells.values()) {
    // a jet's landing: a streak along its travel, area from the volume at a 1 mm film
    const area = (c.ml * 1e-6) / 0.001;
    const wid = Math.max(0.008, Math.sqrt(area / 3));
    out.push({ t: c.t, p: c.p, n: [0, 0, 1], len: wid * 3, wid, yaw: Math.atan2(c.vy, c.vx), shape: 'streak', ml: c.ml, rec: c.rec });
  }
  out.sort((a, b) => b.ml - a.ml);
  return out.slice(0, cap).sort((a, b) => a.t - b.t);
}

/** Pool radius (m) for a volume (mL) at the settled thickness. */
export const poolRadius = (ml: number): number => Math.sqrt((Math.max(0, ml) * 1e-6) / (Math.PI * POOL_THICK));

/** Clotting (§3.4): fresh roughness 0.03–0.08 → 0.25 at the edges after 3–10 min → dried 0.55 (≥ 10 min). */
export function bloodRoughness(ageS: number, edge: number): number {
  const m = ageS / 60;
  const clot = Math.min(1, Math.max(0, (m - 3) / 7));
  const dry = Math.min(1, Math.max(0, (m - 10) / 20));
  return 0.05 + (0.25 - 0.05) * clot * edge + (0.55 - 0.25) * dry;
}

// ------------------------------------------------------------------------------------------------ helpers

function norm(v: P3): P3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function jitter(r: () => number, p: P3, s: number): P3 {
  return [p[0] + (r() - 0.5) * s, p[1] + (r() - 0.5) * s, p[2] + (r() - 0.5) * s];
}
/** Uniform direction inside a cone of half-angle a around axis. */
function coneSample(r: () => number, axis: P3, a: number): P3 {
  const cosA = Math.cos(a);
  const z = cosA + (1 - cosA) * r();
  const phi = 2 * Math.PI * r();
  const s = Math.sqrt(1 - z * z);
  const t = Math.abs(axis[2]) < 0.9 ? norm(cross(axis, [0, 0, 1])) : norm(cross(axis, [1, 0, 0]));
  const b = cross(axis, t);
  return norm([axis[0] * z + (t[0] * Math.cos(phi) + b[0] * Math.sin(phi)) * s, axis[1] * z + (t[1] * Math.cos(phi) + b[1] * Math.sin(phi)) * s, axis[2] * z + (t[2] * Math.cos(phi) + b[2] * Math.sin(phi)) * s]);
}
function cross(a: P3, b: P3): P3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
