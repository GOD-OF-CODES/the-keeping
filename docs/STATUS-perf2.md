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
   load; what remains is NAMED by a CPU profile (S35): the cutscene start path (other lanes' files) → For LEAD.
5. Gate — DONE on dist C (S30: Medium + Max strict, ended B13, 0 deaths, 0 console errors). FINAL TREE = dist E (S34:
   dist C + the mist prewarm + the C7 headlamp / cabin warm + FLASH's later edits): typecheck clean, npm test 349 / 349,
   vite build + verify-boot OK, Medium whole route real time (S36: 0.22 %, C2 0 / 1740, the C7 1.78 stall gone),
   strict gates Medium (S38) AND Max (S39): both ended B13 (C7 → title), 0 deaths, 0 console errors, 0 exceptions.
   Still open on E: c2rt (q20; C2's code is unchanged since dist C) and a VALID Max whole route (S37: attempt 1 INVALID
   for machine state, attempt 2 died in the harness; q21 re-runs it).

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
- S37 13:2x WHOLE ROUTE REAL TIME, MAX, DIST E, attempt 1 (12:50–13:23; shot.mjs first waited out a JUMPSCARE Blender
  render that started after the calm gate; AC 196 / 0; console errors 0; reached B13 with 1 death → the playthrough's
  "never caught" assert → rc 1 → q20 retries; data kept as v18/rt-max.attempt1.json): TOTAL 4500 / 28877 = 15.6 %
  (dist C S29: 6.26 %) — INVALID by the S20 / S23 rule: the GAMEPLAY segments are worse across the board (B06 18.8 vs
  8.6 %, B09 12.4 vs 3.8, B11 34.7 vs 8.1, B12 16.8 vs 0, B05 3.5 vs 3.5), i.e. the machine, not a cutscene path
  (swap 3.1 / 4 GB used, 80 MB free pages right after). Not used for any claim. One lesson from it for the handoff:
  its worst C2 frame (8.85, 466 ms) is the vsync guard's 0.875 → 0.85 step re-allocating the scene targets (a new
  1088×680 rgba16float mip texture) under swap pressure; S29 took the same step with no stall. Every scale step
  (gameplay dynres too: B05 166–183 ms on both tiers in every run) re-allocates — a sub-viewport render into
  max-size targets would remove that class (pipeline / dynres work → handoff).
  Attempt 2 (13:38, calm FALLBACK at load 7: JUMPSCARE renders back to back) died in the harness ("timed out after
  60 s waiting for document.readyState") — no data. q21 (v19/q21.log) re-runs Max real time after q20 with a 60-min
  calm fallback and keeps each attempt's JSON.
- S38 14:2x GATE MEDIUM on DIST E (the final tree; QA_STRICT=1 playthrough, 14:08–14:24, AC; v18/gate-medium/):
  ended=true beat=B13 (C7 → title), game 526.7 s, deaths 0, console errors 0, exceptions 0; C4a / C5b played, C2b not
  triggered (optional). gate-03 (C2 parlor): Harlan, Ada and the table candle present and candle-lit; gate-09 the
  title card. npm test on the same tree 349 / 349 (q20 12:38).
- S39 15:2x GATE MAX on DIST E (QA_STRICT=1, queued 14:24 behind a JUMPSCARE render + the lead's ship3 gates, ran ≈
  15:10–15:19; v18/gate-max.attempt1.log, v18/gate-max/): ended=true beat=B13 (C7 → title), game 582.4 s, deaths 0,
  console errors 0, exceptions 0; C4a / C5b played. q20 marked it "INVALID (battery)" because its power window
  (14:24–15:19, mostly queue wait) holds 13 battery samples (13:23–13:24 before it, 14:44 while queued) — the run
  itself is stepped (not timing-sensitive), so the functional gate result stands. Its automatic re-run (attempt 2) I
  stopped after 28 s in the Chrome queue (my own shot.mjs, SIGTERM; nothing else touched) so the lead's queued ship3
  gate goes first. GATES ON THE FINAL TREE: Medium + Max strict PASS.
- S40 15:3x HOUSEKEEPING: dist C deleted (E's gates passed). scratch/dist-perf2-e (196 MB; disk 14 GiB free) is KEPT
  for the still-queued runs: q20 c2rt Max + Medium (v18/c2rt-{max,medium}.json, CALM-gated) and q21 (after q20) the Max
  whole route in a calm window (v19/rt-max.json, per-attempt copies v19/rt-max.attemptN.json; log v19/q21.log).
  How to read them: `node scratch/perf2/rtsum.mjs <json>`; a Max whole route is VALID only if its gameplay segments
  match S29 (dist C: B05 3.5 · B06 8.6 · B08 11.5 · B09 3.8 · B11 8.1 · B12 0 %), else machine state. Whoever reads
  them last deletes scratch/dist-perf2-e. No efficiency change of this restart alters a runtime pixel: the mist
  prewarm and the C7 cabin / headlamp warm are load-time draws into the spare reflection cube and the headlamp map
  (camera-invisible, restored before play), the WGSL / profile work changed no code.
- S41 16:3x c2rt MAX on DIST E (q20, 16:16–16:31, calm FALLBACK at load 4.3–6.6: JUMPSCARE Cycles rounds back to back;
  AC 88 / 0; console errors 0; v18/c2rt-max.json) — INVALID (machine state): its gameplay CONTROL play:B03 missed 23 /
  382 = 6.0 % (render JS 11–13 ms, update 1.5 ms: GPU / system contention), where every valid c2rt staging run had 0–1 /
  406 (S11, S24, S27); C2 266 / 1473 = 18 % at the 0.85 floor (the hall had already pushed gameplay dynres to the
  floor), C2c 0 / 835, B05 8.2 %. A Blender render (1.2 GB RSS, 205 % CPU) started 27 s after it; swap 3.7 / 5 GB used.
  Not used for any claim; dist C's valid c2rt (S27: Max 1 / 1739, Medium 1 / 1739 = the entry frame only) stands for
  C2, whose code is unchanged in E (E's additions are load-time warm-ups for C5 / C7). Still queued (AC + calm gated,
  own Chrome tickets, dist E kept per S40): q20 c2rt Medium, then q21 the Max whole route. This agent ends here; the
  next agent of this round (#150b) reads v18/c2rt-medium.json and v19/rt-max*.json with rtsum.mjs and the validity
  rules above, then deletes scratch/dist-perf2-e.
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
- src/game/main.ts (owned, S32): the reflections spare-cube prewarm also shows the CS_PREWARM meshes (restored after:
  only those that were hidden); the C7 cs-shots warm runs the headlamp shadow passes (intensity / autoUpdate forced,
  restored exactly).
- src/game/main.ts (owned, S34): the C7 cs-shots warm sets frustumCulled = false on every castShadow mesh under
  P_CAR_INTERIOR while those passes run (restored after the poses).
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
- (DONE by the Budgets lane, B2 / B8: setTrim's maroon clone is cached per mesh; C7's first 1.5 s builds nothing.)
  Was: setTrim('maroon') cloned NEW materials on every call (trimSaved forgot them on 'tan').
- BUDGETS (#150b) REQUESTS, 2026-10-19 B10:
  · REQUEST (layout / props, not this lane): P_BED is a `collider: mesh` prop — its exact quilt triangles go to the
    collision BVH, so a player (or the bot) standing against the bed in U2 runs 11–12 capsule queries per frame at
    830–900 candidate triangles each: 5.4–8.2 ms of update JS per frame in B06 / B08 (max 20–32 ms, b8 / b11 combo).
    Give it a `-collider` proxy or a `box` collider (blender/props + layout). The exact triangle-box prefilter saved
    nothing there (the candidates do overlap the capsule) and was reverted.
  · KNOWN budget overruns left on the final tree (B10): C5's first seconds, C6 ≈ 656, C7 ≈ 513, C1 60.6 ≈ 508, B05
    ≈ 466–500 draws on Medium. The fix class is a sound cells-and-portals cull (WIP + its oracle test parked in
    scratch/perf2/portal-cull-wip/; unsound in the game: yard ground / terrain seen from the hall).
  · The Max exact A/B (combo, qb9) never ran: the kept culls are proven per pixel on Medium only. Both act per light /
    per figure (no preset branch), but Max has the lamp cube at a higher resolution and Max-only shadow maps.
  · Disk: 11 GiB free with dist K present (rule ≥ 12); other lanes' scratch/dist-fb, dist-fb-rel, dist-flash-reverify
    hold ≈ 540 MB. Dist K deleted at the end (13 GiB free).
  · NO VALID REAL-TIME NUMBER EXISTS FOR THE TREE AS IT STANDS: both whole-route runs on dist K were invalid (machine
    state, B11 / B12). Before anyone claims C2 / route smoothness on this tree, run the whole route on Medium + Max in
    a calm ≈ 45-min window with EVERY other lane's headless Chrome and Blender work paused (calmhold only held Blender).
  · The strict gates (B14 / B15) cover dist K (scratch/perf2/dist-k-tree.txt). JUMPSCARE's src/cutscenes/death.ts,
    src/world/jumpscare.ts, src/audio/synth/scare.ts + index.ts and three tests landed AFTER K — the final commit
    needs its own strict Medium + Max gates.
- REQUEST (C2 entry frame, S35 — lanes C / cutscenes): the entry frame's extra JS is the cutscene start path —
  host.play builds the C2 timeline and fires 22 t = 0 cues in one frame (Medium ≈ 7.4 ms; voice.start ≈ 3 ms of it:
  subtitle DOM + voice-timing fallbackTiming ≈ 1.7 ms). Candidates: precompute voice timing / build the subtitle
  node ahead of the cue (lane C); instantiate C2's timeline before the trigger fires (cutscenes / story). It is one
  missed vsync on both tiers; not a judder source.
- FYI (B08 gameplay, S36): a pre-existing world-UPDATE CPU stretch in U2 at B08's start (236–243 s: update JS 18–24 ms
  per frame, render 4 ms) sits on the vsync edge — 3 frames over 20 ms on dist C, 37 (2.47 %) on dist E. The update
  path (AI / story / the bot's own per-frame work) is not this lane; a CPU profile of that window names it.
- Commit state: HEAD d7022c7 ("Ship 2") carries the #150 light pool / gates + the S1 profile code; STILL UNCOMMITTED
  from this lane: cutscene-profile.ts CUTSCENE_CAP table, bindings.ts C5 cull, char-lights.ts boneSphere buffer,
  main.ts csCull hook + lamp-flag warm + mist prewarm + C7 headlamp / cabin warm, tests/perf-cs-cap.test.ts +2, this
  file, contract row #150 additions. Final tree = dist E (S34; verification S36+). No commit / push by this lane.

## HANDOFF (Budgets agent) — final (S33+; final tree = scratch/dist-perf2-e, tree snapshot scratch/perf2/dist-e-tree.txt)
Which tree each number comes from: dist C (S25) = the tree before the S32 / S34 load warm-ups — c2rt, the Max
whole-route run and the strict gates S27–S30 ran on it; dist E (S34) = the FINAL tree (C + mist prewarm + C7
headlamp / cabin warm + the FLASH lane's flashlight / bounce edits since 09:35) — Medium whole route S36, C7 / C5
probes S33 / S34, npm test, typecheck; its strict gates + c2rt + a calm Max whole route are in q20 / q21 (status
lines S38+ below when they land).
State of the tree (this lane's part):
- src/render/char-lights.ts + char-light-select.ts: gated character light list + point / spot pools (S5–S11; in HEAD
  d7022c7) + the boneSphere buffer (S13, uncommitted).
- src/render/cutscene-profile.ts: hold = max(floor, min(gameplay, CUTSCENE_CAP)) + missed-vsync guard (in HEAD) + the
  measured caps (uncommitted): Medium C6 0.7 / C6b 0.725 / C7 0.675; Max C2 0.875 / C4c 0.85 / C5 0.9 / C5b 0.95 /
  C6 0.85 / C6b 0.875 / C7 0.9. Medium whole route on E (S36): every cutscene ≤ 0.39 % frames > 20 ms → no cap
  revision.
- src/cutscenes/bindings.ts: CS_CULL_IDS + 'C5'. src/game/main.ts: hold / guard wiring, updateCharLights last in
  world(), csCull QA hook, load warm-ups (lamp flag S25, mist cards S32, C7 headlamp + cabin S32 / S34).
  src/game/story-runtime.ts: surgical (above).
- tests/perf-char-lights.test.ts (3), tests/perf-cs-cap.test.ts (12). Contract row #150 (items 1–5).
RESULTS: C2 (the user's report) — real time C2 → C2c → B05 0.06 % missed vsync on Medium AND Max (dist C, S27; only
the entry frame); whole route C2 0 / 1740 on Medium (dist E, S36) and 0.75 % on Max (dist C, S29). Baseline at the
start of the round 9.2 / 11.1 % (S3), the user's report era 21–23 %. Medium whole route on E: 0.22 % total, every
cutscene ≤ 0.39 %. Max whole route (dist C): 6.26 % total (baseline 12.1 %); the dist-E Max run was INVALID
(machine, S37).
Measurement tools (scratch/perf2/): cscost.mjs → capfit.mjs (caps); cullab.mjs (same-state cull A/B; interior
cutscenes — an exterior one needs a csCull hook for CS_CULL_EXT_IDS too); rtsum.mjs (real-time JSON → missed vsync per
segment); frozen.mjs / gateab.mjs (frozen C2 states: ms + stills); c2start.mjs (GPU objects created around C2's
start); c2entry.mjs (stepped + fenced entry frames); c2cues.mjs (per-cue JS of the entry frame); c2prof.mjs +
profsum.mjs (V8 CPU profile of one stepped frame, mapped through the dist's source maps); c5rooms.ts (a cutscene's
camera room / PVS walk, pure Node: `node --experimental-strip-types scratch/perf2/c5rooms.ts C6 11.5,-5.5,1.65`);
progdump.mjs (character WGSL); queues q10–q21 (AC / calm gating, power sampler, INVALID marking, retries).
Open for Budgets / the next PERF round:
1. Max cutscenes that cannot hold 60 even at the 0.85 floor (dist C, S29, % frames > 20 ms): C4c 24.5, C6 18.5, C3
   13.3 (For LEAD), C5 12.0, C7 9.3. S12's fenced numbers say C4c 4.3 s, C5 0–15 s and C6 are CPU / draw-bound (flat
   in scale). The guard steps such stretches to the floor with no gain (the ruling's literal behaviour). C6 culling
   (CS_CULL_IDS + CS_CULL_EXT_IDS + 'C6'): c5rooms.ts says C6's cameras sit in EXT2 then EXT1 → PVS EXT1 / EXT2 / G1
   only, so the pump and mirror shots would lose every lit interior behind the house windows — expect a visible
   difference; a same-state still A/B decides.
2. Scale steps re-allocate the scene targets (MRT, TAAU history, the viewport mip texture): gameplay dynres (B05
   166–183 ms on both tiers, every run) and the cutscene guard (S37: 466 ms at C2 8.85 under swap). Rendering into
   max-size targets with a sub-viewport would remove the class; until then a guard step on Max is a freeze risk when
   the machine swaps.
3. Max freezes ≥ 200 ms with NO GPU-object creation and low JS (S29: C1 30.4 / 70.2, B05, C7 8.55 / 8.65, CR 1.37 up
   to 733 ms) while the 8 GB M1 swaps 3–4 GB — Max's memory working set.
4. C2's entry frame: one missed vsync on both tiers. NAMED (S35): the cutscene start path (host.play: timeline build +
   22 t = 0 cues, voice / subtitles ≈ 3 ms, Medium ≈ 7.4 ms of 13.3 ms extra JS) + the torch caster cull / lamp
   cube redraw (≈ 3 ms) + a GC; the 2nd–3rd frames are first draws of the C2 view's render objects. Not this lane's
   files → For LEAD requests.
5. Reflection dawn / night re-capture: on E the SYNC mist builds are gone (S33 / S36); left: C5 29.07 ONE 83 ms frame
   (Max ≈ 100) = the async precompile of wood_furniture_dark + glass_grimy ×3, and C6b 2.77 83 ms (paint_road_yellow,
   water_ditch) — content-state pipelines the night capture never saw. Candidate: prewarm the alt-cube capture with
   the dawn / road content state at load (reflections.ts).
6. CPU render stretches: Medium C1 73.5–74.0 (render JS 30–38 ms, then a 250 ms frame) and Max C7 4.57–4.93 (car-POV
   sign shot over the render-all C1 road set: 57–64 ms render JS × 6, then 348 ms + an 88 MB heap drop). Draw
   submission + a GC — culling / instancing work.
7. B08 gameplay world-update stretch (S36, For LEAD): update JS 18–24 ms per frame in U2 at 236–243 s.
DONE this round (closed): C7 1.78 stall (S34 / S36: gone on Medium); C5 mist SYNC builds (S33); WGSL flags (S33:
three's own cookie-spot codegen, present before #150).

## BUDGETS lane (#150b) — PERF round 2, agent 2 (Budgets + stall leftovers)
Started 2026-10-19 16:3x. Dist: scratch/dist-perf2-budgets (delete at the end). Scratch: scratch/perf2/b*/ (b1, b2, …).
Ownership as the Judder lane above, plus (assigned by task item 3, surgical, logged) src/world/cutscene-fx.ts setTrim.
Tree at start: HEAD b235f41 ("Ship 3") + the Judder lane's uncommitted edits (bindings.ts C5 cull, main.ts warm-ups +
hold wiring, char-lights.ts boneSphere buffer, cutscene-profile.ts caps, tests/perf-cs-cap.test.ts) + other lanes'
untracked src/world/jumpscare-math.ts / tests/jumpscare-decode.test.ts. NOTE for readers: the task's item-1 numbers
(C5 871 draws / 2.85 M Medium) are the PRE-#150 M-A audit (scratch/ma-perf/bud-med.log); C5 is ALREADY in CS_CULL_IDS
since S12 and sits at ≈ 455 / 1.55 M at C5 0–2 s and 10 s on Medium (S14 / S19) — item 1 = the remaining gap.
### Items
(Restarted agent, 21:5x, ruling (az) "finish tonight": B10 = the closing decision. Final tree = dist K.)
1. C5 to ≤ 400 / 1.5 M Medium, ≤ 500 / 2 M Max, ≥ 55 fps — NOT MET, logged as KNOWN (B10): the portal cull that was
   to close it is unsound in the game (B8–B9 / qb11) and is reverted; the proven shadow-pass culls remain. Measured
   on the final tree (B13): C5 Medium 415–448 draws / 1.45–1.47 M triangles at 0.3 / 2.3 / 10 s
2. Over-budget spots without visible change — PARTIAL, rest KNOWN (B10): torch caster cull (gameplay + C5) and the
   figure shadow cull ship (exact A/B 0 real differences); C6 / C7 / C1 60.6 exterior shots unchanged (needed the
   reverted portal / mirror cull)
3. Stall leftovers — PARTIAL: setTrim clone cache DONE (B8: C7's first 1.5 s builds nothing); B06 / B08 collision =
   P_BED's mesh collider → For LEAD (prefilter reverted, B8); the rest KNOWN, not chased (ruling (az))
4. Whole-route real-time table Medium + Max AFTER — NOT VALID: both runs on dist K ran (B11 / B12; tables in
   scratch/perf2/b12/rt-*-{sum,table}.md) but the machine was loaded (other lanes' Chrome runs, swap 4.5–7.4 GB) →
   INVALID by the control-segment rule; the hitch classes are named there for orientation only. Needs a calm window
5. Gate on dist K — typecheck clean, npm test 354 / 354, verify-boot OK (B10); strict Medium PASS (B14); strict Max:
   PASS (B15). Both: ended B13, 0 deaths, 0 console errors, 0 exceptions
### Log
- B0 16:3x START. Machine: AC, FINAL-BAKE's release chain holds Blender (bake_house LM_UPPER_ROOMS 2048, hold on
  scare-* until ≈ 18:15) → stepped runs only for now (draw counts are not timing-sensitive); real time later. Disk 13 GiB.
  STOPPED the Judder lane's q20 (it was waiting for c2rt Medium on dist E) and q21 (Max whole route on dist E) at 16:33:
  neither ran; the handoff's "read v18/c2rt-medium.json + v19/rt-max*.json" is MOOT — this lane's item 4 runs the
  whole-route tables on its own final tree. dist E deleted once dist F is built (disk).
- B1 16:4x–17:00 BUDGET AUDIT on dist F (= the tree at start; scratch/perf2/bud.mjs = csbud + per-beat gameplay keys +
  a PASS × SOURCE breakdown of every over-budget frame; stepped strict-route playthrough, exact draws / triangles of
  every render target per frame; console errors 0 on both; b1/bud-{medium,max}.json, `node scratch/perf2/budsum.mjs`):
  Medium (≤ 400 / 1.5 M) frames over budget: **play:B11 1682 / 1692 of 1960** (max 512 d / 1.90 M — gameplay in the
  hall / G3P while waiting for C5), **C5 248 / 477 of 1013** (503 d / 1.90 M at 0–2.5 s, over until 15.6 s), C4c 28 / 215
  (2.23 M @ 6.33), C6 92 (656 d @ 20.27), C7 151 (513 d @ 10.83–15.8), C1 51 (508 @ 63.23, 404–450 @ 59–60.6), B05
  39 / 9 (500 d @ 171.2, 1.93 M @ 213.2), B02 / B03 15–28 (G1 entry, 1.86 M), C2 8 (entry, 1.68 M), C2c 3 + 3 (1.567 M @
  3.73, 406 d @ 13.17), C4a 4 (407). Max (≤ 500 / 2 M): B11 98 (2.02 M), C5 55 / 99 (505 d / 2.02 M, 0–3.4 s), C6 88
  (660 d), C7 104 (514 d), C4c / B05 / B02 / C1 1–2 frames.
  WHERE THE DRAWS GO (Medium, worst frames): interior views (C5, B11, B03, C2, C4c) = main pass 250–290 d / 1.0 M
  (of it EXT2 seen from the hall: 59–123 d / 0.5–0.8 M) + the TORCH shadow map ("ID: 20" = flashlight.ts's unnamed
  SpotLight) 112–168 d / 0.43–0.5 M + the LAMP cube 44–106 d / 0.34–0.52 M — in the cube Ada alone is 10–36 d /
  167–518 k (every character mesh is frustumCulled = false → drawn into all six faces wherever she stands). Exterior
  render-all shots (C6 19.5–22.3, C7 10.8–15.8, C1 59–60.6): interior rooms drawn from the yard (G3 80, U2 60, G1 57,
  G2 52, U3 37, U1 35 d …). The task's "C5 871 / 2.85 M" is the pre-#150 number; C5's remaining cost is the same
  three passes as gameplay in the hall.
- B2 17:0x CODE (dist G = scratch/dist-perf2-budgets-g; typecheck clean, npm test 354 / 354, verify-boot OK; dist F
  deleted). Three exact (conservative) culls, each with a runtime A/B switch, all UNVERIFIED until the per-pixel A/B:
  (a) torch caster cull scope: + C5 (bindings.ts TORCH_CULL_IDS, now exported for `__game.torchCull()`) and GAMEPLAY
      frames (view-caster-cull.ts VIEW_CULL_SCOPE.play, set in main.ts world() when no cutscene / C4 overlay runs;
      `?torchcullplay=0`, `__vcMode = 'off'`) — the shadow-cone test of ruling (q), proven 0 px over C2c in fix round 3;
  (b) src/render/char-shadow-cull.ts NEW: while a shadow map renders, each figure's meshes get frustumCulled = true
      with the figure's #150 subject sphere (bones + 0.7–0.8 m) as bounding sphere (restored right after; the view pass
      is untouched) → three's own per-face / per-light frustum test skips faces that cannot hold the figure; installed
      after the load warm-up (main.ts); `?charshcull=0`, `__charShCull = false`, `__game.charShCull.audit()` (posed
      bounds inside the figure sphere); story-runtime.ts exposes `shadowFigures` (surgical, logged below);
  (c) src/world/window-cull.ts (surgical, logged below): an opening wholly outside one side plane of the VIEW frustum
      (pad 0.25 m) no longer keeps yard meshes alive (the side planes pass through the eye → nothing seen through it
      can be on screen); level.updateWindowCull gets the camera; `?wcullview=0`, `__wcullView = false`.
  Also (item 3) src/world/cutscene-fx.ts setTrim: the maroon clone cached per mesh (C7's t = 0 reuses the load
  warm-up's clones: no node builds / buffers) — logged below.
  Tools: scratch/perf2/abx.mjs (exact per-frame A/B over the stepped route, scratch/pgr4/ab-lib-t protocol: REF REF
  TEST REF REF plain renders into half-float targets, frozen node time, every shadow map forced to redraw; per-pixel
  luminance, real difference = effect > 0 big pixels while the REF / REF floor has 0), bprobe.mjs (frozen-state
  breakdown + stills per arm), cprobe.mjs (collision query cost per frame — item 3 B06 / B08).
- B3 17:1x CODE (d) the MIRROR window cull (src/world/window-cull.ts, surgical): an EXTERIOR eye (level room known and
  not interior, AND the eye outside the interior footprint + 0.45 m) parks interior-room meshes that no ray from the
  eye through one of the 8 openings can reach on WINDOW_CULL_LAYER (shadow maps that follow the view layers and the
  reflection captures still draw them); only meshes whose own world bounds lie inside the footprint of every floor
  they span (+ 0.15 m = inside the walls' outer faces) are ever culled; openings seen from their interior side admit
  nothing (skipped), an eye in an opening's plane disables the frame's cull; the lit torch is a second eye (its caster
  set follows the view layers, flashlight.ts F3) with every opening live. Works in gameplay (yard) and render-all
  shots (C6 19.5–22.3, C7 10.8–15.8, C1 59–60.6, where 330 of 620 view draws are interior rooms). `?wcullext=0`,
  `__wcullExt = false`. main.ts passes the camera + the lit torch's world position. tests/perf-window-cull.test.ts NEW
  (4): the front-door case, the porch case, and brute-force SOUNDNESS on the real layout — 300 random interior eyes /
  views × 30 yard meshes (6.5 k culled) and 300 random exterior eyes (+ torch) × 40 interior meshes (6.4 k culled):
  no culled point is on screen through an opening (view rule) / on any eye or torch ray through an opening (mirror
  rule). (A first version treated an opening seen from its interior side as degenerate → culled nothing; fixed.)
  Typecheck clean, npm test 358 / 358. Dist G rebuilt 17:1x (all of (a)–(d) + setTrim). Queues: qb2 (bud Medium on G
  → abx 'all' over B11 / C5 / B12 / C6 / C7), qb3 (cprobe B05–B09), qb4 (csprof Max C7 4.4–5.0; C7 start build probe
  Medium + Max — the setTrim check).
- B4 17:2x CODE (item 3, B06 / B08 update bursts; NOT in dist G): the v3 Max whole-run profile (smooth-perf
  v3/prof-ALL.cpuprofile, profwin2 over the B08 burst 238.0–239.6 s, U2) puts 371 of 464 ms of update JS in
  controller.step → collision.resolve / capsuleIntersect → Octree.triangleCapsuleIntersect (the player blocked
  against furniture: every 120 Hz substep runs the step-up trials + snapDown bisection = dozens of capsule queries).
  src/world/collision-bvh.ts (PERF-G-authored; surgical, logged below): a candidate whose triangle box misses the
  CURRENT capsule's box (axis bounds ± r + 0.1 mm) cannot intersect it (Octree's test only reports contacts on the
  axis or within r of it) → skipped before the exact test; the box is refreshed after each push-out. Same contacts,
  same order. `__colPre = false` = off. tests/perf-collision-bvh.test.ts NEW: 3000 random capsules over a 12 k-tri
  soup, on vs off bit-identical (normal + depth). Node micro-bench (scratch/perf2/colbench.ts, 4000 queries, dense
  soup): 357–407 → 162–194 ms (−52…−55 %). In-game numbers: cprobe (qb3) on dist G = BEFORE; after on the next dist.
- B5 17:3x DIST G AUDIT (Medium, b2/bud-medium.json, console errors 0): C7 151 → 0 frames over budget, C2 8 → 0, C2c 6 → 0,
  C4a 4 → 0, C4c 243 → 41 (the mirror cull + the figure shadow cull work) — but C5 503 → 482 d, B11 512 → 473, C6 656 →
  606, C1 unchanged: the torch cull, the view-clipped openings and the mirror rule barely move the interior views.
  Why (scratch/perf2/wcdebug.ts + campath.ts): single-opening sub-frusta are too loose — from the hall the parlor's
  windows (seen, if at all, only through the parlor doorway) keep the yard beyond them alive, and from the yard G2's
  windows keep G3 behind G2 alive; the room PVS is static. (The dist-G abx run was stopped before it ran: its scenario
  was edited for the next tree; dist G deleted.)
  CODE src/render/portal-cull.ts NEW (owned; level.ts switches to it, `?pcull=0` / `__pcull = false` = the window cull
  path): exact cells-and-portals visibility. Cells = interior rooms (CLOSET merged into G1 — its 1.3 m wall leaves it
  open to the hall; U4 + U4T merged — the only room boundary without a wall, scratch/perf2/wallgaps.mjs) + OUT;
  portals = every wall opening and the two slab holes (stairwell G1 ↔ U1, grate G2 ↔ U2), inflated 0.15 m on the
  centre plane. Depth-first from the eye with the view's side planes (+ 0.25 m), adding the four planes through the
  eye and each portal's edges; a portal is entered only from its near side and only if not wholly outside the
  frustum; a convex cell is never re-entered on one path (a straight ray cannot). A mesh is parked (layer 6) only if it
  lies wholly inside its cell (interior box ± half wall / slab; OUT: clear of every room box + a wall) and inside NO
  frustum that reached its cell; the eye's own cell(s) never cull; an eye in a wall / doorway (no cell, inside the
  footprint) or > 400 frusta → the frame does not cull. D_FRONT shut (angle 0) → its portal shrinks to the glazed
  fanlight above the leaf (solid panel leaf against stops, doors.py); every other door counts as open. The lit torch is
  a second eye with its spot cone + 5° as root frustum (its casters follow the view layers, F3). installPortalShadow-
  Layers: shadow cameras that follow the view layers add layer 6 AT RENDER TIME (ShadowNode.updateShadow wrapper; the
  window cull's once-a-second light scan missed a light whose mask a cue had just reset — the lamp roaming for a
  stroke). The cull now runs at the END of main.ts world() (after rig.update: the torch posed for this frame).
  tests/perf-portal-cull.test.ts NEW (5): a THIN-wall oracle of the real layout (zero-thickness walls with their
  openings cut out, per-room floor / ceiling planes with their holes, foundation walls, the shut front leaf) — 640
  random eyes (every room / the yard; door shut / open; ± torch) × 60 meshes: no culled point is on screen through an
  unobstructed segment from the eye, nor inside the torch cone on an unobstructed segment from the torch. (Its first
  version flagged a torch ray that passed under an interior wall between two floor rects — an oracle gap, closed by
  foundation walls + slabs under the walls.) Typecheck clean; npm test 364 / 364 (one earlier run 363 / 364 with one
  failure that did not reproduce in 3 re-runs — not captured; watching for it).
  Dist H (scratch/dist-perf2-budgets-h, 17:5x) = (a) torch scope + (b) figure shadow cull + (c) / (d) window-cull rules
  (now the `?pcull=0` fallback only) + portal cull + collision prefilter + setTrim cache. qb7: bud Medium → abx 'all'
  late (B11, C5, B12, C6, C7) + early (C1, B02, B03, C2, C2c, B05) → bud Max → cprobe prefilter on / off → C7 start
  probe Medium + Max → csprof Max C7 4.4–5.0.
  Asked the lead (main) for a ≈ 45-min Blender-free window for the real-time tables (JUMPSCARE scare-render jobs are
  back on the Blender lock since ≈ 16:3x).
- B6 17:5x src/world/window-cull.ts REVERTED to HEAD (its B2 view rule and B3 mirror rule are superseded by the portal
  cull; the file is again the untouched RUNTIME F2 cull = the `?pcull=0` / `__pcull = false` fallback and the A/B
  reference) and tests/perf-window-cull.test.ts removed. portal-cull.ts: per-unit world sphere / in-cell result cached
  while the mesh's matrixWorld is unchanged; meshes of a room the PVS hides this frame are skipped (not drawn anyway);
  the update's ms is in `level.portalCullStats().ms`. One shot.mjs session per tier from now on: every session waits
  behind a ≈ 45-min JUMPSCARE render (FCFS lock), so scratch/perf2/combo.mjs does in ONE stepped strict-route
  playthrough: the budget audit (+ the figure-cull containment audit every 15th frame, + portal-cull state / ms), the
  exact per-frame A/B 'all' (REF = HEAD behaviour: window cull, no gameplay / C5 torch cull, no figure cull; TEST =
  this tree) on every 4th frame of C1, B02, B03, C2, C2c, B05, B08, C4c, B11, C5, B12, C6, C7, the collision cost with
  the prefilter alternating on / off per frame, C7's first 1.5 s node builds / pipelines (setTrim), and on Max a CPU
  profile of C7 4.4–5.0. Dist I = scratch/dist-perf2-budgets-i (the candidate final tree; typecheck clean, npm test
  360 / 360, verify-boot OK; tree dist-i-tree.txt, diff dist-i-src.diff); dist H deleted. Queue qb8 (b8/).
### Budgets lane — edits outside src/render (surgical, logged)
- src/game/main.ts (owned): import char-shadow-cull + VIEW_CULL_SCOPE; `VIEW_CULL_SCOPE.play` set at the top of world()
  (gameplay frames: no cutscene, no C4 overlay; `?torchcullplay=0`); the figure shadow cull installed + registered at
  the end of the afterCompile hook (after every warm-up pose); debug expose `torchCull()`, `charShCull.{stats, audit}`.
  (The B2–B9 move of level.updateWindowCull to the end of world() with the camera + torch is REVERTED in B10: the call
  is back at its HEAD place and form.)
- src/world/level.ts (owned): the portal-cull wiring of B5–B9 REVERTED to HEAD in B10 (file = HEAD).
- src/cutscenes/bindings.ts (the cull arrays): TORCH_CULL_IDS exported, + 'C5'.
- src/game/story-runtime.ts (character light wiring, surgical): `shadowFigures` (Ada body / her head rig / Harlan →
  the #150 subject spheres, valid only when updateCharLights set them this frame), exposed on the story object.
- src/world/cutscene-fx.ts (task item 3): setTrim's maroon clone cached per mesh (per original material).
- src/world/collision-bvh.ts (PERF-G-authored; task item 3, the B06 / B08 bursts): the exact triangle-box prefilter.
- src/world/window-cull.ts: edited in B2 / B3, REVERTED to HEAD in B6 (untouched now).
- B7 18:1x the first Medium combo session (started 18:09 after ≈ 27 min behind a JUMPSCARE render + an encode job) died
  at its first eval: bud.mjs's draw accounting ran for the A/B's own plain renders outside a game frame (its breakdown
  map was still null) — the scenario's bug, no game error (console errors 0 / exceptions 0). Fixed (counts only inside
  pipeline.render) and re-queued (qb8, 18:11); the tree is unchanged = dist I (the rebuilt bundles hash-match dist I).
  Prepared qb9 (after the Medium combo): qb5 on dist I (calm-gated rtplay Medium + Max, then strict gates Medium + Max)
  → the Max combo (A/B over C0, B02, C3, C4a, B06, B09, B10, B11, C5, C5b, C6, C6b, C7, CR + its budget audit + a CPU
  profile of C7 4.4–5.0).
- B8 18:46–19:15 MEDIUM COMBO on dist I (b8/medium/, console errors 0 / exceptions 0, ended B13, 0 deaths):
  · figure shadow-cull containment audit: 1068 audits route-wide, 0 violations (every posed figure mesh inside its
    figure sphere);
  · portal cull ran on 15 996 frames (eye in a wall / doorway 15, torch in a wall 10: those frames don't cull); its
    update 0.16 ms avg (max 5.3 = the first frame's unit collection);
  · budgets (bud.json): C5 503 → 452 d, B11 512 → 442, C6 656 → 531, C7 ≤ 400, C2 / C2c / B05 / C4a ≈ in budget —
    NOT enough: in the hall the view still drew EXT2 80 d / 0.75 M (the portal cull's yard rule kept every yard mesh
    whose SPHERE came within a wall of the house — terrain tiles, porch, trees — which the window cull had culled);
  · EXACT A/B 'all' (REF = HEAD behaviour, TEST = this tree; every 4th frame): 0 real differences in C1 (546 frames),
    B02 (154), B11 (261), C4c (83); REAL DIFFERENCES in C2 22 / 217, C5 70 / 254, B08 27 / 198, B12 9 / 83, B03 3 / 7,
    C2c 3 / 105, B05 2 / 336, C7 2 / 262, C6 1 / 253 — mostly 1–11 pixels of 92 k at 384 × 240 (rel 2–30 %), but B08
    235.4 (8 px, abs 0.53) and B12 401.3–402.2 (10 → 150 px, rel ≈ 100 %, and TEST drew 1–2 MORE draws than REF: an
    object present in one arm only). THE TREE IS NOT SHIPPABLE AS IS — not used for any claim.
  · collision cost with the prefilter alternating on / off per frame: B06 / B08 in U2 5.4–5.7 ms per frame (max 20–22),
    11–12 capsule queries per frame at 830–900 candidate triangles per query (elsewhere 9–60) — the prefilter saves
    nothing there (the candidates DO overlap the capsule: the bot stands against P_BED, a `collider: mesh` prop whose
    exact quilt triangles go to the BVH). The fix is the bed's collider (a `-collider` proxy / `box`) → For LEAD.
    collision-bvh.ts + its test REVERTED to HEAD (no out-of-lane edit for a gain of < 0.2 ms).
  · C7's first 1.5 s: the maroon clones were reused (see b8/medium/col-c7.json; only the rain overlay pipelines at t 0).
  CODE after dist I (→ dist J, 19:2x): (1) portal cull: never culls a mesh with frustumCulled = false or a material
  positionNode (draws beyond its geometry bounds); (2) un-culling restores layer 0 only while our layer-6 marker is
  still set (another system that rewrote the mask keeps its value); (3) a yard mesh culls while its world AABB stays out
  of every room's own volume (unpadded) — the old sphere-near-the-walls rule kept the terrain / porch / trees;
  tests/perf-portal-cull.test.ts + 20 facade-hugging yard meshes per trial (pass). npm test 359 / 359 (one of five
  runs failed tests/arms-pullback.test.ts "walking at a wall the pool stays on the gaze point" — FLASH's test, flaky,
  the same one S32 saw; not this lane). qb10: the DIAGNOSIS session on dist J — every frame of the bad windows with
  the A/B mode cycling pcull / torch / charsh / all and the drawn-object diff (REF vs TEST) of each real difference.
- B9 19:3x–19:5x DIAGNOSIS on dist J (b10/, console errors 0): every frame of the bad windows, the A/B mode cycling per
  frame. torch: 0 real differences in every window (B03, C2, C2c, B05, B08, C5, C6, C7 — the gameplay / C5 torch
  caster cull is exact here); charsh (figure shadow cull): 0 in every window; pcull (the portal cull): B03 4 / 6,
  C2 16 / 26, C2c 1 / 5, B05 1 / 4, B08 6 / 16, C5 7 / 16, C6 0 / 3, C7 0 / 5 → THE PORTAL CULL is the source. The
  drawn-object diff of every pcull difference: only MAIN-pass objects differ, all culled in TEST (shadow passes
  identical): the yard / facade (EXT2 terrain, ground planes, groundcover, porch, siding, roofs, chimney, wrecks) and a
  few G2 props (the parlor lamp, its stool, the whetstone) — so some culled main-pass object is visible; the layout
  model (thin-wall oracle, eyes now also hugging walls / thresholds) finds no unsound case, so the game's geometry or
  bounds differ from the model somewhere. qb11 (dist J, B03 → B11): the same windows with the camera pose and a
  halving culprit search (TEST + a subset of the culled objects back on layer 0 until TEST matches REF) per real
  difference.
- B10 21:5x RESTARTED agent (the previous Budgets agent was cut off by a usage limit ≈ 19:50; ruling (az): finish
  tonight, finish the culling only if close, else revert it and keep what is proven; ONE final dist → qb5).
  qb11 RESULT (ran 19:43–20:39 after the cut-off, dist J, console errors 0 / exceptions 0, b11/): the portal cull still
  differs from REF in most frames of every bad window — B03 15 / 26 frames, C2 22 / 26, C5 21 / 40, B08 7 / 40, B05
  5 / 16 (rel up to 0.96) — and every differing object is MAIN-pass yard geometry seen from an interior eye (EXT2
  terrain tiles, ground_mud_wet / ground_gravel_wet, groundcover, porch, facade) culled in TEST only. The halving
  culprit search never ran (combo.mjs has no such code; abx.json has only the drawn-object diffs). Budgets with it on
  (b11 bud): C5 414 d / 1.64 M, B11 405 / 1.61 M — still over even if it were sound.
  DECISION: NOT close to done → REVERTED. src/world/level.ts = HEAD again (`git checkout`; its diff was only the
  portal-cull wiring); main.ts: `level.updateWindowCull(camera.position, t)` back at its HEAD place (right after
  setViewer), the end-of-world() call removed; src/render/portal-cull.ts + tests/perf-portal-cull.test.ts PARKED in
  scratch/perf2/portal-cull-wip/ (not in the tree). Hypothesis for a later round: the game's yard bounds / the
  openings the eye sees through (front door, G1 / G2 windows) differ from the thin-wall model — compare the culled
  set at B03 124.47 (abx.json bad[0]) against the window cull's live openings for that eye.
  KEPT (proven, exact same-state per-pixel A/B, B8 'all' + B9 per mode): (a) torch caster cull in gameplay + C5
  (VIEW_CULL_SCOPE.play, TORCH_CULL_IDS + 'C5'; 0 real differences in every window); (b) figure shadow cull
  (src/render/char-shadow-cull.ts; 0 real differences, 1068 + 793 containment audits with 0 violations); setTrim clone
  cache. CAVEAT: B8's B12 401.3–402.2 difference (TEST drew 1–2 MORE draws) was never re-run per mode (b10 / b11 stop
  before B12); it is attributed to the portal cull's dist-I restore bug by its signature only — both kept culls can
  only REMOVE shadow-pass draws. Draws they save per frame (b10 per-mode A/B, every shadow map forced to redraw, so an upper bound): figure
  cull C5 63–102, B08 102–105, C2 / B03 22, B05 15–18, C6 / C7 0; torch cull C5 8–10, B05 3–16, B03 0–7, C2 / C6 / C7 0.
  BUDGETS ON THE FINAL TREE (not re-audited — one headless Chrome, qb5 holds it): bracketed between dist F (B1, no
  culls) and F minus the savings above (forced-redraw savings ≥ the natural-frame ones): C5 0–2.5 s 390–503 d (worst
  frame likely still over 400), B05 466–500, B11 / B08 / C4c lower by up to the figure-cull savings, C6 656, C7 513,
  C1 60.6 508 (no saving there): KNOWN overruns, not chased (ruling (az)). The exterior render-all shots (C6 / C7 / C1)
  are interior rooms drawn from the yard — the job the portal cull was for.
  FINAL TREE = dist K (scratch/dist-perf2-budgets-k, 21:59; tree scratch/perf2/dist-k-tree.txt, diff dist-k-src.diff):
  typecheck clean, npm test 354 / 354 (b12/npm-test-pre.log), vite build + verify-boot OK (build-k.log). Dist J
  deleted (disk 11 → 12 GiB; after K 11 GiB again — the other lanes' dist-fb, dist-fb-rel, dist-flash-reverify hold
  ≈ 540 MB, not mine to delete). qb5 started 21:59:32 (pid 21582, `DIST=scratch/dist-perf2-budgets-k
  OUTV=scratch/perf2/b12`): npm test → calm-gated rtplay Medium + Max → strict gates Medium + Max; the lead's
  calmhold set the Blender hold at 21:59 (until 00:29); the JUMPSCARE scare_render started 21:52 (one frame, 96 spp)
  runs out first (it ended 22:04).
  22:12 qb5 BUG (never run before this): `for P in ${PRESETS:-medium max}` is ONE word in zsh (no word splitting) →
  it launched `shot.mjs --preset "medium max"` into `b12/rt-medium max/`. Fixed in place (`${=PRESETS:-…}`, atomic
  replace), started the fixed instance (pid 26428) BEFORE stopping the old one (21582 + its sampler + its shot.mjs,
  which was still waiting for the Chrome lock — nothing ran), so calmhold's pgrep never saw qb5 gone and the hold
  stayed set. The aborted instance's log: b12/aborted/. The rt run now waits for the Chrome lock behind FINAL-BAKE's
  stepped Max stills run (dist-fb-rel, rv.mjs; swap 5.2 / 6 GB used at 22:12).
  22:2x FINAL-BAKE's reviewer chain (scratch/final-bake-rv/chain.sh: 7 stepped stills runs + a strict Max playthrough,
  back to back) kept the 1-min load at 6.2, so qb5's calm() load gate (< 3) would hold the rt runs ≈ 1 h (its 60-min
  fallback). Removed the load gate (same atomic replace + overlap restart, pid 29466; the hold stayed): AC + no
  Blender + last Blender log ≥ 90 s remain; shot.mjs's exclusive FCFS Chrome lock keeps every other headless Chrome
  out of our runs (the chains interleave between runs); validity is decided afterwards by the gameplay control
  segments (Medium vs S36, Max vs S29), as before.
- B11 22:4x WHOLE ROUTE REAL TIME, MEDIUM, DIST K (qb5 rt-medium 22:24–22:41, AC 102 / 0 battery, Blender held,
  console errors 0 / exceptions 0, ended B13 / the ending, 0 deaths; b12/rt-medium.json, -sum.md, -table.md):
  TOTAL 3356 / 31250 = 10.74 % frames > 20 ms — **INVALID (machine state)** by the S20 / S23 rule: EVERY gameplay
  control is worse than dist E's S36 (B02 4.55 vs 0.08 %, B05 2.17 vs 0.41, B06 10.1 vs 0, B08 12.6 vs 2.47, B09
  1.86 vs ≤ 0.02, B11 29.1 vs ≤ 0.02, B12 2.54 vs ≤ 0.02), and so are the cutscenes this lane does not touch (C0
  3.1 vs 0 — no torch cull there; C1 5.2 vs 0.34). Machine during the run: 1-min load 5.8–9.4, swap 4.5–7.4 GB used,
  iCloud `bird` at 46 % CPU, the user's own Chrome renderer at 32 %, the game's LOAD took 183.6 s (35.3 s in S36);
  FINAL-BAKE / JUMPSCARE headless-Chrome runs interleave between ours. Not used for any claim. What it still shows
  (hitch clusters > 50 ms, table.mjs): the known classes — C1 13.77 one 450 ms GPU-side frame (S36: 233 ms), C5
  29.28–29.58 the dawn re-capture precompile (b2 p8), C6b 2.78–3.7 the async road pipelines (b12 p5); render-JS-bound
  stretches of 28–47 ms frames in B11 / C5 / C6 (render JS ≈ 8–9 ms in S36 → CPU starvation); and the B06 / B08 U2
  update bursts, here 27–31 consecutive frames of 91–162 ms UPDATE JS (B08 242.9: 633 ms) — the P_BED mesh-collider
  cost (B8) amplified by the 120 Hz substep catch-up on a starved CPU (a slow frame → more substeps next frame).
  The tree also differs from E outside this lane: HEAD b235f41 (Ship 3: arms.ts, controller.ts step-up rule,
  flashlight.ts / flashlight-bounce.ts) and FINAL-BAKE's re-baked lightmaps in public/assets (uncommitted). A
  same-session cull on / off cost probe (b12/bp-c5, bprobe.mjs C5 0.3 / 2.3 / 10, fenced ms + draws + stills) is
  queued in the Chrome FCFS queue ahead of qb5's gates to separate this lane's culls from the rest.
- B12 22:5x WHOLE ROUTE REAL TIME, MAX, DIST K (qb5 rt-max ≈ 22:47–22:56 after two FINAL-BAKE Max stills runs, AC 90 /
  0, console errors 0 / exceptions 0, ended B13, 0 deaths; b12/rt-max.json, -sum.md, -table.md): TOTAL 7960 / 23478 =
  33.9 % frames > 20 ms — **INVALID (machine state)**: the startup GPU benchmark read 226.9 ms per frame (9–17 ms in
  every earlier run), swap 6.6 / 7.2 GB used, and every gameplay control is far worse than dist C's S29 (B05 38.1 vs
  3.5 %, B06 23.9 vs 8.6, B08 11.5 vs 11.5, B09 21.9 vs 3.8, B11 30.0 vs 8.1, B12 27.0 vs 0). Not used for any claim.
  Freezes ≥ 200 ms in it carry no pipeline / node builds (C1 13.77 1.95 s, C1 30.42 1.05 s, B05 204.5 0.97 s, C1 66.25
  0.73 s) — the S29 "Max working set under swap" class (handoff item 3), now with 6–7 GB of swap.
  22:56 qb5 started gate-medium → calmhold LIFTED the Blender hold (its rule: gate-medium's shot.mjs exists, although
  it is still queued). Chrome FCFS queue at 22:58: FINAL-BAKE meddev3 (running) → JUMPSCARE js-med → our bp-c5 probe →
  4 FINAL-BAKE runs → our gate-medium → JUMPSCARE js-low; gate-max enqueues after gate-medium. Lead told (SendMessage
  22:59): a valid real-time table needs every other lane's Chrome + Blender work paused for ≈ 45 min.
- B13 23:0x SAME-SESSION CULL A/B ON DIST K (bprobe.mjs, Medium, frozen C5 clocks 0.3 / 2.3 / 10, arms base → nocull
  (`__charShCull = false`, `__vcMode = 'off'`) → base2, natural shadow updates; load 6, Blender running again; console
  errors 0 / exceptions 0; b12/bp-c5.json, b12/bp-c5/*.jpg):
  · draws / triangles (exact): base 448 / 1.469 M · 443 / 1.468 M · 415 / 1.453 M vs nocull 451 / 1.495 M · 447 /
    1.494 M · 431 / 1.490 M — the kept culls remove 3–16 draws / 26–37 k triangles per C5 frame (the torch map's EXT2
    and U1 casters, Ada's figure draws); base2 = base exactly. C5 on the FINAL tree, Medium: 415–448 draws (OVER the
    400 budget), 1.45–1.47 M triangles (under 1.5 M) at these clocks.
  · fenced ms: base 34.04 / 33.08 / 26.48, nocull 31.96 / 30.43 / 24.16, base2 32.72 / 28.00 / 24.69 — the nocull
    deltas (0.1–1.4 ms under the base mean) sit inside the same-arm spread (base vs base2 0.8–5.1 ms) of a loaded
    machine: no measurable cost or gain. CPU of the figure cull: ONE ShadowNode.updateShadow per frame passes through it
    (stats: +46 updates per 46-render arm, 20 meshes applied per update) = one figure-tree walk + 20 matrix inverses.
  · stills SSIM base vs nocull 0.9974 / 0.9977 / 0.9913, base vs base2 (the noise floor) 0.9970 / 0.9974 / 0.9912 —
    no visible change (the A/B equals the floor).
  So the kept culls do not explain the B11 / B12 real-time numbers (they only remove draws and cost ≈ nothing); those
  runs are machine state as judged above, and whatever else changed since E (Ship 3, the re-baked lightmaps) is
  unmeasured in real time.
  23:10 GATES: the Chrome queue is 8 deep (FINAL-BAKE reviewer + JUMPSCARE QA). To get gate-max an earlier ticket I
  started it myself now (same command as qb5's step: QA_STRICT=1 playthrough.mjs, --preset max, b12/gate-max/, log
  b12/gate-max.log) and stopped qb5's shell (pid 29466) so it cannot launch a duplicate; its gate-medium shot.mjs
  (pid 37330, b12/gate-medium.log) keeps running, and its power sampler (pid 29469) keeps writing b12/power.log
  (killed at the end).
- B14 23:2x GATE MEDIUM on DIST K (QA_STRICT=1 playthrough, ≈ 23:20–23:26 after the queue; b12/gate-medium/,
  gate-report.json): ended=true beat=B13 (C7 → title), game 585.4 s, deaths 0, console errors 0, exceptions 0, all
  18 assertions ok (C1 / C2 / C3 / C5 / C6 / C7 / C4c / C6b / CR played; C4a and C5b played; C2b not triggered —
  optional); AC throughout (power.log). Stills checked: gate-03 (C2 parlor: candle-lit, Harlan and the table present)
  and gate-07 (C5 shadowplay: Harlan and Ada torch-lit) render complete — no missing geometry.
- B15 23:4x GATE MAX on DIST K (QA_STRICT=1, ≈ 23:37–23:43; b12/gate-max/, b12/gate-max.log): ended=true beat=B13,
  game 527.5 s, deaths 0, console errors 0, exceptions 0, 18 / 18 assertions ok (C4a, C5b played; C2b not triggered);
  AC (0 battery samples). GATES ON THE FINAL TREE: Medium + Max strict PASS.
  CLEANUP: power sampler stopped; scratch/dist-perf2-budgets-k DELETED (disk 13 GiB free). To rebuild the same tree
  for the calm real-time re-run: `npx vite build --outDir scratch/dist-perf2-budgets-k --emptyOutDir && node
  scripts/verify-boot.mjs scratch/dist-perf2-budgets-k`, then `DIST=… OUTV=… NOGATE=1 zsh scratch/perf2/qb5.sh` (the
  fixed qb5: presets split, no load gate) — compare with dist-k-tree.txt first (other lanes may have moved the tree).
  The portal-cull WIP + its oracle test: scratch/perf2/portal-cull-wip/. This lane ENDS here; nothing committed.
