// PERF round 2 (#150): which lights can reach a character (src/render/char-light-select.ts) — a closed gate must belong
// to a light that adds exactly nothing to any character pixel (dark, beyond its cutoff, a grid beyond its falloff).
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
import { boxDistance, gridReaches, reachOf, type LightCand } from '../src/render/char-light-select.ts';

const L = (x: number, y: number, z: number, intensity: number, distance = 4.5, decay = 2): LightCand => ({ x, y, z, intensity, distance, decay });
// C2 tableau, WORLD (x, y up, z = −plan y): Ada on the table ≈ plan (5.9, 3.3), Harlan ≈ (5.15, 3.95) (lightab chars)
const ada = { x: 5.93, y: 0.9, z: -3.3, r: 1.5 };
const harlan = { x: 5.15, y: 1.0, z: -3.95, r: 1.2 };

test('three falloff: exactly 0 at / beyond the cutoff and for a dark light, > 0 inside', () => {
  assert.equal(reachOf(L(0, 1, 0, 1, 4.5), [{ x: 6, y: 1, z: 0, r: 1.5 }]), 0, 'd = 4.5 = cutoff');
  assert.ok(reachOf(L(0, 1, 0, 1, 4.5), [{ x: 5.9, y: 1, z: 0, r: 1.5 }]) > 0);
  assert.equal(reachOf(L(0, 1, 0, 0, 4.5), [{ x: 1, y: 1, z: 0, r: 1 }]), 0, 'intensity 0');
  const inside = reachOf(L(0, 1, 0, 2, 4.5), [{ x: 0.5, y: 1, z: 0, r: 1 }]);
  assert.equal(inside, 2 / 0.01, 'inside the sphere: d clamps to 0 → max(d^decay, 0.01) as in three');
  assert.ok(reachOf(L(0, 1, 0, 1, 0), [{ x: 100, y: 1, z: 0, r: 1 }]) > 0, 'cutoff 0 = infinite range');
  assert.equal(reachOf(L(0, 1, 0, 1, 4.5), []), 0, 'no subject: nothing to light');
});

test('C2 parlor: the candles in reach stay open; the kitchen (7 m), a faded landing candle and the gate lantern close', () => {
  const pool = [
    L(5.6, 1.58, -2.3, 1.1), // L_CANDLE_TABLE
    L(8.6, 2.04, -3.4, 0.9), // L_CANDLE_MANTEL
    L(5.0, 1.5, -0.18, 0.9), // L_CANDLE_SILL
    L(3.4, 1.6, -4.5, 1.0), // L_CANDLE_HALL (through the door)
    L(6.75, 1.46, -9.6, 0.5), // L_CANDLE_KITCHEN: beyond its 4.5 m cutoff of both figures
    L(1.2, 5.43, -4.6, 0), // L_CANDLE_LANDING: another floor → faded to 0 by RuntimeLights
    L(-1.8, 2.15, 28.45, 12, 7), // L_LANTERN at the gate
  ];
  const open = pool.map((c) => reachOf(c, [ada, harlan]) > 0);
  assert.deepEqual(open, [true, true, true, true, false, false, false]);
});

test('probe grids: closed only beyond box + falloff, or dark; falloff 0 applies everywhere', () => {
  const box = { min: { x: 0, y: 0, z: -10 }, max: { x: 10, y: 3, z: 0 } };
  assert.equal(boxDistance(box, 5, 1, -5), 0);
  assert.equal(boxDistance(box, 13, 1, -5), 3);
  assert.ok(gridReaches(box, 0.35, 1, [{ x: 5, y: 1, z: -5, r: 1 }]), 'inside');
  assert.ok(gridReaches(box, 0.35, 1, [{ x: 11.2, y: 1, z: -5, r: 1 }]), '1.2 m out, r 1 → 0.2 m < falloff');
  assert.equal(gridReaches(box, 0.35, 1, [{ x: 11.4, y: 1, z: -5, r: 1 }]), false, '0.4 m beyond: weight exactly 0');
  assert.equal(gridReaches(box, 0.35, 0, [{ x: 5, y: 1, z: -5, r: 1 }]), false, 'intensity 0');
  assert.ok(gridReaches(box, 0, 1, [{ x: 500, y: 1, z: -5, r: 1 }]), 'falloff 0: everywhere');
  // the upper floor's grid (≈ y 2.9–5.9) from the parlor tableau: Ada's sphere top ≈ 2.4 m → 0.5 m below → closed
  const upper = { min: { x: 0, y: 2.9, z: -12 }, max: { x: 12, y: 5.9, z: 0 } };
  assert.equal(gridReaches(upper, 0.35, 1, [ada, harlan]), false);
});
