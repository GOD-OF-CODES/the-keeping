# STATUS — load FIXER (review findings F1, F2; 2026-10-20)

Lane: LOAD FIXER. Edits: `src/render/reflections.ts` (applyShipped dawn allocation, exportCubes `mips`), `src/game/main.ts`
(`canDeferWarm` opt-in, exportReflections `mips`), `scripts/qa/refl-export.mjs` (dawn run = `--beat B11` playthrough; `--verify`
dawn / night-again + C6 still; `--dawn-only`), `public/assets/{medium,max}/reflections.bin` (re-exported v2) + the three manifests
(`node scripts/assets.mjs --manifest`, no Blender), `docs/CONTRACT-CHANGES.md` rows 157i / 157j, this file. Fresh dist: **`scratch/dist-load-2`**. Scratch: `scratch/load/fix/`.
Nothing committed. Power: the laptop is on **battery** for this whole session (pmset: "Battery Power", 91 % discharging) —
so NO load-time number in this section is a valid measurement; correctness / visual checks only. Status: F1 and F2 fixed and re-checked the way the review found them.

| id | finding | fix | state |
|----|---------|-----|-------|
| F1 | shipped EXT dawn cube: hood / wet yard darker + blurrier C5 26.6 → C6 and in a B12 start | **Root cause was NOT the mip count** (the review's guess): with the dawn cube at 1 level (= runtime) the C6 + 20 s hood was still 57.4 vs 86.7 for the runtime path on the same build. Probe-by-probe zeroing at that frame (scratch/load/fix/c6diag.mjs): the hood reflects only EXT (EXT off → 22 on both paths); EXT is 1 level on both; the CONTENT differs: the shipped dawn was exported right after a bare `--beat B12` load (B12 gameplay state, no C5 mist in the yard) — the lower half of every side face 2–5× darker than the cube the live game captures on its own route (C5 26.6 dawn + mist). Fix: (1) the export's dawn run is now `--beat B11` + the strict playthrough (plays C5), reading the cube right after each of the story's own changes; both tiers re-exported; (2) dawn target allocated with 1 mip level (exact parity; < 4 luminance on its own). `refl-export --verify` gains the dawn / night-again pair (content, mip count, C6 + 20 s hood luminance) | **done**: C6 + 20 s hood Medium 88.9 (verify) / 85.0 (strict full playthrough) / 86.8 (`--beat B12` control) vs live 88.5 / 84.6–88.6 / 86.8; Max 88.5 vs live 87.9 |
| F2 | "Click to begin" came up 3.4–16 s before the game could start; an instant click got the loading bar back | the deferred warm-up is opt-in (`?deferwarm=1`); default = the live order (all warm-up before the prompt), so the prompt = playable and shot.mjs `load` = time to playable | **done**: prompt − playable = 0.0 s in all 3 loads (review's rv-load / rv-play: cold profile 15.0 / 15.0, warm profile 14.2 / 14.2, strict playthrough 75.7 / 75.7 — battery, see below) |

### F1 evidence (Medium unless stated; hood = mean luminance of x 340–1020, y 490–545 in the C6 + 20 s `c6-dawn-drive` still, 1280 px — the review's region; `scratch/load/fix/region.mjs` = the review's tool)
| run | dawn cube | hood |
|-----|-----------|-----:|
| live dist, full route (review) Medium / Max | runtime | 88.5 / 87.9 |
| live dist, `--beat B12` control (review) | runtime | 86.8 |
| builder's dist (review) | shipped v1, 8 mips | 56.2–62.0 |
| dist-load-2, mip fix only, `--beat B12` (stship) | shipped v1, **1 mip** | **57.5** — mip count was not the cause |
| same build, `?refl=capture`, `--beat B12` (stcap) | runtime | 86.7 |
| probe zeroing at that frame (c6diag ship / cap) | EXT off → 21.9 / 22.2; every other probe off → ±0.3 | the hood reflects EXT only; EXT 1 level on both |
| EXT content at that frame vs shipped v1 (rows top→bottom, face 0 / 1 / 4 / 5) | runtime 0.36 0.51 0.35 0.15 · 0.73 0.92 0.33 0.09 … vs shipped 0.30 0.33 0.12 0.07 · 0.65 0.51 0.07 0.01 … | the lower half (horizon, mist, ground) 2–5× darker in the shipped v1 |
| same build, `?refl=capture`, B12 export run where the precompile finished early (refl-medium-dawn #1) | runtime, captured in B12 gameplay state | 57.1 — the runtime B12 restore is itself a race (pre-existing) |
| **shipped v2** (B11 → C5 export), verify pair, Medium | shipped, 1 mip | **88.9** (runtime capture same run type: 87.0; dawn mip 0 rel 4.5 %, night-again 5.7 %, mips 1/1, 8/8) |
| **shipped v2**, verify pair, Max | shipped, 1 mip | **88.5** (runtime 86.5; dawn rel 4.2 %, night-again 5.2 %, mips match) |
Files: `scratch/refl/refl-{medium,max}-{vdship,vdcap}-02-c6-dawn-drive.jpg`, `scratch/refl/{medium,max}-verify-dawn-*.json`,
`scratch/load/fix/{c6diag.jsonl,all-ship.json,all-cap.json,verify-medium.log,verify-dawn.log}`. The 13 load-time cubes on
dist-load-2: shipped vs a fresh runtime capture worst rel 8.6 % (EXT; = the capture-vs-capture baseline 8.6 %), interior ≤ 1.4 %.

### F2 evidence + gates (all on BATTERY — the timings are NOT valid measurements, only the prompt = playable structure is)
| run | "Click to begin" s | playable s | notes |
|-----|-------------------:|-----------:|-------|
| rv-load item 1, Medium, fresh profile (scratch/load/fix/loads.jsonl) | 15.0 | 15.0 | Metal warm (mtl 0 CPU-s), shipped cubes, 0 stale |
| rv-load item 2, Medium, same profile reload | 14.2 | 14.2 | bank from IndexedDB; matches the review's AC playable median 14.3 s |
| strict playthrough, Medium, fresh profile (scratch/load/fix/play) | 75.7 | 75.7 | Metal-COLD (room warm-up 68.4 s: my `?refl=capture` export / verify runs and other lanes evicted the shared Metal cache) |
- Strict Medium playthrough on the fresh `scratch/dist-load-2` (plain start, seeded, scratch/load/fix/fx-play.mjs = the review's
  rv-play.mjs): B01 → B13, ended, 0 deaths, **26 / 26 assertions, 0 console errors / exceptions / warnings**, shipped cubes,
  dawn / night swaps fired; 13 runtime node builds after the start in 6 steps (C1 30 s 2, C1 66 s 4, C1 96 s 3, B03 1, C4c 1, B12 1)
  — the review counted the same pre-existing C0 / C1 shadow-pass class.
- `--beat B12` strict playthrough control: ended, 0 errors. typecheck ok · `npm test` 382 / 382 in 5 of 6 runs (one run had 1
  failure while a headless Chrome ran beside it; output not kept; 5 later runs clean — an unidentified timing-sensitive test) ·
  `npm run build` + verify-boot ok (12.7 KB gz) · `node scripts/assets.mjs --check` ok (Medium 56.07 / 60 MB, Max 107.48 / 120 MB).

### Requests for the lead (fixer)
1. **AC re-measure** (Medium / Max / Low, cold + warm, `rv-load.mjs` pairs): this whole session ran on battery. Expected from
   the review's AC data on the same load path: Medium warm playable ≈ 14.3 s, Max ≈ 28 s. Headline = playable, not prompt.
2. Ship the re-exported `public/assets/{medium,max}/reflections.bin` (v2) + the three manifests with the code. The builder's v1
   files are kept at `scratch/load/fix/{medium,max}-reflections.bin.builder` (do not ship them).
3. Tier assets are fetched by plain URL (`max-age=3600, stale-while-revalidate`): a content-only re-export that keeps the key
   (like v1 → v2) can be served stale for a while. v1 never went live, so nothing to do now; for later, fetch
   `reflections.bin?h=<manifest hash>` or bump `REFLECTIONS_VERSION` with any re-export.
4. Pre-existing race (live code, not this round): at a B12 restore the RUNTIME path's dawn cube depends on how long its async
   precompile takes (hood 57 when it lands in the B12 gameplay state, 87 when it lands in C6 — both seen on one build). The
   shipped cubes remove it (always the full route's cube); the `?refl=capture` fallback still has it.
5. The runtime dawn cube's single mip level is itself an accident of `CubeCamera.update` (faces 0–4 run with generateMipmaps
   off when the spare target is first allocated). Kept for parity; an 8-level dawn cube would be more physical (rough paint
   blurs) but is a look change → an art-director call, not a load fix.
6. The 15 % rel-mean / 8 % hood thresholds in `refl-export --verify` are from n = 2 per tier (passed with 4–6 % / 2.1–2.4 %
   margins), not a calibrated spread.
7. Re-run rule for the cubes is now: `node scripts/qa/refl-export.mjs` = per tier one default load (13 cubes) + one `--beat B11`
   strict playthrough through C5 / C6 / C7 (≈ 1.5 min Medium, ≈ 2 min Max wall after the load); `--verify [--dawn-only]` after.

**Correction of the builder's claims below:** "Visuals: reflection cubes bit-identical to a runtime capture" was true only for
mip 0 of the 13 load-time cubes; the shipped dawn cube's mip COUNT differed from the runtime one (F1), which the parity check
never covered. The headline "Click to begin" 9.9 / 11.4 / 17.7 / 13.5 s numbers were prompt times, not time to play; the
reviewer's AC numbers for time to playable on the builder's dist (scratch/load-rv/loads.jsonl, Metal cache warm) are
**Medium 14.3 s median, Max 28.0 s median** (vs live 25–30 s Medium / 110–121 s Max, the latter Metal-cold). With F2 the prompt
now appears at that playable moment (expected within noise of those numbers — not re-measured on AC this session).

---

# STATUS — load BUILDER (round "why is it taking so long to load", 2026-10-20)

Lane: LOAD BUILDER (runtime B + audio). Edits: `src/render/reflections.ts`, `src/render/refl-file.ts` (new),
`src/game/main.ts` (load path), `src/audio/offline.ts`, `src/audio/engine.ts`, `src/audio/bank-cache.ts` (new),
`src/materials/baker.ts`, `src/materials/bind.ts`, `scripts/qa/refl-export.mjs` (new), `tests/refl-file.test.ts` (new),
`public/assets/{medium,max}/reflections.bin` (new) + the three manifests (`node scripts/assets.mjs --manifest`, no Blender),
`docs/CONTRACT-CHANGES.md` rows 157b–157h, this file. Reviewer dist: **`scratch/dist-load`** (final tree = HEAD d9503b1 + this lane). Scratch:
`scratch/load/{b1,b4,b12,play,runs}`, `scratch/refl/`. Nothing committed.

## Result (Medium unless stated; M1, AC power; "Click to begin" = shot.mjs `load` = Start → __game)
| case | before (lead / investigator) | after | source |
|------|------------------------------|-------|--------|
| warm repeat visit (same profile, Metal cache warm) | 25–30 s (lead, idle machine) · 55–66 s (investigator, memory pressure) | **"Click to begin" 9.9 / 11.4 s**; an instant click starts C0 at 13.4 s (held 3.6 s) | rthold2, mF#2 |
| first visit, fresh profile, Metal cache warm | 25–30 s | **10.4 / 11.2 / 13.3 s** (+ 5–6 s behind the prompt) | rthold1, b4-smoke, mF#1 |
| first visit, Metal cache partly cold | 100–103 s (evicted, lead) · 210–278 s (fully cold, investigator) | 50–87 s (100–160 CPU-s of Metal compile) | mC#1, play-final, blocked |
| Max warm repeat | none measured (110–121 s were cold) | **17.7 s** (13.1 s fresh-profile run, Metal warm) | mF#4, max-final |
| Low warm repeat | 22.8 s | **13.5 s** | mF#6 |
| GPU-process peak memory (Medium / Max) | 4.26 / 5.50 GB | **2.3–2.9 / 3.4–4.2 GB** | sampler footMB, mC / mF |
| programs compiled per Medium load (running total at ready) | 1 052 (464 of them cube-context) | **651** (−401 ≈ −1.1 GB at 2.8 MB / program) | perf lines |

Targets: warm ≤ 10 s — **met in one run (9.9 s), missed in the other (11.4 s)**: the opening set alone is 6–7.4 s of node
builds on this machine. Cold ≤ 18 s — **met only while the Metal shader cache is warm** (10–13 s); a Metal-cold first visit is
still compile-bound (≈ 650 programs × ≈ 0.33 compile-CPU-s through Chrome's ≈ 2-wide compiler ≈ 100 s+) and cannot reach 18 s
this round. Max ≤ 25 s warm — **met (17.7 s)**. "No load over 2× the median" — **not met** while other headless runs keep
evicting the shared Metal cache (Medium 9.9 – 87 s in this round, all explained by MTLCompilerService CPU); the cut from 1 052
to 651 programs per Medium load shrinks the penalty of an eviction but does not remove it.
Visuals: reflection cubes bit-identical to a runtime capture (below), audio bit-identical (same renderRecipe), material
maps identical (same passes; only the readback fence moved). Nothing renders during a visible frame that did not before.

## Builder plan / progress (biggest win first)
Final timing session (one lock hold, scratch/load/runs/mF-*; `node scratch/load/items.mjs mF`):
| item | preset | profile | "Click to begin" s | rest behind it s | opening warm s / builds | mtl CPU s | GPU peak MB |
|------|--------|---------|-------------------:|-----------------:|------------------------:|----------:|------------:|
| mF#1 | Medium | fresh | 13.3 | 6.0 | 7.3 / 414 | 0 | 2 535 |
| mF#2 | Medium | warm | **11.4** | 5.5 | 7.4 / 414 | 0 | 2 293 |
| mF#3 | Max | fresh (first Max) | 57.9 | 40.2 | 50.2 / 416 | 100 | 3 357 |
| mF#4 | Max | warm | **17.7** | 9.4 | 10.7 / 416 | 0 | 3 552 |
| mF#5 | Low | fresh (first Low) | 50.2 | 34.0 | 43.1 / 470 | 86 | 1 463 |
| mF#6 | Low | warm | **13.5** | 6.9 | 9.8 / 470 | 0 | 1 490 |

| # | Item | State |
|---|------|-------|
| B1 | Shipped reflection cubes (13 load-time cubes + EXT dawn + EXT night-again, mip 0 RGB half, gzip) written INTO the existing CubeRenderTargets + three's own mip generation; no runtime capture / prewarm / in-game re-capture when the key matches; fallback = today's runtime path | **done (code + Medium file)**: `src/render/refl-file.ts` (format), `reflections.ts` applyShipped / exportCubes / swapShipped, main.ts load path, `scripts/qa/refl-export.mjs`. Medium `public/assets/medium/reflections.bin` 4.87 MB (8.85 MB raw), key bfc5484f5bf7c910. Medium story phase 10.9 s / 660 builds / 464 programs → **2.0–3.0 s / 0 builds / 0 programs** (b1-ship, bA1); total programs at ready 1052 → 650. Max export running. |
| B2 | Audio prerender in a worker pool (bit-identical renderRecipe), variation pass stays on main | done: 3 workers on the M1 (`hardwareConcurrency − 5`, ≤ 2 extra + the lazy-sound worker). Wall 4.1 s → **2.3–2.9 s** (b4-smoke 2.26, mF#1 2.49, blocked 2.28; bA1's 4.2 s was under Metal-compile load) and the main thread is free for parse / materials |
| B3 | Material bakes: no serial readback fence per material (measure targets per bake, readbacks awaited at the end) | done: materials phase 2.2–2.7 s → **1.16 s** (bA1; 82 bakes 306 ms wall after the 0.77 s generator precompile) |
| B3b | Audio bank in IndexedDB (key = the audio chunk's content-hashed URL + rate + variant cap; dev never caches) | done: repeat visit reads the bank (mC#2: `[audio] bank from the browser cache … 1027 ms`, in parallel with the level load); throwing-getter guard added after mC (rebuild) |
| B3c | Loading-overlay weights rebalanced (compile 7 → 37, probes 14 → 2, materials 20 → 8, audio 10 → 6) | done |
| B4 | Deferred warm-up behind "Click to begin" (hold variant: the rest — interior rooms, tableau, car row, cs-shots — runs while the prompt is up, canvas hidden, loop idle; the story / C0 starts only after it; an earlier click / unpause is held with the loading bar shown again). No work ever runs during a visible frame. Off for ?beat / ?spawn / ?scene / ?deferwarm=0 | **done**: rthold2 (warm repeat, instant click): "Click to begin" **9.9 s**, C0 starts 13.4 s (held 3.6 s); real-time C0 → C1 → B02 59.9 fps, 0 cutscene-guard trips, the same 9 runtime builds as the no-defer and HEAD-equivalent runs (all pre-existing shadow-pass builds of road props, see below) |
| B5 | Gates: typecheck, test, build, assets --check, strict Medium playthrough to B13 on scratch/dist-load, cold/warm load table | **done**: typecheck ok · npm test 382/382 · npm run build + verify-boot ok (12.7 KB gz boot) · assets --check ok (Medium 56.1 / 60 MB, Max 107.5 / 120 MB) · storage BLOCKED load (scratch/load/blocked.mjs: indexedDB / caches / localStorage getters throw) → ready, audio synthesized, 0 errors / 0 warnings · strict Medium playthrough on the FINAL scratch/dist-load (scratch/load/play/play-final-*): B01 → B13, ended, 0 deaths, 26 / 26 assertions, 0 console errors / exceptions, shipped cubes used and the dawn / night swaps fired in C5 / C6b (an earlier run on the pre-LOOK-key dist: same, play-medium-*) · Max smoke on the final dist: shipped cubes, 0 errors · WebGL2 fallback smoke on the final dist (`--backend webgl`): "Click to begin" 69.2 s (WebGL compiles synchronously), rest 36.5 s behind it, 0 errors / exceptions |
| B6 | LOOK values in the cubes' key (any look tuning makes the shipped cubes stale → runtime capture, never old light); key computed once at load; both tiers re-exported (Medium key a9ef73db4c47e5a8, Max 615bce7fec94f794) | done |

### B1 parity (node scripts/qa/refl-export.mjs --verify medium; scratch/refl/medium-verify-*.json)
- Shipped path: the 13 uploaded cubes read back (mip 0) are **bit-identical** to the export's capture (13 / 13 cubes, every half).
  The mip chain is three's own generator on the same texture (as after a capture).
- The runtime capture itself is not repeatable: a fresh `?refl=capture` load differs from the export's capture by 0–1 % (rel.
  mean) in the interior cubes (candle flicker phase at capture time) and 4.8–7.4 % in RC9 / CAR / EXT (sky / rain / lightning
  state); shipped-vs-capture is exactly that same spread. So the shipped cubes are one instance of what the runtime would capture.
- B12 (scratch/load/b12/b12-ship vs b12-cap): `[reflections] EXT → shipped dawn cube (swap, no re-capture)` fires at the same
  story moment the runtime path logs `re-captured EXT (dawn sky…)`; the two hall frames look the same (candle flicker / exposure
  phase aside).

### Builder runs (seq.mjs / sampler; `mtl` = MTLCompilerService CPU s in the load window = how cold the Metal cache was)
| run | what | load s | story s | warm-up s | materials s | audio s | mtl CPU s | notes |
|-----|------|-------:|--------:|----------:|------------:|--------:|----------:|-------|
| b1-ship | Medium, shipped cubes, fresh profile | 109.8 | 1.96 (0 builds) | 103.6 | 2.19 | 4.9 (main) | (not sampled) | Metal cold (other lanes' runs evicted it): warm-up 61 s + 42 s flush |
| bA1 | Medium, + workers + bake pipelining, fresh profile | 89.6 | 2.97 (0 builds) | 83.7 | 1.16 | 4.2 (3 workers) | 157 | cold-ish (another lane's Chrome ran just before) |
| bA2 | same profile, repeat | 161.5 | 1.62 | 153.6 | 3.73 | 3.3 | 274 | cold AGAIN + 426 k swap-outs: another lane's run landed between bA1 and bA2 → use multi.mjs (one lock hold) for pairs |
| **mC#1** | Medium, B1–B3b, FRESH profile (one locked session, scratch/load/runs/mC-*) | **86.6** | 2.0 | 82.2 | 1.0 | 2.9 (3 workers) | 158 | partly Metal-cold (other lanes' runs evicted it); GPU-process peak 2.88 GB |
| **mC#2** | Medium, same profile reload (warm repeat) | **17.8** | 0.74 | 15.2 | 0.87 | bank from IDB | **0** | fully warm Metal; GPU-process peak **2.85 GB** (investigator's warm Medium: 4.26–4.36 GB) |
| **mC#3** | Max, same profile (first Max) | **117.6** | 1.1 | 111.7 | 1.6 | IDB | 216 | partly Metal-cold (investigator: Max cold 255–416 s); GPU peak 4.23 GB |
| **mC#4** | Max, reload (warm repeat) | **18.6** | 0.72 | 15.0 | 1.4 | IDB | **0** | first warm Max number ever: **18.6 s ≤ 25 s**; GPU peak 4.16 GB (was 5.50) |

| b4-smoke | Medium, + B4, fresh profile, warm Metal | **11.2** ("Click to begin") | 1.56 | opening 6.1 | 0.77 | 2.3 (3 workers) | — | rest 5.06 s behind the prompt; builds 414 + 369 = 783 (780 before the split) |
| rthold1 | + B4, fresh profile, instant click | 10.4 → C0 at 13.9 (held 3.5) | | | | | — | real time C0 → C1 → B02: 59.9 fps, 3 frames > 33 ms (C1 72.2 100 ms, C1 71.9 50 ms, first frame 33 ms), 10 builds (9 pre-existing + 1 exposure-meter) |
| rthold2 | + B4, same profile (warm repeat), instant click | **9.9** → C0 at **13.4** (held 3.6) | | | | IDB | — | 5 frames > 33 ms (C1 73.3 100 ms; others 33 ms), 9 builds, 0 trips |
| rthold-nodefer | `?deferwarm=0`, same profile | 81.5 (Metal-cold again) | | | | | — | 4 frames > 33 ms (C1 13.75 217 ms), the same 9 builds |
| rthold-head | `?deferwarm=0&refl=capture` (= HEAD's path) | 147.1 (cold cube context) | | | | | — | **10** frames > 33 ms (C1 13.75 217, first 183, C1 35.7 / 74.8–75.0 50 ms), the same 9 + 1 builds → the C0 / C1 runtime builds and the C1-end hitches are PRE-EXISTING |

Pre-existing (not this lane, found while checking): C0 / C1 build 9 shadow-pass programs at runtime in every variant (HEAD
included): `ShadowMaterial` of P_RC9_CR9_B county shield, reflector_post, P_RC9_NEXT_SERVICES road card, logging_truck hi_r /
hi_l / clearance, deer head ×2, P_CAR_INTERIOR radio_vfd (C0 1.23 / 23.62, C1 6.28 / 30.22 / 30.27 / 37.82 / 63.21) — 1 build each,
no frame > 33 ms at those times; and C1's last 3 s (72–75) have 50–100 ms frames in every variant.

mC#2 warm-up steps (warm Metal, this machine under memory pressure): opening set EXT1 3.1 + EXT2 0.9 + car-set 1.6 + rc9 2.1 +
rc9-road 0.55 + cs-prewarm 0.12 = **8.4 s**; interior + later G1 1.2, G3P 0.5, U1 1.2, tableau 1.05, cs-shots 1.9 … = **5.7 s**.




### What is left / honest gaps
- Warm Medium sits at 10–11.5 s, not reliably ≤ 10: the opening set (EXT1 ≈ 2.3–3.1 s / 179 builds, car-set 1.1–1.6 / 89,
  rc9 1.5–2.1 / 97, EXT2, rc9-road) is ≈ 414 TSL node builds on the main thread. Moving more of it behind the prompt would only
  lengthen the hold for a quick clicker (metric, not player, gain) — not done. Next real lever: fewer / cheaper programs.
- The deferred part saves a player exactly min(click delay, ≈ 5–6 s warm); an instant click waits on the loading bar (held
  start). Metal-cold, the hold is 25–40 s (it is honest loading, shown as the loading bar).
- Metal-cold first visits are still compile-bound (50–87 s here). Only fewer programs fix that.
- shot.mjs (lead-owned) waits ≤ 240 s for the loading overlay to go before it unpauses; the deferred part was ≤ 40 s here (Metal-cold Max) but a fully cold Max warm-up has been 316 s — past 240 s shot.mjs would unpause into the held start (`advance()` waits correctly; a scenario that only `qa.wait`s and screenshots would capture the loading bar).
- Pre-existing (all variants incl. HEAD): 9 runtime shadow-pass builds in C0 / C1 (road props, truck, deer, radio VFD) and
  50–100 ms frames in C1's last 3 s.
- Re-run rule for the shipped cubes (also in refl-export.mjs / contract 157b): data + LOOK changes → the game captures at
  runtime and logs "shipped cubes are stale"; code changes the cubes see → bump `REFLECTIONS_VERSION`; then
  `node scripts/qa/refl-export.mjs` (per tier: a default load + a `--beat B11` playthrough — see the fixer's request 7) + `node scripts/assets.mjs --manifest`.

### Requests for the lead
1. Ship `public/assets/{medium,max}/reflections.bin` + the three manifests with the code (they are keyed to this tree's
   level files + LOOK; a mismatch only costs the old runtime capture). Consider `"reflections": "node scripts/qa/refl-export.mjs"`
   in package.json scripts next to `probes`.
2. Add the cube export to the ship checklist after any lighting / material / LOOK change (as probes).
3. This machine's Metal shader cache is shared by every agent run and the user's Chrome: every `?refl=capture` export or
   other-dist QA run evicts the user's compiled game shaders → the user's next load is cold again. Fewer distinct dists, or a
   one-off clear of `$(getconf DARWIN_USER_CACHE_DIR)/com.google.Chrome.helper/com.apple.metal` (user's call).
4. `tests/refl-file.test.ts` is in lane C's folder (contract 157h).
5. Base: HEAD d9503b1 (locket hotfix) + this lane's files + the investigator's shot.mjs `--profile/--port` (#157); `docs/STATUS-smooth-perf.md` is another lane's edit.

---

# STATUS — load investigator (round "why is it taking so long to load", 2026-10-20)

Lane: LOAD INVESTIGATOR. Edits: `scratch/load/**`, this file, `scripts/shot.mjs` (`--profile` option only, contract row
#157). Dist under test: `scratch/dist-load` (built from HEAD 308851e). All absolute numbers are tagged with the power
state; the laptop was on **battery** when this round started (68 %, discharging).

## In short (why every load is slow on this machine)
1. **Shader recompiles.** macOS keeps ONE Metal shader cache for Chrome's GPU helper, shared by every Chrome profile
   (the user's own Chrome and every agent's headless run). It is saturated (6.5 GB, files at their cap, overwritten in
   place), so every QA run of another preset / dist / lane — and every deploy that changes shaders — can evict the
   game's compiled shaders. The next load then recompiles ≈ 1 500 programs through a compiler that Chrome's GPU
   process drives only ≈ 2 at a time: Medium 100–280 s instead of 25–30 s. A first-time visitor always pays this
   (cold Medium 210–278 s, cold Low 107 s, Max 255–416 s on this M1, headless).
2. **Memory.** The game alone peaks at GPU process 4.3 GB + renderer 2.0 GB on Medium (5.5 + 2.4 GB Max), ≈ 2.8 MB per
   compiled program; on an 8 GB M1 next to the user's own Chrome (≈ 7 GB) even fully warm loads swap and double
   (55–66 s here vs the lead's 25–28 s).
3. **Warm floor.** With every cache warm the load is CPU-bound on ≈ 1 440 three.js TSL node builds on the main thread
   (25–30 s Medium, 22.8 s Low); 10 s of it is the reflection-cube capture, 4 s the audio prerender.
Everything below is the evidence and the ranked plan.

## Plan / progress
| # | Item | State |
|---|------|-------|
| 1 | Reproduce the variance (M, M, X, M … on one dist; cold vs warm profile) with a 1 Hz CPU / swap / Metal-cache sampler | done (s1 5 runs, s2 5 loads, s3 3, s4 3; 16 loads) |
| 2 | Root cause of 100 s vs 25 s Medium, and of the 0-build multi-second warm steps | done: saturated shared Metal cache + 2-wide compiler (stacks, sampler); 0-build steps = JS blocked in writeBuffer behind a sync GPU-main-thread compile (profile + stacks) |
| 3 | Critical path to the first playable moment (Click to begin → C0 30 s → C1 75 s → B02) | done (note: the task's "Click to turn the key" is C6's key prompt; the first playable moment is "Click to begin" → C0 → C1 → B02) |
| 4 | Size + regeneration cost of every cacheable output (audio, textures, reflections, probes, lightmaps) | done (IDB costs measured) |
| 5 | Ranked plan with seconds saved (cold first visit, warm repeat, variance) | done (below) |
| 6 | Low cold / warm | done: Low cold 107.3 s, warm 22.8 s (s4); Max warm: NOT measured |

## Findings so far (from the lead's logs, before any new run)
- The slow runs are exactly the runs whose PREVIOUS run used a different preset (lead-release: rt-max → medium 102.7 s;
  low → careless 100.5 s; lead-ship5: low → careless 102.1 s). The next same-preset run is fast (careless → torch 26–30 s).
- Same build counts in slow and fast Medium runs (story 660, warm-up ≈ 750–780); the slow run spends seconds in
  0-build steps (U3 4.7 s, cs:C2b 6.5 s, cs:C4a 7.4 s, rc9 17.9 s with 79 builds vs 1.8 s fast).
- The synth worker's lazy-sound warm finishes in 8.5 s in every slow run but 22–26 s in every fast run (after ready):
  during slow loads the main thread is NOT saturating the CPU — it is waiting.
- Chrome's GPU-helper Metal shader cache (`$(getconf DARWIN_USER_CACHE_DIR)/com.google.Chrome.helper/com.apple.metal`)
  is 6.5 GB in rotating ~1.1 GB generations, shared by every Chrome profile (headless runs AND the user's own Chrome).
- shot.mjs makes a fresh profile per run, so no measurement so far used Chrome's per-profile WebGPU cache
  (`Default/DawnWebGPUCache`) — every lead number is "fresh profile".

## Runs (scratch/load/runs/<label>-report.json + -samples.jsonl; summary.jsonl; dist scratch/dist-load, fresh profiles)
`mtl` = CPU seconds of every MTLCompilerService during the load window (Start → ready) = Metal compile work done;
`ren` = renderer process CPU s (main thread + synth worker); swap = system swap used, MB.

| run | preset (previous run) | load s | story / warm-up s | capture s | mtl CPU s | ren CPU s | swap MB | power |
|-----|-----------------------|-------:|------------------:|----------:|----------:|----------:|--------:|-------|
| s1-M1 | Medium (agent runs before) | 54.9 | 22.1 / 26.1 | 15.7 | 0 | 72 | 5380→8178 | batt |
| s1-M2 | Medium (Medium) | 66.3 | 29.3 / 31.1 | 19.1 | ≈0 | 89 | 7748→9118 | batt |
| s1-X1 | Max (Medium) | **254.6** | 21.9 / 224.9 | 9.5 | **356** | 85 | 8886→10888 | batt |
| s1-M3 | Medium (**Max**) | **269.1** | 85.6 / 173.1 | 42.2 | **368** | 148 | 6105→7776 | batt→AC |

**s1-M3:** right after a Max load, Medium was cold again — it recompiled everything (368 CPU s of MTLCompilerService,
same as a cold Max) and took 269 s instead of 55–66 s. Who evicted it (the Max compile, another lane's run, or the
user's own Chrome, whose GPU process was not yet sampled in s1) cannot be separated; the durable finding is the
mechanism shown under s2 (the cache is at its cap and overwrites in place).
The Metal cache is per macOS user + Chrome GPU-helper bundle, shared by every Chrome profile, the user's own Chrome and
every agent's headless shot.mjs run. So on THIS machine, any QA run of another preset or another dist turns the user's
next load of the live game into a cold compile.
**Confound:** the user's own Chrome (GPU process 4.9 GB, 3.6 GB compressed, restarted ~14:16 with
gpu-recent-crash-count=1, plus a 2.3 GB renderer) holds most of the 8 GB, so even warm loads swap 2–4 GB and run ~2× the
lead's 25–28 s.

### s2 (one shot.mjs session, one profile, in-page reloads: scratch/load/multi.mjs; items.mjs)
| item | preset | profile | load s | story / warm-up s | mtl CPU s | GPU-process footprint peak | renderer peak |
|------|--------|---------|-------:|------------------:|----------:|---------------------------:|--------------:|
| s2#1 | Medium | fresh | 108.1 | 36.1 / 51.6 | 1.3 | 4255 MB (3.0 GB compressed) | 2000 MB |
| s2#2 | Medium | warm (reload) | 121.2 | 64.6 / 40.4 | 0.6 | 4283 MB | 2002 MB |

- Warm Metal cache (mtl ≈ 0) and STILL 108–121 s: on this machine right now the load is memory-bound. One Medium load
  takes the headless GPU process to **4.26 GB** physical footprint and the renderer to **2.0 GB** (≈ 6.3 GB of the
  8 GB) — 6.6–6.8 GB swapped out per load, memory pressure level 2 (warn) throughout. three's own counters
  (`renderer.info.memory`, s1-M1 report) are only 834 MB on Medium (textures 723 MB, 352 textures / 170 RTs,
  1055 programs) and 1.93 GB on Max (textures 1.82 GB): ≈ 3.4 GB of the GPU process is per-pipeline browser state
  (Dawn + Metal PSOs / compiled shader binaries). The footprint grows with compiles, not textures: 0.5 GB after the
  level load → 2.6 GB at the end of the reflection capture (464 programs) → 4.26 GB at ready (1052 programs).
- The per-profile Dawn cache does not make a warm repeat visit faster (s2#2 121 s vs s2#1 108 s, both mtl ≈ 0).
- Warm-load CPU profile (scratch/load/runs/s2-2-medium.cpuprofile, `node scratch/load/cpuprof.mjs`): main thread
  busy 116 of 122 s — three.webgpu JS 73.2 s (NodeBuilder build / _getChildren / getDataFromNode / analyze /
  generate), GC 14.0 s, idle only 6.1 s, all native WebGPU calls 6.5 s (copyExternalImageToTexture 1.8 s,
  createShaderModule 0.7 s), audio synth on the main thread 3.5 s (js:synth 2.3 + js:engine 1.1). With warm shader
  caches the load is CPU-bound on ≈ 1440 TSL node builds (≈ 15 ms each unloaded, ≈ 50 ms under swap).
- GPU-process native stacks (`sample`, scratch/load/stk-test/gpu.txt): Dawn's async pipeline workers
  (ThreadPoolForegroundWorker ×6) sit in `-[MTLDevice newLibraryWithSource:]` → `XPCCompilerConnection::BuildRequest`
  → `__DISPATCH_WAIT_FOR_QUEUE__`, queued behind **two** serial "compiler request queue" threads that each wait on an
  XPC reply from MTLCompilerService. Chrome's GPU process compiles at most ≈ 2 shaders at once whatever three asks
  for — measured MTLCompilerService parallelism 1.4 (s1-X1: 356 CPU s over 252 s).
| s2#3 | Max | warm (Medium) | **416.4** | 141.4 / 239.2 | **479** | 5498 MB | 2399 MB |
| s2#4 | Medium (after the Max) | warm | 57.8 | 22.5 / 28.9 | 1.3 | 4355 MB | 2157 MB |
| s2#5 | Medium | warm | 54.6 | 24.7 / 24.8 | 0 | 4353 MB | 3041 MB |

- Max cold: 416 s, 479 CPU s of Metal compiles, capture 72 s + dawn prewarm 64 s, G2 69 s with 14 builds, 17 GB
  swapped out; the user's Chrome GPU process burned 161 CPU s in the same window (it competes).
- This time the Max compile did NOT evict Medium (s2#4 mtl 1.3 s), unlike s1 (s1-M3 368 s). Mechanism
  (`ls -laT …/com.apple.metal/{16777235_322,32024}`): the Metal library cache is SATURATED — `libraries.data` 1.150 GB and
  `libraries2.data` 1.171 GB sit at their cap and did not grow while s2#3 compiled 479 CPU s; only the `.list` indexes
  changed (libraries2.list +80 KB) — new entries overwrite old ones in place. 6.5 GB of stale shader versions from
  months of agent runs fill it, so whether the CURRENT Medium shaders survive a Max / other-dist / other-lane compile
  depends on where they land. That is the variance: same dist, 25–66 s when they survive, 100–270 s when they don't.
- Memory model (fits s1/s2): GPU-process footprint ≈ 0.6 GB + textures + **≈ 2.8 MB per compiled program**.
  Medium 1052 programs ≈ 2.9 GB + 0.72 GB textures ≈ 4.3 GB (measured 4.26); Max 1119 programs + 1.82 GB textures ≈
  5.5 GB (measured 5.50). The 464 cube-context programs of the reflection capture alone ≈ 1.3 GB.
- Warm floor on this machine today: 55–58 s Medium (s2#4/#5), 2× the lead's 25–28 s: the user's Chrome (≈ 7 GB) +
  our 6.3 GB → 2.8–3.7 GB swapped out per load even with no compiles.
- The user's own Chrome GPU process used 27.6 / 40.1 CPU s during s2#1 / s2#2: it is actively rendering (likely the
  game or another WebGPU tab) while we measure.

### s3 (salted COLD dist scratch/dist-cold7101 = a first-time visitor's shaders; profile kept in scratch/load/prof-s3)
| item | what | load s | story / warm-up s | mtl CPU s | GPU / renderer peak |
|------|------|-------:|------------------:|----------:|--------------------:|
| s3#1 | Medium, cold (fresh profile) | **278.4** | 130.4 / 120.3 (materials 24.7, capture 90.2, dawn prewarm 39.3) | **502** | 4.3 / 1.9 GB |
| s3#2 | Medium `?refl=0` (new shader variants → cold again) | 109.8 | 2.1 / 103.4 (613 programs) | 196 | 6.6 / 3.0 GB |
| s3#3 | Medium again | (592.5 — INVALID, see below) | | 0 | 10.2 / 4.0 GB |

- Caveats: (1) the 2-wide compiler was observed in a HEADLESS Chrome GPU process; if a foreground window's GPU process
  gets more compiler connections, every cold number scales down proportionally — the ranking does not change (the
  user's browser must not be opened to check). (2) The salted dist adds one dead `discard` branch per fragment shader
  (and an early return per vertex shader); per-program compile cost should be within noise but is unverified.
- **A first visit is bound by Metal compile throughput.** MTLCompilerService cores busy (sampler, s3#1): 1.84 in the
  story phase, 1.89 in the warm-up, 1.22 in materials; 502 compile-CPU-s / ≈ 1.9 ≈ 265 s ≈ the 278 s load. Split of
  the compile work: story (reflection cube context: capture + dawn prewarm) ≈ 241 CPU s (48 %), warm-up ≈ 225 (45 %),
  material generators ≈ 33 (7 %). Rearranging awaits cannot beat this; only compiling less before "ready" (or cheaper
  shaders) can.
- **What the 0-build multi-second steps wait on** (cold CPU profile scratch/load/runs/s3-1-medium.cpuprofile,
  `node scratch/load/stepprof.mjs scratch/load/runs/s3-items.json 1 <profile>`): the main thread is NOT idle in them —
  it is blocked INSIDE WebGPU calls: three's `updateBinding` (= `queue.writeBuffer`) 78.5 s self in the warm-up (rc9
  40.5 of 43.9 s, cs:C2b 9.6 of 9.9 s, rc9-road 10.3 of 10.9 s), `_copyBufferToTexture` (writeTexture) 6.4 s,
  `copyFramebufferToTexture` 3.3 s, `_getDefaultRenderPassDescriptor` (getCurrentTexture) 1.6 s, "(program)" 10.7 s
  (U3 7.8 of 8.1 s). The capture phase instead is 94 % idle (awaiting deferred compiles). Mechanism (CONFIRMED with native stacks in s4, cold salted dist
  scratch/dist-cold7102, sample at t+181 s = inside `warm rc9-road` 10.8 s / 8 builds; scratch/load/stk-s4/):
  the GPU process main thread (CrGpuMain) spends 1233 of 2391 samples (52 %) in a SYNCHRONOUS
  `-[MTLDevice newLibraryWithSource:]` (XPC reply wait 391, waiting for compiler-queue ownership 278, waiting on another
  thread's identical in-flight compile 563), and the renderer main thread spends 1242 of 1915 samples in a blocking
  `mach_msg` receive UNDER V8 JIT frames (a JS-called native binding waiting on a sync reply — not the idle run loop).
  So: render() inside a warm step creates the pipelines compileAsync did not cover (shadow passes …) SYNCHRONOUSLY;
  the GPU process serves them behind the 2-wide compiler queue that the deferred async compiles already fill, the
  renderer's command transfer buffer fills, and the next writeBuffer blocks the JS thread.
- s3#3 is an artefact: items 2–3 navigated with `location.search` (new history entry) and the GPU process never
  released the previous page (4.3 → 6.4 → 10.2 GB; the renderer then thrashed at ≈ 5 cores of page-fault CPU). With
  `location.reload()` (s2) it released every time (back to 0.3–1.3 GB). The game itself never navigates (reload only),
  so this does not hit players; it does argue for a `pagehide` teardown (renderer.dispose / device.destroy) as cheap
  insurance (cause — bfcache or other — not proven).
- Persistent storage costs (headless Chrome, this disk; scratch/load/idb-bench.mjs, s3 report `idb`): IndexedDB
  71.3 MB in 314 Float32Arrays write 251 ms / read **90 ms** (+ 26 ms to rebuild 314 AudioBuffers); 13 MB of cube data
  write 47 / read 49 ms; 289 MB write 558 / read 447 ms; Cache Storage 71 MB write 561 / read 618 ms (IDB is faster).
  Quota 10 GB, not persisted. Chrome's own per-profile `DawnWebGPUCache` = 24 MB after three Medium loads (holds no
  Metal binaries — it does not save a cold Metal compile).

## Verdicts on the lead's candidates
| candidate | verdict | evidence |
|-----------|---------|----------|
| Chrome GPU-process compile queue (Metal compiles not done) | **YES — the primary cause of every slow / cold load.** On a Metal-cache miss every pipeline compiles through ≈ 2 serial "compiler request queue"s (XPC to MTLCompilerService); loads are compile-bound (1.84–1.89 compiler cores busy, 502 CPU s → 278 s cold Medium). Misses happen because the shared Chrome-helper Metal cache is saturated (6.5 GB, files at their ≈ 1.15 GB cap, overwritten in place), so other presets / dists / lanes / the user's Chrome evict the game's shaders unpredictably. | sampler (mtl CPU per run), `ls -laT` of the cache, `sample` stacks (stk-test, stk-s3, stk-s4) |
| GPU memory pressure / swapping (Max ≈ 2 GB) | **YES — an independent ×2 multiplier, even warm.** The game alone peaks at GPU 4.3 GB + renderer 2.0 GB on Medium (5.5 + 2.4 GB Max; three's own counters: 0.83 / 1.93 GB); ≈ 2.8 MB of GPU-process memory per compiled program. With the user's Chrome holding ≈ 7 GB, warm Medium loads swap 2.8–6.8 GB and take 55–121 s vs the lead's 25–28 s. | sampler `top` footprints, `renderer.info.memory` |
| Audio synth worker competing for CPU | **NO.** Its early finish in slow runs (8.5 s vs 22–26 s) is a SYMPTOM: the main thread was idle-waiting, so the worker's result was handled promptly. Prerender (main thread) is 3.5–4 s of the critical path on warm loads. | lead logs, warm CPU profile (js:synth 2.3 + js:engine 1.1 s) |
| Awaits on readbacks / onSubmittedWorkDone | **Minor.** gpu drain 19–92 ms; the materials phase is 28 % idle warm (82 sequential albedo readbacks ≈ 2 s). | warm CPU profile |
| deferCompileWaits (main.ts ≈ 192–209) | **Not the cause, but it shapes the stall.** It fires hundreds of async compiles; render() inside each warm step then creates the uncovered pipelines (shadow passes …) SYNCHRONOUSLY, those queue on the GPU main thread behind the async backlog, the command transfer buffer fills, and JS blocks in `queue.writeBuffer` (`updateBinding` 78 s self in the cold warm-up) = the "0-build multi-second" steps. Total time is unchanged (still compile-bound) but this is exactly what would freeze a cutscene if compiles ran in the background. | cold CPU profile + stacks (s3, s4) |

## Cold vs warm (Medium) — what each number is
| case | load s | source | caveat |
|------|-------:|--------|--------|
| cold first visit (fresh profile, no shader in any cache) | **278.4 / 210.3** | s3#1 / s4#1 (salted dists), AC | moderate swap (2–3 GB); headless |
| evicted repeat (same dist, shaders evicted) | 100–103 (lead, AC) · 269 (s1-M3, swap) | lead-release medium / careless; s1-M3 | — |
| warm, fresh profile (Metal cache warm) | 25–30 (lead) · 55–66 (mine) | lead-ship5 medium/torch; s1-M1/M2, s2#4/#5 | mine are all under the user's-Chrome memory pressure — none from an idle machine |
| warm, same profile (Dawn cache + HTTP cache + storage warm) | 121 (s2#2) · 57.8 / 54.6 (s2#4/#5) | multi.mjs reloads | no faster than fresh-profile warm: the per-profile Dawn cache (24 MB) saves nothing measurable |
| Max cold / partly cold | 254.6 (s1-X1) · 416.4 (s2#3) | | **no warm Max measurement exists** (the lead's 110–121 s all followed a Medium run) |

## Critical path to the first playable moment
"Click to begin" (game ready) → click → C0 (30 s title cinematic; 0–4.0 s black under the date card) → C1 (75 s drive,
car set + County Road 9 + the gate) → B02 gameplay at EXT1/EXT2 (gate → porch) → B03 the house (G1 hall) → C2 …
- Needed before the click: level download + parse (61 MB Medium / 113 MB Max / 31 MB Low + 6.6 MB voice), the generated
  materials, the opening audio, story runtime, the EXT + car-set reflection probes, and the opening warm steps EXT1,
  EXT2, car-set, rc9, rc9-road, cs-prewarm (378 of ≈ 1440 builds).
- Deferrable to the background during C0 + C1 (105 s of cinematic) / B02: the house-interior rooms (G1 … U4T), the
  tableau / tableau-hall (C2), car-row (C3), cs-shots (C2b … CR), the 11 interior reflection probes, and the dawn /
  night re-capture prewarm (needed first at C5, ≈ 20 min in).
- Measured split (scratch/load/critpath.mjs): lead fast Medium 28.2 s = story 10.9 (capture 7.9, dawn prewarm 2.2) +
  warm 13.0 (opening 6.8 s / 378 builds, interior + later 6.1 s / 400 builds); lead slow 102.7 s = story 28.0 + warm
  70.3 (opening 29.4, later 32.7); cold s3#1 278 s = materials 24.7 + story 130.4 + warm 120.3 (opening ≈ 66: rc9 43.9,
  rc9-road 10.9, cs-prewarm 6.0, EXT1 3.1, car-set 1.8; later ≈ 54).
- Constraint: anything compiling in the background must never be needed SYNCHRONOUSLY by a C0/C1 frame — a sync
  pipeline queues behind the whole background backlog (2-wide) and freezes the cutscene for seconds (the 0-build
  steps above are exactly that). Main-thread node builds (≈ 15 ms each unloaded) cannot run during cinematics without
  dropping frames; only static windows hide them (the "Click to begin" overlay, C0 0–4 s black).

## Cacheable outputs (size · regeneration cost · cache read cost)
| output | size | regenerate (warm / evicted / cold) | read from IndexedDB |
|--------|------|------------------------------------|---------------------|
| audio banks (108 sounds / 314 variants, 44.1 kHz) | 71.3 MB PCM | 4.1 s main thread (5.8–20 s under swap) / same / same | 90 ms + 26 ms AudioBuffers |
| generated material maps (82 materials, Medium) + albedo gains | 289 MB (+ 82 × 3 floats) | 2.7 s / 3–8 s / **24.7 s** (82 generator programs cold) | 447 ms + upload |
| reflection cubes (13 × 128² × 6 × RGBA16F + mips) | ≈ 13.6 MB | capture 7.9 + prewarm 2.2 = **10.1 s** / 27 s / **129.5 s** (464 cube-context programs ≈ 48 % of cold compile, ≈ 1.3 GB GPU memory) | 49 ms |
| lightmap decode (klm) + glb parse | 2.1 MB per klm | 0.84 s (parse phase, all) | not worth it |
| probe grids | shipped (probes.bin) | 12 ms | — |
| GPU pipelines / Metal binaries | browser-owned (Metal FS cache, Dawn cache 24 MB) | 502 compile-CPU-s cold Medium | NOT cacheable by the page |

## Ranked plan (Medium, this M1; seconds saved on: COLD first visit 278 s · EVICTED repeat 100–103 s (lead, AC) · WARM repeat 25–30 s (lead, idle machine))
1. **No runtime reflection capture.** Best variant: capture the 13 cubes + the dawn / night EXT states WITH THE GAME
   ITSELF in headless Chrome as an asset-pipeline step (a shot.mjs scenario that reads the cube render targets back)
   and ship them as tier assets (13.6 MB raw RGBA16F + mips, smaller compressed), keyed by a hash of (asset manifest,
   material-spec, lighting / reflection code, preset) — exact parity with today's runtime capture, no Blender, zero
   cube-context compile even on a first visit. Complement: an IndexedDB copy (49 ms read) for any key the build missed.
   A Blender (Cycles) bake is the fallback, with a parity risk (Blender materials ≠ the runtime TSL materials).
   Download cost: ≈ 13.6 MB raw RGBA16F per reflection tier (Medium and Max only — Low has no probes) + ≈ 2 MB for the
   dawn / night EXT states (3 × ≈ 1 MB for EXT), less after compression — needs a budget ruling
   (`node scripts/assets.mjs --check`).
   COLD −130 s (story phase 130.4 → ≈ 1; shipped cubes — an IDB-only cache does not help the first visit),
   EVICTED −27 s, WARM −10 s (capture 7.9 + prewarm 2.2), and ≈ −1.3 GB GPU-process memory (464 programs).
   Must: C5 / C6 / B12 dawn-night re-capture also served from the bake / cache (else it compiles the cube context
   mid-game: the measured 40 s C5 freeze on a cold cache). Art-director check that baked cubes match the runtime ones.
2. **"Ready" after the opening set; the house compiles during C0 + C1.** Await only materials, story runtime, EXT +
   car-set probes and EXT1 / EXT2 / car-set / rc9 / rc9-road / cs-prewarm; request the interior / tableau / car-row /
   cs-shots pipelines asynchronously and let them finish during the 105 s of C0 + C1 (≈ 54 s of 2-wide compile cold —
   fits). COLD −54 s, EVICTED −33 s, WARM ≈ 0 (−6 s only if the ≈ 400 interior node builds fit the static windows:
   the Click-to-begin overlay + C0's 4 s of black). Must: every deferred pipeline via createRenderPipelineAsync (no sync
   create behind the backlog = a cutscene freeze), `__game.builds()` delta 0 and no stalls through C0 / C1 / B02, and
   completion before B03 (else a visible pop-in / hitch at the door).
3. **Audio prerender off the main thread** (a small worker pool — the synth is pure JS) or an IDB bank cache (71.3 MB,
   90 ms + 26 ms). WARM −3.5 to −4 s (it shares the main thread with materials on repeat visits), COLD ≈ 0 on a real
   network (it already overlaps the 61 MB download).
4. **Material maps**: IDB cache of the 289 MB of generated maps + the 82 albedo gains (0.45 s read), or at least move
   the 82 sequential albedo readbacks (materials phase 28 % idle warm) off the critical path. WARM −2 s, EVICTED / after
   a deploy that did not touch the generators −22 s (materials 24.7 s cold = the 82 generator programs).
5. **Fewer / cheaper programs.** Each program costs ≈ 0.33 compile-CPU-s cold (≈ 0.17 s wall at 2-wide), ≈ 15 ms of
   main-thread node build warm, and ≈ 2.8 MB of GPU-process memory for the browser session. Hot spots (cold): rc9 43.9 s
   / 80 builds, cs-shots 15.9 s, tableau 11.5 s, rc9-road 10.9 s / 8 builds. Every 10 % fewer ≈ −25 s cold, −2.5 s warm.
6. **Variance hygiene on this machine.** The 25 s ↔ 100 s+ spread is Metal-cache state, not the game: (a) label every
   shot.mjs load cold / warm by MTLCompilerService CPU (scratch/load/sampler.mjs + seq.mjs do it); (b) agents' runs of
   other presets / dists evict the user's own compiled shaders — fewer distinct dists, or run QA in one profile;
   (c) one-off, user / lead decision only: clearing the saturated 6.5 GB `…/com.google.Chrome.helper/com.apple.metal`
   would end most evictions for a while (unproven; costs one cold compile for every WebGPU page in the user's Chrome).
7. **Memory on 8 GB Macs**: Medium peaks at GPU 4.3 GB + renderer 2.0 GB, Max 5.5 + 2.4 GB → swap doubles even warm
   loads (55–58 s here vs 25–28 s). Items 1 and 5 cut it; add a `pagehide` teardown as insurance.
8. **First-visit download** (61 MB Medium + 6.6 MB voice ≈ 11 s at 50 Mbps): start the material generators (they
   need no assets) during the download — COLD −25 s on a slow link (materials 24.7 s cold overlap), WARM ≈ 0.

**Combined expectation (Medium):** COLD first visit 278 s → ≈ 95 s with 1 (baked) + 2 (+ ≈ 70 s with 5 at −20 %);
WARM repeat 28 s → ≈ 12–14 s with 1 + 3 + 4 (+ 2 if the node builds fit the static windows); EVICTED penalty shrinks
from +75 s to ≈ +25 s (only the opening set still compiles before the click).

## Tools (all in scratch/load/, no src changes)
- `sampler.mjs` (1 Hz: headless Chrome tree CPU by process type, MTLCompilerService CPU per pid, the user's Chrome GPU
  process CPU, swap / pageouts / pressure, top footprints, Metal cache file sizes) · `seq.mjs` (runs shot.mjs + sampler,
  summary.jsonl; `--resum`) · `multi.mjs` (several loads in ONE shot.mjs session; `RP_SEQ`, `RP_FIRST`, `RP_PROF`) ·
  `items.mjs` (per-load window stats) · `cpuprof.mjs`, `stepprof.mjs` (CPU profile per warm step) · `stacks.sh` +
  `stackleaf.py` (macOS `sample` of the GPU process + renderer; `sample` takes 30–120 s to symbolicate) ·
  `make-cold-dist.sh <salt>` (a dist whose every vertex/fragment shader misses every cache = a first-time visitor) ·
  `idb-bench.mjs` · `critpath.mjs`.
- shot.mjs `--profile <dir>` / `--port <n>` (contract row #157) ran in s3 / s4 with 0 console errors / exceptions; the
  default fresh-profile path ran unchanged in s1 / s2 (0 errors).

### s4 (salted COLD dist scratch/dist-cold7102, one session, profile scratch/load/prof-s4)
| item | what | load s | warm-up s | mtl CPU s | programs | GPU / renderer peak |
|------|------|-------:|----------:|----------:|---------:|--------------------:|
| s4#1 | Medium cold | **210.3** | 103.3 (story 97.9: capture 65.5 + prewarm 31.4) | 383 | 464 + 1052 | 4.2 / 1.9 GB |
| s4#2 | Low cold (CPU-profiled) | **107.3** | 94.0 | 190 | 497 | 1.8 / 2.6 GB |
| s4#3 | Low warm (reload) | **22.8** | 16.2 | 0 | 497 | 1.7 / 2.1 GB |
- The lead's Low 52–57 s were partly cold (every Low run followed a Max run). Warm Low = 22.8 s.
- Low's cold profile (2 ms sampling shows the natives): `warm U2` (0 builds) 13.1 of 13.9 s in
  `native:writeBuffer ← updateBinding`; `warm tableau` 15.2 of 16.9 s in `native:writeTexture ← _copyBufferToTexture`;
  cs:C2b / C4a / C4c / cs-shots in "(program)" (native, unattributed) — the same JS-blocked-in-WebGPU-queue stall.
- Side effect to know: my cold (salted) runs added ≈ 1 070 CPU s of new Metal compiles into the saturated cache, so
  they too will have evicted some entries (other lanes' and possibly the user's) — their next loads may be cold once.
