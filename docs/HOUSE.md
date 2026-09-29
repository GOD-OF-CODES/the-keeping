# House shell (lane A) — `blender/house/`

Generated entirely from `src/shared/level-layout.json` by Blender Python (no Booleans, no downloaded assets).

## Commands

| What | Command |
|---|---|
| Build the shell + GLBs + `.cache/house/house.blend` (shell only, no bakes) | `npm run assets -- --only house` |
| Everything (shell, then the six bakes, in pipeline order) | `npm run assets` |
| Dev bakes (1024², 32 spp, one atlas per process) | `npm run assets -- --only bake-house` (or `--only bake-house-ground`, …) |
| **Full-quality bake (release)** — browser closed, ~2.4 GB per process | edit the six `bake-house-*` jobs in `blender/pipeline.json` to `--size 2048 --samples 128`, then `npm run assets -- --only bake-house --force` |
| Review renders → `scratch/house/*.png` | `npm run assets -- --only house-review` |
| GLB contract check (three r186 GLTFLoader in Node) | `node blender/house/check_house.mjs public/assets/max` (runs as the house job's post-check) |
| Layout analysis without Blender | `python3 blender/house/plan.py` (room wall chains, corners, facades) |

## Outputs (identical in `public/assets/{low,medium,max}/`)

| File | Contents |
|---|---|
| `house_<atlas>.glb` (`ground`, `parlor`, `kitchen`, `upper_hall`, `upper_rooms`, `exterior`) | Static, lightmapped geometry: one node per room (+ `<room>_stair`, `<room>_glass_<opening>`, exterior parts). `uv` = UVMap, `uv1` = Lightmap. Meshopt. |
| `details_<atlas>.glb` | Small static parts NOT in the lightmap (nails, hinges, sash locks, balusters, louvres, lattice slats, ridge caps, gutter hangers, downspouts, vent bars). Probe-lit at runtime; they are occluders in the bake. |
| `doors.glb` | Door leaves, Ada's 3 boards, the passage bolt (parented to its leaf). Probe-lit (no uv1). |
| `collision.glb` | Collision proxies (convex boxes / prisms, faces wound outward), joined per (collider kind, room). |
| `lm_<atlas>.klm` + `.json` | Lightmaps (KLM, `docs/SMOKE.md`), `lightMapIntensity = π`, sample at `(uv1.x, 1 − uv1.y)`. |
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
- **UV2 ('Lightmap')**: two-level packer (`lmuv.py`): smart-project + `pack_islands(AABB)` for most parts, plus rigid
  planar charts (roof courses, clapboard sheet, porch deck, porch roof) that would otherwise explode into thousands
  of islands. 4-texel padding at the smallest (1024) tier.

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

## Measured (2026-09-30, M1 8 GB, dev bake 1024² @ 32 spp, Metal + OIDN CPU)

| Atlas | Lightmapped tris | Detail tris | UV2 islands | bbox fill | texel/m @1024 | bake (s) | job wall (s) |
|---|---|---|---|---|---|---|---|
| exterior | 52 867 | 23 212 | 1 871 | 0.40 | 23 | 7.6 | 17.4 |
| ground (hall, closet, passage) | 14 564 | 10 440 | 2 073 | 0.50 | 38 | 6.1 | 14.4 |
| parlor | 5 950 | 728 | 643 | 0.56 | 59 | 5.6 | 13.7 |
| kitchen (+ U4, U4T) | 7 930 | 364 | 1 354 | 0.53 | 48 | 6.3 | 13.9 |
| upper hall | 5 342 | 364 | 548 | 0.51 | 56 | 5.1 + flash 6.1 | 22.4 |
| upper rooms | 10 702 | 1 092 | 1 218 | 0.60 | 49 | 6.8 + flash 8.5 | 28.2 |

Doors: 14 952 tris. House build job: ~4 s of Blender Python (whole house, UV2, 3 exports). Low tier: the house uses
~16 MB of the 25 MB budget with dev (noisy, 32 spp) lightmaps — ~12 MB of that is KLM; release bakes (128 spp,
2048 base) compress to ~1 MB per atlas at Low (docs/SMOKE.md), which brings the house to ~10 MB.

Review renders: `scratch/house/` — lit (`hall`, `stair`, `parlor`, `upper_hall`, `facade`, `house_sw`), clay
geometry views (`c_*`), baked-lightmap views (`b_*`, emission = lightmap × albedo exactly like the runtime) and a
light-leak test (`leak`: interior lights off, sky ×25).

## Coordination notes (other lanes)
- The layout props `porch` (P_PORCH) and `foundation_skirt` (P_FOUNDATION) are realised by the house builder —
  the props job must skip those two types.
- The ST_MAIN top newel stands at the stairwell corner (≈ x 1.16, y 7.86); `P_GALLERY_RAIL_E` should not add its own
  north newel there.
- `P_ADA_WARDROBE` (`wardrobe_loose_back`): the loose back boards are `door_D_WARDROBE_BACK` in doors.glb, set in the
  wall opening flush with the U3 face; the wardrobe prop should leave its back open over the 0.7 × 1.8 m opening.
- Terrain (EXT1/EXT2 ground, road) is not part of the shell; the bake uses a bake-only ground proxy.
- `blender/lib/bake.py`: fixed `bake_atlas` for materials shared by several baked objects (the bake-target node was
  removed twice).
- Static props are not yet in the bake scene (they should join as occluders, and static props need their own UV2 in
  the atlas when they become lightmapped).
