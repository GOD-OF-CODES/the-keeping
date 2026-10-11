// QA judge scenario — B05: Ada carrying her head comes into the torch beam at 2–4 m (for the art-director look; B05 was
// never judged). PERF lane, fix round 3.
//   node scripts/shot.mjs --scenario scripts/qa/b05-carry.mjs --preset medium --beat B03 --dist <dir> --wait 2 --shots 0 --timeout 2400
// Walks onto the parlor threshold in B03 like a player, gives no input through C2 + C2c, then at the stair top (S, B05)
// switches the torch on and keeps the camera (and so the beam) on her chest as she returns. A still is taken as her
// chest crosses each of DISTS m from the eye (default 4, 3, 2.3) with her visible; stops before a catch. If she never
// comes that close within MAXS s (default 80) one still is taken at her closest visible approach. Env: DISTS, MAXS.
export default async function (qa) {
  const DISTS = (process.env.DISTS ?? '4,3,2.3').split(',').map(Number).sort((a, b) => b - a);
  const MAXS = +(process.env.MAXS ?? 80);
  await qa.game('loop.stop()');
  const pre = await qa.eval(`(async () => {
    const g = window.__game; const f = (v) => +v.toFixed(2);
    window.__ada = null;
    const orig = g.director.update.bind(g.director);
    g.director.update = (dt) => { const o = orig(dt); if (o) window.__ada = o; return o; };
    const active = () => g.cutscenes?.player?.active ?? g.director.cutscene ?? null;
    g.unpause?.();
    for (let i = 0; i < 900 && active(); i++) await g.advance(1, 1/30);
    const legs = [[1.8, -1.5], [1.8, 0.6], [3.1, 1.5]]; let k = 0;
    for (let i = 0; i < 30 * 40 && !active(); i++) {
      const p = g.pos(); const to = legs[Math.min(k, legs.length - 1)];
      if (k < legs.length - 1 && Math.hypot(p[0] - to[0], p[1] - to[1]) < 0.3) { k++; continue; }
      g.look(Math.atan2(to[1] - p[1], to[0] - p[0]), 0);
      await g.advance(1, 1/30, Math.hypot(p[0] - to[0], p[1] - to[1]) > 0.2 ? ['KeyW'] : []);
    }
    const chain = [];
    for (let i = 0; i < 30 * 90 && active(); i++) { const a = active(); if (chain[chain.length - 1] !== a) chain.push(a); await g.advance(1, 1/30); }
    const s = g.storyState();
    g.rig.setOn(true);
    window.__b05 = { t: 0, d0: s.deathsTotal, minD: 99, minAt: -1, next: 0, shots: [] };
    return { chain, beat: s.beat, brain: g.brain.scripted?.mode ?? null, me: g.pos().map(f), torch: g.rig.on };
  })()`);
  qa.log('B05 control ' + JSON.stringify(pre));
  qa.assert(pre.chain.includes('C2') && pre.chain.includes('C2c') && pre.beat === 'B05', `reached B05 through C2 → C2c (${pre.chain.join(' → ')}, ${pre.beat})`);
  const taken = [];
  let closest = null;
  for (let chunk = 0; chunk < 400; chunk++) {
    // advance until the next distance mark is crossed (or the time runs out / a catch), then shoot from the page state
    const r = JSON.parse(await qa.eval(`(async () => {
      const g = window.__game; const B = window.__b05; const f = (v) => +v.toFixed(2);
      const marks = ${JSON.stringify(DISTS)};
      for (let i = 0; i < 90; i++) {
        const a = window.__ada; const me = g.pos(); const eye = [me[0], me[1], me[2] + 1.65];
        let d = 99;
        if (a?.pos && a.visible) {
          const chest = [a.pos[0], a.pos[1], a.pos[2] + 1.25];
          const dx = chest[0] - eye[0], dy = chest[1] - eye[1], dz = chest[2] - eye[2];
          const h = Math.hypot(dx, dy); d = Math.hypot(h, dz);
          g.look(Math.atan2(dy, dx), Math.atan2(dz, h)); // camera + beam on her chest
        }
        await g.advance(1, 1/30);
        B.t += 1/30;
        const s = g.storyState();
        if (s.deathsTotal > B.d0 || s.dead) return JSON.stringify({ end: 'caught', t: f(B.t) });
        if (d < B.minD) { B.minD = d; B.minAt = B.t; }
        if (B.next < marks.length && d <= marks[B.next]) {
          const mark = marks[B.next]; B.next++;
          return JSON.stringify({ shot: mark, d: f(d), t: f(B.t), ada: a.pos.map(f), state: a.state, phase: a.phase ?? null, head: a.head ?? null, room: a.room ?? null, me: me.map(f), torch: g.rig.on, exp: g.look?.exposure?.()?.applied ?? null });
        }
        if (B.next >= marks.length) return JSON.stringify({ end: 'done', t: f(B.t) });
        if (B.t > ${MAXS}) return JSON.stringify({ end: 'timeout', t: f(B.t), minD: f(B.minD), minAt: f(B.minAt) });
      }
      return JSON.stringify({ t: f(B.t) });
    })()`));
    if (r.shot) {
      qa.log('B05 still ' + JSON.stringify(r));
      await qa.shot(`b05-carry-${r.shot}m`);
      taken.push(r);
      continue;
    }
    if (r.end) {
      qa.log('B05 end ' + JSON.stringify(r));
      if (r.end === 'timeout') closest = r;
      break;
    }
  }
  qa.report.b05Carry = { pre, taken, closest };
  qa.assert(taken.length > 0, `Ada came into the beam within ${DISTS[0]} m (${taken.length} stills; closest ${closest ? closest.minD + ' m' : 'n/a'})`);
  qa.assert(!taken.some((s) => !s.torch), 'the torch was on for every still');
}
