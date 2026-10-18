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
   4 frozen C2 states) — real-time DONE (S3); frozen-state ms = the ablation's `base` column (queued, q3.sh)
2. Character shading cost — attribution S4; gates S5–S7 (exact, but only 0–3 ms); POINT/SPOT POOL S8 — Medium proof
   S9 (−8…−11 ms in C2, no visible change); Max proof + real-time runs queued (q5e.sh)
3. Ruling (aq): hold = min(gameplay, per-cutscene cap) ≥ floor; missed-vsync guard (> 5 % over 1 s → −0.05); test — TODO
4. Prove it (C2 real time Medium + Max after; hero stills 7.4 / 9.3 / 13.9 before/after) — TODO
5. Gate (typecheck, npm test, strict Medium + Max playthroughs, 0 console errors) — TODO

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
- Tools (scratch/perf2/): q1.sh (queue), lightab.mjs (char LightsNode subset A/B + plain-Standard A/B at frozen C2
  states, fenced gpuFrameMs, stills), cscost.mjs (cs-frames-style real-route wrapper: fenced gpuFrameMs per cutscene
  every 1.5 s of its clock at several scales — the cap measurement).

## Edits outside src/render (surgical, logged)
- src/game/story-runtime.ts: import CharacterLights/boneSphere; `charList` + `new CharacterLights(charList)` (or
  `lightsOf(charList)` with ?charlights=0) replaces the `charLights = lightsOf([...])` line (same lights, same order);
  `updateCharLights()` (subject spheres, every figure) after `characters.lightsNode = charLights`, exposed as
  `updateCharLights` (main.ts world() calls it last); `charLights: charRig` exposed for QA; `?charpool=0` read here.
- src/game/main.ts (owned): CutsceneProfile options + syncCutsceneHold (render() and advance()), guard wiring;
  `story.updateCharLights()` at the end of world().

## For LEAD

## HANDOFF (Budgets agent) — draft, kept current
State of the tree (all uncommitted): src/render/char-lights.ts + char-light-select.ts (gated character light list +
point / spot pools), src/game/story-runtime.ts (surgical, logged above), src/game/main.ts (cutscene hold / guard
wiring, updateCharLights at the end of world()), src/render/cutscene-profile.ts (caps + vsync guard), tests
perf-char-lights / perf-cs-cap. Queues: scratch/perf2/q6.sh (caps) → q7.sh (after runs + strict gates).
Not done this round (for Budgets / next PERF):
1. C5 culling (ruling (aq)): C5 is still render-all (bindings.ts CS_CULL_IDS excludes it; STATUS-smooth-perf S9: C5
   10–14 s 43 frames at ≈ 42 ms render JS — 447 ms shadow renders + 579 ms _updateBindings per 1.5 s on Max; 871 d /
   2.85 M Medium). Caveat before adding 'C5': with culling the room / `seen` set follows the CAMERA's feet
   (viewerFeetZ) instead of the player's, which can change which flicker lamps are lit (RuntimeLights.update) — needs
   a same-state A/B of C5 stills (cull vs ?cscull=0), not playthrough stills (STATUS-perf-g G5).
2. The Max C2-start frame (117 ms at C2 0.12 in the baseline: a ShadowMaterial pipeline + a 1152×720 RGBA16F mip
   target created the frame before) — probe scratch/perf2/c2start.mjs (queued in q6); fix = warm that pipeline / pre-size
   the chain at the held scale in the tableau warm.
3. WGSL flag: in each character program the spot-cookie `inSpotLightMap.select()` else-branch reuses a shadow value
   computed only in the if-branch (three r186 select() codegen; the torch / headlight-L cookie spots). Same structure
   is expected without the gates; NOT yet diffed against a ?charlights=0 program dump (scratch/perf2/progdump.mjs is
   ready: DUMP=dir, run once with and once without ?charlights=0).
