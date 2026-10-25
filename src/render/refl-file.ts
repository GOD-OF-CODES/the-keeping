// LOAD round (#157b): the shipped reflection-cube file, public/assets/<tier>/reflections.bin (Medium + Max).
//
// Written by scripts/qa/refl-export.mjs (the game itself captures the cubes in headless Chrome, ?refl=capture, and
// reads mip 0 of every face back); read by src/render/reflections.ts, which writes the faces INTO the very
// CubeRenderTargets the runtime capture renders into and lets three generate the mip chain exactly as after a capture.
// Pure module (no three): the Node tests decode it too.
//
// Layout (little endian), then gzip'd as a whole (DecompressionStream at runtime; a server that already sent it
// with Content-Encoding: gzip hands us the raw bytes — both are accepted by the magic):
//   0  'TKRF'   4  u32 format (REFL_FILE_FORMAT)   8  u32 header bytes (JSON, space-padded to 4)
//   12 JSON { key, size, cubes: [{ id, state, halfs }] }
//   then per cube: `halfs` IEEE half floats = size² × 6 faces × RGB (face = array layer, rows exactly as
//   GPUQueue.copyTextureToBuffer returns them), each block padded to 4 bytes. Alpha is not stored (never sampled).

export const REFL_FILE = 'reflections.bin';
export const REFL_FILE_FORMAT = 1;
/**
 * Part of the shipped cubes' staleness key. Bump it (and re-run `node scripts/qa/refl-export.mjs`) after any CODE change
 * the cubes see that the key does not cover (the level files, layout, material spec and LOOK values are in it):
 * generated materials (src/materials), the lightmap / probe-lit materials, lights, the atmosphere sky / fog code, or the
 * capture itself (reflections.ts capture()).
 */
export const REFLECTIONS_VERSION = 1;

/** night = the load-time capture; dawn / night2 = the exterior's in-game re-captures (C5 26.6 → C6b). */
export type ReflState = 'night' | 'dawn' | 'night2';

export interface ReflCube {
  id: string;
  state: ReflState;
  /** size² × 6 × 3 half floats. */
  rgb: Uint16Array;
}

export interface ReflFile {
  key: string;
  size: number;
  cubes: ReflCube[];
}

export function isGzip(u8: Uint8Array): boolean {
  return u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b;
}

/** null when the bytes are not a reflection file of this format (e.g. an SPA fallback page). */
export function decodeReflFile(buf: ArrayBuffer): ReflFile | null {
  if (buf.byteLength < 12) return null;
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0x54 || u8[1] !== 0x4b || u8[2] !== 0x52 || u8[3] !== 0x46) return null; // "TKRF"
  const dv = new DataView(buf);
  if (dv.getUint32(4, true) !== REFL_FILE_FORMAT) return null;
  const headerBytes = dv.getUint32(8, true);
  if (12 + headerBytes > buf.byteLength) return null;
  let h: { key: string; size: number; cubes: Array<{ id: string; state: ReflState; halfs: number }> };
  try {
    h = JSON.parse(new TextDecoder().decode(u8.subarray(12, 12 + headerBytes)));
  } catch {
    return null;
  }
  if (typeof h?.key !== 'string' || !(h.size > 0) || !Array.isArray(h.cubes)) return null;
  const want = h.size * h.size * 6 * 3;
  const cubes: ReflCube[] = [];
  let o = 12 + headerBytes;
  for (const c of h.cubes) {
    const bytes = c.halfs * 2;
    if (c.halfs !== want || o + bytes > buf.byteLength) return null;
    cubes.push({ id: String(c.id), state: c.state, rgb: new Uint16Array(buf.slice(o, o + bytes)) });
    o += (bytes + 3) & ~3;
  }
  return { key: h.key, size: h.size, cubes };
}

/** gzip'd or raw bytes → the file (null: not one / not decompressible). Never throws. */
export async function readReflFile(buf: ArrayBuffer): Promise<ReflFile | null> {
  try {
    let b = buf;
    if (isGzip(new Uint8Array(buf, 0, Math.min(4, buf.byteLength)))) {
      const DS = (globalThis as { DecompressionStream?: new (f: string) => TransformStream<Uint8Array, Uint8Array> }).DecompressionStream;
      if (!DS) return null;
      b = await new Response(new Blob([buf]).stream().pipeThrough(new DS('gzip'))).arrayBuffer();
    }
    return decodeReflFile(b);
  } catch {
    return null;
  }
}

/** One RGBA16F face block (as read back) → RGB (alpha dropped). */
export function rgbaToRgb(rgba: Uint16Array, texels: number): Uint16Array {
  const out = new Uint16Array(texels * 3);
  for (let i = 0, j = 0, k = 0; i < texels; i++, j += 4, k += 3) {
    out[k] = rgba[j];
    out[k + 1] = rgba[j + 1];
    out[k + 2] = rgba[j + 2];
  }
  return out;
}

/** RGB half floats → RGBA16F with alpha = 1.0 (0x3c00), ready for GPUQueue.writeTexture. */
export function rgbToRgba(rgb: Uint16Array, texels: number): Uint16Array {
  const out = new Uint16Array(texels * 4);
  for (let i = 0, j = 0, k = 0; i < texels; i++, j += 4, k += 3) {
    out[j] = rgb[k];
    out[j + 1] = rgb[k + 1];
    out[j + 2] = rgb[k + 2];
    out[j + 3] = 0x3c00;
  }
  return out;
}
