// C2b 'Her Door' (B05, 11 s, M-A) — docs/CUTSCENES-PLAN.md §3. The first hide exit after `first_hide_done` with the
// brain in VIGIL at U_VIGIL (the story's trigger + the §4 safety gate; the brain is frozen for the cutscene and resumes
// with a 2 s deaf grace). The stealth set-up as an image: the monster shut out of her own room. Plants the nailed door
// (B08) and the dress (B09).
//
// Faces hidden (§3 audit): a silhouette lit for one 0.4 s flash, then a nail macro framed below her hairline, then a
// foot. Ada is NOT placed: the brain holds her at her vigil; the cutscene only drives her clip and hands her back.
// Nothing changes state except the shadow light (back at the lamp at the end, as C2c leaves it) — a skip lands on the
// player's own eye.

import { add, focusAt, fwd, lens } from './stage.ts';
import type { Cue, P3, TimelineFactory } from './types.ts';

export const C2B_DURATION = 11;
/** CUTSCENES-PLAN §3 C2b shot 1 eye (the armoire mouth, upper floor eye height). */
export const ARMOIRE_MOUTH_EYE: P3 = [2.9, 4.9, 5.75];
/** U_VIGIL (layout aiNodes) and D_ADA's centre at head height (the nailed door, U3's west door). */
export const U_VIGIL: P3 = [3.2, 8.2, 4.1];
export const D_ADA_HEAD: P3 = [3.675, 8.2, 5.1];
/** The middle board's nail head (the macro's subject). */
export const NAIL_HEAD: P3 = [3.61, 8.15, 5.55]; // at her left index (ada_vigil, measured: root + (0.40, −0.06, 1.47))
/** The lightning stroke through the U1 south window behind the player (C2c's window light, softer). */
export const C2B_STROKE = { t: 1.0, pulses: '0.45@0,0.7@0.1,0.5@0.22:0.16' } as const;

export const c2bDoor: TimelineFactory = (ctx) => {
  const eye0 = ctx.player.eye;
  const look0 = add(eye0, fwd(ctx.player.heading, ctx.player.pitch, 3));
  const ada = ctx.ada?.pos ?? U_VIGIL;
  const adaBack: P3 = [ada[0], ada[1], ada[2] + 1.15];
  const macroEye: P3 = [3.35, 7.85, 5.45];
  const footEye: P3 = [2.95, 7.25, 4.24];
  // her right foot (ada_vigil, measured: root + (0.01, −0.10, 0.06)) and the hem above it
  const foot: P3 = [ada[0] + 0.05, ada[1] - 0.1, ada[2] + 0.12];

  const torch = ctx.player.torch !== false;
  // the release shot's gaze (its target eases adaBack → look0, inOut) and the beam's aim easing from the runner to it
  const runner: P3 = [eye0[0] + 0.3, eye0[1] + 0.9, eye0[2] - 1.6];
  const beamRise: Cue[] = [];
  for (let k = 0; k <= 30; k++) {
    const t = 9.5 + (1.45 * k) / 30;
    const u = Math.min(1, (t - 9.5) / 1.5);
    const e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
    const gaze: P3 = [adaBack[0] + (look0[0] - adaBack[0]) * e, adaBack[1] + (look0[1] - adaBack[1]) * e, adaBack[2] + (look0[2] - adaBack[2]) * e];
    const w = e; // the hand lifts with the head
    const at: P3 = [runner[0] + (gaze[0] - runner[0]) * w, runner[1] + (gaze[1] - runner[1]) * w, runner[2] + (gaze[2] - runner[2]) * w];
    beamRise.push({ t: Math.round(t * 1000) / 1000, type: 'fx', id: 'beamClamp', params: { on: true, atX: at[0], atY: at[1], atZ: at[2] } });
  }
  const cues: Cue[] = [
    { t: 0, type: 'lock', mode: 'full' },
    { t: 0, type: 'light', op: 'storm_auto', on: false },
    { t: 0, type: 'clip', char: 'ada', clip: 'ada_vigil', loop: true, fade: 0.3 },
    { t: 0, type: 'clip', char: 'arms', clip: 'arms_breath_hold', fallback: ['arms_idle'] },
    { t: 0, type: 'dof', dof: focusAt(eye0, adaBack, 1.4, 2.2) },
    { t: 0.2, type: 'sfx', id: 'ada_scrape_wood', pos: NAIL_HEAD, room: 'U1', gain: 0.7 },
    // lightning through the south window behind you: the balusters' shadow bars up the runner and across her back
    { t: C2B_STROKE.t, type: 'fx', id: 'shadowLight', params: { at: 'u1_window', pulses: C2B_STROKE.pulses } },
    { t: 1.6, type: 'fx', id: 'shadowLight', params: { at: 'lamp' } },
    // the storm's own strike (window flash + its thunder) under the roaming window light
    { t: C2B_STROKE.t, type: 'light', op: 'lightning', strength: 0.55 },
    // the torch lowered to the runner at your feet: she stays a silhouette (spec: flashlight forced low)
    { t: 0, type: 'fx', id: 'beamClamp', params: { on: true, atX: eye0[0] + 0.3, atY: eye0[1] + 0.9, atZ: eye0[2] - 1.6 } },
    { t: C2B_DURATION, type: 'fx', id: 'beamClamp', params: { on: false } },
    // the macro: grey fingertips scrape round a square nail head; water runs down the grain; she whispers
    { t: 3.0, type: 'dof', dof: focusAt(macroEye, NAIL_HEAD, 0.06, 3) },
    { t: 3.1, type: 'sfx', id: 'ada_scrape_wood', pos: NAIL_HEAD, room: 'U1', gain: 1 },
    { t: 4.0, type: 'voice', trigger: 'c2b:vigil' },
    { t: 5.6, type: 'sfx', id: 'ada_scrape_wood', pos: NAIL_HEAD, room: 'U1', gain: 0.8, rate: 0.9 },
    // the floor: water gathers from the hem into a footprint on the runner; her forehead knocks on the wood
    { t: 7.0, type: 'dof', dof: focusAt(footEye, foot, 0.12, 2.5) },
    { t: 7.2, type: 'sfx', id: 'ada_drip', pos: foot, room: 'U1', gain: 0.9 },
    { t: 8.0, type: 'sfx', id: 'ada_drip', pos: foot, room: 'U1', gain: 0.7 },
    { t: 8.4, type: 'sfx', id: 'knock', pos: D_ADA_HEAD, room: 'U1', gain: 0.3, rate: 0.85 },
    // release on the player's eye
    { t: 9.5, type: 'dof', dof: null },
    // SMOOTH-FRAMES (#142): the torch rides the CAMERA (render/flashlight.ts), so in the macro and the floor shots it lit
    // her legs from the lens (clamped at the runner) and flickered pink → black → pink as the 12° clamp swung (cs-frames
    // C2b 7.03–9.03, scratch/smooth-frames/strips/c2b_floor.jpg): off for the two shots away from the eye, back at the cut
    // to the eye as the player had it; then the beam rises from the runner to the gaze with the camera instead of
    // jumping up when the clamp lets go at the hand-back (C2b 11.0 → a one-frame flash on the wall)
    ...(torch ? ([{ t: 3.0, type: 'light', op: 'flashlight', on: false }, { t: 9.5, type: 'light', op: 'flashlight', on: true }] as Cue[]) : []),
    ...beamRise,
    { t: 9.5, type: 'clip', char: 'arms', clip: 'arms_idle', loop: true, fallback: [] },
    { t: C2B_DURATION, type: 'release', char: 'ada' },
    // SMOOTH-FIX (#145, hunt F2a): the incoming shot's exposure on each metered cut (`cutE`, held 0.1 s, then the eye adapts
    // on from it; values = what the eye settles on for that shot, scratch/fix/diag `ex` Medium) — the cut frame used to
    // keep the previous shot's exposure (C2b 3.0 ×7 dark, 7.0 ×0.4 bright). The torch is off in both shots.
    { t: 3.0, type: 'fx', id: 'exposure', params: { cutE: 24 } },
    { t: 7.0, type: 'fx', id: 'exposure', params: { cutE: 6.51 } },
    // (after2: the two cuts the hunt did not list — 0.0 from the armoire to its mouth and 9.5 the foot → the hall — kept
    // the previous exposure on their first frame too: luma 0.0021 between 0.0070 and 0.0109 (×5.2), and 0.0027 between
    // 0.0062 and 0.0072 (×2.6). The eye snapped to 8.5 / 9.6 and settled at 6.5–7.1 / 7.3–7.8 (scratch/fix/after2 `ex`).)
    { t: 0, type: 'fx', id: 'exposure', params: { cutE: 7.0 } },
    { t: 9.5, type: 'fx', id: 'exposure', params: { cutE: 8.0 } },
  ];

  return {
    id: 'C2b',
    duration: C2B_DURATION,
    lock: 'full',
    fade: [{ t: 0, v: 0 }],
    letterbox: [
      { t: 0, v: 0 },
      { t: 1.0, v: 1 },
      { t: 9.6, v: 1 },
      { t: 10.9, v: 0 },
    ],
    shots: [
      // a black shape at her door: a soft steer from where you look, 35 → 50 mm
      // (authored eye at the armoire mouth, not the player's: a hide exit can face the armoire door; 35 mm keeps the hall
      // around her — at 50 mm her gown filled the frame, Max round 3)
      { t: 0, d: 3.0, path: [ARMOIRE_MOUTH_EYE, add(ARMOIRE_MOUTH_EYE, [0.02, 0.05, 0])], target: [adaBack], fov: [lens(28), lens(35)], ease: 'inOut', handheld: 0.4 },
      // the nail macro, 100 mm — her hair edge soft at the top of frame, the face never in it
      { t: 3.0, d: 4.0, path: [macroEye, add(macroEye, [0.01, 0.01, -0.01])], target: [NAIL_HEAD], fov: lens(100), ease: 'linear', handheld: 0.2 },
      // floor level, 85 mm: the hem, the footprint
      { t: 7.0, d: 2.5, path: [footEye], target: [foot], fov: lens(85), handheld: 0.25 },
      // release: the player's eye at the armoire
      { t: 9.5, d: 1.5, path: [eye0], target: [adaBack, look0], fov: [lens(50), ctx.player.fov ?? 60], ease: 'inOut', handheld: 0.3 },
    ],
    cues,
  };
};
