# Cutscenes — THE KEEPING (`src/cutscenes`)

C1–C7 and the death cutaway as **data** (timelines) played by a pure, deterministic sequencer on the game loop's dt,
plus a three.js/DOM binding layer and a preview harness. Everything is original: camera paths are authored from the
layout's fixed cameras/props, sounds are the synthesized bank ids, voices are voice-script **triggers**.

## Files

| File | What | three/DOM? |
|---|---|---|
| `types.ts` | `Timeline`, `CameraShot`, `VehicleTrack`, `MoveTrack`, `Key`, `Cue` union, `isStateCue`, `CutsceneContext`, `TimelineFactory`. | no |
| `math.ts` | easing; `catmullRomPoint` = three r186 `CatmullRomCurve3(…, 'centripetal').getPoint` (parity-tested); `ArcPath` (arc-length, like `getPointAt`); seeded value noise → `handheld`; `carToPlan`. | no |
| `sequencer.ts` | `Sequencer`: plays one timeline → `SequencerSink` (cues, camera pose, vehicle, moves, fade/letterbox, gates, end). | no |
| `host.ts` | `CutscenePlayer` (the Director adapter), injected interfaces (`CharacterDirector`, `CutsceneCamera`, `CutsceneAudio`, `CutsceneLights`, `CutsceneWorld`, `CutsceneUi`, …), `SeenStore` (`localSeenStore` try/catch, `memorySeenStore`). | no |
| `stage.ts` | Staging constants from the layout (cameras, spawns, props, nodes, door centres, the C2 tableau, car frames) + authoring helpers. Test-checked against `level-layout.json`. | no |
| `c1-empty.ts` … `c7-keeping.ts`, `death.ts` | The timelines (factories of `CutsceneContext`). `c2-room.ts` also exports `c2Replay`; `c4-hem.ts` exports `HemOverlay`. | no |
| `index.ts` | `CUTSCENES` library, `DIRECTOR_CUTSCENES`, `KNOWN_CLIPS`, `PENDING_CLIPS`. | no |
| `bindings.ts` | `createCutsceneSystem(game)` → `{ player, hem, overlay, deps, update, lock }`; `CutsceneOverlay` (letterbox, fade, title card, prompt, hold-to-skip hint, wet-lens vignette). | yes |
| `stub-characters.ts` | Primitive stand-ins (preview only). | yes |
| `preview.ts` | `?scene=cutscene&id=C2` harness. | yes |

## Model

- **Timeline** = `{ id, duration, lock, skippable?, shots?, vehicle?, moves?, fade?, letterbox?, cues }`. PLAN space
  (Z-up), headings CCW from +x (layout `yaw` for spawns; props: `heading = yaw − π/2`).
- **Camera shots** `[t, t+d)`: `path` / `target` point lists (1 = locked off, ≥2 = centripetal Catmull-Rom sampled by
  arc length), `fov` const or `[from,to]`, `ease`, `handheld` amplitude (seeded noise → yaw/pitch/roll *after*
  `lookAt`), `roll`, `space: 'car'` (x right, y forward, z up relative to the vehicle track). No shot at `t` = the
  player's camera (C3/C4 keep mouse-look).
- **Tracks**: `vehicle` (your sedan's pose on the road), `moves` (character root motion; clips are in place), `fade`,
  `letterbox` (2.39:1 bars).
- **Cues** (fire once when `prev < t ≤ now`, equal times in authoring order): `clip` (+`fallback` chain), `place`,
  `visible`, `release`, `attach`, `sfx`, `loop`, `voice` (trigger), `subtitle`, `card`, `light` (`lightning`,
  `storm_auto`, `set`, `gutter`, `cast_shadow`, `flashlight`, `runtime`), `door`, `prop`, `dressing`, `fx`, `score`,
  `weather`, `heartbeat`, `dof`, `lock`, `player` (where gameplay resumes), `gate`, `mark`.
- **Gates** hold the clock (C6 pour: hold E 1.2 s; key: press E; C4 breath). Every gate has a timeout → no soft-lock.
- **Skip** (after the first view, `localStorage['keeping.cutscenesSeen']`; C2_replay shares C2's; death never): all
  remaining *state* cues are applied in time order (clips at their end offset, doors, props, dressing, lights except
  lightning, dof, lock, player placement, moves' final poses), sounds/voices/subtitles/lightning are dropped, voices
  stop, then `done(true)`. Hold Space (or whatever the host maps) 0.8 s.
- **Determinism**: no `Math.random` / wall clock; cue order is independent of dt splitting (tested); handheld noise is
  a pure function of accumulated dt.

## Director contract (`src/story/director.ts DirectorHost.playCutscene`)

- `cs.player.playCutscene(id, done)` returns `true` synchronously for known ids (`C1 C2 C2_replay C3 C5 C6 C7 death`)
  and calls `done(skipped)` exactly once. It never emits `cutscene:start/end` (the Director does).
- Teardown runs **before** `done`: camera released (fov → `settings.fovDeg`, `player.applyCamera`, rig snap), input
  lock back to what gameplay had, DOF off, fade/letterbox/card/prompt cleared, the cutscene's loops stopped, candle
  shadows off, storm auto restored, characters released (Ada → AI output again), the sedan back at its layout pose.
- While a cutscene owns the camera the bindings turn **room culling off** (`level.setCulling(false)`) and restore it on
  release: road shots ride the car outside every room rect and several shots cut across floors.
  So `done` may start the next cutscene (C6 → C7) or respawn/teleport (death) synchronously.
- A new Director cutscene while one runs: the running one is skipped (state applied) and its `done(true)` fires first.
- C4 is **not** a Director cutscene (the brain's `dress` scripted mode). `HemOverlay` follows the brain's dress phases
  and plays overlay segments (DOF through the slats, heartbeat, "Hold your breath (Space)", the wardrobe back giving):
  no camera, no input lock, no voices (the brain voices `c4:hand_on_hem`), never blocks the story, yields to any
  Director cutscene.

## Wiring (integration builder — `src/game/story-runtime.ts` / `src/game/main.ts`)

The characters lane's `CharacterBank` already matches `CharacterDirector`. Five steps:

1. **Create** (in `createStoryRuntime`, after characters/voices exist — or in `startLevel` right after it):
   ```ts
   const { createCutsceneSystem } = await import('../cutscenes/bindings.ts');
   const cs = createCutsceneSystem({
     ctx, camera, level, player, rig, audio, characters,
     pipeline: () => pipelineRef,                // set pipelineRef in startGame after createPipeline (e.g. rt.expose.setPipeline(pipeline))
     sayTrigger: (t) => { for (const id of voiceMod.linesForTrigger(voiceIdx, t)) void voice?.play(id); },
     canvas: ctx.renderer.domElement,
     hooks: {
       lightning: () => lightning?.strike(),
       stormAuto: (on) => (on ? lightning?.setStorm(stormNow.interval, stormNow.rumble) : lightning?.setStorm(0, 1)),
       runtimeLight: (id) => level.runtimeLight?.(id) ?? null, // L_HEADLIGHT_L/R, L_DASH (world lane, see asks)
       fx: (id, p) => { /* world/render lane effects, see the fx table; unknown ids may be ignored */ },
       dressing: (set, on) => { /* 'sting': guest book HARLAN, fresh tallies, sack, maroon trim */ },
     },
   });
   story.setCutscenePlayer(cs.player.playCutscene);   // or DirectorHost.playCutscene: cs.player.playCutscene
   ```
2. **Per frame**, after `director.update(dt)` and before characters/world/render:
   ```ts
   cs.update(paused ? 0 : dt, {
     skipHeld: input.isDown('Space') || input.isDown('Enter'),
     interactHeld: input.isDown('KeyE'), interactPressed: input.wasPressed('KeyE'),
     breathHeld: player.holdingBreath,
   });
   cs.hem.update(lastAdaOutput /* the AdaOutput host.ada(out) received this frame */, hides.active?.id ?? null);
   ```
3. **Input**: interactions/hides only while `cs.lock === 'none'` (the existing `cutscene:start/end` handlers already
   toggle `interact.enabled`; keep them). The bindings set `player.enabled` / `lookEnabled` per lock and restore the
   previous values. The `player:death` handler's own `ui.fade(1, 0.35)` hides the death cutaway — drop it when the
   cutscene player is plugged in (the cutaway fades to black by 2.15 s itself; keep the respawn fade-in).
4. **Pre-C2 tableau**: fine as is — C2 acquires Ada/Harlan and re-places them on the same staging
   (`stage.ts ADA_TABLE / HARLAN_TABLE`, identical to `computeTableau`'s rule).
5. **Preview** (one line in `startGame`, right after `const lightning = createLightning(…)`):
   ```ts
   if (sceneParam === 'cutscene') await (await import('../cutscenes/preview.ts')).installCutscenePreview(rt, { ctx, pipeline, params, input, canvas, lightning });
   ```
   `?scene=cutscene&id=C5` boots the level, then plays C5 through the real bindings with stub characters unless
   `rt.expose.characters` is a `CharacterDirector`. Keys: R replay, N/P next/prev, 1–9 pick, K skip, E gates.

## Cutscene summary

| Id | Length | Lock | Highlights |
|---|---|---|---|
| C1 | 54 s | full | CAR set interior (wipers, rain fx, needle under E, chime, "Come on…"), POV on County Road 9 past NEXT SERVICES, ROOMS sign, sputter/stall, rolls to the gate, lightning reveal (`c1_house_reveal`), "Forty-eight miles…", rise past plate RVX-318 to CP1, flashlight on. |
| C2 | 21.6 s | full | Blend into `parlor_threshold`, candle shadow on the tally wall, clips in sync (O = 0.6 s), eye close-up, three heartbeats, "Go on, then.", rope whip-pan to the front door (slam + bolt), `ada_rise`, lurch into the hall, parlor door shuts + key; control returns 1.5 m from her, looking at her. |
| C2_replay | 3 s | full | Fade in at CP2; she rises behind you; whip back north. |
| C3 | 12.5 s | look | 1 s steer toward the field, 4 flashes (wrecks; Harlan pushing your car — car moves gate → row; head lifted to your window; gone), "That's my car.", door slam + bolt below, Harlan into the rocker. |
| C4 | overlay | none | `HemOverlay` segments per brain phase (see above). `C4` in the library = preview-only linear version. |
| C5 | 33 s | full | Silence, three slow knocks, door crack ("Ada?… No"), hand in the gap, walked to the threshold (the opening's lens), he backs away, candles gutter, two flashes with `fx silhouette` (unmask → "…Harlan."; cleaver), black, one stroke, one bell, rope zip, front door opens onto mist, parlor door closes. |
| C6 | 28.5 s + gates | full | Pour (gate), key (gate), two coughs, catch ("yes. Yes."), radio mid-song, past the pump, the lantern gutters, rear-view mirror shot (`fx mirror_view` = canvas flip), fade to black → C7. |
| C7 | 34 s | full | C1's interior + ROOMS POV shots re-timed, `dressing 'sting'`, "Oh, thank God. Rooms.", knock + "Hello?…", bell off right, door opens, guest book (`c7_guest_book`), the exact threshold lens, Ada in the rocker (`ada_sting`, fallback `ada_look`), gasp, black, final bell, THE KEEPING. |
| death | 3 s | full | Lunge from Ada's actual position to 0.45 m, handheld jolt + roll, wet-hand lens vignette, drowning rush, black by 2.15 s. Never skippable. |

### fx ids (world/render lane hooks; `bindings.ts` implements `mirror_view` and `lens_wet_hand` itself)

`windshield_rain {on, intensity}` · `wipers {on, period}` · `dash {on, fuelNeedle, fuelLamp: bool|'blink'}` ·
`taillights {on, intensity}` · `rope_run {dir}` · `silhouette {id: 'unmask'|'cleaver', on}` · `blue_hour {mist, rain}` ·
`car_trim {style}` · `fuel {level}` · `can_in_hand {on}` · `wardrobe_back_give {amount}` · `eye_glint {at}`.

## Tests

- `tests/cutscene.test.ts` (20): t=0 cues, dt-split invariance (60 Hz / 10 Hz / one step / ragged), half-open
  windows, late offsets, gates (hold, resume, timeout, pre-resolved, announced once), skip = same state cues as full
  playback + no sounds, move/place ordering, camera cuts/null/hold, determinism, Catmull-Rom parity with three r186
  (`getPoint` exact, `getPointAt` ≤ 5 mm), `carToPlan`, handheld bounds; data: every id, windows, finite points;
  **every voice trigger exists in voice-script.json**, every cutscene-owned trigger is cued, no re-voicing of AI/story
  triggers; every sfx/loop/stinger id is in the bank; clips exist or are pending M2 with a built fallback; door/prop/
  light ids exist; stage constants = layout; the C2 staging rule; every plan-space camera eye is inside a room rect;
  every timeline finishes on the loop dt.
- `tests/cutscene-host.test.ts` (11): the real `Director` + `CutscenePlayer`: C1 start/end once → B02, teardown before
  done; skip after first view; hold-to-skip; C6 → C7 → `end` re-entrancy; death releases camera/lock/Ada before the
  respawn teleport; B04 death → C2_replay; interrupting (incl. a done() that starts another cutscene); unknown ids / clip fallbacks; HemOverlay; seen store.

## Open issues / asks

- **World lane**: pre-create `L_HEADLIGHT_L/R` and `L_DASH` at load (the light set is fixed; expose `level.runtimeLight(id)`)
  and make them follow the sedan (`P_CAR_GATE`) when `vehicle` moves it; the `fx` table above (windshield rain,
  wipers, dash needle/lamp, taillights, rope run, blue-hour mist, car trim, silhouette gobo for C5 per DESIGN "pre-rendered
  shadow"); `dressing('sting')` (guest book HARLAN via the handwriting decals, fresh tallies, the sack prop, maroon trim);
  NEXT SERVICES / ROOMS sign text decals (WORLD.md: decals not drawn yet).
- **Baked candles can't go out**: `light gutter/set` scales only the runtime flicker share + hides the flame; C5 masks
  the dark with the fade. A per-atlas lightmap-intensity uniform per candle would make it real.
- **Candle shadows** (`cast_shadow` on `L_CANDLE_TABLE` in C2): enabling `castShadow` on a point light at runtime
  compiles new pipelines (hitch) — prewarm it during the room warm-up, or provide the DESIGN's silhouette gobo.
- **Render lane**: `setCutscene` rebuilds the output node; DOF is only changed at discrete cues. Exposing the DOF
  uniforms would allow animated focus pulls.
- **main.ts lightning** auto-strikes with `Math.random`; `hooks.stormAuto` needs a pause/resume on the storm cadence.
- **Characters lane (M2 clips)**: `ada_dress`, `ada_finale`, `ada_sting`, `harlan_finale`, `arms_pour_can` are cued with
  built fallbacks (`ada_listen`/`ada_vigil`/`ada_look`, `harlan_pose_stairs_foot`/`harlan_opening`, `arms_idle`);
  `attach('sting_sack', 'hand_r')` needs a sack prop.
- **AI lane**: C2 ends with Ada at (3.35, 1.55) in the hall; the story then force-places her at `G_PARLOR_LURE`
  (3.2, 1.5) — a 0.15 m seam (fine). After C5 the story hides her (`scripted hidden`).
- `bindings.ts`, `stub-characters.ts`, `preview.ts` are only type-checked: nothing imports them yet, so Vite has not
  bundled them and `?scene=cutscene` has not run in a browser (needs the one-line hook). All numbers are test-checked
  against the layout, but framing/lighting must be reviewed in-engine. Preview `K` force-skips (even death).
