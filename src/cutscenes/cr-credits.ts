// CR 'Credits' (~24 s, M-A) — docs/CUTSCENES-PLAN.md §9. Chained after C7's title and its single bell (host.ts
// POSTROLL C7 → CR); the story ends the game (end card → title) on C7's done, which fires after CR. Skippable at any
// time (skipAnytime). Picture: black, then a locked-off 50 mm shot of the house from the gate in rain at night with the
// ROOMS lantern relit (the C6b/C7 'sting' state), held at ~40 % brightness under the text (the black overlay at 0.6);
// Low keeps the whole roll on black. Sound: the rain bed and the blue-hour pad fading out; one distant bell under the
// last line. Every role credits Raj Vardhan Singh (CLAUDE.md "Credits"; no tool credits — the open-source notices
// stay in docs/CREDITS.md).

import { lens } from './stage.ts';
import type { Cue, P3, TimelineFactory } from './types.ts';

export const CR_DURATION = 24;
/** The roll's one pass, bottom of the frame → off the top (bindings.ts setRoll). */
export const CREDITS_ROLL_S = 17;
const ROLL_T = 2.2;
const LAST_T = ROLL_T + CREDITS_ROLL_S + 0.9; // "Made from scratch." after a beat

export const CREDITS_NAME = 'Raj Vardhan Singh';
const ROLES = [
  'Game design', 'Story and dialogue', 'Art direction', 'House, props and characters', 'Lighting and materials',
  'Animation and cutscenes', 'Sound design and music', 'Voice design', 'Programming',
];

/** The roll (CardStyle 'roll' markup: '# ' title, '~ ' byline, '> ' role, '' spacer). */
export const CREDITS_TEXT = [
  '# THE KEEPING',
  `~ a game by ${CREDITS_NAME}`,
  '',
  '> Written and directed by',
  CREDITS_NAME,
  '',
  ...ROLES.map((r) => `> ${r}`),
  CREDITS_NAME,
  '',
  `© ${CREDITS_NAME}. All rights reserved.`,
].join('\n');
export const CREDITS_LAST = 'Made from scratch.';

/** Across County Road 9 from the gate (38 m from the facade): the relit ROOMS lantern 7° left of centre, the house 7°
 *  right of it up the rise (50 mm, locked off). */
export const CR_EYE: P3 = [-0.2, -38.0, 1.6];
export const CR_TARGET: P3 = [-1.5, 0, 3.0];

export const crCredits: TimelineFactory = (ctx) => {
  const low = ctx.tier === 'low';
  const cues: Cue[] = [
    { t: 0, type: 'lock', mode: 'full' },
    { t: 0, type: 'light', op: 'storm_auto', on: false },
    { t: 0, type: 'visible', char: 'arms', visible: false },
    { t: 0, type: 'visible', char: 'ada', visible: false },
    // the night after the sting: rain, the lantern relit (C6b/C7 state kept)
    { t: 0, type: 'fx', id: 'blue_hour', params: { mist: 0, rain: 1 } },
    { t: 0, type: 'light', op: 'set', id: 'L_LANTERN', scale: 1 },
    { t: 0, type: 'weather', rain: 1, wind: 0.5, inside: 0, surface: 'gravel' },
    { t: 0, type: 'score', state: 'blue_hour' },
    { t: 0, type: 'dof', dof: null },
    { t: ROLL_T, type: 'card', text: CREDITS_TEXT, style: 'roll' },
    // the storm moving off: two far strokes (the game's own lightning, sky-coloured through the rain) show the house
    { t: 7.4, type: 'light', op: 'lightning', strength: 0.45 },
    { t: 13.8, type: 'light', op: 'lightning', strength: 0.3 },
    // the rain bed and the pad thin out under the last of the roll
    { t: 15.5, type: 'weather', rain: 0.6, wind: 0.35, inside: 0, surface: 'gravel' },
    { t: 18.5, type: 'score', state: 'none' },
    { t: 19.5, type: 'weather', rain: 0.3, wind: 0.2, inside: 0, surface: 'gravel' },
    // the last line, after a beat; one distant bell under it (the clean 1976 timbre, far up the rise)
    { t: LAST_T, type: 'card', text: CREDITS_LAST, style: 'small' },
    { t: LAST_T + 0.4, type: 'sfx', id: 'spring_bell', gain: 0.22, rate: 1.1 },
    { t: CR_DURATION - 0.6, type: 'card', text: null, style: 'small' },
    { t: CR_DURATION - 0.6, type: 'weather', rain: 0, wind: 0.1, inside: 0, surface: 'gravel' },
  ];
  return {
    id: 'CR',
    duration: CR_DURATION,
    lock: 'full',
    skipAnytime: true,
    // black → ~40 % picture under the text → black for the last line (Low: black throughout)
    fade: low
      ? [{ t: 0, v: 1 }]
      : [
          { t: 0, v: 1 },
          { t: 1.2, v: 1 },
          { t: 4.2, v: 0.55 },
          { t: 17.5, v: 0.55 },
          { t: 19.8, v: 1 },
        ],
    letterbox: [{ t: 0, v: 1 }],
    shots: [{ t: 0, d: CR_DURATION, path: [CR_EYE], target: [CR_TARGET], fov: lens(50) }],
    cues,
  };
};
