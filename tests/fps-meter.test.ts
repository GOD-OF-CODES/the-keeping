// FPS meter (src/core/fps-meter.ts): rolling average, 1% low, p99.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import { FpsMeter } from '../src/core/fps-meter.ts';

const near = (a: number, e: number, tol: number, msg: string) => assert.ok(Math.abs(a - e) <= tol, `${msg}: expected ≈${e}, got ${a}`);

test('empty meter reports zeros (never NaN)', () => {
  const m = new FpsMeter();
  const s = m.stats();
  assert.equal(s.avg, 0);
  assert.equal(s.low1, 0);
  assert.equal(s.p99, 0);
  m.frame(1000); // a single frame has no delta yet
  assert.equal(m.stats().avg, 0);
});

test('steady 60 fps', () => {
  const m = new FpsMeter();
  for (let k = 0; k <= 600; k++) m.frame(k * (1000 / 60));
  const s = m.stats();
  near(s.avg, 60, 0.5, 'avg');
  near(s.low1, 60, 0.5, '1% low');
  near(s.p99, 60, 0.5, 'p99');
  near(s.avgMs, 16.67, 0.05, 'avg ms');
});

test('1% low and p99 catch rare hitches that the average hides', () => {
  const m = new FpsMeter();
  let t = 0;
  // 1000 frames: every 100th frame takes 50 ms (1%), the rest 16.67 ms.
  for (let k = 0; k < 1000; k++) {
    t += k % 100 === 99 ? 50 : 1000 / 60;
    m.frame(t);
  }
  const s = m.stats();
  assert.ok(s.avg > 55, `avg stays high (${s.avg})`);
  near(s.low1, 20, 0.5, '1% low = mean of the slowest 1% (50 ms)');
  assert.ok(s.p99 <= 60.5 && s.p99 >= 19.5, `p99 in range (${s.p99})`);
});

test('rolling average follows a rate change within ~1 s', () => {
  const m = new FpsMeter();
  let t = 0;
  for (let k = 0; k < 300; k++) m.frame((t += 1000 / 60));
  for (let k = 0; k < 40; k++) m.frame((t += 1000 / 30));
  near(m.stats().avg, 30, 1, 'avg after 1.3 s at 30 fps');
});

test('ignores pauses (> 500 ms) and non-monotonic timestamps; reset() empties', () => {
  const m = new FpsMeter();
  m.frame(0);
  m.frame(16);
  m.frame(5000); // tab was hidden
  m.frame(4990); // clock went backwards
  m.frame(5006.67);
  assert.equal(m.count, 2);
  m.reset();
  assert.equal(m.count, 0);
  assert.equal(m.stats().avg, 0);
});
