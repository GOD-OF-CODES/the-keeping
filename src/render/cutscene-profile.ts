// Cutscene render profile (CUTSCENES-PLAN §5, M-A) — PURE (no three.js). While a cutscene owns the screen the scene
// scale is HELD (dynamic resolution paused) at the preset's cutscene scale, and a frame-time guard steps back:
//   - Medium 0.9 / Max 0.85 (controlled views afford more pixels than gameplay); Low unchanged (1.0, no post chain);
//   - guard: frames averaging > 40 ms over 1 s → back to the gameplay scale for the rest of that cutscene (and the
//     cutscene-only volumetric beam off), so a cutscene can never sit below 25 fps;
//   - on release the gameplay dynamic-resolution scale returns.
// Ruling (ad) 2026-10-11: the raise ships only if Medium AND Max hold ≥ 45 fps in every M-A cutscene and C2/C2c;
// CUTSCENE_SCALE is the single switch (null = hold at the gameplay scale, no raise).
// main.ts onRendered drives it (`?csguard=<ms>` adds ms to every measured cutscene frame: QA proves the guard fires).

export type PresetId = 'low' | 'medium' | 'max';

/** Scene scale held during cutscenes (null = hold whatever dynamic resolution had at the cutscene's start). */
// Ruling (ad) decision (M-A infra, round 3–4 real-time runs, docs/STATUS-ma-infra.md): the raise to Medium 0.9 measured
// costless (C2 → C2c 57.6 fps at 0.9 vs 58.2 at the gameplay scale; C4a 60, C4c 57, C6b 59), but "≥ 45 fps in EVERY M-A
// cutscene" is not met — C5b freezes 19–39 s at its first frame and C2b's floor shot runs ≈ 20 fps at ANY scale — so the
// scale stays at the gameplay value (held: no dynamic-resolution hunting inside a cutscene; the guard stays armed).
// Flip medium back to 0.9 once C5b / C2b pass. Max: its gameplay dynres already runs 0.85–1.0, so a hold never lowers it.
export const CUTSCENE_SCALE: Record<PresetId, number | null> = { low: null, medium: null, max: null };
/** The measured, costless raise (re-enable per ruling (ad) when every M-A cutscene holds ≥ 45 fps). */
export const CUTSCENE_SCALE_RAISED: Record<PresetId, number | null> = { low: null, medium: 0.9, max: 0.85 };
/** Guard: average frame time over GUARD_WINDOW_S above this (ms) trips it. */
export const GUARD_MS = 40;
export const GUARD_WINDOW_S = 1;

export class CutsceneProfile {
  active = false;
  /** The guard tripped in the current cutscene (gameplay scale, beam off until the cutscene ends). */
  tripped = false;
  /** Times the guard tripped since load (QA). */
  trips = 0;
  /** The scale the profile asked for while active (null = none / not active). */
  scale: number | null = null;
  private gameplayScale = 1;
  private winMs = 0;
  private winN = 0;
  /** The held cutscene scale (null = hold the gameplay scale; QA `?csscale=0` / `__game.csProfile.hold` for A/Bs). */
  hold: number | null;
  /** QA (`?csguard=<ms>` / `__game.csProfile.debugAddMs`): added to every measured cutscene frame — proves the guard. */
  debugAddMs = 0;

  constructor(preset: string, hold: number | null = CUTSCENE_SCALE[preset as PresetId] ?? null) {
    this.hold = hold;
  }

  /** A cutscene took the screen. Returns the scale to set now (null = leave the scale alone). */
  begin(gameplayScale: number): number | null {
    this.active = true;
    this.tripped = false;
    this.winMs = 0;
    this.winN = 0;
    this.gameplayScale = gameplayScale;
    // never below what gameplay already had (Max dynres runs up to 1.0: a fixed 0.85 would degrade it — r4 C2b 0.875)
    const target = this.hold === null ? gameplayScale : Math.max(this.hold, gameplayScale);
    this.scale = target;
    return Math.abs(target - gameplayScale) > 1e-4 ? target : null;
  }

  /**
   * One rendered cutscene frame (ms since the previous). Returns the scale to step back to when the guard trips this
   * frame, else null. Windows are 1 s of frames; the first frame of a cutscene (a cut, a compile) is not special-cased —
   * a single 50 ms spike inside a 1 s window of 16 ms frames averages ≈ 18 ms and never trips it.
   */
  frame(ms: number): number | null {
    if (!this.active || this.tripped || !(ms > 0)) return null;
    this.winMs += ms + this.debugAddMs;
    this.winN++;
    if (this.winMs < GUARD_WINDOW_S * 1000) return null;
    const avg = this.winMs / this.winN;
    this.winMs = 0;
    this.winN = 0;
    if (avg <= GUARD_MS) return null;
    this.tripped = true;
    this.trips++;
    this.scale = this.gameplayScale;
    return this.gameplayScale;
  }

  /** The cutscene released the screen. Returns the gameplay scale to restore (or null if it never changed). */
  end(): number | null {
    if (!this.active) return null;
    this.active = false;
    const changed = this.scale !== null && Math.abs(this.scale - this.gameplayScale) > 1e-4;
    this.scale = null;
    this.tripped = false;
    return changed ? this.gameplayScale : null;
  }
}
