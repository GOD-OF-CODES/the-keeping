// Review fix round 3 — same-state A/B of the parlor key position (the lamp flame + its prop + stain key follow the light).
// env MARKS (C2 s), LAMPS='[["S",null],["A",[5.6,2.3,1.72]]]' (plan flame positions), EXTRA uv probes JSON per mark.
export default async function (qa) {
  const marks = (process.env.MARKS ?? '8.2,10.5').split(',').map(Number);
  const lamps = JSON.parse(process.env.LAMPS ?? '[["S",null],["A",[5.6,2.3,1.72]],["B",[4.3,2.9,1.35]]]');
  const probes = JSON.parse(process.env.PROBES ?? '{}');
  await qa.game('loop.stop()');
  const w = await qa.eval(`(async () => {
    const g = window.__game; g.unpause?.();
    const active = () => g.cutscenes?.player?.active ?? g.director.cutscene ?? null;
    for (let i = 0; i < 900 && active(); i++) await g.advance(1, 1/30);
    const legs = [[1.8, -1.5], [1.8, 0.6], [3.1, 1.5]]; let k = 0;
    for (let i = 0; i < 30 * 40 && !active(); i++) {
      const p = g.pos(); const to = legs[Math.min(k, legs.length - 1)];
      if (k < legs.length - 1 && Math.hypot(p[0] - to[0], p[1] - to[1]) < 0.3) { k++; continue; }
      g.look(Math.atan2(to[1] - p[1], to[0] - p[0]), 0);
      await g.advance(1, 1/30, Math.hypot(p[0] - to[0], p[1] - to[1]) > 0.2 ? ['KeyW'] : []);
    }
    const L = g.scene.getObjectByName('flicker_L_LAMP_PARLOR'), F = g.scene.getObjectByName('flame_L_LAMP_PARLOR');
    let P = null; g.scene.traverse((o) => { if (!P && /P_LAMP_PARLOR/.test(o.name ?? '')) P = o; });
    window.__lab = { L, F, P, L0: L?.position.clone(), F0: F?.position.clone(), P0: P?.position.clone() };
    const chain = (o) => { const a = []; for (let x = o; x; x = x.parent) a.push(x.name || x.type); return a.join('<'); };
    return { started: active(), t: g.ctx.time.now, L: L && chain(L), F: F && chain(F), P: P && chain(P), Lw: L && L.getWorldPosition(L.position.clone()).toArray().map((v) => +v.toFixed(3)) };
  })()`);
  qa.log('C2 start ' + JSON.stringify(w));
  const t0 = w.t;
  for (const m of marks) {
    await qa.eval(`(async () => { const g = window.__game; while (g.ctx.time.now - ${t0} < ${m} - 1e-6) await g.advance(1, 1/60); })()`);
    for (const [name, pos] of lamps) {
      const r = await qa.eval(`(async () => {
        const g = window.__game; const s = window.__lab; const pos = ${JSON.stringify(pos)};
        // plan → world (x, z, −y): a delta on the shipped flame
        const d = pos ? [pos[0] - 4.6, pos[2] - 1.35, -(pos[1] - 4.25)] : [0, 0, 0];
        for (const [o, o0] of [[s.L, s.L0], [s.F, s.F0], [s.P, s.P0]]) if (o) { o.position.copy(o0); o.position.x += d[0]; o.position.y += d[1]; o.position.z += d[2]; o.updateMatrixWorld(true); }
        if (s.L?.shadow) s.L.shadow.needsUpdate = true;
        await g.advance(1, 1/1000); await g.advance(1, 1/1000);
        const ex = g.look.exposure();
        const pr = await g.look.hdr(${JSON.stringify(probes[m] ?? [])});
        return { e: ex.applied, pr };
      })()`);
      qa.log(`[ab] ${m} ${name} ${JSON.stringify(pos)} e ${r.e}`);
      for (const p of r.pr ?? []) qa.log(`    ${p.name}: L ${(+p.lum).toPrecision(3)} rgb ${JSON.stringify((p.rgb ?? []).map((v) => +(+v).toPrecision(3)))}`);
      await qa.shot(`ab-${m.toFixed(2)}-${name}`);
    }
    await qa.eval(`(async () => { const s = window.__lab; for (const [o, o0] of [[s.L, s.L0], [s.F, s.F0], [s.P, s.P0]]) if (o) { o.position.copy(o0); o.updateMatrixWorld(true); } if (s.L?.shadow) s.L.shadow.needsUpdate = true; })()`);
  }
}
