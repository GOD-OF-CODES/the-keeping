// QA probe (reviewer round E) — stuck spots: with the real controller, walk from a room node into every corner and
// through every doorway of each interior room (centre line and both jambs, doors opened), climb/descend both stairs on
// three lateral lines, at 30 fps (and 144 fps for the stairs). After every push, an escape test tries 8 directions;
// a spot where no direction moves the capsule ≥ 0.12 m is STUCK.
//   node scripts/shot.mjs --scenario scripts/qa/wedge-probe.mjs --preset medium --beat B10 --dist <dir> --wait 2 --shots 0
export default async function (qa) {
  const rooms = String(process.env.ROOMS ?? 'G1,G2,G3,G3P,CLOSET,U1,U2,U3,U4T').split(',').filter(Boolean);
  const r = await qa.eval(`(async () => {
    const g = window.__game; const G = g.brain.g; const L = G.layout; const out = []; const f = (v) => +v.toFixed(2);
    const st = () => g.storyState();
    for (let i = 0; i < 900 && (st().dead || g.director.cutscene); i++) await g.advance(1, 1/30);
    g.brain.setScripted?.('hidden');
    for (const d of L.doors) { try { g.openDoor(d.id, true); } catch (e) {} }
    await g.advance(60, 1/30);
    const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const walk = async (to, maxS, dt = 1/30, keys = ['KeyW']) => {
      let stuck = 0, last = g.pos();
      for (let i = 0; i < maxS / dt; i++) {
        const p = g.pos(); if (d2(p, to) < 0.2) return true;
        g.look(Math.atan2(to[1] - p[1], to[0] - p[0]), 0); await g.advance(1, dt, keys);
        const q = g.pos(); if (d2(q, last) < 0.002) { if (++stuck > 1 / dt) return false; } else stuck = 0; last = q;
      }
      return false;
    };
    const escape = async () => {
      const p0 = g.pos(); let ok = 0;
      for (let k = 0; k < 8; k++) {
        const pk = g.pos(); g.look(k * Math.PI / 4, 0);
        for (let i = 0; i < 20; i++) await g.advance(1, 1/30, ['KeyW']);
        if (d2(g.pos(), pk) > 0.12) ok++;
        g.goto(p0[0], p0[1], p0[2], 0, 0); await g.advance(2, 1/30);
      }
      return ok;
    };
    const openings = [];
    for (const w of L.walls) for (const o of (w.openings || [])) {
      if (o.kind !== 'door' && o.kind !== 'opening' && o.kind !== 'arch') continue;
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]); const ux = (w.b[0] - w.a[0]) / len, uy = (w.b[1] - w.a[1]) / len;
      openings.push({ id: o.id, w, c: [w.a[0] + ux * o.offset, w.a[1] + uy * o.offset], u: [ux, uy], n: [-uy, ux], width: o.width });
    }
    for (const room of ${JSON.stringify(rooms)}) {
      const R = L.rooms.find((x) => x.id === room); if (!R) continue;
      const z = G.elevationOfRoom(room);
      const node = L.aiNodes.find((n) => n.room === room);
      const r0 = R.rect; const home = node ? node.pos : [(r0[0] + r0[2]) / 2, (r0[1] + r0[3]) / 2, z];
      const tests = [];
      for (const [cx, cy] of [[r0[0], r0[1]], [r0[2], r0[1]], [r0[0], r0[3]], [r0[2], r0[3]]]) tests.push({ name: 'corner ' + f(cx) + ',' + f(cy), pts: [[cx + Math.sign(home[0] - cx) * 0.05, cy + Math.sign(home[1] - cy) * 0.05]] });
      for (const o of openings) {
        if (o.w.left !== room && o.w.right !== room) continue;
        const side = o.w.left === room ? 1 : -1;
        for (const off of [0, -0.33, 0.33]) {
          const s = (k) => [o.c[0] + o.u[0] * off * o.width + o.n[0] * k * side, o.c[1] + o.u[1] * off * o.width + o.n[1] * k * side];
          tests.push({ name: o.id + ' ' + off, pts: [s(0.7), s(-0.8)], through: true });
        }
      }
      for (const t of tests) {
        g.goto(home[0], home[1], z, 0, 0); await g.advance(4, 1/30);
        if (Math.abs(g.pos()[2] - z) > 0.3) { out.push({ room, t: t.name, skip: 'home z ' + f(g.pos()[2]) }); continue; }
        let reached = true;
        for (const p of t.pts) reached = (await walk(p, 8)) && reached;
        const end = g.pos(); const dirs = await escape();
        out.push({ room, t: t.name, reached, end: end.map(f), escapeDirs: dirs });
      }
    }
    // stairs: three lateral lines, up and down, 30 and 144 fps
    const stairs = { main: [[0.6, 3.0, 0.6], [0.55, 3.6, 0.6], [0.55, 8.2, 4.1], [1.6, 8.4, 4.1]], back: [[8.45, 9.95, 0.6], [8.35, 11.35, 1.1], [5.0, 11.2, 4.1], [5.0, 9.8, 4.1]] };
    if (${process.env.STAIRS !== '0'}) for (const [name, pts] of Object.entries(stairs)) for (const lat of [0, -0.3, 0.3]) for (const dt of [1/30, 1/144]) for (const dir of ['up', 'down']) {
      const P = dir === 'up' ? pts : [...pts].reverse();
      g.goto(P[0][0], P[0][1], P[0][2], 0, 0); await g.advance(6, 1/30);
      let ok = true;
      for (let k = 1; k < P.length; k++) { const a = P[k - 1], b = P[k]; const L2 = d2(a, b) || 1; const nx = -(b[1] - a[1]) / L2, ny = (b[0] - a[0]) / L2; const l = (k === 1 || k === P.length - 1) ? 0 : lat; ok = (await walk([b[0] + nx * l, b[1] + ny * l], 10, dt)) && ok; }
      const end = g.pos();
      out.push({ room: 'stair', t: name + ' ' + dir + ' lat ' + lat + ' fps ' + Math.round(1 / dt), reached: ok && Math.abs(end[2] - P[P.length - 1][2]) < 0.3, end: end.map(f), escapeDirs: await escape() });
    }
    return out;
  })()`);
  for (const x of r) if (x.skip || !x.reached || x.escapeDirs < 2) qa.log('FLAG ' + JSON.stringify(x));
  qa.log('tests ' + r.length + ', stuck (escape 0) ' + r.filter((x) => x.escapeDirs === 0).length + ', unreached ' + r.filter((x) => !x.skip && !x.reached).length);
  qa.report.wedge = r;
  for (const x of r) if (!x.skip) qa.assert(x.escapeDirs > 0, `${x.room} ${x.t}: not wedged (end ${x.end})`);
}
