// SMOOTH-FRAMES lane (contract #142, ROADMAP ruling (aj)): does C2b fire for a CAREFUL player on the real route?
//
// The gate (src/story/beats.ts onHide): the FIRST hide exit in B05 after the slat demo requests C2b only if Ada's brain
// is in VIGIL at that moment (gate 'vigil', 0.5 s) — otherwise C2b is dropped for the save. The stock bot leaves the
// armoire as soon as first_hide_done is set (she is not at her vigil yet), so no gate run ever plays it.
// This variant is scripts/qa/playthrough.mjs unchanged except for the player's patience in that one hide: the page's
// hides.exit() is held back (B05, H_ARMOIRE, first_hide_done) until her brain has been in VIGIL for SETTLE s (default
// 1.0), or MAX_WAIT s (default 60) have passed — a careful player watching through the slats until she is still at her
// door. Everything else (route, timing, asserts) is the gate's. The C2b frames are captured by cs-frames.mjs
// (SCENE=C2b, every frame, + 1 s before / 2 s after) if it fires; otherwise the run plays on to the title card.
//
//   node scripts/shot.mjs --no-build --dist scratch/dist-x --preset medium --wait 0 --shots 0 --width 960 --height 600 \
//     --timeout 2400 --scenario scripts/qa/c2b-patient.mjs --out scratch/x/c2b --name c2b
// Env: SETTLE (1.0), MAX_WAIT (60), and every cs-frames.mjs variable (SCENE defaults to C2b here).
process.env.SCENE ??= 'C2b';
const SETTLE = +(process.env.SETTLE ?? 1.0), MAX_WAIT = +(process.env.MAX_WAIT ?? 60);

export default async function (qa) {
  const { default: csFrames } = await import('./cs-frames.mjs');
  await qa.eval(`(() => { const g = window.__game; const H = g.hides; if (H.__patient) return 1; H.__patient = 1;
    const ex = H.exit.bind(H); const st = () => g.storyState(); const flags = () => ({ ...st().flags, ...g.flags() });
    const P = window.__c2bPatient = { t0: null, vigilAt: null, vigilFor: 0, exitAt: null, held: 0, trace: [], last: null, requested: null, outcome: null };
    // per frame (story clock) while she is watched from the armoire: her state; when VIGIL began; how long it held
    const D = g.director; const up = D.update.bind(D);
    D.update = (dt) => { const o = up(dt); const s = st();
      if (s.beat === 'B05' && flags().first_hide_done && P.exitAt === null) {
        const now = g.ctx.time.now; if (P.t0 === null) P.t0 = now;
        const b = g.brain; const k = b.state + (b.freezable ? '' : '(!frz)');
        if (k !== P.last) { P.trace.push([+(now - P.t0).toFixed(2), k, (b.nav?.room ?? b.room ?? '?')]); P.last = k; }
        if (b.state === 'VIGIL' && b.freezable) { if (P.vigilAt === null) P.vigilAt = +(now - P.t0).toFixed(2); P.vigilFor += dt; } else P.vigilFor = 0;
      }
      const pend = D.pendingCutscenes ?? []; if (pend.includes('C2b') && P.requested === null) P.requested = +(g.ctx.time.now - (P.t0 ?? 0)).toFixed(2);
      if (P.outcome === null && P.exitAt !== null) { const f = flags(); const a = g.cutscenes?.player?.active;
        if (a === 'C2b') P.outcome = 'played'; else if (f.cs_C2b_done && !pend.includes('C2b')) P.outcome = 'dropped'; }
      return o; };
    H.exit = (...a) => { const s = st(); const id = H.active?.id ?? null;
      if (s.beat === 'B05' && id === 'H_ARMOIRE' && flags().first_hide_done && P.t0 !== null) {
        const waited = g.ctx.time.now - P.t0;
        if (P.vigilFor < ${SETTLE} && waited < ${MAX_WAIT}) { P.held++; return false; }
        if (P.exitAt === null) P.exitAt = +waited.toFixed(2);
      }
      return ex(...a); };
    return 1; })()`);
  // report what happened once B05 is over (the scenario logs it at the end; cs-frames logs the frames)
  const rep = qa.report;
  const res = await csFrames(qa).finally(async () => {
    try {
      const P = await qa.eval('JSON.stringify(window.__c2bPatient ?? null)');
      qa.log('[c2b-patient] ' + P);
      rep.c2bPatient = JSON.parse(P);
    } catch (e) { qa.log('[c2b-patient] no state: ' + e.message); }
  });
  return res;
}
