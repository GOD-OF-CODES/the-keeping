# STATUS — M-A C2 upgrades (BUILD, CINE/LOOK lane)

Scope (ruling z5, top three): (1) key for the 10.5 floor head, (2) flame off Harlan's arms at the strike 7.75–8.4,
(3) blood pools (seams, satellites, thickness tone, wet specular). Fixed film exposure; Medium + Max via judge-c2.mjs.

## Log
- 2026-10-11 start: fresh attempt (no prior status, git clean at e65bfa5). Mains power, no Blender.
- diag1 (lamp→head rays, light params, head axes at 8.1/10.5) running: scratch/mac2/d1.log
- item 3 (pools) code step 1 in src/world/blood-fx.ts behind `uPoolV2` (1 = new; ?debug `__bloodFx.uPoolV2 = 0` = fix
  round 4, same-state A/B): seam runs read from the boards under the pool (mip0 vs mip3 of the opaque frame: a seam is
  ≥ 35 % darker than its 8 px neighbourhood → runs ≤ 0.55 R past the front, hashed per bearing), 7 satellite drops
  (2–7 mm at 1.1–1.6 R), fine wetting-line irregularity (k 13/23, ±1.8 mm), Beer–Lambert thickness tone (core ×0.36,
  thin film/runs/satellites ×1.25 over the outer 1 cm). No new draws/geometry (same instanced quads). Not yet looked at.
- typecheck note: `src/story/director.ts` imports `../cutscenes/c4c-step.ts` (another lane's in-progress file) — not mine.
- diag1 (Medium, dist from e65bfa5 tree, scratch/mac2/d1, 0 console errors): at 10.5 the head IS face-up (head +Z =
  plan (0.10, 0.04, 0.99)), the lamp ray to the face/cheek/crown points hits `ada_hair[S]` 5× ≈ 2.4 cm before the skin
  (the face veil lies over the face-up face), the earR ray reaches the skin (lit, but faces away from E4). Lamp:
  flicker_L_LAMP_PARLOR 12.19 cd, 4.5 m, cube 512, bias −0.002. Table candle 0.44 cd at 1.24 m from the head → ≤ 0.3 lx:
  it cannot key the head (the lamp gives ≈ 5–6 lx there). Next: same-frame sweep (veil clear / hair hidden / poses).
- method finding: the lamp cube is redrawn a third at a time at 20 Hz per face (lights.ts split cube), so the older
  same-frame diagnostics that advanced 2 × 1/1000 s after hiding the hair sampled a STALE cube (the hair's shadow was
  still in it) — and `shadow.intensity = 0` is not read by the custom gated shadowNode (uShadowOn, re-set to 1 per
  frame). My sweep forces a full cube redraw (cubeFaces = null + needsUpdate) before each probe.
- candle as key: P_CANDLE_TABLE flame at z 1.58 on a table, the head on the floor (centre z 0.69) → ≥ 0.88 m apart:
  "within 0.5 m" is geometrically impossible; measured anyway (variant candle_up, head at (5.3, 2.7)).
- item 2 code scaffold (src/world/cutscene-fx.ts): `lamp_flag` — a 2-tri card on LAMP_CASTER_LAYER only (the view
  camera never draws it; the lamp cube renders it as an occluder), created at load hidden, `fx lampFlag {on}` cue
  (state cue → a skip applies the on/off pair), QA live override `globalThis.__c2Flag = { on, c, w, h, yaw, pitch }`.
  Placement pending the strike geometry (sweep s1 queued behind the lead's Max playthrough).
- 19:10 waiting for the headless-Chrome lock (lead's Max playthrough, pid 48451); flag + pools coded, untested.
- SWEEP s1 (Medium, scratch/mac2/s1, same frame 10.5, full cube redraw before each probe; HDR pre-exposure L at the
  head-rig points, fixed film e 0.625, 0 console errors):
  | variant | face | cheekR | eyeR | earR | cut |
  |---|---|---|---|---|---|
  | ship (fix round 4) | 0.0060 | 0.0060 | 0.0058 | 0.014 | 0.0063 |
  | veil cleared (__veil 1) | 0.0039 | 0.0019 | 0.0034 | 0.014 | 0.0060 |
  | hair castShadow off | 0.015 | 0.040 | 0.013 | 0.012 | 0.010 |
  | hair hidden | 0.060 | 0.10 | 0.048 | 0.025 | 0.0064 |
  | hair hidden + grey 0.5 skin | 0.30 | 0.58 | 0.30 | 0.070 | 0.13 |
  | veil cleared + hair no-cast | 0.057 | 0.099 | 0.050 | 0.016 | 0.0084 |
  | fix-round-3 side pose (241/0/20) | 0.0016 | 0.0025 | 0.0018 | 0.033 | 0.013 |
  | other side (60/0/10) | 0.0057 | 0.0055 | 0.0057 | 0.0092 | 0.0024 |
  | head moved under the table candle (5.3, 2.7) | 0.0092 | 0.0011 | 0.010 | 0.0010 | 0.016 |
  ⇒ the lamp DOES reach the face-up face (grey ceiling 0.30–0.58 ≈ 6 lx × 0.5/π): the black head is the rigid hair
  shell's OWN cube shadow (dome ≈ 2.4 cm over the skin) + the veil over the face. Veil cleared + the hair out of the
  lamp cube while the head lies loose = the no-hair ceiling (×10–16). The candle/re-pose routes do not key it.
- item 1 code: src/characters/ada.ts — the face veil clears for a severed head nobody holds (floor) as well as in
  Harlan's fist (was: fist only; still ON in her own hand); src/characters/skin.ts — `maskShadowNode` = the same veil
  mask, so the cleared cards leave the lamp cube too (r186 Renderer._getShadowNodes ignores opacityNode). Logged
  deviation from fix-round-2 ruling (g) "on the floor the wet hair stays over most of the face" — z5 asks for the face.
- item 2 code: LAMP_FLAG = card 0.29 × 0.36 m at plan (4.547, 3.651, 1.60), normal to bearing 5° (0.25 m from the
  flame, el 15–60° × az −25…+35°); c2-room.ts cues `fx lampFlag` on at 0 / off at 8.6 (the whip to E4).
- npm test pass (typecheck clean except another lane's missing c4c-step.ts import). Next: rebuild dist, A/B session.
- 19:16 A/B round 1 (Medium) queued/running: scratch/mac2/ab1
- 19:18 still queued behind the lead's Medium playthrough (pid 50955)
- A/B round 1 (Medium, scratch/mac2/ab1, current tree dist, 0 console errors):
  - item 1 head 10.5: face 0.0056 → 0.058, cheekR 0.011 → 0.094, eyeR 0.0049 → 0.053 (×10). Look: it now reads as
    HER FACE (closed eyes, nose, lips, the cut ring below toward the lens) — but a smooth pale-gold MANNEQUIN face (no
    blood/wet on the skin, no strands across it). Next: let 2–3 wet strands lie across it, check skin wetness.
  - item 2 flag: NO EFFECT (forearm 0.072 vs 0.073, identical stills) → debugging whether the card reaches the cube.
  - item 3 pools: satellites visible; seam runs not visible yet; the core is not darker enough (still a flat red).
- item 1 step 2 (code, untested): skin.ts `uHeadSmear` — a smeared whole-blood film on the face's down side at the
  landing (left cheek/temple/nose/lips; bind contact normal (0.72, −0.12, 0.68), noise-broken, roughness 0.15),
  latched in ada.ts once the severed head lay loose (QA __headSmear). Pools step 2: core ×0.3, thin band 1.5 cm, the
  seams show through the film as darker lines; seam debug view `__bloodFx.uStainDbg = 3` (G seam, R run, B satellites).
- item 2 root cause (ab1 no effect): L_LAMP_PARLOR's cube shadow camera near = 0.5 m (diag1) — the 0.25 m card was
  clipped out of the map. Moved to 0.55 m (bearing 5°), same solid angle → 0.64 × 0.80 m at plan (4.842, 3.712, 1.90).
- 19:29 ab3 (flag at 0.55 m, smear, pools v2b, seam map) queued: scratch/mac2/ab3
- A/B round 2 (ab3, Medium, scratch/mac2/ab3, 0 console errors):
  - item 2 FLAG WORKS at 0.55 m: 7.75 forearm_r 0.074 → 0.0042, upperarm_r 0.029 → 0.0039, chest 0.015 → 0.0016;
    8.3 forearm_r 0.11 → 0.0024; stump 0.0061 → 0.0064 and the cleaver hand 0.023/0.13 unchanged (keyed). Look: the
    salmon plaid and upper arm fall into shade, the eye goes to the stump; the gauntlet's lower half (el < 15°, the
    stump's sector) stays lit pale grey — cannot be separated from the stump by a flag (material: lane A).
  - item 1: face visible + smear; the smear read as a clean half-face maroon mask → broken into roll streaks with
    thickness variation (step 3). Hair: in this run the wet hair cards lay on the boards as dark comb strips (verlet
    floor-clamp result varies with the advance steps) — lane A/hair (rigid shell + 8 chains).
  - item 3: core darker; seam map showed false seams in hair/shadow → gated to lit boards (≥ 40 % of the unshadowed
    floor exitance), runs 0.2–0.8 R. DOF at 10.5 blurs the pools (focus on the head).
- gate part: assets --check ok (low 26.99/27, medium 53.91/60, max 77.28/120 MB — unchanged, no assets touched); npm test 266/266. Round 2 judge-c2 Medium+Max queued (scratch/mac2/j2).
- round 2 look (judge-c2 Medium, scratch/mac2/j2/medium-*, 0 console errors; 7.75/8.2 view 150 draws / 0.83 M,
  10.5 76 / 0.29 M): 10.5 the head READS as a face now (eyes/nose/mouth, the cut ring below toward the lens; face
  0.036, cheekR 0.096 vs fix round 4 ≈ 0.006) but as a clean plaster mask (smooth grey-gold, eye holes dark — sculpt:
  lane A); the pool's 1.5 cm thin band read as a blurred edge. Round 3 changes: ≈ 30 % of the veil strand bands stay
  plastered across the face while it lies (uVeilStrands, floor only — not the 13.9 insert), the smear widened, the
  pool's thin band 1.5 cm → 5 mm (sharp front; runs/satellites keep the thin tone).
- 19:39 dist rebuilt with round-3 code while the Max judge (j2-max) was still queued → j2-max = round 3 on Max.
- 19:41 waiting: j2-max (round 3 on Max) then j3-medium in the Chrome queue
- j2-max (round 3 code, Max): marks fine (7.75 151 draws / 0.95 M; 10.5 76 / 0.34 M; face 0.036, cheekR 0.079), but
  1 console error "Failed to load resource: 404" during the 184 s load (URL not recorded) — suspect my dist rebuild
  overlapping the run's start; re-checking on Max with --console on the final dist.
- 19:47 waiting on j3-medium + ab4 (pool radiance A/B: refl off / v2 off / stains off) in the Chrome queue
- 19:51 queue: lock held by pid 61210
- round 3 look (judge-c2 Medium j3, round-3 dist, 0 console errors; 5.0 153 draws / 0.83 M):
  - 5.0 (D_WORK, flag on): Harlan is a dark silhouette over her lit body against the lit wallpaper, his trousers lit
    from below the flag line — reads as a staged-by-a-cinematographer key, not salmon plaid. Stump 0.0157.
  - 10.5: the kept 30 % × 7 mm strand bands covered most of the face again (face 0.017) → 12 % × 3.5 mm (round 4).
- 19:53 round 4 code: strands 12 % × 3.5 mm, pool froth bubbles (flame glints, 4 mm cells, 7 %); queued ab5 (Medium same-state new/old) + j4 Max judge with --console
- 19:55 ab5 queued behind pid 65019
- 20:02 flag OFF cue no longer forces a 6-face cube redraw (only ON at the cut does)
- round 4 (ab5 Medium same-state, 0 errors): face 0.0068 → 0.027, cheekR 0.014 → 0.024 vs fix round 4; the 12 % ×
  3.5 mm strand bands still read as a vertical comb over the face → strands DROPPED (veil fully cleared on the floor,
  the smear carries 'wet/rolled'). Bubbles: no visible specks at 1280 (sub-pixel at E4; kept, harmless).
- GATE (final tree): npm run typecheck clean · npm test 271/271 · npm run build OK (verify-boot OK) · assets --check
  ok. Final dist rebuilt once; chain queued: playthrough Medium (scratch/mac2/gate) → judge-c2 Max --console (jf/max,
  marks 0.2 for the flag-on cut) → judge-c2 Medium with the parlor/C5/C7 views (jf/medium).

## Summary (M-A C2 upgrades)
1. Floor-head key (10.5): NOT a light problem in the end — the lamp reaches the face-up face (grey ceiling 0.30–0.58);
   the rigid hair shell's veil cards (≈ 2.4 cm over the skin) shadowed it in the cube (the older diagnostics read a
   stale third-updated cube). Fix: veil cleared on the floor in BOTH passes (ada.ts + skin.ts maskShadowNode) + a
   smeared pool film on the landing side of the face (uHeadSmear). Face 0.006 → 0.027–0.036, cheek ×2–8 (run-to-run
   hair settle varies). The candle cannot key it (≥ 0.88 m above the floor; measured 0.009); no layout change needed.
2. Strike (7.75–8.4): camera-invisible flag in the lamp cube (lampFlag): forearm 0.074 → 0.004, upper arm/chest ÷7–9,
   stump and cleaver hand unchanged. Harlan reads as a dark figure over her lit body.
3. Pools: darker thick core (Beer–Lambert), sharp 5 mm thin front, lit-board seam runs + satellites + froth, the seams
   show through the film; 0 new draws/tris. Honest read: at E4 (DOF, 1280 px) they still read as smooth dark-red
   shapes — better than 'red felt' but not photographic.

## What's left (not mine / stage 2)
- Face sculpt: smooth plaster/mannequin face, the eye holes read dark (lane A); rigid hair shell on a face-up head;
  verlet hair floor-settle differs run-to-run (sometimes dark comb strips on the boards) — lane A / characters.
- Gauntlets: their lower half sits in the stump's sector from the flame (az −14…−2°, el 5–20°) — no flag can separate
  them; pale grey-gold = material (lane A).
- Seam runs are screen-space (view-dependent; fine for the locked E4/D cameras); not verified visible through the
  10.5 DOF.
- GATE playthrough Medium (final dist, QA_STRICT default, scratch/mac2/gate): EXIT 0, 0 console errors, deaths 0,
  ended=true at game 525 s / wall 227 s. Cutscenes fired: C0 0.03 · C1 28 · C2 124 · C2c 153 · C3 219 · C4a 258 (B08) ·
  C4 approach/hem/look/leave 282–303 · C4c 342 · C5 360 · C5b 395 (B12) · C6 419 · C6b 453 · C7 466 · CR 501 → title.
  C2b "dropped / not triggered" (the playthrough lists it optional; scenes lane).
- 20:15 final Max judge queued behind pid 70253
- GATE judge-c2 Max --console (final dist, scratch/mac2/jf/max-*): EXIT 0, 0 console errors (the j2-max 404 did not
  reproduce → the rebuild overlap). Views: 0.2 196 draws / 0.98 M · 5.0 154 / 0.95 M · 7.75/8.2 151 / 0.95 M · 10.5
  76 / 0.34 M · 13.9 75 / 0.34 M (≤ 500 / 2 M). 0.2 (flag on at the cut): the player's eye at the door, no visible
  change. 10.5 Max face 0.031, cheekR 0.078. Info only: "[level] shipped probes are stale … runtime bake" on Max
  (layout/spec/asset hash changed by another lane — not from these edits; `npm run probes` = lead/lane A).
- 20:25 final Medium judge (views) queued behind pid 72804
- GATE judge-c2 Medium with views (final dist, scratch/mac2/jf/medium-*): EXIT 0, 0 console errors; parlor views
  thr/wide/lean/stool, C5 17.6/20.6, C7 22/24.6 rendered. Nothing regressed: C5 mean luma 1.7 / 15.3 vs fix-round-4
  jmed 0.5 / 15.1 (17.6 is the near-black fade in both); the B05 parlor wide view keeps the unflagged lamp (flag is
  C2-only).
- GATE RESULT: typecheck ✓ · npm test 271/271 ✓ · npm run build + verify-boot ✓ · assets --check ✓ · playthrough
  Medium C7 → CR → title ✓ (0 errors, 0 deaths) · zero console errors Medium ✓ and Max ✓. scratch/dist-mac2 deleted.
READY: C2 upgrades (items 1–3) — files: src/world/cutscene-fx.ts, src/cutscenes/c2-room.ts, src/characters/ada.ts,
  src/characters/skin.ts, src/world/blood-fx.ts; contract #136.
