// Eye adaptation / auto exposure (docs/REALISM-BACKLOG.md item 4).
//
// Meter: every 0.25 s the HDR scene colour (pre-exposure, cd/m²-like) is reduced to a 64×64 HalfFloat target of
// log2(luminance) (2×2 taps per texel) and read back asynchronously (Renderer.readRenderTargetPixelsAsync). The CPU
// takes the centre-weighted (Gaussian σ = 0.22 of the frame on a 0.25 floor, like a camera's centre-weighted
// metering) mean of the logs inside a histogram window (LOOK.meterLow..meterHigh percentiles) → Lavg. Target exposure = key / Lavg (Reinhard et al. 2002), clamped to the room's
// range (LOOK.minExposure .. maxExposure, +4.6 EV by default), plus LOOK.biasEV.
// Adaptation runs in EV: brightening (dark adaptation) with τ = LOOK.tauBrighten (6 s), darkening with τ = 0.5 s.
// Lightning: a 100 ms flash over-exposes the frame and the eye can't follow it — the meter is frozen from the first
// pulse until LOOK.flashHold s after the last, and readings issued before a flash and returned during it are dropped.
// Snap: a teleport / camera cut (> 2.5 m in one update) adapts instantly to the first reading taken after it.
// Direct path (Low on WebGL2: no scene texture to meter) uses the per-zone fallback exposure the caller passes.
//
// Three APIs used (r186): RenderTarget, HalfFloatType, NodeMaterial.fragmentNode, QuadMesh.render(renderer),
// Renderer.setRenderTarget / getRenderTarget / readRenderTargetPixelsAsync, DataUtils.fromHalfFloat, TSL texture()/uv().

import * as THREE from 'three/webgpu';
import { Fn, float, log2, luminance, max, texture, uv, vec2, vec4 } from 'three/tsl';
import { LOOK } from './look.ts';

const SIZE = 64;
const PERIOD = 0.25;

export interface MeterReading {
  /** log2 of the centre-weighted log-average luminance (pre-exposure). */
  log2Avg: number;
  /** The exposure the meter asks for (clamped), linear. */
  target: number;
  /** Simulation time of the reading. */
  t: number;
  /** log2 of the centre-weighted LOOK.hpPct percentile luminance (highlight protect). */
  hp?: number;
}

/**
 * AD review — scripted light changes that land on a camera cut shorter than the 2.5 m teleport test (C5: the parlor
 * candles go out as the camera cuts 2 m to the tally wall) ask for a snap here; without it the eye brightened at
 * τ 6 s and the first shadow-play beat played ≈ 2.5 EV too dark.
 */
let snapRequested = false;
/** Opening (C1-OPENING §5.2, set by src/world/opening.ts `exposure` fx): hold = meter frozen; min/max override the
 *  room clamp (linear). null = the room's own range. */
export const EXPOSURE_CUE: { hold: boolean; min: number | null; max: number | null; spot: { x: number; y: number; r: number; w: number } | null } = { hold: false, min: null, max: null, spot: null };
export function requestExposureSnap(): void {
  snapRequested = true;
}

export class AutoExposure {
  /** Current exposure in EV (log2 of the linear multiplier). */
  ev = 0;
  last: MeterReading | null = null;
  /** Room-aware clamp for this frame (linear). */
  range = { min: LOOK.minExposure, max: LOOK.maxExposure };

  private readonly renderer: any;
  private readonly rt: any;
  private readonly quad: any;
  private readonly weights = new Float32Array(SIZE * SIZE);
  private readonly vals = new Float32Array(SIZE * SIZE);
  private readonly order = new Uint16Array(SIZE * SIZE);
  private weightSum = 0;
  private t = 0;
  private nextMeter = 0;
  private busy = false;
  private holdUntil = -1;
  private flashSerial = 0;
  private snapAfter = -1;
  private targetEV = 0;
  private haveTarget = false;
  private readonly lastCam = new THREE.Vector3(Number.NaN, 0, 0);

  /** The pipeline's exposure uniform: written by update(), and at once when a snap reading lands between updates. */
  private readonly out: any;

  constructor(renderer: any, meterTexture: any | null, exposureUniform: any) {
    this.renderer = renderer;
    this.out = exposureUniform;
    if (meterTexture) {
      this.rt = new THREE.RenderTarget(SIZE, SIZE, { type: THREE.HalfFloatType, depthBuffer: false });
      this.rt.texture.name = 'exposure-meter';
      const src = texture(meterTexture);
      const mat = new THREE.NodeMaterial();
      mat.name = 'exposure-meter';
      const o = 0.25 / SIZE;
      mat.fragmentNode = Fn(() => {
        const p = uv();
        let s: any = float(0);
        for (const [dx, dy] of [[-o, -o], [o, -o], [-o, o], [o, o]]) {
          s = s.add(log2(max(luminance(src.sample(p.add(vec2(dx, dy))).rgb), 1e-7)));
        }
        return vec4(s.mul(0.25), 0, 0, 1);
      })();
      this.quad = new THREE.QuadMesh(mat);
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const dx = (x + 0.5) / SIZE - 0.5;
          const dy = (y + 0.5) / SIZE - 0.5;
          const w = 0.25 + Math.exp(-(dx * dx + dy * dy) / (2 * 0.22 * 0.22));
          this.weights[y * SIZE + x] = w;
          this.weightSum += w;
        }
      }
    } else {
      this.rt = null;
      this.quad = null;
    }
  }

  get exposure(): number {
    return Math.pow(2, this.ev);
  }

  /** Adapt instantly to the next reading (teleports, checkpoints, cutscene cuts). */
  snap(): void {
    this.snapAfter = this.t;
    this.nextMeter = this.t; // meter on the next update (it reads the frame rendered after this one)
  }

  /**
   * Per simulation step. `lightning` = current flash level; `fallback` = the zone's exposure where there is nothing to
   * meter (Direct path). Returns the linear exposure to put in the pipeline uniform.
   */
  update(dt: number, lightning: number, camPos: any, fallback: number): number {
    this.t += dt;
    if (!LOOK.autoExposure) {
      this.ev = Math.log2(Math.max(1e-4, LOOK.manualExposure));
      this.out.value = this.exposure;
      return this.exposure;
    }
    // camera cut / teleport → snap to the first clean reading after it
    if (Number.isNaN(this.lastCam.x) || this.lastCam.distanceTo(camPos) > 2.5) this.snap();
    if (snapRequested) {
      snapRequested = false; // AD review: a scripted lighting change on a short cut (requestExposureSnap)
      this.snap();
    }
    this.lastCam.copy(camPos);
    if (lightning > 0.002) {
      if (this.holdUntil < this.t) this.flashSerial++;
      this.holdUntil = this.t + LOOK.flashHold;
    }
    const lo = EXPOSURE_CUE.min ?? this.range.min; // opening exposure cue (null = the room's range)
    const hi = EXPOSURE_CUE.max ?? this.range.max;
    const clampEV = (e: number) => Math.min(Math.log2(hi), Math.max(Math.log2(lo), e)) + LOOK.biasEV;
    if (!this.quad) {
      this.targetEV = clampEV(Math.log2(Math.max(1e-4, fallback)));
      this.haveTarget = true;
      if (this.snapAfter >= 0) {
        this.ev = this.targetEV;
        this.snapAfter = -1;
      }
    } else if (this.t >= this.nextMeter && !this.busy && this.t >= this.holdUntil && !(EXPOSURE_CUE.hold && this.snapAfter < 0)) {
      this.nextMeter = this.t + PERIOD;
      this.measure(clampEV);
    }
    if (this.haveTarget && dt > 0) {
      const tau = this.targetEV > this.ev ? LOOK.tauBrighten : LOOK.tauDarken;
      this.ev += (this.targetEV - this.ev) * (1 - Math.exp(-dt / Math.max(1e-3, tau)));
    }
    this.out.value = this.exposure;
    return this.exposure;
  }

  private measure(clampEV: (e: number) => number): void {
    const r = this.renderer;
    const issuedAt = this.t;
    const serial = this.flashSerial;
    const prev = r.getRenderTarget();
    try {
      r.setRenderTarget(this.rt);
      this.quad.render(r);
    } finally {
      r.setRenderTarget(prev);
    }
    this.busy = true;
    r.readRenderTargetPixelsAsync(this.rt, 0, 0, SIZE, SIZE)
      .then((px: ArrayLike<number>) => {
        if (serial !== this.flashSerial) return; // a flash started while this reading was in flight
        const half = px instanceof Uint16Array;
        const n = SIZE * SIZE;
        for (let i = 0; i < n; i++) {
          const raw = px[i * 4];
          let v = half ? THREE.DataUtils.fromHalfFloat(raw) : raw;
          if (!Number.isFinite(v)) v = -20;
          this.vals[i] = Math.min(8, Math.max(-20, v));
          this.order[i] = i;
        }
        // histogram-window metering (as in UE's auto exposure): mean log luminance between the weighted
        // LOOK.meterLow and meterHigh percentiles — black voids don't drag the exposure up, a lamp or the torch
        // hotspot can pull it down (the surroundings sink), specular sparkles above meterHigh are ignored
        const vals = this.vals;
        this.order.sort((x, y) => vals[x] - vals[y]);
        const lo = LOOK.meterLow * this.weightSum;
        const hi = LOOK.meterHigh * this.weightSum;
        let cum = 0;
        let s = 0;
        let ws = 0;
        let lin = 0;
        const hpAt = LOOK.hpPct * this.weightSum;
        let hpLog = -20;
        for (let k = 0; k < n; k++) {
          const i = this.order[k];
          const w = this.weights[i];
          if (cum < hpAt && cum + w >= hpAt) hpLog = vals[i];
          const a = Math.max(cum, lo);
          const b = Math.min(cum + w, hi);
          if (b > a) {
            s += vals[i] * (b - a);
            lin += Math.pow(2, vals[i]) * (b - a);
            ws += b - a;
          }
          cum += w;
          if (cum >= hi) break;
        }
        // log mean (robust, Reinhard) blended with the log of the arithmetic mean (bright areas weigh more: a torch
        // hotspot or a lamp pulls the exposure down like a camera's averaging meter)
        const log2Avg = ws > 0 ? (s / ws) * (1 - LOOK.meterMeanMix) + Math.log2(Math.max(1e-9, lin / ws)) * LOOK.meterMeanMix : -20;
        // runtime E review — highlight protect: a camera operator / the eye stops down for what fills the centre; the
        // centre-weighted LOOK.hpPct percentile may map to at most LOOK.hpWhite × display white (a torch core on a prop
        // at 0.5–1.3 m stays a lit, textured surface instead of a clipped disc). 0 disables it.
        // The cap applies AFTER the room clamp (the night key still keeps every room as before) with its own floor
        // LOOK.hpFloor: target = max(hpFloor, min(clamp(key EV), hp EV)).
        // C2-ESCAPE §2.4 (B1): a spot-weighted meter — the eye fixes the work area (the neck, then the floor): the log mean
        // inside a screen circle (uv, centre x/y, radius r; aspect-agnostic) is blended in with weight w (0.6 in C2)
        const sp = EXPOSURE_CUE.spot;
        let metered = log2Avg;
        if (sp && sp.w > 0) {
          let ss = 0;
          let sn = 0;
          for (let i = 0; i < n; i++) {
            const dx = ((i % SIZE) + 0.5) / SIZE - sp.x;
            const dy = (Math.floor(i / SIZE) + 0.5) / SIZE - sp.y;
            if (dx * dx + dy * dy > sp.r * sp.r) continue;
            ss += Math.max(-14, vals[i]);
            sn++;
          }
          if (sn > 0) metered = log2Avg * (1 - sp.w) + (ss / sn) * sp.w;
        }
        let target = clampEV(Math.log2(LOOK.key) - metered);
        if (LOOK.hpWhite > 0 && hpLog > -20 && EXPOSURE_CUE.min == null && EXPOSURE_CUE.max == null) target = Math.max(Math.log2(LOOK.hpFloor), Math.min(target, Math.log2(LOOK.hpWhite) - hpLog + LOOK.biasEV));
        this.targetEV = target;
        this.haveTarget = true;
        this.last = { log2Avg, target: Math.pow(2, this.targetEV), t: issuedAt, hp: hpLog };
        if (this.snapAfter >= 0 && issuedAt > this.snapAfter) {
          this.ev = this.targetEV;
          this.snapAfter = -1;
          this.out.value = this.exposure;
        }
      })
      .catch(() => {})
      .finally(() => {
        this.busy = false;
      });
  }

  dispose(): void {
    this.rt?.dispose();
    this.quad?.material?.dispose();
  }
}
