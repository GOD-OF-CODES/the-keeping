// C0 'County Road 9' (docs/C1-OPENING.md §3): the title cinematic's contract — duration and shot cover, the credits
// text (CLAUDE.md "Credits"), the lightning beats, the wiper phase that match-cuts into C1, and C1's no-fade start
// when chained.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
import { c0Road, C0_DURATION, C0_FLASHES, C1_WIPER_PHASE, TITLE, BYLINE, WIPER_PERIOD, C0_WIPER_START } from '../src/cutscenes/c0-road.ts';
import { c1Empty } from '../src/cutscenes/c1-empty.ts';
import { CUTSCENES, DIRECTOR_CUTSCENES } from '../src/cutscenes/index.ts';
import type { CutsceneContext } from '../src/cutscenes/types.ts';

const ctx: CutsceneContext = { player: { eye: [2, -20, 1.6], heading: Math.PI / 2, pitch: 0, fov: 70 }, ada: null, flags: new Map(), seen: false };

test('C0: 30 s, shots tile the timeline, registered but never a Director cutscene', () => {
  const tl = c0Road(ctx);
  assert.equal(tl.duration, 30);
  assert.equal(C0_DURATION, 30);
  const shots = tl.shots ?? [];
  assert.equal(shots[0].t, 0);
  for (let i = 1; i < shots.length; i++) assert.ok(Math.abs(shots[i].t - (shots[i - 1].t + shots[i - 1].d)) < 1e-6, `shot ${i} starts where ${i - 1} ends`);
  const last = shots[shots.length - 1];
  assert.ok(Math.abs(last.t + last.d - 30) < 1e-6);
  assert.equal(last.space, 'car', 'shot 4 is the pull-back through the windscreen (car space)');
  assert.ok(CUTSCENES.C0);
  assert.ok(!(DIRECTOR_CUTSCENES as readonly string[]).includes('C0'));
});

test('C0: the title and byline credit Raj Vardhan Singh (system-font DOM cards), the date card is shown first', () => {
  const tl = c0Road(ctx);
  assert.equal(TITLE, 'THE KEEPING');
  assert.equal(BYLINE, 'a game by Raj Vardhan Singh');
  const cards = tl.cues.filter((c) => c.type === 'card') as Array<{ t: number; text: string | null; style?: string }>;
  const title = cards.find((c) => c.text === TITLE);
  const by = cards.find((c) => c.text === BYLINE);
  assert.ok(title && title.style === 'title' && Math.abs(title.t - 20.0) < 1e-6);
  assert.ok(by && by.style === 'byline' && Math.abs(by.t - 20.8) < 1e-6);
  assert.ok(cards.some((c) => c.style === 'date' && /1994/.test(c.text ?? '') && c.t < 3.5));
  assert.ok(cards.some((c) => c.text === null && c.style === 'title' && c.t > 23.5 && c.t < 24.7), 'title fades out before shot 4');
});

test('C0: three authored flashes (0.7 far, 0.9 near, 0.25 cloud-to-cloud), storm auto off', () => {
  const tl = c0Road(ctx);
  const fl = tl.cues.filter((c) => c.type === 'light' && (c as any).op === 'lightning') as any[];
  assert.deepEqual(fl.map((c) => [c.t, c.strength]), C0_FLASHES.map((f) => [f.t, f.strength]));
  assert.ok(tl.cues.some((c) => c.type === 'light' && (c as any).op === 'storm_auto' && (c as any).on === false));
});

test('C0 → C1: the wiper blade crossing at 29.75 continues into C1 (phase), and chained C1 has no fade-in', () => {
  // C0 blades start at 26.0 with phase 0.4 → at 30.0 the phase is (0.4 + 4 / 1.25) mod 1
  const expect = (0.4 + (30 - C0_WIPER_START) / WIPER_PERIOD) % 1;
  assert.ok(Math.abs(C1_WIPER_PHASE - expect) < 1e-9);
  const chained = c1Empty({ ...ctx, chained: true });
  const fresh = c1Empty(ctx);
  assert.equal(chained.fade?.[0].v, 0, 'matched cut: no black at C1 t 0');
  assert.equal(fresh.fade?.[0].v, 1, 'a C1 on its own still fades in');
  const w = chained.cues.find((c) => c.type === 'fx' && (c as any).id === 'wipers') as any;
  assert.ok(Math.abs(w.params.phase - C1_WIPER_PHASE) < 1e-9);
});
