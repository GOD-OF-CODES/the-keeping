// LOAD round (#157b): the shipped reflection-cube file — the Node encoder (scripts/qa/refl-export.mjs) and the
// runtime decoder (src/render/refl-file.ts) agree byte for byte, gzip'd or raw, and junk is rejected (→ runtime capture).
import { decodeReflFile, readReflFile, rgbToRgba, rgbaToRgb, REFL_FILE_FORMAT } from '../src/render/refl-file.ts';

// node built-ins and the plain .mjs export script, without @types/node (the project allows no extra packages)
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
const { gzipSync } = (await import('node:' + 'zlib')) as any;
const { Buffer } = (await import('node:' + 'buffer')) as any;
const { encodeReflFile } = (await import('../scripts/qa/' + 'refl-export.mjs')) as any;

const SIZE = 4;
const halfs = SIZE * SIZE * 6 * 3;
const cube = (seed: number) => {
  const u = new Uint16Array(halfs);
  for (let i = 0; i < halfs; i++) u[i] = (seed * 7919 + i * 31) & 0x7bff; // finite, non-negative halfs
  return Buffer.from(u.buffer);
};
const sample = () => ({
  key: 'abc123',
  size: SIZE,
  cubes: [
    { id: 'G1', state: 'night', rgb: cube(1) },
    { id: 'EXT', state: 'night', rgb: cube(2) },
    { id: 'EXT', state: 'dawn', rgb: cube(3) },
    { id: 'EXT', state: 'night2', rgb: cube(4) },
  ],
});
const ab = (b: any): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

test('encoder → decoder round trip (raw)', () => {
  const s = sample();
  const f = decodeReflFile(ab(encodeReflFile(s)));
  if (!f) return assert.fail('decode failed');
  assert.equal(f.key, 'abc123');
  assert.equal(f.size, SIZE);
  assert.equal(f.cubes.length, 4);
  for (let i = 0; i < 4; i++) {
    assert.equal(f.cubes[i].id, s.cubes[i].id);
    assert.equal(f.cubes[i].state, s.cubes[i].state);
    assert.deepEqual(Buffer.from(f.cubes[i].rgb.buffer), s.cubes[i].rgb);
  }
});

test('gzip-wrapped file decodes to the same cubes (DecompressionStream path)', async () => {
  const s = sample();
  const f = await readReflFile(ab(gzipSync(encodeReflFile(s))));
  if (!f) return assert.fail('gzip decode failed');
  assert.deepEqual(Buffer.from(f.cubes[2].rgb.buffer), s.cubes[2].rgb);
});

test('junk, other formats and truncated files are rejected (the game then captures at runtime)', async () => {
  assert.equal(decodeReflFile(ab(Buffer.from('<!doctype html><html></html>'))), null);
  assert.equal(await readReflFile(ab(Buffer.from('<!doctype html>'))), null);
  const good = encodeReflFile(sample());
  const other = Buffer.from(good);
  other.writeUInt32LE(REFL_FILE_FORMAT + 1, 4);
  assert.equal(decodeReflFile(ab(other)), null);
  assert.equal(decodeReflFile(ab(good.subarray(0, good.length - 8))), null);
  assert.equal(await readReflFile(ab(gzipSync(good).subarray(0, 40))), null);
});

test('RGB ↔ RGBA16F keeps the colour halfs and sets alpha 1.0', () => {
  const rgb = new Uint16Array([1, 2, 3, 4, 5, 6]);
  const rgba = rgbToRgba(rgb, 2);
  assert.deepEqual([...rgba], [1, 2, 3, 0x3c00, 4, 5, 6, 0x3c00]);
  assert.deepEqual([...rgbaToRgb(rgba, 2)], [1, 2, 3, 4, 5, 6]);
});
