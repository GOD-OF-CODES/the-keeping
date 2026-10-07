# Smoke tests S1–S4 (Blender pipeline, lane A) — measured results and decisions

Measured 2026-09-30 on the dev Mac: Apple M1 (7-core GPU), 8 GB, macOS 15.7, Blender 5.2.1 LTS (Metal, hardware RT
off), three 0.186.1, Node 22.12. Chrome was open (another agent) during every run.

Rerun everything: `npm run assets -- --only smoke`. The 2048² bake is manual: `npm run assets -- --only smoke-s4-2048-32`.
Outputs go to `.cache/smoke/<test>/` (`result.json`, `check_*.json`). Logs go to `.cache/logs/`.

## Decisions (read this first)

| Topic | Decision | Evidence |
|---|---|---|
| Lightmap multiplier | **`lightMapIntensity` k = π** (measured 3.1412–3.1418) | S3 |
| Lightmap orientation | Sample at **`vec2(uv1.x, 1 - uv1.y)`** with `texture.flipY = false` | S2, proven through three's GLTFLoader + EXRLoader |
| Lightmap container | **KLM** (our format: gzip'd planar float16 with byte-split + delta, `.klm`) is primary. EXR half ZIP RGB is a verified alternative. | S2: smaller than EXR ZIP, decodes about 7× faster |
| Channels | **RGB** (no alpha). Coverage is only needed offline. | S2: RGBA costs +1.5–3.5 % |
| Per-tier lightmaps | **Max** 2048² lossless half (~7.1 MB/atlas) · **Medium** 2048² with 7-bit mantissa (≤ 0.39 % error, ~3.7 MB) · **Low** 1024² with 7-bit mantissa (~1.0 MB) | S2 + S4 |
| Medium, 6 atlases | ≈ 22 MB (≲ 40 MB target met); Max ≈ 43 MB; Low ≈ 6 MB | S2, from the real S4 room atlas |
| GLB | meshopt (`EXT_meshopt_compression`) + `export_extras=True`. Characters: `export_animation_mode='ACTIONS'`, `export_anim_single_armature=False`, **`export_anim_slide_to_zero=True`** | S1 |
| Release bake | 128 spp, Metal, margin 0 + our dilation, then OIDN RT hdr on CPU, one atlas per process | S4 |
| UV2 packing | `pack_islands(shape_method='AABB')`. CONCAVE/CONVEX took 80 s on a 110-triangle room | S4 |

All sizes are MiB (2^20 bytes).

---

## S1 — GLB export (PASS)

Script: `blender/tests/smoke_s1.py`. Runtime check: `blender/tests/check_glb.mjs`, which uses three r186's own
`GLTFLoader` and `MeshoptDecoder` in plain Node with no globals added. The GLBs carry no images, and Node 22 has
`navigator`.

**Scene:**
- A static box with UV layers [UVMap, Lightmap] and custom props on the object, mesh and material.
- A 2-bone armature with a weighted mesh and a shape key `Open`.
- Two clips, `Idle` and `Wave`. Each was authored with the layered Action API (slot → layer → strip →
  `channelbag(slot, ensure=True)` → `fcurves.new`) and placed on its own NLA track, with no active action.
- One stray action with a fake user and no track.

| File | Bytes | Result in three r186 |
|---|---|---|
| `s1_plain.glb` (no meshopt) | 24 932 | `uv` + `uv1` on the box; `Idle`,`Wave`; 1 morph target `{Open:0}`; bones Root,Tip |
| `s1_meshopt.glb` | 16 172 (−35 %) | same; `extensionsUsed/Required = [EXT_meshopt_compression]`, 21/26 bufferViews compressed, parse 2 ms |
| `s1_single_arm.glb` (`export_anim_single_armature=True`, the default) | 17 876 | animations **Idle, Stray, Wave**: the default setting sweeps every bone action in `bpy.data` in |

Where things land in three:
- **Node extras → `Object3D.userData`.** Mesh extras are merged into the same object's userData
  (`{mesh_note, atlas, room, collide}`).
- **Material extras → `material.userData`** (`{material_id}`).
- **UVMap → TEXCOORD_0 → `uv`; Lightmap → TEXCOORD_1 → `uv1`.** Layer order is the export order.
- Shape keys survive with `export_apply=False`.

**Found and fixed:**
- Clips keyed from frame 1 exported with their first key at **t = 1/30 s**: `Wave` had a duration of 1.0333 s
  instead of 1.000. `export_anim_slide_to_zero=True` fixes it; it is now in the `prop` and `character` presets in
  `blender/lib/export.py`.
- Separately, `check_glb.mjs` asserts that the first key is at t = 0 and that the duration is 1.000.

## S2 — Lightmap container, orientation, size (PASS)

Script: `blender/tests/smoke_s2.py` (Blender's EXR writer, `Image.save_render` with `image_settings`). Runtime check:
`blender/tests/check_exr.mjs`, which decodes every file with three r186 `EXRLoader`, our KLM decoder, and
`DecompressionStream`.

### Orientation (asymmetric "F", 16×12, values up to 8.375)

- The EXR is written by Blender, and EXRLoader returns **data row 0 = Blender pixel row 0 (bottom)**, with
  `flipY: false`. The KLM and f16gz containers keep the same bottom-up order.
- glTF exports TEXCOORD_1 as **(u, 1 − v)**. This was checked on an exported quad for every vertex.
- A DataTexture with `flipY=false` maps data row 0 to v = 0 on both backends. So:
  - sampling at raw `uv1` is **vertically mirrored** (asserted);
  - sampling at **`(uv1.x, 1 − uv1.y)`** hits exactly the texel Blender baked, and the F is upright (asserted).
- This matches lane B's `LIGHTMAP_FLIP_V = true` in `src/render/lightmap-material.ts`. Keep it; it applies to EXR and
  KLM alike.
- On-screen confirmation on both backends is still S5's job (browser).
- **No view transform is applied**: values > 1 (2.0, 7.0, 8.375) round-trip exactly. The header shows `pixelType`
  half for `color_depth='16'`, and float for `'32'`.

**Codecs through EXRLoader r186.** All of the following decode:
- Lossless, bit-exact: ZIP, PIZ and PXR24 (lossless for half) on the pattern and on real atlases; NONE and ZIPS on
  the pattern only.
- Lossy: DWAA, DWAB, B44.

### Sizes from a real baked room atlas (S4 room, post-OIDN, 65.6 % coverage)

| Atlas | raw RGB half | EXR ZIP RGB | EXR ZIP RGBA | EXR PIZ RGB | EXR DWAA RGB (lossy) | f16gz | **KLM lossless** | **KLM m8** | **KLM m7** | KLM m6 |
|---|---|---|---|---|---|---|---|---|---|---|
| 2048² (real bake, 32 spp) | 24.0 | 7.37 | 7.48 | 7.07 | 1.10 | 13.57 | **7.10** | 4.76 | **3.67** | 2.79 |
| 1024² (real bake, 128 spp) | 6.0 | 2.04 | 2.07 | 2.02 | 0.32 | 3.64 | 1.93 | 1.27 | 0.99 | 0.79 |
| 1024² (2048 downsampled) | 6.0 | 1.88 | 1.91 | 1.84 | 0.33 | 3.35 | 1.80 | 1.26 | **0.99** | 0.77 |
| 512² (downsampled) | 1.5 | 0.54 | 0.55 | 0.55 | 0.11 | 0.88 | 0.52 | 0.38 | 0.31 | 0.25 |
| 1024² **before OIDN** | 6.0 | 2.94 | — | 2.98 | 1.28 | 3.70 | 2.88 | — | 2.12 | — |

- **Errors.** KLM mN has max relative error ≤ 2^−(N+1), measured exactly at the bound: m8 0.195 %, m7 0.389 %,
  m6 0.775 %. The error is uniform with no block artefacts. DWAA: mean 0.18 %, p99 1.1 %, max abs 0.5 on 8×8 DCT
  blocks. B44 is lossy and barely compresses (10.5 MB at 2048), so rejected.
- **Decode time in Node (V8, one thread; the browser main thread is similar):**

  | Format, 2048² | Decode |
  |---|---|
  | EXR ZIP | 945 ms |
  | EXR PIZ | 1163 ms |
  | EXR DWAA | 1781 ms |
  | **KLM** | **110–141 ms** (`DecompressionStream` + one JS loop; the output is the RGBA half `Uint16Array` to upload) |

- **HTTP gzip on top of EXR ZIP gains 0 bytes.** Noise inflates every codec: un-denoised is +44 % for ZIP and ×4 for
  DWAA, so always ship post-OIDN.
- **GPU memory is independent of the container.** EXRLoader and our decoder both produce RGBA half (8 B/texel):
  32 MiB per 2048² atlas, so 6 atlases = **192 MiB** at Max and Medium, and 48 MiB at Low (1024²). No mips.

### Decision

- **Container.** KLM is primary for every tier:
  - Lossless it is 3.7 % smaller than EXR ZIP, and with mantissa rounding it has bounded error.
  - It decodes ~7× faster with no 100 KB EXRLoader in the bundle.
  - It uploads directly as `HalfFloatType` + `RGBAFormat`.
  - Spec: `blender/lib/encode.py` docstring. Reference decoder: `decodeKlm()` in `blender/tests/check_exr.mjs`.
  - **Extension `.klm`, never `.gz`.** Static servers may add `Content-Encoding: gzip`, and `fetch` would inflate
    the file before our `DecompressionStream` sees it.
- **Tiers** (`TIER_POLICY` in `blender/lib/encode.py`). The base bake is at 2048²; lower tiers are coverage-weighted
  downsampled from it, then re-dilated. The current policy and its measured error are in
  [Release lightmap budgets](#release-lightmap-budgets) below (this S2 projection was superseded).
- **Fallback.** EXR half ZIP RGB, via `encode.save_exr`; set `container: 'exr'` in `TIER_POLICY`. For a lossy EXR
  fallback, DWAA. Both are proven to decode in r186.
- **Sidecar** `lm_<atlas>.json` next to each file: `{rowOrder:'bottom-up', uvDecode, width, height, container,
  mantissaBits, floorExp, channels, intensity: π, stats}`. `floorExp` is informational: the decoder just reads halves.

### Release lightmap budgets

The release bakes (2048², 128 spp, post-OIDN) are kept as float32 in `.cache/bake/lm_*.npz`. The `encode` job
(`blender/bake/encode_atlases.py`) turns them into the shipped KLM files per tier. It never re-bakes.

**Quantizer.** Two pre-quantizations of the half values. The decoder is unchanged.
- Mantissa bits N: the half mantissa is rounded to N bits, a relative error of at most 2^-(N+1).
- Absolute floor `floor_exp` E: below 2^-E the values sit on a fixed grid of step 2^-(E+N), the N-bit spacing at
  2^-E. The house is dark: 42–97 % of texels are below 2^-12, where AgX's toe maps everything to near-black. Without
  the floor, that noise costs full half precision.

**Error metric.** The display-referred error is measured on every covered texel of every file, against the float
source at the tier's size.
- A lightmapped Lambert texel renders as texel × albedo × exposure. The lightmap intensity π cancels the BRDF's 1/π
  (S3).
- The value goes through three r186's exact AgX (`agxToneMapping`, `ToneMappingFunctions.js`) and the sRGB OETF.
- The error is the difference in 8-bit code values. Per albedo, a texel counts with its worst channel over the
  exposures 1, 1.18 (the lightning kick) and 1.3 (the kick × the blue-hour tint of 1.1).
- An error below 0.5 code can move a pixel by at most one 8-bit step, and only when it sits on a rounding boundary.
  The job fails at 0.5 code or more.

**Policy and results.** Measured 2026-09-30, from `.cache/bake/encode.json`. Error columns are 8-bit code values,
max / p99 over all atlases.

| Tier | Policy | Lightmaps | Tier total (budget) | Albedo 0.2 | Albedo 0.5 | Albedo 0.8 |
|---|---|---|---|---|---|---|
| Max | 2048², m10, f8 | 70.2 MiB, 9 maps (was 90.3) | 102.2 MB (120) | 0.026 / 0.020 | 0.027 / 0.020 | 0.027 / 0.021 |
| Medium | 2048², m7, f8 | 26.5 MiB, 7 maps (was 43.7) | 50.4 MB (60) | 0.235 / 0.145 | 0.237 / 0.172 | 0.238 / 0.182 |
| Low | 512², m6, f8 | 1.6 MiB, 7 maps | 20.9 MB (25) | 0.429 / 0.279 | 0.442 / 0.329 | 0.442 / 0.347 |

- No texel on any tier reaches 0.5 code.
- The Max error equals plain float32 → half rounding. The floor adds nothing there and costs 20 MiB less.
- For Medium, the floor adds nothing over plain m7.
- 1536² was not needed for Medium. It is also not an integer downsample of 2048², so the coverage-weighted
  downsample does not support it.
- The flash maps (`lm_upper_hall_flash`, `lm_upper_rooms_flash`) ship on Max only.

**Commands.** These are the only runner calls that touch lightmaps.

| Command | Effect |
|---|---|
| `npm run assets -- --only encode` | Re-encode all tiers from the cached float atlases (≈ 3.5 min), then write the manifests. It re-runs by itself when `encode.py`, the `.npz` files or the layout change. |
| `npm run assets -- --only bake-release` | Re-bake the release atlases (≈ 80 min on the M1). Close the browser first. |
| `npm run assets -- --only bake-house-ground` (exact id) | Replace a release atlas with a dev bake (1024², 32 spp), deliberately. |
| `npm run assets -- --touch --only <ids>` | Mark jobs fresh without running them. It only works when the job was fresh at git HEAD, and is meant for an uncommitted edit that cannot change their outputs. |

**Release protection.** The dev bakes (`bake-house-*`) share their outputs with the manual `bake-release-*` jobs.
- A plain `npm run assets`, `--only bake` or `--force` never re-runs a dev bake whose outputs a manual job wrote
  later. It logs `SKIP …` with the remedy, and `--list` shows `stale/kept`. Only naming the exact job id runs it.
- If `house` or `props` re-run after the release bakes, the runner prints `WARNING: shipped outputs of bake-release-*
  are stale`. `--check` then fails, because the GLBs' UV2 may no longer match the lightmaps. Re-bake with
  `--only bake-release`.

## S3 — Photometric calibration (PASS)

Script: `blender/tests/smoke_s3.py`.

**Setup:**
- A 4×4 m plane with Roughness 1, Specular IOR Level 0 and Diffuse Roughness 0, baked at 64×64 as DIFFUSE
  {DIRECT, INDIRECT} with no COLOR.
- A point light of P W with radius 0, at height d, in a black world.
- Every texel is compared with E = P·d / (4π r³).

| P (W) | d (m) | albedo | device | centre texel | E analytic | k = E / texel (median, σ) |
|---|---|---|---|---|---|---|
| 100 | 1.0 | 0.8 | CPU | 2.5232 | 7.9345 | 3.14118 (0.0015) |
| 100 | 1.0 | 0.2 | CPU | 2.5232 | 7.9345 | 3.14118 (0.0015) |
| 100 | 2.0 | 0.8 | CPU | 0.6326 | 1.9880 | 3.14173 (0.0008) |
| 1000 | 2.5 | 0.5 | CPU | 4.0503 | 12.7264 | 3.14176 (0.0006) |
| 100 | 1.0 | 0.8 | Metal | 2.5232 | 7.9345 | 3.14118 (0.0017) |

- **k = 3.1412 … 3.1418 = π (error 0.013 %).**
- k is independent of albedo, which confirms that "no COLOR" means divided by albedo, i.e. the bake stores E/π.
- k also follows the inverse square exactly and the cos³θ falloff out to 2.9 m off-axis (ring means 3.141–3.144).
- **Blender Cycles point power P W ⇒ irradiance P/(4π r²).**

The three r186 side, from source:
- `MaterialNode.js:393` (lightmap × `lightMapIntensity`), used as an `IrradianceNode`.
- `BRDF_Lambert.js:5` (`diffuseColor · 1/π`).
- `PhysicalLightingModel.js:627,673` (`dotNL · lightColor · BRDF_Lambert`).
- `PointLightNode.js:12–18` with `LightUtils.js:18` (`1 / max(d^decay, 0.01)`, decay 2).

A lightmapped surface therefore renders `texel · k · albedo/π`, and a runtime PointLight with `I = P/(4π)` renders
`albedo/π · P/(4π r²) · cosθ`. They agree with **k = π** and **I = Blender W / (4π)** (no 683). Keep
`LIGHTMAP_MULTIPLIER = Math.PI`.

## S4 — Bake budget (PASS)

Script: `blender/tests/smoke_s4.py`.

**Room:**
- 5×6×3 m with 0.15 m walls: an EXACT Boolean shell with a 1.2×1.4 m window hole, plus a table with legs, a
  wardrobe and a bed.
- Modifiers applied and everything joined into **one mesh**, 110 triangles. The 7 outer shell faces were deleted.
- Two point lights (100 W and 25 W) and a dim night-blue world through the window.
- UV2 by smart project + AABB pack, with 4-texel padding at the 1024 tier.

**Bake settings:** DIFFUSE {DIRECT, INDIRECT}, Metal, margin 0, `max_bounces` 8, `diffuse_bounces` 4, adaptive off.
The Cycles log proves the device: `Path tracing on: Apple M1 (GPU - 7 cores) (Metal)`, `Hardware Ray-Tracing: Off`.

| Run | bake op | dilate 16 px | OIDN RT hdr (CPU) | whole process | **peak RSS** (`/usr/bin/time -l`) | s per covered texel·sample |
|---|---|---|---|---|---|---|
| 1024² @ 64 spp | 8.66–8.78 s | 1.6 s | 0.49–0.51 s | 12.8 s | **0.98–1.01 GB** | 1.97e-7 |
| 1024² @ 128 spp | 16.73–16.97 s | 1.6 s | 0.49–0.57 s | 20.9 s | **0.90–1.13 GB** | 1.90e-7 |
| 2048² @ 32 spp | 16.96–18.95 s | 3.7 s | 2.71–2.79 s | 28.5–31.4 s | **2.32–2.58 GB** | 1.93–2.15e-7 |

Notes on the 2048² run:
- The memory gate required ≥ 2.5 GB available; `vm_stat` free + inactive + speculative + purgeable gave 3.0–3.4 GB,
  with 0.7–0.9 GB swap in use.
- It ran twice: once deliberately, and once through a runner bug that pulled manual jobs in by group (since fixed).
- There was no memory trouble either time.

**Scaling:**
- Bake time is linear in spp: 0.126 s per spp-pass at 1024², with ≈ 0.6 s fixed session cost.
- It is linear in texels: 0.51–0.57 s per spp-pass at 2048². The GPU is already saturated at 1024², so there is no
  occupancy bonus at 2048².

**Extrapolation to 6 × 2048² at 128 spp** (same scene complexity, 66 % coverage):

| Stage | Estimate |
|---|---|
| Bake | 6 × (0.6 + 128 × 0.51…0.57) = **6.6–7.4 min** |
| Per-atlas overhead: process start, dilate, OIDN, save, tier encode (15.6 s at gzip −9) | ≈ 25 s × 6 = 2.5 min |
| **Total** | **≈ 9–10 min** |

- A real house has more triangles, lights and occlusion. Budget 1.5–3× on the bake part, **≈ 13–25 min**.
- At 64 spp it is ≈ 6–14 min.
- The Max lightning-flash maps are a second, smaller bake.
- Dev bakes at 1024² / 32–64 spp take ≈ 5–9 s per atlas.

**Noise:**
- 64 vs 128 spp after OIDN: mean luminance difference 1.1 %, p99 9.6% (shadow edges).
- 128 spp before OIDN vs after: 8.8 % mean.
- **Release: 128 spp. Dev: 32–64 spp.**

**Memory:** about 1 GB per 1024² atlas process and about 2.4 GB per 2048² process. **Full-resolution bakes need the
browser closed** (as PLAN §2.5 says), one atlas per process. The runner enforces one Blender at a time.

**Found:**
- **UV packing.** `pack_islands(shape_method='CONCAVE'|'CONVEX')` runs an iterative optimiser: 80 s for this
  110-triangle room, and 6–11 s even for 4 boxes. `AABB` is instant and gives the same bounds on architectural
  geometry. It is now the default in `blender/lib/uv2.py`. Use CONCAVE only for small organic props.
- **OIDN on Metal (device type 5)** fails with shared host buffers: "image data not accessible by the device, please
  use OIDNBuffer". `lib/oidn.py` falls back to CPU automatically, and CPU is fast enough (2.8 s at 2048²).
- `bpy.data.objects.remove()` leaves `None` entries in `view_layer.objects` until `view_layer.update()`. This is
  handled in `lib/scene.select`.

---

## Pipeline delivered with the smoke tests

**`blender/lib/`:**
- `scene.py`: factory reset, metres, fps = 30, Standard view, Cycles Metal with explicit samples, adaptive off and
  denoise off, plus `job_args`, `Timer`, peak RSS, `join`/`apply_all_modifiers` and `result()`.
- `materials.py`: reads `src/shared/material-spec.json` (`avgAlbedo`, `roughness`, `metalness`). It falls back to
  grey while the file is missing, which is the case now.
- `uv2.py`: Lightmap layer, multi-object atlas, padding sized for the smallest tier.
- `bake.py`: `bake_atlas`, which returns a numpy array plus a coverage mask; `dilate`.
- `oidn.py`: ctypes, RT hdr, Metal→CPU fallback.
- `encode.py`: KLM, EXR, f16gz, coverage-weighted downsample, `TIER_POLICY`, sidecars.
- `export.py`: presets `static`, `prop`, `character`, and `inspect_glb`.
- `cli.py`: the single Blender entry point; it fixes `sys.path`.

**`scripts/assets.mjs`** is a serial runner for the jobs in `blender/pipeline.json`:
- A lock dir `.cache/blender.lock` holding the pid, with stale-pid detection. It also waits while any foreign
  `Blender.app` process runs.
- Input-hash caching over script + `libInputs` + inputs; a job may override `libInputs` so a lib edit doesn't force
  a full re-bake.
- Blender is launched with `--python-exit-code 1` and wrapped in `/usr/bin/time -l` (peak RSS). With `cyclesLog`,
  the Cycles device is captured from the log.
- Post-checks via Node; logs in `.cache/logs/`, keeping 5 per job.
- Writes `public/assets/<tier>/manifest.json` (`AssetManifest`).
- Flags:
  - `--only <id|group>`: `manual` jobs run only when named by id.
  - `--force`, `--dry-run`, `--list`, `--manifest`.
  - `--touch --only <ids>`: mark jobs fresh without running them, only if they were fresh at git HEAD.
  - The release protection guard, described under [Release lightmap budgets](#release-lightmap-budgets).
  - `--check`: manifest ↔ files (size and hash); TEXCOORD_1 on level GLBs; expected or stray animations; lightmap
    sidecar `rowOrder` and KLM header vs sidecar; per-tier budgets; last-run failures; manual (release) jobs whose
    shipped outputs are stale vs their inputs.

## Open issues (for the lead / other lanes)

1. **Lead decision needed: KLM vs EXR.** Lane B's `lightmap-material.ts` currently assumes EXR, while `TIER_POLICY`
   emits KLM. Numbers per 2048² atlas:

   | | Lossless size | Decode | Medium, 6 atlases |
   |---|---|---|---|
   | EXR ZIP | 7.37 MB | 945 ms | 44 MB, lossless (over the ~40 MB target) |
   | KLM | 7.10 MB | 141 ms | 22 MB at m7 |

   Setting `container: 'exr'` in `TIER_POLICY` (`blender/lib/encode.py`) is a one-line change that restores the
   plan's EXR half ZIP RGB, which is fully verified. Nothing else changes: same orientation rule and same k.
2. **Lane B: KLM loader.** Port `decodeKlm()` from `blender/tests/check_exr.mjs` into `src/render`.
   - Build the texture as `new DataTexture(data, w, h, RGBAFormat, HalfFloatType)` with `prepareLightmapTexture()`
     as it is now.
   - Fetch `.klm` as an `arrayBuffer`.
   - Keep `LIGHTMAP_FLIP_V = true` and `LIGHTMAP_MULTIPLIER = π`; both are confirmed.
   - EXRLoader is only needed if the lead picks the EXR fallback.
3. **VRAM:** 192 MiB of RGBA16F lightmaps at Medium and Max (6 × 2048²) on an 8 GB M1. S5 should read
   `renderer.info.memory`. If it is too much:
   - Medium can drop to 1024² m7: 6 MB download, 48 MiB VRAM, one line in `TIER_POLICY`.
   - Or lane B can pack to RGB9E5 (`rgb9e5ufloat`, 4 B/texel) at upload. That is untested.
4. **`src/shared/material-spec.json` and `level-layout.json` do not exist yet**, so bakes use grey bounce albedo. The
   house, props, characters, anims, bake and encode jobs in `blender/pipeline.json` are placeholders until they
   exist.
5. PLAN §2.4 and §2.5 should be updated by the lead:
   - Lightmap format: "KLM half (m7 on Medium and Low)" instead of "EXR half".
   - Release bake: 128 spp at ~13–25 min for the house.
   - PLAN §2.6 should add `export_anim_slide_to_zero=True`.
6. `.gitignore` (lead-owned) should add `__pycache__/`. `cli.py` disables bytecode, but running a job directly with
   `--python` would create one.
7. No package.json, tsconfig or CLAUDE.md changes are needed. `npm run assets` already maps to `scripts/assets.mjs`.
   Plain `npm run assets` currently runs every non-manual smoke job: about 2.5 min cold, then cached.
