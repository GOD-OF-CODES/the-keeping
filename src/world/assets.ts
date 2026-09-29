// Tier asset access: manifest (public/assets/<tier>/manifest.json, written by scripts/assets.mjs), byte-progress
// fetches, glTF parsing (GLTFLoader + MeshoptDecoder — the GLBs use EXT_meshopt_compression) and KLM lightmaps.
// Nothing here runs before the player picked a preset: src/world is only reached through the game's import().

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { AssetEntry, AssetManifest, PresetId } from '../shared/types.ts';

const BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

export function assetUrl(path: string): string {
  return BASE.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
}

export async function fetchManifest(tier: PresetId, signal?: AbortSignal): Promise<AssetManifest> {
  const res = await fetch(assetUrl(`assets/${tier}/manifest.json`), { signal, cache: 'no-cache' });
  if (!res.ok) throw new Error(`manifest ${tier}: HTTP ${res.status}`);
  const text = await res.text();
  if (text.trimStart().startsWith('<')) throw new Error(`manifest ${tier}: got HTML (no assets built for this tier)`);
  return JSON.parse(text) as AssetManifest;
}

/** Aggregated byte progress over many downloads (sizes from the manifest, so the bar is right from the start). */
export class ByteProgress {
  private loaded = new Map<string, number>();
  total = 0;
  onChange: ((loaded: number, total: number) => void) | null = null;
  expect(bytes: number): void {
    this.total += bytes;
  }
  set(key: string, bytes: number): void {
    this.loaded.set(key, bytes);
    this.onChange?.(this.sum(), this.total);
  }
  sum(): number {
    let s = 0;
    for (const v of this.loaded.values()) s += v;
    return s;
  }
}

/** fetch → ArrayBuffer with streamed progress (falls back to a plain arrayBuffer() when streams are unavailable). */
export async function fetchBytes(url: string, progress?: ByteProgress, key = url, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  if (!res.body || !progress) {
    const b = await res.arrayBuffer();
    progress?.set(key, b.byteLength);
    return b;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    n += value.byteLength;
    progress.set(key, n);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out.buffer;
}

let loader: any = null;

export async function parseGlb(bytes: ArrayBuffer, name = ''): Promise<any> {
  if (!loader) {
    await MeshoptDecoder.ready;
    loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  const gltf = await loader.parseAsync(bytes, '');
  gltf.scene.name = name || gltf.scene.name;
  return gltf;
}

export function manifestEntry(m: AssetManifest, id: string): AssetEntry | undefined {
  return m.files.find((f) => f.id === id);
}
