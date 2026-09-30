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
| `public/assets/low/props_m*.glb` | Low LOD: same nodes/extras; non-lightmapped meshes ≥ 1500 tris decimated to 45 % (sedan, wrecks, trees, …) |
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
  - `dead_tree` branching is sparse at distance.
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
