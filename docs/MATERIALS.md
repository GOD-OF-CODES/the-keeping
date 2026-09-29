# Materials: runtime GPU-generated PBR textures

Every tiling surface texture in THE KEEPING is generated on the GPU at load time. The generators are our own TSL
code in `src/materials/`. Nothing is downloaded.

- The generators read `src/shared/material-spec.json`, the same file the Blender bake materials read.
- Each material's mean albedo is measured on the GPU and checked against `avgAlbedo`, the bounce colour Cycles uses.

## Files

| File | What |
|---|---|
| `src/materials/noise-cpu.ts` | CPU twins of the noise: PCG hash, periodic value/gradient noise, fBm, ridged, Worley (F1, F2, id, edge), domain warp. Also `invNorm`/`coverThreshold` and sRGB decode. No three.js import, so it is node-testable. |
| `src/materials/tsl-noise.ts` | The same functions in TSL. Every primitive is `Fn(...).setLayout()`, so each is emitted once as a real shader function. Tile-space wrappers: `vn`, `gn`, `fbm`, `fbm01`, `ridged`, `worley`, `warp`, `hashf`. |
| `src/materials/gen-types.ts` | Generator contract (`GenCtx` → `GenResult`) and `makeCtx`. `*_srgb` params are decoded to linear here. |
| `src/materials/baker.ts` | `MaterialBaker`: RenderTarget + QuadMesh bake, per-id cache, timing, `readFloatTarget`. |
| `src/materials/albedo-check.ts` | The ±10 % check math, gain and GPU byte counts. Pure, so it is unit-tested. |
| `src/materials/library/*.ts` | Per-family generators: `wood`, `walls`, `ground`, `metal`, `cloth`, `misc`. Shared blocks live in `common.ts`: boards, cone-section wood grain, paint-over-substrate + chips, grunge, tide stains, cracks, dots, weave. |
| `src/materials/library/index.ts` | Registry: family → generator, plus id overrides (`wall_tally`), `superTileFor`, and a generic fallback. |
| `src/materials/library/calibration.ts` | Measured per-id albedo trims (see "avgAlbedo check"). |
| `src/materials/spec-index.ts` | `MATERIAL_SPECS` and `specById` (ignores the `@2s` suffix). |
| `src/materials/bind.ts` | glTF `material_id` → node material. Adds the runtime layers and `materialUniforms`. |
| `src/game/matlab.ts` | `?scene=matlab` material lab. |

## Periodic noise

- Noise is evaluated at `p = uv · f` with an integer period `f` (cells per tile), so every texture tiles exactly.
- fBm doubles both the frequency and the period each octave (lacunarity 2 is the only tile-safe value).
- Anisotropic frequencies `[fx, fy]` are fine. 45° rotation (`rot45`) is also tile-safe.
- Lattice wrap is `x − m·floor((x+0.5)/m)`, which is fp32-exact at multiples.
- Hash: PCG on uint (`tk_pcg`). The seed is pre-hashed in JS.
- `fbm01` has mean 0.5 and σ ≈ 0.25. `coverThreshold(c)` returns the threshold that leaves area fraction `c` above it. Use it (or `patches`/`grunge`, which do) whenever a spec param means "amount".
- Tests (`tests/materials-noise.test.ts`) cover:
  - periodicity of value, gradient, fBm, ridged, warp and Worley
  - seam continuity and ranges
  - PCG against a BigInt reference
- The matlab HUD compares GPU hash bits with the CPU hash on 256 cells (`hash GPU==CPU: ok`), on both backends.

## Baker (both backends: WebGPU and forced WebGL2)

1. **Generator pass (one shader per material).** Writes an MRT HalfFloat scratch with RepeatWrapping:
   - `c` = albedo (linear, × calibration), roughness
   - `h` = height, AO, extra, puddle
2. **Finalize pass (one shared shader).** Writes an MRT UnsignedByte target with mipmaps, anisotropy (preset) and RepeatWrapping:
   - **A** (`SRGBColorSpace`, so rgba8unorm-srgb / SRGB8_ALPHA8, hardware encode/decode) = albedo, roughness.
   - **B** (linear) = normal.xy·½+½ (`NormalRGPacking`), AO × cavity, and extra:
     - metalness for metal families
     - opacity for glass
     - height otherwise
   - How B is derived:
     - **Normal:** a 3×3 Sobel of the height field in uv space, scaled by `heightDepthM / texelMetres`, so the bump is physically sized at every preset.
     - **Cavity:** metres below the neighbourhood. It darkens crevices, and spec `wetness` is applied here.
     - **Wetness:** porous darkening plus gloss. Puddles go near-black and mirror-smooth, with flattened normals.
3. **Measure pass.** Reads mip `log2(size/16)` into a 16×16 Float target and reads it back. This gives the mean albedo and roughness.
   - It is also the GPU fence. On WebGL2 it is a synchronous `readPixels`: three's async path polls with rAF, which Chrome pauses in hidden or occluded tabs.

Other baker details:
- Rendering into a render target means no tone mapping and linear working space.
- three y-flip-normalises render-target sampling on both backends, so generator uv equals sampling uv.
- The asymmetric-dome test (`&test=bump`) proved normals, orientation and sRGB round-trip are identical on WebGPU and WebGL2.
- **Super-tile:** wallpapers bake 2×2 paper strips per texture (`superTileFor`), so each strip peels differently. `BakedMaterial.repeatM` carries the real repeat.

## Bind (`bindMaterials(root, { renderer, preset, lightmapFor, onProgress })`)

**Which material each source type gets**
- `generated`: the baked maps, with `repeat = 1 / repeatM` on UV0. UV0 is in metres (PROPS.md / HOUSE.md).
- `baked_unique`: the asset's own glTF maps. If the asset ships none yet, the family generator is used as a fallback (skin, hair, nightgown, flannel, car interior, photo).
- `constant`: flat PBR.

**Which material class**
- Lightmapped meshes (`lightmapFor(mesh)` returns maps) get `LightmapMaterial`. The caller then applies `excludeGridFromLightmapped` to `result.lightmapped`.
- Clearcoat (car paint) and sheen (cloth) use `MeshPhysicalNodeMaterial`, except on Low or when lightmapped.

**Tangent frames**
- The maps are authored in three's derivative (no-tangent) frame. Static house and prop GLBs export no tangents, so they use that frame directly.
- Character GLBs (`export_tangents=True`) carry glTF tangents. Their bitangent sign is the opposite of three's `computeTangents()`, because the exporter flips V. That is why GLTFLoader flips `normalScale.y` in the no-tangent case.
- So bind flips the normal-map y on meshes that have a `tangent` attribute. The lab verifies both paths:
  - `&test=bump&tangents=gltf` domes stay lit from the key.
  - Don't call `computeTangents()` on a bound mesh: three's own tangents need no flip (`&tangents=three`).

**Sharing**
- Materials are shared per (id, side, lightmap, tangent presence).
- There is one baker per renderer (`sharedBaker`), so repeated binds never re-bake. Scratch targets are freed after each bind.

**Runtime layers.** These are world-space and non-periodic, so they hide the tiling:
- Macro brightness, hue and roughness variation.
- Tide-marked water stains on wallpaper, plaster and ceilings. The spec's `waterStainFromCeiling` biases them upward with world height.
- Stains on small-tile textiles and paper.
- Dust on up-facing surfaces (`dust`, `cobwebDust`, `dustOnTop`).
- Dynamic wetness `materialUniforms.wet` (rain events and drips).
- `materialUniforms.dust` and `materialUniforms.macro` are global knobs.

## avgAlbedo check (±10 %)

- The measure pass compares the baked mean with `avgAlbedo`. Channel error is `|m − t| / max(t, 0.02)`.
- Generators are hand-built for structure. `library/calibration.ts` trims each mean onto the spec with a measured per-id RGB multiplier applied in pass 1.
- Trims must stay within [0.4, 2.5]; a test enforces this. Anything outside means the generator's colours are wrong.
- Residual gain goes to `bind` (clamped 0.5–2).

To regenerate after changing a generator:
1. Open `/?scene=matlab&debug&preset=medium`.
2. Run `copy(__matlab.calibration())`.
3. Paste the result over `ALBEDO_CAL`.

Measured on the M1 (after calibration), all 60 materials pass on both backends:

| Preset | WebGPU max error | WebGL2 max error |
|---|---|---|
| Low | 3.3 % | 3.6 % |
| Medium | 2.3 % | 2.1 % |
| Max | 8.4 % | 8.1 % |

On Max, brick is ~8 %: the thin mortar and chipped arrises resolve differently at 1024.

## Bake timings (M1 7-core, Chrome, all 60 materials)

| Preset (hero / base) | WebGPU | WebGL2 | Maps on GPU (52 generated / all 60) |
|---|---|---|---|
| Low (512 / 256) | 3.6 s | 4.0 s | 51 MB / 58 MB |
| Medium (1024 / 512) | 1.8 s warm · 7.3–9.2 s cold | 4.8 s | 203 MB / 232 MB |
| Max (2048 / 1024) | 4.1 s | 4.7 s | 811 MB / 928 MB |

- WebGL2 figures are **warm** (ANGLE program cache). Cold WebGL2 compile was not measured cleanly: the first run was spoiled by rAF throttling, which the baker's WebGL2 fence was then changed to avoid. Expect roughly 2–4× warm, like WebGPU.
- Bake time is almost entirely **shader compilation**. The fill itself is ~5–30 ms per material, even at 2048².
- "Warm" means the browser's shader cache already holds the programs (a second visit).
- The slowest materials are wallpaper/tally (~230–290 ms: damask motif) and metals (~190–250 ms on WebGL2).
- The game binds only the ids present in the loaded glTFs.

## Material lab (`?scene=matlab`)

The lab shows every material on a metre-UV panel and sphere, with labels (size, ms, albedo error). The HUD shows totals, the hash check, the albedo check and GPU MB.

**URL options**

| Option | Effect |
|---|---|
| `&mat=<id>` | Focus one material: wall, floor, sphere and cube. |
| `&only=a,b,c` | Show only these materials. |
| `&preset=low\|medium\|max` | Override the preset. |
| `&backend=webgl` | Force the WebGL2 backend. |
| `&light=studio\|dark\|moving` | Lighting mode (see below). |
| `&test=bump` | Asymmetric dome normal test. |
| `&t=<s>` | Freeze the light animation at that time. |
| `&lm=1` | Bind through `LightmapMaterial` with a flat synthetic lightmap (the static-level path). |
| `&tangents=gltf\|three` | Give lab meshes vertex tangents in glTF or three convention. |

Lighting modes:
- `studio`: key light plus a code-built softbox PMREM.
- `dark`: flashlight and candle only, like the game.
- `moving`: the default.

**Keys**
- `L` cycles the light mode.
- `1` toggles macro variation.
- `2` toggles dust.

**`window.__matlab` API**
- `report()`, `summary()`, `calibration()`
- `snapshot()` returns a PNG data URL
- `view(pos, target)`, `setLight(mode)`, `hud(bool)`
- `pipeline.uniforms.exposure`

## Weak spots / follow-ups

- **Max memory.** Max holds 811 MB of generated maps: 8 hero materials at 2048² are 45 MB each. That is heavy on 8 GB unified memory. The preset table (lead-owned) could drop Max base to 512 or hero to 1024 for non-floor heroes. BC/ASTC compression isn't available for render targets.
- **`wall_tally`.** Its tile is 5 m, so at 512² a texel is ~1 cm. The 3 mm graphite strokes are widened to ~1.3 texels to stay visible, which makes them heavier than intended at Low/Medium. A decal or CanvasTexture layer, as for the other handwriting, would be sharper.
- **Hall wear path, nosing wear, door hand-grime, furniture edge wear.** These are location-specific, and a tiling texture can't place them. Use vertex colour, a decal, or a world-space mask per room.
- **Glass.** It is transparent standard with grime opacity. There is no refraction (transmission is a separate pass, untested on WebGL2). Rain streaks and droplets are static.
- **Stencils and fringe.** The burlap "STROUD FEED & SEED" stencil and the rug fringe are not in the tiling texture. The stencil is a decal (PROPS.md); the fringe is geometry.
- **`baked_unique` fallbacks.** Skin, hair, nightgown, flannel, car interior and photo are plausible stand-ins only, until the character/prop bakes ship.
- **Tile-space variation limits.** Stone, gravel and mud read slightly procedural up close. Rag-rug braids alias at distance on Low.
- **Runtime-layer cost is unmeasured.** Every bound material evaluates several `mx_fractal_noise` calls per fragment, on all presets including Low (macro + hue, plus stains/dust where the spec asks). `materialUniforms.macro = 0` does not remove that ALU. The octaves could be gated by preset (or the layers dropped on Low) if the frame time needs it.
- **World-space stain layers.** These run after calibration, so wallpaper and plaster in-game are ~5–10 % darker on average than `avgAlbedo`. That is an intentional look, but Cycles doesn't see it.
