// QA exposure meter — fix round 3, ruling (m): the hero frames of C2 / C2c / the B05 handover with the LIVE exposure
// (the value applied to the frame: `look.exposure()`) and linear PRE-exposure HDR patch averages (`look.hdr()`, cd/m²-
// like scene radiance) at named points. Do NOT log renderer.toneMappingExposure — it is always 1 (exposure is the
// pipeline's `uniforms.exposure` multiply before white balance and AgX).
//   node scripts/shot.mjs --scenario scripts/qa/c2-meter.mjs --preset medium --beat B03 --dist <dir> --wait 2 --shots 0 \
//        --out scratch/<dir> --name med --timeout 2400 [--width 1280 --height 800] [--backend webgl]
// env: MARKS / C2C_MARKS (comma lists; C2C_MARKS='' for none), FIXED=<linear exposure> (auto exposure off for the
//      whole run, it wins over the cues' cameras — an A/B), EXTRA='[{"name":..,"uv":[x,y],"r":3}]' extra probes, NOB05=1 (skip the B05 frames), GRID=1 (also a 4×3 uv grid of patches per frame).
const C2_LEN = 29.0;

// Named points. plan = PLAN space (x east, y north, z up, absolute: ground floor at 0.6). obj = 'root/child' (+ local).
const LAMP = [4.6, 4.25, 1.35]; // L_LAMP_PARLOR flame (12 cd, 1950 K)
const POINTS = [
  { name: 'floor_lamp_0.5m', plan: [4.95, 3.9, 0.6] }, // boards ≈ 0.5 m from below the lamp, toward the head
  { name: 'floor_head', plan: [5.25, 2.95, 0.6] }, // boards beside the resting head
  { name: 'floor_1.5m', plan: [5.6, 3.1, 0.6] },
  // the resting head (HEAD_REST 5.02, 3.05, 0.7 from 9.45): the cut face ≈ 9 cm toward E4, the hair ≈ 8 cm the other way
  // (plan points: ada_head_rig is attached under neck_02, so bind-space offsets do not apply to it)
  { name: 'cut_face', plan: [4.995, 3.008, 0.776], r: 3 },
  { name: 'head_hair', plan: [5.06, 3.11, 0.74], r: 4 },
  { name: 'pool_N', plan: [5.25, 3.45, 0.6], r: 6 }, // the round pool beyond the head at E4 (m2med 10.5)
  { name: 'stump', obj: 'ada/neck_01', r: 3 },
  { name: 'gown_chest', obj: 'ada/spine_03', r: 6 },
  { name: 'gown_hip', obj: 'ada/spine_01', r: 6 },
  { name: 'harlan_apron', obj: 'harlan/apron_r_01', r: 6 },
  { name: 'harlan_chest', obj: 'harlan/spine_03', r: 6 },
  { name: 'wall_N_2.6m', plan: [6.5, 5.98, 1.2] }, // north wall ≈ 2.6 m from the lamp
  { name: 'wall_W_1.5m', plan: [3.77, 3.0, 1.3] }, // west wall ≈ 1.5 m from the lamp
  { name: 'centre', uv: [0.5, 0.5], r: 8 },
];
const GRID = [];
for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) GRID.push({ name: `g${i}${j}`, uv: [0.125 + 0.25 * i, 1 / 6 + j / 3], r: 10 });

export default async function (qa) {
  const fixed = process.env.FIXED ? Number(process.env.FIXED) : null;
  const pts = (process.env.GRID ? POINTS.concat(GRID) : POINTS).concat(process.env.EXTRA ? JSON.parse(process.env.EXTRA) : []);
  const walk = `(async () => {
    const g = window.__game; g.unpause?.();
    const active = () => g.cutscenes?.player?.active ?? g.director.cutscene ?? null;
    for (let i = 0; i < 900 && active(); i++) await g.advance(1, 1/30);
    const legs = [[1.8, -1.5], [1.8, 0.6], [3.1, 1.5]];
    let k = 0;
    for (let i = 0; i < 30 * 40 && !active(); i++) {
      const p = g.pos(); const to = legs[Math.min(k, legs.length - 1)];
      if (k < legs.length - 1 && Math.hypot(p[0] - to[0], p[1] - to[1]) < 0.3) { k++; continue; }
      g.look(Math.atan2(to[1] - p[1], to[0] - p[0]), 0);
      await g.advance(1, 1/30, Math.hypot(p[0] - to[0], p[1] - to[1]) > 0.2 ? ['KeyW'] : []);
    }
    return { started: active(), t: g.ctx.time.now };
  })()`;
  await qa.game('loop.stop()');
  if (fixed !== null) await qa.eval(`window.__game.look.set({ autoExposure: false, manualExposure: ${fixed} })`);
  const w = await qa.eval(walk);
  qa.log('C2 start ' + JSON.stringify(w));
  qa.assert(w.started === 'C2', 'C2 started at the threshold');
  const t0 = w.t;
  const until = async (sec) => qa.eval(`(async () => { const g = window.__game; while (g.ctx.time.now - ${t0} < ${sec} - 1e-6) await g.advance(1, 1/60); return +(g.ctx.time.now - ${t0}).toFixed(3); })()`);
  const meter = async (label) => {
    const r = await qa.eval(`(async () => {
      const g = window.__game; const L = g.look;
      const ex = L.exposure();
      const p = await L.hdr(${JSON.stringify(pts)});
      return { ex, p, lamp: ${JSON.stringify(LAMP)}, now: g.ctx.time.now };
    })()`);
    const ex = r.ex;
    const e = ex.applied;
    const wbY = ex.wb ? ex.wb : [1, 1, 1];
    const rows = r.p.map((q) => {
      if (q.off || q.lum === undefined) return `${q.name}: off`;
      // displayed AgX input luminance after exposure × white balance (per channel), for reading against the AgX curve
      const y = e * (0.2126 * q.rgb[0] * wbY[0] + 0.7152 * q.rgb[1] * wbY[1] + 0.0722 * q.rgb[2] * wbY[2]);
      return `${q.name}: L ${q.lum} (min ${q.min} max ${q.max}) → AgX-in ${y.toPrecision(3)} @uv ${q.uv} d ${q.dist ?? '-'}`;
    });
    const age = ex.last ? +(ex.t - ex.last.t).toFixed(2) : null;
    qa.log(`[meter] ${label}: applied ${e?.toFixed?.(4)} (meter reading age ${age} s) EV ${ex.ev?.toFixed?.(3)} target ${Math.pow(2, ex.targetEV ?? NaN).toFixed(4)} last ${JSON.stringify(ex.last)} cue ${JSON.stringify(ex.cue)} wb ${JSON.stringify(ex.wb?.map((v) => +v.toFixed(3)))} tme ${ex.toneMappingExposure}`);
    for (const row of rows) qa.log(`   ${row}`);
    (qa.report.meter ??= {})[label] = r;
  };
  const marks = (process.env.MARKS ?? '7.75,9.3,10.5,13.9,24.0').split(',').map(Number);
  const c2c = (process.env.C2C_MARKS ?? '4.0,7.1,12.6').split(',').filter((v) => v.trim() !== '').map(Number);
  for (const m of marks) {
    await until(m);
    await meter(`c2-${m.toFixed(2)}`);
    await qa.shot(`c2-${m.toFixed(2)}`);
  }
  for (const m of c2c) {
    await until(C2_LEN + m);
    await meter(`c2c-${m.toFixed(2)}`);
    await qa.shot(`c2c-${m.toFixed(2)}`);
  }
  if (process.env.NOB05) return;
  // ---- B05: the handover (first gameplay frames after C2c) and her return under the torch (as c2e-hero.mjs)
  const ho = await qa.eval(`(async () => {
    const g = window.__game;
    for (let i = 0; i < 30 * 30 && (g.cutscenes?.player?.active ?? null); i++) await g.advance(1, 1/30);
    await g.advance(30, 1/30);
    return { beat: g.storyState().beat, pos: g.pos().map((v) => +v.toFixed(2)) };
  })()`);
  qa.log('B05 handover ' + JSON.stringify(ho));
  await meter('b05-handover');
  await qa.shot('b05-handover');
  const p9 = await qa.eval(`(async () => {
    const g = window.__game; const b = g.brain; let i = 0;
    for (; i < 30 * 50 && !(b.scripted?.mode === 'b05_return' && b.scripted.phase === 'blind_wait'); i++) await g.advance(1, 1/30);
    const a = b.nav.pos; const me = g.pos();
    g.rig?.setOn?.(true);
    const stump = [a[0], a[1], a[2] + 1.42];
    g.look(Math.atan2(stump[1] - me[1], stump[0] - me[0]), Math.atan2(stump[2] - me[2] - 1.65, Math.hypot(stump[0] - me[0], stump[1] - me[1])));
    await g.advance(8, 1/30);
    return { phase: b.scripted?.phase ?? null, waitedS: +(i / 30).toFixed(1), d: +Math.hypot(a[0] - me[0], a[1] - me[1], a[2] + 1.42 - me[2] - 1.65).toFixed(2) };
  })()`);
  qa.log('B05 return ' + JSON.stringify(p9));
  await meter('b05-return');
  await qa.shot('b05-return');
}
