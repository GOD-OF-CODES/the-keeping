// Main loop: requestAnimationFrame + frame-rate cap ("due-deadline" algorithm) + clamped dt.
//
// FrameCap is pure (no DOM) so tests can drive it with synthetic rAF timestamps (tests/loop-cap.test.ts).
//
// Cap rules (docs/PLAN.md §2.3, research device-recommender Q5):
//  - keep a `due` deadline; render when t + tolerance >= due, then due += interval;
//  - tolerance = half a vsync once the vsync interval is known (2 ms before), so rAF jitter never halves the rate;
//  - if we are still more than one interval late after advancing (stall, tab switch), resync: due = t + interval —
//    never render a burst of catch-up frames;
//  - divisor mode: cap = refresh / round(refresh / requested) so 144 Hz + "60" runs at 72 (every 2nd vsync) instead
//    of juddering between 2 and 3 vsyncs. Effective rate is exposed for the UI.
//  - vsync interval = median of the last 60 rAF deltas, re-estimated continuously (ProMotion, Safari ~60, Energy Saver).
// Skipping a render inside rAF is safe: the canvas keeps its last presented frame.

import type { FpsCap } from '../shared/types.ts';

export const DT_CLAMP = 0.1;
const VSYNC_WINDOW = 60;
const PRE_ESTIMATE_TOLERANCE_MS = 2;

export class FrameCap {
  /** Estimated display refresh interval (ms); 0 until the first estimate. */
  vsyncMs = 0;
  private due = -1;
  private prevT = -1;
  private deltas: number[] = [];

  reset(): void {
    this.due = -1;
    this.prevT = -1;
    this.deltas.length = 0;
  }

  /** Refresh rate in Hz (0 when unknown). */
  get refreshHz(): number {
    return this.vsyncMs > 0 ? 1000 / this.vsyncMs : 0;
  }

  /** The frame rate the cap will actually produce (0 = uncapped / display rate). */
  effectiveCap(cap: FpsCap, divisorMode: boolean): number {
    if (cap === 0) return 0;
    const hz = this.refreshHz;
    if (!divisorMode || hz <= 0) return cap;
    if (hz <= cap * 1.05) return 0; // display is at or below the cap: every vsync
    const div = Math.max(1, Math.round(hz / cap));
    return hz / div;
  }

  /** Call once per rAF callback with its timestamp. Returns true when this vsync should render. */
  shouldRender(t: number, cap: FpsCap, divisorMode: boolean): boolean {
    this.observe(t);
    const rate = this.effectiveCap(cap, divisorMode);
    if (rate <= 0) {
      this.due = -1;
      return true;
    }
    const interval = 1000 / rate;
    const tolerance = this.vsyncMs > 0 ? this.vsyncMs * 0.5 : PRE_ESTIMATE_TOLERANCE_MS;
    if (this.due < 0) this.due = t;
    if (t + tolerance < this.due) return false;
    this.due += interval;
    if (t - this.due > interval) this.due = t + interval; // stall: resync, no catch-up burst
    return true;
  }

  private observe(t: number): void {
    if (this.prevT >= 0) {
      const d = t - this.prevT;
      if (d > 0 && d < 100) {
        this.deltas.push(d);
        if (this.deltas.length > VSYNC_WINDOW) this.deltas.shift();
        if (this.deltas.length >= 10 && (this.deltas.length === VSYNC_WINDOW || this.vsyncMs === 0 || this.deltas.length % 10 === 0)) {
          const s = [...this.deltas].sort((a, b) => a - b);
          this.vsyncMs = s[s.length >> 1];
        }
      }
    }
    this.prevT = t;
  }
}

export interface LoopCallbacks {
  /** Simulation step. dt in seconds, clamped to DT_CLAMP; 0 while paused. */
  update(dt: number, nowSec: number): void;
  /** Draw the frame (only called on frames that pass the cap). */
  render(): void;
  /** Called with the rAF timestamp of every rendered frame (FPS meter hook). */
  onRendered?(t: number): void;
}

export interface LoopOptions {
  getCap(): FpsCap;
  getDivisorMode(): boolean;
  /** Visibility changes: the loop resets its timing on return; the game pauses. */
  onVisibility?(hidden: boolean): void;
}

export class Loop {
  readonly cap = new FrameCap();
  paused = false;
  frame = 0;
  private running = false;
  private raf = 0;
  private lastRenderT = -1;
  private startT = -1;
  private readonly cb: LoopCallbacks;
  private readonly opts: LoopOptions;
  private readonly onVis = (): void => {
    const hidden = document.hidden;
    this.cap.reset();
    this.lastRenderT = -1;
    this.opts.onVisibility?.(hidden);
  };

  constructor(cb: LoopCallbacks, opts: LoopOptions) {
    this.cb = cb;
    this.opts = opts;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    document.addEventListener('visibilitychange', this.onVis);
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVis);
  }

  private readonly tick = (t: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    if (this.startT < 0) this.startT = t;
    if (!this.cap.shouldRender(t, this.opts.getCap(), this.opts.getDivisorMode())) return;
    let dt = this.lastRenderT < 0 ? 0 : (t - this.lastRenderT) / 1000;
    this.lastRenderT = t;
    if (dt > DT_CLAMP) dt = DT_CLAMP;
    if (this.paused) dt = 0;
    this.frame++;
    this.cb.update(dt, (t - this.startT) / 1000);
    this.cb.render();
    this.cb.onRendered?.(t);
  };
}
