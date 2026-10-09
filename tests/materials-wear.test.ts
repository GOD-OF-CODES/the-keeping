// Prop wear rules (docs/PROPS-FINISH.md §2, §5): which specs are masked, physical limits of every layer, chip maths.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import { MATERIAL_SPECS, specById } from '../src/materials/spec-index.ts';
import { WEAR_RULES, applyLayerCpu, chipAmount, wearDustAmount, wearRuleFor, type RGB } from '../src/materials/wear-math.ts';

test('wear never applies to glass, skin, hair, ground or the house envelope (§2.2, §2.5)', () => {
  const never = new Set(['glass', 'skin', 'hair', 'grass', 'mud', 'stone', 'gravel', 'asphalt', 'brick', 'bark', 'wallpaper', 'plaster', 'ceiling_plaster', 'clapboard', 'shingles', 'porch_boards', 'wax', 'rope', 'tile']);
  for (const s of MATERIAL_SPECS) if (never.has(s.family)) assert.equal(wearRuleFor(s), null, s.id);
});

test('the hero-prop specs get the family rule the design names', () => {
  const want: Record<string, string> = {
    wood_furniture_dark: 'varnish', wood_raw_plank: 'raw_wood', brass_tarnished: 'brass', cast_iron: 'cast_iron',
    chrome_pitted: 'steel', steel_cleaver: 'steel', enamel_chipped: 'enamel', leather_worn: 'leather', crepe_black: 'fabric',
    paper_aged: 'paper', car_paint_wreck: 'painted_steel', door_painted: 'painted', trim_chipped: 'painted', rust: 'rust',
  };
  for (const [id, kind] of Object.entries(want)) assert.equal(wearRuleFor(specById(id)!)?.kind, kind, id);
});

test('chip threshold: hard ±0.04 edge, nothing below coverage, full above (§2.1)', () => {
  assert.equal(chipAmount(0, 1, 0.45, 0.04), 0);
  assert.equal(chipAmount(0.3, 1, 0.45, 0.04), 0);
  assert.equal(chipAmount(1, 1, 0.45, 0.04), 1);
  assert.ok(Math.abs(chipAmount(0.45, 1, 0.45, 0.04) - 0.5) < 1e-9);
});

test('every layer keeps albedo physical: dielectric ≤ 0.65 on worn props, metal F0 ≤ 0.95 (§2.5)', () => {
  const bases: RGB[] = [[0.02, 0.02, 0.02], [0.07, 0.04, 0.02], [0.3, 0.29, 0.25], [0.55, 0.48, 0.35]];
  for (const [name, r] of Object.entries(WEAR_RULES)) {
    for (const L of [r.edge, r.edge2, r.handled, r.cavity]) {
      for (const b of bases) {
        const o = applyLayerCpu(b, 0.5, 0, L, 1);
        const lim = L.metal > 0.5 && L.mAbs > 0 ? 0.95 : name === 'painted' ? 0.65 : r.cap;
        for (const c of o.alb.map((x) => Math.min(x, r.cap))) assert.ok(c >= 0 && c <= lim, `${name} ${c} > ${lim}`);
        assert.ok(r.cap <= 0.95);
        assert.ok(o.rough >= 0 && o.rough <= 1.01, `${name} rough ${o.rough}`);
      }
    }
  }
});

test('varnish wear on dark walnut stays bare-wood dark (≤ 0.35), steel edge reaches F0 0.56', () => {
  const w = applyLayerCpu([0.07, 0.04, 0.02], 0.25, 0, WEAR_RULES.varnish.edge, 1);
  assert.ok(Math.max(...w.alb) <= 0.35 && w.rough > 0.5);
  const s = applyLayerCpu([0.3, 0.3, 0.29], 0.45, 1, WEAR_RULES.steel.edge, 1);
  assert.equal(s.alb[0], 0.56);
  assert.ok(s.rough < 0.2);
});

test('masked dust: spec dust wins, furniture/metal default 0.5, paper none, fabric ×1.3 (§2.3)', () => {
  assert.equal(wearDustAmount(specById('wood_furniture_dark')!, WEAR_RULES.varnish), 0.5);
  assert.equal(wearDustAmount(specById('cast_iron')!, WEAR_RULES.cast_iron), 0.5);
  assert.equal(wearDustAmount(specById('paper_aged')!, WEAR_RULES.paper), 0);
  assert.ok(Math.abs(wearDustAmount(specById('crepe_black')!, WEAR_RULES.fabric) - 0.4 * 1.3) < 1e-9);
});

test('grime atlas: 4×4 cells, Blender row 0 lands at the canvas bottom (glTF v flip, flipY false), §4.3 kinds', async () => {
  const { cellRect, GRIME_CELLS } = await import('../src/materials/grime-atlas.ts');
  assert.deepEqual(cellRect(0, 1024), [0, 768, 256]);
  assert.deepEqual(cellRect(15, 1024), [768, 0, 256]);
  assert.deepEqual(cellRect(5, 512), [128, 256, 128]);
  assert.equal(GRIME_CELLS.length, 12);
  assert.equal(GRIME_CELLS.find((c) => c.cell === 5)!.kind, 'soot');
  for (const c of GRIME_CELLS) assert.ok(c.rough >= 0.3 && c.rough <= 0.95, c.kind);
});
