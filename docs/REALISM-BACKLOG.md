# Realism backlog (art-direction review, 2026-10-07)

Reviewer: independent AD + rendering engineer, judging against "photoreal, at least Landslide quality".
What I looked at: the QA hero shots (`scratch/qa/*`, 640–800 px copies in `scratch/ad/small/`), plus 9 targeted
shots of my own: Medium `scratch/ad/med-0{1..4}-*.jpg`, Max `scratch/ad/max-0{1..5}-*.jpg`, with the scenarios in
`scratch/ad/look.mjs` and `look2.mjs` (each has per-frame luminance stats in its report). 0 console errors in both runs.

## Round E — AD + perf review of the runtime lane (2026-10-09; log in docs/STATUS-runtime-e.md "Review")

Judged on mains, Blender not running (logged per run; fileproviderd 10–120 % CPU at times), Medium and Max WebGPU,
HEAD f93285d (`scratch/dist-re-base`) vs the builder's dist (`scratch/dist-re-review`) vs the review's final dist
(`scratch/dist-re-final`, npm run build). Frames `scratch/rer2/` (grids gF1/gF2 close-ups, gL1/gL2 lightning,
gS1–gS3 glare), `scratch/rer/rv*`.

### Verdict
Still not photographic. Torch close-ups improved (the glare halo no longer veils the lit prop) but most of the
remaining "CG" read is geometry/material (C0 cone-stack pines, smooth dress bell, flat armoire louvres) and the
Max budget, which this round did not fix.

### Fixed in this review
- **Torch close-ups washed out (props AD top finding).** Not the meter: the centre-weighted p98 at the 13 close-ups
  is ≤ 0.8× display white at exposure 0.25 (sw3), so they are not clipped; lowering the 0.25 floor only turned a white
  dress mid-grey (sw1). The veil was the glare high pass forwarding threshold + excess (a cloth crossing T in the
  2 kcd core jumped from 0 to ≥ T of glare — a disc-shaped onset). Now only the soft-saturated EXCESS scatters
  (`LOOK.glareBase` 0, `pipeline.ts GLARE_BASE`) with `bloomThreshold` 2 (exposed units): halo ring round the core
  smaller, fold/can edges crisper, candle flame keeps its halo (sg1, fclose-med). A highlight-protect cap
  (`hpPct/hpWhite/hpFloor`) caps exposure when the centre p98 would exceed 3× white; it binds in none of the 15 views.
- **Lightning was an overcast-day wash** (shadows ≈ ½ the lit level). `lightningPeak` 0.5 → 0.75, `flashSky` 5 → 2.5:
  same total flash, 4:1 lit:shadow, the sky still flashes +1.3 EV (lt1, gL1/gL2).
- **C1 60.5 draws**: the 8 interior doors (+ boards) are culled with the interior props while the opening holds the
  camera (frame diff = noise): Medium 432 → ≈ 400, Max 768 → 702.

### Confirmed from the builder (measured here)
- C0 first-DOF hitch (item 3) and score_reveal hitch (item 5): Medium base 183 / 133 ms → current 16.8 ms worst.
- Armoire slat view (item 9) on the SETTLED frame: the hall reads through the gaps.
- Item 4 claim "C1 60.5 = 371 draws" was a frustum MESH count; renderer.info draws were 432 (Medium) / 768 (Max).

### Still wrong — ranked (runtime lane unless noted)
1. **Max over budget in the opening and the U1 armoire view**: C1 60.5 702 draws / ≈ 2.4 M tris, 39–50 fps;
   u1-armoire ≈ 800 draws, 44 fps (Max ruling ≤ 500 / 2 M, ≥ 45 fps). Max ≈ 1.6× Medium per room → shadow/context
   passes. Next: per-pass draw breakdown, shadow-caster culling per light.
2. **Max C0 hitch cluster 21.75–22.65 s** (9 frames > 50 ms, worst 533 ms; crane shot as the car passes beneath) on
   a fresh-profile run of the builder dist. Stepped on the final dist the window has 0 node builds, 0 new programs or
   textures (c0b-max2) → not a missing warm-up; suspects: Metal compiling at first draw on a cold cache, or memory
   pressure (Max holds 1.79 GB of GPU resources, 1.66 GB textures, on an 8 GB M1).
   Final dist (pfin-max): sustained 83–167 ms frames 20.63–21.97 s (worst 717 ms) right after the 20.0 title card +
   score_reveal cue, clean when stepped → real-time only (audio/main thread at the cue or DOM cards over a Max canvas).
3. ~~Medium GPU frame +1–10 ms vs HEAD~~ — not a regression: final dist and the runtime-only build match HEAD
   (gpu.mjs rep 2: 15.7/11.2/12.5/9.8 vs 16.1/10.7/12.3/10.1 ms); the earlier excess tracked machine load.
4. **C0 forest (props/Blender, ruling g)**: cone-stack pines and a blurred billboard read as CG in every flash frame.
5. **Ada in the torch core** at 2.2 m: the exposure now drops to 0.92 (was ≈ 4) without blacking the hall, but she still
   reads as a pale featureless white form — skin/hair shading (characters) is the next lever, judged at 1920 px.
6. **Torch-view gloves** are a physically correct near-black silhouette (0.2–0.4 lux bounce). No fake rim light.
7. **Armoire louvres** read as flat horizontal boards — no slat angle (props lane geometry).
8. **Max volumetric beam**: verified harmless (on/off identical at the close-ups); the soft torch pool is the
   spill shelf itself. Moonlit yard/road read as night, never pitch-black once adapted (tauBrighten 6 s).
9. **Dress** reads as a smooth bell, no lace/seams (props lane); **e1 sign post** clips to a pale streak at 0.9 m.

## Round D — AD + perf review of the runtime lane (2026-10-09; log in docs/STATUS-runtime-d.md "Review")

Judged on mains, Medium/WebGPU, against a real photograph of a rainy rural night drive from a 1980s sedan (C0/C1) and
of a 1990s torch in a dark farmhouse (house views). Builds `scratch/dist-rd-review` (tree as found) and
`scratch/dist-rd-review2` (+ the arms fix). Frames: `scratch/rd-review/{op,hs,rd,arm,bm,tc,tc2}/`, sheets
`scratch/rd-review/s*.jpg`. 0 console errors in every run.

### Verdict
Not photographic yet. The opening's best frames (C1 34.4 truck, C1 60.5/61.8 gate, the C1 13.5 cluster) pass as
stills; the aerial (C0 4.5/9.25), the forest close-ups (C0 15.6, C1 41) and the lit cabin (C1 20/24.5/63) read as CG.
In the house the landing candle passes; the torch does not throw, so Ada at 6 m is never in a hot spot.

### Fixed in this review
- **Gloves left the wheel whenever the driver's head turned (C1 3.4–6.6, 17.6–30.2, 43.4–50.4).** Cause: the FP arms
  ride the camera rig; the car clips are authored in the eye frame of `clips_arms.py` (car − EYE, car axes). At C1 20
  the right glove sat on the horn pad and the left hung off the column. Fix: `FpArms.anchorTo` puts the arms root at
  DRIVER_EYE in the mounted interior while a POV shot runs (`opening.ts driverAnchor`, 2-line hook in
  story-runtime). Verified `arm/c1-20.jpg`: both gloves on the rim at 10-and-2 while the view pans to the knob/cup.

- **The torch had no throw (house, every torch view; blocks #17).** `LOOK.torchCd` 120 cd with a 16 cd spill shelf
  over a 45° cone (21 lm) put 2.8 lux on the U1 end wall at 6.5 m: Ada at 6 m was never in a hot spot. CLAUDE.md
  sets the 2-cell D krypton torch at ≈ 27 lm, 2–3 kcd peak, hot centre + soft spill. **Item 11's 60–120 cd ruling is
  reversed**: it was set to stop near-wall clipping before auto-exposure (item 4) existed. Near-wall arithmetic:
  at 0.6 m the old 16 cd shelf put ≈ 44 lux on the wall and the new 7 cd shelf puts ≈ 19 lux, while the exposure was
  already at its 0.25 floor there, so readability at pickup distance does not get worse. What changes is the core: a
  ≈ 6 cm hard-clipped dot instead of an ≈ 11 cm one. Not verified: Max (volumetric beam stub) and the exterior torch
  in rain.
  New profile 2000 cd, core HWHM 2.9°, spill 7 cd, corona 1.6 cd = 30.9 lm (beamFlux). A/B in one session
  (`tc/`, `tc2/`, sheet `sTC2.jpg`): at equal exposure the end wall gets a small hot disc where 120 cd showed none;
  near the floor it is a clipped hot disc in a soft dim spill, and the meter drops about 1 EV, like a real photo. The
  warm ceiling in the hall is the landing candle's bake on 0.6-albedo plaster (the same with both profiles), not
  torch spill.

### Corrected diagnosis
- **C0 26.5 "pale road" is not the asphalt albedo** (round D builder request #1 withdrawn). Forcing a constant 0.04
  albedo made the road region 7 % brighter (sRGB 89 → 95): the generator's effective albedo is already ≈ 0.04. The
  exposure is the cue's fixed 1.0 (auto would give ≈ 0.7). A low beam puts 5–12 lux on the road 5–10 m ahead, so a
  mid-grey road is what a night photograph shows. What reads "dry" is the texture: a smooth uniform grey with big
  black puddle blotches. Wet asphalt shows aggregate sparkle (each wet stone a glint under the beam) and rain-ring
  ripples in the puddles.

### Ranked remainder
1. **C0 aerial / flash (C0 4.5, 9.25, 15.6; lane A + runtime).** The canopy is an egg-carton field of identical
   smooth cones. The 9.2 flash (peak 0.72 at 9.35 s, `rd/c0-flash.jpg`) is a flat blue-grey wash with no modelling
   or shadows, which CLAUDE.md forbids. The blanket ends in a visible seam band a third of the way down, then a
   flat dark plane runs to a ruler-straight horizon, so the §11 aerial-gap check FAILS. Fixes: varied crown
   silhouettes plus per-instance scale and lean (lane A); for the flash, a directional term from the stroke azimuth
   on the canopy material with N·L and self-shadowing from the crown's height field; widen the blanket to ±400 m
   or add a ridge-line skirt.
2. **Lit cabin reads as clay (C1 20, 24.5, 63; props/lane A).** The tan vinyl (0.28) has mm-scale grain but no
   mid-frequency life: no sweat-darkened wheel rim, no dust on the dash top, no sun-faded bolsters, no seam welts
   catching the dome. The A-pillar trim is visibly faceted. The C1 24.5 map's "48" is not in view or legible.
   Under the dome the gloves read as tanned skin (sRGB 161/131/95 next to vinyl 214/197/179, effective albedo
   ≈ 0.15 vs `leather_worn` 0.035). Check the atlas glove albedo (≈ 0.067 linear) and the GGX/env lift on Medium.
3. **C0 15.6 / C1 41 forest close-ups (lane A).** The pine crowns are stacked smooth cones or flat cards. At C1 41
   the trunks are evenly lit orange from the ground up (no beam fall-off with height or distance, no bark relief).
4. **C0 26.5 wet road texture (props: asphalt generator).** See "Corrected diagnosis": add aggregate sparkle and
   rain rings. Rain streaks are plausible beam-lit drops but too uniform in length and brightness.
5. **Armoire slat view (U1, `hs/armoire-slats.jpg`).** Near-black horizontal bars fill the frame with nothing of the
   hall between them. Expected: thin bright slivers of the candle-lit hall through each gap. Check the hide eye
   depth vs the louvre gap and LOUVRE_PITCH, and whether the slat backs get the torch.
6. **First-person gloves in torch views.** They are two featureless black blobs centre-bottom: no rim light from the
   spill and no worn-leather sheen on Medium (the Charlie sheen is Max only).
7. **#17 Ada skin chalk:** judgeable only now that the torch throws. The next pass needs an Ada-in-hot-spot frame
   with the brain frozen (`tc.mjs` shows how to set the torch; freezing via `brain.update` override breaks the
   director).
8. **Perf (builder numbers, not re-measured: a props Blender ran during this whole review).** Parlor +2.5–3 ms over
   pre-round-B (target +1.5) needs a ruling on the lightning shadow 2048 → 1024 on Medium. C1 60.5 / 61.8 draw
   ≈ 498 / 413 calls (> 400). C0 has a 0.2–0.4 s first-DOF-switch hitch. Medium loads took 103–254 s with Blender
   running (warm rc9 28 s, car-set 18 s), so the finish-line target of < 15 s warm load is far off.

## Round 3 — AD review of the runtime realism round (2026-10-08; log in docs/STATUS-r3-review.md)

Reviewer: AD. Builds: `scratch/dist-r3-base` (HEAD e2a888a), `scratch/dist-r3-headdata` (HEAD code + the current
`src/shared/*.json` and `public/assets`, made from `git archive HEAD` in `scratch/r3r/headsrc`), `scratch/dist-r3-review`
(current tree). The first attempt ran on battery; every GPU number below was re-taken on MAINS.

### R2-2 parlor GPU — re-measured on MAINS and attributed
Battery pairs (first attempt) are kept in docs/STATUS-r3-review.md; the table below is mains (AC), Medium WebGPU,
1280×800, `gpuFrameMs` medians, alternating builds.
| Build | parlor-table ms (pair 1 / pair 2) | upper-torch ms |
|---|---|---|
| HEAD e2a888a | 9.42 / 9.39 | 7.32 |
| HEAD code + HEAD json + CURRENT `public/assets` (`dist-r3-headjson`) | 9.75 | — |
| HEAD code + HEAD layout + CURRENT spec (`dist-r3-hjS`) | 10.37 | 7.65 |
| HEAD code + CURRENT layout + HEAD spec (`dist-r3-hjL`) | 16.74 | 9.37 |
| HEAD code + all current data (`dist-r3-headdata`) | 15.64 / 15.33 | — |
| now (round-3 + review fixes + opening-lane code, current data) | 18.38 / 18.23 | — |
- **+6 ms is the opening lane's `src/shared/level-layout.json`.** Assets and the material spec are innocent (≤ +0.9 ms).
  Inside one session the cost sits in `room_G2` (hiding it: 15.4 → 9.8 ms), spread over every G2 material (no single
  culprit), not the new runtime spots, not the shadow pass, not GPU residency, and the parlor draws *fewer*
  triangles than HEAD. A layout change that adds per-pixel work to every G2 material points at per-room light/probe
  lists or a lightmap/probe binding the layout drives (e.g. a light or probe volume now overlapping G2). **Owner:
  the opening lane / lead — bisect the layout diff (lights, probe volumes, room bounds) on `dist-r3-hjL`.**
- **Code on top of the data: +2.8 ms on mains** (the battery estimate of +0.5 ms was wrong). Cumulative removal on
  `now` (tog3): arms 1.57 ms, Ada + Harlan 0.74 ms. This includes the opening lane's code changes in the tree,
  which this review cannot separate from round 3.
- R2-2 is **not met** (budget: parlor within +1.5 ms of 7.9–9.4 ms). Medium is still ≈ 55 fps (18.3 ms GPU) in the
  parlor on the M1, over the 45 fps floor, but the trend is the wrong way.
- Scripts: `scratch/r3r/{ab.sh,ab2.sh,ab3.sh,tog3.sh,vis.mjs,tog.mjs,grp.mjs,g2.mjs,sh.mjs,mem.mjs}`.

### Verdict
The round's biggest win is the exterior. The field, the drive and the yard now read as wet ground under a lit overcast,
with fog giving depth, where HEAD was a black slab under the sky (field-east black pixels 57 % → 17 % on Medium and
57 % → 25 % on Max). The C2 hair is no longer a black helmet. Exposure now snaps on cutscene cuts, so the C5
shadow-play reads from its first frame.

What still gives the game away:
- **A blue door rope** in the candle-orange parlor (C2), and a blue glow at Ada's face.
- **Characters:** skin and the white gown read as matte plastic; under the torch the crown of Ada's head is a flat
  black cap with a uniform "angel ring".
- **The torch hot spot** at 1 m is a hazy luminous disc, not a lit wall.
- **The armoire view** is 95 % black.

All views: 0 console errors (Medium + Max WebGPU, base and now).

### Fixed in this review
- **R3-F1 — C5's blue cleaver had a different cause, and the builder's fix did not remove it.** At C5-17.62,
  `lightning_L_LTN_U2E` was lit at its full 31.8 cd (7500 K, unshadowed).
  - **Why it reached the parlor:** the builder's "seen rooms" gate lets it through because G2 "sees" U2 through the
    ceiling grate, so it lit the parlor through the floor.
  - **What did not fix it:** with every probe grid at 0, and with the G2 cube at ×0.18, the blade stayed blue.
  - **Fix (`src/world/lights.ts` + one argument in `level.ts`):** a lightning spot on another floor is now on only
    when the viewer stands in a stair-foot room (G1 or U4: the stairwell view of the landing window).
  - **After:** U2E is off in C5, and the blade is dark steel that reflects the dim room
    (`scratch/r3r/r-cleaver3.jpg`; left = before).
  - **Behaviour change the lead should know about:**
    - Indoors, an upper-floor window spot no longer lights anything when the viewer is in a ground room other than
      G1 or U4. Outdoors every seen spot stays on, so the upper windows still flash from the yard and in the C1 reveal.
    - `viewer` is the level's current room (fed from the player's feet), not the cutscene camera. No current cutscene
      puts the camera on a different floor from the player.
- **R3-F2 — the guttered C5 candles still lit the characters and the cleaver.** `uParlorBake` dimmed only the
  lightmap. The ground-floor probe grid and the G2 reflection cube, both baked from the same lights, stayed at full
  strength, so Harlan and Ada glowed against the dimmed room.
  - **Fix:** `cutscene-fx.ts` scales the `ground` grid's `intensity` with the bake, and `reflections.ts`
    RoomEnvNode('G2') × `uParlorBake`.
  - **After:** `scratch/r3r/r-c5b.jpg`.

- **R3-F3 (FIX 3b) — exterior viewers keep every seen lightning spot**, so the upper windows still flash from the
  yard and in C1 after R3-F1's floor gate (`lights.ts`).
- **R3-F4 (FIX 4, was R3-4) — flicker lights in cutscenes are gated like the lightning spots** (seen rooms + floor);
  their fade snaps when culling is off, so a cut never shows a lamp fading in. Before: in C2/C5 L_LANTERN (11–14 cd)
  and LAMP_U2 (5 cd) lit Harlan, Ada and probe-lit props through the floor. `src/world/lights.ts`.
- **R3-F5 (FIX 5, was R3-3) — bloom threshold is exposure-relative** (1.5 in exposed units; was 0.9 in scene
  radiance, which at exposure 0.25 bloomed the whole torch hot spot into a hazy disc). After: torch-1m shows a
  crisp disc with the wallpaper readable inside it and the glove lit (`scratch/r3r/pc-torch-1m.jpg`); halation
  stays on flames. `src/render/pipeline.ts`.
- **R3-F6 (FIX 6, part of R3-1) — interior probe lookups no longer add the exterior grid.** The exterior grid box
  reaches 2.5 m into the house, and its sample was *added* to the ground grid, so the hall/parlor front strip got
  cold sky light (decoded shipped probes: ground b/r 0.03, exterior b/r 1.47). `src/world/level.ts`.
- typecheck clean on the final tree; see the status log for test/build/playthrough on it.

### Per-item verdicts (photographic yes / no; pairs are left = HEAD, right = now, in `scratch/r3r/`)
| Item | Verdict | Evidence |
|---|---|---|
| R2-1 field / fog / exterior probes | **yes** | `p-field-east.jpg`, `p-C5-17.62.jpg` (the exterior C5 frame), `x-field-east.jpg`. Nits: the grass is a uniform teal; the near pines left of field-east are gone (layout data, not the fog: check the opening lane's tree changes). |
| R2-3 arms | **partial (acceptable)** | Torch-down: the hand is a silhouette against the pool, with the finger edges lit. I accept the builder's −7 EV physics, because the back of the hand faces the dark ceiling. torch-1m: the barrel and rim now read. |
| #17 Ada hair | **partial, improved** | C2-10.2, Medium and Max (`p-C2-10.2.jpg`, `x-C2-10.2.jpg`): the helmet with a blob highlight is now dark, strand-textured hair. Under a torch close-up (qa.shot `scratch/r3r/med/m-05`) the crown is still a flat black cap with a sharp uniform ring. **Skin chalk: not started.** The torch framing is still not clean, because Harlan reappears (`setVisible` does not stick). |
| R2-5 exposure snap | **yes** | C5-17.62: exposure 1.8 → 4.3 at the cut, and the shadow-play reads at once. C2 cuts snap too (C2-15.5: 3.1 → 10–17). Watch C2-15.5: it lands at 10–17 depending on the frame, which is very bright for a candlelit room (R3-5). |
| #11 torch ring | **neutral** | No ring visible, but see R3-3: the whole hot spot reads as a hazy disc. |
| R2-6 tally / cleaver | **cleaver yes after R3-F1/F2 (Medium); tally not seen** | None of my C2/C5 frames framed the tally wall (the C2-5 sample lands on the corner). Max cleaver: dark with a faint cold edge (no cube on Max), acceptable. |
| R2-7 armoire | **no (diagnosis confirmed)** | `p-armoire-slats.jpg`: 95 % black, exposure at its 24 cap, and the only lit things are the balusters through the slots. The −0.12 pitch moves the patch up a little. Needs light in U1 plus the layout eye move. |

### New findings (round 3)
- **R3-1 — FIXED (R3-F1 for C2-5, R3-F6 for C2-15.5; `scratch/r3r/cap/medium-f6/C2-15.5.jpg`: hemp-brown rope, warm candle dish). Was: the door rope in C2 is saturated blue** in the candle-orange parlor. It is visible in every C2 frame on
  both builds, and it is worse than anything else in the tableau.
  - **Material:** `rope_hemp` is albedo [0.28, 0.22, 0.14] with roughness 0.9, so the blue cannot be specular.
  - **Not the probes:** the NOPROBE diagnostic was inconclusive, because the frame timing jittered.
  - **Suspect:** the rope's LM_GROUND lightmap texels (18 mm rope, tiny UV2 islands bleeding into front-door-glass
    or exterior texels), or its LightsNode.
  - **Owner:** Blender bake (UV2 padding for thin props) or runtime: check which LightsNode the rope gets.
- **R3-2 — A blue glow spot at Ada's face in the C2 tableau** (Medium + Max, both builds). If it is the "clouded
  eye", it should not glow under candlelight: make it a milky cornea, not emissive.
- **R3-3 — FIXED (R3-F5). Was: torch-1m: the hot spot is a hazy luminous disc** with the wallpaper texture washed out
  (`crop-torch1m.jpg`). Check the halation/bloom threshold and how much of the core lands near clip at exposure
  0.25. At 1 m a real hot spot shows the surface crisply.
- **R3-4 — FIXED (R3-F4). Was: in cutscenes (culling off) every flicker light is on.** That includes L_LANTERN at 11–14 cd and LAMP_U2 at
  5 cd. Lightmapped surfaces are safe (per-atlas lists), but characters and probe-lit props get them through floors.
  Apply the same floor gate (R3-F1) to the flickers in `RuntimeLights.update`.
- **R3-5 — C2-15.5 lands at exposure 10.5** after the snap (mean 49): the candle table top and Harlan's hood clip and
  the parlor reads as a lit room, not night. The mean is the day-for-night key working; what reads wrong is the
  3 → 10.5 jump at a cut and the clipped highlights. Fix: a per-shot exposure clamp on the C2 shots like C1's
  `POV_MAX` (`fx 'exposure' { max, snap }`). That handler currently lives in the opening lane's `src/world/opening.ts`;
  once it lands, add `max ≈ 5` to C2's two room shots (or move the handler to `cutscene-fx.ts` for every cutscene).
  Alternatively, add highlight protection to the meter: cap exposure so the 99.5th-percentile luminance stays ≤ 1.0 exposed.
- **R3-6 — A hard-edged bright patch on the cornice above the C5 shadow-play** appears on now (Max + Medium) but not
  on HEAD. It looks like a shadow-map edge from the moved candle. Check the candle shadow gate's near plane and bias.
- **R3-7 — Automation:** `qa.shot` frames are black during cutscenes once the rAF loop is stopped, while
  `__game.capture()` has the content. Every reviewer should capture with `capture()` (`scratch/r3r/look.mjs`).
- **R3-8 — R2-2 is in the data, not this round's code** (table above).

### Ranked remainder (round 4)
| # | Item | Lane | Payoff | Effort |
|---|------|------|--------|--------|
| 1 | R2-2 parlor +5.2 ms from the opening data (inside room_G2, per-pixel; props_m1.glb / LM data suspects) | perf + opening | big (budget) | S–M |
| 2 | #12 clapboard reads as brick/stone; #10 + #9 upper floor black (also unblocks R2-7) | blender | huge | M + re-bake |
| 3 | R3-1 blue rope + R3-2 blue eye glow in the C2 tableau | blender-bake / characters | big (hero cutscene) | S |
| 4 | #17 skin chalk + gown plastic; the hair crown cap/ring under the torch | characters | big | M |
| 5 | R3-3 torch hot spot reads as haze | lighting-post | medium | S |
| 6 | R3-4 flicker lights across floors in cutscenes; R3-6 cornice patch | runtime | medium | S |
| 7 | R3-5 C2 cut exposure too high | runtime / cutscenes | medium | S |
| 8 | R2-7 armoire (layout eye + U1 light) | hides / blender | small | S |
| 9 | #6 C6 car paint silhouette; #18 house-window rain; #13 chip masks; R2-4 baked candles outside C5 | various | small–medium | M |

## Round 2 — AD review of the lighting round (2026-10-07)

Reviewer: AD, judging each hero view against a photograph. Same views on HEAD (`scratch/dist-review-base`, the tree
before both lighting lanes) and on the current tree (`scratch/dist-light-review`), Medium + Max WebGPU, one WebGL2
Medium pass. Scenarios: `scratch/review/hero.mjs` (all hero views in one session; `VIEWS=`, `GPU=1`), `c5sweep.mjs`,
`perfsweep.mjs` (in-session GPU toggles), `horizon.mjs`, `q.mjs`. Side-by-side sheets (left = HEAD, right = now):
`scratch/review/cmp/m1–m5.jpg` (Medium), `x1–x2.jpg` (Max), `gl.jpg` (WebGPU vs WebGL2), `c1.jpg`, `c5a–c5c.jpg`,
`t1.jpg` (torch sweep), `hz.jpg` (horizon). 0 console errors in every run. All runs were on battery (the tool warns
that absolute GPU numbers are throttled); budget claims below use in-session toggles or alternating A/B sessions.

### Verdict
The round fixed the frame. The dirty post chain, the lights shining through the roof, the grey lightning wash and the
fixed exposure are gone, and the parlor, the C1 reveal and the C2 tableau now read as photographs of candlelit and
stormlit places. What still gives the game away: the clapboard reads as brick or stone (#12), the upper floor is black
without the torch (#9/#10), the open field goes pure black just under a lit sky (new R2-1), and the characters (hair
like a black shell, chalk skin, the player's arms as black cut-outs in every torch view).

The review found two release blockers in the round's own code and fixed them (R2-F1, R2-F2 below).

### Fixed in this review
- **R2-F1 — torch bounce cost 4.3 ms and hitched every other frame (item 11, release blocker).**
  `FlashlightBounce.trace` called `Raycaster.intersectObjects` (no BVH) on every mesh whose box held the hit point.
  The merged room and house meshes are 10⁴–10⁵ triangles, so each trace took about 8 ms of CPU, every second frame.
  - **Proof:** an in-session toggle on Medium. Harlan's room with the torch on was 12.0 ms; skipping only the trace
    (`rayDistance → ∞`) gave 8.0–8.5 ms; torch off was 6.5 ms. Builder 2's `?bounce=0` base only zeroed the bounce
    scale, so the trace ran in their base too and none of the round's budget numbers showed it.
  - **Fix (`src/render/flashlight-bounce.ts`):** the hit point and normal now come from the collision octree.
    The albedo is re-sampled only when the hit moves more than 0.25 m or after 15 trace frames, against at most
    4 meshes of ≤ 6000 triangles; a larger surface uses its first material.
  - **After:** Harlan's room 7.6–8.0 ms (torch off 6.5; the remaining ~1.1 ms is the torch shadow map, as on HEAD).
    Clapboard 2 m: 9.5 → 5.8 ms (off 5.4).
- **R2-F2 — the C5 shadow-play had no readable shadow (item 19, was "done").**
  - **Cause:** "baked light can't go out". After the mantel and sill candles gutter, the parlor lightmap still holds
    them (and the table candle) at full power, so the moved candle's head shadows read at ≈ 1.25 : 1. Also, the cut
    to the wall moves the camera less than 2.5 m, so exposure never snapped: the first beat played ≈ 2.5 EV dark
    (exposure 1.27, τ 6 s to brighten).
  - **Fix:**
    - `uParlorBake` (LM_PARLOR only) is set to `LOOK.c5Bake` = 0.18 while the silhouette light is on (≈ ⅓ of the
      bake's candles × ≈ 0.5 indirect share = the moved candle's own bounce) and back to 1 at the cut to black.
    - `requestExposureSnap()` in `src/render/exposure.ts`, called on the same cue.
    - The hooks are 4 commented lines in `src/world/cutscene-fx.ts`.
  - **After:** both heads, Harlan's raised arm and the cleaver read hard-edged on the damask from the first beat.
    Exposure is 3.8 at the cut and 6.5 by the second beat (`cmp/c5a.jpg` sweep 1 / 0.3 / 0.18 / 0.08,
    `cmp/c5c.jpg`).

### Per-item verdicts (photographic yes / no)
| # | Item | Verdict | Why (evidence) |
|---|------|---------|----------------|
| 1 | Sharpen + CA | **yes** | Halos and 13 px fringes gone; edges look like a lens, not a filter (m1, x1). |
| 2 | Moon directional | **yes** | Indoors nothing leaks through the roof any more. Upper hall on HEAD was lit by it (mean 4.0 at ×1); now 0.2 at ×8, i.e. the real bake. |
| 3 | Lightning | **yes** | Clouds light unevenly, the porch and trees throw shadows, exposure holds (7.48 → 7.48). The gate flash is 65 mean / 47 % mid-tones, not HEAD's 112 / 77 % grey wash. The C1 reveal reads (cmp/c1.jpg). Nit: the lawn turns saturated green in the flash. |
| 4 | Eye adaptation | **yes, with R2-F2 + R2-5** | Parlor ×1.5, facade ×13, torch close-ups at the ×0.25 floor. Short cutscene cuts did not snap (fixed for C5 only, R2-5). At ×13 the facade reads as blue hour rather than night (taste, R2-8). |
| 5 | Candle specular | **yes** | Table and floor carry the candle's highlight in parlor-table (m2, x2). No leak behind walls (builder's ×10 test). |
| 6 | Reflections | **partial** | Night panes now mirror the room and candle at the right ≈ 1 : 5 of the wall. The pane blue is correct: an overcast sky at 7500 K seen through tungsten-balanced glass. Not yet: C6 car paint is a dark silhouette with only the hood catching the sky; no reflections on WebGL2; +3.5 s load. |
| 7 | Fog | **partial** | No grey wall any more, but the model is FogExp2 (squared) on a near-black colour. See R2-1: the open field still goes pure black. |
| 8 | Grain | **yes** | Black stays black; subtle. |
| 11 | Flashlight | **partial (R2-F1 fixed)** | Warm 2900 K core over a spill shelf, ≈ 21 lm. Black outside the spill is physically right: the indirect light from 21 lm in a 70 m² room is ≈ 1/80 of the core. Not yet: the reflector-seam ring (0.025 at r 0.42) shows as a lens halo at 1 m (x2 bottom); the player's arms are black cut-outs (R2-3). |
| 13 | Trim chips | **partial** | Pox gone; edge/height masks still missing. |
| 14 | White balance | **yes** | Cream wallpaper, brown floor and amber flame separate; damask legible (m2, m5). |
| 15 | Sky / treeline | **yes** | Matches the bake, with a cloud deck and treeline. The horizon problem is the ground, not the sky (R2-1). |
| 16 | Floor albedo | **yes** | The floor reads as aged oak next to the candle (m2). |
| 17 | Ada | **partial** | Contact shadow and wet hair lobe are in, but the hair still reads as a solid black shell and the skin as chalk in the torch (`scratch/light2/ada/ab3.jpg`). |
| 18 | Rain on glass | **partial** | Windshield drops refract; house windows not done. |
| 19 | C5 / C6 | **C5 yes (after R2-F2); C6 partial** | C6 has a twilight sky and wet ground, but the car body is still a silhouette. |
| 9, 10, 12, 20 | Blender items | **not started** | Now the most visible problems (see the ranking below). |

### New findings
- **R2-1 — The open field goes pure black under a lit sky (gate view, C1, every wide exterior).**
  - **Measured:** at the gate (Medium, exposure 5.4) the sky just above the horizon is RGB (11, 17, 27). Directly
    below the horizon the field is (0, 0, 1), and the near field inside the probe grid is black too
    (`cmp/moon.jpg`).
  - **What the toggle showed:** a 0.02 moon (`moon.mjs`) lifts only the gravel tracks, not the grass. Hiding the
    big terrain meshes lets the background's fogged ground show, and that reads right (`cmp/hz.jpg`, bottom-left).
  - **Causes, in order:**
    1. `grass_wet` avgAlbedo is 0.055 (`mud_wet` 0.05). Measured wet winter lawn is ≈ 0.10–0.15, so the field sits
       at ≈ 1/7 of the horizon sky (0.055 × 0.027 lux / π ≈ 0.0005 vs ≈ 0.0033 cd/m²) instead of ≈ 1/3, inside
       AgX's toe.
    2. FogExp2 (squared) at 0.006 puts only 12 % haze on the field at 60 m. Beer-Lambert at the same 290 m
       visibility (1 − e^(−σd), σ = 3.9 / 290 m) gives ≈ 55 %, and the haze colour is the horizon sky.
    3. Terrain beyond the exterior probe grid (plan x −9…15, y −32…2.5) gets no irradiance at all (falloff 0.35 m).
  - **Fixes, by lane:**
    - Materials (lead-owned spec) + Blender: `grass_wet` ≈ [0.09, 0.12, 0.06], then re-bake.
    - Runtime (scene fog → a custom fog node): Beer-Lambert fog.
    - Runtime (level / probes): give exterior probe-lit materials their own LightsNode with the exterior grid at
      falloff 0, so interiors never see it.
- **R2-2 — The parlor and the gate view cost more GPU than HEAD on Medium** (see the A/B table in
  REALISM-STATUS). Parlor-table is +1.68 ms over 3 alternating pairs, over the +1.5 budget. The candle shadow maps,
  sampled from load (PERF P0-2), account for ≈ 0.5 ms of it (`castShadow` off: 7.3 → 6.7 ms).
  - **Ruled out:** in-session toggles of auto-exposure, post, lightning-shadow sampling, the sky background and
    the characters each move it by less than the noise (`perfsweep` sw5). The URL switches
    `?refl=0&lmmodel=0&bounce=0&skin=0` (real, parsed in main.ts) also changed parlor-table by only 0.05 ms.
  - **Candidates no switch removes:** the bounce SpotLight sits in every LightsNode even with the torch off, so
    every material evaluates one more spot light per fragment. The lightning directional's 2048² shadow map is
    in exterior LightsNodes from load. Some may also come from the in-flight PERF-lane changes, which are in
    this diff too.
  - **Next:** a mains-power A/B with the bounce light dropped from the LightsNodes.
- **R2-3 — The player's arms render as black cut-outs in every torch view** (upper hall, Harlan's room, clapboard).
  The hand holding a lit torch 1–2 m from a lit wall gets ≈ 1/10 of the wall's light from the bounce, so it
  should read dim but solid. Characters lane: check that the arms' LightsNode includes the flashlight bounce.
- **R2-4 — Baked candles never go out anywhere else.** The mantel and sill candles that gutter in C5 stay baked
  into B12/C7. `uParlorBake` can do it for the parlor; it is a design call which beats keep them dark.
- **R2-5 — Exposure snaps only on moves larger than 2.5 m.** Same-room cutscene cuts adapt at τ 6 s.
  `bindings.ts` already calls `rig.snap()` on held-camera cuts; add `requestExposureSnap()` there (PERF lane file,
  one line).
- **R2-6 — The C5 tally marks render as a regular halftone grid of squares**, not scratched strokes. The cleaver
  blade is a flat blue quad (reflection cube on metal at grazing).
- **R2-7 — Armoire slat view** (HEAD and now): the camera inside frames mostly the black interior; the slats fill
  only the lower-right ≈ 40 % (`scratch/review/new-med/n-10-armoire-slats.jpg`). This is the hides lane, not
  lighting: check the eye position and yaw against the door.
- **R2-8 (taste) — Outdoor night key:** at ×13 the facade reads as blue hour, so "the darkness must stay
  frightening" is at risk outdoors. Try `biasEV` −0.5 outdoors only.
- **R2-9 — In-flight: `npm test` has 2 failures in `materials-library.test.ts`.** `material-spec.json` now has
  82 materials (the test expects 68) and `vinyl_dash_black` has no calibration. These are new materials from the
  Blender lane's car work, not from this round.

### Ranked remainder (round 3)
| # | Item | Lane | Payoff | Effort |
|---|------|------|--------|--------|
| 1 | #12 Clapboard reads as brick/stone (facade, C1 reveal, every flash) | blender-geometry + materials | huge | M + re-bake |
| 2 | R2-1 Black field under the sky (grass albedo ×2, Beer-Lambert fog, clamped exterior probe grid) | materials + blender + runtime | big | S–M + re-bake |
| 3 | #10 + #9 Upper floor black without the torch (landing candle, ajar doors, low-end encoding) | blender-bake | big | M |
| 4 | Characters: R2-3 black arms; #17 hair shell and chalk skin; C6 car paint silhouette (#6) | characters / lighting-post | big | M |
| 5 | R2-2 Medium GPU over budget: parlor-table +1.68 ms, gate +1.04 vs HEAD (≈ 0.5 ms is the always-sampled candle shadow maps; ≈ 1.2 ms unattributed); mains A/B | perf | big | S–M |
| 6 | R2-5 snap on every held-camera cut; R2-4 baked candles that went out | runtime / cutscenes | medium | S |
| 7 | #20 Dim-atlas bake quality once #9/#10 land | blender-bake | medium | L |
| 8 | #11 rest: ring 0.025 → 0.01, keep the shelf | lighting-post | small | S |
| 9 | #18 house-window rain; #13 chip edge/height masks; R2-6 tally decal and cleaver | weather-fx / materials / cutscenes | small | M |
| 10 | R2-7 armoire framing; R2-8 outdoor key | hides / lighting-post | small | S |

The original round-1 ranking follows for reference: items 1–5, 7, 8, 14–16 are done, and 6, 11, 13, 17–19 are
partial as marked above.

## Round-1 verdict (reference)

Light power is physically right (candles 0.8–0.95 cd, a 4.8 cd lamp, lightmaps decoded as E/π × π). The architecture
and the parlor's candlelit wallpaper are close to good. The image still does not read as photographed, and the cause
is the frame around the light, not the light itself:
1. A fixed exposure of 1. There is no eye adaptation, so the upper floor is about 200× (7.7 EV) darker than the
   parlor and renders as void.
2. Glossy surfaces reflect nothing. There is no environment or reflection probe anywhere, and candle specular runs
   at about 8 % of its physical value.
3. A shadowless "moonlight" DirectionalLight lights interiors through the roof, and outdoors it lights the house 4×
   brighter than the bake does.
4. The post chain is dirty. The sharpen strength is inverted (near-maximum RCAS), chromatic aberration splits the
   frame corners by 13 px, and the grain lifts the blacks.
5. Lightning brightens the whole fog volume and raises exposure, so the frame goes flat grey instead of
   throwing shadows.
Most of the top items are small runtime changes and need no re-bake.

## Round-1 ranked backlog (reference; status in the round-2 table above)

| # | Item | Lane | Payoff | Effort | Re-bake |
|---|------|------|--------|--------|---------|
| 1 | Post chain: inverted sharpen and 13 px chromatic aberration | lighting-post | huge | S | no |
| 2 | Shadowless moon/lightning DirectionalLight indoors and on the facade | lighting-post | big | S | no |
| 3 | Lightning flash: exposure kick, fog +0.3, no shadow | weather-fx | big | M | no |
| 4 | Eye adaptation (auto exposure) with a room-aware range | lighting-post | huge | M | no (but see 9) |
| 5 | Candle specular at full physical strength | lighting-post | huge | M | no |
| 6 | Reflections: box-projected room cubemaps + exterior sky env | lighting-post | huge | L | no |
| 7 | Fog density 6–10× too high outdoors | weather-fx | big | S | no |
| 8 | Film grain: display-space white noise, strongest in black | lighting-post | medium | S | no |
| 9 | KLM low-end quantisation crushes dark rooms | blender-bake | big | S | re-encode |
| 10 | Upper floor has no key light at all | blender-bake | big | M | yes |
| 11 | Flashlight: flat cookie, no bounce, the rig dims the torch | lighting-post | big | M | no |
| 12 | Clapboard reads as stone: peel too dark and too large, no lap shadow | blender-geometry | big | M | yes |
| 13 | Paint-chip "pox" on all trim | materials | medium | S | no |
| 14 | White balance: candle rooms are monochrome orange | lighting-post | medium | S | no |
| 15 | Sky/background brighter than the sky that lit the bake; hard black horizon | lighting-post | medium | S | no |
| 16 | Varnished floor albedo too dark (floor is black next to a candle) | materials | medium | S | optional |
| 17 | Ada: no SSS skin, single-lobe hair, no contact shadow on Medium | characters | medium | M | no |
| 18 | Rain on glass/windshield: lit dots, no refraction | weather-fx | medium | M | no |
| 19 | C5 shadow-play has no shadow; C6 dawn car is a silhouette | cutscenes | medium | M | no |
| 20 | Dim-atlas bake quality (64 spp) once exposure lifts the darks | blender-bake | medium | L | yes |

### 1. Post chain: inverted sharpen and 13 px chromatic aberration (QA #3, agreed; cause found)
- **Seen:** dark outlines on the house, the trees and the window frames; magenta/green fringes on every mullion and
  on the candle highlights (`max-03`, `play-02`).
- **Cause:** `SharpenNode` (r186, `examples/jsm/tsl/display/SharpenNode.js:29`) treats sharpness 0 as maximum and 2
  as none. Presets pass 0.2 (Medium) and 0.25 (Max) at `src/render/presets.ts:81,100`, so RCAS runs at con = 2^-0.2
  = 0.87, close to full strength, on a TAAU upscale from 0.75 or 0.667 scale. Chromatic aberration is 0.35 with scale
  1.1 (`pipeline.ts:341`). In `ChromaticAberrationNode` that gives a red/blue split of offset × (0.022 + 0.0071)
  per channel, about 6.5 px each way in a 1280 px corner and 13 px in total. A real lens shows ≤ 1–1.5 px.
- **Fix:** `sharpen: 1.2`, with `denoise=true` passed as the third argument (con ≈ 0.44). Set `chromaticAberration`
  to 0.04 (about 1.5 px total in the corner, 0 in the centre). Apply CA before bloom so highlights don't double-fringe.

### 2. Shadowless moon/lightning DirectionalLight indoors and on the facade (QA #9: I overrule its "probe leak" cause)
- **Seen:** the far door of the ground hall is lit cool with no source (`medium-hall2`). The facade is lit evenly with
  no porch-roof shadow. Interior floors flash during lightning.
- **Cause:** `src/world/lights.ts:256` sets `lightningDir.intensity = (MOONLIGHT 0.07 + lightning × 2.2) × (outside ? 1
  : 0.15)` with `castShadow = false` (line 160), and it is part of every lightmapped material's lightsNode. Indoors,
  0.0105 is about 17× the upper-hall baked mean irradiance (0.00019 × π). Outdoors, 0.07 is 4× the exterior bake
  (0.0055 × π), so the shadowless fill replaces the baked sky occlusion.
- **Fix:** Indoors: 0. The window SpotLights and the flash lightmap already carry lightning inside. Outdoors: moon
  ≤ 0.015, or 0 if the bake's sky already reads. Let the lightmap's sky occlusion carry the house.

### 3. Lightning flash (QA #2, agreed with changes)
- **Seen:** `play-02` washes to a flat grey-white frame, with a green lawn that looks like daylight and no shadows.
- **Cause:** `src/game/main.ts:574` adds 0.30–0.40 to the fog colour, which is ×10–15 the sky (0.022–0.036), so
  the whole fog volume glows evenly. `main.ts:1013` raises exposure by +18 %, which is the wrong direction for a
  100 ms flash. The directional light has no shadow.
- **Fix:** Keep exposure fixed during flashes. Fog colour gets no more than +0.03 at peak. Give the lightning
  DirectionalLight a shadow outdoors only: one 2048 orthographic map, 60 m box around the player, re-rendered once
  per strike with `shadow.autoUpdate = false; needsUpdate = true` at the strike, and kept in the LightsNode key
  permanently. Set its azimuth per strike (±40° around L_LTN_SUN). Light the cloud base with the sky background
  ×8 and the fog ×2 at peak, not ×15.

### 4. Eye adaptation with a room-aware range (QA #1, agreed; numbers below)
- **Seen:** `max-05` and `hero-upper` are > 90 % black, while the parlor is mid-grey. Baked mean irradiance
  is 0.125 in the parlor and 0.0006 in the upper hall, a factor of 200.
- **Cause:** `pipeline.uniforms.exposure` is fixed at 1 (`pipeline.ts:212`).
- **Fix:** Meter the log-average luminance of a 64×64 downsample, centre-weighted, with an async readback every
  0.25 s. Use target key 0.12 and clamp exposure to [0.7, 24] (+4.6 EV max). Adapt brighter with τ = 6 s (a
  dark-adapting eye, which also suits horror) and darker with τ = 0.5 s. Flashlight on → the meter sees the hotspot
  → the surroundings sink, which is real behaviour. Scale grain with log2(exposure) (item 8). Per-room
  `exposureMax` in the layout lets design keep set pieces darker.

### 5. Candle specular at full physical strength (new)
- **Seen:** varnished floors, brass, glass and wet paint show no candle highlights. Window glass shows only a
  faint dot.
- **Cause:** the baked lightmap carries the candle's diffuse light. Its specular comes only from the flicker
  PointLight at `base × FLICKER_SHARE 0.22 × (0.35 + 0.65k)` (`lights.ts:251`), about 8 % of physical on average.
- **Fix:** Give LightmapMaterial its own lighting model (a subclass of `PhysicalLightingModel`,
  `three/src/nodes/functions/PhysicalLightingModel.js`) that scales `directDiffuse` by the flicker share and
  leaves `directSpecular` at the light's full candela. Drive the flicker lights at full `base × (1 + 0.3k)`.
  Multiply the specular by `saturate(lightmapLuminance / expectedDirect)` as a cheap shadow proxy so
  highlights don't leak through walls.

### 6. Reflections: box-projected room cubemaps + exterior sky env (new; this is the biggest missing photoreal cue)
- **Seen:** night windows are flat blue, not mirrors of the lit room. Wet porch, drive and car paint
  (roughness 0.25–0.35, wetness 0.8–1) look matte.
- **Cause:** no `scene.environment`, no `envNode` and no reflection probe anywhere in `src/`. Glass is
  `opacity 0.15` with "reflection only" (`bind.ts:183-189`), but it has nothing to reflect.
- **Fix:** Capture one 128 px cube per room at load with the lightmapped scene (CubeRenderTarget, then PMREM via
  `pmremTexture`). Apply it to glossy materials (roughness < 0.6) with `getParallaxCorrectNormal` (r186 TSL) using
  the room box. Outdoors, use a PMREM of the sky gradient plus a flash variant. Budget: about 25 cubes × 128² × 6
  faces at RGBA16F, roughly 10 MB. Medium and Max only.

### 7. Fog density 6–10× too high (QA #2 visibility, agreed in part; I keep some haze)
- **Cause:** `main.ts:565` uses `FogExp2` density 0.028 + mist × 0.022. 5 %-contrast visibility is √3/D = 62 m,
  or 35 m in mist, and the facade at 12 m is 30 % fog.
- **Fix:** Density 0.006 (≈ 290 m, heavy rain at night) and no more than 0.012 in mist. Let rain streaks and
  wet reflections carry the weather. QA's 1–2 km is daytime heavy-rain visibility and would lose the mood.

### 8. Film grain (QA #4, agreed)
- **Cause:** `pipeline.ts:96-99` adds ±0.06 per-pixel white noise in display space, weighted (1 − 0.7·L), so it is
  strongest in pure black. The negative half clips, lifting black by about +0.015 (≈ 4/255), which turns the
  shadows milky.
- **Fix:** Amplitude 0.03. Weight with a mid-tone bell `4·L·(1−L)` plus a 0.15 floor, scaled by `log2(exposure)` once
  item 4 lands. Use 1.5 px grain (hash on `floor(coord / 1.5)` with bilinear blending), and keep it zero-mean after
  clamping (apply it as `c·(1+g)` in linear light).

### 9. KLM low-end quantisation crushes dark rooms (new; found in the encoder)
- **Cause:** atlases are encoded with mantissaBits 7 and floorExp 8 (`lm_*.json`, `blender/lib/encode.py:89-104`).
  Values < 2^-8 = 0.0039 snap to steps of 2^-15 = 3.05e-5. The upper hall's mean of 0.00019 is about 6 steps,
  which will band visibly once item 4 lifts it by +4 EV.
- **Fix:** floor_exp 13 (steps of 1e-6) for upper_hall, upper_rooms, car and exterior. That costs < 3 % in size.
  It is a re-encode from the cached EXR, or a re-bake if the EXRs are gone.

### 10. Upper floor has no key light (QA #1, agreed)
- **Cause:** the upper-hall atlas peaks at 0.035 (p99 0.008). The only sources are the CIE night sky
  (SKY_LZ 0.0098) through U1S, and U2's lamp behind a door.
- **Fix (design-safe):** a guttering candle on the landing table (6 W ≈ 0.48 cd, 1800 K, bake_flicker). Upper-floor
  doors stay ajar 10–15 cm so the U2 lamp (60 W) spills a bounce wedge into the hall. Raise the bake's sky to the
  skyglow of a lightning-lit cloud base, SKY_LZ ≈ 0.02. With item 4 that gives readable forms at about −3 EV
  relative to the parlor.

### 11. Flashlight (QA #6: agreed on the shape, overruled on 200–500 cd)
- **Seen:** at 1 m (`max-04`) the beam is a texture-less near-white disc and everything 20 cm outside it is black.
  At 2 m on the clapboard (`max-02`) the disc has a hard edge.
- **Cause:** `src/render/flashlight.ts:14-19` and `:37`. The cookie is core 0.6 (σ² 0.035) plus a flat spill of
  0.5 out to r 0.95, so the hotspot is only about 2× the spill. 30 cd over a 27.7° half-angle comes to
  ≈ 15–22 lm, which is right for a 2-D-cell bulb. Nothing bounces the beam, and the rig's "gain" dims the
  torch itself instead of the camera.
- **Fix:** Peak 60 cd, core weight 0.9 with σ² 0.02 (≈ 6°), spill 0.12, which keeps the total flux at about
  20 lm. QA's 200–500 cd belongs to a focused Maglite and would make the clipping worse. Add a beam-bounce
  PointLight (no shadow): put it at the raycast hit point pulled back 0.25 m, colour = hit albedo, intensity ≈
  E_hit × ρ × 0.05 (≈ 0.5–1.5 cd at 1 m), decay 2, distance 4. Remove the torch-dimming gain once item 4 is in.

### 12. Clapboard reads as stone (QA #5, agreed; cause found)
- **Seen:** `max-01` and `max-02` show blocky dark slabs that read as brick or stone, with no lap shadow line.
- **Cause:** the `clapboard_peeling` spec has peel 0.55 (× 0.8 chip coverage) over `bareWood [0.12, 0.10, 0.08]`
  under paint 0.42, about 4:1 (`wood.ts:216-240`). The lap is only a normal/height profile, and it disappears
  under a camera-mounted light and a flat fill.
- **Fix:** bareWood should be silver-grey `[0.27, 0.25, 0.22]`. Peel 0.25, concentrated in the lower 1 m and
  under the eaves. Build the facade boards as real geometry: a 12–15 mm butt every 0.10 m, so the bake and the
  lightning shadow draw lap lines. Paint roughness wet 0.35. Lit windows (G2, front door transom) emit at 1850 K
  from the interior lightmap through the glass.

### 13. Paint-chip pox on all trim (new)
- **Seen:** dark 1 cm dots spread evenly over the window casings, crown and baseboards (`max-03`).
- **Cause:** in `trimPaint` (`wood.ts:206-207`), chipSizeM 0.012 exposes underlayer `[0.10, 0.075, 0.05]`
  under paint of about 0.5, a 5:1 contrast, with no edge mask.
- **Fix:** underlayer = an older paint coat `[0.33, 0.30, 0.24]`. Mask chips by edge/curvature (the cavity or
  bevel term) and by height < 1.2 m. Chip density 0.1 in the field, 0.6 on edges.

### 14. White balance (new)
- **Cause:** candles are 1850 K with no white balance (`grade` only does tint and saturation, `pipeline.ts:222`),
  so every candle room is one hue of orange.
- **Fix:** Per-zone white balance through `uniforms.tint`: indoors balance to 3000 K (the candle stays amber,
  but whites, greens and greys separate). Outdoors use 4500 K, so the moon at 4100 K and the sky at 7500 K stay
  cool. Blend over 1 s at the doors.

### 15. Sky is inconsistent with the bake; hard black horizon (QA #5, part of it)
- **Cause:** `SKY_COLOR [0.022, 0.026, 0.036]` (`level.ts:68`) is about 2.6× the bake's zenith of 0.0098, and the
  ground gets about 0.017 irradiance at albedo 0.05. The sky glows while the ground is black.
- **Fix:** Background = the CIE overcast gradient at SKY_LZ (horizon at Lz/3), × a skyglow of about 1.3 near the
  horizon. Add a distant treeline/fence silhouette card at 150–300 m (geometry lane).

### 16. Varnished floor too dark (QA #9, part of it)
- **Cause:** `floor_varnished` baseColor `[0.10, 0.056, 0.028]`, luminance about 0.06. Next to a candle it reads
  black, while a 0.5 ceiling reads bright.
- **Fix:** Aged oak under worn varnish: `[0.17, 0.10, 0.055]`, varnish roughness 0.3 (0.45 on the wear path).
  Most of the floor's read should then come from items 5 and 6. A re-bake is optional (avgAlbedo changes the
  bounce by < 5 %).

### 17. Ada and characters (QA #1 and #6, part of them)
- **Cause:** skin is plain `MeshStandardNodeMaterial` at roughness 0.7 (`loader.ts:134`). Hair is one GGX lobe at
  roughness 0.25 with alphaHash (`loader.ts:126-128`). Medium has no GTAO, so she has no contact shadow on the
  lightmapped floor.
- **Fix:** Physical material with wrap diffuse (0.3) tinted `[0.6, 0.25, 0.2]` for the drowned-pale SSS, plus
  sheen 0.2 for the wet skin film. Hair: shifted dual specular (Kajiya-Kay, shift ±0.1, roughness 0.2/0.4).
  Add a capsule contact shadow: 2 capsules (legs) projected on the floor, 0.3 m radius, 60 % strength, on
  Medium.

### 18. Rain on glass and windshield (QA #10, agreed)
- **Fix:** refractive drops that sample the scene behind them (screen-space offset 0.02 × drop normal).
  Highlights appear only where a light is behind a drop. Streaks run at 0.1–0.3 m/s, the wiper arc clears, and
  the dash glows at 0.8 W / 4π (the light already exists as `dashboard`).

### 19. Cutscenes: C5 shadow-play, C6 dawn (QA #7 and #8, agreed)
- **C5:** put a shadow-casting candle (0.95 cd) 0.4 m behind Ada and 1.5–2 m from the wall. Frame on the wall, and
  keep the foreground figure out of the lens (≥ 0.6 m from the camera, or DOF focus on the wall).
- **C6:** civil-twilight gradient (sun −4°, horizon about 3 lux, zenith ×0.3). The car paint needs item 6's
  sky env to read at all.

### 20. Dim-atlas bake quality (new; do it after items 4 and 9)
- **Fix:** once exposure lifts the dark rooms by up to +4.6 EV, review upper_hall and upper_rooms at Medium
  (64 spp + OIDN). Expect blotches. Re-bake those two at 256 spp with portals, or let OIDN use the
  albedo+normal guides if it doesn't already.

### 21. Opening drive leftovers (runtime-d AD review, 2026-10-08; frames scratch/rd/l5, Medium, current tree)
Ranked, worst first. Not yet verified fixed; the review was blocked (battery 10 %, Chrome lock held).
1. **C0 26.5 road inverted wetness**: asphalt an even mid-grey from 5 m to 100 m (no light fall-off), puddles pitch-black.
   Real: wet asphalt near-black, puddles the brightest mirrors (headlight streaks, sky glow). Suspect the reflection term
   (asphalt lod 1.4–2.1 grey, puddle lod 0.25 black) — RC9 probe content or headlight GGX. Leading hypothesis (code read, unverified): Reflections.capture() hides scene children and darkens `darken` lights but leaves scene.fog on, so the RC9 cube's horizon ring is grey fog; the blurred mips the asphalt samples smear it into every direction, while the puddles' sharp lod hits the black sky. Run scratch/rd/road3.mjs first, plus one frame with the look API `reflections` = 0.
2. **C1 60.5 / 61.8 over the Medium draw budget** (450 / 413 > 400). Run scratch/rd/dr.mjs (q21) for the breakdown.
3. **Rain lit everywhere in C0 26.5**: streaks visible against the black tree walls; real rain shows only inside light.
4. **Headlamps read as cold LED slabs** (C1 60.5): want 3200 K, lit lens disc with a hot core.
5. **Car paint has no wet sheen** under the lantern (C1 60.5); fog is a flat veil with no lantern scatter cone.
6. **Unreviewed on the current tree** (need Chrome time + mains): the rest of the C1-OPENING §11 frames, parlor perf,
   first-person gloves/arms (torch, wheel grip, map), upstairs key candle, armoire slat view, Ada under the torch (#17).

## C2-ESCAPE Phase 1 — art/horror-director review (2026-10-09)

Frames: `scratch/esc-review/r1med-*` (as built), `r2…r4med-*` (after the review fixes); Medium, WebGPU, 1280×800,
simulated time (`scripts/qa/c2e-hero.mjs`, `scratch/esc-review/r2.mjs`). Max frames: see STATUS-escape-cine "Review".
Judged against a photograph and against the user's words (beheading clearly visible, really horrifying, she follows
you up the stairs, the empty stair, then the game begins).

**Verdict: not photoreal yet, and the user's first sentence is not met.** The beheading is NOT readable in one still
(C2 7.62/8.45): the gown is a cream lump that hides the stump, the jets are a few sub-pixel red dots (620 particles on
Medium), the head is a dark hair ball against a dark sheet. The stair half now works as a sequence: the climb is lit
again, glance #2 shows her grey hand on the rail, the empty stair is a strong frame.

| # | Problem (frame) | Why it isn't real | Fix (owner) |
|---|---|---|---|
| 1 | The strike does not read (C2 7.62, 8.45) | no visible separation at contact; jets sub-pixel; stump hidden by the gown lump | stage the stump in profile against the lamp (camera/blocking, B-CINE); jets ≥ 3–4 px wide streaks with motion blur on Medium (B4/B8); a visible gap at 7.62 (head node offset on contact frame) |
| 2 | Ada's gown/torso = white plaster mannequin (C2 2.4, 24.0; B05 1.5 m) | clipped highlight (lamp 0.4 m away, C2's exposure clamp 0.5–2.2 disables the highlight cap), no folds/texture at that luminance, blocky torso silhouette | A11 wet-cotton atlas + fold normal detail (A); let C2's meter protect the lamp-lit gown (B-CINE) |
| 3 | Cut faces = flat red discs with a white "target" vertebra (C2 9.9, 24.0; B05) | 120–150 px texel density, almost no relief; the white vertebra cross reads as a sticker | 512 px cap texels + displaced/normal relief, blood film over bone (A2); runtime wet film added (r2) |
| 4 | Eye insert (C2 13.9) not working | the face is back-lit by the lamp and behind the hair veil; at 100 mm it is a silhouette | key the lamp side (3/4 to the lamp done in r4), a cornea glint, a real 2 cm veil gap (A3/B3, Phase 2) |
| 5 | Head on the floor (C2 9.9) = hair ball + flat disc, 0.2 m from its pool | no ear/jaw profile, pool not under it | rest pose with the profile up, pool spawned under the cut (B-CINE) |
| 6 | Pools/prints (C2 9.9; C2c 12.6) | pools are opaque red ellipses (no reflection, unshadowed custom shading); prints are dark SQUARES with a pink foot | pool env reflection + shadow term; prints: atlas mip bleed suspected (pool cell 11 above print cells 12/13) — test `generateMipmaps = false` (B5) |
| 7 | Glance #1 (C2c 4.0) | headless doesn't read: cream lit torso from above, not a silhouette against the fanlight patch | re-block her between the camera and the patch (B-CINE) |
| 8 | Balusters (C2c 4.0, 12.6) | bright white specular outlines / shimmer | baluster roughness/AA (A/B) |

Fixed in this review (logged, CONTRACT-CHANGES #97–#101): the black climb (beam clamp in C2c), glance #2's subject
lit, the held head faces the camera 3/4 to the lamp, the eye-insert aim, the wet cut-tissue film.

## Merged and overruled QA points
- Agreed: QA #1 (dark frames), #3 (outlines/CA, cause now found), #4 (grain), #5 (facade), #7 (C5), #8 (C6),
  #10 (rain glass).
- Overruled: QA #2's 1–2 km visibility (≈ 290 m instead); QA #6's 200–500 cd (60 cd plus a bounce light
  instead); QA #9's "probe leak" (the cause is the shadowless directional, item 2).

## Must not regress
- Physical light units: candles 0.8–0.95 cd at 1800–1850 K, lamp 4.8 cd, lightmaps × π (SMOKE S3).
- The parlor's candlelit wallpaper: legible damask and a soft baked bounce with no blotches (`max-03`, `med-01`).
- AgX tone mapping: hue-stable highlights, no cyan/yellow skew on flames.
- Victorian architecture: sash windows, casings, crown, porch balusters and stair at correct scale.
- Tree silhouettes on Max (`max-01`): a convincing bare-branch structure.
- The flashlight: shadowed, warm 2800–3000 K tint, soft penumbra, right lumen class.
- The darkness itself: whatever the exposure change, the halls must stay frightening. Exposure is capped at +4.6 EV.
- Performance: 3–8 ms GPU on Medium and 0 console errors in the AD runs. Items 6 and 11 must stay within
  ≤ +1 ms on Medium.

## Requests for the lead
- Items 1, 2, 7 and 8 are about 10 lines of runtime constants in total and fix most of what reviewers will call
  "fake": land them first.
- Items 9, 10, 12 and 20 need the Blender lane (one re-encode, two re-bakes). Queue them serially with
  `scripts/assets.mjs`.
