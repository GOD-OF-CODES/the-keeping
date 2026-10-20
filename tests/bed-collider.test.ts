// FINAL #153 (PERF2 #150b): P_BED's `box` collider is split at the empty band between its head and foot boards
// (src/world/collision.ts gapBoxes) — the plain per-mesh box would be a 1.30 m block over the whole mattress, which
// the torch's beam-centre ray, the AI sight lines and interaction LOS also hit. Synthetic bed with the shipped
// iron_bed proportions (props_m1.glb, P_BED-iron_bed: frame ±0.73 × 1.30 × ±1.03, mattress 0.358–0.638).
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { propColliderMeshes } from '../src/world/collision.ts';

function boxGeo(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): any {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

function bed(): any {
  const root = new THREE.Group();
  root.name = 'P_BED';
  // one cast-iron mesh: headboard + footboard, nothing between them (the shipped frame has no side rails)
  const frame = new THREE.Mesh(mergeGeometries([boxGeo(-0.73, 0, -1.03, 0.735, 1.3, -0.97), boxGeo(-0.73, 0, 0.97, 0.735, 1.0, 1.03)]));
  frame.name = 'frame';
  const mattress = new THREE.Mesh(boxGeo(-0.672, 0.358, -0.971, 0.671, 0.638, 0.971));
  mattress.name = 'mattress';
  root.add(frame, mattress);
  root.position.set(7.6, 4.1, -3.5);
  return root;
}

const bounds = (m: any) => {
  m.geometry.computeBoundingBox();
  const b = m.geometry.boundingBox;
  return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v: number) => Math.round(v * 1000) / 1000);
};

test('iron bed box collider: head board, foot board and mattress, no block over the mattress', () => {
  const out = propColliderMeshes(bed(), 'box', false, true);
  assert.equal(out.length, 3);
  const b = out.map(bounds).sort((p: number[], q: number[]) => p[2] - q[2]);
  // headboard: full height, 6 cm deep, at the head end
  assert.deepEqual(b[0], [6.87, 4.1, -4.53, 8.335, 5.4, -4.47]);
  // mattress: its own slab, nothing above 0.638 m
  assert.deepEqual(b[1], [6.928, 4.458, -4.471, 8.271, 4.738, -2.529]);
  // footboard: 1.00 m
  assert.deepEqual(b[2], [6.87, 4.1, -2.53, 8.335, 5.1, -2.47]);
});

test('without the split the same frame is one 1.30 m block (the reason for the split)', () => {
  const out = propColliderMeshes(bed(), 'box', false, false);
  assert.equal(out.length, 2);
  const frame = out.map(bounds).find((v: number[]) => v[4] > 5.3);
  assert.deepEqual(frame, [6.87, 4.1, -4.53, 8.335, 5.4, -2.47]);
});
