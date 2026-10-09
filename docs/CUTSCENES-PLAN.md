# CUTSCENES-PLAN: more cutscenes, more photographic (design, 2026-10-07)

The request was "try to fit many cut scenes in the game, just make the game better, with ultra realistic graphics".
This document judges the two proposals (Storyteller/Director, A; Cinematographer/Production realism, B) and sets out
the single plan to build. The existing system is described in `docs/CUTSCENES.md`; this plan only adds to it.

**The result:** 12 new cutscenes (about 204 s), small upgrades to C1, C2, C5, C6 and C7, no change to C3, C4 or death,
and a cutscene render profile. The game goes from about 12.5 to about 16 minutes.

Hard limits respected:
- The client's opening is untouched: low fuel at night, the forced stop, knock and bell, the door opening by itself,
  the first room on the right, the double look, the chase up the stairs.
- The route is still linear and there is still one ending (C7).
- Faces are never resolved.
- No new lightmap atlases, sets or characters. Blender work is one optional Ada clip and two prop node splits.
- About +0.8 MB per tier.

---

## 1. Verdict

### Scores (1–5, higher is better)

| Criterion | A: Storyteller | B: Cinematographer |
|---|---|---|
| Horror / story value | **5**: shows Ada's last day, makes the twist visible ("The Twelfth Can"), plants the sting | 4: plants lore well (guest book, tallies, boots on the hatch); fewer emotional peaks |
| Ultra-realistic payoff | 4: hands and paper in macro are good, but it relies on new underwater/interior-mapping TSL and re-textured bare arms (glove mesh) | **5**: macro hero props, rack focus, headlights in rain, dust in the beam, overcast dawn; only things the engine already does well |
| Fidelity (fixed beats, faces hidden) | 3: a well cold open *before* the car risks the client's opening; Harlan's bare head is turned toward camera in F1 | 4: the opening stays in the car (C0 is the same night on the same road). But C1c cuts inside the house and explains the door rope before the player feels it |
| Buildability (budgets, 8 GB M1) | 2: 1 Ada clip, 2 arms clips, 2 Harlan poses, 2 arms texture variants (~+2–4 MB), underwater + Snell window + interior-mapped well, 12 fx | **4**: zero Blender clips, ~0.3 MB; the risks are sequencer `car0` space and the procedural tally layer |
| Pacing | 2: four cutscenes in the B06–B08 stealth stretch, 219 s | 2: 90 s locked before B02, then C1b, C1c and C2a within two minutes of first control; credits before the sting |
| **Total** | **16** | **19** |

**Synthesis rule.** B's production method (existing clips, macro props, lightning cuts, shadow-play, no new rigs) is the
**base**. Onto it go A's strongest story ideas, rebuilt in B's cheap grammar:

- the reverse-angle twist (C4b);
- the bell summons with 1976 flash-frames (C3b);
- "You'll keep." (F2);
- the locket-take memory flashes (C4c);
- the sting planted inside the relief (C5b candle and rocker, C6b grey hand on the lantern and the rope).

### Kept, merged and cut

| Proposal item | Decision | Why |
|---|---|---|
| A C0 underwater cold open | **Cut** | It comes before the client's fixed opening and needs new underwater, Snell-window and cistern-shaft TSL. The "under the boards" image survives as sound in F2. |
| B C0 County Road 9 | **Keep**, trimmed 36 → 30 s | The best graphics showcase, and "low fuel at night" still opens the game. It match-cuts into C1. |
| B C1b Last Gas | **Cut** | 84 s of locked opening is already enough. The pump is seen in play and again in C6. |
| B C1c It Rings in There | **Cut** | It replaces the felt beat of the door opening by itself, and it explains the rope before the twist can reveal it (C4b does that later). |
| B C2a Eleven Names | **Keep as optional** (9 s, plays on the first guest-book read) | A forced version would delay the client's beheading beat. The optional version still plants the line that C7 fills with HARLAN. |
| A C2b + B C2b Her Door | **Merge** (11 s) | A's whisper "...my dress..." with B's macro inserts. |
| B C3a Six Thousand Nights | **Keep**, trimmed to 16 s | Lore made visible. The procedural tally layer also improves C2 and C7. |
| A F1 Bus Fare (biscuit tin) | **Cut** | Adds pacing load to B06, needs a new prop, and turns Harlan's head toward camera. The bell-summons idea moves into C3b and F1. |
| A F2 ledger flashback | **Cut** | Needs a new clip (`ada_hatch_reach`) and lands in the B06 stealth loop. The ledger voice-over already tells this. |
| A C3b + B C3b bell lure | **Merge** (16 s) | B's hardware-and-feet cutting plus A's two 0.6 s 1976 flash-frames and "Ada." / "Coming." |
| A C3c + B C4a door gives | **Merge** (13 s), B's two-flash version | Cheapest scare in the plan; no character needed. |
| A F3 + B F1 the hem flashback | **Merge** into F1 (32 s), B's method | Ada as candle shadow on wallpaper plus fingers at the frame edge, so no arms texture variant and no new arms clip. The 1994/1976 needle match is the device that sells it. |
| A F4 the well | **Cut** (cost L) and replaced by B F2 (24 s) | Boots on the lid, knocks from beneath, plus A's "You'll keep." Gives the same murder for a fraction of the cost. |
| A C4b The Twelfth Can | **Keep** (15 s) | It is the twist, shown. |
| A C4c She Remembers | **Keep** (11 s) | Pays off every flashback in one breath. Existing clips only. |
| A C5b + B C5b porch | **Merge** (14 s) | B's photographic dawn plus A's candle catching and rocker restarting behind the shutter. |
| A C6b Bait | **Keep** (13 s) | Sets up the sting; hands-only macro. |
| B CR credits drive | **Cut** | Credits before the sting send players away before the real ending. CR's ticket idea moves into C6. |
| A death underwater insert | **Cut** | Death stays as it is (3 s, never skippable). |
| A arms texture variants, `arms_sew`, `arms_claw_floor`, Harlan drag/hold poses, `ada_hatch_reach` | **Cut** | Blender time and download size, and bare hands on a glove mesh look wrong in macro. |
| A `memory_ripple` TSL dissolve | **Cut** | Lightning white-outs and dips to black do the same job (B's device) at no cost. |
| A "Memories" journal tab | **Cut** | Out of scope. |

---

## 2. The final cutscene order

New cutscenes are in **bold**. "Skip" means skippable after the first view through the existing SeenStore. Every new
mid-game cutscene plays once per save, never replays after a death, and is **dropped, never forced**, if its safety
gate fails (§4). None of them is needed to progress.

| # | Id | Title | Beat / trigger | Length | Lock | Cost |
|---|---|---|---|---|---|---|
| 1 | **C0** | County Road 9 | New game, before C1 (C0 → C1) | 30 s | full | M |
| 2 | C1 | Empty (upgraded) | as now | 54 s | full | S |
| 3 | **C2a** | Eleven Names | B03, first `read_guest_book` (optional) | 9 s | full | S |
| 4 | C2 | The First Room on the Right (render-only upgrade) | as now | 21.6 s | full | S |
| 5 | C2_replay | (unchanged) | B04 death | 3 s | full | – |
| 6 | **C2b** | Her Door | B05, first hide exit while Ada is in VIGIL | 11 s | full | S |
| 7 | **C3a** | Six Thousand Nights | B06, first `peek_grate` before `c3_done` | 16 s | full | M |
| 8 | C3 | He Looks Up (unchanged; optional window rain later) | as now | 12.5 s | look | – |
| 9 | **C3b** | When He Rang | B08, first bell pull the brain answers `lured` | 16 s | full | M |
| 10 | **C4a** | The Door Gives | B08 → B09, `ada_boards_pried` | 13 s | full | S |
| 11 | **F1** | Tuesday, the 6:10 (11 Oct 1976, ~8 p.m.) | B09, first `take_locket` | 32 s | full | L |
| 12 | C4 | HemOverlay (unchanged) | brain `dress` | overlay | none | – |
| 13 | **F2** | What the Water Keeps (11 Oct 1976, ~10 p.m.) | B10, hatch: first of `listen_hatch`, look at the hatch, or reach for a can | 24 s | full | M |
| 14 | **C4b** | The Twelfth Can | B10, 0.3 s after `b10:can_plate_seen` (or before the first can pickup) | 15 s | full | M |
| 15 | **C4c** | She Remembers | B11, the brain's FINALE `take` phase | 11 s | full | S |
| 16 | C5 | Your Knock (upgraded, +0.8 s) | as now | 33.8 s | full | S |
| 17 | **C5b** | Rocking | B12, first `b02:at_door` (T_B02_PORCH) after `harlan_taken` | 14 s | full | S |
| 18 | C6 | Blue Hour (upgraded, +4 s) | as now; done → C6b | 32.5 s + gates | full | S |
| 19 | **C6b** | Bait | C6 → C6b → C7 | 13 s | full | S |
| 20 | C7 | The Keeping (upgraded, +1 s) | as now | 35 s | full | S |
| – | death | (unchanged, never skippable) | catch | 3 s | full | – |

New content is about 204 s; upgrades add about 6 s. The heaviest stretch is B10, where F2 and C4b total 39 s. That is
intended: B10 is the truth beat, Ada is upstairs, and the two cutscenes have separate triggers so the player gets
control in between.

---

## 3. Cutscene specs

Conventions are those of `docs/CUTSCENES.md`. Positions are PLAN space (x east, y north, z up; ground floor 0.6,
upper floor 4.1). Lens → vertical fov (24 mm gate): 24 mm = 53°, 35 mm = 38°, 50 mm = 27°, 85 mm = 16°,
100 mm = 13.7°, 135 mm = 10.2°.

"DOF" applies on Medium and Max only. On Low, a rack focus becomes a cut, and macro focus distances are held at 0.35 m
or more (§5).

`L_CS_KEY` is the one new cutscene-only point light. It is created at load with intensity 0, shadow-casting on
Medium/Max, and prewarmed (§5). It plays every candle, match and lamp in the new cutscenes, so no new light variant
ever compiles mid-game.

### C0: County Road 9 (title cinematic), 30 s, cost M

**Placement.** `Story.start()` plays C0. Its done starts C1, which then has no fade-in (match-cut). Skip goes straight
to C1.

**Purpose.**
- The engine's showcase before the first input: rain, fog, headlights in wet air.
- Sets the date ("Tuesday, 11 October 1994").
- The title here mirrors C7's end card.
- Low fuel at night is still what opens the game.

| t | Camera | Action | Light / sound |
|---|---|---|---|
| 0–3 | black | Card (small): "Tuesday, 11 October 1994" at 0.8–2.8 | rain fades up, `thunder_distant` at 1.2, score drone |
| 3–9 | macro at the flooded ditch: eye (19.5, −28.6, 0.12) → (19.0, −28.6, 0.14), target (24, −30.0, 0.3); 100 mm; DOF 0.35 m on rain rings | Rain rings on black water. At 6 s two headlight glows bloom in the fog to the east (vehicle track x 62 → 36 on y −30.2, heading π). | `L_HEADLIGHT_L/R` on; `taillights` on; tyres on wet asphalt (`tyres_gravel` lowpass, rate 1.3) |
| 9–13 | `space:'car'`: wheel height (−1.6, 0.9, 0.35) → (−1.6, −0.2, 0.4), target (−0.8, 1.9, 0.55); 24 mm; motion blur (Max) | Water sheets off the tyre; lit rain slants through the headlight. Treadmill reset hidden by the cut. | `engine_idle` gain 0.5, rate 1.1 |
| 13–24 | `space:'car0'` crane on the south shoulder: (19.8, −31.8, 0.8) → (19.8, −32.2, 7.0), inOut; 35 mm; follows the car, pans west as it passes beneath | `P_REFLECTOR_4` then `_3` flare (retro-glint). The car passes the back of the NEXT SERVICES sign; its taillights recede into fog toward the warm dot of `L_LANTERN`. Card (title) "THE KEEPING" at 19.0–23.5. | lightning (low) at 16, `thunder_distant` at 18, `score_reveal` under the title |
| 24–30 | `space:'car'` push through the windscreen from the bonnet: (0, 3.2, 1.25) → (0, 0.95, 1.15), target (0, 25, 1.0); 50 → 35 mm; DOF 0.4 m on rain beads | Beads and streaks sharpen. A wiper sweep at 29.4 hard-cuts to C1 t = 0 (the wipers are already running there). | `windshield_rain` on, `wipers` period 1.4, `dash` fuelNeedle −0.05 with fuelLamp on; muffled radio static; letterbox throughout |

- **Characters / clips:** none. The sedan uses the existing vehicle track.
- **New assets:**
  - sequencer camera space `car0` (anchored to the vehicle pose at the shot's start);
  - TSL rain-ring normals on the ditch and puddle water (materials lane; reused by C5b);
  - a retro-glint uniform on the reflector material.
- **Voice:** none.
- **Realism tricks:**
  - Night, fog and rain hide everything unlit; only wet specular highlights read.
  - The car is seen only small, partly framed, wet, or through motion blur.
  - The fog wall hides treadmill seams.
- **Skip:** after the first view, straight into C1.

### C1: Empty (upgraded), 54 s, cost S

- When C0 played, drop the fade-in so the wiper match-cut holds.
- DOF on the dash inserts (needle, chime).
- Max: motion blur on the road POV shots.
- Add an anamorphic-style horizontal bloom streak on `L_LANTERN` only *if* it is a cheap threshold-streak pass in our
  own TSL (stretch goal; otherwise skip).
- No timing or beat change.

### C2a: Eleven Names, 9 s, cost S (optional)

**Placement.** B03, the first `read_guest_book` interaction. Plays before the document page opens; the page then opens
as now. The pre-C2 tableau stays as it is (no AI involved).

**Purpose.**
- Plants three things at once: eleven names ruled through, tonight's blank line (which C7 fills with HARLAN), and the
  groom's knifed-out face.
- Points the player at the first door on the right.

| t | Camera | Action | Light / sound |
|---|---|---|---|
| 0–3.5 | eye (2.95, 4.25, 2.0) → (2.90, 3.95, 1.9), target `P_GUEST_BOOK` (3.33, 4.10, 1.40); 50 mm; DOF on the ink, `P_CANDLE_HALL` flame as foreground bokeh | Pan down the page: ruled-through names, then the bottom line, "Oct 11 '94", with name and vehicle blank. | `L_CANDLE_HALL`; `paper` sfx at 1.0; voice `c2a:book` at 1.6 |
| 3.5–6.5 | eye (2.6, 3.6, 2.0), target `P_PORTRAIT` (3.58, 2.90, 2.05); 85 mm; rack focus 0.6 → 1.2 m | The wedding portrait: the bride in the ivory dress, the groom's face cut out. Lightning through the transom at 5.0 rakes the glass. | lightning 0.6 at 5.0; `thunder_near` at 6.2 |
| 6.5–9 | low from (2.4, 2.0, 1.7); target travels `P_BOLT_BOX` (1.8, 0.1, 3.42) → `P_PULLEY_2` → `P_PULLEY_3` (3.5, 1.5, 3.7); 24 mm; cut to the player's eye at 8.6 | Follow the rope to where it vanishes above the ajar parlor door. | `rope_pulleys` gain 0.15 (creak) |

- **Clips:** `arms_pickup_read` (existing, from the gameplay read).
- **New assets:** none.
- **Voice (new):** `c2a_names`, driver: `[reading under his breath] Eleven... all crossed out. [swallows] And today.`
- **Realism tricks:** candlelight with flame bokeh; paper and ink at 50 mm; a moving lightning specular on glass;
  characters never in frame.

### C2: The First Room on the Right (render-only upgrade)

- Content, timing and the client's beat are unchanged.
- Add a DOF focus pull from the raised cleaver edge (~1.3 m) to Ada's clouded eye at the eye close-up (DOF values are
  already uniforms).
- `dust_sift` at `P_PULLEY_2` during the rope whip-pan.
- Max: motion blur on the whip-pan.

### C2b: Her Door, 11 s, cost S

**Placement.**
- B05: the first hide exit after `first_hide_done`, with the brain in VIGIL at `U_VIGIL` (3.2, 8.2, 4.1).
- Brain `freeze` at start, `resume` at end with a 2 s deaf grace.
- Dropped if she is not in VIGIL.

**Purpose.**
- Makes the stealth set-up an image: the monster shut out of her own room.
- Plants the nailed door (B08) and the dress (B09).

| t | Camera | Action | Light / sound |
|---|---|---|---|
| 0–3 | player's eye at the armoire mouth (~2.9, 4.9, 5.75), soft steer to D_ADA (3.675, 8.20, 5.10); 35 → 50 mm; handheld 0.4; DOF on Ada (~4 m); flashlight forced to 0.15 | A black shape at her door. Lightning through the south window behind the player at 1.0 throws the balusters' shadow bars up the runner and across her back. | lightning `L_LTN_U1S` 0.7 at 1.0; `ada_scrape_wood` |
| 3–7 | macro: eye (3.35, 7.85, 5.45), target the middle board's nail head (3.62, 8.15, 5.30); 100 mm; DOF 0.3 m; her hair edge soft at the top of frame, **face never in frame** | Grey fingertips scrape around a square nail head; water runs down the grain. She whispers. | cool rim only (runtime light set 0.15); scrape close; voice `c2b:vigil` at 4.0 |
| 7–9.5 | floor level: eye (3.1, 7.55, 4.22), target her right foot (3.45, 8.0, 4.15); 85 mm | Water gathers from the gown hem into a footprint on the runner (existing footprint decal). Forehead knock on the wood at 8.4. | `knock` gain 0.3 at 8.4; `ada_drip` |
| 9.5–11 | cut to the player's eye at the armoire | Release. | brain resume (deaf grace 2 s) |

- **Clips:** `ada_vigil` (existing loop), `arms_breath_hold` → `arms_idle` (existing).
- **New assets:** none.
- **Voice (new):** `c2b_my_dress`, ada: `[barely a whisper, forehead against the wood] ...my dress...`
- **Realism tricks:**
  - Lit for one 0.4 s flash, otherwise a silhouette.
  - The macro shows only hands and feet (her atlas holds up there).
  - Her stutter sampling hides the loop.

### C3a: Six Thousand Nights, 16 s, cost M

**Placement.**
- B06: the first `peek_grate` before `c3_done`. Harlan is outside at this point, so the parlor is empty.
- Safety gate (§4), with `freeze`. If it fails, it waits for the next peek; dropped once `c3_done` is set.
- Ends exactly in the existing grate view.

**Purpose.**
- The only full, still, lit view of the parlor: about six thousand pencil tallies, the hand ageing column by column,
  and the empty rocker still rocking.
- Makes the grate a place to come back to, where C3 then puts Harlan.

| t | Camera | Action | Light / sound |
|---|---|---|---|
| 0–2.5 | player's eye kneels to `parlor_grate` (6, 3.2, 4.55), target (6.9, 4.7, 1.5); 35 mm; rack focus from the lattice (0.15 m) to the floor (3.5 m) | The iron scrollwork is sharp, then the candlelit room appears through it. | `rocking_chair` loop (room G2) |
| 2.5–7 | inside the parlor: crane (6.0, 3.2, 3.55) → (6.4, 4.2, 1.85), target sweeps to the tally wall (north, y ≈ 6); 35 mm | Descend through candle haze to the wall: thousands of strokes in groups of five. | `L_CANDLE_TABLE`, `L_CANDLE_MANTEL` flicker; low drone |
| 7–11.5 | macro lateral dolly (5.0, 5.55, 1.6) → (7.6, 5.55, 1.5), target held 0.45 m ahead; 100 mm; DOF 0.45 m | Graphite strokes with a soft sheen; the hand gets older and shakier column by column. The last group stops at four strokes: tonight is not there yet. | flicker raking the wall |
| 11.5–14.5 | low wide behind the rocker: eye (8.2, 5.6, 1.0), target `P_ROCKER` (7.4, 4.95, 1.2), pan to `P_SAWBUCK` | The rocker rocks with nobody in it. The rubber sheet glistens; `P_CLEAVER` lies on the table. | `rocking_chair`; `sink_drip` gain 0.3 at `P_BUCKET`; voice `c3a:count` at 13.0 |
| 14.5–16 | cut to `parlor_grate` | Release at the grate. | brain resume |

- **Clips:** none. The empty rocker uses the existing procedural rocking. Arms are hidden for the inside shots.
- **New assets:** a procedural TSL tally layer on the tally wall surface (materials lane):
  - five-stroke groups hashed per cell, graphite sheen through roughness, a per-column age wobble;
  - holds up at 0.45 m on every tier with no texture download;
  - also used by C2's background and C7's fresh column.
- **Voice (new):** `c3a_count`, driver: `[a whisper] Every night... [breath] years of nights.`
- **Realism tricks:**
  - Resolution-independent shader strokes over a low-frequency lightmap.
  - One moving thing in a still frame reads as a photograph.
  - Candle falloff hides the room's edges.

### C3: He Looks Up

Unchanged. Stretch goal (M6): a rain-on-glass layer on the east window, reusing `windshield_rain`'s CPU droplet sim
on a window-sized quad.

### C3b: When He Rang, 16 s, cost M

**Placement.**
- B08: the first bell pull the brain answers with `lured`, while she is in VIGIL. A `queued` answer, any other state,
  or CHASE: no cutscene.
- The cutscene takes Ada as scripted and releases her straight into LURED at `G_PARLOR_LURE` (3.2, 1.5).
- **The lure window (60/50/40 s) starts at the end of the cutscene.**

**Purpose.**
- Teaches the lure as a picture: wire, cranks, the parlor bell, Harlan letting her come.
- Two 0.6 s flashes of the *living* Ada running down the same stairs to the same bell in 1976 ("when he rang, she
  came") put guilt on every later pull.

| t | Camera | Action | Light / sound |
|---|---|---|---|
| 0–2 | macro: eye (5.7, 4.0, 5.3), target `P_BELL_PULL` (6.10, 4.46, 5.05); 85 mm | Your glove releases the embroidered pull; the wire jerks up into the ceiling. | `L_LAMP_U2` key; `bell_pull` |
| 2–4 | U1 ceiling: eye (2.2, 6.5, 5.2), target `P_BELL_CRANK_3` (3.52, 8.95, 6.88) then along the wire; 50 mm; DOF on the crank | The crank jumps and the wire runs; dust sifts down. | `bell_run` fx; `dust_sift`; crank clack (`bell_knob` rate 0.7) |
| 4–7 | parlor, low behind the rocker: eye (8.0, 5.4, 1.35), target `P_SPRING_BELL` (3.85, 1.45, 3.40); 35 mm; DOF on the bell; **the back of Harlan's sack** as a near-foreground silhouette | The spring bell jangles above the door. Harlan rocks and does not turn. | `spring_bell_loop`; `rocking_chair`; candle flicker |
| 7–7.6 | **flash-frame**, memory look (warm, gate): 1976 POV at the stair top (0.55, 8.20, 5.60) rushing down; 24 mm; handheld 2; motion blur | The same stair, lamp-lit. | `L_CS_KEY` as a hall lamp at (1.6, 4.5, 2.7); clean bell (`spring_bell` rate 1.1); voice `mem:harlan_calls` at 7.05 |
| 7.6–11 | foot of the stair, low: eye (1.2, 3.2, 0.75), target up the stair (0.55, 5.0, 1.6); 50 mm; **ankles only** | Grey bare feet come down the last four risers (move track (0.75, 4.25, 1.36) → `G_STAIRFOOT` (0.9, 3.2, 0.6); `ada_stairs_down`); the hem drips on each tread; a hand slides on the banister at the top of frame. | `ada_slap` per step, `ada_drip`; the bell continuing |
| 11–11.6 | **flash-frame**, warm: 1976 POV at D_PARLOR, eye (2.90, 1.60, 2.15) | A bare hand knocks twice, softly (no arms in frame: the knock is heard, the door fills the frame). | `knock` gain 0.4 ×2; voice `c3b:coming` at 11.2 |
| 11.6–15 | hall, just inside the front door: eye (1.9, 0.5, 1.7), target D_PARLOR (3.675, 1.65, 1.6); 35 mm | Her silhouette at the parlor door, forehead to the wood (`ada_vigil`); candlelight leaks under the door around her feet. The bell dies at 13.5. | `ada_scrape_wood`; the brain voices `ai:lured_arrive` itself after release |
| 15–16 | cut to the player at the bell pull | Release; LURED; the window starts now. | – |

- **Clips (all existing):** `ada_vigil`, `ada_stairs_down`, `harlan_seated` (loop), `arms_bell_pull` (tail).
- **Place cues:** Ada is placed on the stair at 7.55 (off camera, under the flash-frame) and at `G_PARLOR_LURE` at
  11.55.
- **New assets:** `bell_run` fx (the four `P_BELL_CRANK_*` rotate a few degrees in sequence and spring back).
  Reuses the memory look (§5) and `dust_sift`.
- **Voice (new):**
  - `mem_harlan_ada`, harlan, 1976, no sack, distant through the floors: `[calling up the stairs, flat, unhurried] Ada.`
    Also cued in F1.
  - `c3b_coming`, ada, alive: `[alive, quick, quiet, a little afraid] Coming.`
- **Realism tricks:**
  - Brass, wire and dust are sharp at long lenses.
  - Every human element is in shadow: the sack from behind, feet at ankle height (which also hides gown clipping on the
    stair clip), a silhouette against a lit gap.
  - The 0.6 s motion-blurred flash-frames cannot be scrutinised, so the 1994 set dressing in them doesn't read.

### C4a: The Door Gives, 13 s, cost S

**Placement.**
- B08 → B09: the third board drops (`ada_boards_pried`).
- If the safety gate fails, defer to the first `b09:enter_u3`, playing shots 3–4 only from the doorway. Dropped after
  20 s.
- `freeze` pauses the lure window.

**Purpose.** The door the player worked for opens by itself, rhyming with the front door. The first flash shows a
woman at the window; the second shows it is the dress on its form.

| t | Camera | Action | Light / sound |
|---|---|---|---|
| 0–2 | player's eye at D_ADA; 35 mm; handheld 0.6 | The last board falls. | `board_drop`, `nail_screech` tail |
| 2–5 | low wide from the U1 floor: eye (3.0, 7.7, 4.25), target D_ADA (3.675, 8.20, 5.10); 24 mm | The latch gives and the door swings in slowly by itself. Cold air; dust sifts from the frame; the beam becomes a solid shaft. | `door D_ADA open` slow; `door_creak`; `dust_sift`; volumetric beam on (Medium and Max inside cutscenes); wind loop (U3) |
| 5–8 | over the shoulder through the doorway: eye (3.4, 8.2, 5.7), target `P_DRESS` (8.15, 7.2, 4.9); 50 mm | Dark. Lightning through `O_U3_E` at 6.0: a slight woman stands at the window, perfectly still. | lightning `L_LTN_U3E` 1.0 at 6.0 (Max uses the U3 flash lightmap); heartbeat 120; gasp sfx at 6.2 |
| 8–11 | dolly (4.2, 7.6, 5.4) → (5.6, 7.4, 5.2) past `P_SHEET_CHAIR`, `P_SHEET_TREADLE`, `P_SHEET_TRUNK`, target `P_DRESS`; 35 mm; motion blur (Max) | Second flash at 10.0: it's the wedding dress on its form, the sheet slid off one shoulder, hem exposed. | lightning at 10.0; `thunder_near` at 11.4; heartbeat 95 |
| 11–13 | cut to the player in the doorway | Release. | brain resume; lure timer resumes |

- **Clips:** `arms_pry_board` tail → `arms_idle`.
- **New assets:** none beyond the shared `dust_sift`.
- **Voice:** none.
- **Realism tricks:**
  - A misread silhouette costs no character.
  - Volumetric beam through real dust particles.
  - Sheeted cloth is easy to make look real.

### F1: Tuesday, the 6:10 (flashback, 11 Oct 1976, ~8 p.m.), 32 s, cost L

**Placement.**
- B09: the first `take_locket` (`onLocket`).
- `freeze`, with the safety gate. If it fails, the locket is simply taken and F1 is dropped.
- F1 plays before the brain's `dress` visit. Its last cue is the drip returning on the landing, which is where the
  dress visit already starts.

**Purpose.**
- The game's emotional core. The player has just cut open what she sewed; now they watch her sew it, the night before
  the bus, until his bell calls her down.
- The needle she left hanging is still in the hem in 1994.
- C4 (her hand on the cut hem) and the finale then land on someone the player has seen alive.

| t | Camera | Action | Light / sound |
|---|---|---|---|
| 0–3.5 | player POV, `arms_raise_locket` → `arms_locket_hold`; DOF on the `locket` socket (0.42 m); 85 mm | The water-bloomed photo, soft: a young man's eyes and jaw, the rest gone. | `locket_click`; the score drops away |
| 3.5–5 | push toward the photo (fov 16 → 10); DOF deliberately 3 cm short of the photo | The photo fills frame and **whites out** at 4.6 (lightning). | lightning at 4.6; `score_reveal`; under the white: grade `memory warm` on, dressing `f1976` on, `lmScale` 0.45 |
| 5–11 | 1976, extreme macro on the hem: eye (7.90, 7.60, 4.45), target (8.15, 7.20, 4.30); 100 mm; DOF 0.4 m; handheld 0.4 | A needle draws ivory thread through satin and closes a small pocket over a folded bus ticket and a locket. Warm fingertips at the frame edge, out of focus. | `L_CS_KEY` candle, low, at (7.90, 5.60, 4.40), shadow-casting; rain on the window (the same storm); thread whisper (`shears` rate 2, gain 0.2) |
| 11–18 | wide on the north wallpaper: eye (5.0, 5.5, 5.4), target (7.4, 9.1, 5.0); 35 → 50 mm slow push | Her shadow, huge on the wallpaper, bent at the hem, sewing. Ada's body is out of frame (fallback: shadow-only material, §5). She whispers. | voice `f1:tuesday` at 13.0 |
| 18–21 | hold on the shadow | Far below, a bell. The shadow freezes. A man's voice, once. | `spring_bell` rate 1.1 (room G2, lowpass) at 18.2; voice `mem:harlan_calls` at 19.4 |
| 21–25.5 | needle macro: eye (7.95, 7.55, 4.35), target (8.15, 7.20, 4.25); 100 mm; behind it, the shadow straightens and leaves | The needle hangs on its thread, swinging. D_ADA opens (no boards in 1976); the draught leans the candle flame, and it gutters. | `door D_ADA open`; `door_creak`; `L_CS_KEY` gutter 1.2 s |
| 25.5–28 | from the U3 doorway: eye (3.9, 8.6, 4.35), target the runner (2.2, 8.2, 4.15); 50 mm; **ankles only** | Bare feet (warm tint, dry) step onto the runner and turn toward the stairs, toward the bell. | `ada_stairs_down` feet; the bell still ringing; `thunder_near` at 27.5 |
| 28–32 | white-out at 28.0 → 1994, the same needle macro | The same needle in the hem: rusted, a cobweb strand on the thread, dust on the satin. Normal grade. Far off on the landing, a drip begins. | lightning at 28.0; under the white: dressing `f1976` off, grade reset, `lmScale` 1; `ada_drip` (U1) at 30.5 |

- **Clips:**
  - `ada_dress` (existing) at 0.5×, looped over 0.9–2.0 s, seen only as a shadow.
  - `ada_stairs_down` (existing), feet only.
  - Ada's "living" material state (warmer, dry) is used only at the frame edge or out of focus.
  - **Optional new clip `ada_sew_shadow`** (blender-anim, §6). If it does not exist, the fallback is `ada_dress`.
  - Arms: `arms_raise_locket`, `arms_locket_hold` (existing).
- **New assets:**
  - runtime needle and thread (a thin cylinder plus a TubeGeometry thread on a 6-point verlet chain, rusted variant in
    1994), parented to the dress so it is present in gameplay from B09 on;
  - dressing `f1976` for U3/U1: boards off D_ADA, cobwebs and dust decals hidden, `P_SHEET_*` hidden only out of frame;
  - Ada `living` uniform.
- **Voice (new):** `f1_tuesday`, ada, alive: `[a tired, private whisper, almost smiling] Tuesday... six-ten. [breath] Just Tuesday.`
- **Realism tricks:**
  - Her face is never on screen: a shadow, fingertips, feet.
  - Candlelight on satin at 100 mm.
  - The stormy-night lightmap is correct for that night too, and is pulled down to 45 % so the warm key dominates.
  - Lightning white-outs hide every dressing swap.
  - The 1976/1994 needle match is the device that sells it.
  - The locket photo stays a soft, glare-touched blur.

### C4: HemOverlay

Unchanged. Ada's hand finds the cut hem beside the rusted needle that F1 planted.

### F2: What the Water Keeps (flashback, 11 Oct 1976, ~10 p.m.), 24 s, cost M

**Placement.**
- B10, kitchen. Triggered by the first of:
  - the `listen_hatch` interaction;
  - looking at the hatch from within 2 m (dot > 0.8 for 0.5 s);
  - reaching for any jerry can (it then plays before the pickup completes).
- `freeze`, with the safety gate (Ada is upstairs in B10). If it fails, it is dropped.

**Purpose.**
- The murder, shown without being shown: lightning cuts between the splintered, padlocked hatch in 1994 and the same
  hatch in 1976 with Harlan's rubber boots standing on it and knocks from beneath.
- The three slow knocks are the same knocks Ada gives the parlor door in C5 ("your knock").
- His line names the game.

| t | Camera | Action | Light / sound |
|---|---|---|---|
| 0–4 | low dolly from the back stair: eye (7.6, 10.4, 0.95) → (6.3, 9.0, 0.75), target the padlock on `P_HATCH` (5.5, 8.2, 0.65); 24 mm | Water wells between the boards; a drop from `P_CEILING_DRIP` falls through the beam. | `L_CANDLE_KITCHEN`; `cistern_slosh` under the floor; volumetric beam (Medium/Max) |
| 4–7.5 | macro: eye (5.95, 8.55, 0.85), target the hasp (5.5, 8.2, 0.66); 100 mm; DOF 0.4 m | A rusted padlock locked on the OUTSIDE; planks splintered upward from beneath. A drip lands on the lock. | `drops` fx; heartbeat 85 |
| 7.5–14 | white-out → 1976 at the same height: eye (6.2, 8.9, 0.7), target (5.5, 8.2, 0.9); 50 mm; **knees down** | The hatch is whole (the `-intact` variant), with a new padlock open in the hasp. Two black rubber boots step onto the lid; water runs off the apron hem. From below: three knocks, muffled by water. Bubbles through the gaps. | lightning at 7.5; grade `memory cold`; dressing `f1976_g3` on; `lmScale` 0.45; `knock` ×3 lowpass 600 Hz at 9.5 / 10.6 / 11.7; `hatch_bubbles` |
| 14–18 | macro on the hasp, 100 mm: eye (5.9, 8.5, 0.8), target (5.5, 8.2, 0.66) | The shackle snaps shut. A low voice through the boards. Then two knocks, weaker. Then none. | `latch` (rate 1.3) at 14.4; voice `f2:keep` at 15.0; `knock` ×2 lowpass at 16.6 / 17.4 |
| 18–21 | white-out → 1994, the 4–7.5 macro | One heavy thump from beneath: the lid jumps against the lock and water spits from the gaps. | lightning at 18.0; dressing off, grade reset, `lmScale` 1; `hatch_thump` at 19.2; `hatch_jolt` (2 mm) |
| 21–24 | the player's eye, lowered 0.4 m (kneeling), on the padlock; 50 mm → settings | The same padlock in your beam. Upstairs, the drip starts again. Release. | `ada_drip` (far, U1) at 22.5 |

- **Clips:** `harlan_pose_stairs_foot` (existing static pose), placed on `P_HATCH` and framed knees-down (boots, apron
  hem; the newel hand is out of frame). Harlan is hidden again at 18.0. No Ada on screen: she is sound only. Arms are
  hidden for 7.5–18.
- **New assets:**
  - `P_HATCH` `-intact` node and a separate `-shackle` node (blender-props, §6);
  - `hatch_bubbles` fx (sprites plus a wet-sheen pulse);
  - `hatch_jolt` fx (a small transform shake);
  - a 1976 padlock material state (rust uniform 0);
  - dressing `f1976_g3` (Harlan placed on the hatch, intact variant shown).
- **Voice (new):** `f2_keep`, harlan, 1976, no sack, close and low, muffled by boards and water:
  `[barely a whisper, to the boards, almost gentle] Hush now. [breath] There. You'll keep.`
- **Realism tricks:**
  - The killer is only boots; the victim is only sound.
  - The same composition across 18 years makes the eye compare the details (new lock against rusted lock), which
    reads as real continuity.
  - Wet boards, rust and chalk in macro.
  - The can row's baked contact shadows stay out of every 1976 frame.

### C4b: The Twelfth Can, 15 s, cost M

**Placement.**
- B10: 0.3 s after the existing `b10:can_plate_seen` line. If the player takes a can without having seen the plate,
  C4b plays first and opens with the chalk insert plus that line.
- `freeze`, with the safety gate.
- The cutscene borrows Harlan from the rocker and Ada from wherever the brain has her upstairs, off camera, and puts
  both back exactly (position, heading, clip, brain state).
- The pickup and the nonstop bell then proceed as today.

**Purpose.** The twist, made visible. Tonight's arrival, seen from Harlan's side: the bait lantern lit, your ring on
his bell, his hands taking the rope off the cleat, and the beheading seen over his shoulder as he turns her face toward
a doorway that holds only your flashlight.

| t | Camera | Action | Light / sound |
|---|---|---|---|
| 0–1.5 | player's eye → the chalked RVX-318 on `P_JERRY_12` (3.98, 8.755, 0.90); 50 mm; DOF on the chalk; slow push | The chalk is fresh. | heartbeat 90 |
| 1.5–3.5 | EXT1 macro: eye (−1.40, −29.00, 2.10), target `P_SIGN_LANTERN` (−1.80, −28.45, 2.05); 85 mm; DOF on the wick | A match flares; the lantern catches (`L_LANTERN` 0 → 1). Below, out of focus, a sack-headed silhouette looks up at it (Harlan `harlan_pose_look_up` at (−1.6, −28.0, 0.0)). | `match` sfx; `L_CS_KEY` match flare; rain; `vacancy_creak` |
| 3.5–5 | parlor, low: eye (4.40, 2.60, 2.30), target `P_SPRING_BELL`; 60 mm | The spring bell jangles: **your** ring. | `spring_bell` (the exact sample B02 played) |
| 5–6.5 | eye (4.30, 1.60, 2.40), target `P_CLEAT` (3.80, 1.90, 2.20); 55 mm | Black rubber gloves lift the rope off the cleat (`rope_run open`; the sheaves spin). D_FRONT opens off screen. | `rope_pulleys`; `latch` + `door_creak` (off, G1) |
| 6.5–10 | behind Harlan's right shoulder: eye = `HARLAN_TABLE` (4.85, 3.28) + (−0.6, −0.5), z 2.45, target the `parlor_threshold` eye (3.42, 1.50, 2.22); 42 mm; **DOF on the doorway (~3.2 m)**, so the sack and her hair are huge soft foreground shapes | The C2 tableau in reverse: `ada_opening` and `harlan_opening` from the head-turn (clip cue `at` ≈ 4.5 s). His glove turns her face to the doorway by the hair. The doorway holds **only a blinding flashlight**: the player SpotLight posed at the threshold, aimed in, volumetric (Medium/Max), with a bloom streak. He whispers. | `L_CANDLE_TABLE` shadow-casting; three heartbeats; voice `c4b:look` at 7.6 |
| 10–11.5 | cleat insert (as at 5.0) | The rope slips from his glove. | rope zip; `door_slam` + `bolt_drop` (off) |
| 11.5–13 | `c7_guest_book` lens: eye (2.85, 4.10, 2.15), target `P_GUEST_BOOK` | "Oct 11 '94", name blank: the line waiting for you. | rain |
| 13–15 | back in the kitchen on the can | A ceiling drop lands on the chalk and smears it. Through the wall, the rocking stops; a slow breath through burlap. Release. | `rocking_chair` stops; `sack_breath` (G2) |

- **Clips (all existing):** `harlan_pose_look_up`, `harlan_opening` and `ada_opening` (with `at` offset),
  `harlan_seated` (restored).
- **New assets:**
  - clip cue `at` (start offset): `CharacterDirector.play` already takes `at`; only `types.ts` and the host need the
    field;
  - `threshold_glare` fx (poses the flashlight SpotLight; bloom streak);
  - `match_flare` (`L_CS_KEY` driven as a 0.6 s flare curve);
  - `match` synth sfx.
- **Voice (new):** `c4b_look`, harlan, through the sack: `[a slow whisper into her hair] Look, Ada. [breath] Look at that one.`
- **Realism tricks:**
  - Cuts of 1.5–3.5 s hide clip limits.
  - The traveler is a light source, never a body.
  - Every other shot is a real prop in macro.
  - Faces are hidden by the reverse angle: we see the back of the sack and the back of her hair.

### C4c: She Remembers, 11 s, cost S

**Placement.**
- B11, when the brain's FINALE reaches `take` (she has looked at the lit locket at arm's length).
- It replaces the 0.8 s gameplay take with an authored version. The brain is paused and resumes at `finale_carry` with
  the locket on `prop_l`.
- No safety gate: it is the finale. On skip, the state cues still reparent the locket.
- C5 then plays as today.

**Purpose.**
- Pays off the flashbacks in one breath: the locket sharp in the beam, her face soft behind it, 0.4 s memory flashes as
  her fingers close.
- One tender, terrible line, just before C5's violence.

| t | Camera | Action | Light / sound |
|---|---|---|---|
| 0–2.5 | player POV (`arms_locket_hold`); DOF on the `locket` socket (0.42 m), band 0.05; 30 → 26° | Her face behind the locket is a blur of wet hair and one pale eye shape (`ada_look` held). | all sound drops away except the drip; her breathing stops |
| 2.5–3.3 | flash-frames, 0.4 s each (memory warm, gate): F1's needle macro; C3b's spring bell | Memory. | thread hiss; clean bell |
| 3.3–5.5 | POV, 76 mm; DOF on the locket | Her grey left hand enters the beam (`ada_finale_take` at 0.5×; the reach lands at clip 0.45 s) and closes over it. The chain slides from your glove; the locket reparents to her `prop_l`. | chain slither; `locket_click` |
| 5.5–6.3 | flash-frames (memory cold): F2's boots on the hatch; the 1994 padlock | Memory. | a bubble burst; rain |
| 6.3–9 | POV, 26°, DOF on her fist at her chest | She draws the locket to her breastbone and lowers her head. A drop from her hair lands on your glove. She whispers. | voice `c4c:there` at 7.2 |
| 9–11 | locked off | She turns to the parlor door (`ada_finale_carry`, 1 m move). The bell, ringing since B10, stops. Release → C5 when the player reaches the hall. | `spring_bell_loop` stops |

- **Clips (all existing):** `ada_look`, `ada_finale_take`, `ada_finale_carry`, `arms_locket_hold`.
- **New assets:** a water-drop decal on the glove. The flash-frames are re-staged cameras with dressing cues in on/off
  pairs.
- **Voice (new):** `c4c_there`, ada: `[a wet whisper, almost tender, to the photo] ...there you are.`
- **Realism tricks:** this is the design doc's own framing (in-focus locket, out-of-focus face).

### C5: Your Knock (upgraded, +0.8 s)

- A volumetric shaft through the south window for the silhouette light.
- At the front-door opening, a mist volume rolls in over the threshold at floor height.
- The single bell after the stroke uses the clean 1976 timbre (`spring_bell` rate 1.1): his bell, rung for the last
  time.
- When the rope zips: a 0.8 s insert at `P_CLEAT` of grey fingers letting the rope run (`ada_finale` held on its
  8.9 s finger-hook frame, feet out of frame).
- Leaves `blue_hour` on for C5b.

### C5b: Rocking, 14 s, cost S

**Placement.** B12: the first `b02:at_door` (T_B02_PORCH) after `harlan_taken`. Ada is hidden by the story, so there
are no AI concerns. No layout change is needed.

**Purpose.**
- The exhale: the first light that is neither storm nor candle.
- Plants the sting inside the relief: a candle catches by itself behind the parlor shutter and the rocker starts
  again. Harlan is dead, so who is in the chair? C7 answers it.

| t | Camera | Action | Light / sound |
|---|---|---|---|
| 0–3.5 | threshold onto the porch: eye (1.95, −0.55, 2.25) → (1.9, −1.8, 2.2), target (2.5, −14, 1.8); 35 mm | The open door frames grey mist; drops fall from the eave across frame. | `blue_hour` {mist 1, rain 0}; `eaves_drip` |
| 3.5–6.5 | eave macro: eye (3.2, −2.35, 2.9), target (3.2, −2.7, 3.2); 100 mm; DOF 0.4 m | A drop swells on the gutter lip, catches the pale sky, and falls. | `drops` fx; close drip |
| 6.5–10.5 | crane up and back: (1.5, −4, 1.8) → (0, −12, 7.5), target (3, −1, 2.5) → `P_CAR_ROW` (13.4, −1.6, 0.9); 24 mm | The house shrinks into the mist; nine wrecks in a grey line, your car at the near end. | `score_bird` at 7.5; `score blue_hour` |
| 10.5–12.5 | 135 mm from the porch steps: eye (2.5, −3.0, 1.7), target the parlor shutter `O_G2_S1` (5.0, −0.2, 1.6) | Behind the shutter gap, the sill candle catches by itself (`L_CANDLE_SILL` 0 → 1). A creak, then another. | `rocking_chair` ×2 (G2), slow |
| 12.5–14 | cut to the player on the steps, facing the car | Release. The rocking keeps time every 2.1 s, fading with distance. | `rocking_chair` loop, distance-attenuated |

- **Clips:** `arms_idle` (can in hand if `has_can`).
- **New assets:** the `drops` emitter along the eave (shared with F2).
- **Voice:** none.
- **Realism tricks:**
  - Overcast dawn expects no hard shadows, which hides the night bake under the `blue_hour` grade.
  - Mist erases distance detail.
  - The telephoto stacks the fog layers.
  - One warm point in a cool frame.

### C6: Blue Hour (upgraded, +4 s)

- Before the key gate, a 4 s insert:
  - the dash clock (added to the `dash` CanvasTexture) reads **6:10**;
  - your glove lays the water-stained bus ticket on the dashboard (`P_TICKET` clone on `prop_r`, `arms_pickup_read`
    reversed).
  - You leave at ten past six on 12 October, the bus she never caught. No line.
- The rear-view mirror shot shows the parlor shutter candle lit (continuity with C5b).
- On done → C6b (it used to go to C7).

### C6b: Bait, 13 s, cost S

**Placement.** C6 → C6b → C7. Carries the time card.

**Purpose.** "Whoever holds the rope keeps the house", shown before C7 states it, so the sting confirms a fear instead
of arriving from nowhere.

| t | Camera | Action | Light / sound |
|---|---|---|---|
| 0–2 | black | Card (small): "Three weeks later" | rain returns (`weather` 1.0); `thunder_distant` |
| 2–6 | EXT1 macro: eye (−1.30, −29.20, 1.90), target `P_SIGN_LANTERN`; 85 mm; DOF on the glass | A grey, wet hand (`ada_finale_take` held at 0.45 s, root raised so only the left hand is in frame) at the lantern. A match flares; water from her fingers hisses on the hot glass; the wick catches. | `match`; `sizzle`; `L_LANTERN` 0 → 1 with flicker; `L_CS_KEY` flare |
| 6–8.5 | wide, low: eye (−3.50, −31.50, 0.50), target (−1.80, −28.50, 1.80); 35 mm | The ROOMS board and VACANCY plate creak under the relit lantern. No one is there. Fresh bare wet footprints glisten up the gravel toward the gate. | `vacancy_creak`; rain on gravel |
| 8.5–11 | parlor: eye (4.40, 2.30, 2.40), target `P_CLEAT`; 60 mm; the tally wall's fresh clumsy column (dressing `sting`) in bokeh | Grey fingers (`ada_finale` held at 8.9 s) test the rope and make it fast on the cleat. A whisper. | rope creak; `L_CANDLE_TABLE`; `rocking_chair` once; voice `c6b:company` at 9.8 |
| 11–13 | black | → C7 (the dashboard, fuel lamp blinking). | rain |

- **Clips:** `ada_finale_take` and `ada_finale`, each held on one frame (clip cue `at` plus speed 0).
- **New assets:** `footprints_path` (the existing footprint decals laid along an authored path).
- **Voice (new):** `c6b_company`, ada, imitating his cadence: `[a wet whisper, patient] ...Company.`
- **Realism tricks:** hands only, in macro, against a match flare and candle bokeh; the empty wide shot lets the
  footprints imply her.

### C7: The Keeping (upgraded, +1 s)

- Core unchanged.
- When the door opens by itself, a 1.0 s cut to the parlor cleat (grey fingers let the rope run), then back to the
  existing hall shot.

### death

Unchanged: 3 s, never skippable.

### Faces-hidden audit

| Cutscene | Who could show a face | Why it can't |
|---|---|---|
| C2b | Ada | silhouette, then a nail macro framed below her hairline, then a foot |
| C3b | Harlan, Ada | the back of the sack only; Ada's ankles; a silhouette at the door; flash-frames are POV |
| F1 | Ada (1976), Harlan photo | shadow, fingertips and feet only; the photo is a soft, glare-touched blur (the allowed exception) |
| F2 | Harlan (1976) | knees down |
| C4b | both | reverse angle: the back of the sack and the back of her hair, both in bokeh |
| C4c | Ada | the design's own out-of-focus face behind the locket; on Low (no DOF), the beam's glare plus a 26° crop keeps her at hair and eye shape |
| C6b, C5 insert | Ada | hands only |

QA must capture each of these shots on Low, Medium and Max (scripts/qa when it is free) before shipping.

---

## 4. AI and pacing rules (story-ai lane)

- **Brain `freeze` / `resume`** is a new scripted op.
  - It holds position and state and pauses every timer: lure window, grace, search, listen, hearing queue.
  - Clip sampling keeps going.
  - `resume` adds a 2 s deaf grace.
  - It is never entered from CHASE, LOOK, INVESTIGATE or SEARCH.
  - A save or death during a frozen cutscene restores the brain unfrozen.
- **Safety gate** for C2b, C3a, C4a, F1, F2 and C4b:
  - Ada is not in CHASE, LOOK, INVESTIGATE or SEARCH;
  - and she is at least 6 m away by room graph, or behind a closed door or a floor.
  - Otherwise wait up to 20 s, then drop the cutscene; the document or VO still plays as today.
- **C3b** takes Ada as `scripted` and releases her straight into LURED. The lure window starts at the cutscene's end.
- **C4b** snapshots Ada and Harlan before and restores them exactly after, including on skip.
- **C4c** is part of FINALE: the brain pauses at `take` and resumes at `finale_carry`.
- **Chains:** `start → C0 → C1`; `C6 → C6b → C7`.
- **Flags:** one per cutscene (`cs_<id>_done`), persisted, so nothing replays after a death or respawn.
- **Kitchen order:** F2 and C4b have independent triggers. If both fire in the same frame, F2 first, then C4b after
  1.5 s of control.
- **Pacing budget:**
  - At most one new full-lock cutscene per 45 s of gameplay in B05–B10; a second trigger in that window waits (the
    20 s rule).
  - If playtests show B08–B10 dragging, cut in this order: C3a, C2a, C0 (C0 behind a story flag, default on).

---

## 5. Cutscene render profile

Cutscenes have controlled views, so they can afford more than gameplay. All of these apply only while the cutscene
player owns the camera and are restored on release.

| Setting | Low | Medium | Max |
|---|---|---|---|
| Pipeline | direct (no post chain) | post chain | post chain |
| sceneScale / dynamic res | 1.0 (unchanged) | 0.75 → **0.9**, held fixed | 0.667 → **0.85**, held fixed |
| DOF and rack focus (`dof` cue with `to`/`over`) | off: a rack becomes a cut; macros hold focus ≥ 0.35 m | **on** | **on** |
| Motion blur | off | off | **on** (`bindings.ts` passes only `{dof}` to `pipeline.setCutscene` today; wire `motionBlur` through) |
| Volumetric flashlight beam | off | **on in C4a, F2, C4b only** | on |
| Lightning flash lightmaps | – | – | on (as in gameplay) |
| Bloom streak (threshold glare) | – | on | on |
| Dust particles (`dust_sift`) | 120 | 250 | 400 |
| Letterbox 2.39:1 | DOM bars | DOM bars (render only the band if the r186 pass supports viewport/scissor; verify in `node_modules/three/src` first) | same |
| Memory look (flashbacks) | **CSS `filter` on the canvas** (sepia, saturate, contrast) + DOM gate + DOM grain canvas | pipeline uniforms: saturation 0.55–0.6, warm (1.06, 0.97, 0.86) or cold (0.86, 0.95, 1.05) tint, grain ×1.6, vignette 0.6 + DOM 4:3 gate with ±0.6 px weave | same as Medium |
| `lmScale` (lightmap intensity multiplier) | yes (a material uniform, works without post) | yes | yes |

The memory look extends the existing `blue_hour` tint and saturation uniforms into a `grade` cue
(`{tint, saturation, grain, vignette, fade}`).

**Frame-time guard:**
- If a cutscene frame averages more than 40 ms over 1 s, step back to the gameplay scale and disable the volumetric
  beam for the rest of that cutscene.
- The QA tool records cutscene frame times per tier.

**Prewarm:** created at load at intensity or opacity 0 and included in the room warm-up renders:
- `L_CS_KEY` (shadow variant);
- the threshold-glare SpotLight pose;
- dust, drops, bubble and needle materials;
- the tally layer;
- Ada's `living` state.

So no cutscene stalls on a shader compile.

**Shadow-only fallback (F1):** if Ada's body enters the wallpaper frame, render her with `colorWrite=false` and
`depthWrite=false` while she still casts into the shadow map. Verify against r186's shadow pass before relying on it.

---

## 6. Build specs per lane

**cutscenes-runtime** (`src/cutscenes`, `src/world/cutscene-fx.ts`, `src/render` hooks)
1. Types and host:
   - clip cue `at` (start offset) plus speed 0 holds;
   - `dof` cue focus pull (`to`, `over`);
   - camera space `car0`;
   - cues `grade` and `lmScale`.
   - Tests exempt `car0` the way they exempt `car`.
2. Timelines: `c0-road.ts`, `c2a-names.ts`, `c2b-door.ts`, `c3a-nights.ts`, `c3b-bell.ts`, `c4a-door-gives.ts`,
   `f1-tuesday.ts`, `f2-water.ts`, `c4b-twelfth-can.ts`, `c4c-remembers.ts`, `c5b-rocking.ts`, `c6b-bait.ts`.
   Register all of them in `index.ts` and `DIRECTOR_CUTSCENES`.
3. Upgrades to C1 (no fade-in after C0; DOF inserts), C2 (focus pull, `dust_sift`), C5 (mist roll, south-window
   shaft, cleat insert, clean bell), C6 (6:10 clock and ticket insert, mirror candle; done → C6b), C7 (cleat insert).
4. New fx: `bell_run`, `dust_sift`, `drops`, `hatch_bubbles`, `hatch_jolt`, `match_flare`, `threshold_glare`,
   `footprints_path`, `needle`, `mist_roll`, plus dressing sets `f1976` and `f1976_g3`.
   - Every dressing and place cue is authored in on/off pairs.
   - Skip must leave the world exactly as before.
5. The `L_CS_KEY` runtime light, the frame-time guard, and the cutscene render profile hand-off to the pipeline
   (sceneScale and dynamic-res hold, `motionBlur` wiring).

**blender-anim** (through `scripts/assets.mjs` only, one run, never alongside headless Chrome)
1. Optional `ada_sew_shadow` (2.0 s loop): kneeling at the hem, the right hand drawing thread up in a 25 cm arc,
   the head bowed, readable in silhouette from the side. Fallback: `ada_dress` at 0.5×.
2. Nothing else: every other cutscene uses existing clips.

**blender-props** (through `scripts/assets.mjs`)
1. `P_HATCH`:
   - export a `-intact` child (1976 planks unbroken, same UV2 layout so it samples the existing lightmap, hidden by
     default);
   - export a separate `-shackle` node with its pivot on the hinge pin, for the snap.
   - No re-bake.
2. `P_SIGN_LANTERN`: a separate `-door` glass node if the mesh allows (C4b/C6b open the glass). If not, the shots
   frame the wick and the match only.

**materials** (`src/materials`)
1. Procedural TSL tally layer for the tally wall (five-stroke groups, graphite sheen, per-column age wobble); also
   C7's fresh column.
2. Rain-ring normals on ditch and puddle water (C0, C5b).
3. Reflector retro-glint uniform (C0).
4. Ada `living` uniform (warmer albedo, low wetness and sheen).
5. A rust uniform on the padlock (1976 new, 1994 rusted).

**lighting-post** (`src/render`)
1. The `grade` cue on the pipeline uniforms (the memory look).
2. A per-material `lmScale` uniform multiplying `lightMapIntensity` (default 1 × π).
3. Cutscene profile per preset (§5): sceneScale and dynamic-res hold, the Medium volumetric beam, the Max motion blur
   wiring, the frame-time guard.
4. Bloom streak for the threshold glare.
5. Prewarm of every new light and material.

**audio-voice** (`scripts/layout/build-voices.mjs`, then regenerate `voice-script.json`; subtitles until the key exists)
1. Append 10 lines:

   | Id | Speaker | Trigger |
   |---|---|---|
   | `c2a_names` | driver | `c2a:book` |
   | `c2b_my_dress` | ada | `c2b:vigil` |
   | `c3a_count` | driver | `c3a:count` |
   | `mem_harlan_ada` | harlan | `mem:harlan_calls` (cued by C3b and F1) |
   | `c3b_coming` | ada | `c3b:coming` |
   | `f1_tuesday` | ada | `f1:tuesday` |
   | `f2_keep` | harlan | `f2:keep` |
   | `c4b_look` | harlan | `c4b:look` |
   | `c4c_there` | ada | `c4c:there` |
   | `c6b_company` | ada | `c6b:company` |

   Texts are in §3.
2. Delivery and voice chains:
   - Harlan's 1976 lines: no sack, distant or muffled chains (`far_room`, `under_boards`).
   - Living Ada: the existing Ada designed voice with "alive" tags.
   - If the tags can't get there, keep those lines short and processed; no extra designed voices.
3. New synth sfx: `match`, `sizzle`, `crank_clack`, `wire_twang`, `hatch_bubbles` (bubble bursts), plus the
   underwater-style lowpass preset for knocks under the boards.

**story-ai** (`src/story`, `src/ai`)
1. Extend `CutsceneId` with the 12 new ids; add the chains `C0 → C1` and `C6 → C6b → C7`.
2. Triggers:
   - `read_guest_book` (C2a);
   - hide exit in VIGIL (C2b);
   - first `peek_grate` before `c3_done` (C3a);
   - first `lured` bell answer (C3b);
   - `ada_boards_pried` / `b09:enter_u3` (C4a);
   - first `take_locket` (F1);
   - `listen_hatch` / hatch look / can reach (F2);
   - `b10:can_plate_seen` +0.3 s / pre-pickup (C4b);
   - FINALE `take` (C4c);
   - `b02:at_door` when the beat is B12 (C5b).
3. Brain `freeze`/`resume` with deaf grace, the safety gate and 20 s drop, C3b's scripted → LURED hand-off with the
   window at the end, the C4b snapshot and restore, and C4c pausing FINALE.
4. Flags `cs_<id>_done` persisted across respawn. The `doc_*` VOs and `b10_my_plate` are never re-voiced.
5. A CONTRACT-CHANGES entry for `freeze` and the cutscene triggers.

**ui** (`src/ui`)
1. DOM 4:3 rounded film gate with gate weave and a DOM grain canvas (flashbacks, all tiers).
2. A CSS-filter grade fallback on the canvas for Low.
3. Small cards: the C0 date and C6b's "Three weeks later".
4. Subtitles for the 10 new lines.
5. The hold-to-skip hint shown only on cutscenes already seen.

**tests** (lane C, with the lanes above)
- The cutscene data checks extend to the new ids:
  - triggers exist in `voice-script.json`;
  - sfx ids are in the bank;
  - prop, door and light ids exist;
  - every plan-space eye is inside a room rect (`car0` exempt).
- Dressing on/off pairs net to zero on skip.
- Freeze/resume restores the brain and its timers.
- The C3b window starts at the end of the cutscene.
- The C4b snapshot is restored.
- `C0 → C1` and `C6 → C6b → C7` work through the real Director.

---

## 7. Budgets

| | Low | Medium | Max |
|---|---|---|---|
| Now | 20.9 MB | 50.4 MB | 102.2 MB |
| Code (timelines, fx, TSL) | +0.06 | +0.06 | +0.06 |
| 10 voice takes (if shipped per tier) | +0.45 | +0.45 | +0.45 |
| `P_HATCH` intact and shackle nodes, lantern door | +0.1 | +0.15 | +0.2 |
| Optional `ada_sew_shadow` | +0.05 | +0.05 | +0.05 |
| **Estimate** | **~21.6 / 25** | **~51.1 / 60** | **~103.0 / 120** |

- No new lightmap atlases.
- No new textures: the tally marks, rain rings, rust, grade and grain are all procedural.
- Blender: at most one anims run (about 30 s to 10 min) and one props run, serial, under the `assets.mjs` lock.

---

## 8. Milestones (ship order: cheapest high payoff first)

1. **M-A: Freeze and profile, plus five cheap scenes.**
   - Brain freeze and safety gate.
   - Cutscene render profile (§5).
   - `L_CS_KEY` and the prewarm.
   - C4a, C2b, C5b, C6b with the C6/C7 inserts, C4c.
   - C2 and C5 upgrades.
   - Voices `c2b_my_dress`, `c4c_there`, `c6b_company`.
   - (~62 s of new content, no Blender.)
2. **M-B: Memory look and the well.**
   - The `grade` cue, `lmScale`, the DOM gate and grain, the Low CSS fallback.
   - F2 (with the blender-props `P_HATCH` nodes).
   - C3b with its flash-frames.
   - Voices `f2_keep`, `mem_harlan_ada`, `c3b_coming`.
3. **M-C: The twist and the lore.**
   - C4b (clip cue `at`, `threshold_glare`, `match_flare`).
   - C3a (the TSL tally layer).
   - C2a.
   - Voices `c4b_look`, `c3a_count`, `c2a_names`.
4. **M-D: Showcase opening.**
   - C0 (`car0` space, rain-ring normals, retro-glint).
   - C1 upgrades.
5. **M-E: The hem.**
   - F1 (needle prop, dressing `f1976`, `living` state, optional `ada_sew_shadow`, shadow-only fallback).
   - Voice `f1_tuesday`.
6. **M-F: QA and polish.**
   - Per-tier QA captures of every faces-hidden shot (§3 audit).
   - Cutscene frame-time report.
   - A B05–B10 pacing playtest, applying the cut order (C3a, C2a, C0) if it drags.
   - Generate the voices.
   - Stretch: the rain-on-glass layer for C3, the lantern bloom streak in C1.

---

## 9. Lead amendment (2026-10-07): CR — end credits after the sting

The user asked to "give all the credits to raj vardhan singh". The panel cut the credits drive (CR) because credits
*before* the sting would send players away early. Credits *after* the sting have no such cost, so they are added back:

- **CR: Credits, ~24 s, cost S, skippable at any time (hold Space/Enter, or Esc → menu).** Plays after C7's title and
  its single bell, before the end card.
- **Picture:** black, then a slow, locked-off 50 mm shot of the house from the gate in rain at night with the ROOMS
  lantern relit (C6b dressing kept), graded down to ~40 % brightness under the text. Reuses C0/C6b assets only; no new
  lighting. Low: black background only.
- **Text** (DOM, system serif, centred, slow upward roll; every role credits **Raj Vardhan Singh**):
  - THE KEEPING — a game by Raj Vardhan Singh
  - Written and directed by Raj Vardhan Singh
  - Game design · Story and dialogue · Art direction · House, props and characters · Lighting and materials ·
    Animation and cutscenes · Sound design and music · Voice design · Programming — Raj Vardhan Singh
  - © Raj Vardhan Singh. All rights reserved.
  - Last line, after a beat: "Made from scratch."
- **Sound:** rain bed + the blue-hour pad from C6, fading out; one distant bell under the last line.
- **Rules:** no AI/tool credits anywhere (see CLAUDE.md "Credits"); the open-source license notices stay in
  `docs/CREDITS.md`, not in the roll. Story flag `cs_CR_done`; the end card follows unchanged.
- **Milestone:** M-A (cheap, no Blender).

Updated order: … C6 → C6b → C7 → **CR** → end card.
