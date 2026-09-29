# World & player runtime (lane B) — `src/world`, `src/player`, `src/game/main.ts`

The real level is the default scene. `?scene=test` = render test room, `?scene=matlab` = material lab,
`?scene=audiolab` = audio lab. `?spawn=<id>` starts at any layout spawn (`CP1`…`CP8`, `debug_*`); default `CP1`.
If the tier's manifest/assets are missing the game falls back to the test room (console warning).

## Files

| File | What |
|---|---|
| `src/world/rooms.ts` | Pure layout queries (no three; `tests/world-rooms.test.ts`): `RoomIndex.roomAt` (stairs → their rooms; interiors smallest-first, floor by feet height; house footprint gap → `null` = keep last room; exteriors), `visibleFrom` (culling set + doorway neighbours ≤ 0.6 m), `surfaceAt`, `creakerAt`, `stairStepAt`, `triggersAt`, `inBounds`, `headingToCameraYaw` (= heading − π/2), `partitionGround`. |
| `src/world/assets.ts` | Tier manifest, byte-progress fetch, GLTFLoader + MeshoptDecoder parse. |
| `src/world/level.ts` | `loadLevel()` → `Level`: downloads, parse, KLM lightmaps, prop placement, ground, material binding, room groups/culling, doors, collision, runtime lights, probe grids, per-atlas LightsNodes. |
| `src/world/collision.ts` | `WorldCollision`: Octree (collision.glb + ground quad + prop colliders) + dynamic door blockers; `floorBelow`, `rayDistance`. |
| `src/world/doors.ts` | `DoorSystem`: hinged leaves, locks (bolted/boarded/locked), flags, slow/fast pushes, slam, rope API, Ada's boards, passage bolt. |
| `src/world/lights.ts` | `RuntimeLights`: bake_flicker point lights (flicker share only) + flame billboards; lightning directional + window spots. |
| `src/world/interactables.ts` | Centre raycast focus + prompt, E / hold-E, default bindings for doors, boards, layout `interaction`s. |
| `src/world/hides.ts` | `HideSystem`: enter/exit, eye camera, look cone, W peek, events. |
| `src/world/fallback-materials.ts` | Flat avgAlbedo materials if `src/materials/bind.ts` throws. |
| `src/world/loading-overlay.ts` | Weighted loading bar (download, parse, materials, collision, probes, audio, compile). |
| `src/player/controller.ts` | Capsule player: look, WASD, run/walk/crouch, step-up, ground snap, bob, sway, footsteps, stamina/panting, breath hold. |
| `src/player/flashlight-rig.ts` | Flashlight (src/render/flashlight.ts) on a lagging hand rig; F toggles. |
| `src/player/inventory.ts` | `Inventory` (sets `has_<item>` flags), `Journal` (Tab overlay stub). |

## Contracts other lanes rely on

- **Coordinates.** `noise` events carry **PLAN** positions (`[x, y, z]`, z-up, feet height for the player);
  `audio.play(id, { pos })` takes **WORLD** positions. `Level.spawn(id).eye` is world; `__game.pos()` is plan feet.
- **Events emitted:** `noise` (player steps/creaks/gasps, doors, props), `player:breath`, `player:hide`,
  `interact { id, action }` for every interaction (doors `open`/`close`/`rattle_<lock>`, props with their layout
  `interaction` id, boards `pry`) **and for trigger volumes** (`id` = trigger id, `action` = the trigger's `event`,
  e.g. `b02:gate_passed`, fired on enter). `flag` for `has_<item>`, `ada_board_k`, `ada_boards_pried`.
- **Flags consumed:** a door's `unlockFlag` unlocks it (bolt slides back with sound); `ada_board_k` hides board k.
- **Doors API** (`level.doors`): `isOpen(id)`, `open(id, fast?, force?)`, `close`, `toggle`, `setLock`, `lockOf`,
  `ropeOpen()` (B02/B11: bolt clank, then a slow counterweight swing), `ropeClose()`, `removeBoard(k)`.
  `audio.setDoorStateProvider(doors.isOpenFn)` is wired.
- **Noise radii (m, at source):** footsteps per surface in `STEP_NOISE` (runner 1.5 … gravel 4) × run 2.5 /
  crouch 0.35, creaker 9, landing ×1.8; doors slow 3 / fast 9 / slam 13 / rattle 6 / bolt 5; knock 12, bell 12,
  pry 8; gasp after a long breath hold 2.5 (forced at 7 s: 5).
- **Light set is fixed after load.** Explicit LightsNodes ignore `light.visible`; fade lights by intensity.
  Lightmapped materials: flashlight + their atlas rooms' flicker lights (+ lightning dir on the exterior atlas,
  + lightning window spots when the tier has no flash maps). Probe-lit: flashlight, lightning dir/spots, 3 grids.
- **Culling:** `Level.setViewer(planX, planY, feetZ)` from the camera each frame; room groups + doors toggle
  `visible`. `level.setCulling(false)` renders everything (bakes, debug).

## Loading order (Medium, M1, measured in a hidden Chrome tab — visible is faster)

download 23 MB (localhost) · parse 0.4–1.7 s · materials (GPU baker, ~50 maps) 2.5–4 s · probe grids
(ground 126 + upper 126 + exterior 140 probes @16²) 6–12 s · audio prerender runs concurrently · compileAsync ·
room warm-up (every room centre × 4 headings, compiles shadow/depth pipelines before play).

## Debug (`?debug` → `window.__game`)

`teleport(spawnId)`, `spawns()`, `rooms()`, `room()`, `pos()`, `goto(x, y, z, heading, pitch)` (plan feet),
`look(heading, pitch)`, `setFlag(name, v)`, `flags()`, `openDoor(id, fast)`, `closeDoor(id)`, `ropeOpen()`,
`culling(on)`, `noclip(on)`, `showCollision(on)`, `give(itemId)`, `fixedCamera(id)` / `freeCamera()`,
`advance(n, dt, keys[])` (steps the game without rAF — works in hidden tabs; `keys` held, e.g. `['KeyW']`),
`gpuFrameMs(n)`, `unpause()`, plus `level`, `player`, `doors`, `hides`, `interact`, `audio`, `rig`.

## Known gaps

- No terrain relief: the exterior ground is flat quads per surface zone (+ a far grass field), probe-lit.
- Decal children (sign text, guest-book pages, labels) are not drawn yet (stroke-font CanvasTexture pending).
- Hides use the layout eye; the AI hide-check reveal/camera shake belongs to the AI/cutscene lanes.
- Document texts in `interactables.ts` are placeholders until the story lane owns them.
- Headlights / dashboard (`mode: runtime`) are left to the cutscene lane (the car is dead in play).
