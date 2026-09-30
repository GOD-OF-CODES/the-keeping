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
