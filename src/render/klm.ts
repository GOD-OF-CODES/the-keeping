// KLM lightmap container decoder (lead decision, docs/SMOKE.md S2; container spec: blender/lib/encode.py).
// Ported from the reference decodeKlm() in blender/tests/check_exr.mjs — keep the two in sync.
//
// File = gzip( header[16] | low-byte plane | high-byte plane ), both planes byte-wise delta-coded as ONE running
// sequence (low plane then high plane). Header: "KLM1", u16 width, u16 height, u8 channels, u8 mantissaBits,
// u8 rowOrder (0 = bottom-up, Blender order), u8 layout (1 = planar), 4 reserved bytes.
// Output: RGBA half-float bits (alpha 1.0 = 0x3C00), rows bottom-up — upload as-is to a HalfFloatType DataTexture
// with flipY = false and sample at (uv1.x, 1 − uv1.y) (LIGHTMAP_FLIP_V).
// Pure (no three.js) so tests can run it under Node (DecompressionStream is global in Node ≥ 18).

export interface KlmImage {
  width: number;
  height: number;
  channels: number;
  mantissaBits: number;
  /** RGBA half-float bit patterns, width × height × 4, rows bottom-up. */
  data: Uint16Array;
}

const HEADER = 16;

export async function gunzip(bytes: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Decodes already-gunzipped KLM bytes. Mutates `raw` (the delta decode is done in place). */
export function decodeKlmRaw(raw: Uint8Array): KlmImage {
  if (raw.byteLength < HEADER) throw new Error('KLM: truncated header');
  if (String.fromCharCode(raw[0], raw[1], raw[2], raw[3]) !== 'KLM1') throw new Error('KLM: bad magic (not a KLM1 file)');
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const width = dv.getUint16(4, true);
  const height = dv.getUint16(6, true);
  const channels = raw[8];
  const mantissaBits = raw[9];
  if (raw[10] !== 0 || raw[11] !== 1) throw new Error('KLM: unsupported rowOrder/layout');
  if (channels < 1 || channels > 4) throw new Error(`KLM: bad channel count ${channels}`);
  const plane = width * height;
  const n = plane * channels;
  const lo = HEADER;
  const hi = HEADER + n;
  if (raw.byteLength < hi + n) throw new Error('KLM: truncated payload');
  // Undo the byte-wise delta (running sum mod 256 across the low plane, then the high plane).
  let acc = 0;
  for (let i = HEADER; i < hi + n; i++) acc = raw[i] = (acc + raw[i]) & 255;
  const out = new Uint16Array(plane * 4);
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

/** Decodes a .klm file (gzip + KLM1). */
export async function decodeKlm(bytes: Uint8Array | ArrayBuffer): Promise<KlmImage> {
  return decodeKlmRaw(await gunzip(bytes));
}
