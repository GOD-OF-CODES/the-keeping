// WorldCollision keeps the ground quad in its own octree (PERF-PLAN P1-5): the combined capsule / ray queries must
// answer like one octree holding everything did.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import * as THREE from 'three/webgpu';
import { Octree } from 'three/addons/math/Octree.js';
import { WorldCollision, Capsule, groundColliderMesh } from '../src/world/collision.ts';

function wall(): any {
  const g = new THREE.BoxGeometry(4, 3, 0.2);
  g.translate(0, 1.5, -2);
  return new THREE.Mesh(g);
}
function ramp(): any {
  const g = new THREE.PlaneGeometry(2, 4);
  g.rotateX(-Math.PI / 2 + 0.5);
  g.translate(3, 0.6, 0);
  return new THREE.Mesh(g);
}

const split = new WorldCollision([wall(), ramp(), groundColliderMesh([-50, -50, 50, 50], 0)]);
const single = new Octree();
{
  const root = new THREE.Group();
  root.add(wall(), ramp());
  const gm = groundColliderMesh([-50, -50, 50, 50], 0);
  gm.layers.set(0);
  root.add(gm);
  single.fromGraphNode(root);
}

const near = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) < eps;

test('capsule push-out matches a single octree (ground, wall, wall + ground, ramp, free)', () => {
  const r = 0.3;
  const cases: Array<[number, number, number]> = [
    [10, -0.1, 10], // sunk into the ground only
    [0, 1, -1.85], // into the wall only
    [0, -0.05, -1.85], // wall corner + ground
    [3, 0.3, 0], // on the ramp
    [10, 1, 10], // nothing
  ];
  for (const [x, y, z] of cases) {
    const c = new Capsule(new THREE.Vector3(x, y + r, z), new THREE.Vector3(x, y + 1.6 - r, z), r);
    const a = split.octree.capsuleIntersect(c.clone());
    const b = single.capsuleIntersect(c.clone());
    assert.equal(!!a, !!b, `hit at ${x},${y},${z}`);
    if (!a || !b) continue;
    // same total displacement (order of push-outs may differ by float noise)
    const da = a.normal.clone().multiplyScalar(a.depth);
    const db = b.normal.clone().multiplyScalar(b.depth);
    assert.ok(da.distanceTo(db) < 0.02, `push at ${x},${y},${z}: ${da.toArray()} vs ${db.toArray()}`);
  }
});

test('rays hit the nearer of ground and level geometry', () => {
  const rays: Array<[number[], number[]]> = [
    [[10, 2, 10], [0, -1, 0]], // ground
    [[0, 1, 2], [0, 0, -1]], // wall
    [[0, 5, -1.5], [0, -1, -0.2]], // wall top before the ground
    [[3, 4, 0], [0, -1, 0]], // ramp above the ground
    [[0, 1, 0], [0, 1, 0]], // sky
  ];
  for (const [o, d] of rays) {
    const ray = new THREE.Ray(new THREE.Vector3(...o), new THREE.Vector3(...d).normalize());
    const a = split.octree.rayIntersect(ray);
    const b = single.rayIntersect(ray);
    assert.equal(!!a, !!b);
    if (a && b) assert.ok(near(a.distance, b.distance), `${a.distance} vs ${b.distance}`);
  }
  assert.ok(near(split.floorBelow(10, 1, 10)!, 0));
});
