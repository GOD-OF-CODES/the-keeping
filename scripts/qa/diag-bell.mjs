// B08 diagnosis: stand at the bell pull, pull it, and log every stimulus Ada receives (noise source / beam) + her
// state for 60 s of game time.
//   node scripts/shot.mjs --scenario scripts/qa/diag-bell.mjs --preset medium --beat B08 --dist scratch/dist-b08 --no-build --wait 2 --shots 0
export default async function (qa) {
  await qa.game('loop.stop()');
  const r = await qa.eval(`(async () => {
    const g = window.__game;
    const b = g.brain;
    const log = [];
    const T = () => g.ctx.time.now.toFixed(1);
    const oStim = b.stimulus.bind(b);
    b.stimulus = (pos, room, listen) => { log.push(T() + ' STIM ' + pos.map((v) => v.toFixed(2)) + ' ' + room + ' listen=' + listen + ' via ' + (b.__via ?? 'beam')); b.__via = null; return oStim(pos, room, listen); };
    const oHeard = b.onHeard.bind(b);
    b.onHeard = (n, p, m) => { b.__via = 'noise:' + n.source + ' r=' + n.radius + ' @' + n.pos.map((v) => v.toFixed(1)) + ' ' + n.room + ' margin=' + m.toFixed(2); const r = oHeard(n, p, m); b.__via = null; return r; };
    const oLure = b.startLure.bind(b);
    b.startLure = () => { log.push(T() + ' LURE start'); return oLure(); };
    const OUT = [];
    const dir = g.director; const oU = dir.update.bind(dir); let ada = null; dir.update = (dt) => { const o = oU(dt); if (o) ada = o; return o; };
    for (let i = 0; i < 30; i++) await g.advance(1, 1/30);
    g.goto(6.1, 4.0, 4.1, Math.PI / 2, 0);
    for (let i = 0; i < 10; i++) await g.advance(1, 1/30);
    log.push(T() + ' rig.on=' + g.rig.on + ' beat=' + g.director.story.beat + ' room=' + g.room() + ' ada=' + (ada && ada.state + '/' + ada.phase + ' ' + ada.room + ' ' + ada.pos.map((v) => v.toFixed(1))));
    const it = g.interact.items.find((i) => i.id === 'P_BELL_PULL');
    log.push('bell item ' + !!it);
    it?.use(false);
    for (let k = 0; k < 120; k++) {
      await g.advance(15, 1/30);
      if (k % 4 === 0) log.push(T() + ' ' + (ada ? ada.state + '/' + ada.phase + ' ' + ada.room + ' [' + ada.pos.map((v) => v.toFixed(1)) + '] head=' + ada.head : '-') + ' rig=' + g.rig.on + ' me=' + g.pos().map((v) => v.toFixed(2)));
    }
    return log;
  })()`);
  qa.report.diag = r;
  for (const l of r) qa.log(l);
}
