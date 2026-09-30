// C1 'Empty' (B01, ~54 s, M1) — DESIGN B01. Night, hard rain, fog. Car interior (the CAR set) with wipers, radio
// static, the needle under E and the low-fuel chime; NEXT SERVICES 48 MI slides past (a POV from your sedan on
// County Road 9); out of the dark the ROOMS sign and its lantern; the engine coughs and dies and the car rolls to a
// stop at the gate; lightning reveals the house; the thought; the camera rises past the plate RVX-318 as you step
// out → CP1 (the story sets the checkpoint on cutscene end).
//
// Two car rigs: interior close-ups use the static CAR set (x ≈ 100, facing north); road shots move your exterior sedan
// (P_CAR_GATE) with the `vehicle` track (host.world.vehicle(pose) — null restores it at the gate).

import { CAR_GATE, CAR_SET, DRIVER_EYE, PLATE_LOCAL, PROP, SPAWN, CAM, add, every, fwd, inCar } from './stage.ts';
import type { Cue, Timeline, TimelineFactory } from './types.ts';

export const C1_DURATION = 54;
const ENGINE_DIES = 29.6;
const STOP = 33.5;
const FLASH = 38.6;

export const c1Empty: TimelineFactory = (ctx) => {
  const setEye = inCar(DRIVER_EYE, CAR_SET);
  const setAhead = inCar([-0.3, 25, 0.95], CAR_SET);
  const gauge = inCar([-0.34, 0.58, 0.82], CAR_SET); // the cluster ahead of the wheel (L_DASH sits at the centre)
  const gaugeEye = inCar([-0.28, 0.08, 1.02], CAR_SET);
  const plate = inCar(PLATE_LOCAL, CAR_GATE);
  const cp1 = SPAWN.CP1;
  const cp1Look = add(cp1.pos, fwd(cp1.heading, -0.01, 10));

  const cues: Cue[] = [
    // ---- the car, the rain, the radio
    { t: 0, type: 'lock', mode: 'full' },
    { t: 0, type: 'light', op: 'storm_auto', on: false },
    { t: 0, type: 'weather', rain: 1, wind: 0.5, inside: 1, surface: 'car' },
    { t: 0, type: 'score', state: 'none' },
    { t: 0, type: 'light', op: 'flashlight', on: false },
    { t: 0, type: 'loop', key: 'engine', id: 'engine_idle', gain: 0.8, fade: 0.1 },
    { t: 0, type: 'loop', key: 'radio', id: 'radio_static', gain: 0.35, fade: 1.5 },
    { t: 0, type: 'fx', id: 'windshield_rain', params: { on: true, intensity: 1 } },
    { t: 0, type: 'fx', id: 'wipers', params: { on: true, period: 1.25 } },
    { t: 0, type: 'fx', id: 'dash', params: { on: true, fuelNeedle: 0.05, fuelLamp: false } },
    { t: 0, type: 'light', op: 'runtime', id: 'L_DASH', on: true },
    { t: 0, type: 'light', op: 'runtime', id: 'L_HEADLIGHT_L', on: true },
    { t: 0, type: 'light', op: 'runtime', id: 'L_HEADLIGHT_R', on: true },
    { t: 0, type: 'visible', char: 'arms', visible: true },
    { t: 0, type: 'clip', char: 'arms', clip: 'arms_wheel', loop: true, fallback: ['arms_idle'] },
    ...every('wiper', 0.4, ENGINE_DIES, 1.25, { gain: 0.7 }),
    // ---- the needle, the chime
    { t: 8.2, type: 'fx', id: 'dash', params: { on: true, fuelNeedle: -0.02, fuelLamp: true } },
    { t: 9.4, type: 'sfx', id: 'fuel_chime' },
    { t: 10.3, type: 'voice', trigger: 'c1:fuel_chime' },
    { t: 13.5, type: 'loop', key: 'radio', id: 'radio_static', gain: 0.5, fade: 0.8 },
    // ---- County Road 9: NEXT SERVICES 48 MI, the ROOMS sign
    { t: 17.9, type: 'weather', rain: 1, wind: 0.6, inside: 1, surface: 'car' },
    { t: 25.4, type: 'sfx', id: 'engine_sputter' },
    { t: 26.0, type: 'sfx', id: 'vacancy_creak', pos: PROP.P_VACANCY_PLATE, room: 'EXT1', gain: 0.8 },
    { t: 27.5, type: 'sfx', id: 'engine_sputter', gain: 1.1 },
    { t: 28.6, type: 'sfx', id: 'vacancy_creak', pos: PROP.P_VACANCY_PLATE, room: 'EXT1' },
    // ---- the engine dies
    { t: ENGINE_DIES, type: 'sfx', id: 'engine_stall' },
    { t: ENGINE_DIES + 0.05, type: 'loop', key: 'engine', id: null, fade: 0.15 },
    { t: ENGINE_DIES + 0.05, type: 'loop', key: 'radio', id: null, fade: 0.05 },
    { t: ENGINE_DIES + 0.1, type: 'fx', id: 'wipers', params: { on: false } },
    { t: ENGINE_DIES + 0.2, type: 'fx', id: 'dash', params: { on: false, fuelNeedle: -0.02, fuelLamp: false } },
    { t: ENGINE_DIES + 0.2, type: 'light', op: 'runtime', id: 'L_DASH', on: false },
    { t: ENGINE_DIES + 0.9, type: 'light', op: 'runtime', id: 'L_HEADLIGHT_L', on: true, scale: 0.35 },
    { t: ENGINE_DIES + 0.9, type: 'light', op: 'runtime', id: 'L_HEADLIGHT_R', on: true, scale: 0.35 },
    { t: STOP - 0.2, type: 'sfx', id: 'tyres_gravel', gain: 0.5 },
    { t: 35.5, type: 'light', op: 'runtime', id: 'L_HEADLIGHT_L', on: false },
    { t: 35.5, type: 'light', op: 'runtime', id: 'L_HEADLIGHT_R', on: false },
    { t: 36.0, type: 'sfx', id: 'vacancy_creak', pos: PROP.P_VACANCY_PLATE, room: 'EXT1', gain: 0.9 },
    // ---- lightning: the house on the rise
    { t: FLASH, type: 'light', op: 'lightning', strength: 1 },
    { t: FLASH + 0.08, type: 'score', state: 'drone', stinger: 'score_reveal' },
    { t: 41.6, type: 'voice', trigger: 'c1:engine_dead' },
    // ---- step out into the rain
    { t: 46.6, type: 'sfx', id: 'latch', gain: 0.7 },
    { t: 46.8, type: 'visible', char: 'arms', visible: false },
    { t: 46.8, type: 'fx', id: 'windshield_rain', params: { on: false, intensity: 0 } },
    { t: 46.9, type: 'weather', rain: 1, wind: 0.8, inside: 0, surface: 'gravel' },
    { t: 47.0, type: 'fx', id: 'taillights', params: { on: true, intensity: 0.35 } },
    { t: 47.2, type: 'sfx', id: 'coat_rustle' },
    { t: 48.4, type: 'sfx', id: 'door_slam', gain: 0.45, rate: 1.25 },
    { t: 52.6, type: 'light', op: 'flashlight', on: true },
    { t: 52.6, type: 'sfx', id: 'flashlight_click', gain: 0.6 },
    { t: 52.7, type: 'visible', char: 'arms', visible: true },
    { t: 52.7, type: 'clip', char: 'arms', clip: 'arms_idle', loop: true },
    { t: C1_DURATION, type: 'player', pos: cp1.pos, heading: cp1.heading, pitch: cp1.pitch },
    { t: C1_DURATION, type: 'fx', id: 'taillights', params: { on: false, intensity: 0 } },
    { t: C1_DURATION, type: 'release', char: 'arms' },
  ];

  const tl: Timeline = {
    id: 'C1',
    duration: C1_DURATION,
    lock: 'full',
    fade: [
      { t: 0, v: 1 },
      { t: 2.5, v: 0 },
    ],
    letterbox: [
      { t: 0, v: 1 },
      { t: 51.5, v: 1 },
      { t: 53.8, v: 0 },
    ],
    vehicle: [
      // the sedan on County Road 9: passes the NEXT SERVICES card at ≈ 22.9 s, dies at 29.6 s, rolls to the gate
      { t: 17.0, d: 6.5, path: [[62, -30.2, 0], [14, -30.2, 0]], ease: 'linear', heading: Math.PI },
      { t: 23.5, d: STOP - 23.5, path: [[14, -30.2, 0], [CAR_GATE.pos[0], CAR_GATE.pos[1], 0]], ease: 'out', heading: Math.PI },
    ],
    shots: [
      // interior: the road ahead in the headlights, rain, wipers
      { t: 0, d: 7.4, path: [setEye, add(setEye, [0, 0.02, -0.01])], target: [setAhead], fov: 55, ease: 'linear', handheld: 0.5 },
      // the needle under E
      { t: 7.4, d: 4.6, path: [gaugeEye, add(gaugeEye, [0, 0.06, -0.02])], target: [gauge], fov: 30, ease: 'inOut', handheld: 0.35 },
      // back to the road, a glance at the dark
      { t: 12.0, d: 6.0, path: [setEye], target: [setAhead, inCar([2.5, 25, 0.8], CAR_SET), setAhead], fov: 55, ease: 'inOut', handheld: 0.5 },
      // POV from the sedan on the real road: NEXT SERVICES 48 MI slides past on the right
      { t: 18.0, d: 5.5, space: 'car', path: [DRIVER_EYE], target: [[0.8, 14, 0.95], [2.8, 9, 0.9]], fov: 52, ease: 'inOut', handheld: 0.6 },
      // out of the dark: the ROOMS sign under its lantern; the engine coughs and dies
      { t: 23.5, d: 7.0, space: 'car', path: [DRIVER_EYE], target: [[1.4, 16, 1.3], [1.9, 9, 1.6]], fov: [50, 42], ease: 'inOut', handheld: 0.6 },
      // wide from the road beyond the sign: the car rolls in under the lantern and stops at the gate
      { t: 30.5, d: 7.8, path: [[-7.5, -31.9, 1.25], [-7.2, -31.8, 1.3]], target: [[4.5, -30.3, 0.9], [3.0, -30.2, 1.0]], fov: 38, ease: 'out', handheld: 0.35 },
      // from the dead car: lightning reveals the house on the rise
      { t: 38.3, d: 8.4, path: [CAM.c1_house_reveal.pos, add(CAM.c1_house_reveal.pos, [0.02, 0.05, 0.02])], target: [CAM.c1_house_reveal.target], fov: [CAM.c1_house_reveal.fov, 44], ease: 'inOut', handheld: 0.4 },
      // rise past the taillights on plate RVX-318 into the rain, ending on CP1's view up the drive
      {
        t: 46.7,
        d: C1_DURATION - 46.7,
        path: [add(plate, [0.75, -0.15, -0.05]), add(plate, [0.2, 1.1, 0.8]), [3.3, -28.1, 1.6], cp1.pos],
        target: [plate, add(plate, [-1.2, 1.8, 0.7]), [2.4, -20, 1.7], cp1Look],
        fov: [40, ctx.player.fov ?? 60],
        ease: 'inOut',
        handheld: 0.7,
      },
    ],
    cues,
  };
  return tl;
};
