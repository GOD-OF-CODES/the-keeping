// Cross-module contracts shared by the boot page, the game runtime and the build scripts.
// Keep this file free of three.js imports: the boot chunk depends on it.

export const PRESET_IDS = ['low', 'medium', 'max'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

/** 0 = uncapped (display rate). */
export type FpsCap = 0 | 30 | 60;

export interface Settings {
  preset: PresetId;
  showFps: boolean;
  fpsCap: FpsCap;
  /** Cap frames to refresh / round(refresh / cap) to avoid judder on 120/144 Hz displays. */
  fpsCapDivisorMode: boolean;
  reducedFlash: boolean;
  captions: boolean;
  subtitles: boolean;
  mouseSensitivity: number; // 0.2 .. 3, 1 = default
  invertY: boolean;
  fovDeg: number; // vertical FOV, 60 .. 85
  volume: { master: number; sfx: number; voice: number; music: number; ambience: number }; // 0..1
  /** Forces the WebGL2 backend even when WebGPU is available (debug / Safari parity). */
  forceWebGL: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  preset: 'medium',
  showFps: false,
  fpsCap: 60,
  fpsCapDivisorMode: true,
  reducedFlash: false,
  captions: true,
  subtitles: true,
  mouseSensitivity: 1,
  invertY: false,
  fovDeg: 70,
  volume: { master: 0.9, sfx: 1, voice: 1, music: 0.8, ambience: 0.9 },
  forceWebGL: false,
};

export type BrowserFamily = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other';

/** Everything the boot page learns about the device before any asset is downloaded. */
export interface DeviceInfo {
  browser: BrowserFamily;
  webgl2: boolean;
  majorPerformanceCaveat: boolean;
  /** UNMASKED_RENDERER_WEBGL or '' when unavailable. */
  rendererString: string;
  vendorString: string;
  webgpu: { available: boolean; vendor: string; architecture: string; isFallbackAdapter: boolean };
  deviceMemoryGB: number | null;
  hardwareConcurrency: number;
  touchOnly: boolean;
  screen: { cssWidth: number; cssHeight: number; dpr: number; backingMegapixels: number };
  /** Normalised benchmark score; 100 = the reference Apple M1 (7-core) in the same browser family. NaN never escapes: null if skipped. */
  benchmarkScore: number | null;
  benchmarkRaw: number | null;
}

export type GpuClass =
  | 'apple-base'
  | 'apple-pro'
  | 'dgpu-high'
  | 'dgpu-mid'
  | 'igpu-old'
  | 'igpu-new'
  | 'software'
  | 'masked'
  | 'unknown';

export interface Recommendation {
  preset: PresetId;
  gpuClass: GpuClass;
  gpuLabel: string;
  /** One human-readable sentence shown on the settings card. */
  reason: string;
  warnings: string[];
}

/** Per-tier asset manifest written by scripts/assets.mjs to public/assets/<tier>/manifest.json. */
export interface AssetManifest {
  tier: PresetId;
  generatedAt: string;
  totalBytes: number;
  files: AssetEntry[];
}

export interface AssetEntry {
  id: string;
  kind: 'level' | 'collision' | 'character' | 'prop' | 'lightmap' | 'texture' | 'voice' | 'voice-timing' | 'probes' | 'data';
  path: string; // relative to public/, e.g. "assets/medium/house_ground.glb"
  bytes: number;
  hash: string;
}
