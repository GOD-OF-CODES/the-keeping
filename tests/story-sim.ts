// Simulation harness for the story + AI playthrough tests (not a test file itself).
// A goal-driven scripted player walks an authored waypoint graph (doors honoured: it can only cross a door that is
// not locked), fires the layout's trigger volumes like src/game/main.ts, mimics the world lane's interactions
// (inventory flags, board prying, hides, door rattles) and drives the REAL Director (AdaBrain + Story) over the REAL
// EventBus. It records beats, checkpoints, deaths, relocations and soft-lock evidence.

import layoutJson from '../src/shared/level-layout.json' with { type: 'json' };
import type { LevelLayout, P3 } from '../src/shared/layout-types.ts';
import { EventBus, type GameEvents } from '../src/core/events.ts';
import { Director, type DirectorHost } from '../src/story/director.ts';
import { AiGraph } from '../src/ai/graph.ts';
import type { AdaOutput, BeamView, DoorState, PlayerView } from '../src/ai/types.ts';
import type { BeatId, CheckpointId } from '../src/story/escape-state.ts';

export const layout = layoutJson as unknown as LevelLayout;
const G = new AiGraph(layout);

// ------------------------------------------------------------------ player waypoint graph (PLAN, feet)

export const PW: Record<string, P3> = {
  gate: [1.8, -27.4, 0],
  drive: [1.8, -12, 0],
  drive_e: [8, -6, 0],
  car: [13.4, -1.6, 0],
  porch: [1.8, -1.5, 0],
  hall_s: [1.8, 0.6, 0.6],
  threshold: [3.1, 1.5, 0.6],
  stair_foot: [0.6, 3.3, 0.6],
  hall_mid: [2.3, 5.0, 0.6],
  hall_n: [2.4, 8.2, 0.6],
  hall_pdoor: [2.5, 8.75, 0.6],
  stair_top: [0.55, 8.1, 4.1],
  u_landing: [1.6, 8.4, 4.1],
  u_ada: [2.9, 8.0, 4.1],
  u_runner_n: [2.4, 6.3, 4.1],
  u_armoire: [2.55, 4.2, 4.1],
  u_hdoor: [3.15, 3.0, 4.1],
  u_runner_s: [2.4, 1.9, 4.1],
  u_ddoor: [3.15, 0.8, 4.1],
  u2_hdoor: [4.4, 3.0, 4.1],
  u2_ddoor: [4.4, 0.8, 4.1],
  u2_mid: [5.6, 2.6, 4.1],
  u2_ledger: [6.3, 3.8, 4.1],
  u2_bell: [6.1, 4.0, 4.1],
  u2_hammer: [8.2, 1.3, 4.1],
  u2_coats: [4.75, 1.9, 4.1],
  u3_door: [4.3, 8.2, 4.1],
  u3_mid: [6.0, 6.2, 4.1],
  u3_letter: [7.0, 8.0, 4.1],
  u3_dress: [7.7, 7.0, 4.1],
  u3_wardrobe: [5.0, 8.1, 4.1],
  u4t_top: [5.0, 9.8, 4.1],
  u4t_turn: [5.0, 11.2, 4.1],
  u4_foot: [8.3, 11.2, 0.6],
  k_door: [8.3, 10.4, 0.6],
  k_center: [6.3, 9.0, 0.6],
  k_cans: [4.4, 8.5, 0.6],
  k_west: [4.35, 9.95, 0.6],
  p_east: [3.2, 9.95, 0.6],
  p_door: [2.5, 9.55, 0.6],
};

const PE: [string, string, string?][] = [
  ['gate', 'drive'],
  ['drive', 'porch'],
  ['drive', 'drive_e'],
  ['drive_e', 'car'],
  ['porch', 'drive_e'],
  ['porch', 'hall_s', 'D_FRONT'],
  ['hall_s', 'threshold'],
  ['hall_s', 'stair_foot'],
  ['threshold', 'hall_mid'],
  ['stair_foot', 'hall_mid'],
  ['hall_mid', 'hall_n'],
  ['hall_n', 'hall_pdoor'],
  ['hall_pdoor', 'p_door', 'D_PASSAGE'],
  ['p_door', 'p_east'],
  ['p_east', 'k_west'],
  ['k_west', 'k_cans'],
  ['k_west', 'k_center'],
  ['k_cans', 'k_center'],
  ['k_center', 'k_door'],
  ['k_door', 'u4_foot', 'D_BACKSTAIR'],
  ['u4_foot', 'u4t_turn'],
  ['u4t_turn', 'u4t_top'],
  ['u4t_top', 'u3_wardrobe', 'D_WARDROBE_BACK'],
  ['stair_foot', 'stair_top'],
  ['stair_top', 'u_landing'],
  ['u_landing', 'u_ada'],
  ['u_landing', 'u_runner_n'],
  ['u_ada', 'u_runner_n'],
  ['u_runner_n', 'u_armoire'],
  ['u_armoire', 'u_hdoor'],
  ['u_armoire', 'u_runner_s'],
  ['u_runner_s', 'u_ddoor'],
  ['u_hdoor', 'u2_hdoor', 'D_HARLAN'],
  ['u_ddoor', 'u2_ddoor', 'D_DRESSING'],
  ['u2_hdoor', 'u2_mid'],
  ['u2_ddoor', 'u2_mid'],
  ['u2_hdoor', 'u2_coats'],
  ['u2_ddoor', 'u2_coats'],
  ['u2_mid', 'u2_ledger'],
  ['u2_ledger', 'u2_bell'],
  ['u2_mid', 'u2_hammer'],
  ['u_ada', 'u3_door', 'D_ADA'],
  ['u3_door', 'u3_wardrobe'],
  ['u3_door', 'u3_mid'],
  ['u3_wardrobe', 'u3_mid'],
  ['u3_mid', 'u3_letter'],
  ['u3_letter', 'u3_dress'],
  ['u3_mid', 'u3_dress'],
];

const d3 = (a: P3, b: P3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const d2 = (a: P3, b: P3) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ------------------------------------------------------------------ the sim

export interface SimOptions {
  seed?: number;
  /** Die once, on purpose, at each of these checkpoints (first time reached). */
  dieAt?: CheckpointId[];
  /** B09: raise the lit locket at her during the dress visit instead of hiding (early-finale branch). */
  earlyFinale?: boolean;
  /** After an early finale, go down the main stair to the hall first (C5 before the can). */
  hallFirst?: boolean;
  maxSeconds?: number;
  /** Extra / overriding DirectorHost members (e2e: the real CutscenePlayer, documents, the fade's playerCanSee).
   *  Called once inside the constructor: use `sim` lazily (sim.director does not exist yet). */
  host?: (sim: Sim) => Partial<DirectorHost>;
}

type Task = { kind: 'go'; to: string; speed?: number; then?: () => void; label: string } | { kind: 'wait'; label: string } | { kind: 'approach'; label: string };

export class Sim {
  readonly events = new EventBus<GameEvents>();
  readonly flags = new Map<string, boolean>();
  readonly doors = new Map<string, DoorState>();
  readonly director: Director;
  readonly o: SimOptions;
  t = 0;
  readonly dt = 0.05;
  // player
  pos: P3 = [...PW.gate] as P3;
  room: string | null = 'EXT2';
  crouched = false;
  running = false;
  speed = 0;
  hiddenIn: string | null = null;
  holding = false;
  breathHeld = 0;
  beamOn = false;
  locketRaised = false;
  facing = Math.PI / 2;
  items = new Set<string>();
  // bookkeeping
  beats: BeatId[] = [];
  checkpoints: CheckpointId[] = [];
  respawns: CheckpointId[] = [];
  deaths: { cp: string; cause: string; t: number; beat: string }[] = [];
  relocations: { node: string; forced: boolean; inView: boolean; t: number }[] = [];
  softLocks: string[] = [];
  log: string[] = [];
  prompts: string[] = [];
  ended = false;
  ada: AdaOutput | null = null;
  cutscene: string | null = null;
  private triggersIn = new Set<string>();
  private path: string[] = [];
  private stepFrom: string | null = null;
  private task: Task | null = null;
  private stormEvery = 35;
  private rumble = 1;
  private nextFlash = 5;
  private diedAt = new Set<string>();
  private dyingAt: string | null = null;
  private lastBeatChangeT = 0;
  private stepDist = 0;
  private lastPull = -1e9;
  private readonly waitUntil = new Map<string, number>();
  private showing = false;

  constructor(o: SimOptions = {}) {
    this.o = o;
    for (const d of layout.doors) this.doors.set(d.id, d.initial === 'bolted' || d.initial === 'boarded' || d.initial === 'locked' ? 'locked' : d.initial === 'ajar' || d.initial === 'open' ? 'open' : 'closed');
    const host: DirectorHost = {
      player: () => this.view(),
      doorState: (id) => this.doors.get(id) ?? 'closed',
      lineOfSight: (a, b) => this.los(a, b),
      playerCanSee: (p) => this.playerCanSee(p),
      pushDoor: (id) => this.doors.set(id, 'open'),
      door: (id, action) => {
        if (action === 'rope_open') this.doors.set('D_FRONT', 'open');
        else if (action === 'rope_close') this.doors.set('D_FRONT', 'locked');
        else if (action === 'lock') this.doors.set(id, 'locked');
        else if (this.doors.get(id) === 'locked') this.doors.set(id, 'closed');
      },
      storm: (s, r) => {
        this.stormEvery = s;
        this.rumble = r;
        this.nextFlash = s > 0 ? Math.min(this.nextFlash, this.t + s) : Infinity;
      },
      lightning: () => this.strike(),
      teleport: (_id, pos) => {
        if (this.hiddenIn) {
          const h = this.hiddenIn;
          this.hiddenIn = null;
          this.events.emit('player:hide', { hideId: h, inside: false });
        }
        this.pos = [pos[0], pos[1], pos[2] - 1.65];
        this.room = G.roomAt(this.pos) ?? this.room;
        this.path = [];
        this.task = null;
        this.stepFrom = null;
        this.holding = false;
        this.breathHeld = 0;
      },
      removeItem: (id) => {
        this.items.delete(id);
        this.flags.set(`has_${id}`, false);
        this.events.emit('flag', { name: `has_${id}`, value: false });
      },
      raiseLocket: () => {
        this.locketRaised = true;
        this.beamOn = true;
      },
      prompt: (t) => this.prompts.push(t),
      toast: (t) => this.log.push(`${this.t.toFixed(1)} toast ${t}`),
      hint: (t) => this.log.push(`${this.t.toFixed(1)} hint ${t}`),
      end: () => (this.ended = true),
      ada: (out) => {
        this.ada = out;
        for (const e of out.events) if (e.type === 'relocated') this.relocations.push({ node: e.node, forced: e.forced, inView: this.playerCanSee(G.node(e.node).pos), t: this.t });
      },
    };
    if (o.host) Object.assign(host, o.host(this));
    this.director = new Director({ layout, events: this.events, host, flags: this.flags, seed: o.seed ?? 1, cutsceneFallbackS: 1.5 });
    // world-lane mimicry: door unlock flags
    this.events.on('flag', ({ name, value }) => {
      if (!value) return;
      for (const d of layout.doors) if (d.unlockFlag === name && this.doors.get(d.id) === 'locked') this.doors.set(d.id, 'closed');
    });
    this.events.on('beat:enter', ({ id }) => {
      this.beats.push(id as BeatId);
      this.lastBeatChangeT = this.t;
    });
    this.events.on('checkpoint', ({ id }) => this.checkpoints.push(id as CheckpointId));
    this.events.on('player:respawn', ({ checkpoint }) => {
      this.respawns.push(checkpoint as CheckpointId);
      this.dyingAt = null;
    });
    this.events.on('player:death', ({ cause }) => {
      const cp = this.director.story.s.checkpoint ?? '';
      this.diedAt.add(cp);
      this.deaths.push({ cp, cause, t: this.t, beat: this.director.story.beat });
    });
    this.events.on('cutscene:start', ({ id }) => (this.cutscene = id));
    this.events.on('cutscene:end', () => (this.cutscene = null));
  }

  // ------------------------------------------------------------------ world model

  eye(): P3 {
    return [this.pos[0], this.pos[1], this.pos[2] + (this.crouched ? 1.05 : 1.65)];
  }

  private beam(): BeamView {
    const e = this.eye();
    let dir: P3 = [Math.cos(this.facing), Math.sin(this.facing), -0.1];
    if (this.locketRaised && this.ada) {
      const a = this.ada.pos;
      const v: P3 = [a[0] - e[0], a[1] - e[1], a[2] + 1.3 - e[2]];
      const l = Math.hypot(...v) || 1;
      dir = [v[0] / l, v[1] / l, v[2] / l];
    }
    return { on: this.beamOn, origin: e, dir, range: 14, halfAngle: 0.3, hit: null };
  }

  view(): PlayerView {
    return {
      pos: [...this.pos] as P3,
      eye: this.eye(),
      room: this.room,
      crouched: this.crouched,
      running: this.running,
      speed: this.speed,
      hiddenIn: this.hiddenIn,
      holdingBreath: this.holding,
      beam: this.beam(),
      locketRaised: this.locketRaised,
    };
  }

  /** Approximate LOS: same room, or rooms joined by an open door / arch / stairwell. */
  los(a: P3, b: P3): boolean {
    const ra = G.roomAt([a[0], a[1], a[2] - 1.4]) ?? G.roomAt(a);
    const rb = G.roomAt([b[0], b[1], b[2] - 1.4]) ?? G.roomAt(b);
    if (!ra || !rb) return d3(a, b) < 1.5;
    if (ra === rb) return true;
    // across floors only through the open stairwell itself (the main stair runs along the west wall, x < 1.3)
    if (Math.abs(a[2] - b[2]) > 2 && !(a[0] < 2 && b[0] < 2)) return false;
    return layout.roomLinks.some(
      (l) => ((l.a === ra && l.b === rb) || (l.a === rb && l.b === ra)) && (l.via === 'arch' || l.via === 'stairwell' || (l.via === 'door' && l.doorId && this.doors.get(l.doorId) === 'open')),
    );
  }

  playerCanSee(p: P3): boolean {
    if (this.hiddenIn) return false;
    const target: P3 = [p[0], p[1], p[2] + 1.4];
    return d3(this.eye(), target) < 20 && this.los(this.eye(), target);
  }

  private strike(): void {
    this.events.emit('lightning', { strength: 1, durationMs: 800 });
    this.events.emit('thunder', { delayMs: 1500, durationMs: 2500 * this.rumble, distance: 0.5 });
  }

  noise(radius: number, source: 'player' | 'door' | 'prop' = 'player', at: P3 = this.pos, room = this.room ?? 'EXT2'): void {
    this.events.emit('noise', { pos: [...at] as P3, room, radius, source });
  }

  // ------------------------------------------------------------------ player navigation

  private passable(door?: string): boolean {
    return !door || this.doors.get(door) !== 'locked';
  }

  nearestWp(p: P3 = this.pos): string {
    let best = 'gate';
    let bd = Infinity;
    for (const [k, v] of Object.entries(PW)) {
      const d = d2(v, p) + Math.abs(v[2] - p[2]) * 3;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  }

  route(from: string, to: string): string[] | null {
    const dist = new Map<string, number>([[from, 0]]);
    const prev = new Map<string, string>();
    const done = new Set<string>();
    for (;;) {
      let u: string | null = null;
      let bd = Infinity;
      for (const [k, v] of dist) if (!done.has(k) && v < bd) { bd = v; u = k; }
      if (u === null) return null;
      if (u === to) break;
      done.add(u);
      for (const [a, b, door] of PE) {
        const v = a === u ? b : b === u ? a : null;
        if (!v || !this.passable(door)) continue;
        const nd = bd + d3(PW[u], PW[v]);
        if (nd < (dist.get(v) ?? Infinity)) {
          dist.set(v, nd);
          prev.set(v, u);
        }
      }
    }
    const out = [to];
    while (out[0] !== from) out.unshift(prev.get(out[0])!);
    return out;
  }

  private doorBetween(a: string, b: string): string | undefined {
    return PE.find((e) => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a))?.[2];
  }

  /** Walk toward the task's waypoint. Returns true on arrival. */
  private move(to: string, speed: number): boolean {
    if (!this.path.length || this.path[this.path.length - 1] !== to) {
      const from = this.nearestWp();
      const r = this.route(from, to);
      if (!r) {
        this.softLocks.push(`${this.t.toFixed(1)} ${this.director.story.beat}: no route ${from} → ${to} (doors ${JSON.stringify(Object.fromEntries(this.doors))})`);
        return false;
      }
      this.path = d3(PW[r[0]], this.pos) < 0.05 ? r.slice(1) : r;
      this.stepFrom = this.nearestWp();
    }
    let budget = speed * this.dt;
    const start: P3 = [...this.pos] as P3;
    while (budget > 0 && this.path.length) {
      const next = this.path[0];
      const door = this.stepFrom ? this.doorBetween(this.stepFrom, next) : undefined;
      if (door) {
        const st = this.doors.get(door);
        if (st === 'locked') {
          this.path = [];
          return false;
        }
        if (st === 'closed') {
          this.doors.set(door, 'open');
          this.noise(3, 'door');
        }
      }
      const tgt = PW[next];
      const d = d3(this.pos, tgt);
      if (d <= budget) {
        budget -= d;
        this.pos = [...tgt] as P3;
        this.stepFrom = next;
        this.path.shift();
      } else {
        const k = budget / d;
        this.pos = [this.pos[0] + (tgt[0] - this.pos[0]) * k, this.pos[1] + (tgt[1] - this.pos[1]) * k, this.pos[2] + (tgt[2] - this.pos[2]) * k];
        budget = 0;
      }
    }
    const mv = d2(start, this.pos);
    this.speed = mv / this.dt;
    if (mv > 1e-4 && !this.locketRaised) this.facing = Math.atan2(this.pos[1] - start[1], this.pos[0] - start[0]);
    const r = G.roomAt(this.pos);
    if (r && r !== this.room) this.room = r;
    // footsteps (design radii): crouch 1.5, runner 2, bare 4, run 10
    this.stepDist += d3(start, this.pos);
    if (this.stepDist >= 0.7) {
      this.stepDist = 0;
      const onRunner = this.room === 'U1' && this.pos[0] > 1.3 && this.pos[0] < 3.2;
      const radius = this.running ? 10 : this.crouched ? 1.5 : onRunner ? 2 : 4;
      if (this.room) this.noise(radius);
    }
    return this.path.length === 0 && d3(this.pos, PW[to]) < 1e-6;
  }

  // ------------------------------------------------------------------ world interactions (mimic src/world)

  /** Where a cutscene hands the body back (CutsceneWorld.placePlayer): PLAN eye position; the scripted walk re-plans. */
  placeAt(eye: P3): void {
    this.pos = [eye[0], eye[1], eye[2] - 1.65];
    this.room = G.roomAt(this.pos) ?? this.room;
    this.path = [];
    this.task = null;
    this.stepFrom = null;
  }

  interact(id: string, action: string): void {
    for (const f of this.onVerb) f('interact', `${id}:${action}`);
    if (action.startsWith('take_')) {
      const item = action.slice(5);
      if (!this.items.has(item)) {
        this.items.add(item);
        this.flags.set(`has_${item}`, true);
        this.events.emit('flag', { name: `has_${item}`, value: true });
      }
    }
    if (action === 'knock') this.noise(12, 'prop', [1.8, -0.36, 0.6], 'G1');
    if (action === 'ring_bell') this.noise(12, 'prop', [2.55, -0.34, 0.6], 'G2');
    this.events.emit('interact', { id, action });
  }

  pry(k: number): void {
    for (const f of this.onVerb) f('pry', `board_${k}`);
    this.noise(8, 'prop', [3.6, 8.2, 4.1], 'U1');
    const f = `ada_board_${k}`;
    this.flags.set(f, true);
    this.events.emit('flag', { name: f, value: true });
    this.events.emit('interact', { id: `board_${k}`, action: 'pry' });
    if ([1, 2, 3].every((i) => this.flags.get(`ada_board_${i}`))) {
      this.flags.set('ada_boards_pried', true);
      this.events.emit('flag', { name: 'ada_boards_pried', value: true });
    }
  }

  hide(id: string): void {
    if (this.hiddenIn) return;
    for (const f of this.onVerb) f('hide', id);
    const h = layout.hides.find((x) => x.id === id)!;
    this.pos = [...h.entry] as P3;
    this.hiddenIn = id;
    this.path = [];
    this.speed = 0;
    this.events.emit('player:hide', { hideId: id, inside: true });
  }

  unhide(): void {
    if (!this.hiddenIn) return;
    for (const f of this.onVerb) f('unhide', this.hiddenIn);
    const id = this.hiddenIn;
    this.hiddenIn = null;
    this.stepFrom = this.nearestWp();
    this.events.emit('player:hide', { hideId: id, inside: false });
  }

  // ------------------------------------------------------------------ the scripted player

  private f(n: string): boolean {
    return this.flags.get(n) === true;
  }

  private go(to: string, then?: () => void, label = to, speed?: number): Task {
    return { kind: 'go', to, then, label, speed };
  }

  private dying(): Task | null {
    const s = this.director.story.s;
    const cp = s.checkpoint;
    if (!cp || !this.o.dieAt?.includes(cp) || this.diedAt.has(cp) || s.dead) return null;
    // CP6: hide for the dress visit as usual but never hold the breath (see act())
    if (cp === 'CP6') return null;
    if (this.dyingAt === null) {
      // die only once the checkpoint's section is actually under way and she is on stage
      if (cp === 'CP2' && s.beat !== 'B04') return null;
      if (cp !== 'CP2' && (!this.ada || !this.ada.visible || this.ada.state === 'SCRIPTED' || this.ada.state === 'FINALE')) return null;
      this.dyingAt = cp;
    }
    if (cp === 'CP2') return { kind: 'wait', label: 'die:CP2' }; // stand still > 2 s
    if (cp === 'CP8') {
      this.beamOn = true;
      this.locketRaised = false;
      return { kind: 'approach', label: 'die:CP8' };
    }
    return { kind: 'approach', label: `die:${cp}` };
  }

  private decide(): Task {
    const s = this.director.story.s;
    const b = s.beat;
    const f = (n: string) => this.f(n);
    if (s.dead || this.cutscene) return { kind: 'wait', label: 'cutscene' };
    const die = this.dying();
    if (die) return die;
    const ada = this.ada;
    const lured = ada?.state === 'LURED';
    switch (b) {
      case 'B01':
        return { kind: 'wait', label: 'C1' };
      case 'B02':
        if (f('front_door_open')) return this.go('hall_s');
        if (!f('knocked')) return this.go('porch', () => this.interact('P_KNOCKER', 'knock'), 'knock');
        if (!f('rang_front_bell')) return this.go('porch', () => this.interact('P_BELL_KNOB', 'ring_bell'), 'ring');
        return { kind: 'wait', label: 'door opening' };
      case 'B03':
        return this.go('threshold');
      case 'B04':
        this.running = true;
        return this.go('u_armoire', () => this.hide('H_ARMOIRE'), 'flee to the armoire', 3.6);
      case 'B05':
        this.running = false;
        if (this.hiddenIn) return f('first_hide_done') ? { kind: 'wait', label: 'unhide' } : { kind: 'wait', label: 'slats' };
        return this.go('u2_mid', undefined, 'sneak to U2', 1.6);
      case 'B06':
        if (!f('ledger_read') || s.ledgerPages < 3) return this.go('u2_ledger', () => this.interact('P_LEDGER', 'read_ledger'), 'ledger');
        return this.go('u2_hammer', () => this.interact('P_HAMMER', 'take_hammer'), 'hammer');
      case 'B07':
        return { kind: 'wait', label: 'C3' };
      case 'B08': {
        if (f('ada_boards_pried')) return this.go('u3_mid');
        const lureOk = lured && ada!.phase === 'scrape';
        if (!lureOk) {
          if (this.t - this.lastPull < 25) return this.hiddenIn ? { kind: 'wait', label: 'lie low' } : this.go('u2_bell', undefined, 'wait by the bell');
          return this.go('u2_bell', () => {
            this.lastPull = this.t;
            this.interact('P_BELL_PULL', 'pull_bell');
          }, 'pull the bell');
        }
        return this.go('u_ada', undefined, 'boards');
      }
      case 'B09':
        if (this.o.earlyFinale && f('has_locket') && !f('locket_given')) {
          // wait in the dark in the sewing room; when she comes in: light on, locket up, stand still
          if (this.ada?.room === 'U3') this.showing = true;
          this.beamOn = this.showing;
          this.locketRaised = this.showing;
          return this.showing ? { kind: 'wait', label: 'let her look (early)' } : this.go('u3_mid', undefined, 'wait for her in the dark');
        }
        if (!f('letter_read')) return this.go('u3_letter', () => this.interact('P_LETTER', 'read_letter'), 'letter');
        if (!f('has_shears')) return this.go('u3_letter', () => this.interact('P_SHEARS', 'take_shears'), 'shears');
        if (!f('hem_cut')) return this.go('u3_dress', () => this.interact('P_DRESS', 'cut_hem'), 'hem');
        if (!f('has_locket') && !f('locket_given')) return this.go('u3_dress', () => this.interact('P_LOCKET', 'take_locket'), 'locket');
        if (!f('dress_visit_done')) {
          return this.hiddenIn ? { kind: 'wait', label: 'dress visit' } : this.go('u3_wardrobe', () => this.hide('H_ADA_WARDROBE'), 'hide for the dress visit');
        }
        if (this.hiddenIn) return { kind: 'wait', label: 'unhide' };
        this.locketRaised = false;
        this.beamOn = false;
        if (f('locket_given') && this.o.hallFirst && !f('harlan_taken')) return this.go('hall_n', undefined, 'hall first (C5 before the can)');
        return this.go('u4_foot', undefined, 'servants stair');
      case 'B10':
        if (!f('has_can')) return this.go('k_cans', () => this.interact('P_JERRY_10', 'take_can'), 'can');
        if (!f('passage_unbolted')) return this.go('p_east', () => this.interact('D_PASSAGE', 'rattle_bolted'), 'unbolt');
        return this.go('p_door');
      case 'B11':
        if (f('locket_given')) return this.go('hall_n', undefined, 'wait for C5');
        this.beamOn = true;
        this.locketRaised = true;
        return this.go('hall_n', undefined, 'let her look');
      case 'B12':
        this.beamOn = false;
        this.locketRaised = false;
        if (!f('has_can')) return this.go('k_cans', () => this.interact('P_JERRY_10', 'take_can'), 'can (after C5)');
        if (!f('passage_unbolted') && this.room !== 'G1' && this.room !== 'EXT2') return this.go('p_east', () => this.interact('D_PASSAGE', 'rattle_bolted'), 'unbolt');
        return this.go('car', () => this.interact('P_CAR_ROW', 'car'), 'car');
      default:
        return { kind: 'wait', label: 'sting' };
    }
  }

  private act(): void {
    const s = this.director.story.s;
    if (this.hiddenIn) {
      // breath policy: hold while her head lifts / is lifted near the slats (never in the CP6 death run)
      const h = layout.hides.find((x) => x.id === this.hiddenIn)!;
      const near = this.ada && d3(this.ada.pos, h.entry) < 3 && (this.ada.head === 'lifting' || this.ada.head === 'lifted');
      const cp6Death = s.checkpoint === 'CP6' && !!this.o.dieAt?.includes('CP6') && !this.diedAt.has('CP6');
      const want = !!near && !cp6Death;
      if (want && !this.holding && this.breathHeld === 0) {
        for (const f of this.onVerb) f('breath', this.hiddenIn!);
        this.holding = true;
        this.events.emit('player:breath', { holding: true });
      }
      if (this.holding) {
        this.breathHeld += this.dt;
        if (!want || this.breathHeld >= 7) {
          this.holding = false;
          this.events.emit('player:breath', { holding: false });
          if (this.breathHeld > 4.5) this.noise(2.5); // gasp
        }
      } else if (!want) this.breathHeld = 0;
    }
    const task = this.decide();
    this.task = task;
    this.speed = 0;
    if (task.kind === 'wait') {
      if (task.label === 'unhide') this.unhide();
      if (task.label === 'boards' || task.label.startsWith('lie')) return;
      return;
    }
    if (task.kind === 'approach') {
      if (this.hiddenIn) this.unhide();
      const a = this.ada!;
      // walk to her nearest waypoint then straight at her
      const wp = this.nearestWp(a.pos);
      if (d2(this.pos, a.pos) > 1.2 && this.nearestWp() !== wp) this.move(wp, 1.6);
      else {
        const d = d3(this.pos, a.pos);
        const k = Math.min(1, (1.6 * this.dt) / (d || 1));
        this.pos = [this.pos[0] + (a.pos[0] - this.pos[0]) * k, this.pos[1] + (a.pos[1] - this.pos[1]) * k, this.pos[2] + (a.pos[2] - this.pos[2]) * k];
        this.speed = 1.6;
        this.path = [];
      }
      return;
    }
    if (this.hiddenIn && task.label !== 'hide for the dress visit') this.unhide();
    // B08: pry the next board inside a thunder roll
    if (s.beat === 'B08' && task.label === 'boards' && d3(this.pos, PW.u_ada) < 1e-6) {
      if (this.director.brain.isMasked()) {
        const next = [1, 2, 3].find((k) => !this.f(`ada_board_${k}`));
        const key = `pry${next}`;
        if (next && (this.waitUntil.get(key) ?? 0) <= this.t) {
          this.waitUntil.set(key, this.t + 3);
          this.pry(next);
        }
      }
      return;
    }
    const arrived = this.move(task.to, task.speed ?? (this.crouched ? 0.9 : 1.6));
    if (arrived && task.then) {
      const key = `${task.label}`;
      if ((this.waitUntil.get(key) ?? 0) <= this.t) {
        this.waitUntil.set(key, this.t + 1);
        task.then();
      }
    }
  }

  private triggers(): void {
    const [x, y, z] = this.pos;
    const now = new Set<string>();
    for (const tv of layout.triggers) if (x >= tv.rect[0] && x <= tv.rect[2] && y >= tv.rect[1] && y <= tv.rect[3] && z >= tv.zMin && z <= tv.zMax) now.add(tv.id);
    if (this.hiddenIn) return;
    for (const id of now)
      if (!this.triggersIn.has(id)) {
        const tv = layout.triggers.find((q) => q.id === id)!;
        this.events.emit('interact', { id, action: tv.event });
        // the car trigger doubles as the car interaction (not once the trigger itself started C6: E is locked then)
        if (tv.event === 'b12:at_car' && !this.cutscene) this.interact('P_CAR_ROW', 'car');
      }
    this.triggersIn = now;
  }

  /** Called after every tick (tests hook assertions here). */
  readonly afterStep: (() => void)[] = [];
  /** Called at the start of every tick, before the scripted player acts (e2e: close a reading page). */
  readonly beforeStep: (() => void)[] = [];
  /** Every player verb the scripted player performs (e2e: assert the body was allowed to do it). */
  readonly onVerb: ((verb: 'interact' | 'pry' | 'hide' | 'unhide' | 'breath', what: string) => void)[] = [];

  step(): void {
    this.t += this.dt;
    for (const f of this.beforeStep) f();
    this.act();
    this.triggers();
    if (this.stormEvery > 0 && this.t >= this.nextFlash) {
      this.nextFlash = this.t + this.stormEvery;
      this.strike();
    }
    this.director.update(this.dt);
    for (const f of this.afterStep) f();
    if (this.t - this.lastBeatChangeT > 400 && !this.ended) {
      this.softLocks.push(`${this.t.toFixed(1)} stuck in ${this.director.story.beat} (task ${this.task?.label})`);
      this.lastBeatChangeT = this.t;
    }
  }

  /** New game, run until it ends (or maxSeconds / a soft-lock). */
  play(): this {
    this.director.start();
    return this.resume();
  }

  /** Keep running (after a restore, or after runUntil). */
  resume(): this {
    const max = this.o.maxSeconds ?? 1800;
    while (!this.ended && this.t < max && this.softLocks.length === 0) this.step();
    return this;
  }

  runUntil(pred: () => boolean, maxSeconds = 900): boolean {
    const end = this.t + maxSeconds;
    while (!pred() && !this.ended && this.t < end && this.softLocks.length === 0) this.step();
    return pred();
  }

  /** Everything a save needs from this "host" (doors, items, player). */
  hostState(): Record<string, unknown> {
    return { doors: Object.fromEntries(this.doors), items: [...this.items], pos: [...this.pos], flags: Object.fromEntries(this.flags), t: this.t };
  }

  restoreHost(h: Record<string, unknown>): void {
    const doors = h.doors as Record<string, DoorState>;
    for (const [k, v] of Object.entries(doors)) this.doors.set(k, v);
    this.items = new Set(h.items as string[]);
    for (const [k, v] of Object.entries(h.flags as Record<string, boolean>)) this.flags.set(k, v);
    this.pos = [...(h.pos as P3)] as P3;
    this.room = G.roomAt(this.pos) ?? this.room;
    this.t = h.t as number;
    this.lastBeatChangeT = this.t;
  }
}
