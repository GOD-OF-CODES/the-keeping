// The player capsule (r 0.27, 1.78 m) must climb real 0.25 m risers (ST_BACK kites + treads are boxes, not a ramp)
// at a steady 30 fps, under a door lintel, and come back down. Regression for the B10 back-stair stall: the step-up
// used to be undone every substep (gameplay-d, CONTRACT-CHANGES).
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import * as THREE from 'three/webgpu';
import { WorldCollision, groundColliderMesh } from '../src/world/collision.ts';
import { PlayerController } from '../src/player/controller.ts';

/** World-space box mesh (min/max in WORLD x, y-up, z). */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): any {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return new THREE.Mesh(g);
}

// a 0.8 m wide flight going -z (north in plan): 6 treads, 0.25 m rise, 0.28 m going, first riser at z = -2;
// a wall at z -1.8…-2 with a 0.82 m doorway and a lintel 2.4 m over the floor, right at the first riser.
const parts: any[] = [];
for (let k = 1; k <= 6; k++) parts.push(box(-0.4, -0.05, -2 - 0.28 * (k - 1) - 10, 0.4, 0.25 * k, -2 - 0.28 * (k - 1)));
parts.push(box(-3, 0, -2, -0.41, 3.5, -1.8), box(0.41, 0, -2, 3, 3.5, -1.8), box(-0.41, 2.4, -2, 0.41, 3.5, -1.8));
parts.push(box(-0.6, 0, -6, -0.4, 3.5, 0), box(0.4, 0, -6, 0.6, 3.5, 0)); // side walls of the flight
const world: any = {
  collision: new WorldCollision([...parts, groundColliderMesh([-50, -50, 50, 50], 0)]),
  index: new Proxy({}, { get: (_t, p) => (p === 'inBounds' ? () => true : () => null) }),
  room: () => null,
};
const keys = new Set<string>();
const input: any = { isDown: (k: string) => keys.has(k), consumeMouse: () => ({ dx: 0, dy: 0 }), blocked: false };
const ctx: any = { settings: { mouseSensitivity: 1, invertY: false }, events: { emit() {} } };

function walk(fromZ: number, toZ: number, frames: number, dt = 1 / 30): any {
  const pc: any = new PlayerController(new THREE.PerspectiveCamera(), input, ctx, world);
  pc.teleport([0, 1.65 + (fromZ < -2 ? 0.25 * Math.min(6, Math.ceil((-2 - fromZ) / 0.28)) : 0), fromZ], toZ < fromZ ? 0 : Math.PI, 0);
  for (let i = 0; i < 3; i++) pc.update(dt, 0);
  keys.add('KeyW');
  for (let i = 0; i < frames && Math.abs(pc.feet.z - toZ) > 0.1; i++) pc.update(dt, i * dt);
  keys.delete('KeyW');
  return pc;
}

for (const fps of [30, 60, 144]) {
  test(`climbs six 0.25 m risers through a doorway at ${fps} fps`, () => {
    const pc = walk(-1.0, -3.6, fps * 8, 1 / fps);
    assert.ok(pc.feet.z < -3.4, `stalled at z ${pc.feet.z.toFixed(2)}, feet ${pc.feet.y.toFixed(2)}`);
    assert.ok(pc.feet.y > 1.2, `feet only at ${pc.feet.y.toFixed(2)}`);
  });
}

test('comes back down the flight and out through the doorway', () => {
  const pc = walk(-3.4, -0.8, 300);
  assert.ok(pc.feet.z > -1.0, `stalled at z ${pc.feet.z.toFixed(2)}`);
  assert.ok(pc.feet.y < 0.05, `feet ${pc.feet.y.toFixed(2)}`);
});

test('a 0.6 m ledge is still a wall', () => {
  const w2: any = { ...world, collision: new WorldCollision([box(-2, 0, -12, 2, 0.6, -2), groundColliderMesh([-50, -50, 50, 50], 0)]) };
  const pc: any = new PlayerController(new THREE.PerspectiveCamera(), input, ctx, w2);
  pc.teleport([0, 1.65, -1], 0, 0);
  keys.add('KeyW');
  for (let i = 0; i < 120; i++) pc.update(1 / 30, 0);
  keys.delete('KeyW');
  assert.ok(pc.feet.y < 0.05 && pc.feet.z > -1.8, `climbed to ${pc.feet.y.toFixed(2)} at z ${pc.feet.z.toFixed(2)}`);
});
