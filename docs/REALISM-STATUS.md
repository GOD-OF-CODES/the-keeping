# Realism status (implementation of docs/REALISM-BACKLOG.md)

Each lane keeps its own section. Numbers come from `node scripts/shot.mjs` (headless Chrome, M1, WebGPU unless noted);
frame stats are the 320 px capture's mean luma (0-255), % black (< 12), % mid (60-190).

## Lighting builder 1 — camera + atmosphere (items 1, 2, 3, 4, 7, 8, 14, 15)

Status: done (all eight items), tuned over 14 headless rounds on Medium and Max, plus WebGL2 Medium, WebGL2 Low
(Direct path, fallback table) and WebGPU Low (FXAA path, metered: parlor 1.67, facade 12.2 — `r13`). 0 console
errors in every run. `npm run typecheck`, `npm test` (186/186), `npm run build` pass.

### Files
- `src/render/look.ts` — the live LOOK parameters (each default is a physical value with its source) and the
  `window.__game.look` tuning API (`?debug`): `look.set({...})`, `look.get()`, `look.meter()`, `look.snap()`;
  `look(heading, pitch)` still turns the camera (the playthrough uses it).
- `src/render/camera-fx.ts` — lateral CA (per-channel radial magnification, given in px at the frame corner), film
  finish (vignette × zero-mean multiplicative grain), white-balance gain.
- `src/render/exposure.ts` — exposure meter + eye adaptation.
- `src/world/atmosphere.ts` — sky background node (CIE overcast dome, cloud deck, fogged ground, treeline), fog,
  lightning sky/fog/shadow, white balance, exposure driver, Direct-path fallback exposures, `ROOM_EXPOSURE`.
- Hook points, each commented "LIGHTING lane": `pipeline.ts` (uniforms whiteBalance / sharpness / grainPerEV,
  `meterTexture`, CA before bloom, filmFinish), `presets.ts` (post values), `lights.ts` (moon/lightning intensity,
  flame core colour), `main.ts` (Atmosphere created in startLevel, `atmo.update` in world(), setPipeline, look API,
  exposure kick removed).

### Scenarios and evidence
- `scratch/light/look.mjs`: views parlor-table, parlor-window, parlor-wall-close, hall-door, upper-hall, upper-torch,
  upper-wall-torch-1m, facade-7m, yard-south, drive-house, horizon-west, `flash` (outdoor strike: pre / peak at
  0.167 s / after), `flash-in`, `pan` (TAAU while turning). `SWEEP='[{name, js, views?}]'` re-shoots per
  `look.set()` variant in one session; `GPU=1` adds `gpuFrameMs`.
- `scratch/light/abperf.mjs` + `ab.sh`: A/B GPU cost against `scratch/dist-light-base` (this lane reverted, PERF lane
  kept), alternating base/new sessions.
- Shots: baseline `scratch/light/base/`, rounds `scratch/light/r1` … `r11`, contact sheets `*/sheet*.jpg`.

### Items
| # | Item | Change | Before → after (evidence) |
|---|------|--------|----------------|
| 1 | Sharpen / CA | RCAS sharpness 1.2 + denoise (was 0.2 / 0.25 = con 0.87, near max). Own lateral CA: 1 px total R-B split at the frame corner (was ≈ 13 px), on the HDR texture before bloom — replaces r186 ChromaticAberrationNode, which wrapped the tone-mapped image in an extra full-screen RTT | dark halos on house/trees/mullions and magenta-green fringes gone: `base/med-07` vs `r4/med-06`; 1:1 crops `r6/crops.jpg`, candle `r10/candle-ab.jpg` |
| 2 | Moon / lightning directional | indoors 0 (was 0.0105 through the roof, 17× the upper-hall bake); outdoors moon **0** (was 0.07, 4× the exterior bake): a 0 / 0.01 / 0.015 sweep on the facade showed no visible difference once exposure adapts (`r8/moon.jpg`), so per the AD rule "0 if the bake sky reads" | facade now lit only by its bake + flash |
| 3 | Lightning | exposure stays put (old +18 % kick removed; the meter is frozen from the first pulse until 0.8 s after the last, in-flight readings dropped). Cloud base × 5 at the peak, lit unevenly by the cloud-deck noise; fog × 2 (was +0.3 grey ≈ ×10-15). Outdoor shadow: castShadow fixed from load (LightsNode key stable), 2048² ortho over a 60 m box round the player, `autoUpdate=false`, drawn once per strike, azimuth ±40° round L_LTN_SUN; peak 0.5 (was 2.2: at the adapted night exposure 2.2 read as daylight) | flat grey wash (`base/med-09`, mean 82.6) → lit storm clouds, porch-roof and tree shadows (`r9/flash.jpg`: shadow on vs intensity 0, black % 9.6 vs 5.7); pre 23 → peak 58 → after 23 |
| 4 | Eye adaptation | 64² log-luminance meter of the HDR scene texture every 0.25 s (async readback), centre-weighted (Gaussian σ 0.22 + 0.25 floor), histogram window 60-99.5 % (black voids ignored, a torch hotspot is metered), 0.3 log-mean + 0.7 arithmetic-mean blend; key 0.034 = 0.18 at −2.4 EV (night exposed under the meter, the day-for-night rule); clamp [0.7, 24] (+4.6 EV cap); τ 6 s brighten / 0.5 s darken; snap on cuts/teleports (> 2.5 m); Direct path (Low/WebGL2) uses a per-zone table | exposure (Medium): parlor 1.7-2.7, ground hall 3.7-5, facade 12-15, drive 7, yard 6.5, upper hall with torch ≈ 10-16, upper hall dark 24 (cap; mean 0.2 — the bake, items 9/10). Old: 1 everywhere, upper hall 97 % black, hall 82 % black → 70 % |
| 7 | Fog | FogExp2 0.006 (√3/D = 290 m at 5 % contrast; was 0.028 = 62 m), + 0.006 × mist, capped 0.012 (C6 mist 1.5 hits the cap); colour = horizon sky radiance (in-scatter ≈ sky), flash × 2 | distant trees fade instead of a wall of grey |
| 8 | Grain | amplitude 0.03 in linear light, multiplicative c·(1+g) (zero-mean, black stays black — the old additive ±0.06 clipped and lifted black by ~4/255), 1.5 px value noise, mid-tone bell 4L(1−L) + 0.15, +25 % per EV of exposure gain (×2.15 at the +4.6 EV cap). Applied on the display value as g/2.2 = the linear-light equivalent (display ≈ lin^(1/2.2)) | milky noisy blacks gone (`r9/grain.jpg`); the grain is now subtle at 1:1 |
| 14 | White balance | **3300 K** indoors (not the AD's 3000 K: at 3000 K the 2900 K torch rendered neutral-to-cyan; 3300 K keeps it faintly warm) / 4500 K outdoors, von Kries gain in linear sRGB at unit luminance, blended in mired with τ 0.33 s (95 % in 1 s) at doors. The candle-flame sprite core changed from (1, 0.85, 0.55) to its own ~1900 K white (1, 0.7, 0.3): under 3300 K WB the old cream core blew out blue-white (`r10/candle-ab.jpg`) | wallpaper cream/green and floor brown separate from the flame amber (`r3/sheet1.jpg`, `r9/mnr.jpg`); flame core warm white-yellow again (`r14/check.jpg` top) |
| 15 | Sky | background node = the bake's CIE overcast dome (Lz 0.00982, horizon Lz/3, 7500 K at unit luminance) × skyglow 1.3 at the horizon; cloud deck ±18 % luminance drifting with the wind; below the horizon the 0.001 cd/m² wet ground fogged by its distance from the eye; procedural treeline in the background shader: 160 crowns round the horizon at **140-230 m** (not the AD's 150-300 m: at fog 0.006 a 290 m line keeps < 5 % contrast and vanishes; 140 m keeps ≈ 50 %), heights 0.6-1.35 × 16 m, lacy bare tips, fogged by distance. No geometry, so the camera's 90 m far plane doesn't clip it | sky was 2.6× the bake's zenith with a hard black horizon; now matches the bake, crown silhouettes show through the rain (`dbg2/sheet.jpg`) and stand out in flashes |

### Performance (Medium, WebGPU, `gpuFrameMs(120)` × 3, median, two alternating sessions each, machine idle)
| View | base (lane reverted) | new | Δ |
|------|------|-----|---|
| parlor-table | 7.96 / 8.00 | 8.38 / 7.71 | +0.07 |
| hall-door | 6.82 / 6.79 | 6.93 / 6.61 | −0.04 |
| upper-torch | 6.74 / 6.74 | 6.85 / 6.58 | −0.02 |
| facade-7m | 7.28 / 7.24 | 7.65 / 7.33 | +0.23 |
| drive-house | 8.71 / 8.69 | 9.30 / 8.93 | +0.42 |
In-session toggles (r-perf): background node ≈ 0.1 ms, meter ≈ 0, lightning shadow sampling ≈ 0.1-0.2 ms. The CA move
removed one full-screen RTT pass. Budget (+1.5 ms) met everywhere.

### Known limits / interactions (not in this lane)
- Flashlight (#11): its colour is 0xfff1dc (≈ 5000 K, not 2900 K) and its 30 cd was tuned for exposure 1; under
  auto-exposure + 3300 K WB the hotspot reads white-cyan and clips at 1 m. The rig's own near-wall `gain` hack now
  overlaps with the meter. Needs a retune with the meter on.
- Upper floor stays black (mean 0.2 at the +4.6 EV cap) until items 9/10 (KLM floor, landing candle) land.
- The exposure meter material and the background material are two extra node builds at load (PERF `builds()`).
- TAAU reprojects the background with the background mesh's own (approximate) velocity; a 12-frame pan (0.02 rad
  per frame) on the final build showed no doubling of the treeline crowns or the trees, only TAA softness
  (`r14/check.jpg`, middle = start, bottom = mid-turn).
- `FALLBACK_EXPOSURE` (Low on WebGL2 only) values for G2/G1/outdoor are measured; U1/U4/CLOSET are guesses.
- Per-room exposure ranges live in `ROOM_EXPOSURE` (code, empty): the layout is lead-owned.

### Playthrough
`node scripts/shot.mjs --scenario scripts/qa/playthrough.mjs --preset medium --dist scratch/dist-light --wait 2`
stalls in **B08** ("wait by the bell", Ada in LOOK in U2, game 143.8 s → timeout 623.8 s), 0 console errors. The
same scenario on `scratch/dist-light-base` (the same working tree with this lane reverted) stalls at exactly the same
beat, game time and Ada state (`scratch/light/play-base.log`), so the stall comes from other in-flight changes (AI /
story), not from this lane. Before/after of its hero shots: `scratch/light/play/ab.jpg` (top base, bottom new): the
B02 facade flash goes from a flat grey wash to a lit storm sky with the house in shadow. In `upper-hall-ada` the faint
window seen in base is gone: the sky behind it now matches the bake (2.6× darker than the old SKY_COLOR, item 15)
and the exposure was still dark-adapting (τ 6 s) a few seconds after the lit ground hall; the hall itself is black
in both (bake, items 9/10).

## Lighting builder 2 — surfaces + light (items 5, 6, 11, 13, 16, 17, 18, 19 + the C7 clone crash)

Status: done — all items implemented and looked at over several rounds on Medium WebGPU, checked on Max WebGPU and
Medium WebGL2; 0 console errors in every run; `npm run typecheck`, `npm test` (188/188), `npm run build`
(verify-boot) pass. The playthrough stalls at B08 exactly like builder 1's (not this lane; see below). Scenarios: `scratch/light2/look.mjs` (views parlor-table/-floor/
-window/-mantel, hall-candle, kitchen, upper-torch, upper-wall-torch-1m, hall-torch-2m, facade-7m, porch,
drive-house; `SWEEP`/`GPU`), `cs2.mjs` (deterministic cutscene shots: `CS=C5 AT=17.62,20.62`), `ada.mjs`,
`feet.mjs`, `abperf.mjs`; sheets via `scratch/light2/ab.sh`. Baseline = builder 1's final build (`scratch/light2/base`).
Debug A/B switches (same build): `?refl=0` (no reflections), `?lmmodel=0` (stock lighting model on lightmaps),
`?bounce=0` (no torch bounce light), `?skin=0` (old skin/hair, no contact shadow). Live tuning: `window.__game.look`
gained candleSpec, specProxyLo/Hi, reflections, reflLod, torchCd/Core/Sigma2/Spill/Shelf/Tail/Angle/Penumbra/
Kelvin, bounce, twilightL/Zenith/Anti/E, openSkyE, rainRefract.

### Files
- new: `src/render/reflections.ts`, `src/render/flashlight-bounce.ts`, `src/render/surfaces.ts` (LOOK → uniforms per
  frame), `src/characters/skin.ts`, `tests/lightmap-material.test.ts`
- changed (mine): `src/render/lightmap-material.ts`, `src/render/flashlight.ts`, `src/materials/library/wood.ts`
- hook points (each commented "LIGHTING lane"): `main.ts` (reflections create/capture/attach + update, torch bounce,
  syncSurfaceLook, `?lmmodel`/`?bounce` switches), `lights.ts` (flicker light at full candela + `lmDiffuseShare`),
  `level.ts` (torch bounce in the two `lights([...])` lists), `flashlight-rig.ts` (bounce added to the scene),
  `story-runtime.ts` (torch `gain` hack removed; arms glow normalised by the base candela), `look.ts` (params,
  `minExposure` 0.25), `atmosphere.ts` (civil-twilight sky + fog), `cutscene-fx.ts` (C5 candle shadow-play, refractive
  windshield rain), `c5-face.ts` (C5 timing/torch/camera), `ada.ts` + `loader.ts` (skin/hair/contact shadow),
  `material-spec.json` (floor_varnished, lead-owned — sanctioned by the task).

### Items
| # | Item | Change | Before → after (evidence) |
|---|------|--------|----------------|
| C7 | `LightmapMaterial.clone()` crash | ctor defaults `(params = {}, lm = null)`; `copy()` nulls the lightmap fields before `NodeMaterial.copy` (it would `.copy()` into an existing texture), carries lmBase/lmFlash/flipV/multiplier/lmReflection (LightsNode via NodeMaterial.copy). `tests/lightmap-material.test.ts` (2 tests) | C7 played from t=0 (`car_trim` maroon clone): 0 errors, 0 exceptions (`scratch/light2/c7`) |
| 5 | Candle specular | `LightmapLightingModel extends PhysicalLightingModel`: for lights tagged `userData.lmDiffuseShare` (candle flicker lights) `direct()` runs into a temporary; diffuse × share, specular × `candleSpec` × proxy `smoothstep(0.3, 0.85, E_lightmap / E_candle-unoccluded)`; untagged lights (torch, lightning, cutscene lamps) unchanged. The flicker light runs at the full `base·(1 + 0.3k)` (0.8–0.95 cd), share = `0.22·max(0, 0.35+0.65k)/(1+0.3k)` → the diffuse flicker on walls is identical to before | specular was ≈ 8 % of physical, now 100 %; sweep off / spec / spec+refl `scratch/light2/s1/sweep.jpg` (hall wainscot and table varnish sheen); a candle on a table correctly throws no floor highlight under the tabletop (proxy) |
| 6 | Reflections | (WebGPU only; spec roughness < 0.5 — see deviations) 12 box-projected probes (11 rooms + car set) + the yard; 128² HalfFloat cubes with hardware mips captured once at load from the room centre (before the hook, so no reflection code is built in the cube context), lod = roughness × 7, `getParallaxCorrectNormal` with the room box; radiance only (never iblIrradiance — lightmap/probe grid is the diffuse); one material variant per (material, room) (44 clones; programs shared); boundary meshes (centre outside the room box: facade trim, window glass) mix room/yard cube by camera-in-room; glass: One/OneMinusSrcAlpha so the reflection is added over what shows through; yard × (1 + 4·flash); re-captured at dawn (C6/B12). Medium/Max only | night windows now mirror the lit room and the candles (`r2/crop-table.jpg`, `r5/ab.jpg`); wet porch boards reflect the yard sky (`r5/ab.jpg`). Tried and dropped: PMREM textureCubeUV (warm-up 6 → 63 s), per-object texture swap via onObjectUpdate (every mesh kept the first cube — exterior went orange, `r4/ext.jpg`, `t1/t.jpg`) |
| 11 | Flashlight | beam: hot core 0.87·exp(−r²/0.012) + flat spill shelf 0.13 to r 0.4 (fades by 0.95) + corona 0.02; 120 cd peak, cone 45° / penumbra 0.5, 2900 K; **≈ 21 lm** (`beamFlux()` integrates cookie × three's spot falloff; the old torch was ≈ 4 lm, the AD's 60 cd / 0.9 / 0.12 in the old cone only 2.3 lm), hot:spill 7.7:1. Bounce: 85° penumbra-1 unshadowed spot at the hit point aimed out along the hit normal (the hit surface is not relit), peak ρ·Φ/π, colour = hit material avgAlbedo (collision ray + Raycaster on the meshes whose box holds the hit). Torch `gain` dimming removed; `minExposure` 0.7 → 0.25 so the meter can follow a hot spot at 1 m (120 lux) | cyan/white disc → warm beam with a hot core and soft spill (`r3/torch.jpg`, sweep A–D `s2/sweep.jpg`) |
| 13 | Trim chips | trim underlayer = older paint [0.33, 0.30, 0.24] (was bare wood [0.10, 0.075, 0.05], 5:1 → ~1.5:1), bare wood only in rare deep chips, field density 0.1 | dark pox on the casings gone (`r3/trim.jpg`, base vs new 1:1); edge/height masks NOT done (UV-space generator has no geometry; needs a runtime chip channel in bind.ts — PERF's file) |
| 16 | Varnished floor | floor_varnished baseColor [0.10, 0.056, 0.028] → [0.17, 0.10, 0.055], avgAlbedo → [0.145, 0.086, 0.047] (bind.ts gain normalises to avgAlbedo, so both), spec roughness 0.42 → 0.35; generator film 0.2 → 0.3, wear path 0.62 → 0.45 | floor reads as aged oak, not black (`r3`, `max/`) |
| 17 | Ada | skin: `SkinLightingModel` wrap diffuse w 0.3, the extra wrapped light tinted [0.6, 0.25, 0.2]; wet film = clearcoat 0.5 / 0.12 (deviation from "sheen 0.2": three's sheen is the velvet lobe, a water film is a smooth dielectric layer). Hair: dual GGX R (0.2, untinted) + TRT (0.4, tinted, ½); the ±0.1 shift needs strand tangents the cards don't have (Kajiya-Kay on a fallback tangent lit the whole head grey — `ada/ab2.jpg`) — deviation. Contact shadow (no-GTAO presets): multiply quad parented to her group, ≤ 60 % within 0.3 m of each foot (fades as the foot lifts) + 25 % pelvis term | hair dark + wet sheen (`ada/ab3.jpg`); feet grounded (`feet/ab2.jpg`, off / on) |
| 18 | Rain on the windshield | the RainSim canvas is now a water-THICKNESS map; the glass shader refracts the scene behind (viewportSharedTexture at screenUV − 0.15·∇thickness: a drop is an inverted fisheye), drops −8 %, film +15 % scatter; streaks + wiper arcs as before | fake lit grey dots → dark/bright inverted-lens drops (`c1h/ab.jpg`, `c1h/ab2.jpg`); `rainRefract` 0.15 not 0.02 (0.02 did not cross the horizon: drops invisible) — deviation. House-window glass (bind.ts) not done |
| 19 | C5 / C6 | C5: the table candle stays lit and becomes the shadow-play candle at the cut to the wall: 1850 K, 0.95 cd, 0.4 m behind Ada, 2.1 m from the tally wall, at 2.05 m (heads land ≈ 2.9 m on the wall; Ada × 5.4, Harlan × 2.4), full diffuse share; torch off with the guttering candles; camera framed on the wall from the east (figures ≥ 1.4 m from the lens). C6/B12: civil-twilight sky (sun −4° east: 1.9 cd/m² low toward the sun, zenith × 0.3, anti-sun × 0.35, 4500/12 000 K), mist glows with it, exterior/car lightmaps get a sky fill `3 lux · tint · saturate(E_lm / 0.027)` (bake as sky visibility — the lantern is never multiplied), yard reflection cube re-captured at dawn | C5 wall shadows read at the second beat (`c5d/sheet.jpg`); C6 in-car blue hour (`c56.jpg`) |

### Performance (Medium WebGPU, `abperf.mjs`, `gpuFrameMs(120)` × 3 median; base = same build with `?refl=0&lmmodel=0&bounce=0&skin=0`)
The machine ran on battery (GPU clocks vary: the same build measured parlor 9.1–11.6 ms across sessions while the base
stayed 8.2–8.4), so four alternating pairs are listed; nC and an in-session re-measure (9.08) agree on ≈ +0.9 ms.
| View | base (bC / bD) | new (nC / nD) | Δ (nC) |
|------|------|-----|---|
| parlor-table | 8.33 / 8.16 | 9.25 / 10.90 | +0.92 |
| parlor-floor | 8.04 / 7.91 | 9.19 / 10.85 | +1.15 |
| kitchen | 3.78 / 3.65 | 4.02 / 4.33 | +0.24 |
| porch | 5.76 / 5.55 | 6.12 / 6.61 | +0.36 |
| upper-torch | 6.92 / 6.70 | 7.16 / 7.83 | +0.24 |
| facade-7m | 7.41 / 7.21 | 7.95 / 8.20 | +0.54 |
| drive-house | 9.39 / 9.03 | 9.81 / 10.36 | +0.42 |
With builder 1's lane (+0.07 parlor, +0.42 drive) the total stays ≤ +1.5 ms for nC and the in-session re-measure
(worst ≈ +1.2 parlor-floor) — but NOT for the slow sessions (nD: parlor +2.7, parlor-floor +2.9). The base keeps the
new 45° torch cone (≈ +0.46 ms on Max upper-torch vs 35°), so that cost is outside every Δ. Re-measure on mains. Measured and
fixed on the way: Ada's skin/hair cost ≈ 2.4 ms in the parlor first (3 GGX lobes × ~16 lights per character pixel)
→ hair reuses the stock lobe + 1 TRT lobe, the wet clearcoat is Max-only. Max upper-torch, one session: cone 45° 9.55,
35° 9.09, 27.7° 9.19 ms, bounce off 9.40 ms.
Load (Medium WebGPU): reflection capture 3.1–3.7 s (12 cubes; most of it is creating the pipelines of the cube render
context), +~110 GPU programs, one extra one-cube capture when the dawn sky comes up (C6/B12). compileAsync for the cube
context was tried and not faster. On WebGL2 the capture took 51 s (sync program compiles; the cube context's shaders
differ from the frame's) → no reflections on the WebGL2 fallback. Options for the PERF lane: ship the cubes like
probes.bin, or capture progressively (one face per frame) after the first frame.

### Verification
- C7 (`cs2.mjs`, `?scene=cutscene` preview): plays from t = 0 with the maroon trim clone — 0 errors.
- Playthrough (`scripts/qa/playthrough.mjs`, Medium): stalls in B08 "wait by the bell" (Ada LOOK in U2, game 144.4 s,
  1 death in B07) — the same beat, state and death as builder 1's run and its lane-reverted base; 0 console errors;
  the bot's LightmapMaterial.clone workaround never triggered (`scratch/light2/play.log`).
- WebGL2 Medium: parlor, porch, torch, C1 windshield render; 0 errors (`scratch/light2/gl/sheet.jpg`).
- Max WebGPU: all views, 0 errors (`scratch/light2/max/sheet.jpg`).
- C5 (`scratch/light2/c5g/sheet.jpg`): exposure snaps to 2.3 at the cut to the wall; head shadows at the first beat.
- Specular proxy, candleSpec × 10 (`scratch/light2/leak/sheet.jpg`): no leak behind walls (inside U4 and the closet stay
  black), highlights grow only where the candle reaches (kitchen table, hall floor/wainscot).
- C2 tableau (`scratch/light2/play/c2ab.jpg`, builder 1 vs now): Harlan is now warm-lit by the candle (full candela),
  no clipping.
- C6 (`scratch/light2/c6e/sheet.jpg`, left = QA's old frame): misty dawn gradient, wet ground reflecting the sky;
  the yard cube re-capture is logged ("re-captured EXT (dawn sky)").

### Deviations (kept, with the reason)
- Reflections: roughness < 0.5 (backlog < 0.6) for the Medium budget; WebGPU only (51 s capture on WebGL2).
- Wet-skin clearcoat Max-only (Medium keeps the wrap diffuse).
- Torch 120 cd / 45° (not 60 cd): the AD's numbers integrate to 2.3 lm in three's spot falloff, not 20 lm.
- `minExposure` 0.25 (builder 1's 0.7): the meter only goes below 0.7 for torch close-ups (flashes freeze it).
- Wet skin = clearcoat, not sheen; hair lobes unshifted (no tangents); rain refraction 0.15; trim chips without
  edge/height masks.
- L_CANDLE_TABLE no longer gutters in C5 (it IS the shadow-play candle), so the parlor keeps one candle into B12/C7.
- Characters see the candle flicker lights at their full candela now (story-runtime `flickerLights`), ≈ 4.5× brighter
  near candles than before — physically right (probes hold no direct candle light); `bindings.ts castShadow`'s
  `scaleLight(f, 4.5)` compensated the old 0.22 share, so the C2 tableau candle's specular is 4.5× physical (owner).

## AD review of the lighting round (fixes R2-F1, R2-F2; verdicts in REALISM-BACKLOG "Round 2")

Builds: `scratch/dist-review-base` (HEAD, before both lighting lanes) vs `scratch/dist-light-review` (the current
tree). Scenarios in `scratch/review/`; comparison sheets in `scratch/review/cmp/` (left = HEAD, right = now).

### Files
- `src/render/flashlight-bounce.ts`: R2-F1. The hit point and normal now come from the collision octree. The
  albedo sample is rate-limited and size-capped (≤ 4 meshes of ≤ 6000 triangles, re-sampled after a 0.25 m move
  or 15 trace frames). It was a per-frame BVH-less `Raycaster` over the 10⁴–10⁵-triangle room meshes.
- `src/render/lightmap-material.ts`: new `uParlorBake` (LM_PARLOR only).
- `src/render/exposure.ts`: new `requestExposureSnap()`.
- `src/render/look.ts`: new `c5Bake` = 0.18.
- `src/world/cutscene-fx.ts`: four commented hook lines in `silhouetteOn` / `silhouetteOff`.
- `docs/CONTRACT-CHANGES.md`: entry 39.

### Results
| Check | Before | After |
|---|---|---|
| Torch-on cost, Harlan's room (Medium, in-session) | 12.0 ms (torch off 6.5; skipping only the trace 8.0–8.5) | 7.6–8.0 ms (the ≈ 1 ms left over torch-off is more than HEAD's ≈ 0.1 ms: the 45° shadow frustum and the bounce light's shading) |
| Torch-on cost, clapboard at 2 m | 9.5 ms (off 5.4) | 5.8 ms |
| C5 head shadows on the tally wall | ≈ 1.25 : 1, exposure 1.27 at the first beat | hard-edged silhouettes from the first beat; exposure 3.8 at the cut |

C5 evidence: `cmp/c5a.jpg` (c5Bake sweep 1 / 0.3 / 0.18 / 0.08) and `cmp/c5c.jpg`. Torch evidence: `perf/sw3`,
`sw4` logs.

### Medium GPU vs HEAD (WebGPU, `gpuFrameMs(90)`, 3 alternating session pairs, on battery)
| View | HEAD (3 runs) | Now (3 runs) | Δ mean |
|---|---|---|---|
| facade-gate | 6.61 / 6.93 / 6.96 | 8.01 / 7.83 / 7.78 | **+1.04** |
| facade-7m | 5.82 / 6.84 / 6.45 | 6.25 / 6.13 / 6.27 | −0.15 |
| clapboard-torch | 4.81 / 5.33 / 6.11 | 5.71 / 5.89 / 5.97 | +0.44 |
| parlor-table | 6.20 / 5.98 / 6.32 | 7.93 / 7.79 / 7.81 | **+1.68 (over the +1.5 budget)** |
| parlor-wall | 3.68 / 3.66 / 3.80 | 3.96 / 3.98 / 4.00 | +0.27 |
| upper-hall-dark | 5.22 / 5.54 / 7.03 | 5.58 / 5.44 / 5.51 | −0.42 |
| upper-wall-torch | 4.90 / 4.79 / 5.04 | 5.13 / 5.12 / 5.25 | +0.26 |
| harlan-bedroom | 6.82 / 8.00 / 7.04 | 7.40 / 7.84 / 7.21 | +0.20 |

**parlor-table breakdown** (in-session, same clocks):
- The candle shadow maps cost ≈ 0.5 ms (7.3 → 6.7 ms with `castShadow` off; `perf/sw6`). Shadow sampling from
  load is PERF-PLAN P0-2's trade: no recompiles.
- `?refl=0&lmmodel=0&bounce=0&skin=0` changed it by only 0.05 ms (7.91 vs 7.86).
- Auto-exposure, post, lightning-shadow sampling, the sky background and the characters each change it by less
  than the noise (`perf/sw5`).
- About 1.2 ms is still unattributed. The tree under test also holds the PERF lane's in-flight changes, so its share
  can't be separated here.

All runs were on battery (throttled clocks). The absolute budget check needs a re-run on mains.

### Verification
- typecheck and build (verify-boot OK, boot chunk 12.4 kB gz) pass.
- 0 console errors in every review run: Medium/Max WebGPU, Medium WebGL2, the cutscenes, the playthrough.
- `npm test`: 186 pass, 2 fail, both in `materials-library.test.ts`. The in-flight `material-spec.json` now has
  82 materials (the test expects 68) and `vinyl_dash_black` has no calibration. That is the Blender lane's car work,
  not this round.
- The playthrough (`scratch/review/play.log`) stalls in B08 "wait by the bell", the same as both builders' runs and
  builder 1's lane-reverted base: Ada in LOOK in U2, game 622 s, 1 death in B07. B01–B08 and C1–C3 play with 0
  frame errors.
