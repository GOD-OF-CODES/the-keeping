// Live "look" parameters: camera (exposure, lens, grain, white balance) and atmosphere (sky, fog, moon, lightning).
// One mutable object read every frame by src/render/exposure.ts and src/world/atmosphere.ts, so values can be swept
// inside ONE headless session instead of rebuilding (docs/REALISM-BACKLOG.md items 1-4, 7, 8, 14, 15):
//
//   window.__game.look.set({ fogDensity: 0.004, key: 0.1 })   → merges and returns the new values
//   window.__game.look.get()                                   → a copy of every value
//   window.__game.look.meter()                                 → last exposure meter reading
//   window.__game.look.snap()                                  → adapt exposure to the next reading instantly
//   window.__game.look(heading, pitch)                         → still the camera look() of the debug API
//
// Every default is a physical value with its source; presets only change the camera-side amounts (see initLook).

import type { PresetConfig } from './presets.ts';

export const LOOK = {
  // ---- Eye adaptation (item 4). The meter is the log-average scene luminance (cd/m², pre-exposure) of a 64×64
  // centre-weighted downsample; exposure = key / Lavg (Reinhard 2002 "key"), clamped to a room-aware range.
  autoExposure: true,
  /** Manual exposure when autoExposure is off (linear multiplier). */
  manualExposure: 1,
  /** Middle-grey key the meter drives the log-average to. 0.18 is a camera meter's grey; night scenes are exposed
   *  2-3 stops under it so they still read as night (the cinematographer’s day-for-night rule): 0.18 · 2^-2.4 = 0.034. */
  key: 0.034,
  /** Exposure clamp (linear). 24 = +4.6 EV: dark rooms read, but the halls stay frightening (AD cap). */
  // LIGHTING builder 2 (item 11): 0.7 → 0.25 — the torch at 1 m puts 120 lux on the wall (≈ 19 cd/m² at ρ 0.5):
  // at 0.7 its hot spot clipped to a texture-less disc; the meter only goes below 0.7 for torch close-ups (the flash
  // freezes it), so every other room keeps builder 1's exposures.
  minExposure: 0.25,
  maxExposure: 24,
  /** Metering histogram window (weighted percentiles of log luminance averaged): ignore the darkest half (black
   *  voids, ~60 %) and the top 0.5 % (flames, sparkles); a torch hotspot (~1-3 %) is metered: the room sinks. */
  meterLow: 0.6,
  meterHigh: 0.995,
  /** 0 = log-average (geometric mean) of the window, 1 = arithmetic mean (bright areas dominate). */
  meterMeanMix: 0.7,
  /** Highlight protect (runtime E review): the centre-weighted hpPct percentile of scene luminance may map to at most
   *  hpWhite × display white (pre-AgX). 0 = off. */
  // Measured (sw3): never binds in the 13 torch/lamp/candle test views (p98 ≤ 1.6× white at their exposure); it is a
  // clip guard for faces/props at < 0.5 m in the 2 kcd core (builder E request 4, Ada in the torch core).
  hpPct: 0.98,
  hpWhite: 3,
  /** Lowest exposure the highlight cap may set (linear; the room clamp's minExposure no longer binds it). */
  hpFloor: 0.03,
  /** Exposure compensation in EV on top of the meter. */
  biasEV: 0,
  /** Adaptation time constants (s). Rod dark adaptation is minutes; 6 s is a game-scale slow brightening.
   *  Light adaptation (pupil + cones) is ~0.1-0.5 s. */
  tauBrighten: 6,
  tauDarken: 0.5,
  /** Seconds the meter is frozen after a lightning pulse (a 100 ms flash over-exposes; the eye can't follow it). */
  flashHold: 0.8,

  // ---- Lens / film (items 1, 8)
  /** RCAS sharpness: 0 = maximum, 2 = none (SharpenNode). 1.2 → con = 2^-1.2 = 0.44, with denoise. */
  sharpen: 1.2,
  /** Lateral chromatic aberration: total red-blue split at the frame corner, px (real lenses ≤ 1-1.5 px). */
  caPx: 1,
  /** Film grain amplitude (fraction of the pixel value, linear light, mid-tones; ISO 800-1600 ≈ 2-4 %). */
  grain: 0.03,
  /** Extra grain per EV of exposure gain (a camera pushed +4.6 EV shows ~2× the grain). */
  grainPerEV: 0.25,
  bloom: 0.22,
  /** Glare high-pass threshold in EXPOSED (display) units (pipeline.ts bloom). Runtime E review: halation is light
   *  scattered in the lens/emulsion from EMITTERS and specular glints (10²–10⁵× a diffuse white), not from a lit
   *  diffuse surface. At 1.5 (AgX shoulder) a cloth in the 2 kcd torch core 0.5–1.3 m away (≈ 30× display white at the
   *  old 0.25 exposure floor) became a milky disc (PROPS-FINISH-AUDIT item 1, x2-dress). Raised so a diffuse surface
   *  the eye has adapted to (≤ 2–4× white) never glares while flames/bulbs/headlights/lightning windows still do. */
  // sw3 (runtime E review, medium, 0.25 exposure): the dress hot spot's centre-weighted p98 is only ≈ 0.8× display
  // white (log2 1.7 scene at exposure 0.25) — the close-ups are NOT clipped; the veil was the 1.5 threshold catching
  // the torch core. 3 = the core no longer veils the jerry cans / sign post / dress (sw3-09/10, 13/14), while a
  // candle flame (≈ 3–7 display) still carries its halo (sw3-25/26).
  // sg1 (runtime E review, Medium; scratch/rer2/gS1–gS3): the veil's real cause was the high pass forwarding T + excess —
  // a cloth crossing T in the torch core jumped from 0 to ≥ T of glare (a disc-shaped onset). With only the EXCESS
  // scattering (glareBase 0, film halation: light the emulsion can't hold), T 3 left the candle flame with no halo and
  // T 1.5 put a faint veil back on the dress; 2 keeps a soft flame halo and a clean, folded dress.
  bloomThreshold: 2,
  /** Fraction of the threshold forwarded to the glare with the excess (pipeline.ts GLARE_BASE): 1 = stock r186 high
   *  pass (T + excess → hard onset), 0 = only the excess above T scatters (no step at T). */
  glareBase: 0,
  vignette: 0.4,

  // ---- White balance (item 14): camera WB in kelvin per zone, blended in mired over ~1 s at doors.
  wbIndoorK: 3300,
  wbOutdoorK: 4500,
  /** 0 = no white balance (D65 render), 1 = full von Kries balance to the zone kelvin. */
  wbStrength: 1,
  /** Blend time constant (s): 1 - e^(-1/0.33) = 95 % in 1 s. */
  wbTau: 0.33,

  // ---- Sky (item 15) — the bake's CIE overcast dome (blender/house/scene_prep.py SKY_LZ 0.00982 cd/m², 7500 K):
  // L(θ) = Lz (1 + 2 cos θ) / 3, so the horizon is Lz / 3 = 0.0033 cd/m².
  skyLz: 0.00982,
  skyKelvin: 7500,
  /** Town/skyglow brightening toward the horizon (×, at the horizon; fades out by ~15° elevation). */
  skyGlow: 1.3,
  /** Cloud-deck luminance variation (× fractal noise, ~±0.5 → ±18 % at 0.35). */
  skyCloud: 0.35,
  /** Wet ground below the modelled terrain: E 0.027 lux × albedo 0.12 / π = 0.001 cd/m² (scene_prep GROUND_L). */
  groundL: 0.001,
  /** Distant treeline: radius range (m) and canopy height (m) of bare deciduous woodland. At fog 0.006 (σ 0.0135 /m,
   *  Beer–Lambert e^-σr) a treeline at 140 m keeps ~15 % contrast, at 230 m ~4 % — it fades into the rain like a real one. */
  treeR0: 140,
  treeR1: 230,
  treeH: 16,
  /** Bark radiance: 0.027 lux sky × albedo 0.08 / π ≈ 0.0007, half of it on the vertical faces. */
  treeL: 0.0005,

  // ---- Fog (item 7; Beer–Lambert since round 3, atmosphere.ts): D keeps the FogExp2 visibility meaning V = √3 / D:
  //      0.006 → 290 m (heavy night rain), mist 0.012 → 145 m; extinction σ = 3.912 / V = 2.26·D.
  fogDensity: 0.006,
  fogMist: 0.006,
  /** Haze in-scatter radiance relative to the horizon sky (single-scatter albedo of rain/mist ≈ 0.9-1). */
  fogScale: 1,

  // ---- Moon and lightning (items 2, 3)
  /** Outdoor shadowless moon fill (DirectionalLight, lux). The bake already carries the 0.0028-lux moon + 0.024-lux
   *  sky (lightmaps and probes); a 0 / 0.01 / 0.015 sweep on the facade showed no visible difference once exposure
   *  adapts (scratch/light/r8/moon.jpg), so per the AD rule ("0 if the bake sky reads") it is 0. Indoors always 0. */
  moon: 0,
  /** Lightning DirectionalLight peak (lux-like, × flash level) outdoors. The old 2.2 was set for exposure 1; at the
   *  dark-adapted night exposure (≈ 7-15) it lit the lawn like daylight. 0.5 over-exposes the frame by ~1.3 EV at the
   *  peak — a flash, with hard shadows — and the exposure doesn't follow it. */
  // Runtime E review (lt1, Medium: facade / road / yard strikes): 0.5 with flashSky 5 left the shadows at ≈ half the lit
  // level — an overcast-day wash, not a stroke. A visible stroke is a near-point source: the shadow side is lit only by
  // the cloud base, ≥ 2 stops under the lit side. 0.75 / 2.5 keeps the same total peak (direct 7.5 + fill 2.5 vs
  // 5 + 5 sky units) with a 4:1 lit:shadow ratio; the sky still flashes +1.3 EV.
  lightningPeak: 0.75,
  /** Cloud-base glow at the flash peak (× the sky), and the fog's (× its colour). */
  flashSky: 2.5,
  flashFog: 2,
  /** Azimuth jitter per strike around L_LTN_SUN (degrees, ±). */
  flashAzimuthJitter: 40,
  /** Outdoor lightning shadow on/off (the map is drawn once per strike). */
  flashShadow: true,

  // ---- LIGHTING builder 2: surfaces + light (items 5, 6, 11; synced each frame by src/render/surfaces.ts)
  /** Candle specular on lightmapped surfaces, × the physical value (item 5: 1 = the candle's full candela). */
  candleSpec: 1,
  /** Specular shadow proxy ramp: E_lightmap / E_candle-unoccluded from lo (no highlight) to hi (full). */
  specProxyLo: 0.3,
  specProxyHi: 0.85,
  /** Box-projected room / yard reflections, × physical (item 6). */
  reflections: 1,
  /** Reflection blur: cube mip = roughness × reflLod (128² cube → mip 7 = 1 px). */
  reflLod: 7,
  /** Flashlight (item 11): peak candela, cookie core weight / σ² (r normalised to the cone) / spill shelf weight /
   *  shelf fade start, cone half-angle (deg), penumbra, bulb colour temperature (K), bounce × physical (ρΦ/π). */
  // Runtime AD review (round D, 2026-10-09): CLAUDE.md's 1990s 2-cell D krypton torch — ≈ 27 lm, peak 2–3 kcd, hot
  // centre + soft spill. The old 120 cd / 16 cd-shelf profile (item 11, chosen before auto-exposure existed) had no
  // throw: 2.8 lux on the U1 end wall at 6.5 m, no hot spot on Ada. Now 2000 cd, core HWHM 2.9° (σ² 0.0036), spill
  // shelf 7 cd, corona 1.6 cd: 30.9 lm (beamFlux). The exposure meter handles the clipped near hot spot.
  torchCd: 2000,
  torchCore: 1,
  torchSigma2: 0.0036,
  torchSpill: 0.0035,
  torchShelf: 0.4,
  torchTail: 0.0008,
  torchAngle: 45,
  torchPenumbra: 0.5,
  torchKelvin: 2900,
  bounce: 1,
  /** Civil twilight (item 19, C6 / B12 blue hour; × the story's sky tint 0..1). Sun 4° below the horizon: sky
   *  radiance low toward the sun ≈ 1.9 cd/m² (horizontal illuminance ≈ 3 lux), zenith × 0.3, anti-sun × 0.35. */
  twilightL: 1.9,
  twilightZenith: 0.3,
  twilightAnti: 0.35,
  /** Twilight sky fill on exterior lightmaps (lux): E += twilightE × tint × saturate(E_lm / openSkyE). */
  twilightE: 3,
  /** The bake's open-sky irradiance (lux): 0.024 overcast night sky + 0.0028 moon (builder 1). */
  openSkyE: 0.027,
  /** Windshield drops (item 18): screen-space refraction per unit water-thickness slope. A 2–4 mm drop is a
   *  short fisheye: its image is a flipped, minified view of a wide field behind it (the backlog's 0.02 of the
   *  screen did not cross the horizon — drops were invisible, r1), so 0.15. */
  rainRefract: 0.15,
  /** AD review — C5 shadow-play: the parlor bake (LM_PARLOR) scale while the one moved table candle is the only
   *  light. The bake holds the mantel + sill + table candles at full steady power ("baked light can't go out"),
   *  so after they gutter the tally wall kept ≈ 3 candles of ghost light and the head shadows read ≈ 1.25 : 1.
   *  What is left is the moved candle's own indirect light (≈ 1/3 of the bake's candles × ≈ 0.5 indirect share). */
  c5Bake: 0.18,
};

export type LookParams = typeof LOOK;

/** Camera-side defaults per preset (the post amounts only exist where the chain does). */
export function initLook(preset: PresetConfig): void {
  LOOK.grain = preset.post.filmGrain;
  LOOK.caPx = preset.post.chromaticAberration;
  LOOK.sharpen = preset.post.sharpen;
  LOOK.vignette = preset.post.vignette;
}

/** Turns the debug `look(heading, pitch)` function into the tuning API as well (properties on the function). */
export function attachLookApi(target: any, extra: { meter: () => unknown; snap: () => void }): any {
  const api = target ?? {};
  api.params = LOOK;
  api.get = () => ({ ...LOOK });
  api.set = (v: Partial<LookParams>) => {
    for (const [k, x] of Object.entries(v ?? {})) {
      if (!(k in LOOK)) throw new Error(`look: unknown parameter '${k}'`);
      (LOOK as Record<string, unknown>)[k] = x;
    }
    return { ...LOOK };
  };
  api.meter = extra.meter;
  api.snap = extra.snap;
  return api;
}
