// QA perf probe: per-frame renderer.info (draw calls, triangles, render calls) for the current view, plus memory
// (textures, geometries, shader programs).
//
//   node scripts/shot.mjs --scenario scripts/qa/perf.mjs --preset medium --spawn debug_upper --wait 8 --fps 6 \
//        --no-build --out scratch/qa --name perf-medium-upper
//
// Optional teleport before measuring (plan space, metres; heading CCW from east in rad; pitch in rad):
//   QA_GOTO="1.8,-12,0,1.571,0.08" node scripts/shot.mjs --scenario scripts/qa/perf.mjs ...   (facade from the drive)
//
// One frame is rendered with window.__game.advance(1) between a manual renderer.info.reset() and the read, with the
// rAF loop stopped for those few milliseconds (so the read is exactly one full frame: shadow maps + scene pass +
// post). The loop is restarted afterwards, so shot.mjs's --fps measurement that follows runs on real rAF.

export default async function (qa) {
  // The story always opens on C1 (camera in the car) whatever ?spawn says: skip any running cutscene first, then put
  // the player on the requested layout spawn (QA_SPOT) and/or an explicit point (QA_GOTO).
  for (let i = 0; i < 4; i++) {
    const cs = await qa.eval(`(() => { const c = window.__game.cutscenes?.player; const id = c?.active ?? null; if (id) c.skip(true); return id; })()`);
    if (!cs) break;
    qa.log(`skipped cutscene ${cs}`);
    await qa.wait(1.5);
  }
  const spot = process.env.QA_SPOT;
  if (spot) {
    const ok = await qa.eval(`(() => { const g = window.__game; const s = g.ctx.layout.spawns.find((x) => x.id === ${JSON.stringify(spot)}); if (!s) return false; g.goto(s.pos[0], s.pos[1], s.pos[2] - 1.65, s.yaw, s.pitch ?? 0); return true; })()`);
    qa.assert(ok, `spawn ${spot} exists`);
    await qa.wait(Number(process.env.QA_SETTLE ?? 4));
  }
  const go = process.env.QA_GOTO;
  if (go) {
    const [x, y, z, h = Math.PI / 2, p = 0] = go.split(',').map(Number);
    await qa.eval(`(() => { window.__game.goto(${x}, ${y}, ${z}, ${h}, ${p}); return true; })()`);
    await qa.wait(Number(process.env.QA_SETTLE ?? 4)); // room visibility / streaming / first-sight pipeline compiles
    qa.log(`goto ${go}`);
  }
  const sample = async () =>
    qa.eval(`(async () => {
      const g = window.__game;
      g.loop.stop();
      const info = g.renderer.info;
      const auto = info.autoReset;
      info.autoReset = false;
      info.reset();
      await g.advance(1, 1 / 60);
      const r = { drawCalls: info.render.drawCalls, triangles: info.render.triangles, frameCalls: info.render.frameCalls,
        programs: info.memory.programs, textures: info.memory.textures, geometries: info.memory.geometries,
        texturesMB: +(info.memory.texturesSize / 1048576).toFixed(1),
        pixelRatio: g.renderer.getPixelRatio(), room: g.room(), pos: g.pos().map((v) => +v.toFixed(2)),
        visibleRooms: g.level.visible.size };
      info.autoReset = auto;
      g.loop.start();
      return r;
    })()`);
  const a = await sample();
  await qa.wait(0.5);
  const b = await sample();
  const pick = a.drawCalls >= b.drawCalls ? a : b; // the heavier of two frames (lightning / flicker vary)
  qa.report.renderInfo = pick;
  qa.log(`renderInfo ${JSON.stringify(pick)}`);
}
