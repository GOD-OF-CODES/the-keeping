// C2 'The First Room on the Right' (B03 → B04, ~22 s, M1) — DESIGN B03. Threshold freeze; the candle on the near
// (south) end of the sawbuck table throws the tableau onto the north tally wall (shadow-play of the stopped stroke);
// he turns her face to the doorway by the hair; one clouded eye opens; the sack turns to you; three heartbeats;
// "Go on, then."; the rope slips from the cleat and runs overhead; the front door slams and the bolt drops; she
// slides off the table and rises; you back into the hall; the parlor door swings shut behind her and a key turns;
// control returns mid-lurch (the story then locks the parlor, sets CP2 and starts the B04 chase).
//
// Clip sync (docs/CHARACTERS.md): ada_opening + harlan_opening start together at O; head lifted 4.5–7.5, sack to the
// doorway 8–9, eye opens 9.0, rope released 12.35 (clip time). Then ada_rise (4 s).
//
// C2_replay (3 s): after a death in B04 you respawn at CP2 and she rises again behind you.

import { ADA_HEAD_LIFTED, ADA_TABLE, CAM, DOOR, HARLAN_SACK, HARLAN_TABLE, PROP, SPAWN, add, focusAt, fwd, headingTo } from './stage.ts';
import type { Cue, P3, Timeline, TimelineFactory } from './types.ts';

/** Clip start (s) — every tableau cue below is O + clip time. */
const O = 0.6;
export const C2_ROPE_T = O + 12.35;
export const C2_DURATION = 21.6;

/** Where control returns (eye), looking at her through the doorway. */
export const C2_END_EYE: P3 = [2.35, 2.7, 2.25];
/** Ada's root when control returns (hall side of the parlor doorway). */
export const C2_ADA_END: P3 = [3.35, 1.55, 0.6];

export const c2Room: TimelineFactory = (ctx) => {
  const th = CAM.parlor_threshold;
  const eye0 = ctx.player.eye;
  const look0 = add(eye0, fwd(ctx.player.heading, ctx.player.pitch, 3));
  const tallyWall: P3 = [6.7, 5.95, 2.3];
  const endHeading = headingTo(C2_END_EYE, C2_ADA_END);
  const endLook = add(C2_END_EYE, fwd(endHeading, -0.28, 2));

  const cues: Cue[] = [
    { t: 0, type: 'lock', mode: 'full' },
    { t: 0, type: 'light', op: 'storm_auto', on: false },
    { t: 0, type: 'light', op: 'cast_shadow', id: 'L_CANDLE_TABLE', on: true },
    // R3-5 (runtime lane D): the snap at the room cuts landed at exposure 10.5 (the candle table top and Harlan's hood
    // clipped; the parlor read as a lit room). Cap the meter for the whole cutscene; reset on camera release.
    { t: 0, type: 'fx', id: 'exposure', params: { max: 2.8 } }, // look rd (max 5): still a lit room + clipped table top; base build read right at 2.65
    { t: 0, type: 'voice', trigger: 'b03:threshold_freeze' },
    { t: 0, type: 'clip', char: 'arms', clip: 'arms_freeze', fallback: ['arms_idle'] },
    { t: 0, type: 'heartbeat', bpm: 96 },
    { t: 0, type: 'score', state: 'drone', stinger: 'score_stinger' },
    // the tableau (both already in place: he stands over her, the stroke raised)
    { t: 0, type: 'place', char: 'ada', pos: ADA_TABLE.pos, heading: ADA_TABLE.heading },
    { t: 0, type: 'visible', char: 'ada', visible: true },
    { t: 0, type: 'clip', char: 'ada', clip: 'ada_table', loop: true, fade: 0 },
    { t: 0, type: 'place', char: 'harlan', pos: HARLAN_TABLE.pos, heading: HARLAN_TABLE.heading },
    { t: 0, type: 'visible', char: 'harlan', visible: true },
    { t: 0, type: 'clip', char: 'harlan', clip: 'harlan_opening', fade: 0, speed: 0 }, // frame 0 held: stroke raised
    { t: 0, type: 'dof', dof: { focusDistance: 3.6, focalLength: 2.2, bokehScale: 2 } },
    { t: O, type: 'clip', char: 'ada', clip: 'ada_opening', fade: 0.2 },
    { t: O, type: 'clip', char: 'harlan', clip: 'harlan_opening', fade: 0 },
    { t: O + 0.3, type: 'sfx', id: 'apron_creak', pos: HARLAN_SACK, room: 'G2', gain: 0.8 },
    { t: O + 3.2, type: 'sfx', id: 'sack_breath', pos: HARLAN_SACK, room: 'G2' },
    // head lifted and turned by the hair
    { t: O + 4.6, type: 'sfx', id: 'ada_gurgle', pos: ADA_HEAD_LIFTED, room: 'G2', gain: 0.6 },
    { t: O + 4.6, type: 'dof', dof: focusAt(th.pos, ADA_HEAD_LIFTED, 1.4, 2.5) },
    // the eye opens; the sack turns to you
    { t: O + 8.9, type: 'score', state: 'drone', stinger: 'score_stinger' },
    // three heartbeats
    { t: O + 10.3, type: 'heartbeat', bpm: 0 },
    { t: O + 10.4, type: 'sfx', id: 'heartbeat', gain: 1 },
    { t: O + 11.2, type: 'sfx', id: 'heartbeat', gain: 1 },
    { t: O + 12.0, type: 'sfx', id: 'heartbeat', gain: 1 },
    { t: O + 11.9, type: 'voice', trigger: 'c2:rope_slip' },
    // the rope slips from the cleat, runs overhead; the front door slams and the bolt drops
    { t: C2_ROPE_T, type: 'sfx', id: 'rope_pulleys', pos: PROP.P_PULLEY_3, room: 'G1' },
    { t: C2_ROPE_T, type: 'fx', id: 'rope_run', params: { dir: 'close' } },
    { t: C2_ROPE_T, type: 'dof', dof: null },
    { t: C2_ROPE_T + 1.05, type: 'door', id: 'D_FRONT', action: 'slam' },
    { t: C2_ROPE_T + 1.1, type: 'sfx', id: 'door_slam', pos: DOOR.front, room: 'G1' },
    { t: C2_ROPE_T + 1.5, type: 'sfx', id: 'bolt_drop', pos: PROP.P_BOLT_BOX, room: 'G1' },
    { t: C2_ROPE_T + 1.6, type: 'heartbeat', bpm: 150 },
    // she slides off the table and rises
    { t: O + 15.0, type: 'clip', char: 'ada', clip: 'ada_rise', fade: 0.15 },
    { t: O + 15.1, type: 'sfx', id: 'ada_slap', pos: ADA_TABLE.pos, room: 'G2' },
    { t: O + 15.2, type: 'dof', dof: { focusDistance: 2.6, focalLength: 1.8, bokehScale: 2 } },
    { t: O + 16.2, type: 'sfx', id: 'ada_bone_crack', pos: ADA_HEAD_LIFTED, room: 'G2', gain: 0.7 },
    { t: 18.6, type: 'score', state: 'chase' },
    { t: 18.6, type: 'clip', char: 'ada', clip: 'ada_chase', loop: true, fade: 0.2, fallback: ['ada_patrol'] },
    { t: 18.9, type: 'sfx', id: 'ada_gown_slap', pos: [4.6, 2.2, 0.6], room: 'G2' },
    // behind her the parlor door swings shut and a key turns (he is out of sight behind it)
    { t: 20.4, type: 'visible', char: 'harlan', visible: false },
    { t: 20.5, type: 'door', id: 'D_PARLOR', action: 'close' },
    { t: 21.0, type: 'sfx', id: 'latch', pos: DOOR.parlor, room: 'G1', rate: 0.8 },
    { t: 21.2, type: 'door', id: 'D_PARLOR', action: 'lock' },
    { t: C2_DURATION, type: 'player', pos: C2_END_EYE, heading: endHeading, pitch: -0.28 },
    { t: C2_DURATION, type: 'clip', char: 'arms', clip: 'arms_idle', loop: true },
    { t: C2_DURATION, type: 'release', char: 'arms' },
    { t: C2_DURATION, type: 'release', char: 'ada' },
  ];

  return {
    id: 'C2',
    duration: C2_DURATION,
    lock: 'full',
    letterbox: [
      { t: 0, v: 0 },
      { t: 1.2, v: 1 },
      { t: 19.8, v: 1 },
      { t: 21.4, v: 0 },
    ],
    moves: [{ char: 'ada', t: 18.6, d: 2.8, path: [[5.55, 2.95, 0.6], [4.55, 2.15, 0.6], C2_ADA_END], ease: 'linear', heading: 'path' }],
    shots: [
      // the freeze: the camera settles into the opening's exact threshold and lens
      { t: 0, d: 1.5, path: [eye0, th.pos], target: [look0, th.target], fov: [ctx.player.fov ?? 60, th.fov], ease: 'out', handheld: 0.6 },
      // shadow-play: the stopped stroke, huge on the tally wall
      { t: 1.5, d: O + 4.4 - 1.5, path: [th.pos], target: [add(tallyWall, [-0.4, 0, 0.3]), tallyWall], fov: [th.fov, 40], ease: 'inOut', handheld: 0.5 },
      // the tableau: he turns her face to the doorway by the hair
      { t: O + 4.4, d: 4.2, path: [th.pos], target: [add(th.target, [-0.4, -0.3, -0.1]), th.target], fov: [th.fov, 46], ease: 'inOut', handheld: 0.45 },
      // one clouded eye opens behind the hair
      { t: O + 8.6, d: 1.9, path: [th.pos], target: [ADA_HEAD_LIFTED], fov: [26, 22], ease: 'linear', handheld: 0.3 },
      // both of them look at you — three heartbeats
      { t: O + 10.5, d: C2_ROPE_T - (O + 10.5), path: [th.pos], target: [[5.05, 3.25, 1.85]], fov: 36, handheld: 0.35 },
      // the rope runs over your head to the front door
      {
        t: C2_ROPE_T,
        d: 2.0,
        path: [th.pos, add(th.pos, [-0.1, 0.05, -0.02])],
        target: [PROP.P_CLEAT, PROP.P_PULLEY_3, PROP.P_PULLEY_1, add(DOOR.front, [0, 0, 1.4])],
        fov: 58,
        ease: 'out',
        handheld: 1.1,
        roll: [0, -0.04],
      },
      // back to the room: she slides off the table and rises, head lolling
      { t: C2_ROPE_T + 2.0, d: 18.6 - (C2_ROPE_T + 2.0), path: [th.pos, [3.05, 1.9, 2.2]], target: [[5.6, 3.1, 1.3], [5.4, 3.0, 1.35]], fov: 46, ease: 'inOut', handheld: 0.9 },
      // she comes; you back into the hall
      { t: 18.6, d: C2_DURATION - 18.6, path: [[3.05, 1.9, 2.2], C2_END_EYE], target: [[4.6, 2.3, 1.45], add(C2_ADA_END, [0, 0, 1.3]), endLook], fov: [46, ctx.player.fov ?? 60], ease: 'inOut', handheld: 1.2 },
    ],
    cues,
  };
};

/** C2_replay: 3 s — the respawn at CP2 (already teleported by the story) and she rises again behind you. */
export const C2_REPLAY_DURATION = 3;
export const C2_REPLAY_ADA: P3 = [3.3, 0.95, 0.6];

export const c2Replay: TimelineFactory = (ctx) => {
  const cp = SPAWN.CP2;
  const eye = cp.pos;
  const back = add(C2_REPLAY_ADA, [0, 0, 1.2]);
  const ahead = add(eye, fwd(cp.heading, 0, 4));
  const tl: Timeline = {
    id: 'C2_replay',
    duration: C2_REPLAY_DURATION,
    lock: 'full',
    fade: [
      { t: 0, v: 1 },
      { t: 0.7, v: 0 },
    ],
    shots: [
      { t: 0, d: 1.9, path: [eye], target: [back, add(back, [0, 0, 0.2])], fov: [52, 50], ease: 'linear', handheld: 1 },
      { t: 1.9, d: 1.1, path: [eye], target: [back, ahead], fov: [50, ctx.player.fov ?? 60], ease: 'inOut', handheld: 1.2 },
    ],
    cues: [
      { t: 0, type: 'lock', mode: 'full' },
      { t: 0, type: 'place', char: 'ada', pos: C2_REPLAY_ADA, heading: headingTo(C2_REPLAY_ADA, eye) },
      { t: 0, type: 'visible', char: 'ada', visible: true },
      { t: 0, type: 'clip', char: 'ada', clip: 'ada_rise', fade: 0 },
      { t: 0, type: 'score', state: 'chase' },
      { t: 0, type: 'heartbeat', bpm: 150 },
      { t: 0.8, type: 'sfx', id: 'ada_bone_crack', pos: back, room: 'G1', gain: 0.7 },
      { t: 1.4, type: 'sfx', id: 'ada_gurgle', pos: back, room: 'G1' },
      { t: C2_REPLAY_DURATION, type: 'player', pos: eye, heading: cp.heading, pitch: cp.pitch },
      { t: C2_REPLAY_DURATION, type: 'release', char: 'ada' },
    ],
  };
  return tl;
};
