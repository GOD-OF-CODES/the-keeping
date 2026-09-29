// Preset recommender (pure: no DOM, no three.js). Tested by tests/recommend.test.ts.
//
// PLAN §2.3 rules — the tier comes from the GPU class and the benchmark; resolution never changes the tier
// (the preset table owns pixel ratio / scene scale):
//   - Apple base M1–M4 named by the browser                          → Medium
//   - Apple Pro/Max/Ultra, RTX xx60+ (30-series on), RTX 2070+, RX 6700+ → Max
//   - Intel UHD / Iris Xe / older AMD APUs                           → Low, promoted to Medium only if score ≥ 120
//   - newer iGPUs (Arc iGPU, Radeon 680M–890M) / entry dGPUs          → by score, capped at Medium
//   - masked / unknown (Safari "Apple GPU", Firefox buckets, …)       → by score (< 55 Low, ≥ 175 Max, else Medium)
//   - software renderer, failed major-performance-caveat, touch-only → Low
//   - deviceMemory ≤ 2 → Low; ≤ 4 → at most Medium; < 4 CPU threads → Low.
// Score = 100 · raw / REF[browser]; 100 = the dev Apple M1 (7-core GPU) in the same browser family.

import type { BrowserFamily, DeviceInfo, GpuClass, PresetId, Recommendation } from '../shared/types.ts';

/**
 * Raw benchmark (Mpix·iterations per ms, see benchmark.ts) measured on the dev M1 7-core per browser family.
 * chrome: calibrated 2026-09-30 in Chrome 154 on the dev M1 (batch cap 4096, ~35–42 samples, 1.5 s). Fresh page
 * loads measured 2039 / 1975 / 2102 / 2472; back-to-back re-runs with a warmed-up GPU 2490–2517. REF = 2250 puts
 * this M1 at ≈ 88–112 (the Medium band is 55–175). edge/safari/firefox/other are UNCALIBRATED copies of the Chrome value until
 * measured (Safari 18.6 drives the same Metal GPU, so it is a sane start; re-measure there).
 */
export const REF: Readonly<Record<BrowserFamily, number>> = {
  chrome: 2250,
  edge: 2250,
  safari: 2250,
  firefox: 2250,
  other: 2250,
};

export const THRESHOLDS = { LOW_MAX: 55, MAX_MIN: 175, IGPU_PROMOTE: 120 } as const;

const ORDER: readonly PresetId[] = ['low', 'medium', 'max'];
const minTier = (a: PresetId, b: PresetId): PresetId => ORDER[Math.min(ORDER.indexOf(a), ORDER.indexOf(b))];
const fromScore = (s: number): PresetId => (s >= THRESHOLDS.MAX_MIN ? 'max' : s >= THRESHOLDS.LOW_MAX ? 'medium' : 'low');

/** Normalised score, or null when the raw value is missing/invalid. Never NaN. */
export function scoreFromRaw(raw: number | null | undefined, browser: BrowserFamily): number | null {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
  const ref = REF[browser] ?? REF.other;
  if (!Number.isFinite(ref) || ref <= 0) return null;
  const s = (100 * raw) / ref;
  return Number.isFinite(s) ? s : null;
}

export interface GpuClassification {
  gpuClass: GpuClass;
  /** Cleaned-up model name, e.g. "Apple M1", "NVIDIA GeForce RTX 3060". */
  name: string;
  masked: boolean;
  /** Why this class was chosen (short phrase). */
  why: string;
  /** Tier cap for this class when decided by score (undefined = no cap). */
  capTier?: PresetId;
}

/** Strips ANGLE / Firefox wrappers from UNMASKED_RENDERER_WEBGL. */
export function cleanRendererString(raw: string): { name: string; masked: boolean } {
  const masked = /, or similar$/i.test(raw) || raw === 'Apple GPU' || raw === 'Mozilla' || raw === '';
  let s = raw.replace(/, or similar$/i, '').trim();
  const m = /^ANGLE \((.*)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(', ');
    s = parts.length > 1 ? parts[1] : parts[0];
  }
  s = s
    .replace(/^ANGLE Metal Renderer: /, '')
    .replace(/ \(0x[0-9a-fA-F]+\)/, '')
    .replace(/ Direct3D.*$/, '')
    .replace(/ vs_\d_\d ps_\d_\d.*$/, '')
    .split('/PCI')[0]
    .replace(/ OpenGL Engine$/, '')
    .trim();
  return { name: s, masked };
}

export function classifyGpu(rendererString: string, webgpu?: { vendor?: string; isFallbackAdapter?: boolean } | null): GpuClassification {
  const { name, masked } = cleanRendererString(rendererString);
  const n = name.toLowerCase();
  const wv = (webgpu?.vendor ?? '').toLowerCase();
  const C = (gpuClass: GpuClass, why: string, capTier?: PresetId): GpuClassification => ({ gpuClass, name: name || 'unknown GPU', masked, why, capTier });

  if (webgpu?.isFallbackAdapter || /swiftshader|llvmpipe|softpipe|basic render driver|software/.test(n)) {
    return C('software', 'software renderer');
  }
  if (/adreno|mali|powervr|xclipse|videocore|tegra/.test(n)) return C('igpu-old', 'mobile GPU', 'low');

  if (n.startsWith('apple')) {
    if (wv && wv !== 'apple') {
      return wv.startsWith('intel') ? C('igpu-old', `Intel-based Mac (WebGPU vendor "${wv}")`) : C('unknown', `Mac with ${wv} GPU`);
    }
    const a = /^apple m(\d+)( pro| max| ultra)?\b/.exec(n);
    if (a && !masked) return a[2] ? C('apple-pro', `Apple M${a[1]}${a[2].replace(/\b\w/, (c) => c.toUpperCase())}`) : C('apple-base', `Apple M${a[1]}`);
    return C('masked', 'Apple GPU (model hidden by the browser)');
  }

  if (n.includes('intel')) {
    if (!masked && /arc(\(tm\))? [ab]\d{3}/.test(n)) return C('dgpu-mid', 'Intel Arc discrete GPU');
    if (n.includes('arc')) return C('igpu-new', 'Intel Arc integrated graphics', 'medium');
    return C('igpu-old', 'Intel integrated graphics');
  }

  if (/nvidia|geforce|quadro|rtx|gtx/.test(n)) {
    if (masked) return C('masked', 'NVIDIA (model bucketed by the browser)');
    const x = /(rtx|gtx|gt|mx) ?a?(\d{3,4})/.exec(n);
    if (!x) return C('dgpu-mid', 'NVIDIA GPU');
    const num = Number(x[2]);
    const gen = Math.floor(num / 1000);
    const lvl = num % 100;
    const label = `NVIDIA ${x[1].toUpperCase()} ${num}`;
    if (x[1] === 'mx' || x[1] === 'gt') return C('igpu-new', `entry-level ${label}`, 'medium');
    if (x[1] === 'rtx' && ((gen >= 3 && lvl >= 60) || (gen === 2 && lvl >= 70))) return C('dgpu-high', label);
    return C('dgpu-mid', label);
  }

  if (/amd|radeon/.test(n)) {
    if (masked) return C('masked', 'AMD (model bucketed by the browser)');
    if (/radeon\(tm\) graphics|radeon graphics|vega \d|radeon r[2-7] /.test(n)) return C('igpu-old', 'older AMD APU graphics');
    if (/\b\d{3}m\b/.test(n) && !/rx|pro/.test(n)) return C('igpu-new', 'AMD RDNA APU graphics', 'medium');
    const x = /rx ?(\d{3,4})/.exec(n);
    if (!x) return C('dgpu-mid', 'AMD Radeon GPU');
    const k = Number(x[1]);
    if ((k >= 6700 && k < 7000) || (k >= 7700 && k < 8000) || k >= 9060) return C('dgpu-high', `Radeon RX ${k}`);
    return k >= 5000 ? C('dgpu-mid', `Radeon RX ${k}`) : C('igpu-new', `Radeon RX ${k}`, 'medium');
  }

  return C(masked ? 'masked' : 'unknown', masked ? 'GPU model hidden by the browser' : 'unrecognised GPU');
}

const titleCase = (p: PresetId) => p.toUpperCase();

/** Decide the preset. Never throws; tolerant of missing fields. */
export function recommend(d: DeviceInfo): Recommendation {
  const warnings: string[] = [];
  const cls = classifyGpu(d.rendererString, d.webgpu);
  const s = d.benchmarkScore;
  const ok = s != null && Number.isFinite(s);
  const scoreTier: PresetId | null = ok ? fromScore(s!) : null;
  let tier: PresetId;
  let basis: string;

  switch (cls.gpuClass) {
    case 'software':
      tier = 'low';
      basis = 'software rendering detected';
      break;
    case 'apple-base':
      tier = 'medium';
      basis = `${cls.name} GPU`;
      break;
    case 'apple-pro':
    case 'dgpu-high':
      tier = 'max';
      basis = `${cls.name} GPU`;
      break;
    case 'igpu-old':
      tier = cls.capTier === 'low' ? 'low' : ok && s! >= THRESHOLDS.IGPU_PROMOTE ? 'medium' : 'low';
      basis = `${cls.name} (${cls.why})`;
      break;
    case 'igpu-new':
      tier = minTier(cls.capTier ?? 'medium', scoreTier ?? 'low');
      basis = `${cls.name} (${cls.why})`;
      break;
    default:
      // masked, unknown, dgpu-mid
      tier = scoreTier ?? 'medium';
      basis = cls.masked ? `${cls.why}; decided by benchmark` : `${cls.name}`;
      if (!ok) warnings.push('The device test could not produce a score; defaulting to Medium.');
  }

  const facts: string[] = [basis];
  if (d.hardwareConcurrency > 0) facts.push(`${d.hardwareConcurrency} CPU threads`);
  if (d.screen) facts.push(`${d.screen.cssWidth}×${d.screen.cssHeight} @${round2(d.screen.dpr)}×`);
  if (ok) facts.push(`benchmark ${Math.round(s!)}`);

  if (!d.webgl2) {
    tier = 'low';
    warnings.push('WebGL 2 is not available in this browser; the game may not run.');
  }
  if (d.majorPerformanceCaveat) {
    tier = 'low';
    warnings.push('The browser reports slow or software graphics.');
  }
  if (d.touchOnly) {
    tier = 'low';
    warnings.push('Touch-only device: a keyboard and mouse are required.');
  }
  if (d.deviceMemoryGB != null && d.deviceMemoryGB <= 2) {
    tier = 'low';
    facts.push(`~${d.deviceMemoryGB} GB RAM`);
  } else if (d.deviceMemoryGB != null && d.deviceMemoryGB <= 4) {
    tier = minTier(tier, 'medium');
    facts.push(`~${d.deviceMemoryGB} GB RAM`);
  }
  if (d.hardwareConcurrency > 0 && d.hardwareConcurrency < 4) tier = 'low';
  if (!d.webgpu.available) warnings.push('WebGPU is unavailable here; the WebGL 2 fallback will be used.');

  return {
    preset: tier,
    gpuClass: cls.gpuClass,
    gpuLabel: cls.name,
    reason: `Recommended: ${titleCase(tier)} — ${facts.join(', ')}`,
    warnings,
  };
}

function round2(x: number): string {
  return String(Math.round(x * 100) / 100);
}
