# Playtest checklist (one pass, about 15 minutes)

This is a manual pass through the whole game, B01 to B13. Tick each box as you go. If a box fails, note the beat,
what you saw, and the FPS overlay's third line (beat, cutscene, and Ada's state). The debug build shows that line.

The logic is already covered headlessly by `npm test`. `tests/e2e-playthrough.test.ts` drives the real Director, the
real cutscene system and the runtime's body and lock rules from B01 to B13. It covers a forced death and a save at
every checkpoint, plus the early-finale branch. So this pass is about what a test can't judge: **look, sound, feel,
and pacing**.

## 0. Setup (1 min)

- [ ] `npm install` (first time only), then `npm run dev` and open http://localhost:5173 in desktop Chrome.
- [ ] The boot card runs a device test and suggests a preset. Nothing else downloads until you press Start. Pick
      **Medium** for this pass.
- [ ] Headphones on. Most of the scares are positional sound: the drip, wet slaps, and the bell off to the right.

### Controls (from `src/player/controller.ts`, `src/world/interactables.ts`, `src/world/hides.ts`, `src/game/main.ts`)

| Key | Action |
|---|---|
| W A S D (or arrows) | Move |
| Mouse | Look (click the canvas to capture the pointer) |
| Shift | Run (loud: about 10 m noise radius) |
| C (or Ctrl) | Crouch (quiet: 1.5 m) |
| F | Flashlight on/off |
| E | Interact. **Hold E** for hold actions (pry a board, cut the hem, pour the can). In a hide, E enters and leaves |
| W (in a hide) | Peek through the slats |
| Space | **Hold breath** (in a hide, when she looks). In a cutscene you have already seen, **hold Space** to skip it |
| Right mouse | Raise the locket into the flashlight beam (after B09) |
| Tab | Journal (documents you have read) |
| Esc | Pause menu (releases the pointer) |
| E / Esc / click / any move key | Close a document page |

### Shortcuts (add to the URL; combine with `&`)

| Param | Effect |
|---|---|
| `?beat=B02` … `?beat=B13` | Start at a beat, with the flags a normal run would have by then. `B05` drops you straight into the armoire with the B04 chase running |
| `?spawn=CP1` … `?spawn=CP8` | Start at a checkpoint's spawn point (position only; the story still starts at B01 unless you add `beat`) |
| `?debug` | Adds the FPS overlay's beat/Ada line and `window.__game` in the console: `beat()`, `storyState()`, `flags()`, `setFlag(name)`, `goto(x,y,z)`, `teleport` via `spawns()`, `noclip(true)`, `give('locket')`, `openDoor(id)`, `director`, `brain`, `cutscenes`. **L** strikes lightning |
| `?backend=webgl` | Force the WebGL2 backend (compare against WebGPU) |
| `?rerun` | Re-run the boot device test |
| `?scene=test` / `?scene=matlab` / `?scene=cutscene&id=C2` | Render test room / material lab / preview a single cutscene |

Example: `http://localhost:5173/?debug&beat=B09` jumps to the sewing room.

## 1. The slice: B01 to B05 (about 5 min)

- [ ] **B01 · C1 "Empty"** (about 55 s): rain on the windshield, wipers, radio static, and the fuel needle under E.
      The NEXT SERVICES and STROUD'S / ROOMS / VACANCY signs pass. The car dies at the gate, and lightning shows the
      house. Listen for the subtitle line. *Look for:* no pop-in and no black frames between shots.
- [ ] **B02** (control returns at the gate): press **F**. Walk up the drive past the dead pump. Through the parlor
      shutters (right of the door), a shadow rises and falls with the **whetstone rasp**. **Knock** (E on the
      knocker): nothing happens. **Ring** (E on the bell knob): the bell sounds inside, **to the right**, and the
      rasp stops. About 2.6 s later the rope runs overhead and the door swings open by itself.
- [ ] **B03**: in the hall there is the guest book (optional read), the crepe-covered mirror, the knifed portrait, and
      the rope from the bolt box to the parlor. The parlor door stands open about 70° and candlelit.
- [ ] **C2** at the threshold (about 22 s; your feet freeze but you can still look): the shadow-play on the tally
      wall, the double look, the rope slipping, and the front door slamming behind you. She rises. *Check:* control
      returns mid-lurch.
- [ ] **B04 chase**: she stays 2 to 4 m behind you. Stand still for more than 2 s and she catches you. Try it once:
      **death cutaway (3 s) → black → respawn in the hall → C2 replays (3 s)**. The screen must fade back in, not
      stay black. Then run up the stair. You should see her through the balusters. A flash picks out the armoire.
- [ ] **B05**: E into the armoire. Wet slaps and the drip come up the stair. The drip **stops** (she is listening).
      She comes to the slats, you hear the gurgle and the bone crack, and one eye shows in a flash. **Hold Space.**
      She drifts back to the boarded door and scrapes at it. Sneak out, crouched or on the runner, into Harlan's room.
      *Check:* you cannot fail this first hide.

## 2. The house: B06 to B09 (about 5 min)

- [ ] **B06 (CP3)**: her patrol loop is readable. Her footprints glisten in the beam and dry, and the drip gives her
      away through walls. Read the **ledger** (3 pages; E closes each page). Look down through the **floor grate**:
      the rocking chair is empty but still rocking.
- [ ] **B07 · C3 "He looks up"** (take the hammer; you keep look control): four flashes. The wrecks, then **your**
      car (RVX-318) being pushed, then him looking up at you, then gone. Below, the rocking resumes.
- [ ] **B08**: pull the **bell** by his bed. The parlor bell jangles far below and the drip recedes downstairs.
      **Pry each board inside a thunder roll** (hold E): count flash, then rumble, then pull. A pry outside the
      rumble is a loud screech that brings her back. Try one to hear it, then hide in the armoire if she comes.
      *Check:* boards you pried stay pried after a death (CP5).
- [ ] **B09 (sewing room)**: read the letter, take the shears, **cut the hem (hold E)**. The locket and the 6:10
      bus ticket drop. Take the locket (CP6). The drip returns: **hide in her wardrobe**.
- [ ] **C4 (overlay, you stay in control)**: through the slats she goes to the dress and finds the cut hem, and you
      hear the long wet sound. Her head lifts toward you. The breath prompt appears: **hold Space**. The boards at
      your back give. She leaves. Push through the wardrobe's back to the servants' stair.

## 3. The way out: B10 to B13 (about 4 min)

- [ ] **B10**: on the servants' stair the slosh grows below. In the kitchen, the well hatch thumps once. Take a
      **full jerry can** (CP7). *Listen:* the rocking stops and the parlor bell starts ringing **without stopping**.
      Slide the back-passage bolt.
- [ ] **B11 (CP8)**: under the stair her drips fall through the treads. In the hall: **flashlight on, hold right
      mouse** (locket in the beam), and stand still. She stops at arm's length and takes the locket, and the bell
      stops. *Retry check:* after one finale death you respawn with the locket already raised and see a one-time
      prompt.
- [ ] **C5 "The face"**: three slow knocks, then her hand in the gap. The unmasking plays in shadow by lightning,
      then black, one stroke, one bell. The front door opens onto grey mist.
- [ ] **B12 · C6 "Blue hour"**: go to your car. **Hold E** to pour the can (about 1.2 s), then **tap E** for the
      key: two coughs, then it catches and the radio comes back. The ROOMS lantern gutters out as you pass. The
      mirror shot shows the house sinking into the mist.
- [ ] **B13 · C7 "The Keeping"**: weeks later, another traveler. The guest book now reads HARLAN, and Ada sits in
      the rocking chair with the sack. Black. One bell. **THE KEEPING**, then the end card ("Esc menu").
- [ ] At the end card, press Esc: the pause menu opens and is clickable.

## 4. Throughout the pass

- [ ] FPS overlay: Medium at 45 fps or better everywhere (60 target). Note any room below that.
- [ ] No console errors. Open DevTools once at the end and check.
- [ ] Nothing stays stuck after a cutscene or a death: letterbox bars, black screen, prompt text, the "Hold Space to
      skip" hint, frozen controls, or a document page.
- [ ] Subtitles appear for every spoken line (captions setting on).
- [ ] Optional branch: at B09, stand in the dark in the sewing room instead of hiding. When she comes in, turn the
      light on and raise the locket (**early finale**). The game must still reach C5, C6 and C7. If you go down the
      main stair first, C5 plays before you have the can, and the car waits until you fetch it.

## Voices (ElevenLabs): adding the key and generating

The game runs without voices: in **subtitle-only mode** vocal sounds use synthesized fallbacks. To generate the
designed voices:

1. Create `.env.local` in the repo root (it is git-ignored) with one line: `ELEVENLABS_API_KEY=your-key`. **Do not**
   use a `VITE_` prefix. It must never reach the browser bundle.
2. `npm run voices -- --dry-run`. This validates `src/shared/voice-script.json` (4 speakers, 46 lines) and estimates
   credits. It makes no network calls.
3. `npm run voices -- design`. This makes 3 Voice Design previews per speaker in `voices/previews/`. Listen to them.
4. `npm run voices -- create --speaker ada --pick 2` (per speaker). This saves the chosen preview as a voice in
   `src/shared/voices.json`.
5. `npm run voices -- speak`. This renders every line to `public/assets/voice/` (clip, word-timing sidecar,
   loudness-normalized) and rebuilds `index.json`. Requests are cached by content hash, so re-runs cost nothing.
6. Reload the game. The console no longer says `[voice] subtitle-only mode`.

## Known issues (at the time of writing)

- Voices are not generated yet (no `.env.local` in this checkout), so the game is in subtitle-only mode.
- The pause menu is the interim one (`src/game/pause-menu.ts`). The full settings screen belongs to the UI lane.
- `?beat=` starts assume the flags of a normal run. They are for testing a beat, not for judging what comes before it.
- Cutscenes can be skipped only after you have seen them once (stored per browser). Hold Space for 0.8 s. The death
  cutaway is never skippable.
- After a death, the story holds the screen black 2.2 s into the 3 s death cutaway, until the respawn fade-in. If the
  cutaway is ever shortened below 2.2 s, the screen would stay black. `tests/e2e-playthrough.test.ts` catches this.
- A death at CP1 (B01–B03) can't happen in play, because she is offstage until C2. The e2e test forces one to prove
  the respawn path anyway.
- See `docs/INTEGRATION.md` ("Open issues / asks") and `docs/CONTRACT-CHANGES.md` for the lane-level lists.
