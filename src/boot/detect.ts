// Device detection for the boot page (raw WebGL2 + navigator.gpu only; no three.js, no network).
// The WebGL2 context created here is reused by the benchmark and released (WEBGL_lose_context) before the game
// module is imported. powerPreference MUST match the game renderer ('high-performance', see render/renderer.ts),
// otherwise a dual-GPU laptop is benchmarked on one GPU and plays on the other.

import type { BrowserFamily, DeviceInfo } from '../shared/types.ts';

export const POWER_PREFERENCE = 'high-performance' as const;
const WEBGPU_TIMEOUT_MS = 1500;

export interface DetectResult {
  info: DeviceInfo;
  /** Benchmark context (null when WebGL2 is unavailable). Call releaseContext() before starting the game. */
  gl: WebGL2RenderingContext | null;
}

export function browserFamily(ua = navigator.userAgent): BrowserFamily {
  if (/Edg\//.test(ua)) return 'edge';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/(Chrome|Chromium|CriOS)\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'safari';
  return 'other';
}

function isTouchOnly(): boolean {
  try {
    const uad = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
    if (uad?.mobile) return true;
    if (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) return true;
    // iPadOS in desktop mode reports a Mac UA with touch points.
    if (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) return true;
  } catch {
    /* ignore */
  }
  return false;
}

async function probeWebGPU(): Promise<DeviceInfo['webgpu']> {
  const none = { available: false, vendor: '', architecture: '', isFallbackAdapter: false };
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(o?: object): Promise<any> } }).gpu;
  if (!gpu) return none;
  try {
    const adapter: any = await Promise.race([
      gpu.requestAdapter({ powerPreference: POWER_PREFERENCE }),
      new Promise<null>((r) => setTimeout(() => r(null), WEBGPU_TIMEOUT_MS)),
    ]);
    if (!adapter) return none;
    const i = adapter.info ?? {};
    return {
      available: true,
      vendor: String(i.vendor ?? '').toLowerCase(),
      architecture: String(i.architecture ?? ''),
      isFallbackAdapter: Boolean(i.isFallbackAdapter ?? adapter.isFallbackAdapter),
    };
  } catch {
    return none;
  }
}

export async function detect(): Promise<DetectResult> {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = screen.width || window.innerWidth;
  const cssHeight = screen.height || window.innerHeight;
  const attrs: WebGLContextAttributes = { powerPreference: POWER_PREFERENCE, antialias: false, depth: false, stencil: false, alpha: false };

  let caveat = false;
  let gl = document.createElement('canvas').getContext('webgl2', { ...attrs, failIfMajorPerformanceCaveat: true });
  if (!gl) {
    const retry = document.createElement('canvas').getContext('webgl2', attrs); // fresh canvas for the retry
    if (retry) caveat = true;
    gl = retry;
  }

  let rendererString = '';
  let vendorString = '';
  if (gl) {
    try {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      rendererString = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
      vendorString = String(gl.getParameter(dbg ? dbg.UNMASKED_VENDOR_WEBGL : gl.VENDOR) ?? '');
    } catch {
      /* ignore */
    }
  }

  const webgpu = await probeWebGPU();
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

  const info: DeviceInfo = {
    browser: browserFamily(),
    webgl2: !!gl,
    majorPerformanceCaveat: caveat,
    rendererString,
    vendorString,
    webgpu,
    deviceMemoryGB: typeof mem === 'number' && Number.isFinite(mem) ? mem : null,
    hardwareConcurrency: navigator.hardwareConcurrency || 0,
    touchOnly: isTouchOnly(),
    screen: { cssWidth, cssHeight, dpr, backingMegapixels: (cssWidth * dpr * cssHeight * dpr) / 1e6 },
    benchmarkScore: null,
    benchmarkRaw: null,
  };
  return { info, gl };
}

/** Frees the benchmark GPU context before the game creates its renderer. */
export function releaseContext(gl: WebGL2RenderingContext | null): void {
  if (!gl) return;
  try {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    /* ignore */
  }
}
