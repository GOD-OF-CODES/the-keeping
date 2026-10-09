// Escape-state: the story's persistent, JSON-serialisable state (beats, flags, counters). PURE.
// Flags are the shared vocabulary with the world lane (doors' unlockFlag, inventory `has_<item>`, boards).

export const BEATS = ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10', 'B11', 'B12', 'B13'] as const;
export type BeatId = (typeof BEATS)[number];

export const CHECKPOINTS = ['CP1', 'CP2', 'CP3', 'CP4', 'CP5', 'CP6', 'CP7', 'CP8'] as const;
export type CheckpointId = (typeof CHECKPOINTS)[number];

export const beatIndex = (b: BeatId): number => BEATS.indexOf(b);

/** Every story flag (name → meaning). Doors: passage_unbolted, ada_boards_pried, dress_visit_done (layout unlockFlag). */
export const FLAGS = {
  knocked: 'B02: knocked at the front door',
  rang_front_bell: 'B02: pulled the front bell knob',
  front_door_open: 'the rope holds the front door open (B02, after C5)',
  parlor_locked: 'C2: the parlor door is shut and key-locked',
  ada_severed: 'C2: Harlan beheaded her (the strike); from here on she is headless and carries her head',
  cs_C2c_done: 'C2c (Up) is over: control at the stair top (B05)',
  first_hide_done: 'B05: the unfailable slat look is over',
  ledger_read: 'read at least one ledger page',
  has_hammer: 'inventory: claw hammer (world sets it)',
  has_shears: 'inventory: sewing shears (world sets it)',
  has_locket: 'inventory: the locket (world sets it; cleared when she takes it)',
  has_ticket: 'inventory: bus ticket',
  has_can: 'inventory: full jerry can (world sets it)',
  c3_done: 'B07: He Looks Up played',
  bell_used: 'pulled the bedroom bell pull at least once',
  ada_board_1: 'board 1 pried (world sets it)',
  ada_board_2: 'board 2 pried (world sets it)',
  ada_board_3: 'board 3 pried (world sets it)',
  ada_boards_pried: "all three boards off: Ada's door opens (world sets it)",
  letter_read: "read Ada's letter",
  hem_cut: 'cut the hem: locket + ticket drop',
  dress_visit_done: "C4 dress visit over: the wardrobe's loose back gives",
  bell_nonstop: 'B10: the parlor bell rings nonstop',
  passage_unbolted: 'B10: back-passage bolt slid from the kitchen side',
  finale_started: 'she sighted the lit locket (FINALE)',
  locket_given: 'she took the locket',
  ada_at_parlor: 'she carried the locket to the parlor door',
  harlan_taken: 'C5 played',
  game_over: 'C7 finished',
} as const;
export type FlagName = keyof typeof FLAGS;

export interface Timer {
  id: string;
  t: number;
}

export interface EscapeState {
  v: 1;
  time: number;
  beat: BeatId;
  checkpoint: CheckpointId | null;
  flags: Record<string, boolean>;
  docsRead: string[];
  ledgerPages: number;
  bellPulls: number;
  failedPries: number;
  deathsTotal: number;
  /** Deaths per section (the checkpoint you respawn at). */
  deathsAt: Record<string, number>;
  finaleDeaths: number;
  /** A death cutaway is playing. */
  dead: boolean;
  /** The cutscene the story is waiting on (null = none). */
  cutscene: string | null;
  cutscenesSeen: string[];
  /** Seconds without progress (hint at 90 s). */
  stuckT: number;
  hintsGiven: number;
  timers: Timer[];
  once: string[];
  lastDistractionT: number;
  lastThunderAssistT: number;
  finalePromptShown: boolean;
  /** C2-ESCAPE K8 `c2_strike_time`: story time of the C2 strike (blood decals/pools age from it); null = before C2. */
  c2StrikeTime?: number | null;
}

export function newEscapeState(): EscapeState {
  return {
    v: 1,
    time: 0,
    beat: 'B01',
    checkpoint: null,
    flags: {},
    docsRead: [],
    ledgerPages: 0,
    bellPulls: 0,
    failedPries: 0,
    deathsTotal: 0,
    deathsAt: {},
    finaleDeaths: 0,
    dead: false,
    cutscene: null,
    cutscenesSeen: [],
    stuckT: 0,
    hintsGiven: 0,
    timers: [],
    once: [],
    lastDistractionT: -1e9,
    lastThunderAssistT: -1e9,
    finalePromptShown: false,
    c2StrikeTime: null,
  };
}

export function cloneState(s: EscapeState): EscapeState {
  return JSON.parse(JSON.stringify(s)) as EscapeState;
}

export function flag(s: EscapeState, name: string): boolean {
  return s.flags[name] === true;
}

export function boardsPried(s: EscapeState): number {
  return [1, 2, 3].filter((k) => flag(s, `ada_board_${k}`)).length;
}
