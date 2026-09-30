# Integration — the playable M1 slice (B01–B05)

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
| `document` | journal + a reading overlay drawn with the stroke font (E / click / walking closes it). |
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
- Cutscene fx hooks listed above are not implemented; CCDIK banister hand not done; M2 clips pending.
