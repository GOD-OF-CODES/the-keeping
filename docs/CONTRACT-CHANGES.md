# Contract change log

Every deviation from the approved contract (`docs/PLAN.md`, `docs/DESIGN.md`, the schemas in `src/shared/*-types.ts`,
and the conventions in `CLAUDE.md`) is recorded here with the reason. Newest last. Agents append; the lead reviews.

| # | Area | Change | Reason | Source |
|---|---|---|---|---|
| 1 | Lightmaps | Our own **KLM** container (half-float, byte-shuffled, gzipped `.klm`) instead of EXR | Half the size at Medium (22 vs 44 MB for 6 atlases) and ~7× faster decode | Smoke S2, `docs/SMOKE.md` |
| 2 | Lightmaps | `lightMapIntensity` = **π**, sample at `(uv1.x, 1 − uv1.y)`, `flipY = false` | Measured (S3, 0.013 % from π) and proven with an asymmetric "F" pattern (S2) | `docs/SMOKE.md` |
| 3 | glTF export | `export_anim_slide_to_zero=True`, `export_anim_single_armature=False`; extras key **`pivot` banned** | Clips started at 1/30 s; stray actions became clips; three r186 GLTFLoader reads `pivot` as a vector | S1, props lane |
| 4 | Layout | Servants' stair is **two rooms**: `U4` (shaft, both floors) + `U4T` (upper landing) | A single room can't span both floors cleanly | Layout lane |
| 5 | Layout | Facade **9.35 m** (not 11); Ada's room 5×4.5; kitchen 5×4.6 clear + boxed stair; back passage 3.6×1.6; U1 2.4 m wide; bricked back door on the kitchen's east wall | A side-hall plan of hall 3.6 + parlor 5 can't reach 11 m; the dress needs a real east window | Layout lane |
| 6 | Layout | **7 lightmap atlases** (not ~6); flash maps only for the two upper atlases, Max tier only | Room grouping for texel density | Layout lane |
| 7 | Layout schema | Optional JSON fields: `room.within`, `room.note`, `wall.clipToStair`, `door.mat`, `door.boardMat`, `door.note`, `surface.mat`, `window.lightLeak`, `params.path` polylines | Needed for the closet under the stair, rope/bell-wire paths, the leaking parlor shutter | Layout lane |
| 8 | Conventions | Prop `yaw` rotates a model that faces south at 0; spawn/hide/AI look directions are headings CCW from east; sun `watts` are Blender strength (not ÷4π) | Clarification of ambiguous conventions | Layout lane |
| 9 | Lighting | Candles: **realtime direct light**, only their bounce baked | Avoids double counting while keeping the flicker | Runtime lane |
| 10 | Characters | Bodies meshed from an **anatomical implicit surface**, not Skin modifier + Subdivision; Harlan's sack **sculpted**, not cloth-simmed | Skin path folded/tore at palms, shoulders, face; sack cloth sim exploded | Characters lane |
| 11 | Props/house | Porch and foundation skirt are **owned by the house kit**, not props; knocker is a **child of the front door leaf** in `doors.glb` | Single owner, correct animation with the door | House/props lanes |
| 12 | Props | Static props **bake into their room's lightmap atlas** (strip at the top) | Props get their room's lights and flash maps without runtime changes | Blender pass |
| 13 | Props | Sawbuck table **0.6 m** wide (layout updated); parlor door opens to **70°** before C2 (`initialAngleDeg`) | Ada's opening pose; the 20° "ajar" hid the whole tableau | Playtest fixes |
| 14 | Assets | **Per-tier GLBs** (Low: decimated props/characters, 15 fps animation, 512² lightmaps) | Low tier download budget (≤ 25 MB) | Blender pass |
| 15 | Materials | 8 new material ids: `trousers_wool`, `twine_jute`, `steel_cleaver`, `coat_rain_dark`, `steel_flashlight`, `lens_flashlight`, `eye_ada`, `wick_cotton` | Characters/lamp needed them | Blender pass |
| 16 | Audio | Thunder masking window: roll starts ~1.5 s after the flash, lasts 2.5 s (shared by AI and audio) | One rule for hearing and sound | Audio/AI lanes |
| 17 | Voices | Generated clips are discovered through `public/assets/voice/index.json` | Vite dev returns 200 HTML for missing files, so file probing lies | Audio lane |
| 18 | AI | Grace after death = 8 s patrol-only + 20 s of −30 % hearing; the "unfailable first hide" is whichever hide is used first in B04; the beam on Ada ends the dress visit early | Interpretation of DESIGN.md rules | AI lane |
| 19 | Events | Trigger volumes are emitted as `interact { id: <trigger id>, action: <trigger event> }` | `events.ts` has no trigger event | World lane |
| 20 | Vite | `three` is aliased to `three/webgpu` | Prevents loaders/collision code pulling a second copy of three | World lane |
| 21 | Verification | Visual QA through `scripts/shot.mjs` (headless Chrome) only — never the user's browser | User: "don't open the game again and again in my browser" | Lead |
