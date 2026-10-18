// FLASH lane part 2 (LOOK, contract #146c) — the AD look pass for the lead's ruling (ar) (pipeline.ts: exposure on RGB
// only; before it, every Medium/Max frame with exposure < 1 showed AgX(HDR / a) × e·a — a post-AgX dimmer). ONE
// session per (dist, preset), HEAD-compatible (only capture / look.exposure / look.hdr / goto / advance / cutscenes
// player APIs; every #146 switch guarded), so the live build and the current tree are judged on the same states:
//   C2 3.0 / 9.3 / 13.9 → C2c 7.1 / 15.5 (no input, as flash-b05.mjs) → B05: Ada carried into the torch core at 4 / 2.3 m
//   → gameplay stills (parlor lamp, entrance hall candle, upper hall, U2 Harlan's room, sewing room, U1 wall at 1 / 0.5 m)
//   → the facade from the gate and from the drive under a lightning pulse → a STEPPED U1 near-wall walk-in (every frame +
//   rows: arms pull, lens / pool on screen, displayed pool centre, applied exposure) → C5 28.6 → C6 20 (blue hour) →
//   C7 14–19.5 STEPPED (cut latency) + the sting 23.0 / 25.6.
// Per still: <out>/<name>-<view>.jpg (labelled in-canvas: TAG, view, applied exposure, meter bind) + stats in
// <out>/<name>-look.json: applied / ev / target / which, displayed sRGB luma p5 / p50 / p98 + clip % (frame and the
// centre disk r = 0.15 h), HDR patches. Stepped sequences: <out>/<name>-walk/NNNN.jpg, <out>/<name>-c7/NNNN.jpg + rows.json
// (scripts/qa/detect.py reads them).
//   TAG=after node scripts/shot.mjs --no-build --dist scratch/dist-flash-look --preset medium --beat B03 --wait 2 \
//     --shots 0 --timeout 2400 --start-timeout 900 --scenario scripts/qa/flash-look.mjs --out scratch/flash-look/<tag> --name med
// env: PARTS=route,views,facade,walk,c5,c6,c7 (subset)   W=1280   TAG=<label in the frame>
//      ALT='[["label",{look overrides}],…]' — at every gameplay still (B05 marks, views, walls) each override set is
//        applied to the SAME frozen frame, the exposure snapped to a fresh reading, captured as <view>-<label>, restored.
//      LOOKSET='{…}' — look overrides applied once at the start (a candidate tune for the whole session).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const C2_LEN = 29.0;
const DEG = Math.PI / 180;
const UP = 4.1; // upper floor (PLAN z)
const GR = 0.6; // ground floor
// feet PLAN (x east, y north, z floor), heading CCW from east, pitch (+ up). wall: eye-to-wall distance along h.
const VIEWS = {
  parlor: { feet: [6.6, 1.4, GR], h: 136 * DEG, p: -8 * DEG, note: 'parlor, kerosene lamp ahead' },
  hall: { feet: [1.8, 2.2, GR], h: 56 * DEG, p: -6 * DEG, note: 'entrance hall, candle on the hall table' },
  upper: { feet: [1.8, 1.2, UP], h: 90 * DEG, p: -4 * DEG, note: 'upper hall, looking down the hall (torch)' },
  u2: { feet: [4.65, 2.2, UP], h: 8 * DEG, p: -8 * DEG, note: "U2 Harlan's room, toward the east wall (torch)" },
  sewing: { feet: [5.0, 7.0, UP], h: 0, p: -8 * DEG, note: "Ada's sewing room (torch only)" },
  u1w1: { feet: [2.65, 4.35, UP], h: -90 * DEG, p: 0, wall: 1.0, note: 'U1 south wall (damask), eye 1.0 m' },
  u1w05: { feet: [2.65, 4.35, UP], h: -90 * DEG, p: 0, wall: 0.5, note: 'U1 south wall (damask), eye 0.5 m' },
};
const FACADE = {
  gate: { feet: [1.8, -26.5, 0], h: 90 * DEG, p: 0.16, note: 'facade from the gate (the gate view)' },
  drive: { feet: [1.9, -12, 0], h: 90 * DEG, p: 0.06, note: 'facade from the drive' },
};
const WALK = { feet: [2.65, 4.35, UP], h: -90 * DEG, d0: 3.0, note: 'U1 south wall walk-in, W held' };

export default async function (qa) {
  const out = resolve(process.argv[process.argv.indexOf('--out') + 1] ?? 'scratch/flash-look');
  const name = process.argv.includes('--name') ? process.argv[process.argv.indexOf('--name') + 1] : 'run';
  mkdirSync(out, { recursive: true });
  const PARTS = new Set((process.env.PARTS ?? 'route,views,facade,walk,c5,c6,c7').split(','));
  const W = Number(process.env.W ?? 1280);
  const TAG = process.env.TAG ?? name;
  const ALT = process.env.ALT ? JSON.parse(process.env.ALT) : [];
  const LOOKSET = process.env.LOOKSET ? JSON.parse(process.env.LOOKSET) : null;
  const stills = [];
  const saveB64 = (file, b64) => writeFileSync(file, Buffer.from(b64, 'base64'));
  const dump = () => writeFileSync(join(out, `${name}-look.json`), JSON.stringify(stills, null, 1));

  await qa.game('loop.stop()');
  await qa.eval(`(async () => {
    const g = window.__game; g.unpause?.();
    ${LOOKSET ? `g.look.set(${JSON.stringify(LOOKSET)});` : ''}
    window.__flStrikes = [];
    g.ctx.events.on('lightning', () => window.__flStrikes.push(g.ctx.time.now));
    const V3 = g.camera.position.constructor;
    const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const pct = (h, n, p) => { let a = 0; const k = p * n; for (let i = 0; i < 256; i++) { a += h[i]; if (a >= k) return i; } return 255; };
    const toB64 = async (cv, q) => { const jpg = await cv.convertToBlob({ type: 'image/jpeg', quality: q }); const buf = new Uint8Array(await jpg.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(bin); };
    window.__fl = {
      active() { return g.cutscenes?.player?.active ?? g.director?.cutscene ?? null; },
      async step(n, keys = [], dt = 1 / 30) { for (let i = 0; i < n; i++) { await g.advance(1, dt, keys); if (i % 15 === 14) await new Promise((r) => setTimeout(r, 0)); } },
      expo() {
        const ex = g.look.exposure?.() ?? {}; const last = ex.last ?? {}; const P = g.cutscenes?.player;
        return { applied: ex.applied != null ? +(+ex.applied).toFixed(4) : null, ev: ex.ev != null ? +(+ex.ev).toFixed(3) : null,
          target: ex.targetEV != null ? +(+ex.targetEV).toFixed(3) : null, which: last.which ?? null,
          log2Avg: last.log2Avg != null ? +(+last.log2Avg).toFixed(3) : null, hp: last.hp != null ? +(+last.hp).toFixed(3) : null,
          fix: last.fix != null ? +(+last.fix).toFixed(3) : null, cue: ex.cue ?? null, near: ex.near ? { G: +(+ex.near.G).toFixed(3), hit: ex.near.hitDist, subj: ex.near.subject ?? null } : null,
          cs: P?.active ? [P.active, +(+P.time).toFixed(3)] : null, t: +g.ctx.time.now.toFixed(3), torch: !!g.rig?.on,
          lt: +(g.lightning?.level ?? 0).toFixed(3), pull: g.arms?.pull != null ? +(+g.arms.pull).toFixed(3) : null };
      },
      // a labelled capture + displayed statistics (sRGB-coded luma of the JPEG the capture returns)
      async snap(label, patches, w = ${W}) {
        const st = this.expo();
        if (patches) { try { const p = await g.look.hdr(patches); st.hdr = p.map((q) => ({ n: q.name, L: q.lum != null ? +(+q.lum).toPrecision(4) : null, max: q.max != null ? +(+q.max).toPrecision(4) : null, uv: q.uv, off: q.off })); } catch (e) { st.hdr = String(e?.message ?? e); } }
        const url = await g.capture(w);
        const bmp = await createImageBitmap(await (await fetch(url)).blob());
        const cv = new OffscreenCanvas(bmp.width, bmp.height); const c2 = cv.getContext('2d'); c2.drawImage(bmp, 0, 0);
        const W2 = bmp.width, H2 = bmp.height; const px = c2.getImageData(0, 0, W2, H2).data;
        const hF = new Float64Array(256), hC = new Float64Array(256); let clip = 0, nF = 0, nC = 0, clipC = 0;
        const R = 0.15 * H2, cx = W2 / 2, cy = H2 / 2;
        for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
          const i = (y * W2 + x) * 4; const l = Math.min(255, Math.round(lum(px, i)));
          const cl = Math.max(px[i], px[i + 1], px[i + 2]) >= 250;
          hF[l]++; nF++; if (cl) clip++;
          if ((x - cx) ** 2 + (y - cy) ** 2 <= R * R) { hC[l]++; nC++; if (cl) clipC++; }
        }
        Object.assign(st, { p5: pct(hF, nF, 0.05), p50: pct(hF, nF, 0.5), p98: pct(hF, nF, 0.98), clip: +(100 * clip / nF).toFixed(2),
          cP50: pct(hC, nC, 0.5), cP98: pct(hC, nC, 0.98), cClip: +(100 * clipC / nC).toFixed(2) });
        c2.fillStyle = 'rgba(0,0,0,0.6)'; c2.fillRect(0, 0, W2, 22);
        c2.fillStyle = '#fff'; c2.font = '15px monospace';
        c2.fillText(${JSON.stringify(TAG)} + ' ' + label + '  e ' + st.applied + (st.which ? ' ' + st.which : '') + (st.cue ? ' cue' : '') + '  p50/p98 ' + st.p50 + '/' + st.p98 + ' clip ' + st.clip + '%', 6, 16);
        st.b64 = await toB64(cv, 0.9);
        st.label = label;
        return st;
      },
      // the same frozen frame under other look settings (exposure snapped to a fresh reading of each)
      async alt(label, sets, patches) {
        const orig = g.look.get(); const res = [];
        for (const [lab, s] of sets) {
          g.look.set(s); await g.advance(2, 1e-4); g.look.snap(); await g.advance(1, 1e-4);
          await new Promise((r) => setTimeout(r, 150)); await g.advance(1, 1e-4);
          res.push(await this.snap(label + '-' + lab, patches));
          g.look.set(orig);
        }
        if (sets.length) { await g.advance(1, 1e-4); g.look.snap(); await g.advance(1, 1e-4); await new Promise((r) => setTimeout(r, 150)); await g.advance(1, 1e-4); }
        return res;
      },
      wallDist(feet, h) { const o = new V3(feet[0], feet[2] + 1.65, -feet[1]); const d = new V3(Math.cos(h), 0, -Math.sin(h)); return g.level.collision.rayDistance(o, d, 14); },
    };
    return 1;
  })()`);

  const keep = async (st, file) => {
    saveB64(join(out, file ?? `${name}-${st.label}.jpg`), st.b64);
    delete st.b64;
    stills.push(st);
    qa.log(`[still] ${st.label}: e ${st.applied} ${st.which ?? '-'}${st.cue ? ' cue' : ''} cs ${JSON.stringify(st.cs)} p5/50/98 ${st.p5}/${st.p50}/${st.p98} clip ${st.clip}% · centre p50/p98 ${st.cP50}/${st.cP98} clip ${st.cClip}%${st.hdr ? ' hdr ' + JSON.stringify(st.hdr) : ''}`);
    dump();
  };
  const snap = async (label, patches, alt = false) => {
    await keep(await qa.eval(`window.__fl.snap(${JSON.stringify(label)}, ${JSON.stringify(patches ?? null)})`));
    if (alt && ALT.length) for (const st of await qa.eval(`window.__fl.alt(${JSON.stringify(label)}, ${JSON.stringify(ALT)}, ${JSON.stringify(patches ?? null)})`)) await keep(st);
  };
  const CENTRE = [{ name: 'centre', uv: [0.5, 0.5], r: 8 }, { name: 'frame', uv: [0.5, 0.5], r: 300 }];
  const GOWN = [{ name: 'gown_hip', obj: 'ada/spine_01', r: 6 }, { name: 'gown_chest', obj: 'ada/spine_03', r: 6 }, ...CENTRE];

  // ------------------------------------------------------------------ route: B03 → C2 → C2c → B05 (as flash-b05.mjs)
  if (PARTS.has('route')) {
    const w = await qa.eval(`(async () => {
      const g = window.__game; const fl = window.__fl;
      for (let i = 0; i < 900 && fl.active(); i++) await g.advance(1, 1/30);
      const legs = [[1.8, -1.5], [1.8, 0.6], [3.1, 1.5]];
      let k = 0;
      for (let i = 0; i < 30 * 40 && !fl.active(); i++) {
        const p = g.pos(); const to = legs[Math.min(k, legs.length - 1)];
        if (k < legs.length - 1 && Math.hypot(p[0] - to[0], p[1] - to[1]) < 0.3) { k++; continue; }
        g.look(Math.atan2(to[1] - p[1], to[0] - p[0]), 0);
        await g.advance(1, 1/30, Math.hypot(p[0] - to[0], p[1] - to[1]) > 0.2 ? ['KeyW'] : []);
      }
      return { started: fl.active(), t: g.ctx.time.now };
    })()`);
    qa.log('C2 start ' + JSON.stringify(w));
    qa.assert(w.started === 'C2', 'C2 started at the threshold');
    const t0 = w.t;
    const until = async (sec) => qa.eval(`(async () => { const g = window.__game; let i = 0; while (g.ctx.time.now - ${t0} < ${sec} - 1e-6) { await g.advance(1, 1/60); if (++i % 30 === 0) await new Promise((r) => setTimeout(r, 0)); } return +(g.ctx.time.now - ${t0}).toFixed(3); })()`);
    for (const [label, at] of [['c2-3.0', 3.0], ['c2-9.3', 9.3], ['c2-13.9', 13.9], ['c2c-7.1', C2_LEN + 7.1], ['c2c-15.5', C2_LEN + 15.5]]) {
      await until(at);
      await snap(label, CENTRE);
    }
    // B05: her return under the torch, the camera on her chest (as b05-carry.mjs / flash-b05.mjs)
    const pre = await qa.eval(`(async () => {
      const g = window.__game; const fl = window.__fl; const f = (v) => +v.toFixed(2);
      window.__ada = null;
      const orig = g.director.update.bind(g.director);
      g.director.update = (dt) => { const o = orig(dt); if (o) window.__ada = o; return o; };
      for (let i = 0; i < 30 * 90 && fl.active(); i++) await g.advance(1, 1/30);
      const s = g.storyState();
      g.rig.setOn(true);
      window.__b05 = { t: 0, d0: s.deathsTotal, minD: 99, next: 0 };
      return { beat: s.beat, me: g.pos().map(f), torch: g.rig.on };
    })()`);
    qa.log('B05 ' + JSON.stringify(pre));
    const MARKS = (process.env.DISTS ?? '4,2.3').split(',').map(Number).sort((a, b) => b - a);
    for (let chunk = 0; chunk < 400; chunk++) {
      const r = JSON.parse(await qa.eval(`(async () => {
        const g = window.__game; const B = window.__b05; const f = (v) => +v.toFixed(2);
        const marks = ${JSON.stringify(MARKS)};
        for (let i = 0; i < 90; i++) {
          const a = window.__ada; const me = g.pos(); const eye = [me[0], me[1], me[2] + 1.65];
          let d = 99;
          if (a?.pos && a.visible) {
            const chest = [a.pos[0], a.pos[1], a.pos[2] + 1.25];
            const dx = chest[0] - eye[0], dy = chest[1] - eye[1], dz = chest[2] - eye[2];
            const h = Math.hypot(dx, dy); d = Math.hypot(h, dz);
            g.look(Math.atan2(dy, dx), Math.atan2(dz, h));
          }
          await g.advance(1, 1/30);
          B.t += 1/30;
          const s = g.storyState();
          if (s.deathsTotal > B.d0 || s.dead) return JSON.stringify({ end: 'caught', t: f(B.t) });
          if (d < B.minD) B.minD = d;
          if (B.next < marks.length && d <= marks[B.next]) { const mark = marks[B.next]; B.next++; return JSON.stringify({ shot: mark, d: f(d), t: f(B.t) }); }
          if (B.next >= marks.length) return JSON.stringify({ end: 'done', t: f(B.t) });
          if (B.t > 80) return JSON.stringify({ end: 'timeout', t: f(B.t), minD: f(B.minD) });
        }
        return JSON.stringify({ t: f(B.t) });
      })()`));
      if (r.end) { qa.log('B05 end ' + JSON.stringify(r)); break; }
      if (!r.shot) continue;
      qa.log(`[b05] mark ${r.shot} m at d ${r.d} (t ${r.t})`);
      await snap(`b05-${r.shot}m`, GOWN, true);
    }
  }

  // ------------------------------------------------------------------ gameplay stills (Ada scripted away, torch on)
  const toGameplay = async () => qa.eval(`(async () => {
    const g = window.__game; const fl = window.__fl;
    for (let k = 0; k < 6; k++) { const c = g.cutscenes?.player; const id = c?.active ?? null; if (!id) break; c.skip(true); await fl.step(45); }
    for (let i = 0; i < 30 * 40 && fl.active(); i++) await g.advance(1, 1/30);
    g.brain?.setScripted?.('hidden');
    g.hides?.exit?.();
    await fl.step(20);
    if (g.player) { g.player.enabled = true; g.player.lookEnabled = true; }
    if (!g.rig.on) g.rig.setOn(true);
    return g.storyState?.().beat ?? null;
  })()`);
  const feetFor = async (V) => {
    if (!V.wall) return V.feet;
    const D0 = await qa.eval(`window.__fl.wallDist(${JSON.stringify(V.feet)}, ${V.h})`);
    const c = Math.cos(V.h), s = Math.sin(V.h);
    return [V.feet[0] + c * (D0 - V.wall), V.feet[1] + s * (D0 - V.wall), V.feet[2]];
  };
  const place = async (V, settle = 2) => {
    const f = await feetFor(V);
    return qa.eval(`(async () => {
      const g = window.__game; const fl = window.__fl;
      g.noclip?.(${V.wall ? 'true' : 'false'});
      g.goto(${f[0]}, ${f[1]}, ${f[2]}, ${V.h}, ${V.p}); g.rig.snap?.();
      await fl.step(12);
      g.goto(${f[0]}, ${f[1]}, ${f[2]}, ${V.h}, ${V.p}); g.rig.snap?.();
      g.look.snap?.(); await fl.step(2); await new Promise((r) => setTimeout(r, 150));
      await fl.step(Math.round(${settle} * 30));
      return g.room?.() ?? null;
    })()`);
  };
  if (PARTS.has('views')) {
    qa.log('views from beat ' + (await toGameplay()));
    for (const [id, V] of Object.entries(VIEWS)) {
      const room = await place(V);
      qa.log(`[view] ${id} room ${room}: ${V.note}`);
      await snap(id, CENTRE, true);
    }
  }
  if (PARTS.has('facade')) {
    if (!PARTS.has('views')) await toGameplay();
    for (const [id, V] of Object.entries(FACADE)) {
      await place(V, 2.5);
      // the dark frame first (control: exposure ≥ 1 outdoors), then a lightning pulse near its peak (level > 0.6)
      await snap(`${id}-dark`, CENTRE);
      const lv = await qa.eval(`(async () => { const g = window.__game; g.lightning.strike(); let lv = 0; for (let i = 0; i < 30; i++) { await g.advance(1, 1/60); lv = g.lightning.level; if (lv > 0.6) break; } return lv; })()`);
      qa.log(`[facade] ${id} lightning level ${lv}`);
      await snap(`${id}-flash`, CENTRE);
      await qa.eval(`window.__fl.step(90)`);
    }
  }

  // ------------------------------------------------------------------ stepped near-wall walk-in (pull-in pops, pool)
  if (PARTS.has('walk')) {
    if (!PARTS.has('views') && !PARTS.has('facade')) await toGameplay();
    const dir = join(out, `${name}-walk`);
    mkdirSync(dir, { recursive: true });
    const V = { ...WALK, wall: WALK.d0, p: 0 };
    const f = await feetFor(V);
    const D0 = await qa.eval(`window.__fl.wallDist(${JSON.stringify(WALK.feet)}, ${WALK.h})`);
    const c = Math.cos(WALK.h), s = Math.sin(WALK.h);
    const wall = { p: [WALK.feet[0] + c * D0, WALK.feet[2] + 1.65, -(WALK.feet[1] + s * D0)], n: [-c, 0, s] };
    await qa.eval(`(async () => { const g = window.__game; g.noclip?.(false); g.goto(${f[0]}, ${f[1]}, ${f[2]}, ${WALK.h}, 0); g.rig.snap?.(); g.look.snap?.(); await window.__fl.step(150); return 1; })()`);
    const rows = [];
    let lastEye = 1e9, still = 0;
    for (let k = 0; k < 150 && still < 20; k++) {
      const r = await qa.eval(`(async () => {
        const g = window.__game; const fl = window.__fl; const V3 = g.camera.position.constructor;
        await g.advance(1, 1/30, ['KeyW']);
        const cam = g.camera; cam.updateMatrixWorld(true);
        const L = g.flashlight?.light ?? g.rig?.flashlight?.light; L.updateMatrixWorld(true); L.target.updateMatrixWorld(true);
        const lens = new V3().setFromMatrixPosition(L.matrixWorld); const tgt = new V3().setFromMatrixPosition(L.target.matrixWorld);
        const bd = tgt.clone().sub(lens).normalize();
        const n = new V3(...${JSON.stringify(wall.n)}), P = new V3(...${JSON.stringify(wall.p)});
        const sd = (v) => v.clone().sub(P).dot(n);
        const eye = new V3().setFromMatrixPosition(cam.matrixWorld);
        const den = bd.dot(n); const tHit = den < -1e-4 ? -sd(lens) / den : NaN;
        const hit = Number.isFinite(tHit) ? lens.clone().addScaledVector(bd, tHit) : P.clone();
        const W2 = 640;
        const url = await g.capture(W2);
        const bmp = await createImageBitmap(await (await fetch(url)).blob());
        const cv = new OffscreenCanvas(bmp.width, bmp.height); const c2 = cv.getContext('2d'); c2.drawImage(bmp, 0, 0);
        const w = bmp.width, h = bmp.height; const px = c2.getImageData(0, 0, w, h).data;
        const q = hit.clone().project(cam); const cx = (q.x + 1) / 2 * w, cy = (1 - q.y) / 2 * h;
        const lp = lens.clone().project(cam);
        let s0 = 0, n0 = 0;
        for (let y = Math.max(0, Math.floor(cy - 4)); y <= Math.min(h - 1, Math.ceil(cy + 4)); y++) for (let x = Math.max(0, Math.floor(cx - 4)); x <= Math.min(w - 1, Math.ceil(cx + 4)); x++) {
          if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > 9) continue; const i = (y * w + x) * 4; s0 += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; n0++;
        }
        const d = cam.getWorldDirection(cam.position.clone());
        const jpg = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
        const buf = new Uint8Array(await jpg.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        const ex = fl.expo();
        return { b64: btoa(bin), id: null, t: ex.t, cp: [eye.x, -eye.z, eye.y].map((v) => +v.toFixed(3)), hd: +Math.atan2(-d.z, d.x).toFixed(4), pt: +Math.asin(Math.max(-1, Math.min(1, d.y))).toFixed(4),
          fov: +cam.fov.toFixed(2), dr: null, lt: ex.lt, ex: ex.applied, ev: ex.ev, which: ex.which, pull: ex.pull, aim: g.arms?.aim != null ? +(+g.arms.aim).toFixed(3) : null,
          eyeWall: +sd(eye).toFixed(3), lensWall: +sd(lens).toFixed(3), lensPx: [+((lp.x + 1) / 2 * w).toFixed(1), +((1 - lp.y) / 2 * h).toFixed(1)],
          poolPx: [+cx.toFixed(1), +cy.toFixed(1)], centre: n0 ? +(s0 / n0).toFixed(1) : null, strikes: window.__flStrikes.filter((s) => g.ctx.time.now - s < 3).length };
      })()`);
      saveB64(join(dir, String(rows.length).padStart(4, '0') + '.jpg'), r.b64);
      delete r.b64;
      r.n = rows.length;
      rows.push(r);
      if (Math.abs(r.eyeWall - lastEye) < 0.003) still++; else still = 0;
      lastEye = r.eyeWall;
    }
    writeFileSync(join(dir, 'rows.json'), JSON.stringify(rows));
    let maxLens = 0, maxPool = 0, minCentreStep = 0, at = null;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      maxLens = Math.max(maxLens, Math.hypot(b.lensPx[0] - a.lensPx[0], b.lensPx[1] - a.lensPx[1]));
      maxPool = Math.max(maxPool, Math.hypot(b.poolPx[0] - a.poolPx[0], b.poolPx[1] - a.poolPx[1]));
      if (b.centre != null && a.centre != null && b.centre - a.centre < minCentreStep) { minCentreStep = b.centre - a.centre; at = i; }
    }
    qa.report.walk = { frames: rows.length, from: rows[0]?.eyeWall, to: rows[rows.length - 1]?.eyeWall, maxLensStepPx: +maxLens.toFixed(1), maxPoolStepPx: +maxPool.toFixed(1), worstCentreStep: +minCentreStep.toFixed(1), at };
    qa.log('[walk] ' + JSON.stringify(qa.report.walk) + ' → ' + dir);
  }

  // ------------------------------------------------------------------ cutscenes played directly (same state on both dists)
  const play = async (id, pre = '') => qa.eval(`(async () => {
    const g = window.__game; const fl = window.__fl;
    for (let k = 0; k < 6; k++) { const c = g.cutscenes?.player; const a = c?.active ?? null; if (!a) break; c.skip(true); await fl.step(45); }
    ${pre}
    window.__csDone = null;
    const ok = g.cutscenes.player.play(${JSON.stringify(id)}, (s) => { window.__csDone = s ?? 'done'; });
    return { ok, active: g.cutscenes.player.active };
  })()`);
  const runTo = async (id, t, gates = false) => qa.eval(`(async () => {
    const g = window.__game; const P = g.cutscenes.player; let i = 0;
    while (P.active === ${JSON.stringify(id)} && P.time < ${t} - 1e-6 && i < 30 * 120) {
      ${gates ? `P.resolveGate?.('pour'); P.resolveGate?.('key');` : ''}
      await g.advance(1, 1/30); if (++i % 15 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    return [P.active, +(+P.time).toFixed(3)];
  })()`);
  if (PARTS.has('c5')) {
    qa.log('C5 ' + JSON.stringify(await play('C5')));
    qa.log('C5 at ' + JSON.stringify(await runTo('C5', 28.6)));
    await snap('c5-28.6', CENTRE);
  }
  if (PARTS.has('c6')) {
    qa.log('C6 ' + JSON.stringify(await play('C6', `g.goto(11.5, -4.5, 0, 0.3, 0); await fl.step(10); g.cutscenes.deps?.world?.fx?.('blue_hour', { mist: 1, rain: 0 });`)));
    qa.log('C6 at ' + JSON.stringify(await runTo('C6', 20.0, true)));
    await snap('c6-20.0', CENTRE);
  }
  if (PARTS.has('c7')) {
    qa.log('C7 ' + JSON.stringify(await play('C7')));
    qa.log('C7 at ' + JSON.stringify(await runTo('C7', 14.0)));
    const dir = join(out, `${name}-c7`);
    mkdirSync(dir, { recursive: true });
    const rows = [];
    for (let k = 0; k < 30 * 6; k++) {
      const r = await qa.eval(`(async () => {
        const g = window.__game; const P = g.cutscenes.player; const fl = window.__fl;
        if (${k} > 0) await g.advance(1, 1/30);
        const c = g.camera; const d = c.getWorldDirection(c.position.clone());
        const url = await g.capture(640);
        const ex = fl.expo();
        return { b64: url.split(',')[1], id: P.active, t: +(+P.time).toFixed(3), cp: [c.position.x, -c.position.z, c.position.y].map((v) => +v.toFixed(3)),
          hd: +Math.atan2(-d.z, d.x).toFixed(4), pt: +Math.asin(Math.max(-1, Math.min(1, d.y))).toFixed(4), fov: +c.fov.toFixed(2), dr: null, lt: ex.lt, ex: ex.applied, ev: ex.ev, target: ex.target, cue: ex.cue };
      })()`);
      if (r.id !== 'C7' || r.t > 19.5) break;
      saveB64(join(dir, String(rows.length).padStart(4, '0') + '.jpg'), r.b64);
      delete r.b64;
      r.n = rows.length;
      rows.push(r);
    }
    writeFileSync(join(dir, 'rows.json'), JSON.stringify(rows));
    qa.log(`[c7] ${rows.length} stepped frames ${rows[0]?.t}–${rows[rows.length - 1]?.t} → ${dir}`);
    for (const t of [23.0, 25.6]) {
      qa.log('C7 at ' + JSON.stringify(await runTo('C7', t)));
      await snap(`c7-${t.toFixed(1)}`, CENTRE);
    }
  }
  qa.report.look = stills;
  dump();
}
