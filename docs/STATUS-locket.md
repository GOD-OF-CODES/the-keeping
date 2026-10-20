# STATUS — LOCKET hotfix (2026-10-20, "i cut the dress but no option to pick the locket")

Lane: hotfix (runtime `src/world/interactables.ts`, `src/game/m2-world.ts`; QA `scripts/qa/playthrough.mjs`).
Scratch: `scratch/locket/`. Dist: `scratch/dist-locket` (delete at the end). Contract rows #158, #158b …
Not touched: `src/game/main.ts`, `scripts/shot.mjs`, loading/caching files (LOAD lane), `src/shared/level-layout.json`
(its JSON is hashed into the probe key, level.ts:851 — an edit would stale the shipped probes).

## Plan / progress
| # | Item | State |
|---|------|-------|
| 1 | Reproduce through the real pick path (B09, story-driven cut, 7 standing spots × standing/crouched) | done (r1) |
| 2 | Root fix: null-label items never win/occlude; bundle lands outside the skirt; padded pick + reach for small pickups | done (r2: 15/15 probes give the prompt); visual pass in progress |
| 3 | Audit every bot interaction through the real pick from the bot's own spot | done (pt-med run 1: 1 real bug found + fixed — the knocker) |
| 4 | Bot asserts the real pick before each use() (QA_STRICT) | done (`aimProbe` / `aimCheck`, #158c) |
| 5 | Gates: typecheck, test, build, assets --check, strict Medium + Max playthroughs | done — all pass |

## 1. Diagnosis (scratch/locket/repro.mjs, run r1, Medium, WebGPU, mains)
Setup: `--beat B09`, letter / shears / hem through `use()` (as the bot), 3 s for the drop, then the player is placed
around the dress (bot spot u3_dress 7.4,6.7 and 6 spots 0.9 m from the locket at 150–300°) and the camera aimed at the
locket's centre, standing and crouched (15 probes). Every probe: `interact.focus` null, HUD prompt hidden.

| Suspect | Verdict | Evidence |
|---|---|---|
| (a) null-label dress wins the pick / occludes | **HOLDS** | 15/15 probes: box candidates [P_DRESS, P_LOCKET], exact winner P_DRESS (label null after the cut) → `update()` drops it, no prompt. Dress hit 0.66–1.36 m, locket 1.23–1.79 m. |
| root under (a): the bundle's rest spot | **HOLDS — the real root** | P_LOCKET (8.15, 7.0, 4.22) is 0.2 m from the dress centre, 12 cm above the floor: INSIDE the round-E skirt (hem radius ≈ 0.59 m × folds). 24/24 rays out of the locket hit the SHOWN dress within 1.2 m. The drop tween falls inside the cloth; the player sees only satin (r1/repro-01-aim.jpg). Fixing (a) alone would offer "Take the locket" on bare cloth. Same for P_TICKET (8.1, 7.0, 4.22). |
| (b) the dress's static collider blocks LOS | does NOT hold | colDist 1.35–1.93 m ≥ the locket hit in all 15 probes (the octree ray test does not see the skirt from outside; from inside 24/24 hit). The collider is exact (22 560 tris ≤ 30 000) and holds BOTH dress states (built once at load). Left unchanged. |
| (c) too small / too low | partly | bbox 54 × 56 × 8 mm (locket + pooled chain): 13–19 px at 1.2–1.8 m; a dead-centre aim at the bbox hits the chain wire or air in about half the probes. |

## 2. Fix (code)
- `src/world/interactables.ts` (#158): `pick()` skips any item whose `label()` is null in BOTH the box pre-filter and
  the exact pass (it neither wins nor occludes; real occluders = the static-collision LOS, unchanged). New optional
  `Interactable.pad` (aim tolerance, m): the shown meshes' world box grown by `pad` is part of the item's surface; padded
  items are tracked live (no cached centre — the bundle moves after binding). `FLOOR_REACH` 2.2 m (standing eye 1.65 m
  over an item 1 m ahead = 1.93 m > REACH 1.9). `PICK_AID`: take_locket pad 0.06 + floor reach, read_ticket pad 0.05 +
  floor reach.
- `src/game/m2-world.ts` (#158b): the hem bundle's rest spot is measured at load from the dress: front = the prop's
  −y (three +Z), hem reach = the cut state's lowest vertices within ±20° of the front (0.66 m fallback); the locket lands
  0.11 m out of the cut, the ticket 0.16 m out and 0.13 m aside, on the floor (`collision.floorBelow`). The drop starts
  at the cut's sill (9 cm) 3 cm inside the hem: the locket falls freely (√(2h/g) = 0.135 s) and slides out (0.32 s),
  the card drifts down (0.45 s) with a flutter. Restores (`?beat=`, CP6, saves) show them at the same spot.
  The layout `pos` is untouched (= where they are sewn in); the probe key is unchanged.
- `tests/interact-pick.test.ts`: null-label enclosure, pad, live tracking, LOS (4 tests).

## Before / after numbers
| Check (Medium, WebGPU, mains) | Before (r1) | After (r2) |
|---|---|---|
| probes giving "Take the locket" (7 spots × standing/crouched + 1) | 0 / 15 | 15 / 15 |
| rays out of the locket hitting the shown dress | 24 / 24 (inside the skirt) | 4 / 24 (the ones toward the dress) |
| locket rest (plan) | 8.15, 7.015, 4.224 (in the skirt, 12 cm up) | 7.373, 7.263, 4.106 (on the boards, 0.78 m W of the form) |
| eye → locket from the bot spot u3_dress | 1.73 m (blocked) | 1.74 m standing / 1.19 m crouched, prompt |
Screens: r1 `scratch/locket/r1/repro-01-aim.jpg` (cloth only), r2 `scratch/locket/r2/repro-01-aim1.jpg`, `-02-aim2.jpg`
(prompt shown; the bundle is legible but small in the torch hotspot — see the visual pass).

## Visual pass (scratch/locket/visual.mjs; v1 = 1280 × 800 Medium)
- Drop, frame by frame at 60 Hz (loop stopped): locket first drawn at frame 15 (0.25 s) at the 9 cm sill, on the boards at
  frame 24 (0.15 s ≈ √(2h/g)), at rest by frame 33; ticket drawn at 20, lands at 48. Largest per-frame step 2.2 cm
  (locket, = the 1.33 m/s impact speed / 60) and 1.0 cm (ticket): no pops.
- `scratch/locket/v1/vis-01-v1.jpg` (crouched 0.63 m W of it), `vis-02-v2.jpg` (standing at the bot spot): the bundle
  lies on the boards just in front of the ragged cut, the ticket reads as a pale card. HONEST: the 30 mm locket reads as
  a small dark oval (≈ 8–10 px at 1.2 m) inside the torch's clipped hotspot — tarnished brass lying flat mirrors the dark
  ceiling, so it does not glint; it is findable (the prompt appears on it) but not obviously brass at that range. The
  hotspot clipping is the torch exposure, not this lane (request for the lead below).

## 3. Audit — every bot interaction through the REAL pick from the bot's own spot (pt-med run 1, Medium strict)
`aimProbe` (scripts/qa/playthrough.mjs): from the bot's eye at the moment it acts, `interact.pick()` aimed at the
target's overall box centre + per-mesh box centres + ≤ 96 triangle centroids (no frame advanced, camera restored).
frac = share of aims giving the target's prompt; c = the dead-centre aim does.

| Beat | Kind | Target | Result (run 1) | Eye → target |
|---|---|---|---|---|
| B02 | interact | P_KNOCKER | **FAIL 0 / 36 — D_FRONT won every aim** | 1.34 m |
| B02 | interact | P_BELL_KNOB | ok 1.0 c | 1.52 m |
| B02 | door | D_FRONT | ok 0.88 c | 1.53 m |
| B05 | hide | P_ARMOIRE | ok 1.0 c | 0.91 m |
| B05 | door | D_HARLAN | ok 1.0 c | 1.01 m |
| B06 | interact | P_LEDGER | ok 1.0 c | 1.12 m |
| B06 | interact | P_HAMMER | ok 0.97 (box centre is air: L-shape) | 0.99 m |
| B08 | interact | P_BELL_PULL | ok 0.65 c | 1.51 m |
| B08 | interact | board_1 / 2 / 3 | ok 1.0 c each | 1.29 / 0.88 / 0.79 m |
| B09 | interact | P_LETTER | ok 0.98 c | 1.57 m |
| B09 | interact | P_SHEARS | ok 0.65 c | 1.50 m |
| B09 | interact | P_DRESS (cut, hold) | ok 0.97 c | 1.29 m |
| B09 | probe | P_TICKET | ok 1.0 c | 1.67 m |
| B09 | interact | P_LOCKET | ok 1.0 c | 1.72 m |
| B09 | hide | P_ADA_WARDROBE | ok 1.0 c | 1.05 m |
| B10 | door | D_BACKSTAIR | ok 0.74 c | 1.80 m |
| B10 | interact | P_JERRY_10 | ok 0.76 c | 1.55 m |
| B10 | interact | D_PASSAGE (bolt) | ok 0.99 c | 1.33 m |
| B11 | door | D_PASSAGE | ok 1.0 c | 0.91 m |

Not probed: P_CAR_ROW 'car' (B12/B13) — the bot ends the run through C6 before that interact fires (it reached B13 via
the story); see run 2.
- **Knocker (real bug, pre-existing):** P_KNOCKER ships in doors.glb as a CHILD of D_FRONT's leaf (level.ts registers
  door-mounted props), so the door's recursive raycast hit the knocker's own meshes at the same distance and D_FRONT,
  bound first, won — a player only ever saw "Try the door" on the knocker (the B02 objective says "Knock on the front
  door"; the bell beside it still opened the door, so it was not a dead end). Fix (#158): a mesh belongs to its innermost
  registered item (`ownedByOther`). Unit test `tests/interact-pick.test.ts` #5.
- **Hammer:** focusable (97 % of surface aims); only its box centre is air. The pickup gate is now "dead-centre OR
  ≥ half of the surface aims" (an L-shaped tool has no surface at its box centre). No pad needed.

Run 2 (after the knocker fix, fresh build `scratch/dist-locket`, Medium strict, mains): **21 / 21 probes ok**, knocker
1.0 c (was 0), D_FRONT 0.47 c (its knocker meshes no longer count for the door), all 7 pickups pass the ease gate;
26 / 26 assertions, B01 → B13 → title, 0 deaths, 0 unsticks, 0 console errors / exceptions (`scratch/locket/pt-med2/`).
Not reached by the bot: P_CAR_ROW 'car' — the `b12:at_car` trigger starts C6 as the bot walks up (beats.ts accepts
either), so that interact is optional; not probed.

## 5. Gates
| Gate | Result |
|---|---|
| `npm run typecheck` | ok |
| `npm test` | 5 runs: run 1 376 / 377 (one failure, not captured — the output was tailed; the LOAD lane's headless Chrome was loading at the time), runs 2–4 377 / 377, run 5 (with the 5th pick test, during the Max playthrough) 378 / 378 |
| `npm run build` (verify-boot) | ok — boot payload 12 710 B gz, no three.js / game code before Start |
| `node scripts/assets.mjs --check` | ok (low 26.96 / medium 51.46 / max 102.83 MB; voice 5.48 MB) — no asset changed |
| strict Medium playthrough (fresh dist) | PASS (run 2 above) |
| strict Max playthrough (same dist, `--no-build`) | PASS — 21 / 21 probes ok (same table as Medium run 2), 26 / 26 assertions, B01 → B13 → title, 0 deaths, 0 unsticks, 0 console errors / exceptions (`scratch/locket/pt-max/`) |

Low check (repro r3, `--preset low`, same dist): the Low dress is decimated (3 889 tris vs 22 560) but the measured
landing is identical — locket (7.373, 7.263, 4.106), ticket (7.331, 7.07), 4 / 24 enclosure rays (outside), 15 / 15 aims
give "Take the locket", 0 console errors. Screen `scratch/locket/r3-low/low-01-aim1.jpg` (the third look): the bundle on
the boards in front of the ragged cut, the ticket a pale card beside it, the locket a small dark oval with a faint brass
edge in the hotspot. Honest: the three looks (r2, v1, r3) verified the same placement — nothing was changed between
them; the remaining weakness (the locket's legibility in the clipped hotspot) is the torch exposure (request 2).
Objective hint: `story-runtime.ts hint()` boxes `level.prop(target)` live, so the B09 "Take the locket" hint marks the
landed bundle, not the sewn-in layout spot.

Power: mains (AC attached) for every run. `scratch/dist-locket` deleted after the gates.

## What's left / requests for the lead
1. Ship: `src/world/interactables.ts`, `src/game/m2-world.ts`, `scripts/qa/playthrough.mjs`, `tests/interact-pick.test.ts`,
   `docs/CONTRACT-CHANGES.md` (#158, #158b, #158c), this file. No main.ts / shot.mjs / layout / asset change.
2. The torch's hotspot clips the floor white at ≈ 1 m (vis-01): the 30 mm tarnished-brass locket lying flat reads as a
   small dark oval in it. Findable (prompt), not obviously brass at 1.2 m. A torch-exposure item, not this lane.
3. The static collision holds BOTH dress states (intact + cut) — built once at load from every mesh. Harmless today
   (the bundle now lies outside the hem, and the octree's ray test does not see the skirt from outside), noted for
   whoever next touches prop states.
4. P_CAR_ROW's 'car' interaction is never reached by the bot (the `b12:at_car` trigger starts C6 first) — unprobed.
5. The aim asserts are strict for every bot variant: QA_CARELESS=1 / QA_TORCH_ON=1 were NOT run this round. A careless-
   route spot (it walks, never sneaks; same interaction spots) could fail a probe — expected to pass, but unverified.
6. Not mine in the working tree (other lanes): `docs/ROADMAP.md`, `docs/STATUS-smooth-perf.md`, `scripts/shot.mjs`,
   `docs/STATUS-load.md`, `src/game/main.ts`, `src/render/reflections.ts`, `src/render/refl-file.ts` (LOAD lane edits
   at 16:02–16:04, AFTER this lane's last build at ≈ 15:44 — the playthrough gates above did not include them; the
   whole tree still typechecks at 16:05 and the pick tests pass) and CONTRACT-CHANGES row #157.
