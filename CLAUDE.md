# THE KEEPING — project rules

First-person horror game for desktop browsers. three.js r186 (`WebGPURenderer`, TSL, automatic WebGL2 fallback) +
Vite 8 + TypeScript 7. The approved plan is `docs/PLAN.md`; the game design is `docs/DESIGN.md` (raw: `docs/design.json`);
verified research (three r186 APIs, Blender 5.2 experiments, device detection) is `docs/research.json`.

## Non-negotiable
- **Everything is made from scratch.** No downloaded assets of any kind: no textures, HDRIs, models, mocap, sound
  libraries, fonts, or CDN scripts. Content comes from our code: Blender Python (`blender/`), runtime TSL/Web Audio (`src/`).
  UI uses system fonts only. The ONLY exception: character voices via ElevenLabs *designed* voices (`scripts/voices.mjs`).
- **npm dependencies: `three`, `vite`, `typescript` only.** Never add packages (no @types/three, no test frameworks).
- **Nothing may download before the player picks a graphics preset.** `src/boot/**` must never import three.js or
  anything under `src/game`, `src/render`, etc. (only `src/shared/types.ts`-style pure modules). Game code is reached via
  `import()` after Start. `npm run build` runs `scripts/verify-boot.mjs` to enforce this.
- **Weak machine (M1, 8 GB):** at most one Blender process at a time — run Blender only through `scripts/assets.mjs`
  (it holds a lock) or, for one-off experiments, only when no other Blender is running (`pgrep -f Blender.app`). Never run
  a full-resolution bake while a browser/WebGPU session is open.
- Never print or commit `ELEVENLABS_API_KEY` (lives in `.env.local`, git-ignored). Never use a `VITE_` prefix for it.

## Conventions
- Coordinates: PLAN space (layout JSON, Blender) is Z-up, x=east, y=north; WORLD (three/glTF) is Y-up. Convert with
  `src/shared/coords.ts` (`planToWorld(x,y,z) = (x, z, -y)`). Prop generators build props facing -y at yaw 0.
- Shared single sources of truth (lead-owned; change only when your task says so): `src/shared/level-layout.json`
  (schema `layout-types.ts`), `src/shared/material-spec.json` (`material-types.ts`), `src/shared/voice-script.json`
  (`voice-types.ts`), `src/shared/types.ts`, `src/game/context.ts`, `src/core/events.ts`.
- TypeScript must run under `node --experimental-strip-types` for tests: use explicit `.ts` import extensions, no
  `enum`, no `namespace`, no constructor parameter properties (`erasableSyntaxOnly` is on). Use `as const` objects.
- three has no type declarations here (`src/types/shims.d.ts` makes it `any`). **Verify every three API against
  `node_modules/three/src` and `node_modules/three/examples/jsm` (r186) before using it** — don't rely on memory.
  Imports: `three/webgpu`, `three/tsl`, `three/addons/...`.
- Light units: runtime point/spot intensity = Blender watts / (4π); lightmaps are irradiance, `lightMapIntensity` = π
  unless `docs/SMOKE.md` says otherwise. AgX tone mapping. Never `setPixelRatio(window.devicePixelRatio)` directly —
  presets cap it (`src/render/presets.ts`).
- Blender: `/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python <script> -- <args>`.
  Blender 5.x API: layered Actions only (`action.fcurves` is gone), Boolean solver 'FAST' is now 'FLOAT',
  `Material.use_nodes` deprecated. Set `cycles.samples` + `use_adaptive_sampling=False` explicitly; bakes are never
  denoised by Cycles (use `blender/lib/oidn.py`). Apply modifiers on static meshes before UV2/bake/export.

## Commands
- `npm run dev` (http://localhost:5173) · `npm run typecheck` · `npm test` · `npm run build`
- `npm run assets` (serial Blender pipeline, hash-cached) · `npm run voices -- --dry-run`
- Debug: `?debug` exposes `window.__game`; `?backend=webgl` forces the WebGL2 backend; `?scene=test` loads the render test room.

## Ownership lanes (parallel agents must stay in their lane)
- A (Blender): `blender/**`, `scripts/assets.mjs`, generated `public/assets/**`.
- B (runtime): `src/boot`, `src/game`, `src/core`, `src/render`, `src/materials`, `src/world`, `src/player`,
  `src/characters`, `src/ai`, `src/story`, `src/cutscenes`.
- C (audio/UI/tests/data): `src/audio`, `src/ui`, `tests/**`, `scripts/voices.mjs`, docs other than PLAN/DESIGN.
