// C5b 'Rocking' (B12, 14 s, M-A) — docs/CUTSCENES-PLAN.md §3. The first `b02:at_door` (T_B02_PORCH) after
// `harlan_taken` (the story's trigger; Ada is hidden, no AI concerns). The exhale — the first light that is neither storm
// nor candle — with the sting planted inside the relief: behind the parlor shutter the sill candle catches by itself
// and the rocker starts again. Harlan is dead, so who is in the chair? (C7 answers it.)
//
// Overcast dawn (the `blue_hour` grade, mist 1, rain 0) expects no hard shadows, which hides the night bake; the mist
// erases distance; the 135 mm stacks the fog layers; one warm point in a cool frame.
// State: L_CANDLE_SILL ends LIT (C6's mirror shot shows it — continuity); the player ends at the foot of the porch
// steps facing the car (a skip lands there too).

import { sweepTargets, turnBetween } from './math.ts';
import { PROP, add, dist, focusAt, fwd, headingTo, lens } from './stage.ts';
import type { Cue, P3, TimelineFactory } from './types.ts';

export const C5B_DURATION = 14;
/** The parlor shutter gap (layout opening O_G2_S1, south wall of G2). */
export const SHUTTER_G2_S1: P3 = [5.0, -0.3, 1.62];
/** The drop's lip: under the porch's half-round gutter (blender/props/architecture.py porch: gutter axis at
 *  y = front − 0.3 overhang − 0.08 = −3.18, z = roofZ + 0.03 = 3.93, radius 0.06 → its bottom at z ≈ 3.87). */
export const EAVE_DROP: P3 = [3.2, -3.18, 3.866];
/** Where gameplay resumes: the foot of the porch steps (P_PORCH steps centre x 1.8), facing the car at the row. */
export const C5B_END_EYE: P3 = [1.8, -4.0, 1.65];

export const c5bRocking: TimelineFactory = (ctx) => {
  const carRow: P3 = [PROP.P_CAR_ROW[0], PROP.P_CAR_ROW[1], 0.9];
  const MIST: P3 = [2.5, -14, 1.8];
  const eye0 = ctx.player.eye;
  const look0 = add(eye0, fwd(ctx.player.heading, ctx.player.pitch, Math.max(1, dist(eye0, MIST))));
  const endHeading = headingTo(C5B_END_EYE, carRow);
  const macroEye: P3 = [2.86, -3.22, 3.81]; // along the gutter, the drop against the misty yard beyond
  const teleEye: P3 = [2.5, -3.6, 1.7];
  const rock = (t: number, gain: number): Cue => ({ t, type: 'sfx', id: 'rocking_chair', pos: PROP.P_ROCKER, room: 'G2', gain, rate: 0.92 });

  const cues: Cue[] = [
    { t: 0, type: 'lock', mode: 'full' },
    { t: 0, type: 'light', op: 'storm_auto', on: false },
    { t: 0, type: 'fx', id: 'blue_hour', params: { mist: 1, rain: 0 } },
    { t: 0, type: 'weather', rain: 0, wind: 0.2, inside: 0, surface: 'porch' },
    { t: 0, type: 'score', state: 'blue_hour' },
    { t: 0, type: 'light', op: 'set', id: 'L_CANDLE_SILL', scale: 0 },
    { t: 0.3, type: 'sfx', id: 'eaves_drip', gain: 0.55 },
    // the eave: a drop swells on the gutter lip, catches the pale sky, and falls
    { t: 3.5, type: 'fx', id: 'drops', params: { on: true, at: 'porch_eave', x: EAVE_DROP[0], y: EAVE_DROP[1], z: EAVE_DROP[2], period: 2.6, sky: 1.35 } },
    { t: 3.5, type: 'dof', dof: focusAt(macroEye, EAVE_DROP, 0.08, 3) },
    { t: 4.0, type: 'sfx', id: 'eaves_drip', pos: [3.2, -3.18, 0.1], room: 'EXT2', gain: 0.9 },
    { t: 5.9, type: 'sfx', id: 'eaves_drip', pos: [3.2, -3.18, 0.1], room: 'EXT2', gain: 1 },
    { t: 6.5, type: 'dof', dof: null },
    { t: 6.5, type: 'fx', id: 'drops', params: { on: false } },
    // crane up and back: the house shrinks into the mist, nine wrecks in a grey line, your car at the near end
    { t: 7.5, type: 'sfx', id: 'score_bird', gain: 0.5 },
    // 135 mm from the steps: behind the shutter gap the sill candle catches by itself; a creak, then another
    { t: 10.5, type: 'dof', dof: focusAt(teleEye, SHUTTER_G2_S1, 0.5, 2.5) },
    { t: 10.95, type: 'light', op: 'set', id: 'L_CANDLE_SILL', scale: 0.35 },
    { t: 11.1, type: 'light', op: 'set', id: 'L_CANDLE_SILL', scale: 0.7 },
    { t: 11.3, type: 'light', op: 'set', id: 'L_CANDLE_SILL', scale: 1 },
    rock(11.6, 0.7),
    rock(12.4, 0.75), // ~0.8 s apart: the chair is pushed, then settles into its 2.1 s period
    { t: 12.5, type: 'dof', dof: null },
    rock(13.7, 0.5),
    { t: 12.5, type: 'player', pos: C5B_END_EYE, heading: endHeading, pitch: -0.03 },
    // SMOOTH-FIX (#145, hunt F2a): the incoming shot's exposure on each metered cut (`cutE`, held 0.1 s, then the eye adapts
    // on from it; values = what the eye settles on for that shot, scratch/fix/diag `ex` Medium) — the cut frame used to
    // keep the previous shot's exposure (C5b 3.5 ×1.9; 0.25 = the room clamp: a brighter frame clamps too).
    { t: 3.5, type: 'fx', id: 'exposure', params: { cutE: 0.25 } },
  ];

  return {
    id: 'C5b',
    duration: C5B_DURATION,
    lock: 'full',
    fade: [{ t: 0, v: 0 }],
    letterbox: [
      { t: 0, v: 0 },
      { t: 1.2, v: 1 },
      { t: 12.6, v: 1 },
      { t: 13.9, v: 0 },
    ],
    shots: [
      // the open door frames grey mist; drops fall from the eave across frame
      // SMOOTH-FRAMES (#142): from the player's own eye and gaze (the trigger fires as they walk out through the door) —
      // the shot started 0.3 m ahead of them, 10° off their heading: a one-frame jump (cs-frames C5b 0.033). 'out' starts
      // at ≈ the walking pace (3 × 1.6 m / 3.5 s) and settles on the porch.
      { t: 0, d: 3.5, path: [eye0, [1.9, -1.8, 2.2]], target: sweepTargets(eye0, look0, MIST, turnBetween(eye0, look0, MIST), 3), fov: [ctx.player.fov ?? 60, lens(35)], ease: 'out', handheld: 0.5 },
      // eave macro (100 mm, DOF ≈ 0.4 m)
      { t: 3.5, d: 3.0, path: [macroEye, [2.87, -3.22, 3.806]], target: [[EAVE_DROP[0], EAVE_DROP[1], EAVE_DROP[2] - 0.015]], fov: lens(100), ease: 'linear', handheld: 0.25 },
      // crane up and back (24 mm)
      { t: 6.5, d: 4.0, path: [[1.5, -4, 1.8], [0.8, -8, 4.5], [0.2, -11.5, 7.0]], target: [[3, -1, 2.5], carRow], fov: lens(26), ease: 'inOut', handheld: 0.2 },
      // the shutter, 135 mm from the steps
      { t: 10.5, d: 2.0, path: [teleEye], target: [SHUTTER_G2_S1], fov: lens(135), handheld: 0.35 },
      // release: on the steps, facing the car (the rocking keeps time behind you)
      { t: 12.5, d: 1.5, path: [C5B_END_EYE], target: [[C5B_END_EYE[0] + Math.cos(endHeading) * 3, C5B_END_EYE[1] + Math.sin(endHeading) * 3, C5B_END_EYE[2] - 0.1]], fov: ctx.player.fov ?? 60 },
    ],
    cues,
  };
};
