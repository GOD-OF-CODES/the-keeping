// Cutscene data model (pure: no three.js, no DOM). A Timeline is DATA: camera shots, continuous tracks (vehicle,
// character moves, fade, letterbox) and discrete cues. src/cutscenes/sequencer.ts plays it on the game-loop dt;
// src/cutscenes/host.ts maps what it emits onto the injected world/characters/audio/UI interfaces.
//
// Positions are PLAN tuples (metres, Z-up, x = east, y = north — src/shared/coords.ts). Headings are radians CCW from
// +x (east), like the layout's `yaw`. Camera `target` is a look-at point. Times are seconds on the cutscene clock.

export type P3 = [number, number, number];

/** Characters a cutscene can drive. `arms` = the first-person arms rig (root = camera). */
export type CharId = 'ada' | 'harlan' | 'arms';

/** 'decel' (SMOOTH-FRAMES #142): constant deceleration to rest, 1 − (1 − u)² — a car coasting/braking to a stop starts at
 *  2× its mean speed (the cubic 'out' starts at 3×: C1's coast arrived at 27 m/s after a 19 m/s run). */
export type Ease = 'linear' | 'in' | 'out' | 'inOut' | 'hold' | 'decel';

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
  /** C2-ESCAPE B8: a step-locked head bob (POV runs): eye + target drop by (amp/2)·sin 2π·hz·τ (m; the foot plants at (k + ¼)/hz), and the head
   *  rolls ±roll (rad) at half the step rate (it alternates with the stride). τ = time since the shot start. Both are 0
   *  at τ = 0 and, when hz·d is a whole number of steps, at the shot's end (SMOOTH-FRAMES #142: was
   *  amp·(1 − cos 2π·hz·τ)/2 − amp/2, i.e. −amp/2 on the first frame — a drop at every bobbing shot's start). */
  bob?: { amp: number; hz: number; roll?: number };
  /** SMOOTH-FIX (#145, hunt F4): a plan-space shot that PANS WITH the vehicle track: the look keeps the authored pitch
   *  and distance, but its yaw = the bearing (from the eye) of `at` (a car-space point, default the car's nose) plus an
   *  offset that moves from the authored start target's offset to the authored end target's with the car's progress
   *  across the view (its bearing; the shot's ease if it does not cross). The
   *  first and last frames are exactly the authored ones; in between the car never slips out of the frame. */
  track?: { at?: P3 };
}

/** C2-ESCAPE B8: a camera impulse (the flinch at `head_drop`, the heartbeat jolts): a half-sine of d seconds added to
 *  the shake (radians). */
export interface CameraKick {
  t: number;
  d: number;
  pitch?: number;
  yaw?: number;
  roll?: number;
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
  /** GLITCH-FIX (optional; CONTRACT-CHANGES #139): turn into this move's heading from the character's previous heading in
   *  this timeline (the end of its last earlier move, else its last `place` cue) over `turnIn` s (smoothstep) —
   *  a body turning as it steps off, instead of snapping its root yaw on the move's first frame. */
  turnIn?: number;
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

/** The `grade` cue's look (all optional; omitted = identity). */
export interface GradeSpec {
  tint?: [number, number, number];
  saturation?: number;
  grain?: number;
  vignette?: number;
  fade?: number;
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

/** Title cards (DOM, system serif): 'date' = small, centred low (C0 shot 0); 'byline' = the smaller second line
 *  under a 'title' card ("a game by Raj Vardhan Singh"); text null on 'byline' clears only the byline. */
/** 'roll' (M-A, CR end credits): the text rolls up the screen once over CREDITS_ROLL_S (bindings.ts); lines are
 *  '\n'-separated, '# ' = the title line, '~ ' = an italic byline, '> ' = a role (small caps), '' = a spacer. */
export type CardStyle = 'title' | 'small' | 'date' | 'byline' | 'roll';

/** Discrete cues. `t` is the cutscene time the cue fires at (fires once, in authoring order among equal times). */
export type Cue =
  /** `at` (M-A, CUTSCENES-PLAN §6 runtime 1): start this far into the clip (s; > duration holds the last frame);
   *  `speed` 0 holds that frame (a freeze-frame pose). Ada / Harlan honour both; the arms play from 0 at speed 1. */
  | { t: number; type: 'clip'; char: CharId; clip: string; loop?: boolean; fade?: number; speed?: number; at?: number; fallback?: string[] }
  | { t: number; type: 'place'; char: CharId; pos: P3; heading: number }
  | { t: number; type: 'visible'; char: CharId; visible: boolean }
  /** Hand a character back to gameplay (Ada: the AI's output drives her again). */
  | { t: number; type: 'release'; char: CharId }
  | { t: number; type: 'attach'; char: CharId; prop: string; bone: string | null }
  /** `sched` (K12, C2-ESCAPE B12): handed to the AudioContext clock 150 ms ahead so it lands on the cue's frame. */
  | { t: number; type: 'sfx'; id: string; pos?: P3; room?: string; gain?: number; rate?: number; sched?: boolean }
  | { t: number; type: 'loop'; key: string; id: string | null; gain?: number; fade?: number }
  /** A voice-script TRIGGER (src/shared/voice-script.json `trigger`), resolved to line ids by the host. */
  | { t: number; type: 'voice'; trigger: string }
  | { t: number; type: 'subtitle'; speaker: string; text: string; d: number; caption?: boolean }
  /** Full-screen text card (title) or null to clear. */
  | { t: number; type: 'card'; text: string | null; style?: CardStyle }
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
  /** `to` + `over` (M-A focus pull): the focus distance eases (inOut) from dof.focusDistance to `to` metres over
   *  `over` seconds; only the DOF uniforms change (no chain rebuild). A skip lands on `to`. */
  | { t: number; type: 'dof'; dof: DofSettings | null; to?: number; over?: number }
  /** M-A (CUTSCENES-PLAN §5 memory look): the pipeline grade, eased over `over` s (default 0 = cut). Multipliers on the
   *  gameplay look: tint (rgb), saturation, grain, vignette; `fade` 0..1 = extra black over the frame. null = reset. */
  | { t: number; type: 'grade'; grade: GradeSpec | null; over?: number }
  /** M-A (§5): every baked lightmap's intensity × scale (1 = as baked, i.e. × π irradiance), eased over `over` s. */
  | { t: number; type: 'lmScale'; scale: number; over?: number }
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
  'heartbeat', 'dof', 'lock', 'player', 'grade', 'lmScale',
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
  /** M-A (CR end credits): skippable from the first view (the roll after the sting). */
  skipAnytime?: boolean;
  /** Seed for the handheld noise (default: hash of the id). */
  seed?: number;
  shots?: CameraShot[];
  vehicle?: VehicleTrack[];
  moves?: MoveTrack[];
  fade?: Key[];
  letterbox?: Key[];
  kicks?: CameraKick[];
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
  player: { eye: P3; heading: number; pitch: number; /** gameplay FOV (settings.fovDeg) — end shots ease to it */ fov?: number; /** SMOOTH-FRAMES (#142): the torch is on (cutscenes that switch it off for shots away from the eye give it back as it was) */ torch?: boolean };
  /** Ada's root + heading if known (death cutaway stages her grab from where she is). */
  ada: { pos: P3; heading: number } | null;
  flags: ReadonlyMap<string, boolean>;
  /** true once this id has been completed or skipped before (replays can be shorter). */
  seen: boolean;
  /** Started straight after a preroll cutscene (C0 → C1): no fade-in, the cut is matched (C1-OPENING §3 shot 4). */
  chained?: boolean;
  /** C2-ESCAPE B8: the preset has the cutscene motion-blur variant (else: the clip smear and slower whips). */
  motionBlur?: boolean;
  /** M-A: the graphics preset id ('low' | 'medium' | 'max'): CR keeps Low on black (CUTSCENES-PLAN §9). */
  tier?: string;
}

export type TimelineFactory = (c: CutsceneContext) => Timeline;
