// Audio lane: synth catalog sanity, procedural IRs, room-graph occlusion, subtitle timing fallback.
// node:test is loaded dynamically because the project has no @types/node (typecheck must still pass).
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
const fs = (await import('node:' + 'fs')) as any;

import { RECIPES, getRecipe } from '../src/audio/synth/index.ts';
import { renderRecipe, MAX_PEAK } from '../src/audio/synth/render.ts';
import { Rng, peak, rms } from '../src/audio/synth/dsp.ts';
import { BUS_NAMES } from '../src/audio/synth/types.ts';
import { generateIR, rt60For } from '../src/audio/reverb.ts';
import { bestPath, occlusionFor, roomAtPlan, roomAtWorld } from '../src/audio/spatial.ts';
import { fallbackTiming, mapTimingToSubtitle, revealCount, alignmentToWords, stripTags, WORDS_PER_SEC, MIN_SUBTITLE_SEC } from '../src/audio/voice-timing.ts';
import type { LevelLayout } from '../src/shared/layout-types.ts';

const layout = JSON.parse(fs.readFileSync(new URL('../src/shared/level-layout.json', import.meta.url), 'utf8')) as LevelLayout;

// ------------------------------------------------------------------ catalog

test('recipe ids are unique and buses valid', () => {
  const ids = new Set<string>();
  for (const r of RECIPES) {
    assert.ok(!ids.has(r.id), `duplicate ${r.id}`);
    ids.add(r.id);
    assert.ok((BUS_NAMES as readonly string[]).includes(r.bus), `${r.id} bus ${r.bus}`);
    assert.ok(r.variants >= 1);
  }
});

test('the design sound list is covered', () => {
  const required = [
    'ada_drip', 'ada_drip_stop', 'ada_bone_crack', 'ada_gurgle', 'ada_slap', 'ada_nails_plaster', 'ada_scrape_wood',
    'rain_roof', 'rain_glass', 'rain_porch', 'rain_car', 'rain_inside', 'thunder_near', 'thunder_distant', 'wind',
    'step_runner', 'step_bare', 'step_creaker', 'step_stair', 'step_gravel', 'step_porch', 'step_mud',
    'door_creak', 'door_slam', 'bolt_drop', 'knock', 'spring_bell', 'doorbell_old', 'rope_pulleys', 'whetstone', 'wet_chop',
    'engine_idle', 'engine_sputter', 'engine_stall', 'engine_crank', 'engine_catch', 'fuel_chime', 'wiper', 'radio_static',
    'pry_bite', 'nail_screech', 'shears', 'paper', 'can_scrape', 'hatch_thump', 'rocking_chair', 'heartbeat',
    'breath_calm', 'breath_strained', 'breath_hold', 'gasp', 'panting',
    'score_drone', 'score_chase', 'score_stinger', 'score_final_bell', 'score_blue_hour',
  ];
  for (const id of required) assert.doesNotThrow(() => getRecipe(id), id);
});

test('every recipe renders: finite, non-silent, peak within ceiling', () => {
  const sr = 16000;
  for (const r of RECIPES) {
    const out = renderRecipe(r, sr, 0);
    assert.ok(out.channels.length === 1 || out.channels.length === 2, `${r.id} channels`);
    if (r.stereo) assert.equal(out.channels.length, 2, `${r.id} should be stereo`);
    const len = out.channels[0].length;
    assert.ok(len > sr * 0.03, `${r.id} too short (${len})`);
    for (const c of out.channels) {
      assert.equal(c.length, len);
      for (let i = 0; i < c.length; i += 7) assert.ok(Number.isFinite(c[i]), `${r.id} NaN`);
    }
    const p = peak(out.channels);
    assert.ok(p <= MAX_PEAK + 1e-6, `${r.id} peak ${p}`);
    assert.ok(p > 0.05, `${r.id} silent (peak ${p})`);
    assert.ok(rms(out.channels[0]) > 1e-4, `${r.id} rms too low`);
  }
});

test('variants are seeded: same variant identical, different variants differ', () => {
  const r = getRecipe('ada_bone_crack');
  const a = renderRecipe(r, 16000, 1).channels[0];
  const b = renderRecipe(r, 16000, 1).channels[0];
  const c = renderRecipe(r, 16000, 2).channels[0];
  assert.deepEqual(Array.from(a.slice(0, 500)), Array.from(b.slice(0, 500)));
  let diff = 0;
  for (let i = 0; i < Math.min(a.length, c.length); i++) diff += Math.abs(a[i] - c[i]);
  assert.ok(diff > 1);
});

test('loops have no big seam discontinuity', () => {
  for (const r of RECIPES.filter((x) => x.loop)) {
    const out = renderRecipe(r, 16000, 0);
    for (const c of out.channels) {
      const p = peak(c);
      const jump = Math.abs(c[c.length - 1] - c[0]);
      assert.ok(jump < 0.5 * p + 0.02, `${r.id} seam jump ${jump.toFixed(3)} vs peak ${p.toFixed(3)}`);
    }
  }
});

test('Rng is deterministic and uniform-ish', () => {
  const a = new Rng(42);
  const b = new Rng(42);
  let sum = 0;
  for (let i = 0; i < 10000; i++) {
    const x = a.next();
    assert.equal(x, b.next());
    assert.ok(x >= 0 && x < 1);
    sum += x;
  }
  assert.ok(Math.abs(sum / 10000 - 0.5) < 0.02);
});

// ------------------------------------------------------------------ reverb

test('IR: decays, is stereo-decorrelated, and grows with room size', () => {
  const sr = 16000;
  const small = generateIR({ size: 1.5, damping: 0.75, wet: 0.12 }, sr);
  const hall = generateIR({ size: 9, damping: 0.45, wet: 0.3 }, sr);
  assert.ok(hall.channels[0].length > small.channels[0].length);
  assert.ok(hall.rt60 > small.rt60);
  for (const ir of [small, hall]) {
    const [l, r] = ir.channels;
    assert.equal(l.length, r.length);
    for (let i = 0; i < l.length; i += 11) assert.ok(Number.isFinite(l[i]) && Number.isFinite(r[i]));
    const q = Math.floor(l.length / 4);
    const early = rms(l.subarray(Math.floor(ir.preDelay * sr), Math.floor(ir.preDelay * sr) + q));
    const late = rms(l.subarray(l.length - q));
    assert.ok(late < early * 0.2, `tail should decay (early ${early}, late ${late})`);
    let dot = 0, el = 0, er = 0;
    for (let i = 0; i < l.length; i++) { dot += l[i] * r[i]; el += l[i] * l[i]; er += r[i] * r[i]; }
    assert.ok(Math.abs(dot / Math.sqrt(el * er)) < 0.5, 'L/R should be decorrelated');
    // pre-delay region is silent
    const pre = Math.floor(ir.preDelay * sr);
    for (let i = 0; i < pre - 1; i++) assert.equal(l[i], 0);
  }
});

test('IR: damping shortens RT60 and darkens the tail', () => {
  assert.ok(rt60For({ size: 6, damping: 0.9, wet: 0.2 }) < rt60For({ size: 6, damping: 0.1, wet: 0.2 }));
  for (const room of layout.rooms) {
    const t = rt60For(room.reverb);
    assert.ok(t >= 0.15 && t <= 3.2, `${room.id} rt60 ${t}`);
  }
});

// ------------------------------------------------------------------ occlusion / room graph

test('room graph: same room, closed vs open door, stairwell, floor vs grate', () => {
  const links = layout.roomLinks;
  assert.equal(bestPath(links, 'U1', 'U1').attenuation, 1);
  // U1–U3 only via Ada's door (0.5) or longer paths through floors — closed door wins
  const closed = bestPath(links, 'U1', 'U3', () => false);
  assert.ok(Math.abs(closed.attenuation - 0.5) < 1e-9, `closed ${closed.attenuation}`);
  const open = bestPath(links, 'U1', 'U3', (d) => d === 'D_ADA');
  assert.ok(Math.abs(open.attenuation - 1) < 1e-9);
  // hall ↔ landing: open stairwell (1), not the 0.4 floor
  const stair = bestPath(links, 'G1', 'U1');
  assert.ok(Math.abs(stair.attenuation - 1) < 1e-9);
  assert.deepEqual(stair.via, ['stairwell']);
  // parlor ↔ Harlan's room: the grate (0.75) beats the floor (0.4)
  const grate = bestPath(links, 'G2', 'U2', () => false);
  assert.ok(Math.abs(grate.attenuation - 0.75) < 1e-9, `grate ${grate.attenuation}`);
  assert.deepEqual(grate.via, ['grate']);
  // unknown room → unreachable
  assert.equal(bestPath(links, 'U1', 'NOPE').attenuation, 0);
});

test('occlusion mapping: monotonic, floors darker than doors at equal attenuation', () => {
  let prevGain = 1.1;
  let prevCut = 30000;
  for (const a of [1, 0.8, 0.5, 0.3, 0.1]) {
    const o = occlusionFor({ attenuation: a, via: ['door'] });
    assert.ok(o.gain <= prevGain && o.cutoff <= prevCut);
    prevGain = o.gain;
    prevCut = o.cutoff;
  }
  assert.deepEqual(occlusionFor({ attenuation: 1, via: [] }), { gain: 1, cutoff: 20000 });
  const door = occlusionFor({ attenuation: 0.4, via: ['door'] });
  const floor = occlusionFor({ attenuation: 0.4, via: ['floor'] });
  assert.ok(floor.cutoff < door.cutoff);
  assert.equal(occlusionFor({ attenuation: 0, via: [] }).gain, 0);
});

test('room lookup: closet inside hall rect, floors by height, world coords', () => {
  // under-stair closet rect sits inside the hall's rect: smallest wins
  assert.equal(roomAtPlan(layout, 0.5, 7, 0.6), 'CLOSET');
  assert.equal(roomAtPlan(layout, 2.5, 3, 0.6 + 1.6), 'G1');
  assert.equal(roomAtPlan(layout, 2.5, 3, 4.1 + 1.6), 'U1');
  assert.equal(roomAtPlan(layout, 2, -20, 1.6), 'EXT2');
  // world (x, y-up, z = -plan y)
  assert.equal(roomAtWorld(layout, 2.5, 5.7, -3), 'U1');
});

// ------------------------------------------------------------------ voice timing

test('subtitle fallback timing ≈ 2.7 words/s with punctuation pauses and a minimum', () => {
  const text = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour twentyfive twentysix twentyseven';
  const t = fallbackTiming(text);
  assert.equal(t.words.length, 27);
  assert.ok(Math.abs(t.speechSec - 27 / WORDS_PER_SEC) < 0.01, `speech ${t.speechSec}`);
  assert.ok(t.durationSec > t.speechSec);
  for (let i = 1; i < t.words.length; i++) assert.ok(t.words[i].start >= t.words[i - 1].end - 1e-9);
  // pauses make punctuated text longer than the same words unpunctuated
  assert.ok(fallbackTiming('Look. It is him. It is him you want.').speechSec > fallbackTiming('Look it is him it is him you want').speechSec);
  // minimum on-screen time for tiny lines
  assert.equal(fallbackTiming('…Harlan?').durationSec, MIN_SUBTITLE_SEC);
  assert.equal(fallbackTiming('').words.length, 0);
});

test('revealCount follows word starts', () => {
  const t = fallbackTiming('a b c d');
  assert.equal(revealCount(t.words, -1), 0);
  assert.equal(revealCount(t.words, 0), 1);
  assert.equal(revealCount(t.words, 1e9), 4);
});

test('alignment → words drops audio tags; mapping onto subtitle words', () => {
  const text = '[whispers] Don\'t breathe. [breath] Ok';
  const chars = [...text];
  const a = {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => i * 0.05),
    character_end_times_seconds: chars.map((_, i) => i * 0.05 + 0.05),
  };
  const words = alignmentToWords(a);
  assert.deepEqual(words.map((w) => w.text), ["Don't", 'breathe.', 'Ok']);
  assert.ok(words[0].start > 0.4); // after the tag
  const mapped = mapTimingToSubtitle("Don't breathe. Okay.", { words, durationSec: 2 });
  assert.deepEqual(mapped.map((w) => w.text), ["Don't", 'breathe.', 'Okay.']);
  assert.equal(mapped[1].start, words[1].start);
  // count mismatch → proportional, monotonic, inside the spoken span
  const m2 = mapTimingToSubtitle('Do not breathe now please', { words, durationSec: 2 });
  assert.equal(m2.length, 5);
  for (let i = 1; i < m2.length; i++) assert.ok(m2[i].start >= m2[i - 1].start);
  assert.ok(m2[0].start >= words[0].start && m2[4].end <= words[2].end + 1e-9);
  assert.equal(stripTags('[a] Hi  [b] there'), 'Hi there');
});
