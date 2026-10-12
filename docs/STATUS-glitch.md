# STATUS — GLITCH-FIX lane (user report 2026-10-11 21:15)

User: "the beheading still has glitches and isnt smooth enuf, plus the end of the car ride in the first cut scene has
the glitch of road disappearing and re appearing" → JERKY MOVEMENT, POP / FLICKER, FREEZES / STUTTER.
Live build e65bfa5 = scratch/dist-glitch (before). My dist: scratch/dist-glitchfix. Work dir: scratch/glitchfix/.
Tools: scratch/glitchfix/strip.py <seqdir> <out> [--crop w:h:x:y] [--cols n] [--size WxH] frames… ;
scratch/glitchfix/camsweep.ts (per-frame camera turn of C2/C2c from the timelines, no Chrome);
scratch/glitchfix/c1end.mjs (C1 end on C1's own clock, road/terrain draw presence per frame, stills every 0.1 s).

## Findings (live frames scratch/glitch/seq, frame n ↔ rows[n] in scratch/glitch/c2frames.log)
1. HEAD PICKUP POP (C2 10.6, f316→f318): confirmed — the head on the boards vanishes and is in his fist above frame
   two frames later (strip scratch/glitchfix/b_pick.jpg). Cause: `attach` at 10.6 hangs it under prop_l at once.
2. HEAD FALL (C2 7.6–7.9): code drops it in 0.30 s with y ∝ u² (a = 2h/T² ≈ 1.7 g). The lead's f265/f267 "on the
   table → floor" is the camera lurch D → E4 (8.6–9.3) tilting from the stump on the table to the head on the boards:
   CONFIRMED by the per-frame head log (scratch/glitchfix/diag1.log ROWS): the head node is static at plan
   (5.239, 3.161, 0.67) from 7.9 until the nudge at 9.45 while the camera moves 0.1 m/frame 8.8–9.1. Not a head pop.
3. C2 22.27–22.8 "door judders" (f670–677): the S10 camera's Catmull-Rom TARGET path passes 0.55 m from the eye →
   the look whips 10°/frame and dips to −44° pitch (camsweep). Glitch.
4. C2 25.7 (f768→769): S10 → S11 boundary jumps the look 23° in one frame (S10 holds on ADA_RISE, S11 starts on
   ADA_WALK[2]). Glitch (no authored cut).
5. C2c camera whips from target paths near the eye: 4.567–4.6 (83°/frame), 6.73–6.77 (29°, 74°), 6.867 (26° jump
   at the glance-#2 boundary), 7.53–7.57 (47°, 60°). 3.63–3.77 = the authored 150° look-back (out-ease, 59°/frame)
   + the fanlight lightning pulses.
6. C2 17.97 (f536–538): CONFIRMED (diag1 ROWS): at 17.9 Harlan's root yaw snaps 0.321 → −0.482 rad (−46°) in one
   frame, his fist (prop_l) jumps 0.33 m sideways, the held head with it, her hair whips over his sack.
7. C2 19.07 (f570): it is the KEROSENE LAMP (not the candle) that vanishes for one frame — reproduced in diag1
   (d-07-t19.067.jpg, strip dg_lamp.jpg) with L_LAMP_PARLOR at 11.95 cd, fade 1, flame visible: Harlan's walking leg
   crosses the line camera → lamp for one 33 ms frame (lamp 0.07 m off his body line). Physical occlusion, not a
   light/visibility bug (re-checked after the 17.9 turn fix changed his walk).
8. Cleaver white card: NOT the room cube (diag1 A/B d-01/d-02: identical with setupEnvironment removed). The blade's
   flat is one plane (box, 24 verts; albedo at its UVs sRGB 131 = linear 0.23, roughness 0.35): the lamp's GGX lobe
   (α ≈ 0.12, ±7°) covers the whole 4° × 10° face at once → a uniformly white card whenever it mirrors the flame.
9. C1 end — CONFIRMED on the live build (scratch/glitchfix/c1before.log + stills c1before/, strip c1b_strip.jpg),
   C1's own clock, per-frame screen draws: rc9_road (5) + rc9_paint (1) drop to 0 at C1 55.617 (mid-S8, the POV
   crosses dHouse 70 m: the road through the windscreen is replaced by lit grass), back at 69.017 (car_mount off
   releases the yard cull; culling is off in C1 so room_RC9 shows), gone again at 75.0 (hand-off: EXT1's PVS has no
   RC9). The same 55.6 frame also pops the yard dressing in (terrain 22→42, trees 21→30 draws).
   Live C1 50–75 budget (all passes, Medium): max 674 draws / 1.80 M tris at 73.85 (S11, torch on, RC9 visible) —
   OVER 400 / 1.5 M already before any change.
10. Characters' root yaw SNAPS on the first frame of a heading:'path' move (movecheck.ts): Harlan −46° at C2 17.9
   (in frame: the held head + her hair whip = the "pale shape" at f536–538), +31° at 20.2; Ada +52° at 24.5 (in
   frame), −16° at 28.4; C2c Ada 12° at 3.87 (glance #1).
11. Harlan's clip never reaches the head: his left fist bottoms out at plan (5.46, 3.62), 0.41 m above the boards,
   10.7–10.95, 0.72 m from HEAD_REST (bonetraj.mjs / handtraj.mjs on medium/harlan.glb).

## Done (code; verification runs pending)
- C1 road: `src/world/yard-cull.ts` — rc9_road + rc9_paint moved out of room_RC9 into `rc9_surface`, drawn whenever
  the viewer is outdoors (cutscene or gameplay, `glimpses.ts` → `yard.surface(level.isOutside())`); the RC9 mask /
  near-house dressing rule now changes only on a camera CUT (> 6 m jump), never mid-shot; `glimpses.ts` keeps the
  yard cull running from the car-unmount (69.0) to the camera release (was released at 69.0).
- C2 pickup: `c2-room.ts` S4 hold 9.3–10.25, eye lifts to his squatting sack 10.25–10.75 (SACK_LOW), S5 10.75–12.9
  follows the lift; grip/attach/held/faceFill at C2_GRIP 10.75 (hair_wring 10.72) — off-frame transfer, no cut.
- C2 head fall: `cutscene-fx.ts` real g with the blade's ≈ 1 m/s push (lands on the 7.9 sound), bounce e 0.2,
  3 cm skid, 5° rock decaying.
- Root-yaw snaps: new optional `MoveTrack.turnIn` (types.ts + sequencer.ts, contract #139) used on Harlan 17.9/20.2,
  Ada 24.5/28.4 (C2) and Ada 3.84 (C2c).
- Camera: `math.ts` sweepTargets/turnBetween; C2 S10 split (1.0 s sphere sweep door → her rise, hold, follow her
  24.6–25.7 into S11 — no floor dip, no 23° jump); C2c 4.47 / 6.62 / 7.45 sphere sweeps (single-frame 83°/74°/60°
  pops gone; 6.62 now ends exactly on glance #2) + Max blur during the four authored whips.
- `story-runtime.ts`: Harlan updates before Ada (the held head no longer lags his fist by a frame).
- C2 S9 rope whip: starts from S8's last look (was a 27° one-frame jump at 20.0) and follows the rope up and round on
  a sphere to a point 0.45 m off pulley 3's foot — the look went through the ZENITH (88° pitch, heading flipped 236° in
  one frame at 20.25: lookAt's up-vector degenerates → the frame spun); now ≤ 74° pitch, ≤ 22°/frame.
- Cleaver (`loader.ts` steel_cleaver): patina ≈ 70 % of the flat (was ≈ 45 %), forge/grind waviness bump ±0.4 mm /
  3 cm (±4° normal slope, Mikkelsen surface gradient) so the lamp's mirror image breaks up instead of whitening the
  whole plane. To verify on stills (diag2).
- NEW tests/glitch-c2.test.ts (lane C dir, new file): no root-yaw snaps > 8°/frame, no look turn ≥ 60°/frame outside
  the insert's hard cuts, no pitch ≥ 80°, S10/S11 off the floor and ≤ 20°/frame, grip at C2_GRIP, sweepTargets maths.
  npm test 272/272 before the new file.
- C2 11.87–11.97 (f353–357, "spatter jumps"): the old S5 tilt at its peak speed (3.5°/frame) with the cleaver's white
  flash — camera motion + the cleaver material, not a spatter pop.
- C2c 8.3–9.0: the torch pool riding the 12° beam clamp + run bob on the scramble (several frames each, no pop).
  C2c 9.53 → ≈ 11.6: the torch pool LEAVES THE FRAME in one frame and the view stays black ≈ 2 s at the top
  (f1153→1154) — diag2 queued (torch position vs camera, intensity, arms clip). C2c 13.2–13.5 = the U1 window stroke
  (12.9 + pulses, 0.18 s decay): designed lightning.

## C1 verification (Medium, scratch/glitchfix/c1after.log + stills c1after/, strip c1a_strip.jpg)
- rc9_road present on every frame of S8/S9 and gameplay (before: 0 draws 55.617–69.0 and from 75.0). RC9 mask now
  switches once, at the S9 cut (56.617). Remaining BLINK lines = frustum culling of road primitives that leave the
  frame (S10 62.0–69 the camera faces the house; S11 71.55–71.8 looking down the drive) — stills 71.57/71.67 show no
  road in frame, nothing pops. The S8 POV at 55.57/55.67 keeps its road (before: lit grass).
- Budget C1 50–75 all passes, max draws/tris per shot, before → after: S8 373/0.94M → 373/0.92M; S9 441/1.18M →
  447/1.19M (+6 = the road surface the car now rolls in on; S9 was already over 400 in 105 frames before);
  S10 498/1.36M → 506/1.38M (1 frame, the lightning flash 63.217); S11 69–73.6 615/1.50M → 295/1.08M;
  73.6–75 674/1.80M → 343/1.37M; gameplay 75–80 639/1.64M → 314/1.22M. Probe of S9/S10 attribution queued.
- Max (c1max.log): same blink pattern (frustum only); C1 50–75 ≤ 500 draws / 2 M except ONE frame, the lightning
  flash 63.217 (509 d / 1.53 M); S9 447 d / 1.34 M; S11 297–347 d; gameplay 318 d.
- Gameplay road (probe-glitch vs probe-glitchfix p-04-road-east.jpg, strip scratch/glitchfix/pr_cmp.jpg): standing on
  the road at the gate looking east, the live build's asphalt ENDS a few metres past the car (x = 20 m, the EXT1
  strip) in a flat grey field; now the road runs on to the horizon. The corridor's pine walls are still absent in
  gameplay (EXT1's PVS has no RC9 — lead-owned layout; request below).
- S9 attribution (probe-glitchfix FRAME 59.0, Medium): 445 draws = view 401 (the mounted detailed car interior
  sedan_interior_* drawn through the windows from the far verge, house glass, the vacancy plate…) + headlamp shadow
  29 + post 15. Live 439 (S9 was over 400 before this lane). Not changed here (opening lane's mount); request below.
- Capture artifact (not a game bug, both builds): the C0 title/byline/date cards stay on screen in STEPPED captures
  (CSS opacity transitions; loop stopped) — gone in the real-time C1 run (rt/c1-medium-01-end.jpg).

## C2 → C2c verification round 1 (c2after: dist build4, Medium, every frame at 30 fps; detect → detect_after.txt)
- Pickup (strips a_pick1.jpg, a_pick2.jpg): f305–311 the head lies face-up, f313–318 the eye lifts to his squat
  (≤ 8°/frame), f320–330 hold on his sack while he grips off-frame, f334 (11.17) the head rises into the frame on its
  hair and the tilt follows it up — no teleport. detect still flags 10.5/10.6 = the tilt itself (frame content moves).
- S9 whip (a_s9.jpg): continuous from S8, along the ceiling, no zenith spin. S10 (a_s10.jpg): no floor dip, but the
  near parlor door panels still slid past at 15°/frame → round 2: sweep 1.0 → 1.4 s (≤ 11.1°/frame).
- Cleaver: the 8.47 lowering (blade turning 5°/frame, offline rottraj.mjs) still flashed one frame as a pale card
  (a_clv.jpg f252) → round 2: bare steel only as wipe streaks along the blade (≈ 30 %), the rest dull oxide.
- C2c 4.53–4.6 / 6.6–6.83 / 7.53–7.6: the authored whips now spread over 4–5 frames (no single-frame jump); their
  per-frame views differ a lot by nature (150° in 220 ms). 7.567–7.7 the GLOVES fill the frame: arms_stumble_catch →
  arms_run_torch (lane A's clip; identical in the live build b_c2c75.jpg) — not a camera/pop issue.
- C2c 9.53 → ≈ 11.6 BLACK (diag2: torch 2000 cd, on, beam·view 0.999, room U1 constant): the torch light rides 0.56 m
  ahead of the eye and topB stood 0.55 m from the landing's north wall (WU_U1N face y 9.0) — the light went INTO the
  wall at 9.53. Fix: topB (0.75, 8.45) → (0.72, 8.2) (c2c-up.ts). CONFIRMED by probe-c2c-normal (build5, C2c 9.6,
  strip pc_strip.jpg): camera plan y 8.38 → the light ≈ 8 cm from the wall face, inside the torch shadow camera's
  near plane (flashlight.ts near 0.08 m): black with the torch shadow on, a lit pool with it off. With topB at 8.2 the
  light stays ≥ 0.24 m off the wall. (The probe's third step — toggling castShadow at runtime — crashed the probe
  itself, exit 2; the game logged 0 console errors.)
- C2 19.067: still the lamp hidden one frame by his walking leg (physical occlusion).

## C2 → C2c verification round 2 (c2r2: dist-glitchfix2 = build6, Medium; detect → scratch/glitchfix/detect_r2.txt)
- C2c top (r2_top.jpg): the torch pool now stays on the landing wall 9.4–11.3 (was black 9.53–11.6).
  NEW: f1209–1213 (11.367–11.5) the pool vanishes again for ≈ 4 frames during the slow turn (r2_top2.jpg).
  probe2 (dist-glitchfix2 build7): arms hidden → still dark (arms ruled out); NOT wall proximity — lit 11.233–11.333
  with the lens 0.21–0.23 m off the wall face, dark 11.367–11.5 at 0.23–0.27 m; the beam ray hits U1_1 at 0.22–0.36 m
  throughout (a raycast ignores draw visibility). probe3 queued (time-boxed, lead): torch intensity, shadow update,
  view-caster-cull deltas + culled names, U1_1 effective visibility, PVS room; A/B __vcMode off / forced redraw.
- Cleaver (r2_clv.jpg): f250/251/253 dark steel with bright wipe streaks; the 8.47 glint (f252) is streaky metal now,
  not a white card. The blood coat on the edge half stays a lamp-lit red (the shared blood material).
- f257 → f258 (C2 8.6 → 8.667) Harlan's shirt/arm POPPED bright: M-A's lampFlag goes off at 8.6 while the lurch is
  still easing in (frame on him). Moved to 8.9 (his torso has left the top of the frame by f265; the flag's shadow
  only covers 0.9–1.7 m above the boards, his legs are below it).
- S10 (r2_s10.jpg, f668–679 consecutive): the near parlor door now slides monotonically right with the CCW turn —
  no back-and-forth judder.

## Real time (FREEZES / STUTTER), fresh headless profile, AC power, no Blender at start
- Medium C2 → C2c → B05 + 5 s (dist build5; scratch/glitchfix/rt-c2-medium.log): 2758 frames / 47.8 s, 57.7 fps,
  p50 16.7 ms, p95 16.8, p99 33.4; frames > 33 ms: 112, ALL 33–34 ms (one missed vsync), 0 node builds in any of
  them, 0 long tasks; frames > 50 ms: 0. They cluster in C2 2.2–10.45 and 11.5–15.0 (the lamp-lit parlor close-ups
  at ≈ 16–17 ms GPU) — no compile/GC/upload stall anywhere; C2c and B05 have none.
- Max same walk (rt-c2-max.log): 2687 frames, 56.2 fps, p50 16.7, p95 33.3, p99 33.4; 181 frames at 33 ms (C2 0–15
  and 19–26), 2 frames at exactly 50 ms (3 vsyncs): C2 0.18 (the first real-time frames after the stepped walk: one
  65 ms long task at the loop start — the #134 tool-artifact class) and C2 26.67 (S11, 0 node builds, no long task).
  Nothing > 50 ms; C2c / B05 clean.
- LIVE build e65bfa5, Max, same tool (rt-c2-max-live.log): 55.9 fps, 196 frames at 33 ms, 2 at 50 ms at OTHER times
  (C2 0.5 = the start, C2c 6.97), 0 builds, 0 long tasks. So the lone 50 ms frames are sporadic GPU-edge hiccups (the
  parlor runs at ≈ 16.7 ms on Max), not a deterministic compile/GC/upload stall; this lane's build is no worse
  (181 vs 196 missed-vsync frames).
- Medium C1 44 → 75 + 5 s gameplay (rt-c1-medium.log): 2155 frames / 36 s, 59.9 fps, p99 16.8 ms; ONE slow frame,
  the first after loop.start (50 ms, a 57 ms long task: the stepped-walk drain artifact, #134); the end of the drive,
  the gate, the step-out and the hand-off have none. Still at the hand-off (rt/c1-medium-01-end.jpg): the C0 title
  cards are gone in real time — their persistence in stepped captures is a capture artifact.
- Max C1 44 → 75 + 5 s (rt-c1-max.log): 2153 frames, 59.9 fps, p99 16.8 ms; 4 frames of 33 ms (C1 50.x ×1, 70.x ×3:
  the step-out), 0 builds, 0 long tasks, nothing > 34 ms.

## Gate runs
- Playthrough (dist-glitchfix2 = build6, Medium, scratch/glitchfix/play.log): ended=true at B13 (game 550.5 s, wall
  219 s), deaths 0, console errors 0 / exceptions 0; M-A optional: C2b not triggered, C4a played (B08), C5b played (B12).
- Max C2 → C2c → B05 real time on build6 (rt-c2-max-final.log): 56.2 fps, 182 frames at 33 ms, NONE > 34 ms,
  0 builds, 0 long tasks, console errors 0.
- assets.mjs --check ok (Low 26.99/27, Medium 53.89/60, Max 77.20/120 MB); npm test 277/277 (incl. glitch-c2.test.ts).

## Lead note 2026-10-12 (M-A AD #141)
- glimpses.ts: the AD's fix (roadHeld ends once the held camera is inside the house — my #139 roadHeld kept the road /
  yard cull through a chained C6 → C6b and hid every indoor prop in C6b's cleat shot) is kept as is (re-read from disk).
- Final gate re-confirms the C1 road on the current tree and adds C6 → C6b stills to the playthrough
  (scratch/glitchfix/play-c6b.mjs wraps scripts/qa/playthrough.mjs unchanged; __game.capture at C6 3.0, C6b 1/4/7/9/11/12.5).
- Not taken on (lead): C7 2.2 s / C6 18.8 / C5 0.03, 12.9 / C4c 5.53 real-time stalls.

## Left
everything above; real-time frame-time runs (Medium, Max); gate.
