# STATUS — SMOOTH-FRAMES lane (cinematics smoothness; contract #142; ROADMAP rulings (ak), (am))

User (2026-10-11): "the beheading still has glitches and isnt smooth enuf, plus the end of the car ride in the first cut
scene has the glitch of road disappearing and re appearing" → JERKY MOVEMENT, POP / FLICKER, FREEZES / STUTTER.
This lane brings every cutscene the GLITCH lane (#139) did not frame-check to that standard.
Dist: scratch/dist-smooth-frames (built from the working tree). Work dir: scratch/smooth-frames/.
Do NOT touch (GLITCH lane until STATUS-glitch.md says finished): c2-room.ts, c2c-up.ts, glimpses.ts, yard-cull.ts.

## Lead notes
- 2026-10-12 08:40: the GLITCH lane is FINISHED (STATUS-glitch.md ends "GLITCH LANE FINISHED 2026-10-12 08:34"), so
  c2-room.ts / c2c-up.ts / glimpses.ts / yard-cull.ts are open to you now. Its leftovers for this lane:
  (a) C2c 12.4: the slow turn ends at full speed (ease 'in') and stops dead, so make it 'inOut';
  (b) every camera look path whose targets pass within 1 m of the eye should use sweepTargets
      (scratch/glitchfix/camsweep.ts flags them).
  NOT yours: the C2c 9.3 wallpaper speckle shimmer under the torch hot spot and the arms_breath_hold torch height
  (C2c 11.37: torch 0.42–0.48 m below the eye) go to the new FLASHLIGHT/HANDS lane (user report: the flashlight dims
  near walls, the hand holding it looks weird). That lane owns src/render/flashlight.ts, flashlight-bounce.ts,
  exposure.ts, the exposure/torch constants in look.ts, src/player/flashlight-rig.ts, src/characters/arms.ts and
  blender/characters/arms*.py / tex_arms.py.

## Tools (item 1)
- `scripts/qa/cs-frames.mjs` — wraps scripts/qa/playthrough.mjs (unchanged): the bot plays the real route; while a
  target scene runs (+ PRE 1 s ring buffer, + POST 2 s) the game steps one bot frame (1/30 s) at a time and every
  frame is captured with a ROWS entry (id + own clock, beat, bot t, camera PLAN eye/heading/pitch/fov, per-frame
  draws/tris over every render target, lightning level). Output `<out>/<scene>-<k>/NNNN.jpg + rows.json`.
  `SCENE=C3,C4 [FPS FROM TO PRE POST STOP WATCH]`; STOP=1 ends the run once all targets were captured.
- `scripts/qa/detect.py <seqdir> --out <dir>` — FLICKER / LOCAL POP / GLOBAL / camera CUT+WHIP / DRAW jumps /
  exposure pumps; writes only into --out (report.txt, events.json, raw.gray).
- `scripts/qa/strip.py <seqdir> <out.jpg> [--range a-b] frames…` — brightened contact strip, legend printed.
- `scratch/smooth-frames/offline.ts` — per-frame (30 fps) sequencer triage of every timeline (no Chrome): shot
  boundary jumps (near-match = pop), whips, releases mid-cutscene, start/end hand-off vs the player pose, DOF/grade
  left on at the end, one-frame fade steps, places/clip snaps/attaches while visible, root yaw/position steps.

## Runs (Medium, 960×600, stepped 1/30 s on the real route; battery — no timing from these)
- BASELINE dist (built before any edit): capA C0,C3,C4,C4a · capB C4c,C5(+C5b) · capC C6→C6b→C7→CR (one segment,
  3203 frames) · capD C1 0–57 + C2b via c2b-patient. Detect reports: scratch/smooth-frames/det/<run>-<seg>/report.txt.
- AFTER dist (rebuilt 09:5x with every fix below; NOTE the shared tree also carries the FLASH lane's uncommitted
  render/flashlight*, exposure.ts, look.ts, arms.ts and the PERF lane's render/pipeline.ts, renderer.ts, blood-fx.ts):
  capE C0,C1,C3,C4a · capF C2c,C2b (patient) · capG1 C4c,C5,C5b · capG2 C6..CR — queued.

## Offline triage (scratch/smooth-frames/offline.ts, guessed start poses — confirm on the captures)
- C0 21.93–22.07 shot 3 (crane) look whips 12–21°/frame while the car passes under (title card up).
- C0 → C1: DOF (0.2 m on the drops) on to the end, C1 has none → the match cut also snaps focus (authored cut).
- C4c start: same eye, look 31° + fov 60 → 30 in one frame; end: no player cue → back to the start look and fov
  26 → 60 in one frame (zoom pop at the hand-back).
- C5 10.0 Ada root yaw 34° in one frame — on the shot cut at 10.0 (hidden by the cut).
- C5b start: 0.96 m / 177° from the guessed pose — the real porch pose decides (near-match?).
- C6 0.0: the look snaps from the player's gaze onto the filler at t 0 (target fixed); 1.6 shot 0→1 FOV 48 → 44 in
  one frame on the same eye/target (zoom pop).
- C7 9.73: vehicle speed 19 → 27 m/s in one frame (C1's coast segment starts at 3× its mean speed) in the sign POV
  while it fades out. Same speed step in C1 at 56.6 (on the S9 cut there: the car then rolls in at 27 m/s braking at
  1.3 g — a coasting car).

## Findings / fixes (source edited; the capA–capD baselines run on the dist built BEFORE these edits)
- C7 9.73 vehicle speed step: C7 now keeps the rooms run's 18.9 m/s into the black (s 23 → −7.2 over 1.6 s, same
  lane) instead of C1's coast segment. Offline: no car-space speed step left. Frames: pending (capC after).
- C6 start + 1.6: shot 0 sweeps the look from the player's gaze onto the filler (sphere, inOut 2.0 s, was 'out' 1.6 s
  with the target fixed on the filler) and ends at shot 1's 44° (was 48° → 44° in one frame). Frames: pending.
- C2c (GLITCH residual 2 + new): 10.4 slow turn 'in' → 'inOut' (stopped dead at ≈ 9°/frame into the 12.4 hold);
  hall run 'in' → 'inOut' (ran into the newel at 16 cm + 8°/frame, then the swing started from rest — a one-frame
  stop at 1.65); camera bob (sequencer.ts, C2c only) now (amp/2)·sin 2π·hz·τ — 0 at a shot's start — and every
  bobbing shot runs a whole number of steps, so it is 0 at its end too (every bobbing shot started amp/2 = 1.5–2 cm
  low, ended up to 1.75 cm / 0.6° roll off). Offline: 0.667 and 1.667 boundaries now 0.00 m / 0.0°.
- C4c: eases in from the player's view (1.0 s sphere sweep, fov 60–70 → 30, locket DOF bokeh 0 → 3) and out to it
  (9.8–11: sweep from her fist to her chest as she steps off, fov 26 → 60–70, DOF bokeh 2.5 → 0, then a `player` cue
  on that camera). Offline: START/END 0.00 m / 0.0° / 0.0°. Frames: pending.
- bindings.ts exposure snaps (C3 0.333 ×3.0, C4a 0.333 ×2.3 luma steps): the first held frame of EVERY cutscene and
  every release requested a snap (R2-5 "a cut"), which lands 0.3 s later (see exposure latency below) — even when the
  cutscene starts / ends on the player's own eye. Now the first held frame is compared with the frame rendered before
  it (the gameplay camera, or the pose a chained cutscene ended on the same frame) and release compares the player
  camera with the cutscene's last pose: a snap only on a real cut (> 1.2 m / > 20°). Frames: pending.
- C1 (not frame-checked before except its end; the lead's leftover (b)): driver glances look along directions (targets
  pushed out to 3 m): S1 radio glance split into look → hold 1.2 s → back → road (was a 19°/frame whip through the
  dial with the picture spinning at 5.0); S4a ends on the map and S4b eases 24 → 35 mm (was a 2.3° / 15° one-frame
  zoom at 21.8); S4c sits back up from S4b's lean (was 0.14 m / 35 → 24 mm in one frame at 26.6) and no longer
  whips at 27.6; S6 crane looks down the road the car drives into (was a swing through the nadir, −82°, picture spin
  ≈ 40°/frame at 38.17, 2 s before the car got there); the step-out ends on CP1's pitch (3.4° tip at the hand-back).
- C6 31.0: the drive's vehicle track ended at 3.65 m/s → 0 in one frame in the mirror shot (fade 0.3): a 1.6 s
  continuation at the same speed. C2c 7.45: the sweep back starts where glance #2's drift ends (2.3° jump). C2c
  12.9–13.9: the lean and the lens' return to the gameplay FOV share 1 s (37.8 → 70° in 0.5 s peaked ≈ 6°/frame).
- NEW tests/smooth-cutscenes.test.ts (5 tests, all 15 timelines at 30 fps): whips ≤ 12°/frame and picture spin
  ≤ 6°/frame outside listed authored whips; lens ≤ 5°/frame and never a one-frame spike; every shot boundary is a real
  cut or continuous (≤ 2 cm / 1° / 1°); hand-backs land on the last camera; car speed never steps; whole-step bobs.
  npm test 282/282.

## C3 (capA/C3-1, 464 frames) / C4a (capA/C4a-2, 480) / C4 (capA/C4-3, 894: approach → hem → look → leave)
- C3 0.333 and C4a 0.333: the exposure snap at the start (fixed in bindings.ts, above). C3's four lightning strokes
  (3–4 pulses each) are authored. C3 4.17: a 100° heading jump was a cs-frames artifact (the playthrough's B06 hero
  shot 'harlan-bedroom' was carried to the end of the 30 s chunk and aimed the camera mid-C3) — fixed in the tool.
- C4a: cuts at 2/5/8/11 authored; the 3.3 stroke and the 6.0/10.0 flashes authored. FINDING (look, not a pop): the
  8.0–10.0 dolly past the sheeted furniture is PITCH BLACK (luma < 1e-4 for 60 frames; again 10.57–11.0) at the fixed
  film exposure 1.2 — the shot it was written for cannot be seen (strip strips/c4a_dark.jpg). After C4a the bot
  switches the torch off (its B08/B09 stealth rule): not a game glitch.
- C4 hem overlay: every flagged frame is a lightning stroke; the view through the wardrobe slats is near-black
  (luma 0.0003–0.002), so the per-segment DOF changes cannot be seen. FINDING (look): the dress visit is invisible
  through the slats except in the strokes.

## C0 (capA/C0-0, 956 frames C0 0.17 → C1 2.0, Medium, baseline dist; det/C0-0/report.txt)
- 21.73–22.43 CAMERA WHIP + SPIN (strip strips/c0_crane_before.jpg): under the title the crane dives onto empty road
  (pitch −60°), the picture spins as the heading swings 160° in 0.4 s (21°/frame), the car only arrives at 22.9. Bug →
  FIXED in source (shot 3 tracks the car; offline ≤ 4°/frame, spin 6°/frame at the pass). After-frames: pending.
- EXPOSURE STEP 0.3 s AFTER EVERY CUT (strip strips/c0_expo.jpg): 12.53 cut → 12.83 luma ×0.38; 19.03 → 19.33 ×0.25;
  26.03 → 26.33 ×0.33; C0→C1 30.0 → C1 0.3 ×1.51 — one-frame brightness jumps mid-shot. Cause (src/render/exposure.ts,
  not this lane's file): a cut calls snap() INSIDE update(); the same update then meters the scene texture of the
  frame BEFORE the cut (issuedAt == snapAfter → correctly not snapped) and sets nextMeter = t + 0.25, so the first
  post-cut reading is issued 0.25 s later and lands ≈ 0.3 s after the cut. Fix suggested below (For FLASHLIGHT/HANDS).
- Lightning frames (9.23, 15.63, 23.63): +90–110 draws on the frame before the flash = the strike's shadow pass, no
  visible pop. 3.5 = the authored hard cut from black.

## C4c / C5 / C5b (capB) — real start poses: C4c/C5 eye (2.413, 8.26, 2.251) hd −109.7°/−83.5°, fov 70
- C4c: the start was a 35° tilt + 70° → 30° lens in one frame and the end the reverse (26° → 70°, 30° tilt) — fixed
  (1.0 s push-in / 1.2 s pull-back 9.8–11 + player cue). Memory flash-frames 2.5–6.3: authored cuts.
- C5 6.53 / 12.43…: the 0.3 s exposure latency after cuts (above). 15.63 −288 draws = the torch's shadow pass off.
- C5 12.47–13.23 BLACK (0.7 s, strip strips/c5_1247.jpg): the walk to the threshold ran 0.5 m along the parlor wall
  looking INTO it; the torch light (0.56 m ahead of the eye) went into the wall. FIXED: the walk goes down the hall to
  a point 1 m in front of the doorway ON its axis and the look stays on the doorway (C5_DOORWAY) until it opens onto
  the room; scratch/smooth-frames/walls.ts / walls2.ts: from hall_n, (1.8, 0.6), (1.2, 3.0), (2.0, 6.0) the look
  meets the wall at ≥ 0.63 m at worst for ≤ 3 frames (was 0.47 m and ≈ 20 frames into the wall).
- C5 29.77–29.93 TORCH POOL BLINK (6 frames, strip strips/c5_2977.jpg): in the final shot (camera static at the
  threshold, parlor door swinging shut BEHIND the wall at 29.6, into G2) the torch pool on the wall left of the front
  door vanishes and returns; one-frame −18-draw dips at 29.8 and 29.93. Not a camera/timeline cause → For PERF /
  FLASH below.
- C5b start (real: the player walking out of the front door at (1.963, −0.246), hd −97.7°): the shot started 0.30 m
  ahead and 10° off — a one-frame jump. FIXED: starts on the player's eye/gaze, 'out' ease ≈ walking pace, sphere sweep
  onto the mist. C5b end → gameplay: continuous (the bot's own 78° turn after it is the bot).

## C6 → C6b → C7 → CR (capC/C6-0, 3203 frames)
- C6 0.033: the look snapped 18° + ≈ 37° down onto the filler (strip strips/c6_start.jpg) — FIXED (offline with the
  real pose (11.583, −2.859, 1.652) hd 35.6°: ≤ 1.9°/frame, monotonic, lands on the pour framing). C6 1.6 lens step
  FIXED. C6 31.0 car stop FIXED.
- C6 26.27–26.47 THE CAR DRIVES THROUGH A GATE POST (strip strips/c6_2643.jpg, approach strips/c6_gate.jpg): a round
  bark post fills the windscreen and passes through the cabin. Cause (layout/lane A, not a timeline): P_GATE
  (0.5, −28.25, yaw 0.35) is built CENTRED on its pos (blender/props/exterior.py farm_gate: posts at ±(W/2 + 0.12)),
  so its posts stand at ≈ (−0.83, −28.74) and (1.83, −27.76) — the second one in the middle of the real opening
  between the fences (P_FENCE_W ends at x 0.4, P_FENCE_E starts at 3.2; CP1 is 0.36 m from it). No path through the
  fence line clears a 1.75 m car (gaps 1.43 / 1.37 m). Request below; C6's drive is left as is until then.
- C6 22.3–22.8 THE CAR DRIVES THROUGH THE PUMP (strip strips/c6_pump.jpg; the drive line passed 0.59 m from P_PUMP's
  centre, the island is 0.95 × 0.7 m). FIXED in source after the capE–G dist was built: the line passes west of the
  pump, 1.65 m off its centre (42.7 m, 3.71 m/s; the 31.0 roll-on matched) — the car now passes BEHIND the pump from
  the pump shot's camera. Needs its own after-capture (final window run).
- Exposure latency after EVERY cut (the worst on screen): C7 15.83 the cleat insert and C7 18.6 the guest book are
  blown out for 9 frames (luma 0.23 / 0.41) then drop ×0.03 / ×0.02 (strip strips/c7_expo.jpg); C6 7.83, 8.73,
  10.73, 19.8, 28.1; C6b 6.33, 8.83; C7 0.3, 17.13, 22.9. All the same exposure.ts cause.
- C7 9.73 (confirmed on the real route, capC f1724): the sign-POV eye steps 0.63 → 0.91 m/frame (+44 %) as the shot
  fades out — the car speed lurch found offline. FIXED (C7's own last vehicle segment at the rooms-run speed).
- Authored: C6b 2.0 fade-in, 4.3–4.8 the wick catching, 10.85–11 fade; C7 fades; CR lightning (+146 draws = the strike's
  shadow pass); C6 22.2–22.4 −200 draws over 0.2 s = frustum (the pump pan), no pop.

## C1 0–57 (capD/C1-0, 1801 frames) and C2b (capD/C2b-1) — C2b FIRES for a patient player
- C1 before (strip strips/c1_before_a.jpg): 4.87–5.07 the radio glance whips down and up in single frames; 20.4–20.7
  the dome/seat swing; 27.4–27.9 the visor whip to the black headliner; 38.0–38.2 the crane looks straight down and the
  road markings ROTATE ≈ 45° in 4 frames (lookAt spin). All four FIXED in source (above). 6.93 / 56.97 = exposure
  latency. 18.4 = the dome bulb switching on (authored). 34.2–34.5 the truck's lights (authored).
- C2b (item 4): scripts/qa/c2b-patient.mjs — the patient player holds the armoire exit until her brain has been in
  VIGIL (freezable) for 1.0 s. Result on the real route: she was ALREADY in VIGIL at the first frame after
  first_hide_done (t0 = game 211.5 s); the exit was held 30 frames (1.0 s); C2b was requested and PLAYED (outcome
  'played', M-A optional log "C2b played in B05 at 212.3s"). So a player who stays in the armoire ≈ 1 s after the
  slat demo gets C2b; the stock bot exits on the very first frame (its exit reaches the story before the view's
  aiState reads VIGIL) and drops it. Recommendation for the lead: keep C2b (no gate change needed); optionally let
  the stock bot wait 1 s so the gate run covers it.
- C2b frames: start = an authored cut to the armoire mouth (95°). 7.03–9.03 the floor shot FLICKERS pink → black →
  pink (strip strips/c2b_floor.jpg): the torch rides the camera, so at floor level, clamped at the runner, it lit her
  legs from the lens and the 12° clamp swung it off and on. FIXED: torch off for the macro + floor shots (3.0–9.5) and
  back at the cut to the eye as the player had it (new optional CutsceneContext.player.torch); the beam rises from the
  runner to the gaze with the release shot (31 beamClamp aim cues) — 11.0 had a one-frame flash on the wall when the
  clamp let go. Exposure latency at 7.33 (×1/75: the floor shot went black after the snap) — exposure.ts.

## P_GATE (lead ruling (an), contract #142b) — rebuilt; in-game checks queued
- Done (source): exterior.py farm_gate origin = hinge post, latch at W + 0.17, collider proxy, `openDeg`; layout
  P_GATE pos (0.53, −28.25) yaw 0 width 2.33 openDeg 95 (only P_GATE changed: git diff of level-layout.json = 5 lines);
  fence end posts computed from the seeded RNG (kit.Rng, registry.seed_for): W end (0.335, r 0.059, lean −0.019),
  E first (3.278, r 0.052, lean −0.024) → gate post gaps 3.6 / 6.5 cm. Leaf 95° (72° blocked C6's car: 7 cm).
- C6 re-route done + ArcPath fix (#142b (4)/(5)); scratch/smooth-frames/c6clear.ts: hinge 0.18 m, latch 0.16 m,
  leaf 0.14 m, pump 0.75 m, sign 2.5 m, mailbox 1.38 m; 3.61–3.78 m/s; crosses the fence line at C6 26.77.
- Pipeline DONE 09:47: props (266 s) + all 7 dev bakes (ground … car, 20–240 s each, started at 45 % battery; the
  Mac went to AC during them) + encode (59 s), all ok. `assets.mjs --check` ok: Low 26.96 / 27 MB (was 26.99),
  Medium 53.82 / 60, Max 77.12 / 120. `house` / `corridor` still stale as before (not this change's).
  dist-smooth-frames REBUILT (build2) with the new assets + every source fix; every queued capture of mine
  (capE/F/G1, maxA/B) now runs on build2; added gate (gate-check.mjs), capH (C6→CR Medium), maxC (C6 19.4–29.2, CR 0–8).
- Earlier note: props DONE (266 s, review render scratch/props/farm_gate__P_GATE.png: hinge post + leaf swung back,
  latch post; collider not drawn). All 7 dev bakes became stale (props.blend is an input of each) → queued
  `--only bake-house-*` then `--only encode` (logs scratch/smooth-frames/assets-{bakes,encode}.log), waiting for the
  Chrome lock. Battery rule (lead): scratch/smooth-frames/bake-guard.sh stops the QUEUED set if the Mac is discharging
  below 30 % before Blender starts; never kills a running bake. New QA: scripts/qa/gate-check.mjs (CP1 not pushed,
  walk in/out through the opening, T_B02_GATE fires, the leaf blocks, 3 stills).
  `house` and `corridor` were ALREADY stale before this change (not run: not this change's; house's terrain pad for
  the gate moves 3 cm — negligible). Left: bakes, encode, --check budgets, rebuild dist, re-checks (B02 walk-up +
  T_B02_GATE, CP1 clear, C1 end at the gate, C6 26–27, facade gate view, one non-parlor room still).

## For FLASHLIGHT/HANDS (owner of src/render/exposure.ts)
- Exposure snap latency (evidence above): in `update()`, do not issue the meter reading in the same update that called
  `snap()` (it reads the pre-cut frame); issue it on the next update (`t > snapAfter`) — the snap then lands 1–3
  frames after a cut instead of ≈ 9–10 (0.3 s). Affects every cutscene cut that changes the metered scene (C0 ×4).

## For PERF
- C5 29.77–29.93 (capB/C5-1 f0922–f0928; camera static at C5_END_EYE (3.05, 1.71, 2.24) hd −115°; D_PARLOR swinging
  shut into G2 from 29.6): the torch pool on the hall's west wall beside the front door vanishes for 6 frames and
  comes back; draws dip −18 for one frame at f0923 and f0927 (326 → 308 → 326; 328 → 310 → 328). The door leaf is on
  the PARLOR side of the wall, so it cannot occlude the torch physically. Suspects: the torch's shadow/caster cull or
  the room/portal visibility toggling while the door crosses its closed angle. (Also FLASH: light inside geometry?)
- C3 1.03 (release of the 1 s steer, look lock): 361 → 216 draws as culling returns — no visible pop (med 3).

## For the LEAD / lane A (layout + props)
- P_GATE: farm_gate is built centred on its origin, but the layout places it as if the origin were the hinge
  (fences end at 0.4 / 3.2): its east post stands at ≈ (1.83, −27.76), in the opening, 0.36 m from CP1, and C6's car
  drives through it (above). Either put the gate's hinge post at the prop origin in exterior.py, or move P_GATE to
  (1.8, −28.25) yaw 0 (closed line) / the hinge at 0.5 with the leaf swung 72° into the yard. Then C6's drive should
  cross the fence line at x ≈ 1.8 (its point [1.4, −28.2] → [1.8, −28.25]).

## Restart 2026-10-12 10:15 (network drop killed the agent; the nohup captures survived) — state + queue
- Confirmed this session: the tree is UNCHANGED since build2 (find src scripts blender -newer dist index.html → none),
  so every queued run tests the current tree. typecheck clean; npm test 299/299. c6clear.ts re-run: hinge 0.18,
  latch 0.16, leaf 0.14, W/E fence end posts 0.42/0.43, pump 0.75, sign 2.50, mailbox 1.38 m; 3.61–3.78 m/s; fence
  line crossed at C6 26.77.
- Lightmap tier (the P_GATE rebake): HEAD already shipped the DEV tier (bake-house-*, 1024² / 64 spp, re-baked
  2026-10-08/11 after the 2026-09-30 release bakes 2048² / 128 spp); the rebake is the same tier (max lm_parlor.json
  1024×1024 at HEAD and now; parlor mean 0.03956 → 0.03961). No quality regression from this change. A release bake
  (finish-line item) is NOT this lane's.
- Chrome queue (FIFO, .cache/chrome.queue; all on scratch/dist-smooth-frames = build2 unless noted):
  capE (C0,C1,C3,C4a Medium, running 10:13) → capF (C2c,C2b patient) → capG1 (C4c,C5,C5b) → maxA (Max windows C0,C1,
  C2c,C2b) → maxB (Max windows C4c,C5,C5b,C6,C7) → [lead-obj b08, PERF cpsplit, PERF fullmax, PERF fullmed — not
  mine] → gate (gate-check.mjs B02) → capH (C6→C6b→C7→CR Medium) → maxC (Max C6 19.4–29.2, CR 0–8) → strict (item 5:
  QA_STRICT=1 Medium playthrough) → maxD (Max C3 0–1.5, C4a 0–1.5: the bindings snap rule). Logs: scratch/smooth-frames/<run>.log (each ends "exit=N").
  capG2 was killed (exit 130) and replaced by capH.
- RULE: dist-smooth-frames is never rebuilt while a queued run uses it. Any new fix → build scratch/dist-smooth-frames2
  and re-queue only the changed windows + a new strict run; the strict run above counts only if no source changes.
- Left: process each capture as it lands (detect → det/<run>-<seg>, compare.py vs the baseline by cutscene clock,
  before/after strips of every fixed moment); gate-check items (B02 walk-up + T_B02_GATE, CP1 clear, the leaf blocks,
  C1 end at the gate, C6 26–27 through the gate, facade gate view); strict run; delete the dist at the end.

## After-captures (build2) — processed so far
- capE (C0,C1,C3,C4a Medium) + capF (C2c,C2b patient) done 10:20/10:24; det/E-*, det/F-*. Both runs log 73 × "WebGPUBackend:
  copyFramebufferToTexture: Source and destination formats do not match. rgba16float bgra8unorm" at LOAD during the
  reflection capture (console 3462–3469.6 s, before any scenario code). Not from this lane's files (no render code
  touched here); first seen 08:56 in the FLASH dist; every run before ≈ 08:55 is clean (capA–D 0 errors). FLASH
  suspects blood-fx.ts's stain cull (PERF) — unproven. It will fail the strict gate (item 5) until PERF/lead fixes it.
- C3 0.333 luma ×3.02 → ×0.97; C4a 0.333 ×2.31 → ×1.04 (bindings snap rule) — FIXED, confirmed on the route.
- C0+C1 (3206 frames): non-cut frames turning ≥ 7°/frame 25 → 0 (C0 21.9–22.1 crane, C1 5.0 radio, 20.6 dome, 27.6
  visor, 38.1 crane); C1 36–40 lowest pitch −82° → −31° (no nadir spin). Post-cut exposure step now +2 frames (was +9;
  FLASH lane's exposure.ts). C2b PLAYED again for the patient bot on build2.
- C4a hand-back 15° one-frame turn + torch off = the bot (same in the baseline), not the game.
- C1 56.9–57.1 (S9, static camera): luma ×0.69 then ×0.37 as the car's headlight glare leaves the right frame edge
  (strips/c1_5660_after.jpg) — physical (the car turns in), to re-judge in real time.

## C2 HEAD ATTACHED (lead ruling (ao), contract #142c) — TOP PRIORITY since 10:45 — IN PROGRESS
User: "her head is already not attached to her body … she has no head and the man cuts her head, and suddenly a head is
there on the ground". Lead's sheet scratch/lead-obj/c2-prestrike.jpg.
- ROOT CAUSE (offline, scratch/smooth-frames/head/adaverts.mjs on medium ada.glb, ada_c2 at ADA_TABLE (5.93, 3.30)
  heading π): her head is INSIDE the sawbuck. ada_head skinned verts x 5.32–5.54, z 1.21–1.46: 75–79 % below the
  table top (z 1.40) within its footprint (x 5.30–5.90), 0 % past the west edge, at C2 0 / 3 / 7.5 (clip pose static).
  Bones (C2 2.0): hips 5.985, spine_03 5.712, neck_01 (5.543, 1.477), neck_02 (5.487, 1.433), head joint (5.456,
  1.379) — the head joint itself is below the top. She stands at the east side bent over (thigh joints x 6.034, feet on
  the floor): hip joint → neck_01 = 0.49 m cannot span the 0.6 m top, so the authored "head over the west edge" never
  happened. The visible "raw neck end" = her neck entering the sheet.
- THE RED NECK END (lead (c)): not uNeckBlood (0 pre-sever). It is (1) ada_body / ada_head ALBEDO baked by
  blender/characters/tex_ada.py skin(): the first-stroke `gash` at the nape (by design) PLUS the `coat` — a
  full-circumference whole-blood coat 1.2–1.7 cm either side of the cut + 3–6 cm runs onto the body side, baked
  unconditionally (meant for the post-sever stump); (2) skin.ts `cut0` (r/g > 1.55 key → cut tint + roughness), not
  gated by uNeckBlood, which darkens that coat. With the head buried, the coat ring at the sheet line reads as a stump.
- First attempt (rest the head ON the sheet, body unmoved) was dropped after offline checks: harlan_c2's cleaver edge is
  IK-held on stage NECK (5.31, 3.25, 1.40) — the WEST EDGE (scratch/glitchfix/bonetraj.mjs: edge (5.30, 3.24, 1.38) at
  7.58) — 21 cm west of where her neck actually was, so it never met her neck and would have split a head lying on the
  sheet; the head could not reach past the edge (centre ≥ 5.40) and a slide-off fall needed new physics and timings.
- FIX (restores the authored staging, docs/C2-ESCAPE.md §2.0/§3.1 "head and neck over the WEST edge"): a runtime
  pose layer, src/characters/ada-table-pose.ts (pure) + ada.ts applyTableLift/undoTableLift, on ada_table (tableau,
  B03 glimpses, warm-up — lead (a) for free) and ada_c2 (all of C2), blended out over ada_rise_headless clip 0.3–1.2:
  ada_rig +0.20 m forward (west) / +3 cm up; thighs +55°, calves −60° (her pelvis on the top 0.12 m inside the east
  edge, the legs over the east side, toes 15 cm off the boards — behind the table from every C2 camera);
  neck_01 −10°, neck_02 (−40, −5, 36)°, head (−30, −5, 54)° in her root frame. The layer is taken off at the start of
  every update (the mixer only rewrites changed clip values: on a static clip it would compound).
  Offline (scratch/smooth-frames/head/posesearch.mjs; tests/smooth-c2-head.test.ts, 3 tests): C2 0 / 2.4 / 6.9 and
  ada_table — ada_head 100 % past the west edge, 0 head vertices in the top or through the MEASURED west drape of
  P_RUBBER_SHEET (props_m1.glb at its layout pose), 0 body vertices in the top / east drape (the clip had chest and neck
  2.8 cm INTO the sheet), head centre (5.20, 3.26, 1.51), face 240° (D bears 233°), level, face·(→D) 0.96–0.97; cut
  ring (5.277, 3.301, 1.47) — 2.3 cm from the blade's contact. The head now falls off the edge on the cut exactly as
  authored (cutscene-fx 'fall' → HEAD_LAND 7.9, unchanged; no new fall code); pulses unchanged.
- Blood follows the stump (constants outside this lane — see requests): blood-fx JET_CUT (5.484, 3.307, 1.446) →
  (5.273, 3.302, 1.489) (Δ of the cut ring at C2 8.45; the same measure reproduces the old probe to 2 mm; JET_AZ/EL
  unchanged: the axis relative to the neck bones is unchanged); the pool "where pulses 1–2 land" [4.48, 3.37] →
  [4.42, 3.38] (scratch/smooth-frames/head/jetland.ts: all 369 pulse-1/2 particles now reach the boards, 122 fell back
  on the sheet before); blood-math C2_COLLIDERS 'ada' box moved with her (+(-0.20, 0, 0.03)).
- Hair: VerletChain.shelf (secondary.ts, additive) — while the lift is on and she is whole, her hair rests on the top
  and against the drape face (x 5.24 down to 0.9 m) instead of passing through.
- Not changed: harlan_c2 (no Blender anims rebuild), HEAD_LAND / HEAD_REST, C2_HEAD_LANDS, the pickup, C2c / B05.
- Pre-existing, NOT fixed here: Harlan's left hand "on her shoulders" until 4.8 hovers ≈ 30 cm above her back (before
  and after); his boot "nudge" at 9.45–9.6 stays ≥ 0.47 m from the head (the head rolls by itself) — lane A clips.
- Captures (dist-smooth-frames2, built 15:05 with everything above + the gate collider fix): c2h-med (Medium C2 0–12.5,
  30 fps, real route), gate2, c2h-max (Max C2 0–12.5 at 5 fps) — queued 15:05.

### C2 head — round 2 (15:15–15:45): the seam
- c2h-med (dist2, Medium, real route, 0 console errors, 417 frames): strips/c2h_prestrike.jpg — from 3.0 s her head is ON
  her neck at the west edge, hair hanging, toward the lens (was: a neck into the sheet); strips/c2h_strike.jpg — 7.567
  the blade lands on the neck between head and shoulders, 7.6–7.73 the head drops off the edge, the stump at the edge
  bleeds and the jets leave it, 7.83 only the stump + cleaver; 9.3 / 10.1 the floor head in its pool (as #139).
- BUT strips/c2h_head_zoom.jpg (7.5): a pale RING on the head = the cut faces showing through an open seam. Cause: the
  head piece rides neck_02 while whole (head-carry.ts mounts ada_head_rig there), its rim 99.5 % on its own neck_stub
  bone, while the body's rim is skinned neck_02 0.583 / neck_01 0.252 / clavicles 0.165 — any neck pose tears the seam
  (posesearch.mjs SEAM metric, 959 rim pairs: the CLIP pose alone 22 mm, my first deltas 47 mm; my `head` delta also
  never turned the head piece). Fixes (dist3): (1) the head is posed through neck_01 (0, 0, 34) + neck_02 (−60, −20, 41)
  only (face·D 0.95, 91 % past the edge, 0 table/drape vertices); (2) ada.ts driveSeam: while whole, neck_stub follows
  the weighted motion of the rim bones from rest (SEAM_RIM) — 47 → 25 mm max (p50 10 mm); a full close needs the head
  stub skinned with the body's rim weights (lane A request); (3) skin.ts: while whole the two cap faces render as the
  first stroke's dark clotted wedge (0.035/0.006/0.005; C2-ESCAPE §2.1 "a dark wet seam, not yet anatomy") instead of
  the raw baked tissue rings; after the cut exactly as before. JET_CUT re-measured for this pose: (5.283, 3.278, 1.492);
  pulse-1/2 pool (4.43, 3.36). tests/smooth-c2-head.test.ts emulates the head-carry mount.
- c2h3 (dist3 = all of the above) was queued 15:45 behind 5 PERF/FLASH jobs and DROPPED unrun at 15:43 by the battery guard (14 %) — it
  only run on mains. TO JUDGE: the seam before 7.56 (dark crease, no pale ring), the contact frame, the fall, 9.3.
- gate2 (dist2): opening FIXED — walk-in crosses to y −18.35, T_B02_GATE fires, leaf blocks (0.27, −27.36), CP1 not
  pushed; the walk-out stopped at −28.93 against the dead sedan P_CAR_GATE parked across the road below the gate (body
  y −31.2…−29.2 at x 1.8) — my assertion (−29.5) was wrong for the layout, now −28.65 (past the posts).

- Tableau → C2 (lead (a)) on dist2: no pose pop at C2 0.033 (turn 0.3°, flick 20 on the cut frame only), BUT a light
  step: luma ×15.1 on the first C2 frame, then ×0.71–0.84 per frame for 5 frames (det/c2h-med f27–f32). The decay part
  PRE-EXISTS (scratch/glitchfix/c2r2, build6: grey 19.6 → 5.8 over the first 8 C2 frames); the step into C2 cannot be
  dated from that run (it starts on C2). Suspects: the gameplay meter → C2's fixed film exposure hand-over (exposure.ts,
  FLASH lane) and/or the #142(3) snap rule (C2 starts on the player's eye, so no snap is requested). OPEN — needs a
  same-state A/B on mains.
- Max pre-strike (c2h-max, dist2, strips/c2h_max_prestrike.jpg): the head reads at the edge as on Medium (+ the dist2
  pale-ring seam defect).
- To check on c2h3: the one-frame stub restore at the sever (driveSeam puts neck_stub back to rest on the first severed
  frame, 7.60 → 7.63; a 1–2 cm stub shape change on the falling head — if it reads, lerp it over 0.2 s); and the rise
  hand-off (the lift blends out over C2 22.2–23.1: the root slides 0.20 m east and the legs swing from hanging into the
  kneel while S10 frames her) — capture it with the window below.

### Build2 after-captures (processed 15:10)
- capG1 vs capB: C4c start 70→30° lens + 35° tilt in one frame → smooth push-in (FIXED); C4c end lens step gone, a 22°
  pitch snap on the first gameplay frame = the bot (playthrough.mjs:307 g.look(hd, 0); the game's `player` cue hands
  back the camera's −20°); C5 12.3–13.4 near-black frames 23 → 0 (FIXED); C5 29.8 torch-pool blink (6 frames ×0.3, draw
  dips) → steady (gone); C5b start 0.30 m / 10.3° → 0.10 m / 0.3° (FIXED).
- maxA / maxB (Max windows): no new whips/lens steps; C2c 0.27–0.6 (≤ 16.8°/frame) and C2b 10.27 (8°) = authored, same
  on Medium. NEW residual: C1 4.27–4.33 a point glint at the windscreen's top-left on alternate frames (Max flicker 55,
  Medium 18–26; strips/max_c1_427.jpg) — the radio-glance hold now frames the dash there (build0 was still on the road);
  likely a rain drop catching a light (cutscene-fx windshield rain). Not fixed.

## P_GATE follow-up (gate-check FAILED on build2, fixed 14:45)
- gate.log: CP1 not pushed (ok), but the walk-in from the road stopped at y −28.65 and the walk-out at −27.87, and
  T_B02_GATE never fired: the opening was walled. Cause: my farm_gate.collider proxy used TWO materials (posts
  'bark_wet', leaf 'rust') → glTF exported a Group of two primitives; the collider flag sat on the Group, the child
  meshes were treated as ordinary meshes and boxed — one oriented box over the both-posts mesh = a wall across the
  opening (collision.ts propColliderMeshes). Fix: one material ('dust_sheet', the convention of every other proxy) →
  one flagged mesh, baked exact. Rebuilt via assets.mjs: props 267 s + 7 dev bakes + encode, all ok; --check ok
  (26.99 / 53.91 / 77.25 MB). Re-check: gate2 (queued).

## HANDOFF — remaining FRAMES items if a successor takes over (state 15:45)
1. C2 head: on mains run (or judge the queued c2h3, if it ran)
     SCENE=C2 PRE=1 POST=0.5 WINDOWS='{"C2":[[0,12.5],[21.5,25.5]]}' node scripts/shot.mjs --no-build \
       --dist scratch/dist-smooth-frames3 --preset medium --wait 0 --shots 0 --width 960 --height 600 --timeout 3600 \
       --scenario scripts/qa/cs-frames.mjs --out scratch/smooth-frames/c2h3 --name cs
   judge: before 7.56 a dark seam (no pale ring) on an attached head; the contact frame; 7.60–7.67 (stub restore); the
   fall; 9.3; 21.5–25.5 the rise hand-off; detect.py; a Max still set; then the strict run on dist-smooth-frames3.
2. Done: capG1, maxA, maxB (above). NOT RUN (battery): capH (C6→C6b→C7→CR Medium) and maxC (Max C6 19.4–29.2 / CR 0–8) —
   re-queue on dist-smooth-frames3 (they verify the C6 pump/gate route, C6 start, C7 9.73 speed). For each: python3
   scripts/qa/detect.py <run>/<seg> --out scratch/smooth-frames/det/<RUN>-<seg>; python3 scratch/smooth-frames/events.py
   det/<..>; compare.py vs the baseline (det/C-C6-0, det/B-C4c-0, det/B-C5-1) by cutscene clock; strips of every fixed
   moment (C6 0.0 sweep, C6 1.6 lens, C6 22.3 pump, C6 26.27–26.8 gate, C6 31.0 stop, C7 9.73 speed, C4c start/end,
   C5 12.47 wall, C5b start).
3. maxA (Max C0/C1/C2c/C2b windows) — running at 10:45; check maxA.log, detect its segments.
4. Strict Medium playthrough (item 5) on the FINAL dist (dist-smooth-frames3): QA_STRICT=1
   node scripts/shot.mjs --no-build --dist scratch/dist-smooth-frames2 --preset medium --timeout 2400 --scenario
   scripts/qa/playthrough.mjs. (PERF fixed the 73 load-time copyFramebufferToTexture errors at 11:0x; c2h-med on dist2 had 0 console errors.)
5. Max C3/C4a start check (dropped maxD): optional, the bindings snap rule is preset-independent.
6. Delete scratch/dist-smooth-frames3 at the end (build2 and dist2 deleted).
