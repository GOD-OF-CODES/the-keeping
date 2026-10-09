# Roadmap — remaining rounds (lead-owned)

User priorities, in order: **photoreal graphics** → many short cinematic cutscenes (`docs/CUTSCENES-PLAN.md`) → ship
on https://the-keeping.vercel.app. All credits to Raj Vardhan Singh. Max 3 agents; one headless Chrome / one Blender.

## Done
- Foundations, full B01–B13 route, C1–C7, AI/story, synthesized audio, voice pipeline (subtitles until a key exists).
- QA-1: lightmap tier budgets, input/lure fixes, e2e tests. QA-2: real-game playthrough bot, perf tables, realism
  backlog (`docs/REALISM-BACKLOG.md`), perf plan (`docs/PERF-PLAN.md`).
- Round A (perf): warm load Medium 44 → 12.5 s, WebGL2 76 → 18.6 s, programs −35…70 %, Low/WebGPU FXAA, shipped
  probes, split ground octree, stable light lists (no rebuilds on torch/indoor-outdoor).
- Round A (Blender): trees + LODs, treeline, ground cover, moonlit bakes, pole line (commit 0faebb9, not pushed).

## In progress
- Round B (lighting/camera, `docs/REALISM-STATUS.md`): post chain, eye adaptation, moon/lightning, fog, grain, white
  balance, sky; candle specular, reflections, flashlight + bounce, trim/floor, Ada shading, rain glass, C5/C6,
  C7 LightmapMaterial.clone crash.

## Next — Round C (after B; then commit src + push once the playthrough bot reaches the ending)
0. **Opening drive C1 (+ title cinematic C0) — FIRST, user-flagged ("nothing is visible"):** lead check
   (scratch/lead/c1-now-*.jpg, Medium, round-B tree): interior framing wrong (headliner fills the top third, glows
   orange; no dash/gauges/wheel visible; hands are blobs); headlights don't light the road (two bright bars, black
   road); ROOMS sign a blurry smear; windshield rain = specks; lantern = big sprite flare; FP arms visible in
   exterior shots. Good already: the lightning reveal of the house, trees vs sky. Fix: Blender — scaled 1980s
   dash/cluster/wheel/A-pillars/mirror/headliner; runtime — driver eye ≈ 1.15 m + lens per shot, halogen low beams
   (≈ 700–1000 lm, 3200 K, real beam pattern) on wet asphalt with reflections, spray and markings, windshield rain +
   wiper arcs, crisp painted sign lettering, arms hidden outside; shot-by-shot art-director review vs a real rainy
   night drive. Build C0 (docs/CUTSCENES-PLAN.md) in the same pass.
1. **QA/story (gate for any push):** playthrough bot stalls at B08 in U2 near (5.2, 3.2, 4.1) since the round-A
   assets (old assets finished) — find the collider/waypoint cause. Regenerate `probes.bin` for all tiers
   (`npm run probes`), and make `scripts/assets.mjs` warn/invalidate probes when level GLBs change. Full playthrough
   on Medium + spot checks Low/Max, cold and warm loads reported separately, on mains power.
2. **Blender:** lead decisions → `grass_dead` material (family grass, dead straw, albedo ≈ 0.18–0.22 linear,
   roughness 0.65–0.75, wetness 0.6) and raise `grass_wet` albedo toward 0.10–0.15 (via `scripts/layout/materials.mjs`
   + calibration entries) then `--only house`; arms hold pose rotated 20–30° (barrel visible, not the tail cap);
   upstairs key candle + doors ajar + sky Lz (backlog #10); KLM `floor_exp` 13 on dark atlases (#9); clapboard lap
   geometry check (#12); automatic single retry on Blender "terminated abnormally". Then — alone, mains power, no
   Chrome — `npm run assets -- --only bake-release --force` (~80 min), encode, probes.
3. **Materials/perf:** clapboard runtime generator (peel stretched along u, butt joints every 3–5 m, mildew broken
   across courses, rain/grime streaks under sills and eaves); alpha-tested twig cards for winter crowns; P1-6b fewer
   lighting groups; P2-8 Low frame ≤ 4 ms; Max is CPU-bound (21 fps, 2.85 M tris / 602 draws in the yard) → meet
   the Max budget (≥ 45 fps, ≤ 2 M tris, ≤ 500 draws) without visible loss; C2 first-frame shader builds;
   lightning shadow warm-up; footstep zones on the new drive shoulders.

## Lead rulings (log in CONTRACT-CHANGES at the next src commit)
- Yard trees capped at 64k triangles (dropped 1.8 mm spurs are ≤ 1 px at the closest view) — accepted.
- Max budget: ≥ 45 fps, ≤ 2 M tris, ≤ 500 draws (visual parity required, not unplayability).

- **Opening (docs/C1-OPENING.md §10), 2026-10-08 — all approved:** (1) layout: RC9 room + `P_RC9_*` props + `L_DOME`,
  `L_CAB_VEIL`, `L_TRUCK_HI_L/R`; headlights get `cd`/`beam`/`kelvin` 3200 (no more 3000 W); `L_DASH` → spot at the
  cluster; CAR ceiling 1.15 → 1.34; `L_LANTERN` 60 → 150 W (the release bake picks it up). (2) `src/shared/road-rc9.json`
  becomes the shared corridor definition (Blender reads it). (3) `sedan_interior` in car space; re-tune `stage.ts`
  targets. (4) St Christopher medal in C1; the pine freshener stays the sting's tell. (5) The three new driver lines.
  (6) **Low budget 25 → 27 MB** (pipeline.json; the card shows the real manifest size). (7) EXT1 sign text → "CARVEL 48".
  (8) The new material ids. (9) Arm clips + close-up gloves → next Blender round. C0 aerial: the runtime must cull the
  corridor instances by chunk/distance (≤ 1.5 M tris Medium, ≤ 2 M Max in every C0 shot).
- **Spec requests approved:** #34 `grass_dead` (albedo ≈ 0.20, roughness 0.70, wetness 0.6) and #41 `grass_wet`
  avgAlbedo → [0.09, 0.12, 0.06]; bounce colours follow at the next house bake.
- **B08 review rulings (2026-10-08):** (a) Ada never senses light she can't see — `beamNear` needs line of sight (row
  #40 stands). (b) A torch spot she *can* see may replace an active bell lure: DESIGN's "newest(LURED | INVESTIGATE)"
  stands; the line-of-sight rule makes it fair. (c) Add a `QA_TORCH_ON=1` Medium playthrough to the release gate.
  (d) `H_ARMOIRE` eye → [3.12, 4.45, 5.65] (off the meeting stiles; clears the rail). (e) Keep the renderer's raised
  per-stage sampler limits only if Max needs them; Harlan's Max shaders are at the M1's 16-sampler limit — no new
  texture/shadow wrapper on characters without freeing one.
- **Power note:** the charger dropped 02:01–06:37 on 2026-10-08 (Mac hibernated at 1 %); every perf number in that
  window is a battery number — re-measure on mains before any perf ruling.
- **Difficulty (user, 2026-10-08: "i shouldnt get caught very easily"):** Ada must forgive ordinary play — walking,
  torch on, the odd noise. A catch needs a clear mistake (running into her, standing in her path, lighting her face up
  close). Tension comes from tells, near misses and chases she gives up. Gate: a "careless player" bot (walks, torch
  on, rarely crouches) reaches the ending with ≤ 1 death on Medium; the stealth bot with 0 deaths. Nobody may be caught
  within 6 s of a cutscene ending (C3 → B08 left her 3.3 m away).
- **Props finishing (user, 2026-10-08: "the finishing in the props is still not there, need more detailing"):** a props
  detailing round (audit → finishing system → Blender geometry/normals/masks → runtime wear/grime/edge materials →
  art director) runs next, alongside the gameplay and runtime lanes.
- **Props finishing design (docs/PROPS-FINISH.md), 2026-10-08 — approved R1–R6:** the COLOR_0 `wear` pipeline (row
  #59 now APPROVED), optional `params.wear` in `material-types.ts`, the `grime_decal` spec (via materials.mjs); dust
  0.3–0.6 on furniture/metal specs; the R3 spec reassignments (cleaver → steel_cleaver, forged-steel shears/hammer head,
  hickory handle, jerry can = painted sheet steel over red-oxide primer, wool bell pull); toCreasedNormals leaves
  opening.ts once the weighted normals ship; a C1 sedan_interior scenario hook; a soot decal above the U2 lamp.
  Low: masks on as many HERO props as the 27 MB budget allows (measure first; never exceed the budget).

- **Round D results → round E rulings (2026-10-09):** (a) `QA_STRICT=1` is the playthrough gate default (a bot
  teleport rescue = a fail); the release gate = Low/Medium/Max stealth + Medium careless + Medium torch-on, all strict.
  (b) Respawn fairness: after any death an idle player must survive ≥ 60 s at the respawn point of every checkpoint
  (CP1–CP8); `grace()` starts her patrol away from the player (CP4 may move into Harlan's doorway). (c) Controller
  step-up capped at 0.27 m (real risers 0.25 m); tables and chairs are not climbable. (d) Back stair → kitchen: move
  `P_KITCHEN_CHAIR_2` (the tipped chair) out of the doorway lane; `D_BACKSTAIR` keeps its hinge (a leaf swinging into
  the 0.8 m shaft would block the stair); ≥ 0.8 m clear lane with the door open. (e) CONTRACT #68b (probe-lit props get
  the candle/lamp direct term) is kept — it is physically right; the warm-up must cover the recompile it adds.
  (f) woodGrain Nyquist cap 0.7·size → 0.5·size approved (shimmer is not photographic), with full wood recalibration.
  (g) Print canvases (bus ticket, air freshener) keep no `COLOR_0`; their ageing (thumb-soiled corners) is painted in
  the paper canvas path. (h) Grime decals on (`kit.GRIME=True`) within budget; on Low drop grime decals first, then the
  dress_dummy mask, never exceed 27 MB. (i) Max first load stalls 300 s at "Compiling shaders — U4T" (2 of 2 Max runs):
  release blocker, next runtime round item 1. (j) Blender trunk collider proxies deferred — the runtime trunk box
  (#61b) stands. (k) Duplicate CONTRACT rows renumbered 61b / 67b / 68b.

## Then — cutscene rounds (docs/CUTSCENES-PLAN.md §8): M-A … M-F, plus CR end credits (§9)
Each round: builders → adversarial reviewer → QA (playthrough bot, perf, hero shots) → commit → push → verify live.

## Finish line
All cutscenes + credits roll; top realism items done; Medium ≥ 45 fps and < 15 s warm load; Max within budget;
playthrough bot reaches the ending on Low/Medium/Max with zero errors; release bake shipped; live on Vercel.
**Voices — the very last step, by the user's choice:** the user adds `ELEVENLABS_API_KEY` only when everything else
is final, to spend the fewest credits (free plan 10k/month; the script needs ≈ 6.5–7.5k). Before asking for it:
freeze `src/shared/voice-script.json` (all cutscene lines in, wording reviewed for performance and tags), run
`npm run voices -- --dry-run` for the exact credit estimate, then design one voice at a time (the user picks from
the previews) and speak; the hash cache never re-spends credits on unchanged lines.
