# Props (lane A): generators, GLB libraries, runtime contract

Run with `node scripts/assets.mjs --only props [--force]`. It takes about 3.5 min, most of it in review renders,
and peaks at about 1.1 GB RSS.
- Dev subset: `Blender --background --factory-startup --python blender/lib/cli.py -- blender/props/build_props.py --types candle,stool --no-export`.
  This writes `scratch/props/_subset-contact.png`.
- Post-check: `blender/props/check_props.mjs`. It parses the GLBs with three r186 GLTFLoader and MeshoptDecoder.

## Outputs

| File | Content |
|---|---|
| `public/assets/{medium,max}/props_m1.glb` (≈2.9 MB) | Every `milestone: M1` placement in `level-layout.json` `props[]` |
| `public/assets/{medium,max}/props_m2.glb` (≈4.2 MB) | Every M2 placement |
| `public/assets/low/props_m*.glb` | Low LOD: same nodes/extras; non-lightmapped meshes ≥ 1500 tris decimated to 45 % (sedan, wrecks, trees, …). A part may override this with extras `low_ratio` / `low_min_tris` (the opening set, `sedan_interior-shell_details` 0.32) |
| `public/assets/*/props_road.glb` | Every placement in room `RC9` (County Road 9 set, `lighting:'dynamic'`, no lightmap): see *Opening set* below |
| `.cache/props/props.json` | Per-variant triangle counts, budgets, placements, skipped ids, `lightmap`, `low_lod` |
| `.cache/props/props.blend` | The placed instances with their Lightmap UVs (the bake jobs append them) |
| `.cache/props/lightmap.json` | Per-atlas props-band packing: islands, fill, texel/m, placements |
| `scratch/props/<type>__<id>.png`, `docs/props-contact.png` | 512 px Cycles review renders and the labelled grid |
- Budgets are checked for every placement (`over_budget` fails the job):
  - furniture: 2–15k triangles
  - sedan: ≤ 60k (actual 28.6k)
  - wrecks: ≤ 45k (actual 20–28k)

## GLB contract (read by `src/world`)

**Root nodes**
- One root node per placement, named by the layout id (`P_SIGN`, …), built **at the origin**. The runtime places it:
  - position `planToWorld(pos)`
  - rotation `yaw` about world +Y
- Root `userData`: `prop_id`, `prop_type`, `room`, `milestone`, `lighting`, `collider`, `plan_pos`, `plan_yaw`,
  `params` (JSON string), `variant_seed`.
- Children are named `<id>-<part>`. Placements whose params differ only in a generator's `instance_keys` share
  glTF meshes: the 12 jerry cans, the 9 wrecks (5 variants), and so on.

**Orientation and origin**
- The **front faces −y** in PLAN space, which is +Z in three.
- The origin is the base centre, with these exceptions:
  - Wall- or door-mounted items (knocker, bell knob, cranks, cleat, bolt box, frames, hooks): the mounting point on
    the surface. The item projects to −y.
  - Hanging items: the hang point.
    - `vacancy_plate`, `air_freshener`, `bell_pull_embroidered`.
    - `rope_pulley` = the sheave centre.
    - `door_counterweight` = the pulley.
  - Path props (`door_rope`, `bell_wire`): the geometry is built from the absolute `path` minus `pos`.
    `userData.path_local` carries the polyline.
- `sedan_interior`: the dash's user-facing side is its front (−y), so the **car nose is +y**. This matches the CAR
  set (`debug_car` looks north).

**Materials**
- Every material has `userData.material_id` = a `material-spec.json` id. `check_props` enforces this.
- Materials are single-sided (`doubleSided=false`). Thin sheets use a `<id>@2s` material with `doubleSided=true`
  and the same `material_id`: cloth, paper, crepe, rubber sheet, and opened wreck shells.
  - The review renders paint back faces magenta, so flipped normals are visible.

**UV0**
- UV0 is in **metres**: a box projection in each primitive's local frame, with u along its longest axis, so wood
  grain follows planks.
- Runtime repeat = `1 / tileMetres`. `check_props` measures uv/surface area at 0.995.

**Wear masks: COLOR_0 (round D finishing, docs/PROPS-FINISH.md §5, CONTRACT-CHANGES #59/#60)** — `blender/props/wear.py`
- Blender `wear` attribute (BYTE_COLOR, POINT; linear values) → glTF `COLOR_0` VEC4 UNSIGNED_SHORT normalized → three
  `geometry.attributes.color` (Uint16Array, itemSize 4, normalized). Read it with `attribute('color','vec4')`,
  never `vertexColor()` (white when absent).
- Channels 0..1 (0 = pristine), already × the prop's scalars (`wear.SCALARS`, §3.2): **R edge** (convex curvature:
  full at ≤ 2.5 mm radius, none at ≥ 10 mm — counted only within 3 edge hops of a real ≥ 4 mm face, so thin round
  sections (chain links, shear bows, wire) are not 'all edge' — or a 45→75° hard edge; vertices of real faces carry 0), **G cavity** (8-ray occlusion within 3 cm, or
  concave curvature; + soot near `wear_soot` anchors), **B handled** (Gaussians around `wear_handle` anchors),
  **A dust** (n_z 0.35→0.85 × open to +Z × (1 − B)). `wear_protect` anchors subtract from R and A.
- Which meshes: every prop part (Medium/Max) except decal children and print canvases (`extras.print`), trees (`sharp_angle` override) and parts
  that are all glass/skin/hair. **Low: only `wear.HERO` props** (rows 1–20); `check_props` fails a non-HERO mask on Low.
- **Glass in a mixed mesh carries COLOR_0 = 0**: the exporter gives the attribute to every primitive of a mesh that
  has it, so the runtime must gate wear by material family too, not by the attribute alone.
- Anchors (`wear_handle {r}`, `wear_soot {r, up}`, `wear_protect {r}`) are consumed by the bake and never exported.
- Geometry finishing applied with it (props builds only; `wear.ENABLED` is off for the house/corridor jobs):
  support loops (planar faces next to a ≥ 20° edge inset by 8 / 5 / 3 / 2 mm by part size) on `wear.LOOP_TYPES`
  only (HERO minus sedan_interior/dress_dummy — loops on every prop cost +25–250 % tris: rag_rug 9k→27k,
  bricked_doorway 12k→45k) and an applied `WEIGHTED_NORMAL` (FACE_AREA, weight 50, keep sharp) on every finished
  part, so the runtime `toCreasedNormals` pass is no longer needed for props.
- Size: values quantised to 16 levels per channel and COLOR_0 meshopt-encoded by `wear.color_meshopt_patch()` (Blender
  5.2's exporter writes COLOR_n raw, bypassing EXT_meshopt: 8.0 → 1.9 B/vert measured).
- `check_props` (wear contract): unorm16×4, no COLOR_0 on decal/print canvases, every masked primitive resolves a spec
  `material_id`, Low non-HERO has none; warns when the AREA-weighted edge mean of a prop > 0.25 (a vertex mean
  over-reports bevel-dense thin props) or dust > 2 % on downward faces.
- Tools: manual job `props-wear-review` (scratch only: `--job-args="--types a,b [--render --wear-tiles]"`) renders
  beauty + edge/cavity/handled/dust tiles; `scratch/props-wear/inspect.mjs` prints COLOR_0 bytes and channel means.

**Decal and canvas children** (quads with normalised 0–1 UV, `userData.decal`)
- Styles: `sign_painted`, `hand_lettered`, `stencil`, `road_sign`, `plate`, `chalk`, `handwriting`, `photo`,
  `gauges`, `cobweb`.
- Other keys:
  - `text` (per-placement value via `text_param`)
  - `decal_size_m`
  - `paintedOut: 'GAS'`
  - `page: left|right|letter`
- Preview renders hide decals: lane B draws them (stroke font, CanvasTexture).

**Moving parts** are child nodes with their origin on the hinge or pivot. Keys include `part`, `hinge_axis`,
`swing_axis`, `slide_axis`, `rotate_axis`, `travel_m` and `pivot_at`. Examples:
- drawers and doors of furniture, cabinet doors (the armoire's right door `ajar` 14°). Ada's wardrobe has NO back
  (extras `open_back`, `back_door_id`): its loose boards are the house's `door_D_WARDROBE_BACK` (doors.glb)
- ROOMS board, VACANCY plate, knocker ring, bell-pull knob, crank levers, spring-bell bell, pulley sheave, drop
  bolt, counterweight
- mailbox door and flag, gate leaf, wipers, steering wheel, glovebox, locket lid, pump handle, stove doors

**Never write `extras.pivot`.** three r186 `GLTFLoader` treats `userData.pivot` as a GLTFExporter pivot container
(`GLTFLoader.js:4311`) and produced NaN transforms. `check_props` now fails on it.

**Other anchors and markers**
- Anchors are empty nodes:
  - `*-flame` (`flame: true`, `kind` candle/lantern/lamp, at the flame centre)
  - `sign_post-mount_lantern`, `sign_post-hang_vacancy`
  - `sedan_interior-air_freshener_mount`
- Lamps: `sedan-headlights` and `sedan-taillights` carry `lamp` and `emissive_color`. They use `glass_grimy`, and the
  runtime tints them.
- Liquids: `zinc_bucket-water` and `rain_barrel-water` carry `liquid`.
- Colliders: `<id>-…-collider` children (`collider: true`, `hide_proxy` on hides) on `slatted_cabinet`,
  `closet_interior` and `porch`. **The runtime must hide them.** Hides keep an open interior. Louvres: 30 × 6 mm
  slats at 35° on a 34 mm pitch, OUTER edge lower like a real louvred door: a 12 mm clear slot looking level
  (~35 % open) at eye height (~1.55 m), ~22 mm along the slat angle (looking slightly down and out).

## Lightmaps (static props) — `blender/props/lightmap.py`

**Decision: a static prop bakes into its ROOM's atlas** (`lm_<atlas>.klm`), in a band on top of that atlas which the
house packer leaves free (`blender/house/lmuv.py` `PROPS_BAND`: exterior 0.13, ground 0.12, parlor 0.17, kitchen 0.24,
upper hall 0.24, upper rooms 0.30 of the height; LM_CAR is all props). Chosen over a separate props atlas because the
runtime then needs nothing new: same lightmap file, same per-atlas lights node, same Max lightning flash maps.
- Which: placements with `lighting: 'static'` (+ `sedan_interior`, whose shell is the LM_CAR set), except the types
  in `EXCLUDE_TYPES` (wrecks: mist vista east of x 12; dead trees; path props; `sedan`). Inside a placement, moving
  parts and their children (`part`, hinge/slide/pull/rotate keys, `door_id`), decals, colliders, flame/lamp/liquid/
  reflector nodes and glass-only meshes stay probe-lit.
- Lightmapped meshes get their own mesh data (UV2 is unique per placement; the dynamic props still share meshes),
  a `Lightmap` UV layer → `TEXCOORD_1` → `uv1`, and **node extras `kind: 'level'`, `lightmap: 'lm_<atlas>'`,
  `atlas`, `room`, `lm_prop`** — exactly what `src/world/level.ts` `lmFor` binds (`uv1` present). Children of a
  lightmapped node inherit `kind`/`lightmap` in a merged-userData view but have no `uv1`: they stay probe-lit.
- Density: capped at 70 texel/m @1024 (exterior 26, car 220). Measured props / house texel/m @1024: exterior 23 / 19,
  ground 45 / 35, parlor 47 / 56, kitchen 38 / 40, upper hall 47 / 51, upper rooms 35 / 36, car 151 (`lightmap.json`).
- Bakes: `bake_house.py` appends `.cache/props/props.blend`, places every root at plan pos/yaw; the atlas's static
  props are bake targets, every other prop is an occluder (house bakes now include prop shadows).
- Low tier: lightmapped meshes are NOT decimated (UV2 charts stay exact).

## Generators (`blender/props/`)

- `kit.py`: the modelling kit.
  - bmesh primitives: bevelled box, lathe, tube/sweep with mitred corners, extrude, parametric grid
  - `Part` accumulators: per-material slots, merge/apply, optional subdivision
  - seeded coherent-noise jitter
  - the `@prop` registry
- `registry.py`: `build(type, params, seed)` is pure and deterministic, so the bake job can import it.
- Families:

| Family | Types |
|---|---|
| lighting | `candle` (chamberstick / brass_stick / saucer / bottle, guttering), `kerosene_lamp` (brass font on a stepped foot, finger loop, burner with wick-raiser wheel, pronged gallery, flame deflector + slot, flat `wick_cotton` wick with a charred tip, thick-walled grimy chimney: `mat` = chimney glass, `burnerMat` = brass) |
| signage | `sign_post` (+ ROOMS board), `vacancy_plate`, `sign_lantern` (+ tubular barn lantern), `gas_pump` |
| exterior | `mailbox`, `reflector_post`, `road_card`, `fence_run`, `farm_gate`, `utility_pole`, `dead_tree`, `rain_barrel` |
| bells_rope | `door_knocker`, `bell_pull_knob`, `bell_crank`, `bell_wire`, `spring_bell`, `rope_pulley`, `door_rope`, `rope_cleat`, `bolt_box`, `door_counterweight`, `bell_pull_embroidered` |
| furniture | `hall_table`, `stool`, `sawbuck_table`, `rocking_chair`, `photo_frame`, `mirror_crepe` (pier / overmantel / washstand), `nightstand`, `washstand`, `kitchen_table`, `kitchen_chair` (tipped), `chair_sacks`, `iron_bed` |
| cabinets | `slatted_cabinet` (armoire / wardrobe_coats / wardrobe_loose_back), `coat_hooks` |
| architecture | `balustrade_run`, `floor_register`, `fireplace_mantel`, `porch`, `foundation_skirt`, `bricked_doorway`, `closet_interior`, `cistern_hatch` |
| kitchen | `iron_stove`, `pump_sink`, `can_shelf` |
| textiles | `runner_rug`, `rag_rug`, `rubber_sheet`, `dust_sheet_proxy`, `cobweb_curtain`, `dress_dummy` (two dress states) |
| small_items | `zinc_bucket`, `guest_book`, `ledger_book`, `letter`, `bus_ticket`, `hog_cleaver`, `whetstone`, `claw_hammer`, `nail_can`, `jerry_can`, `sewing_shears`, `sewing_basket`, `locket`, `air_freshener` |
| sedan | `sedan`, `wreck_sedan` (variants 1–5: flats, no hood, broken glass, stripped, wagon; `sunkInWeeds` lowers the placement), `sedan_interior` |

**Not exported** (listed in `props.json` `skipped`):
- `porch` and `foundation_skirt` are built by the house kit (`blender/house/exterior.py`), so there is no double
  geometry. The generators here remain as fallbacks.
- `fx_drip_emitter` and `harlan_pose_marker` are runtime-only and have no mesh.
- Doors (`doors[]`, including Ada's 3 boards and the passage bolt) are the house kit's `doors.glb`.

## Opening set (docs/C1-OPENING.md §6.2–6.3)

Nodes the runtime looks up by name (`<placement id>-<part>`). Nothing existing was renamed.
- `sedan` (hero only, not the wrecks): `-cabin_lo` (low cabin; `hide_when`), `-light_low_l/_r`, `-light_hi_l/_r`
  (anchors, `light`, `aim_local` node-local / `aim_car`), `-tail_l/_r` (`lamp:'tail'`, `chambers: 3`),
  `-hood_steam` (`fx`), `-driver_proxy` (`hide_in:'pov'`, `driver`, `faceless`; dark silhouette, no face, probe-lit:
  show it only in exterior shots and hide it once the player steps out).
- `logging_truck` (`P_RC9_TRUCK`): `-axle_1..5` (`part:'wheel'`, `spin_axis` [1,0,0], `radius` 0.52), `-hi_l/_r`
  (`lamp:'head'`, `beam:'high'`, `lm` 1500, `kelvin` 3300, `aim_local`), `-clearance`, `-markers`, `-tail`
  (`lamp`, `emissive_color`), `-logs`, anchors `-spray_l/_r`.
- `deer` (`P_RC9_DEER_1..3`, one shared mesh): `-deer-head` (`turn_joint:'neck'`, `yaw_param:'headYaw'`) with
  anchors `-deer-eye_l/_r` (`eye_glint`, `glint_color`). Per-deer values are NOT on the shared nodes: read
  `headYaw` and `pose` from the root's `params` JSON and turn the head node about its local up axis.
- `billboard`: `-billboard-face` (decal `billboard`, two text layers), `-billboard-peel` (`flutter`, `peel_strips`:
  weight the flutter by height above the bottom so the fallen sheets stay put).
- `diner`: `-diner-payphone` (`no_handset`). `eat_sign`: `-eat_sign-neon`, `-neon_back` (`neon`, `neon_color`,
  `lit:false`).
- `road_card` hero (`P_RC9_NEXT_SERVICES`), `county_shield` (`P_RC9_CR9_A/B`): decal styles `guide_green` and
  `county_shield` (the latter is new for `src/world/decals.ts`).

## Open issues

- **Material gaps.** Stand-ins are marked in extras:
  - water surfaces: `glass_*` + `liquid`
  - reflector amber, lamp lenses: `glass_grimy` + `reflector` / `lamp`
  - candle wick: `crepe_black` (the lamp wick uses the new `wick_cotton`)
  - cobwebs: `dust_sheet@2s` + `decal: cobweb`
  - ribbon and cap: `flannel_red`
- **Porch and foundation** are both a layout prop and house-kit geometry. The lead should decide whether the
  layout marks them as house-built.
- Coordination with the house kit (fixed 2026-09-30): `P_GALLERY_RAIL_E` (`balustrade_run`) builds no north newel
  (the ST_MAIN top newel stands there, `architecture.HOUSE_NEWELS`) and no south newel (the corner newel belongs to
  `P_GALLERY_RAIL_S`); `P_ADA_WARDROBE` (`wardrobe_loose_back`) leaves its back open over the
  0.7 × 1.8 m opening (the loose boards are `door_D_WARDROBE_BACK` in doors.glb).
- **Weak items:**
  - `coat_hooks` oilskin and the wardrobe coats are sack-like.
  - Brooms in `closet_interior` are crude.
  - `dead_tree` (`trees.py`): recursive bare deciduous trees (pipe model, phyllotaxis, gravitropism, snapped
    limbs). Styles `oak`, `elm` (the layout's hero trees) and, for the treeline, `ash`, `hedge`, `snag`, `shrub`
    (params `style`, `r0` radius override, `fitHeight: false` keeps a snag's broken height). 1.8 mm spurs (order 5)
    are grown for the random stream but not emitted (`emitOrder` 4: sub-pixel beyond ~2 m); the hero cap is 64k
    triangles (was 80k with spurs) so the twigs that read keep their density inside the 1.5 M view budget.
  - `claw_hammer` claw is long.
  - `rag_rug` is a single spiral with no colour bands (bands are a runtime texture).
  - `dust_sheet` and `rubber_sheet` drape procedurally with no cloth sim.
- `rubber_sheet` ORIGIN = the table-top centre (the layout's `P_RUBBER_SHEET` z 1.4 = floor 0.6 + table 0.8): the
  sheet lies at z ≈ +3 mm and hangs ~0.45 m down both long sides of the 0.6 m table. (The runtime workaround in
  `level.ts` that re-placed it at floor height must go.)
- `sawbuck_table` is FIXED at 0.6 m wide (`furniture.SAWBUCK_W`, length from the layout): Ada's `ada_table` /
  `ada_opening` clips assume the top spans 0.03–0.63 m in front of her root. The layout still says
  `P_SAWBUCK.params.width: 0.8` — lead: change it to 0.6 (the generator ignores it and logs the override).
- `door_knocker` is exported by the HOUSE job as a child of `door_D_FRONT` in doors.glb (registry `HOUSE_BUILT`);
  it still renders in the contact sheet.
- Static props lit by `bake_flicker` candles in their room get the baked light AND the runtime flicker light like
  the house surfaces (same lights node) — consistent. Dynamic props stay probe-lit.
- The exterior props band packs at only ~21 % fill (long fence rails/pole limit the shelf scale); density still
  matches the facade (23 vs 19 texel/m @1024).

## First-person arms: car clips + close-up gloves (round C, docs/C1-OPENING.md §7.1/§10.9)
Built by `characters` (`--only arms`) + `anims` into `arms.glb` (every tier). Existing clip names are unchanged.

| Clip | s | What happens (camera space = car − driver eye (−0.35, −0.05, 1.12)) |
|---|---|---|
| `arms_wheel` (loop) | 3.0 | Now BOTH hands IK onto the rim at ten-to-two (rim r 0.1765 m, hub car (−0.37, 0.42, 0.80), column tilt 25°); the runtime hides the torch mesh in the car. |
| `arms_radio_seek` | 2.4 | Right index presses SEEK (radio_seek_up) at 0.8 s and 1.3 s, back on the rim by 2.4 s. |
| `arms_headlamp_knob` | 1.6 | Left thumb+index pull the push-pull knob out 12 mm (click 0.85 s); play reversed for off. |
| `arms_stalk_flick` | 1.0 | Left fingers flick the turn/high-beam stalk toward the driver at 0.45 s. |
| `arms_brace` | 1.2 | Hands clamp the rim at quarter-to-three by 0.25 s, arms locked, tremble; clamp the last frame. |
| `arms_map` | 6.0 | Map on socket **`prop_l`** (attach 0.6 s, detach 5.8 s): picked off the bench 0–1.2, unfolded against the upper rim 1.2–2.8, right index traces 2.8–5.0, lowered 5.0–6.0. |

- Socket `prop_l` (child of `hand_l`): the map's left-edge pinch; in the map hold +X runs along the map toward its
  centre, +Y away from the player (printed face looks back at the eye), +Z up the sheet (`clips_arms.map_socket_rest`).
- Torch hold: the grip is rolled −28° about the barrel (`skeleton.ARMS.hold_roll_deg`), so the barrel/bezel show beside
  the knuckles; the beam direction is unchanged.
- Gloves: chestnut calf driving gloves, perforated finger backs, **knuckle holes** over the four MCP knuckles (bound
  edge + stitch row, skin inside), wrist vent + snap tab. Fingers are a per-finger smooth union, hard-unioned to each
  other (`body.hand_sdf(sharp_fingers=True)`), 1.1 mm voxels, 12k tris per glove.
