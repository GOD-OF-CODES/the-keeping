# STATUS: opening (C0 + C1) workflow

Updated 2026-10-07. Owner of `docs/C1-OPENING.md` and this file.

## Done
| Item | Change | Evidence |
|---|---|---|
| Cinematographer-designer spec | `docs/C1-OPENING.md` written. It supersedes CUTSCENES-PLAN §3 C0/C1 and covers: the diagnosis of the current C1, the RC9 corridor geometry (analytic, 1550 m), the C0 shot list (30 s), the C1 shot list (75 s), lighting with photometry, the exposure table, the Blender asset spec with node names and budgets, the runtime tasks, voice, the faces audit, and requests for the lead. | Lead frames reviewed: `scratch/lead/c1-now-01/02/03/05`. Corridor coordinates computed by script (scratchpad `road.mjs`; the formulas are in the doc's §2). |

## Key findings (before numbers)
- **Interior framing.** `sedan_interior` has its headliner at z 1.15 above its floor. `DRIVER_EYE` (z 1.12, a road-relative height) puts the camera at the roof.
- **Headlights.** Layout 3000 W at 4200 K × 0.6 / 4π = 143 cd, against ≈ 15 kcd for a real low-beam hot spot. There is no beam pattern.
- **Download budget.** Low has 1.39 MB of headroom (23.61 / 25). This spec adds ≈ 1.10 MB plus voices; the fallback ladder is in the doc's §6.5.
- **Meshopt cost.** Measured 17.4 B/tri on Max and 19.8 B/tri on Low (props_m1).

## Not done (by design: this round edits no src/**, runs no Blender, commits nothing)
- Lead approvals: layout (RC9 room, props, lights, CAR ceiling), `road-rc9.json`, the interior frame change, 3 voice lines, the Low budget, the air-freshener substitution (St Christopher medal). See `docs/C1-OPENING.md` §10.
- Blender build: `docs/C1-OPENING.md` §6.
- Runtime integration (next round): `docs/C1-OPENING.md` §7.
- Verification frames: `docs/C1-OPENING.md` §11.

## Blender build (lane A), round 1 (2026-10-07, in progress)

### 1. `sedan_interior` v2: built, exported, LM_CAR dev-baked
| Item | State | Evidence |
|---|---|---|
| Generator | `blender/props/sedan_cabin.py` (registered in `registry.FAMILIES`), old generator removed from `sedan.py` | `props` job ok, `check_props` ok (UV0 metric 1.007) |
| Frame | car space, z 0 = road, nose +y; `DRIVER_EYE` (−0.35, −0.05, 1.12) unchanged, headliner 1.31 | review metrics below |
| Fit to the exterior | Glass edges, pillars and roof from `sedan.Body` sections: B-pillar y −0.305..−0.185 (spec said −0.62), front door glass −0.185..0.675, rear −1.105..−0.305, backlite −1.655..−1.305. Windscreen widened to 75 mm inside the side-glass line (the exterior band-9 opening is only ±0.45 m; from inside its paint band is back-facing = culled) | `scratch/props/cabin/*.png` |
| Triangles | Max/Medium 45.1k (budget 60k), Low 37.2k; lightmapped 21.9k (shell 12.4k + seats 9.6k) | props_m1 node table |
| Probe-lit splits | `shell_details` (`probe_lit`: chrome/black plastic/rubber/woodgrain trim) and every `dressing` node: no LM islands, Low decimates them. `lightmap.py` SKIP_KEYS += `dressing`, `lens`, `probe_lit` | `.cache/props/lightmap.json` LM_CAR: 395 islands, 152 texel/m |
| POV acceptance (24 mm, 9° down, 2.39:1 band) | windscreen 55.7 %, headliner 0 %, cluster 5.3 %, rim 4.1 %; 1 back-face hit in 9216 rays | `scratch/props/cabin/metrics.json` |
| Review passes | 3 look→improve rounds: (1) glass width / A-pillar slab, (2) flipped lofts, dash end caps, recess walls, (3) dash-top grille + stitched seam, carpet kick strips, chrome trim, pleat aliasing, woodgrain strip, seat welts, flashlight pose | `blender/props/review_cabin.py`, manual job `cabin-review` |
| LM_CAR | dev bake (1024, 64 spp) + encode; lm_car Max 1.84 MiB, Medium 0.95, Low 0.08 | `bake-house-car` ok |
| Exterior `sedan` additions | `-cabin_lo` (split of the low cabin), `-light_low_l/_r`, `-light_hi_l/_r` (extras `aim_local` [1,0,−0.026] node-local, `aim_car` [0,1,−0.026]), `-tail_l/_r` (3-chamber ribbed lenses, `lamp:'tail'`), `-hood_steam` | props_m1 |

### Side effects to know
- The six other dev bakes are **stale** (their input `.cache/props/props.blend` changed) but their content is unchanged: no static prop outside room CAR changed. `house` was already stale from another lane's `floor_varnished` edit.
- `scripts/layout/materials.mjs`: ported that uncommitted `floor_varnished` edit (so rebuilding the layout keeps it) and added 14 opening material ids (existing families only).

### 2. RC9 corridor: exported (restart found it done, review pending)
| Item | State | Evidence |
|---|---|---|
| Generator | `blender/house/corridor.py` + `road_rc9.py` + `pines.py`; jobs `corridor`, `corridor-review` (manual) | `.cache/corridor/corridor.json` |
| Output | details_corridor.glb Low 0.28 MB (1387 trees), Medium/Max 0.85 MB (2325 trees, L0 101 / L1 709 / L2 1488), 33 poles, 27 snags | public/assets/*/details_corridor.glb |
| Review renders | `scratch/opening/corridor_{pov,walls,aerial,edge,dark,sheet}.png` | |
- Corridor review notes (to fix after the props): foliage plates read as smooth stacked caps (no edge break-up), understory clumps are isolated "cabbages", trunks uniform; the edge review at s 300 shows L1 (not a hero zone). The Blender preview colours bark_wet/pine_needles as flat tan: material approximation, not geometry.

### 3. Roadside props: plumbing done (restart point)
| Item | State | Evidence |
|---|---|---|
| Layout | room `RC9` (kind `set`, floor exterior, rect [70,−420,1500,−10], atlas LM_EXTERIOR listing only, playable false, no gameplay room lists it), acoustic zone asphalt; `scripts/layout/rc9.mjs` = JS port of `road_rc9.py` (landmark positions match §2 to 0.1 m) | validate-layout 0 errors |
| Library | `build_props.py`: placements in room RC9 → `props_road.glb` (all tiers); pipeline.json outputs added | props job ok (352 s) |
| Placed | `P_RC9_NEXT_SERVICES` (road_card `hero`: 2.4×1.2 sheeting on 4×4 posts, bottom 2.1 m), `P_RC9_CR9_A/B` (new `county_shield`, family `blender/props/roadside.py`) | props_road.glb 33 KB |
| Sizes after | Low 24.67 MB (props_m1 +0.59 from cabin v2, props_m2 +0.155, corridor +0.27, road +0.03) — **0.33 MB headroom left on Low** | manifests |
| Runtime decal style needed | `county_shield` (blue pentagon, yellow border, text "COUNTY|9" = two lines) — src/world/decals.ts returns null for unknown styles | |
| `billboard` (`P_RC9_BILLBOARD`, s 930 n −15, yaw 2.11) | 7.6×3.7 plywood face (18 sheets, some bowed back), 3 creosoted poles, back frame, catwalk (one plank missing), 4 dead RLM gooseneck lamps (one lens gone), service ladder, 24 torn wet strips + 5 fallen sheets in child `billboard-peel` (`flutter`; runtime: weight flutter by height so the fallen sheets stay put); decal style `billboard` (2 layers: "58 · CARVEL EXIT 4 · EAT · SLEEP · GAS|STROUD'S · ROOMS ½ MI"); 4.5k tris | 3 review passes, `scratch/opening/road/billboard_*` (new manual job `road-review`, `blender/props/review_road.py`) |
| `diner` (`P_RC9_DINER`, s 700 n 24, faces the road) | 12×8 m, 3.6 m roof + parapet with coping, clapboard with modelled laps (front every 0.1 m, sides 0.2), 4 boarded bays (sprung corners, decal CLOSED `hand_lettered`), aluminium door (cracked glass, CLOSED card `sign_painted`), stainless fascia band, sagging torn tin awning (`@2s`), swamp cooler, vent stack, downspout (foot broken off), pump island ×2 with anchor bolts and a broken bollard, gravel lot to n 9.5 + puddles, culvert apron over the ditch (2 pipe ends); child `diner-payphone` (`no_handset`, cord cut); ≈11.9k tris | 3 review passes (clay/night) `scratch/opening/road/diner_*` |
| `eat_sign` (`P_RC9_EAT`, s 688 n 11.5, double-faced, square to the road) | 7 m pipe, dented rust can 2.6×1.1×0.35, E-A-T 0.9 m in Ø12 mm `glass_grimy` tube on standoffs, both faces; children `eat_sign-neon` (extras `neon`, `neon_color`, `lit:false`) / `-neon_back`; 956 tris | review `eat_sign_*` |
| `logging_truck` (`P_RC9_TRUCK`, parked at s 1400 n −1.75 facing east; its C1 S5 track moves it) | 21 m: long-nose tractor (crowned 2.3 m hood, chrome grille + bent bumper, fenders, fuel tanks, day cab 2.4 wide/roof 3.0 with an empty black shell, west-coast mirrors, visor, twin stacks, headache rack), reach pole, 2 bunks with stakes, 3 binder chains, 14 logs 5-4-3-2 (pale end caps, child `logging_truck-logs`), mud flaps; 5 spin nodes `logging_truck-axle_1..5` (part `wheel`, `spin_axis` [1,0,0], `radius` 0.52; 18 tyres); lamps `-hi_l/_r` (`lamp:'head'`, `beam:'high'`, 1500 lm, 3300 K, `aim_local`), `-clearance` (5 amber), `-markers`, `-tail`; anchors `-spray_l/_r`; ≈14.7k tris | 3 review passes `scratch/opening/road/logging_truck_*` (fixes: tyre normals via closed lathe, stack caps, windscreen transform) |
| `deer` ×3 (`P_RC9_DEER_1..3`, s 198/205/212 n 12.5–13.5, facing the road ±; params `headYaw` 0 / 0.35 / −0.7, `pose`) | whitetail doe 1.6 m nose–tail, shoulder 0.95: lofted trunk (deep chest, haunch), jointed legs + cloven hooves, neck, flat tail, child `deer-head` (pivot at neck top, extras `head_yaw` = the runtime turns it, so the three share one mesh), cupped forward ears (`@2s`), anchors `deer-eye_l/_r` (0.1 m apart, ≈1.16 m, `eye_glint`); 1.1k tris | 3 review passes `scratch/opening/road/deer_*` |

### Restart 2 (22:31): state found
- props job 22:20 exported props_road.glb (Low 0.52 MB, Max 0.69 MB) but `check_props` failed: `deer-head` NaN area (3 prims × 3 deer). `--check`: Low 25.13 / 25 MB (over). Fixing both.
- Fix: deer head extras `head_yaw`/`pose` were shared across the 3 does (instance_keys share nodes) → now `turn_joint:'neck'`, `yaw_param:'headYaw'`, root `pose_param:'pose'`; runtime reads the root `params`. Low: `build_props.low_lod` honours per-part extras `low_ratio` / `low_min_tris`; set on billboard 0.25, diner 0.2, truck 0.25, logs 0.3, axles 0.2 (min 600). Re-running `props`.
- Added `sedan.driver_proxy` (§6.2) in `blender/props/sedan.py` `_driver_proxy` (hero `sedan` only, not wrecks): torso loft, ovoid head + flat cap (no face), forearms to the rim, lap; `cloth_dark`; extras `hide_in:'pov'`, `driver`, `faceless`, `probe_lit` (no LM islands, so no atlas change). Needs a review render after the props job.
- props run 22:34 (before the proxy edit): check_props 0 failures (deer fixed); props_road Low 515 → 370 KB; `--check` Low 24.99 / 25. Further Low trims: billboard-peel 0.4, payphone 0.35, deer 0.6, proxy 0.5. Re-running `props` (adds the proxy).
- props run 22:42: 0 failures, proxy in (Low 438 tris), but Low 25.02 (props_m2 drifted +34 KB, cause unknown; m2 is +198 KB vs HEAD: wreck sedans now carry the tail lenses/cabin_lo split). Ladder step 4: `shell_details` Low ratio 0.32. Re-running props, then `road-review` on `sedan` (proxy).
- Corridor review r2 (look at `corridor_edge.png`: L1 crowns read as boxes, understory as crystals, L1 boles square): `pines.py` new `_skirt` (ragged star-rim drooping cone, 4·points tris) replaces the ellipsoid plates on L0 (8 points, 3 plates/tier) and L1 (7 points, bole 5 sides); understory = young pine (3 whorls on a leader) + low brush spray. L2 unchanged. Pending: `corridor` + `corridor-review` runs.
- props run 22:5x: Low 24.97 / 25 (check ok). Proxy review r1 (`road/sedan_clay_side.png`): the proxy sat OUTSIDE the door, untransformed (build_car turns its parts nose -y before `sedan()` adds the proxy) and the torso was inside-out → `d.apply(same turn)`, `flip=True`. Queued: props + road-review (sedan, framed on the cabin) after the corridor jobs.
- Corridor review r2 result (22:57, `corridor_edge.png`): tiered pine silhouettes now read, sizes unchanged (Low 24.97); but sprays are paper-thin stars, saplings too small, far wall (L2 ellipsoids) still blocky. r3: thicker skirts (apex 0.95 rz, underside 0.45 rz, +12 % reach), L2 = two ragged skirts (≈52 tris), saplings 1.6 m. Queued corridor + corridor-review after the sedan jobs.
- props run 23:0x: Low 24.98 / Medium 43.92 / Max 61.26, check_props 0 failures. Proxy r2: glTF bounds lateral 0.08..0.62, height 0.56..1.25 (roof 1.37), fore -0.29..0.44 (rim at 0.455) = in the driver seat. The Blender review glass is opaque, so the proxy itself is verified only numerically; look at it in-game in an exterior shot next round.
- Corridor r3 result (23:1x): `corridor_edge` now reads as layered pine sprays + saplings (pass); `corridor_aerial` shows the canopy blanket as smooth bald hills with a cliff at n 250. r4: crown pits (28 % of verts −3..6 m), denser outer columns, fall-off to ground at n 330. Re-running corridor + review.
- `validate-layout`: 0 errors. `npm test`: 190 pass / 2 fail, both in `tests/materials-library.test.ts`: the material count (84 ≠ 68, i.e. the 14 opening ids plus earlier additions) and no calibration entry for `vinyl_dash_black` (regenerate `__matlab.calibration()`, which is src/** work). For the lead / runtime round; not fixed here (no src/** edits).
- Corridor r4 result (23:3x): the blanket's edge is now a slope and its surface lumpier; Low 24.98 / Medium 43.96 / Max 61.30 MB, `--check` ok. Still open (runtime/material, not geometry): in the Blender preview the lowered blanket under the crown band (n 54–104) reads as a pale clearing between the tree rows, so `canopy_far` must render as dark as the `pine_needles` crowns at runtime (check in the C0 aerial). The pale trunks are the Blender preview of `bark_wet`.

### Round state (end of this attempt)
- Done: cabin v2 + LM_CAR, sedan additions incl. `driver_proxy`, corridor (4 review passes), billboard, diner, EAT sign, NEXT SERVICES + county shields, logging truck, deer; `props`, `corridor` exported; `assets --check` ok.
- **Low is at 24.98 / 25 MB.** The 3 voice takes (≈0.14 MB) and 5 arm clips (≈0.10 MB) will NOT fit: the lead must raise Low (e.g. 27 MB) or approve further cuts (the next candidates are the rear seat, which is lightmapped and so can't be decimated, and the Low wreck sedans in props_m2, now +198 KB vs HEAD).
- For the runtime round: `county_shield` decal style; deer read `params.headYaw/pose`; `low_ratio` extras are harmless at runtime; the six dev bakes other than LM_CAR are stale (inputs changed, content unchanged): `npm run assets` will re-bake them.
- Correction: the deer NaN was a STALE export (the 22:20 GLB still carried `extras.pivot`, reserved by GLTFLoader; the source already used `turn_joint`). The shared-extras change above is a separate fix (per-deer `head_yaw`/`pose` were lost to node sharing).
- Low overrides measured: `shell_details` 5614 → 3992 tris (collapse can't merge the many small chrome/trim pieces further); deer 872 → 522. The hero cabin at Low has had no review render since: look at it in-game (Low preset) next round.
- props_m2 Low +6.8k tris vs HEAD = the wreck sedans inheriting the hero's `_lamp_nodes` (10 tail lenses × 344 tris) + the cabin_lo split. `_lamp_nodes` now runs for the hero sedan only (`opts.hero`). Re-running props.
- props run (hero-only lamp nodes): check_props 0 failures; **Low 24.88** / Medium 43.86 / Max 61.20 MB, `--check` ok. Still short of the ≈0.24 MB for voices + arm clips: the lead decides.
- Runtime note: `P_CAR_ROW` (the hero sedan in the M2 wreck row) also carries `-driver_proxy` (same generator): the runtime must keep it hidden there, and on `P_CAR_GATE` show it only in the C0/C1 exterior shots.

## Art-director review (round 1, 23:28)
- Started: reviewing builder renders; Blender/Chrome busy check: a b08-review shot.mjs run is active (wait for it).
- Look 1 (builder renders, preview materials): `cabin/dash_pov` framing now correct (dash, cluster, rim, lit road; 0 % headliner) = PASS for framing, NOT photographic: rim a smooth torus, dash top a flat slab, everything CG-clean. `cabin/dome_map`: seat/console are soft blobs with no pleats/seams, cup a plain cylinder, receipts flat cards = NO. `road/logging_truck_night_front`: silhouette reads (long nose, stacks, bunks) but grille = flat bars, bumper a slab = NO (OK at the 1 s pass-by). `road/diner_night_front`: reads as a generic white box, boarded windows not legible from the front = NO.
- `corridor_aerial` (C0 crane): FAIL, the biggest C0 problem. The instanced forest is a ~100 m strip (crown band to n ±100); beyond it the `canopy_far` blanket reads as smooth bald grassland hills under the flash (no crown texture), so the shot says "tree-lined road in open hills", not "endless forest". `billboard_night_front`: blank white face with paper flaps, no faded print, no rust/stain = NO (needs the runtime decal/print). Medium corridor = 853k tris all instances (C1 §6.6 estimated 0.15 M for the aerial; real ≈ 0.85 M if not culled).
- Plan: (1) far-crown layer: cheap instanced crown cones (≈8 tris) n 100 to 300 over the blanket on Medium/Max so the aerial reads crown-by-crown to the horizon; (2) in-game load check when Chrome is free; (3) cabin dash/dome shot renders.
- Cabin geometry check: pleats (seats, door cards), two-spoke wheel + horn bar, map_folded/map_open nodes all exist in `sedan_cabin.py`; the "blob" look in `dome_map` is mostly preview material + soft 120 lm light. `dome_pov` (dome on): believable dim warm cabin, but the rim reads thick/uniform and the cluster lens carries a hot specular = acceptable, not photographic. Cabin verdict: framing YES, geometry adequate, photographic finish depends on runtime materials (vinyl grain, dust, glass smears) = runtime round.
- In-game check launched: `shot.mjs --preset medium --scenario scratch/lead/c1.mjs --dist scratch/dist-opening-review --out scratch/opening-review` (waits for the b08 Chrome).
- Aerial diagnosis verified: preview uses spec albedo (canopy_far 0.02, near black), yet the blanket still reads pale because a smooth Lambertian sheet facing the flash has no self-shadow, while crowns do. Geometric, so it also happens in-game. Fix: extend the instanced L2 crown band outward.
- Edit: `corridor.py` outer crown band (L2, 10.5 m spacing, scale 0.9-1.3, n 100-190, Medium/Max; blanket lowered under it; `OUTER_N`). Running `corridor`.
- corridor run ok: Medium/Max details_corridor 875 -> 902 KB, all-instance tris 853k -> 982k; manifests Low 24.88 / Med 43.89 / Max 61.23. Running corridor-review (aerial, dark).
- corridor-review r5 (aerial): crown-by-crown texture now runs to n ±190 both sides; the strip-in-bald-hills read is gone in the central 2/3 of frame. Remaining: frame edges past n 200 still show the smooth blanket/terrain as pale hills = runtime fog/darkness must swallow them (or a further band; budget). Medium all-instance tris 982k: the C0 aerial needs chunk/distance culling or it costs ~1 M tris (C1 §6.6 estimated 0.15 M) = runtime task.
- In-game load (`shot.mjs` medium/webgpu, `scratch/lead/c1.mjs`, dist-opening-review, built before the r5 corridor export): **0 console errors, 0 warnings, 0 exceptions**, load 70 s, GPU 45 ms/frame (headless). Shots `scratch/opening-review/c1rev-0*.jpg`.
- In-game c1rev-01 (4 s, cluster insert): readable gauges + E fuel needle = good; but the wheel rim and dash top carry a giant cartoon crack/craze pattern (cells ≈ 5-8 cm on a 28 mm rim, dark-grey rim, orange "cardboard" dash top) = NO, runtime material scale (car_interior `dashCrack`/`sunCraze` must be world-scaled and ~10x finer, rim should be smooth worn plastic, no cracks); the fuel lamp is a big round bloom disc = NO (should be a small amber icon with a tight glow). c1rev-04 (flash, still the OLD C1 at the gate): house lightning reveal good; hood at right shows a hex-tile pattern (wrong material/UV on the hood) and blob hands = NO. These are runtime (src/**) items: the new cabin/opening isn't integrated yet.
- review_road.py: new passes `moon` (moonlight only, `moon_expo`) and `own` (moon + the prop`s own lamp:head nodes as spots from `aim_local`/`lm`/`kelvin`) and `hide_glass`. Running road-review (truck/diner/billboard/sedan × own,moon × front,low).
- r1 of the new passes: driver_proxy SEEN (sedan_moon_front with glass hidden): sits in the driver seat, cap + shoulders + arms to the rim = PASS as a faceless silhouette. hide_glass also hid whole meshes that carry a glass slot (sedan body, diner building) -> now per-type list. Truck lamps were placed at the mesh origin -> now lens centroid.
- Re-verified: `assets.mjs --check` ok (Low 24.88 / Med 43.89 / Max 61.23); `validate-layout` 0 errors, 24 warnings.
- Deer: clay side = believable doe silhouette (hind hock, raised head, ears forward) = PASS for the treeline eye-glint shot at 12+ m; NO up close (box legs, stiff tube neck; `deer_night_close` camera sits inside the body). Not in the plan to show it closer than the headlight edge.
- EAT sign: letters are bent-tube outlines on a flat box = reads; no rust streaks/missing tubes/bird mess at preview level = runtime material. OK for a 2 s passing glimpse.

### Art-director verdict (photographic yes/no) and ranked remainder
| Item | Photographic? | Why |
|---|---|---|
| C1 POV framing (Blender `dash_pov`) | YES (framing) / NO (finish) | dash, cluster, rim and the lit road all in frame, 0 % headliner; surfaces CG-clean |
| Cabin under dome light | NO, close | geometry is rich (pleats, two-spoke rim, map, cup, cassettes) but the finish is preview-flat; needs runtime vinyl grain, dust, smudged glass |
| In-game cabin today (old C1) | NO | cartoon crack pattern on rim + dash, bloom-disc fuel lamp, hex-tiled hood, blob hands |
| Low-beam road (Blender) | YES-ish | cut-off pool + hot spot read; in-game still the old "two bars, black road" until integrated |
| Corridor edge (POV) | YES at speed | layered drooping pine sprays |
| C0 aerial | NO -> improved | the instanced band now runs to n ±190 (was ±100); pale smooth blanket remains at the frame edges |
| Logging truck | NO close / OK at 1 s | silhouette right; grille bars and bumper slab too clean |
| Diner | NO | a white box; boards/EAT readable only side-on; needs grime, broken glass, weeds at runtime |
| Billboard | NO | blank white face: needs the faded print + rust streaks (runtime decal) |
| Deer | YES at 12 m+ / NO close | silhouette fine; box legs |
| driver_proxy | YES (silhouette) | seated, faceless, cap, arms to rim |

Ranked remainder (art): 1) integrate the new cabin + its camera in C1 (runtime; the user's complaint is still live in-game); 2) runtime car_interior crack/craze scale (~10x finer, world-scaled, none on the rim) and a small fuel-lamp glow; 3) C0 aerial: fog/darkness must kill the far blanket, cull by chunk (Medium ≈ 0.98 M tris all instances); 4) billboard print + diner grime decals; 5) truck grille/bumper detail if the pass-by is slowed down; 6) deer legs only if shown closer than ~10 m.
- road-review (own/moon passes, `scratch/opening/road/*_own_*`, `*_moon_*`): truck in its own 1500 lm high beams (lamps found at ±0.82, -10.3, 1.22, aim -y) throws a correct hot pool ahead; silhouette right, clean surfaces (verdict unchanged). Diner in moonlight (exposure 30): a low dead roadside box with awning and lot debris reads at a glance; the lot slab is a pale flat sheet with hard edges = needs cracks/weeds/puddles (runtime decal/material). Billboard moon: unchanged verdict. `road_review.builder.json` keeps the builder's config.
- In-game rerun with the r5 corridor (dist-opening-review rebuilt, details_corridor 902 KB shipped): **0 console errors, 0 exceptions**, 1 warning (shader compile > 20 s, headless contention with the other lanes' Chrome), load 195 s. Shots `scratch/opening-review2/c1rev2-0*.jpg`.

### Runtime tasks for the next round (from this review, in addition to the builder's list)
1. Integrate the new `sedan_interior` v2 + the §5 C1 camera (POV eye, 9 deg down) and the halogen cut-off beams; hide FP arms in exterior shots.
2. car_interior material: world-scale `dashCrack`/`sunCraze` ~10x finer, none on the rim (worn smooth plastic); fuel-lamp glow = small amber icon, not a bloom disc; fix the hex-tile pattern on the hood (wrong material/UV).
3. C0 aerial: chunk/distance culling of `rc9_*` instances (Medium all-instance tris 982k) and fog/darkness that swallows the blanket past n ±200; `canopy_far` as dark as the crowns.
4. Decals: billboard faded print + rust streaks; diner lot cracks/weeds; `county_shield` style.
5. Show `driver_proxy` only in C0/C1 exterior shots on P_CAR_GATE.
- Cabin renders were STALE (18:47, sources edited 22:48/23:22). Added `map_hold` to review_cabin.py (lifts map_open to a held pose) and re-running cabin-review (dash+dome × pov+map, 16 spp).
- Fresh cabin-review (00:15, current sources): dash_pov unchanged from the stale set (verdicts hold). Dome_pov at the §5.2 dome exposure is still nearly black except the rim: 120 lm in a cabin gives tens of lux on the seats, so the exposure the C1 plan sets for the dome beat is too low for the user's "lighter build inside car" = runtime/look task (eye adapts to the dome: raise exposure ~3-4 stops over 1.5 s so vinyl, map, cup, visor photo read warm and clear). The held map (`map_hold`) lands as a pale sheet right of the rim: the held pose belongs to the arms socket at runtime; the map with its drawn route is still UNVERIFIED in any render. Builder's config kept in `scratch/props/cabin_review.builder.json`.
- Not re-run by this review: `npm test` (builder: 190 pass / 2 fail in tests/materials-library.test.ts, out of lane). Low tier: shell_details 0.32 decimation still unseen; Low has no crown bands (`crown_placements` returns [] on Low), so the Low C0 aerial is the old strip-in-bald-hills and must rely on fog/darkness (no Low budget for geometry).
