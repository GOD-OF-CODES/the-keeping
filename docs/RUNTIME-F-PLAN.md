# RUNTIME F — ranked plan (perf investigation for the runtime F builder)

Investigator: read-only runtime F investigator, 2026-10-09. Evidence log: `docs/STATUS-runtime-f.md` (F0…).
Scenario: `scratch/rf/probe.mjs` (wraps `renderer.render` → per-pass draws/tris/CPU with nesting subtracted, and
`renderer.info.update` → per object / room / material per pass; real-time per-frame rAF dt, CPU of the rAF callbacks,
non-blocking GPU-done latency via `queue.onSubmittedWorkDone`, JS heap, LoAF/long tasks, event-bus log).
Reports `scratch/rf/<run>-report.json`, logs `scratch/rf/<run>.log`; system sampler `scratch/rf/sampler.log`.
Base dist `scratch/dist-re-final`. Experiment dist `scratch/rf/dist-x` (throwaway worktree `scratch/rf/wt`, switches
`?rfgtao=0|ov`, `?rffar=<m>` — not in the real tree).

**Measurement caveat:** the Mac went to battery at ≈ 15:2x (pmset), so absolute fps / GPU ms / load seconds of the
runs after that are pessimistic. Draw, triangle, pass, build and program counts are exact and power-independent.

## 0. Answer in one paragraph

Max ≈ 1.6–1.8× Medium in draws because **Max renders the opaque scene twice**: the GTAO normal pre-pass
(`pipeline.ts` 304–325, MRT `packNormalToRGB(normalView)`, `transparent = false`) is a full second scene render with a
second pipeline per material. Measured on Max: C1 60.5 = main 353 + **pre-pass 308** + headlamp shadow 25 + 17 post =
703 draws / 2.42 M tris (pre-pass 1.18 M); C1 61.8 = 348 + **306** + 16 = 670 / 2.37 M; u1-armoire = main 333 +
**pre-pass 281** + torch shadow 168 + 16 = 798 / 2.56 M. Second cause, both presets: **from inside the house the whole
yard is drawn** (layout `visibleRooms` of U1/U2/U3/G1 contains EXT2, culling is frustum-only): at u1-armoire room_EXT2 =
361 draws / 1.99 M tris across main + pre-pass + torch shadow (four parked sedans, the 65 k dead tree, ground-cover
turf, tree-line shrubs) — 45 % of the draws and 78 % of the triangles of a view whose interest is an armoire. Shadow
passes are small: only the lights with `autoUpdate` on render (torch while on; headlamp L during C0/C1). Other
passes the task asked about: reflection-probe captures = 0 draws per frame (13 cubes captured once at load,
reflections.ts 316–319); TAAU / RCAS sharpen / bloom (11 quads) / GTAO quad / DOF / composite = the 15–17 "post-quad"
draws in every table (0 triangles); there is no transmission pass.

## 1. Ranked items

### F1 — Max: remove the duplicate opaque render of the GTAO pre-pass (biggest Max lever)
- **Note:** draw / tri / build / program deltas below are exact; fps / GPU-done deltas are same-session magnitudes on a
  fanless Air on battery (thermal drift between sessions) — re-measure on AC as the first session after idle.
- **Measured:** pre-pass = 308 / 306 / 281 draws and 1.18 / 1.18 / 1.10 M tris at C1 60.5 / C1 61.8 / u1-armoire
  (44 % of draws, 43–49 % of tris), 6.8–8.4 ms main-thread CPU per frame (stepped). Without it Max would be 395 / 364 /
  517 draws and 1.24 / 1.19 / 1.46 M tris — inside the Max ruling at both C1 cuts. Load: the pre-pass context roughly
  doubles the warm-up node builds (Max warm-up 2145 builds vs Medium 1101) and adds ≈ 450 programs (1480 vs 1028).
  **A/B measured (x-max-noao, `?rfgtao=0`; battery like the control runs, fps relative):** C1 60.5 703 → 400 draws, 2.42 → 1.24 M tris;
  C1 61.8 670 → 363, real-time **38.7 → 60.0 fps** (GPU-done p50 45.7 → 10.3 ms); u1-armoire 798 → 533, **50.5/38.8/33.0 →
  57.1/60.0 fps** (GPU-done p50 37–54 → 12 ms); cold load **270.6 → 104.2 s** (warm-up 206 → 73 s, builds 2145 → 1099,
  programs 1480 → 1000, render pipelines 974 → 657); JS heap 2.0–2.2 → 1.5–1.65 GB. GTAONode's own quad material
  ('GTAO') was node-built 251 times during the load (153 in one context) — gone with the pre-pass.
- **Root cause:** `prePass = pass(scene, camera)` renders every visible opaque mesh with its own material (MRT output
  only replaces the colour output), so each draw costs the same CPU encode as the main pass and each material compiles
  a second WGSL/Metal pipeline in the pre-pass render context.
- **Change (pick A, fall back to B):**
  - **A. No pre-pass: AO from the main pass, applied with one frame of reprojection.** Add `normal: packNormalToRGB(normalView)`
    to the scene pass MRT (`mrt({ output, velocity, normal })`, u8 target as now), run `ao()` on the scene pass's
    depth + normal AFTER the main pass, and have `getAO` sample last frame's AO texture at `screenUV − velocity`
    (the velocity MRT already exists for TAAU). GTAONode already runs `useTemporalFiltering`, so the AO is
    temporally accumulated anyway; one frame of extra latency at 60 fps is 16 ms. Draws −281…−308, tris −1.1…−1.2 M,
    CPU −7…−8 ms, programs ≈ −450, warm-up builds ≈ −1000. Implementation note: the main pass cannot reference the
    AO node of the SAME frame (its updateBefore would need the main pass's own depth → cycle); copy the AO result into
    a plain history RenderTarget at the end of the chain and read it as `texture(historyRT.texture)` (not a pass node)
    in `getAO`. Ruling needed: this is "visual parity" only if the A/B frames match — the lead's never-degrade-Max rule.
  - **B. Keep the pre-pass but make it cheap:** render it with ONE override material (wrap `prePass.updateBefore` to set
    `scene.overrideMaterial = new MeshBasicNodeMaterial()` and restore — exactly how three's own ShadowNode does it,
    ShadowNode.js 686; Renderer.js 3725–3753 copies `alphaTest`, `alphaMap`, `positionNode`, `side` per object) and skip
    distant exterior meshes in it via a layer (`camera.layers.mask` = near-only bits while the pre-pass renders; far
    yard meshes carry only a "far" bit). **Measured for the override alone (x-max-ov):** programs 1480 → 1088,
    pipelines 974 → 751, warm-up builds 2145 → 1270, pre-pass CPU 6.8–8.4 → 5.2–6.4 ms; draws unchanged (702 / 670 / 799)
    → fixes load/heap, NOT the draw budget; with the far-layer skip C1 60.5 would still be ≈ 575 draws.
- **Visual risk:** A — AO ghosting on disocclusion during fast turns (mitigated by velocity reprojection + the
  existing temporal filter; check C0/C1 pans and a 180° turn at u1-armoire, 3 × shot.mjs A/B). B — AO normals lose
  normal-map detail (half-res AO, invisible), alpha from `opacityNode`/hash (hair, foliage cards) is not copied →
  solid-card AO halos round hair; keep hair/foliage on their own material (`allowOverride = false`).

### F2 — Both presets: window-portal culling of the yard from inside the house
- **Measured (Max, u1-armoire):** room_EXT2 main 178 d / 900 k + pre-pass 143 / 889 k + torch shadow 40 / 202 k.
  Medium u1-armoire: room_EXT2 = main 177 d / 798 k + torch shadow 45 d / 204 k of 534 d / 1.37 M (budget 400).
- **Root cause:** `Level.applyVisibility` toggles whole room groups from `layout.rooms[].visibleRooms`; U1 / U2 / U3 / G1
  list EXT2, so every EXT2 child inside the 100°-wide frustum is drawn even though only a window's worth is on screen.
- **Change:** when `isOutside()` is false, test each EXT2 (and EXT1) child's bounding sphere against the union of
  window sub-frusta: for each window of the current visible rooms whose glass faces the camera, project its quad to
  NDC, build the 4 planes through the eye and the window edges, keep the child if it intersects any. ~300 sphere ×
  ≤ 6 window tests per frame (< 0.1 ms). Children outside every window frustum get `visible = false` (restore on exit).
  The four parked sedans also get one merged mesh per car (see F5).
- **Expected:** u1-armoire −150…−170 main draws on Medium (534 → ≈ 370, inside 400), −300+ on Max with F1-B,
  −1.5…−1.9 M tris on Max.
- **Visual risk:** popping at window edges if the bounding spheres are wrong — use world AABB/sphere from
  `geometry.boundingSphere` × matrixWorld, inflate 0.5 m; check by A/B frame diff at 4 indoor views (yard visible through
  U1/U2/G1 windows must be pixel-identical).

### F3 — Per-light shadow-caster culling (torch)
- **Measured:** torch shadow at u1-armoire = 168 draws / 352 k tris, of which EXT2 40 / 202 k (the 65 k P_TREE_2 is in it)
  and G1 31 / 29 k; 2.6 ms CPU. 354 of 425 visible meshes are casters (`level.ts` 306 / 385 / 404 set `castShadow = true`
  on EVERY level, prop and door mesh).
- **Root cause:** shadow passes cull by the shadow camera frustum only (90° cone, far 18 m), through walls and floors.
- **Change:** three r186 uses `shadow.camera.layers` when it has any bit above layer 0 (ShadowNode.js 675–681) —
  the same mechanism headlamps.ts 105 already uses (HEADLAMP_SHADOW_LAYER 5; collision uses 30). Give
  interior meshes layer 1, exterior meshes layer 2, characters/dynamic casters 1|2; set
  `torch.shadow.camera.layers.mask` = 1<<1 while the camera is indoors, 1<<2 | 1<<1 outdoors. An indoor receiver lit
  from an indoor torch can only be shadowed by an indoor occluder, so this is exact for every indoor pixel.
  Second step: `castShadow = false` for meshes whose bounding radius < 3 cm (screws, coins, papers) — their shadow is
  < 1 texel of a 2048² 90° map beyond 1 m.
- **Expected:** −40…−60 draws, −200…−250 k tris in the torch pass indoors; −1 ms CPU.
- **Visual risk:** one case: torch on indoors aimed out of a window — outdoor receivers lose shadows from outdoor
  casters. Acceptable: at ≥ 8 m through glass the torch delivers < 2 lux (120 cd / 64 m²) and those shadows fall on
  wet ground under rain; indoors and outdoors-with-camera-outdoors are unchanged.

### F4 — Both presets: the intermittent real-time stalls are V8 MAJOR GCs of a 1.3–2.2 GB live heap (item 2)
- **Measured (proof run heap-med, CDP `Tracing` with `disabled-by-default-v8.gc`, synced to per-frame rAF):** the C0
  stall reproduced at 10.0–11.12 s: `V8.GCIncrementalMarkingStart` 73 ms @C0 9.93 → 1.1 s of concurrent marking
  (`GC_MC_BACKGROUND_MARKING` 9.5 s summed over helper threads; frames 50–100 ms) → **`MajorGC`/`GCFinalizeMC` 524 ms
  atomic pause @C0 11.12** (the 567 ms frame), of which `GC_MC_MARK` 425 ms and **ephemeron (WeakMap) marking 323 ms**.
  Same shape in x-max-ctl at u1-armoire: 9 frames of 160–320 ms then a **1019 ms** frame exactly when the heap dropped
  248 MB. Same shape in pfin-max 20.6–22.0 (717 ms), R27 Medium 10.0–10.9, x-max-noao 8.8–9.3. The C0 time is random
  (whenever the old generation fills) — that is why stepping never reproduced it (c0step-max from 18.8 s: max CPU 18 ms,
  max GPU 11 ms, 0–2 builds/frame).
- **Heap:** `Runtime.getHeapUsage` 1356 MB used → **1291 MB still live after a forced GC** on Medium (+186 MB ArrayBuffer
  backing stores); Max 2.0–2.2 GB used. CPU-side geometry is only 68 MB and texture data 56–72 MB (heapAudit). The live
  heap tracks the NODE BUILD count: Medium 2104 builds ↔ 1.29 GB, Max-without-pre-pass 2100 ↔ 1.5–1.65 GB, Max 3177 ↔
  2.0–2.2 GB → ≈ 0.5 MB retained per build (NodeBuilderState, node graph, WGSL strings, bindings, held in three's
  WeakMap/ChainMap caches — hence the 323 ms ephemeron phase).
- **Allocation (HeapProfiler sampling incl. collected objects, 6 s):** 42–54 MB/s while playing. C1: story-runtime
  `step` 21 MB + `draw` 20 MB, three RenderObject `_update` 17 MB, exposure meter 9.5 MB, `Math.hypot` 9.6 MB. u1-armoire:
  **316 MB in 6 s** — three `getVertexPosition` 87 MB + `intersectTriangle` 14 MB + `intersectsObject` 6 MB (per-frame
  `Raycaster.intersectObject` walking whole triangle meshes: `Interactables.pick()` (interactables.ts 176, recursive,
  every frame, on the armoire/hide meshes in reach) and/or `FlashlightBounce.sample()` (flashlight-bounce.ts 235)),
  collision `M` 10.9 MB + `triangleCapsuleIntersect` 4.8 MB, three `_update` 37 MB, `getDynamicCacheKey` 15 MB.
- **Change:** (1) fewer node builds = smaller live heap: F1 (−1050 builds ≈ −0.55 GB on Max, measured), F6(b)
  (DOF-context duplicates), and dispose the render objects of one-shot contexts after use — the 382 reflection-capture
  builds (probes phase) and the per-room warm-up headings' shadow contexts that are never drawn again (≈ 0.2–0.3 GB);
  (2) interactables: raycast a per-item proxy (bounding box / the collider) instead of `intersectObject(it.object, true)`,
  or cap to 10 Hz — removes ≈ 15–20 MB/s; (3) story-runtime `step`/`draw` and the exposure meter: reuse scratch
  objects (≈ 7 MB/s); (4) after load, call nothing heavy; the target is < 15 MB/s allocation and < 0.8 GB live, which
  makes major GCs rare and their atomic pause < 150 ms.
- **Expected:** major-GC pauses 0.5–1.0 s → < 0.15 s and 3–5× rarer; frees 0.5–1 GB on 8 GB machines (less swap).
- **Visual risk:** none.

### F5 — Max/Medium: triangle and draw content (EXT2 vegetation, car row, glass)
- **Measured:** per pass at C1 60.5: bark_wet 32 draws / 490 k tris (the three hero dead trees 65 k / 27 k / 24 k +
  tree-line), grass_wet 173 k, grass_dead 169 k, tree-line shrubs 24–35 k each; parked sedans ~12 parts × 4 cars ×
  1–2 draws (rust / chrome / rubber / paint ≈ 22 draws each material); glass panes draw twice each (DoubleSide
  transparent = back + front pass): glass_grimy 35–44 draws.
- **Change:** (a) tree-lod.ts switches at 35 m only for P_TREE_1..3 — add the tree-line shrubs and ground-cover turf
  cells (same drawRange-prefix trick needs Blender-lane prefix ordering → request), and switch the hero trees to the
  prefix whenever the camera is indoors (seen through glass at ≥ 8 m); (b) merge each parked sedan into one mesh per
  material (or one `BatchedMesh` per car row) — static, lightmapped by the car-set probe; (c) window glass: `forceSinglePass = true` (keeps DoubleSide — the pane
  still reads from inside and outside — but draws once instead of back + front; NOT FrontSide, which would cull the
  pane from one side).
- **Expected:** C1 60.5 −40…−60 draws; −0.4…−0.8 M tris on Max (≈ −0.2…−0.4 M on Medium).
- **Visual risk:** (c) single-pass DoubleSide transparency can mis-order the two faces of one pane — invisible on a flat
  pane; (a) needs the Blender lane's prefix data.

### F6 — Load time: halve programs/builds, stop rebuilding the road in the DOF context
- **Measured (Max, probe-max, battery):** load 270.6 s; warm-up 206 s for 2145 builds (rc9 59 s / 559 builds, G1 29 s /
  207, EXT1 23 s / 376, CLOSET 20.5 s for 18 builds, rc9-road 13.5 s / 221, EXT2 13.6 s / 114); probes 25.5 s / 382
  builds; story 25.0 s / 496. Total 3177 builds over 20 render contexts → 974 render pipelines, 1480 programs (748
  vertex + 732 fragment). Builds by material: ShadowMaterial 741, GTAO 251, MeshBasicNodeMaterial 238, then
  cast_iron 103, glass_grimy 85, wood_raw_plank 83 … (222 materials). Medium (pfin-med): load 45 s, warm-up 17 s for
  1101 builds, 1028 programs.
- **Root causes:** (1) the Max pre-pass doubles builds/programs (F1); (2) the cutscene DOF chain draws the scene pass
  (and on Max the pre-pass) at another `renderer._callDepth` → another render context (RenderContexts key =
  attachments-MRT-callDepth, RenderContexts.js 41–67), so every road/car object is built again (warm rc9 = 559 builds;
  main.ts 765–786 warms them deliberately); (3) Max per-build latency is 5× Medium's (96 vs 15 ms per build) — cold
  Metal pipeline compiles, bigger Max shaders (more shadow samplers, flash lightmaps); CLOSET's 18 builds took 20 s
  = waiting on the parallel compile queue of the previous rooms.
- **Change:** (a) F1; (b) pin the scene pass / pre-pass render context: wrap `renderer._renderContexts.get` so the scene
  pass's render target always uses callDepth 1 (the two chains never nest the same target), or make the DOF node read
  the scene pass after TAAU has triggered it — then the DOF chain reuses the gameplay render objects (rc9 559 → ≈ 280
  builds, and no more DOF-context warm loop); (c) lazy per-room warm-up after the first frame: warm only CP1's rooms
  + the C0/C1 sets behind the loading screen, then the remaining rooms in idle slices during C0/C1 playback (C0 is 30 s
  of fixed camera — enough for ~1000 builds at Medium's rate); (d) measured cold vs warm Metal cache on Max: 270.6 s (probe-max, first Max session of the dist) vs **78.0 s**
  (x-max-ctl, near-identical WGSL already compiled by the two preceding sessions) — a 3.5× factor; the reviewer's
  173–268 s Max loads were all cold-ish (three lanes alternating dists evict each other's pipelines). Load-time
  claims must state cache state; the player's first visit is the cold case.
- **Expected:** Max programs 1480 → ≈ 1030, builds 3177 → ≈ 1900; warm-up 206 s → < 100 s cold; Medium warm-up
  17 → ≈ 12 s with (b); load-to-first-frame ≪ 15 s on Medium with (c).
- **Visual risk:** none ((c) risks first-sight hitches if a room is entered before its slice — gate on room adjacency).

## 2. Medium (probe-medium, dist-re-final; battery → fps pessimistic)

| view | total draws / tris | main pass | shadow pass | post | over budget by |
|---|---|---|---|---|---|
| C1 60.5 | 401 / 1.09 M | 355 / 1.07 M (EXT2 147 / 841 k, EXT1 125 / 162 k, interiors through windows 76) | headlamp L 31 / 25 k | 15 | 1 draw |
| C1 61.8 | 363 / 1.05 M | 348 / 1.05 M | — | 15 | — |
| u1-armoire | 534 / 1.37 M | 331 / 1.01 M (**EXT2 177 / 798 k**) | torch 188 / 360 k (**EXT2 45 / 204 k**, G1 34) | 15 | 134 draws |

Medium u1-armoire after F2 + F3: ≈ 534 − 177·0.85 − 45 ≈ 340 draws, ≈ 0.45 M tris (budget 400 / 1.5 M). C1 60.5 after F5
(car-row merge ≈ −40, glass single pass ≈ −17): ≈ 345.

## 3. The two "unexplained" items

**Item 2 — Max C0 stall 20.6–22.0 s (717 ms).** Not reproducible as a C0-time event:
- real-time C0 on the same dist (probe-max) was clean 18.5–24 s (0 frames > 50 ms, programs/RTs flat, no LoAF);
- stepped from 18.8 s with a GPU fence per frame (c0step-max): max CPU 18 ms, max GPU 11 ms, 0–2 builds/frame;
- the same SIGNATURE appears at other C0 times in other runs: probe-medium 10.0–12.6 s (19 frames 50–117 ms, the
  game's rAF tick taking 40–84 ms per LoAF, then one 567 ms frame), x-max-noao 8.8–9.3 s (400 ms frame, 399 ms of
  script in the tick), R27 Medium 10.0–10.9 s, pfin-max 20.6–22.0 s.
- **Cause, proven by trace (heap-med): a V8 major GC** — incremental marking from C0 9.93, a 524 ms `GCFinalizeMC`
  atomic pause at C0 11.12 (323 ms of it WeakMap/ephemeron marking) over a 1.29 GB LIVE heap. It lands wherever the old
  generation fills, so the C0 time differs run to run, and stepping (no real-time allocation) never triggers it.
  Fix = F4 (shrink the live heap by cutting node builds; cut the 42–54 MB/s of per-frame garbage).
- Max (heap-max2, same scenario): this C0 happened to stay below the GC trigger (only 81 ms of minor GC, 0 frames > 50
  ms) — the stall is probabilistic, as above. Live heap after a forced GC: **1804 MB** (+220 MB ArrayBuffer backing
  stores; 2074 MB before GC) vs Medium 1291 MB — the Max pre-pass's ≈ 1000 extra builds ≈ +0.5 GB live. Allocation at
  u1-armoire 340 MB / 6 s with the same top sites (getVertexPosition 75 MB, RenderObject `_update` 58 MB). With a 1.8 GB
  live heap the atomic pause is 0.7–1.0 s (x-max-ctl: 1019 ms with a 248 MB drop).

**Item 3 — Medium u1-armoire 39–60 fps.** The view is GPU-bound with no headroom (dynres pinned at its 0.6 floor;
GPU-done p50 39–51 ms vs CPU p50 9.6 ms in every rep; no extra renders, no new programs, LoAF ≤ 72 ms). The machine is
a **fanless MacBook Air (MacBookAir10,1)**: sustained GPU load from back-to-back headless sessions throttles it
passively — within one run the same view decays 50.5 → 38.8 → 33.0 fps (probe-max) at constant CPU. So the spread is
GPU-throughput variance on a saturated view, not GC/shader warm/reflection capture. Fix = make the view cheap (F2 + F3
remove ≈ 1.0 M of its 1.37 M tris and ≈ 200 of its 534 draws on Medium) and measure perf only on AC after ≥ 5 min idle,
as the first session of a queue slot.
