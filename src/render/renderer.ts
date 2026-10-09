// Renderer creation: backend decided BEFORE constructing the renderer (research.critique "backend selection").
//   1. ?backend=webgl or settings.forceWebGL → WebGL2.
//   2. Otherwise probe navigator.gpu.requestAdapter({powerPreference:'high-performance'}) (raced with a timeout).
//      Adapter → WebGPURenderer({ powerPreference: 'high-performance', antialias per preset }).
//   3. No adapter → WebGPURenderer({ forceWebGL: true, canvas, context }) with OUR webgl2 context, so the WebGL2
//      path also gets powerPreference (WebGLBackend ignores it otherwise). Attributes mirror WebGLBackend's own.
// Always on a fresh canvas (a canvas that ever had a webgl2 context can't give a webgpu one).
// Pixel ratio = min(devicePixelRatio, preset cap) — never devicePixelRatio directly. AgX, PCF shadows.

import * as THREE from 'three/webgpu';
import { antialiasingFor, type PresetConfig } from './presets.ts';

export const POWER_PREFERENCE = 'high-performance' as const;

export interface RendererInfo {
  renderer: any;
  canvas: HTMLCanvasElement;
  backend: 'webgpu' | 'webgl2';
  /** Why this backend was chosen (logged + shown in the debug overlay). */
  backendReason: string;
}

/** Per-stage texture/sampler limits the adapter offers (null: use the WebGPU defaults, 16). */
let adapterTexLimits: { maxSampledTexturesPerShaderStage: number; maxSamplersPerShaderStage: number } | null = null;

async function hasWebGPUAdapter(timeoutMs = 1500): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(o?: object): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    const a: any = await Promise.race([gpu.requestAdapter({ powerPreference: POWER_PREFERENCE }), new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
    const L = a?.limits;
    if (L) adapterTexLimits = { maxSampledTexturesPerShaderStage: Math.min(32, L.maxSampledTexturesPerShaderStage ?? 16), maxSamplersPerShaderStage: Math.min(32, L.maxSamplersPerShaderStage ?? 16) };
    return !!a;
  } catch {
    return false;
  }
}

export function effectivePixelRatio(preset: PresetConfig): number {
  return Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap);
}

export async function createRenderer(preset: PresetConfig, opts: { forceWebGL: boolean; parent: HTMLElement }): Promise<RendererInfo> {
  const canvas = document.createElement('canvas');
  canvas.className = 'tk-canvas';
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', outline: 'none' });
  canvas.tabIndex = -1;
  opts.parent.appendChild(canvas);

  let renderer: any;
  let reason: string;
  const wantWebGPU = !opts.forceWebGL && (await hasWebGPUAdapter());
  // Canvas MSAA only where the preset asks for it on this backend (PERF-PLAN P0-3: Low = MSAA on WebGL2, FXAA on
  // WebGPU). TAAU: "MSAA must be disabled when TAAU is in use". Debug/QA override on the Direct tier: ?aa=0|1.
  // The pipeline follows renderer.samples, so a WebGPU→WebGL2 init fallback without MSAA still gets FXAA.
  const aaParam = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('aa') : null;
  const aaMode = antialiasingFor(preset, wantWebGPU ? 'webgpu' : 'webgl2');
  const antialias = preset.pipeline === 'direct' && (aaMode === 'msaa' ? aaParam !== '0' : aaParam === '1');
  if (wantWebGPU) {
    // Character fragments on Max sample albedo + normal + the probe-grid atlases + every shadow map + a reflection
    // cube: 17 > the default 16 per stage (round 3 Max run: harlan_* pipelines invalid). Every WebGPU adapter we
    // target offers more (M1: 48) — ask for up to 32 when the adapter has them.
    renderer = new THREE.WebGPURenderer({ canvas, antialias, powerPreference: POWER_PREFERENCE, requiredLimits: adapterTexLimits ?? undefined });
    reason = 'WebGPU adapter available';
  } else {
    const context = canvas.getContext('webgl2', { powerPreference: POWER_PREFERENCE, antialias, alpha: true, depth: true, stencil: false });
    if (!context) throw new Error('Neither WebGPU nor WebGL 2 is available in this browser.');
    renderer = new THREE.WebGPURenderer({ canvas, context, forceWebGL: true, antialias, powerPreference: POWER_PREFERENCE });
    reason = opts.forceWebGL ? 'WebGL 2 forced (?backend=webgl / settings)' : 'no WebGPU adapter';
  }

  renderer.setPixelRatio(effectivePixelRatio(preset));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap was removed in the WebGPU renderer
  await renderer.init();

  const backend: 'webgpu' | 'webgl2' = renderer.backend?.isWebGPUBackend === true ? 'webgpu' : 'webgl2';
  if (wantWebGPU && backend !== 'webgpu') reason = 'WebGPU init failed; automatic WebGL 2 fallback';
  console.info(`[render] backend=${backend} (${reason}), pixelRatio=${renderer.getPixelRatio()}, antialias=${antialias}`);
  return { renderer, canvas, backend, backendReason: reason };
}
