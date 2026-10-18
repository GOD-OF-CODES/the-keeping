// FLASH lane (#146) — guard stills for the near-wall beam fix: C2 9.3 / 13.9 and C2c 15.5 (film-camera exposure cues:
// must be unchanged) and B05 (Ada carrying her head into the torch core at 4 / 3 / 2.3 m: her gown must not go back to
// blown plaster white). Walks onto the parlor threshold in B03 like a player (as c2-meter.mjs), no input through C2 +
// C2c, then at the stair top keeps the camera (and the beam) on her chest (as b05-carry.mjs).
// At each B05 mark on a FLASH build (AB=1): a SAME-STATE A/B — the frame is frozen (dt 1e-4), each config is applied,
// the exposure snapped to a fresh reading of that config's frame, and a 640-px capture saved: old (nearAdapt 1,
// nearLead 0, fixSoft 0, far-field core, no pullback/aim = pre-#146) vs new (the build's defaults).
//   node scripts/shot.mjs --no-build --dist <dist> --preset medium --beat B03 --wait 2 --shots 0 --timeout 2400 \
//        --scenario scripts/qa/flash-b05.mjs --out scratch/flash-beam/<tag> --name med   [AB=1] [DISTS=4,3,2.3]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const C2_LEN = 29.0;
const CFG = {
  old: { look: { nearAdapt: 1, nearLead: 0, fixSoft: 0 }, near: 0, pull: false, aim: false },
  new: { look: { nearAdapt: 0.5, nearLead: 1, fixSoft: 1 }, near: 1, pull: true, aim: true },
};

export default async function (qa) {
  const out = resolve(process.argv[process.argv.indexOf('--out') + 1] ?? 'scratch/flash-beam');
  const name = process.argv.includes('--name') ? process.argv[process.argv.indexOf('--name') + 1] : 'run';
  mkdirSync(out, { recursive: true });
  const AB = !!process.env.AB;
  const DISTS = (process.env.DISTS ?? '4,3,2.3').split(',').map(Number).sort((a, b) => b - a);
  const save = async (label) => {
    const url = await qa.eval(`window.__game.capture(640)`);
    const file = join(out, `${name}-${label}.jpg`);
    writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    return file;
  };
  const state = async () =>
    qa.eval(`(async () => {
      const g = window.__game; const ex = g.look.exposure();
      const p = await g.look.hdr([{ name: 'gown_hip', obj: 'ada/spine_01', r: 6 }, { name: 'gown_chest', obj: 'ada/spine_03', r: 6 }, { name: 'centre', uv: [0.5, 0.5], r: 8 }]);
      return { applied: +ex.applied.toFixed(4), ev: +ex.ev.toFixed(3), target: +ex.targetEV.toFixed(3), last: ex.last, cue: ex.cue, near: ex.near ?? null,
        pull: g.arms?.pull ?? null, aim: g.arms?.aim ?? null, hdr: p.map((q) => ({ n: q.name, L: q.lum, max: q.max, uv: q.uv, d: q.dist })) };
    })()`);
  await qa.game('loop.stop()');
  // ---- B03 → C2 (as c2-meter.mjs)
  const w = await qa.eval(`(async () => {
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
  })()`);
  qa.log('C2 start ' + JSON.stringify(w));
  qa.assert(w.started === 'C2', 'C2 started at the threshold');
  const t0 = w.t;
  const until = async (sec) => qa.eval(`(async () => { const g = window.__game; while (g.ctx.time.now - ${t0} < ${sec} - 1e-6) await g.advance(1, 1/60); return +(g.ctx.time.now - ${t0}).toFixed(3); })()`);
  const report = { cue: {}, b05: [] };
  for (const [label, at] of [['c2-9.30', 9.3], ['c2-13.90', 13.9], ['c2c-15.50', C2_LEN + 15.5]]) {
    await until(at);
    const st = await state();
    const f = await save(label);
    await qa.shot(label);
    report.cue[label] = st;
    qa.log(`[cue] ${label}: applied ${st.applied} ev ${st.ev} cue ${JSON.stringify(st.cue)} pull ${st.pull} aim ${st.aim} → ${f}`);
    if (AB) {
      // same state, frozen (dt 1e-4): every #146 switch to its pre-#146 value, re-rendered, captured; then restored
      for (const cfg of ['old', 'new']) {
        const C = CFG[cfg];
        await qa.eval(`(async () => { const g = window.__game;
          g.look.set(${JSON.stringify(C.look)}); g.flashlight.near.value = ${C.near};
          g.arms.pullEnabled = ${C.pull}; g.arms.aimEnabled = ${C.aim};
          await g.advance(2, 1e-4); return 1; })()`);
        const s2 = await state();
        const f2 = await save(`${label}-${cfg}`);
        (report.cueAB ??= {})[`${label}-${cfg}`] = s2;
        qa.log(`[cue]    ${cfg}: applied ${s2.applied} pull ${s2.pull} aim ${s2.aim} → ${f2}`);
      }
    }
  }
  // ---- through C2c to B05, then her return under the torch (as b05-carry.mjs)
  const pre = await qa.eval(`(async () => {
    const g = window.__game; const f = (v) => +v.toFixed(2);
    window.__ada = null;
    const orig = g.director.update.bind(g.director);
    g.director.update = (dt) => { const o = orig(dt); if (o) window.__ada = o; return o; };
    const active = () => g.cutscenes?.player?.active ?? g.director.cutscene ?? null;
    for (let i = 0; i < 30 * 90 && active(); i++) await g.advance(1, 1/30);
    const s = g.storyState();
    g.rig.setOn(true);
    window.__b05 = { t: 0, d0: s.deathsTotal, minD: 99, next: 0 };
    return { beat: s.beat, me: g.pos().map(f), torch: g.rig.on };
  })()`);
  qa.log('B05 ' + JSON.stringify(pre));
  for (let chunk = 0; chunk < 400; chunk++) {
    const r = JSON.parse(await qa.eval(`(async () => {
      const g = window.__game; const B = window.__b05; const f = (v) => +v.toFixed(2);
      const marks = ${JSON.stringify(DISTS)};
      for (let i = 0; i < 90; i++) {
        const a = window.__ada; const me = g.pos(); const eye = [me[0], me[1], me[2] + 1.65];
        let d = 99;
        if (a?.pos && a.visible) {
          const chest = [a.pos[0], a.pos[1], a.pos[2] + 1.25];
          const dx = chest[0] - eye[0], dy = chest[1] - eye[1], dz = chest[2] - eye[2];
          const h = Math.hypot(dx, dy); d = Math.hypot(h, dz);
          g.look(Math.atan2(dy, dx), Math.atan2(dz, h));
        }
        await g.advance(1, 1/30);
        B.t += 1/30;
        const s = g.storyState();
        if (s.deathsTotal > B.d0 || s.dead) return JSON.stringify({ end: 'caught', t: f(B.t) });
        if (d < B.minD) B.minD = d;
        if (B.next < marks.length && d <= marks[B.next]) { const mark = marks[B.next]; B.next++; return JSON.stringify({ shot: mark, d: f(d), t: f(B.t) }); }
        if (B.next >= marks.length) return JSON.stringify({ end: 'done', t: f(B.t) });
        if (B.t > 80) return JSON.stringify({ end: 'timeout', t: f(B.t), minD: f(B.minD) });
      }
      return JSON.stringify({ t: f(B.t) });
    })()`));
    if (r.end) { qa.log('B05 end ' + JSON.stringify(r)); break; }
    if (!r.shot) continue;
    const live = await state();
    const row = { mark: r.shot, d: r.d, live, ab: {} };
    row.liveFile = await save(`b05-${r.shot}m-live`);
    if (AB) {
      for (const cfg of ['old', 'new']) {
        const C = CFG[cfg];
        await qa.eval(`(async () => { const g = window.__game;
          g.look.set(${JSON.stringify(C.look)}); g.flashlight.near.value = ${C.near};
          g.arms.pullEnabled = ${C.pull}; g.arms.aimEnabled = ${C.aim}; if (!${C.pull}) g.arms.pull = 0; if (!${C.aim}) g.arms.aim = 0;
          await g.advance(2, 1e-4); g.look.snap(); await g.advance(1, 1e-4);
          await new Promise((res) => setTimeout(res, 120)); await g.advance(1, 1e-4); return 1; })()`);
        row.ab[cfg] = await state();
        row.ab[cfg].file = await save(`b05-${r.shot}m-${cfg}`);
      }
      // back to the build's defaults for the rest of the walk
      await qa.eval(`(() => { const g = window.__game; g.look.set(${JSON.stringify(CFG.new.look)}); g.flashlight.near.value = 1; g.arms.pullEnabled = true; g.arms.aimEnabled = true; return 1; })()`);
    }
    report.b05.push(row);
    const fmt = (s) => `applied ${s.applied} which ${s.last?.which ?? '-'} G ${s.near?.G?.toFixed?.(2) ?? '-'} subj ${s.near?.subject ?? '-'} hit ${s.near?.hitDist?.toFixed?.(2) ?? '-'} gown ${s.hdr[0]?.L?.toFixed?.(3)}×${s.applied} = ${(s.hdr[0]?.L * s.applied).toFixed(3)} pull ${s.pull?.toFixed?.(3)} aim ${s.aim?.toFixed?.(3)}`;
    qa.log(`[b05] ${r.shot} m (d ${r.d}) live: ${fmt(live)}`);
    if (AB) for (const c of ['old', 'new']) qa.log(`[b05]    ${c}: ${fmt(row.ab[c])}`);
  }
  qa.report.flash = report;
  qa.assert(report.b05.length > 0, 'Ada came into the beam (B05 stills)');
}
