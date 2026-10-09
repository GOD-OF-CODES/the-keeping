// C2c 'Up' — docs/C2-ESCAPE.md rev 2 §2.2 + §4 (13.9 s, full lock, chained from C2 on the same camera). POV only:
// the 154° whip turn to the stair foot, the run across the hall, the newel, risers 1–5 at 3.1 risers/s (the creak on
// 5), lightning through the front-door FANLIGHT behind her (the roaming shadow light), glance #1 held 630 ms on her
// hard back-lit silhouette rounding the newel, risers 6–12, the stumble on the creaker 12 (hands and knees), glance #2
// held 600 ms on her hand on the wet handrail 0.9 m away, the scramble up 13–16, the top, the slow turn, and the
// EMPTY stair: her wet prints climb to tread 11 and stop, a drop falls from 11's nosing every 0.6 s, the U1 window
// stroke flares the far end. Control returns on the exact last camera (S, pitch −0.87) as the letterbox retracts.
//
// Her catch-up happens unseen (6.46–6.85, the camera is in the treads). At 10.4 (the camera faces north, away from
// the flight) she becomes invisible and her root goes to G_PARLOR_LURE: no sound, no prints, no motion on screen.
// The riser maths: tread k's nosing is at y = 3.60 + 0.28k, z = 0.60 + 0.219k (ST_MAIN, 16 risers).

import { C2_ADA_END, C2_END_EYE, C2_END_TARGET } from './c2-room.ts';
import { GROUND, NODE, STAIR_TOP_EYE, ST_MAIN, add, fwd, headingTo, lens, treadNosing } from './stage.ts';
import type { CameraShot, Cue, MoveTrack, P3, Timeline, TimelineFactory } from './types.ts';

export const C2C_DURATION = 13.9;
/** A skip inside C2 lands here (the slow turn). */
export const C2C_SKIP_AT = 10.4;
/** Eye heights above the floor/tread: crouched sprint, standing at the top. */
export const RUN_EYE = 1.55;
export const TOP_EYE = 1.65;
/** The fanlight stroke (glance #1) and the U1 window stroke (the reveal): C2c times of the pulse onsets. */
export const FANLIGHT_STROKE = { t: 3.62, pulses: '0.7@0,0.5@0.12,1.0@0.26,0.8@0.40:0.18' } as const;
export const WINDOW_STROKE = { t: 12.9, pulses: '0.6@0,1.0@0.1,0.7@0.24:0.18' } as const;
/** Ada's last tread (her prints stop here; the drip falls from its nosing onto tread 10). */
export const ADA_LAST_TREAD = 11;

/** The eye on tread k (fractional), `back` m behind the nosing, `h` above the tread. */
export const eyeOnTread = (k: number, h = RUN_EYE, back = 0.14, x = ST_MAIN.x): P3 => {
  const n = treadNosing(k);
  return [x, n[1] - back, n[2] + h];
};

/** Ada's root on tread k (feet on the tread, centre of the 1.1 m flight, a little east: her right hand on the rail). */
export const adaOnTread = (k: number): P3 => {
  const n = treadNosing(k);
  return [ST_MAIN.x + 0.18, n[1] - 0.12, n[2]];
};

const DEG = Math.PI / 180;

export const c2cUp: TimelineFactory = (ctx) => {
  const L35 = lens(35);
  const L28 = lens(28);
  const blur = ctx.motionBlur === true;
  // the whip: 650 ms with blur, 850 ms without (B8: the smear + a slower turn on tiers without the blur variant)
  const whipD = blur ? 0.65 : 0.85;
  const hallEnd = 1.65 + (whipD - 0.65);
  const h0 = -0.85;
  const hStair = 2.75;
  const ring = (eye: P3, h: number, pitch = -0.1, d = 2.2): P3 => add(eye, fwd(h, pitch, d));
  const startEye: P3 = ctx.chained ? C2_END_EYE : C2_END_EYE;
  const hallEye: P3 = [startEye[0], startEye[1], GROUND + RUN_EYE];
  const footEye: P3 = [0.8, 3.4, GROUND + RUN_EYE];
  const S = STAIR_TOP_EYE;
  const sLook = add(S.pos, fwd(S.heading, S.pitch, 3.2));
  // the climb: tread index at time t (piecewise, §2.2 pace)
  const e5 = eyeOnTread(5);
  const e12low: P3 = [ST_MAIN.x - 0.05, treadNosing(12)[1] - 0.05, treadNosing(12)[2] + 0.85];
  const topA: P3 = [0.55, 8.1, 4.1 + TOP_EYE];
  const topB: P3 = [0.75, 8.45, 4.1 + TOP_EYE];
  const north = Math.PI / 2;
  // glance #1: her silhouette rounding the newel (her root (0.85, 3.35)), seen from tread 5 back and down
  const g1Target: P3 = [0.88, 3.25, 1.55];
  // glance #2: her right hand on the wet handrail 0.9 m away (the rail is on the east side, ≈ 0.9 m above the treads)
  const handAt: P3 = [ST_MAIN.x + 0.52, treadNosing(10.6)[1], treadNosing(10.6)[2] + 0.88];

  const shots: CameraShot[] = [
    // 0.0 the whip turn right, 154° through south, to the stair foot (35 mm, blur 1.0)
    {
      t: 0,
      d: whipD,
      path: [C2_END_EYE, hallEye],
      target: [C2_END_TARGET, ring(hallEye, h0 - 0.9), ring(hallEye, h0 - 1.8), ring(hallEye, hStair - 2 * Math.PI, -0.12)],
      fov: [lens(40), L35],
      ease: 'inOut',
      handheld: 0.6,
    },
    // the hall: 1.95 m in 1.0 s, bob 3 cm at 2.6 Hz
    { t: whipD, d: hallEnd - whipD, path: [hallEye, footEye], target: [ring(hallEye, hStair, -0.12), [0.55, 4.4, 1.9]], fov: L35, ease: 'in', handheld: 0.9, bob: { amp: 0.03, hz: 2.6, roll: 0.0105 } },
    // the newel: swing round it (yaw to the flight in 400 ms); the torch fist knocks the cap at 1.80
    { t: hallEnd, d: 0.45, path: [footEye, eyeOnTread(0.4)], target: [[0.55, 4.4, 1.9], add(eyeOnTread(0.4), fwd(north, 12 * DEG, 3))], fov: L35, ease: 'inOut', handheld: 0.9 },
    // risers 1–5 at 3.1 risers/s, pitch +12°
    { t: hallEnd + 0.45, d: 3.62 - (hallEnd + 0.45), path: [eyeOnTread(0.4), eyeOnTread(2.5), e5], target: [add(eyeOnTread(0.4), fwd(north, 12 * DEG, 3)), add(e5, fwd(north, 12 * DEG, 3))], fov: L35, ease: 'linear', handheld: 0.9, bob: { amp: 0.035, hz: 3.1, roll: 0.0105 } },
    // 3.62–3.84 the head turns 150° back over the right shoulder (220 ms); the torch arm stays forward; 28 mm
    { t: 3.62, d: 0.22, path: [e5], target: [add(e5, fwd(north, 12 * DEG, 3)), add(e5, fwd(north - 1.6, -0.2, 2.2)), g1Target], fov: [L35, L28], ease: 'out', handheld: 0.6 },
    // 3.84–4.47 GLANCE #1 held 630 ms: the hard back-lit silhouette against the lightning patch on the hall floor
    { t: 3.84, d: 0.63, path: [e5, add(e5, [0, 0.03, 0.01])], target: [g1Target], fov: L28, ease: 'linear', handheld: 0.5 },
    // 4.47–4.69 turn forward
    { t: 4.47, d: 0.22, path: [add(e5, [0, 0.03, 0.01]), eyeOnTread(5.4)], target: [g1Target, add(eyeOnTread(5.4), fwd(north, 10 * DEG, 3))], fov: [L28, L35], ease: 'inOut', handheld: 0.6 },
    // risers 6–12, pitch +10°, breath ragged
    { t: 4.69, d: 1.77, path: [eyeOnTread(5.4), eyeOnTread(8.5), eyeOnTread(11.6)], target: [add(eyeOnTread(5.4), fwd(north, 10 * DEG, 3)), add(eyeOnTread(11.6), fwd(north, 10 * DEG, 3))], fov: L35, ease: 'linear', handheld: 1.0, bob: { amp: 0.035, hz: 3.1, roll: 0.0105 } },
    // 6.46 THE STUMBLE on the creaker 12: pitch −28° in 150 ms, roll −6°, the eye drops to ≈ 0.85 m above tread 12
    { t: 6.46, d: 0.16, path: [eyeOnTread(11.6), e12low], target: [add(eyeOnTread(11.6), fwd(north, 10 * DEG, 3)), add(e12low, fwd(north, -28 * DEG, 1.2))], fov: L35, ease: 'in', handheld: 1.2, roll: [0, -6 * DEG] },
    // gloves slap tread 13 (6.62); the beam swings wild
    { t: 6.62, d: 0.23, path: [e12low], target: [add(e12low, fwd(north, -28 * DEG, 1.2)), add(e12low, fwd(north + 0.5, -35 * DEG, 1.2)), add(e12low, fwd(north - 2.6, -0.4, 1))], fov: L35, ease: 'inOut', handheld: 1.4, roll: [-6 * DEG, -3 * DEG] },
    // 6.85–7.45 GLANCE #2 held 600 ms: her hand on the wet handrail, 0.9 m away; her feet a dark shape at tread 9
    { t: 6.85, d: 0.6, path: [e12low], target: [handAt, add(handAt, [0, 0.04, 0.01])], fov: L35, ease: 'linear', handheld: 0.5, roll: -3 * DEG },
    // 7.45–7.66 back round to the flight
    { t: 7.45, d: 0.21, path: [e12low, add(e12low, [0, 0.12, 0.1])], target: [handAt, add(e12low, fwd(north, 20 * DEG, 2))], fov: L35, ease: 'inOut', handheld: 1.2, roll: [-3 * DEG, 0] },
    // 7.66–9.0 scramble up 13–16 (4 risers in 1.34 s), pitch +20°
    { t: 7.66, d: 1.34, path: [add(e12low, [0, 0.12, 0.1]), eyeOnTread(14, 1.3), eyeOnTread(16, 1.6, 0.05), topA], target: [add(e12low, fwd(north, 20 * DEG, 2)), add(topA, fwd(north, 0, 3))], fov: L35, ease: 'out', handheld: 1.4, bob: { amp: 0.04, hz: 3.0, roll: 0.012 } },
    // 9.0–10.4 the top: onto the landing; the run stops; breath heaving
    { t: 9.0, d: 1.4, path: [topA, topB], target: [add(topA, fwd(north, 0, 3)), add(topB, fwd(north, -0.05, 3))], fov: L35, ease: 'out', handheld: 0.7, bob: { amp: 0.008, hz: 0.5 } },
    // 10.4–12.4 the slow turn right (south) 180° in 2.0 s, slow at first (dread), pitch down to −50°
    {
      t: C2C_SKIP_AT,
      d: 2.0,
      path: [topB, S.pos],
      target: [add(topB, fwd(north, -0.05, 3)), add(topB, fwd(north - 0.5, -0.12, 3)), add(S.pos, fwd(0, -0.45, 3)), add(S.pos, fwd(-1.2, -0.75, 3.2)), sLook],
      fov: L35,
      ease: 'in',
      handheld: 0.5,
    },
    // 12.4–13.9 the empty stair: hold (breath held); 12.9 an involuntary 4 cm lean over the rail; the FOV eases to the
    // gameplay FOV inside the last 600 ms so control returns on this exact camera (no snap)
    { t: 12.4, d: 0.5, path: [S.pos], target: [sLook], fov: L35, handheld: 0.4 },
    { t: 12.9, d: 0.5, path: [S.pos, add(S.pos, [0, -0.04, -0.01])], target: [sLook, add(sLook, [0, -0.04, -0.01])], fov: L35, ease: 'inOut', handheld: 0.4 },
    { t: 13.4, d: 0.5, path: [add(S.pos, [0, -0.04, -0.01]), S.pos], target: [add(sLook, [0, -0.04, -0.01]), sLook], fov: [L35, ctx.player.fov ?? 60], ease: 'inOut', handheld: 0.4 },
  ];

  // Ada's root keys (§4.1, C2c time)
  const t1 = adaOnTread(1);
  const t4 = adaOnTread(4);
  const t9 = adaOnTread(9);
  const t10 = adaOnTread(10);
  const t11 = adaOnTread(ADA_LAST_TREAD);
  const newel: P3 = [1.05, 3.45, GROUND];
  const moves: MoveTrack[] = [
    { char: 'ada', t: 0, d: 1.2, path: [C2_ADA_END, [2.3, 2.7, GROUND]], ease: 'linear', heading: 'path' },
    { char: 'ada', t: 1.2, d: 1.4, path: [[2.3, 2.7, GROUND], [0.85, 3.35, GROUND]], ease: 'linear', heading: 'path' },
    // rounding the newel, the right hand flat on its cap (glance #1 sees this)
    { char: 'ada', t: 2.6, d: 1.9, path: [[0.85, 3.35, GROUND], [0.92, 3.45, GROUND], add(newel, [-0.25, 0.25, 0]), t1], ease: 'linear', heading: [headingTo([2.3, 2.7, 0], [0.85, 3.35, 0]), Math.PI / 2] },
    { char: 'ada', t: 4.5, d: 1.96, path: [t1, t4], ease: 'linear', heading: Math.PI / 2 },
    // the unseen catch-up: the camera is in the treads
    { char: 'ada', t: 6.46, d: 0.39, path: [t4, t9], ease: 'linear', heading: Math.PI / 2 },
    { char: 'ada', t: 6.85, d: 0.6, path: [t9, add(t9, [0, 0.06, 0])], ease: 'linear', heading: Math.PI / 2 },
    { char: 'ada', t: 7.45, d: 0.95, path: [add(t9, [0, 0.06, 0]), t10], ease: 'linear', heading: Math.PI / 2 },
    { char: 'ada', t: 8.4, d: 0.5, path: [t10, t11], ease: 'out', heading: Math.PI / 2 },
  ];

  const room = 'G1';
  const cues: Cue[] = [
    { t: 0, type: 'mark', name: 'c2c:start' },
    { t: 0, type: 'lock', mode: 'full' },
    { t: 0, type: 'light', op: 'storm_auto', on: false },
    { t: 0, type: 'light', op: 'flashlight', on: true, tremble: 0.6 },
    { t: 0.02, type: 'sfx', id: 'flashlight_click', gain: 0.6 },
    { t: 0, type: 'fx', id: 'shadowLight', params: { at: 'off' } },
    // gameplay eye adaptation from here (the spot meter and the clamp are C2's)
    { t: 0, type: 'fx', id: 'exposure', params: { reset: true } },
    { t: 0, type: 'fx', id: 'blurAmount', params: { v: blur ? 1 : 0 } },
    { t: whipD, type: 'fx', id: 'blurAmount', params: { v: 0 } },
    { t: 0, type: 'fx', id: 'blood', params: { seq: 'c2c', phase: 'start' } },
    { t: 0, type: 'heartbeat', bpm: 150 },
    { t: 0, type: 'score', state: 'chase' },
    { t: 0, type: 'clip', char: 'arms', clip: 'arms_run_torch', loop: true, fade: 0.1, fallback: ['arms_idle'] },
    { t: 0, type: 'visible', char: 'ada', visible: true },
    { t: 0, type: 'clip', char: 'ada', clip: 'ada_chase_headless', loop: true, fade: 0.1, fallback: ['ada_chase', 'ada_patrol'] },
    { t: 0, type: 'loop', key: 'stump', id: 'stump_breath', gain: 0.8 },
    { t: 0.05, type: 'sfx', id: 'step_bare', pos: [2.3, 2.75, 0.6], room, gain: 1 },
    { t: 0.1, type: 'sfx', id: 'breath_strained', gain: 0.8 },
    { t: 0.6, type: 'loop', key: 'panting', id: 'panting', gain: 0.75 },
    { t: hallEnd - 0.05 + 0.15, type: 'sfx', id: 'newel_knock', pos: [1.05, 3.5, 1.6], room, gain: 0.9 },
    // the stair: Ada climbs with her right hand on the rail
    { t: 4.5, type: 'clip', char: 'ada', clip: 'ada_climb_headless', loop: true, fade: 0.15, fallback: ['ada_stairs_up', 'ada_chase'] },
    // 3.62–4.47 the head turns back but the torch arm stays forward (§2.2): the beam keeps lighting the flight ahead,
    // not her (the rig holds its world orientation while the camera turns)
    // (r4/r5: an off/on toggle left the level unlit by the torch afterwards — the arm is held instead)
    // review: arms_run_torch's beam bone points off the flight (black climb) — hold the beam within 12° of the gaze
    { t: 0, type: 'fx', id: 'beamClamp', params: { on: true } },
    { t: 3.6, type: 'fx', id: 'torchHold', params: { on: true } },
    { t: 4.6, type: 'fx', id: 'torchHold', params: { on: false } },
    // 3.62 the fanlight stroke behind her — the reason to look back (the roaming shadow light)
    { t: FANLIGHT_STROKE.t, type: 'fx', id: 'shadowLight', params: { at: 'fanlight', pulses: FANLIGHT_STROKE.pulses } },
    { t: 3.88, type: 'sfx', id: 'score_hit', sched: true, gain: 0.9 },
    { t: 3.95, type: 'sfx', id: 'handrail_squeak', pos: [1.05, 3.5, 1.5], room, gain: 0.7 },
    { t: 4.5, type: 'fx', id: 'shadowLight', params: { at: 'off' } },
    { t: 4.55, type: 'sfx', id: 'gasp', gain: 0.5 },
    // 6.46 the stumble on the creaker 12
    { t: 6.46, type: 'sfx', id: 'step_creaker', pos: treadNosing(12), room, gain: 1.2 },
    { t: 6.46, type: 'clip', char: 'arms', clip: 'arms_stumble_catch', fade: 0.05, fallback: ['arms_idle'] },
    { t: 6.62, type: 'sfx', id: 'body_fall_stairs', pos: treadNosing(13), room, sched: true },
    { t: 6.64, type: 'sfx', id: 'torch_knock', pos: treadNosing(13), room, gain: 0.8 },
    { t: 6.66, type: 'sfx', id: 'gasp', gain: 0.9 },
    { t: 6.85, type: 'sfx', id: 'handrail_squeak', pos: handAt, room, gain: 1 },
    { t: 7.66, type: 'clip', char: 'arms', clip: 'arms_run_torch', loop: true, fade: 0.1, fallback: ['arms_idle'] },
    // the top (9.0): her steps stopped with his; breath held 9.6; one drop below (10.0); heartbeat 120
    { t: 9.0, type: 'loop', key: 'panting', id: null, fade: 0.4 },
    // the run stops: the arms settle (breath heaving) — the held torch comes back up to the eye line
    { t: 9.0, type: 'clip', char: 'arms', clip: 'arms_breath_hold', fade: 0.4, fallback: ['arms_idle'] },
    { t: 9.0, type: 'loop', key: 'stump', id: null, fade: 0.2 },
    { t: 9.1, type: 'heartbeat', bpm: 120 },
    { t: 9.6, type: 'sfx', id: 'breath_hold', gain: 0.7 },
    // 10.4: the camera faces north, away from the flight — she is gone (no sound, no prints, no motion on screen)
    { t: C2C_SKIP_AT, type: 'visible', char: 'ada', visible: false },
    { t: C2C_SKIP_AT, type: 'place', char: 'ada', pos: NODE.G_PARLOR_LURE, heading: 0 },
    // 12.9 the cold stroke through the U1 south window at the far end of the gallery
    { t: WINDOW_STROKE.t, type: 'fx', id: 'shadowLight', params: { at: 'u1_window', pulses: WINDOW_STROKE.pulses } },
    { t: 13.6, type: 'fx', id: 'shadowLight', params: { at: 'off' } },
    // 13.9 handover: control on the exact last camera
    { t: C2C_DURATION, type: 'fx', id: 'blood', params: { seq: 'c2c', phase: 'end' } },
    // §2.4: from B05 the shadow light is back at the lamp (behind the shut, locked parlor door: shadowed, no leak)
    { t: C2C_DURATION, type: 'fx', id: 'shadowLight', params: { at: 'lamp' } },
    { t: C2C_DURATION, type: 'clip', char: 'arms', clip: 'arms_idle', loop: true },
    { t: C2C_DURATION, type: 'release', char: 'arms' },
    { t: C2C_DURATION, type: 'player', pos: S.pos, heading: S.heading, pitch: S.pitch },
  ];
  // her heel slaps: 1.9 Hz on the flat, 1.5 Hz on the treads, stopping with the player's at 8.9
  for (let t = 0.2; t < 2.6; t += 1 / 1.9) cues.push({ t: Math.round(t * 1000) / 1000, type: 'sfx', id: 'bare_feet_wet', pos: [2.0, 2.9, 0.6], room, gain: 0.8 });
  for (const t of [4.6, 5.25, 5.9, 6.55, 7.2, 8.4, 8.9]) cues.push({ t, type: 'sfx', id: 'bare_feet_wet', pos: adaOnTread(Math.min(11, 1 + (t - 4.5) * 1.5)), room, gain: 0.9 });
  // the player's boots: the hall (2.6 Hz), the treads (3.1 risers/s; the creak on riser 5 at 3.45)
  for (let t = whipD + 0.05; t < hallEnd; t += 1 / 2.6) cues.push({ t: Math.round(t * 1000) / 1000, type: 'sfx', id: 'step_bare', pos: [1.6, 3.0, 0.6], room, gain: 1 });
  for (let k = 1; k <= 16; k++) {
    const t = k <= 5 ? hallEnd + 0.45 + (k - 0.6) / 3.1 : k <= 11 ? 4.69 + (k - 5.4) / 3.7 : k === 12 ? -1 : 7.66 + (k - 12.4) * 0.335;
    if (t < 0 || t > 9.0) continue;
    cues.push({ t: Math.round(t * 1000) / 1000, type: 'sfx', id: k === 5 ? 'step_creaker' : 'step_stair', pos: treadNosing(k), room, gain: 1 });
  }
  // the drip from tread 11's nosing onto tread 10, every 0.6 s, from 10.0
  for (let t = 10.0; t < C2C_DURATION; t += 0.6) cues.push({ t: Math.round(t * 1000) / 1000, type: 'sfx', id: 'blood_drip', pos: treadNosing(10.5), room, gain: 0.5 });

  const tl: Timeline = {
    id: 'C2c',
    duration: C2C_DURATION,
    lock: 'full',
    letterbox: [
      { t: 0, v: 1 },
      { t: 13.6, v: 1 },
      { t: 13.9, v: 0 },
    ],
    shots,
    moves,
    kicks: [{ t: 6.62, d: 0.12, pitch: -0.02, roll: 0.01 }],
    cues,
  };
  return tl;
};
