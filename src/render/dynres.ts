// Dynamic resolution: adjusts the scene-pass resolution scale (never the pixel ratio / output size) within the
// preset's [min, max] from measured frame times. Pure logic; the pipeline applies the scale.
//
// We can only observe CPU-side frame deltas (vsync-bound when the GPU keeps up), so:
//  - drop 0.05 when the 1 s average frame time exceeds the target by 12% (GPU can't keep up);
//  - raise 0.025 only after 4 s consistently at target, and never within 8 s of a drop (hysteresis: the drop
//    proved the higher scale was too expensive).

export interface DynResConfig {
  enabled: boolean;
  min: number;
  max: number;
}

export class DynamicResolution {
  scale: number;
  private readonly cfg: DynResConfig;
  private acc = 0;
  private frames = 0;
  private windowT = 0;
  private goodT = 0;
  private sinceDrop = Infinity;

  constructor(cfg: DynResConfig, initial: number) {
    this.cfg = cfg;
    this.scale = Math.min(cfg.max, Math.max(cfg.min, initial));
  }

  /**
   * Feed one rendered frame. `frameMs` = delta between rendered frames, `targetMs` = 1000 / target fps
   * (the preset target, or the frame cap if lower). Returns the new scale when it changed, else null.
   */
  update(frameMs: number, targetMs: number): number | null {
    if (!this.cfg.enabled || !(frameMs > 0) || frameMs > 250) return null;
    this.acc += frameMs;
    this.frames++;
    this.windowT += frameMs;
    this.sinceDrop += frameMs;
    if (this.windowT < 1000) return null;
    const avg = this.acc / this.frames;
    this.acc = 0;
    this.frames = 0;
    const span = this.windowT;
    this.windowT = 0;
    const prev = this.scale;
    if (avg > targetMs * 1.12) {
      this.scale = Math.max(this.cfg.min, this.scale - 0.05);
      this.goodT = 0;
      this.sinceDrop = 0;
    } else if (avg <= targetMs * 1.03) {
      this.goodT += span;
      if (this.goodT >= 4000 && this.sinceDrop >= 8000) {
        this.scale = Math.min(this.cfg.max, this.scale + 0.025);
        this.goodT = 0;
      }
    } else {
      this.goodT = 0;
    }
    return this.scale !== prev ? this.scale : null;
  }
}
