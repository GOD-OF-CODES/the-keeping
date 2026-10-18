// C6 'Blue Hour' (B12 → B13, ~28.5 s + gates, M2, SEMI-INTERACTIVE) — DESIGN B12. The rain has stopped; the eaves drip;
// mist in the field. Pour the can (hold E — gate 'pour'), turn the key (E — gate 'key'): two coughs, then it catches,
// and the radio comes back mid-song. Roll past the pump; the ROOMS lantern gutters out as you pass; in the mirror the
// house sinks into the mist. Fades to black: the story starts C7 in the same frame.
//
// Gates auto-resolve after their timeout so the ending can never soft-lock. The host resolves them early from input:
// cutscenes.resolveGate('pour') after E is held ~1.2 s; cutscenes.resolveGate('key') on E.

import { ArcPath, sweepTargets, turnBetween } from './math.ts';
import { CAR_ROW, DRIVER_EYE, PROP, add, dist, fwd, inCar } from './stage.ts';
import type { Cue, P3, TimelineFactory } from './types.ts';

export const C6_DURATION = 32.5;
/** M-A (CUTSCENES-PLAN §3 C6 +4 s): before the key gate, a 4 s insert — the dash clock reads 6:10 and your glove lays
 *  the water-stained bus ticket on the dashboard. You leave at ten past six on 12 October: the bus she never caught.
 *  No line. Everything from the key gate on is 4 s later than in the 28.5 s cut. */
export const C6_INSERT_T = 8.4;
export const C6_INSERT_D = 4;
export const C6_CLOCK = '6:10';
export const POUR_PROMPT = 'Hold E to pour the can';
export const KEY_PROMPT = 'Press E to turn the key';
/** The drive out (PLAN, z 0). SMOOTHNESS FRAMES (#142b, lead ruling (an)): down the middle of the drive's two-track
 *  (x ≈ 1.8–1.95), 0.75 m clear of the pump island; STRAIGHT through the re-hung gate (opening 0.63–2.94 m between the
 *  posts, the sedan 1.74 m + mirrors: ≥ 0.17 m each side; the 95° leaf ≥ 0.14 m) until the rear has cleared the fence
 *  line, then a wide right turn across into the far lane (R ≈ 4.5 m: a 4.85 m sedan cannot make the near lane from a
 *  gate 1.25 m off the asphalt) and back into the westbound lane. scratch/smooth-frames/c6clear.ts checks the body
 *  against the posts, the leaf, the pump, the sign and the mailbox. The old line drove through the gate's latch post
 *  (it stood in the opening) and, before that, 0.2 m past the pump island. */
const DRIVE_PTS: P3[] = [
  [11.5, -5.5, 0], [9.3, -7.6, 0], [6.0, -9.9, 0], [3.5, -12.0, 0], [2.3, -15.0, 0], [1.95, -19.5, 0], [1.85, -24.0, 0],
  [1.79, -28.0, 0], [1.79, -29.5, 0], [1.79, -30.9, 0], [1.55, -32.2, 0], [0.8, -33.3, 0], [-0.5, -34.0, 0], [-2.5, -34.2, 0],
  [-6, -33.5, 0], [-10, -32.4, 0], [-14, -31.6, 0], [-19, -31.3, 0], [-26, -31.25, 0],
];
/** A slow roll out of the yard (13 km/h): the old 42.7 m in 11.5 s. */
const DRIVE_SPEED = 3.7;
const DRIVE_D = new ArcPath(DRIVE_PTS).length / DRIVE_SPEED;

export const c6BlueHour: TimelineFactory = (ctx) => {
  const filler = inCar([-0.86, -1.45, 0.78], CAR_ROW);
  const pourEye = inCar([-1.55, -2.1, 1.5], CAR_ROW);
  const eye0 = ctx.player.eye;
  const look0 = add(eye0, fwd(ctx.player.heading, ctx.player.pitch, Math.max(1, dist(eye0, filler))));
  const drive: P3[] = DRIVE_PTS;

  const cues: Cue[] = [
    // C1-OPENING §7.1.2: the detailed sedan_interior v2 rides the driven sedan in C6 too (same cabin as C1, not cabin_lo)
    { t: 7.5, type: 'fx', id: 'car_mount', params: { on: true, pov: true } },
    { t: 15.5, type: 'fx', id: 'car_mount', params: { on: true, pov: false } },
    { t: 19.5, type: 'fx', id: 'car_mount', params: { on: true, pov: true } },
    { t: 0, type: 'lock', mode: 'full' },
    { t: 0, type: 'light', op: 'storm_auto', on: false },
    { t: 0, type: 'weather', rain: 0, wind: 0.25, inside: 0, surface: 'gravel' },
    { t: 0, type: 'score', state: 'blue_hour' },
    { t: 0, type: 'fx', id: 'blue_hour', params: { mist: 1, rain: 0 } },
    { t: 1.2, type: 'sfx', id: 'eaves_drip', gain: 0.6 },
    { t: 3.0, type: 'gate', id: 'pour', prompt: POUR_PROMPT, timeout: 15 },
    { t: 3.0, type: 'clip', char: 'arms', clip: 'arms_pour_can', fallback: ['arms_idle'] },
    { t: 3.1, type: 'sfx', id: 'fuel_glug', pos: filler, room: 'EXT2' },
    { t: 5.2, type: 'sfx', id: 'fuel_glug', pos: filler, room: 'EXT2' },
    { t: 5.2, type: 'fx', id: 'fuel', params: { level: 0.25 } },
    { t: 7.3, type: 'sfx', id: 'can_scrape', pos: filler, room: 'EXT2', gain: 0.7 },
    { t: 7.3, type: 'fx', id: 'can_in_hand', params: { on: false } },
    // in the driver's seat
    { t: 7.5, type: 'sfx', id: 'latch', gain: 0.6 },
    { t: 7.6, type: 'clip', char: 'arms', clip: 'arms_wheel', loop: true, fallback: ['arms_idle'] },
    { t: 8.2, type: 'sfx', id: 'door_slam', gain: 0.4, rate: 1.25 },
    { t: 8.3, type: 'weather', rain: 0, wind: 0.15, inside: 1, surface: 'car' },
    { t: 9.0, type: 'gate', id: 'key', prompt: KEY_PROMPT, timeout: 10 },
    { t: 9.05, type: 'clip', char: 'arms', clip: 'arms_key', fallback: ['arms_idle'] },
    { t: 9.2, type: 'sfx', id: 'engine_crank' },
    { t: 9.6, type: 'voice', trigger: 'c6:engine_catches' },
    { t: 10.3, type: 'sfx', id: 'engine_sputter' },
    { t: 10.9, type: 'sfx', id: 'engine_crank' },
    { t: 11.9, type: 'sfx', id: 'engine_catch' },
    { t: 12.1, type: 'loop', key: 'engine', id: 'engine_idle', gain: 0.75, fade: 0.2 },
    { t: 12.1, type: 'fx', id: 'dash', params: { on: true, fuelNeedle: 0.25, fuelLamp: false } },
    { t: 12.1, type: 'light', op: 'runtime', id: 'L_HEADLIGHT_L', on: true },
    { t: 12.1, type: 'light', op: 'runtime', id: 'L_HEADLIGHT_R', on: true },
    { t: 12.4, type: 'loop', key: 'radio', id: 'radio_song', gain: 0.5, fade: 0.1 },
    { t: 12.5, type: 'clip', char: 'arms', clip: 'arms_wheel', loop: true, fallback: ['arms_idle'] },
    { t: 15.5, type: 'sfx', id: 'tyres_gravel', gain: 0.8 },
    { t: 16.2, type: 'sfx', id: 'score_bird', gain: 0.5 },
    { t: 20.4, type: 'sfx', id: 'score_bird', gain: 0.4 },
    // the ROOMS lantern gutters out as you pass
    { t: 23.0, type: 'light', op: 'gutter', id: 'L_LANTERN', d: 1.4 },
    { t: 23.8, type: 'fx', id: 'mirror_view', params: { on: true } },
    { t: 23.8, type: 'visible', char: 'arms', visible: false },
    { t: 24.0, type: 'fx', id: 'blue_hour', params: { mist: 1.5, rain: 0 } },
    // M-A: the sill candle behind the parlor shutter stays lit in the mirror (C5b continuity)
    { t: 0, type: 'light', op: 'set', id: 'L_CANDLE_SILL', scale: 1 },
    { t: C6_DURATION, type: 'fx', id: 'mirror_view', params: { on: false } },
    { t: C6_DURATION, type: 'fx', id: 'car_mount', params: { on: false } },
    { t: C6_DURATION, type: 'fx', id: 'dash', params: { on: false, fuelNeedle: 0.25, fuelLamp: false, clock: '' } },
    { t: C6_DURATION, type: 'fx', id: 'dash_ticket', params: { on: false } },
    // SMOOTH-FIX (#145, hunt F2a): the incoming shot's exposure on each metered cut (`cutE`, held 0.1 s, then the eye adapts
    // on from it; values = what the eye settles on for that shot, scratch/fix/diag C6 `ex` Medium) — the cut frame used to
    // keep the previous shot's exposure (7.5 ×0.5, 8.4 ×4.9, 10.4 ×0.18 white, 27.8 black ×20). 0.25 = the clamp (any
    // brighter frame clamps too); 8.4 / 27.8 only without the player's torch (C6 leaves it as the player had it).
    // (10.4 and 27.8 are pushed below, on the real clock: the key insert shifts this list by 4 s from 8.9)
    { t: 7.5, type: 'fx', id: 'exposure', params: { cutE: 0.25 } },
    ...(!ctx.player.torch ? ([{ t: 8.4, type: 'fx', id: 'exposure', params: { cutE: 0.584 } }] as Cue[]) : []),
  ];
  // the insert: everything from the key gate on moves 4 s later
  const late = (t: number) => (t >= C6_INSERT_T + 0.5 - 1e-6 && t < C6_DURATION - 1e-6 ? t + C6_INSERT_D : t);
  for (const c of cues) c.t = Math.round(late(c.t) * 1000) / 1000;
  const T = C6_INSERT_T;
  // SMOOTH-FIX (#145, hunt F2a): the cuts after the insert's start, on the real clock (the shots are authored on it)
  cues.push({ t: 10.4, type: 'fx', id: 'exposure', params: { cutE: 0.25 } });
  if (!ctx.player.torch) cues.push({ t: 27.8, type: 'fx', id: 'exposure', params: { cutE: 1.424 } });
  cues.push(
    // the key to ACC: the panel lights and the quartz clock reads 6:10; then the ticket on the dash (crank at the gate)
    { t: T - 0.3, type: 'sfx', id: 'knob_click', gain: 0.5 },
    { t: T, type: 'fx', id: 'dash', params: { on: true, fuelNeedle: 0.25, fuelLamp: false, clock: C6_CLOCK } },
    { t: T + 1.9, type: 'clip', char: 'arms', clip: 'arms_pickup_read', fallback: ['arms_idle'] },
    { t: T + 2.0, type: 'sfx', id: 'paper', gain: 0.35 },
    { t: T + 2.7, type: 'fx', id: 'dash_ticket', params: { on: true } },
    { t: T + 3.6, type: 'clip', char: 'arms', clip: 'arms_wheel', loop: true, fallback: ['arms_idle'] },
  );
  cues.sort((a, b) => a.t - b.t);

  return {
    id: 'C6',
    duration: C6_DURATION,
    lock: 'full',
    fade: [
      { t: 0, v: 0 },
      { t: 26.4 + C6_INSERT_D, v: 0 },
      { t: 28.4 + C6_INSERT_D, v: 1 },
    ],
    letterbox: [
      { t: 0, v: 0 },
      { t: 1.5, v: 1 },
    ],
    vehicle: [
      { t: 0, d: 15.5 + C6_INSERT_D, path: [CAR_ROW.pos], heading: CAR_ROW.heading },
      // SMOOTH-FRAMES (#142): runs on past the end of the cutscene at the same speed (it ended at 31.0: the mirror shot's
      // house stopped receding in one frame under the fade)
      { t: 15.5 + C6_INSERT_D, d: DRIVE_D, path: drive, ease: 'linear', heading: 'path' },
    ],
    shots: [
      // to the filler. SMOOTH-FRAMES (#142): the look turns from the player's own gaze onto the filler (it snapped onto
      // the filler on the first frame — the target was the filler alone) along a sphere, eased in and out over 2 s
      // (was 'out' over 1.6 s: a start at 3× the mean turn rate), and lands on shot 2's 44° (it ended at 48° and
      // zoomed 4° in one frame at the shot boundary, same eye and target)
      { t: 0, d: 2.0, path: [eye0, pourEye], target: sweepTargets(eye0, look0, filler, turnBetween(eye0, look0, filler), 4), fov: [ctx.player.fov ?? 60, 44], ease: 'inOut', handheld: 0.5 },
      { t: 2.0, d: 5.5, path: [pourEye, [pourEye[0] + 0.05, pourEye[1] + 0.02, pourEye[2] - 0.03]], target: [filler], fov: 44, ease: 'linear', handheld: 0.45 },
      // the key, two coughs, the radio mid-song
      { t: 7.5, d: 8.0 + C6_INSERT_D, space: 'car', path: [DRIVER_EYE], target: [[-0.25, 6, 0.95], [-0.3, 0.55, 0.8], [-0.2, 8, 0.95]], fov: 55, ease: 'inOut', handheld: 0.5 },
      // past the dead pump
      { t: 15.5 + C6_INSERT_D, d: 4.0, path: [[6.6, -16.4, 1.15], [6.5, -16.6, 1.2]], target: [[9.8, -7.4, 0.8], [4.4, -14.2, 0.8], [3.3, -17.5, 0.9]], fov: 42, ease: 'linear', handheld: 0.3 },
      // down the drive toward the lantern
      { t: 19.5 + C6_INSERT_D, d: 4.3, space: 'car', path: [DRIVER_EYE], target: [[0.2, 14, 1.1], [1.6, 9, 1.8]], fov: 52, ease: 'inOut', handheld: 0.5 },
      // the mirror: the house sinks into the mist
      { t: 23.8 + C6_INSERT_D, d: C6_DURATION - 23.8 - C6_INSERT_D, space: 'car', path: [[0.05, 0.35, 1.22]], target: [[0.4, -20, 2.2]], fov: 30, handheld: 0.3 },
      // M-A insert: the clock (6:10), then the ticket laid on the dash with the house in the mist beyond the glass
      { t: C6_INSERT_T, d: 2.0, space: 'car', path: [[-0.35, 0.12, 1.13], [-0.35, 0.14, 1.125]], target: [[-0.35, 0.6, 0.9]], fov: 26, ease: 'linear', handheld: 0.3 },
      { t: C6_INSERT_T + 2.0, d: 2.0, space: 'car', path: [[-0.2, 0.05, 1.16], [-0.18, 0.08, 1.15]], target: [[0.1, 0.65, 0.96], [0.1, 0.7, 0.98]], fov: 40, ease: 'linear', handheld: 0.35 },
    ],
    cues,
  };
};

/** The pump the car rolls past (reference). */
export const C6_PUMP = PROP.P_PUMP;
