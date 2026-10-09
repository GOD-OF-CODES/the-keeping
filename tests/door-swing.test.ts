// A door leaf swinging OPEN into a player standing in its arc must push the player out of the arc on the open side,
// never drag the capsule round the hinge to the leaf's far side (gameplay-d review: opening D_BACKSTAIR from the
// kitchen trapped the player west of the open leaf, B10).
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import * as THREE from 'three/webgpu';
import { Capsule } from 'three/addons/math/Capsule.js';
import { WorldCollision, groundColliderMesh } from '../src/world/collision.ts';

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): any {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return new THREE.Mesh(g);
}

function swing(moving: boolean, start: [number, number] = [0.4, 0.35], walls: any[] = [], frames = 30, close = false): { x: number; z: number } {
  const wc = new WorldCollision([...walls, groundColliderMesh([-50, -50, 50, 50], 0)]);
  // hinge at the origin; closed leaf along +x (0.8 m wide, 4 cm thick, 2 m tall); it opens toward +z.
  const hinge = new THREE.Group();
  hinge.updateMatrixWorld(true);
  const box = new THREE.Box3(new THREE.Vector3(0, 0, -0.02), new THREE.Vector3(0.8, 2, 0.02));
  const full = -Math.PI / 2;
  let angle = close ? full : 0;
  const target = close ? 0 : full;
  wc.addBlocker({ object: hinge, box, enabled: () => true, moving: moving ? () => angle !== target : undefined });
  // the player stands right in front of the closed leaf, in its swept arc
  const r = 0.27;
  const cap = new Capsule(new THREE.Vector3(start[0], r, start[1]), new THREE.Vector3(start[0], 1.78 - r, start[1]), r);
  const vel = new THREE.Vector3();
  for (let i = 1; i <= frames; i++) {
    angle = close ? full * (1 - i / frames) : (full * i) / frames;
    hinge.rotation.y = angle;
    hinge.updateMatrixWorld(true);
    wc.resolve(cap, vel);
  }
  for (let i = 0; i < 5; i++) wc.resolve(cap, vel); // the leaf has stopped; a few settling frames
  return { x: cap.start.x, z: cap.start.z };
}

test('an opening leaf pushes the player out of its arc on the open side', () => {
  const p = swing(true);
  // the open leaf now lies along +z at x ≈ 0; the player must be east of it (x > leaf + radius) and out of the arc
  assert.ok(p.x > 0.3, `player x ${p.x.toFixed(2)} is behind the open leaf`);
  assert.ok(Math.hypot(p.x, p.z) >= 0.8 + 0.27 - 0.01, `player still inside the swept arc (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
});

test('a swinging leaf never shoves the player through a wall (B10: out of the house through the jamb)', () => {
  // a 20 cm wall running along z just past the leaf's free end; the player stands in the doorway, near the free end
  const p = swing(true, [0.45, 0.1], [box(0.82, 0, -2, 1.02, 2.5, 2)]);
  assert.ok(p.x < 0.82, `player pushed through the wall to x ${p.x.toFixed(2)}`);
});

test('a fast chase-speed swing (0.5 s) next to the hinge still leaves the player on the open side', () => {
  const p = swing(true, [0.3, 0.1], [], 15);
  // the leaf may pass the player (no drag), but the player must stay clear of the open leaf on the doorway side
  assert.ok(p.x > 0.02 + 0.27 - 0.01, `player at (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) is behind / inside the open leaf`);
});

test('a leaf swinging SHUT into a player on its swing side pushes them out on that side (not through to the stair side)', () => {
  // open leaf along +z (x ≈ 0); the player stands on the swing side (z > 0), in the arc; the leaf closes back to +x
  const p = swing(true, [0.35, 0.45], [], 30, true);
  assert.ok(p.z > 0.02 + 0.27 - 0.01, `player at (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) was pushed through the closing leaf`);
});
