// FLASH lane part 2 (HAND, contract #146b) — "the hand holding the flashlight looks very weird": the first-person arms
// in the views the player sees them, torch on, each settled ≥ 2 s (exposure adapted): idle in a lit hall / the lamp-lit
// parlor / a dark room / outdoors in the rain, walking / running / crouching, looking down 45° and up 30°, near a wall
// (the #146 pull-in), the F toggle, knock, bell pull, door rattle, Space breath hold. Per view: a labelled capture
// (<out>/<name>-<view>.jpg, full width) + numbers: the arms' screen bbox (fraction of the frame, from the skinned
// vertices), the lens / grip in camera space (m), EV, pull/aim.
//   node scripts/shot.mjs --no-build --dist scratch/dist-flash-hand --preset medium --beat B05 --wait 2 --shots 0 \
//        --timeout 1800 --scenario scripts/qa/hand-views.mjs --out scratch/flash-hand/<tag> --name med
// env: VIEWS=hall,parlor,… (subset)   W=1280 (capture width)   SETTLE=2 (s)   SETUP='js' (once, g = window.__game)
//      AB='[["label","js"],…]': per view, after the main capture, each config's js is applied to the SAME frozen frame
//      (2 steps of 1e-4 s), captured as <name>-<view>-<label>.jpg, then RESET='js' restores (same-state A/B)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const UP = 4.1; // upper floor (PLAN z)
const GR = 0.6; // ground floor
const DEG = Math.PI / 180;
// feet PLAN (x east, y north, z floor), heading CCW from east, pitch (rad, + up)
const VIEWS = {
  hall: { feet: [1.8, 2.2, GR], h: 56 * DEG, p: -6 * DEG, note: 'entrance hall, candle on the hall table (lit hall)' },
  parlor: { feet: [6.6, 1.4, GR], h: 136 * DEG, p: -8 * DEG, note: 'parlor, kerosene lamp ahead (lit room)' },
  dark: { feet: [5.0, 7.0, UP], h: 0, p: -8 * DEG, note: "Ada's sewing room (dark room, torch only)" },
  rain: { feet: [1.9, -12, 0], h: 90 * DEG, p: -4 * DEG, note: 'drive, facing the house in the rain' },
  idle: { feet: [1.8, 1.2, UP], h: 90 * DEG, p: -4 * DEG, note: 'upper hall, looking down the hall (canonical)' },
  walk: { feet: [1.8, 0.8, UP], h: 90 * DEG, p: -4 * DEG, keys: ['KeyW'], move: 0.9, note: 'walking (W 0.9 s)' },
  run: { feet: [1.8, 0.8, UP], h: 90 * DEG, p: -4 * DEG, keys: ['KeyW', 'ShiftLeft'], move: 0.7, note: 'running (Shift+W 0.7 s)' },
  crouch: { feet: [1.8, 1.2, UP], h: 90 * DEG, p: -4 * DEG, keys: ['KeyC'], move: 1.2, note: 'crouched (C held)' },
  down45: { feet: [1.8, 2.0, UP], h: 90 * DEG, p: -45 * DEG, note: 'looking down 45°' },
  up30: { feet: [1.8, 2.0, UP], h: 90 * DEG, p: 30 * DEG, note: 'looking up 30°' },
  wall: { feet: [2.65, 4.35, UP], h: -90 * DEG, p: 0, wall: 0.45, note: 'eye 0.45 m from the south wall (pull-in)' },
  toggle: { feet: [1.8, 1.2, UP], h: 90 * DEG, p: -4 * DEG, clip: 'arms_flashlight_toggle', at: 0.2, note: 'F toggle, thumb on the switch (0.2 s)' },
  knock: { feet: [2.65, 4.35, UP], h: -90 * DEG, p: 0, wall: 0.6, clip: 'arms_knock', at: 0.5, note: 'knock, first rap (0.5 s)' },
  bell: { feet: [2.65, 4.35, UP], h: -90 * DEG, p: 0, wall: 0.6, clip: 'arms_bell_pull', at: 0.9, note: 'bell pull (0.9 s)' },
  door: { feet: [2.65, 4.35, UP], h: -90 * DEG, p: 0, wall: 0.6, clip: 'arms_door_rattle', at: 0.45, note: 'door rattle (0.45 s)' },
  breath: { feet: [1.8, 1.2, UP], h: 90 * DEG, p: -4 * DEG, breath: true, at: 1.0, note: 'Space breath hold (1 s in)' },
  // C2c 15.5 = gameplay 1.6 s after C2c hands control back at CP2 (stair top, eye (0.55, 8.25, 5.75), yaw −90° heading
  // down the flight = PLAN heading −π/2, pitch −50°): the torch hand over the empty flight
  stair: { feet: [0.55, 8.25, UP], h: -90 * DEG, p: -50 * DEG, note: 'C2c 15.5 pose: stair top CP2, pitch -50 (after the hand-back)' },
  // (not in the default set: B11's raised locket — the torch drawn in under the face)
  locket: { feet: [1.8, 1.2, UP], h: 90 * DEG, p: -4 * DEG, clip: 'arms_locket_hold', at: 1.0, extra: true, note: 'locket hold (B11 Mouse2)' },
};

export default async function (qa) {
  const out = resolve(process.argv[process.argv.indexOf('--out') + 1] ?? 'scratch/flash-hand');
  const name = process.argv.includes('--name') ? process.argv[process.argv.indexOf('--name') + 1] : 'run';
  mkdirSync(out, { recursive: true });
  const views = (process.env.VIEWS ?? Object.keys(VIEWS).filter((v) => !VIEWS[v].extra).join(',')).split(',').filter((v) => VIEWS[v]);
  const W = Number(process.env.W ?? 1280);
  const settle = Number(process.env.SETTLE ?? 2);
  const setup = process.env.SETUP ?? ''; // extra JS run once (A/B switches), `g` = window.__game
  await qa.game('loop.stop()');
  await qa.eval(`(async () => {
    const g = window.__game; g.unpause?.();
    const active = () => g.cutscenes?.player?.active ?? g.director?.cutscene ?? null;
    for (let i = 0; i < 1800 && active(); i++) { await g.advance(1, 1/30); if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0)); }
    g.brain?.setScripted?.('hidden');
    g.hides?.exit?.(); // B05 starts in the armoire (the arms are hidden inside a hide)
    await g.advance(30, 1/30);
    g.player.enabled = true; g.player.lookEnabled = true;
    if (!g.rig.on) g.rig.setOn(true);
    ${setup}
    window.__hvStrikes = [];
    g.ctx.events.on('lightning', () => window.__hvStrikes.push(g.ctx.time.now));
    const V3 = g.camera.position.constructor;
    window.__hv = {
      async step(n, keys = []) { for (let i = 0; i < n; i++) { await g.advance(1, 1/30, keys); await new Promise((r) => setTimeout(r, 2)); } },
      stats() {
        const cam = g.camera; cam.updateMatrixWorld(true);
        const inv = cam.matrixWorld.clone().invert();
        let x0 = 1, x1 = -1, y0 = 1, y1 = -1, n = 0, sx = 0, sy = 0, near = 9;
        const v = new V3();
        const per = {};
        for (const m of g.arms?.c?.meshes ?? []) {
          if (!m.visible || !m.geometry?.attributes?.position) continue;
          let vis = true; for (let o = m; o; o = o.parent) if (!o.visible) { vis = false; break; }
          if (!vis) continue;
          m.updateMatrixWorld(true);
          const cnt = m.geometry.attributes.position.count;
          let mx0 = 1, mx1 = -1, my0 = 1, my1 = -1;
          for (let i = 0; i < cnt; i += 3) {
            m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld);
            const c = v.clone().applyMatrix4(inv); if (-c.z < near) near = -c.z;
            v.project(cam);
            if (v.z > 1 || v.z < -1) continue;
            const px = Math.max(-1, Math.min(1, v.x)), py = Math.max(-1, Math.min(1, v.y));
            if (Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue;
            x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); n++; sx += px; sy += py;
            mx0 = Math.min(mx0, px); mx1 = Math.max(mx1, px); my0 = Math.min(my0, py); my1 = Math.max(my1, py);
          }
          if (mx1 >= mx0) per[m.name] = [mx0, mx1, my0, my1].map((q) => +q.toFixed(2));
        }
        // lens + hand_l in camera space (m; x right, y up, z forward)
        const L = g.flashlight.light; L.updateMatrixWorld(true);
        const lens = new V3().setFromMatrixPosition(L.matrixWorld).applyMatrix4(inv);
        const hb = g.arms?.c?.bones?.get('hand_l'); const hand = hb ? new V3().setFromMatrixPosition(hb.matrixWorld).applyMatrix4(inv) : null;
        const ex = g.look.exposure();
        return {
          // screen bbox in image fractions (0 = left/top, 1 = right/bottom)
          bbox: n ? [(x0 + 1) / 2, (x1 + 1) / 2, (1 - y1) / 2, (1 - y0) / 2].map((q) => +q.toFixed(3)) : null,
          centroid: n ? [+((sx / n + 1) / 2).toFixed(3), +((1 - sy / n) / 2).toFixed(3)] : null,
          nearest: +near.toFixed(3), per,
          lens: [lens.x, lens.y, -lens.z].map((q) => +q.toFixed(3)), hand: hand ? [hand.x, hand.y, -hand.z].map((q) => +q.toFixed(3)) : null,
          ev: +ex.ev.toFixed(2), pull: +(g.arms?.pull ?? 0).toFixed(3), aim: +(g.arms?.aim ?? 0).toFixed(3),
          swing: +((g.arms?.pitchSwing ?? 0) * 180 / Math.PI).toFixed(1), hoff: g.rig?.handOffset ? [g.rig.handOffset.x, g.rig.handOffset.y, g.rig.handOffset.z].map((q) => +(q * 1000).toFixed(1)) : null,
          crouch: +(g.player?.crouch ?? 0).toFixed(2), speed: +(g.player?.speedNow ?? 0).toFixed(2), fov: g.camera.fov,
          strikes: window.__hvStrikes.filter((s) => g.ctx.time.now - s < 3).length,
        };
      },
      async capture(label, w) {
        const url = await g.capture(w);
        const bmp = await createImageBitmap(await (await fetch(url)).blob());
        const cv = new OffscreenCanvas(bmp.width, bmp.height); const c2 = cv.getContext('2d'); c2.drawImage(bmp, 0, 0);
        c2.fillStyle = 'rgba(0,0,0,0.55)'; c2.fillRect(0, 0, bmp.width, 22);
        c2.fillStyle = '#fff'; c2.font = '15px monospace'; c2.fillText(label, 6, 16);
        const jpg = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
        const buf = new Uint8Array(await jpg.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        return btoa(bin);
      },
    };
    return 1;
  })()`);
  const rows = [];
  for (const id of views) {
    const V = VIEWS[id];
    let feet = V.feet;
    if (V.wall) {
      const D0 = await qa.eval(`(() => { const g = window.__game; const V3 = g.camera.position.constructor;
        const o = new V3(${V.feet[0]}, ${V.feet[2] + 1.65}, ${-V.feet[1]}); const d = new V3(Math.cos(${V.h}), 0, -Math.sin(${V.h}));
        return g.level.collision.rayDistance(o, d, 14); })()`);
      const c = Math.cos(V.h), s = Math.sin(V.h);
      feet = [V.feet[0] + c * (D0 - V.wall), V.feet[1] + s * (D0 - V.wall), V.feet[2]];
    }
    const r = await qa.eval(`(async () => {
      const g = window.__game; const hv = window.__hv;
      g.noclip(${V.wall ? 'true' : 'false'});
      g.arms?.cancelOneShot?.();
      g.ctx.events.emit('player:breath', { holding: false });
      g.goto(${feet[0]}, ${feet[1]}, ${feet[2]}, ${V.h}, ${V.p}); g.rig.snap();
      await hv.step(Math.round(${settle} * 30));
      ${V.keys ? `await hv.step(Math.round(${V.move} * 30), ${JSON.stringify(V.keys)});` : ''}
      ${V.clip ? `g.arms.play(${JSON.stringify(V.clip)}); await hv.step(Math.round(${V.at} * 30));` : ''}
      ${V.breath ? `g.ctx.events.emit('player:breath', { holding: true }); await hv.step(Math.round(${V.at} * 30));` : ''}
      const st = hv.stats();
      const label = ${JSON.stringify(id)} + '  EV ' + st.ev + '  lens ' + st.lens.join('/') + '  bbox ' + (st.bbox ? st.bbox.map((q) => q.toFixed(2)).join('/') : '-') + '  pull ' + st.pull;
      st.b64 = await hv.capture(label, ${W});
      st.ab = [];
      for (const [lab, js] of ${process.env.AB ?? '[]'}) {
        (new Function("g", js))(g); await g.advance(4, 1e-4);
        st.ab.push([lab, await hv.capture(${JSON.stringify(id)} + ' ' + lab, ${W})]);
        (new Function('g', ${JSON.stringify(process.env.RESET ?? '')}))(g); await g.advance(1, 1e-4);
      }
      if (${!!V.breath}) g.ctx.events.emit('player:breath', { holding: false });
      return st;
    })()`);
    writeFileSync(join(out, `${name}-${id}.jpg`), Buffer.from(r.b64, 'base64'));
    delete r.b64;
    for (const [lab, b64] of r.ab ?? []) writeFileSync(join(out, `${name}-${id}-${lab}.jpg`), Buffer.from(b64, 'base64'));
    delete r.ab;
    r.view = id;
    r.note = V.note;
    rows.push(r);
    qa.log(`[view] ${id} ${JSON.stringify(r)}`);
  }
  writeFileSync(join(out, `${name}-views.json`), JSON.stringify(rows, null, 1));
  qa.report.views = rows;
}
