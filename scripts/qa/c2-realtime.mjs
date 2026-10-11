// Review fix round 3: REAL-TIME C2 → C2c (rAF intervals mapped to the cutscene id + its own clock; frames > 33 / > 50 ms)
export default async function (qa) {
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
    return active();
  })()`);
  qa.log('C2 start ' + w);
  const r = await qa.eval(`(async () => {
    const g = window.__game; const P = g.cutscenes?.player;
    // PERF fix round 4 (#132): the stepped walk's advance() frames are unfenced — let their GPU queue drain before the real
    // loop restarts, or the first real frames wait on it (measured 183–267 ms with 0 node builds: a tool artifact)
    await new Promise((r) => setTimeout(r, 1500)); g.loop.start();
    const out = []; let last = performance.now(); const t0 = performance.now(); let n = 0; const seen = {};
    await new Promise((res) => { const f = (now) => { const dt = now - last; last = now; n++;
      const id = P?.active ?? null; const t = P?.time ?? -1; if (id) seen[id] = Math.max(seen[id] ?? 0, t);
      if (dt > 33) out.push([id, +(+t).toFixed(2), +dt.toFixed(0)]);
      if (now - t0 < 52000 && (id || now - t0 < 3000)) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    const wall = (performance.now() - t0) / 1000;
    return JSON.stringify({ frames: n, wall: +wall.toFixed(1), fps: +(n / wall).toFixed(1), seen, over33: out.length, over50: out.filter((x) => x[2] > 50), worst: out.sort((a, b) => b[2] - a[2]).slice(0, 10) });
  })()`);
  qa.log('rt ' + r);
}
