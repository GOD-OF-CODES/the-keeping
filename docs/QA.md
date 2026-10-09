# QA-2 report — THE KEEPING

Round QA-2, 2026-10-07. All runs: `node scripts/shot.mjs` (private headless Chrome on the real M1 GPU, 8 GB), `--no-build`
against one `npm run build` of the working tree (11:04, includes the lead's uncommitted `src/render/perf.ts` phase
instrumentation). Raw reports: `scratch/qa/*-report.json`, `scratch/qa/perf/*-report.json`. Other agents were using the
same headless-Chrome lock during this round, so wall times include lock waits only where noted.

**Verdict:** the game plays start to finish on the real renderer (B01 → C7 → title card, Medium/WebGPU, 0 console
errors, 0 page exceptions), but **one frame throws inside the game at the start of C7** (bug 1). Boot and compliance
pass. Medium/WebGPU GPU time is well inside budget; the misses are **load time** (43–65 s Medium, 351 s WebGL2),
**1 % lows** (8–16 fps hitches on Medium) and **Low on WebGPU with MSAA** (6 fps). The image is far too dark and flat
to read as photoreal in most hero moments (critique below).

## 1. Boot + compliance

| Check | Result | Pass |
|---|---|---|
| `shot.mjs --boot-only` requests before Start | 4: `/?debug`, `index-*.js`, `index-*.css`, `/favicon.ico` — no three.js, no assets | yes |
| Recommended preset | Medium ("Apple M1 GPU, 8 CPU threads, 800×600 @1×, benchmark 115") | yes |
| Boot console errors / exceptions / warnings | 0 / 0 / 0 | yes |
| `verify-boot` (in `npm run build`) | 12.3 KB gz boot payload (limit 25.6 KB), no three.js / game code, no modulepreload | yes |
| `package.json` | dependencies `three 0.186.1`; devDependencies `typescript 7.0.2`, `vite 8.3.1` — nothing else | yes |
| External URLs in `src/` + `index.html` | only `http://localhost` in a comment in `src/audio/lab.ts` (dev-only lab); no CDN, no web fonts, no `@import url` | yes |
| External hosts in `scripts/voices.mjs` | `https://api.elevenlabs.io` only (the allowed exception) | yes |
| `dist/` secrets (`ELEVENLABS`, `xi-api-key`, `sk_…`) | none | yes |
| `node scripts/assets.mjs --check` | low 20.85 / 25 MB, medium 50.44 / 60 MB, max 102.22 / 120 MB — ok | yes |
| Live site | `/` 200 (1307 B), `/assets/medium/manifest.json` 200 (7058 B) | yes |
| `npm test` | 184 / 184 pass (3.8 s) | yes |
| `npm run build` | ok | yes |
| `npm run typecheck` | **fails**: `src/game/main.ts(322,5) TS1117` duplicate `lightning` key in the `expose` object (lines 297 and 322) — the lead's in-progress edit (bug 7) | **no** |

## 2. Playthrough bot

`node scripts/shot.mjs --scenario scripts/qa/playthrough.mjs --preset medium --no-build --wait 2 --width 960 --height 600 --out scratch/qa --name play --timeout 2400`

Result (run 3, `scratch/qa/play-report.json`): **reaches the ending** — `ended=true`, beat B13, game 372.3 s, wall 122 s after a 37.8 s load, 1 death,
GPU frame ≈ 3.9 ms, console errors 0, exceptions 0. Assertion that failed: *no frame threw inside the game* (1 throw,
B13/C7, bug 1).

Bot fixes this round (scripts/qa only):
- The title-card detector looked for the exact text `THE KEEPINGEsc  menu`; the credits commit added the byline
  ("a game by Raj Vardhan Singh"), so a correct ending was reported as a 480 s stall in B13. It now matches
  `^THE KEEPING … Esc menu$`.
- Each beat record now also stores `builds` (running node-builder count, `__game.builds()`) and `programs`, so the next
  round can see shader variants compiled during play, beat by beat.

| Beat | Game s | Wall s | Notes |
|---|---|---|---|
| B01 | 0.0 | 0.0 | C1 at 0.0 |
| B02 | 52.0 | 14.8 | |
| B03 | 72.0 | 19.4 | C2 at 73.1 |
| B04 | 94.7 | 35.0 | |
| B05 | 99.5 | 37.6 | hides in H_ARMOIRE |
| B06 | 117.3 | 40.7 | **death at 122.5 (Ada CATCH, CP4)** while reading the ledger in Harlan's room |
| B07 | 127.3 | 47.7 | C3 at 127.3 |
| B08 | 139.8 | 50.3 | |
| B09 | 166.9 | 56.4 | C4 approach / hem / look / leave 177.4–199.2; breath gate 195.0 |
| B10 | 206.4 | 64.8 | |
| B11 | 215.8 | 66.5 | C5 at 259.0 |
| B12 | 292.0 | 103.8 | C6 at 308.6; pour gate 311.6–312.8; key gate 318.8 |
| B13 | 338.3 | 114.1 | C7 at 338.3 → **frame throws** → title card at 372.3 |

Checkpoints CP1…CP8 all reached. Bot unsticks (teleport to the next waypoint after a collision snag): B09 → u4t_top,
B10 → k_door, k_center, B11 → hall_pdoor, B12 → drive_e — the waypoint graph is coarse at those turns, not a game bug.
Four runs this round, all reach C7 and the C7 throw every time (runs 1–2 had the stale title detector, so run 2 was
reported as a B13 stall). Deaths vary: runs 1–3 died once in B06 (Harlan's room, reading the ledger), run 4
(`scratch/qa/run4/play-report.json`: ended at game 386.1 s, wall 165 s, load 45.7 s) survived B06 but was caught twice
in B08 (CP4, 143.9 s and 159.3 s). The headless logic sim (`tests/e2e-playthrough.test.ts`) asserts 0 deaths on the same
decide() logic; the bot walks u2_mid → u2_west → u2_ledger (no direct edge) and reads three ledger pages, which gives Ada
time to patrol in. Ada's behaviour on the real game is not deterministic between runs (frame timing of the real
renderer), so the bot can't be expected to match the sim's 0 deaths exactly.

Shader/node builds during play (run 4, running `__game.builds()` / `renderer.info.memory.programs` at each beat):

| Beat | B01 | B02 | B03 | B04 | B05 | B06 | B07 | B08 | B09 | B10 | B11 | B12 | B13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| node builds (running) | 1488 | 1930 | 2062 | 2458 | 2579 | 2626 | 2680 | 2732 | 3098 | 3329 | 3358 | 4387 | 4654 |
| programs | 665 | 659 | 658 | 743 | 723 | 723 | 724 | 724 | 701 | 701 | 687 | 736 | 680 |

**3 166 node builds happen after load** (1 029 of them between B11 and B12: C5 + the kitchen/can run), while the program
count stays flat at 660–740. So the warm-up compiles the programs, but new render objects (every material × object ×
lighting/shadow context seen for the first time — cutscene props, rooms entering view, characters) still run the node
builder during play. That is the most likely source of the 8–16 fps 1 % lows (bug 6).

Console info lines worth knowing (not errors): `[voice] subtitle-only mode (no index (200 text/html))` — no voice clips
are generated (`public/assets/voice/` does not exist; live `/assets/voice/index.json` is 404); cutscene fx with no world
implementation yet: `lens_wet_hand`, `eye_glint`, `mirror_view`.

## 3. Performance + load

Headless Chrome runs rAF at 60 Hz, so **avg fps is display-bound** whenever it reads 60.0: the GPU frame (`gpu ms`,
WebGPU timestamp queries via shot.mjs) is the real cost. 1 % lows are measured over ~1000 frames after load.
Draw calls / triangles / programs are from `renderer.info` over one full frame (all passes, incl. shadow maps;
`scripts/qa/perf.mjs`). Spawns: `debug_hall` (G1), `debug_upper` (U1), facade = CP1 + goto (1.8, −12, 0) on the drive.

| Run | Backend | Load s | probes ms | warm-up ms | avg fps | 1 % low | gpu ms | draws | tris | programs | tex MB |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Medium hall* | webgpu | 42.9 | 11 010 | 8 414 | 60.0 | 13.2 | 8.09 | 275 | 631 558 | 683 | 559 |
| Medium upper hall | webgpu | 64.7† | 4 575 | 22 189 | 60.0 | 8.7 | 5.98 | 305 | 433 618 | 687 | 553 |
| Medium facade | webgpu | 55.7 | 4 804 | 11 159 | 60.0 | 39.8 | 7.05 | 240 | 365 398 | 665 | 562 |
| Max hall* | webgpu | 54.6 | 4 949 | 23 373 | 60.0 | 15.7 | 12.78 | 422 | 991 380 | 970 | 1 422 |
| Max upper hall | webgpu | 72.2 | 4 454 | 25 822 | 60.0 | 31.4 | 10.29 | 461 | 692 876 | 965 | 1 427 |
| Max facade | webgpu | 64.9 | 4 547 | 17 472 | 60.0 | 35.9 | 7.70 | 371 | 605 164 | 952 | 1 429 |
| Low upper hall, MSAA | webgpu | 166.8 | 60 603 | 66 075 | 6.2 | 2.2 | 8.19‡ | 291 | 403 374 | 634 | 112 |
| Low upper hall, `?aa=0` | webgpu | 53.3 | 3 147 | 17 122 | 60.0 | 8.2 | 6.82 | 288 | 403 368 | 634 | 112 |
| Medium upper hall | **webgl2** | **350.9** | **95 642** | **138 012** | 58.0 | 43.8 | 14.97 | 306 | 435 742 | 657 | 561 |
| Playthrough (CP1 start) | webgpu | 37.8 | 5 961 | 9 570 | — | — | 3.90 | — | — | 668 | — |

\* re-run on the fresh build; the first-pass runs at the same spawns (10:29 and 10:43) were pathological — see bug 5.
† first attempt stalled > 420 s, shot.mjs's fresh-Chrome retry loaded normally. ‡ only 3 frames were sampled; the
lead's own measurement of this case is 291 ms/frame.
Warm-up = `[game] room warm-up`; the full `[game] shader compile + warm-up` is 15–31 s on WebGPU, 231 s on WebGL2.

Load phases (`[perf] phase=` lines from `src/render/perf.ts`; ms / node builds / running program count):

| Phase | Medium hall (webgpu) | Max hall (webgpu) | Medium upper (webgl2) | Playthrough (webgpu) |
|---|---|---|---|---|
| download | 532 | 1 456 | 553 | 533 |
| parse | 1 311 | 1 196 | 1 369 | 1 320 |
| materials | 1 391 / 58 b | 1 825 / 58 b | **8 809** / 58 b | 1 480 / 58 b |
| **collision** | **12 799** | **13 158** | **11 948** | **11 566** |
| probes | 11 011 / 253 b / 256 p | 4 949 / 253 b / 256 p | **95 642** / 253 b / 257 p | 5 961 / 253 b / 256 p |
| story | 663 | 405 | 1 356 | 211 |
| compileAsync | 4 882 / 130 b / 339 p | 4 485 / 131 b / 341 p | 20 016 (cap) / 44 b / 292 p | 3 908 / 177 b / 321 p |
| firstFrame | 1 674 / 221 b / 532 p | 3 496 / 341 b / 734 p | **70 298** / 220 b / 490 p | 2 025 / 272 b / 567 p |
| warmup | 8 414 / 678 b / 687 p | 23 373 / 1161 b / 975 p | **140 615** / 691 b / 637 p | 10 595 / 712 b / 668 p |

Against the CLAUDE.md budget (Medium, WebGPU, M1):

| Budget | Measured | Pass |
|---|---|---|
| ≥ 45 fps floor, 60 target | avg 60 (display-bound) everywhere; GPU 6–8 ms → ~120–165 fps of GPU headroom; **1 % lows 8.7 (upper hall), 13.2 (hall), 39.8 (facade)** | **no** (hitches) |
| ≤ 1.5 M triangles / frame | 0.37–0.63 M (Medium), 0.61–0.99 M (Max) | yes |
| ≤ 400 draw calls / frame | 240–305 (Medium); Max 371–461 (hall 422, upper 461) | Medium yes, Max no |
| Low ≥ 30 fps | WebGPU + MSAA 6.2 fps; WebGPU `?aa=0` 60 avg / 8.2 low | **no** with MSAA |
| Downloads | `assets.mjs --check` ok | yes |

Reading: GPU cost is not the problem on Medium. The low 1 % lows with a 6–8 ms GPU frame point at CPU-side hitches —
most likely node builds for render objects seen for the first time (3 166 node builds after load in the playthrough, programs
flat — see §2), or GC. Load time is dominated by collision (12 s,
every backend, every preset), probe bake and shader warm-up; on WebGL2 every node build costs ≈ 0.2–0.4 s of synchronous
compile (probes 95.6 s / 253 builds; warm-up 140.6 s / 691 builds).

## 4. Hero screenshots

960 px wide, Medium / WebGPU, taken by the playthrough bot on simulated time (`scratch/qa/play-0N-*.jpg`) plus retakes
by `scripts/qa/hero.mjs` (`scratch/qa/hero-*.jpg`) where the bot's moment landed on a fade. `hero.mjs upper` now waits torch-off at the south end of U1 and skips frames
where a cutscene runs (its first version shot the inside of a catch cutscene: all black).

| File | What |
|---|---|
| scratch/qa/play-01-c1-car.jpg | C1 car interior at 6 s — still fully black (fade-in), see hero retake |
| scratch/qa/play-02-facade-gate-flash.jpg | facade from the gate in a lightning flash |
| scratch/qa/play-03-c2-parlor.jpg | parlor threshold during C2 (candle, tableau) |
| scratch/qa/play-04-upper-hall-ada.jpg | upper hall when Ada is in it — near-black, Ada not visible |
| scratch/qa/play-05-armoire-slats.jpg | armoire slat view with Ada < 3.5 m away — black, nothing visible |
| scratch/qa/play-06-harlan-bedroom.jpg | Harlan's bedroom by torchlight |
| scratch/qa/play-07-c5-shadowplay.jpg | C5 shadow-play |
| scratch/qa/play-08-c6-dawn-drive.jpg | C6 dawn drive |
| scratch/qa/hero-c1-01-c1-car-12s.jpg | **C1 car interior** at 12 s (retake: windshield rain, dash, wiper) |
| scratch/qa/hero-c1-02-c1-flash-reveal.jpg | C1 at 38.6 s, meant as the lightning reveal — no flash in the sampled window (`lightning peak 0.00`): hero.mjs counts from scenario start, which is a few seconds after C1 starts (C1's flash is at 38.6 s, `src/cutscenes/c1-empty.ts`); a QA-script timing issue, not a game bug — the playthrough caught the flash (play-02), so it shows the dim night facade through the car |
| scratch/qa/hero-upper-01-upper-hall-ada-torch.jpg | **upper hall with Ada visible** (retake: B06, torch on, Ada 6.4 m away, PATROL) |
| scratch/qa/perf/medium-facade-01-final.jpg | facade from the drive, no flash (1280 px, overlay on) |
| scratch/qa/perf/medium-hall2-01-final.jpg | ground-floor hall (1280 px, overlay on) |

## 5. Bugs

| # | Sev | Bug | Repro / evidence | Owner |
|---|---|---|---|---|
| 1 | high | **C7 throws `TypeError: Cannot read properties of undefined (reading 'base')`** on its first frame. `src/world/cutscene-fx.ts:633` `setTrim('maroon')` calls `m.clone()` on the car-interior material, a `LightmapMaterial`; three's `Material.clone()` is `new this.constructor().copy(this)`, and the constructor (`src/render/lightmap-material.ts:70`) reads `lm.base` of an undefined `lm`. The maroon trim never applies; the rest of that frame's update is skipped; in the real rAF loop it is an uncaught console error at the ending of every playthrough. Fix: give the constructor defaults (`lm: LightmapOptions = {}` with `lm.base ?? null`, `copy()` already carries the fields) or override `clone()`. | playthrough bot: `frameErrors` B13/C7 at 338.3 s, stack `new rr (main-*.js) ← rr.clone (three.core) ← story-runtime-*.js` (3 / 3 runs). Faster: `?debug&beat=B13` and let C7 start. | B |
| 2 | high | **WebGL2 Medium load takes 351 s** (probe bake 95.6 s, first frame 70.3 s, warm-up 140.6 s, materials 8.8 s; 657 programs). Every node build is a ≈ 0.2–0.4 s synchronous program link. | `shot.mjs --preset medium --spawn debug_upper --backend webgl --scenario scripts/qa/perf.mjs` → `scratch/qa/perf/medium-upper-webgl-report.json` | B |
| 3 | high | **Low on WebGPU with MSAA is unplayable**: 6.2 fps (lead: 291 ms/frame), load 167 s, probe bake 60.6 s; the same with `?aa=0` is 60 fps, 53 s load. Confirms the lead's finding on a second spawn (U1). | `--preset low --spawn debug_upper` vs `--query aa=0` | B |
| 4 | med | **Collision build costs 11.6–13.2 s on every load** (all presets, both backends; 125 372 collision tris). That is ~25 % of a Medium load and was not on the known-facts list. A BVH over 125 k triangles should take well under 0.5 s; look for per-triangle allocation or an O(n²) step, or bake it offline / build it in a worker. | `[perf] phase=collision` in every `scratch/qa/perf/*2-report.json` and `scratch/qa/play-report.json` | B |
| 5 | med | **Intermittent load pathology** — 3 of 12 WebGPU loads this round: medium-hall and max-hall (first pass) had probe bake 61–68 s and room warm-up 115–185 s, then sampled 4 frames at 7–18 fps; medium-upper's first load stalled > 420 s (shot.mjs retry ok). Re-runs at the same spawns on the same build were normal (5–11 s / 8–23 s). Same signature as the Low/MSAA case (probe bake ≈ 60 s) — the GPU looks stuck in a slow path, not CPU-bound. Other agents' jobs were running this round, so GPU contention is not ruled out. | `scratch/qa/perf/medium-hall-report.json`, `max-hall-report.json`, `medium-upper-report.json` (`stalls`) | B |
| 6 | med | **1 % lows below the 45 fps floor on Medium** (upper hall 8.7, hall 13.2; facade 39.8; Max 15.7–35.9) with a 6–8 ms GPU frame → CPU-side hitches. The overlay in `medium-hall2` reads "p99 30". The playthrough shows 3 166 node builds after load (1 029 between B11 and B12) with programs flat — render objects built on first sight during play. | perf table above; `scratch/qa/perf/medium-hall2-01-final.jpg` overlay | B |
| 7 | low | `npm run typecheck` fails: TS1117 duplicate `lightning` in the `expose` object (`src/game/main.ts` 297 and 322). The build still works (last key wins, same value). | `npm run typecheck` | B |
| 8 | low | Max: 1.42 GB of GPU textures (`renderer.info.memory.texturesSize`) on 8 GB unified-memory Macs, and 422–461 draw calls (> 400) in the halls. | perf table | A/B |
| 9 | low | The bot is caught 1–2 times per run on the real game (B06 in runs 1–3, twice in B08 in run 4); the logic sim survives with 0. Probably the bot's longer route to the ledger plus real-frame timing. | `scratch/qa/play-report.json`, `scratch/qa/run4/play-report.json` `playthrough.deaths` | C (bot) — lead to confirm |
| 10 | info | No voice clips (subtitle-only); cutscene fx `lens_wet_hand`, `eye_glint`, `mirror_view` have no world implementation. | console info lines | C / B |

## 6. Realism critique (harsh, AAA art-director pass)

Ranked by how much each one breaks "photoreal" in the hero moments.

| # | Where | Problem | Fix (real-world numbers) | Lane |
|---|---|---|---|---|
| 1 | upper hall (play-04), armoire (play-05), Harlan's room (play-06), C1 (play-01) | **Frames are near-black with no readable mid-tones**; Ada is invisible in both of the bot's Ada moments (torch off); only the torch-on retake shows her. A dark-adapted eye or a film camera at night still resolves window light and silhouettes. | Give every room a physical night key: storm-night sky through windows ≈ 0.001–0.01 lux, a hall sconce/candle (1 cd at 1 m ≈ 1 lux) that lights the slats; let auto-exposure adapt down to ≈ EV −4 with a floor so the brightest window sits near middle grey; key or rim Ada with her own lantern/candle or the window. | A (bake windows/slats) + B (exposure) |
| 2 | facade in the flash (play-02) | **Lightning washes the frame to flat grey**: fog lit uniformly, no directional shadow, house and trees outlined like a drawing. Real lightning is a point/line source in the sky for ~0.2 s with hard shadows and a bright cloud base. | Flash = directional light from the bolt azimuth with a hard shadow + sky/cloud emission; reduce fog in-scatter during the flash (visibility ~1–2 km in heavy rain, not 50 m); no exposure renormalisation on the flash frame. | B |
| 3 | all | **Dark edge outlines and heavy chromatic aberration** (RGB split on trees, car pillars and every candle highlight) read as a post filter, not a lens. | Lateral CA ≤ 0.5 px at the frame corner, 0 in the centre; remove any sharpen/outline pass or cap it; no CA on bloom. | B |
| 4 | all | **Grain is coarse, uniform and visible in black** — reads as digital noise. | Film grain scaled by exposure (stronger in mid-tones, near zero in crushed blacks), size ≈ 1 px at 1080p; halve the amplitude. | B |
| 5 | facade (perf/medium-facade, play-02) | **Siding reads as blotchy noise at the wrong scale; windows are flat black; nothing is wet.** No reflections, no puddles, no glow from the candle-lit parlor; ground and horizon are a flat black plane with a hard edge. | Clapboard at 10–15 cm exposure with paint weathering; glass with Fresnel reflection of the sky; wet roughness 0.05–0.2 on drive/porch, darker albedo; warm 1800 K window glow from G2; treeline/fence silhouette on the horizon. | A |
| 6 | C5 (play-07), Harlan's room (play-06) | **Flashlight hotspot clips to white** (the door is a texture-less white disc); hard circular edge. | A 1990s 2-D-cell incandescent: ≈ 20–40 lm, 2800–3000 K, ≈ 200–500 cd centre with a soft 10°/25° falloff and a dim spill ring; exposure must not clip it at 1 m. | B |
| 7 | C5 (play-07) | **The shadow-play does not read**: no shadow is cast on the wall; a blurry foreground figure fills the right half. | Put the candle between Ada and the wall (shadow size = distance ratio), a shadow-casting point light ≈ 1 cd at 0.3–0.5 m, camera framed on the wall. | B |
| 8 | C6 (play-08) | **Dawn drive is a black car silhouette against flat grey**: no paint or glass reflections, tree is a flat column. | Civil-twilight sky gradient (≈ 1–10 lux, sun 3–6° below horizon), clear-coat car paint (F0 0.04, roughness 0.05) reflecting it, wet windshield; tree with bark and branch silhouettes. | A + B |
| 9 | ground hall (perf/medium-hall2) | **Light falloff is inconsistent**: the ceiling far from the candle is brightly lit while the floor beside it is black; the far door is lit cool with no source (probe leak). | Re-check bake: a 1 cd candle gives ~1 lux at 1 m and ~0.1 lux at 3 m; match runtime probes to the lightmap; occlude probes at doorways. | A + B |
| 10 | C1 (hero-c1-01, hero-c1-02) | **Windshield rain is a layer of evenly lit white dots** (like stickers or snow), with no refraction and the same brightness everywhere; car body parts cut into the frame as flat black polygons (top-right triangle, a hard dash line). Real drops (1–4 mm) are dark lenses that show a tiny inverted, blurred view of the world and only glint where a light is behind them; streaks run down at ≈ 0.1–0.3 m/s with the airflow. | Refractive drop normal map sampling the scene behind, highlight only from light sources, wiper-cleared arc; give the interior its own dim key (dash glow, ≈ 0.5 lux) so the A-pillar and dash read as shapes, not cut-outs. | B (+ A for the car interior) |

Also seen: first-person hands read as dark clay (no skin, nails or cuffs; play-02) — lane A. In the Ada retake
(hero-upper-01) the torch lights only the far wall: the side walls 1 m away get no spill, and Ada (6.4 m) has no contact
shadow and no torch shadow on the wall behind her, so she floats — this belongs to item 6.

## 7. Requests for the lead

1. Fix bug 1 (`LightmapMaterial` clone) — it is the only thing between the current build and a clean playthrough.
2. Profile `collision` (bug 4): 12 s of every load, every preset and backend.
3. Decide Low's backend/AA: Low on WebGPU must not use MSAA (or use WebGL2 for Low once bug 2 is fixed).
4. Bug 5: log GPU-timestamp per probe-bake batch in `?debug` so the next QA round can tell contention from a slow path.
5. Remove the duplicate `lightning` key in `src/game/main.ts` so `npm run typecheck` passes.
6. Bug 6: warm up render objects, not just programs — 3 166 node builds run during play (1 029 in B11→B12). Pre-render
   cutscene props/characters with their real lights and shadow casters during load (the C5 cleaver/locket and C7 sack
   are already done this way), or reuse node builds across objects that share material + lighting.
7. Confirm whether Ada's B06 patrol should catch a player who reads the three ledger pages via the west side of U2 (bug 9).
