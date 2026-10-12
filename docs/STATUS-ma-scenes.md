# STATUS — M-A SCENES (BUILD — SCENES lane)

Round M-A (2026-10-11). Scope: CR end credits, C2b "Her Door", C5b "Rocking", C6b "Bait", C5/C6/C7 upgrades.
Rulings (aa)–(ah) apply. Infra agent registers timelines (ruling ab) — I post `READY: <id> timeline` here.

## Log
- 19:2x start (fresh, no prior status). Read CUTSCENES-PLAN §2/§3/§4/§5/§6/§9.
- Plan: chains via host.ts POSTROLL (CINE-owned file, surgical): `C6 → C6b` and `C7 → CR`, so the story's C6 end
  (→ C7) and C7 end (→ game_over/end card) fire only after the chained scene — no story change for chains. CR gets a
  new timeline field `skipAnytime` (types.ts + host.canSkip). DOM roll: a new `credits` overlay in bindings.ts
  (CINE file; TitleCards lives in src/ui = lane C, so the roll is self-contained in bindings, system serif).
- QUESTION for infra (STATUS-ma-infra.md): do you own the STORY triggers for C2b (B05 hide exit while VIGIL, safety
  gate) and C5b (B12 first b02:at_door)? If not, I'll add them surgically in src/story/beats.ts once your
  freeze/safety-gate ops exist. Please don't add a C6→C6b / C7→CR chain elsewhere (I do it in POSTROLL).
- voice: added c2b_my_dress (c2b:vigil) + c6b_company (c6b:company) to scripts/layout/build-voices.mjs, regenerated voice-script.json (ruling ac).
- 19:4x CR built: `src/cutscenes/cr-credits.ts` (24 s, roll 2.2→19.2 s, "Made from scratch." at 20.1 + distant clean
  bell, picture fade 1→0.6→1, Low black). Surgical CINE edits: types.ts (`CardStyle 'roll'`, `Timeline.skipAnytime`,
  `CutsceneContext.tier`), host.ts (POSTROLL `C6→C6b`, `C7→CR`, inert until registered; canSkip honours skipAnytime),
  bindings.ts (roll element + setRoll, ctx.presetId → context tier). Typecheck clean.
- NOTE: npm test currently has 6 e2e failures from infra's in-progress Director requests (C4a/C4c/C5b in the main
  list) — not from my edits.
- READY: CR timeline (export `crCredits` from ./cr-credits.ts, id 'CR'; NOT a Director id — reached by POSTROLL C7→CR).
  Request to infra (owns src/story): in beats.ts `case 'C7':` add `this.setFlag('cs_CR_done')` (CR always ran/skipped
  before C7's done fires).
- 19:5x timelines authored (typecheck clean): `c2b-door.ts` (c2bDoor, 11 s), `c5b-rocking.ts` (c5bRocking, 14 s),
  `c6b-bait.ts` (c6bBait, 13 s; uses infra's clip `at` + speed 0 holds). sfx stand-ins in bindings SFX_STANDIN:
  match→knob_click, sizzle→gutter, rope_creak→apron_creak (lane C: please synthesise `match`, `sizzle`, `rope_creak`).
- READY: C2b timeline (export `c2bDoor` from ./c2b-door.ts, id 'C2b', Director id)
- READY: C5b timeline (export `c5bRocking` from ./c5b-rocking.ts, id 'C5b', Director id)
- READY: C6b timeline (export `c6bBait` from ./c6b-bait.ts, id 'C6b'; reached by POSTROLL C6→C6b — the Director must
  NOT request it separately). Infra: please also add 'match', 'sizzle', 'rope_creak' to PENDING_SFX when registering.
- 20:2x upgrades authored (typecheck clean):
  - C5 (33 → 33.8 s): clean bell (`spring_bell` rate 1.1 at 24.0); 0.8 s cleat insert at 25.6 (ada_finale `at` 8.9,
    60 mm, fade opens for it; everything after shifts +0.8); `mist_roll` fx on at the front door 27.4, off at 33.0.
    Judge marks 17.6 / 20.6 (shadow-play) unchanged. South-window volumetric shaft: NOT done (see remaining).
  - C6 (28.5 → 32.5 s): 4 s insert at 8.4 (dash clock 6:10 close-up 24°, then the ticket laid on the dash 40°;
    `dash` fx `clock` param drawn as a VFD readout in the cluster canvas; `dash_ticket` fx clones P_TICKET onto the
    car interior); key gate 9.0 → 13.0, everything after +4; L_CANDLE_SILL set 1 (mirror continuity); ticket/clock
    off at the end.
  - C7 (34 → 35 s): 1.0 s cleat insert at 15.8 (grey fingers let the rope run, ada_finale `at` 8.9 speed 0.35);
    everything after +1.0 — the sting marks the judge used (22.0 / 24.6) are now 23.0 / 25.6.
  - new fx module `src/world/ma-fx.ts` (drops, mist_roll, match_flare, dash_ticket), hooked from cutscene-fx.ts by
    3 one-line edits (import, `default: return ma.fx(id,p) || opening.fx(id,p)`, `ma.update(dt, d.camera)` in update)
    plus the dash `clock` param in drawCluster.
- Waiting for infra to register C2b/C5b/C6b/CR to shoot (look scenario ready: scratch/ma-scenes/look.mjs).
- 20:4x npm test 266 pass / 0 fail with the C5/C6/C7 upgrades + POSTROLL (chains inert until registration).
- 20:5x infra registered C2b/C5b/C6b/CR. dist scratch/dist-ma-scenes built; look round 1 (Medium, mains, no Blender) queued for the Chrome lock.
- 21:1x look round 1 (Medium): 0 console errors. Problems: exterior cameras render-all (CR 627 d, C5b crane 1045 d / 2.24 M, C5b tele 524, C6b wide 618) → CS_CULL_EXT_IDS (bindings, surgical) keeps the gameplay exterior PVS for C5b/C6b/CR; Ada missing from every hand insert → measured bone offsets (probe.mjs) + rootForReach in stage.ts; drop read as a black dot (shading inverted to a lens, eave lip re-aimed); CR roll ran on wall clock → game-clock tickRoll; CR showed no house → re-framed across the road + two far lightning strokes. Round 2 running.
- 21:4x round 2: all M-A views within Medium budget after the exterior cull (CR 202 d / 0.89 M, C5b crane 399 / 1.26 M, C6b wide 224 / 1.02 M, max seen 399). Ada absent from every insert — root cause NOT mine: the tree's ada.ts/skin.ts (C2-upgrades WIP) threw 'step is not defined' at load in that build → Ada null; fixed in the tree since. Round 3 running on a fresh dist.
- contract change #137 logged (types/host POSTROLL/durations/fx ids/cull/voice).
- 21:5x round 3 (Medium, Ada loading again): cleat inserts READ — a grey hand closing on the rope at the cleat
  (C5 25.9, C6b 9.6, C7 16.3; scratch/ma-scenes/t3a.jpg); C6b lantern: forearm + cuff under the relit lantern;
  C5b crane = porch + nine wrecks in the mist (good), C5b 135 mm shutter: the sill candle glows through the slats
  (good). Still wrong: C5b drop macro framed the roof underside (re-aimed along the gutter: geometry from
  blender/props/architecture.py, lip z 3.866, y −3.18); C5b crane 407 d (over 400 → end (0.2,−11.5,7.0), 26 mm);
  C2b 1.15 black, 4.6 sleeve not fingers, 8.1 no foot (re-aimed on measured vigil bones; + the storm's own strike
  0.55 and the torch lowered to the runner via beamClamp). Draws all ≤ 351 except the crane; 0 console errors.
- 22:1x Max round (B05 state, scratch/ma-scenes/t4a/t4b.jpg): C2b macro hands + floor feet read; C7 sting staged identically to escfix4 jmax-20/21 (same B05 state; brighter only where the session had not run C5 first — mantel/sill candles lit); 0 console errors; Max draws ≤ 360. C5b drop now visible (small dark lens) → eye moved closer + sky gain 1.35. Gate: typecheck ok, npm test 272/0, npm run build ok (verify-boot OK), assets --check ok. Playthrough (Medium, dist-ma-scenes) started.
- 22:3x GATE (dist scratch/dist-ma-scenes built from the current tree; mains, no Blender): playthrough Medium QA_STRICT
  → ended=true, 18/18 assertions, deaths 0, console errors 0 / exceptions 0; cutscenes in order C0 C1 C2 C2c C3 C4a
  C4(hem) C4c C5 **C5b (B12 421.8 s)** C6 **C6b (479.6 s)** C7 **CR (527.6 s)** → title. C2b: "dropped / not
  triggered" in this run (the bot's hide exit was not with Ada in VIGIL — optional by design, §2; it fired correctly
  in the look sessions via play()). npm test 272/0, npm run build OK (verify-boot OK), assets --check ok
  (Low 26.99/27, Medium 53.91, Max 77.28 — no asset change from this lane). Max look session: 0 console errors.
- 22:4x final Medium look (scratch/ma-scenes/t5.jpg): C2b macro hands + feet read; the strike now lights the hall
  (cold flash) but the player-eye opening shot faced a door → shot 1 now uses the plan's authored armoire-mouth eye
  (2.9, 4.9, 5.75) at 28→35 mm. C5b drop: visible as a small lens against the bright fog (still small: honest).

## Remaining (honest)
- `footprints_path` (C6b wide shot) has no world implementation (info log only); the wide shot is an empty sign.
- C5 south-window volumetric shaft NOT built (risk to the C5 shadow-play, which must not regress; out of the frame).
- `match_flare` is an emissive card only (no L_CS_KEY: infra deferred it to M-B/M-E) — the match lights nothing.
- C6 ticket: P_TICKET clone appears on the dash (no reversed `arms_pickup_read`: arms play from 0 only).
- C2b never fired in the gate playthrough (bot exits the hide when she is not in VIGIL → dropped, by design).
- Skin of Ada's hands/feet reads waxy-yellow under the warm torch spill in C2b macros (cool rim only per spec).
- CR picture: the lantern + ROOMS sign read; the house stays very dark at 55 % (two far strokes help briefly).
- sfx stand-ins for `match`, `sizzle`, `rope_creak` until lane C synthesises them.

## Requests for the lead
- Lane C: synthesise `match`, `sizzle`, `rope_creak` (then drop the SFX_STANDIN entries in bindings.ts).
- QA: judge-c2.mjs C7 marks should move 22.0/24.6 → 23.0/25.6 (C7 +1 s cleat insert, contract #137).
- Decide whether C2b should also accept a hide exit in VIGIL-adjacent states, or stay as is (optional, dropped).
- 22:5x C6 insert was NOT reading (t3c: clock close-up black behind the wheel, ticket stood upright) → key to ACC lights the panel at the insert (clock 6:10 at full panel glow), eye raised over the rim; ticket laid flat (−90° X). Mist roll in C5 28.6 not visible under the torch hotspot (remaining). voice: no beat filter in linesForTrigger (c6b_company tagged B13 plays in C6's chain). Re-ran on the current tree: npm test 272/0, npm run build OK (verify-boot OK). Verify look (C6 insert + C2b shot 1) queued behind a lane-A Blender job.
- 23:0x verify (scratch/ma-scenes/t6.jpg, Medium, 0 console errors): C6 insert now shows the lit cluster (speedo,
  fuel, temp) but the 6:10 readout sits just below the frame → target lowered 0.97 → 0.90 (NOT re-shot); the upright
  card on the dash at 11.6 is unchanged by the ticket rotation — unverified whether it is the ticket (remaining).
  C2b shot 1 (authored armoire-mouth eye, 28→35 mm): her dark headless silhouette at the door in the strike — reads.
  Typecheck clean, npm test 0 fail after the last edit. scratch/dist-ma-scenes deleted (disk rule).
- DONE for this attempt. Re-shoot needed next round: C6 9.2 / 11.6 (clock + ticket), C5 28.6 mist roll.
