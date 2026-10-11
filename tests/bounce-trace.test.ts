// PERF #132 (fix round 4): the torch bounce's allocation-free mesh trace must find the same nearest hit (distance and
// material slot) as three's Raycaster (Mesh.raycast side rules, groups, transformed meshes) on random rays.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
import * as THREE_ from 'three/webgpu';
import { traceMesh } from '../src/render/flashlight-bounce.ts';
const THREE = THREE_ as any;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

test('traceMesh matches Raycaster (distance + material slot) on random meshes and rays', () => {
  const r = rng(7);
  const ray = new THREE.Raycaster();
  const out = [0, 0];
  let hits = 0;
  for (let m = 0; m < 40; m++) {
    const geos = [new THREE.BoxGeometry(1 + r(), 1 + r(), 1 + r(), 2, 3, 2), new THREE.SphereGeometry(0.8, 9, 7), new THREE.PlaneGeometry(2, 2, 3, 3)];
    let g = geos[m % 3];
    if (m % 4 === 3) g = g.toNonIndexed();
    const sides = [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide];
    const mat = g.groups.length ? g.groups.map((_: any, i: number) => new THREE.MeshBasicMaterial({ side: sides[(i + m) % 3] })) : new THREE.MeshBasicMaterial({ side: sides[m % 3] });
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1);
    mesh.rotation.set(r() * 6, r() * 6, r() * 6);
    mesh.scale.set(0.5 + r(), 0.5 + r(), 0.5 + r());
    mesh.updateMatrixWorld(true);
    for (let k = 0; k < 200; k++) {
      const o = new THREE.Vector3(r() * 8 - 4, r() * 8 - 4, r() * 8 - 4);
      const d = mesh.position.clone().add(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(1.6)).sub(o).normalize(); // aimed near the mesh
      ray.set(o, d);
      ray.near = r() < 0.5 ? 0 : r() * 2;
      ray.far = 2 + r() * 6;
      const h = ray.intersectObject(mesh, false)[0];
      assert.ok(traceMesh(mesh, o, d, ray.near, ray.far, out));
      if (!h) {
        assert.equal(out[0], -1, `mesh ${m} ray ${k}: phantom hit at ${out[0]}`);
        continue;
      }
      hits++;
      assert.ok(Math.abs(out[0] - h.distance) < 1e-4, `mesh ${m} ray ${k}: ${out[0]} vs ${h.distance}`);
      if (Array.isArray(mat)) assert.equal(out[1], h.face.materialIndex);
    }
  }
  assert.ok(hits > 500, `only ${hits} hits tested`);
});
