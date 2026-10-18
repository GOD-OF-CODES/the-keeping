// FLASH lane (#146, user 2026-10-12: "the flashlight gets dimmer as you approach walls"): the eye-adaptation meter's
// response (src/render/exposure.ts meterTarget, pure). A brighter frame must never DISPLAY darker, a torch-lit wall
// approached from 4 m to 0.25 m must display a monotonically brighter pool while the eye adapts part of the gain, and
// the old settings (nearAdapt 1, fixSoft 0) must reproduce the pre-#146 meter exactly (the A/B used in QA).
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
import { LOOK } from '../src/render/look.ts';
import { EXPOSURE_CUE, createMeterScratch, meterTarget, torchNearGain } from '../src/render/exposure.ts';

const S = 64;
const DEFAULTS = { ...LOOK };
const reset = () => Object.assign(LOOK, DEFAULTS);

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

/** The pre-#146 readback math (exposure.ts at HEAD 0ba616a, gameplay: no cue), verbatim in structure. */
function legacyTarget(vals: Float32Array, weights: Float32Array, weightSum: number, lo: number, hi: number): number {
  const n = S * S;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => vals[a] - vals[b] || a - b);
  const wlo = LOOK.meterLow * weightSum;
  const whi = LOOK.meterHigh * weightSum;
  let cum = 0, s = 0, ws = 0, lin = 0, hpLog = -20;
  const hpAt = LOOK.hpPct * weightSum;
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
  const log2Avg = ws > 0 ? (s / ws) * (1 - LOOK.meterMeanMix) + Math.log2(Math.max(1e-9, lin / ws)) * LOOK.meterMeanMix : -20;
  const metered = log2Avg;
  const clampEV = (e: number) => Math.min(Math.log2(hi), Math.max(Math.log2(lo), e)) + LOOK.biasEV;
  let target = clampEV(Math.log2(LOOK.key) - metered);
  if (LOOK.hpWhite > 0 && hpLog > -20) target = Math.max(Math.log2(LOOK.hpFloor), Math.min(target, Math.log2(LOOK.hpWhite) - hpLog + LOOK.biasEV));
  if (LOOK.fixWhite > 0) {
    const fs: number[] = [];
    for (let i = 0; i < n; i++) {
      const dx = ((i % S) + 0.5) / S - 0.5;
      const dy = (Math.floor(i / S) + 0.5) / S - 0.5;
      if (dx * dx + dy * dy <= LOOK.fixR * LOOK.fixR) fs.push(vals[i]);
    }
    if (fs.length) {
      fs.sort((a, b) => a - b);
      const fixLog = fs[Math.min(fs.length - 1, Math.floor(LOOK.fixPct * fs.length))];
      if (fixLog - metered >= Math.log2(LOOK.fixRatio) && fixLog - metered <= Math.log2(LOOK.fixRatioMax)) target = Math.max(Math.log2(LOOK.hpFloor), Math.min(target, Math.log2(LOOK.fixWhite) - fixLog + LOOK.biasEV));
    }
  }
  return target;
}

/** A random night frame: dark room (log2 L −9 … −3) with a bright blob (a torch pool / a lamp) somewhere near the centre. */
function randomFrame(m: ReturnType<typeof createMeterScratch>, r: () => number): void {
  const bx = 0.3 + 0.4 * r(), by = 0.3 + 0.4 * r(), br = 0.02 + 0.2 * r(), peak = -2 + 10 * r(), base = -9 + 6 * r();
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S - bx, dy = (y + 0.5) / S - by;
      const blob = Math.pow(2, peak) * Math.exp(-(dx * dx + dy * dy) / (br * br));
      const v = Math.log2(Math.pow(2, base + 1.5 * r()) + blob);
      m.vals[y * S + x] = Math.min(8, Math.max(-20, v));
    }
  }
}

test('old settings (nearAdapt 1, fixSoft 0, no shift) reproduce the pre-#146 meter exactly', () => {
  reset();
  Object.assign(LOOK, { nearAdapt: 1, fixSoft: 0 });
  const m = createMeterScratch();
  const r = rng(146);
  for (let k = 0; k < 60; k++) {
    randomFrame(m, r);
    const ref = legacyTarget(m.vals, m.weights, m.weightSum, LOOK.minExposure, LOOK.maxExposure);
    const got = meterTarget(m, LOOK.minExposure, LOOK.maxExposure).target;
    assert.ok(Math.abs(got - ref) < 1e-6, `frame ${k}: ${got} vs legacy ${ref}`);
  }
  reset();
});

test('a uniformly brighter frame never displays darker (new and old settings)', () => {
  const m = createMeterScratch();
  const base = new Float32Array(S * S);
  for (const set of [{}, { nearAdapt: 1, fixSoft: 0 }]) {
    reset();
    Object.assign(LOOK, set);
    const r = rng(7);
    for (let k = 0; k < 40; k++) {
      randomFrame(m, r);
      base.set(m.vals);
      const t0 = meterTarget(m, LOOK.minExposure, LOOK.maxExposure).target;
      for (const d of [0.25, 0.5, 1, 2, 4]) {
        for (let i = 0; i < S * S; i++) m.vals[i] = Math.min(8, base[i] + d);
        const t1 = meterTarget(m, LOOK.minExposure, LOOK.maxExposure).target;
        // displayed (log2) = scene + exposure: the unclamped texels gain d, the exposure may fall by at most d
        assert.ok(t1 >= t0 - d - 1e-6, `frame ${k} +${d} EV: exposure ${t0.toFixed(3)} → ${t1.toFixed(3)} (displays darker)`);
      }
    }
  }
  reset();
});

/** A perpendicular wallpaper wall (ρ 0.35) at d m lit by the 2 kcd torch cookie (look.ts torch*, the aperture near
 *  field of flashlight.ts), eye ≈ lens, 70° × 96.5° frame, pool 0.05 below centre. Returns log2 L at the pool centre. */
function wall(m: ReturnType<typeof createMeterScratch>, d: number): number {
  const s2 = LOOK.torchSigma2;
  const se = s2 + (0.05 * 0.05 * 0.125) / (d * d);
  const ss = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const ck = (r: number) => Math.exp((-r * r) / se) * LOOK.torchCore * (s2 / se) + (1 - ss(LOOK.torchShelf, 0.95, r)) * LOOK.torchSpill + (1 - ss(0.6, 1, r)) * LOOK.torchTail;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const tx = (((x + 0.5) / S) * 2 - 1) * Math.tan((48.25 * Math.PI) / 180);
      const ty = (((y + 0.5) / S) * 2 - 1) * Math.tan((35 * Math.PI) / 180) - 0.07;
      const r = Math.hypot(tx, ty);
      const c = 1 / Math.sqrt(1 + r * r);
      const E = (LOOK.torchCd * ck(r) * ss(Math.cos(Math.PI / 4), Math.cos(Math.PI / 8), c) * c * c * c) / (d * d);
      m.vals[y * S + x] = Math.min(8, Math.max(-20, Math.log2((0.35 * E) / Math.PI + 0.01)));
    }
  }
  return Math.log2((0.35 * LOOK.torchCd * (s2 / se + LOOK.torchSpill + LOOK.torchTail)) / (d * d) / Math.PI + 0.01);
}

test('walking at a torch-lit wall: the pool displays monotonically brighter, the eye adapts part of it', () => {
  reset();
  const m = createMeterScratch();
  let prev = -Infinity;
  const rows: Array<{ d: number; disp: number; ev: number }> = [];
  for (const d of [4, 3, 2, 1.5, 1, 0.7, 0.5, 0.35, 0.25]) {
    const c = wall(m, d);
    const G = torchNearGain(d, false);
    const a = LOOK.nearAdapt;
    const ev = meterTarget(m, LOOK.minExposure, LOOK.maxExposure, (1 - a) * G, a * G).target;
    const disp = c + ev;
    rows.push({ d, disp, ev });
    // 0.02 EV (1.4 %) tolerance: beyond nearD0 the fixation protect still adapts fully (flat, by design)
    assert.ok(disp >= prev - 0.02, `d ${d}: displayed pool ${disp.toFixed(3)} below ${prev.toFixed(3)} at the previous distance`);
    prev = Math.max(prev, disp);
  }
  const at = (d: number) => rows.find((x) => x.d === d)!;
  assert.ok(at(0.25).disp - at(3).disp >= 2, `the pool brightens ≥ 2 EV from 3 m to 0.25 m (${(at(0.25).disp - at(3).disp).toFixed(2)})`);
  assert.ok(at(1).disp - at(2).disp >= 0.4, `and visibly between 2 m and 1 m (${(at(1).disp - at(2).disp).toFixed(2)})`);
  assert.ok(at(3).ev - at(0.7).ev >= 1, `the eye still adapts ≥ 1 EV between 3 m and 0.7 m (${(at(3).ev - at(0.7).ev).toFixed(2)})`);
  reset();
});

test('near gain: 0 beyond nearD0, with a character in the beam, or with the torch off; grows toward the wall', () => {
  reset();
  assert.equal(torchNearGain(Infinity, false), 0);
  assert.equal(torchNearGain(LOOK.nearD0 + 0.1, false), 0);
  assert.equal(torchNearGain(0.5, true), 0);
  let prev = 0;
  for (const d of [2.9, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.01]) {
    const g = torchNearGain(d, false);
    assert.ok(g > prev - 1e-9, `G(${d}) = ${g} must not fall toward the wall`);
    prev = g;
  }
  assert.ok(prev < 12, 'bounded at contact (aperture near field)');
});

test('exposure cues are untouched: a cue keeps the fixation protect off and no near shift reaches the meter', () => {
  reset();
  const m = createMeterScratch();
  wall(m, 0.5);
  const before = { ...EXPOSURE_CUE };
  try {
    EXPOSURE_CUE.min = 0.05;
    EXPOSURE_CUE.max = 2.2;
    const a = meterTarget(m, 0.05, 2.2).target;
    Object.assign(LOOK, { nearAdapt: 1, fixSoft: 0 });
    const b = meterTarget(m, 0.05, 2.2).target;
    assert.ok(Math.abs(a - b) < 1e-9, 'under a cue the new settings change nothing');
  } finally {
    Object.assign(EXPOSURE_CUE, before);
    reset();
  }
});

// ---- the post-cut snap latency (SMOOTHNESS FRAMES lane finding, folded into FLASH #146) --------------------------------
import * as THREE_ from 'three/webgpu';
import { AutoExposure } from '../src/render/exposure.ts';
const THREE = THREE_ as any;

/** A fake renderer: render() "draws" the current scene level into the meter target; each readback resolves on the next
 *  frame (≈ the real 1–2 frame latency) with a uniform frame at the level that was drawn when it was issued. */
function fakeRenderer() {
  const pending: Array<() => void> = [];
  const r = {
    level: -6, // log2 luminance of the frame on screen (the scene texture the meter reads)
    drawn: -6,
    toneMappingExposure: 1,
    getRenderTarget: () => null,
    setRenderTarget: () => {},
    render: () => {
      r.drawn = r.level;
    },
    readRenderTargetPixelsAsync: () => {
      const v = r.drawn;
      return new Promise((res) => pending.push(() => res(new Float32Array(64 * 64 * 4).fill(v))));
    },
    flush: async () => {
      for (const f of pending.splice(0)) f();
      await new Promise((res) => setTimeout(res, 0));
    },
  };
  return r;
}

test('a camera cut snaps the exposure within 3 frames, metered on the post-cut frame', async () => {
  reset();
  const r = fakeRenderer();
  const out = { value: 1 };
  const ae = new AutoExposure(r, new THREE.Texture(), out);
  const cam = new THREE.Vector3(0, 0, 0);
  const frame = async () => {
    ae.update(1 / 30, 0, cam, 4);
    await r.flush(); // last frame's readbacks land
    r.drawn = r.level; // the pipeline renders this frame (the scene texture now shows `level`)
  };
  for (let i = 0; i < 300; i++) await frame(); // settle on the dark scene
  const evDark = ae.ev;
  // cut: the camera jumps 10 m onto a scene 6 EV brighter
  cam.set(10, 0, 0);
  r.level = 0;
  const evs: number[] = [];
  for (let i = 0; i < 12; i++) {
    await frame();
    evs.push(ae.ev);
  }
  // the key-metered target falls by the scene's 6 EV, clamped to the room range (minExposure 0.25 = −2 EV)
  const expected = Math.max(Math.log2(LOOK.minExposure), evDark - 6);
  assert.ok(evDark - expected > 2, `a big step to snap (${evDark.toFixed(2)} → ${expected.toFixed(2)})`);
  const k = evs.findIndex((e) => Math.abs(e - expected) < 0.05);
  assert.ok(k >= 0 && k <= 2, `snapped on frame ${k + 1} after the cut (evs ${evs.map((e) => e.toFixed(2)).join(' ')}; expected ${expected.toFixed(2)})`);
  // and no stale pre-cut reading pulls it back afterwards
  for (const e of evs.slice(k)) assert.ok(Math.abs(e - expected) < 0.05, `held after the snap (${evs.map((x) => x.toFixed(2)).join(' ')})`);
  ae.dispose();
});

test('the post-cut frame is metered right after it renders: only the cut frame keeps the pre-cut EV', async () => {
  // the real loop order: rAF tick = update() then the pipeline renders; once the tick is over its microtasks run
  // (armPostRender issues the post-cut reading), and the GPU readback lands before the next vsync
  reset();
  const r: any = fakeRenderer();
  r.info = { render: { calls: 0 } };
  const out = { value: 1 };
  const ae = new AutoExposure(r, new THREE.Texture(), out);
  const cam = new THREE.Vector3(0, 0, 0);
  const shown: number[] = []; // log2 of the exposure each rendered frame was drawn with
  const tick = async (render = true) => {
    ae.update(1 / 30, 0, cam, 4);
    if (render) {
      r.info.render.calls++;
      r.drawn = r.level;
      shown.push(Math.log2(out.value));
    }
    await new Promise((res) => setTimeout(res, 0)); // the tick is over: its microtasks ran
    await r.flush(); // the frame's readbacks land before the next vsync
  };
  for (let i = 0; i < 300; i++) await tick();
  const evDark = ae.ev;
  const expected = Math.max(Math.log2(LOOK.minExposure), evDark - 6);
  // guard: a cut whose frame was NOT rendered before the microtask (no renderer.render call) must not meter the
  // stale pre-cut texture as if it were post-cut
  cam.set(10, 0, 0);
  r.level = 0;
  await tick(false);
  assert.ok(Math.abs(ae.ev - evDark) < 0.05, `no snap to a stale frame (${evDark.toFixed(2)} → ${ae.ev.toFixed(2)})`);
  // the cut proper: the next frames render the bright scene; the fallback path takes the reading on the next update
  shown.length = 0;
  for (let i = 0; i < 4; i++) await tick();
  assert.ok(shown.slice(1).every((e) => Math.abs(e - expected) < 0.05), `fallback: snapped by frame 2 (${shown.map((e) => e.toFixed(2)).join(' ')})`);
  // settle dark again, then a clean cut: only the cut frame itself is drawn at the old EV
  r.level = -6;
  cam.set(0, 0, 0);
  for (let i = 0; i < 300; i++) await tick();
  const evDark2 = ae.ev;
  cam.set(10, 0, 0);
  r.level = 0;
  shown.length = 0;
  for (let i = 0; i < 8; i++) await tick();
  assert.ok(Math.abs(shown[0] - evDark2) < 0.05, `the cut frame keeps the pre-cut EV (${shown.map((e) => e.toFixed(2)).join(' ')})`);
  for (const e of shown.slice(1)) assert.ok(Math.abs(e - expected) < 0.05, `frame 1 after the cut onward is snapped and held (${shown.map((x) => x.toFixed(2)).join(' ')}; expected ${expected.toFixed(2)})`);
  ae.dispose();
});

// ---- FLASH part 2 (V2): the 0.7 m "breathing" -------------------------------------------------------------------------
/** A torch-lit wall frame (log2 luminance): dim room −7, the pool's spill disc (r 0.3) at −2, the hot core (r 0.05) at
 *  +2.5 centred at (0.5, cy) — cy 0.5 = on the gaze (inside the 0.15 fixation disk), 0.72 = just outside its edge. */
function wallFrame(cy: number): Float32Array {
  const px = new Float32Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const u = (x + 0.5) / 64, v = (y + 0.5) / 64;
      const dp = Math.hypot(u - 0.5, v - 0.55), dc = Math.hypot(u - 0.5, v - cy);
      const L = Math.pow(2, -7) + (dp < 0.3 ? Math.pow(2, -2) : 0) + Math.pow(2, 2.5) * Math.exp(-(dc * dc) / (0.05 * 0.05));
      px[(y * 64 + x) * 4] = Math.log2(L);
    }
  }
  return px;
}

/** EV trace (one sample per 30 fps frame) over `secs` with readings drawn from frameAt(reading index). */
async function evTrace(frameAt: (k: number) => Float32Array, secs: number, settle = 20): Promise<number[]> {
  const pending: Array<() => void> = [];
  let k = 0;
  const r = {
    toneMappingExposure: 1,
    getRenderTarget: () => null,
    setRenderTarget: () => {},
    render: () => {},
    readRenderTargetPixelsAsync: () => {
      const f = frameAt(k++);
      return new Promise((res) => pending.push(() => res(f)));
    },
  };
  const ae = new AutoExposure(r, new THREE.Texture(), { value: 1 });
  const cam = new THREE.Vector3();
  const evs: number[] = [];
  for (let i = 0; i < Math.round((settle + secs) * 30); i++) {
    ae.update(1 / 30, 0, cam, 4);
    for (const f of pending.splice(0)) f();
    await new Promise((res) => setTimeout(res, 0));
    if (i >= settle * 30) evs.push(ae.ev);
  }
  ae.dispose();
  return evs;
}
const p2p = (a: number[]) => Math.max(...a) - Math.min(...a);

test('standing still at a torch-lit wall: a core drifting on the fixation disk edge does not make the exposure breathe', async () => {
  reset();
  try {
    // the core drifts in and out of the 0.15 disk (idle sway + grain on the 64×64 grid; verify runB2 U4T: the target
    // toggled −2.00 ↔ −3.98 every 1–3 s): runs of 2–16 readings (0.5–4 s) on the gaze (0.5) or 0.19 off it (0.69)
    const run = async (hyst: number) => {
      LOOK.fixHyst = hyst;
      const r = rng(7);
      let inside = true;
      let left = 0;
      return evTrace(() => {
        if (left-- <= 0) {
          inside = !inside;
          left = 2 + Math.floor(r() * 15);
        }
        return wallFrame(inside ? 0.5 : 0.69);
      }, 13);
    };
    const evOld = await run(1);
    const evNew = await run(DEFAULTS.fixHyst);
    assert.ok(p2p(evOld) > 0.5, `the old single-disk protect breathes (p2p ${p2p(evOld).toFixed(2)} EV) — the case is reproduced`);
    assert.ok(p2p(evNew) < 0.2, `with the hysteresis: p2p ${p2p(evNew).toFixed(2)} EV over 13 s (old ${p2p(evOld).toFixed(2)})`);
    // a steady core on the gaze: exactly the old exposure (the wide disk keeps the same top-texel count)
    LOOK.fixHyst = 1;
    const steadyOld = await evTrace(() => wallFrame(0.5), 3);
    LOOK.fixHyst = DEFAULTS.fixHyst;
    const steadyNew = await evTrace(() => wallFrame(0.5), 3);
    assert.ok(Math.abs(steadyOld[steadyOld.length - 1] - steadyNew[steadyNew.length - 1]) < 0.02, `a steady subject: unchanged (${steadyOld[steadyOld.length - 1].toFixed(3)} vs ${steadyNew[steadyNew.length - 1].toFixed(3)})`);
  } finally {
    reset();
  }
});

test('the engaged fixation protect still lets go at once when the subject leaves the centre', async () => {
  reset();
  try {
    // 6 s on the core, then it moves far off the centre (0.35: you look away from the hot spot)
    const trace = async (hyst: number) => {
      LOOK.fixHyst = hyst;
      return evTrace((k) => wallFrame(k < 24 ? 0.5 : 0.85), 16, 0);
    };
    const ref = await trace(1);
    const evs = await trace(DEFAULTS.fixHyst);
    const at = (a: number[], s: number) => a[Math.round(s * 30)];
    assert.ok(at(evs, 15.5) > at(evs, 5.9) + 0.5, `brightens after the subject leaves (${at(evs, 5.9).toFixed(2)} → ${at(evs, 15.5).toFixed(2)})`);
    for (const t of [7, 10, 15.5]) assert.ok(Math.abs(at(evs, t) - at(ref, t)) < 0.02, `released like the old protect at ${t} s (${at(evs, t).toFixed(2)} vs ${at(ref, t).toFixed(2)})`);
  } finally {
    reset();
  }
});

/** wallFrame with the core and spill scaled by 2^ev (the hot core's reading-to-reading jitter, a real brightness step). */
function wallFrameEV(cy: number, ev: number): Float32Array {
  const px = wallFrame(cy);
  const base = wallFrame(cy);
  for (let i = 0; i < 64 * 64; i++) {
    // scale the torch-lit part only (the room level −7 stays): L' = room + (L − room)·2^ev
    const L = Math.pow(2, base[i * 4]);
    const room = Math.pow(2, -7);
    px[i * 4] = Math.log2(room + Math.max(0, L - room) * Math.pow(2, ev));
  }
  return px;
}

test('the meter noise gate: reading-to-reading jitter no longer ripples the exposure; real changes still pass', async () => {
  reset();
  try {
    // ±0.3 EV random jitter of the torch-lit wall per reading (the protects' percentile noise measured in M1/T1)
    const run = async (tau: number, frameAt: (k: number) => Float32Array, secs = 12) => {
      LOOK.meterNoiseTau = tau;
      return evTrace(frameAt, secs);
    };
    const r1 = rng(11);
    const jitter: number[] = Array.from({ length: 400 }, () => (r1() * 2 - 1) * 0.3);
    const evOff = await run(0, (k) => wallFrameEV(0.5, jitter[k % 400]));
    const evOn = await run(DEFAULTS.meterNoiseTau, (k) => wallFrameEV(0.5, jitter[k % 400]));
    assert.ok(p2p(evOn) < 0.7 * p2p(evOff), `jitter ripple p2p ${p2p(evOff).toFixed(3)} → ${p2p(evOn).toFixed(3)} EV`);
    // a real 2 EV step (a lamp, the torch on a near wall) passes at once: within 0.1 EV of the ungated meter 0.5 s on
    const step = (k: number) => wallFrameEV(0.5, k < 40 ? 0 : 2);
    const sOff = await run(0, step, 14);
    const sOn = await run(DEFAULTS.meterNoiseTau, step, 14);
    const at = (a: number[], s: number) => a[Math.round(s * 30)];
    // readings every 0.25 s from the start of the trace window (settle 20 s) → the step lands at 10 s + readback
    for (const t of [10.5, 11, 13]) assert.ok(Math.abs(at(sOn, t) - at(sOff, t)) < 0.1, `2 EV step at ${t} s: gated ${at(sOn, t).toFixed(2)} vs ungated ${at(sOff, t).toFixed(2)}`);
    // a small real step (0.3 EV darker scene → brighter target) still converges, a little later
    const small = (k: number) => wallFrameEV(0.5, k < 40 ? 0 : -0.3);
    const mOff = await run(0, small, 14);
    const mOn = await run(DEFAULTS.meterNoiseTau, small, 14);
    assert.ok(Math.abs(at(mOn, 13.9) - at(mOff, 13.9)) < 0.08, `0.3 EV step converges (${at(mOn, 13.9).toFixed(3)} vs ${at(mOff, 13.9).toFixed(3)})`);
  } finally {
    reset();
  }
});
