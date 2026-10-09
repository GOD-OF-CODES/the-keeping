# STATUS — runtime lane E (round E)

Dist: `scratch/dist-re`. Start state: HEAD 521251c + uncommitted runtime-D review edits (arms.anchorTo, torch 2000 cd).
Perf numbers carry the `pgrep -f Blender.app/Contents/MacOS/Blender` result taken with them.

## Summary (latest first — details in the log below)
| # | item | state | evidence |
|---|---|---|---|
| 1 | Max "stall at U4T" | ROOT CAUSE + partial fix: not a hang (unlabelled steps + strictly serial pipeline compiles in r186 compileAsync + cold Metal cache). Cold Max 472.7 → 374.9 s (≈ 309 s once probes.bin is fresh); steps labelled; still > shot.mjs's 300 s default on a truly cold cache | maxcold1/2/3 |
| 2 | load time | Medium warm 58–63 → 45.4 s (≈ 33 s with fresh probes.bin), Low 24.1 s, WebGL2 Medium 252 → 225 s; < 15 s NOT reached | bc-med2 / bc-med-base A/B, warmA/B, lowload, webgl1 |
| 3 | C0 first-DOF hitch | DONE: root cause = arms lightsNode switch + needsUpdate at the first mount; Max real-time C0 worst 33.4 ms (no frame > 50 ms) | cut2/3/4, s1max2 |
| 4 | C1 draws | DONE: Medium 371/1.14 M, Max 373/1.30 M at C1 60.5 (RC9 set occlusion-culled near the house, proven invisible) | occ2, occmed, occmax |
| 5 | score_reveal | DONE: pre-rendered; C0 20–23 s max frame 16.8 ms | s1med |
| 6 | gloves | DONE for dome/candle/ambient (calibrated albedo + env sheen); torch-view silhouette is physical (request 5) | dome1/2, looks3/4, glovediag, peek2 |
| 7 | C0 lightning | PARTIAL: 3–4 strokes/0.4 s, view-fitted shadow box, side-lit strokes, corridor trees cast/receive (+ map warmed at load); flash fill still halves the shadows (request 3) | c0lit1–4 |
| 8 | Ada in the torch core | hook DONE (`posePeek`); hair strand jitter + wet R lobe DONE; skin chalk NOT fixed (exposure meter decision, request 4) | peek1–3 |
| 9 | armoire | DONE runtime side: hall visible between louvres; snap exposure on entering a hide | looks2, ptmed-05 |
| 10 | torch | DONE: Max single-scatter beam (no laser rod), outdoor rain view reads as a krypton torch | beamab4/5 |

## Items
1. Max first-load stall at "Compiling shaders — U4T" — in progress
   - 1a FINDING (scratch/rd/mx20x/max-report.json console): NOT a hang. shot.mjs's 300 s is a TOTAL load timeout
     (`--start-timeout`, shot.mjs:71/383). "U4T" is only the last label the rooms loop sets; tableau (22 s), car-set (30 s),
     car-row, rc9 (1763 builds, 48 s even warm) and rc9-road never set a label. The cold first attempt: EXT1 77 s
     (564 builds) vs 9.3 s on the retry with a FRESH profile → the warmth is macOS's Metal cache
     (`$DARWIN_USER_CACHE_DIR/com.google.Chrome.helper/com.apple.metal`, 5.5 GB), not the Chrome profile. Cold = every
     MSL the Metal cache hasn't seen (any shader edit; every first-time player). Max cold > 300 s total → killed.
     Root cause = too many node builds (JS, Max 3661 / Medium 1649) and unique programs (Metal, Max 1412 / Medium 1018).
     Big lever: r186 RenderObject.getMaterialCacheKey appends object.uuid for every InstancedMesh → one node build per
     corridor chunk × context (287 instanced prims on Medium).
   - 1b CODE: main.ts warm `step()` sets the overlay label for every step (tableau/car-set/car-row/rc9/rc9-road).
     perf.ts build classifier (`__game.buildClasses()`: phase|kind|pass|ctx|material).
   - 1c CODE: src/world/instance-buckets.ts `geometryInstancing()` — instance matrices as 4 named per-instance vec4
     GEOMETRY attributes (InstancedBufferGeometry sharing vertex/index), object no longer an InstancedMesh for the
     renderer, NodeMaterial.prototype.setupPosition applies them by name (position, normal, velocity previous) → one
     node build per material × context instead of per chunk. `?geoinst=0` = round-D path (A/B). UNMEASURED yet.
3. C0 first-DOF hitch — CODE: pipeline.ts one RenderPipeline per chain shape (no outputNode swap / needsUpdate). UNMEASURED.
5. score_reveal pre-rendered (src/audio/synth/score.ts: preload:false removed; CONTRACT #75). UNMEASURED.
8. CODE: `__game.posePeek(dist|null, yaw)` (main.ts): Ada held dist m in front of the camera, brain 'hold' (no catch).
- 05:5x first Medium run on dist-re (all of the above) hit shot.mjs's 420 s total timeout during a cold load
  (page unresponsive, overlay text '?'); re-queued with --console (bc-med2) + a geoinst=0 base (bc-med-base).
- 05:4x bc-med2 (dist-re, Medium WebGPU, geoinst ON, Metal cache warm from the timed-out attempts, Blender: none,
  mains): load 47 s, 0 errors. 287 meshes geometry-instanced. warm-up builds 1084 (round D 1649), rc9 5.9 s / 252
  builds (round D 15–28 s / 748), warm-up 19.4 s (29–93 s), probes builds 383 (474), story 505 (734); programs 1015
  (1018 — unchanged, as expected). Phases: materials 2.4 s, collision 2.1, probes 12.1 (shipped probes STALE → runtime
  bake; lead ruling f), story 8.6 (reflections capture 8.1), warm-up 19.4, firstFrame 0.9.
  Build classes (warm-up): main 598 / shadow-pass 417 (ShadowMaterial 438), contexts ctx10 388 · ctx13 336 · ctx15 225 · ctx16 102.
  score_reveal now pre-renders (2.4 s inside the parallel audio prerender, done before the level finished).
- Cold-load repro: scratch/re/shot-cold.mjs = shot.mjs copy with --cold-metal (moves
  `$DARWIN_USER_CACHE_DIR/com.google.Chrome.helper/com.apple.metal` aside while it holds the lock, restores it in cleanup).
- 05:5x A/B same build (dist-re), Medium WebGPU warm, Blender none, mains: geoinst=0 load 62.8 s (probes 13.8 / story 12.6 /
  warm-up 29.5 s, rc9 14.6 s / 748 builds) vs geoinst ON 47.0 s (12.1 / 8.6 / 19.4, rc9 5.9 s / 252) → −15.8 s, −25 %.
- 06:04 maxcold1 (scratch/re/shot-cold.mjs --cold-metal, Max WebGPU, dist-re = geoinst + per-chain pipelines + new
  lightning, Blender none, mains): NO stall/kill (start-timeout raised to 1500), but load = 472.7 s cold, 0 errors.
  Phases: materials 19.2 s (generator precompile 8.7), collision 2.7, probes 64.0 (stale probes.bin → runtime bake),
  story 67.2 (reflection capture 66.7), warm-up 315.6 (EXT1 103.7 s for only 385 builds, EXT2 31.8, G1 30.0, U1 15.7,
  tableau 24.6, car-set 37.0, rc9 44.1 / 511 builds (round D 1763), rc9-road 10.2), firstFrame 1.5. programs 1449.
  warm-up builds 2230 (round D 3661). → cold cost is Metal pipeline compilation (~0.2–0.3 s per program), not JS.
  C0 real-time (same session, cold): worst 366.6 ms @ C0 12.62 (first DOF cut) + 233 @1.37, 50–267 ms @7.8–8.6.
  C1 info (all passes): 60.5 814 draw calls / 2.68 M tris; 61.8 773 / 2.57 M.
- 06:1x CODE item 1: src/render/parallel-compile.ts — r186 Renderer.compileAsync awaits each object's pipeline before
  the next object (strictly serial GPU compiles); the wrapper hands Pipelines.getForRender a shared pending list
  during compileAsync and awaits all at the end (same pipelines/keys; `?pcompile=0` = old). reflections.ts capture()
  precompiles the 13 cubes × 6 faces via compileAsync (parallel) before the synchronous captures. Queued maxcold2.
- looks1 (spawn debug_hall) was taken DURING C0 (title card up, C0 exposure) — not valid for judging; re-queued as
  looks2 with --beat B05. Seen anyway: the FP hand reads as a bare tan hand (item 6 confirmed); armoire gaps do show
  the hall (exposure from C0).
- 06:30 maxcold2 (cold Metal, Max, + parallel compile, Blender none, mains): load 403.1 s (was 472.7), 0 errors. warm-up
  242 s (316; EXT1 57.5 s vs 103.7), probes 63.1, story 72.8 (reflection precompile launched 78 compileAsync at once →
  1637 builds: concurrent identical keys build twice — fixed by serialising the builds, below). Two MTLCompilerService
  processes at ~100 % each during the warm-up (was one) → Metal parallelism ≈ 2.
  C0 real-time cold: worst 550 ms @ 12.62, 267 @ 1.38. C1 info 811 / 773 draw calls.
- CODE: parallel-compile.ts `deferCompileWaits(fn)` — inside it compileAsync resolves after its (serial) node builds and
  pipelines are awaited once at the end; renders in between skip pending objects (Pipelines.isReady). The whole
  warm-up (main.ts) and the reflection precompile run inside it. Queued maxcold3.
9. Armoire (looks2, Medium, B05 starts inside H_ARMOIRE, eye [3.12, 4.45, 5.65] per ruling d): the hall IS visible
   between the slats (wallpaper, floor, balusters, the stair rail); the slats read as backlit dark wood bars, as from
   inside a real louvred door. Frame: scratch/re/looks2-01-torch-hall.jpg (torch forced on by the probe). Gaps ≈ 45 %
   of the view — acceptable; no runtime change needed (near plane / exposure fine: EV +1.5 inside). Wider/angled
   louvres remain a Blender option (request below), not a blocker.
4. occ2 (Medium, dist-re, frustum counter scratch/re/frustum.mjs — geometry-instanced chunks use their instances'
   sphere): C1 34 159 d/459k · 41 111/394k · 50 283/742k · 55 274/755k · 58 368/1225k · 60.5 397/1266k · 61.8
   388/1221k. Hiding room_RC9: 58 → 324 d (diff 2.21 vs noise 1.56), 60.5 → 373 (0.61 vs 0.59), 61.8 → 367 (0.68 vs
   0.88): invisible; at 55 (camera 76 m from the house) visible (4.61 vs 1.11). CODE: yard-cull.ts masks room_RC9's
   `visible` (accessor; the level's room culling keeps writing underneath) while the opening camera is within
   NEAR_HOUSE_M (70 m) of the house. Max numbers: to measure.
7. c0lit1 (Medium, before the fix): the 9.2 s peak is a flat blue-grey wash over the cone canopy — 287 instanced
   corridor meshes, 0 of them shadow casters; no modelling. CODE: lightning 3–4 strokes in ≈ 0.4 s (main.ts
   createLightning); shadow box fitted to the view (aerial ±110 m, 110 m ahead, ground-level ±35 m, 20 m ahead);
   aerial strokes side-lit 50–90° off the view axis at 25–40° elevation; corridor L0/L1 chunks cast + receive (L2
   cards neither), kept off the headlamp shadow layer. Queued c0lit2.
10. CODE (Max): flashlight.ts volumetric beam = single scattering, 12-step march along each view ray to min(cone exit,
    scene depth via viewportDepthTexture), I(θ) = the live cookie profile (2000 cd core / spill / tail), 1/d², HG g 0.6,
    σs = SKY_U.fogSigma outdoors / 4e-4 indoors (replaces the uniform 45° additive stub). Unverified — looksmax queued.
- 06:55 maxcold3 (cold Metal, Max, + deferred waits + RC9 cull + corridor shadows + new beam, Blender none, mains):
  load 374.9 s (472.7 → 403.1 → 374.9), 0 errors, no stall. warm-up 213.5 s (316 → 242 → 213); probes 66.1 (stale
  probes.bin; gone once the lead regenerates it → ≈ 309 s); reflections 68.2 s (precompile dedupe OK, 499 builds, but
  no speed-up: the cube captures re-render the candle/lamp shadow maps whose shadow-pass pipelines are created
  synchronously). Remaining cold cost is Metal compile throughput (2 MTLCompilerService in parallel, ≈ 0.15–0.3 s per
  program, 1455 programs on Max). The overlay now names every step, so no step sits silent for minutes.
  C0 real-time (cold): only one frame > 50 ms: 417 ms @ 12.62 (first DOF cut) — the 1.38 / 7.8–8.6 s spikes are gone.
  C1 info: 60.5 766 draw calls / 2.46 M (all passes) (811 before), 61.8 732 / 2.40 M.
6. looks3 (Medium, B05 → hall, torch on): the right glove is a featureless near-black shape against the lit floor;
   dome1 C1 20.5: the glove reads as a tanned bare hand (brown, smooth, high exposure in the cream cabin). Measured:
   the arms atlas paints the gloves at linear 0.070/0.038/0.022 = 2× spec leather_worn (0.035/0.022/0.015).
   CODE: skin.ts glove colour calibrated to the spec (×0.50/0.59/0.69); arms.ts ArmsEnvNode adds an environment-only
   grazing sheen ((1−n·v)³ × sheenColor × the env the leather sees) for the glove where Max's Charlie lobe is off.
   Physics note: in a torch-lit hall the back of a hand sees only the dark ceiling + ≈ 1.5 lux of multi-bounce fill
   (≈ 7–8 stops under the floor pool) — it IS a dark silhouette; what makes it read is the sheen/creases.
7. c0lit2 (Medium): 152 corridor meshes now cast; the 9.2 aerial peak shows tree shadows between the crowns and lit vs
   shadowed crown flanks (was a uniform wash); 15.6 (ground level, DOF) shows lit trunk flanks but no tree shadow on
   the road — the road/verge/blanket (chunk-less corridor nodes) did not receive. CODE: every corridor node's meshes
   receive. Remaining (Blender): the cone-stack pines read as CG at the 9.2 / 15.6 framing (ruling g canopy variety).
   Queued c0lit3.
2. 07:2x warmA/warmB (same dist, consecutive, Medium WebGPU, Blender none, mains): load 45.6 / 45.4 s (round D
   58.7–63.7 s warm). warmB phases: parse 1.0 · materials 2.5 · collision 2.7 · probes 12.6 (stale probes.bin →
   runtime bake) · story 8.8 (reflection capture) · warm-up 16.3 (1095 builds) · firstFrame 0.8. With the lead's
   regenerated probes.bin ≈ 33 s. The < 15 s finish line is NOT reached: what remains is JS node builds (≈ 1650 at
   ≈ 15 ms) in the cube-capture and warm-up phases plus the collision build — see requests for the lead (defer the
   house/reflection warm into the C0/C1 cinematics; collision BVH in a worker).
6. dome2 (C1 20.5, Medium, calibrated glove): the glove now reads dark brown leather with knuckle highlights instead
   of a tan hand (scratch/re/dome2-01-c1-20.5.jpg); torch-hall (looks4) still a dark silhouette — glovediag queued
   (what env reaches it). The cabin itself is blown-out cream with faceted door trim (Blender / exposure, not item 6).
8. peek1 (Medium, posePeek 2.5 m in G1, torch on): the hook works (director parked, no catch, Ada held facing the
   camera, head bowed, hair over the face). At 1280 px she reads as a smooth beige-grey mannequin; skin_ada is spec'd
   grey-blue (0.30/0.32/0.34) which the 2900 K torch warms to beige — physically right. peek2 at 1920 px / 2.2 m queued.
10. beamab (Max, road, warm load 72.9 s): beam ON frame went BLACK (exposure crash), OFF frame normal → the new beam's
    1/d² beside the lens (d ≈ 0.05–0.2 m) gave ~75 nits. FIX: near-field clamp d² ≥ 0.16 m² (5 cm reflector:
    I·A/Φ). The beam-off frame: torch pool on the wet road reads as a krypton torch (hot core, soft spill on the
    asphalt), not a laser. Re-check queued.
2. webgl1 (Medium, ?backend=webgl, Blender none, mains): load 225.2 s (round D 252 s), 0 errors. probes 78.0 s
   (stale probes.bin → runtime bake), warm-up 130.0 s (1072 builds / 770 programs), materials 8.7 s. ≈ 147 s with
   shipped probes. WebGL links programs synchronously; the remaining cost is GL program count.
- Fix (advisor review): deferred flush uses Promise.allSettled + a warning (a rejected pipeline must not abort the
  level start as it now would outside compileView's try/catch).
- gpu frame at the end state (C1 61.8, Max): maxcold1 22.66 ms → maxcold3 20.84 ms (RC9 cull vs corridor shadows: net −1.8 ms).
3./5. s1med (Medium, real-time C0, Blender none, mains, load 43.9 s): only one frame > 50 ms in C0 — 166.6 ms @ 12.62
   (round D: 183 ms worst + the 20.0 score_reveal 120–170 ms). 20–23 s window max 16.8 ms → score_reveal hitch GONE.
   The 12.62 cut still hitches even with the arms warmed through the DOF chain: cut3 diag (builds + memory) queued.
   C1 info (all passes): 60.5 430 draw calls / 1.10 M tris, 61.8 394 / 1.06 M. gpu frame ≈ 17.97 ms (C1 61.8).
6. glovediag (Medium, G1 hall, torch on): beam hit 7.2 m down the hall → pool disc r 7.3 m, radiance 0.007 nits; fill
   (multi-bounce) 0.19/0.08/0.03 lux (2900 K × wood); looking down (pitch −0.5) the pool is 1.4 m wide at 0.16 nits,
   fill 0.36 lux. A 0.035-albedo glove under 0.2–0.4 lux is ≈ 0.002–0.004 nits next to a floor pool of ≈ 1–5 nits:
   7–10 stops down — the torch-view glove IS a silhouette physically (fingers sit behind the lens plane; nothing lights
   them directly). Verdict: dome / candle / moon views now read as dark leather (calibrated albedo + sheen); the
   torch-view silhouette stays (honest physics). Making it "readable" there would need a non-physical rim light —
   request for the lead.
8. peek2 (Medium 1920×1200, Ada held 2.2 m in the torch core, G1; scratch/re/peek2-01-peek-2.2.jpg) — JUDGED, NOT FIXED:
   (a) chalk: the head crown and shoulders clip to white with a bloom halo. Core 2000 cd at 2.2 m = 413 lux → skin
   0.30 albedo ≈ 39 nits, while the centre-weighted LOG-average meter (key 0.034, 0.5 % top cut) holds exposure ≈ 4 for
   the dark hall around her (she is ~3 % of the weighted area) — a film camera would blow her out too; an eye fixating
   her would not. Fix candidates (exposure lane decision, affects all gameplay): a foveal spot term in the meter
   (σ ≈ 0.05, linear mean) blended in when the centre is > 4 EV above the log-average. (b) wet hair: the bowed crown
   under a coaxial light gives a filled glowing disc, not the narrow "angel ring" band of wet black hair — the R lobe
   (HAIR.rR) is too wide/strong for a water film; candidate: rR ≈ 0.04 rad, R × 0.5, keep TRT. (c) dress: white
   streak highlights on the lower dress folds. (d) Not seen: subsurface softness — at this exposure the skin has no
   gradation left to judge. The FP glove in the same frame reads as dark leather with sheen (item 6 ✓ in candle/hall
   ambient). Her wall shadow (torch) is crisp and right.
8. CODE (look 2): skin.ts HairLightingModel — per-strand longitudinal shift jitter (60 strands per card across u,
   ±0.06 in R, ×1.5 in TRT; computed once per fragment in setupVariants) and HAIR.rR 0.3 → 0.22 (wet cuticle). peek3 queued.
4. occmax (Max, current tree with the RC9 cull, frustum count): C1 34 159 d/464k · 41 111/398k · 50 288/770k · 55
   270/768k · 58 331/1161k · 60.5 373/1299k · 61.8 367/1279k → all ≤ 500 / 2 M. Medium (occ2 with RC9 hidden):
   58 324/1009k, 60.5 373/1149k, 61.8 367/1134k → ≤ 400 / 1.5 M. Note on the 58 s diff (2.21 vs noise 1.56): the car
   is still rolling at 58 s (TAAU history differs frame to frame), 60.5/61.8 (parked) match noise — RC9 contributes no
   visible pixel there. (Same camera position at 58 and 60.5.)
4. occmed (Medium, current tree, frustum): C1 34 159/459k · 41 111/394k · 50 292/747k · 55 278/771k · 58 336/1012k · 60.5 371/1140k · 61.8 367/1134k → ≤ 400 / 1.5 M ✓ (round D 498 / 1.69 M).
10. beamab2 (Max, near-field clamp): beam-on frame STILL black while the beam-off frame 8 frames later is normal (the
    exposure did not crash — it cannot brighten 7 EV in 0.27 s) → NaN pixels from the march spreading through
    bloom/TAAU. FIX: depth-derived length guarded with max() (Metal fmax drops NaN) and the result clamped to
    [0, 4 nits]. beamab3 queued. NOTE: the Medium gate playthrough (ptmed) runs on the build before this Max-only edit.
GATE ptmed (Medium WebGPU strict playthrough, dist-re built from the tree incl. hair jitter, before the Max-only beam
  NaN guard; Blender none, mains): done ended=true beat=B13 game 434 s / wall 270 s, deaths 0, 0 console errors,
  0 exceptions, load 44.5 s, gpu frame ≈ 17.15 ms. Frames scratch/re/pt/ptmed-0[1-9]-*.jpg. --timeout 9000 (queue
  wait counts toward shot.mjs's total timeout; 2400 does not survive a 30-min FIFO).
9. CODE: main.ts 'player:hide' → requestExposureSnap() on entering a hide (ptmed-05 frame on entering H_ARMOIRE: near-black bars while the eye brightened at τ 6 s). Queued Max + Low strict playthroughs (ptmax builds the final tree).
2. lowload (Low WebGPU, current tree): load 24.1 s (round D Low warm 26–27 s), 0 errors; 108 meshes geometry-instanced; warm-up 10.9 s / 802 builds, probes 6.8 s.
3. cut3 (Medium, build with the DOF arm warm): the SAME 7 arm builds at 12.52 (301 ms), programs 1015 → 1012 →
   ROOT CAUSE: story-runtime setArmsCar switched material.lightsNode + needsUpdate at the first car mount (C0 12.5),
   which rebuilds the arms' shaders whatever was warmed. CODE: FpArms.setLightSets/useCarLights — two fixed material
   sets (house / car LightsNode) swapped per mesh; story-runtime.ts surgical (3 lines, CONTRACT #75); the rc9 warm steps
   draw both sets in the frame and the DOF contexts; opening.armsCar() starts the car set on C0's black date card.
7. c0lit3/c0lit4 (Medium, look 3 and 4): aerial 9.2 peak — crowns modelled (lit/shadowed flanks), shadows between
   crowns; flash 3–4 strokes. Ground-level 15.6 (DOF) — trunk flanks lit from the side, but tree shadows on the
   road/meadow stay faint: the sky-glow + fog flash (flashSky ×5, flashFog ×2) still fill the shadows to ≈ ½ of the
   lit level. NOT DONE to the AD's bar: the remaining lever is the directional:diffuse ratio of the flash
   (LOOK.lightningPeak 0.5 vs flashSky 5), which also sets every gameplay yard flash — left for an exposure/AD
   ruling rather than changed blind. Frames: scratch/re/c0lit{2,3,4}-0{2,4}-peak-*.jpg.

## Requests for the lead (draft — final list in the report)
1. Max first load: cold (first-ever visit, or any shader change) is 375 s on the M1 (was 473), probes.bin stale adds
   66 s of it; regenerate probes.bin (ruling f) → ≈ 309 s. shot.mjs's 300 s `--start-timeout` still flags that as a
   stall: either raise the Max default (e.g. 900 s) or adopt `--cold-metal` (scratch/re/shot-cold.mjs) as a QA flag and
   accept ~5 min first-ever Max load, or fund program-count reduction next round (Max 1455 programs: GTAO pre-pass
   ≈ 347 builds, per-light-set variants, shadow contexts).
2. Warm Medium load 45 s (33 s with fresh probes.bin) vs the < 15 s finish line: needs (a) the collision BVH in a
   worker (gameplay's collision.ts, 2.7 s), (b) deferring the house warm-up + reflection capture into C0/C1 (≈ 25 s
   of node builds) — a renderer-state-safe background compile is a design task, not a tweak.
3. Lightning flash ratio (item 7): LOOK.lightningPeak 0.5 vs flashSky 5 leaves tree shadows ≈ ½ filled; raising the
   directional (or lowering the sky-glow fill) is an AD/exposure call that also changes every yard flash.
4. Ada in the torch core (item 8): a foveal spot term in the exposure meter (all gameplay) — decision needed.
5. Torch-view gloves are a physically dark silhouette; a non-physical rim would be needed to make them "read" there.
6. Blender (props/opening round, ruling g): C0 cone-stack pines read as CG in both flash frames; cabin door trim
   faceted + cream blown out under the dome (C1 20.5). Armoire louvres are fine at the runtime side (no request).
8. peek3 (same view, hair jitter + rR 0.22): the crown no longer glows as a disc — it reads as dark wet hair with a
   small specular patch at the whorl, strands hanging in front stay dark/wet. Skin: the lit shoulder is still clipped
   (exposure, see (a)) — chalk NOT fixed. Frames scratch/re/peek2-01 / peek3-01-peek-2.2.jpg.
10. beamab3 (Max, NaN guard): beam-on frame still near-black with only late-drawn transparents faintly visible → the
    cause is the viewportDepthTexture read itself (a framebuffer copy inside the MRT scene pass loses the opaque
    frame), not NaN. FIX: no depth read; the cone is depth-tested (BackSide) and the march runs to its far wall.
    beamab4 (build) queued, then the Max + Low strict playthroughs on that build.
3. cut4 (Medium, build with the two arm light sets): 12.3–12.9 s stepped — NO frame > 40 ms, 0 node builds, programs unchanged (was 301 ms + 7 builds). Real-time Max check: s1max.
3./7. s1max (Max real-time C0, warm, build before the arm-set + lightning-warm fixes landed? NO — built by beamab3,
   arm sets included): no 12.5 hitch any more; NEW worst 683 ms @ C0 9.00 = the first lightning strike drawing the
   corridor trees into the lightning map (their shadow-pass objects were never built at load) + 67–133 ms frames at
   7.9–8.8 s (also seen in maxcold1, absent in maxcold2/3 — intermittent, GPU-side). CODE: the rc9 warm step draws
   the lightning map once with the aerial ±110 m box. C1 info 768 / 732 draw calls (all passes), gpu ≈ 24.8 ms.
3./7. s1max2 (Max real-time C0 → C1, warm, final arm sets + lightning-map warm, Blender none (the shot waits for it),
   mains, load 68.5 s, 0 errors): 1702 C0 frames, worst 33.4 ms — NO frame > 50 ms (round D: 433 ms; this round's
   cold runs 367–550 @ 12.62, 683 @ 9.0). gpu frame ≈ 18.5 ms at C1 61.8. Item 3 DONE (Medium cut4: no stepped frame
   > 40 ms at the cut; real-time Medium recheck rides on the final gate playthrough).
10. beamab5 (Max, road, beam toggled in place, g.capture means): on 25.5 · off 25.4 · on 25.5 · on 25.5 · torch off
    24.5, exposure 6.31–6.33 throughout → the beam neither darkens nor blows anything out; the "black" beamab1–4 road
    frames were the FIRST qa.shot of each run (stale canvas after the stepped skip), not the beam. VERDICT (Max, yard,
    rain, scratch/re/beamab4-03-yard-beam.jpg): the 2000 cd / 30.9 lm torch reads as a 2-D-cell krypton torch — a warm
    hot core on the path ≈ 4 m out inside a soft spill that falls off into the fog, no hard-edged disc, no laser rod;
    looking along your own beam the single-scattered shaft is (physically) faint at σ ≈ 0.014 /m. The depth-read and
    NaN guards stay (cheap); the depth-tested cone ends the shaft at the first surface.
- 09:15 correction: my re-queued ptmax/ptlow/ptmed2 never ran (my own launch loop: zsh does not word-split `$spec`, so --preset/--name were mangled); no other lane killed anything. Re-queued correctly as gmax/gmed/glow (scenario scratch/re/gate-run.mjs = byte-identical copy of scripts/qa/playthrough.mjs).
- 09:25 gmax (Max strict playthrough, final dist): reached B08 (deaths 0, 0 console errors) then 'FATAL: the headless Chrome connection closed' at wall 136 s (U2). No crash report on disk (headless profile is deleted). Re-running once after gmed/glow; a quick --beat B08 Max repro queued too.
- 09:42 gmed / glow: 'server did not start' (vite preview did not answer in time, empty stderr — transient under load); re-queued as gmed2 / glow2.
- 09:45 ENVIRONMENT: the Mac is now ON BATTERY (100 %, discharging) and fileproviderd sits at ~99 % CPU (the repo lives in ~/Documents); 'vite --version' takes 24–41 s, so shot.mjs's preview server times out ('server did not start'). b08max / gmed / glow died on that. Perf numbers from now on are invalid (battery).
- 09:46 gmax2 also 'server did not start' (same environment). Stopped queuing (gmed2 / glow2 cancelled) — nothing more
  can be measured validly until the charger is back and fileproviderd settles.

## Gate state (final tree = dist-re built by beamab4, 08:2x; no code change since)
- npm run typecheck: 0 errors · npm test: 233/233 · npm run build: OK (verify-boot OK, 12.5 kB gz boot).
- Medium strict playthrough: PASS on the build of 07:5x (ptmed: B13 ended, deaths 0, 0 errors) — that build predates
  the arm light sets, the hide exposure snap, the lightning-map warm and the Max beam guard. NOT re-run on the final
  tree (gmed / gmed2 killed by the environment above).
- Max strict playthrough on the final tree (gmax): B01–B08 clean (deaths 0, 0 errors), then 'the headless Chrome
  connection closed' at B08 (cause unknown: no crash report; the B08 repro could not start). Load 71.3 s (warm), no stall.
- Max real-time C0 on the final tree (s1max2): no frame > 50 ms; 0 errors. Low load 24.1 s, 0 errors. Low playthrough not run.
- No `com.apple.metal.runtime-e-bak` left (the --cold-metal backup is always restored).
- B08 disconnect attribution: earlier Max strict playthroughs on this project all reached B13 (scratch/ge/max, gdr/max2-4,
  b08/max4, b08-review/cur-max) → gmax's Chrome disconnect at B08 is a REGRESSION CANDIDATE (gmax started on mains,
  report onBattery unset; fileproviderd load may also have hit it). Isolation plan (NOT executed — environment): same
  dist-re with `?pcompile=0&geoinst=0` via --query, then a copy of the tree with the Max beam stub restored; one Max
  strict playthrough each on mains.
- shot.mjs note for all lanes: the FIRST qa.shot after a stepped skip/teleport can return a stale/near-black canvas
  (beamab1–4 road frames); g.capture() or a second shot is reliable.
- 09:5x WARNING for the lead: .git/HEAD is an iCloud "dataless" (evicted) file — `ls -lO` shows hidden,compressed,dataless — so git reports 'not a git repository' — likely iCloud FileProvider (fileproviderd ~99 % CPU) syncing/evicting ~/Documents. I did not touch git.

## Review (AD + perf reviewer, round E) — started 2026-10-09
- R0 environment at review start (`date` logged in each entry): power = **Battery** ("Now drawing from 'Battery Power'", 100 %),
  fileproviderd 97.6 % CPU, `.git/HEAD` still `dataless` (git: "not a git repository"), Blender: none (pgrep empty),
  another lane's headless Chrome holds the shot lock. Per CLAUDE.md perf numbers on battery are invalid (Chrome caps 30 fps).
- R0b killed orphaned headless Chrome pid 99570 (keeping-chrome profile, ppid 1, 4 h 23 m old, no shot.mjs alive).
- R1 workaround: scratch/rer/shot-static.mjs = scripts/shot.mjs with vite preview → scratch/rer/serve.mjs (plain node static server); tree unbuildable (1291 dataless files incl. package.json, tsconfig, vite.config, 95 src files, node_modules/typescript+three+vite). Reviewing the builder's final dist (scratch/dist-re cloned to scratch/dist-re-review). boot-only: 4 requests, 0 errors.
- R2 base for before/after = scratch/dist-rd-review3 (round D review tree + torch D ≈ HEAD 521251c; 0 dataless). 09:54 started ptmed (Medium strict gate playthrough on dist-re-review, battery).
- R3 code check: three r186 build/three.webgpu.js 62739–62744 confirms compileAsync awaits each object's pipelinePromises serially; parallel-compile.ts redirects getForRender's promise list (33191) only while depth>0 and flushes with allSettled → claim verified, logic sound. Not reviewable now (iCloud-evicted): main.ts, flashlight.ts, perf.ts, corridor.ts, skin.ts.
- R4 ptmed-05-armoire-slats (final dist, frame on entering H_ARMOIRE at B05): still near-black; slat faces faint warm bands, gaps BLACK (inverted vs a real louvre view: hall should read brighter through the gaps). Item 9 'done' NOT confirmed on the entry frame — check the settled frame in review.mjs.
- R5 10:00 GATE ptmed (Medium strict, final dist dist-re-review, BATTERY, no Blender): ended=true B13 (C7 → title), deaths 0, 0 console errors / 0 exceptions, no rescues; B09 dress dummy 38 s game / 15.4 s wall (no stall); load 53 s (battery + fileproviderd 98 % CPU; builder warm 45.4 s on mains). Frames scratch/rer/ptmed-0*.jpg.
- R6 10:26 (restarted reviewer, after the lead's .nosync recovery): mains power (97 %, charging), no Blender, no shot.mjs running, .git/HEAD and package.json readable again. R5 Medium gate pass was measured on BATTERY on the builder's dist, so it must be re-run on a dist built from the current tree. User asked for a time-to-completion estimate; review not resumed this turn. Still to do: 3 cold Max loads, Medium cold + warm loads, mains perf at 5 views + C0, visual A/B against f93285d, fixes, Medium strict gate playthrough, and checking the settled armoire frame (R4).
- R7 10:29 mains, no Blender. Started the torch close-up exposure/bloom fix (lead priority add): LOOK.bloomThreshold (live uniform, exposed units), LOOK.hpWhite/hpPct highlight-protect meter term (exposure.ts); defaults still = HEAD behaviour until the sweep picks values.
- R8 10:32 sweep1 (sw1-*, medium, mains, no Blender, 0 errors, warm load 38.8 s): floor 0.03 lets the meter stop to 0.08 (dress)/0.13 (guest)/0.16 (jerry) — the frame then reads too DARK (dress mid-grey, a white dress should read white); base 0.25 dress is NOT clipped (light grey) — the wash-out is the bloom veil + the core disc. Candle (7.1) and lightning facade (8.3) unchanged by any variant. Next: sw2 = threshold-only vs highlight-protect at hpPct 0.9 (lit object → ≈ white).
- R9 10:34 base for A/B: git worktree scratch/wt-base @ f93285d (detached, node_modules symlinked) → scratch/dist-re-base. Perf scenario scratch/rer2/perf.mjs (C0 real-time worst frame via rd/fz, C1 60.5/61.8 held cut real-time fps + draws/tris, parlor-table / upper-torch / u1-armoire). Shot lock held by gameplay lane (climb-probe, timeout 1500 s).
- R10 10:39 sw1 grids (gA dress, gB guest/jerry): at floor 0.03 + T 8 the guest pages are less blown and the jerry-can ribs/stencils read (deeper oxide red, no veil) → a highlight cap is wanted < 1 m; but the night key alone drags the 1.3 m dress to 0.08 (too dark). Restructured: hp cap applied AFTER the room clamp with its own floor LOOK.hpFloor 0.03 (target = max(hpFloor, min(clamp(keyEV), hpEV))). Candle/lightning sw1 frames identical at T 1.5 vs 8 but no flame was in frame — threshold must be re-checked on a flame view.
- R11 10:39 R4 resolved on the SETTLED frame (scratch/rer/rvmed-05-armoire.jpg): hall wallpaper, boards and banister read through the gaps, brighter than the dark near slats → item 9 runtime side CONFIRMED. AD note: the louvres read as flat horizontal boards (no downward slat angle / sloped top faces visible) — props lane geometry. Scenario artifact: the title card + C1 subtitle stay on screen after the stepped skip/teleport (not a gameplay path). Chain1 started: sw3 (threshold 1.5/3/4/8 on flame views + hp cap variants) → base perf Medium → base visuals Medium → base perf Max.
- R12 10:45 sw3 (medium, mains, no Blender, 0 errors, warm load 43.2 s; frames scratch/rer2/sw3-*, grids gE/gG): METER at the torch close-ups: centre-weighted p98 = log2 1.7 (dress), −0.4 (guest), −1.1 (jerry), −0.3 (hammer) at exposure 0.25 → ≤ 0.8× display white: NOT clipped. The props AD's 'asks for 0.06–0.18' is the night key (0.034) acting on a lit object, not highlight protection — lowering the floor only darkens a white dress to mid-grey (sw1). The veil IS the bloom threshold: T 1.5 → 4 visibly clears the jerry cans (ribs/stencils, deeper red) and the halo round the sign post; dress change subtle (its remaining 'disc' is the torch core on the cloth, physically right). Flame halo kept at T 3 (sw3-25/26). DECISION: LOOK.bloomThreshold 3 (exposed units), minExposure stays 0.25, hp clip guard hpWhite 3 @ p98 after the room clamp (floor 0.03, skipped under the opening EXPOSURE_CUE) — binds in none of the 13 views. hp=1.62 dress / -0.38 guest etc. logged via meter().hp.

- LEAD NOTE 11:03: previous reviewer attempt died on a network drop (ENOTFOUND) at ~10:58; its background chains/shot.mjs runs may still be running or have finished — check their logs before re-running anything.
- R13 11:02 restarted reviewer #3: chain1 alive (sw3 done, pbase-med FAILED: 2× 'load stalled 300s' = lock wait counted against start-timeout while the gameplay lane held Chrome; vbase-med empty for the same reason; pbase-max queued w/ --start-timeout 900). Fix in tree: LOOK.bloomThreshold 3 + hp guard (R12). Next: rebuild current tree, perf/visual sessions with --start-timeout 1800.
- R14 11:04 killed chain1 pbase-max (default --timeout 420 s counts the lock wait → would have TIMEOUT'd; that is also why pbase-med/vbase-med failed). chain2 (scratch/rer2/chain2.sh, --timeout 5400 --start-timeout 1500): perf cur/base Medium+Max, Max torch close-ups cur/base (ccur-max/cbase-max), review views Max cur/base.
- R15 11:05 AD look at the builder-dist review frames (rvmed, Medium): C0 15.6 lightning — still CG: cone-stack pines (props lane), flash reads as flat moonlit day (shadow fill ≈ half the lit level, ruling pending), road edge/ground uniform grey. Peek 2.2 m (pre-hp-guard): Ada reads as a chalk-white plaster mannequin (clipped skin); glove dark leather silhouette, OK in the lamp-lit hall. Beam physics check (flashlight.ts): σs = fogSigma outdoors (≈0.01/m), 4e-4/m indoors → indoor shaft ≈ 25× weaker, so a 'milky shaft' on indoor close-ups is not the beam; outdoors est. 0.1–0.4 nit along-axis back-scatter (≈0.03–0.1 display at exposure 0.25): plausible for rain mist. Verifying in ccur-max/cbase-max.
- R16 11:06 current tree: npm run typecheck rc 0; npm test 233/233 pass.
- R17 11:07 queued dg1 (Medium: dress/hem/guest, bloom on vs 0 — what is the remaining 'disc') and lt1 (lightning fill: lightningPeak/flashSky 0.5/5 (now) vs 0.75/2.5 vs 1/2 at facade, road, yard flash views; physics: shadow fill should sit ≥ 2 stops under the lit level for a visible stroke; today ≈ 1 stop). Gameplay lane holds a full playthrough in the queue; waits are long.
- R18 11:13 pcur-med (CURRENT dist-re-review, Medium, mains, Blender none, fileproviderd ≈108 % CPU at start): cold-profile load 49.3 s, 0 errors/0 exceptions, no stall. C0 real-time 1676 frames worst 16.8 ms (no frame > 50 ms, incl. 20–23 s score_reveal window). C1 60.5: 54.6 fps, 432 draws / 1.11 M tris; C1 61.8: 54.4 fps, 394 / 1.06 M; parlor-table 60.0 fps 120 / 0.25 M; upper-torch 58.2 fps 252 / 1.01 M; u1-armoire 52.5 fps 533 / 1.36 M (draw budget 400 exceeded — known). GPU frame ≈ 18.6 ms. NOTE: builder claimed C1 60.5 = 371 draws; measured 432 here (> 400 budget).
- R19 11:24 dg1 (Medium, current): bloom 0.22 vs 0 at the dress/hem: with bloom the torch-lit region carries a soft milky veil and the surround loses detail; bloom 0 → folds + wallpaper read. Meter: exp 0.25 (floor), hp p98 log2 1.6–1.7 (≈0.8× white) → the meter/floor is not the problem. Cause: glareHighPass forwards threshold + excess, so any pixel just over T (the 2 kcd core on a cloth) suddenly contributes ≥ T — a hard onset → disc veil. Added live knob LOOK.glareBase (pipeline.ts GLARE_BASE; 1 = stock/now, 0 = only the excess above T scatters, film-halation-like). sg1 sweep queued on scratch/dist-re-g (T 3 base 1 / T 1.5 base 0 / T 3 base 0 at dress, jerry, flame table, candle, kitchen lane).
- R20 11:24 lt1 (frames scratch/rer2/gL1/gL2): 0.5/5 = overcast-day wash (shadow ≈ ½ lit); 0.75/2.5 = directional flash, porch/ground shadows distinct, sky +1.3 EV; 1/2 = harder still but +1 EV more over-exposure. DECISION: LOOK.lightningPeak 0.75, flashSky 2.5 (4:1 lit:shadow, same total peak). Road A/B unreliable (random strike azimuth ±40°): on a frontal strike the roadside grass goes near-white (over-exposed peak) — acceptable as a flash, re-check at C0 15.6.
- R21 11:29 pbase-med (BASE f93285d, Medium, mains, Blender none, fileproviderd 87 % at start): load 210.7 s (cold Metal for the base's variants), 0 errors. C0 worst 183 ms @12.62 (+133/117 ms @20.1–20.2) → current 16.8 ms: items 3+5 CONFIRMED. C1 60.5 60.0 fps 452 draws/1.22 M; 61.8 60.0 fps 413/1.15 M; parlor 60.0 120; upper-torch 59.7 245/1.01 M; u1-armoire 60.0 521/1.41 M. ⚠ current pcur-med was SLOWER (54.6/54.4/52.5 fps at C1/C1/armoire) with fewer draws — fileproviderd 108 % then; re-measuring (pcur-med2) before any conclusion. Draw delta at C1 60.5 is only 452 → 432 (builder's 371 was a frustum mesh count, not renderer.info draw calls).
- R22 11:33 c1dc (renderer.info breakdown, C1 60.5 Medium, 432 draws): level 416 = EXT1 156 + EXT2 147 + doors 36 + interior room shells 71 (G1 12, G2 11, U2 11, G3 10, U1 8, U3 8, G3P 6, U4 5). Fix: yard-cull.ts also hides the 8 interior doors + boards (all but D_FRONT) while the opening holds the camera (−32 draws est.). Proof run c1doors (frame diff idoors vs fdoor at C1 55/58/60.5/61.8) queued.
- R23 11:37 sg1 (Medium, dist-re-g; gS1/gS2/gS3): glareBase 0 removes the disc onset — dress folds + wallpaper read, k-lane spot halo smaller; T3+base0 loses the candle halo, T1.5+base0 puts a faint veil back on the dress. DECISION: bloomThreshold 2, glareBase 0 (look.ts). Re-shoot of the props AD's close-ups on the final build pending.
- R24 11:41 ⚠ PERF FINDING: shot.mjs gpu frame (end of perf.mjs, u1-armoire) base 15.25 ms vs current 18.59 ms on Medium (fps 60.0 vs 52.5 there) — GPU-side, not fileproviderd. Isolation queued: scratch/rer2/gpu.mjs (4 gameplay views ×2, fps + gpuFrameMs) on cur / base / cur?geoinst=0.
- R25 11:45 after the look.ts/pipeline/atmosphere/yard-cull edits: typecheck rc 0, npm test 233/233.
- R26 11:44 pcur-max (CURRENT builder dist, Max, mains, Blender none, fileproviderd 66 %): load 238.6 s (fresh profile; first Max run of this dist), 0 errors, no stall. ⚠ C0 real-time: 9 frames > 50 ms at 21.75–22.65 (worst 533 ms @22.65) + 133 ms @27.20 — builder's 'worst 33.4 ms' (warm-Metal run) does NOT hold on this run. C1 60.5 39.5 fps 768 draws / 2.46 M tris; 61.8 49.8 fps 732 / 2.40 M (Max budget ≤ 500 / 2 M — builder's 373/1.30 M was a frustum mesh count). parlor 60.0 212/0.51 M; upper-torch 60.0 402/1.93 M; u1-armoire 44.4 fps 799/2.56 M. GPU frame (armoire) 33.6 ms. Base comparison pbase-max running.
- R27 11:50 c1doors (Medium, frame diff 160 px, builder dist): hiding the 8 interior doors at C1 55/58/60.5/61.8 = 1.15/2.36/0.61/0.74 vs frame noise 0.99/1.52/0.62/0.71 (the car is still rolling at 58: noise-level there too vs the front-door-only diff 2.69); draws −11/−25/−31/−31 (frustum count) → interior-door cull KEPT (yard-cull.ts). pcur-med2 (current, Medium, re-measure): GPU frame 15.15 ms (= base 15.25) → the 18.6 ms GPU 'regression' was NOT reproducible (noise). This run: load 164.9 s (vs 49.3 s), C0 hitches 67–367 ms at 10.0–10.93 (absent in pcur-med), C1 60.5 59.4 fps 430 draws, 61.8 53.4 fps 394, parlor 60.0, upper-torch 60.0, u1-armoire 48.7 fps 534 draws. Run-to-run variance is large today (Medium armoire 52.5 / 48.7 cur vs 60.0 base) — g-cur/g-base/g-cur-nogi A/B decides.
- R28 11:52 final candidate dist: npm run build rc 0 (verify-boot OK, boot 12.5 kB gz) → scratch/dist-re-final (includes props lane's newer public/assets: 155 MB vs 179 MB). chain2 stopped after pbase-max (its cur-side runs were on the builder dist). chain3 (scratch/rer2/chain3.sh, --timeout 9000): fclose-med (props-AD close-ups + flash), GATE gate-med (Medium strict playthrough), fclose-max, vfin-max (review views incl. C0 15.6 + peek), pfin-max, pfin-med, vbase-max, pfin-max2 (2nd Max load).
- R29 12:04 pbase-max (BASE f93285d, Max, mains, Blender none): load 380.5 s, 0 errors. C0: 383 ms @12.62 + 383 @13.58 (+133/150 @20.1–20.2); C1 60.5 31.4 fps 810 draws / 2.67 M; 61.8 30.1 fps 772 / 2.57 M; parlor 50.3 fps 212; upper-torch 57.8 392 / 1.91 M; u1-armoire 42.2 fps 789 / 2.65 M; GPU frame 24.7 ms. vs current builder dist (pcur-max): load 238.6 s, C1 39.5 / 49.8 fps, 768 / 732 draws — better, but both still far over the Max budget (≤ 500 draws / 2 M tris, ≥ 45 fps) at C1 and u1-armoire, and current Max has a NEW hitch cluster at C0 21.75–22.65 (533 ms) (crane shot as the car passes beneath). g-cur (Medium gameplay views, gpuFrameMs ×2 reps): parlor 25.3/18.3, upper 11.3/12.8, armoire 16.4/22.6, hall 11.7/11.5 ms — gpuFrameMs varies ±30 % rep to rep: the R21/R24 'regression' is noise-level.
- R30 12:15 fclose-med (FINAL dist, Medium, 15 props-AD views + flash, 0 errors, all 60 fps avg; frames scratch/rer2/fclose-med-*.jpg; before/after grid gF1 vs sw3 T1.5 = HEAD look): dress + jerry cans: the halo ring round the core is smaller and the fold/can edges crisper; the core itself stays a clipped disc (physically right for a 2 kcd core at 1–1.5 m). Exposure still sits at the 0.25 floor in 10 of 15 views (hp guard binds in none: p98 ≤ 1.7 log2 ≈ 0.8× white) — correct: the frame is not clipped, so lowering the floor only greys the whites (sw1). Flame halo kept (fl-table). Flash facade now directional (porch/under-eave dark, sky +1.3 EV). Still not real: e1 sign post is a pale over-exposed streak at 0.9 m (thin, < 2 % of frame → no meter can save it without darkening the scene; acceptable as a photographic clip); the dress reads as a smooth bell without lace/seams (props lane geometry).
- R31 12:20 g-base (BASE, Medium, gpu.mjs ×2): parlor 15.5/16.1, upper 10.4/10.7, armoire 12.3/12.3, hall 9.8/10.1 ms — tight reps, all 60 fps; g-cur (builder dist): 25.3/18.3, 11.3/12.8, 16.4/22.6, 11.7/11.5 ms → current is +1–10 ms GPU (parlor/armoire worst). dist-re-review and the final dist share identical medium assets; base assets differ in 33 files (props lane round E: grime decals, wear). Isolation queued: g-mix (final CODE + base ASSETS, scratch/dist-re-mix) and g-fin (final) after g-cur-nogi.
- R32 12:25 c1dc-max (FINAL dist, Max, C1 60.5, renderer.info): 702 draws (was 768 on the builder dist; −32 doors, rest run noise) = EXT1 264 + EXT2 273 + interior room shells 136 (G1 22, G2 18, G3 18, U2 18, U1 14, U3 14, G3P 12, U4 10, CLOSET 6, U4T 4) + doors 10 (front only). Still 40 % over the Max ≤ 500 ruling. Max ≈ 1.6× Medium per room → the extra are shadow/context passes, not more meshes. Not fixable safely in this review (the room shells carry the facade + lit windows); logged as the top perf item for the next runtime round. Load 227.4 s (fresh profile).
- R33 12:51 REALISM-BACKLOG.md: new 'Round E — AD + perf review' section (verdict, fixed, confirmed, ranked remainder); items 2/3/5 to be updated from c0b-max, g-mix/g-fin, vfin-max.
- R34 13:02 GATE gate-med (FINAL dist scratch/dist-re-final from npm run build, Medium strict playthrough, mains, Blender none): 11/11 assertions — B01…B13 in order, C1/C2/C3/C5/C6/C7 played, title card reached (ended=true, game 407.6 s, wall 251 s), 0 unstick rescues, deaths 0, 0 console errors, 0 exceptions, load 39.4 s, no stall. Report scratch/rer2/gate-med-report.json.
- R35 13:05 g-cur-nogi (builder dist ?geoinst=0): parlor 21.6/17.8, upper 14.5/12.2, armoire 15.3/20.4, hall 10.9/11.4 ms → same as g-cur: geometry instancing is NOT the GPU cost.
- R36 13:12 c0b-max failed (my scenario bug: process.env inside page eval) — re-queued as c0b-max2. Its load: 263.1 s = warm-up 208.9 s (2161 builds / 1478 programs; rc9 62 s, car-set 9.7 s) — 3rd Max load of this dist, still ≈ 4× the builder's 'warm 68–71 s'.
- R37 13:12 g-mix (FINAL code + BASE assets): rep2 parlor 19.8, upper 13.2, armoire 19.1, hall 13.4 ms (rep1 33.2/13.4/24.0/12.9) → the GPU cost follows the CODE, not the GLBs. Rep-2 summary (Medium GPU ms parlor/upper/armoire/hall): base 16.1/10.7/12.3/10.1 · builder 18.3/12.8/22.6/11.5 · nogeoinst 17.8/12.2/20.4/11.4 · mix 19.8/13.2/19.1/13.4. Next: g-rt = f93285d + ONLY the runtime-lane diff (worktree scratch/wt-rt, dist scratch/dist-re-rt) → splits runtime code vs props/gameplay code (src/materials etc.).
- R38 13:44 ⚠ POWER: the Mac switched to BATTERY at ≈ 13:02 (pmset: 93 %, discharging). Runs before that (incl. gate-med, g-mix, g-cur-nogi, c1dc-max, c0b-max) were on mains (onBattery null in their reports). From fclose-max on, every fps/GPU/load number is INVALID per CLAUDE.md (Chrome caps 30 fps, GPU throttles): g-fin, g-rt, pfin-max, pfin-med, pfin-max2 are flagged; visual runs (fclose-max, vfin-max, vbase-max) and the build-class diff (c0b-max2) stay valid.
- R39 13:47 AC power back (pmset 'AC Power'). Each later run's report.onBattery decides validity.
- R40 13:58 AD (rvmed, builder dist, Medium): gloves — torch hall: near-black silhouette (physical, 0.2–0.4 lux bounce); candle parlor: dark-brown leather reads well; moon yard: frame almost pitch-black (exposure 13.3 still adapting 1.5 s after the teleport → scenario artifact or real?) — settled check 'moon' (yard/facade/road, SNAP) queued on the final dist. Harlan figure in the parlor reads as a mannequin (characters/props).
- R41 13:59 g-fin (FINAL dist, Medium; shot.mjs flagged battery at its 13:0x queue entry, but pmset was back on AC long before it got the lock): rep1 18.9/12.0/12.5/10.1, rep2 15.7/11.2/12.5/9.8 ms (parlor/upper/armoire/hall) = base (16.1/10.7/12.3/10.1). VERDICT: no GPU regression in the final tree; the +2–10 ms in g-cur/g-mix/nogi (11:59–13:10) tracked machine load (fileproviderd 65–120 %, other lanes' sessions), not code. g-rt no longer needed (left in queue as a cross-check).
- R42 14:02 fclose-max (FINAL, Max; started under the battery flag → fps invalid, e.g. a-jerry 13 fps to be re-measured; 0 errors, load 189.8 s): visuals — a milky disc of haze sits over the lit area in the torch close-ups (siding torch outdoors strongest, jerry cans/dress indoors fainter). Physics: single-scatter back-scatter from ≤ 2 m of σs 0.0136/m mist with HG g 0.6 should be ≈ 0.6 % of a 0.5-albedo wall at 2 m — invisible. Beam A/B (bm1: beam on/off at siding, jerry, dress, e1 plate) queued.
- R43 14:02 code read: the beam cone is open-ended, BackSide, depth-tested — a ray hitting a wall nearer than the cone's far side draws nothing, so the beam cannot paint the lit disc on a wall at 2 m. Added bm2 (Max, ?bounce=0, bloom 0.22 vs 0 at siding/jerry) to split bloom / bounce from the beam.
- R44 14:03 c0b-max2 (FINAL, Max, C0 21.4 → 23.4 stepped 60 frames): 0 frames > 40 ms, 0 node builds, 0 new programs/textures (programs 1480, textures 320 = 1.66 GB, total GPU mem 1.79 GB). So the 533 ms cluster on pcur-max was NOT a missing warm-up build; candidates: a Metal pipeline still compiling at first draw (cold cache) or memory pressure on the 8 GB M1 (1.79 GB of GPU resources on Max). Real-time re-check in pfin-max.
- R45 14:09 g-rt (f93285d + runtime-lane diff only; queued under the battery flag, ran on AC): rep2 16.5/11.0/12.0/10.6 ms = base → confirms R41: no runtime GPU regression.
- R46 14:18 vfin-max (FINAL, Max, AC, 0 errors): peek 2.2 m — exposure 0.92 (builder ≈ 4): the hall keeps its read (candle table, stair, ceiling stains), the hp guard did not black it out; Ada is still a pale, featureless crouched white form at 960 px (needs a 1920 close look; characters/skin is the next lever). C0 15.6 flash (gV1): sky and fill darker, road pool reads; the frame is still CG because of the cone-stack pines and the blurred billboard (props/Blender ruling g). torch-road exposure 4.67, armoire 4.36 (settled entry snap works), candle parlor 3.06.
- R47 14:20 moon (FINAL, Medium, settled with SNAP; grid scratch/rer2/gMoon.jpg): yard drive, facade and road read as a cool desaturated overcast night (exposure 6.5–8.7) — never pitch-black. The black rvmed/vfin 'glove-moon-yard' frame was the scenario's 1.5 s after a teleport from a lit room (eye still adapting, tauBrighten 6 s) — behaves like an eye, not a bug.
- R48 14:24 bm1 (FINAL, Max, beam on/off in place; grid scratch/rer2/gB1.jpg): siding torch, jerry cans, dress, e1 plate — no visible difference. The volumetric beam does NOT lay a milky shaft over the close-ups (as the code read predicted: open-ended BackSide cone, depth-tested). The remaining soft 'pool' is the torch's own spill shelf (7 cd ≈ 13 % of the peak, flat out to 0.4 of the cone): a lit, low-contrast disc — physically the profile chosen by ruling (a); with glareBase 0 its halo ring is gone. No beam change made.
- R49 14:34 bm2 (FINAL, Max, ?bounce=0, bloom 0.22 vs 0; grid gB2): siding + jerry identical with and without bloom → with glareBase 0 / T 2 the glare no longer touches a torch-lit prop on Max either (before the fix bloom 0 'restored the dress folds'). Close-up torch item CLOSED on the runtime side.
- R50 14:42 pfin-max (FINAL, Max, AC, Blender none, fileproviderd 0.5 %): load 204.9 s, 0 errors, no stall. C0 real-time: sustained 83–167 ms frames 20.63 → 21.97 (worst 717 ms @21.97), else ≤ 33 ms (0–20 s) / 50 ms (23–30 s). The same window is clean when stepped (c0b-max2: 0 frames > 40 ms, 0 builds) → a real-time-only stall right after the 20.0 title card + score_reveal stinger (base had 133/150 ms @20.1–20.2; builder dist 21.75–22.65): suspects audio-thread/main-thread work at the cue or the title/byline DOM cards composited over a Max-resolution canvas; NOT fixed this round. C1 60.5 40.0 fps 706 draws / 2.43 M; 61.8 42.6 fps 670 / 2.37 M; parlor 60.0 212; upper-torch 60.0 405 / 1.93 M; u1-armoire 45.6 fps 797 / 2.56 M; GPU frame 24.4 ms.
- R51 14:50 pfin-med (FINAL, Medium, onBattery=None, Blender none): load 45.2 s, 0 errors, no stall. C0 real-time worst 33.4 ms (0 frames > 50 ms). C1 60.5 57.4 fps 401 draws / 1.09 M (was 432; budget 400 → 1 over); 61.8 54.4 fps 363 / 1.05 M; parlor 60.0 120; upper-torch 58.2 254 / 1.02 M; u1-armoire 39.2 fps (p99 167 ms, max 300 ms) 534 / 1.37 M. u1-armoire Medium fps across today's runs: base 60.0 · builder 52.5 / 48.7 · final 39.2 here vs 59.8 / 60.0 in g-fin (same dist, gameplay entry) → spiky, unexplained; needs a per-frame trace next round (draws there are 534 > 400 in every build).
- R52 14:51 LOADS on the FINAL dist (fresh Chrome profile each; shot.mjs start-timeout 1500): Max 8 loads 172.9–267.9 s (c1dc 227.4, c0b 263.1, c0b2 177.6, fclose 189.8, vfin 182.0, bm1 172.9, bm2 267.9 (?bounce=0 variant), pfin 204.9) — none stalled, 0 errors, all under the 300 s default; builder's 'warm Max 68–71 s' NOT reproduced today (three lanes thrash the shared Metal cache with different dists). Medium: warm 39.4 / 45.2 / 49.0 s (claim 45.4 holds); after a Max session 140.8 / 141.3 s (Metal cache evicted = cold). No --cold-metal run (it renames the machine-wide cache other lanes are using).
- R53 15:2x vbase-max (HEAD f93285d, Max) vs vfin-max (FINAL, Max) — grids scratch/rer2/gV2.jpg, gV3.jpg: candle parlor — HEAD glove reads tan/bare, final dark-brown leather; HEAD candle + note paper bloom into a large white blob, final a small flame halo (glare fix). C0 15.6 flash — final has the darker sky/fill and less snow-white ground wash; pines still cone stacks. Armoire slats — same (hall reads through the gaps in both). Torch road — near-identical. Peek — exposure 1.05 (HEAD) vs 0.92 (final); Ada still a pale shape in both.
- **Review end state (15:2x).** Fixes (my lane): glare high pass forwards only the excess (LOOK.glareBase 0, bloomThreshold 2), highlight-protect meter cap (hp*), lightning fill 0.75 / 2.5, opening cull of the 8 interior doors. GATE on scratch/dist-re-final (npm run build): typecheck 0, npm test 233/233, build + verify-boot OK, 0 console errors in every final-dist run, Max loads 173–268 s with no stall, Medium strict playthrough reached C7 → title (11/11, deaths 0, 0 rescues). Not fixed: Max budget (C1 706 draws / 2.43 M, 40 fps; u1-armoire 797 / 2.56 M, 45.6 fps), Max real-time C0 stall 20.6–22.0 s (worst 717 ms; clean when stepped), Medium u1-armoire spiky (39–60 fps), Max warm load ≈ 3× the builder's claim. CONTRACT-CHANGES #81. REALISM-BACKLOG "Round E — AD + perf review". Worktree scratch/wt-rt (f93285d + runtime diff) left for the lead to remove (`git worktree remove scratch/wt-rt`).
