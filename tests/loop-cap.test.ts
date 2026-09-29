// Frame-cap math (src/core/loop.ts FrameCap): 30/60/uncapped at 60/120/144 Hz, divisor mode, stall resync.
// node:test is loaded dynamically because the project has no @types/node (typecheck must still pass).
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import { FrameCap } from '../src/core/loop.ts';
import type { FpsCap } from '../src/shared/types.ts';

/** Simulates `seconds` of rAF callbacks at `hz` (optional ±jitter ms) and returns rendered frames per second. */
function simulate(hz: number, cap: FpsCap, divisor: boolean, seconds = 4, jitter = 0, warm = 1): { fps: number; cap: FrameCap } {
  const fc = new FrameCap();
  const vsync = 1000 / hz;
  let rendered = 0;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const total = Math.round((seconds + warm) * hz);
  for (let k = 0; k < total; k++) {
    const t = 1000 + k * vsync + (jitter ? rnd() * jitter : 0);
    const r = fc.shouldRender(t, cap, divisor);
    if (k >= warm * hz && r) rendered++;
  }
  return { fps: rendered / seconds, cap: fc };
}

const near = (actual: number, expected: number, tol: number, msg: string) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: expected ≈${expected}, got ${actual.toFixed(2)}`);

test('uncapped renders every vsync at 60/120/144 Hz', () => {
  for (const hz of [60, 120, 144]) near(simulate(hz, 0, false).fps, hz, 0.5, `${hz} Hz uncapped`);
});

test('cap 30 and 60 (plain mode) at 60/120/144 Hz', () => {
  near(simulate(60, 30, false).fps, 30, 0.5, '60 Hz cap 30');
  near(simulate(60, 60, false).fps, 60, 0.5, '60 Hz cap 60');
  near(simulate(120, 30, false).fps, 30, 0.5, '120 Hz cap 30');
  near(simulate(120, 60, false).fps, 60, 0.5, '120 Hz cap 60');
  // 144 is not a multiple of 60: frames alternate 2/3 vsyncs but the average holds the cap.
  near(simulate(144, 60, false).fps, 60, 1, '144 Hz cap 60');
  near(simulate(144, 30, false).fps, 30, 1, '144 Hz cap 30');
});

test('rAF jitter (±2 ms) never halves the rate', () => {
  near(simulate(60, 60, false, 4, 2).fps, 60, 1, '60 Hz cap 60 jitter');
  near(simulate(120, 60, false, 4, 2).fps, 60, 1, '120 Hz cap 60 jitter');
  near(simulate(60, 30, false, 4, 2).fps, 30, 1, '60 Hz cap 30 jitter');
});

test('divisor mode: cap = refresh / round(refresh / requested)', () => {
  near(simulate(144, 60, true).fps, 72, 1, '144 Hz cap 60 divisor → 72');
  near(simulate(144, 30, true).fps, 28.8, 1, '144 Hz cap 30 divisor → 28.8');
  near(simulate(120, 60, true).fps, 60, 0.5, '120 Hz cap 60 divisor');
  near(simulate(60, 30, true).fps, 30, 0.5, '60 Hz cap 30 divisor');
  near(simulate(60, 60, true).fps, 60, 0.5, '60 Hz cap 60 divisor');
  const { cap } = simulate(144, 60, true);
  near(cap.effectiveCap(60, true), 72, 0.5, 'effectiveCap(60) at 144 Hz');
  near(cap.effectiveCap(30, true), 28.8, 0.5, 'effectiveCap(30) at 144 Hz');
  assert.equal(cap.effectiveCap(60, false), 60);
  assert.equal(cap.effectiveCap(0, true), 0);
});

test('vsync estimate converges to the display interval', () => {
  for (const hz of [60, 120, 144]) near(simulate(hz, 60, false).cap.refreshHz, hz, 1, `${hz} Hz estimate`);
});

test('stall: resync without a catch-up burst', () => {
  const fc = new FrameCap();
  const vsync = 1000 / 60;
  let t = 0;
  for (let k = 0; k < 120; k++) fc.shouldRender((t = k * vsync), 30, false);
  // 2 s stall (tab switch / long task), then resume at 60 Hz.
  const resume = t + 2000;
  const after: boolean[] = [];
  for (let k = 0; k < 12; k++) after.push(fc.shouldRender(resume + k * vsync, 30, false));
  assert.equal(after[0], true, 'renders on return');
  // Never two consecutive renders at cap 30 / 60 Hz (a burst would render every vsync).
  for (let k = 1; k < after.length; k++) assert.ok(!(after[k] && after[k - 1]), `burst at vsync ${k}: ${after.join(',')}`);
  const count = after.filter(Boolean).length;
  assert.ok(count >= 5 && count <= 7, `≈6 frames in 12 vsyncs after resync, got ${count}`);
});

test('reset() clears timing state', () => {
  const fc = new FrameCap();
  for (let k = 0; k < 60; k++) fc.shouldRender(k * 16.67, 60, false);
  fc.reset();
  assert.equal(fc.shouldRender(100000, 30, false), true);
});
