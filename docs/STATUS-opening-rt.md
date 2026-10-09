# STATUS — opening runtime builder 1 ("make C1 visible, cabin lighter + detailed")

Build dir: `scratch/dist-open1`. Scenarios/shots: `scratch/open1/`.
Shared tree with realism-r3 lane (surgical hooks only in its files).

## Progress
| # | Item | Status | Notes |
|---|---|---|---|
| 1 | layout/spec/voice §10, road-rc9.json, materials, calibration, tests | done | 0 layout errors; calibration merged; npm test green |
| 2 | sedan_interior v2 in moving car, DRIVER_EYE camera, arms/proxy | done | opening.ts car_mount; r3/r5 frames 2 s, 20 s; C6 mount NOT done |
| 3 | halogen low beams §7.2 | partial | cd cookie + cut-off + hibeam + lit rain; no volumetric beam cone, no rain in the truck's beams |
| 4 | windscreen rain/wipers/spray, lantern, tail lamps | partial | drops image a wide field + 500 px/m; spray/wiper streak arc/lantern §7.7 untouched; tail colour only |
| 5 | dome beat + exposure | done | L_DOME 170° Lambertian, exposure fx; r5 24.5 s shows the seat dressing |
| 6 | cabin materials (crack scale, fuel lamp, hood hex) | partial | craze 4.5 mm, rim constant, tight fuel lamp; hood hex not reproduced yet |
| 7 | corridor props + culling, car drive, gate halt, C1→B02 | done (perf partial) | corridor.ts culler; car track on road-rc9; gate stop verified (car 2.8,−30.2); 54 s over budget before far-45 fix |

## Log
- attempt 1: fresh start (no prior status file).
- item 1 (layout): build-layout.mjs: L_HEADLIGHT_L/R (car-space ±0.58, 2.43, 0.64 on the gate sedan; cd 15000, beam
  halogen_low, 3200 K, watts kept = cd·4π), L_DASH spot (0.1 cd, 35°), L_DOME (38 cd, 80°, 2800 K), L_CAB_VEIL (1 cd,
  70°, 3400 K), L_TRUCK_HI_L/R (35 kcd, 3300 K; fallback pos at truck local ±0.82, 10.3, 1.22), L_LANTERN 150 W, CAR
  ceiling 1.34, P_NEXT_SERVICES text "CARVEL 48". layout-types.ts LightDef: optional cd/beam/angle (logged).
  materials.mjs: grass_wet albedo [0.09,0.12,0.06], new grass_dead; cloth_dark → source constant (Max baked memory
  1003 → <1000 MB). build-voices.mjs: c1_preacher / c1_interstate / c1_dim. rc9.mjs definition() →
  src/shared/road-rc9.json (segments identical to scratch/opening/road-rc9.json, no polyline). validate-layout 0 errors.
  npm test: 4 fails before calibration (count fixed → 85; calibration pending; c1 voice triggers wait for the C1 rewrite).
- item 6 (part): cloth.ts carInterior crazing 3 cm → 4.5 mm cells (0.3 mm hairlines) in 3.5 cm patches, `sunCraze` read;
  new constant spec `plastic_wheel_tan` — the steering's car_interior_tan slot is overridden at runtime (no crazing).
  New dedicated generators src/materials/library/opening.ts: headliner_cloth, carpet_auto, styrofoam, plastic_cluster, fur_deer.
- items 2/3 (code): src/render/headlamps.ts (procedural cd cookie on light.colorNode: low beam lobes + soft US cut-off,
  hibeam lobe uniform, truck high beam; shadows Max 2 / Med 1 / Low 0), src/world/opening.ts (fx car_mount / dome /
  hibeam / stall / exposure; cabin LightsNode = exterior lights + L_DOME/L_DASH/L_CAB_VEIL; veil follows beams × film),
  exposure.ts EXPOSURE_CUE hook (hold/min/max), lights.ts hook (cd, angle, CAR → interior, L_TRUCK → P_RC9_TRUCK),
  cutscene-fx.ts rain blades follow the mounted car. Typecheck clean. Not yet seen in-game (Chrome lock busy).
- C1 rewritten to §4 (75 s, 13 shots S1–S11, named C1_SHOTS.pov/rooms + c1VehicleTrack() on road-rc9 via new
  src/cutscenes/road.ts (matches rc9.mjs < 1 mm)); arms only in car-space shots; car_mount per shot (proxy only in
  exterior shots); dome 18.4–28.6, hibeam flashes, truck fx (opening.ts moves P_RC9_TRUCK 316→651 m, axles spin, high
  beams on), stall colour, exposure cues per §5.2. C7 re-pointed (interior on the static CAR set, sign POV mounted).
  Tests: C1 duration bound 60 → 80 s, host test steps 77 s. Remaining fail: calibration (matlab run queued on the lock).
- item 7 (code): src/world/corridor.ts culls details_corridor chunk nodes (extras lod/chunk/s_range) by the camera's
  chainage: L0 ≤ 220 m, L1 ≤ 520 m, L2 ≤ 900 m, chunks behind a ground camera hidden, all on from z > 40 m (aerial).
- item 3/4 (code): src/world/beam-rain.ts — rain streaks lit only by our low beams (pattern × 15 kcd / d² × 0.03,
  1500/3000/5000 streaks L/M/Max, car-space box 1.2–40 m ahead); windscreen drops now image a wide field (two wide
  taps, brighter wins) so lamps become points of light in the drops.
- audio: new recipes radio_seek (SEEK sweep with carrier chirps) + truck_pass (diesel + Doppler + two-note air horn), cued in C1.
- item 6: fuel lamp halo 26 px disc → 12 px tight leak; v2 `-lamp_<warn>` nodes lit at §5.1 luminances (fuel 80 cd/m²;
  BATT/OIL after the stall). Tail lamps red-orange (1, 0.13, 0.035) so AgX keeps them red. tests/road-rc9.test.ts (3 tests).
- checks: typecheck clean; npm test 192/193 (calibration pending matlab); build + verify-boot OK
  (scratch/dist-open1-build); assets --check ok (Low 24.88 / 27 MB).
- look 1 (scratch/open1/r1, Medium WebGPU, 0 console errors): the road, verges, centre line, forest walls and the
  detailed cabin (rim, binnacle, cluster, A-pillars) are VISIBLE now (was "nothing"). Problems found: lit rain far too
  bright/dotted (SCATTER 0.03 → 0.0025, thinner); our own headlamp lens boxes poke over the hood (hidden in POV);
  dome light dark — L_DOME sits inside its lens which shadowed the cabin (lens castShadow off); S3 insert blocked by
  the rim (camera drops to look through the rim's upper opening); cluster canvas laid out for the old set (v2 dial
  layout from extras, 3-D needles turned by opening.ts); no truck seen at 34.4 and the 54 s frame showed the gate —
  scenario now steps the CUTSCENE clock and logs car/camera/truck positions (round 2 queued).
- item 1 DONE: matlab calibration (scratch/open1/calibration.txt, Medium WebGPU, hash ok 256/256) merged for the new
  ids + grass_wet + car_interior_tan/maroon (craze change). Generator fixes so every trim is in [0.4, 2.5]: the grass
  generator now scales its palette onto each spec's avgAlbedo (grass_wet / grass_dead / pine_needles / canopy_far),
  water_ditch = glass × 0.5 (opening.ts). Grass/water values derived analytically from the measured means (linear);
  re-verify on the next matlab run. **npm test 196/196 green.** (wall_tally is 11 % off — realism-r3's generator.)
- look 2/3 (scratch/open1/r3, diag): POV at 2 s now reads as a real night drive (road, centre line, COUNTY 9 shield,
  pine walls, wipers, A-pillars, dials inside the rim, gloves). Truck passes at 34.5 (debug: truck 3.4 m from us).
  Diag A/B: the bright road is our beams + exposure 6.3 (meter sees only the beam pool) → POV exposure ceiling 2.4.
  Dome dark: the layout cone was 80° FULL (40° half) so the dash/seat were outside it → L_DOME 170° full (Lambertian
  hemisphere), L_CAB_VEIL 120°. Shadow ruled out (A/B identical). Dome beat re-aimed at the real v2 dressing (knob,
  cup, folded map + cassettes + torch on the seat, medal, visor) — no arms_map clip exists, so S4b looks at the folded
  map on the seat. S9 camera moved 1.8 m north (the post hid the car). Truck lamp lenses emissive. Rain canvas 500 px/m.
  ON BATTERY since round 2: no valid fps numbers yet.
- perf (battery — tris/draws only): look 5 at 54 s 1377 draws / 2.46 M tris, 63.4 s 858 / 2.03 M (over). Fixes: shadow
  passes gated on lamp intensity (shadow.autoUpdate, no shader-key change) → 63.4 s 521 / 1.25 M; headlamp shadow far
  90 → 45 m (truck 120 → 60). Breakdown at 54 s: EXT2 1.04 M (house + yard trees ahead), RC9 206 k, EXT1 198 k.
- dome beat now reads: at 24.5 s the warm cabin shows the torch, cassettes, receipts, foam cup on the seat (exp 0.15);
  dome exposure bias +2.3 EV (a lit car interior photographed at mid-grey), POV cap 1.2 (+1 bias).
- C6 now mounts the v2 interior on its car-space POVs (7.5–15.5, 19.5–end; exterior shot 15.5 shows the proxy).
- probes: levelProbeKey hashes the whole layout + material spec → the shipped probes.bin is stale after any §10
  change (runtime bake at load) → request for the lead (regen probes after this round).
- PLAYTHROUGH (Medium WebGPU, scratch/dist-open1, built 03:32 with every change incl. C6 mount): ended=true, B01…B13,
  C7 → title, deaths 0, **0 console errors, 0 exceptions, 0 warnings** (scratch/open1/pt.log). On battery.
- final runs queued: Medium frames 2/13.5/20/24.5/33.8/41/54/61.8/63.4 + Low/Max (2/24.5/54) + WebGL (2/24.5) → scratch/open1/r6.
- look 6 (scratch/open1/r6, Medium): 13.5 s insert = speedo + fuel dials with lit 3-D needles, fuel needle below E,
  tight amber lamp (good) — but the speedo needle sat at 0: extras axes are Blender-local → converted (x, z, −y).
  33.8 s truck dazzle milked the whole frame → truck lens 2e4 → 8e3 cd/m². 54 s still 1246 draws / 2.29 M tris:
  r186 SpotLightShadow sets far = light.distance (180 m), so the far-45 setting never applied → headlamp shadow
  cameras now render only HEADLAMP_SHADOW_LAYER (5): RC9 + EXT1 groups, the sedan, interior, truck.
- Low (r6-low): 0 errors; 2 s 104 draws / 150 k, 54 s 570 / 793 k. WebGL2 (r6-webgl): 0 errors, 2 s 261 / 490 k.
- **Max FAILED (r6-max): 38 errors — "number of samplers (17) in the Fragment stage exceeds 16" (harlan_apron):
  probe-lit materials see every runtime light, and Max had 5 new shadowed ones.** Fix: one shadowed lamp of ours on
  Medium+Max, no veil shadow → 3 new shadowed lights. Re-run queued (r7 Medium, r7-max, pt2 playthrough).
- r7 Medium (layer-limited lamp shadows + sampler fix): 0 errors. draws/tris: 2 s 157/418 k · 13.5 s 139/374 k ·
  20 s 259/459 k · 24.5 s 220/422 k · 33.8 s 317/497 k · **54 s 680/1.55 M (over: EXT2 house+yard trees 1.04 M ahead)** ·
  61.8 s 261/681 k · 63.4 s 521/1.25 M (pre-existing gate view; was 858/2.03 M with the old always-on shadow passes).
  Speedo needle now reads ≈ 40 mph at 13.5 s.
- r7 Max: **0 errors** (sampler fix holds). 2 s 284/802 k, 24.5 s 300/738 k, **54 s 1241/3.33 M (over budget)**.
- FINAL (attempt 1): PLAYTHROUGH 2 (scratch/open1/pt2.log, Medium, build with every change): ended=true B13 → title,
  deaths 0, 0 errors / 0 exceptions. npm test 196/196, typecheck clean, build + verify-boot OK, assets --check ok,
  validate-layout 0 errors. All runs since round 2 were ON BATTERY → no valid fps numbers.

## What's left (honest)
- Perf: 54 s (S8, x≈89 looking at the gate + house) Medium 680 draws / 1.55 M, Max 1241 / 3.33 M — over budget.
  The rest of C1 is within budget on Medium (≤ 317 draws, ≤ 0.5 M). fps never measured on mains.
- §7.2 volumetric beam cones, rain inside the truck's beams, truck light on the cabin probe-lit only.
- §7.3 wiper streak arc / spray sheet event / fast wipers; §7.7 lantern (sprite flame kept); §7.8 tail-lamp hot core
  + cube-corner normal (only the colour changed); §7.6 decals (ROOMS board, sign legend, map "48", VFD digits);
  C0 entirely (builder 2).
- S4b plays the folded map on the passenger seat (no arms_map clip); the held-map beat waits for the Blender clips.
- Hood hex pattern (AD item 6): not reproduced in any in-game frame (the hood is dark from the POV); suspect named:
  carPaint `dots(uv, cells(0.02), 0.4, 0.3)` water spots on a 2 cm jittered lattice.
- 33.8 s truck dazzle reads as a milky full-frame veil — plausible veiling glare but harsh; tune with the bloom owner.
- L_CAB_VEIL lost its shadow (sampler limit); the footwells are not dash-shaded.

## Requests for the lead
1. `src/shared/layout-types.ts` (lead-owned): I added optional `cd`, `beam`, `angle` to LightDef (CONTRACT-CHANGES #42).
2. Probe-lit characters see EVERY runtime light (level.ts probeLights): shadowed opening lights push Max to WebGPU's
   16 samplers/stage — please give characters a LightsNode without RC9/CAR runtime lights (r3's level.ts), then the
   veil shadow and Max's second lamp shadow can return.
3. `probes.bin` is stale (levelProbeKey hashes layout + material spec) → regen shipped probes after this round.
4. L_LANTERN 150 W needs the release bake (lane A). Arm clips §10.9 (arms_map etc.) for the held-map beat.
5. Measure `--fps` on mains (Medium/Low/Max) — the laptop was on battery for every run here.
6. 54 s budget: EXT2 (house + yard trees, 1.04 M) is fully drawn from RC9 — needs distance LOD/culling for the yard
   trees beyond ≈ 80 m (lane A / r3), or a framing change in S8.
7. Re-verify grass_wet / grass_dead / pine_needles / canopy_far / water_ditch calibration on the next matlab run
   (derived analytically from measured means after the generator scaling). grass_wet's brighter albedo changes the
   exterior r3 is tuning.

---
# STATUS — opening runtime builder 2 ("C0 title cinematic + glimpses of the outside")

Build dir: `scratch/dist-open2`. Scenarios/shots: `scratch/open2/`. Builds on builder 1 (above).

## Log (builder 2)
- Started: read builder-1 note; nothing of builder 2 existed yet.
- Step 1 DONE: C0 timeline `src/cutscenes/c0-road.ts` (§3, 5 shots, 3 flashes, cards, wiper phase); host.ts PREROLL
  {C1: 'C0'} (Director still sees only C1; C0 skip → C1 `chained`, no fade-in); types.ts CardStyle 'date'|'byline' +
  ctx.chained; new `src/ui/title-card.ts` (date card low, byline under the title) hooked in bindings setCard (1 line);
  wipers fx `phase`; new audio `src/audio/synth/road.ts` (car_pass_by, rain_leaves, wire_wind, knob_click,
  map_paper, spray_hit). Host tests updated for the preroll. npm test 196/196, typecheck clean.
- r1/r2 finding: gameplay camera is near 0.03 / far 90 (main.ts) → the C0 aerial showed only fog and every long C1
  view (lantern/sign at 160 m) was clipped. Fix: `src/world/glimpses.ts` sets near/far per frame while the opening
  owns the road (cabin 0.03; exterior 0.25, aerial 1.0; far 2000 aerial / 900 ground, capped at house − 300 m so
  EXT2 is not drawn from 700 m away), restored on release. r2 aerial then showed the forest but (a) the sky treeline
  floated above the horizon with a seam, (b) fog in-scatter greyed the canopy. C0 look (c0_look fx) now sets
  fogDensity 0.003, fogScale 0.45 (in-scatter over a black forest ≈ ½ the horizon sky), groundL 0.0018 (= fogged
  canopy, no seam), treeline → far ridges (R 1.4–3.2 km, H 40 → 0.4–1.5°). Pending r3 look.
- Decals (decals.ts): new `billboard` (1960s STROUD'S/ROOMS ½ MI paint under a torn, faded 1980s I-58/CARVEL EXIT 4
  poster, rust streaks from the lamp brackets, mildew), `county_shield` (MUTCD M1-6), `road_sign` → 2-line guide sign
  (FHWA green, rounded border); hero canvases 2048 on Medium/Max, 1024 on Low (§7.6).
- Retroreflection `src/world/retro.ts` (§7.6/§7.11): L = R_A·E·exp(−(α/1°)²) per fragment from both lamps' live pose
  + the halogen pattern; on the sign/shield decals (R_A 70), centre paint (R_L 35 mcd wet), corridor reflectors (130).
  Deer: head yaw from root params; eye-shine quads (6 mm pupil, ≥ 1.5 px with flux conserved), fx `deer {eyes, i}`.
- r3 (Medium): C0 all frames ≤ 330 draws / 0.68 M tris, 0 errors. Aerial now black forest to a ridged horizon, no
  seam; but road + beam pool hidden by the south pine wall (the §3 camera is 70 m off the road axis at 8°) → aerial
  moved over the road axis (6 m S of the centreline, looking E down seg E). Ridges were regular "cotton balls" →
  treeH 26. A white dot in every cutscene frame = the interaction reticle → hidden while a cutscene holds the screen
  (host.ts CUTSCENE_SCREEN + interactables.ts).
- C1 glimpses wired: VFD seek (fx radio, decal `vfd` 15 cd/m² emissive, FM 88.1→107.9→wrap→91.3, AM 540→1430),
  knob_click (dome detent ×2, high-beam stalk ×2), map_paper, spray sheet (fx spray: blotchy thickness layer the glass
  shader lenses; blades clear it in ≈ 2 fast strokes) + spray_hit, fast wipers 0.75 s at 35.0 → 1.25 at 37.8 (period
  change keeps blade phase), deer eye-shine 49.2 / one pair out 49.9 / rest 50.2. Road map decal (§7.10) on
  map_folded/map_open. Prewarm: new `rc9` warm step in main.ts (aerial, near 1 / far 2000, 4 headings) + eye quads in
  setWarm.
- r4 (Medium, 0 errors): C0 aerial = one warm pair of headlights alone on a ribbon in endless black forest (pass);
  flash showed a dark seam band (sky ground not lit) → groundL follows SKY_U.flashSky; far end of the road clipped
  (far capped by house distance regardless of direction) → cap only when facing the house; ridges flatter (R 3–6 km).
  Billboard decal reads as a faded printed poster. C1 47.6: NEXT SERVICES blazes retro from the POV + reflector post
  glints (pass). C1 49.5: no eye-shine (R_A 40 too low) → R_A 300 (cat's-eye: ρ 0.3 into 2°), 8 mm pupil. C1 far floor
  raised to 250 (POV far was 120 → lantern at 160 m clipped). Subtitle "Dim your lights—" shows. Draws ≤ 265 / 0.54 M
  in every captured C0/C1 frame. Battery 16 % — no fps.
- C0 shot 4 retimed: ease 'out' (the camera crosses the glass at ≈ 29.0, not 29.9), driver proxy hides + interior
  weather (muffled bed) + focus on the drops at the crossing. tests/c0-road.test.ts (4 tests: shot tiling, credits
  text exact, flashes, wiper phase + chained no-fade). npm test 200/200; build + verify-boot OK; assets --check ok;
  validate-layout 0 errors. CONTRACT-CHANGES #43 logged.
- Deferred: §7.9 dome-on windscreen reflection (needs a load-time cube capture of the lit CAR set + a car-yaw-corrected
  lookup on the exterior glass; the rain glass is drops-only opacity) — not started.
- r5 (Medium, 0 errors / 0 exceptions; shots scratch/open2/r5/): C0 6 s 265 draws / 0.54 M, 9.35 s same, 21.5 s 337 /
  0.68 M, 29.7 s 173 / 0.55 M; C1 4.3 s 188 / 0.54 M, 24.5 s 220 / 0.42 M, 48.2 s 246 / 0.77 M, 49.6 s 364 / 1.26 M
  (far floor 250 now reaches the gate set — within Medium 400 / 1.5 M, close). Flash: the far-end notch is gone; a
  lighter seam band under the ridges remains and the canopy reads as an egg-carton of identical domes under the flash
  (L2 crown geometry, lane A) — NOT photoreal yet. Deer 49.6 s: still NO eye-shine and no deer visible in frame —
  unresolved (next: dump the deer roots' screen positions + the retro E at the eyes; check the head/eye anchors are
  not inside a culled/hidden subtree).
- PLAYTHROUGH (Medium, dist-open2, C0 preroll included): ended=true B13 → title, deaths 0, 0 console errors, 0 exceptions (scratch/open2/pt.log).
- Low / WebGL2 C0 aerial (scratch/open2/low/lw-01-C0-6.jpg): 0 errors, 186 draws / 0.19 M. Reads as headlights in
  a black forest, but the bare canopy blanket's big flat facets show in the middle distance (Low has no crown band)
  — fails realism on Low. Max: NOT run this session. fps: NOT measured (battery 17 % → 1 % for every run).

## Builder 2 — what's left (honest)
1. Deer eye-shine (§7.11) does not show in C1 S7, and the deer are not visible in the 49.6 s frame. Code is in place
   (glimpses.ts eye quads, retro.ts R_A 300); diagnose positions/visibility next.
2. §7.9 dome-on windscreen reflection: not started.
3. C0 flash: a lighter seam band under the far ridges; the canopy reads as an egg-carton of identical domes (L2 crowns,
   lane A); the ridges are a row of soft bumps (atmosphere.ts treeline cell shape; r3's file).
4. Low aerial: blanket facets (see above). Max preset + fps on mains + one more Medium look at C0 21.5/29.7 (title, glass
   pull-back after the ease change) and the C1 map / VFD frames (captured r5 m-05/m-06, not yet reviewed).
5. Spray sheet (C1 35.2) is not readable (nothing lit behind it after the dazzle); §7.12 disposal after C1 not done;
   `tyres_wet`, `air_horn` as separate sfx not made (truck_pass carries the horn).

## Builder 2 — requests for the lead
1. Lane A: L2 crown cards / canopy blanket read as identical domes from 60 m under the C0 flash; Low needs some crown
   relief on the blanket (or a Low crown band) — the faceted plane shows in the Low aerial.
2. realism-r3 (atmosphere.ts): the sky treeline assumes a 1.6 m eye; for C0 a true far-ridge layer (§7.5) with
   irregular crown-fringed profiles would remove the bump row + seam (glimpses.ts drives it through LOOK today).
3. main.ts (lane B): I added an `rc9` warm-up step (aerial, far 2000) — please keep it when editing the warm-up.
4. Measure --fps on mains (Medium/Low/Max) including C0 6 s / 21.5 s and C1 49.6 s (364 draws / 1.26 M on Medium).
- Final checks: playthrough report confirms the chain (C0 @ 0.03 s → C1 @ 29.5 s → … → C7). r5 29.7 s frame: inside
  the glass, the wiper blade crosses frame over the defocused road (match cut works); the dash is only a black
  silhouette (no rim/cluster glow visible) and the road still reads pale for wet asphalt. Deer glint material now
  depthTest off (the anchor sits on the head surface) — UNVERIFIED in a frame. Max run (scratch/open2/max.log) TIMED
  OUT before the first scenario frame (started on 4 % battery after a lock wait + build) → Max unverified, incl. the
  16-sampler risk from the new retro emissiveNodes (if it errors: reuse the material's map node instead of a second
  texture()). C1 54 s / 63.4 s not re-measured since the far floor 250 (was 90) — likely heavier than builder 1's
  680 / 1.55 M; if so drop the floor to ≈ 180 (lantern 157 m at the S8 cut).

---
# Art-director review of C0 + C1 (reviewer, 2026-10-08)
Build dir `scratch/dist-open-review`; scenario `scratch/open-review/rev.mjs` (§11 frames, draws/tris + 2.5 s live fps per
shot with `FPS=1`); output `scratch/open-review/<run>/`. Mains power (charging).

### Pass 1 (Medium WebGPU, 960×600, mains) — C0
| Frame | draws / tris | fps (2.5 s live) | Photographic? | Why |
|---|---|---|---|---|
| C0 4.5 | 265 / 548k | 58 | **no** | car pool reads; but canopy is one grey-blue haze (fog in-scatter lifts the black forest to a veil), far ridges = a row of identical soft bumps, verges glow as two white strips |
| C0 9.25 | 265 / 548k | 60 | **no** | the flash isn't in the frame at 9.25 (peak later); same veil/bump ridge |
| C0 15.6 | 204 / 452k | 48 | **no — worst C0 frame** | pines behind the billboard are flat triangle cut-outs with sky holes; a row of white blocks along the far verge; billboard face blurry/blocky; road reads dry, blotchy concrete |
| C0 21.5 | 337 / 690k | **29.5** | half | moody, title legible, byline correct; but a brown veil fills the frame, the road is pale with snow-like blotches, and it is headlights (not the receding taillights) under the title; fps far below the 45 floor |

### Pass 1 — C1 (Medium WebGPU)
| Frame | draws / tris | Photographic? | Why |
|---|---|---|---|
| C1 2.0 | 176 / 482k | half | huge step up from the old black frame: wheel, dials, pillars, road, pine walls all read. Faults: a jagged **cyan zig-zag** stroke across the cluster (artifact), road + verges read pale/dry (no wet sheen, no specular streaks of the lamps), dash top a flat beige band |
| C1 13.5 | 173 / 516k | half | dials + orange needles + DOF are good; the cyan zig-zag band dominates the left third |
| C1 20.0 | 297 / 601k | half | cabin is now lit and readable (user's "lighter" ask met); but flat-shaded faceted tan plastic, no texture/wear, cyan zig-zag again |
| C1 24.5 | 220 / 434k | half | seat dressing reads (torch, cup, cassette, receipts) but the frame is a muddy brown veil, low contrast; map's "48" not in frame |
| C1 34.4 | 206 / 568k | **no** | almost black; truck is a dim brown box; no front-lit cabin, no light-drops on the glass |
| C1 41.0 | 153 / 416k | **no** | crane: pines read as flat stacked cones (lane A L1 skirts), trunk bases glow, no taillights visible |
| C1 49.5 | 358 / 1.2M | half | forest wall + road read like a night drive; no sign legend, no eye-shine; road dry/pale |
| C1 54.0 | **710 / 1.63M** | no | over Medium budget; house is a faint silhouette at right, lantern not a hot point, ROOMS board unreadable |
| C1 74.0 | 607 / 1.59M | — | (post-C1 gameplay camera, far 90) over budget — existing gate view |
fps: the FpsMeter window is 1200 frames (mixes shots) — replaced by a per-shot rAF timer for the next runs; C0 21.5 dropped the rolling average from 48 to 29.5 (that view is slow).
- Diag d1 (scratch/open-review/d1): hiding `-cluster_lens` removes the cyan zig-zag → it is the L_DASH backlight's specular on the lens' scratch normals. FIX (opening.ts): the lens gets its own LightsNode without L_DASH and no normal map.
- Diag d1 top tris at 54 s: P_TREE_1..3 dead trees 65k each, EXT2 treeline_shrub/mid rows 23–35k each, groundcover turf chunks 16–27k. FIX: new src/world/yard-cull.ts (hooked in glimpses.ts): while the opening holds the camera > 70 m from the house, yard dressing nodes > 60 m from the camera are hidden; restored at < 70 m and on release.
| C1 61.8 | 376 / 1.04M | **no** | near-black frame; lantern = an over-exposed box at top right, gate rails orange; nothing reads as "faces check" — needs a fill |
| C1 74.0 | — | yes-ish | B02 gameplay start: house, path, dead trees read well (not part of the opening; its 607 / 1.59 M is the gate view) |

### Pass 2 (m2: lens + yard-cull) — numbers
- C1 54: **677 draws / 1.07 M** (was 710 / 1.63 M): tris now inside budget, draws still over 400. C1 49.5: 333 / 0.88 M (was 358 / 1.2 M). C1 63 reveal: 525 / 1.25 M (unchanged; draws over 400 — the gate view, as before).
- Real fps (per-shot rAF, mains): C0 4.5 60 · C1 2 / 13.5 / 20 / 34.4 / 54 / 63 all 60 (p95 16.7–16.8 ms) · C1 49.5 56.4 (p95 33 ms).
- **C0 15.6 / 21.5: shader-compile hitches of 0.2–9 s** (scratch/open-review/st.log: renderer programs 1364 → 1416 → 1587 while the billboard and title shots play; steady state 60 fps between hitches). The `rc9` warm-up does not cover those views. Diagnosing which programs.
- st2 diag (fragment programs by material name, scratch/open-review/st2.log): new at C0 14–15.6 s = the mounted interior's cabin materials (car_interior_tan, headliner, plastic_cluster, decal_road_map, flannel, …); 19.5 s = truck (truck_paint, chrome, glass) + sign/shield; 21.5–23 s = gravel_wet, water_ditch, door_painted, zinc. FIX: opening.warmRoad(on) parks our sedan (interior mounted) + the truck on the road abreast of the billboard; main.ts `rc9-road` warm step (6 headings, near 0.03 / far 900) right after the aerial `rc9` step.
- Cluster lens r2: with L_DASH removed + flat normals the zig-zag became a straight cyan band (m2 13.5) → the lens is now an unlit 8 % smoky film (MeshBasicNodeMaterial, depthWrite off).
- m3 (lens film 0.02 grey): zig-zag gone, but the film lifted the black dial face to slate at the macro exposure → film now black, opacity 0.12.
- m3 C0 15.6 59.6 fps after `rc9-road`, but st3 (finer diag) shows the cabin/truck programs still compile after 12 s of C0 — pipeline compile is async, so the per-shot fps sample can miss it. **C0 21.2 s still a 2.2 s hitch** (gravel_wet, glass_grimy, door_painted, zinc, water_ditch). Not solved — see requests.
- Road diag (scratch/open-review/rd): constant albedo 0.04 gives the same pale road → not the albedo; it is the broad wet sheen (generator roughness 0.55 → ≈ 0.25 after the baker's wet gloss, above CLAUDE.md's 0.05–0.2). FIX ground.ts asphalt: dry 0.3 / patches 0.2 → ≈ 0.135 / 0.09 wet. (asphalt_wet is also the EXT2 driveway — inside the CLAUDE.md range, flagged to realism-r3.)
- C0 look (glimpses.ts): fogScale 0.45 → 0.3, groundL 0.0018 → 0.0012, ridge treeH 34 → 22 (veil + cotton-ball ridges).

### Restarted reviewer (09:37) — m4 queued (rebuild with asphalt 0.135/0.09, C0 look, lights.ts from r3); 5 other lanes' shot runs ahead in the lock queue.
- Restart fix 1: cabin LightsNode lacked L_TRUCK_HI_L/R (RC9 room, not in extLights) → C1 34.4 cabin never front-lit by the truck. Added to opening.ts cabinNode (unverified, needs m5).
- Correction: C0 21.5 headlights under the title IS per §3 shot 3 (car approaches, passes under at 22.9) — not a fault.
- C1 61.8 is after the scripted 61.6 lights-die (§4 S9): the frame relies on L_LANTERN alone (§7.7 lantern rework not
  done; 150 W needs lane A's release bake) — judged in m4/m5 against "meter adapts normally".
- Facets A/B scenario ready: scratch/open-review/diag5.mjs (normalNode off on car_interior_tan / vinyl_dash_black; draws by prop at 54 s).
- 09:53 m4 still queued: lane A Blender pipeline running back-to-back (shot.mjs waits on Blender) + 3 r3 runs.

### Pass 3 (m4, Medium WebGPU, mains, 0 console errors / 0 exceptions) — scratch/open-review/m4/
| Frame | draws / tris | fps (live 2.5 s) | Photographic? | Why |
|---|---|---|---|---|
| C0 4.5 | 265 / 540k | 60 | no | aerial reads (one car alone in black forest) but the canopy is soft domes in a grey veil |
| C0 15.6 | 140 / 428k | 53.6 | no | pine cut-outs; billboard soft |
| C0 21.5 | 337 / 682k | **1.3 (2 s compile freeze under the title)** | half | composition per §3 shot 3 (approaching lamps) OK; brown veil |
| C0 26 | 206 / 573k | 60 | **no** | road reads as pale, dry tan concrete with darker "puddles" (inverse of wet asphalt); no specular streaks under the oncoming lights; rain streaks good; asphalt roughness 0.135 made no visible difference → the pale is exposure on the only lit surface + no mirror reflections (SSR/reflections = r3) |
| C1 2 | 176 / 474k | 59.6 | half | best frame: dials glow, wipers, shield, pine wall, rain on glass. Road again pale concrete; dash top a flat dark slab |
| C1 20 | 295 / 592k | 60 | half | lighter cabin (user ask met), seat/dash read; faceted flat tan plastic |
| C1 34.4 | 214 / 565k | 60 | no | truck alongside reads as an orange flatbed with one flare; cabin black; no rain lit in its beams |
| C1 49.5 | 333 / 870k | 52.8 (p95 33 ms) | half | forest wall + road read as a night drive |
| C1 54 | **669** / 1.06M | 59.6 | no | draws over the 400 Medium budget |
| C1 61.8 | 376 / 1.04M | 59.6 | **no** | after the scripted lights-die: near-black; lantern box + two plates over-exposed flat boxes, gate rail orange; the car is invisible |
- 10:21 d5 diag (light set at C0 times + facet A/B + draws by prop at 54) queued behind lane A Blender.
- Fix 2: d5 A/B proved the cabin facets are the export's flat normals (normalNode off → facets stay): opening.ts rebuilds car_interior_tan/vinyl_dash_black/carpet_auto/headliner normals with toCreasedNormals 35°. Fix 3: yard-cull also hides P_WRECK_* (>60 m) and every interior-room prop while the opening camera is >70 m from the house (d5: P_CAR_GATE 108, wrecks ≈110, interiors ≈80 draws in the 54 s list). Light set is stable across C0 (d5), so the 21.2 s compile is not light churn.
- 10:24 npm test 200/200, build+verify-boot OK, assets --check ok; m5 (Medium) + x5 (Max) queued.
- 10:44 m5 still waiting on the chrome lock (other lanes).

### Pass 4 (m5, Medium WebGPU, mains, 0 errors / 0 exceptions) — scratch/open-review/m5/
- C1 54: **378 draws / 743k** (was 669 / 1.06 M) → inside the Medium budget (wrecks + interiors culled). C1 49.5: 225 / 639k (was 333 / 870k).
- fps (2.5 s live, machine shared with other lanes' Blender jobs): C0 4.5 60 · C1 2 51.2 · 20 60 · 34.4 56.4 · 49.5 49.3 · 54 58.8 · 61.8 40.5 (p95 33 ms: below the 45 floor in that one window) · **C0 21.5 0.8 fps (compile freeze, unchanged)**.
- C1 20: creased normals (35°) soften the dash/console but the door card still shows big planes → 50°.
- C1 54 verdict: **half-yes** — wet road with the centre line, black pine wall left, open pasture right, the house silhouette on the rise with a warm point at the gate: reads as "middle of nowhere". Faults: the pasture in the beam spill is a flat pale green-grey, no sign legend.
- 11:00 restarted reviewer (2): x5 (Max) was cut off after its first frame: C0 4.5 **497 draws / 1.04 M, 44.9 fps (p95 33 ms)**, at the Max draw ceiling and just under the 45 floor. Max is on mains now (AC, 100 %); 4 other lanes' shot runs hold the chrome lock.
- 11:2x restarted reviewer (3): pd diag queued (diff of warm-up vs C0 program source for car_interior_tan/gravel_wet/truck_paint/door_painted → why warmed materials recompile).
- Restarted reviewer (3) findings so far: C0 26 is the over-the-hood shot lit by our own low beams; the road is the
  dominant metered area (cue biasEV +1, max 1.2 → up to 2.4), so the meter normalises it to mid-grey whatever its
  albedo (explains rd: albedo 0.04 "same pale road"). Plan: hold the §5.2 exposure (≈ 1.7, no bias) on that shot
  instead of letting the road set it. C1 61.8 is 0.2 s after LIGHTS_DIE (61.6) with τ_brighten 6 s → near-black by
  the §5.2 design; the 60.5 frame (lights on, car in the pool) is now also measured (rx diag queued).
- S9 (C1 56.6–62) reframed in c1-empty.ts: camera from the far verge south of the car (-0.6,-37,1.5) → car + gate + lantern at 9 m + ROOMS board face (was 3 m from the flame, board back edge-on). UNVERIFIED (rx/next run).
- 11:22 restarted reviewer (4): pd diag (warm-up vs C0 program diff) running; then exposure-hold on C0 26 + C1 road shots.
- 11:38 restarted reviewer (5): pd diag now building (after r3's chrome run); rx queued behind it. Working on C0 26 exposure hold + warm-up meanwhile.
