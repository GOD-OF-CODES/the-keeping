// FLASH lane (LOOK, #146c): the torch's beam hit (TORCH_WORLD.hitDist — the near-pool exposure term — and the bounce
// light's position) must land on a CLOSED DOOR LEAF, not on the static wall behind it. The collision octree holds only
// the house; door leaves are dynamic blockers seen by collision.sightDistance. Before the fix the front door's hot core
// went 210 → 195 from 1.5 to 1 m (no near adaptation at doors; scratch/flash-look/beam-med2 D1).
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
import * as THREE_ from 'three/webgpu';
import { FlashlightBounce, TORCH_WORLD } from '../src/render/flashlight-bounce.ts';
const THREE = THREE_ as any;

/** A torch at the origin aiming down −Z (world), with a bounce light. */
function makeTorch() {
  const light = new THREE.SpotLight(0xffffff, 2000);
  light.position.set(0, 0, 0); // (SpotLight defaults to (0, 1, 0))
  light.target.position.set(0, 0, -1);
  light.updateMatrixWorld(true);
  light.target.updateMatrixWorld(true);
  const bounce = new THREE.SpotLight(0xffffff, 0);
  return { light, bounce, intensity: 2000 };
}
/** The static wall z = −D (what the octree / rayDistance sees). */
const wall = (D: number) => (o: any, d: any, far: number) => {
  if (d.z >= -1e-6) return Infinity;
  const t = (-D - o.z) / d.z;
  return t >= 0 && t <= far ? t : Infinity;
};

test('a closed door leaf 1 m ahead of a wall 4 m away is the beam hit (near-pool exposure + bounce light)', () => {
  const fl = makeTorch();
  const rayDistance = wall(4);
  const collision = { rayDistance, sightDistance: (o: any, d: any, far: number) => Math.min(rayDistance(o, d, far), 1.0 <= far ? 1.0 : Infinity) };
  const b = new FlashlightBounce(fl as any, [], collision);
  for (let i = 0; i < 6; i++) b.update(1 / 60, true);
  assert.ok(Math.abs(TORCH_WORLD.hitDist - 1.0) < 1e-6, `hitDist ${TORCH_WORLD.hitDist} (the leaf at 1 m, not the wall at 4 m)`);
  // the bounce light sits 4 cm in front of the leaf, on the torch's side
  const z = fl.bounce.position.z;
  assert.ok(z > -1.0 && z < -0.9, `bounce light at z ${z}`);
  TORCH_WORLD.sight = null;
});

test('with no door in the way (or no blockers) the static hit is kept', () => {
  const fl = makeTorch();
  const rayDistance = wall(4);
  const open = new FlashlightBounce(fl as any, [], { rayDistance, sightDistance: (o: any, d: any, far: number) => rayDistance(o, d, far) });
  for (let i = 0; i < 6; i++) open.update(1 / 60, true);
  assert.ok(Math.abs(TORCH_WORLD.hitDist - 4) < 1e-6, `open door: hitDist ${TORCH_WORLD.hitDist}`);
  const fl2 = makeTorch();
  const legacy = new FlashlightBounce(fl2 as any, [], { rayDistance });
  for (let i = 0; i < 6; i++) legacy.update(1 / 60, true);
  assert.ok(Math.abs(TORCH_WORLD.hitDist - 4) < 1e-6, `no sightDistance: hitDist ${TORCH_WORLD.hitDist}`);
  TORCH_WORLD.sight = null;
});

// FLASH part 2: the door blockers (collision.sightDistance) are the leaf + its hardware — 0.20 m thick for a 0.04 m leaf
// (knobs on both faces), 0.46 m for the front door (+ the knocker): the aim's gaze point and the beam hit floated 8–20 cm
// in front of the wood. TORCH_WORLD.surface uses each leaf's slab (its largest mesh).
test('the visible surface of a shut door is its leaf slab, not the knob-padded blocker box', () => {
  const fl = makeTorch();
  const rayDistance = wall(4);
  // a leaf 0.04 m thick, 0.8 × 2.0 m, its front face 1.0 m ahead (z −1.0 … −1.04), a knob 8 cm proud of that face
  const door = new THREE.Group();
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.0, 0.04));
  leaf.position.set(0, 0, -1.02);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6));
  knob.position.set(0.3, 0, -0.95);
  door.add(leaf, knob);
  door.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(door); // what doors.ts registers (hinge frame = world here)
  const blockers = [{ object: door, box, enabled: () => true }];
  const sightDistance = (o: any, d: any, far: number) => {
    const p = new THREE.Ray(o, d).intersectBox(box, new THREE.Vector3());
    const t = p ? p.distanceTo(o) : Infinity;
    return Math.min(rayDistance(o, d, far), t <= far ? t : Infinity);
  };
  const b = new FlashlightBounce(fl as any, [], { rayDistance, sightDistance, blockers } as any);
  const o = new THREE.Vector3(0, 0, 0);
  const d = new THREE.Vector3(0, 0, -1);
  assert.ok(Math.abs(TORCH_WORLD.sight!(o, d, 12) - 0.92) < 1e-3, `the blocker box face (the knob): ${TORCH_WORLD.sight!(o, d, 12)}`);
  assert.ok(Math.abs(TORCH_WORLD.surface!(o, d, 12) - 1.0) < 1e-3, `the slab face: ${TORCH_WORLD.surface!(o, d, 12)}`);
  for (let i = 0; i < 6; i++) b.update(1 / 60, true);
  assert.ok(Math.abs(TORCH_WORLD.hitDist - 1.0) < 1e-3, `beam hit on the wood, not 8 cm in front of it: ${TORCH_WORLD.hitDist}`);
  TORCH_WORLD.sight = null;
  TORCH_WORLD.surface = null;
});
