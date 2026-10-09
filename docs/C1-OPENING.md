# C1-OPENING: C0 "County Road 9" + C1 "Empty", the build-ready spec

Cinematographer-designer for the opening, 2026-10-07. This document **supersedes `docs/CUTSCENES-PLAN.md` §3 C0 and C1**.
It describes the target. Nothing here is built yet. The runtime round edits `src/**`, the Blender round edits
`blender/**`, and the lead approves the layout, voice and contract items listed in §10.

The user's direction: *"the initial car driving scene is not up to the mark rn. nothing is visible"* and *"a lighter
build inside car which is detailed as well, a glimpse of the outside which shows he is out of nowhere stuff, use your
creatives"*.

---

## 0. Diagnosis: why C1 shows "nothing" today

These causes come from the lead's frames (`scratch/lead/c1-now-0*.jpg`), checked against the code.

| Symptom (frame) | Root cause | Fix (section) |
|---|---|---|
| The headliner fills the top third and glows orange; the dash, gauges and wheel are out of frame (`01`, `02`) | **Geometry.** `sedan_interior` puts the headliner at z 1.15 and the windscreen top at 1.14 above its floor. `DRIVER_EYE` z 1.12 is a road-relative height that only works in the exterior car. In the set, the camera sits 3 cm under the roof and the windscreen is a 0.28 m slit. The set's dash (top 0.93) is about road height, but its roof is 0.16 m too low and its seat 0.2 m too low. `L_DASH` is a 2700 K point light 0.3 m under the headliner, so it lights the headliner orange. | §6.1: the interior is rebuilt in **car space** (z 0 = road), dimensioned from the exterior `Body` |
| The windscreen shows a grey band of distant fog trees and a black void; no road (`01`) | The CAR set floats at x ≈ 100 with nothing outside it. | §6.1, §7.1: the interior is **mounted in the moving sedan**, so the windscreen sees the real road |
| Two bright bars over a black road (`03`) | The camera sits inside the exterior `sedan` shell, whose single-sided body is culled from inside, so the camera sees the emissive `sedan-headlights` boxes. The layout gives the headlights 3000 W at 4200 K. `watts/4π × 0.6` is 143 cd, about 1 % of a real low beam's hot spot, and there is no beam pattern. | §5.1 photometry, §7.2 beam cookie |
| The ROOMS sign is a blurry smear | The decal canvas is too small for a 160 m approach, and TAA plus 0.75 sceneScale soften it further. | §7.6 sign lettering |
| Windscreen rain is specks | Drops are drawn without refraction, so they show no lensed image of the lights behind them. | §7.3 |
| The lantern is a big sprite flare | A sprite is drawn instead of a small physical emitter with bloom. | §7.7 |
| The arms show in the exterior shots | `arms` is `visible: true` from t 0 to 46.8 s, across every shot. | §7.1, arms only in POV shots |
| The plate rise ends on a giant flat pink slab (`05`) | The camera sits 0.2 m from a flat emissive tail-lamp card. Its luminance is far above the night exposure, and AgX desaturates it to pink. | §7.8 tail-lamp optics; S11 framing |

Already good, and kept: the lightning reveal of the house and the bare trees against the sky.

---

## 1. Conventions

- **PLAN space**: metres, x east, y north, z up. Positions written `(x, y, z)`.
- **car space** (`space: 'car'`, `carToPlan` in `src/cutscenes/math.ts`): x right, y forward (the nose), z up from the
  road. The origin is the ground under the body centre, the same origin as the `sedan` prop. Body station `x_b` in
  `sedan.py` maps to car-space `y = x_b − 2.425`.
- **Chainage `s` and offset `n` on the corridor** (§2): `s` is metres along the centreline, measured eastward from
  x = 20 (EXT1's east edge). `n` is the lateral offset in metres. Positive `n` is left of eastbound, which is the
  **westbound driver's right**. The westbound lane centre is `n = +1.75`. The gate is at `s = −17.2`.
- **Lens to vertical fov** (24 mm gate, `vfov = 2·atan(12/f)`): 18 mm = 67.4°, 24 = 53.1°, 28 = 46.4°, 32 = 41.1°,
  35 = 37.8°, 40 = 33.4°, 50 = 27.0°, 65 = 20.9°, 85 = 16.1°.
  - `fov` in timelines is the full-viewport vertical angle.
  - The 2.39:1 DOM letterbox on a 16:10 viewport shows only the middle 67 % of it, which is what you see. Frame for
    that band.
- **DOF and motion blur**: DOF is on for Medium and Max. On Low, a rack becomes a cut and macros hold focus at
  0.35 m or more. Motion blur is on for Max only. This follows CUTSCENES-PLAN §5.
- **Speed**: the sedan drives at 19 m/s (43 mph: wet, night, an unfamiliar road). The logging truck drives at 25 m/s.

---

## 2. The road: County Road 9 corridor (RC9)

**One analytic definition.** Blender and the runtime compute the same centreline. Propose
`src/shared/road-rc9.json` (lead-owned) holding these segments plus a 2 m polyline sample.

| Seg | s from → to | Kind | Start (PLAN) | Heading (eastbound, rad) | Arc centre, R |
|---|---|---|---|---|---|
| A | 0 → 240 | straight, the final approach | (20, −33.0) | 0 | – |
| B | 240 → 397.1 | arc, 30° | (260, −33.0) | 0 → −0.524 | (260, −333), R 300, clockwise |
| C | 397.1 → 847.1 | straight | (410.0, −73.2) | −0.524 | – |
| D | 847.1 → 1004.2 | arc, 30° | (799.7, −298.2) | −0.524 → 0 | (949.7, −38.4), R 300, counter-clockwise |
| E | 1004.2 → 1250 | straight (detailed) | (949.7, −338.4) | 0 | – |
| tail | 1250 → 1550 | straight, low detail; fades into fog | → (1495.7, −338.4) | 0 | – |

For the westbound driver, bend D is a right-hander and bend B is a left-hander. Bend B hides the final straight, and
so the lantern, from everything east of s ≈ 330.

**Cross-section.** It matches EXT1, whose asphalt runs y −36.5 to −29.5, so the centreline is y −33.0.

| Element | n (m) | Notes |
|---|---|---|
| Asphalt | ±3.5 | 2 % crown. Wet ruts at n ±0.9 and ±2.6 are smoother and darker. |
| Centre line | 0 | Faded double yellow, broken (passing allowed) on seg C and seg E. 100 mm lines, 40–70 % worn. |
| Edge lines | – | None. |
| Gravel shoulder | ±3.5 to ±4.7 | |
| Ditch | ±4.7 to ±7.5 | 1:3 slope down to −0.6 m. A standing-water strip 0.6–1.2 m wide in the bottom (rain-ring normals). |
| Back slope | ±7.5 to ±9.5 | Up to the forest floor. |
| Forest edge | ±9.5 to ±14 | Clearance for the right-of-way. |

**Joining EXT1.** At s = 0 the corridor meets EXT1's asphalt rectangle exactly at x = 20, with z 0 and the same
centreline and width. The corridor geometry starts at x = 20. Do not overlap EXT1's lightmapped quads.

**Landmarks** (PLAN positions are computed from the definition above):

| Id | What | s, n | PLAN (x, y, z) | Facing |
|---|---|---|---|---|
| `P_RC9_NEXT_SERVICES` | NEXT SERVICES 48 MI guide sign | 255, +6.2 | (275.3, −27.2, 0) | East (yaw ≈ 1.52) |
| `P_RC9_CR9_A` | COUNTY 9 pentagon shield | 510, +6.0 | (510.8, −124.5, 0) | Faces approaching westbound traffic (yaw ≈ 1.05) |
| `P_RC9_CR9_B` | COUNTY 9 shield (eastbound face) | 1100, −6.0 | (1045.6, −344.4, 0) | West |
| `P_RC9_DINER` | Dead roadside diner (building centre) | 700, +24 | (684.3, −203.9, 0) | Front faces the road, yaw −0.524 |
| `P_RC9_EAT` | EAT pole sign | 688, +11.5 | (667.7, −208.7, 0) | Toward the road |
| `P_RC9_BILLBOARD` | Peeling 30-sheet billboard (outside of bend D) | 930, −15 | (872.6, −343.8, 0) | North-east (yaw ≈ 2.11, face normal 31° N of E) |
| `P_RC9_DEER_1..3` | Three whitetail does at the tree line | 198–212, +12 to +14 | (218, −20), (225, −21), (232, −19) | Facing the road |
| Power line | Poles every 45 m on the +n side for s > 845, crossing the road at s 845 (797.9, −297.2), then on the −n side for s < 845 to EXT1's existing `P_UTILITY_POLE` (−12.5, −37.4) | n ±7.2 | – | – |
| Reflector posts | Delineators every 60 m on bends and 120 m on straights, both sides, n ±4.9; 25 % missing or leaning | – | – | – |
| `P_RC9_TRUCK` | Logging truck (moved by its own track) | – | – | – |

**Exclusions.**
- No trees for s < 60 (x < 80) on the +n side, where the EXT2 field runs to x 70.
- Keep a clearing of 10 m or more around `P_CAR_INTERIOR` (100.8, 1.4) so no instance pierces the set.
- Keep 3 m clear of every landmark.

**Distances that matter.**
- Fog: C1 `fogDensity` is 0.0045, which gives 5 % contrast at ≈ 385 m. C0 uses 0.003 (heavy-rain visibility
  ≈ 580 m).
- The camera far plane must rise for these shots (§7.4): C1 600 m, C0 2000 m.
- The horizon beyond the corridor is the existing sky-shader treeline, plus the new far-ridge layer (§7.5).

---

## 3. C0: County Road 9, title cinematic (30.0 s)

Story order is C0 then C1. C0's done starts C1 with no fade-in, a match-cut on the wiper. Skip goes straight to C1.
The 2.39:1 letterbox holds throughout.

The look is *The Shining*'s opening aerial at night in the rain: one pair of headlights alone in a forest that goes on
forever, then the title.

| # | t | Shot | Purpose |
|---|---|---|---|
| 0 | 0.0–3.5 | Black, date card | Time and place |
| 1 | 3.5–12.5 | **Aerial**: one pair of headlights in endless forest; lightning shows the land to the horizon | Out of nowhere |
| 2 | 12.5–19.0 | **Billboard and wires**: the car's beams light a peeling billboard; sagging power lines | A dead road |
| 3 | 19.0–26.0 | **Crane and title**: the car passes under the crane; its taillights are swallowed | THE KEEPING |
| 4 | 26.0–30.0 | **Through the glass**: a pull-back over the hood into the cabin; match-cut on the wiper | Into C1 |

**Vehicle track (`vehicle`).** The car is always in the westbound lane (n +1.75) with `heading: 'path'`. Positions
come from `road-rc9.json`. The treadmill jumps are hidden by the cuts.

| t | s from → to | Notes |
|---|---|---|
| 3.5–12.5 | 1240 → 1070 | (1185.6, −336.6) → (1015.6, −336.6) |
| 12.5–19.0 | 1010 → 890 | Through bend D |
| 19.0–26.0 | 870 → 745 | Passes the crane at s 800 at t ≈ 22.9 |
| 26.0–30.0 | 745 → 670 | car-space shot |

### Shot 0: Black, 0.0–3.5

- Card (small, system serif, centred low): "Tuesday, 11 October 1994", 0.8–2.9 (DOM, UI lane).
- Sound:
  - rain fades up 0.0–2.5 (`rain_leaves`, new);
  - `thunder_distant` at 1.4;
  - score `drone` at 0.

### Shot 1: Aerial, 3.5–12.5 (PLAN)

**Camera.**
- Position: (926.1, −407.6, 62) → (938.0, −399.0, 52), inOut. A slow descending push, 10 m down over 9 s.
- Target: (1275.6, −338.4, 20) → (1262.0, −338.4, 12).
- Lens: **35 mm (37.8°)**. Centre depression ≈ 6–9°, so the horizon sits in the top of the letterbox band and the
  road crosses the lower half.
- Focus: infinity, no DOF.
- Handheld 0 (aerial smoothness). Add slow wind sway: ±0.15° roll at 0.1 Hz.
- Near 1.0 m, far 2000 m (§7.4).

**On screen.**
- Black canopy texture below a slightly lighter overcast band.
- The road is a dull ribbon, visible only where it catches the sky.
- One pair of headlights crawls toward camera out of the fog at the far end of seg E. Its warm pool of light is about
  60 m long. Lit rain slants through the beams, and the beams make cones in the haze.
- The car is about 8 px wide. No other light anywhere.

**Light events.**
- 3.6: `look` C0 profile (fog 0.003, rain 1, wind 0.6; far ridges on, §7.5).
- 9.2: **lightning, strength 0.7**, cloud-to-ground and far: 4 pulses in 0.42 s. The canopy, the layered ridges and
  the cloud deck are lit to the horizon. No town, no glow, no lights.
- Meter: frozen 0.8 s after the last pulse (existing `flashHold`).

**Sound.**
- Rain on the canopy, wind.
- At 4.0, the car as a faint tyre hiss and engine (spatial at the vehicle, 180 m away).
- `thunder_distant` at 11.6 (a strike ≈ 0.8 km away arrives 2.4 s later).

**Faces:** none, aerial.

### Shot 2: Billboard and wires, 12.5–19.0 (PLAN)

**Camera.**
- Position: (903.7, −316.6, 4.2) → (903.2, −317.4, 4.0). This is the +n side of the bend, behind the power line.
- Target: (872.6, −343.8, 4.6) → (868.0, −340.5, 3.6), a slight pan right following the car.
- Lens: **35 mm**.
- DOF: focus 37 m (Medium/Max), so the wire and pole foreground, 3–9 m away, soften.
- Handheld 0.15.

**On screen.**
- A wooden pole and three sagging conductors cross the foreground. One is slack: it has broken at the crossarm and
  hangs to the ditch.
- Across the road, the billboard is dark at first. At 12.9 the car's low beams, out of frame left, rake onto it.
- The billboard face is torn paper over older hand paint:
  - fragments of a 1980s interstate poster: "…58 · CARVEL EXIT 4 · EAT · SLEEP · G…";
  - under the torn strips, the 1960s paint reads "…OUD'S … ROOMS ½ MI". This is the house's own billboard. It is
    readable only in the lightning.
- The car enters frame left at 16 m (t ≈ 15.0), swings through the bend, and its taillights recede right.
- Wet speculars run along the wires.

**Light events.**
- Car low beams, §5.1.
- 15.6: **lightning, strength 0.9**, near: 3 pulses in 0.35 s. Hard shadows of the pole and wires fall across the
  billboard face, and the peeling strips flutter.
- Meter: **hold** for the shot at the value snapped at the cut, so the headlight rake reads as light arriving and is
  not adapted away. Use bias −0.5 EV if the lit poster clips.

**Sound.**
- Wires hum in the wind (a low aeolian tone, new `wire_wind`).
- Peeling paper flaps.
- The car passes by (doppler, new `car_pass_by`) at ≈ 15.0.
- `thunder_near` at 16.8: 1.2 s after the flash, so the strike is ≈ 400 m away.

**Faces:** the car is seen from its side at 16 m through rain-covered glass, unlit inside. The driver proxy (§6.2) is
a silhouette.

### Shot 3: Crane and title, 19.0–26.0 (PLAN)

**Camera.**
- Crane at (762.2, −269.0) on the +n shoulder (s 800, n +6.5).
- Height 2.0 → 14.0, inOut.
- Target: (820.0, −306.0, 1.0) (the car approaching) → (770.0, −277.0, 0.5) (it passes beneath, 4.7 m away, at
  t ≈ 22.9) → (630.0, −198.0, 1.0) (receding west).
- Lens: **28 mm → 35 mm**.
- DOF: focus follows the car, 5 → 60 m.

**On screen.**
- The headlights grow, the beams sweep up over the lens (a small physical bloom), and the car passes under.
- The camera rises and turns to look down seg C: two black walls of forest and a tiny pair of red taillights receding.
- The reflector posts flash white one after another as the beams reach them.
- The taillights shrink to nothing. The road is empty.

**Title (DOM, system serif, UI lane).**
- "THE KEEPING": fade in 20.0–20.8, hold, fade out 24.0–24.6.
- "a game by Raj Vardhan Singh", smaller, below: 20.8–24.6.

**Light events:**
- car low beams;
- 23.6: lightning flicker, strength 0.25, cloud-to-cloud with no ground strike. It is a silhouette pulse on the walls.

**Sound.**
- The pass-by close (at 22.9 a tyre-spray hiss crosses left to right).
- `score_reveal` under the title at 20.0.

**Faces:** the car is seen from above and behind.

### Shot 4: Through the glass, 26.0–30.0 (car space)

**Camera.**
- Position: (−0.30, 3.40, 1.30) → (−0.30, 0.30, 1.13), easeIn. The camera starts 0.95 m ahead of the nose, over the
  hood, looking forward, and pulls straight back through the windscreen.
- The driver-side line x −0.30 keeps it clear of the mirror, whose edge is at x −0.125.
- It crosses the glass at y ≈ 0.48. It ends 15 cm above the wheel rim, by the windscreen.
- Target: (−0.30, 30, 0.90) → (−0.30, 25, 0.95), forward.
- Lens: **40 mm (33.4°)**.
- DOF: focus 20 m → **0.18 m** (the glass) as the camera passes behind it (Medium/Max).

**On screen.**
- At first: the hood edge, the road and rain streaks in the beams.
- Inside the glass: drops and streaks come into focus over the defocused road. The cluster glows green-aqua at the
  bottom edge.
- **29.75: the driver-side wiper blade crosses frame**. Hard cut to C1 t 0, where the same blade completes its sweep.

**Light events:**
- `windshield_rain` on at 26.0;
- `wipers` period 1.25 phase-locked, so a blade crosses at 29.75;
- `dash` on with `fuelNeedle −0.05` and `fuelLamp: false`. The lamp first lights in C1 S3.

**Sound.**
- The exterior bed crossfades to the muffled interior bed as the camera passes the glass (lowpass 1.8 kHz, 0.3 s).
- `radio_static` faint.

**Faces:** looking forward, away from the driver.

---

## 4. C1: Empty (75.0 s)

The beats the client fixed stay in this order: low fuel at night → (the outside: nowhere) → the engine dies at the
ROOMS sign → lightning on the house → "Forty-eight miles to anything…" → step out → CP1. The new material makes the
middle of the drive earn its time:
- the radio finds nothing;
- the dead diner;
- the map and dome light (the detailed cabin);
- the truck that does not stop;
- the forest walls;
- the sign and the deer.

| # | t | Shot | Space | Lens | Beat |
|---|---|---|---|---|---|
| S1 | 0.0–6.6 | Seek | car POV | 24 | Radio finds nothing |
| S2 | 6.6–11.6 | EAT | PLAN | 28 | Dead diner, headlight rake |
| S3 | 11.6–17.6 | Below E | car insert | 65 | Needle, lamp, chime, "Come on…" |
| S4a | 17.6–21.8 | Dome on | car POV | 24 | The cabin revealed in warm light |
| S4b | 21.8–26.6 | The map | car POV | 35 | County Road 9, "48", interstate line |
| S4c | 26.6–30.2 | Dome off | car POV | 24 | Visor photo, medal; black; glow on the bend |
| S5 | 30.2–37.8 | The truck | car POV | 24→28 | High beams, flash, horn, spray |
| S6 | 37.8–43.4 | Walls | PLAN | 50 | Tiny car between black walls of forest |
| S7 | 43.4–50.4 | 48 / eyes | car POV | 24→28 | NEXT SERVICES 48 MI; deer eye-shine |
| S8 | 50.4–56.6 | ROOMS | car POV | 28→40 | The lantern; coughs; the engine dies |
| S9 | 56.6–62.0 | The gate | PLAN | 35 | Rolls into the lantern's pool; stops; lights die |
| S10 | 62.0–69.0 | The house | PLAN POV | 50→44 | Lightning reveal; "Forty-eight miles…" |
| S11 | 69.0–75.0 | Step out | PLAN | 40→player | Plate RVX-318 → CP1 |

**Our vehicle track.** Lane n +1.75, `heading: 'path'`. POV shots run on landmark-free road sections (the treadmill),
and landmark shots keep their geography.

| t | s from → to | Notes |
|---|---|---|
| 0–6.6 | 560 → 435 | Passes the COUNTY 9 shield (s 510) at t ≈ 2.6 |
| 6.6–11.6 | 745 → 650 | Passes the diner (s 700) at t ≈ 9.0 |
| 11.6–17.6 | 640 → 526 | Insert, so the road is unseen |
| 17.6–26.6 | 671 → 500 | Dome on: the windscreen mostly reflects the cabin |
| 26.6–37.8 | 668 → 455 | Continuous S4c + S5. Meets the truck at s 516, t 34.6 |
| 37.8–43.4 | 372 → 270 | Through bend B under the crane |
| 43.4–50.4 | 360 → 227 | Passes the sign (s 255) at t ≈ 48.9 |
| 50.4–56.6 | 140 → 23 | 19 → 15 m/s, ease out. Coughs at 51.4 and 53.6; dies at 55.8 |
| 56.6–62.0 | 23 → the gate | Ends at (2.8, −30.2), heading π, n drifting +1.75 → +2.8. Ease out, a coasting stop at 61.0 |

**Truck track.** This needs a second `vehicles` entry (§7.1). Eastbound lane n −1.75, 25 m/s, heading `'path'`
(eastbound):

| t | s from → to | Notes |
|---|---|---|
| 26.6–40.0 | 316 → 651 | Visible from 26.6, as a glow on the bend-B trees. Removed at 40.0 |

### S1: Seek, 0.0–6.6 (car POV)

**Camera.**
- Eye: `DRIVER_EYE` (−0.35, −0.05, 1.12), plus the engine tremor and a road-rumble micro-shake (handheld 0.35).
- Target: (−0.30, 25, 0.95) → at 3.4–5.4 a glance to the radio (0.03, 0.57, 0.72), about 30° down-right → back to
  (−0.30, 25, 0.95) by 6.2.
- Lens: **24 mm (53.1°)**.
- DOF: focus 8 m on the road. During the glance, focus 0.78 m on the radio.

**On screen.**
- The cabin around you at road speed:
  - the top of the binnacle and the wheel rim at the bottom of frame;
  - gloved hands at 10 and 2 o'clock;
  - the green-aqua dials inside the rim;
  - the A-pillars framing the windscreen.
- Outside: wet black road, the lit gravel verge, pale tree trunks at the edge of the beams, and lit rain streaks.
  Water film and drops sit on the glass. The wiper continues the sweep from C0.
- 2.6: the COUNTY 9 shield flicks past on the right as a retroreflective blue-yellow flash.
- 3.6: the right glove presses SEEK (`arms_radio_seek`). The VFD digits race 88.1 → 107.9, wrap to 87.9, race on,
  stop on nothing. Static.
- 4.6: SEEK on AM. 540 → 1600: a whistle, then static.

**Light events.**
- From 0: the cluster backlight, the VFD and the headlight veil fill (§5.1).
- `fuelLamp` is still off. It first lights in S3.

**Sound.**
- Interior bed: engine cruise (`engine_idle` rate 1.35), new `tyres_wet` loop, rain on the roof (`rain_inside`,
  surface car), `wiper` thunks.
- 3.6: new `radio_seek` (a click, a chirping sweep through static).
- 4.6: `radio_seek` AM variant.

**Voice:** **`c1_preacher`** (new) at 5.4: *"Nothing. Not even a preacher."*

**Faces:** POV. The mirror shows the rear window only (probe-only reflection, never a planar render).

### S2: EAT, 6.6–11.6 (PLAN)

**Camera.**
- Position: in the diner lot, (701.0, −225.0, 1.1) → (700.6, −224.6, 1.1).
- Target: (667.7, −208.7, 2.4) (the EAT pole and the façade receding) → (640.0, −197.0, 1.2) → (614.3, −189.1, 0.8)
  (the receding taillights).
- Lens: **28 mm**.
- DOF: focus 30 m.
- Handheld 0.2.

**On screen.**
- At first almost black: the shapes of the pole sign and a flat-roofed building against a slightly lighter sky.
- 7.2: light floods in from behind camera left. Our car passes 12 m away on the road (t 7.65), and its beams rake
  along the boarded front:
  - weathered plywood over the window band;
  - "CLOSED" brushed on one board;
  - a cracked door with a hanging CLOSED card;
  - a payphone on the wall with the armoured cord cut and no handset;
  - a concrete pump island with only four bolts where the pumps were.
- The EAT letters are dead neon: glass tubes on a rusted can. They catch speculars, but not one glows.
- The shadow of the pole sign swings across the wet lot as the car passes.
- The taillights recede up the road into the trees. It is black again by 11.0.

**Light events:**
- car low beams (moving spot, its shadow on Medium/Max);
- moon or sky ≈ 0.01 lux;
- meter **hold** at the snapped value.

**Sound.**
- Rain on a tin awning (new `rain_tin`), dripping gutter (`gutter`).
- Pass-by doppler at 7.65 (new `car_pass_by`, spatial).
- A loose sheet-metal panel ticks in the wind.

**Faces:** the car is seen side-on at 12 m through wet glass with the cabin unlit. The driver proxy is a dark shape.

### S3: Below E, 11.6–17.6 (car insert)

**Camera.**
- Position: (−0.33, 0.08, 1.05) → (−0.32, 0.14, 1.03). The camera leans 13 cm toward the cluster and looks through
  the upper opening of the rim.
- Target: the speedo needle (−0.42, 0.72, 0.80) → at 12.8 rack to the fuel needle (−0.27, 0.72, 0.82).
- Lens: **65 mm (20.9°)**.
- DOF: focus 0.70 m, f/2-equivalent. On Low the rack becomes a cut at 12.8.
- Handheld 0.25, plus engine vibration.

**On screen.**
- The speedo needle at 43, steady.
- The rack to the fuel needle, 7° **below E**. It bobs ±1.5° at 0.7 Hz with fuel slosh.
- **12.4: the amber LOW FUEL lamp comes on** and blinks (period 0.9 s). Its glow halos the lens.
- The dial graphics, mechanical odometer drums reading 148213, and the scratched clear lens, which reflects the
  windscreen as a soft band.

**Light events:**
- cluster backlight ≈ 3 cd/m²;
- needle ≈ 8 cd/m²;
- fuel lamp 80 cd/m², blinking.

**Sound.**
- 13.5: `fuel_chime`.
- The engine note fluctuates, a hint of trouble.

**Voice:** `b01_come_on` (`c1:fuel_chime`) at 14.3. Existing line: *"Come on… come on, don't do this to me."*

**Faces:** none.

### S4a: Dome on, 17.6–21.8 (car POV)

**Camera.**
- Eye: `DRIVER_EYE`.
- Target: road → 18.0 down-left to the headlamp switch (−0.62, 0.60, 0.80) → 19.2 down-right to the passenger seat
  (0.35, 0.10, 0.58) → 20.6 following the map up to the wheel (−0.25, 0.50, 0.90).
- Lens: **24 mm**.
- DOF: focus 0.6–0.9 m, following the target.

**On screen.**
- 18.3: the left glove turns the headlamp switch knob fully counter-clockwise. On 1980s US cars this is the dome
  light. `arms_headlamp_knob`.
- **18.4: the dome light comes on.**
  - 2800 K. An 80 ms filament warm-up from orange.
  - The windscreen becomes a dim mirror of the cabin. The road outside disappears, as it does in a real car.
- The glance across the seat shows the detailed cabin (§6.1):
  - tan vinyl 60/40 bench with pleats, piping, and a split seam taped with silver duct tape;
  - the folded road map;
  - a 2-cell flashlight;
  - three cassettes (one loose with a tape loop pulled out);
  - a fan of receipts;
  - a styrofoam coffee cup in the fold-down armrest;
  - a crumpled cigarette soft pack;
  - an open ashtray with butts.
- 20.6: the right glove picks up the map (`arms_map`, phase 1).

**Light events:**
- `L_DOME` on (§5.1);
- `L_DASH` stays on;
- the veil fill is masked by the reflections.

**Exposure:** dome-on drops the scene ≈ 6 EV. The meter darkens with τ 0.5 s, so the first 0.5 s is warmly
over-exposed and settles by 19.5. See the cue in §5.2.

**Sound:**
- 18.3: new `knob_click`;
- 18.4: the faint tick of the filament (part of `knob_click`);
- 20.6: new `map_paper` rustle.

**Faces:** POV. The windscreen reflection shows the cabin and a dark, unlit head-and-shoulders silhouette from the
driver proxy, lit only from behind by the dome (§7.9). Never a face.

### S4b: The map, 21.8–26.6 (car POV)

**Camera.**
- Eye: `DRIVER_EYE` (−0.35, −0.05, 1.12) → (−0.34, −0.01, 1.10), leaning in.
- Target: the map centre (−0.25, 0.42, 0.88) → the finger.
- Lens: **35 mm (37.8°)**.
- DOF: focus 0.42 m. The fold creases and the type read. The dash beyond goes soft.

**On screen.**
- 21.8–23.0: both hands unfold the state road map against the top of the wheel rim. It is folded in an accordion,
  four panels open, 0.46 × 0.42 m.
- The map (drawn at runtime with the stroke font, §7.10):
  - pale green state-forest tint over most of the sheet;
  - the interstate **I-58** as a thick red double line along the top edge, with a town dot "CARVEL" on it;
  - **COUNTY ROAD 9** as a thin black line wandering through blank green;
  - at the edge of the sheet, a ballpoint "X" and an arrow written by hand.
- 23.0–25.6: the right gloved index finger traces CR 9 from the X west through the green. There are no town dots and
  no other roads. It stops at two small red junction dots with a red **48** printed between them.
- 25.6: the finger taps the 48.

**Light events:**
- the dome light gives ≈ 27 lux on the map (§5.1);
- the hands cast soft shadows on the paper (dome shadow on Medium/Max).

**Sound:** `map_paper` unfold (21.8); a finger scuff on the paper.

**Voice:** **`c1_interstate`** (new) at 24.4: *"Should've stayed on the interstate."*

**Faces:** none.

### S4c: Dome off, 26.6–30.2 (car POV)

**Camera.**
- Eye: `DRIVER_EYE`.
- Target: the map lowered to the lap → up across the cabin to the windscreen (−0.1, 6, 1.25) at 27.2, which brings
  the visor and photo into the top of frame → the mirror and medal (0, 0.30, 1.18) → road (−0.30, 25, 0.95) by 28.8.
- Lens: **24 mm**.
- DOF: focus 0.5 m → 8 m.

**On screen.**
- In warm light:
  - the cracked dash top, with three sun cracks by the defroster vent and a receipt tucked in the vent;
  - the cigarette pack on the dash;
  - the **St Christopher medal** on a bead chain swinging under the mirror (§10, the air-freshener conflict);
  - the stowed driver's visor overhead with a 4 × 6 snapshot under its elastic strap. The photo is sun-bleached
    almost to white, the strap crosses where faces would be, it is defocused, and it is never framed for more than
    1.2 s.
- 28.4: the left glove turns the knob back.
- **28.6: the dome light goes off.** A 150 ms orange tail from the cooling filament. Black.
- The windscreen comes back as the eye recovers (τ 6 s). First the cluster glow, then the verge in the beams.
- **29.4: far ahead, the bend's trees glow faintly, warmer and whiter than our beams.** Something is coming.

**Light events:**
- `L_DOME` off at 28.6;
- the truck's headlights start lighting the bend-B trees from 29.0, while the truck is still hidden in the bend.

**Sound:**
- 28.4: `knob_click`;
- the map is put down on the seat (`map_paper` fold).

**Faces:** visor photo as above. The mirror shows the rear window, black.

### S5: The truck, 30.2–37.8 (car POV)

**Camera.**
- Eye: `DRIVER_EYE`.
- Target: (−0.30, 25, 0.95), drifting to (−0.6, 25, 1.0) to watch the truck, then a flinch.
- Lens: **24 → 28 mm**, a slow push.
- DOF: focus 30 m.
- Handheld 0.35.
- 35.0–36.4: the car-roll response is added to the camera: ±1.2° roll at 1.5 Hz, damped. This is the bow-wave of
  the truck.

**On screen.**
- 30.4: around the bend, a **row of five amber cab-roof clearance lamps** and two high beams appear, 190 m away,
  wavering through the rain-streaked glass. The truck (§6.3) is a black mass behind them.
- 32.4: the driver flashes his high beams twice (`arms_stalk_flick`). The blue HI BEAM lamp blinks on the cluster.
  The truck does not dim.
- 33.0: the oncoming high beams fill the windscreen.
  - Every raindrop on the glass becomes a lensed point of light; the wiper arc smear glows.
  - The cabin is lit from the front-left: gloves, seat stitching, receipts, the medal's shadow sliding across the
    headliner.
  - The A-pillar shadows sweep across the cabin from left to right.
- **34.6: the truck blasts past** on the left, 3.5 m away. The pass lasts 0.45 s: a wall of chrome, mud flaps and
  log ends. The cut log ends are pale rings, lit in our low beams.
- 34.8: **spray hits the glass**. The windscreen goes white-grey in a sheet of water.
- 35.0: the wipers jump to fast (period 0.75 s) and clear it in two sweeps (by 36.3).
- 36.3–37.8: black again. The eye recovers. The truck's red taillights shrink in the mirror (a probe-free emissive
  pass through the mirror is allowed: red points only).

**Light events (§5.1):**
- truck high beams, 2 × 35 kcd peak;
- 5 amber clearance lamps, emissive;
- our high-beam flash at 32.4–32.9 (×2 intensity, inner-lamp lobe);
- meter not held (§5.2).

**Sound.**
- 30.4: the far diesel rumble rises: new `truck_pass` (a 4.5 s doppler event).
- 32.4: `stalk_click` ×2.
- 33.7: new **`air_horn`**, a two-tone chord sliding with doppler 1.07 → 0.93 through the pass.
- 34.6: the roar crosses, then a wind thump.
- 34.8: new `spray_hit`.
- 35.0: `wiper` at rate 1.6, period 0.75.

**Voice:** **`c1_dim`** (new) at 33.2: *"Dim your lights—"*. It is cut off by the horn.

**Faces:** the truck's driver is never seen. The cab is dark behind its own glare and passes in 0.45 s.

### S6: Walls, 37.8–43.4 (PLAN)

**Camera.**
- Crane above the road centre at bend B (s 330): (348.7, −46.4, 12.0) → (349.6, −46.7, 15.5), easeOut.
- Target: (366.0, −52.0, 1.0) (the car approaching beneath) → at 40.1 the car passes under → (270.1, −31.4, 0.0)
  (s 250, the road ahead where the bend swallows it).
- Lens: **50 mm (27°)**.
- DOF: focus follows the car.
- Handheld 0.1.

**On screen.**
- Two black walls of pine, 18–25 m tall, rise past both frame edges. Between them, a black ribbon of road.
- Our car passes under the lens and goes away from us.
- Its beam-pool slides along the right-hand wall as it takes the left-hand bend: lit trunks, and needles silvered by
  rain.
- Its taillights are tiny and red, and are swallowed by the trees at 42.8.
- The sagging power line runs along the left.
- 41.6: a cloud-to-cloud flicker (strength 0.2) silhouettes the crown line of the walls against the clouds for 0.2 s.

**Light events:** car beams; flicker at 41.6; meter **hold**.

**Sound:**
- the car's pass under (doppler);
- then only rain on the needles and wind;
- `thunder_distant` at 43.0.

**Faces:** the car is seen from above and behind.

### S7: 48 and eyes, 43.4–50.4 (car POV)

**Camera.**
- Eye: `DRIVER_EYE`.
- Target: (0.3, 30, 1.0) → following the sign (2.0, 10, 2.2) at 47.4–48.9 → back to (0.8, 30, 1.0) → toward the
  deer (3.5, 30, 1.1) at 49.4.
- Lens: **24 → 28 mm**.
- DOF: focus 40 m → 15 m → 35 m.

**On screen.**
- 43.6: a green rectangle ignites out of the black about 110 m ahead on the right. It is retroreflective sheeting
  catching our beams. It grows: **NEXT SERVICES 48 MI** in white, with crisp stroke-font legend (§7.6). Its glow
  lights nothing else.
- It slides past at 48.9, then dull from the back.
- **49.2: in the tree line on the right, about 40 m ahead, three pairs of eye-shine glints** at 1.0–1.2 m height,
  greenish-white and unmoving. All of them look at the car.
- 49.9: one pair goes out (that doe turns her head). A pale flank shows for a moment at the edge of the beam.
- 50.2: the others go out. Cut.

**Light events:**
- car low beams;
- retro sign at ≈ 30 cd/m²;
- deer eye-shine (§7.11).

**Sound:**
- the engine;
- one wiper thunk;
- at 49.5 a single hard intake of breath: `drv_startle`, existing, gain 0.6.
- No music.

**Faces:** none. The deer show only eyes and a flank.

### S8: ROOMS, 50.4–56.6 (car POV)

This replaces the old shots 3 and 4 and becomes C7's sign POV source (§7.1).

**Camera.**
- Eye: `DRIVER_EYE`.
- Target: (2.6, 160, 2.0) → (2.2, 40, 2.1). This tracks the ROOMS board on `P_SIGN`; see §7.1 for converting it
  from a PLAN target.
- Lens: **28 → 40 mm**.
- DOF: focus 60 m.

**On screen.**
- At the end of the straight, a single warm point. It is the only light that is not ours. It is a real ≈ 12 cd
  kerosene flame in a tin box, with bloom only and no sprite.
- It grows: the post, the GAS & FEED board with GAS painted out, the hand-lettered ROOMS board and the VACANCY plate
  swinging in the lantern light. The wet road under it reflects a long warm streak.
- 51.4 and 53.6: the engine coughs. The cluster flickers and the radio cuts out mid-static.
- **55.8: the engine dies.**
  - The cluster goes dark, then the red BATT and OIL lamps come on. This is correct: key on, engine stopped.
  - The fuel lamp keeps blinking.
  - The headlights sag to 35 % from the voltage drop, and the beams turn orange (2600 K).

**Light events:**
- `L_LANTERN`, existing, `bake_flicker`;
- dash off and warning lamps on at 55.9;
- headlights ×0.35 and 2600 K at 56.1.

**Sound:**
- 51.4 and 53.6: `engine_sputter`;
- 55.8: `engine_stall`;
- engine and radio loops stop;
- tyre hiss continues, falling;
- `vacancy_creak` at 54.4 (spatial at `P_VACANCY_PLATE`).

**Faces:** POV.

### S9: The gate, 56.6–62.0 (PLAN)

**Camera.**
- Position: by the sign post under the lantern, (−3.2, −27.6, 2.4) → (−3.0, −27.7, 2.3).
- Target: (14.0, −30.6, 0.9) → (2.8, −30.2, 0.9) (the stopping car).
- Lens: **35 mm**.
- DOF: focus 12 → 6 m. The VACANCY plate swings soft in the top-left foreground.
- Handheld 0.25.

**On screen.**
- The dying car rolls out of the dark into the lantern's warm pool.
- The weak orange headlights glare past the lens. They are off-axis by 23°, a soft flare, and they hide the cabin.
- Gravel crunches. It stops at 61.0, nose 6 m from camera.
- 61.6: the headlights die.
- Rain hisses on the hot hood: a faint steam wisp rises from the hood seam, cooling.

**Light events:** headlights off at 61.6; lantern; meter adapts normally.

**Sound:**
- `tyres_gravel` from 59.0;
- `vacancy_creak` at 60.2.

**Faces:** the headlight glare plus the wet windscreen reflecting the lantern and sky. The proxy silhouette is never
lit from the front.

### S10: The house, 62.0–69.0 (PLAN POV from the dead car)

This keeps `CAM.c1_house_reveal`.

**Camera.**
- Position: (2.6, −30.1, 1.15) → +(0.02, 0.05, 0.02).
- Target: (3.5, 0, 5.5).
- Lens: **50 → 44 mm**.
- The view runs through the passenger window of the mounted interior. The door frame and B-pillar frame the house,
  and the medal swings soft in the foreground.

**On screen.**
- Black field.
- **62.8: lightning, strength 1**: the peeling clapboard house on the rise, its nailed shutters, the dead pump, one
  window right of the door leaking candlelight.

**Sound:** `score_reveal` stinger at 62.9; `thunder_near` at 64.3.

**Voice:** `b01_put_me_up` (`c1:engine_dead`, existing) at 65.0: *"Forty-eight miles to anything… They'll have to
put me up for the night."*

**Arms:** hidden.

**Faces:** POV, looking away from the driver.

### S11: Step out, 69.0–75.0 (PLAN)

This keeps the existing path, with the framing fixed.

**Camera.**
- Start ≥ 0.9 m from the tail-lamp lens: `plate + (0.95, −0.35, 0.05)`.
- The path rises: `plate + (0.3, 1.2, 0.85)` → (3.3, −28.1, 1.6) → CP1.
- fov 40 → player.

**On screen.**
- The plate RVX-318 and the trunk lock.
- The left tail lamp is at the frame edge, never filling it. It is red with a hot filament core and cube-corner
  texture (§7.8).
- The camera rises into the rain and settles on CP1's view up the drive.

**Cues kept from today's C1:**
- latch at 69.4;
- `windshield_rain` off;
- `weather` inside 0, surface gravel;
- `coat_rustle`;
- `door_slam` at 70.8;
- flashlight on and arms visible (`arms_idle`) at 73.8;
- `player` at CP1 at 75.0;
- letterbox out 73.0–74.8.

**Faces:** none.

---

## 5. Lighting design

### 5.1 Lights, with physics

Runtime convention: SpotLight and PointLight `intensity` is in **candela**. Lightmaps hold irradiance (CLAUDE.md).
Every light below is created at load at intensity 0 and prewarmed in the warm-up renders, so no shader variant
compiles in C0 or C1.

**`L_HEADLIGHT_L/R`, low beam, our car** (layout ids kept; values replaced, §10).
- Type: SpotLight with a beam cookie, §7.2.
- Position (car space): (±0.58, 2.43, 0.64), the lamp centres from `sedan.py` (`zg` 0.64).
- Photometry:
  - Source: a 1980s US 4 × 6 in rectangular halogen sealed beam (low, H4656 class), ≈ 700–1000 lm. Pattern per
    lamp:
    - hot spot **15 kcd** at 1.5° down / 2° right, σ 5° h × 1.5° v;
    - spread 3 kcd, σ 18° × 3° at 2° down;
    - foreground 1 kcd, σ 40° × 8° at 6° down;
    - above-horizontal limit ≈ 700 cd (soft US cut-off, a gradient not a step).
  - Integrated ≈ 720 lm per lamp.
- Colour: 3200 K. 2600 K and ×0.35 after the stall (S8).
- Shadow: Max both lamps (1024); Medium one combined shadow from the midpoint (1024); Low none.
- When: C0 and C1 throughout, until 61.6.

**High beam, our car** (the same two lights with a second cookie lobe).
- Inner lamps (H4651 class): +30 kcd at 0°, σ 3° × 2°.
- 3200 K.
- When: the two flashes at 32.4 and 32.6.

**`L_TRUCK_HI_L/R`** (new).
- Type: SpotLight with a cookie.
- Position (truck local): (±0.85, front, 1.10).
- Photometry: about 1500 lm per lamp, peak **35 kcd**, hot σ 3° × 2° aimed 0.5° down, plus a spread of 4 kcd σ 15°.
- Colour: 3300 K.
- Shadow: one shadowed lamp on Medium and Max (512, updated each frame during S5 only), for the A-pillar sweep.
- When: S4c 29.0 → S5 37.8.

**Truck clearance and marker lamps.**
- Emissive only, no light: 5 cab-roof amber lamps plus 4 amber side markers.
- Each ≈ 4 cd, about 400 cd/m² over a 25 cm² lens, 590 nm amber.
- Red taillights 2 + 2.

**`L_DOME`** (new).
- Type: SpotLight pointing straight down, angle 80°, penumbra 1 (approximates a Lambertian lens).
- Position (car space): (0, −0.40, 1.29), under the headliner.
- Photometry: a 211-2 festoon (12.8 V, 12 cp) behind a yellowed lens, ≈ 120 lm. I₀ = Φ/π ≈ **38 cd**.
  - Map at 0.80 m and 54° off-nadir: ≈ **27 lux**.
  - Seat cushions ≈ 10–15 lux.
- Colour: 2800 K.
- Shadow: Medium and Max 512, bias 0.0005.
- When: 18.4–28.6.

**`L_DASH`** (repositioned and retyped, §10).
- Type: SpotLight from the cluster toward the driver, angle 35°.
- Position (car space): (−0.37, 0.70, 0.84) → aim (−0.37, −0.10, 0.80).
- Photometry: dial graphics ≈ 3 cd/m² over 0.035 m² gives **≈ 0.1 cd**: ≈ 0.5–1 lux on the gloves and rim.
- Colour: green-aqua, linear sRGB ≈ (0.30, 0.86, 0.66).
- Shadow: none.
- When: C0 shot 4 → C1 55.9.

**Cluster and VFD emissives.**
- Dials 3 cd/m².
- Needles 8 cd/m², orange-red (0.95, 0.35, 0.12).
- Warning lamps:
  - fuel and SES: amber, 80 cd/m²;
  - HI BEAM: blue, 40 cd/m²;
  - BATT, OIL, BRAKE: red, 60 cd/m²;
  - turn arrows: green, 50 cd/m².
- Radio VFD segments: 300 cd/m², blue-green (0.25, 1.0, 0.85).
- PRNDL backlight: 2 cd/m².
- When: while the engine runs. After the stall, only the warning lamps.

**`L_CAB_VEIL`** (new): the headlight backscatter fill.
- Type: SpotLight from (0, 1.6, 1.2), aimed at (0, −0.6, 0.8), angle 70°.
- Photometry: rain in the beams scatters at about 0.05–0.15 cd/m² across the lower windscreen. That gives ≈
  0.1–0.3 lux on forward-facing cabin surfaces, so **≈ 1 cd**.
  - Scaled by `headlights × rain × (0.7 + 0.3·glassWet)`. It rises as the film builds between wiper strokes and drops
    after each stroke.
- Colour: 3400 K.
- Shadow: Medium and Max 256 (the dash must shade the footwells).
- When: whenever the headlights are on, in POV shots.

**Moon and sky** (existing atmosphere).
- Overcast moonlit night ≈ **0.01–0.03 lux** on the ground.
- Sky zenith ≈ 0.0098 cd/m²; horizon about a third of that (`REALISM-STATUS` #15).
- Graded cool and desaturated.

**Lightning** (existing).
- 3–4 pulses in about 0.4 s, 7500–9000 K, hard shadows.
- C0 shot 1: 0.7. C0 shot 2: 0.9. C1 S6: 0.2. C1 S10: 1.0.
- The outdoor shadow box must centre on the **cutscene camera** (§7.5).

**`L_LANTERN`** (existing).
- A flat-wick kerosene lamp ≈ 10–15 cd, 1950 K.
- The layout's 60 W gives 4.8 cd. The lead decides whether to raise it to 150 W (12 cd).

**What actually lights the road.**
- Illuminance from both low beams on wet asphalt (albedo 0.05) at the 0.64 m mount:

  | Distance | Illuminance | Luminance |
  |---|---|---|
  | 10 m | ≈ 5 lux | 0.08 cd/m² |
  | 20 m | ≈ 2.4 lux | 0.04 cd/m² |
  | 40 m | ≈ 0.3 lux | 0.005 cd/m² |

- So the wet road itself stays almost black. **That is real, and the frame must not fake it brighter.** What reads,
  as in real night driving:
  - the **gravel verge** (albedo 0.15) and **tree trunks facing the car**. At 20 m and 6 m off-axis, a trunk
    receives ≈ 6 lux, which gives 0.3 cd/m², ≈ 7× the road;
  - **lit rain streaks and haze** in the beams;
  - the **faded centre line** (paint 0.35 plus wet retroreflection ≈ 30 mcd/m²/lx);
  - **retroreflectors**: delineators and signs at RA ≈ 35–70 cd/lx/m² glow at 10–50 cd/m²;
  - **specular streaks** of every light source on the wet road. The truck's high beams give long vertical streaks;
    GGX at roughness 0.1–0.2 grazing produces them.

### 5.2 Exposure: what the eye-adaptation system should do

The meter (`src/render/exposure.ts`, `look.ts`) sets exposure = key 0.034 / Lavg. Lavg is the log-mean of the
60–99.5 % luminance window, clamped to **0.25–24**. Brightening has τ 6 s, darkening τ 0.5 s, the flash hold is
0.8 s, and a cut snaps the meter.

C0 and C1 need **one new cue**, `{type:'exposure', hold?, biasEV?, min?, max?, meterLow?, tauDarken?}` (§7.4), and
these per-shot settings:

| Shot | Metered Lavg (cd/m²) | Expected exposure | Setting | What the frame should look like |
|---|---|---|---|---|
| C0 shot 1 aerial | ≈ 0.0014 (sky band, beams, canopy tops) | 24 (clamp) | max 24, flash hold | Canopy −1.8 EV under key; sky band +2 EV; beams +5 EV (bloom). Flash: canopy ≈ +4 EV, cloud deck clips. |
| C0 shot 2 billboard | sky ≈ 0.005 at the snap | ≈ 7 | **hold**; bias −0.5 | The lit poster reads bright and textured, not clipped flat; wires are black lines on cloud. |
| C0 shot 3 crane | ≈ 0.003 | ≈ 11 | hold | The car's pool is bright; walls black; reflectors pop. |
| C0 shot 4 glass | ≈ 0.02 | ≈ 1.7 | adapt | Drops lensing the beams; the cluster glows. |
| C1 S1/S3/S7 POV | ≈ 0.04 (windscreen veil, verge, cluster) | ≈ 0.85 → **1.7 with bias +1** | biasEV +1.0, meterLow 0.45 | Cabin forms (gloves, rim, binnacle, A-pillars) −1 to −2.5 EV, legible; verge +1.5 EV; dials +4 EV. |
| C1 S2 diner | ≈ 0.002 at the snap | ≈ 17 | **hold** | Black lot. The headlight rake arrives bright (+3–4 EV on the plywood) and leaves. |
| C1 S4a/b dome | ≈ 2.5 (map 6.5, headliner 5, seats 1.1) | 0.014 → **needs min 0.01** | min 0.01 for 17.6–37.8 | Warm and legible. The map's white paper sits about +1.5 EV, not clipped. The windscreen is a dim mirror. |
| C1 S4c dome off | → 0.01 | climbs 0.02 → 1.7 over ≈ 6–10 s | adapt | 2–3 s near-black (night blindness), then the cluster and the verge return. The truck glow is visible early because it is bright. |
| C1 S5 truck | rises 0.05 → ≈ 3 at 34.4 | follows to ≈ 0.012 | **no hold**, min 0.01, tauDarken 0.35 | Approach: the lamps bloom. The cabin is lit almost legibly from the front for about 1 s, about +2 EV over at the peak. After the pass, black, with slow recovery. |
| C1 S6 walls | ≈ 0.002 | ≈ 17 | hold | Black walls; the moving beam-pool on the trees; red taillights. |
| C1 S8 ROOMS | ≈ 0.03 | ≈ 1.1 (+1 bias) | biasEV +1 | The lantern is a hot warm point. Its lit board is +2.5 EV, readable. |
| C1 S9 gate | ≈ 0.05 → 0.01 after lights out | adapts | adapt | Lantern pool; after the lights die, a slow brightening. |
| C1 S10 house | ≈ 0.003 | ≈ 11 | flash hold | Existing reveal. |

- **Why the truck has no hold.** A hold would white out the cabin for the whole sweep. The eye is dazzled and
  adapts: the τ 0.5 s darkening keeps the front-lit cabin readable as the lights peak, and τ 6 s afterwards gives the
  real post-glare blindness. The truck's E ∝ 1/d² rises over about 2 s, and the meter can follow that.
- **Grain** stays ISO 800–1600 in POV shots and is heavier at exposure 24 (the aerial), as film would be.
- **Bloom and halation** appear only around real sources: lamps, VFD, needles, lantern, retro sign. No other glow.

---

## 6. Asset spec (Blender lane A, through `scripts/assets.mjs` only)

### 6.1 `sedan_interior` v2: the detailed cabin (rebuild in place; node names kept)

**Frame change.** The root `P_CAR_INTERIOR` is now built in **car space**:
- origin = the ground under the body centre, the same as the `sedan` prop;
- **nose +y** (unchanged);
- **z 0 = road**.

All dimensions derive from `sedan.py`'s `Body`, `L`, `HALF`, `zt()`, `belt()` and `wb()`. Import them so the trim
follows the exterior glass and roof exactly, with 15–40 mm clearance inside the shell. Mounted in the moving sedan,
the interior is at identity in car space.

The reference class is a generic 1980s US front-drive mid-size sedan (no badges). The exterior `sedan` already
matches it: 4.85 m long, 1.74 m wide, 1.37 m tall, wheelbase 2.68 m. The published interior figures used are:
- front headroom ≈ 0.98 m (SAE, H-point + 102 mm);
- shoulder room ≈ 1.43 m;
- legroom ≈ 1.07 m.

**Key dimensions (car space, metres).**

| Element | Value |
|---|---|
| Carpet top at heel point | z 0.29; the toe board rises to the firewall at y 0.95, z 0.45 |
| Driver H-point | (−0.37, +0.05, 0.47). Seat height H30 ≈ 0.18–0.20, low 80s sedan seating |
| **Driver eye** | **(−0.35, −0.05, 1.12)**: H + 0.65, torso 24° back. This is `DRIVER_EYE` unchanged: eye ≈ 1.12 above the road, 0.83 above the floor |
| Headliner (front) | z 1.31; 0.19 m above the eye. 1.30 mid, 1.29 rear |
| Roof (exterior, reference) | 1.372 |
| Windscreen inner glass | Cowl y 0.935, z 0.90 → header y 0.20, z 1.30 (≈ 58° rake from vertical). Laminated, F0 0.04, with a 120 mm blue-green **shade band** at the top (procedural gradient) |
| Dash top (crash pad) | z 0.94 at y 0.58 → 0.905 at the glass. 0.05 roll radius at the edge |
| Binnacle hood lip | (−0.37, 0.62, 0.95), 0.50 wide |
| Cluster face (dials) | Centre (−0.37, 0.72, 0.80), 0.46 × 0.15, tilted 12° back. Clear lens 15 mm in front, tilted 20° |
| Steering wheel | Centre (−0.37, 0.42, 0.80). Ø 0.381 (15 in), rim section Ø 28 mm with finger grips, plane 25° from vertical, 2 spokes at 4 and 8 o'clock, padded horn bar 0.18 × 0.11 |
| Lines of sight from the eye | rim top 19.8° down; binnacle lip 18°; the cluster sits in the rim opening at 21–30° down; hood front edge 8.3°; **road visible from ≈ 7.7 m ahead** |
| Radio face | (0.03, 0.57, 0.72), 0.178 × 0.050. VFD window 0.060 × 0.014 |
| HVAC sliders | (0.03, 0.57, 0.64) |
| Ashtray | (0.03, 0.56, 0.58), open 60 mm |
| Headlamp switch knob | (−0.62, 0.60, 0.80). Push-pull, rotate 40° CCW = dome |
| Front 60/40 bench | Cushion y −0.20 … +0.30, top z 0.53 front / 0.49 rear, width x −0.70 … +0.66, split at x +0.12. Back 24° from vertical to z 1.06. Integrated headrests to z 1.22 (centre y −0.38) |
| Centre armrest | Folds down at x −0.05 … +0.15, top z 0.66, with 2 cup recesses (Ø 0.085) at y +0.05 and +0.18 |
| Rear bench | Cushion top z 0.50, y −1.25 … −0.78. Back up to the parcel shelf (y −1.40, z 0.93) |
| Door cards | Inner face x ±0.715. Armrest top z 0.66. Belt / sill z 0.875. Side glass inner x ±0.74 |
| A-pillar trim | (±0.70, 0.90, 0.92) → (±0.60, 0.20, 1.31), 0.08 × 0.04 |
| B-pillar | y −0.62, with the belt D-ring at z 1.18 |
| Rear-view mirror | Mount (0, 0.30, 1.25). Glass 0.24 × 0.06, prismatic |
| Sun visors | Hinge rods at (±0.40, 0.21, 1.29). Each 0.38 × 0.17 × 0.025, stowed |
| Dome lamp | (0, −0.40, 1.30). Lens 0.23 × 0.09, yellowed |

**Child nodes.** Every existing child is kept with its name:
`P_CAR_INTERIOR-sedan_interior-{cluster, radio, glovebox, steering, wiper_d, wiper_p, mirror, air_freshener_mount}`.
All of them are re-placed to the new dimensions. Their extras are unchanged.

New children (`sedan_interior.<name>` becomes `P_CAR_INTERIOR-sedan_interior-<name>`):

**Gauges**
- `needle_speedo`, `needle_fuel`, `needle_temp`.
  - Extras: `part:'needle'`, `gauge`, `rotate_axis` (the face normal), `zero_deg`, `deg_per_unit`, `range`.
  - Origin on the pivot.
  - The fuel scale is E −45° … F +45°, and "below E" is −52°.
- `lamp_fuel`, `lamp_ses` (amber); `lamp_hibeam` (blue); `lamp_turn_l`, `lamp_turn_r` (green); `lamp_batt`,
  `lamp_oil`, `lamp_brake`, `lamp_belts` (red).
  - Each is a 12 × 8 mm window quad.
  - Extras: `lamp:'warn'`, `warn:<id>`, `emissive_color`.
- `cluster_lens`: clear plastic, `glass_clear`, slightly scratched (procedural).
- `odometer`: decal `gauges` with sub-key `odo`.

**Radio**
- `radio_vfd`: new decal style `vfd`, `lamp:'dashboard'`.
- `radio_seek_up`, `radio_seek_dn`: `part:'button'`, `slide_axis`, `travel_m` 0.003.
- `cassette_door`.

**Controls**
- `headlamp_knob`: `part:'knob'`, `pull_axis`, `rotate_axis`, `dome_deg` 40.
- `stalk_turn`: `part:'stalk'`, `hinge_axis` (the pull for high beam).
- `stalk_shift`.
- `prndl`: decal `gauges` with sub-key `prndl`, backlit.
- `keys`: `part:'dangle'`, pivot at the ring hole. Five keys and a plain plastic fob. Pendulum length 0.07.

**Lighting**
- `dome_lamp`: lens. `lamp:'dome'`, `emissive_color` 2800 K.
- Anchor `light_dome`.

**Visors and hanging items**
- `visor_d`, `visor_p`: `part:'visor'`, `hinge_axis`.
- `visor_photo`: child of `visor_d`; decal `photo`, `photo:'faded'`; 0.10 × 0.15 under a 25 mm elastic strap that
  crosses its upper third.
- `hanger_medal`: St Christopher medal, Ø 25 mm, on a 0.14 m bead chain from the mirror stem. `part:'dangle'`, pivot
  at the stem. The pendulum frequency is 1.33 Hz.

**Seats and armrest**
- `seat_front`, `seat_rear`: static, lightmapped.
  - Vinyl pleats 70–90 mm, 6 mm welt piping.
  - Wear on the driver's outer bolster: crackle normal (procedural), a split seam with foam showing, a duct-tape
    patch.
- `armrest`: `part:'armrest'`, `hinge_axis`, down.
- `cup`: styrofoam 12 oz (top Ø 90, base 60, h 110 mm) with a sip lid, in the armrest recess.

**Dressing**
- `map_folded`: 0.23 × 0.10 × 0.012 on the passenger cushion at (0.32, 0.12, 0.575).
- `map_open`: four accordion panels, 0.46 × 0.42, creases ±6° zigzag, `paper@2s`.
  - The origin sits on the **left-hand grip point**, so the runtime parents it to the arms socket.
  - Both nodes carry `decal:'road_map'`.
  - **UV0 is normalised over the full sheet (0–1) in both states**, so one runtime canvas maps correctly whether the
    map is folded (only the cover panel shows) or open.
- `cassettes`: 3 cases plus 1 loose cassette with 0.3 m of pulled tape (a thin `@2s` ribbon). Decal
  `cassette_label`, handwritten.
- `receipts`: 4 slips, `paper@2s`, decal `receipt`. One is tucked in the defroster vent at (0.15, 0.78, 0.94);
  three are on the passenger seat.
- `cig_pack`: a soft pack, crumpled, no brand mark, red and white. On the dash top at (0.30, 0.74, 0.95).
- `ashtray`: `part:'drawer'`, `slide_axis`, `travel_m` 0.06, open. Five butts.
- `flashlight_seat`: the 2-cell D flashlight at (0.45, 0.0, 0.59). Use the same geometry as the arms rig's
  `flashlight`; ask lane B to instance it from `arms.glb` if that is cheaper.

**Shell (lightmapped)**
- Door cards with vertical pleats, chrome inside handles, window cranks, sill lock knobs, kick-panel speaker grilles.
- `headliner`, with a 30 mm sag bubble near the rear window.
- `dash_cracks`: 3 sun cracks 2–4 mm wide by the defroster vent. Geometry splits, no texture.
- Pedals, under-dash panel, B-pillar belts.
- The existing gloves on the passenger seat are **removed**, because he wears them.

**Wipers.** The interior's `-wiper_d/_p` are contract names and **stay**: they are re-placed to the new cowl and used
by the static CAR set. When the interior is mounted in a moving sedan, they are hidden, and the exterior
`sedan-wiper_d/_p` are the real outside blades.

**Materials.** All existing ids where possible:
- `car_interior_tan` (vinyl 0.35 / 0.55, wet-look sheen);
- `rubber_black`;
- `chrome_pitted`;
- `glass_rain`;
- `glass_clear`;
- `paper@2s`;
- `leather_worn`.

New material ids for the materials lane (§10):
- `vinyl_dash_black`: 0.05 / 0.6, sun-crazed;
- `headliner_cloth`: 0.45 / 0.95;
- `carpet_auto`: 0.12 / 1.0;
- `styrofoam`: 0.8 / 0.5, subsurface-ish;
- `plastic_cluster`: 0.04 / 0.35.

**Budget.**
- Max/Medium ≤ **60k tris**. The existing interior is 7.2k.
- Low ≤ **28k** (the dressing decimates; the lightmapped shell does not).

**Lightmap.** `LM_CAR` is re-baked (UV2 changes), in the same 1024 atlas, so the download size is unchanged.
- The bake contains **sky and moon fill only**: overcast dome through the glass, ≈ 0.01–0.03 lux.
- Everything else is runtime: dash, dome, veil, headlights, truck, lightning.
- C6 (blue hour) re-uses this lightmap with its runtime dawn fill as today. Check C6's look after the re-bake.

**Review renders** (`blender/props/preview.py`, three passes of look, improve and re-check):
- POV at `DRIVER_EYE` 24 mm;
- POV map 35 mm;
- cluster 65 mm;
- passenger-seat glance;
- each with dome on (2800 K, 120 lm) and dash only.
- Acceptance:
  - the binnacle lip, rim and dials sit inside the frame with the windscreen showing ≥ 40 % of a 24 mm frame;
  - the headliner is ≤ 12 % of frame.

### 6.2 Exterior `sedan` additions (ADD nodes; nothing renamed)

- `P_CAR_GATE-sedan-cabin_lo`: the existing low-detail `_cabin_interior` split into its own child, so the runtime can
  hide it when the detailed interior is mounted.
- `-light_low_l/_r` and `-light_hi_l/_r`: anchors at the lamp centres, extras `aim:[0,1,−0.026]` (1.5° down).
- `-driver_proxy`.
  - A dark head-and-shoulders, coat and forearms-to-the-wheel silhouette, 1.2k tris, `cloth_dark` 0.04.
  - No face detail: a smooth ovoid head under a flat cap.
  - Extras: `hide_in:'pov'`.
  - Used by exterior shots and by the windscreen-reflection probe capture (§7.9). Never lit from the front.
- `-tail_l/_r`: lens sub-nodes, with procedural three-chamber layout and cube-corner pattern (no texture). Extras
  `lamp:'tail'`.
- `-hood_steam`: anchor at the hood seam (S9).
- `sedan` budget stays ≤ 60k. It is 28.6k now and will be about 31k.

### 6.3 New props (all `lighting:'dynamic'`, no lightmap atlas, room `RC9`, library `props_road.glb`)

`props_road.glb` is loaded at New Game with the other M1 props. After C1, the runtime disposes everything except
segment A (§7.12).

**`logging_truck` (`P_RC9_TRUCK`).**
- What it is: a generic conventional long-nose tractor and a pole trailer.
  - Day cab, 2.4 m wide, cab roof 3.0 m; hood 2.4 m long; a rusted chrome grille; twin vertical stacks; a headache
    rack.
  - Trailer: 12 m long with 14 logs, Ø 0.35–0.55 × 10–12 m, as **instanced** bark cylinders. The cut ends are
    pale rings (procedural), with stakes and binder chains.
  - Mud flaps.
  - 18 wheels, instanced, `part:'wheel'`, `spin_axis`.
  - 21 m overall.
- Nodes and lamps:
  - `-hi_l/_r` (anchors and lenses, `lamp:'head'`);
  - `-clearance` (5 amber, `lamp:'clearance'`);
  - `-markers` (amber);
  - `-tail` (red);
  - `-spray_l/_r` anchors at the drive axles.
- Faces: the cab interior is an empty dark box with no driver mesh. It is never seen through its glare.
- Tris: Max/Medium ≤ 28k; Low ≤ 6k.

**`diner` (`P_RC9_DINER`, plus the pole sign `P_RC9_EAT`).**
- The building: 12 × 8 m, single storey, 3.6 m flat roof with a parapet, clapboard (`clapboard_peeling`).
  - A 1.0–2.2 m window band boarded with weathered plywood (`plywood_weathered`, new), one board hand-lettered CLOSED
    (decal `hand_lettered`).
  - A cracked glass door with a CLOSED card.
  - A tin awning.
  - A payphone (`-payphone`) with the armoured cord cut and no handset. This reinforces "no phone".
  - A concrete pump island with 4 anchor bolts and no pumps.
  - Gravel lot with puddle strips.
- The EAT pole sign: a 7 m pole and a sheet-metal can 2.6 × 1.1 m.
  - Three letters, 0.9 m tall, made of **glass neon tube geometry** (Ø 12 mm on standoffs).
  - Dead: `glass_clear` with a dusty interior and no emissive.
  - The can is rusted.
- Tris: diner Max/Medium ≤ 12k, Low ≤ 4k. EAT sign ≤ 2k, Low ≤ 1k.

**`billboard` (`P_RC9_BILLBOARD`).**
- Structure:
  - a 30-sheet poster panel 3.7 × 7.6 m (12 × 25 ft), bottom at 3.0 m;
  - three creosoted wooden poles Ø 0.30;
  - a catwalk and 4 gooseneck lamp arms (dead, cracked lenses);
  - the back frame in sawn lumber.
- The face:
  - plywood with two paper layers (decal `billboard`, two text layers, §3 shot 2);
  - **24 peeling strips** curling off as `paper@2s` sheets, with a wind flutter (vertex TSL, runtime);
  - no people in the artwork.
- Tris: Max/Medium ≤ 5k; Low ≤ 2.5k.

**`road_card` (`P_RC9_NEXT_SERVICES`).** Reuses and upgrades the existing generator.
- Params: `{text:'NEXT SERVICES 48 MI', style:'guide_green', w:2.4, h:1.2, hero:true}`.
- Two 4 × 4 in wooden posts, bottom at 2.1 m.
- Green retroreflective sheeting, `sign_sheeting` (new) with a `retro` gain.
- Tris ≤ 0.6k.

**`county_shield` (`P_RC9_CR9_A/B`).**
- A blue pentagon, 0.45 m, "COUNTY" over "9" in yellow, on a U-channel post.
- Tris ≤ 0.3k each.

**`deer` (`P_RC9_DEER_1..3`).**
- Whitetail does: body 1.6 m long, shoulder 0.95 m.
- Poses: head up; ears forward; one mid-turn.
- Fur `fur_deer` (new): 0.18 / 0.8, mostly unseen.
- `-eye_l/_r` anchors: 0.1 m apart, at 1.05–1.2 m height, `eye_glint:true`.
- One shared mesh: Max/Medium 2.5k, Low 0.8k.

**`driver_proxy`.** See §6.2. It lives inside `sedan`.

### 6.4 Corridor: `blender/house/corridor.py` → `details_corridor.glb` (instanced, `EXT_mesh_gpu_instancing`)

**Road mesh.**
- The cross-section in §2: 14 vertices per section, every 2 m on arcs and 4 m on straights, through s 1550.
- Materials:
  - `asphalt_wet` (exists);
  - `paint_road_yellow` (new: albedo 0.35 faded, roughness 0.35 wet, `retro` gain);
  - `gravel_wet`, `mud_wet`;
  - `water_ditch` (rain rings);
  - `leaf_litter_wet` (new: 0.10 / 0.7).
- Beyond s 1500, the tail blends to forest floor.
- UV0 is in metres along s.
- Tris ≈ 9k (Low 6k).

**Trees.** About 1,400 instances.

| Rows | Distance from centreline | Spacing / count | LOD |
|---|---|---|---|
| Edge row | n ±9.5–14 | ≈ 3.5 m (≈ 520) | L0 within 35 m, L1 out to 120 m, then L2 |
| Rows 2–4 | n ±14–40 | staggered ≈ 5 m (≈ 820) | L1 / L2 |
| Tail | s 1250–1550 | – | L2 only |

- Species mix: **70 % `pine`** and 30 % existing bare `hedge`, `ash` and `snag`, with `shrub` understory at the edge.
  - Pines are what make the "black walls": dense conifer silhouettes.
- **New `pine` style in `trees.py`:**
  - eastern white or loblolly character: a straight bole 18–28 m;
  - whorled branch tiers every 0.6–0.9 m;
  - needle masses as jittered, displaced, flattened cone "skirts". Solid geometry, **no alpha cards, no textures**.
  - 3 variants.
  - L0 ≤ 1.8k, L1 ≤ 400, L2 ≤ 70 tris.
  - Wind sway is TSL vertex animation at runtime.
- Existing bare styles are reused at their existing LODs.

**Canopy blanket.**
- One sheet at 18–24 m height, from n ±40 out to ±250, along the whole corridor.
- Crown-bump displacement on a 4 m cell.
- About 8k tris (Low 3k).
- Lets the C0 aerial read as unbroken forest.

**Power line.**
- Instanced `utility_pole` (existing mesh, with a new `crossarm` param), 45 m spans along the path in §2. One pole
  leans 6°; one crossarm is broken.
- Conductors are **not** in the GLB. Export the pole-top attachment points as `userData.path_local` on a
  `P_RC9_LINE` marker. The runtime builds 3 conductors plus a neutral as catenaries:
  - sag 1.2 m per 45 m;
  - one broken conductor hangs to the ditch;
  - drawn with a min-1-px TSL wire shader.

**Reflector posts.** Instanced existing `reflector_post`.

**Instancing data.** TRS accessors, ≈ 40 B per instance → ≈ 30 KB after meshopt.

**Placement rules.** The exclusions in §2. Trees never closer than 1.5 m to the power line; no trees on the road or in
the ditch.

### 6.5 Download budgets

Measured bytes per triangle with meshopt today: props_m1 is 17.4 B/tri on Max and 19.8 on Low.

| Item | Max/Medium tris | Low tris | Max/Medium MB | Low MB |
|---|---|---|---|---|
| `sedan_interior` v2 (net of the old 7.2k) | 60k (+53k) | 28k (+21k) | +0.92 | +0.42 |
| `sedan` additions (proxy, cabin_lo split, lamp lenses) | +2.5k | +1.5k | +0.05 | +0.03 |
| `logging_truck` | 28k | 6k | 0.49 | 0.12 |
| `diner` + EAT | 14k | 5k | 0.24 | 0.10 |
| `billboard` | 5k | 2.5k | 0.09 | 0.05 |
| Signs and shields | 1.2k | 1.2k | 0.02 | 0.02 |
| `deer` (shared) | 2.5k | 0.8k | 0.04 | 0.02 |
| Road mesh | 9k | 6k | 0.16 | 0.12 |
| Pine ×3 (L0 + L1 + L2) | 6.8k | 1.4k (no L0) | 0.12 | 0.03 |
| Canopy blanket | 8k | 3k | 0.14 | 0.06 |
| Instance TRS (≈ 1,450) | – | – | 0.03 | 0.03 |
| New arm clips (5, §7.1) | – | – | 0.10 | 0.10 |
| **Total new** | | | **≈ +2.4 MB** | **≈ +1.10 MB** |
| **Tier after** | | | **Medium ≈ 43.9 / 60; Max ≈ 61.2 / 120** | **Low ≈ 24.7 / 25** |

**Low is the binding constraint.**
- It has 1.39 MB of headroom today, and this spec uses about 1.1 MB.
- The three new voice takes add about 0.14 MB, so Low lands at ≈ 24.85 / 25.
- That leaves almost nothing for CUTSCENES-PLAN's other additions, and its §7 budget table (Low "now 20.9") is
  stale.

**Low fallback ladder.** Apply these in order until `node scripts/assets.mjs --check` passes:
1. Truck mesh on Low: lights, spray and a 1.5k box silhouette only (−0.09). It is seen for 0.45 s in glare.
2. Diner on Low: box, boards and EAT can only, 2.5k (−0.05).
3. Canopy blanket on Low at 1.5k (−0.03).
4. Interior dressing on Low: cassettes, receipts and ashtray butts become decals (−0.05).

The lead decides whether the Low budget moves or other features move (§10).

### 6.6 Per-frame budgets

These are estimates; the QA round verifies them with `--fps`.

| View | Triangles | Draw calls | Shadowed lights |
|---|---|---|---|
| POV interior | interior 60k + sedan 31k + trees in 90 m (L0/L1) ≈ 150k + road ≈ **0.25 M** | interior merged by material ≈ 30 + trees (species × LOD ≈ 12) + road 6 + fx ≈ **80** | 3 on Medium (headlight-combined, veil, dome); Max adds the second headlight and the truck spot during S5 |
| C0 aerial | canopy 8k + ≈ 900 visible trees, mostly L1/L2, ≈ 120k + road ≈ **0.15 M** | **≈ 40** | – |
| S5 truck | the POV figure + truck 28k + spray particles | – | – |

All of these are within ≤ 1.5 M triangles and ≤ 400 draw calls on Medium.

---

## 7. Runtime tasks for the next round (`src/**`, after the lighting/camera lane lands)

Each task ends with a `node scripts/shot.mjs --dist scratch/dist-opening …` check: one headless Chrome, at most 2
frames per look, three look-improve passes.

### 7.1 Cutscene runtime (`src/cutscenes`, `src/world/cutscene-fx.ts`)

1. **Rewrite `c0-road.ts` and `c1-empty.ts`** to §3 and §4.
   - Export **named** shots (`C1_SHOTS.pov`, `C1_SHOTS.rooms`) and re-point `c7-keeping.ts`. It indexes
     `c1Shots[0]` and `c1Shots[4]` today, and the indices change.
   - C7 also reuses C1's vehicle track: shift it to S8's segment.
2. **Mount the interior in the moving car.** While a C0 or C1 shot has `space:'car'`:
   - parent `P_CAR_INTERIOR` to `P_CAR_GATE` at identity car-space (yaw π relative to the `sedan` prop's −y nose);
   - hide `sedan-cabin_lo`;
   - hide `driver_proxy` in POV shots.
   - Restore on release.
   - **One rain layer only.** `windshield_rain` builds its drop/film mesh on the CAR set and on both sedans. When the
     interior is mounted, use the **exterior** sedan's layer, because its `sedan-wiper_d/_p` are the visible blades.
     Disable the interior's layer and hide `sedan_interior-wiper_d/_p`.
   - **C6** also drives the gate sedan with `space:'car'` POVs (P_CAR_ROW). Apply the same mount there so its cabin
     matches C1's, not `cabin_lo`.
   - **C7 (sting) stays on the static CAR set.** The new frame equals car space, so `inCar(DRIVER_EYE, CAR_SET)`
     frames correctly, and `P_AIR_FRESHENER`, a PLAN-anchored placement at (100.8, 1.95, 0.95), keeps hanging where
     it is.
     - C7's dressing: hide `hanger_medal`, show `P_AIR_FRESHENER`, `car_trim` maroon, fuel lamp blinking.
     - C7's sign POV re-uses C1 S8 on the moving sedan (mounted interior with the same sting dressing), or a cut
       hides the swap.
   - The CAR set is hidden during C0 and C1.
   - Re-tune the CAR set constants (`gauge`, `gaugeEye`) to the new interior.
3. **Second vehicle track** (`vehicles: { car, truck }`) with per-track pose for `P_RC9_TRUCK`.
   - Also a `road` path helper: `roadPose(s, n)` from `road-rc9.json`, with `heading:'path'`.
   - The tests must exempt `car` and `car0` eyes from the room-rect check, as today.
4. **Arms only in POV shots.** `visible` is derived from the shot (`space:'car'` and `pov:true`), not from global
   cues.
   - New clips (Blender anim lane, §10):
     - `arms_radio_seek` 2.4 s;
     - `arms_headlamp_knob` 1.6 s (on, and reversed for off);
     - `arms_map` 6.0 s: pick up 1.2, unfold against the rim 1.6, trace with the right index 2.2, lower 1.0. Uses a
       `prop_l` socket for `map_open`;
     - `arms_stalk_flick` 1.0 s;
     - `arms_brace` 1.2 s.
5. **New fx and cues.**
   - `dome {on}`: ramps `L_DOME`; 80 ms on; 150 ms orange tail off.
   - `dash` gains `stalled:true` (BATT and OIL on) and `hibeam:bool`.
   - `radio {seek:'fm'|'am'}` drives the VFD canvas digits in sync with `radio_seek`.
   - `needle` slosh.
   - `truck_pass` sync.
   - `spray {on}`.
   - `exposure` (§5.2).
   - `title` (DOM).
6. **Prewarm.** `L_DOME`, `L_CAB_VEIL`, `L_TRUCK_HI_L/R` (shadow variant), the truck and diner materials, the
   corridor materials and the map canvas, all rendered once during the room warm-up. Add one warm-up view from the
   corridor.

### 7.2 Headlights: a real beam (`src/render/flashlight.ts` pattern; `src/world/lights.ts`)

- **Beam cookie.** A procedural 2-D intensity table I(h, v) built at load from the lobes in §5.1, in a 128 × 64
  DataTexture: no download.
  - First check `node_modules/three/src` (r186) for `SpotLight.map` support in `SpotLightNode` / `LightsNode` on
    WebGPU and in the WebGL2 fallback.
  - If it isn't supported, override the spot attenuation in a `SpotLightNode` subclass that samples the cookie by
    the light-space direction.
  - Low beam and high beam are two cookies, or one with a `hibeam` mix uniform.
- **Intensity in cd from the cookie, not from `watts/4π`.** Add the `cd`, `beam` and `kelvin` overrides to the layout
  lights (§10).
- **Wet asphalt.** Specular from all the spots (our beams don't reflect back to us; the truck's do, as long streaks).
  Ruts at roughness 0.08 and the crown at 0.18.
- **Lit rain.** Rain streak particles evaluate the beam cookie analytically, so rain shows only inside beams and in
  the veil. Use the same for the truck.
- **Volumetric beams.** Extend the existing volumetric flashlight beam to the headlights in C0 and C1. Medium: one
  merged cone. Max: two.

### 7.3 Windscreen rain, wipers, spray (`windshield_rain`, `wipers`)

- Drops **refract**: each drop samples the scene colour behind it, flipped and minified (a lens). Under a bright
  light, the drops become points of light.
- Physical rain:
  - drops on the glass 1–4 mm;
  - impact rate from rain intensity (heavy ≈ 25 mm/h);
  - airflow pushes drops up the glass above ≈ 15 m/s;
  - the film thickens between strokes;
  - the wiper leaves a thin streaked arc.
- `wipers` period 1.25 / 0.75 (fast), phase control so C0 can match-cut.
- Spray: a sheet event (film 0.9 for 0.4 s) and 400 large drops.
- The glass luminance carries the scatter of oncoming light. This is what makes the truck "fill the windscreen".

### 7.4 Camera, lens, exposure (`src/render`, coordinate with the lighting/camera lane)

- Per-shot near and far planes: POV near 0.05 / far 600; C0 aerial near 1.0 / far 2000.
  - Check depth precision on r186 WebGPU (reversed-Z support) and on the WebGL2 fallback.
  - Road lines are geometry 5 mm above the asphalt with polygon offset.
- Use the CUTSCENES-PLAN §5 render profile: DOF on Medium/Max, a rack becomes a cut on Low, motion blur on Max.
- **`exposure` cue**: `hold`, `biasEV`, `min`, `max`, `meterLow`, `tauDarken`, restored on release. Values per shot
  in §5.2.
- **Outdoor lightning shadow box** (60 m ortho) centred on the cutscene camera, not the player.
- The `look` profiles: C0 fog 0.003, C1 0.0045, rain 1, wind 0.5–0.6; skyglow off ("no town").

### 7.5 Atmosphere (`src/world/atmosphere.ts`)

- A **far-ridge layer** in the sky shader: three ridge silhouettes with crown-fringed tops at 0–1.5° elevation, in
  front of the cloud deck.
  - Dark against the overcast; black against the lit cloud base during lightning.
  - No geometry. On in C0 only.
- Rain sound and visuals over the forest: rain streaks against the black walls only where lit.

### 7.6 Sign lettering and decals (`src/world/decals.ts`)

- Hero decals get a resolution by role.

  | Decal | Canvas (Max/Medium) | Canvas (Low) |
  |---|---|---|
  | `road_card` hero | 2048 × 1024 | 1024 × 512 |
  | ROOMS board | 1024 × 512 | 512 × 256 |
  | `billboard` | 2048 × 1024 | 1024 × 512 |

  - Mipmaps on; anisotropy 8 where supported.
- Stroke font: "Series E"-like road proportions for guide signs; brush style for ROOMS; hand style for the map's ink.
- **Retroreflection** on `sign_sheeting`, `paint_road_yellow` and `reflector_post`:
  - add `retro × E_light × f(α)` toward the camera, where α is the angle between the camera and the headlight seen
    from the surface (σ ≈ 1°);
  - so the sign blazes from the driver's seat and is dull from an exterior camera.

### 7.7 Lantern

- Remove the sprite flare.
- `L_LANTERN` becomes a small emissive flame (≈ 12 cd) behind glass, with bloom and halation only, so it is a hot
  pixel cluster at 160 m.
- A horizontal bloom streak only if it comes from the CUTSCENES-PLAN threshold pass.

### 7.8 Tail lamps and lamps in general

- Lamp glass material: a hot core around the bulb anchor with falloff to the lens edges, and a cube-corner relief
  normal.
- Physical luminance:
  - tail: 21/5 W bulb, ≈ 4 cp running → ≈ 100–200 cd/m² over the lens;
  - brake: ×5.
- Clamp the AgX highlight hue shift for red lamps so they read red-orange, not pink: a pre-tonemap hue-preserve on
  emissive-only pixels.

### 7.9 Dome-on windscreen reflection

- The windscreen's inner reflection uses the CAR probe re-captured at load **with the dome on and the
  `driver_proxy` visible**: a black silhouette lit from behind, no face.
- It is mixed by the dome level × Fresnel (≈ 0.09 at 60°).
- Medium/Max only. On Low, the dome only darkens the outside.

### 7.10 The road map canvas (lane B, `src/world/decals.ts`)

- Size: 2048 × 2048 on Max/Medium, 1024 on Low.
- Content:
  - aged off-white paper (albedo 0.75) with fold-crease shading;
  - state-forest green fills;
  - the I-58 red double line and the CARVEL town dot;
  - County Road 9 as a thin black wandering line;
  - two red junction dots with a red **48** between them;
  - legend box, scale bar, compass;
  - the hand-drawn ballpoint X and arrow (stroke font, hand style).
- No real place names besides the game's own.

### 7.11 Deer eye-shine (`eye_glint` fx)

- Generalise `eye_glint {at}` to retro glints: 3 mm discs at the deer eye anchors.
- Luminance = tapetum retro gain × the headlight illuminance at the eye × f(α). Greenish-white (0.85, 1.0, 0.8).
- Visible from the POV only.
- `off` per pair, timed (S7).

### 7.12 Memory and loading

- Load `props_road.glb` and `details_corridor.glb` before C0. They are not in the first-frame path:
  `verify-boot` still holds.
- After C1, dispose everything except segment A (s 0–240), which C7's ROOMS POV re-uses.

### 7.13 Audio (`src/audio`, lane C)

- New synth sfx and loops:
  - `radio_seek` (FM/AM variants);
  - `knob_click`, `map_paper`, `stalk_click`;
  - `truck_pass`: a 4.5 s doppler event with diesel rumble, tyre roar, spray hiss and a wind thump;
  - `air_horn`: two-tone chord with a doppler slide;
  - `spray_hit`;
  - `tyres_wet` loop, gain by speed;
  - `car_pass_by` (exterior doppler);
  - `rain_leaves`, `rain_tin`, `wire_wind`.
- The interior bed lowpasses the exterior: a 1.8 kHz crossfade on the C0 glass pass.

### 7.14 UI (`src/ui`)

- The C0 date card.
- The title "THE KEEPING" with the byline **"a game by Raj Vardhan Singh"** (system serif stack, no web fonts).
- Subtitles for the three new lines.

---

## 8. Voice

The two existing driver lines are reused: `b01_come_on` (`c1:fuel_chime`) and `b01_put_me_up` (`c1:engine_dead`).

There are **three new short lines**, at most 2 s each. They go into `voice-script.json` through `build-voices.mjs`;
the lead approves (§10). Until the key exists they appear as subtitles.

```json
{ "id": "c1_preacher",   "speaker": "driver", "trigger": "c1:radio_seek", "text": "[flat, tired, to the radio] Nothing. Not even a preacher." }
{ "id": "c1_interstate", "speaker": "driver", "trigger": "c1:map",        "text": "[under his breath, finger on the map] Should've stayed on the interstate." }
{ "id": "c1_dim",        "speaker": "driver", "trigger": "c1:truck",      "text": "[squinting, sharp] Dim your lights—" }
```

`drv_startle` (existing) is used at gain 0.6 for the deer.

---

## 9. Faces-hidden audit

| Shot | Risk | Control |
|---|---|---|
| C0 shot 2, shot 3; C1 S2, S6, S9 (exterior car) | The driver visible through glass | `driver_proxy` (no face geometry), never lit from the front; wet glass; glare (S9) |
| C1 S4a–c (dome on) | The windscreen reflects the driver | The probe capture shows only the proxy silhouette, backlit by the dome |
| C1 S4c | The visor photo | Sun-bleached, strap across it, defocused, ≤ 1.2 s |
| C1 S5 | The truck driver | No mesh; dark cab behind glare; 0.45 s pass |
| All POV | The rear-view mirror | Probe-only reflection of the rear cabin and window; never a planar render |
| Billboard artwork | People in the poster | No figures; type and objects only |

---

## 10. Requests for the lead (files I don't own)

1. **Layout** (`level-layout.json`).
   - Add room **`RC9`**: exterior, rect [70, −420, 1500, −10]. It touches EXT2 only at x 70, avoids the CAR set
     (y ≥ 0), and has no atlas. Road x 20–70 sits between rooms; the car is in car space there.
   - Add the props in §2 and §6.3 (`P_RC9_*`), all `lighting:'dynamic'`.
   - Add lights `L_DOME`, `L_CAB_VEIL`, `L_TRUCK_HI_L/R` with `mode:'runtime'`.
   - **Replace** `L_HEADLIGHT_L/R` (3000 W at 4200 K) with `cd`, `beam` and `kelvin` (3200) fields, per §5.1.
   - Retype `L_DASH` to a spot at the new cluster position.
   - CAR room `ceiling` 1.15 → **1.34** (probe box), and its z band 0 → 1.34.
   - Optionally `L_LANTERN` 60 → 150 W (12 cd).
2. **`src/shared/road-rc9.json`**: the corridor definition in §2, shared by Blender and the runtime.
3. **`sedan_interior` frame change** to car space (§6.1).
   - `DRIVER_EYE` stays (−0.35, −0.05, 1.12).
   - `stage.ts`'s `gauge`, `gaugeEye` and C6/C7 set targets need re-tuning.
   - Log it in `CONTRACT-CHANGES.md`. Another lane is editing it now, so I did not touch it.
4. **The pine air freshener is the sting's tell.** DESIGN.md lines 67 and 691; `P_AIR_FRESHENER` is
   `stingOnly:true` and C7 shows it.
   - Your C1 cabin list includes it. I substituted a **St Christopher medal** (the patron saint of travellers) on the
     same mirror mount, so C7's pine tree still says "a different car".
   - If you want the pine in C1, the sting needs a different tell.
5. **Voice**: approve the three lines in §8.
6. **Budgets**: Low lands at ≈ 24.85 / 25 with this spec (§6.5).
   - Either approve the Low fallback ladder, or raise Low (for example to 27 MB), or cut elsewhere.
   - CUTSCENES-PLAN §7's budget table is stale.
7. **P_NEXT_SERVICES in EXT1** (x 18.6) duplicates the new hero sign 257 m away.
   - Change its text to **"CARVEL 48"** (decal text only, no re-bake), or hide it.
8. **Materials lane** (`material-spec.json`): new ids
   - `vinyl_dash_black`, `headliner_cloth`, `carpet_auto`, `styrofoam`, `plastic_cluster`;
   - `plywood_weathered`, `sign_sheeting` (retro), `paint_road_yellow` (retro);
   - `leaf_litter_wet`, `fur_deer`, `cloth_dark`, `water_ditch`.
9. **Characters / anim lane.**
   - The five arm clips in §7.1.
   - Close-up glove quality: knuckle articulation readable at 35 mm from 0.4 m (the lead's "hands are blobs").
   - Brown leather driving gloves with perforated backs, knuckle holes and a wrist snap.
10. **Ownership.** This doc belongs to the opening workflow. Runtime integration is the next round, after the
    lighting/camera lane finishes `src/render`.

---

## 11. Verification plan (what "done" looks like)

Each frame below gets `node scripts/shot.mjs --dist scratch/dist-opening --preset medium` (and Low/Max once). Judge
them harshly; three look-improve passes each.

| Frame | Must show |
|---|---|
| C0 4.5 s, 9.25 s (flash) | One car's light pool in black forest; ridges to the horizon in the flash; no lights anywhere |
| C0 15.6 s | Billboard lit by the beams and lightning; wires in the foreground |
| C0 21.5 s | The title over the receding taillights |
| C1 2.0 s | The road visible from 8 m; dials inside the rim; headliner ≤ 12 % of frame |
| C1 13.5 s | The fuel needle below E; the amber lamp halo; DOF |
| C1 20.0 s, 24.5 s | Detailed warm cabin; the map's 48 legible |
| C1 34.4 s | Front-lit cabin and drops of light on the glass |
| C1 41.0 s | Tiny taillights between pine walls |
| C1 49.5 s | The sign's legend crisp; three pairs of eye-shine |
| C1 54.0 s | The lantern a small hot point; the ROOMS board readable |
| C1 63.0 s | The house reveal, unchanged quality |
| C1 61.8 s | **Faces check.** After the headlights die, the lantern front-lights the windscreen from the camera side. The proxy must stay a silhouette behind the lantern's specular on the wet glass. If it reads, darken the proxy or move the camera 1 m north. |
| C0 6–9 s | **Aerial gap check.** No visible seam between the canopy blanket's edge (n ±250) and the sky-shader treeline at the horizon. If there is one, widen the blanket to ±400 m (≈ +3k tris). |
| C1 74.0 s | No pink slab |

The run also needs:
- `--fps` on Medium/WebGPU: ≥ 45 throughout, Low ≥ 30;
- zero console errors;
- the playthrough bot reaching C7 → title (C7 re-uses C1's shots);
- `npm test`;
- `npm run build`;
- `node scripts/assets.mjs --check`.
