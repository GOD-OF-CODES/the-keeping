// Pure math for the sequencer: easing, centripetal Catmull-Rom identical to three r186's
// CatmullRomCurve3.getPoint (open curve, 'centripetal'; parity-tested in tests/cutscene.test.ts), an arc-length
// reparameterisation (like Curve.getPointAt, 200 divisions), seeded value noise for handheld camera drift.

import type { Ease, P3 } from './types.ts';

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function ease(kind: Ease | undefined, x: number, dflt: Ease = 'inOut'): number {
  const u = clamp01(x);
  switch (kind ?? dflt) {
    case 'linear':
      return u;
    case 'in':
      return u * u * u;
    case 'out':
      return 1 - (1 - u) ** 3;
    case 'hold':
      return 0;
    case 'inOut':
    default:
      return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
  }
}

const dist2 = (a: P3, b: P3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function nonuniform(x0: number, x1: number, x2: number, x3: number, dt0: number, dt1: number, dt2: number, w: number): number {
  let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
  let t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
  t1 *= dt1;
  t2 *= dt1;
  const c0 = x1;
  const c1 = t1;
  const c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2;
  const c3 = 2 * x1 - 2 * x2 + t1 + t2;
  return c0 + c1 * w + c2 * w * w + c3 * w * w * w;
}

/** three's CatmullRomCurve3(points, false, 'centripetal').getPoint(t), t ∈ [0, 1]. */
export function catmullRomPoint(points: readonly P3[], t: number): P3 {
  const l = points.length;
  if (l === 0) return [0, 0, 0];
  if (l === 1) return [points[0][0], points[0][1], points[0][2]];
  const p = (l - 1) * t;
  let i = Math.floor(p);
  let w = p - i;
  if (w === 0 && i === l - 1) {
    i = l - 2;
    w = 1;
  }
  if (i < 0) {
    i = 0;
    w = 0;
  }
  if (i > l - 2) {
    i = l - 2;
    w = 1;
  }
  const p1 = points[i];
  const p2 = points[i + 1];
  const p0: P3 = i > 0 ? points[i - 1] : [2 * points[0][0] - points[1][0], 2 * points[0][1] - points[1][1], 2 * points[0][2] - points[1][2]];
  const p3: P3 = i + 2 < l ? points[i + 2] : [2 * points[l - 1][0] - points[l - 2][0], 2 * points[l - 1][1] - points[l - 2][1], 2 * points[l - 1][2] - points[l - 2][2]];
  let dt0 = Math.pow(dist2(p0, p1), 0.25);
  let dt1 = Math.pow(dist2(p1, p2), 0.25);
  let dt2 = Math.pow(dist2(p2, p3), 0.25);
  if (dt1 < 1e-4) dt1 = 1.0;
  if (dt0 < 1e-4) dt0 = dt1;
  if (dt2 < 1e-4) dt2 = dt1;
  return [
    nonuniform(p0[0], p1[0], p2[0], p3[0], dt0, dt1, dt2, w),
    nonuniform(p0[1], p1[1], p2[1], p3[1], dt0, dt1, dt2, w),
    nonuniform(p0[2], p1[2], p2[2], p3[2], dt0, dt1, dt2, w),
  ];
}

/** A path with constant-speed sampling (arc length, like three's Curve.getPointAt with 200 divisions). */
export class ArcPath {
  readonly points: readonly P3[];
  private readonly lengths: number[] = [];
  readonly length: number;

  constructor(points: readonly P3[], divisions = 200) {
    this.points = points;
    if (points.length < 2) {
      this.length = 0;
      return;
    }
    let last = catmullRomPoint(points, 0);
    let sum = 0;
    this.lengths.push(0);
    for (let i = 1; i <= divisions; i++) {
      const p = catmullRomPoint(points, i / divisions);
      sum += Math.sqrt(dist2(p, last));
      this.lengths.push(sum);
      last = p;
    }
    this.length = sum;
  }

  /** u ∈ [0, 1] of the arc length → curve parameter t. */
  uToT(u: number): number {
    const L = this.lengths;
    const n = L.length - 1;
    if (n <= 0 || this.length <= 0) return clamp01(u);
    const target = clamp01(u) * this.length;
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (L[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const i = Math.max(1, lo);
    const a = L[i - 1];
    const b = L[i];
    const f = b > a ? (target - a) / (b - a) : 0;
    return (i - 1 + f) / n;
  }

  at(u: number): P3 {
    if (this.points.length === 1) return [this.points[0][0], this.points[0][1], this.points[0][2]];
    return catmullRomPoint(this.points, this.uToT(u));
  }

  /** Unit tangent (PLAN) at u (finite difference). */
  tangent(u: number): P3 {
    const e = 1e-3;
    const a = this.at(Math.max(0, u - e));
    const b = this.at(Math.min(1, u + e));
    const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
    return [(b[0] - a[0]) / d, (b[1] - a[1]) / d, (b[2] - a[2]) / d];
  }
}

/** FNV-1a string hash → uint32 (seeds). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hash1(i: number, seed: number): number {
  let x = Math.imul(i ^ seed, 0x27d4eb2d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296; // [0, 1)
}

/** Smooth 1-D value noise in [-1, 1], deterministic in (x, seed). */
export function valueNoise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  return lerp(hash1(i, seed), hash1(i + 1, seed), s) * 2 - 1;
}

/** Handheld drift: two octaves per axis (breathing ~0.3 Hz + micro jitter ~1.7 Hz). Radians per unit amplitude. */
export function handheld(time: number, seed: number, amp: number): [number, number, number] {
  if (!amp) return [0, 0, 0];
  const k = 0.0087 * amp; // 0.5°
  const ax = (o: number) => valueNoise(time * 0.31 + o, seed + o) * 0.8 + valueNoise(time * 1.7 + o * 3, seed ^ (o * 7919)) * 0.2;
  return [ax(11) * k, ax(23) * k * 0.8, ax(37) * k * 0.35];
}

/** Heading (radians CCW from +x) of a PLAN direction. */
export const headingOf = (d: P3): number => Math.atan2(d[1], d[0]);

/** Car-local (x right, y forward, z up) → PLAN, for a car at `pos` facing `heading`. */
export function carToPlan(local: P3, pos: P3, heading: number): P3 {
  // forward = (cos h, sin h); right = (sin h, -cos h)
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return [pos[0] + local[0] * s + local[1] * c, pos[1] - local[0] * c + local[1] * s, pos[2] + local[2]];
}

export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function sampleKeys(keys: readonly { t: number; v: number }[] | undefined, t: number, dflt = 0): number {
  if (!keys || keys.length === 0) return dflt;
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const a = keys[i - 1];
      const b = keys[i];
      return b.t > a.t ? lerp(a.v, b.v, (t - a.t) / (b.t - a.t)) : b.v;
    }
  }
  return keys[keys.length - 1].v;
}
