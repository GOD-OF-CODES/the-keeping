// FLASH lane part 2 (HAND, contract #146b) — the torch hand frame by frame (the user reads one-frame pops as bugs): at
// the upper-hall idle spot, stepped at 30 fps, records the lens's SCREEN position (px at 960×600) and the hand spring /
// pitch swing every frame through: a walk start (W 0.8 s) and stop, a sprint start/stop, a fast look down (0 → −45° in
// 0.13 s) and back up, a crouch. Prints per segment the largest per-frame lens step (px) and the 2nd difference
// (jerk: a pop shows as one frame far off the line); saves a 12-frame strip of the look-down.
//   node scripts/shot.mjs --no-build --dist <dist> --preset medium --beat B05 --wait 2 --shots 0 --width 960 --height 600 \
//        --timeout 1800 --scenario scripts/qa/hand-motion.mjs --out scratch/flash-hand/<tag> --name med
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DEG = Math.PI / 180;

export default async function (qa) {
  const out = resolve(process.argv[process.argv.indexOf('--out') + 1] ?? 'scratch/flash-hand');
  const name = process.argv.includes('--name') ? process.argv[process.argv.indexOf('--name') + 1] : 'run';
  mkdirSync(out, { recursive: true });
  await qa.game('loop.stop()');
  const res = await qa.eval(`(async () => {
    const g = window.__game; g.unpause?.();
    const active = () => g.cutscenes?.player?.active ?? g.director?.cutscene ?? null;
    for (let i = 0; i < 1800 && active(); i++) { await g.advance(1, 1/30); if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0)); }
    g.brain?.setScripted?.('hidden'); g.hides?.exit?.(); await g.advance(30, 1/30);
    g.player.enabled = true; g.player.lookEnabled = true; if (!g.rig.on) g.rig.setOn(true);
    g.goto(1.8, 0.4, 4.1, ${90 * DEG}, ${-4 * DEG}); g.rig.snap(); await g.advance(60, 1/30);
    const V3 = g.camera.position.constructor;
    const rows = [];
    const rec = (seg) => { const L = g.flashlight.light; L.updateMatrixWorld(true); const p = new V3().setFromMatrixPosition(L.matrixWorld).project(g.camera);
      const c = g.camera; c.updateMatrixWorld(true); const d = c.getWorldDirection(new V3());
      const rq = g.rig.rig.quaternion; const rf = new V3(0, 0, -1).applyQuaternion(rq);
      rows.push({ seg, x: +((p.x + 1) * 480).toFixed(1), y: +((1 - p.y) * 300).toFixed(1), sw: +((g.arms?.pitchSwing ?? 0) / ${DEG}).toFixed(2), ho: g.rig.handOffset ? +(g.rig.handOffset.length() * 1000).toFixed(1) : 0,
        cy: +(Math.atan2(-d.z, d.x) / ${DEG}).toFixed(3), cp: +(Math.asin(d.y) / ${DEG}).toFixed(3), ry: +(Math.atan2(-rf.z, rf.x) / ${DEG}).toFixed(3), rp: +(Math.asin(rf.y) / ${DEG}).toFixed(3),
        tr: +(g.rig.tremble ?? 0).toFixed(2), ey: +c.position.y.toFixed(4) }); };
    const step = async (seg, n, keys = [], pitchFn = null) => { for (let i = 0; i < n; i++) { if (pitchFn) g.look(${90 * DEG}, pitchFn(i)); await g.advance(1, 1/30, keys); rec(seg); await new Promise((r) => setTimeout(r, 1)); } };
    await step('rest', 10);
    await step('walk', 24, ['KeyW']); await step('stop', 20);
    g.goto(1.8, 0.4, 4.1, ${90 * DEG}, ${-4 * DEG}); g.rig.snap(); await g.advance(30, 1/30);
    await step('sprint', 20, ['KeyW', 'ShiftLeft']); await step('stop2', 20);
    g.goto(1.8, 0.4, 4.1, ${90 * DEG}, ${-4 * DEG}); g.rig.snap(); await g.advance(30, 1/30);
    window.__strip = [];
    const dn = (i) => i < 4 ? (-4 - 41 * (i + 1) / 4) * ${DEG} : -45 * ${DEG};
    for (let i = 0; i < 24; i++) { g.look(${90 * DEG}, dn(i)); await g.advance(1, 1/30); rec('lookdown'); if (i < 12) window.__strip.push(await g.capture(640)); }
    const up = (i) => i < 4 ? (-45 + 41 * (i + 1) / 4) * ${DEG} : -4 * ${DEG};
    await step('lookup', 24, [], up);
    await step('crouch', 20, ['KeyC']); await step('rise', 20);
    return rows;
  })()`);
  const segs = {};
  for (let i = 0; i < res.length; i++) (segs[res[i].seg] ??= []).push(i);
  const report = {};
  for (const [seg, idx] of Object.entries(segs)) {
    let maxStep = 0, maxJerk = 0;
    for (const i of idx) {
      if (i < 1) continue;
      const s = Math.hypot(res[i].x - res[i - 1].x, res[i].y - res[i - 1].y);
      maxStep = Math.max(maxStep, s);
      if (i >= 2) maxJerk = Math.max(maxJerk, Math.hypot(res[i].x - 2 * res[i - 1].x + res[i - 2].x, res[i].y - 2 * res[i - 1].y + res[i - 2].y));
    }
    report[seg] = { frames: idx.length, maxStepPx: +maxStep.toFixed(1), maxJerkPx: +maxJerk.toFixed(1), swingEnd: res[idx[idx.length - 1]].sw, hoffMaxMm: Math.max(...idx.map((i) => res[i].ho)) };
    qa.log(`[motion] ${seg} ${JSON.stringify(report[seg])}`);
  }
  writeFileSync(join(out, `${name}-motion.json`), JSON.stringify({ report, rows: res }, null, 1));
  const strip = await qa.eval('window.__strip');
  strip.forEach((u, i) => writeFileSync(join(out, `${name}-lookdown-${String(i).padStart(2, '0')}.jpg`), Buffer.from(u.split(',')[1], 'base64')));
  qa.report.motion = report;
}
