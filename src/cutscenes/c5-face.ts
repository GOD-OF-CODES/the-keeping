// C5 'Face' (B11 → B12, ~33 s, M2) — DESIGN B11. Plays when Ada waits at the parlor door with the locket (the locket
// look + take already happened in gameplay: the brain's FINALE) and the player is in the hall.
//   silence (the bell has stopped) · she knocks three times, slowly — your knock · the door opens a crack as he checks
//   (candlelight, the sack's eyeholes): "Ada?… No. No, no—" · her hand in the gap · you are walked to the threshold,
//   framed exactly as in the opening · he backs away raising the cleaver; she walks into it; the candle dies ·
//   lightning: her shadow pulls the sack from his head ("…Harlan.") · next flash: her shadow lifts his cleaver ·
//   black · one stroke · the bell rings once · the rope zips through the pulleys · behind you the front door swings
//   open onto grey mist · the parlor door closes.
// The story then sets harlan_taken, opens the front door on the rope (idempotent with ours), voices
// 'b11:front_door_opens' (the driver's trembling breath — NOT emitted here), hides Ada and moves to B12.
//
// The unmasking is shadow-play: DESIGN asks for a pre-rendered silhouette (fx 'silhouette' hooks for the world lane —
// a gobo/decal on the tally wall) with the real characters staged behind as the fallback.

import { CAM, DOOR, NODE, PROP, add, focusAt, fwd, headingTo } from './stage.ts';
import type { Cue, P3, TimelineFactory } from './types.ts';

export const C5_DURATION = 33;
const FLASH1 = 17.5;
const FLASH2 = 20.5;

/** Where gameplay resumes: at the threshold, turned toward the open front door. */
export const C5_END_EYE: P3 = [3.0, 1.75, 2.25];

export const c5Face: TimelineFactory = (ctx) => {
  const eye0 = ctx.player.eye;
  const look0 = add(eye0, fwd(ctx.player.heading, ctx.player.pitch, 3));
  const th = CAM.parlor_threshold;
  const adaAtDoor: P3 = ctx.ada ? [ctx.ada.pos[0], ctx.ada.pos[1], ctx.ada.pos[2]] : NODE.G_PARLOR_LURE;
  const doorGap: P3 = [3.72, 1.62, 1.75];
  const harlanGap: P3 = [4.25, 1.6, 0.6];
  const frontOut: P3 = [1.8, -1.2, 1.9];
  const endHeading = headingTo(C5_END_EYE, frontOut);
  // the walk to the threshold starts wherever the player stood in the hall
  const walkMid: P3 = [(eye0[0] + th.pos[0]) / 2 - 0.2, (eye0[1] + th.pos[1]) / 2 + 0.3, 2.2];

  const cues: Cue[] = [
    { t: 0, type: 'lock', mode: 'full' },
    { t: 0, type: 'light', op: 'storm_auto', on: false },
    { t: 0, type: 'score', state: 'none' },
    { t: 0, type: 'heartbeat', bpm: 72 },
    { t: 0, type: 'place', char: 'ada', pos: adaAtDoor, heading: 0 },
    { t: 0, type: 'visible', char: 'ada', visible: true },
    { t: 0, type: 'clip', char: 'ada', clip: 'ada_finale', fallback: ['ada_vigil'], loop: false },
    { t: 0, type: 'dof', dof: focusAt(eye0, add(adaAtDoor, [0, 0, 1.3]), 1.6, 2) },
    // three slow knocks — your knock
    { t: 3.0, type: 'sfx', id: 'knock', pos: DOOR.parlor, room: 'G1' },
    { t: 4.4, type: 'sfx', id: 'knock', pos: DOOR.parlor, room: 'G1' },
    { t: 5.8, type: 'sfx', id: 'knock', pos: DOOR.parlor, room: 'G1' },
    // the door opens a crack as he checks
    { t: 6.4, type: 'place', char: 'harlan', pos: harlanGap, heading: Math.PI },
    { t: 6.4, type: 'clip', char: 'harlan', clip: 'harlan_finale', fallback: ['harlan_pose_stairs_foot'], fade: 0 },
    { t: 6.4, type: 'visible', char: 'harlan', visible: true },
    { t: 6.9, type: 'door', id: 'D_PARLOR', action: 'unlock' },
    { t: 7.0, type: 'door', id: 'D_PARLOR', action: 'open' },
    { t: 7.0, type: 'sfx', id: 'door_creak', pos: DOOR.parlor, room: 'G1' },
    { t: 7.1, type: 'dof', dof: focusAt([2.5, 2.35, 2.05], doorGap, 0.9, 2.5) },
    { t: 7.7, type: 'voice', trigger: 'c5:door_crack' },
    // her hand in the gap
    { t: 8.6, type: 'sfx', id: 'ada_slap', pos: doorGap, room: 'G1' },
    { t: 9.2, type: 'sfx', id: 'ada_gurgle', pos: doorGap, room: 'G1', gain: 0.7 },
    // walked to the threshold; he backs away raising the cleaver; she walks into it
    { t: 10.0, type: 'clip', char: 'ada', clip: 'ada_patrol', loop: true },
    { t: 10.0, type: 'clip', char: 'harlan', clip: 'harlan_finale', fallback: ['harlan_opening'], fade: 0.3 },
    { t: 10.2, type: 'sfx', id: 'apron_creak', pos: [4.8, 2.3, 1.2], room: 'G2' },
    { t: 12.0, type: 'dof', dof: focusAt(th.pos, [5.2, 2.9, 1.5], 1.4, 2.5) },
    { t: 14.6, type: 'sfx', id: 'sack_breath', pos: [5.4, 3.3, 2.3], room: 'G2' },
    { t: 15.4, type: 'clip', char: 'ada', clip: 'ada_look', fallback: ['ada_listen'] },
    // the candle dies (baked light can't go out: the fade darkens the room, flames gutter)
    { t: 15.6, type: 'light', op: 'gutter', id: 'L_CANDLE_TABLE', d: 0.4 },
    { t: 15.7, type: 'light', op: 'gutter', id: 'L_CANDLE_MANTEL', d: 0.5 },
    { t: 15.7, type: 'light', op: 'gutter', id: 'L_CANDLE_SILL', d: 0.5 },
    { t: 16.0, type: 'dof', dof: null },
    // lightning: her shadow pulls the sack from his head
    { t: FLASH1 - 0.05, type: 'fx', id: 'silhouette', params: { id: 'unmask', on: true } },
    { t: FLASH1, type: 'light', op: 'lightning', strength: 1 },
    { t: FLASH1 + 0.6, type: 'voice', trigger: 'c5:recognition' },
    { t: FLASH1 + 0.9, type: 'fx', id: 'silhouette', params: { id: 'unmask', on: false } },
    // next flash: her shadow lifts his cleaver
    { t: FLASH2 - 0.05, type: 'fx', id: 'silhouette', params: { id: 'cleaver', on: true } },
    { t: FLASH2, type: 'light', op: 'lightning', strength: 1 },
    { t: FLASH2 + 0.9, type: 'fx', id: 'silhouette', params: { id: 'cleaver', on: false } },
    // black · one stroke · one bell
    { t: 21.6, type: 'visible', char: 'harlan', visible: false },
    { t: 21.6, type: 'visible', char: 'ada', visible: false },
    { t: 22.6, type: 'sfx', id: 'wet_chop', pos: [5.6, 3.3, 1.2], room: 'G2' },
    { t: 22.7, type: 'heartbeat', bpm: 0 },
    { t: 24.0, type: 'sfx', id: 'spring_bell', pos: PROP.P_SPRING_BELL, room: 'G2' },
    // the rope zips; the bolt lifts; the front door swings open onto grey mist
    { t: 25.6, type: 'sfx', id: 'rope_pulleys', pos: PROP.P_PULLEY_3, room: 'G1' },
    { t: 25.6, type: 'fx', id: 'rope_run', params: { dir: 'open' } },
    { t: 26.3, type: 'sfx', id: 'bolt_box_clank', pos: PROP.P_BOLT_BOX, room: 'G1' },
    { t: 26.4, type: 'weather', rain: 0.1, wind: 0.3, inside: 1, surface: 'roof' },
    { t: 26.6, type: 'door', id: 'D_FRONT', action: 'rope_open' },
    { t: 26.6, type: 'fx', id: 'blue_hour', params: { mist: 1, rain: 0 } },
    // the parlor door closes behind you
    { t: 28.8, type: 'door', id: 'D_PARLOR', action: 'close' },
    { t: 29.3, type: 'sfx', id: 'latch', pos: DOOR.parlor, room: 'G1' },
    { t: 29.4, type: 'door', id: 'D_PARLOR', action: 'lock' },
    { t: 30.0, type: 'score', state: 'blue_hour' },
    { t: C5_DURATION, type: 'player', pos: C5_END_EYE, heading: endHeading, pitch: 0 },
    { t: C5_DURATION, type: 'release', char: 'ada' },
  ];

  return {
    id: 'C5',
    duration: C5_DURATION,
    lock: 'full',
    fade: [
      { t: 0, v: 0 },
      { t: 15.6, v: 0 },
      { t: 16.2, v: 0.9 },
      { t: FLASH1 - 0.02, v: 0.9 },
      { t: FLASH1 + 0.05, v: 0.05 },
      { t: FLASH1 + 0.8, v: 0.92 },
      { t: FLASH2 - 0.02, v: 0.92 },
      { t: FLASH2 + 0.05, v: 0.05 },
      { t: FLASH2 + 0.8, v: 0.95 },
      { t: 21.3, v: 1 },
      { t: 25.2, v: 1 },
      { t: 27.0, v: 0 },
    ],
    letterbox: [
      { t: 0, v: 0 },
      { t: 1.5, v: 1 },
      { t: 31.0, v: 1 },
      { t: 32.8, v: 0 },
    ],
    moves: [
      { char: 'ada', t: 8.6, d: 1.4, path: [adaAtDoor, [3.6, 1.55, 0.6]], ease: 'inOut', heading: 0 },
      { char: 'ada', t: 10.0, d: 5.4, path: [[3.6, 1.55, 0.6], [4.4, 2.1, 0.6], [5.0, 2.65, 0.6]], ease: 'linear', heading: 'path' },
      { char: 'harlan', t: 10.0, d: 5.0, path: [harlanGap, [5.0, 2.6, 0.6], [5.45, 3.25, 0.6]], ease: 'out', heading: [Math.PI, Math.PI + 0.9] },
    ],
    shots: [
      // silence: from where you stand, she waits at his door
      { t: 0, d: 6.2, path: [eye0], target: [look0, add(adaAtDoor, [0.2, 0, 1.3])], fov: [ctx.player.fov ?? 60, 42], ease: 'inOut', handheld: 0.5 },
      // the door gap: candlelight and the sack's eyeholes
      { t: 6.2, d: 3.8, path: [[2.5, 2.35, 2.05], [2.6, 2.2, 2.05]], target: [doorGap, add(doorGap, [0.05, -0.05, 0.1])], fov: [34, 30], ease: 'inOut', handheld: 0.45 },
      // walked to the threshold — the opening's exact frame
      { t: 10.0, d: 4.2, path: [add(eye0, [0, 0, -0.05]), walkMid, th.pos], target: [add(adaAtDoor, [0.8, 0.3, 1.2]), [5.0, 2.8, 1.5], th.target], fov: [48, th.fov], ease: 'inOut', handheld: 1.2 },
      { t: 14.2, d: FLASH1 - 0.8 - 14.2, path: [th.pos], target: [th.target, add(th.target, [-0.5, -0.3, 0])], fov: th.fov, ease: 'linear', handheld: 0.4 },
      // shadow-play on the tally wall + the door gap
      { t: FLASH1 - 0.8, d: 21.3 - (FLASH1 - 0.8), path: [CAM.parlor_wide.pos], target: [CAM.parlor_wide.target], fov: CAM.parlor_wide.fov, handheld: 0.3 },
      // black … then behind you the front door swings open onto grey mist
      { t: 21.3, d: C5_DURATION - 21.3, path: [th.pos, add(th.pos, [-0.2, 0.1, 0]), C5_END_EYE], target: [[2.4, 0.4, 2.4], [1.9, -0.4, 2.0], add(C5_END_EYE, fwd(endHeading, 0, 3))], fov: [55, ctx.player.fov ?? 60], ease: 'inOut', handheld: 0.6 },
    ],
    cues,
  };
};
