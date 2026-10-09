#!/usr/bin/env node
// Post-check for the `props` job: parse every props_m*.glb with three r186's own GLTFLoader + MeshoptDecoder
// (plain Node, no browser globals: the GLBs carry no images) and verify the runtime contract (docs/PROPS.md):
//   - one root per expected placement (from .cache/props/props.json), userData.prop_id/prop_type/milestone
//   - every mesh has `uv` (TEXCOORD_0); every material has userData.material_id from src/shared/material-spec.json
//   - triangle count per placement root <= its generator budget
//   - UV0 is metric (sum of UV area / sum of surface area ~ 1) on non-decal meshes
//   - no animations; EXT_meshopt_compression used; the file exists in every tier (Low = decimated LOD: parsed too)
//   - lightmapped prop meshes (userData.kind 'level', docs/PROPS.md "Lightmaps"): uv1 present, inside [0,1],
//     `lightmap` = lm_<atlas>, same count in Low as in Medium
//   node blender/props/check_props.mjs [public/assets]
import fs from 'node:fs';
import path from 'node:path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const assets = path.resolve(ROOT, process.argv[2] ?? 'public/assets');
const report = JSON.parse(fs.readFileSync(path.join(ROOT, '.cache/props/props.json'), 'utf8'));
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/shared/material-spec.json'), 'utf8'));
const specIds = new Set(spec.materials.map((m) => m.id));
const familyOf = Object.fromEntries(spec.materials.map((m) => [m.id, m.family]));
// PROPS-FINISH §5: the 'wear' COLOR_0 mask (Low: HERO props only) — read from blender/props/wear.py
const HERO = new Set([...fs.readFileSync(path.join(ROOT, 'blender/props/wear.py'), 'utf8')
  .match(/^HERO = \[([\s\S]*?)\]/m)[1].matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]));

let failures = 0;
const fail = (m) => (failures++, console.log(`  FAIL ${m}`));
const ok = (m) => console.log(`  ok   ${m}`);

const budgetOf = {};
const expected = {};
for (const v of report.variants)
  for (const id of v.placements) if (!(id in (report.skipped ?? {}))) (budgetOf[id] = v.budget), (expected[id] = v.type);

function glbJson(buf) {
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.toString('utf8', 20, 20 + len));
}

async function parse(file) {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  await MeshoptDecoder.ready;
  return { json: glbJson(buf), gltf: await loader.parseAsync(ab, '') };
}

function triArea(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = (b[2] ?? 0) - (a[2] ?? 0);
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = (c[2] ?? 0) - (a[2] ?? 0);
  const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
  return 0.5 * Math.sqrt(x * x + y * y + z * z);
}

const files = Object.keys(report.files ?? {});
if (!files.length) fail('props.json lists no exported files');
const seen = new Set();
let uvA = 0, geoA = 0;
for (const name of files) {
  const tiers = ['low', 'medium', 'max'].map((t) => path.join(assets, t, name));
  const sizes = tiers.map((f) => (fs.existsSync(f) ? fs.statSync(f).size : -1));
  if (sizes.some((s) => s < 0)) fail(`${name} missing in a tier (${sizes})`);
  const file = tiers[1];
  console.log(`${name} (${(sizes[1] / 1024).toFixed(0)} KiB, low ${(sizes[0] / 1024).toFixed(0)} KiB)`);
  const lmCount = {};
  for (const [tier, f] of [['low', tiers[0]], ['medium', tiers[1]]]) {
    if (!fs.existsSync(f)) continue;
    const { gltf: g2 } = await parse(f);
    let n = 0, bad = 0;
    const wear = { meshes: 0, verts: 0, bad: [], nonHero: new Set(), hiEdge: [], underDust: [], glassMixed: 0 };
    for (const root of g2.scene.children) {
      const type = root.userData?.prop_type;
      let sR = 0, nV = 0, under = 0, upN = 0;
      root.traverse((o) => {
        const col = o.isMesh && o.geometry.attributes.color;
        if (!col) return;
        const ud = { ...(o.parent?.userData ?? {}), ...o.userData };
        wear.meshes++;
        wear.verts += col.count;
        if (col.itemSize !== 4 || !col.normalized || !(col.array instanceof Uint16Array)) wear.bad.push(`${o.name}: COLOR_0 not unorm16x4`);
        if (ud.decal || ud.print) wear.bad.push(`${o.name}: decal with COLOR_0`);
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!specIds.has(m.userData?.material_id)) wear.bad.push(`${o.name}: masked primitive without a spec material_id`);
          else if (familyOf[m.userData.material_id] === 'glass') wear.glassMixed++;
        }
        if (tier === 'low' && !HERO.has(type)) wear.nonHero.add(type);
        const nrm = o.geometry.attributes.normal;
        // edge mean is AREA-weighted (what the eye sees): bevel strips are vertex-dense, so a plain vertex mean
        // over-reports thin props (cleaver, crank) whose edge band is only a few mm wide.
        const pos = o.geometry.attributes.position, idx = o.geometry.index;
        const triN = idx ? idx.count / 3 : pos.count / 3;
        for (let t = 0; t < triN; t++) {
          const a = idx ? idx.getX(3 * t) : 3 * t, b = idx ? idx.getX(3 * t + 1) : 3 * t + 1, c = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
          const ux = pos.getX(b) - pos.getX(a), uy = pos.getY(b) - pos.getY(a), uz = pos.getZ(b) - pos.getZ(a);
          const vx = pos.getX(c) - pos.getX(a), vy = pos.getY(c) - pos.getY(a), vz = pos.getZ(c) - pos.getZ(a);
          const ar = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
          sR += ar * (col.getX(a) + col.getX(b) + col.getX(c)) / 3;
          nV += ar;
        }
        for (let i = 0; i < col.count; i++) {
          if (nrm && nrm.getY(i) < -0.3) (upN++, col.getW(i) > 0.05 && under++);   // three Y-up: underside
        }
      });
      if (nV && sR / nV > 0.25) wear.hiEdge.push(`${type} ${(sR / nV).toFixed(2)}`);
      if (upN && under / upN > 0.02) wear.underDust.push(`${type} ${(100 * under / upN).toFixed(0)}%`);
    }
    wear.bad.length ? fail(`${tier}/${name}: wear contract: ${[...new Set(wear.bad)].slice(0, 6).join('; ')}`)
      : ok(`${tier}: ${wear.meshes} wear-masked meshes (${wear.verts} verts)${wear.glassMixed ? `, ${wear.glassMixed} glass primitives in mixed meshes (mask 0)` : ''}`);
    if (wear.nonHero.size) fail(`low/${name}: non-HERO props carry COLOR_0: ${[...wear.nonHero].join(', ')}`);
    if (wear.hiEdge.length) console.log(`  warn ${tier}: edge-mask mean > 0.25 (too worn?): ${wear.hiEdge.join(', ')}`);
    if (wear.underDust.length) console.log(`  warn ${tier}: dust on undersides: ${wear.underDust.join(', ')}`);
    g2.scene.traverse((o) => {
      if (!o.isMesh) return;
      // child nodes (moving parts, decals, colliders) of a lightmapped node inherit its extras in a merged view
      // (like level.ts lmFor) but have no uv1: they stay probe-lit. A lightmapped mesh = uv1 present.
      const ud = { ...(o.parent?.userData ?? {}), ...o.userData };
      const uv1 = o.geometry.attributes.uv1;
      if (!uv1) {
        if (o.userData.kind === 'level') bad++;
        return;
      }
      n++;
      if (ud.kind !== 'level' || !/^lm_[a-z_]+$/.test(String(ud.lightmap)) || !ud.atlas) return void bad++;
      for (let i = 0; i < uv1.count; i++) {
        const u = uv1.getX(i), v = uv1.getY(i);
        if (!(u >= -1e-4 && u <= 1.0001 && v >= -1e-4 && v <= 1.0001)) return void bad++;
      }
    });
    lmCount[tier] = n;
    bad ? fail(`${tier}/${name}: ${bad}/${n} lightmapped meshes without a valid uv1/lightmap/atlas`) : ok(`${tier}: ${n} lightmapped prop meshes with uv1`);
  }
  if (lmCount.low !== lmCount.medium) fail(`${name}: lightmapped meshes low ${lmCount.low} != medium ${lmCount.medium}`);
  const t0 = performance.now();
  const { json, gltf } = await parse(file);
  const ms = performance.now() - t0;
  (json.extensionsUsed ?? []).includes('EXT_meshopt_compression')
    ? ok(`meshopt, parsed in ${ms.toFixed(0)} ms`) : fail('EXT_meshopt_compression not used');
  if (gltf.animations.length) fail(`unexpected animations: ${gltf.animations.map((a) => a.name)}`);
  const badMats = new Set();
  let meshes = 0, noUv = 0;
  for (const root of gltf.scene.children) {
    const id = root.userData?.prop_id;
    if (!id) {
      fail(`root ${root.name} has no userData.prop_id`);
      continue;
    }
    seen.add(id);
    if (root.userData.prop_type !== expected[id]) fail(`${id}: prop_type ${root.userData.prop_type} != ${expected[id]}`);
    let tris = 0;
    root.traverse((o) => {
      // three r186 GLTFLoader reserves extras.pivot (GLTFExporter pivot containers): never emit it
      if (o.userData && 'pivot' in o.userData) fail(`${id}/${o.name}: extras.pivot is reserved by GLTFLoader`);
      if (!o.isMesh) return;
      meshes++;
      const g = o.geometry;
      const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      const ud = { ...(o.parent?.userData ?? {}), ...o.userData };   // multi-primitive nodes load as Group > Mesh
      if (!ud.collider) tris += n;
      if (!g.attributes.uv) noUv++;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (!specIds.has(m.userData?.material_id)) badMats.add(`${m.name}:${m.userData?.material_id}`);
      const decalLike = ud.decal || ud.collider || ud.print;
      if (!decalLike && g.attributes.uv && g.index) {
        const p = g.attributes.position, uv = g.attributes.uv, idx = g.index;
        o.updateWorldMatrix(true, false);
        const s = o.matrixWorld.getMaxScaleOnAxis();
        let ga = 0, ua = 0;
        const [i0, i1] = [o.geometry.drawRange?.start ?? 0, idx.count];
        for (let i = i0; i + 2 < i1; i += 3) {
          const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
          ga += triArea([p.getX(a), p.getY(a), p.getZ(a)], [p.getX(b), p.getY(b), p.getZ(b)],
            [p.getX(c), p.getY(c), p.getZ(c)]) * s * s;
          ua += triArea([uv.getX(a), uv.getY(a), 0], [uv.getX(b), uv.getY(b), 0], [uv.getX(c), uv.getY(c), 0]);
        }
        if (Number.isFinite(ga) && Number.isFinite(ua)) (geoA += ga), (uvA += ua);
        else fail(`${id}/${o.name}: non-finite area (geo ${ga}, uv ${ua})`);
      }
    });
    const budget = budgetOf[id];
    if (budget && tris > budget) fail(`${id}: ${tris} tris > budget ${budget}`);
  }
  noUv ? fail(`${noUv}/${meshes} meshes without uv`) : ok(`${meshes} meshes, all with uv (TEXCOORD_0)`);
  badMats.size ? fail(`materials without a material-spec id: ${[...badMats].join(', ')}`) : ok('all materials carry a spec material_id');
}
const missing = Object.keys(expected).filter((id) => !seen.has(id));
missing.length ? fail(`placements missing from the GLBs: ${missing.join(', ')}`) : ok(`${seen.size} placement roots present`);
const ratio = uvA / Math.max(geoA, 1e-9);
// box projection per face in metres: UV area == surface area up to the projection's cosine (>= 0.577)
ratio > 0.55 && ratio < 1.05 ? ok(`UV0 metric: uv/surface area ${ratio.toFixed(3)}`) : fail(`UV0 not metric: ratio ${ratio.toFixed(3)}`);
console.log(failures ? `check_props: ${failures} failure(s)` : 'check_props: ok');
process.exit(failures ? 1 : 0);
