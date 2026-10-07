# Integration — the playable game (M1 B01–B05 verified in Chrome; M2 B06–B13 wired, see the M2 section)

How the lanes are wired into one game. Entry: `src/game/main.ts` → `startLevel()` → `src/game/story-runtime.ts`.

## Per-frame order (level scene)

```
input → hides.update → player.update → story triggers (enter-only `interact {id, action}`)
      → story.update:  director.update(dt)  (brain + beats → host calls, host.ada(out))
                       cutscenes.update(dt, {skip, E, breath}) + hem overlay
                       pre-C2 tableau / Harlan in the parlor
                       ada.update · harlan.update · arms.update (moves the SpotLight to the lens)
      → world (culling, weather bed, doors, runtime lights, rig) → interactables → audio → render
```

`createLightning` (main.ts) is attached to the story runtime after the pipeline exists (`attachLightning`) —
the Director starts on that call (`?beat=` debug starts included), so the first `storm` command reaches it.

## Director host (story-runtime.ts)

| Host | Implementation |
|---|---|
| `player()` | feet/eye PLAN, `level.room`, crouch, `player.running` / `player.speed` (new getters), hide id, breath, beam (lens world pos → target dir, one collision ray for `hit`), `locketRaised` = RMB (`Mouse2`, new in `core/input.ts`) held with the locket, or forced after a finale respawn until RMB is used. |
| `doorState` | locked if `door.lock`, open if \|angle\| > 10°. |
| `lineOfSight` | `WorldCollision.sightDistance` = static octree ray + door-leaf boxes (new). |
| `playerCanSee(p)` | camera frustum contains p+1.4 m or p+0.8 m AND sight line from the eye; false while the death fade is black. |
| `pushDoor` / `door` | `doors.open(id, fast, force)` / rope open/close / lock. |
| `playCutscene` | `src/cutscenes/bindings.ts createCutsceneSystem(...)` → `cs.player.playCutscene` (falls back to the Director's timeouts if the module fails). |
| `voice(trigger)` | `linesForTrigger` → `VoicePlayer.play` (Ada's lines positional at her head, Harlan's at his sack). Subtitle-only until `public/assets/voice/index.json` exists. |
| `sfx` | bank one-shots (PLAN → WORLD); `spring_bell_loop` loops positionally at the parlor bell until `bell_nonstop` clears. |
| `lightning` / `storm` | `lightning.strike()` / `setStorm(interval, rumble)` (cutscene `stormAuto` pauses/restores it). |
| `hint` | lightning + a 1.4 s `Box3Helper` around the prop / door / board. |
| `document` | journal + a reading overlay drawn with the stroke font (E / Esc / click / a movement-key press closes it). While any overlay (journal, page, pause) is open, `Input` blockers swallow movement, look and keys; overlays read their own keys through `uiPressed`. |
| `teleport`, `removeItem`, `setPropVisible`, `raiseLocket`, `end` | as named; `end` fades to a title card. |
| `ada(out)` | `AdaCharacter.apply` + her audio: drip (start/position/rate/stop), bone crack, gurgle, scrape/nails loops (positional), wet footfalls by distance; flashlight tremble by distance. |

## Contract fixes made here

- Thunder: every flash emits `thunder { delayMs 1500, durationMs 2500 × rumbleScale }` (the AI mask = the audio roll).
  Auto strikes follow the story's cadence (35 s / 28 s / 12 s ±8 %, 0 = over), not a random 25–50 s timer.
- Footstep noise: walk = surface value (runner 2, bare 4 …), crouch ≤ 1.5 m, **run 10 m on every surface**, creaker
  7 m, gasp 3 m (forced 5), fast door 8 m. The world's board pry no longer emits its own 8 m noise (the story's 14 m
  screech honours the thunder mask).
- Documents: `interactables.ts` placeholder texts are gone; reads only emit `interact` (+ paper sound) and the story's
  `DOCUMENTS` arrive through `host.document`.
- `Director.startAt`: B01–B03 keep her offstage; B04/B05 start the scripted chase (as C2's end would).

## Characters (src/characters)

- `loader.ts` — GLB + atlas textures (`createImageBitmap`, premultiply off, flipY false), white colour × albedo,
  roughness = albedo alpha, hair alpha-hash (alpha-test on Low), metalness by spec id, `void` unlit black,
  `lightsNode = level.probeLightsNode`, skinned meshes never frustum-culled.
- `ada.ts` — AdaAnim → clip (`adaClipFor`), crossfades, stop-motion sampling 8–12 fps with random holds while the root
  glides, LOOK driven by segment (wind-up scaled to the brain's wind-up), head turns toward `lookYaw` when lifted,
  neck spring from root acceleration, 8 hair + 8 gown verlet chains (gown vs thigh/calf capsules), jaw/gurgle morphs.
  `override()` / `release()` for the tableau and cutscenes.
- `harlan.ts` — clip or static pose at a world pose, sack/apron chains, `setCleaver`.
- `arms.ts` — under the lagging flashlight rig; the SpotLight, its target and the Max beam follow `flashlight_beam`
  (axis found from the idle pose). One-shots: knock, bell pull, rattle, hide push, freeze, toggle (the light switches
  at 0.2 s with the click); breath-hold loop while Space is held.
- `bank.ts` — `CharacterBank`, the cutscene lane's `CharacterDirector`.
- Not done: CCDIK hand on the banister (the stairs clips key the banister hand), M2 clips (see CHARACTERS.md).

## World / render additions

- `src/render/handwriting.ts` — our own single-stroke font (A–Z, a–z, 0–9, punctuation) with pencil / ink / brush /
  stencil / chalk / print pens, paper / painted board / tin surfaces, page + guest-book layouts (tested:
  `tests/handwriting.test.ts`).
- `src/world/decals.ts` — every prop decal (`userData.decal`) drawn at load: STROUD'S GAS & FEED with GAS painted out,
  ROOMS (hand-lettered), VACANCY (stencil), plates, NEXT SERVICES 48 MI, price dial, chalked cans, guest-book pages,
  the letter, the ticket, the photos (knifed faces). `setGuestBookState(root, 'sting')` for C7.
- `level.runtimeLight(id)` — L_HEADLIGHT_L/R (on the gate sedan) and L_DASH, created dark at load, in the probe and
  exterior LightsNodes; the sedans keep live matrices for the `vehicle` track.
- Moonlight: constant `MOONLIGHT` on the lightning directional; `SKY_COLOR` doubled (the exterior probes see it).
- Flashlight: 30 cd, penumbra 0.8, gaussian hot spot + spill that ends before the cone edge; eye adaptation lowers
  the intensity (to 0.28×) when the centre or ring rays hit within ~1.8 m.
- C2's candle shadow variant is compiled during the room warm-up.

## Debug (`?debug` → `window.__game`)

`?beat=B02…B13` starts at a beat (B05 = the B04 chase with you already in the armoire). New handles: `director`,
`brain`, `story`, `beat()`, `storyState()`, `ada`, `harlan`, `arms`, `characters`, `cutscenes`, `voice`,
`capture(w)` (JPEG data URL rendered through the pipeline into a render target — works in hidden tabs). The FPS
overlay's third line shows the beat, cutscene and Ada's state/anim/room.

## Cutscenes (src/cutscenes — wired)

`createStoryRuntime` builds `createCutsceneSystem({ ctx, camera, level, player, rig, audio, characters, pipeline, sayTrigger,
canvas, hooks })` and plugs `cs.player.playCutscene` into the Director. Per frame after `director.update`:
`cs.update(dt, { skip: Space/Enter, E held/pressed, breath })` + `cs.hem.update(lastAdaOutput, hideId)`; interactions
only while `cs.lock === 'none'`. Hooks: `lightning`, `stormAuto` (pauses/restores the story cadence), `runtimeLight`
(`level.runtimeLight`), `dressing('sting')` (guest-book decals redrawn), `fx` — only `blue_hour` (sky tint) is
implemented; the others (`windshield_rain`, `wipers`, `dash`, `taillights`, `rope_run`, `silhouette`, `car_trim`,
`fuel`, `can_in_hand`, `wardrobe_back_give`, `eye_glint`) are logged once and ignored. `?scene=cutscene&id=C2`
preview hook is in `startGame`. The death handler no longer fades itself when the cutaway runs (it holds black
after 2.2 s until the respawn fade-in).

## Verified in Chrome (Medium, WebGPU, `npm run dev -- --port 5182`)

The Chrome window was occluded/hidden for the whole session (`document.visibilityState === 'hidden'`), so rAF never
ran: flows were stepped with `__game.advance()` and images taken with `__game.capture()`; FPS is the fenced GPU
throughput from `__game.gpuFrameMs(120)` (dynamic resolution at scale 0.75), not the overlay.

| Where | GPU frame (ms) | ≈ fps |
|---|---|---|
| G1 hall (CP2) | 9.6 | 104 |
| U1 upper hall, looking north along the balustrade | 14.9 | 67 |
| U1 upper hall, looking south | 10.8 | 92 |

Played: B02 knock → bell → the front door swings open on the rope (2.6 s + slow counterweight swing) → hall (B03)
→ threshold → C2 (21.6 s, real cutscene) → B04 chase (she stays 2–3 m behind up the stairs) → armoire → B05 hide
demo (approach, LISTEN, LOOK wind-up/hold at 0.75 m, leaves) → vigil scrape → out → D_HARLAN → B06 / CP3. Death →
cutaway → respawn at CP3 with grace works.

## Follow-ups after the Blender quality pass (done)

- Calibration: the 8 new specs (`trousers_wool`, `twine_jute`, `steel_cleaver`, `coat_rain_dark`, `steel_flashlight`,
  `lens_flashlight`, `eye_ada`, `wick_cotton`) measured in `?scene=matlab` and added to
  `src/materials/library/calibration.ts`; the spec-count test expects 68.
- Gravity direction: `bind.ts` samples `wallpaper` / `plaster` / `wood_painted` / `glass` at 1 − v (and the
  normal's green flipped) so rising damp, low scuffs, the tally's top limit and rain streaks are the right way up on
  walls (glTF writes 1 − v). Clapboard is pre-flipped in Blender and untouched.
- Terrain: runtime ground cells are clipped against `EXT2_terrain`'s `terrainRect` (`subtractRect` in level.ts); the
  flat cells remain outside as the far field; the flat ground collider stays.
- Harlan's `harlan_cleaver_handle` rides the `cleaver` bone (`setCleaver` scales the bone, hiding both meshes);
  metalness: `steel_cleaver` / `steel_flashlight` 1, `rust` 0.25.
- `arms_flashlight_lens` (`lens` + `emissive`) glows with the torch (`LoadedCharacter.lensGlow`, driven by the rig's
  on/intensity). The arms do not receive the flashlight itself (it sits inside the head).
- Lightmapped props render through the same `lmFor` path (verified visually in G1/G2/U1).

## Open issues / asks

**Blender lane**
- Clapboard: the facade is a flat wall with a peeling-paint texture; there are no lapped boards (no shadow line
  under each course), so up close it reads as streaky plaster. Needs real lap geometry (or a much stronger height/normal
  step per course + AO in the bake).
- Armoire louvres (H_ARMOIRE): the slats are closed/opaque — from the hide eye you only see her through the seam
  between the doors. Angle the louvres open (gaps ~1–2 cm) so the slat look reads.
- P_RUBBER_SHEET: the mesh is built draped from the floor (0.28–0.81 m) but the layout places it at table-top height
  (z 1.4), so it floated 0.8 m above the sawbuck. Runtime workaround in `level.ts` (placed at the floor); fix the
  generator or the layout z.
- P_SAWBUCK is 0.8 m wide; Ada's `ada_table`/`ada_opening` assume 0.6 m (−0.03…−0.63), so her head hangs inside the
  table instead of over the far edge. Narrow the table or widen the clip's reach.
- D_PARLOR `initial: ajar` (20°) hides the whole candlelit tableau and blocks C2's threshold lens; the runtime opens
  it to 70° before C2 (story-runtime `start`). Consider `initialAngleDeg` ≈ 70 in the layout/doors.glb.
- P_KNOCKER is a separate prop at the door's closed position: it hung in mid-air when the door swung open. Runtime
  now attaches it to the D_FRONT leaf; bake it into the leaf (or tag it `mount: door`).

**Other**
- C2 reads very dark at the threshold lens: the parlor is one candle's lightmap + a 22 % flicker share, Harlan/Ada
  are probe-lit only, so the double look is a pair of silhouettes. The cutscene lane could raise the table candle's
  runtime share while its shadow is on (cast_shadow cue) or add a warm key for the tableau.
- Real rAF FPS still needs a visible Chrome window.
- Cutscene fx: done (src/world/cutscene-fx.ts). CCDIK banister hand not done (the stairs clips key the hand). M2 clips: mapped.


## M2 (B06–B13) — runtime wiring (2026-09-30)

New modules: `src/game/m2-world.ts` (props from flags, hem, bell pull, kitchen, wardrobe back, locket in hand),
`src/world/cutscene-fx.ts` (every cutscene `fx` hook), `src/characters/sack-prop.ts` + `cleaver-prop.ts`.

**Flags → world (`m2.syncFlag`, also `syncAll()` after `director.start/startAt`)** — debug starts, respawns and
restores rebuild the same world: `has_hammer/shears/locket/can` → inventory item + source prop hidden (`has_locket`
false → removed); `has_ticket` → ticket pocketed; `hem_cut` → dress `intact`↔`cut_hem` parts, locket + ticket shown
(live: they drop from the hem); `c3_done` → P_CAR_GATE hidden, P_CAR_ROW shown; `bell_nonstop` → the parlor bell loop
(also on a B10/B11 debug start); `harlan_taken` → blue hour. Load defaults hide P_LOCKET, P_TICKET, the cut-hem part,
P_AIR_FRESHENER (sting only) and P_CAR_ROW.

**Gameplay**
- Journal (Tab): every read document as its handwritten page (`drawDocumentPage`, shared with the reading overlay);
  ← / → / wheel / 1–9 turn pages, Tab/Esc close. The guest book keeps its ruled rows (`lines`).
- Hold interactions: `Interactables.onHold(it, 'start'|'cancel'|'done')` — the hands work while E is held: pry
  (2.0 s, DESIGN) = `arms_pry_board` + hammer on `prop_r` + `pry_bite`; hem (1.6 s, only with the shears) =
  `arms_cut_hem` loop + shears on `prop_r`. Takes/reads play `arms_pickup_read`; the kitchen-side passage bolt
  ("Slide the bolt") `arms_slide_bolt`.
- Boards: a live pry sets `doors.livePry = k` before its flag, so that plank swings on its far nail, drops and lies on
  the landing (`board_drop`); flag restores snap planks straight to the floor pose. Pried planks stay visible.
- Bell pull: the embroidered pull moves 8 cm, the parlor bell rings far below (positional); story sfx without a
  position (`bell_pull`, `hatch_thump`, `fabric_tear`, `rope_pulleys`) are placed at their prop (`SFX_AT`).
- Wardrobe back: inside H_ADA_WARDROBE after `dress_visit_done`, **hold S** (0.7 s) → out through the loose back onto
  the servants' stair top (U4T), D_WARDROBE_BACK swung open. C4's `wardrobe_back_give` bows the boards a few degrees.
- Kitchen: entering (`b10:kitchen_enter`) → one thump under the hatch 1.4 s later (the lid jolts); Listen repeats it;
  taking the can grates (`can_scrape` + 6 m player noise).
- Locket: RMB (with the locket, not hidden) → `arms_raise_locket` then `arms_locket_hold`, the open locket on the arms'
  `locket` socket (photo side to the eye; rig-mounted fallback without the clips). After FINALE's take it sits in Ada's
  left fist (`prop_l`) through C5.
- End: C7's black + title stays up (no fade/flicker), "Esc menu" fades in.

**Clips**: `adaClipFor(anim, velZ, has)` prefers the M2 clips (search, door_push, dress, finale_approach/take ×1.25/
carry) and falls back to the M1 stand-ins. Re-cueing the clip that already plays continues it (C5 `harlan_finale` at
6.4 s and 10 s; C7 `ada_sting` held then run). `CharacterBank.attach` implements sockets: `sting_sack` (plumb, eyeholes
along `prop_r` +X), `locket` (`prop_l`), `cleaver` (`prop_r`). `ada_search_bed` plays when SEARCH reaches Harlan's bed
(`U2_BEDLOOK`).

**Lighting**: characters' LightsNode = probe lights + every candle/lamp flicker light (the tableau and the kitchen read
with a warm flickering key). C2's `cast_shadow` also raises the table candle's runtime share ×4.5 for the shot. The
room warm-up renders the candle-shadow variant WITH Ada, Harlan and their hand props (cleaver, locket, sack) in view.

**Review fixes**: E that closes a page is consumed (no re-read / page turn / re-voice); L lightning is debug-only;
resume can't soft-lock (menu hides on lock gained, `pointerlockerror` → click-to-begin); the pipeline caches one output
per chain shape (no bloom rebuild per DOF cue); guttered flames stay out; Space holds the breath only in gameplay or a
hide (never under a cutscene lock) and E can't leave a hide during one; no per-frame allocations in `setViewer`
(double-buffered Set; `triggersAt` / `visibleFrom` take optional output buffers), the controller's step/snap/headroom
(headroom only while crouched), Ada's root velocity, the prompt DOM; the death black is timed on game time; Ada's
velocity isn't reset on dt = 0. Round QA-1: Harlan never reappears at the table after C5 (`harlanHeldAtTable`,
`src/game/staging.ts`); the end card (z 36, click-through) sits below the pause menu; F, Tab and the wardrobe push are
ignored while `inputLocked()`.

**Prop/asset follow-ups applied**: rubber-sheet floor re-placement removed; P_KNOCKER registered from doors.glb (child
of the front leaf); the parlor door's 70° comes from doors.glb; clapboard normal-map lap depth reduced (0.012 → 0.003 m,
lap darkening 0.6 → 0.18) now that the facade has real lap geometry. H_CLOSET's eye was checked headlessly (raycasts
against collision.glb + the closet interior: 0.5 m to the side walls, 1.5 m above the floor, nothing inside).

**Verification**: typecheck, `npm test` (159), `npm run build` pass. In Chrome (hidden tab, `advance`/`capture`):
B06 → ledger → hammer → C3 → B08 (cars swapped, fx rigs found on all three cars: glass, 2 wipers each, cluster, lamps;
rope path + 3 sheaves). Browser testing was then stopped at the user's request (the machine lags), so **B08 pry →
B13 and the C1/C5/C6/C7 fx are verified only by typecheck/tests/headless GLB checks, not visually** — see the list in
docs/CUTSCENES.md.
