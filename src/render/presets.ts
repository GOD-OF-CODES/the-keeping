// THE preset table — the single source of truth for everything the graphics preset controls.
// The boot recommender only picks a PresetId; resolution, pipeline and asset sizes all come from here.
// Values are starting points from the plan (docs/PLAN.md §2.4) and get calibrated on the M1 (smoke test S5, M3).
// Pure data: no three.js imports, so the boot page may import it for the settings card.

import type { PresetId } from '../shared/types.ts';

export interface PresetConfig {
  id: PresetId;
  label: string;
  /** Cap applied to window.devicePixelRatio (never pass devicePixelRatio through uncapped). */
  pixelRatioCap: number;
  /** 'msaa' = MSAA 4x + DirectRenderPipeline; 'taau' = RenderPipeline with temporal AA upscaling. */
  antialiasing: 'msaa' | 'taau';
  pipeline: 'direct' | 'post';
  /** Scene-pass resolution scale (post pipeline only). */
  sceneScale: number;
  dynamicResolution: { enabled: boolean; min: number; max: number };
  post: {
    bloom: boolean;
    gtao: boolean;
    volumetricBeam: boolean;
    chromaticAberration: number; // strength, 0 = off
    filmGrain: number; // intensity
    vignette: number;
    sharpen: number;
    cutsceneDof: boolean;
    cutsceneMotionBlur: boolean;
  };
  textures: {
    /** Size of GPU-generated tiling textures for hero / non-hero materials. */
    heroSize: 512 | 1024 | 2048;
    baseSize: 256 | 512 | 1024;
    /** Baked unique textures (characters, hero props). */
    uniqueSize: 512 | 1024 | 2048;
    anisotropy: number;
  };
  lightmaps: { resolution: 1024 | 1536 | 2048; lightningFlashMaps: boolean };
  shadows: { flashlightMapSize: 512 | 1024 | 2048; radius: number };
  probes: { cubemapSize: 8 | 16 | 32; reflectionProbeSize: 0 | 64 | 128 };
  weather: { rainParticles: number };
  hair: { alphaMode: 'test' | 'hash' };
  targetFps: number;
  /** Approximate download for this tier (MB), shown on the settings card; replaced by the real manifest size at build. */
  downloadMB: number;
  summary: string;
}

export const PRESETS: Record<PresetId, PresetConfig> = {
  low: {
    id: 'low',
    label: 'Low',
    pixelRatioCap: 1,
    antialiasing: 'msaa',
    pipeline: 'direct',
    sceneScale: 1,
    dynamicResolution: { enabled: false, min: 1, max: 1 },
    post: { bloom: false, gtao: false, volumetricBeam: false, chromaticAberration: 0, filmGrain: 0.08, vignette: 0.35, sharpen: 0, cutsceneDof: false, cutsceneMotionBlur: false },
    textures: { heroSize: 512, baseSize: 256, uniqueSize: 512, anisotropy: 4 },
    lightmaps: { resolution: 1024, lightningFlashMaps: false },
    shadows: { flashlightMapSize: 1024, radius: 1.5 },
    probes: { cubemapSize: 8, reflectionProbeSize: 0 },
    weather: { rainParticles: 2000 },
    hair: { alphaMode: 'test' },
    targetFps: 30,
    downloadMB: 25,
    summary: 'Integrated graphics. MSAA, baked lighting, no post-processing chain.',
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    pixelRatioCap: 1,
    antialiasing: 'taau',
    pipeline: 'post',
    sceneScale: 0.75,
    dynamicResolution: { enabled: true, min: 0.6, max: 0.85 },
    post: { bloom: true, gtao: false, volumetricBeam: false, chromaticAberration: 0.35, filmGrain: 0.12, vignette: 0.4, sharpen: 0.2, cutsceneDof: true, cutsceneMotionBlur: false },
    textures: { heroSize: 1024, baseSize: 512, uniqueSize: 1024, anisotropy: 8 },
    lightmaps: { resolution: 2048, lightningFlashMaps: false },
    shadows: { flashlightMapSize: 1024, radius: 2 },
    probes: { cubemapSize: 16, reflectionProbeSize: 64 },
    weather: { rainParticles: 6000 },
    hair: { alphaMode: 'hash' },
    targetFps: 60,
    downloadMB: 60,
    summary: 'Apple M1-class and mid-range GPUs. Temporal upscaling, bloom, film grain, reflections.',
  },
  max: {
    id: 'max',
    label: 'Max',
    pixelRatioCap: 1.5,
    antialiasing: 'taau',
    pipeline: 'post',
    sceneScale: 0.667,
    dynamicResolution: { enabled: true, min: 0.55, max: 0.8 },
    post: { bloom: true, gtao: true, volumetricBeam: true, chromaticAberration: 0.35, filmGrain: 0.12, vignette: 0.4, sharpen: 0.25, cutsceneDof: true, cutsceneMotionBlur: true },
    textures: { heroSize: 2048, baseSize: 1024, uniqueSize: 2048, anisotropy: 16 },
    lightmaps: { resolution: 2048, lightningFlashMaps: true },
    shadows: { flashlightMapSize: 2048, radius: 2 },
    probes: { cubemapSize: 32, reflectionProbeSize: 128 },
    weather: { rainParticles: 12000 },
    hair: { alphaMode: 'hash' },
    targetFps: 60,
    downloadMB: 120,
    summary: 'Apple Pro/Max chips, RTX 3060 and up. Adds ambient occlusion, volumetric flashlight, lightning lightmaps.',
  },
};
