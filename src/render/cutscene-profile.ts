// Cutscene render profile (CUTSCENES-PLAN §5, M-A; ROADMAP ruling (aq) 2026-10-12) — PURE (no three.js).
// While a cutscene owns the screen dynamic resolution is paused and the scene scale is HELD at
//     hold = max(floor, min(base, cap(cutscene)))      base = the gameplay scale (or the A/B raise, below)
//   - ruling (aq): smoothness beats a higher cutscene resolution. Before it, the hold froze whatever scale gameplay had
//     reached in the cheap B03 hall (Medium 0.85, Max 0.95 on the real route, STATUS-smooth-perf S9) and C2 missed
//     vsync in 21–23 % of its frames. Each cutscene now has a per-tier CAP measured on the M1 so that it holds 60 fps
//     there (docs/STATUS-perf2.md), never below the preset's dynamic-resolution floor (dynResFor's min: Max's floor is
//     Medium's best internal resolution on this display). A cutscene without a measured cap holds the gameplay scale.
//   - caps are measured as a scale at the reference output CAP_REF_PIXELS (scripts/shot.mjs: 1280×800, DPR 1) and
//     applied as an INTERNAL-PIXEL budget: the C2 scene pass is fill-bound (STATUS-smooth-perf S9: the half-resolution
//     scene saves 8–10 of 20–23 ms), so a larger drawing buffer (a Retina window, Max's pixel ratio 1.5) gets the same
//     pixel count from a lower scale instead of the same scale's 1.3–2.8× the pixels.
//   - a chained cutscene (C2 → C2c, C6 → C6b → C7 → CR) re-applies its own cap on its first frame (`cut`): a resolution
//     change on a hard cut is not seen. main.ts applies the hold BEFORE the frame renders, so the cut frame itself
//     already has the new scale (no one-frame pop after the cut).
// Guard (1 s windows of rendered cutscene frames; frames > HITCH_MS — a compile, a GC — are not load and are ignored):
//   - missed vsync (ruling (aq)): more than MISS_RATE of a window's frames took > MISS_FACTOR × the target interval
//     (60 Hz: > 20 ms, the PERF lanes' "missed vsync" since S9) → the scale steps down MISS_STEP, never below the
//     floor; again in each window while it persists; never back up inside the cutscene;
//   - overload: the window's mean frame > GUARD_MS → straight to the floor and `tripped` (main.ts turns the cutscene-only
//     volumetric beam off for the rest of that cutscene), so a cutscene can never sit below 25 fps.
// On release the gameplay dynamic-resolution scale returns. main.ts drives it (`?csguard=<ms>` adds ms to every measured
// cutscene frame — QA proves the guard; `?cscap=0` = no caps, the pre-(aq) hold, for A/Bs).

export type PresetId = 'low' | 'medium' | 'max';

/** The cutscene raise (null = no raise). Ruling (ad): off — and ruling (aq) caps the hold from above anyway. */
// Ruling (ad) decision (M-A infra, round 3–4 real-time runs, docs/STATUS-ma-infra.md): the raise to Medium 0.9 measured
// costless in C2 → C2c then, but "≥ 45 fps in EVERY M-A cutscene" was not met, so the hold stays at the gameplay value.
export const CUTSCENE_SCALE: Record<PresetId, number | null> = { low: null, medium: null, max: null };
/** The measured raise of ruling (ad) (QA `?csscale=1` A/B only). */
export const CUTSCENE_SCALE_RAISED: Record<PresetId, number | null> = { low: null, medium: 0.9, max: 0.85 };
/** Guard: average frame time over GUARD_WINDOW_S above this (ms) trips it. */
export const GUARD_MS = 40;
export const GUARD_WINDOW_S = 1;
/** Missed-vsync guard (ruling (aq)): a window with more than this share of missed frames steps down. */
export const MISS_RATE = 0.05;
/** A frame missed its vsync when it took longer than this × the target interval (60 Hz: 20 ms; a 30 fps cap: 40 ms). */
export const MISS_FACTOR = 1.2;
/** Scale step of the missed-vsync guard (the gameplay dynres step). */
export const MISS_STEP = 0.05;
/** Frames longer than this are stalls (pipeline compile, GC, a hidden tab), not load: no scale fixes them. */
export const HITCH_MS = 250;

/** Reference drawing-buffer size the caps were measured at (scripts/shot.mjs default viewport, DPR 1). */
export const CAP_REF_PIXELS = 1280 * 800;
/**
 * Per-cutscene caps (scale at CAP_REF_PIXELS), measured on the M1 7-core on mains power — docs/STATUS-perf2.md item 3:
 * on the real route (playthrough bot) every 2 s of each cutscene's clock the frame was frozen and its fenced GPU ms
 * measured at 3 scales (scratch/perf2/cscost.mjs, after the #150 character-light pool); per state ms(s) = a + b·s²
 * gives the largest scale ≤ 17.5 ms fenced (the real-time C2 runs: states ≤ 18.2 ms held 60 fps), the cap is the
 * minimum over the cutscene's states rounded down to the dynres grid (0.025) (scratch/perf2/capfit.mjs: states whose
 * cost does not fall with the scale — CPU-bound, or a stall in the sample — set no cap). Missing = no state was over
 * budget at the highest measured scale (Medium 0.85, Max 1.0) — no measured limit, the hold is the gameplay scale.
 * Low has no dynamic resolution (no hold). Max's caps at 0.85 are its floor: C4c (raw 0.83) and C6 (raw 0.75, 20.5 ms
 * at 0.85) cannot hold 60 fps there on the M1 at any allowed scale — efficiency work, not scale (STATUS-perf2 handoff).
 */
export const CUTSCENE_CAP: Record<PresetId, Readonly<Record<string, number>>> = {
  low: {},
  // C6 worst @6.37 20.3 / 18.6 / 16.2 ms at 0.85 / 0.75 / 0.65 → 0.711; C6b @2.3 22.1 / 17.0 / 14.0 → 0.75;
  // C7 @24.5 19.9 / 20.0 / 16.1 → 0.689 (v4/cost-medium.json)
  medium: { C6: 0.7, C6b: 0.725, C7: 0.675 },
  // C2 @8.4 19.9 / 18.1 / 16.7 ms at 1 / 0.925 / 0.85 → 0.894; C4c @10.43 → 0.831 (floor); C5b @8.4 → 0.968;
  // C6 @4.33 25.6 / 23.0 / 20.5 → 0.747 (floor); C6b @4.33 → 0.896; C7 @4.33 → 0.909 (v4/cost-max.json);
  // C5 (culled since #150) @0.3 18.2 / 18.1 / 16.6 → 0.915 (v8/c5-max.json; 0–15 s is CPU-bound at 16.6–19.6 ms)
  max: { C2: 0.875, C4c: 0.85, C5: 0.9, C5b: 0.95, C6: 0.85, C6b: 0.875, C7: 0.9 },
};

/** The cap of cutscene `id` as a scale of a drawing buffer of `outputPixels` (null = no cap). Pure. */
export function capScaleFor(preset: string, id: string | null, outputPixels: number, caps = CUTSCENE_CAP): number | null {
  const c = id ? caps[preset as PresetId]?.[id] : undefined;
  if (c === undefined || !(c > 0)) return null;
  const px = outputPixels > 0 ? outputPixels : CAP_REF_PIXELS;
  return Math.round(c * Math.sqrt(CAP_REF_PIXELS / px) * 1000) / 1000;
}

export interface CutsceneProfileOptions {
  /** The preset's dynamic-resolution floor (dynResFor(...).min). Unset: the hold never steps below where it began. */
  floor?: number;
  /** Drawing-buffer pixels (renderer width × height × pixel ratio) at the moment a cutscene begins / cuts. */
  outputPixels?: () => number;
  /** Per-preset caps (default CUTSCENE_CAP; `?cscap=0` passes {}). */
  caps?: Record<PresetId, Readonly<Record<string, number>>>;
  /** QA A/B (`?csprofile=legacy`): the pre-(aq) profile — no caps, no missed-vsync guard, an overload trip returns to
   *  the gameplay scale (the #143 baseline tree's behaviour). */
  legacy?: boolean;
}

export class CutsceneProfile {
  active = false;
  /** The cutscene the hold is for (null = none / unknown id). */
  id: string | null = null;
  /** The overload guard tripped in the current cutscene (floor scale, beam off until the cutscene ends). */
  tripped = false;
  /** Times the overload guard tripped since load (QA). */
  trips = 0;
  /** Missed-vsync steps since load (QA). */
  steps = 0;
  /** What the last non-null frame() return was: 'miss' (a −MISS_STEP step) or 'trip' (overload → floor). */
  lastStep: 'miss' | 'trip' | null = null;
  /** The scale the profile asked for while active (null = none / not active). */
  scale: number | null = null;
  /** The last finished guard window: share of missed frames, mean ms (QA). */
  lastWindow: { missRate: number; meanMs: number; frames: number } | null = null;
  private gameplayScale = 1;
  private lo = 0;
  private winMs = 0;
  private winN = 0;
  private winMiss = 0;
  /** The held cutscene scale (null = hold the gameplay scale; QA `?csscale=1` / `__game.csProfile.hold` for A/Bs). */
  hold: number | null;
  /** QA (`?csguard=<ms>` / `__game.csProfile.debugAddMs`): added to every measured cutscene frame — proves the guard. */
  debugAddMs = 0;
  readonly preset: string;
  private readonly opts: CutsceneProfileOptions;

  constructor(preset: string, hold: number | null = CUTSCENE_SCALE[preset as PresetId] ?? null, opts: CutsceneProfileOptions = {}) {
    this.preset = preset;
    this.hold = hold;
    this.opts = opts;
  }

  /** The hold for cutscene `id` from the gameplay scale (cap ∧ floor). */
  private target(id: string | null): number {
    const g = this.gameplayScale;
    // never below what gameplay already had (Max dynres runs up to 1.0: a fixed 0.85 raise would degrade it)
    const base = this.hold === null ? g : Math.max(this.hold, g);
    if (this.opts.legacy) {
      this.lo = g;
      return base;
    }
    const cap = capScaleFor(this.preset, id, this.opts.outputPixels?.() ?? CAP_REF_PIXELS, this.opts.caps);
    const t = cap === null ? base : Math.min(base, cap);
    const floor = this.opts.floor;
    // without a known floor the guard and the cap never go below where gameplay was (the pre-(aq) semantics)
    this.lo = floor !== undefined ? floor : Math.min(g, t);
    return Math.max(this.lo, t);
  }

  private resetWindow(): void {
    this.winMs = 0;
    this.winN = 0;
    this.winMiss = 0;
  }

  /** A cutscene took the screen. Returns the scale to set now (null = leave the scale alone). */
  begin(gameplayScale: number, id: string | null = null): number | null {
    this.active = true;
    this.tripped = false;
    this.lastStep = null;
    this.resetWindow();
    this.gameplayScale = gameplayScale;
    this.id = id;
    const prev = gameplayScale;
    this.scale = this.target(id);
    return Math.abs(this.scale - prev) > 1e-4 ? this.scale : null;
  }

  /**
   * The screen-holding cutscene changed while held (a chained cutscene's first frame). Re-applies the new cutscene's
   * cap from the gameplay scale and re-arms the guard. Returns the scale to set now (null = unchanged).
   */
  cut(id: string | null): number | null {
    if (!this.active || id === this.id) return null;
    const prev = this.scale ?? this.gameplayScale;
    this.id = id;
    this.tripped = false;
    this.lastStep = null;
    this.resetWindow();
    this.scale = this.target(id);
    return Math.abs(this.scale - prev) > 1e-4 ? this.scale : null;
  }

  /**
   * One rendered cutscene frame (`ms` since the previous; `targetMs` = the frame interval the game aims for). Returns
   * the scale to step to when the guard acts at the end of a window, else null (`lastStep` says which guard acted).
   * A single 50 ms spike inside a 1 s window of 16.7 ms frames is 1 of ≈ 58 frames (1.7 %) and never steps.
   */
  frame(ms: number, targetMs = 1000 / 60): number | null {
    if (!this.active || !(ms > 0) || ms > HITCH_MS) return null;
    const m = ms + this.debugAddMs;
    this.winMs += m;
    this.winN++;
    if (m > targetMs * MISS_FACTOR) this.winMiss++;
    if (this.winMs < GUARD_WINDOW_S * 1000) return null;
    const mean = this.winMs / this.winN;
    const missRate = this.winMiss / this.winN;
    this.lastWindow = { missRate: Math.round(missRate * 1000) / 1000, meanMs: Math.round(mean * 10) / 10, frames: this.winN };
    this.resetWindow();
    const cur = this.scale ?? this.gameplayScale;
    if (mean > GUARD_MS && !this.tripped) {
      this.tripped = true;
      this.trips++;
      this.lastStep = 'trip';
      this.scale = this.lo;
      return this.scale; // always reported (main.ts turns the beam off), even when already at the floor
    }
    if (missRate > MISS_RATE && !this.opts.legacy) {
      const next = Math.max(this.lo, Math.round((cur - MISS_STEP) * 1000) / 1000);
      if (next < cur - 1e-4) {
        this.scale = next;
        this.steps++;
        this.lastStep = 'miss';
        return next;
      }
    }
    return null;
  }

  /** The cutscene released the screen. Returns the gameplay scale to restore (or null if it never changed). */
  end(): number | null {
    if (!this.active) return null;
    this.active = false;
    const changed = this.scale !== null && Math.abs(this.scale - this.gameplayScale) > 1e-4;
    this.scale = null;
    this.id = null;
    this.tripped = false;
    this.resetWindow();
    return changed ? this.gameplayScale : null;
  }
}
