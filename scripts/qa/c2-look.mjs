// QA look session — fix round 3 stage 2 (LOOK): C2 at the physical film camera (ISO 3200 f/2, fixed cue) with
//   (1) the jets frame (7.75) + meter, (2) the posed body's cut cap centroid / neck axis at 8.45 (PLAN, for JET_CUT /
//   JET_AZ / JET_EL) and the head piece's cap centroid in the ada_head_rig frame (HEAD_CUT_L), (3) a floor-head pose
//   sweep at 10.5 (globalThis.__c2HeadRest + __c2HeadQA = 'rest') with probes on the HEAD NODE (obj, not plan points),
//   (4) optional extra marks.
//   node scripts/shot.mjs --scenario scripts/qa/c2-look.mjs --preset medium --beat B03 --dist <dir> --wait 2 --shots 0 \
//        --out scratch/<dir> --name <n> --timeout 2400
// env: POSES='[{"name":"p0","face":241,"roll":-60,"tilt":35,"c":[x,y,z]?}]' (none = the shipped rest pose only),
//      MARKS (default '7.75'), LATE (default '13.9,24.0'; '' none), CAP=1 (the cut probes), SWEEP_ONLY=1.
const LAMP = [4.3, 3.6, 1.35]; // fix round 4 (#129) — was (4.6, 4.25)
const HEADPTS = [
  // ada_head_rig frame: origin = the crown, +Y crown, +Z face, +X her left; centre (0, −0.12, 0)
  { name: 'cut', obj: 'ada_head_rig', local: [0, -0.212, 0.01], r: 3 },
  { name: 'cheek_R', obj: 'ada_head_rig', local: [-0.055, -0.15, 0.06], r: 3 },
  { name: 'ear_R', obj: 'ada_head_rig', local: [-0.075, -0.12, -0.01], r: 3 },
  { name: 'jaw_R', obj: 'ada_head_rig', local: [-0.045, -0.19, 0.04], r: 3 },
  { name: 'hair_back', obj: 'ada_head_rig', local: [0, -0.08, -0.09], r: 4 },
  { name: 'hair_crown', obj: 'ada_head_rig', local: [0, -0.01, 0], r: 4 },
  { name: 'eye_R', obj: 'ada_head_rig', local: [-0.031, -0.07, 0.08], r: 2 },
  { name: 'floor_head', plan: [5.25, 2.95, 0.6] },
  { name: 'flame_mirror', plan: [4.61, 3.57, 0.6], r: 4 },
  { name: 'pool_N', plan: [5.25, 3.45, 0.6], r: 6 },
];
const JETPTS = [
  { name: 'stump', obj: 'ada/neck_01', r: 3 },
  { name: 'gown_chest', obj: 'ada/spine_03', r: 6 },
];

export default async function (qa) {
  const walk = `(async () => {
    const g = window.__game; g.unpause?.();
    const active = () => g.cutscenes?.player?.active ?? g.director.cutscene ?? null;
    for (let i = 0; i < 900 && active(); i++) await g.advance(1, 1/30);
    const legs = [[1.8, -1.5], [1.8, 0.6], [3.1, 1.5]];
    let k = 0;
    for (let i = 0; i < 30 * 40 && !active(); i++) {
      const p = g.pos(); const to = legs[Math.min(k, legs.length - 1)];
      if (k < legs.length - 1 && Math.hypot(p[0] - to[0], p[1] - to[1]) < 0.3) { k++; continue; }
      g.look(Math.atan2(to[1] - p[1], to[0] - p[0]), 0);
      await g.advance(1, 1/30, Math.hypot(p[0] - to[0], p[1] - to[1]) > 0.2 ? ['KeyW'] : []);
    }
    return { started: active(), t: g.ctx.time.now };
  })()`;
  await qa.game('loop.stop()');
  const w = await qa.eval(walk);
  qa.log('C2 start ' + JSON.stringify(w));
  qa.assert(w.started === 'C2', 'C2 started at the threshold');
  const t0 = w.t;
  const until = async (sec) => qa.eval(`(async () => { const g = window.__game; while (g.ctx.time.now - ${t0} < ${sec} - 1e-6) await g.advance(1, 1/60); return +(g.ctx.time.now - ${t0}).toFixed(3); })()`);
  const meter = async (label, pts) => {
    const r = await qa.eval(`(async () => {
      const g = window.__game; const ex = g.look.exposure();
      const p = await g.look.hdr(${JSON.stringify(pts)});
      const info = g.renderer.info; const auto = info.autoReset; info.autoReset = false; info.reset();
      await g.advance(1, 1/1200);
      const ri = { draws: info.render.drawCalls, tris: info.render.triangles };
      info.autoReset = auto;
      return { e: ex.applied, wb: ex.wb, p, ri };
    })()`);
    const wb = r.wb ?? [1, 1, 1];
    qa.log(`[meter] ${label}: applied ${r.e?.toFixed?.(4)} draws ${r.ri?.draws} tris ${r.ri?.tris}`);
    for (const q of r.p) {
      if (q.off || q.lum === undefined) { qa.log(`   ${q.name}: off`); continue; }
      const y = r.e * (0.2126 * q.rgb[0] * wb[0] + 0.7152 * q.rgb[1] * wb[1] + 0.0722 * q.rgb[2] * wb[2]);
      qa.log(`   ${q.name}: L ${q.lum} rgb ${q.rgb.join('/')} (max ${q.max}) → AgX-in ${y.toPrecision(3)} @uv ${q.uv} d ${q.dist ?? '-'}`);
    }
    (qa.report.meter ??= {})[label] = r;
  };
  if (process.env.SIDE) {
    // a side view of the stump during the pulses (PLAN; QA camera hook): do the jets leave the stump along it?
    await until(Number(process.env.SIDE));
    await qa.eval(`(async () => { const g = window.__game; globalThis.__csCam = { pos: [5.05, 2.35, 1.55], target: [5.2, 3.3, 1.42], fov: 50 }; await g.advance(1, 1/1200); await g.advance(1, 1/1200); return 1; })()`);
    await qa.shot('side');
    await qa.eval(`globalThis.__csCam = null; 1`);
  }
  const marks = (process.env.MARKS ?? '7.75').split(',').filter((v) => v.trim() !== '').map(Number);
  if (!process.env.SWEEP_ONLY)
    for (const m of marks) {
      await until(m);
      await meter(`c2-${m.toFixed(2)}`, JETPTS);
      await qa.shot(`c2-${m.toFixed(2)}`);
    }
  if (process.env.CAP) {
    await until(8.45);
    const r = await qa.eval(`(async () => {
      const g = window.__game; const V = g.camera.position.constructor;
      const f = (v) => [+v.x.toFixed(4), +(-v.z).toFixed(4), +v.y.toFixed(4)];
      const meshes = []; g.scene.traverse((o) => { if (o.isSkinnedMesh && /ada/i.test(o.name)) meshes.push(o); });
      const out = { meshes: meshes.map((m) => m.name + ':' + m.geometry.attributes.position.count) };
      const sel = (m, test, skin) => { const P = m.geometry.attributes.position, N = m.geometry.attributes.normal; const v = new V(), n = new V(), s = new V(); let c = 0;
        for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i); n.fromBufferAttribute(N, i); if (!test(v, n)) continue;
          if (skin) { m.applyBoneTransform(i, v); v.applyMatrix4(m.matrixWorld); } s.add(v); c++; } return c ? { p: s.divideScalar(c), c } : null; };
      const inNeck = (v) => Math.hypot(v.x, v.z + 0.01) < 0.065 && v.y > 1.33 && v.y < 1.46;
      const body = meshes.find((m) => m.name === 'ada_body') ?? meshes[0];
      if (body) {
        const cap = sel(body, (v, n) => inNeck(v) && n.y > 0.8, true);
        const capB = sel(body, (v, n) => inNeck(v) && n.y > 0.8, false);
        const ring = capB ? sel(body, (v) => Math.hypot(v.x, v.z + 0.01) < 0.075 && v.y > capB.p.y - 0.08 && v.y < capB.p.y - 0.06, true) : null;
        const ring2 = capB ? sel(body, (v) => Math.hypot(v.x, v.z + 0.01) < 0.08 && v.y > capB.p.y - 0.12 && v.y < capB.p.y - 0.10, true) : null;
        if (cap && ring2) { const a2 = cap.p.clone().sub(ring2.p).normalize(); out.axis2 = { azDeg: +(Math.atan2(-a2.z, a2.x) * 180 / Math.PI).toFixed(1), elDeg: +(Math.asin(a2.y) * 180 / Math.PI).toFixed(1) }; }
        if (cap && ring) { const ax = cap.p.clone().sub(ring.p).normalize();
          out.body = { capPlan: f(cap.p), n: cap.c, capBind: f(capB.p), ringPlan: f(ring.p), axisPlan: f(ax),
            azDeg: +(Math.atan2(-ax.z, ax.x) * 180 / Math.PI).toFixed(1), elDeg: +(Math.asin(ax.y) * 180 / Math.PI).toFixed(1) }; }
      }
      for (const m of meshes) {
        if (m === body) continue;
        const cb = sel(m, (v, n) => inNeck(v) && n.y < -0.8, false);
        if (cb) out['head:' + m.name] = { capBind: [+cb.p.x.toFixed(4), +cb.p.y.toFixed(4), +cb.p.z.toFixed(4)], n: cb.c, rigLocal: [+cb.p.x.toFixed(4), +(cb.p.y - 1.608).toFixed(4), +(cb.p.z + 0.02).toFixed(4)] };
      }
      const hr = g.scene.getObjectByName('ada_head_rig'); out.headRig = !!hr;
      return JSON.stringify(out);
    })()`);
    qa.log('cap ' + r);
  }
  await until(Number(process.env.SWEEP_AT ?? 10.5)); // SWEEP_AT 10.0 + SETTLE 100: each pose gets ≈ 0.08 s for the hair chains
  const poses = process.env.POSES ? JSON.parse(process.env.POSES) : [{ name: 'shipped' }];
  for (const p of poses) {
    await qa.eval(`(async () => { const g = window.__game; globalThis.__c2HeadRest = ${JSON.stringify(p.name === 'shipped' ? null : p)}; globalThis.__c2HeadQA = ${p.name === 'shipped' ? 'null' : "'rest'"}; for (let i = 0; i < ${Number(process.env.SETTLE ?? 3)}; i++) await g.advance(1, 1/1200); return 1; })()`);
    await meter(`c2-10.50-${p.name}`, HEADPTS);
    await qa.shot(`c2-10.50-${p.name}`);
  }
  await qa.eval(`globalThis.__c2HeadRest = null; globalThis.__c2HeadQA = null; 1`);
  qa.log('morphs ' + await qa.eval(`JSON.stringify((() => { const o = []; window.__game.scene.traverse((m) => { if (m.morphTargetDictionary && /ada/.test(m.name)) o.push([m.name, Object.keys(m.morphTargetDictionary), m.morphTargetInfluences?.map((v) => +v.toFixed(2))]); }); return o; })())`));
  const late = (process.env.LATE ?? '13.9,24.0').split(',').filter((v) => v.trim() !== '').map(Number);
  for (const m of late) {
    await until(m);
    // fix round 4 (ruling u): the 13.9 insert must have the eye open — log the live eyelid_l_open influence
    qa.log(`eyelid ${m} ` + await qa.eval(`JSON.stringify((() => { const o = []; window.__game.scene.traverse((x) => { const d = x.morphTargetDictionary; if (d && 'eyelid_l_open' in d) o.push([x.name, x.morphTargetInfluences?.[d.eyelid_l_open]]); }); return o; })())`));
    await meter(`c2-${m.toFixed(2)}`, m < 15 ? HEADPTS.slice(0, 7) : JETPTS);
    await qa.shot(`c2-${m.toFixed(2)}`);
  }
  const c2c = (process.env.C2C ?? '').split(',').filter((v) => v.trim() !== '').map(Number);
  for (const m of c2c) {
    await until(29.0 + m);
    await meter(`c2c-${m.toFixed(2)}`, []);
    await qa.shot(`c2c-${m.toFixed(2)}`);
  }
  void LAMP;
}
