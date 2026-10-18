// C7 'The Keeping' (B13, ~34 s, M2) — DESIGN B13. The sting REUSES the opening's camera shots (C1's interior + ROOMS
// sign POV, C2's threshold lens) with swapped set dressing ('sting': re-trimmed maroon interior with a pine air
// freshener and a blinking fuel lamp, the ROOMS lantern lit again, the guest book's waiting line reading HARLAN ruled
// through with a blank line under it, a fresh column of clumsy tallies, Ada in his rocker with the sack in her lap).
// A knock; the bell off to the right; the door opens by itself; the guest book; the threshold: the rocking stops, she
// lifts her own head in one hand, raises the sack by its knot and turns its eyeholes to the doorway. Black. One bell.
// THE KEEPING. (The story ends the game on cutscene end.)

import { c1Empty, C1_SHOTS } from './c1-empty.ts';
import { CAM, CAR_SET, CLEAT_ADA, CLEAT_EYE, CLEAT_FINGERS, DOOR, DRIVER_EYE, PROP, ROCKER_HEADING, add, every, focusAt, inCar } from './stage.ts';
import { roadPath } from './road.ts';
import type { CameraShot, Cue, TimelineFactory } from './types.ts';

export const C7_DURATION = 35;
/** M-A (CUTSCENES-PLAN §3 C7 +1 s): when the rope runs, a 1.0 s cut to the parlor cleat — grey fingers let the rope
 *  run (ada_finale from its 8.9 s finger-hook frame, slowed) — then back to the hall shot. Everything after the insert
 *  start is 1.0 s later than in the 34 s cut. */
export const C7_CLEAT_T = 15.8;
export const C7_CLEAT_D = 1.0;

export const TITLE = 'THE KEEPING';
/** The westbound lane centre (n, m) — C1's track (c1-empty.ts WEST). */
const C7_LANE = 1.75;

const shift = (s: CameraShot, t: number, d?: number): CameraShot => ({ ...s, t, d: d ?? s.d });

export const c7Keeping: TimelineFactory = (ctx) => {
  const c1 = c1Empty(ctx);
  // the interior stays on the static CAR set (the sting dressing: maroon trim, pine freshener, blinking fuel lamp —
  // C1-OPENING §7.1.2), framed like C1's road POV; the cut to the ROOMS sign POV rides the moving sedan with the
  // detailed interior mounted (the cut hides the swap)
  const pov = C1_SHOTS.pov;
  const interior: CameraShot = { ...pov, space: 'plan', path: [inCar(DRIVER_EYE, CAR_SET)], target: pov.target.map((p) => inCar(p, CAR_SET)) };
  const signPov = C1_SHOTS.rooms;
  const th = CAM.c7_sting_threshold;
  const gb = CAM.c7_guest_book;
  const sackHead: [number, number, number] = [PROP.P_ROCKER[0] - 0.2, PROP.P_ROCKER[1] - 0.2, 1.55];

  const cues: Cue[] = [
    { t: 0, type: 'lock', mode: 'full' },
    { t: 0, type: 'light', op: 'storm_auto', on: false },
    { t: 0, type: 'dressing', set: 'sting', on: true },
    { t: 0, type: 'prop', id: 'P_AIR_FRESHENER', visible: true },
    { t: 0, type: 'light', op: 'set', id: 'L_LANTERN', scale: 1 },
    { t: 0, type: 'weather', rain: 1, wind: 0.5, inside: 1, surface: 'car' },
    { t: 0, type: 'score', state: 'drone' },
    { t: 0, type: 'fx', id: 'blue_hour', params: { mist: 0, rain: 1 } },
    { t: 0, type: 'fx', id: 'car_trim', params: { style: 'maroon' } },
    { t: 0, type: 'fx', id: 'windshield_rain', params: { on: true, intensity: 1 } },
    { t: 0, type: 'fx', id: 'wipers', params: { on: true, period: 1.1 } },
    { t: 0, type: 'fx', id: 'dash', params: { on: true, fuelNeedle: -0.02, fuelLamp: 'blink' } },
    { t: 0, type: 'light', op: 'runtime', id: 'L_DASH', on: true },
    { t: 0, type: 'light', op: 'runtime', id: 'L_HEADLIGHT_L', on: true },
    { t: 0, type: 'light', op: 'runtime', id: 'L_HEADLIGHT_R', on: true },
    { t: 0, type: 'loop', key: 'engine', id: 'engine_idle', gain: 0.7, fade: 0.1 },
    { t: 0, type: 'visible', char: 'arms', visible: true },
    { t: 0, type: 'clip', char: 'arms', clip: 'arms_wheel', loop: true, fallback: ['arms_idle'] },
    ...every('wiper', 0.3, 10, 1.1, { gain: 0.6 }),
    { t: 2.6, type: 'sfx', id: 'fuel_chime' },
    { t: 6.8, type: 'voice', trigger: 'c7:sign_seen' },
    { t: 7.2, type: 'sfx', id: 'vacancy_creak', pos: PROP.P_VACANCY_PLATE, room: 'EXT1' },
    { t: 10.0, type: 'loop', key: 'engine', id: null, fade: 0.8 },
    { t: 3.5, type: 'fx', id: 'car_mount', params: { on: true, pov: true } },
    { t: 10.2, type: 'fx', id: 'car_mount', params: { on: false } },
    { t: 10.2, type: 'visible', char: 'arms', visible: false },
    { t: 10.2, type: 'fx', id: 'windshield_rain', params: { on: false, intensity: 0 } },
    { t: 10.2, type: 'fx', id: 'wipers', params: { on: false } },
    { t: 10.2, type: 'fx', id: 'dash', params: { on: false, fuelNeedle: -0.02, fuelLamp: false } },
    { t: 10.2, type: 'light', op: 'runtime', id: 'L_DASH', on: false },
    { t: 10.2, type: 'light', op: 'runtime', id: 'L_HEADLIGHT_L', on: false },
    { t: 10.2, type: 'light', op: 'runtime', id: 'L_HEADLIGHT_R', on: false },
    // the porch: a knock; the bell off to the right; the door opens by itself
    { t: 10.8, type: 'weather', rain: 1, wind: 0.8, inside: 0, surface: 'porch' },
    { t: 10.8, type: 'door', id: 'D_FRONT', action: 'rope_close' },
    { t: 10.8, type: 'door', id: 'D_PARLOR', action: 'close' },
    { t: 11.8, type: 'sfx', id: 'knock_three', pos: PROP.P_KNOCKER, room: 'EXT2' },
    { t: 12.4, type: 'voice', trigger: 'c7:knock' },
    { t: 14.6, type: 'sfx', id: 'bell_knob', pos: [2.55, -0.34, 1.9], room: 'EXT2' },
    { t: 14.9, type: 'sfx', id: 'spring_bell', pos: PROP.P_SPRING_BELL, room: 'G2', gain: 0.7 },
    { t: 15.8, type: 'sfx', id: 'rope_pulleys', pos: PROP.P_PULLEY_1, room: 'G1', gain: 0.8 },
    { t: 16.2, type: 'door', id: 'D_FRONT', action: 'rope_open' },
    // the guest book: HARLAN, ruled through, a blank line under it
    { t: 17.6, type: 'weather', rain: 1, wind: 0.5, inside: 1, surface: 'roof' },
    { t: 17.6, type: 'dof', dof: focusAt(gb.pos, gb.target, 0.35, 2.5) },
    { t: 17.6, type: 'door', id: 'D_PARLOR', action: 'open' },
    // the threshold: Ada in his rocker, the sack in her lap
    { t: 21.6, type: 'dof', dof: focusAt(th.pos, sackHead, 2.2, 2) },
    { t: 21.6, type: 'place', char: 'ada', pos: PROP.P_ROCKER, heading: ROCKER_HEADING },
    { t: 21.6, type: 'visible', char: 'ada', visible: true },
    { t: 21.6, type: 'clip', char: 'ada', clip: 'ada_sting', fallback: ['ada_vigil'], speed: 0, fade: 0 },
    { t: 21.6, type: 'attach', char: 'ada', prop: 'sting_sack', bone: 'hand_r' },
    { t: 21.7, type: 'sfx', id: 'rocking_chair', pos: PROP.P_ROCKER, room: 'G2' },
    { t: 22.6, type: 'sfx', id: 'rocking_chair', pos: PROP.P_ROCKER, room: 'G2', gain: 0.8 },
    // the rocking stops; she lifts her own head; the sack's eyeholes turn to you
    { t: 23.4, type: 'clip', char: 'ada', clip: 'ada_sting', fallback: ['ada_look'], fade: 0.2 },
    { t: 24.4, type: 'sfx', id: 'ada_bone_crack', pos: sackHead, room: 'G2' },
    { t: 25.4, type: 'voice', trigger: 'c7:tableau' },
    { t: 25.6, type: 'score', state: 'none', stinger: 'score_stinger' },
    // black · one bell · THE KEEPING
    { t: 28.0, type: 'dof', dof: null },
    { t: 28.0, type: 'visible', char: 'ada', visible: false },
    { t: 28.9, type: 'sfx', id: 'score_final_bell' },
    { t: 29.8, type: 'card', text: TITLE, style: 'title' },
    // SMOOTH-FIX (#145, hunt F2a): the incoming shot's exposure on each metered cut (`cutE`, held 0.1 s, then the eye adapts
    // on from it; values = what the eye settles on for that shot, scratch/fix/diag `ex` Medium) — the cut frame used to
    // keep the previous shot's exposure (C7 3.5 ×7, the cleat insert 15.8 ×28 and the guest book 18.6 ×50 white, 16.8 and 22.6 black).
    // (the cuts after the cleat insert are pushed below, on the real clock: the insert shifts this list by 1 s)
    { t: 3.5, type: 'fx', id: 'exposure', params: { cutE: 1.02 } },
    { t: 15.8, type: 'fx', id: 'exposure', params: { cutE: 0.418 } },
  ];

  // the cleat insert: everything after its start moves 1.0 s later (the rope sound itself plays under the insert)
  const late = (t: number) => (t > C7_CLEAT_T + 1e-6 ? t + C7_CLEAT_D : t);
  for (const c of cues) c.t = Math.round(late(c.t) * 1000) / 1000;
  const cleatEnd = C7_CLEAT_T + C7_CLEAT_D;
  cues.push(
    // SMOOTH-FIX (#145, hunt F2a): the cuts after the insert (real clock — the shots are authored on it)
    { t: cleatEnd, type: 'fx', id: 'exposure', params: { cutE: 24 } },
    { t: 18.6, type: 'fx', id: 'exposure', params: { cutE: 0.25 } },
    { t: 22.6, type: 'fx', id: 'exposure', params: { cutE: 2.63 } },
  );
  cues.push(
    // AD review M-A: on the real route she carries her severed head in her right hand — the head-carry IK pins that hand at
    // her hip and overrode the measured hook pose (no fingers on the rope); free the head for the insert, give it back after
    { t: C7_CLEAT_T, type: 'attach', char: 'ada', prop: 'ada_head', bone: null },
    { t: C7_CLEAT_T, type: 'place', char: 'ada', pos: CLEAT_ADA.pos, heading: CLEAT_ADA.heading },
    { t: C7_CLEAT_T, type: 'visible', char: 'ada', visible: true },
    { t: C7_CLEAT_T, type: 'clip', char: 'ada', clip: 'ada_finale', at: 8.9, speed: 0.35, fade: 0, fallback: ['ada_vigil'] },
    { t: C7_CLEAT_T, type: 'light', op: 'set', id: 'L_CANDLE_TABLE', scale: 1 },
    { t: C7_CLEAT_T, type: 'dof', dof: focusAt(CLEAT_EYE, CLEAT_FINGERS, 0.25, 3) },
    { t: cleatEnd, type: 'visible', char: 'ada', visible: false },
    { t: cleatEnd, type: 'attach', char: 'ada', prop: 'ada_head', bone: 'prop_r' },
    { t: cleatEnd, type: 'dof', dof: null },
  );
  cues.sort((a, b) => a.t - b.t);

  return {
    id: 'C7',
    duration: C7_DURATION,
    lock: 'full',
    fade: [
      { t: 0, v: 1 },
      { t: 1.6, v: 0 },
      { t: 9.6, v: 0 },
      { t: 10.3, v: 1 },
      { t: 10.8, v: 1 },
      { t: 11.6, v: 0 },
      { t: 28.9, v: 0 },
      { t: 29.0, v: 1 },
    ],
    letterbox: [{ t: 0, v: 1 }],
    // SMOOTH-FRAMES (#142): C1's coast segment (56.6) starts at 3× its mean speed — 27 m/s after the rooms run's
    // 18.9 m/s — which C1 hides on its S9 cut, but the sign POV here runs on to 10.3: the world lurched forward in one
    // frame (9.73) as the shot faded. Keep the rooms run's speed into the black instead: s 23 → −7.2 in 1.6 s, the
    // same lane (117 m / 6.2 s = 30.2 m / 1.6 s = 18.9 m/s), the car off screen from 10.3.
    vehicle: [
      ...c1.vehicle!.filter((v) => v.t < signPov.t + signPov.d - 1e-6).map((v) => ({ ...v, t: v.t - (signPov.t - 3.5) })).filter((v) => v.t + v.d > 0),
      { t: 3.5 + signPov.d, d: 1.6, path: roadPath(23, 23 - (117 / 6.2) * 1.6, C7_LANE), ease: 'linear' as const, heading: 'path' as const },
    ],
    shots: [
      shift(interior, 0, 3.5),
      shift(signPov, 3.5, 6.8),
      // the drive to the porch (the opening's approach)
      { t: 10.8, d: 6.8 + C7_CLEAT_D, path: [CAM.porch_approach.pos, [2.0, -5, 1.62], [1.85, -1.8, 1.65]], target: [CAM.porch_approach.target, add(DOOR.front, [0, -0.4, 1.4]), add(DOOR.front, [0, 1.5, 1.2])], fov: CAM.porch_approach.fov, ease: 'inOut', handheld: 0.7 },
      { t: 17.6 + C7_CLEAT_D, d: 4.0, path: [gb.pos, add(gb.pos, [0.05, 0, -0.03])], target: [gb.target], fov: [gb.fov, 33], ease: 'linear', handheld: 0.3 },
      // the opening's exact threshold and lens
      { t: 21.6 + C7_CLEAT_D, d: C7_DURATION - 21.6 - C7_CLEAT_D, path: [th.pos], target: [th.target, [6.9, 4.5, 1.5]], fov: [th.fov, 47], ease: 'linear', handheld: 0.35 },
      // the cleat insert (60 mm; later in the list, so it wins over the approach shot it interrupts)
      { t: C7_CLEAT_T, d: C7_CLEAT_D, path: [CLEAT_EYE, add(CLEAT_EYE, [-0.01, -0.01, 0])], target: [CLEAT_FINGERS], fov: 22.6, ease: 'linear', handheld: 0.25 },
    ],
    cues,
  };
};
