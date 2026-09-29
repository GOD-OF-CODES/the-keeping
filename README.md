# The Keeping

A short, first-person horror game for desktop browsers. Everything in it — geometry, materials, lighting, animation,
sound and music — is generated from scratch by the code in this repository (Blender Python + three.js/TSL + Web Audio).
Character voices are designed and generated with ElevenLabs from an original script.

- `npm install` · `npm run dev` → http://localhost:5173
- `npm run assets` builds the house, props, characters and baked lighting with Blender 5.2 (headless).
- `npm run voices` generates the voices (needs `ELEVENLABS_API_KEY` in `.env.local`).

See `docs/PLAN.md` (technical plan) and `docs/DESIGN.md` (game design).
