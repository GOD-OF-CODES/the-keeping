# The Keeping

**A game by Raj Vardhan Singh.** Play it at https://the-keeping.vercel.app

A short, first-person horror game for desktop browsers. Everything in it (geometry, materials, lighting, animation,
sound and music) is generated from scratch by the code in this repository: Blender Python, three.js/TSL and Web Audio.
Character voices are designed from original descriptions and speak the game's original script. See `docs/CREDITS.md`.

© Raj Vardhan Singh. All rights reserved.

Built with three.js r186 (`WebGPURenderer`, automatic WebGL2 fallback), Vite 8 and TypeScript 7. Those three are the
only npm dependencies.

## Controls

| Key | Action |
|---|---|
| W A S D (or arrow keys) | Move |
| Mouse | Look (click the game to capture the pointer) |
| Shift | Run (loud) |
| C (or Ctrl) | Crouch (quiet) |
| F | Flashlight on/off |
| E | Interact. **Hold E** for hold actions (pry a board, cut the hem, pour). In a hiding place, E enters and leaves |
| W (while hidden) | Lean in to peek through the slats |
| Space (hold) | Hold your breath (up to about 7 s). In a cutscene you have already seen, hold Space (or Enter) to skip it |
| Right mouse button (hold) | Raise the locket into the flashlight beam (once you have it) |
| Tab | Journal (the documents you have read) |
| Esc | Pause menu (releases the pointer) |
| E / Esc / click / a movement key | Close a document page |

Bindings are defined in `src/player/controller.ts` (move, run, crouch, breath), `src/world/interactables.ts` and
`src/world/hides.ts` (E, peek), `src/game/main.ts` (F, Tab), `src/game/story-runtime.ts` (locket, skip, page close)
and `src/core/input.ts` / `src/game/pause-menu.ts` (pointer lock, Esc pause).

## Run and build

```sh
npm install
npm run dev          # http://localhost:5173 (desktop Chrome recommended; WebGPU, falls back to WebGL2)
npm run typecheck
npm test             # headless logic tests, incl. full B01-B13 playthroughs (tests/e2e-playthrough.test.ts)
npm run build        # production build to dist/, then scripts/verify-boot.mjs checks the boot chunk stays tiny
npm run preview      # serve dist/
```

On launch the boot card runs a short device test and suggests a graphics preset (Low / Medium / Max). Nothing else
downloads until you press Start.

URL options: `?beat=B05` starts at a story beat, `?spawn=CP3` at a checkpoint spawn, `?debug` exposes
`window.__game`, `?backend=webgl` forces WebGL2, `?rerun` repeats the device test, `?scene=test` loads the render
test room. `docs/PLAYTEST.md` is a 15-minute manual checklist that covers all of them.

## Asset pipeline

The house, props, characters, animation clips and baked lightmaps are made by Blender 5.2 Python scripts in
`blender/`, run headless one job at a time by `scripts/assets.mjs` (hash-cached, holds a lock so only one Blender
process runs). Output goes to `public/assets/<tier>/`.

```sh
npm run assets                      # run every stale job
npm run assets -- --list            # jobs and their cache state
npm run assets -- --dry-run         # what would run
npm run assets -- --only smoke      # only jobs whose id or group matches (comma-separated)
npm run assets -- --force           # ignore the input-hash cache
npm run assets -- --check           # verify manifests, GLB/lightmap invariants and download budgets (no Blender)
npm run assets -- --manifest        # only rewrite public/assets/<tier>/manifest.json
```

Blender is expected at `/Applications/Blender.app`.

## Voices

The game runs without voices (subtitle-only mode, with synthesized fallbacks for vocal sounds). To generate them, put
`ELEVENLABS_API_KEY=...` in `.env.local` (git-ignored; never use a `VITE_` prefix), then:

```sh
npm run voices -- --dry-run                      # validate src/shared/voice-script.json, estimate credits (no network)
npm run voices -- design                         # 3 Voice Design previews per speaker -> voices/previews/
npm run voices -- create --speaker ada --pick 2  # keep a preview as the speaker's voice
npm run voices -- speak                          # render every line to public/assets/voice/
```

## Docs

`docs/PLAN.md` (technical plan), `docs/DESIGN.md` (game design), `docs/PLAYTEST.md` (manual checklist),
`docs/CONTRACT-CHANGES.md` (deviations from the plan), `docs/CREDITS.md`.
