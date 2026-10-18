# STATUS — SMOOTHNESS round, lane PERF (contract #143; ROADMAP ruling (am) items 2–3, ruling (ak))

User (live build): "the beheading still has glitches and isnt smooth enuf" → JERKY MOVEMENT, POP / FLICKER,
FREEZES / STUTTER. This lane: real-time stalls on the whole route + the C2 parlor judder (missed vsyncs).
Base tree: HEAD 0ba616a. Dist: scratch/dist-smooth-perf. Work dir: scratch/smooth-perf/.
Owned: src/render/**, src/game/main.ts, src/core/**, src/world/level.ts, src/world/blood-fx.ts, the CS_CULL_IDS /
CS_CULL_EXT_IDS / TORCH_CULL_IDS arrays in src/cutscenes/bindings.ts, scripts/shot.mjs (measurement), tests/perf-*.
NOT mine (GLITCH lane until STATUS-glitch.md says finished): c2-room.ts, c2c-up.ts, glimpses.ts, yard-cull.ts.

> **LEAD NOTE 2026-10-12 08:25 — ownership carve-out (user report: "the flashlight gets dimmer as you approach
> walls" + "the hand holding the flashlight looks very weird").** A new FLASHLIGHT/HANDS lane takes ownership of
> `src/render/flashlight.ts`, `src/render/flashlight-bounce.ts`, `src/render/exposure.ts`, the exposure/torch
> constants in `src/render/look.ts`, `src/player/flashlight-rig.ts` and `src/characters/arms.ts`. PERF: do not edit
> those files this round. If a stall or the C2 judder needs a change there, write it under "## For FLASH" in this file.

## Items (state 2026-10-12 15:3x)
1. Whole-route real-time table (Medium + Max, playthrough-paced, not stepped) — DONE on AC for the S7 + S8 tree (v3,
   S9); the after-table for the final tree is queued for AC (see S10).
2. Kill the stalls — PARTIAL: C4c 0.23 / C5 0.27 / C5 12.6 / C6 18.8 gone (S8 pin + S7 warm); C7 0.1 (freshener) and
   the C5-end re-capture builds fixed in the tree (S9/S10), awaiting a real-time re-run; C5's sustained CPU overload
   (no culling) and the C7 GC are left (S9).
3. C2 judder — PARTIAL: hair depth pre-pass (−0.5…−4 ms Medium, ≈ −1 ms Max), blur gate + stain cull (S2); C2 still
   misses vsync at the held 0.85 / 0.95 scales (S9, request 3 under For LEAD).
4. Gate — queued (strict Medium + Max playthroughs on the final dist; typecheck clean for my files; npm test).

## For LEAD
- 2026-10-12 11:0x — the 73 × "copyFramebufferToTexture: Source and destination formats do not match. rgba16float
  bgra8unorm" (your scratch/dist-lead-obj B08 run; also my cpsplit run, --beat B03, so not stain-state dependent) are
  MINE, but NOT from the SCENE_CALL_DEPTH pin (added 10:35; your dist is from 09:24 and has no pin): they come from my
  S2 blood-stain cull (src/world/blood-fx.ts, in the tree since ≈ 08:50). Its scene.onBeforeRender hook set
  `stainMesh.visible` per render; the load-time reflection capture (src/render/reflections.ts capture: hides every scene
  child except the level root, then CubeCamera.update + compileAsync, both of which call scene.onBeforeRender) had its
  hide UNDONE by the hook while cutscene-fx's warm state (blood.setWarm(true)) was on → the stain material
  (viewportOpaqueMipTexture) was drawn into the 13 cube captures → the errors, all inside the "[reflections]" capture
  of the story phase (cpsplit: 4833.6–4834.2 s, right before "[reflections] freed 37 one-shot capture render objects").
  FIXED in the tree 11:0x: the cull now toggles the stain mesh's LAYERS mask (0 = drawn by no camera), never
  `visible`, so any system that hides it for a render keeps it hidden. Verified: hairmed run on the fixed dist
  (--beat B03) → console errors 0. The windshield rain (cutscene-fx viewportSharedTexture) is not involved; C1 / C6
  windshield frames on the final dist are being captured (scratch/smooth-perf/ws) for comparison with the FRAMES
  lane's capE / capC frames.
- 2026-10-12 15:2x — requests (not my files):
  1. src/world/cutscene-fx.ts `setTrim` (C7 car_trim): CACHE the maroon clone per mesh (create once, reuse on every
     later 'maroon'). Each call clones again with new node ids, so C7 0.0 node-builds the 3 car_interior_tan clones in
     its first frame (real time: 132 ms JS on Max) even though the load warm-up drew an identical clone; with a cached
     clone the warm-up's build is the one C7 uses. ~5 lines.
  2. tests/smooth-c2-head.test.ts (FRAMES?) fails `npm run typecheck` (node:assert/strict / node:fs type names: use
     the `await import('node:' + 'test')` pattern the other tests use).
  3. Policy, item 3: C2 is HELD at whatever scale gameplay dynres reached in the cheap B03 hall — on the real route
     Medium 0.85 and Max 0.95 (v3), not the preset's 0.75 / 0.85 — and at those scales C2 missed vsync in 305 / 319 of
     ≈ 1 430 frames (21–23 %), mostly GPU (JS 6.6 / 10.3 ms avg). The GPU work I could remove with NO visible change
     (hair pre-pass, gated blur, stain cull) is 0.5–4 ms per shot; the parlor close-ups cost ≈ 13–17 ms of SHADING alone
     at 0.75 (characters ≈ 10–11 ms of it). Reaching < 1 % at those held scales needs either character-shading work
     or a cutscene-scale decision (e.g. hold at most the preset's own sceneScale in C2 / C2c, or step down only at hard
     cuts). That is a look decision for you (ruling (ad) owns CUTSCENE_SCALE) — I did not change it.

## For FLASH
- No request. (Checked: the torch's cookie and spot-shadow PCF are already skipped per fragment while it is off —
  flashlight.ts uTorchLit (R2-2); the lamp cube's PCF likewise — lights.ts uShadowOn. Hiding both torch lights in C2
  measured −0.3…−2.2 ms, inside the ±1.5 ms probe noise.)

## Log
- S0 2026-10-12 08:2x start. Machine ON BATTERY (pmset: 100 %, discharging) — real-time fps / GPU-ms runs are NOT
  valid until AC returns (shot.mjs flags it); stall-cause diagnosis (pipeline/texture/bind-group creation counts per
  frame) does not depend on power. Lead's dist-ship1 gate run holds the Chrome lock. Disk 16 GiB free.
- S1 tools (scratch/smooth-perf/): `instr.mjs` (page-side, per RENDERED frame via Loop.onRendered: rAF interval, JS
  update/render ms, cutscene id + clock, beat, room, held scale, node builds, GPU-object creations — render/compute
  pipelines sync/async with labels, shader modules, bind groups, textures (+px), buffers, writeTexture/writeBuffer bytes
  — heap drops, long tasks; with `?gputime` per-render-pass GPU ms (WebGPU timestamp queries) aggregated per 0.5 s of
  cutscene clock). Hitch records carry the PREVIOUS frame's creations (`pc`): a pipeline created in frame N compiles in
  the GPU process and delays the present of N+1. `rtplay.mjs` = scripts/qa/playthrough.mjs (unchanged on disk) run in
  REAL TIME (a transformed copy: each `advance(1, 1/30)` → one rendered frame of the running loop, bot DT = real dt,
  no hero shots / facade teleport, 60 s no-frame guard). `c2rt.mjs` = C2 → C2c → B05 real time, last hall leg walked
  in real time after a 6 s settle (gameplay dynres reaches the real-route scale before C2 holds it). `sum.mjs` table.
  `?gputime` = NEW debug-only URL param in src/render/renderer.ts (trackTimestamp on the WebGPURenderer; off by
  default). Battery runs = cause attribution only; the item-1 table and item-3 GPU targets need AC.
- S2 code (UNVERIFIED, not in the queued v1 runs' dist): (a) src/render/pipeline.ts `mbGated`: the motion-blur pass
  branches on its amount uniform (C2 on Max keeps the mb+dof chain live 0–27.7 s at amount 0; r186 motionBlur always
  took 16 taps) — `?mbskip=0` = old path. (b) src/world/blood-fx.ts stain cull: the stain material samples
  viewportOpaqueMipTexture (each scene render drawing it splits the scene pass, copies the frame + builds its mip chain);
  the mesh was drawn every frame from C2 0 to the end of the game. Now per render call (scene.onBeforeRender) only when a
  LIVE stain's bounding sphere is in that camera's frustum — exact (alpha 0 before a stain appears). `?staincull=0` =
  old path. Both need GPU-ms A/B + same-frame stills.
- S3 v1 run `rt-b11-max` (rtplay, Max, --beat B11 → B13 → C7 → CR → title, REAL TIME; dist 1 = HEAD + ?gputime; BATTERY
  (the 30 fps cap did not apply: median frame 16.7 ms; GPU/CPU may be throttled → counts are a pessimistic bound);
  machine under memory pressure: swap 3.1/4 GB, compressor 960 k pages, 5 other shot.mjs runs queued; load 168 s =
  cold Metal cache for this dist). ended=true, 0 deaths, 0 console errors. Data scratch/smooth-perf/v1/rt-b11-max.json
  (sum.mjs). >34 ms frames 168 / 14 080 (1.19 %), >50 ms 116. Stall sites (rAF interval; JS = update+render ms):
  * C5 start: frame C5 0.02 = JS render 743 ms (57 node builds, 3 shader modules, 2 pipelines glass_grimy_1100, 399
    bind groups), then 750 ms + 2 050 ms intervals with NO creations (GPU side).
  * C5 12.07–12.85: builds over 9 frames (1–9 each, glass_grimy_1087 ×2 pipelines), JS 50–200 ms each, 1 250 ms at 12.67.
  * C5 18.28: 1 683 ms with no creations (GPU side) — the known C5 "12.9" class? (lead list) / new.
  * C4c 0.13 350 ms (prev: 7 builds + ShadowMaterial pipeline); C4c 4.27–5.3 sustained 50–60 ms render JS per frame;
    C4c 5.37 render JS 764 ms + 5.55 523 ms (22 + 4 builds) → 766 + 533 ms intervals (the known C4c 5.53).
  * C7 0.0: 8 builds + 4 pipelines (car_interior_tan_1879/1883, dust_sheet_1197, paper_aged_1566) + a new
    1120×700 rgba16f texture → 150 + 950 + 2 400 ms intervals (the known C7 2.2 s, here at 0.1–0.33).
  * C7 1.63–1.78: ShadowMaterial pipeline + 3 builds → 333 ms. C7 15.05–15.82 sustained 70–77 ms render JS per frame;
    C7 15.92 UPDATE JS 735 ms (the cleat insert's cues) → 800 ms; C7 17.35 1 233 ms with no creations (front door opens).
  * C6 19.6–19.8 (the 'past the pump' cut) 133 ms; C6b 2.7–3.0 / 6.2 100 ms; CR 1.37 367 ms.
  Next (advisor): fix the per-frame GPU accounting (UID frame numbers do not advance — own frame count now), build-class
  diffs on build frames (new ctx = camera-pose warm fixes it; same ctx = LightsNode key change = state fix), texture
  usage/mips labels, per-segment JS averages, vm_stat page-in sampler (scratch/smooth-perf/vmlog.sh) aligned to stalls.
- S4 per-pass GPU timestamps on this M1 (Dawn/Metal, headless) are NOT usable: per-frame sums 100–900 ms at 16.7 ms
  frame intervals (TBDR pass overlap / tile scheduling) → item-3 attribution uses PASS-TOGGLE A/Bs with fenced
  gpuFrameMs at frozen stepped states (scratch/smooth-perf/costprobe.mjs). `?gputime` stays as a debug param only.
- S5 cost probes (battery, fenced gpuFrameMs ms, same frozen C2 frame per row; cp/cp-med.json, cp/cp-max.json):
  Medium (scale 0.75) C2 1–9.5 s and 12.5–16 s = 17.6–22.0 ms; DOF chain = 1.6–2.2 ms of it; live stains in view
  ≈ 0.3–0.5 ms; lamp cube shadow (2 faces / frame) and torch shadow ≈ 0 (within ±0.5 ms noise). Max (0.85, with the
  mb gate) 15.7–23.7 ms; DOF 1.8–2.0 ms; motion blur at amount 0 now ≈ 0 (gated). Scene/post split run queued.
- S6 v2 `rt-b11-max` (real time, no gputime, build-class diffs + vm_stat): >34 ms 64 / 11 936 frames (0.54 %).
  Stalls are FIRST DRAWS IN THE CUTSCENE CHAIN'S CONTEXTS: build diffs at C4c 0.02 (34: 27 torch-shadow ctx16 + 6 main
  ctx15 + 1), C4c 2.52/2.62 (U3 hem flash), C4c 5.52 (22: the G3 hatch flash), C5 0.02 (31: 17 shadow ctx16 + 15 main
  ctx15 — hall + porch + the car row through the front door), C5 12.37–12.72 (threshold shot) → GPU stalls of
  2.9 s (C4c 0.23), 2.4 s (C5 0.27), 1.1 s (C5 12.63) right after. ctx15/ctx16 = the DOF chain's scene pass and the
  torch spot shadow nested in it (the gameplay contexts are ctx10/…). C7 0.0 = cutscene-fx `car_trim maroon` CLONES the
  tan car materials at the cue → new shader programs → 2.2 + 1.4 s on Max. Page-ins during stalls were modest
  (pi +1.6–6.6 k pages) — paging is not the main cause; the big swap bursts (si +29 k) sit at C5 16.07 (224 ms JS).
  Other: C5b 11.42 498 ms render JS with no builds (to profile), CR 8.4–9.0 250 + 500 ms (swap-in +10.8 k pages).
- S7 FIX (item 2) `cs-shots` load warm-up step (src/render/cs-shots.ts pure poses + src/game/main.ts): every shot of
  C2b C3 C4a C4c C5 C5b C6 C6b C7 CR (86 poses: first frame, + middle / 85 % of long shots) drawn at load with the
  shot's chain (DOF / blur), the cutscene's own culling (bindings CS_CULL_IDS / CS_CULL_EXT_IDS — now exported), the
  torch ON (its shadow pass only draws when lit), C7 with the maroon trim applied (story.fx car_trim → render → tan).
  `?csshots=0` = off. tests/perf-cs-shots.test.ts (3 tests). Verification: full-route real-time Max + Medium queued.
- S8 2026-10-12 10:3x (RESTARTED agent; the first was killed by a network drop ≈ 10:13). Mac on AC (charging).
  ROOT-CAUSE FIX (item 2) src/render/pipeline.ts `pinCallDepth`: three r186 keys a render context by (attachment
  formats, MRT, renderer CALL DEPTH) and puts the context id into every render object's material cache key; the scene
  pass sat at a different nesting depth in each post chain (gameplay / DOF / blur) → every cutscene chain re-built every
  visible object + the nested shadow passes (ctx15/ctx16 of S6). The scene pass (and the gtao=pre pre-pass) now always
  renders at call depth 16 (deeper than any natural nesting, so no outer render in progress shares the context);
  trackPass records the pinned depth (compileView compiles in it). `?scenepin=0` = old per-chain contexts. Expect: the
  cs-shots / tableau-chain / rc9-DOF warm steps log far fewer builds (gameplay's builds serve every chain).
  costprobe.mjs SPLIT adds noAda / noHarlan / noTransp / noAlphaClip / override (raster-only) toggles. Dist rebuilt
  10:37 (S7 + S8); the queued v3 runs (fullmax PROF=ALL, fullmed) + cpsplit read it when they start.
- S9 2026-10-12 11:0x–15:1x (agent stopped by a usage limit ≈ 11:00–14:40). v3 = full route, REAL TIME, S7 + S8 dist,
  AC power (scratch/smooth-perf/power.log: AC 10:17–11:49; shot.mjs's "ON BATTERY" note is from launch time 09:39).
  Max 28 455 frames, ended, 0 deaths; Medium 29 351 frames, ended, 0 deaths. Both logged the 73 load-time errors (see
  For LEAD; fixed since). Tables: `node scratch/smooth-perf/table.mjs scratch/smooth-perf/v3/rt-full-{med,max}.json`.
  * S8 pin evidence (load log): warm cs:* steps 0–1 builds each (cs-shots total 7, all C7's trim clones); tableau 89
    (Max) / 61 (Medium) vs 345 without the pin (lead's 09:24 dist); rc9 79 vs 167; rc9-road 8 vs 85; warm-up phase
    779 / 747 builds vs 1282. Stalls gone: C4c 0.23 (2.9 s) → worst C4c frame 50 ms; C5 0.27 (2.4 s) → 216 ms (Max) /
    67 ms (Medium); C5 12.63 (1.1 s) → 67 ms; C6 18.8 → 150 ms Max / 50 ms Medium.
  * Left (≥ 50 ms): C7 0.1–3.7 on Max (≈ 7 s lost: b5 rp2 at C7 0 = P_AIR_FRESHENER's dust_sheet + paper_aged,
    hidden at load (stingOnly) so never warmed → 1.9 s GPU; then a 520 ms major GC at 1.48 (heap 1.14 GB → 1.07) and
    ctx14 ShadowMaterial builds at 1.68 (car interior into a shadow map: lightning stroke, storm-timed); Medium the
    same, 0.87 + 0.82 s). C5 6.5–7.7 Medium: render JS 73–79 ms/frame + an 847 ms long task; C5 10–14: 43 frames at
    render JS ≈ 42 ms (Max profile, C5 12.6–14: 1.37 s render in 1.5 s — 447 ms in shadow renders, 579 ms
    _updateBindings: C5 is NOT in CS_CULL_IDS → the whole house drawn + shadowed: the next PERF agent's C5-culling
    budget item). B06 / B08 (Max): update JS 58–87 ms frames in bursts of 16–18 (to profile). C1 18–21 Medium: 24
    frames of 50–67 ms with JS 8 ms (GPU). C0 1.17 Max 1.05 s (b0, start of the run).
  * Item 3 attribution (cpsplit, Medium 0.75, AC, fenced gpuFrameMs; cp/cp-med-split.json): C2 3.0 / 6.5 / 9.5 / 12.5 /
    14.0 / 25 = 22.5 / 23.0 / 22.1 / 21.1 / 20.0 / 15.2 ms. Post chain alone (scene hidden) 4.3–4.6; RASTER-ONLY
    (every draw one unlit material) 5.0–7.2 → scene SHADING ≈ 13–17 ms. Half-res scene −8…−10 (fill-bound).
    Characters hidden −11.6 / −10.5 at 3.0 / 6.5 (Ada −7.5, Harlan −3…−5); the ONE alpha-hashed mesh (Ada's hair cards)
    hidden −4.3 / −4.2 / −9.9 / −9.6 / −8.3 at 3.0 / 6.5 / 9.5 / 12.5 / 14.0. Transparent draws (116–119) −1…−2;
    blood particles ≈ 0; stains ≈ 0; lamp shadow map re-render ≈ 0; torch / dark lights hidden −0.3…−2.2 (noise ±1.5).
  * FIX item 3 (part): src/render/hash-prepass.ts — depth pre-pass under alpha-hashed meshes (depth-only material with
    the same opacity node + alpha hash, polygon offset 2 u; the hair then shades with depthWrite off / LessEqual: one
    surviving layer per pixel instead of every card layer). main.ts installs it at afterCompile (post pipeline only);
    `?hairpre=0` = off; `__game.hashPrepass().setEnabled(false)` = same-session A/B. hairab.mjs (same frozen frame,
    ON / OFF / ON, battery — relative): Medium C2 3 / 6.5 / 9.5 / 12.5 / 14 / 16 saved 1.0 / 1.7 / 2.6–4.3 / 0.5 /
    0.5 / 0.4 ms; Max 0.9 / 1.0 / 0.9 / ≈0. Stills OFF vs ON SSIM 0.996–0.9995 in C2 = the same as ON vs ON-again
    (frozen-frame drift); C2c pairs 0.86–0.95 = torch sway drift between captures (no hair in those frames).
  * FIX item 2: cs-shots warm shows the props a cutscene SHOWS by `prop` cue (cs-shots.ts cutsceneShownProps: C7 →
    P_AIR_FRESHENER, C3 → P_CAR_ROW) for its poses (main.ts), then restores them; test added (4/4).
  * FIX console errors: blood-fx stain cull toggles layers, not `visible` (see For LEAD). hairmed run (new dist,
    --beat B03): console errors 0 (cpsplit on the old dist: 73).
- S10 2026-10-12 15:3x (Mac on BATTERY since 11:49 — no real-time numbers since). FIX item 2: the C5-end frames of
  100–133 ms (Medium 31.12–31.32, Max 33.5) are the dawn reflection RE-CAPTURE building P_CAR_ROW (your car, shown at
  C3) in the cube context — m2-world hides it before the load-time capture / prewarmRecapture. main.ts now shows it for
  prewarmRecapture only (that renders into the SPARE cube, overwritten by the real re-capture before it is sampled).
  Queued on the final dist: ws (C1 44/50/55 + C6 2/8/13/20/29 windshield frames, Medium 960×600, for comparison with
  FRAMES capE / capC), gate-medium + gate-max (QA_STRICT=1, --timeout 2400), cpchars (per-character-mesh + unlit cost
  probe, Medium). Real-time re-runs (rtplay Medium + Max, c2rt Medium + Max) wait for AC.
- S11 15:1x. Windshield check (lead's request), final-tree dist built 15:12:55 minus nothing (pin, stain-layer fix,
  hair pre-pass, freshener + car-row warms, DOF fed the sharpen texture): ws run (cs-frames, Medium 960×600, full route
  to C6) → console errors 0, exceptions 0. C1 44 / 50 / 55 vs the FRAMES lane's capE (no pin) at the same clock: drops
  and running streaks on the glass refract the headlit road in both (rain-sim drop positions are random per run:
  SSIM 0.95 / 0.90 / 0.96; crop compare scratchpad); C6 2 / 8 / 13 / 20 vs capC (baseline dist): SSIM 0.971 / 0.987
  / 0.995 / 0.969 (C6 22–31 was re-staged by FRAMES since, not compared). Frames: scratch/smooth-perf/ws/C1-*, C6-*.
  Also (item 3, free): src/render/pipeline.ts feeds dof() the sharpen node's own texture (dof() wrapped the node in an
  RTT = one more full-res RGBA16F copy pass of the same pixels per DOF frame).
- S12 15:3x GATE (item 4) on the final dist (built 15:12:55): `npm test` 304/304; `npm run typecheck` clean for this
  lane (fails only on tests/smooth-c2-head.test.ts, another lane's untracked file); strict playthroughs
  (QA_STRICT=1, --timeout 2400, 960×600): gate-medium ended=true B13 game 523.7 s, 18/18 assertions, 0 deaths,
  0 unsticks, console errors 0, exceptions 0; gate-max ended=true game 554.3 s, 18/18, console errors 0, exceptions 0.
  Reports: scratch/smooth-perf/gate/gate-{medium,max}-report.json. (Battery: correctness only.)
- S13 15:4x item 3 attribution, per character mesh (cpchars, Medium, BATTERY — relative only; held scale 0.65 in that
  run): C2 3.0 base 21.4–22.2 ms; every character mesh drawn UNLIT (same geometry / skinning) 9.4 ms → the characters'
  FRAGMENT SHADING is ≈ 12 ms, > half the frame. Hiding meshes one at a time: hair −4.0, gown −2.6, Harlan shirt −2.6,
  gloves −2.4, skin −2.2, sack −2.2, … (±1 ms noise): the cost is spread over every character material — the common
  factor is the shared character light list (charLights: torch + bounce spots, lightning dir + window spots, the yard
  headlights, the lamp cube shadow, 8 flicker lights, 3 probe grids ≈ 20 light nodes per fragment, physical / clearcoat
  / gown / strand models). Dark-light PCF is already gated (uTorchLit, uShadowOn); the per-light BRDF loop is not.

## HANDOFF (next PERF agent) — 2026-10-12 15:4x
Tree state: every change above is in the working tree (not committed); dist scratch/dist-smooth-perf = the final tree
(15:12:55). Machine on BATTERY since 11:49 → no real-time numbers for the final tree yet.
1. QUEUED for AC: scratch/smooth-perf/ac-queue.sh (pid in scratch/smooth-perf/v4/ac-queue.pid; log v4/ac-queue.log)
   waits for mains power + no Blender, then queues rtplay Medium + Max (v4/rt-full-{med,max}.json) and c2rt Medium +
   Max (v4/c2-{med,max}.json). Evaluate: `node scratch/smooth-perf/table.mjs v4/rt-full-med.json` (item-1 after
   table; compare v3) and `node scratch/smooth-perf/sum.mjs v4/c2-med.json` (C2 > 20 ms = missed-vsync count). Expect:
   C7 0.1–0.35 freshener stall gone, C5 31.1–33.0 re-capture frames gone, C2 slightly better (hair pre-pass, DOF RTT).
   Kill it with `kill $(cat scratch/smooth-perf/v4/ac-queue.pid)` if the dist must be rebuilt first.
2. Item 3 is NOT met (C2 21–23 % missed vsync at the real-route held scales). The lever is character shading (S13):
   (a) per-SPACE character light sets prebuilt at load and swapped at a space change (pattern: FpArms.setLightSets) —
   house: drop the yard headlights and the CAR/RC9 set (exactly 0 indoors), keep the rest; needs a same-frame A/B
   (scratch/smooth-perf/hairab.mjs pattern) because the exterior grid / window spots do reach characters in places;
   (b) gate each probe grid for characters by a CPU-side uniform (is the character inside the grid box + falloff) —
   beware TSL If scoping (shared nodes first built inside a branch); (c) the lead's cutscene-scale policy (For LEAD 3).
3. Item 2 left: C5 sustained CPU overload (no CS culling: the C5-culling budget item; Max profile 447 ms shadows +
   579 ms _updateBindings per 1.5 s), C7 1.48 major GC on Max (heap 1.14 GB), C7 1.7 ctx14 ShadowMaterial builds (car
   interior into a storm-timed shadow map), Medium C1 18.1–21.0 (24 GPU-bound frames, guard tripped), B06/B08 Max
   update-JS bursts (58–87 ms; profile v3/prof-ALL.cpuprofile with scratch/smooth-perf/profwin2.mjs), C0 1.17 Max 1.05 s.
4. FRAMES "For PERF" C5 29.77 torch-pool blink: not investigated (scratch/smooth-perf/c5end.mjs is ready: SCENE=C5
   FROM=29.3 TO=30.5 PRE=0 POST=1, --beat B11; it logs torch / arms / culling / door state per frame).
- S14 15:5x. hairmed2 on the final dist (battery, held scale 0.65): console errors 0; pre-pass saves 1.0–1.4 / 1.4 /
  1.0–1.2 / 0.5–0.6 / 0.4–0.7 ms at C2 3 / 6.5 / 9.5 / 12.5 / 14. DOF chain after the sharpen-texture change vs the
  build-6 stills: C2 3.0 SSIM 0.9987, C2 9.5 (DOF on the boards) 0.989 at a different held scale (0.65 vs 0.75) —
  bokeh and focus unchanged by eye (the change is texel-exact by construction: the removed RTT copied the same-size
  texture). cpchars: Chrome died (memory: swap 5.1 / 6 GB used) after 2 rows; both rows say the same (S13).
  Battery 12 % at 15:5x. Dist kept for the AC queue (item 1 of HANDOFF) — delete it after v4 has run.
- S15 Max pre-pass stills (hair/max): C2 3 / 6.5 / 8 / 9.5 / 11 / 12.5 / 14 / 16 / 25 OFF-vs-ON SSIM 0.9996 / 0.9993 /
  0.9983 / 0.9962 / 0.9986 / 0.9984 / 0.9974 / 0.9988 / 0.9992 vs ON-vs-ON-again 0.9996 / 0.9995 / 0.9986 / 0.9963 /
  0.9992 / 0.9986 / 0.9977 / 0.9990 / 0.9993 → same as frame drift; C2c pairs (0.64–0.95) drift as much ON-vs-ON-again
  (0.71–0.95): torch sway between captures, no hair in frame.
