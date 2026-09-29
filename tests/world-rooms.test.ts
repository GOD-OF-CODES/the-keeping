// World/player pure layout queries (src/world/rooms.ts): room lookup, culling sets, surfaces, creakers, stairs,
// triggers, heading → camera yaw, exterior ground partition.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import layoutJson from '../src/shared/level-layout.json' with { type: 'json' };
import type { LevelLayout } from '../src/shared/layout-types.ts';
import { EYE_HEIGHT, RoomIndex, headingToCameraYaw, partitionGround, rectArea, rectContains, stairStepIndex } from '../src/world/rooms.ts';
import { planToWorld } from '../src/shared/coords.ts';

const layout = layoutJson as unknown as LevelLayout;
const idx = new RoomIndex(layout);
const spawn = (id: string) => layout.spawns.find((s) => s.id === id)!;

test('every spawn resolves to its declared room (feet = eye − 1.65)', () => {
  for (const s of layout.spawns) {
    const r = idx.roomAt(s.pos[0], s.pos[1], s.pos[2] - EYE_HEIGHT);
    // debug_car sits in the seat (eye 1.1): the set's floor is 0, feet below grade are fine
    assert.equal(r, s.room, `${s.id} → ${r}`);
  }
});

test('G1 vs U1 share a rect: feet height picks the floor; CLOSET wins over G1; doorways keep the last room', () => {
  assert.equal(idx.roomAt(2, 4, 0.6), 'G1');
  assert.equal(idx.roomAt(2, 4, 4.1), 'U1');
  assert.equal(idx.roomAt(0.5, 6, 0.6), 'CLOSET');
  assert.equal(idx.roomAt(3.68, 1.5, 0.6), null, 'inside the G1|G2 wall → null (keep last)');
  assert.equal(idx.roomAt(1.8, -1.5, 0.58), 'EXT2', 'porch');
  assert.equal(idx.roomAt(1.8, -30, 0), 'EXT1', 'road');
  // climbing ST_MAIN over the closet: the stair's rooms, not CLOSET
  assert.equal(idx.roomAt(0.55, 5.0, 1.9), 'G1');
  assert.equal(idx.roomAt(0.55, 7.5, 3.9), 'U1');
  // U4's winder shaft is a ground room whose flight reaches the upper floor
  assert.equal(idx.roomAt(7, 11.2, 2.5), 'U4');
});

test('culling sets include the declared visibleRooms and doorway neighbours', () => {
  const v = idx.visibleFrom('G1', 2, 1, 0.6);
  for (const id of ['G1', 'G2', 'U1', 'EXT2', 'G3P', 'CLOSET']) assert.ok(v.has(id), id);
  assert.ok(!v.has('U3'));
  // standing at the parlor threshold, the parlor's own set joins (U2 through the grate)
  const t = idx.visibleFrom('G1', 3.5, 1.5, 0.6);
  assert.ok(t.has('U2'));
  // the exterior sees the hall through the front door but never the kitchen
  const e = idx.visibleFrom('EXT2', 1.8, -20, 0);
  assert.ok(e.has('G1') && !e.has('G3'));
});

test('surfaces: smallest zone wins; runner in the hall, stair wood on the flight, gravel on the drive', () => {
  assert.equal(idx.surfaceAt('G1', 2.3, 2), 'runner');
  assert.equal(idx.surfaceAt('G1', 3.2, 6), 'bare_wood');
  assert.equal(idx.surfaceAt('G1', 0.5, 5), 'stair_wood');
  assert.equal(idx.surfaceAt('EXT2', 1.8, -20), 'gravel');
  assert.equal(idx.surfaceAt('EXT2', 1.8, -1.5), 'porch_wood');
  assert.equal(idx.surfaceAt('EXT1', 0, -33), 'asphalt');
});

test('creakers and creaky stair treads', () => {
  const c = layout.creakers[0];
  assert.equal(idx.creakerAt(c.room, c.pos[0], c.pos[1])?.id, c.id);
  assert.equal(idx.creakerAt(c.room, c.pos[0] + 1, c.pos[1]), null);
  const st = layout.stairs.find((s) => s.id === 'ST_MAIN')!;
  // tread 5 centre
  const y5 = st.start[1] + 4.5 * st.treadDepth;
  assert.equal(stairStepIndex(st, st.start[0], y5), 5);
  const hit = idx.stairStepAt(st.start[0], y5, 0.6 + 5 * st.riserHeight);
  assert.equal(hit?.step, 5);
  assert.ok(st.creakySteps.includes(hit!.step));
  assert.equal(stairStepIndex(st, st.start[0] + 2, y5), 0, 'beside the flight');
});

test('triggers fire by plan rect and feet height', () => {
  const t = idx.triggersAt(1.8, -27, 0).map((x) => x.id);
  assert.ok(t.includes('T_B02_GATE'));
  assert.equal(idx.triggersAt(1.8, -27, 5).length, 0);
});

test('heading → camera yaw: CP1 looks north toward the house, CP8 looks south to the stair', () => {
  const fwd = (heading: number) => {
    const yaw = headingToCameraYaw(heading);
    // YXZ camera: forward = (−sin yaw, 0, −cos yaw) in world; plan = (x, −z)
    const wx = -Math.sin(yaw);
    const wz = -Math.cos(yaw);
    return [wx, -wz];
  };
  const [cx, cy] = fwd(spawn('CP1').yaw);
  assert.ok(Math.abs(cx) < 1e-3 && cy > 0.999, `CP1 forward ${cx},${cy}`);
  const [ex, ey] = fwd(0);
  assert.ok(ex > 0.999 && Math.abs(ey) < 1e-9, 'heading 0 = east');
  const [sx, sy] = fwd(spawn('CP8').yaw);
  assert.ok(sy < -0.999 && Math.abs(sx) < 1e-3, 'CP8 faces south');
  // planToWorld sanity
  assert.deepEqual(planToWorld([1, 2, 3]), [1, 3, -2]);
});

test('ground partition: no overlaps, full exterior coverage minus the house, smallest zone owns each cell', () => {
  const cells = partitionGround(layout, idx.footprint);
  assert.ok(cells.length > 5 && cells.length < 400, `${cells.length} cells`);
  for (let i = 0; i < cells.length; i++)
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i].rect;
      const b = cells[j].rect;
      const ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
      const oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
      assert.ok(!(ox > 1e-6 && oy > 1e-6), `overlap ${a} ${b}`);
    }
  const ext = layout.rooms.filter((r) => r.kind === 'exterior');
  const total = ext.reduce((s, r) => s + rectArea(r.rect), 0);
  const fp = idx.footprint;
  const covered = cells.reduce((s, c) => s + rectArea(c.rect), 0);
  assert.ok(Math.abs(covered - (total - rectArea(fp))) < 1e-3, `covered ${covered} vs ${total - rectArea(fp)}`);
  const at = (x: number, y: number) => cells.find((c) => rectContains(c.rect, x, y))!;
  assert.equal(at(1.8, -20).surface, 'gravel');
  assert.equal(at(0, -33).mat, 'asphalt_wet');
  assert.equal(at(1.8, -1.5).surface, 'grass', 'under the porch: ground, not boards');
});
