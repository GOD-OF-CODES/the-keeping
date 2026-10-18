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
