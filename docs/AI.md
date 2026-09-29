# AI + Story — THE KEEPING

Ada (the single chaser) and the beat machine B01–B13, as pure, deterministic TypeScript (seeded RNG, own clock,
no three.js, no DOM, no `Math.random`/`Date.now`). Positions are PLAN tuples (metres, Z-up, x = east, y = north —
`src/shared/coords.ts`). Everything runs under `node --experimental-strip-types` and is unit-tested.

## Layout

| File | What |
|---|---|
| `src/ai/types.ts` | `AdaState`, `PlayerView`, `BeamView`, `WorldQuery`, `NoiseInput`, `AdaOutput`, `TellCues`, `AiEvent`, `ScriptedMode`, `ADA_ANIMS`. |
| `src/ai/tuning.ts` | Every AI number (speeds, radii, LOOK timings, sight ranges, lure 60/50/40, grace, assists, B04 gap …). |
| `src/ai/graph.ts` | `AiGraph`: aiNodes/aiEdges, A* honouring door states (`locked` impassable, `closed` = slow push), room lookup, nearest graph point, loops (`loopConnected`, `cycleThrough`), hide ↔ hide-check node. |
| `src/ai/nav.ts` | `Nav`: route planning/following on the graph, door pushes, short free legs inside a room (never into hides, G2, U4/U4T). |
| `src/ai/senses.ts` | Hearing (`hearingPath` max-product on `roomLinks`, `hearingMargin` routes sound *through* stairwells, `ThunderMask`), light (`beamTouches`, `beamNear`, `isPlayerLit`), sight (`seesPlayer`, `inCone`, `sightRange`), locket rule (`seesLocket`), `resolvePriority`, `lureDuration`. |
| `src/ai/hide-check.ts` | Hide rules (`seenEntering`, `audibleFromHide`, `breathGivesAway`) and `HideTracker` (first hide unfailable). |
| `src/ai/ada-brain.ts` | `AdaBrain`: the state machine (SCRIPTED, VIGIL, PATROL, LISTEN, INVESTIGATE, LOOK, CHASE, SEARCH, LURED, FINALE, CATCH), grace, escalation, assists, relocation guard, snapshot/restore. |
| `src/story/escape-state.ts` | `EscapeState` (JSON), `BEATS`, `CHECKPOINTS`, `FLAGS` (the shared flag vocabulary). |
| `src/story/beats.ts` | `Story`: beat machine — inputs (interact/trigger, flag, cutscene end, hide, AI event) → `StoryCommand[]`. Hint timer, deaths/respawns, finale assists, debug starts. |
| `src/story/checkpoints.ts` | CP1–CP8 info, `checkpointSpawn`, `SaveGame`, `serializeSave` / `parseSave`. |
| `src/story/documents.ts` | Guest book (+ sting state), ledger p1–p3, letter, ticket, photos, can plate — each ≤ 60 words. |
| `src/story/voice-cues.ts` | Voice-script trigger → line ids (`buildTriggerIndex`, `linesForTrigger`), the trigger lists. |
| `src/story/director.ts` | `Director`: THE runtime adapter. Owns brain + story, listens to the bus, emits bus events, calls a `DirectorHost`. |

## Behaviour summary (what the code does)

- **Priority** (rule 3): FINALE > CATCH > SCRIPTED > CHASE > LOOK > newest(LURED | INVESTIGATE) > SEARCH > PATROL > VIGIL.
  Layers wait under higher ones (a bell heard during a LOOK is honoured after it). A newer noise pulls her off a lure
  (the pry-outside-thunder rule); a bell never breaks a CHASE and is ignored in SCRIPTED/FINALE and once the nonstop
  bell has started.
- **Hearing**: effective radius = source radius × best room-graph attenuation (layout numbers; parity-tested against
  `src/audio/spatial.ts bestPath`) × multipliers (grace 0.7, assist 0.8). Sound that crosses the open stairwell is
  measured as a walk through the stair's mid-flight point (it goes *down the stairwell*, not through the slab); the
  best stairwell-free path (floors ×0.4) is measured straight. Thunder masks every non-`script` sound for the
  `thunder` event's window `[now + delayMs, now + delayMs + durationMs]`. Post-sprint panting (≥ 1.2 s of running →
  2.5 m for 4 s, even hidden) is synthesised by the brain from `PlayerView.running`.
- **Light**: beam cone touching her body → fast LOOK (0.6 s) toward the lens; beam landing within 6 m → INVESTIGATE
  (rate-limited); lit = torch on, or within 1.5 m of a candle/lamp/lantern. Lightning is never an input.
- **Sight**: only with the head lifted (LOOK sight phase, CHASE, FINALE, the scripted slat looks): 60° cone,
  14 m lit / 5 m dark / 2 m dark + crouched, caller's LOS. Hidden players are never seen.
- **Locket rule**: head lifted + open locket raised in the ON beam + within 4 m + in cone + LOS → FINALE (beats
  CHASE, works in the dress visit). FINALE: stop 1 s → approach to arm's length (0.8 m/s) → look 2.5 s → take →
  carry to the parlor door → wait. If the player slips away (hidden / out of sight 4 s) before she reaches them, the
  FINALE lapses into SEARCH (`finale` event phase `lost`) and the locket can be shown again.
- **LOOK**: crack (tell) → 1.2 s wind-up (0.6 beam, 1.6 assist) → 3 s sight ("…Harlan?" = `ai:look_lift`) → lower
  0.5 s (`ai:look_not_him` gurgle). Patrol LOOKs: stair top, south window, bedroom, stair foot, kitchen always;
  doorways by chance (0.4 → 0.65 → 0.9 with escalation).
- **CHASE**: 3.2 m/s bursts (1.1 s) with 0.3 s lulls, head up; follows running noise (≥ 5 m radius) when sight
  breaks; SEARCH after 4 s without either. Catch within 1 m.
- **SEARCH**: to the last known point, 2 LOOKs with nails-on-plaster between, then 4–6 s listening at the nearest
  hide, then a slat LOOK (the breath rule applies).
- **LURED**: to `G_PARLOR_LURE`, scrape 60 / 50 / 40 / 40 s (floor 40; reset by grace), then climb back into her
  routine (stair top first). Re-ringing while scraping restarts with the next (shorter) duration.
- **Routines**: `upper` (vigil at `U_VIGIL` 15–30 s → lap: stair top, Harlan's doorways or through his room, south
  window, back), `upper_dress` (vigil at the dress after B09), `ground_finale` (after the can: stair foot, parlor
  door, hall, passage, kitchen). Legs are A*, so locked doors skip waypoints instead of stalling.
- **Hides**: safe unless seen ≤ 2 s before entry, a player noise from the hide is heard with her ≤ 2 m, or she
  LOOKs at the slats (≤ 2 m) and the breath isn't held. Found → she tears it open (CATCH `hide`); from afar she
  runs to it first. The FIRST hide of the game (whichever) is unfailable until the B05 demo ends — the layout's
  `unfailable` flag on H_ARMOIRE is honoured only for that first hide (DESIGN: "The first hide can't be failed").
- **Catch**: 1 m in CHASE, bump (0.55 m, not hidden, any non-scripted state), a found hide, or the B04 grab.
- **Grace** (after respawn): farthest anchor of her routine not in the player's view (then any anchor, then any
  node; if literally everything is in view she waits offstage until one is not), PATROL-only for 8 s, hearing −30 %
  for 20 s, lure reset. *Interpretation*: "PATROL-only" 8 s + "hearing −30 %" 20 s so both parts of the rule matter.
- **Escalation**: level 1 after the boards are pried, 2 after the dress visit: shorter LISTEN (1.0 / 0.8 / 0.6 s),
  more doorway LOOKs, shorter vigils, more laps through Harlan's room.
- **Assists** (story → brain): 2 deaths in a section → 15 % slower, wind-up 1.6 s, noise radii −20 %; 3 → a
  shutter bangs far away when she starts toward you (≤ 1 / 30 s) and in B08 thunder on cue at the boards; 2 failed
  pries → thunder rolls ×1.6 long; finale: 1 death → respawn with the locket raised + one-time prompt, 2 → she
  stops ~3.6 m away with her head up.
- **Relocation guard** (rule 11): `relocate()` defers while `playerCanSee(from|to)`; forced only under cutscene cover.
- **Scripted**: `hidden` (offstage), `hold`, `b04_chase` (trail-following 2–4 m behind; stand still > 2 s → grab;
  1.5 s grace at the start), `hide_demo` (B05, switched to automatically when the player hides during B04), `dress`
  (C4 visit: to the dress, hand on the hem, to the wardrobe's slats, head lifts, leaves; a beam on her or seeing the
  player ends it early).

## Story (beats.ts)

Idempotent handlers + room-based fallbacks (triggers fire on enter only; hides/respawns can leave the player inside a
volume). Key rules: ring → front door opens after 2.6 s; C2 end → rope slam, parlor locked, CP2, B04 chase; hide in
B04 → B05; demo done + out of the hide → CP3; ledger (pages cycle p1→p3, voiced) → CP4; hammer → CP4, B07, C3;
C3 end → B08 (storm every 12 s); bell pull → AI bell; each board → CP5 (outside a roll: 14 m screech noise, failed
pry count); all boards → escalation 1; U3 → B09; hem needs the shears; locket → CP6 + dress visit (replays at CP6);
visit end or a finale → `dress_visit_done`; B10 cancels any replayed visit; can → CP7 + nonstop bell + ground
routine (not after she has the locket); passage bolt slides only from G3P/G3; B11 hall → CP8; finale take →
locket removed; C5 when she waits at the door AND the player is in G1; C5 end → rope opens, B12; car needs the can
→ C6 → B13 → C7 → `end`. Death: `death` cutscene (3 s) → respawn at the current checkpoint → grace (B04 instead
replays C2). Deaths never roll back progress. Stuck 90 s (no flag/beat/doc/checkpoint progress) → `hint` target.

**Early-finale branch**: the locket can be shown any time after taking it. A finale during C4 sets
`dress_visit_done` (the wardrobe's back must open, or the can is unreachable after C5 — the passage is bolted from
the kitchen side). If she is taken before the can, the house goes quiet (no nonstop bell); C5 plays when the player
reaches the hall; B12's car waits on the can (toast "The tank's empty…"). Tested both ways (C5 before/after the can).

## Integration (lead — `src/game/main.ts`)

One adapter, created after the level/player/audio exist. Everything below is plain wiring; nothing in `src/ai` or
`src/story` imports three.js.

```ts
const [{ Director }, { buildTriggerIndex, linesForTrigger }] = await Promise.all([
  import('../story/director.ts'),
  import('../story/voice-cues.ts'),
]);
const voiceIdx = buildTriggerIndex(script?.lines ?? []);          // script = await loadVoiceScript()
const P = (w: any) => coords.worldToPlan([w.x, w.y, w.z]);         // three Vector3 → PLAN tuple
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpD = new THREE.Vector3();
const los = (a: P3, b: P3) => {                                     // static collision + closed door leaves
  tmpA.set(...coords.planToWorld(a)); tmpB.set(...coords.planToWorld(b));
  const len = tmpD.subVectors(tmpB, tmpA).length(); tmpD.normalize();
  return level.collision.rayDistance(tmpA, tmpD, len) >= len - 0.05;
};
const director = new Director({
  layout: ctx.layout, events: ctx.events, flags: ctx.flags, seed: 1976,
  host: {
    player: () => ({
      pos: player.planFeet(), eye: P(camera.position), room: level.room,
      crouched: player.crouch > 0.5, running: /* sprint key held && moving */ input.isDown('ShiftLeft') && horizSpeed > 2.6,
      speed: horizSpeed, hiddenIn: hides.active?.id ?? null, holdingBreath: player.holdingBreath,
      beam: { on: rig.on, origin: P(lensWorldPos), dir: planDir(lensWorldDir), range: light.distance || 14,
              halfAngle: light.angle, hit: beamHitPlanOrNull },   // one collision ray per frame along the beam
      locketRaised: locketRaised,                                    // RMB (not implemented yet — see open issues)
    }),
    doorState: (id) => { const d = level.doors.doors.get(id); return !d ? 'closed' : d.lock ? 'locked' : d.angle > 10 ? 'open' : 'closed'; },
    lineOfSight: los,
    playerCanSee: (p) => { /* frustum.containsPoint(planToWorld(p)+1.4 up) && los(eyePlan, p) */ },
    pushDoor: (id, fast) => level.doors.open(id, fast, true),
    door: (id, a) => a === 'rope_open' ? level.doors.ropeOpen() : a === 'rope_close' ? level.doors.ropeClose()
                   : level.doors.setLock(id, a === 'lock' ? 'locked' : null),
    playCutscene: undefined,          // until src/cutscenes lands: the director times each cutscene out (1.5 s, death 3 s)
    voice: (t) => { for (const id of linesForTrigger(voiceIdx, t)) void voice?.play(id); },
    sfx: (id, pos, room) => audio?.play(id, pos ? { pos: coords.planToWorld(pos), room } : {}),
    lightning: () => lightning.strike(),
    storm: (intervalSec, rumbleScale) => { /* lightning auto interval + thunder durationMs × rumbleScale; 0 = stop */ },
    hint: (target) => { /* strike lightning; outline level.prop(target) / the door / board_k for ~1 s */ },
    toast: (t) => toast(t), prompt: (t) => showPrompt(t),
    document: (doc) => { journal.add({ id: doc.id, title: doc.title, text: doc.text }); toast(doc.text); },
    removeItem: (id) => inventory.remove(id),
    setPropVisible: (id, v) => { const o = level.prop(id); if (o) o.visible = v; },
    teleport: (_id, pos, yaw, pitch) => { if (hides.active) hides.exit(); player.teleport(coords.planToWorld(pos), headingToCameraYaw(yaw), pitch); },
    raiseLocket: () => { locketRaised = true; rig.setOn(true); },
    end: () => { /* title card / back to boot */ },
    ada: (out) => {                   // character lane + audio tells
      adaCharacter?.apply(out);       // root = planToWorld(out.pos), heading out.facing, head out.head, clip out.anim, visible
      if (audio && out.visible) {
        const w = coords.planToWorld(out.pos); audio.layers.setDripPosition(w[0], w[1] + 1.2, w[2], out.room);
        audio.layers.setDripRate(out.tells.dripRate);
        if (out.tells.dripStopped) audio.layers.stopDrip(false); // hide checks (LISTEN itself is handled by ai:state)
        if (out.tells.crack) audio.play('ada_bone_crack', { pos: w, room: out.room });
        if (out.tells.gurgle) audio.play('ada_gurgle', { pos: w, room: out.room });
      }
      rig.tremble = Math.max(0, 1 - dist(out.pos, player.planFeet()) / 6);
    },
  },
});
director.start();                         // or director.startAt('B06') for ?beat= debug starts
// update order: player → director.update(dt) → characters → world → audio → render
// saves: localStorage.setItem('keeping.save', serializeSave(director.snapshot({ doors, inventory, journal })))
//        director.restore(parseSave(json)!)  (then restore the host part yourself)
```

Also:
- Remove `main.ts`'s own `interact`-from-trigger forwarding? **No** — keep it: the story consumes exactly those
  `interact { id: triggerId, action: trigger.event }` events.
- Replace `src/world/interactables.ts` `DOCS` placeholder texts with `DOCUMENTS` (the director already sends the
  real text through `host.document`; the world should stop toasting its own placeholder).
- The board-pry interaction should NOT set `ada_boards_pried` twice — harmless (flags are idempotent), just noting
  the story also derives it from `ada_board_1..3`.
- Expose `?debug` handles: `__game.director`, `__game.director.brain`, `__game.director.story.s`.

## Contract mismatches (other lanes — report, not fixed here)

| Where | Now | Design / contract | Effect |
|---|---|---|---|
| `src/world/interactables.ts` board pry noise | 8 m | pry 14 m | The story emits the 14 m screech itself when a pry lands outside a thunder roll, so gameplay is correct; the world's 8 m is redundant. |
| `src/player/controller.ts` `STEP_NOISE` | runner 1.5, bare 3, creaker 9, run ×2.5 (runner 3.75) | crouch 1.5, runner 2, bare 4, creaker 7, run 10 | "Running is never safe" fails on the runner (3.75 m < 5 m to her vigil). Suggest run = max(10, surface × 2.5). |
| `src/player/controller.ts` gasp | 2.5 / 5 m | gasp 3 m | Minor. |
| `src/world/doors.ts DOOR_NOISE` | fast 9 | door fast 8 | Minor. |
| `src/game/main.ts` thunder | `delayMs 1500–4000`, `durationMs 4000` | AUDIO.md: roll +1.5 s, 2.5 s | The brain masks exactly the window the event states; B08 needs `storm(12, …)` wiring for three rolls per lure. |
| player | no RMB locket raise | DESIGN: RMB raises the open locket into the beam | Required for the finale (`PlayerView.locketRaised`). |
| player | `speedNow` is private | `PlayerView.speed/running` | Expose a getter. |

## Tests

- `tests/ai.test.ts` (32): graph/loops/locks/room lookup/hide-check pairing; hearing attenuation cases (closed door,
  floor, open stairwell, grate) + parity with the audio occlusion graph on every room pair; stairwell-routed hearing
  (lure vs upper floor, 14 m vs 8 m pry); thunder mask window + brain masking; beam/lit/sight distances (14/5/2),
  cone, blind head, hidden; locket rule + full FINALE sequence; exhaustive priority order; bell vs CHASE / LOOK /
  newer noise; lure 60/50/40/40 + reset; hide rules (seen-entering, audible, breath, gasp, panting, first hide);
  grace (farthest out-of-view anchor, patrol-only, hearing ×0.7); relocation deferral; determinism + snapshot
  mid-lure; the M1 exit test (walking the runner past her vigil is safe, running is not); investigate/search/chase.
- `tests/story.test.ts` (16): documents ≤ 60 words and identical to the voiced lines; every AI/story voice trigger
  exists in `voice-script.json`; layout contracts (spawns, unlock flags, hint targets, trigger events); beat flow and
  idempotency; gating (boards, dress visit, passage side); pry/thunder/rumble; hint timer; ledger pages; deaths,
  respawn order, C2 replay, slow assist; finale prompt/wait; C5 gating; early-finale `dress_visit_done`; nonstop
  bell; debug starts; save round-trip; director cutscene fallback.
- `tests/story-playthrough.test.ts` (7) with `tests/story-sim.ts`: a goal-driven scripted player on an authored
  waypoint graph (doors honoured) drives the real Director over the real bus: main route (5 seeds), a death at every
  checkpoint CP2–CP8 (stand-still grab, bumps, breath at the slats, chase) with grace checks, repeated deaths →
  assists, early finale during the dress visit, early finale with C5 before the can, save at CP5 → fresh game →
  finish. Every run asserts all beats in order, the ending, no route failure / stalled beat, and no relocation in view.

## Open issues

- Cutscenes (`src/cutscenes`) don't exist yet: the director's fallback times them out; C2's rise, C4, C5 staging is
  then implicit (she simply appears at the parlor door under the fallback's cover).
- LOS in the tests is a room-adjacency approximation; tune `playerCanSee`/`lineOfSight` in-engine (frustum + ray).
- The characters lane needs `AdaOutput` → skeleton: stop-motion sampling, head spring vs `head`, `anim` names in
  `ADA_ANIMS`; ceiling drips (use `out.pos` + floor above), wet footprints, flame lean.
- Balance (M3): per-room radii, LOOK chances, grace timings are all in `src/ai/tuning.ts`.

Story `sfx` ids (all in the synthesized bank): `bell_pull`, `rope_pulleys`, `fabric_tear`, `hatch_thump`,
`bolt_slide`, `spring_bell_loop` (the nonstop bell — loop it until `bell_nonstop` goes false), `window_rattle`
(the assist's far-off bang, positional).
