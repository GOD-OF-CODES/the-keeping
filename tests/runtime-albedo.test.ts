// FINAL #153d (LEAD RULING (bf), R2-2): runtime-only colour targets (src/materials/albedo-check.ts RUNTIME_BLUE_RED),
// used by bind.ts instead of material-spec.json's avgAlbedo for the shader (the spec keys the shipped probes).
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import { RUNTIME_BLUE_RED, desaturateToBlueRed, runtimeAlbedo } from '../src/materials/albedo-check.ts';
import { specById } from '../src/materials/spec-index.ts';

const Y = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

test('brass_tarnished: same luminance, b/r 0.46 (was 0.29), never more saturated', () => {
  const spec = specById('brass_tarnished');
  assert.ok(spec, 'spec exists');
  const avg = spec!.avgAlbedo;
  const c = runtimeAlbedo('brass_tarnished', avg);
  assert.ok(Math.abs(Y(c) - Y(avg)) < 1e-9, `luminance kept (${Y(c)} vs ${Y(avg)})`);
  assert.ok(Math.abs(c[2] / c[0] - RUNTIME_BLUE_RED.brass_tarnished) < 1e-9, `b/r ${c[2] / c[0]}`);
  assert.ok(c[0] < avg[0] && c[2] > avg[2] && c[0] >= c[1] && c[1] >= c[2], `still a warm metal, less saturated: ${c}`);
});

test('other specs keep their avgAlbedo; desaturation clamps to [0, 1] of the way to grey', () => {
  assert.deepEqual(runtimeAlbedo('plaster_aged', [0.6, 0.58, 0.55]), [0.6, 0.58, 0.55]);
  const grey = desaturateToBlueRed([0.4, 0.4, 0.4], 0.46); // already grey: no change
  assert.ok(grey.every((v) => Math.abs(v - 0.4) < 1e-9));
  const sat = desaturateToBlueRed([0.4, 0.3, 0.3], 0.5); // b/r 0.75 > 0.5: would need MORE saturation → k clamps at 1
  assert.deepEqual(sat.map((v) => +v.toFixed(9)), [0.4, 0.3, 0.3]);
});
