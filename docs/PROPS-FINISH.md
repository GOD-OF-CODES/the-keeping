> **Lead approval (2026-10-08):** §8 requests R1–R6 are APPROVED as written (see docs/ROADMAP.md "Lead rulings"); the builders may edit `src/shared/material-types.ts` and `scripts/layout/materials.mjs` for them.

# PROPS-FINISH — the prop finishing system (wear masks, wear shading, detail, decals)

Design by the props-finishing designer, 2026-10-08. Input: `docs/PROPS-FINISH-AUDIT.md` (29 ranked rows, causes X1–X6).
Two builders implement it, one after the other:
**Builder 1 (Blender, props lane):** §1 bake + export, §3 geometry, §4 the Blender half of the decal anchors.
**Builder 2 (runtime):** §2 the wear shading in `src/materials/bind.ts` plus the new `src/materials/wear.ts`, and §4 grime
decals in `src/world/decals.ts`.
The contract between them is §5. Builder 2 can start from a single test GLB (§6 step 1), so it doesn't wait for every
prop to be re-exported.

Everything here was checked against the code in the tree: Blender 5.2's `io_scene_gltf2`, three r186 `GLTFLoader.js`,
`WebGPUAttributeUtils.js`, `VertexColorNode.js`, `MathNode.js` and `MaterialXNoise`, and `assets.mjs --check`.

---

## 1. How wear data reaches the runtime

### 1.1 Budget facts (measured 2026-10-08, `node scripts/assets.mjs --check`)

| tier | used | budget | headroom | prop GLBs | prop vertices |
|---|---|---|---|---|---|
| Low | 26.07 MB | 27 MB | **0.93 MB** | props_m1/m2/road = 7.5 MB | 351 k (decimated `low_lod` copies) |
| Medium | 48.37 MB | 60 MB | 11.6 MB | 10.7 MB | 577 k |
| Max | 66.41 MB | 120 MB | 53.6 MB | same files as Medium | 577 k |

### 1.2 Decision: per-vertex masks in COLOR_0, not mask textures

- **Vertex masks.** Four channels at 8 B per vertex raw. Meshopt shrinks smooth, slowly-varying data like this to
  about 2–4 B per vertex (an estimate; §6 step 1 measures it). The masks move with the prop: the hammer, cans, shears
  and locket all get picked up. They need no new UVs, add no draw calls, add no texture fetches, and three already
  supports them.
- **Mask atlases on UV0 were rejected.** UV0 is in metres and tiles (kit.py `_box_uv`). An atlas would need a third UV
  set (UV1 is the lightmap set on static geometry), plus one texture per prop or a packing step. That costs 15–40 KB
  per prop as webp, and Low cannot afford it.
- **Where vertex masks are too coarse,** the band shape comes from geometry: the support loops in §1.4. Masks never
  depend on texel density.

### 1.3 Channel layout (the contract is in §5)

One Blender colour attribute named **`wear`**, of type `BYTE_COLOR` on the `POINT` domain. It exports as glTF
`COLOR_0`, VEC4, `UNSIGNED_SHORT` normalized. This is verified: in Blender 5.2 `primitive_extract.py` maps BYTE_COLOR
to UnsignedShort and `primitive_attributes.py` l.183 does the ×65535 normalisation. Values are **linear 0..1**; write
them through `.color`, never `.color_srgb`.

| ch | name | meaning (1 = maximum) | how Builder 1 bakes it |
|---|---|---|---|
| R | **edge** | exposed convex edge, scaled by how worn this prop is | bmesh: per-vertex convexity from the dihedral angles of adjacent faces (convex > 30° → 1, smoothstep 10°–45°). Support-loop rings get 0 (§1.4). Multiply by `wear_age`. |
| G | **cavity** | occluded crevice: joints, inside corners, recesses, the area under a lip | Per-vertex ray AO with `mathutils.bvhtree.BVHTree.FromObject` over the whole prop: 48 cosine rays, max distance 0.03 m, origin offset 0.2 mm along the normal. Deterministic, needs no render, and is fast on the M1. Cycles `bake(type='AO', target='VERTEX_COLORS')` is the fallback. Stored as `1 − AO`. Max it with concavity (dihedral concave > 20°). Multiply by `grime_age`. |
| B | **handled** | how often hands and feet touch this area (grips, knobs, the front rail, the top of the handle) | Sum of spherical falloffs around named **handle anchors** (§5.3): `exp(−(d/r)²)`, radius `r` from the anchor's extras. Clamp to 1. Multiply by `use`. |
| A | **dust** | where dust settles in the rest pose: up-facing **and** open to the sky **and** not handled | `smoothstep(0.5, 0.95, n_z)` × sky visibility (AO bake restricted to the +Z hemisphere, i.e. a cone up ±60°) × `(1 − B)`. Multiply by `dust_age`. |

The four scalars per object (`wear_age`, `grime_age`, `use`, `dust_age`, each 0..1) live in the generator's
`PropSpec`. They are baked into the amplitudes, so the runtime material stays **shared per spec** (§2.1). Defaults
come from the story: the house has stood shut for about 30 years and only Harlan uses a few things.
`edge` 0.6, `cavity` 0.8, `handled` 0 except on story-handled props, `dust` 0.7.

### 1.4 Band shape: support loops (decided — POINT-domain masks bleed without them)

- **The problem.** On a bevelled box, the large flat face's only vertices are the bevel-boundary vertices, so a
  POINT-domain edge mask would smear across the whole face.
- **The fix.** kit.py gains `wear_loops(bm, width)`. It runs `bmesh.ops.inset_region` with `thickness=width`,
  `depth=0` and `use_even_offset=True` on every planar face region larger than 3·width that touches a convex edge.
  The new inner ring gets edge = 0, and the bevel plus the outer ring keep edge = 1. The runtime then sees a linear
  ramp from 0 to `width` over which it thresholds with noise. **Default widths:** furniture and painted wood 8 mm,
  tools and hardware 3 mm, sheet metal (jerry can, enamel) 5 mm, books and paper 2 mm. Real paint chips on
  household edges are 1–6 mm, with rare 10–20 mm flakes (Lehmann, *Paint Failure Atlas*, 2010).
- **Order inside kit.py `Part.build()`** (convexity and AO depend on the final mesh):
  1. bevel;
  2. `wear_loops`, which runs **before** `_box_uv`, so UV0 is computed on the final topology rather than relying on
     the inset's UV interpolation;
  3. jitter / sag;
  4. `_box_uv`;
  5. apply `WEIGHTED_NORMAL`;
  6. `bake_wear_masks`;
  7. export.
- **The cost.** About 4 vertices per inset face, roughly +20–35 % vertices on box-heavy props and almost none on
  lathed ones. Builder 1 reports the before/after vertex counts per file.
- **Side benefit.** These are the same hard-surface support loops that X2 needs. With the bevel and a
  `WEIGHTED_NORMAL` modifier (`keep_sharp=True`, `weight=50`, mode FACE_AREA; apply it before export), the faceting
  and razor edges go away. Once X2 ships, `toCreasedNormals` in `src/world/opening.ts` l.110–131 can be removed.
- **Optional on Max: a curvature term.** `κ = length(fwidth(normalWorld)) / max(length(fwidth(positionWorld)), 1e-5)`
  (`fwidth` is verified at MathNode.js l.817) sharpens bevel highlights. Gate it with `edge > 0` and clamp it. At
  grazing angles under 10° it is noisy, so fade it by `abs(dot(N, V))`. It is not required; build it only if review
  shows the bands too soft.

### 1.5 Per-tier policy

- **Medium and Max.** Every prop in props_m1, props_m2 and props_road gets `wear`. Estimated cost: 577 k × (2–4 B) ≈
  1.2–2.3 MB, plus about +25 % vertices from the support loops ≈ another 1.5–2.5 MB (positions, normals, UV). That
  fits the 11.6 MB headroom.
- **Low.** `low_lod` copies keep `wear` **only for the HERO set**: rows 1–20 of §3 (the props you handle, read or
  take; about 40 k vertices is an **estimate**, and §6 step 1 sums the real per-prop counts). The decimate modifier interpolates point colour attributes, so the masks survive.
  Everything else is exported without the attribute (remove it with `mesh.color_attributes.remove` before export),
  and support loops are added only on the HERO set. Estimate: ≤ 0.35 MB, which leaves Low at least 0.5 MB of
  headroom. If the step-1 measurement shows more than 0.6 MB, shrink HERO on Low to rows 1–12.
- **Only if Low still overflows:** a `glTF2ExportUserExtension.gather_attribute_change` hook (it is called at
  `primitive_attributes.py` l.189) could requantise COLOR_0 to UNSIGNED_BYTE, halving the bytes. This is unverified,
  so **verify before relying on it.**
- **Max later (optional):** a second attribute `wear2` exports as `COLOR_1`, which three reads as `color_1`
  (GLTFLoader l.4871 lowercases unknown names). It could carry rust-bloom, soot-source and stain seeds. Not in this
  round.

### 1.6 Export and load path

What is verified: the exporter option, the accessor layout, and the loader, WebGPU and TSL layers. The meshopt leg is
read from the source: Blender 5.2 `io/exp/meshopt.py` `encode_attribute` applies **no filter** to COLOR_0. It
compresses the attribute with the plain vertex codec at its native 8-byte stride, and three's MeshoptDecoder decodes
that generically. The compressed size is an estimate until §6 step 1 measures it.

1. Blender: `blender/lib/export.py`. The `'static'` preset is used by `build_props.py` l.223/240. Add a props-only
   override `export_vertex_color='NAME', export_vertex_color_name='wear'`, passed as `export_glb(..., **overrides)`.
   Do **not** change COMMON, because the house, characters and trees must stay unchanged. **Check:** `export.py`'s
   `inspect_glb` should list `COLOR_0` on masked primitives only.
2. three: GLTFLoader maps `COLOR_0` → geometry attribute `color` (l.2285). Because the attribute exists, it clones the
   glTF material with `vertexColors = true` (l.3558). `bindMaterials` **replaces** that material, and the new
   NodeMaterial has `vertexColors = false`, so albedo is not multiplied by the mask.
   **Hazard:** a masked primitive whose material has no spec id keeps the cloned material and gets its albedo
   multiplied by the mask. `check_props.mjs` therefore fails any masked primitive without a `material_id` (§6).
3. WebGPU: Uint16Array plus `normalized` → `unorm16x4` (WebGPUAttributeUtils l.16). WebGL2 uses
   `gl.UNSIGNED_SHORT` with normalized=true. Both give a vec4 of 0..1 in the shader.
4. TSL: `attribute('color', 'vec4')` (AttributeNode.js l.168). **Do not use `vertexColor()`:** it silently returns
   white (1,1,1,1) when the attribute is missing (VertexColorNode.js), which would read as fully worn. The runtime
   branches in JS on `!!mesh.geometry.attributes.color` (§2.1).
5. Colour management: masks are linear, and `ColorManagement.workingColorSpace` is linear, so the loader issues no
   conversion warning (l.4892).
6. Moving props: wear noise uses **`positionLocal`** (object space; Position.js l.45), so chips stay on the hammer
   when it is lifted. The existing macro, stain and dust layers use `positionWorld`. They stay as they are for
   unmasked meshes; masked meshes switch to local space. There is no GPU instancing of props (`export.py` has no
   `gpu_instancing`, and src has no InstancedMesh for props), so each placement keeps its own mask.

---

## 2. Runtime wear model (TSL)

### 2.1 Wiring

- **New file `src/materials/wear.ts`.** It exports
  `applyWear(spec, albedo, rough, metal, normalNode, opts) → { albedo, rough, metal, sheenRough? }`.
  `createSurfaceMaterial` calls it after the macro and stain layers and **before** dust and wetness, and only when
  `o.wearMask === true`.
- **`bindMaterials`.**
  - The shared-material key gains `|${hasColor ? 'w' : ''}`.
  - It passes `wearMask: hasColor`. Low needs no extra preset check, because the Low files only carry masks on HERO
    props.
  - On Low the model runs in **cheap mode**: no Worley, one noise octave.
- **The wear sees no tiling.** All wear noise is object-space and non-periodic: `mx_noise_float`,
  `mx_fractal_noise_float` and `mx_worley_noise_float` on `positionLocal × f` (verified in MaterialXNoise /
  `three/tsl`). The periodic `tsl-noise.ts` library stays for baked tiling maps. When a family needs grain-aligned
  breakup (varnish), it can sample the already-baked map A luminance as a modulator. That costs no extra fetch,
  because the map is already sampled.
- **Masked meshes skip the generic dust layer.** For them `dustAmt × mask.a` replaces the `normalWorld.y`
  up-facing term, so dust moves with the prop.
- **Mask helpers.** `const M = attribute('color','vec4')`; `E = M.x`, `C = M.y`, `H = M.z`, `D = M.w`.
- **Thresholded chip.** `chip(E, f, cov) = smoothstep(cov − 0.04, cov + 0.04, E × (0.55 + 0.45·n))`, where
  `n = mx_fractal_noise_float(positionLocal × f, 3)·0.5 + 0.5`. `cov` = 1 − the spec's coverage parameter.
  Real chips have hard boundaries, hence the ±0.04 edge.

### 2.2 Per-family rules (numbers in albedo sRGB-linear luminance / roughness; sources in brackets)

New optional spec block `params.wear = { … }`. It is lead-owned: §8 request R1. Any value it omits falls back to the
defaults below.

| family (spec ids) | E edge | H handled | C cavity | D dust | other |
|---|---|---|---|---|---|
| **wood_painted** (door_painted, wainscot, trim_chipped, painted furniture) | chip, f = 220 /m (1–5 mm chips). Two layers: paint → primer (albedo 0.60, rough 0.85, lead-white primer) at chip > 0.5, then bare weathered pine (0.28, rough 0.75) at chip > 0.8. Chip rim darkens ×0.85 over 0.5 mm, using a second threshold at cov+0.03. | Paint burnished: rough −0.15 (old oil enamel 0.45 → 0.30), grime tint ×0.85 brown (0.85, 0.80, 0.72) | Grime ×0.55 albedo, rough +0.1 | §2.3 | — |
| **wood_bare / furniture varnish** (wood_furniture_dark, hall_table, nightstand, rocker, ledger boards) | Varnish worn through: albedo ×1.9 (0.10 → 0.19, bare walnut / oak), rough 0.25 → 0.55. Soft noise threshold, not chipped: varnish abrades, it doesn't flake (smoothstep width 0.15). | Skin oil and wax re-polish: albedo ×0.85, rough → 0.22 on varnish, 0.35 on bare. The rocker arms, drawer fronts round the pull, chair top rail. | Old wax + dust in joints: albedo ×0.45, rough 0.6 | §2.3 | Tops: varnish micro-dulling rough +0.08 × D (rest pose up). Water rings → decals §4. |
| **wood raw** (wood_raw_plank, sawbuck, can_shelf, sign_post) | Arris rounding lighter: albedo ×1.15, rough +0.05 (UV-greyed lignin wears off) | Darkened by hands: ×0.7, rough −0.15 (a sawbuck's handled rail goes dark brown) | Dirt ×0.6 | §2.3 | Exterior wood (sign_post): vertical streaks are decals §4. |
| **chrome / steel** (steel_cleaver, shears, hammer face, flashlight) | Edge polish: metal 1, rough 0.12 (fresh-ground steel 0.1–0.2), albedo F0 0.56 grey (steel F0 ≈ 0.56, Gulbrandsen/ref. index data) | Polished: rough 0.18 | Rust bloom: metal → 0, albedo (0.29, 0.13, 0.06) × 0.6 (Fe₂O₃ / FeOOH 0.1–0.3), rough 0.85, coverage = smoothstep on C × Worley(f = 90 /m) | Dust on flats only | Blades: `edge` set to 1 on the whole bevel ground, so the honed edge reads as a bright line, 0.5–1 mm. |
| **cast_iron** (iron_stove, bell_crank, counterweight, pulleys, hammer head until it is re-specced) | Stove-blacking worn off: metal 0.8, rough 0.35, albedo 0.45 grey (bare cast iron) | Polished dark: rough 0.3 | **Soot** near heat (stove only, via the anchor `soot` (§5.3)): albedo 0.025, rough 0.95, metal 0 (carbon black ≈ 0.02–0.05) × C. Elsewhere rust (as steel) × C × 0.6. | — | Blacking base: albedo 0.04–0.06, rough 0.55–0.7. |
| **metal_brass** (candle rings, lamp burner, locket, bell knob) | Polished: rough 0.15, albedo F0 brass (0.91, 0.78, 0.42) | Same, stronger: rough 0.12 | Tarnish: albedo (0.08, 0.07, 0.04), rough 0.6, metal 0.3 (brown-green Cu₂O / CuCO₃) | — | Locket: the H anchor on the clasp and bail. |
| **enamel** (enamel_chipped, sign_sheeting) | Chip to black iron: albedo 0.04, rough 0.5, metal 0.6, chip f = 160 /m. A rust halo ring, 0.3 mm wide (threshold cov+0.05), brown (0.25, 0.11, 0.05). | — | Rust as steel | §2.3 | — |
| **painted sheet steel** (jerry_can: today the `rust` spec, which needs a painted-steel spec, §8 R3; wrecks car_paint_wreck; zinc) | Paint chip to primer red-oxide (0.30, 0.12, 0.07), rough 0.7, then bare steel 0.5/0.4/metal 1 at > 0.85 | Handle polished to bare steel, rough 0.3 | Rust × C | §2.3 | Jerry can: per-can `wear_age` varies 0.4–0.9 by placement seed (Builder 1). |
| **leather** (leather_worn, ledger corners) | Edge scuff lighter: ×1.35, rough +0.15, desaturate 30 % | Darker, glossier: ×0.75, rough 0.6 → 0.35 | ×0.6 | §2.3 | — |
| **fabric / flannel / crepe / burlap / rug / car_interior** | Pilling + nap loss: albedo ×1.08, desaturate 15 %, rough 1.0, sheenRoughness 0.6 → 0.9 | Shine from use (car seat bolster, bell pull): rough −0.2, sheenRough −0.2, ×0.85 | Stains: ×0.7 tinted (0.62, 0.52, 0.38) with a tide rim (reuse the `clothStain` rim math) | Dust stronger (fabric traps it): ×1.3 | — |
| **paper** (letter, ledger pages, guest book, ticket, photo) | Edge soil and foxing: ×0.88, tint (0.95, 0.88, 0.75), Worley foxing dots f = 400 /m at E > 0.3 | Thumb soil at corners: ×0.8 grey | — | none (it is read while held) | Page variation is per document via decals.ts `paintPaper` (§4). |
| **wax** | — | — | — | — | Soot on the wick top: a decal (§4). |
| **glass / skin / hair / grass / ground / house families** | masks not exported; wear is not applied | | | | |

### 2.3 Dust (all masked families)

- **Formula.** `d = D × dustAmt × uDust × smoothstep(0.3, 0.7, n2)`, where
  `n2 = mx_fractal_noise_float(positionLocal × 6, 2)·0.5 + 0.5` and `dustAmt` comes from the spec (default 0.5 for
  furniture and metal: §8 R2).
- **Look.** Albedo lerps to DUST_RGB (house dust ≈ 0.35–0.45 grey-brown) by `d × 0.8`, roughness goes to 0.97, and
  metal is multiplied by (1−d).
- **Thickness cue.** The dust edge is soft (smoothstep 0.25, rather than the hard chip edge). Real household dust
  takes 3–6 months to show visibly on dark varnish. After 30 years it is a felt-like layer, so `dust_age` = 0.7–0.9
  on untouched props.

### 2.4 Costs and caps

- **ALU.** About 25–40 extra ALU ops per pixel per masked material on Medium/Max: 2 fractal-noise calls, plus 1
  Worley only on metal families. Low cheap mode: 1 noise call, no Worley.
- **No new textures and no new draw calls.**
- **Shader variants.** Up to 2 per spec (masked or not). There are 86 specs, but only about 30 families of specs
  are used on props, so at most about 30 new pipelines. Compile them through the existing precompile path.
- **Budget gate:** Medium fps loss ≤ 2 fps in g1, g2 and u2 (§6).

### 2.5 Don'ts

- Never brighten above physical albedo. Bare wood stays at most 0.35 and primer at most 0.65.
- Never apply wear to glass.
- Never let edge wear exceed 15 % of a prop's visible area. The `wear_age` scalar caps it; review it in §6.

---

## 3. Geometric detail: the top 25 props (Builder 1)

### 3.1 Rules for every prop below

**(a) Smooth shading and segments (X2 from the audit)**
- Apply `wear_loops` (§1.4), a bevel of 0.6–1.5 mm on handled hardware and 2–3 mm on furniture, and `WEIGHTED_NORMAL`.
- Minimum radial segments: 16 for anything under 3 cm across that is seen within 1 m; 24 for turned legs, rails and
  lathes; 32 for hero lathes (candle, lamp font, locket).

**(b) Imperfection (X5 from the audit)**
- Deterministic `jitter` of 0.3–1 mm, seeded per placement.
- Boards sag 2–5 mm per metre under load.
- Paper lifts 1–4 mm at its corners.

**(c) Hardware (X4 from the audit)**
- New kit.py helpers, all ≤ 120 tris each:
  - `screw_head(d, slot=True)` — slotted wood screw, #8 is 7.9 mm; slot 1.2 × 0.8 mm deep.
  - `nail_head(d)` — cut nail, 4–6 mm rectangular head.
  - `hinge_butt(h, w)` — 2.5″ butt is 64 × 50 mm; knuckle Ø 6 mm in 5 knuckles, 3 screws per leaf.
  - `escutcheon(h)` — 40 × 18 mm keyhole plate with a 10 × 4 mm keyhole slot.
  - `knurl(r, h, n)` — straight knurl at 0.8 mm pitch.

**(d) Handle anchors**
- Add the anchors listed below, using the `anchor(part, 'wear_handle', loc, {'r': ...})` empties (§5.3).

**(e) Triangle budgets**
- Remain inside `prop(..., budget)`. If a budget must rise, log it in the generator and in STATUS.
- The scene-wide gates are ≤ 1.5 M tris and ≤ 400 draw calls on Medium per room. Hardware is merged into its parent
  part's mesh, so it adds no draw calls.

### 3.2 The props

| # | prop | geometric detail (real-world reference numbers) | wear scalars (edge/cavity/use/dust) + anchors |
|---|---|---|---|
| 1 | letter | Sheet 0.1 mm, folded in thirds: 2 fold creases, each a 3-vertex ridge 0.4 mm high. Envelope 0.2 mm, Commercial No. 10 (105 × 241 mm). Diamond back seams overlapping by 0.2 mm, a gummed flap with a curl of 2–3 mm, a torn opening edge (jagged 1–2 mm on a 24-segment edge). | 0.3/0.2/0.6/0 · anchors: two corners |
| 2 | locket | Oval 30 × 24 × 8 mm (Victorian locket). Two shells with a 0.3 mm parting line, 3-knuckle hinge Ø 1.6 mm, bail ring Ø 6 mm at 12 sides, chain of **real links** (oval 3 × 2 mm wire Ø 0.5 mm, instanced into the mesh, ~60 links × 24 tris), a front engraving groove (a scroll curve, inset 0.2 mm). | 0.5/0.9/0.8/0 · anchors: clasp and bail |
| 3 | ledger_book | Page block with an inset fore-edge 1.5 mm smaller than the cover (squares 3 mm), a concave fore-edge curve 3 mm, page-edge stacking (layers of 6 bands at ±0.2 mm), raised spine bands ×5 (2 mm), corner protectors, a ribbon. | 0.7/0.8/0.7/0.6 · anchors: bottom fore-edge corner, spine top (pulled off the shelf) |
| 4 | guest_book | Re-enable the cover curl (`small_items.py` l.109, remove `* 0`). Page grid 10×1 → 16×12. Gutter dip 6 mm, page block step 2 mm, open spread with a 4 mm page lift at the outer edges, a pen groove or a pen. | 0.6/0.8/0.6/0.5 · anchors: lower page corners |
| 5 | bus_ticket | 57 × 30 mm card 0.25 mm thick, a 16×8 grid, one diagonal crease, a perforated stub edge (14 notches at 1.5 mm pitch along one short side), a 1 mm corner dog-ear. | 0.4/0/0.7/0 |
| 6 | sewing_shears | 8″ dressmaker shears (203 mm). Two blades with a ground bevel, pivot screw Ø 6 mm with a slot, bent offset handles in black japanned iron (bows 24 × 50 mm and 20 × 30 mm), 1 mm ricasso step. Material: polished steel + japanned (§8 R3). | 0.8/0.6/0.9/0.3 · anchors: both bows, pivot |
| 7 | claw_hammer | 16 oz: head 125 mm, octagonal neck, polished striking face Ø 28 mm crowned 0.5 mm, claw V-slot 3 mm, hickory handle 330 mm oval 32 × 24 mm with an end-grain wedge visible at the eye, and the handle at 16 segments. Head is forged steel, the handle hickory spec (§8 R3). | 0.8/0.7/0.9/0.4 · anchors: grip at 70–85 % of the handle length, the face |
| 8 | jerry_can | 20 L military pattern, 470 × 340 × 165 mm. Pressed X-ribs 6 mm deep, a 10 mm perimeter weld bead at 24 segments, 3-handle top (Ø 16 mm tubes), cam-lever cap with a pin, recessed panels. Cans are separate meshes with 5–15 mm gaps, never one box. | per-can 0.4–0.9 / 0.7 / 0.6 / 0.5 · anchors: centre handle |
| 9 | bell_pull_embroidered | Strip 1300 × 60 × 3 mm with a 3 mm turned hem border on both sides, a brass end-cap 70 mm with a ring, a tassel (48 cards, 120 mm), embroidery as a raised 0.5 mm relief (a decal mesh with displacement from a pattern curve). Material: wool-embroidery spec (§8 R3). | 0.4/0.6/0.9 (bottom 30 cm)/0.6 · anchor: bottom grip |
| 10 | sedan_interior | Weighted normals on seat_front, glovebox and ashtray (removes the runtime crease fix). Seat piping Ø 5 mm, stitched-panel grooves at 1.5 mm, a steering-wheel finger-grip ripple (36 lobes), ashtray lid hinge. | 0.5/0.8/0.8 (wheel rim, driver bolster, gear knob)/0.3 |
| 11 | candle | Real taper Ø 22 mm. Melt crater 4 mm deep with a raised rim, wick 1.5 mm with a black curled 4 mm tip, 3–5 asymmetric drips, holder rings at 32 sides, socket at 32. | 0.3/0.9/0.4/0.6 · soot anchor above the wick (decal §4) |
| 12 | kerosene_lamp | Font Ø 120 mm at 32 lathe segments, a knurled burner thumb-wheel (Ø 18 mm, knurl 0.8 mm), a perforated gallery (24 slots), chimney glass 2 mm wall with a thick lip, a fill screw. | 0.6/0.9/0.8 (thumb-wheel, handle)/0.7 |
| 13 | sewing_basket | 12 swallowtail fingers, copper tacks (Ø 3 mm domes, 2 per finger), a 1.5 mm lid gap, bentwood handle at 16 segments, thread spools inside. | 0.6/0.8/0.7/0.6 · anchors: lid knob, handle |
| 14 | whetstone | Combination stone 200 × 50 × 25 mm with the face **dished 1.5 mm** at its centre, a wooden box base with a 6 mm lip, chipped corners. | 0.6/0.8/0.5/0.5 |
| 15 | hog_cleaver | Blade 180 × 100 × 4 mm tapering to a 0.5 mm edge with a ground bevel 6 mm, 3 brass rivets Ø 6 mm, wooden scales with a 0.5 mm gap, a hanging hole Ø 8 mm. Spec: steel_cleaver (§8 R3). | 0.8/0.8/0.8 (handle)/0.4 |
| 16 | nightstand | Drawer reveal 2 mm with drawer box sides visible, 2 butt hinges (§3.1c), an escutcheon, carcass back panel, 3 mm top overhang ovolo. | 0.6/0.8/0.6 (knob ring)/0.8 |
| 17 | rocking_chair | 24-segment spindles and legs, through-tenon pegs Ø 9 mm, asymmetric rockers (±2 mm), arm wear flats. | 0.7/0.8/0.9 (arms, top rail)/0.6 |
| 18 | dress_dummy | Cloth-sim folds (Blender cloth, 40 frames, applied), a screw collar on the stand and a turned finial, a 24-segment pole. | 0.3/0.7/0.3/0.8 (shoulders) |
| 19 | photo_frame | Moulding profile sweep (ogee 25 × 15 mm), mitre lines 0.3 mm, glass 2 mm with an edge, a card backing with 4 brads. | 0.5/0.9/0.3/0.7 |
| 20 | hall_table | Drawer reveal 2 mm, hinges and escutcheon, legs at 24 segments, apron joint lines 0.5 mm. | 0.6/0.8/0.5 (drawer front)/0.7 |
| 21 | mirror_crepe | Frame profile sweep; crepe drape via cloth sim; mirror desilvering is a decal (§4). | 0.4/0.9/0/0.7 |
| 22 | door-mechanism group | Bevels plus support loops on bolt_box, rope_pulley, counterweight, spring_bell and bell_crank. Pulley groove at 24 segments, rope twist (3-strand, `twist`), crank pivots with split pins. | 0.6/0.9/0.4/0.6 |
| 23 | mailbox / sign_post / vacancy_plate / road_card | Nail and bolt heads (§3.1c), sign-post end-grain checks (3–4 cracks 1 mm wide), mailbox flag pivot rivet, plate fixing screws. | 0.7/0.9/0.2/0 (outdoor: rain-washed) |
| 24 | can_shelf | Boards sag 3–5 mm, L-brackets with 2 screws each, nail heads at the ends, can rings on the shelf as decals (§4). | 0.5/0.9/0.3/0.8 |
| 25 | kitchen group | iron_stove oven door weighted normals, stove-blacking edge wear and a soot anchor at the firebox; pump handle wear; coat_hooks bevelled at 16 segments. | stove 0.6/0.9/0.6/0.5 |

---

## 4. Decals (grime) — one system, an extension of the text decals

### 4.1 Blender side (Builder 1)

- **The helper.** kit.py gains `grime(part, quads)`. It builds **one child Part per prop**, named `<part>_grime`,
  holding all of that prop's grime quads. That is one mesh and one extra draw call per prop that has grime, and only
  about 20 props need it.
- **Quads.**
  - Each quad lies 0.3 mm above its base surface, oriented to the surface it sits on, with corner UVs pointing into
    one cell of the shared **grime atlas**: a 4×4 grid, `cell = row*4+col`, UV = (col + u)/4, (row + v)/4, v up as in
    `decal()`.
  - On curved surfaces (candle sides, soot above lamp chimneys), use a subdivided quad (4×4) shrink-wrapped to the
    surface (`bmesh` raycast projection).
- **Extras on the child.**
  - `{'decal': 'grime', 'grime': [[cell, seed], …], 'decal_size_m': [w, h]}`. The `decal` key is the same one the
    existing loader in `decals.ts` dispatches on.
  - The child's material is **`grime_decal`** (a new spec, `constant`; §8 R1). It is replaced at load anyway; the id
    only satisfies `check_props`.
- **Masks.** Grime quads carry no `wear` attribute; strip it.

### 4.2 Runtime side (Builder 2, `src/world/decals.ts`)

- **New `case 'grime'`.** It paints the atlas once per session into a 1024² CanvasTexture (512² on Low) with
  procedural canvas drawing. No downloaded art; the shapes are seeded per cell.
- **Material: `MeshStandardNodeMaterial`.**
  - Colour comes from the atlas.
  - Opacity comes from atlas alpha, with `transparent = true` and `depthWrite = false`.
  - Roughness comes from a per-cell value packed in the atlas: either the alpha-tinted G of a second canvas, or a
    uniform per cell via `uv()` → cell index lookup in a constant table.
  - Keep `polygonOffset` (factor −1, units −2) and `lightsNode`, as the text decals do.
  - One material per session: all grime meshes share it. Draw order: set `renderOrder` 1 so grime draws after
    opaque props.

### 4.3 The atlas cells

Real reference sizes:

| cell | kind | real-world reference | albedo / roughness | where (Builder 1) |
|---|---|---|---|---|
| 0–1 | **water ring, white blush** | glass and mug bases Ø 65–85 mm; ring 2–4 mm wide; moisture trapped in shellac/varnish → white haze | +0.10 luminance, desaturated / rough +0.15 over the base (alpha 0.5) | hall_table, nightstand, kitchen_table tops (2–4 each) |
| 2 | **water ring, dark** | water through the finish into the wood: a darker tide line | ×0.7 / rough +0.1 | kitchen_table, washstand |
| 3–4 | **wax spill** | paraffin drips 5–25 mm, raised look, translucent | albedo 0.75 warm white / rough 0.35 (alpha 0.9, crisp edge) | under each candle (2–3 drips), hall_table |
| 5 | **soot plume** | candle and kerosene soot above the flame, 30–80 mm wide, density falls off upward over 100–200 mm | albedo 0.03 / rough 0.95 (alpha gradient) | lamp chimney top, candle wick, ceiling above the lamp (asks the house lane), iron_stove firebox |
| 6–7 | **rust streak** | runs down from a fastener 50–300 mm, 3–8 mm wide, colour (0.29, 0.13, 0.06) | ×1 tint / rough 0.85 | sign_post bolts, mailbox, vacancy plate screws, jerry cans |
| 8 | **can ring** | a rust ring Ø 160 mm (jerry can footprint is rectangular: 340 × 165 rounded rect) | rust tint / rough 0.8 | can_shelf, floor under cans |
| 9 | **finger grime** | oily dark smudge 20–40 mm round a knob or pull | ×0.75 / rough −0.1 | round every nightstand, hall_table and door knob |
| 10 | **mirror desilvering** | black-grey blooms from the edge, 10–60 mm | silver loss: alpha → albedo 0.05, rough 0.6 | mirror_crepe |
| 11 | **ink / tea stain** | irregular, with a tide rim | brown (0.45, 0.32, 0.18) ×0.8 | guest_book, ledger pages (on the paper decal canvas, not on grime quads) |
| 12–15 | spare | — | — | — |

### 4.4 Per-document paper variation

`paintPaper` gains `opts.age` (yellowing 0–1), `opts.foxing` (dot count), `opts.fold` (crease lines) and
`opts.seed`, keyed by `ud.page` / `ud.text`. The letter, the ticket, the guest book, the ledger pages and the photos
get distinct values: letter age 0.5 with 2 folds, ticket 0.3, guest book 0.7, ledger 0.8.

---

## 5. The Blender ↔ runtime contract

### 5.1 Attribute

| item | value |
|---|---|
| Blender attribute | `mesh.color_attributes.new('wear', 'BYTE_COLOR', 'POINT')`, active and default colour |
| glTF | `COLOR_0`, VEC4, componentType 5123 UNSIGNED_SHORT, `normalized: true` |
| three geometry | `geometry.attributes.color` (itemSize 4, Uint16Array, normalized) |
| TSL | `attribute('color', 'vec4')` → `.x` edge, `.y` cavity, `.z` handled, `.w` dust |
| range | each channel 0..1 linear, already multiplied by the per-prop scalar. 0 = pristine / open / untouched / no dust |
| absent | no `color` attribute → no wear (the JS branch); never `vertexColor()` |
| which meshes | prop parts with an opaque spec of a family in the §2.2 table. Never glass, decals, grime quads, characters, the house or trees |
| Low | HERO set only (§1.5); others have no attribute |

### 5.2 Spec params (proposed; `material-types.ts` is lead-owned, §8 R1)

`params.wear?: { edgeCov?: number /*0..1 chip coverage threshold, default 0.55*/, chipFreq?: number /*1/m*/,
underAlbedo?: [r,g,b], underRough?: number, under2Albedo?: [r,g,b], under2Rough?: number, handleRough?: number,
handleTint?: number, cavityTint?: [r,g,b], cavityRough?: number, rust?: number, soot?: number }`.
- When the block is absent, the family defaults in §2.2 apply.
- `params.dust` already exists and is reused as dustAmt.

### 5.3 Anchors (Blender only; consumed by the bake, not exported unless the runtime needs them)

| empty name prefix | extras | effect |
|---|---|---|
| `wear_handle` | `{r: 0.02..0.15}` metres | adds handled falloff `exp(−(d/r)²)` to B |
| `wear_soot` | `{r, up: 0.15}` | adds soot to G with an upward elongation (stretch along +Z by `up`). The runtime sees G and the family `soot` param, so on cast_iron the cavity colour becomes soot instead of rust. |
| `wear_protect` | `{r}` | subtracts from R and A (e.g. under a lamp base: no dust) |

Anchors are deleted before export, or exported as empties with `extras.wear_anchor = true` (the runtime ignores
them).

### 5.4 Verification hooks

- `export.py inspect_glb` prints `COLOR_0` per primitive. `check_props.mjs` gains three checks:
  1. Every primitive with `COLOR_0` has a material with `extras.material_id` that resolves in material-spec.
  2. No glass or decal primitive has `COLOR_0`.
  3. Per prop, the mean of each channel, flagging R mean > 0.25 (too worn) and A on faces with `n_z` < 0 (dust on
     undersides).
- Runtime `?debug`: `window.__game.debug.wearView(ch)` swaps every masked material's `colorNode` to show one mask
  channel (0–3) or the composite. It is used by the QA shots.

---

## 6. Test and QA plan

1. **Measure first (Builder 1, before any mass export).**
   - Export **claw_hammer + hall_table + jerry_can** with `wear` plus support loops into a scratch GLB.
   - Record bytes per 100 k vertices for COLOR_0 after meshopt, and the vertex increase from the support loops.
   - Run `node scripts/assets.mjs --check`.
   - Then fix the Low HERO list size (§1.5). Write the numbers into STATUS-props-d.
2. **Blender review renders** (`blender/props/preview.py`): every top-25 prop is rendered with its mask channels as
   emission (4 small tiles) plus a beauty render. Look, improve, re-check at least 3 times: the bands must sit on
   real edges, handle zones on real grips, and dust on tops only.
3. **Runtime unit:** `tests/wear.test.ts`, run with `node --experimental-strip-types`. It covers:
   - the mask helper maths (chip threshold monotone in E);
   - the family table resolves for every family that a masked spec uses;
   - the shared key separates masked from unmasked meshes.
   It does not import three/webgpu: the maths lives in a pure module.
4. **In game:** one batched `shot.mjs --scenario scratch/props-finish/views.mjs` session at Medium WebGPU (mains
   power). It reuses the audit's views pa-15 (guest book and candle at 0.75 m), pa-21 (cleaver at 0.5 m), pa-30
   (jerry cans at 0.8 m), a nightstand and lamp view, the hammer and shears in hand, and a C1 sedan-interior hook
   (§8 R5).
   - At most 2 images looked at per step.
   - A `wearView(0)` and a composite shot of the same view prove the mask placement.
   - Compare against the audit shots: the same files at the same camera.
5. **Gates:**
   - zero console errors, with the wear module both on and off (`?nowear` flag);
   - Medium ≥ 45 fps in g1, g2 and u2, with ≤ 2 fps loss against before;
   - ≤ 1.5 M tris and ≤ 400 draw calls per room;
   - Low ≥ 30 fps;
   - `assets.mjs --check` ok on all tiers;
   - `npm test`, `npm run build` and the playthrough bot reach C7.
6. **The art-director bar.** At 0.5–1 m under the torch, every top-10 prop must show:
   - edges different from faces (chips or worn varnish);
   - grips different from untouched areas;
   - darker crevices;
   - dust on tops only;
   - no facets;
   - at least 1 hardware detail (screw, hinge or rivet) where a real object has one.
   Say plainly which props don't reach it.

## 7. Build order (one Blender agent, then one runtime agent)

**Blender agent**
- **B1.** kit.py: `wear_loops`, `bake_wear_masks(obj, scalars, anchors)` (the BVH AO plus the §1.3 maths),
  `screw_head` / `nail_head` / `hinge_butt` / `escutcheon` / `knurl`, `grime()`. Add the export override in
  build_props.
- **B2.** The step-1 measurement, then the HERO rows 1–12 geometry.
- **B3.** Rows 13–25.
- **B4.** All other props get masks and support loops only.
- **B5.** Grime quads. Then `check_props`, `assets --check`, review renders, and STATUS.

**Runtime agent** (it can start after B1 + B2, using the hero files)
- **R1.** `wear.ts` with the pure maths module, the bind.ts key and branch, and the masked-dust replacement.
- **R2.** The family table §2.2 plus the Low cheap mode.
- **R3.** decals.ts `grime` plus `paintPaper` variation.
- **R4.** `wearView` debug, the `?nowear` flag, and tests.
- **R5.** The QA shots, at least 3 look-improve rounds, and the fps gates.

## 8. Requests for the lead

| request | what it is |
|---|---|
| **R1** | Approve the new optional `params.wear` block in `src/shared/material-types.ts` (§5.2), and a new `grime_decal` constant spec in material-spec.json (via `scripts/layout/materials.mjs`). |
| **R2** | Spec-only quick wins: `dust`/`dustOnTop` 0.3–0.6 on furniture and metal specs. |
| **R3** | New or reassigned specs: hog_cleaver → `steel_cleaver`; sewing_shears and the hammer head → polished forged steel (rough 0.15–0.3, F0 0.56); the hammer handle → hickory (albedo 0.35–0.45, rough 0.5); jerry_can → painted sheet steel (olive or red enamel over red-oxide primer); bell_pull → wool embroidery. |
| **R4** | After X2 ships, the runtime lane removes `toCreasedNormals` in `src/world/opening.ts` l.110–131. |
| **R5** | A scenario hook to view the mounted `sedan_interior` during C1. |
| **R6** | The house lane: a soot decal on the ceiling above the u2 kerosene lamp. |

Contract changes: the new `COLOR_0` on prop GLBs and the new spec params are logged in `docs/CONTRACT-CHANGES.md`.
