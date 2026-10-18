// Objective line (src/story/objectives.ts): every playable step has a short objective, it follows the same route as
// the 90 s lightning hint (Beats.hintTarget), and it is silent in cutscenes, the death cutaway and the ending.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import { Story } from '../src/story/beats.ts';
import { BEATS, type BeatId, type EscapeState } from '../src/story/escape-state.ts';
import { objectiveFor, objectivesActive } from '../src/story/objectives.ts';

const at = (b: BeatId, flags: string[] = [], extra: Partial<EscapeState> = {}): Story => {
  const st = Story.debugStateAt(b);
  for (const f of flags) st.flags[f.replace(/^-/, '')] = !f.startsWith('-'); // '-name' clears a flag
  Object.assign(st, extra);
  return new Story(st);
};

/** Each playable step of the route, in order (beat, flags set so far, counters). */
const ROUTE: Array<[BeatId, string[], Partial<EscapeState>?]> = [
  ['B02', []],
  ['B02', ['knocked']],
  ['B02', ['knocked', 'rang_front_bell', 'front_door_open']],
  ['B03', []],
  ['B05', []],
  ['B05', ['first_hide_done']],
  ['B06', []],
  ['B06', ['ledger_read']],
  ['B08', [], { bellPulls: 0 }],
  ['B08', ['bell_used'], { bellPulls: 1 }],
  ['B08', ['bell_used', 'ada_board_1'], { bellPulls: 1 }],
  ['B08', ['bell_used', 'ada_board_1', 'ada_board_3'], { bellPulls: 1 }],
  ['B08', ['bell_used', 'ada_board_1', 'ada_board_2', 'ada_board_3', 'ada_boards_pried'], { bellPulls: 1 }],
  ['B09', []],
  ['B09', ['letter_read']],
  ['B09', ['letter_read', 'has_shears']],
  ['B09', ['letter_read', 'has_shears', 'hem_cut']],
  ['B09', ['letter_read', 'has_shears', 'hem_cut', 'has_locket']],
  ['B09', ['letter_read', 'has_shears', 'hem_cut', 'has_locket', 'dress_visit_done']],
  ['B10', []],
  ['B10', ['has_can']],
  ['B11', ['has_can', 'passage_unbolted']],
  ['B11', ['has_can', 'passage_unbolted', 'finale_started']],
  ['B12', ['has_can']],
  ['B12', ['-has_can']],
];

test('objectives: every playable step has a short line, and it points where the 90 s hint points', () => {
  const ids = new Set<string>();
  for (const [b, flags, extra] of ROUTE) {
    const st = at(b, flags, extra ?? {});
    const o = objectiveFor(st.s);
    assert.ok(o, `${b} ${flags.join(',')}: no objective`);
    assert.ok(o!.text.length <= 42, `${o!.id}: "${o!.text}" is too long for the top-left line`);
    assert.ok(!o!.detail || o!.detail.length <= 80, `${o!.id}: detail too long`);
    assert.equal(o!.target, st.hintTarget(), `${o!.id}: objective → ${o!.target}, hint → ${st.hintTarget()}`);
    ids.add(o!.id);
  }
  // consecutive steps change the line (the HUD fades each new id in)
  assert.equal(ids.size, ROUTE.length, 'every step has its own id');
});

test('objectives: the board count follows the pried flags', () => {
  const o = objectiveFor(at('B08', ['bell_used', 'ada_board_2'], { bellPulls: 1 }).s)!;
  assert.match(o.text, /\(1\/3\)/);
  assert.equal(o.target, 'board_1');
});

test('objectives: silent in cutscenes, the death cutaway, the drive in, C3 and the ending', () => {
  assert.equal(objectiveFor(at('B05', [], { cutscene: 'C2' }).s), null);
  assert.equal(objectiveFor(at('B08', [], { dead: true }).s), null);
  for (const b of ['B01', 'B07', 'B13'] as BeatId[]) assert.equal(objectiveFor(at(b).s), null, b);
  assert.equal(objectivesActive(at('B01').s), false);
  assert.equal(objectivesActive(at('B13').s), false);
  for (const b of BEATS.filter((x) => !['B01', 'B07', 'B13'].includes(x))) assert.equal(objectivesActive(at(b).s), true, b);
});
