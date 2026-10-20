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
import { Fn, float, log2, luminance, max, texture, uniform, uv, vec2, vec4 } from 'three/tsl';
import { LOOK } from './look.ts';
import { TORCH_WORLD } from './flashlight-bounce.ts';

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
  /** log2 of the centre-disk LOOK.fixPct percentile (fixation protect, fix round 4). */
  fix?: number;
  /** FLASH (#146): which bound set the target ('key' meter, 'hp' highlight protect, 'fix' fixation protect). */
  which?: 'key' | 'hp' | 'fix';
  /** FLASH (#146): the torch's near gain G (EV) when the reading was issued, and the shift (1 − nearAdapt)·G applied. */
  near?: number;
  shift?: number;
  /** FLASH part 2 (V2): this reading's fixation weight, and whether it was metered with the engaged (wide) disk. */
  wf?: number;
  engaged?: boolean;
}

/**
 * FLASH lane (#146) — the torch pool's near gain G (EV): how much brighter the beam's hot spot is on the static surface
 * it lands on (lens → surface distance d along the axis, TORCH_WORLD.hitDist) than at LOOK.nearD0. With the aperture
 * near field (flashlight.ts: E ∝ 1 / (σ² d² + D²/8), D 5 cm, σ² = LOOK.torchSigma2) — 2·log2(D0/d) in the far field,
 * bounded at contact. 0 beyond D0, with the torch off (hitDist ∞), or while a character stands in the beam.
 */
export function torchNearGain(d: number, subject: boolean): number {
  if (!(LOOK.nearD0 > 0) || subject || !(d < LOOK.nearD0)) return 0;
  const k = 0.05 * 0.05 * 0.125; // D²/8
  const s2 = Math.max(1e-4, LOOK.torchSigma2);
  const e = (x: number) => 1 / (s2 * x * x + k);
  return Math.max(0, Math.log2(e(Math.max(0.05, d)) / e(LOOK.nearD0)));
}

export interface MeterScratch {
  vals: Float32Array;
  weights: Float32Array;
  weightSum: number;
  order: Uint16Array;
  keys: Float64Array;
  fixScratch: Float32Array;
}

/**
 * The meter's exposure target (EV, incl. LOOK.biasEV) from one 64×64 log2-luminance reading (`vals`, already clamped to
 * [−20, 8]) — pure, so tests/exposure-response.test.ts can drive it. lo/hi = the room clamp (linear). `shift` (EV ≥ 0)
 * is subtracted from every metered log luminance (the near-pool term, FLASH #146): the eye meters the torch-lit scene as
 * if the torch's near gain were (1 − nearAdapt) smaller, i.e. it adapts to nearAdapt of each EV the pool gains.
 */
export function meterTarget(
  m: MeterScratch,
  lo: number,
  hi: number,
  shift = 0,
  floorDrop = 0,
  fixEngaged = false,
): { target: number; log2Avg: number; hp: number; fix: number; which: 'key' | 'hp' | 'fix'; keyT: number; fixT: number; wf: number } {
  const n = SIZE * SIZE;
  const { vals, keys, order, weights } = m;
  // histogram-window metering (as in UE's auto exposure): mean log luminance between the weighted
  // LOOK.meterLow and meterHigh percentiles — black voids don't drag the exposure up, a lamp or the torch
  // hotspot can pull it down (the surroundings sink), specular sparkles above meterHigh are ignored
  for (let i = 0; i < n; i++) keys[i] = Math.round((vals[i] + 20) * 1e4) * 65536 + i;
  keys.sort();
  for (let i = 0; i < n; i++) order[i] = keys[i] % 65536;
  const wlo = LOOK.meterLow * m.weightSum;
  const whi = LOOK.meterHigh * m.weightSum;
  let cum = 0;
  let s = 0;
  let ws = 0;
  let lin = 0;
  const hpAt = LOOK.hpPct * m.weightSum;
  let hpLog = -20;
  for (let k = 0; k < n; k++) {
    const i = order[k];
    const w = weights[i];
    if (cum < hpAt && cum + w >= hpAt) hpLog = vals[i];
    const a = Math.max(cum, wlo);
    const b = Math.min(cum + w, whi);
    if (b > a) {
      s += vals[i] * (b - a);
      lin += Math.pow(2, vals[i]) * (b - a);
      ws += b - a;
    }
    cum += w;
    if (cum >= whi) break;
  }
  // log mean (robust, Reinhard) blended with the log of the arithmetic mean (bright areas weigh more: a torch
  // hotspot or a lamp pulls the exposure down like a camera's averaging meter)
  const log2Avg = ws > 0 ? (s / ws) * (1 - LOOK.meterMeanMix) + Math.log2(Math.max(1e-9, lin / ws)) * LOOK.meterMeanMix : -20;
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
  const clampEV = (e: number) => Math.min(Math.log2(hi), Math.max(Math.log2(lo), e)) + LOOK.biasEV;
  // the protects' floor; in the near zone it drops with the part of the near gain the eye does adapt to (floorDrop =
  // nearAdapt·G): a pupil at its stop would otherwise end the half-adaptation ≈ 1.5 m from a wall (the pool then
  // rose 1 EV per EV and clipped to 45–100× white with no falloff left — scratch/flash-beam/sim.ts)
  const floorEV = Math.log2(LOOK.hpFloor) - Math.max(0, floorDrop);
  let which: 'key' | 'hp' | 'fix' = 'key';
  let target = clampEV(Math.log2(LOOK.key) - (metered - shift));
  // runtime E review — highlight protect: a camera operator / the eye stops down for what fills the centre; the
  // centre-weighted LOOK.hpPct percentile may map to at most LOOK.hpWhite × display white (a torch core on a prop
  // at 0.5–1.3 m stays a lit, textured surface instead of a clipped disc). 0 disables it.
  // The cap applies AFTER the room clamp (the night key still keeps every room as before) with its own floor
  // LOOK.hpFloor: target = max(hpFloor, min(clamp(key EV), hp EV)).
  if (LOOK.hpWhite > 0 && hpLog > -20 && (EXPOSURE_CUE.hp || (EXPOSURE_CUE.min == null && EXPOSURE_CUE.max == null))) {
    const h = Math.max(floorEV, Math.min(target, Math.log2(LOOK.hpWhite) - (hpLog - shift) + LOOK.biasEV));
    if (h < target - 1e-9) which = 'hp';
    target = h;
  }
  // fix round 4 LOOK — fixation protect (look.ts fixR/fixPct/fixWhite/fixRatio): gameplay only (no cue)
  // FLASH part 2 (V2): the target before the fixation blend, the fixation bound and its weight are returned too (QA).
  const keyT = target;
  let fixT = Number.NaN;
  let wfOut = 0;
  let fixLog = -20;
  if (LOOK.fixWhite > 0 && EXPOSURE_CUE.min == null && EXPOSURE_CUE.max == null) {
    // PERF G fix round 4 (#132): a preallocated scratch + a typed-array numeric sort (no per-readback array/closure)
    // FLASH part 2 (V2, the 0.7 m "breathing"): SPATIAL HYSTERESIS. A torch core sitting on the disk's edge (idle sway,
    // grain on the 64×64 grid) flipped this percentile between the core and the spill from one reading to the next: the
    // target toggled ≈ 2 EV (fix −3.98 ↔ the room clamp −2.00, verify runB2 U4T) every 1–3 s — slow up (τ 6 s), fast down:
    // a 0.9–1.2 EV breathing of the whole frame. The eye keeps its adaptation to a fixated subject that drifts a little:
    // once the protect is ENGAGED (the caller's last reading had wf ≥ ½) the disk widens to fixR·fixHyst and the
    // percentile keeps the same NUMBER of top texels as the engage disk (a wider disk must not dilute the subject). A
    // subject that really leaves (beyond the wide disk: you look away) is released at once, as before.
    const fs = m.fixScratch;
    const r0 = LOOK.fixR;
    const rw = fixEngaged ? r0 * Math.max(1, LOOK.fixHyst) : r0;
    let c = 0;
    let c0 = 0;
    for (let i = 0; i < n; i++) {
      const dx = ((i % SIZE) + 0.5) / SIZE - 0.5;
      const dy = (Math.floor(i / SIZE) + 0.5) / SIZE - 0.5;
      const d2 = dx * dx + dy * dy;
      if (d2 <= rw * rw) fs[c++] = vals[i];
      if (d2 <= r0 * r0) c0++;
    }
    if (c > 0) {
      const fv = fs.subarray(0, c).sort();
      const top = (1 - LOOK.fixPct) * c0; // texels above the percentile in the engage disk (≈ 9 of 290)
      fixLog = fv[Math.min(c - 1, Math.max(0, Math.floor(c - top)))];
      // FLASH (#146): the ratio window's edges are soft (LOOK.fixSoft EV wide; 0 = the old hard gate): crossing
      // fixRatio while the pool fills the disk no longer switches the protect fully on/off between two readings
      const r = fixLog - metered;
      const r0 = Math.log2(LOOK.fixRatio);
      const r1 = Math.log2(LOOK.fixRatioMax);
      const soft = Math.max(0, LOOK.fixSoft);
      const wf = soft > 0 ? smooth01((r - (r0 - soft)) / soft) * (1 - smooth01((r - r1) / soft)) : r >= r0 && r <= r1 ? 1 : 0;
      const f = Math.max(floorEV, Math.min(target, Math.log2(LOOK.fixWhite) - (fixLog - shift) + LOOK.biasEV));
      fixT = f;
      wfOut = wf;
      if (wf > 0) {
        if (f < target - 1e-9 && wf >= 0.5) which = 'fix';
        target += (f - target) * wf;
      }
    }
  }
  return { target, log2Avg, hp: hpLog, fix: fixLog, which, keyT, fixT, wf: wfOut };
}


/** A meter scratch with the centre weights (Gaussian σ 0.22 of the frame on a 0.25 floor) — AutoExposure and tests. */
export function createMeterScratch(): MeterScratch {
  const n = SIZE * SIZE;
  const m: MeterScratch = { vals: new Float32Array(n), weights: new Float32Array(n), weightSum: 0, order: new Uint16Array(n), keys: new Float64Array(n), fixScratch: new Float32Array(n) };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (x + 0.5) / SIZE - 0.5;
      const dy = (y + 0.5) / SIZE - 0.5;
      const w = 0.25 + Math.exp(-(dx * dx + dy * dy) / (2 * 0.22 * 0.22));
      m.weights[y * SIZE + x] = w;
      m.weightSum += w;
    }
  }
  return m;
}

function smooth01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * AD review — scripted light changes that land on a camera cut shorter than the 2.5 m teleport test (C5: the parlor
 * candles go out as the camera cuts 2 m to the tally wall) ask for a snap here; without it the eye brightened at
 * τ 6 s and the first shadow-play beat played ≈ 2.5 EV too dark.
 */
let snapRequested = false;
/** Opening (C1-OPENING §5.2, set by src/world/opening.ts `exposure` fx): hold = meter frozen; min/max override the
 *  room clamp (linear). null = the room's own range. */
// Escape fix round (lane CINE, ruling (c)): `hp` keeps the highlight protect ON under a cue's min/max (C2/C2c: the
// lamp-lit gown at 0.5–1 m must stay textured cotton, never plaster white); its floor is LOOK.hpFloor, not cue min.
// `cap` (C2c glance #2): the cue's max clamps the CURRENT exposure at once (a pupil constricting on a torch-lit wall
// 0.4 m away, ≈ 15 klx — 0.2–0.5 s in life; the meter's readback would arrive after the 600 ms glance is over).
// Fix round 3 (ruling m): `fixed` = a CAMERA, not an eye — the linear exposure of a stated film set-up (ISO, f-stop,
// 180° shutter; derivation in c2-room.ts / docs/STATUS-escape-cine.md "Fix round 3 — exposure"). While set, the meter
// is bypassed and the exposure IS this value from the cue's first frame (no adaptation, no run-to-run drift — the old
// min/max cues only clamped NEW readings, so a stale hall reading held C2's strike at 5.6 under a 2.2 cap in QA).
// Shadows go black; a lightning flash over-exposes it as it would a film camera. When the cue ends the eye adapts
// from this value (ev is left where the camera was: no pop at the handover).
export const EXPOSURE_CUE: { hold: boolean; min: number | null; max: number | null; spot: { x: number; y: number; r: number; w: number } | null; hp: boolean; cap: boolean; fixed: number | null } = { hold: false, min: null, max: null, spot: null, hp: false, cap: false, fixed: null };
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
  private readonly fixScratch = new Float32Array(SIZE * SIZE);
  /** PERF G (ruling f): sort keys (quantised value × 65536 + index) — a comparator sort of `order` copied the array
   *  into a fresh JS array every meter read (≈ 1.4 MB/s of garbage, scratch/pg/alloc-c1a); a numeric Float64Array sort
   *  runs in place. Value step 1e-4 (log2 luminance), far below any visible exposure change. */
  private readonly keys = new Float64Array(SIZE * SIZE);
  private weightSum = 0;
  /** The arrays above, as meterTarget()'s scratch (filled in the constructor). */
  private readonly scratch: MeterScratch;
  /** FLASH (#146): the PHYSICAL near gain (subject ignored) the current target was metered under — the feed-forward
   *  reference (update()): it tracks how much brighter the torch-lit frame got since, not the subject gate's regime. */
  private targetNear = 0;
  private t = 0;
  private nextMeter = 0;
  /** Readings in flight (readRenderTargetPixelsAsync: each call has its own buffer on both backends — concurrent-safe). */
  private inFlight = 0;
  /** FLASH (#146, FRAMES lane finding): the simulation time of the last snap() — readings issued at or before it describe
   *  the frame before the cut and are dropped entirely (they used to set the target to the pre-cut scene). */
  private cutAt = -1;
  /** A post-cut reading has been issued for the pending snap (it may bypass a reading still in flight). */
  private snapIssued = false;
  /** FLASH (#146 1b): a post-render meter is queued for the snap made in this update (armPostRender). */
  private postArmed = false;
  private disposed = false;
  private holdUntil = -1;
  private flashSerial = 0;
  private snapAfter = -1;
  private targetEV = 0;
  /** The last update ran under a film-camera cue (EXPOSURE_CUE.fixed). */
  private wasFixed = false;
  private fixedEnd = -1e9;
  private haveTarget = false;
  private readonly lastCam = new THREE.Vector3(Number.NaN, 0, 0);
  /** FLASH part 2 (V2): the fixation protect was engaged by the last reading (meterTarget's spatial hysteresis). */
  private fixEngaged = false;
  /** FLASH part 2 (V2 residual): the noise-gated target (EV) and the reading time it was set at. */
  private filtT = Number.NaN;
  private filtAt = -1;

  /** The pipeline's exposure uniform: written by update(), and at once when a snap reading lands between updates. */
  private readonly out: any;
  /** The scene pass's HDR output texture (null on the Direct path). */
  private readonly meterSrc: any;

  constructor(renderer: any, meterTexture: any | null, exposureUniform: any) {
    this.scratch = { vals: this.vals, weights: this.weights, weightSum: 0, order: this.order, keys: this.keys, fixScratch: this.fixScratch };
    this.renderer = renderer;
    this.out = exposureUniform;
    this.meterSrc = meterTexture;
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
      this.scratch.weightSum = this.weightSum;
    } else {
      this.rt = null;
      this.quad = null;
    }
  }

  get exposure(): number {
    return Math.pow(2, this.ev);
  }

  /** Adapt instantly to the next reading (teleports, checkpoints, cutscene cuts). */
  // FLASH (#146; SMOOTHNESS FRAMES lane, STATUS-smooth-frames "For FLASHLIGHT/HANDS"): a cut detected INSIDE update()
  // used to meter in that same update — the scene texture still held the frame BEFORE the cut (correctly not snapped
  // to) — and push nextMeter 0.25 s on, so the first post-cut reading landed ≈ 0.3 s (9–10 frames) after every cut:
  // C7 15.83 / 18.6 blown out for 9 frames then ×0.03 / ×0.02, C0 ×4, C5 6.53, C6 ×6, C6b ×2, C2b 7.33. Now the reading
  // is issued right after the post-cut frame is rendered (armPostRender, a microtask after the update → render tick)
  // or, failing that, on the first update AFTER the snap (t > snapAfter), even while an older reading is still in
  // flight: the snap lands 1 frame after the cut (2 on the fallback path / WebGL2's polled readback).
  snap(): void {
    this.snapAfter = this.t;
    this.cutAt = this.t;
    this.snapIssued = false;
    this.nextMeter = this.t; // meter on the next update (it reads the frame rendered after this one)
  }

  /** POLISH #156e (F3): put the eye back to a known adaptation (a hide exit: the same room and torch state as before
   *  the hide) and continue from there. Every reading issued before now is dropped (they metered the dark hide) and a
   *  pending snap is cancelled — NOT re-armed: the first post-exit frame may still show the torch coming up, and a snap
   *  to it would put the eye straight back to the hide's ceiling. The next regular reading adapts as usual (τ).
   *  Ignored under a film-camera cue (it owns the exposure). */
  restore(ev: number): void {
    if (EXPOSURE_CUE.fixed != null || !Number.isFinite(ev)) return;
    snapRequested = false;
    this.ev = ev;
    this.targetEV = ev;
    this.haveTarget = true;
    this.cutAt = this.t;
    this.snapAfter = -1;
    this.snapIssued = false;
    this.filtT = ev;
    this.filtAt = this.t;
    this.nextMeter = this.t + PERIOD * 0.5;
    this.out.value = this.exposure;
  }

  /**
   * Per simulation step. `lightning` = current flash level; `fallback` = the zone's exposure where there is nothing to
   * meter (Direct path). Returns the linear exposure to put in the pipeline uniform.
   */
  update(dt: number, lightning: number, camPos: any, fallback: number): number {
    this.t += dt;
    if (!LOOK.autoExposure || EXPOSURE_CUE.fixed != null) {
      // LOOK.autoExposure false (debug / QA A/B: look.set) wins over a cue's camera
      this.ev = Math.log2(Math.max(1e-4, !LOOK.autoExposure ? LOOK.manualExposure : (EXPOSURE_CUE.fixed ?? LOOK.manualExposure)));
      this.targetEV = this.ev;
      this.haveTarget = true;
      this.lastCam.copy(camPos); // the camera's own moves/cuts are not the eye's (no snap queued behind them)
      snapRequested = false;
      this.wasFixed = EXPOSURE_CUE.fixed != null;
      this.out.value = this.exposure;
      return this.exposure;
    }
    // Fix round 3: the first eye frame after a film-camera cue (C2c → B05 hand-back) ADAPTS from the camera's value
    // (τ brighten/darken) — the hand-back's R2-5 snap would step +0.5 EV in one frame on a continuous POV.
    // (a 0.25 s window: the cue's reset and the bindings' release snap may land on either side of this update)
    if (this.wasFixed) {
      this.wasFixed = false;
      this.fixedEnd = this.t;
      this.snapAfter = -1;
      this.lastCam.copy(camPos);
    }
    if (this.t - this.fixedEnd < 0.25) {
      snapRequested = false;
      this.snapAfter = -1;
      this.lastCam.copy(camPos);
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
    const nearPhys = this.nearNow(false);
    const nearNow = TORCH_WORLD.subject ? 0 : nearPhys;
    if (!this.quad) {
      this.targetEV = clampEV(Math.log2(Math.max(1e-4, fallback)));
      this.haveTarget = true;
      if (this.snapAfter >= 0) {
        this.ev = this.targetEV;
        this.snapAfter = -1;
      }
    } else if (
      this.t >= this.nextMeter &&
      this.t >= this.holdUntil &&
      !(EXPOSURE_CUE.hold && this.snapAfter < 0) &&
      (this.snapAfter >= 0 ? this.t > this.snapAfter && !this.snapIssued && this.inFlight < 3 : this.inFlight === 0)
    ) {
      if (this.snapAfter >= 0) this.snapIssued = true;
      this.nextMeter = this.t + PERIOD;
      this.measure(lo, hi, nearNow, nearPhys);
    } else if (this.snapAfter === this.t && !this.snapIssued && !this.postArmed) {
      this.armPostRender(lo, hi, nearNow, nearPhys);
    }
    if (this.haveTarget && dt > 0) {
      // FLASH (#146) feed-forward: a reading is 0.25 s + readback latency old; walking at a wall at 1.6 m/s the pool
      // gains up to ≈ 9 EV/s inside 0.5 m. A torch-lit frame scales with the pool, so the meter would now ask for
      // nearAdapt × (the near gain gained since the reading) less — applied every frame, so the target leads the
      // readback instead of stepping behind it (no brighten-then-dip on the approach). 0 outside the near zone.
      // (with a character in the beam the eye adapts fully, as before #146: the lead then follows the whole gain)
      let tgt = this.targetEV;
      if (LOOK.nearLead > 0 && (nearPhys > 0 || this.targetNear > 0)) {
        const a = Math.min(1, Math.max(0, LOOK.nearAdapt));
        tgt -= (TORCH_WORLD.subject ? 1 : a) * (nearPhys - this.targetNear) * LOOK.nearLead;
        tgt = Math.max(Math.log2(LOOK.hpFloor) - (a < 1 ? a * nearNow : 0), Math.min(Math.log2(hi) + LOOK.biasEV, tgt));
      }
      const tau = tgt > this.ev ? LOOK.tauBrighten : LOOK.tauDarken;
      this.ev += (tgt - this.ev) * (1 - Math.exp(-dt / Math.max(1e-3, tau)));
    }
    if (EXPOSURE_CUE.cap && EXPOSURE_CUE.max != null) {
      const capEV = Math.log2(EXPOSURE_CUE.max) + LOOK.biasEV;
      if (this.ev > capEV) this.ev = capEV;
      if (this.targetEV > capEV) this.targetEV = capEV;
    }
    this.out.value = this.exposure;
    return this.exposure;
  }

  /** FLASH (#146): the torch's near gain now — gameplay only (no exposure cue of any kind); `gated` = 0 while a
   *  character stands in the beam (the gain the meter may discount), else the physical gain. */
  private nearNow(gated = true): number {
    if (EXPOSURE_CUE.min != null || EXPOSURE_CUE.max != null || EXPOSURE_CUE.fixed != null || EXPOSURE_CUE.hold || EXPOSURE_CUE.spot) return 0;
    return torchNearGain(TORCH_WORLD.hitDist, gated && TORCH_WORLD.subject);
  }

  /**
   * FLASH (#146 1b, second step): a cut detected in THIS update is metered right after the pipeline has rendered the
   * post-cut frame — a microtask runs once the synchronous rAF tick (update → render) or advance() step that called
   * update() is over — so the reading is back before the next frame and only the cut frame itself shows the pre-cut
   * EV. Before, the reading waited for update N+1 (it read frame N then, but landed after frame N+1 was submitted):
   * 2 stale frames (browser, C0 ×4). Skipped — the update path (t > snapAfter) issues it on the next update — when
   * nothing rendered since the snap (renderer.info.render.calls: cumulative per renderer.render call, r186 Info.js),
   * another update ran first, a flash holds the meter, a film-camera cue is on, or 3 readings are in flight.
   */
  private armPostRender(lo: number, hi: number, near: number, nearPhys: number): void {
    const info = this.renderer.info?.render;
    if (!this.quad || !info || typeof info.calls !== 'number') return;
    const t0 = this.t;
    const calls0 = info.calls;
    this.postArmed = true;
    queueMicrotask(() => {
      this.postArmed = false;
      if (this.disposed || this.snapIssued || this.snapAfter !== t0 || this.t !== t0 || info.calls === calls0) return;
      if (this.t < this.holdUntil || this.inFlight >= 3 || !LOOK.autoExposure || EXPOSURE_CUE.fixed != null) return;
      this.snapIssued = true;
      this.nextMeter = this.t + PERIOD;
      this.measure(lo, hi, near, nearPhys, true);
    });
  }

  /** `postCut`: issued after the cut frame was rendered, in the same simulation step as the snap (armPostRender) —
   *  stamped just after it so the cut filter (issuedAt <= cutAt) keeps it and the snap takes it. */
  private measure(lo: number, hi: number, near: number, nearPhys: number, postCut = false): void {
    const r = this.renderer;
    const issuedAt = postCut ? this.t + 1e-6 : this.t;
    const serial = this.flashSerial;
    const prev = r.getRenderTarget();
    try {
      r.setRenderTarget(this.rt);
      this.quad.render(r);
    } finally {
      r.setRenderTarget(prev);
    }
    this.inFlight++;
    r.readRenderTargetPixelsAsync(this.rt, 0, 0, SIZE, SIZE)
      .then((px: ArrayLike<number>) => {
        if (serial !== this.flashSerial) return; // a flash started while this reading was in flight
        if (issuedAt <= this.cutAt) return; // the frame before a cut (see snap())
        const half = px instanceof Uint16Array;
        const n = SIZE * SIZE;
        for (let i = 0; i < n; i++) {
          const raw = px[i * 4];
          let v = half ? THREE.DataUtils.fromHalfFloat(raw) : raw;
          if (!Number.isFinite(v)) v = -20;
          this.vals[i] = Math.min(8, Math.max(-20, v));
          this.order[i] = i;
        }
        const a = Math.min(1, Math.max(0, LOOK.nearAdapt));
        const shift = (1 - a) * near;
        // FLASH part 2 (V2): the fixation protect's spatial hysteresis — engaged by the last reading (not across a cut)
        const snapping = this.snapAfter >= 0 && issuedAt > this.snapAfter;
        const engaged = this.fixEngaged && !snapping;
        const res = meterTarget(this.scratch, lo, hi, shift, a < 1 ? a * near : 0, engaged);
        this.fixEngaged = res.wf >= 0.5;
        // FLASH part 2 (V2 residual): a NOISE GATE on the target. With the toggling gone, the protects' percentiles still
        // jitter ±0.15–0.35 EV from one reading to the next on a torch-lit wall (the hot core's texture under idle sway,
        // TAA jitter, the battery's flicker dips; a 4×4-tap meter did not reduce it — T1 A/B), and the asymmetric
        // adaptation (down τ 0.5 s, up 6 s) turned that into a slow-up / fast-down ripple of 0.2–0.4 EV standing still.
        // Small changes (< LOOK.meterNoiseEV) are low-passed with τ LOOK.meterNoiseTau between readings; changes of
        // ≥ 2× that pass at once (a lamp, the torch on, a cut — no added latency where the eye must react).
        let target = res.target;
        if (LOOK.meterNoiseTau > 0 && LOOK.meterNoiseEV > 0 && Number.isFinite(this.filtT) && !snapping && issuedAt > this.filtAt) {
          const d = target - this.filtT;
          const big = smooth01((Math.abs(d) - LOOK.meterNoiseEV) / LOOK.meterNoiseEV);
          const k = 1 - Math.exp(-(issuedAt - this.filtAt) / LOOK.meterNoiseTau);
          target = this.filtT + d * (k + (1 - k) * big);
        }
        this.filtT = target;
        this.filtAt = issuedAt;
        this.targetEV = target;
        this.targetNear = nearPhys;
        this.haveTarget = true;
        this.last = { log2Avg: res.log2Avg, target: Math.pow(2, this.targetEV), t: issuedAt, hp: res.hp, fix: res.fix, which: res.which, near, shift, wf: res.wf, engaged };
        if (this.snapAfter >= 0 && issuedAt > this.snapAfter) {
          this.ev = this.targetEV;
          this.snapAfter = -1;
          this.out.value = this.exposure;
        }
      })
      .catch(() => {})
      .finally(() => {
        this.inFlight--;
      });
  }

  // ---- QA read-back (fix round 3, ruling (m)): linear PRE-exposure HDR scene radiance in a screen patch -----------
  // `window.__game.look.hdr(...)` (atmosphere.ts) — the scene pass's own output texture (the one the meter reads:
  // after lighting, fog and the in-pass emissives; before bloom, exposure, white balance and AgX), averaged over a
  // 32×32 grid of bilinear taps inside the rectangle (cx ± rx, cy ± ry) in screen uv, y DOWN from the top
  // (QuadMesh uv convention in r186: uv.y = 0 on the top row on both backends; three flips WebGL targets for us).
  // Units: cd/m²-like scene radiance (lamp intensity in cd, lightmaps × π); a white Lambertian at E lx reads E/π.
  private probeRT: any = null;
  private probeQuad: any = null;
  private probeRect: any = null;

  async probe(cx: number, cy: number, rx: number, ry: number): Promise<{ rgb: [number, number, number]; lum: number; min: number; max: number } | null> {
    if (!this.quad) return null;
    // 32 texels × 8 B (RGBA half) = 256 B rows: WebGPU pads readback rows to 256 B and three returns the PADDED buffer
    // (WebGPUTextureUtils.copyTextureToBuffer) — an 8-wide target read 3/4 zeros (first c2-meter run, 'min 0').
    const P = 32;
    if (!this.probeRT) {
      this.probeRT = new THREE.RenderTarget(P, P, { type: THREE.HalfFloatType, depthBuffer: false });
      this.probeRT.texture.name = 'qa-hdr-probe';
      this.probeRect = uniform(new THREE.Vector4(0.5, 0.5, 0.01, 0.01));
      const src = texture(this.meterSrc);
      const rect = this.probeRect;
      const mat = new THREE.NodeMaterial();
      mat.name = 'qa-hdr-probe';
      mat.fragmentNode = Fn(() => {
        const p = rect.xy.add(uv().sub(0.5).mul(2).mul(rect.zw));
        const c = src.sample(p).rgb;
        return vec4(c, luminance(c));
      })();
      this.probeQuad = new THREE.QuadMesh(mat);
    }
    this.probeRect.value.set(cx, cy, rx, ry);
    const r = this.renderer;
    const prev = r.getRenderTarget();
    try {
      r.setRenderTarget(this.probeRT);
      this.probeQuad.render(r);
    } finally {
      r.setRenderTarget(prev);
    }
    const px: ArrayLike<number> = await r.readRenderTargetPixelsAsync(this.probeRT, 0, 0, P, P);
    const half = px instanceof Uint16Array;
    const f = (v: number) => (half ? THREE.DataUtils.fromHalfFloat(v) : v);
    const s = [0, 0, 0, 0];
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i < P * P; i++) {
      for (let c = 0; c < 4; c++) s[c] += f(px[i * 4 + c]);
      const l = f(px[i * 4 + 3]);
      mn = Math.min(mn, l);
      mx = Math.max(mx, l);
    }
    const n = P * P;
    return { rgb: [s[0] / n, s[1] / n, s[2] / n], lum: s[3] / n, min: mn, max: mx };
  }

  /** QA: the whole exposure state of THIS frame (fix round 3 — the old review read renderer.toneMappingExposure,
   *  which the pipeline never uses: exposure is the `uniforms.exposure` multiply before AgX; toneMappingExposure = 1). */
  state(): Record<string, unknown> {
    return {
      applied: this.out.value,
      /** the meter's own simulation clock (last.t is on it: age = t − last.t) */
      t: this.t,
      ev: this.ev,
      targetEV: this.targetEV,
      range: { ...this.range },
      cue: { ...EXPOSURE_CUE, spot: EXPOSURE_CUE.spot ? { ...EXPOSURE_CUE.spot } : null },
      last: this.last ? { ...this.last } : null,
      look: { key: LOOK.key, biasEV: LOOK.biasEV, tauBrighten: LOOK.tauBrighten, tauDarken: LOOK.tauDarken, autoExposure: LOOK.autoExposure, manualExposure: LOOK.manualExposure, hpWhite: LOOK.hpWhite, hpFloor: LOOK.hpFloor },
      toneMappingExposure: this.renderer.toneMappingExposure,
      // FLASH (#146): the near-pool term now (G, EV), the static beam-hit distance and the subject flag behind it
      near: { G: this.nearNow(), hitDist: TORCH_WORLD.hitDist, subject: TORCH_WORLD.subject, targetNear: this.targetNear, nearAdapt: LOOK.nearAdapt, nearD0: LOOK.nearD0, nearLead: LOOK.nearLead, fixSoft: LOOK.fixSoft },
    };
  }

  dispose(): void {
    this.disposed = true;
    this.rt?.dispose();
    this.quad?.material?.dispose();
    this.probeRT?.dispose();
    this.probeQuad?.material?.dispose();
  }
}
