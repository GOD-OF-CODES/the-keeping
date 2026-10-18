// SMOOTHNESS FRAMES lane (contract #142b, lead ruling (an)): the re-hung P_GATE in play.
//   node scripts/shot.mjs --no-build --dist <dist> --preset medium --beat B02 --wait 2 --shots 0 \
//        --scenario scripts/qa/gate-check.mjs --out <dir> --name gate
// 1. CP1 spawn: the player is not pushed by the gate's collider (position after 1 s idle).
// 2. The opening is walkable both ways: road (1.8, −31) → north to y −25 and back out to y −31 (KeyW, 1.6 m/s steps).
// 3. T_B02_GATE fires on the way in (the game's own `[trigger]` console line, ?debug).
// 4. The leaf blocks: walking east into it from (−0.2, −27.0) stops short of x ≈ 0.4.
// 5. Stills: CP1 looking back at the gate; the road looking up the drive through the gate; the porch looking down to it;
//    ruling (z4): the upper hall and the kitchen (non-parlor lightmaps after the re-bake).
export default async function (qa) {
  await qa.game('loop.stop()');
  await qa.eval(`(() => { const g = window.__game; g.unpause?.(); window.__trig = []; const o = console.info.bind(console);
    console.info = (...a) => { const s = a.join(' '); if (s.startsWith('[trigger]')) window.__trig.push(s); return o(...a); }; return 1; })()`);
  const pos = () => qa.eval('window.__game.pos()');
  const step = (n, keys = []) => qa.eval(`window.__game.advance(${n}, 1/30, ${JSON.stringify(keys)})`);
  const res = {};
  // 1. CP1
  const cp1 = await qa.eval(`window.__game.ctx.layout.spawns.find((s) => s.id === 'CP1').pos`);
  await qa.eval(`window.__game.goto(${cp1[0]}, ${cp1[1]}, ${cp1[2] - 1.65}, ${Math.PI / 2}, 0.05)`);
  await step(30);
  const p0 = await pos();
  res.cp1 = { spawn: cp1, after1s: p0.map((v) => +v.toFixed(3)), pushedM: +Math.hypot(p0[0] - cp1[0], p0[1] - cp1[1]).toFixed(3) };
  await qa.eval(`window.__game.look(${-Math.PI / 2}, -0.08)`);
  await step(2);
  await qa.shot('cp1-looking-back');
  // 2–3. in through the opening and back out
  const walk = async (from, heading, frames) => {
    await qa.eval(`window.__game.goto(${from[0]}, ${from[1]}, 0, ${heading}, 0)`);
    await step(2);
    const trace = [];
    for (let i = 0; i < frames; i += 10) {
      await qa.eval(`window.__game.look(${heading}, 0)`);
      await step(10, ['KeyW']);
      trace.push((await pos()).map((v) => +v.toFixed(2)));
    }
    return trace;
  };
  const inT = await walk([1.8, -31.0], Math.PI / 2, 240);
  res.walkIn = { from: [1.8, -31.0], to: inT[inT.length - 1], minX: Math.min(...inT.map((p) => p[0])), maxX: Math.max(...inT.map((p) => p[0])) };
  res.triggers = await qa.eval('window.__trig.slice()');
  const outT = await walk([1.8, -25.5], -Math.PI / 2, 240);
  res.walkOut = { from: [1.8, -25.5], to: outT[outT.length - 1] };
  // 4. the leaf
  const leafT = await walk([-0.2, -27.0], 0, 90);
  res.leafBlock = { from: [-0.2, -27.0], heading: 'east', stoppedAt: leafT[leafT.length - 1] };
  // 5. stills
  await qa.eval(`window.__game.goto(1.8, -33.0, 0, ${Math.PI / 2}, 0.03)`);
  await step(20);
  await qa.shot('road-through-gate');
  await qa.eval(`window.__game.goto(1.8, -3.6, 0, ${-Math.PI / 2}, -0.04)`);
  await step(20);
  await qa.shot('porch-down-to-gate');
  // ruling (z4): after a props rebuild + re-bake, one non-parlor room each floor (stale lightmaps showed as black / wrong)
  await qa.eval(`window.__game.goto(2.4, 6.3, 4.1, ${Math.PI / 2}, -0.05)`);
  await step(20);
  await qa.shot('z4-upper-hall');
  await qa.eval(`window.__game.goto(7.6, 9.75, 0.6, ${Math.PI}, -0.08)`);
  await step(20);
  await qa.shot('z4-kitchen');
  qa.report.gate = res;
  qa.log('[gate] ' + JSON.stringify(res));
  qa.assert(res.cp1.pushedM < 0.05, `CP1 not pushed by the gate (${res.cp1.pushedM} m)`);
  qa.assert(res.walkIn.to[1] > -26, `walked in through the opening (reached y ${res.walkIn.to[1]})`);
  // past the gate posts (fence line −28.25, posts r ≈ 0.1 + capsule 0.27): the dead sedan P_CAR_GATE parks across the road
  // right below the gate (body y −31.2…−29.2 at x 1.8), so a straight walk-out stops against it at ≈ −28.93
  qa.assert(res.walkOut.to[1] < -28.65, `walked out through the opening (reached y ${res.walkOut.to[1]})`);
  qa.assert(res.triggers.some((t) => /T_B02_GATE/.test(t)), `T_B02_GATE fired (${res.triggers.join(' | ')})`);
  qa.assert(res.leafBlock.stoppedAt[0] < 0.45, `the leaf blocks (stopped at x ${res.leafBlock.stoppedAt[0]})`);
}
