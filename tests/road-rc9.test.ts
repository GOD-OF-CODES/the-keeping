// County Road 9: the shared corridor definition (src/shared/road-rc9.json) drives the opening's vehicle tracks
// (src/cutscenes/road.ts); it must match the layout generator's centreline (scripts/layout/rc9.mjs) that placed the
// P_RC9_* props and that Blender built the road from (docs/C1-OPENING.md §2).
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
import { roadPoint, roadFrame, ROAD } from '../src/cutscenes/road.ts';
const { rcPoint } = (await import('../scripts/layout/' + 'rc9.mjs')) as any;
import { c1VehicleTrack, C1_DURATION } from '../src/cutscenes/c1-empty.ts';

test('road-rc9: runtime centreline matches the layout generator within 1 cm', () => {
  for (let s = -20; s <= ROAD.end_s; s += 3.7) {
    for (const n of [-1.75, 0, 1.75, 12]) {
      const a = roadPoint(s, n);
      const b = rcPoint(s, n);
      assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01, `s ${s} n ${n}`);
    }
  }
});

test('road-rc9: segments are continuous (position and heading)', () => {
  for (const g of ROAD.segments) {
    const a = roadFrame(g.s0 - 1e-6);
    const b = roadFrame(g.s0 + 1e-6);
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-3 && Math.abs(a[2] - b[2]) < 1e-3, `seam at ${g.id}`);
  }
});

test('C1 vehicle track: westbound at ≈ 19 m/s on the road, ends at the gate inside the cutscene', () => {
  const tr = c1VehicleTrack();
  for (const v of tr.slice(0, 7)) {
    let len = 0;
    for (let i = 1; i < v.path.length; i++) len += Math.hypot(v.path[i][0] - v.path[i - 1][0], v.path[i][1] - v.path[i - 1][1]);
    const speed = len / v.d;
    assert.ok(speed > 17 && speed < 23, `t ${v.t}: ${speed.toFixed(1)} m/s`);
  }
  const last = tr[tr.length - 1];
  assert.ok(last.t + last.d < C1_DURATION);
  const end = last.path[last.path.length - 1];
  assert.deepEqual([end[0], end[1]], [2.8, -30.2]);
});
