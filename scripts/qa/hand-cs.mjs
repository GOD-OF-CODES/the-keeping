// FLASH lane part 2 (HAND, contract #146b) — the first-person arms in the C2 → C2c escape on the real route: walks onto
// the parlor threshold in B03 like a player (as flash-b05.mjs), gives no input through C2 + C2c, and captures the frames
// the hand review names — C2c 7.6 (the stumble push-off: "the gloves fill the frame"), 11.4 (the breath hold on the
// landing: "the pool under the frame") and 15.5 (gameplay at the stair top, 1.6 s after control returns at 13.9, the
// eye pitched −50°) — plus per frame the arms' screen bbox, the lens in camera space and the pitch swing.
//   node scripts/shot.mjs --no-build --dist <dist> --preset medium --beat B03 --wait 2 --shots 0 --timeout 2400 \
//        --scenario scripts/qa/hand-cs.mjs --out scratch/flash-hand/<tag> --name med   [MARKS=7.6,11.4,15.5] [W=960]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const C2_LEN = 29.0;

export default async function (qa) {
  const out = resolve(process.argv[process.argv.indexOf('--out') + 1] ?? 'scratch/flash-hand');
  const name = process.argv.includes('--name') ? process.argv[process.argv.indexOf('--name') + 1] : 'run';
  mkdirSync(out, { recursive: true });
  const marks = (process.env.MARKS ?? '7.6,11.4,15.5').split(',').map(Number).sort((a, b) => a - b);
  const W = Number(process.env.W ?? 960);
  await qa.game('loop.stop()');
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
  const rows = [];
  for (const m of marks) {
    const r = await qa.eval(`(async () => {
      const g = window.__game;
      while (g.ctx.time.now - ${t0} < ${C2_LEN + m} - 1e-6) await g.advance(1, 1/30);
      const cam = g.camera; cam.updateMatrixWorld(true);
      const inv = cam.matrixWorld.clone().invert();
      const V3 = cam.position.constructor; const v = new V3();
      let x0 = 1, x1 = -1, y0 = 1, y1 = -1, n = 0;
      for (const mm of g.arms?.c?.meshes ?? []) {
        let vis = true; for (let o = mm; o; o = o.parent) if (!o.visible) { vis = false; break; }
        if (!vis || !mm.geometry?.attributes?.position) continue;
        mm.updateMatrixWorld(true);
        for (let i = 0; i < mm.geometry.attributes.position.count; i += 3) {
          mm.getVertexPosition(i, v); v.applyMatrix4(mm.matrixWorld); v.project(cam);
          if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
          x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); n++;
        }
      }
      const L = g.flashlight.light; L.updateMatrixWorld(true);
      const lens = new V3().setFromMatrixPosition(L.matrixWorld).applyMatrix4(inv);
      const d = cam.getWorldDirection(new V3());
      const st = { mark: ${m}, cs: g.cutscenes?.player?.active ?? null, csT: +(g.cutscenes?.player?.time ?? -1).toFixed(2),
        bbox: n ? [(x0 + 1) / 2, (x1 + 1) / 2, (1 - y1) / 2, (1 - y0) / 2].map((q) => +q.toFixed(3)) : null,
        lens: [lens.x, -lens.z, lens.y].map((q) => +q.toFixed(3)), pitch: +(Math.asin(d.y) * 180 / Math.PI).toFixed(1),
        swing: +((g.arms?.pitchSwing ?? 0) * 180 / Math.PI).toFixed(1), fov: +cam.fov.toFixed(1),
        ev: +g.look.exposure().ev.toFixed(2), on: g.rig.on, clamp: g.arms?.beamClamped ?? null, carHands: g.arms?.carHands ?? null };
      const url = await g.capture(${W});
      return { st, url };
    })()`);
    const file = join(out, `${name}-c2c-${m.toFixed(1)}.jpg`);
    writeFileSync(file, Buffer.from(r.url.split(',')[1], 'base64'));
    rows.push(r.st);
    qa.log(`[cs] ${JSON.stringify(r.st)} → ${file}`);
  }
  writeFileSync(join(out, `${name}-cs.json`), JSON.stringify(rows, null, 1));
  qa.report.cs = rows;
}
