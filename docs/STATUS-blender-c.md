# STATUS — Lane A (Blender) round C

## 1. Push-gate bug: Low stuck at back-stair foot (plan 8.42, 10.74, z 0.77)
- Finding: `build_props.low_lod` already skips `collider` proxies, but the runtime (`src/world/collision.ts`
  propColliderMeshes) builds prop colliders from the *render* meshes when a prop has no `*-collider` proxy, so
  Low decimation changes collision shapes of props with layout `collider: box|mesh`.
- Probe: `scratch/blc/diag-stair.mjs` (colliders in plan box x 7.7–9.1, y 10–11.6, z 0.62–2.4 + controller walks).

## 7. assets.mjs automatic retry — DONE
- `runJob`: if Blender exits non-zero and the `/usr/bin/time` output says "terminated abnormally" (signal death),
  the job is re-run once inside the same lock; Python errors (exit 1) are not retried. Logged to the job log.

## 3. road-rc9.json single source — DONE (code), re-export pending
- `blender/house/road_rc9.py` now loads `src/shared/road-rc9.json` (R, ARC, S_A..S_END, S_DETAIL, X0/Y0, GATE_S);
  radians are snapped to 1e-4° so ARC == pi/6 exactly. Verified in python: every constant is bit-identical to the old
  hard-coded values (S_B 397.07963267948963, S_D 1004.1592653589794, C start (410, -73.19237886466838)), so frame()/
  point()/stations() and the corridor geometry are identical by construction. `_check()` asserts the JSON's derived
  fields (C/E start, B centre, chainages) agree with the analytic frame to 1.5 mm. `definition()` = JSON + polyline
  (marker extras.road now also carries `lanes`, which the JSON has).
- pipeline.json: corridor jobs list src/shared/road-rc9.json as an input (hash-cache invalidates on edits).
- assets.mjs also gained `--job-args="--views a,b"` (extra script args for the named job; used for targeted review
  renders, e.g. `--only house-review --job-args="--views facade_near,c_siding_mid"`).

## 8. Yard trees LOD (C1 54 s view, EXT2 1.04 M tris)
- EXT2 props (Medium, from .cache/props/props.json): 3 hero `dead_tree` 64.7k/64.8k/64.4k tris = 194k, 9 wrecks
  ~224k, sedan 30k, porch 20k → 483k in props_m*.glb; the rest of EXT2's 1.04 M is house_exterior + details_*
  (treeline, groundcover). Hero trees ship ONE LOD node each (no distance LOD); only Low cuts the twig tail
  (`lod_twig_from`, build_props.low_lod). Treeline trees have a static per-tree skeleton LOD (mid < 24 m, far < 40 m,
  low beyond, measured from (2, -12)) — no runtime switching needed.

## Restart 2 (07:0x)
- Item 4(d) H_ARMOIRE eye [3.12, 4.45, 5.65]: already in scripts/layout/build-layout.mjs and level-layout.json (verified).
- house-review (views facade_near,c_siding_mid,b_facade_near) queued by the previous attempt, waiting on another lane's
  headless Chrome (scratch/open2 max shot); Low stair probe queued behind it (scratch/blc/diag-low.log).

## 4b. KLM floor_exp 13 on dark atlases (#9) — code DONE, re-encode pending
- `blender/lib/encode.py` FLOOR_EXP_DARK = {upper_hall, upper_rooms, car, exterior}: 13 (backlog #9 list); applied
  inside encode_tiers for every caller (bake_house dev bakes, bake/encode_atlases). Sidecar floorExp reports it.
- Item 3 before-snapshots for the bounds compare: scratch/blc/before-<tier>/{details_corridor,props_road}.glb;
  compare tool scratch/blc/glb-bounds.mjs (A.glb B.glb → max |Δ| of node translation + POSITION min/max).

## 4. Upstairs key light (#10) — layout + bake code DONE, dev bake pending
- Layout (scripts/layout/build-layout.mjs, regenerated, validate 0 errors / 26 warnings as before): P_CANDLE_LANDING
  (saucer, 8 cm, guttering) on P_HALL_CONSOLE_U1 at plan (0.32, 1.42, 4.88) + L_CANDLE_LANDING 6 W 1800 K bake_flicker
  at z 5.0. Only props/lights changed in level-layout.json.
- Doors: left as designed — D_HARLAN is already ajar (U2 lamp spill); D_DRESSING stays closed (hearing attenuation
  + AI edges + tests depend on it: tests/ai.test.ts:124-126) → request for the lead if wanted.
- bake_house.py: upper_hall/upper_rooms bake under SKY_GAIN = 0.02/0.00982 (Lz 0.02, backlog #10); others unchanged.

## 1. (cont.) Offline asset diff Low vs Medium — no tier difference near the back stair
- md5 of all 23 GLBs Low vs Medium: only ada, arms, harlan, details_{corridor,groundcover,treeline}, props_m1/m2,
  props_road differ. collision.glb, doors.glb, house_kitchen, details_kitchen, house_upper_* are byte-identical.
- props_m1/m2 node diff (scratch/blc/glb-bounds.mjs): decimated props are trees, wrecks, sedan, candles, jerry cans
  (x 3.98, box), armoire/wardrobe doors (U1/U3), lamp, rocker, bell, rope, rubber sheet, dress dummy, nail can.
  No prop with collider box|mesh in G3/U4 within 1.5 m of (8.42, 10.74); the nearest (P_KITCHEN_CHAIR_2 box,
  P_KITCHEN_TABLE box) are NOT decimated (identical vertex counts). The stuck point is the D_BACKSTAIR doorway
  between bot waypoints k_door (8.3, 10.4) and u4_foot (8.3, 11.2), 0.11 m before the first riser (y 10.85).
  → the Low stall is not a Low collision/asset difference; probing runtime behaviour next (scratch/blc/probe-low.txt).

## 2. Arms — code in progress (not yet built)
- Hold pose: skeleton.ARMS hold_roll_deg -28 (grip rolled about the barrel; the hand moves from 17° right of "up" —
  i.e. straight between the eye and the torch, which is why only the tail showed — to 10° left, 40° off the eye line).
  Beam direction unchanged (flash_dir), so arms.ts' beam aim is unaffected.
- Gloves: body.hand_sdf `sharp_fingers` (per-finger smooth union, HARD union between fingers → creases, no webbing)
  + `knuckle_k` 1.18 (arms only; Ada/Harlan unchanged); glove voxel 1.7 → 1.1 mm, decimate 10k → 16k tris/glove.
- tex_arms: knuckle holes (10.5 x 12.5 mm ovals over index..pinky MCP, bound rim + stitch row, skin 0.30/0.19/0.14).
- Reference render before: scratch/blender-realism/r2_arms_v0.png (game view: torch hidden under the fist; close-ups:
  sausage fingers, no knuckle holes).
- Clips (blender/anim/clips_arms.py, "car clips"): arms_radio_seek 2.4, arms_headlamp_knob 1.6, arms_stalk_flick 1.0,
  arms_brace 1.2, arms_map 6.0 (+ socket prop_l on hand_l, sockets.py / map_socket_rest). arms_wheel now IKs BOTH
  hands onto the rim at ten-to-two (name kept). Control positions from props_m1.glb's sedan_interior nodes minus the
  driver eye (radio_seek_up, headlamp_knob, stalk_turn tip, steering hub/tilt 25°/rim r 0.1765).

## 8. (cont.) C1 54 s view vs yard trees — documented, runtime request
- C1 50.4–56.6 s (`rooms` shot): car eye travels road stations 140 → 23 m (WEST), camera targets (2.6,160)→(2.2,40).
  Hero trees P_TREE_1 (-6.5,-12), P_TREE_2 (11.5,3), P_TREE_3 (-7.5,7) are then ~30–150 m away and ship ONE node each
  (64.4–64.8k tris, 194k total, Medium/Max). Low ships the twig-tail cut (`lod_twig_from`, ~22–24k verts each).
- Proposal (needs runtime LOD switching → request for the lead): ship the Low twig-cut mesh as a second node
  `<id>-dead_tree-far` on Medium/Max (extras `lodFar: true`, `lodSwitchM: 35`); at 35 m a 1.8 mm twig is 0.03 px at
  600 px / 60° vFOV, and even 12 mm spurs are 0.2 px, so the switch is invisible. Saves ~125k
  tris in every exterior/C1 view beyond 35 m. Not built yet (runtime first).
- Evidence from scratch/b08/low4-report.json (Low, 22:42, BEFORE the 23:22 decimation, reached C7): it already hit an
  UNSTICK in B10 at (8.42, 11.12, 1.1) → k_door at the same spot, so the doorway/first-tread transition is marginal
  on every tier; the bot's u4_foot waypoint (8.3, 11.2) is on tread 2 of ST_BACK (start y 10.85, tread 0.25).
  Probe extended (scratch/blc/diag-stair.mjs): descending walks from tread 2 to k_door + D_BACKSTAIR angle/target.

## 5. Clapboard (#12) — analysis (renders pending)
- Geometry is already real lap siding on every facade (exterior.hero_siding): course every 0.10 m (3.9 in), butt
  20 ± 3.5 mm tapering to 4 mm, 4 mm 45° drip chamfer, a down-facing underside per course; flat per-face normals (each
  face has its own verts; sharp 32°); UV v = z − 0.83 so every drip edge lands on a generator row boundary.
- The "stone" read is the runtime generator + spec (wood.ts clapboard: peel 0.55 × 0.8 chip coverage over bareWood
  [0.12,0.10,0.08] under paint 0.42 ≈ 4:1 contrast → dark blocky blotches). Backlog #12's fix there (bareWood silver
  [0.27,0.25,0.22], peel 0.25 low/eaves-weighted, wet paint roughness 0.35) is spec/runtime → request for the lead.
- Review jobs added (pipeline.json, manual): `arms-review` (blender/characters/review_arms_car.py: car clips posed in
  a clay cabin stand-in, 3x2 sheet) and `arms-dim-review` (existing review_arms_dim.py through the lock).
- Queued batch (scratch/blc/chain1.sh → chain1.log): props, house, corridor, characters(arms), anims(arms), reviews;
  then chain2.sh: dev bakes upper-hall / upper-rooms / exterior + --check.
- Baseline --check (before batch): low 24.88 / medium 43.89 / max 61.23 MB — ok.
- npm test with the new layout (landing candle): 200/200 pass.
- Clay review (house-review, scratch/house/c_siding_mid.png, 07:36): under a flat overcast sky the facade reads
  unmistakably as lapped clapboard — every course has its shadow line and drip highlight, staggered butt joints and
  slight warps show; corner boards/casings stand proud. So the geometry/UV/normals are right and the stone/brick read
  in game is the runtime material (peel/bareWood contrast, item above) → request for the lead; no geometry change.
- Low probe #1 (07:40, spawn CP7): colliders in the box around the stair foot are exactly col_stair_U4, col_wall_G3,
  col_wall_U4 and P_KITCHEN_CHAIR_2's box [7.78,9.13]..[8.95,10.02] h 0.49 — no Low-only collider. D_BACKSTAIR opens to
  92°. The walk tests were void (spawned without a beat: the player did not move at all, even in the open kitchen) →
  re-running at --beat B10 on Low + Medium (scratch/blc/probe2-*.txt).

## 3. (cont.) corridor re-export 07:49 — road identical; prop prototypes differ
- details_corridor all tiers: every road/ditch/paint/chunk node identical (0 diffs in node translations and POSITION
  bounds); only prototype meshes differ: snags rc9_snag_L10/L11/L12 (up to 0.30 m in bounds), poles/reflectors
  ≤ 1.6 mm. props_road ≤ 3.7 mm (Low 2.5 cm, 2 vertex-count diffs). Sources of those generators predate the
  23:36 snapshot, so checking determinism: re-running corridor on unchanged code and comparing run1 vs run2.
- Item 6: house job 07:49 ok — details_groundcover.glb now uses grass_dead@2s on all tiers.
- Low probe #2 (beat B10, 07:5x) REPRODUCES the stall: walking k_door (8.3,10.4) → u4_foot ends at exactly
  (8.42, 10.74, 0.77) (the playthrough's stuck point), and descending from tread 2 (8.3/8.42, 11.1–11.25, 1.1) does
  not move at all. D_BACKSTAIR is open (92°). The capsule (r 0.27 → 0.54 m) is pushed east from x 8.30 to 8.42:
  O_BACKSTAIR is 0.70 m wide (x 8.00–8.70) and the open leaf stands inside the west part of the opening, so the clear
  width is ≈ the capsule diameter, right where the first winder riser (y 10.85) starts. Medium comparison running.
- Medium probe #2 (same test, Medium): IDENTICAL stall — up: ends (8.42, 10.71, 0.77); down from tread 2: frozen at
  (8.42, 11.12, 1.10). So it is NOT a Low asset difference; Medium/Max playthroughs just happen to squeeze through.
- ROOT CAUSE: head clearance. ST_BACK's winders start at the wall's north face (y 10.85) right behind the 1.95 m
  O_BACKSTAIR (lintel at z 2.55). The capsule (height 1.78, r 0.27) steps onto kite 1 (+0.25 → top 2.63) or stands
  on kite 2 (+0.5 → 2.88) while its rounded top still overlaps the lintel → blocked both ways. The 23:22 Low assets
  only changed the bot's timing (the low4 run already needed an UNSTICK at this exact spot).
- FIX (asset pipeline, blender/house/collision.py HEAD_CLEAR): the collision lintel over O_BACKSTAIR starts 0.45 m
  higher (3.00); the visible lintel is unchanged and the eye can't enter it (≤ 2.50 inside the wall thickness;
  ≥ 0.26 m past the wall before it rises above 2.55). Rebuild: chain3.sh (house), then re-probe + playthroughs.

## NONDETERMINISM (found while verifying item 3) — fixed in code
- corridor run1 vs run2 on unchanged code: rc9_snag_L10/11/12 prototypes differ by up to 0.24 m, poles/reflectors
  2.4 mm → item 3's diffs are this, not the road JSON (road nodes identical). Cause: `kit.Rng.sub` seeded with
  `hash((float, str))` and `house/windows.py` with `hash(oid)`: Python str hashes are salted per process, so every
  props / house / corridor run changes geometry AND lightmap UV2 (scratch/blc/uv2cmp.mjs: house_ground 19/19,
  house_kitchen 14/14, house_parlor 7/7 primitives with different UV2 vs HEAD after the 07:49 house run; props_m1
  73 prims). Fixed: zlib.crc32 in both. The next full content run changes those shapes once (then stable) and needs
  a full rebake — the lead's release bake does that anyway.
- Consequence handled: the shipped house_*/details_* GLBs + .cache/house/house.blend are kept from the 07:49 run
  (snapshot scratch/blc/house-0749) because chain2's dev bakes (upper_hall, upper_rooms, exterior) bake against it;
  chain3 re-runs house only for collision.glb (deterministic) and restores the rest. ground/parlor/kitchen/car still
  need dev bakes against this set (queued after the gate proof).
- Item 3 DONE: road/ditch/paint/chunk nodes geometry-identical on all tiers after reading road-rc9.json.

## Batch results 08:07
- Dev bakes ok: upper_hall 221 s, upper_rooms 239 s, exterior 40 s (floor_exp 13, Lz 0.02 upstairs, landing candle,
  grass_dead/grass_wet bounce, L_LANTERN 150 W). Sizes: lm_upper_hall 0.49 → 2.04 MB, lm_upper_rooms 0.53 → 1.94 MB,
  lm_exterior 1.83 → 2.27 MB (Medium) — far more than the backlog's "< 3 %": the brighter upstairs + the 2^-13 floor
  keep real low-end detail/noise that used to quantise to zero. --check: low 26.05 / medium 47.48 / max 65.39 MB
  (all under budget; Low has 0.95 MB headroom left).
- --check flagged 2 job failures: anims (arms max tier 55,730 tris > 48,000 → gloves 16k → 12k each, rebuilding in
  chain5) and house (check_house: details_corridor utility_pole nodes without `detail` extra — single-item pole
  variants export as plain mesh nodes; corridor.instanced() now tags them; rebuilding in chain5).
- chain3 08:07–08:15: collision.glb rebuilt with HEAD_CLEAR (md5 fa40f550…, identical on all tiers, ≠ old a5131f6b…);
  every other house/details GLB and house.blend restored from the 07:49 snapshot; manifests rewritten.
  ("FAIL house" = check_house's corridor-extras failure above; the outputs are written before the check.)
- Determinism proof: two `house --force` runs after the crc32 fix STILL give different house_ground.glb md5 →
  another nondeterminism source remains in the house job (set/dict order or a 3rd seeding path). Not chased further
  this round → request/backlog. Consequence: every house run needs a full rebake (as the release bake does).
- probe3 (Low, B10, with HEAD_CLEAR): descending now passes the lintel (11.12 → 10.72) but stops on the riser lip at
  (8.42, 10.72, 0.82); ascending reaches kite 1 (8.43, 10.82, 0.85) and stops. Second constraint = WIDTH: the open
  leaf's runtime box includes both 80 mm knobs (0.20 m thick) and stands in the opening's west 0.14 m → ~0.56 m clear
  for the 0.54 m capsule → pinned. Fix 2: collision.py JAMB_CLEAR 0.06 m each side for O_BACKSTAIR (clear 0.62 m).
  chain6: house run → keep only collision.glb → probe4 + Low playthrough. (chain4's Low/Medium playthroughs ran with
  fix 1 only — informative, not the gate proof.)
- Low playthrough with fix 1 (08:2x–08:47, scratch/blc/pt-low/low-report.json): **reached the ending** — ended=true,
  B13, C0…C7 all played, deaths 0, console errors 0, exceptions 0, wall 143 s, B10 in 9 s. One B10 UNSTICK remains at
  exactly the width pin (8.42, 10.72, 0.82) → k_center; fix 2 (JAMB_CLEAR) targets it (chain6 re-proves).
- Item 4 look (Low playthrough shot low-05-armoire-slats.jpg, new upper bakes): the hide view is near-black — the
  console candle (0.32, 1.42) is 3 m south of and outside the westward hide view. MOVED the key candle (layout,
  validate 0 errors): P_CANDLE_LANDING / L_CANDLE_LANDING onto the gallery's SE newel cap (1.2, 4.6, 5.27; flame
  5.43), 12 W ≈ 1 cd 1850 K (a full candle, like L_CANDLE_HALL) — dead ahead of the hide eye at 1.9 m.
  Needs props + upper_hall rebake → final consistent rebuild (chain7).
- Queue: chain4 (running: redundant bakes + Medium run with fix 1) → chain5 (corridor extras, arms 12k gloves, arm reviews) → chain6 := chain7.sh (props+house --force, all 7 dev bakes, --check, probe5, Low + Medium playthroughs, Medium looks).
- Medium playthrough with fix 1 (08:51–09:03, scratch/blc/pt-med): **reached the ending** (ended=true, B13, deaths 0,
  console errors 0, exceptions 0, wall 179 s). Dev bakes ground 170 s, parlor 29 s, kitchen 29 s, car 21 s ok.

## Restart 3 (09:33)
- chain5 was cut at 09:03 (it was waiting on the Chrome lock held by the r3-review lane, then the restart killed it).
  Re-queued chain5 + chain7 as scratch/blc/chain8.sh → chain8.log (waits for the Chrome lock; no other Blender).

## Restart 4 (09:37)
- chain8 died at 09:36 (restart) after corridor ok (check_house ok, corridor extras fixed). Re-queued the rest (arms characters/anims/reviews + chain7) as scratch/blc/chain9.sh → chain9.log (nohup, detached).
- 09:42 characters(arms) ok 315 s (12k-tri gloves).
- 09:48 arms(12k gloves)+anims ok; --check low 26.07 / medium 48.32 / max 66.37 MB (only problem: stale house failure, re-run in chain7).
- Arms look v2 (scratch/blender-realism/c_arms_dim_v2.png, c_arms_car_v3.png): torch barrel now visible, wheel grips
  read; BUT the torch-hand close-up shows regular double "bamboo" rings round every finger joint and no perforations
  on the finger backs. Cause: tex_arms finger frame `ref = cross(l, u)` is a pseudo-vector → on the mirrored (left,
  torch) hand theta=0 was the PALM, so the pad-side double flexion folds landed on the finger backs. Fixed (ref
  flipped to the dorsal side on both hands). Rebuilding arms → c_arms_dim_v3 (scratch/blc/chain10.sh, queued on the lock).
- 09:59 chain7: props ok 386 s, house ok 252 s (check_house passes now), collision md5 d653b65a… on all tiers (JAMB_CLEAR in); dev bakes running.
- 10:11 all 7 dev bakes ok against the consistent props+house set (ground 30 s, parlor 188 s*, kitchen 189 s*,
  upper-hall 50 s, … ; *incl. waiting for the r3 lane's Chrome lock). --check ok: low 26.10 / medium 48.43 /
  max 66.47 MB. probe5 + playthroughs running.
- 10:22 arms v3 (scratch/blender-realism/c_arms_dim_v3.png): the ref fix works — torch-hand close-up now shows the
  perforated finger backs, broken knuckle wrinkles and the pad folds on the palm side; no more bamboo rings; reads as
  brown leather driving gloves at close range. arms.glb/anims rebuilt (characters 10:15, anims 10:18).
- 10:33 validate-layout 0 errors (26 warnings); npm test 200/200.
- 10:43 probe5 starved on the Chrome lock by the r3-review lane's shot runs (waiting since 10:11).

## Restart 5 (11:00)
- chain7 still alive (pid 72286), its probe5 (pid 78130) still queued on the Chrome lock — the r3-review lane holds it
  with back-to-back shot runs (3 queued). Left it running: probe5 → Low + Medium playthroughs → Medium looks.

## Restart 6 (11:07)
- chain7 (pid 72286) alive; probe5 still queued on the Chrome lock (r3-review lane shot runs). Waiting; no new Blender work needed — items 2,3,6,7 done, 4/5 analysis+bakes done, 1 awaiting the gate proof.

## ART-DIRECTOR REVIEW (round C, 11:1x) — reviewer lane A
- Gloves (c_arms_dim_v3.png, 0.4 m close-up): leather sheen + knuckle creases + back seams read as leather. FAULTS: perforation
  dots tile the full length of every finger at one even pitch (driving gloves perforate only the back panel/finger backs,
  irregular) → reads "rubber grip", not leather; fingers are constant-diameter tubes with no taper to the tip; the
  bottom-left pose has a flat outstretched thumb (gun pose). Verdict: PARTIAL.
- road-rc9 identity (independent, meshopt-decoded vertices, scratchpad roadchk.mjs): rc9_paint identical on all tiers
  (md5 0728818f, 1972 v). rc9_road Medium = Max (19ee8855, 9842 v) but Low differs (4067 v — Low is decimated), so
  "identical on all tiers" is NOT literally true. All Low verts that coincide with Medium (2706) agree to < 1 cm except
  8 at the outer clearing edge |n| = 9.5 (≤ 6.3 cm). Medium cross-section columns sit exactly at the JSON widths
  (asphalt ±3.5, shoulder ±4.7, backslope ±9.5) on segment A (y = -33). Verdict: claim HOLDS for asphalt/shoulder/paint
  (the drivable surface); off-road verge simplified on Low only — acceptable.
- Held map (c_arms_car_v3.png panel 6, arms_map @3.6 s): FAIL. No map in the review stand-in (can't judge the hold),
  left hand floats palm-up, and the right hand points straight down the view ray (Rpt y-axis ≈ eye→map) so the back
  of the glove + cuff fill a third of the frame 0.24 m from the eye. The map sequence render (c_arms_map_v1) never ran.
  Runtime doesn't use arms_map yet (c1-empty.ts still the fallback camera), so it is not in-game. Fixing now.
- Facade in game (pt-med/med-02-facade-gate-flash.jpg, 09:01, Medium): upper storey reads as blotchy white/black
  patchwork (peel mask far too contrasty, bare wood 0.12 near-black vs paint 0.42) → stone/brick, not lap siding;
  "flash" frame shows no lightning (flat, no hard window shadows). Clay geometry (c_siding_mid.png) is correct lap
  siding. Runtime material + material-spec params owned by the materials lane → request stands. Grass field: saturated
  green carpet with dark rectangular blotches, reads tiled/low-res at 10–30 m; shrub row right of the house = black
  tyre-like lumps; the orange figure right of the path is far too saturated for 0.03 lux moonlight.
- FIXES IN FLIGHT (reviewer): (a) clips_arms.py map_read: index now comes up at the sheet from below-right (Rpt
  y=(-0.35,0.40,0.85)), review_arms_car.py gets a 0.34x0.24 m folded map card on prop_l → scratch/blc/rev1.sh
  (anims arms + c_arms_map_v2). (b) tex_arms.py perforation: proximal segment only, 3.4x3.0 mm grid → rev2.sh
  (characters arms + c_arms_dim_v4 + --check).
- 11:22 restart 7 (reviewer): rev1 done (anims arms + c_arms_map_v2 rendered 11:18); rev2 running (characters arms). chain7 Low playthrough pt3-low started 11:18.
- 11:25 Held map v2 (scratch/blender-realism/c_arms_map_v2.png): index now comes up from below-right and touches the
  sheet; back of glove no longer fills the frame. Left hand reads as laid flat on the left edge (fingers in front of the
  sheet, no visible thumb/pinch) — still not a convincing grip. Verdict: PARTIAL (improved; not used in-game yet).
- 11:25 probe5 (Low, B10, dist-blc 11:16 with both collision fixes, md5 d653b65a): probe walks still stop at y≈10.8
  (miss 0.40, same as probe3) — the probe's targets sit inside the stair volume (z 0.6 under step 1), so the probe is not
  a pass/fail signal; the Low playthrough pt3-low (queued behind rev2) is the gate.
- 11:30 Gloves v4 (scratch/blender-realism/c_arms_dim_v4.png, rev2: characters arms 393 s, --check ok low/med/max,
  max 66.41 MB): perforations now only on the proximal finger segments in a fine grid → reads as a perforated leather
  driving glove at 0.4 m, knuckle creases + back seams + snap cuff good. Torch grip panel: fingers wrap the barrel,
  barrel + bezel rings visible beyond the fist. Remaining: fingers still near-constant-diameter (little tip taper);
  bottom-left pose flat thumb. Verdict gloves: PASS with minor (taper). Torch hold (Blender): PASS; in-game look pending.
- 11:44 restart 8 (reviewer): Chrome lock held by the open-review lane (pid 92115 since 11:08); pt3-low (chain7) and
  rev3 ext looks queued behind it plus r3 jobs. dist-blc lacked the v4 glove textures (built 11:16, rev2 11:25) —
  synced public/assets/*/arms_* + manifests into scratch/dist-blc (no rebuild, assets only).
- 11:50 Clapboard root cause sharpened (read-only look at src/materials): calibration.ts gain for clapboard_peeling is
  1.66 (raw generator mean ≈ 0.22 vs avgAlbedo 0.36), so intact paint renders at 0.42 x 1.66 ≈ 0.70 (fresh-white, not
  aged paint 0.4–0.5) beside bare wood 0.12 x 1.66 ≈ 0.20 — the gain amplifies the peel contrast into the
  white/black "stone" patchwork. A spec-only change (bareWood/peel in scripts/layout/materials.mjs) would leave the
  gain stale and brighten the whole facade, so NOT done here; it must land together with a re-calibration (runtime
  lane). Request updated: bareWood [0.27,0.25,0.22] (weathered grey pine), peel 0.25, then re-run calibration so
  paint ≈ 0.45 on screen-linear.
- Facade frame also shows: the "black tyre lumps" right of the house are P_WRECK_1..6 (wreck_sedan row, 17–39 m E);
  orange figure = P_PUMP (gas_pump, 'rust') lit by the porch lantern.
