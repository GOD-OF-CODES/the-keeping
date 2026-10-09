// QA probe (reviewer round E) — respawn fairness for a player who WALKS OUT with the torch on (ruling b companion to
// respawn-idle.mjs). Per beat: die via the Director's catch path, wait for control, torch on, then walk at normal speed
// (no run, no crouch) along Ada's graph to a same-floor node ~10–14 m of path away (SEED picks among candidates;
// closed, unlocked doors on the way are opened as a player would), then idle until WALK_TOTAL_S (default 60).
// Reports catches, her nearest approach and the states she went through; a catch is listed with her state history so
// it can be judged (walking straight into her is the player's choice; a catch with no tell is not).
//   node scripts/shot.mjs --scenario scripts/qa/respawn-walk.mjs --preset medium --beat B06 --dist <dir> --wait 2 --shots 0
export default async function (qa) {
  const totalS = Number(process.env.WALK_TOTAL_S ?? 60);
  const walkMin = Number(process.env.WALK_MIN_M ?? 10);
  const seeds = String(process.env.SEEDS ?? '0,1').split(',').map(Number);
  const r = await qa.eval(`(async () => {
    const g = window.__game; const b = g.brain; const G = b.g;
    const st = () => g.storyState();
    const busy = () => st().dead || !!g.director.cutscene || !!g.cutscenes?.player?.active;
    const d2 = (a, c) => Math.hypot(a[0] - c[0], a[1] - c[1]);
    const f = (v) => v.toFixed(2);
    for (let i = 0; i < 1800 && busy(); i++) await g.advance(1, 1/30);
    await g.advance(60, 1/30);
    const results = [];
    for (const seed of ${JSON.stringify(seeds)}) {
      const d0 = st().deathsTotal;
      g.director.onAiEvent({ type: 'catch', cause: 'contact' });
      for (let k = 0; k < 900 && !busy(); k++) await g.advance(1, 1/30);
      for (let k = 0; k < 1800 && busy(); k++) await g.advance(1, 1/30);
      g.rig.setOn(true);
      // LOOK_AROUND=1: a first-timer's slow 360° torch sweep (8 s) right after control returns, before walking out
      if (${process.env.LOOK_AROUND === '1'}) { const y0 = g.yaw?.() ?? 0; for (let i = 0; i < 240; i++) { g.look(y0 + (i / 240) * Math.PI * 2, -0.05); await g.advance(1, 1/30); } }
      const me0 = g.pos(); const cp = st().checkpoint; const a0 = [...b.nav.pos];
      const doors = b.doors;
      const start = G.nearestNode(me0, (n) => Math.abs(n.pos[2] - me0[2]) < 1.5);
      const dist = start ? G.distances(start.id, doors) : new Map();
      const cands = [...dist.entries()].filter(([id, c]) => c >= ${walkMin} && c <= 14 && Math.abs(G.node(id).pos[2] - me0[2]) < 1.5).map(([id]) => id).sort();
      const target = cands.length ? cands[seed % cands.length] : null;
      const path = target ? G.path(start.id, target, doors) : null;
      const pts = path ? path.nodes.map((id) => G.node(id).pos) : [];
      if (path) for (let i = 1; i < path.nodes.length; i++) { const e = G.edgeBetween(path.nodes[i - 1], path.nodes[i]); if (e && e.doorId && doors(e.doorId) === 'closed') g.openDoor(e.doorId); }
      let k = 0, minD = 99, caught = -1, stuck = 0, last = g.pos(), stuckAt = null, lastState = '';
      const hist = [];
      for (let i = 0; i < ${totalS} * 30; i++) {
        const p = g.pos(); let keys = [];
        if (k < pts.length) {
          const to = pts[k];
          if (d2(p, to) < 0.4) k++;
          else { g.look(Math.atan2(to[1] - p[1], to[0] - p[0]), -0.05); keys = ['KeyW']; }
        }
        await g.advance(1, 1/30, keys);
        const q = g.pos(); const a = b.nav.pos;
        if (keys.length) { if (d2(q, last) < 0.003) { if (++stuck === 45) stuckAt = q.map(f); if (stuck > 90) k++; } else stuck = 0; }
        last = q;
        if (Math.abs(a[2] - q[2]) < 2) minD = Math.min(minD, d2(a, q));
        const s = b.state + (b.look ? ':' + b.look.reason : '');
        if (s !== lastState) { hist.push((i / 30).toFixed(1) + ' ' + s + ' d=' + f(d2(a, q))); lastState = s; }
        if (caught < 0 && st().deathsTotal > d0 + 1) caught = i / 30;
        if (caught >= 0 && busy()) break;
      }
      results.push({ beat: st().beat, cp, seed, target, pathNodes: path ? path.nodes.length : 0, reachedAll: k >= pts.length, stuckAt, me0: me0.map(f), ada0: a0.map(f), minD: f(minD), caughtAtS: caught, hist: hist.slice(0, 24).join(' | ') });
      for (let i = 0; i < 1800 && busy(); i++) await g.advance(1, 1/30);
    }
    return results;
  })()`);
  for (const x of r) qa.log(JSON.stringify(x));
  qa.report.respawnWalk = r;
  for (const x of r) qa.assert(x.caughtAtS < 0, `${x.beat} ${x.cp} seed ${x.seed}: walk-out torch-on ${totalS} s after the respawn without a catch (caught at ${x.caughtAtS} s; ${x.hist})`);
}
