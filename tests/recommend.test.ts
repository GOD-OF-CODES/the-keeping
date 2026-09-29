// Preset recommender (src/boot/recommend.ts) + benchmark loop (src/boot/benchmark.ts): never NaN.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import { classifyGpu, recommend, scoreFromRaw, REF, THRESHOLDS } from '../src/boot/recommend.ts';
import { measureLoop } from '../src/boot/benchmark.ts';
import type { DeviceInfo } from '../src/shared/types.ts';

const M1_CHROME = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)';

function device(p: Partial<DeviceInfo> = {}): DeviceInfo {
  return {
    browser: 'chrome',
    webgl2: true,
    majorPerformanceCaveat: false,
    rendererString: M1_CHROME,
    vendorString: 'Google Inc. (Apple)',
    webgpu: { available: true, vendor: 'apple', architecture: 'metal-3', isFallbackAdapter: false },
    deviceMemoryGB: 8,
    hardwareConcurrency: 8,
    touchOnly: false,
    screen: { cssWidth: 1440, cssHeight: 900, dpr: 2, backingMegapixels: 5.18 },
    benchmarkScore: 100,
    benchmarkRaw: REF.chrome,
    ...p,
  };
}

test('dev M1 by name in Chrome → Medium, with a readable reason', () => {
  const r = recommend(device());
  assert.equal(r.preset, 'medium');
  assert.equal(r.gpuClass, 'apple-base');
  assert.equal(r.gpuLabel, 'Apple M1');
  assert.match(r.reason, /^Recommended: MEDIUM — Apple M1 GPU, 8 CPU threads, 1440×900 @2×, benchmark 100$/);
  // Medium by name regardless of the score.
  assert.equal(recommend(device({ benchmarkScore: 300 })).preset, 'medium');
  assert.equal(recommend(device({ benchmarkScore: null })).preset, 'medium');
});

test('Intel Iris Xe → Low; promoted to Medium only with score ≥ 120', () => {
  const iris = 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)';
  const r = recommend(device({ rendererString: iris, benchmarkScore: 90, webgpu: { available: true, vendor: 'intel', architecture: 'gen-12lp', isFallbackAdapter: false } }));
  assert.equal(r.preset, 'low');
  assert.equal(r.gpuClass, 'igpu-old');
  assert.equal(recommend(device({ rendererString: iris, benchmarkScore: 119 })).preset, 'low');
  assert.equal(recommend(device({ rendererString: iris, benchmarkScore: THRESHOLDS.IGPU_PROMOTE })).preset, 'medium');
  assert.equal(recommend(device({ rendererString: iris, benchmarkScore: null })).preset, 'low');
  assert.equal(recommend(device({ rendererString: 'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)', benchmarkScore: 40 })).preset, 'low');
});

test('RTX 3060 / 2070 / RX 6700 → Max; older dGPUs by score', () => {
  const rtx = recommend(device({ rendererString: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)', benchmarkScore: 150 }));
  assert.equal(rtx.preset, 'max');
  assert.equal(rtx.gpuClass, 'dgpu-high');
  assert.equal(recommend(device({ rendererString: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2070 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)' })).preset, 'max');
  assert.equal(recommend(device({ rendererString: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)' })).preset, 'max');
  assert.equal(classifyGpu('ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)').gpuClass, 'dgpu-mid');
  assert.equal(recommend(device({ rendererString: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Direct3D11 vs_5_0 ps_5_0, D3D11)', benchmarkScore: 120 })).preset, 'medium');
});

test('Apple Pro/Max/Ultra by name → Max', () => {
  for (const chip of ['Apple M1 Pro', 'Apple M2 Max', 'Apple M1 Ultra', 'Apple M3 Pro']) {
    const r = recommend(device({ rendererString: `ANGLE (Apple, ANGLE Metal Renderer: ${chip}, Unspecified Version)`, benchmarkScore: 90 }));
    assert.equal(r.preset, 'max', chip);
    assert.equal(r.gpuClass, 'apple-pro', chip);
  }
  for (const chip of ['Apple M2', 'Apple M3', 'Apple M4']) {
    assert.equal(recommend(device({ rendererString: `ANGLE (Apple, ANGLE Metal Renderer: ${chip}, Unspecified Version)` })).preset, 'medium', chip);
  }
});

test('masked strings (Safari, Firefox buckets) are decided by score thresholds', () => {
  const safari = (score: number | null) => recommend(device({ browser: 'safari', rendererString: 'Apple GPU', benchmarkScore: score, webgpu: { available: false, vendor: '', architecture: '', isFallbackAdapter: false } }));
  assert.equal(safari(100).preset, 'medium');
  assert.equal(safari(100).gpuClass, 'masked');
  assert.equal(safari(THRESHOLDS.LOW_MAX - 1).preset, 'low');
  assert.equal(safari(THRESHOLDS.LOW_MAX).preset, 'medium');
  assert.equal(safari(THRESHOLDS.MAX_MIN - 1).preset, 'medium');
  assert.equal(safari(THRESHOLDS.MAX_MIN).preset, 'max');
  assert.equal(safari(null).preset, 'medium', 'no score → Medium default');
  const ff = recommend(device({ browser: 'firefox', rendererString: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar', benchmarkScore: 250 }));
  assert.equal(ff.gpuClass, 'masked');
  assert.equal(ff.preset, 'max');
  assert.equal(recommend(device({ browser: 'firefox', rendererString: 'Apple M1, or similar', benchmarkScore: 40 })).preset, 'low');
  assert.equal(recommend(device({ browser: 'firefox', rendererString: 'Mozilla', benchmarkScore: 100 })).preset, 'medium');
  // Safari on an Intel Mac: WebGPU vendor is not "apple" → treated as Intel iGPU.
  assert.equal(recommend(device({ browser: 'safari', rendererString: 'Apple GPU', benchmarkScore: 100, webgpu: { available: true, vendor: 'intelr', architecture: 'intelr', isFallbackAdapter: false } })).preset, 'low');
});

test('software renderer, performance caveat, touch-only, low memory → Low', () => {
  assert.equal(recommend(device({ rendererString: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)' })).preset, 'low');
  assert.equal(recommend(device({ rendererString: 'llvmpipe (LLVM 15.0.7, 256 bits)' })).gpuClass, 'software');
  assert.equal(recommend(device({ webgpu: { available: true, vendor: 'google', architecture: 'swiftshader', isFallbackAdapter: true } })).preset, 'low');
  assert.equal(recommend(device({ majorPerformanceCaveat: true })).preset, 'low');
  assert.equal(recommend(device({ touchOnly: true })).preset, 'low');
  assert.equal(recommend(device({ deviceMemoryGB: 2 })).preset, 'low');
  assert.equal(recommend(device({ rendererString: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)', deviceMemoryGB: 4 })).preset, 'medium');
  assert.equal(recommend(device({ hardwareConcurrency: 2 })).preset, 'low');
});

test('scores are never NaN', () => {
  for (const raw of [NaN, Infinity, -1, 0, null, undefined]) assert.equal(scoreFromRaw(raw as number, 'chrome'), null, String(raw));
  const s = scoreFromRaw(REF.chrome, 'chrome');
  assert.equal(s, 100);
  for (const b of ['chrome', 'edge', 'safari', 'firefox', 'other'] as const) assert.ok(Number.isFinite(REF[b]) && REF[b] > 0, `REF.${b}`);
  const r = recommend(device({ benchmarkScore: NaN }));
  assert.ok(!/NaN/.test(r.reason), r.reason);
  assert.ok(!/NaN/.test(recommend(device({ rendererString: 'Apple GPU', benchmarkScore: NaN })).reason));
});

/** Fake clock + GPU for measureLoop. */
function fakeGpu(msPerDraw: number) {
  let clock = 0;
  let yields = 0;
  return {
    get yields() {
      return yields;
    },
    opts: {
      budgetMs: 1500,
      now: () => clock,
      yieldToEventLoop: async () => {
        yields++;
        clock += 0.2;
      },
      runBatch: (n: number) => {
        const dt = n * msPerDraw;
        clock += dt;
        return dt;
      },
    },
  };
}

test('benchmark: a very fast GPU (batch hits the cap) still records samples and yields', async () => {
  const g = fakeGpu(0.01); // 1024 draws = 10 ms < 40 ms target: the old loop returned NaN here
  const r = await measureLoop(g.opts);
  assert.ok(r.raw !== null && Number.isFinite(r.raw), `raw=${r.raw}`);
  assert.ok(r.samples > 5, `samples=${r.samples}`);
  assert.ok(g.yields > 10, 'yields between batches');
  assert.ok(Math.abs(r.medianDrawMs! - 0.01) < 1e-9);
});

test('benchmark: normal and very slow GPUs', async () => {
  const mid = await measureLoop(fakeGpu(0.2).opts);
  assert.ok(mid.raw !== null && Math.abs(mid.raw - (512 * 512 * 64) / 1e6 / 0.2) < 1e-6);
  const slow = await measureLoop(fakeGpu(80).opts); // single draw > 50 ms: stop immediately, still a number
  assert.ok(slow.raw !== null && Number.isFinite(slow.raw));
  assert.equal(slow.samples, 1);
});

test('benchmark: timer reporting 0 ms and a lost context never give NaN', async () => {
  let clock = 0;
  const zero = await measureLoop({ budgetMs: 1500, now: () => clock, yieldToEventLoop: async () => void (clock += 1), runBatch: () => 0 });
  assert.ok(zero.raw === null || Number.isFinite(zero.raw));
  const lost = await measureLoop({ budgetMs: 1500, now: () => 0, yieldToEventLoop: async () => {}, runBatch: () => 1, isLost: () => true });
  assert.equal(lost.raw, null);
});
