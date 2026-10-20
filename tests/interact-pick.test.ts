// LOCKET #158 (hotfix: "i cut the dress but no option to pick the locket"): the interaction pick
// (src/world/interactables.ts pick(): box pre-filter → exact hit on the nearest candidate → static-collision LOS).
//   - an item whose label() is null (the cut dress) neither wins the pick nor hides a usable item behind / inside it;
//   - `pad` (aim tolerance for small pickups) makes the item's grown world box part of its surface;
//   - a padded item is tracked live (it drops / moves after binding: no stale cached centre);
//   - the static collision still blocks (line of sight, 0.12 m slack).
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

// interactables.ts builds its prompt / dot DOM in the constructor: a minimal stand-in document for node
const el = (): any => ({ style: {}, textContent: '', append() {}, appendChild() {}, parentElement: { style: {} } });
(globalThis as any).document ??= { createElement: () => el(), body: el() };

import * as THREE from 'three/webgpu';
const { Interactables } = await import('../src/world/interactables.ts');

const input: any = { isDown: () => false, wasPressed: () => false };

function rig(wallAt = Infinity) {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 100); // at the origin, looking down −Z
  camera.updateMatrixWorld(true);
  const level: any = { collision: { rayDistance: (_o: any, _d: any, far: number) => (wallAt <= far ? wallAt : Infinity) } };
  const ix = new Interactables(camera, input, level);
  return { camera, ix };
}

const mesh = (geo: any, x: number, y: number, z: number) => {
  const m = new THREE.Mesh(geo);
  m.position.set(x, y, z);
  m.updateMatrixWorld(true);
  return m;
};
const pick = (ix: any) => {
  ix.exactAge = 0;
  ix.exactBoxBest = null;
  return ix.pick();
};

test('a null-label item (the cut dress) does not win the pick or hide the locket inside it', () => {
  const { ix } = rig();
  let cut = false;
  // the skirt: a closed shell 1.2 m across around the locket, 1.7 m ahead
  const dress = mesh(new THREE.SphereGeometry(0.6, 32, 16), 0, 0, -1.7);
  const locket = mesh(new THREE.BoxGeometry(0.03, 0.03, 0.008), 0, 0, -1.7);
  ix.add({ id: 'P_DRESS', object: dress, label: () => (cut ? null : 'Cut the hem'), use() {} });
  ix.add({ id: 'P_LOCKET', object: locket, label: () => 'Take the locket', use() {} });
  assert.equal(pick(ix)?.id, 'P_DRESS', 'before the cut the dress is the nearest usable surface');
  cut = true;
  assert.equal(pick(ix)?.id, 'P_LOCKET', 'after the cut the dress no longer occludes');
});

test('pad: a small pickup is focused by an aim a few cm off its surface; no pad → missed', () => {
  for (const pad of [0, 0.06]) {
    const { ix } = rig();
    // a 30 mm locket 1.5 m ahead, 4 cm left of the aim line
    const locket = mesh(new THREE.BoxGeometry(0.03, 0.03, 0.008), -0.04, 0, -1.5);
    ix.add({ id: 'P_LOCKET', object: locket, label: () => 'Take the locket', use() {}, pad: pad || undefined });
    assert.equal(pick(ix)?.id ?? null, pad ? 'P_LOCKET' : null, `pad ${pad}`);
  }
});

test('a padded item is tracked live (moved after it was bound: no stale cached centre)', () => {
  const { ix } = rig();
  const locket = mesh(new THREE.BoxGeometry(0.03, 0.03, 0.008), 0, 0, 40); // bound far behind the camera
  ix.add({ id: 'P_LOCKET', object: locket, label: () => 'Take the locket', use() {}, pad: 0.06, reach: 2.2 });
  assert.equal(pick(ix), null);
  locket.position.set(0, 0, -2.0); // the bundle lands 2 m ahead (floor reach 2.2 m)
  locket.updateMatrixWorld(true);
  assert.equal(pick(ix)?.id, 'P_LOCKET');
});

test('the static collision still blocks the line of sight (0.12 m slack)', () => {
  const locket = () => mesh(new THREE.BoxGeometry(0.03, 0.03, 0.008), 0, 0, -1.5);
  const a = rig(1.0); // a wall 1 m ahead, the locket at 1.5 m
  a.ix.add({ id: 'P_LOCKET', object: locket(), label: () => 'Take the locket', use() {}, pad: 0.06 });
  assert.equal(pick(a.ix), null);
  const b = rig(1.45); // a surface at the item (within the slack) does not block
  b.ix.add({ id: 'P_LOCKET', object: locket(), label: () => 'Take the locket', use() {}, pad: 0.06 });
  assert.equal(pick(b.ix)?.id, 'P_LOCKET');
});

test('a nested item (the knocker on the front door leaf) wins over the door bound first', () => {
  const { ix } = rig();
  // door group 1.4 m ahead: a 0.9 × 2.0 m leaf; the knocker is a CHILD of the leaf (doors.glb ships it that way)
  const door = new THREE.Group();
  door.position.set(0, 0, -1.4);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.0, 0.045));
  door.add(leaf);
  const knocker = new THREE.Group();
  knocker.position.set(0, 0, 0.03); // its plate on the leaf's outer face
  knocker.add(new THREE.Mesh(new THREE.BoxGeometry(0.084, 0.124, 0.03)));
  leaf.add(knocker);
  door.updateMatrixWorld(true);
  ix.add({ id: 'D_FRONT', object: door, label: () => 'Try the door', use() {} });
  ix.add({ id: 'P_KNOCKER', object: knocker, label: () => 'Knock', use() {} });
  assert.equal(pick(ix)?.id, 'P_KNOCKER', 'aimed at the knocker');
  door.position.x = 0.3; // aim at the bare leaf 30 cm beside the knocker
  door.updateMatrixWorld(true);
  assert.equal(pick(ix)?.id, 'D_FRONT', 'aimed at the leaf');
});
