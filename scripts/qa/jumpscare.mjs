// JUMPSCARE (#147m) QA: the death cutaway's face on the real game (docs/STATUS-jumpscare.md 147m).
//
//   node scripts/shot.mjs --no-build --dist scratch/dist-js --preset medium --beat B06 --wait 2 --shots 0 \
//        --timeout 900 --scenario scripts/qa/jumpscare.mjs --out scratch/jumpscare/qa --name js-med
//
// 1. waits for the clip prefetch (a B06 debug start is already past B05),
// 2. STEPPED: loop.stop(), the clip driven by the game clock (debug.setStepped), a catch through the story's own path
//    (director.onAiEvent catch, as respawn-idle.mjs), then 30 fps frames over the whole cutaway + the respawn: a JPG per
//    frame (<name>-st-NNN.jpg) + rows (cutscene clock, mode, clip time, gain, exposure, node builds), a lossless PNG of
//    the held frame for the exposure / noise-floor readback (<name>-held.png),
// 3. REAL TIME: loop.start(), a second catch with the clip on the wall clock; rAF frame times over the cutaway (stall
//    check), node builds at the cut (prewarm check), 2 screenshots of the face.
// Env: STEPS (default 120 = 4 s at 30 fps), HELD (default 15: the clip frame saved as PNG), SKIP_RT=1, SKIP_ST=1.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export default async function (qa) {
  const STEPS = +(process.env.STEPS ?? 120);
  const HELD = +(process.env.HELD ?? 15);
  const ev = qa.eval.bind(qa);
  const outDir = dirname((await qa.shot('js-start')) ?? '.');
  const name = process.env.NAME ?? 'js';
  const classes = () => ev(`window.__game.buildClasses()`);
  const diffClasses = (a, b) => Object.fromEntries(Object.entries(b).filter(([k, v]) => v !== (a[k] ?? 0)).map(([k, v]) => [k, v - (a[k] ?? 0)]));

  // ---- 1. the prefetch
  const st0 = await ev(`(async () => { const j = window.__game.story.jumpscare.debug;
    for (let i = 0; i < 400 && !j.state().ready && /not loaded/.test(j.state().why); i++) await new Promise((r) => setTimeout(r, 50));
    const s = j.state(); return { tier: s.tier, ready: s.ready, why: s.why, size: s.size, readyState: s.readyState, beat: window.__game.director.story.beat, severed: window.__game.ctx?.flags?.get?.('ada_severed') ?? null }; })()`);
  qa.log(`prefetch: ${JSON.stringify(st0)}`);
  qa.report.jumpscare = { prefetch: st0 };

  // ---- colour-path gate (Spec §3): the encoder's calibration chart through the quad's sampler path, ≤ 1.5 codes
  const calibFile = process.env.CALIB ?? 'scratch/jumpscare/encode/scare_face-calib-medium.mp4';
  if (existsSync(calibFile) && process.env.SKIP_CALIB !== '1') {
    const b64 = readFileSync(calibFile).toString('base64');
    const cal = await ev(`window.__game.story.jumpscare.debug.calibRead(${JSON.stringify(b64)})`).catch((e) => ({ error: String(e?.message ?? e) }));
    qa.report.jumpscare.calib = cal;
    qa.log(`calib (${calibFile}): ${JSON.stringify(cal)}`);
    qa.assert(cal?.gpu?.max <= 1.5, `colour path: calibration chart max code error ${cal?.gpu?.max} ≤ 1.5 (GPU sampler path)`);
  }

  const busy = `(() => { const g = window.__game; const s = g.storyState(); return !!(s.dead || g.director.cutscene || g.cutscenes?.player?.active); })()`;
  const ROW = `(() => { const g = window.__game; const j = g.story.jumpscare.debug.state(); const P = g.cutscenes?.player;
    const fadeEl = [...document.querySelectorAll('div')].find((d) => d.style.zIndex === '30' && d.style.background.includes('0, 0, 0'));
    return { cs: P?.active ?? null, t: +(+(P?.time ?? -1)).toFixed(3), mode: j.mode, head: j.head, tOn: +j.tOn.toFixed(3), vt: +j.videoTime.toFixed(3), media: j.media,
      gain: +(+j.gain).toFixed(3), ex: +(+(g.pipeline?.uniforms?.exposure?.value ?? -1)).toPrecision(4), builds: g.builds(), fov: +g.camera.fov.toFixed(1),
      quad: !!g.story.jumpscare.debug.quad.visible, adaVis: !!g.story.ada?.group?.visible, armsVis: !!g.story.arms?.visible,
      fade: fadeEl ? +fadeEl.style.opacity : null, csFade: +(+(document.querySelector('.tk-cs-fade')?.style?.opacity ?? 0)).toFixed(3) }; })()`;

  // ---- 2. stepped capture
  if (process.env.SKIP_ST !== '1') {
    await qa.game('loop.stop()');
    await ev(`(async () => { const g = window.__game; for (let i = 0; i < 900 && ${busy}; i++) await g.advance(1, 1/30); await g.advance(30, 1/30); return 1; })()`);
    await ev(`window.__game.story.jumpscare.debug.setStepped(true)`);
    const b0 = await qa.game('builds()');
    const c0 = await classes();
    await ev(`window.__game.director.onAiEvent({ type: 'catch', cause: 'contact' })`);
    const rows = [];
    let heldSaved = false;
    for (let i = 0; i < STEPS; i++) {
      // the frame the NEXT advance shows: decoded + uploaded before it renders
      await ev(`(async () => { const j = window.__game.story.jumpscare.debug; const s = j.state(); if (s.mode === 'clip') await j.stepTo(s.tOn + 1/30); return 1; })()`);
      await ev(`window.__game.advance(1, 1/30)`);
      const row = await ev(ROW);
      row.i = i;
      rows.push(row);
      await qa.shot(`${name}-st-${String(i).padStart(3, '0')}`);
      const k = Math.floor(row.tOn * 30 + 1e-6);
      if (!heldSaved && row.mode === 'clip' && k === HELD) {
        const png = await qa.cdp('Page.captureScreenshot', { format: 'png' });
        writeFileSync(join(outDir, `${name}-held.png`), Buffer.from(png.data, 'base64'));
        // A/B: the same frame re-rendered without bloom (is the veil over the face the bloom?)
        await ev(`(() => { const g = window.__game; const u = g.pipeline.uniforms.bloomStrength; window.__bs = u.value; u.value = 0; g.renderer._nodes?.nodeFrame?.update(); g.pipeline.render(); return 1; })()`);
        const png2 = await qa.cdp('Page.captureScreenshot', { format: 'png' });
        writeFileSync(join(outDir, `${name}-held-nobloom.png`), Buffer.from(png2.data, 'base64'));
        await ev(`(() => { window.__game.pipeline.uniforms.bloomStrength.value = window.__bs; return 1; })()`);
        heldSaved = true;
        qa.log(`held frame ${HELD} saved at step ${i}`);
      }
    }
    writeFileSync(join(outDir, `${name}-rows.json`), JSON.stringify(rows, null, 1));
    const clipRows = rows.filter((r) => r.mode === 'clip' || r.mode === 'fallback');
    qa.report.jumpscare.stepped = { builds: (await qa.game('builds()')) - b0, faceFrames: clipRows.length, first: clipRows[0] ?? null, last: clipRows.at(-1) ?? null, modes: [...new Set(rows.map((r) => r.mode))] };
    qa.report.jumpscare.stepped.newBuilds = diffClasses(c0, await classes());
    qa.log(`stepped: ${JSON.stringify(qa.report.jumpscare.stepped)}`);
    qa.assert(clipRows.length >= 28, `the face is on screen ≥ 28 frames at 30 fps (got ${clipRows.length})`);
    // reducedFlash: the same catch, stepped, with the setting on — the cut must be a 2-frame ramp (gain 0 → 0.5 → 1)
    {
      await ev(`(async () => { const g = window.__game; for (let i = 0; i < 900 && ${busy}; i++) await g.advance(1, 1/30); await g.advance(20, 1/30); return 1; })()`);
      await ev(`(() => { window.__game.ctx.settings.reducedFlash = true; return 1; })()`);
      await ev(`window.__game.director.onAiEvent({ type: 'catch', cause: 'contact' })`);
      const gains = [];
      for (let i = 0; i < 12; i++) {
        await ev(`(async () => { const j = window.__game.story.jumpscare.debug; const s = j.state(); if (s.mode === 'clip') await j.stepTo(s.tOn + 1/30); return 1; })()`);
        await ev(`window.__game.advance(1, 1/30)`);
        const r = await ev(`(() => { const s = window.__game.story.jumpscare.debug.state(); return [s.mode, +s.tOn.toFixed(3), +(+s.gain).toFixed(3)]; })()`);
        gains.push(r);
      }
      await ev(`(() => { window.__game.ctx.settings.reducedFlash = false; return 1; })()`);
      const face = gains.filter((r) => r[0] === 'clip');
      qa.report.jumpscare.reducedFlash = gains;
      qa.log(`reducedFlash cut: ${JSON.stringify(gains)}`);
      if (face.length >= 3) qa.assert(face[0][2] < 0.01 && Math.abs(face[1][2] - 0.5) < 0.01 && face[2][2] > 0.99, 'reducedFlash: the cut is a 2-frame ramp 0 → 0.5 → 1');
    }
    await ev(`window.__game.story.jumpscare.debug.setStepped(false)`);
    // let the respawn finish (stepped), then give the loop back
    await ev(`(async () => { const g = window.__game; for (let i = 0; i < 900 && ${busy}; i++) await g.advance(1, 1/30); await g.advance(20, 1/30); return 1; })()`);
    await qa.shot(`${name}-respawned`);
    await qa.game('loop.start()');
  }

  // ---- 3. real time: a catch with the face, then the same catch with the face disabled (the baseline cutaway)
  if (process.env.SKIP_RT !== '1') {
    await ev(`(() => { if (window.__lt) return 1; window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: false }); } catch {} return 1; })()`);
    // CPU ms of each pipeline.render (main-thread cost of the frame's GPU submission, incl. texture uploads)
    await ev(`(() => { const P = window.__game.pipeline; if (P.__jsWrap) return 1; P.__jsWrap = 1; const r0 = P.render.bind(P); window.__rms = 0; P.render = (...a) => { const t0 = performance.now(); const o = r0(...a); window.__rms = performance.now() - t0; return o; }; return 1; })()`);
    const runs = {};
    const VARIANTS = (process.env.RT_VARIANTS ?? 'face,face2,baseline').split(',');
    for (const variant of VARIANTS) {
      await ev(`window.__game.story.jumpscare.debug.setDisabled(${variant === 'baseline'})`);
      await ev(`window.__game.story.jumpscare.debug.setUploadMode(${JSON.stringify(variant === 'frameup' ? 'frame' : 'rvfc')})`);
      await ev(`window.__game.story.jumpscare.debug.setSceneOff(${variant !== 'facescene'})`);
      await ev(`(async () => { const g = window.__game; for (let i = 0; i < 300 && ${busy}; i++) await new Promise((r) => setTimeout(r, 50)); return 1; })()`);
      await qa.wait(3);
      await ev(`(() => { window.__ft = []; window.__ftOn = true; window.__lt.length = 0; const f = (t) => { if (!window.__ftOn) return; window.__ft.push([t, window.__game.story.jumpscare.debug.state().mode, window.__game.cutscenes?.player?.time ?? -1, +(window.__rms ?? 0).toFixed(2)]); requestAnimationFrame(f); }; requestAnimationFrame(f); return 1; })()`);
      await qa.wait(1.5);
      const b0 = await qa.game('builds()');
      const c0 = await classes();
      const prof = process.env.PROFILE === '1' && variant === 'face';
      if (prof) {
        await qa.cdp('Profiler.enable');
        await qa.cdp('Profiler.setSamplingInterval', { interval: 250 });
        await qa.cdp('Profiler.start');
      }
      const tCatch = await ev(`(window.__game.director.onAiEvent({ type: 'catch', cause: 'contact' }), performance.now())`);
      if (prof) {
        await qa.wait(0.6);
        const { profile } = await qa.cdp('Profiler.stop');
        writeFileSync(join(outDir, `${name}-cut.cpuprofile`), JSON.stringify(profile));
        // self time per function over the whole 0.6 s window (the cut is at 0.15 s)
        const byId = new Map(profile.nodes.map((n) => [n.id, n]));
        const self = new Map();
        const dts = profile.timeDeltas;
        profile.samples.forEach((id, i) => {
          const n = byId.get(id);
          const k = `${n.callFrame.functionName || '(anon)'} ${String(n.callFrame.url).split('/').pop()}:${n.callFrame.lineNumber}`;
          self.set(k, (self.get(k) ?? 0) + (dts[i] ?? 0) / 1000);
        });
        const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v.toFixed(1)}ms ${k}`);
        qa.log(`profile top self (0.6 s from the catch): ${JSON.stringify(top)}`);
      }
      if (variant === 'face' && !runs.face) {
        await qa.wait(0.55);
        await qa.shot(`${name}-rt-face1`);
        await qa.wait(0.25);
        await qa.shot(`${name}-rt-face2`);
        await qa.wait(3.4);
      } else await qa.wait(4.2);
      const ft = await ev(`(() => { window.__ftOn = false; return window.__ft; })()`);
      const lt = await ev(`window.__lt.slice()`);
      const b1 = await qa.game('builds()');
      const dt = ft.map((r, k) => [k ? +(r[0] - ft[k - 1][0]).toFixed(1) : 0, r[1], +(+r[2]).toFixed(3), +(r[0] - tCatch).toFixed(0), r[3]]).slice(1);
      const rms = (pred) => { const a = dt.filter(pred).map((r) => r[4]); return { mean: +(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(2), max: Math.max(0, ...a) }; };
      const before = dt.filter((r) => r[3] < -50).map((r) => r[0]);
      const during = dt.filter((r) => r[3] >= -20 && r[3] < 1600).map((r) => r[0]);
      const stat = (a) => ({ n: a.length, mean: +(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(1), max: Math.max(0, ...a), over50: a.filter((x) => x > 50).length, over34: a.filter((x) => x > 34).length });
      runs[variant] = { buildsAtCatch: b1 - b0, newBuilds: diffClasses(c0, await classes()), before: stat(before), during: stat(during), first30: dt.filter((r) => r[3] >= -20).slice(0, 30).map((r) => `${r[0]}${r[1] ? '*' : ''}`).join(' '), longtasks: lt.filter((e) => e[0] >= tCatch - 50 && e[0] < tCatch + 1600).map((e) => [+(e[0] - tCatch).toFixed(0), +e[1].toFixed(0)]), faceFrames: dt.filter((r) => r[1] === 'clip' || r[1] === 'fallback').length,
        renderCpuMs: { before: rms((r) => r[3] < -50), face: rms((r) => r[1] === 'clip' || r[1] === 'fallback') }, playMs: (await ev(`window.__game.story.jumpscare.debug.state().playMs`)) };
      qa.log(`real time ${variant}: ${JSON.stringify(runs[variant])}`);
    }
    await ev(`window.__game.story.jumpscare.debug.setDisabled(false)`);
    qa.report.jumpscare.realtime = runs;
    qa.assert(runs.face.faceFrames > 0, 'the face showed in the real-time run');
  }
}
