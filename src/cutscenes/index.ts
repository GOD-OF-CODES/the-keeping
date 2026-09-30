// The cutscene library: id → timeline factory. Ids match src/story/beats.ts CutsceneId (C1, C2, C2_replay, C3, C5,
// C6, C7, death) plus 'C4' (preview-only linear dress visit; in game C4 is the HemOverlay in c4-hem.ts).
// Pure data + factories (no three.js): safe for node tests.

import { c1Empty } from './c1-empty.ts';
import { c2Replay, c2Room } from './c2-room.ts';
import { c3LooksUp } from './c3-looks-up.ts';
import { c4Hem } from './c4-hem.ts';
import { c5Face } from './c5-face.ts';
import { c6BlueHour } from './c6-blue-hour.ts';
import { c7Keeping } from './c7-keeping.ts';
import { deathCutaway } from './death.ts';
import type { TimelineFactory } from './types.ts';

export const CUTSCENES: Record<string, TimelineFactory> = {
  C1: c1Empty,
  C2: c2Room,
  C2_replay: c2Replay,
  C3: c3LooksUp,
  C4: c4Hem,
  C5: c5Face,
  C6: c6BlueHour,
  C7: c7Keeping,
  death: deathCutaway,
};

/** The ids the story Director requests (src/story/beats.ts CutsceneId). */
export const DIRECTOR_CUTSCENES = ['C1', 'C2', 'C2_replay', 'C3', 'C5', 'C6', 'C7', 'death'] as const;

/** Clip names that exist in public/assets/<tier>/{ada,harlan,arms}.glb (docs/CHARACTERS.md). */
export const KNOWN_CLIPS: Record<'ada' | 'harlan' | 'arms', readonly string[]> = {
  ada: ['ada_table', 'ada_opening', 'ada_rise', 'ada_patrol', 'ada_listen', 'ada_look', 'ada_chase', 'ada_stairs_up', 'ada_stairs_down', 'ada_hide_check', 'ada_hide_tear', 'ada_vigil', 'ada_catch'],
  harlan: ['harlan_opening', 'harlan_pose_car_push', 'harlan_pose_look_up', 'harlan_pose_stairs_foot', 'harlan_seated', 'harlan_seated_look_up'],
  arms: ['arms_idle', 'arms_flashlight_toggle', 'arms_knock', 'arms_bell_pull', 'arms_door_rattle', 'arms_breath_hold', 'arms_freeze', 'arms_wheel', 'arms_key', 'arms_hide_push'],
};

/** M2 clips referenced by the timelines that the character lane has not built yet (each cue carries a fallback). */
export const PENDING_CLIPS = ['ada_dress', 'ada_finale', 'ada_sting', 'harlan_finale', 'arms_pour_can'] as const;

export { CutscenePlayer, localSeenStore, memorySeenStore } from './host.ts';
export type { CharacterDirector, CutsceneDeps, SeenStore } from './host.ts';
export { HemOverlay } from './c4-hem.ts';
