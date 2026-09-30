// C6 'Blue Hour' (B12 → B13, ~28.5 s + gates, M2, SEMI-INTERACTIVE) — DESIGN B12. The rain has stopped; the eaves drip;
// mist in the field. Pour the can (hold E — gate 'pour'), turn the key (E — gate 'key'): two coughs, then it catches,
// and the radio comes back mid-song. Roll past the pump; the ROOMS lantern gutters out as you pass; in the mirror the
// house sinks into the mist. Fades to black: the story starts C7 in the same frame.
//
// Gates auto-resolve after their timeout so the ending can never soft-lock. The host resolves them early from input:
// cutscenes.resolveGate('pour') after E is held ~1.2 s; cutscenes.resolveGate('key') on E.

import { CAR_ROW, DRIVER_EYE, PROP, inCar } from './stage.ts';
import type { Cue, P3, TimelineFactory } from './types.ts';

export const C6_DURATION = 28.5;
export const POUR_PROMPT = 'Hold E to pour the can';
export const KEY_PROMPT = 'Press E to turn the key';

export const c6BlueHour: TimelineFactory = (ctx) => {
  const filler = inCar([-0.86, -1.45, 0.78], CAR_ROW);
  const pourEye = inCar([-1.55, -2.1, 1.5], CAR_ROW);
  const eye0 = ctx.player.eye;
  const drive: P3[] = [[11.5, -5.5, 0], [9.5, -7.5, 0], [5.8, -11, 0], [3.6, -16, 0], [2.4, -23, 0], [1.4, -28.2, 0], [-3, -30.4, 0], [-14, -30.8, 0]];

  const cues: Cue[] = [
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
    { t: C6_DURATION, type: 'fx', id: 'mirror_view', params: { on: false } },
    { t: C6_DURATION, type: 'fx', id: 'dash', params: { on: false, fuelNeedle: 0.25, fuelLamp: false } },
  ];

  return {
    id: 'C6',
    duration: C6_DURATION,
    lock: 'full',
    fade: [
      { t: 0, v: 0 },
      { t: 26.4, v: 0 },
      { t: 28.4, v: 1 },
    ],
    letterbox: [
      { t: 0, v: 0 },
      { t: 1.5, v: 1 },
    ],
    vehicle: [
      { t: 0, d: 15.5, path: [CAR_ROW.pos], heading: CAR_ROW.heading },
      { t: 15.5, d: 11.5, path: drive, ease: 'linear', heading: 'path' },
    ],
    shots: [
      // to the filler
      { t: 0, d: 1.6, path: [eye0, pourEye], target: [filler], fov: [ctx.player.fov ?? 60, 48], ease: 'out', handheld: 0.5 },
      { t: 1.6, d: 5.9, path: [pourEye, [pourEye[0] + 0.05, pourEye[1] + 0.02, pourEye[2] - 0.03]], target: [filler], fov: 44, ease: 'linear', handheld: 0.45 },
      // the key, two coughs, the radio mid-song
      { t: 7.5, d: 8.0, space: 'car', path: [DRIVER_EYE], target: [[-0.25, 6, 0.95], [-0.3, 0.55, 0.8], [-0.2, 8, 0.95]], fov: 55, ease: 'inOut', handheld: 0.5 },
      // past the dead pump
      { t: 15.5, d: 4.0, path: [[6.6, -16.4, 1.15], [6.5, -16.6, 1.2]], target: [[9.8, -7.4, 0.8], [4.4, -14.2, 0.8], [3.3, -17.5, 0.9]], fov: 42, ease: 'linear', handheld: 0.3 },
      // down the drive toward the lantern
      { t: 19.5, d: 4.3, space: 'car', path: [DRIVER_EYE], target: [[0.2, 14, 1.1], [1.6, 9, 1.8]], fov: 52, ease: 'inOut', handheld: 0.5 },
      // the mirror: the house sinks into the mist
      { t: 23.8, d: C6_DURATION - 23.8, space: 'car', path: [[0.05, 0.35, 1.22]], target: [[0.4, -20, 2.2]], fov: 30, handheld: 0.3 },
    ],
    cues,
  };
};

/** The pump the car rolls past (reference). */
export const C6_PUMP = PROP.P_PUMP;
