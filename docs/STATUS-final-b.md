# STATUS — FINAL-B (bake-review fixer, runtime lane B)

Started 2026-10-20 (session start). Scratch: scratch/final-b/. Contract rows #154, 154b …
Items (from final:bake-review R1 / final:bake-review-2 R2): (1) R1-1 hide x15 lift on the exit frame; (2) R1-2 cobweb
cards → alpha decal; (3) R1-3 L_LAMP_U2 flicker light through the wall; (4) R2-2 U3 window brass glow; (5) R1-4 hide
slats warm; (6) R1-5 C4a dress-edge specks; (7) LAST: probes re-export (all tiers) + manifest + check.

## Log
- start: read journal results + docs/STATUS-final-bake.md.
- before dist: scratch/dist-fb-before = vite build of the tree at session start (other lanes' WIP included). Diag
  scenario scratch/final-b/diag.mjs (pinned clock/storm/exposure e 24, Ada frozen; numeric per-region stats: brass,
  dress, slats, cobweb rects + variants refl0 / grid0 / flick0). Run 'bmed' (Medium, B08) queued behind the FINAL
  builder's chrome lock.
- before numbers (bmed, Medium, e 24, scratch/final-b/logs/bmed.log; stills scratch/final-b/stills/bmed-*): wexit-0 16.39,
  wexit-1 16.39 (TWO lifted frames), wexit-2 1.55, wexit-8 1.04 · hide/base rgb 4.1/1.0/1.2 (red-brown slats) vs
  hide/refl0 0.2/0.5/1.0 → R1-4 is the U3 REFLECTION cube, not the probe grid · u3-win brass orange px base 32 /
  refl0 21 / grid0 26 / flick0 18 (none kills it) · c4a-10 baseline INVALID (C4a ended at once: 'at null@0.00').
- (restart 02:51) code already in the tree from the first session, now wired + finished:
  - R1-1 bindings.ts + c4-hem.ts: `player:hide` listener ends the lift synchronously on the exit (m2.update →
    pushThrough → hides.exit() → listener → GRADE.lm = 1, before fxw.update copies it, same frame) + hem.setHidden.
  - R1-2 decals.ts: `cobweb` decal case → cobwebMaterial (drawn alpha thread canvas, transparent, depthWrite false,
    alphaTest 0.02, side + lightsNode carried, castShadow false).
  - R1-3 lights.ts: ClippedPointLight / ClippedPointLightNode (light × smooth world-box mask of its room: 3 cm past a
    shared wall, 45 cm past an outside wall, floor below only under a ≥ 1 m² hole = U1 stairwell, not U2's grate);
    every bake_flicker light except the cube-shadowed lamp; main.ts registerClippedLights(renderer) before loadLevel.
    Known limit: characters (char-lights PointPoolNode) evaluate pooled point lights themselves → unclipped.
  - R1-4 main.ts: U3 reflection probe uIntensity 0 while hidden in H_ADA_WARDROBE (player:hide), 1 on exit.
- 03:10–03:40 runs amed/amed2 (Medium, dist scratch/dist-fb, e 24; logs scratch/final-b/logs/amed*.log):
  - R1-1 VERIFIED: wexit-0/1/2/8 = 0.16 / 0.16 / 0.15 / 0.14 (before 16.39 / 16.39 / 1.55 / 1.04), room U4T. No lifted frame.
  - R1-2: the 3 '-sheets' meshes now carry decal_cobweb (transparent); first texture read as cotton-wool blobs →
    redrawn as a felt of short crossing fibres + sagging chords (amed2-07-u4t-back-base.jpg: reads as cobweb tangles).
  - R1-3 VERIFIED: u3-sw2 24.96 → 0.62, u3-se2 27.39 → 0.74 (amber → moonlit blue) with lampU2 still 4.8–5.2 cd.
    u2-lamp 19.89 → 15.64 needs a same-build A/B (clip0 QA uniform added: `__game.level.lights.clipOn`).
  - R1-4 diagnosis CORRECTED: bmed's 'refl0 kills the red' was an artefact — the variant UNDO reset every grid to
    intensity 1, i.e. it removed the hide lift. The red-brown slats are the ×15-lifted probe grid on the probe-lit door
    leaves (hide/base rgb 9.0/1.7/1.4). Reflection-dim code removed again. New fix: src/world/hide-dim.ts (wardrobe's
    probe-lit materials cloned with colour × uHideDim; bindings.ts holds uHideDim = 1/GRADE.lm while hidden there).
  - R1-5: C4a now plays (c4a first, noclip off): specks reproduced at @10.03 (amed2-01-c4a-10-base.jpg); lightsOff
    (grids + reflections off) does NOT remove them → not a lighting term. Next: still (TAAU) / bgOff A/B.
  - R2-2: brassOff → orange 0 (it IS the brass); no single term (refl/grid/flicker) removes it; all off does.
- 03:50–04:10 runs amed3/amed4 (same build, same-frame A/Bs):
  - R1-3 same-build A/B (`clipOn` 1 vs 0): u3-sw2 0.64 vs 19.44 (amber leak gone); u2-lamp 26.61 vs 26.50 (U2's own
    light unchanged — the earlier 19.89 → 15.64 was a cross-build difference, not the clip).
  - R1-4 VERIFIED: hide/base 0.39, rgb 0.1/0.4/1.0 (before 1.69 4.1/1.0/1.2; amed2 lifted 3.2 9.0/1.7/1.4). Slats now
    near-black silhouettes with a cool edge; the moonlit room still reads through the gaps (amed3-04-hide-base.jpg).
  - R1-5: the specks sit at IDENTICAL pixels with the stroke's roaming cube-shadow light off, with its shadow off,
    normalBias 0.02/0.05, lightning spots off, reflections off, grids off, and with only the dress drawn (bgOff:
    brighter than the plain background, so not cracks) → not a light/shadow/TAAU-motion term. Testing the dress
    material itself (sheen / reflection hook / plain standard) next.
- 04:10–04:25 runs amed5/amed6 (C4a@10.03 material / geometry A/B; u3-win brass, 3 captures averaged):
  - R1-5 SOURCE FOUND: the specks are the DUST SHEET on the dress form (P_DRESS 'dress_dummysheet', dust_sheet,
    DoubleSide): sheet hidden → 129 → 6 specks/frame. Its material swapped for a plain MeshStandardNodeMaterial keeps
    them (174) → shading normals, not the BRDF (the satin swaps — no sheen / no reflection hook / plain — keep them
    too: the satin is not the silhouette). Fix: src/world/silhouette-normals.ts (view-space normal bent back toward
    the viewer until n·v ≥ 0.08, QA uniform `__game.level.silClamp`), applied to 'dust_sheet' from main.ts.
  - METHOD CAVEAT: NOADV variants (state switched, captured within 1–3 frames) are contaminated by TAAU history, so
    the amed4 'roamOff / shOff / normalBias' "identical specks" result is NOT evidence; settle ≥ 30 frames for A/Bs.
  - R2-2 (u3-win brass, warm metric, display space so not additive): all on 0.745 (33 orange px) · reflection-only
    0.36 (12 px, partly TAAU history) · grid-only 0.19 (0) · flicker-only 0.17 (0) · all off 0.165 (0 = the sky behind).
    No single wrong source (no flicker light reaches it: every flicker except the landing candle is at 0 and that one
    is clipped to U1). The orange is the room's own light (U3 cube + grid) on brass_tarnished's very saturated metal
    F0 (avgAlbedo 0.42 / 0.30 / 0.12) at e 24. NOT FIXED in runtime — needs a lead/lane-A call (see requests).
- npm test (04:15, mid-session tree): 371 pass, 0 fail.
- 04:30–04:55 runs amed7–amed9 (C4a@10.03, settled 30 frames):
  - the view-space normal clamp did NOT remove the specks (settled 235 on vs 157 off) → replaced.
  - sharpening off 229 (= settled base 230), CA off 173, shadow normalBias 0.015 / 0.05: 161 / 117 (and the frame
    brightens) → none is the cause. Stroke light out of range (distance 0.01): 37 specks, hi200 413 → 9.
  - ⇒ R1-5 cause: the stroke (ShadowRoam 'u3_window', 1029 cd, 1.6 m behind the form) lights the faces of the dust
    sheet that turn toward it right at the silhouette — a real back-lit rim, but sub-pixel at the scene pass's
    resolution, rasterised as isolated slivers and held as dots by TAAU's thin-feature lock.
  - fix now: src/world/silhouette-normals.ts fades the dust_sheet albedo + sheen colour by smoothstep(0, 0.15,
    |n_geom·v|) (≈ the last 8.6° before the silhouette), QA uniform `__game.level.silClamp`. Run amed10 = A/B.
- 05:00–05:25 runs amed10–12: R1-5 NOT FIXED. The grazing fade (albedo + sheen + the GGX lobe on dust_sheet) has no
  effect (settled on 215 / off 211 / on 164 = drift). Specks need BOTH the dust sheet on P_DRESS and the u3_window
  stroke; they ignore the sheet's material (plain standard), normals, grazing fade, sharpen, CA, stroke shadow
  bias −0.008 / normalBias, and the sheet's shadow casting (castShadow off: 297, frame ×2.2 brighter). Consistent
  with sub-pixel gaps along the sheet's silhouette through which the stroke-lit dress / form inside shows (bgOff:
  brighter than the background). The fade code is reverted (scratch/final-b/silhouette-normals.ts.reverted).
- 05:30–05:50 ITEM 7 probes: `npm run probes` (scratch/dist-probes, current tree incl. this lane's code) wrote
  low 115bdd593a95176c, medium 96e401ac3f807be6, max 1284d7bfe4e57cfe (= R2's "want" keys for Medium / Max);
  `assets --manifest` (low 26.96 / medium 51.46 / max 102.83 MB), `assets --check` ok. Inputs unchanged since:
  level-layout.json 00:04:43, material-spec.json Oct 12. (If another lane edits either again, re-run.)
- 05:50–06:10 Max verification (amax, fresh build incl. the new probes; battery → correctness only, no fps claims):
  probesMs 9, no stale log, 0 console errors / warnings / exceptions. wexit-0/1/2/8 0.14 / 0.13 / 0.12 / 0.08 (R1/R2
  Max 13.9 → 0.9). hide 0.39 rgb 0.1/0.4/1.0 (R2 Max 2.33–2.42 red-brown). u3-sw2 same frame clip on 0.59 vs off 23.87.
  u4t-back-dark 0.03. C4a@10.03 6.2 at e 24 (see #154b: the current code's probe bake). Medium check (medchk):
  probesMs 8, no stale log, 0 errors / warnings. Final `npm run typecheck` ok, `npm test` 371 pass / 0 fail.

## Result (FINAL-B)
| item | status | before → after (e 24) | stills |
|---|---|---|---|
| R1-1 exit-frame lift | done | Medium wexit-0/1 16.39/16.39 → 0.16/0.16; Max → 0.14/0.13 | amed-04/05, amax-02/03 |
| R1-2 cobweb cards | done | opaque light-blue cards → alpha fibre/thread decal; dark view 1.38 → 0.08 | amed2-07 (blown e), amed10-05 (real e) |
| R1-3 LAMP_U2 through wall | done | same-frame clip on/off: Medium 0.64/19.44, Max 0.59/23.87; U2 itself 26.61/26.50 | amed3-07, amax-05 |
| R2-2 U3 window brass | NOT done | room's own light on a too-saturated brass F0; no runtime leak (see log) | crop-u3win-lock-after1.jpg |
| R1-4 hide slats | done | 1.69 rgb 4.1/1.0/1.2 → 0.39 rgb 0.1/0.4/1.0 (Max same) | bmed-03 → amed3-04, amax-04 |
| R1-5 C4a dress specks | NOT done | cause narrowed (sheet + stroke); fade reverted | sbs-c4a-edge-base-bgoff.jpg, sbs-amed4-* |
| 7 probes | done | stale (12–29 s bake per load) → shipped, 8–9 ms | — |
What still looks wrong: the C4a specks (both tiers); the same dotted-edge class shows on Max in u3-sw2 (upper-left
diagonal); the U3 window brass reads as a small orange bar; characters still take unclipped flicker light.
- 06:15 WebGL2 fallback (glchk, Medium B08, forced webgl): loads with the clipped light node, probesMs 6, 0 console
  errors / warnings / exceptions. Death-from-the-hide: death.ts has no lmScale cue, so GRADE.lm stays lifted during
  it and uHideDim = 1/GRADE.lm stays consistent; the teleport's hides.exit() resets both. NOT run: the playthrough bot
  and `npm run build` (verify-boot) on the final tree — the lead must before shipping. All runs on battery (no fps).
