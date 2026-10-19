# STATUS — JUMPSCARE lane (contract row #147; later agents 147b, 147c …)

User request (2026-10-12): "when she catches you, a jumpscare should appear, with her face in the frame, only her face,
super fucked up, horrifying and scary, with detailed bruises and scars, photo realistic graphic". Lead ruling (ap) in
docs/ROADMAP.md: the face is her SEVERED HEAD thrust up to the lens (catches only happen from B05 on), a pre-rendered
Cycles sequence played full-frame through the game's post chain, DEATH_DURATION stays 3 s.

## Progress log
- 2026-10-12 SPEC agent (#147): spec below. Nothing in the game changed. Budgets at spec time (`assets --check` ok):
  Low 26.99/27 MB (10.4 KB left), Medium 53.91/60 (6.0 MB left), Max 77.25/120 (42.7 MB left).
  Measurements: see "Probe" at the end of the spec (scratch only, nothing shipped). The probe ran twice under the
  lock-first protocol (blender.lock held, then waited for the running headless Chrome): run 1 rendered black (a parent-
  inverse bug in the probe script, fixed), run 2 is the data. Blender 5.2.1 API names introspected (no render).
- 2026-10-12 FACE BUILDER (#147b, restarted after an API cut-off). Found: `blender/scare/` (scare_head 409 lines,
  scare_tex, scare_hair, scare_scene, scare_render, scare_preview) + pipeline job `scare-look`, all written by the
  cut-off agent and NEVER RUN (no scare log, scratch/jumpscare empty). DEVIATION (logged as contract row 147b):
  `scare_head.py` is NOT the `body.anatomy` + `ada.with_wound` head of Spec §1 but a from-scratch SDF head built on
  Farkas-norm landmarks (lids as shells on the globe, nose lobules/alae/nostrils, split lips, open mouth with teeth
  meshes, TMJ jaw warp, cleaver cut). Kept: the in-game head is the "plaster mask" to beat, and the identity cue
  that matters (long black wet hair, gaunt face) survives. Fix 1: `scare_head.sweep()` densifies its mm table once at
  0.5 mm (sdf.sweep re-densified at 0.01 per call = ~18 k Python iterations per SDF evaluation in mm units, which
  would have made hair integration take tens of minutes); it now honours the table's `cx` column (nose tip 1 mm to her
  right, as the rows intended). numpy preview (scratchpad, not trusted for anatomy: sphere-tracer oversteps a
  non-Lipschitz field, clipped by a 175 mm sphere) suggests beady eyes in a trench around the globe. Next: smoke the
  job at 640x400/16 spp/h 1.5, then a `--clay` anatomy render, then look rounds r1..r8.
- 147b anatomy pass 0 (numpy cross-sections + profile probes in the scratchpad; exact, no tracer). Fixes in scare_head:
  (1) orbital window pocket E+(s2.5,-1,2) r(18,21,14) cut only in front of the globe's equator + a fitted socket
  (r = R_LID_IN): the old 14.5 mm pocket left a cone hole under a brow 8-10 mm proud, and the eye read as a bead; the
  lid shells (2.35 mm upper at z 9, 3.7 mm lower) are now the skin with an open sulcus under the brow; no void behind
  the globe; (2) fissure slot only through the shell (r <= R_LID_IN+5; was +7: a 7 mm moat); (3) upper-lip skin filler
  (a 5 mm notch at z -46..-51) + philtral columns/groove moved ONTO the skin (the groove capsule was a buried tunnel);
  (4) oral cavity slab z -67.5..-50.5 (was to -71.5: it cut the lower lip off the chin) + a lower labial mass -> profile
  sn -35, ls -38, li -37.5, labiomental fold 4.7 mm, pog -31 (rest); (5) septum (the two vestibules met across the
  midline: a merged nostril seen from the hero camera below); (6) jaw = hinge + condylar glide (0,-6,-1.5) mm per 9 deg
  with an exact inverse (`unrotate_jaw`): a pure 9 deg hinge pushed the menton 15 mm back into the throat and the
  inverse warp folded the neck (notch/spike at the cut); band 19 mm. Teeth spasm key composed like the head's.
  Void flood-fill at 1 mm: only the 0.35 mm tear-film gap remains (correct). Smoke job queued behind another lane's
  headless-Chrome session.
- 147b (restart 2, 22:05): found the smoke job ran twice: run 1 (640x400/16 spp/h 1.5) crashed in
  `scare_scene.eye_texture` (np.stack shape mismatch); run 2 = `--clay` r0 (960x600/32 spp/h 0.8, 323 k verts, 4.8 s
  render, peak RSS 831 MB) -> scratch/jumpscare/look-r0-clay.png. **AD verdict r0 clay: a crude rubber bust, not a
  face.** Goggle-ring eyes (lid shell + pocket = a flat annulus with a hard rim), tube nostrils hanging under a knob
  tip, detached alar wings, lumpy cheek/jaw lobes (separate ellipsoids), a brow "visor", sausage-ring lips, forehead
  furrows like cuts. Lighting: the core SPOT (14.5 deg, blend 1) is ZERO beyond 7.25 deg off-axis, so the corneas are
  -5.5 EV and the jaw bruises -8.6/-12 EV under the upper lip (RESULT ev_rel_upper_lip): eyes and bruises go black.
  Plan: (1) torch with a real fall-off tail (stacked spots), (2) pitch 10-12 deg chin-up (20 put the nostrils at frame
  centre), (3) full-material smoke, (4) anatomy fixes in hero-view priority: eyes, nose base, cheek/jaw masses, lips.
- 147b restart 2, 22:50 — (1) **torch**: `scare_scene.fit_torch` = the GAME's live torch (look.ts LOOK.torch*: 2000 cd,
  near-field core s2e = s2 + D^2/8d^2, 7 cd shelf, 1.6 cd corona, cone 45/penumbra 0.5) fitted by NNLS with a stack of
  blend-1 Cycles spots (2.5..46 deg; at 0.37 m: 7 spots, peak 1228 cd, profile 0/-1.1/-2.6/-4.6/-6.3 EV at
  0/4/6/8/10 deg). Physical consequence: only a ~7 cm disc of the face is in the core, the rest sits on the 7 cd
  shelf (~-7 EV) -> injuries that must read go inside ~8 deg of the aim. `--aim x,y,z` (default nose, her right) and
  `--pitch` (default -12 chin-up; 20 put the nostrils at frame centre) job args. (2) **full-material smoke** (old head,
  640x400/16 spp): runs clean, 4.2 s render, peak RSS 1.8 GB -> scratch/jumpscare/look-rsmoke.png (still the rubber
  bust). (3) **head rebuilt as a RADIAL RELIEF head** (scare_head.py r1): per-z cross-sections around a vertical axis +
  ~35 smooth relief terms (brow, sunken orbits + deep upper-lid sulcus, tear troughs, malar, arches, buccal hollows,
  folds, nose dorsum/tip lobules/alae/columella, philtrum, lips, muzzle, mentolabial, chin, jawline, masseters) on a
  0.25 deg x 0.5 mm grid; eyes/nostrils/oral slit/cavity/ears/cut stay SDF. Profile measured vs Farkas: nasion -21.3
  (z 8), rhinion -32.5, pronasale -46.8 (z -30), subnasale -26.3, ls -32, li -32.8, pogonion -30, menton -15.
  Teeth arches moved 4.5 mm back (incisors ~11 mm behind ls; the cavity front was 4 mm under the lip skin).
  scare_tex re-placed for the new geometry (bruise centres projected onto the skin, normal-facing gates, folds now in
  the relief, a fresh black eye on her LEFT eye under the hair). Next: clay r1 in Cycles, then material r1.
- 147b look rounds (1920x1200, 64 spp + OIDN, AgX preview at fixed EV -10.5; scratch/jumpscare/look-rN.png):
  * **r1** (look-r1.png; render 83 s, total 226 s, 290 k verts, 24 k scalp + 804 face strands): a CG porcelain
    doll. Eyes = dark holes with glowing orange rims; beige-pink waxy skin; lit pig-snout nose base; black-box mouth;
    hair a straight curtain. Diagnostics: no-hair render (look-r2diag.png) still had black globes with a catchlight
    -> a 15 s one-off Blender test (lock held) showed the eye albedo image read back ALL ZEROS: `image_from` set the
    pixels and THEN the colour space, which regenerates a GENERATED image's buffer. Fixed (colour space first).
    Numpy hero-camera trace (scratchpad tools/herocam.py) confirms the fissures are open from the camera.
  * r2 fixes: eye albedo; grey-green pallor (0.245/0.262/0.272) + 2-4 cm violet/green blotches + finer mottle;
    lid margins darker and SSS x0.4 there; SSS radius (0.75, 0.42, 0.32) x 1.6 mm; SDF crease occlusion -> silt
    (darker/browner/rougher folds); nose base: alae as rounded lobules + curved alar-facial crease rings (the polyline
    grooves drew rectangles), real 10.5 x 5.5 mm nostril openings; philtral columns halved; laceration axis on the
    skin (it left a hanging 0.1 mm flap).
  * **r2** (look-r2.png, sheet-r2.png; render 71 s): the milky dead eyes now read (big horror gain). Still CG:
    uniform waxy tan skin, NO injury visible, black-box mouth, bright pig-snout nose base under the low torch. At 100 %
    the face looked soft: not DOF (forehead depth 0.279 m vs focus 0.281) but missing micro-detail — the wet coat had
    a 3x smoother normal than the skin, so every highlight was plastic-smooth; OIDN at 64 spp smears the rest.
  * r3 fixes: coat follows the skin relief; furrows widened (were sub-pixel); bump 0.08 mm; water beads (2.9 mm
    cells, 30 % x wet, 0.35-0.9 mm caps, full coat); silt in pores; injuries moved INTO the lit zone (fresh black eye
    on her right eye, yellow-green bruise on her right cheek, old bruising round her left orbit, a nosebleed from her
    right nostril over the upper lip, crescent scar on her right cheekbone, paler/pinker brow scar); torch 0.25 m
    below the eye level (43 deg), f/8 (spec f/5.6: deviation, the face must be sharp in a 1 s clip).
  * **r3** (look-r3.png, render 74 s): nosebleed + a yellow-green bruise read. Still CG: skin shows no texture even at
    100 % (base roughness 0.48), lid margins read as orange rubber rings, globes flat ping-pong white, nose base wide.
    Found: the game applies a 3300 K indoor white balance (look.ts wbIndoorK, strength 1), grain 0.03, vignette 0.4,
    CA 1 px (camera-fx.ts filmFinish) — the previews had none (that is why the skin read orange-tan).
  * r4 changes: preview = Blender view WB 3300 K + the game's filmFinish re-implemented in numpy (vignette, 1.5 px
    value-noise grain with the mid-tone bell, 1 px lateral CA) -> look-rN.png (raw AgX kept as look-rN-agx.png);
    torch aimed between the nose bridge and her right eye; base roughness 0.38; thin pink waterline instead of the
    orange rim; greyer globes, darker ghost iris, tache noire bands; narrower nose base; rounded oral cavity, tongue up.
  * **r4** (look-r4.png, sheet-r4.png) and **r5** (look-r5.png, sheet-r5.png; 64 spp, render 77 s, total 234 s, peak
    RSS 2.28 GB; r5 changes per code comments: upper lid just covers the top of the limbus, camera at HER eye level
    looking down 8.4 deg (r1-r4 looked up the nostrils)) + a 512 spp inspection crop (look-r5-crop.png, border
    700,180,1120,560, 122 s). **r6** (look-r6.png, sheet-r6.png; 96 spp, render 131 s, total 223 s, peak RSS 2.86 GB;
    +0.4 EV preview, grey-violet lips, blue-black bruise core, plum rim). These three rounds were rendered by the
    cut-off agent and never logged; logged here by the restart (#147c).
- 147c (FACE BUILDER restart 3, 2026-10-13). **AD verdict r6 (100 % crop, scratchpad r6crop.png): still a CG
  mannequin, not a photograph.** Worst first: (1) under-lighting from 0.27 m straight below = the campfire-story
  cliché; the tip shadows the whole dorsum, so the nose reads as a dark smear above a wide, flat, lit pig-snout base;
  (2) eyes = white eggs inside thick pink rubber rings (lid margins); (3) mouth = sausage upper lip over a black box
  (no teeth visible); (4) skin = uniform grey plaster: stipple on the forehead only, no mid-scale colour or specular
  break-up; (5) face strands = thick, defocused 10 px smears; (6) the face fills ~1/3 of the frame width.
  EV probes r6: split lip -6.2, thumb bruise -8.6, cheek scar -5.0 EV under the upper lip: the injuries are unlit.
  The game's torch is camera-local (0.18 right, 0.16 down, 0.05 fwd) (flashlight.ts:125), not the spec's
  (0.06, -0.27).
  * r7 changes (flags only): torch at the GAME's offset `--torch 0.18,-0.05,-0.16` (right, fwd, up; three's +z is
    behind the lens), core still aimed at the face (default aim -8,-26,-14) — in the game the beam axis converges at
    3 m, so a face at 0.24 m sits ~36 deg off-axis on the 1.6 cd tail: the cutscene stages the torch ON her (the
    player's reflex), physically the same lamp. New `--center` flag (scare_render: the head point at the frame
    centre); `--dist 0.24 --center -6,-24,-52` puts the brow at y 74 px and the cut front at y 1054 of 1200
    (scratchpad tools/frame.py, same math as scare_scene), 0.129 mm/px at the eye (was 0.145).
  * **r7** (look-r7.png, sheet-r7.png; 96 spp, render 116 s, total 154 s, peak RSS 1.80 GB; EV re upper lip: eye R
    +2.1, nose tip +1.4, brow scar 0, fingertips -3.4, thumb bruise -4.1 (was -8.6), cheek scar -4.7, split lip -6.9).
    Side light gives the nose real form (lit tip/ala); the dark blob over the bridge is now the nose's cast shadow.
    Still CG. 200 % eye crop (scratchpad r7eye.png): a VEIL of free-hanging scalp strands 1-4 cm in front of her
    right eye (defocused grey smear, the "clear eye" of the spec is not clear), red petechiae dots ON the clouded
    cornea (the eye-texture filter |az| > 22 lets them inside the 28.9 deg limbus), forehead petechiae read as a rash
    of saturated paint dots, pink rubber-ring lid margins, upper lashes sparse.
  * r8 changes: veil filter in scare_render (drop scalp strands with a point > 2.5 mm off the skin inside |x| < 44,
    -112 < z < 40, y < 5: 910 of 24 000 strands, all rooted at the front hairline; `--veil` keeps them); conjunctival-
    only eye petechiae (angle from the axis > 31.5 deg); skin petechiae dark red-purple (0.105/0.022/0.032), sparser,
    0.13-0.4 mm; lid-margin band 1-3.5 deg (was 1.5-5) and less saturated; lashes 150 upper / 85 lower (were 95/60),
    0.12 mm root; 256 spp (OIDN at 64-96 spp smeared the pores; the 512 spp r5 crop shows the pore relief exists).
  * **r8** (look-r8.png, sheet-r8.png = r7 | r8; 256 spp, render 303 s, total 405 s, peak RSS 2.54 GB; 24 880 strands
    after the veil cut; EV re upper lip: eye R +3.4, eye L +1.6, nose tip +1.4, brow scar +0.8, cheek scar -2.3,
    fingertips -3.3, chin -3.3, thumb bruise -5.2, split lip -7.0 (the split-lip / chin probes use REST positions, so
    with the jaw open they can land in the mouth gap: unreliable). Cost note: 303 s/frame at 256 spp → the 30-frame
    sequence ≈ 2.5 h (below the spec's 3.4-5.6 h estimate).
    **AD verdict r8 (100 % crop, scratchpad r8crop.png): better, NOT a photograph** — it reads as a good game-cinematic
    character render. Gains: her right eye is clear (eye contact), lashes read, the shiner / yellow-green cheek bruise /
    nosebleed are visible, more face fills the frame, and the forehead (wet sheen + pore relief at 256 spp) and the
    plastered wet hair ropes on her left are the most convincing parts. What still reads as CG, worst first:
    1. **Eyes**: ping-pong globes; the ghost iris (a Gaussian ring at 19 deg + a centre dot in eye_texture) reads as a
       BULLSEYE; lid margins are smooth pink rims (the shell's flat margin face, no fillet, no wet posterior edge, a
       dark 0.35 mm crevice where a bright tear meniscus should be); upper lashes evenly spaced = a strip lash (needs
       irregular spacing, wet clumps of 3-6, varied length/angle).
    2. **Old bruise** = a flat, hard-edged yellow decal (needs a 5-10 mm soft edge, low saturation, yellow-green core
       → brown-grey rim, pores showing through, layered under the fresh bruising).
    3. **Nosebleed** = a painted stripe (needs 0.3-0.5 mm thickness, a wet coat, darker drying edges, varying width,
       a bead at the lip).
    4. **Nose cast shadow** = a black smudge with an odd outline (a single torch, no fill: physically right, reads
       wrong). A 1-3 % bounce fill from the player's own body/hand at 0.2-0.3 m would be physical and would let the
       shadow read as shadow.
    5. **Cheeks / lower face** = smooth grey plaster (the forehead's pore field and wet break-up do not carry down);
       upper lip = a smooth sausage roll; the mouth = a black void with a sliver of teeth.
    6. Hair hanging at the frame sides is unlit black (fine) but contributes no wet specular glints.
  * **Stopped at the 8-round cap** (task: "stop when it reads as a photograph, or after 8 rounds"). The SDF/relief
    sculpt + procedural shading has improved every round but has NOT crossed into photographic; do not render the
    sequence on this still.
  * **RIG BUG found + fixed (jaw-spasm frame).** The first spasm render (`--round 8 --frame spasm`, 128 spp, 153 s) was
    bit-identical to the hero apart from noise (mouth crop PSNR 45 dB; tiny 240x150 runs: max diff 0.0). Bisected
    under the lock (scratchpad tools/sk_*.py, oneoff.mjs): the key data move 9.6 mm (head) / 8.4 mm (lower teeth) and
    render fine when set explicitly; the cause is that **Blender 5.2's `shape_key_add()` creates the key at value
    1.0**, so EVERY hero still r1-r8 was rendered WITH the spasm on (jaw 9 + 6 = 15 deg) — the r8 "hero" I judged IS
    the max-spasm pose. Fix: `scare_scene.build_head/build_teeth` set `k.value = 0.0` at creation, and scare_render
    sets 0 (hero) / 1 (spasm) explicitly before the camera/torch/Cycles setup; RESULT now carries `spasm_key`.
    Verified: tiny hero (0.0) vs spasm (1.0) differ in 2 168 px of 36 000. Side note: setting the value immediately
    before `bpy.ops.render.render` aborted Blender at render start (SIGABRT, `NSURL initFileURLWithPath: nil`) 3 of 3
    times; set early it never did. The SEQUENCE agent must keyframe the key value and check frames actually differ.
  * **Rig proof** (look-r8rest.png = jaw at rest, 128 spp, render 151 s, `spasm_key` 0.0; look-r8-spasm.png = max
    spasm, 128 spp, `spasm_key` 1.0 by the old default; sheet-r8-spasm.png = rest | spasm, lower-face crop): the lower
    lip and chin drop ~30 px and the mouth opens taller; mouth-crop PSNR rest vs spasm 35.0 dB (hero vs spasm before
    the fix: 45.4 dB = noise only). Honest: the motion is subtle on screen because the lower face sits in the torch
    fall-off (chin -3.3 EV), and the plastered hair curves have no shape key, so strands on the chin do not follow the
    jaw (the sequence needs the face strands re-integrated per frame or bound to the jaw weight).
  * Housekeeping: stale scare cache pruned (.cache/scare 472 MB → 52 MB: the current head/teeth/hair npz kept);
    `assets --check` ok (low 26.99/27, medium 53.80/60, max 77.14/120 MB; nothing shipped by this lane).
  * **Next (for whoever continues; the look is NOT approved)**: fix in this order — (1) eyes: replace the
    Gaussian ghost-iris ring with an irregular haze over a faint radial iris, fillet + wet the lid margins, add a bright
    tear meniscus, irregular wet lash clumps; (2) old bruise: soft 5-10 mm edge, low saturation, layered; (3)
    nosebleed with thickness and a wet coat; (4) a 1-3 % body-bounce fill so the nose shadow reads as shadow; (5) carry
    the forehead's pore/wet break-up down the cheeks, re-shape the upper lip, light the mouth interior. Re-judge at
    256 spp (OIDN at 64-96 spp smears the pores). Every look render with the explicit key value (hero = 0).
- **147d FACE BUILDER, fix round 1 (2026-10-13).** Input: the independent AD review round 1 of look-r8rest.png
  (verdict FAIL: "a good 2010s game-cinematic CG render / a latex mask"; the review text handed to this agent is
  TRUNCATED inside problem 3, so ranks 1-3 + the summary are the brief; full text requested from the lead). Ranked:
  (1) skin = plaster at frame scale + a Voronoi DISTANCE_TO_EDGE "crackle-glaze" lattice at 100 % (vor3, scale 1100,
  constant depth) on single-scale F1 pores, no mid-scale colour / lividity / marbling, an even water sheen; (2) eyes =
  contact-lens buttons (bullseye ghost-iris ring + centre dot + limbus ring painted on a raised disc), a smooth pink
  margin gasket with a dark crevice instead of a tear meniscus, paint-dot petechiae, a strip-lash comb, dry fanned
  brows; (3) BRIEF MISS: the severed neck is invisible (a smooth rounded edge, 3-7 EV under the core) and the grip
  bruises do not read -> a lighting + pose + cut-geometry decision; summary also names the rectangular puppet-slot
  mouth, the nose's cast shadow as a black hole, matte black wire hair, and unreadable brow scar / crescent scar /
  split lip / marbling. Measured first: the aperture is ~21 x 11.5 mm in the frame (globe pixels of look-r8rest,
  scratchpad fx/meas.py) and 23 x 11 mm frontal (fx/aperture.py) — not 28 x 22; the doll read is the painted
  cornea (texture limbus at 28.9 deg vs the geometric cornea/sclera junction at 24.3 deg = a disc bigger than the
  dome) + sclera round the cornea + no lid overlap. PLAN (one batched Blender job per round, full frame 128 spp + 512
  spp crops of eye and throat in the same session): skin micro-relief rebuilt (no Voronoi edges; per-region pore
  density/size via cell colour; 4 Langer-line phase families as vertex attributes, two spacings, noise-broken; mid-
  scale mottle/marbling/lividity contrast up; coat roughness islands); eyes rebuilt (separate clear cornea dome over
  an iris disc + a frosted noise-density haze layer; upper lid over ~1 mm of the limbus; meniscus curves; margin
  shaded by radius in the shader; clustered petechiae + diffuse injection; clumped lashes; plastered brow clumps);
  neck: retracted ragged skin edge over an exposed tissue band, protruding trachea stump, drips; torch aim/offset
  chosen by a numpy irradiance search over the probes before rendering.
  * 147d r9 changes (all batched into one job; contract row 147d): head h 0.6; eyes rebuilt (iris recessed 0.32 mm
    behind the limbal plane, clear dome IOR 1.376 + frosted haze cap, upper lid at 21.5 deg over ~1 mm of the
    limbus, lower at -28 with a little scleral show, medial lacrimal-lake pocket + caruncle (r1-r8's caruncle was
    carved away by the slot), 1.0 mm margin fillet, margins shaded by radius in the shader (wet posterior mucosa,
    grey line), tear meniscus curves, new eye texture: random-walk branching vessels, clustered irregular
    petechiae, flat crisp-edged haemorrhage, tache noire, dead iris + oval pupil — cached in .cache/scare);
    mouth almond (power-1.15 profile, was sqrt = vertical ends); neck: torn skin edge + exposed tissue band +
    trachea stump + 2 tags + 2 drips; skin shader: no Voronoi edges, irregular two-scale pores, Langer-line
    families H/V/C/D at 0.55 + 1.25 mm, criss-cross, wet islands vs drying patches (coat 0.03 / 0.33); albedo
    mottle up (lit-cheek std 0.37 EV), hue noise, faint venous net on the lit face, blotchy lividity; old
    bruises as multiplicative tints; scars wider with darker borders, no pores, roughness 0.22; nosebleed with
    body + drying edges + bead; lashes in wet spikes (3 rows, clumps, 12 % strays); brows 105/side plastered
    in 3-5 clumps; wet hair (Chiang rough 0.14, coat 0.5). Mirror + aim + metered EV (see row 147d).
    Numpy tools (scratchpad fx/): light.py (torch irradiance + shadows, EV probes), aperture2.py (frontal eye
    trace), px.py (feature pixel positions in the mirrored frame), etest.py (eye texture preview).
  * **r9** (look-r9.png, sheet-r9.png = r8 | r9, crops look-r9-crop0/1/2-agx.png = eye / neck / cheek; 128 spp main
    324 s + crops 384/256/384 spp 80/71/58 s, job 998 s incl. the Chrome queue, peak RSS 2.9 GB, 519 530 verts;
    EV re upper lip: eye R +0.1, nose tip -0.4, chin -1.9, fingertips -2.8, trachea -3.6, thumb -4.4, cut front -4.4,
    eye L -7.7 (was cut/chin/thumb -6..-7 in r8); metered EV -7.65). **Self-review: still CG, partly worse.**
    Worse: the metering target (+3 EV) washed the face to white porcelain. Eyes: the haze cap stopped 0.3 mm short
    of the limbus, so the uncovered dark iris root drew a crisp ring round a flat white disc = the contact lens again;
    the new caruncle is a saturated pink bead. Better: the neck now reads from the front (torn bloody rim, drips,
    trachea) but the trachea is a clean white plastic bottle neck with a screw thread and the drips are red candle
    wax; the mouth is an almond (no slot) but pink puffy doll lips over a lit "denture"; the fingertip and cheek
    bruises are visible on the lit side; no cell lattice anywhere at 100 % (the crackle-glaze item passes) but
    pores are still invisible on the cheek; face hair = black tape; lashes a splayed comb; the nose's cast shadow
    still a black blob on her far cheek. r10 fixes: metering 0.6 (+1.7 EV), yaw 15 (smaller nose shadow, fx/
    sheet_y.png), clouding moved into the dome's front material (radial fade to the limbus, patches) and the
    haze cap dropped, iris less recessed, no dark iris periphery, smaller duller caruncle, tighter curled lashes,
    face clumps x2.5 hairs (was x4), pores deeper (bump 0.11 mm) and darker, trachea rings irregular + bloodied,
    shorter trachea and drips.
  * **r10** (look-r10.png, sheet-r10.png, crops look-r10-crop0/1/2-agx.png; render 326 s, job 859 s, peak 2.5 GB;
    metered EV -8.84; EV re upper lip: eye R +0.4, chin -1.7, fingertips -3.0, cut front -3.5, trachea -4.4,
    thumb -6.9, eye L -7.9). Exposure fixed (no longer white). Still CG: a glossy grey porcelain doll (the coat
    was a varnish over the whole face), the nose's cast shadow still a black blob (yaw 15 helped little), the
    cornea a grey disc with a crisp dark outline (the clear rim of the dome showed the dark iris root), sclera
    visible ABOVE the cornea (the 1.0 mm fillet erodes the margin ~0.6 mm: the margin at 21.5 deg sat above the
    limbus), the trachea gone into the dark. 3x contrast crop of the cheek (scratchpad fx/r10cheek.png): the
    oblique Langer lines and a broken specular are there, faint; no lattice.
  * **r11** (look-r11.png, sheet-r11.png, crops look-r11-crop*; render 324 s, job 881 s, peak 2.85 GB; metered
    EV -8.81; EV re upper lip: eye R +1.25, chin -1.15, fingertips -3.1, trachea -3.4, cut front -3.5, thumb
    -7.7, eye L -7.4). Changes: torch at 0.11 R / 0.19 D (the hand 7 cm toward the lens axis; numpy maps fx/
    sheet_t.png: the nose shadow becomes a narrow wedge, the cheek shadow goes), lids 17.5-18.5 / -26.5..-27
    deg and the lid shell re-carved round the dome (hero-camera trace fx/eyecam.py: the upper lid now cuts the
    top of the cornea), cornea density 0.58 centre -> 0.88 at the limbus, a wet hair rope down her left side of
    the nose, SSS 1.6 -> 1.1 mm, base roughness 0.43, coat weight 0.06-0.68 and coat roughness 0.07-0.35 with
    the film bump at 0.9, skin slippage patches (raw dermis + rolled epidermis edge) on her lit right temple and
    under the cheekbone, darker greyer teeth, darker lips. **Self-review: the best so far, still not a
    photograph.** The black-hole nose shadow is gone (a soft dark side of the nose under a wet rope); the lids
    overlap the cornea (no more contact lens all round) but the milky disc keeps a thin dark limbal outline;
    the caruncle is still a smooth pink bead; the lips still read pink and rubbery (the hotspot sits on them);
    the mouth interior a rubber puppet; the forms (cheeks, chin, nose) are smooth sculpted CG; the neck stump is
    a dark bloody band with drips at the bottom edge — visible at viewing exposure, but the trachea is lost in
    the dark (cut front 6 EV under the core: a narrow hotspot cannot light both the eyes and the neck).
  * **r12** (look-r12.png, sheet-r12.png, crops; render 324 s, job 902 s, peak 3.0 GB; metered EV -8.47 (target
    0.75); f/5.6 (spec value; r1-r11 f/8 — barely visible at frame scale: the nose tip ~5-8 px CoC)). Changes:
    grey-blue limbal band in the eye texture, smaller caruncle, cyanotic lips 0.100/0.096/0.122, stronger nose /
    periorbital congestion and lividity, a dark lash line in the margin shader, 165/85 lashes. Self-review: same
    read as r11 (CG mannequin, best so far); the limbal outline survived the texture band (eye crop compare
    scratchpad fx/eye1112.png) -> it is GEOMETRIC: the dome cap stopped at the limbus 0.02 mm proud of the sclera
    and its transparent side wall showed the dark iris root; the milky noise reads as a moon surface; lips still
    pink (the red-heavy SSS radius glows under the hotspot); caruncle still a bead.
  * **r13** (look-r13.png, sheet-r13.png, crops look-r13-crop0/1/2-agx.png; render 322 s, job 845 s, peak 3.2 GB;
    metered EV -8.45). Rendered by 147d, never logged (agent cut off); logged by 147e from the code's `r13` comments:
    the cornea cap runs 1.7 deg past the limbus (its rim sinks 0.07 mm into the sclera), cornea density 0.40 centre
    -> 0.86 at the limbus, less "moon" noise, SSS radius (0.58, 0.42, 0.36) (no perfusion), lips SSS x0.7, a lumpier
    deeper caruncle. **147e verdict r13: still a glossy grey porcelain / vinyl mannequin.** 384 spp cheek crop: no
    pore or line texture visible at 100 %, the nosebleed a flat orange paint stripe; eye crop: a flat grey disc with
    a crisp rim and NO catchlight (EXR: eye-region max 338 vs face p99 230 — a 5 cm torch reflected in a wet cornea
    must be ~15x the skin); face hair = black tape that turns DASHED where it crosses the chin; neck = dark red blobs
    under a smooth glossy chin dome.
- **147e FACE BUILDER, fix round 1 restart (2026-10-13 05:40).** Same AD review (round 1 of look-r8rest, text truncated
  in problem 3). Root cause found before any shading work:
  * **LIGHTING BUG (r1-r13): the 7 coincident torch spots hid each other from every sharp reflection.** Cycles credits
    a BSDF-sampled ray that hits overlapping light spheres to ONE light only — the first created = the 2.5 deg core
    spot. One-off (scratchpad fx2/lt_test.py, black glossy ball): catchlight 856 with one wide spot, 7.7 when a narrow
    coincident spot aimed elsewhere is created first (roughness 0.05: 798 -> 62). So every catchlight, the tear
    meniscus and the wet coat (roughness 0.03-0.1) beyond 2.5 deg of the aim were missing or 4-100x too dim. Also the
    NNLS spot stack itself under-delivered the core by ~30 % and over-lit 8 deg x1.6 (Cycles' blend curve differs
    from the fit's model; fit err 0.39).
  * Fix: ONE spot light carrying the beam as an IES profile (our own LM-63 text generated from the game's torch
    formula, `scare_scene.torch_ies_text`). Calibrated (fx2/ies_test*.py, torch_test2.py): the IES output is linear
    in the candela values (x3 -> x3) with I = W/(4 pi) x 0.0705 x c (IES_K); Cycles evaluates the IES per point of the
    2.5 cm light sphere, i.e. it convolves the beam with the reflector mouth (disc-average model within 3 %), so the
    FAR-field beam reproduces the game's near-field profile (s2 + D^2/8d^2) — measured at 0.336 m, cd vs off-axis
    0/2/4/6/8/10/15 deg: 1033/889/559/225/58/15/8.6 (game 1139/942/533/208/59/17/8.6).
  * Hair burial: 395 of 582 face strands had points under the displaced skin (fx2/bury.py: the strands sit 0.08 mm off
    the SDF but the mesh carries up to 0.5 mm of displacement, and curves sag between points 3-5 mm apart) -> the
    dashed black tape. scare_render now densifies the face strands to 120 points and pushes every point within 1 mm
    of the mesh out to radius + 0.03 mm (BVH on the displaced head); brows and the front scalp too.
  * **r14** (look-r14.png, sheet-r14.png = r13 | r14, crops look-r14-crop0/1/2-agx.png; same args as r13; render 330 s,
    job 605 s, peak 3.2 GB; metered EV -8.86). Only the torch + hair burial changed. **Catchlights are back** (a
    crisp torch reflection in each cornea: the eyes read wet for the first time). Still a porcelain mask. Measured:
    face display luminance p50/p90/p99 0.20/0.58/0.73 (NOT over-exposed) but on-screen chroma p50 0.07 = grey; the
    lips have albedo 0.07 (vs skin 0.16) yet read as pale as skin because the torch core sat on them (+2 EV over the
    eye: the "sausage" upper lip is the hotspot); the cheek crop is smooth at 100 %; the hair still showed bright
    DASHES — not burial but glints at the kinks of the per-point projected strand polylines (3x zoom fx2/z14hair.png).
    Skin LAB (fx2/lab_skin.py: a 70 mm sphere at the hero scale under the IES torch, seconds per variant; lab1.png =
    current | no bump | no coat): the micro-relief exists, but the Langer-line families read as continuous wavy SAND
    RIPPLES; the wet coat gives one smooth sheen spot.
  * r15 changes (one batch): skin micro-relief — line segments ~0.9 mm and more broken, crossing families x0.55 (a
    rhombic mesh, not ripples), line depth x0.6, a 0.12 mm stipple, a second population of 0.07-0.16 mm micro-droplets
    over the wet skin (glassy coat), fewer continuous film islands, drier matte skin between (lab2.png: ripples gone);
    albedo — facial COLOUR ZONES (waxy yellow-grey over bone, blue-violet hollows, cyanotic perioral ring, grey-green
    jaw) + a readable 1-1.5 mm marbling net on temples/jaw/brow sides/throat; eyes — iris-less milky clouding PAINTED
    on a plain globe sphere (soft 1.4 mm fade across the limbus, patchy, a faint blurred pupil shadow) under a CLEAR
    dome (the gloss + catchlight), sclera 0.37 -> 0.31; lid margin pink desaturated; lashes 135/70 in heavier wet
    spikes 1.3-3 mm apart; hair — face strands smoothed (1-D Laplacian) and re-laid on the skin x3 (kills the kink
    glints); neck — trachea stump 15 mm below the cut front (was 9), longer tags and drips, cut tissue roughness 0.12;
    torch aim (-11,-38,-43) (numpy light map fx2/lightm.py: upper lip +1.1 EV over the eye instead of +2.0, cut front
    -4.9); frame centre 5 mm lower (-6,-24,-57) to show more of the stump.
  * **r15** (look-r15.png, sheet-r15.png, crops look-r15-crop0/1/2-agx.png — NOTE the r15 crop boxes were shifted the
    wrong way: a lower centre point moves the head UP ~39 px; r16+ boxes fixed; render 333 s, job 873 s, peak 3.2 GB;
    metered EV -9.01; EV re upper lip: eye R +2.9, nose tip +0.7, cheek scar -1.4, brow scar -1.5, chin -3.1,
    trachea -3.6, cut front -4.3, fingertips -4.5, thumb -8.0). **Mixed.** Worse: the painted milky corneas (0.40-0.45,
    density 0.8-1) glow as blank WHITE discs brighter than the sclera (a demon-eye trope, not a dead eye). Unchanged:
    on-screen face chroma p50 0.071 (r14 0.071) — the colour zones were too weak to survive AgX; display luminance
    p50/p90/p99 0.15/0.58/0.72. The upper lip is still a pale puffy roll: its albedo is 0.07 but its coat/base
    specular (roughness ~0.4, wet 0.45) reflects the 5 cm torch over the whole vermilion (estimate: specular ~965 vs
    diffuse ~220 in scene units) = the latex sheen. Hair: the dashes survive the smoothing; EXR profile (fx2/dash.py)
    shows them BRIGHTER than the skin (glints, not gaps): all hairs of a clump are parallel and glint at the same
    tangent. Neck: the 15 mm trachea now shows below the chin but as a dark textured box; drips read as red icicles.
    Lab at the hero exposure (lab3.png): bigger pores / spotty roughness barely register; the flat-albedo sphere reads
    as grey suede — the 100 % skin read depends on albedo variation more than on the micro-relief.
  * r16 changes: milky cornea darker (milk 0.27-0.31, density 0.4-0.92 over a 0.05-0.10 pupil/iris shadow), sclera
    0.28; lips dull (roughness 0.58, wet x0.3); caruncle duller; hair Chiang roughness 0.18 + random roughness 0.35 +
    a per-hair 0.05-0.12 mm / 3-9 mm wander inside each wet clump; skin tunables `scare_scene.SKIN` (coarse pores
    0.17-0.38 mm, depth x1.5, bump 0.13 mm, spotty roughness +-0.1); SSS radius (0.95, 0.52, 0.38) x 1.2 mm; neutral
    PALLOR + stronger colour zones; trachea rings 0.45 mm and paler cartilage.
  * **r16** (look-r16.png, sheet-r16.png, crops look-r16-crop0/1/2-agx.png; render 335 s, job 879 s, peak 3.7 GB;
    metered EV -8.92; EV re upper lip: eye R +2.0, nose tip +0.7, cheek scar -1.4, brow scar -1.5, trachea -2.4,
    chin -3.2, cut front -3.5, fingertips -4.5, thumb -7.1). Hair: the dash rows are mostly gone (3x zoom
    fx2/z16hair.png: smooth wet ropes with translucent brown edges, a few glints at crossings). Eyes: soft-edged grey
    discs with a catchlight, no ring/dot/crisp edge — but still the brightest, blank thing in the frame. Neck: the
    trachea reads as a corrugated plastic HOSE (0.45 mm rings + pale cartilage = the r9 failure again; reverted in r17).
    Skin: still porcelain. **Diagnostics:** (1) light-path passes of the lower face (`--passes`, passes-r16-.exr,
    fx2/passes.py): glossy share 5 % (cheek, brow) to 19 % (upper lip) — the face is DIFFUSE-dominated, so the pale
    lip is not a specular sheen: its diffuse is 1.2 EV under the cheek's but AgX's shoulder compresses that to 0.63
    vs 0.50 on screen; (2) re-viewing the r16 EXR at EV -8.9/-9.6/-9.9/-10.3 (fx2/ev16.png): the darker exposures
    separate lips/zones/bruises somewhat; screen chroma p50 stays 0.08 at all four.
  * r17 changes (attributable: exposure + creases + neck revert): metering target 0.75 -> 0.45 (`--mtarget`); the
    CREASES of a slack dead face at the mesh-resolvable scale (0.8-1.4 mm wide, 0.15-0.45 mm deep, broken by noise):
    3 lower-lid arcs, 5 crow's-feet rays, a sharp nasolabial crease line, marionette lines, 7 perioral vertical lines
    on the upper-lip skin, mentalis dimpling on the chin (r1-r16 grooves were 0.08-0.3 mm); trachea rings 0.16 mm and
    bloodier cartilage; frame centre -55 (the -57 framing pushed the brow scar out of the top edge).
  * **r17** (look-r17.png, sheet-r17.png, crops look-r17-crop0/1/2-agx.png; render 333 s, job 909 s, peak 3.3 GB;
    **metered EV -9.67** (target 0.45); EV re upper lip: eye R +2.0, nose tip +0.7, brow scar -1.6, cheek scar -1.5,
    trachea -2.8, chin -3.3, cut front -4.3, fingertips -4.5, thumb -7.0). Darker, moodier, a little more photographic
    (the bright mask oval is gone), the hose is gone — but the neck is now lost in the dark again (crop1), and the r17
    creases do NOT read at frame or 100 % scale (1.2 mm random-walk SSS + the 5 cm source smear 1 mm creases; the
    numpy Lambert map of the same SDF, fx2/tmaps.png, shows the forms crisply — the shading, not the sculpt, flattens
    them). Eye crop: a soft grey cataract disc with a catchlight, wet clumped lower lashes; the upper lashes still a
    comb. The albedo pass (fx2/alb16.png, x2.2) reads as a pastel AIRBRUSH: smooth lilac-grey with soft zones; real
    skin albedo is granular below 1 mm.
  * Torch-offset study (fx2/lightm.py + shadow fraction, fx2/tmaps.png): the nose shadow ("black hole") covers 10 % of
    the lit face at the hand offset (0.11 R, 0.19 D); at (0.07 R, 0.17 D) 5.5 % with the same probe EVs (eye/lip/neck
    within 0.3 EV). Aiming lower to rescue the neck costs the eyes 3-4 EV (aim at the lower lip: cut front -1.8 re
    the eye but the upper lip +4.3) — one torch at 0.34 m cannot light both; the neck must read by wet GLINTS
    (a 0.03-roughness blood surface reflects the torch's 8.6 cd shelf at ~-2 EV re the face core).
  * r18 changes: granular albedo in the shader (0.3 mm +-12 % and 0.7 mm +-10 % grain, 7 % of 1.9 mm cells carry a
    0.25-0.6 mm pigment/capillary spot, bruises mottled by a 1-3 mm clotted pattern via a new `bru` vertex attribute);
    torch at (0.07 R, 0.05 behind, 0.17 D); a third drip and rounder 1.55 mm drop bulbs for glints.
  * **r18** (look-r18.png, sheet-r18.png, crops look-r18-crop0/1/2-agx.png; 128 spp, render 339 s, job 921 s, peak
    3.0 GB; metered EV -9.71; EV re upper lip: eye R +2.1, nose tip +0.7, brow scar -1.8, cheek scar -2.5, trachea -2.8,
    chin -3.5, cut front -4.4, fingertips -4.7, split lip -4.3, thumb -6.3, eye L -6.5). Rendered by 147e, never judged
    (agent cut off); **judged by 147f: still a grey vinyl mannequin.** Eyes = two blank pale discs (the brightest flat
    things in the frame) under comb lashes; cheek/lip crop smooth at 100 % (no pores, no sparkle); nosebleed a flat
    paint stripe; upper lip a smooth roll; face hair = thin black wires; neck = dark red blocks.
- **147f FACE BUILDER, fix round 1 restart (2026-10-18 21:00).** Same AD review (round 1 of look-r8rest, truncated in
  problem 3). Diagnosis (scratchpad f3/glint.py on look-r18.exr): only **195 px > 3x the local mean** on 686 k face
  pixels — a wet face under a torch next to the lens should be a field of discrete sparkles; with 147e's pass analysis
  (glossy share 5-19 %) the skin is DIFFUSE-dominated, and 1.1 mm random-walk SSS + the 5 cm source average every
  sub-millimetre relief out of the diffuse. 18 rounds tuned amplitudes inside that mechanism. **Mechanism change (r19):**
  the micro-detail moves into the SPECULAR layer — (1) water-film coat 0.6-1.0 over all exposed skin (waterlogged),
  "drying" expressed as coat roughness 0.04 -> 0.2, not as coat weight -> 0.03; (2) the coat normal carries STRUCTURED
  0.3-1 mm relief (pore pits with rims, domed plateaus between broken furrows, droplets) and NO sub-pixel terms (the
  0.12 mm stipple and 0.3 mm noise only widened the sharp lobe into a vinyl sheen); (3) base Specular IOR Level ~0.05
  under the film (skin/water interface 1.4/1.33, F0 ~0.0006; Blender's base F0 0.028 is against air = the latex sheen
  on the lips/cheeks), 0.5 where dry; (4) cut tissue / clots / drips: coat 1, roughness 0.03-0.05, bead relief (the
  neck reads by glints off the torch shelf); (5) eyes: the brightness hierarchy — darker larger pupil/iris shadow
  under thinner milk, a dirtier darker sclera (no ivory). **Gate before any full frame:** one `--passes` crop (lit
  cheek + upper lip + eye, 128 spp) with the noisy image stored -> glint count (target >= 10x the 195), glossy share of
  the lit cheek (target >= 30 %), sparkle (a heavy tail of the local-ratio histogram, not a shifted mean), denoised vs
  noisy (does OIDN eat the sparkle?), eye: cornea median (catchlight masked) vs adjacent lid skin.
  Exit condition: if two mechanism-changed rounds move neither the numbers nor the read, the report says the
  procedural SDF + shader head is the wall.
  * Tools (scratchpad f3/, run with Blender's bundled python through a symlink `f3/../py` so `pgrep -f Blender.app` stays
    clean): io_.py (OIIO EXR/PNG), glint.py, gate.py (multilayer passes: glints denoised vs noisy, glossy share, eye vs
    skin ring), meter.py. `scare_render --passes` now also stores the noisy image + writes passes-r<N>-agx.png + RESULT.
  * **Gate r19g** (passes-r19g-.exr / -agx.png, crop 860,120,1300,680 = her lit right eye, cheek, nose base, upper lip;
    128 spp, render 114 s, job 338 s, peak 1.5 GB). vs the r16 passes crop (comparable lit px): glints > 3x / > 5x the
    local mean, DENOISED 8 / 6 -> 158 / 40; NOISY 105 / 25 -> 326 / 108; local-ratio p99.9 1.95 -> 3.29 (noisy 2.70 ->
    4.69). **OIDN removes ~half the > 3x glints and ~2/3 of the > 5x** (a finding for the sequence: a partial denoise
    blend may be needed). Glossy share of the lit px did NOT move (0.106 -> 0.098; cheek 0.075): a sharp F0 0.02 film
    carries little ENERGY — the advisor's ">= 30 %" target is not physical for skin under one small source; the read
    is in the sparkle tail, not the mean. Eye: cornea / skin-ring median 2.73 -> 2.14 (the ring sits on the dark
    shiner: a misleading reference). Look: the film now glistens (bruise under the eye, cheek, under the nose) but the
    glints were point GLITTER (micro-droplets at 55 % of 1.1 mm cells) and the sclera ORANGE (injection 0.36/0.11/0.09
    x 0.7 over the yellowed base).
  * r19 changes (one batch, attributable by region): skin — the film mechanism above + droplets cut (micro 0.55 -> 0.15
    x wet, beads 0.30 -> 0.18), metering on p90 (target 0.125 = r17/r18's exposure: glints must not drive it); eyes —
    sclera 0.20/0.19/0.17, crimson injection 0.30/0.07/0.075 x 0.6 + a 0.22 diffuse floor, limbal band 0.19-0.21 (was
    0.40-0.44, brighter than the sclera), wider darker tache noire, cornea milk 0.205-0.235 at density ~0.2-0.85 over
    a 0.046 dead iris and a 0.014 pupil; lashes — per-clump pitch 0.5-3.5 mm, convergence 0.25-0.95, length x0.55-1.1,
    wet droop, ~15 % missing + bare gaps; hair — hanging ropes kink (18-40 mm, 0.8-2.5 mm, shared per clump) so the
    side curtains can glint, face strands meander (9-24 mm, 0.6-2.2 mm), thin clumps (<= 10) become LOOSE separate
    hairs over 2.5x the width (the r18 "black wires"), ropes 1.3x flatter with 12 % peel-off hairs, melanin 0.97 ->
    0.94; neck — no geometry change: the cut tissue / clots / drips now take the full film (coat 1, roughness 0.035,
    1.6x lumpy coat relief), so round 1 for the neck is "does it read by glints".
  * **r19** (look-r19.png, sheet-r19.png = r18 | r19, crops look-r19-crop0/1/2-agx.png; 128 spp, render 486 s (was 339:
    the film everywhere + relief), job 998 s, metered EV -9.60 on p90; EV re upper lip: eye R +1.2 (was +2.1), eye L
    -3.1, nose tip +0.7, brow scar -1.8, cheek scar -2.5, trachea -3.5, chin -3.6, cut front -4.3, fingertips -4.3,
    thumb -6.5). Glints (f3/glint.py, whole face): > 3x local mean 195 -> **1006**, > 5x 38 -> 107. **Verdict: the
    biggest single step in many rounds — the face now reads WET** (glistening streaks along the hair, a broken sheen on
    the bruise, the cheeks, the lip line; the face hair reads as translucent wet strands with glints instead of black
    wires; lashes no longer a comb). Still not a photograph: the corneas are still pale blank discs; the forehead
    droplets read as glitter dots; skin between the glints is smooth vinyl; the nosebleed is a paint stripe; the upper
    lip a smooth roll; the neck a dark mush with a few glints.
  * Two root causes found after r19 (scratchpad f3/albpass.py, f3/eyem.py, `--debugrp` diagnostic render
    look-rdbg-crop.exr): (1) **noise amplitudes**: Blender's normalized Noise `Fac` sits at 0.5 with std ~0.08, so every
    shader term written as `noise * 0.24 + 0.88` ("+-12 %") was +-2 % — the 0.3/0.7 mm albedo grain, the 1.5 mm
    luminance and 4 mm hue variation, the roughness spots and the film undulation of r9-r19 were near-flat (the albedo
    pass of r19g at x3 contrast = an airbrush; the `rp` coordinate itself is fine: 0.5 mm stripes at ~4 px);
    (2) **the eye globe's own specular**: Principled defaults (IOR 1.5, roughness 0.42) under the clear dome = a broad
    sheen ~2.6x the diffuse of the 0.12 cornea albedo at the torch's half-vector: r19 cornea ring median 175-260 vs the
    lit skin round the eye 20-90, although the painted cornea albedo is 0.09-0.12 (eye1 npz) — the "white disc" of
    every round since r9.
  * r20 changes: `_zn` (zero-mean unit-std noise) for the albedo grain (std 6 % / 5 %), 1.5 mm luminance (7 %), 4 mm hue
    (R/B 5 %, G 2.5 %), roughness noise (+-0.04) and spots (+-0.06), film undulation (c_film 0.25 of a unit field); a
    MID pore population everywhere (0.42 mm cells, 0.15-0.25 mm pores — the lateral cheeks, forehead and lids had no
    resolvable pore); droplets again fewer (micro 0.06, beads 0.10 x wet); eye globe Specular IOR Level 0 under the
    cornea, 0.15 on the sclera (aux B = cornea mask); nosebleed rebuilt (varying 0.5-2.4 mm width, thick = darker,
    near-black dried rim, a diluted pink-red wash 2-6 mm into the film, a smear toward her right cheek, a philtrum
    rivulet, a clot plug at the nostril); neck — 4 torn flaps 7-15 mm and 5 clotted blood THREADS 8-21 mm (0.8 mm
    thread, 1.5 mm drop) hanging below the cut (HEAD_LO z -150 -> -160); frame centre -55 -> -60 so they stay in frame.
  * **r20** (look-r20.png / .exr / -agx.png only; crops NOT rendered — the main frame took **56 min** (r19: 8) at
    3.7 GB RSS with the machine swapping 3.7 GB (head rebuild garbage + other lanes + editors), on battery; the job was
    stopped after the main frame, its automatic retry killed, lock released). Glints > 3x 784 / > 5x 73 (r19 1006 /
    107: fewer droplets, as intended). **Verdict: skin finally has texture** (100 % compare scratchpad f3/r19v20.png:
    granular luminance + colour mottle instead of vinyl; the nosebleed reads as dried blood, varying width, darker)
    but the fine chroma speckle (detail-2 hue noise) reads a little like terrazzo; corneas still pale discs (ring
    150-170 vs lit skin 95-130); the neck (2x crop f3/r20neck.png) = a row of under-lit dark-red pillars under the chin,
    the threads invisible in the torch shelf (-7 EV).
  * **Eye root cause, measured** (r19g light-path passes at the cornea, f3/gate.py variant): the first hit is the glass
    dome, so diffuse/glossy passes are 0 there and the cornea's 224 (vs 39-55 on the lit skin round it, albedo 0.11 vs
    0.106) is all transmission-indirect: the globe was lit TWICE — by the shadow-ray-transparent NEE and again by the
    refractive caustic path (globe -> diffuse bounce -> glass -> torch), focused by the dome. Fix: `cycles.
    caustics_refractive = False` (NEE through the transparent shadow ray is the direct light).
  * Neck geometry note: from the eye-level camera the stump face (normal down-back, the cut rising toward the nape) is
    never visible; the camera sees only a ~10 mm sliver of neck front under the chin (z -116..-126) plus whatever hangs
    below, all in the torch shelf. r21 tries a chin-up 7 deg (was 4) + an aim 4 mm lower.
  * r21 changes: `caustics_refractive = False`; hidden scalp strands culled (all points behind y 62 or below z -175) +
    gc before the render; hue noise one octave at R/B 3 % / G 1.5 %; cyanotic lips 0.062/0.058/0.084 (were 0.10);
    pitch -7, aim (-11,-37,-47).
  * **r21** (look-r21.png, sheet-r21.png, crops look-r21-crop0/1/2-agx.png; 128 spp, render 384 s, job 1025 s, **peak
    RSS 2.67 GB** (r20 3.7) with 14 500 hidden scalp strands culled; EV re upper lip: eye R +1.0, nose tip +0.9, brow
    scar -1.3, cheek scar -1.7, chin -2.2, trachea -3.0, cut front -3.6, fingertips -3.6, thumb -4.8, split lip -5.3).
    **Verdict: the eyes are fixed** — both corneas now read as grey clouded dead eyes with a darker iris/pupil ghost and
    a wet catchlight (no more white contact-lens disc); skin texture calmer; lips darker. Still CG: the nostrils are two
    red slits (the vestibules shaded like the congested nose and lit from below), the upper lip a puffy roll, the lower
    lid margin a smooth pink rim, and the neck: at +4 EV (scratchpad f3/r21neckb.png) the geometry is there — chin
    underside, a ragged red band, hanging drips and threads, a lumpy trachea stump — but it reads as orange CANDLE WAX
    (clot colour 0.06/0.008 + the skin's random-walk SSS glow) and the face-hair ropes end in paintbrush TASSELS.
  * **Torch maths for the neck** (scratchpad f3/aim.py: E = I(theta, d) cos / d^2, no occlusion): with the game torch's
    4.7 deg near-field core the neck front sits on the 7 cd spill shelf at **~-7 EV whatever the aim** (aim at the upper
    lip, the mouth or the chin: cut front -7.3..-7.7) — moving the core down only trades the eyes (-3..-4 EV) for the
    chin. One torch cannot light both; the neck must read by dark glossy blood with sharp glints off the shelf (a
    0.04 F wet surface reflecting the shelf's 7 cd x the 5 cm mouth ~ -1.8 EV re the face) — or by staging in the
    SEQUENCE (the head arriving from below passes the stump through the core for a few frames). Request for the lead.
  * r22 changes: clot 0.035/0.0045/0.004 and NO SSS on cut tissue / clots / drips (sss floor 0.03, was clipped at 0.3);
    nostril vestibules dark 0.045/0.026/0.024; upper-lip vermilion relief 2.4 -> 1.8 mm and the muzzle 2.4 -> 1.8 mm;
    face-hair tips staggered (each hair ends at 78-100 % of its rope) and tapered (38 -> 14 um).
  * **r22** (look-r22.png, sheet-r22.png, crops look-r22-crop0/1/2-agx.png; 128 spp, render 394 s, job 1149 s; EV re
    upper lip: eye R +0.7, nose tip +0.6, brow scar -1.5, chin -2.5, cheek scar -2.8, trachea -3.3, cut front -3.8,
    fingertips -3.8, thumb -5.4, split lip -5.6). Nostrils now dark openings (the left one with a hard horizontal
    edge); the upper lip flatter, grey-purple, dead; hair tips taper. **Self-review (harsh): a good CG render of a wet,
    dead, beaten face — still not a photograph.** Remaining tells, worst first: (1) the NECK is a dark band at viewing
    exposure (physics above); (2) the macro forms are sculpt-smooth — chin, lower cheeks, nose tip and the lid/brow
    planes are even grey slopes at frame scale; (3) the lower lid margin is a smooth pink rim over a dark crevice;
    (4) the forensic set beyond shiner / cheek bruise / nosebleed / petechiae does not read: brow scar out of frame at
    centre -60, crescent scar lost in the bruise, split lip -5.6 EV, grip bruises -3.8 / -5.4 EV and partly under
    hair, marbling only as faint mottle.
  * r23 changes: composition REVERTED to r18/r19 (centre -55, pitch -4, aim -11,-38,-43: centre -60 lost the brow scar
    and the forehead for 5 mm of unlit stump; aim.py shows no aim lights the neck); the split lower lip moved to HER
    RIGHT half (laceration, swelling, swollen border; probe moved too); the fingertip bruises 10-13 mm up / 5 deg
    forward onto the mandible body (into the core's skirt on the lit side); lower tear meniscus 0.30 -> 0.45 mm. A 4th
    crop (mouth / jaw, 760,640,1240,940) to judge the lip and the grip bruises.
  * **r23** (look-r23.png, sheet-r23.png = r22 | r23, crops look-r23-crop0..3-agx.png; **sheet-r8rest-r23.png = the AD's
    r8rest | r23**; 128 spp, render 379 s, job 1135 s, peak RSS 2.35 GB; EV re upper lip: nose tip +1.0, eye R +0.8,
    cheek scar -2.9, fingertips -3.0 (was -3.8), trachea -3.1, chin -3.2, cut front -3.6, split lip -4.4 (was -5.6),
    eye L -4.5, thumb -6.6). The brow and its hairs are back in frame; the split lower lip reads (a vertical bloody cut
    with a bead on her lit right half); the lower lid now has a bright wet meniscus line instead of a dark crevice.
    The fingertip bruises show as near-black round spots on the shadowed jaw (they share the shiner's blue-black core)
    -> r24.
  * **Spasm rig proof** (look-r23-spasm.png / .exr, `--round 23 --frame spasm`, same args, cached head; `spasm_key`
    1.0/1.0; render 428 s but the Blender process ran 62 min under swap; queued 00:41 behind a FLASH-lane Chrome run):
    mouth crop (760,560,1240,1000) hero vs spasm **PSNR 24.5 dB, 38 k of 211 k px changed** (r8's broken key: 45 dB =
    noise; r8 fixed: 35 dB) — scratchpad f3/spasm23.png: the jaw opens wider, the lower lip and the split drop ~25 px,
    the commissures stretch (a thin wet seam glints at her left corner). Known: the face strands over the chin do not
    follow the jaw (no shape key on curves) — the SEQUENCE agent must re-lay or bind them. Scope of the proof: the r23
    head (incl. the blood threads, HEAD_LO -160 and the moved laceration); r24 rebuilt the head only for a scare_tex
    vertex-colour change — same mesh, same `rotate_jaw`, so the spasm key data are unchanged (not re-rendered).
  * r24 change (hero, else = r23): the grip marks get their own plum-violet core 0.085/0.035/0.075 (softer onset); the
    shiner keeps the blue-black core.
  * **r24** (look-r24.png / .exr, sheet-r24.png = r23 | r24, crop look-r24-crop0-agx.png = jaw; **sheet-r8rest-r24.png
    = the AD's r8rest | the current still**; 128 spp, render 397 s, job 699 s, peak RSS 1.98 GB; EV re upper lip
    identical to r23: fingertips -2.9, chin -3.2, cut front -3.6, split lip -4.4, thumb -6.6; glints > 3x 557 / > 5x
    74). The plum core changed nothing visible (scratchpad f3/r23v24jaw.png): on the jaw at ~-3 EV any 0.085 core next to
    0.18 skin still reads as a round dark hole. The grip bruises remain the weakest forensic item.
  * **147f STOPPED here (r24 is the current still; the look is NOT approved).** `assets --check` ok (low 26.99/27,
    medium 53.80/60, max 77.14/120 MB; nothing shipped by this lane). Honest state vs the AD round-1 list:
    1. skin (rank 1): no lattice, real albedo grain/mottle (r20), a broken wet film that sparkles (r19) — reads as wet
       dead skin at 100 %, but the macro FORMS are sculpt-smooth (chin, lower cheeks, nose tip, lid/brow planes);
    2. eyes (rank 2): FIXED in r21 (dead grey clouded corneas with a pupil ghost + catchlight, crimson-injected
       sclera, irregular wet lashes, a wet lower meniscus since r23); the lower lid margin still a smooth pink rim;
    3. neck (rank 3): NOT fixed — physically unlit by the game torch (aim.py, ~-7 EV whatever the aim); geometry
       (torn band, flaps, blood threads, trachea stump) exists at +4 EV; needs a staging decision;
    4. summary items: mouth = an almond with dead cyanotic lips (no slot); nose shadow = a dark smudge on the bridge,
       no longer a hole; hair = wet translucent strands with glints (no wires, no tassels); forensic set: shiner,
       cheek bruise, nosebleed (now blood), split lip (r23), petechiae, sclera haemorrhage read; brow scar at the top
       edge only, crescent scar lost in the bruise, grip bruises = dark spots, marbling only as mottle.
    Verdict: a good CG cinematic of a wet, beaten, dead face — still not a photograph. Do not render the sequence.
  * **Next (whoever continues)**: (1) lead decision on the neck (staging in the sequence: the head rises into the beam
    from below so the stump crosses the core for 3-5 frames; or accept it dark); (2) macro form breakup: 1-5 mm
    irregular soft-tissue relief (sagging, oedema, asymmetric swelling) on chin / lower cheeks / nose tip in
    scare_head.relief — the biggest remaining "sculpt" tell; (3) grip bruises as irregular, mottled, partly-overlapping
    finger smudges with a lighter red-violet rim rather than round dark ovals; (4) OIDN eats ~half the > 3x glints and
    ~2/3 of the > 5x (gate r19g): the sequence may need a partial denoise blend; (5) the jaw spasm moves the mouth but
    not the face strands.

- **147g FACE BUILDER, fix round 2 (2026-10-19).** Input: the independent AD review ROUND 2 of look-r24 (verdict FAIL:
  "a competent CG render of a pale wet J-horror ghost / a latex mask under a flashlight"; not a photograph, not
  horrifying). The text handed to this agent is TRUNCATED inside problem 2's fix ("A/B first in the existing skin lab
  ... Then"); problems 3+ are known only from the summary — full text requested from the lead. AD gate before anything
  else (no sequence): (1) a 128 spp crop of nose tip / lit cheek / eye after a coat-normal change — pass = components
  >= 31 px carry most of the specular, nose-tip max >= 4x its p50 (r24: 687 components, only 13 >= 31 px; nose tip
  1.7x); (2) ONE neck test frame at a large chin-up pitch with the frame centre lowered, numpy-checked first.
  Inherited: `fx2/lab_skin.py` and the other fx/fx2 tools are GONE from the scratchpad (only f3/ and ad2/ survive);
  r24 args: `--spp 128 --h 0.6 --dist 0.24 --center -6,-24,-55 --pitch -4 --torch 0.07,-0.05,-0.17 --aim -11,-38,-43
  --yaw 15 --fstop 5.6` (metered EV -9.61).
  * Staging numbers (new numpy tool scratchpad g/stage.py: the cached head mesh splatted into the hero camera, the
    game-torch profile + a torch shadow map; g/aimsweep.py): with the core on the face (aim -11,-38,-43) the cut /
    tissue verts (`cap` > 0.5) stay **-6..-7.5 EV under the face p90 at EVERY pitch from -4 to -50**, and they cover only
    1.3 % (pitch -4) -> 2.0 % (-30) -> 3.4 % (-50) of the frame. Chin-up alone does NOT bring the stump into the core:
    the core (HWHM ~4 deg) is aimed in head space, so the stump keeps its ~20-25 deg angular distance from the axis;
    only its incidence improves. Aiming the core at the chin/neck lights the stump (cap p75 +2..+6 EV re the eye) but
    puts the chin 6-8 EV over the eye (the eyes go dark). -> the neck test frame is staged as the SWING PEAK of the
    sequence: the beam is world-fixed and the head swings through it.
  * The CUT FACE itself (verts within 1 mm of the cleaver surface) is the real problem: with the plane rising toward
    the nape (cut_n (0,-0.36,1), stump facing down-BACK) it covers **0.06-0.3 % of the frame at pitch -4..-25, 0.9 % at
    -45, 2.3 % at -55**; a camera BELOW the head (camup -0.08..-0.14) does not help (0.35-0.6 %). No pitch in the AD's
    20-30 deg range shows the cut plane from an eye-level camera. Coarse re-meshes with other tilts (g/cutstudy.py,
    h 1.5): tilt 0 (perpendicular to the neck) 0.6-0.7 %, tilt +0.36 (rising toward the FACE) 1.8-2.2 % at pitch -25.
    Even facing the camera squarely the whole section (~7000 mm2) is ~11 % of the frame at 0.3 m: the AD's "stump in the
    bottom 15-20 %" can only be the neck column + its ragged end, not the cut face.
  * **Gate 1, round 1 = r25** (look-r25-crop.png/.exr, `--border 860,120,1300,680 --ev -9.61`, 128 spp, render 109 s,
    job 548 s incl. the Chrome queue, peak 1.7 GB). Change (scare_scene.skin_material, SKIN): the wet-island field moved
    before the coat normal and made wetter (wp thresholds 0.42-0.56, ~60 % under a glassy film); the coat normal's pore
    pits / Langer furrows / lip fissures / smooth-F1 domes x `c_under` 0.12 under a thick film, full only where it is
    thin (drying patches); film undulation 0.8/0.4 mm -> 4.5/1.9 mm (scale 220/520, c_film 0.30, ~1-2 deg); micro-
    droplets 0.06 -> 0.025 x wet. Metric (scratchpad g/gate1.py = the AD's >2x-local-mean 8-connected components, same
    window cut from look-r24.exr): r24 139 components, energy 15/31/54/0 % in 1-2/3-8/9-30/>=31 px; **r25 93 components,
    3/16/80/0 %** (the glitter moved into coherent 9-30 px patches; cheek max/p50 4.6 -> 24.7, upper lip 5.2 -> 12.6)
    but **no >= 31 px sheet and the nose tip max/p50 1.7 -> 2.4 (< 4: FAIL)**. Look (g/g25.png): the bruise bag and the
    lip now carry wet streaks instead of sugar dots; the nose tip is still a matte wax knob.
  * **ROOT-CAUSE BUG found (r1-r25): the vertex normals handed to scare_tex.fields point INTO the head** (surface-nets
    quads wind inward; nose-tip normal +y). Every `front` gate (ss(-N_y)) was 0 on the face and 1 on the back of the
    head, so on the FACE there were NO old scars (brow + crescent), no creases / nasolabial / marionette / perioral
    lines / mentalis dimpling, no colour zones (bone / perioral / jaw), no marbling, no skin slippage, no coarse
    nose/chin pores (pbig > 0.3 sat at mean y +113 = the back of the head; the nose tip had pbig 0); the silt-occlusion
    probe stepped inside the head (occ 1 everywhere = the whole skin darkened 34 % and yellowed); `disp` moved inward
    (the face disp p99 was 0.004 mm). Blender's own render normals were right (bmesh recalc), so nothing looked broken
    — the forensic set the AD "could not find" was simply not on the face. Fixed in scare_scene.head_arrays (orient
    outward, logged). This changes the look substantially (all those features appear for the first time).
  * **Neck rebuilt as a cleaver CHOP** (scare_head `cut_plane` / `cut_dist` / `section` / `holes` / `STRINGS`,
    scare_tex cut block): two strokes (main plane + a second 3.2 mm higher over the front ~45 %, 6 deg steeper, a
    ledge between), two V chop notches, 1 mm hack + 0.25 mm blade chatter; the plane now RISES TOWARD THE FACE (tilt
    +0.25: the stump faces down-forward — deviation, logged as contract row 147g); the C4 section anatomy as relief +
    colour (2-5 mm yellow subcutaneous fat ring 0.5/0.4/0.2 lobulated, muscle fill with fat septa, SCM / strap / scalene /
    longus bulging 1-3 mm recessed, thyroid lobes, the trachea C-ring of pale cartilage 1.6 mm proud with the flat
    posterior membrane and a DARK OPEN LUMEN 14 mm deep, the collapsed oesophagus slit 5 mm deep, carotid stubs
    (proud, clot-plugged 1.6-2.5 mm down), collapsed clotted jugulars, the C4 body 1 mm proud with a cortical rim and a
    cancellous face (marrow red between pale trabeculae), lateral masses, laminae + bifid spinous process, the cord with
    a grey-matter H in its canal); skin edge retracted 5-10 mm over a lobulated fat band with platysma patches; a 2-4 mm
    abraded (matte, crusted 0.20/0.055/0.04) + contused border; currant-jelly clots (0.04-0.14 R) pooled in the recesses
    and smeared over ~55 % of the face, coat smoothness follows `wet` (glossy jelly -> matte drying skin); three
    IRREGULAR beaded fibrin strings 9/21/34 mm (r20-r24: five even drips + four tags). HEAD_LO z -160 -> -172. numpy
    preview (g/neckprev.py, g/np3x.png): the section reads; risk = "diagrammatic / deli slice" — judge in Cycles.
  * Also in r26: (a) the face-hair clumps that crossed her LEFT eye re-routed beside the nose / lateral to the orbit
    (AD: "one eye hidden; r8rest's double dead stare was more shocking") — both dead eyes stare; (b) grip bruises as
    ragged elongated smudges (blob wobble 0.65, 1.55x along the pad) with a lighter red-violet rim 0.21/0.08/0.12 and a
    mottled plum core 0.11/0.045/0.085 that never fills the smudge (AD: "tar ovals").
  * Gate-1 geometry check (g/hilite2.py, mirror condition for the 5 cm reflector at 0.3 m = N.H within ~2.4 deg): with
    the torch 0.17 m under the lens the half-vector sits ~15 deg below the view axis, and the nose tip's best normal is
    **6.0 deg off** the mirror direction — no torch reflection can land on the nose tip in this pose whatever the film
    does (torch 0.12 below: 3.5 deg; 0.09 below: 2.2 deg = a highlight). Only 50 visible skin verts satisfy the mirror
    condition in the whole r24 pose. The AD's "nose tip max >= 4x p50" is a staging (torch height) question.
  * Neck test framing (g/frame27.py, coarse re-mesh of the NEW head): hero pose (pitch -4) cut face 0.06 % -> 0.5 % of
    the frame with the new tilt; at pitch -25, centre (-6,-24,-75), dist 0.26, aim (-3,-12,-108) (the beam on the
    neck): cut face 2.6 %, tissue 4.5 % in the bottom third (rows 201-299 of 300), the cut face +0.4 EV re the face p90
    (it IS the lit form), the eye at 13 % from the top (dim, ~-6 EV re the chin).
  * **r26** (look-r26.png/.exr, crop look-r26-crop0-agx.png = the gate-1 window at 128 spp; sheet-r24-r26.png = r24 |
    r26; r24 args; render 408 s, job 2322 s = head rebuild 151 s + teeth/eyes 100 s + **hair re-integration 1183 s**
    (any scare_head/scare_hair edit re-keyed the 24 000-strand scalp) + crop 116 s; peak RSS 2.84 GB; metered EV -10.09
    (r24 -9.61: the skin is brighter without the silt bug); 558 803 verts). Gate-1 metric, same window: 92 components,
    energy 6/34/60/0 % (1-2/3-8/9-30/>=31 px); whole frame (AD script) 687 -> **424 components** (1-2 px 345 -> 152,
    3-8 px 232 -> 159, >= 31 px 13 -> 18); nose tip max/p50 2.0 (the mirror geometry above). Look: **both dead eyes
    stare** (the double stare is back); the bruise bag and the lips carry coherent wet streaks; the grip marks read as
    red-violet smudges instead of tar ovals (lifted 2.5x); the cut shows as a lumpy yellow-red band under the chin
    (the new fat band) — still dark at viewing exposure in this hero pose. NEW problems: the scars now exist and read
    as CHALK (a white painted crescent; the skin-slippage edge a white ring round a pink paint blotch: absolute
    albedos 0.47-0.50 on 0.22 skin) -> relative colours (scar = skin x 1.24/1.12/1.12, slippage dermis 0.28/0.15/0.14,
    epidermis roll = skin x 1.25); three face clumps stacked on one path beside the nose = a BLACK BAND down the nose
    -> one moved over the brow lateral to the eye, one thinned to a stray, the rope 26 -> 18 hairs.
  * Cache engineering: the hair cache is split — the scalp (S1, the 20-min part) keyed on scare_head WITHOUT the
    neck section + scare_hair WITHOUT `FACE_CLUMPS`; face strands / lashes / brows keyed on everything (seconds). r26's
    scalp aliased to the new key (same code). `--hairpitch` lays the hair for another pitch (the neck test reuses the
    hero hair instead of a 20-min re-integration for its own gravity).
  * **r27 = NECK TEST FRAME, round 1** (look-r27-neck.png/.exr; `--frame neck --pitch -25 --center -6,-24,-75 --dist 0.26
    --aim -3,-12,-108 --hairpitch -4`, the rest = r24; 128 spp, render 398 s, job 1144 s incl. the Chrome queue, head
    rebuild 159 s, hair 9 s (cache split works), peak 2.05 GB; metered EV -9.96; EV re the upper lip: chin +7.1, cut front
    +6.5, fingertips +6.1, trachea +3.1, eyes -1.7). **The stump reads as a cut neck for the first time**: a lumpy
    yellow fat band under a red abraded skin edge, the cut face below it glossy dark-red with the trachea ring, the
    carotid stubs and three fibrin strings hanging. Harsh: the fat band is an even cream layer = a CAKE / LASAGNA
    layer; the trachea ring and the carotid stubs are bright white proud cylinders = PVC PIPES; the grip smudges are
    saturated pink-red = LIPSTICK; the chin-up pose shows two pig-snout nostrils; the rest of the section (vertebra,
    muscles) is lost in the shadow behind the front rim. r28 neck fixes: cartilage 0.53 -> 0.40/0.34/0.31 and only 0.6 mm
    proud (blood-smeared), carotids retracted +0.4 mm (arteries retract) with 0.30/0.14/0.13 walls, the fat band blood-
    soaked (0.34/0.20/0.10 x 55 % + clot runs ~65 %), the retraction jagged 3.5-11 mm, grip rim 0.16/0.085/0.115.
  * r28 = hero round 2 + the neck frame in ONE job (new `--second "pitch,cx,cy,cz,dist,ax,ay,az"`: a second pose in the
    same Blender session -> look-r<N>-neck): hero framing tightened to "the face fills the frame" (dist 0.24 -> 0.21,
    centre -55 -> -42: brow scar top at y 2, eyes at 18-21 % from the top, chin y 1068, cut front y 1165; face ~44 %
    of the width — the frame HEIGHT is the limit at 16:10), f/5.6 -> f/8 with the focus 1/3 of the way from her right
    cornea to the nose tip (`--focus -21,-24,-10`): r26's nose tip was a 5 px DOF blur (no pores could read).
  * **r28** (look-r28.png/.exr = hero, look-r28-neck.png/.exr = neck frame round 2, sheet-r28.png = hero | neck; one job
    1229 s incl. queue: head 152 s, teeth/eyes 105 s (the teeth key includes scare_head), hair 1.8 s, hero render 471 s,
    neck render 390 s, peak 2.52 GB; hero metered EV ~-10.1, neck -9.89). Also: lid/face petechiae 0.2-0.55 mm (were
    0.13-0.4 = 1-3 px) at density 0.45. Hero: the face fills the height; sharp at f/8 (pores and mottle read at 100 %,
    g/h28.png); the black band beside the nose is gone (one thin strand); both dead eyes; scars no longer chalk (now
    subtle). Glints (AD script, whole frame): 569 components (r26 424, r24 687): f/8 + the closer camera resolve more
    droplet/film sparkle again; the map (g/gm28.png) puts the small ones in clusters at the near-mirror spots (glabella,
    lower lids, alae, lip edges, chin) — each potential sheet breaks into dots. Neck r2 (g/neck28.png): the pipes are
    gone (a blood-smeared ring, flush vessels), the band is darker but reads as a lumpy honeycomb strip, the abraded
    border a painted pink ring, the cut face a dark disc (the beam aimed at the chin front leaves it ~-3 EV), grip
    marks = flame-shaped paint dabs.
  * r29 (one job, hero + neck): coat roughness on the wet film 0.035 -> 0.07 (each mirror spot spreads into a sheet), fine
    coat terms under the film x0.05 (was 0.12), micro-droplets 0.025 -> 0.01, beads 0.10 -> 0.05 x wet; neck: the beam
    aimed onto the cut face (-3,-5,-122), the band ~80 % clot-covered, the abraded border 1.2-3.8 mm 0.14/0.04/0.03, the
    contusion 2-9 mm; grip smudges wobble 0.45, rim x0.45, core x0.7.
  * **r29** (look-r29.png/.exr, look-r29-neck.png/.exr; job 1100 s, hero 473 s + neck 389 s, peak 3.03 GB; neck metered
    EV -9.35). Hero: visually identical to r28 at 100 % (g/h2829.png) and the glint count barely moved (AD script 569 ->
    556; window energy 5/29/64/1 %): the coat roughness is NOT what makes the sparkle. Remaining sparkle clusters sit in
    the drying patches, where the fine coat terms still act at full strength by the AD's own rule (~30 % of the skin).
    Neck r3 (g/neck29.png): with the beam on the cut face the section is LIT for the first time (the trachea ring, the
    lumens as dark pits, strings), but it reads as a salmon-pink HAM slice (muscle 0.22/0.036/0.032 under 2900 K), the
    band as a PIE-CRUST rim, the strings as red gummy worms.
  * r30: fine coat terms max 0.4 even where the film is thin + a wetter face (wp thresholds 0.36-0.50); neck: deoxygenated
    muscle 0.13/0.024/0.022, darker currant-jelly clots 0.028-0.09 R, the band ~90 % clot-covered and half the lobule
    bulge (`Face.BAND_LUMP`), near-black glossy fibrin strings 0.035/0.005/0.004. (`BAND_LUMP` moved into the neck section
    so its tweaks no longer re-key the scalp cache; the one-time re-key aliased like r26's.)
  * **r30** (look-r30.png/.exr, look-r30-neck.png/.exr, sheet-r30.png = hero | neck; job 1775 s incl. the Chrome queue,
    hero render 475 s, neck 388 s, peak 3.0 GB; hero metered EV -10.19, neck -9.24). Rendered by 147g, never judged
    (agent cut off); **judged by 147h: FAIL, a glossy CG ghost mask.** Hero at 100 % (scratchpad k/r30crop.png): the
    whole face reads as clear LACQUER over a pastel terrazzo (green / pink / violet chroma mottle at 2-5 mm); the eye a
    doll eye in a pink rubber rim with sclera showing all round; the lips inflated latex pillows with long specular
    streaks; the nose ala a smooth wax knob. AD script (whole frame): 411 components (r24 687, r29 556), >= 31 px 6.
    NOTE: the AD's pixel boxes and the gate-1 window were measured on r24's framing; r28+ moved the camera, so those
    box numbers no longer sit on the named features (re-projected per round from 147h on). Neck frame: pie-crust ring,
    ham section, red gummy worms — moot after ruling (au).

- **147h FACE BUILDER, fix round 2 restart (2026-10-19).** Same AD round-2 review (truncated in problem 2), now under
  LEAD RULING (au) below (no neck renders, face fills the frame, horror on the lit face, film smoother than skin).
  Plan, biggest first: (1) specular sheets — a one-off Blender skin LAB (sphere + nose-tip sphere under the IES torch,
  seconds per variant) to pick the coat-normal (c_film / fine terms OFF in the coat) and coat-roughness values with an
  absolute-highlight-area + nose max/p50 metric before any hero render; (2) the (au) framing (brow-chin >= 85 % of the
  height, cheekbones >= 70 % of the width) checked in numpy first; (3) the forensic marks into the beam, each >= 20/255
  display mean; (4) macro form breakup (irregular 1-5 mm soft-tissue relief); (5) a grain-proxy view (ISO-1200 noise
  floor) for judging. Re-projected probe boxes per round.
  * Tools (scratchpad k/): frame.py (cached head mesh -> the hero camera: brow-chin / cheekbone spans in px, feature
    pixels), marks.py (ruling-au metric: each forensic mark's visible vertices, selected by its REST-space definition,
    z-buffered into the frame, mean display value of look-rN.png), probe.py / probexz.py (display lum of the skin at
    candidate rest positions = where the light is), labm.py (lab metric). NEW lab: `blender/scare/scare_lab.py`, run
    inside the scare-look job by `--lab variants.json --labout dir` (scare_render dispatches; one Blender lock): the
    cached head's face patch (no hair/eyes/teeth) in the hero pose under the IES torch, one --border crop per SKIN /
    torch variant, ~122 s per variant at 128 spp.
  * **r30 marks (k/marks.py, display mean /255, rule >= 20)**: brow scar 31, crescent scar 62 (lit but invisible: the
    ~260 deg ring sank into the old bruise), shiner 38, old cheek bruise 101 — **fingertips 0.9-2.2, thumb 0.3, split
    lip 15, temples 0.5-0.8: FAIL.** Light map from the r30 display (probe.py): the torch core lights a disc of ~35 mm
    radius round her right nasolabial region (th -20 z -30..-50: 118-133; th -30: 71-87; th -40: 19-41; temples and
    th <= -40 below z -50: 0-7; forehead z 20-30: 5-27). Physical: the 2-cell krypton puts its ~27 lm in a ~3.4 deg core
    and the unreflected bulb light is a ~2-7 cd spill = -8 EV — "harsh, close, falling off fast" is right; the marks
    must sit in that disc.
  * **Framing (ruling au) is geometrically impossible at 16:10 as written**: this head's cheekbone band projects to
    0.77 x its brow-chin span (bizygomatic 128 mm, perspective at 0.2 m shrinks the zygomas ~0.85); "brow-chin >= 85 %
    of 1200" + "cheekbones >= 70 % of 1920" needs a ratio >= 1.12 (a real face is ~0.85-0.9 at this distance). k/frame.py:
    dist 0.21/centre -42 (r30) 99 % H / 48 % W; 0.19/-36 108 % / 52 %; 0.18/-40 114 % / 54 %; 0.16 127 % / 59 % (brow and
    scar out of frame). Chosen r31: dist 0.19, centre (-6,-24,-36) = brow at the top edge, the brow scar top at y -2,
    chin cut ~80 px, 108 % H / 52 % W. Request for the lead below.
  * **Lab r31a** (scratch/jumpscare/lab/a0..a5.png/.exr, scratchpad k/lab31a.png = a0 | a2 / a4 | a5; crop
    860,120,1400,680 of the dist-0.18 framing, 128 spp, 122 s each, peak 2.5 GB). Variants: a0 = r30 SKIN; a1 no fine
    coat terms; a2 + c_film 0.10; a3 + coat_r_wet 0.12; a4 c_film 0.05 + coat r 0.16/0.24; a5 = a3 with the torch 0.11 m
    under the lens. AD metric (> 2x local mean): 57 / 50 / 46 / 43 / 46 / 39 components; absolute sheets (> 2.5x the
    crop's p50): largest components 833 / 847 / 875 / 879 / 1122 / 1221 px, sheet area 3041 / 3055 / 3269 / 3382 / 3447 /
    4541 px. Honest read: at this framing the fine coat terms matter less than the AD's r24 count suggested (a0 already
    had only 37 glints <= 8 px in the window); the sheets sit on the swollen bruise bag and the alae; the lit CHEEK is
    matte in every variant (its normals do not face the half-vector of a torch 30-45 deg below the lens: physics). The
    torch nearer the lens axis (a5) gives the broadest sheets (1221 px). The nose-tip max/p50 box is meaningless here
    (dark nostrils in the box: 6-12 x). Bigger tell in the lab: the skin reads as powdery PLASTER with a green/pink
    terrazzo speckle (2-5 mm hue noise) — addressed in r31.
  * r31 changes (one batch; attributable by region): SKIN c_under / c_thin 0 (NO pore/furrow/dome terms in the coat,
    ruling au), c_film 0.30 -> 0.06, coat roughness 0.07/0.18 -> 0.14/0.24, a_var 0.07 -> 0.05, a_hue 1.0 -> 0.4, scare_tex
    5 mm hue noise halved; lips dry/matte (coat weight and smoothness x (1 - 0.75 lip)) and slimmer (vermilion relief
    upper 1.8 -> 1.5, lower 4.8 -> 3.9 mm); lid-margin mucosa 0.27/0.13/0.125 -> 0.17/0.085/0.085 (the pink doll rim);
    sclera diffuse injection floor 0.22 -> 0.12; subconjunctival haemorrhage in BOTH eyes (right 22 x 14 deg lateral;
    left 20 x 15 deg + a small one across the cornea); grip marks moved INTO the light (GRIP_XZ: an arc of four
    fingertips across her right cheek from beside the mouth corner up toward the cheekbone, r30 light 61-128; thumb on
    her left cheek), a yellow-green halo 3-6 mm round each pad, red-violet rim, mottled purple core, pads swollen 0.6 mm;
    the crescent scar is a real crescent (spec r 15 / arc 25 mm: r 13, +-46 deg, smile-shaped on the right cheekbone,
    centre (-39,-13); was a ~260 deg ring); macro soft tissue (scare_head.relief/_build_base): a swollen bag under the
    black eye (+1.8 mm) and cheek oedema (+1.0), a broken nose (dorsal callus +0.8, tip pushed ~1 mm to her left), jowls
    (+1.2/1.3), and real soft-tissue undulation on the lower face / cheeks / nose / chin (fbm 1.3 at ~19 mm + 0.9 at
    ~8 mm, i.e. ~0.26 / 0.18 mm std; the old 0.55 x fbm term was only +-0.11 mm); framing dist 0.19 / centre -36; torch
    (0.065 R, 0.04 behind, 0.13 D) (lab a5 direction, a compromise with the under-light) aimed (-16,-37,-38) (the core
    on the right cheek / nasolabial so the grip + crescent sit in it); f/11 focused (-20,-22,-8) (at 0.19 m f/8 gives
    ~14 mm DOF: the r30 nose tip was a 5-7 px blur). The scalp hair cache is aliased (hair_v3s1564e34b676d ->
    hair_v3sdafa80a7c069: the face relief does not move the scalp); stale scare cache pruned (2.1 GB -> 0.2 GB).
    Job args: `--round 31 --spp 128 --h 0.6 --dist 0.19 --center -6,-24,-36 --pitch -4 --torch 0.065,-0.04,-0.13
    --aim -16,-37,-38 --yaw 15 --fstop 11 --focus -20,-22,-8 --frame hero`.
  * **r31** (look-r31.png/.exr, sheet-r31.png = r30 | r31; scratchpad k/r31f.png = with the ISO-1200 floor proxy,
    k/r31crop.png = 100 % eye/cheek + mouth; 128 spp, render 526 s, job 805 s, head rebuild 153 s, peak 3.0 GB, metered
    EV -10.31). Marks (k/marks.py, /255): **fingertips 78 / 58 / 45 / 43 (r30 1-2: PASS)**, crescent 100, shiner 45, old
    cheek 123, brow scar 29; FAIL: split lip 9 (the aim moved up), thumb 1.5 (her left, off the beam), temples 0.4-1.8.
    AD glint script (whole frame): 337 components (r30 411, r24 687), 1-8 px 218 (r24 577), >= 31 px 10. **Self-review:
    FAIL, still a CG latex mask** — closer, both dead eyes stare, the haemorrhage in her left eye reads, the grip marks
    are on the lit cheek; but at 100 % the fingertip marks read as purple ovals with lipstick-red rims and red nail dabs
    (paint), the crescent and brow scars are invisible (x1.24 albedo), the sclera reads as FLESH in a socket (albedo 0.20
    under the 0.25 skin = the doll read), the wet film reads as lacquer streaks over plaster, the upper lip is still a
    rubbery roll (fine vertical fissures now show), the mouth interior a dark-red puppet, the split lip lost in shadow.
  * **Lab r32a** (scratch/jumpscare/lab/b0..b3, scratchpad k/lab32a.png; the r31 framing crop 820,180,1460,820, 142 s per
    variant): coat_min 0.6 / 0.3 / 0.3 + wet roughness 0.10 / 0.15 + wetter islands — nearly identical (AD comps 30 / 27 /
    31 / 25, largest sheet 1307-1314 px): at r31's settings the lacquer read is not the film WEIGHT; kept 0.3 (the
    drying patches drain).
  * r32 changes: sclera albedo 0.20/0.19/0.17 -> 0.44/0.42/0.36 (dull ivory; the limbal band 0.27) — the whites of the
    eyes; grip rim 0.115/0.07/0.095 x 0.55 (was lipstick 0.14/0.065/0.115 x 0.65), blue-purple core 0.065/0.035/0.075,
    nail abrasions 2.4 mm dark brown (were 3.2 mm red dabs); scars x1.42-1.45 paler with a darker border (x0.72), the
    crescent 2.6 mm wide; split-lip laceration wider (ss 0.9-2.1 mm); cyanotic lips 0.080/0.068/0.098 (0.062 = black
    rubber off the core); coat_min 0.3; torch aim (-15,-37,-42) (4 mm lower: the split lip). Same framing as r31.
  * **r32** (look-r32.png/.exr, sheet-r32.png = r31 | r32; scratchpad k/r32f.png floor proxy, k/r32crop.png = 100 % eye |
    mouth | grip; 128 spp, render 526 s, job 755 s, peak 2.9 GB, metered EV -10.27). Marks /255: fingertips 90 / 69 / 53 /
    46, crescent 104, shiner 40, old cheek 121, brow scar 21 (just over), split lip 14 (FAIL), thumb 2.6, temples 1-1.5
    (FAIL). AD glint script: 296 components (r31 337, r24 687), 1-8 px 192, >= 31 px 7. **Verdict: the EYES are the
    first part that reads close to a photograph** (100 % crop: an ivory dead sclera with the lateral haemorrhage and
    injection, a grey clouded cornea with a catchlight, wet lower lashes over the swollen purple bag with wet glints) —
    the whites of the eyes were the doll tell. The grip marks now read as violet bruises with a yellow halo (still a
    little flat / decal-like). Still CG: the MOUTH (a smooth rubbery lavender upper-lip roll over a dark-red toothless
    puppet hole: 1.6 mm of enamel), the skin (lacquer streaks over smooth plaster), the scars still invisible at frame
    scale (x1.42 + border: lit 104/255 but no contrast read), split lip in shadow.
  * r33 changes (mouth only, attributable): the upper lip RETRACTS 2.6 mm at the midline (-> 0 by |x| 19; dead lips dry
    and shrink) — scare_head `lip_retract`: the slit is widened upward only (the jaw warp's split stays at the old
    stomion), the upper vermilion's relief rolls back at the retracted edge — baring ~5 mm of the upper incisors incl.
    her broken right central; dead mucosa 0.13/0.045/0.052 (was 0.25/0.07/0.08 = lit red puppet), gum 0.17/0.075/0.08,
    cyanotic tongue 0.13/0.075/0.10. Scalp cache aliased again (hair_v3s3f14b4f89be9).
  * **r33** (look-r33.png/.exr, sheet-r33.png = r32 | r33; scratchpad k/r33f.png floor proxy, k/r33crop.png = 100 %
    mouth; 128 spp, render 526 s, job 808 s, peak 2.8 GB, metered EV -10.34). Marks /255 unchanged within 2 (fingertips
    88 / 68 / 51 / 45, crescent 101, shiner 39, brow scar 20.5); split lip: the laceration's 1.2 mm clot core 13 (a 0.035
    albedo clot cannot reach 20 under this light), the swollen split half-lip (scare_tex `swell` blob) **29 = PASS** —
    metric definition note for the lead. AD glint script 305 components. **Mouth verdict: the bared upper incisors with
    the broken right central (a black notch) are the biggest horror + "real mouth" gain since the eyes** — but at 100 %
    the teeth read as a clean cream DENTURE (uniform, the brightest flat thing under the torch); the upper lip is thinner,
    fissured, dead lavender-grey; the interior no longer a red puppet. Lab r34a (base layer) queued.
  * **Lab r34a — the BASE layer** (scratch/jumpscare/lab/c0..c4, scratchpad k/lab34a.png = c0 | c1 / c2 | c3; 146-152 s
    per variant). Hypothesis: in Cycles' random-walk SSS the Base Color IS the scattering albedo; the 0.255 neutral PALLOR
    absorbs ~75 % per scattering event, so paths die well inside the nominal radius = grey clay / plaster. New SKIN hooks
    `alb_gain` (an RGB gain on the per-vertex albedo) and `sss_mm`, plus `c_film3` (a ~1 mm film undulation). c0 = r33;
    c1 gain (1.7, 1.55, 1.35) (-0.7 EV to re-meter); c2 = c1 + SSS 2.4 mm; c3 = c2 + spec_wet 0.25; c4 = c2 + c_film3 0.04.
    AD glint comps 38 / 30 / 33 / 32 / 39 (no glitter regression). Read at 100 %: c1 turns grey clay into pale skin
    (cream-pink, the bruise bag more saturated, crisp texture); c2 softer and more translucent (less plaster, a little
    wax, softer pores); c3 / c4 indistinguishable from c2. The coat levers of labs a/b (c_film, coat roughness, coat_min)
    moved nothing: **the "lacquer over plaster" read was the BASE (absorbing albedo), not the film.** The crescent scar
    shows in the lab crop (a pale arc in the yellow bruise).
  * r34 changes: alb_gain (1.7, 1.55, 1.35) (pale dead skin ~0.42/0.38/0.33; every mark scales with it, so their relative
    contrast is unchanged), SSS 1.2 -> 2.0 mm (between c1 and c2), spec_wet stays 0.05 (physical skin/water interface;
    c3 showed no gain); sclera 0.44 -> 0.56/0.53/0.46 (kept ahead of the brighter skin), limbal band 0.33; teeth: dead
    water-stained enamel 0.30/0.26/0.18 with grey translucent incisal edges 0.22/0.21/0.19, a blood-brown cervical third
    0.11/0.035/0.028, 1 mm mottle x0.85-1.12, roughness 0.22 -> 0.34, coat 0.6 -> 0.35 (r33: a clean cream denture).
  * **r34** (look-r34.png/.exr, sheet-r34.png = r33 | r34; scratchpad k/r34f.png floor proxy, k/r34crop.png = 100 % eye |
    mouth | cheek; 128 spp, render 565 s, job 644 s (head cached), peak 2.5 GB, metered EV -11.00). Marks /255:
    fingertips 86 / 66 / 51 / 43, crescent 101, shiner 37, old cheek 119, brow scar 22, swollen split lip 28 (clot core
    11), thumb 2.5 / temples ~1 (off the beam). AD glint script: 264 components (r24 687), 1-8 px 191, >= 31 px 4.
    **Read:** the skin is warmer and reads more like pale skin than grey clay at 100 % (pores/stipple, natural pale
    colour round the grip bruises, which now read as violet bruising with a yellow halo); the bared stained teeth with
    the broken incisor read as real teeth (no denture). Regression: the 0.56 sclera round the ~0.12 cornea = a crisp
    dark disc on a white ball — a glass DOLL eye (r32's 0.44 was better). Still CG overall: lacquer-like highlight
    streaks, a smooth rubbery upper lip, the face a lit oval on black.
  * r35 change (eyes only): sclera 0.49/0.465/0.40; cornea MILKIER per the brief ("iris-less, milky clouded"): milk
    0.205-0.235 -> 0.285-0.315 at density 0.40 -> 0.52 (+-0.22, 0.30-0.80) over the dark iris/pupil ghost — the r9-r18
    "blank white disc" was the double-lit refractive caustic (fixed r21), not the milk.
  * **r35 = the current still** (look-r35.png/.exr, sheet-r35.png = r34 | r35, **sheet-r24-r35.png = the AD's r24 | r35
    with the floor proxy**; scratchpad k/r35f.png floor proxy, k/r35eyes.png = 100 % both eyes; 128 spp, render 560 s,
    job 640 s, peak 2.2 GB, metered EV -10.99). Marks /255 (ruling au, rule >= 20): fingertips 87 / 66 / 51 / 43, crescent
    scar 101, old cheek bruise 119, shiner 37, swollen split lip 28, brow scar 22 = PASS; split-lip clot core 11, thumb 2.5
    (her left cheek, off the beam), temples 1.0-1.2 = FAIL. AD glint script (whole frame): **261 components (r24 687, r30
    411)**, 1-8 px 191 (r24 577), >= 31 px 4 (r24 13). Eyes at 100 %: the lit right eye reads as a milky clouded dead eye
    (ivory sclera, lateral haemorrhage, grey-blue milk with a faint ghost, catchlight) — the r34 glass-doll disc is gone;
    the shadowed left eye shows its haemorrhage; both caruncles are still smooth pink beads.
  * Note: `scare_render.film_finish` got the `--floor` read-noise proxy (default 1.6/255) after r31 started, so
    look-r32.png .. look-r35.png already carry it (look-r31.png does not); the scratchpad k/r3Nf.png views of r32-r35
    applied k/floor.py on top (two floors: ~2.3/255 std in the blacks — cosmetic, judged anyway). Consequence for the
    k/marks.py numbers: r32-r35 were measured on FLOORED pngs (r30/r31 without): marks >= 20/255 are lifted < 0.5/255
    (the floor fades out by display 0.35), but the thumb / temple / clot-core values (1-2.6, 11) are floor-dominated —
    read them as "black", and do not compare the clot core across the r31/r32 boundary.
  * **147h STOPPED here; the look is NOT approved. Do not render the sequence.** Honest read of r35 against the AD
    round-2 list: more horrifying than r24 (closer, both milky dead eyes stare, bared stained teeth with the broken
    incisor, violet grip bruises with a yellow halo on the lit cheek, haemorrhages in both eyes, the black-eye bag and
    the nosebleed) but **it still reads as a high-end CG game cinematic, not a photograph**: (1) the wet highlights are
    smooth elongated streaks = lacquer (the AD's "sheets" exist on the bag / lips / nose base, but the >= 31 px gate
    fails: 4 components; physically the half-vector of a torch 30-45 deg under the lens misses the nose tip and the
    upper cheek by more than the ~2.5 deg mirror tolerance — staging, not shading); (2) the upper lip is still a smooth
    rubbery roll (thinner, fissured, retracted); (3) the face is a smooth lit oval on black — the 1-5 mm soft-tissue
    relief (r31) barely registers at frame scale; (4) the crescent and brow scars are lit but faint at frame scale;
    (5) caruncles = pink beads; (6) thumb and temples cannot be lit by a 3.4 deg krypton core aimed at the cheek.
    What moved the read (keep): the eye albedo relationships (sclera vs skin vs milk, r32/r35), the absorbing-albedo
    base fix (r34: grey clay -> pale skin), the bared teeth (r33), the marks moved into the beam (r31). What did NOT
    move it (stop tuning): coat-normal terms, coat roughness, coat weight, film undulation (labs a, b, c3/c4).
  * Next (whoever continues): (1) the upper lip: real vermilion texture (deeper, irregular vertical cracks 0.2-0.4 mm
    in the relief, dry flaking, darker commissures) — it is the most "latex" part left; (2) caruncle + plica: a wet,
    lumpy, darker pink-grey mound instead of the bead; (3) scars at frame scale: raise the brow scar into the beam (or the
    beam to it) and give both scars a shiny ridge (disp 0.36 -> 0.6, roughness 0.22 -> 0.15) so they read by their
    highlight, not their albedo; (4) a staging decision on the torch height (a sheet highlight on the nose tip needs the
    torch <= ~0.09 m under the lens, g/hilite2.py); (5) the runtime noise floor (below).
  * Requests for the lead (147h): (a) ruling (au)'s framing numbers are geometrically impossible together at 16:10
    (k/frame.py: this head's cheekbone span is 0.77 x its brow-chin span; >= 1.12 would be needed): r31+ use brow-chin
    108 % H / cheekbones 52 % W — please restate the target as one number; (b) ruling (au) says "the game's grain and
    noise floor are added by the post chain at runtime", but `src/render/camera-fx.ts` filmFinish grain is
    MULTIPLICATIVE (c(1+g): "black stays black") — there is NO runtime noise floor; the stills here are judged through an
    ISO-1200 read-noise proxy (`scare_render --floor`, default 1.6/255) and the scare player (`src/world/jumpscare.ts`,
    this lane) or the PERF lane (camera-fx.ts) must add an additive floor or the scare frames sit on a digital void;
    (c) the hero torch is staged at 0.065 m right / 0.04 m behind / 0.13 m under the lens (the game's live torch is
    0.18 R / 0.16 D, beam converging at 3 m): the cutscene stages the beam ON her face — confirm, or rule a height;
    (d) "a split lower lip with a dark clot" vs ">= 20/255": a 0.035-albedo clot core reads 11/255 in the lit lower lip;
    the swollen split half-lip reads 28 — which is the mark?; (e) the thumb mark (her left cheek) and the temple
    marbling are off the 3.4 deg krypton core whatever the aim (aiming at them costs the eyes 3-4 EV): accept them dark?

- **LEAD RULING (au), 2026-10-19 06:55 — read before the next round; it answers the AD round-2 staging question.**
  * The NECK is no longer a gate. The user's words were "her face in the frame, ONLY her face … detailed bruises and
    scars". The cut neck at the bottom edge was a lead addition in (ap); it costs a render pass per round and reads as
    ham / pie crust / gummy worms. Stop the neck renders and the chin-up / neck test frame. Leave the neck dark below the
    chin; at most a sliver of ragged cut may show at the bottom edge.
  * FRAMING: the face FILLS the frame. Brow to chin is ≥ 85 % of the frame height, the cheekbones span ≥ 70 % of the
    width, and both eyes are open and clear of strands (the double dead stare of r8rest was the most frightening thing
    so far). Hair frames the face from the sides and top only.
  * HORROR goes ON THE FACE, IN THE LIGHT: the fingertip grip bruises move up onto the lit jaw and cheek (yellow-green
    edge, purple core), a split lower lip with a dark clot, a subconjunctival haemorrhage in both eyes, lid petechiae,
    the old healed scars (brow and a cheek crescent) inside the beam, and drowning marbling at the temples. The AD's
    metric rule: every listed mark measured ≥ 20/255 display mean at viewing exposure.
  * The water film is SMOOTHER than the skin under it: no pore / furrow terms in the coat normal (AD round 2 (a)).
  * The background may stay black (the game's grain and noise floor are added by the post chain at runtime). Judge
    stills through a grain proxy of the same ISO-1200 look before calling it a "digital void".
  * Next approval gate (unchanged otherwise): one 128 spp nose / cheek / eye crop for the specular test, plus ONE full
    frame at the new framing. Do not render the sequence until the AD passes a still.

- **147i RENDER + ENCODE agent (2026-10-19 09:20).** Task text asked to render the full 30-frame sequence, encode per tier
  into public/assets and make a motion contact sheet. **GATE CONFLICT — the sequence is NOT rendered:** the review in the
  task text is the round-1 FAIL of look-r8rest ("Do not render the sequence on this still"); r24 failed round 2; r35 (the
  current still) was self-assessed FAIL by 147h and has never been AD-reviewed; ruling (au) says "Do not render the
  sequence until the AD passes a still". Cost check: r35 = 560 s/frame at 128 spp, 1920x1200, without motion blur ->
  256 spp + blur ~ 18-20 min/frame -> 30 frames ~ 9-10 h of Blender lock for a look that is not approved. Nothing is
  written to public/assets (an unapproved clip would ship on the next lead push). Plan instead (make the render turnkey,
  all gate-safe): (a) keyframed sequence animation (pose empty, spasm key, lid twitch, lurch) + motion blur behind a
  `--seq` path; (b) r35 staging (ruling au), not Spec §2's camera numbers; (c) a short low-res MOTION TEST (6 frames of
  the arc, 960x600, motion blur on) via `scare-look` = a look render: RAM / time / boil numbers; (d)
  `blender/scare/scare_encode.mjs` tested on look-r35.exr with synthetic motion (first real size numbers + round trip);
  (e) `scare-render` job wiring after reading how assets.mjs treats manual jobs' outputs.
  * **(d) DONE — `blender/scare/scare_encode.mjs`** (no npm deps; ffmpeg 9.0.1 decodes/encodes, the rest is in the
    script). Modes: `--frames DIR` (f0000.exr…, refuses to encode an incomplete set: prints `incomplete` and exits 0, so it
    can be a post step after every chunk), `--still X.exr --synth 30 [--boil σ]` (synthetic drift/zoom/roll + lurch proxy),
    `--calib` (16-step grey + R/G/B ramp chart). Linear Lanczos-3 downscale BEFORE the log curve; log curve per channel
    (Lmax = 4 × p99.9 of the ref, L0 = Lmax/2^12); own BT.709 tv Y'CbCr + left-sited 4:2:0 + static TPDF dither ±1 code;
    libx264 High veryslow, keyint 30, aq-mode 3, tags bt709/bt709/iec61966-2-1/tv (ffprobe-verified); explicit levels
    (x264 picked 5.1/5.0/5.0 itself): Max 5.0 = `avc1.640032` (1920×1200 = 9000 MBs > level 4.2's 8704), Medium/Low 4.0 =
    `avc1.640028` with ref 8. Writes `<tag>.json` (L0, R, Lmax, codecs) for the runtime. `--ship` refuses unless
    `--frames` + `--approved "<AD review id>"` (the gate in code). **Found:** ffmpeg's EXR → gbrpf32le conversion is
    LOSSY for HDR (swscale; max rel. error 1.0 on look-r35.exr) — the script reads the native gbrapf16le planes and decodes
    halves itself (p99.9 1092.8 = Blender's 1092.66).
    - Calibration chart through the codec (patch centres, RGB' codes): max err 0.48 (Max) / 1.06 (Medium) / 1.25 (Low),
      ≤ 1.5 = PASS (codec + matrix only; the BROWSER readback through the quad is still for the player builder:
      scratch/jumpscare/encode/scare_face-calib-<tier>.mp4 + -chart.json).
    - **First real sizes (r35 detail, 30-frame synthetic motion, no motion blur):** Max CRF 18 **792 KB**, Medium CRF 20
      **314 KB**, Low CRF 22 **131 KB**; with a pessimistic 2 % i.i.d. per-frame "boil": 812 / 316 KB. Caps Max ≤ 3 MB,
      Medium ≤ 1.5 MB fit with ≥ 4× margin (real frames with moving hair + motion blur: expect ~1.5–3× these). Low: the
      131 KB clip does NOT fit Low's ~10 KB left → Low stays the in-engine fallback unless the WebP swap is approved.
    - Round trip (decode → inverse curve vs the linear source, lit face = within 8 stops of Lmax, luminance EV error with
      the L0 pedestal): Max p50 0.036 / p95 0.114 EV, bias +0.006 EV; Medium 0.047 / 0.155, bias +0.006; Low 0.060 / 0.200.
      Inspection sheet (scratchpad enc/sheet-roundtrip.png: Medium src | decoded at 100 %, decoded +4 EV): no visible
      difference at 100 %, no banding in the +4 EV falloff, hair strands intact.
  * **(a) built — `blender/scare/scare_seq.py`** (+ a 5-line `--seq` dispatch in scare_render.py just before the hero
    render): the arc is KEYFRAMED (every frame −1…30 at Blender frame 10 + f; Cycles motion blur samples sub-frames, so
    per-frame Python posing would give no blur): a proper parent empty `scare_anim` carries a world-space delta about a
    grip pivot 0.15 m above the frame centre; the mirrored hero `scare_pose` stays its child unchanged; the `spasm` key
    (head + lower teeth, slider_max 1.5) is keyed. Curve (numbers per frame, dy = away from the lens): f0 +30 mm / −20 mm
    low / chin 4°, 0.35 m/s → overshoot −8.1 mm at f4 → settled by f9; drift yaw ±1.2°, roll ±1.5°, 2 mm sway; spasm key
    0 → 1 (f10→f12) → 0.3 (f15); lurch f27 −9 / f28 −36 / f29 −80 mm (1.3 m/s), chin +4°, key → 1.3. Motion blur:
    `render.use_motion_blur`, `motion_blur_shutter` 0.5 (names checked at runtime, logged), position CENTER. Frames:
    `--frames 0-5` / lists, `--seqout`, EXR written as `.part` then renamed (resume-safe), AgX preview at a FIXED `--ev`,
    contact sheet (all frames, or every 4th of a full run). Probes: `--mboff F` (same frame without blur → cost ratio),
    `--boilcrop x0,y0,x1,y1 --boilspp 128,256` (a FULL-RES crop rendered with seed 0 and 1: display std of the
    difference / √2 = the per-frame denoiser residual, an upper bound on boil with the static seed). Deviations: no lid
    twitch (no lid key), no water gush (no water object), hair rigid with the head (no secondary swing; the face strands
    do not follow the jaw key), camera + torch world-fixed.
  * **(e) built — pipeline.json**: `scare-look` inputs + scare_seq.py; NEW manual `scare-render` (group scare, post =
    `scare_encode.mjs --frames .cache/scare/frames/final --expect 30 --check`, which encodes only when all 30 frames
    exist; declared outputs `public/assets/{max,medium}/scare_face.mp4` kind data id `scare_face` + `scare_face.json` id
    `scare_face_meta` — absent until shipped, which assets.mjs tolerates: manifests list only files on disk). Note:
    `warnStaleManual` only fires when a NON-manual job shares the output path (`supersededBy`) and none shares
    scare_face.mp4, so face-builder edits to blender/scare/*.py AFTER shipping will never trip `assets --check` for
    scare-render — re-render deliberately when the look changes. Shipping is a hand step (`--ship --approved`, then
    `npm run assets -- --manifest`). Read first: level.ts:250-253 downloads only level/prop/collision/lightmap kinds, so
    a `data` entry never loads before the player builder fetches it. Contract row 147i.
  * **(c) MOTION TEST mt1 DONE** (job `scare-look`, r35 args + `--res 960x600 --spp 48 --ev -10.99 --seq mt1 --frames
    0,4,12,20,27,29 --seqout scratch/jumpscare/seq-mt1 --mboff 20 --boilcrop 1000,450,1400,750 --boilspp 128,256`; queued
    behind two headless-Chrome runs, then 800 s in Blender; log .cache/logs/scare-look-2026-10-19T04-07-40-096Z.log).
    Keyframed object + shape-key motion blur WORKS in Blender 5.2 (`render.use_motion_blur` / `motion_blur_shutter` /
    `render.motion_blur_position` exist; no NSURL abort with frame_set before render). Measured:
    - **Peak RSS 2.59 GB (time -l 2.72 GB)** with motion blur — same as the stills (2.2–3.0 GB): chunk / "never next to
      Chrome" rules unchanged.
    - **Motion blur cost +6 %** (f20: 62.1 s with, 58.7 s without). Frame times 53–70 s (f29, head at 0.11 m filling the
      frame: 94 s) = **1.93 s per spp·MP**, the same rate as r35 (560 s at 128 spp, 1920×1200). Sync overhead negligible.
    - **Full-sequence cost at 1920×1200: 128 spp ≈ 9.5 min/frame → ≈ 4.8 h; 256 spp ≈ 19 min/frame → ≈ 9.5 h** (+~10 %
      for the lurch frames). Spec §2's "40–70 min per 6-frame chunk" is 2–3× too low: chunk = **3 frames per lock hold
      (≈ 30 min at 128 spp, ≈ 1 h at 256)** so QA gets windows.
    - **Boil probe** (full-res 400×300 crop of f16, seed 0 vs 1, display /255, lit skin): 128 spp **1.25** std, 256 spp
      **1.09** — doubling spp buys only −13 % (not −29 %): the residual is OIDN's structured 3–6 px blotches on the SSS
      skin + hair-edge sampling, not plain sample noise (scratchpad enc/boil.png, difference ×16). An upper bound (with the
      static seed the hold drifts < 1 px/frame), but it is ≥ 1/255 at either count: 256 spp is not worth 2× the time for
      boil. Judge boil on the first full-res chunk in motion (encoded, through the game's grain); if it crawls, measure
      512 spp on the same crop before paying for it on 30 frames (Blender 5.2 OIDN is already quality HIGH + prefilter
      ACCURATE, and Cycles has no temporal denoiser).
    - Contact sheet scratch/jumpscare/seq-mt1/sheet.png (f0 | f4 | f12 / f20 | f27 | f29, AgX at fixed −10.99, no film
      finish): the arrival reads (f0 smaller, lower, motion-blurred), f4–f20 hold steady with a slight roll, f12 shows the
      spasm (wider mouth), f29 the lurch fills the frame, defocused, the nose shadow darkening the centre. **The lurch does
      NOT go dark by itself** (display mean f27 16.8 → f29 15.4 /255: closer to the torch outweighs leaving its core) —
      the player module's cut to black at mediaTime ≥ 0.98 s (Spec §3) must do it. The look itself is unchanged r35 (CG).
  * **(c2) ANIMATIC mt2 DONE — all 30 frames, end to end** (same r35 args, `--res 960x600 --spp 16 --seq mt2 --frames
    0-29 --seqout scratch/jumpscare/seq-mt2`; 19–34 s/frame, peak 1.98 GB; log .cache/logs/scare-look-2026-10-19T04-32-49-
    860Z.log). Contact sheet of every 4th frame: scratch/jumpscare/seq-mt2/sheet.png (f0 f4 f8 f12 / f16 f20 f24 f28).
    Frame-to-frame mean |Δ| luma (ffmpeg tblend + signalstats, /255): arrival 4.8 5.5 4.9 3.1 → settle 1.6 2.1 2.2 1.8 →
    hold 0.5–2.1 (spasm f10–f14 1.7–2.1) → lurch 3.6 9.2 14.0. **No isolated spike anywhere = no pop**; the curve is the
    designed motion (the 16 spp noise is part of the hold's 0.5–1 floor). Read: arrival from below into the beam, a steady
    hold with a slight roll, the jaw snaps wider at f12 and relaxes, the lurch fills the frame out of focus. The 2-frame
    jaw snap (67 ms) reads as a spasm in the sheet, not a pop.
    Encoded through the real chain (`scare_encode.mjs --frames scratch/jumpscare/seq-mt2 --tiers low,medium --check`,
    out scratch/jumpscare/encode/mt2/): Low 960×600 **182 KB**, Medium (upscaled from 960×600) **410 KB** — 16 spp noise
    inflates these; round trip Low p50 0.052 / p95 0.19 EV, Medium 0.040 / 0.141, bias ≤ 0.003 EV. The incomplete-set
    guard works (seq-mt1, 6/30 frames → `incomplete`, exit 0).
  * **What is turnkey now** (once the AD passes a still): `node scripts/assets.mjs --only scare-render --force
    --job-args="<approved look args> --spp 128 --ev <its metered EV> --frames 0-2 --approved <AD-review-id, no spaces>"`
    (the job's own args add `--seq final`; scare_seq REFUSES the `final` tag without `--approved`, so a group run of
    `--only scare` renders nothing). **First chunk = the risk frames `--frames 12,16,17`** (the spasm peak at full res:
    deform blur + the face strands that do not follow the jaw key, invisible at mt2's half-scale tiles; and two ADJACENT
    hold frames for boil in motion: `node blender/scare/scare_encode.mjs --frames .cache/scare/frames/final --subset
    16,17 --check`, viewed through the game grain) — resume-safe, nothing is wasted; only then 0-2, 3-5 … 27-29 (each
    chunk ≈ 30 min, resumes, the post step encodes when frame 29 lands) → inspect scratch/jumpscare/encode/scare_face-*.mp4
    + .cache/scare/frames/final/sheet.png → `node blender/scare/scare_encode.mjs --frames .cache/scare/frames/final
    --check --ship --approved "<AD review id>"` → `npm run assets -- --manifest` → `assets --check`. NOT done by 147i: the
    full sequence, shipping, and the runtime player (src/world/jumpscare.ts, death.ts timeline, sting) — another role.
  * The `--approved` guard in scare_seq (added after mt2) is only py_compiled: the lead's first scare-render run is its
    first execution. The encode post step runs AFTER assets.mjs releases the Blender lock, so scare_encode.mjs now sets
    nice 19 (inherited by ffmpeg) and caps x264 at 4 threads; `--subset 12,16,17` encodes an inspection clip (never
    shippable; tested on mt2: 27.6 KB Low).
  * Requests for the lead (147i): (1) **the blocker is an AD review of look-r35** — the workflow's render step was handed
    the stale round-1 review of r8rest; no still has passed; (2) pick the sequence spp: 128 (≈ 4.8 h) vs 256 (≈ 9.5 h for
    −13 % boil, measured); (3) Low stays the in-engine fallback (a Low clip is 130–180 KB; Low has ~10 KB) unless the WebP
    normal-map swap (Spec §5) is approved; (4) the runtime must check `avc1.640032` for Max (level 5.0) and `avc1.640028`
    for Medium (the encoder's JSON carries both), and own the cut to black — the lurch does not darken by itself;
    (5) accept the motion deviations (no lid twitch, no water gush, rigid hair; staging per ruling au).

- **147j FACE BUILDER, fix round 3 (2026-10-19).** AD round 3 failed look-r35 (a wet latex mask with white-out lenses at
  frame scale; mid-budget CG at 100 %). Task: its TOP 3 problems only, <= 4 look renders (r36..r39), one as-played proxy
  (scratch/jumpscare/played-rN.png). Rulings (au)+(av): one fix + review loop, then the final render goes ahead with the
  best still whatever the verdict. NO shading/coat/torch/framing/neck changes (the AD: those levers are exhausted).
  * Plan (FORM, judged in the r35 camera): rank 1 MOUTH — philtral columns + dimple, Cupid's bow + white roll, tubercle,
    lower lip drooped/everted 3.5 mm so the lower incisors show and catch the beam, tongue up behind them (coated, wet),
    saliva strings, oblique incisor fracture with dentin + pulp, no lateral "fang" lobe (retraction runs to the corner),
    irregular broken lip cracks (not 1.1 mm corrugation); rank 2 EYES — upper lids lowered (cover 1.5 / 2.5 mm of the
    cornea, her right more closed), patchy milk with striae + a 3 mm pupil ghost, feathered desaturated haemorrhage,
    0.25-1 mm red-purple petechiae (sclera + lids; the lid "brown dirt" = r35's 0.105/0.022/0.032 petechia colour), a
    lumpy wet caruncle + plica, lashes in 4-7 wet spikes; rank 3 BROWS + SCARS — ~300 hairs/brow in 6-12 wet tufts,
    the scar gap fixed (r35's gap line was NOT perpendicular to the scar: it crossed the brow at x -13, the scar at -29),
    brow scar ridge 0.6 mm / roughness 0.15, the crescent a raised shiny ridge.
  * Tools (scratchpad j/): `hero.py` = numpy FORM preview in the exact r35 hero camera (k/frame.py maths: mirror, yaw 15,
    pitch -4, dist 0.19, camup 0.04, centre -6,-24,-36) with the real torch position + shadow ray and region colours
    (`FLAT=1` = N.V shading); `hkey.py` = the scare hair cache keys without bpy (self-check: printed 3f14b4f89be9 /
    c4d5c8f82ac3 on the r35 files) and `--alias` (copies the newest scalp npz to the new scalp key: lips / lids /
    brows never move the scalp, a re-integration costs ~20 min).
  * Baseline findings (j/base_eyes.png, j/base_mouth.png): (eyes) the visible upper lid edge sits only ~0.6 mm below
    the limbus top at 12 o'clock (the anterior lid edge is r 14.3 mm from the globe centre, so it projects ~1.3 mm
    higher than the margins() elevation) and ABOVE the limbus at 10-11 / 1-2 o'clock = the AD's 360 deg scleral show;
    (mouth) the lower teeth AND the tongue exist and are visible to the camera — r35's "void" is LIGHT: the torch
    ~20 deg under the mouth is blocked by the lower lip (lower incisal edge ~ the lip-top height), so the lower teeth /
    tongue get bounce only (the palate, which the beam reaches, is not visible from the camera 14 deg above).
  * r36 changes (one batch, attributable by region; previews j/v1_flat.png = eyes + mouth, j/v2_lit.png = mouth with
    the torch + shadows, j/eyes_tex.png, j/teeth.png):
    - scare_head: `EYE_UP` (17.5, 18.5) -> (12.5, 9.0) (visible edge crosses the cornea ~1.7 / ~2.6 mm); Cupid's bow
      +1.0 / dip -1.4; philtral columns 0.35 -> 1.2 mm + a 0.9 mm dimple groove; upper vermilion thinner laterally +
      a 1.0 mm central tubercle at the free edge; white roll 0.35 -> 0.7 mm; `lip_retract` decays to |x| 24 (no lateral
      lobe = the "fang"); NEW `LIP_SAG` 3.6 / `lip_sag` / `lower_lines`: the lower lip's free edge 3.6 mm under the
      stomion (slot widened downward), everted (4.4 mm, sharper fall at the border + a 0.3 mm border ridge), its border
      0.45 x sag lower; `TONGUE_C/R` (0, 6, -64.3) r (19, 25, 7.4) lumpy (+-0.35 mm) — dorsum just over the lower
      incisal edges (v2_lit: the lower incisors and tongue patches now take the direct beam); caruncle = a flatter lumpy
      3.8 x 3.2 mm mound set back + `plica()` fold; teeth: per-tooth crowding (+-4 deg, +-0.35 mm, 0-0.45 mm wear),
      canines worn (tip 0.3 mm ABOVE the incisal plane; was 1.2 mm below = fang), `fracture_cut` = an oblique jagged
      37 deg enamel-dentin fracture with a lingual bevel (was a rectangular notch), `fracture_masks` (dentin, pulp);
      LACERATION moved onto the drooped lip.
    - scare_tex: mucosa 0.13 -> 0.16, tongue 0.17 + a patchy grey-white coat on the dorsum, the everted lower lip's top
      = wet mucosa (`evm`), paler white roll, caruncle/plica grey-pink mottled + wet (rough 0.15), tongue rough 0.25;
      brow scar ridge 0.36 -> 0.6 mm + puckering creases at both ends, the crescent a RAISED 0.45 mm ridge (was -0.24),
      scar roughness 0.22 -> 0.15.
    - scare_scene: sclera petechiae 0.25-1.0 mm red-purple in 7 lower-bulbar clusters (were 0.04-0.17 mm = sub-pixel);
      haemorrhage edge feathered (ss 0.88 -> 0.68), chroma -20 %, mottled, flat (bump 0.6 -> 0.08); corneal milk denser
      centrally (x0.84-1.10), radial striae, an irregular ~3 mm pupil ghost, limbus fade 3.5 -> 4.5 deg inside; skin
      petechiae 0.30/0.045/0.075 soft-edged 0.25-0.6 mm (the "brown dirt"); lip cracks = two broken `_lines` families
      (0.78 / 2.4 mm) + dark crack albedo (was one Wave BANDS = corrugation); teeth `dent`/`pulp` attributes -> dentin
      0.45/0.38/0.25 + pulp 0.20/0.05/0.05; NEW `saliva_curves` (2 watery strings across the mouth, deformed space).
    - scare_hair: lashes in 5-7 (upper) / 4-5 (lower) spikes, convergence 0.80-0.97, hairs off the spikes dropped (165
      lashes, was ~360 evenly spread); brows 105 -> 300 hairs per brow, 7-11 tufts, convergence 0.7-0.92, radius
      0.032-0.048 mm, the scar-gap line fixed (1.9 mm). scare_render: brows use the WET hair material; saliva strings.
    - Scalp cache aliased hair_v3s3f14b4f89be9 -> hair_v3s6fb74a03660a (j/hkey.py --alias).
    - Job: `node scripts/assets.mjs --only scare-look --force --job-args="--round 36 --spp 128 --res 1920x1200 --h 0.6
      --dist 0.19 --center -6,-24,-36 --pitch -4 --torch 0.065,-0.04,-0.13 --aim -15,-37,-42 --yaw 15 --fstop 11
      --focus -20,-22,-8 --frame hero"` (= r35 staging).
  * **r36 RENDERED** (11:24, 910 s in Blender, 1110 s with the Chrome queue, peak 2.2 GB, metered EV -11.04; log
    .cache/logs/scare-look-2026-10-19T05-36-18-133Z.log; scratch/jumpscare/look-r36.png). The first 147j instance was
    cut off before judging it; **judged by the 147j restart (r36 = render 1 of the 4; r37-r39 left).** Views: scratchpad
    j/cmp-r35-r36.png (r35 | r36 full/4 + eyes 100 % + mouth 100 % and +2 EV), j/r36-zoom.png (philtrum x2, brows x6
    lift, inner canthi). Numbers (display /255, j/meas.py, j/meas2.py):
    - IMPROVED: the lit eye (the upper lid now crosses the cornea; lashes in spikes; red petechiae on the lids + lower
      bulbar sclera instead of brown dirt; a flatter caruncle mound); the lower incisors show and catch the beam (x 870:
      20-45); 2 saliva strings; the incisor fracture is oblique; the commissure "fang" is gone.
    - STILL FAILING (rank 1, the biggest): the upper lip reads as a smooth lavender roll; (CORRECTED after r37 — the
      first version of this note claimed "the vermilion body is as bright as the skin at 1/3 of its albedo = specular":
      the L 107-148 pixels at x 940/1000, y 792-830 are the free-edge roll FACING the torch + the upper teeth, not the
      vermilion; the vermilion band itself (y 750-795) was L 78-88 vs skin 113-128 already, and r37's specular/coat cut
      moved it by <= 3/255 — the sheen hypothesis is REFUTED, see r37). The everted LOWER lip's wet
      top (`evm` 0.15/0.052/0.07 x alb_gain = 0.255/0.08/0.095) is a saturated red crescent (x 1000 rgb 65/34/35) = clown
      lip. The philtrum: +1.2 mm columns are flat in the profile (L 137-140 across them at x 870) — under a near-frontal
      under-torch a 1 mm relief casts no shadow: a STAGING LIMIT, not fixable by shaping. The interior at the centre
      column (x 940) is still 1-6 (fracture gap / throat); where the beam reaches (lower incisors) it is 20-45.
    - rank 2: the cornea disc edge still reads crisp at 100 %; the shadow-side caruncle still a lit bead.
    - rank 3: the brows EXIST (557 strands) but are sub-pixel-thin grey on undarkened skin in the dim top band: image-
      right brow L 2-6 vs lit forehead 17-25 at the same height, scar gap 10-13 — invisible at frame scale.
    - The render log's `cheek_scar` spot is STALE (skin_radial(31, -24) = her LEFT, the pre-147h location; the crescent is
      at (-39, -13) r 13 on her lit right since 147h): its -5.14 EV is not the scar. Fixed in r37 (spots updated).
  * **r37 changes (147j restart; one batch; rank 1 lip material + rank 3 brows; eyes left as r36: the lit limbus already
    falls 81 -> 54 over ~0.8 mm = inside the AD's 0.6-1.0 mm, the cornea now well under the medial sclera; philtrum left:
    staging limit).** Region-LOCAL material inside rank 1 (the AD's own fix text asks for a colour border), not the
    global coat/film tuning the labs exhausted:
    - scare_tex: dry vermilion roughness 0.58 -> 0.80; lip SSS x0.7 -> x0.4; the everted mucosa `evm` 0.15/0.052/0.07 ->
      dusky 0.10/0.056/0.076 at weight 0.75 (was 0.85), roughness 0.15 -> 0.28; the swollen split half 0.16/0.05/0.08 ->
      violet 0.115/0.048/0.088; the exported `lip` attribute = lip x (1 - evm) (the wet mucosa keeps the inner lip's
      film; only the dry vermilion goes matte); NEW brow-skin band x0.60/0.58/0.62 along brows()' root line (follicle
      pigment + root shadow), excluded on the scar (pale break).
    - scare_scene: SKIN lip_dry 0.75 -> 0.92; NEW SKIN lip_spec 0.70 (base Specular IOR Level x (1 - 0.7 lip) -> ~0.14 on
      the dry vermilion, F0 ~0.008); NEW pale peeling keratin flakes on the dry lip (0.5-1.5 mm, _zn 1100/m z 0.9-1.6 =
      ~5-18 %, colour 0.30/0.27/0.27 at 0.6, roughness +0.12).
    - scare_hair.brows: 300 -> 340 hairs per brow (633 strands kept), radius 0.032-0.048 -> 0.040-0.056 mm (80-112 um).
    - scare_render: metering spots `crescent_scar` (-39, -26), `brow_scar` (-27, 18.5), `brow_R` (-38, 17.6) added (the
      ruling-au >= 20/255 check); the stale `cheek_scar` key kept for log continuity.
    - numpy smoke (j/smoke37.py on the r36 head cache): upper vermilion albedo 0.072/0.055/0.075 vs philtrum skin
      0.217/0.198/0.229 (pre-gain, x3), rough 0.78; brow band 0.178 vs forehead 0.263 (x0.68); brows 633 strands.
    - Scalp cache aliased hair_v3s3f14b4f89be9 -> hair_v3sa37f016b4490 (brows() is outside the stripped region).
    - Job (r36 staging): `node scripts/assets.mjs --only scare-look --force --job-args="--round 37 --spp 128 --res
      1920x1200 --h 0.6 --dist 0.19 --center -6,-24,-36 --pitch -4 --torch 0.065,-0.04,-0.13 --aim -15,-37,-42 --yaw 15
      --fstop 11 --focus -20,-22,-8 --frame hero"` (launched 12:2x; log scratchpad j/r37.log).
  * **r37 RENDERED** (790 s, peak 2.24 GB, metered EV -11.03 = r36's -11.04: directly comparable; log
    .cache/logs/scare-look-2026-10-19T06-36-51-944Z.log; scratch/jumpscare/look-r37.png). Views: scratchpad
    j/cmp-r36-r37.png (r36 | r37), j/r37-zoom.png (upper lip x2, crescent x1, brow x1.5 +2 EV), and the AS-PLAYED proxy
    **scratch/jumpscare/played-r37.png** (j/played.py: Medium encode 1280x800 CRF 20 -> canvas 1440x900, CA 1 px, vignette
    0.4, ISO-1200 multiplicative grain + the 1.6/255 read-noise proxy). Numbers (j/diff.py, rows x 780-1100):
    - **The lip material change barely moved the frame-scale means:** upper vermilion band (y 750-795) dL -0.2..-3.1
      (L 78-88 -> 77-89), lower lip (y 900-1010) rgb 23/10/10 -> 20/10/9; everything else +-0.5. So r36's "specular
      tube" diagnosis was wrong (corrected above). What r37 DID add is 100 %-scale SURFACE: at x2 the upper lip is now
      a dusky, mottled, cracked, PEELING dead lip with a colour border under the pale skin (r36: a smooth lavender roll);
      the lower lip lost its glossy red (the +2 EV view: dusky purple-brown with flakes). As played the upper lip reads
      as a lavender band with fine pale speckle — the flakes (0.30/0.27/0.27 at 0.6) are ~30 % too white and read a
      little as frost/sugar crust.
    - Ruling-(au) marks (new spots, EV vs the upper-lip spot): crescent scar **+0.52** (in the core; reads at x1 as a
      raised curved ridge with its shadow — but more like a skin FOLD than a scar); brow scar **-4.05** (display 7-15 at
      the gap: FAILS >= 20); brow band (brow_R) **-6.83** (display 2-9). The brow band darkening + thicker hairs made the
      brow darker, but the whole brow zone sits 4-7 EV under the core: **the brows and the brow scar cannot read at frame
      scale with this torch aim — a staging limit**, like the philtrum. (The hair gap 3.8 mm is wider than the 2.6 mm
      scar, so the darkened skin also narrowed the pale gap: 13 -> 7-9 /255, invisible either way.)
    - Eyes unchanged (as planned); no regression in the mouth / eyes (rows outside the lips +-0.5 /255); ONE small
      regression in the brow zone (the scar gap 13 -> 7-9 /255, see the STOPPED note: corrected in-tree, unrendered).
    - **Verdict (147j self-review, harsh): r37 is the BEST STILL, but it still does NOT read as a photograph of a dead
      woman.** As played (1 s, grain, CA, vignette) it reads as a high-end CG / prosthetic-makeup still: the double milky
      stare, the violet-yellow black eye with its swollen bag, the nosebleed into the dry peeling lip, the broken stained
      teeth in a gaping mouth = a hard startle, horrifying for a 1 s flash. On a second look the tells are: (1) the wet
      glints on the forehead/cheeks are short thin lacquer streaks (CG); (2) the central hair strand is a uniform black
      line = a crack in porcelain (AD rank 4, out of this round's top-3 scope); (3) no brows at frame scale (staging);
      (4) the face silhouette is a smooth oval on black; (5) the lip flakes read slightly as frost; (6) the mouth interior
      is a flat dark maroon floor, the gaping oval still recalls a "Scream" mask; (7) the crescent scar reads as a fold.
    - **Not rendered: r38/r39** (budget kept: ruling av-amended = one fix + review loop, then ship the best still; the
      remaining top-3 items are staging limits, not fixable by form/material at this framing).
  * **147j STOPPED here. BEST STILL = look-r37** (scratch/jumpscare/look-r37.png; as played: played-r37.png; metered EV
    **-11.03**). The working tree = **r37 + ONE unrendered correction**: the brow-band darkening now excludes the full
    3.8 mm hair gap (`ss(1.6, 2.2, ds)`, was `1 - scar1` = 2.6 mm: r37 darkened bare skin either side of the scar, the pale
    gap fell 13 -> 7-9 /255 = a small rank-3 regression); it only touches the dark brow zone (display < 20), so frame 0 of
    the sequence matches look-r37.png everywhere else (scare_tex also got comment-only edits after r37). Per ruling (av, amended 07:40) the final render goes
    ahead with it whatever the verdict. Exact first chunk (the risk frames; then 0-2, 3-5 ... 27-29), once the lead has an
    AD review id:
    `node scripts/assets.mjs --only scare-render --force --job-args="--spp 128 --res 1920x1200 --h 0.6 --dist 0.19
    --center -6,-24,-36 --pitch -4 --torch 0.065,-0.04,-0.13 --aim -15,-37,-42 --yaw 15 --fstop 11 --focus -20,-22,-8
    --ev -11.03 --frames 12,16,17 --approved <AD-review-id>"` (scalp cache hair_v3sa37f016b4490 is in place; the head /
    eye / teeth caches rebuild in ~3-5 min on the first chunk).
  * LATER POLISH (ranked, from the r37 100 % + as-played reads; none is a fail under ruling av): (1) the face strands:
    flat clumped ribbons with frayed tips, contact shadow and a warm specular (AD rank 4) — the "porcelain crack" line is
    now the strongest single CG tell as played; (2) the short thin lacquer glints on the forehead / cheeks; (3) staging:
    a torch aim / spill that reaches the brows (the brow band + scar gap are 4-7 EV under the core) and rakes the
    philtrum; (4) lip flakes ~30 % too white (0.30/0.27/0.27 at 0.6 -> ~0.22/0.20/0.20 at 0.45); (5) the mouth floor:
    a flat dark maroon plane — tongue papillae / coat do not read; (6) the crescent reads as a skin fold: add a pale
    flat centre + hairline stitch marks; (7) the smooth oval silhouette (hair breaking the outline, ear / jaw angle);
    (8) the shadow-side caruncle is still a lit bead.
  * Requests for the lead (147j): (a) an AD review id for look-r37 (or the lead's own) so `--approved` can be passed —
    the sequence is the lead's call per ruling (av); (b) sequence spp: 128 (~4.8 h, 3 frames per ~30 min lock hold) vs
    256 (~9.5 h for -13 % boil, 147i); (c) Low stays the in-engine fallback (a Low clip is 130-180 KB, Low has ~10 KB);
    (d) staging ruling for the brows/brow scar (they cannot reach >= 20/255 with the current aim; ruling au's brow-scar
    gate is unmet: 7-15/255); (e) the AD rank-4 hair-strand fix is the best next look round if one is allowed.

- **147l RENDER + ENCODE, final (2026-10-19 12:35).** Ruling (av, amended): render the sequence NOW with the best still
  (look-r37 + 147j's unrendered brow-gap correction) whatever the verdict; the last review is **AD4-r37-20261019 = FAIL as
  a photograph, horrifying as a 1 s jumpscare** (its ranked list is the polish backlog, below when done). Budget: <= 4 h of
  Blender lock in assets.mjs jobs of <= 45 min.
  * Plan: **1600x1000, 96 spp + OIDN, 30 frames at 30 fps, motion blur 180 deg** (r37 measured 2.04 s per spp-MP at
    1920x1200/128 spp + 6 % blur -> ~5.6 min/frame -> ~2.9 h + lurch frames; 1920x1200 at 128 spp = 5.3 h, over budget).
    Staging = r37 EXACTLY (no torch / spill / framing / EV change: the only still the decision was made on is r37 at its
    metered -11.03; a spill change would be a new, unreviewed look). Approval token passed to the guard:
    `--approved ruling-av-amended_AD4-r37-20261019_FAIL` (records the lead's ruling AND that the review failed).
  * Chunks (resume-safe, `.cache/scare/frames/final`): 1 = risk frames 12,16,17 (+ head/eye/teeth cache rebuild for the
    brow-gap change; the scalp + face hair caches hit: keys a37f016b4490 / 151e070ed9eb verified with j/hkey.py), then
    0-5, 6-11, 13-15+18-20, 21-26, 27-29. Args (scratchpad l/args.sh): `--spp 96 --res 1600x1000 --h 0.6 --dist 0.19
    --center -6,-24,-36 --pitch -4 --torch 0.065,-0.04,-0.13 --aim -15,-37,-42 --yaw 15 --fstop 11 --focus -20,-22,-8
    --ev -11.03 --approved ruling-av-amended_AD4-r37-20261019_FAIL --frames <chunk>` on `--only scare-render --force`.
  * Encoder change (`scare_encode.mjs`, lane file): NEVER UPSCALES — each tier = min(tier size, source size) at 16:10
    (`--res max=WxH` overrides), so Max ships the native 1600x1000 (not Lanczos-invented 1920x1200 pixels); the H.264
    level/ref count is computed per size (`levelFor`: level 4.0 if <= 8192 MBs with ref <= 32768/MBs, i.e. 1600x1000 =
    6300 MBs -> ref 5, `avc1.640028`; else 5.0). The runtime must read the codec string from scare_face.json.

## Spec
Coordinates below are Ada's rest-pose PLAN/Blender space (Z-up, she faces −Y, +X = HER LEFT), relative to the SDF
landmarks `fn.face` of `body.anatomy(ada.P, J, ada.S)` (`hc`, `eye_c[0]` her left / `[1]` her right, `nose_t`, `lips`,
`chin`, `cheek[k]`, `brow[k]`, `ear[k]`) and the cleaver plane `sever.cut_plane_pts(J['neck_01'][0], J['head'][0])`
→ (c, n, fwd, side). "Image-left" = her right.

### 0. Gate — no catch before C2 (confirmed in code)
`Story.start()` sends `scripted: hidden` (beats.ts:143) → `AdaBrain.update` treats `hidden` as offstage
(ada-brain.ts:635) → `sense()` never runs; `doCatch` is reachable only from `sense` contact/hide paths, `onHeard`
(noise queue cleared offstage), `tickChase` (chase nulled by `setScripted`→`clearStimuli`) and `hideFound`. C2c re-sends
`hidden` (beats.ts:842); B05 `b05_return` stays offstage until phase `key`. A resumed save keeps `scripted`
(`restore`, ada-brain.ts:1862); `routine`/`escalation` ops never touch it (ada-brain.ts:374-382); debug `startAt` B01–B03
sets `hidden` (director.ts). **No catch can happen in B01–B04.** `onCatch` (beats.ts:721) has no beat guard, so the
jumpscare module also checks flag `ada_severed` and uses the in-engine fallback if it is ever false.
Test `tests/jumpscare-gate.test.ts`: brain in B01–B03, player adjacent 30 s → no `catch`; story start→B05 → no `death`.

### 1. Head build — NEW Cycles-only head from the same anatomy (not the GLB head)
- Files in **`blender/scare/`** (NOT `blender/characters/scare_*.py`: the `characters` and `anims` jobs hash
  `blender/characters/**`, so any new file there forces a 14-min characters rebuild + anims re-export of shipped GLBs).
  `scare_head.py` (SDF variant + mesh + cap + UV), `scare_tex.py` (injury fields), `scare_hair.py` (curves),
  `scare_scene.py` (camera, torch, animation, water), `scare_render.py` (job entry), `scare_encode.mjs` (ffmpeg).
- Shape: `body.anatomy` + `ada.with_wound` landmarks, so she is the in-game woman. Scare-only SDF variant (lane A's
  body.py untouched): **both eyes open** (apply `body.eye_window` to socket 0 too; second globe), jaw open 14 mm at rest
  (rotate the lower face about `J['jaw']` like `ada.jaw_field`, 22°), 2–4 mm asymmetry (left orbit 1.5 mm lower, nose
  tip 1 mm to her right, left cheek fuller) — symmetry is half of the "mask" look.
- Mesh: `mesher.surface_nets` at **h = 0.6 mm** in the box hc−(0.12, 0.14, 0.20) … hc+(0.12, 0.13, 0.13), clipped by
  the cleaver half-space `max(fn, −(X−c)·n)` (measured 79.7 k faces in 21 s at 1.5 mm → ≈ 0.5 M quads, ≈ 3 min at
  0.6 mm; Cycles only, never exported). Cut cap: re-use
  `sever` rim jag (`neck_anatomy.rim_jag` ±2.4 mm, skin tags) and give the cap REAL relief from
  `neck_anatomy.section(head_side=True)` macro (muscle bundles retracted 2–6 mm, trachea lumen 10 mm deep, vertebral
  body 3.5 mm proud) — Cycles can afford the geometry the GLB could not.
- Detail: 4096² UV atlas (albedo, roughness, coat mask, height, SSS-scale mask) evaluated with numpy from
  `tex_ada.skin` + `tex_head.head` + `scare_tex` (texel ≈ 0.1 mm); height → Displacement node, method 'BOTH' only if
  the look round needs it (adaptive subdivision exists in 5.2 on the Subsurf modifier, verified, but costs RAM).
  Pores: procedural Voronoi bump in OBJECT space (cell 0.3 mm, 0.5 mm on nose/cheeks) — resolution-free.
- Pixel scale 0.145 mm/px at 1920×1200 (0.22 at 1280×800; frame height ≈ 0.174 m at the eye): pores are ~1 px.
- Skin BSDF (Blender 5.2 names verified): Principled, `subsurface_method='RANDOM_WALK_SKIN'`, Subsurface Weight 1,
  Radius (0.9, 0.45, 0.3) × Scale **2 mm** (dead, little perfusion; the probe's 3.5 mm read as glowing wax; look round
  1.5–3 mm; bruises (1.0, 0.25, 0.15), scars × 0.5),
  Subsurface Anisotropy 0.8, IOR 1.4, base Roughness 0.5–0.6 (macerated), **Coat** Weight 0.4–1.0 patchy (water film,
  Coat IOR 1.33, Coat Roughness 0.03–0.06, beads/drying patches 1–3 cm), Specular IOR Level 0.5. Albedo keeps the
  in-game palette (pallor 0.31/0.33/0.37 linear, lividity 0.22/0.12/0.17).
- Injuries (exact placement; widths are full widths):
  1. **Manual-strangulation bruises** (Harlan's RIGHT hand from the front → thumb on HER RIGHT, fingers on HER LEFT),
     on the mandible's lower border, the jaw angles and the 25 mm neck band that survives above the cut: thumb pad
     oval 18×24 mm at her right jaw angle (x = −0.045, 12 mm under the jaw line); 4 fingertip ovals 11–14 mm,
     17–20 mm apart on a curve along her left mandible border from x = +0.020 to +0.050; crescent fingernail abrasions
     2–4 mm at the leading edges (raw red-brown 0.20/0.06/0.05, roughness 0.3). Fresh (at death) = purple-black core
     0.07/0.03/0.06 → red-purple rim 0.20/0.06/0.12, 3 mm diffuse edge, mottled subcutaneous texture. Facial
     petechiae above the grip: 0.2–1 mm dots, sparse (≈ 3/cm²) on lids, forehead, cheeks.
  2. **Old bruises** (years of abuse): yellow-green 0.36/0.34/0.14 with a brown fringe 0.24/0.17/0.10 — 30×20 mm on
     her left temple/zygoma, 25 mm on her right jawline overlapping (layered under) the fresh thumb bruise.
  3. **Split, swollen lower lip**: her LEFT half (x = +0.002…+0.016 from `lips`) swollen +3 mm forward, +2 mm thick;
     a vertical laceration 7 mm across the vermilion at x = +0.006, gaping 1.2 mm, clotted red-black 0.06/0.01/0.01
     (wet, roughness 0.15) over mucosa 0.25/0.06/0.07; washerwoman wrinkling stays (tex_head fissures).
  4. **Eyes**: corneas milky, iris-less (grey-white 0.55/0.57/0.58, ghost iris 0.45; tear-film coat roughness 0.02);
     sclera petechiae 40–80 dots 0.1–0.5 mm, densest in the lower bulbar conjunctiva; a subconjunctival haemorrhage
     8 mm blotch (0.35/0.02/0.02) at her right lateral canthus; branching conjunctival vessels 0.05–0.15 mm from both
     canthi; lid margins red-raw; lashes as curves, wet, clumped in 3–5 spikes (upper 8–10 mm, lower 4–6 mm).
  5. **Old scars**: (a) her RIGHT brow: 22 mm × 1.8 mm, oblique from 8 mm above the brow's medial third down-laterally
     to the lid crease, raised 0.3 mm, paler 0.42/0.40/0.42, roughness 0.3, hairless gap in the brow, 4+4 suture
     dots 4 mm apart; (b) her LEFT cheekbone (`cheek[0]`): a crescent, r 15 mm, arc 25 mm, 1 mm wide, depressed 0.2 mm.
  6. **Drowned skin**: tex_ada/tex_head base + post-mortem marbling boosted: branching dark venous network 1–3 mm wide
     (0.05/0.06/0.08) on temples, jaw, neck band and forehead; skin slippage kept; goose-flesh bumps on the neck band.
  7. **Cut neck** (bottom edge only): ragged skin rim, the cap relief above, clotted blood 0.08/0.01/0.01 (roughness
     0.15) pooled in the trachea lumen and along the rim, one torn skin tag, watery blood drips (2–3 drops).
- Hair (`scare_hair.py`, Blender `hair_curves` + Principled Hair `CHIANG`, MELANIN 0.97, Roughness 0.18, Radial 0.25,
  Coat 0.3, Random Roughness 0.1; `cycles_curves.shape='THICK'`): ≈ 60 k scalp strands (2.5 k guides from
  `hair.integrate`, offset 0.3 mm, × 24 children clumped to 1–3 mm at the tips, radius 40→20 µm) — and the
  plastered FACE strands: 40–80 thin clumps (5–30 hairs) across the forehead, half over her LEFT eye, across both cheeks
  and INTO the mouth corner, offset 0.1–0.3 mm. Her RIGHT eye stays clear (the eye contact). Hanging lengths swing below.
- Water: a thin stream (3–6 mm, IOR 1.33, slight grey-green absorption) spilling from her left mouth corner, drips.

### 2. Render
- Camera = the player's eye: 35 mm on a 36 mm gate, 16:10 (vFOV 35.6°); eye ≈ 0.27 m from her right cornea; head
  chin-up 20°, yaw 8°, roll 6° so the cut shows as a sliver at the bottom edge. DOF **f/5.6** focused on her right
  cornea (≈ 20 mm in focus: nose tip barely soft, ears/hair soft; the probe at f/4 read as an all-soft blur), 6
  blades. Motion blur 180° (`motion_blur_shutter` 0.5). `cycles.use_animated_seed=False` (static noise, less boil).
- Torch (the player's 2-D krypton, 2900 K via `light.temperature`): in the right hand at camera +(0.06 right, −0.27
  down, +0.04 fwd), aimed between nose and mouth, torch→face 0.30–0.35 m. Target on-axis E from flashlight.ts'
  near-field model (E = Iσ²/(σ²d² + D²/8), I 2000 cd, σ² 0.0036, D 0.05): **11.3 klx at 0.30 m, 9.6 at 0.35**, HWHM ≈ 4°.
  Rig: core SPOT, spot_size 14.5°, blend 1.0, shadow_soft_size 0.025 (the 5 cm mouth), start energy 1020 cd × 4π ≈
  12.8 kW, then CALIBRATE: an 18 % grey card on-axis at 0.30 m must read 0.18·11300/π ≈ 647 ±10 % in the linear EXR.
  Spill shelf SPOT 7 cd (88 W), 90°, blend 0.5. World black; no fill (the room at 0.01–1 lux is ≥ 13 EV down).
- **Look renders first** (job `scare-look`, manual): stills at 1280×800, 512 spp + OIDN (≈ 4–9 min each) →
  scratch/jumpscare/look-rN.png (AgX preview) + .exr; one 1920×1200 still before the sequence. The AD approves the
  still before any sequence.
- Sequence (job `scare-render`, manual): **1920×1200, 30 fps, 30 frames (1.000 s)**, Cycles GPU (Metal), no adaptive
  sampling, **256 spp** (512 only if the look round shows boil), OIDN (albedo+normal, ACCURATE, GPU), linear half EXR
  (ZIP) → .cache/scare/frames. Medium/Low frames are Lanczos downscales of the same EXRs. **Chunked**:
  `--job-args="--frames 0-5"` … `24-29`, resume-safe (skips existing EXRs), so headless-Chrome QA can run between
  chunks (each chunk holds the Blender lock ≈ 40–70 min). Estimate (Probe): 7–11 min/frame → 3.4–5.6 h total at 256 spp.
- Composition: the quad is cover-fit, so a 16:9 canvas crops ≈ 10 % of the 16:10 height — keep the forehead and the
  cut sliver inside the central 90 % of frame height (a safe band), or the neck crops out on the commonest monitors.
- Motion inside the 1.0 s: f0–4 arrival settle (0.4 m/s → 0, 8 mm overshoot toward the lens and back — robust to a
  held first frame); f4–26 hold with micro-motion: drift yaw 2°/roll 3°, jaw spasm 0.33–0.50 s (14 → 24 → 17 mm),
  right lower-lid twitch 1 mm for 80 ms at 0.62 s, water gush with the spasm, hanging hair swinging (±1.5 cm,
  period 0.8 s, `head-carry` pendulum); f26–29 the head lurches 8 cm into the lens, mouth widening, the jaw shadows the
  torch → the frame goes dark → black. No light flicker anywhere (reducedFlash).

### 3. Playback (three r186, verified in node_modules)
- **One H.264 MP4 per tier** (libx264 High, yuv420p, BT.709 matrix, tv range, keyint 30, `+faststart`, no audio):
  Max 1920×1200, Medium 1280×800, Low 960×600 (only if funded, §5). H.264 because every format shipped counts in the
  tier budget and it decodes everywhere (Chrome/Edge/Safari/Firefox desktop; VP9 is partial in Safari).
- **Log-encoded, scene-referred**: Blender writes linear EXR; numpy maps L → v = (log2(L+L0) − log2 L0) /
  (log2(Lmax+L0) − log2 L0), Lmax = 4 × p99.9 of the look still, L0 = Lmax/2^12 (12 stops, ≈ 18 codes/stop in tv
  range); 8-bit RGB PNG → ffmpeg. Tag the stream bt709/bt709/**iec61966-2-1**/tv. Runtime decode: `texture(videoTex)`
  is already sRGB→linear (WebGPU: `getFormat` → rgba8unorm-srgb, WebGPUTextureUtils.js:1606; per-frame
  `device.queue.copyExternalImageToTexture`, WebGPUTextureUtils.js:985; WebGL2: `texImage2D(video)` WebGLTextureUtils.js:661 + in-shader decode
  GLSLNodeBuilder.js:224), so re-encode with TSL `sRGBTransferOETF` (ColorSpaceFunctions.js:38) to get v, then
  L = L0·(2^(v·R) − 1). The game then meters/exposes/tone-maps (AgX) real radiance; no double tone map.
  **Calibration clip** (same pipeline: 16-step grey + R/G/B ramps) read back through the same quad: ≤ 1.5 codes error,
  else fix the tags/LUT before trusting any look.
- `new THREE.VideoTexture(video)` (Three.Core export; rVFC sets needsUpdate; no mipmaps, Linear filters);
  `colorSpace = SRGBColorSpace` (else Textures.js:396 warns on WebGPU). `<video muted playsInline preload="auto">`.
- Quad: `MeshBasicNodeMaterial` (fog false, depthTest/depthWrite false, transparent false), PlaneGeometry child of the
  camera at z −0.05 (near 0.03), sized to the frustum, UV cover-fit to the canvas aspect (no stretch), renderOrder
  1e6, frustumCulled false. It is drawn INSIDE `pass(scene)` → CA, bloom, exposure, AgX, vignette, grain (and TAAU)
  apply natively. Camera child → zero velocity → no TAAU smear/motion-blur on it. TAAU has no history reset in r186
  (restart only on resize, TAAUNode.js:414) but clips history to the 3×3 variance box (TAAUNode.js:627-640): verify
  the first 5 frames after the cut frame-by-frame (no ghost of the room).
- Exposure: at the cut, existing fx `exposure {fixed: X, snap: true}` (opening.ts:376) — a film camera, the meter
  must not pump on a black frame; X from the look still (match Blender-AgX median face within 0.2 EV in a shot.mjs
  readback; the eyes must read: X may rise until the core clips on the AgX shoulder — the probe's 4° core lit the
  nose/lips and left the sockets ~5 EV down, as a real torch-lit photo would); `{reset: true}` under the black. The "over-exposes, then settles" beat is the module's own gain ramp
  2^+1.0 → 1 over 0.25 s ease-out (reducedFlash: starts at 1).
- Prefetch + warm: on `beat:enter` B05 (or at load when the restored beat ≥ B05) fetch → Blob → objectURL; manifest
  entry kind `data` id `scare_face` (level.ts:248 never downloads `data`, no types change). Prime: `play()`, `pause()`,
  `currentTime = 0`, await `seeked` + one rVFC; `renderer.compileAsync` (Renderer.js:896) with the quad visible +
  `renderer.initTexture(tex)` (Renderer.js:3083) — in the PERF lane's warm-up list (main.ts, surgical).
- Timing: the module, not the cutscene clock, owns the end: it shows frame 0 at the cut, plays, and outputs BLACK once
  `mediaTime ≥ 0.98 s` or `ended`; the timeline's DOM fade at 1.40 s is only a backstop for a late `play()`.
- Memory: video pipeline a few NV12 surfaces + one RGBA8 texture (9.2 MB at 1920×1200, 4.1 MB at 1280×800) + the
  Blob (≤ 3 MB). Rejected: image sequence / array texture = 30 × 4 MB = 123 MB GPU at 1280×800 (276 MB at Max).
- Fallback (in-engine): no file for the tier, `canPlayType('video/mp4; codecs="avc1.640028"') === ''`, fetch/decode
  error, or `ada_severed` false → the real `ada_head_rig` in head-carry `free` mode 0.28 m before the lens, chin-up
  20°, torch-lit, `jaw_open` 0.25→0.6→0.4, `eyelid_l_open` 1, same timeline + sting. Honest: that IS the "plaster
  mask"; only motion blur and 0.9 s on screen hide it.

### 4. Timeline (`src/cutscenes/death.ts`; DEATH_DURATION = 3, lock full, `skippable: false`, respawn untouched)
| t (s) | cue |
|---|---|
| 0.00 | lock full; Ada visible; clip `ada_catch`; heartbeat 0; `sfx scare_whoosh` (plain: the 0.15 s pre-swell) |
| 0.00–0.15 | lunge, in-engine: shot 1 shortened to 0.15 s, Ada → 0.45 m (ease `in`), handheld 3 |
| 0.15 | `sfx scare_sting {sched: true}` (transient at buffer 0); `fx jumpscare {on: true}` (hard cut; reducedFlash: 2-frame ramp); `fx exposure {fixed: X, snap: true}`; arms hidden |
| 0.15–1.15 | the video (module-timed, black after its last frame) |
| 1.38 → 1.40 | fade 0 → 1 (backstop black; never two keys at one t — sampleKeys lerps) |
| 1.45 | `fx jumpscare {on: false}`; `fx exposure {reset: true}`; Ada invisible |
| 1.50 | `sfx drowning_rush` (the water closing, under black) |
| 3.00 | arms visible; `release ada` |
Sync (verified host.ts:345-357): `scheduleAhead` runs right after `seq.update(0)` and hands every `sched` sfx with
0 < t ≤ now + 0.15 s to the audio clock with `delay = t − now`, so the 0.15 s hit is clock-scheduled at start and lands
on the cut frame; a t = 0 `sched` cue is NOT scheduled (t ≤ now) — it plays plain. This is the most important sync.
Dropped: `lens_wet_hand`, `eye_glint`, the hair-filling-the-frame beat, `grab_hit` (folded into the sting).
reducedFlash: dark → face → black is ≤ 2 transitions in 1.25 s (< 3 Hz); no strobe in the video; no gain overshoot.

### 5. Budgets and the Low decision (sizes: see Probe)
- Medium: the 1280×800 MP4 fits in its 6.0 MB headroom. Max: the 1920×1200 MP4 fits in 42.7 MB.
- Low (10 KB left): **request for the lead** — Low's 5 character normal maps as **lossless WebP** instead of PNG:
  measured −364 KB (harlan 285.9→145.6 KB, ada 216.8→123.3, arms 202.5→114.4, ada_hair 91.6→67.2,
  ada_head 39.8→21.9), **bit-identical decode** (ffmpeg rgb24 hashes equal for harlan/ada). Touches lane A
  (`texbake.save_tiers` ext_normal per tier), lane B (`src/characters/loader.ts` normal path) and check_chars. If
  approved, Low gets the 960×600 clip (≤ 300 KB) within the freed bytes; if not, Low uses the in-engine fallback.

### 6. Sting (`src/audio/synth/scare.ts`, `SCARE_RECIPES` appended in `synth/index.ts`)
`scare_sting`: category `player`, bus `player`, stereo, 3 variants, `level` 0.891 (MAX_PEAK, −1 dBFS), `playGain` 1.6,
`hdr` 10, `hdrHold` 1.0, `preload: false` (worker-rendered and warmed after load — verify warm before B05). Buffer
2.05 s, the hit at 0: + `scare_whoosh` (0.15 s, reversed pink noise band 600–2000 Hz, +18 dB rise, ends abruptly);
transient (3 ms attack, 30 ms decay, white noise HP 600 Hz + 2 kHz damped click); shriek 0–1.0 s (band-limited
saws at 740/1047/1109/1568 Hz — tritone + minor 2nd — through scream formants 800/1150/2900 Hz, +2.5 st glide over
0.6 s, ragged 6–11 Hz ±40 ct vibrato, tanh drive 2.5, −6 dB re the hit, ±7 ct L/R, 30 ms fade at 1.0 = the cut to
black); low hit (sine 55 → 28 Hz over 0.5 s + 110 Hz thump 80 ms, τ 0.35 s, tanh 1.5 for laptop speakers, rings to
≈ 1.65 s); a wet gurgle burst 0.30–0.60 s at −14 dB (the jaw spasm). It layers WITH the brain's `ai:catch` voice (ada_catch +
drv_death), not instead. Targets: buffer peak ≤ 0.891, no run of > 2 samples at ≥ 0.89, |DC| < 0.002; at the master
limiter (−3 dBFS, ratio 20, 2 ms attack) ≤ 3 dB gain reduction and ≤ −1 dBTP; momentary (EBU R128 M, 400 ms) max
**−10 ±1 LUFS** in its first 0.4 s (≈ 3.7 LU over the C2 strike's −13.7 measured in #132: the loudest moment of the game);
short-term (3 s) ≈ −15 LUFS. Tested in `tests/jumpscare-audio.test.ts` (BS.1770 K-weighting in TS, relative to
`cleaver_sever` rendered the same way) + an ffmpeg `ebur128` cross-check like `scripts/qa/c2-listen-post.mjs`.

### 7. File plan
Lane-owned new: `blender/scare/*` (above); `blender/pipeline.json` jobs `scare-look` + `scare-render` (manual, group
`scare`; outputs `public/assets/{max,medium[,low]}/scare_face.mp4` kind `data` id `scare_face`; inputs
`blender/scare/**` + the imported `blender/characters/{body,sdf,mesher,hair,tex_ada,tex_head,neck_anatomy,sever,
skeleton,ada}.py`; post `node blender/scare/scare_encode.mjs`) — "scare entries in scripts/assets.mjs" = these
pipeline.json jobs; `src/world/jumpscare.ts`; `src/cutscenes/death.ts`; `src/audio/synth/scare.ts` (`scare_whoosh`, `scare_sting`) + its
index line;
tests `jumpscare-gate`, `jumpscare-timeline` (cue set, DEATH_DURATION 3, black by 1.40, ≤ 3 Hz transitions under
reducedFlash), `jumpscare-decode` (TS mirror of the log curve: round trip ≤ 0.05 EV over 12 stops), `jumpscare-audio`.
Surgical, re-read first and log: `src/game/story-runtime.ts` (route fx `jumpscare`, B05 prefetch on `beat:enter`),
`src/game/main.ts` warm-up step (PERF lane), `docs/CUTSCENES.md` fx table (`jumpscare {on}`).

### 8. Risks (biggest first)
1. **Still a mask** — the SDF face is ellipsoids/capsules never designed for 0.27 m: needs sculpt-level folds (lids,
   tear trough, nasolabial, lip tubercles, nostril rims), asymmetry, SSS, broken wet sheen, hair over it. The AD gate
   on the still is the real test; never render the sequence on a "nearly".
2. OIDN boil between frames (hair/skin) → static seed, 512 spp if |Δ| between frames shows it. 3. Video colour path
   (tags, Chrome's video→texture conversion) → the calibration clip first. 4. `play()` latency → settle frames, module-
   owned end. 5. TAAU ghost / meter pumping / HUD-subtitle overlays over the quad → frame-by-frame check. 6. RAM 2.5–4 GB
   in Cycles → assets.mjs lock only. 7. Low = fallback unless the WebP swap is approved.

### Probe (2026-10-12; scratchpad script under the assets.mjs lock protocol, no Chrome running; nothing shipped)
Ada's SDF head at 1.5 mm (79.7 k faces, 19.7 s), tex_ada+tex_head vertex colours, RANDOM_WALK_SKIN SSS, 16.8 k THICK
Chiang curves × 24 pts, 2 eyes, DOF f/4, motion blur 0.5, OIDN GPU, torch rig of §2 (Metal, M1, peak RSS 1.47 GB):
| render | time |
|---|---|
| 1280×800, 16 / 128 / 512 spp | 10.3 (incl. first-frame setup) / 56.8 / 228.3 s → **0.45 s per spp·MP** |
| 1920×1200, 128 spp | 139.2 s (0.47 s per spp·MP) |
Probe-scene cost at Max 1920×1200: 4.5 min/frame at 256 spp. Final scene ≈ 1.5–2.5× the probe (6× faces, 3.5×
strands, lashes, water) → **≈ 7–11 min/frame at 256 spp, 13–23 at 512**; 30 frames ≈ 3.4–5.6 h (256) / 7–11 h
(512). Expect peak RSS 2.5–4 GB → never next to Chrome.
Light-unit check: the probe's lit face p99.9 = 913 (scene units), predicted 0.3·2000/0.40²/π ≈ 1190 for ρ 0.3 at
normal incidence → Blender W/(4π) = cd holds (within the albedo/incidence spread); still do the grey-card calibration.
Luminance of the lit pixels: p50 0.41, p75 7.95, p95 143, p99 500, p99.9 913, max 1956 → encode window
Lmax = 3650, L0 = 0.89 (12 stops): everything below L0 is ≥ 10 EV under the face core = black at the scene exposure.
Encode PROXY (log-encoded probe frame, 30 frames of synthetic drift/zoom, §3 settings, preset veryslow, aq-mode 3): Max
1920×1200 CRF16 126 KB / CRF18 96 KB; Medium 1280×800 CRF18 50 KB / CRF20 40 KB; Low 960×600 CRF20 27 KB / CRF23
20 KB; 640×400 CRF20 16 KB. The probe frame is soft and mostly black, so real frames (pores, moving strands, water)
will be several times larger — **caps: Max ≤ 3 MB, Medium ≤ 1.5 MB, Low ≤ 330 KB** (all fit: Max 42.7 MB, Medium
6.0 MB free; Low only after the WebP swap frees 364 KB). Honest look note: the probe (old SDF face, crude straight hair
curtain, 3.5 mm SSS, f/4) reads as a glowing wax face behind a hair curtain — exactly the failure to beat.
