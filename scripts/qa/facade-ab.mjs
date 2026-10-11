// AD review fr4: the facade/gate lightning frame, same state as playthrough.mjs's 'facade-gate-flash' (for ?urpatch A/B)
export default async function (qa) {
  await qa.game('loop.stop()');
  await qa.eval(`(async () => { const g = window.__game; g.unpause?.(); const c = g.cutscenes?.player; for (let i = 0; i < 4 && c?.active; i++) { c.skip(true); await g.advance(10, 1/30); } return 1; })()`);
  await qa.eval(`(async () => { const g = window.__game; g.goto(1.8, -26.5, 0, Math.PI / 2, 0.16); await g.advance(60, 1/30); g.goto(1.8, -26.5, 0, Math.PI / 2, 0.16); await g.advance(2, 1/30); return 1; })()`);
  await qa.shot('facade-dark');
  await qa.eval(`(() => { window.__game.lightning.strike(); return 1; })()`);
  for (let i = 0; i < 20; i++) { const lv = await qa.eval(`window.__game.advance(1, 1/60).then(() => window.__game.lightning.level)`); if (lv > 0.6) break; }
  await qa.shot('facade-flash');
  qa.log('urpatch ' + await qa.eval(`location.search`));
}
