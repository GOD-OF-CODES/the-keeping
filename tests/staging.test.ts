// Review fixes around story staging / UI stacking / per-frame buffers (src/game/staging.ts, src/world/rooms.ts).
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
const fs = (await import('node:' + 'fs')) as any;

import layoutJson from '../src/shared/level-layout.json' with { type: 'json' };
import type { LevelLayout } from '../src/shared/layout-types.ts';
import { BEATS } from '../src/story/escape-state.ts';
import { END_CARD_Z, harlanHeldAtTable } from '../src/game/staging.ts';
import { RoomIndex } from '../src/world/rooms.ts';

const bi = (b: string) => BEATS.indexOf(b as any);

test('Harlan is held at the table B04..B11 in gameplay only', () => {
  for (const b of ['B04', 'B05', 'B08', 'B11']) assert.equal(harlanHeldAtTable(bi(b), null, false), true, b);
  for (const b of ['B01', 'B03', 'B12', 'B13']) assert.equal(harlanHeldAtTable(bi(b), null, false), false, b);
});

test('C5 kill: hidden at 21.6 s while the beat is still B11 — never snapped back to the table', () => {
  // during C5 itself (cutscene running) and after its end handler (harlan_taken, beat B12), and in the one frame
  // where harlan_taken is set but the beat has not advanced yet
  assert.equal(harlanHeldAtTable(bi('B11'), 'C5', false), false);
  assert.equal(harlanHeldAtTable(bi('B11'), null, true), false);
  assert.equal(harlanHeldAtTable(bi('B12'), null, true), false);
});

test("C3's lightning-flash hides (beat B07) are not overridden while the cutscene runs", () => {
  assert.equal(harlanHeldAtTable(bi('B07'), 'C3', false), false);
  assert.equal(harlanHeldAtTable(bi('B08'), null, false), true); // after C3 he is back in the locked parlor
});

test('end card stacks above the black fade and below the pause menu (Esc  menu stays clickable)', () => {
  const css = fs.readFileSync(new URL('../src/game/pause-menu.ts', import.meta.url), 'utf8') as string;
  const pauseZ = Number(/\.tk-pause\s*\{[^}]*z-index:\s*(\d+)/.exec(css)![1]);
  assert.ok(END_CARD_Z < pauseZ, `end card ${END_CARD_Z} must sit under .tk-pause ${pauseZ}`);
  const rt = fs.readFileSync(new URL('../src/game/story-runtime.ts', import.meta.url), 'utf8') as string;
  const fadeZ = Number(/fadeEl\.style,\s*\{[^}]*zIndex:\s*'(\d+)'/.exec(rt)![1]);
  assert.ok(END_CARD_Z > fadeZ, `end card ${END_CARD_Z} must sit over the fade ${fadeZ}`);
  // the card is click-through (a refused pointer lock shows the z-30 click overlay underneath it)
  assert.match(rt, /zIndex: String\(END_CARD_Z\), pointerEvents: 'none'/);
});

test('visibleFrom / triggersAt fill a caller buffer in place (no per-frame allocation) with the same result', () => {
  const layout = layoutJson as unknown as LevelLayout;
  const idx = new RoomIndex(layout);
  const buf = new Set<string>(['STALE']);
  const a = idx.visibleFrom('G1', 3.5, 1.5, 0.6);
  const b = idx.visibleFrom('G1', 3.5, 1.5, 0.6, undefined, buf);
  assert.equal(b, buf);
  assert.deepEqual([...b].sort(), [...a].sort());
  assert.ok(!b.has('STALE'));
  const t = layout.triggers[0];
  const x = (t.rect[0] + t.rect[2]) / 2;
  const y = (t.rect[1] + t.rect[3]) / 2;
  const z = (t.zMin + t.zMax) / 2;
  const out: any[] = [{ id: 'junk' }];
  const hits = idx.triggersAt(x, y, z, out);
  assert.equal(hits, out);
  assert.ok(hits.some((h) => h.id === t.id));
  assert.ok(!hits.some((h) => h.id === 'junk'));
  assert.deepEqual(hits.map((h) => h.id), idx.triggersAt(x, y, z).map((h) => h.id));
});
