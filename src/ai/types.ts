// Shared AI types. PURE: no three.js, no DOM — positions are PLAN-space tuples (metres, Z-up, x=east, y=north;
// see src/shared/coords.ts). Everything under src/ai runs under `node --experimental-strip-types` in tests.

import type { P3 } from '../shared/layout-types.ts';

export type { P3 };

export const ADA_STATES = ['SCRIPTED', 'VIGIL', 'PATROL', 'LISTEN', 'INVESTIGATE', 'LOOK', 'CHASE', 'SEARCH', 'LURED', 'FINALE', 'CATCH'] as const;
export type AdaState = (typeof ADA_STATES)[number];

/** hanging = blind; lifting = the 1.2 s wind-up (crack at its start); lifted = she sees; lowering = blind again. */
/**
 * C2-ESCAPE K9: after C2 her head is severed and CARRIED. 'hanging' = held by the hair at her hip (blind);
 * 'lifting' / 'lifted' / 'lowering' = raised in both hands to face height, the eye 0.25 m ahead of the stump (sees);
 * 'placed' = set down (blind; its eye is the vision source only in hide_demo at the slats).
 */
export type HeadState = 'hanging' | 'lifting' | 'lifted' | 'lowering' | 'placed';

/** 'open' covers open and ajar; 'locked' = bolted / boarded / key-locked (she cannot pass). */
export type DoorState = 'open' | 'closed' | 'locked';
export type DoorStateFn = (doorId: string) => DoorState;

/** The flashlight as the AI needs it (PLAN space). */
export interface BeamView {
  on: boolean;
  /** Lens position (≈ the player's eye). */
  origin: P3;
  /** Unit direction. */
  dir: P3;
  /** Useful range of the beam (m). */
  range: number;
  /** Half-angle of the cone (radians). */
  halfAngle: number;
  /** Where the beam's centre ray lands (first static hit), or null (nothing within range). */
  hit: P3 | null;
}

/** What the brain samples from the player every tick. The brain only ACTS on it through sense checks (rule 1). */
export interface PlayerView {
  /** Feet position (PLAN). */
  pos: P3;
  /** Eye position (PLAN). */
  eye: P3;
  room: string | null;
  crouched: boolean;
  /** Sprint key held and moving (used for post-sprint panting, 2.5 m for 4 s). */
  running: boolean;
  /** Horizontal speed (m/s). */
  speed: number;
  /** Hide id while inside a hide, else null. */
  hiddenIn: string | null;
  holdingBreath: boolean;
  beam: BeamView;
  /** RMB: the open locket raised into the beam in front of the face. Counts only while the beam is on. */
  locketRaised: boolean;
}

/** World queries the caller supplies (collision raycasts, the camera frustum, door leaves). */
export interface WorldQuery {
  doorState: DoorStateFn;
  /** Unobstructed straight line between two PLAN points (static collision + closed door leaves). */
  lineOfSight(a: P3, b: P3): boolean;
  /** True if the player could currently see a character standing at `p` (frustum + occlusion). Used to never
   *  relocate her in view (rule 11). Return false while the screen is black (death cutaway, cutscene cut). */
  playerCanSee(p: P3): boolean;
}

/** A sound the chaser can hear (mirrors GameEvents['noise']). radius is at the source, before attenuation. */
export interface NoiseInput {
  pos: P3;
  room: string;
  radius: number;
  source: 'player' | 'door' | 'prop' | 'script';
}

/** Tell cues for audio / characters / captions, per tick. */
export interface TellCues {
  /** Drip loop rate (drops/s scale: ≈0.8 still, 1.5 walking, 3 running). Follows her speed. */
  dripRate: number;
  /** She is listening: stop the drip (the LISTEN tell). */
  dripStopped: boolean;
  /** The head-lift tell this tick (C2-ESCAPE K9 `ada_head_lift`, was the bone crack): the LOOK wind-up starts; she will see in `lookWindup` s. */
  crack: boolean;
  /** The carried head knocks against her thigh this tick (`ada_head_knock`; walking/running with the head hanging). */
  knock?: boolean;
  /** Throat gurgle this tick (she came within ~5 m; rate-limited). */
  gurgle: boolean;
  /** Looping foley: scraping wood (vigil / lured), nails on plaster (search). */
  loop: 'scrape_wood' | 'nails_plaster' | null;
  /** Current look wind-up length (s) — for captions ("she will see in…"). */
  lookWindup: number;
}

export type ScriptedMode =
  /** Offstage (B01–B03 before the rise, after C5): not rendered, not simulated. */
  | 'hidden'
  /** Stand at a node, blind, while a cutscene owns her (C2 rise, C5). */
  | 'hold'
  /**
   * B05 (C2-ESCAPE §4.5): her return from the parlor after C2c — offstage ≥ 10 s, the parlor key + door, the hall,
   * 16 risers, holding her head at her hip (blind). Never catches; the first hide turns it into hide_demo.
   */
  | 'b05_return'
  /** B05: the first (unfailable) hide check at the slats, then back to her vigil. */
  | 'hide_demo'
  /** B09 (C4): the dress visit — to the dress, hand on the cut hem, head lifts toward the wardrobe, leaves. */
  | 'dress';

export type CatchCause = 'chase' | 'bump' | 'hide' | 'scripted';

/** Discrete things that happened this tick (the adapter forwards them to the bus / story). */
export type AiEvent =
  | { type: 'state'; from: AdaState; to: AdaState }
  /** A voice-script trigger name, e.g. 'ai:look_lift' (…Harlan?), 'ai:proximity_5m', 'c4:hand_on_hem'. */
  | { type: 'voice'; trigger: string }
  /** She pushes a closed (unlocked) door open, slowly (or fast in a chase). */
  | { type: 'door'; doorId: string; fast: boolean }
  | { type: 'catch'; cause: CatchCause }
  | { type: 'hide_found'; hideId: string }
  /** start → take → at_door; 'lost' = the player slipped away before she reached them (FINALE lapses to SEARCH). */
  | { type: 'finale'; phase: 'start' | 'take' | 'at_door' | 'lost' }
  | { type: 'lured'; phase: 'arrive' | 'end' }
  | { type: 'scripted_done'; mode: ScriptedMode }
  /** b05_return progress (the story turns these into the parlor key, the door, the rocker, the second armoire flash). */
  | { type: 'b05_return'; phase: 'key' | 'door' | 'hall' | 'rocker' | 'climb' | 'blind_wait' | 'top' }
  /** forced = placed under cutscene cover (the in-view guard was skipped). */
  | { type: 'relocated'; node: string; forced: boolean };

export interface AdaOutput {
  /** Displayed state (LISTEN is shown while an investigation/hide check listens). */
  state: AdaState;
  /** Sub-phase for animation/debug, e.g. 'windup', 'sight', 'scrape', 'travel', 'approach'. */
  phase: string;
  /** false = offstage (don't render / don't play her tells). */
  visible: boolean;
  /** Desired root position (feet, PLAN) and velocity (m/s, PLAN). The character lane moves the root to `pos`. */
  pos: P3;
  vel: P3;
  /** Body heading (radians CCW from +x, like the layout). */
  facing: number;
  /** Where the head/eye points while lifted (heading). */
  lookYaw: number;
  head: HeadState;
  /** Animation state name (see ADA_ANIMS). */
  anim: AdaAnim;
  speed: number;
  room: string;
  /** On a stair edge (banister hand, step cadence). */
  onStair: boolean;
  tells: TellCues;
  events: AiEvent[];
}

export const ADA_ANIMS = [
  'hidden',
  'idle',
  'walk',
  'stairs',
  'door_push',
  'listen',
  'look_windup',
  'look_hold',
  'look_lower',
  'chase_run',
  'vigil_scrape',
  'lured_scrape',
  'search_plaster',
  'search_bed',
  'hide_check',
  'hide_tear_open',
  'dress_hem',
  'finale_approach',
  'finale_look',
  'finale_take',
  'finale_carry',
  'catch_grab',
] as const;
export type AdaAnim = (typeof ADA_ANIMS)[number];
