// Material library coverage + the avgAlbedo check (the GPU part runs in ?scene=matlab; this covers everything that
// can run without a GPU: registry coverage, calibration table sanity, check math, coverage thresholds).
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
const fs = (await import('node:' + 'fs')) as any;

import { MATERIAL_SPECS, specById } from '../src/materials/spec-index.ts';
import { ALBEDO_TOLERANCE, albedoDeviation, albedoGain, bakedBytes } from '../src/materials/albedo-check.ts';
import { ALBEDO_CAL } from '../src/materials/library/calibration.ts';
import { coverThreshold, fbm, invNorm, pcg } from '../src/materials/noise-cpu.ts';
import { extraKind, makeCtx } from '../src/materials/gen-types.ts';
import { PRESETS } from '../src/render/presets.ts';

const LIB = new URL('../src/materials/library/', import.meta.url);
const libSrc = ['wood.ts', 'walls.ts', 'ground.ts', 'metal.ts', 'cloth.ts', 'misc.ts'].map((f) => fs.readFileSync(new URL(f, LIB), 'utf8')).join('\n');

/** Keys of every exported `*_GENERATORS = { … }` object literal in the library sources. */
function registeredFamilies(): Set<string> {
  const out = new Set<string>();
  for (const m of libSrc.matchAll(/export const \w+_GENERATORS[^=]*=\s*\{([\s\S]*?)\};/g)) {
    for (const k of m[1].matchAll(/^\s*([a-z_]+)\s*[:,]/gm)) out.add(k[1]);
  }
  return out;
}

test('every material family used by the spec has a dedicated generator', () => {
  const fams = registeredFamilies();
  const missing = [...new Set(MATERIAL_SPECS.map((m) => m.family))].filter((f) => !fams.has(f));
  assert.deepEqual(missing, [], `families without a generator: ${missing.join(', ')}`);
  // Id-specific generators exist where the family one doesn't fit.
  assert.match(libSrc, /wall_tally:\s*wallTally/);
});

test('spec sanity: 68 materials, unique ids, avgAlbedo in (0,1), tileMetres > 0', () => {
  assert.equal(MATERIAL_SPECS.length, 68);
  assert.equal(new Set(MATERIAL_SPECS.map((m) => m.id)).size, MATERIAL_SPECS.length);
  for (const m of MATERIAL_SPECS) {
    assert.ok(m.tileMetres > 0, m.id);
    for (const a of m.avgAlbedo) assert.ok(a > 0 && a < 1, `${m.id} avgAlbedo`);
  }
  assert.equal(specById('dust_sheet@2s')?.id, 'dust_sheet', 'double-sided @2s ids resolve');
});

test('calibration table: covers every baked material, near-unity trims only', () => {
  for (const m of MATERIAL_SPECS) {
    if (m.source === 'constant') continue;
    const k = ALBEDO_CAL[m.id];
    assert.ok(k, `no calibration for ${m.id} (regenerate: __matlab.calibration())`);
    // A trim outside [0.4, 2.5] means the generator's colours are wrong, not merely off — fix the generator.
    for (const v of k) assert.ok(v >= 0.4 && v <= 2.5, `${m.id} calibration ${k}`);
  }
  for (const id of Object.keys(ALBEDO_CAL)) assert.ok(specById(id), `stale calibration entry ${id}`);
});

test('albedo check math: tolerance, floor for near-black, gain clamps', () => {
  assert.equal(ALBEDO_TOLERANCE, 0.1);
  assert.ok(albedoDeviation([0.105, 0.2, 0.3], [0.1, 0.2, 0.3]) < 0.051);
  assert.ok(albedoDeviation([0.12, 0.2, 0.3], [0.1, 0.2, 0.3]) > ALBEDO_TOLERANCE);
  // crepe_black 0.015: a 0.002 difference is judged against the 0.02 floor (10 %), not 13 %.
  assert.ok(albedoDeviation([0.017, 0.014, 0.014], [0.015, 0.014, 0.014]) <= ALBEDO_TOLERANCE + 1e-9);
  assert.deepEqual(albedoGain([0.1, 0.2, 0.4], [0.1, 0.2, 0.4]), [1, 1, 1]);
  assert.deepEqual(albedoGain([0.01, 1, 0.2], [0.5, 0.1, 0.2]), [2, 0.5, 1]);
});

test('GPU memory of the baked maps per preset (RGBA8 × 2 with mips)', () => {
  const baked = MATERIAL_SPECS.filter((m) => m.source === 'generated');
  const mb = (id: 'low' | 'medium' | 'max') => baked.reduce((a, m) => a + bakedBytes(m.hero ? PRESETS[id].textures.heroSize : PRESETS[id].textures.baseSize), 0) / 1048576;
  const low = mb('low');
  const med = mb('medium');
  const max = mb('max');
  assert.ok(low < 80, `low ${low.toFixed(0)} MB`);
  assert.ok(med < 300, `medium ${med.toFixed(0)} MB`);
  assert.ok(max < 1000, `max ${max.toFixed(0)} MB`);
  assert.ok(low < med && med < max);
});

test('coverage thresholds: fbm01 area above coverThreshold(c) ≈ c', () => {
  close(invNorm(0.5), 0, 1e-9);
  close(invNorm(0.975), 1.959964, 1e-5);
  close(invNorm(0.01), -2.326348, 1e-5);
  // Empirical: fbm01 = fbm·(0.25/0.19) + 0.5 (tsl-noise.ts) → area above the threshold matches the coverage.
  const vals: number[] = [];
  let s = 7;
  for (let i = 0; i < 20000; i++) {
    s = pcg(s);
    const u = (s >>> 8) / 16777216;
    s = pcg(s);
    const v = (s >>> 8) / 16777216;
    vals.push(Math.min(1, Math.max(0, fbm([u, v], [4, 4], { octaves: 4, seed: 5 }) * (0.25 / 0.19) + 0.5)));
  }
  for (const c of [0.1, 0.3, 0.5, 0.7]) {
    const t = coverThreshold(c);
    const area = vals.filter((x) => x > t).length / vals.length;
    assert.ok(Math.abs(area - c) < 0.08, `coverage ${c}: area ${area.toFixed(3)}`);
  }
});

test('generator context: *_srgb params decode, integer cells, extra channel kind', () => {
  const sedan = specById('asphalt_wet')!;
  const c = makeCtx(sedan, null, 512);
  const line = c.col('centreLine', [0, 0, 0]);
  assert.ok(line[0] < 0.75 && line[0] > 0.5, 'centreLine_srgb decoded to linear');
  assert.equal(c.cells(0.3), Math.round(sedan.tileMetres / 0.3));
  assert.equal(extraKind(specById('rust')!), 'metal');
  assert.equal(extraKind(specById('glass_rain')!), 'opacity');
  assert.equal(extraKind(specById('floor_bare')!), 'height');
});

function close(a: number, b: number, eps: number) {
  assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
}
