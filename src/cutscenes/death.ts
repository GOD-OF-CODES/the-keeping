// Death cutaway (3 s, M1, reusable, never skippable) — DESIGN "Fail states": quick and not gory. A wet hand over the
// lens, hair filling the frame, one eye glint, black, a bubbling drowning rush; then the Director respawns the
// player at the checkpoint (teleport happens right after done(), camera already released).
// The brain already voiced 'ai:catch' (driver's choke + Ada's breath) — not repeated here.

import { add, fwd, headingTo } from './stage.ts';
import type { P3, Timeline, TimelineFactory } from './types.ts';

export const DEATH_DURATION = 3;

export const deathCutaway: TimelineFactory = (ctx): Timeline => {
  const { eye, heading, pitch } = ctx.player;
  const feetZ = eye[2] - 1.65;
  // Ada lunges from where she is (or straight ahead), ending ~0.45 m in front of the lens
  const from = ctx.ada?.pos ?? add([eye[0], eye[1], feetZ], fwd(heading, 0, 1.2));
  const h = ctx.ada ? headingTo([eye[0], eye[1], feetZ], from) : heading;
  const grab: P3 = add([eye[0], eye[1], feetZ], fwd(h, 0, 0.45));
  const faceH = headingTo(grab, eye);
  const face: P3 = [grab[0], grab[1], eye[2] - 0.05];
  const look0 = add(eye, fwd(heading, pitch, 2));
  const recoil = add(eye, add(fwd(h, 0, -0.18), [0, 0, -0.12]));

  return {
    id: 'death',
    duration: DEATH_DURATION,
    lock: 'full',
    skippable: false,
    fade: [
      { t: 0, v: 0 },
      { t: 1.55, v: 0.1 },
      { t: 2.15, v: 1 },
    ],
    shots: [
      { t: 0, d: 0.35, path: [eye], target: [look0, face], fov: [ctx.player.fov ?? 60, 62], ease: 'out', handheld: 3 },
      { t: 0.35, d: DEATH_DURATION - 0.35, path: [eye, recoil], target: [face, add(face, [0, 0, -0.1])], fov: [62, 50], ease: 'out', handheld: 2.2, roll: [0, 0.22] },
    ],
    moves: [{ char: 'ada', t: 0, d: 0.35, path: [ctx.ada ? [from[0], from[1], feetZ] : add(grab, fwd(h, 0, 0.6)), grab], ease: 'out', heading: faceH }],
    cues: [
      { t: 0, type: 'lock', mode: 'full' },
      { t: 0, type: 'visible', char: 'ada', visible: true },
      { t: 0, type: 'clip', char: 'ada', clip: 'ada_catch', fade: 0.05 },
      { t: 0, type: 'sfx', id: 'grab_hit' },
      { t: 0, type: 'heartbeat', bpm: 0 },
      { t: 0.3, type: 'fx', id: 'lens_wet_hand', params: { on: true } },
      { t: 0.35, type: 'visible', char: 'arms', visible: false },
      { t: 0.8, type: 'sfx', id: 'drowning_rush' },
      { t: 1.1, type: 'fx', id: 'eye_glint', params: { at: 'ada_eye' } },
      { t: DEATH_DURATION, type: 'fx', id: 'lens_wet_hand', params: { on: false } },
      { t: DEATH_DURATION, type: 'visible', char: 'arms', visible: true },
      { t: DEATH_DURATION, type: 'release', char: 'ada' },
    ],
  };
};
