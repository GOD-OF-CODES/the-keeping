// FINAL #153c: C2c's stumble — the catch clip starts 40 ms after the creak, so the frame where the fist with the torch
// is jammed in the tread 13 / riser 14 corner (clip 0.273 s, the lens below the nosing: nothing in a view up the flight
// can be lit from it) meets the whip past north (looking east at the rail) instead of the 6.733 view up the flight
// (the black frame on Low, the dark dip on Medium / Max).
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import { c2cUp } from '../src/cutscenes/c2c-up.ts';

test('C2c: arms_stumble_catch starts at 6.5 (the creak and the camera drop stay at 6.46, the impact at 6.62)', () => {
  for (const motionBlur of [false, true]) {
    const tl = c2cUp({ chained: true, motionBlur, player: { fov: 60 } } as any);
    const clip = tl.cues.filter((c: any) => c.type === 'clip' && c.clip === 'arms_stumble_catch');
    assert.equal(clip.length, 1);
    assert.equal(clip[0].t, 6.5);
    assert.ok(tl.cues.some((c: any) => c.type === 'sfx' && c.id === 'step_creaker' && c.t === 6.46));
    assert.ok(tl.cues.some((c: any) => c.type === 'sfx' && c.id === 'body_fall_stairs' && c.t === 6.62));
    assert.ok((tl.shots ?? []).some((s: any) => s.t === 6.46) && (tl.shots ?? []).some((s: any) => s.t === 6.62));
    // the clip still starts before the impact, inside the stumble
    assert.ok(clip[0].t - 6.46 <= 0.045 && clip[0].t < 6.62);
  }
});
