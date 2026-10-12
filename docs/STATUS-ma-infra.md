# STATUS — M-A infra + C4a + C4c (BUILD lane)

Round M-A (CUTSCENES-PLAN §8 item 1). Owner of `src/cutscenes/index.ts` + DIRECTOR_CUTSCENES registration (ruling ab).

## Log
- 2026-10-11 19:0x started (fresh attempt; no prior status). Mains power, 18 GB free disk.
- 19:0x Findings: the Director already never ticks the brain while a cutscene runs (all brain timers, incl. the lure
  window `lure.t`, run on `brain.t`, so they are paused) and calls `brain.calm()` (6 s, ≥ the 2 s deaf grace) at every
  cutscene end. I make it explicit (brain `freeze()`/`resume()`, not persisted → a save/death restores unfrozen) and add
  the §4 safety gate as a Director-side "optional cutscene request" (story command `cutscene_req`).
- ANSWER to SCENES (re their question): YES — infra owns the STORY triggers for ALL M-A mid-game cutscenes (C2b B05
  hide exit in VIGIL + gate, C4a, C4c FINALE take, C5b B12 first `b02:at_door`) in src/story/{beats,director}.ts and the
  CutsceneId union. SCENES owns the chains C6→C6b, C7→CR via host.ts POSTROLL (I won't add those elsewhere) and the
  `skipAnytime` field. Post `READY: <id> timeline` and I register in index.ts.
- 19:1x (1) freeze + gate landed:
  - `src/ai/ada-brain.ts`: `frozen`, `freeze()`, `resume(deafS)` (≥ `TUNING.grace.resumeDeafS` = 2 s), `freezable`
    (not CHASE/LOOK/INVESTIGATE/SEARCH/catch), `finaleSkipTake(pos, room, heading)` (C4c resumes at `carry`); update()
    returns the held output while frozen (t + every timer paused, lure window included); noises dropped while frozen;
    `restore()` always unfreezes. `src/ai/tuning.ts` grace.resumeDeafS = 2.
  - `src/story/beats.ts`: CutsceneId + C2b C4a C4c C5b C6b CR; command `cutscene_req {id, gate: safe|vigil|none,
    waitS}`; inputs `cutscene_go` / `cutscene_drop`; flags `cs_<id>_done` (set at start, persisted). Triggers: C2b =
    B05 first hide exit after first_hide_done with her in VIGIL (else dropped); C4a = `ada_boards_pried` in B08 (gate
    safe; on drop → `c4a_deferred`, replayed once at `b09:enter_u3` — timeline reads flag `c4a_deferred` for the
    doorway version); C4c = FINALE `take` (no gate, cutscene directly); C5b = B12 `b02:at_door` after harlan_taken.
  - `src/story/director.ts`: pending queue + `gateHolds()` (≥ 6 m, or > 2 m floor apart, or other room without LOS,
    or she is offstage; 45 s pacing between optional scenes) + 20 s drop; `brain.freeze()` at every cutscene start,
    `brain.resume()` + 6 s calm at every end; death clears pending; C4c end → `finaleSkipTake(c4cCarryEnd(pos))`.
  - `src/cutscenes/c4c-step.ts` (shared pure helper, 0.35 m step toward G_PARLOR_LURE).
  - tests/cutscene-gate.test.ts: 5 tests pass.
READY: freeze+gate
- 19:1x (2) cues landed (types.ts, host.ts, new src/render/grade.ts pure state):
  - clip cue `at` (start offset, s) + `speed: 0` holds (host passes at = cue.at + late·speed; Ada/Harlan honour it,
    arms play from 0).
  - `dof` cue `to` + `over`: smoothstep focus pull, only DOF uniforms change (same cached chain); skip lands on `to`.
  - `grade` cue `{grade: {tint, saturation, grain, vignette, fade} | null, over}` — multipliers on the gameplay look,
    eased; writers: cutscene-fx (tint/saturation × blue hour), atmosphere (grain/vignette × LOOK); `fade` composes
    with the timeline fade (host overlay). Teardown → identity.
  - `lmScale` cue `{scale, over}` → `uLmScale` (src/render/lightmap-material.ts, × every baked atlas, flash unscaled;
    one global uniform — every lightmapped shader compiles it at load, no runtime variant).
  - STATE_CUES += grade, lmScale (applied on skip). tests/cutscene-cues.test.ts (4 pass); e2e/story tests updated for the
    optional cutscenes (OPTIONAL_CUTSCENES set; story finale test ends C4c).
READY: cues
- 19:1x voice: added c4c_there (B11, trigger c4c:there) to scripts/layout/build-voices.mjs; regenerated voice-script.json — diff vs before = exactly +c4c_there (SCENES' c2b_my_dress, c6b_company intact; 51 lines).
- 19:1x C4a timeline written (src/cutscenes/c4a-door-gives.ts; deferred doorway variant via flag c4a_deferred). Next: C4c, registration, look rounds.
- 19:2x REGISTERED (ruling ab) in src/cutscenes/index.ts: C4a (c4a-door-gives.ts), C4c (c4c-remembers.ts) and SCENES'
  C2b, C5b (Director ids), C6b, CR (POSTROLL only, not Director ids); PENDING_SFX += match, sizzle, rope_creak.
  beats.ts: C6 end sets cs_C6b_done, C7 end sets cs_CR_done (SCENES' request). C4c: the locket hand-off moved to C4c's
  END (giveLocket) so the lit locket stays in hand for 4.3 s; new fx `locket_in_hand {on}` (src/game/story-runtime.ts,
  surgical: holds the locket raised for the cutscene). CutsceneContext.tier (SCENES added it first; mine removed).
  tests: cutscene-host C6 → C6b → C7 → CR chain timing updated. npm test: all pass (266+).
READY: C2b C5b C6b CR registered
- 19:2x (3) profile, code landed (measurement pending):
  - src/render/cutscene-profile.ts (pure): CUTSCENE_SCALE {low: null, medium: 0.9, max: 0.85}; held while
    CUTSCENE_SCREEN.held (no dynres); guard > 40 ms avg over 1 s → back to the gameplay (dynres) scale + Max beam off
    for the rest of that cutscene; restore at release. tests/cutscene-profile.test.ts (4 pass).
  - src/game/main.ts (PERF file, surgical, logged): onRendered drives it; `?csguard=<ms>` adds ms to every measured
    cutscene frame (QA proof the guard fires; logs `[game] cutscene frame-time guard: …`); `__game.csProfile`.
  - motionBlur wiring on Max: ALREADY DONE (C2-ESCAPE B8: bindings applyChain passes {dof, motionBlur}; fx blurAmount).
  - Max "0.667 → 0.85": Max gameplay sceneScale is already 0.85 (PERF G, dynres 0.55–1) — the raise is Medium only.
  - Medium volumetric beam in C4a: NOT built (decision): in my C4a the torch is OFF in every non-POV shot (2–11 s; the
    torch rides the camera, a floor-level lamp would light the door from the floor) and in POV a beam is invisible
    looking along it (flashlight.ts: "you see their weak back-scatter"); a Medium beam = an extra shader variant to
    prewarm for no visible payoff. L_CS_KEY: no M-A scene needs it (C4a: lightning + torch; SCENES' match_flare is an
    emissive sprite, no light) — not built (M-B/M-E when F1/C4b need it).
- 19:3x prewarm: src/render/cs-prewarm.ts registry + main.ts warm-up step 'cs-prewarm' (hangs registered hidden cutscene meshes 1.5 m before the camera for one compile+render, restores them); src/world/ma-fx.ts (SCENES file, surgical: 1 import + 1 line) registers drop / flare / mist layers. r186 verified: Renderer.compileAsync frustum-culls (_projectObject + intersectsFrustum) → objects must be in view.
- 19:4x contract change #135 logged.
- 19:4x npm test 270/270 pass; typecheck clean; assets --check ok (low 26.99/27, medium 53.91/60, max 77.28/120).
  QA: scripts/qa/playthrough.mjs (surgical) asserts C4c, C6b, CR played and logs C2b/C4a/C5b (optional: gated,
  dropped never forced) with their beat. Look/real-time scenarios: scratch/ma-infra/{look,rt,both}.mjs; dist
  scratch/dist-ma-infra. Medium look session queued behind lane A's Blender run (shot.mjs waits on Blender).
- 19:5x look r1 (Medium, scratch/ma-infra/r1): 0 console errors. C4a@1 562/1.82M, @12 661/1.94M OVER Medium budget (non-C2 cutscenes rendered the whole house: bindings CS_CULL_IDS only C2/C2c) → added C4a/C4c/C2b to CS_CULL_IDS, C4a/C4c to TORCH_CULL_IDS (bindings, surgical). Visual: @6.08 the 'woman' read as an orange-lit dress filling the frame (50 mm too tight, flash too weak); @10.08 black; @3.5 abstract; @12 good. Fix: new roaming stroke spot u3_window (src/world/lights.ts, surgical; cube faces -x/-y) = hard shadows through O_U3_E at 3.3/6.0/10.0; 35/28 mm reframes.
- 20:0x round 2 changes: C4c — film-camera fixed exposure 0.03 (ISO 800 f/4 1/48, derivation in the timeline; r1
  pumped black→white across the 0.4 s flash-frames: hem frame pure black, bell frame blown), the arms hidden in the
  flash-frames (r1: the glove + locket floated in the bell memory), the torch aimed with fx beamClamp (locket / hem /
  bell / hatch / her fist), the 76 mm take shot aimed at the locket (r1 @4.6 black). C4a — strokes via u3_window, 35/28 mm.
  Look r2 + real-time run queued (scratch/ma-infra/r2).
- 20:2x round 2 results (Medium, scratch/ma-infra/r2, 0 console errors): draws/tris now in budget everywhere (C4a max
  366 / 1.23 M at the doorway; C4c ≤ 218 / 1.14 M). C4a reads: @3.4 the door swings open on a cold stroke-lit room
  (candle-warm leaf), @6.04 the stroke-lit dress on its form at the window, @10.04 a dark silhouette against the window
  (the misread works). Weak: @6.04 the dress front is amber from L_CANDLE_LANDING at the eye-adapted e 4.4. C4c too dark
  at e 0.03 (calibrated to 0.12 for r3) and the hem camera was inside the gown flare (moved to 1.4 m).
  REAL-TIME (rt, Medium, held scale 0.9, mains, no Blender? — Blender WAS running for lane A during this run, so fps
  are indicative only): C4a 60.0 fps, 0 frames > 33 ms; C4c 56.9 fps (33 ms frames around the flash-frames 2.8–3.0);
  C2b 52.8 fps but its 85 mm floor shot 8.0–8.8 s runs at 20 fps (50 ms frames) — guard did not trip (1 s windows
  average < 40 ms); **C5b: a 39.7 s FREEZE at t = 0.13 (then 200 / 83 ms)** — staged at B08 with fx blue_hour; guard
  tripped (scale back to 0.775). SCENES: please reproduce at B12 (scratch/ma-infra/rt.mjs CS=C5b, --beat B12).
- 20:5x round 3 (Medium, mains, NO Blender — valid fps): C4a 60.0 fps, 0 frames > 33 ms at held 0.9; C4c 57.1 fps
  (33 ms frames only around the flash-frame cuts 2.8–3.0); C2b 52.4 fps BUT its floor shot 7.6–8.8 s runs at 20 fps
  (50 ms frames) and the guard tripped → stepped back to 0.75 and it STAYED at 20 fps: not resolution-bound (SCENES:
  the 85 mm floor shot of C2b has a cost that the scale does not fix — draws/tris or a CPU path there). C4c stills at
  e 0.12 still too dark (→ 0.3); hem flash-frame 85 mm = featureless satin (→ 50 mm, 1.2 m, hem edge on the boards).
- 21:0x round 3 real-time, Medium (mains, no Blender), held 0.9 vs A/B at the gameplay scale ("+base"):
  | cutscene | fps @0.9 | worst frames | fps @gameplay | note |
  |---|---|---|---|---|
  | C4a | 60.0 | none > 33 ms | – | |
  | C4c | 57.1 | 33 ms at the flash-frame cuts | – | |
  | C2 → C2c | 57.6 | 133 ms @C2 12.37 | 58.2 (367 ms @8.48, 83 @7.82) | raise costs nothing measurable |
  | C2b | 52.4 | 50 ms run 7.6–9.2 (floor shot ≈ 20 fps) | 53.1, same 50 ms run | NOT the scale: SCENES' floor shot |
  | C5b | 25.2 | **18.8 s FREEZE at t 0.13** (r2: 39.7 s), then 150/83 ms | – | reproducible, scale-independent |
  | C6b | 59.4 | 117 ms @2.78 | – | |
  READY: guard proven — `C4a+g30` (+30 ms per sample) tripped once, the scale stepped back 0.9 → 0.8 (the gameplay
  dynres scale), log line `[game] cutscene frame-time guard …`; the C5b freeze also tripped it for real.
  Ruling (ad) status: the raise itself costs nothing (A/B), but C5b's freeze and C2b's 20 fps floor shot fail "≥ 45 fps
  in every M-A cutscene" independent of scale → if they are not fixed before my gate, CUTSCENE_SCALE goes to the
  gameplay scale (null; hold + guard stay). Max not yet measured.
- 21:2x round 4, MAX real-time (mains, no Blender; gameplay dynres 0.875): C4a 60.0, C4c 54.6, C2b 57.2, C6b 58.9
  (100/83 ms @2.78–2.9), C2 → C2c 58.5 (283 ms @12.37), **C5b 15.3 fps: 39.5 s FREEZE at t 0.13** (+517 ms @0.35).
  Max draws/tris (look): C4a ≤ 366 / 1.25 M, C4c ≤ 220 / 1.19 M. Bug found: a fixed 0.85 hold LOWERED Max's 0.875
  dynres → the hold is now max(hold, gameplay) (test added).
  DECISION ruling (ad): CUTSCENE_SCALE = gameplay scale (null) on every tier — the raise measured costless but C5b's
  freeze and C2b's 20 fps floor shot fail "≥ 45 fps in every M-A cutscene" regardless of scale. The hold (no dynres
  hunting) + guard ship; the raise is CUTSCENE_SCALE_RAISED (QA `?csscale=1`), a one-line flip once C5b/C2b pass.
  TO SCENES (blocking): C5b freezes 19–39 s at t 0.13 on Medium AND Max in my staging (`--beat B08`, porch, fx blue_hour;
  scratch/ma-infra/rt.mjs CS=C5b) — a mass pipeline compile on its first camera (render-all exterior? a light/castShadow
  toggle?). Please reproduce at B12; the playthrough bot will hit it in B12.
- 21:4x round 5 (Medium): C4a reveal shots at fixed e 1.2 (6.04 stroke-lit gown at the window; 10.04 silhouette against the window — reads); hand-back now snaps the eye (r5 @12 held 1.2). C4c: the POV framed the neck stump as a flat red disc → reframed on her chest/hands below it. Playthrough gate started (scratch/ma-infra/pt.log).
- 21:5x review fixes: (a) beats.ts goBeat('B09') sets `c4a_deferred` when C4a has not played — a request still waiting
  on the gate (or re-requested at the doorway) plays the doorway variant, never "the door opens" behind a player already
  in U3 (+ test); (b) director.ts: C4c's 0.35 m step is taken only with a clear line at chest height, else she turns in
  place (finaleSkipTake without pos); (c) C4c hands back with exposure {snap:true} like C4a. Contract #135 amended
  (all surgical edits listed). Gate on the current tree: typecheck 0 errors; npm test 272/272; npm run build +
  verify-boot OK; assets --check ok.
  Known/honest: C4a @6.04 the gown's front still reads amber at e 4.5 AND 1.2 (not exposure-driven; wedding_satin
  avgAlbedo 0.55/0.52/0.44 "yellowing 0.55" + a warm fill — next round: A/B stroke-only vs lightning-only at 6.0); on
  Low the u3_window stroke does not exist (ShadowRoam needs the shadow light) — Low's reveals have the global flash
  only. Max got one look round on these scenes (r4), Medium four.
- 22:1x GATE PLAYTHROUGH (Medium, dist scratch/dist-ma-infra built 20:13 AFTER every source edit, mains, no Blender):
  18/18 assertions OK, 0 console errors, 0 exceptions, 0 deaths, ended=true (B13 → C7 → CR → title, game 523.6 s).
  Cutscenes in order: C0 C1 C2 C2c C3 **C4a (B08, full version, 256 s)** C4(hem overlay) **C4c (B11, 340 s)** C5
  **C5b (B12, 393.8 s)** C6 **C6b** C7 **CR**. C2b: dropped (she was not in VIGIL at the first hide exit after the demo —
  per spec "dropped if not in VIGIL"; DESIGN QUESTION for the lead: with a 0.5 s vigil window C2b rarely fires).
  Node builds per beat: flat 2265 B05–B09, 2277 B10–B11, **2529 at B12 (+252 during B11: C4c/C5)**, 2534 B13 — a
  mass compile in B11 (most likely C5's new mist_roll / blue-hour state — my staged C5b freezes 19–39 s on the same
  kind of first frame); the bot's wall clock shows no freeze (B11 36.9 s wall for 73 s game). SCENES/PERF: please
  prewarm whatever compiles there.
- 22:3x round 6 (MAX, final tree, scratch/ma-infra/r6): 0 console errors; draws/tris C4a ≤ 366 / 1.25 M, C4c ≤ 200 /
  1.19 M. C4a reveals read (stroke-lit gown at the window; silhouette at 10.04). Found: the hand-back still at e 1.2 a
  second later (after a film-camera cue the eye ADAPTS, and the 10.0 flash holds the meter) → the hand-back shot now has
  its own camera exposure 0.17 (the measured torch-adapted eye in that doorway), the eye takes over at 12.9 with no step.
  C4c: the reframed POV shows her bodice and the carried head low in frame (hair + one eye, per the §3 audit), her grey
  hands closing in the beam at 4.6 — but the LOCKET ITSELF does not read: the 2.39:1 bars cut the glove + locket at the
  frame bottom → C4c now plays without bars (a POV take). Not re-shot after these two last edits (queue time) — first
  thing to verify next round.
- 22:4x FINAL GATE (current tree, after the last two data edits): typecheck 0 errors · npm test 272/272 · npm run build
  + verify-boot OK · assets --check ok (low 26.99/27) · zero console errors Medium (r1–r5, pt) and Max (r4, r6) ·
  playthrough (Medium, QA_STRICT default) 18/18 → C7 → CR → title, every registered M-A cutscene fired in its beat except
  the optional C2b (dropped by its VIGIL rule). scratch/dist-ma-infra deleted (disk 18 GB free).
READY: profile (hold + guard; the raise not shipped per ruling (ad))
READY: C4a C4c timelines (registered)

## What's left (honest)
- C4c: the locket does not yet read in the POV (bars now removed — unverified); the take wants a dedicated locket insert.
- C4a @6.04: the gown's front reads amber at any exposure (warm albedo + a warm fill; A/B stroke-only vs lightning-only).
- C4a/C4c Max: 2 look rounds (r4, r6), Medium 4 (r1, r2, r3, r5) — the last two edits (C4a hand-back exposure, C4c no
  bars) are unshot.
- Medium volumetric beam in C4a and L_CS_KEY: not built (reasons above). Low: no u3_window stroke (no shadow light).
- The raise (CUTSCENE_SCALE_RAISED, `?csscale=1`) waits on C5b's first-frame freeze and C2b's 20 fps floor shot.

## Requests for the lead
1. SCENES / PERF: C5b's first frame freezes 19–39 s in a staged run (Medium AND Max); the real playthrough shows +252
   node builds during B11 (C4c/C5 → most likely C5's new mist_roll / blue-hour state) — prewarm it; then flip
   CUTSCENE_SCALE.medium to 0.9 (ruling ad) if C5b and C2b hold ≥ 45 fps.
2. SCENES: C2b's 85 mm floor shot (7.6–9.2 s) runs ≈ 20 fps at ANY scale (A/B) — a cost the resolution does not explain.
3. DESIGN: C2b needs Ada in VIGIL at the first hide exit after the demo; the bot never met it (she is still walking back)
   → C2b is dropped for most players. Wait up to N s for VIGIL instead of 0.5 s?
4. Commit (no other lane owns them): src/ai/{ada-brain,tuning}.ts, src/story/{beats,director}.ts,
   src/cutscenes/{types,host,index,c4a-door-gives,c4c-remembers,c4c-step}.ts, src/render/{grade,cutscene-profile,
   cs-prewarm,lightmap-material}.ts, surgical: src/world/{lights,cutscene-fx,atmosphere,ma-fx}.ts,
   src/cutscenes/bindings.ts, src/game/{main,story-runtime}.ts, scripts/layout/build-voices.mjs +
   src/shared/voice-script.json (c4c_there), scripts/qa/playthrough.mjs, tests/{cutscene-gate,cutscene-cues,
   cutscene-profile}.test.ts (new) + tests/{e2e-playthrough,story,cutscene-host}.test.ts, docs/CONTRACT-CHANGES.md #135.
