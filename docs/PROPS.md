# Props (lane A): generators, GLB libraries, runtime contract

Run with `node scripts/assets.mjs --only props [--force]`. It takes about 3.5 min, most of it in review renders,
and peaks at about 1.1 GB RSS.
- Dev subset: `Blender --background --factory-startup --python blender/lib/cli.py -- blender/props/build_props.py --types candle,stool --no-export`.
  This writes `scratch/props/_subset-contact.png`.
- Post-check: `blender/props/check_props.mjs`. It parses the GLBs with three r186 GLTFLoader and MeshoptDecoder.

## Outputs

| File | Content |
|---|---|
| `public/assets/<tier>/props_m1.glb` (2.4 MB) | Every `milestone: M1` placement in `level-layout.json` `props[]` |
| `public/assets/<tier>/props_m2.glb` (3.8 MB) | Every M2 placement |
| `.cache/props/props.json` | Per-variant triangle counts, budgets, placements, skipped ids |
| `scratch/props/<type>__<id>.png`, `docs/props-contact.png` | 512 px Cycles review renders and the labelled grid |

- The same file ships to all three tiers. There is no low-tier LOD yet.
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
- drawers and doors of furniture, cabinet doors (the armoire's right door `ajar` 14°), the loose back of Ada's
  wardrobe (`door_id: D_WARDROBE_BACK`)
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
  `closet_interior` and `porch`. **The runtime must hide them.** Hides keep an open interior, and the louvre slats
  leave ~13 mm clear slots at eye height (~1.55 m).

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
| lighting | `candle` (chamberstick / brass_stick / saucer / bottle, guttering), `kerosene_lamp` |
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
  - candle wick: `crepe_black`
  - cobwebs: `dust_sheet@2s` + `decal: cobweb`
  - ribbon and cap: `flannel_red`
- **Porch and foundation** are both a layout prop and house-kit geometry. The lead should decide whether the
  layout marks them as house-built.
- **Weak items:**
  - `coat_hooks` oilskin and the wardrobe coats are sack-like.
  - Brooms in `closet_interior` are crude.
  - `dead_tree` branching is sparse at distance.
  - `claw_hammer` claw is long.
  - `rag_rug` is a single spiral with no colour bands (bands are a runtime texture).
  - `dust_sheet` and `rubber_sheet` drape procedurally with no cloth sim.
- The low tier uses the same meshes (no LOD).
