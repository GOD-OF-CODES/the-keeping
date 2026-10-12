// Director: the one runtime adapter for the AI + story lane. It owns an AdaBrain and a Story, listens to the event
// bus (noise, thunder, interact, flag, player:hide, cutscene:end), emits bus events (ai:state, beat:enter/exit,
// flag, checkpoint, player:death, player:respawn, cutscene:start/end in fallback mode) and calls a HOST for
// everything else (doors, cutscenes, voices, teleport …). No three.js: the host translates to the world.
// Integration steps: docs/AI.md.

import type { EventBus, GameEvents } from '../core/events.ts';
import type { LevelLayout, P3 } from '../shared/layout-types.ts';
import { AdaBrain, type AdaSnapshot } from '../ai/ada-brain.ts';
import type { AdaOutput, AiEvent, DoorState, PlayerView } from '../ai/types.ts';
import { Story, type CutsceneGate, type CutsceneId, type StoryCommand } from './beats.ts';
import { c4cCarryEnd } from '../cutscenes/c4c-step.ts';
import { checkpointSpawn, SAVE_VERSION, type SaveGame } from './checkpoints.ts';
import { DOCUMENTS, type StoryDocument } from './documents.ts';
import type { BeatId, EscapeState } from './escape-state.ts';

export interface DirectorHost {
  /** Sampled every tick (PLAN space). */
  player(): PlayerView;
  /** 'open' (open/ajar), 'closed', 'locked' (bolted/boarded/key-locked). */
  doorState(doorId: string): DoorState;
  /** Unobstructed line between two PLAN points (static collision; closed door leaves block). */
  lineOfSight(a: P3, b: P3): boolean;
  /** Could the player see a figure standing at PLAN point p right now? (never relocate her in view) */
  playerCanSee(p: P3): boolean;

  // ---- effects (all optional)
  /** Ada pushes a closed, unlocked door (slowly unless fast). */
  pushDoor?(doorId: string, fast: boolean): void;
  door?(doorId: string, action: 'rope_open' | 'rope_close' | 'lock' | 'unlock'): void;
  /** Play a cutscene; call done() when it ends. Return false (or omit) to let the director time it out. */
  playCutscene?(id: CutsceneId, done: (skipped: boolean) => void): boolean;
  /** A voice-script trigger (use buildTriggerIndex/linesForTrigger + VoicePlayer.play). */
  voice?(trigger: string): void;
  sfx?(id: string, pos?: P3, room?: string): void;
  /** Strike lightning now (flash + thunder event). */
  lightning?(reason: string): void;
  storm?(intervalSec: number, rumbleScale: number): void;
  /** Stuck 90 s: lightning picks out this interactable (prop id, door id or board_k). */
  hint?(target: string): void;
  toast?(text: string): void;
  prompt?(text: string): void;
  document?(doc: StoryDocument): void;
  removeItem?(itemId: string): void;
  setPropVisible?(propId: string, visible: boolean): void;
  /** Respawn: put the player at a layout spawn (eye position, yaw heading, pitch). */
  teleport?(spawnId: string, pos: P3, yaw: number, pitch: number): void;
  raiseLocket?(): void;
  end?(): void;
  /** Per-tick AI output for the character lane (root, facing, head, anim, tells). */
  ada?(out: AdaOutput): void;
}

export interface DirectorOptions {
  layout: LevelLayout;
  events: EventBus<GameEvents>;
  host: DirectorHost;
  /** ctx.flags (shared story flags). */
  flags?: Map<string, boolean>;
  seed?: number;
  /** Seconds a cutscene lasts when the host does not play it (default: 1.5; 'death' uses 3). */
  cutsceneFallbackS?: number;
}

/** CUTSCENES-PLAN §4 gate numbers: ≥ 6 m away, a floor apart (> 2 m of height), one optional cutscene per 45 s. */
const GATE_DIST_M = 6;
const GATE_FLOOR_DZ = 2;
const GATE_PACING_S = 45;
const OPTIONAL_IDS: ReadonlySet<string> = new Set(['C2b', 'C4a', 'C4c', 'C5b']);

export class Director {
  readonly brain: AdaBrain;
  readonly story: Story;
  readonly layout: LevelLayout;
  private readonly events: EventBus<GameEvents>;
  private readonly host: DirectorHost;
  private readonly flags: Map<string, boolean>;
  private readonly offs: (() => void)[] = [];
  private readonly fallbackS: number;
  private fallback: { id: CutsceneId; t: number } | null = null;
  private inCutscene: CutsceneId | null = null;
  private last: AdaOutput | null = null;
  private beat: BeatId | null = null;
  /** CUTSCENES-PLAN §4: optional cutscenes waiting for their safety gate (FIFO; not persisted — a death or restore
   *  forgets them, and the story re-requests on its next trigger). */
  private pending: { id: CutsceneId; gate: CutsceneGate; waitS: number; t: number }[] = [];
  /** Story time an optional cutscene last ended (pacing: one per 45 s of gameplay in B05–B10). */
  private lastOptionalEndT = -Infinity;
  private clock = 0;

  constructor(o: DirectorOptions) {
    this.layout = o.layout;
    this.events = o.events;
    this.host = o.host;
    this.flags = o.flags ?? new Map();
    this.fallbackS = o.cutsceneFallbackS ?? 1.5;
    const world = {
      doorState: (id: string) => this.host.doorState(id),
      lineOfSight: (a: P3, b: P3) => this.host.lineOfSight(a, b),
      playerCanSee: (p: P3) => (this.inCutscene ? false : this.host.playerCanSee(p)),
    };
    this.brain = new AdaBrain(o.layout, world, { seed: o.seed });
    this.story = new Story();
    const ev = o.events;
    this.offs.push(
      ev.on('noise', (n) => this.brain.noise(n)),
      ev.on('thunder', (t) => this.brain.thunderRoll(t.delayMs, t.durationMs)),
      ev.on('interact', ({ id, action }) => this.apply(this.story.handle({ type: 'interact', id, action }))),
      ev.on('flag', ({ name, value }) => this.apply(this.story.handle({ type: 'flag', name, value }))),
      ev.on('player:hide', ({ hideId, inside }) => this.apply(this.story.handle({ type: 'hide', hideId, inside }))),
      ev.on('cutscene:end', ({ id }) => this.cutsceneEnded(id, false)),
    );
  }

  /** New game (B01, C1). */
  start(): void {
    this.apply(this.story.start());
  }

  /** Debug: jump to a beat with the flags a normal run would have (then respawn at its checkpoint). */
  startAt(beat: BeatId): void {
    if (beat === 'B04') beat = 'B05'; // C2-ESCAPE: B04 is the C2c cutscene only — a debug start begins at its end
    this.story.restore(Story.debugStateAt(beat));
    this.brain.clearScripted();
    // before C2 she is offstage (on the table, a cutscene/tableau prop); after C5 she is gone
    const early = beat === 'B01' || beat === 'B02' || beat === 'B03';
    if (early || beat === 'B12' || beat === 'B13') this.brain.setScripted('hidden');
    this.apply(this.story.resumeCommands());
    if (beat === 'B05') {
      // C2-ESCAPE: B04 is the C2c cutscene only; a debug start there plays from B05's first frame at the stair top —
      // her return below (b05_return) starts as C2c's end would start it
      this.brain.setScripted('b05_return', { node: 'G_PARLOR_LURE', force: true });
    } else if (!early) this.brain.grace(this.host.player().pos, this.host.player().room);
  }

  update(dt: number): AdaOutput | null {
    this.clock += dt;
    if (this.pending.length && !this.inCutscene) this.tickPending(dt);
    if (this.fallback) {
      this.fallback.t -= dt;
      if (this.fallback.t <= 0) {
        const id = this.fallback.id;
        this.fallback = null;
        this.events.emit('cutscene:end', { id, skipped: false });
        this.cutsceneEnded(id, false);
      }
    }
    const p = this.host.player();
    this.apply(
      this.story.update(dt, {
        playerRoom: p.room,
        playerPos: p.pos,
        hidden: !!p.hiddenIn,
        locketRaised: p.locketRaised && p.beam.on,
        thunderMasked: this.brain.isMasked(),
        aiState: this.brain.state,
      }),
    );
    // cutscenes own her (and the player): the brain holds still
    if (!this.inCutscene) {
      const out = this.brain.update(dt, p);
      this.last = out;
      for (const e of out.events) this.onAiEvent(e);
      this.host.ada?.(out);
    }
    return this.last;
  }

  get cutscene(): CutsceneId | null {
    return this.inCutscene;
  }

  /** The optional cutscene ids still waiting on their gate (QA / tests). */
  get pendingCutscenes(): readonly CutsceneId[] {
    return this.pending.map((p) => p.id);
  }

  /**
   * CUTSCENES-PLAN §4 safety gate (pure on the brain + host queries):
   * - 'none': always; 'vigil': she is in VIGIL (C2b — at her door, perceiving nothing);
   * - 'safe': she is not in CHASE / LOOK / INVESTIGATE / SEARCH (nor catching), AND she is offstage, or ≥ 6 m away
   *   (straight line ≤ room-graph distance, so this is conservative), or a floor apart, or in another room with no line
   *   of sight (a closed door or wall between); and no other optional cutscene ended < 45 s ago in B05–B10.
   */
  gateHolds(gate: CutsceneGate): boolean {
    if (gate === 'none') return true;
    const b = this.brain;
    if (gate === 'vigil') return b.state === 'VIGIL' && b.freezable;
    if (!b.freezable) return false;
    const st = b.state;
    if (st === 'CHASE' || st === 'LOOK' || st === 'INVESTIGATE' || st === 'SEARCH' || st === 'CATCH') return false;
    if (this.clock - this.lastOptionalEndT < GATE_PACING_S) return false;
    if (b.scripted?.mode === 'hidden' || b.parked) return true;
    const p = this.host.player();
    const a = b.pos;
    if (Math.abs(a[2] - p.pos[2]) > GATE_FLOOR_DZ) return true;
    if (Math.hypot(a[0] - p.pos[0], a[1] - p.pos[1]) >= GATE_DIST_M) return true;
    const eye: P3 = [a[0], a[1], a[2] + 1.5];
    return b.room !== p.room && !this.host.lineOfSight(eye, p.pos);
  }

  private tickPending(dt: number): void {
    const q = this.pending[0];
    q.t += dt;
    if (this.gateHolds(q.gate)) {
      this.pending.shift();
      this.apply(this.story.handle({ type: 'cutscene_go', id: q.id }));
    } else if (q.t >= q.waitS) {
      this.pending.shift();
      this.apply(this.story.handle({ type: 'cutscene_drop', id: q.id }));
    }
  }

  // ------------------------------------------------------------------ persistence

  snapshot(host?: Record<string, unknown>): SaveGame {
    return { version: SAVE_VERSION, story: this.story.snapshot(), ai: this.brain.snapshot(), host };
  }

  restore(save: { story: EscapeState; ai: AdaSnapshot }): void {
    this.story.restore(save.story);
    this.brain.restore(save.ai);
    this.inCutscene = null;
    this.fallback = null;
    this.pending = [];
    this.apply(this.story.resumeCommands());
  }

  dispose(): void {
    for (const f of this.offs) f();
    this.offs.length = 0;
  }

  // ------------------------------------------------------------------ plumbing

  private onAiEvent(e: AiEvent): void {
    switch (e.type) {
      case 'state':
        this.events.emit('ai:state', { from: e.from, to: e.to });
        break;
      case 'voice':
        this.host.voice?.(e.trigger);
        break;
      case 'door':
        this.host.pushDoor?.(e.doorId, e.fast);
        break;
      default:
        break;
    }
    this.apply(this.story.handle({ type: 'ai', event: e }));
  }

  private cutsceneEnded(id: string, skipped: boolean): void {
    if (this.inCutscene !== id) return;
    this.inCutscene = null;
    if (this.fallback?.id === id) this.fallback = null;
    if (OPTIONAL_IDS.has(id)) this.lastOptionalEndT = this.clock;
    // C4c (CUTSCENES-PLAN §4): the authored take replaced the gameplay take — she resumes at 'carry' where the
    // cutscene's step left her (also on skip: the skip applies the same end state)
    if (id === 'C4c') {
      const b = this.brain;
      const end = c4cCarryEnd(b.pos);
      // the step is blind (no nav query): take it only with a clear line at chest height, else turn in place
      const clear = this.host.lineOfSight([b.pos[0], b.pos[1], b.pos[2] + 1.2], [end.pos[0], end.pos[1], end.pos[2] + 1.2]);
      b.finaleSkipTake(clear ? end.pos : undefined, clear ? b.room : undefined, end.heading);
    }
    // §4 resume with the deaf grace; difficulty 2026-10-08: nobody is caught within 6 s of a cutscene ending
    this.brain.resume();
    this.brain.calm();
    this.apply(this.story.handle({ type: 'cutscene_end', id, skipped }));
  }

  private setFlag(name: string, value: boolean): void {
    if (this.flags.get(name) === value) return;
    this.flags.set(name, value);
    this.events.emit('flag', { name, value });
  }

  /** Apply story commands in order (respawn happens before grace, so the grace sees the new player position). */
  apply(cmds: StoryCommand[]): void {
    const h = this.host;
    for (const c of cmds) {
      switch (c.type) {
        case 'beat':
          if (c.from) this.events.emit('beat:exit', { id: c.from });
          this.beat = c.to;
          this.events.emit('beat:enter', { id: c.to });
          break;
        case 'flag':
          this.setFlag(c.name, c.value);
          break;
        case 'checkpoint':
          this.events.emit('checkpoint', { id: c.id });
          break;
        case 'cutscene_req':
          if (!this.pending.some((q) => q.id === c.id)) this.pending.push({ id: c.id, gate: c.gate, waitS: c.waitS, t: 0 });
          break;
        case 'death':
          this.pending = []; // a catch forgets waiting optional cutscenes (never played over a death)
          this.events.emit('player:death', { cause: c.cause });
          break;
        case 'cutscene': {
          this.inCutscene = c.id;
          this.brain.freeze(); // §4: held for the whole cutscene (the Director also skips her update)
          this.events.emit('cutscene:start', { id: c.id });
          const handled = h.playCutscene?.(c.id, (skipped) => {
            this.events.emit('cutscene:end', { id: c.id, skipped });
            this.cutsceneEnded(c.id, skipped);
          });
          if (!handled) this.fallback = { id: c.id, t: c.id === 'death' ? 3 : this.fallbackS };
          break;
        }
        case 'voice':
          h.voice?.(c.trigger);
          break;
        case 'ai':
          this.aiCommand(c.cmd);
          break;
        case 'door':
          h.door?.(c.id, c.action);
          break;
        case 'item':
          h.removeItem?.(c.id);
          break;
        case 'prop':
          h.setPropVisible?.(c.id, c.visible);
          break;
        case 'document':
          h.document?.(DOCUMENTS[c.id]);
          break;
        case 'noise':
          this.events.emit('noise', { pos: c.pos, room: c.room, radius: c.radius, source: c.source });
          break;
        case 'sfx':
          h.sfx?.(c.id, c.pos, c.room);
          break;
        case 'respawn': {
          const sp = checkpointSpawn(this.layout, c.checkpoint);
          h.teleport?.(sp.id, sp.pos, sp.yaw, sp.pitch);
          this.events.emit('player:respawn', { checkpoint: c.checkpoint });
          break;
        }
        case 'hint':
          h.hint?.(c.target);
          break;
        case 'toast':
          h.toast?.(c.text);
          break;
        case 'prompt':
          h.prompt?.(c.text);
          break;
        case 'storm':
          h.storm?.(c.intervalSec, c.rumbleScale);
          break;
        case 'lightning':
          h.lightning?.(c.reason);
          break;
        case 'raise_locket':
          h.raiseLocket?.();
          break;
        case 'end':
          h.end?.();
          break;
      }
    }
  }

  private aiCommand(c: Extract<StoryCommand, { type: 'ai' }>['cmd']): void {
    const b = this.brain;
    switch (c.op) {
      case 'scripted':
        b.setScripted(c.mode, { node: c.node, hideId: c.hideId, force: c.force });
        break;
      case 'clear_scripted':
        b.clearScripted();
        break;
      case 'routine':
        b.setRoutine(c.kind);
        break;
      case 'bell': {
        // bell_used only when the pull really lured her (or queued a lure behind a CHASE)
        const r = b.bell();
        if (r !== 'ignored') this.apply(this.story.handle({ type: 'bell', queued: r === 'queued' }));
        break;
      }
      case 'escalation':
        b.setEscalation(c.level);
        break;
      case 'assist':
        b.setAssist({ ...(c.slow !== undefined ? { slow: c.slow } : {}), ...(c.finaleWait !== undefined ? { finaleWait: c.finaleWait } : {}) });
        break;
      case 'grace': {
        const p = this.host.player();
        b.grace(p.pos, p.room);
        break;
      }
      case 'noise':
        b.noise({ pos: c.pos, room: c.room, radius: c.radius, source: 'script' });
        break;
    }
  }
}
