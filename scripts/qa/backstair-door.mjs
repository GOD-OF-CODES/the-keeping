// QA probe (reviewer round E, ruling d) — the back-stair door CLOSED: come down ST_BACK, open D_BACKSTAIR with E like a
// player, walk into the kitchen centre; close it behind (from 0.9 m, and from inside the doorway); re-open it from the
// kitchen side while standing right in front of the leaf (it swings into G3, toward the player). After each step the
// capsule must still move (escape test) and must not have been lifted (> 0.28 m) or pushed through the wall.
//   node scripts/shot.mjs --scenario scripts/qa/backstair-door.mjs --preset medium --beat B10 --dist <dir> --wait 2 --shots 0
export default async function (qa) {
  const r = await qa.eval(`(async () => {
    const g = window.__game; const out = []; const f = (v) => +v.toFixed(2);
    const st = () => g.storyState();
    for (let i = 0; i < 900 && (st().dead || g.director.cutscene); i++) await g.advance(1, 1/30);
    g.brain.setScripted?.('hidden');
    const D = g.level?.doors ?? g.ctx?.systems?.get?.('level')?.doors;
    const isOpen = () => (g.brain.doors ? g.brain.doors('D_BACKSTAIR') : '?');
    const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const walk = async (to, maxS) => { let s = 0, last = g.pos(); for (let i = 0; i < maxS * 30; i++) { const p = g.pos(); if (d2(p, to) < 0.2) return true; g.look(Math.atan2(to[1] - p[1], to[0] - p[0]), 0); await g.advance(1, 1/30, ['KeyW']); const q = g.pos(); if (d2(q, last) < 0.002) { if (++s > 30) return false; } else s = 0; last = q; } return false; };
    // a real key press: advance(keys) only holds keys down, the door's E is an edge (input.wasPressed)
    const pressE = async (yaw, pitch) => { g.look(yaw, pitch); await g.advance(2, 1/30); const pr = g.advance(40, 1/30); /* advance() yields after 20 frames while it counts as unpaused: press E there */ document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e' })); await pr; document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE', key: 'e' })); await g.advance(10, 1/30); };
    const escape = async () => { const p0 = g.pos(); let ok = 0; for (let k = 0; k < 8; k++) { g.look(k * Math.PI / 4, 0); for (let i = 0; i < 20; i++) await g.advance(1, 1/30, ['KeyW']); if (d2(g.pos(), p0) > 0.12) ok++; g.goto(p0[0], p0[1], p0[2], 0, 0); await g.advance(2, 1/30); } return ok; };
    const S = (name, extra = {}) => { const p = g.pos(); out.push({ step: name, door: isOpen(), pos: p.map(f), ...extra }); };
    if (isOpen() !== 'closed') { g.closeDoor?.('D_BACKSTAIR', true); await g.advance(60, 1/30); }
    S('start (closed)');
    // 1. down the stair onto the foot step, facing the closed door
    g.goto(5.0, 11.2, 4.1, 0, 0); await g.advance(6, 1/30);
    const down = await walk([8.3, 11.3], 12); S('down the stair', { reached: down });
    await pressE(-Math.PI / 2, -0.25); S('E on the door from the foot step');
    const thru = (await walk([8.4, 10.2], 6)) && (await walk([7.6, 9.75], 6)) && (await walk([6.3, 9.0], 6));
    S('walk into kitchen centre', { reached: thru, maxRiseOk: g.pos()[2] < 0.6 + 0.28 });
    // 2. close behind from 0.9 m in the kitchen
    g.goto(8.35, 9.9, 0.6, 0, 0); await g.advance(6, 1/30);
    await pressE(Math.PI / 2, 0.05); S('E close from 0.9 m', { escape: await escape() });
    // 3. open from the kitchen side hugging the leaf (it swings toward the player)
    g.goto(8.3, 10.45, 0.6, 0, 0); await g.advance(6, 1/30);
    const p3 = g.pos(); await pressE(Math.PI / 2, 0.05);
    S('E open from 0.35 m in front of the leaf', { pushed: f(d2(g.pos(), p3)), z: f(g.pos()[2]), escape: await escape() });
    // 4. stand in the doorway and close it (leaf sweeps through the capsule)
    g.goto(8.35, 10.8, 0.6, 0, 0); await g.advance(6, 1/30);
    const p4 = g.pos(); await pressE(0, -0.1); await pressE(Math.PI, -0.1);
    S('E close while standing in the doorway', { pushed: f(d2(g.pos(), p4)), z: f(g.pos()[2]), escape: await escape() });
    // 5. back up the stair with the door closed (open from kitchen at a normal distance)
    g.goto(8.35, 9.9, 0.6, 0, 0); await g.advance(6, 1/30);
    if (isOpen() === 'closed') await pressE(Math.PI / 2, 0.05);
    const up = (await walk([8.35, 10.6], 5)) && (await walk([8.3, 11.3], 5)) && (await walk([5.0, 11.2], 12));
    S('back up the stair', { reached: up, z: f(g.pos()[2]) });
    return out;
  })()`);
  for (const x of r) qa.log(JSON.stringify(x));
  qa.report.backstairDoor = r;
  for (const x of r) {
    if ('reached' in x) qa.assert(x.reached, `${x.step}: reached (${x.pos})`);
    if ('escape' in x) qa.assert(x.escape > 0, `${x.step}: not wedged (${x.pos})`);
  }
}
