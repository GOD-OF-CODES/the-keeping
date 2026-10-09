// QA probe (reviewer round E, ruling c) — try to climb every piece of furniture: from 8 directions at 1.3 m, walk
// (and on alternate angles sprint, and on others crouch) into the prop for 2.5 s at 30 fps, and on every other direction again at 144 fps.
// Records the highest feet rise above the room floor and whether the player could walk back out (stuck check).
//   node scripts/shot.mjs --scenario scripts/qa/climb-probe.mjs --preset medium --beat B10 --dist <dir> --wait 2 --shots 0
const TARGETS = {
  G1: [['P_HALL_TABLE', 3.33, 4.2]],
  G2: [['P_SAWBUCK', 5.6, 3.3], ['P_ROCKER', 7.4, 4.95], ['P_STOOL', 5.3, 0.75], ['P_BUCKET', 6.25, 2.5], ['P_MANTEL', 8.3, 3.0]],
  G3: [['P_KITCHEN_TABLE', 6.6, 9.5], ['P_KITCHEN_CHAIR_1', 5.9, 9.55], ['P_KITCHEN_CHAIR_2', 6.95, 10.3], ['P_STOVE', 7.4, 6.75], ['P_PUMP_SINK', 8.2, 8.4], ['P_JERRY', 4.2, 7.6], ['P_HATCH', 5.5, 8.2]],
  U2: [['P_BED', 7.6, 3.5], ['P_NIGHTSTAND', 6.55, 4.22], ['P_SACK_CHAIR', 8.05, 0.75]],
  U3: [['P_SHEET_CHAIR', 4.6, 5.4], ['P_SHEET_TREADLE', 6.3, 5.15], ['P_SHEET_TRUNK', 7.8, 5.2], ['P_SEW_BASKET', 7.25, 8.3], ['P_DRESS', 8.15, 7.2]],
};
export default async function (qa) {
  const rooms = String(process.env.ROOMS ?? 'G1,G2,G3,U2,U3').split(',');
  const list = rooms.flatMap((r) => (TARGETS[r] ?? []).map((t) => [...t, r]));
  const r = await qa.eval(`(async () => {
    const g = window.__game; const out = []; const f = (v) => +v.toFixed(2);
    const st = () => g.storyState();
    for (let i = 0; i < 900 && (st().dead || g.director.cutscene); i++) await g.advance(1, 1/30);
    g.brain.setScripted?.('hidden');
    for (const d of ['D_PARLOR', 'D_PASSAGE', 'D_BACKSTAIR', 'D_ADA', 'D_HARLAN', 'D_DRESSING']) { try { g.openDoor(d, true); } catch (e) {} }
    await g.advance(45, 1/30);
    for (const [id, x, y, room] of ${JSON.stringify(list)}) {
      const floor = room[0] === 'U' ? 4.1 : 0.6;
      let maxRise = -9, worst = null, tried = 0, stuck = [];
      for (let a = 0; a < 8; a++) {
        const ang = a * Math.PI / 4; const sx = x + 1.3 * Math.cos(ang), sy = y + 1.3 * Math.sin(ang);
        g.goto(sx, sy, floor, ang + Math.PI, 0); await g.advance(6, 1/30);
        const p0 = g.pos(); if (Math.abs(p0[2] - floor) > 0.05 || Math.hypot(p0[0] - sx, p0[1] - sy) > 0.3) continue;
        tried++;
        const keys = a % 3 === 1 ? ['KeyW', 'ShiftLeft'] : a % 3 === 2 ? ['KeyW', 'KeyC'] : ['KeyW'];
        for (const dt of (a % 2 ? [1/30] : [1/30, 1/144])) {
          g.goto(sx, sy, floor, ang + Math.PI, 0); await g.advance(4, 1/30);
          const n = Math.round(2.5 / dt);
          for (let i = 0; i < n; i++) {
            const p = g.pos(); g.look(Math.atan2(y - p[1], x - p[0]), 0);
            await g.advance(1, dt, keys);
            const rise = g.pos()[2] - floor;
            if (rise > maxRise) { maxRise = rise; worst = { a, dt: Math.round(1 / dt), keys: keys.join('+'), at: g.pos().map(f) }; }
          }
          // stuck check: can she walk back to the start?
          const pe = g.pos(); let ok = false;
          for (let i = 0; i < 90; i++) { const p = g.pos(); g.look(Math.atan2(sy - p[1], sx - p[0]), 0); await g.advance(1, 1/30, ['KeyW']); if (Math.hypot(p[0] - pe[0], p[1] - pe[1]) > 0.35) { ok = true; break; } }
          if (!ok) { for (const k of ['KeyS', 'KeyA', 'KeyD']) { for (let i = 0; i < 30; i++) await g.advance(1, 1/30, [k]); const p = g.pos(); if (Math.hypot(p[0] - pe[0], p[1] - pe[1]) > 0.2) { ok = true; break; } } }
          if (!ok) stuck.push({ a, dt: Math.round(1 / dt), at: pe.map(f) });
        }
      }
      out.push({ id, room, tried, maxRise: f(maxRise), worst, stuck });
    }
    return out;
  })()`);
  for (const x of r) qa.log(JSON.stringify(x));
  qa.report.climb = r;
  for (const x of r) {
    qa.assert(x.tried >= 3, `${x.id}: approached from ${x.tried} directions`);
    qa.assert(x.maxRise < 0.28, `${x.id}: not climbable (max feet rise ${x.maxRise} m, ${JSON.stringify(x.worst)})`);
    qa.assert(x.stuck.length === 0, `${x.id}: never stuck after pushing into it (${JSON.stringify(x.stuck)})`);
  }
}
