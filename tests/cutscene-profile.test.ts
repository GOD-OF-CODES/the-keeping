// M-A cutscene render profile (CUTSCENES-PLAN §5): scale hold per preset, the > 40 ms / 1 s frame-time guard, restore.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
import { CutsceneProfile, CUTSCENE_SCALE_RAISED as CUTSCENE_SCALE, GUARD_MS } from '../src/render/cutscene-profile.ts';

test('Medium holds its cutscene scale, restores the gameplay scale at the end', () => {
  const p = new CutsceneProfile('medium', CUTSCENE_SCALE.medium);
  assert.equal(p.begin(0.75), CUTSCENE_SCALE.medium);
  for (let i = 0; i < 300; i++) assert.equal(p.frame(16.7), null, '60 fps never trips');
  assert.equal(p.end(), 0.75);
  assert.equal(p.active, false);
});

test('the hold never lowers a higher gameplay scale (Max dynres up to 1.0)', () => {
  const p = new CutsceneProfile('max', CUTSCENE_SCALE.max);
  assert.equal(p.begin(0.95), null);
  assert.equal(p.scale, 0.95);
  assert.equal(p.end(), null);
});

test('Low (null) never changes the scale', () => {
  const p = new CutsceneProfile('low');
  assert.equal(p.begin(1), null);
  assert.equal(p.end(), null);
});

test('guard: > 40 ms average over 1 s steps back once, stays back for the cutscene, re-arms on the next', () => {
  const p = new CutsceneProfile('max', 0.85);
  p.begin(0.7);
  let back: number | null = null;
  for (let i = 0; i < 30 && back === null; i++) back = p.frame(GUARD_MS + 5);
  assert.equal(back, 0.7);
  assert.ok(p.tripped && p.trips === 1);
  for (let i = 0; i < 60; i++) assert.equal(p.frame(80), null, 'trips once per cutscene');
  assert.equal(p.end(), null, 'already at the gameplay scale');
  p.begin(0.7);
  assert.equal(p.tripped, false);
  assert.equal(p.end(), 0.7);
});

test('guard: a single 50 ms compile spike among 16 ms frames does not trip it', () => {
  const p = new CutsceneProfile('medium');
  p.begin(0.75);
  assert.equal(p.frame(50), null);
  for (let i = 0; i < 70; i++) assert.equal(p.frame(16.7), null);
  assert.equal(p.tripped, false);
});
