// Beam aim vs camera: where does the torch beam point relative to the view (the arms' beam bone drives it)?
//   node scripts/shot.mjs --scenario scripts/qa/diag-beam.mjs --preset medium --beat B08 --dist scratch/dist-b08 --no-build --wait 2 --shots 0
export default async function (qa) {
  await qa.game('loop.stop()');
  const r = await qa.eval(`(async () => {
    const g = window.__game;
    const L = g.rig.flashlight.light;
    const cam = g.camera ?? null;
    const out = [];
    g.goto(6.1, 4.0, 4.1, Math.PI / 2, 0);
    if (!g.rig.on) g.rig.setOn(true);
    const V = (o) => { const e = o.matrixWorld.elements; return [e[12], e[13], e[14]]; };
    for (let k = 0; k < 12; k++) {
      await g.advance(15, 1/30);
      L.updateMatrixWorld(true); L.target.updateMatrixWorld(true);
      const a = V(L), b = V(L.target);
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const n = Math.hypot(...d); d.forEach((v, i) => (d[i] = v / n));
      // camera forward (world): heading π/2 → plan +y → world -z; pitch 0
      const pitchDeg = Math.asin(d[1]) * 180 / Math.PI;
      const yawDeg = Math.atan2(d[0], -d[2]) * 180 / Math.PI; // 0 = straight ahead (world -z), + = right (east)
      const hd = g.level.collision.rayDistance(new L.position.constructor(...a), new L.position.constructor(...d), 14);
      out.push('hit=' + (Number.isFinite(hd) ? hd.toFixed(2) : 'none') + ' t=' + g.ctx.time.now.toFixed(1) + ' lens(world)=' + a.map((v) => v.toFixed(2)) + ' yaw=' + yawDeg.toFixed(1) + '° pitch=' + pitchDeg.toFixed(1) + '° angle=' + (L.angle * 180 / Math.PI).toFixed(1));
    }
    return out;
  })()`);
  qa.report.diag = r;
  for (const l of r) qa.log(l);
}
