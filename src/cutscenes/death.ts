// Death cutaway = the JUMPSCARE (3 s, unskippable; user request 2026-10-12, LEAD RULING (ap) + (au)/(av); spec:
// docs/STATUS-jumpscare.md §4). Catches happen only from B05 on, when Ada is already beheaded (C2) and carries her head:
// she lunges (0.15 s, in-engine), then HARD CUT to her severed face thrust up to the lens — the pre-rendered Cycles clip
// (src/world/jumpscare.ts plays it full-frame INSIDE the scene pass, so the game's exposure / AgX / CA / bloom /
// vignette / grain apply), or on Low / without the clip her real head held 0.28 m before the lens (the fallback) —
// for 1.0 s; black; the water closes (drowning rush); then the Director respawns the player at the checkpoint
// (teleport right after done(), camera already released).
// The brain already voiced 'ai:catch' (driver's choke + Ada's breath) — not repeated here. The old wet hand over the
// lens, the hair-filling-the-frame beat and the eye glint are gone: ONLY her face (ruling (au)).
//
//   t (s)        cue
//   0.00         lock full; Ada visible; clip ada_catch; heartbeat 0; sfx scare_whoosh (plain: the 0.15 s swell);
//                fx exposure {fixed, ramp: LUNGE_FREEZE_RAMP_S} = the exposure on screen, frozen (#147n: no meter
//                step / snap / torch near-field jump inside the 0.15 s lunge)
//   0.00–0.15    the lunge: Ada → 0.45 m before the lens (ease in; or where she already is, ≥ 0.3 m), handheld 3
//   0.15         sfx scare_sting {sched} (clock-scheduled at start: its hit lands on the cut frame);
//                fx jumpscare {on} (the cut; reducedFlash: a 2-frame ramp); fx exposure {fixed, snap}; arms hidden
//   0.15–1.15    the clip (module-timed: black after its last frame)
//   1.38 → 1.40  fade 0 → 1 (backstop black)
//   1.45         fx jumpscare {off}; fx exposure {reset}; Ada invisible
//   1.50         sfx drowning_rush (the water closing, under black)
//   3.00         arms visible; release Ada

import { add, fwd, headingTo } from './stage.ts';
import type { P3, Timeline, TimelineFactory } from './types.ts';
import { SCARE_CUT_T, SCARE_EXPOSURE, SCARE_FADE_T, SCARE_FALLBACK, SCARE_OFF_T } from '../world/jumpscare-math.ts';

export const DEATH_DURATION = 3;

/**
 * The lunge's exposure cue `{fixed: SCARE_EXPOSURE, ramp: LUNGE_FREEZE_RAMP_S}`: src/world/opening.ts starts a `ramp`
 * film cue AT THE EXPOSURE ON SCREEN (`exposureNow`), and exposure.ts's fixed branch drops any pending snap. Over 60 s
 * the smoothstep toward the cut's exposure moves < 1e-4 EV in the 0.15 s before the cut's own cue replaces it, so the
 * lunge is shot at the exposure the player was seeing: the eye cannot adapt in 0.15 s.
 * Why not `{hold}` (147n's first fix): a fast turn just before the grab (≥ 20° in the last gameplay frame) makes the
 * cutscene camera binding call the first lunge frame a CUT (bindings.ts requestExposureSnap), the meter still reads a
 * pending snap under a hold, and that reading (taken without the torch near-field term) stepped the eye +1.02 EV in one
 * lunge frame (B08 stand-still catch, QA n-c1: 0.2168 → 0.4409 — the final review's rank 5, reproduced).
 */
export const LUNGE_FREEZE_RAMP_S = 60;

export const deathCutaway: TimelineFactory = (ctx): Timeline => {
  const { eye, heading, pitch } = ctx.player;
  const fov0 = ctx.player.fov ?? 60;
  const feetZ = eye[2] - 1.65;
  // Ada lunges from where she is (or straight ahead), ending ~0.45 m in front of the lens
  const feet: P3 = [eye[0], eye[1], feetZ];
  const from = ctx.ada?.pos ?? add(feet, fwd(heading, 0, 1.2));
  // #147n (final review rank 4): a player who walked INTO her was caught with her 0.02 m from the eye's plumb line —
  // headingTo() of that near-zero vector is noise, and the lunge whip-panned to the banister / floor without her in it.
  // Closer than 0.15 m the lunge keeps the player's own heading. And she never lunges BACKWARDS: already inside 0.45 m
  // she holds her distance (min 0.3 m, the lens just clear of her body).
  const dh = Math.hypot(from[0] - eye[0], from[1] - eye[1]);
  const h = ctx.ada && dh > 0.15 ? headingTo(feet, from) : heading;
  const grab: P3 = add(feet, fwd(h, 0, ctx.ada ? Math.min(0.45, Math.max(0.3, dh)) : 0.45));
  const faceH = headingTo(grab, eye);
  const face: P3 = [grab[0], grab[1], eye[2] - 0.05];
  const look0 = add(eye, fwd(heading, pitch, 2));
  const recoil = add(eye, add(fwd(h, 0, -0.18), [0, 0, -0.12]));
  const T = SCARE_CUT_T;

  return {
    id: 'death',
    duration: DEATH_DURATION,
    lock: 'full',
    skippable: false,
    fade: [
      { t: 0, v: 0 },
      { t: SCARE_FADE_T[0], v: 0 },
      { t: SCARE_FADE_T[1], v: 1 },
    ],
    shots: [
      // the lunge: she fills the view as she comes
      { t: 0, d: T, path: [eye], target: [look0, face], fov: [fov0, 62], ease: 'in', handheld: 3 },
      // the held face: the clip quad covers the frame whatever the lens; the fallback head needs the long lens (30°)
      { t: T, d: SCARE_OFF_T - T, path: [eye], target: [face], fov: SCARE_FALLBACK.fov, handheld: 1.2 },
      // under black: the recoil, the lens back to the gameplay FOV before the respawn
      { t: SCARE_OFF_T, d: DEATH_DURATION - SCARE_OFF_T, path: [eye, recoil], target: [face, add(face, [0, 0, -0.1])], fov: [SCARE_FALLBACK.fov, fov0], ease: 'out', handheld: 1, roll: [0, 0.22] },
    ],
    moves: [{ char: 'ada', t: 0, d: T, path: [ctx.ada ? [from[0], from[1], feetZ] : add(grab, fwd(h, 0, 0.6)), grab], ease: 'in', heading: faceH }],
    cues: [
      { t: 0, type: 'lock', mode: 'full' },
      { t: 0, type: 'visible', char: 'ada', visible: true },
      { t: 0, type: 'clip', char: 'ada', clip: 'ada_catch', fade: 0.05 },
      { t: 0, type: 'heartbeat', bpm: 0 },
      { t: 0, type: 'sfx', id: 'scare_whoosh' },
      // #147n (final review rank 5: a B08 chase catch stepped its exposure mid-lunge): the eye cannot adapt in 0.15 s —
      // the exposure on screen is frozen as a film-camera cue until the cut (LUNGE_FREEZE_RAMP_S)
      { t: 0, type: 'fx', id: 'exposure', params: { fixed: SCARE_EXPOSURE, ramp: LUNGE_FREEZE_RAMP_S } },
      { t: T, type: 'sfx', id: 'scare_sting', sched: true },
      { t: T, type: 'fx', id: 'jumpscare', params: { on: true } },
      { t: T, type: 'fx', id: 'exposure', params: { fixed: SCARE_EXPOSURE, snap: true } },
      { t: T, type: 'visible', char: 'arms', visible: false },
      { t: SCARE_OFF_T, type: 'fx', id: 'jumpscare', params: { on: false } },
      { t: SCARE_OFF_T, type: 'fx', id: 'exposure', params: { reset: true } },
      { t: SCARE_OFF_T, type: 'visible', char: 'ada', visible: false },
      { t: 1.5, type: 'sfx', id: 'drowning_rush' },
      { t: DEATH_DURATION, type: 'visible', char: 'arms', visible: true },
      { t: DEATH_DURATION, type: 'release', char: 'ada' },
    ],
  };
};
