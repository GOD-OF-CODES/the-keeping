// C4a 'The Door Gives' (CUTSCENES-PLAN §3, M-A, 13 s, B08 → B09): the third board drops and Ada's door opens by
// itself, rhyming with the front door. Lightning through O_U3_E at 6.0 shows a slight woman standing at the window;
// the second flash at 10.0 shows it is the wedding dress on its form, the sheet slid off one shoulder.
//
// Staging (PLAN; D_ADA is in the N–S wall x = 3.675 at y = 8.2, swinging east into U3; upper floor z = 4.1):
//   0–2    the player's eye at the door, 35 mm, handheld; the plank falls (board_drop), the torch on the boards.
//   2–5    low wide from the U1 floor (3.0, 7.7, 4.25) → the door, 24 mm: the latch gives and it swings in slowly.
//          The torch is OFF from here to 11: the torch rides the camera (render/flashlight.ts), so a lamp in a
//          floor-level camera would light the door from the floor; the shot is lit by the landing's moonlight and a
//          far flash at 3.3 instead (a moonlit overcast night, CLAUDE.md "Photoreal standard").
//   5–8    through the doorway (3.4, 8.2, 5.7) → P_DRESS, 50 mm: dark; the flash at 6.0 — a woman at the window.
//   8–11   dolly (4.2, 7.6, 5.4) → (5.6, 7.4, 5.2) past the sheeted chair / treadle / trunk, 35 mm, motion blur (Max):
//          the flash at 10.0 — it is the dress on its form.
//   11–13  cut to the player in the doorway, torch on; release (the brain resumes with the deaf grace).
// Deferred variant (flag c4a_deferred: the safety gate failed at the door; replayed once at b09:enter_u3): shots 3–4
// only, from wherever the player stands in the doorway, 6 s.
// Faces-hidden audit: nobody is in frame (the "woman" is the dress). Clips: arms_idle (existing). Voice: none.

import { add, fwd, headingTo, lens, UPPER, EYE } from './stage.ts';
import type { CameraShot, Cue, P3, TimelineFactory } from './types.ts';

export const C4A_DURATION = 13;
export const C4A_DEFERRED_DURATION = 6;

/** D_ADA: the opening's centre at head height of the board line (layout WU_U1U3 O_ADA, offset 3.625). */
export const C4A_DOOR: P3 = [3.675, 8.2, 5.1];
/** P_DRESS (layout pos [8.15, 7.2, 4.1]): the form's shoulder line. */
export const C4A_DRESS: P3 = [8.15, 7.2, 4.9];
/** Where gameplay resumes: just inside U1, square in the doorway, looking at the dress. */
export const C4A_END_EYE: P3 = [3.35, 8.2, UPPER + EYE];
/** The two reveal flashes (O_U3_E faces east straight onto the form). */
export const C4A_FLASHES = [6.0, 10.0] as const;
/** Fixed exposure of the two reveal shots (5–11 s; derivation at its cue). */
export const C4A_FLASH_E = 1.2;
/** The torch-adapted eye in the U3 doorway (auto exposure measured 0.16–0.19, r2–r4): the hand-back shot's camera. */
export const C4A_HANDBACK_E = 0.17;

const fovOf = (mm: number) => Math.round(lens(mm) * 10) / 10;
/** A full stroke: 4 return strokes in 0.36 s, the last a continuing current (τ 0.15 s). */
const STRIKE = '1@0:0.05,0.55@0.1:0.04,0.9@0.21:0.06,0.4@0.36:0.15';

export const c4aDoorGives: TimelineFactory = (ctx) => {
  const deferred = !!ctx.flags.get('c4a_deferred');
  const blur = !!ctx.motionBlur;
  const eye = ctx.player.eye;
  const look0 = add(eye, fwd(ctx.player.heading, ctx.player.pitch, 3));
  const flash = (t: number, strength = 1): Cue => ({ t, type: 'light', op: 'lightning', strength });
  // the roaming cube-shadow light outside O_U3_E (src/world/lights.ts ROAM_SPOTS.u3_window): hard shadows through the
  // window — 3–4 pulses in ≈ 0.4 s (CLAUDE.md lightning), ≈ 1100 cd peak, 8000 K
  const stroke = (t: number, pulses: string): Cue => ({ t, type: 'fx', id: 'shadowLight', params: { at: 'u3_window', pulses } });
  const endHeading = headingTo(C4A_END_EYE, C4A_DRESS);
  const endPitch = Math.atan2(C4A_DRESS[2] - C4A_END_EYE[2], Math.hypot(C4A_DRESS[0] - C4A_END_EYE[0], C4A_DRESS[1] - C4A_END_EYE[1]));

  if (deferred) {
    // shots 3–4 from the doorway: the player's own eye → the dress, then the dolly; control back where they stood
    const [f1, f2] = [1.0, 4.4];
    const shots: CameraShot[] = [
      { t: 0, d: 2.6, path: [eye], target: [look0, C4A_DRESS], fov: [ctx.player.fov ?? 60, fovOf(50)], ease: 'inOut', handheld: 0.4 },
      { t: 2.6, d: 3.4, path: [[4.2, 7.6, 5.4], [5.3, 7.45, 5.25]], target: [C4A_DRESS], fov: fovOf(35), ease: 'inOut' },
    ];
    const cues: Cue[] = [
      { t: 0, type: 'lock', mode: 'full' },
      { t: 0, type: 'light', op: 'storm_auto', on: false },
      { t: 0, type: 'light', op: 'flashlight', on: false },
      { t: 0, type: 'heartbeat', bpm: 120 },
      { t: 0, type: 'fx', id: 'exposure', params: { fixed: C4A_FLASH_E } },
      stroke(f1, STRIKE),
      flash(f1, 0.5),
      { t: f1 + 0.2, type: 'sfx', id: 'gasp', gain: 0.5 },
      { t: f1 + 0.8, type: 'fx', id: 'shadowLight', params: { at: 'lamp' } },
      ...(blur ? ([{ t: 2.6, type: 'fx', id: 'blurAmount', params: { v: 0.6 } }, { t: 5.9, type: 'fx', id: 'blurAmount', params: { v: 0 } }] as Cue[]) : []),
      stroke(f2, STRIKE),
      flash(f2, 0.5),
      { t: f2 + 0.2, type: 'heartbeat', bpm: 95 },
      { t: f2 + 0.8, type: 'fx', id: 'shadowLight', params: { at: 'lamp' } },
      { t: 5.6, type: 'sfx', id: 'thunder_near', gain: 0.8 },
      { t: 5.9, type: 'light', op: 'flashlight', on: true },
      { t: 5.9, type: 'player', pos: eye, heading: ctx.player.heading, pitch: ctx.player.pitch },
      { t: 5.9, type: 'light', op: 'storm_auto', on: true },
      { t: 5.9, type: 'heartbeat', bpm: 0 },
      { t: 5.9, type: 'fx', id: 'exposure', params: { fixed: C4A_HANDBACK_E } },
    ];
    // the last 0.1 s is the player's own view again (the camera holds the last shot pose otherwise)
    shots.push({ t: 5.9, d: 0.1, path: [eye], target: [look0], fov: ctx.player.fov ?? 60 });
    return { id: 'C4a', duration: C4A_DEFERRED_DURATION, lock: 'full', shots, cues, letterbox: [{ t: 0, v: 0 }, { t: 0.4, v: 1 }, { t: 5.6, v: 1 }, { t: 6, v: 0 }] };
  }

  const [f1, f2] = C4A_FLASHES;
  const endTarget = add(C4A_END_EYE, fwd(endHeading, endPitch, 4));
  const shots: CameraShot[] = [
    // 0–2: the eye at the door (a soft steer from wherever the pry left the gaze onto the boards' line)
    { t: 0, d: 2, path: [eye], target: [look0, C4A_DOOR], fov: [ctx.player.fov ?? 60, fovOf(35)], ease: 'inOut', handheld: 0.6 },
    // 2–5: low wide from the floor, the door swings in by itself
    { t: 2, d: 3, path: [[3.0, 7.7, 4.4]], target: [[3.675, 8.2, 5.0]], fov: fovOf(24), handheld: 0.15 },
    // 5–8: through the doorway, dark; the woman at the window (flash 6.0)
    { t: 5, d: 3, path: [[3.4, 8.2, 5.7]], target: [[8.15, 7.2, 4.75]], fov: fovOf(35), handheld: 0.35 },
    // 8–11: the dolly past the sheeted furniture (flash 10.0: the dress on its form)
    { t: 8, d: 3, path: [[4.2, 7.6, 5.4], [5.6, 7.4, 5.2]], target: [[8.15, 7.2, 4.8]], fov: fovOf(28), ease: 'inOut' },
    // 11–13: the player in the doorway, where control resumes
    { t: 11, d: 2, path: [C4A_END_EYE], target: [endTarget], fov: ctx.player.fov ?? 60 },
  ];
  const door: P3 = [3.62, 8.2, 4.3];
  const cues: Cue[] = [
    { t: 0, type: 'lock', mode: 'full' },
    { t: 0, type: 'light', op: 'storm_auto', on: false },
    // the last plank drops (the world's own pry already screeched)
    { t: 0.35, type: 'sfx', id: 'board_drop', pos: door, room: 'U1', gain: 0.9 },
    { t: 0.8, type: 'clip', char: 'arms', clip: 'arms_idle', loop: true, fade: 0.5 },
    // the latch gives: slow swing, cold air
    { t: 2.0, type: 'light', op: 'flashlight', on: false },
    { t: 2.35, type: 'sfx', id: 'latch', pos: door, room: 'U1', gain: 0.6 },
    { t: 2.5, type: 'door', id: 'D_ADA', action: 'open' },
    { t: 2.55, type: 'sfx', id: 'door_creak', pos: door, room: 'U3', gain: 0.8, rate: 0.85 },
    { t: 2.8, type: 'loop', key: 'c4a_wind', id: 'wind', gain: 0.35, fade: 1.2 },
    // the cold draught through the opened door lays the landing candle's flame over (r2: at the dark-adapted e ≈ 4.4
    // its 1850 K spill painted the dress amber and spoiled the silhouette); it stands up again as control returns
    { t: 2.9, type: 'light', op: 'set', id: 'L_CANDLE_LANDING', scale: 0.3, fadeS: 0.8 },
    // a far stroke through the U3 east window: the swing reads in silhouette against the flash-lit room
    stroke(3.3, '0.35@0:0.06,0.2@0.12:0.1'),
    { t: 3.9, type: 'fx', id: 'shadowLight', params: { at: 'lamp' } },
    // the woman at the window. A film camera from here to 11 (as C2/C4c): the dark-adapted eye (auto e ≈ 4.5) lifted the
    // dress's probe-lit front to amber and flattened the misread (r2–r4); at e 1.2 the stroke's back-light rims her and
    // over-exposes briefly, the front falls to silhouette
    { t: 5.0, type: 'fx', id: 'exposure', params: { fixed: C4A_FLASH_E } },
    { t: 5.4, type: 'heartbeat', bpm: 120 },
    stroke(f1, STRIKE),
    flash(f1, 0.5),
    { t: f1 + 0.2, type: 'sfx', id: 'gasp', gain: 0.55 },
    { t: f1 + 0.8, type: 'fx', id: 'shadowLight', params: { at: 'lamp' } },
    ...(blur ? ([{ t: 8, type: 'fx', id: 'blurAmount', params: { v: 0.6 } }, { t: 10.95, type: 'fx', id: 'blurAmount', params: { v: 0 } }] as Cue[]) : []),
    // the dress on its form
    stroke(f2, STRIKE),
    flash(f2, 0.5),
    { t: f2 + 0.8, type: 'fx', id: 'shadowLight', params: { at: 'lamp' } },
    { t: f2 + 0.25, type: 'heartbeat', bpm: 95 },
    { t: 11.0, type: 'light', op: 'flashlight', on: true },
    { t: 11.0, type: 'light', op: 'set', id: 'L_CANDLE_LANDING', scale: 1, fadeS: 1.5 },
    // the hand-back shot keeps a camera exposure at the torch-adapted eye's own value (r2–r4 auto 0.16–0.19 in this
    // doorway): after a film-camera cue the eye ADAPTS (exposure.ts, no snap; and the 10.0 flash holds the meter) — r5/r6
    // still sat at 1.2 a second later, the doorway blown. The eye takes over from 0.17 at the end: no step.
    { t: 11.0, type: 'fx', id: 'exposure', params: { fixed: C4A_HANDBACK_E } },
    { t: 12.9, type: 'fx', id: 'exposure', params: { reset: true } },
    { t: 11.0, type: 'player', pos: C4A_END_EYE, heading: endHeading, pitch: endPitch },
    { t: 11.4, type: 'sfx', id: 'thunder_near', gain: 0.8 },
    { t: 12.2, type: 'loop', key: 'c4a_wind', id: null, fade: 0.8 },
    { t: 12.8, type: 'light', op: 'storm_auto', on: true },
    { t: 12.8, type: 'heartbeat', bpm: 0 },
  ];
  return {
    id: 'C4a',
    duration: C4A_DURATION,
    lock: 'full',
    shots,
    cues,
    letterbox: [{ t: 0, v: 0 }, { t: 0.5, v: 1 }, { t: 12.3, v: 1 }, { t: 13, v: 0 }],
  };
};
