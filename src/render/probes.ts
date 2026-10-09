// Load-time LightProbeGrid bake for dynamic objects (docs/PLAN.md §2.5, research three-runtime Q4 / S6).
//  - Bake from the lightmapped static scene with bounces: 0 (lightmaps already contain bounced light) and with the
//    flashlight, characters and other dynamic objects hidden.
//  - The grid is a Light: once in the scene it lights every lit node material. Lightmapped materials must opt out
//    via material.lightsNode = lights([...runtime lights]) (excludeGridFromLightmapped) or indirect light doubles.
//  - bake() only SUBMITS GPU work and is synchronous; we follow it with an awaited 1×1 readback so the logged time
//    includes GPU execution. bake() is also the only place that registers LightProbeGridNode with the renderer's
//    node library → if it throws (e.g. an untested WebGL2 path) the grid must NOT be added to the scene.

import * as THREE from 'three/webgpu';
import { lights } from 'three/tsl';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import { LightProbeGridNode, ATLAS_PADDING } from 'three/addons/tsl/lighting/LightProbeGridNode.js';

export interface ProbeBakeOptions {
  /** Grid size in metres (centred on `center`). */
  size: [number, number, number];
  center: [number, number, number];
  /** Probes per axis. */
  counts: [number, number, number];
  cubemapSize: number;
  near?: number;
  far?: number;
  /** Objects hidden during the bake (flashlight, characters, dynamic props). */
  hide?: any[];
  /** Probes per bake() call; between chunks the main thread yields (no single 70 s task on WebGL2). 0 = one call. */
  chunk?: number;
  /** Yield between chunks (the level's nextFrame). */
  yieldFn?: () => Promise<void>;
}

export interface ProbeBakeResult {
  grid: any | null;
  probes: number;
  submitMs: number;
  /** Submit + GPU completion (awaited readback). */
  totalMs: number;
  /** False when the completion fence timed out (hidden tab on WebGL2): totalMs is then not meaningful. */
  fenced: boolean;
  error?: string;
}

let fenceTarget: any = null;
let fenceQuad: any = null;

/**
 * Waits until previously submitted GPU work has executed (queue order) via a 1×1 readback.
 * Resolves false on timeout: the WebGL2 backend polls its fence with requestAnimationFrame, which never fires in a
 * hidden/occluded tab.
 */
export async function gpuFence(renderer: any, timeoutMs = 5000): Promise<boolean> {
  fenceTarget ??= new THREE.RenderTarget(1, 1);
  fenceQuad ??= new THREE.QuadMesh(new THREE.MeshBasicNodeMaterial({ color: 0x000000 }));
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(fenceTarget);
  fenceQuad.render(renderer);
  renderer.setRenderTarget(prev);
  let timer = 0;
  const timeout = new Promise<boolean>((r) => (timer = window.setTimeout(() => r(false), timeoutMs)));
  const done = renderer.readRenderTargetPixelsAsync(fenceTarget, 0, 0, 1, 1).then(() => true);
  const ok = await Promise.race([done, timeout]);
  clearTimeout(timer);
  return ok;
}

export async function bakeProbeGrid(renderer: any, scene: any, o: ProbeBakeOptions): Promise<ProbeBakeResult> {
  const [w, h, d] = o.size;
  const [nx, ny, nz] = o.counts;
  const probes = nx * ny * nz;
  const grid = new LightProbeGrid(w, h, d, nx, ny, nz);
  grid.position.set(o.center[0], o.center[1], o.center[2]);
  grid.updateMatrixWorld(true);
  const hidden = (o.hide ?? []).filter((x) => x && x.visible);
  for (const x of hidden) x.visible = false;
  const t0 = performance.now();
  let submitMs = 0;
  try {
    const base = { cubemapSize: o.cubemapSize, near: o.near ?? 0.05, far: o.far ?? 20, bounces: 0 };
    const chunk = o.chunk && o.chunk > 0 ? o.chunk : probes;
    for (let start = 0; start < probes; start += chunk) {
      if (start > 0 && o.yieldFn) {
        for (const x of hidden) x.visible = true; // nothing else renders in between, but keep the scene sane
        await o.yieldFn();
        for (const x of hidden) x.visible = false;
      }
      const t1 = performance.now();
      grid.bake(renderer, scene, { ...base, start, count: Math.min(chunk, probes - start) });
      submitMs += performance.now() - t1;
    }
    const fenced = await gpuFence(renderer);
    const totalMs = performance.now() - t0;
    return { grid, probes, submitMs, totalMs, fenced };
  } catch (e) {
    grid.dispose?.();
    return { grid: null, probes, submitMs, totalMs: performance.now() - t0, fenced: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    for (const x of hidden) x.visible = true;
  }
}

/** Lightmapped materials only receive these runtime lights (never the probe grid). One shared LightsNode. */
export function excludeGridFromLightmapped(materials: Iterable<any>, runtimeLights: any[]): any {
  const node = lights(runtimeLights);
  for (const m of materials) {
    m.lightsNode = node;
    m.needsUpdate = true;
  }
  return node;
}

// ==== Shipped probe grids (docs/PERF-PLAN.md P1-4) ===============================================================
// The baked atlas (RenderTarget3D nx × ny × 7·(nz + 2·ATLAS_PADDING), RGBA half float — LightProbeGrid.js
// _ensureTextures) is exported once per asset build by `npm run probes` (scripts/qa/probes-export.mjs, headless
// Chrome) into public/assets/<tier>/probes.bin. At load the level fetches it, checks its key (hash of the level
// files' manifest hashes + layout + material spec + grid specs) and builds each grid from the data without baking;
// a missing / stale file falls back to the runtime bake. LightProbeGridNode only reads light.texture
// (texture3D, LightProbeGridNode.js:100-115), the bounding box and the resolution.
//
// File: "TKPG" | u32 version | u32 header bytes | header JSON | per grid: Uint16 halfs (RGBA, x fastest, then y,
// then atlas slice), 4-byte aligned.

export const PROBE_FILE_VERSION = 1;
export const PROBE_FILE = 'probes.bin';

export interface ProbeGridData {
  id: string;
  size: [number, number, number];
  center: [number, number, number];
  counts: [number, number, number];
  far: number;
  falloff: number;
  /** RGBA half floats, nx · ny · atlasDepth(nz) · 4. */
  data: Uint16Array;
}

export interface ProbeFile {
  key: string;
  grids: ProbeGridData[];
}

/** Atlas depth (slices) for nz probes along the grid's Z. */
export function atlasDepth(nz: number): number {
  return 7 * (nz + 2 * ATLAS_PADDING);
}

/** 64-bit (two FNV-1a 32 lanes) hex digest of the parts. Not cryptographic — a staleness check. */
export function probeKey(parts: string[]): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) {
      const c = p.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c ^ (i & 0xff), 0x01000193) >>> 0;
    }
    a = Math.imul(a ^ 0x1f, 0x01000193) >>> 0; // part separator
    b = Math.imul(b ^ 0x2f, 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export function encodeProbeFile(f: ProbeFile): Uint8Array {
  const header = new TextEncoder().encode(
    JSON.stringify({ key: f.key, grids: f.grids.map((g) => ({ id: g.id, size: g.size, center: g.center, counts: g.counts, far: g.far, falloff: g.falloff, halfs: g.data.length })) }),
  );
  const pad = (n: number) => (n + 3) & ~3;
  const headerBytes = pad(header.length);
  let total = 12 + headerBytes;
  for (const g of f.grids) total += pad(g.data.byteLength);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set([0x54, 0x4b, 0x50, 0x47], 0); // "TKPG"
  dv.setUint32(4, PROBE_FILE_VERSION, true);
  dv.setUint32(8, headerBytes, true);
  out.set(header, 12);
  for (let i = header.length; i < headerBytes; i++) out[12 + i] = 0x20; // JSON-safe padding
  let o = 12 + headerBytes;
  for (const g of f.grids) {
    out.set(new Uint8Array(g.data.buffer, g.data.byteOffset, g.data.byteLength), o);
    o += pad(g.data.byteLength);
  }
  return out;
}

/** null when the bytes are not a probe file of this version (e.g. an SPA fallback page). */
export function decodeProbeFile(buf: ArrayBuffer): ProbeFile | null {
  if (buf.byteLength < 12) return null;
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0x54 || u8[1] !== 0x4b || u8[2] !== 0x50 || u8[3] !== 0x47) return null;
  const dv = new DataView(buf);
  if (dv.getUint32(4, true) !== PROBE_FILE_VERSION) return null;
  const headerBytes = dv.getUint32(8, true);
  if (12 + headerBytes > buf.byteLength) return null;
  let h: { key: string; grids: Array<Omit<ProbeGridData, 'data'> & { halfs: number }> };
  try {
    h = JSON.parse(new TextDecoder().decode(u8.subarray(12, 12 + headerBytes)));
  } catch {
    return null;
  }
  const grids: ProbeGridData[] = [];
  let o = 12 + headerBytes;
  for (const g of h.grids) {
    const bytes = g.halfs * 2;
    if (o + bytes > buf.byteLength || g.halfs !== g.counts[0] * g.counts[1] * atlasDepth(g.counts[2]) * 4) return null;
    grids.push({ id: g.id, size: g.size, center: g.center, counts: g.counts, far: g.far, falloff: g.falloff, data: new Uint16Array(buf.slice(o, o + bytes)) });
    o += (bytes + 3) & ~3;
  }
  return { key: h.key, grids };
}

/** A LightProbeGrid from shipped data: the same light a bake() would leave behind, without the 6·N scene renders. */
export function gridFromData(renderer: any, g: ProbeGridData): any {
  const [nx, ny, nz] = g.counts;
  const grid = new LightProbeGrid(g.size[0], g.size[1], g.size[2], nx, ny, nz);
  grid.position.set(g.center[0], g.center[1], g.center[2]);
  grid.updateMatrixWorld(true);
  grid.updateBoundingBox();
  // what bake() does to make the grid a light the node library knows (LightProbeGrid.js:471-473)
  if (renderer.library.getLightNodeClass(LightProbeGrid) === null) renderer.library.addLight(LightProbeGridNode, LightProbeGrid);
  const tex = new THREE.Data3DTexture(g.data, nx, ny, atlasDepth(nz));
  tex.type = THREE.HalfFloatType;
  tex.format = THREE.RGBAFormat;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  grid.texture = tex;
  grid.falloff = g.falloff;
  return grid;
}

/** Reads a baked grid's atlas back (export side; WebGPU rows come 256-byte aligned — unpadded here). */
export async function readGridData(renderer: any, grid: any): Promise<Uint16Array> {
  const { x: nx, y: ny, z: nz } = grid.resolution;
  const depth = atlasDepth(nz);
  const out = new Uint16Array(nx * ny * depth * 4);
  const rt = grid._renderTarget;
  const webgpu = renderer.backend?.isWebGPUBackend === true;
  for (let z = 0; z < depth; z++) {
    const px: Uint16Array = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, nx, ny, 0, z);
    const rowHalfs = webgpu ? Math.ceil((nx * 8) / 256) * 128 : nx * 4;
    for (let y = 0; y < ny; y++) out.set(px.subarray(y * rowHalfs, y * rowHalfs + nx * 4), (z * ny + y) * nx * 4);
  }
  return out;
}
// ==== end shipped probe grids ====================================================================================
