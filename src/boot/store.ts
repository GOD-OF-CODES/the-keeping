// Persistence (localStorage). Every access is wrapped in try/catch: storage can throw or be empty in private
// windows, with blocked site data, or in previews. The game must work without it.
// Shared by the boot page and the game (pure; no three.js).

import { DEFAULT_SETTINGS, PRESET_IDS, type FpsCap, type Settings } from '../shared/types.ts';

const SETTINGS_KEY = 'the-keeping.settings.v1';
const BENCH_KEY = 'the-keeping.bench.v1';
const RERUN_KEY = 'the-keeping.rerun-device-test';
const CHOSEN_KEY = 'the-keeping.preset-chosen';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

const clamp = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);
const bool = (x: unknown, d: boolean) => (typeof x === 'boolean' ? x : d);

/** Loads settings, validating every field (unknown/missing values fall back to defaults). */
export function loadSettings(): Settings {
  const s: Settings = structuredClone(DEFAULT_SETTINGS);
  const raw = read(SETTINGS_KEY);
  if (!raw) return s;
  try {
    const o = JSON.parse(raw) as Partial<Settings>;
    if (o.preset && (PRESET_IDS as readonly string[]).includes(o.preset)) s.preset = o.preset;
    s.showFps = bool(o.showFps, s.showFps);
    if (o.fpsCap === 0 || o.fpsCap === 30 || o.fpsCap === 60) s.fpsCap = o.fpsCap as FpsCap;
    s.fpsCapDivisorMode = bool(o.fpsCapDivisorMode, s.fpsCapDivisorMode);
    s.reducedFlash = bool(o.reducedFlash, s.reducedFlash);
    s.captions = bool(o.captions, s.captions);
    s.subtitles = bool(o.subtitles, s.subtitles);
    s.mouseSensitivity = clamp(o.mouseSensitivity, 0.2, 3, s.mouseSensitivity);
    s.invertY = bool(o.invertY, s.invertY);
    s.fovDeg = clamp(o.fovDeg, 60, 85, s.fovDeg);
    s.forceWebGL = bool(o.forceWebGL, s.forceWebGL);
    if (o.volume && typeof o.volume === 'object') {
      for (const k of Object.keys(s.volume) as Array<keyof Settings['volume']>) s.volume[k] = clamp(o.volume[k], 0, 1, s.volume[k]);
    }
  } catch {
    /* corrupt JSON: defaults */
  }
  return s;
}

export function saveSettings(s: Settings): void {
  write(SETTINGS_KEY, JSON.stringify(s));
}

/** True once the player has explicitly started with a preset (so the saved preset overrides the recommendation). */
export function hasChosenPreset(): boolean {
  return read(CHOSEN_KEY) === '1';
}
export function markPresetChosen(): void {
  write(CHOSEN_KEY, '1');
}

export interface CachedBenchmark {
  raw: number;
  rendererString: string;
  browser: string;
  at: number;
}

const BENCH_MAX_AGE_MS = 14 * 24 * 3600 * 1000;

/** Cached raw benchmark for the same GPU + browser, unless stale or a re-run was requested. */
export function loadBenchmark(rendererString: string, browser: string): CachedBenchmark | null {
  if (read(RERUN_KEY) === '1') return null;
  const raw = read(BENCH_KEY);
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as CachedBenchmark;
    if (typeof b.raw !== 'number' || !Number.isFinite(b.raw) || b.raw <= 0) return null;
    if (b.rendererString !== rendererString || b.browser !== browser) return null;
    if (!(Date.now() - b.at < BENCH_MAX_AGE_MS)) return null;
    return b;
  } catch {
    return null;
  }
}

export function saveBenchmark(b: CachedBenchmark): void {
  write(BENCH_KEY, JSON.stringify(b));
  write(RERUN_KEY, null);
}

/** Used by the in-game pause menu: the next boot re-runs the device test. */
export function requestDeviceRerun(): void {
  write(RERUN_KEY, '1');
}
export function clearDeviceRerun(): void {
  write(RERUN_KEY, null);
}
