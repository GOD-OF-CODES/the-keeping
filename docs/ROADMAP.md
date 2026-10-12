# Roadmap — remaining rounds (lead-owned)

User priorities, in order: **photoreal graphics** → many short cinematic cutscenes (`docs/CUTSCENES-PLAN.md`) → ship
on https://the-keeping.vercel.app. All credits to Raj Vardhan Singh. Max 3 agents; one headless Chrome / one Blender.

## Done
- Foundations, full B01–B13 route, C1–C7, AI/story, synthesized audio, voice pipeline (subtitles until a key exists).
- QA-1: lightmap tier budgets, input/lure fixes, e2e tests. QA-2: real-game playthrough bot, perf tables, realism
  backlog (`docs/REALISM-BACKLOG.md`), perf plan (`docs/PERF-PLAN.md`).
- Round A (perf): warm load Medium 44 → 12.5 s, WebGL2 76 → 18.6 s, programs −35…70 %, Low/WebGPU FXAA, shipped
  probes, split ground octree, stable light lists (no rebuilds on torch/indoor-outdoor).
- Round A (Blender): trees + LODs, treeline, ground cover, moonlit bakes, pole line (commit 0faebb9, not pushed).

## In progress
- Round B (lighting/camera, `docs/REALISM-STATUS.md`): post chain, eye adaptation, moon/lightning, fog, grain, white
  balance, sky; candle specular, reflections, flashlight + bounce, trim/floor, Ada shading, rain glass, C5/C6,
  C7 LightmapMaterial.clone crash.

## Next — Round C (after B; then commit src + push once the playthrough bot reaches the ending)
0. **Opening drive C1 (+ title cinematic C0) — FIRST, user-flagged ("nothing is visible"):** lead check
   (scratch/lead/c1-now-*.jpg, Medium, round-B tree): interior framing wrong (headliner fills the top third, glows
   orange; no dash/gauges/wheel visible; hands are blobs); headlights don't light the road (two bright bars, black
   road); ROOMS sign a blurry smear; windshield rain = specks; lantern = big sprite flare; FP arms visible in
   exterior shots. Good already: the lightning reveal of the house, trees vs sky. Fix: Blender — scaled 1980s
   dash/cluster/wheel/A-pillars/mirror/headliner; runtime — driver eye ≈ 1.15 m + lens per shot, halogen low beams
   (≈ 700–1000 lm, 3200 K, real beam pattern) on wet asphalt with reflections, spray and markings, windshield rain +
   wiper arcs, crisp painted sign lettering, arms hidden outside; shot-by-shot art-director review vs a real rainy
   night drive. Build C0 (docs/CUTSCENES-PLAN.md) in the same pass.
1. **QA/story (gate for any push):** playthrough bot stalls at B08 in U2 near (5.2, 3.2, 4.1) since the round-A
   assets (old assets finished) — find the collider/waypoint cause. Regenerate `probes.bin` for all tiers
   (`npm run probes`), and make `scripts/assets.mjs` warn/invalidate probes when level GLBs change. Full playthrough
   on Medium + spot checks Low/Max, cold and warm loads reported separately, on mains power.
2. **Blender:** lead decisions → `grass_dead` material (family grass, dead straw, albedo ≈ 0.18–0.22 linear,
   roughness 0.65–0.75, wetness 0.6) and raise `grass_wet` albedo toward 0.10–0.15 (via `scripts/layout/materials.mjs`
   + calibration entries) then `--only house`; arms hold pose rotated 20–30° (barrel visible, not the tail cap);
   upstairs key candle + doors ajar + sky Lz (backlog #10); KLM `floor_exp` 13 on dark atlases (#9); clapboard lap
   geometry check (#12); automatic single retry on Blender "terminated abnormally". Then — alone, mains power, no
   Chrome — `npm run assets -- --only bake-release --force` (~80 min), encode, probes.
3. **Materials/perf:** clapboard runtime generator (peel stretched along u, butt joints every 3–5 m, mildew broken
   across courses, rain/grime streaks under sills and eaves); alpha-tested twig cards for winter crowns; P1-6b fewer
   lighting groups; P2-8 Low frame ≤ 4 ms; Max is CPU-bound (21 fps, 2.85 M tris / 602 draws in the yard) → meet
   the Max budget (≥ 45 fps, ≤ 2 M tris, ≤ 500 draws) without visible loss; C2 first-frame shader builds;
   lightning shadow warm-up; footstep zones on the new drive shoulders.

## Lead rulings (log in CONTRACT-CHANGES at the next src commit)
- Yard trees capped at 64k triangles (dropped 1.8 mm spurs are ≤ 1 px at the closest view) — accepted.
- Max budget: ≥ 45 fps, ≤ 2 M tris, ≤ 500 draws (visual parity required, not unplayability).

- **Opening (docs/C1-OPENING.md §10), 2026-10-08 — all approved:** (1) layout: RC9 room + `P_RC9_*` props + `L_DOME`,
  `L_CAB_VEIL`, `L_TRUCK_HI_L/R`; headlights get `cd`/`beam`/`kelvin` 3200 (no more 3000 W); `L_DASH` → spot at the
  cluster; CAR ceiling 1.15 → 1.34; `L_LANTERN` 60 → 150 W (the release bake picks it up). (2) `src/shared/road-rc9.json`
  becomes the shared corridor definition (Blender reads it). (3) `sedan_interior` in car space; re-tune `stage.ts`
  targets. (4) St Christopher medal in C1; the pine freshener stays the sting's tell. (5) The three new driver lines.
  (6) **Low budget 25 → 27 MB** (pipeline.json; the card shows the real manifest size). (7) EXT1 sign text → "CARVEL 48".
  (8) The new material ids. (9) Arm clips + close-up gloves → next Blender round. C0 aerial: the runtime must cull the
  corridor instances by chunk/distance (≤ 1.5 M tris Medium, ≤ 2 M Max in every C0 shot).
- **Spec requests approved:** #34 `grass_dead` (albedo ≈ 0.20, roughness 0.70, wetness 0.6) and #41 `grass_wet`
  avgAlbedo → [0.09, 0.12, 0.06]; bounce colours follow at the next house bake.
- **B08 review rulings (2026-10-08):** (a) Ada never senses light she can't see — `beamNear` needs line of sight (row
  #40 stands). (b) A torch spot she *can* see may replace an active bell lure: DESIGN's "newest(LURED | INVESTIGATE)"
  stands; the line-of-sight rule makes it fair. (c) Add a `QA_TORCH_ON=1` Medium playthrough to the release gate.
  (d) `H_ARMOIRE` eye → [3.12, 4.45, 5.65] (off the meeting stiles; clears the rail). (e) Keep the renderer's raised
  per-stage sampler limits only if Max needs them; Harlan's Max shaders are at the M1's 16-sampler limit — no new
  texture/shadow wrapper on characters without freeing one.
- **Power note:** the charger dropped 02:01–06:37 on 2026-10-08 (Mac hibernated at 1 %); every perf number in that
  window is a battery number — re-measure on mains before any perf ruling.
- **Difficulty (user, 2026-10-08: "i shouldnt get caught very easily"):** Ada must forgive ordinary play — walking,
  torch on, the odd noise. A catch needs a clear mistake (running into her, standing in her path, lighting her face up
  close). Tension comes from tells, near misses and chases she gives up. Gate: a "careless player" bot (walks, torch
  on, rarely crouches) reaches the ending with ≤ 1 death on Medium; the stealth bot with 0 deaths. Nobody may be caught
  within 6 s of a cutscene ending (C3 → B08 left her 3.3 m away).
- **Props finishing (user, 2026-10-08: "the finishing in the props is still not there, need more detailing"):** a props
  detailing round (audit → finishing system → Blender geometry/normals/masks → runtime wear/grime/edge materials →
  art director) runs next, alongside the gameplay and runtime lanes.
- **Props finishing design (docs/PROPS-FINISH.md), 2026-10-08 — approved R1–R6:** the COLOR_0 `wear` pipeline (row
  #59 now APPROVED), optional `params.wear` in `material-types.ts`, the `grime_decal` spec (via materials.mjs); dust
  0.3–0.6 on furniture/metal specs; the R3 spec reassignments (cleaver → steel_cleaver, forged-steel shears/hammer head,
  hickory handle, jerry can = painted sheet steel over red-oxide primer, wool bell pull); toCreasedNormals leaves
  opening.ts once the weighted normals ship; a C1 sedan_interior scenario hook; a soot decal above the U2 lamp.
  Low: masks on as many HERO props as the 27 MB budget allows (measure first; never exceed the budget).

- **Round D results → round E rulings (2026-10-09):** (a) `QA_STRICT=1` is the playthrough gate default (a bot
  teleport rescue = a fail); the release gate = Low/Medium/Max stealth + Medium careless + Medium torch-on, all strict.
  (b) Respawn fairness: after any death an idle player must survive ≥ 60 s at the respawn point of every checkpoint
  (CP1–CP8); `grace()` starts her patrol away from the player (CP4 may move into Harlan's doorway). (c) Controller
  step-up capped at 0.27 m (real risers 0.25 m); tables and chairs are not climbable. (d) Back stair → kitchen: move
  `P_KITCHEN_CHAIR_2` (the tipped chair) out of the doorway lane; `D_BACKSTAIR` keeps its hinge (a leaf swinging into
  the 0.8 m shaft would block the stair); ≥ 0.8 m clear lane with the door open. (e) CONTRACT #68b (probe-lit props get
  the candle/lamp direct term) is kept — it is physically right; the warm-up must cover the recompile it adds.
  (f) woodGrain Nyquist cap 0.7·size → 0.5·size approved (shimmer is not photographic), with full wood recalibration.
  (g) Print canvases (bus ticket, air freshener) keep no `COLOR_0`; their ageing (thumb-soiled corners) is painted in
  the paper canvas path. (h) Grime decals on (`kit.GRIME=True`) within budget; on Low drop grime decals first, then the
  dress_dummy mask, never exceed 27 MB. (i) Max first load stalls 300 s at "Compiling shaders — U4T" (2 of 2 Max runs):
  release blocker, next runtime round item 1. (j) Blender trunk collider proxies deferred — the runtime trunk box
  (#61b) stands. (k) Duplicate CONTRACT rows renumbered 61b / 67b / 68b.

- **Runtime D review → rulings (2026-10-09 05:20):** (a) Torch photometry 2000 cd peak / 30.9 lm (CLAUDE.md's 2–3 kcd,
  ≈ 27 lm) is confirmed; backlog item 11's 60–120 cd ruling is void. (b) The draw/triangle budgets apply to cutscene
  frames too: C1 60.5 (≈ 498 draws) and 61.8 (413) must reach ≤ 400 on Medium (≤ 500 Max) by culling/merging/instancing,
  never by removing visible detail. (c) Parlor lightning shadow stays 2048: the parlor's 10.5–10.9 ms GPU is inside the
  60 fps budget, so the old relative "+1.5 ms" target is closed — no visual downgrade for it. (d) The asphalt-albedo
  request is withdrawn (measured ≈ 0.04); the C0 road needs wet-aggregate sparkle + rain rings in puddles (next materials
  round). (e) Pre-render score_reveal during loading (audio, runtime lane E may do it surgically). (f) probes.bin is
  regenerated by the lead after the last GLB rebuild of a round, before the commit. (g) Blender opening round (after
  props E frees Blender): C0 canopy variety + blanket/horizon seam, C1 41 trunk lighting/bark, cabin mid-frequency
  soiling + faceted A-pillar trim, armoire slat gaps.

- **Incident, 2026-10-09 ~08:00–09:55:** iCloud (quota full, Optimize Mac Storage, disk 94 %) evicted ~2.9k repo files
  (read as empty; git/vite/shot.mjs broke). All agents stopped; every file recovered and verified (git hashes, build
  source maps, transcript replay); the repo now lives in `~/Documents/ultrarealistic-horror-game.nosync` (the old
  path is a symlink); the old iCloud folder is kept as `ultrarealistic-horror-game-OLD-icloud`. Local commits since
  c55d52d were squashed into f93285d. `.env.local` (ElevenLabs key) must be re-added by the user at the voices step.

- **User direction (2026-10-09) — the house escape sequence is the top realism priority:** "keep the escape sequence
  inside the house really photorealistic and ultra high graphics, the beheading of the woman visible clearly and should
  look really horrifying, should feel scary the headless woman follows you up the stairs and when you look back after
  the top of the stairs she is not there, cut scene ends here and then the game really begins". Rulings: (a) C2 shows
  the beheading clearly (no longer shadow-only; the boot content warning already covers gore); (b) Ada is fully
  severed — her HEADLESS body rises and pursues; (c) B04 becomes a cutscene (no catch possible): the chase up the main
  stair, the look back from the landing at an empty stair, cut to gameplay at B05; (d) lore follow-on: from then on
  she carries her severed head and lifts it to look at faces ("…Harlan?"), which makes the B05 slat scene, the finale
  and the C7 sting literal; (e) staging still protects realism (hair over the face, one key light, motion, grain).
  Design first (docs/C2-ESCAPE.md), then Blender + runtime + story builders, then a harsh art-director review. This
  sequence goes ahead of the other cutscene rounds.

- **Runtime F rulings (2026-10-09, from docs/RUNTIME-F-PLAN.md):** (F1) Max GTAO: Option A (AO from the scene pass's
  own MRT normals/depth, reprojected history — no second scene render) is approved IF a frame-diff A/B at the review
  views shows no visible difference in still frames and a fast-turn test shows no visible ghosting; otherwise Option B
  (one override material for the pre-pass + far-yard layer skip). Max visual parity is the bar either way. (F2) Indoor
  window sub-frustum culling of EXT1/EXT2 children: approved; window views must be pixel-identical (inflated bounds).
  (F3) Torch shadow layers indoors (interior casters only) + no casters < 3 cm radius: approved. (F4) GC stalls: cut
  node builds (F1, dispose one-shot contexts), raycast proxies instead of full-mesh per-frame picks, and remove the
  biggest per-frame allocations — target no frame > 50 ms in a real-time C0 → C1 run on Medium and Max. Perf numbers
  only on mains power with no Blender running.

- **C2-ESCAPE design (docs/C2-ESCAPE.md rev 2) — lead rulings 2026-10-09 18:20:** APPROVED K1–K13 as written (the lamp
  restaged on the moved stool; `bakePass: 'indirect'`; the single cube-shadow light becomes L_LAMP_PARLOR and moves by
  cue, with the approved fallback if it costs > 1.0 ms on Medium; scheduled sfx cues on the AudioContext clock;
  ST_MAIN = 16 risers, stumble on creaker 12; the absence rule "the body goes back to wherever its head is, unseen";
  the heart restarting when the body rises; b05_return never catches; lane C owns scripts/qa). #17 skin/gown and the
  first-person gloves are scheduled IN this round (gates for S10 and the stumble). The parlor `indirect` bake joins the
  release bake (no browser running). SCOPE CONTROL — the doc's 218 estimated hours are too many: build in two phases.
  **Phase 1 (ship gate):** the sequence plays end to end at the doc's core look — C2 strike legible + blood (film,
  jets, pools) + head on the floor/lifted + the rise; C2c both glances + the empty stair + the handover; B05 return;
  headless Ada in gameplay through ONE runtime head-carry mechanism (head node attached to her hand + a carry/lift arm
  override layer) instead of re-authoring every later clip; #17 + gloves. **Phase 2 (only after the Phase 1 art-director
  verdict):** the 100 mm eye insert polish, per-clip head-carry retrofits where the override reads wrong, extra clips.
  Runtime F (U1 culling etc.) runs alongside and lands before the escape sequence's second art-director round.

- **Escape Phase 1 verdict → fix round rulings (2026-10-10 03:00):** Phase 1 plays end to end and gates pass
  (commit 86faa8d, pushed to origin/build only — held from the live site until the beheading reads clearly). (a) #1
  priority for every lane: the beheading must read unmistakably in ONE still at play resolution on Medium (the stump
  visible, jets visible, the head reading as a head — ear/jaw/cheek profile, hair parted), not a gown lump, dots and a
  hair ball. (b) Parlor lamp cube shadow: a caster split is approved — the cube renders only a dedicated caster layer
  (Harlan, Ada body + head, the cleaver, the sawbuck, the stool/lamp and furniture within 2.5 m of the flame); walls and
  floors don't cast into it (their occlusion lives in the lightmap/bake). Every C2/C2c/B05-handover frame must meet
  ≤ 400 draws / 1.5 M (Medium) and ≤ 500 / 2 M (Max). (c) Cutscene exposure keeps highlight protection (no plaster-white
  gown). (d) The eye beat (head lifted, one clouded eye opens) is a core beat — a working version is in this round.
  (e) Max must never render at a lower internal resolution than Medium in the same view; fix Max-only costs instead.
  (f) GC pauses: no frame > 50 ms in real-time C0 → C1 and C2 → C2c runs (lazy per-beat warm/dispose).

- **Fix round 1 verdict → fix round 2 rulings (2026-10-11):** fix round 1 meets (a) in exactly one Medium still (C2 9.30:
  stump on the table, head on the floor, cut ring toward the camera) and the gates pass on Low/Medium/Max, but it is NOT
  photoreal or horrifying yet: the floor head is ~120 px and reads as a dark jar with a red end, the face is a smooth
  grey mannequin, pools read as flat lobed petals (decal shapes), jets as dotted beads, gown/torso as plaster or salmon
  plastic, Harlan's leg as a mannequin with cream patches, glance #1 not headless. Committed to origin/build, **not
  live** (main stays d70bdf1). (g) Build fix round 2 backwards from ONE hero beheading still — close (≤ 1.5 m), the cut
  face ≥ 30° toward the camera, the lamp keying the stump, the head partly turned so wet hair hides most of the face; the
  cut, the blood and Harlan's action carry the horror, the face is the subject only in the lit eye insert. (h) Blood as
  volume, not FX: arterial jets are continuous ribbon/tube geometry pulsing with the heart (decaying pulses), not a
  720-particle cap; pools are thick glossy liquid (dark core, meniscus edge, near-mirror fresh roughness reflecting the
  lamp and room) that spread, run off the table edge and down the cloth, and drip; spatter on cloth, apron and floor.
  Use measured numbers (blood optics, arterial pressure, flow) and state them. (i) The 13.9 eye insert is lit (a lamp
  bounce or the face turned to the flame) — (d) still stands. (j) Cross-lane fixes: runtime `uSkinTint` toward the
  grey-blue bake; gown wet base 0.30–0.35 linear + stronger folds; fat ring 3–8 mm and blood-smeared; front veil
  re-weighted off head_root (retire `uHairVeilClear`); shape-key weights exported 0; the cut moved onto the joint it
  pivots from (retire the neck_02 attach of #117 — today it only affects C2 pre-strike, the only time the head is
  whole); head detail (pores, lips, lids, waterlogged skin) on a head-sized texture budget; Harlan's trousers/leg read
  as cloth. (k) Glance #1 reads as headless (shoulders with nothing above them against the fanlight). (l) Perf rulings:
  (f) is relaxed to: no frame > 50 ms at the strike or in C2c, the C2 entry ≤ 150 ms, major-GC frames ≤ 300 ms
  tolerated in C0/C1 until a later perf round (dispose/re-warm and the 100 s cold load are parked for that round);
  B05's 4 lightning-stroke frames ≤ 483 draws accepted for this commit, cine thins layer 9 next; (e) applies to WebGPU
  only (WebGL2 Max may drop to Medium's floor); contract 116 is disabled (frustum-testing casters is unsound; the C5
  change is unexplained); lazy sounds that still synthesise on first play are pre-rendered at load.

- **Fix round 2 verdict → fix round 3 rulings (2026-10-11 05:40):** NO-GO again (AD, "Review — fix round 2"): the E4
  hero still (head 1.42 m, ~330 px, cut toward the lens) is staged right, but reads as a black hair ball with a
  cream/gold "salami" lid beside a flat red disc on pale orange laminate; the strike frame's jets are neon wires and the
  body is white plaster. Committed to origin/build, not live. Lead diagnosis: the parlor floor spec is correct
  (floor_varnished avg albedo 0.145/0.086/0.047) yet renders pale, i.e. the C2 frames are exposed like a lit studio,
  not a night room under one 12 cd lamp (the cues allow 0.5–3.6) — this flattens everything and exposes every fake
  surface. (m) Exposure is MEASURED before anything else: a QA read-back of the live exposure and of linear pre-tonemap
  HDR pixels (the review scenarios' exposure accessor always logged 1); the hero exposure is derived from a stated
  film camera (ISO, f-stop, 180° shutter at 24 fps) through three's unit chain (lamp candela, lightmap × π) and written
  down; if the physical exposure still renders pale, the light chain is wrong and is fixed instead. Shadows may go
  black; the stump, the head and the blood inside the lamp pool must still read clearly (an explicit AD check). (n)
  Round 3 is sequential and narrow: stage 1 = exposure (+ lane A's objective regressions: bump terracing from the
  0.002 → 1.0 bump distance on character normal maps, Harlan's pink sleeve band, the head's bottle-like neck stub /
  disc cut → a short, ragged, two-stroke cut); stage 2 only what the re-shot still shows wrong inside the lamp pool.
  (o) Contract #119 (C2 POV lurches 1.3 m into the parlor to E4 after the strike) is accepted: it breaks the design's
  threshold freeze but gives the close hero still, and the gate proves C2c still reaches the stair. (p) Low keeps a
  reduced head (26.98/27 MB); photorealism is judged on Medium and Max only — no more round effort on Low's budget
  beyond staying inside it. (q) Contract 116 stays off until it tests the shadow cone (torch → caster bounding sphere,
  extended to the shadow far plane, both ends with their own radii, against the four side planes); Medium C2c's 50/834
  frames over (worst 447 draws / 1.54 M) are accepted on this build-branch commit only. (r) `neck_stub` (#120) is not
  driven yet — harmless while #117 keeps the head rig on neck_02; whoever retires #117 must drive it.

- **Fix round 3 verdict → fix round 4 rulings (2026-10-11 13:00):** NO-GO again (AD, "Review — fix round 3"). What
  round 3 fixed: exposure is now a physical film camera (ISO 3200, f/2, 1/48 s → 0.625; the 13.9 insert f/1.4 → 1.27;
  C2c 0.458) and the unit chain matches L = ρ·E/π within 3–7 %; the cut face is no longer gold foil; pools are analytic
  with a meniscus edge; jets break into drops; prints and stains no longer glow through walls. The measured cause of
  the NO-GO is STAGING, not shading: the one key (the lamp at plan (4.6, 4.25, 1.35)) leaves the stump in Harlan's
  shadow at the strike (0.004 vs boards 0.05–0.18) and E4 sees the head's unlit side (130° from the lamp). Committed to
  origin/build, not live. (s) Restage the key to the AD's measured candidate: P_STOOL / P_LAMP_PARLOR / L_LAMP_PARLOR /
  P_WHETSTONE move to plan (4.4, 3.6) (flame z 1.35) through `scripts/layout/build-layout.mjs` → `level-layout.json`
  (lead-owned; the staging agent edits these four entries only) plus `LAMP_FLAME` (stage.ts), cutscene-fx's 3/4 face
  aim, the QA scenarios' LAMP constants and `tests/c2-escape-stage.test.ts`. Every consumer is checked before/after:
  the C2 marks, the B03 threshold view, the C5 shadow-play, the C7 sting, the parlor's fixed views, Ada's rise path and
  Harlan's blocking (no prop in a walk line), the flame margins. Lane A re-bakes the parlor indirect after the move.
  (t) Whatever the new key reveals is fixed in the same round: Harlan's gauntlets → `rubber_black` (harlan.py ~529),
  the flannel's pale grazing strip and pink-reading plaid, the gown as wet cotton (never plaster), the cleaver (patina,
  blood coat, bevel highlight). No new geometry: Medium C2c has 5.5 k triangles of headroom, Low 40 KB. (u) Ruling (g)
  is amended for the floor head at 10.5: its rest pose / position turns so lamp → head → E4 is ≈ 60–80°; the lit
  cheek, ear, jaw and closed eye may show through the wet hair (still partly veiled, never a clean frontal face); the
  13.9 insert opens the eye (eyelid_l_open 1). (v) The strike spurt must be seen from the strike camera (steepen the jet
  axis within the measured neck chord, ≤ 30°, or adjust the 7.75–8.4 camera); blood particles get the lamp's shadow
  term. (w) LOOK: the cut face exactly as lane A specified (drop the double tint on cut texels; satin floor 0.12–0.15;
  rim film ~0.25 within 6 mm); B05 Ada's blown-out gown under the torch. PERF: the C2-start hitch (200–383 ms → ≤ 150
  ms) and the Max B05 hand-back GC stutter (~0.6 s). (x) Audio: nobody has heard C2 → C2c. An audio-lane agent records
  the real in-game mix headlessly to a WAV the user can play (`afplay`), and measures loudness, clipping and sync
  against the picture. (y) SHIP POLICY: round 4 is the LAST beheading-only round. After it, if the full gate passes
  and the AD confirms the build is strictly better than live (d70bdf1) with no regression elsewhere (a lower bar than
  photoreal), the lead pushes main; the remaining photoreal items move into the M-A cutscene round's backlog. The AD
  still says plainly what doesn't look real.

- **Fix round 4 verdict → ship + M-A rulings (2026-10-11 19:00):** photoreal NO-GO (the 10.5 floor head is still an
  unlit dark mass; the strike is legible but CG: salmon plaid, grey gauntlets 0.73 m from the flame, card-like cleaver,
  plastic sawbuck top), but the AD's ruling-(y) check says the build is strictly better than live d70bdf1 (live has no
  beheading or escape at all) with no regression elsewhere once #133 (the stale non-parlor lightmaps re-baked — the U1
  runner had gone black) is included. (z1) Ship it: the lead pushes main after the full gate. (z2) The heart layer's
  −5 dB trim (#132) applies to cutscene heartbeats only (`setHeartRate(bpm, true)` from the cue binding); gameplay
  chases keep the round-2 racing rise 0.25 → 0.40 — it is a chase tell. (z3) LOOK's gameplay "fixation" exposure
  protect stays (B05 Ada no longer a blown gown; gameplay frames −4 to −7 %, far more legible than live). (z4) Lane A
  checklist: after ANY props/house rebuild re-run every stale bake job (`assets.mjs --list`) and shoot one non-parlor
  room before posting READY. (z5) The beheading's remaining photoreal items join M-A as the "C2 upgrades", biggest
  first: a key for the 10.5 head (a second practical / re-frame), a flag or reflector keeping the flame off Harlan's
  arms, pools that follow the board seams, the 13.9 eye (lit, open, not a mannequin), glance #2 materials, the
  empty-stair torch-arm silhouette, the B05 gown and carried head. (z6) Hard stops for every lane: Low ≈ 10 KB of
  download left, Medium C2c 3.6 k triangles. Duplicate contract #132 (PERF) renumbered #134.

- **M-A + glitch-fix verdict → ship (2026-10-12 08:30):** the M-A AD says SHIP under (aa): the new scenes read on the
  real route and the one regression it found (#139's road cull through C6 → C6b) is fixed (#141). Photoreal is still
  NO for every new scene (waxy hands, plaster faces). The glitch lane (#139, user report 2026-10-11 21:15) fixed the C1
  road blink, the C2 head teleport, root-yaw snaps, camera whips, the C2c 2 s black and the cleaver card, all checked
  frame by frame and in real time. The M-A brief's rulings, recorded here: (aa) M-A ships on the full gate + the
  AD's "new scenes read, nothing regressed"; (ab) the infra agent alone registers cutscenes; (ac) exactly three new
  voice lines (subtitle-only); (ad) the cutscene resolution raise ships only if EVERY cutscene holds ≥ 45 fps. It
  doesn't (C5 36–43 fps, C4c 46 on Max), so it stays off (`CUTSCENE_SCALE_RAISED`). (ae) Low's DOM letterbox motion
  is fine. (af) The hard stops of (z6) hold. (ag) The lane A checklist (z4) holds. (ah) Every new cutscene is
  skippable after first view, and a skip leaves the world exactly as a full play.
  New rulings:
  (ai) M-A and the glitch fixes ship together on the lead's five-preset gate (Low/Medium/Max/careless/torch, strict).
  (aj) C2b ships registered but unverified in play. It is optional, safety-gated and skippable, and no bot triggers
  it (VIGIL at the first hide exit). The smoothness round verifies it with a patient-bot variant, or cuts it.
  (ak) Smooth motion is part of the photoreal bar (user, 2026-10-11): no stop-motion in cutscenes. Every round runs
  the 30 fps stepped capture + one-frame pop/flicker detection (scripts/qa or scratch/glitch pattern) on every
  cutscene it touches, plus real-time frame-time runs. Culling may never make visible geometry blink.
  (al) Byte-noise rebuilds (arms_normal, harlan_normal) are committed with their manifests, which hash them.
  (am) NEXT ROUND = SMOOTHNESS, before M-B:
  1. Stepped capture + detect on every cutscene not yet frame-checked: C0, C3, C4, C4a, C4c, C5, C5b, C6, C6b, C7,
     CR.
  2. The real-time stalls: C7 2.2 s (≈ 2.9 s on Max), C6 18.8 (≈ 1 s), C5 0.03 / 12.9, C4c 5.53. Warm up each
     cutscene's camera poses at load.
  3. GPU headroom in the C2 parlor close-ups: ≈ 16–17 ms now, target ≤ 14 ms. Today 112–181 frames per C2 run
     miss vsync.
  4. Budgets: C5 into CS_CULL_IDS after a same-state A/B; C2c ≥ 1.5 M at 3.75 s; C4c 188 frames over 1.5 M; C6/C7
     draws; B05 491–496 draws; C1 60.6 at 402.

## Then — cutscene rounds (docs/CUTSCENES-PLAN.md §8): M-A … M-F, plus CR end credits (§9)
Each round: builders → adversarial reviewer → QA (playthrough bot, perf, hero shots) → commit → push → verify live.

## Finish line
All cutscenes + credits roll; top realism items done; Medium ≥ 45 fps and < 15 s warm load; Max within budget;
playthrough bot reaches the ending on Low/Medium/Max with zero errors; release bake shipped; live on Vercel.
**Voices — the very last step, by the user's choice:** the user adds `ELEVENLABS_API_KEY` only when everything else
is final, to spend the fewest credits (free plan 10k/month; the script needs ≈ 6.5–7.5k). Before asking for it:
freeze `src/shared/voice-script.json` (all cutscene lines in, wording reviewed for performance and tags), run
`npm run voices -- --dry-run` for the exact credit estimate, then design one voice at a time (the user picks from
the previews) and speak; the hash cache never re-spends credits on unchanged lines.
