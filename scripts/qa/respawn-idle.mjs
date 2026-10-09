// QA probe — respawn fairness (ROADMAP round E ruling b): after a death an idle player must survive ≥ 60 s at the
// respawn point of every checkpoint. One shot.mjs session per beat (the beat picks the checkpoint):
//
//   for b in B02 B05 B06 B08 B09 B10 B11 B12; do
//     node scripts/shot.mjs --scenario scripts/qa/respawn-idle.mjs --preset low --beat $b --dist <dir> \
//          --wait 2 --shots 0 --timeout 1200 --out scratch/qa --name ri-$b
//   done
//   (B02→CP1 B05→CP2 B06→CP3 B08→CP4 B09→CP5 B10→CP6 B11→CP7 B12→CP8; B04 is the scripted C2 chase — exempt)
//
// Each session dies twice through the story's own catch path (the Director's AI-event handler, so it also works where
// she is offstage), once with the torch off and once on, waits for control to return (death cutaway + respawn fade),
// then idles IDLE_S (default 60) seconds without touching a key. Asserts 0 further deaths; logs her nearest approach,
// the states she went through and the time from control return to her first move.
export default async function (qa) {
  const idleS = Number(process.env.IDLE_S ?? 60);
  const r = await qa.eval(`(async () => {
    const g = window.__game;
    const out = [];
    const st = () => g.storyState();
    const busy = () => st().dead || !!g.director.cutscene || !!g.cutscenes?.player?.active;
    const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const f = (v) => v.toFixed(2);
    for (let i = 0; i < 1800 && busy(); i++) await g.advance(1, 1/30);
    await g.advance(60, 1/30);
    const beat = st().beat;
    const results = [];
    for (const torch of [false, true]) {
      g.rig.setOn(torch);
      const d0 = st().deathsTotal;
      g.director.onAiEvent({ type: 'catch', cause: 'contact' });
      let k = 0;
      for (; k < 30 * 30 && !busy(); k++) await g.advance(1, 1/30); // the death starts
      for (k = 0; k < 30 * 60 && busy(); k++) await g.advance(1, 1/30); // cutaway + respawn
      g.rig.setOn(torch);
      const died = st().deathsTotal - d0;
      const me = g.pos();
      const cp = st().checkpoint;
      const a0 = [...g.brain.nav.pos];
      let minD = 99, moved = -1, caught = -1;
      const seen = new Set();
      for (let i = 0; i < ${idleS} * 30; i++) {
        await g.advance(1, 1/30);
        const a = g.brain.nav.pos;
        const same = Math.abs(a[2] - me[2]) < 2;
        if (g.brain.state !== 'PATROL' && g.brain.state !== 'VIGIL') seen.add(g.brain.state);
        if (same) minD = Math.min(minD, d2(a, me));
        if (moved < 0 && d2(a, a0) > 0.3) moved = i / 30;
        if (caught < 0 && st().deathsTotal > d0 + died) caught = i / 30;
        if (caught >= 0 && busy()) break;
      }
      results.push({ beat, cp, torch, deathsBefore: d0, killed: died, me: me.map(f), ada0: a0.map(f), ada0Room: g.brain.nav.room, minD: f(minD), firstMoveS: moved, caughtAtS: caught, states: [...seen].join('/') });
      for (let i = 0; i < 1800 && busy(); i++) await g.advance(1, 1/30);
    }
    return results;
  })()`);
  for (const x of r) qa.log(JSON.stringify(x));
  qa.report.respawnIdle = r;
  for (const x of r) {
    qa.assert(x.killed === 1, `${x.beat} ${x.cp} torch ${x.torch ? 'on' : 'off'}: the probe death registered`);
    qa.assert(x.caughtAtS < 0, `${x.beat} ${x.cp} torch ${x.torch ? 'on' : 'off'}: idle ${idleS} s after the respawn without a catch (caught at ${x.caughtAtS} s)`);
  }
}
