// C2 'The First Room on the Right' — docs/C2-ESCAPE.md rev 2 §2.1 (29.0 s, full lock). A POV in a 50 mm prime: the
// threshold freeze, the lean into the doorway reveal (D), the rigid two-handed strike (contact 7.56, the crack on the
// audio clock), the head out of the bottom of the frame, two jets in one still frame, the deliberate tilt to the head
// on the floor, the boot nudge (the cut ring lit by the lamp), the lift by the hair, the 100 mm eye insert (hard cuts),
// both of them looking at you, "Go on, then.", the rope / slam / bolt, the headless body rising (split-lit by the lamp),
// and her coming out of the parlor as the door shuts behind her. Chained into C2c 'Up' (host.ts POSTROLL) on the same
// camera: C2's last pose is C2c's first.
//
// One key: the restaged kerosene lamp L_LAMP_PARLOR (12 cd, 1950 K, NW of the neck, shadowed — the session's one
// cube-shadow light, K3). No lightning in C2 (thunder is heard). Every shot from D aims at a yaw ≤ 49° so the flame
// (bearing 73.2° from D) stays ≥ 1° outside the frame even on a 16:9 screen (half-hfov 23.2° at 50 mm).
// Clip origin O = 0.6: Harlan's and Ada's clip time = t − 0.6 (A4 clips harlan_c2 / ada_c2 / ada_rise_headless; the
// fallbacks keep the sequence playable until they land).

import { C2E_D, C2E_T, DOOR, GROUND, HARLAN_C2, HEAD_LAND, HEAD_REST, LAMP_FLAME, NECK, PROP, ADA_TABLE, add, fwd, headingTo, lens, dist } from './stage.ts';
import type { CameraShot, Cue, P3, Timeline, TimelineFactory } from './types.ts';
import { SEVER_CONTACT_S } from '../audio/synth/escape.ts';

/** Clip start (s). */
const O = 0.6;
export const C2_DURATION = 29.0;
/** Contact: the blade through C4–C5 (A4 clip time 6.96). */
export const C2_CONTACT = 7.56;
/** The head separates / is out of the bottom of the frame / lands off-screen. */
export const C2_SEVER = 7.6;
export const C2_HEAD_LANDS = 7.9;
/** The rope comes off the cleat. */
export const C2_ROPE_T = 20.0;
/** Arterial pulses (§3.3): onset (s), exit speed (m/s), duration (s), volume (mL). Pulses 5–6 when the body rises. */
export const C2_PULSES = [
  { t: 7.58, v: 2.8, d: 0.22, ml: 25 },
  { t: 8.4, v: 2.3, d: 0.2, ml: 20 },
  { t: 9.3, v: 1.7, d: 0.18, ml: 15 },
  { t: 10.35, v: 1.0, d: 0.16, ml: 10 },
  { t: 22.5, v: 0.4, d: 0.25, ml: 8 },
  { t: 23.5, v: 0.2, d: 0.25, ml: 5 },
] as const;

/** Where C2 ends and C2c begins (eye), looking at her just through the parlor door. */
export const C2_END_EYE: P3 = [2.35, 2.7, 2.25];
/** Ada's root when C2 hands over to C2c (0.4 m into the hall). */
export const C2_ADA_END: P3 = [3.3, 1.75, GROUND];
/** C2's last look-at = C2c's first: her stump/shoulders at the doorway. */
export const C2_END_TARGET: P3 = [3.3, 1.75, 1.45];
/** The risen body's root (east side of the sawbuck, toward its south end). */
export const ADA_RISE: P3 = [6.08, 2.9, GROUND];
/** Harlan's dark south-west corner in S10 (out of the lamp → body line). */
export const HARLAN_CORNER: P3 = [4.2, 0.65, GROUND];
/** Ada's walk out of the parlor, 24.5 → 27.4 (round the south end of the table, through the door). */
export const ADA_WALK: P3[] = [ADA_RISE, [5.95, 2.0, GROUND], [5.0, 1.6, GROUND], [4.2, 1.5, GROUND], [3.75, 1.5, GROUND], C2_ADA_END];

const DEG = Math.PI / 180;
/** Max aim yaw from D (bearing CCW from east): the flame is at 73.2°. */
export const D_MAX_YAW = 49 * DEG;
/** Max aim yaw from T (flame bearing 66.8°): 42° at 50 mm, 40° at 44 mm. */
export const T_MAX_YAW_50 = 42 * DEG;
export const T_MAX_YAW_44 = 40 * DEG;

/** Look-at point from `eye` along heading/pitch at the subject's distance (keeps DOF and Catmull-Rom sane). */
const aim = (eye: P3, heading: number, pitch: number, d: number): P3 => add(eye, fwd(heading, pitch, d));

export const c2Room: TimelineFactory = (ctx) => {
  const eye0 = ctx.player.eye;
  const look0 = add(eye0, fwd(ctx.player.heading, ctx.player.pitch, 3));
  const L50 = lens(50);
  const L44 = lens(44);
  const L40 = lens(40);
  const L100 = lens(100); // S6 insert (Low's 85 mm variant: Phase 2)
  const dNeck = dist(C2E_D, NECK); // 2.73 m (§2.0)

  // aims (heading, pitch) — see the header for the yaw rule
  const T_TABLEAU = aim(C2E_T, T_MAX_YAW_50, -7 * DEG, 3.0); // Harlan's silhouette, the raised cleaver, her back
  const D_WORK = aim(C2E_D, D_MAX_YAW, -6.5 * DEG, 2.8); // S2: Harlan from the knees up, her back and hair
  const D_STRIKE = aim(C2E_D, D_MAX_YAW, -12.7 * DEG, dNeck); // S3: the neck 4° under centre (lower third)
  const D_FLOOR = aim(C2E_D, D_MAX_YAW, -29.5 * DEG, dist(C2E_D, HEAD_REST)); // S4: the head on the floor
  const D_LIFT = aim(C2E_D, D_MAX_YAW, 1 * DEG, 2.7); // S5: the head at his face height (fist z 2.62, head 2.30)
  // S6 insert (100 mm). Review r2: the old fixed aim (60°, +2.6°, 2.55 m) framed wallpaper with the head at the right
  // edge. Aimed at her image-left eye, measured in-game at 13.0 s (head node = crown at plan (5.363, 3.598, 2.539),
  // face turned 3/4 toward the lamp by head-carry faceAt, heading ≈ 194°): eye ≈ crown − 0.10 m down, 0.09 m along
  // the face, 0.032 m to her right (image-left).
  const D_EYE: P3 = [5.268, 3.607, 2.44];
  const D_BOTH = aim(C2E_D, D_MAX_YAW, 2.5 * DEG, 2.7); // S7: the sack and the held head side by side
  // S8 the eye retreats 0.25 m toward T (50 → 44 mm drift)
  const toT = [C2E_T[0] - C2E_D[0], C2E_T[1] - C2E_D[1], C2E_T[2] - C2E_D[2]] as P3;
  const kT = 0.25 / Math.hypot(...toT);
  const E8: P3 = add(C2E_D, [toT[0] * kT, toT[1] * kT, toT[2] * kT]);
  const S10_EYE: P3 = [3.62, 1.33, 2.19]; // S10/S11 start: in the doorway reveal, the rope out of frame

  const shots: CameraShot[] = [
    // S1 Freeze 0–1.6: the body halts, the head pushes forward; the gameplay FOV eases to 50 mm
    { t: 0, d: 1.6, path: [eye0, C2E_T], target: [look0, T_TABLEAU], fov: [ctx.player.fov ?? 60, L50], ease: 'out', handheld: 0.6 },
    // S2 He sees you 1.6–5.4: the lean 0.24 m south past the rope (1.6–3.0), then held
    { t: 1.6, d: 1.4, path: [C2E_T, add(C2E_D, [0.03, 0.08, 0.01]), C2E_D], target: [T_TABLEAU, D_WORK], fov: L50, ease: 'inOut', handheld: 0.45 },
    { t: 3.0, d: 2.4, path: [C2E_D], target: [D_WORK], fov: L50, handheld: 0.45 },
    // S3 the strike: the frame settles (the player freezes) 5.4–7.30, then RIGID 7.30–8.60
    { t: 5.4, d: 1.9, path: [C2E_D], target: [D_WORK, D_STRIKE], fov: L50, ease: 'inOut', handheld: 0.15 },
    { t: 7.3, d: 1.3, path: [C2E_D], target: [D_STRIKE], fov: L50 },
    // S4 the floor 8.6–10.9: the deliberate tilt down (600 ms), then the head rocking to rest
    { t: 8.6, d: 0.6, path: [C2E_D], target: [D_STRIKE, D_FLOOR], fov: L50, ease: 'inOut', handheld: 0.35 },
    { t: 9.2, d: 1.7, path: [C2E_D], target: [D_FLOOR], fov: L50, handheld: 0.35 },
    // S5 the lift 10.9–12.9: the tilt follows the head up to his face height
    { t: 10.9, d: 2.0, path: [C2E_D], target: [D_FLOOR, D_LIFT], fov: L50, ease: 'inOut', handheld: 0.35 },
    // S6 the eye 12.9–14.9: a HARD-CUT 100 mm insert from D (no zoom), and a hard cut back
    { t: 12.9, d: 2.0, path: [C2E_D], target: [D_EYE], fov: L100, handheld: 0.25 },
    // S7 both of them look at you 14.9–17.9
    { t: 14.9, d: 3.0, path: [C2E_D], target: [D_BOTH], fov: L50, handheld: 0.35 },
    // S8 he comes to the door 17.9–20.0 (the eye retreats; 50 → 44 mm drift inside the retreat)
    { t: 17.9, d: 2.1, path: [C2E_D, E8], target: [D_BOTH, [4.6, 2.9, 1.7], [4.15, 2.15, 1.75]], fov: [L50, L44], ease: 'inOut', handheld: 0.35 },
    // S9 the rope 20.0–21.9 (whip-pan along the cornice to the front door; blur 0.8 where it exists)
    {
      t: C2_ROPE_T,
      d: 1.9,
      path: [E8, add(E8, [-0.1, 0.05, -0.02])],
      target: [PROP.P_CLEAT, PROP.P_PULLEY_3, PROP.P_PULLEY_1, add(DOOR.front, [0, 0, 1.4])],
      fov: L44,
      ease: 'out',
      handheld: 1.1,
      roll: [0, -0.04],
    },
    // S10 she gets up 21.9–25.7 (back through the doorway from T, 44 mm)
    // (r8: from T itself the door rope stood as a pillar in the frame — the eye stays in the reveal, 8 cm from D)
    { t: 21.9, d: 3.8, path: [add(E8, [-0.1, 0.05, -0.02]), S10_EYE], target: [add(DOOR.front, [0, 0, 1.4]), aim(S10_EYE, 30 * DEG, -10 * DEG, 2.9), add(ADA_RISE, [-0.1, 0, 1.3])], fov: L44, ease: 'out', handheld: 0.9 },
    // S11 she comes 25.7–29.0: the eye backs out to C2_END_EYE (44 → 40 mm), she is through at 27.4, the door shuts
    { t: 25.7, d: 3.3, path: [S10_EYE, [2.9, 2.15, 2.24], C2_END_EYE], target: [add(ADA_WALK[2], [0, 0, 1.3]), add(ADA_WALK[4], [0, 0, 1.4]), C2_END_TARGET], fov: [L44, L40], ease: 'inOut', handheld: 1.2 },
  ];

  const room = 'G2';
  const neckSnd: P3 = NECK;
  const cues: Cue[] = [
    { t: 0, type: 'lock', mode: 'full' },
    { t: 0, type: 'light', op: 'storm_auto', on: false },
    // the lamp is the ONE key: the player's torch (a 2000 cd co-located key that flattened the tableau and blew the
    // sheet out in r1) is lowered and off through C2; it comes on with the run (C2c t = 0)
    { t: 0, type: 'light', op: 'flashlight', on: false },
    // K3: the lamp is the key and the one shadow light (map every frame in C2)
    { t: 0, type: 'fx', id: 'shadowLight', params: { at: 'lamp' } },
    { t: 0, type: 'light', op: 'cast_shadow', id: 'L_LAMP_PARLOR', on: true },
    // lane A review (A9): the table candle front-fills Harlan from D; its runtime flicker share at half keeps him a
    // rim silhouette (key:fill ≥ 7:1) while the bake still holds its steady light
    { t: 0, type: 'light', op: 'set', id: 'L_CANDLE_TABLE', scale: 0.5 },
    { t: 17.9, type: 'light', op: 'set', id: 'L_CANDLE_TABLE', scale: 1, fadeS: 1.5 },
    // §2.4: spot-weighted meter on the work area (60 %), clamp [0.7, 8] (replaces the old blanket cap 2.8)
    // r2 look: spot 0.6 / max 8 metered the BLACK rubber sheet to middle grey and lit the room like day (+4 EV); the
    // work area now weighs 40 % and the clamp tops at 2.2 (the old cap 2.8 still read as a lit room)
    { t: 0, type: 'fx', id: 'exposure', params: { min: 0.5, max: 2.2, spotX: 0.5, spotY: 0.42, spotR: 0.16, spotW: 0.4 } },
    // B8: the motion-blur variant is switched in ONCE here (amount 0); only its uniform moves afterwards
    { t: 0, type: 'fx', id: 'blurAmount', params: { v: 0 } },
    // B4/B5: C2's blood (seeded, deterministic, every landing precomputed at load) runs on this clock
    { t: 0, type: 'fx', id: 'blood', params: { seq: 'c2', phase: 'start' } },
    { t: 0, type: 'voice', trigger: 'b03:threshold_freeze' },
    { t: 0, type: 'clip', char: 'arms', clip: 'arms_freeze', fallback: ['arms_idle'] },
    { t: 0, type: 'heartbeat', bpm: 96 },
    { t: 0, type: 'score', state: 'drone' },
    { t: 0, type: 'sfx', id: 'breath_hold', gain: 0.7 },
    // the tableau: she lies face-down across the sheet, head over the west edge; he stands at the head of the table
    { t: 0, type: 'place', char: 'ada', pos: ADA_TABLE.pos, heading: ADA_TABLE.heading },
    { t: 0, type: 'visible', char: 'ada', visible: true },
    { t: 0, type: 'clip', char: 'ada', clip: 'ada_c2', fade: 0, speed: 0, fallback: ['ada_table'] },
    { t: 0, type: 'place', char: 'harlan', pos: HARLAN_C2.pos, heading: HARLAN_C2.heading },
    { t: 0, type: 'visible', char: 'harlan', visible: true },
    { t: 0, type: 'clip', char: 'harlan', clip: 'harlan_c2', fade: 0, speed: 0, fallback: ['harlan_opening'] },
    { t: 0, type: 'dof', dof: { focusDistance: 3.0, focalLength: 1.6, bokehScale: 2 } },
    { t: O, type: 'clip', char: 'ada', clip: 'ada_c2', fade: 0.2, fallback: ['ada_table'] },
    { t: O, type: 'clip', char: 'harlan', clip: 'harlan_c2', fade: 0, fallback: ['harlan_opening'] },
    { t: 0.3, type: 'sfx', id: 'apron_creak', pos: [5.15, 3.95, 1.6], room, gain: 0.7 },
    // S2: the sack turns to the doorway (2.4) and back (4.4); the wind-up (4.8)
    { t: 3.6, type: 'sfx', id: 'sack_breath', pos: [5.15, 3.95, 2.35], room },
    { t: 4.8, type: 'sfx', id: 'apron_creak', pos: [5.15, 3.95, 1.6], room, gain: 0.9 },
    // S3: focus on the neck (2.73 m; Harlan at 2.95 just soft)
    { t: 5.4, type: 'dof', dof: { focusDistance: Math.round(dNeck * 100) / 100, focalLength: 0.8, bokehScale: 2 } },
    // 7.42–7.56 the two-handed downswing: blur 1.0 for these 140 ms (the clip's 3-frame smear where there is no blur)
    { t: 7.42, type: 'fx', id: 'blurAmount', params: { v: 1 } },
    // the crack lands ON the contact frame: the buffer's contact transient is SEVER_CONTACT_S in (the swish precedes)
    { t: Math.round((C2_CONTACT - SEVER_CONTACT_S) * 1000) / 1000, type: 'sfx', id: 'cleaver_sever', pos: neckSnd, room, sched: true },
    { t: C2_CONTACT, type: 'mark', name: 'c2:strike' },
    { t: C2_CONTACT, type: 'sfx', id: 'score_hit', sched: true, gain: 0.9 },
    { t: 7.58, type: 'fx', id: 'blurAmount', params: { v: 0 } },
    { t: C2_SEVER, type: 'fx', id: 'adaHead', params: { mode: 'sever' } },
    { t: 7.62, type: 'sfx', id: 'gasp', gain: 0.8 },
    { t: 7.62, type: 'subtitle', speaker: '', text: '(a choked cry)', d: 1.2, caption: true },
    { t: C2_HEAD_LANDS, type: 'sfx', id: 'head_drop', pos: HEAD_LAND, room, sched: true },
    { t: 8.6, type: 'dof', dof: { focusDistance: 2.7, focalLength: 0.8, bokehScale: 2 } },
    // S4: the boot nudge (9.45), the roll to rest by 10.1; thunder through the shutters (9.8)
    { t: 9.45, type: 'fx', id: 'adaHead', params: { mode: 'nudge' } },
    { t: 9.45, type: 'sfx', id: 'head_nudge', pos: HEAD_REST, room },
    { t: 9.8, type: 'sfx', id: 'thunder_distant', gain: 0.6 },
    { t: 10.6, type: 'sfx', id: 'hair_wring', pos: HEAD_REST, room },
    // 10.6: the crown grip — the head node goes to his left-hand socket (it hangs as a pendulum below the grip)
    { t: 10.6, type: 'attach', char: 'harlan', prop: 'ada_head', bone: 'prop_l' },
    { t: 10.6, type: 'fx', id: 'adaHead', params: { mode: 'held' } },
    // S6 the eye insert
    { t: 12.9, type: 'dof', dof: { focusDistance: 2.79, focalLength: 0.25, bokehScale: 2 } },
    { t: 13.6, type: 'fx', id: 'adaHead', params: { mode: 'eye_open' } },
    { t: 13.6, type: 'score', state: 'drone', stinger: 'score_stinger' },
    { t: 14.9, type: 'dof', dof: { focusDistance: 2.7, focalLength: 0.9, bokehScale: 2 } },
    // S7: three single heartbeats; the held breath releases on the first; "Go on, then." at 17.3
    { t: 15.0, type: 'heartbeat', bpm: 0 },
    { t: 15.1, type: 'sfx', id: 'heartbeat', gain: 1 },
    { t: 15.1, type: 'sfx', id: 'breath_release', gain: 0.6 },
    { t: 15.9, type: 'sfx', id: 'heartbeat', gain: 1 },
    { t: 16.7, type: 'sfx', id: 'heartbeat', gain: 1 },
    { t: 17.3, type: 'voice', trigger: 'c2:rope_slip' },
    // S8: he walks to the doorway in three steps, the head swinging by the hair at his left thigh
    { t: 17.9, type: 'dof', dof: null },
    { t: 18.1, type: 'sfx', id: 'step_bare', pos: [4.9, 3.3, 0.6], room },
    { t: 18.7, type: 'sfx', id: 'step_bare', pos: [4.55, 2.7, 0.6], room },
    { t: 19.3, type: 'sfx', id: 'step_bare', pos: [4.2, 2.15, 0.6], room },
    { t: 19.5, type: 'sfx', id: 'sack_breath', pos: [4.15, 2.1, 2.35], room },
    // S9: the rope off the cleat, the whip-pan (blur 0.8), slam 21.05, bolt 21.50
    { t: C2_ROPE_T, type: 'sfx', id: 'rope_pulleys', pos: PROP.P_PULLEY_3, room: 'G1' },
    { t: C2_ROPE_T, type: 'fx', id: 'rope_run', params: { dir: 'close' } },
    { t: C2_ROPE_T, type: 'fx', id: 'blurAmount', params: { v: 0.8 } },
    { t: 21.05, type: 'door', id: 'D_FRONT', action: 'slam' },
    { t: 21.05, type: 'sfx', id: 'door_slam', pos: DOOR.front, room: 'G1', sched: true },
    { t: 21.5, type: 'sfx', id: 'bolt_drop', pos: PROP.P_BOLT_BOX, room: 'G1' },
    { t: 21.6, type: 'heartbeat', bpm: 150 },
    { t: 21.9, type: 'fx', id: 'blurAmount', params: { v: 0 } },
    // S10: she gets up — the headless body slides back off the east side, climbing up its own arms (4.0 s)
    { t: 21.9, type: 'place', char: 'harlan', pos: HARLAN_CORNER, heading: headingTo(HARLAN_CORNER, [5.5, 3.0, 0]) },
    { t: 21.9, type: 'clip', char: 'ada', clip: 'ada_rise_headless', fade: 0.15, fallback: ['ada_rise'] },
    { t: 22.2, type: 'sfx', id: 'ada_slap', pos: ADA_RISE, room },
    { t: 22.3, type: 'loop', key: 'stump', id: 'stump_breath', gain: 0.8 },
    { t: 22.0, type: 'dof', dof: { focusDistance: 2.9, focalLength: 1.4, bokehScale: 2 } },
    // S11: she walks out of the parlor at you; the door closes behind her (27.6) and the key turns (28.3)
    { t: 24.5, type: 'score', state: 'chase' },
    { t: 24.5, type: 'clip', char: 'ada', clip: 'ada_chase_headless', loop: true, fade: 0.2, fallback: ['ada_chase', 'ada_patrol'] },
    { t: 25.7, type: 'dof', dof: null },
    { t: 26.9, type: 'sfx', id: 'handrail_squeak', pos: [3.7, 1.5, 1.5], room: 'G1', gain: 0.7 },
    { t: 27.6, type: 'door', id: 'D_PARLOR', action: 'close' },
    { t: 27.8, type: 'visible', char: 'harlan', visible: false },
    { t: 28.3, type: 'sfx', id: 'latch', pos: DOOR.parlor, room: 'G1', rate: 0.8 },
    { t: 28.3, type: 'door', id: 'D_PARLOR', action: 'lock' },
    // the lamp's direct light goes behind a shut door: off until B05 (C2c roams it to the fanlight / U1 window)
    { t: 27.7, type: 'fx', id: 'shadowLight', params: { at: 'off' } },
    { t: C2_DURATION, type: 'fx', id: 'blood', params: { seq: 'c2', phase: 'end' } },
  ];
  // the drip into the pool before the strike (one drop every ≈ 0.7 s, its pitch falling as the pool deepens)
  for (let t = 0.35, i = 0; t < 7.3; t += 0.7, i++) cues.push({ t: Math.round(t * 100) / 100, type: 'sfx', id: 'blood_drip', pos: [5.25, 3.25, 0.62], room, gain: 0.55, rate: 1 - i * 0.015 });
  // S2 cast-off from the heel of the raised blade (one drop every 1.2 s)
  for (const t of [2.0, 3.2, 4.4, 5.6, 6.8]) cues.push({ t, type: 'sfx', id: 'blood_drip', pos: [5.0, 3.7, 0.62], room, gain: 0.35 });
  // the pulses: spurt (scheduled) and the patter at each landing (§3.3: t + √(2h/g) = t + 0.404 s)
  for (const p of C2_PULSES) {
    cues.push({ t: p.t, type: 'sfx', id: 'arterial_spurt', pos: NECK, room, gain: Math.min(1, p.v / 2.8), sched: true });
    if (p.v > 0.9) cues.push({ t: Math.round((p.t + 0.404) * 1000) / 1000, type: 'sfx', id: 'blood_patter', pos: [NECK[0] - 0.404 * p.v, NECK[1], 0.6], room, gain: Math.min(1, p.ml / 25) });
  }
  // her wet bare feet (heel slap 1.6 Hz) from the walk
  for (let t = 24.6; t < 28.6; t += 1 / 1.6) cues.push({ t: Math.round(t * 1000) / 1000, type: 'sfx', id: 'bare_feet_wet', pos: [3.9, 1.6, 0.6], room: 'G1', gain: 0.8 });
  // the lurch: one step at 28.5
  cues.push({ t: 28.5, type: 'sfx', id: 'bare_feet_wet', pos: C2_ADA_END, room: 'G1', gain: 1 });

  const tl: Timeline = {
    id: 'C2',
    duration: C2_DURATION,
    lock: 'full',
    letterbox: [
      { t: 0, v: 0 },
      { t: 1.2, v: 1 },
    ],
    moves: [
      // the rise: the root slides back off the east side and stands (21.9–24.5)
      { char: 'ada', t: 21.9, d: 2.6, path: [ADA_TABLE.pos, ADA_RISE], ease: 'inOut', heading: [Math.PI, headingTo(ADA_RISE, DOOR.parlor)] },
      { char: 'ada', t: 24.5, d: 2.9, path: ADA_WALK, ease: 'linear', heading: 'path' },
      { char: 'ada', t: 28.4, d: 0.5, path: [C2_ADA_END, add(C2_ADA_END, [-0.11, 0.1, 0])], ease: 'out', heading: headingTo(C2_ADA_END, C2_END_EYE) },
      // he walks to the cleat (17.9–20.0), then into the dark south-west corner (20.0–21.9)
      { char: 'harlan', t: 17.9, d: 2.1, path: [HARLAN_C2.pos, [4.6, 2.9, GROUND], [4.15, 2.1, GROUND]], ease: 'inOut', heading: 'path' },
      { char: 'harlan', t: 20.2, d: 1.6, path: [[4.15, 2.1, GROUND], HARLAN_CORNER], ease: 'inOut', heading: 'path' },
    ],
    kicks: [
      // S2: a 0.04° jolt on each heartbeat (96 bpm)
      ...[1.9, 2.53, 3.15, 3.78, 4.4, 5.03].map((t) => ({ t, d: 0.12, pitch: 0.0007 })),
      // the only motion in the rigid frame: a ≤ 0.2° flinch at head_drop (150 ms)
      { t: C2_HEAD_LANDS, d: 0.15, pitch: -0.0035 },
      // the three heartbeats
      ...[15.1, 15.9, 16.7].map((t) => ({ t, d: 0.14, pitch: 0.0012 })),
    ],
    shots,
    cues,
  };
  return tl;
};

/** For tests: every cue time of a C2 element that §2.1 fixes. */
export const C2_MARKS = { contact: C2_CONTACT, sever: C2_SEVER, headLands: C2_HEAD_LANDS, rope: C2_ROPE_T, lamp: LAMP_FLAME } as const;
