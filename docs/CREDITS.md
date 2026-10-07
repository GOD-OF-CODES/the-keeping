# Credits

## THE KEEPING — a game by Raj Vardhan Singh

| Role | |
|---|---|
| Created, written and directed by | **Raj Vardhan Singh** |
| Game design, story and dialogue | Raj Vardhan Singh |
| Art direction, house, props and characters | Raj Vardhan Singh |
| Lighting, materials and visual effects | Raj Vardhan Singh |
| Animation and cutscenes | Raj Vardhan Singh |
| Sound design and music | Raj Vardhan Singh |
| Voice design | Raj Vardhan Singh |
| Programming | Raj Vardhan Singh |

© Raj Vardhan Singh. All rights reserved.

### Made from scratch

Every piece of content in the game was made for this project by the code in this repository: the house, props and
characters (Blender Python in `blender/`), the baked lighting, the procedural materials (`src/materials/`), the
effects, the synthesized sound and music (`src/audio/`), the handwriting font, the story, documents and voice script.
No third-party assets of any kind are used: no downloaded textures, HDRIs, models, motion capture, sound libraries,
samples, fonts or CDN scripts. Character voices are designed from original descriptions and speak the game's
original script; they are generated with ElevenLabs Voice Design by `scripts/voices.mjs`.

## Open-source software licenses

The game runs on these open-source packages, whose licenses require their notices to be kept:

| Package | Use | License |
|---|---|---|
| [three.js](https://threejs.org) r186 | Rendering (WebGPU / WebGL2) | MIT — Copyright © 2010–2026 three.js authors |
| [Vite](https://vite.dev) | Dev server and bundler (build tool only) | MIT |
| [TypeScript](https://www.typescriptlang.org) | Language and type checking (build tool only) | Apache-2.0 |

Their full license texts ship with the packages in `node_modules/`. Blender (GPL) is used only as an offline
authoring tool and is not distributed with the game.
