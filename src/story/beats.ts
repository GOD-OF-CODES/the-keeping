// Beat state machine B01–B13 (DESIGN "Beats", "Escape theorem", "Fail states & checkpoints"). PURE: inputs are
// plain events (interactions, trigger volumes, flags, cutscene ends, hides, AI events), outputs are commands the
// adapter (src/story/director.ts) applies: bus events, AI commands, door/rope actions, cutscenes, voice triggers …
//
// Idempotent by construction: every handler checks the current beat/flags, so re-fired triggers (respawning inside a
// trigger volume, repeated flag events from other lanes) are harmless.

import type { P3 } from '../shared/layout-types.ts';
import type { AiEvent, AdaState, ScriptedMode } from '../ai/types.ts';
import type { RoutineKind } from '../ai/ada-brain.ts';
import { DOCUMENTS, DOC_FOR_ACTION, type DocId } from './documents.ts';
import { beatIndex, boardsPried, cloneState, newEscapeState, type BeatId, type CheckpointId, type EscapeState } from './escape-state.ts';

export type CutsceneId = 'C1' | 'C2' | 'C2_replay' | 'C3' | 'C5' | 'C6' | 'C7' | 'death';

export type AiCommand =
  | { op: 'scripted'; mode: ScriptedMode; node?: string; hideId?: string; force?: boolean }
  | { op: 'clear_scripted' }
  | { op: 'routine'; kind: RoutineKind }
  | { op: 'bell' }
  | { op: 'escalation'; level: number }
  | { op: 'assist'; slow?: boolean; finaleWait?: boolean }
  /** Post-death grace; the adapter supplies the (already respawned) player position. */
  | { op: 'grace' }
  | { op: 'noise'; pos: P3; room: string; radius: number };

export type StoryCommand =
  | { type: 'beat'; from: BeatId | null; to: BeatId }
  | { type: 'flag'; name: string; value: boolean }
  | { type: 'checkpoint'; id: CheckpointId }
  | { type: 'cutscene'; id: CutsceneId }
  | { type: 'voice'; trigger: string }
  | { type: 'ai'; cmd: AiCommand }
  /** rope_open / rope_close: the front door on the rope; lock / unlock: key or bolt state. */
  | { type: 'door'; id: string; action: 'rope_open' | 'rope_close' | 'lock' | 'unlock' }
  | { type: 'item'; id: string; action: 'remove' }
  | { type: 'prop'; id: string; visible: boolean }
  | { type: 'document'; id: DocId }
  /** A player-audible noise the chaser hears (design-radius pry etc.). */
  | { type: 'noise'; pos: P3; room: string; radius: number; source: 'player' | 'prop' | 'script' }
  | { type: 'sfx'; id: string; pos?: P3; room?: string }
  | { type: 'death'; cause: string }
  | { type: 'respawn'; checkpoint: CheckpointId }
  /** Stuck 90 s: lightning picks out the next interactable (prop id / door id / board_k). */
  | { type: 'hint'; target: string }
  | { type: 'toast'; text: string }
  /** One-time on-screen prompt (the finale prompt after the first failure). */
  | { type: 'prompt'; text: string }
  /** Storm cadence: a flash every intervalSec (0 = storm over); rumbleScale lengthens thunder rolls. */
  | { type: 'storm'; intervalSec: number; rumbleScale: number }
  /** Strike lightning now (flash + thunder, which also masks sound). */
  | { type: 'lightning'; reason: string }
  /** Respawn with the locket already raised (finale retry). */
  | { type: 'raise_locket' }
  | { type: 'end' };

export type StoryInput =
  | { type: 'interact'; id: string; action: string }
  | { type: 'flag'; name: string; value: boolean }
  | { type: 'cutscene_end'; id: string; skipped?: boolean }
  | { type: 'hide'; hideId: string; inside: boolean }
  | { type: 'ai'; event: AiEvent }
  /** The brain's answer to a bell pull (the Director sends it only when the pull lured her now or queued a lure). */
  | { type: 'bell'; queued: boolean };

/** What the story samples each tick. */
export interface StoryView {
  playerRoom: string | null;
  playerPos: P3;
  hidden: boolean;
  locketRaised: boolean;
  /** A thunder roll masks sound right now (a pry inside it is silent). */
  thunderMasked: boolean;
  aiState: AdaState;
}

export const HINT_AFTER_S = 90;
export const DEATH_CUTAWAY_S = 3;
const FRONT_DOOR_OPEN_DELAY = 2.6;
const PRY_NOISE = 14;
const STORM = { normal: { intervalSec: 35, rumbleScale: 1 }, b06: { intervalSec: 28, rumbleScale: 1 }, b08: { intervalSec: 12, rumbleScale: 1 }, over: { intervalSec: 0, rumbleScale: 1 } } as const;
export const FINALE_PROMPT = 'Flashlight on. Raise the locket (right mouse) and let her look.';

/** Beat → checkpoint the story expects to be at (debug starts / validation). */
export const BEAT_CHECKPOINT: Record<BeatId, CheckpointId> = {
  B01: 'CP1',
  B02: 'CP1',
  B03: 'CP1',
  B04: 'CP2',
  B05: 'CP2',
  B06: 'CP3',
  B07: 'CP4',
  B08: 'CP4',
  B09: 'CP5',
  B10: 'CP6',
  B11: 'CP7',
  B12: 'CP8',
  B13: 'CP8',
};

export class Story {
  s: EscapeState;
  private out: StoryCommand[] = [];
  private view: StoryView = { playerRoom: null, playerPos: [0, 0, 0], hidden: false, locketRaised: false, thunderMasked: false, aiState: 'SCRIPTED' };

  constructor(state?: EscapeState) {
    this.s = state ? cloneState(state) : newEscapeState();
  }

  // ------------------------------------------------------------------ api

  /** New game: B01 and C1. */
  start(): StoryCommand[] {
    this.out = [];
    this.s = newEscapeState();
    this.emit({ type: 'beat', from: null, to: 'B01' });
    this.emit({ type: 'storm', ...STORM.normal });
    this.ai({ op: 'scripted', mode: 'hidden' });
    this.cutscene('C1');
    return this.flush();
  }

  handle(input: StoryInput): StoryCommand[] {
    this.out = [];
    switch (input.type) {
      case 'interact':
        this.onInteract(input.id, input.action);
        break;
      case 'flag':
        this.onFlag(input.name, input.value);
        break;
      case 'cutscene_end':
        this.onCutsceneEnd(input.id);
        break;
      case 'hide':
        this.onHide(input.hideId, input.inside);
        break;
      case 'ai':
        this.onAi(input.event);
        break;
      case 'bell':
        this.onBellAnswered();
        break;
    }
    return this.flush();
  }

  update(dt: number, view: StoryView): StoryCommand[] {
    this.out = [];
    this.view = view;
    const s = this.s;
    s.time += dt;
    // timers
    const due = s.timers.filter((t) => t.t <= s.time);
    s.timers = s.timers.filter((t) => t.t > s.time);
    for (const t of due) this.onTimer(t.id);
    // room-based fallbacks for trigger-driven transitions (triggers fire on ENTER only; hides / respawns can leave
    // the player already inside a volume)
    if (!view.hidden && !s.cutscene && !s.dead) this.roomProgress(view.playerRoom);
    // B11: raising the locket
    if (s.beat === 'B11' && view.locketRaised) this.once('voice:b11_locket', () => this.emit({ type: 'voice', trigger: 'b11:locket_raised' }));
    // C5 when she stands at his door with the locket and you are in the hall
    if (this.f('locket_given') && this.f('ada_at_parlor') && !this.f('harlan_taken') && view.playerRoom === 'G1' && !s.cutscene && !s.dead) this.cutscene('C5');
    // hint timer
    const hintable = !s.cutscene && !s.dead && beatIndex(s.beat) >= 1 && beatIndex(s.beat) <= 11 && s.beat !== 'B07';
    if (hintable) {
      s.stuckT += dt;
      if (s.stuckT >= HINT_AFTER_S) {
        s.stuckT = 0;
        const target = this.hintTarget();
        if (target) {
          s.hintsGiven++;
          this.emit({ type: 'hint', target });
        }
      }
    }
    return this.flush();
  }

  /** Assumed position for a debug start at a beat (sets the flags a normal run would have). */
  static debugStateAt(beat: BeatId): EscapeState {
    const s = newEscapeState();
    const order: [BeatId, string[]][] = [
      ['B03', ['knocked', 'rang_front_bell', 'front_door_open']],
      ['B04', ['parlor_locked']],
      ['B06', ['first_hide_done']],
      ['B07', ['ledger_read', 'has_hammer']],
      ['B08', ['c3_done']],
      ['B09', ['bell_used', 'ada_board_1', 'ada_board_2', 'ada_board_3', 'ada_boards_pried']],
      ['B10', ['letter_read', 'has_shears', 'hem_cut', 'has_locket', 'has_ticket', 'dress_visit_done']],
      ['B11', ['has_can', 'bell_nonstop', 'passage_unbolted']],
      ['B12', ['finale_started', 'locket_given', 'ada_at_parlor', 'harlan_taken']],
    ];
    for (const [b, fl] of order) if (beatIndex(beat) >= beatIndex(b)) for (const f of fl) s.flags[f] = true;
    if (beatIndex(beat) >= beatIndex('B04')) s.flags.front_door_open = false;
    if (beatIndex(beat) >= beatIndex('B12')) {
      s.flags.front_door_open = true;
      s.flags.has_locket = false;
      s.flags.bell_nonstop = false;
    }
    s.beat = beat;
    s.checkpoint = BEAT_CHECKPOINT[beat];
    return s;
  }

  snapshot(): EscapeState {
    return cloneState(this.s);
  }

  restore(s: EscapeState): void {
    this.s = cloneState(s);
  }

  /** Commands that re-establish the world/AI for a restored state (continue from a save). */
  resumeCommands(): StoryCommand[] {
    this.out = [];
    const s = this.s;
    for (const [k, v] of Object.entries(s.flags)) this.emit({ type: 'flag', name: k, value: v });
    this.emit({ type: 'beat', from: null, to: s.beat });
    this.emit({ type: 'storm', ...this.stormFor(s.beat) });
    if (this.f('parlor_locked')) this.emit({ type: 'door', id: 'D_PARLOR', action: 'lock' });
    this.emit({ type: 'door', id: 'D_FRONT', action: this.f('front_door_open') ? 'rope_open' : 'rope_close' });
    this.ai({ op: 'escalation', level: this.escalation() });
    this.ai({ op: 'routine', kind: this.routineFor() });
    if (s.checkpoint) this.emit({ type: 'respawn', checkpoint: s.checkpoint });
    return this.flush();
  }

  get beat(): BeatId {
    return this.s.beat;
  }

  // ------------------------------------------------------------------ helpers

  private flush(): StoryCommand[] {
    const o = this.out;
    this.out = [];
    return o;
  }

  private emit(c: StoryCommand): void {
    this.out.push(c);
  }

  private ai(cmd: AiCommand): void {
    this.emit({ type: 'ai', cmd });
  }

  private f(name: string): boolean {
    return this.s.flags[name] === true;
  }

  private setFlag(name: string, value = true): void {
    if ((this.s.flags[name] === true) === value && name in this.s.flags) return;
    this.s.flags[name] = value;
    this.progress();
    this.emit({ type: 'flag', name, value });
    this.afterFlag(name, value);
  }

  private progress(): void {
    this.s.stuckT = 0;
  }

  private once(key: string, fn: () => void): void {
    if (this.s.once.includes(key)) return;
    this.s.once.push(key);
    fn();
  }

  private goBeat(to: BeatId): void {
    const from = this.s.beat;
    if (from === to || beatIndex(to) < beatIndex(from)) return;
    this.s.beat = to;
    this.progress();
    this.emit({ type: 'beat', from, to });
    // leaving through the wardrobe's back ends any (replayed) dress visit
    if (to === 'B10') this.ai({ op: 'clear_scripted' });
    const storm = this.stormFor(to);
    if (this.stormFor(from).intervalSec !== storm.intervalSec) this.emit({ type: 'storm', ...storm, rumbleScale: this.rumbleScale() });
  }

  private stormFor(b: BeatId): { intervalSec: number; rumbleScale: number } {
    if (b === 'B06' || b === 'B07') return { ...STORM.b06 };
    if (b === 'B08' || b === 'B09') return { ...STORM.b08, rumbleScale: this.rumbleScale() };
    if (beatIndex(b) >= beatIndex('B12')) return { ...STORM.over };
    return { ...STORM.normal };
  }

  private rumbleScale(): number {
    return this.s.failedPries >= 2 ? 1.6 : 1;
  }

  private checkpoint(id: CheckpointId): void {
    const s = this.s;
    if (s.checkpoint !== id) {
      s.checkpoint = id;
      // a new section: the slow assist lapses unless this section already earned it
      this.ai({ op: 'assist', slow: (s.deathsAt[id] ?? 0) >= 2 });
    }
    this.progress();
    this.emit({ type: 'checkpoint', id });
  }

  private cutscene(id: CutsceneId): void {
    this.s.cutscene = id;
    if (!this.s.cutscenesSeen.includes(id)) this.s.cutscenesSeen.push(id);
    this.emit({ type: 'cutscene', id });
  }

  private doc(id: DocId): void {
    const s = this.s;
    if (!s.docsRead.includes(id)) {
      s.docsRead.push(id);
      this.progress();
    }
    this.emit({ type: 'document', id });
    const v = DOCUMENTS[id].voiceTrigger;
    if (v) this.emit({ type: 'voice', trigger: v });
  }

  private escalation(): number {
    return this.f('dress_visit_done') ? 2 : this.f('ada_boards_pried') ? 1 : 0;
  }

  private routineFor(): RoutineKind {
    if (this.f('bell_nonstop') && !this.f('locket_given')) return 'ground_finale';
    if (this.f('dress_visit_done')) return 'upper_dress';
    return 'upper';
  }

  private addTimer(id: string, delay: number): void {
    this.s.timers.push({ id, t: this.s.time + delay });
  }

  // ------------------------------------------------------------------ inputs

  private onInteract(id: string, action: string): void {
    const s = this.s;
    const b = s.beat;
    const at = (x: BeatId) => beatIndex(b) >= beatIndex(x);
    switch (action) {
      // ---- B02: the door
      case 'knock':
        if (b === 'B02') {
          this.once('voice:knock', () => this.emit({ type: 'voice', trigger: 'b02:first_knock' }));
          this.setFlag('knocked');
        }
        return;
      case 'ring_bell':
        if (b === 'B02' && !this.f('rang_front_bell')) {
          this.setFlag('rang_front_bell');
          this.addTimer('front_door_opens', FRONT_DOOR_OPEN_DELAY);
        }
        return;
      case 'b03:hall_enter':
        if (b === 'B02' && this.f('front_door_open')) this.goBeat('B03');
        return;
      case 'b03:threshold':
        if (b === 'B03' && !s.cutscene) this.cutscene('C2');
        return;
      // ---- B04
      case 'rattle_front_door':
      case 'rattle_bolted':
        if (id === 'D_PASSAGE' || (action === 'rattle_bolted' && id !== 'D_FRONT' && id !== 'P_BOLT_BOX')) {
          this.passageTried();
          return;
        }
        if (at('B04') && !this.f('front_door_open')) this.once('voice:rattle', () => this.emit({ type: 'voice', trigger: 'b04:front_door_rattle' }));
        return;
      case 'b04:armoire_flash':
        if (b === 'B04') this.once('flash:armoire', () => this.emit({ type: 'lightning', reason: 'armoire' }));
        return;
      case 'b05:enter_u2':
        if (b === 'B05' && this.f('first_hide_done')) this.goBeat('B06');
        return;
      // ---- B06/B07: ledger, hammer, grate
      case 'read_ledger': {
        const page = (s.ledgerPages % 3) + 1;
        s.ledgerPages++;
        this.doc(`ledger_p${page}` as DocId);
        if (!this.f('ledger_read')) {
          this.setFlag('ledger_read');
          if (at('B06')) this.checkpoint('CP4');
        }
        return;
      }
      case 'take_hammer':
        this.onHammer();
        return;
      case 'peek_grate':
        if (this.f('c3_done')) this.once('voice:grate', () => this.emit({ type: 'voice', trigger: 'b07:grate_peek' }));
        return;
      // ---- B08: bell + boards
      case 'pull_bell':
        // the pull always rings; bell_used is set only when she answers (lured now, or queued behind a CHASE):
        // the Director feeds the brain's answer back as { type: 'bell' } → onBellAnswered
        this.emit({ type: 'sfx', id: 'bell_pull' });
        this.ai({ op: 'bell' });
        return;
      case 'pry':
        this.onPry(id);
        return;
      case 'b08:at_ada_door':
        if (b === 'B08' && (s.deathsAt[s.checkpoint ?? ''] ?? 0) >= 3 && !this.view.thunderMasked && s.time - s.lastThunderAssistT > 20) {
          s.lastThunderAssistT = s.time;
          this.emit({ type: 'lightning', reason: 'assist' });
        }
        return;
      // ---- B09: letter, shears, hem, locket
      case 'b09:enter_u3':
        if (b === 'B08' && this.f('ada_boards_pried')) this.goBeat('B09');
        return;
      case 'take_shears':
        this.setFlag('has_shears');
        return;
      case 'cut_hem':
        if (this.f('hem_cut')) return;
        if (!this.f('has_shears')) {
          this.emit({ type: 'toast', text: 'The hem is stitched tight. I need something to cut it with.' });
          return;
        }
        this.setFlag('hem_cut');
        this.emit({ type: 'sfx', id: 'fabric_tear' });
        this.emit({ type: 'prop', id: 'P_LOCKET', visible: true });
        this.emit({ type: 'prop', id: 'P_TICKET', visible: true });
        return;
      case 'take_locket':
        this.onLocket();
        return;
      // ---- B10: back stair, kitchen, can, bolt
      case 'b10:backstair_enter':
        if (b === 'B09' && this.f('dress_visit_done')) this.goBeat('B10');
        return;
      case 'listen_hatch':
        this.emit({ type: 'sfx', id: 'hatch_thump' });
        return;
      case 'take_can':
        this.onCan();
        return;
      // ---- B11
      case 'b11:passage_enter':
        if (b === 'B10' && this.f('passage_unbolted')) this.goBeat('B11');
        return;
      case 'b11:hall_finale':
        if (b === 'B11') this.once('cp:CP8', () => this.checkpoint('CP8'));
        return;
      // ---- B12
      case 'car':
      case 'b12:at_car':
        if (b !== 'B12' || s.cutscene) return;
        if (this.f('has_can')) this.cutscene('C6');
        else this.once('toast:tank', () => this.emit({ type: 'toast', text: "The tank's empty. There was gas in the kitchen." }));
        return;
      default:
        break;
    }
    // doors and documents by id / action
    if (id === 'D_PASSAGE') {
      this.passageTried();
      return;
    }
    const doc = DOC_FOR_ACTION[action];
    if (doc) {
      this.doc(doc);
      if (doc === 'letter') this.setFlag('letter_read');
      if (doc === 'ticket') this.setFlag('has_ticket');
    }
  }

  private roomProgress(room: string | null): void {
    const s = this.s;
    if (s.beat === 'B02' && room === 'G1' && this.f('front_door_open')) this.goBeat('B03');
    else if (s.beat === 'B05' && room === 'U2' && this.f('first_hide_done')) this.goBeat('B06');
    else if (s.beat === 'B08' && room === 'U3' && this.f('ada_boards_pried')) this.goBeat('B09');
    else if (s.beat === 'B09' && (room === 'U4T' || room === 'U4' || room === 'G3') && this.f('dress_visit_done')) this.goBeat('B10');
    else if (s.beat === 'B10' && room === 'G3P' && this.f('passage_unbolted')) this.goBeat('B11');
  }

  private passageTried(): void {
    if (this.f('passage_unbolted')) return;
    const room = this.view.playerRoom;
    if (room === 'G3P' || room === 'G3') {
      this.setFlag('passage_unbolted');
      this.emit({ type: 'door', id: 'D_PASSAGE', action: 'unlock' });
      this.emit({ type: 'sfx', id: 'bolt_slide' });
    } else if (beatIndex(this.s.beat) >= beatIndex('B04')) this.once('toast:passage', () => this.emit({ type: 'toast', text: "Bolted. From the other side." }));
  }

  private onHammer(): void {
    const s = this.s;
    if (!this.f('has_hammer')) this.setFlag('has_hammer');
    if (s.beat === 'B06' && !this.f('c3_done')) {
      this.checkpoint('CP4');
      this.goBeat('B07');
      this.cutscene('C3');
    }
  }

  private onPry(id: string): void {
    const s = this.s;
    if (!/^board_\d$/.test(id) || beatIndex(s.beat) < beatIndex('B07')) return;
    if (!this.view.thunderMasked) {
      s.failedPries++;
      // the design-radius screech (14 m) — carries down the stairwell and brings her back
      this.emit({ type: 'noise', pos: [3.4, 8.2, 4.1], room: 'U1', radius: PRY_NOISE, source: 'player' });
      if (s.failedPries === 2) this.emit({ type: 'storm', ...this.stormFor(s.beat), rumbleScale: this.rumbleScale() });
    }
    const k = Number(id.slice(6));
    this.setFlag(`ada_board_${k}`);
    this.checkpoint('CP5');
    if (boardsPried(s) === 3) this.setFlag('ada_boards_pried');
  }

  private onLocket(): void {
    if (this.f('locket_given')) return;
    if (!this.f('has_locket')) this.setFlag('has_locket');
    if (this.s.checkpoint === 'CP6' || beatIndex(this.s.beat) > beatIndex('B09')) return;
    if (this.s.beat !== 'B09') this.goBeat('B09');
    this.checkpoint('CP6');
    if (!this.f('dress_visit_done')) this.ai({ op: 'scripted', mode: 'dress' });
  }

  private onCan(): void {
    if (!this.f('has_can')) this.setFlag('has_can');
    this.once('cp:CP7', () => {
      if (this.s.beat === 'B09' && this.f('dress_visit_done')) this.goBeat('B10');
      this.checkpoint('CP7');
      if (!this.f('locket_given')) {
        this.setFlag('bell_nonstop');
        this.emit({ type: 'sfx', id: 'spring_bell_loop' });
        this.emit({ type: 'voice', trigger: 'b10:bell_nonstop_start' });
        this.ai({ op: 'routine', kind: 'ground_finale' });
      }
    });
  }

  private onFlag(name: string, value: boolean): void {
    if (!value) {
      if (this.s.flags[name] === true && (name === 'has_locket' || name === 'front_door_open')) this.s.flags[name] = false;
      return;
    }
    if (this.f(name)) return; // already known (our own echo, or a repeat)
    this.s.flags[name] = true;
    this.progress();
    this.afterFlag(name, true);
    if (name === 'has_hammer') this.onHammer();
    if (name === 'has_locket') this.onLocket();
    if (name === 'has_can') this.onCan();
    if (/^ada_board_\d$/.test(name) && boardsPried(this.s) === 3) this.setFlag('ada_boards_pried');
  }

  /** Side effects of a flag becoming true (whoever set it). */
  private afterFlag(name: string, value: boolean): void {
    if (!value) return;
    if (name === 'ada_boards_pried' || name === 'dress_visit_done') {
      this.ai({ op: 'escalation', level: this.escalation() });
      if (name === 'dress_visit_done' && !this.f('bell_nonstop')) this.ai({ op: 'routine', kind: 'upper_dress' });
    }
  }

  private onHide(hideId: string, inside: boolean): void {
    const s = this.s;
    if (inside && s.beat === 'B04') {
      this.goBeat('B05');
      this.emit({ type: 'voice', trigger: 'b05:hide_enter' });
    }
    if (!inside && s.beat === 'B05' && this.f('first_hide_done')) this.once('cp:CP3', () => this.checkpoint('CP3'));
    void hideId;
  }

  /** A bell pull she answered (or will answer when a CHASE ends): counts for B08 → B09 and silences the bell hint. */
  private onBellAnswered(): void {
    this.s.bellPulls++;
    this.setFlag('bell_used');
    this.progress();
  }

  private onAi(e: AiEvent): void {
    const s = this.s;
    switch (e.type) {
      case 'scripted_done':
        if (e.mode === 'hide_demo') {
          this.setFlag('first_hide_done');
          if (!this.view.hidden && s.beat === 'B05') this.once('cp:CP3', () => this.checkpoint('CP3'));
        }
        if (e.mode === 'dress') this.setFlag('dress_visit_done');
        return;
      case 'catch':
        this.onCatch(e.cause);
        return;
      case 'finale':
        if (e.phase === 'start') {
          this.setFlag('finale_started');
          if (this.f('has_locket') && !this.f('dress_visit_done')) this.setFlag('dress_visit_done');
        } else if (e.phase === 'take') {
          this.setFlag('locket_given');
          this.setFlag('has_locket', false);
          this.emit({ type: 'item', id: 'locket', action: 'remove' });
          if (this.f('bell_nonstop')) this.setFlag('bell_nonstop', false);
        } else if (e.phase === 'at_door') this.setFlag('ada_at_parlor');
        else if (e.phase === 'lost') this.setFlag('finale_started', false);
        return;
      case 'state':
        // assist ≥ 3 deaths in a section: a shutter bangs far away when she starts to come for you
        if ((e.to === 'LISTEN' || e.to === 'INVESTIGATE') && (s.deathsAt[s.checkpoint ?? ''] ?? 0) >= 3 && s.time - s.lastDistractionT > 30) {
          s.lastDistractionT = s.time;
          const far = this.view.playerPos[2] > 3 ? { pos: [7.9, 7.0, 0.6] as P3, room: 'G3' } : { pos: [1.8, 0.45, 4.1] as P3, room: 'U1' };
          this.emit({ type: 'sfx', id: 'window_rattle', pos: far.pos, room: far.room });
          this.ai({ op: 'noise', pos: far.pos, room: far.room, radius: 40 });
        }
        return;
      default:
        return;
    }
  }

  private onCatch(cause: string): void {
    const s = this.s;
    if (s.dead) return;
    s.dead = true;
    s.deathsTotal++;
    const cp = s.checkpoint ?? 'CP1';
    s.deathsAt[cp] = (s.deathsAt[cp] ?? 0) + 1;
    if (s.beat === 'B11') s.finaleDeaths++;
    this.emit({ type: 'death', cause });
    this.cutscene('death');
  }

  private onCutsceneEnd(id: string): void {
    const s = this.s;
    if (s.cutscene !== id) return; // stale / duplicate
    s.cutscene = null;
    switch (id) {
      case 'C1':
        this.checkpoint('CP1');
        this.goBeat('B02');
        return;
      case 'C2':
        this.setFlag('front_door_open', false);
        this.emit({ type: 'door', id: 'D_FRONT', action: 'rope_close' });
        this.setFlag('parlor_locked');
        this.emit({ type: 'door', id: 'D_PARLOR', action: 'lock' });
        this.checkpoint('CP2');
        this.goBeat('B04');
        this.ai({ op: 'scripted', mode: 'b04_chase', node: 'G_PARLOR_LURE', force: true });
        return;
      case 'C2_replay':
        this.ai({ op: 'scripted', mode: 'b04_chase', node: 'G_PARLOR_LURE', force: true });
        return;
      case 'C3':
        this.setFlag('c3_done');
        this.goBeat('B08');
        return;
      case 'C5':
        this.setFlag('harlan_taken');
        this.setFlag('front_door_open');
        this.emit({ type: 'door', id: 'D_FRONT', action: 'rope_open' });
        this.emit({ type: 'voice', trigger: 'b11:front_door_opens' });
        this.ai({ op: 'scripted', mode: 'hidden' });
        this.goBeat('B12');
        return;
      case 'C6':
        this.goBeat('B13');
        this.cutscene('C7');
        return;
      case 'C7':
        this.setFlag('game_over');
        this.emit({ type: 'end' });
        return;
      case 'death':
        this.respawn();
        return;
      default:
        return;
    }
  }

  private respawn(): void {
    const s = this.s;
    s.dead = false;
    const cp = s.checkpoint ?? 'CP1';
    const deaths = s.deathsAt[cp] ?? 0;
    this.emit({ type: 'respawn', checkpoint: cp });
    if (s.beat === 'B04') {
      // C2 replays in 3 s: she rises again behind you
      this.cutscene('C2_replay');
      return;
    }
    this.ai({ op: 'grace' });
    if (deaths >= 2) this.ai({ op: 'assist', slow: true });
    if (cp === 'CP6' && s.beat === 'B09' && this.f('has_locket') && !this.f('locket_given')) this.ai({ op: 'scripted', mode: 'dress' });
    if (s.beat === 'B11' && !this.f('locket_given')) {
      if (s.finaleDeaths >= 1) {
        this.emit({ type: 'raise_locket' });
        if (!s.finalePromptShown) {
          s.finalePromptShown = true;
          this.emit({ type: 'prompt', text: FINALE_PROMPT });
        }
      }
      if (s.finaleDeaths >= 2) this.ai({ op: 'assist', finaleWait: true });
    }
  }

  private onTimer(id: string): void {
    if (id === 'front_door_opens' && !this.f('front_door_open') && this.s.beat === 'B02') {
      this.setFlag('front_door_open');
      this.emit({ type: 'sfx', id: 'rope_pulleys' });
      this.emit({ type: 'door', id: 'D_FRONT', action: 'rope_open' });
    }
  }

  /** Stuck 90 s: the next interactable for lightning to pick out. */
  hintTarget(): string | null {
    const s = this.s;
    const f = (n: string) => this.f(n);
    switch (s.beat) {
      case 'B02':
        return f('front_door_open') ? 'D_FRONT' : f('knocked') ? 'P_BELL_KNOB' : 'P_KNOCKER';
      case 'B03':
        return 'D_PARLOR';
      case 'B04':
        return 'P_ARMOIRE';
      case 'B05':
        return 'D_HARLAN';
      case 'B06':
        return f('ledger_read') ? 'P_HAMMER' : 'P_LEDGER';
      case 'B08': {
        if (s.bellPulls === 0) return 'P_BELL_PULL';
        const next = [1, 2, 3].find((k) => !f(`ada_board_${k}`));
        return next ? `board_${next}` : 'D_ADA';
      }
      case 'B09':
        if (!f('letter_read')) return 'P_LETTER';
        if (!f('has_shears')) return 'P_SHEARS';
        if (!f('hem_cut')) return 'P_DRESS';
        if (!f('has_locket') && !f('locket_given')) return 'P_LOCKET';
        return 'P_ADA_WARDROBE';
      case 'B10':
        if (!f('has_can')) return 'P_JERRY_10';
        return 'D_PASSAGE';
      case 'B11':
        return 'D_PARLOR';
      case 'B12':
        return f('has_can') ? 'P_CAR_ROW' : 'P_JERRY_10';
      default:
        return null;
    }
  }
}
