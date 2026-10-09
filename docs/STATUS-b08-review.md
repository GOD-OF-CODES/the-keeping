# STATUS b08-review (adversarial review of B08 fix)

- start: fresh attempt, dist scratch/dist-b08-review
- trees: scratch/b08-review/{oldgame-oldbot,newgame-oldbot,oldgame-newbot} (HEAD src/ai and/or HEAD bot, symlinked public/node_modules/.cache); runner scratch/b08-review/run.sh -> runs/ (A,B,C medium, then cur med x2, low, max). Started.
- FINDING 1 (bug in fix 2b): stimulus() compares the new stimulus with the LAST stimulus pos (inv.pos is overwritten each time), not the planned target -> a creeping stimulus (footsteps <1 m apart, slow torch sweep) never re-plans; she walks to the first spot. Fixing with an anchor planPos.
- FIX 1 applied: InvLayer.planPos (set on re-plan + listen->go); moved = dist(planPos, new) > 1 m. tests/beam-lure.test.ts test 5 (creeping 0.4 m steps) fails on builder version, passes now.
- npm test after fix: 191 pass, 2 fail (known materials-library). typecheck clean.
- A (HEAD src/ai + HEAD bot, Medium, current assets): REPRODUCED STALL in B08: task "wait by the bell", Ada LOOK/sight at (5.58,4.29) U2, 0.7 m from bot (6.1,3.84) = builder stall #2 (beam LOOK at lens). 1 death in B06.
- B (builder src/ai + HEAD bot, torch on): B08 passed in 26.5 s game, 1 death in B08 -> game fix alone clears the stall.
- B hung after "beat B11" (no log 17+ min wall, no STALL line) — killed it to free Chrome for other lanes; B08 evidence already in. B11 hang to be checked against C/cur runs.
- C (HEAD src/ai + NEW bot): B08 passed in 26.2 s, 0 deaths -> the new bot policy (torch off in B08) alone also avoids the stall: the playthrough no longer exercises the beam bugs; only tests/beam-lure.test.ts guards them.
- CONTRACT-CHANGES #40 amended (planPos review fix).
- cur-med1 (repo incl. planPos fix, Medium/WebGPU): ENDED 370.1 s game, 0 deaths, 0 console errors, B08 26.8 s.
- cur-med2 (Medium/WebGPU, 2nd in a row): ENDED 378.2 s, 0 deaths, 0 errors, B08 26.9 s.
- cur-low (Low/WebGPU): FAILED — stalled in B10 (480 s game), 0 deaths. Investigating.
- cur-low stall detail: bot (not Ada) physically stuck at G3 (8.42,10.74,z0.77) on task "can" (P_JERRY_10), UNSTICK -> k_door loops; Ada patrolling upstairs. Medium runs on same dist pass B10 in 9.4 s. Not AI-related on its face; rerunning Low after Max.
- cur-max (Max/WebGPU): ENDED 381.4 s, 0 deaths, 0 errors, B08 26.5 s. Rerunning Low (cur-low2).
- cur-low2: SAME stall in B10 at (8.42,10.74,0.77) (reproducible on Low only). Low/medium props_m1/m2 glb rewritten by the opening lane at 23:22, after builder low4 (22:42). Running C tree (HEAD src/ai) on Low to show it is not the AI change.
- C-oldnew-low (HEAD src/ai, Low, same dist assets): SAME B10 stall at (8.42,10.74,0.77) -> the Low B10 stall is NOT from the B08 AI fix; it comes with the current Low assets (props/collision rewritten at 23:22 by the opening lane, after builder low4). Bot stuck at the foot of the back stair below D_BACKSTAIR, heading for k_door. Handed to lead/opening lane.
- fix 3 x B11 check: seesLocket() is evaluated before seesPlayer()/onSeen() (ada-brain ~677) -> looking at p.eye cannot turn the locket standoff into a chase. OK.
- bot: QA_TORCH_ON=1 flag added to scripts/qa/playthrough.mjs (skips the stealth torch-off rules) so a torch-on e2e regression run still exercises the light senses. Will run it on Medium after B2.
- B2 (builder src/ai + HEAD torch-on bot, Medium, rerun): ENDED 398.1 s, 1 death (B08), B08 51.3 s, B11 70 s -> run B B11 hang was a one-off (it ran with Blender + 2 queued lanes). Next: cur-torch-med (QA_TORCH_ON=1, final code).
- cur-torch-med (QA_TORCH_ON=1, final code, Medium/WebGPU): ENDED 381.7 s, 1 death (B06), B08 27.2 s / 0 deaths, 0 errors.

## HANDOFF (review done)
- Root cause confirmed in part: HEAD src/ai + HEAD bot (run A) stalls in B08 with an endless beam LOOK at 0.7 m
  (builder's stall #2; stall #1, the lure cancelled through the wall, was not seen in my run but is covered by test 2).
  Builder AI + HEAD torch-on bot (B, B2) clears B08 (26.5 s / 51.3 s). The game fix works on its own.
- The new bot hides the bugs: HEAD AI + new bot (C) also passes B08 (26.2 s, 0 deaths). Default e2e runs no longer
  exercise the light senses. Added QA_TORCH_ON=1 so a torch-on regression run is still possible.
- Bug found in fix 2b and fixed: the re-plan distance was measured from the previous stimulus, so a creeping source
  never re-planned. Now measured from InvLayer.planPos. tests/beam-lure.test.ts test 5 covers it (fails on builder code).
- Runs on final code: Medium x2 ended, 0 deaths; Max ended, 0 deaths; Medium torch-on ended. Low FAILED twice:
  the bot gets stuck in B10 at the foot of the back stair (8.42,10.74,0.77). HEAD AI also stalls on Low (C-oldnew-low),
  so the B08 fix did not cause it. Likely cause: the in-flight Low props/collision rewrite from 23:22.
- npm test (final): 195 pass / 1 fail (known materials-library calibration); typecheck clean.
