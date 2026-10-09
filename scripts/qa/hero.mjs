// QA hero-shot retakes on simulated time (the playthrough bot takes its shots at fixed moments; some land on fades).
//
//   QA_HERO=c1    node scripts/shot.mjs --scenario scripts/qa/hero.mjs --preset medium --no-build --wait 1 \
//                   --width 960 --height 600 --shots 0 --out scratch/qa --name hero-c1
//        → C1 at 12 s (car interior, wipers) and at the lightning reveal of the house (FLASH = 38.6 s)
//   QA_HERO=upper node scripts/shot.mjs --scenario scripts/qa/hero.mjs --preset medium --beat B06 --no-build ...
//        → the upper hall with Ada in it: waits at the south end of U1 with the torch OFF (so she isn't drawn into a
//          catch), and once she is 3–7.5 m away on the same floor with no cutscene running, torch on, aim, shoot
//
// The rAF loop is stopped; frames are stepped with window.__game.advance(n, 1/30).

export default async function (qa) {
  const mode = process.env.QA_HERO ?? 'c1';
  await qa.game('loop.stop()');
  const t = () => qa.eval('window.__game.ctx.time.now');
  if (mode === 'c1') {
    const t0 = await t();
    const until = async (sec) => {
      while ((await t()) - t0 < sec) await qa.eval('window.__game.advance(15, 1/30)');
    };
    await until(12);
    await qa.shot('c1-car-12s');
    // the reveal: step finely around the flash and take the brightest frame's neighbour
    await until(38.4);
    let best = 0;
    for (let i = 0; i < 24; i++) {
      const lv = await qa.eval('window.__game.advance(1, 1/30).then(() => window.__game.lightning.level)');
      if (lv > best) best = lv;
      if (best > 0.5 && lv < best * 0.9) break; // just past the peak
    }
    await qa.shot('c1-flash-reveal');
    qa.log(`lightning peak ${best.toFixed(2)}`);
    return;
  }
  if (mode === 'upper') {
    await qa.eval(`(() => { const g = window.__game; g.unpause(); g.rig.setOn(false); g.goto(2.4, 1.9, 4.1, Math.PI / 2, 0); return true; })()`);
    let found = null;
    for (let i = 0; i < 120 && !found; i++) {
      found = await qa.eval(`window.__game.advance(15, 1/30).then(() => {
        const g = window.__game; const s = g.brain; const p = g.pos();
        const ap = s.nav?.pos; if (!ap) return null;
        const d = Math.hypot(ap[0] - p[0], ap[1] - p[1]);
        const cs = g.cutscenes; const busy = (cs?.player?.active ?? null) || (cs?.hem?.current ?? null);
        return !busy && Math.abs(ap[2] - p[2]) < 1 && d > 3 && d < 7.5 ? { ap, d: +d.toFixed(2), room: s.nav.room, state: s.state } : null;
      })`);
    }
    if (!found) {
      qa.log('Ada never came within 2.5–9 m on the upper floor');
      await qa.shot('upper-hall-noada');
      return;
    }
    await qa.eval(`(() => { const g = window.__game; const p = g.pos(); const a = ${JSON.stringify(found.ap)}; g.rig.setOn(true); g.look(Math.atan2(a[1] - p[1], a[0] - p[0]), -0.04); return g.advance(2, 1/30); })()`);
    await qa.shot('upper-hall-ada-torch');
    qa.log(`Ada ${JSON.stringify(found)}`);
  }
}
