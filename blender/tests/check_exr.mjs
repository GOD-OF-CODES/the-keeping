#!/usr/bin/env node
// S2 runtime-side gate: decode every lightmap file written by smoke_s2.py with three r186's EXRLoader (and our
// f16gz fallback with DecompressionStream) in Node, prove the round trip and the orientation rule.
//   node blender/tests/check_exr.mjs .cache/smoke/s2
import fs from 'node:fs';
import path from 'node:path';
import { FloatType } from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const dir = process.argv[2] ?? '.cache/smoke/s2';
const LOSSY = new Set(['dwaa', 'dwab', 'b44', 'b44a']);
let failures = 0;
const expect = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};
const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

function halfToFloat(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}
async function readF16gz(file, channels = 3) {
  const stream = new Blob([fs.readFileSync(file)]).stream().pipeThrough(new DecompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const u16 = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
  const out = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) out[i] = halfToFloat(u16[i]);
  return { data: out, channels };
}
// Reference KLM decoder (container spec: blender/lib/encode.py). Output is what the runtime uploads directly:
// RGBA half-float bits (Uint16Array, alpha = 1.0 = 0x3C00), rows bottom-up, for a HalfFloatType DataTexture
// with flipY = false. Keep this in sync with src/render when lane B ports it.
export async function decodeKlm(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (String.fromCharCode(raw[0], raw[1], raw[2], raw[3]) !== 'KLM1') throw new Error('not a KLM1 file');
  const width = dv.getUint16(4, true), height = dv.getUint16(6, true), channels = raw[8], mantissaBits = raw[9];
  if (raw[10] !== 0 || raw[11] !== 1) throw new Error('unsupported KLM rowOrder/layout');
  const n = width * height * channels, lo = 16, hi = 16 + n;
  const out = new Uint16Array(width * height * 4);
  // undo byte-wise delta in place (running sum mod 256 across the low plane then the high plane)
  let acc = 0;
  for (let i = 16; i < hi + n; i++) acc = raw[i] = (acc + raw[i]) & 255;
  const plane = width * height;
  for (let c = 0; c < 4; c++) {
    if (c >= channels) {
      for (let p = 0; p < plane; p++) out[p * 4 + c] = 0x3c00;
      continue;
    }
    const base = c * plane;
    for (let p = 0; p < plane; p++) out[p * 4 + c] = raw[lo + base + p] | (raw[hi + base + p] << 8);
  }
  return { width, height, channels, mantissaBits, data: out };
}

function decodeExr(file) {
  const loader = new EXRLoader();
  loader.setDataType(FloatType);
  const t0 = performance.now();
  const r = loader.parse(ab(fs.readFileSync(file)));
  return { ...r, ms: performance.now() - t0 };
}

const report = { pattern: {}, orientation: {}, atlas: {} };

// ---------- 1. pattern round trip ----------
const pdir = path.join(dir, 'pattern');
const exp = JSON.parse(fs.readFileSync(path.join(pdir, 'f_expected.json'), 'utf8'));
const W = exp.width, H = exp.height;
console.log(`pattern ${W}x${H} (rows bottom-up in Blender)`);
for (const f of fs.readdirSync(pdir).filter((f) => f.endsWith('.exr')).sort()) {
  const codec = f.split('_')[1];
  const rgba = f.includes('_rgba');
  let r;
  try {
    r = decodeExr(path.join(pdir, f));
  } catch (e) {
    expect(false, `${f}: EXRLoader threw ${e.message}`);
    report.pattern[f] = { error: e.message };
    continue;
  }
  const chans = r.header.channels.map((c) => `${c.name}:${c.pixelType === 1 ? 'half' : c.pixelType === 2 ? 'float' : c.pixelType}`);
  let maxErr = 0, rowMatch = true;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      for (let c = 0; c < 4; c++) {
        const want = c === 3 ? (rgba ? exp.rgba[(y * W + x) * 4 + 3] : 1) : exp.rgba[(y * W + x) * 4 + c];
        const got = r.data[(y * W + x) * 4 + c];
        const e = Math.abs(got - want) / Math.max(1, Math.abs(want));
        maxErr = Math.max(maxErr, e);
      }
  // data row 0 must be Blender row 0 (bottom): G encodes the row.
  rowMatch = Math.abs(r.data[1] - 0.125) < 0.05 && Math.abs(r.data[((H - 1) * W) * 4 + 1] - (0.125 + 0.75 * (H - 1))) < 0.05;
  const lossless = !LOSSY.has(codec);
  const half = f.includes('f32') ? chans.every((c) => c.endsWith('float')) : chans.every((c) => c.endsWith('half'));
  expect(r.width === W && r.height === H && rowMatch && half && (lossless ? maxErr === 0 : maxErr < 0.5),
    `${f.padEnd(24)} ${r.header.compression.padEnd(17)} [${chans.join(' ')}] maxRelErr ${maxErr.toExponential(2)} row0=bottom ${rowMatch}`);
  report.pattern[f] = { compression: r.header.compression, channels: chans, maxRelErr: maxErr, row0IsBottom: rowMatch, lossless };
}
{
  const g = await readF16gz(path.join(pdir, 'f.f16.gz'));
  let maxErr = 0;
  for (let i = 0; i < W * H; i++) for (let c = 0; c < 3; c++) maxErr = Math.max(maxErr, Math.abs(g.data[i * 3 + c] - exp.rgba[i * 4 + c]));
  expect(maxErr === 0, `f.f16.gz (DecompressionStream + float16) exact: maxErr ${maxErr}`);
  report.pattern['f.f16.gz'] = { maxErr };
  const k = await decodeKlm(fs.readFileSync(path.join(pdir, 'f.klm')));
  let kErr = 0;
  for (let i = 0; i < W * H; i++) for (let c = 0; c < 4; c++) {
    const want = c === 3 ? 1 : exp.rgba[i * 4 + c];
    kErr = Math.max(kErr, Math.abs(halfToFloat(k.data[i * 4 + c]) - want));
  }
  const kRow0 = halfToFloat(k.data[1]) === 0.125;
  expect(k.width === W && k.height === H && kErr === 0 && kRow0, `f.klm (KLM1, DecompressionStream) exact: maxErr ${kErr}, row0=bottom ${kRow0}`);
  report.pattern['f.klm'] = { maxErr: kErr, row0IsBottom: kRow0 };
}

// ---------- orientation through glTF ----------
{
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  await MeshoptDecoder.ready;
  const gltf = await loader.parseAsync(ab(fs.readFileSync(path.join(pdir, 'quad.glb'))), '');
  const mesh = gltf.scene.getObjectByName('OrientQuad');
  const pos = mesh.geometry.attributes.position, uv1 = mesh.geometry.attributes.uv1;
  const tex = decodeExr(path.join(pdir, 'f_zip_rgb.exr'));
  // Texture addressing on both three backends for a DataTexture with flipY=false: data row 0 <-> v = 0.
  const sample = (u, v) => {
    const x = Math.min(W - 1, Math.floor(u * W)), y = Math.min(H - 1, Math.floor(v * H));
    return [...tex.data.slice((y * W + x) * 4, (y * W + x) * 4 + 3)];
  };
  const rows = [];
  let okUv = true, okDecode = true, rawMirrored = true;
  for (let i = 0; i < pos.count; i++) {
    const bu = (pos.getX(i) + 1) / 2, bv = (-pos.getZ(i) + 1) / 2; // Blender plane UV from Blender (x, y) = three (x, -z)
    const u = uv1.getX(i), v = uv1.getY(i);
    okUv &&= Math.abs(u - bu) < 1e-6 && Math.abs(v - (1 - bv)) < 1e-6;
    const want = [0.25 + 0.5 * Math.min(W - 1, Math.floor(bu * W)), 0.125 + 0.75 * Math.min(H - 1, Math.floor(bv * H))];
    const dec = sample(u, 1 - v), raw = sample(u, v);
    okDecode &&= dec[0] === want[0] && dec[1] === want[1];
    rawMirrored &&= raw[1] !== want[1];
    rows.push({ three_pos: [pos.getX(i), pos.getY(i), pos.getZ(i)].map((n) => +n.toFixed(3)), blenderUV: [bu, bv], uv1: [u, v], sampledG_decoded: dec[1], sampledG_raw: raw[1], wantG: want[1] });
  }
  expect(okUv, 'glTF TEXCOORD_1 = (u, 1 - v) of the Blender Lightmap UV');
  expect(okDecode, 'sampling EXR data at (uv1.x, 1 - uv1.y) hits the texel Blender baked (F upright)');
  expect(rawMirrored, 'sampling at raw uv1 would be vertically mirrored (so the flip is required)');
  // F check through the decode: top bar is Blender row 9 (x 3..9), stem x=3 rows 2..9.
  const fOk = [[3.5, 9.5], [9.5, 9.5], [3.5, 2.5], [7.5, 6.5]].every(([x, y]) => sample(x / W, y / H)[2] === 7)
    && sample(9.5 / W, 2.5 / H)[2] === 0.0625;
  expect(fOk, 'F pattern upright in decoded data (top bar at high v, stem on the left)');
  report.orientation = { okUv, okDecode, rawMirrored, fOk, vertices: rows, rule: 'lightmap sample uv = vec2(uv1.x, 1 - uv1.y); texture.flipY = false (EXRLoader default)' };
}

// ---------- 2. real atlases ----------
const adir = path.join(dir, 'atlas');
const keys = [...new Set(fs.readdirSync(adir).filter((f) => f.endsWith('.f16.gz')).map((f) => f.replace('.f16.gz', '')))].sort();
for (const key of keys) {
  console.log(`atlas ${key}`);
  const ref = await readF16gz(path.join(adir, `${key}.f16.gz`));
  const n = ref.data.length / 3;
  const row = {};
  for (const f of fs.readdirSync(adir).filter((f) => f.startsWith(key + '_') && f.endsWith('.exr')).sort()) {
    const codec = f.slice(key.length + 1).split('_')[0];
    let r;
    try {
      r = decodeExr(path.join(adir, f));
    } catch (e) {
      expect(false, `${f}: EXRLoader threw ${e.message}`);
      row[f] = { error: e.message };
      continue;
    }
    let maxAbs = 0, sumRel = 0, cnt = 0;
    const rels = [];
    for (let i = 0; i < n; i++)
      for (let c = 0; c < 3; c++) {
        const want = ref.data[i * 3 + c], got = r.data[i * 4 + c];
        const d = Math.abs(got - want);
        maxAbs = Math.max(maxAbs, d);
        if (want > 0.01) {
          const rel = d / want;
          sumRel += rel;
          cnt++;
          if ((i & 63) === 0) rels.push(rel);
        }
      }
    rels.sort((a, b) => a - b);
    const p99 = rels[Math.floor(rels.length * 0.99)] ?? 0;
    const lossless = !LOSSY.has(codec);
    const bytes = fs.statSync(path.join(adir, f)).size;
    expect(lossless ? maxAbs === 0 : true,
      `${f.padEnd(34)} ${(bytes / 1048576).toFixed(2).padStart(6)} MB  decode ${r.ms.toFixed(0).padStart(4)} ms  maxAbs ${maxAbs.toExponential(2)}  meanRel ${(sumRel / cnt).toExponential(2)}  p99Rel ${p99.toExponential(2)}`);
    row[f] = { bytes, decodeMs: Math.round(r.ms), maxAbs, meanRel: sumRel / cnt, p99Rel: p99, lossless };
  }
  for (const f of fs.readdirSync(adir).filter((f) => f.startsWith(key + '_m') && f.endsWith('.klm')).sort()) {
    const bytes = fs.readFileSync(path.join(adir, f));
    const t0 = performance.now();
    const k = await decodeKlm(bytes);
    const ms = performance.now() - t0;
    let maxRel = 0, sumRel = 0, cnt = 0;
    for (let i = 0; i < n; i++)
      for (let c = 0; c < 3; c++) {
        const want = ref.data[i * 3 + c];
        if (want > 0.01) {
          const rel = Math.abs(halfToFloat(k.data[i * 4 + c]) - want) / want;
          maxRel = Math.max(maxRel, rel);
          sumRel += rel;
          cnt++;
        }
      }
    const bound = k.mantissaBits >= 10 ? 0 : 2 ** -(k.mantissaBits + 1) * 1.001;
    expect(maxRel <= bound, `${f.padEnd(34)} ${(bytes.length / 1048576).toFixed(2).padStart(6)} MB  decode ${ms.toFixed(0).padStart(4)} ms  maxRel ${maxRel.toExponential(2)} (bound ${bound.toExponential(2)})  meanRel ${(sumRel / cnt).toExponential(2)}`);
    row[f] = { bytes: bytes.length, decodeMs: Math.round(ms), maxRel, meanRel: sumRel / cnt, mantissaBits: k.mantissaBits };
  }
  {
    const t0 = performance.now();
    await readF16gz(path.join(adir, `${key}.f16.gz`));
    row[`${key}.f16.gz`] = { bytes: fs.statSync(path.join(adir, `${key}.f16.gz`)).size, decodeMs: Math.round(performance.now() - t0) };
  }
  report.atlas[key] = row;
}
fs.writeFileSync(path.join(dir, 'check_exr.json'), JSON.stringify({ ok: failures === 0, ...report }, null, 2) + '\n');
if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log('check_exr: all ok');
