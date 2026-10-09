# STATUS — lane b08 (story/QA debugger: playthrough stalls in B08)

dist: scratch/dist-b08 (current assets), scratch/dist-b08-old (same build, medium assets from 73b894b = pre-0faebb9)
out: scratch/b08/

## Diagnostics (kept; not live work)
- Diagnostic scenarios: scripts/qa/diag-u2.mjs (colliders + walks on the U2 route), scripts/qa/diag-bell.mjs
  (stimulus log at the bell), scripts/qa/diag-beam.mjs (beam vs camera).
- playthrough.mjs now logs every Ada stimulus (noise source / beam) + lure start (`stimuli` in the report) and the
  torch state in the Ada trace.

## Findings so far
- Clean B08 start, player at the bell, torch on facing north: the lure works (LURED/scrape in G1 for 60 s).
- Playthrough stall: lure starts, then within ~1 s an INVESTIGATE stimulus replaces it (stimulus() sets lure=null).
  She then oscillates (4.5,2.9)↔(5.3,3.5) in U2 (nav.toPoint re-plans on every stimulus: key includes inv.t0, and a
  re-plan from a free leg walks back to the nearest graph edge first), then LOOKs at the stimulus forever; the bot
  (0.7 m away, outside her cone) is never seen or bumped.
- (attempt 3) r1 run (current assets, 21:05) DID reach the ending but B08 took 97 s game / 5 deaths. Its stimuli log:
  in B08 every lure is cancelled by a BEAM stimulus @ (6.1,4.5,4.1) = the north wall / P_BELL_PULL, 0.46 m in front
  of the bot standing at u2_bell (6.1,4.0) with the torch on. beamNear() fires whenever Ada is within 6 m → INVESTIGATE
  replaces the lure (stimulus() sets lure=null). Open question: why didn't this happen before 0faebb9 (arms beam bone?).
- FIX 1 (src/ai/senses.ts beamNear + ada-brain): the beam-near INVESTIGATE now needs line of sight from her chest to
  the lit spot (backed 0.1 m off the surface). FIX 2 (ada-brain stimulus()): a repeated stimulus within
  TUNING.stimulusReplanM (1 m) of the current one no longer clears nav.goalKey (stops the re-plan oscillation).
- tests/beam-lure.test.ts added (3 tests): beamNear LOS unit; Director-level B08 lure with torch on the bell wall
  (FAILS on the old beamNear, passes with the fix); same-spot stimulus keeps the route. Next: full npm test, bot fix.
- A/B beam (diag-beam, B08, goto bell): old assets (pre-0faebb9) and current assets give IDENTICAL beam aim/hit
  (hit 4.57 m, yaw ~2°, pitch ~-2°). So 0faebb9 did not move the beam; the beam-through-wall flaw is pre-existing
  and the stall is stochastic (depends on where Ada is when the lure starts / how the timing falls). Old runs too
  took 27–51 s and 1–2 deaths in B08. Root cause = game logic (beamNear w/o LOS + re-plan oscillation), not assets.
- per-beat timing added to playthrough (beatTimes + log line). Running full playthrough m1 (game fix only).
- m1 (game fix, bot unchanged): new stall in B08: Ada at (5.6,4.27) U2, 0.7 m from bot (6.1,3.84), torch on → endless fast LOOK (beamTouches) and never sees/bumps the bot; lure pulls can't break it. Investigating seesPlayer/LOS there.
- diag-look (Ada teleported to 5.6,4.27): she walks off and then oscillates (5.4,2.8)↔(4.4,3.0) in U2 while INVESTIGATE — the oscillation is in nav/inv 'go', not only stimulus re-plans. Reading nav.toPoint.
- FIX 2b: the investigate route key was `inv:${id}:${t0}` and stimulus() bumps t0 every time → re-plan every 2.5 s
  regardless of goalKey. Now keyed on a plan generation bumped only when the target moves > 1 m (test 3 catches it).
- Stall #2 cause: beam on her body → fast LOOK toward p.beam.origin (the torch LENS, held ~0.5 m ahead of the
  player). At 0.7 m the lens is ~60° off the player's eye → outside her 30° cone → she never sees the player, and the
  beam keeps touching her → LOOK forever (lure can't break it). Fix: LOOK toward the player's eye (the torch's holder).
- FIX 3 applied (beam LOOK toward p.eye); test 4 reproduces the endless LOOK on the old code. Running npm test + playthrough m2.
- m2 (Medium/WebGPU, fixes 1-3, bot unchanged): ENDED, 409.9 s game / 195 s wall, B08 51.5 s with 2 deaths, 0 console errors.
- bot: torch off in B08 (design hint 'Flashlight off near her'); m2's 2 B08 deaths were the bot walking/waiting lit near her.
- m3 (Medium/WebGPU, final code): ENDED 371 s game / 148 s wall, 0 deaths, B08 26.3 s, 0 console errors. Next: m4, low, max.
- m4 (Medium/WebGPU): ENDED 371 s / 0 deaths / 0 errors (2 in a row with m3).
- low1 (Low/WebGPU): ENDED 371.6 s / 1 death (B08) / 0 errors.
- max1: B08 passed in 25.5 s (B09 reached, 0 deaths) but shot.mjs hit its default 420 s overall --timeout on Max (slow load). Rerunning with --timeout 900 in background.
- CONTRACT-CHANGES #40 written. Bot: generic stealth rule — crouch in B05/06/08/09/10 when Ada is on our floor within
  4 m and not LURED/CHASE (low1's single death: the bot walked hammer→bell past her at B08 start). Laptop went on
  BATTERY (30%) during max2 — correctness valid, perf numbers not.
- max2 (Max/WebGPU, battery): ENDED 373 s game / 375 s wall, 1 death (B06), 0 console errors. Rerunning Low + Medium with the final bot (crouch rule).
- low2 (crouch rule): ENDED, 1 death at B08 start (first step before the crouch ramp = 4 m footstep, Ada 3.3 m away right after C3). Bot now crouches 0.6 s before moving when she is within 5 m.
- low3: ENDED, 1 death in B06 (bot crouch-walking with torch ON next to her). Bot: torch off in B05-B07/B09/B10 while she is on our floor within 8 m and not LURED. Final verification set starts now (low4, m5, m6, max3).
- m5 (Medium, final bot): ENDED 372.9 s, 0 deaths, 0 errors.
- m6 (Medium): ENDED 371.6 s, 0 deaths, 0 errors (m5+m6 = 2 in a row, final code).
- low4 (Low/WebGPU, final): ENDED 381.8 s, 0 deaths, 0 errors. Starting max3.
- max3: shot.mjs TIMEOUT while waiting for the opening lane's Blender job (never started). Retrying (max4, --timeout 2400).
- max4 (Max/WebGPU, final): ENDED 374.1 s game / 453 s wall (ran alongside the opening lane's Blender), 0 deaths, 0 errors.

## HANDOFF (done)
Root cause (NOT the 0faebb9 assets — A/B on old vs new medium assets gives identical beam aim/hit; the stall was
stochastic, old runs also lost 1–2 lives in B08): three Ada light/investigate logic flaws in src/ai:
1. beamNear() had no line of sight → a torch spot on the U2 wall by the bell pull drew her back through walls/floors
   and spent the lure (stimulus() nulls the lure). Now needs LOS from her chest to the spot.
2. investigate route key `inv:id:t0` + t0 bumped on every stimulus → re-plan every 2.5 s → oscillation in place.
   Now keyed on a plan generation bumped only when the target moves > TUNING.stimulusReplanM (1 m).
3. beam-on-body fast LOOK aimed at the torch lens (~0.5 m beside/ahead of the eye) → at arm's length the player was
   outside her 30° cone forever → endless LOOK, lure can't break it. Now LOOKs at the player's eye.
Bot (scripts/qa/playthrough.mjs): stimulus/lure log, torch state in trace, per-beat timing (report.playthrough.beatTimes
+ a log line), and asset-independent stealth rules: torch off in B08 and whenever Ada is on our floor within 8 m
(B05–B07, B09, B10, not LURED); crouch (after a 0.6 s crouch ramp) when she is within 5 m.
Proof: m5 + m6 Medium/WebGPU ended (0 deaths), low4 Low/WebGPU ended, max4 Max/WebGPU ended; 0 console errors in all;
m2 (game fixes only, old bot torch policy) also ended → the game fix alone clears the stall.
npm test: 190 pass, 2 fail (the known materials-library ones). Tests: tests/beam-lure.test.ts (4; 2,3,4 fail on old code).
Diag scenarios kept: scripts/qa/diag-{u2,bell,beam,look}.mjs.
- Hero shot check: m6 harlan-bedroom (torch off by the stealth rule) is lamp-lit and readable — no regression vs r1.
- Caveat on "not the assets": the A/B only rules out a geometry/beam difference at the bell; why all new-asset runs
  stalled vs old ones ending is not proven — most plausibly timing/perf (frame dt → where Ada is when the lure starts).
