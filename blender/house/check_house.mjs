#!/usr/bin/env node
// House GLB gate (post-check of the 'house' job): parse every house GLB with three r186's GLTFLoader +
// MeshoptDecoder in plain Node and check the contract documented in docs/HOUSE.md:
//   * house_<atlas>.glb: every mesh has uv + uv1 in [0,1], userData.atlas / room / lightmap, material userData.material_id
//   * details_<atlas>.glb: uv, userData.detail = true
//   * doors.glb: every door node has doorId, swingSign, initialAngleDeg; pivot at the hinge (bbox x-extent from 0)
//   * collision.glb: userData.collider on every mesh
// Exit code 1 on any failure.
import fs from 'node:fs';
import path from 'node:path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Box3 } from 'three';

const dir = process.argv[2] ?? 'public/assets/max';
let failures = 0;
const fail = (m) => {
  failures++;
  console.log('  FAIL', m);
};

async function parse(file) {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  await MeshoptDecoder.ready;
  return loader.parseAsync(ab, '');
}

const files = fs.readdirSync(dir).filter((f) => /^(house_|details_|doors|collision).*\.glb$/.test(f)).sort();
if (!files.length) fail(`no house GLBs in ${dir}`);
for (const f of files) {
  const gltf = await parse(path.join(dir, f));
  const meshes = [];
  gltf.scene.traverse((o) => o.isMesh && meshes.push(o));
  let tris = 0;
  for (const m of meshes) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  console.log(`${f}: ${meshes.length} meshes, ${Math.round(tris)} triangles, ${fs.statSync(path.join(dir, f)).size} bytes`);
  // userData lives on the node (Object3D) that owns the mesh; primitives of multi-material meshes are children
  const ud = (m) => ({ ...(m.parent?.userData ?? {}), ...m.userData });
  if (f.startsWith('house_')) {
    for (const m of meshes) {
      const g = m.geometry;
      if (!g.attributes.uv || !g.attributes.uv1) fail(`${f}:${m.name} lacks uv/uv1`);
      else {
        const a = g.attributes.uv1.array;
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < a.length; i++) {
          lo = Math.min(lo, a[i]);
          hi = Math.max(hi, a[i]);
        }
        if (lo < -1e-3 || hi > 1.001) fail(`${f}:${m.name} uv1 out of [0,1]: ${lo}..${hi}`);
      }
      const u = ud(m);
      if (!u.atlas || !u.room || !u.lightmap) fail(`${f}:${m.name} missing atlas/room/lightmap extras`);
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mt of mats) if (!mt?.userData?.material_id) fail(`${f}:${m.name} material without material_id`);
    }
  } else if (f.startsWith('details_')) {
    for (const m of meshes) if (!ud(m).detail) fail(`${f}:${m.name} missing detail extra`);
  } else if (f.startsWith('doors')) {
    const nodes = [];
    gltf.scene.traverse((o) => o.userData?.doorId && o.userData.kind === 'door' && nodes.push(o));
    if (nodes.length < 9) fail(`doors.glb: ${nodes.length} door leaves (< 9)`);
    for (const n of nodes) {
      const u = n.userData;
      if (![1, -1].includes(u.swingSign)) fail(`${n.name} swingSign ${u.swingSign}`);
      if (typeof u.initialAngleDeg !== 'number') fail(`${n.name} initialAngleDeg`);
      const b = new Box3().setFromObject(n);
      const local = b.clone().translate(n.position.clone().negate());
      // the pivot is on the hinge edge: one horizontal extent of the leaf must start at ~0
      const touches = [local.min.x, local.max.x, local.min.z, local.max.z].some((v) => Math.abs(v) < 0.03);
      if (!touches) fail(`${n.name}: pivot not on the hinge edge (local bbox ${JSON.stringify(local)})`);
    }
    console.log(`  doors: ${nodes.map((n) => `${n.userData.doorId}(${n.userData.swingSign > 0 ? '+' : '-'}${n.userData.initialAngleDeg})`).join(' ')}`);
  } else if (f.startsWith('collision')) {
    for (const m of meshes) if (!ud(m).collider) fail(`${f}:${m.name} missing collider extra`);
  }
}
console.log(failures ? `check_house: ${failures} failure(s)` : 'check_house: ok');
process.exit(failures ? 1 : 0);
