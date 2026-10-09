// GPU texture baker (docs/PLAN.md §2.5): bakes a TSL generator (gen-types.ts) into two packed, tiling, mipmapped
// UnsignedByte textures with RenderTarget + QuadMesh — the one path that works on BOTH the WebGPU backend and the
// WebGL2 fallback (research three-runtime Q6a). No compute, no StorageTexture.
//
//   pass 1 (per-material shader)  generator → MRT scratch (HalfFloat, RepeatWrapping, no mips)
//                                   c = (albedo.rgb linear, roughness)   h = (height, ao, extra, puddle)
//   pass 2 (ONE shared shader)    finalize → MRT final (UnsignedByte, mipmapped, anisotropic, RepeatWrapping)
//                                   A = (albedo sRGB-encoded by the SRGB8/rgba8unorm-srgb format, roughness)
//                                   B = (tangent normal x·½+½, y·½+½ [NormalRGPacking], AO×cavity, extra|height)
//                                 The normal is a 3×3 Sobel of the height field in uv space (wrapping), scaled to
//                                 true metres (heightDepthM / texel size) → correct bump at any preset size.
//   pass 3 (shared)               measure: mip level log2(size/16) → 16×16 Float target → readback → mean albedo.
//                                 This is also the GPU fence (bake time = GPU-complete) and the ±10 % avgAlbedo check.
//                                 Generators are pre-trimmed by library/calibration.ts (measured table) so the raw error
//                                 stays within a few %; bind.ts multiplies by the residual `gain`.
//
// Rendering into a render target: no tone mapping, working (linear) colour space (Renderer.currentToneMapping /
// currentColorSpace), and sampling render-target textures is y-flip-normalised by three on both backends
// (TextureNode flipY uniform) — so generator uv == runtime sampling uv, and normals derived in uv space match.

import * as THREE from 'three/webgpu';
import { float, max, mrt, normalize, sqrt, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import type { MaterialSpec } from '../shared/material-types.ts';
import type { PresetConfig } from '../render/presets.ts';
import { extraKind, makeCtx, type Generator, type GenResult } from './gen-types.ts';
import { ALBEDO_CAL } from './library/calibration.ts';
import { ALBEDO_TOLERANCE, albedoDeviation, albedoGain, bakedBytes } from './albedo-check.ts';

export { ALBEDO_TOLERANCE, albedoDeviation, albedoGain, bakedBytes };

type N = any;

export interface BakedMaterial {
  id: string;
  size: number;
  /** albedo (sRGB texture) + roughness (alpha). */
  mapA: any;
  /** normal RG (NormalRGPacking) + AO (B) + extra/height (A). */
  mapB: any;
  extraKind: 'metal' | 'opacity' | 'height';
  /** Metres covered by one texture repeat (spec.tileMetres × super-tile factor). bind: repeat = 1 / repeatM. */
  repeatM: number;
  /** Measured mean linear albedo of mapA (before gain) and roughness mean. */
  measured: [number, number, number];
  roughnessMean: number;
  /** Per-channel gain that maps `measured` onto spec.avgAlbedo (clamped). */
  gain: [number, number, number];
  /** max per-channel relative deviation of the raw generator from spec.avgAlbedo (the ±10 % check). */
  albedoError: number;
  /** CPU submit time and GPU-complete time (ms). */
  submitMs: number;
  totalMs: number;
  /** Bytes on the GPU (both maps incl. mips). */
  bytes: number;
  dispose(): void;
}

export interface BakeProgress {
  done: number;
  total: number;
  id: string;
  ms: number;
}

/**
 * Reads a FloatType render target (small). WebGL2: synchronous readPixels — a true GPU fence incl. driver shader
 * compile; three's async path polls its fence with requestAnimationFrame, which Chrome throttles/pauses in occluded
 * or hidden tabs. WebGPU: mapAsync (not frame-dependent).
 */
export async function readFloatTarget(renderer: any, rt: any, w: number, h: number): Promise<Float32Array> {
  const be = renderer.backend;
  if (be?.isWebGLBackend && be.gl) {
    const gl = be.gl as WebGL2RenderingContext;
    const data = be.get(rt.texture);
    if (data?.textureGPU) {
      const out = new Float32Array(w * h * 4);
      const fb = gl.createFramebuffer();
      be.state.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, data.textureGPU, 0);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, out);
      be.state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
      await yieldTask(); // let input/status run between bakes (not timer-based: timers throttle to 1 s when hidden)
      return out;
    }
  }
  return renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
}

/** Yields to the event loop via MessageChannel (setTimeout is clamped to ≥1 s in hidden/occluded tabs). */
function yieldTask(): Promise<void> {
  return new Promise((res) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => res();
    ch.port2.postMessage(0);
  });
}

const MEASURE = 16;

export function textureSizeFor(spec: MaterialSpec, preset: PresetConfig): number {
  return spec.hero ? preset.textures.heroSize : preset.textures.baseSize;
}

export class MaterialBaker {
  readonly renderer: any;
  readonly anisotropy: number;
  readonly cache = new Map<string, BakedMaterial>();
  log = true;

  private quad: any;
  private quadVertex: any = null;
  /** Generator materials built ahead of their bake (precompile). */
  private prepared = new Map<string, { repeatM: number; res: GenResult; genMat: any }>();
  private scratch = new Map<number, any>();
  // finalize (shared)
  private fin: any = null;
  private finC: N;
  private finH: N;
  private uTexel = uniform(1 / 256);
  private uSlope = uniform(1); // heightDepthM / texelMetres
  private uCavity = uniform(0.5);
  private uDepthM = uniform(0.001);
  private uWet = uniform(0);
  // measure (shared)
  private meas: any = null;
  private measA: N;
  private uLevel = uniform(0);
  private measRT: any = null;

  constructor(renderer: any, anisotropy: number) {
    this.renderer = renderer;
    this.anisotropy = Math.min(anisotropy, renderer.getMaxAnisotropy?.() ?? anisotropy);
    this.quad = new THREE.QuadMesh();
  }

  private scratchFor(size: number): any {
    let rt = this.scratch.get(size);
    if (!rt) {
      rt = new THREE.RenderTarget(size, size, {
        count: 2,
        type: THREE.HalfFloatType,
        depthBuffer: false,
        generateMipmaps: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
      });
      rt.textures[0].name = 'c';
      rt.textures[1].name = 'h';
      for (const t of rt.textures) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = THREE.NoColorSpace;
      }
      this.scratch.set(size, rt);
    }
    return rt;
  }

  private finalizeMaterial(): any {
    if (this.fin) return this.fin;
    const ph = this.scratchFor(4);
    this.finC = texture(ph.textures[0]);
    this.finH = texture(ph.textures[1]);
    const cN = this.finC;
    const hN = this.finH;
    const t = this.uTexel;
    const slope = this.uSlope;
    const cav = this.uCavity;
    const wet = this.uWet;
    // Plain node graph (NOT inside Fn): the fragmentNode must itself be the MRT OutputStructNode.
    const outNode = (() => {
      const p = uv();
      const hs = (dx: number, dy: number) => hN.sample(p.add(vec2(dx, dy).mul(t))).x;
      const c = cN.sample(p);
      const h4 = hN.sample(p);
      // 3×3 Sobel (wrapping) → dh/du, dh/dv in height units per texel.
      const tl = hs(-1, 1), tc = hs(0, 1), tr = hs(1, 1);
      const ml = hs(-1, 0), mr = hs(1, 0);
      const bl = hs(-1, -1), bc = hs(0, -1), br = hs(1, -1);
      const gx = tr.add(mr.mul(2)).add(br).sub(tl.add(ml.mul(2)).add(bl)).mul(1 / 8);
      const gy = tl.add(tc.mul(2)).add(tr).sub(bl.add(bc.mul(2)).add(br)).mul(1 / 8);
      const puddle = h4.w.clamp(0, 1);
      const flat = float(1).sub(puddle.mul(0.97));
      const n = normalize(vec3(gx.mul(slope).mul(flat).negate(), gy.mul(slope).mul(flat).negate(), 1));
      // Cavity: how far below its neighbourhood (radius 2–5 texels) this texel sits.
      const r1 = 2.5;
      const r2 = 5;
      const ring = hs(r1, 0).add(hs(-r1, 0)).add(hs(0, r1)).add(hs(0, -r1)).add(hs(r2, r2)).add(hs(-r2, r2)).add(hs(r2, -r2)).add(hs(-r2, -r2)).mul(1 / 8);
      const depthBelowM = max(ring.sub(h4.x), 0).mul(this.uDepthM); // metres below the neighbourhood
      const cavity = float(1).sub(depthBelowM.div(-0.0012).exp()).mul(cav).clamp(0, 1);
      let albedo: N = c.xyz.mul(float(1).sub(cavity.mul(0.55)));
      let rough: N = c.w.add(cavity.mul(0.08));
      const ao: N = h4.y.mul(float(1).sub(cavity.mul(0.6)));
      // Surface wetness (spec.wetness): porous darkening (Lagarde), gloss; puddles near-black + mirror.
      const porosity = rough.clamp(0.1, 1);
      const w = wet.mul(porosity);
      albedo = albedo.mul(float(1).sub(w.mul(0.45)));
      rough = rough.mul(float(1).sub(wet.mul(0.55)));
      albedo = albedo.mul(float(1).sub(puddle.mul(0.55)));
      rough = rough.mul(float(1).sub(puddle)).add(puddle.mul(0.035));
      return mrt({
        a: vec4(albedo.clamp(0, 1), rough.clamp(0.02, 1)),
        b: vec4(n.x.mul(0.5).add(0.5), n.y.mul(0.5).add(0.5), ao.clamp(0, 1), h4.z.clamp(0, 1)),
      });
    })();
    const m = new THREE.NodeMaterial();
    m.name = 'bake-finalize';
    m.fragmentNode = outNode;
    m.depthTest = false;
    m.depthWrite = false;
    this.fin = m;
    return m;
  }

  private measureMaterial(): any {
    if (this.meas) return this.meas;
    const ph = this.scratchFor(4);
    this.measA = texture(ph.textures[0]);
    const m = new THREE.NodeMaterial();
    m.name = 'bake-measure';
    m.fragmentNode = vec4(this.measA.sample(uv()).level(this.uLevel));
    m.depthTest = false;
    m.depthWrite = false;
    this.meas = m;
    this.measRT = new THREE.RenderTarget(MEASURE, MEASURE, { type: THREE.FloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    return m;
  }

  private finalTarget(size: number, id: string): any {
    const rt = new THREE.RenderTarget(size, size, {
      count: 2,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    const [a, b] = rt.textures;
    a.name = 'a';
    b.name = 'b';
    a.colorSpace = THREE.SRGBColorSpace;
    b.colorSpace = THREE.NoColorSpace;
    for (const tx of rt.textures) {
      tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
      tx.anisotropy = this.anisotropy;
      tx.generateMipmaps = true;
      tx.minFilter = THREE.LinearMipmapLinearFilter;
      tx.magFilter = THREE.LinearFilter;
    }
    rt.texture.userData.materialId = id;
    return rt;
  }

  /** Bakes one material (cached by id + size). */
  /** Generator material for one bake (built once: precompile() and bake() share it). */
  private prepareGen(key: string, spec: MaterialSpec, gen: Generator, size: number, superTile: number): { repeatM: number; res: GenResult; genMat: any } {
    const hit = this.prepared.get(key);
    if (hit) return hit;
    const repeatM = spec.tileMetres * superTile;
    const ctx = makeCtx(spec, uv(), size, repeatM);
    const res: GenResult = gen(ctx);
    const genMat = new THREE.NodeMaterial();
    genMat.name = `bake-gen-${spec.id}`;
    genMat.fragmentNode = mrt({
      c: vec4(vec3(res.albedo).mul(vec3(...(ALBEDO_CAL[spec.id] ?? [1, 1, 1]))).clamp(0, 1), float(res.roughness).clamp(0.02, 1)),
      h: vec4(float(res.height).clamp(0, 1), res.ao !== undefined ? float(res.ao).clamp(0, 1) : 1, extraKind(spec) === 'height' ? float(res.height).clamp(0, 1) : res.extra !== undefined ? float(res.extra).clamp(0, 1) : float(spec.metalness), res.puddle !== undefined ? float(res.puddle).clamp(0, 1) : 0),
    });
    genMat.depthTest = false;
    genMat.depthWrite = false;
    // QuadMesh.render swaps its full-screen-triangle vertexNode in for the draw; set it for good so a precompile
    // (renderer.compileAsync on a stand-in mesh) builds the very program the bake then draws with.
    genMat.vertexNode = this.quadVertexNode();
    const p = { repeatM, res, genMat };
    this.prepared.set(key, p);
    return p;
  }

  /** The vertexNode QuadMesh.render uses (module-private in QuadMesh.js): read through a stand-in renderer. */
  private quadVertexNode(): any {
    if (this.quadVertex === null) {
      let v: any = null;
      this.quad.render({ render: (q: any) => (v = q.material.vertexNode) });
      this.quadVertex = v;
    }
    return this.quadVertex;
  }

  /**
   * PERF-PLAN P1-7: compiles the generator programs of a whole bake list in parallel (WebGPU createRenderPipelineAsync,
   * WebGL2 KHR_parallel_shader_compile) before the bakes run one by one — each bake otherwise waits for its own
   * program to compile on its readback fence. Same render context as the bake (scratch MRT target, call depth 0);
   * the target stays bound until every compile has resolved, because node builds run after compileAsync's awaits.
   */
  async precompile(items: Array<{ spec: MaterialSpec; gen: Generator; size: number; superTile?: number }>): Promise<void> {
    const r = this.renderer;
    const todo = items.filter((it) => !this.cache.has(`${it.spec.id}@${it.size}x${it.superTile ?? 1}`));
    if (!todo.length || typeof r.compileAsync !== 'function') return;
    const t0 = performance.now();
    const prevRT = r.getRenderTarget();
    const jobs: Promise<unknown>[] = [];
    r.setRenderTarget(this.scratchFor(todo[0].size)); // every scratch target has the same attachment state
    try {
      for (const it of todo) {
        const key = `${it.spec.id}@${it.size}x${it.superTile ?? 1}`;
        const { genMat } = this.prepareGen(key, it.spec, it.gen, it.size, it.superTile ?? 1);
        const stand = new THREE.Mesh(this.quad.geometry, genMat);
        stand.frustumCulled = false;
        jobs.push(r.compileAsync(stand, this.quad.camera).catch((e: unknown) => console.warn(`[materials] precompile ${it.spec.id} failed:`, e)));
      }
      await Promise.all(jobs);
    } finally {
      r.setRenderTarget(prevRT);
    }
    if (this.log) console.info(`[materials] precompiled ${todo.length} generator programs in ${(performance.now() - t0).toFixed(0)} ms`);
  }

  async bake(spec: MaterialSpec, gen: Generator, size: number, superTile = 1): Promise<BakedMaterial> {
    const key = `${spec.id}@${size}x${superTile}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const r = this.renderer;
    const t0 = performance.now();

    // ---- pass 1: generator → scratch
    const scratch = this.scratchFor(size);
    const { repeatM, res, genMat } = this.prepareGen(key, spec, gen, size, superTile);
    this.prepared.delete(key);
    const prevRT = r.getRenderTarget();
    r.setRenderTarget(scratch);
    this.quad.material = genMat;
    this.quad.render(r);

    // ---- pass 2: finalize → packed maps
    const fin = this.finalizeMaterial();
    this.finC.value = scratch.textures[0];
    this.finH.value = scratch.textures[1];
    const texelM = repeatM / size;
    this.uTexel.value = 1 / size;
    this.uSlope.value = (res.heightDepthM * (res.normalStrength ?? 1)) / texelM;
    this.uCavity.value = res.cavity ?? 0.5;
    this.uDepthM.value = res.heightDepthM;
    this.uWet.value = spec.wetness ?? 0;
    const rt = this.finalTarget(size, spec.id);
    r.setRenderTarget(rt);
    this.quad.material = fin;
    this.quad.render(r);

    // ---- pass 3: measure mean albedo from a small mip (also the GPU fence)
    const meas = this.measureMaterial();
    this.measA.value = rt.textures[0];
    this.uLevel.value = Math.max(0, Math.log2(size / MEASURE));
    r.setRenderTarget(this.measRT);
    this.quad.material = meas;
    this.quad.render(r);
    r.setRenderTarget(prevRT);
    const submitMs = performance.now() - t0;
    genMat.dispose();

    let measured: [number, number, number] = [...spec.avgAlbedo] as [number, number, number];
    let roughnessMean = spec.roughness;
    try {
      const px = await this.readMeasure();
      const s = [0, 0, 0, 0];
      const n = MEASURE * MEASURE;
      for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) s[k] += px[i * 4 + k];
      measured = [s[0] / n, s[1] / n, s[2] / n];
      roughnessMean = s[3] / n;
    } catch (e) {
      console.warn(`[materials] measure readback failed for ${spec.id}:`, e);
    }
    const totalMs = performance.now() - t0;
    const target = spec.avgAlbedo;
    const albedoError = albedoDeviation(measured, target);
    const gain = albedoGain(measured, target);

    const baked: BakedMaterial = {
      id: spec.id,
      size,
      mapA: rt.textures[0],
      mapB: rt.textures[1],
      extraKind: extraKind(spec),
      repeatM,
      measured,
      roughnessMean,
      gain,
      albedoError,
      submitMs,
      totalMs,
      bytes: bakedBytes(size),
      dispose: () => {
        rt.dispose();
        this.cache.delete(key);
      },
    };
    this.cache.set(key, baked);
    if (this.log) {
      const f = (v: number[]) => v.map((x) => x.toFixed(3)).join(',');
      const flag = albedoError <= ALBEDO_TOLERANCE ? 'ok' : `OFF ${(albedoError * 100).toFixed(0)}% → gain ${f(gain)}`;
      console.info(`[materials] ${spec.id} ${size}² ${totalMs.toFixed(1)} ms (submit ${submitMs.toFixed(1)}) albedo ${f(measured)} vs ${f(target)} ${flag}`);
    }
    return baked;
  }

  /**
   * Reads the 16×16 float measure target. WebGL2: a synchronous readPixels (a true GPU fence incl. driver shader
   * compile; three's async path polls its fence with requestAnimationFrame, which Chrome throttles/pauses in
   * occluded or hidden tabs). WebGPU: mapAsync (not frame-dependent).
   */
  private async readMeasure(): Promise<Float32Array> {
    return readFloatTarget(this.renderer, this.measRT, MEASURE, MEASURE);
  }

  /** Bakes a list in order; yields between materials. */
  async bakeAll(items: Array<{ spec: MaterialSpec; gen: Generator; size: number; superTile?: number }>, onProgress?: (p: BakeProgress) => void): Promise<BakedMaterial[]> {
    const out: BakedMaterial[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const b = await this.bake(it.spec, it.gen, it.size, it.superTile ?? 1);
      out.push(b);
      onProgress?.({ done: i + 1, total: items.length, id: it.spec.id, ms: b.totalMs });
    }
    return out;
  }

  /** Frees scratch targets and the shared materials (baked maps stay alive in the cache). */
  releaseScratch(): void {
    for (const rt of this.scratch.values()) rt.dispose();
    this.scratch.clear();
    this.fin?.dispose();
    this.fin = null;
    this.meas?.dispose();
    this.meas = null;
    this.measRT?.dispose();
    this.measRT = null;
  }

  dispose(): void {
    this.releaseScratch();
    for (const b of [...this.cache.values()]) b.dispose();
    this.cache.clear();
  }

  totalBytes(): number {
    let s = 0;
    for (const b of this.cache.values()) s += b.bytes;
    return s;
  }
}

/** Convenience: a tiny self-test generator — one raised dome at (0.3, 0.7) on a gradient; asymmetric on purpose. */
export const bumpTestGenerator: Generator = (c) => {
  const p = c.uv;
  const d = p.sub(vec2(0.3, 0.7)).length();
  const dome = sqrt(max(float(0.04).sub(d.mul(d)), 0)).mul(5); // 0..1 hemisphere of radius 0.2
  return {
    albedo: vec3(p.x.mul(0.6).add(0.2), 0.35, p.y.mul(0.6).add(0.2)),
    roughness: float(0.4),
    height: dome,
    heightDepthM: c.tile * 0.2, // a real hemisphere
    cavity: 0,
  };
};
