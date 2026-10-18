// C6b 'Bait' (13 s, M-A) — docs/CUTSCENES-PLAN.md §3. C6 → C6b → C7 (host.ts POSTROLL C6 → C6b; the story starts C7
// on C6's done, which fires after C6b). Carries the time card. "Whoever holds the rope keeps the house", shown before
// C7 states it, so the sting confirms a fear instead of arriving from nowhere.
//
// Hands only, in macro, against a match flare and candle bokeh (faces-hidden audit); the empty wide shot lets the
// wet gravel and the creaking sign imply her. Every state cue is paired: Ada (visible/placed) and the 'sting' dressing
// go back off at 11 s, so a skip leaves the world as before (C7 then sets its own state at t 0). L_LANTERN ends LIT
// (C7 relights it at t 0 anyway).

import { ADA_TAKE_045_L, CLEAT_ADA, CLEAT_EYE, CLEAT_FINGERS, PROP, add, focusAt, lens, rootForReach } from './stage.ts';
import type { Cue, P3, TimelineFactory } from './types.ts';

export const C6B_DURATION = 13;
export const C6B_CARD = 'Three weeks later';
/** Her match/hand frame at the ROOMS lantern (EXT1, behind the sign). */
export const C6B_LANTERN_EYE: P3 = [-1.3, -29.2, 1.9];
export const C6B_WIDE_EYE: P3 = [-3.5, -31.5, 0.5];
export const C6B_WIDE_TARGET: P3 = [-1.8, -28.5, 1.8];
/** The frames her two clips are held on (clip cue `at` + speed 0). */
export const TAKE_HOLD_S = 0.45;
export const FINALE_HOOK_S = 8.9;

export const c6bBait: TimelineFactory = () => {
  const lantern = PROP.P_SIGN_LANTERN;
  const cleat = CLEAT_FINGERS;
  // her left index just in front of the lantern glass, her body off to the side (out of the 85 mm frame, root raised)
  const atLantern = rootForReach([lantern[0] + 0.03, lantern[1] - 0.07, lantern[2] - 0.02], [-1.39, -28.18, 0], ADA_TAKE_045_L);

  const cues: Cue[] = [
    { t: 0, type: 'lock', mode: 'full' },
    { t: 0, type: 'light', op: 'storm_auto', on: false },
    // three weeks later: rain again, night
    { t: 0, type: 'card', text: C6B_CARD, style: 'small' },
    { t: 0, type: 'fx', id: 'blue_hour', params: { mist: 0, rain: 1 } },
    { t: 0, type: 'weather', rain: 1, wind: 0.5, inside: 0, surface: 'gravel' },
    { t: 0, type: 'score', state: 'drone' },
    { t: 0, type: 'light', op: 'set', id: 'L_LANTERN', scale: 0 },
    { t: 0.6, type: 'sfx', id: 'thunder_distant', gain: 0.7 },
    { t: 1.7, type: 'card', text: null, style: 'small' },
    // the lantern: a grey wet hand, a match flare, water hissing on hot glass, the wick catches
    { t: 2.0, type: 'place', char: 'ada', pos: atLantern.pos, heading: atLantern.heading },
    { t: 0, type: 'light', op: 'flashlight', on: false },
    { t: 2.0, type: 'visible', char: 'ada', visible: true },
    { t: 2.0, type: 'clip', char: 'ada', clip: 'ada_finale_take', at: TAKE_HOLD_S, speed: 0, fade: 0, fallback: ['ada_vigil'] },
    { t: 2.0, type: 'dof', dof: focusAt(C6B_LANTERN_EYE, lantern, 0.12, 2.5) },
    { t: 3.1, type: 'sfx', id: 'match', pos: lantern, room: 'EXT1', gain: 0.8 },
    { t: 3.15, type: 'fx', id: 'match_flare', params: { on: true, x: lantern[0], y: lantern[1], z: lantern[2] } },
    { t: 3.9, type: 'sfx', id: 'sizzle', pos: lantern, room: 'EXT1', gain: 0.6 },
    { t: 4.3, type: 'light', op: 'set', id: 'L_LANTERN', scale: 0.3 },
    { t: 4.55, type: 'light', op: 'set', id: 'L_LANTERN', scale: 0.75 },
    { t: 4.8, type: 'light', op: 'set', id: 'L_LANTERN', scale: 1 },
    { t: 5.4, type: 'fx', id: 'match_flare', params: { on: false } },
    // wide and low: the ROOMS board and the VACANCY plate creak under the relit lantern; no one is there
    { t: 6.0, type: 'visible', char: 'ada', visible: false },
    { t: 6.0, type: 'dof', dof: focusAt(C6B_WIDE_EYE, C6B_WIDE_TARGET, 2.5, 1.5) },
    { t: 6.0, type: 'fx', id: 'footprints_path', params: { on: true, path: 'sign_to_gate' } },
    { t: 6.3, type: 'sfx', id: 'vacancy_creak', pos: PROP.P_VACANCY_PLATE, room: 'EXT1' },
    { t: 7.6, type: 'sfx', id: 'vacancy_creak', pos: PROP.P_VACANCY_PLATE, room: 'EXT1', gain: 0.7, rate: 0.9 },
    // the parlor: grey fingers test the rope and make it fast on the cleat; a whisper
    { t: 8.5, type: 'fx', id: 'footprints_path', params: { on: false } },
    { t: 8.5, type: 'dressing', set: 'sting', on: true },
    { t: 8.5, type: 'weather', rain: 1, wind: 0.5, inside: 1, surface: 'roof' },
    // AD review M-A: on the real route she carries her severed head in her right hand — the head-carry IK pins that hand at
    // her hip and overrode the measured hook pose (no fingers on the rope); free the head for the insert, give it back after
    { t: 8.5, type: 'attach', char: 'ada', prop: 'ada_head', bone: null },
    { t: 8.5, type: 'place', char: 'ada', pos: CLEAT_ADA.pos, heading: CLEAT_ADA.heading },
    { t: 8.5, type: 'visible', char: 'ada', visible: true },
    { t: 8.5, type: 'clip', char: 'ada', clip: 'ada_finale', at: FINALE_HOOK_S, speed: 0, fade: 0, fallback: ['ada_vigil'] },
    { t: 8.5, type: 'light', op: 'set', id: 'L_CANDLE_TABLE', scale: 1 },
    { t: 8.5, type: 'dof', dof: focusAt(CLEAT_EYE, cleat, 0.25, 3) },
    { t: 8.9, type: 'sfx', id: 'rope_creak', pos: cleat, room: 'G2', gain: 0.7 },
    { t: 9.4, type: 'sfx', id: 'rope_creak', pos: cleat, room: 'G2', gain: 0.9, rate: 0.85 },
    { t: 9.8, type: 'voice', trigger: 'c6b:company' },
    { t: 10.3, type: 'sfx', id: 'rocking_chair', pos: PROP.P_ROCKER, room: 'G2', gain: 0.6 },
    // black → C7 (the dashboard, the fuel lamp blinking)
    { t: 11.0, type: 'dof', dof: null },
    { t: 11.0, type: 'visible', char: 'ada', visible: false },
    { t: 11.0, type: 'attach', char: 'ada', prop: 'ada_head', bone: 'prop_r' },
    { t: 11.0, type: 'dressing', set: 'sting', on: false },
    { t: 11.0, type: 'weather', rain: 1, wind: 0.5, inside: 0, surface: 'gravel' },
    { t: 11.0, type: 'release', char: 'ada' },
    // SMOOTH-FIX (#145, hunt F2a): the incoming shot's exposure on each metered cut (`cutE`, held 0.1 s, then the eye adapts
    // on from it; values = what the eye settles on for that shot, scratch/fix/diag `ex` Medium) — the cut frame used to
    // keep the previous shot's exposure (C6b 6.0 black ×16, 8.5 ×6.7 white). The torch is off from t = 0.
    { t: 6.0, type: 'fx', id: 'exposure', params: { cutE: 1.252 } },
    { t: 8.5, type: 'fx', id: 'exposure', params: { cutE: 0.423 } },
  ];

  return {
    id: 'C6b',
    duration: C6B_DURATION,
    lock: 'full',
    fade: [
      { t: 0, v: 1 },
      { t: 2.0, v: 1 },
      { t: 2.15, v: 0 },
      { t: 10.85, v: 0 },
      { t: 11.0, v: 1 },
    ],
    letterbox: [{ t: 0, v: 1 }],
    shots: [
      { t: 0, d: 2.0, path: [C6B_WIDE_EYE], target: [C6B_WIDE_TARGET], fov: lens(35) },
      // EXT1 macro on the lantern glass, 85 mm
      { t: 2.0, d: 4.0, path: [C6B_LANTERN_EYE, add(C6B_LANTERN_EYE, [0.01, 0.015, -0.005])], target: [lantern], fov: lens(85), ease: 'linear', handheld: 0.3 },
      // wide, low, 35 mm
      { t: 6.0, d: 2.5, path: [C6B_WIDE_EYE], target: [C6B_WIDE_TARGET], fov: lens(35), handheld: 0.2 },
      // the cleat, 60 mm
      { t: 8.5, d: 4.5, path: [CLEAT_EYE, add(CLEAT_EYE, [-0.01, -0.01, 0])], target: [cleat], fov: lens(60), ease: 'linear', handheld: 0.25 },
    ],
    cues,
  };
};
