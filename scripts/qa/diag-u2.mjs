// B08 diagnosis: which collider sources sit on the U2 route (u2_mid → u2_west → u2_ledger → u2_bell), can the real
// controller walk it, and what does Ada's sight / the interaction ray see from the bell.
//   node scripts/shot.mjs --scenario scripts/qa/diag-u2.mjs --preset medium --beat B08 --dist scratch/dist-b08 --wait 2 --shots 0
export default async function (qa) {
  await qa.game('loop.stop()');
  const r = await qa.eval(`(async () => {
    const g = window.__game;
    const out = {};
    const T = window.__THREE__ ?? null;
    // world AABB per collider source mesh, filtered to the U2 corridor (plan x 4.4..7.2, y 2.4..4.6, z 4.1..6)
    const root = g.level.collision.debugGroup;
    root.updateMatrixWorld(true);
    const hits = [];
    root.traverse((m) => {
      if (!m.isMesh) return;
      const pos = m.geometry.attributes.position;
      let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      const e = m.matrixWorld.elements;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
        const p = [wx, -wz, wy]; // world → plan
        for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
      }
      if (mx[0] < 4.5 || mn[0] > 7.0 || mx[1] < 2.5 || mn[1] > 4.5 || mx[2] < 4.2 || mn[2] > 5.9) return;
      if (mx[0] - mn[0] > 6 || mx[1] - mn[1] > 6) return; // whole-floor slabs
      hits.push(m.name + ' [' + mn.map((v) => v.toFixed(2)) + ']..[' + mx.map((v) => v.toFixed(2)) + '] tris=' + ((m.geometry.index ? m.geometry.index.count : pos.count) / 3));
    });
    out.colliders = hits;
    // walk the route with the real controller
    const walk = async (from, to) => {
      g.goto(from[0], from[1], from[2], Math.atan2(to[1] - from[1], to[0] - from[0]), 0);
      await g.advance(3, 1/30);
      let p = g.pos();
      for (let i = 0; i < 90; i++) {
        p = g.pos();
        if (Math.hypot(p[0] - to[0], p[1] - to[1]) < 0.2) break;
        g.look(Math.atan2(to[1] - p[1], to[0] - p[0]), 0);
        await g.advance(1, 1/30, ['KeyW']);
      }
      p = g.pos();
      return from.join(',') + ' -> ' + to.join(',') + ' : ended at ' + p.map((v) => v.toFixed(2)).join(',') + ' (miss ' + Math.hypot(p[0] - to[0], p[1] - to[1]).toFixed(2) + ' m)';
    };
    out.walks = [
      await walk([5.6, 2.6, 4.1], [5.2, 3.6, 4.1]),
      await walk([5.2, 3.6, 4.1], [6.3, 3.8, 4.1]),
      await walk([6.3, 3.8, 4.1], [6.1, 4.0, 4.1]),
      await walk([5.6, 2.6, 4.1], [6.3, 3.8, 4.1]),
    ];
    out.brain = g.brain.state;
    return out;
  })()`);
  qa.report.diag = r;
  for (const c of r.colliders) qa.log('collider ' + c);
  for (const w of r.walks) qa.log('walk ' + w);
}
