// QA probe — C2-ESCAPE §8.3: the real C2 → C2c → B05 handover at the stair top.
//   node scripts/shot.mjs --scenario scripts/qa/c2c-handover.mjs --preset medium --beat B03 --dist <dir> --wait 2 --shots 0
// Walks onto the parlor threshold in B03 like a player, then gives NO input through C2 + C2c, and from the frame
// control returns (at S, the stair top) measures her return below. MODE (one per session):
//   idle (default) — stand at S for 60 s: no catch; she holds blind at tread 10 until +45 s, then tops the stair;
//   u2             — run into Harlan's room (U2) instead of hiding: no catch within 60 s;
//   hide           — walk to the armoire and hide: the slat demo plays (unfailable), no catch.
// Every mode: the chain C2 → C2c, control at S ± 0.1 m with pitch −0.87 ± 0.02 (layout CP2), beat B05, brain
// `b05_return`, her first appearance ≥ 10 s after control.
export default async function (qa) {
  const mode = process.env.MODE ?? 'idle';
  const r = await qa.eval(`(async () => {
    const g = window.__game; const out = {}; const f = (v) => +v.toFixed(2);
    let adaOut = null;
    const orig = g.director.update.bind(g.director);
    g.director.update = (dt) => { const o = orig(dt); if (o) adaOut = o; return o; };
    const st = () => g.storyState();
    const active = () => g.cutscenes?.player?.active ?? g.director.cutscene ?? null;
    for (let i = 0; i < 900 && active(); i++) await g.advance(1, 1/30);
    // walk onto the parlor threshold (3.1, 1.5)
    const legs = [[1.8, -1.5], [1.8, 0.6], [3.1, 1.5]];
    let i = 0, k = 0;
    for (; i < 30 * 40 && !active(); i++) {
      const p = g.pos(); const to = legs[Math.min(k, legs.length - 1)];
      if (k < legs.length - 1 && Math.hypot(p[0] - to[0], p[1] - to[1]) < 0.3) { k++; continue; }
      g.look(Math.atan2(to[1] - p[1], to[0] - p[0]), 0);
      await g.advance(1, 1/30, Math.hypot(p[0] - to[0], p[1] - to[1]) > 0.2 ? ['KeyW'] : []);
    }
    // C2 + C2c with no input at all
    const chain = [];
    const d0 = st().deathsTotal;
    for (i = 0; i < 30 * 90 && active(); i++) {
      const a = active();
      if (chain[chain.length - 1] !== a) chain.push(a);
      await g.advance(1, 1/30);
    }
    out.chain = chain; out.lockS = f(i / 30);
    const cp2 = g.ctx.layout.spawns.find((s) => s.id === 'CP2');
    const me0 = g.pos();
    out.atControl = { beat: st().beat, me: me0.map(f), pitch: f(g.player?.pitch ?? NaN), cp2: cp2.pos, cp2Pitch: cp2.pitch, brain: g.brain.scripted?.mode ?? null, deaths: st().deathsTotal - d0 };
    // after control
    const b = g.brain;
    let firstSeen = -1, caught = -1, blindAt = -1, blindEnd = -1, topAt = -1, hid = -1, demoDone = -1;
    const trace = [];
    const target = ${JSON.stringify(mode)} === 'u2' ? [[0.55, 8.3], [2.0, 8.35], [2.4, 6.3], [2.55, 4.2], [3.15, 3.0], [4.6, 3.0]] : [[0.55, 8.3], [2.0, 8.35], [2.4, 6.3], [2.55, 4.2]];
    let leg = 0;
    for (i = 0; i < 30 * 60; i++) {
      const t = i / 30;
      let keys = [];
      if (${JSON.stringify(mode)} !== 'idle' && leg < target.length && hid < 0) {
        const p = g.pos(); const to = target[leg];
        if (Math.hypot(p[0] - to[0], p[1] - to[1]) < 0.3) leg++;
        else { g.look(Math.atan2(to[1] - p[1], to[0] - p[0]), 0); keys = ${JSON.stringify(mode)} === 'u2' ? ['KeyW', 'ShiftLeft'] : ['KeyW']; }
        if (leg >= target.length && ${JSON.stringify(mode)} === 'hide' && hid < 0) { g.hides.enter('H_ARMOIRE'); hid = t; }
      }
      await g.advance(1, 1/30, keys);
      const vis = !!adaOut?.visible;
      if (firstSeen < 0 && vis) firstSeen = f(t);
      const ph = b.scripted?.mode === 'b05_return' ? b.scripted.phase : null;
      if (ph === 'blind_wait' && blindAt < 0) blindAt = f(t);
      if (blindAt >= 0 && blindEnd < 0 && ph !== 'blind_wait') blindEnd = f(t);
      if (topAt < 0 && blindEnd >= 0 && !b.scripted) topAt = f(t);
      if (hid >= 0 && demoDone < 0 && st().flags?.first_hide_done) demoDone = f(t);
      if (i % 60 === 0) { const a = b.nav.pos; const p = g.pos(); trace.push(t.toFixed(0) + ' ' + b.state + '/' + (ph ?? '-') + ' ada ' + a.map(f).join(',') + ' me ' + p.map(f).join(',')); }
      if (st().deathsTotal > d0 || st().dead) { caught = f(t); break; }
    }
    Object.assign(out, { mode: ${JSON.stringify(mode)}, firstSeen, caught, blindAt, blindEnd, topAt, hid, demoDone, beatEnd: st().beat, trace });
    return out;
  })()`);
  qa.log(JSON.stringify(r));
  qa.report.c2cHandover = r;
  const c = r.atControl;
  qa.assert(r.chain[0] === 'C2' && r.chain.includes('C2c') && r.chain.indexOf('C2c') > 0, `the chain C2 → C2c (${r.chain.join(' → ')})`);
  qa.assert(c.deaths === 0, 'no death through C2 + C2c');
  qa.assert(c.beat === 'B05' && c.brain === 'b05_return', `B05 with b05_return at control (${c.beat}, ${c.brain})`);
  qa.assert(Math.hypot(c.me[0] - c.cp2[0], c.me[1] - c.cp2[1]) <= 0.1 && Math.abs(c.me[2] - (c.cp2[2] - 1.65)) <= 0.1, `control at S ± 0.1 m (${c.me} vs ${c.cp2})`);
  qa.assert(!Number.isFinite(c.pitch) || Math.abs(c.pitch - c.cp2Pitch) <= 0.02, `pitch −0.87 ± 0.02 (${c.pitch})`);
  qa.assert(r.caught < 0, `no catch within 60 s (mode ${r.mode}, caught at ${r.caught} s)`);
  qa.assert(r.firstSeen < 0 || r.firstSeen >= 9.9, `her first appearance ≥ 10 s after control (${r.firstSeen} s)`);
  if (r.mode === 'idle') qa.assert(r.blindAt > 0 && r.blindEnd >= 44.9, `she holds blind at tread 10 until +45 s (${r.blindAt} → ${r.blindEnd})`);
  if (r.mode === 'hide') qa.assert(r.demoDone > 0, `the slat demo finished (${r.demoDone} s)`);
}
