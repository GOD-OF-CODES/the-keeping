# STATUS — POLISH builder (runtime lane B + UI), round after the 2026-10-20 08:36 release (92d9e60)

Items (ROADMAP ruling (bg), biggest first): (1) motion-blur HDR highlight clamp + Medium blur back on; (2) C4 wardrobe
visit near-black → motivated moon key; (3) C2c 3.667 black frame; (4) F5 locket toast over the subtitles; (5) F3
hide-exit pink frame + F4 black B06 frame (careless); (6) R1-5 remainder (only if quick). Then typecheck, npm test,
build, assets --check, ONE strict Medium playthrough on scratch/dist-polish. Contract rows #156, 156b …
Scratch: scratch/polish/. Mains power at start (pmset: AC, 100 %).

## Log
- start (read): STATUS-final (FINAL FIXER #153e–h), rv/rv2 NOTES (MAX-BLUR residual = sparse dotted HDR trails;
  NEW-MED-TRAILS), ROADMAP (bg). Code read: pipeline.ts jitterBlur, presets.ts, c4-hem.ts, bindings.ts tickHideLm,
  lights.ts (U3E lightning spot exists on tiers without flash maps only), c2c-up.ts glance shots, main.ts toast + hide
  torch handling, exposure.ts.
- CODE (typecheck clean), queued as dist-p1 (scratch/polish/q1.sh → q1.out):
  - #156 item 1 `src/render/pipeline.ts` jitterBlur: per-tap luminance-preserving clamp to MB_CLAMP_K 6 × the span's
    local level (log-average display luminance of 8 pilot taps along the same span); `?mbclamp=0` = the #153f pass.
    `src/render/presets.ts` Medium `post.cutsceneMotionBlur` true again (#153g-r undone).
  - #156b item 2 `src/world/lights.ts` U3_MOON: the U3 window's lightning spot (L_LTN_U3E, 1.1 m outside O_U3_E) carries
    a steady moon-window key, 0.2 cd at 7500 K (0.03 lux at Ada by the dress, the top of the 0.003–0.03 lux range),
    driven by `bindings.ts` tickHideLm with the hide lift's own ease (0 on the exit cut). Max (flash lightmaps, no
    lightning spots) gets this one spot for the key only (peak 0). `?u3moon=0` = off.
  - #156d item 4 `src/game/main.ts` makeToast: keeps 12 px above the on-screen subtitle cue (re-placed every 100 ms).
  - #156e item 5/F3 `src/render/exposure.ts` restore(ev) + `src/world/atmosphere.ts` hideCut(): out of a hide the eye
    starts from its pre-hide EV (same room, same torch state) and snaps to the first post-exit reading; `?hidecut=0` = off.
  - probes written: scratch/polish/c2cview.mjs (C2c 3.667 view-sphere luminance), hidexit.mjs (F3 exit frames),
    gp-frames.mjs (every frame of a gameplay beat window on the played route — for F4 careless B06).
- q1 RESULTS (dist-p1, Medium unless noted, 0 console errors / 0 exceptions in every run):
  - item 1 first try (6 × log-average of 8 jittered pilot taps): the bodice's white glitter streaks are gone, BUT the
    pilot's own hit-or-miss stippled the edges of every bright smear (scratch/polish/mb-med-ab-crop.jpg, left off / right
    on; also NOT a same-state pair — two loads gave different C2c frames). REPLACED (see below).
  - item 2 C4 visit (cs-frames C4 FPS 2 --beat B09, same bot frames as rv2's c4-medium): mean 8-bit 2.46–3.98 → 7.08–7.88,
    ≤ 1/255 px 60–62 % → 47–50 % (frames 10/20/26/27/33/40/44/47). Sheet scratch/polish/c4-ab-1.jpg (top rv2, bottom
    p1). FINDING: the hide's default view looks due SOUTH (heading −90°, fov 70 → −42…−138°); the dress (−28°), the
    window (−23°) and Ada at the dress (−35°) are OUTSIDE it — the player must turn left (LOOK_YAW 0.55 rad) to watch
    her. The bot never turns: rv2's c4 numbers measured the sheeted furniture on the south wall. Re-check with the view
    turned (XROW sets hides.dyaw 0.5) at u3moon 0 / 0.2 / 0.5 (q2).
  - item 5/F3 first probe (H_ARMOIRE at B05) did NOT reproduce: the torch stayed on inside (rig.on true, no snap) —
    the B05 armoire is story-scripted. F3 is the careless route's exit from Ada's wardrobe (rose wallpaper → "pink"
    at e 24). Re-probe H_ADA_WARDROBE at B09 (q2).
  - item 3 view-sphere at C2c 3.667 (eye fixed, world frozen, mean 8-bit): (15°, −4°) as played 1.1–1.7 · (15°, −20°) 8.7
    · (15°, −35°) 14.1 · (30°, −25°) 11.9 · (45°, −20°) 10.7 · (0°, −30°) 7.9 · (−18°, −23°) 6.6 → pitching down lights it.
- CODE 2 (typecheck clean):
  - #156 jitterBlur now FIREFLY REJECTION BY COUNT: pass 1 over the 24 taps = Σ luminance + the two largest; trimmed
    mean (2 brightest dropped) × MB_CLAMP_K 8 = the cap; pass 2 = the same taps clamped to it (luminance-preserving).
    A glint narrower than the 16 px stride hits ≤ 1 tap per pixel → clamped to 8 × local; a patch hit by ≥ 3 taps sets
    the trimmed mean itself (no new edge noise). QA uniform `__game.pipeline.mbClamp` (same-session A/B, mbab.mjs).
  - #156c `src/cutscenes/c2c-up.ts` glance turn: mid-turn waypoint pitch −0.2 → −0.6 rad (offline poses at 60 Hz:
    3.650 (52.8°, −10.9°), 3.667 (27.1°, −24.0°), 3.683 (6.0°, −31.9°); was (42.6, 3.4) (15.4, −4.2) (−3.8, −12.7);
    peak step 27°/frame (was 28°), pitch settles monotonically onto g1Target).
  - `?u3moon=<cd>` QA override of the moon key; `__game.toast` (QA).
- q2 item 3 RESULT (dist-p2, Medium, direct C2c stepped 1/60, mean 8-bit): 3.617 43.8 · 3.633 55.6 · 3.650 25.6 ·
  **3.667 16.1** · 3.683 11.3 · 3.700 9.4 · 3.717 10.4 · 3.733 11.8 · 3.750 11.9 — a monotone fall into the glance's
  own level, no black frame (before: 3.667 ≈ 1, luma 0.0005). Strip scratch/polish/gl-strip.jpg: lit flight → smear
  over the near balusters (blue) → the hall's warm glow → the patch with her silhouette; still reads as a fast glance.
  Played-route re-check in the final queue.
- q2 note: mbab.mjs v1 (replay the scene for clamp off) was NOT same-state (Ada / handheld differ on a replay). v2
  re-renders the SAME frame with the clamp off (no node-frame advance: the camera's previous matrix is kept).
- q2 item 4/F5 RESULT (dist-p2, Medium --beat B09, scratch/polish/toast.mjs, the letter's 3-line cue + `toast('Locket')`):
  A (reading on screen, then the pickup): cue box y 626–744, toast y 591–614 → overlap 0 px (release: the toast at
  bottom 14 % = y 665–688, INSIDE the cue box by 62 px). B (toast first, then the cue starts): the toast slides up
  within 100 ms to y 591–614, overlap 0. Crop scratch/polish/toast-ab.jpg. DONE.
- q2 item 2 turned view (XROW hides.dyaw 0.5 → heading −61.4°; frames 10/20/27/40/44, mean 8-bit): moon key off
  1.2–2.3 (75–82 % ≤ 1/255) · 0.2 cd 3.9–5.2 · 0.5 cd 6.8–9.1. Sheet scratch/polish/c4t-sheet.jpg (rows off / 0.2 / 0.5).
  GEOMETRY: the dress (−27.6°) and the window (−23°) sit behind the wardrobe's own east side (its front corner is at
  −28.8° from the eye) — they cannot be seen from inside the hide at any allowed yaw. What the player sees is Ada
  crossing the room toward the dress (approach), the floor and the sheeted shapes, and Ada at the slats (look). So the
  key's reference point is the part of the room in view, ≈ 5 m from the window: 0.2 cd gives 0.008 lux there — under
  the range. Next: 0.6 cd (0.025 lux at 5 m, inside 0.003–0.03), default + turned view (q3).
- q2 item 5/F3 (H_ADA_WARDROBE at B09, torch on before; hidexit.mjs): REPRODUCED in both runs — the exit frames blow
  out to mean 96–113 of 255 for 9 frames then fall over 1.5 s; the eye reads e 24 on the first exit frame. My restore
  did NOT fix it (x00 5.4 then x01 104): inside the hide the reported exposure stayed at the pre-hide 0.17–0.19 for 5 s
  while the frame was black, and jumped to 24 on the exit frame — the meter is doing something I do not understand
  yet. Debug probe hxdbg.mjs queued (q3).
- CODE 3: `exposure.ts` restore() v2 — no re-snap (the first post-exit frame can still show the torch coming up; a snap
  to it put the eye back at the ceiling): drops every reading issued before the exit (cutAt), cancels a pending snap,
  resets the noise gate, next reading in 0.125 s. `lights.ts` U3_MOON_CD 0.2 → 0.6 cd (0.024 lux ≈ 5 m from the
  window, the part of U3 the hide can see). `level.ts`: on Max (moon-only spot, peak 0) the spot is kept OUT of the
  house props' LightsNode — only dust_sheet / wedding_satin materials get a node with it (+ the U2/U3 atlas via forRooms
  and the characters' spot pool, on every tier); Medium / Low unchanged (it is their lightning spot already).
- q3 item 5/F3 RESULT (dist-p3 = restore v2; H_ADA_WARDROBE at B09, torch on before, hidexit.mjs, mean 8-bit of the
  45 frames after the exit): 5.55 · 5.53 · 5.51 · 5.44 … 4.88–5.41 (= the pre-hide view 5.65), exposure 0.198 → 0.180
  smoothly. Release behaviour on the same probe (q2 hx-ward-off, `?hidecut=0`): 96 · 103 · 108 · 110 · 112 · 112 ·
  113 · 112 · 113 · 101 · 92 · 82 … 48 at 0.53 s (e 24 → 0.26 over 1.5 s). FIXED. (Probe artefact noted: with the loop
  stopped and the probe stepping inside one eval, meter readings land late — the eye never adapted INSIDE the hide in
  these runs; real-time play adapts there, and the exit restore is the same either way.)
- q3 item 2 RESULT (dist-p3, 0.6 cd, Medium, the played bot's C4 visit, same frames, mean 8-bit / ≤ 1/255 px):
  default view (south) off (`?u3moon=0`) 1.9–3.7 / 60–66 % → 0.6 cd 11.6–15.6 / 43–44 %; turned view (dyaw 0.5)
  off 1.2–2.3 / 75–82 % (q2) → 7.7–10.3 / 58–61 %. Sheets scratch/polish/c4d-sheet.jpg (top off, bottom 0.6;
  approach 5.4 / 7.4 s, look 0.23 / 2.23 s), 1:1 look crop scratch/polish/c4-look-1to1.jpg: with the key the room
  behind the slats (wall, boards, sheeted shapes) reads cool blue in every gap and Ada at the slats is a modelled
  figure against it (moonlit gown and shoulders, her head lit from the window side); without it, warm fragments on
  black. Still a DARK shot (≈ 15/255 mean) — honest: it reads, it is not bright.
- q3 item 3 played route (cs-frames C2c 3.4–4.03, Medium, 1/30, mean 8-bit): 3.600 43.7 · 3.633 58.6 · **3.667 13.8** ·
  3.700 8.8 · 3.733 9.3 · 3.767 4.1 · 3.800 2.2 · 3.833 1.6 … (the glance's own silhouette-on-the-patch frames are
  1.6–2.9, as before by design). The isolated black frame is gone. DONE.
- item 1 visual (1:1, not same-state — the same-frame re-render loses the velocity, so the clamp-off half of mbab v2 is
  unblurred and invalid): Max t 0.2 before (q1 `?mbclamp=0`) bright white dotted streaks over her bodice → after (q2,
  trimmed clamp) soft faint streaks, no glitter (scratch/polish/max-blur-before-after-1to1.jpg); Medium the same
  (scratch/polish/med-blur-before-after-1to1.jpg). Medium stumble 6.733–6.8 and C2 20.03–20.17: smooth smears, no stop-
  motion (scratch/polish/med-blur-stumble-c2.jpg). Residual (pre-existing #153f): a fine sandy grain where a smear
  crosses a hard white/black edge (6.767 balusters), now on Medium too.
- q3 item 5/F4 DIAGNOSIS (dist-p3, QA_CARELESS=1 from title, every bot frame of B05's last 1 s + B06's first 5 s,
  scratch/polish/q3/b06/GP-0, rows.json): B06 starts at bot 214.27 s (the reviewer's black strip frame was B06 + 1 s);
  frame 59 (bot 215.233) is the isolated black frame: mean 0.21 of 255 between 0.54 and 19.5 — the bot turned the view
  98° in ONE 1/30 s frame (heading 105.9° → 7.9°, eye still), the torch rig's 70 ms rotational lag left the beam 62°
  behind (row `tl`), and nothing else in U2's dark east half is lit at the eye's e 0.08. Same class: frame 71 (43° snap,
  1.0 → 14.5), 222 (~170° snap, 11.1 → 0.75 → 15.4), 238. Not a render / culling / exposure bug: draws 453 / 1.79 M tris,
  torch on 2020 cd, no hide, no lightning. CODE #156f `src/player/flashlight-rig.ts`: the hand never trails the gaze by
  more than RIG_LAG_MAX 15° (lag = ω·70 ms → acts only above ≈ 210°/s: flicks and the bot's snaps). arms-pullback 13/13,
  hand-inertia pass. Re-check on the final dist.
- npm test on the q3 tree under load (Chrome running): 372 / 373 — the known flaky arms-pullback "walking at a wall …
  pool strays 3.2 cm" (fails at baseline too under load; alone 13 / 13).
- 09:3x calm machine (no Chrome), final tree: `npm run typecheck` rc 0; `npm test` **373 / 373**; `npm run build` rc 0 +
  verify-boot OK (1 boot chunk, 12.7 kB gz, no three.js / game code, no modulepreload); `node scripts/assets.mjs
  --check` ok. Contract rows #156, 156b–156f written (docs/CONTRACT-CHANGES.md).
- q4 queued on scratch/dist-polish (the final tree; scratch/polish/q4.sh → q4.out): F4 careless B06 recheck, Max C4
  key on/off, WebGL2 blur probe, the strict Medium gate, real-time C2 → C2c Medium + Max.
- q4 item 5/F4 RESULT (dist-polish, careless from title, B05 −1 s … B06 +5 s, every frame; 0 console errors): 7 view
  snaps of 33–172° in one frame — the snap frame is lit every time (27.0 · 7.2 · 6.6 · 14.8 · 10.3 · 5.6 of 255;
  before: 98° snap 0.54 → **0.21** → 19.5). No isolated black frame (none < 0.4 × both neighbours). Remaining dark
  stretches (≈ 1–2 of 255 for 10–20 frames) are the eye adapted to a close torch-lit wall (e 0.06) turning into the
  unlit room — the eye's 6 s brightening, not a pop. FIXED (the black frame); the dark stretch is unchanged by design.
- q4 item 2 Max (dist-polish, cs-frames C4 FPS 2 --beat B09, same bot frames, 0 console errors / 0 warnings /
  0 exceptions both runs): key off (`?u3moon=0`) mean 1.9–4.2 / 59–66 % ≤ 1/255 → key on 13.3–18.4 / 40–46 %. Sheet
  scratch/polish/c4-max-ab.jpg (left off, right on; approach 7.4 s, look 0.23 s): the room behind the slats reads as
  cool moonlit wall, boards and sheeted shapes on Max too (the moonNode path for dust_sheet works).
- q4 WebGL2 fallback (`--backend webgl`, Medium, direct C2c 0.2 / 0.233 / 6.767): backend=webgl2, 0 console errors /
  0 exceptions; the two-pass clamped blur compiles under GLSL and renders the same smooth smears
  (scratch/polish/mb-webgl.jpg).
- **q4 STRICT MEDIUM GATE PASSED (09:45–09:50, mains, dist scratch/dist-polish = build fingerprint 52cfe3842078,
  `git diff HEAD -- src scripts index.html vite.config.ts package.json | shasum`):**
  `QA_STRICT=1 node scripts/shot.mjs --no-build --dist scratch/dist-polish --preset medium --timeout 2400 --scenario
  scripts/qa/playthrough.mjs --out scratch/polish --name gate-medium` → `done: ended=true beat=B13 game=549.3s wall=178s
  deaths=0`, 18 / 18 assertions, 0 console errors, 0 warnings, 0 exceptions, 0 stalls (scratch/polish/gate-medium-*.jpg,
  gate-medium-report.json; log scratch/polish/q4/gate-medium.log). scratch/dist-polish KEPT for the reviewer.
  Load 139.2 s — NOT the code: same builds / programs as the release gate (phase=story 660 / 464; the release gate
  25.5 s and this dist's own b06 run 25.3 s), every phase 6–14× slower incl. "warm U3 5342 ms builds=0"; macOS was
  busy (mobileassetd, triald, CacheDelete `deleted`, mds at 30–66 % CPU; disk 94 % full, 13 GB free). Deleted my
  scratch/dist-p1..p3 (650 MB).
- q4 real time C2 → C2c → B05 (scratch/smooth-perf/c2rt.mjs, mains, dist-polish; the busy-macOS caveat above):
  Medium: C2 1737 fr 59.9 fps, 3 > 20 ms (max 33.5); **C2c 835 fr 60.0 fps, 0 > 20 ms** (all five blur windows clean);
  play:B05 0 > 20 ms (rv2 on the release-era dist: C2 30 > 20 ms, C2c 1). Max: C2 59.9 fps, 3 > 20 ms; C2c 832 fr
  59.8 fps, 1 > 20 ms = ONE 66.6 ms frame at C2c 8.83 (U1 landing, not a blur window; 0 node builds, 0 pipelines,
  JS 0.8 + 3.3 ms — a GPU/compositor miss, unattributed; rv2's Max C2c had 0). Not measured: Max U2/U3 gameplay fps
  with the moon spot in the LM_UPPER_ROOMS light list; Low at all.

## RESULT (POLISH builder, 09:56) — restart: nothing to redo; dist = scratch/dist-polish @ 52cfe3842078
| item | status | before → after | evidence |
|---|---|---|---|
| 1 motion-blur glitter trails; Medium blur back on | DONE (Medium + Max) | white dotted streaks over her bodice at C2c 0.2 → faint continuous streaks; smooth smears at 6.73–6.8 and C2 20.03–20.17; WebGL2 same | polish/max-blur-before-after-1to1.jpg, med-blur-before-after-1to1.jpg, med-blur-stumble-c2.jpg, mb-webgl.jpg |
| 2 C4 wardrobe visit near-black | IMPROVED (Medium + Max) — reads, still a dark shot | mean 8-bit 1.9–4.2 → 11.6–18.4, ≤ 1/255 px 60–66 % → 40–46 % (default view); turned view 1.2–2.3 → 7.7–10.3 | polish/c4d-sheet.jpg, c4-look-1to1.jpg, c4-max-ab.jpg |
| 3 C2c 3.667 black frame | DONE | 3.667: ≈ 1 → 13.8 (played route), 16.1 (60 Hz direct); monotone fall into the glance | polish/gl-strip.jpg, q3/c2c-gl |
| 4 F5 locket toast in the subtitle panel | DONE | overlap 62 px → 0 (both orders) | polish/toast-ab.jpg |
| 5 F3 hide-exit pink-white frames | DONE | exit frames 96–113 / 255 for 9 frames → 4.9–5.6 (= the pre-hide view) | q2/hx-ward-off vs q3/hx-ward |
| 5 F4 black B06 frame (careless) | DONE (the black frame) | 98° snap: 0.54 → 0.21 → 19.5 → every snap frame lit (5.6–27) | q3/b06 vs q4/b06 |
| 6 R1-5 hem line / window-frame specks | NOT ATTEMPTED (not quick) | — | — |
Gate: typecheck rc 0 · npm test 373 / 373 · build + verify-boot OK · assets --check ok · strict Medium playthrough on
scratch/dist-polish B13, 18 / 18, 0 console errors / warnings / exceptions / stalls.

## POLISH FIXER (findings F1-careless-gate-156f, F2-c2c-4583-black) — scratch/polish/f1, scratch/polish/f2
- start (read): reviewer NOTES above; flashlight-rig.ts #156f clamp, story-runtime beamView(), playthrough.mjs careless
  glance (aim needs feet distance 6.2–9.5 m; glanceDone = 15 cone frames or 1 beam LOOK at ≥ 6 m), c2c-up.ts 4.47 sweep.
  Mains (AC 100 %). Tree = scratch/dist-polish fingerprint 52cfe3842078 (unchanged at start).
- F1 diagnosis queued: scratch/polish/f1/car-diag.mjs (the careless bot + a per-frame B05/B06 trace: task, her state /
  look phase, distances, beam-to-chest angle, rig lag; stops at B07) on dist-polish and dist-release.
- F1 DIAGNOSIS (scratch/polish/f1: diag-pol / diag-rel per-frame B05 traces, diag2-pol = the beam AS THE BRAIN SAW IT,
  via a wrapper on director.host.player): the careless run is identical through the armoire exit (205.1 unhide, both
  runs). Then the bot's `upper-hall-ada` HERO SHOT fires (node side: `aim(her) + advance(1, 1/30)`, a screenshot pose,
  no bot.t step). In that one frame the camera turns ≈ 95° onto her; with #156f the torch follows to ≤ 15° (release: the
  70 ms slerp got it 37 % of the way, 78° behind). Her NEXT brain update reads that frame's beam: 17.1° off her chest
  at 4.07 m (inside the 45° cone) → a beam LOOK at 4.07 m → she never offers the ≥ 6 m glance; B05 +2.9 s and every
  later beat diverges (B06 0 cone frames). Release: brain-seen beam 102.7° → no look; her later beam LOOK at 6.3 m came
  from the bot's own 170° aim snap with the lagging torch sweeping in (the single 6.02 m cone frame, lens-to-chest).
  So the gate failed through a QA frame that is not gameplay; the release passed by the luck of the 70 ms lag. The clamp
  is correct gameplay (a hand follows the shoulders) and STAYS; Ada keeps sensing the rendered beam (no AI/render split).
- F1 FIX #156h `scripts/qa/playthrough.mjs`: `bot.heroFrame()` — both hero aims (upper-hall-ada, harlan-bedroom) advance
  their one frame with `g.rig.hold = true` (the torch stays where the hand had it; restored after). Re-check = the
  careless strict gate (20 / 20 required) + the strict Medium gate (the bot change touches every gate).
- F2 FIX #156g `src/cutscenes/math.ts` sweepTargets(…, n, dip = 0): optional pitch dip·sin(πu) on the sphere sweep (the
  other 9 callers unchanged). `src/cutscenes/c2c-up.ts` 4.47 turn forward: dip −0.35 rad. Offline poses at 60 Hz
  (scratch/polish/c2cpose.ts): 4.567 (−1.0°, −22.9°) → (8.3°, −39.4°); 4.583 (28.8°, −12.3°) → (38.4°, −26.4°); 4.600
  (53.7°, −3.4°) → (60.2°, −12.5°); peak step 31.0 → 29.9°/frame; same 220 ms, end aim, CCW turn. typecheck rc 0.
- queued: scratch/polish/f2/q.sh (build scratch/dist-polish-2; C2c 4.517–4.65 at 1/60 direct, Medium after / before,
  Max after) then f2/gates.sh (careless strict Medium, strict Medium) on dist-polish-2.
- F2 RESULT 1 (pose dip only, dist-polish-2 @ b855e4fc8ac6, direct C2c stepped 1/60, mean 8-bit 4.55 / 4.567 / 4.583 /
  4.6): Medium before (dist-polish) 5.98 / 6.22 / **0.34** / 50.3; dip −0.35 4.51 / 6.64 / **0.31** / 57.3; Max dip
  4.55 / 6.80 / **0.30** / 57.4. The dip does NOT fix it (the reviewer's suggestion was a hypothesis): the 3.667 view-sphere
  that justified #156c was lit by the fanlight stroke; 4.583 is torch-only, and the torch is HELD forward (torchHold until
  4.6: north +12°, 45° cone) — a frame centred 10–50° east of north holds nothing it lights, at any pitch. 4.6 goes bright
  because the hold releases there and the gaze aim snaps the pool into frame.
- F2 FIX 2 (#156g, `c2c-up.ts`): torchHold off at 4.575 (was 4.6) — between the 4.567 and 4.583 frames at 60 Hz; at 30 Hz
  it still releases in the 4.6 frame (unchanged). Dip −0.35 kept (4.6: the pool on the near treads, 50 → 63).
- F2 RESULT 2 (dist-polish-2 @ 1e143cba16ec, same probe): Medium 4.6 / **48.5** / 63.4 (4.55 / 4.567 / 4.583 / 4.6:
  4.60 / 6.81 / 48.5 / 63.4), Max 4.57 / 6.76 / **43.4** / 61.4 — 0 console errors / 0 exceptions. Strips (top before or
  dip-only, bottom final; 4.55 · 4.567 · 4.583 · 4.6): scratch/polish/f2/c2c-4583-med-ab.jpg, c2c-4583-max-ab.jpg — the
  hall glow, then the torch pool on the balusters from 4.583 on, continuous with 4.6; no black frame. Residual (pre-existing
  #153f class): the sandy stipple where the smear crosses a hard white/black edge, in 4.583 as in 4.6. The step from the
  dim glow (6.8) to the lit balusters (48) is one frame — it was one frame before too (0.34 → 50), now without the dip.
- npm test (Chrome busy with probes): 373 / 373. typecheck rc 0.
- F2 RE-CHECK the reviewer's way (scratch/polish-rv/rvx.mjs, played route --beat B03 C2c at 1/60 in the whip windows,
  dist-polish-2 @ 1e143cba16ec; rv-007, mean 8-bit 4.55 / 4.567 / **4.583** / 4.6 / 4.617): Medium 4.77 / 7.14 / **48.8** /
  63.6 / 62.1 (review: 6.0 / 6.3 / **0.34** / 14.0 / 57.9); Max 4.68 / 7.06 / **44.3** / 62.1 / 64.7 (review 6.69 / **0.38** /
  13.86 / 57.98). Every C2c frame captured (263 per tier, all windows incl. the 3.62 turn back, stumble, 7.45): no
  isolated dip (< 0.4 × both neighbours), min 0.99 / 0.95. 0 console errors / 0 exceptions. **F2 FIXED.**
- `npm run build` rc 0 + verify-boot OK (1 boot chunk, 12.7 kB gz); `node scripts/assets.mjs --check` ok (no layout /
  material change → probes not stale). Gates (careless strict + strict Medium on dist-polish-2) running: f2/gates.sh.
- GATES on scratch/dist-polish-2 (fingerprint 1e143cba16ec = the final tree; power AC "charging" for both, battery for
  part of the F2 probes — no fps claims made anywhere in this round):
  - **careless strict** `QA_STRICT=1 QA_CARELESS=1 … --preset medium --scenario scripts/qa/playthrough.mjs` (12:04–12:09):
    rc 0, **20 / 20**, B13 ended, deaths 1 (B09 CP6, ≤ 1 allowed), 0 console errors / 0 warnings / 0 exceptions / 0 stalls /
    0 unsticks. Beam on her ≥ 6 m: B05 1 beam LOOK at 6.19 m; B06 15 cone frames, nearest 6.24 m; B11 440 frames.
    (The "exactly 15" / "1 LOOK" counts are by construction — glanceDone stops the bot's aim the frame the goal is met —
    not a threshold coincidence.) Report scratch/polish/f2/gate/careless-report.json, log f2/gate-careless.log.
  - **strict Medium** `QA_STRICT=1 … --preset medium` (12:09–12:15): rc 0, **18 / 18**, B13 ended (game 619.97 s, wall 285 s),
    deaths 0, 0 console errors / 0 warnings / 0 exceptions / 0 stalls / 0 unsticks, load 30.3 s. Report
    scratch/polish/f2/gate/medium-report.json, log f2/gate-medium.log.
  - B11 (the 'let her look' wait) ran 122 s to C4c in the stealth gate and 73 s in the careless one — inside the spread
    already on record for this beat: release-era strict Medium 47.8–173.0 s (scratch/final/fx/gate4 173.0, pg-medium
    163.2), careless 19.2–145.2 s (car-pol / car-noclamp). Variance of that beat, not this change.
- CORRECTION (12:22): #156h DOES change the stealth route on every tier. The hide system restores the pre-hide torch on
  the exit (f1 trace: rig.on 0 in the armoire → 1 on the unhide frame; the bot's own toggle is gated on not-hidden), so
  the upper-hall-ada hero frame ran with the torch ON in the stealth gates too — under #156f its beam also landed on her
  there. The reviewer's strict Max / Low gates (18 / 18 on dist-polish) included that leak → STALE. Strict Medium is
  re-verified above; strict Max + Low queued on dist-polish-2 (f2/q3.sh).
- Hero sheet note: the upper-hall-ada screenshot now shows the torch held where the hand had it (off her) in both routes;
  before #156f it was 78° behind the camera there anyway (release), so the picture barely changes.
- B05 margin: her beam LOOK starts at 6.19 m against the 6.0 m threshold (deterministic: the reviewer's two release /
  polish careless runs each repeated exactly) — it passes, with 0.19 m to spare.
- F2 phase check queued (f2/q3.sh): the probes above all land on k/60 frames; real-time play has any phase, and a frame
  at ≈ 4.571 (after the glow, before the 4.575 release) was untested. mbprobe stepped 1/180: 4.5611 … 4.5889.

## RESULT (POLISH FIXER, 12:16) — dist = scratch/dist-polish-2 @ 1e143cba16ec (kept for the reviewer)
| finding | status | before → after | evidence |
|---|---|---|---|
| F1 careless strict gate 18 / 20 under #156f | FIXED at the root (QA harness) | rc 1, 18 / 20 (B05 0 frames / 0 LOOKs, LOOK at 4.07 m) → rc 0, 20 / 20 (B05 LOOK at 6.19 m, B06 15 frames at 6.24 m) | f1/diag2-pol-report.json pvLog (brain-seen beam 17.1° at 4.07 m in the hero frame), f2/gate/careless-report.json |
| F2 C2c 4.583 black frame at 60 Hz (Medium + Max) | FIXED | played route Medium 6.3 → **0.34** → 14.0 ⇒ 7.1 → **48.8** → 63.6; Max 6.69 → **0.38** → 13.9 ⇒ 7.1 → **44.3** → 62.1; no isolated dip in 263 C2c frames per tier | f2/rvx-med, f2/rvx-max (rv-007), f2/c2c-4583-med-ab.jpg, c2c-4583-max-ab.jpg |
Gate: typecheck rc 0 · npm test 373 / 373 · npm run build + verify-boot OK · assets --check ok · strict Medium B13 18 / 18
0 errors · careless strict Medium B13 20 / 20 0 errors. Contract rows #156g (F2), #156h (F1).
- 12:20 comment-only correction in `c2c-up.ts` (#156g dip note: the dip alone did not light 4.583). Tree fingerprint now
  **8fb5f19527d3**; rebuilt to a scratch dir and diffed against scratch/dist-polish-2: every JS / HTML / asset file
  BYTE-IDENTICAL (only the .map files differ — they embed sources + paths) → the gates above ran the final code.
  typecheck rc 0 after the edit. Scratch build deleted.
- F2 PHASE CHECK (dist-polish-2, mbprobe stepped 1/180 s, mean 8-bit at 4.5611 / 4.5667 / **4.5722** / 4.5778 / 4.5833 /
  4.5889): Medium 5.10 / 6.13 / **6.69** / 47.04 / 47.15 / 51.58 · Max 5.09 / 6.14 / **6.69** / 46.68 / 46.79 / 51.39; 0 console
  errors / 0 exceptions. The frame just before the 4.575 release still holds the hall glow; every frame after it has the
  pool. No dark frame at any phase from 4.561 to 4.589 → F2 holds for real-time play at any display rate ≥ 60 Hz.
- STRICT MAX + LOW re-run on dist-polish-2 (12:21–12:31, mains): **Max** rc 0, 18 / 18, B13 ended (game 580.17 s), deaths 0,
  0 console errors / 0 warnings / 0 exceptions / 0 stalls / 0 unsticks, load 28.3 s; **Low** rc 0, 18 / 18, B13 ended (game
  587.2 s), deaths 0, 0 / 0 / 0 / 0 / 0, load 62.8 s (reports scratch/polish/f2/gate/max-report.json, low-report.json).
  B11 → C4c 81.9 / 89.0 s (inside the recorded 21.9–173 s spread). All four strict gates (Medium, Max, Low, careless
  Medium) now pass on the final code.

## FINAL (POLISH FIXER, 12:32) — both findings fixed; nothing open from this round
typecheck rc 0 · npm test 373 / 373 · npm run build + verify-boot OK · assets --check ok · strict Medium / Max / Low 18 / 18
each · careless strict Medium 20 / 20 · 0 console errors in every run. Code = tree 8fb5f19527d3 (dist-polish-2 built at
1e143cba16ec; the only later edit is a comment, runtime files byte-identical). Contract rows #156g, #156h.
