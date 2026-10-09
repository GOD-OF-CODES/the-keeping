// QA probe — back stair → kitchen lane (ROADMAP round E ruling d): with D_BACKSTAIR open, a player coming down ST_BACK
// walks into the kitchen centre on a ≥ 0.8 m clear lane, without climbing furniture.
//   node scripts/shot.mjs --scenario scripts/qa/backstair-lane.mjs --preset low --beat B10 --dist <dir> --wait 2 --shots 0
// Walks the real controller from the stair (8.35, 11.6, z 1.1) through the doorway to the kitchen centre (6.3, 9.0)
// on three parallel lines (lane centre and ± 0.27 m: a 0.54 m capsule on each edge line covers a 0.81 m lane) and on
// a direct line, and reports for each: reached, time, nearest-miss stall, max feet height above the kitchen floor.
export default async function (qa) {
  const r = await qa.eval(`(async () => {
    const g = window.__game; const out = []; const f = (v) => +v.toFixed(2);
    const st = () => g.storyState();
    for (let i = 0; i < 900 && (st().dead || g.director.cutscene); i++) await g.advance(1, 1/30);
    g.brain.setScripted?.('hidden'); // keep her out of the probe
    g.openDoor('D_BACKSTAIR', true); await g.advance(45, 1/30);
    const lines = {
      centre: [[8.40, 11.0, 0.6], [8.40, 10.2, 0.6], [7.6, 9.75, 0.6], [6.3, 9.0, 0.6]],
      east: [[8.62, 11.0, 0.6], [8.62, 10.2, 0.6], [7.75, 9.55, 0.6], [6.3, 9.0, 0.6]],
      west: [[8.18, 11.0, 0.6], [8.18, 10.2, 0.6], [7.45, 9.95, 0.6], [6.3, 9.0, 0.6]],
      direct: [[8.40, 10.6, 0.6], [6.3, 9.0, 0.6]],
    };
    for (const [name, pts] of Object.entries(lines)) {
      g.goto(8.35, 11.35, 1.1, -Math.PI / 2, 0); await g.advance(10, 1/30); const p0 = g.pos();
      let k = 0, i = 0, maxZ = -9, stuck = 0, lastP = g.pos(), stallAt = null;
      for (; i < 30 * 20 && k < pts.length; i++) {
        const p = g.pos(); const to = pts[k];
        if (Math.hypot(p[0] - to[0], p[1] - to[1]) < 0.25) { k++; continue; }
        g.look(Math.atan2(to[1] - p[1], to[0] - p[0]), 0);
        await g.advance(1, 1/30, ['KeyW']);
        const q = g.pos();
        if (q[1] < 10.6) maxZ = Math.max(maxZ, q[2]);
        if (Math.hypot(q[0] - lastP[0], q[1] - lastP[1]) < 0.004) { stuck++; if (stuck === 30) stallAt = q.map(f); } else stuck = 0;
        if (stuck > 90) break;
        lastP = q;
      }
      const p = g.pos();
      out.push({ line: name, start: p0.map(f), reached: k >= pts.length, t: f(i / 30), end: p.map(f), stallAt, maxFeetZ: f(maxZ) });
    }
    return out;
  })()`);
  for (const x of r) qa.log(JSON.stringify(x));
  qa.report.backstairLane = r;
  for (const x of r.filter((x) => x.line !== 'direct')) {
    qa.assert(x.reached, `back stair → kitchen centre along the ${x.line} line (end ${x.end}, stall ${x.stallAt})`);
    qa.assert(x.maxFeetZ < 0.6 + 0.28, `${x.line}: no furniture climbed (max feet z ${x.maxFeetZ})`);
  }
}
