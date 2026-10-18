# STATUS — SMOOTH VERIFY (independent checks of the SMOOTH-FRAMES lane, contract #142 / #142c)

## Frames hunter
Adversarial frame-by-frame review, independent of the builders. Edited nothing in src/.

### Setup
- Dist: scratch/dist-hunt, built 16:40 2026-10-12 from the working tree. It has the same content as dist-smooth-frames3:
  no src file is newer than dist3's index.html. verify-boot OK. The tree carries uncommitted work from four lanes:
  FRAMES (#142/#142c: ada-table-pose.ts, ada.ts, skin.ts, secondary.ts, cutscenes/*), FLASH (exposure.ts,
  flashlight*.ts, look.ts, arms.ts), PERF (pipeline.ts, renderer.ts, blood-fx.ts, cs-shots.ts, hash-prepass.ts) and
  OBJECTIVE (story/objectives.ts, ui/objective.ts, story-runtime.ts). The dist was deleted at the end (17:2x).
- All runs: real route, stepped at 1/30 s, mains power, work dir scratch/hunt/. **Every run had 0 console errors and
  0 exceptions.**
  - h1: Medium, c2b-patient, SCENE=C2,C2c,C2b, PRE=3, POST=2. Covers all of C2 (0–29 s, including the rise), C2c,
    C2b and the hand-offs. C2b PLAYED (the patient bot held the armoire for 1.0 s).
  - h2a: Medium, scratch/hunt/objwrap.mjs wrapping cs-frames, SCENE=C0,C1,C3,C4,C4a, PRE=1, POST=2. It also logs the
    OBJECTIVE line's DOM class and computed opacity for every frame (h2a/objlog.json).
  - h2b: Medium, cs-frames, SCENE=C4c,C5,C5b,C6,C6b,C7,CR, PRE=1, POST=2. One continuous segment covers C6 → C6b →
    C7 → CR → title.
  - h3max: Max, C2 0–12 s.
  - h4hi: Medium at 1920×1200, C2 windows 0–0.4, 2.9–3.05, 7.45–7.8, 9.2–9.35 and 21.9–23.4. Used for the head and
    seam close-ups.
- Analysis tools: scripts/qa/detect.py writes det/<run>-<seg>/. Helpers in scratch/hunt/:
  - ana.py: hand-offs, capture wall-time gaps, objective pixels.
  - cutcheck.py: the first frame after every cut against the next two.
  - pspeed.py: pan speed as a fraction of the vertical FOV per frame.
  - rowsat.py / mrow.py / fr.py: rows and metrics by clock.
  - objho.py: objective DOM state around each hand-off.
  - regdiff.py: per-frame differences inside one region.
- Strips are in scratch/hunt/strips/.

### C2 (the user's report): head ON the body until contact — PASSES
- Before contact her head is on her body, at the sawbuck's west edge, with the hair hanging. Frames checked:
  - Medium 3.0 / 5.4 / 7.3 / 7.5.
  - Max 7.5.
  - 1920×1200 at 2.9–3.05 and 7.3–7.533 (strips/hi_300.jpg, hi_contact.jpg, hi_diff_contact.jpg, c2_pre_two*.jpg).
- No headless frame before 7.6, no stump and no PALE RING. The dist2 ring (smooth-frames/strips/c2h_head_zoom.jpg) is
  gone at 1920×1200.
- 7.567 (contact): the cleaver shaft is at the neck and the head is still attached.
- 7.6 (the sever cue): the head is still in place.
- 7.633: the head separates (about 9 cm and 20° or more in the first frame). By 7.7 it has dropped out of frame and the
  stump and jets are at the edge. 9.3: the head is on the floor.
- The neck_stub restore at 7.60 → 7.63 is not visible as a separate pop.
- Blood before contact: maroon stains on her back and shoulder and on the sheet from 3.0 on. This is the authored
  first-stroke gash (C2-ESCAPE). It does not read as a stump.
- Rise: no pop at the 0.20 m root-shift blend-out (22.2–23.1). She is behind the sawbuck, and the frame is black until
  22.43 (see finding 3). She then rises smoothly at 23.5–24.5 (strips/c2_rise.jpg, c2_rise2.jpg).
- Max 0–12 s matches Medium, including finding 1.

### Findings — USER-VISIBLE (most severe first)

**1. C2 0.033: start flash, and the tableau does not match.** Medium and Max.
- Pose: the last B03 frame and C2's first frame share the same eye and look (0.10 m, 0.6° apart). That part matches.
- Light: C2's first frame is ×16 brighter. Luma goes 0.0016 → 0.0259 (Max 0.0026 → 0.0262).
- It then decays by ×0.71–0.84 per frame back to 0.0024 by 0.33 s.
- Look: the B03 frames are hazy (a soft volumetric glow round the lamp). C2's first frame is crisp, with a hard bright
  lamp-flag strip (strips/c2_start.jpg, c2_tableau_match.jpg).
- C2 holds a FIXED exposure from t 0 (exposure.ts returns the cue value at once), so the decay is not the meter.
- Suspects are the t 0 cues: flashlight off (the torch's fog haze), lampFlag on, shadowLight at the lamp, cast_shadow
  L_LAMP_PARLOR, L_CANDLE_TABLE ×0.5. A temporal pass could also be the cause.
- Owners: c2-room.ts t 0 cues, cutscene-fx.ts, exposure.ts.
- Fix: A/B each t 0 cue on a 2-frame capture. C2's first frame must equal the gameplay frame. Fade the haze and change
  the light over 0.5–1 s, or start C2 from an exposure equal to the gameplay one.

**2a. The first frame after a cut is exposed for the previous shot (every cutscene that uses the eye meter).**
- FLASH/FRAMES cut the post-cut latency from 9 frames to 1, but that one wrong frame remains. Luma ratios below are
  the cut frame against the settled shot.
- Blown out:
  - C7 15.833 cleat insert (×28) and C7 18.6 guest book (×50) — strips/c7_cutflash.jpg.
  - C7 3.533 (×7).
  - C6 10.433 (×5.6), C6b 8.533 (×6.7).
  - C0 12.533, C0 19.033, C1 11.633, C1 43.4, C1 69.033.
  - C5 6.233.
- Black: C6 27.8, C6b 6.033, C7 16.833, C7 22.6 (strips/c6b_c7_blackcut.jpg), C5 25.6, C2c 3.667, C1 62.033.
  - In the baseline capC these were dark for about 9 frames: the same meter latency, now down to 1 frame.
- Wrong by ×2–7: C2b 3.033 / 7.033, C5 10.033, C5b 3.533, C1 0 / 6.633.
- Owners: exposure.ts (FLASH), bindings.ts.
- Fix: meter the incoming shot before it is shown, or give each cutscene shot its own fixed exposure (as C2 does).
- Note: one frame here is 33 ms; in real time at 60 fps it is one 16 ms frame.

**2b. C4c: every 0.4 s memory flash-shot opens on a BLACK frame**, at 2.5 / 2.933 / 5.533 / 6.333.
- Luma is 1e-4 on the cut frame, then 0.016–0.045.
- This happens under C4c's FIXED film exposure, so it is not the meter. It is lighting: the torch or rig is posed
  before the cut camera, or a pass has no history on the cut.
- Already present in capB (the baseline, before any edit) and capG1.
- Owners: flashlight.ts / flashlight-rig (FLASH), c4c-remembers.ts.

**3. C1 69.0–70.9: the step-out (S11) is unreadable.** This is likely the user's "end of the car ride … disappearing
and re-appearing".
- 69.033: the first frame is blown out (×4).
- 69.067–70.4: the screen is black apart from a FLAT, unshaded salmon-pink parallelogram, which is the tail lamp
  (strips/c1_69.jpg).
- 70.5–70.9: pure black.
- The gravel and the drive appear only from 70.93 (strips/c1_stepout.jpg).
- Cause: the 69.0 'exposure reset' meters the bright tail lamp in a dark frame.
- Already present in build2 (FRAMES capE 10:13, det/E-C0-0: the same luma trace — 0.053 at 69.033, 0.0135 at
  69.1–70.3, ≈0 at 70.5–70.8). So it is independent of FLASH's 10:29 exposure.ts changes. It is the original bug, not a
  regression.
- Owners: c1-empty.ts S11 (a film-camera fixed exposure or a meter clamp), cutscene-fx 'taillights' material (red, not a
  flat clipped salmon).

**4. C1 56.9–57.1: the road's headlight wash vanishes in one frame.** Static S9 roadside shot.
- 56.9: a one-frame flare at the left frame edge.
- 57.033 → 57.067: the warm headlight wash on the road and in the fog disappears in one frame (×0.4) while the car,
  out of frame, turns in (strips/c1_5690.jpg).
- A turning car sweeps its beams over about 0.5 s; here they are cut.
- Owners: vehicle light cull/disable (cutscene-fx headlights, road.ts).

**5. C2 20.5–22.4: pitch black for 1.9 s.**
- The S9 rope / front-door slam and the start of the S10 sweep render at luma < 2e-5. Only a gamma-3 lift shows the
  door frame (strips/c2_rope.jpg).
- The CLAUDE.md rule is "never pitch-black on screen".
- Owner: c2-room.ts. S9 needs its own exposure cue, or light at the door.

**6. C2 27.7: the door light pops off.**
- D_PARLOR starts closing at 27.6.
- At 27.7 (cue 'shadowLight off') the lit door face goes black in ONE frame while the door is still swinging (luma ×0.03).
- That frame shows pale ghost outlines of the door stains (strips/c2_doorshut.jpg f857).
- Owners: c2-room.ts, cutscene-fx.ts. Fix: turn the light off once the door is shut, or fade it over the swing.

**7. C2c 8.53–8.93: the torch goes into the wall.**
- Climbing to the top, the eye faces the stair wall at < 0.5 m. The torch hot spot fills the frame with speckle
  shimmer.
- Then 6 frames go black (0.0056 → 0.0000 → 0.0004) and come back (strips/c2c_867.jpg).
- Same class as the old C5 12.47 bug.
- Owners: c2c-up.ts path (FRAMES), flashlight near-wall (FLASH).

**8. C2 9.4–9.8: the head on the floor rolls by itself.**
- It turns face-down → face-up with no boot or hand in frame, while the head_nudge sfx plays (strips/c2_nudge.jpg).
- This already happened before; Harlan's boot stays ≥ 0.47 m away.
- Owners: lane A (harlan_c2 boot), or the c2-room.ts framing or nudge cue.

**9. Pitch-black cutscene stretches.**
- C4a 8.0–10.0 and 10.7–11.0: luma 0.
- C4 hem / look / leave: ≈ 1e-4 for about 25 s. It can only be seen in the lightning strokes.
- These are the FRAMES lane's own "look" findings and are still unfixed.
- Owners: c4a-door-gives.ts, c4-hem.ts exposure.

**10. OBJECTIVE line flashes at cutscene hand-offs.**
- C4a: per the objlog, the line goes is-on → off at 259.767 → is-on + fresh at 259.8 → off at C4a 0.033. On that
  middle frame its text swaps from "(0/3)" to "(2/3)" with no cross-fade, because swapT = 0 while hidden. A
  one-frame off/on and a text pop on the frame before the cut.
- C2 and C2b: the objective step changes as the beat changes. A fresh line fades in at full brightness 0.3–0.5 s
  before the cutscene starts (h1 C2 f13–f27, C2b f74–f90). It then fades out under the cinematic, so a bright HUD line
  blinks right before the beheading.
- Owners: story-runtime.ts, ui/objective.ts, story/objectives.ts.
- Fix: hold objective changes while a cutscene is pending or within about 1 s of one.

### Findings — minor
- **C4 hem overlay:** the objective stays ON at 0.62 for all 26 s, with the stale text "Hide in the wardrobe" while
  the player is already in it (objlog 5317–6109).
- **C2 7.567, contact:** her face lights up in one frame as Harlan's body leaves the lamp's path. This is plausibly
  physical.
  - Note: lights.ts redraws the parlor lamp's shadow cube a THIRD per frame (splitCube, each face at 20 Hz in real
    time; the C2 draws repeat 192/195/194).
  - So moving shadows step at 20 Hz. A real-time A/B is recommended (PERF).
- **C2 7.633:** the falling head's hair sizzles (alpha-hash speckle) and the ear renders very pale (strips/hi_fall.jpg,
  c2max_fall_zoom.jpg).
- **C2 10.25–10.75:** the head → sack tilt-pan runs at 7.7°/frame on a 27° lens (29 % of the frame per frame). It will
  read as a jerky pan.
- **C2 22.43–22.8:** the S10 sweep peaks at 11°/frame on a 31° lens (37 %/frame). It is mostly in the dark.
- **C2 19.067:** Harlan's arm hides the table candle for one frame (luma ×0.3, then back). Physical occlusion.
- **C6b 4.333:** the wick catches ×3.9 in one frame. Authored, but abrupt; a real wick catches over 0.2–0.5 s.
- **C4c 11.0 hand-back:** the first gameplay frame is ×2 brighter (the exposure snap cue at 10.9). The bot then turns.
- **Stutter candidates** from capture step time (one 1/30 s step took the times below). Not measured in real time
  (stepped capture cannot see stutter), so these go to PERF:
  - The gameplay frame just before C5b: 0.88 s.
  - C1 36.3: 0.67 s (the truck's lights).
  - C2c 12.4: 0.39 s.
  - Just before C3: 0.37 s.
  - C7 1.63: 0.35 s.
  - C1 30.2: 0.30 s.
- **Realism (not smoothness):**
  - The risen stump is a flat red disc.
  - The arterial jets are solid red tubes.
  - The floor blood stream is a thin red string.
  - Harlan's forearm looks like plastic.

### Not bugs (checked)
- C2 → C2c: the torch clicks on onto headless Ada (authored scare).
- C2c whips at 0.35 / 3.7 / 4.58 / 6.75 / 7.55, and the C2 S9 whip-pan at 20.0: authored.
- C2 12.9 / 14.9: insert hard cuts.
- Lightning: C2b 1.0–1.3, the C3 strokes, the C4 strokes, the CR strikes. Their +100–190 draws are the stroke shadow
  passes.
- C6 3.0: the pour gate holds the clock for 1.2 s, but the picture stays alive.
- C1 17.6 / 26.6: car-space shots hide 145 m and 167 m vehicle-track jumps (no visible change).
- Every gameplay hand-back turn of ≥ 20° in one frame is the bot's look, not the game.
- C6b / C7 viewed in a 12-tile overview (strips/c6b_c7_over.jpg) and CR 0–24 → title (strips/cr_end.jpg): no
  broken content; the credits roll and fade cleanly. The title card appears on a cut from the near-black "Made from
  scratch." card (luma 4e-5 → 2.3e-3), which is acceptable.

### Claims from STATUS-smooth-frames.md
- **Confirmed:**
  - C2: head attached, no ring, contact, fall.
  - C2: the rise has no pop.
  - C0 crane whip fixed (≤ 2.9°/frame).
  - C1 radio, dome, visor and crane whips fixed (≤ 2.2°/frame; lowest pitch −31°).
  - C1 S4a/S4b/S4c lens and lean steps fixed.
  - C3 / C4a 0.333 snap fixed (×0.97).
  - C2c 1.6 / 10.4 / 12.4 easing and the 12.9–13.9 lens return (≤ 3°/frame).
  - C4c start and end.
  - C5 12.47 wall (min luma 0.0022), C5 29.8 torch pool steady, C5b start (0.10 m).
  - C6 0.0 sweep and C6 1.6 lens; C6 22.3 pump (the car passes behind it); C6 26.3–26.8 gate (no post in the cabin);
    C6 31.0 (constant 0.123 m/frame).
  - C7 9.73 (constant 0.629 m/frame).
  - C2b floor flicker and 11.0 flash gone; C2b plays for a patient player.
  - 0 console errors.
- **Refuted:**
  - Tableau → C2 "no pop": the pose matches, but the light does not (finding 1).
  - "Post-cut exposure fixed": one wrong frame per cut remains (finding 2a).
  - "C4c memory flash-frames are authored cuts": each opens on a black frame (finding 2b).
  - "C1 56.9–57.1 physical glare" (finding 4).
- **Still open, as reported before:** C4a / C4 black (finding 9) and the C2 floor-head roll (finding 8).

### Requests for the lead
- Findings 1, 2a, 2b, 3, 4, 5, 6, 7, 9 and 10 need owners: FRAMES (c2-room, c1-empty, c2c-up, bindings), FLASH (exposure.ts,
  flashlight) and OBJECTIVE (story-runtime / objective).
- Finding 8 goes to lane A.
- PERF: the 20 Hz third-cube shadow, and the stutter candidates.
- Re-run this hunter on the fixed dist with the same commands. The run commands are in the scratch/hunt/*.log heads;
  run.sh / run2.sh / objwrap.mjs are in scratch/hunt.

### What this method cannot see
- Real-time stutter: only the capture step-time proxies above.
- Ada's stop-motion being switched back on at gameplay hand-offs: at every hand-off the bot turns away on the first
  gameplay frame.
- CSS fades in real time: the objective transitions run on wall-clock time. The DOM log (h2a/objlog.json) gives the
  logical state for C0/C1/C3/C4/C4a only; the C2 and C2b objective evidence is pixel-based.

## Lead note 2026-10-12 17:45 — OBJECTIVE line findings (hud) FIXED by the lead (contract #148 amendment)
- Flash/flap before C2 / C2b / C4a: `src/ui/objective.ts` now shows the line only after `show` has held 0.4 s
  (SHOW_HOLD_S); it hides at once. The 1–3 frames between a story trigger and the cutscene taking the camera can no
  longer flash it.
- C4 wardrobe ("Hide in the wardrobe" while already in it): `src/game/story-runtime.ts` hides the line while the player
  is inside the hide the objective names (P_ARMOIRE → H_ARMOIRE, P_ADA_WARDROBE → H_ADA_WARDROBE).
- Fixers: don't re-fix these; re-verifiers: please re-check them.

## Re-verify
Independent re-check of the SMOOTH-FIX lane's round 1 (contract #145, docs/STATUS-smooth-fix.md) against hunt findings
F1–F10, on a fresh dist, with the hunt's own capture method. Edited nothing in src/. Work dir scratch/reverify/.

### Setup
- Dist: scratch/dist-reverify, built 22:23 2026-10-12 from the working tree; verify-boot OK. Files changed after the
  fixer's last capture (max5, 22:20): src/cutscenes/c2-room.ts 22:16 (the 'decel' revert), src/characters/arms.ts 22:17
  (FLASH, in progress), scripts/qa/hand-views.mjs 22:18. src mtimes at build: scratch/reverify/tree-at-build.txt.
- Captures (serial, scratch/reverify/run.sh; on BATTERY 62 % at launch, queued behind FLASH's hand-cs runs):
  - rv1 = hunt h1 + objective DOM log: Medium, c2b-patient via objwrap, SCENE=C2,C2c,C2b, PRE=3, POST=2.
  - rv4max = hunt h3max + F5/F6 windows: Max, C2 [0,12] [19.8,23] [27.3,29].
  - rv2b = hunt h2b: Medium, SCENE=C4c,C5,C5b,C6,C6b,C7,CR.
  - rv2a = hunt h2a + objective DOM log: Medium, SCENE=C0,C1,C3,C4,C4a.
- Results are appended per run below as each one landed. All four runs finished with exit 0, 0 console errors and 0 exceptions; typecheck clean, npm test 315/315.

### rv1 (Medium, C2 → C2c, C2b; 22:29–22:32; 0 console errors, 0 exceptions; C2b played; det/rv1-*)
Detection: scripts/qa/detect.py on each segment, then scratch/reverify/ddiff.py (new events vs the hunt's det at the same
cutscene clock), the hunt's cutcheck.py, the fixer's cuts.py, scratch/reverify/handoff.py (eye step, turn, fov,
exposure and luma per frame across a hand-off) and the hunt's objho.py on the objective DOM log (rv1/objlog.json).
- **F1 (C2 hand-off): the ×16 flash is FIXED.** B03 → C2 luma 0.0085 → 0.0098 | 0.0130 (×1.33 on the cut frame; the
  walk-in trend is ×1.12–1.15 per frame) → 0.0156 → 0.0177 → 0.0185 → 0.0161 → 0.0124 → 0.0071 → 0.0044 → 0.0029, then
  0.0024–0.0026 (hunt: 0.0016 | 0.0259 ×16). Strip strips/f1_handoff.jpg: C2's first frame looks like the gameplay
  frame (the same haze and torch hot spot on the jamb). Over 0.3 s the pool fades and the room's lamp light comes up.
  The jamb's moulding glints and bokeh at 0.13–0.4 s (strips/f1_jamb_crop.jpg) are the same in the hunt
  (f1_jamb_crop_hunt.jpg), so they are not new.
  - Residual, already in the hunt and not part of F1's luma claim: on C2's first frame the eye moves 0.096 m (0.053
    before, 0.042 after: the fixer's request 8, a double step). The look turn goes 0.02 → 0.40°/frame and the zoom
    starts at its full 2.6°/frame (70 → 67.4 → 64.8 fov) with no ease-in. This is a small velocity kick on the
    hand-off frame.
- **F5 (C2 hall 20.5–22.4): FIXED.** 20.6–22.37 luma 0.0006–0.0010 (hunt < 2e-5). One frame at 22.40 is 0.0003: the
  sweep crosses the dark wall and lit door edges remain in frame. At display gamma (strips/f5_hall.jpg) the door frame,
  fanlight, rope pulley and stair rail read throughout. The picture is dim but never pitch-black.
- **F6 (C2 27.7 door): FIXED.** 27.6–28.97 dims smoothly ×0.85–0.95 per frame (0.0116 → 0.0014). No one-frame drop and
  no ghost frame. C2's last frame is 0.0014; C2c 0.0 is the authored torch-on.
- **F8 (the head rolls by itself): FIXED.** The S3 frame (7.97–8.6) and the lurch (8.6–8.93) do not show the head on the
  boards. It enters frame at 8.97–9.0 already face-up, and through E4 (9.0–9.83) it stays still (strips/f8_roll.jpg,
  f8_lurch.jpg).
  - Also re-checked: the head is on the body at 7.3, 7.5, 7.567 and 7.6, and it separates at 7.633
    (strips/c2_sever_crop.jpg), as in the hunt.
- **F2a, C2b cuts: FIXED.** 0.033 ×1.11, 3.033 ×1.00, 7.033 ×1.00, 9.533 ×1.09 (hunt 3.033 ×7, 7.033 ×0.41).
  - The hand-back at f420 (×0.01) is the bot switching its torch off on the first gameplay frame (turn 0.2°, then 99°),
    so it is not judged.
- **F10, C2 and C2b: FIXED** (DOM log, which the hunt did not have).
  - Before C2 and through C2 → C2c: the class is 'tk-obj is-fresh' (not is-on) and opacity is 0 on every frame.
  - C2b pre-roll: same.
  - The step text changes ('Slip into the bedroom…' at bt 211.23) while the line is off.
  - The line does come back in gameplay: is-on 1.03 s after the C2c hand-back (bt 170.07) and 1.0 s after C2b
    (bt 223.63). So the REVEAL_S hold does not suppress it.
- **F7 (C2c top of the stairs): NOT FIXED. The black frames moved; they are not gone.**
  - 8.53–8.93: no black frames (luma 0.055–0.14). The pool bobs down to the bottom edge and back
    (strips/f7_c2c_86.jpg). Faint sparkle specks remain on the wallpaper beside the hot spot.
  - NEW, 10.73–11.03: the torch pool sinks off the bottom of the frame while the eye tilts up at 0.8–2.8°/frame. Luma
    goes 0.065 → 0.032 → 0.0056 → 0.0005 → 0.0000 ×4 → 0.0009 → 0.0149 → 0.042 → 0.083 (strips/c2c_108.jpg): five frames
    of black with only the white sparkle cluster left, then the pool comes back.
  - The hunt had 0.033–0.036 here. The fixer's after2 has the same black (a2-C2-1), so it came between the hunt (16:40)
    and after2 (19:50). That window holds the fixer's C2c edit (arms_breath_hold from 8.4, the 9.0 inOut stop, 18:17)
    and FLASH's hand spring (flashlight-rig.ts, 18:16). Neither is isolated yet.
- **NEW, C2c 6.6–6.77: six black frames in the 6.75 whip.** Luma 0.0136 → 0.0000 ×6 → 0.0124 → 0.0169 → 0.152
  (strips/c2c_66_76.jpg).
  - The hunt had 0.04–0.14 here and after2 had 0.05–0.23: the torch pool used to sweep with the whip.
  - This is not in after2, so it came after 19:50. My dist differs from after2 in FLASH's arms.ts (22:17) and the
    regenerated arm assets (public/assets/*/arms.glb, blender/anim/clips_arms.py), plus c2-room.ts. Probable owner:
    FLASH (the hand spring, or the near-wall pullback / aim acting inside an authored shot; their own status still lists
    'arms.cutsceneHold' as unwired).
  - C2c 7.567–7.633 is also darker than in the hunt (0.0000 vs 0.003), during the authored 7.55 whip.
- Minor new: C2c 0.1–0.3 (torch on headless Ada): the pool's brightness wobbles ×1.35 / ×0.81 / ×0.71 / ×1.10 frame to
  frame (detect FLICK 62 at 0.233; hunt 14). It looks like the 4.5 Hz hand spring. C2b 10.267 FLICK 32 (hunt 10).
- No other new FLICK, POP or one-frame luma step in C2 (ddiff: only 28.567 POP 46 on a 0.002-luma frame).
- Cause evidence from the rows' `tl` (torch light PLAN position):
  - C2c 6.6–6.87 (new black): rv1's torch hangs 0.4–0.7 m under the eye (light z 3.36–3.71, eye z 4.08). after2 had it
    at z 4.17–4.50, within ~0.1 m of the eye. The camera pose matches after2 to 0.01 m. So the arm/torch placement
    changed after 19:50: FLASH's arms.ts (22:17) or the regenerated arms.glb / clips_arms.py (FLASH/HAND lanes, in
    progress). This is a regression in the current tree, not in the fixer's cues.
  - C2c 10.73–11.03 (black): the torch is in the same place in rv1 and after2 (within 0.03–0.08 m), and both are black.
    So this came in between the hunt and after2. Suspects: the fixer's C2c edits (18:17) or FLASH's flashlight-rig hand
    spring (18:16). Not isolated.

### rv4max (Max, C2 windows 0–12 / 19.8–23 / 27.3–29; 22:32–22:42; 0 console errors, 0 exceptions; det/rv4max-*)
- F1 Max: FIXED. 0.0077 → 0.0086 | 0.0111 (×1.28; the walk-in trend is ×1.12) → 0.0129 → 0.0147 → 0.0149 → 0.0132 →
  0.0106 → 0.0057 → 0.0035 → 0.0025 → 0.0021 (hunt Max 0.0026 | 0.0262 ×10).
  - ddiff's only new event in 0–12 s is the last step of the torch fade (0.233: ×0.54; Medium ×0.57). The pool's last
    0.1 s falls ×4 in 3 frames. It is a fast fade, not a cut, and minor.
  - The same 0.096 m / 0.56° kick on the first C2 frame as on Medium.
- F5 Max: FIXED. 20.6–22.37 0.0007–0.0009; 22.40 0.0003 for one frame (the sweep crosses the dark wall), as on Medium.
- F6 Max: FIXED. 27.6–28.97 dims smoothly 0.0118 → 0.0014; no one-frame drop.

### rv4max (Max, C2 [0,12] [19.8,23] [27.3,29]; 22:40–22:42; 0 console errors, 0 exceptions; det/rv4max-*)
- **F1 Max: FIXED.** 0.0077 → 0.0086 | 0.0111 (×1.28 on the cut frame; the walk-in trend is ×1.12) → 0.0129 → 0.0147 →
  0.0149 → 0.0132 → 0.0106 → 0.0057 → 0.0035 → 0.0025 → 0.0021 (hunt Max 0.0026 | 0.0262 ×10). The eye makes the same
  0.096 m double step on the first frame as on Medium.
  - Both presets show the same shape: a ×1.9 rise over 0.13 s (the torch pool on the approaching jamb) and then a fall
    to ×0.3 of the gameplay level by 0.3 s. That is a continuous 0.3 s ease, not a one-frame jump.
- **F5 Max: FIXED.** 20.6–22.37 0.0007–0.0009, with one frame of 0.0003 at 22.40 (the same as Medium).
- **F6 Max: FIXED.** 27.6–28.97 dims smoothly 0.0118 → 0.0014.
- **Head on Max (strips/max_sever_roll.jpg):** on the body at 7.5 and 7.567, off at 7.633, falling at 7.7; face-up and
  still on the boards at 9.0 and 9.4. The roll is not seen.
- ddiff vs the hunt's h3max and the fixer's m5: no new FLICK, POP or one-frame luma step. Only C2c 0.1 FLICK 32 (the
  torch-on wobble, as on Medium).
- Realism note (not smoothness): at 8.4–8.9, on both presets, her body's neck stump at the sawbuck edge reads as a flat
  white card with a red top (strips/max_sever_roll.jpg 8.9, f8_lurch.jpg). The hunt's "flat red disc" item; still open.
- Cause notes for the two new C2c black stretches. They come from the rows' `tl` (torch light position) against `cp`
  (eye). Heights are PLAN z; below = under the eye.
  - 6.5–7.0 whip: rv1's torch is 0.29–0.67 m below the eye, 0.60–0.75 m from it. after2's was 0.09–0.20 m ABOVE the eye,
    0.26–0.51 m from it: the hand raised the torch for the whip.
  - Everywhere else in C2c the two runs agree within 0.05 m. So in this build the arm no longer raises the torch for the
    whip, and its pool falls out of the frame. This is FLASH's arms or the regenerated arm clips, not #145.
  - 10.73–11.03: both rv1 and after2 have the torch 0.39–0.46 m below the eye here; it is the arms_breath_hold clip's
    lowering beat.
  - The hunt had the same beat 0.6 s later (11.33–11.53, a dip to 0.0054, not black). #145 moved the cue from 9.0 to 8.4,
    and the dip now lands while the eye tilts up, so the pool leaves the frame completely. This regression is #145's.

### rv2b (Medium, C4c, C5, C5b, C6 → C6b → C7 → CR; det/rv2b-*)
- **F2b (C4c memory flash-shots): FIXED.** Every cut frame equals the next two:
  - 2.5: 0.1007 | 0.1010
  - 2.933: 0.0673 | 0.0673
  - 5.533: 0.0995 | 0.0995
  - 5.933: 0.0427 | 0.0440
  - 6.333: 0.1054 | 0.1042
  - The hunt had 1e-4 black on each cut frame. The flash-frames are no longer near-white (0.07–0.10; after2 had
    0.29–0.67). The 3.3 shot is 0.075–0.095 (hunt 0.0001, 0.5 s of black).
  - C4c 3.4 FLICK 64: corrected 23:3x, this is a POSE POP, not a glint. Ada's left arm and the held head jump, and her
    right arm appears, in one frame (strips/c4c_34_big.jpg; the other write-up's N2). The fixer's beam fix made the
    pop visible.
- **C4c start (not a hunt finding, but checked):**
  - The cut frame is ×1.74 brighter than the last gameplay frame. The gameplay eye was at 0.133 and C4c's fixed 0.2
    applies on the cut (the hunt had ×1.4; the fixer's after3 had 0.248 → 0.2, ×0.85). The step depends on where the
    player's eye meter happens to be. It is a pre-existing exposure snap at hand-in, not an F2b regression.
  - Luma then dips 0.0141 → 0.0037 and climbs to 0.028 by 0.6 s. The strip (strips/c4c_start.jpg) shows her dark body
    entering the torch pool, then her lit red torso filling it: picture content, not a pump.
- **Minor HUD, all cutscenes:** in strips/c4c_start.jpg the steady objective line "Hold still. Let her look." still
  shows on C4c's first frames. ui/objective.ts hides it on the cut, but the CSS opacity transition (.45 s) fades it out
  over the cinematic's first 0.45 s of real time. A cutscene's first frames should not carry the HUD: snap it off
  (transition: none) when the hide is caused by a cutscene. This is not F10's flash (F10 is fixed); it is the hide
  fade.

### rv2b (Medium, C4c, C5 → C5b, C6 → C6b → C7 → CR; started 22:49)
- **F2b (C4c black flash-frame openings): FIXED.** Every cut frame now equals the frames after it: 2.5 0.1007, 2.933
  0.0673, 5.533 0.0995, 6.333 0.1054; the frames before the cuts read 0.0109 / 0.1002 / 0.0768 / 0.0470 (hunt: 1e-4
  on each cut frame).
  - The flash-frames are exposed, not white (strips/f2b_c4c_flash.jpg): the boards, the bell crank, the hatch and the
    slats read.
  - The 3.3 shot is lit (0.067–0.095; it was pure black after the 17:00 exposure change).
- **NEW, user-visible (exposed by that fix): C4c 3.4 → 3.433, Ada's pose pops in one frame** (strips/c4c_34_big.jpg).
  - Her left arm goes from hanging straight (the hand at the head she holds) to bent outward with the head lower.
  - Her right arm appears in frame, all with no camera move (turn 0°, step 0 m); detect: FLICK 64 at 3.4, POP 52–62 at
    3.43–3.57.
  - The cue is `{ t: 3.4, clip: 'ada_finale_take', speed: 0.5, fade: 0.15 }` (c4c-remembers.ts:142). The 0.15 s fade
    does not hide the pose change.
  - Before #145 this shot was black, so nobody could see it.
- **NEW, minor: C4c 0.033 hand-off: a ×1.74 step on the first frame, then a dip.**
  - The step is the eye's 0.134 jumping to C4c's fixed 0.2 on the first frame. The dip is 0.0141 → 0.0037 at 0.17–0.2,
    back to 0.011 by 0.3 s (strips/c4c_start.jpg: the torch hot spot on her leaves).
  - The hunt had ×1.39 then flat; after3 had ×0.85 then flat (its eye was at 0.248). The step depends on where the eye
    stands when C4c starts.
  - Fix: start C4c from the eye's exposure with a ramp, as F1 did for C2.
- **F2a, C5 / C5b cuts:**
  - C5 6.233 ×1.00 (hunt ×0.34) and 10.033 ×1.04 (×2.7): FIXED.
  - C5b 0.033 ×1.03, 3.533 ×1.00 (×1.85), 6.533, 10.533 and 12.533: all continuous.
  - **C5 25.6 is NOT changed:** the cut frame is 0.0005, then 0.0040 → 0.0051 (hunt 0.0001, then 0.0038 → 0.0047).
    The cut frame is still about 10 % of the shot, the same as the hunt. It comes out of the black shadowplay shot, so it
    reads as the picture arriving one frame late rather than as a blink: low visibility. But the fixer's
    "×44 → a smooth fade-in" is not a change.
  - C5 26.4 into black: the same as the hunt.
  - Hand-backs after C5 (×0.18) and C5b (×0.41) are the bot's torch-off.
- C5 16.7–25.6 is lit by lightning only (0.0000 between strokes), identical in the hunt and after2: authored, not
  re-judged here.
- **NEW for the report, already in the hunt at a lower level: C5 30.033–30.2, the torch pool beside the front door
  blinks off for 6 frames.**
  - Luma 0.0077 → 0.0015 → 0.0007–0.0010 → 0.0059 (×0.19, then ×7.7); strips/c5_135_300.jpg, bottom row.
  - The hunt's data has the same 6-frame dip at 30.133–30.3 (0.0009 → 0.0003 → 0.0009), unflagged at that level. The
    timing moves with the cleat insert's clock push. The current exposure makes it obvious.
  - It is during the D_PARLOR close (28.8 + 0.8 s insert push) and the 29.3 / 29.4 latch and lock. Owner: c5-face.ts or
    the lights.
- C5 13.53–13.63: the torch pool fades out in 4 frames (0.0183 → 0.0099 → 0.0034 → 0.0012), the same in after2.
  Quick, but continuous: minor.
- **F2a, C5 / C5b cuts: FIXED.**
  - C5 cuts: 6.233 0.0471 | 0.0471 and 10.033 0.0098 | 0.0102 (hunt ×0.34 / ×2.7).
  - C5 25.6 (cleat insert, from black): 0.0000 → 0.0005 → 0.0040 → 0.0051 (hunt 0.0001 → 0.0047). The cut frame shows
    the insert at about 1/8 brightness, readable (strips/c5_256.jpg). Coming out of black it reads as a 2-frame fade-in,
    not a black frame.
  - C5b cuts: 3.533 / 6.533 / 10.533 / 12.533 each equal the following frames (hunt C5b 3.533 ×1.85).
  - Hand-backs at f1043 (×0.18) and f1514 (×0.41) are the bot turning its torch off; not judged.
- **NEW, C5 30.033–30.2: the torch pool blinks off for 6 frames.**
  - The shot is static: the eye moves ≤ 1 mm per frame, the look is fixed and the exposure eases 0.119 → 0.111.
  - The row's torch light stays on at the same position (intensity 1970–2000).
  - Yet the hot spot on the door jamb vanishes at 30.033 and comes back at 30.233. Luma 0.0077 → 0.0015 → 0.0007 →
    0.0059 (strips/c5_134_300.jpg, bottom row).
  - CORRECTED 23:3x: pre-existing. The same 6-frame dip is in after2 at 30.467–30.633 (the insert pushes the C5 clock),
    in after1 at 30.0–30.17 and in the hunt at 30.13–30.3 (×0.33). It is not FLASH's regression; the current exposure
    makes it more visible.
- C5 13.4–13.63: the torch fog/pool on the left fades out in 0.2 s (0.025 → 0.0008, ×0.35–0.5 per frame) while the eye
  creeps on at 2.5 cm/frame. after2 does the same 1 frame earlier; the hunt had no lit pool here. A soft fade, not a
  blink. Noted, not a finding.
- Pre-existing and unchanged (same in the hunt; not on the hunt's list): C5's shadow play is black between its strokes.
  Luma ≤ 0.0002 at 16.1–17.5 and 18.2–20.4, and 0.0000 for 1.4 s at 19.0–20.4. The cue comments call this designed
  ("black · one stroke"), but it sits against the "never pitch-black on screen" rule. AD call.
- **F2a, C6 / C6b / C7 cuts: FIXED.** Each value is the cut frame against the next frame (hunt in brackets):
  - C6: 7.533 ×1.00, 8.433 ×0.99, 10.433 ×1.04 (×5.6), 27.8 ×0.99 (black).
  - C6b: 6.033 ×0.98 (black), 8.533 ×0.98 (×6.7).
  - C7: 3.533 ×0.94 (×7), 15.833 ×0.97 (cleat ×28 white), 16.833 ×0.98 (black), 18.6 ×0.98 (guest book ×50 white),
    22.6 ×0.99 (black).
  - The strip (strips/f2a_c6_c7_cuts.jpg) shows every first frame exposed like the shot it opens: the cleat insert and
    the guest book are warm and readable, not blown.
  - No step when the cutE hold ends (cuts.py: no 'step+' flag on any of these cuts).
- C6 → C6b → C7 → CR: ddiff finds NO new FLICK, POP or luma step against the hunt anywhere in the 3203 frames.
  - C6b 0–2 and C7 0 / 10.3–10.9 are black and C7 fades in the same as the hunt: authored fades.
  - The run reached the CR roll and the title.
- rv2b: 0 console errors, 0 exceptions (22:42–22:56).
- **F2a, C6 → C6b → C7 → CR: FIXED** (one continuous segment; rv2b ran 22:52–22:56 with 0 console errors and 0
  exceptions). Each cut frame against the next frame (hunt ratio in brackets):
  - C6 7.533: 0.0763 | 0.0763
  - C6 8.433: 0.0139 | 0.0138 (×4.9)
  - C6 10.433: 0.0233 | 0.0243 (×5.6)
  - C6 27.8: 0.0122 | 0.0121 (black, ×20.5)
  - C6b 6.033: 0.0180 | 0.0176 (black, ×15.7)
  - C6b 8.533: 0.0086 | 0.0084 (×6.7)
  - C7 3.533: 0.0173 | 0.0162 (×7)
  - C7 15.833: 0.0089 | 0.0086 (blown ×28)
  - C7 16.833: 0.0051 | 0.0050 (black)
  - C7 18.6: 0.0193 | 0.0190 (blown ×50)
  - C7 22.6: 0.0121 | 0.0120 (black)
  - cuts.py found no step when the cutE hold ends (+2…+6 frames), except the authored fades from black at C6b 2.0,
    C7 0 and C7 10.83.
  - ddiff against the hunt's h2b-C6-2 (3136 frames matched by clock): no new FLICK, POP or one-frame luma step. The
    largest local pop, C6b 4.333 (61), is the wick catch.
- Still open (the hunt's minor item, untouched): the C6b 4.333 wick catches ×5.2 in one frame (0.0055 → 0.0284; hunt
  ×3.9), then ×1.66 at 4.567.
- The whole C6 take is ×2.5–3 brighter than in the hunt (C6 26.4: 0.090 vs 0.029). This comes from the 17:00
  pipeline exposure fix, the fixer's request 2 (the FLASH look pass), not from #145.
- F6 visual (strips/f6_door.jpg, display gamma): 27.6–28.97 the lit door face narrows as the leaf closes and Ada walks out; no ghost-outline frame; C2c's torch-on follows on the cut. F6 FIXED (luma and look).

### rv2a (Medium, C0 → C1, C3, C4, C4a + the objective DOM log; started 23:07 after Blender waits)
- **F2a, C0 / C1 cuts: FIXED.** Each value is the cut frame against the next frame (hunt in brackets):
  - C0: 12.517 ×0.98, 19.017 ×1.01, 26.017 ×0.90.
  - C1: 0 ×0.96 (hunt C1 0 ×1.75), 6.633 ×1.00, 11.633 ×1.03, 43.4 ×1.03, 56.633 ×1.00, 62.033 ×0.99,
    69.033 ×1.00 (×4 blown).
  - No 'step+' flag on any cutE hold except C1 37.8, which is the authored lightning, as the fixer and FRAMES noted.
- **F3 (C1 step-out): FIXED for smoothness; a realism residual remains on the lens.**
  - 69.033 has no blown frame. 69.0–70.3 holds the lit lens on the navy flank at 0.0050–0.0057.
  - 70.33–70.73 is a smooth 0.4 s dim as the eye rises past the trunk (×0.8–0.25 per frame down to 0.0002 at 70.53 and
    70.57). At display gamma the wheel, the flank and the gravel still read (strips/f3_stepout.jpg). It is a dim pass,
    not a blink.
  - The drive is visible from 70.77 and the hand-back at 73.7–74.7 is flat (0.0067 → 0.0134 over 0.3 s, then steady).
  - The lens (strips/f3_lens_crop.jpg vs f3_lens_crop_hunt.jpg) now has a rim, a chrome divider and a slight gradient.
    It is still an even orange-salmon, not the deep red of a lit tail lamp: realism, not smoothness.
- **F4 (C1 S9): FIXED.** The pan accelerates and decelerates monotonically (0.09 → 0.72 → 0°/frame, max 1.9 % of the
  vertical FOV per frame) with no kink (scratch/reverify/c1_s9_pan.txt).
  - The car's lamps stay in frame (strips/f4_s9_60.jpg). The largest luma step from 56.65 to 61.6 is ×1.18 (60.0, a
    porch lamp entering the frame edge).
  - 61.63 ×0.48 is the authored lamps-off, identical in the hunt.
- New-event diff for C0 / C1: one-frame FLICK / POP events in the moving-car shots (C0 28.38, C1 3.0 / 5.0 / 5.6 /
  43.9 / 49–55). They sit at different clocks in each run (after2 and the hunt have others). C0 28.38 checked
  (strips/c0_284.jpg): it is the windshield wiper crossing the frame in about 4 frames. Not a defect of #145.

### rv2a (Medium, C0 → C1, C3, C4, C4a, with the objective DOM log; det/rv2a-*)
- **F2a, C0 / C1 cuts: FIXED.** Each cut frame against the next frame:
  - C0 12.517: 0.0063 | 0.0062
  - C0 19.017: 0.0240 | 0.0242
  - C0 26.017: 0.0151 | 0.0136
  - C1 0: 0.0108 | 0.0104
  - C1 6.633: 0.0168 | 0.0168
  - C1 11.633: 0.0229 | 0.0236
  - C1 43.4: 0.0087 | 0.0090
  - C1 62.033: 0.0108 | 0.0107
  - C1 69.033: 0.0060 | 0.0060
  - C1 37.8 (black cut frame, then the lightning) is not on the hunt's list. The fixer calls it authored.
- **F3 (C1 step-out): FIXED, with a residual.**
  - The 69.033 cut is continuous (hunt ×4 blown).
  - 69.0–70.3: the shaded orange-red lens on the navy flank, luma 0.0050–0.0057.
  - 70.33–70.77: the camera rises past the trunk and luma dips to 0.0002–0.0009 (lowest 70.533–70.6). At display gamma
    (strips/f3_stepout.jpg) the navy flank, the wheel arch and the wet gravel still read in every frame, so there is no
    black frame.
  - The drive opens from 70.77 (0.0026 → 0.0118 by 71.0). The hunt had 1.4 s of black plus a flat salmon lens, then
    pure black 70.5–70.9.
  - Residual (AD): for 1.3 s the frame is mostly one flat navy field with the lens stripe in it.
- **F4 (C1 S9 roadside): PARTLY FIXED.**
  - The headlight wash no longer cuts out. 56.6–59.0 changes ≤ 4 % per frame. The 57.067 ×0.4 drop is gone.
    59.2–59.4 eases ×0.84 per frame as the beams leave the road. 61.633 ×0.48 is the authored LIGHTS_DIE (61.6), the
    same in the hunt.
  - The one-frame left-edge flare has MOVED, not gone.
    - At 56.9 the left 40 px strip is now steady (16); the hunt had 18 → 72 → 41.
    - The same signature now appears at 60.0: 13.7 → 44 → 57 → 51 → 42 → 29 over 0.2 s
      (strips/c0c1_new.jpg, row 3).
    - At the same frame the posts at the left brighten +12 % (31.8 → 35.5 → 37.9) and stay brighter.
  - Cause: the new CameraShot.track pan carries the lantern's glow across the left frame edge at 60.0 instead of 56.9.
    It looks like screen-space bloom and/or a light cull switching on as the source enters the frustum.
  - Fix suggestion: keep the lantern's bloom/light independent of frustum entry, or frame S9 so the lantern never
    crosses an edge.
- New in ddiff vs the hunt (C0/C1):
  - C0 28.383 FLICK 93: the wiper entering the frame. Authored; the wiper phase differs from the hunt. Not a bug.
  - C1 43.867 FLICK 58: a one-frame white glint on the dash/windscreen next to the gauges (strips/c0c1_new.jpg, row
    2). Minor.
  - C1 3.0–5.8, 35.0, 49.4–53.1: FLICK 25–48 in the moving-car shots (rain on the glass). Below visibility in the
    strips. Minor.
- rv2a ran 23:11–23:14: 0 console errors, 0 exceptions.
- **F9 (pitch-black stretches): NOT FIXED.**
  - **C4a dolly 8.0–10.0:** frame luma is still 0.0000–0.0001, the same as the hunt.
    - The baked lift does work at the window. In the top band (rows 0–220, no subtitles) the brightest pixel rises from
      6 (hunt) to 89 (rv2a) / 110 (after2), and the window, the sill and two board edges read at gamma 0.45
      (strips/c4a_rv_vs_a2.jpg).
    - But the frame mean stays at 0.3–0.4 / 255. At normal display it is a black frame with a faint window.
    - Correction to the fixer's numbers: their "0.0000 → 0.0024–0.0036" luma came from a SUBTITLE PANEL. Harlan's
      voice line was on screen in after1/after2 at 8–11 s (subtitle band mean 17/255). Outside that band, rv2a and
      after2 are equal (0.39 / 0.40 mean). The same applies to their C4a 5.0–7.9 numbers (0.0019–0.0026 vs rv2a
      0.0003–0.0005).
  - **C4 wardrobe hem / look / leave:** median luma 0.00007–0.00012, darker than the hunt's 0.00016–0.00022. Not
    touched (the fixer's request 3).
- **F10, C4a: FIXED** (DOM log).
  - The line stays on and steady through the gameplay before C4a. It is set off 2 frames before the cut (bt 271.2) and
    fades out over the cut, with no on/off/on flip.
  - Its text stays "(0/3)" until it is fully off. It swaps to "(2/3)" at C4a 0.4, under the cinematic, at opacity 0.
  - C4 wardrobe (the lead's fix): the line is off (opacity 0) for the whole hem overlay (C4_approach → C4_leave). The
    stale "Hide in the wardrobe" is no longer shown.
- **NEW minor (objective.ts, from #145's REVEAL_S): a one-frame 'is-on' blip at every new step.**
  - In `update()`, `want` is computed (line 89) BEFORE the pending swap block resets `revealT = REVEAL_S` (lines
    98–106). So on the frame the new text is applied, `setOn(want && !pending)` turns the line on. The next frame
    turns it off. It then fades in properly 1.0 s later.
  - DOM log: 'Search the bedroom' (226.4), 'Take the hammer' (228.667), 'Pry the boards…' (249.233), 'Cut open the
    hem' (288.067) and 'Ask at the house' (rv1) each go is-on for one frame, opacity 0.11–0.22 in the stepped capture.
  - In real time the CSS fade gets 1–2 frames, about ≤ 0.02 opacity, probably invisible. It is still a logic bug.
  - Fix: compute `want` after the swap block, or test `revealT` again before `setOn`.
- **Minor HUD:** the steady line fades out OVER the cutscene's first frames: C4a opacity 0.458 on the first cut
  frame, 0 by 0.27 s; C4c the same. See the C4c note above.
- C3 and C4a: the only new ddiff events are lightning pulse shapes (C3 1.37 / 4.4 / 10.03, C4a 10.23). The strokes
  are authored multi-pulse and their timing differs from the hunt. Not bugs.
- **F2a, C2c 3.667: UNCHANGED (×6.9; hunt ×6.4), not addressed by #145.** The frame is the first of the authored
  220 ms glance back over the shoulder (24–37°/frame, the torch arm stays forward), so the view leaving the torch pool
  is physical. Listed by the hunt; left as is.

### Re-verify verdicts (fresh dist built 22:23; Medium all scenes C0 → CR + Max C2; 4 runs, 0 console errors, 0 exceptions)
| id | verdict | evidence |
|---|---|---|
| F1 | FIXED | ×16 → ×1.33 (Medium) / ×1.28 (Max) on the cut frame, then a continuous 0.3 s ease. Strip f1_handoff.jpg. The first frame's 0.096 m double step remains (fixer's request 8, also in the hunt). |
| F2a | PARTLY (every metered cutE cut fixed; C2c 3.667 not) | C0 ×3, C1 ×6, C2b ×4, C5 ×3, C5b ×4, C6 ×4, C6b ×2, C7 ×5: each cut frame is within 6 % of the next. C2c 3.667 is unchanged (×6.9): an authored whip off the torch pool, not addressed. |
| F2b | FIXED | C4c 2.5 / 2.933 / 5.533 / 6.333 cut frames equal the next. Flash-frames 0.07–0.10. The 3.3 shot is lit (0.075–0.095). |
| F3 | FIXED (residual) | No black frame. 70.53–70.6 is 0.0002 but the flank, wheel and gravel read (f3_stepout.jpg). Residual: a flat navy field for 1.3 s (AD). |
| F4 | PARTLY | The headlight wash is continuous. The one-frame left-edge flare moved from 56.9 to 60.0 (edge strip 13.7 → 44 → 57; c0c1_new.jpg). |
| F5 | FIXED | Medium and Max 20.6–22.37 at 0.0006–0.0010. The door, fanlight, rope and rail read (f5_hall.jpg). |
| F6 | FIXED | Medium and Max dim smoothly 27.6 → 28.97 (0.012 → 0.0014). |
| F7 | NOT FIXED | 8.53–8.93 is clean, but the same failure (torch pool off the frame → black) now shows at C2c 10.73–11.03: 5 black frames (c2c_108.jpg; already in the fixer's after2). New: 6.6–6.77, 6 black frames (c2c_66_76.jpg). Wallpaper sparkle remains. |
| F8 | FIXED | The head is never seen turning; it enters at 9.0 face-up and stays still (f8_roll.jpg, f8_lurch.jpg, max_sever_roll.jpg). |
| F9 | NOT FIXED | C4a 8–10 frame luma is 0.0000 (mean 0.3/255). Only the window and two board edges read. The fixer's 0.0024+ was a subtitle panel. The C4 slat view is untouched and darker than the hunt. |
| F10 | FIXED | DOM log: C2 / C2b / C4a pre-rolls have no fresh line and no on/off/on, the text swaps only at opacity 0, and the C4 hem line is off. New minor: a one-frame is-on blip at every new step (objective.ts `want` computed before the swap). |

New since the hunt (regressions):
- **R1 — C2c 6.6–6.77: 6 black frames, and 7.567–7.633 at 0.0000.**
  - The torch light hangs 0.4–0.7 m under the eye. after2 had it within 0.1 m.
  - Came in after 19:50. Probable owner: FLASH (arms.ts 22:17 / the new arm assets; `arms.cutsceneHold` is unwired).
- **R2 — C2c 10.73–11.03: 5 black frames.**
  - Caused by #145's own cue shift (corrected 23:3x). The breath-hold clip's lowering beat sits at clip time ≈ 2.4 s:
    the hunt dips at 11.33–11.53 (clip from 9.0), rv1 goes black at 10.8 (clip from 8.4).
- **R3 — C5 30.033–30.2: the torch pool blinks off for 6 frames** on a static shot. The light stays on at the same
  position in the rows.
  - PRE-EXISTING, not a regression (corrected 23:3x). The same dip is in after1 (30.0–30.17), after2 (30.47–30.63,
    pushed by the insert clock) and the hunt (30.13–30.3, ×0.33). My earlier "after2 steady" read the wrong clock
    window.
  - Owner: FRAMES (c5-face.ts).
  - Note for the owner: after the +0.8 s insert shift, C5's `latch` sfx and the `D_PARLOR lock` cue land at
    30.1 / 30.2, right where the pool returns (30.233). after2 had the same cues and stayed steady, so the cues
    alone are not the cause. Check whether the lock touches a light or shadow caster in combination with the new
    arm pose.
- **R4 — C1 60.0: the left-edge lantern flare** (F4's leftover).

Minor:
- The objective line fades out over each cutscene's first 0.45 s instead of snapping off on the cut.
- C2c 0.1–0.3: the torch pool wobbles ×0.7–1.35 per frame (the hand spring?).
- C1 43.867: a one-frame dash glint.
- C4c 3.4: glint sparkle (FLICK 64).
- C6b 4.333: the wick still catches ×5.2 in one frame.

Also run:
- npm test 315/315.
- typecheck clean.
- vite build + verify-boot OK.

What the stepped method cannot see, as before: real-time stutter, and the CSS timing in real time.

### Requests for the lead (re-verify)
1. FLASH: fix R1. In authored shots the torch must stay where the shot was framed for: wire `arms.cutsceneHold`, and
   check the 22:17 arms.ts / arm-asset change. Re-capture C2c 6.3–7.8.
2. #145 fixer: fix R2, its own cue shift. Keep the C2c pool in frame through 10.7–11.0, or move the clip back toward
   9.0. Re-capture C2c 10.5–11.2.
   - FRAMES (c5-face.ts): R3, the pre-existing C5 torch blink (now at 30.03 on the real clock).
   - FRAMES (c4c-remembers.ts): the C4c 3.4 pose pop.
3. F9 C4a: the ×30 lmScale reaches the window but not the room. Correct the fixer's after1/after2 C4a numbers (the
   subtitle panel). The AD calls the dolly's exposure (the fixer's request 4). The C4 slat view is still open (the
   fixer's request 3).
4. F4: the lantern at 60.0. The other write-up measured no light pop on the posts, so it is screen-space bloom at
   the frustum edge, minor. Fix it in the bloom or reframe S9.
5. objective.ts (lane C / lead): the one-line `want`-after-swap fix, and snap the line off (no transition) when a
   cutscene hides it.
6. Re-run this check after 1–5. The commands are in scratch/reverify/run.sh. The analysis helpers are
   scratch/reverify/ddiff.py (new events vs an older det by clock), handoff.py (per-frame step / turn / exposure /
   luma across a hand-off) and lw.py (luma by clock window).
- **F9 (pitch-black stretches): NOT FIXED.**
  - **C4a dolly 8.0–10.0:** luma 0.0000–0.0001 (hunt 0.0000); at display gamma only the window slit and a faint sill line
    show (strips/f9_c4a_dolly.jpg).
  - **The fixer's lift was a measurement artifact.** after2's 0.0024–0.0028 is HARLAN'S SUBTITLE on those frames
    (strips/f9_c4a_dolly_a2.jpg). Measured without the subtitle band (scratch/reverify/toplum.py, top 70 % of the frame),
    after2's picture is 0.00002–0.00011, the same as rv2a's 0.00002–0.00012. The lmScale ×30 lift is real but
    negligible: 0 → 1e-4.
  - **C4 wardrobe (hem / look / leave):** non-lightning median 7e-5–1.2e-4 (hunt 1.6e-4–2.2e-4). Untouched, as the
    fixer said.
- **F10 C4a: FIXED.**
  - The line holds 'is-on' 0.62 with the '(0/3)' text up to bt 271.17. It goes off 2 frames before C4a and fades out
    over C4a's first 0.27 s.
  - The text swaps to '(2/3)' at C4a 0.4, after the line reaches opacity 0. No on/off/on and no visible swap.
  - **The lead's C4 wardrobe fix is confirmed:** the line is off (opacity 0) for all of C4_approach → C4_leave
    (bt 295.17–321.97); the hunt had it on at 0.62 for 26 s.
- Minor, objective.ts (code and DOM log): a new step can show for ONE frame.
  - On the frame a new step is applied, the line turns is-on, then off on the next frame, then on again REVEAL_S later.
    Seen at bt 226.40, 228.67, 249.23 and 288.07; logged opacity 0.11–0.22 in the stepped capture.
  - Cause: `want` is computed (line 89) before the swap resets `revealT` (line 104), and `setOn(want && !pending)`
    (line 110) then runs with the stale `want`.
  - In real time the on-state lasts one 16–33 ms frame of a 0.45 s CSS fade (≈ 1–2 % opacity), so it is barely
    visible. Fix: recompute `want` after the swap.
- **F2a, C2c 3.667: NOT FIXED** (it is in the hunt's F2a list).
  - The cut frame is 0.0007, then 0.0048 / 0.0060 (×6.9; hunt ×6.4). C2c runs a fixed 0.458 exposure, so the black
    first frame is lighting (the torch), not the meter.
  - #145 added no cue for C2c.
- C3 (not touched by #145): the only new events are the lightning pulses (LT), which look steeper under the current
  exposure. Authored.
- rv2a: 0 console errors, 0 exceptions. C2b also played for the stock bot in this run.

### Verdicts (re-verify, fresh dist 22:23)
| id | verdict | evidence |
|---|---|---|
| F1 C2 hand-off ×16 | FIXED | Medium ×1.33 and Max ×1.28 on the cut frame (trend ×1.12), the pool fades over 0.3 s, the look matches. Residual: 0.096 m / 0.4° step and the zoom's full-rate start on frame 1 (already in the hunt). |
| F2a first frame after a cut | PARTLY (every cutE cut FIXED; C2c 3.667 and C5 25.6 NOT) | Fixed: C0 3, C1 7, C2b 4, C5 2, C5b 5, C6 4, C6b 2, C7 5, all ×0.90–1.04. Not: C2c 3.667 ×6.9 (no cue added), C5 25.6 unchanged from the hunt (0.0005 → 0.0040; it comes out of black, low visibility). |
| F2b C4c black flash openings | FIXED | Cut frames = the next frames (0.067–0.105); the flash-frames are exposed, not white. |
| F3 C1 step-out | FIXED (smoothness) | No blown or black frame; a smooth 0.4 s dim to 0.0002 where the flank and gravel read; the lens is shaded but still orange-salmon (realism). |
| F4 C1 S9 headlight cut | PARTLY | The wash cut is gone: a monotonic pan ≤ 1.9 % vfov/frame, luma steps ≤ ×1.18. Residual: at 60.0 the lantern's bloom pops in as it crosses the left edge (40 px edge strip 11 → 44 in one frame; see Reconciliation). |
| F5 C2 hall black | FIXED | 0.0006–0.0010 (Max 0.0007–0.0009); door, fanlight, rope and rail read at display gamma. |
| F6 C2 door light pop | FIXED | Smooth ×0.85–0.95 per frame; no ghost frame (Medium and Max). |
| F7 C2c torch into the wall | NOT FIXED (moved) | 8.53–8.93 lit, but a NEW 5-frame black at 10.77–10.93 from the 9.0 → 8.4 arms_breath_hold shift; the sparkle specks remain. |
| F8 head rolls by itself | FIXED | The roll is off screen; the head enters E4 face-up and still. |
| F9 pitch-black C4a / C4 | NOT FIXED | C4a 0.0000–0.0001 (the fixer's 0.0025 was the subtitle); C4 untouched. |
| F10 objective blink | FIXED | DOM log: no is-on before C2 / C2b / C4a, no swap while visible; the lead's C4 hide fix holds. Minor one-frame is-on on a step swap (code bug, ≈ invisible). |

### New since the hunt (not in F1–F10)
- N1 (user-visible) — C2c 6.6–6.77 whip: 6 black frames.
  - The torch is 0.3–0.7 m under the eye; after2 had it raised above the eye for the whip.
  - It appeared after 19:50: FLASH's arms.ts (22:17) or the regenerated arm clips. I cannot separate the two from here.
  - C2c 7.567–7.633 is also black now (hunt 0.003).
- N2 (user-visible) — C4c 3.4 → 3.433: Ada's pose pops in one frame (the ada_finale_take cue, fade 0.15).
  - Pre-existing; F2b's beam fix made it visible.
- N3 (user-visible) — C5 30.03–30.2: the torch pool blinks off for 6 frames (×0.19 / ×7.7).
  - Pre-existing (the hunt's own data has a ×0.33 dip there). The current exposure makes it obvious.
- N4 (minor) — C4c 0.033: ×1.74 on the hand-off frame (the eye's 0.134 → C4c's fixed 0.2), then a dip to 0.0037 and
  recovery by 0.3 s.
- N5 (minor) — C2c 0.1–0.3: the torch pool's brightness wobbles ×1.35 / ×0.71 (the hand spring?).
- N6 (minor) — objective.ts: the line shows for one frame on a step swap (above).

### Claims from STATUS-smooth-fix.md
- **Confirmed:**
  - F1 (no ×16).
  - F2a cutE cuts.
  - F2b.
  - F3 (no blown or black frame).
  - F4.
  - F5.
  - F6.
  - F8.
  - F10.
  - C2b 0 / 9.5 cuts (×1.11 / ×1.09).
  - C4c 3.3 shot lit.
  - The hand-back steps after C2b / C5 / C5b are the bot's torch-off.
  - 0 console errors.
- **Refuted:**
  - "F7 done": a new black stretch at 10.77–10.93 comes from #145's own cue shift.
  - "F9 C4a 0 → 0.0025–0.0036 (window, sill, edges)": that is the subtitle; the picture is 0.0001.
  - "C5 25.6 ×44 → a smooth fade-in": unchanged from the hunt.
  - "F2a: every listed cut is continuous": C2c 3.667 was not addressed.
- **Not checked:** real-time CSS fades and real-time stutter. Stepped capture cannot see either.

### Requests for the lead
1. #145 (fixer): F7 regression. Move arms_breath_hold back toward 9.0, or keep the pool in frame through 10.7–11.0
   (the dip is the clip's lowering beat). Re-check C2c 10.6–11.1.
2. #145: F9 C4a is still black. Measure with the subtitle band excluded (toplum.py), and raise C4A_FLASH_E or add a key,
   as request 4 in STATUS-smooth-fix offered.
3. #145: C2c 3.667 needs its own fix. It runs a fixed exposure, so it is the torch, not the meter. Also C5 25.6 if wanted.
4. FLASH: N1, the C2c 6.6 whip torch drop (rows `tl`: the hand stays 0.3–0.7 m under the eye; it was raised in
   after2). Possibly the unwired `arms.cutsceneHold`, or the regenerated arm clips.
5. FRAMES (c4c-remembers.ts): N2, Ada's ada_finale_take pose pop at 3.4. Longer fade or a matched start pose.
6. FRAMES (c5-face.ts): N3, the torch blink at 30.03–30.2.
7. FRAMES (c4c-remembers.ts): N4, start C4c from the eye's exposure with a ramp, like F1's C2 fix.
8. OBJECTIVE owner: N6, recompute `want` after the swap in objective.ts update().
9. Sequencer owner: the F1 residual (the fixer's request 8), a double step plus a full-rate zoom start on the first C2
   frame.

### Cleanup
- scratch/dist-reverify deleted after the analysis. Captures, det/ and strips/ are kept in scratch/reverify/ (488 MB; delete when the lead is done with them). Free disk at the end: 14.9 GB.

### Reconciliation (23:25): two re-verifier write-ups landed in this section
A second agent wrote parallel blocks here from the SAME captures (scratch/reverify/rv1, rv4max, rv2b, rv2a; the same
dist, built 22:23). The verdicts agree except on the three points below. My final calls, with the measurements behind
them:
- **F4: PARTLY (I now agree with the other write-up).**
  - The 57.07 wash cut is gone and the pan is smooth.
  - At 60.0 the lantern crosses the left frame edge and its bloom appears in one frame: the left 40 px strip goes
    11.0 → 43.7 → 54.4 → 58.2, then 41 as it moves in. The posts (16.1 → 17.2 → 16.6) and the ground (gradual) show
    no light pop.
  - So this is the screen-space bloom of a source entering the frame. It is the same signature as the hunt's 56.9 flare,
    moved: minor.
- **F2a: PARTLY, not FIXED.**
  - C2c 3.667 is ×6.9 on its cut frame. The other write-up calls it a physical glance off the torch pool. But the frames
    after it are brighter (0.0007 → 0.0048 → 0.0060) under a FIXED exposure, which is the late-torch pattern of F2b.
    The hunt listed it, and the evidence is not clear enough to waive it.
  - C5 25.6 is unchanged from the hunt.
- **R3 / my N3 (C5 30.03–30.2 torch blink) is PRE-EXISTING, not FLASH's new regression.**
  - The same 6-frame dip is in after1 (30.0–30.17: 0.0098 → 0.0012 → 0.0075), after2 (30.467–30.633: 0.0079 → 0.0009
    → 0.0056) and the hunt (30.133–30.3, ×0.33). It moves with the insert clock push.
  - The other write-up's "after2 was steady" looked at a window before after2's dip.
- **R2 / my F7 regression (C2c 10.73–11.03) is #145's cue shift.**
  - The hunt has the same lowering beat exactly 0.6 s later (11.33–11.53, a dip to 0.0054), which is the
    arms_breath_hold 9.0 → 8.4 move. The A/B in the other write-up's request 2 would confirm it.
- **Agreed:**
  - F1, F2b, F3, F5, F6, F8 and F10 are FIXED; F7 and F9 are NOT fixed.
  - The new C2c 6.6–6.77 black whip (R1 / N1) is post-after2 (FLASH arms or the arm assets).
  - The objective.ts one-frame is-on bug.
  - The fixer's C4a numbers were the subtitle panel.
- Only in my write-up:
  - N2: the C4c 3.4 pose pop. The other write-up calls the 3.4 FLICK 64 a glint sparkle, but strips/c4c_34_big.jpg shows
    her left arm and the held head jump, and her right arm appear, in one frame.
  - N4: the C4c ×1.74 hand-in.

### Reconciliation reply (re-verifier rv-1, 23:3x)
I re-checked every point in the 23:25 reconciliation against the data. All of them hold, and I corrected my blocks above
in place:
- R3 is pre-existing: after1 30.0–30.17, after2 30.467–30.633, hunt 30.13–30.3.
- R2 is #145's own arms_breath_hold 9.0 → 8.4 shift: the lowering beat is at clip time ≈ 2.4 s, at 11.4 in the hunt
  and 10.8 in rv1.
- The C4c 3.4 FLICK is a pose pop (strips/c4c_34_big.jpg).
- F2a is PARTLY.
- F4 is PARTLY: a bloom-only edge flare at 60.0.

The two write-ups now agree. FIXED: F1, F2b, F3, F5, F6, F8, F10. PARTLY: F2a, F4. NOT FIXED: F7, F9. User-visible new
items: the C2c 6.6–6.77 whip black (FLASH, after 19:50), the C2c 10.73–11.03 black (#145) and the C4c 3.4 pose pop.
The C5 30.03 torch blink was already there before #145.

### Re-verify round 2 (#145b): F7, F9, N1, N2, N3 (finished 03:4x 13 Oct; the verdict table is at the end of this block)
Independent re-check of the SMOOTH-FIX lane's round 2 (docs/STATUS-smooth-fix.md "ROUND 2"). I edited nothing in src/.
Work dir: scratch/reverify/r2/.
- Dist: scratch/dist-reverify, built 02:37 13 Oct from the working tree; verify-boot OK. Mtimes at build are in
  r2/tree-at-build.txt. Against the fixer's build-6 (01:30, their a2), the tree also has FLASH's arms.ts (02:03), c2c-up.ts
  (02:14, the fixer's revert of the tread-14 trial) and the 02:19 asset manifests. Every C2c verdict below is on the
  02:03 arms.ts. The C2c luma matches a2 to 3 digits, so that file did not change C2c.
- typecheck clean (r2/typecheck.log). npm test 325/325 (r2/test.log; the fixer reported 323, and other lanes added tests since).
- Captures (r2/run.sh, the same commands as round 1, serial on the FIFO lock, on MAINS power):
  - v1 = rv1: Medium, patient bot via objwrap, SCENE=C2,C2c,C2b, PRE=3, POST=2.
  - v2 = rv2b: Medium, SCENE=C4c,C5,C5b,C6,C6b,C7,CR.
  - v3 = rv2a: Medium, objwrap, SCENE=C0,C1,C3,C4,C4a.
  - v4 (r2/run4.sh): Medium, SCENE=C4, PRE=8, POST=3. This covers the hide lift's ease-in on the route and the hide exit.
  - n3refl: the fixer's direct-play probe (scratch/fix/r2/n3/c5refl.mjs) on this dist, as a second method for N3.
  - v1–v3 also log XROW (the torch target, door angles, torch lit, room).
- Limits: every run is Medium and stepped at 1/30 s, so real-time stutter cannot be judged.

#### v1 (Medium, C2 → C2c, C2b; 02:48–02:51; 0 console errors, 0 exceptions, 0 warnings; C2b PLAYED; det/v1-*)
- **F7 (C2c top of the stairs): FIXED for the black frames.**
  - 8.2–9.2: 0.119 → 0.171, monotonic (rv1 dipped to the bottom edge here).
  - 10.5–11.4: 0.19 → 0.17 at 11.0, then the authored turn to Ada's door takes it to 0.02 at 11.4, at ≤ ×0.75 per
    frame. rv1 had 0.0000 ×4 at 10.73–11.03.
  - At display gamma (r2/strips/f7_v1.jpg) the pool stays in the frame at 8.53, 8.7, 8.9, 10.73, 10.83 and 10.93.
  - Residual, already in the hunt and not part of the black-frame claim: dark stipple specks on the wallpaper at the
    pool's rim (10.83 / 10.93 left of the hot spot, and 7.633). The eye is < 0.5 m from the wall, so the pool fills the
    frame (AD).
- **N1 (C2c 6.6–6.77 stumble whip): NOT FIXED. The black frames became a white flash at the same moment.**
  - Luma: 6.567 0.043 → 6.600 **0.340 (×7.9 in one frame)** → 0.455 → 0.501 → 0.493 → 0.359 → 0.302 → 0.243 → 0.171.
  - At display gamma (r2/strips/n1_v1_stumble.jpg, tiles 3–7) the frame is a blown cream field: the stair riser lit
    point-blank for 5 frames (0.17 s), cut in from a dim green wall.
  - The exposure is fixed (ex 0.458 on every frame), so the step is light, not the meter. Rows: the torch is 0.24–0.44 m
    under the eye while the camera pitches +4.8° → −28° in two frames.
  - The numbers are identical to the fixer's a2 (0.3393 / 0.4542 / 0.5003), so it is deterministic and not changed by
    the 02:03 arms.ts.
  - The user's complaint is one-frame pops and flicker. A ×7.9 step to a white frame is that, with the polarity swapped.
  - 7.567–7.633 (the second half of N1): FIXED. 0.331 → 0.2375 → 0.044 → 0.046 (rv1 0.0000 ×3). That is the authored
    48°/frame whip from the balusters to the wall (FLICK 75, CUT-flagged); no black frame.
- C2c, other new events against rv1 (ddiff; checked in r2/strips/c2c_on_and_door_v1.jpg):
  - 0.2–0.27 FLICK 66 / POP 107 (rv1 20 / 48): the pool sweeps continuously over headless Ada's arm, torso and other
    arm during the authored pan (5–8°/frame). Not a defect.
  - 11.433: a one-frame dip of ×0.55 then ×2.02 (FLICK 91; rv1 had a 3-frame trough 0.012 → 0.007 → 0.007 here). The
    pool crosses the dark gap of Ada's boarded door while the eye turns at 8°/frame, and the strip shows the pool on the
    wall, then the gap, then the jamb, then the floor. Physical, as the fixer said. Minor.
  - 4.633 / 6.767: CUT-flagged authored whips.
- C2 (0–29 s) and C2b: ddiff against rv1 finds NO new FLICK, POP or one-frame luma step.
- The C2c hand-back is clean: 13.9 → gameplay is ×1.17, then the bot's own 95° turn (as in rv1). The gaze aim is
  released without a jump.
- OBJECTIVE line (DOM log, 1620 cutscene frames): opacity 0 on every C2 / C2c / C2b frame.

#### v2 (Medium, C4c, C5 → C5b, C6 → C6b → C7 → CR; 02:55–03:03; 0 console errors, 0 exceptions, 0 warnings; det/v2-*)
- **N2 (C4c 3.4 pose pop): FIXED.**
  - 3.4 → 3.433: POP 19 → 14, FLICK 0 → 4, luma 0.0887 → 0.0892 (rv2b: FLICK 64, POP 52–62, ×1.17).
  - In r2/strips/n2_v2.jpg (3.333–3.5) the 3.333 cut already shows the crossfaded pose: her left hand holds the head,
    and her right hand comes down a little per frame. There is no jump.
  - The pops of 29–53 from 3.5 to 3.73 are the reach itself, the same size as rv2b's 29–44 there.
  - The 2.55 held crossfade cannot be seen: the 2.933–3.3 shot is the bell crank (2.967 POP 36 is its wire swinging,
    same strip).
- **N3 (C5 torch blink): FIXED on the route.**
  - The run logged the dawn re-capture ('re-captured EXT (dawn sky, 6 frames)', console 520.3 s) and the night one
    (603.3 s).
  - Placing them: two anchors (the C6 23.8 mirror_view and C6b 6.0 footprints_path console lines) map frame-file times
    to console time. That puts the dawn re-capture at about C5 28.8, inside the C5 segment (± about 2.4 s; the anchors
    disagree by 4.7 s). The capture-time gaps cluster at C5 28.9–30.27, where rv2b's dip was.
  - C5 27.8–32.0 is flat: 0.0084–0.0112, every step ≤ 4 % per frame.
  - r2/dipscan.py looks for any run of 1–8 frames under ×0.5 of both neighbours, with no cut and no lightning. It finds
    NOTHING in v2's C4c, C5/C5b or C6 → CR. As a control, on rv2b's C5 it finds exactly the old 30.033–30.2 dip.
  - The night re-capture (≈ C6b 1.3) falls in C6b's authored black fade, where a dip could not be seen anyway.
  - A direct-play second check with the fixer's own probe (n3/c5refl.mjs) is queued on this dist; see below.
- **C6 → C6b → C7 → CR (never captured after #145b): clean.**
  - ddiff against rv2b (3203 frames, matched by clock): no new FLICK, POP or luma step. The only lines are two
    one-frame steps at C6b 11.03 on frames of 0.0000–0.0001.
  - The run reached CR and the title.
- C4c, C5 and C5b against rv2b: ddiff finds no new event except one 0.0001 → 0.0000 step at C5 19.03, in the black
  shadow play.
- C4c is not lifted by the C4 hide grade. At 4–10 s its luma is within ±12 % of rv2b's (e.g. 8.0: 0.101 vs 0.109).
- Pre-existing and unchanged (not on the #145b list):
  - C4c hand-in: ×0.75 then ×0.61. The eye at 0.319 drops to C4c's fixed 0.2. This is the round-1 N4 (minor), now as a dip.
  - C4c hand-back: the first gameplay frame is ×2.32 at the same exposure (rv2b ×2.39, hunt ×2.01). The hunt's minor item.

#### v3 (Medium, C0 → C1, C3, C4a, C4 hem; 03:15–03:21; 0 console errors, 0 exceptions, 0 warnings; det/v3-*)
Picture-only stats come from r2/dmed.py on the top 70 % of the frame (subtitles excluded):
- lin = mean linear luma
- med / p90 / p99 = display value 0–255
- ≥8 = the share of pixels at 8/255 or above
For calibration, the round-1 accepted F5 hall (rv1 C2 20.6–22.3) is med 1–9, p90 7–22, ≥8 9–64 %.
- **F9, C4a dolly 8–11: PARTLY. It reads as a silhouette shot, and the lift exposes a bake leak.**
  - Stats: lin 0.0016–0.0025 (rv2a 0.00003–0.00016, ×15–20), but med 0, p90 3–5, ≥8 only 6–9 %.
  - p99 61–73 is the window. The same numbers as the fixer's a2, which r2/dmed.py also measures as med 0, p90 4.
  - At display gamma (r2/strips/f9_v3_display.jpg, top row 8.5 / 9.5 / 10.5) these read: the window, the dress form
    against it, the sheeted chair's edge and the floor-to-wall line. Round 1 showed only the window slit and a sill
    line.
  - The floor and the walls are still black.
  - The brightest things in the room after the window are **warm orange DASHED LINES along the floor perimeter and
    the window jambs**: the U3 bake leak that the fixer saw. The ×30 lift makes them look like a lit LED strip.
  - The 8.033 start of the dolly is a cut (×2.75 on the cut frame). The 10.17 stroke is unclipped.
- **F9, C4 hide view (approach / hem / look / leave): readable; the same leak is visible.**
  - Stats: med 4–6, p90 10–13, ≥8 30–40 %, lin 0.0007–0.0009 (rv2a 7e-5–1.2e-4). That is level with the accepted F5.
  - At display (same strip, bottom row) the slats read, and so do Ada's dress through the gaps and the window edge.
  - But the slats' inner faces are lit warm red-brown, as if a lamp were inside the wardrobe, where they should be near
    silhouettes. Diagonal orange dashed leak lines show through the bottom slats.
- **NEW (user-visible, caused by the lift): the hide exit flashes.**
  - The hide exit is at bt 322.43: the camera leaves H_ADA_WARDROBE, 0.96 m and 167° in one frame.
  - Its first frame is luma 0.0014 → **0.0149 (×10.5)**, then 0.0046 → 0.0017 → 0.0015.
  - rv2a: 0.00025 → 0.00026 → 0.00016. Hunt: 0.0007 → 0.0007 → 0.0006.
  - r2/strips/c4_exit_v3.jpg against c4_exit_rv2a.jpg: the first exit frame shows the dust sheets lit bright amber,
    crossed by a web of glowing orange lines. The eye then drops 0.28 m in 2 frames and the sheets leave the frame.
  - After that the post, the ropes and the sheet edges keep glowing orange lines in an otherwise black room. In rv2a
    the same frames are black with faint lines.
  - The lift (×15, easing out at τ 1.2 s) is still on at the hide's exposure of 24 when the player steps out.
- C4a and C4 against rv2a (ddiff): every new event is a lightning pulse (LT, or the dark between pulses), now steeper
  because of the lift, or a subtitle panel ending (C4_approach 9.27). No pose or geometry pop.
- C0 / C1 / C3 (bindings.ts is shared): ddiff against rv2a finds only the known moving-car rain and wiper flicks (C0
  28.4, C1 1.5–45; round 1 has the same class) and the C3 lightning pulses. Nothing new from #145b.
- OBJECTIVE line (DOM log, 4714 cutscene frames including the whole C4 hem): opacity 0 on every frame.

#### N3 second method: the fixer's direct-play probe on this dist (n3/c5refl.mjs → r2/n3refl; 03:3x; 0 console errors)
- 6 cube-face frames at k = 158–163 (C5 31.30–31.47, sky 0.908–0.917). HDR centre mean 0.217–0.223, max 69–75.
- The neighbours: k = 150 0.198 / 50.4 and k = 170 0.219 / 59.4.
- The unfixed run (the fixer's refl-on) had 0.014–0.021 / max 0.56–0.70 on its 6 cube frames: ×0.07.
- Summary "dark frames 12, cube-face renders 6". 11 of the dark frames are C5's own black shot (k = 0–10), and k = 43 is
  the 27.47 fade-in from black (max 7.93, just under the probe's crude threshold of 8). No cube frame is dark.
- On this build the re-capture started at sky 0.91, not at the 0.6 crossing as in the fixer's run. It waits for its
  compile. The timing varies, so a route capture can only show "no dip anywhere". v2 shows exactly that.
- **N3: FIXED by both methods.**

#### v4 (Medium, SCENE=C4 PRE=8 POST=3, stock bot; 03:35–03:38; 0 console errors; det/v4-*): the hide lift on the route
- **Entry (bt 279.93):** the camera cut into H_ADA_WARDROBE, the eye snapping 3.7 → 24 (pre-existing).
  - The picture (top 70 %) is 1e-5 at entry and climbs to 3.4e-4 at +4.1 s and 5.1e-4 at the C4_approach start
    (+4.5 s).
  - Per frame: median ×1.030, max ×1.44 (one rain/flicker frame), never down. It reads as the eye adapting. Smooth;
    no pop.
- **Exit (bt 311.83): the flash reproduces exactly** (picture 0.00098 → 0.0212 ×21.6 → 0.0063 → 0.0021 → 0.0017;
  r2/strips/c4_exit_v4.jpg, top row). It is deterministic.
  - The first frame out shows the U4T dust sheets lit amber and a web of glowing orange lines (the lines they hang on,
    and the post).
- The lift then eases out over about 1.3 s. At +38 frames a lit post near the right edge leaves the frame (×0.57; the
  view moves 3 cm per frame): content, not a light pop.

#### Verdicts, round 2 (fresh dist 02:37; Medium; v1 + v2 + v3 + v4 + the N3 probe; every run 0 console errors, 0 exceptions, on mains)
| id | verdict | evidence |
|---|---|---|
| F7 C2c top of the stairs | FIXED (black frames) | 8.2–9.2 0.12 → 0.17 monotonic. 10.5–11.0 0.19 → 0.17, then the authored turn (≤ ×0.75 per frame), where rv1 had 0.0000 ×4. The pool is in frame (strips/f7_v1.jpg). Residual (minor, was in the hunt): dark stipple specks at the pool rim, and the eye < 0.5 m from the wallpaper. |
| N1 C2c stumble whip | NOT FIXED (black became white) | 6.567 → 6.6 is ×7.9 in one frame (0.043 → 0.340), then 0.455 / 0.501 / 0.493 / 0.359. Five frames of blown cream riser (strips/n1_v1_stumble.jpg) at a fixed exposure of 0.458. Identical to the fixer's a2. 7.567–7.633 is FIXED (no black; the authored whip). |
| N2 C4c 3.4 pose pop | FIXED | 3.4 → 3.433 POP 19 → 14, FLICK 4, luma ×1.006 (rv2b FLICK 64, POP 52–62). Continuous reach (strips/n2_v2.jpg). |
| N3 C5 torch blink | FIXED | Route: no 1–8-frame dip anywhere in C4c / C5 / C5b / C6 → CR (dipscan; the control finds rv2b's dip). The dawn re-capture was logged inside the C5 segment. Probe: the 6 cube-face frames have HDR mean 0.217–0.223, the same as their neighbours (unfixed: ×0.07). |
| F9 C4a dolly + C4 hide | PARTLY | The black-frame claim is fixed: the C4 hide reads (med 4–6, level with the accepted F5), and C4a reads as silhouettes (window, dress form, chair; med 0, p90 4). But the lifts (×30 / ×15) expose the U3 bake's warm orange DASHED leak lines, now the brightest things after the window (strips/f9_v3_display.jpg). The slats look lit from inside. The hide EXIT gets a new one-frame flash (×8.8 full frame, ×21.6 picture only; R2-1 below). The evidence is clear here, not a hedge: the hide view passes, the dolly's bulk is below the accepted F5 level, and the lift adds R2-1 and R2-2. |

New in round 2 (user-visible):
- **R2-1: the C4 hide exit flashes for one frame.**
  - The ×15 lift is still on when the player leaves Ada's wardrobe. The exit cut's first frame against the last hide frame:
    - v3: ×10.5 full-frame luma (0.00141 → 0.01489).
    - v4: ×8.8 full-frame (0.00167 → 0.01475) and ×21.6 picture only (top 70 %, 0.00098 → 0.0212).
    - It is then ×3.4 the next frame: lit amber dust sheets plus a web of glowing orange lines.
  - The one-frame look comes from two things stacked:
    - this lift;
    - the pre-existing 0.28 m eye drop over the 2 frames after the exit cut, which takes the sheets out of frame.
  - The camera move is the same in rv2a. The change against rv2a is the lift, and that is what makes the frame flash.
  - Deterministic: v3 and v4 agree. rv2a and the hunt are flat there (strips/c4_exit_v3.jpg vs c4_exit_rv2a.jpg,
    c4_exit_v4.jpg).
  - Owners: bindings.ts tickHideLm / c4-hem.ts (fix lane). Drop the lift on the exit cut, or meter the exit frame.
- **R2-2: the bake light-leak lines are now on screen** in U3 (C4a dolly, the hide view) and in U4T past the
  wardrobe's back: glowing orange dashed lines along the floor perimeter, the window jambs, the hanging lines and the
  posts. They were faint before #145 / #145b; the lifts made them obvious.
  - Owner: lane A (the U3 / U4T bakes: the L_LAMP_U2 leak the fixer named).
  - Until then the fix lane should weigh the lift against what it reveals.

Pre-existing and unchanged (not on the #145b list): C4c hand-in ×0.61 (the round-1 N4), C4c hand-back ×2.32 (the
hunt's minor), C5's black shadow play between strokes, the F2a C2c 3.667 glance and C5 25.6.

Claims in STATUS-smooth-fix.md ROUND 2:
- Confirmed:
  - F7 (both windows).
  - N1's black frames gone, with the white-out measured as they describe.
  - N2.
  - N3 (route and probe).
  - The C4 hide ease-in is smooth (v4).
  - The C4a dolly picture is 0.0013–0.0025 linear.
  - C2c 0–6.3 has no new artifact.
  - 0 console errors.
  - typecheck clean; npm test passes (325/325 now).
- Not confirmed:
  - "F9 FIXED" and "both views now read". The hide reads; C4a reads only as silhouettes (92 % of its pixels are under
    8/255), and the lift adds R2-1 and R2-2.
  - "N1 PARTLY". The user-visible defect remains as a white flash.
- Unverifiable here:
  - N1's cause being FLASH's stumble pose (I did not re-run their b1/b3 isolations).
  - "0.0005 → 0.003–0.03 lux" (not measurable from frames).
  - B12's re-capture (no B12 gameplay capture).

#### Requests for the lead (round 2)
1. N1, owner FLASH (arms_stumble_catch) or the fix lane. This is a ×7.9 step into a 5-frame white-out at C2c 6.6.
   - Options: hold the torch at the eye line through the stumble, lower its output for 0.2 s (a fumbled torch), or
     reframe the stumble so the riser is not point-blank.
   - Re-capture C2c 6.3–7.0 on the route.
2. R2-1, fix lane: no lift on the hide-exit frame (set GRADE.lm back to 1 on the exit cut, or keep the lift on the hide
   view only).
3. R2-2, lane A: fix the U3 / U4T leak lines (the L_LAMP_U2 leak, and the lines and posts past the wardrobe's back).
   Then re-judge C4a and the hide at display gamma.
4. F9 C4a, AD: the dolly is still median 0. Add a key (moon through the window onto the floor) if it must read more
   than as a silhouette.
5. Re-run: r2/run.sh (v1–v3) and r2/run4.sh (v4). Helpers: r2/dmed.py (picture-only display stats) and r2/dipscan.py
   (1–8-frame dips and bumps).

#### Cleanup
- scratch/dist-reverify was deleted at the end, leaving 15 GB free. Captures, det/ and strips/ are kept in
  scratch/reverify/r2/ (526 MB; delete them when the lead is done). Nothing was committed.
