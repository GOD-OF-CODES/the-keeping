// PERF round 2 (#150, ROADMAP ruling (aq)): the cutscene hold = min(gameplay scale, a per-cutscene cap) ≥ the dynres
// floor, applied as an internal-pixel budget; the missed-vsync guard (> 5 % of 1 s → −0.05, never below the floor).
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
import { CAP_REF_PIXELS, CUTSCENE_CAP, CutsceneProfile, HITCH_MS, MISS_STEP, capScaleFor } from '../src/render/cutscene-profile.ts';
import { PRESETS, dynResFor } from '../src/render/presets.ts';

const CAPS = { low: {}, medium: { C2: 0.7, C2c: 0.8, C5: 0.5 }, max: { C2: 0.9 } } as const;
const at = (px = CAP_REF_PIXELS) => ({ floor: 0.6, outputPixels: () => px, caps: CAPS });
/** One 1 s window at 60 Hz with `miss` of its 60 frames at 33.4 ms (a missed vsync). */
const windowOf = (p: any, miss: number, targetMs?: number): Array<number | null> => {
  const out: Array<number | null> = [];
  let ms = 0;
  for (let i = 0; ms < 1000; i++) {
    const f = i < miss ? 33.4 : 16.7;
    ms += f;
    out.push(p.frame(f, targetMs));
  }
  return out;
};

test('cap scale = the measured scale at the reference output, the same pixel budget on larger buffers', () => {
  assert.equal(capScaleFor('medium', 'C2', CAP_REF_PIXELS, CAPS as any), 0.7);
  // a 1440×900 Retina window on Medium (pixel ratio 1): 1.27× the pixels → 0.7 / √1.27
  assert.equal(capScaleFor('medium', 'C2', 1440 * 900, CAPS as any), Math.round(0.7 * Math.sqrt(CAP_REF_PIXELS / (1440 * 900)) * 1000) / 1000);
  // Max at pixel ratio 1.5 on the same window: 2.25× Medium's pixels
  const s = capScaleFor('max', 'C2', 1440 * 900 * 2.25, CAPS as any)!;
  assert.ok(Math.abs(s * s * 1440 * 900 * 2.25 - 0.81 * CAP_REF_PIXELS) < 2000, 'same internal pixel count');
  assert.equal(capScaleFor('medium', 'C9', CAP_REF_PIXELS, CAPS as any), null, 'unmeasured cutscene: no cap');
  assert.equal(capScaleFor('low', 'C2', CAP_REF_PIXELS, CAPS as any), null);
  assert.equal(capScaleFor('medium', null, CAP_REF_PIXELS, CAPS as any), null);
});

test('the shipped caps never ask for less than the preset floors at the reference output', () => {
  for (const v of Object.values(CUTSCENE_CAP.medium)) assert.ok(v >= 0.6 && v <= 0.85, `medium cap ${v} inside dynres 0.6–0.85`);
  for (const v of Object.values(CUTSCENE_CAP.max)) assert.ok(v >= 0.85 && v <= 1, `max cap ${v} inside dynres 0.85–1 (DPR 1 floor)`);
  assert.equal(Object.keys(CUTSCENE_CAP.low).length, 0, 'Low has no post pipeline (scale fixed at 1)');
});

test('hold = min(gameplay, cap): a high gameplay scale is capped, a lower one kept, restored at the end', () => {
  const p = new CutsceneProfile('medium', null, at());
  assert.equal(p.begin(0.85, 'C2'), 0.7, 'C2 held at its cap, not the 0.85 the B03 hall reached');
  assert.equal(p.scale, 0.7);
  assert.equal(p.end(), 0.85, 'gameplay scale back');
  assert.equal(p.begin(0.65, 'C2'), null, 'below the cap: the gameplay scale is kept');
  assert.equal(p.end(), null);
  assert.equal(p.begin(0.85, 'C9'), null, 'no cap measured: the gameplay scale (pre-(aq) hold)');
  assert.equal(p.end(), null);
});

test('never below the dynres floor, and pixel caps follow the drawing buffer', () => {
  const p = new CutsceneProfile('medium', null, at());
  assert.equal(p.begin(0.85, 'C5'), 0.6, 'a 0.5 cap is clamped to the 0.6 floor');
  p.end();
  const q = new CutsceneProfile('medium', null, at(CAP_REF_PIXELS * 1.44));
  assert.equal(q.begin(0.85, 'C2'), Math.round((0.7 / 1.2) * 1000) / 1000 < 0.6 ? 0.6 : Math.round((0.7 / 1.2) * 1000) / 1000);
});

test('a chained cutscene re-applies its own cap at the cut; the same id changes nothing', () => {
  const p = new CutsceneProfile('medium', null, at());
  assert.equal(p.begin(0.85, 'C2'), 0.7);
  assert.equal(p.cut('C2'), null);
  assert.equal(p.cut('C2c'), 0.8, 'C2c: its own (higher) cap, still ≤ gameplay');
  assert.equal(p.id, 'C2c');
  assert.equal(p.cut('C9'), 0.85, 'unmeasured: the gameplay scale');
  assert.equal(p.end(), null, 'already at the gameplay scale');
});

test('missed-vsync guard: > 5 % of a 1 s window steps down 0.05 per window down to the floor, never up', () => {
  const p = new CutsceneProfile('medium', null, at());
  p.begin(0.85, 'C2c'); // 0.8
  let r = windowOf(p, 6); // 6 of ≈ 50 frames = 12 %
  assert.equal(r.filter((x) => x !== null).length, 1, 'one step per window');
  assert.equal(r[r.length - 1], 0.75);
  assert.equal(p.lastStep, 'miss');
  assert.ok(p.lastWindow!.missRate > 0.05);
  r = windowOf(p, 6);
  assert.equal(r[r.length - 1], 0.7);
  r = windowOf(p, 6);
  assert.equal(r[r.length - 1], 0.65);
  r = windowOf(p, 6);
  assert.equal(r[r.length - 1], 0.6);
  r = windowOf(p, 30);
  assert.ok(r.every((x) => x === null), 'at the floor: no further step');
  assert.equal(p.scale, 0.6);
  r = windowOf(p, 0);
  assert.ok(r.every((x) => x === null), 'clean windows never step back up inside the cutscene');
  assert.equal(p.steps, 4);
  assert.equal(p.end(), 0.85);
});

test('missed-vsync guard: ≤ 5 % (a cut, a compile spike) never steps; stalls > HITCH_MS are ignored', () => {
  const p = new CutsceneProfile('medium', null, at());
  p.begin(0.85, 'C2');
  let r = windowOf(p, 2); // 2 of ≈ 59 = 3.4 %
  assert.ok(r.every((x) => x === null));
  for (let i = 0; i < 5; i++) assert.equal(p.frame(HITCH_MS + 100), null, 'a 350 ms compile stall is not load');
  r = windowOf(p, 0);
  assert.ok(r.every((x) => x === null));
  assert.equal(p.scale, 0.7);
  assert.equal(p.steps, 0);
});

test('missed-vsync guard follows the frame target: a 30 fps cap misses at > 40 ms, not at 33 ms', () => {
  const p = new CutsceneProfile('medium', null, at());
  p.begin(0.85, 'C2');
  let ms = 0;
  while (ms < 2000) {
    ms += 33.4;
    assert.equal(p.frame(33.4, 1000 / 30), null);
  }
  ms = 0;
  let step: number | null = null;
  for (let i = 0; ms < 1100 && step === null; i++) {
    const f = i % 10 === 0 ? 66.7 : 33.4; // every 10th frame misses its 30 fps slot (mean ≈ 36.7 ms < 40: no trip)
    ms += f;
    step = p.frame(f, 1000 / 30);
  }
  assert.equal(step, 0.65);
  assert.equal(p.lastStep, 'miss');
});

test('overload (> 40 ms average over 1 s) drops straight to the floor and trips once per cutscene', () => {
  const p = new CutsceneProfile('medium', null, at());
  p.begin(0.85, 'C2c');
  let back: number | null = null;
  for (let i = 0; i < 40 && back === null; i++) back = p.frame(60);
  assert.equal(back, 0.6);
  assert.ok(p.tripped && p.trips === 1 && p.lastStep === 'trip');
  for (let i = 0; i < 60; i++) assert.equal(p.frame(60), null);
  assert.equal(p.cut('C2'), 0.7, 'the next chained cutscene re-arms at its own cap');
  assert.equal(p.tripped, false);
  assert.equal(p.end(), 0.85);
});

test('the step size is the gameplay dynres step', () => {
  assert.equal(MISS_STEP, 0.05);
});

test('shipped caps: measured limits only (below the dynres max), on the 0.025 grid, ≥ the real preset floor at DPR 1', () => {
  for (const id of ['medium', 'max'] as const) {
    const dr = dynResFor(PRESETS[id], 1);
    for (const [cs, v] of Object.entries(CUTSCENE_CAP[id])) {
      assert.ok(v < dr.max, `${id} ${cs} ${v}: a cap at the dynres max is no measured limit (and would bind on larger buffers)`);
      assert.ok(v >= dr.min - 1e-9, `${id} ${cs} ${v} ≥ floor ${dr.min}`);
      assert.ok(Math.abs(v / 0.025 - Math.round(v / 0.025)) < 1e-6, `${id} ${cs} ${v} on the dynres grid`);
    }
  }
});

test('ruling (aq) with the shipped table and the real floors (1280×800, DPR 1)', () => {
  const mk = (id: 'medium' | 'max') => new CutsceneProfile(id, null, { floor: dynResFor(PRESETS[id], 1).min, outputPixels: () => CAP_REF_PIXELS });
  const mx = mk('max');
  // the real route reached 0.95 in the B03 hall on Max (STATUS-smooth-perf S9): C2 now holds its measured cap
  assert.equal(mx.begin(0.95, 'C2'), CUTSCENE_CAP.max.C2);
  assert.equal(mx.cut('C2c'), 0.95, 'C2c has no measured limit: back to the gameplay scale on its first frame');
  mx.end();
  // Max C6 cannot hold 60 above its floor: held at the floor (0.85 at DPR 1), never below
  assert.equal(mx.begin(1, 'C6'), 0.85);
  for (let w = 0; w < 3; w++) assert.ok(windowOf(mx, 10).every((x) => x === null), 'at the floor the guard has nothing left');
  mx.end();
  const md = mk('medium');
  assert.equal(md.begin(0.75, 'C2'), null, 'Medium C2: no measured limit at ≤ 0.85 — the gameplay scale is kept');
  md.end();
  assert.equal(md.begin(0.75, 'C7'), CUTSCENE_CAP.medium.C7);
  md.end();
});
