// FPS meter: ring buffer of deltas between RENDERED frames (rAF timestamps).
// Reports a ~1 s rolling average, "1% low" (mean of the slowest 1% of the window) and the p99 frame time as FPS.
// Pure logic (no DOM) — the overlay lives in fps-overlay.ts. Tested in tests/fps-meter.test.ts.

export interface FpsStats {
  /** Rolling average over the most recent ~1 s of frames. */
  avg: number;
  /** Average FPS of the slowest 1% of frames in the window. */
  low1: number;
  /** 99th-percentile frame time expressed as FPS. */
  p99: number;
  /** Average frame time (ms) over the ~1 s window. */
  avgMs: number;
  frames: number;
}

const EMPTY: FpsStats = { avg: 0, low1: 0, p99: 0, avgMs: 0, frames: 0 };

export class FpsMeter {
  private readonly d: Float32Array;
  private i = 0;
  private n = 0;
  private last = -1;
  private scratch: Float32Array;

  constructor(size = 1200) {
    this.d = new Float32Array(size);
    this.scratch = new Float32Array(size);
  }

  reset(): void {
    this.i = 0;
    this.n = 0;
    this.last = -1;
  }

  /** Call once per rendered frame with the rAF timestamp (ms). */
  frame(t: number): void {
    if (this.last >= 0) {
      const dt = t - this.last;
      if (dt > 0 && dt < 500) {
        this.d[this.i] = dt;
        this.i = (this.i + 1) % this.d.length;
        if (this.n < this.d.length) this.n++;
      }
    }
    this.last = t;
  }

  get count(): number {
    return this.n;
  }

  /** O(n log n); call ~4× per second, not every frame. */
  stats(): FpsStats {
    const n = this.n;
    if (n === 0) return { ...EMPTY };
    const L = this.d.length;
    let sum = 0;
    let cnt = 0;
    for (let k = 1; k <= n && sum < 1000; k++) {
      sum += this.d[(this.i - k + L) % L];
      cnt++;
    }
    const all = this.scratch.subarray(0, n);
    for (let k = 0; k < n; k++) all[k] = this.d[(this.i - 1 - k + L) % L];
    all.sort(); // ascending frame times
    const w = Math.max(1, Math.ceil(n * 0.01));
    let ws = 0;
    for (let k = 0; k < w; k++) ws += all[n - 1 - k];
    const p99Ms = all[Math.min(n - 1, Math.ceil(n * 0.99) - 1)];
    return {
      avg: (cnt * 1000) / sum,
      low1: 1000 / (ws / w),
      p99: 1000 / p99Ms,
      avgMs: sum / cnt,
      frames: n,
    };
  }
}
