# STATUS — PERF round 2, lane JUDDER (contract #150; ROADMAP ruling (aq))

User: the beheading (C2) "isn't smooth enough" (jerky movement, freezes/stutter). Previous PERF lane:
docs/STATUS-smooth-perf.md (#143; S5, S9, S13 + its HANDOFF). Base tree: HEAD 0ba616a + the uncommitted verified work.
Scratch: scratch/perf2/. Dist: scratch/dist-perf2-judder (deleted at the end).
Owned: src/render/** except the FLASH files (flashlight.ts, flashlight-bounce.ts, exposure.ts, look.ts exposure/torch
constants), src/game/main.ts, src/core/**, src/world/level.ts, src/world/blood-fx.ts, the CS_CULL_* arrays in
src/cutscenes/bindings.ts, the character material light-list wiring (skin.ts / loader.ts / bank.ts / story-runtime.ts —
surgical, every edit logged here), tests/perf-*.test.ts.

## Items
1. C2 baseline on AC (C2 → C2c → B05 real time, Medium + Max; missed-vsync % per segment, held scale; fenced GPU ms at
   4 frozen C2 states) — DONE (S3 real time; frozen-state ms = S4's `base` column, S9 / S11 / S22 plain column)
2. Character shading cost — DONE: attribution S4; gates S5–S7; POINT/SPOT POOL S8; Medium proof S9 / S10, Max S11
   (−5…−9 ms per C2 frame, no visible change); real time S11 (C2 < 1 % missed vsync on both tiers at the old holds)
3. Ruling (aq) — DONE in code: hold = max(floor, min(gameplay, cap)) + missed-vsync guard (S1), measured caps (S12,
   S17, S18: Medium C6 0.7 / C6b 0.725 / C7 0.675; Max C2 0.875 / C4c 0.85 / C5 0.9 / C5b 0.95 / C6 0.85 / C6b 0.875 /
   C7 0.9; every other cutscene: no measured limit), tests (12). C5 CULLING (S14 / S17 / S19): −36…−68 % draws,
   −1…−5 ms; light state equal; stills SSIM ≥ 0.989 — BUT one content difference: the last ≈ 3 s of C5 (camera in
   the hall looking out the open front door) now lack EXT1's far trees, exactly as gameplay already shows that view
   (G1's PVS has no EXT1); the shipped render-all C5 showed them and popped them out at the hand-off (verified in code,
   S23). Lead decision requested (For LEAD). Whole-route real time on the final dist C (S28 / S29): every Medium
   cutscene < 0.4 % missed vsync (no cap revision needed); on Max C3 / C4c / C5 / C6 / C7 still miss 9–25 % AT the
   0.85 floor (the ruling stops the scale there — efficiency work, handoff).
4. Prove it — DONE. Final tree (dist C, S27): real-time C2 → C2c → B05 Medium 1 / 1739 = 0.06 % and Max 1 / 1739 =
   0.06 % of C2 frames > 20 ms (the only miss = C2's entry frame, 33.4 ms, one missed vsync); whole route (S28 / S29):
   C2 0 / 1740 Medium, 13 / 1727 = 0.75 % Max. Hero stills before / after (S21 Medium, S22 Max; C2 3 / 7.4 / 9.3 /
   13.9 / 19 / 25) inside the cross-session noise floor (SSIM 0.982–0.9985; 100 % crops: face, hair, boards, blood
   identical to the eye); nothing since dist A changes a C2 pixel (S25: load-time warm only).
   C2 entry frame (S25–S27): the only pipeline built in it (the lamp flag's DoubleSide shadow pipeline) now builds at
   load; per-pass cost of what remains: q14 (c2entry.mjs).
5. Gate — DONE on dist C (the final tree): typecheck clean, npm test 349 / 349, vite build + verify-boot OK (S25);
   strict playthroughs (QA_STRICT=1, scripts/qa/playthrough.mjs) Medium (09:28–09:36) and Max (09:36–09:48): both
   ended=true at B13 (C7 → title), 0 deaths, console errors 0, exceptions 0 (S30).

## Log
- S0 2026-10-13 03:4x start. AC power (charging 96 %). A JUMPSCARE Cycles render holds the Blender lock (scare-look
  round 10, started 03:42) → shot.mjs waits; real-time / GPU numbers only once it is done. Disk 15 GiB free (keep ≥ 12).
  The previous lane's AC queue (scratch/smooth-perf/v4) never ran (log empty, pid gone) → there is NO after-table for
  the #143 final tree; item 1 here is the first AC measurement of it.

- S1 03:5x CODE item 3 (pure part; caps not measured yet): src/render/cutscene-profile.ts rewritten — hold =
  max(floor, min(base, cap(id))), base = gameplay scale (or the ?csscale=1 raise); caps CUTSCENE_CAP[preset][id] are a
  scale at CAP_REF_PIXELS (1280×800, DPR 1) applied as an internal-PIXEL budget (capScaleFor: a Retina / Max-1.5
  drawing buffer gets the same pixel count, not the same scale); `cut(id)` re-applies a chained cutscene's own cap on
  its first frame; guard per 1 s window: > 5 % of frames > 1.2 × target interval (60 Hz: > 20 ms — the S9 "missed
  vsync") → −0.05, again per window, never below the floor, never back up; mean > 40 ms → floor + `tripped` (beam off);
  frames > 250 ms ignored (stalls). `?csprofile=legacy` = the #143 profile (no caps, no vsync guard, trip → gameplay
  scale) for baseline A/Bs; `?cscap=0` = no caps. main.ts: floor = dynResFor(...).min; the hold is synced in render()
  and in the stepped advance() BEFORE pipeline.render (the cut frame already has its scale; before, onRendered changed
  it one frame after the cut; stepped captures now see the scale the player gets); guard logs `[game] cutscene vsync
  guard …`. tests/perf-cs-cap.test.ts (10) + the old tests/cutscene-profile.test.ts (5) pass; typecheck clean.
- S2 04:0x CODE item 2 (UNVERIFIED, numbers pending): src/render/char-lights.ts + char-light-select.ts (pure) — the
  characters' LightsNode is a FIXED list: shadowed / cookie lights + probe grids as before, the unshadowed map-less
  pool lights (8 flicker points; Medium's 3 lightning window spots) replaced by 4 point + 2 spot PROXY lights re-pointed
  every frame to the pool lights whose cutoff sphere reaches a character's bone bounding sphere (three's falloff is
  exactly 0 at d ≥ cutoff; dark lights add 0) — no LightsNode key change, no rebuild. story-runtime.ts (surgical, see
  "Edits outside src/render"): charList → CharacterLights; subjects = Ada body bones (+0.6 m), her head rig (+0.35 m),
  Harlan (+0.5 m), only while drawn, world matrices refreshed first (a cut teleports a figure); updated in lateUpdate
  (after the flicker loop and the fx overrides). `?charlights=0` = old shared list. tests/perf-char-lights.test.ts (4).
- S3 05:4x (RESTARTED agent: the first stopped ≈ 04:40; its queue q1.sh died with it after the Medium run — the Max
  run and the ablation never ran). AC (100 %, charged), no Blender. ITEM 1 baseline = dist-perf2-judder (04:00: S1
  code only, run with `?csprofile=legacy` = the #143 profile; NO char-lights) — real-time C2 → C2c → B05
  (scratch/smooth-perf/c2rt.mjs, 6 s real-time hall walk first so gameplay dynres settles before the hold):
  | tier | held scale | C2 frames > 20 ms | C2c > 20 ms | B05 > 20 ms | worst |
  |---|---|---|---|---|---|
  | Medium (v1/c2-medium-base.json, 04:17) | 0.80 | 147 / 1593 = 9.2 % (54.9 fps) | 0 / 835 | 0 / 302 | 33.4 ms |
  | Max (v2/c2-max-base.json, 05:44) | 0.90 | 174 / 1562 = 11.1 % (53.8 fps) | 1 / 833 | 3 / 299 | 116.7 ms @ C2 0.12 |
  Every miss is a 33.3 ms frame (one vsync missed); spread over C2 1–15 s and 19 / 24–25 s (Medium 8–18 per
  second, Max 4–20). JS avg 7.6 ms → GPU-bound. Held scales this run 0.80 / 0.90 (v3 had 0.85 / 0.95 → 21–23 %).
- S4 05:5x ITEM 2 attribution — what a character pixel pays for (scratch/perf2/lightab.mjs on dist-perf2-judder, Medium,
  frozen C2 states at scale 0.75, fenced gpuFrameMs min of 2 × 60; the 21 character materials' LightsNode swapped for
  subsets, warmed before measuring; log v2/ab-medium.log, stills v2/ab-medium/; the run hit shot.mjs's 420 s default
  timeout after 3 states):
  | C2 t | base | none (0 lights) | live (lit + in reach) | noDark | noFlick (−8 flicker pts) | noGrids | farGrids (−1 grid) | std (plain Standard, same lights) |
  |---|---|---|---|---|---|---|---|---|
  | 3.03 | 19.36 | 10.53 | 11.94 (9 of 20) | 12.15 | 13.57 | 15.50 | 18.06 | 17.64 |
  | 7.43 | 22.66 | 12.06 | 13.62 (9) | 13.75 | 15.42 | 17.44 | 21.37 | 13.69 |
  | 9.33 | 17.80 | 9.88 | 10.83 (7) | 10.79 | 11.90 | 13.67 | 17.05 | 10.07 |
  The character light list costs 8–10 ms of a 18–23 ms frame, and 85–90 % of it is lights that are DARK or out of
  reach at that moment (torch off in C2, lightning dir + 3 window spots between strikes, both yard headlights, the
  lantern / kitchen candles, the upper floor's grid). Stills: live / noDark / farGrids vs base SSIM 0.993–0.9986
  (PSNR 48–60 dB) = frame noise (farGrids — removing a grid that provably adds 0 — gives the same numbers).
  Max (0.85 = its DPR-1 dynres floor; 17 lights — no window spots on Max; log v2/ab-max.log):
  | C2 t | base | none | live | noDark | noFlick | noGrids | farGrids | std |
  |---|---|---|---|---|---|---|---|---|
  | 3.03 | 19.98 | 13.45 | 14.68 (9 of 17) | 14.87 | 15.32 | 17.01 | 19.46 | 19.55 |
  | 7.43 | 23.76 | 15.93 | 17.41 (9) | 17.62 | 18.15 | 20.33 | 22.96 | 16.93 |
  | 9.33 | 18.99 | 13.66 | 14.45 (7) | 15.48 | 15.26 | 17.39 | 18.60 | 12.82 |
  Max cannot drop below 0.85 (its floor = Medium's best pixels): at the strike (7.43) even NO character lights is
  15.9 ms fenced — the rest is the Max post chain (GTAO, DOF, motion blur at the strike) + the scene; to be seen in
  real time (fenced ms ≈ max(CPU, GPU) back-to-back, not the vsync-paced cost).
  → DESIGN CHANGE: the S2 proxy slots only remove 4 points + 1 spot (≈ the noFlick column at best) and cannot touch
  shadowed / cookie lights; replaced by GATES (S5).
- S5 06:1x CODE item 2 (replaces S2): src/render/char-lights.ts `GatedLightsNode` (LightsNode subclass, same list /
  order / cache key → no rebuild): each light's evaluation sits in `if (gate > 0.5) {…}` on a per-light renderGroup
  uniform (uniform control flow → the whole draw skips the light's BRDF + shadow PCF + cookie / grid fetches);
  shared fragment VarNodes (positionViewDirection, normalView, normalWorld, clearcoatNormalView, the lighting model's
  accumulators) are stacked BEFORE the first branch. `CharacterLights.update()` (story-runtime lateUpdate) opens a gate
  only for a light that can add to a character pixel: lit (intensity × colour > 0) AND (punctual: cutoff sphere
  touches a subject sphere — three's falloff is exactly 0 beyond it; directional: always; grid: box + falloff touches
  a subject — weight exactly 0 beyond). Subjects: Ada's body bones + 0.8 m, her head rig + 0.7 m, Harlan + 0.7 m,
  ALWAYS (drawn or not: no same-frame show/hide race). QA: `story.charLights.force = true` = every gate open (the old
  work, SAME program) for same-frame A/Bs; `.audit(scene)` lists meshes drawn with the list outside every subject
  sphere (posed SkinnedMesh bounds); `?charlights=0` = plain list. char-light-select.ts: reachOf / gridReaches /
  boxDistance (pure); tests/perf-char-lights.test.ts (3). Proof tool scratch/perf2/gateab.mjs: WGSL audit of every
  character fragment shader (a var read outside the only if-block assigning it = a closed gate would read 0) +
  same-frame gated vs all-open ms and stills at C2 3 / 7.4 / 9.3 / 13.9 / 19 / 25, C2c 3 / 8. Dist
  scratch/dist-perf2-gate (06:1x). dist-perf2-b (S2) deleted.
- S6 06:4x first gate run (gateab Medium) INVALID — caught by its console check (119 errors): the gate uniforms had
  custom names from the light names (`charGate_flashlight-bounce`); a renderGroup uniform name becomes a WGSL struct
  member → every character program failed to compile (characters not drawn → the "10.8 ms" rows were meaningless).
  Names removed. The WGSL dump then showed a REAL scoping bug: the lighting context's accumulators
  (reflectedLight.directDiffuse / directSpecular …) were first referenced inside the first gated branch, so
  `directDiffuse = vec3(0)` was emitted inside EVERY gated branch (each open light wiped the ones before it). Fixed:
  setupLights now stacks every VarNode of builder.context, context.reflectedLight and the lighting model, plus
  positionViewDirection / normalView / normalWorld (/ clearcoatNormalView) BEFORE the first branch. gateab's WGSL
  analyzer now works per function, understands if/else pairs and accumulations (`x = x + …`); remaining flags are
  reviewed by hand and the stills A/B (gated vs all-open vs ?charlights=0) is the ground truth. Dist rebuilt 06:5x;
  q5.sh re-queued (gate A/B + plain-list stills, Medium 0.8 then Max 0.9).
- S7 07:1x gate A/B (gateab Medium 0.8, dist-perf2-gate after the S6 fixes; console errors 0; v3/gate-medium.log,
  stills v3/g-medium/): fenced ms gated / gated-again / all-open: C2 3.0 14.4 / 17.2 / 17.8 · 7.4 21.9 / 19.0 / 22.2 ·
  9.3 15.5 / 15.8 / 18.1 · 13.9 12.1 / 13.2 / 15.5 · 19 11.4 / 12.1 / 14.0 · 25 19.7 / 16.6 / 18.5 · C2c 3 10.2 / 12.1 /
  11.8 · C2c 8 8.8 / 9.2 / 9.0 (this run's noise ±3 ms). Stills gated vs all-open SSIM 0.994–0.9988 = gated vs
  gated-again (noise) at every C2 state → the gates change no pixel; C2c stills drift (torch sway; no figure in frame).
  Audit (meshes outside the subject spheres) empty at all 8 states. Remaining WGSL flags are 2 per program, in the
  spot-cookie `inSpotLightMap.select()` else-branch (a shadow value reused from the if-branch) — three's own
  select() codegen, same structure without gates; checked against ?charlights=0 program dumps (queued).
  VERDICT: gating is exact but only saves 0–3 ms, against 7–9 ms for REMOVING the dark lights from the program (S4):
  the cost follows the program's light count (code size / registers), not the lights executed.
  → CODE (S8): the 8 unshadowed, map-less flicker point lights become ONE loop (PointPoolNode: `count` live lights
  packed per frame into uniform arrays, each light exactly three's PointLightNode math) — 8 BRDF copies fewer in every
  character program; gates kept for the rest. `?charpool=0` = gates only. Dist scratch/dist-perf2-pool (07:17);
  q5e.sh queues its A/B (gated / all-open / all-closed, plain list, gates-only stills + ms; Max; real-time C2).
  Real-time C2 with gates only (q5c.sh, same-dist ?charlights=0 control) runs first.
- S8 07:3x CODE: src/render/char-lights.ts `PointPoolNode` — the list's unshadowed, map-less, colour-node-less point
  lights (the 8 flicker candles / lantern) as ONE `Loop(count)` over uniform arrays (world pos + cutoff, colour ×
  intensity + decay; spot pools add target direction + cos(angle) / cos(angle·(1−penumbra))) — exactly
  PointLightNode / SpotLightNode math (view position = cameraViewMatrix × world position, getDistanceAttenuation,
  smoothstep cone); Medium's 4 plain spots (torch bounce + 3 lightning window spots) are a second pool; Max's single
  plain spot (bounce) stays a light. `count` = the pooled lights that reach a subject this frame (no slot limit: the
  arrays hold the whole pool → nothing is ever dropped). The rest of the list stays gated. Character programs shrink
  from ≈ 102–144 KB to ≈ 49–76 KB of WGSL. `?charpool=0` = gates only. Same-tree real-time control: plain list
  (?charlights=0, dist-perf2-gate) Medium held 0.80: C2 126 / 1614 frames > 20 ms (7.8 %), C2c 0, B05 0 (v3).
  First pool rows (gateab Medium 0.8, dist-perf2-pool): C2 3.0 gated 12.69 / 12.65 · all-open 13.95 · all-closed
  12.61 ms; 7.4 14.46 / 14.46 · 15.94 · 14.45; 9.3 11.61 / 11.62 · 12.87 · 11.61 (stable run: gated ≈ gated-again).
- S9 07:4x POOL PROOF, Medium 0.8, same dist (dist-perf2-pool), same frozen states, fenced gpuFrameMs (min of 2 × 60):
  | state | plain list (?charlights=0) | pool + gates | Δ |
  |---|---|---|---|
  | C2 3.0 | 20.76 | 12.69 | −8.1 |
  | C2 7.4 (strike) | 24.00 | 14.46 | −9.5 |
  | C2 9.3 (head on the floor) | 20.04 | 11.61 | −8.4 |
  | C2 13.9 (eye) | 19.99 | 8.93 | −11.1 |
  | C2 19 | 16.58 | 8.58 | −8.0 |
  | C2 25 | 16.31 | 13.43 | −2.9 |
  | C2c 3 / 8 (no figure in frame) | 8.02 / 6.27 | 8.11 / 6.44 | ≈ 0 |
  Same-session: gated ≈ gated-again (≤ 0.1 ms); all gates open +0.7…+1.6 ms; all gates closed = gated (the closed
  branches' work is negligible once the program is small). Console errors 0 (both runs). Stills: pool vs plain SSIM
  0.998 / 0.997 / 0.986 / 0.988 / 0.993 / 0.997 (C2 3 / 7.4 / 9.3 / 13.9 / 19 / 25) against same-session noise
  0.9986 / 0.9978 / 0.9939 / 0.9964 / 0.9975 / 0.9986; the extra cross-session difference sits on the hair-card hash
  speckle and the animated blood drips (×8 diff image), NOT on the lighting: mean luma of the face / hair / floor at
  9.3 = 44.00 / 46.34 / 10.09 (pool) vs 43.98 / 46.26 / 10.05 (plain). Subject audit empty at all states.
- S10 07:5x Cross-session noise floor (advisor): plain vs gates-only (`?charpool=0`; gates proven exact in-session, so
  identical lighting) = 0.9987 / 0.9969 / 0.9862 / 0.9879 / 0.9927 / 0.9970 at C2 3 / 7.4 / 9.3 / 13.9 / 19 / 25 — the
  same as pool vs plain (0.9983 / 0.9973 / 0.9860 / 0.9881 / 0.9927 / 0.9970): the pool adds nothing visible beyond
  session drift (hair-hash speckle, blood drips). Gates-only fenced ms (same dist, 0.8): 18.3 / 17.4 / 14.2 / 12.8 /
  11.4 / 18.3. (The all-closed "kill" STILLS are not evidence — qa.shot re-ran the frame update first; its ms are.)
  FIX (advisor): updateCharLights moved from story.lateUpdate() to the END of main.ts world() (after rig.update /
  torchBounce.update / syncSurfaceLook): the torch gate and the pooled bounce were one frame stale at a switch-on
  (one-frame pop risk on a lit figure). story-runtime exposes `updateCharLights`; main.ts calls it.
  cscost.mjs now logs openNames + the subject audit at every sample (route-wide containment proof).
  scratch/dist-perf2-final built 07:50:5x from the tree at that time (pool + order fix; caps still empty) → q6.sh:
  WebGL2 check, C2-start probe, cscost Medium + Max (C2 C2c C2b C4a C4c C5 C5b C6 C6b C7).
- S11 08:2x REAL TIME (c2rt, #143 profile = hold the gameplay scale, no caps; AC, no Blender running during the runs):
  | run | held | C2 frames > 20 ms | C2c | B05 | C2 fps |
  |---|---|---|---|---|---|
  | Medium plain list (same tree, dist-perf2-gate ?charlights=0) | 0.80 | 126 / 1614 = 7.8 % | 0 / 835 | 0 / 302 | 55.7 |
  | **Medium pool + gates (dist-perf2-pool)** | 0.80 | **1 / 1739 = 0.06 %** (the cut frame, C2 0.05: 33 ms) | 0 / 835 | 0 / 302 | **60** |
  | Max plain list (same tree) | 0.90 | 171 / 1569 = 10.9 % | 0 / 835 | 11 / 291 | 54.1 |
  | **Max pool + gates (dist-perf2-pool)** | 0.90 | **6 / 1733 = 0.35 %** (C2 0.07 the cut: 49.9 ms, + 8–9 s ×4, 19 s ×1) | 0 / 835 | 0 / 302 | **59.8** |
  → item 4's target (< 1 % missed vsync) is met on BOTH tiers at the real-route holds, before any cap. The one
  remaining Max hitch is the C2 cut frame (49.9 ms; prev frame built a ShadowMaterial pipeline + a 1152×720 RGBA16F
  mip target — the baseline's 117 ms frame, now smaller).
  Max pool frozen (gateab 0.9, same dist; plain at the same states in brackets): C2 3.0 15.2 (20.7) · 7.4 18.2 (24.7)
  · 9.3 15.4 (20.4) · 13.9 12.4 (21.0) · 19 11.7 (18.3) · 25 16.1 (19.6) · C2c 3 / 8 10.1 / 9.0 (10.1 / 9.0); console
  errors 0.
- S12 2026-10-18 21:0x RESTARTED agent (the tree sat idle since 10-13 09:45: no file changed since; q6b's cap
  measurement had finished — v4/cost-{medium,max}.json, dist-perf2-final, 0 console errors —, q7 never ran; my dists
  were deleted). AC (charging 43 %), no Blender; the lead's ship gate (dist-ship2 = this tree incl. the #150 char
  lights) holds the Chrome lock → q8 waits for it. Disk 11–13 GiB free (swap 3.5 / 5 GB swings it): ONE dist at a time.
  CODE item 3: capfit.mjs v2 (advisor review of v1's fit): rows whose ms RISES > 1 ms as the scale falls = a stall in
  the sample → dropped; over budget at the lowest scale with the two lowest scales within 1 ms (or slope ≤ 0) =
  CPU-bound → no cap from it; all under budget with slope ≤ 0 → max (v1 extrapolated those to 0: C7 Medium "0");
  caps rounded DOWN to the 0.025 dynres grid. Only MEASURED limits are listed (a cap at the dynres max is no measured
  limit and would bind on a larger drawing buffer through the pixel-budget conversion). CUTSCENE_CAP:
  Medium C6 0.7 (worst @6.37 20.3 / 18.6 / 16.2 ms at 0.85 / 0.75 / 0.65), C6b 0.725, C7 0.675 — C2 / C2c / C4a /
  C4c / C5b never over 17.5 ms at 0.85 (no cap); Max C2 0.875 (@8.4 19.9 / 18.1 / 16.7 at 1 / 0.925 / 0.85 → 0.894;
  the S11 real-time misses sit at C2 8.1–9.1 s at 0.90), C4c 0.85 (floor; raw 0.83), C5b 0.95, C6 0.85 (floor; raw
  0.75 — 20.5 ms at 0.85: cannot hold 60 on the M1 at any allowed scale), C6b 0.875, C7 0.9. CPU-bound states (no
  scale fixes them): Medium C5 0.3 / 2.3 (≈ 18.2–18.7 flat), C6 20.5 / 22.5 (≈ 19.4 flat), Max C4c 4.33, C5 0.3–14.5
  (5 states, 18.3–20.8 flat). tests/perf-cs-cap.test.ts +2 (shipped caps < max, on the grid, ≥ the real dynResFor
  floor; the shipped table end to end) → 12 pass.
  CODE C5 culling (ruling (aq)): bindings.ts CS_CULL_IDS + 'C5'. Why the R34 caveat cannot apply: the only input of
  RuntimeLights that culling changes is the room lookup (camera feet vs camera xy + PLAYER feet); scratch/perf2/
  c5rooms.ts (pure, Node) walks C5's camera every 0.1 s: both lookups give G1 / G2 with identical PVS at every instant
  → same `seen` set and viewer room → same flicker / window-spot gating by construction (R34 / G5's two luminance
  "modes" were playthrough timing noise, STATUS-perf-g G5). Hidden rooms also stop casting into visible shadow maps →
  same-state stills are still required: scratch/perf2/cullab.mjs (real route; at every 2 s of C5's clock three arms
  cull / render-all / cull again, each re-applying the camera binding with advance(1, 1e-5): light-state vector, draws
  / tris, fenced ms (cull arm at 3 scales = the C5 cap rows), stills after the same N-frame render). main.ts:
  `__game.csCull()` (QA, returns the Set). Typecheck clean, npm test 347 / 347. Dist scratch/dist-perf2-a (21:1x).
  Contract row #150 appended to docs/CONTRACT-CHANGES.md (C5 cap pending). Queue q8.sh (log v6/q8.log): cullab C5
  Medium + Max → real-time c2rt Medium + Max AFTER (default profile) → after stills (frozen.mjs, Medium 0.80 / Max
  0.875, same T as the v4p/plain-* BEFORE stills). Then: C5 cap → dist B → whole-route real time (rtplay) + strict
  gates.
- S13 21:5x self-review of char-lights.ts (shipping in the lead's dist-ship2): logic matches what S9–S11 proved; one
  fix — boneSphere() allocated a new bone-position array per figure per frame (3 / frame, GC churn) → a reused
  module-level buffer (same result). Typecheck clean, perf-char-lights 3 / 3. NOT in dist A (q8); in dist B. Chrome
  blocked: the JUMPSCARE lane's Cycles round 19 (assets.mjs scare-look, 21:22 →) holds Blender; the lead's ship gate
  (low / careless / torch left) and q8 wait behind it.
- S14 23:5x C5 CULLING, Medium (cullab v1 on dist-perf2-a, 23:31–23:43; no Blender overlap: scare-look r21 ended
  23:31:04, r22's Blender started 23:43:25; AC; console errors 0; log v6/c5-medium.log, rows v6/c5-medium{,.ab}.json):
  | C5 t | draws cull / all | tris cull / all | fenced ms at held 0.75: cull / all |
  |---|---|---|---|
  | 0.3 | 458 / 823 | 1.55 / 2.51 M | 13.50 / 18.55 |
  | 2.3 | 451 / 811 | 1.55 / 2.48 M | 13.36 / 18.25 |
  | 6.3 | 267 / 403 | 1.19 / 1.66 M | 13.25 / 15.91 |
  | 10.3 | 435 / 760 | 1.53 / 2.33 M | 16.03 / 20.65 |
  | 12.3 | 323 / 626 | 1.27 / 1.97 M | 12.49 / 17.08 |
  | 14.3 | 325 / 653 | 1.31 / 1.94 M | 14.85 / 17.58 |
  | 18.3 | 85 / 264 | 0.31 / 1.06 M | 5.97 / 9.39 |
  | 26.3 | 76 / 183 | 0.23 / 1.01 M | 8.30 / 10.25 |
  Every state: −36…−68 % draws, −2…−5 ms; the pre-cull CPU-bound states (0.3 / 2.3 flat at 18.2–18.7 ms) are gone.
  LIGHT STATE (every flicker / window-spot / runtime light intensity, lightning directional, the character gates'
  open lights, the room, the PVS) cull vs render-all: EQUAL at 15 of 17 states; at 18.3 / 20.3 one light differs —
  flicker #3 (the cutscene-fx-driven roaming shadow light, own clock) — and it differs as much between the two CULL
  arms (cull vs cull2), i.e. the fx's timing, not the culling. Room / PVS identical at all 17 (as c5rooms.ts predicted).
  STILLS v1 INVALID as evidence: same-arm SSIM 0.89–0.98 — the arms' stills were taken after gpuFrameMs (world(1/60)
  per frame: the exposure meter adapting, the torch rig swaying; the cull arm rendered 3× the frames). A composite of
  14.3 (cull | all | diff) shows the same framing and a GLOBAL brightness offset = exposure drift, not a culling
  difference. cullab v2: each arm's still is rendered with pipeline.render() only (no world(): exposure / torch /
  hands frozen, TAAU converged on the same frame), the three stills before any ms — re-run queued (Medium on dist B;
  the Max run in q8 picks v2 up: shot.mjs imports the scenario when it starts).
  C5 CAP Medium (capfit on the cull arm): NONE — no state over 17.5 ms at 0.85 after culling (worst 16.16 @14.3; 4.3
  dropped as a stall: 15.8 / 20.0 / 13.2). Efficiency alone fixed C5 on Medium: no resolution cost.
- S15 10-19 00:1x POWER: the Mac ran on BATTERY ≈ 22:57–23:52 (pmset log) → the S14 Medium C5 run (23:31–23:43) was
  on battery (84 %, shot.mjs: "fps capped at 30 and GPU throttled"). Its same-session A/B parts stay valid (draws,
  tris, light-state equality, cull-vs-all ms ratios); its absolute ms are throttled, i.e. HIGHER than on AC, so
  "Medium C5 needs no cap" (≤ 16.2 ms at 0.85 throttled) holds a fortiori — re-measured on AC anyway (q9). The Max C5
  run (q8) started on battery at 23:43, waited for scare-look r22, then died at 00:09:40 when the machine entered
  CLAMSHELL sleep (lid closed; caffeinate -ims cannot prevent a lid-close sleep): "headless Chrome connection closed"
  at B09–B11, 0 C5 rows. Back on AC since 23:52. q9.sh (after q8): cullab v2 Max, then Medium (dist-perf2-a, AC).
  q8 continues: real-time C2 Medium + Max after, after stills (each step logs to its own v6/*.log; q8.log only gets
  "queue done").
- S16 01:1x the q8 real-time C2 Medium run (00:09–00:54) never ran: its load stalled 300 s at "Compiling shaders —
  characters" (machine sleeping / Blender r23 / battery), retried, then hit shot.mjs's default 420 s timeout. The Mac
  is on BATTERY again (90 %, 01:09; load avg 14: Blender + the FLASH re-verify). q8 / q9 stopped (their shot run
  SIGTERM'd: shot.mjs cleans up). NEW q10.sh (log v8/q10.log): every step waits for AC (pmset) before it starts, a
  10 s power sampler (v8/power.log) brackets each run, a run that saw ANY battery sample is marked INVALID and retried
  once; generous --timeout / --start-timeout. Steps: cullab v2 C5 Max + Medium → real-time C2 Medium + Max after →
  after stills. All heavy work AC-gated (no battery drain overnight on the user's laptop).
- S17 03:0x C5 CULLING, Max — cullab v2 (frozen-state stills) on AC (q10: 87 AC samples / 0 battery, 02:40–02:54;
  Blender only waited out before the start; console errors 0; v8/c5-max.log, v8/c5-max{,.ab}.json, stills v8/c5x/):
  draws cull / all 457 / 829 (0.3), 451 / 802 (2.3), 435 / 761 (10.3), 326 / 652 (14.3), 83 / 262 (18.3), 190 / 315
  (32.3); fenced ms at the held 0.85, cull / all: 16.6 / 21.8, 18.3 / 24.0, 16.9 / 20.0, 18.2 / 19.4, 15.5 / 17.7,
  19.6 / 24.7, 18.1 / 19.4, 18.8 / 22.7, 15.1 / 17.4 (0.3 … 16.3), 8.8 / 11.7, 9.8 / 12.1 (18.3, 20.3) → −1…−5 ms.
  LIGHT STATE cull vs render-all: every light within 0.01 % (the flicker clock moves 1e-5 s per arm) at all 17
  states, except the fx-driven roaming light at 18.3 / 20.3 which differs MORE between the two cull arms (10–12 %)
  than cull vs all (4–6 %) = its own clock. Room / PVS identical at all 17.
  STILLS (v2 protocol works): SSIM cull vs render-all 0.9895–1.000 at all 17 states (≥ 0.98), same-arm floor (cull vs
  cull2) 0.9875–1.000. ONE REAL DIFFERENCE, at 30.3 / 32.3 (cull vs all 0.9947 / 0.9951 against 0.998 same-arm):
  the camera looks out the open FRONT DOOR from the hall and the culled frame has fewer FAR TREES — they are EXT1's,
  and the layout's G1 visibleRooms has no EXT1 (scratch/perf2 node check: PVS at C5_END_EYE = CLOSET, EXT2, G1, G2,
  G3P, U1). C5 hands over to gameplay at C5_END_EYE facing the front door, and gameplay culls exactly like the cull
  arm → the shipped render-all C5 POPS those trees out at the C5 → gameplay hand-off; culled C5 now matches the
  gameplay frames that follow (no pop). The gap itself (far yard trees culled when looking out the front door from
  the hall, in gameplay) is a layout PVS question → For LEAD.
  CAP Max C5 = 0.9 (capfit: 0.3 {1: 18.18, 0.925: 18.11, 0.85: 16.58} → 0.915; 4 states dropped as stalls, 6.3 / 14.3
  CPU-bound: 18.2 / 18.8 ms at the floor). Max C5 0–15 s stays 16.6–19.6 ms fenced at its floor after culling: it
  cannot hold 60 there on the M1 (CPU-bound) — handoff item.
- S18 03:1x CUTSCENE_CAP max + C5 0.9 (comment cites v8/c5-max.json). Medium C5: no cap (S14, battery-throttled
  ms ≤ 16.2 at 0.85 — AC can only be lower; the AC re-run is q10's c5-medium). Typecheck clean, perf tests 15 / 15.
  dist scratch/dist-perf2-b built 03:07 (verify-boot OK) = the FINAL tree of this lane; it also carries other lanes'
  edits since dist A (FLASH src/characters/arms.ts + tests/arms-pullback.test.ts, scripts/assets.mjs, the 3 asset
  manifests). Disk 16 GiB free. q11.sh (after q10; AC-gated, log v9/q11.log): whole route REAL TIME (rtplay)
  Medium + Max → strict gates Medium + Max → WGSL dumps gated vs ?charlights=0 → the C2-cut builder probe (Max).
- S19 03:2x C5 CULLING, Medium — cullab v2 on AC (q10, 03:08–03:22, 165 AC / 0 battery samples, no Blender running:
  the last scare-look round ended 03:06:27; console errors 0; v8/c5-medium*, stills v8/c5m/): draws cull / all 455 /
  828 (0.3), 425 / 729 (4.3), 434 / 764 (10.3), 324 / 651 (14.3), 83 / 262 (18.3), 186 / 312 (32.3). Light state
  cull vs render-all within 0.012 % at every state except the fx-driven roaming light (18–20 s, own clock). Stills
  SSIM cull vs render-all 0.9939–1.000 (same-arm floor 0.9878–1.000) — the same EXT1 far-tree difference through the
  front door at 30.3 / 32.3 (0.9939 / 0.9943 vs same-arm 0.9975 / 0.9982) as on Max (S17).
  ABSOLUTE ms of this run are NOT the machine's nominal cost: another agent's Python job ran at ≈ 74 % CPU during it
  (seen at 03:23; gone a minute later), and its render-all arm reads +3…+6 ms (+20–35 %) over the calm 13-Oct
  baseline for the same frames (e.g. 0.3: 25.1 vs 18.6 ms at 0.75). The same-session relative result holds (cull
  −0.3…−3.7 ms vs render-all, never worse). capfit on these contended numbers says "floor"; NOT used: Medium C5 keeps
  NO cap (calm-baseline ratio and the battery-throttled S14 run both ≤ 16.2 ms at 0.85). Machine-state variance is
  what the runtime vsync guard is for. Fenced-ms caps from a shared, busy M1 are noisy: Budgets should re-run
  cscost / cullab in a quiet window (no Blender, no other agents' CPU jobs, lid open, AC).
- S20 03:5x ITEM 4, REAL TIME C2 → C2c → B05 after (final profile: caps + vsync guard + C5 cull; dist-perf2-a — C2 is
  identical in dist B; AC, no Blender during either run; console errors 0; rtsum.mjs on v8/c2-*-after.json):
  | tier | held | play:B03 (control) | C2 > 20 ms | C2c | B05 | C2 worst |
  |---|---|---|---|---|---|---|
  | **Medium** (03:22–03:36) | 0.80 (= gameplay; no Medium C2 cap) | 1 / 405 | **1 / 1738 = 0.06 %** (the cut frame) | 0 / 835 | 1 / 301 | 49.9 ms @ 0.07 |
  | Max (03:36–03:50) — INVALID, machine degraded | 0.85 (floor) | **22 / 382 = 5.8 %** | 296 / 1439 = 20.6 % | 11 / 822 | 34 / 268 = 12.7 % | 66.7 ms @ 0.1 |
  Medium meets the < 1 % target (the only C2 miss is the hard cut, below). The Max run is not a measurement of the
  code: its GAMEPLAY control segment (the B03 hall, no cutscene, no #150 code path) missed 5.8 % at 0.85–0.875 where
  every earlier Max run had 0 % (S11: 0 / 406 at 0.875–0.9), and B05 12.7 %; render JS per frame was 15–25 ms in B05
  (S11: 5–11). Swap was 3.2 / 4 GB used (5.5 M pageouts) on the 8 GB M1 — Max's larger working set pages, Medium's
  did not; the Max floor (0.85) leaves the guard nothing to step. RULE (corrected S23, advisor): a real-time run is INVALID (machine state)
  when its gameplay segments are worse than the same staging's baseline across the board — for c2rt the S3 / S11 runs
  (Max B03 0 / 406, B05 0–3 / ~300, C2c 0–1 / ~835; this run: 22 / 382, 34 / 268, 11 / 822); for the whole route the
  pre-#150 rtplay table (scratch/smooth-perf/v3/rt-full-{med,max}.json: Max gameplay legitimately misses there — B06
  16 %, B08 17 %, B11 22 % at its floor), not a flat 1 %. q11 restarted with a CALM gate before each real-time step
  (AC, no Blender running, last Blender job ended ≥ 5 min ago, 1-min load < 3) and the Max C2 re-run first.
  The C2 cut frame (Medium 49.9 ms; S11 Max 49.9 ms): the frame before it created a shadow-pass pipeline
  (renderPipeline_ShadowMaterial_1550) and a scene-scale mip texture (1024×640 rgba16float, 11 mips = 1280 × 0.8 — so
  NOT a scale change: created fresh at the cut) → c2start.mjs (q11) names the objects.
- S21 04:3x ITEM 4 hero stills, MEDIUM (frozen.mjs, stepped C2 / C2c, the same N-frame render; BEFORE =
  v4p/plain-medium (13 Oct: plain light list = the pre-#150 shading, #143 profile, scale 0.80); AFTER =
  v8/after-medium (dist-perf2-a: pool + gates, caps, C5 cull; scale 0.80 = the real-route Medium hold); AC; console
  errors 0). SSIM after vs before: C2 3.0 0.9985 · 7.4 (strike) 0.9966 · 9.3 (head on the floor) 0.9890 · 13.9 (eye)
  0.9881 · 19 0.9927 · 25 0.9968 — inside the S10 cross-session noise floor (0.9862–0.9987); composite
  v8/cmp-medium-t9_3.jpg (before | after | diff ×12): face, floor, blood pool and the candle glint in the eye match;
  the diff is only the hair-card hash speckle + the animated blood drip (S9 / S10's noise sources). C2c 3 0.8933 /
  C2c 8 0.9849: no figure in frame, culled before #150 too, same scale → not this lane; composite v8/cmp-medium-t103.jpg
  shows the same camera / torch pool with a GLOBALLY darker wall = the exposure / look pass of the FLASH lane since
  13 Oct (exposure.ts, look.ts constants, arms) — reported, not attributed to #150. Fenced ms in this run (AFTER,
  0.80): C2 3.0 13.6 · 7.4 14.8 … (v8/after-medium.json).
- S22 04:4x ITEM 4 hero stills, MAX (BEFORE v4p/plain-max: plain list, #143 profile, 0.90 = the S11 real-route hold;
  AFTER v8/after-max: pool + gates + caps, 0.875 = Max's C2 cap; AC, machine calm again — its fenced ms match S11's
  pool numbers; console errors 0):
  | C2 t | 3.0 | 7.4 strike | 9.3 head | 13.9 eye | 19 | 25 |
  |---|---|---|---|---|---|---|
  | fenced ms before (0.90, plain) | 20.7 | 24.7 | 20.4 | 21.0 | 18.3 | 19.6 |
  | fenced ms after (0.875, pool) | 15.0 | 18.0 | 15.1 | 12.1 | 11.5 | 15.9 |
  | SSIM after vs before | 0.9966 | 0.9957 | 0.9822 | 0.9948 | 0.9959 | 0.9979 |
  (C2c 3 / 8: 0.980 / 0.976 — the FLASH look pass, see S21.) 100 % crop of 9.3 (v8/cmp-max-t9_3-crop.jpg, before |
  after | diff ×12): face, hair, boards, blood identical to the eye — the 0.90 → 0.875 cap is not visible; the diff
  is hair-hash speckle and the animated blood edge.
- S23 04:5x advisor review → (1) q11's calm gate gets a 60-min fallback (Blender rounds re-launch whenever the lock is
  free; after 60 min: AC + no Blender running at the start, validity by the post-run baseline comparison); (2) the
  C5 hand-off pop is VERIFIED in code, not assumed: bindings.ts camera.release() restores level.setCulling(true) when
  a cutscene hands the camera back, and C5 ends with a `player` cue at C5_END_EYE on the same view → the shipped
  render-all C5's last frame showed EXT1's trees through the front door, the first gameplay frame culled them;
  (3) rtplay is the arbiter for Medium C5 "no cap" and Max C5 0.9: if a C5 segment misses > 1 % on a run whose
  gameplay segments match the v3 baseline, the cap gets revised before the gates; guard steps that do not lower the
  next window's miss rate are the CPU-bound evidence for the handoff.
- S24 10-19 06:5x RESTARTED agent. HEAD is now d7022c7 ("Ship 2") = the #150 char-light pool / gates + the S1
  profile code; still UNCOMMITTED from this lane: the CUTSCENE_CAP table, C5 culling, S13's boneSphere buffer, the
  csCull hook, perf-cs-cap tests +2. Only the asset manifests changed since dist B (03:07; generatedAt only). q11
  died after its first step. ITEM 4 MAX REAL TIME AFTER (q11 c2-max-after, 05:57–06:01, AC 163 / 0 battery; ran
  right after a scare-look Blender round, but VALID: control B03 0 / 407; dist-perf2-b; v9/c2-max-after.json):
  | segment | frames | > 20 ms | worst | held scale |
  |---|---|---|---|---|
  | play:B03 (control) | 407 | 0 | 16.8 ms | 0.875–0.9 |
  | **C2** | 1736 | **2 = 0.12 %** | 66.7 ms @ 0.08 (the cut) + one 33.3 @ 9.03 | 0.875 (cap) |
  | C2c | 835 | 0 | 16.8 | 0.9 |
  | play:B05 | 302 | 0 | 16.8 | 0.925 |
  → target (< 1 %) met on Max too. Remaining C2 hitch = THE CUT FRAME (66.7 ms Max / 49.9 Medium): the frame before
  it created output / normal / velocity / depth targets at 1120×700 (= 1280 × 0.875: the gameplay 0.9 → cap 0.875
  scale change lands on the cut) + renderPipeline_ShadowMaterial + a 1120×700 rgba16float 11-mip texture. q12.sh
  (log v10/q12.log, calm-gated, dist B): c2start Max + Medium (names the objects) → rtplay Medium + Max (the caps
  across the whole route).
- S25 07:0x C2 ENTRY FRAME named (q12 c2start on dist B, AC, console errors 0; v10/c2start-{max,medium}.log). The
  entry is NOT a hard cut: shot 0 starts at the player's eye and moves on (a held frame there reads as a freeze).
  Created in the frame before the slow one, both tiers:
  (a) `P lamp_flag | ShadowMaterial | sync` — the ONLY pipeline: cutscene-fx's lamp flag (created hidden at load,
      DoubleSide, layer 8 only = the lamp cube's caster layer) is first drawn by C2's t = 0 `lampFlag {on}` cue; the
      tableau warm step never showed it → its DoubleSide shadow pipeline compiled synchronously in C2's first frame;
  (b) a scene-pass-sized rgba16float 11-mip texture = three's viewportOpaqueMipTexture (blood-fx stain / stream
      materials): re-sized on the stains' first draw at C2's scale (last drawn at the load warm-up's scale);
  (c) ONLY when gameplay scale > the cap (the q11 Max c2rt run: 0.9 → 0.875) the 4 MRT targets + TAAU previousDepth
      are re-allocated on the same frame. Entry dt: Max 33.4 (no resize) / 66.7 (resize, q11); Medium 33.4; S11 / S20
      49.9. The C2 → C2c (0.875 → 0.9) and C2c → B05 (→ 0.925) resizes cost no missed frame (light frames), so (c) is
      ≈ one extra vsync on a heavy entry frame. NOT changed (advisor): deferring the resize moves the same hitch into
      the moving shot; pre-sizing needs the next cutscene in advance.
  CODE (main.ts, owned): the tableau + tableau-hall warm steps now run with `story.fx.fx('lampFlag', {on: true})`
  (setLampFlag forces the lamp cube's six-face redraw; the flag is camera-invisible), off again before the candle
  shadow is muted. Typecheck clean. Verification: c2start on the new dist — the lamp_flag line must be gone and the
  entry dt must drop; whatever remains (the forced six-face cube redraw at t = 0, ruling (b) / the CINE lane's choice,
  + the first stain viewport copy) is a handoff number.
  q12 STOPPED after its c2start steps (rtplay on dist B would leave the gates on another tree than the handoff) →
  q13 on ONE new dist (scratch/dist-perf2-c): npm test → c2start Max + Medium (fix check) → rtplay Medium + Max (cap
  arbiter, S23) → strict gates Medium + Max → WGSL dumps. dist A deleted.
  INCIDENT (mine): stopping q12 I SIGTERM'd every `scripts/shot.mjs` process — the only one running was the FLASH
  lane's run T (scratch/flash-fixr3, still waiting for a Blender job); its driver restarted T 12 s later (runs.txt
  07:04:25 exit 130 → 07:04:37 start). Lost ≈ 3.5 min of its wait, no data. From now on only processes whose
  arguments contain scratch/perf2 or dist-perf2 are touched.
  07:2x dist C built (verify-boot OK, scratch/perf2/build-c.log; tree snapshot v11/dist-c-tree.txt); npm test 349 / 349;
  typecheck clean. q13 calm gate shortened to a 90 s Blender gap / 15 min fallback (JUMPSCARE rounds run back to
  back; assets.mjs never starts Blender while shot.mjs holds the Chrome lock, so no run overlaps Blender; validity =
  the post-run control-segment check, S20 / S23). Log v11/q13.log.
- S26 08:0x FIX CHECK (q13 c2start on dist C, AC, console errors 0; v11/c2start-{max,medium}.log): the lamp_flag
  ShadowMaterial pipeline is GONE on both tiers — NO pipeline is created in C2's first 3 s now; the only creation left
  is the stains' viewport mip texture re-size. BUT the entry frame did not get measurably shorter: Medium 33.4 → 33.4 ms,
  Max 33.4 → 50.1 ms (dist B → C, one sample each, inside the 33–67 ms run-to-run spread). The sync pipeline was not
  the entry cost. q14.sh (after q13, log v12/q14.log): scratch/perf2/c2entry.mjs — stepped approach into C2, every
  frame fenced + its WebGPU timestamps resolved → exact per-pass GPU ms of the entry frame vs C2 ≈ 3 s (expected:
  the six-face lamp cube redraw forced at t = 0 + the first frame of the parlor view) — a handoff number.
- S27 08:5x ITEM 4 FINAL — REAL TIME C2 → C2c → B05 on dist C (the final tree: pool + gates, caps, vsync guard, C5 cull,
  lamp-flag warm; c2rt staging = 6 s real-time hall walk; AC, no Blender during the runs (shot.mjs holds the Chrome
  lock); console errors 0; v11/c2rt-{max,medium}.json):
  | tier | control play:B03 | C2 > 20 ms | C2 entry frame | C2c | B05 | held C2 scale |
  |---|---|---|---|---|---|---|
  | **Max** (08:3x) | 1 / 406 (its first frame) | **1 / 1739 = 0.06 %** | 33.4 ms (incl. the 0.9 → 0.875 cap resize) | 0 / 835 | 0 / 302 | 0.875 |
  | **Medium** (08:4x) | 0 / 406 | **1 / 1739 = 0.06 %** | 33.4 ms (only creation: the stains' viewport mip texture) | 0 / 835 | 0 / 302 | 0.80 |
  Both valid (controls = the S3 / S11 baselines). The only C2 miss on either tier is the entry frame (one missed
  vsync). Same c2rt staging before: Max 66.7 (q11, dist B: resize + lamp_flag pipeline) + a 33.3 at 9.03; Medium 49.9
  (S20, dist A). The c2start staging showed no entry change (S26) — the entry varies by ± 1 vsync between runs; one
  sample per arm, so "the warm took the entry from 3–4 to 2 vsyncs" is suggestive, not proven. Baseline at the start
  of this round (S3, #143 profile): Medium 9.2 %, Max 11.1 % of C2 frames missed; the user's report era (v3): 21–23 %.
- S28 09:1x WHOLE ROUTE REAL TIME, MEDIUM, dist C (rtplay, 08:52–09:14, AC, console errors 0, reached B13 / the
  ending, 0 deaths; v11/rt-medium.json): TOTAL 42 / 31340 = 0.13 % frames > 20 ms (pre-#150 baseline
  smooth-perf/v3/rt-full-med: 2006 / 29351 = 6.83 %). Per cutscene (> 20 ms): C0 0 · C1 12 / 4474 (0.27 %) · **C2 0 /
  1740** (held 0.85 = gameplay; no Medium C2 cap) · C2c 0 · C3 0 · C4a 0 · C4 overlays 0 · C4c 0 / 660 · C5 3 / 2021
  (0.15 %, culled) · C5b 0 · C6 3 / 2020 (0.15 %, held 0.70 = cap) · C6b 3 / 774 (0.39 %) · C7 4 / 2092 (0.19 %, 0.675 =
  cap) · CR 0. Gameplay segments ≤ 0.41 % (baseline 0.66–4 %) → valid. Guard: C1 → 0.70 (35 % in the 1 s of the C1
  73.7 stall: futile — CPU-bound, see below), C6b → 0.675 (6 %). Every cutscene < 1 %; the cap table holds (no revision).
  REMAINING STALLS (> 40 ms; one-off, not load — next round): C1 73.66–74.15 eight 50 ms frames with render JS 36–42 ms,
  no builds / pipelines, then an 84 MB GC (render 214 ms) + a 216.7 ms frame; B05 gameplay 183 ms (dynres 0.85 → 0.8
  re-allocation + a 23 MB GC); C5 29.0 / 29.12 50 + 83 ms and C6b 2.77 83 ms = ASYNC pipelines (MeshBasic ×4,
  wood_furniture_dark, glass_grimy ×3; paint_road_yellow, water_ditch) = reflections.ts dawn re-capture precompile
  (the load prewarm covers the night state only) — the pre-#150 render-all baseline had the same C5 set at 29.0 /
  31.1 / 32.97 (50 / 100–133 / 100 ms): NOT caused by the C5 cull; C7 1.78 300 ms (3 node builds, 48 buffers, a SYNC
  ShadowMaterial pipeline). q15.sh (after q14; log v13/q15.log): cs-frames stepped to C5 28.6–29.4 / C6b 2.4–3.0 / C7
  1.3–2.2 with an XROW createRenderPipeline hook (object | parent | material | scene.name = "Shadow Map [light]" | A/S)
  → names them for the handoff (and a fix if it is a warm-up gap in this lane).
- S29 09:3x WHOLE ROUTE REAL TIME, MAX, dist C (rtplay 09:14–09:28, AC, console errors 0, reached B13, 0 deaths;
  v11/rt-max.json): TOTAL 1845 / 29450 = 6.26 % (baseline v3 rt-full-max 12.08 %). Gameplay B05 3.5 / B06 8.6 / B08
  11.5 / B11 8.1 % (baseline 5.8 / 16.1 / 17.3 / 22.3) → valid. Per cutscene (baseline in brackets): C0 0 (0.06) · C1
  4.5 (5.8) · **C2 13 / 1727 = 0.75 % (22.5)** — guard 0.875 → 0.85 at the strike (7 % in that 1 s) · C2c 0 (1.2) ·
  C3 13.3 (2.3: WORSE — at the 0.85 floor, no cap / no guard room; not attributed, one run: C3 sits between B06 / B08,
  which miss 8–11 % themselves) · C4a 0 (1.3) · C4c 24.5 (62.2) · C5 12.0 (35.3) · C5b 0 (5.4) · C6 18.5 (28.7) · C6b
  2.0 (9.1) · C7 9.3 (9.4) · CR 0.6 (0.07). At the Max floor (0.85 = Medium's best pixels) C3 / C4c / C5 / C6 / C7
  cannot hold 60 on this M1 — the ruling's floor stops the scale there; it is efficiency work (handoff).
  Max freezes ≥ 200 ms with NO GPU-object creation and low JS (C1 30.4 200 ms, C1 70.2 217, B05 183, C7 8.55 / 8.65
  433 / 400, CR 1.37 733) = GPU-side stalls with the machine swapping (3–4 GB swap used on the 8 GB M1) — the same class
  as the baseline's (C0 1050, C7 1917 ms): a memory-budget question for Budgets, not a per-frame cost. C7 4.57–4.93:
  six frames of 57–64 ms render JS (the car-POV sign shot over the C1 road set, render-all) then 348 ms render JS with
  an 88 MB heap drop, then the guard's 0.9 → 0.85 resize (350 ms).
- S30 09:4x GATES on dist C: strict Medium — ended=true beat=B13 game 527.6 s, deaths 0, console errors 0, exceptions
  0, hero shots v11/gate-medium/gate-01…09 (C2 parlor frame checked: figures lit, nothing missing); strict Max — ended=
  true beat=B13 game 712.9 s, deaths 0, console errors 0, exceptions 0 (v11/gate-max/). C2b not triggered by the bot
  (optional), C4a / C5b played on both.
- S31 10:4x C2 ENTRY, per frame (q14 c2entry.mjs, Max, dist C, stepped 1/60 + fenced, ?gputime; console errors 0;
  v12/c2entry-max.log): per-pass WebGPU timestamps are NOT usable on this M1 — within one frame they sum to 150–250 ms
  while the fenced frame is 25–30 ms (Apple TBDR passes overlap; a pass's begin→end span includes the others) →
  only the fenced numbers are evidence. JS / fenced (JS + GPU, serialized): gameplay at the threshold 9–11 / 25–27 ms;
  the ENTRY frame (C2 0.017) 27.5 / 52.2; C2 0.033–0.22 11–16 / 28–35; steady C2 3.05 7–9.5 / 23–25. The entry costs
  ≈ +16 ms JS (C2's t = 0 cue burst: torch fade, roaming lamp + cast_shadow + lamp flag six-face redraw request,
  blood start, figures placed + clips, DOF + blur chain switch, culling) + ≈ +9 ms GPU (the six-face lamp cube) → in
  real time one missed vsync (S27). Next step for whoever takes it: a CPU profile of that one frame (cpuprofile around
  the trigger) to split the +16 ms JS between the cue handlers → c2cues.mjs (q17: per-cue timing, instance override of
  CutscenePlayer.onCue + player.update / updateCharLights / pipeline.render).
  Medium (v12/c2entry-medium.log, console errors 0): gameplay 8–11.5 / 22–25 ms; ENTRY 25.8 / 43.0; C2 0.033–0.083
  10.4–12.2 / 26–27.6 → the same +15 ms JS, only ≈ +2–5 ms GPU: the entry is mostly the t = 0 JS burst.
- S32 11:2x NAMED (q15 cs-frames stepped to C5 / C6b / C7 with an XROW createRenderPipeline hook, Medium, dist C,
  console errors 0; v13/cap/{C5-0,C6b-1,C7-2}/rows.json, row.x = object | parent | material | scene.name | A/S):
  · C7 1.633 / 1.700 SYNC: sedan_interior001_1 and sedan_interiorvisor_p (P_CAR_INTERIOR) | ShadowMaterial | "Shadow
    Map [ runtime_L_HEADLIGHT_L ]" — C7 switches the headlights on at t = 0; their first map frames after the fade-in
    draw the maroon-trim cabin clones; the C7 warm poses ran with the headlights off.
  · C5 28.933 ASYNC: ma-mist-0…3 (MeshBasic), door_D_CLOSET_2 (wood_furniture_dark), G1 / G3 / U1 window panes
    (glass_grimy) = the dawn re-capture's precompileJob (cube context). C5 29.067 SYNC: ma-mist-0…3 ×2 each — three r186
    compileAsync builds no two-pass (back / front) variant of a transparent DoubleSide material, the face renders do.
    C5 29.233 SYNC: the 3 panes again — right after the cube swap into the hooked materials; cause NOT known → handoff.
  · C6b 2.667 ASYNC: rc9_paint (paint_road_yellow), rc9_road001_2 (water_ditch) — the night re-capture, content state.
  CODE (main.ts, owned): (1) the C7 cs-shots warm runs the headlamp shadow passes (L_HEADLIGHT_L / R: intensity > 0 +
  autoUpdate while its poses render; intensity / autoUpdate restored exactly, csBase untouched; lights are never
  hidden after load, so intensity alone gates their maps); (2) the reflections spare-cube prewarm also shows the
  CS_PREWARM meshes (ma-fx root = level.root = the capture's keep → drawn; frustumCulled false → every face) so the
  mist cards' cube-context back / front pipelines exist before C5. Typecheck clean. dist B deleted.
  PLAN / REVERT RULE (advisor): dist D = this tree → c7probe on D: C7 1.63 / 1.70 S lines and EVERY C5 ma-mist S line
  must be gone (a miss → revert that edit, one iteration) → c2rt Max + Medium → rtplay Medium + Max → strict gates
  Medium + Max. If D does not pass the gates, main.ts goes back to the dist-C edit set (lamp-flag warm + csCull) —
  gates are only ever reported for the tree they ran on. Dist C kept until D is verified.
  11:3x dist D built (verify-boot OK, scratch/perf2/build-d.log, tree v16/dist-d-tree.txt). npm test on the D tree:
  348 / 349 — the 1 failure is tests/arms-pullback.test.ts "walking at a wall the pool stays on the gaze point" (pool
  strays 3.2 cm), i.e. the FLASH lane's in-flight edits of src/render/flashlight.ts + flashlight-bounce.ts (09:35, after
  dist C, whose tree passed 349 / 349); the test does not import main.ts (my only change since C) → For LEAD / FLASH.
  Queues: q16 (WGSL dumps, fixed progdump) → q18 (c7probe on D, v16/) → q17 (c2cues on C, analysis).
- S33 10-19 11:5x RESTARTED agent (queues q16 / q18 / q17 all finished 11:07–11:49, AC 228 / 0 battery samples; the
  previous agent stopped after q17). src tree = dist D (no src file modified after the 11:13 snapshot).
  · q18 c7probe on DIST D (cs-frames + XROW, Medium, full route, console errors 0; v16/c7probe-medium.log,
    v16/cap/{C5-0,C6b-1,C7-2}/rows.json): C5 — every SYNC line is GONE (S32: 29.067 ma-mist-0…3 ×2, 29.233 the 3
    window panes); only the 28.933 ASYNC precompile row remains (the dawn re-capture's compileAsync). The mist
    prewarm works; the pane rebuild's absence is one sample. C6b 2.667 ASYNC rc9_paint / rc9_road001_2 (unchanged,
    content state). C7 — the 1.633 / 1.700 SYNC lines are STILL THERE (sedan_interior001_1, sedan_interiorvisor_p |
    ShadowMaterial | "Shadow Map [ runtime_L_HEADLIGHT_L ]"): the S32 headlamp warm MISSED. Cause (code + rows):
    L_HEADLIGHT_L follows P_CAR_GATE (lights.ts followers, placed in RuntimeLights.update() = world(), which the
    warm never runs) → during the warm the lamp stands at the yard gate (PLAN 0.37, −30.78, aimed −x, far 180 m) and
    the static CAR set (P_CAR_INTERIOR, PLAN 100.8, 1.4) is ≈ 100 m behind it: the pass ran with no cabin in its
    frustum. In C7 the `vehicle` track drives the gate along the road; draws ramp 147 → 150 → 158 → 190 → 220 at
    1.600–1.733 = the set entering the moving cone. The pass was on from t = 0; what changes at 1.6 is the frustum.
  · q17 c2cues on DIST C (per-cue timing of C2's entry frame, stepped; v15/c2cues-{max,medium}.log): entry frame JS
    Max 27.1 ms (pre-entry 13.6–13.8) = pipeline.render 12.1 (NOT elevated: 12.4–12.6 before) + the 22 cues ≈ 5.0
    (voice 2.2 · clip:ada 0.5 · clip:arms 0.4 · fx:exposure 0.3 · …) + player.update 0.3 → ≈ 8 ms OUTSIDE the
    wrapped handlers; Medium 21.7 (pre 8.7–9.8) = render 10.5 + cues ≈ 5.2 (clip:ada 1.9 · voice 1.5 · …) + 0.2 →
    ≈ 5–6 ms outside. Steady C2 3.0: Max JS 14.5 (render 13.2), Medium 11.5 (render 10.6). Next: a CPU profile of the
    entry frame (qa.cdp Profiler) names the unwrapped part (the director / host start path, timeline build, ...).
  · q16 WGSL dumps (dist C, gated vs ?charlights=0 plain; v14/wgsl-{gated,plain}/, 13 programs each, console errors
    0): gated 49–76 KB vs plain 130–288 KB per program. gateab's analyzeWgsl over both sets: EVERY gated program has
    exactly 2 flags, both `nodeVarX = mix(1.0, nodeVarS, shadowIntensity)` in the else-branch of the torch cookie
    spot's `inSpotLightMap.select()` (`shadowPositionWorld = v_positionWorld;` then the mix of a shadow value that only
    the if-branch assigns). The PLAIN program emits the IDENTICAL else-branch (harlan_body plain l.1673–1675, ada_skin
    plain flagged the same pair) → three r186's own codegen of the cookie spot, present before #150; not a gate
    artifact. Handoff item 7 CLOSED. (The plain programs carry 11 further flags each — normalWorld first assigned
    inside a branch, three's lazy var placement; the gated programs don't have them because setupLights stacks
    normalWorld before the first branch, S6.)
  PLAN: (1) C7 fix, one iteration (advisor): `frustumCulled = false` on every castShadow mesh under P_CAR_INTERIOR
  during the C7 warm (restored after) — the shadow pass submits `!frustumCulled || intersects`, so the clones draw
  into the lamp map wherever the gate is; revert the whole C7 lamp block if the probe still shows the S lines.
  (2) WGSL analysis offline. (3) CPU profile of C2's entry frame (timeboxed; fix only if in this lane and trivially
  safe). (4) dist E = final tree → probe C7 → rtplay Medium + Max → strict gates Medium + Max. Dist C kept until E's
  gates pass; D deleted once E is built.
- S34 12:0x–12:3x CODE (main.ts, owned): the C7 cs-shots warm sets `frustumCulled = false` on every castShadow mesh
  under P_CAR_INTERIOR while the headlamp passes run (restored after the poses) — the comment block names why the S32
  version missed. Typecheck clean; npm test 349 / 349 on this tree (the S32 arms-pullback failure does not reproduce
  now — FLASH's test, flaky or fixed there; reported, not mine). Dist scratch/dist-perf2-e built 12:0x (verify-boot OK,
  build-e.log, tree dist-e-tree.txt); dist D deleted. q19 (log v17/q19.log; AC, calm gate waited out JUMPSCARE r37).
  C7 FIX CHECK (cs-frames + XROW, Medium, dist E, spawn --beat B12 → C6 → C6b → C7; console errors 0;
  v17/c7late-medium.log, v17/cap/C7-0/rows.json): C7 1.0–2.5 — the same draw ramp at 1.6 (144 → 147 → 156 → 188 →
  217: the cabin entering the moving cone) and ZERO pipeline creations (dist D, same window: 2 SYNC ShadowMaterial
  pipelines at 1.633 / 1.700). Late spawn = load warm + B12 only; the full route can only hold more pipelines. The
  real-time stall at C7 1.78 (S28: 300 ms Medium) is re-measured by q20's rtplay. Advisor note kept for the lead: the
  3–4 node builds + 48–67 buffers of that stall come from cutscene-fx setTrim('maroon') cloning NEW materials on every
  call (trimSaved deletes them on 'tan') — not this lane (src/world/cutscene-fx.ts) → request.
- S35 12:3x C2 ENTRY FRAME, CPU PROFILE (scratch/perf2/c2prof.mjs: c2cues staging, every approach frame one advance(1,
  1/60) inside Profiler.start/stop at 50 µs; profsum.mjs maps the samples through dist E's source maps; dist E, AC,
  console errors 0; v17/prof-{max,medium}/*.cpuprofile, v17/c2prof-*.log). Profiled JS (the profiler inflates Max ≈ 2×:
  entry 55.4 vs 27.1 unprofiled; Medium ≈ 1.1×): Max pre 17–22 → ENTRY 55.4 → 46.4 → 35.9 → steady C2 3.0 10.1 ms;
  Medium pre 8–10 → ENTRY 23.6 → 13.8 → 11.2 → steady 10.9. Where the entry's extra JS goes (inclusive Δ vs pre1):
  | | Max (profiled) | Medium |
  |---|---|---|
  | world update (main.ts update) | +23.5 | +10.0 |
  | · director.apply → story-runtime.playCutscene → host.play | 14.9 | 7.4 |
  | · · sequencer.update → the 22 t = 0 cues (host.cue / onCue) | 10.1 / 8.2 | 5.0 / 4.0 |
  | · · · voice.start (subtitles DOM 3.2 Max; voice-timing fallbackTiming 1.9 / 1.7) | 5.7 | 3.0 |
  | · · · characters bank.play (clips) / cutscene-fx | 1.9 / 1.4 | — |
  | · · timeline factory (c2-room.ts) + catmull-Rom path setup | ≈ 2.3 | ≈ 1.3 |
  | pipeline.render | +5.7 | +3.2 |
  | · torch caster cull (view-caster-cull updateShadow) / lamp cube six-face redraw (lights.ts renderShadow) | +3.8 / 2.9 | +1.6 / 1.4 |
  | garbage collector (self) | 4.2 | — |
  The 2nd–3rd frames (Max post0 / post1) are RENDER-heavy instead (+14.5 profiled: uniform-buffer updateByType,
  first `get buffer`, _renderObjectDirect, the lamp cube again 3.0) = the first draws of the C2 view's render objects.
  VERDICT: none of the entry burst is in this lane — the cutscene start path (src/cutscenes host / sequencer / c2-room),
  voice + subtitles (src/audio, src/ui: lane C), world/lights.ts (the lamp cube redraw is content: C2's shadow). No
  code change here (advisor: one missed vsync on the entry is at the floor of what is perceptible; the reported 9–23 %
  judder is gone). Requests for the lead (below): voice timing / subtitle DOM built ahead of the cue; the C2 timeline
  instantiated before the trigger (e.g. when the player enters G1's threshold volume).
- S36 12:5x WHOLE ROUTE REAL TIME, MEDIUM, DIST E (the final tree; q20 rtplay 12:40–12:50, AC 61 / 0 battery, no
  Blender during the run, console errors 0, reached B13 / the ending, 0 deaths; v18/rt-medium.json): TOTAL 76 / 34306
  = 0.22 % frames > 20 ms (dist C S28: 0.13 %; pre-#150 v3 baseline 6.83 %). Per cutscene (> 20 ms): C0 0 · C1 15 /
  4468 (0.34 %) · **C2 0 / 1740** (held 0.85) · C2c 1 / 832 (66.7 @ 8.37) · C3 0 · C4a 0 · C4 overlays 0 · C4c 0 · C5
  3 / 2022 (0.15 %) · C5b 0 · C6 2 / 2021 (0.10 %, 0.70 = cap) · C6b 3 / 774 (0.39 %) · **C7 2 / 2097 (0.10 %)** · CR 0.
  FIXED vs S28: the C7 1.78 300 ms stall is GONE (C7's worst is now its 66.7 ms entry frame at 0.07 = a fresh
  864×540 rgba16float target at the 0.675 cap scale); C5's SYNC mist frame at 29.07 gone (S28: 50 + 83 ms at
  29.0 / 29.12 → now ONE 83.4 ms frame at 29.07 whose previous frame created the ASYNC dawn-recapture pipelines
  wood_furniture_dark + glass_grimy ×3 — the precompile itself, handoff 4). Unchanged: C6b 2.77 83 ms (async road
  pipelines, content state), C1 73.5–74.0 CPU stretch (render JS 30–38 ms) + 250 ms frame, B05 166.7 ms (dynres
  re-allocation + GC), C1 13.77 233 ms (JS 1.2 / 6.4: GPU-side, one-off; not in S28).
  Gameplay: B02 0.08 · B05 0.41 · B06 0 · B08 **2.47 %** (37 / 1497) · B09–B12 ≤ 0.02 %. The B08 misses are 33 ms
  frames at 236.3–243.3 s in U2 with WORLD-UPDATE JS 18–24 ms (render 4 ms) — dist C (S28) shows the SAME class at
  the same place (3 frames, update 18 ms, 236.6–237.1): a pre-existing CPU stretch at B08's start sitting on the
  vsync edge, more frames tipped over this run. This round's E-vs-C changes are load-time warm-ups only (they cannot
  run in the update); E also carries the FLASH lane's flashlight / bounce edits made after dist C (09:35). Owner: AI /
  story / the bot (the update path) → handoff + For LEAD. Run valid (other gameplay segments match S28).
- Tools (scratch/perf2/): q1.sh … q8.sh (queues), capfit.mjs (caps from cscost rows), cullab.mjs (same-state cull A/B), c5rooms.ts (C5 room lookups, pure), rtsum.mjs (real-time JSON → missed-vsync per segment), lightab.mjs (char LightsNode subset A/B + plain-Standard A/B at frozen C2
  states, fenced gpuFrameMs, stills), cscost.mjs (cs-frames-style real-route wrapper: fenced gpuFrameMs per cutscene
  every 1.5 s of its clock at several scales — the cap measurement).

## Edits outside src/render (surgical, logged)
- src/game/story-runtime.ts: import CharacterLights/boneSphere; `charList` + `new CharacterLights(charList)` (or
  `lightsOf(charList)` with ?charlights=0) replaces the `charLights = lightsOf([...])` line (same lights, same order);
  `updateCharLights()` (subject spheres, every figure) after `characters.lightsNode = charLights`, exposed as
  `updateCharLights` (main.ts world() calls it last); `charLights: charRig` exposed for QA; `?charpool=0` read here.
- src/game/main.ts (owned): CutsceneProfile options + syncCutsceneHold (render() and advance()), guard wiring;
  `story.updateCharLights()` at the end of world().
- src/game/main.ts (owned, S12): `csCull: async () => (await import('../cutscenes/bindings.ts')).CS_CULL_IDS` in the
  debug expose (QA only).
- src/game/main.ts (owned, S25): the tableau / tableau-hall warm steps run with `story.fx.fx('lampFlag', {on: true})`,
  off again before the candle shadow is muted (C2's entry-frame shadow pipeline built at load).
- src/cutscenes/bindings.ts (owned: the CS_CULL_* arrays only, S12): CS_CULL_IDS + 'C5' and its comment block.

## For LEAD
- REQUEST (layout, lead-owned src/shared/level-layout.json): G1's visibleRooms lacks EXT1, so from the hall looking
  out the open front door the far yard trees (EXT1) are culled in gameplay (S17: the C5 end / hand-off view at
  C5_END_EYE). Either add EXT1 to G1's visibleRooms (more draws in the hall — measure) or accept; C5 now matches
  gameplay either way.
- FYI (not this lane): Max C3 regressed vs the pre-#150 baseline — 13.3 % vs 2.3 % of frames > 20 ms (S29), GPU-bound
  (render JS ≈ 6 ms), spread over the whole 12.5 s, same 0.85 hold as the baseline, Medium C3 0 / 750. C3 keeps the
  torch in hand at the U2 window: the FLASH lane's beam / look pass is the first suspect — an A/B there (beam off) would
  settle it. One run only.
- Commit state: HEAD d7022c7 ("Ship 2") carries the #150 light pool / gates + the S1 profile code; STILL UNCOMMITTED
  from this lane: cutscene-profile.ts CUTSCENE_CAP table, bindings.ts C5 cull, char-lights.ts boneSphere buffer,
  main.ts csCull hook + lamp-flag warm, tests/perf-cs-cap.test.ts +2, this file, contract row #150 additions. All
  verified on dist C (S25–S30). No commit / push by this lane.

## HANDOFF (Budgets agent) — final (S30+)
State of the tree (this lane's part; everything verified on scratch/dist-perf2-c = the tree at 07:2x, S25):
- src/render/char-lights.ts + char-light-select.ts: gated character light list + point / spot pools (S5–S11; in HEAD).
- src/render/cutscene-profile.ts: hold = max(floor, min(gameplay, CUTSCENE_CAP)) + missed-vsync guard (in HEAD) +
  the measured caps (uncommitted): Medium C6 0.7 / C6b 0.725 / C7 0.675; Max C2 0.875 / C4c 0.85 / C5 0.9 / C5b 0.95 /
  C6 0.85 / C6b 0.875 / C7 0.9 (whole route S28 / S29: no revision needed).
- src/cutscenes/bindings.ts: CS_CULL_IDS + 'C5'. src/game/main.ts: hold / guard wiring, updateCharLights last in
  world(), csCull QA hook, lamp-flag warm. src/game/story-runtime.ts: surgical (above).
- tests/perf-char-lights.test.ts (3), tests/perf-cs-cap.test.ts (12). Contract row #150.
RESULTS (final tree): C2 real time 0.06 % missed vsync on Medium and Max (c2rt); whole route Medium 0.13 % total,
every cutscene < 0.4 %; Max 6.26 % total (baseline 12.1 %), C2 0.75 %. Strict gates both tiers: ending reached, 0
console errors.
Measurement tools (scratch/perf2/): cscost.mjs → capfit.mjs (caps); cullab.mjs (same-state cull A/B); rtsum.mjs
(real-time JSON → missed vsync per segment); frozen.mjs / gateab.mjs (frozen C2 states: ms + stills); c2start.mjs (GPU
objects created around C2's start); c2entry.mjs (per-pass GPU ms of C2's entry frame, stepped + fenced); progdump.mjs
(character WGSL); queues q10–q15 (AC / calm gating, power sampler, INVALID marking).
Open for Budgets / the next PERF round:
1. Max cutscenes that cannot hold 60 even at the 0.85 floor (S29, % frames > 20 ms): C4c 24.5, C6 18.5, C3 13.3 (see
   For LEAD), C5 12.0, C7 9.3. S12's fenced numbers say C4c 4.3 s, C5 0–15 s and C6 are CPU / draw-bound (flat in
   scale): draw and CPU work, not scale. The missed-vsync guard steps such stretches to the floor with no gain (the
   ruling's literal behaviour). Candidate: C6 exterior culling (CS_CULL_IDS + CS_CULL_EXT_IDS + 'C6'; PVS EXT1 / EXT2 /
   G1, flicker gating identical by construction) — needs a same-state still A/B (cullab.mjs) because rooms seen
   through the house windows would go.
2. Max freezes ≥ 200 ms with NO GPU-object creation and low JS (S29: C1 30.4 / 70.2, B05, C7 8.55 / 8.65, CR 1.37 up
   to 733 ms) while the 8 GB M1 swaps 3–4 GB — a memory budget question (Max's working set), as in the baseline.
3. C2's entry frame: one missed vsync (33.4 ms) on both tiers (S27); stepped + fenced (S31): +16 ms JS (the t = 0
   cue burst) + ≈ 9 ms GPU (six-face lamp cube) over the next frames. Per-pass timestamps are unusable on the M1
   (overlapping TBDR passes); a CPU profile of that one frame is the next step.
4. Reflection dawn / night re-capture (reflections.ts, sky tint crossing 0.6 / 0.2: C5 ≈ 26.6 s, C6b ≈ 2.8 s): the
   precompile builds content-state pipelines asynchronously (C5 29.0 / 29.12 50 + 83 ms Medium, 100 Max; C6b 2.77
   83 ms) — wood_furniture_dark, glass_grimy ×3, MeshBasic ×4 / paint_road_yellow, water_ditch — objects the load-time
   (night, pre-C5 state) capture never saw; then 6 one-face frames. Not caused by the C5 cull (baseline had them).
   Named in S32: the mist cards' two-pass variants (compileAsync builds none) → load prewarm (S32, if D verifies);
   the 3 window panes rebuilt SYNC right after the cube swap (C5 29.23) — cause unknown, the next thing to chase
   (does swapping texNode.value to the alt cube change the program key?); C6b's road materials = content state.
5. C7 1.78 (Medium 300 ms, Max 217 ms): a SYNC ShadowMaterial pipeline + 3–4 node builds + 48–67 buffers right after
   the fade-in. NAMED (S32): the maroon cabin clones drawn into runtime_L_HEADLIGHT_L's map for the first time →
   C7 warm runs the headlamp passes (S32; verified on D or reverted).
6. CPU render stretches: Medium C1 73.7–74.2 (8 frames of 36–42 ms render JS, then an 84 MB GC frame, 214 + 217 ms) and
   Max C7 4.57–4.93 (car-POV sign shot over the render-all C1 road set: 57–64 ms render JS × 6, then 348 ms + an 88 MB
   heap drop). Draw submission + a GC — culling / instancing work.
7. WGSL flag (S7): (q13 wgsl dumps pending).
