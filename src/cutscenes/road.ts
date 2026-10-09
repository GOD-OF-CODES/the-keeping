// County Road 9 (RC9) chainage helpers for the opening timelines (docs/C1-OPENING.md §1, §2), from the shared
// src/shared/road-rc9.json (pure: no three.js). PLAN space; s = metres eastward along the centreline from x 20
// (s < 0 continues straight west to the gate at s −17.2), n = offset, positive = left of eastbound (the westbound
// driver's right; the westbound lane centre is n +1.75).

import road from '../shared/road-rc9.json' with { type: 'json' };
import type { P3, VehicleTrack, Ease } from './types.ts';

interface Seg {
  id: string;
  s0: number;
  s1: number;
  kind: 'straight' | 'arc';
  start?: number[];
  heading?: number;
  centre?: number[];
  radius?: number;
  turn?: 'cw' | 'ccw';
  heading0?: number;
  heading1?: number;
}

export const ROAD = road as unknown as { segments: Seg[]; lanes: { westbound: number; eastbound: number }; gate_s: number; end_s: number };
const SEGS = ROAD.segments;

/** Centreline (x, y) and eastbound heading at chainage s. */
export function roadFrame(s: number): [number, number, number] {
  const first = SEGS[0];
  if (s <= first.s0) return [first.start![0] + (s - first.s0) * Math.cos(first.heading!), first.start![1] + (s - first.s0) * Math.sin(first.heading!), first.heading!];
  let g = SEGS[SEGS.length - 1];
  for (const x of SEGS) if (s <= x.s1) {
    g = x;
    break;
  }
  const d = s - g.s0;
  if (g.kind === 'straight') return [g.start![0] + d * Math.cos(g.heading!), g.start![1] + d * Math.sin(g.heading!), g.heading!];
  const sign = g.turn === 'cw' ? -1 : 1;
  const h = g.heading0! + (sign * d) / g.radius!;
  // the centre lies to the left (ccw) or right (cw) of the heading
  const nx = -Math.sin(h) * sign;
  const ny = Math.cos(h) * sign;
  return [g.centre![0] - nx * g.radius!, g.centre![1] - ny * g.radius!, h];
}

/** PLAN point at (s, n, z). */
export function roadPoint(s: number, n = 0, z = 0): P3 {
  const [x, y, h] = roadFrame(s);
  return [x - n * Math.sin(h), y + n * Math.cos(h), z];
}

/** Westbound heading (CCW from +x) at s: the eastbound tangent + π. */
export const westHeading = (s: number): number => roadFrame(s)[2] + Math.PI;

/** A polyline along the road from s0 to s1 (either direction) at offset n, every `step` m. */
export function roadPath(s0: number, s1: number, n: number, step = 4): P3[] {
  const k = Math.max(1, Math.ceil(Math.abs(s1 - s0) / step));
  const out: P3[] = [];
  for (let i = 0; i <= k; i++) out.push(roadPoint(s0 + ((s1 - s0) * i) / k, n));
  return out;
}

/** A vehicle-track segment driving the road from s0 to s1 in d seconds (heading follows the path). */
export function roadTrack(t: number, d: number, s0: number, s1: number, n: number, ease: Ease = 'linear'): VehicleTrack {
  return { t, d, path: roadPath(s0, s1, n), ease, heading: 'path' };
}
