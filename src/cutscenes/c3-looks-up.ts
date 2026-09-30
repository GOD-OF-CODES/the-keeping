// C3 'He Looks Up' (B07, ~12.5 s, M2, LOOK CONTROL KEPT) — DESIGN B07. Lifting the hammer at the U2 east window:
//   flash — nine dead cars in the weeds;
//   flash — the man in the sack pushing YOUR car (RVX-318) off the drive to join them;
//   flash — he has stopped and lifted his head to your window;
//   darkness; flash — gone.
// Below, the front door slams and the bolt drops, and the rocking resumes under your feet (Harlan seated in the
// rocker from here on — the grate shows him with the cleaver across his knees).
//
// No camera shots except a 1 s soft steer toward the field; the player keeps mouse-look (lock 'look').
// Harlan is visible only inside each flash (static 2-frame pose clips).

import { CAM, CAR_GATE, CAR_ROW, DOOR, PROP, ROCKER_HEADING, add, fwd, headingTo, yawToHeading } from './stage.ts';
import type { Cue, P3, TimelineFactory } from './types.ts';

export const C3_DURATION = 12.5;
export const C3_FLASHES = [1.2, 4.2, 7.0, 9.8] as const;

export const c3LooksUp: TimelineFactory = (ctx) => {
  const eye = ctx.player.eye;
  const look0 = add(eye, fwd(ctx.player.heading, ctx.player.pitch, 4));
  const field: P3 = [16, -1.2, 0.8];
  const steerHeading = headingTo(eye, field);
  const steerPitch = Math.atan2(field[2] - eye[2], Math.hypot(field[0] - eye[0], field[1] - eye[1]));
  const [f1, f2, f3, f4] = C3_FLASHES;
  const flash = (t: number): Cue => ({ t, type: 'light', op: 'lightning', strength: 1 });

  const cues: Cue[] = [
    { t: 0, type: 'lock', mode: 'look' },
    { t: 0, type: 'light', op: 'storm_auto', on: false },
    { t: 0, type: 'visible', char: 'harlan', visible: false },
    { t: 1.0, type: 'player', pos: eye, heading: steerHeading, pitch: steerPitch },
    // 1: the wrecks
    flash(f1),
    // 2: he pushes your car off the drive to join them (the car is at the row from now on)
    { t: f2 - 0.1, type: 'prop', id: 'P_CAR_GATE', visible: false },
    { t: f2 - 0.1, type: 'prop', id: 'P_CAR_ROW', visible: true },
    { t: f2 - 0.1, type: 'place', char: 'harlan', pos: PROP.P_HARLAN_POSE_PUSH, heading: yawToHeading(2.944) },
    { t: f2 - 0.1, type: 'clip', char: 'harlan', clip: 'harlan_pose_car_push', fade: 0, loop: true },
    { t: f2 - 0.05, type: 'visible', char: 'harlan', visible: true },
    flash(f2),
    { t: f2 + 0.95, type: 'visible', char: 'harlan', visible: false },
    { t: f2 + 1.1, type: 'voice', trigger: 'c3:flash_car' },
    // 3: he has stopped and lifted his head to your window
    { t: f3 - 0.1, type: 'place', char: 'harlan', pos: PROP.P_HARLAN_POSE_LOOKUP, heading: yawToHeading(-1.67) },
    { t: f3 - 0.1, type: 'clip', char: 'harlan', clip: 'harlan_pose_look_up', fade: 0, loop: true },
    { t: f3 - 0.05, type: 'visible', char: 'harlan', visible: true },
    flash(f3),
    { t: f3 + 0.3, type: 'score', state: 'drone', stinger: 'score_stinger' },
    { t: f3 + 0.95, type: 'visible', char: 'harlan', visible: false },
    // darkness … 4: gone
    flash(f4),
    // below: the front door slams, the bolt drops; the rocking resumes under your feet
    { t: 10.9, type: 'sfx', id: 'door_slam', pos: DOOR.front, room: 'G1' },
    { t: 11.3, type: 'sfx', id: 'bolt_drop', pos: PROP.P_BOLT_BOX, room: 'G1' },
    { t: 11.6, type: 'place', char: 'harlan', pos: PROP.P_ROCKER, heading: ROCKER_HEADING },
    { t: 11.6, type: 'clip', char: 'harlan', clip: 'harlan_seated', loop: true, fade: 0 },
    { t: 11.6, type: 'visible', char: 'harlan', visible: true },
    { t: 11.8, type: 'sfx', id: 'rocking_chair', pos: PROP.P_ROCKER, room: 'G2' },
    { t: 12.3, type: 'sfx', id: 'rocking_chair', pos: PROP.P_ROCKER, room: 'G2' },
  ];

  return {
    id: 'C3',
    duration: C3_DURATION,
    lock: 'look',
    shots: [{ t: 0, d: 1.0, path: [eye], target: [look0, field], fov: ctx.player.fov ?? 60, ease: 'inOut' }],
    cues,
  };
};

/** Where the vehicle track would put your car (reference for the world lane: the row pose). */
export const C3_CAR_FROM = CAR_GATE;
export const C3_CAR_TO = CAR_ROW;
export const C3_REFERENCE_VIEW = CAM.c3_field;
