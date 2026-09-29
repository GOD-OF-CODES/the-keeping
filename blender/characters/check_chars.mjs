#!/usr/bin/env node
// Runtime-side gate for the character GLBs: parse public/assets/<tier>/{ada,harlan,arms}.glb with three r186's own
// GLTFLoader + MeshoptDecoder in Node and assert the contract documented in docs/CHARACTERS.md.
//   node blender/characters/check_chars.mjs [ada,harlan,arms]
// Exit code 1 on any failed expectation. Writes .cache/anims/check_chars.json.
import fs from 'node:fs';
import path from 'node:path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const chars = (process.argv[2] ?? 'ada,harlan,arms').split(',');
const TIERS = ['low', 'medium', 'max'];
let failures = 0;
const expect = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

const CORE = ['root', 'hips', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'neck_02', 'head', 'jaw',
  ...['l', 'r'].flatMap((s) => [`clavicle_${s}`, `upperarm_${s}`, `forearm_${s}`, `hand_${s}`, `thigh_${s}`, `calf_${s}`,
    `foot_${s}`, `toe_${s}`, ...['thumb', 'index', 'middle', 'ring', 'pinky'].flatMap((f) => [1, 2, 3].map((i) => `${f}_0${i}_${s}`))])];
const ARMS = ['root', ...['l', 'r'].flatMap((s) => [`upperarm_${s}`, `forearm_${s}`, `hand_${s}`,
  ...['thumb', 'index', 'middle', 'ring', 'pinky'].flatMap((f) => [1, 2, 3].map((i) => `${f}_0${i}_${s}`))]), 'flashlight', 'flashlight_beam'];
const SPEC = {
  ada: { bones: [...CORE, 'jaw_hold'], prefixes: ['hair_', 'gown_'], morphs: { ada_body: ['jaw_open', 'gurgle'], ada_hair: ['jaw_open', 'gurgle'] },
    meshes: ['ada_body', 'ada_gown', 'ada_hair', 'ada_eye'], maxTris: 60000, textures: ['ada_albedo.webp', 'ada_normal.png', 'ada_hair_albedo.webp', 'ada_hair_normal.png'] },
  harlan: { bones: [...CORE, 'cleaver'], prefixes: ['sack_', 'apron_'], morphs: {},
    meshes: ['harlan_body', 'harlan_shirt', 'harlan_trousers', 'harlan_boots', 'harlan_gloves', 'harlan_apron', 'harlan_suspenders',
      'harlan_sack', 'harlan_twine', 'harlan_void', 'harlan_cleaver'], maxTris: 75000, textures: ['harlan_albedo.webp', 'harlan_normal.png'] },
  arms: { bones: ARMS, prefixes: [], morphs: {}, meshes: ['arms_gloves', 'arms_sleeves', 'arms_flashlight'], maxTris: 40000,
    textures: ['arms_albedo.webp', 'arms_normal.png'] },
};

function glbJson(buf) {
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.toString('utf8', 20, 20 + len));
}

const report = {};
await MeshoptDecoder.ready;
for (const ch of chars) {
  const spec = SPEC[ch];
  const file = path.join(ROOT, 'public/assets/max', `${ch}.glb`);
  console.log(`${ch}.glb`);
  if (!fs.existsSync(file)) {
    expect(false, `${file} exists`);
    continue;
  }
  const buf = fs.readFileSync(file);
  const json = glbJson(buf);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const t0 = performance.now();
  const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const ms = performance.now() - t0;
  expect((json.skins ?? []).length === 1, `exactly one skin (${(json.skins ?? []).length})`);
  const skinned = [];
  gltf.scene.traverse((o) => o.isSkinnedMesh && skinned.push(o));
  const bones = new Set(skinned[0]?.skeleton.bones.map((b) => b.name) ?? []);
  const missing = spec.bones.filter((b) => !bones.has(b));
  expect(missing.length === 0, `required bones present (${bones.size} in skeleton)${missing.length ? ' missing ' + missing : ''}`);
  for (const p of spec.prefixes) expect([...bones].some((b) => b.startsWith(p)), `runtime chain bones ${p}*`);
  const sameSkel = skinned.every((m) => m.skeleton.bones.length === skinned[0].skeleton.bones.length);
  expect(sameSkel, `all ${skinned.length} skinned primitives share the skeleton`);
  const names = new Set();
  gltf.scene.traverse((o) => o.isMesh && names.add(o.name.replace(/_\d+$/, '')));
  const meshNames = new Set();
  gltf.scene.traverse((o) => o.isMesh && meshNames.add(o.parent?.isGroup ? o.parent.name : o.name));
  for (const m of spec.meshes) expect([...meshNames, ...names].some((n) => n.startsWith(m)), `mesh ${m}`);
  let tris = 0;
  gltf.scene.traverse((o) => {
    if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  expect(tris <= spec.maxTris, `triangles ${Math.round(tris)} <= ${spec.maxTris}`);
  // morph targets
  for (const [mesh, want] of Object.entries(spec.morphs)) {
    let dict = null;
    gltf.scene.traverse((o) => {
      if (o.isMesh && (o.name.startsWith(mesh) || o.parent?.name?.startsWith(mesh)) && o.morphTargetDictionary) dict = o.morphTargetDictionary;
    });
    expect(dict && want.every((k) => k in dict), `${mesh} morph targets ${JSON.stringify(dict)}`);
  }
  // material extras
  const mats = new Set();
  gltf.scene.traverse((o) => o.isMesh && mats.add(o.material));
  const withId = [...mats].filter((m) => m.userData?.material_id);
  expect(withId.length === mats.size, `material_id extras on ${withId.length}/${mats.size} materials`);
  // clips
  const clipsFile = path.join(ROOT, '.cache/anims', `${ch}_clips.json`);
  const clips = fs.existsSync(clipsFile) ? JSON.parse(fs.readFileSync(clipsFile, 'utf8')) : [];
  const got = gltf.animations.map((a) => a.name).sort();
  const want = clips.map((c) => c.name).sort();
  expect(JSON.stringify(got) === JSON.stringify(want), `animations = clip table (${got.length})`);
  const durations = {};
  for (const a of gltf.animations) {
    const c = clips.find((x) => x.name === a.name);
    const first = Math.min(...a.tracks.map((t) => t.times[0]));
    durations[a.name] = +a.duration.toFixed(4);
    if (c) expect(Math.abs(a.duration - c.seconds) < 0.02 && Math.abs(first) < 1e-4,
      `${a.name}: ${a.duration.toFixed(3)} s (table ${c.seconds}), starts at ${first.toFixed(4)}`);
    const bad = a.tracks.filter((t) => [...t.values].some((v) => !Number.isFinite(v)));
    if (bad.length) expect(false, `${a.name}: non-finite values in ${bad.length} tracks`);
  }
  // textures in every tier + the GLB copied to every tier
  for (const tier of TIERS) {
    for (const t of spec.textures) expect(fs.existsSync(path.join(ROOT, 'public/assets', tier, t)), `${tier}/${t}`);
    const g = path.join(ROOT, 'public/assets', tier, `${ch}.glb`);
    expect(fs.existsSync(g) && fs.statSync(g).size === buf.length, `${tier}/${ch}.glb identical`);
  }
  report[ch] = { bytes: buf.length, parseMs: Math.round(ms), bones: bones.size, tris: Math.round(tris), animations: durations,
    skinnedPrimitives: skinned.length, materials: [...mats].map((m) => ({ name: m.name, ...m.userData })) };
}
fs.mkdirSync(path.join(ROOT, '.cache/anims'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.cache/anims/check_chars.json'), JSON.stringify(report, null, 2) + '\n');
console.log(failures ? `check_chars: ${failures} failure(s)` : 'check_chars: ok');
process.exit(failures ? 1 : 0);
