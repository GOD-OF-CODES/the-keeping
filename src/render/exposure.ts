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
  private t = 0;
  private nextMeter = 0;
  private busy = false;
  private holdUntil = -1;
  private flashSerial = 0;
  private snapAfter = -1;
  private targetEV = 0;
  /** The last update ran under a film-camera cue (EXPOSURE_CUE.fixed). */
  private wasFixed = false;
  private fixedEnd = -1e9;
  private haveTarget = false;
  private readonly lastCam = new THREE.Vector3(Number.NaN, 0, 0);

  /** The pipeline's exposure uniform: written by update(), and at once when a snap reading lands between updates. */
  private readonly out: any;
  /** The scene pass's HDR output texture (null on the Direct path). */
  private readonly meterSrc: any;

  constructor(renderer: any, meterTexture: any | null, exposureUniform: any) {
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
    if (EXPOSURE_CUE.cap && EXPOSURE_CUE.max != null) {
      const capEV = Math.log2(EXPOSURE_CUE.max) + LOOK.biasEV;
      if (this.ev > capEV) this.ev = capEV;
      if (this.targetEV > capEV) this.targetEV = capEV;
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
        const keys = this.keys;
        for (let i = 0; i < n; i++) keys[i] = Math.round((vals[i] + 20) * 1e4) * 65536 + i;
        keys.sort();
        for (let i = 0; i < n; i++) this.order[i] = keys[i] % 65536;
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
        if (LOOK.hpWhite > 0 && hpLog > -20 && (EXPOSURE_CUE.hp || (EXPOSURE_CUE.min == null && EXPOSURE_CUE.max == null))) target = Math.max(Math.log2(LOOK.hpFloor), Math.min(target, Math.log2(LOOK.hpWhite) - hpLog + LOOK.biasEV));
        // fix round 4 LOOK — fixation protect (look.ts fixR/fixPct/fixWhite/fixRatio): gameplay only (no cue)
        let fixLog = -20;
        if (LOOK.fixWhite > 0 && EXPOSURE_CUE.min == null && EXPOSURE_CUE.max == null) {
          // PERF G fix round 4 (#132): a preallocated scratch + a typed-array numeric sort (no per-readback array/closure)
          const fs = this.fixScratch;
          let m = 0;
          for (let i = 0; i < n; i++) {
            const dx = ((i % SIZE) + 0.5) / SIZE - 0.5;
            const dy = (Math.floor(i / SIZE) + 0.5) / SIZE - 0.5;
            if (dx * dx + dy * dy <= LOOK.fixR * LOOK.fixR) fs[m++] = vals[i];
          }
          if (m > 0) {
            const fv = fs.subarray(0, m).sort();
            fixLog = fv[Math.min(m - 1, Math.floor(LOOK.fixPct * m))];
            if (fixLog - metered >= Math.log2(LOOK.fixRatio) && fixLog - metered <= Math.log2(LOOK.fixRatioMax)) target = Math.max(Math.log2(LOOK.hpFloor), Math.min(target, Math.log2(LOOK.fixWhite) - fixLog + LOOK.biasEV));
          }
        }
        this.targetEV = target;
        this.haveTarget = true;
        this.last = { log2Avg, target: Math.pow(2, this.targetEV), t: issuedAt, hp: hpLog, fix: fixLog };
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
    };
  }

  dispose(): void {
    this.rt?.dispose();
    this.quad?.material?.dispose();
    this.probeRT?.dispose();
    this.probeQuad?.material?.dispose();
  }
}
