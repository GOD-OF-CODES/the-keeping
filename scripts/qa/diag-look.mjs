// B08 stall #2: Ada 0.7 m from the player at the bell, torch on → endless LOOK, never sees / bumps. Why?
//   node scripts/shot.mjs --scenario scripts/qa/diag-look.mjs --preset medium --beat B08 --dist scratch/dist-b08 --no-build --wait 2 --shots 0
export default async function (qa) {
  await qa.game('loop.stop()');
  const r = await qa.eval(`(async () => {
    const g = window.__game;
    const b = g.brain;
    const out = [];
    g.goto(6.1, 3.84, 4.1, Math.PI / 2, 0);
    if (!g.rig.on) g.rig.setOn(true);
    await g.advance(5, 1/30);
    b.graceT = -Infinity;
    b.nav.pos = [5.6, 4.27, 4.1]; b.nav.room = 'U2'; b.nav.route = []; b.nav.goalKey = '';
    const f = (v) => v.toFixed(2);
    for (let k = 0; k < 24; k++) {
      await g.advance(15, 1/30);
      const cam = g.camera ?? g.ctx?.camera;
      let pe = null;
      if (cam) { cam.updateMatrixWorld(true); const e = cam.matrixWorld.elements; pe = [e[12], -e[14], e[13]]; }
      const eye = b.eye();
      const los = pe ? b.world.lineOfSight(eye, pe) : null;
      const yawTo = pe ? Math.atan2(pe[1] - eye[1], pe[0] - eye[0]) : 0;
      out.push('t=' + g.ctx.time.now.toFixed(1) + ' ' + b.state + ' look=' + (b.look ? b.look.reason + '/' + b.look.phase : '-') + ' head=' + b.head + ' ada=' + b.nav.pos.map(f) + ' eye=' + eye.map(f) + ' pEye=' + (pe ? pe.map(f) : '?') + ' los=' + los + ' lookYaw=' + f(b.lookYawNow) + ' yawTo=' + f(yawTo) + ' me=' + g.pos().map(f) + ' lure=' + (b.lure ? b.lure.phase : '-'));
    }
    return out;
  })()`);
  qa.report.diag = r;
  for (const l of r) qa.log(l);
}
