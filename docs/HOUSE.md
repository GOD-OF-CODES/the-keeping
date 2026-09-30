# House shell (lane A) — `blender/house/`

Generated entirely from `src/shared/level-layout.json` by Blender Python (no Booleans, no downloaded assets).

## Commands

| What | Command |
|---|---|
| Build the shell + GLBs + `.cache/house/house.blend` (shell only, no bakes) | `npm run assets -- --only house` |
| Everything (shell, then the six bakes, in pipeline order) | `npm run assets` |
| Dev bakes (1024², 32 spp, one atlas per process; 7 atlases incl. LM_CAR) | `npm run assets -- --only bake` (or `--only bake-house-ground`, …) |
| **Full-quality bake (release)** — NO browser/WebGPU session open, ~2.4 GB per process | `npm run assets -- --only bake-release --force` (manual jobs `bake-release-*`: 2048², 128 spp; LM_CAR 1024²) |
| Review renders → `scratch/house/*.png` (appends the placed props) | `npm run assets -- --only house-review` (group `review`) |
| GLB contract check (three r186 GLTFLoader in Node) | `node blender/house/check_house.mjs public/assets/max` (runs as the house job's post-check) |
| Layout analysis without Blender | `python3 blender/house/plan.py` (room wall chains, corners, facades) |

## Outputs (`public/assets/{low,medium,max}/`; GLBs identical per tier, lightmaps per tier)

| File | Contents |
|---|---|
| `house_<atlas>.glb` (`ground`, `parlor`, `kitchen`, `upper_hall`, `upper_rooms`, `exterior`) | Static, lightmapped geometry: one node per room (+ `<room>_stair`, `<room>_glass_<opening>`, exterior parts, `EXT2_terrain`). `uv` = UVMap, `uv1` = Lightmap. Meshopt. |
| `details_<atlas>.glb` | Small static parts NOT in the lightmap (nails, hinges, sash locks, balusters, louvres, lattice slats, ridge caps, gutter hangers, downspouts, vent bars). Probe-lit at runtime; they are occluders in the bake. |
| `doors.glb` | Door leaves, Ada's 3 boards, the passage bolt (parented to its leaf). Probe-lit (no uv1). |
| `collision.glb` | Collision proxies (convex boxes / prisms, faces wound outward), joined per (collider kind, room). |
| `lm_<atlas>.klm` + `.json` | Lightmaps (KLM, `docs/SMOKE.md`), `lightMapIntensity = π`, sample at `(uv1.x, 1 − uv1.y)`. Tier sizes (`lib/encode.py TIER_POLICY` × layout `maxResolution`/2048): Max = bake size (2048 release, 1024 dev), Medium = same m7, **Low 512² m6**; LM_CAR 1024/1024/256. Each house atlas also holds its room's **static props** in a band on top (`lmuv.PROPS_BAND`, docs/PROPS.md "Lightmaps"). |
| `lm_car.klm` | LM_CAR: the sedan interior set (props only, night-sky ambient; the dash light stays runtime). |
| `lm_upper_hall_flash.klm`, `lm_upper_rooms_flash.klm` | **Max tier only.** Additive lightning-flash maps (only `mode: flash` lights + storm sky through Cycles portals in the sky-portal windows). |

### Extras (glTF extras → `userData`)
- Level nodes: `room`, `atlas` (`LM_…`), `lightmap` (`lm_…`, the file stem), `floor`, `kind: 'level'`; glass nodes add
  `glass: true`, `opening`. Materials carry `material_id` (`src/shared/material-spec.json`).
- Detail nodes: `detail: true`, `kind: 'detail'`, `room`, `atlas`.
- Door leaves (`door_<id>`): `doorId, openingId, style, hinge, swingInto, initial, interactive, unlockFlag,
  swingSign, initialAngleDeg, leafWidth, leafHeight, thickness, kind: 'door', pivotWorldPlan`.
  The node origin is the hinge axis at the leaf bottom; the leaf is exported CLOSED. Open by rotating about world
  +Y by `swingSign * angle` (swings into `swingInto`). Initial poses: ajar 20°, open 95°, others 0°.
- Boards (`board_D_ADA_1..3`): `doorId, board, flag ('ada_board_k'), kind: 'door_board'`; origin at the board centre.
- Bolt (`bolt_D_PASSAGE`, child of `door_D_PASSAGE`): `slideAxis` (leaf-local, plan), `slideTravel` 0.045 m; exported
  in the BOLTED position (slide by −travel along the axis to unbolt).
- Collision: `collider` (`wall|floor|stair|rail|porch|chimney|foundation`), `room`, optional `stair`, `surface`.

### Runtime loading notes (lane B)
- A multi-material room node exports as a glTF node whose primitives become child `Mesh`es under a `Group` in
  three: `room/atlas/lightmap/kind` extras are on the **parent** `userData` (merge parent + child, as
  `check_house.mjs` does). Material `userData.material_id` is on each primitive's material.
- `details_<atlas>.glb` and `doors.glb` are classified `prop` by the manifest but are NOT layout props: they are
  already in world space (doors at their pivot); do not re-place them with the prop loader.

### UV conventions
- **UV0 is in metres** (same rule as `blender/props`, `docs/PROPS.md`): runtime tiling = 1 / `tileMetres`.
  Walls: u along the wall (reads left→right from the front), v = z. Floors: u along the boards (the room's long
  axis). Sweeps (mouldings, rails, gutters): u along the run, v along the profile. Roof: u along the ridge, v
  down-slope. Clapboard: u along the facade, v = z.
- **Clapboard UV (exception, `exterior.clapboard_v`)**: the glTF exporter writes `1 − v` and the runtime generators
  see that value, so Blender `v = z` reaches a generator with `uv.y` DECREASING upward (true for every wall — lane B:
  any generator with a gravity direction, drips/streaks/lap profiles, sees walls upside down). Clapboard therefore
  uses Blender `v = 1 − (z − 0.83)` → runtime `uv.y = z − 0.83` (up), on the hero lap siding, the flat facades and the
  gables alike. Board exposure 0.10 m in geometry AND in the spec (`boardExposure 0.10`, tile 3 m → 30 rows), every
  course bottom on a row boundary (drip edge/lap shadow at t = 0), grain along u (horizontal). Verified from the GLB:
  |uv.y − (y − 0.83)| ≤ 2.4 cm (the house-lean deform only), course bottoms at t = 0.00.
- **UV2 ('Lightmap')**: two-level packer (`lmuv.py`): smart-project + our shelf packer for most parts, plus rigid
  planar charts (roof courses, clapboard sheet, porch deck, porch roof, terrain) that would otherwise explode into
  thousands of islands. 4-texel padding at 1024 (= 2 texels at the 512 Low tier). The house packs into
  `[0, 1 − PROPS_BAND]` of each atlas; the band on top belongs to that atlas's static props.

## What is built

- **Walls**: each wall side is its own half-slab (face → centre plane) owned by the room it faces, so partitions
  between atlases split cleanly. Exact rectangular openings (analytic, no Booleans) with reveals, room corners
  resolved by line intersection (`plan.py`), 2 cm hidden overlaps at inside corners/floors/ceilings (never coplanar
  with a visible face). `clipToStair` partitions follow the ST_MAIN soffit.
- **Floors / ceilings**: gridded slabs with the stairwell and floor-register holes, nested rooms (closet) cut out,
  slab liners in the stairwell and the register, the U4/U4T ceiling step.
- **Mouldings** (swept profiles with true mitres at inside AND outside corners): baseboard with shoe and cap, crown
  (hall, parlor, upstairs; cove in the kitchen/passage), picture rail, beadboard wainscot (V-grooved boards) with
  chair rail. Runs break at casings (with plinth blocks), stairs, floor/ceiling holes.
- **Windows** (2-over-2 double-hung): pulley stiles, head jamb, sloped sill with horns, blind/parting/stop beads,
  two sashes with a muntin, sash lock + lifts, wavy crown-glass panes (separate `glass` nodes), jamb extensions,
  stool + apron, capped casings; outside: casings, drip cap, bed mould, closed louvred shutters with strap hinges and
  pintles. `nailed` → cut nails through the lower sash (one bent), `nailed_shuttered` → nailed shutters too.
  The parlor shutter with `lightLeak` has some louvres cocked open.
- **Doors**: jamb linings, stops, casings with plinths (rough board casings in plank rooms), the front entrance
  with pilasters, frieze and cornice, transom bar + fanlight (radiating muntins), oak threshold, kitchen arch
  (cased opening). Leaves: 4-panel raised-and-fielded with sticking mouldings (front door heavier), knobs + roses,
  escutcheons, butt-hinge knuckles; louvred closet door; plank-and-batten wardrobe back.
- **Stairs**: ST_MAIN — bullnosed treads, painted risers, scotia under each nosing, wall string, closed outer string
  with cap, turned balusters (2 per tread), moulded handrail, panelled newels with ball finials, soffit (also the
  closet ceiling), landing nosing. ST_BACK — 3 kite winders about the SW corner then a straight flight west, wall
  strings, pole handrail on iron brackets.
- **Exterior**: real lap clapboard on the hero (south) facade incl. the gable (boards 3–4.8 m, staggered joints,
  warp and sag per board), flat clapboard planes elsewhere (fog), corner boards, water table with drip cap, frieze,
  boxed eaves (fascia, soffit, bed mould), rakes with soffit and frieze, cornice returns, wood-shingle courses
  (random widths, jittered butts, the odd curled shingle), ridge cap, half-round gutters + downspouts (SE one ends
  over the rain barrel), exterior brick chimney (shoulders, corbelled cap, flue pots, zinc flashing), rubble stone
  foundation with crawlspace vents, porch (deck boards with gaps and staggered joints, rim, lattice skirt, 3 steps
  with stringers, 5 posts with plinths and capitals, built-up beam, railings on the front and ends, shed roof with
  shingles, fascia, gutter, beadboard ceiling, flashing).
- **Imperfection** (`deform.py`): continuous seeded fields — house lean + waviness (mm), floors dip and ceilings sag
  toward mid-room, ridge/eave sag between the gables, porch roof and deck sag between posts.

## Measured (2026-09-30, M1 8 GB, dev bake 1024² @ 32 spp, Metal + OIDN CPU — BEFORE the props band/terrain; texel/m @1024 now: exterior 19.3 (with terrain), ground 35.4, parlor 55.7, kitchen 40.0, upper hall 51.0, upper rooms 35.8)

| Atlas | Lightmapped tris | Detail tris | UV2 islands | bbox fill | texel/m @1024 | bake (s) | job wall (s) |
|---|---|---|---|---|---|---|---|
| exterior | 52 867 | 23 212 | 1 871 | 0.40 | 23 | 7.6 | 17.4 |
| ground (hall, closet, passage) | 14 564 | 10 440 | 2 073 | 0.50 | 38 | 6.1 | 14.4 |
| parlor | 5 950 | 728 | 643 | 0.56 | 59 | 5.6 | 13.7 |
| kitchen (+ U4, U4T) | 7 930 | 364 | 1 354 | 0.53 | 48 | 6.3 | 13.9 |
| upper hall | 5 342 | 364 | 548 | 0.51 | 56 | 5.1 + flash 6.1 | 22.4 |
| upper rooms | 10 702 | 1 092 | 1 218 | 0.60 | 49 | 6.8 + flash 8.5 | 28.2 |

Doors: 14 952 tris. House build job: ~5 s. Per tier after the 2026-09-30 pass (dev bakes 1024², 32 spp):
**Low 19.9 MB** (lightmaps 2.7 MB at 512² m6 incl. LM_CAR, level GLBs 3.5, props 7.0, characters 5.5 + textures 1.1),
Medium 35.6 MB, Max 57.2 MB. Release bakes (`bake-release`, 2048²/128 spp) grow Max/Medium lightmaps, not Low.

Review renders: `scratch/house/` — lit (`hall`, `stair`, `parlor`, `upper_hall`, `facade`, `house_sw`), clay
geometry views (`c_*`), baked-lightmap views (`b_*`, emission = lightmap × albedo exactly like the runtime) and a
light-leak test (`leak`: interior lights off, sky ×25), plus `c_chimney_eave`, `c_gutter_end`, `c_steps`,
`c_siding_mid`, `terrain`/`b_terrain` and `car`/`b_car` (LM_CAR). The review appends the placed props.

## Terrain (`terrain.py`, node `EXT2_terrain` in `house_exterior.glb`, LM_EXTERIOR)

Height field over plan rect **x −22…22, y −41…16** (extras `terrain: true`, `terrainRect`, `terrainHole` = the house
footprint cut-out), 0.45 m grid whose lines include every exterior `surfaces[]` zone edge, so each quad carries one
material id (grass_wet, gravel_wet, mud_wet, asphalt_wet; the porch zone is mud under the deck). Crowned road (+4.5 cm),
flooded ditch south of the road (−0.28 m), two wheel ruts down the drive, 12 puddle dips (3–7 cm) in the ruts, mud
zones, yard and shoulders; no dips under props standing on the ground; heights feather to exactly 0 at the rect edge.
Walkable areas stay within ±5 cm of z = 0. ~14.3k quads, lightmapped as one planar chart (`lm_weight` 0.3 → ~6 texel/m
at 1024). The bake-only ground proxy is skipped when the terrain exists. **Lane B:** skip the runtime ground cells
(`partitionGround`) inside `terrainRect` (keep them outside as the far field at z = 0); the flat ground collider can
stay (≤ 5 cm error in the walkable area; the ditch is outside the play bounds).

## Coordination notes (other lanes)
- The layout props `porch` (P_PORCH) and `foundation_skirt` (P_FOUNDATION) are realised by the house builder —
  the props job must skip those two types.
- The ST_MAIN top newel stands at the stairwell corner (≈ x 1.16, y 7.86); `P_GALLERY_RAIL_E` should not add its own
  north newel there.
- `P_ADA_WARDROBE` (`wardrobe_loose_back`): the loose back boards are `door_D_WARDROBE_BACK` in doors.glb, set in the
  wall opening flush with the U3 face; the wardrobe prop should leave its back open over the 0.7 × 1.8 m opening.
- `blender/lib/bake.py`: fixed `bake_atlas` for materials shared by several baked objects (the bake-target node was
  removed twice).
- Static props are in every bake: `bake_house.py` appends `.cache/props/props.blend` (placed at layout pos/yaw);
  static props of the atlas are bake targets in its props band, every other prop is an occluder (colliders hidden).
- Fixed 2026-09-30: chimney dark slots (roof/eave were cut for the whole chimney base, 0.26 m wider than the stack on
  each side: now cut to the stack, shingles clipped per course, soffit infill between wall and stack, zinc step
  flashing + back apron on the shingles), gutter end caps (soldered half discs at every gutter end, also at the stack),
  porch stringers (closed/housed, plumb-cut at the bottom nosing instead of a wedge running onto the ground).
