// END-TO-END HEADLESS PLAYTHROUGHS (B01 → B13) through the game's own wiring, not just the Director:
//   - the goal-driven scripted player + REAL Director / AdaBrain / Story / EventBus (tests/story-sim.ts),
//   - the REAL cutscene system (src/cutscenes/bindings.ts createCutsceneSystem → CutscenePlayer + HemOverlay + the
//     input-lock / gate logic) with a real three PerspectiveCamera and duck-typed player / characters / audio,
//   - the REAL body rules of src/game/story-runtime.ts (src/game/body-control.ts: who owns the player's body, the
//     interact / hide / breath gating, the black fade) and its document page (E / a movement key closes it).
// Asserts: every beat in order; C1–C7 each play once (C4 = the hem overlay segments) with every interactive gate
// resolved by input; a forced death at EVERY checkpoint CP1–CP8 respawns at that checkpoint's spawn with the beat,
// flags and items intact and the fade back to clear; a save taken at every checkpoint restores into a fresh game and
// finishes; the early-finale branches; the skip path; and at the end no input / cutscene lock, camera hold, DOF,
// loop, acquired character, prompt, letterbox or reading page is left dangling.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import * as THREE from 'three/webgpu';
import { Sim, layout } from './story-sim.ts';
import { createCutsceneSystem, type CutsceneSystem } from '../src/cutscenes/bindings.ts';
import { memorySeenStore } from '../src/cutscenes/host.ts';
import { createBodyControl, FadeState, type BodyControl } from '../src/game/body-control.ts';
import { planToWorld, worldToPlan } from '../src/shared/coords.ts';
import { checkpointSpawn, parseSave, serializeSave, type SaveGame } from '../src/story/checkpoints.ts';
import { BEATS, CHECKPOINTS, type BeatId, type CheckpointId } from '../src/story/escape-state.ts';
import type { P3 } from '../src/shared/layout-types.ts';

const DIRECTOR_CUTSCENES = ['C1', 'C2', 'C3', 'C5', 'C6', 'C7'] as const;
const ALL_SEEN = [...DIRECTOR_CUTSCENES, 'death'];
const EYE = 1.65;

interface GameOpts {
  seed?: number;
  earlyFinale?: boolean;
  hallFirst?: boolean;
  /** Cutscenes already seen (skippable) and the skip key held throughout. */
  skip?: boolean;
  /** Force a death (an AI catch) once at each of these checkpoints, 2 s after first reaching it. */
  forceDeathAt?: CheckpointId[];
  /** Keep a save (serialized) the first quiet frame after each checkpoint. */
  saveAtCheckpoints?: boolean;
}

interface ForcedDeath {
  cp: CheckpointId;
  beat: BeatId;
  flags: Record<string, boolean>;
  items: string[];
  t: number;
  respawnedAt?: CheckpointId;
  respawnPos?: P3;
  beatAfter?: BeatId;
  flagsAfter?: Record<string, boolean>;
  itemsAfter?: string[];
}

/** One game: the Sim + the real cutscene system + the runtime's body rules, stepped like story-runtime's update(). */
class Game {
  readonly o: GameOpts;
  readonly sim: Sim;
  readonly cs: CutsceneSystem;
  readonly body: BodyControl;
  readonly fade = new FadeState();
  readonly camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.05, 300);
  /** The PlayerController slice both the cutscene bindings and the body rules drive (one object, as in the game). */
  readonly player = {
    enabled: true,
    lookEnabled: true,
    breathAllowed: true,
    yaw: 0,
    pitch: 0,
    teleport: (w: P3, yaw: number, pitch: number) => {
      this.sim.placeAt(worldToPlan(w) as P3);
      this.player.yaw = yaw;
      this.player.pitch = pitch;
      this.placed.push(this.sim.t);
    },
    applyCamera: () => this.syncCamera(),
  };
  readonly interact = { enabled: true };
  readonly hides: { readonly active: { id: string } | null; inputEnabled: boolean };
  reading = false;
  endCard = false;
  // recorders
  readonly ui = { fade: 0, letterbox: 0, card: null as string | null, prompt: null as string | null, skipHint: false };
  readonly acquired = new Set<string>();
  readonly loops = new Set<string>();
  stormAuto = true;
  dof: unknown = null;
  readonly docs: string[] = [];
  readonly voices: string[] = [];
  readonly placed: number[] = [];
  readonly started: string[] = [];
  readonly ended: { id: string; skipped: boolean }[] = [];
  readonly overlays = new Set<string>();
  readonly gates: { id: string; t0: number; t1: number | null }[] = [];
  readonly violations: string[] = [];
  readonly deaths: ForcedDeath[] = [];
  readonly saves = new Map<CheckpointId, string>();
  readonly respawnTimes: number[] = [];
  private readonly cpFirst = new Map<CheckpointId, number>();
  private pendingSave: CheckpointId[] = [];
  private lastGate: string | null = null;
  /** E already tapped for the key gate on screen (a press is one frame, as Input.wasPressed). */
  private keyTapped = false;

  constructor(o: GameOpts = {}, save?: SaveGame) {
    this.o = o;
    const g = this;
    this.hides = {
      get active() {
        return g.sim.hiddenIn ? { id: g.sim.hiddenIn } : null;
      },
      inputEnabled: true,
    };
    let cs: CutsceneSystem | null = null;
    this.sim = new Sim({
      seed: o.seed ?? 1,
      earlyFinale: o.earlyFinale,
      hallFirst: o.hallFirst,
      host: (sim) => {
        cs = createCutsceneSystem({
          ctx: { settings: { fovDeg: 70 }, flags: sim.flags, events: sim.events as any },
          camera: this.camera,
          pipeline: () => ({ setCutscene: (fx: unknown) => (this.dof = fx) }),
          player: this.player,
          audio: {
            play: () => null,
            layers: {
              loop: (k: string) => this.loops.add(k),
              stopLoop: (k: string) => this.loops.delete(k),
              setScore: () => {},
              stinger: () => {},
              setWeather: () => {},
              setHeartRate: () => {},
            },
          },
          characters: {
            has: () => true,
            place: () => {},
            setVisible: () => {},
            play: () => true,
            acquire: (id) => this.acquired.add(id),
            release: (id) => this.acquired.delete(id),
            attach: () => {},
            pose: (id) => (id === 'ada' && sim.ada ? { pos: sim.ada.pos, heading: sim.ada.facing } : null),
          },
          sayTrigger: (t) => this.voices.push(t),
          hooks: { stormAuto: (on) => (this.stormAuto = on), fx: () => {}, dressing: () => {}, lightning: () => {} },
          seen: memorySeenStore(o.skip ? ALL_SEEN : []),
        });
        return {
          playCutscene: (id, done) => cs!.player.playCutscene(id, done),
          // story-runtime: the page goes up (journal + reading overlay) and interaction stops under it
          document: (doc) => {
            this.docs.push(doc.id);
            this.reading = true;
            this.interact.enabled = false;
          },
          // story-runtime playerCanSee: nothing is seen through the black fade
          playerCanSee: (p) => !this.fade.black && sim.playerCanSee(p),
          end: () => {
            sim.ended = true;
            this.fade.hold();
            this.endCard = true;
          },
        };
      },
    });
    this.cs = cs!;
    // node has no DOM, so the bindings built no overlay: record what the cutscene UI would show instead (the player
    // reads deps.ui at call time; this is the same deps object it holds)
    this.cs.deps.ui = {
      overlay: (f, b) => {
        this.ui.fade = f;
        this.ui.letterbox = b;
      },
      card: (t) => (this.ui.card = t),
      subtitle: () => {},
      prompt: (t) => (this.ui.prompt = t),
      skipHint: (v) => (this.ui.skipHint = v),
    };
    // registered after the Director's own listeners, as story-runtime does
    this.body = createBodyControl({
      events: this.sim.events,
      player: this.player,
      interact: this.interact,
      hides: this.hides,
      hasCutscenePlayer: () => true,
      fade: (to, sec) => this.fade.fade(to, sec),
      snapBlackAfter: (sec) => this.fade.snapBlackAfter(sec),
    });
    const ev = this.sim.events;
    ev.on('cutscene:start', ({ id }) => this.started.push(id));
    ev.on('cutscene:end', ({ id, skipped }) => this.ended.push({ id, skipped }));
    ev.on('checkpoint', ({ id }) => {
      const cp = id as CheckpointId;
      if (!this.cpFirst.has(cp)) {
        this.cpFirst.set(cp, this.sim.t);
        if (o.saveAtCheckpoints) this.pendingSave.push(cp);
      }
    });
    ev.on('player:respawn', ({ checkpoint }) => {
      this.respawnTimes.push(this.sim.t);
      const d = this.deaths.find((x) => x.respawnedAt === undefined);
      if (!d) return;
      const s = this.sim.director.story.s;
      d.respawnedAt = checkpoint as CheckpointId;
      d.respawnPos = [...this.sim.pos] as P3;
      d.beatAfter = s.beat;
      d.flagsAfter = { ...s.flags };
      d.itemsAfter = [...this.sim.items].sort();
    });
    this.sim.beforeStep.push(() => this.before());
    this.sim.afterStep.push(() => this.after());
    this.sim.onVerb.push((verb, what) => this.verb(verb, what));
    if (save) {
      this.sim.restoreHost(save.host!);
      this.sim.director.restore(save);
    }
    this.syncCamera();
  }

  private syncCamera(): void {
    if (this.cs?.cameraHeld) return;
    const w = planToWorld(this.sim.eye());
    this.camera.position.set(w[0], w[1], w[2]);
    this.player.yaw = this.sim.facing - Math.PI / 2;
  }

  private bad(msg: string): void {
    if (this.violations.length < 40) this.violations.push(`${this.sim.t.toFixed(2)} ${this.sim.director.story.beat}: ${msg}`);
  }

  /** A Director cutscene (not a C4 overlay segment) is on. */
  private get directorCutscene(): string | null {
    const a = this.cs.player.active;
    return a && !a.startsWith('C4') ? a : null;
  }

  private before(): void {
    // story-runtime: E / Esc / click / a movement key closes the page; the scripted player just walks on
    if (this.reading) {
      this.reading = false;
      this.interact.enabled = true;
    }
  }

  private verb(verb: string, what: string): void {
    // the scripted player must never do what the real body could not (that would hide a soft-lock)
    if ((verb === 'interact' || verb === 'pry') && !this.interact.enabled) this.bad(`${verb} ${what} while interaction is disabled`);
    if ((verb === 'hide' || verb === 'unhide') && !this.hides.inputEnabled) this.bad(`${verb} ${what} while hide input is disabled`);
    if (verb === 'breath' && !this.player.breathAllowed) this.bad(`breath held in ${what} while breath is not allowed`);
  }

  private after(): void {
    const sim = this.sim;
    const dt = sim.dt;
    this.fade.update(dt);
    // the scripted inputs a player gives a cutscene: hold E to pour, tap E for the key, hold breath in the wardrobe
    const gate = this.cs.player.waitingGate;
    const tap = gate === 'key' && !this.keyTapped;
    this.keyTapped = gate === 'key';
    this.cs.update(dt, {
      skipHeld: !!this.o.skip,
      interactHeld: gate === 'pour',
      interactPressed: tap,
      breathHeld: sim.holding,
    });
    this.cs.hem.update(sim.ada, sim.hiddenIn);
    this.body.frame(this.cs.lock, this.reading);
    this.syncCamera();
    // gate bookkeeping (a gate cleared by input, not by its 10–15 s timeout)
    const now = this.cs.player.waitingGate;
    if (now !== this.lastGate) {
      const open = this.gates.find((x) => x.t1 === null);
      if (open) open.t1 = sim.t;
      if (now) this.gates.push({ id: now, t0: sim.t, t1: null });
      this.lastGate = now;
    }
    const act = this.cs.player.active;
    if (act?.startsWith('C4')) this.overlays.add(act);
    this.invariants();
    this.forceDeath();
    this.saveIfDue();
  }

  private invariants(): void {
    const s = this.sim.director.story.s;
    const dc = this.directorCutscene;
    const lock = this.cs.lock;
    if (dc) {
      if (lock === 'none') this.bad(`${dc} runs without an input lock`);
      if (lock === 'full' && (this.player.enabled || this.player.lookEnabled)) this.bad(`${dc}: full lock but the body moves`);
      if (lock === 'look' && (this.player.enabled || !this.player.lookEnabled)) this.bad(`${dc}: look lock should freeze the feet and free the eyes`);
      if (this.interact.enabled) this.bad(`${dc}: interaction enabled under a cutscene`);
      if (this.hides.inputEnabled || this.player.breathAllowed) this.bad(`${dc}: hide / breath input live under a cutscene`);
    } else if (!s.dead && !this.sim.cutscene) {
      // gameplay owns the body (a C4 overlay may run: it must never block)
      if (lock !== 'none') this.bad(`lock '${lock}' left on in gameplay`);
      if (!this.player.enabled || !this.player.lookEnabled) this.bad('body still disabled in gameplay');
      if (!this.interact.enabled && !this.reading) this.bad('interaction still disabled in gameplay');
      if (!this.hides.inputEnabled) this.bad('hide input still disabled in gameplay');
      if (!this.player.breathAllowed) this.bad('breath not allowed in gameplay');
      if (this.body.inputLocked(lock)) this.bad('F / Tab still locked in gameplay');
      if (!this.cs.player.active) {
        if (this.cs.cameraHeld) this.bad('camera still held by a cutscene');
        if (this.ui.letterbox !== 0 || this.ui.prompt !== null || this.ui.skipHint) this.bad(`cutscene UI left on ${JSON.stringify(this.ui)}`);
        if (this.acquired.size) this.bad(`characters still acquired: ${[...this.acquired]}`);
        if (this.dof !== null) this.bad('cutscene DOF left on');
        if (this.loops.size) this.bad(`cutscene loops left playing: ${[...this.loops]}`);
      }
    }
    // after a respawn the story fade must come back to clear (1.4 s fade-in)
    const lastRespawn = this.respawnTimes[this.respawnTimes.length - 1];
    if (lastRespawn !== undefined && !s.dead && !this.endCard && this.sim.t - lastRespawn > 1.6 && this.sim.t - lastRespawn < 1.6 + this.sim.dt * 1.5) {
      if (this.fade.opacity !== 0 || this.fade.black) this.bad(`fade stuck at ${this.fade.opacity} (black ${this.fade.black}) after the respawn`);
    }
  }

  private forceDeath(): void {
    const want = this.o.forceDeathAt;
    if (!want) return;
    const sim = this.sim;
    const s = sim.director.story.s;
    const cp = s.checkpoint;
    if (!cp || !want.includes(cp) || this.deaths.some((d) => d.cp === cp)) return;
    const t0 = this.cpFirst.get(cp);
    if (t0 === undefined || sim.t - t0 < 2 || s.dead || s.cutscene || sim.cutscene || this.directorCutscene) return;
    if (cp === 'CP2' && s.beat !== 'B05') return; // C2-ESCAPE: CP2 is the stair top (B05)
    this.deaths.push({ cp, beat: s.beat, flags: { ...s.flags }, items: [...sim.items].sort(), t: sim.t });
    sim.director.apply(sim.director.story.handle({ type: 'ai', event: { type: 'catch', cause: 'bump' } }));
  }

  private saveIfDue(): void {
    if (!this.pendingSave.length) return;
    const s = this.sim.director.story.s;
    if (s.dead || s.cutscene || this.sim.cutscene || this.cs.player.active) return;
    for (const cp of this.pendingSave) this.saves.set(cp, serializeSave(this.sim.director.snapshot(this.sim.hostState())));
    this.pendingSave = [];
  }

  play(): this {
    this.sim.play();
    return this;
  }

  resume(): this {
    this.sim.resume();
    return this;
  }
}

/** Nothing left dangling once the game is over. */
function assertSettled(g: Game, label: string): void {
  const sim = g.sim;
  assert.deepEqual(sim.softLocks, [], `${label}: soft-lock`);
  assert.ok(sim.ended, `${label}: did not reach the end (beat ${sim.director.story.beat}, t ${sim.t.toFixed(1)})`);
  assert.ok(sim.flags.get('game_over'), `${label}: game_over`);
  assert.deepEqual(g.violations, [], `${label}: body / lock violations`);
  // cutscenes: each start ended exactly once, nothing running
  const starts = g.started.length;
  assert.equal(g.ended.length, starts, `${label}: every cutscene:start has its cutscene:end (${g.started} / ${g.ended.map((e) => e.id)})`);
  assert.equal(g.cs.player.active, null, `${label}: a cutscene is still running`);
  assert.equal(g.body.cutscene, null, `${label}: the runtime still thinks ${g.body.cutscene} runs`);
  assert.equal(sim.director.cutscene, null, `${label}: the Director still in a cutscene`);
  // input: nothing locked
  assert.equal(g.cs.lock, 'none', `${label}: cutscene input lock`);
  assert.ok(g.player.enabled && g.player.lookEnabled, `${label}: body left disabled`);
  assert.ok(g.interact.enabled, `${label}: interaction left disabled`);
  assert.ok(g.hides.inputEnabled && g.player.breathAllowed, `${label}: hide / breath input left disabled`);
  assert.equal(g.body.inputLocked(g.cs.lock), false, `${label}: F / Tab left locked`);
  assert.equal(g.reading, false, `${label}: a reading page left up`);
  // cutscene world state handed back
  assert.equal(g.cs.cameraHeld, false, `${label}: camera still held`);
  assert.equal(g.dof, null, `${label}: DOF left on`);
  assert.equal(g.loops.size, 0, `${label}: loops left: ${[...g.loops]}`);
  assert.equal(g.acquired.size, 0, `${label}: characters left acquired: ${[...g.acquired]}`);
  assert.ok(g.stormAuto, `${label}: storm auto-strikes left off`);
  assert.deepEqual(g.ui, { fade: 0, letterbox: 0, card: null, prompt: null, skipHint: false }, `${label}: cutscene overlay left on`);
  // the only thing on screen is the end card (black by design)
  assert.ok(g.endCard && g.fade.black && g.fade.opacity === 1, `${label}: end card`);
}

function assertCutscenes(g: Game, label: string, opts: { c4?: boolean; skipped?: boolean } = {}): void {
  const once = g.started.filter((id) => id !== 'death' && id !== 'C2_replay');
  assert.deepEqual(once, [...DIRECTOR_CUTSCENES], `${label}: C1, C2, C3, C5, C6, C7 once each, in order`);
  for (const e of g.ended) {
    if (e.id === 'death') assert.equal(e.skipped, false, `${label}: the death cutaway is never skipped`);
    else assert.equal(e.skipped, !!opts.skipped, `${label}: ${e.id} skipped=${e.skipped}`);
  }
  if (opts.c4) for (const seg of ['C4_approach', 'C4_hem', 'C4_look']) assert.ok(g.overlays.has(seg), `${label}: C4 overlay ${seg} played (${[...g.overlays]})`);
}

test('e2e: main route B01 → B13 through the real cutscene system and body rules', () => {
  const g = new Game({ seed: 1 }).play();
  assertSettled(g, 'main');
  assert.deepEqual([...new Set(g.sim.beats)], [...BEATS], 'beats in order');
  assert.deepEqual([...new Set(g.sim.checkpoints)], [...CHECKPOINTS], 'checkpoints in order');
  assertCutscenes(g, 'main', { c4: true });
  // interactive gates: C6 pour (hold E 1.2 s) and key (tap E) cleared by input, well before their timeouts
  const pour = g.gates.find((x) => x.id === 'pour');
  const key = g.gates.find((x) => x.id === 'key');
  assert.ok(pour && pour.t1 !== null && pour.t1 - pour.t0 <= 1.2 + 0.2, `pour gate by input: ${JSON.stringify(pour)}`);
  assert.ok(key && key.t1 !== null && key.t1 - key.t0 <= 0.2, `key gate by input: ${JSON.stringify(key)}`);
  // the C4 look was a real prompt the player could answer (breath allowed under the overlay — checked every frame)
  assert.ok(g.gates.some((x) => x.id === 'c4_breath'), 'C4 breath prompt shown');
  // documents went up and came down; the ledger (3 pages), letter, ticket, sting guest book
  for (const d of ['ledger_p1', 'ledger_p2', 'ledger_p3', 'letter']) assert.ok(g.docs.includes(d), `document ${d} read (${g.docs})`);
  // cutscenes hand the body back where they leave it (C1, C2, C3, C5 place the player)
  assert.ok(g.placed.length >= 4, `player placed by cutscenes: ${g.placed.length}`);
  assert.equal(g.sim.deaths.length, 0);
});

test('e2e: a forced death at EVERY checkpoint CP1–CP8 respawns there with everything intact, then finishes', () => {
  const all = [...CHECKPOINTS];
  const g = new Game({ seed: 1, forceDeathAt: all }).play();
  assertSettled(g, 'deaths');
  assert.deepEqual([...new Set(g.sim.beats)], [...BEATS], 'beats in order');
  assertCutscenes(g, 'deaths');
  assert.deepEqual(
    g.deaths.map((d) => d.cp),
    all,
    'one forced death per checkpoint',
  );
  for (const d of g.deaths) {
    const sp = checkpointSpawn(layout, d.cp);
    assert.equal(d.respawnedAt, d.cp, `${d.cp}: respawned at its own checkpoint`);
    const pos = d.respawnPos!;
    assert.ok(Math.hypot(pos[0] - sp.pos[0], pos[1] - sp.pos[1], pos[2] - (sp.pos[2] - EYE)) < 1e-6, `${d.cp}: at spawn ${sp.id} (${pos})`);
    assert.equal(d.beatAfter, d.beat, `${d.cp}: beat unchanged`);
    assert.deepEqual(d.flagsAfter, d.flags, `${d.cp}: story flags unchanged`);
    assert.deepEqual(d.itemsAfter, d.items, `${d.cp}: inventory unchanged`);
  }
  // one death cutaway per death; nothing replays C2 any more (C2-ESCAPE: C2_replay retired)
  assert.equal(g.started.filter((id) => id === 'death').length, all.length);
  assert.equal(g.started.filter((id) => id === 'C2_replay').length, 0);
  // the story fade: black under each death, clear again after each respawn (checked 1.6 s after every respawn)
  assert.equal(g.respawnTimes.length, all.length);
});

test('e2e: a save at EVERY checkpoint CP1–CP8 restores into a fresh game (same beat, at the spawn) and finishes', () => {
  const a = new Game({ seed: 2, saveAtCheckpoints: true }).play();
  assertSettled(a, 'saving run');
  assert.deepEqual([...a.saves.keys()], [...CHECKPOINTS], 'a save per checkpoint');
  for (const cp of CHECKPOINTS) {
    const save = parseSave(a.saves.get(cp)!);
    assert.ok(save, `${cp}: save parses`);
    const beat = save!.story.beat;
    const b = new Game({ seed: 2 }, save!);
    const s = b.sim.director.story.s;
    assert.equal(s.beat, beat, `${cp}: beat restored`);
    assert.equal(s.checkpoint, cp, `${cp}: checkpoint restored`);
    const sp = checkpointSpawn(layout, cp);
    const pos = b.sim.pos;
    assert.ok(Math.hypot(pos[0] - sp.pos[0], pos[1] - sp.pos[1], pos[2] - (sp.pos[2] - EYE)) < 1e-6, `${cp}: restored at spawn ${sp.id}`);
    b.resume();
    assertSettled(b, `restored ${cp}`);
    const from = BEATS.indexOf(beat);
    assert.deepEqual([...new Set(b.sim.beats)], BEATS.slice(from), `${cp}: beats from ${beat} in order`);
  }
});

test('e2e: EARLY FINALE — the lit locket during the dress visit still plays C5–C7 and ends clean', () => {
  const g = new Game({ seed: 1, earlyFinale: true }).play();
  assertSettled(g, 'early finale');
  assert.deepEqual([...new Set(g.sim.beats)], [...BEATS]);
  assertCutscenes(g, 'early finale');
  assert.ok(g.sim.flags.get('dress_visit_done'), 'the wardrobe back opened');
});

test('e2e: EARLY FINALE + hall first — C5 before the can, B10/B11 skipped, the car waits for the can', () => {
  const g = new Game({ seed: 1, earlyFinale: true, hallFirst: true }).play();
  assertSettled(g, 'hall first');
  assert.deepEqual([...new Set(g.sim.beats)], BEATS.filter((b) => b !== 'B10' && b !== 'B11'));
  assertCutscenes(g, 'hall first');
});

test('e2e: skip path — every cutscene already seen and Space held: all skip (never death), nothing dangles', () => {
  const g = new Game({ seed: 3, skip: true, forceDeathAt: ['CP3'] }).play();
  assertSettled(g, 'skip');
  assert.deepEqual([...new Set(g.sim.beats)], [...BEATS]);
  assertCutscenes(g, 'skip', { skipped: true });
  assert.equal(g.deaths.length, 1);
});
