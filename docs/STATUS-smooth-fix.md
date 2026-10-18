# STATUS — SMOOTH-FIX lane, round 1 (contract #145; later rounds 145b …)

Fixer for the hunt findings F1–F10 (scratch/hunt, docs/STATUS-smooth-frames.md). Dist: scratch/dist-fix (diag, the tree
before my edits) / scratch/dist-fix2 (after). Work dir: scratch/fix/. NOT mine: exposure.ts, flashlight*.ts,
flashlight-rig.ts, arms.ts (FLASH lane, in progress), blender/characters/scare_*, death.ts (JUMPSCARE).

## Tools added
- scripts/qa/cs-frames.mjs ROWS now also carry `ex` (the applied exposure), `tl` (torch light PLAN pos, intensity, on)
  and, with `PROBE=n`, `hl` = [mean, max] PRE-exposure HDR scene radiance of the centre 62 % of every n-th frame
  (look.hdr, the meter's own texture) — what each shot's exposure must be is read from these.

## Runs
- diag (17:3x, dist-fix = tree before my edits, Medium, FPS 10, PROBE 1, patient bot): C0 C1 C2 C2c C2b C4a C4 C4c C5 C5b
  C6 C6b C7 — the exposure / radiance / torch-position baseline.

- after1 (18:02–18:16, dist-fix2 = the tree at 18:01, Medium, FPS 30, patient bot, SCENE C0 C1 C2 C2c C2b C4a C4c C5 C5b
  C6 C6b C7 → CR; 0 console errors; det/a1-*). Edits at 18:16–18:22 (C2 hand-off 1.0 → 0.6 s + the beam lowered,
  C2c arms clip from 8.4, C1 69.9 ramp, tail-lens chrome, the probe grids follow lmScale) are NOT in it.
- RESTART 19:40 (the first agent hit an API limit at ≈ 18:22). after2 (19:50–20:05, dist-fix = the tree at 19:50, same
  env, all 12 scenes → CR; 0 console errors; det/a2-*).
- after3 (dist-fix3 = the tree at 20:12, SCENE C1 [68.5–72.5], C2 (+C2c 2 s), C2b, C4c; 0 console errors; det/a3-*). Two
  earlier attempts died in the LOAD (headless Chrome connection closed at C1 36 s; 'load stalled 300 s' at shader
  compile / sound synth) while Blender jobs from other lanes ran, on battery (load average 14–22) — environment, not
  game errors (0 console errors each). A Max C2 run (max3) stalled the same way at 'Baking light probes — ground'.
- after4 (C2 0–1.5 s with the DOF rack-in; 0 console errors; det/a4-C2-0): the first C2 frame ×1.30 (after3 ×1.48;
  the walk-in trend is ×1.12 a frame), then the fade as after3. strips/f1_c2_handoff_ba.jpg (hunt vs after4).
- after5 (C2 0–2 s, an experiment: S1 ease 'decel' instead of 'out'): first frame ×1.25, but the walk-in then slowed to
  0.86 m/s (from the player's 1.6; 'out' keeps 1.29) → REVERTED to 'out'. What it showed: the first C2 frame moves the eye
  0.08–0.10 m (the player's own last step + the cutscene's first step: the sequencer's first rendered frame is t = dt,
  not 0) — a one-frame double step at every hand-off that starts on the moving player's eye (request 8).
- max5 (Max, C2 windows 0–1.5 / 19.8–23 / 27.3–29; 0 console errors; det/m5-*). NOTE: built with the 'decel' S1
  experiment (reverted after): the F1 window's walk-in speed differs from the final tree, the torch fade / exposure ramp /
  DOF rack are the same; F5 and F6 are unaffected. F1: 0.0078 → 0.0089 | 0.0108 (×1.21) → 0.0119 → 0.0132 → 0.0131 →
  0.0123 → 0.0101 → 0.0073 → 0.0050 → 0.0040 → 0.0034 → 0.0026 → 0.0022 (hunt Max: 0.0026 | 0.0262 ×10, decaying 10
  frames). F5: 20.6–22.3 0.0007–0.0009, 22.40 0.0003 one frame, 22.5 the pool 0.0127. F6: 27.6–28.9 a smooth ×0.7–0.9
  dimming to 0.0018. dist-fix3 deleted after it.

## after1 numbers (luma = detect.py mean linear luma; hunt = scratch/hunt/det, a1 = scratch/fix/det/a1-*)
- F2a cut frames (scratch/fix/cuts.py: cut frame vs the 2 after it, and the cutE hand-back at +0.1 s): ALL fixed, no
  step at the hand-back. C0 12.5 ×0.30 → 1.0 · 19.0 ×0.28 → 0.97 · C1 0 ×1.75 → 0.97 · 6.6 ×5.6 → 1.0 · 11.6 ×0.42 → 1.03 ·
  43.4 ×0.15 → 0.99 · 62.0 ×29.5 → 1.0 · 69.0 ×0.27 → 1.0 · C2b 3.0 ×7.2 → 1.0 · 7.0 ×0.41 → 1.0 · C5 6.2 ×0.34 → 1.0 ·
  10.0 ×2.7 → 0.98 · 25.6 ×44 → 8 (a fade from black: 0.0005 → 0.004 → 0.005) · C5b 3.5 ×1.85 → 1.0 · C6 7.5 ×0.52 → 1.0 ·
  8.4 ×4.9 → 0.99 · 10.4 ×0.18 → 1.03 · 27.8 ×20.5 → 1.0 · C6b 6.0 ×15.7 → 0.98 · 8.5 ×0.15 → 0.98 · C7 3.5 ×0.14 → 1.05 ·
  15.8 ×0.04 (0.235 white) → 0.98 · 16.8 ×172 (black) → 0.98 · 18.6 ×0.02 (0.416 white) → 0.98 · 22.6 ×23.7 → 1.0.
- F2b C4c flash-frame cut frames: 1e-4 (black) → 0.29 / 0.35 / 0.47 / 0.67 on the cut frame = the frames after it (no
  black frame). BUT those values are blown: since the 17:00 exposure fix (ROADMAP ar, pipeline.ts: exposure now scales RGB
  before AgX) every e < 1 film camera is brighter (C4c's 0.2: whole take ×3–5, flash-frames ×7–16; the hunt's 0.04 was
  the old post-tonemap dimmer). diag (17:3x, before my edits) already shows the same 0.27–0.67 → not from #145. The
  memory flash-frames are now exposed per set-up (below); the rest of the take is FLASH's look pass (request).
- F4 C1 S9: 56.9 ×0.70 / 57.07 ×0.40 (lamps out of frame) → ≤ 3 % per frame through 56.6–59.0; the lamps stay in frame.
  59.0–59.4 the beams leave the road as the car turns onto the verge (continuous ×0.85–0.93 per frame, no pop).
- F5 C2 hall: 20.5–22.3 1e-5 → 2e-4…9e-4 (door frame, fanlight, rope and stair rail readable); left: a dip to 2e-4 at
  20.5–20.6 (the ride opened after the whip) and 22.27–22.4 black at e 0.8–0.63 (Harlan's corner) → re-timed (below).
- F6 C2 door: 27.7 ×0.03 (one frame) → a smooth ×0.85–0.93 per frame dimming 27.6–28.9; left: 28.967 ×0.06 on C2's LAST
  frame (the 28.95 off cue) → moved onto the cut (below).
- F8 C2 head: face-up and still through E4 (scratch/fix/c2_head_after.jpg); the roll is done under S3 by 8.7.
- F9 C4a dolly 8.2–11.0: 0.0000 → 0.0028–0.0036 (window, sill, edges; scratch/fix/c4a_dolly_ba.jpg). The sheeted
  furniture still black → the probe grids now follow lmScale (after2: no measurable lift, 0.0024–0.0028 — the dark
  stretch is the AD's designed silhouette at e 1.2; the window, sill and board edges read; left as is, see requests).
- F10: C2 pre-roll 0 lit px in the objective box (was 0 → 1036 fading in); C2b pre-roll 0; C4a: the line is steady
  (555 px) and goes with the cut (no on/off/on, no swap). C2c 0.03 '48/94 px' = picture (the door frame), not the HUD.

## after2 / after3 numbers
- F1 C2 hand-off: hunt ×16 → after2 (0.6 s fade) first frame continuous but a 0.009 → 0.0255 → 0.0025 bump (torch pool
  on the approaching jamb) → after3 (0.3 s) 0.0082 → 0.0121 (first frame ×1.48: the DOF snapped on, see below) → 0.0142
  → 0.0161 → 0.0165 → 0.0154 → 0.0126 → 0.0077 → 0.0046 → 0.0033 → 0.0027 → 0.0025: no ×16 frame, no decay tail. The
  ×1.48 first frame = the opening dof cue at full bokeh (the jamb 0.5 m away went soft and the hot spot spread into a
  halo) → the bokeh now racks in over 0.6 s (after4).
- F2a / F2b / F4 / F10: as after1 (all cut frames continuous, C1 S9 ≤ 3 %/frame, objective line clean).
- F3 C1 step-out (after3): 69.0–70.4 the lens at 0.005 (orange-red lens median sRGB 154/79/54, was 197/121/93 salmon),
  70.53 one dark frame 0.00019 rising past the trunk (the navy flank and gravel still read), the drive from 70.8.
- F5 C2 hall (after3): 20.5–22.4 0.0003–0.0009 (was 1e-5 / after1 2e-4 dips), no black frame; the pool enters
  0.0003 → 0.0024 → 0.0088 → 0.0127 → 0.0117 → 0.0129 (after1 0.00000 → 0.0005 → 0.003 → 0.0065 → 0.0087).
  strips: scratch/fix/strips/f5_c2_hall_ba.jpg.
- F6 C2 door (after3): 27.6–28.93 smooth; C2's last frame 0.00142 (after1 0.00012, ×0.06) → the cut. strips/f6_c2_door_ba.jpg.
- F7 C2c (after2): 8.6–8.9 0.032–0.08 (hunt 0.00003; after1 0.0006): the pool stays in frame. Wallpaper sparkle remains.
- F8: face-up and still through E4 (after1/after2).
- F9 C4a dolly: 0.0024–0.0028 (hunt 0.0000), window/sill/board edges — see requests.
- C2b (after3): 0.0 cut 0.0070 → 0.0080 → 0.0090 (after2 0.0021 between, ×5.2); 9.5 cut 0.0062 → 0.0054 → 0.0058
  (after2 0.0027, ×2.6).
- C4c (after3): memory flash-frames 0.100 hem / 0.057 bell / 0.098 hatch wide / 0.047 hatch close (after2 0.29 / 0.35 /
  0.47 / 0.67 near-white, hunt 1e-4 black first frames), every cut frame = the next; the 3.3 shot 0.075 (her lit gown,
  her hands, the glove + locket glint) instead of 0.5 s of 0.0000. strips/f2b_c4c_ba.jpg, scratch/fix/c4c_a3_look.jpg.

## Findings → root cause → fix (source done 18:3x; after-capture `after1` on dist-fix2 queued — numbers below are pending)
- F1 C2 first frame ×16. ROOT CAUSE (diag `ex`/`hl`): the B03 eye sits at 0.066 with the torch on (scene radiance
  0.08–0.49); C2 switched the torch off and the exposure to its film camera 0.625 on the SAME frame. The scene texture of
  that frame is already dark (hl 0.012) — the ×16 was TAAU's history (the torch-lit haze, pre-exposure) shown at ×9.5
  exposure, decaying ×0.7–0.84 per frame. FIX: opening.ts `exposure {fixed, ramp}` eases from the exposure on screen
  (pipeline uniform) in log space (smoothstep, C2_HANDOFF_S — 1.0 s in after1, 0.6 + the beam lowered in after2, 0.3 s
  now: the walk-in carries the torch at the jamb, its pool brightened ×1.13–1.17 a frame by 1/d², after2 0.009 → 0.0255
  at 0.23 s before falling ×0.4 a frame); the opening dof racks in over 0.6 s (it snapped on at full bokeh: ×1.48); bindings `fx torchFade {d, e1}` fades the torch
  (light + beam haze via fl.intensity, the bounce via LOOK.bounce) so its pool's ON-SCREEN brightness falls linearly
  (beam × (1 − s)·(e0/e1)^s), then switches it off. C2's first frame = the gameplay frame.
- F2a one wrong frame per metered cut. ROOT CAUSE: the eye meters a frame only after it is drawn (exposure.ts, FLASH);
  the cut frame shows the previous shot's exposure. FIX (in lane, no exposure.ts edit): `exposure {cutE, cutHold 0.1}`
  = the incoming shot's exposure on the cut frame (the value the eye settles on: diag `ex`), then the eye takes over
  from it (exposure.ts's film-cue hand-back: no snap, adapts). Only where a meter exists (meterOn; not the Direct path).
  Cues: C0 12.5/19.0/26.0; C1 0/6.6/11.6/43.4/56.6/62.0; C2b 3.0/7.0; C5 6.2/10.0 (player torch on only)/16.7/25.6;
  C5b 3.5; C6 7.5/10.4 + 8.4/27.8 (no player torch); C6b 6.0/8.5; C7 3.5/15.8/16.8/18.6/22.6. C5/C6/C7 shift their cue
  lists for the inserts — the post-insert cuts are pushed on the real clock (tests/smooth-fix.test.ts checks every cutE
  sits on a shot boundary where the camera jumps). The generic fix belongs to exposure.ts (request below).
- F2b C4c black memory-flash frames. ROOT CAUSE: the arms (story-runtime, after the cutscene update) aim the beam
  (BEAM_CLAMP `at`) in the torch RIG's frame, but the rig only followed the camera later in the frame (world →
  rig.update): on a cut the beam was aimed for the previous shot's pose (lit nothing in view). FIX: bindings
  camera.apply poses the rig on the cutscene camera at once (rig.update(0) + snap, so the frame's own update is
  unchanged) — every held-camera frame, which also removes the one-frame beam lag on fast whips.
- C2b (after2, not in the hunt list): its 0.0 and 9.5 cuts kept the previous exposure on the first frame too (×5.2,
  ×2.6) → cutE 7.0 / 8.0 (the eye's snap 8.5 / 9.6 settling 6.5–7.1 / 7.3–7.8).
- C4c (after2): 3.33–3.87 pure black after the bell flash — the 3.3 shot looks down on the glove while `aim(locketAt)`
  sent the beam over it into her, out of frame; the beam is now aimed at that shot's own target. Memory flash-frames
  blown white since the 17:00 exposure fix (0.29–0.67) → per-set-up exposures C4C_MEMORY_E (e·L̄ ≈ 0.15 on diag `hl`).
- F3 C1 step-out. ROOT CAUSE: S11 handed the cut to the eye (`reset` + the cut's snap): the cut frame kept S10's 10.6
  (×4), the snap metered the tail lamp alone in a black frame (radiance 0.037, lens 0.32) → 1.35, then 1.4 s of black
  around a flat lens and pure black as the lamp left the frame until the eye's 6 s brightening. FIX: a film exposure
  per moment — 2.2 at the cut, 4.5 over 70.2–71.4 as the camera rises past the lamp, 3.8 over 73.7–74.7 once the torch
  is on (= the eye's own target at CP1, ≈ 3.8 from the diag's adaptation rate) → hand-back with no step. The tail lens
  (cutscene-fx buildCar): a hot zone round the bulb, ≈ 4× falling to the rim, × (0.5 + 0.5·|n·v|); chrome dividers and
  the clear reverse lens keep their own materials. after2: no black frame — 69.0–70.4 the lit lens and plate at 0.011,
  a 0.3 s dark dip 70.5–70.7 (0.00025–0.001: the navy flank and the gravel read) as the camera rises past the trunk, the
  drive from 70.8; the lens still read salmon (median sRGB 197/121/93: an exposed red of 1–3 goes to white in AgX) →
  `taillights` 0.35 → 0.14 (a weak tail filament on a dying battery: rim 0.15–0.4 exposed stays red, the bulb ≈ 1.3).
- F4 C1 S9 headlight glare cut. ROOT CAUSE (scratch/fix/s9lamps.ts): the 'out' pan outran the coasting car: its lamps
  (glaring at the lens 8–20° off their beam axis) left the right frame edge at 57.07 with their bloom halo (screen-space
  bloom of an off-screen source is gone) and re-entered at 59.2. FIX: CameraShot.track (sequencer.ts, types.ts): the
  look's yaw follows the car's bearing + an offset that moves from the authored start offset to the authored end one
  with the car's progress across the view (monotonic pan, exact authored first/last frames). Offline: lamps inside the
  frame 56.6–62.0 (worst −24.8° at the authored first frame, 16:10 half-hfov 28.9°), no reversal.
- F5 C2 S9 pitch black. ROOT CAUSE: f/2 (0.625) on the unlit hall (radiance 0.0023–0.003 vs the parlor's 0.010–0.012;
  AgX's toe crushes < ≈ 0.002). FIX: an iris + shutter ride (f/1.4 at 360°, C2_HALL_E 2.5) eased from the whip's first
  frame (20.1–20.7; after1's 20.3 start let 20.43–20.6 fall to 2e-4), held over Harlan's dark corner and pulled in 0.22 s
  as the lamp pool enters the sweep (22.38–22.6; after1's 21.9–22.45 return left 22.27–22.4 at 1e-5).
- F6 C2 27.7 door face pop. ROOT CAUSE: `shadowLight off` at 27.7 while D_PARLOR swings shut (27.6 + ≤ 92°/70°/s =
  28.92). FIX: off at C2_DURATION, on the cut to C2c (the leaf is a lamp caster: the light narrows with the gap; after1's
  28.95 still darkened C2's last frame ×0.06).
- F7 C2c 8.53–8.93 black. ROOT CAUSE (diag `tl`): not light inside geometry — the run's torch is 0.3 m from the landing
  wall and 0.16–0.43 m below the eye; its small pool (≈ 0.13 m) landed BELOW the level 38° frame on each downstroke of the
  arm (the speckle is the wallpaper's sparkle under the bounce light). FIX: the scramble's look ends 14° down onto the
  last treads/landing (the pool stays in the frame's lower half); the stop eases up to the eye line (inOut — the 'out'
  restarted the eye at full speed after the scramble's stop).
- F8 C2 head rolls by itself. FIX: the face-down → face-up roll is the end of the head's own fall (C2_ROLL 8.2–8.7,
  ≈ 0.47 m/s from the fall's momentum), under the rigid S3 frame and before the lurch (8.6) can see it; head_nudge sfx
  at 8.25; blood-fx: the landing pool drains only until the roll, the rest pool from 8.7, the smear at 8.45.
- F9 C4a dolly black. ROOT CAUSE: the room's baked night light reads 7.5e-5 (≈ 0.0005 lux on the boards) at the shot's
  1.2 — an order under a moonlit overcast night's 0.003–0.03 lux. FIX: `lmScale` × 30 (C4A_DOLLY_LM) on the cuts in
  (8.0) and out (11.0); the 10.0 stroke is a runtime light (unscaled) so the reveal keeps its ratio. C4 (the wardrobe
  slat view, gameplay hide at the eye's max 24, radiance 1.5e-5): NOT changed — request below.
- F10 objective blink. The lead's 17:32 SHOW_HOLD_S debounce covers the C4a 3-frame flip, but the diag still showed the
  new B03 step fading in over the 0.4 s before C2 (C2-1 f0000–f0005: 0 → 1036 lit px). FIX (objective.ts): a new step
  waits REVEAL_S 1.0 s (while the line may show) before it fades in; a step arriving while the line is still fading out
  waits for the fade (no mid-fade text swap).
- tests/smooth-fix.test.ts (3): every cutE on a shot boundary where the camera jumps; C1 S9 lamps in frame + monotonic +
  authored ends; C2 hand-off/iris ride/door/roll staging. npm test 307/307, typecheck clean.

## Not bugs (checked)
- The hand-back steps after C2b (×0.01), C4a (×0.30), C5 (×0.20) and C5b (×0.42) in the post-roll are the BOT: on the
  first gameplay frame it switches its torch off (stealth rule, playthrough.mjs) and snaps its look 24–78°. The cutscene's
  last frame and the eye's exposure are continuous (rows `ex`, `tl`).
- C2 19.067 (flick 80, in hunt/a1/a2 alike): Harlan's swinging arm passes between the table candle and the lens/wall for
  one frame at 2.5 m/s (the flame hidden, the wall in its shadow) — physical; his root path is smooth (offline check).
- C1 37.8: the S6 crane's cut frame is black (held night meter) and the 0.2 lightning lands one frame later — authored.

## Requests for the lead
1. FLASH + PERF (ruling as): the generic cut-frame meter (cs-shots warm-up, exposure.ts). The per-cut `cutE` values in
   C0 C1 C2b C5 C5b C6 C6b C7 are the eye's settled values measured on Medium (scratch/fix/diag `ex`); once the meter
   exposes the cut frame itself they can be deleted (tests/smooth-fix.test.ts lists them).
2. FLASH look pass (ruling ar): every e < 1 film camera changed with the 17:00 exposure fix. Measured here: C4c's take at
   0.2 is ×3–5 brighter than before (luma 0.10 on her torso; the memory flash-frames now have their own exposures,
   C4C_MEMORY_E), C4a's hand-back 0.17 (×4.7), C2c's 0.458 (×1.5), C2's 0.625 (≈ unchanged). The AD call on the C4c take
   and on C4C_MEMORY_E (bright memory vs darker) is theirs.
3. F9 second half — the C4 wardrobe slat view (gameplay hide, the eye at its max 24, scene radiance 1.5e-5): not changed
   here. Needs either a moonlight/candle key in U2/U3 in the bake (lane A) or a higher eye ceiling inside a hide
   (exposure.ts, FLASH).
4. C4a dolly (8–11): with lmScale 30 + the probe grids the frame holds the window, sill and board edges at luma 0.0025;
   the room itself stays near-black because its camera (C4A_FLASH_E 1.2) is the AD's silhouette design. If the AD wants
   the sheeted room readable, raise that shot's exposure (≈ 3–10; the 10.0 stroke would then over-expose briefly).
5. C2c 8.6–8.7: white wallpaper sparkle specks under the torch at 0.3 m from the landing wall (the material's glints under
   the beam's bounce) — materials owner.
6. QA bot (playthrough.mjs owner): delay the stealth torch-off / look re-aim ≈ 0.5 s after a cutscene ends, so frame
   captures judge the real hand-back (see "Not bugs").
7. tests/smooth-fix.test.ts is new in tests/** (lane C's tree) — written by this lane for #145 (cutE on shot boundaries,
   C1 S9 track, C2 hand-off/iris/door/roll staging); accept or route it.
8. FRAMES / sequencer owner: the first rendered frame of a cutscene is t = dt (sequencer.update advances before the
   first render), so a cutscene that starts on the moving player's eye (C2's walk-in) shows the player's last step AND
   its own first step in one frame (C2: 0.054 → 0.096 m/frame, then 0.043). Rendering t = 0 on the first frame (or
   starting S1's path one player step back) would make the hand-off's velocity continuous. Not changed here (it shifts
   every cutscene's clock by a frame).
9. F8: harlan_c2's boot is no longer needed (the roll is the end of the head's fall, under S3); the head_nudge sfx moved
   with it.

# ROUND 2 (contract #145b) — re-verify findings F7, F9, N1, N2, N3 (STATUS-smooth-verify "## Re-verify")
Restarted 23:2x (the first round-2 agent left no edits/captures). Work dir scratch/fix/r2/ (run.sh = capture wrapper with
an XROW probe: torch target, door angles, torch shadow autoUpdate, uTorchLit, view-cull stats). Dist scratch/dist-fix.
cs-frames.mjs: new env XROW (page JS expression → row.x).
- diag (23:28, dist-fix = the tree at 23:28 before my round-2 edits, Medium, FPS 30, PROBE 1, windows C2c 6.2–7.9 /
  8.2–11.4, C4 overlay 0–1.2 per segment, C4a 7.6–11.2, C4c 3.0–4.0, C5 29.2–31.0).
  - C2c reproduced on the current tree: 6.600–6.767 0.0000 ×6, 7.567–7.633 0.0000 ×3, 10.767–10.967 ≤ 0.0008 ×6.
    Rows: 6.633–6.767 the stumble clip puts the lens 0.70–0.73 m under the eye, 0.13–0.15 m above tread 12 right in
    front of riser 13, the beam clamped 11–12° off the gaze (pitch −28…−35°) → into the riser; 7.567–7.633 the beam
    still aimed at her hand (BEAM_CLAMP.at, 125–145° off the gaze) through the turn back; 10.77–10.97 the breath-hold
    clip's lowering beat (lens 0.36–0.42 m under the eye, beam 11–13° off the gaze, the landing wall ≈ 0.9 m) → the pool
    under the frame.
- Source edits DONE (23:32–23:46; capturing): bindings.ts `beamClamp {gaze, d}` (the beam aimed at the gaze ray's static
  hit, eased); c2c-up.ts gaze aim for the whole climb, glance #2 at her hand's distance, arms_breath_hold back to 9.0;
  c4c-remembers.ts the take's first frame cross-faded in under the flash-frames (2.55, held), run from 3.4; c4a
  C4A_DOLLY_E 12 for the 8–11 dolly. The 23:47 'a1' after-capture never ran (agent cut off by an API limit).
- RESTART 00:41 (13 Oct). On BATTERY (pmset 99 %, discharging): stepped frame captures are content-deterministic; no fps
  numbers are taken in this round. dist-fix rebuilt 00:5x on the current tree (incl. FLASH's 23:47 arms.ts + the
  regenerated arms assets); dist-fix2 deleted. typecheck clean, npm test 318/318.
- N3 probe v2 (01:00, scratch/fix/r2/n3/c5door2.mjs → run2): direct play reproduces the blackout (post-C5, front door
  ≈ 42°, NOT 69–75° as in the full run → not door geometry). A dt-0 re-render stays dark (luma 0.0017); the pool came
  back ≈ 6 frames later whatever was toggled (front / parlor leaf hidden, front no-cast: 0.0064–0.0068). The torch's own
  spot contributes NOTHING on the dark frames (the leaf, jamb and wall all unlit; only its bounce remains — ×0.19).
  strips/n3_ab_same_vs_fronthidden.jpg. (The probe's torch castShadow toggle crashed three's shadow node — probe bug.)
  LEAD: the run logged '[reflections] re-captured EXT (dawn sky, 6 frames …)' at C5's end — reflections.ts recapture()
  renders one cube face per frame for 6 frames with the torch darkened (intensity 0) and the camera/rig subtree hidden.
  Probe v4 (c5refl.mjs: cube-face renders per frame vs HDR, refl on / --query refl=0) queued (chain1.sh).
- C4 hide view (F9 2nd half, source done 01:0x): c4-hem.ts C4_HIDE_LM 15 + HemOverlay.lmWanted (in Ada's wardrobe);
  bindings.ts tickHideLm eases GRADE.lm (log space, in τ 1.6 s / out τ 1.2 s) — an `exposure {max}` cue cannot work in
  the hide (opening.ts resets every exposure cue on frames with no cutscene camera). tests/smooth-fix.test.ts +4 tests
  (C2c gaze aim, C4c held pre-cue, C4a dolly E, C4 hide lift): 7/7.
- N3 ROOT CAUSE (probe v4, 01:00–01:04, n3/refl-on.log): direct-play C5, per frame cube-face renders vs HDR max — the
  door view's ONLY blackout is k=90–95 (t 29.03–29.20, max 0.56–0.70 vs ≈ 58 either side), exactly the 6 frames with a
  cube-face render (skyTint crossing 0.6 → reflections.ts recapture('EXT'), one face per frame). (k=0–58 'DARK' rows are
  C5's own black / insert shots — the max < 8 test is crude there.) Mechanism: the lightmapped atlases' and probe-lit
  materials' own lightsNode lists (level.ts 543/613: lights([torch, bounce, …])) are evaluated in the cube face render
  whatever the scene visibility, with the torch darkened to 0; three r186 AnalyticLightNode is FRAME-updated (color =
  light.color × intensity once per node frame) → the frame's main render reused 0 for the torch on every lightmapped
  surface (the bounce, not darkened, left ×0.19). Time shifts with the run because the trigger is the blue-hour sky.
  FIX (reflections.ts stepRecapture, 1 line): a new node frame after the face render (the idiom compileAsync and
  pipeline.ts already use). typecheck clean, npm test 322/322. refl-off A/B + the fixed-build check: chain2.sh.
- refl-off A/B (n3/refl-off.log, --query refl=0): k=90 lit (max 62), no cube renders → causation. refl-fix (build-5, the
  fix): k=90–95 (the 6 cube-face frames) HDR max 62–66 (was 0.56–0.70); dark frames 28 → 11 (= C5's own black shot).
- after-capture a1 (01:15–01:26, build-5 = all round-2 edits incl. the N3 fix; the 23:47 arms assets; Medium, FPS 30,
  PROBE 1, patient bot; 0 console errors; det/a1-*):
  - F7 C2c: 8.4–9.0 0.148–0.170 smooth (diag black), 10.6–11.2 0.19 → 0.10 smooth (diag 10.8–10.93 0.0000). FIXED.
  - C2c 7.5–7.7 (N1 second half): 0.26 → 0.31 → 0.23 → 0.036 → 0.046 (diag 0.0001 / 0.0000 ×3). FIXED (no black).
  - N1 C2c 6.6–6.8: NOT fixed with those arms — a strobe 0.295 / 0.0001 / 0.0000 / 0.133 / 0.027 / 0.309 (diag 0.0000 ×6):
    the stumble clip had the lens 0.53–0.69 m under the eye at tread 13 (lens z 3.5); aimed at the gaze hit it either
    hit riser 14 point-blank (hl max 886 / 6260) or left the frame. FLASH regenerated arms.glb 01:26 (lead: FLASH fixes the
    torch height) → see build-6 below.
  - F9 C4a dolly (picture only, top 70 %, subtitle excluded; croplum.py): 0.0013–0.0023 (p95 ≤ 0.0046) vs diag
    0.00002–0.00013; the 10.17 stroke 0.029 (p95 0.145, no clip). The window, the dress form, the sheeted chair and the
    boards read, dim and cold. strips/f9_c4a_dolly_ba_r2.jpg (display gamma), c4a_dolly_9s_big.jpg. HONEST: warm orange
    dashed lines along U3's floor perimeter and the window jambs — in the bake (faint in the 'before' too; no rug /
    curtain / runtime lamp in U3): most likely L_LAMP_U2 (60 W, 2100 K, the shared wall) leaking under the wall — lane A.
  - F9 C4 hide view (top 70 %): 0.00001 → 0.0005–0.0009 every phase (approach/hem/look/leave; hl 2.3e-4 = ×15). Slats in
    front, Ada's dress through the gaps, the window light. strips/f9_c4_hide_ba.jpg. HONEST: the same orange leak lines
    through the slats, and the slats' inner faces read as lit warm wood (probe-lit: the grid samples the room, not the
    wardrobe's inside) — should be near-silhouettes. Lane A (bake leak, probe placement).
  - N2 C4c: 3.4 → 3.433 pop 41.7 → 12.2, luma 0.0922 → 0.0925 (diag ×1.17 step); her pose continuous through the reach
    (strips/n2_c4c_a1.jpg). FIXED.
  - N3 C5 (full route): 29.2–31.4 0.0082–0.0114 smooth (diag 29.867–30.033 0.0008–0.0021); the run logged the dawn
    re-capture (cs-report console 637.9 s) inside the same deterministic blue-hour window. FIXED.
- build-6 (01:3x, + FLASH's 01:26 arms assets). Direct-play N1 harness (n1/c2cdirect.mjs, C2c 6.3–7.8): the stumble lens
  now z 3.71–3.73 (dz −0.35; a1 −0.55); 6.567–6.833 0.043 → 0.149 → 0.188 → 0.223 → 0.204 → 0.114 → 0.194 → 0.229 → 0.151:
  no black, no strobe (one ×0.56 frame at 6.733 inside the whip); 7.533 → 7.6 0.327 → 0.085 → 0.044. strips/n1_base_stumble.jpg:
  one sweep (landing pool → the treads, risers 14–15 lit near → the balusters → her hand).
- a2 (01:40–01:53, build-6 = every round-2 edit + FLASH's 01:26 arms; same env/windows; 0 console errors; det/a2-*):
  F7 8.4–9.0 0.149–0.171, 10.6–11.2 0.19 → 0.10 (fixed); C2c 7.5–7.6 0.27 → 0.33 → 0.24 → 0.043 (no black); C5 29.7–30.3
  0.0105–0.0118 smooth with the dawn re-capture logged (799.3 s) (N3 fixed); C4c 3.4 → 3.433 pop 14.8, luma 0.0950 →
  0.0953 (N2 fixed); C4a dolly 0.0039–0.005 (stroke peak 0.059); C4 hide view 0.0005–0.001 (p95 ≈ 0.002).
  N1 on the route: NO black frame any more, but 6.6–6.733 is a WHITE-OUT (luma 0.34 → 0.45 → 0.50 → 0.49 → 0.36; scene
  radiance mean 35–46 at the film camera's 0.458): the gaze hit at −28…−35° is the stair under the lens, so the core met
  risers 14–15 point-blank (0.2–0.4 m) and the near haze column filled the frame (strips/n1_c2c_a2.jpg). (Direct play read
  only 2.7–3.4 there — the route's state differs; judge N1 on the route only.)
  → c2c-up.ts: during the stumble (6.6–6.733) the beam is aimed at tread 14's middle (the fist on tread 13 points the
  torch along the flight; on the camera's centre line; 0.53 m from the lens, grazing), then the gaze aim again for the
  whip to her hand. Test updated. b1 = C2c-only route capture on dist-fix3 (the scratch build of that change).
- b1 (02:0x, scratch build dist-fix3 = the tread-14 stumble aim; C2c only; 0 console errors): 6.6–6.73 luma 0.34 → 0.52 →
  0.52 → 0.43 (a2 0.34 → 0.45 → 0.50 → 0.49), scene radiance mean 54 — the aim is NOT the lever (the core landed 0.5 m
  away on tread 14 and the frame stayed white) → REVERTED (c2c-up.ts back to the gaze aim; a comment records the trial).
  Also seen in b1: 8.5–8.6 torch intensity 1990 → 1240 for 4 frames — flashlight.ts's designed random 'battery flicker'
  (FLASH; a2 had none there): captures of torch-lit scenes are not run-to-run deterministic because of it.
- b2 (haze-off diagnostic): void — Medium has no volumetric beam (presets volumetricBeam false; g.rig.flashlight.beam null),
  so the white-out is surface light. Direct play reads 2.7–3.4 at the SAME lens pose (dz −0.35) where the route reads
  35–54 → suspect the beam bounce light (flashlight-bounce.ts: an unshadowed point light at the beam's hit point, here
  0.2–0.5 m from the stair) — b3 = the same capture with LOOK.bounce 0 over 6.55–6.8.
- b3 (LOOK.bounce 0 over 6.55–6.8 via XROW, bounce intensity 0 from 6.633; 0 console errors): 6.6–6.73 UNCHANGED
  (0.340 → 0.455 → 0.500 → 0.492; radiance 36–46). Not the bounce either → the spot itself on the stair 0.2–0.5 m from a
  lens the stumble clip holds 0.35 m under the eye, at the film camera's 0.458. Owner: FLASH (arms_stumble_catch pose; the
  lead's 23:35 note already asks FLASH to fix the torch height in the C2c clips). Not band-aided here (an exposure pump at
  the stumble would be a new glitch).
- C4 hide ease probe (c4/hideease.mjs, build-6, direct: debug_u3 → H_ADA_WARDROBE, torch off; 0 console errors): scene
  radiance 5e-6 → 7.5e-5 (×14.1 of 15) over ≈ 5 s; 5-frame-averaged step median 1.3 %/frame, max 7.4 % (raw per-frame
  jitter = the rain / flicker noise); on leaving, eased back (τ 1.2 s). No pop. (Pre-existing, not this change: entering the
  hide snaps the eye 1.85 → 24 in one frame — the exposure snap on the hide's camera cut.)
- C2c 11.27–11.5 (not a finding; pre-existing — diag flick 61 at 11.367): the torch core crossing the gap between the
  boards on Ada's door during the slow turn — a1/a2 one-frame trough at 11.433 (0.0124 between 0.0225 / 0.0254), diag a
  3-frame trough (0.0114 → 0.0070 → 0.0078 → 0.0071). Physical (a sweeping core does vanish into a doorway gap); left.

## ROUND 2 — result (02:3x)
- F7 FIXED (a1, a2 on the route): C2c 8.4–9.0 0.148–0.171, 10.6–11.2 0.19 → 0.10 smooth (was 0.0000 ×5 at 10.77–10.93).
- N1 PARTLY: no black frame any more (6.6–6.77 was 0.0000 ×6; 7.567–7.633 0.0000 ×3 → 0.24 → 0.043 → 0.046), but on the
  route 6.6–6.73 is a 4-frame over-exposure (luma 0.45–0.50) — FLASH's stumble pose (requests).
- F9 C4a FIXED (dolly picture 0.0013–0.0023 vs 0.00002–0.00013; the stroke unclipped); F9 C4 FIXED in lane (hide view
  0.0005–0.001 vs 0.00001) — both with the U3 bake's warm leak lines now visible (lane A, requests).
- N2 FIXED (no pose pop at 3.4; luma flat). N3 FIXED (root cause: reflections.ts re-capture × three r186 FRAME-updated
  light node; one line; direct A/B + the route).
- C2c 0–6.3 under the gaze aim (b4, build-6, 02:2x–02:34; 0 console errors; det/b4-C2c-0) vs the re-verify rv1 (old 12°
  cone): one-frame departures IDENTICAL (3.667 and 4.0 — glance #1's authored silhouette, 0.0007 → 0.0048 in rv1 / hunt /
  round 1 alike); the newel 1.5–2.2 smoother (0.31 → 0.39 → 0.25; rv1 dipped 0.305 → 0.245 → 0.314); the whip back 4.6–4.8
  and risers 6–12 match (6.07–6.2 0.036 vs 0.016–0.020). No new artifact anywhere in the climb.
- Files: src/cutscenes/bindings.ts (beamClamp gaze, tickHideLm), c2c-up.ts, c4c-remembers.ts, c4a-door-gives.ts,
  c4-hem.ts, src/render/reflections.ts (1 line), tests/smooth-fix.test.ts (+4), scripts/qa/cs-frames.mjs (XROW).
  typecheck clean, npm test 323/323. Contract #145b. dist-fix deleted at the end.
