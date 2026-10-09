// Every AI number in one place (docs/DESIGN.md "Chaser AI"). Tune here; tests read the same table.

export const TUNING = {
  speed: {
    patrol: 0.9,
    investigate: 1.4,
    /** CHASE: jerky bursts at 3.0 m/s with a short lull between (player run 3.6 always gains on straights).
     *  Difficulty tuning 2026-10-08 (was 3.2 / 1.6): a walking-pace start lets a player who runs at once escape. */
    chase: 3.0,
    chaseLull: 1.4,
    chaseBurstS: 1.1,
    chaseLullS: 0.3,
    lureTravel: 1.4,
    scripted: 1.1,
    finale: 0.8,
  },
  /** Design noise radii at the source (m) — the emitters own the real values; these document the contract. */
  noise: { crouch: 1.5, runner: 2, bare: 4, creaker: 7, run: 10, panting: 2.5, doorSlow: 3, doorFast: 8, pry: 14, gasp: 3 },
  /** Post-sprint panting: after ≥ panting.minRunS of running, a 2.5 m noise for 4 s (even inside a hide). */
  panting: { radius: 2.5, durationS: 4, minRunS: 1.2, periodS: 0.5 },
  /** Difficulty 2026-10-08: windup 1.2 → 1.8 s (the head-lift tell is a real warning), fast 0.6 → 1.0 (only for the
   *  beam on her body within fastBeamM — a torch swept over her from across the room is a normal LOOK), assist 1.6 → 2.4.
   *  windupHide: slat looks at a hide keep 1.2 s so windup + sight (3 s) fits a calm breath hold (gasp after 4.5 s). */
  look: { windup: 1.8, windupFast: 1.0, windupAssist: 2.4, windupHide: 1.2, sight: 3, lower: 0.5, fastBeamM: 4 },
  /** LISTEN freeze per escalation level (her listening stops shorten as she learns). */
  listenS: [1.0, 0.8, 0.6],
  /** Difficulty 2026-10-08: lit 14 → 8 m (torch on is ordinary play), dark 5 → 4 m. noticeS: she must keep you in
   *  sight this long before a CHASE (a glance across her cone is a near miss); within closeM it is instant. */
  sight: { halfAngleDeg: 30, lit: 8, dark: 4, darkCrouched: 2, eyeHeight: 1.5, noticeS: 0.6, closeM: 2.5, chaseM: 5 }, // chaseM (round E careless gate): a first sighting farther than this → she comes to look (INVESTIGATE), not a chase
  light: { beamInvestigate: 6, flameLit: 1.5, bodyRadius: 0.35, chestHeight: 1.2, beamInvestigateCooldownS: 2.5, beamRepeatS: 12 }, // beamRepeatS (round E, B11 stall): after a beam LOOK that saw nothing, a beam on her body within this long sends her toward the holder instead of another LOOK in place
  locket: { range: 4 },
  /** Difficulty 2026-10-08: lostS 4 → 2.5, catchDist 1 → 0.8 m, and she abandons any chase after giveUpS. */
  chase: { lostS: 2.5, catchDist: 0.8, runNoiseMin: 5, giveUpS: 10 },
  bumpDist: 0.55,
  /** An investigate stimulus closer than this to the current one keeps her route (no re-plan). */
  stimulusReplanM: 1.0,
  /** bedS = the ada_search_bed one-shot (4.0 s) when she searches beside Harlan's bed; bedReach = her feet to its edge. */
  search: { looks: 2, betweenLooksS: 2, hideListen: [4, 6] as const, bedS: 4, bedReach: 1.0 },
  lure: { durations: [60, 50, 40] as const, floor: 40 },
  vigil: [[15, 30], [12, 24], [10, 18]] as const,
  /** Probability of a LOOK at optional look nodes (doorways) per escalation level; stair top & window always look. */
  lookChance: [0.4, 0.65, 0.9],
  /** Probability a patrol lap goes THROUGH Harlan's room instead of glancing in, per escalation level. */
  throughU2Chance: [0.25, 0.4, 0.55],
  /** Post-death grace (difficulty 2026-10-08: patrol-only 8 → 10 s, hearing window 20 → 30 s). calmS: after ANY
   *  cutscene ends she perceives nothing (no sight / hearing / beam / contact) for this long. */
  /*  awayS/awayM (round E ruling b, respawn fairness): for awayS after a death every routine leg keeps awayM from the
   *  player (dark sight 4 m + 0.5 m margin), or she holds; an idle player must survive ≥ 60 s at every checkpoint. */
  grace: { patrolOnlyS: 10, hearingS: 30, hearingMul: 0.7, calmS: 6, awayS: 75, awayM: 4.5 },
  assist: { speedMul: 0.85, noiseMul: 0.8 },
  hide: { seenWindowS: 2, audibleDist: 2, breathRadius: 1.2 },
  door: { openS: 1.2, openChaseS: 0.5 },
  gurgle: { dist: 5, cooldownS: 10 },
  b04: { minGap: 2, maxGap: 4, stillS: 2, stillSpeed: 0.25, crumbS: 0.2, maxSpeed: 4.2, startGraceS: 3 }, // gameplay review: grace 1.5 → 3 s — C2 releases the player 1.5 m from her (C2_END_EYE vs C2_ADA_END); a first-timer frozen by the reveal was grabbed ~4 s after control returned, now ~5.5 s
  finale: { armLength: 0.9, lookS: 2.5, waitDist: 3.6, lostS: 4 },
  dress: { hemS: 3.5 },
  hideDemo: { listenS: 2.5 },
  /** Thunder mask fallback when a `thunder` event carries no timing (AUDIO.md contract: +1.5 s, 2.5 s long). */
  thunder: { delayMs: 1500, durationMs: 2500 },
  voice: { vigilLongS: 20 },
} as const;

export type Tuning = typeof TUNING;
