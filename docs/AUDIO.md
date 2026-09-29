# Audio — THE KEEPING

Every sound is synthesized in code (Web Audio + sample-level DSP). The only recorded material is the ElevenLabs
*designed* character voices, and the game runs without them (subtitle-only, with synthesized breath/gurgle fallbacks).

## Layout

| File | What |
|---|---|
| `src/audio/synth/dsp.ts` | Seeded RNG, noise colours, RBJ biquads, one-pole, delay/comb, envelopes, modal synthesis, resonator banks, stick-slip friction, WAV-free helpers. Pure TS (runs in Node). |
| `src/audio/synth/common.ts` | Physical building blocks: struck wood, metal (with mode-split doublets), thuds, droplets (Minnaert bubble), breath puffs (formant-shaped airflow), PolyBLEP saw, friction creaks, scrape noise. |
| `src/audio/synth/{ada,weather,footsteps,doors,bells,harlan,car,props,player,score}.ts` | 91 recipes. Each: `{ id, category, bus, variants, loop?, stereo?, params?, level?, renderRate?, preload?, gen(sr, rng, params) }`. |
| `src/audio/synth/index.ts` | Registry (`RECIPES`, `getRecipe`, `SURFACE_STEP` for layout surfaces → footstep id). |
| `src/audio/synth/render.ts` | Recipe → sanitised, edge-faded, peak-normalised channels (ceiling -1 dBFS); WAV encoder. |
| `src/audio/offline.ts` | Bank prerender during loading: DSP → AudioBuffer → seeded OfflineAudioContext variation pass (rate jitter + EQ tilt). Progress callback, timing log. |
| `src/audio/engine.ts` | `AudioEngine` (System `'audio'`): unlock, buses, limiter, volumes, pause/visibility, listener, bank playback, room reverb, occlusion; `LiveLayers` (drip, heartbeat, weather, thunder, score, breath). |
| `src/audio/spatial.ts` | Room-graph best path (same attenuation numbers as Ada's hearing), occlusion → gain + lowpass, room lookup, HRTF panner helpers, `SpatialEmitter`. |
| `src/audio/reverb.ts` | Procedural stereo IRs from `RoomDef.reverb {size, damping, wet}`; `RoomReverb`. |
| `src/audio/voice-timing.ts` | Pure: 2.7 words/s fallback timing, alignment → words, subtitle mapping, `VoiceIndex` type. |
| `src/audio/voice.ts` | `VoicePlayer`: script lines, chains, priority/queue, subtitles, synth vocal fallbacks. |
| `src/ui/subtitles.ts` | DOM subtitles/captions with word-timed reveal (system fonts). |
| `src/audio/lab.ts`, `src/audio/lab.html` | Audition page. |
| `scripts/voices.mjs` | ElevenLabs design / create / speak, cache, loudnorm, index. |

## Integration (lane B — one-time wiring)

```ts
// src/game/main.ts, after the context exists (h = BootHandoff):
const { createAudioSystem } = await import('../audio/engine.ts');
const audio = await createAudioSystem(ctx, { context: h.audioContext, onProgress: (f, l) => h.status(`Sound ${Math.round(f * 100)}% — ${l}`) });
audio.setDoorStateProvider((doorId) => doors.isOpen(doorId));   // open/ajar = true
// register in update order … world → audio → render (it reads ctx.camera.matrixWorld itself)

// ?scene=audiolab
if (params.get('scene') === 'audiolab') return (await import('../audio/lab.ts')).startAudioLab(document.body, { context: h.audioContext });

// voices + subtitles
const { VoicePlayer, loadVoiceScript } = await import('../audio/voice.ts');
const { Subtitles } = await import('../ui/subtitles.ts');
const subs = new Subtitles(); subs.attach(ctx.events);
const script = await loadVoiceScript();
const voice = script && new VoicePlayer({ engine: audio, script, events: ctx.events, subtitles: subs, settings: ctx.settings });
await voice?.load();
```

Until then, the lab runs standalone at `/src/audio/lab.html` in `npm run dev` (no renderer, no WebGPU).

### Runtime API cheatsheet

- One-shots: `audio.play(id, { pos?: [x,y,z] (world), room?, gain?, rate?, when?, bus? })`. Positional ⇒ HRTF +
  occlusion + listener-room reverb. Variants never repeat back-to-back. Lazy sounds (`preload:false`) render on
  first request (`audio.ensure(id)` to warm them on `beat:enter`).
- Footsteps: `audio.play(SURFACE_STEP[surface], { gain: weight })` (+ `params.weight` if custom-rendering).
- Ada: `audio.layers.startDrip(rate)`, `setDripRate(r)` every frame from her speed (~0.8 vigil, 1.5 walk, 3 run),
  `setDripPosition(x,y,z,room)`, `stopDrip(true)` = the LISTEN tell. `ai:state` events also drive it: `LISTEN` stops
  the drip, `CHASE` starts the chase cluster + heartbeat, leaving CHASE restores the previous score.
- Weather: `audio.layers.setWeather({ rain, wind, inside, surface })`; thunder follows the `thunder` event
  (`delayMs`, `durationMs`, `distance`) — **contract with the AI lane**: roll starts ≈1.5 s after the flash and lasts
  2.5 s, the same window used for masking player noise.
- Score: `audio.layers.setScore('drone' | 'chase' | 'blue_hour' | 'none')`, `audio.layers.stinger('score_stinger')`.
- Player: `setBreath('calm' | 'strained' | 'panting' | null)`, `player:breath` events play hold/release.
- Listener: automatic from `ctx.camera.matrixWorld.elements`, or `setListener(px,py,pz, fx,fy,fz, ux,uy,uz)`.
  The listener's room comes from the layout (`roomAtWorld`), or `setListenerRoom(id)` explicitly.

## Buses & mix

`ambience, weather → volume.ambience` · `sfx, creature, player → volume.sfx` · `voice → volume.voice` ·
`score → volume.music` · `ui → master only`. Slider → gain is squared (perceptual). Master → DynamicsCompressor
limiter (-3 dB threshold, 20:1, 2 ms attack) → destination. Per-bus trims live in `BUS_TRIM_DB`; per-sound balance
lives in each recipe's `level` (peak the bank normalises to, ≤ -1 dBFS).

Pause: the `pause` event and `visibilitychange` fade the master and suspend the context; resume fades back in.

## Occlusion = her hearing

`bestPath(layout.roomLinks, listenerRoom, sourceRoom, isDoorOpen)` returns the max-product attenuation (Dijkstra on
−log). Closed door 0.5, floor 0.4, open stairwell 1, grate 0.75 (G2↔U2 picks the grate). `occlusionFor` maps it to
gain `a^1.25` and a log-interpolated lowpass (20 kHz at 1, ≈3 kHz at 0.5); paths crossing a floor or wall are
lowpassed ×0.35 more. Re-evaluated at 10 Hz and on room changes.

## Reverb

`generateIR({size, damping, wet})`: pre-delay ≈ size/2c (≤35 ms), 6–14 early reflections, decorrelated L/R noise
tail decaying at RT60 = f(size, damping) (0.15–3.2 s), HF absorption via a one-pole whose cutoff falls over the
tail. Unit-energy normalised; the listener's room reverb crossfades on room change and every emitter sends into it
post-occlusion (sound entering your room reverberates in your room).

## Voices

- `public/assets/voice/index.json` (written by `voices.mjs speak`/`index`) lists generated takes per line. No index
  (or Vite's HTML fallback) ⇒ subtitle-only mode.
- Clip naming (defined only in `scripts/voices.mjs`): take 1 `<lineId>.mp3`, take k `<lineId>_v<k>.mp3`, word timings
  in the same stem `.json` (`VoiceTiming`, audio tags stripped).
- Subtitle-only lines are timed at 2.7 words/s (length-weighted, punctuation pauses, ≥1.4 s, +0.6 s read tail).
- Vocal lines without audio play synthesized fallbacks (`VOCAL_FALLBACK` in voice.ts: breaths, gasps, panting,
  Ada's gurgles and sob) and show their caption.
- Priority: higher interrupts lower on the same speaker; equal/lower lines queue; vocals are dropped when busy.
- Chains: see the header of `src/audio/voice.ts`. Revenant = playbackRate 0.92, 7–11 Hz band-limited-noise AM
  (a looped DSP buffer driving a GainNode), asymmetric tanh WaveShaper grit in parallel, peaking resonances at
  330/1250 Hz and a cut at 2.7 kHz, HRTF emitter + listener-room reverb.

### Generator (`scripts/voices.mjs`)

```
npm run voices -- --dry-run          # validate + credit estimate, no network (key optional)
npm run voices -- design --speaker ada
npm run voices -- create --speaker ada --pick 2
npm run voices -- speak --speaker ada [--line id] [--milestone M1] [--limit N] [--force]
npm run voices -- index
```

Exit codes: 0 ok · 1 validation/API error · 2 script missing/unparsable · 3 no API key. The key is read from the
environment or `.env.local`, never printed (errors are redacted). Requests are cached by content hash in
`voices/cache.json`; voice ids are stored in `src/shared/voices.json`.

## Budget (measured)

- Prerender at load: 73 sounds / 224 variants in ≈2.7 s on the M1 (Chrome, 44.1 kHz), ≈50 MB of AudioBuffers.
  Band-limited beds (drone, rumble, muffled rain, breath, engine) render at half rate (`renderRate: 0.5`).
  The Low preset caps variants at 3 (`createAudioSystem`).
- Lazy (`preload:false`): chase cluster, blue-hour pad, final bell, reveal, radio song, engine crank/catch, sob,
  nonstop bell, etc. — each renders in 20–400 ms on first use; warm them with `ensure()` at beat boundaries.
- All scratch renders peak ≤ -0.4 dBFS before the -1 dBFS ceiling was introduced; now every bank sound is ≤ -1 dBFS.

## Tests

`tests/audio.test.ts` (catalog render: finite / non-silent / ≤ ceiling / stereo where declared; seeded variants;
loop seams; IR decay, decorrelation, size/damping trends; room-graph paths incl. grate vs floor and open/closed
doors; occlusion monotonicity; room lookup; fallback timing; alignment mapping) and `tests/voices.test.ts`
(validation, credits, naming, seeds, cache keys, env parsing, redaction, CLI exit codes, index building).
Scratch renders: `node --experimental-strip-types scratch/audio/render-all.ts [filter]` → `scratch/audio/*.wav`.
