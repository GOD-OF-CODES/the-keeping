// QA hero frames — C2-ESCAPE §8.2 (the harsh art-director look) + the strike's A/V offset log + the B05 gameplay
// torch frames (pair 9, B16).
//   node scripts/shot.mjs --scenario scripts/qa/c2e-hero.mjs --preset medium --beat B03 --dist <dir> --wait 2 --shots 0 \
//        --out scratch/c2e/hero --name med [--width 1280 --height 800]
// MODE (one per session; the walk-in replays C2 from B03):
//   frames (default) — simulated time: C2 and C2c at the §8.2 marks (MARKS / C2C_MARKS override, comma lists), then
//                      B05 with the player idle at S until she holds blind at tread 10, and the torch core on her
//                      stump / carried head from the stair top (≈ 3 m) and from tread 14 (≈ 1.5 m);
//   av               — REAL time (rAF): logs the scheduled start of `cleaver_sever` (and the other sched cues) on the
//                      AudioContext clock against the presented frame of contact; asserts |offset| ≤ 1 frame (§2.3 M1).
// At most 2 images per look step: open the pairs of §8.2 two at a time.
const C2_CONTACT = 7.56; // C2-ESCAPE §2.1 (c2-room.ts C2_MARKS.contact)
const C2_LEN = 29.0;

export default async function (qa) {
  const mode = process.env.MODE ?? 'frames';
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

  if (mode === 'av') {
    await qa.game('loop.stop()');
    // hook the audio scheduling + the cutscene clock BEFORE the walk-in
    await qa.eval(`(() => {
      const g = window.__game; const A = g.story?.audio ?? g.audio ?? null;
      window.__av = { cues: [], frames: [], err: A ? null : 'no audio engine exposed' };
      if (A) {
        const play = A.play.bind(A);
        A.play = (id, o = {}) => {
          const c = A.ctx ?? A.context;
          if (['cleaver_sever', 'score_hit', 'head_drop', 'door_slam', 'arterial_spurt'].includes(id)) {
            const ts = c?.getOutputTimestamp?.();
            window.__av.cues.push({ id, when: o.when ?? null, ctxNow: c?.currentTime ?? null, perfNow: performance.now(), outLat: c?.outputLatency ?? null, tsCtx: ts?.contextTime ?? null, tsPerf: ts?.performanceTime ?? null, cs: g.cutscenes?.player?.time ?? null });
          }
          return play(id, o);
        };
      }
    })()`);
    const w = await qa.eval(walk);
    qa.log('walk ' + JSON.stringify(w));
    // real time from here: the rAF loop renders and the host's clock runs on its own
    const av = await qa.eval(`(async () => {
      const g = window.__game; g.loop.start?.();
      const t0 = performance.now();
      let contactFrame = null, last = null;
      await new Promise((res) => {
        const tick = (ts) => {
          const cs = g.cutscenes?.player;
          const t = cs?.active === 'C2' ? cs.time : null;
          if (t !== null && contactFrame === null && t >= ${C2_CONTACT}) contactFrame = { rafTs: ts, csT: t, prevCsT: last, dt: g.ctx.time.dt };
          last = t;
          if (contactFrame || performance.now() - t0 > 40000) res(); else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return { contactFrame, cues: window.__av.cues, err: window.__av.err };
    })()`);
    const sev = av.cues.find((c) => c.id === 'cleaver_sever');
    let offsetMs = null;
    if (sev && av.contactFrame && sev.when !== null) {
      // the sound's audible start (perf ms) vs the frame that shows contact (rAF timestamp + 1 frame to present)
      const SEVER_CONTACT_S = 0.11; // src/audio/synth/escape.ts: contact 110 ms into the buffer
      const audible = sev.perfNow + (sev.when - sev.ctxNow + SEVER_CONTACT_S + (sev.outLat ?? 0)) * 1000;
      const frameMs = (av.contactFrame.dt || 1 / 45) * 1000;
      const shown = av.contactFrame.rafTs + frameMs;
      offsetMs = +(audible - shown).toFixed(1);
      qa.report.av = { offsetMs, frameMs: +frameMs.toFixed(1), sev, contactFrame: av.contactFrame };
      qa.log(`A/V strike offset ${offsetMs} ms (1 frame = ${frameMs.toFixed(1)} ms)`);
      qa.assert(Math.abs(offsetMs) <= frameMs + 1, `strike A/V offset ≤ 1 frame (${offsetMs} ms)`);
    } else {
      qa.report.av = av;
      qa.log('A/V: no scheduled cleaver_sever seen ' + JSON.stringify(av).slice(0, 400));
      qa.assert(false, 'A/V: the scheduled cleaver_sever cue was logged with its AudioContext start time');
    }
    return;
  }

  // ---- frames (simulated time)
  await qa.game('loop.stop()');
  const w = await qa.eval(walk);
  qa.log('C2 start ' + JSON.stringify(w));
  qa.assert(w.started === 'C2', 'C2 started at the threshold');
  const t0 = w.t;
  const until = async (sec) => qa.eval(`(async () => { const g = window.__game; while (g.ctx.time.now - ${t0} < ${sec} - 1e-6) await g.advance(1, 1/60); return +(g.ctx.time.now - ${t0}).toFixed(3); })()`);
  const marks = (process.env.MARKS ?? '2.4,7.50,7.62,8.45,9.9,13.9,16.0,18.6,24.0,27.8').split(',').map(Number);
  const c2c = (process.env.C2C_MARKS ?? '0.33,4.0,6.62,7.1,12.6,13.85').split(',').map(Number);
  for (const m of marks) {
    const at = await until(m);
    await qa.shot(`c2-${m.toFixed(2)}`);
    qa.log(`C2 ${m} (at ${at})`);
  }
  for (const m of c2c) {
    const at = await until(C2_LEN + m);
    await qa.shot(`c2c-${m.toFixed(2)}`);
    qa.log(`C2c ${m} (at ${at})`);
  }
  // ---- B05 pair 9: idle at S until she holds blind at tread 10, then the torch core on her
  const p9 = await qa.eval(`(async () => {
    const g = window.__game; const st = () => g.storyState();
    for (let i = 0; i < 30 * 30 && (g.cutscenes?.player?.active ?? null); i++) await g.advance(1, 1/30);
    const b = g.brain; let i = 0;
    for (; i < 30 * 50 && !(b.scripted?.mode === 'b05_return' && b.scripted.phase === 'blind_wait'); i++) await g.advance(1, 1/30);
    const a = b.nav.pos; const me = g.pos();
    g.rig?.setOn?.(true);
    const stump = [a[0], a[1], a[2] + 1.42];
    const aim = (eye) => g.look(Math.atan2(stump[1] - eye[1], stump[0] - eye[0]), Math.atan2(stump[2] - eye[2], Math.hypot(stump[0] - eye[0], stump[1] - eye[1])));
    aim([me[0], me[1], me[2] + 1.65]);
    await g.advance(8, 1/30);
    return { beat: st().beat, phase: b.scripted?.phase ?? null, waitedS: +(i / 30).toFixed(1), ada: a.map((v) => +v.toFixed(2)), me: me.map((v) => +v.toFixed(2)), d: +Math.hypot(a[0] - me[0], a[1] - me[1], a[2] + 1.42 - me[2] - 1.65).toFixed(2) };
  })()`);
  qa.log('B05 far ' + JSON.stringify(p9));
  await qa.shot('b05-stump-far');
  const near = await qa.eval(`(async () => {
    const g = window.__game; const a = g.brain.nav.pos;
    // tread 14 of ST_MAIN (nosing y 3.60 + 0.28 k, z 0.60 + 0.219 k): ≈ 1.5 m above-behind her on tread 10
    const k = 14; const feet = [0.55, 3.60 + 0.28 * k + 0.14, 0.60 + 0.219 * k];
    g.goto(feet[0], feet[1], feet[2], -Math.PI / 2, 0);
    const eye = [feet[0], feet[1], feet[2] + 1.65]; const stump = [a[0], a[1], a[2] + 1.42];
    g.look(Math.atan2(stump[1] - eye[1], stump[0] - eye[0]), Math.atan2(stump[2] - eye[2], Math.hypot(stump[0] - eye[0], stump[1] - eye[1])));
    await g.advance(8, 1/30);
    return { d: +Math.hypot(stump[0] - eye[0], stump[1] - eye[1], stump[2] - eye[2]).toFixed(2), deaths: g.storyState().deathsTotal };
  })()`);
  qa.log('B05 near ' + JSON.stringify(near));
  await qa.shot('b05-stump-near');
  qa.report.c2eHero = { p9, near };
}
