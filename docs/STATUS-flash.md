# STATUS — FLASHLIGHT/HANDS lane ("FLASH", contract #146)

User (live build, 2026-10-12): "the flashlight gets dimmer as you approach walls, fix that and the hand holding the
flashlight looks very weird fix that as well".

Owned: src/render/flashlight.ts, src/render/flashlight-bounce.ts, src/render/exposure.ts, the exposure/torch constants
in src/render/look.ts, src/player/flashlight-rig.ts, src/characters/arms.ts, blender/characters/arms.py + tex_arms.py
(+ the arms_* clip source), public/assets/*/arms*. Read-only: the rest of src/render/** (SMOOTHNESS PERF lane),
src/cutscenes/** (SMOOTHNESS FRAMES lane).

## Item 1 — THE BEAM GETS DIMMER AS YOU APPROACH WALLS (agent "beam", contract #146)

Dists: scratch/dist-flash-beam2 (the tree at 10:31: #146 + 1b, unfixed pipeline) · scratch/dist-flash-fix (17:05 tree from the
private copy scratch/flash-fix-src with the one-line pipeline alpha fix). (dist-flash-beam / -base deleted to free disk.)
Work dir: scratch/flash-beam/. Tools: scripts/qa/flash-beam.mjs (settled d = 4 … 0.25 m + a 1.6 m/s walk-in; CSV +
labelled captures; CONFIGS=old,new,arms,expo = same-session A/B on a #146 build), scripts/qa/flash-b05.mjs (C2 9.3 /
13.9 + C2c 15.5 stills + B05 4/3/2.3 m with AB=1 same-state old/new captures), scratch/flash-beam/sim.ts (offline
wall approach through the pure meter).

### First diagnosis (geometry + offline meter; the browser later found the main cause — see ROOT CAUSE)
1. LENS THROUGH THE WALL: idle pose lens ≈ 0.55 m ahead of the eye (CHARACTERS.md flash_center (−0.135, 0.44, −0.235)
   + head), body capsule r 0.27 → at eye-to-wall < ≈ 0.55 m the SpotLight is behind the wall face (N·L < 0: no pool
   at all) and the glove/torch mesh pokes through.
2. PARALLAX: the clip holds the lens 0.235 m under the eye aiming ≈ 3° down → pool 0.235 + 0.05·d under the gaze:
   9° at 2.3 m (unchanged), 27° at 0.5 m, 40° at 0.3 m = below the 35° half-vfov: the hot spot slides out of the
   frame and the centre is left in the dim spill (the glitch lane measured the same in C2c: 26° under the gaze).
3. EXPOSURE (offline, ideal geometry): the protects fully adapt from 4 m to ≈ 2 m (pool display flat), then the
   hpFloor 0.03 stops all adaptation → the pool clips to 45–107× white with no falloff. Not dimming by itself, but no
   partial adaptation either. Fixation gate is a hard on/off at fix/metered = 4× and 256× (pops).
4. UNBOUNDED NEAR FIELD: the cookie core follows 1/d² to the 0.01 attenuation clamp (200 klx at 0.1 m); a Ø 5 cm
   reflector bounds it (≈ Φ_core/A ≈ 12.7 klx).

### Changes (in the tree, all switchable at runtime for same-state A/B)
- flashlight.ts: aperture near field on the hot core: σ_eff² = σ² + D²/(8d²), peak × σ²/σ_eff² (flux conserved):
  −8 % at 1 m, 5.9 klx at 0.5 m, 13.4 klx at 0.25 m, → 23 klx at contact, monotonic. `fl.near.value = 0` = old.
- arms.ts: (a) near-wall PULLBACK — two-bone IK on the left arm (elbow folds in the clip's bend plane, hand keeps its
  world orientation, so the pool stays put), driven by 4 short rays along the torch line (sightDistance: closed door
  leaves count), smooth C¹ hinge (margin 6 cm, knee 15 cm), τ 0.05 s out / 0.3 s back, approach-speed lead (sprint
  safe), lift 0.25 m/m toward the chin, ≤ 0.42 m. (b) near-wall AIM — inside 0.8–2.0 m of the gaze hit the hand turns
  the torch toward the gaze point (τ 0.15 s, ≤ 50°). Both off: arms hidden (hides), anchored (car), BEAM_CLAMP (C2c,
  `pullInClamp` opt-in for FRAMES), any exposure cue (C2/C2c/opening), `cutsceneHold` (lead to wire). IK pose restored
  before each mixer update (never accumulates). `arms.pullEnabled / aimEnabled = false` = old.
- flashlight-bounce.ts: TORCH_WORLD {sight, hitDist, subject} (probe for arms, beam hit for exposure; `subject` =
  Ada/Harlan stand in the beam nearer than the static hit — the octree has no characters).
- exposure.ts: readback math → pure `meterTarget()` (unit-tested; legacy-identical with the old settings);
  soft fixation gate (LOOK.fixSoft 1 EV); NEAR-POOL ADAPTATION: G = log2 E(d)/E(nearD0) on the static beam hit (gameplay,
  no cue, no subject); the meter sees the frame with (1 − nearAdapt)·G removed and the protects' floor drops by
  nearAdapt·G → the eye adapts half of each EV the pool gains; per-frame feed-forward of G between readings
  (nearLead). look.ts: nearAdapt 0.5, nearD0 3 m, nearLead 1, fixSoft 1 (old = 1 / – / 0 / 0).
- tests/exposure-response.test.ts (5 tests): legacy equivalence, brighter-frame-never-darker, wall approach monotonic
  + adapts ≥ 1 EV, near gain bounds, cues untouched.

### ROOT CAUSE FOUND (14:40–17:05, browser) — Medium/Max apply the exposure AFTER the tone mapping
- after1 (Medium, CONFIGS=old,new, same session; scratch/flash-beam/after1/sheet-{old,new}-{U1,G1,U2}.jpg, med-beam.csv):
  the DISPLAYED pool centre FALLS as the wall gets closer in BOTH configs (U1 old 122 → 76 → 39 at 4/3/2 m; new 125 →
  94 → 81 → 61 → 57 → 36 → 20 → 14 at 4 … 0.35 m) while the scene-pass HDR at the pool rises 1/d² (3.7 → 238). The
  #146 exposure/arms changes only soften it. The user's report is fully reproduced; #146 as built does NOT fix it.
- diag (scratch/flash-beam/diag*, scenarios scratch/flash-beam/diag{,2,3,4}.mjs), U1 d = 2, torch core HDR 21:
  · Low (direct path): display follows AgX(HDR × e) — core 231 at e 0.18, brighter at 1 m (243). CORRECT.
  · Medium: the core is a flat plateau (80 at 2 m, 47 at 1 m) and its final-pass output is LINEAR in the exposure
    (HalfFloat output target: 0.080 / 0.320 / 0.976 at e 0.05 / 0.2 / 0.8, neutral grey).
  · Every intermediate target holds the true core (scene output 21.3, TAAUNode.resolve 21.1, SharpenNode.output 21.2):
    the clip is in the final output pass.
  · Cause (src/render/pipeline.ts:526, PERF lane's file): `hdr = grade4(hdr.mul(uniforms.exposure))` multiplies the
    vec4 INCLUDING ALPHA by the exposure (and `hdr.add(bl)` adds bloom's alpha). r186 RenderOutputNode clamps alpha to
    [0, 1], UNPREMULTIPLIES (rgb / a) before the tone mapping and PREMULTIPLIES after. So for e·a < 1 the screen shows
    AgX(HDR / a) × e·a: the tone curve sees the UNEXPOSED scene and the exposure becomes a linear gain after it. A bright
    core already at AgX white then dims linearly with every EV the meter takes off — walking at a wall, the meter (which
    reads the true pre-post HDR) lowers e as the pool brightens and the displayed pool gets DARKER. Fits all readings:
    core 0.99 × 1.6e (a ≈ 1.6 = scene 1 + bloom ≈ 0.6). Dark rooms (e ≥ 1/a) are unaffected (alpha clamps to 1).
    The Low/direct paths write `vec4(grade(color.rgb × e), color.a)` — rgb only — and are correct.
  · Fix (one line, PERF lane / lead): `hdr = grade4(vec4(hdr.rgb.mul(uniforms.exposure), 1));` (exposure on rgb, alpha 1).
    A/B dist built from a private copy (scratch/flash-fix-src → scratch/dist-flash-fix; the shared tree untouched).
    Runs on it: fix1 (flash-beam CONFIGS=old,new, Medium, U1/G1/U2; 0 console errors):
  · new (#146 + alpha fix): displayed pool centre monotonic within grain at every site — U1 200 → 211 → 231 → 242 →
    244 → 244 → 246 → 239 → 241 (4 … 0.25 m; −6.7 worst step = grain at white), U2 strictly monotonic; walk-ins at
    1.6 m/s: NO drop at any site (U1 200 → 246), lens ≥ 8 cm off the wall. scratch/flash-beam/fix1/sheet-new-*.jpg:
    the pool grows and brightens, the damask shows in it from 1 m in, a real hot core.
  · old (pre-#146 exposure/arms + alpha fix): monotonic until the lens goes through the wall (0.5 m: black frame,
    6000+ glove vertices behind the wall) — the pullback is still needed.
  · Guard stills, unfixed vs fixed dist (flash-b05.mjs, Medium; scratch/flash-beam/b05-{nofix,fix}/,
    side-by-sides scratch/flash-beam/ab-b05.jpg, ab-gown23.jpg): C2 9.3 / 13.9 (film camera, e 0.625 / 1.27) and C2c 15.5
    (e 0.39) nearly unchanged; B05 4 / 3 m unchanged in character; B05 2.3 m (e 0.28): the gown is brighter and warmer,
    its torch-lit centre close to white (folds still read at the edges). Not a regression of the meter: with the fix
    the fixation protect finally does what it was tuned to on paper (fixPct 97 % of the centre disk at fixWhite 0.6
    pre-AgX ≈ sRGB 0.71); under the bug every frame with e·a < 1 showed AgX(HDR/a)·e·a instead. AD to judge the 2.3 m
    gown after the fix lands — if it reads too hot, lower LOOK.fixWhite (0.6 → 0.45) or fixPct (this lane's constants).
  · KNOCK-ON (lead): every Medium/Max frame with exposure < 1 changes (torch-lit gameplay, most cutscenes metered below
    1): highlights brighter and correctly compressed by AgX, the toe slightly deeper. Dark rooms (e ≥ 1) and Low are
    unchanged. Needs a full-route AD look pass (Medium + Max) once applied; the gate's numbers are unaffected.

### Item 1b — exposure jump ≈ 0.3 s after every cutscene cut (lead, from the FRAMES lane: STATUS-smooth-frames "For
FLASHLIGHT/HANDS", strips c7_expo.jpg / c0_expo.jpg)
- Cause confirmed in code: a cut detected inside update() → snap() → the SAME update metered the scene texture of the
  frame BEFORE the cut (correctly not snapped to, but it still set the target to the pre-cut scene) and pushed
  nextMeter 0.25 s on → the post-cut reading landed 9–10 frames late, then the ev jumped.
- Fix (exposure.ts): the post-cut reading is issued on the first update AFTER the snap (t > snapAfter), even with an
  older reading still in flight (in-flight counter instead of `busy`; each readRenderTargetPixelsAsync has its own
  buffer on WebGPU and WebGL2 — checked in r186 WebGLTextureUtils.copyTextureToBuffer); readings issued at/before the
  last snap are dropped entirely. Film-camera cues (EXPOSURE_CUE.fixed: C2/C2c) never meter — unchanged by construction.
- Unit test (tests/exposure-response.test.ts #6, fake renderer, 1-frame readback): snap lands on frame 2 after the cut;
  the OLD logic fails the same test at frame 9 (evs 1.12 0.92 … −0.04 then −2.00) = the FRAMES lane's 0.3 s.
- BROWSER CHECK (done, 10:20): the FRAMES lane's real-route capture scratch/smooth-frames/capE/C0-0 (3206 frames C0 →
  C1, Medium, served from scratch/dist-smooth-frames built 09:42 — after this fix, the bundle contains `snapIssued`),
  detect.py → scratch/flash-beam/cuts/C0-0-detect/{report.txt,events.json}. Every C0 cut now snaps on frame +2 and is
  flat after it (was +9–10 = 0.3 s): C0 12.517 → 12.583 (luma ×0.32), 19.017 → 19.083 (×0.28), 26.017 → 26.083
  (×1.47), C0→C1 0 → 0.067 (×1.56); no second step in the next 15 frames.
  HONEST RESIDUAL: the cut frame and the one after it still render at the pre-cut EV (readback latency: the post-cut
  frame has to be rendered, metered and read back before it can be exposed). That meets the FRAMES ask (1–3 frames);
  landing ON the cut frame needs the post-cut frame metered on the GPU before presentation (a pipeline.ts reduction
  feeding the output pass) — out of this lane, logged under "For other lanes".
- SECOND STEP (10:30, exposure.ts armPostRender): a cut detected in update N now meters the post-cut frame right
  after it renders — a microtask queued by update() runs once the synchronous rAF tick (update → render) or advance()
  step is over, so the readback is back before frame N+1 (Medium GPU frame ≈ 9 ms) and only the cut frame itself
  shows the pre-cut EV. Guarded: skipped (→ the update path above, frame +2) when renderer.info.render.calls did not
  move since the snap (nothing rendered), another update ran first, a flash holds the meter, a film-camera cue is on,
  or 3 readings are in flight; stamped just after the cut so the cut filter keeps it. Unit test #7 (real loop order,
  fake renderer with info.render.calls): cut frame at the old EV, frame 1 on → snapped and held; fails without the
  change (1.12 1.12 −2.00 … = 2 stale frames); the no-render guard keeps the stale texture out. npm test 300/300.
  BROWSER CHECK (done, 14:45): cuts2 = cs-frames SCENE=C0 FROM=11 TO=30 on scratch/dist-flash-beam2 (built 10:31 with
  it) → scratch/flash-beam/cuts2/C0-0 (615 frames) + C0-0-detect: all four cuts now snap on cut +1 — only the cut frame
  itself shows the pre-cut EV (C0 12.533 luma 0.0204 → 0.0062 flat; 19.0 0.0864 → 0.0228; 26.0 0.0077 → 0.0136; C1 0
  0.0061 → 0.0106), was +2 with the first step and +9–10 before #146.
  C7 (15.83 / 18.6): not re-run by this lane — the FRAMES lane's queued runs on the same post-fix dist cover it:
  scratch/smooth-frames/capH (Medium, SCENE=C6,C6b,C7,CR) and maxB (Max, C7 windows 9.4–10.4 / 15.6–19.2). Run
  detect.py on their C6-*/C7-* segment with --out scratch/flash-beam/cuts/<seg>-detect and read the luma at cut +0…+3.

### Runs
State at 10:30 (after the 10:13 network drop killed the first queue; the Mac is on AC now):
- DROPPED: before/med (true-baseline dist-flash-beam-base) — it FATALed on battery (load stalled 300 s while baking
  light probes at runtime; scratch/flash-beam/before/med-02-fatal.jpg). Not re-queued: CONFIGS=old in the same session
  restores every #146 switch to its pre-#146 value (meterTarget legacy-identical: unit test #1), which is the stronger
  same-state proof. The base B05 run and the cuts run were dropped for the same reason (cuts: see 1b above).
- DONE (all exit 1 only for the 73 copyFramebufferToTexture errors of the then-current tree; 0 on the 17:05 tree):
  after1 med/max (CONFIGS=old,new on dist-flash-beam, the dimming reproduced in both configs — see ROOT CAUSE),
  cuts2 (1b), diag/diag2/diag3/diag4 (root cause), fix1 + b05-nofix/b05-fix (the alpha fix A/B). b05-new1 FATALed on
  battery (load stall at "Synthesizing sound"); superseded by b05-nofix/b05-fix. Analyse a beam run with
  `node scratch/flash-beam/analyze.mjs <dir> med` (per-site table, walk-in drops, contact sheets).
- Unit: tests/arms-pullback.test.ts (5): far → untouched; 1.6 / 3.6 m/s walk-ins → lens clearance ≥ 6.2 / 4.5 cm (pullback
  off: −0.29 m = inside the wall), ≤ 3.2 / 6.4 cm per frame; aim → pool at the gaze point, released away from walls;
  no IK accumulation. tests/exposure-response.test.ts (7). npm test 304/304 (17:40, whole tree), npm run build ok, typecheck clean,
  assets --check ok (medium 53.91 / max 77.25 MB).


## Item 2 — THE HAND (agent "hand", contract #146b) — DONE with residuals (2026-10-12 17:30 – 10-13 01:50; final numbers: R1 POST2 + GATE below, residuals in the final judge)

Dist: scratch/dist-flash-hand (tree at 17:38 incl. the lead's pipeline.ts exposure-on-RGB fix (ar) + cutsceneHold wiring).
Tool: scripts/qa/hand-views.mjs (16 gameplay views, B05 with the armoire exited: hall candle, parlor lamp, dark
sewing room, rain drive, idle hall, walk, run, crouch, down 45°, up 30°, wall 0.45 m, F toggle, knock, bell, door
rattle, breath hold; per view the arms' screen bbox from the skinned vertices, lens/hand in camera space, EV).
Baseline: scratch/flash-hand/before/{sheet-med.jpg, crop-bright.jpg (gamma 2.2 crops), med-views.json} (+ max).

### JUDGE (baseline, Medium, after the exposure fix) — biggest first
1. THE GRIP IS ANATOMICALLY BROKEN. The rest pose (skeleton.ARMS + arms_bones, hold_roll −28°) puts the LEFT hand
   palm-DOWN on top of the barrel with the knuckle axis a = (0.98, −0.03, 0.18) — pointing RIGHT, toward the frame
   centre, perpendicular to the torch (a crosswise hammer grip) — while the forearm comes forward-up from the elbow at
   the left side: the wrist is bent 72° (≈ 55° radial deviation + 30° extension; radial deviation tops out at ≈ 20°).
   In-game (crop-bright.jpg) it reads as a claw draped over a ball: the fingers hang down the far side of the barrel,
   the barrel is hidden under the hand (only the knurled tail cap pokes out under the wrist toward the camera and the
   bezel shows above the knuckles as a dark disc). Nothing says "holding a flashlight".
2. FINGERS: long, thin, evenly curled "spider" fingers (curl 64° on every joint, same for all four) hanging free beside
   the barrel instead of wrapping it; no stagger (a real grip closes the pinky tighter than the index).
3. BLACK SILHOUETTE: the glove (spec albedo 0.035/0.022/0.015, ~2x darker than the baked chestnut) is lit only by the
   pool's bounce — ≈ 9 EV under the pool the meter protects — so it renders as a black cut-out indoors and a grey-green
   blob outdoors (rain). Partly physical; the shape (1–2) is what makes it unreadable.
4. PLACEMENT: arms bbox x 0.15–0.66 / y 0.77–1.0 in every idle view — half the frame width, the fist at x ≈ 0.37
   (near the centre); the brief wants the hand in the lower 10–20 % band, off-centre.
5. MOTION: the bbox is identical in idle / walk / run / up 30° / down 45° — the hand is welded to the eye (only a 70 ms
   rotational lag); no stride bob of its own. (Couples to beam-follows-gaze: noted, low priority.)


### FIX 1 — the grip (blender/characters/arms.py GRIP + left_grip_bones; clips_arms.py toggle) — built, under review
- Geometry search (scratchpad grip*.py/combo.py: every roll of the hand about the barrel × obliquity × grip depth ×
  elbow pole, two-bone elbow from the shoulder, wrist strain = each angle as a fraction of its range: ulnar 35 /
  radial 20 / extension 70 / supination 85°): a beam held FORWARD with the fist up in view at chest height is only
  reachable with the forearm SUPINATED ("pointing a remote"): palm up/inward, the barrel obliquely across the palm at
  the distal crease, fingers wrapped over it, thumb over the top. Thumb-up/pronated grips need radial deviation or
  > 45° extension + an elbow raised to shoulder height. Chosen: grip (−0.15, 0.36, −0.26) camera space (was (−0.135,
  0.44, −0.235)), roll 120°, obliquity 26°, depth 0.44 L, pole (−1, −0.25, −0.25) → ulnar 31°, extension 36°,
  supination 84° (0.9 of range), upper arm 8° under horizontal, elbow (−0.42, 0.14, −0.30) off screen.
  Old pose: radial deviation 55° (2.75× its range).
- Beam kept: barrel (0.0429, 0.9982, −0.0417) re-pitched for the lower lens so the wall pool matches #146 (computed:
  within 0.5° at 1–4 m; to verify with flash-beam.mjs U1/G1 cx/cy vs scratch/flash-beam/fix1).
- Fingers solved per finger (MCP/PIP/DIP grid, phalanx points at the contact radius barrel 19.3 + finger + glove 1.2
  mm, penetration > 1.5 mm penalised, DIP≈0.7 PIP prior): index open … pinky tight (stub test: index 16/90, middle
  57/73, ring 72/60, pinky 78/43 deg); thumb wrapped over the top toward the index (MCP 80°).
- skeleton.ARMS flash_center/flash_dir are SUPERSEDED by arms.py GRIP (skeleton.py untouched: hand_bones is shared).
- Toggle clip: the +22/+30° thumb press would now drive the wrapped thumb through the barrel → a 6/8° squeeze + index.
- Blender: `node scripts/assets.mjs --only characters --job-args="--only arms"` then `--only anims --job-args="--only
  arms"` — NOTE the characters/anims jobs are then recorded fresh though only the arms ran (safe: Ada/Harlan inputs
  unchanged, hand_bones untouched).

### Restart (agent "hand" #2, 19:42–) — continuing FIX 1
- Found: the 18:24 characters run built the grip but bone heat left pinky_01..03_l EMPTY (the 4 mm proxy pinches the
  curled pinky off as a 284-vert island that _drop_islands then deletes) → the glove's pinky rode the ring finger / palm
  weights and never moved with a clip; and the free DIP solve straightened every DIP (0 deg: wooden fingertips). The
  anims job (arms.glb) had NOT been run: the game still showed the old claw.
- arms.py: DIP tied to the PIP (oblique retinacular ligament: DIP = 0.5–0.85 × PIP, prior 0.67) → index 16.5/72/50,
  middle 57/73.5/37, ring 72/60/30, pinky 78/43.5/22 (fit 4.2/6.1/5.4/3.7 mm rms); _fill_empty_groups: a soft
  nearest-segment fallback (w = exp(−(d − d_min)/4 mm), joints blend over ~1 cm) for groups heat leaves empty, applied
  to the proxy AND the full-res glove; dropped islands logged with their nearest bone; glove decimation 12000 → 11950
  per glove (the fist meshed 48014 tris > check_chars' 48000 → anims job FAIL at 19:48).
- arms.ts: pitch decoupling (PITCH_K 0.2, ≤ 10°, τ 0.12 s): the arms root swings about the eye by −0.2 × view pitch
  (translation only — the beam keeps its aim); off under cutscenes / cues / BEAM_CLAMP / car anchor. `arms.pitchK = 0`
  = the welded hand (A/B). hand-views.mjs reports `swing` (deg) and `hoff` (rig.handOffset, mm).
- Before-dist kept: scratch/dist-flash-hand0 (17:41 tree, HEAD arms.glb in its assets) for same-view before/after.
- OFFLINE CLIP CHECK (no browser): scratch/flash-hand/clipcheck.mjs <glb> [clips] (+ clipsum.mjs: per-clip ranges) loads
  arms.glb in node (GLTFLoader + MeshoptDecoder), samples every clip: lens/wrist camera space, beam angle, the glove/
  sleeve/torch screen bbox at 70° and the nearest glove vertex. Findings (HEAD vs the 19:48 grip GLB):
  · arms_stumble_catch (C2c 6.46–7.66) was ALREADY broken at HEAD: FK upper arm +42° threw the left wrist 13 cm ABOVE
    the eye, beam 62° up, gloves over 50 % of the frame (= the "gloves fill the frame at C2c 7.6"); on the new rest the
    same FK covers 96 %. → rewritten as IK (clips_escape.py, logged #146b): torch fist onto tread 13 left of the right
    glove, beam on the treads ahead, 13° under the gaze at the push-off.
  · car clips (wheel, map, radio, knob, stalk, brace): the torch stays in the wheel fist; the new rest's barrel-in-palm
    points it 49° UP (HEAD: 50° down into the door well). The clip note "the runtime hides the flashlight mesh in the
    car" was never implemented → arms.ts CAR_CLIPS: torch meshes hidden while a car clip is the base or the car anchor
    holds the root; the light leaves from the idle lens (unmounted: C1 73.6 switches the torch on with the wheel clip
    still loaded) or from HEAD's wheel lens when mounted (C6 may carry the torch on into the car: unchanged look); no
    crossfade across the car/torch boundary (C1 73.7: a 0.35 s blend swept the torch through the frame).
  · idle: fist lower (bbox top 0.75 → 0.82 of the frame, area 0.13 → 0.10), lens (−0.14, 0.51, −0.27) (was −0.13,
    0.59, −0.24); breath hold lens 0.21–0.24 under the eye (camera space); locket hold area 0.21 → 0.36 (forearm enters
    from the left edge: check in the 'locket' view).
- pitch swing: snaps to 0 when a cutscene takes over AT a cut (rig turn > 15° or move > 0.3 m in a frame), eases
  otherwise (no post-cut drift, no pop without a cut).

### Round 1 — the grip in game (Medium, scratch/dist-flash-hand built 20:10: grip + DIP + pinky weights + stumble IK +
pitch swing + car-hands + hand spring)
- Blender: the 284-vert proxy island dropped by _drop_islands IS the pinky (nearest bone pinky_02_l, 10 mm); the glove
  pass re-weighted 758 full-res verts; tris 47 914 (≤ 48 000); assets --check: low 26.99 / 27 MB ok.
- Runs: 2 × FATAL on battery (load stalled 300 s at "Synthesizing sound" — the other lane's c2b runs stalled the same
  hour at "Baking light probes": machine-wide memory pressure, 60 MB free); 3rd try (960×600, --start-timeout 900) ok,
  load 41.7 s, 0 console errors. scratch/flash-hand/r1/{sheet-med.jpg, abcrop-med.jpg (before|after, lower-left 70×42 %,
  gamma 2), zoom-r1.jpg, ab-hall-full.jpg, med-views.json}. grid.sh / abcrop.sh build the sheets.
- Numbers (before → after): idle bbox top 0.78 → 0.82, left edge 0.15 → 0.06 (the forearm now enters at the lower-left
  corner); lens (−0.13, −0.26, 0.59) → (−0.14, −0.27, 0.52) camera; down45 swing +8.9° (the fist rises into the lower-left
  quarter, top 0.72), up30 −5.9° (out of frame but the torch head, top 0.91), stair (C2c 15.5 pose) +10°; walk/run hand
  offset 1 / 4 mm (spring); wall pull 0.12 m.
- JUDGE r1 (harsh, biggest first):
  1. FIXED — the claw: the fist now wraps the barrel, the torch reads as a torch (barrel, knurl band, bezel) rising from
     a fist at the bottom edge; nothing hangs over it.
  2. The fist is mostly below the frame edge in level views: only the torch head and 2–3 knuckles show. Physically right
     for the brief's chest height (fist 0.26 m under and 0.36 m ahead of the eye = 36° under the gaze, the 70° frame's
     half-height is 35°): kept.
  3. The forearm enters from the LEFT edge, nearly horizontal (most visible looking down 45°): the solved elbow is out at
     shoulder height (upper arm 8° under horizontal, 46° abducted). Searched (scratchpad hand/elbow.py, shoulder effort in
     the cost): with the fist at this height every physiological grip (obliquity ≤ 36°) that drops the elbow needs ≥ 100°
     supination or ≥ 35° ulnar deviation (the pole swept 10°: ulnar 36°, elev 13°). A hand at shoulder height in front of
     the eye means a raised arm; the alternatives are the fist out of frame or a broken wrist. Kept; honest residual.
  4. Thin bright outlines on the finger/forearm silhouettes against the lit floor (zoom-r1.jpg). SAME-FRAME A/B
     (hand-views AB=…, scratch/flash-hand/r1ab/ab-outline.jpg: base | sharpness 2 (RCAS off) | ARMS_SHEEN 0): unchanged
     with the sharpen off, GONE with the Medium glove's env sheen off → this lane's ArmsEnvNode: (1 − n·v)³ × the pool's
     REFLECTED radiance lit every silhouette edge alike (at grazing the reflection runs on into the lit floor). → round 2.
  5. Glove/torch are near-black silhouettes in torch-lit rooms: physical (glove ρ 0.035 under ≈ 0.5 lx of room fill vs a
     ≈ 400 lx pool: −12 EV). Edge sheen + knurl highlights carry the form.

- C2c on the real route (scripts/qa/hand-cs.mjs: B03 → threshold → C2 → C2c, no input; before = dist-flash-hand0):
  scratch/flash-hand/r1/c2c-ab.jpg (top before, bottom after; 7.6 / 11.4 / 15.5). 7.6: before a grey perforated glove
  over the upper-left third holding the torch ABOVE the eye (bbox x 0–0.57, y 0–1, lens 0.15 m above the eye) → after no
  glove in frame (the fists are on tread 13 below the L35 frame; lens 0.27 m under the eye). 11.4 unchanged (the
  breath-hold arms out of frame). 15.5 (gameplay, pitch −50°): the claw over the flight → the forearm + fist in the
  lower-left quarter (swing +10°), the torch pointing down the flight. 0 console errors both runs.

- C1 30 s (cs-frames SCENE=C1 WINDOWS C1 [29.95, 30.05], before = dist-flash-hand0): scratch/flash-hand/r1/c1-ab.jpg,
  c1-lefthand.jpg. Before: the left glove on the rim WITH the torch in it (its lens ring sticking up-left past the rim —
  the "runtime hides the flashlight mesh in the car" never existed); after: the glove alone, fingers closed on the rim
  (CAR_CLIPS hides the torch), the rest of the frame identical (exposure 0.537 / 0.538). 0 console errors.

- Max r1 (scratch/flash-hand/r1/{sheet-max.jpg, abcrop-max.jpg}, 0 console errors, load 165 s): same read as Medium;
  the volumetric beam leaves the lens visibly in the rain view.

### Round 2 — the glove sheen (arms.ts ArmsEnvNode, Medium only; Max has the real Charlie lobe)
- The env sheen is now three r186's own indirect sheen (PhysicalLightingModel: E · sheenColor · IBLSheenBRDF(n·v) / π,
  DG = exp(−2.70 μ − 0.65) at sheenRoughness 0.5) lit by the IRRADIANCE at the normal: the pool as a Lambertian disc
  (π L r²/(r² + d²) · cos θs · cos θp) + the room fill + the sky outdoors. Only edges that face the pool catch it,
  ≈ 1/10 of the old rim. `ARMS_SHEEN` (uniform, `g.arms.env.sheen`) = 0 turns it off for A/B.

- r2 Medium (scratch/flash-hand/r2/{sheet-med.jpg, ab-sheen.jpg = r1 | r2 | r2 sheen off, gamma 2.2}, 0 console errors,
  load 37.5 s): the cartoon outline round each finger is gone; the fingers keep a soft edge where they face the pool.
  Locket hold (r1ab/locket-stair.jpg): the torch drawn in under the chin, barrel along the bottom centre, fist + right hand
  at the bottom edge (bbox x 0–0.52, top 0.78) — plausible; stair (C2c 15.5 pose): fist + thumb lower-left, torch down
  the flight.

### Round 3 — motion, frame by frame (scripts/qa/hand-motion.mjs: rest / walk / stop / sprint / look-down 41° in 0.13 s /
look-up / crouch, 30 fps stepped, the lens's screen position per frame; before = dist-flash-hand0)
- r2m (after) vs b0m (before): look flicks 60 px max step in both (the rig's 70 ms rotational lag, unchanged); walk
  5.7 / 5.5 px, sprint 8.3 / 6.7 (the hand spring: 18 mm of lag at the sprint start, eases out); crouch 20 px (after)
  vs 1.5 (before): the hand now lags the eye's 0.6 m drop (spring at its 25 mm limit), then settles in ~0.3 s — a
  real arm's lag, no single-frame jump in the rows.
- FOUND (pre-existing, both builds): a one-frame 6 px twitch at REST. Not the camera (yaw/pitch smooth to 0.002°), not
  the spring (0 mm): the idle clip's LOOP SEAM. scratch/flash-hand/loopcheck.mjs: across the 4 s wrap the lens jumps
  18.6 mm (HEAD 12.2) in one frame while an ordinary frame step is < 1 mm — wobble() sines are not whole cycles of the
  clip and clip.py copies frame 0 onto the last key, so the whole mismatch lands in the last frame. Wheel 5.5 mm, breath
  hold 20.9 mm (inside its own 7 Hz tremble). → clips_arms.py `seamless()`: the last 0.8 s (0.5 s for the 2 s breath
  hold) cross-blend fn(t) → fn(t − duration) with a smoothstep weight (pose and velocity continuous at the seam);
  applied to arms_idle, arms_breath_hold, arms_wheel. run_torch (33 mm seam inside 50 mm pump steps) left as is.

- ROOT CAUSE of the rest twitch (the seam fix above did NOT remove it: r3 motion still 5.6 px; same-session isolation
  scratch/flash-hand/rest-diag.mjs: unchanged with aim, pull, pitch swing all off): the GLB's rotation keys are
  QUANTISED. Blender 5.2's glTF exporter runs every animation rotation through meshopt's quaternion filter at a
  hard-coded 8 bits (io_scene_gltf2/io/exp/meshopt.py: QUAT_FILTER_BITS = 8) → 0.4–1.1° steps (trackq.mjs on arms_idle:
  hand_l 75 of 120 key steps exactly 0, then 0.4–1.1° jumps). The idle sway moves ≈ 0.09°/frame: the hand stood still,
  then jumped 3–7 mm at the lens (offline sim scratch/flash-hand/sim-rest.ts with the real GLB + FpArms + FlashlightRig:
  steps 0.03 mm … 7.1 mm). This is in EVERY character GLB (Ada/Harlan rotate in the same ≈ 0.6° quanta).
  → arms.ts `smoothQuaternionTracks` at load for the slow loops (SMOOTH_SIGMA: idle 4 keys, wheel 4, locket hold 2):
  Gaussian over the keys per quaternion component (hemisphere-aligned, circular for loops, renormalised). Sim after:
  steps 0.02–0.97 mm, smoothly varying (the true sway speed). tests/arms-smooth.test.ts (3). npm test 318/318.
  Fast clips (knock/toggle/breath tremble) untouched (their motion hides the quanta).
- r4 (23:54, dist-flash-hand rebuilt 23:48 with the smoothing + seamless loops; hand-motion.mjs, Medium;
  scratch/flash-hand/r4/med-motion.json, r4-motion.log): REST 5.6 → 0.5 px max step (0.1 px jerk) — the twitch is gone;
  walk 2.7 px, stop 4.1, sprint 6.5, stop2 7.6 (hand spring ≤ 22 mm), look-down/up 60/59 px (the 70 ms rig lag, as
  before), crouch/rise 20 px (spring at its 25 mm limit, settles in ≈ 0.3 s). 0 console errors.
- Gate run (00:00, same dist, Medium, playthrough.mjs; scratch/flash-hand/gate/, gate.log): ended=true C7 → title, beats
  B01…B13 in order, 0 deaths, 0 unstick rescues (strict), 0 frame errors, 0 console errors / exceptions. NOTE: the
  torch-on flag is not recorded (beamHits B05 frames 0 suggests the default stealth torch policy) → the strict torch-on
  gate is re-run at the end of part 2 (agent "hand" #3).

### Restart (agent "hand" #3, 2026-10-13 00:40–) — R1 (lead note 23:35) then closeout
- R1 = C2c 6.6–6.77 / 7.567–7.633 black (STATUS-smooth-verify "R1"; SMOOTH-FIX #145b diag rows: the stumble clip's lens
  0.70–0.73 m under the eye, 0.13–0.15 m above tread 12, in FRONT of riser 13 → the beam into the riser). clipcheck on
  the 23:38 arms.glb: stumble lens camera (−0.11, 0.55, −0.52) (run_torch: (−0.15, 0.51, −0.27)) — 25 cm lower than the
  run pose. SMOOTH-FIX's gaze aim (bindings.ts `beamClamp {gaze}`, 23:32) is in the tree but was never captured.
  Plan: capture C2c 6.2–7.9 on the combined tree first; if still dark, raise the clip's left landing so the lens clears
  tread 13's nosing (only the lens must clear it: both fists on tread 13 are out of reach from the e12low eye).
- PRE capture (00:57, dist-flash-hand 23:48 = my stumble IK + SMOOTH-FIX #145b gaze aim; scratch/flash-hand/r1fix/run.sh
  pre → r1fix/pre/C2c-0 (rows + XROW light pose), strip r1fix/strip-pre.jpg; 0 console errors):
  · 7.567–7.633 FIXED by #145b's 7.45 cue (luma 98.6 / 31.3 / 42.1, was 0.0000) — SMOOTH-FIX's half of R1.
  · 6.600–6.700 STILL BLACK: 4 frames, mean luma 1.5 / 1.3 / 2.6 / 2.9 (of 255). Rows: lens 0.12–0.15 m above tread 12,
    8–24 cm SOUTH of riser 13; the beam (aimed at the gaze point) hits riser 13 at 0.08–0.13 m from the lens, off the
    bottom of the frame (scratch/…/beamhit.py: screen y −1.9…−2.1). This half is the stumble clip's (mine).
  · tools (scratch/flash-hand/r1fix/stair.py, predict.py, beamhit.py, lag.py): lens vs the stair profile per captured
    camera pose (stair.py / predict.py / beamhit.py use the cutscene's stage model — one tread off, see FIX attempt 1).
- FIX attempt 1 (01:03 GLB, "post" capture 01:14): lens raised to camera (−0.12, 0.61, −0.28) "over tread 13". Result:
  6.600 lit (114) and 6.700 lit (75), but 6.633 / 6.667 STILL black (1.4). Cause: my first geometry model used the
  cutscene's treadNosing(k) — the REAL stair (blender/house/stairs.py: riser i at along (i−1)·0.28, tread i top
  z0 + i·0.219) is one tread nearer. With the real profile (scratch/flash-hand/r1fix/predict2.py <rows.json> '<lens keys
  JSON>' t0 t1; keys from scratch/flash-hand/lenskeys.mjs <arms.glb>; validated: it predicts INSIDE for
  exactly the black frames of both captures) the old torch head was 8 cm inside tread 13 and attempt 1's inside tread 14.
  From the e12low eye (0.63 m above tread 13, riser 14 0.33 m ahead) ANY lens ≥ 0.45 m ahead and ≥ 0.25 m under the eye
  is inside the steps at pitch −28…−35°.
- FIX 2 (final, clips_escape.py stumble_catch): the torch arm does not land — the free right glove catches the fall (as
  authored) and the torch is CLUTCHED to the chest: lens (−0.12, 0.38, −0.20) by clip 0.12 (C2c 6.58), held to 0.27;
  swung out to the pose glance #2 was re-verified with (old landing wrist (−0.20, 0.37, −0.47): light there unchanged)
  by 0.37, held to 0.99 (7.45); drawn in again for the turn back (lens (−0.13, 0.42, −0.22) at 1.12 — the old straight
  path to rest put the lens 3 cm inside tread 14 at 7.567) → rest 1.20. Baked path (scratch/flash-hand/lenskeys.mjs on
  the 01:24 GLB → predict2.py over the captured camera rows 6.5–7.7): lens 16–109 cm clear of the steps on every frame,
  line of sight to the gaze point on every frame (#145b's gaze aim lights the frame centre). The arms stay out of the
  L35 frame (lens 28° under the axis). assets --check ok (low 26.99 / 27 MB: the GLB size is unchanged).
- POST2 capture (01:33, dist-flash-hand rebuilt 01:31 from the tree with the 01:24 arms GLB; r1fix/post2/C2c-0, detect →
  r1fix/post2-detect, strip r1fix/strip-post2.jpg at display gamma; 0 console errors / exceptions). detect.py linear luma,
  pre → post2: 6.600 0.0002 → 0.339 · 6.633 0.0000 → 0.455 · 6.667 0.0002 → 0.500 · 6.700 0.0004 → 0.492 · 6.733
  0.030 → 0.361 · 6.767 0.061 → 0.302; glance #2 (6.8–7.45) and the turn back (7.5–7.67) unchanged (0.17 / 0.24–0.33 /
  0.045). R1 CLOSED: no black frame in C2c 6.2–7.9. The brief's C2c 7.6 still: pre 0.036 → post2 0.045 (f0042, the turn
  back to the flight; no glove in frame, the arms back on the run grip by 7.66).
- POSTMAX (01:50, Max, same window, dist rebuilt from the same tree; r1fix/postmax + postmax-detect; load 131 s, 0 console
  errors): no black frame in 6.2–7.9 (min linear luma 0.028); the stumble 6.600–6.700 = 0.147 / 0.202 / 0.258 / 0.292 (the
  flare is milder on Max: the whip's motion blur), glance #2 0.144–0.158, the turn back 0.33 / 0.42 / 0.10 / 0.054.
  HONEST RESIDUAL (AD): the stumble frames now FLARE instead — the camera drops to 0.7 m from the steps under C2c's
  fixed film exposure (0.458, tuned for surfaces 1–2 m away) and #145b aims the beam at the gaze point 0.4 m from the
  lens: the riser/tread at frame centre clips toward white for ≈ 5 frames (0.17 s; luma ≈ 0.5 vs the climb's 0.035 and
  glance #2's 0.17). Physically what a fixed camera does with a 2 kcd torch at 0.4 m; the pose can only move it ≈ −0.5 EV
  (a tighter chest clutch, lens→hot spot 0.47 m) — even a lens at the eye is 0.55–0.7 m away. If the AD wants it
  tamer, the lever is the cutscene's (a stop-down for 6.6–6.75, or the gaze-aim distance): request below.
- Round 5 — Max look after everything (01:10, hand-views on dist-flash-hand built 01:03 = all gameplay arms clips as
  final; scratch/flash-hand/r5/{sheet-max.jpg, abcrop-max.jpg = before | after, lower-left crops, gamma 1.8}; load 150 s
  on battery, 0 console errors): before = the claw draped over the barrel left of centre; after = a fist at the lower-left
  edge with the torch rising from it (bezel, knurl band, lens rim read), forearm entering from the lower-left. Same read
  as Medium r2. Still not photoreal: the glove is a black shape with no leather read in torch-lit rooms (ρ 0.035 under
  ≈ 0.5 lx of fill), the torch head reads as a dark rounded blob outdoors, and the forearm angle (elbow out at shoulder
  height) is visible looking down.
- GATE (01:36–01:40, final tree, dist-flash-hand built 01:31): `QA_STRICT=1 QA_TORCH_ON=1 node scripts/shot.mjs --no-build
  --dist scratch/dist-flash-hand --preset medium --timeout 2400 --scenario scripts/qa/playthrough.mjs`
  (scratch/flash-hand/gate2/, gate2.log; flags in scratch/flash-hand/r1fix/after.sh): ended=true C7 → title, B01…B13 in
  order, 0 deaths, 0 unstick rescues, 0 frame errors, 0 console errors / exceptions, load 36 s. typecheck clean, npm test
  322/322, assets --check ok (low 26.99 / 27, medium 53.80, max 77.14 MB), vite build + verify-boot OK. (On battery:
  no fps numbers claimed.) Dists dist-flash-hand / dist-flash-hand0 deleted after the run.
- Also found: the cutscene stage model (src/cutscenes/stage.ts treadNosing(k) = y0 + 0.28k) is one tread off the built
  stair (blender/house/stairs.py: riser i at along (i−1)·0.28) — eyeOnTread heights still land on the right tread (the
  eye is 0.14 m behind the model nosing), but every "riser 13 / tread 13 ahead" comment in c2c-up.ts is one tread off
  (the real next riser is 0.28 m nearer). Request below.

## Item 3 — THE LOOK PASS for ruling (ar) + beam re-measure (agent "look", contract #146c; 2026-10-13 01:40–)
Dists: scratch/dist-flash-before (HEAD 0ba616a = the live build, from the detached worktree scratch.nosync/wt-head,
node_modules symlinked) · scratch/dist-flash-look (the shared tree at 01:43: #146 + #146b + the lead's (ar) + every other
lane's uncommitted work). Work dir: scratch/flash-look/. Mac on BATTERY at the start (67 %): brightness numbers only.
NOTE for the A/B: the tree also has other lanes' rebuilt lightmaps (lm_*), props and the new arms GLB, so a difference in
a view with applied exposure >= 1 (dark rooms, lightning, C2 13.9 e 1.27) is NOT (ar) — those views are the control.
Plan:
1. scripts/qa/flash-look.mjs — one HEAD-compatible session per (dist, preset) from --beat B03: C2 3.0/9.3/13.9 → C2c
   7.1/15.5 (no input) → B05 Ada at 4 / 2.3 m in the core → gameplay stills (parlor, upper hall, U2, hall) → facade
   under a lightning pulse → a stepped U1 near-wall walk-in (every frame + rows: pull, lens px, applied) → C5 28.6 →
   C6 dawn → C7 14–19.5 stepped (cut latency) + sting. Per view: applied exposure, meter bind, displayed p5/p50/p98/clip.
2. The 9 gate views: before = scratch/lead-ship1 (built 10-12 08:03 from the tree committed as 0ba616a — same file set
   bar docs/ROADMAP.md): torch (Medium, QA_TORCH_ON) and max (strict); after = this lane's gate runs with the same flags.
3. flash-beam.mjs CONFIGS=old,new on dist-flash-look: U1 G1 U2 EXT + 2 new sites, DISTS incl. 0.3; pass = displayed
   pool centre never steps down > 8/255 as d falls (grain at white), settled evMax1s − evMin1s ≤ 0.1 EV, no walk dip.
4. detect: the walk-in (above) + C0 11–30 cuts (cs-frames on dist-flash-look) + C7 14–19.5.
5. Gate: typecheck, npm test, strict Medium (torch on) + Max playthroughs, 0 console errors.

### Round 1 (Medium, 01:53–02:10) — before = dist-flash-before (HEAD), after = dist-flash-look (tree 01:43); 0 console errors both
Tool: scripts/qa/flash-look.mjs (TAG=…, run via scratch/flash-look/run.sh); stats: node scratch/flash-look/compare.mjs
<before-look.json> <after-look.json>; sheets: scratch/flash-look/pairs.sh (before | after rows), crops.sh.
Sheets (before | after): scratch/flash-look/sheets/med-A1.jpg (B05 4 / 2.3 m, U1 wall 1 m, sewing room), med-A2.jpg (hall
candle, parlor, U2, upper hall), med-B1.jpg (C2 9.3, C2c 7.1, C2c 15.5, C5 28.6), med-B2.jpg (C6 20, C7 23.0 / 25.6, C2 13.9),
med-C.jpg (facade gate flash, drive dark / flash, U1 wall 0.5 m); native crops med-crops.jpg, med-c5c2c-crops.jpg.
JUDGE (harsh, biggest first):
1. MORE PHOTOGRAPHIC wherever the torch lights a near surface: the U1 wall at 1 m was a grey milky disc with no texture
   (centre p98 86/255, e 0.25) → a hot white core with a soft AgX falloff, the damask readable in the spill (p98 239, 0 %
   clip); C5 28.6 grey disc → hot core on the door frame, the green damask and the brass hardware read; the sewing room
   was near-black and veiled (p98 22) → the room reads (window, wainscot, boards) and the dress has a real hot spot; hall
   candle / parlor: the flames now have hot cores instead of grey haze; U2: the veil over the branches is gone.
2. True highlights: C6 20 (blue hour) went from a flat grey wash (p50 58) to a crisp dawn with mist depth (p50 101, p98
   238): the headlights' glare on the wet gravel clips 0.8 % — physical for a wet specular at 6 am. The AgX shoulder now
   compresses highlights instead of the old post-AgX linear dimmer.
3. Shadows: frames with e < 1 got slightly deeper toes (p5 0 in torch-lit rooms both before and after; no crushed mids).
4. B05 gown: LESS blown than the live build (2.3 m: centre p98 237 → 210, e 0.77 → 0.31 with the fixation protect
   binding; 4 m similar). The hot spot on the cotton is still a smooth white blob with a soft halo — not plaster-white
   blown, but no weave/fold detail inside the core. Under A/B (round 2: fixWhite 0.45 / 0.35 same frame).
5. Controls (applied e >= 1, (ar) cannot act): upper hall, C2 13.9, facade gate flash — identical within grain (the
   lightmaps rebuilt by other lanes did not move them). C7 23.0 / 25.6 differ because C7's timeline moved (another lane:
   c7-keeping.ts), not (ar). drive dark/flash: the live build's run had not converged (a storm strike froze its meter:
   ev 2.46 vs its own target 1.32); both builds bind the fixation protect there — not a regression.
6. C2c 7.1 (film-camera cue 0.458): the hand rail 0.25 m from the lens now clips with a glare streak (p98 163 → 234, clip
   1.1 %) — the honest result of a 2 kcd torch at 25 cm under a fixed exposure; the cue is not this lane's → request.
NEW GLITCH FOUND (#146 pull-in, this lane's): the stepped U1 walk-in (after-med/medium-walk, detect walk-detect/): pool
   centre rises monotonically 204 → 248 as the eye goes 3.0 → 0.5 m (no dimming), BUT at wall contact the torch head swept
   out of the bottom-left corner in ONE frame (f55: a blue-white sliver of lens glass; detect FLICKER 32; strip
   after-med/walk-strip2.jpg). Cause (offline scratch/flash-look/pullsim.ts, 30 fps): the pull target was probed every 2nd
   frame → a 15 Hz sawtooth (lens steps 7.2 / 3.6 cm alternating), and PULL_LIFT raised the drawn-in head into the corner
   with its glass facing the camera under the near-wall aim. FIX (arms.ts): probe every frame (5 BVH rays) + PULL_LIFT
   0.25 → 0: max step 7.2 → 5.3 cm, the lens leaves the frame 2 frames earlier at <= 27 px/frame @640 (was 59) and never
   creeps back into the corner; sprint 3.6 m/s 72 → 45 px. Unit test tests/arms-pullback.test.ts #4 (fails on the old
   logic: 9 sawtooth steps, 7.1 cm). Browser re-check: round 2.

### Round 2 (Medium, 02:12 rebuild of dist-flash-look with the arms fix; after-med2, 0 console errors)
- WALK-IN RE-CHECK (after-med2/medium-walk, detect walk-detect/, strip sheets/med2-walk-strip.jpg): the pull now ramps
  evenly (0.003 0.013 0.030 0.057 0.093 0.137 0.186 0.237 0.289 0.342 0.372 per frame — no sawtooth); the torch head
  leaves the frame through the bottom-left at <= 44 px/frame @640 with no glass sliver; detect FLICKER max 6.3 outside
  the lightning frame (f53 LT 0.83 — a storm strike through the U1 window), was 32.3 (f55, the sliver). Displayed pool
  centre 204 → 249 monotonic to contact; at contact the drawn-in lens moves the core 45 px up-right over 2 frames
  (was 60–80 px/frame) and the centre settles 249 → 237 (the lens 0.13 → 0.21 m off the wall: physically dimmer).
- fixWhite A/B (ALT fw45 / fw35 at every gameplay still; sheets/med2-fixwhite-ab.jpg): NOT a clean same-frame A/B —
  the B05 torch pool moved between the variants (Ada, the hand spring and the near aim keep moving at dt 1e-4 × 4) —
  but readable: 0.45 / 0.35 dim the room around the pool (u2 p98 45 → 39 / 25) and the near-wall core (u1w1 centre p50
  97 → 78) without giving the gown or the dress any weave or fold detail inside the core (the core is a smooth white disc
  in all three). DECISION: fixWhite stays 0.6 (no constant changed): after (ar) the gown is already LESS blown than the
  live build, and the missing texture in the core is the cookie's very concentrated core + the cloth materials, not the
  exposure. Honest residual below.

### Beam re-measure (Medium, dist-flash-look 02:12 = (ar) + #146 + #146b + this item's arms fix; scratch/flash-look/beam-med,
analysis `node scratch/flash-beam/analyze.mjs scratch/flash-look/beam-med med`, sheets beam-med/sheet-{old,new}-<site>.jpg)
- Sites: U1, G1, U2 (part 1) + K1 (kitchen south wall, damp plaster ρ 0.39 — the bright extreme) valid. EXT was never valid
  (P_TREE_2 at [11.5, 3.0] stands on its line: wall found at 1.16 m → skipped; part 1 never ran it) and D1 (front door
  leaf) was skipped because rayDistance ignores door leaves → flash-beam.mjs now uses collision.sightDistance (closed
  leaves count) and EXT moved to y 4.6: re-run as beam-med2 (EXT + D1).
- PASS (cfg new, pass = no step down > 8/255 as d falls, i.e. grain at white): displayed pool centre U1 195 → 208 → 229 →
  238 → 237 → 241 → 241 → 238 (4, 3, 2, 1.5, 1, 0.7, 0.5, 0.3 m), G1 198 → 205 → 229 → 237 → 240 → 239 → 242 → 238, U2
  200 → 202 → 221 → 240 → 237 → 241 → 240 → 237, K1 (3 m start) 217 → 227 → 234 → 236 → 240 → 242 → 241. Worst step −3.4
  (G1 0.3 m, at white: from 0.5 m in the hand holds the lens at the 6 cm margin + knee, so the irradiance is pinned by
  construction and the last step is grain). Walk-ins at 1.6 m/s (collision on): NO drop at any site (U1 197 → 240, G1 196
  → 239, U2 182 → 242, K1 210 → 243; K1 one −4.3 step at 0.89 → 0.73 m at 245, grain), lens ≥ 0.134 m off the wall.
  Control: cfg old goes BLACK at ≤ 0.5 m at every site (lens through the wall: centre 0, 270–330 arm vertices behind it).
- Pumping: no oscillation anywhere. Settled EV over the last 1 s of each 3 s hold moves ≤ 0.16 EV and always ONE way (ev at
  an end of the window, drifting to its target). Residual: at ≈ 0.7 m (U1, K1) the aimed hot core sits up-right of the
  frame centre (sheet-new-U1.jpg d=0.7; the near aim is at AIM_MAX 50°) → the fixation disk (r 0.15) misses it, the
  protect half-releases and the target rises ≈ 1 EV (U1 −3.24 → −2.0): standing still there, the pool brightens at the
  6 s brightening τ (+0.16 EV in the measured second). Not a dimming; this lane's follow-up (centre the fixation disk on
  the beam hit in the near zone) — not changed in this pass.
- Arm vertices behind the wall at eye 0.3 m (noclip, inside the 0.27 m capsule reach): 1869–1927 (part 1: 1420–2660 at
  0.35/0.25) — occluded by the wall, not visible; the walk-ins (collision) stop at 0.27 m with the lens ≥ 0.134 m clear.

### New sites EXT (moved) + D1 (front door) — beam-med2 (dist 02:12), and a FOUND GAP at closed doors
- The analytic-plane "centre" sample misses the hot core on relief surfaces (clapboard) and on the recessed door leaf at
  ≤ 0.7 m (the red circle sits beside the core in beam-med2/sheet-new-D1.jpg). Measured instead: the core's displayed
  PEAK (max of the 7×7-blurred luma, scratch/flash-look/corepeak.py) per settled point 4 → 0.3 m:
  EXT 208 214 230 238 240 242 245 246 (PASS, monotonic) · U1 193 207 228 237 238 241 241 238 · K1 216 227 234 240 241 242
  242 · D1 208 208 207 210 **195** 203 197 225 (FAIL: −15 at 1 m, flat 1.5–0.5 m instead of rising).
- Cause (flashlight-bounce.ts, this lane's): the beam hit used the collision OCTREE only — closed door leaves are dynamic
  blockers (collision.sightDistance), so at a shut door TORCH_WORLD.hitDist was the wall behind it (G = 0 in every D1
  row: no near-pool adaptation — the meter swallowed the whole approach, the old camera behaviour) and the bounce light
  sat on the far side of the leaf. FIX: after the octree hit, sightDistance (≤ that distance) — a nearer leaf becomes
  the hit (normal = −beam). tests/torch-door-hit.test.ts (2; the door case fails on the old code: hitDist 4 vs 1).
  npm test 325/325, typecheck clean. Browser re-check on scratch/dist-flash-look2 (02:40): beam-med3 (D1, EXT, U1).

- RE-CHECK (beam-med3 on dist-flash-look2 = the door fix, cfg new, 0 console errors; sheet sheets/d1-doorfix.jpg = top
  after / bottom before the fix at 1.5 / 1.0 / 0.7 m): D1 now gets the near adaptation (G 0.5 → 6.0, was 0) — EV at
  1.5 / 1 / 0.7 m −3.25 / −3.05 / −2.14 (was −4.82 / −4.68 / −3.68): the pool at the door is 1–1.6 EV brighter and grows
  as you approach. Core peak / mean within 24 px of it, 4 → 0.3 m: D1 209/146 214/144 232/166 240/175 229/161 228/187
  242/221 236/214 (before the fix 208/143 208/136 207/138 210/130 195/111 203/153 197/146 225/191). The remaining −11 at
  1.0 m is the core landing on the leaf's centre stile (the dark vertical groove through the core in d1-doorfix.jpg top
  middle) — EV is HIGHER there than at 1.5 m, so it is the door's relief, not the meter. EXT (moved to y 4.6) 207 213 230
  238 240 242 245 246 and U1 193 208 229 236 241 237 242 238: PASS. (The analytic-plane "centre" column of
  flash-beam.mjs is not valid on relief surfaces — it samples beside the core; use corepeak.py / corepool.py.)

### Cut latency (real route, CDP frames: gate-med = cs-frames STOP=0 SCENE=C0,C7 on the Medium gate run)
- C0 (gate-med/C0-0, 571 frames, detect C0-0-detect): cuts 12.533 / 19.0 / 26.0 / C1 0 — the new exposure is ON the cut
  frame (linear luma 12.533: 0.0142 → 0.0063 flat; 19.0: 0.0013 → 0.0274, then a 10 % ease over 4 frames; 26.0: 0.0002 →
  0.0146). Part 1 measured cut +1 (cuts2); every C0/C7 cut now carries SMOOTH-FIX #145's `cutE` exposure cue (the
  incoming shot's exposure on the cut frame: c0-road.ts 12.5/19.0/26.0, c7-keeping.ts 15.8/18.6/…) — 0 frames; this
  lane's meter cut path (1b) is the fallback for cuts without a cue.
- C7 15–19.5 (gate-med/C7-1, 137 frames): 15.833 0.0026 → 0.0093, 16.833 0.0065 → 0.0051, 18.6 0.0122 → 0.0170 — each
  flat from the cut frame (≤ 5 % drift over 4 frames). The flash-look `-c7` stepped dirs are NOT evidence (g.capture()
  re-renders after the post-render meter snap).

### Gate (Medium) — 02:26–02:31, the Mac went onto mains at 02:31
- typecheck clean; npm test 323/323 (the new sawtooth test included); assets --check ok (low 26.99 / 27, medium 53.80,
  max 77.14 MB); vite build + verify-boot OK (dist-flash-look 02:12 = the tree under test).
- Strict torch-on playthrough on Medium = playthrough.mjs wrapped by cs-frames STOP=0 (all gate asserts kept; frames
  stepped only inside C0 11–30 / C7 15–19.5): `[scenario] done: ended=true beat=B13 game=535.83s wall=291s deaths=0`,
  `console errors: 0 · exceptions: 0`, exit 0 (scratch/flash-look/gate-med.log).
- Gate views vs the live build (scratch/lead-ship1/torch-*, built 10-12 08:03 from the tree committed as 0ba616a; same
  flags): sheets/med-gate.jpg — C1 car, armoire slats, upper hall Ada identical (controls); C5 shadow play: the milky veil
  over the left half is gone, the door frame and costume read crisp; C6 dawn drive: muddy grey → a readable blue dawn
  with mist; Harlan bedroom: different bot pose (the torch 0.3 m from the door jamb blows it white — physical). The
  cs-frames wrapper did not take the facade-flash / final views (the Max gate run is the plain playthrough).

### Max (after) — after-max (dist-flash-look 02:12, 0 console errors; sheets/max-after.jpg)
- Same read as Medium (the exposure path is shared): B05 2.3 m e 0.31 (fix) centre p98 210 / 0 % clip; U1 wall 1 m hot
  core p98 242; sewing room / U2 / hall read; C5 28.6 hot core on the door frame with the open front door's blue night
  behind (centre p98 237, 0.9 % clip); C6 20 crisp blue dawn (p50 100 / p98 237, headlight glare 0.79 % clip); C2c 7.1 the
  same rail glare (p98 235, 1.14 % clip). Controls (upper hall e 1.05, gate flash e 5.3) unchanged.

- Max GATE (queued 02:54, ran → 03:12, dist-flash-look2 = the final tree incl. the door fix; plain playthrough.mjs, QA_STRICT=1 as
  lead-ship1 'max'; scratch/flash-look/gate-max.log): `[scenario] done: ended=true beat=B13 game=599.27s wall=411s
  deaths=0`, `console errors: 0 · exceptions: 0`, exit 0. 9 gate views vs the live build (lead-ship1/max-*):
  sheets/max-gate.jpg — C1, armoire, upper hall Ada, final card identical (controls); facade flash: same frame, the claw
  → the torch fist; C5 shadow play: the milky veil over the left half gone, the door frame crisp; C6 dawn: muddy grey →
  a readable blue dawn with mist depth; Harlan bedroom / C2 parlor: same read.

- DIST NOTE (what was looked at vs what was gated): the Medium/Max look stills (after-med2 / after-max), beam-med, beam-med2,
  the Medium gate (gate-med) ran on dist-flash-look built 02:12 (= (ar) + the arms fix, WITHOUT the door hit fix); the
  door fix (flashlight-bounce.ts) is in dist-flash-look2 (02:40), checked by beam-med3 and the Max gate only. The door
  fix moves TORCH_WORLD.hitDist + the bounce light (and TORCH_POOL, which lights the Medium glove sheen) onto a closed
  leaf in the beam — NOT re-looked: C2b (knock), C4a (door gives), the B10 passage door with the torch on the leaf;
  one still each is recommended. The gameplay stills here have no closed leaf in the beam (the parlor door is ajar).

- Max BEFORE look (before-max) DROPPED: queued 03:12, still blocked at 03:35 behind another lane's Blender render and a
  re-verify run — killed cleanly. Max "before" = the 9 gate views of the live build (lead-ship1/max-*, sheets/max-gate.jpg);
  the Max torch-lit stills (B05, U1 wall, sewing, U2, C5, C6) are AFTER-only, judged against Medium's before (same
  exposure path; Max after-stats track Medium's within a few codes). Dists + the HEAD worktree removed at the end.

### Item 3 — FINAL JUDGE (harsh AD, biggest first) + what is left
1. (ar) makes Medium and Max MORE photographic wherever exposure < 1 — every torch-lit gameplay view and most cutscenes:
   real hot cores with an AgX shoulder instead of grey discs, the room around the pool readable, candle flames with hot
   cores, C5's milky veil gone, C6 a crisp dawn. No torch-lit view got worse; controls (e ≥ 1) unchanged.
2. The user's complaint is closed on walls AND (new) closed doors: displayed pool rises 4 → 0.3 m at U1 G1 U2 K1 EXT,
   D1 after the door fix (residual −11 at 1 m = the leaf's centre stile under a 2 cm core); walk-ins never dip.
3. Still NOT photoreal (honest): (a) the hot core on CLOTH (B05 gown 2.3 m, the sewing-room dress) is a smooth white disc
   with a soft halo — less blown than the live build (p98 237 → 210) but no weave/fold inside the core; lowering
   fixWhite does not add texture (A/B) — it needs the cloth materials' micro-detail or a less concentrated cookie core;
   (b) C2c 7.1's rail glare under the fixed cue (other lane); (c) at ≈ 0.7 m from a wall the near aim saturates (AIM_MAX
   50°), the core leaves the fixation disk and the exposure creeps up ≈ 1 EV at τ 6 s if you stand still (no dimming,
   no oscillation; this lane's follow-up: centre the fixation disk on the beam hit in the near zone); (d) the glove is
   still a near-black shape in torch-lit rooms (HAND request 1); (e) the torch head reads as a dark blob outdoors.
4. Motion: the pull-in's one-frame lens-glass sliver at wall contact is fixed (FLICKER 32 → 6); the core still slides
   ≈ 45 px @640 up-right over 2 frames when you bump the wall (smooth, continuous). Sprint (3.6 m/s) verified offline only.
5. Not measured: fps (the session ran on battery until 02:31); the beam curve on Max (Medium only — same exposure path).

## Requests for the lead (LOOK, #146c)
1. Route the "For other lanes" (LOOK #146c) items: C2c 6.8–7.4 cue stop-down, C6 20 level sign-off.
2. Approve a follow-up for this lane: near-zone fixation disk centred on the beam hit (item 3c above) — needs one
   browser A/B (flash-beam U1/K1 at 0.7 m, stand-still 10 s) before shipping.
3. Cloth under the torch core (item 3a): MATERIALS lane — cotton/linen micro-normal + roughness variation for Ada's
   gown and the dress (the torch can't add texture the albedo/normal maps don't have).
4. HAND requests 0 (exporter quaternion bits) and 1 (glove albedo) still stand.
5. One still each of C2b (knock), C4a (door gives) and the B10 passage door with the torch on the closed leaf: the door
   fix moved the torch bounce / TORCH_POOL onto the leaf there (physically right; not re-looked — see DIST NOTE).

## For other lanes
- PERF/FRAMES (working tree, not mine): the current tree logs 73 × "THREE.WebGPUBackend: copyFramebufferToTexture:
  Source and destination formats do not match. rgba16float bgra8unorm" at load during the reflection capture
  (smoke run scratch/flash-beam/smoke/med-report.json, 754 s, before any scenario code) — most likely the uncommitted
  blood-fx.ts stain change (viewportOpaqueMipTexture drawn into the rgba16float cube capture). GONE on the 17:05 tree
  (fix1 / b05-fix: 0 console errors).
- MATERIALS (lead to route): C2c 9.3 and every torch hot spot on U1's wallpaper — speckle shimmer frame to frame =
  specular aliasing of the wallpaper's normal/roughness under the 2 kcd point light. Not fixable in the torch (the
  cookie scales diffuse and specular together): needs specular AA in the wallpaper/lightmap material (geometric
  roughness from the screen-space normal variance, Kaplanyan/Toksvig).
- (DONE) STORY: `arms.cutsceneHold = camHeldByCutscene` is wired (story-runtime.ts:755).
- FRAMES: C2c's "light inside the wall" frames can opt into the pullback with `arms.pullInClamp = true` from the cue.
- PERF (pipeline.ts owner, lead to route; optional): zero-frame exposure at cuts needs a GPU meter — a log-luminance
  reduction of the scene pass to 1×1 sampled by the output pass on a snap frame (the CPU meterTarget() protects then
  refine it 2 frames later). Today a cut shows 2 frames at the pre-cut EV (1b above).

- (HAND #146b) ANIM / CINE owners of non-arms clips: none needed. Cutscene owners: the arms' rest pose changed (the
  torch grip), so any cue that relied on the OLD idle fist position in frame should be re-looked: checked here C1 30 s,
  C2c 7.6 / 11.4 / 15.5 (all better or unchanged). Not checked: C6 pour/key (wheel ↔ torch now switches without a
  crossfade: CAR_CLIPS), B11 locket hold in its real context (the lens is 4 cm further from the eye; the clip's own frame).
- (HAND) PERF: none — the glove sheen change is the same op count; no new passes/materials.

- (HAND #3, R1) FRAMES / SMOOTH-FIX (c2c-up.ts, bindings.ts — not mine): (a) the stumble 6.6–6.75 is now lit but flares
  (≈ 0.5 linear luma for 5 frames, see R1 POST2): if it should read tamer, stop the film camera down for those frames or
  aim the gaze beam a little past the gaze hit; (b) `torch_knock` (6.64) now has no torch contact (the torch is clutched;
  the right glove slaps the tread) — keep it as the torch bumping the stair edge or drop it; (c) stage.ts treadNosing(k)
  is one tread off the built stair (riser i at along (i−1)·0.28): the real riser ahead of e12low is 0.05 m away, not 0.33;
  (d) glance #2 (7.1): the frame is the balusters 0.3 m from the eye, lit hot by the torch 0.25 m from them, and her hand
  is not in the frame at 7.1 (framing, unchanged by this lane).

- **[WITHDRAWN 2026-10-19 — the cause was this lane's flashlight.ts (stale cookie uniforms), fixed in Fixer round 3 /
  #146e; do NOT stop the cue down or move BEAM_CLAMP.at]** (FIX part 2, V4 — C2c cue owner: FRAMES / SMOOTH-FIX; c2c-up.ts / bindings.ts, not this lane's files) the stumble
  6.58–6.75 is a one-frame ×8 luma jump (0.043 → 0.340 at 6.6) into ≈ 5 near-white frames on Medium (0.15–0.30 on Max):
  #145b's gaze clamp aims the clutched torch at riser 13 ≈ 0.4 m from the lens under C2c's FIXED film exposure 0.458 —
  E = I·σ²/(σ²d² + D²/8) ≈ 8.1 klx (flashlight.ts near field) on a dark tread (ρ ≈ 0.1) ≈ 120 pre-AgX = white. No pose
  the clutch allows moves it more than ≈ 0.5 EV (HAND #3). Lever: stop the cue down 2–3 EV for 6.58–6.75 (ramped over
  2 frames each side), or move BEAM_CLAMP.at past the tread (≥ 1.2 m from the lens) for those frames.
- (LOOK #146c, the (ar) look pass — cutscene owners / FRAMES / SMOOTH-FIX, not this lane's files):
  (a) C2c 6.8–7.4 (glance #2, film-camera cue 0.458): the hand rail 0.25 m from the lens now clips with a glare streak
      (p98 163 → 234, clip 1.1 %; sheets/med-c5c2c-crops.jpg bottom) — the honest (ar) result of a 2 kcd torch at 25 cm;
      if it should read tamer, stop the cue down ≈ 1 EV for 6.8–7.4 or aim the gaze beam past the rail.
  (b) C6 20 (blue hour): now ≈ 1.3 EV brighter on screen than the live build (p50 58 → 101, p98 103 → 238; the old
      post-AgX dimmer is gone) — crisp dawn with mist depth, headlight glare on the wet gravel clips 0.8 %. AD to confirm
      the level; the cue's exposure is the lever (sheets/med-B2.jpg row 1).
  (c) C7 23.0 / 25.6 show different shots on the live build and the tree (C7's timeline moved in c7-keeping.ts) — not
      (ar); compare same shots, not same clocks.
  (d) HAND numbers: PULL_LIFT 0.25 → 0 changes the drawn-in pose at walls (fist at the chest, not the chin), so the
      hand-views 'wall' bbox/lens rows from #146b no longer match.

- (FIX part 2 round 3, NEW-G1 hop — PLAYER lane, src/player/controller.ts, not this lane's file) the 0.2 m camera hop
  walking into P_MIRROR_HALL hugging the G1 east wall is the step-up accepting an EDGE REST on the marble slab's 1 cm lip
  (the slab's box is 1 cm wider than the frame's): feet +0.19 m ≤ STEP_MAX, then it slides off and falls, 3× a second.
  Proposed fix (scratch/flash-fixr3/controller-patched.ts, +12 lines in step()'s STEP_LIFTS loop, off the designed
  stairs only): after `trial.translate(move)` clears, also require the lifted capsule to fit STEP_TREAD = 0.12 m further
  along the move (`trial` moved by move·(0.12/|move|), capsuleIntersect → `continue`, moved back). Evidence: real
  geometry + the real controller in node 15 hops → 0; tests/collision-stairs.test.ts 19/19 on the patch + a new
  "1 cm lip in front of a wall" test (real: eye 0.238 m in one frame; patched 0 — copy it from
  scratch/flash-fixr3/collision-stairs-patched.test.ts); a house-wide sweep of every prop collider: 322 → 105 hops, none
  added, every changed walk a hop site (mirror, P_STOOL, P_BUCKET, the U3 stove / dress form). Alternative (data):
  give the slab's box the frame's width in the prop (blender/props/furniture.py mirror_crepe: `box(W + 0.1, …)` → W)
  — fixes this one mirror only.

## Requests for the lead (HAND, #146b)
0. (smooth motion, all characters) blender/lib/export.py or blender/anim/build_anims.py (lane A): Blender 5.2's glTF
   exporter quantises EVERY animation rotation to 8 bits (io_scene_gltf2/io/exp/meshopt.py QUAT_FILTER_BITS = 8 →
   0.4–1.1° steps: stop-motion micro-stutter on slow motion, worst on the FP arms and on Ada/Harlan close-ups). Set
   `io_scene_gltf2.io.exp.meshopt.QUAT_FILTER_BITS = 12` (0.04°) — or 16 — before the character exports (module
   constant; the encoder reads it per call), then re-run the anims job and check the Low budget (≈ 10 KB headroom: the
   vertex codec compresses the extra bits; measure). The arms' slow loops are already low-passed at load (arms.ts
   smoothQuaternionTracks); with more bits that becomes a no-op and can stay as a guard.
1. Glove albedo (material-spec `leather_worn`, applied in src/characters/skin.ts — not this lane): the arms render at
   ρ 0.035/0.022/0.015 (near-black). Real dark-brown driving-glove leather is ≈ 0.05–0.08; in torch-lit rooms the glove
   is a silhouette either way (≈ 0.5 lx of fill vs a ≈ 400 lx pool = −12 EV), so this only matters in candle/lamp-lit
   rooms and outdoors. Optional; a 1.5–2× brighter glove would read as leather rather than a black shape there.
2. The forearm enters from the LEFT edge when looking down (the solved grip holds the elbow out at shoulder height —
   the only physiological way to hold a forward beam with the fist at chest height in view). If the AD prefers the
   elbow down, the price is the fist lower (out of frame in level views) — a design call, not a bug.

## Requests for the lead (BEAM)
1. (DONE by the lead: ruling (ar), contract #149) APPLY THE ROOT-CAUSE FIX in src/render/pipeline.ts (PERF lane's file; one line, ~line 526 of the post chain):
   `hdr = grade4(hdr.mul(uniforms.exposure));` → `hdr = grade4(vec4(hdr.rgb.mul(uniforms.exposure), 1));`
   (r186 RenderOutputNode unpremultiplies alpha before AgX and premultiplies after; the exposure must not touch alpha).
   Proven on scratch/dist-flash-fix (built from the private copy scratch/flash-fix-src). Without it #146 cannot meet
   the brief on Medium/Max: the displayed pool gets darker near walls in every config.
2. After it lands: a full-route AD look pass on Medium + Max (every frame with exposure < 1 changes) and a B05 2.3 m
   gown call (fixWhite/fixPct are this lane's if it needs taming); re-run scripts/qa/flash-beam.mjs CONFIGS=old,new.
3. (DONE by the lead: story-runtime.ts:755) STORY: wire `arms.cutsceneHold = camHeldByCutscene`.


## Lead notes for the FLASH part-2 agents (2026-10-12 23:35), from the ship-verify re-verifier (STATUS-smooth-verify "## Re-verify")
- NEW black frames at C2c 6.6–6.77 (the stair whip, 6 frames) and 7.567–7.633. The torch hangs 0.4–0.7 m below the
  eye; in the 19:50 capture it was within 0.1 m. That points at THIS lane's 22:17 arms.ts change or the regenerated
  arms assets. `arms.cutsceneHold` IS wired now (story-runtime.ts, lead #149), so check the arms clips' torch height
  under the C2c cue. Treat this as a user-visible finding: fix it, then prove it with a stepped C2c 6–8 s capture +
  detect (scratch/reverify/run.sh has the capture command).
- The wallpaper sparkle under the torch hot spot (C2c 8.5–11) is still present: specular aliasing in the hot core.

## Verify (part 2) — INDEPENDENT ADVERSARIAL VERIFIER (agent "verify", 2026-10-13 03:36–; edits nothing in the project)
Snapshot under test: the shared tree at 03:44 (`git stash create` 9aeeecf6, 119 files changed vs HEAD 0ba616a; other
lanes keep editing — every claim below is about THIS snapshot) → dist scratch/dist-flash-verify (vite build 03:44,
verify-boot OK). Work dir scratch/flash-verify/ (own scenario verify.mjs + ana.py; the builders' tools untouched).
Mac on mains (charging) at the start.
- Offline gates (03:45): `npm test` 325/325 pass (test.log) · typecheck clean (tsc.log) · `assets.mjs --check` ok — low
  26.99 / 27 MB (≈ 10 KB left), medium 53.80, max 77.14 (assets-check.log). CONFIRMED.
- Run A (Medium) queued 03:50 behind the JUMPSCARE lane's Cycles render (scare-look round 10).
- Run A (Medium, 1280×800, 03:56–04:12, exit 0, **0 console errors / 0 exceptions**, load 35.8 s; scratch/flash-verify/runA/,
  runA.log): flash-look route+views+facade+C5/C6 stills on the verify dist (my "after"), settled beam points at NEW sites
  (U3N sewing-room north wall, G3E kitchen east wall, G3N kitchen north planks, PD porch → bolted front door outside, PW
  porch clapboard, U4T back-stair landing → wardrobe-back leaf, U3O 45° oblique), CDP-stepped walk-ins at all 7 +
  sprints (U3N, PD), baluster pans, ST_MAIN + ST_BACK climbs, F toggles (dark 10 s off / parlor / rain), fast turns,
  crouch + floor, the 0.85 m landing, fps. Analysis: scratch/flash-verify/ana.py (pool stats from the CDP frames) +
  detect.py (det-*/).
  · WALK-INS (the real player case): displayed pool RISES as you approach at every new site — G3E centre 213 → 255
    (worst step −2.6), U3N worst −3.7, PW −5.2, G3N peak −1.5, sprint U3N −5.4. PD (front door, outside): the core PEAK
    falls 243 → ≈ 100 between 1.3 m and contact, but the strip (strip-walk-PD.jpg) shows the far "peak" is the brass
    knocker's glint; the pool on the leaf grows and brightens (annulus 47 → 126) — not the user's dimming. EV never
    oscillates (one-way drift in every walk).
  · CONTACT POP (every flat-wall site): at wall contact a thin bright arc of the torch's lens glass still shows at the
    bottom-left for 2 frames (G3E f55–56, PW f34–35; strip-g3e-contact.jpg, strip-u3o-pw.jpg), then the hot core jumps
    up-right ≈ 85 px @1280 per frame for 2–3 frames with a TAA double image of the core (G3E f59–60). detect FLICKER at
    contact 17–20 (U3N/G3E/G3N), 28 (PW), 35 (U3O oblique), 21 (sprint PD) — LOOK's "FLICKER max 6.3, no sliver" is NOT
    reproduced at these sites.
  · SETTLED POINTS in run A are INVALID for exposure (my harness, not the game): runA2 (meter.mjs, per-frame
    `look.exposure()` incl. last.t) shows that with the loop stopped and frames stepped by `advance()` the WebGPU
    readback starves — readings land 1 s, 2 s, 4 s apart (frames 30 / 90 / 210), so a settled point shows the
    feed-forward on a STALE reading (run A's "white-outs" at G3E/PD 1.5 m, EV +3.5/+4.3, are that). The CDP-stepped
    walk-ins (≥ 100 ms real time per frame) are not affected. CAVEAT for every advance()-driven tool (flash-beam.mjs
    settled EV, hand-views/flash-look settles): their exposure is the snap reading + feed-forward, not the live meter.
    Settled points re-run in REAL TIME (rAF loop) as run A3; Max run B uses the same real-time settle.
  · F toggle (rows f-dark/f-parlor/f-rain; strip-fdark.jpg): after 10 s dark, F → the first 6 frames (0.2 s) are a
    milky full-frame white-out (frame mean 1 → 145/255, window/dress blown, veil to the ceiling), readable by 0.6 s
    (mean 44), settled by ≈ 2 s (mean 10). Parlor / rain: +80 % then settle in ≈ 1.5 s. No step, no pump.
  · Fast turns (180° in 0.27 s, 90° in 0.1 s; strip-turns.jpg): the torch lags up to 360 px @1280 and swings past the
    frame centre, back in ≈ 5 frames, no pop; the forearm then lies flat along the bottom edge (reads as a dark stick).
  · Crouch + floor (−80°) and the 0.85 m landing (crop-hands-med.jpg, gamma-lifted): both fists read as gloved hands
    (torch fist wraps the barrel; the free right hand loosely curled), no floor/wall penetration on screen (arm
    vertices behind the landing wall only off-screen, minS −8 cm, hidden by the wall).
  · ONE fully black screenshot incl. the HUD (stair-back f20) — the DOM HUD is missing too, so most likely a CDP capture
    artifact, not a game frame; not reproduced elsewhere in 2 300+ frames.
### Verify restart (agent "verify" #2, 05:41–) — run B (Max) was killed at 04:37 after look1 + U3N/PD/U4T-1.5 settled
points (its stills/rows are valid: real-time settle); A3/C/D/E never started. Queue re-ordered so the gate runs first:
scratch/flash-verify/chain2.sh C A3 B2 D E (C = strict torch-on Medium gate + C1 29.5–30.5 / C2c 6.2–8.0 + 15.2–15.8
frames; A3 = Medium real-time settled points + real-time walk-ins; B2 = Max remainder + hand/hand2/look2; D = Max HEAD
"before"; E = Max strict gate + C2c stumble frames). verify.mjs rows now also carry `lever` (|lens − wrist|), `miss`
(beam-axis hit ↔ gaze hit, m) and a per-sample meter trace on the 0.7 m hold. New offline tools: gaze.py / gazewalk.py
(displayed luma AT THE GAZE = fixed frame centre, which every earlier metric — plane/pool-centred — could not see).
- FOUND (Max, settled real-time, run B; sheet-maxU3N.jpg, sheet-maxPD.jpg, runB/max-PD-d0p7.jpg):
  · NEAR-WALL AIM OVERSHOOT: the hot core rides from below the gaze (1.5 m) to ≈ 100–150 px @1280 ABOVE-RIGHT of it at
    0.7 m, then back onto it when the pull engages (0.4 m). Beam-axis screen y − centre at U3N: +82 (3 m) +54 (1.5) −34
    (1 m) −100 (0.7) −38 (0.4) +7 (0.25); PD: +61 +66 −47 −130 +1 −31. At the front door 0.7 m the barrel visibly cocks
    ≈ 45° up and the pool sits on the transom while the knocker you look at is in its dim lower edge.
    Cause (code + rig): arms.ts poseArm() solves the aim rotation _qr from the lens position T toward gazeP, then applies
    it to the HAND's world quaternion — the hand turns about the WRIST, so the lens (child of hand_l via `flashlight`,
    rest |lens − wrist| = 0.204 m from public/assets/max/arms.glb) swings by (R − I)(lens − wrist) and the beam passes
    the gaze point by that offset (≈ 2 sin(θ/2) · 0.20 m ≈ 0.12–0.15 m at θ ≈ 35–40°; measured ≈ 0.12 m at U3N 0.7 m).
    This (not AIM_MAX saturation) is also why LOOK's item 3c sees the core leave the fixation disk at ≈ 0.7 m.
    OFFLINE PROOF (scratch/flash-verify/aimsim.ts = the tests/arms-pullback.test.ts harness, lens 0.2 m ahead of the
    grip, settled 2 s per distance): beam hit − gaze point (x right, y up) at D = 1.25 / 1.0 / 0.85 / 0.7 / 0.6 / 0.5 m:
    (−2, −3) / (+4, +8) / (+9, +16) / (+7, +13) / (+4, +6) / (+2, +3) cm — it overshoots ABOVE-RIGHT by up to 18 cm while the
    lens swings 15 cm up-right ((−0.135, −0.235) → (−0.059, −0.102)). The existing unit test only asserts a < 9.5 cm miss
    at D 0.6, so it passes. Fix (arms.ts poseArm): pivot the aim about the LENS — after _qr, shift the IK target by
    −(R − I)(lens − wrist) — or re-solve _qr from the rotated lens 2–3 times; test |miss| < 2 cm for D 0.5–1.25 m.
  · LUMA AT THE GAZE is not monotonic on the approach although the pool as a whole brightens: Max U3N 9 → 81 → 206 →
    **136** → 235 → 247 (3 / 1.5 / 1 / 0.7 / 0.4 / 0.25 m), PD 51 → 149 → **111 → 94** → 173 → 156. Medium walk-ins
    (run A CDP frames, gazewalk.py): U3N 199 (1.0) → 253 (0.85) → **197 (0.69)** → 253 (0.58); G3E 251 → **201** → 253;
    PD 242 (1.0) → **95–128 from 0.84 m to contact** (the hot spot climbs onto the transom; the door you look at stays
    mid-grey). The pool-centred metrics (planePx, LOOK's corepeak) all pass because they follow the beam, not the eye.
  · EXPOSURE PUMP while standing still 0.7 m from the U3N wall (Max, 13.4 s hold, real time): EV −4.37 → −3.75 slowly
    (≈ 5 s), then −3.75 → −4.39 in ≈ 1 s, up again, down again — 0.66 EV peak-to-peak, 4 reversals, period ≈ 6–7 s
    (a 1.6× brightness breathing of the whole frame). PD's 0.7 m hold is one-way (+1.1 EV in 13 s: the "creep" LOOK
    reported). LOOK's "EV swing over the last 1 s ≤ 0.16, one-way" used a 1 s window, too short to see it.
  · Settled 0.4 m (pull 0.17) at the front door: a bright crescent at the lower left, ≈ 90 px wide (crop-sliver-max.jpg)
    — steady, it reads as the torch's bezel lit by the door 15 cm away (plausible); at U3N 0.4 m it is a faint rim.
    Not the one-frame contact pop (that stands as found in run A: FLICKER 17–35 at G3E/U3N/G3N/PW/U3O).
  · Max outdoors (gate/drive, look1): the volumetric beam (flashlight.ts, Max only, 12 fixed steps over the 14 m cone,
    no jitter) draws a LADDER of 5–6 evenly spaced bright bars just beyond the torch head on the wet path
    (crop-ground-beam.jpg) — raymarch banding of the near-lens peak; in HEAD too (not a part-2 regression).
  · Lightning (Max, gate-flash vs gate-dark, sheet-max-lightning.jpg): e 5.79 both (control, (ar)-neutral); the strike
    lifts the frame to p50/p98 65/124, clip 0 % — a soft day-for-night fill with no over-exposure and no hard shadows.
- npm test on the CURRENT tree (06:05): 339/339 pass (test2.log).
- Hand motion (run A, Medium): fast turns (675°/s) — torch lags ≤ 363 px @1280 and returns critically damped (no
  overshoot past rest; rows 13–34, 43–59, 63–78 monotonic); F after a 10 s dark-adapt (sewing room): frames 11–17
  (0.23 s) at the dark EV (+4.58, mean 118–146/255, centre clipped), then −0.5 EV/frame to e ≈ 1 by 0.6 s.
- GATE C (Medium, strict, torch on, snapshot dist, 05:57–06:03; runC/, runC.log): ended=true at the title (B01–B13 in
  order), 0 deaths, 17/17 assertions ok, **0 console errors / 0 warnings / 0 exceptions**, exit 0. CONFIRMED.
  · C2c 6.2–9.0 on the route (runC/C2c-1 + C2c-1-detect): NO black frame (min linear luma 0.032). The stumble luma is
    frame-for-frame the HAND lane's POST2 numbers (6.600 0.340, 6.633 0.455, 6.667 0.500, 6.700 0.493) — CONFIRMED —
    but it is a one-frame ×8 jump (0.043 → 0.340 at 6.6) into ≈ 5 near-featureless WHITE frames (the riser a few cm
    from the lens at the fixed cue 0.458; strip-c2c-stumble.jpg), then 7.567 → 7.6 drops ×0.19 on the glance cut. The
    black flash became a white flash (HAND said so; it is the cue's exposure — still user-visible).
  · C2c ends at 13.9 s on the route (C2C_DURATION 13.9): the "C2c 15.5" still in the builders' tools is not a route frame.
  · C1 29.5–31.5 (runC/C1-0, strip-c1.jpg): gloves on the wheel, torch hidden (torchVis 0, I 0) — CONFIRMED; the one
    detect FLICKER (29.6, 30) is the wiper crossing the oncoming light, not the arms.
- RUN A3 (Medium, real-time settle with the rAF loop running, 06:03–06:15, 0 console errors; runA3/, settled.py,
  gazewalk.py): settled points at U3N, G3E, PD, U4T + real-time walk-ins (W held, CDP-sampled ≈ 15 Hz) + pan2.
  · The pool itself (plane-centred) rises at every site: U3N 208 → 243 → 243 → 253 → 247 → 245, G3E 219 → 240 → 238 →
    250 → 249 → 249, U4T 252 → 228 → 254 → 240 → 239 (3 / 1.5 / 1 / 0.7 / 0.4 / 0.25 m). The user's original bug (the
    displayed pool darkening on approach) is FIXED on Medium (and Max, run B). CONFIRMED.
  · AIM OVERSHOOT measured in game: lever |lens − wrist| = 0.204 m (= the GLB); beam hit − gaze at 0.7 m = 0.142 /
    0.152 / 0.152 / 0.159 m, ALL upward (U3N / G3E / PD / U4T); at 1 m 0.06–0.11 m up; at 0.4 m back to 0.01–0.04 m.
  · AT THE GAZE in the real-time walk-ins the centre luma dips as the core hops over the gaze point: U3N 250 (1.02 m) →
    146 (0.81) → 240 (0.70); G3E 241 → 143 → 234; U4T 214 (0.97) → 59 (0.86) → 179 (0.65); PD 214 (1.30) → 86 (0.98)
    (strip-rt-u3n-m.jpg, cyan box = gaze: the core rises one core-radius above-right over ≈ 0.25 s, then drops back).
    Smooth, no single-frame pop — but it is the hot spot leaving where you look, right at the distance people stop.
  · EXPOSURE BREATHING standing 0.7 m from a flat wall — REPRODUCED on Medium: U3N EV −4.55..−3.64 (p2p 0.92 EV,
    4 reversals in 13.4 s), G3E −4.83..−3.90 (p2p 0.93, 5 reversals). The meter's target jumps −4.9 ↔ −2.0 between
    readings 0.5 s apart while aim/pull stay constant (aim 1.00) and it flips fix ↔ key: the core sits on the fixation
    disk's edge (the overshoot) and idle sway / grain toggle the protect; the EV follows (slow up, faster down) = a
    ≈ 1.9× brightness swing every ≈ 6 s while you stand still. PD and U4T (doors) instead creep one way +1.2 / +1.6 EV in
    13 s after the protect flips to `key` at 0.7 m (not converged at 13 s).
  · PAN across the ST_MAIN balusters/handrail mid-flight (pan2, Medium, every frame): at 45°/s the torch's screen step
    is 1.4 px median but jumps 33.6 px @1280 in ONE frame (f44) the moment the gaze ray moves from the far wall (3.5 m)
    onto the handrail (0.71 m): the aim WEIGHT is eased (τ 0.15 s) but its TARGET gazeP is not, so _qr re-aims at the
    new point at once. At 180°/s: 53 px single-frame jump (f14) and the pool hops up-right. Releasing (gaze back to the
    far wall) swings the torch 13–15 px/frame for 8 frames. A torch twitch at every stair rail / door edge you glance
    across. Fix: smooth gazeP (critically damped, τ ≈ AIM_TAU) or slerp the aim rotation itself, not only its weight.
  · NOTE for tools: detect.py reads row.lt as the lightning level; verify.mjs rows reuse `lt` for the meter time, so the
    LT tags in runA*/det-* are bogus (no lightning in these sequences: the storm is off).
- RUN B2 (Max remainder, 06:16–06:27, 0 console errors; runB2/): settled G3E/U4T/PD, real-time walk-ins PD/U3N,
  hand views, hand2, C5/C6.
  · Same picture as Medium. Aim miss at 0.7 m 0.13–0.16 m UP at all three sites. Holds at 0.7 m: G3E p2p 0.87 EV
    (4 reversals); U4T p2p **1.23 EV, 6 reversals** — the target toggles between exactly −2.00 (a clamp) and −3.98
    (fix) every 1–3 s, a bistable meter; PD one-way +1.35 EV in 13 s.
  · Max U4T (wardrobe-back leaf, sheet-maxU4T.jpg): the pool centre FALLS 251 → 214 → 210 (1.5 / 1 / 0.7 m) and the
    leaf you look at goes dimmer while the plank wall above it lights up — the overshoot lifts the core over the leaf's
    top edge. Real-time walk-ins: U3N gaze 250 (0.99 m) → 166 (0.86) → 181 (0.75) → 247 (0.65); PD 219 (1.30 m) → 124
    → 110 → 87 at contact.
  · HAND on Max (sheet-hand-max.jpg, crop-hands-max.jpg gamma 2.2): no claw, no finger outline, no wall/floor
    penetration on screen (narrow landing: 289 vertices behind the wall plane, all off-screen; crouch-floor 0). The fist
    and barrel read as "a torch held low-left" at rest, walking, running, crouched and outdoors in the rain — but the
    glove is a pure black silhouette everywhere except the over-exposed F frames, so it never reads as leather. The
    knock glove is a believable gloved hand when lifted. The `locket` view shows the barrel pulled in to the screen
    centre (lens x −0.024, 0.29 m ahead) beside an empty right glove — no locket in that frame (hand-views context; not
    checked on the route). F in the dark: 8 frames at the dark EV (mean 90–105/255: the room revealed as if a lamp
    went on), then a smooth 0.8 s settle — an eye-dazzle transient, no pop (strip-fdark-max.jpg). Fast turns: the
    torch is dragged off-screen in a 675°/s whip and springs back 287 px in the first frame after the stop (then 127,
    …; critically damped, no overshoot past rest) — extreme input, reads as a heavy torch, not a bug.
  · Max volumetric beam LADDER visible again in the rain view (3 bars beyond the torch head).
  · Breathing mechanism (exposure.ts meterTarget, read only): the fixation protect takes the p97 of a centre disk of radius
    fixR 0.15 uv; at 0.7 m the overshoot puts the core ≈ 100–120 px @800 (0.13–0.15 uv) above the centre = ON the disk's
    edge, so p97 flips between core and spill as idle sway/grain move it; when it drops the ratio window's weight wf
    falls and the target jumps to the key target clamped by the room (−2.00 EV at U4T), when it returns, back to the fix
    target (−3.98): a 2 EV bistable target that the EV ramps between. Fixing the aim (core on the gaze) should remove the
    trigger; a temporal filter / hysteresis on wf (or LOOK's near-zone disk centred on the beam hit) removes the cause.
- CONTACT POP (run A, Medium, CDP-stepped walk-ins at 1.6 m/s, every frame; promoted here from the run-A notes): at wall
  contact at every new flat-wall site a thin bright arc of the torch's lens glass shows at the lower left for 2 frames,
  then the hot core jumps up-right ≈ 85 px @1280 per frame for 2–3 frames with a TAA double image of the core
  (strip-g3e-contact.jpg, strip-u3o-pw.jpg). detect FLICKER at contact: G3E 20.5 (f57), U3N 17.0, G3N 18.4, PW 28.3,
  U3O (45° oblique) 35.5, sprint PD 21.4 (runA/det-walk-*/report.txt, det-sprint-PD). LOOK's "FLICKER max 6.3, no
  sliver" (U1 only) is NOT reproduced at these sites → REFUTED. The lens never enters a wall (min lens–wall 0.133 m
  walking, 0.083 m sprinting; arm vertices past the plane are all behind the wall surface, off-screen) → part 1's
  "lens ≥ 8 cm off the wall" CONFIRMED.
- C5 28.6 Medium before/after (sheet-c5-med-ab.jpg): the milky veil is gone, a crisp core on the door frame, the
  wainscot reads → LOOK's C5 claim CONFIRMED. Medium 6-view sheet (sheet-look-med-ab.jpg; before = LOOK's HEAD run
  flash-look/before-med, after = runA look1, same flash-look states): sewing room and U1 wall clearly better (a real
  core, the room reads); C6 20 crisp blue hour (better); gate lightning unchanged (control); C2 9.3 not comparable
  (C2's timeline moved: different head pose/framing); the HEAD u1w05 pair is INVALID (the HEAD still is torch-off,
  e 11.3). B05 2.3 m (crop-b05-gown.jpg): the gown core is less blown (centre p98 237 → 203) but the surround is
  darker (frame p98 117 → 71, centre p50 16 → 1) and the gown is still a featureless white mass with a bloom halo —
  a trade, not an improvement. Caveat: these stills come from flash-look's advance()-stepped settle (absolute EV may
  differ a little from real-time play; before and after used the same tool).
- RUN D (Max, HEAD 0ba616a = the live build, dist scratch/dist-verify-head, 06:53–06:56, 0 console errors; runD/) —
  the Max "before" LOOK dropped: sheet-look-max-ab.jpg (live | after; after = runB look1 + runB2 C6). U1 wall 1 m: a
  grey disc with a dim core under the old claw (live, p98 83) → a hot core with spill ring and the damask readable
  (p98 114); sewing room: a dim grey veil (p98 24) → a core on the dress and the room reads (p98 94); B05 2.3 m: on Max
  the after is BRIGHTER (e 0.34 → 0.46, p98 59 → 96: balusters and treads read; gown still a white mass); C6 20: grey
  rain → crisp blue hour (the tree's C6 has rain 0 by design: "the rain has stopped"); gate lightning unchanged (e ≥ 1
  control; the live claw glove holding the torch toward the camera → a plain barrel). C2 9.3 not comparable (C2's
  timeline moved); the live u1w05 still is torch-off (e 11.5) on Max too → pair invalid. Verdict: the Max (ar) look
  is MORE photographic in every comparable torch-lit view; nothing newly blown; the crushed B05 surround is a Medium
  (fixation-bound) effect only.

### Verify (part 2) — FINAL VERDICT (snapshot 9aeeecf6 = dist scratch/dist-flash-verify; biggest first)
The user's original complaint — the DISPLAYED POOL getting darker as you walk at a wall — is FIXED on Medium and Max
(lead #149 + #146: the pool rises at every one of 7 new sites, settled and walking). But the beam is NOT clean near
walls, and the 0.6–1.0 m band (where people stop) still has user-visible faults:
1. NEAR-WALL AIM OVERSHOOT (arms.ts poseArm, this lane): the aim rotation is applied about the WRIST, so the lens
   (0.204 m ahead) swings and the core lands 13–16 cm ABOVE-RIGHT of the gaze at 0.7 m (miss measured at 4 sites on
   Medium and 3 on Max; the walk-in pool y at G3N/PW/U3O agrees; offline proof aimsim.ts). Root cause of: the gaze-point luma dips in walk-ins (U3N 250 → 146 → 240, U4T 214 → 59 →
   179), the wardrobe leaf / front door you look at going DIMMER while the wall above lights (Max U4T pool 251 → 214),
   the barrel visibly cocked ≈ 45° up at the front door, and finding 2. Fix: pivot the aim about the lens; unit test
   |miss| < 2 cm for 0.5–1.25 m (the current test allows 9.5 cm at 0.6 m only).
2. EXPOSURE BREATHING standing 0.7 m from a wall: 0.87–1.23 EV peak-to-peak, 4–6 reversals in 13 s (U3N/G3E Medium +
   Max, U4T Max) — the fixation protect flips on the disk edge (fix ↔ room clamp −2.00 EV). Doors instead creep one
   way +1.2–1.6 EV over 13 s. LOOK's "no oscillation anywhere" is REFUTED (its 1 s window was too short).
3. CONTACT POP at wall contact: 2-frame lens-glass arc + 85 px/frame core jump + TAA double core (FLICKER 17–35 at 6
   sites). LOOK's "no sliver, FLICKER ≤ 6.3" holds only at U1.
4. C2c STUMBLE (route, Medium): no black frames any more (CONFIRMED), but 6.6–6.73 is a one-frame ×8 jump into ≈ 5
   near-white frames — the black flash became a white flash (HAND R1; the lever is the C2c cue's exposure).
5. MAX VOLUMETRIC BEAM LADDER outdoors (flashlight.ts, pre-existing in HEAD): 12 un-jittered march steps → 3–6 evenly
   spaced bright bars just beyond the torch head on the wet path in every outdoor Max view.
6. BALUSTER/RAIL TWITCH: the torch jumps 34 px (45°/s pan) / 53 px (180°/s) in one frame when the gaze ray lands on a
   rail — gazeP is not smoothed, only the aim weight.
7. HAND: the claw is gone; at rest, walking, running, crouched, looking at the floor and outdoors in the rain on Max it
   reads as a fist holding a torch low-left (CONFIRMED), no finger outline, no penetration on screen, rest jitter
   0.2–0.6 px/frame. Still not photoreal: the glove is a pure black silhouette (only the over-exposed F frames show it
   is a grey material), fingers read rubbery when lifted; the `locket` view pulls the barrel to the screen centre.
8. LOOK (ar): better everywhere exposure < 1 (sewing room, U1 wall, C5 veil gone, C6 crisp dawn); controls unchanged.
   Exceptions: B05 2.3 m on MEDIUM (core less blown, surround crushed; on Max it is brighter and better; the gown is a
   white featureless mass with a halo on both); the
   far-wall pool at 5 m in the halls reads as a glowing orb (no wallpaper inside the core); torch cores on cloth stay
   white discs. Lightning (Max, e 5.79 both sides, (ar)-neutral): the strike lifts the frame to p98 124 / clip 0 % — a
   soft day-for-night fill with no over-exposure and no hard window shadows (CLAUDE.md asks for both; not this lane).
9. F after 10 s in the dark: 8 frames at the dark EV (the room revealed, mean ≈ 100/255), smooth 0.8 s settle —
   a plausible eye-dazzle, minor.
Gates: strict torch-on Medium playthrough → title, 0 deaths, 17/17 asserts, 0 console errors/warnings/exceptions;
npm test 325/325 (snapshot, 03:45) and 339/339 (current tree, 06:05); typecheck clean + assets --check ok (03:44).
GATE E (Max, strict, torch on, 07:09–07:13; runE/): ended=true at the title, 0 deaths, 17/17 asserts, 0 console
errors / warnings / exceptions. C2c 6.2–8.0 on Max (runE/C2c-0): min luma 0.027, no black frame; the stumble flare is
tamer than Medium (0.15–0.30) — HAND's Max numbers CONFIRMED.
Every verify run (A, A2, A3, B, B2, C, D, E) logged 0 console errors / 0 exceptions. Mac on mains throughout (fps not
measured by this pass). Cleanup done 07:15: scratch/dist-flash-verify, scratch/dist-verify-head and the git worktree
scratch.nosync/wt-verify-head removed (15 GB free). Work files kept in scratch/flash-verify/ (verify.mjs, settled.py,
gazewalk.py, gaze.py, aimsim.ts, pairsheet.py, sheets/strips/crops named above).

### Requests for the lead (VERIFY, part 2)
1. FLASH follow-up (arms.ts, this lane): aim about the lens (finding 1) + smooth gazeP (6) + hysteresis / temporal
   filter on the fixation weight wf in exposure.ts (2); re-run scratch/flash-verify/verify.mjs PARTS=beam,rtwalk
   (settled.py, gazewalk.py: judge the GAZE column and the 0.7 m HOLD p2p, not only the pool column).
2. FLASH (flashlight.ts): jitter the volumetric march start per pixel (IGN/blue noise × dt, TAA resolves it) or
   integrate the near-lens airlight analytically (finding 5).
3. C2c cue owner (FRAMES / SMOOTH-FIX): stop the film camera down ≈ 2–3 EV for 6.58–6.75 (finding 4).
4. Lightning owner: the strike should briefly over-expose with hard window/tree shadows (finding 8).
5. Glove albedo (skin.ts / material-spec, HAND request 1) still stands; the locket pose needs one look on the route.

## Fixer round 1 (part 2, agent "fix", 2026-10-13 07:20–) — the verifier's V1–V5
Work dir scratch/flash-fixr1/ (walksim.ts = the REAL arms.glb + FlashlightRig + FpArms facing an analytic wall, MODE=settle
| walk, ARMS=old = the pre-fix arms.ts copy in orig/; beamsim.mjs = CPU replica of the Max beam march; mt.ts = meterTarget
probe). Pre-fix copies of every owned file: scratch/flash-fixr1/orig/. Dist: scratch/dist-flash-fix (delete at the end).

### V1 — near-wall aim overshoot (arms.ts) — FIXED offline, browser check pending
- ROOT CAUSES (two): (a) poseArm solved the aim from the LENS and applied it about the WRIST (lever 0.204 m) — reproduced
  offline: miss at 0.7 m 14 cm up-right (in game 14–16 cm); (b) NEW: the game poses the arms BEFORE the rig follows the eye
  (story-runtime arms.update → main.ts rig.update): every world input of the aim was one frame stale — walking at a wall the
  beam passed ≈ 5 cm below the gaze and the gaze-point irradiance FELL 774 → 331 lx from 0.8 m to contact, then the pool
  jumped 57–91 px @1280 at the stop (this is V3's "core jumps up-right 85 px/frame" too).
- FIX: (a) exact closed-form aim about the wrist: the beam line leaves the wrist at the clip's ⊥ offset ℓ⊥ (8.1 cm in
  arms.glb); R = shortest turn of q* = ℓ⊥ + √(|g|² − |ℓ⊥|²)·dW onto g = G − wrist (one step, exact); (b) FlashlightRig.update
  calls FpArms.afterRig() (rig.userData.afterRig) once the rig has moved: the IK is re-solved with this frame's rig and the
  light re-placed (update() alone stays complete for tests / rig-less callers; ≈ one extra BVH ray + IK per frame);
  (c) AIM_MAX 50 → 65° (looking DOWN at a wall within 0.4 m needs 54–60°: at 50° the beam fell 3–4 cm short); (d) TUNING
  DECISION (reversible): AIM_NEAR 0.8 → 1.25 m so the pool is ON the gaze from 1.25 m in (the verifier's < 2 cm spec for
  0.5–1.25 m); AIM_FAR 2.0 unchanged → B05 at 2.3 m keeps aim 0 (the "torch held low" look); at 1.5 m the pool now sits 7 cm
  under the gaze (was ≈ 20). Revert to 1.0 if the AD finds the 1.25–2 m approach too crosshair-like.
- SMOOTHNESS (verify pan2 rail twitch, same code): the aim weight now follows a critically damped spring (AIM_W 10/s: starts
  from rest; the first-order ease moved 20 % of a re-aim in the first frame = the 34–53 px one-frame twitch) and a gaze-point
  HOP to another surface (distance jump ≥ 0.25 m and ≥ 3× the eye's move) glides over GAZE_HOP 0.25 s; sliding over one
  surface is tracked exactly (gazeHops = 0 in every walk sim).
- OFFLINE (walksim.ts, real GLB, level gaze): settled miss old → new at 1.25 / 1.0 / 0.85 / 0.7 / 0.6 / 0.5 / 0.4 m: 6.5 /
  9.8 / 16.5 / 13.7 / 8.1 / 2.6 / 0.6 cm → 1.5 / 1.3 / 0.6 / 1.1 / 0.6 / 0.6 / 0.4 cm; pitch −20°: ≤ 1.2 cm, −35°: ≤ 1.6 cm
  (D 0.27–1.0). Gaze-point irradiance on the approach (settled) old 566 (1.25) → 53 → 41 → 68 lx (the dip) → new 2468 →
  4072 → 6382 → 7207 → 9286 … 10107 lx (monotonic). Walk-ins @30 fps, max pool step px @1280 old → new: level 1.6 m/s
  92 → 8, 3.6 m/s 132 → 36; pitch −20° 66 → 13 / 139 → 41; −35° 48 → 19 / 102 → 41. 60 fps 1.6 m/s: 4 px.
- TESTS (tests/arms-pullback.test.ts, all fail on the old arms.ts: verified with a sed copy): settled |miss| < 2 cm at
  0.5–1.25 m (old: 3.8 cm at 1.25); game frame order with a real FlashlightRig walking in at 1.6 m/s → < 3 cm from 0.85 m,
  never moving away from the gaze, pool step < 15 px (old: 10.3 cm); aim onset / gaze hop ≤ 6°/frame (old onset 9.96°).

### V2 — exposure breathing at 0.7 m (exposure.ts + look.ts) — guard added; the trigger is V1
- V1 puts the core ON the gaze (inside the fixation disk) from 1.25 m in. Guard for the remaining disk-edge cases (e.g. a
  wall at ≈ 2 m, aim 0, core ≈ 0.15 uv under the centre): SPATIAL HYSTERESIS in meterTarget — once engaged (the last
  reading's wf ≥ ½, not across a cut) the disk widens to fixR × LOOK.fixHyst (1.6: 0.15 → 0.24 uv) keeping the same number
  of top texels (a wider disk must not dilute the subject); a subject that leaves the centre is released at once (no delay
  — first tried a 1.5 s time hold: it slowed every post-glare brightening and did not cover 1–3 s toggles; dropped).
  meterTarget stays pure (legacy-equivalence test unchanged) and also returns keyT / fixT / wf (QA: last.wf, last.engaged).
- TESTS (exposure-response #8/#9): a core drifting 0.5 ↔ 0.69 in runs of 0.5–4 s → EV p2p 13 s old 0.51 → new 0.013 EV; a
  steady core: identical exposure; a core that leaves (0.85) is released exactly like the old protect (≤ 0.02 EV at 7/10/15 s).

### V3 — contact pop (arms.ts) — the core jump is V1(b); the bezel glint remains (analysis)
- The "core jumps up-right ≈ 85 px/frame for 2–3 frames + TAA double core" = the stale-rig aim + the lens-based clamp at the
  stop: offline 91 → 8 px (above). The "thin bright arc" (scratch/flash-fixr1/g3e-contact-crops.jpg, verify G3E f52–57,
  gamma-lifted) is NOT the lens glass: the bezel's front rim reflecting the 9 klx pool 14 cm away (ArmsEnvNode
  torchPoolRadiance — a physical glint), visible in every frame of the approach, growing as the head comes toward the
  camera and leaving the frame in ≈ 2 frames (100 px/frame lens step @30 fps, 65 @60). Swept offline: knee 0.15/0.25/0.35,
  τ_out 0.05/0.1, a downward pull (lift −0.4…−1.2, with AIM_MAX 75°): none slows the exit (it is the perspective of a hand
  withdrawn 0.2 m toward the eye in the last 0.15 s) and τ 0.1 / the drop break the pool or the wall clearance. Kept as is;
  browser detect at the verifier's sites decides if anything is left.

### V5 — Max volumetric beam ladder (flashlight.ts) — FIXED (CPU replica), browser look pending
- Cause: 12 uniform steps (≈ 1.2 m apart) under-sample the near-lens 1/d² in-scatter peak; which step catches it depends on
  the ray length → bars. beamsim.mjs (41 rays down the ground beside the torch head vs a 4000-step reference): old 12-step
  error up to ±64 % in neighbouring pixels (the ladder). NEW: 6 uniform + 6 EQUIANGULAR samples about the lens (Kulla &
  Fajardo 2012) combined by the balance heuristic (multi-sample MIS), stratified with one per-pixel offset (IGN on
  screenCoordinate + 0.618·frameId; TAAU resolves): mean over offsets within 1 % of the reference on every ray, per-frame
  rms 14 % (old 19 % with the systematic ladder). Same 12 iterations.
- ALSO FOUND + FIXED: the cone mesh used tan(angle/2) but SpotLight.angle is already the half-angle → the shaft was cut at
  23.6° along a hard line (the wedge edge in crop-ground-beam.jpg, left) while the spill runs to 45°. Now the full cone, with
  the spot's own penumbra falloff (SpotLightNode.getSpotAttenuation: smoothstep(cos 45°, cos 22.5°)) in the integrand.
  Max-only fill cost grows (the cone covers more of the frame): fps to be measured on Max.

### Browser round 1 — M1 (Medium, 1280×800, dist built 07:50 = V1(a,b) + V2 + V5; 08:07–08:12, 0 console errors /
0 exceptions; scratch/flash-fixr1/M1, run.sh M1; analysis ana.sh / holds.py; before = the verifier's runA / runA3)
- AIM (settled, real time): miss at 1 / 0.7 / 0.4 / 0.25 m: U3N 0.4 / 1.4 / 1.0 / 0.4 cm, G3E 0.8 / 1.1 / 1.0 / 0.5, U4T
  2.4 / 1.6 / 0.4 / 0.4, PD 1.5 / 0.7 / 0.9 / 0.6 (before 6–11 / 14–16 / 1–4 / 0–3 cm, ALL up). GAZE luma 3 → 0.25 m:
  U3N 46 20 173 248 247 245 248 (3, 2, 1.5, 1, 0.7, 0.4, 0.25 m), G3E 12 16 165 247 248 247 249, U4T – 30 158 231 242 245
  241 (before U3N 30 – 57 134 159 245 234, G3E 33 – 41 98 140 242 242, U4T – – 83 117 157 169 236). The 3 → 2 m step is
  the pool still 30 cm under the gaze (aim 0 beyond 2 m: by design).
- REAL-TIME WALK-INS (gazewalk.py, biggest fall at the gaze from the running max): G3E 97.9 → 4.0, U3N 103.7 → 6.0,
  U4T 162.6 → 1.2 — FIXED. PD (front door, outside) 169.3 → 153.0 — NOT fixed: strip-rt-pd.jpg shows the core 10–15 cm
  up-right of the gaze from 0.85 m in. Cause found: the door blockers (doors.ts leaf box = the union of the leaf AND its
  hardware) are 0.20 m thick for a 0.04 m leaf (knobs both faces) and 0.46 m for D_FRONT (+ the knocker): the gaze
  point floated 8–20 cm in front of the wood (scratch/flash-fixr1/doortris.mjs). FIX (flashlight-bounce.ts, mine):
  TORCH_WORLD.surface = the octree + each leaf's SLAB (its largest mesh), used by the aim and the beam hit (bounce
  light, near-pool exposure); the pullback keeps the conservative blocker (it must clear the knob). Test
  torch-door-hit #3. Browser re-check: R2.
- HOLDS (10 s after a 3.5 s settle, EV p2p over the last 10 s; holds.py): 0.7 m U3N 0.92 → 0.14, G3E 0.93 → 0.13 (the
  −2.00 room-clamp toggling is gone: 'fix' on 99/99 readings). PD 0.60 → 0.47 and U4T 0.81 → 0.41 are ONE-WAY
  convergence (the 13 s trace starts at the 1 m point's EV and brightens at τ 6 s; 2 reversals ≤ 0.05 EV), not
  breathing. 2 m (aim 0, the core ≈ 0.12–0.15 uv under the centre = the old disk edge): U3N 0.20, G3E 0.23, U4T 0.34,
  PD 0.56 — 'fix' on 97–99 % of readings (the hysteresis holds), the residual is the fixation statistic's own reading-to-
  reading jitter (±0.3–0.6 EV: the 9th-brightest texel of the disk on a moving, grainy core / glints) pulled down fast
  (τ 0.5 s) and up slowly. Honest residual, ≤ 0.25 EV on plaster/paper walls.
- CONTACT POP (CDP-stepped walk-ins, detect FLICKER at contact): G3E 20.5 → 2.6, U3N 17.0 → 2.7, PW 28.3 → 0.9 (the core
  no longer jumps; no TAA double core). G3N 18.4 → 16.9: the mean luma rises smoothly (36 → 111, no step); the flicker
  is the bezel glint line leaving the frame (strip-g3n.jpg) — physical (the rim reflects the 9 klx pool), 3 frames.
  U3O (45° into a corner) 35.5 → 21.7: the pool straddles the corner while the capsule slides along the wall.
- PAN2 (stair balusters, every frame): 45°/s torch step at the rail 33.6 → 15.5 px (median 2.0 px); 180°/s 53 → 69 px
  (the gaze re-hitting a baluster after a gap still re-aimed → hop now = the hit POINT jumping ≥ 0.25 m, not only its
  distance; offline pan sim: beam turn in the view 10.1 → 4.4°/frame at 45°/s, 15.4 → 7.2 at 180°/s; test
  arms-pullback 'panning across stair balusters' old 23° → new 9.8°). Browser re-check: R2.

### Browser round 2 — R2 (Medium, dist rebuilt 08:20 = + door slabs, hop by point, aim gating; 08:22–08:26, 0 console
errors / 0 exceptions; scratch/flash-fixr1/R2)
- INVALID PART: every CDP frame after the look route is black — the route's B05 marks inherited DISTS (2…0.4) from the
  beam part, Ada was followed to 0.7 m and caught the player (death overlay). Captures (g.capture: settled points, look
  stills) and the meter are valid; the walk-ins / rt walks / pans are re-taken in T1.
- DOOR SLAB (PD = the front door from the porch; d is to the BLOCKER face, the leaf is ≈ 0.35 m behind it): GAZE luma
  2 / 1.5 / 1 / 0.7 / 0.4 m 52 / 55 / 244 / 246 / 241 (M1 box aim: 49 / 233 / 120 / 174 / 163; verifier 199 (1.5) / 102 /
  117 / 121) — the hot core sits on the knocker plate you look at (scratch/flash-fixr1/pd04-ab.jpg: M1 core up-right |
  R2 core centred). At "1.5 m" the aim is 0.11 (the leaf is really ≈ 1.85 m away: the ramp starts later, by design).
  The frame around the door is ≈ 1 EV darker than with the off-centre core: the fixation protect now holds the core (on the
  gaze) at fixWhite instead of letting it clip — as tuned for B05. The verify 'miss' / 'centre' columns are measured on
  the blocker plane and are not valid at PD any more (use GAZE).
- HOLDS (last 10 s p2p): 0.7 m PD 0.17, U3N 0.15, U4T 0.15 EV (all < 0.2; 'fix' 94–99 %); 2 m U3N 0.19, U4T 0.15, PD
  0.83 (rev 0 = one-way convergence from the previous point, τ 6 s).
- C2c 7.1 / 15.5 stills (look route): identical to the verifier's (sheet-c2c-ab.jpg: e 0.458 cue / 0.44–0.47, same pool,
  same fist) — the cutscene paths are untouched (cutsceneHold / cue gate the aim; afterRig only re-places the light).

### T1 (Medium, dist-flash-fix2 = R2 tree + a LOOK.meterTaps switch; 08:46–08:56, 0 console errors; scratch/flash-fixr1/T1)
- Re-taken walk-ins (valid frames): real-time GAZE fall from the running max, near zone: PD 0 (the gaze luma rises 51 →
  69 → 95 → 163 → 209 → 233 → 242 → 246 from 1.46 to 0.27 m; the 39-point "fall" is at 3.2 → 2.9 m, luma ≈ 30, noise),
  U4T 1.7, G3E/U3N only in the far zone (3.2 → 2.5 m, luma < 30). Verifier → now: PD 169 → 0, G3E 98 → 0, U3N 104 → 0,
  U4T 163 → 2. Contact FLICKER: G3E 4.3, PW 0.7, G3N 8.6 (was 18.4), U3O 20.3 (corner; was 35.5).
- pan2 (45°/s): one 21.8 px lens step at f42 — the gaze had left the rail (no hit < 2.1 m) and the decaying aim still
  pointed at the rail's WORLD point, swinging further off the view as it panned. FIX (arms.ts gazeRay): with nothing hit
  the target rides along the gaze at the last hit's distance while the aim fades. Offline pan sim: max lens step
  17.6 → 14.4 px (45°/s), 53.6 → 37.5 px (180°/s); medians 4.1 → 3.0 / 10.7 → 6.0 px. Browser re-check: F1.
- METER TAPS A/B (same session, 8 views × 2 settings × 2 repeats, 6 s settle + 10 s hold): a 4×4-tap meter did NOT reduce
  the fixation statistic's reading-to-reading spread (fixSd 0.12–0.35 EV either way) nor the hold p2p (mixed ±) —
  REJECTED and removed (the jitter is in the scene, not the meter's sampling). Kept instead: a NOISE GATE on the meter's
  target (exposure.ts / LOOK.meterNoiseEV 0.4, meterNoiseTau 1 s): target changes < 0.4 EV between readings are
  low-passed with τ 1 s, ≥ 0.8 EV pass at once (lamps, the torch on, cuts: no added latency); test exposure-response #10:
  ±0.3 EV jitter → ripple p2p 0.174 → 0.107 EV, a 2 EV step identical to the ungated meter (≤ 0.1 EV at 0.5 / 1 / 3 s),
  a 0.3 EV real step converges. npm test 345/345.

### V4 — C2c stumble white flash (not this lane's files) — request below
- Not reproducible as an arms fix: during the stumble (6.58–6.75) the beam is aimed by SMOOTH-FIX #145b's gaze clamp
  (bindings.ts beamClamp {gaze} → BEAM_CLAMP.at) at the riser 0.4 m from the clutched lens, under C2c's FIXED film exposure
  0.458. E at 0.4 m = I·σ²/(σ²d² + D²/8) = 8.1 klx (flashlight.ts near field) → a dark tread (ρ ≈ 0.1) at ≈ 260 nits × 0.458
  ≈ 120 pre-AgX = white with no texture. No pose the clutch allows changes that by more than ≈ 0.5 EV (HAND #3). The lever
  is the cue (c2c-up.ts) or the clamp (bindings.ts): request (For other lanes) below.

## Fixer round 2 (part 2, agent "fix" #2, 2026-10-18 20:58–) — the never-run browser checks of round 1 + gate
RESTART NOTE: round 1 stopped 2026-10-13 08:59 with F1 (pan2 no-hit ride + noise gate), X1 (Max: V5 never compiled in a
browser — the beam cone is Max-only) and G1 (gate) queued but NEVER RUN (blocked behind Blender; F1.log / G1.log only
"waiting"). The owned source files are byte-identical to the 08:59 tree (nothing in src/ changed since), except this
round's QA switch below. Work dir scratch/flash-fixr2/ (run.sh M | X | G, runs.txt with free disk, verify.mjs = round 1's
copy + the beam A/B, elbowsim.ts). Dist scratch/dist-flash-fix (built 21:08; delete at the end).
- Offline gates (21:00–21:10): typecheck clean · npm test 345/345 · assets --check ok (low 26.99 / 27, medium 53.80, max
  77.14 MB — no asset changes this round; Low's ≈ 10 KB headroom untouched) · vite build + verify-boot OK.
- flashlight.ts: QA-only uniform `uBeamOld` (`rig.flashlight.beamOld`, default 0 = the round-1 MIS march, identical
  output): 1 = the live build's march (12 mid-point steps uniform in t, no jitter, Δt = tBack/12) for a same-frame ladder
  A/B on Max. APPROXIMATE "old": the round-1 cone smoothstep stays applied in old mode (≈ 1 inside the old 23.6° mesh),
  so the old wedge edge reads slightly softer than the live build's.
- Queued 21:10:55 (FIFO behind the lead's ship gate scratch/lead-ship2): M (Medium: look1 + beam U3N/G3E/PD 3…0.25 m,
  holds 2 / 0.7 m + walk-ins G3E/U3N/G3N/PW/U3O + rt walk-ins U3N/G3E/PD/U4T + pan2 = round 1's F1), X (Max: look1 + beam
  U3N/PD + beamv new | old | off with fps), G (strict torch-on Medium gate + C1 29.5–30.5 / C2c 6.2–8.0 frames).
- FOUND offline, NOT fixed (scratch/flash-fixr2/elbowsim.ts: real arms.glb + FpArms + FlashlightRig, a plane wall at an
  angle, the arm triangles rasterised 160×100 with near-plane clipping): the near-wall pull only probes along the TORCH
  line, so a wall beside the player never folds the arm. Wall 0.27 m to the LEFT (hugging it), pitch −35°: sleeve cells
  on screen 189 in front / 116 BEHIND the wall plane = a visible cut line where the forearm enters the wallpaper; level
  gaze: 0 / 2 (fine). 45° into the U3O corner (pull 0.38): only ≈ 9 cells of glove at the bottom-left (elbow 12 cm into
  the wall, off-screen). Fix direction (not started): an elbow probe (shoulder → elbow ray) that swings the IK pole down
  toward the body when the elbow is inside a wall.
  More cases (same sim): the 0.85 m back-stair landing (walls 0.425 m each side) is clean even looking down 50° (sleeve
  cells behind the wall 0); the cut needs the eye within ≈ 0.30 m of a LEFT wall AND a downward look (0.27 m: 116 cells,
  0.30 m: 14, 0.35 m: 0, of 16 000) — a strip of sleeve at the bottom-left corner. Residual, logged for a later round.
- M (Medium, 21:1x–21:31, dist-flash-fix = round 1's tree + the beamOld switch; 0 console errors / 0 exceptions, load
  285 s; scratch/flash-fixr2/M, analysis M/{settled,holds,gazewalk,detect}.txt):
  · BEAM CURVE (settled real time, GAZE = displayed luma at the frame centre; pool = plane-centred), 3 / 2 / 1.5 / 1 / 0.7 /
    0.4 / 0.25 m: U3N gaze 27 24 186 245 250 247 248, pool 198 228 242 249 252 248 248; G3E gaze 7 18 197 243 250 249 249,
    pool 213 234 240 249 252 249 250; PD (front door from the porch) gaze 44 45 44 247 246 246 241 (PD pool/miss columns
    are on the knob-padded blocker plane — not valid there, round 1 R2). Aim miss at 1 / 0.7 / 0.4 m: U3N 2.4 / 0.9 /
    0.3 cm, G3E 2.5 / 1.2 / 0.1 cm (verifier: 6–11 / 14–16 cm). PASS (monotonic at the gaze; ≤ 2.5 cm).
  · HOLDS (EV p2p over the last 10 s): 0.7 m U3N 0.09, G3E 0.07, PD 0.15 — 'fix' on 87–99 % of readings (verifier 0.92 /
    0.93 / one-way +1.35); 2 m U3N 0.19, G3E 0.07, PD 0.28 one-way (round 1 before the noise gate 0.20 / 0.23 / 0.56).
    PASS (< 0.2 EV standing still near a wall; the 2 m door is convergence, 0 reversals).
  · REAL-TIME WALK-INS (gazewalk): biggest gaze fall from the running max G3E 15.0, U3N 21.2, PD 62.7 — all in the far
    zone (eye 2.3–3.2 m, luma < 50 = grain on the dark wall); U4T 11.6 near contact (0.57 → 0.27 m). Verifier 98–169.
  · CONTACT (CDP walk-ins, detect FLICKER): G3E 2.6, U3N 3.4, PW 0.8 (verifier 20.5 / 17.0 / 28.3); U3O 13.8 (corner,
    T1 20.3, verifier 35.5); G3N 21.1 at f55 (T1 8.6, verifier 18.4): the pool is steady (642–649 px) and the luma rises
    smoothly — the flicker is the bezel rim's thin glint (≈ 3 px × 60 px, the polished rim 15 cm from a ≈ 9 klx pool)
    crossing the bottom-left corner for 3 frames as the torch head leaves the frame (scratch/flash-fixr2/
    g3n-contact-53-58.jpg). Varies run to run (sub-pixel). Honest residual: no DoF on the arms, so a rim 15 cm from the
    eye is drawn sharp where a camera would blur it away.
  · PAN2 (ST_MAIN balusters, every frame; round 1's no-hit ride fix, first time in a browser): lens step max / median
    slow 10.8 / 1.3 px @1280 (T1 21.8 / 1.9, verifier 33.6), fast 35.6 / 4.2 (T1 49.6 / 14.3, M1 68.9, verifier 53).
    PASS. detect still flags pan2-slow f46 (39.9): the beam axis slips from a baluster 0.24 m away to the wall 2.78 m
    behind it (hitD row) — the light moving between bars as a swept torch does, not the torch jumping (lens step 8.2 px).
  · LOOK route stills: C2c 15.5 identical to the verifier's (e 0.4428 cue both; scratch/flash-fixr2/c2c-b05-ab.jpg);
    B05 4 m e 0.33 → 0.67 ('key' both; p98 74 → 108, 0 % clip: the stair, banister and wall read, gown not blown —
    the tree's lightmaps/meter moved between the verifier's 03:44 snapshot and round 1's 08:59 tree); B05 2.3 m e 0.29
    'fix', centre p98 210 (round 1: 210).
  · AIM_NEAR 1.25 (round 1's reversible tuning) — JUDGED: the pool drifts from ≈ 0.6 of the frame height at 2 m (aim 0,
    held low) to 0.54 at 1.5 m and centred at 1 m (scratch/flash-fixr2/aimnear-sheet.jpg) — reads as lighting where you
    look as you close in, not a crosshair. KEPT. AIM_MAX 65° kept (needed looking down at a wall within 0.4 m).
- ELBOW FOLD (arms.ts, NEW this round — ships only if S below confirms it in the browser; pre-fold copy
  scratch/flash-fixr2/arms.ts.orig): each frame one ray from the shoulder to the IK elbow's OUTER sleeve surface (the
  elbow + ELBOW_MARGIN 2 cm along its bend direction); if a wall is nearer, the elbow swings DOWN about the shoulder→wrist
  line to the first clear angle (signed clearance sampled every 15°, the zero crossing interpolated, ≤ 90°), eased
  (τ 0.08 s out / 0.3 s back), the probe margin led by the elbow's approach speed (+ v·0.12 s, ≤ 0.3 m: strafing into a
  wall the fold starts early). The hand keeps its world pose (wrist target unchanged) → the torch, beam and pool do not
  move. Off under cutscenes / cues / the car (same gate as the pull). QA switch `arms.foldEnabled`, value `arms.fold`.
  Offline (elbowsim.ts, real GLB, 160×100 raster with near-plane clipping; cells of arm BEHIND the wall plane on screen):
  hugging a left wall at 0.27 m looking down 35°: 116–120 → 0 (sleeve 6 cells in front); 0.30 m: 14 → 0; level gaze
  1 → 0; deepest vertex −11.5 → −1.8…−5 cm (off-screen); U3O corner elbow 11.5 cm in → clear; 0.85 m back-stair landing
  (walls 0.425 m) folds 8–15° (elbow drops a little in the narrow stair; nothing penetrated before); front-wall / idle:
  fold 0, identical. Strafing left into a wall (30 fps): 1.6 m/s pitch −35° cells behind ≤ 17 for 2 frames (was 183
  sustained), elbow ≤ 3.8 cm/frame over ≈ 8 frames; 3.6 m/s ≤ 75 for 2–3 frames (the fold catches up), ≤ 6 cm/frame.
  Tests (tests/arms-pullback.test.ts +2): beside a wall the elbow leaves it and swings down, lens < 1 mm / beam < 1 mrad
  unchanged, no swing far from walls; strafing at 1.6 / 3.6 m/s the elbow steps < 6 cm/frame, never > 3 cm in, settles out.
  npm test 349/349 (21:40; arms-pullback 13/13).
- DIST SPLIT: scratch/dist-flash-fix (21:08) = round 1 + beamOld → M only (V1–V3, pan, beam curve, look stills); deleted
  21:31 after M. scratch/dist-flash-fix2 (rebuilt 21:36, before S started: + the fold + its approach-state reset when the fold is off) = + the elbow fold → S (fold in the browser + U3O hide-mesh A/B + doors),
  X (Max V5 + beam), G2 (the final strict torch-on gate). LEAD: src/characters/arms.ts and tests/arms-pullback.test.ts
  changed AFTER the lead's 20:58 ship build (scratch/dist-ship2): lead-ship2's gates do not cover the fold; G2 does.
- S (Medium, 21:47–21:52, dist-flash-fix2; 0 console errors / 0 exceptions, load 94.7 s; scratch/flash-fixr2/S, ana-s.sh):
  · SIDE WALL (eye 0.28 m from a wall on the torch side, pitch −35 / 0 / −55°, U3N damask + G3N planks; fold off | on
    same pose, seeded): the fold engages at 59–61°; arm vertices behind the wall plane (every 8th) 543–579 → 198–236,
    deepest −10.2…−10.9 → −4.1…−4.5 cm; the fist, torch and beam unchanged (lens px within 0–19 px: idle sway). Look
    (S/sheet-fold.jpg, fold-ab-zoom.jpg, gamma 2): off = the forearm lies along the bottom-left INTO the wall; on = it
    drops toward the bottom edge under the unmoved fist — reads as an arm with the elbow tucked, not a hinge. KEPT.
  · U3O CORNER (45° in, level): fold 89°, behind 252 → 0, deepest −9.2 → +0.1 cm; looking down 30° there: fold 0
    (nothing to clear). The off-still's white wash is the advance()-stepped harness (a stale meter reading: ev +1.13 vs
    −4.87 on), not the arms — the exposures of these A/B stills are harness noise, judge shapes only.
  · STRAFE into the wall at the walking speed, pitch −35° (34 CDP frames each): fold ramps 10 → 62° over ≈ 6 frames
    (≈ 10°/frame), lens step ≤ 15 px (off ≤ 12); behind max 664/672 → 547/483 (the peak frame, then 414 and falling as
    the fold completes); FLICKER on 2.3 (U3N) / 12.1 (G3N f16: the forearm sweeping the dark wall as it drops — a
    continuous motion, scratch/flash-fixr2/strafe-g3n-bl.jpg), off 1.4 / 1.9.
  · DOORWAYS (kitchen arch, CDP walk 70 frames): archW (the south jamb 0.3 m on the torch side) fold 0 — the jamb
    never reached the elbow; archE (along the passage/kitchen north wall at 0.3 m) fold up to 62°, FLICKER on 1.9 vs off
    5.3, lens steps identical (110 px = the torch passing the frame edge in both).
  · U3O HIDE-MESH A/B (the verifier's arc/spike; CDP walk-in, seeded): FLICKER norm 14.6 @f66 · every arm mesh hidden
    13.0 @f67 · torch meshes hidden 6.7 @f68 → most of the U3O contact flicker is the SCENE (the pool straddling the
    corner at 0.36 m), not the arms. The thin dotted edge of the pool's spill disc at < 0.2 m (scratch/flash-fixr2/
    u3o-bl-58-68.jpg) also stays with the arms hidden: a render-side (TAAU/shadow-edge) artefact — PERF/RENDER lanes.
- X (Max, 22:5x–23:07 on mains, dist-flash-fix2; 0 console errors / 0 exceptions — the round-1 MIS beam shader compiles and
  runs (it is Max-only: never in a browser before); load 169 s; scratch/flash-fixr2/X, ana-x.sh):
  · BEAM CURVE 2 / 1 / 0.7 / 0.4 m: U3N gaze 12 246 250 246, pool 215 249 250 247, miss 1.7 / 0.3 / 0.8 cm at 1 / 0.7 /
    0.4 m; PD gaze 40 244 247 244. PASS (monotonic at the gaze from the near zone in).
  · HOLD 0.7 m (last 10 s): U3N 0.17 EV, 'fix' 99 % — PASS; PD (front door) 0.31 EV, 2 reversals, 'fix' 99 % — better
    than the verifier's one-way +1.35 EV creep but still over the 0.2 target (the door's hardware glints in the
    fixation disk; Medium PD 0.15).
  · V5 LADDER (beamv, same pose: new MIS march + full 45° cone | old 12-step march + old 23.6° mesh (uBeamOld 1) | beam
    off; X/sheet-beamv.jpg, crops scratch/flash-fixr2/beamv-crops.jpg gamma 2.4): rain view — the old march draws a
    brighter wedge with 2–3 bands just beyond the torch head, the new one is smooth there; path view (pitch −15°) — no
    ladder in either at that pose. Subtle on screen at the gameplay exposure; the CPU replica (beamsim.mjs, re-run) old
    max error ±64 % between neighbouring rays → new ≤ 28 % per frame, 1 % averaged over the per-pixel offsets.
  · FPS (beamv, 7.5 s each, vsync-capped): path 57.05 / 57.05 / 57.05 avg (new / old / off), rain, porch, hall 60.0 in
    all three modes — the full cone costs nothing measurable at the cap; Max ≥ 45 holds in these views. (Headroom under
    the cap not measured: no uncapped mode in shot.mjs.)
- G2 = THE GATE (23:31–23:37, dist-flash-fix2 = the final tree incl. the elbow fold; QA_STRICT=1 QA_TORCH_ON=1, cs-frames
  wrapper with C1 29.5–30.5 / C2c 6.2–8.0 stepped; scratch/flash-fixr2/G2, G2.log): `done: ended=true beat=B13
  game=541.03s wall=316s deaths=0`, 17/17 assertions, 0 unstick rescues, console errors 0 · warnings 0 · exceptions 0,
  load 37.2 s, exit 0. (On battery from 23:07: no fps claimed from G2.)
  · C1 29.5–30.5 (C1-0, 61 frames): both gloves on the wheel, the torch hidden (torchVis 0, I 0 every row;
    scratch/flash-fixr2/c1-30.jpg); the one detect FLICKER (29.6, 39.5) is the oncoming headlights/wiper as the verifier
    found — not the arms.
  · C2c 6.2–8.0 (C2c-1): no black frame; the stumble 6.6–6.73 is still the white flash (V4, the cue's — request).
- Offline gates on the final tree (23:40–23:41): typecheck clean · npm test 349/349 · assets --check ok (low 26.99 / 27,
  medium 53.80, max 77.14 MB; no asset change). The final tree = G2's dist (21:36 build) + one comment-only edit in
  arms.ts (the fold's header comment).
- PERF note (the fold): +1 BVH ray per frame while the arm is active, up to 7 (≈ 0.05 ms each) when a wall is within
  ≈ 0.3 m of the elbow; no new passes, materials or draw calls.

### Fixer round 2 — FINAL JUDGE (harsh AD, biggest first) + what is left
1. The user's complaint — the beam getting dimmer as you approach a wall — is FIXED on Medium and Max at every site
   measured, judged where the player LOOKS (gaze luma): rooms U3N / G3E and the front door rise monotonically from 2 m
   to contact; the hot spot sits on the gaze point within ≈ 2.5 cm from 1.25 m in (was 13–16 cm above-right); it no
   longer hops over what you look at (real-time walk-in gaze falls: near zone ≈ 0–12, verifier 98–169).
2. Exposure: standing 0.7 m from a wall the frame no longer breathes (Medium 0.07–0.15 EV p2p, Max U3N 0.17; verifier
   0.66–1.23 with 4–6 reversals). Max at the front door 0.31 EV (2 reversals) — better, not perfect.
3. Contact: the pool no longer jumps at wall contact (G3E/U3N/PW FLICKER 20.5/17.0/28.3 → 2.6/3.4/0.8). Still not clean:
   (a) at G3N the polished bezel rim reflects the 9 klx pool as a thin sharp arc for ≈ 3 frames as the torch head leaves
   the bottom-left corner — the arms have no depth of field, so a rim 15 cm from the eye is drawn crisp where a camera
   would blur it to nothing; (b) at a 45° corner (U3O) the flicker is the SCENE (stays with every arm mesh hidden): the
   pool straddling the corner, a green shadow wedge from the corner trim, and a DOTTED rim on the spill disc when the
   lens is < 0.2 m from a wall (render-side; run E = torch shadow map on | off pending, see below).
4. The hand beside walls (NEW this round): the forearm no longer cuts into a wall on the torch side — the elbow tucks
   down, the fist and beam unmoved; reads as an arm. At a 3.6 m/s strafe the fold lags 2–3 frames (≤ 75 cells of sleeve
   behind the wall briefly).
5. Max volumetric beam: the old march's bright wedge/bands beyond the torch head are gone in the rain view; the shaft
   is now the full 45° cone with the spot's own falloff. It is a faint effect at gameplay exposure either way.
6. Still NOT photoreal (honest, unchanged by this round): the glove is a near-black silhouette in torch-lit rooms (glove
   albedo request stands); the torch core on near walls and cloth is a smooth white disc with a soft halo (no texture
   inside the core); fist-and-forearm enter from the left edge when looking down (the grip geometry, a design call); C2c
   6.6–6.73 is a white flash (V4, the cue's exposure — request below).

### Requests for the lead (FIX part 2, round 2)
1. SHIP COVERAGE: src/characters/arms.ts (elbow fold) and tests/arms-pullback.test.ts changed after the lead's 20:58
   dist-ship2 build — lead-ship2's five gates do not include them; G2 above (strict torch-on Medium) does. State at
   00:08: HEAD = d7022c7 "Ship 2" (round 1's V1–V3/V5 code is in it); this round's arms.ts fold, flashlight.ts beamOld
   QA switch and the two arms-pullback tests are UNCOMMITTED in the tree (git diff HEAD: 3 files, +190 / −6). A Max/Low
   playthrough on the final tree was not run by this lane.
2. V4 (C2c cue owner, FRAMES / SMOOTH-FIX): stop the film camera down 2–3 EV for 6.58–6.75 or move BEAM_CLAMP.at past the
   tread (details under "For other lanes").
3. Glove albedo (skin.ts / material-spec `leather_worn`, HAND request 1) still stands: the glove reads as a black shape.
4. Design call: depth of field for the first-person arms (or a near-eye fade of their specular) — the only way to remove
   the crisp bezel glint at wall contact (item 3a of the judge); not started.
5. Disk: 11–14 GB free during this round (the floor is 12); this lane's footprint is two 196 MB dists (deleted at the end)
   + ≈ 120 MB of run output. The big scratch users are other lanes' (scratch/fix 1.0 G, scratch/reverify 1.0 G,
   scratch/hunt 460 M).
6. Not committed (per the task); contract row #146d logged.
7. PERF/RENDER (pipeline.ts, not this lane): the torch pool's rim on a wall < 0.2 m from the lens shows a dotted/comb
   texture in stepped frames (U3O / G3N contact); E proved it is NOT the torch shadow map — likely the post grain or
   TAAU on a very steep gradient. One look in real time on that lane's tools.
8. Not run by this lane: the U4T back-stair landing look with the fold (offline: 8–15° elbow drop, nothing penetrated
   before) and Max/Low playthroughs on the final tree.
- E (Medium, 23:59–00:04, dist-flash-fix2, on battery; scratch/flash-fixr2/E): the dotted pool rim at U3O contact with the
  torch's shadow map ON | OFF (same seeded walk-in, arm meshes hidden; scratch/flash-fixr2/edgeab-u3o.jpg): BOTH the
  dotted rim and the green wedge are unchanged with the shadow OFF → not the torch shadow map (no bias change needed in
  flashlight.ts). The rim is the spot cone's falloff (penumbra 22.5–45° × the cookie's spill/tail) on a wall 14 cm from
  the lens, shown across a huge contrast ratio; its comb/dotted texture is most likely the post grain / TAAU on that
  steep gradient — PERF/RENDER lane (pipeline.ts) to look at. The wedge is scene geometry at the corner lit by the
  torch, not an artefact of the shadow. The run then FATALed in QA code: re-enabling castShadow at runtime crashes r186's
  ShadowNode ("Cannot read properties of null (reading 'depthTexture')") — a harness artefact (gameplay never toggles
  castShadow; setOn uses shadow.autoUpdate); 0 console errors before it. The U4T landing fold look (queued after it)
  did NOT run — offline only: the fold drops the elbow 8–15° in the 0.85 m landing where nothing penetrated before.
- CLEANUP (00:06): scratch/dist-flash-fix and scratch/dist-flash-fix2 deleted; run output kept in scratch/flash-fixr2/.

## Re-verify (part 2) — INDEPENDENT RE-VERIFIER of fixer rounds 1–2 (agent "reverify", 2026-10-19 00:07–; edits nothing in the project but this section)
Snapshot under test: `git stash create` bf4911e0 (00:07) → dist scratch/dist-flash-reverify (vite build 00:08, verify-boot OK).
Still valid at 02:40: the owned files (arms.ts, flashlight.ts, exposure.ts, look.ts, flashlight-bounce.ts, flashlight-rig.ts)
and pipeline.ts are hash-identical to the snapshot; the tree's only changes since are blender/scare/scare_tex.py, docs and
the manifests' `generatedAt`. Work dir scratch/flash-reverify/ (verify.mjs = the verifier's scenario unchanged + `hug`
(walk along a LEFT wall, fold column) + fold on|off A/B stills + `beamv` at the verifier's facade poses + HOLDS=2,0.7 +
the LOOKDISTS guard; chain.sh A B C E; holds.py, seqstats.py; the verifier's settled.py / gazewalk.py / detect.py).
- RESTART NOTE (re-verifier #2, 02:40): instance #1 built the dist, ran the offline gates + aimsim/elbowsim, queued run C at
  00:12; C waited for the JUMPSCARE Blender + another lane's Chrome, then its load STALLED 1800 s at "Compiling shaders —
  cutscene C4a" (01:32; the Mac went into Deep Idle around then) and the instance died. Nothing browser-side ran. Re-queued
  02:52 as A (Medium: beam + holds, CDP walk-ins ×7 + sprints, rt walk-ins, pan2, hand2, hug) → B (Max: look1, beam + holds,
  rt walk-ins, hand views, beamv) → C (strict torch-on Medium gate + C1/C2c frames) → E (Max gate + C2c).
- Offline gates on the current tree (02:4x): `npm test` 349/349 (test2.log) · typecheck clean (tsc2.log) · assets --check ok
  at 00:08 (low 26.99 / 27, medium 53.80, max 77.14 MB; no asset change since). CONFIRMED.
- Fixer claims checked offline: round 2's changes are uncommitted (git diff HEAD: arms.ts / flashlight.ts /
  arms-pullback.test.ts, 3 files +190 / −6) — CONFIRMED; contract row #146d — present; the V4 request under "For other
  lanes" — present (C2c cue owner, 0.458 / BEAM_CLAMP.at); `uBeamOld` defaults to 0 — CONFIRMED; the fold and aim are gated
  off under cutscenes / cues / BEAM_CLAMP / the car anchor (`free`, `armActive`) — CONFIRMED by reading. The verifier's
  aimsim on the current arms.ts gives miss 0.000 m from 1.25 to 0.3 m (2 m: aim 0, 27 cm under by design; 1.5 m: 7 cm) —
  the closed form solves the harness exactly, so it is weak evidence; the browser decides.
- RUN A (Medium, 1280×800, 02:52–03:15, load 204.5 s, exit 0, **0 console errors / 0 exceptions**, on mains from 03:10;
  scratch/flash-reverify/runA, ana.sh → settled.txt / holds.txt / gazewalk.txt / detect.txt / seqstats.txt):
  · V1 AIM (settled real time, the verifier's settled.py): GAZE luma 3 / 2 / 1.5 / 1 / 0.7 / 0.4 / 0.25 m — U3N 21 25 220
    241 246 247 248; G3E 21 17 126 242 246 248 249; PD 10 36 50 230 242 244 240; U4T – 22 183 234 246 241 242 (verifier
    U3N 30 – 57 134 159 245 234). Miss at 1 / 0.7 m: U3N 2.8 / 1.8 cm, G3E 2.8 / 2.0, U4T 2.1 / 1.8 (verifier 6–11 / 14–16,
    all UP; now ±1–2 cm, no consistent direction); lever 0.204 m unchanged. PD miss/pool columns are on the knob-padded
    blocker plane (fixer R2) — gaze only there. Real-time walk-ins (gazewalk.py): the NEAR zone (eye < 1.25 m) rises
    monotonically at all 4 sites (U3N 164 → 250 → 254, G3E 170 → 241 → 255, PD 68 → 127 → 250, U4T 189 → 233 → 242 with
    a 2-point dip 234 → 232 at 0.65 m); the biggest falls are in the FAR zone only (aim 0 by design): G3E 31.6 / U3N 18.0
    at 3.0 → 2.4 m (luma < 60), PD 64.7 at 3.2 → 2.8 m (the pool slides down off the gaze as you close in — the torch held
    low), U4T 14.0 at contact. Verifier 98–169 in the near zone → FIXED on Medium.
  · V2 HOLDS (holds.py; 13.4 s at 10 Hz after a 3.5 s settle): 0.7 m whole-trace p2p / reversals / last-10-s p2p — U3N
    0.48 / 0 / 0.12, G3E 0.39 / 0 / 0.15, PD 0.38 / 0 / 0.21, U4T **1.09 / 0 / 0.52** (one-way +1.09 EV, still climbing at
    13 s: target −2.80…−1.70 while the EV starts at the 1 m point's −3.71; 'fix' 100 %); 2 m: U3N 0.67 / 0 / 0.21, G3E
    0.18 / 0 / 0.09, PD 0.70 / 2 / 0.30 (target −2.50…−1.36), U4T **1.05 / 3 / 0.31** (target −4.09…−2.85 standing still).
    The verifier's 0.7 m breathing (U3N/G3E 0.92/0.93 EV, 4–5 reversals) is GONE (0 reversals, ≤ 0.15 EV last 10 s). The
    door CREEP is smaller but NOT gone at U4T (verifier +1.59 one-way → +1.09 one-way, unconverged); U4T 2 m still has 3
    reversals over 13 s (a 1.2 EV target range with aim 0). PARTIAL.
  · V3 CONTACT (detect FLICKER at contact, CDP walk-ins 1.6 m/s): G3E 2.1, U3N 2.1, PW 1.2, U3O 7.3, PD 6.2, U4T 8.3, G3N
    **12.5**, sprint PD 12.9, sprint U3N 8.1 (verifier 20.5 / 17.0 / 28.3 / 35.5 / – / – / 18.4 / 21.4). The pool no longer
    jumps (pool step ≤ 10 px at every flat-wall site). Still there (strip-contact-g3n-u3o.jpg, gamma 1.6): G3N f53–56 the
    thin sharp bezel glint crossing the lower left for 4 frames + a comb-dotted pool rim at f52; U3O f61–64 a pale green
    blade (the corner trim) flashing at the bottom as the pool straddles the corner. PARTIAL (as the fixer says).
  · ELBOW FOLD (new, hug sequences — eye 0.30 m from the U1 / G1 east wall on the torch side, walking south, pitch −30 / −10):
    fold 45–61° held, steps ≤ 2.4°/frame in U1, arm vertices behind the wall ≤ 81 (every 8th; all off-screen: the strip
    shows only the fist + torch head at the lower left, no forearm in the wallpaper). Fold on | off stills: no visible
    difference in these poses (the forearm is out of frame) — the fold does no harm here; its visual benefit is only in the
    fixer's S poses. G1: fold steps 17°/frame once (f104–106, passing the hall mirror) — off-screen.
  · NEW (G1 hug, other lanes): walking along the G1 east wall into P_MIRROR_HALL (the crepe-draped hall mirror) the player
    gets stuck and the camera HOPS 22 cm up and falls back every 8 frames (eye z 2.25 → 2.47 → 2.25, y fixed) — a step-up
    loop on the mirror's collider (player lane); meanwhile the torch is 8 cm from the black crepe, the meter opens to
    EV +2.9 and the barrel + both gloves render as pale cream-white objects (raw-hugG1-57-92.jpg) and FLICKER 69 at f57.
    Harness: `advance()` with W held — the same physics as a held key, but not seen with real input yet.
  · Pre-existing (identical in the verifier's runA/runB2 rows): at the end of a fast crouched look-down (5.3°/frame to −80°)
    the fist kicks back down 27 px @1280 in one frame (pitch-decoupling spring reversing) — FLICKER 14.8. Minor.
- RUN B (Max, 1280×800, 03:15–03:32 on mains, load 186.7 s, exit 0, **0 console errors / 0 exceptions**; runB/):
  · V1 (settled real time): GAZE 3 / 2 / 1.5 / 1 / 0.7 / 0.4 / 0.25 m — U3N 47 26 151 246 244 245 248, G3E 8 17 192 246 246
    246 249, PD 58 54 48 248 242 241 241, U4T – 129 166 205 224 229 229 (verifier Max U3N 9 81 206 136 235 247, PD 51 149
    111 94 173 156). Miss at 1 / 0.7 m: U3N 1.6 / 2.0 cm, G3E 1.5 / 1.8, U4T 2.8 / 1.0 (verifier 13–16 cm UP at 0.7). The Max
    U4T POOL (plane-centred) still dips 228 → 212 → 226 at 1.5 / 1 / 0.7 m, but the GAZE rises 166 → 205 → 224 — the leaf
    you look at no longer goes dimmer. Real-time walk-ins: biggest gaze fall U3N 5.3, PD 8.8, U4T 1.4 (verifier U3N 250 →
    166, PD 219 → 87). FIXED on Max.
  · V2 HOLDS 0.7 m (whole p2p / reversals / last 10 s): U3N 0.50 / 0 / 0.17, G3E 0.44 / 0 / 0.09, PD 0.45 / 0 / 0.15, U4T
    0.27 / 0 / 0.25 (verifier U3N 0.66 / 4, G3E 0.87 / 4, U4T 1.23 / 6, PD +1.35 one-way). The fixer's Max PD 0.31 with 2
    reversals is NOT reproduced: 0.15, 0 reversals here. 2 m: U3N 0.34 / 0 / 0.16, G3E 0.67 / 0 / 0.14, PD 0.82 / 2 / 0.38,
    U4T 1.46 / 3 / 0.15 (target −5.41…−3.63 standing still). Breathing at 0.7 m GONE on Max; at 2 m (aim 0) the door
    sites still wander 0.4–1.5 EV with 2–3 reversals in the first seconds. Note: at U4T Medium settles 2–3 EV brighter than
    Max (0.7 m: −2.62 vs −5.40) for a similar picture (u4t-med-max.jpg) — not investigated (a preset lighting difference).
  · V5 (the verifier's method: look1 gate-dark / drive-dark stills; v5-look1-ab.jpg = verifier 03:44 | now): the 5–6
    evenly spaced bars and the hard 23.6° wedge beyond the torch head are GONE in both views. Same-session A/B (beamv,
    v5-beamv-ab.jpg, old march + old mesh | new, gate / drive / rain): old shows the ladder in all three, new is smooth in
    all three. FIXED. Observation: at the gameplay exposure the new shaft is essentially invisible near the lens (no visible
    beam in the mist at all) — honest for a 27 lm torch in light rain, but the rain itself is not lit in the beam either.
  · LOOK (look-max-live-vs-now.jpg: live build runD | now): U1 wall 1 m a grey disc under the old claw → a hot core with a
    spill ring and the damask readable; sewing room a dim veil → the dress core and the floor read; B05 4 m and the upper
    hall unchanged. Better in every comparable view. Still not photoreal: the core is a smooth white disc with no texture,
    the far-wall pool 5 m down the hall is a glowing orb, the U1 'wall' spill rim has a dotted/comb texture.
  · HAND (hand-max-sheet.jpg: rain / idle / walk / wall / crouch / down45): the old claw is gone; the torch head with its
    silver ring and a black fist sit at the bottom-left / bottom-centre and read as "a torch held low". The glove is still a
    featureless black silhouette in every view (never reads as leather); in the G1 mirror case (run A) the same gloves
    turned pale cream-white at EV +2.9. It no longer looks weird; it does not yet look like a photographed hand.
- RUN C = THE GATE (strict torch-on Medium, cs-frames C1 29.5–30.5 / C2c 6.2–8.0; 03:39–03:45, load 39.7 s; runC/):
  `done: ended=true beat=B13 game=579.7s wall=352s deaths=0`, 17/17 assertions, console errors 0 · warnings 0 ·
  exceptions 0, exit 0. CONFIRMED (the fixer's G2 reproduced on the same tree).
  · V4 C2c stumble (route frames + detect, the verifier's method): luma 6.567 0.043 → 6.600 **0.341** → 0.456 → 0.501 →
    0.493 → 0.360 — frame-for-frame the verifier's (0.340 / 0.455 / 0.500 / 0.493 / 0.354) and the fixer's G2; min luma
    0.032 over 6.2–8.0 (no black frame); 7.567 → 7.600 drops ×0.19 on the glance cut. The white flash is UNCHANGED — NOT
    FIXED (the cue's exposure; request stands with the C2c owner).
  · C1 29.5–31: torch hidden every row (torchVis 0, I 0) — CONFIRMED; detect's one FLICKER (45.7 @ 29.6) is the frame the
    verifier and the fixer attributed to the wiper crossing the oncoming light (not the arms).
### Re-verify (part 2) — VERDICT (snapshot bf4911e0 = the current tree's runtime; biggest first) — E (Max gate) and H (hop probe) appended below when done
1. V1 near-wall aim overshoot — FIXED, CONFIRMED on Medium and Max with the verifier's own tools (settled.py GAZE + miss,
   gazewalk.py real-time walk-ins): the hot spot sits ≤ 2.8 cm from the gaze at 1 m and ≤ 2.0 cm at 0.7 m at every site
   (was 13–16 cm UP); the luma where you look rises monotonically from 1.5 m to contact; near-zone walk-in falls ≤ 14
   (was 98–169). The user's "dimmer as you approach" is fixed where the player looks. Residual by design: from 3 m to 2 m
   (aim 0, torch held low) the pool slides below the gaze and the gaze luma falls 18–65 points while the pool itself
   brightens (PD 3.2 → 2.8 m: 65).
2. V2 exposure breathing — the 0.7 m breathing is GONE (0 reversals at all 8 site×preset holds; last-10-s p2p ≤ 0.21 EV
   except one). NOT fully gone: Medium U4T (wardrobe leaf) still creeps one way +1.09 EV over 13 s at 0.7 m (unconverged,
   last 10 s 0.52) and at 2 m the door sites still swing (Medium U4T 1.05 EV / 3 reversals, PD 0.70 / 2; Max U4T 1.46 / 3,
   PD 0.82 / 2) — the disk-edge case the guard was meant for. PARTIAL. The fixer's "Max PD 0.31 / 2 reversals" was not
   reproduced (0.15 / 0 here).
3. V3 contact pop — PARTIAL, as the fixer says: the pool jump and TAA double core are gone (flat-wall FLICKER 1.2–8.3,
   was 17–35); the G3N bezel glint (a thin sharp arc for 4 frames, FLICKER 12.5) and the U3O corner flash (a pale green
   trim blade + a comb-dotted pool rim for 4 frames) remain.
4. V4 C2c stumble white flash — NOT FIXED (identical luma to the verifier: 0.043 → 0.341 → 0.501); not this lane's file.
5. V5 Max volumetric ladder — FIXED, CONFIRMED at the verifier's gate/drive stills and in a same-session old/new A/B
   (gate, drive, rain); 0 console errors on Max. The new shaft is all but invisible at gameplay exposure.
6. Elbow fold (new) — no harm found: hugging the U1 / G1 east walls it holds 45–61° with ≤ 2.4°/frame steps, the forearm
   never shows in the wallpaper, on|off stills are identical in these poses (the forearm is out of frame there).
7. NEW (other lanes): walking along the G1 east wall into the crepe-draped hall mirror the camera hops 22 cm up and falls
   every 8 frames — CONFIRMED in real time (run H: 14 hops of 0.206 m in 4.2 s; only with the eye ≈ 0.3 m off the
   wall, 0.45 m off it the player slides past). Cause not verified. With the torch 8 cm from the black crepe the
   meter opens to EV +2.9 and the torch barrel and both gloves render as pale cream-white shapes (raw-hugG1-57-92.jpg).
8. HAND / LOOK: the claw is gone; the fist and torch read as "a torch held low" on Max in every view (no longer weird),
   but the glove is a featureless black silhouette at normal exposure and pale white at high exposure — never leather.
   Max look vs the live build: better in every comparable torch-lit view; still not photoreal (white textureless core,
   the far-wall pool a glowing orb, a comb-dotted spill rim on near walls).
Gates on this tree: strict torch-on Medium playthrough → title, 0 deaths, 17/17 assertions, 0 console errors / warnings /
exceptions (run C) and on Max (run E); npm test 349/349; typecheck clean; assets --check ok (re-run 04:33: low 26.99 /
27, medium 53.80, max 77.14 MB). Runs A, B, C, E, H: 0 console errors / 0 exceptions. NOT checked by this pass: the
fixer's S-pose fold benefit (eye 0.28 m, pitch −35/−55: sleeve behind the wall 543–579 → 198–236), the strafe fold rate,
and fps (no fps part; run A started on battery).
- RUN E = Max GATE (strict torch-on, 04:2x, load 39.1 s; runE/): `done: ended=true beat=B13 game=625.43s deaths=0`, 17/17
  assertions, console errors 0 · warnings 0 · exceptions 0, exit 0. C2c stumble on Max: 6.567 0.043 → 6.600 0.148 → 0.202
  → 0.258 → 0.293 (verifier 0.147 / 0.202 / 0.259 / 0.295), min 0.027 — unchanged, tamer than Medium. CONFIRMED.
- RUN H = REAL-TIME HOP PROBE (Medium, rAF loop, W held through g.input, eye height every rendered frame, 04:28–04:31,
  0 console errors; runH/med-verify.json `hop`): walking south along the G1 east wall with the eye 0.30 m off it, the
  player stops at y 8.08 against P_MIRROR_HALL (pier mirror, box collider) and the eye SNAPS UP 0.206 m in one frame, falls
  back over ≈ 0.25 s, and snaps up again — 14 times in 4.2 s (eye 2.25 ↔ 2.48 m, 60 fps). 0.15 m and 0.30 m further from
  the wall the player slides past the mirror with no hop. The hop is CONFIRMED in real time. Cause NOT verified: most
  likely the step-up in src/player/controller.ts (STEP_UP 0.32 trial lift, STEP_MAX 0.27 cap) re-trying on the mirror's
  box every few frames. Player lane, not FLASH.
- CLEANUP (04:32): scratch/dist-flash-reverify deleted (no other scratch/dist-flash-* existed); run output kept in
  scratch/flash-reverify/ (123 MB). 16 GB free. Only this section of docs/STATUS-flash.md was edited.

### Requests for the lead (RE-VERIFY, part 2)
1. V4 stands with the C2c cue owner (FRAMES / SMOOTH-FIX): the stumble is still a ×8 one-frame white flash on Medium.
2. PLAYER lane (src/player/controller.ts): the step-up loop on P_MIRROR_HALL (run H) — the camera hops 21 cm three
   times a second while you walk into the hall mirror hugging the G1 east wall. A step trial that lands on a box higher
   than STEP_MAX should not lift the eye at all.
3. FLASH follow-up (this lane, if another round runs): (a) the door-site exposure — Medium U4T 0.7 m still creeps +1.1 EV
   one way over 13 s, and at 2 m (aim 0) U4T / PD swing 0.7–1.5 EV with 2–3 reversals on both presets; (b) the G3N bezel
   glint and the U3O corner flash at contact (needs the DoF / near-eye specular fade design call); (c) why U4T meters
   2–3 EV brighter on Medium than on Max for the same picture.
4. Glove albedo (HAND request 1) still stands: black at normal exposure, pale cream-white at EV +2.9 (the G1 mirror
   case), never leather.

## Fixer round 3 (part 2, agent "fix" #3, 2026-10-19 04:40–) — the re-verifier's V4 + NEW-G1 hop
Work dir scratch/flash-fixr3/; dist scratch/dist-flash-fix (current tree; deleted at the end). On mains, 17 GB free.
Plan: (1) G1 mirror hop — node repro of the step-up on P_MIRROR_HALL's per-mesh box colliders + a scratch-patched
controller as evidence (player lane's file: request only); (2) V4 C2c stumble — ownership discriminator: the APPLIED
exposure per frame and the pre-exposure HDR of the riser at the frozen 6.6 frame, Medium vs Max (the same cp / pt /
lens pos / 2 kcd / fixed 0.458, yet Medium's riser is a uniform white slab and Max's a hot core with texture —
scratch/flash-fixr3/med-vs-max-6.6-6.67.jpg); same-frame toggles (bounce / near field / bloom); (3) re-checks (beam
U3N + G3E, B05, C2c 15.5, C1 30) + the strict torch-on Medium gate.
### NEW-G1 mirror hop — ROOT CAUSE FOUND (offline, real geometry + the real controller; player lane's file → request)
- Repro (scratch/flash-fixr3/hopsim.ts: the REAL collision.glb + P_MIRROR_HALL from props_m1.glb placed as level.ts does,
  colliders from propColliderMeshes(…, 'box') + the REAL PlayerController, W held south along the G1 east wall): x 3.30
  → 15 hops > 5 cm in 4.2 s, max eye step 0.204 m/frame at 60 fps (30 fps 0.220, 144 fps 0.178), stuck at plan y 8.080;
  x 3.15 / 3.00 → 0 hops. Run H measured 14 hops, 0.206 m, y 8.08 / 0 / 0 — the same numbers. 'mesh' colliders: 14 hops.
- Cause: the pier mirror is one GLB mesh with 4 primitives → 4 oriented boxes. The frame box (wood) is 0.80 m wide,
  full height; the marble slab's box (enamel_chipped, 0.40–0.43 m above the floor) is 0.82 m wide — a 1 cm LIP proud of
  the frame on each side (crepe box too, from 0.86 m). Walking into the mirror's side the capsule's cylinder touches the
  lip (a wall contact) → the step-up trial (lift 0.32 m, move 1–13 mm) is clear → snapDown(0.37) finds the lip's top
  edge at the sphere's EQUATOR (edge rest, n.y ≈ 0.1) → feet 0.19 m up ≤ STEP_MAX 0.27 → accepted; the next substeps
  push the sphere off the 1 cm edge (the frame stands right behind it) and it falls 0.2 m in ≈ 0.25 s; repeat. The cap
  measures the sphere's BOTTOM, not where it is supported, and an edge rest has no tread behind it.
- Proposed fix (src/player/controller.ts, step(), off the designed stairs only): after the trial clears the substep move,
  the lifted capsule must ALSO fit STEP_TREAD = 0.12 m further along the move (a foot's depth) — otherwise it is a lip
  in front of a wall, not a step. Scratch copy scratch/flash-fixr3/controller-patched.ts (+12 lines, marked "FLASH fixer
  r3"); designed stairs (onStairs) keep the old rule.
- Evidence for the fix (offline): hopsim x 3.30 at 30 / 60 / 144 fps → 0 hops, max eye step ≤ 2 mm; tests/collision-
  stairs.test.ts against the patched copy 19/19 (ST_MAIN-like 0.25 / 0.28 m goings, the doorway lintel, the 0.25 m lone
  step, every step-cap case) + a new "1 cm lip in front of a wall" test ×3 fps: real controller FAILS (eye 0.238 m in
  one frame), patched passes (scratch/flash-fixr3/collision-stairs-patched.test.ts, -real.test.ts).
  House-wide sweep (scratch/flash-fixr3/stepsweep.ts: collision.glb + EVERY layout prop collider, the layout stairs for
  onStairs; 4768 walks = 0.5 m grid × 8 headings in 11 areas, 1.5 s at 60 fps): camera hops > 5 cm real 322 → patched
  105; the patch adds a hop nowhere; all 79 differing walks are hop sites (the mirror both sides — the real controller
  even ends PERCHED on the 1 cm lip at feet +0.22 —, the parlor stool P_STOOL, the zinc bucket P_BUCKET, the U3 stove /
  dress form); the 105 left are the stairs (ST_MAIN / ST_BACK treads lift the eye a riser per frame — legit, unsmoothed)
  and furniture tops ≥ 0.12 m deep under the 0.27 m cap (the bucket rim, a stove plinth) — the step cap's own call.
### V4 C2c stumble — browser session A (Medium 1280×800, dist-flash-fix = the current tree, --beat B03; 04:53–05:16,
0 console errors / 0 exceptions; scratch/flash-fixr3/A, r3.mjs, ana.sh)
- A FOUND DISCREPANCY: on the real route walked from B03 (the c2c-handover walk → C2 → C2c, no input, stepped 1/30 s) the
  stumble is NOT a white flash: luma 6.567 0.043 → 6.600 **0.145** → 0.184 → 0.220 → 0.193 → 0.081 → 0.199 → 0.211 →
  6.835 0.148 (gate runs C / G2 / the verifier: 0.341 → 0.456 → 0.501 → 0.493 → 0.360). Same camera (cp / pt identical to
  the mm), same lens (lp ±2 mm), I ≈ 2000 cd, the applied exposure 0.458 every frame. The picture is the hot core on
  riser 13 with its stains readable, the tread top in grazing spill (scratch/flash-fixr3/A-vs-runC.jpg: left = this
  session, right = gate run C — a uniform white riser under a milky full-frame veil). Before the drop (≤ 6.567) both
  runs match to 0.001 luma: the difference appears only on the near-surface frames. → V4's white flash is a STATE the
  gate playthrough carries into C2c (it did not come from Medium vs Max: Max's gate frame looks like this session's).
  The gate run G (queued) logs the applied exposure, the cutscene fx (DOF / blur), scene scale, bloom, the bounce and
  torch base intensity, the near-field switch and the shadow autoUpdate per frame to find which.
- Frozen same-frame A/B at 6.600 (pre-exposure HDR, look.hdr, uv 0.5/0.7 = the riser under the core): base 23.05 · bloom 0
  22.6 · torch core 0 → **1.84** (the core is 92 % of it) · spill + tail 0 → 20.2 · near field off (+ bounce 0, a
  sequencing slip) 15.7. At 6.667 (the camera in the treads, lens 0.18 m from the tread) the centre is spill-lit: 5.09 →
  spill 0 1.39, core 0 4.27. Display: bloom 0 removes the haze over the tread top (luma 0.165 → 0.124); sheets
  scratch/flash-fixr3/A/med-ab-6.600-sheet.jpg / -6.667-sheet.jpg (base | bloom 0 | bounce 0 / near 0 | core 0 | spill 0).
- The cue owner's two levers emulated on a C2c replay from 6.20 (cutscenes.player.play startAt, same session; the base
  replay matches the route frames to ±0.03 luma; scratch/flash-fixr3/replay-base-stop-far.jpg rows base / stop / far):
  · stop (−2.5 EV over 2 frames from 6.58, held to 6.75, back by 6.85): peak 0.220 → 0.087, the riser still reads; the
    frames look under-exposed (a dark vignette), 6.733 0.041.
  · far (BEAM_CLAMP-style aim up the flight, plan (0.55, 8.1, 4.4) ≈ 1.25 m, for 6.46–6.85): WORSE — 6.467–6.5 the wall
    loses its pool (0.034 → 0.009) and 6.767–6.833 are BLACK frames (0.000–0.002: the camera whips to her hand while the
    beam stays up the flight). Not recommended.
- Mirror (B03, the re-verifier's hop pose): 10 hops > 5 cm (max 0.22 m) in 3 s of W held — confirmed again in the
  browser; standing against the mirror the frame is metered 'key', exposure 0.61 (EV −0.71), lens 0.147 m from the
  collider box: the gloves are not cream-white at B03's lighting (the re-verifier's EV +2.9 case was at B05 —
  scratch/flash-fixr3/A/med-mirror-stand.jpg). Residual, not chased.
- IN THE BROWSER (H, Medium, --beat B05, a QA-only build scratch/dist-flash-hop = the tree + the patched controller
  injected by scratch/flash-fixr3/vite.hop.config.ts — the tree's controller.ts untouched; the re-verifier's real-time
  rAF hop probe, W held through g.input; 05:37–05:41, 0 console errors / 0 exceptions): x 3.30 → 248 frames, eye
  2.250–2.258 m, max up-step 0.001 m/frame, **0 hops** (run H on the live tree: 14 hops of 0.206 m), the player stops
  against the mirror at y 8.08 as before; x 3.15 / 3.00 → 0 hops, they slide past the mirror as before. Dist deleted.
### Gate G (strict torch-on Medium, cs-frames C1 29.5–31.5 + C2c 6.2–8.0, 960×600, dist-flash-fix = the current tree;
05:12–05:37 incl. queue; scratch/flash-fixr3/G)
`done: ended=true beat=B13 game=581.73s wall=316s deaths=0`, 17/17 assertions, console errors 0 · warnings 0 · exceptions 0,
load 171.6 s, exit 0. C1 29.5–31.5: the torch hidden every row (torchVis 0, I 0). C2c stumble: luma 0.043 → 0.340 →
0.455 → 0.500 → 0.492 → 0.359 (the verifier's numbers again). Per-row state (XROW): applied exposure 0.458, the beam
hit 0.536 m at 6.6 (session A: 0.535), bounce 2.06 cd (A 2.09), torch base 2000 cd, the near field on, the torch shadow
updating, cutscene fx {motionBlur 0} (no DOF), scene scale 0.75, bloom 0.22 — the LIGHTING STATE IS THE SAME as session
A's, where the frame is a textured core (0.145). Max session X (my route, 1280×800) = the Max gate run E frame for frame
(0.146 / 0.203 / 0.257 / 0.277 vs 0.148 / 0.202 / 0.258 / 0.293) and its pre-exposure HDR = Medium A's (riser 22.6 vs
23.1; 6.667 centre 5.07 vs 5.09). So the white flood is not light, exposure or FLASH state: it is the Medium gate's
RENDER of the same HDR — 960×600 at scale 0.75 (≈ 720×450 internal) vs 1280×800 in A. Session A2 (= A at 960×600,
queued) separates resolution from the route.
### Restart (agent "fix" #3 restarted, 06:51–) — A2 + L were run but not written up; then the route-state discriminator
- A2 (= session A at the gate's 960×600, B03 route, 05:39–06:04, 0 console errors / 0 exceptions; scratch/flash-fixr3/A2):
  luma 6.567 0.044 → 6.600 **0.150** → 0.188 → 0.221 → 0.181 → 6.737 0.031 → 0.230 → 0.205 → 0.149 (A at 1280×800:
  0.145 / 0.184 / 0.220 / 0.193 / 0.081). Frozen 6.600 render toggles: base 0.129 · bloom 0 0.091 · sharpen 0 0.133 ·
  scale 0.60 / 0.85 / 1.00 → 0.136 / 0.134 / 0.137 (pre-exposure riser 23.2–24.6 in all). → RESOLUTION AND SCALE ARE
  RULED OUT: the white flood (gate 0.340 / 0.455 / 0.500) appears only when the game is PLAYED FROM THE START (C0 → C1 →
  … → C2c, the gate route), never after a `?beat=B03` jump. The earlier "RENDER of the same HDR at 960×600" guess is wrong.
  Side note (not chased): the B03 route has a one-frame dark dip at 6.737 (A 0.081, A2 0.031) that the gate frames do
  not show (0.493 → 0.360).
- Zero-cost row diff (G/C2c-1 vs A/med-c2c, every field both log, 6.50–6.80): camera pos / pitch identical to the mm,
  fov 37.85, lens ±3 mm, torch I 1970–2010 cd vs 1996–2014, exposure 0.458, lightning 0, no hide, draw calls equal
  (± 2). Nothing logged so far differs → run S (gate route, STOP after C2c, the pre-exposure HDR probe + a full state dump:
  every pipeline uniform, look.get(), the cutscene profile, the torch spot's cone / shadow, renderer / camera / scene,
  a census of every visible light) and run T (the same dump on the B03 route at 960×600); diff.
- L (beam re-check, Medium 1280×800, --beat B03, 05:39–06:07, 0 console errors / 0 exceptions; scratch/flash-fixr3/L,
  sheet L-sheet.jpg = U3N 1 m | U3N 0.4 m | B05 4 m / C2c 15.5 | B05 2.3 m | C1 30 s from gate G):
  · BEAM CURVE 3 / 2 / 1.5 / 1 / 0.7 / 0.4 / 0.25 m (settled.py): U3N GAZE 28 30 221 240 247 247 247, pool 198 234 244
    249 252 247 248, miss at 1 / 0.7 / 0.4 m 3.0 / 2.0 / 0.8 cm; G3E GAZE 64 17 215 241 244 248 249, pool 218 235 240 249
    253 249 250, miss 2.7 / 2.1 / 0.8 cm. Same as the re-verifier's run A (U3N 21 25 220 241 246 247 248) — monotonic at
    the gaze from 1.5 m to contact; the pool's 252 → 247 at 0.4 m is the near-field clamp (5 luma, not visible).
  · HOLD 0.7 m: U3N last 10 s 0.07 EV / 0 reversals, G3E 0.08 / 0 ('fix' 100 %).
  · B05 4 m e 0.665 'key', p98 109, 0 % clip (stair, banister, Ada and her lamp read); B05 2.3 m e 0.317 'fix' p98 79;
    C2c 15.5 e 0.459 cue, p98 78; C1 30 s: both gloves on the wheel, torch hidden (torchVis 0, I 0) — all as round 2.
  · Look (harsh): the U3N core is still a smooth textureless white disc inside a hard-edged spill ring; the thin
    vertical line under the core at 1 m / 0.4 m is the damask motif's own stem (cropped at gamma 1.4: seam.jpg — the same
    stem repeats in the pattern columns; G3E plaster shows no line), not a cookie seam. G3E's plaster cracks read as thick
    dark drawn lines (material lane, not FLASH).
- S (GATE route, Medium 960×600, cs-frames SCENE=C2c 6.45–6.8 STOP=1 PROBE=1 + the state dump xrow-state.js; 06:58–07:00,
  0 console errors) vs T (B03 route, r3.mjs, same dump + the same PROBE box; 07:04–07:14, 0 console errors; T's first
  attempt was killed while waiting for a Blender job, exit 130, re-run): the flood REPRODUCES in S (luma 0.043 → 0.340 →
  0.455 → 0.500 → 0.492 → 0.357) and not in T (0.044 → 0.151 → 0.191 → 0.223 → 0.182). PRE-EXPOSURE HDR (look.hdr, the
  centre 62 % box): 6.567 S 0.298 / T 0.307 → 6.600 **S 20.8 / T 3.85** → 6.633 36.1 / 2.68 → 6.667 41.7 / 3.30. → it is
  LIGHT in the scene pass (5–13× more), not the post chain / grade / exposure. The dump diff at 6.600 (statediff.mjs):
  every pipeline uniform, every look.get() value, the cutscene profile (C2c, scale 0.75), the torch spot (angle 45°,
  penumbra 0.5, decay 2, shadow 1024 / bias / near / far), renderer (pr 1, 960×600, AgX), camera (near 0.03, fov 37.85),
  scene, lightning 0 — ALL IDENTICAL. Light census: the same 7 visible lights (torch 1974 vs 2022 cd, bounce, landing
  candle, U2 lamp, 3 probe grids); only the bounce differs (S 2.07 cd 0.88 m from the eye, T 1.01 cd 2.16 m — the
  bounce's every-2nd-frame hit update falls on 6.600 in the gate route and on 6.567 / 6.635 in the B03 route).
- Hypotheses tested and FALSIFIED in the gate route (same luma and HDR to ±0.003 / ±0.5 %):
  · U1 — the cookie reading a one-frame-old shadow matrix (r186 lightProjectionUV uses light.shadow.matrix; outside the
    projected box SpotLightNode skips the cookie = 2000 cd everywhere): a pre-render hook forcing
    light.shadow.updateMatrices(light) on every frame → 0.340 / 0.454 / 0.499, HDR 20.9 (unchanged).
  · W — the bounce light (look.set({bounce: 0}) from 6.467) → 0.340 / 0.454 / 0.499, HDR 21.0 (unchanged); the logged
    bounce geometry is sane (4 cm off the hit, axis along the surface normal, facing the lens).
  Queued: Y (B03 route with ONE extra 0.1 ms frame before the window: flips every every-2nd-frame cadence in the game),
  K (gate route, a same-frame A/B kit at 6.600: torch 0 / core 0 / spill 0 / bounce 0 / reflections 0 / probe grids 0 /
  other lights 0 / torch shadow intensity 0 / near field 0 / arms hidden + the material under the beam) and KB (the same
  kit on the B03 route).
- Y (B03 route + one extra 0.1 ms frame before the window, 07:47–08:14): unchanged (0.152 / 0.191 / 0.224, HDR 4.2) — the
  extra frame did not flip the bounce's cadence either (inconclusive; the bounce is ruled out by W anyway).
- K (gate route) vs KB (B03 route), same-frame A/B kit at 6.600 (abkit.js: 3 × 0.1 ms frames per variant, pre-exposure
  HDR at the 62 % box / the riser below the core (uv 0.5, 0.72) / the upper wall / the riser's right end; sheet
  K-vs-KB.jpg). The beam lands on the same mesh + material in both (G1_stair_2, trim_chipped, lightmapped, roughness 1).
  | variant | gate box / riser / right | B03 box / riser / right |
  | base re-render | 12.1 / 110 / 0.26 (stepped frame: box 20.8) | 4.49 / 16.5 / 0.28 (stepped: 3.85) |
  | torch 0 (torchCd 0.001) | 0.005 / 0.014 / 0.014 | 0.005 / 0.013 / 0.014 |
  | core 0 | **13.3 / 59 / 8.7** — the frame turns a uniform white | 0.63 / 1.76 / 0.29 (as physics says) |
  | spill + tail 0 | 10.9 / 114 / 0.015 | 4.1 / 15.4 / 0.015 |
  | near field 0 | 12.2 / 110 / 0.28 | 4.5 / 11.8 / 0.30 |
  | bounce 0 / reflections 0 / probe grids 0 / other lights 0 / torch shadow intensity 0 / arms hidden | ±3 % | ±3 % |
  → ALL of the flood is the torch's own light (torch 0 kills it), but in the gate route the riser's torch light does not
  behave like the cookie: removing the hot core leaves half of it and BRIGHTENS the rest of the frame 30×, and the near
  field (which only acts on the core) does nothing there. The flood also decays under re-renders (box 20.8 stepped → 12.1
  after 3 frozen frames) — something per-frame. Queued K2 / KB2: the riser material's explicit LightsNode list dumped in
  both routes (every light, in-scene or not, its world pose), 6 frozen re-renders (decay curve), and two variants:
  every other light in that list at 0, and the torch narrowed to 5°.
- K2 (gate route, 08:27–08:50, 0 console errors): the riser's explicit LightsNode list is the same 4 lights as built at
  load (torch, bounce, the hall candle and parlor lamp at 0) — no ghost / duplicate light. Frozen re-renders of the SAME
  frame are not stable in the gate route: K base box 12.1 / riser 110 / right end 0.26, K2 base 23.3 / 158 / **9.1**
  (K's "core 0" frame, 13.3 / 59 / 8.7, is the same 'flood' state — so core 0 did not cause it). The stepped frame is the
  flood every time (S / U1 / W / K: 20.8–21.0). A 5° cone (K2 'narrow') leaves the core disc + bright OUTLINES on every
  stain and on the nosing edges with the riser between them dark — an edge-only term. Queued K3: a per-render trace
  (12 frozen re-renders: HDR + the spot's angle / shadow fov / the riser centre's projected light coordinate / the
  lens pose / scale / draw calls) + a forced material rebuild + a fresh material clone on the riser.
- K3 (gate route, 08:54–09:20): 12 frozen re-renders all in the flood state (box 21.6–23.0 / riser 169–175 / riser end
  8.8–9.1) while the JS side is identical to the B03 route to the mm (lens (0.387, 4.042, −7.198) vs (0.385, 4.039,
  −7.195), target, angle 45°, shadow fov 90°, I 1983 vs 2022 cd, scale 0.75, 960×600). material.needsUpdate on the
  riser: no change. A fresh material clone: the riser loses the torch entirely (0.014 — a clone is not a valid A/B).
  → the GPU-side data of ONE draw differs from the JS state.
### V4 — ROOT CAUSE FOUND (KB3, 09:19–09:37, B03 route, 0 console errors): the riser's draw uses the cookie's OLD values
| probe (pre-exposure HDR) | gate route, flood (K2 / K3) | B03 route, base (KB3) | B03 route + cookie set to flashlight.ts's INITIAL uniform values (KB3 `defaults`) |
| 62 % box | 22–24 | 4.51 | **24.4** |
| riser below the core (uv 0.5, 0.72) | 158–174 | 14.8 | **162.8** |
| riser right end (uv 0.85, 0.72) | 8.7–9.1 | 0.29 | **9.03** |
| upper wall (uv 0.5, 0.2) — another draw | **0.057** | 0.059 | 2.06 |
flashlight.ts declared the cookie uniforms with the round-2 profile (core 0.87, σ² 0.012, spill **0.13**, shelf 0.4,
tail **0.02**); look.ts's live profile (copied in by surfaces.ts on the first frame) is 1 / 0.0036 / **0.0035** / 0.4 /
**0.0008** — 37× less spill, 25× less tail. On the played route the stair risers' draw (G1_stair_2 / trim_chipped)
renders with the old values (260 cd of "spill" on a riser 0.53 m away = 906 lux → the uniform white slab) while the wall
above it — another draw — has LOOK's (0.057 in the gate = B03's 0.059; forcing the old values everywhere lights it 35×).
The uniforms were plain OBJECT-group uniforms (one UBO per draw); which draw keeps its creation-time copy depends on
the route (a ?beat=B03 jump never shows it). Exposure, the cue, the bounce, the shadow matrix, reflections, probes,
other lights, the arms and the resolution are all ruled out above (S/T/U1/W/K/K2/K3). → V4 is THIS lane's (flashlight.ts),
not the C2c cue owner's: the three earlier V4 requests (exposure stop-down / BEAM_CLAMP.at) are WITHDRAWN — the stop
under-exposes the stumble and the far aim gives black frames (session A replays above).
### FIX (in the tree; contract #146e) — src/render/flashlight.ts + src/render/flashlight-bounce.ts
1. Every uniform the cookie reads (uTorchCore / Sigma2 / Spill / Shelf / Tail, uTorchPos, uTorchLit, uTorchNear,
   uBeamOld) is in three's shared RENDER group (`.setGroup(renderGroup)` — one UBO written once per render; three's own
   pattern for light uniforms, Lights.js lightShadowMatrix): no draw can hold a private stale copy.
2. Their initial values are LOOK's live profile (a draw frozen at creation values is frozen at the right ones).
3. TORCH_POOL (the arms' pool env, written every frame) likewise in the RENDER group.
typecheck clean; npm test 349/349 (test4.log); built scratch/dist-flash-fix2 (verify-boot OK). Browser verification
queued: K4 (old dist: does the stale draw follow later value changes at all — for the systemic request), K5 (fix2,
gate route: stepped C2c 6.2–8.0 + the kit), G2 (fix2, the full strict torch-on Medium gate), L2 (fix2, beam U3N/G3E).
- K4 (OLD dist, gate route, 09:38–10:0x, 0 console errors): stepped 6.600 = the flood again (luma 0.340). Kit at 6.600:
  base re-render box 4.51 / riser 15.7 / end 0.28 (= B03's correct values this time) → spill + tail 0 → riser **106** →
  tail 0 alone → 105 → old values → 157. The stale draw DOES follow later value changes, but not to the values set:
  after "spill 0" it shows a spill near the OLD 0.13, not 0 — the riser's copy of the cookie uniforms is unreliable
  (it lags / lands on the wrong values) rather than simply frozen. Consistent with a per-draw object-UBO bookkeeping
  fault for uniforms shared across many programs, not with any value this lane writes. Systemic request below.
### V4 AFTER the fix — K5 (scratch/dist-flash-fix2 = the fixed tree, GATE route, strict torch-on, C2c 6.2–8.0 stepped
+ the kit at 6.600; 09:38–10:2x incl. 40 min behind JUMPSCARE Blender jobs; **0 console errors / 0 exceptions**)
| C2c t | 6.567 | 6.600 | 6.633 | 6.667 | 6.700 | 6.733 | 6.767 |
| gate BEFORE (S) luma | 0.043 | **0.340** | 0.455 | 0.500 | 0.492 | 0.357 | 0.302 |
| gate AFTER (K5) luma | 0.043 | **0.148** | 0.186 | 0.221 | 0.188 | 0.057 | 0.215 |
| B03 route (T, old dist) | 0.044 | 0.151 | 0.191 | 0.223 | 0.182 | 0.032 | — |
| gate pre-exposure HDR box before → after | 0.298 → 0.300 | **20.8 → 4.45** | 36.1 → 2.60 | 41.7 → 3.39 | 46.1 → 3.18 | 19.8 → 0.44 | 9.3 → 4.25 |
Kit at 6.600 on the fixed gate route: base box 4.40 / riser 16.2 / end 0.285 (B03 4.49 / 16.5 / 0.28); torch core 0 →
riser 1.67 (B03 1.76: the draw follows the look values live now); the OLD values forced → 23.8 / 159.5 / 9.04 (the
fingerprint reversed: the flood is exactly the old profile). Sheet scratch/flash-fixr3/v4-before-after.jpg (top: gate
before 6.600 / 6.633 / 6.667 — a white slab under a milky veil; bottom: after — the hot core on riser 13 with its
stains, then the riser in spill with the core on the tread). FIXED.
- Residual now visible on the played route (was masked by the flood; the B03 route always had it): a ONE-FRAME DARK DIP
  at 6.733–6.736 (luma 0.188 → 0.057 → 0.215; HDR 3.18 → 0.44 → 4.25) as the lens passes ≈ 0.10 m from tread 13
  (hitD 0.096–0.128). Not V4. Probe K6 queued (kit at 6.73: torch shadow off / shadow near plane 0.02 / near field /
  bounce / arms hidden).
### GATE G2 on the fixed tree (scratch/dist-flash-fix2; strict torch-on Medium, cs-frames C1 29.5–31.5 + C2c 6.2–8.0,
960×600, PROBE every 3rd frame; 10:07–10:32 incl. the queue; scratch/flash-fixr3/G2)
`done: ended=true beat=B13 game=528.77s wall=296s deaths=0`, **17/17 assertions, console errors 0 · warnings 0 ·
exceptions 0**, load 243.5 s (the full shader recompile of the new uniform layout happened inside the normal load;
not a regression signal — G was 171.6 s and other lanes' Blender jobs were running), exit 0.
- C2c stumble (route frames): 6.567 0.043 → 6.600 **0.148** → 0.186 → 0.222 → 0.204 → 6.733 0.113 → 0.195 → 0.230
  (before, gate G: 0.340 → 0.455 → 0.500 → 0.492 → 0.359). C1 29.5–31.5: torch hidden, I 0 every row.
- detect.py FLICKER on C2c 6.2–8.0 got WORSE in number while the picture got right: f16 @6.733 114 (before 49), f12 @6.600
  72.8 (before < 10). Before, the flood saturated every frame white, so whips hardly changed the pixels; now the
  frames carry texture and the whip shows. f12 is the stumble's own content change (the riser enters the view, turn
  11.7°, step 0.24 m). f16 is the residual one-frame dark dip (below).
- THE 6.733 DARK DIP (scratch/flash-fixr3/dip-sheet.jpg: 6.700 | 6.733 | 6.767): mid-whip (detect: turn 29.4° then
  53°, labelled CUT) the torch is being swung from the chest clutch out to the glance-#2 pose (lens 0.297, 7.043 →
  0.408, 7.150 → 0.704, 7.119: 0.15 then 0.30 m per frame) and its beam crosses tread 13 0.13 m under the lens — BELOW
  the frame; that one frame is lit only by the riser's spill (pre-exposure box 0.44 vs 3.2 / 4.3 either side). It is
  in every route and run (B03 0.031–0.081, K5 0.057, G2 0.113): MOST LIKELY choreography (the C2c camera whip + the
  stumble_catch torch swing) — inferred from the frames; the same-frame probe (K6: torch shadow off / shadow near
  plane 0.02 / near field / bounce / arms hidden at 6.733) was NOT run, so a torch-side cause is not excluded. Request
  to the C2c / FRAMES owner below, with that caveat.
### L2 — beam + look re-check on the fixed tree (Medium 1280×800, --beat B03, 10:32–10:35, 0 console errors / 0 exceptions)
- BEAM CURVE 1.5 / 1 / 0.7 / 0.4 m (settled.py): U3N GAZE 136 242 247 247, pool 245 249 251 249, miss 12.2 / 3.1 / 1.7 /
  0.8 cm; G3E GAZE 218 242 248 248, pool 240 250 253 249, miss 5.5 / 3.0 / 1.4 / 0.9 cm. 1 m → contact unchanged from L
  (monotonic at the gaze). U3N 1.5 m GAZE 136 (L 221): the aim spring was mid-settle at that read (miss 12 vs 6 cm, aim
  weight 0.74 both) — the aim is geometry (arms.ts, untouched), not shading; G3E 1.5 m matches (218 vs 215).
- LOOK CHANGE (honest — scratch/flash-fixr3/look-L-L2.jpg): with every draw on LOOK's profile, views where the B03 route's
  draws had held the OLD profile get darker outside the hot core. CAVEAT: L vs L2 are two B03 sessions of stills that are
  not deterministic (K vs K2 differed on the same frame); p98 94 → 18 is too large for hand sway, so the reading is
  CONSISTENT WITH stale draws in L, not a same-frame A/B (confirm: the kit's `defaults` variant at the sewing pose). B03 sewing still: before, the window frame, floor
  and a wide pool around the dress form read (p98 94); after, the dress form's hot core in a near-black room (p98 18).
  B05 4 m: e 0.665 → 0.448 'key', p98 109 → 87, the banister / stair a little dimmer. The PLAYED route's hero shots barely
  move (gate G vs G2, gate-G-G2.jpg: upper-hall-ada 0.0131 → 0.0107 linear luma, Harlan's bedroom 0.0185 → 0.0162 — the
  far-wall hot spot keeps its pool, less halo). The old profile is physically wrong for the CLAUDE.md torch: 260 cd of
  spill to 22° ≈ 120 lm on top of the core (the spec is ≈ 27 lm at 2–3 kcd; LOOK's profile integrates to ≈ 31 lm, and a
  27 lm / 2 kcd torch has room for a spill of ≤ 0.5 % of peak). The darker rooms are what the documented torch does;
  which surfaces showed the brighter spill before was a route-dependent accident. If the AD wants the room more
  readable, the honest knob is LOOK.torchSpill / torchTail (FLASH-owned): 0.005 / 0.001 stays inside ≈ 28 lm.
### GATE GX — Max on the fixed tree (strict torch-on, C2c 6.2–8.0 frames, 960×600; 10:35–10:5x incl. the queue)
`done: ended=true beat=B13 game=515.57s wall=228s deaths=0`, **17/17 assertions, console errors 0 · warnings 0 ·
exceptions 0**, load 252.4 s, exit 0. C2c stumble on Max: 0.043 → 0.149 → 0.206 → 0.258 → 0.291 → 6.733 0.115 → 0.237
(Max before, re-verifier run E: 0.148 → 0.202 → 0.258 → 0.293 — Max's riser draw was not stale on that run; the 6.733
mid-whip dip is there too). Cleanup 10:5x: scratch/dist-flash-fix + dist-flash-fix2 deleted; run output kept in
scratch/flash-fixr3/ (51 MB); 15 GB free.
### LOW — gate GL on the fixed tree + a same-route BEFORE (11:0x–11:2x; builds dist-flash-fix3 / dist-flash-before —
the before = the tree with this round's uniform change undone in memory by scratch/flash-fixr3/vite.before.config.ts)
- GL (fixed, strict torch-on Low, C2c 6.2–8.0 frames): `done: ended=true beat=B13 game=598.57s wall=195s deaths=0`,
  **17/17, console errors 0 · warnings 0 · exceptions 0**, load 107 s. C2c: 6.567 0.040 → 6.600 0.111 → 0.160 → 0.192
  → 0.173 → 6.733 **0.0003** → 0.153.
- GLB (BEFORE, same route, Low, STOP after C2c; 0 console errors): 0.040 → **0.211 → 0.332 → 0.396 → 0.393** → 6.733
  **0.0015** → 0.208; pre-exposure HDR 21.1 / 36.0 / 41.4 / 46.0 (the same flood as Medium's) → after 4.4-ish. So Low
  had the white flash too and it is fixed; and the 6.733 frame is BLACK on Low both before and after (pre-existing:
  no bounce / fill on Low, so the one frame whose pool sits just below the frame edge — camera pitch −31.5°, the hit
  51° below the horizon, the frame's bottom edge at −50.5° — has nothing lit in view; dip-low.jpg, gamma 2.5: only the
  riser's cone-edge glow). A one-frame BLACK flash on Low at the stumble — user-visible; request 4 (C2c / FRAMES).
- Both dists deleted (11:2x).
### Fixer round 3 — FINAL JUDGE (harsh AD, biggest first) + what is left
1. V4 (the C2c stumble white flash) — FIXED, root cause in THIS lane: the torch cookie's uniforms were per-draw
   object-group uniforms initialised to a stale round-2 profile (37× LOOK's spill); on the played route the stair
   risers' draw rendered with it. Now every cookie uniform is in the shared render group with LOOK's values. Gate route
   6.600 / 6.633 / 6.667: luma 0.340 / 0.455 / 0.500 → 0.148 / 0.186 / 0.222 (Medium, K5 and G2), pre-exposure HDR 20.8 →
   4.45; the frame is the hot core on riser 13 with its stains, then the riser in spill. The session-A note above ("not
   light, exposure or FLASH state … the Medium gate's RENDER of the same HDR") was WRONG: it was light, and FLASH's.
2. NEW, now visible on the played route (the flood used to hide it; the B03 route always had it): a one-frame dark dip at
   C2c 6.733 (0.20 → 0.06–0.11 → 0.20, Medium and Max; a fully BLACK frame on Low, 0.0015 before the fix → 0.0003 after —
   pre-existing) — most likely the swinging torch's beam crossing the tread just
   below the frame mid-whip (inferred; the same-frame probe was not run). Request to the C2c / FRAMES owner with that
   caveat. A user who reads one-frame pops as bugs will see it.
   HAND after the TORCH_POOL move (hand-L-L2.jpg, B05 2.3 m fist crop, L vs L2): unchanged — still a black fist.
3. LOOK change from the fix (honest): surfaces that used to get the stale bright spill on some routes now get LOOK's
   physical 7 cd spill — the B03-route sewing still lost its readable floor and window (p98 94 → 18); the played-route
   hero shots barely moved (−15 % at most). The torch now does what its documented ≈ 31 lm / 2 kcd profile says; whether
   the room should read more is an AD call on LOOK.torchSpill / torchTail (0.005 / 0.001 stays ≈ 28 lm).
4. NEW-G1 mirror hop — root cause found, patch verified offline (322 → 105 hops house-wide, none added) and in the
   browser (QA build: 14 hops → 0); the player lane's file — request below, not applied.
5. Still not photoreal (unchanged this round): the hot core is a smooth textureless white disc; the glove is a black
   featureless silhouette at normal exposure; the far-wall pool 5 m away reads as a glowing orb; G3E's plaster cracks
   are drawn lines (material lane).
6. Systemic risk (lead / RENDER): other runtime-written globals are the same object-group pattern (uLightning,
   uSkyFill, …) — request 2. Gates on the final tree: typecheck clean, npm test 349/349, assets --check ok (low 26.99 /
   27, medium 53.80, max 77.14 MB), strict torch-on Medium gate G2 and Max gate GX to the title with 0 console errors /
   warnings / exceptions, and the Low gate GL likewise; beam curve U3N / G3E monotonic at the gaze from 1 m to contact (L2).
### Requests for the lead (FIX part 2, round 3)
1. **V4 — WITHDRAW the three earlier V4 requests** (this file's "For other lanes" V4 entry, round 2's request 2, the
   re-verifier's request 1): the C2c stumble's white flash is not the cue's exposure and not BEAM_CLAMP.at — it was this
   lane's torch cookie uniforms (root cause + fix above, contract #146e). The emulated exposure stop-down under-exposes
   the stumble (6.733 luma 0.041) and the far aim gives black frames (6.767–6.833 0.000–0.002): neither should be built.
2. **SYSTEMIC (RENDER / lead):** a plain module-level `uniform()` (OBJECT group: one UBO per draw) that is written AFTER
   draws were created can reach some draws late / wrong on some routes (K4: after `spill = 0` the stale riser draw
   showed a spill near the OLD value, not 0; on the B03 jump the same draw is fine). The torch's are fixed (RENDER
   group). The same pattern exists elsewhere — values written every frame or on events, read by many programs:
   `uLightning` (lightmap-material.ts: the lightning flash lightmap — a stale draw could miss a stroke or keep it),
   `uSkyFill` (C6 blue hour), `uReflection` / `uReflLod` / `uCandleSpec` / `uSpecProxyLo/Hi` / `uOpenSkyE` (initial
   values = LOOK's today, so a frozen copy is harmless until someone tunes LOOK), `materialUniforms` (bind.ts),
   `GLARE_BASE` (pipeline.ts, post — one draw, low risk), SKY_U (atmosphere.ts). Recommendation: `.setGroup(renderGroup)`
   for every global that the game writes at runtime (three's own pattern for light uniforms), and initial values equal
   to the synced ones. One stepped check: lightning on the played route (C0 → B03) vs a `?beat` jump, lightmapped walls.
3. **PLAYER lane (src/player/controller.ts) — the G1 hall-mirror camera hop (NEW-G1)**, root cause + verified patch:
   P_MIRROR_HALL's marble-slab box stands 1 cm proud of its frame box at 0.40–0.43 m; walking into its side the step-up
   trial lifts the capsule onto that lip as an EDGE rest at the sphere's equator (0.19 m ≤ STEP_MAX 0.27 → accepted),
   the next substeps push it off and it falls 0.2 m over 0.25 s: a 0.2 m camera hop ≈ 3× a second. Patch (12 lines, off
   the designed stairs only): after the trial clears the substep move, the lifted capsule must also fit STEP_TREAD =
   0.12 m further along the move (a foot's depth) — else it is a lip in front of a wall. `scratch/flash-fixr3/
   controller-patched.ts` (diff vs the tree: the STEP_TREAD const + the `if (!onStairs)` block; NOTE the scratch copy
   reads `process.env.STEP_TREAD` for the node sims — in the real file it must be a plain `const STEP_TREAD = 0.12`).
   Evidence: hopsim.ts (real collision.glb + mirror colliders + the real controller: 15 hops → 0 at 30/60/144 fps);
   `collision-stairs-patched.test.ts` (19/19 + a new "1 cm lip in front of a wall" case ×3 fps that the real controller
   FAILS: eye +0.238 m in one frame) and `-real.test.ts`; `stepsweep.txt` / `stepsweep-patched-hops.txt` (4768 walks
   over every collider: camera hops > 5 cm 322 → 105, none added; the 105 left are stair treads (a riser per frame —
   unsmoothed, the player lane's call) and furniture tops ≥ 0.12 m deep under the 0.27 m cap); browser run H (QA build
   with the patch injected, real-time W held: 14 hops of 0.206 m → 0).
4. C2c / FRAMES owner (c2c-up.ts + blender/anim/clips_escape.py stumble_catch): the one-frame dark dip at C2c 6.733 (luma
   0.20 → 0.06–0.11 → 0.20 on every route on Medium / Max, a BLACK frame on Low before and after this round's fix;
   dip-sheet.jpg, dip-low.jpg) — the beam's hit sits 51° below the horizon, the frame's bottom edge at −50.5° — mid-whip the swinging torch's beam crosses the tread just
   below the frame (inferred from the frames; FLASH's same-frame probe K6 — shadow near plane / arms hidden — was not
   run: route it back to FLASH first if the swing is not the cause). Options: ease the swing so the pool stays in the
   bottom of the frame for that frame, or let the whip carry the cue's motion blur on Medium. Not V4 (FLASH can retime
   the arms clip if the cue owner wants the swing changed — ask).
5. Load time: the fix changes the WGSL of every torch-lit program (render-group uniforms), so every one recompiles at
   load (no new variants). G2 / GX loads were 243 / 252 s with other lanes' Blender + Chrome jobs running (G earlier:
   172 s; Low GL 107 s) — re-measure the ship build's load once, quietly. All three presets
   now gated on the fixed tree: Medium G2, Max GX, Low GL — 17/17 each, 0 console errors / warnings / exceptions.
6. AD call (LOOK.torchSpill / torchTail, FLASH-owned constants): with the fix every surface gets LOOK's physical spill
   (7 cd, ≈ 31 lm total). Rooms outside the hot core can read darker than some earlier screenshots, which (route-
   dependently) showed surfaces lit by the stale 37× spill (look-L-L2.jpg — consistent with that, not a same-frame A/B).
   If the AD wants the room more readable within the CLAUDE.md torch (≈ 27 lm, 2–3 kcd), 0.005 / 0.001 stays ≈ 28 lm;
   the old 0.13 is ≈ 150 lm and must not come back.
7. Not committed (per the task). Contract row #146e logged. scratch/dist-flash-fix, -fix2, -fix3 and -before deleted;
   run output kept in scratch/flash-fixr3/ (QA scripts: abkit.js, abwrap.mjs, r3.mjs, run2.sh, statediff.mjs,
   xrow-*.js, vite.before.config.ts).
