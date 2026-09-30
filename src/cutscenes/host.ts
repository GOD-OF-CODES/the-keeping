// CutscenePlayer: the adapter between the story Director (src/story/director.ts DirectorHost.playCutscene) and the
// game. PURE (no three.js): everything scene-specific is injected as CutsceneDeps — src/cutscenes/bindings.ts builds
// them from the real game objects, tests use fakes, src/cutscenes/preview.ts uses stubs.
//
// Contract with the Director (tested against the real Director in tests/cutscene-host.test.ts):
//  - playCutscene(id, done) returns true synchronously when the id is known (false → the Director's fallback timer)
//    and calls done(skipped) exactly once.
//  - It NEVER emits cutscene:start / cutscene:end itself (the Director emits both and listens to cutscene:end).
//  - Teardown (camera back to the player, input unlocked, DOF off, overlay cleared, loops stopped, characters
//    released, storm restored) happens BEFORE done(): done() may synchronously start the next cutscene (C6 → C7) or
//    respawn/teleport the player (death).
//  - If a Director cutscene is still running when another starts, the running one is skipped first (state applied)
//    and its done(true) fires before the new one begins. Overlays (C4, no done) are cancelled instead.

import { Sequencer } from './sequencer.ts';
import { isStateCue, type CameraPose, type CharId, type Cue, type CutsceneContext, type DofSettings, type DoorAction, type LockMode, type P3, type Timeline, type TimelineFactory, type VehiclePose } from './types.ts';

// ------------------------------------------------------------------ injected interfaces

/** The character lane (src/characters) — drive a character by clip name. */
export interface CharacterDirector {
  /** Loaded and drivable? Cues for characters that are not loaded are ignored. */
  has(id: CharId): boolean;
  /** Root at pos (feet, PLAN), facing heading (radians CCW from +x). glTF characters face PLAN −y at rotation 0,
   *  so the three root's rotation.y = heading + π/2. `arms` ignores place (its root is the camera). */
  place(id: CharId, pos: P3, heading: number): void;
  setVisible(id: CharId, visible: boolean): void;
  /** Play a clip; return false when the clip does not exist (the player then tries the cue's fallbacks).
   *  `at` = start offset in seconds (clamped to the clip: > duration means "hold the last frame"). */
  play(id: CharId, clip: string, o: { loop: boolean; fade: number; speed: number; at: number }): boolean;
  /** The cutscene owns the character: stop applying AI output to it until release(). */
  acquire?(id: CharId): void;
  release?(id: CharId): void;
  /** Reparent a prop (layout id or character sub-mesh name) to a bone, or back to the world (bone null). */
  attach?(id: CharId, prop: string, bone: string | null): void;
  /** Current root (death cutaway stages the grab from where Ada is). */
  pose?(id: CharId): { pos: P3; heading: number } | null;
}

export interface CutsceneCamera {
  /** Apply a PLAN pose (the adapter converts, calls lookAt, adds pose.shake, sets fov). */
  apply(p: CameraPose): void;
  /** Hand the camera back to the player (restore settings fov, re-sync the rig). */
  release(): void;
}

export interface CutsceneAudio {
  /** One-shot. pos is PLAN (the adapter converts to WORLD for audio.play). */
  play(id: string, o: { pos?: P3; room?: string; gain?: number; rate?: number }): void;
  loop?(key: string, id: string, o: { gain?: number; fade?: number }): void;
  stopLoop?(key: string, fade?: number): void;
  score?(state: 'drone' | 'chase' | 'blue_hour' | 'none', stinger?: string): void;
  weather?(w: { rain: number; wind: number; inside: number; surface?: 'roof' | 'glass' | 'porch' | 'car' | 'gravel' }): void;
  heartbeat?(bpm: number): void;
}

export interface CutsceneLights {
  lightning?(strength: number): void;
  stormAuto?(on: boolean): void;
  set?(id: string, scale: number, fadeS: number): void;
  gutter?(id: string, d: number): void;
  castShadow?(id: string, on: boolean): void;
  flashlight?(on: boolean, tremble: number): void;
  runtime?(id: string, on: boolean, scale: number): void;
}

export interface CutsceneWorld {
  door?(id: string, action: DoorAction): void;
  propVisible?(id: string, visible: boolean): void;
  dressing?(set: string, on: boolean): void;
  fx?(id: string, params: Record<string, number | string | boolean>): void;
  /** Where gameplay resumes: EYE (PLAN), heading (CCW from +x), pitch. */
  placePlayer?(eye: P3, heading: number, pitch: number): void;
  vehicle?(pose: VehiclePose | null): void;
}

export interface CutsceneUi {
  /** fade 0..1 (black), letterbox 0..1. */
  overlay?(fade: number, letterbox: number): void;
  card?(text: string | null, style: 'title' | 'small'): void;
  subtitle?(speaker: string, text: string, durationMs: number, caption: boolean): void;
  prompt?(text: string | null): void;
  /** "Hold to skip" hint: visible while a skippable cutscene runs, progress 0..1 while held. */
  skipHint?(visible: boolean, progress: number): void;
}

export interface CutsceneDeps {
  camera: CutsceneCamera;
  characters?: CharacterDirector;
  audio?: CutsceneAudio;
  /** A voice-script trigger (host resolves to line ids: buildTriggerIndex/linesForTrigger + VoicePlayer.play). */
  voice?(trigger: string): void;
  /** Stop voices + subtitles (on skip). */
  stopVoices?(): void;
  lights?: CutsceneLights;
  world?: CutsceneWorld;
  ui?: CutsceneUi;
  input?: { lock(mode: LockMode): void };
  render?: { dof(d: DofSettings | null): void };
  /** Snapshot for timeline factories (player eye, Ada's pose, flags). */
  context?(): Omit<CutsceneContext, 'seen'>;
}

/** Which cutscenes were seen (skippable after the first view). */
export interface SeenStore {
  has(id: string): boolean;
  add(id: string): void;
}

export function memorySeenStore(ids: string[] = []): SeenStore {
  const s = new Set(ids);
  return { has: (id) => s.has(id), add: (id) => void s.add(id) };
}

/** localStorage-backed (try/catch everywhere: private windows / blocked storage fall back to memory). */
export function localSeenStore(key = 'keeping.cutscenesSeen'): SeenStore {
  const mem = new Set<string>();
  const ls = (): Storage | null => {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
      return null;
    }
  };
  try {
    const raw = ls()?.getItem(key);
    if (raw) for (const id of JSON.parse(raw) as string[]) if (typeof id === 'string') mem.add(id);
  } catch {
    /* ignore */
  }
  return {
    has: (id) => mem.has(id),
    add: (id) => {
      mem.add(id);
      try {
        ls()?.setItem(key, JSON.stringify([...mem]));
      } catch {
        /* ignore */
      }
    },
  };
}

/** Seen-ness is shared between a cutscene and its replay variant. */
const SEEN_ALIAS: Record<string, string> = { C2_replay: 'C2' };

// ------------------------------------------------------------------ the player

export interface CutscenePlayerOptions {
  deps: CutsceneDeps;
  library: Record<string, TimelineFactory>;
  seen?: SeenStore;
  /** Seconds the skip input must be held (default 0.8). */
  skipHoldS?: number;
}

interface Running {
  id: string;
  seq: Sequencer;
  done: ((skipped: boolean) => void) | null;
  overlay: boolean;
  acquired: Set<CharId>;
  loops: Set<string>;
  dofOn: boolean;
  cameraHeld: boolean;
  stormOff: boolean;
  shadows: Set<string>;
  lock: LockMode;
}

export class CutscenePlayer {
  private readonly deps: CutsceneDeps;
  private readonly library: Record<string, TimelineFactory>;
  private readonly seen: SeenStore;
  private readonly skipHoldS: number;
  private cur: Running | null = null;
  private skipHeld = 0;
  /** Every cue the player dispatched (debug / tests): `${id}@${t}:${type}`. Capped. */
  readonly log: string[] = [];

  constructor(o: CutscenePlayerOptions) {
    this.deps = o.deps;
    this.library = o.library;
    this.seen = o.seen ?? memorySeenStore();
    this.skipHoldS = o.skipHoldS ?? 0.8;
  }

  /** DirectorHost.playCutscene — pass directly: `playCutscene: player.playCutscene`. */
  readonly playCutscene = (id: string, done: (skipped: boolean) => void): boolean => this.play(id, done);

  get active(): string | null {
    return this.cur?.id ?? null;
  }
  get time(): number {
    return this.cur?.seq.time ?? 0;
  }
  get lock(): LockMode {
    return this.cur?.lock ?? 'none';
  }
  get waitingGate(): string | null {
    return this.cur?.seq.waitingGate ?? null;
  }
  has(id: string): boolean {
    return id in this.library;
  }
  wasSeen(id: string): boolean {
    return this.seen.has(SEEN_ALIAS[id] ?? id);
  }

  /**
   * Start a cutscene. `done` = the Director's callback (omit for overlays such as C4, which run alongside gameplay
   * and never block the story). Returns false for unknown ids.
   */
  play(id: string, done?: (skipped: boolean) => void, o: { timeline?: Timeline } = {}): boolean {
    const factory = this.library[id];
    if (!factory && !o.timeline) return false;
    // finish whatever runs (a done() callback may synchronously start yet another cutscene: finish those too)
    for (let guard = 0; this.cur && guard < 8; guard++) {
      if (this.cur.overlay) this.cancel();
      else this.forceFinish();
    }
    if (this.cur) this.cancel();
    const base = this.deps.context?.() ?? { player: { eye: [0, 0, 1.6] as P3, heading: 0, pitch: 0 }, ada: null, flags: new Map() };
    const tl = o.timeline ?? factory!({ ...base, seen: this.wasSeen(id) });
    const run: Running = {
      id,
      seq: null as unknown as Sequencer,
      done: done ?? null,
      overlay: !done,
      acquired: new Set(),
      loops: new Set(),
      dofOn: false,
      cameraHeld: false,
      stormOff: false,
      shadows: new Set(),
      lock: tl.lock,
    };
    run.seq = new Sequencer(tl, {
      cue: (c, info) => this.onCue(run, c, info.skipped, info.late),
      camera: (p) => this.onCamera(run, p),
      vehicle: (p) => this.deps.world?.vehicle?.(p),
      move: (ch, pos, heading) => {
        if (this.charOk(ch)) {
          this.acquire(run, ch);
          this.deps.characters!.place(ch, pos, heading);
        }
      },
      overlay: (fade, box) => this.deps.ui?.overlay?.(fade, box),
      gate: (gid, prompt) => this.deps.ui?.prompt?.(gid ? (prompt ?? null) : null),
      end: (skipped) => this.finish(run, skipped),
    });
    this.cur = run;
    this.skipHeld = 0;
    if (!run.overlay) this.deps.input?.lock(tl.lock);
    this.deps.ui?.skipHint?.(this.canSkip(), 0);
    run.seq.update(0); // t = 0 cues + first camera pose, this frame
    return true;
  }

  /** Advance the running cutscene (call once per frame with the game-loop dt; dt = 0 while paused). */
  update(dt: number): void {
    this.cur?.seq.update(dt);
  }

  canSkip(): boolean {
    const c = this.cur;
    if (!c || c.overlay) return false;
    if (c.seq.timeline.skippable === false) return false;
    return this.wasSeen(c.id);
  }

  /** Skip now (if allowed; `force` = debug/preview, ignores seen/skippable). The world ends in the cutscene's end
   *  state; done(true). */
  skip(force = false): boolean {
    if (!this.cur || this.cur.overlay) return false;
    if (!force && !this.canSkip()) return false;
    this.deps.stopVoices?.();
    return this.cur!.seq.skip();
  }

  /** Call every frame with whether the skip input is held; skips after skipHoldS. */
  holdSkip(held: boolean, dt: number): void {
    if (!this.canSkip()) {
      this.skipHeld = 0;
      return;
    }
    this.skipHeld = held ? this.skipHeld + dt : 0;
    this.deps.ui?.skipHint?.(true, Math.min(1, this.skipHeld / this.skipHoldS));
    if (this.skipHeld >= this.skipHoldS) {
      this.skipHeld = 0;
      this.skip();
    }
  }

  /** The player completed an interactive gate (hold-E pour, key turn …). */
  resolveGate(id: string): void {
    this.cur?.seq.resolveGate(id);
  }

  /** Stop an overlay (or any cutscene) without applying its remaining cues; done is NOT called. */
  cancel(): void {
    const c = this.cur;
    if (!c) return;
    c.seq.abort();
    this.teardown(c);
    this.cur = null;
  }

  // ------------------------------------------------------------------ internals

  private forceFinish(): void {
    const c = this.cur;
    if (!c) return;
    this.deps.stopVoices?.();
    if (!c.seq.skip()) this.cancel();
  }

  private charOk(ch: CharId): boolean {
    return !!this.deps.characters?.has(ch);
  }

  private acquire(run: Running, ch: CharId): void {
    if (run.acquired.has(ch)) return;
    run.acquired.add(ch);
    this.deps.characters?.acquire?.(ch);
  }

  private onCamera(run: Running, p: CameraPose | null): void {
    if (p) {
      run.cameraHeld = true;
      this.deps.camera.apply(p);
    } else if (run.cameraHeld) {
      run.cameraHeld = false;
      this.deps.camera.release();
    }
  }

  private onCue(run: Running, c: Cue, skipped: boolean, late: number): void {
    if (skipped && !isStateCue(c)) return;
    if (this.log.length > 2000) this.log.splice(0, 500);
    this.log.push(`${run.id}@${c.t}:${c.type}${skipped ? '(skip)' : ''}`);
    const d = this.deps;
    const chars = d.characters;
    switch (c.type) {
      case 'clip': {
        if (!this.charOk(c.char)) return;
        this.acquire(run, c.char);
        const o = { loop: !!c.loop, fade: skipped ? 0 : (c.fade ?? 0.25), speed: c.speed ?? 1, at: late };
        if (!chars!.play(c.char, c.clip, o)) for (const f of c.fallback ?? []) if (chars!.play(c.char, f, o)) break;
        return;
      }
      case 'place':
        if (!this.charOk(c.char)) return;
        this.acquire(run, c.char);
        chars!.place(c.char, c.pos, c.heading);
        return;
      case 'visible':
        if (!this.charOk(c.char)) return;
        this.acquire(run, c.char);
        chars!.setVisible(c.char, c.visible);
        return;
      case 'release':
        if (!this.charOk(c.char)) return;
        run.acquired.delete(c.char);
        chars!.release?.(c.char);
        return;
      case 'attach':
        if (!this.charOk(c.char)) return;
        chars!.attach?.(c.char, c.prop, c.bone);
        return;
      case 'sfx':
        d.audio?.play(c.id, { pos: c.pos, room: c.room, gain: c.gain, rate: c.rate });
        return;
      case 'loop':
        if (c.id) {
          run.loops.add(c.key);
          d.audio?.loop?.(c.key, c.id, { gain: c.gain, fade: c.fade });
        } else {
          run.loops.delete(c.key);
          d.audio?.stopLoop?.(c.key, c.fade);
        }
        return;
      case 'voice':
        d.voice?.(c.trigger);
        return;
      case 'subtitle':
        d.ui?.subtitle?.(c.speaker, c.text, c.d * 1000, !!c.caption);
        return;
      case 'card':
        d.ui?.card?.(c.text, c.style ?? 'title');
        return;
      case 'light':
        switch (c.op) {
          case 'lightning':
            d.lights?.lightning?.(c.strength ?? 1);
            return;
          case 'storm_auto':
            run.stormOff = !c.on;
            d.lights?.stormAuto?.(c.on);
            return;
          case 'set':
            d.lights?.set?.(c.id, c.scale, skipped ? 0 : (c.fadeS ?? 0));
            return;
          case 'gutter':
            if (skipped) d.lights?.set?.(c.id, 0, 0);
            else d.lights?.gutter?.(c.id, c.d);
            return;
          case 'cast_shadow':
            if (c.on) run.shadows.add(c.id);
            else run.shadows.delete(c.id);
            d.lights?.castShadow?.(c.id, c.on);
            return;
          case 'flashlight':
            d.lights?.flashlight?.(c.on, c.tremble ?? 0);
            return;
          case 'runtime':
            d.lights?.runtime?.(c.id, c.on, c.scale ?? 1);
            return;
        }
        return;
      case 'door':
        d.world?.door?.(c.id, c.action);
        return;
      case 'prop':
        d.world?.propVisible?.(c.id, c.visible);
        return;
      case 'dressing':
        d.world?.dressing?.(c.set, c.on);
        return;
      case 'fx':
        d.world?.fx?.(c.id, c.params ?? {});
        return;
      case 'score':
        d.audio?.score?.(c.state, skipped ? undefined : c.stinger);
        return;
      case 'weather':
        d.audio?.weather?.({ rain: c.rain, wind: c.wind, inside: c.inside, surface: c.surface });
        return;
      case 'heartbeat':
        d.audio?.heartbeat?.(c.bpm);
        return;
      case 'dof':
        run.dofOn = !!c.dof;
        d.render?.dof(c.dof);
        return;
      case 'lock':
        run.lock = c.mode;
        if (!run.overlay) d.input?.lock(c.mode);
        return;
      case 'player':
        d.world?.placePlayer?.(c.pos, c.heading, c.pitch ?? 0);
        return;
      case 'gate':
      case 'mark':
        return;
    }
  }

  private teardown(run: Running): void {
    const d = this.deps;
    if (run.cameraHeld) {
      run.cameraHeld = false;
      d.camera.release();
    }
    if (run.dofOn) d.render?.dof(null);
    for (const k of run.loops) d.audio?.stopLoop?.(k, 0.6);
    run.loops.clear();
    for (const id of run.shadows) d.lights?.castShadow?.(id, false);
    run.shadows.clear();
    if (run.stormOff) d.lights?.stormAuto?.(true);
    for (const ch of run.acquired) d.characters?.release?.(ch);
    run.acquired.clear();
    if (!run.overlay) {
      d.ui?.overlay?.(0, 0);
      d.ui?.card?.(null, 'title');
      d.input?.lock('none');
    }
    d.ui?.prompt?.(null);
    d.ui?.skipHint?.(false, 0);
    if (run.seq.timeline.vehicle?.length) d.world?.vehicle?.(null);
  }

  private finish(run: Running, skipped: boolean): void {
    if (this.cur !== run) return;
    this.teardown(run);
    this.cur = null;
    this.seen.add(SEEN_ALIAS[run.id] ?? run.id);
    run.done?.(skipped);
  }
}
