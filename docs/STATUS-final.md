# STATUS — FINAL BUILDER (lane B + the jumpscare runtime file), 2026-10-19

Task: items 0–3 + gates (typecheck, npm test, build, ONE strict Medium playthrough on scratch/dist-final).
Scratch: scratch/final/. Contract rows: #153, #153b, …
Rule: do not touch src/cutscenes/death.ts, src/world/jumpscare.ts, src/audio/synth/scare.ts until
docs/STATUS-jumpscare.md has a line starting with "JUMPSCARE LANE DONE".

## Item 0 — P_BED collider (PERF2 #150b)
- BEFORE (from docs/STATUS-perf2.md B8 / B10, not re-measured): B06 / B08 in U2 5.4–8.2 ms of capsule-query JS per
  frame (max 20–32 ms), 11–12 capsule queries per frame at 830–900 candidate triangles per query (cprobe.mjs).
- Bed asset (props_m1.glb, P_BED-iron_bed): ONE mesh, 3 primitives, 8440 tris (< PROP_TRI_LIMIT 9000 → exact):
  cast_iron frame = headboard (local z −1.03…−0.97, 1.30 m) + footboard (z 0.97…1.03, 1.00 m) + 2 thin side rails (see CODE);
  mattress x ±0.67, y 0.358–0.638, z ±0.97; blanket y 0.296–0.548.
- A plain `box` collider would make the frame ONE 1.47 × 1.30 × 2.06 m block: the torch's beam-centre ray
  (flashlight-bounce rayDistance), AI sight lines and interaction LOS would hit 1.30 m over the whole bed (0.66 m
  above the mattress). → plan: layout `box` + gap-split boxes in code (head / foot boards + mattress / blanket slabs).
- CODE (done, typecheck clean): layout P_BED `"collider": "box"` (contract #153); `src/world/collision.ts`
  `propColliderMeshes(root, kind, interact, gapSplit)` + `gapBoxes()`: per mesh, boxes per 10 cm slice of the longer
  horizontal axis (triangle parts clamped into the slice), neighbours within 3 cm merged, empty slices dropped;
  `src/world/level.ts` enables it for `kind === 'box' && type === 'iron_bed'` only. The frame turned out to have two
  4 cm angle-iron side rails (0.29–0.33 m, triangles spanning head→foot), so a pure gap split would not have worked.
  Offline on the real asset (scratch/final/bedbox.ts, props_m1.glb decoded): 9 boxes / 108 tris — headboard 1.30 m
  (plan y 4.43–4.53), rails slab 0.295–0.33, footboard 1.00 m (2.47–2.57), mattress 0.358–0.638 (pillow end) /
  0.358–0.540, blanket top 0.51–0.55 + draped sides to 0.296. Plain box (for reference): 3 boxes, frame 1.30 m over all.
  tests/bed-collider.test.ts NEW (synthetic bed: split → head / foot / mattress; unsplit → the 1.30 m block).
- Interactables vs the bed bounds (+0.15 m, plan x 6.72–8.49, y 2.32–4.68): P_LEDGER (6.5, 4.15), P_BELL_PULL
  (6.1, 4.46), P_GRATE (6.0, 3.2), P_HAMMER (8.7, 1.15) all outside → stays `box` (runtime check pending).
  AI U2 loop nodes (U2_BEDLOOK 6.35, 2.15 …) all ≥ 0.5 m west/south of the bed.
- q1 cprobe (Medium, pre-dist, BATTERY 89 % → ms inflated; candidate counts deterministic; 0 console errors):
  P_BED's 9 boxes confirmed at runtime (12 tris each). BUT B06 9.15 ms / frame avg, 11.2 queries × 845 candidates;
  B08 5.48 ms, 7.9 × 951 — NOT better: the worst frames map to P_NIGHTSTAND (nightstand001_1 1280 + door_1 785 +
  nightstand001 405 + drawer 163 + door 148 of 2823 candidates), the bot at plan (6.1–6.2, 3.8–3.9) reading the ledger
  (u2_ledger 6.3, 3.8) and pulling the bell (u2_bell 6.1, 4.0) — i.e. where a real player stands too. The nightstand
  is `box` in the layout but level.ts forced it exact because P_LEDGER lies on it. PERF2's "P_BED" attribution was
  wrong (or the bot stood elsewhere then); the bed change stays (approved, 8440 → 108 tris, harmless).
- CODE (item 0b): `src/world/level.ts` — a `nightstand` keeps its layout `box` despite the interactable: the ledger's
  origin is ON its 0.66 m top (props glb: body 0.47 × 0.66 × 0.40, door, drawer) and the per-mesh boxes end at that
  surface, so interaction LOS (camera ray hits the ledger first; static collision blocks only if closer than the hit
  − 0.12 m) is unchanged. Re-measure: q3 cprobe on scratch/dist-final-pre3. The strict gate proves the ledger still
  reads (the bot needs ledger_read to leave B06).
- RESULT (q3 cprobe, scratch/dist-final-pre3, Medium, --beat B05 → B09, mains power (charging), 0 console errors /
  0 exceptions; the bot read the ledger and left B06, pulled the bell in B08). Same method as PERF2 (cprobe.mjs):
  | beat | ci ms / frame avg | queries / frame | candidates / query | frames > 5 ms | > 10 ms |
  | B06 BEFORE (q1, bed boxes only, battery) | 9.15 | 11.2 | 845 | 69 / 221 | 69 |
  | B06 AFTER (q3) | **0.90** | 11.2 | **86** | 1 / 221 | 0 |
  | B08 BEFORE (q1) | 5.48 | 7.9 | 951 | 255 / 1148 | 255 |
  | B08 AFTER (q3) | **0.61** | 8.1 | **76** | 7 / 1198 | 2 |
  (STATUS-perf2's own BEFORE: 5.4–8.2 ms, 830–900 candidates / query.) The two > 10 ms frames left carry only
  696–1476 candidates (12 queries): JS timing outliers, not the collider. Runtime collider list: P_BED 9 boxes, P_NIGHTSTAND
  5 boxes (body top 0.66 m, door, drawer, handles), 12 tris each.

## Item 1 — C2c 6.733 dark dip
- Mechanism (from STATUS-flash r3 data + bindings.ts): the C2c beam is aimed at the gaze ray's hit with the aim
  DISTANCE eased in log space (GAZE_TAU 0.08 s). Mid-whip the gaze hit comes closer faster than the ease; the lagging
  aim point sits INSIDE the stairs, so the beam from the torch (0.3–0.6 m under the eye, at tread level in the
  stumble) meets riser 13 0.10 m from the lens (FLASH hitD 0.096–0.128, 51° below the horizon, frame edge −50.5°).
- CODE (runtime only, typecheck clean): `src/cutscenes/bindings.ts` beamClamp gaze mode gains `near: 1` — the eased aim
  distance is clamped to the current gaze hit (never behind the surface the eye sees; outward it still eases);
  `src/cutscenes/c2c-up.ts` 6.46 cue `beamClamp {on, gaze: 1, near: 1}` (the stumble), ended by glance #2's 6.85 cue.
  Blender clip untouched.
- RUN q1 (pre-dist, `near` only) FAILED: Low 6.733 still BLACK (luma 0.0008, HDR 0.020 vs 13.3 at 6.700). XROW proved
  my first theory wrong: the aim WAS on the gaze hit (aimD 0.589 = gz 0.59), beam on (1987 cd), its collision hit in
  the frame centre (hitEl −31.6° vs pitch −31.8°). Real cause (frame + blender/house/collision.py): ST_MAIN's
  collision RAMP rises 0.833 m/m from the foot to the last tread, steeper than the nosing line (0.782), so at tread 13
  it floats 0.20 m above the nosings; the static sight ray hits the ramp (0.59 m) in the air in front of the riser the
  eye sees (0.755 m). The lens was at nosing height (z 3.596, 0.2 m above the nosing plane), so the beam aimed at the
  ramp point went UP at ≈ the flight's slope and skimmed over the whole flight (the sheet scratch/final/q1/
  low-dip-sheet.jpg: 6.700 | 6.733 | 6.767 at gamma 2 — the riser in shadow, a sliver of beam on the nosing above).
- CODE v2 (typecheck clean, tests/c2c-stumble-aim.test.ts 3/3): `stage.ts stairSeenDistance(o, d, hit)` — when the
  hit is ST_MAIN's ramp top, the distance to the plane through the nosings + 3 cm (into the riser / tread corner),
  only if within 0.5 m beyond the ramp hit; `bindings.ts` gaze mode params `treads: 1` (use it) and `snap: 1` (follow
  the aim distance at once, no GAZE_TAU ease) — `near` removed; `c2c-up.ts` 6.46 cue `{on, gaze: 1, snap: 1,
  treads: 1}`, ended by glance #2's 6.85 cue. Re-check: queue q2 on scratch/dist-final-pre2.
- RUN q2 (v2) FAILED too: Low 6.733 luma 0.0003 (HDR 0.0085); the aim went 0.784 m (into the steps) and the beam hit
  the ramp 4 cm from the lens. Re-derived the render stair from blender/house/plan.py StairGeo: riser i is at
  y0 + run·(i − 1), so tread k's nosing is at y 3.6 + 0.28(k − 1) — stage.ts treadNosing(k) is ONE TREAD (0.28 m) north of
  the render (it is used for C2c staging; tuned visually, left alone, flagged). In render terms the lens at 6.733
  (0.415, 7.169, 3.597) is 7 cm in front of riser 14's face, BELOW its nosing (3.666): every surface a view up the
  flight shows is hidden from the lens, whatever the aim — FLASH's "choreography" diagnosis was right. v2 + `near`
  REVERTED (bindings.ts back to PERF2's state; stage.ts helper removed).
- CODE v3 (runtime, c2c-up.ts only): `arms_stumble_catch` starts at 6.5 (was 6.46 with the creak; +40 ms, under the
  ~45 ms A/V lead threshold vs the 6.62 impact / 6.64 knock): the jammed pose (clip 0.273 s) now meets the whip at
  6.773, past north, looking east over tread 13 at the rail/balusters (which the lens sees); 6.733 shows the clip's
  ≈ 6.69 pose (lens 0.26 m above the tread, lit like 6.700). tests/c2c-stumble.test.ts (cue times). Re-check: q3.
- RESULT v3 (q3, scratch/dist-final-pre3, cs-frames --beat B03, every bot frame, 0 console errors / 0 exceptions):
  | C2c t | 6.600 | 6.633 | 6.667 | 6.700 | 6.733 | 6.767 | 6.800 | 6.833 | 6.867 |
  | Low luma BEFORE (FLASH GL) | 0.111 | 0.160 | 0.192 | 0.173 | **0.0003** | 0.153 | — | — | — |
  | Low luma v3 | 0.108 | 0.159 | 0.190 | 0.170 | **0.205** | 0.164 | 0.158 | 0.131 | 0.127 |
  | Medium luma BEFORE (B03 route T) | 0.151 | 0.191 | 0.223 | 0.182 | **0.032** | — | — | — | — |
  | Medium luma v3 | 0.144 | 0.185 | 0.219 | 0.197 | **0.241** | 0.176 | 0.216 | 0.164 | 0.146 |
  Pre-exposure HDR at 6.733: Low 0.0085 (v2) → 10.2, Medium 10.05. No frame darker than its neighbours beyond the
  whip's own ±20 % frame-to-frame swing (6.733 is now ≈ +20 % over 6.700, inside that swing). Sheet (ONE image):
  scratch/final/c2c-v3-sheet.jpg (top Low, bottom Medium, 6.667 → 6.833): the pool stays on riser 14 / tread 13 through
  6.733, then the whip to the lit balusters. Max not re-run (same clip timing; Max adds blur + bounce only).
  NOT verified: real-time 60 fps in-between frames (cs-frames steps at 1/30 s).
- Side window (advisor: the shift also moves the arm pose under the 7.45–7.66 turn back, a former black-frame site):
  q5 Low C2c 7.0–7.8 on pre3 vs FLASH's GL frames (Low, gate route, before this change):
  | t | 7.467 | 7.500 | 7.533 | 7.567 | 7.600 | 7.633 | 7.667 | 7.700 |
  | BEFORE (GL) | 0.136 | 0.189 | 0.284 | 0.077 | 0.041 | 0.043 | 0.046 | 0.048 |
  | AFTER (q5) | 0.138 | 0.187 | 0.275 | 0.074 | 0.034 | 0.039 | 0.039 | 0.043 |
  Same shape (her hand close → the far flight, ∝ 1/d² at a fixed film exposure), no new dip; 7.6–7.7 is 10–18 % darker
  (different route + FINAL-BAKE's re-baked lightmaps since GL; not a single-frame event). 0 console errors.
- Verify: cs-frames C2c 6.4–7.0, Low + Medium, --beat B03, PROBE=1, XROW scratch/final/xrow-c2c.js (gaze hit, beam
  hit, aim distance, pitch, hit elevation) — queue q1. BEFORE (STATUS-flash): B03 route Medium 6.700 0.182 → 6.733
  0.032; gate route Medium 0.188/0.204 → 0.057/0.113 → 0.215/0.195; Low 0.173 → 0.0003 (BLACK) → 0.153.

## Item 2 — renderGroup uniforms
- three r186 verified: `UniformNode.setGroup(group)` (src/nodes/core/UniformNode.js:94), `renderGroup` =
  `sharedUniformGroup('render', 0, NodeUpdateType.RENDER)` (UniformGroupNode.js:160) — shared buffer per render call.
- CODE (typecheck clean): `.setGroup(renderGroup)` on uLightning, uCandleSpec, uSpecProxyLo/Hi, uSkyFill, uOpenSkyE
  + (same class, same file) uParlorBake (C5 writes it) and uLmScale (M-A lmScale cue) in lightmap-material.ts;
  uReflection, uReflLod (reflections.ts); materialUniforms wet / dust / macro (bind.ts); all 19 SKY_U uniforms
  (atmosphere.ts, initial values from LOOK + primed in the constructor after initLook to the night sync values);
  + uHibeam (headlamps.ts, written by the C1 opening). Initial values = the synced values (LOOK defaults; 0 at night).
  NOT moved (fewer programs / post): GLARE_BASE (post), the skin.ts character uniforms, ARMS_SHEEN, uRainRefract.
- npm test 367 / 367 on this tree (incl. the new bed test).
- Write-site audit (02:55, advisor: a renderGroup buffer updates once per render call, so a PER-OBJECT write would go
  stale): every moved uniform is written at frame / cue level only — surfaces.ts syncSurfaceLook (uSkyFill, uOpenSkyE,
  uCandleSpec, uSpecProxyLo/Hi, uReflection, uReflLod; once per step from main.ts), main.ts 1497 uLightning (per step),
  cutscene-fx.ts uParlorBake (C5 cues) / uLmScale (grade cue), opening.ts uHibeam (C1 cue), atmosphere.ts update()
  SKY_U (per step), matlab.ts materialUniforms (key toggles). No onBeforeRender / per-mesh writer. OK.
- Verify (Max only: flash lightmaps exist only on Max): scratch/final/lightab.mjs — pre-exposure HDR at 5 screen points
  at 3 poses, lightning 0 vs a seeded strike + 6 frames (deterministic), PLAYED route (from the start → B05) vs
  --beat B05 jump. (q1 run INVALID: the jump spawned in a hide, every pose showed the slats — fixed: hides.exit()
  before each goto; camera position logged per pose.)
- RESULT (q4, scratch/dist-final-pre3, Max, WebGPU, mains; both runs 0 console errors / 0 exceptions): played route
  (from the title through C1, B01–B03, C2, C2c → B05 at the stair top) vs --beat B05 jump, same camera positions,
  same seeded strike (level 0.9091 in both). Flash − no-flash pre-exposure HDR on the flash-lit lightmapped points:
  | pose · point | jump Δ | played Δ | played / jump |
  | stair top · p2 / p3 / p4 | 0.009845 / 0.001346 / 0.010436 | 0.009821 / 0.001340 / 0.010458 | 0.998 / 0.996 / 1.002 |
  | U1 south · p1 / p2 / p4 | 0.001063 / 0.028855 / 0.042589 | 0.001095 / 0.029226 / 0.044998 | 1.03 / 1.013 / 1.057 |
  (p0 = the torch's own pool, flickering; the G1 hall poses' Δ ≤ 0.002 = noise: the strike barely reaches them.)
  The played route lights the walls like the jump within 0.2–6 %. No BEFORE run (the item asked for the check, not an
  A/B; FLASH's V4 was a different uniform set).
- WebGL2 fallback (renderGroup changed every lit program's GLSL too): q5 `--backend webgl --preset medium --beat B05
  --wait 4` on pre3: backend=webgl2, 0 console errors, 0 exceptions.
## Item 3 — jumpscare sensor-noise floor (waits for JUMPSCARE LANE DONE; files untouched so far)
- FINDING (read-only, 01:2x): the JUMPSCARE lane already ships it — `src/world/jumpscare.ts` SCARE_FLOOR
  {L 12, noise 0.9, cellPx 1.4}: an ADDITIVE scene-radiance floor (scalar → luminance-only), hash per 1.4 px cell,
  re-seeded per clip frame (30 Hz), ≈ 2.7 ± 2.1 /255 by their model.
- Measured on the lane's own latest held frames (scratch/final/blacks.py; dark 16 px blocks, mean < 10/255):
  Medium m4/js-held.png (00:28): blacks mean 3.30 /255, std 2.60, pure-0 pixels 0.13 %; Max x7/js-held.png (00:35):
  3.33 / 2.65 / 0.09 %. Animated: consecutive stepped frames st-012 → 013 → 014 (JPG) differ in the corner blacks with
  std 1.72 / 1.75 /255. Spec (≈ 2–4 /255, per frame, ISO 1600-like) MET.
- Honest caveat: the blacks are the grade's cool black — corner mean R 0.09 / G 2.43 / B 8.18 /255, std 0.28 / 1.55 /
  4.23: the noise scales with that tint (constant hue, no random-hue blotches), but the RED channel stays ≈ 0 (a red
  "digital void" under a blue-black). A real ISO 1600 floor after a cool white balance would still carry some red
  noise. Not changed (lane file, lane still active; the floor is applied before the game's grade, which sets the hue).
- Low: since the lane's step (a) (02:00) Low ALSO ships the clip (640×400 crf 24, SCARE_CLIP_TIERS incl. 'low'), so
  the same quad + floor runs there; only the no-decoder / load-error fallback head has no floor (multiplicative grain).
- g1 RESULT (03:55–04:12, BATTERY 72 % discharging — pass/fail only, no fps claims; dist built 03:55:42 = the jumpscare
  lane's final code (147n DONE ~03:30) but NOT FINAL-B's later edits — FINAL-B (#154) added src/world/silhouette-normals.ts
  + a main.ts import at 03:56 and has its probes re-export still to come → the fingerprint flagged TREE CHANGED, so g1 is a
  PRE-GATE): assets --check ok; typecheck rc 0; npm test 371 / 371; npm run build rc 0 + verify-boot OK; strict Medium
  playthrough `done: ended=true beat=B13 game=560.57s wall=180s deaths=0`, 0 console errors, 0 exceptions; js-medium and
  js-low (scripts/qa/jumpscare.mjs, --beat B06, the story's own catch path, stepped + real time) rc 0, 0 console errors,
  0 exceptions, 0 FAIL lines.
- ITEM 3 AS PLAYED (g1 dist, my readback; blacks.py on the held PNG; dark 16 px blocks, /255):
  | tier | blacks mean | std | pure-0 px | frame-to-frame corner diff std B / G (st 12→16) |
  | Medium | 3.28 | 2.55 | 0.14 % | 3.0–3.2 / 1.9–2.0 |
  | Low | 3.51 | 2.97 | 4.0 % | 2.8–2.9 / 2.3 |
  Sheet (ONE image): scratch/final/js-blacks-sheet.jpg (left: held frame; right: top-left corner ×10, 3.2× zoom). Spec
  (additive, ≈ 2–4 /255, per frame, luminance-only) MET on both tiers. Harsh look: the boosted blacks are pure BLUE speckle
  (the grade's cool black tints the scalar floor; red ≈ 0) — constant hue, no random-hue blotches, but not a neutral
  sensor floor; Low's floor is a hard-edged square-cell grid at ×10 (no TAAU softening; ≈ invisible at 1×); Low's 4 % pure-0
  pixels are the noise's low tail clipping, not flat void. Face itself unchanged: the lane's honest "CG / latex mask" verdict
  stands (ranks 1–2 not fixed, needs a re-render).
- gate.sh fingerprint narrowed to build inputs (src public index.html package.json scripts tests tsconfig vite.config):
  my own STATUS edits no longer trip it.
- 03:56 GATE RUN g1 started on the current tree (lane wrote "147n DONE" ~03:30, no edits since; the lead's
  "JUMPSCARE LANE DONE" line still missing): scratch/final/gate.sh > gate.out. Item 3 = no code change (spec met by the
  lane; hue note → requests for the lead). If the tree changes before DONE, the fingerprint flags it and g2 re-runs.
- 03:27 still polling (lane on its 147n re-runs: death.ts lunge exposure fix 03:25). 02:56 gate.sh hardened: content fingerprint (shasum of every modified + untracked file) at start / after the dist /
  at the end ("TREE CHANGED" = FAIL), assets --check, loud FAIL lines (rc, console errors, exceptions, B13), js scare check
  on Medium AND Low with blacks.py on each held PNG.
- 02:52 restart: items 0–2 + pre-gate are done (above); contract row 153 corrected to the shipped slicing (9 boxes /
  108 tris, q3 numbers). Polling docs/STATUS-jumpscare.md every 60 s for "JUMPSCARE LANE DONE" (not there at 02:52).
## Gates
- 01:50 PRE-GATE on the tree as it stands (JUMPSCARE lane still active: its 147n fixer edits are in the tree; NO
  "JUMPSCARE LANE DONE" yet): typecheck clean; npm test 371 / 371; npm run build rc 0 + verify-boot OK (1 boot chunk, no
  three.js / game code); scratch/dist-final built (tree fingerprint `git status --short | sort | shasum` a9d9af18807c);
  strict Medium playthrough (scratch/final/pg-medium.log, 01:51–02:00, mains): `done: ended=true beat=B13 game=662.3s
  wall=254s deaths=0`, 18 / 18 assertions, 0 console errors, 0 exceptions, load 39.6 s (B06 → B07 in 7.3 s: the ledger reads). The FINAL gate re-runs all of it on the final
  tree once the lane is DONE (scratch/final/gate.sh: + the lane's own scripts/qa/jumpscare.mjs on the same dist).
- Disk: 11 GiB free (rule ≥ 12): all my pre-dists deleted; the other ≈ 1 GB of dists are other lanes'.

## LEAD RULING (bf), 2026-10-20 04:32 — read before the final gate
FINAL-B (#154, docs/STATUS-final-b.md) has landed. It fixed R1-1, R1-2, R1-3 and R1-4, and refreshed the probes. TWO
user-visible items are left. FINAL builder: fix them FIRST, time-boxed to about 45 min in total, then run the final gate.
If one is not fixed in time, log it in STATUS and gate anyway.
1. R1-5, the C4a @10.03 dress-edge specks (Medium + Max).
   - Cause per FINAL-B: sub-pixel gaps along the dust sheet's silhouette ('dress_dummysheet', dust_sheet), through which
     the stroke-lit form inside shows (sheet hidden: 129 → 6 specks).
   - Cheapest fix: at load, shrink P_DRESS's non-sheet parts (the form) about 2–3 % about their own centre so they sit
     fully inside the sheet, or push the sheet out about 3 mm along its normals.
   - Check at C4a @10.03 on Medium and Max (same frame, before/after count).
2. R2-2, the U3 window brass reads as a small orange bar at night.
   - Cause per FINAL-B: brass_tarnished F0 is too saturated (avgAlbedo 0.42/0.30/0.12, b/r 0.29; real tarnished brass is
     about 0.46).
   - Fix it as a RUNTIME material override for brass_tarnished (de-saturate toward b/r ≈ 0.46, keep its luminance).
   - Do NOT edit material-spec.json: it feeds the probe key, so the shipped probes would go stale again.
   - Check the U3 window crop before and after.
The other bake findings (characters still take unclipped flicker light; Max u3-sw2 dotted edge) are accepted as known.

## FINAL builder — ruling (bf) work (started 04:31, time box ≈ 45 min → gate by ≈ 05:20)
- 04:30 JUMPSCARE LANE DONE line seen (lead, 04:29). g1 pre-gate results above stand as the jumpscare check.
- R2-2 brass (CODE, typecheck clean): `src/materials/albedo-check.ts` RUNTIME_BLUE_RED { brass_tarnished: 0.46 } +
  desaturateToBlueRed / runtimeAlbedo (same Rec.709 Y 0.3125; 0.42 / 0.30 / 0.12 → 0.3875 / 0.3038 / 0.1782, b/r 0.29 →
  0.46; the wear rule's polished brass is already 0.91 / 0.78 / 0.42 = b/r 0.46); `src/materials/bind.ts` baked path
  scales the per-channel gain by target / avgAlbedo (a uniform: same program), constant path uses the target.
  material-spec.json untouched (probe key). tests/runtime-albedo.test.ts 2 / 2. Contract row 153d. Check: u3-win crop
  before (r15a, dist 04:33 = current tree without this) / after (r15b).
- R1-5 C4a specks: r15a (Medium, scratch/final/diagc4a.mjs = FINAL-B's diag + variants formOff / sheetDOff / sheetFOff /
  shrink3 (form 0.97 xz, 0.985 y about its floor centre) / shrinkXZ / push3 / push6 (sheet along normals) + settles, CAPN 3)
  running — decides between the ruling's two fixes before any code.
- R1-5 RESULT (r15a / r15b, Medium, dist 04:33 = current tree before the brass edit, C4a @10.03, CAPN 3 captures averaged,
  every variant settled 30 frames; 0 console errors / exceptions; BATTERY → counts only). Dress-rect specks:
  | variant | specks | variant | specks |
  | settled base (7 samples) | 162–236 | formOff (every non-sheet P_DRESS mesh hidden) | 164 |
  | shrink3 (form 0.97 xz / 0.985 y about its floor centre) | 169 | shrinkXZ (0.97 xz) | 159 |
  | push3 (sheet +3 mm along normals) | 241 | push6 | 204 |
  | sheetDOff (DoubleSide primitive 'dress_dummysheet' hidden) | 95 | sheetFOff (FrontSide 'dress_dummysheet_1' hidden) | **13** |
  | shDS (dust_sheet shadowSide DoubleSide) | 173 | s1DS (sheet_1 DoubleSide) | 174 | both | 163 |
  ⇒ the ruling's premise is WRONG: the form inside is not what shows (hiding it changes nothing), so neither cheap fix
  (shrink the form / push the sheet) can work — measured, not applied. The dots ARE pixels of the FrontSide sheet primitive
  'dress_dummysheet_1' (+ some of the DoubleSide one), lit by the u3_window stroke (FINAL-B: stroke out of range → 37),
  sitting exactly on the sheet's silhouette (crop scratch/final/r15/c4a-crop.jpg: single white-blue pixels down both
  edges + a short bright hem line): a back-lit rim that is sub-pixel at the scene pass's resolution, rasterised as
  isolated dots and held by TAAU's thin-feature lock. Not shadow-side or cull-side. Not fixed by the ruling's
  two options. (A first gate start at 04:39 was stopped at once: time box not reached — clock 04:39, not 05:05.)
- R1-5 TRY (04:40, CODE, typecheck clean): `src/materials/bind.ts` softTerminator() on spec dust_sheet only — every direct
  light × smoothstep(0, 0.25, N·L) (diffuse + GGX + sheen; FINAL-B's grazing fade keyed on N·V, not N·L), QA uniform
  `materialUniforms.sheetTerm` (renderGroup; exposed as `__game.materialUniforms` in main.ts). A/B r15d (Medium, settled
  on/off pairs) + the brass after-check (u3-win) on the same dist (scratch/dist-final 04:40 = tree + both fixes).
- R1-5 TRY RESULT (r15d, Medium, dist 04:40, settled on/off pairs, 0 console errors): soft terminator on 177 / 160 / 159
  vs off 169 / 156 / 158 — NO effect → REVERTED (bind.ts softTerminator + sheetTerm uniform + the main.ts expose line
  removed; typecheck clean). **R1-5 NOT FIXED.** Ruled out now: the form inside, sheet offset, shadowSide / cull side,
  near-terminator direct light; FINAL-B ruled out normals, grazing view fade, BRDF / sheen, sharpen, CA, shadow bias.
  Left: the stroke light itself (distance 0.01 → 37) and the FrontSide sheet primitive (hidden → 13). Untested
  hypothesis for whoever continues: bright BACKGROUND (the stroke-lit window / wall) through sub-pixel coverage gaps
  where the FrontSide primitive meets the DoubleSide one along the silhouette (hide sheet_1 → the double part covers it).
- R2-2 RESULT (u3-win, Medium, pinned e 24; r15a before → r15d after, same view): orange px 32 → 38, bar mean rgb
  104/66/38 → 100/60/29, brass-rect warm 0.739 → 0.728 — NOT fixed by the F0 change. Runtime check (brassu.mjs): every
  brass_tarnished colorNode carries the new gain 0.9215 / 1.009 / 1.4843, so the change IS live; the bar's orange is
  the warm light the sash lock reflects (U3 reflection cube + probe grid, FINAL-B's reflection-only 0.36 of 0.745), not
  its F0. Override kept (real brass colour everywhere, lead-approved, harmless). Crop: scratch/final/r15/brass-ab.jpg.
- 04:46 → FINAL GATE g2 (scratch/final/gate.sh > gate2.out) on the tree with #153d only (the terminator reverted).
- **FINAL GATE g2 PASSED (04:45–04:53, FAILS=0; BATTERY 44 % → pass/fail only, no fps claims).** Tree fingerprint
  (build inputs) cf400c01e2b5 at the start = after the dist = at the end (nothing changed mid-gate). assets --check ok;
  typecheck rc 0; npm test 373 / 373 (+2 runtime-albedo); npm run build rc 0 + verify-boot OK (1 boot chunk, no three.js
  / game code, no modulepreload); scratch/dist-final built (KEPT for the reviewers); strict Medium playthrough
  `QA_STRICT=1 … --dist scratch/dist-final --preset medium --scenario scripts/qa/playthrough.mjs --name gate-medium`:
  **`done: ended=true beat=B13 game=556.2s wall=168s deaths=0`, 18 / 18 assertions, 0 console errors, 0 warnings,
  0 exceptions** (stills scratch/final/gate-medium-0*.jpg); js-medium / js-low (scripts/qa/jumpscare.mjs on the same
  dist) rc 0, 0 errors / exceptions, blacks Medium 3.30 ± 2.62 /255 (pure-0 0.13 %), Low 3.51 ± 2.96 (4.0 %); brass
  u3-win on the same dist: orange px 31, bar rgb 109/63/32 (before 32, 104/66/38) — unchanged, as logged.
- Brass look check (advisor; gate dist, Medium, porch under the torch, scratch/final/r15/blook-01-porch-brass.jpg, 0
  console errors): the bell-pull knob reads as warm tarnished brass / bronze under the 2900 K torch, not grey or dead →
  override KEPT. 04:56 tree fingerprint still cf400c01e2b5 (= the gated tree).

## STATE at 04:57 (FINAL builder done — restart: nothing to redo)
- Item 0 DONE: P_BED `box` (9 slice boxes) + P_NIGHTSTAND keeps `box` → B06 capsule JS 9.15 → 0.90 ms/frame (rows 153).
- Item 1 DONE: C2c stumble clip at 6.5 → Low 6.733 luma 0.0003 → 0.205, Medium 0.032 → 0.241 (row 153c).
- Item 2 DONE: renderGroup on the listed uniforms (+ uParlorBake, uLmScale, uHibeam); played vs jump lightning Δ within
  0.2–6 % on Max; write sites all frame / cue level (row 153b).
- Item 3 DONE by the JUMPSCARE lane's SCARE_FLOOR (no code from me); measured as played on the final dist: Medium
  3.30 ± 2.62 /255, Low 3.51 ± 2.96, animated per frame.
- Ruling (bf): R1-5 NOT FIXED (form shrink / sheet push / shadowSide / side / soft terminator: no effect, all reverted
  or never applied); R2-2 NOT FIXED — brass_tarnished F0 override live (row 153d), the U3 bar's orange is reflected light.
- FINAL GATE g2 PASSED on cf400c01e2b5 (04:53): B13, 18 / 18, 0 console errors / warnings / exceptions; npm test 373;
  verify-boot OK; scratch/dist-final KEPT. Everything on battery (no fps claims this round).

## FINAL FIXER (round after the reviewers), started 05:50 2026-10-20 — BATTERY 12 % discharging at start
Findings to fix (reviewer ids): R1-5/F1 (C4a dress-sheet specks), MAX-BLUR (Max cutscene blur = discrete copies),
JS-FACE (face not photoreal — Blender re-render), C2C-3667 (one black frame at the glance), MED-WHIPS (unblurred whips
beyond head speed on Medium/Low), F2 (C4 wardrobe visit near-black). Gate after: typecheck, npm test, build, strict
Medium playthrough on scratch/dist-final-2 → B13, 0 console errors.
- 05:55 ROOT CAUSE R1-5/F1 (read from the asset + generator, no run): 'dress_dummysheet_1' is NOT a second sheet layer —
  it is the ROLLED HEM: blender/props/textiles.py hem_edges(sh, …, 'dust_sheet', edges=('v1','u0','u1')) = tubes of
  r 2 mm (4 mm wide) along the sheet's bottom + both vertical edges (props_m2.glb mesh 40 prim 1 'dust_sheet', 1560
  tris; prim 0 = the 40×44 grid 'dust_sheet@2s'). Those edges ARE the silhouette edges + the hem line in the C4a
  shot. At the C4a camera (≈ 4.9 m from P_DRESS) a 4 mm tube is ≈ 0.4 internal px on Medium: a back-lit round tube
  (radial normals see the stroke 1.6 m behind) rasterised as isolated dots and held by TAAU. That is why material
  swaps / grazing fades / the form / sheet offsets never mattered and hiding sheet_1 → 13.
  PLAN: sub-pixel LOD in runtime (level.ts): draw the hem tubes only when the eye is within ~1.3 m of the sheet
  (where 4 mm ≥ ~1.5 px); the grid's own edge carries the silhouette beyond. No asset change.
- PLAN MAX-BLUR: replace r186 motionBlur() (16 fixed taps) with a per-pixel IGN-jittered (frameId · 0.618) stratified
  blur, 24 taps, textureSampleLevel, velocity span clamped (off-screen edge clamp = the dip suspect).
- PLAN MED-WHIPS: give Medium the (fixed) cutscene blur (presets medium.post.cutsceneMotionBlur true) — the reviewer's
  alternative; Low is pipeline 'direct' (no post chain) → stays as is (logged).
- JS-FACE: Blender re-render — NOT attempted tonight (battery 12 %, one Blender at a time, hours of work). Logged.
- 06:00–06:08 CODE (typecheck clean; mains power from 06:0x — "charging"):
  - #153e R1-5/F1 `src/world/level.ts` hemLodOf() + Level.hemLod (per frame in updateWindowCull: the hem tubes
    'dress_dummysheet_1' visible only when the eye is < HEM_LOD_M 1.3 m from their world AABB).
  - #153f MAX-BLUR `src/render/pipeline.ts` jitterBlur(): 24 stratified taps, IGN(screenCoordinate) + frameId·0.618
    start jitter, span = velocity × 0.25 (NDC→uv × 180° shutter; r186's pass used velocity × 1 = 2 frames of motion),
    clamped to 0.3 uv, textureSampleLevel. `?mbjit=0` = the old pass.
  - #153g MED-WHIPS `src/render/presets.ts` medium.post.cutsceneMotionBlur true (C2c whipD becomes 0.65 on Medium,
    as Max; C4a's 8–10.95 dolly blur 0.6 now on Medium too).
  - #153h F2 `src/cutscenes/c4-hem.ts` C4_HIDE_LM 15 → 40 (boards ≈ 0.02 lux), τ in/out 1.6/1.2 → 2.2/1.6 s (≤ 6/8 %
    per frame, tests/smooth-fix.test.ts).
  - C2C-3667: NOT changed. Offline pose sampling (scratch/final/fx/c2cpose.ts): 3.633 heading 73° pitch 9° (lit
    flight) → 3.667 15° / −4° (east across the unlit hall, 59° in one 1/30 frame) → 3.700 −18° / −23° → patch at −60° /
    −45°. The 150° turn must cross ≈ 75° of hall that neither the held torch (on the flight) nor the fanlight stroke
    (0.53 of peak at 3.667) lights; any ease puts a 30 fps frame there (inOut moves it to 3.733). Needs a re-block
    (torch follows the head, or a light source east) — not done tonight.
- 06:08 q1 queued (scratch/final/fx/q1.sh → q1.out): dist-fx1; C4a@10.03 Medium + Max (base = LOD on, hemOn = LOD off,
  settled); C2c Max 0–0.4 / 6.6–6.9; C2 19.9–20.3 + C2c glance / stumble / turn-back windows Medium; C4 visit Medium.
- npm test on the tree (06:10, while q1 built): 372 / 373 — arms-pullback "walking at a wall … pool strays 3.2 cm"
  failed once under load; alone it passes 13 / 13 twice (no file of mine is in its imports). Re-run in the gate.
- **R1-5 / F1 RESULT (q1, dist-fx1, C4a @10.03, same run, same frame; CAPN 3; 0 console errors / 0 exceptions):**
  | tier | hem LOD on (base / +settle / +settle / +settle) | hem forced on (settled) | eye → hem AABB |
  | Medium | 23.7 / 13 / 4.3 / 14.7 | **198** | 2.86 m |
  | Max | 43.7 / 17.7 / 4.7 / 12.3 | **191.7** | 2.86 m |
  (reviewers' settled base on the gate dist: 162–236.) Crop (ONE image, left hem on, right LOD):
  scratch/final/fx/c4a-med-hem-ab.jpg — the dotted right edge and left-edge dots are gone; left: one dot on the window
  muntin edge and a thin CONTINUOUS faint line at the lower-left hem (the grid's own edge / the satin hem below; reads
  as a rim, not lights). FIXED.
- 06:15 MAX-BLUR check 1 (q1 c2c-max, cs-frames 1/30, dist-fx1): frames show NO smear at all (C2c 6.767 = a 55°/frame
  yaw: balusters crisp; scratch/final/fx/c2c-max-blur.jpg + c2c-max-zoom.jpg) → my pass was inert. Suspect: span from
  the RGBA velocity attachment's vec4 length (its padding). CODE: span from velocity.xy only. q2 (dist-fx2): direct C2c
  probe scratch/final/fx/mbprobe.mjs — Max new / Max `?mbjit=0` (old pass, validates the probe) / Medium new.
- C2C-3667 as played on dist-fx1 (Medium, now WITH the cutscene blur → whipD 0.65; cs-frames 1/30, detect.py luma):
  3.6 0.060 · 3.633 0.068 · **3.667 0.0005** · 3.7 0.0044 · 3.733 0.0057 · 3.767 0.0023 · 3.8 0.0011 · 3.833 0.0006 ·
  3.867 0.0010 · 3.9 0.0028. Unchanged (as predicted): 3.667 is as dark as the glance's own frames (3.833 0.0006) —
  the lit flight → the near-black glance-back with one darkest frame first. NOT FIXED (needs a re-block, see above).
  C2c stumble 6.5–7.0 on Medium: 0.034 … 0.145–0.241, no dip (item 1 holds).
- MAX-BLUR check 2 (q2, dist-fx2, direct C2c play stepped 1/30, scratch/final/fx/mbprobe.mjs): my pass STILL crisp
  (scratch/final/fx/mb-max-new.jpg) while `?mbjit=0` (the old r186 pass, same dist) shows the reviewer's ghost copies
  (scratch/final/fx/mb-max-old.jpg) → the probe is valid, my pass inert. ROOT CAUSE (read in r186): PassTextureNode.clone()
  (PassNode.js:69) = `new this.constructor(this.passNode, this.value)` — it DROPS uvNode, and TextureNode.level() clones,
  so `.sample(uv).level(0)` sampled the pixel's own uv 24×. CODE: plain `.sample(uv)` (as r186's pass, inside the
  uniform amount If). q3 (dist-fx3) re-checks Max + Medium.
- **F2 RESULT (q1, dist-fx1, Medium, played route --beat B09, cs-frames FPS 2; 0 console errors / 0 exceptions):**
  frames with max(RGB) ≤ 1/255 and the 8-bit mean (scratch/final/fx/dark.py), same phases as the reviewer's m1 run on
  the gate dist (× 15): C4_hem start 80.9 % / 0.77 → 62.0 % / 2.47; C4_look start 80.4 % / 0.79 → 60.1 % / 2.95;
  approach end 62 % / 3.38 (×3.2–3.7 in display mean = the 2–4× the reviewer said was missing). Strip:
  scratch/final/fx/c4-visit.jpg (approach end, hem, look): the slats, the lit gaps (window, dress) and Ada's warm face
  read; it is STILL a very dark shot (60 % of pixels ≤ 1/255) — at its written target, not bright. Honest: improved
  to target, a real U3 night bake (lane A) is still the proper fix.
- **MAX-BLUR RESULT (q3, dist-fx3 = the uv fix, IGN jitter; direct C2c stepped 1/30 → velocity = 2× a 60 fps frame's;
  0 console errors / exceptions):** Max 0.233 / 0.3 / 6.733 / 6.767 now SMOOTH directional smears — no repeated copies,
  no venetian-blind balusters (scratch/final/fx/mb-max-fx3.jpg vs the old pass on the same probe mb-max-old.jpg). 1:1
  crop (mb-max-fx3-zoom.jpg): IGN's structure left a fine diagonal cross-hatch in the smear (no TAA after this pass)
  → CODE: start jitter = Hoskins' sine-free hash12 of the pixel + a frameId offset (white noise = film-grain-like).
  Re-checked in the gate (mb-max on dist-final-2). Brightness dip at 6.733–6.783 not re-measured (no real-time 60 fps
  run this round).
- **MED-WHIPS RESULT (q3, Medium, same probe):** C2c 0.3 / 3.7 / 6.767 / 7.567 are smeared like Max
  (scratch/final/fx/mb-medium-fx3.jpg) — no more stop-motion whips on Medium. C2 20.0–20.2 uses the same chain (blur 0.8
  cue) — not separately imaged. Low: unchanged (no post chain) — still unblurred whips on Low.
- 06:29 GATE g3 started (scratch/final/fx/gate3.sh > gate3.out, dist scratch/dist-final-2, tree 9f165e1af941, mains).
- **FINAL GATE g3 PASSED (06:29–06:39, FAILS=0, MAINS (charging 47 %)):** build-input fingerprint 9f165e1af941 at the
  start = after the dist = at the end. assets --check ok; typecheck rc 0; npm test **373 / 373**; npm run build rc 0 +
  verify-boot OK (1 boot chunk, no three.js / game code, no modulepreload); scratch/dist-final-2 built (KEPT); strict
  Medium playthrough `QA_STRICT=1 … --dist scratch/dist-final-2 --preset medium --scenario scripts/qa/playthrough.mjs`:
  **`done: ended=true beat=B13 game=546.33s wall=231s deaths=0`, 18 / 18 assertions, 0 console errors, 0 warnings,
  0 exceptions, 0 stalls, load 26.8 s** (stills scratch/final/fx/gate/gate-medium-0*.jpg); Max C2c whip probe on the same
  dist rc 0, 0 console errors (1:1 crop scratch/final/fx/mb-max-gate-zoom.jpg: the cross-hatch is gone — a smooth smear
  with fine random grain at high-contrast smear edges, film-like; a harsh AD may still call the edge grain visible at
  1:1); js-medium (scripts/qa/jumpscare.mjs, the catch path with Medium's new blur chains) rc 0, 0 errors / exceptions,
  0 FAIL lines.

## STATE at 06:40 (FINAL FIXER done — restart: nothing to redo; the lead ships)
| finding | status | before → after | evidence |
|---|---|---|---|
| R1-5 / F1 C4a dress specks | FIXED (root cause: the sheet's 4 mm rolled-hem tubes, sub-pixel; LOD) | Medium 198 → 4–24, Max 192 → 5–44 (same run, hem forced on vs LOD) | fx/c4a-med-hem-ab.jpg, q1 logs |
| MAX-BLUR ghost copies | FIXED (jittered 180° shutter, 24 taps; the PassTextureNode clone trap found + avoided) | discrete copies → smooth smear + fine grain | fx/mb-max-old.jpg vs mb-max-fx3.jpg, mb-max-gate-zoom.jpg |
| MED-WHIPS | FIXED on Medium (blur chain on); Low NOT (no post chain) | unblurred 1,400–1,700°/s whips → smeared | fx/mb-medium-fx3.jpg |
| F2 C4 visit near-black | IMPROVED to its written target, still a very dark shot | ≤ 1/255 px 80 % → 60 %, mean 0.79 → 2.95 | fx/c4-visit.jpg |
| C2C-3667 black frame | NOT FIXED (needs a re-block: the 150° turn crosses ≈ 75° of unlit hall) | 3.667 luma 0.0005 (unchanged) | q1 c2c-medium detect |
| JS-FACE photoreal face | NOT FIXED (Blender re-render; not attempted tonight) | — | reviewer js-held.png |
Unmeasured this round: Medium / Max fps in the blur windows (24 taps on the whip frames only; amount-0 frames are one
tap) and Medium's extra C2 DOF+MB pass; the 6.733 two-frame brightness dip in real time.
- 06:45 post-gate review: Low's sheet is 'dress_dummy.sheet_low' (public/assets/low/props_m2.glb) → its hem primitive is
  'dress_dummysheet_low_1': my /dummysheet_1$/ missed it (Low would have kept the specks + logged a console.warn every
  load; the Medium gate could not see it). CODE: /dummysheet(_low)?_1$/, the not-found log → console.info. Tree changed
  → gate g4 (scratch/final/fx/gate4.sh): full gate on a fresh dist-final-2 + WebGL2 Medium C2c blur probe (the new post
  graph had never compiled under GLSL) + hemcheck Medium / Low (primitive found; builds caused by the hem's first draw
  at ≈ 0.95 m — it is hidden from the first frame, so its first draw happens in play).
- **FINAL GATE g4 PASSED (06:42–06:53, FAILS=0, mains) — THIS is the shipped state (supersedes g3):** build-input
  fingerprint cdb826912ee9 at the start = after the dist = at the end. assets --check ok; typecheck rc 0; npm test
  **373 / 373**; npm run build rc 0 + verify-boot OK; **scratch/dist-final-2** rebuilt (KEPT); strict Medium playthrough
  **`done: ended=true beat=B13 game=670.53s wall=219s deaths=0`, 18 / 18 assertions, 0 console errors, 0 warnings,
  0 exceptions, 0 stalls, load 24.8 s**. WebGL2 fallback (`--backend webgl`, Medium, C2c whip probe): backend=webgl2,
  0 errors / warnings, the blur renders as the same smooth smear under GLSL (scratch/final/fx/webgl-hem.jpg left).
  hemcheck: Medium 'dress_dummysheet_1', Low 'dress_dummysheet_low_1' found; hidden at 5.16 m / 2.67 m, shown at 1.07 m;
  **0 node builds** on the hem's first draw (shares the dust_sheet program); 0 errors / warnings on both tiers.

## STATE at 06:53 (FINAL FIXER done — restart: nothing to redo; dist = scratch/dist-final-2 @ cdb826912ee9)
See the table at "STATE at 06:40" (unchanged verdicts) — plus: R1-5's LOD now also covers Low. Still open: C2C-3667
(re-block), JS-FACE (re-render), Low's whips (no post chain), fps in the blur windows unmeasured, the 6.733 real-time
brightness dip not re-measured, the death rush's one-frame swing before the face cut (death.ts, not touched).
