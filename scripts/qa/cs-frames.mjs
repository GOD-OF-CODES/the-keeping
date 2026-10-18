// SMOOTH-FRAMES lane (contract #142, ROADMAP ruling (ak)/(am)): EVERY FRAME of chosen cutscenes ON THE REAL ROUTE.
//
// Wraps scripts/qa/playthrough.mjs (its logic and default behaviour untouched — the bot plays the game exactly as in
// the gate). While a target cutscene runs, plus PRE s before it (a ring buffer of the last frames, kept only while the
// bot is in a beat the scene can start from) and POST s after it (the hand-off to gameplay / the chained scene), the
// game is stepped ONE bot frame (1/30 s) at a time and every frame is captured as a JPG with a ROWS entry: cutscene id
// + its own clock, beat, bot time, camera PLAN pose (eye, heading, pitch, fov) and the frame's draws / triangles (every
// render target: shadows, probes, post).
//
//   SCENE=C3,C5 node scripts/shot.mjs --no-build --dist scratch/dist-x --preset medium --wait 0 --shots 0 \
//     --timeout 2400 --scenario scripts/qa/cs-frames.mjs --out scratch/x/cap --name cs
//
// Env: SCENE  comma list of cutscene ids (C0 C1 C2 C2c C2b C3 C4 C4a C4c C5 C5b C6 C6b C7 CR; 'C4' = the hem overlay
//             C4_approach/hem/look/leave); chained scenes (C6 → C6b → C7 → CR) land in one continuous segment.
//      FPS    capture rate (default 30 = every bot frame; 15 = every 2nd).  FROM / TO  the scene clock window (s) to
//             capture (default all; PRE / POST then count from the window's edges).  PRE (1) / POST (2) seconds.
//      WINDOWS JSON {scene: [[t0, t1], …]} per-scene clock windows (the Max re-check of changed moments only).
//      STOP   1 (default): end the run once every target scene was captured (the playthrough's gate asserts are then
//             logged as skipped, not failed). STOP=0 plays on to the title card and keeps the asserts.
//      WATCH  JSON {scene: [beats]} overrides the beats the ring buffer runs in.
// Output: <out>/<segment>/NNNN.jpg + <out>/<segment>/rows.json (rows[i] ↔ NNNN = i), segment = '<first scene>-<k>'.
// Then:   python3 scripts/qa/detect.py <out>/<segment> --out <dir>   ·   python3 scripts/qa/strip.py <seq> <out.jpg> frames…
import pt from './playthrough.mjs';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SCENES = (process.env.SCENE ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const FPS = +(process.env.FPS ?? 30);
const EVERY = Math.max(1, Math.round(30 / FPS));
const FROM = +(process.env.FROM ?? -1e9), TO = +(process.env.TO ?? 1e9);
const PRE = +(process.env.PRE ?? 1), POST = +(process.env.POST ?? 2);
const STOP = process.env.STOP !== '0';
const PROBE = +(process.env.PROBE ?? 0);
/** FIX lane (#145b): XROW='<page JS expression>' — evaluated with `g` = window.__game on every captured row and stored as
 *  row.x (diagnosis: door angles, the torch's shadow state, its aim …). Errors are stored as the message. */
const XROW = process.env.XROW ?? '';
/** WINDOWS='{"C1":[[3,7],[17,31]]}': per-scene clock windows (override FROM/TO for those scenes; each window its own
 *  segment when they are > POST apart) — the Max re-check of only the changed moments. */
const WINDOWS = process.env.WINDOWS ? JSON.parse(process.env.WINDOWS) : {};
const PRE_N = Math.round((PRE * 30) / EVERY), POST_N = Math.round(POST * 30);
// the beats each scene can START from (its pre-roll ring buffer runs only there); chained scenes start from the
// scene before them, so their predecessor's beats are listed too
const WATCH = {
  C0: [], C1: ['B01'], C2: ['B03'], C2c: ['B03', 'B04'], C2b: ['B05'], C3: ['B06'], C4: ['B09'], C4a: ['B08', 'B09'],
  C4c: ['B11'], C5: ['B11'], C5b: ['B12'], C6: ['B12'], C6b: ['B12', 'B13'], C7: ['B12', 'B13'], CR: ['B13'],
  ...(process.env.WATCH ? JSON.parse(process.env.WATCH) : {}),
};
const sceneOf = (id) => (id && /^C4_/.test(id) ? 'C4' : id);

export default async function (qa) {
  if (!SCENES.length) throw new Error('cs-frames: set SCENE (e.g. SCENE=C3,C5)');
  const outRoot = dirname((await qa.shot('cs-start')) ?? '.');
  const watchBeats = new Set(SCENES.flatMap((s) => WATCH[s] ?? []));
  // per-frame draws / triangles of every render target (renderer.info.update wrapped; the pipeline.render total)
  await qa.eval(`(() => { const g = window.__game; const info = g.renderer.info; if (info.__csf) return 1; info.__csf = 1;
    const orig = info.update.bind(info); let d = 0, t = 0;
    info.update = (o, c, n) => { d++; t += o.isMesh ? n * c / 3 : 0; return orig(o, c, n); };
    const P = g.pipeline; const r0 = P.render.bind(P);
    P.render = (...a) => { d = 0; t = 0; const out = r0(...a); window.__csfLast = [d, Math.round(t)]; return out; };
    return 1; })()`);
  const ev = qa.eval.bind(qa);
  const seen = new Set(); // target scenes captured
  const done = new Set(); // target scenes captured and over (past their last window, or no longer running)
  const lastEnd = (sc) => (WINDOWS[sc] ? Math.max(...WINDOWS[sc].map((w) => w[1])) : TO);
  const ring = []; // { file, row } pre-roll frames (deleted once older than PRE)
  let seg = null; // { name, frames: [{file,row}], post: n left after the window closed }
  let segN = 0, frameK = 0, stepN = 0, stopNow = false;
  const segments = [];
  const ROW = `(() => { const g = window.__game; const P = g.cutscenes?.player; const c = g.camera; const d = c.getWorldDirection(c.position.clone());
    const b = window.__bot; const id = P?.active ?? (g.cutscenes?.hem?.current ?? null);
    return { id, t: +(+(P?.time ?? -1)).toFixed(3), beat: g.director.story.beat, bt: +b.t.toFixed(3),
      cp: [c.position.x, -c.position.z, c.position.y].map((v) => +v.toFixed(3)), hd: +Math.atan2(-d.z, d.x).toFixed(4), pt: +Math.asin(Math.max(-1, Math.min(1, d.y))).toFixed(4),
      fov: +c.fov.toFixed(2), dr: window.__csfLast ?? null, hid: g.hides?.active?.id ?? null, lt: +(g.lightning?.level ?? 0).toFixed(3),
      ex: (() => { try { const m = g.look?.meter?.(); return m && m.exposure != null ? +(+m.exposure).toPrecision(4) : null; } catch { return null; } })(),
      tl: (() => { try { const L = g.rig?.flashlight?.light; if (!L) return null; const p = L.getWorldPosition(c.position.clone()); return [+p.x.toFixed(3), +(-p.z).toFixed(3), +p.y.toFixed(3), +(+L.intensity).toPrecision(3), g.rig.on ? 1 : 0]; } catch { return null; } })()${XROW ? `, x: (() => { try { return (${XROW}); } catch (e) { return String(e && e.message || e); } })()` : ''} }; })()`;
  const finishSeg = () => {
    if (!seg) return;
    const dir = join(outRoot, seg.name);
    mkdirSync(dir, { recursive: true });
    const rows = [];
    seg.frames.forEach((f, i) => {
      const to = join(dir, String(i).padStart(4, '0') + '.jpg');
      try { renameSync(f.file, to); } catch {}
      rows.push({ n: i, ...f.row });
    });
    writeFileSync(join(dir, 'rows.json'), JSON.stringify(rows));
    const ids = [...new Set(rows.map((r) => r.id).filter(Boolean))];
    qa.log(`[cs-frames] segment ${seg.name}: ${rows.length} frames (${ids.join(' → ')}) → ${dir}`);
    segments.push({ name: seg.name, dir, frames: rows.length, ids });
    seg = null;
    if (STOP && SCENES.every((s) => done.has(s))) stopNow = true;
  };
  const shoot = async (row) => {
    const k = frameK;
    const file = await qa.shot(`f${String(frameK++).padStart(5, '0')}`);
    if (qa.report?.shots?.length) qa.report.shots.pop(); // thousands of frames: keep the report readable
    // FIX lane (#145): PROBE=n — the PRE-exposure HDR scene radiance (look.hdr, the meter's own texture) of the centre
    // 62 % × 100 % of the frame on every n-th captured frame: row.hl = [mean lum, max] (cd/m²-like scene units)
    if (PROBE > 0 && k % PROBE === 0) {
      try {
        const h = await ev(`(async () => { const o = await window.__game.look.hdr({ name: 'c', uv: [0.5, 0.5], r: 300 }); return o?.[0] ?? null; })()`);
        if (h && h.lum != null) row.hl = [h.lum, h.max];
      } catch {}
    }
    return { file, row };
  };
  const inWindow = (r) => {
    const sc = sceneOf(r.id);
    if (!SCENES.includes(sc)) return false;
    const w = WINDOWS[sc];
    return w ? w.some(([a, b]) => r.t >= a - 1e-6 && r.t <= b + 1e-6) : r.t >= FROM - 1e-6 && r.t <= TO + 1e-6;
  };

  /** One bot frame + its row; captures when a segment is open, the window is on, or the ring buffer runs. */
  const step = async () => {
    const st = await ev(`(async () => { const s = await __bot.run(0.0167); return { s, r: ${ROW} }; })()`);
    const { s, r } = st;
    const win = inWindow(r);
    for (const sc of seen) if (!done.has(sc) && (sceneOf(r.id) !== sc || r.t > lastEnd(sc) + 1e-6)) done.add(sc);
    const watch = !win && !seg && (watchBeats.has(r.beat) || (r.id && SCENES.includes(sceneOf(r.id))));
    const take = stepN++ % EVERY === 0;
    if (win) {
      seen.add(sceneOf(r.id));
      if (!seg) {
        seg = { name: `${sceneOf(r.id)}-${segN++}`, frames: ring.splice(0), post: POST_N };
        qa.log(`[cs-frames] ${r.id} @ ${r.t} (beat ${r.beat}, bot ${r.bt}s): capture on (${seg.frames.length} pre-roll frames)`);
      }
      seg.post = POST_N;
      if (take) seg.frames.push(await shoot(r));
    } else if (seg) {
      if (take) seg.frames.push(await shoot(r));
      if (--seg.post <= 0) finishSeg();
    } else if (watch) {
      if (take) ring.push(await shoot(r));
      while (ring.length > PRE_N) rmSync(ring.shift().file, { force: true });
    } else if (ring.length) for (const f of ring.splice(0)) rmSync(f.file, { force: true });
    return { s, r, busy: win || !!seg || watch };
  };

  qa.eval = async (code, ...rest) => {
    if (code !== '__bot.run(30)') return ev(code, ...rest);
    if (stopNow) return { ...(await ev('__bot.status()')), ended: true };
    const t0 = await ev('__bot.t');
    let want = null, last = null;
    for (let guard = 0; guard < 4000; guard++) {
      const now = await ev('__bot.t');
      const left = t0 + 30 - now;
      if (left <= 1e-3) break;
      const probe = await ev(`(() => { const g = window.__game; const P = g.cutscenes?.player; const id = P?.active ?? (g.cutscenes?.hem?.current ?? null); return [id, g.director.story.beat]; })()`);
      const busy = seg || watchBeats.has(probe[1]) || (probe[0] && SCENES.includes(sceneOf(probe[0])));
      if (!busy) {
        // free running: 1 s chunks (a scene that starts from an unexpected beat is still caught within 1 s)
        last = await ev(`__bot.run(${Math.min(left, 1).toFixed(4)})`);
      } else {
        const st = await step();
        last = st.s;
      }
      // a hero shot (the playthrough aims the camera for it) must be taken NOW, as the stock 30 s chunk does — carrying
      // it to the chunk's end aimed the camera in the middle of the next cutscene (capA C3 4.17: 'harlan-bedroom')
      if (last?.want) { want = last.want; break; }
      if (last?.ended || last?.stalled || stopNow) break;
    }
    if (stopNow) {
      qa.log('[cs-frames] every target scene captured — ending the run here (STOP=1; gate asserts skipped)');
      const a = qa.assert.bind(qa);
      qa.assert = (c, m) => (c ? a(c, m) : qa.log(`[cs-frames] assert skipped (STOP=1): ${m}`));
      return { ...(await ev('__bot.status()')), ended: true, want: null };
    }
    const s = last ?? (await ev('__bot.status()'));
    return want && !s.want ? { ...s, want } : s;
  };
  await pt(qa);
  finishSeg();
  for (const f of ring.splice(0)) rmSync(f.file, { force: true });
  qa.report.csFrames = { scenes: SCENES, captured: [...seen], segments };
  qa.log('[cs-frames] ' + JSON.stringify(qa.report.csFrames));
}
