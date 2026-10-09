> **LEAD APPROVAL 2026-10-09 18:20:** K1–K13 approved; built in two phases — see docs/ROADMAP.md "C2-ESCAPE design … lead rulings" (Phase 1 = the full sequence end to end + one runtime head-carry mechanism + #17 skin/gown + FP gloves; Phase 2 after the art-director verdict).

# C2-ESCAPE: the house escape, from the open front door to the first frame of B05

Sequence designer, 2026-10-09, **revision 2** (answers the critique of revision 1, see §9). This is the design to
build from. It **supersedes `docs/CUTSCENES-PLAN.md` §3 C2, DESIGN B03's C2 paragraph, DESIGN B04 (the interactive
chase), and the B05 opening** (up to the moment the player hides). Nothing here is built yet. Blender (lane A), runtime
(lane B) and story/audio/voice (lane C) build from it. The lead approves the contract items in §5.4.

The user's direction (2026-10-09, verbatim): *"i want you to keep the escape sequence inside the house really
photorealistic and ultra high graphics, the beheading of the woman visible clearly and should look really horrifying,
should feel scary the headless woman follows you up the stairs and when you look back after the top of the stairs she
is not there, cut scene ends here and then the game really begins, remember photorealistic".*

Lead rulings applied (docs/ROADMAP.md, 2026-10-09):
- (a) The beheading is shown clearly, not as shadow-play.
- (b) Ada is fully severed, and her HEADLESS body rises and pursues.
- (c) B04 becomes a cutscene with no catch: the run up the main stair, the look back from the top at an EMPTY stair,
  then the cut to gameplay at B05.
- (d) From then on she carries her head and lifts it to look at faces.
- (e) Staging protects realism (framing, one hard key, darkness, motion, focus, grain), while the beheading still
  reads unmistakably.

Conventions:
- PLAN space (x east, y north, z up). The ground floor is at z 0.6 and the upper floor at 4.1.
- Lens → vertical FOV on the 24 mm gate: 28 mm 46°, 35 mm 38°, 40 mm 33°, 50 mm 27°, 100 mm 13.7°.
- The letterbox is 2.39:1. The visible vertical FOV is cropped from the 16:10 horizontal FOV: 50 mm gives 42.0° h and
  18.3° visible v.
- "Eye" means the camera position. Times are seconds from the start of each cutscene. Durations are given in ms, never
  in frames.
- Every placement claim in §2–§3 was checked with `scratch/c2e/geom.py`, which does segment-vs-box and segment-vs-cylinder
  occlusion, bearings and N·L. Its output is quoted where it is used.

## What changed from revision 1 (one line each)

- **The strike is a rigid, correctly exposed frame.** There is no flinch, tilt, strobe or exposure event during the
  separation. The head drops out of the bottom of the frame and lands off-screen (sound only). The camera then tilts
  down to find it deliberately (§2.1 S3–S4).
- **There is no lightning in C2 and no `L_LTN_G2S`.** The lamp is the only key, and the storm is heard (thunder) but
  not seen in the parlor.
- **The lamp is restaged** to sit on the stool at the head end of the table, north-west of the neck. The flame is at
  z 1.35, out of every frame shot from the lean eye. It side-lights the cut (N·L 0.53) and back-lights Harlan (the lamp
  is behind him). Nothing occludes it from the head on the floor or from the risen body. The prop type `kerosene_lamp`
  **already exists** (`P_KEROSENE_LAMP` in U2).
- **The lamp's direct light is runtime and shadowed. Its indirect light is baked.** The one cube-shadow light of
  PERF-PLAN P0-2 moves from `L_CANDLE_TABLE` to `L_LAMP_PARLOR`, so nothing leaks through `WG_G1G2`. The parlor
  re-bake is a scheduled lane-A item, and art-director rounds held before it are marked provisional.
- **The one shadow light "roams" in C2c.** It is the fanlight lightning behind Ada for glance #1, and the U1 window
  stroke at the reveal. It returns to the lamp at B05. This is the same mechanism C5's silhouette uses today.
- **Glance #1 is held 630 ms as a hard silhouette** against a lightning patch on the hall floor, with the torch pointing
  away. **Glance #2's subject is her hand on the wet handrail**, and her feet are a dark shape outside the beam.
- **The empty stair stands unexplained.** Her prints stop at tread 11, the drip falls there, and no prints lead down.
  There are no sounds below. The torch, not lightning, lights the prints. The letterbox holds until control.
  The parlor sounds move to B05 +10–20 s as the start of her return.
- **C2 is a POV in a 50 mm prime.** The eye is a hard-cut 100 mm insert, and there are no visible zooms.
- **The strike is a two-handed blow.** The camera position D moved 10 cm into the doorway reveal. The whip turn is 154°
  to the right.
- **The severed head is a separate attached node** if the A0 spike confirms it (recommended). It is attached with the
  existing host `attach` cue and hangs as a runtime pendulum below the grip, with two-end-pinned hair.
- **New sections and items:**
  - Gameplay realism of the stump and the carried head (§4.6).
  - The `sfx` cue is scheduled on the audio clock (frame-locked crack).
  - Motion blur is enabled once per sequence, and the particles output velocity.
  - The blood gets a red forward-scatter term.
  - Particle terminations are precomputed.
  - The prerequisites are budgeted: #17 skin/gown, FP gloves #6, the bake, and the follow-on cutscene edits.
- **The total is 218.5 h (revision 1 said 138 h).** Runtime-F's U1 culling is a dependency outside this total.

---

## 0. What exists today (the baseline)

Frames looked at for this design:
- **`scratch/c2e/now-02-c2-9.9.jpg`**: the current C2 at 9.9 s, the eye moment, Medium, WebGPU, 960×600.
- **`scratch/c2e/now-05-stair-lookback.jpg`**: the current B04 run, then the look back from the stair top, torch on.
- Both were captured by `scratch/c2e/look.mjs` through `scripts/shot.mjs`. The folder also holds C2 at 3.5, 11.5 and
  17.0 s.
- **The capture ran on battery (83 %), so no performance claim is made from it** (CLAUDE.md). It had zero console
  errors and 0 exceptions.

Measured in the same run (the current interactive B04): a bot sprinting from `C2_END_EYE` reached the stair top
**≈ 2.5 s** after control. Ada was on tread 8, **2.7 m behind**. A real person needs ≈ 5–6 s for 16 risers, and C2c
gives the climb 6.3 s.

| What the frame shows | Cause | What this design does |
|---|---|---|
| The door rope is a 6 cm braided **pillar** down the middle of the frame (`now-02`) | `P_DOOR_ROPE` runs 0.5 m in front of `CAM.parlor_threshold` on its line of sight | The lean eye `D` (3.70, 1.26, 2.17) is 0.24 m south of `T`, inside the doorway reveal. From there the rope is outside the 50 mm frame (§2.0) |
| Harlan's lit flannel covers the neck. His trousers read as a bare pale leg | His root (4.85, 3.28) stands in front of the neck seen from `T`. He is front-lit by candles on the camera side | Harlan moves to (5.15, 3.95), 10.7° left of the neck from `D` (geom: no occlusion). The lamp is **behind** him (facing·lamp = −0.73), so he is a rim-lit silhouette |
| Ada reads as a white blob, and the room is one flat ochre | Two 0.95 cd candles near the camera side give flat, frontal light. The exposure cap is 2.8. Skin/gown #17 is not started | One hard side-key from the 12 cd lamp NW of the neck. Exposure is spot-metered on the work area. #17 is budgeted (§5) |
| `now-05`: the look back works as a composition, but the torch core blows out the near newel and balusters at 0.5 m, and Ada mid-flight is a pale grey blob | The torch core is aimed at the nearest object. Skin #17 | The reveal pitch is −50° (beam on treads 9–12 at 3.2 m, the newel out of the core). Nobody is on the stair to be a blob |

Kept from today: the threshold lock-up, the rope whip-pan to the front door, the slam and bolt, the "Go on, then."
beat, the three heartbeats, and the stutter-sampled chaser.

---

## 1. Beat outline and timings

The main stair `ST_MAIN` has **16 risers × 0.219 m, treads 0.28 m, 1.1 m wide**. It starts at (0.55, 3.60) and runs
north. The balustrade is on the east side, and the creaky steps are 5 and 12. (The brief's "14" is `ST_BACK`.) Tread
k's nosing is at y = 3.60 + 0.28k, z = 0.60 + 0.219k.

| # | Id | Mode | Starts | Length | Ends |
|---|---|---|---|---|---|
| 1 | B03 The First Room on the Right (walk-in) | **interactive** (unchanged) | end of B02 | player-paced, ~25–45 s | `T_B03_THRESHOLD` → C2 |
| 2 | **C2** The First Room on the Right (rewritten) | cutscene, full lock, skippable after the first view | threshold freeze | **29.0 s** | she is in the hall and the door shuts behind her → C2c, no cut |
| 3 | **C2c** Up | cutscene, full lock, skippable after the first view | chained from C2 (same camera) | **13.9 s** | the empty stair; control on the exact last camera |
| 4 | B05 Hold Your Breath (new start) | **interactive** | first frame of control at the stair top | player-paced | first hide → `hide_demo` (she carries her head) |

B04 survives only as the story beat that is active while C2c plays (no AI, no catch).

**B03** keeps its mechanics. The mirror, the portrait and the rope overhead are unchanged. It gets two additions:
1. At `T_B03_HALL` the first stroke is heard from the parlor (`cleaver_chop_partial`). From then on a slow `blood_drip`
   loop plays, about one drop every 0.7 s into a deepening pool.
2. Warm lamplight shows through the ajar parlor door: the lamp's **real shadowed direct light** through the door gap,
   plus the parlor's baked bounce seen through it. **This ships only with the bake** (§2.4). Until then the B03 glow is
   left out rather than faked.

**Handover chain:** `b03:threshold` → C2 (29.0 s) → C2c (13.9 s) → B05 control at the stair top.
- C2's last frame is C2c's first frame (chained like `C6 → C6b`).
- A skip from inside C2 jumps to C2c `t = 10.4` (the slow turn), so a skipping player still sees the empty stair.
- A skip inside C2c jumps to its end.
- First-play lock time is 42.9 s (DESIGN budgeted ≈ 54 s for the old C2 + chase).

**B05 opening** (detail in §4.5):
- Control returns at the stair top, looking down the flight, with the torch on.
- She is offstage, and the stair is empty. At +2.5 s a lightning flash shows the armoire ajar 4 m south.
- **At +10–20 s her return begins below:** the parlor key, the door, then wet feet and the knock of a carried head on a
  thigh.
- Nobody can be caught within 6 s of a cutscene, and the first hide is unfailable (§4.5).

---

## 2. Shot by shot

### 2.0 Staging constants (PLAN space; `level-layout.json` unless marked NEW)

| Name | Value | Note |
|---|---|---|
| Threshold eye `T` | (3.42, 1.50, 2.22), 50 mm | `CAM.parlor_threshold` (today) |
| Lean eye `D` | **(3.70, 1.26, 2.17)** NEW | Inside the doorway reveal (the wall faces are at x 3.60 / 3.75; the opening spans y 1.05–1.95), 0.21 m from the south jamb. Revision 1's (3.60, 1.22) sat on the wall face 0.17 m from the jamb. A9 checks the frustum against the ajar `D_PARLOR` leaf and casing (it swings into G2, hinged left) |
| Sawbuck table | x 5.30–5.90, y 2.20–4.40, top z 1.40 | `P_SAWBUCK` + `P_RUBBER_SHEET` |
| Neck (cut point) | (5.31, 3.25, 1.40). The cap normal points west, tilted up 20° | Ada face-down across the table's width, her head over the **west** edge |
| Harlan's strike root | **(5.15, 3.95)**, heading −1.25 rad (SSE) | From `D`: 10.7° left of the neck, no occlusion (geom) |
| `P_STOOL` (moved) | **(4.60, 4.25)**, seat ≈ z 1.05 | NEW position (was (5.30, 0.75)). `P_WHETSTONE` goes to the floor beside it (4.85, 4.50, 0.60) |
| `P_LAMP_PARLOR` | on the stool, base (4.60, 4.25, 1.05), **flame (4.60, 4.25, 1.35)** | NEW instance of the existing `kerosene_lamp` type. Flame 0.75 m above the floor |
| Table candle | (5.60, 2.30, 1.58), 0.95 cd | `L_CANDLE_TABLE`: from now on an ordinary unshadowed flicker light |
| Head landing | (5.12, 3.18, 0.70) (centre) | 1.36 m from the flame, unoccluded (geom) |
| Head rest after the boot nudge | (5.02, 3.05, 0.70), the cut end facing NW toward the lamp | §2.1 S4 |
| `P_CLEAT` | (3.80, 1.90, 2.20) | the rope's end |
| Front door fanlight | above `O_FRONT` (centre x 2.10, y −0.15), glazed, z ≈ 2.80–3.35 | `blender/house/doors.py` `fanlight()` |
| Stair-top eye `S` | (1.05, 8.25, 5.75), heading −1.571, **pitch −0.87 rad (−50°)** | NEW CP2 (§5.4). −50° frames the whole flight (the foot at −48°, tread 11 at −59°) |

Checked numbers (`scratch/c2e/geom.py`):

| Check | Result |
|---|---|
| `D`→neck bearing | 51.0° |
| `D`→lamp bearing | 73.2°, i.e. **22.2° left of the neck aim**. 50 mm half-hfov is 21.0°, so the flame is outside the frame by ≥ 1.2°. Every `D` shot keeps the aim yaw ≤ 51° |
| `D`→neck | 2.73 m |
| Cut-face N·L from the lamp | 0.53, ≈ 4.2 lx |
| Head on the floor | 6.5 lx at normal incidence, unoccluded by the table or Harlan |
| Risen body (6.10, 3.30, 2.05) | 3.3 lx at the stump, unoccluded by the table. **Occluded if Harlan stands at his strike root**, so in S10 he has moved to the dark south corner |
| `T` sees the risen body through the doorway | yes (z 1.60 and 2.05) |

### 2.1 C2 'The First Room on the Right' — 29.0 s, full lock

Global for C2:
- **Grammar:** POV with a **50 mm prime**. Small lens drifts are allowed only inside body motion, as in C1-OPENING
  (`car POV 24→28`, `PLAN POV 50→44`). The one exception is the **hard-cut insert** of the eye at 100 mm (S6), entered
  and left by cuts.
- Letterbox 2.39:1 in 0–1.2 s, held into C2c until control.
- The exposure meter is **spot-weighted on the work area** (§2.4).
- `storm_auto` is off. There is no lightning in C2: thunder is heard twice (§2.3).
- `L_LAMP_PARLOR` is the shadow-casting light.
- Motion blur is enabled **once at C2 start** (amount uniform 0 except the downswing and the whip, §5.2 B8).
- Heartbeat 96 → 150 bpm. The player's breath is held from 0.0 until the first of the three heartbeats.
- Clip origin `O = 0.6`: Harlan's and Ada's clip time = t − 0.6.

**S1 Freeze — 0.0–1.6** (`T`, 50 mm)
- Camera: the eye locks at `T`. The gameplay FOV eases to 50 mm inside the 0.9 s stop (the body halts and the head
  pushes forward 6 cm), handheld 0.6.
- In frame:
  - Harlan is a silhouette at the head of the table. The lamp behind him rims the burlap fibres and the wet apron
    edge.
  - The cleaver is raised over his shoulder in **both hands**.
  - Ada is bent face-down across the black rubber sheet, her hair hanging from the west edge into a dark pool.
  - His shadow and the raised cleaver's are thrown up the tally wall and across the ceiling, 3–4× life size. The
    flame is low, NW and behind him.
- Hidden: every face (hers is down under her hair; his is under the sack, which the lamp lights only from behind). The
  flame is off frame left.
- Sound: the drip into the pool (about one drop every 0.7 s, its pitch falling as the pool deepens), `apron_creak`,
  rain on the shutters, the house ticking. `drv_threshold` (breath catches) at 0.0.

**S2 He sees you — 1.6–5.4** (`T` → `D`, 50 mm)
- Camera: the player leans 0.24 m south past the rope over 1.6–3.0 (ease-in-out, 1 cm vertical bob) and aims at
  (5.25, 3.45, 1.75). Handheld 0.45 plus a 0.04° jolt on each heartbeat.
- Action:
  - 2.4 the sack turns from the work to the doorway (head yaw 70° over 0.9 s). As it turns away from the lamp, its
    front falls into darkness: the rim slides off and the eyeholes are black. He is not surprised. Held.
  - 4.4 the sack turns back to the neck.
  - 4.8 the wind-up: the cleaver rises 12 cm higher in both hands, and the apron creaks.
- In frame:
  - Harlan from the knees up, and the cleaver against the dark ceiling.
  - Her back, shoulders and hanging hair.
  - The first-stroke wedge at the nape is a dark wet seam, not yet anatomy.
  - **Cast-off:** one drop every 1.2 s gathers at the heel of the raised blade and falls past his sleeve (a
    `blood_drip` each).
  - Her legs are below the table edge.
- Sound: `sack_breath` 3.6, heartbeat 96.

**S3 THE STRIKE — 5.4–8.6** (`D`, 50 mm, **rigid from 7.30 to 8.60**)
- 5.4–7.30 the frame settles, handheld 0.3 → 0 (the player freezes). The neck sits at the lower third and the cleaver
  at the top edge.
- Focus is 2.73 m, with Harlan (2.95 m) just soft on Medium/Max (the existing cutscene DOF).
- In this frame the neck's 10.5 cm width spans **86 px at 1080p** and 64 px at 800p (50 mm, 2.73 m).
- **7.42–7.56 the two-handed downswing (140 ms).**
  - The edge speed at contact is ≈ 9 m/s (a 0.9 kg hog cleaver swung two-handed overhead: 8–10 m/s).
  - Max: motion blur amount 1.0 for these 140 ms. Medium: blur if B8's measurement allows (§5.2), otherwise the
    3-frame smear in the clip. Low: the smear.
- **7.56 contact.** The blade passes the C4–C5 disc and bites 12 mm into the table edge through the rubber sheet. The
  sound is scheduled on the audio clock to land on the contact frame (§2.3, M1).
- **7.58 pulse 1:** the first jet leaves the stump in frame, west and down, back-lit by the lamp 22° off the camera
  axis. It glows deep red by forward scatter (§3.4).
- **7.60 the head separates.** Its weight and the hair drag it off the edge. **It leaves the bottom of the frame by
  ≈ 7.72** (0.1 m of fall). The hair whips out after it.
- 7.62 her hands jerk up from below the far table edge and clench it (cadaveric spasm), and the shoulders hunch 3 cm.
- 7.60–8.60 **the stump stays in frame, side-lit by the lamp (≈ 4 lx), at 86 px.** Visible, in this order of
  legibility:
  - the white C5 vertebral rim (16 px wide at 1080p);
  - the trachea's cartilage ring glinting;
  - dark retracted muscle;
  - the carotid jet sources.
- **7.90 `head_drop` is heard off-screen,** with a ≤ 0.2° flinch (pitch, 150 ms, the only camera motion until 8.6).
- **8.40 pulse 2:** a second jet from the stump, in the same rigid frame. Two jets in one still frame read as a heart.
- There is no exposure event, no lightning and no tilt during the separation.
- Sound: §2.3 `cleaver_sever`. At 7.62 the player's `gasp` (a choked voiceless "hh—", caption "(a choked cry)").
  At 7.98 the `blood_patter` of pulse 1 landing on the boards 1.1 m west of the neck (§3.3).

**S4 The floor — 8.6–10.9** (`D`, 50 mm, a deliberate tilt)
- 8.6–9.2 the eye tilts down −16° (ease-in-out, 600 ms): looking for what fell. Handheld 0.35.
- In frame: the head face-down in its hair at the edge of the pool, lit by the lamp from the NW (6.5 lx). The pool
  spreads to it from under the table.
- 9.30 pulse 3 arcs in from the top of the frame and lands short of the head.
- **9.45 Harlan's left boot steps in and nudges the head with the toe. It rolls a quarter turn and rocks to rest by
  10.1** (a damped rock, 0.6 s period).
  - The roll brings the **ear and the jawline in profile** (hair still across the face, no eye, nose or mouth) and the
    **cut end** round toward the lamp.
  - For ≈ 1.1 s (9.6–10.7) the cut ring is lit at a grazing NW angle: the white vertebra, the trachea ring, dark
    muscle, and a skin edge with wet speculars moving with the flame flicker.
  - This is the one unmistakable anatomical read of the head (critique M3). It is lit, it is moving, and it lasts
    ≤ 1.1 s.
- 10.35 pulse 4: a weak gout down the table edge, out of the top of the frame. Then the heart stops (§3.3).
- 10.5 he crouches. His gloved left hand goes into the hair at the crown, twists and closes (`hair_wring`, water
  wrung out down his wrist).
- Focus 2.70 m on the head. Sound: patter, the drip, his knee joint, `hair_wring` 10.6, **thunder 9.8** (low, long,
  through the shutters).

**S5 The lift — 10.9–12.9** (`D`, 50 mm, the tilt follows the head up)
- He stands. **The head hangs from the crown grip, neck-down, face forward** (a head held by crown hair hangs
  cut-end-down).
- It rises to his face height: **the fist at z 2.62** (forearm raised, elbow at shoulder height), and the **head centre
  at z 2.30**, 0.30 m to the right of his sack.
- It turns slowly on the twisted hair (a pendulum, L ≈ 0.20 m, T ≈ 0.9 s, ζ 0.3). The hair falls over the face as a wet
  curtain.
- From the cut end, below: a 3–4 mm stream of blood and cistern water breaks into 6–7 mm drops after ≈ 8 cm
  (Plateau–Rayleigh) and patters on the boards.
- Hidden: the face (hair). The cut end faces down, away from the eye (z 2.17 against a head at 2.30: we see the jaw
  line under the hair, not the cut).
- 12.4 his wrist turns the head 150° so that the hair-veiled face is to the doorway.

**S6 The eye — 12.9–14.9** (**hard-cut insert: 100 mm from `D`**, handheld 0.25, focus 2.55 m)
- The frame is 0.61 m high at 2.55 m. The head fills its middle third, and the hair curtain fills most of that.
- 13.2 the swing parts a 2 cm gap over the left eye. 13.6 the eyelid peels open (250 ms):
  - **one clouded eye** with an opaque grey-white cornea (post-mortem clouding) and a faint darker ghost of the iris
    ring under it, so it is not a contact-lens white;
  - a single sharp specular of the lamp flame on the corneal bulge;
  - it finds the camera with 2–3° saccade corrections as the head turns.
- The visible skin is a 2 × 5 cm band, grey-blue and wet. The nose, mouth and other eye are behind the hair. The hair
  in the gap is in the focal plane: no reliance on foreground blur (critique m5).
- **14.9 cut back** to 50 mm.
- Sound: `score_stinger` 13.6, the drip, water running off the hair. Low: the insert is at 85 mm.

**S7 Both of them look at you — 14.9–17.9** (`D`, 50 mm, handheld 0.35)
- The sack and the held head side by side at the same height, 0.30 m apart: his black eyeholes, her eye. Both are
  lit only from behind (lamp), so the sack's front is dark.
- Three single heartbeats at 15.1, 15.9 and 16.7. The score drops out. The held breath releases on the first one
  (`breath_release`).
- **17.3 "Go on, then."** (Harlan, `b03_go_on`, cue `c2:rope_slip` at 17.3).
- Behind them the headless body's hands slide on the wet sheet. It is not dead.

**S8 He comes to the door — 17.9–20.0** (the eye retreats 0.25 m toward `T`, 50 → 44 mm drift inside the retreat)
- He walks to the doorway in three slow steps, the head swinging by the hair at his left thigh. The lamp is behind
  him: a black shape with a rim of lit burlap, and lit drops falling from the head.
- 19.3 his right arm crosses the frame at 0.55 m (dark flannel, out of focus) to `P_CLEAT`.
- From `T` the lamp is 33° off the doorway axis. At 18.6 the flame may show between his legs for ≤ 400 ms: this is
  the frame where the flame's look is judged (pair 4, §8.2, R9).
- Sound: boots, the head's drip moving with him, `sack_breath` at 0.6 m.

**S9 The rope — 20.0–21.9** (the whip-pan is kept): rope off the cleat 20.00 → `rope_pulleys` → the eye whips along
the cornice to the front door (`P_CLEAT → P_PULLEY_3 → P_PULLEY_1 → door`).
- 44 mm, handheld 1.1, motion blur amount 0.8 (all tiers that have it).
- Slam 21.05, bolt 21.50.

**S10 She gets up — 21.9–25.7** (`T`, 44 mm, handheld 0.9)
- Back through the doorway: Harlan has stepped into the dark south-west corner with the head, **out of the lamp→body
  line**.
- The **headless body** slides backward off the east side of the table (`ada_rise_headless`, 4.0 s): knees to the
  floor, hands on the edge, climbing up its own arms.
- Pulse 5 (22.5) overflows the stump and runs down the gown front. Pulse 6 (23.5) breaks a bubble at the trachea.
  24.7 the body turns toward the doorway.
- **Lighting:**
  - The lamp is a 66° side-key (seen from her, between the lamp and the camera). The terminator runs down her
    centre line: her north half is lit (≈ 3.5 lx), and her south half falls into darkness.
  - The stump's lip catches the lamp at a grazing angle, which gives a rim, not a lit disc.
  - The wet gown carries speculars on the shoulders.
  - Never more than half the gown is lit. Her legs are hidden by the table (`T` sees nothing of her below z ≈ 1.47).
  - She is at 3.0 m and 44 mm: ≤ 30 % of the frame height.
- Sound: `stump_breath` from 22.3 (§2.3), `ada_slap` (knees on boards) 22.2.

**S11 She comes — 25.7–29.0** (the eye backs out to `C2_END_EYE` (2.35, 2.70, 2.25), 44 → 40 mm drift inside the
retreat, handheld 1.2)
- The body walks out of the parlor at you: stutter sampling (10 fps poses, smooth root), hands groping for the jambs,
  wet palms squeaking on paint (26.9).
- **27.4 she is through, 0.4 m into the hall. 27.6 the door closes behind her** (from inside, without touching her).
  The parlor light vanishes from behind her: she becomes a shape at 1.6 m, lit only by the bounce of the player's
  low-held torch off the boards (≈ 3–5 lx on her lower gown, nothing above the waist).
- 28.3 the key turns. 28.5 she lurches one step. 29.0 → C2c (no cut).
- Sound: her wet bare feet (heel slap, 1.6 Hz), `stump_breath` close, `latch` 28.3 (rate 0.8).

### 2.2 C2c 'Up' — 13.9 s, full lock (no catch is possible; Ada is a scripted puppet, the brain is `scripted hidden`)

Global for C2c:
- POV only: the player's eye, with the FP arms visible (the left glove free, the right glove holding the torch, on:
  2000 cd peak / 30.9 lm, 2900 K, `LOOK.torch*`).
- The letterbox stays from C2 and **retracts only in the last 300 ms** (13.6–13.9).
- Exposure is the gameplay eye adaptation (brighten τ 6 s, darken 0.5 s). `storm_auto` is off. The two strokes are cued
  and both use the **roaming shadow light** (§2.4).
- Heartbeat 150 → 120 bpm. Audible `panting` at the step rate.
- Eye height while running is 1.55 m (a crouched sprint) and 1.65 m at the top.
- Ada: pose at 10 fps, root smooth (the existing stutter), 8 fps on the stair.
- The motion-blur variant from C2 stays live (amount per shot).

Pace (real numbers):
- The player crosses the hall's 1.95 m in 1.0 s (accelerating to 3.4 m/s), then climbs at 3.1 risers/s (a panicked
  adult takes 2.5–3.5). He slows to 1.5 risers/s while looking back, and loses 1.2 s in the stumble.
- Each riser gives the eye +0.219 m of rise and a 3–4 cm vertical oscillation at the step rate, with a 0.6° roll that
  alternates with the stride.
- Her pace: 2.2 m/s on the flat, 1.4–1.5 risers/s on the stair (she pulls herself up the handrail). She gains only
  unseen, during the stumble.

| t | Camera | In frame / hidden | Light | Sound |
|---|---|---|---|---|
| **0.0–0.65 Turn** | From `C2_END_EYE` facing her (heading −0.85 rad), a whip turn **right, 154°** (through south) to the stair foot (2.75 rad). Ease-in-out over 650 ms, peak 380°/s, 35 mm, blur amount 1.0 (§5.2 B8 for Medium; on Low the turn takes 850 ms) | Her dark shape for the first 120 ms. Then the arc crosses the **bolted front door** (the slam you just heard) and the dark hall wall. The newel and the first treads come in at the end | Torch only (the hall candle 0.95 cd behind) | First boot on boards, a sob-breath in |
| **0.65–1.65 Hall** | Run (2.35, 2.70) → (0.80, 3.40), eye 1.55, bob 3 cm at 2.6 Hz | The stair foot rushing up; the left glove reaching for the newel | Beam on the first treads (320 lx at 2.5 m) | `boot_run` ×3; behind, her heel slaps at 1.9 Hz; `stump_breath` 1.5 m behind |
| **1.65–2.1 Newel** | Swing round the newel: yaw +60° in 400 ms. The torch fist knocks the newel cap at 1.80 and the beam kicks 25° up the stairwell wall | The newel cap, a 200 ms flare of damask, the dark top of the flight | Beam kick | `newel_knock`, `creak` |
| **2.1–3.62 Risers 1–5** | Climb at 3.1 risers/s, pitch +12°, 35 mm, handheld 0.9 | The treads ahead; the left glove sliding on the west-wall dado | Beam up the treads | Hollow boots on treads (the closet void: 120 Hz); `creak_loud` on riser 5 at 3.45 |
| **3.62 Pulse 1 (the reason to look)** | — | Ahead, beyond the torch pool, the stairwell's upper walls and ceiling flare cold. **The baluster shadows are thrown up the wall like bars, from behind**, and the player's own shadow jumps up the flight | Roaming shadow light outside the **front-door fanlight** (§2.4), pulse 1 at 0.7 | The rain's hiss rises |
| **3.62–3.84 Turn back** | The head turns 150° back over the right shoulder in 220 ms (startle latency ≈ 150–200 ms). **The torch arm stays forward**: the beam keeps lighting the flight ahead, not her. 28 mm | — | Pulse 2 (0.5) at 3.74, mid-turn | — |
| **3.84–4.47 Glance #1: held 630 ms** | Eye at tread 5 (0.55, 5.00, 3.25), looking back and down at ≈ −30°, handheld 0.5 | **She is at the stair foot, rounding the newel, 2.1 m away:** the whole headless body, its right hand flat on the newel cap, the left groping at chest height, the gown dark-wet to the waist. **A hard silhouette** against the lightning patch on the hall floor behind her (y 2.1–3.9, geom). She stands in the light's edge, so the stump's upper lip and her shoulders carry a cold rim while her front, toward you, is black. At 4.15 she lurches 15 cm (one stutter pose). Her lower legs are behind the first treads | Pulse 3 (1.0) at 3.88; pulse 4 (0.8, continuing current, decay τ 180 ms) at 4.02, readable until ≈ 4.35. Peak patch illuminance ≈ 60–120 lx against ≤ 0.5 lx on her front: ≥ 7 EV of silhouette contrast. **No torch light on her** | `score_hit` at 3.88 (40 Hz, 80 ms + a 1-frame click); her wet palm squeaks on the newel; `stump_breath` |
| **4.47–4.69 Turn forward** | 220 ms | — | dark | A sob-breath |
| **4.69–6.46 Risers 6–12** | Climb at 3.1 risers/s, pitch +10°, handheld 1.0, breath ragged | The treads; ahead, the top of the flight and the U1 ceiling | Beam | Boots; behind, her feet on treads 1–4 (1.5 Hz, wet, heavier); `stump_breath` |
| **6.46–7.66 The stumble** | Riser 12 (the creaker): at 6.46 the toe catches the nosing (`arms_stumble_catch`). Pitch −28° in 150 ms, roll −6°, and the **eye drops to ≈ 0.85 m above tread 12 (z ≈ 4.08)**, hands and knees. At 6.62 both gloves slap tread 13 and the torch knocks the wood and rolls half a turn in the fist | The tread grain at ≥ 0.4 m from the lens; **the gloves in the beam's spill** (R13: gated on the FP-glove pass); DOF 0.45 m on Medium/Max | The beam swings wild across the balusters (their shadows sweep the wall like spokes), then down the flight | `creak_loud` 6.46, `body_fall_stairs` 6.62, `torch_knock`, `gasp` |
| **6.85–7.45 Glance #2: held 600 ms** (inside the stumble) | Eye low, aimed back down the flight between the right arm and the balusters, 35 mm. The torch arm was thrown back in the fall: **the beam axis is pitched −35°**, so its core lands on the riser face of tread 10, 0.7 m away | **Subject: her right hand on the wet handrail, 0.9 m away,** sliding up toward your glove: grey fingers spread, the nails, a film of water on the varnish ahead of them, the squeak. **Her feet are a dark wet shape at the bottom edge** (tread 9), outside the core. The frame ends at her knees. Hidden: everything above the knees | The hand sits **≥ 15° off the beam axis** (in the spill shelf, ≤ 10 % of the core); the feet sit ≥ 25° off (the corona). The eye clamps on the bright riser, so her skin renders 2–3 EV under the tread: wet speculars on a dark hand | The handrail squeak (stick–slip), her toenails on varnish, the hem's drip, `stump_breath` close |
| **7.66–9.0 Risers 13–16** | Scramble up on hands and feet, then up: 4 risers in 1.34 s, pitch +20°, handheld 1.4 | The top of the flight, the landing boards, the U1 north wall | Beam ahead | Boots, gloves; behind, her feet on treads 10 (8.4) and 11 (8.9) |
| **9.0–10.4 The top** | Onto the landing (0.55, 8.10) → (1.05, 8.40), eye 1.65, 35 mm. The run stops; breath heaving (pitch 0.7° at 0.5 Hz) | The north wall, the boarded door of Ada's room, the runner | Dark: the landing candle (0.95 cd at 3.7 m ≈ 0.07 lx) plus the torch | **Her steps stopped with his** (the last slap at 8.9). Rain, panting held (`breath_hold` at 9.6), heartbeat 120, then **one drop** below: a single drip on wood (10.0) |
| **10.4–12.4 The slow turn** | Turn right (south) 180° in 2.0 s, slow at first (0→60° in 0.8 s, dread), and pitch down to **−50°**. The torch lowers with the gaze | The gallery rail slides in from the left, then the stairwell opens below | — | — |
| **12.4–13.9 The empty stair** | Hold, 35 mm, handheld 0.4, no bob (breath held). At 12.9 an involuntary 4 cm lean forward over the rail | **Nobody.** The whole flight from the top to the hall floor. **The torch core on treads 9–12 (3.2 m, ≈ 195 lx):** wet prints darkening the wood up to tread 11, and none going down. A puddle on tread 11 where she stood, and a drop falling from tread 11's nosing onto tread 10 every 0.6 s, each with a small crown splash in the beam. The beaded water on the prints sparkles in the co-located beam | At 12.9 the cold stroke through the **U1 south window** at the far end of the gallery (the roaming shadow light, §2.4): the window, the gallery boards and the balusters flare at the far end of the frame, and the top treads 14–16 get a sliver. **Treads 9–11 stay torch-lit**, because the U1 slab shadows them correctly | Only the rain, the held breath, the heartbeat, and the drip on tread 10. **No sounds from below.** |
| **13.9 Handover** | Control at `S` = (1.05, 8.25, 5.75), heading −1.571, **pitch −0.87 rad**: the exact last camera, no snap. The letterbox retracted over 13.6–13.9 | — | Adaptation continues | Thunder from the 12.9 stroke at 15.8 (1 km: 2.9 s at 343 m/s, already in gameplay); `breath_release` at +2 s; heartbeat 120 → 90 over 8 s |

**The empty stair is not explained in C2c** (critique B4). Her prints climb to tread 11 and stop, the drip still falls
there, and nothing leads down. No footsteps, key, door or chair are heard until B05 (§4.5). The lore line in §6.1 gives
the rule the player can work out later: *the body goes back to wherever its head is, and no one sees it go.*

### 2.3 Sound design (all synthesized in `src/audio/synth`; positions in 3D via `spatial.ts`, rooms via `reverb.ts`)

Existing ids reused: `wet_chop`, `apron_creak`, `sack_breath`, `rope_pulleys`, `door_slam`, `bolt_drop`, `latch`,
`heartbeat`, `ada_drip`, `ada_slap`, `rocking_chair`, `panting`, `breath_hold`, `breath_release`, `gasp`,
`score_stinger`, footsteps. New ids are marked NEW (lane C).

**Audio–picture lock (critique M1).** Today `host.ts case 'sfx'` calls `audio.play()` on the first tick after the cue
time. That puts the crack 40–70 ms late at 45 fps (one tick, plus 10–40 ms output latency, plus 1–2 frames of render
latency). The fix:
- A new cue flag `sched: true`. The sequencer looks **150 ms ahead** and schedules the sound on the AudioContext clock:
  `when = ctx.currentTime + (cueT − sceneT) − ctx.outputLatency + frameLatency` (frameLatency = 1 × the measured frame
  time). This uses AudioBufferSourceNode `start(when)`.
- During C2 the cutscene clock is **slaved to `ctx.currentTime`**, so the picture cannot drift from the scheduled sound.
- QA: `c2e-hero.mjs` logs the audio start time and the presented frame time of contact. On Medium we require the
  difference to be ≤ 1 frame (≤ 22 ms at 45 fps).
- Used for `cleaver_sever`, `head_drop`, the pulses, the slam and `score_hit`.

**The severing chop `cleaver_sever` (NEW, built from the `wet_chop` layers), scheduled to land on contact at C2 7.56.**
It lasts 0.9 s in total.

| Layer | Time from contact | Synthesis | Level |
|---|---|---|---|
| Swish | −110 … −5 ms | band-passed noise sweeping 600 → 2400 Hz (blade at 9 m/s) | −18 dB |
| Skin/tissue entry | 0–25 ms | noise burst 1.5–4 kHz, 3 ms attack, 20 ms decay, with a 120 Hz thump | −6 dB |
| Bone (C4–C5 split) | 4–30 ms | 3 decaying modes 1.9 / 2.7 / 3.8 kHz (Q 12, τ 8–15 ms) + a 2 ms click: a dry crack | −3 dB |
| Table bite | 12–90 ms | 280 + 610 Hz plank modes, τ 60 ms; rubber slap (40 ms noise, LP 1.2 kHz) | −5 dB |
| Wet squelch | 20–220 ms | noise through a 300–900 Hz formant pair, 6 Hz AM | −9 dB |
| Tail | 0.2–0.9 s | parlor reverb (`G2.reverb`) | — |

The chop peaks at ≈ −8 dBFS on the master, with a 40 Hz, 80 ms `score_hit` under it.

| Id | When | Synthesis |
|---|---|---|
| `cleaver_chop_partial` (= `wet_chop`, drier) | B03 `T_B03_HALL` | existing |
| `blood_drip` NEW | B03 → C2; the cast-off in S2; tread 11 in C2c | A 6 ms impact tick plus the Minnaert "plip" of the bubble the drop entrains (f ≈ 3.26 m·Hz / a: 1.6 kHz for a 2 mm bubble, 15 ms decay). Its pitch falls 10 % as the pool deepens |
| `arterial_spurt` NEW | C2 pulses 1–6 (scheduled) | 0.18 s noise burst, LP 2.2 kHz, shaped by the pulse envelope (§3.3), then `blood_patter` at the computed landing time (§3.3, B4 termination) |
| `blood_patter` NEW | landings | 20–60 Poisson grains, each a 3–6 ms tick plus a 1.2–2.4 kHz plip, panned over the landing area |
| `head_drop` NEW | C2 7.90, off-screen (scheduled) | a 4.5 kg head on boards: 85 + 160 Hz board modes (τ 90 ms), a 20 ms wet slap, and a smaller knock 0.18 s later |
| `head_nudge` NEW | C2 9.45 | a boot toe on wet hair and bone (a soft knock), then the roll (two wet rocks, 0.6 s apart) |
| `hair_wring` NEW | C2 10.6; B05+ head lifts | a squelch (noise BP 500–1500 Hz, slow AM) + a light 0.4 s patter |
| `stump_breath` NEW | C2 22.3 → C2c; B05+ | Each exhale lasts 0.9 s: noise through a **570 Hz resonator** (a ~15 cm open tube: f = c/4L ≈ 572 Hz) with its 3rd partial at 1.7 kHz, plus bubble grains (40–90 /s, 0.8–2.5 kHz). The inhale is a thin hiss. 0.4 Hz |
| `bare_feet_wet` NEW (footstep set) | C2 S11, C2c, B05+ | A heel slap (noise LP 1.8 kHz, 25 ms), then 60 ms later a toe press with a squeak on varnish (2.1 → 1.6 kHz, 40 ms) and a squish. Treads add the 120 Hz closet resonance |
| `handrail_squeak` NEW | C2c 6.85–7.45 | stick–slip: a 9–14 Hz train of 1.2 kHz grains |
| `newel_knock`, `torch_knock` NEW | C2c 1.80, 6.62 | 1.1 / 2.6 kHz metal modes (τ 40 ms) + a 400 Hz wood thock |
| `body_fall_stairs` NEW | C2c 6.62 | two 150 Hz thuds + a leather slap, hollow resonance |
| `score_hit` NEW | C2 7.56, C2c 3.88 | 40 Hz, 80 ms + a 1-frame click |
| `ada_head_lift`, `ada_head_knock` NEW | gameplay (§6.2) | the tell: a creak of the hair rope + 0.4 s of water pouring out + a jaw click. The knock: the carried head against her thigh at a run |
| Thunder (existing storm synth) | C2 9.8; after C2c, at gameplay +1.9 s | distant, long, low |

The player's breath (sfx, not voice):
- Held 0–15.1 in C2 and released on the first heartbeat.
- `gasp` at C2 7.62.
- `panting` through C2c at the step rate. `breath_hold` at C2c 9.6, released at gameplay +2 s.
- Heartbeat: 96 → the three single beats (15.1 / 15.9 / 16.7) → 150 at the slam → 120 at the top → 90 by B05 +8 s.

Voice: **no new lines.**
- `drv_threshold` (C2 0.0).
- `b03_go_on` "Go on, then." (`c2:rope_slip`, moved to C2 17.3).
- `b04_door_rattle` is retired.
- `b05_dont_breathe` stays on `b05:hide_enter`.

### 2.4 Light and exposure (real numbers; runtime cd = Blender W / 4π)

| Light | Where | Value | Role |
|---|---|---|---|
| `L_LAMP_PARLOR` NEW + `P_LAMP_PARLOR` (existing type `kerosene_lamp`) | flame (4.60, 4.25, 1.35) on the moved stool | **flat-wick kerosene lamp 12 cd** (CLAUDE.md 10–15 cd), 1950 K. Flame 2.5 × 1.2 cm, so at 1.2 m the penumbra is 1.2°: hard shadows. Point light, radius 0.012, **Blender 151 W**. Flicker 2 % at 6–9 Hz (a flat wick is steadier than a candle). **Direct = runtime, shadowed; indirect = baked** (below) | The one key. The cut face gets ≈ 4 lx (N·L 0.53), the head on the floor 6.5 lx, the risen body 3.3–3.7 lx (side). Harlan is back-lit (the sack's front is dark). His shadow and the raised cleaver's go up the tally wall and across the ceiling |
| `L_CANDLE_TABLE` | (5.60, 2.30, 1.58) | 0.95 cd, 1850 K (12 W), **no longer the shadow light** | warm fill on the camera side: ≈ 1 lx at 1 m. The key:fill ratio is about 4–7 : 1 |
| `L_CANDLE_MANTEL`, `L_CANDLE_SILL` | as in the layout | 0.8 cd | two small flames deep in the room |
| **Roaming shadow light** (the session's one cube-shadow point light, PERF-PLAN P0-2) | C2: **at the lamp flame**. C2c 3.62–4.40: **outside the front-door fanlight**, (1.60, −1.50, 4.40). C2c 12.9–13.3: **outside the U1 south window**, (2.10, −1.40, 5.60). From B05: back at the lamp | At the fanlight and the window it is the stroke: **≈ 1100 cd peak**, 8000 K. That is a lightning-lit cloud seen through grimy glass at ≈ 2000 cd/m² over the fanlight's 0.55 m², which gives 40–120 lx on the hall-floor patch. Pulses are 25–40 ms rise-and-decay, and the last is a continuing-current tail with τ 180 ms. The map is redrawn at each pulse onset (4 cube renders per stroke). `distance` 9 m | **Real shadows through real openings.** Level meshes, doors and props are casters already (`level.ts`): the fanlight's muntins and her silhouette cast. On the 512² cube the texel is ≈ 1.8 cm at 4.5 m, so edges come out soft, as they should from a sky source |
| Lamp during C2c | — | The runtime direct light is **off** (the parlor door is shut and locked; only its 1–2 cm floor gap would pass light). The baked indirect stays in the parlor only | — |
| Torch | the player's | 2000 cd peak, 30.9 lm, 2900 K, core HWHM 2.9° + spill shelf | C2c's moving key; the light on the prints |
| `L_LTN_U1S` spot (unshadowed, existing) | — | **Not fired in C2c.** Rays to treads 9–11 would cross the solid U1 slab (critique M10), and an unshadowed spot leaks through it | — |

**Bake split (critique B5).**
- `L_LAMP_PARLOR` gets the layout mode `bake_flicker` with a new field **`bakePass: 'indirect'`**: Blender bakes only
  its indirect light into the **parlor atlas** (LM_PARLOR). The Cycles diffuse bake runs twice: (a) all the other lights
  with the normal passes, and (b) the lamp alone with `use_pass_direct = False`, `use_pass_indirect = True`. The two
  are summed before OIDN.
- The hall's atlas gets nothing from the lamp: its light reaches the hall only as the runtime direct light through the
  door gap, shadowed by the walls and the door leaf.
- The result: the bounce fill is real (no black unfilled shadows), the shadows are real (characters, door, walls), and
  nothing leaks through `WG_G1G2`.
- Until the bake lands, the lamp runs as layout mode `runtime` (shadowed direct only, logged as interim in
  CONTRACT-CHANGES). **Every art-director round before the bake is marked provisional,** and B03's door glow ships only
  with the bake.
- Shadow-map update policy:
  - C2: every frame (`autoUpdate`).
  - B03 (Harlan chopping): 10 Hz.
  - Gameplay with the lamp: on door changes and at beat start only.
  - C5: the existing silhouette relocation, unchanged in look, now moving this light (§6.5).

**Exposure (the eye):**
- C2: the meter is spot-weighted (60 %) on a screen ellipse around the work area (the neck, then the floor). The lit
  side of the cut and the head sit at ≈ +0.7 EV over middle grey. Key 0.12, clamp [0.7, 8]. This replaces the blanket
  cap `max: 2.8`, which was set for the old candle-only room.
- The flame is never in frame from `D`. From `T` (S8) it is a small clipped core with halation only around the core
  (radius ≤ 6 px at 1080p). There is no sprite.
- No exposure event during the strike.
- C2c: gameplay adaptation.
  - The meter sits on the torch-lit treads, which is why the hall behind is black until the stroke lights the floor
    patch to near middle grey. Her front, at ≤ 0.5 lx, stays black.
  - The bright riser in glance #2 clamps the eye 1.5 EV in 0.5 s, so the following climb feels black.
  - At the reveal the stroke overexposes the far window by ≈ 1.5 EV and settles. The torch-lit treads hold.
- Grain: ISO 1600 look throughout (the rooms are ≈ 1–7 lx). Chromatic aberration ≤ 1 px at the frame edge. A natural
  vignette.

---

## 3. THE BEHEADING

### 3.1 Blocking (C2 S1–S10)

**Ada** stays where she is today: root (5.93, 3.30), face-down across the table's width on the rubber sheet.
- Her hips are at the east edge, her arms hang down the east side (out of sight below the table edge until 7.62), and
  her head and neck are over the **west** edge, with the hair hanging 0.8 m to the floor.
- The first stroke (heard in B03) has opened the back of the neck to half depth: a 5–6 cm wedge at the nape.

**Harlan** stands at (5.15, 3.95), facing SSE, feet 0.45 m apart.
- The strike is a **two-handed overhead blow** (critique m4). His left hand held her shoulders down until the wind-up
  at 4.8, then joins the handle, so no forearm crosses the swing plane.
- The swing plane runs 20° off north–south, which gives an oblique cut, as a real overhead chop is.
- From `D` he is 10.7° left of the neck and 0.22 m beyond it. He frames the neck without covering it (geom).

**The lamp** is on the stool at (4.60, 4.25), north-west of the neck and **behind** Harlan as seen from the camera.
- It side-lights the cut and the head on the floor.
- It back-lights him (facing·lamp −0.73).
- It is out of every frame shot from `D`.

**The camera** at `D` sees:
- the neck at 2.73 m, from slightly above (elevation −15°);
- the stump cap at ≈ 50° to its normal;
- Harlan from the knees up.

The rope is out of frame.

Why it reads at play resolution (50 mm, 2.73 m): the neck's 10.5 cm spans **86 px at 1080p, 64 px at 800p and
48 px at 600p**. Every piece that says "a neck cut through" is ≥ 1.5 cm:
- the vertebral body (1.7 cm = 14 px at 1080p);
- the trachea ring (1.8 cm = 15 px);
- the two sternocleidomastoid ovals.

The cap is therefore a simple ring model with about 6 colour regions, a wet specular and relief. **The horror comes
from timing and consequence:** the stroke, the crack on the contact frame, the head gone from the frame, two jets
pulsing in a still frame, the hands clenching, then the head in the light, lifted, and its eye opening.

### 3.2 The cut faces and the anatomy (C4–C5, adult female) — unchanged from revision 1 except the boundary rules

| Structure | Size | Position in the cut | Look (linear albedo / roughness) |
|---|---|---|---|
| Skin | 1.5–2 mm; neck 10.5 × 11 cm | outer ring | grey-blue outer skin (atlas); dermis edge (0.45, 0.38, 0.36) / 0.3 |
| Subcutaneous fat | 2–5 mm | inside the skin | waxy pale yellow (0.55, 0.50, 0.38) / 0.35 |
| Sternocleidomastoids | 2.5 × 1.2 cm ovals | front-left, front-right | dark, water-desaturated muscle (0.12, 0.04, 0.04) / 0.25 |
| Trachea | 1.8 cm OD, 2 mm C-ring | front centre, 2 mm proud | cartilage (0.60, 0.58, 0.52) / 0.3; the lumen dark and bubbling |
| Oesophagus | 2 × 0.8 cm | behind the trachea | (0.30, 0.16, 0.15) / 0.3 |
| Carotids | 6–7 mm, 1 mm white wall | beside the trachea, recessed 5–8 mm | wall (0.55, 0.48, 0.45); the jet sources |
| Jugulars | 10–12 mm, collapsed | lateral | dark slits |
| C5 vertebral body | 1.7 × 1.5 cm | centre-back, 3 mm proud | cortical rim (0.62, 0.58, 0.50) / 0.35; marrow speckle (0.35, 0.18, 0.15) |
| Spinal cord in its canal | cord 1.0 × 0.8 cm | behind the vertebra | grey-white in a dark dural ring |
| Posterior muscle | 4–5 cm | the back half | rougher; a 2 mm step where the two strokes met |
| Blood film | 0.1–0.5 mm | **over ≥ 60 % of the face** | §3.4 |

Relief is 3–8 mm of real geometry plus a baked normal map: muscle retracted 2–6 mm, arteries 5–8 mm, the vertebra
3 mm proud, the trachea 2 mm proud. **Anti-diagram rules (R2):**
- No boundary may be a clean ellipse: every structure's outline gets ±1.5 mm noise with ragged fibre ends.
- The colour regions bleed into each other under the blood film.
- The film is thicker in the lower half (gravity).

Both faces mirror each other with a 2 mm offset.

### 3.3 The arterial pulses (heart-driven) — ranges recomputed with h = 0.80 m (critique m1)

The heart keeps beating after the cut for four beats, then stops. It **starts again when the body rises** (supernatural:
lead request 4).
- Systolic 120 mmHg = 16 kPa gives an ideal exit speed √(2P/ρ) = 5.5 m/s. With losses at the cut vessels, 2–3 m/s is
  realistic.
- The neck is at z 1.40, so the fall is **h = 0.80 m**: t = √(2h/g) = 0.404 s, and the horizontal range is 0.404·v.
- The jets leave **west**, along the neck's axis, 0–15° below horizontal. The table below shows a horizontal exit; B4
  computes the exact path, including the angle and drag.
- Jet diameter is 4–5 mm. It breaks into 7–9 mm drops after ≈ 9 diameters (Plateau–Rayleigh), with a mist of 0.5–2 mm
  satellites.

| Pulse | t (C2) | Rate | Exit speed | Duration | Volume | Lands (from the neck at x 5.31, along y ≈ 3.25) |
|---|---|---|---|---|---|---|
| 1 | 7.58 | (contact) | 2.8 m/s | 0.22 s | 25 mL | **1.13 m west (x ≈ 4.18), 2.0 m from the player's boots**, at 7.98 |
| 2 | 8.40 | 1.22 Hz | 2.3 m/s | 0.20 s | 20 mL | 0.93 m (x ≈ 4.38) |
| 3 | 9.30 | 1.11 Hz | 1.7 m/s | 0.18 s | 15 mL | 0.69 m (x ≈ 4.62): over the head, 0.5 m beyond it |
| 4 | 10.35 | 0.95 Hz | 1.0 m/s | 0.16 s | 10 mL | 0.40 m: a gout down the table edge |
| — | 10.4–22.5 | stopped | — | — | seep 1 mL/s | down the sheet and off the corner, one drop every 0.5 s |
| 5 | 22.5 | (the rise) | 0.4 m/s | 0.25 s | 8 mL | overflows the stump and runs down the gown front |
| 6 | 23.5 | 1.0 Hz | 0.2 m/s | 0.25 s | 5 mL | a bubble breaks at the trachea |
| then | → | 0.45 Hz | — | — | 1 mL/beat | a slow upwelling that never stops |

Harlan's boots are 0.7 m north of the jets' path, so they collect spatter, not jets.
- Each pulse ramps up in 40 ms, holds, and falls off in 80 ms. The jet wobbles ±4° at 9 Hz (wall flutter).
- The total loss in C2 is ≈ 0.2 L.
- **The chop's impact spatter** (medium velocity): 250 / 120 / 40 drops (Max / Medium / Low), log-normal sizes 1–4 mm
  (median 1.8), 2–6 m/s, in a 70° cone down-west.
- The stain shapes follow the impact angle α (width/length = sin α).
- The **cast-off** in S2 is one drop every 1.2 s from the heel of the raised blade.

### 3.4 Blood as a material (physical numbers)

| Property | Value | Note |
|---|---|---|
| Density, viscosity | 1060 kg/m³; 3 mPa·s (cold, water-thinned) | |
| Surface tension | 0.055 N/m, so the capillary length is 2.3 mm | pools settle 2.5–3 mm thick: **200 mL ≈ 0.07 m² (r ≈ 15 cm)** |
| IOR / F0 | 1.35 / **0.022** | |
| Albedo, thick layer (linear) | jets (0.18, 0.012, 0.010); pools (0.11, 0.009, 0.008) | |
| **Absorption μa (whole blood, Hb ≈ 150 g/L; Prahl's molar extinction tables)** | 650–700 nm: oxygenated 0.6–0.7 /mm, deoxygenated 3.8–6.9 /mm; 550 nm ≈ 110 /mm; 450 nm ≈ 130 /mm | blood transmits only red, and only through ≲ 1–2 mm |
| **Forward scatter (critique M4)** | Henyey–Greenstein **g = 0.95** (blood scatters strongly forward: g 0.97–0.99 for single cells, lower effective through a jet) | |
| Roughness | fresh 0.03–0.08; clotting at the edges 0.25 after 3–10 min; dried 0.55 | |
| Dried | (0.06, 0.016, 0.012), with a darker 2 mm "coffee ring" rim | from B11/C5 (≥ 10 min of game time) |
| On varnished boards | beads with a 2.5 mm rim; wicks into the board seams | |
| On rubber | contact angle ≈ 95°: beads, rolls into the folds, runs off the corner | |
| On cotton (her gown) | wicks at ≈ 2 cm/s, slowing with √t; wet cotton goes darker and translucent | |
| Drops | pinch off at 4 mm; from 0.8 m they land at 3.9 m/s and leave a crown + 6–10 satellites | |

**The back-lit term (one light, cheap).** In the particle material:

`L_t = E_lamp · T(d) · p_HG(g, cos θ) · (1 − F)`

- `E_lamp` is the lamp's irradiance at the particle, from its position uniform.
- `T(d) = exp(−μa·d)` per channel, with **μa = (1.0, 100, 120) /mm** for the arterial jets (a mix toward
  oxygenated) and **(3.0, 110, 130) /mm** for the seep and the pools.
- `d` is the chord through the capsule at the pixel: thin at the edges, the full diameter at the core.
- θ is the angle between the view ray and the lamp-to-particle direction.

The result:
- A back-lit 4 mm jet keeps a **near-black core with a glowing deep-red rim** (T_R(0.5 mm) = 0.61).
- The ≤ 1 mm mist and the satellites glow red as a whole (T_R = 0.37).
- The specular glint sits on top.

This is how real back-lit blood looks, and it fixes "black threads". The term costs one exp per channel and no
sampler.

### 3.5 What happens, frame by frame, around the cut (C2 7.30–10.9)

| t | Ada | Harlan | Blood | Camera / light | Sound |
|---|---|---|---|---|---|
| 7.30 | still | top of the wind-up, both hands | a cast-off drop leaves the heel | **rigid** from here | the apron creaks; silence |
| 7.42–7.56 | still | downswing, 140 ms | — | blur amount 1.0 (Max; Medium per B8); the smear on Low | the swish (scheduled) |
| 7.56 | the blade through C4–C5 | contact; the blade bites 12 mm into the edge | spatter cone | — | crack + thock + squelch, on the contact frame |
| 7.58 | — | holds the cleaver in the wood | **pulse 1**, back-lit, its red rim glowing | blur amount back to 0 | `arterial_spurt` |
| 7.60 | the head separates and drops | — | the head end streams | — | — |
| 7.62 | the hands come up and clench the far edge | — | — | — | `gasp` |
| 7.72 | **the head is out of the bottom of the frame**; the hair whips out after it | lets go of the cleaver | the stump with its jet sources, in frame and lit | — | — |
| 7.90 | (off-screen) the head lands | — | — | ≤ 0.2° flinch, 150 ms | `head_drop` (scheduled) |
| 7.98 | — | — | pulse 1 lands 1.13 m west | — | `blood_patter` |
| 8.40 | the shoulders slump | — | **pulse 2** from the stump, in the same frame | — | spurt + patter |
| 8.60–9.20 | the hands slide to the sheet | his left hand comes off the handle | — | the deliberate tilt down | the drip from the sheet corner starts |
| 9.45 | — | his boot nudges the head | — | — | `head_nudge` |
| 9.6–10.7 | **the head's ear and jaw profile and the cut ring, lit, rocking to rest** | — | pulse 3 lands beyond it (9.70) | — | the two wet rocks |
| 10.35 | — | — | pulse 4, the last | — | — |

### 3.6 The head, the eye and the headless body

**The head is a separate node** (recommended; the A0 spike decides, critique M6).
- `ada_head` is a glTF node: the head mesh with its cut cap, the scalp, the face veil and its own 33-bone mini
  skeleton (`head` + 8 hair groups × 4).
- It is split from Ada's mesh at C2 7.60. Before that it is driven to her `neck_02`, so it looks like one body.
- It is attached with the existing host cue **`attach(char, prop, bone)`**: Harlan `prop_l` (C2), Ada `prop_r`
  (carried), or world-placed (the floor, the slats, the dress form, her vigil).
- **How it hangs:** the grip socket holds the gripped hair. The head's transform is a runtime **pendulum** (L 0.20 m,
  ζ 0.3), clamped to the grip's velocity.
- **The gripped chains** (the two crown groups) are solved as a **rope pinned at both ends** (the scalp root follows
  the pendulum head, the distal end is pinned to the fist socket). The other six groups hang free from the scalp under
  gravity and drip. This fixes the hair sagging off the glove.
- Benefits:
  - No `head` keys in any later clip: the clips only need a gripping right hand.
  - Clip blends cannot pop the head between hands.
  - `ada.ts` stops driving `neck_02`/`head` after C2 (the neck spring is off).
- A head held by crown hair hangs **neck-down with the face forward**. When it is carried at the hip, the face is toward
  her thigh.

**The eye** (S6): the morph `eyelid_l_open` (a 2.5 mm peel in 250 ms) and a cornea shell `ada_cornea_l` (roughness
0.02, F0 0.025, IOR 1.376) over a milky grey-white eye (0.55, 0.57, 0.58), with a darker ghost of the iris ring (0.45),
so it does not read as a Halloween contact lens. Saccade corrections of 2–3° every 0.6–1.0 s.

**The body**:
- After the cut: the clench (7.62), the slump (8.4–9.2), stillness with finger twitches every 1.5–2.5 s.
- Then `ada_rise_headless` (4.0 s): it stands with the shoulders hunched forward 4 cm and the collar frill raised
  (§4.6), so the cap tilts 25–35° toward what she hears.
- Arms forward, elbows bent 30°, fingers spread. The existing stutter gait, with the shoulders leading, 0.55 m steps at
  1.6 Hz.

### 3.7 How each element is produced, per tier

| Element | Built in | Low | Medium | Max |
|---|---|---|---|---|
| Ada split (body + stump cap; `ada_head` + head cap) | Blender `ada.py`, `mesher.py` (A1); **averaged custom normals across the duplicated seam** so no shading line shows before C2 (F1/F2, B01–B03) (critique m6) | caps 64 tris, cap tiles 128 px | caps 600 tris, 256 px | 600 tris, 512 px |
| Cast-off, spatter, jets, head stream | `src/world/blood-fx.ts` (B4): instanced capsules, **analytic ballistic with linear drag in TSL, the same closed form on the CPU**. Each particle's **end is precomputed at load** (all of C2 is seeded and deterministic) by stepping at 240 Hz against stage proxies: the floor plane, the table box, the sheet plane, Harlan's apron plane and boot capsules at his pose at that time, Ada's torso capsule, the lamp chimney. That gives the kill time, the hit point and the receiver, so a **decal spawns from the same record**. The shader outputs **velocity** (the previous position from the same formula, t − dt) for motion blur (critique M2) | 100 particles, no stretch, no mist | 620 + the back-lit term | 1450, blurred |
| Stains | `decals.ts` (B5): a procedural stain atlas on a canvas at load (512², 16 cells), one instanced decal batch per receiver class (≤ 3 draws) | 12 | 40 | 80 |
| Pools, rivulets, the sheet-corner drip | decals with growth/meniscus/clotting uniforms driven by game time since `c2_strike_time` | 2 pools, 3 states | 4 pools, continuous | same |
| Sheet reconciliation | the baked spatter on `P_RUBBER_SHEET` (`blender/props/textiles.py`) **must show only older, dried nights plus the first stroke's fresh blood around the neck** (A-lane check). The runtime adds only C2's blood, at most 12 sheet decals | — | — | — |
| Blood on Harlan / the cleaver / Ada's gown | TSL masks (object-space plane + hash spatter, distance from the neck, capillary front); **no new samplers** (Harlan is at 16 on Max) | albedo | + roughness, wet darkening | same |
| Stump upwelling | a 40-tri liquid dome on the cap, scaled 0–5 mm by a uniform | texture | dome | dome |
| Eye | the `eyelid_l_open` morph + the cornea shell | same | same | same |
| DOF | the existing pipeline DOF | none (eye insert at 85 mm) | on | on |
| Motion blur | enabled once at C2 start (amount uniform) | the clip smear; turns slowed | blur if B8 measures ≤ 0.8 ms, otherwise the smear and an 850 ms whip | blur |

**Low still reads unmistakably**: the rigid strike frame with the crack on the contact frame, the head gone, two jets
pulsing in a still frame, the head's cut ring in the lamp light, the lift and the eye. Low loses mist, blur, pool growth
and DOF, not the event.

---

## 4. THE STAIR (C2c detail) AND B05

### 4.1 The headless body's choreography (a puppet; brain `scripted hidden`)

Clips: `ada_chase_headless` (2.2 m/s) and `ada_climb_headless` (1.5 risers/s, the right hand on the rail). Root keys in
C2c time:

| t | Root | What |
|---|---|---|
| 0.0 | (3.30, 1.75) | Just through the parlor door |
| 1.2 | (2.30, 2.70) | — |
| 2.6 | (0.85, 3.35) | The stair foot |
| 2.6–4.4 | — | Rounds the newel, the right hand flat on the cap and the body swinging round it. **Glance #1 sees this** |
| 4.5 | tread 1 | — |
| 6.46 | tread 4 | — |
| 6.46–6.85 | tread 4 → 9 | **The unseen catch-up**: the camera is pitched into the treads, and the player's fall covers any sound |
| 6.85–7.45 | tread 9 | Creeps. **Glance #2** |
| 8.4 | tread 10 | — |
| 8.9 | tread 11 | **Stops** (the player stopped too). The last heel slap is at 8.9 |
| 10.4 | — | The camera is facing north, away from the flight. She becomes `visible: false` and her root moves offstage to `G_PARLOR_LURE`, with **no sound, no prints and no motion on screen** |

- **The hands:** the right hand is on the rail at every frame on the stair (an IK target sliding up the rail,
  re-gripping every 0.8 s with a jerk). The left hand gropes at chest height and touches the balusters on 2 of every
  3 re-grips.
- **The feet:** bare, wet and grey-blue. Each step leaves a wet print decal (water plus a little blood, drying over
  60 s). The prints on treads 1–11 stay.
- **The drip at tread 11:** an `fx drip` emitter at tread 11's nosing, one drop every 0.6 s, slowing to one every 2 s
  by B05 +60 s.

### 4.2 The player's run (POV)

- Climb at 3.1 risers/s, slowing to 1.5 during glance #1.
- The left glove trails the west-wall dado. The torch hand pumps, **and the beam follows the arm** (the real
  `flashlight.ts` spot, with its pose driven by `arms_run_torch`).
- The bob is locked to each riser (authored from step times, not a spline).
- The creak on 5, the stumble on 12, the scramble, the top at 9.0, the slow turn at 10.4.

### 4.3 The two glances show different things

| Glance | Shows | How it is lit | Length |
|---|---|---|---|
| **#1** | **What she is:** the whole headless body at 2.1 m | A hard back-lit silhouette, lit **by lightning through the front-door fanlight**, which is physically behind her. The torch is pointed away from her | Held 630 ms; ≈ 510 ms of it lit |
| **#2** | **How close she is:** her hand on the rail at 0.9 m, reaching for you | Wet speculars on a dark hand in the beam's spill | Held 600 ms |
| The third look (from the top) | Nothing | — | — |

### 4.4 The arrival and the absence

- At the top her steps stop with the player's. For 1.4 s there is only rain, breath, heart and one drop.
- The slow turn sets up the expectation that she will be on the top tread.
- The torch shows the prints climbing to 11 and stopping, the puddle on 11, the drop falling from its nosing, and the
  empty flight and hall floor.
- **Nothing tells the player where she went** during the cutscene.

### 4.5 B05 from the first frame of control

| Time | What happens |
|---|---|
| 0.0 | Control at `S` (pitch −50°), heartbeat 120. `breath_release` at +2 s. Thunder at +1.9 s |
| +2.5 | The `armoire` lightning flash, through the roaming shadow light at the U1 window (shadowed, so no leak through the slab), shows the armoire ajar 4 m south. The hint target is `P_ARMOIRE` |
| **Her return** (brain `scripted b05_return`) | Starts at **max(+10 s, min(the player enters the armoire, +15 s))**. The sequence: the **parlor key** turns below (Harlan lets her out; the roaming shadow light is back at the lamp, and the lamp's direct light comes back on as the door opens); the hinge; her wet feet on the hall boards for 3 s, with **`ada_head_knock`** (the carried head against her thigh); then **the rocker** starts, slow (0.55 Hz): he has sat down again. She climbs 16 risers at 1.4 risers/s (11.4 s), **holding her head by the hair at her hip**, and the stump breathes |
| If the player is hidden | The existing `hide_demo`. At the slats she lifts her head in both hands to the gap (§6.3) |
| If the player is still in the open when she reaches tread 10 | She stops there, blind (head at the hip), listening, until +45 s. A second armoire flash comes at +30 s. Then she tops the stair, and normal stealth applies with `grace()`, the 6 s calm and the forgiving-difficulty radii. **No catch is possible inside the mode** |
| Guarantees | Her first sound comes ≥ 10 s after control, and she is ≥ 20 s from the player at control |

### 4.6 Gameplay realism of the stump and the carried head (critique M5)

From B05 to the end the player can put the 2000 cd core on her. Rule (e) cannot frame this, so the asset must hold up
on its own:
- **The stump is dominated by a blood film.**
  - The liquid dome is always present after C2: 2–5 mm thick, covering ≥ 80 % of the cap, roughness 0.04. Only the
    vertebra's rim and the trachea ring break its surface.
  - Under the torch it reads as a dark glossy mirror with one hot glint, never the ring diagram.
  - It upwells at 0.45 Hz.
- **Collar and posture:**
  - The gown's collar is a wet frill raised 3–4 cm above the cut at the back and sides.
  - The shoulders are hunched 4 cm, so the cap sits 2–3 cm below the shoulder line.
  - From a 1.6 m eye at 1.5–3 m the cap is seen at ≤ 15° grazing. At 1.5 m in the 60° gameplay FOV the cap is
    ≈ 65 px at 1080p, and at that angle the dome's glint, not anatomy, is what shows.
- **The carried head:**
  - Gripped by the crown, the face toward her thigh. The six free hair groups cover ≥ 90 % of the face from every
    gameplay angle (A14 checks this in a 12-view coverage render).
  - The cut end is down and drips.
- **The lifted head:** in both hands at face height in front of the stump, the hair over the face, and only the
  visible eye open.
- **Collision proxy:** a head sphere (r 0.11 m) against her right thigh capsule (r 0.08) and the hem, solved in
  `ada.ts` after the clip. It pushes out along the normal and reflects the pendulum velocity with restitution 0.3. A
  contact at a run fires `ada_head_knock`. No interpenetration.
- **Judged in play:** art-director rounds 2–3 include gameplay frames at 1.5 m and 3 m with the torch core on the
  stump, on the carried head and on the lifted head (§8.2 pair 9). The lead judges these before approving §6.

---

## 5. Assets and code changes by lane

### 5.1 Lane A — Blender (`blender/**`, only through `scripts/assets.mjs`; one Blender at a time; bakes never with a browser open)

| # | Item | Spec | Gate | h |
|---|---|---|---|---|
| A0 | **Head-node spike** | Split `ada_head` into its own node with a 33-bone mini skeleton, attach it to a socket, export, and check it in `?scene=test` (with B3). The result decides A5's estimate | runs in the test scene | 3 |
| A1 | **Ada split at the neck** | Oblique C4–C5 cut plane at the floor of the existing nape gash (re-aim the gash). Duplicate the seam and cap both sides (600 / 64 tris), 3–8 mm relief. **Average the custom normals across the seam.** Trim the gown collar | no seam line in an F1-style frame | 6 |
| A2 | **Cap anatomy** in two tiles of Ada's existing atlas (128 / 256 / 512 px) | Procedural paint per §3.2 with the anti-diagram rules, the blood film over ≥ 60 %, a baked normal map | A9 cap frames | 4 |
| A3 | **Eye** | `eyelid_l_open`, `ada_cornea_l`, the clouded eye with the iris ghost | A9 eye frame | 3 |
| A4 | **C2 clips** `harlan_c2`, `ada_c2`, `ada_rise_headless` | New root (5.15, 3.95). Two-handed swing with contact at clip 6.96 (C2 7.56) within ±1 cm of the neck point. The cleaver is left bitten in the edge. The boot nudge at 9.45. The crown grip at 10.6. The lift to fist z 2.62. The walk to the cleat; the corner. The door is closed after she is through. The 3-frame smear | A9 contact frame | 10 |
| A5 | **Headless and carry clips** | `ada_chase_headless`, `ada_climb_headless` (rail IK), a right-hand grip pose layer, `ada_head_lift` / `_lower`. Retrofit 10 clips (patrol, listen, look, hide_check, vigil, search, dress, finale_*, sting, catch_grab): **prop path** = a gripping hand + arm adjustments, about 1–1.5 h each | — | **22** (bone path 34) |
| A6 | **FP arm clips** | `arms_run_torch`, `arms_stumble_catch`, `arms_newel_knock` | — | 2 |
| A7 | **`P_LAMP_PARLOR`** | A new instance of the existing `kerosene_lamp` generator: wick `high`, flame anchor; check the chimney glass (F0 0.04) and the soot band | — | 1 |
| A8 | **Stool check** | Seat height 0.42–0.48 m (flame target z 1.30–1.40); if not, a 0.1 m block under the lamp | — | 0.5 |
| A9 | **Review renders** `review_c2.py` (Cycles, real light values) | **First (before A4): the lamp-placement proof** — C2 2.4, 7.62, 9.9, **24.6 and 27.0** from `D`/`T` with the restaged lamp and blocking. Then the cap at 2.73 m / 50 mm and at 1.2 m (worst case), the eye at 100 mm, and the `D` frustum against the door leaf and casing. Three look → improve → re-check rounds | the AD look | 6 |
| A10 | **Parlor bake with the lamp's indirect light** | Layout `bakePass: 'indirect'`: two Cycles bakes of LM_PARLOR (the other lights all passes; the lamp alone indirect only), summed, then `oidn.py`. Wall time ≈ 2–4 h on the M1, never with a browser open | `assets --check` budgets; a provisional → final AD flag | 6 |
| A11 | **REALISM #17 skin/gown** (a prerequisite for S10, glance #2 and gameplay) | Wet translucent cotton (darker, see-through where wet), skin with wrap/sheen values in the atlas, grey-blue drowned grade | A9 frames S10 / glance #2 | 6 |
| A12 | **REALISM #6 first-person gloves** (a prerequisite for C2c) | Leather gloves: seams, knuckle creases, wear, a cuff, per-finger rig check; LODs | AD frame C2c 6.6 | 8 |
| A13 | **Follow-on clips** | C2b knock by hand, C4c take, C5 shadow-play, the C7 sting, death (§6) | — | 6 |
| A14 | **Gameplay stump/head** | The collar frill, the hunch in the base pose, the 12-view hair coverage check | coverage ≥ 90 % | 3 |
| | **Lane A total** | | | **86.5 h** |

### 5.2 Lane B — runtime

| # | Item | Spec | h |
|---|---|---|---|
| B1 | **C2 rewrite** `c2-room.ts` | Shots per §2.1. Stage constants (`D`, `HARLAN_C2`, `LAMP`, `NECK`, `HEAD_LAND`, `HEAD_REST`, `STAIR_TOP_EYE`) are tested against the layout. The exposure cue `{spot, key, clamp}`. The eye insert as a hard cut. The flinch only at `head_drop` | 9 |
| B2 | **C2c** `c2c-up.ts` NEW + the chain | Per §2.2: the POV path from riser maths, Ada's `moves` with the hidden catch-up and the offstage move at 10.4, the tread-11 drip, the chain C2 → C2c, the skip rules, the real torch beam following the arm, the letterbox at 13.6–13.9 | 8 |
| B3 | **Severed Ada + the head node** `characters/ada.ts` | The `severed` flag; neck spring off; the head pendulum and the two-end rope pin; the eyelid morph; the cornea material; the stump dome at 0.45 Hz; `headPos()` for the AI; the thigh collision proxy | 10 |
| B4 | **Blood FX** `world/blood-fx.ts` NEW | §3.7: analytic linear-drag TSL, the CPU termination table at load, the back-lit term (§3.4), the velocity output, landing records → decals, the scheduled-cue API, tiers 100 / 620 / 1450, prewarmed | 12 |
| B5 | **Decals and pools** `world/decals.ts` | The atlas, ≤ 3 batches, growth/clotting by game time, wet prints, the drip trail | 8 |
| B6 | **Blood on materials** | TSL masks, no new samplers | 4 |
| B7 | **Lamp + roaming shadow light** `world/lights.ts`, `cutscene-fx.ts` | `SHADOW_CANDLE_ID` → `SHADOW_LIGHT_ID = 'L_LAMP_PARLOR'`, castShadow still fixed from load. A cue `fx shadowLight {at: 'lamp' / 'fanlight' / 'u1_window', pulses}`: moves the light, sets cd/K/distance, redraws the map on each pulse onset, and restores it. The lamp's direct light is off while it roams (only behind a shut parlor door). C5's `silhouetteOn/Off` uses the same light. The lamp's flame card has halation on the core only. The update policy per §2.4 | 8 |
| B8 | **Camera + blur** `camera-fx.ts`, `pipeline.ts` | **The motion-blur variant is built once at C2 start; only its amount uniform changes (never `setCutscene` mid-sequence)**, and it is prewarmed in B11. Medium: measure MotionBlur + velocity at C2 7.5 and C2c 0.3. Enable it if ≤ 0.8 ms; otherwise the smear plus the 850 ms whip. The flinch impulse, the riser-locked bob, the stumble | 7 |
| B9 | **AI** `ai/ada-brain.ts` | Retire `b04_chase`. NEW `b05_return` per §4.5. Head semantics: `hanging` (blind) / `lifted` (`eye()` 0.25 m ahead of the stump) / `placed` (blind; the head's eye is the vision source only in `hide_demo` at the slats). The `ada_head_lift` tell replaces `ada_bone_crack`, with the same timing. Blood in her drip trail | 6 |
| B10 | **Story** `story/beats.ts` | `CutsceneId` + `C2c`, − `C2_replay`; the chain; CP2 moved; the flags; B03 additions; the armoire flash at +2.5 via the shadow light; the B04 respawn branch removed | 5 |
| B11 | **Warm-up** | Prewarm the blood material, the blur variant, the lamp shadow, the head node and the C2 first-frame shaders; the frame-time guard | 4 |
| B12 | **Scheduled audio cues** `cutscenes/host.ts`, `sequencer.ts`, `audio` | The `sched` flag, a 150 ms lookahead, `start(when)` with outputLatency compensation, the cutscene clock slaved to `ctx.currentTime` in C2 | 3 |
| B13 | **#17 runtime side** | The skin wrap/sheen, the wet-cotton translucency in TSL (with A11) | 8 |
| B14 | **Glove material** (with A12) | The leather BRDF, wet sheen | 2 |
| B15 | **Follow-on cutscenes** | C2b (hands knock; the head on the runner, out of focus), C4c, C5 (the shadow of a head held up), C7 sting, death (§6) | 8 |
| B16 | **Gameplay head/stump** | The coverage rules, the knock trigger, the torch frames for AD | 4 |
| | **Lane B total** | | **106 h** |

### 5.3 Lane C — audio, voice, tests, docs

| # | Item | Spec | h |
|---|---|---|---|
| C1 | **Synth sounds** | §2.3 (incl. `head_nudge`, the 570 Hz `stump_breath`), each auditioned in `lab.html` | 10 |
| C2 | **Voice script** | Retire `b04_door_rattle`; the `b03_go_on` cue moves to 17.3; stage-direction tags only | 1 |
| C3 | **Tests** | Story chain and flags; CP2 and its pitch; skips (C2 → C2c 10.4); no B04 death; AI `b05_return` (idle / hidden / flee; first sound ≥ 10 s); stage constants vs the layout; the scheduled-cue maths | 4 |
| C4 | **QA scenarios** (`scripts/qa/*`, by lead assignment) | `playthrough.mjs` with no input through C2 + C2c; `c2c-handover.mjs`; `c2e-hero.mjs` (§8.2 frames + the **A/V offset log** + the gameplay torch frames) | 5 |
| C5 | **Docs** | DESIGN (lore §6.1, Ada, B03–B05, CP2, cutscene list), CUTSCENES-PLAN (table, faces-hidden audit), CHARACTERS.md, AUDIO.md, PERF-PLAN P0-2 note, CONTRACT-CHANGES rows | 3 |
| C6 | **Empty-stair prototype** `scratch/c2e/stair.mjs` (critique M10) | On the existing stair, before C2c is built: the camera at `S` / −50°, the torch on treads 9–12, stub wet-print decals with beaded-water normals (roughness 0.15–0.3). Two shots on Medium | 3 |
| | **Lane C total** | | **26 h** |

**Grand total: 218.5 h** (revision 1 said 138). **Not included:** runtime-F's U1 portal/room culling (a dependency for
the Max look-back, owned by runtime-F).

### 5.4 Contract changes (log each in `docs/CONTRACT-CHANGES.md` on approval)

| # | Contract | Change |
|---|---|---|
| K1 | `level-layout.json` props | ADD `P_LAMP_PARLOR`, type **`kerosene_lamp` (existing)**, room G2, pos (4.60, 4.25, 1.05), yaw 0.4, `lighting: dynamic`, `collider: none`, params `{wick: 'high', mat: 'glass_grimy', burnerMat: 'brass_tarnished'}`. MOVE `P_STOOL` (5.30, 0.75) → (4.60, 4.25). MOVE `P_WHETSTONE` → (4.85, 4.50, 0.60) |
| K2 | `level-layout.json` lights + `layout-types.ts` | ADD `L_LAMP_PARLOR`: point, G2, pos (4.60, 4.25, 1.35), **151 W (12 cd)**, 1950 K, radius 0.012, mode `bake_flicker`, NEW optional field **`bakePass: 'all' / 'indirect'`** (default `all`) = `indirect`. Interim before the bake: mode `runtime` (logged). **No `L_LTN_G2S`** |
| K3 | Shadow-light convention (PERF-PLAN P0-2, `lights.ts`) | The one cube-shadow point light becomes `L_LAMP_PARLOR` (`SHADOW_LIGHT_ID`). It **roams** by cue (C2c fanlight, U1 window, B05 armoire flash, C5 silhouette). `L_CANDLE_TABLE` becomes an ordinary unshadowed flicker light. The number of shadow-casting lights is unchanged |
| K4 | `level-layout.json` spawns | `CP2` → pos (1.05, 8.25, 5.75), room U1, yaw −1.571, **pitch −0.87**, note "Stair top after C2c" |
| K5 | `level-layout.json` cameras | ADD `parlor_lean`: pos (3.70, 1.26, 2.17), target (5.31, 3.25, 1.40), fov 27 (vertical, 50 mm) |
| K6 | `level-layout.json` props/doors/triggers | `P_CLEAVER` param `state: 'bitten'` at (5.31, 3.25, 1.40) after C2. `D_PARLOR` note: "locked by Harlan in C2; opened by him for her at B05 +10–20 s". `T_B04_STAIRTOP`, `T_B04_ARMOIRE_FLASH` retired |
| K7 | `material-spec.json` | ADD `blood_wet` (albedo (0.11, 0.009, 0.008), roughness 0.05, F0 0.022, params `age`, `thickness`, **`muA` (1.0, 100, 120) /mm, `g` 0.95**), `blood_dried` ((0.06, 0.016, 0.012), roughness 0.55). `steel_cleaver` gains an optional `bloodMask` |
| K8 | Story beats (`beats.ts`) | `CutsceneId` + `C2c`, − `C2_replay`. B04 = C2c only. B05 starts at the stair top with `b05_return`. CP2 moved. Flags `ada_severed`, `cs_C2c_done`, `c2_strike_time` |
| K9 | AI rules (DESIGN "Chaser AI", `ada-brain.ts`) | `b04_chase` retired. NEW `b05_return`. Head states `hanging` / `lifted` / `placed`. The tell `ada_head_lift`. `eye()` 0.25 m ahead while lifted. Blood in the drip trail |
| K10 | `voice-script.json` | `b04_door_rattle` retired; stage-direction tags updated; the `b03_go_on` cue at C2 17.3 (no schema change) |
| K11 | Characters (CHARACTERS.md) | Ada split with caps (same 114-bone skeleton); **`ada_head` node with a 33-bone mini skeleton** (or the bone fallback after A0); morph `eyelid_l_open`; node `ada_cornea_l`; the new clip names (A4–A6); the neck spring is off after C2 |
| K12 | Cutscene cue schema (`cutscenes/types`, `host.ts`) | `sfx` gains `sched: true` (audio-clock scheduling). NEW `fx shadowLight` and `fx blurAmount` cues (the variant is built once per sequence). The `attach` cue also accepts the `ada_head` prop |
| K13 | DESIGN lore and content | The beheading is shown clearly (the boot content warning covers gore). The absence rule (§6.1). "Death is quick and not gory" stays |

---

## 6. Lore and the later scenes with a headless Ada

### 6.1 Lore text (DESIGN changes; lane C writes them on approval)

- **WHAT HE IS:** "His mother's receipt book said to take the head and give it back to the water. That holds her one
  night." Add: *on a night with a guest he does not give it back. He keeps the head until the guest has run, because
  she has to take them herself.*
- **THE TWIST:** *he waited until you were in the doorway, then let you watch the second stroke, lifted her head by the
  hair and turned it to you so she would see your face.* The bell, the rope and the herding up the stairs stand.
- **WHAT SHE IS:** *the water clouded her eyes, so she must lift her own head to a face to know it. When she loses the
  sound she hunts, the body goes back to wherever its head is, and no one sees it go.* This is the rule that empties
  the stair. "She can't get past nails", "she comes to the bell" and "she learns" stand.
- **Ada's appearance:** *headless. She carries her head by its hair at her hip, where it swings and knocks against her
  thigh when she runs. To see, she lifts it in both hands to face height in front of the stump. The stump wells and
  breathes through the cut windpipe.* The locket-chain line moves to the stump's edge.

### 6.2 AI tells (B05–B13)

- **Head at the hip = blind; head up = seeing.** This is visible at any distance. The LOOK wind-up is the lift (0.6 s,
  `ada_head_lift`), the same timing as the old crack, so the difficulty does not change.
- **Sounds:** the drip (now with blood); `stump_breath` (audible to 4 m, through no walls); at a run, `ada_head_knock`
  at the step rate (carries through one wall).
- **Her trail:** water prints and dark drops, drying over 10 min.

### 6.3 B05 — the slats (literal now)

- She climbs with the head at her hip (the knock-knock up the stair through the armoire doors). At the slats she
  **lifts her head in both hands to the gap**: the hair hangs through the slats, and a lightning flash (the roaming
  shadow light at the U1 window) parts it on one clouded eye 6–8 cm from the player's eye.
- "…Harlan?" (`ada_look_harlan_close`) is spoken **from the head's position**.
- She lowers it, the drip resumes, and she goes to her vigil.
- **Vigil (`ada_vigil`):** she sets the head down at the foot of her boarded door, face to the planks, and her hands
  scrape the nail heads. A blind vigil, consistent with the sneak-out rule.

### 6.4 B09 — the dress

She sets her head on the dress form's shoulders (its eye closed) and kneels at the hem with both hands free. She is
blind while the head is on the form, and takes it back afterwards.

### 6.5 Finale — C4c / C5 / C7 / death, and C2b

- **C2b 'Her Door':** the knock at 8.4 becomes **her hands knocking**. The macro shows the head on the runner at the
  planks' foot, hair spread, out of focus.
- **C4c 'She Remembers':** she holds her head up to the locket in the player's light. The left hand takes the locket
  while the right holds the head by the hair.
- **C5 'Your Knock' stays a shadow-play.** It uses the same `silhouetteOn` relocation, now moving `L_LAMP_PARLOR`'s
  light object to the same position at the same 0.95 cd and 1850 K. **The look is unchanged; only the code's light
  lookup changes.** The lamp prop's flame is hidden for C5 (blown out), and its baked indirect light goes out with
  `uParlorBake` (it is in the parlor atlas).
  - The silhouette is now **a headless woman holding her head up to a bare-headed man's face** ("…Harlan.",
    `b11_recognition`, from the head's position).
  - She takes his cleaver, and the shadow of the raised cleaver comes down. We cut on the downswing to the cleat.
    The receipt book's rule, reversed: *take the head.*
- **C7 'The Keeping' (sting):** she sits in his rocker, her own head in her lap, the sack (heavy now, with his head in
  it) by its knot in her other hand.
  - On the next traveler's freeze she lifts her head by the hair and turns the sack's eyeholes to the doorway beside
    it: his opening shot, with the roles reversed.
  - Lit by the parlor lamp: the same key as C2.
- **Death cutaway** (3 s, unchanged rule, "quick and not gory"): a wet hand over the lens, then her head brought up to
  your face in both hands. Hair fills the frame, one clouded eye catches the torch, then black.

### 6.6 Other references to fix

DESIGN B05 ("a crack of bone" → "a wet creak as she lifts her head by the hair"), B06, the animation list, and the
sounds list. C3b, C4a, F1 and F2 are unchanged (F1/F2 are 1976 flashbacks: she has her head; the seam normals must hold,
A1).

---

## 7. Performance budget and realism risks

### 7.1 Per-shot budget (Medium ≤ 400 draws / 1.5 M tris / ≥ 45 fps; Max ≤ 500 / 2 M / ≥ 45 fps; Low ≥ 30 fps)

Baseline first (**on mains**): today's C2 at 3.5 / 9.9 / 17.0 s and the B04 look-back, per tier, with the runtime-F
per-pass breakdown.
- Known today: the parlor view costs 10.5–10.9 ms GPU on Medium.
- The U1 view on Max is **798 draws / 2.56 M tris** (`STATUS-runtime-f.md` F9). C2c's look-back and the B05 start are
  U1 views and depend on runtime-F's culling. That is a dependency, not a reason to cut detail.

| Shot | Added draws | Added tris | Added GPU (est.) | Notes |
|---|---|---|---|---|
| C2 S1–S2 | lamp 3 + flame 1 = **+4** | +3 k | +0.2 ms | The shadow cube moves from the candle to the lamp (net 0 shadow passes). **But level meshes are casters**: the lamp's cube sees the parlor walls, floor, table and characters: ≈ 6 faces × 10–14 objects. Measure it; if > 1.0 ms, set the lamp's `distance` to 4.5 m and cull casters per face by distance |
| C2 S3–S5 | particles 2 + decals 2 + dome 1 + head node 2 = **+7** | +4 k (Max +9 k) | +0.5 ms Medium, +1.0 ms Max (1450 alpha-tested capsules + blur) | the frame-time guard drops the mist first |
| C2 S6 (100 mm insert) | cornea **+1** | +0.5 k | DOF +0.6 ms | the cheapest frame (a narrow FOV culls the room) |
| C2c hall + stair | drip 1 + print batch 1 = **+2** | +1 k | **the roaming cube redraws 4× per stroke** (≈ 0.3–0.6 ms on the pulse frames only) | G1 + stairwell |
| C2c look-back (U1) | +2 | +1 k | as above | gated on runtime-F culling for Max |

New content stays within **+11 draws and +13 k tris** on every tier. Every C2/C2c frame is still measured against the
absolute budget.

### 7.2 Realism risks — honest verdicts

| # | Element | Verdict | Mitigation |
|---|---|---|---|
| R1 | **The eye insert** (100 mm, 2.55 m) | **Highest risk.** It reads only if the skin is a 2 × 5 cm band, there is one sharp flame highlight, and the iris ghost keeps it from a costume-lens white | A9 first; Low at 85 mm |
| R2 | **The cut ring** (the rigid strike frame at 86 px; the head on the floor for 1.1 s) | **A real wound in motion, under-lit. As a still at Max/1440p (≈ 115 px) it is a very good prosthetic, not a forensic photo** | The anti-diagram rules, film ≥ 60 %, relief, highlights moving with the flicker; never front-lit, never held > 1.1 s still |
| R3 | **Blood particles** | **Good** with the back-lit red-rim term, log-normal sizes and termination; CG if uniform | §3.4, §3.7 |
| R4 | **Pools and stains** | **Likely the most photographic element** | meniscus, seam wicking, clot ages |
| R5 | **Hair in a fist** | **Medium** (the "black helmet" under back-light) | the two-end rope pin, drips, the pendulum keeps it moving |
| R6 | **The headless body** (S10 split-lit; S11 dim shape; glance #1 silhouette) | **Glance #1 is safe** (a pure silhouette with a rim). **S10 is mannequin-prone without #17**: half-lit at ≈ 3.5 lx, ≤ 30 % of the frame, wet speculars | A11/B13 are a gate for S10. Fallback: S10 shortened to the stump rising into the light (≤ 1.5 s) |
| R7 | **Her hand at 0.9 m** (glance #2) | **Medium**: skin in spill | ≥ 15° off-axis, 2–3 EV under the riser, wet speculars; gate on A9; fallback 400 ms |
| R8 | **Harlan** | **Safe**: the lamp is always behind him from `D`; the sack's front is dark | never move the lamp in front of him |
| R9 | **The lamp flame** | **Medium**: out of frame from `D`; visible ≤ 400 ms in S8 | a 2.5 cm emitter, core-only halation (≤ 6 px), judged in pair 4 |
| R10 | **Lightning** | **Good**: shadowed from real openings (the fanlight muntins, the U1 window), soft at 512² as a sky source should be | — |
| R11 | **POV run** | **Good** if step-timed; the whip judders on Medium without blur | B8 measurement or the 850 ms whip |
| R12 | **The empty stair** | **The most achievable photographic frame**: torch on wet wood and beaded prints, a cold far window | C6 prototype first |
| R13 | **FP gloves in the stumble** (0.4 m, in the spill) | **Will look fake today** ("featureless black blobs", a blocky mitten in `now-05`) | A12/B14 are a gate for C2c |
| R14 | **Stump and head in gameplay** under the 2000 cd core | **Medium–high**: we cannot frame it | §4.6 film/collar/hair rules; AD pair 9 |

Never shown, because it will not read as a photograph: a full face, skin closer than 0.5 m (except the eye band),
cloth contact, fluid simulation.

---

## 8. Build order and QA

### 8.0 Before building

1. The lead approves K1–K13 and answers the requests below.
2. Baseline on mains: `node scripts/shot.mjs --scenario scratch/c2e/look.mjs --preset low|medium|max --beat B03
   --fps 3`. Record draws, tris and GPU ms per frame. The `now-*` frames are battery captures, for composition only.
3. **C6, the empty-stair prototype** on the existing stair: the cheapest proof of the ending.

### 8.1 Order (each step ends with its own look → improve → re-check ×3)

| Step | Lane | Work | Gate |
|---|---|---|---|
| 1 | A | A0 spike (with B3), A7, A8, then **A9 lamp-placement proof (C2 2.4 / 7.62 / 9.9 / 24.6 / 27.0)** | the AD passes the lamp staging **before any animation** |
| 2 | A | A1 split, A2 caps, A3 eye, A14 collar; A10 bake (overnight, no browser) | A9 cap and eye frames |
| 3 | B (parallel) | B4, B5, B6 on `?scene=test`; B7 roaming light; B8 blur measurement; B12 scheduled audio | test-scene frames (a back-lit jet, a pool, the A/V offset ≤ 1 frame); zero console errors with the system loaded alone |
| 4 | C (parallel) | C1 sounds, C2 voice, C5 docs | the lead listens to `cleaver_sever`, `head_drop`, `stump_breath` |
| 5 | A + B | A11/B13 #17 skin/gown; A12/B14 gloves | A9 frames S10 and glance #2; a glove frame |
| 6 | A | A4 C2 clips | contact ±1 cm; head rest pose |
| 7 | B | B1, B3, B11 | **AD round 1** (C2 pairs 1–5; provisional if A10 is not in) |
| 8 | A | A5, A6 | — |
| 9 | B + C | B2, B9, B10, B16; C3, C4 | `npm test`, the playthrough bot to the ending, **AD round 2** (C2c pairs 6–8 + gameplay pair 9). Max look-back only after runtime-F culling |
| 10 | A + B | A13 + B15 follow-ons; round 1–2 fixes | **AD round 3** on Low / Medium / Max; full QA |

### 8.2 The QA frames (the harsh art-director look)

`scripts/qa/c2e-hero.mjs`, simulated time, 1280×800 (★ also 1920×1080), at most 2 images per look step, paired as below.

| Pair | Frames | Judged for |
|---|---|---|
| 1 | C2 2.4 (tableau, sack turning into darkness) · C2 7.62 (the head separating, the jet back-lit, rigid frame) | one key light; Harlan a rim silhouette; **the strike unmistakable in one still** |
| 2 | C2 7.50 (downswing blur / smear) · C2 8.45 (pulse 2 from the stump, same frame) | motion reads, no stutter; the ring and the jet read as real |
| 3 | ★ C2 9.9 (the head rolled: ear and jaw profile, the cut ring in the lamp) · ★ C2 13.9 (the eye insert) | R2, R1 — the riskiest two |
| 4 | C2 16.0 (both look at you) · **C2 18.6 (the flame in view behind Harlan's legs)** | faces hidden; R9 (no sprite flare, halation ≤ 6 px) |
| 5 | C2 24.0 (the body rising, split-lit) · C2 27.8 (in the hall, the door shut behind her) | R6: never a mannequin |
| 6 | C2c 0.33 (mid-whip, Medium) · ★ C2c 4.0 (glance #1 silhouette in the fanlight stroke) | judder; the silhouette reads as headless in one still |
| 7 | C2c 6.62 (the stumble: gloves on tread 13 in the spill, R13) · C2c 7.1 (glance #2: the hand on the rail) | gloves; R7 |
| 8 | ★ C2c 12.6 (the empty stair: torch on the prints, the cold far window) · C2c 13.9 (the handover = gameplay frame 1) | prints sparkle in the beam; no snap; letterbox gone |
| 9 | Gameplay B05: her at 1.5 m and at 3 m with the torch core on the stump and the carried head | R14 |

- Each pair on Medium first, then Low and Max.
- Perf: `--fps 5` at C2 7.5, 13.9 and C2c 4.0 and 12.6 on each tier, on mains.
- **A/V offset of the strike ≤ 1 frame on Medium** (the C4 log).
- Zero console errors with the full game and with `?scene=test` + the blood system alone.

### 8.3 The playthrough bot and the logic tests

- **`playthrough.mjs`:** the B03 walk-in unchanged → C2 + C2c with **no input**. Assert:
  - the chain C2 → C2c;
  - `deathsTotal` unchanged;
  - control at `S` ± 0.1 m with pitch −0.87 ± 0.02;
  - beat B05 and brain `b05_return`.

  Then walk 4 m south to `H_ARMOIRE` → hide → `hide_demo` → B06. The old "flee up the stair" leg is deleted.
- **`c2c-handover.mjs`:**
  - (a) idle 60 s at `S`: no catch; she holds at tread 10 until +45 s;
  - (b) her first sound comes ≥ 10 s after control;
  - (c) running into U2 instead of hiding: no catch within 60 s.
- **Skips:** a skip in C2 lands at C2c 10.4; a skip in C2c gives control at `S`. Both leave the flags of a full play.
- **`npm test`:** the story chain and flags; AI `b05_return`; the stage constants; the scheduled-cue maths; the release
  gate (`QA_STRICT=1`) still reaches C7 → title.

---

## 9. Critique responses

Accepted as written: B1, B3, B5, M1, M2, M4, M5, M8, M9, M10, m1–m6. Accepted with a different mechanism or with
reservations:

- **B2 (lightning on the strike):** removed, and so is `L_LTN_G2S`.
  - **I do not move a stroke to S2 (the sack turn).** The one shadow light is the lamp in C2. Borrowing it for a
    0.4 s stroke means the lamp is unshadowed (leaking through `WG_G1G2`) or dark between pulses. A cold flash on
    the burlap also front-lights the sack, which breaks R8 at the moment its front should fall into darkness.
  - The storm stays present in C2 through thunder (9.8 s) and rain on the shutters. Lightning returns in C2c, where
    the shadow light is free.
- **B4 (the empty stair):** the absence now stands. There are no sounds below and no prints going down, the letterbox
  holds until the last 300 ms, the 9.2 stroke is gone, and the parlor sounds move to B05.
  - **I keep one cold stroke at the reveal**, at 12.9, 9 s after the previous one. It lights only the far window and
    gallery (the slab shadows the treads) and adds the depth the photographic frame needs.
  - The prints are torch-lit, per M10. If the lead wants zero strokes, cut it: the frame stands on the torch alone.
- **M3 (the head's read):** accepted. But B1's rigid frame puts the landing and the settling roll off-screen, so the
  quarter roll is **motivated by Harlan's boot** when the camera arrives (9.45). The S5 "cut seen edge-on from below"
  claim is withdrawn: the eye is above the head.
- **M6 (the head as a prop):** accepted and recommended, gated on the A0 spike. A5 is 22 h on the prop path and 34 h
  on the bone path.
- **M7 (glance #1):** accepted, but **the "lamp-lit parlor doorway behind her" cannot be used**: Harlan shuts and locks
  the parlor door at C2 27.6–28.3 (the lore needs the head locked away). The backlight is instead lightning through the
  **front door's glazed fanlight** (`doors.py fanlight()`), physically behind her from the stair. It is shadowed by the
  roaming shadow light, and its rays land on the hall floor at y 2.1–3.9, exactly behind her (geom).
- **M11 (the whip):** the turn is to the right, so it is 154° and not 206°. It takes 650 ms, peaking at 380°/s (6.3°
  per frame at 60 fps), and on Medium it uses blur if B8's measurement allows. On Low it takes 850 ms. The arc crosses
  the bolted front door, which gives it a reason.
- **M12 (POV grammar):** the critic is right about the continuous 50 → 100 mm zoom. But C1-OPENING itself drifts the
  lens inside POV shots (24→28, 50→44), so small drifts hidden in body motion stay. The eye is a hard-cut 100 mm insert.
- **M13 (the flame):** solved by the restaging. The flame is 22.2° from the neck aim, outside every 50 mm `D` frame. It
  shows only in S8, for ≤ 400 ms, which is the frame judged in pair 4.
- **m2 (pitch):** the critic's arithmetic undersold it. From `S`, tread 11 lies at −59° and the flight's foot at −48°.
  Neither −32° nor −24° shows the prints, so both the turn's end and CP2 are now −50°.

---

## Requests for the lead

1. **Riser count:** `ST_MAIN` has 16 (the brief's 14 is `ST_BACK`). The design uses 16, with the stumble on creaker 12.
   Confirm.
2. **Approve K1–K13**, especially:
   - the restaged lamp (an existing type) on the moved stool;
   - **`bakePass: 'indirect'`**: a layout schema addition;
   - **moving the one shadow light from `L_CANDLE_TABLE` to `L_LAMP_PARLOR` and letting it roam by cue** (PERF-PLAN
     P0-2 convention);
   - the scheduled `sfx` cue.
3. **Lore:** approve §6.1's absence rule ("the body goes back to wherever its head is, and no one sees it go") and the
   C5/C7 changes.
4. **The heart restarts** when the body rises (pulses 5–6, then a 0.45 Hz upwelling). Approve, or ask for a steady
   seep.
5. **Schedule the prerequisites in this round:** #17 skin/gown (A11 + B13, 14 h) and FP gloves (A12 + B14, 10 h). The
   alternative is to accept C2 S10 shortened to 1.5 s and C2c as not shippable until the gloves land.
6. **Sequence runtime-F's U1 culling** before AD round 2 (Max U1 is 798 draws / 2.56 M tris today).
7. **Book a no-browser window for the A10 parlor bake** (≈ 2–4 h wall time on the M1). Rounds before it are
   provisional.
8. **Assign `scripts/qa/*`** (playthrough, c2c-handover, c2e-hero with the A/V log). §5.3 assumes lane C.
9. **The B05 never-hides rule:** her return starts at max(+10 s, min(hide, +15 s)), she holds blind on tread 10 until
   +45 s, and then normal stealth applies with the 6 s calm. Confirm this meets "the first hide cannot be failed".
10. **The roaming shadow light's cost:** the cube redraws with level casters in range. B7 measures it in step 3. If it
    exceeds 1.0 ms on Medium, B7 shortens `distance` and culls casters per face. Approve that fallback (no visual
    change intended).
