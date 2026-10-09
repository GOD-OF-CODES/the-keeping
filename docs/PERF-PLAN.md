# PERF-PLAN — load time, shader variants, WebGPU MSAA (three r186)

Owner: graphics performance (read-only analysis; no src/blender/assets edits). Evidence = our code + three r186 sources
in `node_modules/three` + the lead's headless runs in `scratch/diag/*-report.json` (spawn CP3, 800×600, fresh Chrome
profile per run → **cold GPU shader cache**: these are first-visit numbers). Helper scripts: `scratch/perf/variants.mjs`
(material instances / lighting signatures from the shipped GLBs) and `scratch/perf/octree-bench.mjs` (collision build
cost in V8).

## 0. TL;DR

| run (spawn CP3) | load now | where the time goes (console timeline) | target | expected after P0+P1 |
|---|---|---|---|---|
| Medium / WebGPU | ~40 s | level 2.6→21.7 s (probes 4.7, collision ≈5.5+, unexplained ≈5); compileAsync ≈8.3 s (wrong context); room warm-up 9.5 s | < 15 s | ≈ 14–19 s (the last ~4 s need the phase timers of P2-9) |
| Low / WebGPU MSAA | 166 s | probes 61 s, compileAsync 20 s timeout, room warm-up 65 s, frame 291 ms | — | MSAA off (P0-3) → as no-AA row |
| Low / WebGPU no AA | 54 s | probes 3.4 s, compileAsync 20 s timeout, room warm-up 15.4 s, first frame ≈3 s | — | ≈ 12–16 s |
| Low / WebGL2 MSAA | 232 s | materials 9.1 s, probes 70 s, compileAsync 20 s timeout, **first frame ≈52 s**, room warm-up 71 s | < 45 s | ≈ 25–40 s |

Root causes, in order of damage:
1. **We compile the wrong variants.** `renderer.compileAsync(scene, camera)` (main.ts:119) builds every material for
   the renderer's *default* context, but the frame is drawn inside DirectRenderPipeline's context (Low) or the
   `pass()` MRT render target (Medium/Max). The node cache key contains the render-context id and the renderer's
   `contextNode` → none of the compileAsync work is reused; the first real frame and the 4-heading room warm-up then
   compile everything **synchronously**.
2. **Three full material contexts per load** (probe bake cube RT + compileAsync framebuffer + real pipeline), plus
   castShadow toggles that throw variants away → ~630 programs for one context's worth (~200) of real shaders.
3. **Runtime probe bake**: 1 140–2 352 cube-face scene renders on the main thread (70 s on WebGL2), and its own
   material variants.
4. **Runtime `castShadow` toggles** (warm-up candle, C2, cutscene silhouette) change the LightsNode cache key →
   every material on that LightsNode is disposed and rebuilt, twice per toggle pair. Prime suspect for the stall
   after "Compiling shaders — U4T".
5. **WebGPU + MSAA on Low**: measured 100× frame cost. r186 code shows MSAA only touches the canvas/framebuffer
   attachments (not the probe bake), so part of the measured gap is unexplained — but the decision doesn't depend on
   it: Low/WebGPU should not use MSAA (P0-3).
6. **Collision Octree** of ~122 k triangles: 5.5 s single-threaded in V8 (`octree-bench.mjs`).

## 1. Shader-variant explosion (≈630 programs for 63 material specs)

### 1.1 What r186 counts and what changes a variant

- `info.memory.programs` counts **shader stages, not pipelines**: `Info.createProgram` (Info.js:414-423) is called
  once per distinct vertex source and once per distinct fragment source (Pipelines.js:187-211 —
  `this.programs.vertex.get( nodeBuilderState.vertexShader )`, keyed by the **code string**). So 630 ≈ ~150 vertex +
  ~480 fragment stages.
- **Node build (CPU)** is cached per `renderObject.initialCacheKey` (NodeManager.js:151-155, 198-212), which is
  `getMaterialCacheKey() + getDynamicCacheKey()` (RenderObject.js:962-966):
  - `material.customProgramCacheKey()` hashes every node property's `getCacheKey()` (NodeMaterial.js:428-440), and a
    plain node's `customCacheKey()` is **`this.id`** (Node.js:470-474) → every material built by
    `createSurfaceMaterial` (fresh nodes per call) has its own node-build cache entry, even with an identical graph.
  - plain material fields: textures contribute only `mapping` + sampler state (RenderObject.js:780-797), so a
    different lightmap/texture **value** does *not* change the key; numbers are reduced to on/off (except `side`).
  - `cacheKey += this.context.id` (RenderObject.js:854) and `object.receiveShadow` (856): **one variant per render
    context** (canvas, framebuffer target, cube RT, pass RT …).
  - dynamic key (RenderObject.js:926-956): `NodeManager.getCacheKey(scene, lightsNode)` (LightsNode key, fog,
    environment) + `renderer.contextNode.id/version` → DirectRenderPipeline (which swaps `renderer.contextNode`,
    DirectRenderPipeline.js:96) and the default context never share.
  - `LightsNode.customCacheKey()` hashes each light's **id and `castShadow`** (LightsNode.js:147-160).
- **GPU program/pipeline (the expensive Metal/ANGLE compile)** is deduped by generated source: uniform/var names come
  from per-build counters (`'nodeUniform' + index`, NodeBuilder.js:2103-2105; `nodeVar` 2146), so two materials with
  the same graph *shape* and the same literal constants produce the same WGSL/GLSL and share the stage. The pipeline
  key is `vertexId,fragmentId,` + blend/depth/side/**sampleCount**/format/topology (Pipelines.js:433-436,
  WebGPUBackend.js:2442-2471).

So the question is "how many distinct sources × how many contexts".

### 1.2 Our axes (evidence)

| axis | where | effect |
|---|---|---|
| per-spec **literal constants** baked into the graph: `vec3(...baked.gain)` bind.ts:100, `float(spec.metalness)` 85, stain/dust/cloth thresholds 127-160, `vec3(...spec.avgAlbedo)` 107, clearcoat value 177 | `src/materials/bind.ts` | every spec has unique fragment source (~63 specs) |
| optional layers (`stainAmt>0`, `clothStain>0`, `dustAmt>0`, glass, flipV, extraKind, clearcoat/sheen) | bind.ts:116-182 | structural families (~15) |
| lightmapped vs probe-lit + **per-atlas LightsNode** `lights([flashlight, ...forRooms])` | level.ts:432-446 | `variants.mjs`: 106 (spec, atlas) pairs → **85** distinct (spec, light-signature) sources; 7 LightsNodes but only 5 distinct signatures |
| probe-lit LightsNode: flashlight + lightningDir + 3 lightning spots + 2 headlight spots + dashboard point + **3 LightProbeGrids** | level.ts:469-477 | one fat signature, 44 probe-lit specs |
| material instances (bind.ts key `spec|side|lightmap uuid|tangent|unique`) | bind.ts:262-272 | **182** instances from 631 primitives (`variants.mjs low`) → 182 node builds per context |
| **probe-bake context** (CubeRenderTarget, default contextNode, flashlight + flames hidden; probe-lit materials still on the *scene* LightsNode with every visible light) | level.ts:450-466, probes.ts:73 | full extra set, never used after load |
| **compileAsync context** (framebuffer target because AgX → `needsFrameBufferTarget`, Renderer.js:2609-2614, 929-933; default contextNode) | main.ts:119 | full extra set, never drawn (Low draws in DirectRenderPipeline's context, Medium in the pass RT with MRT{output, velocity}) |
| real context: Low = DirectRenderPipeline injects `renderOutput+grade+finish` into every material via `getOutput` (DirectRenderPipeline.js:213-221); Medium = `pass()` + MRT velocity | pipeline.ts:116-127, 129-132 | the only set that matters |
| `castShadow` toggles: warm-up candle (main.ts:659/675), C2 `castShadow` binding (cutscenes/bindings.ts:260), silhouette (world/cutscene-fx.ts:552/567) | — | each toggle disposes the render objects of every material on that LightsNode (RenderObjects.js:136-142) and releases their states/pipelines when unused (Pipelines.js:150-175) → rebuilt on toggle-on **and** toggle-off |
| QA `capture()` renders the Low pipeline into a plain render target (main.ts:322) → `isOutputTarget === false` (Renderer.js:2686-2688) → `getOutput` returns the raw material output (DirectRenderPipeline.js:218) | main.ts:317-341 | another full set on Low **and Low screenshots lack AgX/grade/vignette/grain** (QA sees linear HDR clamped to 8-bit, not what players see) |
| skinning, alphaHash hair (characters/loader.ts:128), fog: none, clearcoat/sheen only Medium+ unlit-lightmap-free | — | small (≤ 15 sources) |

Rough arithmetic for one context: 85 lightmapped + 44 probe-lit + ~25 characters/decals/fx/doors ≈ 155 fragment +
~40 vertex ≈ **200 stages**. Observed 630–689 ≈ 3 contexts + toggles + captures. Confirm with the counter in §6.

### 1.3 Dedupe plan and expected counts

1. Compile/draw in one context only (P0-1) and ship the probe data (P1-4): removes the bake and compileAsync sets →
   **≈ 220–260 stages** (incl. ~15 post, ~10 shadow-depth, ~10 baker leftovers).
2. Fixed light set (P0-2): no rebuilds, no extra variants.
3. Per-spec literals → uniforms (P1-6a): `uniform(vec3(gain))`, `uniform(metalness)`, stain/dust thresholds as
   uniforms. Specs sharing a structural family then share source → lightmapped ≈ 15 families × 5 signatures ≈ 40–55,
   probe-lit ≈ 15 → **≈ 110–130 stages** total. (Node builds stay 182 per context; that CPU part is ~2–4 s on M1 and
   can be async via compileAsync.)
4. LightsNode groups (P1-6b): 7 atlas nodes → 4 (exterior, ground-floor, upper-floor, car) with identical *types* per
   group; probe-lit node without the headlight/dashboard lights except for the car/exterior props.

## 2. WebGPU + MSAA (Low)

What r186 does with `antialias: true` (`_samples = 4`, Renderer.js:275):
- Drawing to the canvas with no render target: `currentSamples` = 4 (Renderer.js:2639-2653) because
  DirectRenderPipeline sets `toneMapping = NoToneMapping` + linear output (DirectRenderPipeline.js:115-116) so
  `needsFrameBufferTarget` is false → three renders straight into a 4× MSAA color texture + 4× depth and resolves into
  the swap-chain texture (WebGPUBackend.js:440-490); color **and depth** use `storeOp: Store`
  (WebGPUBackend.js:1021, 1043-1047) — the MSAA attachments are written back to memory every pass instead of
  staying on-tile.
- The canvas MSAA color/depth textures are **destroyed and recreated whenever `currentSamples` changes**
  (WebGPUTextureUtils.js:520-560, 578-629; descriptor rebuilt in WebGPUBackend.js:449). Anything that renders to the
  canvas with samples 0 (fullscreen pass, a non-pipeline `renderer.render` with AgX → framebuffer target + output
  quad) between two pipeline frames causes per-frame reallocation.
- Pipelines are keyed by sample count (WebGPUBackend.js:2466) → every material pipeline exists twice if anything also
  draws it at 1 sample (cube RT, capture RT).
- **The probe bake never uses MSAA**: CubeRenderTarget has `samples 0` (LightProbeGrid.js:193), `currentSamples` uses
  the target's samples (Renderer.js:2643-2646), depth textures of targets use the target's samples (Textures.js:69-90).
  Yet the MSAA run's bake took 61 s vs 3.4 s, and its material bakes were 3–10× slower too, *before* any canvas MSAA
  allocation exists. So part of the 291 ms vs 2.7 ms gap is not explained by three's code (candidates: cold Metal
  pipeline compiles for the doubled sample-count pipelines landing inside the timed loop, swap-chain resolve behaviour
  of headless Chrome, or a run-level GPU degradation). One A/B pair is not enough to attribute it — see the
  discriminating runs in §6.

**Recommendation (independent of the root cause):**
- Low on **WebGPU**: `antialias: false`; render through a minimal `RenderPipeline`:
  `pass(scene, camera, { samples: 0 })` → `renderOutput(AgX, sRGB)` → `finish` → `fxaa()` (r186:
  `three/addons/tsl/display/FXAANode.js:364`, runs on display-referred input, so after renderOutput). Cost at
  800×600 on M1 ≈ 0.2–0.4 ms (one RGBA16F store + one FXAA pass), ≈ 0.8–1.5 ms at 1080p on an Intel UHD 620 — well
  inside the 33 ms Low budget. Bonus: Low then compiles exactly like Medium (`scenePass.compileAsync`, P0-1).
- Low on **WebGL2**: keep MSAA (measured 5 ms/frame). Either keep DirectRenderPipeline + canvas MSAA, or (simpler,
  one code path) the same `pass()` pipeline with `{ samples: 4 }` (PassNode.js:800) and no FXAA.
- Keep `?aa=0|1` as the switch for the A/B runs below.

## 3. Load time

### 3.1 Probe bake
- Cost: Medium 392 probes × 6 faces = 2 352 scene renders in 4.66 s (2.0 ms/face); Low 190 × 6 = 1 140 in 3.4 s
  WebGPU (3.0 ms/face), **70.1 s on WebGL2 (61 ms/face)** — WebGL2 compiles the bake variants synchronously and pays
  per-draw CPU overhead; the whole grid bake is one synchronous task (the audio prerender's completion was delayed
  75 s by it: `step_gravel 75129ms` in low-webgl-report — the page is unresponsive that long).
- The per-probe loop (LightProbeGrid.js:667-688) is `CubeCamera.update` (6 full scene renders) + an SH quad.
- **Best fix: ship the grid data as our own generated asset.** The node only reads `light.texture`
  (LightProbeGridNode.js:100, 115: `texture3D( light.texture )`); the atlas is `RenderTarget3D(nx, ny,
  7·(nz + 2·ATLAS_PADDING))`, RGBA HalfFloat (LightProbeGrid.js:772-789; `ATLAS_PADDING = 1`,
  LightProbeGridNode.js:5). For Medium's grids (7×2×9, 7×2×9, 7×2×10) that is **≈ 27 KB total**. Export once per
  asset build in headless Chrome: bake as today, then `renderer.readRenderTargetPixelsAsync(grid._renderTarget, 0, 0,
  nx, ny, 0, slice)` per Z slice (WebGPU copies `origin.z = faceIndex`, WebGPUTextureUtils.js:825-827). At runtime:
  `renderer.library.addLight(LightProbeGridNode, LightProbeGrid)` (what bake() does, LightProbeGrid.js:471-473),
  `grid.texture = new THREE.Data3DTexture(halfs, nx, ny, depth)` (HalfFloatType, RGBAFormat, LinearFilter,
  ClampToEdge), set position/size/resolution, never call `bake()`. Key the file by a hash of lightmaps + layout +
  material-spec + probes.ts so a stale file falls back to the runtime bake. One dataset (Medium density/16² cubes) can
  serve all tiers.
  Gain: Medium −4.7 s, Low/WebGPU −3.4 s, **WebGL2 −70 s**, and the whole bake-context variant set (§1) disappears.
- Fallback if shipping is rejected: (a) bake in chunks (`bake(..., { start, count })`, LightProbeGrid.js:450-451)
  with `await nextFrame()` between chunks (no long task); (b) swap in **bake proxies** during the bake —
  `MeshBasicNodeMaterial(colorNode = albedo × lightmap)` per lightmapped material (unlit, no LightsNode, no noise
  layers) — tiny shaders, fast WebGL2 compile; (c) Low already uses q = 0.7 density (level.ts:562); cubemapSize 8 is
  already minimal.

### 3.2 Shader compile and room warm-up
- `compileAsync` covers only the **spawn camera frustum** (Renderer.js:975-987) and, as shown in §1, the **wrong
  context**. The 20 s `Promise.race` (main.ts:119) does not cancel anything: leftover `createRenderPipelineAsync`
  (WebGPU) / KHR_parallel polls (WebGL2, `requestAnimationFrame` loop at WebGLBackend.js:1551-1581) keep running and
  compete with the synchronous warm-up that follows.
- The first `pipeline.render()` (main.ts:124) runs with `level.setCulling(false)` still in effect from the probe
  bake (level.ts:450) → the whole level inside the spawn frustum compiles synchronously in the real context (≈52 s
  on WebGL2, ≈3–6 s WebGPU).
- Room warm-up (main.ts:627-705): 11 rooms × 4 headings of synchronous `render()` — every new pipeline is a
  blocking `createRenderPipeline` / `linkProgram` + status query.
- **Fix:** compile per room through the real context, asynchronously:
  - Medium/Max and new Low/WebGPU (`pass()`): `await scenePass.compileAsync(renderer)` (PassNode.js:783-795 sets the
    pass RT + MRT; for Max also set `renderer.contextNode` to the pass's GTAO context like PassNode.js:890-901).
    Expose it as `pipeline.compileView(): Promise<void>` in pipeline.ts.
  - WebGL2 Low if it stays on DirectRenderPipeline: inside `compileView` replicate DirectRenderPipeline.render's setup
    (call `rp._update()`, set `renderer.contextNode = rp._contextNode`, `toneMapping = NoToneMapping`,
    `outputColorSpace = workingColorSpace`, scene.backgroundNode) around `renderer.compileAsync` — private fields,
    so prefer the uniform `pass()` path.
  - Order: `level.setCulling(true)`; for each room: `level.setViewer`, set one camera per room with a wide FOV
    (e.g. 120°) or 2 headings, `await Promise.race([pipeline.compileView(), delay(4000)])`; then **one** synchronous
    `render()` per floor to create the shadow-pass render objects (shadow maps use the shared override material,
    ShadowNode.js:687, so they add few programs).
  - Then do the special sets (candle shadow, car set) the same way, culling ON, only the needed groups visible.
  - Log each step (`[game] warm <room> <ms>`) so the next stall names its step.
- Expected: Medium compileAsync 8.3 s + warm-up 9.5 s → ≈ 4–6 s total; WebGL2 52 + 71 + 20 s → ≈ 15–25 s
  (parallel compile, ~⅓ of the programs).

### 3.3 The intermittent stall after "Compiling shaders — U4T"
The overlay's last label is the last room, so the freeze is in main.ts:653-700. In that window the code:
1. toggles `candle.light.castShadow = true` → the LightsNode keys of the parlor atlas, characters (`charLights`) and
   arms (`armLights`) change (LightsNode.js:147-160) → all their render objects are disposed and rebuilt
   synchronously, plus the new point-shadow cube pass (6 faces) — then toggles it back, rebuilding them **again**
   (and releasing the variants it just warmed: RenderObjects.js:136-142 + Pipelines.js:150-175, so the warm-up does
   not even survive until C2);
2. renders the car set with `level.setCulling(false)` (main.ts:687) — the entire house plus the row car in that
   frustum, first time in the real context;
3. runs while the timed-out compileAsync work may still be pending in the GPU process.
With a fresh Chrome profile (cold Dawn/ANGLE blob cache, shot.mjs:159-161) the Metal compiles of the largest
fragment shaders (probe-lit: 11 lights + 3 grids + point shadow + 7–10 octaves of noise) are slowest, which fits
"intermittent". Fixes: P0-1 (async, capped, per step logged), P0-2 (no castShadow toggles), car set with culling on.

### 3.4 Other load items
- **Collision Octree**: `scratch/perf/octree-bench.mjs low` → collision.glb alone 1 276 tris / 0.15–0.2 s; with
  placed prop triangles (≤ `PROP_TRI_LIMIT = 9000` exact, collision.ts:20, 231) **121 760 tris → 5 528 ms** in V8
  (Node; in the page with GC pressure it is likely slower). level stats report 104 064 (Low) / 125 372 (Medium)
  tris. Fixes: `PROP_TRI_LIMIT` ≈ 1 500 with oriented boxes above it (most props are boxes to a capsule), or
  Blender-side `*-collider` proxies (lane A), or build in a Worker. Gain ≈ −4–5 s on every backend.
- **Generated-material baker on WebGL2**: 56 materials in 9.1 s, ~40 ms submit each (sync compile per generator).
  Precompile all generator materials in parallel first (temporary scene of quads with the generator materials,
  `renderer.setRenderTarget(scratch)`, `await renderer.compileAsync(tmpScene, cam)`), then bake → ≈ 2–3 s.
- `renderer.debug.checkShaderErrors` (Renderer.js:749) is true by default → extra synchronous status/log queries on
  WebGL2; set false outside `?debug`.
- Unaccounted ≈ 5 s inside level load on every backend (between "bound 7 generated materials" and "[level] loaded"
  minus probes and collision): add `collisionMs`, `doorsMs`, `lightsMs`, `swapMs` to `level.stats` before tuning.

## 4. Per-frame risks for Low / integrated GPUs (CLAUDE.md: Low ≥ 30 fps, ≤ 400 draws)
1. **Procedural noise per pixel** in every surface material: macro (fractal 2 oct + 1), wall stains (4 oct), cloth
   stains (4), dust (3) — bind.ts:116-160; up to ~10 MaterialX Perlin octaves per fragment (~300–400 ALU each).
   On an Intel UHD 620 at 1080p that is on the order of 10–20 ms/frame by itself. Fix for Low: `layers: { macro:
   false, dust: false }` (already supported, bind.ts:65/118/155) or replace `mx_fractal_noise_float` with 1–2 fetches
   of a 64³ noise `Data3DTexture` generated at load by `noise-cpu.ts` (from scratch, allowed).
2. **Probe-lit LightsNode = 11 lights** (level.ts:471) evaluated per pixel even at intensity 0 — incl. 2 headlight
   spots + dashboard point that only matter in the car/exterior, and **3 grids** (7 `texture3D` fetches each,
   LightProbeGridNode.js:115) on every probe-lit pixel. Split: interior probe-lit node = flashlight + lightning spots
   + its floor's grid; exterior/car node adds headlights/dashboard/exterior grid.
3. **Flashlight shadow pass re-renders all `castShadow` level meshes every frame** (level.ts:362-365 sets it on every
   level mesh; flashlight.ts:39-40, 1024² on Low). Floors/ceilings never occlude the hand-held light visibly →
   `castShadow = false` on floor/ceiling/terrain meshes; Low map 512².
4. **Draw calls**: 631 primitives in the level GLBs, culled per room. Lightmapped statics never move
   (`matrixAutoUpdate = false`, level.ts:356-361): merge per (room, material instance) at load
   (`BufferGeometryUtils.mergeGeometries`) — fewer draws in both the main and shadow passes.
5. **MSAA on WebGPU** — P0-3.
6. Memory on 8 GB: Medium `texturesSize` 524 MB; lightmaps alone 7 × RGBA16F (6 × 2048² + 1024²) = **200 MB**.
   Repack KLM to `RGBFormat + UnsignedInt5999Type` (rgb9e5; supported by both backends: WebGPUTextureUtils.js:1665,
   WebGLUtils.js:62) on decode → 100 MB, half the upload time.

## 5. Prioritized fixes

| # | fix | files (lane B unless noted) | gain | risk |
|---|---|---|---|---|
| **P0-1** | Compile in the drawn context: `pipeline.compileView()` (pass.compileAsync / Direct context), per-room async with a 4 s cap, one sync render per floor for shadow objects, `setCulling(true)` before the first frame, step logging; drop the global `renderer.compileAsync(scene, camera)` | main.ts:115-130, 627-705; pipeline.ts (new `compileView`) | Medium −10 s; WebGL2 −90…−120 s; removes one full variant set | a missed variant → first-visit hitch; detect with the per-phase program counter (§6) |
| **P0-2** | Never toggle `castShadow` at runtime: create the C2/silhouette shadow light(s) with `castShadow = true` from load, in the LightsNodes that need them, `shadow.autoUpdate = false` + `needsUpdate = true` only while the shot runs, intensity 0 otherwise; delete the candle toggle from the warm-up | main.ts:653-677; cutscenes/bindings.ts:254-264; world/cutscene-fx.ts:546-568; world/lights.ts | removes C2/silhouette hitches and the prime stall suspect | the always-on point shadow is sampled by parlor/character pixels (≈ +0.1–0.3 ms); cutscene lane must agree |
| **P0-3** | Low on WebGPU: `antialias: false` + `pass()` → renderOutput → finish → `fxaa()`; WebGL2 Low keeps MSAA (or `pass({samples:4})`) | renderer.ts:41; presets.ts:54 (`antialiasing` per backend); pipeline.ts:116-127 | Low/WebGPU frame 291 → ≈3 ms, load 166 → ≤ 54 s before other fixes | FXAA softens fine text (handwriting) slightly |
| **P1-4** | Ship LightProbeGrid data (`probes_<grid>.bin`, ≈27 KB) generated by a headless-Chrome export; runtime bake only as hash-mismatch fallback, in chunks | render/probes.ts; world/level.ts:448-466; new export scenario (lane C `scripts/qa/`) + manifest entry (lane A `scripts/assets.mjs`) | Medium −4.7 s, Low −3.4 s, WebGL2 −70 s; −1 variant set | stale data after a relight → hash check + fallback |
| **P1-5** | Collision: `PROP_TRI_LIMIT` 9000 → ~1500 (boxes above), or collider proxies from Blender | world/collision.ts:20, 220-240 (lane A for proxies) | −4–5 s all backends | slightly coarser prop collision |
| **P1-6** | Variant dedupe: (a) per-spec literals → uniforms; (b) 4 LightsNode groups; (c) QA `capture()` via `renderer.setOutputRenderTarget(rtg)` instead of `setRenderTarget` so Low captures go through the real output (also fixes Low screenshots missing AgX/grade) | materials/bind.ts:85-182; world/level.ts:432-446, 469-477; game/main.ts:317-326 | programs ≈630 → ≈110–130 after P0/P1 | (a) visual parity: diff matlab shots before/after |
| **P1-7** | Baker: parallel precompile of generator materials | materials/baker.ts | WebGL2 materials 9.1 → ≈2–3 s | none |
| **P2-8** | Low per-frame: noise layers off/texture noise on Low; probe-lit light split; floors/ceilings `castShadow=false`; static merge; RGB9E5 lightmaps | bind.ts, level.ts, flashlight.ts, lightmap-material.ts/klm.ts | integrated GPUs: −5…−15 ms/frame at 1080p; −100 MB on Medium | anti-tiling look on Low |
| **P2-9** | Instrumentation: phase timers in level.stats, per-step warm-up logs, `checkShaderErrors=false` outside debug | level.ts, main.ts, renderer.ts | finds the last ~5 s | none |

## 6. Measurement protocol (scripts/shot.mjs only; one headless Chrome at a time)

Instrumentation to add first (P2-9, debug-only, `?debug`): `renderer.debug.onNodeBuilderCreated =
(b, ro) => count[phase]++` (Renderer.js:738/753) and `renderer.info.memory.programs` snapshots at phase boundaries
(`afterMaterials`, `afterProbes`, `afterCompileAsync`, `afterFirstFrame`, `afterWarmup`, `ready`), logged as
`[perf] phase=<p> builds=<n> programs=<n> ms=<t>`; `report.console` keeps them.

Runs (always `--spawn CP3 --wait 6 --fps 5`, default 1280×800; repeat each ×2, report the median; never while a
Blender job runs):

| id | command | compare |
|---|---|---|
| M | `node scripts/shot.mjs --preset medium --spawn CP3 --wait 6 --fps 5 --name perf-m` | loadSeconds, `[level] loaded` stats, compile+warm-up, gpuFrameMs, programs |
| LG | `… --preset low --name perf-lg` | same |
| LG0 | `… --preset low --query "aa=0" --name perf-lg0` | MSAA A/B |
| LW | `… --preset low --backend webgl --name perf-lw` | WebGL2 |
| MSAA-1 | `… --preset low --query "scene=test&aa=1" --name msaa-test1` and `aa=0` | is the 100× scene-independent? (test room: tiny scene) |
| MSAA-2 | after P0-3 lands: Low/WebGPU with `pass({samples:4})` instead of canvas MSAA (temporary debug flag) | canvas-MSAA-specific vs MSAA in general |
| PB | `--scenario` that calls `__game.gpuFrameMs(60)` twice in a row | the 2nd call excludes first-use pipeline compiles — tells compile cost from steady-state |

Acceptance per fix: P0-1 → `programs` at `ready` ≤ 1.2 × programs at `afterFirstFrame`, no
`compileAsync still pending` warning, Medium load < 25 s; P0-2 → no builds during the C2 / silhouette beats (run the
playthrough scenario and diff builds count per beat); P0-3 → Low/WebGPU gpuFrameMs ≤ 4 ms at 800×600; P1-4 → no
`probesMs` > 100 ms, Medium < 18 s; all → WebGL2 < 45 s, Medium/WebGPU < 15 s, zero console errors, playthrough
reaches the ending. Note: shot.mjs uses a fresh profile per run (cold GPU shader cache) — these are worst-case
first-visit numbers; a `--keep-profile` option (lane C) would also give the returning-player number.

## 7. Requests for the lead
- Lane B: P0-1/P0-2/P0-3, P1-5/6/7, P2 items in src/game, src/render, src/world, src/materials.
- Cutscene lane: agree on fixed shadow lights (P0-2) for C2 and the silhouette.
- Lane A: manifest entry + hash for `probes_<grid>.bin` (P1-4); optional prop collider proxies (P1-5).
- Lane C: probe export scenario under `scripts/qa/`, `--keep-profile` for shot.mjs, the per-phase counter runs above.

## 8. Status (perf lane, 2026-10-07)

- **Shipped probe data:** `npm run probes` (= `node scripts/qa/probes-export.mjs [low|medium|max] [--dist <dir>]`) bakes the
  LightProbeGrids in headless Chrome (through `scripts/shot.mjs` and its lock, `?probes=bake`) and writes
  `public/assets/<tier>/probes.bin` (≈14 KB Low, ≈27 KB Medium/Max). The level fetches it by that fixed path; its key
  covers the level files' manifest hashes + layout + material spec + grid specs, and a mismatch logs
  `shipped probes are stale` and falls back to the runtime bake. Re-run after every `npm run assets` that touches level
  files, and after lighting / material **code** changes (not in the key).
- **Collision (P1-5):** `box` props → oriented boxes; the ground quad lives in its own octree
  (`WorldCollision.octree` answers for both). In-page build: 10.3 s with the ground in the shared octree, 3.4 s without;
  load phase 5.1 s → 1.5 s (Medium/WebGPU, warm Metal cache).
- **Baker (P1-7):** `MaterialBaker.precompile()` compiles every generator program in parallel before the serial bakes.
- **Capture (P1-6c):** `__game.capture()` renders through `setOutputRenderTarget`.
- **Measurement caveats found:** (1) macOS keeps a system-wide Metal shader cache across Chrome profiles: the first
  run after any shader-source change is "cold" (Medium load 92 s vs 24 s warm, same build) — always report both;
  (2) on battery, Chrome caps rAF at 30 fps (energy saver) and GPU timings rise — measure on mains power only;
  (3) the Blender lane rewrites `public/assets` in parallel — A/B only between dist builds made from the same assets.

### 8.1 Adversarial review (2026-10-07, mains power, `--dist scratch/dist-perf-review`)

§6 protocol, CP3, 1280×800. "base" = HEAD `src/` built with the **same** `public/assets` (scratch/dist-perf-review-base);
"cur" = the working tree with freshly exported probes (all three tiers `shipped`). Run 1 after a build is cold-ish
(system Metal cache), run 2 warm.

| run | base load (1 / 2) | cur load (1 / 2) | programs ready base → cur | GPU ms base → cur |
|---|---|---|---|---|
| Medium / WebGPU | 52.6 / 44.0 s | 12.7 / 12.5 s | 778 → 351 | 10.3 → 10.6 (noise) |
| Low / WebGPU | 170 / 41.8 s | 51.7 / 11.8 s | 808 → 264 | 10.8 → 5.6 (1280×800); **4.01–4.16 at 800×600** (target ≤ 4: borderline) |
| Low / WebGL2 | 246 / 76.2 s | 83.6 / 18.6 s | 810 → 262 | 19.7 → 17.0 |
| Max / WebGPU | 235 / 65.1 s | 113 / 26.3 s | 1108 → 703 | 11.0 → 10.6 |

Programs after the 4 test views: +0…+2 (P0-1 ratio ≈ 1.0). Visual parity (upper / hall / parlor / facade): Medium and
Max SSIM base↔cur at or above the same-build grain floor, mean luminance within ±1 %; shipped probes ≡ runtime bake
on WebGPU and on WebGL2 (data exported on WebGPU). Low/WebGPU (FXAA instead of MSAA, by design): fine twigs slightly
softer; one small specular glint on the hall door that MSAA used to average away. Cold first visits stay long
(Low/WebGPU 52 s, WebGL2 84 s, Max 113 s) — program count is the lever (P1-6b).

**Found in review — runtime rebuild churn (fixed):** the *scene* LightsNode (RenderObject dynamic key, used for every
render object regardless of `material.lightsNode`) changed whenever (a) room culling hid the gate sedan / car
interior, which carried the headlight / dashboard lights, and (b) the torch toggled (`light.visible`). Each change
disposed and rebuilt every visible render object (~40–60 node builds per indoor/outdoor crossing). Fix: those lights
live in the always-visible runtime group and follow their props; torch off = intensity 0 + frozen shadow map
(CONTRACT-CHANGES row 35). Evidence: the scene light set went from two sets (17 lights outdoors, 15 indoors — headlights dropped) to one constant 18-light set for the whole playthrough; node builds B02→B08 1 617 → 301 (caveat: the later runs also carry newer Blender assets and other lanes' uncommitted src). Also warmed in the load: the C2 candle's
cube-shadow pass (tableau step, shadow unmuted) and the cutscene DoF chain is pre-built (setCutscene once behind the loading screen — the RenderPipeline output material still rebuilds on every switch).
Still at C2's first frames: ~300 builds / +50 programs (flashlight + candle shadow-pass objects seen only from C2's
cameras, post-quad rebuilds on every `setCutscene` switch — RenderPipeline.needsUpdate rebuilds its output material).
Lightning-dir shadow-pass objects (groundcover) build at the first strike that covers them (lighting lane's
atmosphere.ts). Re-run `npm run probes` after the Blender lane settles: probes went stale again at 14:xx.
