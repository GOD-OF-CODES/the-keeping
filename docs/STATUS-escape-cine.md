# STATUS — escape lane B-CINE (cutscene/render runtime), Phase 1

Owner: lane B-CINE. Files: src/cutscenes/**, src/world/{blood-fx,decals,lights,cutscene-fx}.ts,
src/render/{camera-fx,pipeline}.ts, src/game/main.ts warm-up, src/materials/**, K7 blood specs in
scripts/layout/materials.mjs, audio scheduling half of B12 in src/audio/engine.ts.

## Log
- 2026-10-09 start: fresh (no prior status, tree clean at d70bdf1). Reading docs/C2-ESCAPE.md rev 2.
- read §0–§2.4
- read §2.2, §3.3–3.7, §4, §5.2, §5.4, §7.1, §8, ROADMAP rulings

## API decisions for B-STORY (read me)
- CHAIN (host.ts POSTROLL, like C0→C1 PREROLL): the Director requests only 'C2'. The host plays C2 (29.0 s), then C2c
  (13.9 s) chained on the same camera, and calls the Director's done('C2', skipped) ONCE, after C2c ends (control at
  S = (1.05, 8.25, 5.75), heading −1.571, pitch −0.87 via the 'player' cue). A skip inside C2 jumps to C2c t=10.4; a
  skip inside C2c jumps to its end. 'C2c' is also in CUTSCENES (preview/tests), but the story must NOT request it
  separately. So beats.ts onCutsceneEnd('C2') = "C2c is over → B05 at the stair top".
- C2c fires a `mark` cue 'c2c:start' at t=0 and the story-state cues it needs as `fx` (see c2c-up.ts once written).
- B12 host: POSTROLL chain C2→C2c (skip→10.4), Sequencer.seek(t), sched sfx 150 ms lookahead → AudioEngine.scheduleTime(delay) (outputLatency-compensated). bindings maps delay→when.
- B7 (part 1): lights.ts — SHADOW_LIGHT_ID='L_LAMP_PARLOR' (fallback L_CANDLE_TABLE on an old layout); the lamp is built as a FlickerLight even in mode runtime, flagged direct (full diffuse share, 2 % 6–9 Hz flicker, 12.0 cd); in the light lists of G1/G2/U1 atlases (SHADOW_ROAM_ROOMS) so it can roam; RuntimeLights.shadow/shadowId; 'roaming' flag skips the flicker loop. main.ts warm-up uses level.lights.shadow. bindings castShadow no longer x4.5 for the lamp.
- B7 (part 2): ShadowRoam in lights.ts (ROAM_SPOTS fanlight (1.6,−1.5,4.4) / u1_window (2.1,−1.4,5.6); 1100 cd 8000 K,
  distance 9; pulses 'v@t[:tau]', 30 ms rise, τ 60 ms / tail τ 180 ms; cube redrawn at each onset). cutscene-fx:
  `fx shadowLight {at:'lamp'|'off'|'fanlight'|'u1_window', pulses}`; C5 silhouette now moves the lamp (K3). resetRoam().
- B8 plumbing: pipeline setBlurAmount(v)/blurAvailable, `motionBlur: 0` = variant live w/o blur; host `fx blurAmount {v}`
  → deps.render.blur (first call switches the cached chain, then uniform only; teardown → null); ctx.motionBlur in
  CutsceneContext. Medium keeps cutsceneMotionBlur=false until measured on mains (≤ 0.8 ms rule).
- B1 exposure: EXPOSURE_CUE.spot {x,y,r,w} (exposure.ts meter blends a screen-circle log mean); `fx exposure {spotX,
  spotY, spotR, spotW, min, max}` via opening.ts exposure fx.
- B1: c2-room.ts rewritten per §2.1 (29.0 s, shots S1–S11 with the yaw rule ≤49° from D / ≤42° from T, rigid 7.30–8.60, kicks for flinch + heartbeat jolts, sched sfx for chop/head_drop/spurts/slam, blood fx start/end, adaHead fx sever/nudge/held/eye_open, attach harlan ada_head prop_l at 10.6, lamp shadow, spot exposure, blur 1.0 at 7.42–7.58 and 0.8 on the whip). stage.ts: C2E_D/T, NECK, LAMP_FLAME, HARLAN_C2, HEAD_LAND/REST, STAIR_TOP_EYE, ST_MAIN, lens(); SPAWN.CP2 → K4. Sequencer: CameraShot.bob + Timeline.kicks. bindings: SFX_STANDIN for NEW sound ids (silent if no recipe).
- B2: c2c-up.ts NEW (13.9 s; whip 650 ms w/ blur else 850 ms; riser-locked bob; fanlight stroke 3.62 + glance #1 3.84–4.47; stumble 6.46 + glance #2 6.85–7.45 on the hand at the rail; top 9.0; Ada hidden + to G_PARLOR_LURE at 10.4; U1 window stroke 12.9; FOV eases to the gameplay FOV 13.4–13.9; 'player' cue at S). Registered as CUTSCENES.C2c; PENDING_CLIPS lists the A4–A6 clips.
- tests: cutscene-host hold-to-skip updated for the chain (skip → C2c 10.4); cutscene.test sfx check accepts PENDING_SFX (index.ts). 'B04 death replays C2_replay' fails because B-STORY retired C2_replay (their lane, K8).
- tests/c2-escape-stage.test.ts NEW (7 pass): layout constants (lamp 12 cd, parlor_lean, CP2, ST_MAIN), the flame-out-of-frame
  rule from D (16:9), the rigid strike frame, C2→C2c camera seam + handover at S with gameplay FOV, the chain (done once,
  after C2c), skip → C2c 10.4 → S, sched-sfx lookahead maths.
- Lane A request (Harlan front-lit from D): C2 halves L_CANDLE_TABLE's runtime light 0–17.9 (bake unchanged). The
  shadow of the raised cleaver lands where the physics puts it (east wall/ceiling from the NW lamp) — accepted; no fake.

## REQUESTS to B-STORY (severed Ada / head node, B3) — what C2/C2c drive
- `fx adaHead {mode}` cues (C2): 'sever' 7.60 · 'nudge' 9.45 · 'held' 10.6 · 'eye_open' 13.6. B-CINE's head puppet
  (cutscene-fx) wants from CharacterBank: `ada.sever(on: boolean)` (hide the body's head/neck above the cut, show the
  stump cap; head node shown) and `ada.headNode(): Object3D | null` (the ada_head node, world-space when unattached).
  While unattached during C2 7.60–10.6 B-CINE moves it in world space (fall to HEAD_LAND by 7.90, nudge roll to
  HEAD_REST by 10.1). 'held' = after `attach harlan ada_head prop_l` (your pendulum). 'eye_open' → your eyelid morph.
  Until these exist the cues are no-ops (Ada stays whole: the strike reads only from the blood).
- B4/B5 plan: pure maths in src/world/blood-math.ts (NEW: ballistic w/ linear drag, seeded C2 set, 240 Hz termination vs stage proxies, stain/pool sizing) + three side in src/world/blood-fx.ts (NEW: instanced capsules in TSL, stains multiply+spec batches, pools, prints, drip). Stains live in blood-fx.ts, not decals.ts (decals.ts is the handwriting system).
- blood-math.ts done: Medium 410 particles / 40 stains, pulse 1 lands x 4.28–4.72 from 7.98 (§3.3 says 4.18 at 7.98 for a level jet; ours leaves 4° down). τ matched to quadratic drag at launch speed.
- B4/B5 first version: src/world/blood-fx.ts (2 draws: instanced capsules w/ TSL linear-drag ballistic + analytic
  key-light/torch shading + the HG back-lit term; instanced stains/pools/prints on a 512² procedural atlas, meniscus
  normal, clotting roughness). Wired into cutscene-fx as `fx blood {seq, phase}`; head puppet `fx adaHead` (fall to
  HEAD_LAND by 7.90, nudge roll to HEAD_REST) drives ada.headNode() when B-STORY provides it. Not yet seen on screen.
- B11: main.ts tableau warm step also renders the C2 chains (DOF; DOF+MB(0) and MB-only on tiers with the blur variant). Blood meshes are visible during load (fx setWarm) at a mid-jet clock.
- r1 look (Medium, AC, 0 console errors): the player's torch was ON through C2 → a co-located 2000 cd key (hot spot on the sheet at 7.62, a lit floor at 9.9). Fix: torch off in C2, on at C2c 0 (+click). Ada still whole (no split API yet) — the strike can't be judged until B-STORY/A land the head node. Spatter streaks visible (red dotted lines).
- K7: blood_wet / blood_dried in scripts/layout/materials.mjs (family 'rubber', source 'constant': no generated maps; params muA, muA_pool, g, f0, albedoJet), steel_cleaver.params.bloodMask; spec regenerated (96); materials-library test count 94→96.
- CP2/S moved to x 0.55 (B-STORY's C6 READY: centreline frames the flight); CONTRACT-CHANGES #91–93 logged. C2c topB (0.75, 8.45).
- B6: src/materials/blood.ts NEW — bloodMask (splash capillary front + hashed spatter cells + gravity runs, object
  space, NO samplers), bloodOver (film vs soaked cotton, clotting roughness), BLOOD_UNIFORMS {amount, ageMin} driven by
  blood-fx from contact. READY: applyBlood(material, {source, radius, reach, cell, run, thick}) (src/materials/blood.ts)
  — REQUEST B-STORY: apply on Harlan's apron (source ≈ his lower chest facing the neck, radius 0.25, thick 1),
  right glove + cuff (thick 1), the cleaver blade (thick 1, radius 0.08 from the edge) and Ada's gown collar/front
  (source at the stump, radius 0.35, run 0.4, thick 0.4) — on their node materials, it adds no samplers.
- Advisor fixes: (1) the lamp's shadow is never muted (a 12 cd full direct light would leak into G1 through WG_G1G2):
  setCandleShadow on an `alwaysShadow` light only freezes the map; policy redraw 10 Hz while the parlor is seen,
  every frame in C2 (cast_shadow cue); roam 'off' zeroes intensity + uShadowOn. (2) C2c end → shadowLight 'lamp'.
  (3) placePlayer exposure snap only when the eye actually moves > 0.3 m (no pop at the C2c handover). (4) ShadowRoam
  runs on the sim dt. C5 silhouette restores the frozen-map state. DIRECTOR_CUTSCENES +C2c −C2_replay.
- npm test 251/251 pass; typecheck clean (2026-10-09, after B-STORY's AI edits landed).
- NOT DONE / honest: particles don't write MRT velocity (no blood motion blur on Max); Medium blur unmeasured →
  Medium runs the 850 ms whip + no blur; torch OFF for all of C2 (doc S11 wanted a low-held bounce) — revisit at pair 5;
  every C2 lighting frame is PROVISIONAL until A10 (Harlan/Ada still see the old baked candles + probe grid).
- r2 look (Medium, AC, 0 errors; frames scratch/cine/r2-01-c2-2.4.jpg, r2-02-c2-8.45.jpg): the lamp's real shadows
  work (the rocker + spindles thrown up the east wall, hard). Problems, worst first: Ada is a white plaster mannequin
  (#17, lane A); Harlan front-lit flannel (bake/probes provisional, A10); the room metered to day (spot on the black
  sheet → max 8) → exposure now spot 0.4 / max 2.2; a broad glossy hot spot on the hanging rubber sheet 0.7 m from the
  lamp (props material — report to A); the pulse-2 jet reads as a thin red line (4 px at 2.7 m: physically right).
- Integrated B-STORY READY: synth ids (cleaver_sever scheduled at contact − SEVER_CONTACT_S 0.11 s), mark 'c2:strike' at 7.56 (their host/bindings mark hook).
- tests: blood maths (drag, pulse-1 landing 0.95–1.2 m west at 7.9–8.05 s, tier caps, determinism, pool r) — 8/8.
- r3 look (C2c 4.0 / 12.6, Medium, AC, 0 errors): the empty stair from S (x 0.55) frames well (torch pool on the middle treads); NO prints visible; atlas rows were flipped (CanvasTexture flipY) → fixed; meshes now on the scene. Glance #1: the camera-mounted torch blew out on her → torch dark 3.66–4.5 (beam arm stays forward). Hall prints sparkled like blue LEDs in the stroke → bead tilt 0.6→0.25. 'Go on, then.' subtitle still on screen at C2c 4.0 (voice lane?).
- B-STORY requests done: mark 'c2:strike' at 7.56; C2_replay removed (index, host SEEN_ALIAS, c2-room, preview → C2c; cutscene.test asserts retired). npm test 252/252.
- r4 look (C2c 4.0 / 12.6, Medium, AC, 0 errors): lane A's split Ada is IN — glance #1 shows the HEADLESS body at the
  newel with the stump ring; the fanlight stroke rims the balusters cold. Problems: no lightning patch on the hall
  floor (the glazed fanlight was an opaque shadow caster → glass/chimney panes no longer cast: ShadowRoam init); her
  front still reads (probe light + dark-adapted eye; the patch should pull the meter down); prints rendered as pink /
  white painted marks (r4-02) → print opacity 0.55→0.38, rough 0.22, output capped; torch pool missing at 12.6 after
  the off/on toggle (debug values added to the blood debug: keyI/torchI). The 'Go on, then.' subtitle hangs to C2c 4.
- r5 (C2c, AC): blood debug shows torchI 2024 cd at 12.6 yet the treads are NOT torch-lit (prints lit by my analytic torch → pink) after the 3.66/4.5 off/on toggle (r3 without the toggle had the pool). Replaced the toggle with fx torchHold (FlashlightRig.hold: the rig keeps its world orientation — the beam stays up the flight while the head turns back; small surgical edit in src/player/flashlight-rig.ts).
- r6 (C2c, AC, 0 errors): THE FANLIGHT STROKE NOW WORKS — the sunburst muntins are projected on the hall floor behind
  her (real shadow through the real opening, glass no longer an opaque caster). Problems: the torch still lit her
  (bindings snap() the rig every cutscene frame → torchHold ignored → fixed in the rig); her gown = white mannequin,
  the stump a lit pink disc (torch); prints = pink stickers (albedo 0.03 under 165 lx) → near-black wet film; at 12.6
  the treads are still NOT torch-lit although the light is at 2015 cd → probing the casters near the torch (tp run).
- arms settle to arms_breath_hold at C2c 9.0 (the run pose to the top).
- r7 (C2c, AC, 0 errors; scratch/cine/r7-01-c2c-4.0.jpg, r7-02-c2c-12.6.jpg): glance #1 now reads — the fanlight's
  sunburst shadow on the hall floor behind the HEADLESS body at the newel, balusters rimmed cold, the torch held up the
  flight (torchHold works). Her front still reads beige (probe light + dark-adapted eye; design wants ≤ 0.5 lx black —
  provisional on A10 / #17). 12.6: the torch pool is back (arms settle at the top) — the run pose (arms_run_torch)
  is suspect for the earlier unlit treads (report to A/B-STORY); prints now dark wet feet but inside dark SQUARES
  (cell-border leak) → quad-edge fade + coverage floor.
- r8 (C2 9.9 / 24.0, Medium, AC, 0 errors): the SEVERED HEAD lies on the floor in profile, hair down, lamp-lit from the
  NW with a hard shadow (my head puppet + B-STORY's head node + lane A's split) — the core beat now exists. Harsh list:
  the cut caps (head + stump) read as flat salmon/red DISCS (A2 anatomy not in yet); the gown is a white mannequin
  (#17); the pool is a flat matte red-brown ellipse (→ lobed pool cell + seam wicking; still no environment sheen);
  the floor is bright orange all over (old bake fill — provisional on A10); from T the door rope stood as a pillar in
  S10 → S10/S11 start in the reveal (3.62, 1.33). Subtitles linger in QA frames only (DOM timers vs fast-advanced sim).
- GATE started 21:26: typecheck ✓, npm test 252/252 ✓, npm run build ✓ (verify-boot OK); playthrough Medium on scratch/cine/dist (log scratch/cine/pt.log).

## Where B-CINE stands (Phase 1) — item by item
- B1 C2 rewrite: DONE (timeline per §2.1, stage constants tested; exposure cue {spot, clamp}; insert as hard cuts;
  flinch kick only at head_drop). Looks: r1, r2, r8 (provisional: A10 bake, #17, A2 caps).
- B2 C2c + chain: DONE (POSTROLL chain, skip → 10.4, riser-locked POV, two glances, stumble on 12, the slow turn, the
  empty stair, control on the exact last camera at S (0.55, 8.25, 5.75) with the gameplay FOV). Looks r3–r7.
- B4 blood FX: DONE first version (analytic drag TSL, CPU terminations, back-lit HG term, tiers 100/620/1450).
  Not done: MRT velocity for the particles (no blood motion blur on Max).
- B5 decals/pools: DONE first version (stain atlas, ≤ 2 draws, pools growing by volume, clotting roughness, prints,
  tread-11 puddle + drip + crowns). Pools still read flat-matte (no environment sheen) — next round.
- B6: DONE as an API (src/materials/blood.ts applyBlood, no samplers) + K7 specs; APPLYING it to Harlan/cleaver/gown is
  B-STORY's (characters lane) — requested.
- B7 lamp + roaming light: DONE (the lamp is the session shadow light, never muted; fanlight + U1 window strokes;
  glass no longer an opaque caster). Not measured yet: the > 1.0 ms fallback trigger on Medium (mains).
- B8 camera + blur: DONE plumbing (variant switched once, amount uniform; kicks; bob). Medium blur unmeasured →
  Medium runs the 850 ms whip without blur.
- B11 warm-up: DONE (C2 chains prewarmed in the tableau step; blood meshes compiled at load).
- B12 scheduled audio: DONE (sched flag, 150 ms lookahead, AudioEngine.scheduleTime with outputLatency + 1 frame;
  cleaver_sever at contact − SEVER_CONTACT_S). The A/V offset log (c2e-hero, lane C) not run.
- GATE PASS (Medium, WebGPU, AC power, dist scratch/cine/dist built from the current tree): playthrough reached C7 →
  title (ended B13, game 451 s, deaths 0), 15/15 assertions incl. no input in C2/C2c, control at CP2 (0.55, 8.25),
  her return first seen +11.47 s, no death B03–B05; 0 console errors, 0 exceptions. B04 (C2c) lasted 13.9 s.
  Report scratch/cine/qa/pt-report.json, frames scratch/cine/qa/pt-0*.jpg.

## Not looked at yet (§8.2) — honest list
- Looked (Medium, WebGPU, 1280×800): C2 2.4, 7.62, 8.45, 9.9, 24.0; C2c 4.0, 12.6. NOT looked: pair 1/2 strike frames
  with the split head in (7.50 / 7.62 since lane A's split landed), pair 3 ★ 13.9 eye insert, pair 4 (16.0, 18.6 flame),
  pair 5 27.8, pair 6 C2c 0.33 whip, pair 7 (6.62 stumble gloves, 7.1 glance #2), pair 8 13.9 handover, pair 9 B05
  gameplay; no ★ 1080p frames, no Low / Max looks, no WebGL2 check. The climb (2.1–9.0) has no frame: the
  arms_run_torch pose may still leave the treads unlit by the torch (unexplained; worked around only at the top).
  The prints' dark-square fix (quad-edge fade) is unverified on screen (added after r7, before the gate build).
- Skip edge: a player who saw the OLD C2 (localStorage has 'C2', not 'C2c') can skip C2 → lands in C2c 10.4, then
  the last 3.5 s are unskippable (C2c not yet seen). Acceptable.

## Requests for the lead
1. Confirm CONTRACT-CHANGES #91 (CP2 / S x 0.55, the flight centreline; B-STORY's C6 evidence).
2. The Medium motion-blur decision (B8): unmeasured — Medium runs the 850 ms whip, no blur, until a mains measurement
   says MotionBlur + velocity ≤ 0.8 ms at C2 7.5 / C2c 0.3.
3. Torch OFF for all of C2 (deviation from S11's low-held bounce): it was a 2000 cd co-located second key that blew
   the sheet out and flattened the one-lamp look (r1). Keep, or re-light S11 only?
4. B7 cost verdict: the lamp is now an always-shadowed 12 cd light in the G1/G2/U1 light lists (muting it leaked through
   WG_G1G2); its map redraws at 10 Hz while the parlor is seen. Perf numbers below; > 1.0 ms → the approved fallback.
5. Lane A: the cut caps (head + stump) render as flat salmon/red discs (A2); the gown is still a white mannequin
   (#17/A11 not in the GLB I saw); the hanging rubber sheet has a broad glossy hot spot 0.7 m from the lamp.
6. Lane B-STORY: apply src/materials/blood.ts applyBlood() to Harlan's apron/glove, the cleaver and the gown (READY).
- PERF (Medium, WebGPU, AC 95 %, gated dist, gpuFrameMs over 30 frames = 0.5 s windows): C2 7.2–7.7 54.7 ms (!),
  C2 13.9–14.4 24.1 ms, C2c 3.8–4.3 10.0 ms, C2c 12.4–12.9 10.6 ms (draw/tri counts from renderer.info were
  cumulative → discarded). C2 is far over budget (≥ 45 fps = ≤ 22 ms); C2c is fine. Cause (most likely): the lamp's
  cube map redrawn every frame at 7 m in C2 (+13 ms vs the doc's 10.5–10.9 ms parlor baseline); the 7.2 window also
  holds the strike's first particle frames. → B7 approved fallback applied AFTER the gate: distance 4.5 m, map at
  30 Hz in C2/C5 and 10 Hz otherwise (never autoUpdate). Re-measuring + re-gating.
- PERF after the B7 fallback (Medium, AC, same windows): C2 6.4 20.8 ms · 7.2 21.5 ms (was 54.7) · 13.9 20.2 ms (was 24.1) · C2c 12.4 10.8 ms. C2 now ≈ 47–49 fps: inside the ≥ 45 floor, short of the 60 target (+9 ms over the doc's parlor baseline; next: the 30 Hz cube redraw, DOF). Re-gating.
- RE-GATE PASS on the final tree (B7 fallback in): typecheck ✓, npm test 252/252 ✓, npm run build ✓ (verify-boot OK),
  playthrough Medium WebGPU (AC) on scratch/cine/dist: ended B13 → title, deaths 0, all assertions ok (no input in
  C2/C2c, control at CP2 (0.55, 8.25), return first seen +11.47 s, no death B03–B05), 0 console errors, 0 exceptions.
  Report scratch/cine/qa/pt2-report.json.

## Review — art/horror director, escape Phase 1 (2026-10-09, reviewer agent)
- r1: Medium hero frames (scripts/qa/c2e-hero.mjs, all §8.2 marks) → scratch/esc-review/r1med-*.jpg, dist scratch/dist-esc-review. Power: AC.
- r1 pair 1 (Medium): C2 2.4 — Harlan front-lit and flat (not a rim silhouette), his raised forearm crosses the sack-head; Ada = white cloth mannequin under a sheet. C2 7.62 — the strike is NOT readable in one still: no visible separation, the head reads as a dark hair blob, blood = a few sub-pixel red dots; the gown is a cream plaster lump. (Not a bug: "(a choked cry)" types in — but a caption landing on the rigid strike frame competes with the money shot; consider delaying it to 8.6.)
- r1 pair 2/3 (Medium): C2 8.45 — no readable pulse/jet from the stump; the stump is hidden behind the cream gown lump. C2 9.9 — the head reads as a hair ball with a flat lit salmon disc (cut face) — a toy, not a head (no ear/jaw profile visible); the pool is a flat opaque red ellipse with a hard rim, 0.2 m away from the head (the head is not lying in its own blood); jagged stair-stepped shadow edge on the floor under the table hem.
- r1 pair 3/5 (Medium): C2 13.9 eye insert FAILS — the frame shows the back of the hair veil at 1 m, no eye, wall in focus. C2 24.0 — the risen body is a white plaster torso; the neck cap is a flat red disc with a white cross (vertebra) reading like a target sticker = mannequin (R6 fail).
- r1 pair 6/7 (Medium): C2c 4.0 — the fanlight sunburst on the hall floor is the best image of the sequence; but the figure is a cream-lit torso seen from above with a dark lump at the neck: headless does NOT read in one still; balusters carry bright white specular outlines (neon look). C2c 7.1 glance #2 FAILS — near-black frame, two balusters + a far candle; no hand on the rail, no Ada visible.
- r1 C2c 6.62 stumble: frame is BLACK (no gloves, no torch spill) — the torch is dark on the whole climb, so the user's "she follows you up the stairs" cannot be seen. Diagnosing (top priority).
- r1 C2c 12.6 empty stair: composition good (whole flight in the torch, dark landing beyond) — but the wet prints render as opaque SQUARE stickers (brown quad + a pink foot image), the old "dark squares" bug is NOT fixed; baluster edges shimmer white. B05 near (1.5 m): headless reads, but the gown blows out to a flat white sack and the cap is a pink disc = mannequin.
- r1 DIAG (scratch/esc-review/diag-torch.mjs): the torch is ON (≈2000 cd) all through C2c; the black climb is EXPOSURE: 5.28 at C2c 0.5 → 0.298 at 2.0 → pinned at the 0.25 floor 5.6–7.1 → 0.54 at 9.5 → 14.8 at 12.6 (after the arms switch to arms_breath_hold at 9.0). Something in the meter is very bright while arms_run_torch plays.
- r1 FIX (pending verify): src/characters/head-carry.ts `faceAt` + cutscene-fx adaHead 'held' sets it to the camera (Harlan shows you the face from the lift on; the eye insert can see the eye). src/characters/skin.ts: skin_ada cut tissue (atlas r/g > 1.55–2.1) gets a blood film — albedo ×(0.55, 0.22, 0.22), roughness → 0.1 — instead of a matte salmon disc.
- r1 FIX (pending verify): src/render/exposure.ts METER_CROP + cutscenes/bindings.ts overlay(): the meter ignores the rows under the cinema bars (a film gate meters what it sees). Hypothesis: the torch lens glow under the bottom bar in arms_run_torch pins the climb's exposure at the floor.
- r2 (scratch/esc-review/r2med-*): with the meter crop the climb exposure is 1.0–1.27 (was pinned 0.25) — but the frames are still near-dark: ROOT CAUSE found — FpArms.update() aims the SpotLight along the animated `flashlight_beam` bone, and arms_run_torch points it off the flight. FIX src/characters/arms.ts: the beam is clamped to a 20° cone around the gaze (rig −Z). The crop also brightened C2 (9.9 washed orange) — testing r3 with the crop OFF.
- r2 eye insert: still wallpaper + hair. FIX: c2-room.ts D_EYE aimed at the measured image-left eye (5.285, 3.544, 2.45), DOF focus 2.79; ada.ts: while the head is held up by the hair (faceAt set) the hair chains pull toward the grip (gravity −40, stiffness 0.02) so the veil parts.
- r3 (scratch/esc-review/r3med-*, crop OFF + beam clamp 20°): climb exposure 2.17 / 1.42 / 1.56 at C2c 4.0 / 6.62 / 7.1 (was 0.25) — the beam clamp alone fixes the black climb; the meter-crop experiment is REMOVED (it re-tuned C2 brighter). Glance #2 now lit, but the beam sat 20° left on the wall (blown) with her hand dark at right → clamp tightened to 12°. Eye insert now centred on the head (hair-up variant revealed an unlit face = silhouette; replaced by: face 3/4 toward the lamp + only the strand over the eye parted).
- r4 (scratch/esc-review/r4med-*, clamp 12°): glance #2 (C2c 7.1) now SHOWS her grey hand gripping the rail in the torch spill (the subject reads); the near wall/balusters left of the beam are blown (the eye can't adapt in a 600 ms glance — accepted). Climb exposure 2.17/1.40/1.54 at 4.0/6.62/7.1. C2 9.9 and 24.0 are brighter than r1 — other lanes changed render/world files between r1 and r2 (reflections, flashlight, level, pipeline 22:31–22:42), not this review's edits (the meter-crop experiment is gone). Cut caps now a darker wet red but still read as flat discs (asset: no relief at 120–150 px). Eye insert: head centred, but the face is still a dark silhouette behind the hair — not a working eye shot yet.
- Prints A/B: hiding the blood-stains mesh for 1 frame left the dark squares (TAA history?) — inconclusive.
- Max TSL `vec3()` error: a `?tslstack` (THREE.Node.captureStackTrace) Max load stalled > 300 s in shader compile (stack capture per node is too slow) — no trace; left to B-CINE (as reported by B-STORY).

### Review verdict (Medium, WebGPU; Max pending below)
**Not photoreal yet, and the user's first sentence ("the beheading … visible clearly … really horrifying") is NOT met.**
The strike does not read in one still (C2 7.62/8.45): the gown is a cream lump hiding the stump, the jets are a few
sub-pixel dots, the head is a dark hair ball against the dark sheet. The stair half now works as a sequence: the
climb is lit (it was black), glance #2 shows her grey hand on the rail, the empty stair is the best frame, the
handover is on the exact last camera. Glance #1 does not read as headless. The eye insert is a centred silhouette,
not a working first version. Ada is a mannequin in every lamp/torch-lit frame (gown blown to plaster, flat cut discs).

Fixed here (CONTRACT-CHANGES #97–#101): C2c beam clamp (`fx beamClamp`, arms.ts BEAM_CLAMP), head `faceAt` 3/4 to
the lamp, S6 aim on the measured eye + strand part, skin_ada wet cut-tissue film, `?tslstack` debug flag.

### Phase 2 — ranked
1. **The strike readable in one still** (B-CINE + A): stump in profile against the lamp at 7.62, a visible 3–5 cm gap
   on the contact frame, jets as ≥ 3–4 px streaks with motion blur on Medium, pulse 2 at 8.45 framed clear of the gown.
2. **Ada not a mannequin** (A11 + B13 + B-CINE): wet-cotton atlas with folds/normal detail, skin show-through; C2's
   exposure cue must let the meter protect the lamp-lit gown (today min 0.5 disables the highlight cap).
3. **Cut faces** (A2): 512 px cap texels with real relief, blood film over the vertebra (the white cross reads as a
   sticker), wet runtime film already on.
4. **Glance #1 headless silhouette** (B-CINE): re-block her between the tread-5 eye and the fanlight patch.
5. **Eye insert** (A3/B3): key light on the lamp side, cornea glint, a real 2 cm veil gap — or cut the insert.
6. **Blood pools / prints** (B5): pool env reflection + shadow; prints are dark squares (suspect atlas mip bleed:
   test `generateMipmaps = false`).
7. **Head on the floor** (B-CINE): ear/jaw profile up, lying in its own pool.
8. **arms_run_torch beam bone** (A): re-aim, then drop the C2c clamp (#97).
9. Max TSL `vec3()` console error in the motion-blur warm (B-CINE) — blocks the Max gate.
- GATE (current tree, dist scratch/dist-esc-review, Medium WebGPU, on AC): playthrough ended=true at B13 → title, 15/15 assertions, deaths 0, console errors 0, exceptions 0, no input in C2/C2c (csInput []), handover at CP2 (0.55, 8.25), her return first seen +11.47 s, report stalls [] (scratch/esc-review/gate-report.json). npm test 252/252, typecheck clean, npm run build OK (boot 12.5 KB gz).
- r5 MAX (scratch/esc-review/r5max-*, c2e-hero): **CRITICAL — on Max the whole of C2 never renders**: every C2 frame (7.62/9.9/13.9/24.0) is the stale gameplay frame of the drive from before C2 (only exposure/letterbox change), with the 4 TSL `vec3()` console errors. C2c (blur-only chain) and B05 render fine. FIX (surgical, render/pipeline.ts build()): DOF wins where DOF + motion blur are both asked (C2) — the broken dof+mb chain is never built. Verifying (r6max).
- r6 MAX (scratch/esc-review/r6max-*): C2 renders on Max now (7.62 strike with the 1450-particle spray, 9.9 head on the floor), **console errors 0** (was 4). Max look verdict = Medium's (mannequin gown, flat cap discs, flat pool); the spray reads better than Medium's.
- FINAL GATE (tree incl. the pipeline fix; dist scratch/dist-esc-review built by r6max; Medium WebGPU, AC power): playthrough ended=true B13 → title, 15/15 assertions, deaths 0, console errors 0, exceptions 0, csInput [] (no input in C2/C2c), handover CP2 (0.55, 8.25), report stalls [] (scratch/esc-review/gate2-report.json). npm test 252/252, typecheck clean, npm run build OK. Max hero session: console errors 0.
- NOT DONE in this review: real-time pacing / A/V offset / >50 ms hitch run (all runs were simulated time; A/V −3.9 ms is B-STORY's number, not re-measured); Low tier looks; fps measurements; the prints mip-bleed A/B (r4's 1-frame A/B inconclusive; 30-frame variant written in scratch/esc-review/r2.mjs STAINAB=1 but not run).
