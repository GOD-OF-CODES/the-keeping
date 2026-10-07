# Credits

## Content: 100% original, made by code

Every piece of content in The Keeping was made for this project by the code in this repository. No third-party
assets of any kind are used: no downloaded textures, HDRIs, models, motion capture, sound libraries, samples, fonts or
CDN scripts.

| Content | Made by |
|---|---|
| House, props, characters, rigs and animation clips | Blender 5.2 Python scripts in `blender/` (procedural geometry, sculpt passes, keyframed clips) |
| Baked lighting (lightmaps) | Cycles bakes driven by `blender/`, denoised and packed by our own scripts (`blender/lib/`) |
| Materials and textures | Procedural three.js TSL generators in `src/materials/`, baked to textures on the GPU at load time (no image files) |
| Sky, rain, mist, lightning and other effects | three.js TSL / runtime code in `src/world/` and `src/render/` |
| Sound effects, ambience and music | Synthesized at runtime with the Web Audio API in `src/audio/` |
| Handwriting on signs and documents | Our own single-stroke font, glyphs drawn as polylines with a pen model (`src/render/handwriting.ts`); UI text uses the system's installed fonts |
| Story, dialogue, documents and voice script | Written for this game (`docs/DESIGN.md`, `src/shared/voice-script.json`, `src/story/`) |

## Voices

Character voices are generated with [ElevenLabs](https://elevenlabs.io) using Voice Design: each voice was designed
from our own original text description (no cloned or library voices), and speaks our own original script
(`src/shared/voice-script.json`). Generation is done by `scripts/voices.mjs`.

## Software

| Package | Use | License |
|---|---|---|
| [three.js](https://threejs.org) r186 | Rendering (WebGPU / WebGL2) | MIT |
| [Vite](https://vite.dev) | Dev server and bundler | MIT |
| [TypeScript](https://www.typescriptlang.org) | Language and type checking | Apache-2.0 |

These three are the only npm dependencies. Their license texts ship with the packages in `node_modules/`.
Blender (GPL) is used as an offline authoring tool. It is not distributed with the game.
