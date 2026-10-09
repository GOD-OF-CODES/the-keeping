// The cutscene library: id → timeline factory. Ids match src/story/beats.ts CutsceneId (C1, C2, C2c, C3, C5,
// C6, C7, death) plus 'C4' (preview-only linear dress visit; in game C4 is the HemOverlay in c4-hem.ts).
// Pure data + factories (no three.js): safe for node tests.

import { c0Road } from './c0-road.ts';
import { c1Empty } from './c1-empty.ts';
import { c2Room } from './c2-room.ts';
import { c2cUp } from './c2c-up.ts';
import { c3LooksUp } from './c3-looks-up.ts';
import { c4Hem } from './c4-hem.ts';
import { c5Face } from './c5-face.ts';
import { c6BlueHour } from './c6-blue-hour.ts';
import { c7Keeping } from './c7-keeping.ts';
import { deathCutaway } from './death.ts';
import type { TimelineFactory } from './types.ts';

export const CUTSCENES: Record<string, TimelineFactory> = {
  C0: c0Road, // C1's preroll (host.ts PREROLL), never requested by the Director
  C1: c1Empty,
  C2: c2Room,
  C2c: c2cUp, // chained after C2 by host.ts POSTROLL (the Director requests only C2)
  C3: c3LooksUp,
  C4: c4Hem,
  C5: c5Face,
  C6: c6BlueHour,
  C7: c7Keeping,
  death: deathCutaway,
};

/** The ids the story Director requests (src/story/beats.ts CutsceneId). */
export const DIRECTOR_CUTSCENES = ['C1', 'C2', 'C2c', 'C3', 'C5', 'C6', 'C7', 'death'] as const;

/** Clip names that exist in public/assets/<tier>/{ada,harlan,arms}.glb (docs/CHARACTERS.md). */
export const KNOWN_CLIPS: Record<'ada' | 'harlan' | 'arms', readonly string[]> = {
  ada: [
    'ada_table', 'ada_opening', 'ada_rise', 'ada_patrol', 'ada_listen', 'ada_look', 'ada_chase', 'ada_stairs_up', 'ada_stairs_down', 'ada_hide_check', 'ada_hide_tear', 'ada_vigil', 'ada_catch',
    // M2 (2026-09-30)
    'ada_search', 'ada_search_bed', 'ada_door_push', 'ada_dress', 'ada_finale_approach', 'ada_finale_take', 'ada_finale_carry', 'ada_finale', 'ada_finale_shadow', 'ada_sting',
  ],
  harlan: ['harlan_opening', 'harlan_pose_car_push', 'harlan_pose_look_up', 'harlan_pose_stairs_foot', 'harlan_seated', 'harlan_seated_look_up', 'harlan_finale', 'harlan_finale_shadow'],
  arms: [
    'arms_idle', 'arms_flashlight_toggle', 'arms_knock', 'arms_bell_pull', 'arms_door_rattle', 'arms_breath_hold', 'arms_freeze', 'arms_wheel', 'arms_key', 'arms_hide_push',
    'arms_pickup_read', 'arms_pry_board', 'arms_cut_hem', 'arms_raise_locket', 'arms_locket_hold', 'arms_slide_bolt', 'arms_pour_can',
  ],
};

/** Clips referenced by the timelines that the character lane has not built yet (each cue carries a fallback). */
export const PENDING_CLIPS: readonly string[] = [
  // C2-ESCAPE lane A (A4–A6): every cue carries a fallback
  'harlan_c2', 'ada_c2', 'ada_rise_headless', 'ada_chase_headless', 'ada_climb_headless', 'arms_run_torch', 'arms_stumble_catch',
];

/** C2-ESCAPE §2.3 NEW sound ids lane B-STORY synthesises (bindings.ts plays a stand-in or nothing until they exist). */
export const PENDING_SFX: readonly string[] = [
  'cleaver_sever', 'score_hit', 'head_drop', 'head_nudge', 'hair_wring', 'blood_drip', 'arterial_spurt', 'blood_patter', 'stump_breath', 'bare_feet_wet',
  'handrail_squeak', 'newel_knock', 'torch_knock', 'body_fall_stairs',
];

export { CutscenePlayer, localSeenStore, memorySeenStore } from './host.ts';
export type { CharacterDirector, CutsceneDeps, SeenStore } from './host.ts';
export { HemOverlay } from './c4-hem.ts';
