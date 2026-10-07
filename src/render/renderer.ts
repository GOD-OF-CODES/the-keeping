// Renderer creation: backend decided BEFORE constructing the renderer (research.critique "backend selection").
//   1. ?backend=webgl or settings.forceWebGL → WebGL2.
//   2. Otherwise probe navigator.gpu.requestAdapter({powerPreference:'high-performance'}) (raced with a timeout).
//      Adapter → WebGPURenderer({ powerPreference: 'high-performance', antialias per preset }).
//   3. No adapter → WebGPURenderer({ forceWebGL: true, canvas, context }) with OUR webgl2 context, so the WebGL2
//      path also gets powerPreference (WebGLBackend ignores it otherwise). Attributes mirror WebGLBackend's own.
// Always on a fresh canvas (a canvas that ever had a webgl2 context can't give a webgpu one).
// Pixel ratio = min(devicePixelRatio, preset cap) — never devicePixelRatio directly. AgX, PCF shadows.

import * as THREE from 'three/webgpu';
import type { PresetConfig } from './presets.ts';

export const POWER_PREFERENCE = 'high-performance' as const;

export interface RendererInfo {
  renderer: any;
  canvas: HTMLCanvasElement;
  backend: 'webgpu' | 'webgl2';
  /** Why this backend was chosen (logged + shown in the debug overlay). */
  backendReason: string;
}

async function hasWebGPUAdapter(timeoutMs = 1500): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(o?: object): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    const a = await Promise.race([gpu.requestAdapter({ powerPreference: POWER_PREFERENCE }), new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
    return !!a;
  } catch {
    return false;
  }
}

export function effectivePixelRatio(preset: PresetConfig): number {
  return Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap);
}

export async function createRenderer(preset: PresetConfig, opts: { forceWebGL: boolean; parent: HTMLElement }): Promise<RendererInfo> {
  // TAAU: "MSAA must be disabled when TAAU is in use." Debug/QA override: ?aa=0|1 (only meaningful on the MSAA tier).
  const aaParam = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('aa') : null;
  const antialias = preset.antialiasing === 'msaa' && aaParam !== '0';
  const canvas = document.createElement('canvas');
  canvas.className = 'tk-canvas';
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%', outline: 'none' });
  canvas.tabIndex = -1;
  opts.parent.appendChild(canvas);

  let renderer: any;
  let reason: string;
  const wantWebGPU = !opts.forceWebGL && (await hasWebGPUAdapter());
  if (wantWebGPU) {
    renderer = new THREE.WebGPURenderer({ canvas, antialias, powerPreference: POWER_PREFERENCE });
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
