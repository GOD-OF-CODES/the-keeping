# STATUS — props lane, round D (props finishing auditor)

Task: audit-only (no building). Deliverable `docs/PROPS-FINISH-AUDIT.md`; dist `scratch/dist-pa`.

## Log
- 2026-10-08: started (fresh; no prior status file). Orientation: PROPS.md, ROADMAP props-finishing ruling.
- Finding 1 (GLB scan, `scratch/props-audit/facet.mjs` → `facet.json`): no prop GLB carries COLOR_0 or any mask
  attribute → zero geometric wear/cavity/AO masks; all wear is tileable material-space noise. Shallow-angle normal
  splits (2–35°, = visible faceting) worst: bell_pull_embroidered 24%, nightstand doors/drawer 54–57%, sign_post 22%,
  bolt_box 20%, claw_hammer 17%, mailbox 15%, washstand doors 53%, iron_stove oven door 96%, coat_hooks 88%,
  sedan/wreck headlights 93%, sedan_interior seat_front/glovebox/ashtray 100% (runtime toCreasedNormals band-aid only
  covers SMOOTH_IDS in src/world/opening.ts). Root: blender/props/kit.py per-face `face_smooth` + set_sharp_from_angle.
- 13:03 launched in-game survey: scratch/props-audit/look.mjs + views.mjs (46 views) → scratch/props-audit/shots
- Finding 2 (material system, src/materials/bind.ts + baker.ts): all wear/cavity is tileable UV0-metre noise + baked
  height-cavity; no per-object curvature/AO/handling masks exist, so edges/handles/crevices cannot wear differently
  from flat faces. Up-facing dust is runtime (normalWorld.y) but only ~8 of 86 specs set dust/dustOnTop.
  Very low tri counts on close-read story props: bus_ticket 16, photo_frame 81 ea, road_card 83, letter 204,
  whetstone 252, guest_book 332, bell_crank 105 ea, hog_cleaver 588, claw_hammer 560, bell_pull_embroidered 452.
- Finding 3 (generator code, hardware keyword scan per function): no hinges/screws/nails/escutcheons/pulls at all in
  stool, sawbuck_table, rocking_chair, photo_frame, mirror_crepe, kitchen_table, kitchen_chair, iron_bed, chair_sacks,
  coat_hooks, can_shelf, guest_book, letter, whetstone, sewing_basket, balustrade_run, fireplace_mantel,
  floor_register (screws), closet_interior; nightstand/washstand/hall_table only a knob/pull (no hinges, no keyhole).
  Story-handled props (actions): pull_bell, read_ledger, take_can, take_hammer, take_locket, take_shears (+ letter/ticket
  docs); script-referenced most: rocker, car_row, dress, spring_bell, car_gate, bolt_box, vacancy_plate, pulleys.
- Finding 4 (texel density, Medium baseSize 512 / heroSize 1024 over spec tileMetres): wood_furniture_dark 5.1 tex/cm,
  wood_raw_plank 3.4, cast_iron 8.5, rust 6.4, enamel_chipped 8.5, vinyl_dash_black 10, paper_aged/brass 17,
  leather 26, car_interior_tan 20. Screen demand at 1280 px / ~70° hfov: 0.5 m ≈ 18 px/cm, 1 m ≈ 9, 2 m ≈ 4.5 →
  every furniture wood and iron surface is under-sampled 2–3.5× at handling distance (blurry, "CG" mush).
  hog_cleaver GLB uses rust/cast_iron although a baked_unique steel_cleaver spec exists.
- run1 waiting on the Chrome lock (other lanes); scenario extended with drive-7/20 shots + 5 car-interior views.
- Finding 5: hard ≥60° unbevelled splits (facet.json sharpPct) worst on handled/close props: locket 84%, bell_crank 87%, rope_pulley 81%, counterweight 77%, can_shelf 73%, stool 65%, coat_hooks 63%, bell_pull 63%, jerry_can 58%, rocking_chair 57%, hog_cleaver 54%, candle 52%, kerosene_lamp 52%.
- doc skeleton + cross-cutting X1–X6 written in docs/PROPS-FINISH-AUDIT.md; per-prop rows pending screenshots
- run1 attempt 1 hit shot.mjs --timeout 420 s while queued on the lock; relaunched with --timeout 3600
- Finding 6: low radial segment counts in generators: furniture turned legs/rails sides=6–8 (7×each), small_items tubes sides=4–6 (pencil 6, locket chain 4), bells_rope sides=4–6, lathes n=10–12 in bells_rope/furniture → silhouettes polygonal at 0.5–2 m. guest_book cover curl is disabled (`* 0` in small_items.py l.109), page grid 10×1. Text decals exist (src/world/decals.ts) — grime/stain decals do not.
- 13:39 restarted attempt: run1 had died in the lock queue (no shots); relaunched run2 (log scratch/props-audit/run2.log)
- 13:51 restarted attempt 3: run2 died in lock queue too (no dist-pa, no shots); relaunched run3 (nohup, log run3.log)
- 14:0x per-prop rows 1–10 written (pending screenshots)
- rows 11–29 written
- build-order section written; run3 got lock ~14:05, building
- run3 shots: drive-7 = aerial C0 shot (no interior visible). e1-sign-torch: sign_post a clean uniform pale plank at 1.4 m (no grain/checks/streaks, no bolts), vacancy plate blown flat white, hanger hooks plain
- pa-15 g1-table-torch (0.75 m): CONFIRMS rows 4/11/20 — guest book = two flat white planes, no page-block, no gutter, pages over-bright uniform; candle a clean white stick, no melt/soot; table top a flat uniform slab, no wear/rings, edges razor. pa-10 e2-bellknob unusable (camera inside porch geometry / torch blowout at 0.5 m).
- pa-21 g2-cleaver (0.5 m): CONFIRMS row 15 — blade = flat salmon-orange rust slab with a blown spec patch, no bevel/edge/rivets; sawbuck top a featureless grey plane (no grain at 0.5 m, X3). pa-30 g3-jerry (0.8 m): cans read as one continuous red box with an X painted on (no seams/handles/gaps between cans), uniform rust-red; floor planks uniform pale. Rows 8/24 confirmed.
- 14:2x audit DONE: in-game confirmation section written; unusable views noted (drive-7, bellknob, locket)
- car c-* views empty (interior only exists mounted during drive); noted in audit
- 14:03 PROPS-FINISH design started (restart-safe: doc not yet written)
- PROPS-FINISH facts: assets --check low 26.07/27 MB (0.93 headroom), medium 48.37/60, max 66.41/120. Props GLBs: medium/max props_m1+m2+road 577k verts 10.7 MB; low 7.5 MB. Blender 5.2 glTF: export_vertex_color='NONE' now (blender/lib/export.py l.28); BYTE_COLOR → COLOR_0 uint16 normalized (8 B/vert raw), FLOAT_COLOR → float. GLTFLoader: COLOR_0→'color', sets vertexColors on cloned mat (bind.ts replaces it). three vertexColor() falls back to white when absent; WebGPU unorm16 ok.
- 14:10 docs/PROPS-FINISH.md §1–2 written (vertex masks COLOR_0 'wear' RGBA, support loops, per-tier, TSL family rules)
- 14:11 PROPS-FINISH §3 (top 25 geometry + wear scalars) written
- 14:12 PROPS-FINISH §4–§8 written (decals, contract, QA, build order, requests)
- 14:14 PROPS-FINISH design DONE (426+ lines; contract §5; CONTRACT-CHANGES #59 proposed)

## Blender (props finishing builder, PROPS-FINISH §7 B1–B5)
- start: no prior Blender work in tree. Baselines: props job 386 s, dev bakes ~12 min total (7 atlases). Plan: B1 infra in kit.py Part.build (support loops + WEIGHTED_NORMAL + wear bake → 'wear' BYTE_COLOR), export override, step-1 measurement, then hero geometry by audit rank.
- B1 infra written: blender/props/wear.py (support_loops/weighted_normals/bake, SCALARS §3.2, HERO rows 1–20), kit.Part.build hooks (anchors 'wear_*' children consumed, glass/skin/hair faces masked 0), build_props: WEAR_EXPORT override (NAME 'wear') at both export sites, strip_low_wear (non-HERO on Low), --export-dir/--no-wear/--no-loops/--render; manual job props-wear-review (pipeline.json) → scratch/props-wear only. Exporter fact: NAME mode gives COLOR_0 to EVERY primitive of a mesh that has the attribute (glass in a mixed mesh gets COLOR_0 = 0) — runtime must gate by family too. step1 run queued (waiting on another lane's Chrome).
- hammer rewritten (small_items.claw_hammer: 32-seg crowned face, octagonal neck, V-slot claws, 16-side hickory-shaped handle, wedge; anchors grip+face; budget 1500→2400). Materials stay layout params (cast_iron) → lead R3.
- locket (domed shells, hinge knuckles, bail, 96 real chain links, budget 5200, low_min_tris), guest_book (cover curl, 16x12 pages + corner lift, anchors), ledger (concave fore-edge + page bands, anchors) written — untested
- shears (curved ground blades, slotted domed pivot, 24-pt bows, 3 anchors, budget 2600), bus_ticket (16x28 grid, perforation, crease, dog-ear, budget 1000), letter (diamond back flaps, anchors), jerry_can: geometry turned 90° so the narrow end faces -y (layout pitch 205 mm < 345 mm width made the 12 cans interpenetrate = audit's 'one red box'); chalk decal now 0.13x0.07 on the end face (same world facing); bead 8 sides, cap 24. → CONTRACT-CHANGES
- candle (32-seg taper/holders, 3–5 drips, 8-side drips, soot+stem anchors), kerosene_lamp (32-seg lathes, 24-knurl wheel, 12-side handle, wheel/handle/soot anchors), hog_cleaver (4→0.5 mm ground blade, tang + 2 scales, 6 brass domed rivets, hole rim, budget 3200), whetstone (1.5 mm dish, 2 chips, wooden base 6 mm lip, protect anchor, budget 1400) written — untested (Blender queue blocked by another lane's 3000 s shot.mjs)
- kit.py hardware helpers: screw_head/nail_head/hinge_butt(leaves,barrel)/escutcheon/knurl. furniture.py: segment bump (tubes 6→12, 8→16; lathes/knobs 10–12→24; add_leg n=24); nightstand: drawer box sides, lathe knob, brass escutcheon, 2 butt hinges (door leaf on door child, barrel+leaf on carcass), anchors; hall_table: drawer anchor (no escutcheon: 84 mm front too short)
- photo_frame: jute picture cord V + nail; rocking_chair: arm/crest/seat anchors; preview.render_wear + build_props --wear-tiles (beauty + edge/cavity/handled/dust emission tiles → <dir>/wear/<type>__<id>_sheet.png)
- check_props.mjs: wear contract checks (unorm16x4, no decal COLOR_0, masked prims resolve material_id, Low non-HERO has none; warns edge mean>0.25 and underside dust). wear.ENABLED defaults False; only build_props enables it (house/corridor jobs import kit.py → their outputs unchanged; --touch them if fresh at HEAD).
- bell_pull_embroidered: 8x48 strip, rolled hems, 24-seg cap + ring, 24 strands, grip anchor (budget 3000→5000)
- sewing_basket: 4 band + 1 lid swallowtail fingers along the band normal, copper tack domes, lid anchor (no carry handle: items rest on the lid)
- docs/PROPS.md 'Wear masks' contract subsection + CONTRACT-CHANGES #61 written
- segment bump also in bells_rope (17 lines; bell_wire paths kept), kitchen (5), zinc_bucket bail/grip
- dress_dummy stand: 24-seg base/pole/collar, 16-side tripod legs, knurled brass height clamp + thumbscrew (no cloth sim this round)
- can_shelf: 2 screw heads per bracket, cut-nail heads at the end brackets, 24-seg cans/jars
- vacancy_plate grommets + 12-side hems/hooks; sign_post 8 carriage-bolt heads
- mailbox flag pivot rivet
- iron_stove: fire-door soot + latch anchors, 16-side towel rail
- coat_hooks 16-side hooks
- mirror_crepe pier legs 24-seg (frame already a profile sweep)
- STEP 1 MEASURED (hammer+hall_table+jerry_can, scratch/props-wear vs base/): COLOR_0 unquantised = 8.0 B/vert after meshopt (50456 B / 6307 v) — the vertex codec does not compress free 16-bit values; support loops +6 % verts (hall_table 4248→4600 tris, hammer 1234→1378); GLB +52 % Medium, +46 % Low. Roundtrip OK: decoded values = linear(sRGB byte) exactly (byte 1 → 0.0003), i.e. linear masks survive. Fix in test: quantise to 16 linear levels (wear.LEVELS) → q16 run queued
- advisor checkpoint: door_knocker bump reverted (house doors.glb builds it); adaptive loop width (narrow faces ≥4 mm get a ring at 30 % half-width), curvature thresholds 100→400 rad/m; STATS keyed by variant; full-set scratch run + hero wear-tile renders queued (full.log)
- typecheck ok, npm test 209 pass / 0 fail (tree state 14:45)
- FULL scratch run 1 (loops on every prop) FAILED budgets: rag_rug 9k→27k, bricked_doorway 12k→45k, balustrade 9k→31k, can_shelf 8k→21k, porch 40k→71k ... Sizes: Medium m1 10.2 MB/m2 11.1/road 2.3 (vs 5.4/?/?), COLOR_0 still 8.0 B/vert even quantised — ROOT CAUSE: Blender 5.2's exporter builds COLOR_n accessors from raw bytes (primitive_attributes.__gather_attribute), never through the EXT_meshopt path (accessors.array_to_accessor). Fixes: wear.color_meshopt_patch() (wraps gather_primitive_attributes, meshopt-encodes COLOR_0 like accessors.py; props builds only — lib/export.py untouched so no job goes stale); support loops only on wear.LOOP_TYPES = HERO; bake zeroes R on verts touching a non-ring face ≥ 4 mm (no smear on unlooped props). Run full2 + hero tiles queued.
- full2 crashed in 16 s (BMFace removed: an inset replaces faces of a later coplanar group) → widths precomputed, invalid faces skipped; full2 relaunched (queued behind runtime lane's Chrome)
- full2 crash #2: bm.faces.layers.int.new() after collecting faces invalidated them → layer created first; relaunched
- FULL2 MEASURED (scratch/props-wear/full2; HERO-only loops + COLOR_0 meshopt patch): COLOR_0 1.9 B/vert after meshopt (371146 B / 196368 v; was 8.0). Medium props_m1 5.38→6.34 MB, m2 5.16→5.53, road 0.69→0.75 (≈ +1.39 MB → Medium ≈ 49.8/60). Low m1 3.80→3.57, m2 3.71→3.18, road 0.36→0.36 (Low ≈ 25.3/27 MB; HERO 51k verts keep masks, 96k stripped) — Low shrank: to verify (decimate vs custom normals). Budget overs left: rocking_chair 12572/12000, rope_cleat 1220/1200, can_shelf 12712/8000, jerry_can 3334/3000, kerosene_lamp 7504/6000, dress_dummy 18404/14000, sewing_shears 2640/2600, sedan_interior 96962/60000 (loops).
- Medium props tris m1 306k→399k (+30 %), m2 315k→354k (+12 %) (segment bumps + HERO loops); Low verts/tri 0.90→0.84–0.87 (more loop topology), Low tris m2 182k→168k. Fixes: LOOP_TYPES excludes sedan_interior/dress_dummy; budgets rocking_chair 13500, can_shelf 13500, jerry_can 3800, kerosene_lamp 8200, sewing_shears 3000, rope_cleat 1400 (justified in generators)
- LOOK 1 (scratch/props-wear/hero/wear/*_sheet.png): hammer handled at grip ✓, dust on up faces ✓; jerry edge = ribs/frame/handles ✓, cavity in panel recesses, dust on top + upward rib slopes ✓; nightstand edge = thin bevel bands ✓, dust on top/drawer ledges ✓, BUT cavity smeared down the whole carcass side (AO of 4 corner verts interpolated). Sheets cropped (512 px renders cut into 320 px thumbs). Fixes: cavity uses curvature only on verts of real faces (ray AO only on strips/bevels/small parts); thumbs 256. hero2 queued.
- LOOK 2 (scratch/props-wear/hero2/wear): hammer (grip+face handled, claw/eye edges), nightstand (crisp bevel bands, cavity now only in crevices, dust on top/ledges, knob handled), guest_book (corner handling ✓; dust on open pages → dust 0.5→0.15), cleaver (scale/blade edges, rivet cavity; grip anchor tightened r 0.065→0.05), candle (lip/puddle edges, drip crevices, saucer dust), locket (rim/chain edges, bead cavity, hinge-side handled). Proceeding to the real props build + 7 dev bakes; look 3 = in-game.
- house/corridor --touch'ed (wear OFF outside props builds; door_knocker block restored) ; REAL props + 7 dev bakes launched (scratch/props-wear/real.log)
- real props build DONE 15:24 (575 s): 0 over budget; manifests low 26.99/27, medium 49.91/60, max 67.95/120
- real build check FAIL: print canvases (bus_ticket, air_freshener) got COLOR_0 → kit.py finish gate now skips extras.print too; also warn: edge mean high on hog_cleaver .67–.73, bell_crank .54, claw_hammer .55, nightstand .46, jerry .46
- check_props edge mean now AREA-weighted (vertex mean over-reported bevel-dense thin props: cleaver .73→.32). Scalars: locket/shears edge →0.35, bell_wire 0.1, cobweb_curtain 0 (were .33–.79 area-weighted)
- 15:3x real2 launched: props (print-gate + scalar fix) + 7 dev bakes (scratch/props-wear/real2.log); house/corridor re-touched
- 15:4x wear.py edge fix: convex-curvature edge term only within NEAR_STEPS=3 edge hops of a real face (hero2 tiles: shears bows + locket chain were uniformly white = round thin sections); locket/shears scalars restored 0.5/0.8. real2 had already started Blender with the OLD wear.py (kill denied) → let it finish, then rebuild props only
- 15:5x typecheck ok, npm test 209/0. Runtime wear NOT wired yet (no attribute('color') in src/materials; bind.ts swaps to fresh node materials with vertexColors=false → COLOR_0 inert, no near-black risk) → in-game look 3 verifies geometry only
- docs/PROPS.md wear subsection updated (actual R thresholds + near-face rule, LOOP_TYPES, meshopt patch, area-weighted check, print gate)
- 15:5x queued real3 (props + 7 dev bakes, after real2 exits; bake inputs hash props.blend so they must follow the final props build). look-3 scenario: scratch/props-wear/look3.mjs (12 hero views via audit rig)
- B5 grime (Blender side): kit.grime(part, quads) helper → one '<part>_grime' child per part, 4x4 atlas-cell UVs, extras {decal:'grime', grime:[[cell,seed]], decal_size_m}, mat grime_decal, 0.3 mm lift; GATED kit.GRIME=False (runtime decals.ts has no 'grime' case and spec grime_decal does not exist yet → would render as a text decal / fail check_props). Placed: hall_table drawer finger smudge + 2 glass rings, nightstand drawer + door finger smudges + 1 ring. Fixed seeds (no rng draw → geometry unchanged).
- CONTRACT-CHANGES #62 written (print gate, near-face edge rule, scalars, meshopt patch, grime gated)
- real2 DONE: props ok + 7 dev bakes ok (~30–60 s each); manifests low 26.94/27, medium 49.76/60, max 67.76/120. real3 (near-face edge rule + grime helper gated) running
- real3 DONE 16:1x: props ok + 7 dev bakes ok; check_props 0 FAIL (warns: hog_cleaver Low .33, claw_hammer Low .40 area edge mean); assets --check ok: low 26.99/27 (28302859 B, 8.7 KB headroom!), medium 49.81/60, max 67.80/120. house/corridor re-touched. Next: look 3 in-game (scratch/dist-pb)
- LOOK 3 tiles (scratch/props-wear/hero3/wear): shears bows/blade no longer all-white (edge only at the shank/pivot bevels next to real faces) ✓; locket rim = crisp lip bands instead of a uniformly white band ✓; chain links still full edge (4-side link section = 90° hard edges; kept: a brass chain polishes where links rub)
- LOOK 3 in-game (scratch/props-wear/look3, dist-pb, 0 console errors/exceptions): g3-jerry = 7 separate cans with gaps + pressed X ribs (audit row 8 'one red box' FIXED); u2 nightstand view = kerosene lamp round 32-seg lathes, knurled wheel; nightstand itself mostly hidden at this angle. Masks inert in-game (runtime R1 not landed). Next: gate playthrough
- look 3 in-game: g2-cleaver still reads as a salmon rust slab — material is the layout param mat:'rust' (build-layout.mjs l.405, lead-owned; steel_cleaver spec exists) → request R3 to lead; u2-hammer view unusable (camera framed into the dark/ceiling)
- gate: npm run build OK (verify-boot OK); playthrough running (scratch/props-wear/pt.log)
- GATE PASSED 17:0x: typecheck ok; npm test 209/0; npm run build OK; playthrough medium (dist-pb) ended=true B13 → title, deaths 0, console errors 0, exceptions 0 (scratch/props-wear/pt); look3 0 errors. assets --check ok (low 26.99/27 — 8.7 KB headroom).
- NOTE: pt-report onBattery=true (laptop was on battery during the gate run) and fps not measured (--fps not used) → perf budget NOT re-measured after Medium prop tris m1 306k→399k / m2 315k→354k. house/corridor last REAL run 09:59, before the kit.py changes (only --touch'ed; wear/grime gated off outside props builds) → house smoke needed before release bakes.
- LEFT: B5 grime gated + untested in Blender; bus_ticket/air_freshener (print canvases) carry no wear now; dust_sheet_proxy 15–28% underside dust (Medium, non-hero) unexplained; Low 8.7 KB headroom (Low masks ≈ 87k verts × 1.9 B ≈ 165 KB; dropping one HERO mask frees ~10–20 KB); hog_cleaver/hammer/shears/jerry/bell_pull materials still layout params (R3).

## Runtime (props runtime materials builder, round D)
- start: no runtime wear yet (bind.ts has no attribute('color')). Masked specs in GLBs (medium): wood_furniture_dark, brass_tarnished, cast_iron, chrome_pitted, rust, enamel_chipped, zinc, crepe/fabric/flannel/rugs, leather, wood_raw_plank, paper, wax, rubber, car_interior; ALSO glass/mud/stone/bark/gravel/water/concrete on mixed meshes → family gate required.
- baseline bundle scratch/dist-prm-base (pre-edit), look/perf scenario scratch/props-rt/look.mjs → scratch/props-rt/base (queued on Chrome lock)
- R1/R2 code: src/materials/wear-math.ts (pure rules, 14 classes, family+id map; glass/stone/mud/wax/rope/plastic → none) + src/materials/wear.ts (TSL applyWear; one structure, numbers in uniforms; positionLocal noise; Low cheap = 1 value-noise, no Worley); bind.ts: wearMask = color itemSize 4 && rule && !?nowear, key |w, masked meshes: macro/stain noise → positionLocal, generic dust replaced by D-mask dust, fabric sheenRough 0.6+0.3E−0.2H. typecheck ok
- clapboard: spec bareWood [0.27,0.25,0.22], peel 0.55→0.18 (tile), peelBand 0.45 (runtime world-space layer in bind.ts: y<2 m splash + y 5.4–6.6 under eaves, flakes stretched along boards, wet-darkened bare pine), gloss 0.3→0.55 (wet paint rough ≈ 0.52×0.67 ≈ 0.35); wood.ts reads gloss param; material-spec.json regenerated (layout unchanged). NOTE: material-spec hash change marks Blender jobs stale (avgAlbedo unchanged → outputs identical; --touch safe). Calibration pending
- calibration scenario scratch/props-rt/cal.mjs queued (dist-prm)
- R3 decals: src/materials/grime-atlas.ts (12 cells per §4.3, procedural canvas, cellRect v-flip) + decals.ts case 'grime' (shared MeshStandardNodeMaterial, map+roughnessMap, transparent, depthWrite off, polygonOffset, renderOrder 1; 1024² / 512² Low). Inert until kit.GRIME=True. paintPaper(…, age?) in handwriting.ts: yellowing, browned margin, foxing, folds on a separate rng (handwriting jitter unchanged); letter age .5 fold 2, guest book .7 foxing 22, ticket .3. tests/materials-wear.test.ts 7/7
- npm test 216/0 (after R1–R3 code)
- grime_decal constant spec added (materials.mjs, family wax, no wear rule) → 87 specs; materials-library test count 86→87. npm test 216/0
- npm run build OK (verify-boot OK). Waiting on Chrome lock (gameplay lane max playthrough pid 90195) for baseline + calibration runs
- BASELINE (pre-edit bundle, medium WebGPU, mains): g1-table-torch 60fps 410 draws 1.48M tris; g2-cleaver 60/154; u2-nightstand 60/229; g3-jerry 60/134; facade 60/181; 0 console errors. (g1 already 410 draws pre-change.) shots scratch/props-rt/base
- 18:0x queued: cal (dist-prm) + look round 1 (dist-prm2 → scratch/props-rt/l1); lock held by gameplay max playthrough (pid 96728)
- cal run 1 failed: URL lacked preset=medium (boot screen); requeued with scene=matlab&debug&preset=medium
- 18:3x still queued behind other lanes' shot runs
- LOOK 1 (dist-prm2, new code, pre-calibration): perf unchanged — g1 60fps 409 draws, g2 60/154, u2 60/229, g3 60/133, facade 60/180, siding-torch 60/272; 0 console errors. shots scratch/props-rt/l1
- look 1 judgement: facade moonlight no longer stone/brick — reads as lapped painted siding ✓; hall table top now brown varnish with lighter worn front arris instead of a grey dust sheet ✓; siding torch close-up: paint too bright (gain 1.66 not yet recalibrated), peel shows as dark horizontal dashes (not silver), fine crosshatch grid visible on the paint (investigate).
- cal run 2 stalled (shot waits for __game, matlab never sets it): cal.mjs now presses Medium+Start itself under --no-start
- CALIBRATION (matlab medium webgpu, 87 specs, hash ok): clapboard_peeling cal 1.657/1.683/1.736 → 1.154/1.153/1.174 (measured mean with old cal 0.517 = +48 %, runtime gain was 0.69); tile roughness mean 0.392 (wet paint ≈ 0.35 ✓). Other 'bad' rows (asphalt_wet, plastic_wheel_tan) pre-existing, not touched.
- look 2 queued (l2: siding/facade/rocker/locket/cleaver/sewing) with calibrated clapboard
- 20:24 RESTART: l2 run never executed (killed while waiting on lock). Re-running look 2 (rebuild dist-prm2 with calibrated clapboard). NOTE laptop on battery now → fps of this run not comparable
- 20:26 R4: wearView added — wear.ts setWearView + wearUniforms.view (branch compiled only under ?debug), hook __game.debug.wearView in src/game/main.ts (1 import + 1 line, lane B surgical). typecheck ok. Queued: l2 look + matlab clapboard tile close-up (scratch/props-rt/tile.mjs) to diagnose the fine crosshatch grid on the siding
- 20:33 RESTART 2: l2 DONE (scratch/props-rt/l2, battery, 0 errors; draws unchanged g2 154, u3 272). tile run never executed (killed). l2 siding-torch: paint level now OK, but peel still dark dashes + fine grid on paint; lap shadow lines weak
- l2 judgement: g2-rocker reads as worn varnished spindle rocker (seat/arm wear subtle, OK); u3-locket view unusable (camera framed at ceiling, locket = specular streak) → fix view in look.mjs; tile close-up re-run queued (scratch/props-rt/tile)
- 20:4x clapboard peel layer v2 (bind.ts): domain-warped 3–8 cm flakes (pw×(7,16,7)) instead of 2 cm dashes, lifted paint lip +12 % at flake rims, curl shadow inside rim, eaves stay dry (wet ×(1−0.75·eave)). typecheck ok. Waiting on Chrome lock (other lane road3 pid 36568); laptop on battery → perf from these runs not comparable
- 20:5x queued l3 (dist-prm3, peel v2; views siding-torch, facade-flash, rocker, sewing, table-torch) behind tile; lock held by other lane road3 (pid 36568, 16 min)
- 21:1x still blocked: road3 (runtime lane, pid 36568) holds Chrome lock 45+ min, headless Chrome 0% CPU (likely hung in its advance loop; --timeout 9000). Not killed (other lane). tile + l3 queued
- road3 holder is alive (renderer/GPU helpers 27–46 % CPU) — slow on battery, not hung. Dropped the tile waiter (cause readable from code)
- CONTRACT #63 amended (wearView hook, clapboard calibration). Tile-side cause of siding dashes/grid (from code, common.ts paintOver): tile chips chipSizeM 0.02 aniso [5,1] at peel·0.8 = 14 % over the whole wall (2×10 cm dashes at every height) + brush lattice across = cells(0.0025) (2.5 mm, near the texel Nyquist of a 3 m tile) feeding height → fine grid at grazing torch light. Fixing needs a wood.ts tile change + recalibration run
- 21:2x tile chips (wood.ts clapboard): chipSizeM 0.02→0.04, aniso [5,1]→[3,1] (small Worley flakes 6×1.2 cm → 7×2.4 cm; coverage threshold unchanged → mean albedo ≈ unchanged; cal re-run chained after l3)
- chain queued: l3 → cal3 (matlab, dist-prm3) → gate playthrough (dist-prm3) — scratch/props-rt/chain.sh
- 21:3x typecheck ok, npm test 216/0, npm run build OK (verify-boot OK) with peel v2 + tile chips
- l3 TIMED OUT in the lock queue (1800 s incl. wait). Built dist-prm3 directly (vite build --outDir) and re-chained l3 → cal3 → gate with --timeout 14000
- 21:5x l3 still queued (lock: other lanes)
- 22:1x l3 still queued behind road3 (≈1.5 h)
- 22:2x still queued
- LOOK 3 (dist-prm3, battery): siding flakes now chunky irregular plates (no more 6×1 cm dashes) ✓, dry under-eave grey wood; REMAINING: regular ~3 cm square grid of faint lines on the paint (h + v) — not the peel layer; suspect a value-noise lattice in the tile (wood.ts mildew fbm cells(0.02) / rain streak cells(0.015)). 3 console errors = 'AudioContext encountered an error from the audio device' (battery 19 %, headless audio; not materials). draws unchanged (g1 411 vs base 410)
- l3 facade under lightning: reads as weathered lapped siding (shadow line per course, peel plates under the gable eaves, paint grey-white), no stone/brick look ✓. Grid diagnostic queued (scratch/props-rt/grid.mjs: as-is / torch shadows off / clapboard normal off)
- 22:22 RESTART 3: chain (l3→cal3→gate) dead after l3; cal3 + gate never ran. Mains power now. Running grid diagnostic then cal3
- 22:26 grid diag (scratch/props-rt/grid, mains, 0 errors): grid visible in A, still visible with torch shadows off (B) AND with clapboard normalNode off (C) → albedo/roughness lattice, not normal/shadow. Lap shadow lines come from the normal (gone in C)
- 22:29 matlab tile close-up (scratch/props-rt/tile, 0 errors): clapboard TILE has no square grid (flakes OK) → grid comes from the in-game runtime layers / mesh (bind.ts peel/macro, lightmap or UV), not wood.ts
- 22:39 grid2 diag running (lightMap off / colorNode off)
- 22:43 grid2 (0 errors): colorNode off → grid gone (flat grey + geometric laps) → grid is in ALBEDO. matlab focus is 1024² (clean), game Medium base 512² → hypothesis: tile noise above texel Nyquist aliases into a lattice (paintOver brush octave 2 across=614 cells, mildew fbm cells(0.02) 4 oct → 1200, rain streak 200→1600 cells on 512 texels)
- 22:43 FIX: common.ts nyqOctaves(c,freq,n) (caps fbm top octave at size/2); paintOver brush across cap 0.6·size→0.25·size (oct 2 ≤ Nyquist; affects the 3 paintOver materials, ±3.5 % brush term only); clapboard mildew + rain-streak fbm octaves Nyquist-capped
- 22:44 built scratch/dist-prm4; queued grid4 (same view) → cal4 (chain3.sh)
- 22:46 CORRECTION: clapboard is hero → Medium bake is 1024² in game AND matlab (not 512). Brush cap still valid (oct 2 1228 cells > 512 Nyquist). Next suspect if grid persists: bind.ts peel layer mx_fractal_noise(pw×(7,16,7)) lacunarity 2 → ~3 cm axis-aligned Perlin lattice + narrow lip band at fl≈0.5
- 22:50 grid4 (dist-prm4, 0 errors): grid persists, uniform over the whole wall incl. above the window (y>2 m) → NOT the peel layer. Verticals ≈ 1.5 cm regular = the tile's rain-streak fbm [cells(0.015), cells(0.9)] (regular vertical lines; faint verticals visible in the matlab tile too); horizontals = lap lines. Fix: wider irregular warped streaks
- 22:50 rain streaks v2 (5 cm × 1.2 m cells, ±2 cm u-warp, sparser threshold); dist-prm5; queued grid5 → cal5
- 22:56 LOOK grid5 (dist-prm5, mains, 0 errors): square grid GONE — irregular vertical grime runs of varied width + lap shadow lines + peel plates; reads as weathered lapped siding under the torch ✓ (scratch/props-rt/grid5/medium-01-g2-a.jpg). cal5 running
- 23:10 CAL5 (matlab medium webgpu, dist-prm5): wrote back all 6 paintOver rows (trim_chipped 1.052→1.03 etc., others <1 %); asphalt_wet/plastic_wheel_tan still 'bad' (pre-existing, not touched)
- 23:10 dist-prm6 (calibrated); queued l4 hero look+perf (10 views) → gate playthrough pt6
- 23:10 typecheck ok; npm test 219/0; npm run build OK (verify-boot OK)
- 23:19 L4 (dist-prm6, MAINS, medium webgpu, 0 errors): all views avg 60 fps; draws g1 408 (base 410), g2-cleaver 154 (=), g3 134, facade 180, siding 273, rocker 103, nightstand-lamp 145, sewing 148, washstand 249, u1-armoire 521 (OVER 400 — no baseline for this view; wear adds material variants, not draws → likely pre-existing, flag to lead). 1 % lows 5–15 on the first 5 teleports = shader-compile hitches
- 23:19 l4 judgement: g1 hall table = brown varnished top, lighter front arris, guest book pages + brass candlestick read OK; top still lacks a varnish sheen under the torch (roughness reads ~matte) — wear is subtle at play distance. u2 nightstand (lamp light) = planked top with grain, lamp round; nightstand body hidden in shadow. Not yet AAA: varnish specular + handled polish not visible at these distances
- 23:29 CONTRACT #63 amended (Nyquist cap, rain runs, 6 rows recalibrated). Waiting on gate playthrough pt6 (lock queue)
- 23:40 GATE PASSED (restart 3, mains): typecheck ok; npm test 219/0; npm run build OK (verify-boot OK); playthrough medium dist-prm6 ended=true B13 → title, deaths 0, console errors 0, exceptions 0 (scratch/props-rt/pt6). l4/grid5/cal5 0 errors.
- LEFT (runtime): hero-prop ≥3 look rounds NOT complete (hall table/nightstand/rocker 2–3 looks; locket/hammer views unusable; cleaver/hammer/shears/jerry need R3 layout materials); varnish sheen + handled polish too subtle at play distance; u1-armoire view 521 draws (no baseline — flag); wood grain sAcross 0.7·size still above Nyquist for all woods (not changed: global look change); grime decals inert until kit.GRIME=True; Max not re-measured this restart.

## Review (art-director review of props finishing, round D)
- start: no prior review. before = scratch/dist-head32 (HEAD 32ca774 build), now = scratch/dist-pd-review (current tree). Chain scratch/pd-review/chain.sh: 14 audit views via scratch/props-rt/look.mjs, Medium WebGPU → scratch/pd-review/{now,before}/ (queued on Chrome lock).
- look g1 (pa-15 vs l4-01, cropped+brightened scratch/pd-review/cmp-g1c.jpg): table top now brown with grain (was grey-beige slab) ✓, guest book has ink lines ✓; STILL: pages flat over-white sheets with no visible page-block/cover board edge, table top matte (no varnish sheen), candle clean white stick, torch hot spot falls below the table in this view
- views.mjs: u2-hammer camera moved north of the hammer (old one was outside the south wall), u3-locket eyeZ 5.75 d 0.6
- facet re-scan (scratch/pd-review/facet-now.json vs facet-before.json, medium GLBs): COLOR_0 on every hero prop ✓; faceting fixed: nightstand shallow 22.6→1.4 %, washstand 13→2.2, bell_pull 23.5→0.9, hammer 16.7→2.4, sign_post 22→6.9, bolt_box 19.8→4.9, sedan_interior 10.8→2.6; hero tris up (locket 830→3510, guest_book 332→2084, ticket 16→896, rocker 2760→12544)
- FIX 1 (materials.mjs): wood_furniture_dark varnish 0.5→0.85. wood.ts: rough = mix(r+0.2, 0.28, varnish·(1−worn)) → intact film was ≈0.49 (matte; CLAUDE.md dark varnished wood 0.2–0.35, wear-math.ts varnish class assumes film 0.25); now ≈0.34 on intact film, worn patches unchanged. Needs material-spec regen + cal of wood_furniture_dark
- material-spec regenerated (layout byte-identical); built scratch/dist-pd-review2; queued chain2.sh: cal wood_furniture_dark → fix1 look (candle/torch table, nightstand-lamp, rocker, hammer, locket, WV=4 mask composites)
- now-run got the lock (scratch/pd-review/now)
- now-run DONE (dist-pd-review, mains, 0 console errors/exceptions, all 14 views 60 fps avg, draws ≤ 408). "before" = audit pa-* shots (same views, HEAD tree) — head32 rerun still queued.
- q1/q2 (before|now): nightstand-torch: lamp chimney/font now round with knurled wheel ✓, nightstand body still a dark box in shadow; sewing view frames only the basket corner (unusable for shears); rocker: darker varnish + lighter worn arms ✓ (subtle); sign post: faint grain now, still a pale clean plank, VACANCY plate still blown white (exposure of the lamp-lit plate). hammer view STILL unusable (camera clipped into a near surface, hammer prompt visible); locket hidden in the hem until cut_hem (as designed) — dress hem/dust sheet reads as faceted paper cut-outs (sharp flat triangles).
- FINDING (big): g1-table-candle (no torch): guest book + candle stick render PURE BLACK while the lightmapped table/wainscot are candle-lit (same in pa-14 before) → 'dynamic'-lighting props get no candle light/probe. crop scratch/pd-review/c2.jpg. Stove oven-door panel = flat light-grey rectangle (both builds).
- queued diag.mjs (lights near hall table + guest_book/candle material info) on dist-pd-review
- audit doc: Review section header written
- audit doc: per-prop verdict rows 1st pass written
- cal (dist-pd-review2, varnish 0.85): wood_furniture_dark measured [0.0568,0.0326,0.0162] err 9.1 %, tile rough mean 0.455 (intact film ≈0.34 but varnishWear 0.3 = 30 % of area rubbed to 0.7). FIX 1b: varnishWear 0.3→0.15 (edge/handle wear now comes from the Blender masks, the tile no longer needs to fake it); recal queued
- fix1 (dist-pd-review2, varnish 0.85, 0 errors, 60 fps, g1 410 draws): hall table top darker walnut with a slight sheen, less grey-dusty (scratch/pd-review/f1.jpg); WV4 mask composite reaches the shader (red arrises on table + book boards, blue handled on candlestick) ✓
- diag (lights): L_CANDLE_HALL PointLight 1.07 cd unshadowed reaches the area; dynamic brass holder IS candle-lit → book-specific. Wax stick also black (no translucency near the flame). Queued diag2 (book bbox/normals/side + light ×30 shot)
- wax_candle (misc.ts wax generator): no translucency/SSS term (spec param sss 0.6 unused) → a lit candle's stick renders black under its own flame (flame above, side faces at grazing NdotL). Real burning candle: top 2–3 cm glows warm by subsurface transmission. Logged for remainder (needs a per-candle flame-distance term).
- diag2: guest book geometry at table height (y 1.40–1.42), light at (3.4,1.6,-4.5) unshadowed; decal page_left normals point DOWN (ny −0.99, page_right +0.99) — a separate defect; boosting the light via setInterval failed (overwritten per frame). diag3 queued (intensity pinned 30 via defineProperty + book hidden)
- FINDING: guest_book left page decal (6 names, decals.ts drawGuestBook rows 0–5) is back-facing: small_items.py reverses u for s<0 AND mirrors x AND passes flip=True → winding faces down → FrontSide culls it; the left page has rendered blank since HEAD (pre-existing). Fix: flip=False (needs props rebuild)
- CAL3 (dist-pd-review3, varnish 0.85 / varnishWear 0.15): wood_furniture_dark err 13.4 % → written back calibration.ts [0.797,0.893,0.941]→[0.864,0.995,1.106]; tile rough mean 0.455→0.406 (HEAD ≈0.55 est.), intact film 0.34
- 00:11 FIX 2: small_items.py guest_book page add_grid flip removed; launched assets --only props,bake (log scratch/pd-review/props-build.log)
- typecheck ok, npm test 219/0 (after varnish spec + cal write-back + guest_book flip)
- 00:21 waiting: diag3 + props build queued behind other lanes' Chrome sessions
- 00:23 props,bake rebuild OK (props 320 s after one Blender abnormal-exit retry; 7 dev bakes + encode ok); assets --check ok: low 26.93/27, medium 49.74/60, max 67.73/120. GLB check: guest_book page_left normal y −0.99 → +0.99 (medium + low)
- audit doc: fixes + ranked remainder written
- 00:33 still queued (diag3, fix2, pt)
- ROOT CAUSE (black candle-lit props): src/world/level.ts l.549 probeLights = flashlight, lightning, runtime spots, grids — NO runtimeLights.flickers (by design, header item 7). Grids are captured from lightmapped surfaces → probe-lit (dynamic) props get candle BOUNCE only, never the direct term → guest book/candle wax black beside their candle. diag3: book hidden → table dim under the book footprint; x30 boosts inconclusive (intensity reassigned every frame). Testing a probeNode-only patch in dist-pd-review5 (tree reverted right after build)
- built scratch/dist-pd-review5 (probeNode + flickers; tree reverted, patch kept at scratch/pd-review/level.ts.patched); queued fix3 look+perf after chain6
- NOTE for lead: the props GLBs and all 7 dev bakes (public/assets/*/lm_*.klm) were re-built at 00:36 — the dev bakes now also include the runtime lane's clapboard spec change. house + corridor jobs remain stale on the material-spec hash (not run). before-run on head32 (mains) completed: scratch/pd-review/before/ (same framing as pa-*).
- FIX2 look (dist-pd-review4 = varnish+cal+guest-book rebuild, mains, 0 errors): guest book LEFT page now shows its 6 handwritten rows (top-aligned, column layout like the right page; upright at 1280 px, too small to prove non-mirrored) ✓ scratch/pd-review/f3.jpg,f4.jpg; hall table top slightly darker/warmer walnut, sheen still subtle at 0.75 m under the torch; perf: g1-torch 60 fps 410 draws, candle 60/273, nightstand-lamp 60/146, rocker 60/103, washstand 60/249, jerry 60/134, u1-armoire 57 fps / 522 draws (pre-existing per runtime builder 521)
- audit remainder #2 rewritten around the probeNode finding
- 00:47 pt (dist-pd-review4) queued behind other lanes
- reordered: stopped the queued (not started) review4 playthrough so fix3 (probe-light test) runs first; the playthrough will run on the dist that ships
- 00:58 fix3 queued
- fix3 (dist-pd-review5, probeNode+flickers, mains, 0 errors): guest book now warm candle-lit with both pages readable (scratch/pd-review/f5.jpg); mantel/kitchen candles + holders lit; all 6 views 60 fps avg, draws unchanged. KEPT: patch re-applied to src/world/level.ts (region unchanged since read), CONTRACT #68
- 01:03 built dist-pd-review6 (final tree); playthrough queued (scratch/pd-review/pt.log)
- audit doc updated (fixed list 1–3, remainder 1–8, table rows); waiting on playthrough
- 01:14 playthrough in queue/running
- 01:23 playthrough still pending
- 01:32 PLAYTHROUGH FAIL (dist-pd-review6, mains?): ended=false, stalled in B11 'let her look' (Ada LOOK sight/windup in G1, player G1 (2.41,8.28)); deaths 0, console 0, exceptions 0. B01–B10 OK. Stall is in AI/story logic (gameplay lane: src/ai/ada-brain.ts edited 00:32); my changes are visual only (spec/cal/GLB/bakes/probe lights). Re-running once to check flakiness (pt2)
- 01:42 pt2 pending
- 01:46 pt2 (same dist-pd-review6): ended=true B13 → title, deaths 0, console 0, exceptions 0 → pt1 B11 'let her look' stall is intermittent AI behaviour (gameplay lane), flagged to lead. GATE: typecheck ok, npm test 220/0, npm run build OK (verify-boot OK), assets --check ok, playthrough pass (pt2)
- REVIEW DONE. Requests for the lead: (1) R3 layout materials for the cleaver, hammer, shears, bell_pull and jerry_can, then a props rebuild; (2) review or keep CONTRACT #68 (probeNode + flicker lights, runtime-lane file); (3) B11 'let her look' stall seen once in 2 runs (pt1) → gameplay lane; (4) wax SSS (misc.ts wax ignores sss); (5) torch hot-spot exposure at 0.4–0.8 m → runtime lane; (6) u1-armoire 522 draws, 57 fps (pre-existing); (7) woodGrain Nyquist approval; (8) kit.GRIME=True + rebuild; (9) Max pass not run; house/corridor jobs stale on the spec hash.
- C2 parlor check (pt2 vs props-rt/pt6, scratch/pd-review/c2cmp.jpg): nothing blown, rope/table props now candle-lit, saucer bright but not clipped → #68 kept. CONTRACT #67/#68 amended (rebuild done; compile-cost note)
