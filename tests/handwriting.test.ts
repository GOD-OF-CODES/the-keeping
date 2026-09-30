// The stroke font covers every string the world writes (documents, signs, plates, chalk), wraps to width and is
// deterministic.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
import { GLYPHS, PENS, hashRng, measure, missingGlyphs, seedOf, wrap } from '../src/render/handwriting.ts';
import { DOCUMENTS } from '../src/story/documents.ts';
import { adaClipFor } from '../src/characters/ada.ts';
import { ADA_ANIMS } from '../src/ai/types.ts';

const SIGNS = ["STROUD'S GAS & FEED", 'ROOMS', 'VACANCY', 'RVX-318', 'NEXT SERVICES 48 MI', 'STROUD', 'OKB 441', 'D. PRUITT', '7L 2290', 'CARVEL 6:10, TUE OCT 12 1976', 'PRICE PER GAL', 'CO. RD. 9'];

test('stroke font covers every document and sign', () => {
  for (const d of Object.values(DOCUMENTS)) {
    assert.deepEqual(missingGlyphs(d.text), [], `${d.id}`);
    assert.deepEqual(missingGlyphs(d.title), [], `${d.id} title`);
  }
  for (const s of SIGNS) assert.deepEqual(missingGlyphs(s), [], s);
});

test('glyph strokes are finite, in a sane box, and even-length', () => {
  for (const [ch, g] of Object.entries(GLYPHS)) {
    assert.ok(g.w > 0 && g.w < 1, `${ch} width`);
    for (const s of g.s) {
      assert.equal(s.length % 2, 0, `${ch} stroke length`);
      for (const v of s) assert.ok(Number.isFinite(v) && v > -0.2 && v < 1.5, `${ch} coord ${v}`);
    }
  }
});

test('wrap respects the width and keeps every word', () => {
  const text = DOCUMENTS.ledger_p2.text;
  const lines = wrap(text, PENS.ink, 14);
  for (const l of lines) if (l.split(' ').length > 1) assert.ok(measure(l, PENS.ink) <= 14 + 1e-9, l);
  assert.equal(lines.join(' ').split(/\s+/).filter(Boolean).length, text.split(/\s+/).filter(Boolean).length);
});

test('jitter RNG is deterministic per text', () => {
  const a = hashRng(seedOf('RVX-318'));
  const b = hashRng(seedOf('RVX-318'));
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
});

test('every AdaAnim maps to a built clip (or hidden)', () => {
  const built = new Set(['ada_catch', 'ada_chase', 'ada_hide_check', 'ada_hide_tear', 'ada_listen', 'ada_look', 'ada_opening', 'ada_patrol', 'ada_rise', 'ada_stairs_down', 'ada_stairs_up', 'ada_table', 'ada_vigil']);
  for (const a of ADA_ANIMS) {
    const c = adaClipFor(a, 0);
    if (a === 'hidden') assert.equal(c, null);
    else assert.ok(c && built.has(c), `${a} → ${c}`);
  }
  assert.equal(adaClipFor('stairs', -0.2), 'ada_stairs_down');
  assert.equal(adaClipFor('stairs', 0.2), 'ada_stairs_up');
});

test('M2 clips are picked up when the GLB has them (search, dress, door push, finale)', () => {
  const m2 = new Set(['ada_search', 'ada_dress', 'ada_door_push', 'ada_finale_approach', 'ada_finale_take', 'ada_finale_carry', 'ada_look', 'ada_patrol', 'ada_vigil']);
  const has = (c: string) => m2.has(c);
  assert.equal(adaClipFor('search_plaster', 0, has), 'ada_search');
  assert.equal(adaClipFor('dress_hem', 0, has), 'ada_dress');
  assert.equal(adaClipFor('door_push', 0, has), 'ada_door_push');
  assert.equal(adaClipFor('finale_approach', 0, has), 'ada_finale_approach');
  assert.equal(adaClipFor('finale_take', 0, has), 'ada_finale_take');
  assert.equal(adaClipFor('finale_carry', 0, has), 'ada_finale_carry');
  assert.equal(adaClipFor('finale_look', 0, has), 'ada_look');
  assert.equal(adaClipFor('lured_scrape', 0, has), 'ada_vigil');
  // without them: the M1 stand-ins
  assert.equal(adaClipFor('search_plaster', 0, () => false), 'ada_vigil');
  assert.equal(adaClipFor('finale_take', 0), 'ada_look');
});
