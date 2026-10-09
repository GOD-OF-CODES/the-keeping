// QA probe — the real C2 → B04 handover (ROADMAP difficulty: nobody is caught within 6 s after a cutscene).
//   node scripts/shot.mjs --scenario scripts/qa/c2-handover.mjs --preset low --beat B03 --dist <dir> --wait 2 --shots 0
// Plays C2 for real (walk onto the parlor threshold in B03), then from the frame control returns measures: her
// distance, the time to her first move, and — for a player frozen by the reveal (no keys at all) — the time to the
// catch. Asserts no catch within 6 s of control returning. MODE=flee also runs a player who turns and runs for the
// stair after a 1 s freeze (second session; the death respawn replays C2, so one mode per session).
export default async function (qa) {
  const mode = process.env.MODE ?? 'freeze';
  const r = await qa.eval(`(async () => {
    const g = window.__game; const out = {}; const f = (v) => +v.toFixed(2);
    const st = () => g.storyState();
    const cs = () => !!g.director.cutscene || !!g.cutscenes?.player?.active;
    for (let i = 0; i < 900 && cs(); i++) await g.advance(1, 1/30);
    out.startBeat = st().beat;
    // walk in through the front door and onto the parlor threshold (3.1, 1.5) like a player
    const legs = [[1.8, -1.5], [1.8, 0.6], [3.1, 1.5]];
    let i = 0, k = 0;
    for (; i < 30 * 40 && !cs(); i++) {
      const p = g.pos(); const to = legs[Math.min(k, legs.length - 1)];
      if (k < legs.length - 1 && Math.hypot(p[0] - to[0], p[1] - to[1]) < 0.3) { k++; continue; }
      g.look(Math.atan2(to[1] - p[1], to[0] - p[0]), 0);
      await g.advance(1, 1/30, Math.hypot(p[0] - to[0], p[1] - to[1]) > 0.2 ? ['KeyW'] : []);
    }
    out.walkS = +(i / 30).toFixed(1);
    out.c2Started = cs(); out.c2Id = g.director.cutscene;
    for (i = 0; i < 30 * 120 && cs(); i++) await g.advance(1, 1/30);
    out.c2PlayS = f(i / 30);
    const b = g.brain;
    const me0 = g.pos(); const a0 = [...b.nav.pos];
    out.atControl = { beat: st().beat, me: me0.map(f), ada: a0.map(f), adaRoom: b.nav.room, dist: f(Math.hypot(me0[0] - a0[0], me0[1] - a0[1])), state: b.state, calmLeft: f(Math.max(0, b.calmUntil - b.t)) };
    const d0 = st().deathsTotal;
    let moved = -1, caught = -1, minD = 99;
    const trace = [];
    for (i = 0; i < 30 * 20; i++) {
      let keys = [];
      if (${JSON.stringify(mode)} === 'flee' && i > 30) {
        const p = g.pos(); const s = [0.6, 3.3];
        g.look(Math.atan2(s[1] - p[1], s[0] - p[0]), 0);
        keys = Math.hypot(p[0] - s[0], p[1] - s[1]) > 0.3 ? ['KeyW', 'ShiftLeft'] : [];
      }
      await g.advance(1, 1/30, keys);
      const a = b.nav.pos; const p = g.pos();
      minD = Math.min(minD, Math.hypot(p[0] - a[0], p[1] - a[1]));
      if (moved < 0 && Math.hypot(a[0] - a0[0], a[1] - a0[1]) > 0.3) moved = i / 30;
      if (i % 15 === 0) trace.push((i / 30).toFixed(1) + ' ' + b.state + ' d=' + Math.hypot(p[0] - a[0], p[1] - a[1]).toFixed(2));
      if (st().deathsTotal > d0 || st().dead) { caught = i / 30; break; }
    }
    Object.assign(out, { mode: ${JSON.stringify(mode)}, firstMoveS: moved, caughtAtS: caught, minD: f(minD), trace });
    return out;
  })()`);
  qa.log(JSON.stringify(r));
  qa.report.c2handover = r;
  qa.assert(r.c2Started, 'C2 played from the real B03 threshold');
  qa.assert(r.caughtAtS < 0 || r.caughtAtS >= 6, `no catch within 6 s of control returning after C2 (caught at ${r.caughtAtS} s, mode ${r.mode})`);
}
