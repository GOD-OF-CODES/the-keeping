// Cutscene data model (pure: no three.js, no DOM). A Timeline is DATA: camera shots, continuous tracks (vehicle,
// character moves, fade, letterbox) and discrete cues. src/cutscenes/sequencer.ts plays it on the game-loop dt;
// src/cutscenes/host.ts maps what it emits onto the injected world/characters/audio/UI interfaces.
//
// Positions are PLAN tuples (metres, Z-up, x = east, y = north — src/shared/coords.ts). Headings are radians CCW from
// +x (east), like the layout's `yaw`. Camera `target` is a look-at point. Times are seconds on the cutscene clock.

export type P3 = [number, number, number];

/** Characters a cutscene can drive. `arms` = the first-person arms rig (root = camera). */
export type CharId = 'ada' | 'harlan' | 'arms';

export type Ease = 'linear' | 'in' | 'out' | 'inOut' | 'hold';

/** full = no player input (camera owned by the cutscene); look = mouse-look only; none = normal control. */
export type LockMode = 'full' | 'look' | 'none';

/** A camera shot, active on [t, t + d). Between shots with no coverage the camera belongs to the player. */
export interface CameraShot {
  t: number;
  d: number;
  /** 'plan' (default) or 'car': x = right, y = forward, z = up relative to the vehicle track's pose. */
  space?: 'plan' | 'car';
  /** Eye positions: 1 point = locked-off, 2+ = centripetal Catmull-Rom (three's CatmullRomCurve3), arc-length. */
  path: P3[];
  /** Look-at points (same rules). */
  target: P3[];
  /** Vertical FOV in degrees, constant or [from, to]. */
  fov: number | [number, number];
  /** Easing of the progress along path / target / fov / roll (default inOut for moves). */
  ease?: Ease;
  /** Handheld amplitude (1 ≈ ±0.5° breathing drift). 0 / omitted = tripod. */
  handheld?: number;
  /** Camera roll (radians), constant or [from, to]. */
  roll?: number | [number, number];
}

/** The car (C1, C6, C7): its pose moves along a path; 'car'-space shots ride it. */
export interface VehicleTrack {
  t: number;
  d: number;
  path: P3[];
  ease?: Ease;
  /** Heading: fixed, or 'path' (tangent of the path). */
  heading?: number | 'path';
}

/** A character root moving along a path (feet, PLAN) — clips are in place; this is the root motion. */
export interface MoveTrack {
  char: CharId;
  t: number;
  d: number;
  path: P3[];
  ease?: Ease;
  /** Fixed heading, [from, to], or 'path' (face along the path). */
  heading?: number | [number, number] | 'path';
}

/** Scalar keys (linear between keys, held outside). fade: 0 = clear, 1 = black. letterbox: 0 = off, 1 = 2.39:1 bars. */
export interface Key {
  t: number;
  v: number;
}

export interface DofSettings {
  /** Focus distance (m), focal length (m, the in-focus band), bokeh scale — pipeline.setCutscene({ dof }). */
  focusDistance: number;
  focalLength: number;
  bokehScale: number;
}

export type DoorAction = 'rope_open' | 'rope_close' | 'slam' | 'open' | 'open_fast' | 'close' | 'lock' | 'unlock';

export type LightOp =
  /** Strike lightning now (flash + thunder, via the game's lightning). */
  | { op: 'lightning'; strength?: number }
  /** The storm's own random strikes on/off (off during authored flashes, restored at the end). */
  | { op: 'storm_auto'; on: boolean }
  /** A layout light (L_*) scaled (1 = baked level, 0 = out). */
  | { op: 'set'; id: string; scale: number; fadeS?: number }
  /** A flame gutters out over d seconds (flicker harder, then out). */
  | { op: 'gutter'; id: string; d: number }
  /** A candle casts real shadows while a cutscene needs the shadow-play (parlor cutscenes only). */
  | { op: 'cast_shadow'; id: string; on: boolean }
  /** The player's flashlight. */
  | { op: 'flashlight'; on: boolean; tremble?: number }
  /** Runtime lights the world leaves to cutscenes: headlights / dashboard (L_HEADLIGHT_L/R, L_DASH). */
  | { op: 'runtime'; id: string; on: boolean; scale?: number };

/** Discrete cues. `t` is the cutscene time the cue fires at (fires once, in authoring order among equal times). */
export type Cue =
  | { t: number; type: 'clip'; char: CharId; clip: string; loop?: boolean; fade?: number; speed?: number; fallback?: string[] }
  | { t: number; type: 'place'; char: CharId; pos: P3; heading: number }
  | { t: number; type: 'visible'; char: CharId; visible: boolean }
  /** Hand a character back to gameplay (Ada: the AI's output drives her again). */
  | { t: number; type: 'release'; char: CharId }
  | { t: number; type: 'attach'; char: CharId; prop: string; bone: string | null }
  | { t: number; type: 'sfx'; id: string; pos?: P3; room?: string; gain?: number; rate?: number }
  | { t: number; type: 'loop'; key: string; id: string | null; gain?: number; fade?: number }
  /** A voice-script TRIGGER (src/shared/voice-script.json `trigger`), resolved to line ids by the host. */
  | { t: number; type: 'voice'; trigger: string }
  | { t: number; type: 'subtitle'; speaker: string; text: string; d: number; caption?: boolean }
  /** Full-screen text card (title) or null to clear. */
  | { t: number; type: 'card'; text: string | null; style?: 'title' | 'small' }
  | ({ t: number; type: 'light' } & LightOp)
  | { t: number; type: 'door'; id: string; action: DoorAction }
  | { t: number; type: 'prop'; id: string; visible: boolean }
  /** Swap set dressing (C7: guest book HARLAN, fresh tallies, the sack, Ada in the rocker …). */
  | { t: number; type: 'dressing'; set: string; on: boolean }
  /** Named visual effect hooks the world/render lanes implement (rain on the windshield, wipers, fuel needle …). */
  | { t: number; type: 'fx'; id: string; params?: Record<string, number | string | boolean> }
  | { t: number; type: 'score'; state: 'drone' | 'chase' | 'blue_hour' | 'none'; stinger?: string }
  | { t: number; type: 'weather'; rain: number; wind: number; inside: number; surface?: 'roof' | 'glass' | 'porch' | 'car' | 'gravel' }
  | { t: number; type: 'heartbeat'; bpm: number }
  | { t: number; type: 'dof'; dof: DofSettings | null }
  | { t: number; type: 'lock'; mode: LockMode }
  /** Put the player (body + look) where gameplay resumes. pos = EYE (PLAN), heading/pitch radians. */
  | { t: number; type: 'player'; pos: P3; heading: number; pitch?: number }
  /** Hold the clock here until the host resolves it (hold-E pour, key turn, breath hold) or `timeout` passes. */
  | { t: number; type: 'gate'; id: string; prompt?: string; timeout?: number }
  /** Anything else (tests / debug / future hooks). */
  | { t: number; type: 'mark'; name: string };

export type CueType = Cue['type'];

/**
 * State-bearing cues: on skip they are still applied (in time order) so the world ends in the same state as a full
 * playback. Everything else (sounds, loops — the host stops a cutscene's loops at its end anyway —, voices,
 * subtitles, cards, lightning strikes, gates, marks) is dropped.
 */
export const STATE_CUES: ReadonlySet<CueType> = new Set<CueType>([
  'clip', 'place', 'visible', 'release', 'attach', 'door', 'prop', 'dressing', 'fx', 'score', 'weather',
  'heartbeat', 'dof', 'lock', 'player',
]);

export function isStateCue(c: Cue): boolean {
  if (c.type === 'light') return c.op !== 'lightning';
  return STATE_CUES.has(c.type);
}

export interface Timeline {
  id: string;
  /** Seconds (the clock may wait longer at gates). */
  duration: number;
  /** Input lock for the whole cutscene (a `lock` cue can change it mid-way). */
  lock: LockMode;
  /** false = never skippable (death). Default true = skippable once this id has been seen. */
  skippable?: boolean;
  /** Seed for the handheld noise (default: hash of the id). */
  seed?: number;
  shots?: CameraShot[];
  vehicle?: VehicleTrack[];
  moves?: MoveTrack[];
  fade?: Key[];
  letterbox?: Key[];
  cues: Cue[];
}

/** Evaluated camera for one frame (PLAN). `shake` = extra [yaw, pitch, roll] radians applied after lookAt. */
export interface CameraPose {
  pos: P3;
  target: P3;
  fov: number;
  roll: number;
  shake: [number, number, number];
}

export interface VehiclePose {
  pos: P3;
  heading: number;
}

/** What a timeline factory may read (snapshot at start). */
export interface CutsceneContext {
  /** Player eye (PLAN), heading, pitch at the moment the cutscene starts. */
  player: { eye: P3; heading: number; pitch: number; /** gameplay FOV (settings.fovDeg) — end shots ease to it */ fov?: number };
  /** Ada's root + heading if known (death cutaway stages her grab from where she is). */
  ada: { pos: P3; heading: number } | null;
  flags: ReadonlyMap<string, boolean>;
  /** true once this id has been completed or skipped before (replays can be shorter). */
  seen: boolean;
}

export type TimelineFactory = (c: CutsceneContext) => Timeline;
