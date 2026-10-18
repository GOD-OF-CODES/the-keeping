// FLASH lane (contract #146) — "the flashlight gets dimmer as you approach walls": walk straight at a wall, torch on,
// and hold still at eye-to-wall distances d (settled ≥ 3 s each), then a continuous walk-in at 1.6 m/s (gameplay
// collision). Per point: the DISPLAYED (post-AgX, sRGB) pool centre / pool mean / pool radius on screen, the linear
// PRE-exposure HDR at the pool centre (look.hdr), the exposure EV + which protect binds (key / hp / fix), the lens'
// world position and signed distance to the wall plane, arm vertices behind the wall, the spot intensity.
//   node scripts/shot.mjs --no-build --dist scratch/dist-flash-beam --preset medium --beat B10 --wait 2 --shots 0 \
//        --timeout 2400 --scenario scripts/qa/flash-beam.mjs --out scratch/flash-beam/<tag> --name med
// env: SITES=U1,G1,U2,EXT,K1,D1   DISTS=4,3,2,1.5,1,0.7,0.5,0.35,0.25   WALK=0 (skip the walk-ins)   SETTLE=3.5 (s)
//      CONFIGS=old,new,arms,expo (a FLASH #146 build only; '' = leave the build as it is): same session A/B —
//        old  = nearAdapt 1 / nearLead 0 / fixSoft 0, far-field core, no pullback/aim (= the pre-#146 behaviour)
//        new  = the build's defaults;  arms = old exposure + pullback/aim + near-field core;  expo = new exposure, no arms
// Output: <out>/<name>-<site>-d<d>.jpg (labelled 640-px captures), <out>/<name>-beam.csv, <out>/<name>-walk.csv.
// LOOK (#146c) NOTE: the `centre` / `poolMean` columns sample the ANALYTIC wall plane's beam-axis hit — on relief or
// recessed surfaces (clapboard, a door leaf) that point sits beside the real hot core at ≤ 0.7 m. Judge those sites by
// the captures: python3 scratch/flash-look/corepeak.py / corepool.py <jpg>… (core peak / mean within 24 px of it).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Sites: feet in PLAN space (x east, y north, z = floor), heading CCW from east (−π/2 = south, π/2 = north).
const CFG = {
  old: { look: { nearAdapt: 1, nearLead: 0, fixSoft: 0 }, near: 0, pull: false, aim: false },
  new: { look: {}, near: 1, pull: true, aim: true },
  arms: { look: { nearAdapt: 1, nearLead: 0, fixSoft: 0 }, near: 1, pull: true, aim: true },
  expo: { look: {}, near: 1, pull: false, aim: false },
};
const SITES = {
  // armoire footprint x 2.98–3.58 / y 3.65–4.75; the south window x 1.35–2.25 → x 2.65 is clear wallpaper
  U1: { feet: [2.65, 4.35, 4.1], heading: -Math.PI / 2, note: 'upper hall, south wall (green damask) east of the window' },
  // hall table x 3.12–3.54 / y 3.7–4.7; front door x 1.3–2.3
  G1: { feet: [2.75, 4.35, 0.6], heading: -Math.PI / 2, note: 'entrance hall, south wall (green damask over wainscot) east of the front door' },
  // coat wardrobe x 3.76–4.38 / y 1.35–2.45; east window y 0.9–1.7; grate hole y 2.9–3.5
  U2: { feet: [4.65, 2.2, 4.1], heading: 0, note: "Harlan's room, east wall (ochre damask) north of the window" },
  // east facade WG_E1 (outer face x 9.05, y −0.3…6.07, no openings), east of the porch (porch x ≤ 8.875, y ≤ −0.3)
  // LOOK (#146c): y 3.0 → 4.6 — P_TREE_2 (layout [11.5, 3.0]) stood on the old line (wall found at 1.16 m: skipped)
  EXT: { feet: [13.1, 4.6, 0], heading: Math.PI, note: 'east facade clapboard (no windows), ground level' },
  // LOOK (#146c) — the albedo extremes the four above do not cover:
  // kitchen south wall WG_G2G3 (G3 face y ≈ 6.225, plaster_damp avgAlbedo 0.42/0.39/0.33 — the brightest wall in the
  // house, where the AgX shoulder binds first); x 5.2 is clear of the can shelf (x 4), the stove (x 7.4) and chair 1 (x 5.9)
  K1: { feet: [5.2, 9.6, 0.6], heading: -Math.PI / 2, note: 'kitchen, south wall (damp plaster, rho 0.39)' },
  // the front door leaf from the hall (D_FRONT, door_front avgAlbedo 0.05/0.035/0.03 — the darkest vertical surface,
  // shut and bolted after C2); opening x 1.3–2.3, the runner x 1.95–2.75, the stair x ≤ 1.1
  D1: { feet: [1.8, 4.2, 0.6], heading: -Math.PI / 2, note: 'entrance hall, the front door leaf (dark paint, rho 0.04)' },
};

export default async function (qa) {
  const out = resolve(process.argv[process.argv.indexOf('--out') + 1] ?? 'scratch/flash-beam');
  const name = process.argv.includes('--name') ? process.argv[process.argv.indexOf('--name') + 1] : 'run';
  mkdirSync(out, { recursive: true });
  const sites = (process.env.SITES ?? 'U1,G1,U2,EXT').split(',').filter((s) => SITES[s]);
  const dists = (process.env.DISTS ?? '4,3,2,1.5,1,0.7,0.5,0.35,0.25').split(',').map(Number);
  const settle = Number(process.env.SETTLE ?? 3.5);
  const configs = (process.env.CONFIGS ?? '').split(',').filter((c) => CFG[c]);
  await qa.game('loop.stop()');
  await qa.eval(`(async () => {
    const g = window.__game; g.unpause?.();
    const active = () => g.cutscenes?.player?.active ?? g.director?.cutscene ?? null;
    for (let i = 0; i < 1800 && active(); i++) { await g.advance(1, 1/30); if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0)); }
    g.brain?.setScripted?.('hidden');
    if (!g.rig.on) g.rig.setOn(true);
    window.__fbStrikes = [];
    g.ctx.events.on('lightning', () => window.__fbStrikes.push(g.ctx.time.now));
    const V3 = g.camera.position.constructor;
    const L = g.flashlight.light;
    const W = 640;
    // LOOK (#146c): the torch's own probe (closed door leaves count — D1 is a door) when the build has it
    const C = g.level.collision;
    const ray = (o, d, far = 14) => (C.sightDistance ? C.sightDistance(o, d, far) : C.rayDistance(o, d, far));
    const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    window.__fb = {
      // eye + forward (world) for a plan feet point and heading, pitch 0
      eyeDir(feet, h) { return { o: new V3(feet[0], feet[2] + 1.65, -feet[1]), d: new V3(Math.cos(h), 0, -Math.sin(h)) }; },
      wallDist(feet, h) { const { o, d } = this.eyeDir(feet, h); return ray(o, d, 14); },
      async step(n, keys = []) { for (let i = 0; i < n; i++) { await g.advance(1, 1/30, keys); await new Promise((r) => setTimeout(r, 2)); } },
      async measure(wall, label) {
        // wall = { p: [x,y,z] world point on the wall plane, n: [x,y,z] unit normal toward the player }
        const cam = g.camera; cam.updateMatrixWorld(true);
        L.updateMatrixWorld(true); L.target.updateMatrixWorld(true);
        const lens = new V3().setFromMatrixPosition(L.matrixWorld);
        const tgt = new V3().setFromMatrixPosition(L.target.matrixWorld);
        const bd = tgt.clone().sub(lens).normalize();
        const n = new V3(...wall.n), P = new V3(...wall.p);
        const sd = (v) => v.clone().sub(P).dot(n);
        const eye = new V3().setFromMatrixPosition(cam.matrixWorld);
        const eyeWall = sd(eye);
        const lensWall = sd(lens);
        // beam axis hit on the wall PLANE (the analytic plane, so a lens behind it still gives a point)
        const den = bd.dot(n);
        const tHit = den < -1e-4 ? -lensWall / den : NaN;
        const hit = Number.isFinite(tHit) ? lens.clone().addScaledVector(bd, tHit) : P.clone();
        const rayHit = ray(lens, bd, 14);
        // arm vertices behind the wall plane (every 4th vertex, skinned)
        let behind = 0, minS = 1e9, nv = 0;
        const v = new V3();
        for (const m of g.arms?.c?.meshes ?? []) {
          if (!m.visible || !m.geometry?.attributes?.position) continue;
          m.updateMatrixWorld(true);
          const cnt = m.geometry.attributes.position.count;
          for (let i = 0; i < cnt; i += 4) {
            m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld);
            const s = sd(v); nv++; if (s < 0) behind++; if (s < minS) minS = s;
          }
        }
        const ex = g.look.exposure();
        const last = ex.last ?? {};
        // which bound sets the target (exposure.ts measure(), gameplay: no cue)
        const LK = g.look.get();
        let tKey = Math.min(Math.log2(ex.range.max), Math.max(Math.log2(ex.range.min), Math.log2(LK.key) - (last.log2Avg ?? 0))) + LK.biasEV;
        let t = tKey, which = 'key';
        if (LK.hpWhite > 0 && (last.hp ?? -20) > -20) { const h = Math.max(Math.log2(LK.hpFloor), Math.min(t, Math.log2(LK.hpWhite) - last.hp + LK.biasEV)); if (h < t - 1e-6) which = 'hp'; t = h; }
        if (LK.fixWhite > 0 && (last.fix ?? -20) > -20) {
          const r = last.fix - last.log2Avg;
          if (r >= Math.log2(LK.fixRatio) && r <= Math.log2(LK.fixRatioMax)) { const f = Math.max(Math.log2(LK.hpFloor), Math.min(t, Math.log2(LK.fixWhite) - last.fix + LK.biasEV)); if (f < t - 1e-6) which = 'fix'; t = f; }
        }
        const hdr = await g.look.hdr([{ name: 'pool', world: [hit.x, hit.y, hit.z], r: 3 }, { name: 'frame', uv: [0.5, 0.5], r: 300 }]);
        // capture + displayed stats
        const url = await g.capture(W);
        const bmp = await createImageBitmap(await (await fetch(url)).blob());
        const cv = new OffscreenCanvas(bmp.width, bmp.height); const c2 = cv.getContext('2d'); c2.drawImage(bmp, 0, 0);
        const w = bmp.width, h = bmp.height; const px = c2.getImageData(0, 0, w, h).data;
        const ndc = hit.clone().project(cam);
        const cx = (ndc.x + 1) / 2 * w, cy = (1 - ndc.y) / 2 * h;
        // screen radius of an angle θ about the beam axis on the wall: project hit + u·dist·tanθ (u ⟂ n, ~ up)
        const up = new V3(0, 1, 0); const u = up.sub(n.clone().multiplyScalar(up.dot(n))).normalize();
        const dl = Number.isFinite(tHit) ? tHit : 0.05;
        const rAt = (deg) => { const q = hit.clone().addScaledVector(u, dl * Math.tan(deg * Math.PI / 180)).project(cam); return Math.hypot((q.x + 1) / 2 * w - cx, (1 - q.y) / 2 * h - cy); };
        const r6 = Math.max(2, rAt(6)), r10 = rAt(10), r25 = rAt(25);
        let s0 = 0, n0 = 0, sP = 0, nP = 0, sA = 0, nA = 0, sF = 0;
        const R = Math.ceil(Math.hypot(w, h)); const ring = new Float64Array(R + 1), ringN = new Float64Array(R + 1);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4; const l = lum(px, i); sF += l;
          const rr = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (rr <= 3) { s0 += l; n0++; }
          if (rr <= r6) { sP += l; nP++; }
          if (rr >= r10 && rr <= r25) { sA += l; nA++; }
          const k = Math.min(R, Math.floor(rr)); ring[k] += l; ringN[k]++;
        }
        const centre = n0 ? s0 / n0 : NaN;
        const bgFrom = Math.round(0.3 * h), bgTo = Math.round(0.45 * h);
        let bs = 0, bn = 0; for (let k = bgFrom; k <= bgTo; k++) { bs += ring[k]; bn += ringN[k]; }
        const bg = bn ? bs / bn : 0;
        let rHalf = NaN; for (let k = 1; k <= R; k++) { if (ringN[k] && ring[k] / ringN[k] < bg + (centre - bg) / 2) { rHalf = k; break; } }
        // label (drawn AFTER the stats)
        c2.fillStyle = 'rgba(0,0,0,0.55)'; c2.fillRect(0, 0, w, 18);
        c2.fillStyle = '#fff'; c2.font = '12px monospace';
        c2.fillText(label + '  EV ' + ex.ev.toFixed(2) + ' ' + which + '  ctr ' + centre.toFixed(0) + ' pool ' + (nP ? sP / nP : 0).toFixed(0) + ' lens ' + lensWall.toFixed(2), 4, 13);
        c2.strokeStyle = 'rgba(255,0,0,0.6)'; c2.beginPath(); c2.arc(cx, cy, r6, 0, Math.PI * 2); c2.stroke();
        const jpg = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
        const buf = new Uint8Array(await jpg.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        const strikes = window.__fbStrikes.filter((s) => g.ctx.time.now - s < 4).length;
        return {
          label, t: +g.ctx.time.now.toFixed(3), eyeWall: +eyeWall.toFixed(3), lensWall: +lensWall.toFixed(3), lens: [lens.x, lens.y, lens.z].map((x) => +x.toFixed(3)),
          beamRay: Number.isFinite(rayHit) ? +rayHit.toFixed(3) : null, beamTilt: +Math.acos(Math.max(-1, Math.min(1, -den))).toFixed(3) * 57.3,
          armsBehind: behind, armsN: nv, armsMinS: +minS.toFixed(3),
          intensity: +L.intensity.toFixed(1), base: g.flashlight.intensity, bounce: +(g.flashlight.bounce?.intensity ?? 0).toFixed(2),
          pull: g.arms?.pull != null ? +g.arms.pull.toFixed(3) : null, aim: g.arms?.aim != null ? +g.arms.aim.toFixed(3) : null,
          nearG: ex.near ? +ex.near.G.toFixed(3) : null, hitDist: ex.near && Number.isFinite(ex.near.hitDist) ? +ex.near.hitDist.toFixed(3) : null, subject: ex.near?.subject ?? null, which2: last.which ?? null,
          ev: +ex.ev.toFixed(3), targetEV: +ex.targetEV.toFixed(3), applied: +ex.applied.toFixed(4), log2Avg: +(last.log2Avg ?? NaN).toFixed(3), hp: +(last.hp ?? NaN).toFixed(3), fix: +(last.fix ?? NaN).toFixed(3), keyEV: +tKey.toFixed(3), which,
          hdrPool: hdr[0]?.lum ?? null, hdrPoolMax: hdr[0]?.max ?? null, hdrFrame: hdr[1]?.lum ?? null,
          centre: +centre.toFixed(1), poolMean: +(nP ? sP / nP : NaN).toFixed(1), annulus: +(nA ? sA / nA : NaN).toFixed(1), frameMean: +(sF / (w * h)).toFixed(1), bg: +bg.toFixed(1),
          rHalfPx: rHalf, r6px: +r6.toFixed(1), cx: +cx.toFixed(1), cy: +cy.toFixed(1), strikes, b64: btoa(bin),
        };
      },
    };
    return 1;
  })()`);

  const cols = ['cfg', 'site', 'mode', 'd', 'pull', 'aim', 'nearG', 'hitDist', 'subject', 'which2', 'eyeWall', 'lensWall', 'beamRay', 'armsBehind', 'armsMinS', 'intensity', 'bounce', 'ev', 'targetEV', 'which', 'log2Avg', 'hp', 'fix', 'keyEV', 'hdrPool', 'hdrPoolMax', 'hdrFrame', 'centre', 'poolMean', 'annulus', 'frameMean', 'rHalfPx', 'r6px', 'strikes', 'evMin1s', 'evMax1s'];
  const DEFAULT_OVERRIDE = process.env.LOOKSET ? JSON.parse(process.env.LOOKSET) : {};
  const rows = [];
  const walkRows = [];
  const fmt = (r) => cols.map((c) => (r[c] === undefined || r[c] === null ? '' : r[c])).join(',');
  for (const cfg of configs.length ? configs : ['']) {
  if (cfg) {
    const C = CFG[cfg];
    await qa.eval(`(() => { const g = window.__game; g.look.set(Object.assign({ nearAdapt: 0.5, nearLead: 1, fixSoft: 1 }, ${JSON.stringify(DEFAULT_OVERRIDE)}, ${JSON.stringify(C.look)}));
      g.flashlight.near.value = ${C.near}; g.arms.pullEnabled = ${C.pull}; g.arms.aimEnabled = ${C.aim}; if (!${C.pull}) g.arms.pull = 0; if (!${C.aim}) g.arms.aim = 0; return 1; })()`);
    qa.log(`[cfg] ${cfg} ${JSON.stringify(C)}`);
  }
  for (const s of sites) {
    const S = SITES[s];
    const D0 = await qa.eval(`window.__fb.wallDist(${JSON.stringify(S.feet)}, ${S.heading})`);
    qa.log(`[site] ${s}: wall at ${D0} m from feet ${S.feet} heading ${(S.heading * 57.3).toFixed(0)}° (${S.note})`);
    if (!Number.isFinite(D0) || D0 < 3) { qa.log(`[site] ${s}: wall too close / none — skipped`); continue; }
    const c = Math.cos(S.heading), sn = Math.sin(S.heading);
    const feetAt = (d) => [S.feet[0] + c * (D0 - d), S.feet[1] + sn * (D0 - d), S.feet[2]];
    const wp = [S.feet[0] + c * D0, S.feet[2] + 1.65, -(S.feet[1] + sn * D0)];
    const wall = { p: wp, n: [-c, 0, sn] }; // world normal toward the player: −(cos h, 0, −sin h)
    // ---- settled points (noclip: d below the 0.27 m capsule radius is reachable)
    await qa.eval(`window.__game.noclip(true)`);
    for (const d of dists) {
      if (d > D0 - 0.05) continue;
      const f = feetAt(d);
      let r = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const ev = await qa.eval(`(async () => {
          const g = window.__game; const fb = window.__fb;
          g.goto(${f[0]}, ${f[1]}, ${f[2]}, ${S.heading}, 0); g.rig.snap();
          const evs = [];
          for (let i = 0; i < Math.round(${settle} * 30); i++) { await fb.step(1); evs.push(g.look.exposure().ev); }
          const tail = evs.slice(-30);
          return [Math.min(...tail), Math.max(...tail)];
        })()`);
        r = await qa.eval(`window.__fb.measure(${JSON.stringify(wall)}, ${JSON.stringify(`${s} d=${d}`)})`);
        r.evMin1s = +ev[0].toFixed(3);
        r.evMax1s = +ev[1].toFixed(3);
        if (r.strikes === 0 && r.intensity >= 0.97 * r.base) break;
        qa.log(`[redo] ${s} d=${d}: strikes ${r.strikes} intensity ${r.intensity}/${r.base}`);
      }
      const file = join(out, `${name}${cfg ? '-' + cfg : ''}-${s}-d${String(d).replace('.', 'p')}.jpg`);
      writeFileSync(file, Buffer.from(r.b64, 'base64'));
      delete r.b64;
      Object.assign(r, { cfg, site: s, mode: 'settled', d });
      rows.push(r);
      qa.log(`[pt] ${fmt(r)}`);
    }
    // ---- walk-in at 1.6 m/s (collision on), from d = min(4, D0 − 0.1)
    if (process.env.WALK !== '0') {
      await qa.eval(`window.__game.noclip(false)`);
      const d0 = Math.min(4, D0 - 0.1);
      const f = feetAt(d0);
      await qa.eval(`(async () => { const g = window.__game; g.goto(${f[0]}, ${f[1]}, ${f[2]}, ${S.heading}, 0); g.rig.snap(); await window.__fb.step(150); return 1; })()`);
      let lastEye = 1e9;
      let still = 0;
      for (let k = 0; k < 240 && still < 30; k++) {
        await qa.eval(`window.__fb.step(1, ['KeyW'])`);
        if (k % 3 !== 0) continue;
        const r = await qa.eval(`window.__fb.measure(${JSON.stringify(wall)}, ${JSON.stringify(`${s} walk`)})`);
        delete r.b64;
        Object.assign(r, { cfg, site: s, mode: 'walk', d: r.eyeWall, k });
        walkRows.push(r);
        if (Math.abs(r.eyeWall - lastEye) < 0.004) still += 3;
        else still = 0;
        lastEye = r.eyeWall;
      }
      qa.log(`[walk] ${cfg} ${s}: ${walkRows.filter((r) => r.site === s && r.cfg === cfg).length} samples, stopped at eye-wall ${lastEye}`);
    }
  }
  }
  writeFileSync(join(out, `${name}-beam.csv`), [cols.join(','), ...rows.map(fmt)].join('\n') + '\n');
  writeFileSync(join(out, `${name}-walk.csv`), [['k', ...cols].join(','), ...walkRows.map((r) => [r.k, fmt(r)].join(','))].join('\n') + '\n');
  qa.report.beam = rows;
  qa.report.walk = walkRows;
}
