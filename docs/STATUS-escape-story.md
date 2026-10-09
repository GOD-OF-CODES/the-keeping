# STATUS — lane B-STORY (C2 escape, Phase 1)

Owner files: src/characters/**, src/ai/**, src/story/**, src/game/story-runtime.ts, src/audio/synth/**,
src/shared/voice-script.json, scripts/layout/build-layout.mjs, src/shared/layout-types.ts, tests/**, scripts/qa/**,
docs/DESIGN.md, docs/CUTSCENES-PLAN.md, docs/CHARACTERS.md.

## Log
- 2026-10-09 start: tree clean at d70bdf1; status file created. Reading docs/C2-ESCAPE.md.
- C6 stair prototype scratch/c2e/stair.mjs written; first run launched (log scratch/c2e/stair.log)
- K1/K2(bakePass type)/K4/K5/K6 applied in build-layout.mjs + layout-types.ts; layout regenerated
- B10 story (beats.ts/escape-state.ts/director.ts): CutsceneId +C2c −C2_replay; C2 end (= C2c end, host chain) → flags ada_severed, cs_C2c_done, parlor_locked, c2StrikeTime, CP2, B05 + b05_return; cutscene marker flags `c2_struck` / `c2c_started` (B04 starts at C2c); B03 hall: cleaver_chop_partial + parlor_drip_loop (stop at threshold); armoire flash +2.5 s and +30 s (open player); b04 respawn branch + rattle line removed; hint B05 → P_ARMOIRE until first hide.
- B9 AI: b04_chase retired; NEW b05_return (ada-brain tickB05Return, TUNING.b05; AiEvent b05_return phases; TellCues.knock; HeadState +placed). Never catches (scripted → no bump/catch).
- C3 tests: story.test (C2 chain/flags/CP2/armoire flash/no B04 death), ai.test b05_return idle/head/hidden early/hidden 12 s/flee — all pass
- tests/story-sim.ts + story-playthrough.test.ts updated (B04 = wait C2c; B05 walks to the armoire; CP2 has no death) — 7/7 pass
- C6 FINDING (stair prototype, Medium, battery 13 % — look only): from S = (1.05, 8.25) the camera stands on the EAST
  balustrade (ST_MAIN centreline x 0.55, width 1.1 → east edge x 1.10): the newel/top rail fills the frame centre and
  the torch core blows out on it at 0.3 m; the flight is off to the left. Frames scratch/c2e/stair-01-S-50.jpg,
  stair-02-S-36.jpg. Testing S at the centreline x 0.55 next.
- C6 RESULT: S at the stair centreline (0.55, 8.25, 5.75), pitch −50° frames the whole flight (balustrade left/east,
  wall right, beam pool on the middle treads, no near-object blow-out): scratch/c2e/stairc-01-S-50.jpg (−50°),
  stairc-02-S-36.jpg (−36°). → REQUEST: CP2 / S x = 0.55 (not 1.05). Stub prints not yet reading (material nodes); retrying.
- C1 synth: src/audio/synth/escape.ts — 21 recipes (blood_drip, parlor_drip_loop, cleaver_chop_partial, cleaver_sever
  [contact at SEVER_CONTACT_S = 0.11 s], arterial_spurt, blood_patter, head_drop, head_nudge, hair_wring, stump_breath
  (loop), bare_feet_wet {tread}, handrail_squeak, newel_knock, torch_knock, body_fall_stairs, score_hit, ada_head_lift,
  ada_head_knock, parlor_key_turn, rope_zip, heart_restart), registered in synth/index.ts; all render, no NaN.
- C2 voice: b04_door_rattle retired (build-voices.mjs + voice-cues.ts), b03_go_on tags updated (cue c2:rope_slip — CINE places it at C2 17.3); 48 lines / 6674 chars. runtime: story-runtime plays parlor_drip_loop/stop, rocker_slow (rocking_chair rate 0.935)/rocker_stop, ada_head_lift (tell) and ada_head_knock
- C6 done (look-only, battery): the empty flight from the centreline reads well at −50° (whole flight, landing
  balustrade, beam pool on treads ~8–11) and −36° (flight + the hall floor beyond). The stub wet-print quads (cloned
  materials with canvas alpha/normal maps) did not render visibly — a prototype hack, not a finding about decals; the
  real prints are B-CINE B5 (world/decals.ts). Verdict: the empty stair alone is a strong, readable last frame; it needs
  the prints + the tread-11 puddle glint to tell the story.
READY: C6 empty-stair prototype (scratch/c2e/stair.mjs; env SX/SY/PITCH/PRINTS; frames scratch/c2e/stairc-0{1,2}-*.jpg) — use S x = 0.55 (centreline), not 1.05
READY: synth ids of §2.3 (src/audio/synth/escape.ts; cleaver_sever contact at SEVER_CONTACT_S = 0.11 s into the buffer)
READY: story API — C2's end (host, after C2c) → B05 + b05_return; cutscene flags `c2_struck` (at the strike) and `c2c_started` (C2c t=0) set ada_severed / B04; sfx ids parlor_drip_loop/parlor_drip_stop/rocker_slow/rocker_stop handled in story-runtime
- marks: host.ts 'mark' → CutsceneWorld.mark → bindings emits flag `mark:<name>`; story maps 'mark:c2:strike' (needs B-CINE to add this mark at contact) and 'mark:c2c:start' (exists in c2c-up.ts). K9 eye() 0.25 m ahead when lifted. CONTRACT-CHANGES #85–#90 logged.
- playthrough.mjs: B04 = wait C2c; B05 walk to the armoire from the stair top; escape asserts (no input in C2/C2c, handover at CP2, return ≥ 10 s, no death B03–B05)
- B3 (severed Ada + head node + THE ONE head-carry mechanism): NEW src/characters/head-carry.ts (HeadCarry: modes attached/free/held/lifted/placed; finds lane A's `ada_head_rig` node, else a stand-in Group (body stays whole, logged once); pendulum L 0.24 m (ω² = g/L), damping 1.6, driven by the socket's acceleration; head sphere r 0.11 vs the right-thigh capsule, restitution 0.3; lifted = centre 1.48 m up, 0.25 m ahead; world-space two-bone IK arm layer: right fist to the hip carry point, both hands to the lifted head). ada.ts: sever(on), severed, headNode() (null until the split asset), carryHeadBy(socket), eyeOpen(on) (`eyelid_l_open`), neck spring off when severed, arm bones in the PoseCache, the head follows her visibility. bank.attach(char, 'ada_head', bone) hangs it from Harlan's prop_l / her prop_r. story-runtime: `ada_severed` flag → ada.sever (restores too). Visual verification waits on lane A's split GLB (A0/A1).
- C5 DESIGN.md: lore (WHAT SHE IS + the absence rule, WHAT HE IS keeps the head, THE TWIST second stroke), Ada appearance/behaviour (headless, carries her head, lift tell), B03 (stroke/drip, C2 rewritten), B04 = C2c cutscene, B05 (stair-top control, return timings, tread-10 wait), AI SCRIPTED + round-E note, CP2, animations (one head-carry layer), cutscenes (C2, C2c), sounds. (docs/design.json not regenerated — no generator found; DESIGN.md is the edited text.)
- C5 CUTSCENES-PLAN (table: C2 rewritten, C2c added, C2_replay retired; C2 section superseded note; faces-hidden audit rows C2/C2c/B05+ gameplay) + CHARACTERS.md (Severed Ada section, neck spring off)
- B13 (#17 runtime, skin.ts): GownLightingModel for `nightgown_silt` (Medium/Max): cotton wrap 0.5 + thin-sheet back transmission T = translucencyWet 0.4 × wetness 0.9 = 0.36, tinted by the skin under it (uGownTrans/uGownWrap/uGownTransTint). Skin wrap/tint unchanged (already #17 round 3) — A11's atlas values pending.
- B14 (skin.ts glove branch): wet leather — albedo × (1 − 0.25 × wet), roughness × (1 − 0.45 × wet) (floor 0.22), Max + clearcoat 0.6 / 0.12 (water film); uGloveWet 0.6. A12 mesh/atlas pending.
- C4: scripts/qa/c2c-handover.mjs (MODE idle/u2/hide; chain, S ± 0.1 m, pitch, b05_return, ≥ 10 s, tread-10 wait, no catch 60 s) + scripts/qa/c2e-hero.mjs (MODE frames: §8.2 C2/C2c marks + B05 pair-9 torch frames far/near; MODE av: real-time strike A/V offset ≤ 1 frame)
- npm test: 251 pass / 0 fail (incl. new marker test); typecheck clean
- brain: head 'placed' during vigil/lured scrape (§6.3); head-carry places it upright at her feet, face to the planks
- QA Medium strict playthrough (dist built ~mid-session, battery/charging — fps invalid): PASS, ended C7→title, deaths 0, 0 console errors; escape asserts pass (no input C2/C2c, control at CP2, her return first seen +11.47 s, no death B03–B05). Report scratch/c2e/qa/pt-med-report.json
- story-runtime: lightning reason 'armoire' → shadowLight {at: u1_window, 4 pulses in 0.36 s}; parlor_key_turn → shadowLight {at: lamp} (B-CINE fx API)
REQUEST → B-CINE: (1) add `{ t: C2_CONTACT, type: 'mark', name: 'c2:strike' }` to c2-room.ts (the story's c2StrikeTime/ada_severed; 'c2c:start' already works); (2) drop C2_replay from cutscenes/index.ts, preview.ts, host.ts SEEN_ALIAS, c2-room.ts (beats.ts no longer has it).
- AUDIO.md: C2-ESCAPE sounds section. Audition = headless render check only (durations/peaks/no NaN); the listening pass in lab.html is the lead's
- QA Medium strict #2 (dist built from the tree incl. head-carry/gown/glove/marks; charging — fps invalid): PASS ended C7→title, deaths 0, 0 console errors, control at CP2 (0.55, 8.25), return first seen +11.47 s
- QA c2c-handover idle (Medium): ALL PASS — chain C2 → C2c, lock 42.9 s, control at S (0.55, 8.25) pitch −0.87, b05_return, first seen +16.4 s (key at 15), blind at tread 10 28.7 → 45.0 s, no catch in 60 s. FINDING: at the top the story's grace() teleported her (in view, 0.7 m from the player) to U_SWINDOW. FIX: the brain ends b05_return with calm() in place (no relocation); story no longer sends grace; ai.test asserts no relocation at the top.
- B3 + lane A READY integrated: ada_head_rig (origin = crown → ORIGIN_ABOVE_CENTRE 0.12, L 0.17), ada_carry_r finger grip applied over the clip while she holds the head (arm stays IK). eyelid_l_open present.
- QA gate chain started (scratch/c2e/gate-chain.sh, dist scratch/c2e/dist-gate built from the current tree + lane A's split ada.glb): Medium strict, c2c-handover idle, c2e-hero frames, careless, torch-on, Low, Max
- QA Medium QA_CARELESS=1 (old dist, pre-calm fix): PASS — ended, deaths 1 (≤ 1 allowed), all asserts ok; B05 beam LOOK at 6.3 m
- GATE Medium strict (dist-gate = current tree + split ada.glb): PASS 15/15, ended, deaths 0, 0 console errors; only warning: P_LAMP_PARLOR missing from the props GLBs (lane A props job pending). Frame g-med-05: headless Ada at her vigil, head set down at the door's foot.
- GATE c2c-handover idle (dist-gate, after the calm fix): 8/8 PASS; at the top she now walks past the player (0.2 m) to her vigil U_VIGIL in view — no teleport, no catch in 60 s. (on battery 79 % — no perf claims)
- GATE c2e-hero frames (Medium, dist-gate, 0 console errors): scratch/c2e/hero/med-01…16 (C2 2.4–27.8, C2c 0.33–13.85) for the AD; B16 pair 9: med-17-b05-stump-far (2.5 m, she holds blind on tread 10), med-18-b05-stump-near (1.8 m).
  HARSH LOOK (pair 9, my verdict — not yet real): (1) the stump reads as a pink/red RING from above — the "ring diagram" the doc forbids; the blood film dome (A2 paint + B-CINE B6 blood on the cap) is not there yet; (2) the bare foot is salmon-pink under the torch core — the drowned grey-blue skin (A11) is missing; (3) the gown blows out to flat cream with a pale blotch (A11 wet-cotton atlas); (4) the carried head works: a dark wet hair mass hanging at her right hip, face covered, fist at the hip (head-carry layer). Next from my side after A11/A2: re-check the gown translucency strength (0.36) under the torch.
- npm run build: OK (verify-boot OK, 12.5 kB gz boot)
- story-runtime: stump_breath loop at her stump while severed + visible (stops offstage / unsevered)
- B13/B14 visual check: med-13 (C2c 6.62) is near-black (the gloves are not in the spill in B-CINE's current shot) and med-09 (C2 24.0) shows the body still on the table — neither frame can judge the gown transmission or the wet gloves. B13/B14 = PARTIAL (code in; visual pending A11/A12 assets + a back-lit gown frame).
- GATE Medium QA_CARELESS=1 (dist-gate): PASS — ended, deaths 1 (B09 CP6 dress visit, ≤ 1 allowed), 0 console errors, all asserts ok (B05 beam LOOK at 6.3 m)
- GATE Medium QA_TORCH_ON=1 (dist-gate): PASS — ended, deaths 0, 0 console errors
- GATE Low strict (dist-gate): PASS — ended, deaths 0, 0 console errors, all asserts ok
- GATE Max strict (dist-gate): bot PASS (ended, deaths 0, all asserts ok) but **8 console errors** — `THREE.TSL: Length of 'vec3()' data exceeds maximum length …` ×2 per load attempt, both inside the `[game] warm tableau` step (main.ts ~792: B-CINE's B11 warm of the DOF + motion-blur chains, Max only = `preset.post.cutsceneMotionBlur`; two errors = the two blur chains). Not in Medium/Low/careless/torch runs. Isolated to B-CINE's lane (pipeline motion-blur variant / B11 warm) → REQUEST. Also: Max load stalled once (300 s, retried; room warm-up 211 s, rc9 170 s) — on battery, no perf verdict.
REQUEST → B-CINE: fix the Max-only TSL `vec3()` join error raised while warming the motion-blur chains (scratch/c2e/qa/g-max-report.json console 538.5 s / 547.1 s).
- GATE c2e-hero MODE=av (Medium, real time, dist-gate2): strike A/V offset −3.9 ms (1 frame = 16.8 ms) ≤ 1 frame — PASS; 0 console errors
- GATE c2c-handover MODE=u2: all asserts ok, no catch in 60 s, 0 console errors (the scripted runner stopped at D_HARLAN (3.53, 3.16) — the door needs an interact the probe doesn't do — so it is an 'in the open, not hidden' case; she climbed, topped the stair and went to her vigil)
- GATE c2c-handover MODE=hide: all ok — hid at +3.5 s, her return started at +10 s (first seen +11.4 s), slat demo done +42.2 s, no catch, 0 console errors
- GATE final Medium strict on dist-gate2 (tree incl. stump_breath loop): PASS 15/15, ended, deaths 0, 0 console errors
- FINAL (this session): typecheck clean; npm test 252/0; npm run build OK; strict playthroughs PASS on Medium (×3), Low, Max (Max has 8 console errors in B-CINE's warm, above); Medium careless PASS (1 death, B09), Medium torch-on PASS; c2c-handover idle/u2/hide PASS; strike A/V −3.9 ms. All runs on battery or while charging → no fps/perf verdicts.

## What's left (B-STORY)
- B13/B14 visual verification once A11/A12 land (a back-lit gown frame; the gloves in the spill).
- Pair-9 AD verdict (not real yet): stump ring from above, salmon-pink foot, gown blow-out → A2/A11/B-CINE B6.
- Phase 2: the 100 mm eye insert polish, per-clip head-carry retrofits, gurgle source for a headless body, the dress-form head (§6.4).

## Requests for the lead
1. B-CINE: Max-only TSL `vec3()` error ×2 in the tableau motion-blur warm (fails the zero-console-error gate on Max).
2. B-CINE: add the timeline mark `c2:strike` at C2_CONTACT; remove C2_replay from index/preview/host/c2-room.
3. Lane A: re-run the props job for P_LAMP_PARLOR (warning "missing from the GLBs"); A2/A11 for the stump film and skin/gown.
4. The lab.html listening pass for the 21 escape sounds (render-checked headless only).
5. docs/design.json was not regenerated (no generator found); DESIGN.md holds the C2-ESCAPE text.
