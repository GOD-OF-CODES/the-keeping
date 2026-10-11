// PERF contract 116 (fix round 3, ruling (q)): the torch caster cull must be SOUND — a caster it drops can never shadow
// a point inside the view frustum's four side planes. Brute force: random lights, casters and frusta; for every culled
// caster, march rays from the light through points of its bounding sphere out to the shadow reach and assert that no
// point beyond the sphere point lies inside all four side planes.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import { coneMayShadow } from '../src/render/view-caster-cull.ts';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function norm(v: number[]): number[] {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / l, v[1]! / l, v[2]! / l];
}
/** Four side planes of a symmetric perspective frustum at eye E looking along f (up ≈ +y), inside = n·p + w ≥ 0. */
function sidePlanes(E: number[], f: number[], fovDeg: number, aspect: number): number[][] {
  const z = norm(f);
  const x = norm([z[2]!, 0, -z[0]!].map((v) => v || 1e-9));
  const y = [x[1]! * z[2]! - x[2]! * z[1]!, x[2]! * z[0]! - x[0]! * z[2]!, x[0]! * z[1]! - x[1]! * z[0]!];
  const tv = Math.tan((fovDeg * Math.PI) / 360), th = tv * aspect;
  const mk = (a: number[], b: number[], t: number, s: number) => {
    // plane through E containing the edge direction: normal ∝ z·t + s·a  (pointing inward)
    const n = norm([z[0]! * t - s * a[0]!, z[1]! * t - s * a[1]!, z[2]! * t - s * a[2]!]);
    return [n[0]!, n[1]!, n[2]!, -(n[0]! * E[0]! + n[1]! * E[1]! + n[2]! * E[2]!)];
  };
  void y;
  return [mk(x, z, th, 1), mk(x, z, th, -1), mk(y, z, tv, 1), mk(y, z, tv, -1)];
}
const inside = (P: number[][], p: number[]) => P.every((q) => q[0]! * p[0]! + q[1]! * p[1]! + q[2]! * p[2]! + q[3]! >= 0);

test('coneMayShadow never drops a caster that can shadow a visible point', () => {
  const r = rng(116);
  let culled = 0;
  for (let it = 0; it < 4000; it++) {
    const E = [r() * 8 - 4, 1 + r() * 2, r() * 8 - 4];
    const P = sidePlanes(E, [r() - 0.5, (r() - 0.5) * 0.6, r() - 0.5], 20 + r() * 70, 1 + r());
    const L = [E[0]! + (r() - 0.5) * 1.5, E[1]! + (r() - 0.5) * 0.8, E[2]! + (r() - 0.5) * 1.5];
    const C = [L[0]! + (r() - 0.5) * 16, L[1]! + (r() - 0.5) * 6, L[2]! + (r() - 0.5) * 16];
    const rad = 0.05 + r() * 1.5, reach = 25;
    if (coneMayShadow(P, L, C, rad, reach, 0)) continue;
    culled++;
    for (let k = 0; k < 60; k++) {
      // a point of the sphere, then the ray from L through it, from that point to the reach
      const u = norm([r() - 0.5, r() - 0.5, r() - 0.5]);
      const O = [C[0]! + u[0]! * rad * r(), C[1]! + u[1]! * rad * r(), C[2]! + u[2]! * rad * r()];
      const dir = norm([O[0]! - L[0]!, O[1]! - L[1]!, O[2]! - L[2]!]);
      const tO = Math.hypot(O[0]! - L[0]!, O[1]! - L[1]!, O[2]! - L[2]!);
      for (let s = 0; s <= 24; s++) {
        const t = tO + ((reach - tO) * s) / 24;
        if (t > reach) break;
        const p = [L[0]! + dir[0]! * t, L[1]! + dir[1]! * t, L[2]! + dir[2]! * t];
        assert.ok(!inside(P, p), `culled caster shadows a visible point (it ${it})`);
      }
    }
  }
  assert.ok(culled > 200, `the test exercises the cull (${culled} culled)`);
});

test('coneMayShadow keeps casters around or behind the light and inside the view', () => {
  const P = sidePlanes([0, 1.6, 0], [0, 0, -1], 60, 1.6);
  assert.equal(coneMayShadow(P, [0.3, 1.4, 0], [0.3, 1.4, 0.2], 0.5, 25, 0.15), true); // light inside the sphere
  assert.equal(coneMayShadow(P, [0.3, 1.4, 0], [0, 1.5, -4], 0.3, 25, 0.15), true); // in view
  // behind the viewer, pointing away: its shadow goes further behind → culled
  assert.equal(coneMayShadow(P, [0.3, 1.4, 0], [0, 1.5, 4], 0.3, 25, 0.15), false);
  // beside the view but its shadow is cast INTO the view (light far to the side) → kept
  assert.equal(coneMayShadow(P, [-12, 1.6, -3], [-6, 1.6, -3], 0.3, 25, 0.15), true);
});
