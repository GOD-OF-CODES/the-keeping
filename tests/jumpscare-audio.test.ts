// JUMPSCARE (#147m): the catch sting's levels (docs/STATUS-jumpscare.md Spec §6). Pure TS (no Web Audio): the bank's
// render step (renderRecipe → peak-normalised to the recipe level), then the default playback chain the engine applies
// (Recipe.playGain × the player bus' −2 dB trim × master volume 0.9² → the master limiter −3 dBFS / 20:1 / 2 ms attack /
// 200 ms release), measured with ITU-R BS.1770-4 K-weighting (EBU R128 momentary = 400 ms, short-term = 3 s).
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
import { getRecipe } from '../src/audio/synth/index.ts';
import { renderRecipe, MAX_PEAK } from '../src/audio/synth/render.ts';
import { SCARE_SHRIEK_S, SCARE_STING_PLAY_GAIN, SCARE_STING_S, SCARE_WHOOSH_S } from '../src/audio/synth/scare.ts';

const SR = 48000; // the BS.1770 filter coefficients below are the standard's 48 kHz ones

/** BS.1770-4 K-weighting at 48 kHz: stage 1 high shelf (+4 dB above ~1.7 kHz), stage 2 RLB high-pass (38 Hz). */
function kWeight(x: Float32Array): Float64Array {
  const st = (b: number[], a: number[], inp: ArrayLike<number>) => {
    const y = new Float64Array(inp.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < inp.length; i++) {
      const v = inp[i];
      const o = b[0] * v + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = o;
      y[i] = o;
    }
    return y;
  };
  const s1 = st([1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585], x);
  return st([1, -2, 1], [1, -1.99004745483398, 0.99007225036621], s1);
}

/** Loudness (LUFS) of [a, b) s over K-weighted channels (channel weights 1: L/R). */
function lufs(kw: Float64Array[], a: number, b: number): number {
  const i0 = Math.max(0, Math.floor(a * SR));
  const i1 = Math.min(kw[0].length, Math.floor(b * SR));
  let z = 0;
  for (const c of kw) {
    let s = 0;
    for (let i = i0; i < i1; i++) s += c[i] * c[i];
    z += s / Math.max(1, i1 - i0);
  }
  return -0.691 + 10 * Math.log10(Math.max(1e-20, z));
}

/** The engine's default chain + a feed-forward model of the master DynamicsCompressor (knee 0, peak detector). */
function chain(chs: Float32Array[], gain: number): { out: Float32Array[]; grMaxDb: number } {
  const T = -3;
  const R = 20;
  const att = Math.exp(-1 / (SR * 0.002));
  const rel = Math.exp(-1 / (SR * 0.2));
  const n = chs[0].length;
  const out = chs.map(() => new Float32Array(n));
  let env = 0;
  let grMax = 0;
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const c of chs) p = Math.max(p, Math.abs(c[i] * gain));
    env = p > env ? att * env + (1 - att) * p : rel * env + (1 - rel) * p;
    const lv = 20 * Math.log10(Math.max(1e-9, env));
    const gr = lv > T ? (lv - T) * (1 - 1 / R) : 0;
    grMax = Math.max(grMax, gr);
    const g = gain * Math.pow(10, -gr / 20);
    chs.forEach((c, k) => (out[k][i] = c[i] * g));
  }
  return { out, grMaxDb: grMax };
}

/** Player bus (−2 dB trim, sfx volume 1) × master 0.9² (volumeCurve) — the default Settings. */
/** The C2 strike's momentary loudness measured in the real C2 (#132, docs/STATUS-jumpscare.md Spec §6). */
const C2_STRIKE_M = -13.7;
const PLAYER_CHAIN = Math.pow(10, -2 / 20) * 0.9 * 0.9;
const SFX_CHAIN = 0.9 * 0.9;

function stats(id: string, variant: number) {
  const r = getRecipe(id);
  const out = renderRecipe(r, SR, variant).channels;
  let pk = 0;
  let run = 0;
  let maxRun = 0;
  let dc = 0;
  for (const c of out) {
    let s = 0;
    run = 0;
    for (let i = 0; i < c.length; i++) {
      const a = Math.abs(c[i]);
      pk = Math.max(pk, a);
      run = a >= 0.89 ? run + 1 : 0;
      maxRun = Math.max(maxRun, run);
      s += c[i];
    }
    dc = Math.max(dc, Math.abs(s / c.length));
  }
  return { r, out, pk, maxRun, dc };
}

test('scare_sting: buffer peak ≤ −1 dBFS, no flat-topped clip runs, no DC, 2.05 s stereo', () => {
  for (let v = 0; v < getRecipe('scare_sting').variants; v++) {
    const { out, pk, maxRun, dc } = stats('scare_sting', v);
    assert.equal(out.length, 2, 'stereo');
    assert.ok(Math.abs(out[0].length / SR - SCARE_STING_S) < 0.02, `length ${out[0].length / SR}`);
    assert.ok(pk <= MAX_PEAK + 1e-6, `v${v} peak ${pk}`);
    assert.ok(maxRun <= 2, `v${v}: a run of ${maxRun} samples ≥ 0.89 (a flat-topped clip)`);
    assert.ok(dc < 0.002, `v${v} DC ${dc}`);
  }
});

test('scare_sting: the shriek stops with the clip (1.0 s) and the low hit has rung out by ~1.65 s', () => {
  const { out } = stats('scare_sting', 0);
  const kw = out.map((c) => kWeight(c));
  const during = lufs(kw, 0.6, 0.95);
  const after = lufs(kw, 1.05, 1.4); // the low hit only (K-weighting rolls the sub off)
  const tail = lufs(kw, 1.7, SCARE_STING_S - 0.02);
  assert.ok(during - after > 12, `the shriek must stop at ${SCARE_SHRIEK_S} s: ${during.toFixed(1)} → ${after.toFixed(1)} LUFS`);
  assert.ok(tail < during - 30, `the ring dies by 1.7 s (${tail.toFixed(1)} vs ${during.toFixed(1)})`);
});

test('scare_sting through the default chain: momentary −10 ± 1 LUFS on the cut, ≤ 3 dB limiter gain reduction', () => {
  const ref = stats('cleaver_sever', 0);
  const refOut = chain(ref.out, (ref.r.playGain ?? 1) * SFX_CHAIN);
  const refM = Math.max(...[0, 0.1, 0.2, 0.3].map((a) => lufs(refOut.out.map((c) => kWeight(c)), a, a + 0.4)));
  for (let v = 0; v < getRecipe('scare_sting').variants; v++) {
    const { r, out } = stats('scare_sting', v);
    assert.equal(r.playGain, SCARE_STING_PLAY_GAIN);
    const { out: o, grMaxDb } = chain(out, SCARE_STING_PLAY_GAIN * PLAYER_CHAIN);
    const kw = o.map((c) => kWeight(c));
    const m0 = lufs(kw, 0, 0.4);
    let mMax = -99;
    for (let a = 0; a <= 0.6 + 1e-9; a += 0.01) mMax = Math.max(mMax, lufs(kw, a, a + 0.4));
    const s3 = lufs(kw, 0, 3);
    let opk = 0;
    for (const c of o) for (let i = 0; i < c.length; i++) opk = Math.max(opk, Math.abs(c[i]));
    console.log(`scare_sting v${v}: M[0,0.4] ${m0.toFixed(2)} LUFS, M max ${mMax.toFixed(2)}, S(3 s) ${s3.toFixed(2)}, GR ${grMaxDb.toFixed(2)} dB, out peak ${(20 * Math.log10(opk)).toFixed(2)} dBFS (cleaver_sever M max ${refM.toFixed(2)})`);
    assert.ok(Math.abs(m0 + 10) <= 1, `v${v}: momentary on the cut ${m0.toFixed(2)} LUFS (target −10 ± 1)`);
    assert.ok(grMaxDb <= 3, `v${v}: limiter gain reduction ${grMaxDb.toFixed(2)} dB`);
    assert.ok(opk <= Math.pow(10, -1 / 20), `v${v}: output peak ${opk}`);
    // the loudest moment of the game: ≥ 3 LU over the C2 strike as MEASURED in the game (#132: −13.7 LUFS momentary at
    // the camera; the cleaver is positional, −9 dB at 2.7 m — the non-positional render above is logged for reference)
    assert.ok(m0 >= C2_STRIKE_M + 3, `v${v}: ${m0.toFixed(2)} LUFS vs the C2 strike ${C2_STRIKE_M}`);
  }
});

test('scare_whoosh: 0.15 s, rising, ends at full level (abrupt), under the sting', () => {
  const { out, pk } = stats('scare_whoosh', 0);
  assert.equal(out.length, 2);
  assert.ok(Math.abs(out[0].length / SR - SCARE_WHOOSH_S) < 0.005, `length ${out[0].length / SR}`);
  assert.ok(pk <= 0.5 + 1e-6);
  const kw = out.map((c) => kWeight(c));
  const a = lufs(kw, 0, 0.05);
  const b = lufs(kw, 0.1, 0.14);
  assert.ok(b - a > 8, `swell ${a.toFixed(1)} → ${b.toFixed(1)}`);
});
