#!/usr/bin/env node
// S1 runtime-side gate: parse the smoke GLBs with three r186's own GLTFLoader + bundled MeshoptDecoder in Node.
//   node blender/tests/check_glb.mjs .cache/smoke/s1
// No browser globals are needed: the GLBs carry no images (export_image_format='NONE'), so the loader never
// touches ImageBitmap/URL; navigator exists in Node >= 21. Exit code 1 on any failed expectation.
import fs from 'node:fs';
import path from 'node:path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const dir = process.argv[2] ?? '.cache/smoke/s1';
let failures = 0;
const expect = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

function glbJson(buf) {
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error('bad magic');
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.toString('utf8', 20, 20 + len));
}

async function parse(file) {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); // Node Buffers share a pool
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  await MeshoptDecoder.ready;
  return { json: glbJson(buf), gltf: await loader.parseAsync(ab, '') };
}

const summary = {};
for (const name of ['s1_plain.glb', 's1_meshopt.glb', 's1_single_arm.glb']) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) {
    expect(false, `${name} exists`);
    continue;
  }
  console.log(name);
  const t0 = performance.now();
  const { json, gltf } = await parse(file);
  const ms = performance.now() - t0;
  const meshes = [];
  gltf.scene.traverse((o) => o.isMesh && meshes.push(o));
  const box = gltf.scene.getObjectByName('LM_Box');
  const boxMesh = box?.isMesh ? box : meshes.find((m) => m.name.startsWith('LM_Box'));
  const skinned = meshes.find((m) => m.isSkinnedMesh);
  const anims = gltf.animations.map((a) => a.name).sort();
  const ext = json.extensionsUsed ?? [];
  expect(!!boxMesh && !!boxMesh.geometry.attributes.uv && !!boxMesh.geometry.attributes.uv1,
    'LM_Box geometry has uv (TEXCOORD_0) and uv1 (TEXCOORD_1)');
  if (boxMesh) {
    const uv1 = boxMesh.geometry.attributes.uv1;
    let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (let i = 0; i < uv1.count; i++) {
      const u = uv1.getX(i), v = uv1.getY(i);
      lo = [Math.min(lo[0], u), Math.min(lo[1], v)];
      hi = [Math.max(hi[0], u), Math.max(hi[1], v)];
    }
    expect(lo[0] >= 0 && lo[1] >= 0 && hi[0] <= 1 && hi[1] <= 1, `uv1 within [0,1] (min ${lo.map((x) => x.toFixed(3))} max ${hi.map((x) => x.toFixed(3))})`);
  }
  expect(box?.userData?.atlas === 'smoke_atlas' && box?.userData?.room === 'G1', `node extras -> Object3D.userData ${JSON.stringify(box?.userData)}`);
  const matUD = boxMesh?.material?.userData ?? {};
  expect(matUD.material_id === 'plaster_test', `material extras -> material.userData ${JSON.stringify(matUD)}`);
  expect(!!skinned, 'skinned mesh present');
  expect(skinned?.geometry.morphAttributes.position?.length === 1, `morph targets: ${skinned?.geometry.morphAttributes.position?.length}`);
  expect(JSON.stringify(Object.keys(skinned?.morphTargetDictionary ?? {})) === '["Open"]', `morphTargetDictionary ${JSON.stringify(skinned?.morphTargetDictionary)}`);
  expect(skinned?.skeleton?.bones.map((b) => b.name).join(',') === 'Root,Tip', `skeleton bones ${skinned?.skeleton?.bones.map((b) => b.name)}`);
  if (name === 's1_single_arm.glb') {
    expect(anims.includes('Stray'), `export_anim_single_armature=True sweeps the stray action in: ${anims}`);
  } else {
    expect(JSON.stringify(anims) === '["Idle","Wave"]', `exactly 2 animations: ${anims}`);
  }
  const wave = gltf.animations.find((a) => a.name === 'Wave');
  if (wave) {
    const t0 = Math.min(...wave.tracks.map((t) => t.times[0]));
    expect(Math.abs(t0) < 1e-6 && Math.abs(wave.duration - 1.0) < 1e-3,
      `Wave starts at t=${t0.toFixed(4)}, duration ${wave.duration.toFixed(4)} s (frames 1..31 @ 30 fps -> 0..1.000)`);
  }
  if (name !== 's1_plain.glb') {
    expect(ext.includes('EXT_meshopt_compression'), `extensionsUsed ${ext}`);
    const compressed = (json.bufferViews ?? []).filter((v) => v.extensions?.EXT_meshopt_compression).length;
    expect(compressed > 0, `${compressed}/${json.bufferViews.length} bufferViews meshopt-compressed`);
  } else expect(!ext.includes('EXT_meshopt_compression'), 'plain export has no meshopt');
  summary[name] = { bytes: fs.statSync(file).size, parseMs: Math.round(ms), animations: anims, extensionsUsed: ext };
}
console.log(JSON.stringify(summary));
fs.writeFileSync(path.join(dir, 'check_glb.json'), JSON.stringify({ ok: failures === 0, summary }, null, 2) + '\n');
if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log('check_glb: all ok');
