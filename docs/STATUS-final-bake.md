# STATUS — FINAL BAKE (lane A: blender/**, scripts/assets.mjs, public/assets/**)

Started 2026-10-19 13:15. Scratch: scratch/final-bake/. Contract rows #152, 152b …
Items: (1) U3/U4T orange leak lines root cause + fix; (2) release bake all atlases (one atlas per job) + encode +
probes, incl. the parlor indirect re-bake (STATUS-escape-a A10); (3) assets --check + per-tier sizes; (4) dev vs
release contact sheet (Medium); (5) strict Medium playthrough on scratch/dist-final-bake.

## Baseline (13:15, before any change)
- `node scripts/assets.mjs --check`: low 26.99 / 27 MB, medium 53.80 / 60, max 77.14 / 120 — ok.
- Shipped lightmaps = dev bakes 2026-10-12 (1024², 64 spp). Lightmap bytes per tier: low 2.35 MB, medium 12.65 MB,
  max 26.42 MB (9 maps incl. 2 flash maps; LM_CAR 1024 max-res).
- Dev bake LM_UPPER_ROOMS 1024²/64 spp = 25.8 s bake + 23.4 s flash, 62 s process (.cache/bake/lm_upper_rooms.json).
- BUDGET RISK (measured sizes extrapolated from HOUSE.md's 2048² table): Medium at 2048² m7 ≈ 27.8 MB of
  lightmaps → ≈ 69 MB > 60; Max at 2048² m10 ≈ 73.6 MB → ≈ 124 MB > 120. The TIER_POLICY must change for the
  release bake to pass --check (decision below).

## Log
- 13:15 fresh start (no prior status). AC power. PERF2 headless Chrome (max playthrough) holds chrome.lock.
- 13:20–13:45 ROOT CAUSE (item 1), Blender-free (scratch/final-bake/lmdiag.mjs, lmdiag2.mjs: rasterise uv1 of the
  shipped Max GLBs over the shipped lm_upper_rooms.klm):
  - LM_UPPER_ROOMS has 3254 UV islands; **2103 have a short side < 1 texel at 1024 and 1395 cover NO texel centre**
    (moulding/trim profile facets, the 2–3 cm wall/floor overlap strips, jamb slivers, prop cords/posts). U3 alone:
    602 islands < 1 texel, 395 with zero coverage.
  - Cycles bakes only texels whose centre lies in a triangle (margin=0). Everything else is filled by
    lib/bake.dilate (8-neighbour average of ANY island) and then OIDN over the whole atlas. So a sub-texel strip's
    bilinear footprint holds whatever its shelf neighbours carry — in this atlas U2's strips, lit by L_LAMP_U2
    (60 W, 2100 K): orange dashed lines on U3 baseboards, jambs, cords, posts. Sample-weighted (edge-length biased):
    25 % of U3 surface samples have no own texel in the bilinear footprint, 11 % read > 2x their island's own light.
  - Same mechanism in LM_KITCHEN: U4T (dark) shares the atlas with the lit G3 kitchen.
  - Not geometry: wall halves overlap the floor/ceiling by 2–3 cm (rooms.py EXT) — no cracks found on this path.
- PLAN (fix at the bake, no house/props rebuild — Low has 10 KB headroom and uv1 churn would gamble it):
  lib/bake.py island label raster (texel-centre rule) + conservative footprint for zero-coverage islands, seeded
  from the 3D-nearest covered texel with a compatible normal (mathutils.kdtree), island-aware dilation (one label per
  texel, never averaging two islands), footprint texels of zero-coverage islands get mask=1 (Low's coverage-weighted
  4x downsample must not re-mix them). OIDN role measured from a raw/filled/denoised dump before changing it.
- DO NOT re-run `house` after the release bake: it is `stale` only through layout props/lights/cameras/notes and
  material-spec since 2026-10-08 (walls/rooms/openings/stairs/roof unchanged; doors only a note). house.blend matches
  the shipped GLBs' uv1 exactly; a house re-run would invalidate the release lightmaps.
- A10 parlor 'indirect': there is no special mode; the 10-12 dev parlor bake already post-dates the stool move
  (props 10-10/10-12); the release parlor job re-bakes it at 2048/128.
- TIER_POLICY decision (before the first release job, since bake_house encodes in-job): Max base 2048 m10, Max
  flash maps 1024 (as shipped today), Medium 1024 m7 (2x2 downsample of the 2048/128 bake: cleaner than today's
  1024/64, but below the plan's 2048 → lead ruling requested), Low 512 m6 unchanged. Measure after the first release
  atlas and adjust.
- 13:50–14:30 FIX WRITTEN (not yet run in Blender): `blender/lib/islands.py` (new) + `bake_house.py` (island fill by
  default, `--legacy-fill`, `--no-ship`, `--dump DIR`) + `lib/encode.py` (island-aware tier downsample via the npz
  `label` map; TIER_POLICY medium 1024; FLASH_POLICY max 1024) + `bake/encode_atlases.py` (FLASH_POLICY, label) +
  pipeline.json (islands.py in every bake job's libInputs; manual job `bake-diag` = LM_UPPER_ROOMS 1024/64 no-ship dump).
  - Offline proof on the SHIPPED lm_upper_rooms (no Blender; scratch/final-bake/offline_fill.py with Blender's bundled
    python + export_tris.mjs): U3 samples reading > 2x their island's own light 10.99 % → 0.01 %. Fill cost 5 s @1024.
  - Offline size check (same input): Low 404 963 → 450 406 B (+45 KB!), Medium 2 024 380 → 1 587 336 B. Low has 10 KB
    headroom → must re-measure on the real release bake; fallback ideas in "Risks".
- 13:55 battery: pmset says 'Battery Power' (100 %, discharging) — release bake must wait for AC.
- Queue (13:55): JUMPSCARE scare-render holds the Blender lock (~30 min chunk) → lead low playthrough (chrome) →
  my bake-diag (Blender) → my dev stills (scratch/final-bake/cmp.mjs on scratch/dist-fb = current dev bake build).

- 14:00 Low-tier variants (offline, same input, U3 surface samples reading > 2x the full-res island-filled value):
  shipped Low 12.49 %; island-filled source + legacy mask 12.51 % (404 963 B); + footprint counted as covered (mask=1)
  1.37 % (450 406 B). → keep footprint mask=1 (the advisor's point; it's what removes the Low leak) and pay the bytes.
  The 2026-09-30 release bake shipped Low lightmaps at 1.6 MiB vs 2.35 MB for today's dev bakes (less noise at
  128 spp + 4x downsample), so the release should absorb it — measured below.

## Risks
- Low budget: island fill raised Low lightmap bytes in the offline test (+45 KB on one atlas). If the release Low
  set doesn't fit 27 MB: options = Low gutters smoothed (they're not sampled), floor_exp tweak on Low only, or a lead
  ruling (+0.1 MB).
- 14:18 bake-diag (LM_UPPER_ROOMS 1024/64, no-ship, dump scratch/final-bake/dump) ran in Blender: OK.
  - texel-centre raster vs Cycles coverage: 418 260 Cycles texels, 37 not in our raster, 1 595 raster-only (edge
    ties) → same convention, the label map lines up with the bake.
  - fill 1.1 s (mathutils KD-tree), islands analysis 1.5 s.
  - U3 samples reading > 2x their island's own light (lmdiag2, sample-weighted): legacy 10.99 % → filled (pre-OIDN)
    0.06 % → new (fill + OIDN + refill) 0.02 %.
  - OIDN bleed (per island, mean of baked texels after/before OIDN): new p95 1.18 (islands 1–10 / 10–100 texels),
    1.02 (> 100); legacy p95 674 511x / 45 813x / 3 605x (the global dilate fed OIDN the neighbours' light). OIDN kept
    as is; no per-island denoise needed.
- 14:20 before-state saved: scratch/final-bake/before-lm/<tier>/ (all lm_* + probes.bin) and scratch/dist-fb (vite
  build of the tree at 13:50 with the 10-12 dev bakes). Dev re-bakes WITH the fix: bake-house-upper-rooms +
  bake-house-kitchen (ships 1024 dev KLMs; the release replaces them).
- 14:25 encode.ATLAS_TIER_SIZE: LM_CAR keeps Medium 1024 (= Max; the Medium 1024 policy would have halved the C1 cabin).
- 14:27 AC power back. Chained (scratch/final-bake/after-chain.sh, logs scratch/final-bake/logs/): devfix dev bakes
  (upper-rooms, kitchen with the fix) → scratch/dist-fb-after = dist-fb + those KLMs (copies in
  scratch/final-bake/fix-lm/) → fix stills (cmp.mjs VIEWS u2,c4a-6,c4a-10,hide,u4t,u4t-e40,g3) → release chain
  scratch/final-bake/release.sh (upper-rooms, kitchen, parlor, ground, upper-hall, exterior, car; AC checked per job).
  Dev stills (dist-fb, all 13 views) queued separately. RESTART NOTE: if interrupted, check logs/chain.log and
  logs/release.log; re-run `scratch/final-bake/release.sh <remaining job ids>`.
- 15:18 devfix kitchen (LM_KITCHEN 1024/64 with the fix) shipped: U4T samples reading > 2x their island's own light
  39.60 % (10-12 dev bake) → 0.00 %. Raster vs Cycles: 445 983 / 763 / 3 065 (agree). Bytes: Low 271 482 → 261 270,
  Medium 1 416 511 → 948 656, Max 2 215 429 → 1 477 003 (island-aware gutters compress better than OIDN-blurred ones).
  The job waited 50 min for the Blender lock (JUMPSCARE scare-render frames 0-4 = 5 frames ≈ 40 min in one hold) and
  a lead playthrough; the bake itself took 22 s.
- 15:45 first dev stills INVALID (C1 played first → C0's date card + fade stayed over every later frame; moved to
  stills/invalid/). cmp.mjs now plays C1 last and steps each scene by its own clock. Re-queued: dev3 (B03: facade,
  g1, c2-3, u1, u2, g3, c6-9, c1-66) and dev8 (B08: u2, c4a-6, c4a-10, hide, u4t, u4t-e40, g3) on scratch/dist-fb.
- 16:08 devfix upper-rooms shipped (1024/64 + fix; waited 57 min for the lock, ran 1 min): U3 foreign-lit Max
  10.99 % → 0.02 %; Low (vs the Max map) 21.85 % → 1.20 %. Bytes: Low 403 169 → 334 654, Medium 2 024 007 →
  1 207 835, Max 3 038 133 → 1 954 233, Max flash 3 707 100 → 3 161 433. --check totals now: low 26.92, medium 52.58,
  max 74.88 MB. scratch/dist-fb-after built (dist-fb + fixed upper_rooms/kitchen KLMs). Release chain started 16:08
  (queued behind dev3/dev8/fix stills).
- 16:12 release.sh had a zsh word-split bug (all ids as one word; it never started a job) → fixed and restarted.
  On BATTERY again (86 %, discharging) → it polls every 60 s for 'AC Power' before each job.
- dev3 (B03) stills OK except: C2@3.0 from the library is black (0/255) in this state, so the parlor is judged on a
  gameplay view instead ('parlor', B03), plus 'u1b'; queued as dev3b on dist-fb. c6-9 = the C6 dash close-up (LM_CAR).
- 16:35 ITEM 1 STILL (same dist, same scenario, only the two KLMs differ; Medium, display x6):
  scratch/final-bake/sheet-leak-before-after.jpg top row = C4a @10.03 dev8 (before) | fix (after): the glowing orange
  dashed lines along U3's window-wall floor perimeter and the sheeted box edges are GONE; window, dress form, sheets
  unchanged. Frame mean 3.5 → 2.4 /255 (the lines were the extra light). Bottom row is NOT the hide (hides.enter did not
  engage after the C4a run in that state; torch view of the U3 wall, identical) → re-queued 'dev8b'/'fixb'
  (VIEWS=hide,c4a-10, hide first). c4a-6 never reached its mark in either run (scene gated) — ignored.
- 16:35 RELEASE 1/7 bake-release-upper-rooms OK (2048²/128 spp + flash; bake 102 s + flash 105 s, islands 5 s, fill
  3.2 s, OIDN 2.6 s, encode 8 s; peak RSS 2.8 GB; wall 1117 s incl. queue). Raster vs Cycles 1 693 101 / 1 960 /
  6 271 (agree). Files: Max 6 919 906 (2048 m10 f13), Max flash 3 097 446 (1024), Medium 1 246 129 (1024 m7), Low
  329 728. Extrapolated Max total after all 7 ≈ 98 MB (< 120) → keep flash at 1024, Medium 1024 (2048 Medium for all
  house atlases ≈ +19 MB → ~71 MB > 60).
- 16:45 ITEM 1 hide still: scratch/final-bake/sheet-leak-before-after-2.jpg top row = C4 hide (H_ADA_WARDROBE engaged,
  x15 night-light lift, e 24) before | after, display x6: the orange/white streaks seen between the slats (floor
  perimeter, jamb) are gone after the fix. Still there in BOTH: the slats' inner faces read warm red-brown — those
  door meshes are probe-lit (no uv1), so it's the probe grid sampling the open room, not the lightmap (request for
  the lead / runtime lane). Item 1 DONE (dev bakes); the release carries the same fix.
- RELEASE 2/7 bake-release-kitchen OK (16:4x).
- 17:05 RELEASE 3/7 parlor OK, 4/7 ground OK. scratch/final-bake/final-steps.sh armed (waits for CHAIN DONE): --check,
  npm run probes, --manifest, --check, dist-fb-rel (= dist-fb + release lm_* + probes), release stills rel3 (B03) /
  rel8 (B08), vite build scratch/dist-final-bake, strict Medium playthrough → logs/final.log.
- 17:11 RELEASE 5/7 upper-hall, 6/7 exterior, 7/7 car OK → CHAIN DONE (all 7 between 16:16 and 17:11; Blender time
  per job 2–5 min; the rest was queue). Raster vs Cycles coverage agrees on every house atlas (≤ 1 % raster-only);
  LM_CAR has 68 304 raster-only texels (11 %; Cycles left some car islands unbaked — overlapping/hidden parts?) —
  those get the island-aware gutter fill only (no worse than before; car foreign-lit 3.35 % → 0.27 %).
- ITEM 3 `node scripts/assets.mjs --check` after the release: **ok** — low 26.87 / 27 MB (was 26.99), medium
  50.95 / 60 (was 53.80), max 101.82 / 120 (was 77.14).
  Lightmap bytes: low 2.35 → 2.22 MB, medium 12.65 → 9.65 MB (1024 from 2048/128 + island fill), max 26.42 → 52.30 MB
  (6 house atlases 2048 m10; flash maps + car 1024).
  Per file (bytes) low / medium / max: car 141 901 / 1 677 892 / 2 726 143 · exterior 479 457 / 1 848 228 / 9 833 156
  · ground 296 088 / 1 113 006 / 5 976 739 · kitchen 256 676 / 967 788 / 5 151 580 · parlor 305 242 / 1 185 038 /
  6 798 597 · upper_hall 407 013 / 1 616 628 / 9 001 013 (+ flash 2 794 825) · upper_rooms 329 728 / 1 246 129 /
  6 919 906 (+ flash 3 097 446).
- 17:35 Leak table, every atlas (scratch/final-bake/leak-table.txt; lmdiag2 sample-weighted share of surface samples
  reading > 2x their island's own light; Low compared with the release Max map):
  | atlas | Max dev (10-12) | Max release | Low dev | Low release |
  |---|---|---|---|---|
  | ground | 7.35 % | 0.06 % | 24.22 % | 7.12 % |
  | parlor | 6.48 % | 0.04 % | 14.70 % | 6.53 % |
  | kitchen (incl. U4T) | 14.19 % | 0.06 % | 28.67 % | 9.25 % |
  | upper_hall | 4.96 % | 0.03 % | 14.21 % | 6.40 % |
  | upper_rooms (U2+U3) | 11.24 % | 0.09 % | 22.30 % | 2.16 % |
  | exterior | 8.99 % | 0.04 % | 27.45 % | 8.26 % |
  | car | 3.35 % | 0.27 % | 7.25 % | 4.75 % |
  The Low residual is mostly resolution, not cross-island bleed: Medium (2x downsample) vs Max on ground is 1.89 %, Low
  (4x) 7.12 %, i.e. it scales with the box size around candle hot spots and contact shadows.
- 17:50 LEVELS (scratch/final-bake/room-levels.txt; Medium 1024 dev vs release, mean irradiance per room over the
  same texel-centre raster): room shells unchanged — G1 x1.03, G2 x1.01, G3 x1.02, U1 x1.01, U2 x1.05, U3 x0.97,
  exterior shell x1.00, terrain x1.00, car x1.09 → no exposure/mood shift. Spaces that only ever showed leaked light
  went dark as designed: U4T x0.01, U4 shaft x0.37, U4 stair x0.03, CLOSET x0.19, closet interior / wardrobe
  interiors x0.01–0.30. Flash map level on the same texels x1.017 (sidecar mean +34 % is only the larger covered set).
  Watch item: P_MIRROR_MANTEL x0.53 (median x0.02) — most likely its mirror glass bakes to ~0 diffuse (a
  reflective material has no diffuse lobe in the DIFFUSE bake) and the old texels carried the frame's light (not
  verified in Blender); judge it in the parlor still.
- 18:14 `encode` job re-run (encode.py changed → it was stale): re-encoded every tier from the release npz files,
  byte-identical to what the bake jobs shipped; display-error QA ok — worst 0.442 code (Low parlor), Medium ≤ 0.239,
  Max ≤ 0.027 (gate < 0.5). All bake/encode jobs now cached (house stays stale on purpose, see above).
- npm test 359/359 (17:3x, current tree). Probes: low + medium written (new keys), max pending.
- 18:42 PROBES regenerated for all tiers on the release lightmaps (npm run probes; keys low 849261e5f1d8e1bf, medium
  a3d4ccf8942014b3, max 171995a52fa0cacd) + manifests; `assets --check` ok (26.87 / 50.95 / 101.82 MB).
  scratch/dist-fb-rel = dist-fb + release lm_* + probes (same code as the dev stills). Release stills running.
- 19:21 final-steps.sh stopped after 'rel dist ready' (its sequential Chrome runs would each let a new 40-min scare
  chunk in between); instead queued at once: rel3 (running next), rel8, and the strict playthrough on
  scratch/dist-final-bake (vite build 19:21 of the current tree; its lm_* / probes.bin byte-identical to public/).
- 19:35 rel3 done (0 console errors). Same-sequence views match dev3 within noise (frame mean /255 dev → rel): facade
  30.3 → 30.4, g1 16.4 → 16.5, g3 14.6 → 15.0, c6-9 27.7 → 27.7, c1-66 32.0 → 31.8. parlor / u1 / u2 were NOT
  same-state (different preceding views → auto-exposure carry-over: parlor e 1.77 vs 0.056) → queued dev3c + rel3c
  (VIEWS=parlor,u1b,u2 from a fresh load on each dist).
- 19:45 rel8 (hide first, like dev8b): hide frame mean 4.3 (dev) → 2.9 (release) = fixb's 2.9 (leak light gone).
  c4a-10 in the hide-first runs never reached C4a (scene gated after the hide; "at null") → those frames are random
  gameplay moments (rel8 caught lightning) → not used. Queued rel8c = dev8/fix's sequence (u2, c4a-6, c4a-10) where
  C4a did reach 10.03.
- 19:47 ITEM 5 strict Medium playthrough (QA_STRICT=1, scratch/dist-final-bake = vite build 19:21 of the current tree
  with the release lightmaps + new probes): **ended=true, B13 → C7 → CR**, game 763 s / wall 346 s, deaths 0,
  unsticks 0, 18/18 assertions, console errors 0, exceptions 0, warnings 0. Note: one bot log line "STALL in B11: task=
  let her look" (B11 took 315 s game time while Ada investigated G1) — not a report stall (stalls [], stalled false).
  Report scratch/final-bake/pt/medium-report.json. Dist deleted. Load 29.6 s, gpu frame ≈ 14.3 ms (no fps claim: the
  machine was on and off battery all afternoon).
- 20:15 Checks: the runtime never reads the lm_*.json sidecars (only manifest.json), so their changed stats (flash
  mean +34 % = larger covered set; level x1.017 on the same texels) affect nothing. The playthrough used the SHIPPED
  probes ("probeSource": ground/upper/exterior shipped, probesMs 12) → probes.bin keys match the release bake.
  npm run typecheck clean; npm run build OK (verify-boot OK). Removed scratch/dist-probes, scratch/dist-fb-after and the
  raw .npy dumps (disk 94 %).

- 20:31–20:34 dev3c / rel3c (parlor, u1b, u2 from a fresh load on each dist) and rel8c (u2, c4a-6, c4a-10 = dev8's
  sequence) done, 0 console errors / 0 exceptions each.
- 21:52 ITEM 4 CONTACT SHEET: **scratch/final-bake/sheet-dev-vs-release.jpg** (Medium, display x1; pairs dev | release,
  2 pairs per row: C1 reveal 66.0 | facade · G1 | parlor · U1 | U2 · G3 | C6 dash 9.2 · C4a 10.03 | C4 hide). Frame
  mean /255 dev → release (same scenario, same order, only lm_* + probes.bin differ):
  | view | dev | release | note |
  |---|---|---|---|
  | C1 reveal @66 | 32.0 | 31.8 | identical |
  | facade | 30.3 | 30.4 | identical |
  | G1 hall | 16.4 | 16.5 | identical |
  | parlor (gameplay view; C2@3.0 is black in this state) | 26.0 | 26.0 | e 1.759 / 1.738 |
  | U1 upper hall (u1b) | 15.7 | 15.4 | identical |
  | U2 bedroom | 10.8 | 7.5 | see below — not the bake |
  | G3 kitchen | 14.6 | 15.0 | identical |
  | C6 dash @9.2 | 27.7 | 27.7 | identical (LM_CAR) |
  | C4a @10.03 (U3) | 3.5 | 2.3 | the orange dashed floor-perimeter / box-edge lines are gone |
  | C4 hide (H_ADA_WARDROBE, e 24) | 4.3 | 2.9 | orange diagonal + white streak between the slats gone; a faint cool moonlit edge stays (real) |
  Crops: scratch/final-bake/crop-hide-u2.jpg (hide dev8b / fixb / rel8 lifted x2.2 gamma; U2 pair).
  Noise / blotches / seams: none visible at Medium on any pair — judged on the 400x250 sheet tiles plus the two lifted
  crops, not a full-res inspection of every frame; the release reads the same or cleaner.
- U2 pair (10.8 → 7.5, darker over the WHOLE frame incl. walls/ceiling): the U2 shell texels are unchanged or up
  (scratch/final-bake/u2obj.py, Medium mean old / devfix / release: U2_1 7.81e-5 / 7.54e-5 / 8.31e-5, U2_2 1.86e-4 /
  1.94e-4 / 1.87e-4, U2_3 1.64e-4 / 1.60e-4 / 1.85e-4, U2_5 8.16e-4 / 8.32e-4 / 8.63e-4), so the lightmap cannot darken
  those walls. Runtime state differs: exposure e 11.13 vs 10.17 (still adapting 2 → 11 at capture), the L_LAMP_U2
  bake_flicker light's phase (game time t depends on how long the real loop ran before loop.stop()) and random
  lightning. NOT proven by a pinned re-shoot: shot.mjs blocks on the Blender lock and JUMPSCARE's scare-render
  --frames 29 started 21:52 (≈ 4 h). If the lead wants it: VIEWS=parlor,u1b,u2 with g.ctx.time.now pinned on both
  dists (scratch/dist-fb, scratch/dist-fb-rel kept for that).
  CLOSED (R1 review): the reviewer's pinned-exposure re-shoot gave Medium U2 18.57 (dev) vs 18.56 (release) → the
  10.8 → 7.5 above was runtime state, not the bake. Both dists deleted 2026-10-20 00:10.
  Props in that view (devfix vs release; the devfix column isolates the release from the island fix): rug, sheets,
  basket, wardrobes, chair, washstand, mirror ≈ equal (the drop vs 10-12 is the leak removal, intended). Two thin-bar
  props are materially darker in the release than in the 1024 devfix: **P_GRATE** (U2 floor register over the G3
  kitchen) Medium mean 0.0138 → 0.00614 (x0.44) and **P_BED iron_bed001** (the iron rails) 5.75e-5 → 1.68e-5 (x0.29).
  scratch/final-bake/grate.py: Max devfix 1024 0.0138 / 5.74e-5 → Max release 2048 0.00732 / 1.72e-5 → Medium release
  0.00614 / 1.68e-5, i.e. the drop is in the 2048 bake itself (2.4x / 5x more baked texels on those bars), not the
  downsample. Correction (21:58): the compared texels are texel-centre raster texels, i.e. Cycles-BAKED at both
  resolutions (not footprint fill; the raw coverage dump was deleted for disk, the raster == Cycles coverage to < 1 %
  on this atlas). So it is a real difference in the baked values on those thin bars — cause NOT identified. Unverified
  guess: a 1024 texel is wider than the bar, so its bake samples land partly past the bar edge (in the lit register
  opening for the grate); at 2048 they stay on the bar. Small on screen (no visible change in the U2 crop), but the
  grate's warm glow from the kitchen below is about half on every tier. AD has not judged it.

## Requests for the lead
1. **Do not re-run `house`** (stale only through layout props/lights/cameras/notes + material-spec since 10-08; no
   geometry change). A house re-run changes uv1 and invalidates all seven release lightmaps (≈ 1 h of lock time to redo).
2. **Medium tier ruling.** Medium now ships 1024² (2x2 downsample of the 2048²/128 release; cleaner than the 1024/64
   dev bake it replaces, same resolution). Plan/HOUSE.md said Medium = 2048². Measured: Medium 50.95 / 60 MB with
   9.65 MB of lightmaps; 2048² Medium for all six house atlases ≈ +19 MB (≈ 70 MB, over). Option if you want it: 2048²
   for the parlor + upper_rooms only ≈ +6 MB (≈ 57 MB) — but scare_face.mp4 is about to land on Medium too.
3. **C4 hide slats**: the slatted doors' inner faces still read warm red-brown in the hide view (before and after) —
   the door meshes have no uv1, so they are probe-lit by the open-room grid. Runtime/probe lane: a probe override or a
   dimmer factor while inside H_ADA_WARDROBE (or lightmap the door leaves' inner faces at the next props run).
4. **C4_HIDE_LM (x15) / C4a lifts** were tuned while the U3 bake carried leaked light; the U3 room is now mean x0.97 / median
   x0.90 of what it was, and its props/wardrobe interiors x0.3–0.6. Re-judge the lift values in the hide view; the "real-range U3 night bake"
   that c4-hem.ts waits for was not part of this round.
5. **Max GPU memory**: six 2048² RGBA16F lightmaps = +~144 MB VRAM vs the 1024² dev set. PERF2 should take one Max
   fps / memory reading with the release assets (I did not: the machine was on battery for part of the afternoon).
6. **Blender lock**: JUMPSCARE ran 5-frame scare-render chunks (≈ 40 min each, 6 holds since 13:44); each release job
   needed 2–5 min of Blender but waited up to an hour. Fine now — just know the release took 16:16–17:11 because of it.
7. **Docs (lane C)**: HOUSE.md / SMOKE.md tier tables still say Medium 2048 and "≈ 80 min" — real release time is
   ≈ 25 min of Blender for all seven (bake 95–105 s per 2048² atlas + flash); please update from this file.
8. LM_CAR: Cycles leaves 11 % of the car texels my raster covers unbaked (68 304) — probably overlapping UVs or hidden
   parts in the sedan set; harmless now (island fill), worth a look at the next props run.
9. **RESOLVED (R1 review: Medium U2 18.57 vs 18.56 pinned; dists deleted).** ~~U2 pinned re-shoot (optional)~~: if you want the U2 still pair proven, run cmp.mjs VIEWS=parlor,u1b,u2 on
   scratch/dist-fb and scratch/dist-fb-rel with g.ctx.time.now pinned (flicker phase) — then delete both dists.
10. **R1-1 (lane B / fix lane)**: bindings.ts tickHideLm already ends the lift on the cut (`left → GRADE.lm = 1`),
   yet the reviewer's exit+0 frame through the wardrobe back is still x15 on the 22:04 tree. Check whether the tick
   runs after that frame's render, or whether `hem.lmWanted` flips a frame after the camera is already in U4T.
   Re-shoot scratch/final-bake-rv/rv.mjs view 'wexit' on Medium and Max with exposure pinned via g.look.set
   (fx('exposure',{fixed}) is not honoured in gameplay — that is why this lane's earlier u4t stills were black).
11. **R1-2 (lane B)**: add `case 'cobweb'` to src/world/decals.ts (drawn alpha canvas of threads; material like
   grimeMaterial: transparent, depthWrite false, side + lightsNode from the old material). No asset change needed.
   Lane-A fallback: scratch/final-bake/cobweb-ribbons.patch — only together with a full release re-bake on AC.
12. **R1-3 (lane B)**: gate bake_flicker PointLights by the viewer's room + door-adjacent rooms (not the culling
   set), or give LAMP_U2 a shadow / clip volume; re-judge U3 torch-off.
13. **R1-4 (lane B)**: probe override or dimmer inside H_ADA_WARDROBE (door leaves are moving parts, never lightmapped).
14. **Pipeline**: ANY future `props` run (it is stale now through level-layout.json, incl. P_BED collider → box)
   changes .cache/props/props.blend and so stales all seven release lightmaps for `--check`. Schedule it only with an
   AC window for `npm run assets -- --only bake-release --force` right after (≈ 25 min Blender) + probes x3.
15. Medium 1024 ruling (#152b, item 2 above) still open.

## Final state (21:58; R1 round 00:25 — see "R1 fix round")
Items 1, 2, 3, 5 done; item 4 done (sheet scratch/final-bake/sheet-dev-vs-release.jpg) with the U2 caveat above.
`assets --check` ok (low 26.87 / 27, medium 50.95 / 60, max 101.82 / 120). Nothing of this lane is running.

## R1 fix round (2026-10-20 00:00–00:25; reviewer verdict "fail" on R1-1 — the release lightmaps themselves passed)
Nothing in public/assets changed in this round; no Blender job ran. Shipped: one lane-A script fix (pgrep anchor).
- R1-2 cobweb sheets = flat opaque cards — ROOT CONFIRMED (code read): blender/props/textiles.py cobweb_curtain emits the
  remnants as 4x4 card grids tagged extras.decal='cobweb' "for an alpha texture at runtime"; src/world/decals.ts
  bindDecals → drawDecal(kind) has no 'cobweb' case (default → null, "kinds left to other lanes"), so the cards keep
  their opaque dust_sheet@2s material. NOT FIXED in lane A, on purpose:
  - a props re-run changes .cache/props/props.blend, which is an input of all seven bake-release-* jobs →
    `assets --check` fails (warnStaleManual: "shipped outputs are stale") until ALL SEVEN are re-baked at 2048/128;
    `--touch` refuses (props.blend is untracked → hashed from disk; bake_house.py / encode.py are uncommitted).
  - the release re-bake needs AC power; the machine is on battery overnight (93 %, ~2:50 left at 00:15) → the chain
    could not finish under the rules and would leave the tree unshippable if it stopped half way.
  - the zero-asset fix point is lane B: a `case 'cobweb'` in decals.ts modelled on grimeMaterial (drawn alpha thread
    canvas, transparent, depthWrite false, side + lightsNode from the old material, polygon offset; sizeOf already
    gives the card size). That is also where the generator's docstring put the alpha.
  - Lane-A FALLBACK kept, not applied: scratch/final-bake/cobweb-ribbons.patch (geometry-only remnants: 34 flat silk
    ribbons per remnant, 0.6–1.0 mm, rim chords + hub threads + torn tails, no decal tag, never decimated on Low).
    Unrun and unlooked-at. Cost if chosen: props run + all seven release re-bakes (AC) + probes x3 + manifest + check +
    strict playthrough. textiles.py was reverted so nobody ships it by accident with a stray `--only props`.
- R1-1 U4T exit web: lane B (x15 lift still on at exit+0 although bindings.ts tickHideLm has `left → GRADE.lm = 1`;
  strands probe-lit by the coarse 'upper' grid). Lane-A lever (lightmapping the cobwebs) has the same props.blend →
  seven-re-bake cost, plus ~57 strands x several sub-texel islands in the kitchen band → not attempted.
- R1-3 LAMP_U2 through the wall: src/world/lights.ts (gating by visible set) → lane B.
- R1-4 hide slats: the wardrobe door leaves are moving parts (MOVING_KEYS) → never lightmapped by design → probe fix,
  lane B.
- R1-5 (C4a curtain specks): the finding text reached this lane truncated; not read, not chased.
- DONE scripts/assets.mjs foreignBlender(): pgrep pattern anchored at the executable,
  `^[^ ]*Blender\.app/Contents/MacOS/Blender( |$)` (POSIX ERE; pgrep has no \s). Test: decoy
  `node -e … -- /Applications/Blender.app/Contents/MacOS/Blender --background` matched the OLD pattern, not the new;
  processes whose argv0 is the Blender executable (with and without args) match the new one (same from node
  execFileSync). assets.mjs is no job's input (hash-neutral). `assets --check` after: ok — low 26.87 / 27, medium
  51.46 / 60, max 102.83 / 120 MB.
- Housekeeping: deleted scratch/dist-fb + scratch/dist-fb-rel (364 MB; reviewer cleared them). Disk 94 %.
- UNTRACKED files the lead must add when committing this lane: blender/lib/islands.py, docs/STATUS-final-bake.md.
