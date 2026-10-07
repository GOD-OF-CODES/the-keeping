// Every AI number in one place (docs/DESIGN.md "Chaser AI"). Tune here; tests read the same table.

export const TUNING = {
  speed: {
    patrol: 0.9,
    investigate: 1.4,
    /** CHASE: jerky bursts at 3.2 m/s with a short lull between (player run 3.6 always gains on straights). */
    chase: 3.2,
    chaseLull: 1.6,
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
  look: { windup: 1.2, windupFast: 0.6, windupAssist: 1.6, sight: 3, lower: 0.5 },
  /** LISTEN freeze per escalation level (her listening stops shorten as she learns). */
  listenS: [1.0, 0.8, 0.6],
  sight: { halfAngleDeg: 30, lit: 14, dark: 5, darkCrouched: 2, eyeHeight: 1.5 },
  light: { beamInvestigate: 6, flameLit: 1.5, bodyRadius: 0.35, chestHeight: 1.2, beamInvestigateCooldownS: 2.5 },
  locket: { range: 4 },
  chase: { lostS: 4, catchDist: 1, runNoiseMin: 5 },
  bumpDist: 0.55,
  /** bedS = the ada_search_bed one-shot (4.0 s) when she searches beside Harlan's bed; bedReach = her feet to its edge. */
  search: { looks: 2, betweenLooksS: 2, hideListen: [4, 6] as const, bedS: 4, bedReach: 1.0 },
  lure: { durations: [60, 50, 40] as const, floor: 40 },
  vigil: [[15, 30], [12, 24], [10, 18]] as const,
  /** Probability of a LOOK at optional look nodes (doorways) per escalation level; stair top & window always look. */
  lookChance: [0.4, 0.65, 0.9],
  /** Probability a patrol lap goes THROUGH Harlan's room instead of glancing in, per escalation level. */
  throughU2Chance: [0.25, 0.4, 0.55],
  grace: { patrolOnlyS: 8, hearingS: 20, hearingMul: 0.7 },
  assist: { speedMul: 0.85, noiseMul: 0.8 },
  hide: { seenWindowS: 2, audibleDist: 2, breathRadius: 1.2 },
  door: { openS: 1.2, openChaseS: 0.5 },
  gurgle: { dist: 5, cooldownS: 10 },
  b04: { minGap: 2, maxGap: 4, stillS: 2, stillSpeed: 0.25, crumbS: 0.2, maxSpeed: 4.2, startGraceS: 1.5 },
  finale: { armLength: 0.9, lookS: 2.5, waitDist: 3.6, lostS: 4 },
  dress: { hemS: 3.5 },
  hideDemo: { listenS: 2.5 },
  /** Thunder mask fallback when a `thunder` event carries no timing (AUDIO.md contract: +1.5 s, 2.5 s long). */
  thunder: { delayMs: 1500, durationMs: 2500 },
  voice: { vigilLongS: 20 },
} as const;

export type Tuning = typeof TUNING;
