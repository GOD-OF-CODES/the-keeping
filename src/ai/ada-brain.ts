// Ada — the single chaser (docs/DESIGN.md "Chaser AI"). Deterministic (seeded RNG, own clock), PURE (no three.js,
// no DOM, no Math.random / Date.now). Positions are PLAN tuples. One `update(dt, player)` per frame returns the
// desired root position/velocity, facing, head state, animation name, tell cues and discrete events.
//
// Layers and priority (rule 3): FINALE > CATCH > SCRIPTED > CHASE > LOOK > newest(LURED | INVESTIGATE) > SEARCH >
// PATROL > VIGIL. Each layer is a small state object; the highest one present runs this tick, the others wait
// (a LOOK that starts during a lure runs first). A bell PULL overrides every state except CHASE: it cancels a LOOK /
// INVESTIGATE / SEARCH in progress; during a CHASE it is queued and fires when the chase ends without a catch.
// LISTEN is the first ≈1 s of an INVESTIGATE.
//
// Rule 1 (no cheating): the player's position is only used through sense checks — hearing (noise events, synthesized
// post-sprint panting), light (beam cone / beam landing point / flames) and sight (head lifted, cone, range, LOS),
// plus contact (the chase grab; an UNAWARE bump starts a fast LOOK first and only a bump during sight catches — #67). The only exception is SCRIPTED B04 (DESIGN: she is *held* 2–4 m behind).

import type { LevelLayout, LightDef, P3 } from '../shared/layout-types.ts';
import { AiGraph, dist3, dist2, lerp3 } from './graph.ts';
import { Nav } from './nav.ts';
import { SeededRng } from './rng.ts';
import { beamNear, beamTouches, flamesOf, hearingMargin, isPlayerLit, lureDuration, resolvePriority, seesLocket, seesPlayer, stairPortals, ThunderMask, type HearingContext } from './senses.ts';
import { HideTracker, audibleFromHide, breathGivesAway } from './hide-check.ts';
import { TUNING } from './tuning.ts';
import type { AdaAnim, AdaOutput, AdaState, AiEvent, CatchCause, DoorStateFn, HeadState, NoiseInput, PlayerView, ScriptedMode, TellCues, WorldQuery } from './types.ts';

export type RoutineKind = 'upper' | 'upper_dress' | 'ground_finale';

/** Authored patrol laps (waypoints; legs are A* on the graph, so doors/locks are honoured). */
export const ROUTINES: Record<RoutineKind, { vigil: string | null; laps: string[][]; anchors: string[] }> = {
  upper: {
    vigil: 'U_VIGIL',
    // her door → stair top (LOOK) → down the runner → glance through Harlan's two doorways → south window (LOOK) → back
    laps: [
      ['U_STAIRTOP', 'U_HDOOR_O', 'U_DDOOR_O', 'U_SWINDOW', 'U_VIGIL'],
      ['U_STAIRTOP', 'U2_BEDLOOK', 'U_SWINDOW', 'U_VIGIL'],
    ],
    anchors: ['U_VIGIL', 'U_SWINDOW'],
  },
  upper_dress: {
    vigil: 'U3_DRESS',
    laps: [
      ['U_STAIRTOP', 'U_HDOOR_O', 'U_DDOOR_O', 'U_SWINDOW', 'U3_DRESS'],
      ['U_STAIRTOP', 'U2_BEDLOOK', 'U_SWINDOW', 'U3_DRESS'],
    ],
    anchors: ['U3_DRESS', 'U_SWINDOW', 'U_VIGIL'],
  },
  ground_finale: {
    vigil: null,
    laps: [['G_STAIRFOOT', 'G_PARLOR_LURE', 'G_HALL_N', 'G_PASSAGE_E', 'G_KITCHEN_C', 'G_KITCHEN_S', 'G_HALL_MID']],
    anchors: ['G_KITCHEN_C', 'U_SWINDOW', 'U_VIGIL', 'U3_DRESS', 'G_PARLOR_LURE'],
  },
};

/** Where she is parked while offstage (on the parlor table). */
const PARK: { pos: P3; room: string } = { pos: [5.6, 2.3, 0.6], room: 'G2' };
const ALWAYS_LOOK = new Set(['U_STAIRTOP', 'U_SWINDOW', 'U2_BEDLOOK', 'G_STAIRFOOT', 'G_KITCHEN_C']);
const LURE_NODE = 'G_PARLOR_LURE';

type LookReason = 'patrol' | 'investigate' | 'search' | 'hide' | 'beam' | 'chase_lost' | 'bump';

interface LookLayer {
  phase: 'windup' | 'sight' | 'lower';
  t: number;
  windup: number;
  yaw: number;
  reason: LookReason;
  /** Hide being checked at the slats (reason 'hide'). */
  hideId: string | null;
  /** Owner token (investigate / search id) so a stale look doesn't clear a newer layer. */
  owner: number;
  seen: boolean;
}

interface ChaseLayer {
  target: P3;
  targetRoom: string | null;
  lastSenseT: number;
  burstT: number;
  /** Heading for a found hide: she knows where you are. */
  hideId: string | null;
  replanT: number;
}

interface InvLayer {
  id: number;
  t0: number;
  pos: P3;
  room: string | null;
  phase: 'listen' | 'go' | 'hide_listen' | 'wait_look';
  t: number;
  dur: number;
  hideId: string | null;
  /** Route generation: bumped only when a new stimulus really moves the target (keys nav.toPoint). */
  plan?: number;
  /** Where the current route was planned to: a new stimulus re-plans only once it is > stimulusReplanM from HERE
   *  (not from the last stimulus — a creeping source, e.g. footsteps < 1 m apart, must still pull her along). */
  planPos?: P3;
  /** Round E: where the arrival LOOK faces (a beam holder she walked toward); default = toward `pos`. */
  lookAt?: P3;
}

interface SearchLayer {
  id: number;
  phase: 'go' | 'look' | 'plaster' | 'to_hide' | 'hide_listen' | 'wait_look';
  t: number;
  dur: number;
  looks: number;
  target: P3;
  room: string | null;
  hideNode: string | null;
  hideId: string | null;
}

interface LureLayer {
  t0: number;
  phase: 'travel' | 'scrape';
  t: number;
  dur: number;
}

interface FinaleLayer {
  phase: 'stop' | 'approach' | 'look' | 'take' | 'carry' | 'wait';
  t: number;
  /** Seconds the player has been out of reach (hidden / out of sight) during the approach. */
  lostT: number;
  lastPos: P3;
  lastRoom: string | null;
}

interface ScriptedLayer {
  mode: ScriptedMode;
  phase: string;
  t: number;
  node: string | null;
  hideId: string | null;
  crumbs: { pos: P3; room: string }[];
  crumbT: number;
  stillT: number;
  lookYaw: number;
  lookT: number;
  /** b05_return: seconds since control, when the player first hid (null = not yet), rocker cue sent, tread-10 wait done. */
  clock?: number;
  hiddenAt?: number | null;
  rocker?: boolean;
  waited?: boolean;
}

interface RoutineLayer {
  kind: RoutineKind;
  mode: 'vigil' | 'patrol';
  lap: number;
  idx: number;
  t: number;
  dur: number;
  vigilVoiced: boolean;
  /** Consecutive legs skipped by the post-death away rule (optional: older saves). */
  skipped?: number;
}

export interface AdaSnapshot {
  v: 1;
  t: number;
  rng: number;
  pos: P3;
  room: string;
  facing: number;
  atNode: string | null;
  scripted: ScriptedLayer | null;
  finale: FinaleLayer | null;
  caught: CatchCause | null;
  chase: ChaseLayer | null;
  look: LookLayer | null;
  lure: LureLayer | null;
  /** A bell pulled during CHASE, honoured when the chase ends (optional: older saves). */
  lureQueued?: boolean;
  inv: InvLayer | null;
  search: SearchLayer | null;
  routine: RoutineLayer;
  lurePulls: number;
  escalation: number;
  assist: { slow: boolean; finaleWait: boolean };
  graceT: number;
  /** Optional for saves made before difficulty tuning 2026-10-08. */
  calmUntil?: number;
  /** Optional (round E): last beam LOOK that saw nothing. */
  beamMissT?: number;
  seenAcc?: number;
  thunder: { from: number; to: number }[];
  firstHideDone: boolean;
  lastSeenT: number;
  pantUntil: number;
  nextId: number;
  display: AdaState;
  parked: boolean;
  pendingRelocate: string | null;
}

interface BedBox {
  room: string;
  c: [number, number];
  z: number;
  /** Half extents along the bed's local x (width) and y (length). */
  hx: number;
  hy: number;
  yaw: number;
}

/** P_BED's footprint (props face -y at yaw 0: width along x, length along y). */
export function bedBox(layout: LevelLayout): BedBox | null {
  const p = layout.props.find((x) => x.id === 'P_BED');
  if (!p) return null;
  const par = (p.params ?? {}) as Record<string, unknown>;
  const w = typeof par.width === 'number' ? par.width : 1.4;
  const l = typeof par.length === 'number' ? par.length : 2;
  return { room: p.room, c: [p.pos[0], p.pos[1]], z: p.pos[2], hx: w / 2, hy: l / 2, yaw: p.yaw ?? 0 };
}

/** Closest point of the bed's footprint to p (PLAN, at p's height). */
export function bedNearest(b: BedBox, p: P3): P3 {
  const cs = Math.cos(b.yaw);
  const sn = Math.sin(b.yaw);
  const dx = p[0] - b.c[0];
  const dy = p[1] - b.c[1];
  const lx = Math.max(-b.hx, Math.min(b.hx, dx * cs + dy * sn));
  const ly = Math.max(-b.hy, Math.min(b.hy, -dx * sn + dy * cs));
  return [b.c[0] + lx * cs - ly * sn, b.c[1] + lx * sn + ly * cs, p[2]];
}

/** What a bell pull did: lured her now, queued behind a CHASE, or ignored (scripted / finale / catch / nonstop bell). */
export type BellResult = 'lured' | 'queued' | 'ignored';

export interface AdaBrainOptions {
  seed?: number;
  /** Starting node (default: her vigil). */
  startNode?: string;
  routine?: RoutineKind;
}

export class AdaBrain {
  readonly g: AiGraph;
  readonly layout: LevelLayout;
  readonly world: WorldQuery;
  readonly nav: Nav;
  readonly hides: HideTracker;
  readonly thunder = new ThunderMask();
  private readonly rng: SeededRng;
  private readonly flames: LightDef[];
  private readonly portals: Map<string, P3>;
  /** Harlan's bed (P_BED, U2): SEARCH beside it plays ada_search_bed instead of the plaster search. */
  private readonly bed: BedBox | null;
  /** Offstage while waiting for an out-of-view anchor (grace when every anchor is in view). */
  parked = false;

  t = 0;
  scripted: ScriptedLayer | null = null;
  finale: FinaleLayer | null = null;
  caught: CatchCause | null = null;
  chase: ChaseLayer | null = null;
  look: LookLayer | null = null;
  lure: LureLayer | null = null;
  /** A bell pulled during CHASE: the lure fires when the chase ends (lost / hide out of reach); a catch drops it. */
  lureQueued = false;
  inv: InvLayer | null = null;
  search: SearchLayer | null = null;
  routine: RoutineLayer;
  /** Bell pulls since the last reset (death / new game): 60, 50, 40 s. */
  lurePulls = 0;
  escalation = 0;
  assist = { slow: false, finaleWait: false };
  /** Time grace started (−∞ = none). */
  graceT = -Infinity;
  /** Respawn fairness (round E ruling b): the player's position as of the last update (routine legs keep away from it
   *  for grace.awayS) and the time a held routine re-plans. */
  private playerPos: P3 | null = null;
  private awayHoldT = -Infinity;
  /** Post-cutscene calm (difficulty 2026-10-08): she perceives nothing until this time. */
  calmUntil = -Infinity;
  /** Continuous time the player has been in her sight while not chasing (the notice dwell). */
  seenAcc = 0;
  lastSeenT = -Infinity;
  private pantUntil = -Infinity;
  private runAccum = 0;
  private pantTick = 0;
  private lastGurgleT = -Infinity;
  private beamCooldownT = -Infinity;
  /** Round E (B11 'let her look' stall): when a beam LOOK last ended without seeing the holder (−∞ = never). */
  private beamMissT = -Infinity;
  private noiseQueue: NoiseInput[] = [];
  private prevHidden: string | null = null;
  private nextId = 1;
  private display: AdaState = 'VIGIL';
  private head: HeadState = 'hanging';
  private lookYawNow = 0;
  private events: AiEvent[] = [];
  private tells: TellCues = { dripRate: 0.8, dripStopped: false, crack: false, gurgle: false, loop: null, lookWindup: TUNING.look.windup };
  private pendingRelocate: string | null = null;
  private lastDoorReqT = -Infinity;
  private lastDoorReqPos: P3 = [0, 0, 0];

  constructor(layout: LevelLayout, world: WorldQuery, opts: AdaBrainOptions = {}) {
    this.layout = layout;
    this.world = world;
    this.g = new AiGraph(layout);
    this.rng = new SeededRng(opts.seed ?? 0x0ada);
    const kind = opts.routine ?? 'upper';
    const start = opts.startNode ?? ROUTINES[kind].vigil ?? ROUTINES[kind].laps[0][0];
    this.nav = new Nav(this.g, start);
    this.hides = new HideTracker(layout.hides);
    this.flames = flamesOf(layout);
    const fz = new Map(layout.floors.map((f) => [f.id, f.elevation]));
    this.portals = stairPortals(layout.stairs, (id) => fz.get(id) ?? 0);
    this.bed = bedBox(layout);
    this.routine = this.newRoutine(kind, start === ROUTINES[kind].vigil ? 'vigil' : 'patrol');
  }

  // =================================================================== commands (story / adapter)

  /** Queue a noise (GameEvents['noise']). Evaluated against her position on the next update. */
  noise(n: NoiseInput): void {
    this.noiseQueue.push(n);
  }

  /** A `thunder` event: masks all non-script sound from now+delay for duration (AUDIO.md contract). */
  thunderRoll(delayMs?: number, durationMs?: number): void {
    this.thunder.add(this.t, delayMs, durationMs);
  }

  isMasked(): boolean {
    return this.thunder.isMasked(this.t);
  }

  /**
   * A bell pull anywhere in the house. The bell overrides every state (VIGIL, PATROL, LISTEN, INVESTIGATE, LOOK,
   * SEARCH, an earlier lure) except an active CHASE, which it never breaks: then the lure is QUEUED and fires when
   * the chase ends without a catch. 'ignored' = SCRIPTED / FINALE / CATCH / the nonstop-bell ground routine.
   */
  bell(): BellResult {
    if (this.finale || this.caught || this.scripted) return 'ignored';
    if (this.routine.kind === 'ground_finale') return 'ignored'; // the nonstop bell already calls her onto the ground floor
    if (this.chase) {
      this.lureQueued = true;
      return 'queued';
    }
    this.startLure();
    return 'lured';
  }

  /** The bell calls her: drop what she was doing (a LOOK in progress, an investigation, a search) and go down. */
  private startLure(): void {
    this.lureQueued = false;
    this.look = null;
    this.inv = null;
    this.search = null;
    this.noiseQueue = []; // anything heard before the bell is older than it: the bell is the newest stimulus
    this.lurePulls++;
    const dur = lureDuration(this.lurePulls);
    if (this.lure && this.lure.phase === 'scrape') {
      this.lure.t0 = this.t;
      this.lure.t = 0;
      this.lure.dur = dur;
    } else this.lure = { t0: this.t, phase: 'travel', t: 0, dur };
    this.nav.goalKey = '';
  }

  /** Current / next lure hold time (s). */
  nextLureDuration(): number {
    return lureDuration(this.lurePulls + 1);
  }

  setRoutine(kind: RoutineKind): void {
    if (this.routine.kind === kind) return;
    this.routine = this.newRoutine(kind, 'patrol');
    this.nav.goalKey = '';
  }

  setEscalation(level: number): void {
    this.escalation = Math.max(0, Math.min(2, Math.floor(level)));
  }

  setAssist(a: Partial<{ slow: boolean; finaleWait: boolean }>): void {
    this.assist = { ...this.assist, ...a };
  }

  spendFirstHide(): void {
    this.hides.spendFirstHide();
  }

  /**
   * Scripted control. 'hidden' parks her offstage; 'hold' stands her at `node` (cutscene cover, `force` skips the
   * in-view guard); 'b05_return' runs her return after C2c through `node` (default the parlor door); 'hide_demo' runs the
   * first-hide demo at `hideId`; 'dress' runs the C4 dress visit.
   */
  setScripted(mode: ScriptedMode, opts: { node?: string; hideId?: string; force?: boolean } = {}): void {
    const s: ScriptedLayer = { mode, phase: 'start', t: 0, node: opts.node ?? null, hideId: opts.hideId ?? null, crumbs: [], crumbT: 0, stillT: 0, lookYaw: 0, lookT: 0 };
    this.clearStimuli();
    this.caught = null;
    this.scripted = s;
    if (mode === 'hidden') {
      this.nav.placeFree(PARK.pos, PARK.room);
      this.parked = false;
      this.pendingRelocate = null;
    }
    else if (mode === 'hold') this.relocate(opts.node ?? LURE_NODE, opts.force ?? true);
    else if (mode === 'b05_return') {
      // offstage behind the locked parlor door (C2-ESCAPE §4.5) until the key turns
      this.nav.placeFree(PARK.pos, PARK.room);
      this.parked = false;
      this.pendingRelocate = null;
    }
    this.nav.goalKey = '';
  }

  clearScripted(): void {
    if (!this.scripted) return;
    const wasHidden = this.scripted.mode === 'hidden';
    this.scripted = null;
    this.nav.goalKey = '';
    if (wasHidden) {
      const v = ROUTINES[this.routine.kind].vigil ?? ROUTINES[this.routine.kind].laps[0][0];
      this.relocate(v, false);
    }
  }

  /** Move her to a node, but never where the player can see (rule 11) unless forced (cutscene cover / black). */
  relocate(nodeId: string, force = false): boolean {
    const target = this.g.node(nodeId).pos;
    if (!force && ((!this.parked && this.world.playerCanSee(this.nav.pos)) || this.world.playerCanSee(target))) {
      this.pendingRelocate = nodeId;
      return false;
    }
    this.pendingRelocate = null;
    this.parked = false;
    this.nav.placeAt(nodeId);
    this.events.push({ type: 'relocated', node: nodeId, forced: force });
    return true;
  }

  /**
   * Post-death grace (call AFTER the player has been respawned): restart at the anchor farthest from the player,
   * PATROL-only, hearing −30 % for 20 s; the bell lure resets to 60 s.
   */
  grace(playerPos: P3, playerRoom: string | null): string {
    this.clearStimuli();
    this.caught = null;
    if (this.scripted && this.scripted.mode !== 'hidden') this.scripted = null;
    this.lurePulls = 0;
    this.graceT = this.t;
    this.lastSeenT = -Infinity;
    this.hides.exit();
    const own = ROUTINES[this.routine.kind].anchors.filter((a) => this.g.nodes.has(a));
    // graph distance from the player's nearest graph point, honouring locks (an anchor behind a locked door from
    // the player's side is still valid for her, ranked by straight distance)
    const ep = this.g.nearestEdgePoint(playerPos, playerRoom);
    const from = ep ? (ep.s < 0.5 ? ep.edge.a : ep.edge.b) : null;
    const gd = from ? this.g.distances(from, this.doors) : new Map<string, number>();
    const rank = (ids: string[]) =>
      ids.map((a) => ({ a, d: gd.get(a) ?? dist3(this.g.node(a).pos, playerPos) })).sort((x, y) => y.d - x.d || (x.a < y.a ? -1 : 1));
    // her routine's anchors first, then any anchor, then any node: the farthest one the player cannot see
    const tiers = [own, this.g.tagged('anchor').map((n) => n.id).filter((id) => !own.includes(id)), [...this.g.nodes.keys()].filter((id) => !this.g.node(id).tags.includes('anchor'))];
    const ranked = rank(own);
    let chosen: string | null = null;
    for (const tier of tiers) {
      for (const r of rank(tier))
        if (!this.world.playerCanSee(this.g.node(r.a).pos)) {
          chosen = r.a;
          break;
        }
      if (chosen) break;
    }
    if (chosen) {
      this.nav.placeAt(chosen);
      this.pendingRelocate = null;
      this.parked = false;
      this.events.push({ type: 'relocated', node: chosen, forced: false });
    } else {
      // every anchor is in view: wait offstage until the farthest one is not (rule 11)
      chosen = ranked[0]?.a ?? 'U_VIGIL';
      this.nav.placeFree(PARK.pos, PARK.room);
      this.parked = true;
      this.pendingRelocate = chosen;
    }
    this.routine = this.newRoutine(this.routine.kind, 'patrol');
    this.setDisplay('PATROL');
    return chosen;
  }

  /**
   * Post-cutscene calm (difficulty 2026-10-08, ROADMAP "Difficulty"): for `seconds` she perceives nothing — no sight,
   * hearing, beam or contact — and keeps whatever the cutscene left her doing (no relocation). Nobody may be caught
   * within 6 s of a cutscene ending.
   */
  calm(seconds: number = TUNING.grace.calmS): void {
    this.calmUntil = Math.max(this.calmUntil, this.t + seconds);
    this.seenAcc = 0;
    this.noiseQueue = [];
  }

  get calmActive(): boolean {
    return this.t < this.calmUntil;
  }

  get graceActive(): boolean {
    return this.t - this.graceT < TUNING.grace.hearingS;
  }

  get patrolOnly(): boolean {
    return this.t - this.graceT < TUNING.grace.patrolOnlyS;
  }

  /** Respawn fairness (round E ruling b): after a death her routine legs keep away from the player for grace.awayS. */
  get awayActive(): boolean {
    return this.t - this.graceT < TUNING.grace.awayS;
  }

  /**
   * True when the A* route from where she stands to `nodeId` keeps ≥ grace.awayM from the player on the same floor
   * (samples every 0.25 m; a sample on another floor — |dz| > 2 m — is clear: floors block sight and contact).
   */
  private legClearOfPlayer(nodeId: string): boolean {
    const pp = this.playerPos;
    if (!pp) return true;
    const R = TUNING.grace.awayM;
    const near = (q: P3) => Math.abs(q[2] - pp[2]) <= 2 && dist2(q, pp) < R;
    const start = this.nav.atNode && dist3(this.nav.pos, this.g.node(this.nav.atNode).pos) < 0.05 ? this.nav.atNode : this.g.nearestNode(this.nav.pos)?.id;
    if (!start) return true;
    const path = this.g.path(start, nodeId, this.doors);
    if (!path) return true; // unreachable: the caller's own skip handles it
    const pts: P3[] = [this.nav.pos, ...path.nodes.map((id) => this.g.node(id).pos)];
    if (near(pts[0])) return false;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const n = Math.max(1, Math.ceil(dist3(a, b) / 0.25));
      for (let k = 1; k <= n; k++) if (near(lerp3(a, b, k / n))) return false;
    }
    return true;
  }

  get state(): AdaState {
    return this.display;
  }

  get pos(): P3 {
    return this.nav.pos;
  }

  get room(): string {
    return this.nav.room;
  }

  // =================================================================== tick

  private get doors(): DoorStateFn {
    return this.world.doorState;
  }

  private speedMul(): number {
    return this.assist.slow ? TUNING.assist.speedMul : 1;
  }

  private hearingMul(): number {
    return (this.graceActive ? TUNING.grace.hearingMul : 1) * (this.assist.slow ? TUNING.assist.noiseMul : 1);
  }

  private windup(fast: boolean): number {
    return fast ? TUNING.look.windupFast : this.assist.slow ? TUNING.look.windupAssist : TUNING.look.windup;
  }

  /**
   * Her vision source (C2-ESCAPE K9): the carried head. Lifted (or lifting) in both hands, its eye is 0.25 m ahead of
   * the stump along her facing at eye height; hanging at the hip or placed she is blind (sight already gates on
   * `head === 'lifted'`), so the eye stays over the stump for line-of-sight bookkeeping.
   */
  private eye(): P3 {
    const p = this.nav.pos;
    if (this.head === 'lifted' || this.head === 'lifting') {
      const f = this.nav.facing;
      return [p[0] + Math.cos(f) * TUNING.sight.headAheadM, p[1] + Math.sin(f) * TUNING.sight.headAheadM, p[2] + TUNING.sight.eyeHeight];
    }
    return [p[0], p[1], p[2] + TUNING.sight.eyeHeight];
  }

  private chest(): P3 {
    return [this.nav.pos[0], this.nav.pos[1], this.nav.pos[2] + TUNING.light.chestHeight];
  }

  private yawTo(p: P3): number {
    return Math.atan2(p[1] - this.nav.pos[1], p[0] - this.nav.pos[0]);
  }

  update(dt: number, player: PlayerView): AdaOutput {
    this.t += dt;
    this.playerPos = player.pos;
    this.tells = { dripRate: 0.8, dripStopped: false, crack: false, gurgle: false, loop: null, lookWindup: this.windup(false) };
    this.thunder.prune(this.t);
    if (this.pendingRelocate) this.relocate(this.pendingRelocate, false);

    const offstage =
      this.scripted?.mode === 'hidden' || (this.scripted?.mode === 'b05_return' && (this.scripted.phase === 'start' || this.scripted.phase === 'wait' || this.scripted.phase === 'key')) || this.parked;
    if (!offstage) this.sense(dt, player);
    else {
      this.noiseQueue = [];
      if (player.hiddenIn !== this.prevHidden) {
        if (player.hiddenIn) this.hides.enter(player.hiddenIn, this.t, this.lastSeenT);
        else this.hides.exit();
      }
      this.prevHidden = player.hiddenIn;
    }

    // a queued bell whose chase ended some other way (restore, a layer cleared by a command): honour it now
    if (this.lureQueued && !this.chase) {
      if (!this.finale && !this.caught && !this.scripted && this.routine.kind !== 'ground_finale') this.startLure();
      else this.lureQueued = false;
    }

    const want = resolvePriority({
      finale: !!this.finale,
      catch: !!this.caught,
      scripted: !!this.scripted,
      chase: !!this.chase,
      look: !!this.look,
      luredAt: this.lure ? this.lure.t0 : null,
      investigateAt: this.inv ? this.inv.t0 : null,
      search: !!this.search,
      patrol: this.routine.mode === 'patrol' || this.patrolOnly || !this.atVigil(),
    });

    this.head = 'hanging'; // layers that lift the head set it below
    let speed = 0;
    let anim: AdaAnim = 'idle';
    let phase = '';
    let shown: AdaState = want;
    switch (this.parked ? 'PARKED' : want) {
      case 'PARKED':
        this.nav.stop();
        anim = 'hidden';
        phase = 'parked';
        shown = 'PATROL';
        break;
      case 'FINALE':
        [speed, anim, phase] = this.tickFinale(dt, player);
        break;
      case 'CATCH':
        this.nav.stop();
        anim = 'catch_grab';
        phase = this.caught ?? '';
        this.head = 'lifted';
        break;
      case 'SCRIPTED':
        [speed, anim, phase, shown] = this.tickScripted(dt, player);
        break;
      case 'CHASE':
        [speed, anim, phase] = this.tickChase(dt, player);
        break;
      case 'LOOK':
        [anim, phase] = this.tickLook(dt);
        break;
      case 'LURED':
        [speed, anim, phase] = this.tickLure(dt);
        break;
      case 'INVESTIGATE':
        [speed, anim, phase, shown] = this.tickInvestigate(dt);
        break;
      case 'SEARCH':
        [speed, anim, phase, shown] = this.tickSearch(dt);
        break;
      default:
        [speed, anim, phase, shown] = this.tickRoutine(dt);
    }
    this.setDisplay(shown);
    // C2-ESCAPE §6.3 (K9): at her vigil she sets her head down at the foot of the door, face to the planks, and both
    // hands scrape the nail heads — blind ('placed'); a look picks it back up (the layers above set lifting/lifted)
    if (this.head === 'hanging' && (anim === 'vigil_scrape' || anim === 'lured_scrape')) this.head = 'placed';

    // tells
    const moving = this.nav.speed;
    this.tells.dripRate = 0.8 + Math.min(moving, 3.2) * 0.7;
    if (shown === 'LISTEN' || phase === 'hide_listen' || phase === 'listen') this.tells.dripStopped = true;
    if (anim === 'vigil_scrape' || anim === 'lured_scrape') this.tells.loop = 'scrape_wood';
    if (anim === 'search_plaster') this.tells.loop = 'nails_plaster';
    const visible = !offstage;
    if (visible && !player.hiddenIn && dist3(this.nav.pos, player.pos) <= TUNING.gurgle.dist && this.t - this.lastGurgleT >= TUNING.gurgle.cooldownS) {
      this.lastGurgleT = this.t;
      this.tells.gurgle = true;
      this.voice('ai:proximity_5m');
    }
    const nav = this.nav;
    const events = this.events;
    this.events = [];
    return {
      state: this.display,
      phase,
      visible,
      pos: [...nav.pos] as P3,
      vel: [...nav.vel] as P3,
      facing: nav.facing,
      lookYaw: this.head === 'hanging' ? nav.facing : this.lookYawNow,
      head: this.head,
      anim: offstage ? 'hidden' : nav.onStair && speed > 0 && anim === 'walk' ? 'stairs' : nav.waitingForDoor ? 'door_push' : anim,
      speed: nav.speed,
      room: nav.room,
      onStair: nav.onStair,
      tells: this.tells,
      events,
    };
  }

  // =================================================================== senses

  private sense(dt: number, p: PlayerView): void {
    const doors = this.doors;
    const hidden = p.hiddenIn;
    // hide enter / exit
    if (hidden !== this.prevHidden) {
      if (hidden) {
        const st = this.hides.enter(hidden, this.t, this.lastSeenT);
        if (st.found) this.hideFound(hidden);
      } else this.hides.exit();
      this.prevHidden = hidden;
    }

    // post-sprint panting (2.5 m for 4 s, even inside a hide)
    if (p.running && !hidden) this.runAccum += dt;
    else {
      if (this.runAccum >= TUNING.panting.minRunS) this.pantUntil = this.t + TUNING.panting.durationS;
      this.runAccum = 0;
    }
    if (this.t < this.pantUntil && p.room) {
      this.pantTick -= dt;
      if (this.pantTick <= 0) {
        this.pantTick = TUNING.panting.periodS;
        this.noiseQueue.push({ pos: [...p.pos] as P3, room: p.room, radius: TUNING.panting.radius, source: 'player' });
      }
    }

    // post-cutscene calm: nothing is perceived (hide bookkeeping above still runs)
    if (this.calmActive) {
      this.noiseQueue = [];
      this.seenAcc = 0;
      return;
    }

    // hearing
    const h: HearingContext = { links: this.layout.roomLinks, doors, pos: this.nav.pos, room: this.nav.room, mul: this.hearingMul(), masked: this.thunder.isMasked(this.t), portals: this.portals };
    const queue = this.noiseQueue;
    this.noiseQueue = [];
    for (const n of queue) {
      // her own door pushes
      if (n.source === 'door' && this.t - this.lastDoorReqT < 2.5 && dist3(n.pos, this.lastDoorReqPos) < 2.5) continue;
      const margin = hearingMargin(n, h);
      if (margin < 0) continue;
      this.onHeard(n, p, margin);
    }

    // light: the beam on her body → fast LOOK toward it; landing within 6 m → INVESTIGATE
    // (light is always on: even the dress visit breaks when the beam touches her; the B04/B05 set pieces don't)
    const dressing = this.scripted?.mode === 'dress' && !this.scripted.phase.startsWith('look');
    const canReact = !this.finale && !this.caught && (!this.scripted || dressing) && !this.patrolOnly;
    if (canReact && !this.chase && p.beam.on) {
      if (!this.look && beamTouches(p.beam, this.chest(), TUNING.light.bodyRadius, this.world.lineOfSight)) {
        if (this.scripted) this.endScripted();
        // round E (B11 'let her look' stall): the beam reaches her body but her eyes cannot reach the holder (the main
        // stair's balustrade / soffit between them) — a look from where she stands found nothing last time, so she
        // walks toward the light instead of looking again from the same spot forever. The investigate LOOK on
        // arrival (head lifted) is what sees the player — or, in the finale, the locket.
        if (!this.scripted && this.t - this.beamMissT < TUNING.light.beamRepeatS) {
          // one walk (the beam on her meanwhile doesn't re-aim it); on arrival she looks at the light's source
          if (!this.inv) this.comeToLook(p);
        }
        else {
          // toward the holder: the lens sits ~0.5 m ahead of the eye. Fast wind-up only when lit up close (difficulty
          // 2026-10-08: lighting her face up close is a clear mistake; a sweep across the room is a normal LOOK).
          const close = dist3(this.chest(), p.eye) <= TUNING.look.fastBeamM;
          this.startLook('beam', this.yawTo(p.eye), close, null, 0);
        }
      } else if (!this.look && !this.scripted && this.t >= this.beamCooldownT && beamNear(p.beam, this.nav.pos, this.world.lineOfSight, this.chest())) {
        this.beamCooldownT = this.t + TUNING.light.beamInvestigateCooldownS;
        const hit = p.beam.hit!;
        const at: P3 = [hit[0], hit[1], this.nav.pos[2]];
        this.stimulus(at, this.g.roomAt(at) ?? this.nav.room, 0.3);
      }
    }

    // sight (head lifted only) + the locket rule
    const lifted = this.head === 'lifted';
    if (lifted) {
      const sc = { headLifted: true, eye: this.eye(), lookYaw: this.lookYawNow, los: this.world.lineOfSight };
      if (!this.finale && !this.caught && seesLocket(sc, p)) this.startFinale();
      else if (!this.finale && !this.caught && seesPlayer(sc, p, isPlayerLit(p, this.flames))) {
        // notice dwell (difficulty 2026-10-08): a glance across her cone is a near miss; she must hold you in sight
        // for sight.noticeS (instant within closeM, or once a chase is on) before she comes for you
        this.seenAcc += dt;
        if (this.chase || this.seenAcc >= TUNING.sight.noticeS || dist3(this.eye(), p.eye) <= TUNING.sight.closeM) this.onSeen(p);
      } else this.seenAcc = Math.max(0, this.seenAcc - dt);
    } else this.seenAcc = 0;

    // hide rules: breath at the slats
    const cur = this.hides.current;
    if (cur && !cur.found && hidden) {
      const hide = this.hides.hide(hidden)!;
      const d = dist3(this.nav.pos, [hide.entry[0], hide.entry[1], hide.entry[2]]);
      const slatLook =
        this.head === 'lifted' &&
        ((this.look?.reason === 'hide' && this.look.hideId === hidden) || (this.scripted?.hideId === hidden && this.scripted.phase === 'look_sight'));
      if (breathGivesAway(slatLook, d, p.holdingBreath) && this.hides.fail('breath')) this.hideFound(hidden);
    }

    // contact
    if (!this.finale && !this.caught && !hidden) {
      const dh = dist2(this.nav.pos, p.pos);
      const dz = Math.abs(this.nav.pos[2] - p.pos[2]);
      if (dz < 1.2) {
        if (this.chase && !this.assist.finaleWait && dh <= TUNING.chase.catchDist) this.doCatch('chase');
        else if (!this.scripted && dh <= TUNING.bumpDist) {
          // gameplay review (difficulty): her head-bowed patrol walking into a still, silent player was an instant,
          // tell-less death (respawned player on her patrol line: bumped ~13 s after the respawn). An UNAWARE bump now
          // startles her — she stops, the head cracks up (fast wind-up, 1 s) and she looks at you; stay and the look
          // turns into a chase and the grab. A bump while she is already looking at you (sight phase) still catches.
          if (this.look && this.look.phase !== 'windup') this.doCatch('bump');
          else if (!this.look) this.startLook('bump', this.yawTo(p.eye), true, null, 0);
        }
      }
    }
  }

  private onHeard(n: NoiseInput, p: PlayerView, margin: number): void {
    // a noise from inside the player's hide, heard, with her within 2 m → the hide is found
    const cur = this.hides.current;
    if (cur && !cur.found && p.hiddenIn && n.source === 'player') {
      const hide = this.hides.hide(p.hiddenIn)!;
      const d = dist3(this.nav.pos, hide.entry);
      if (audibleFromHide(d, d + margin) && this.hides.fail('audible')) {
        this.hideFound(p.hiddenIn);
        return;
      }
    }
    if (this.finale || this.caught || this.scripted || this.patrolOnly) return;
    if (this.chase) {
      if (n.source === 'player' && n.radius >= TUNING.chase.runNoiseMin && !this.chase.hideId) {
        this.chase.target = [...n.pos] as P3;
        this.chase.targetRoom = n.room;
        this.chase.lastSenseT = this.t;
      }
      return;
    }
    this.stimulus(n.pos, n.room, null);
  }

  /** Newest investigate stimulus (noise / beam). listen = null → the escalation-based LISTEN freeze. */
  private stimulus(pos: P3, room: string | null, listen: number | null): void {
    const listenS = listen ?? TUNING.listenS[this.escalation];
    if (this.inv && this.inv.phase !== 'listen') {
      // the same spot again (a torch held on one wall re-fires every 2.5 s): refresh the timer but keep the route —
      // re-planning from a free leg walks her back to the nearest graph edge first, and a repeated re-plan made her
      // oscillate in place forever (B08 stall). A stimulus that moved re-plans as before.
      const moved = dist3(this.inv.planPos ?? this.inv.pos, pos) > TUNING.stimulusReplanM || this.inv.room !== room;
      this.inv.t0 = this.t;
      this.inv.pos = [...pos] as P3;
      this.inv.room = room;
      if (this.inv.phase !== 'go' || moved) {
        this.inv.plan = (this.inv.plan ?? 0) + 1;
        this.inv.planPos = [...pos] as P3;
        this.nav.goalKey = '';
      }
      if (this.inv.phase !== 'go') {
        this.inv.phase = 'go';
        this.inv.t = 0;
      }
      return;
    }
    if (this.inv) {
      this.inv.t0 = this.t;
      this.inv.pos = [...pos] as P3;
      this.inv.room = room;
      return;
    }
    this.inv = { id: this.nextId++, t0: this.t, pos: [...pos] as P3, room, phase: 'listen', t: 0, dur: listenS, hideId: null };
    this.lure = null; // the newest stimulus wins; the lure is spent
  }

  private onSeen(p: PlayerView): void {
    this.lastSeenT = this.t;
    if (this.chase) {
      if (!this.chase.hideId) {
        this.chase.target = [...p.pos] as P3;
        this.chase.targetRoom = p.room;
      }
      this.chase.lastSenseT = this.t;
      return;
    }
    if (this.scripted) {
      if (this.scripted.mode !== 'dress') return;
      this.endScripted();
    }
    // round E (careless gate, forgiving ruling): a FIRST sighting beyond sight.chaseM (a lit player across the hall, or
    // one walking through her patrol at mid range) is a near miss, not a death sentence — she drops the look and comes
    // to where she saw you (INVESTIGATE, arrival LOOK facing you). Seen again within chaseM, or close, she chases.
    if (dist3(this.eye(), p.eye) > TUNING.sight.chaseM) {
      this.look = null;
      this.seenAcc = 0;
      this.beamMissT = this.t; // a torch still on her while she walks over must not pin her in another look (B11 rule)
      this.comeToLook(p);
      return;
    }
    this.startChase(p.pos, p.room);
  }

  /** Round E: INVESTIGATE toward the player, to a spot 2.5 m short of him (the arrival LOOK, facing him, is within
   *  locket and close-sight range; walking all the way would end in a bump). */
  private comeToLook(p: PlayerView): void {
    const dx = this.nav.pos[0] - p.pos[0];
    const dy = this.nav.pos[1] - p.pos[1];
    const d = Math.hypot(dx, dy);
    const k = d > 2.5 ? 2.5 / d : 0;
    const at: P3 = [p.pos[0] + dx * k, p.pos[1] + dy * k, p.pos[2]];
    this.stimulus(at, this.g.roomAt(at) ?? p.room ?? this.nav.room, 0.3);
    if (this.inv) this.inv.lookAt = [...p.eye] as P3;
  }

  private startChase(target: P3, room: string | null, hideId: string | null = null): void {
    this.look = null;
    this.search = null;
    this.inv = null;
    this.lure = null;
    this.chase = { target: [...target] as P3, targetRoom: room, lastSenseT: this.t, burstT: 0, hideId, replanT: 0 };
    this.head = 'lifted';
    this.nav.goalKey = '';
    this.voice('ai:chase');
  }

  private hideFound(hideId: string): void {
    this.events.push({ type: 'hide_found', hideId });
    const hide = this.hides.hide(hideId)!;
    const node = this.g.hideCheckNode(hide);
    if (this.scripted) this.endScripted();
    if (dist3(this.nav.pos, node.pos) <= 2.5) this.doCatch('hide');
    else this.startChase(node.pos, node.room, hideId);
  }

  private doCatch(cause: CatchCause): void {
    if (this.caught || this.finale) return;
    this.caught = cause;
    this.chase = null;
    this.lureQueued = false;
    this.look = null;
    this.nav.stop();
    this.events.push({ type: 'catch', cause });
    this.voice('ai:catch');
  }

  private startFinale(): void {
    if (this.finale) return;
    if (this.scripted) this.endScripted();
    this.clearStimuli();
    this.finale = { phase: 'stop', t: 0, lostT: 0, lastPos: [...this.nav.pos] as P3, lastRoom: this.nav.room };
    this.head = 'lifted';
    this.nav.stop();
    this.events.push({ type: 'finale', phase: 'start' });
  }

  private clearStimuli(): void {
    this.chase = null;
    this.look = null;
    this.lure = null;
    this.lureQueued = false;
    this.inv = null;
    this.search = null;
    this.noiseQueue = [];
  }

  private endScripted(): void {
    const s = this.scripted;
    if (!s) return;
    this.scripted = null;
    if (s.mode === 'hide_demo') this.hides.spendFirstHide();
    this.nav.goalKey = '';
    this.events.push({ type: 'scripted_done', mode: s.mode });
    if (s.mode === 'dress') {
      // never downgrade the nonstop-bell ground routine (the can may have been taken meanwhile)
      if (this.routine.kind === 'upper') this.routine = this.newRoutine('upper_dress', 'patrol');
      this.escalation = Math.max(this.escalation, 2);
    }
    if (s.mode === 'hide_demo') this.routine = this.newRoutine(this.routine.kind, 'vigil');
  }

  private voice(trigger: string): void {
    this.events.push({ type: 'voice', trigger });
  }

  private setDisplay(s: AdaState): void {
    if (s === this.display) return;
    this.events.push({ type: 'state', from: this.display, to: s });
    this.display = s;
  }

  // =================================================================== layers

  private startLook(reason: LookReason, yaw: number, fast: boolean, hideId: string | null, owner: number): void {
    // a slat look at a hide keeps the short wind-up: windup + sight must stay inside a calm 4.5 s breath hold
    const windup = reason === 'hide' ? Math.min(this.windup(fast), TUNING.look.windupHide) : this.windup(fast);
    this.look = { phase: 'windup', t: 0, windup, yaw, reason, hideId, owner, seen: false };
    this.tells.crack = true;
    this.nav.stop();
  }

  private tickLook(dt: number): [AdaAnim, string] {
    const L = this.look!;
    L.t += dt;
    this.nav.speed = 0;
    this.nav.vel = [0, 0, 0];
    this.nav.facing = L.yaw;
    this.lookYawNow = L.yaw;
    this.tells.lookWindup = L.windup;
    if (L.phase === 'windup') {
      this.head = 'lifting';
      if (L.t >= L.windup) {
        L.phase = 'sight';
        L.t = 0;
        this.head = 'lifted';
        this.voice(L.reason === 'hide' ? 'ai:hide_check_look' : 'ai:look_lift');
      }
      return ['look_windup', 'windup'];
    }
    if (L.phase === 'sight') {
      this.head = 'lifted';
      if (L.t >= TUNING.look.sight) {
        L.phase = 'lower';
        L.t = 0;
        this.head = 'lowering';
        this.voice('ai:look_not_him');
      }
      return ['look_hold', 'sight'];
    }
    this.head = 'lowering';
    if (L.t >= TUNING.look.lower) {
      this.look = null;
      this.head = 'hanging';
      this.lookDone(L);
    }
    return ['look_lower', 'lower'];
  }

  private lookDone(L: LookLayer): void {
    // a beam look that ran its course saw nothing (seeing the holder starts a chase and drops the look)
    if (L.reason === 'beam') this.beamMissT = this.t;
    if (L.reason === 'investigate' && this.inv && this.inv.id === L.owner) this.inv = null;
    if (L.reason === 'hide') {
      if (this.inv && this.inv.id === L.owner) this.inv = null;
      if (this.search && this.search.id === L.owner) this.search = null;
    }
    if (L.reason === 'search' && this.search && this.search.id === L.owner) {
      this.search.looks++;
      this.search.phase = this.search.looks >= TUNING.search.looks ? 'to_hide' : 'plaster';
      this.search.t = 0;
      this.nav.goalKey = '';
    }
  }

  private tickChase(dt: number, p: PlayerView): [number, AdaAnim, string] {
    const C = this.chase!;
    this.head = 'lifted';
    // lost for lostS, or (difficulty 2026-10-08) she abandons any open chase after giveUpS
    if (!C.hideId && (this.t - C.lastSenseT > TUNING.chase.lostS || C.burstT > TUNING.chase.giveUpS)) {
      this.chase = null;
      this.head = 'hanging';
      if (this.lureQueued) {
        // a bell pulled during the chase: now she answers it
        this.startLure();
        return [0, 'idle', 'lost_lured'];
      }
      // lost: SEARCH where she last sensed you
      this.search = { id: this.nextId++, phase: 'go', t: 0, dur: 0, looks: 0, target: C.target, room: C.targetRoom, hideNode: null, hideId: null };
      this.head = 'hanging';
      this.nav.goalKey = '';
      this.voice('ai:search');
      return [0, 'idle', 'lost'];
    }
    C.burstT += dt;
    const cycle = TUNING.speed.chaseBurstS + TUNING.speed.chaseLullS;
    const inBurst = C.burstT % cycle < TUNING.speed.chaseBurstS;
    let speed = (inBurst ? TUNING.speed.chase : TUNING.speed.chaseLull) * this.speedMul();
    const target = C.target;
    const dz = Math.abs(target[2] - this.nav.pos[2]);
    const sameRoom = C.targetRoom === this.nav.room && dz < 0.5;
    if (this.assist.finaleWait && !C.hideId && dist2(this.nav.pos, p.pos) <= TUNING.finale.waitDist && this.t - this.lastSeenT < 0.2) {
      // assist after two finale deaths: she waits at ~4 m, head up, so the locket can be shown
      speed = 0;
      this.nav.stop();
    } else if (sameRoom && !C.hideId && this.world.lineOfSight(this.eye(), [target[0], target[1], target[2] + 1.2])) {
      this.nav.direct(`chase-direct`, target);
    } else {
      C.replanT -= dt;
      const key = `chase:${Math.round(target[0] * 2)}:${Math.round(target[1] * 2)}:${Math.round(target[2])}`;
      if (C.replanT <= 0 || this.nav.idle) {
        C.replanT = 0.3;
        if (C.hideId) this.nav.toNode(`chase-hide:${C.hideId}`, this.g.hideCheckNode(this.hides.hide(C.hideId)!).id, this.doors);
        else this.nav.toPoint(key, target, C.targetRoom, this.doors);
      }
    }
    const arrived = speed > 0 ? this.nav.follow(dt, speed, this.doors, this.t, this.events, true) : true;
    this.noteDoorEvents();
    this.lookYawNow = this.chase && !this.chase.hideId && this.t - this.lastSeenT < 0.3 ? this.yawTo(p.eye) : this.nav.facing;
    if (C.hideId && arrived && this.nav.blocked) {
      // the hide is out of her reach: search there instead
      const hide = this.hides.hide(C.hideId)!;
      this.chase = null;
      if (this.lureQueued) {
        this.startLure();
        return [0, 'idle', 'hide_unreachable_lured'];
      }
      this.search = { id: this.nextId++, phase: 'go', t: 0, dur: 0, looks: 0, target: [...hide.entry] as P3, room: hide.room, hideNode: null, hideId: null };
      this.nav.goalKey = '';
      return [0, 'idle', 'hide_unreachable'];
    }
    if (C.hideId && arrived) {
      // tear the found hide open
      this.chase = null;
      this.doCatch('hide');
      return [0, 'hide_tear_open', 'tear_open'];
    }
    return [speed, 'chase_run', inBurst ? 'burst' : 'lull'];
  }

  private tickLure(dt: number): [number, AdaAnim, string] {
    const L = this.lure!;
    if (L.phase === 'travel') {
      this.nav.toNode('lure', LURE_NODE, this.doors);
      const arrived = this.nav.follow(dt, TUNING.speed.lureTravel * this.speedMul(), this.doors, this.t, this.events);
      this.noteDoorEvents();
      if (arrived || this.nav.blocked) {
        L.phase = 'scrape';
        L.t = 0;
        this.events.push({ type: 'lured', phase: 'arrive' });
        this.voice('ai:lured_arrive');
      }
      return [TUNING.speed.lureTravel, 'walk', 'travel'];
    }
    L.t += dt;
    this.nav.speed = 0;
    this.nav.vel = [0, 0, 0];
    this.nav.facing = this.g.node(LURE_NODE).lookYaw ?? 0;
    if (L.t >= L.dur) {
      this.lure = null;
      this.events.push({ type: 'lured', phase: 'end' });
      // climb back up (audibly): resume the routine from its first waypoint (the stair top upstairs)
      this.routine = this.newRoutine(this.routine.kind, 'patrol');
      this.nav.goalKey = '';
    }
    return [0, 'lured_scrape', 'scrape'];
  }

  private tickInvestigate(dt: number): [number, AdaAnim, string, AdaState] {
    const I = this.inv!;
    I.t += dt;
    if (I.phase === 'listen') {
      this.nav.speed = 0;
      this.nav.vel = [0, 0, 0];
      this.nav.facing = this.yawTo(I.pos);
      if (I.t >= I.dur) {
        I.phase = 'go';
        I.t = 0;
        I.planPos = [...I.pos] as P3;
        this.nav.goalKey = '';
        this.voice('ai:listen_end');
      }
      return [0, 'listen', 'listen', 'LISTEN'];
    }
    if (I.phase === 'go') {
      this.nav.toPoint(`inv:${I.id}:${I.plan ?? 0}`, I.pos, I.room, this.doors);
      const arrived = this.nav.follow(dt, TUNING.speed.investigate * this.speedMul(), this.doors, this.t, this.events);
      this.noteDoorEvents();
      if (arrived || this.nav.blocked) {
        // arriving next to a hide → listen at it and look at the slats; otherwise LOOK toward the stimulus
        const hc = this.nearHideCheck(I.pos);
        if (hc) {
          I.phase = 'hide_listen';
          I.t = 0;
          I.dur = this.rng.range(TUNING.search.hideListen[0], TUNING.search.hideListen[1]);
          I.hideId = hc.hideId;
          this.nav.toNode(`inv-hc:${I.id}`, hc.node, this.doors);
        } else {
          I.phase = 'wait_look';
          this.startLook('investigate', I.lookAt ? this.yawTo(I.lookAt) : dist2(I.pos, this.nav.pos) > 0.3 ? this.yawTo(I.pos) : this.nav.facing, false, null, I.id);
        }
      }
      return [TUNING.speed.investigate, 'walk', 'go', 'INVESTIGATE'];
    }
    if (I.phase === 'hide_listen') {
      const arrived = this.nav.follow(dt, TUNING.speed.investigate * this.speedMul(), this.doors, this.t, this.events);
      if (!arrived && !this.nav.blocked) {
        I.t = 0;
        return [TUNING.speed.investigate, 'walk', 'go', 'INVESTIGATE'];
      }
      const node = this.nav.atNode ? this.g.node(this.nav.atNode) : null;
      if (node?.lookYaw !== undefined) this.nav.facing = node.lookYaw;
      if (I.t >= I.dur) {
        I.phase = 'wait_look';
        this.startLook('hide', this.nav.facing, false, I.hideId, I.id);
      }
      return [0, 'hide_check', 'hide_listen', 'LISTEN'];
    }
    // wait_look: the LOOK layer finished without clearing us (a newer stimulus replaced the owner) → done
    this.inv = null;
    return [0, 'idle', 'done', 'INVESTIGATE'];
  }

  /** Nearest point of Harlan's bed footprint when she stands within reach of it in its room (else null). */
  private bedEdgeNear(p: P3, room: string | null): P3 | null {
    const b = this.bed;
    if (!b || room !== b.room || Math.abs(p[2] - b.z) > 1) return null;
    const q = bedNearest(b, p);
    return dist2(p, q) <= TUNING.search.bedReach ? q : null;
  }

  private nearHideCheck(p: P3): { node: string; hideId: string } | null {
    for (const h of this.layout.hides) {
      const n = this.g.hideCheckNode(h);
      if (dist3(p, h.entry) <= 1.6 || dist3(p, h.eye) <= 1.6) return { node: n.id, hideId: h.id };
    }
    return null;
  }

  private tickSearch(dt: number): [number, AdaAnim, string, AdaState] {
    const S = this.search!;
    S.t += dt;
    switch (S.phase) {
      case 'go': {
        this.nav.toPoint(`search:${S.id}`, S.target, S.room, this.doors);
        const arrived = this.nav.follow(dt, TUNING.speed.investigate * this.speedMul(), this.doors, this.t, this.events);
        this.noteDoorEvents();
        if (arrived || this.nav.blocked) {
          S.phase = 'look';
          this.startLook('search', this.nav.facing, false, null, S.id);
        }
        return [TUNING.speed.investigate, 'walk', 'go', 'SEARCH'];
      }
      case 'plaster': {
        this.nav.speed = 0;
        this.nav.vel = [0, 0, 0];
        // beside Harlan's bed she folds down and feels under it (a 4 s one-shot, played side-on to the bed edge)
        const edge = this.bedEdgeNear(this.nav.pos, this.nav.room);
        if (edge) this.nav.facing = this.yawTo(edge);
        if (S.t >= (edge ? TUNING.search.bedS : TUNING.search.betweenLooksS)) {
          S.phase = 'look';
          this.startLook('search', this.nav.facing + Math.PI * (this.rng.chance(0.5) ? 0.5 : -0.5), false, null, S.id);
        }
        return edge ? [0, 'search_bed', 'bed', 'SEARCH'] : [0, 'search_plaster', 'plaster', 'SEARCH'];
      }
      case 'to_hide': {
        if (!S.hideNode) {
          const pick = this.nearestHideCheck();
          if (!pick) {
            this.search = null;
            return [0, 'idle', 'done', 'SEARCH'];
          }
          S.hideNode = pick.node;
          S.hideId = pick.hideId;
        }
        this.nav.toNode(`search-hc:${S.id}`, S.hideNode, this.doors);
        const arrived = this.nav.follow(dt, TUNING.speed.investigate * this.speedMul(), this.doors, this.t, this.events);
        this.noteDoorEvents();
        if (arrived || this.nav.blocked) {
          S.phase = 'hide_listen';
          S.t = 0;
          S.dur = this.rng.range(TUNING.search.hideListen[0], TUNING.search.hideListen[1]);
        }
        return [TUNING.speed.investigate, 'walk', 'to_hide', 'SEARCH'];
      }
      case 'hide_listen': {
        this.nav.speed = 0;
        this.nav.vel = [0, 0, 0];
        const n = this.g.node(S.hideNode!);
        if (n.lookYaw !== undefined) this.nav.facing = n.lookYaw;
        if (S.t >= S.dur) {
          S.phase = 'wait_look';
          this.startLook('hide', this.nav.facing, false, S.hideId, S.id);
        }
        return [0, 'hide_check', 'hide_listen', 'SEARCH'];
      }
      default:
        this.search = null;
        return [0, 'idle', 'done', 'SEARCH'];
    }
  }

  /** Nearest reachable hide-check node (by graph cost). */
  private nearestHideCheck(): { node: string; hideId: string } | null {
    const from = this.nav.atNode ?? this.g.nearestNode(this.nav.pos)!.id;
    const d = this.g.distances(from, this.doors);
    let best: { node: string; hideId: string; c: number } | null = null;
    for (const h of this.layout.hides) {
      const n = this.g.hideCheckNode(h);
      const c = d.get(n.id);
      if (c === undefined) continue;
      if (!best || c < best.c) best = { node: n.id, hideId: h.id, c };
    }
    return best;
  }

  private tickFinale(dt: number, p: PlayerView): [number, AdaAnim, string] {
    const F = this.finale!;
    F.t += dt;
    const toPlayer = this.yawTo(p.eye);
    switch (F.phase) {
      case 'stop':
        this.head = 'lifted';
        this.lookYawNow = toPlayer;
        this.nav.facing = toPlayer;
        this.nav.speed = 0;
        if (F.t >= 1) {
          F.phase = 'approach';
          F.t = 0;
        }
        return [0, 'finale_approach', 'stop'];
      case 'approach': {
        this.head = 'lifted';
        this.lookYawNow = toPlayer;
        const d = dist2(this.nav.pos, p.pos);
        // she comes to arm's length; if you slip away (hide, break sight) the moment passes → SEARCH
        const inReach = !p.hiddenIn && (p.room === this.nav.room || this.world.lineOfSight(this.eye(), p.eye));
        if (inReach) {
          F.lostT = 0;
          F.lastPos = [...p.pos] as P3;
          F.lastRoom = p.room;
        } else F.lostT += dt;
        if (F.lostT > TUNING.finale.lostS || F.t > 25) {
          this.finale = null;
          this.events.push({ type: 'finale', phase: 'lost' });
          this.search = { id: this.nextId++, phase: 'go', t: 0, dur: 0, looks: 0, target: F.lastPos, room: F.lastRoom, hideNode: null, hideId: null };
          this.nav.goalKey = '';
          return [0, 'idle', 'lost'];
        }
        if (d <= TUNING.finale.armLength && Math.abs(p.pos[2] - this.nav.pos[2]) < 1.2) {
          F.phase = 'look';
          F.t = 0;
          this.nav.stop();
          return [0, 'finale_look', 'look'];
        }
        if (p.room === this.nav.room && Math.abs(p.pos[2] - this.nav.pos[2]) < 0.5) {
          const k = (d - TUNING.finale.armLength * 0.9) / d;
          this.nav.direct('finale', [this.nav.pos[0] + (p.pos[0] - this.nav.pos[0]) * k, this.nav.pos[1] + (p.pos[1] - this.nav.pos[1]) * k, p.pos[2]]);
        } else this.nav.toPoint(`finale:${Math.round(p.pos[0] * 2)}:${Math.round(p.pos[1] * 2)}`, p.pos, p.room, this.doors);
        this.nav.follow(dt, TUNING.speed.finale, this.doors, this.t, this.events);
        this.nav.facing = toPlayer;
        return [TUNING.speed.finale, 'finale_approach', 'approach'];
      }
      case 'look':
        this.head = 'lifted';
        this.lookYawNow = toPlayer;
        this.nav.facing = toPlayer;
        if (dist2(this.nav.pos, p.pos) > TUNING.finale.armLength + 1.2 || p.hiddenIn) {
          F.phase = 'approach';
          F.t = 0;
          return [0, 'finale_look', 'look'];
        }
        if (F.t >= TUNING.finale.lookS) {
          F.phase = 'take';
          F.t = 0;
          this.events.push({ type: 'finale', phase: 'take' });
        }
        return [0, 'finale_look', 'look'];
      case 'take':
        this.head = 'lifted';
        if (F.t >= 0.8) {
          F.phase = 'carry';
          F.t = 0;
          this.nav.goalKey = '';
        }
        return [0, 'finale_take', 'take'];
      case 'carry': {
        this.head = 'hanging';
        this.nav.toNode('finale-carry', LURE_NODE, this.doors);
        const arrived = this.nav.follow(dt, TUNING.speed.patrol, this.doors, this.t, this.events);
        if (arrived || this.nav.blocked) {
          F.phase = 'wait';
          F.t = 0;
          this.events.push({ type: 'finale', phase: 'at_door' });
        }
        return [TUNING.speed.patrol, 'finale_carry', 'carry'];
      }
      default:
        this.head = 'hanging';
        this.nav.speed = 0;
        this.nav.facing = this.g.node(LURE_NODE).lookYaw ?? 0;
        return [0, 'idle', 'wait'];
    }
  }

  // ------------------------------------------------------------------ scripted

  private tickScripted(dt: number, p: PlayerView): [number, AdaAnim, string, AdaState] {
    const S = this.scripted!;
    S.t += dt;
    switch (S.mode) {
      case 'hidden':
        this.nav.speed = 0;
        return [0, 'hidden', 'offstage', 'SCRIPTED'];
      case 'hold':
        this.nav.speed = 0;
        return [0, 'idle', 'hold', 'SCRIPTED'];
      case 'b05_return':
        return this.tickB05Return(dt, p);
      case 'hide_demo':
        return this.tickHideDemo(dt, p);
      default:
        return this.tickDress(dt, p);
    }
  }

  /**
   * B05 (C2-ESCAPE §4.5): her return after C2c. Offstage behind the locked parlor door until
   * max(10 s, min(the player hides, 15 s)); the key, the door, the hall boards (the carried head knocking on her thigh),
   * the rocker, then 16 risers at 1.4 risers/s with the head hanging at her hip (blind). A hidden player turns it into
   * the unfailable slat demo; a player still in the open when she reaches tread 10 finds her stopped there, blind and
   * listening, until 45 s; then she tops the stair and the normal rules start (the story grants grace). Never catches.
   */
  private tickB05Return(dt: number, p: PlayerView): [number, AdaAnim, string, AdaState] {
    const S = this.scripted!;
    const B = TUNING.b05;
    S.clock = (S.clock ?? 0) + dt;
    if (p.hiddenIn && S.hiddenAt == null) S.hiddenAt = S.clock;
    const go = (phase: string, ev?: 'key' | 'door' | 'hall' | 'rocker' | 'climb' | 'blind_wait' | 'top') => {
      S.phase = phase;
      S.t = 0;
      if (ev) this.events.push({ type: 'b05_return', phase: ev });
    };
    this.head = 'hanging';
    switch (S.phase) {
      case 'start':
      case 'wait': {
        S.phase = 'wait';
        this.nav.speed = 0;
        const startAt = Math.max(B.minStartS, Math.min(S.hiddenAt ?? Infinity, B.maxStartS));
        if (S.clock >= startAt) go('key', 'key');
        return [0, 'hidden', 'offstage', 'SCRIPTED'];
      }
      case 'key':
        this.nav.speed = 0;
        if (S.t >= B.keyS) {
          go('door', 'door');
          this.relocate(S.node ?? LURE_NODE, true);
          this.events.push({ type: 'door', doorId: 'D_PARLOR', fast: false });
        }
        return [0, 'hidden', 'offstage', 'SCRIPTED'];
      case 'door':
        this.nav.speed = 0;
        if (S.t >= B.doorS) go('hall', 'hall');
        return [0, 'idle', 'door', 'SCRIPTED'];
      default:
        break;
    }
    // the first hide (from the hall on): the slat demo at that hide — the same unfailable look as before C2-ESCAPE
    if (p.hiddenIn && S.phase !== 'top') {
      this.events.push({ type: 'scripted_done', mode: 'b05_return' });
      this.scripted = { mode: 'hide_demo', phase: 'approach', t: 0, node: null, hideId: p.hiddenIn, crumbs: [], crumbT: 0, stillT: 0, lookYaw: 0, lookT: 0 };
      this.nav.goalKey = '';
      return [0, 'walk', 'to_hide', 'SCRIPTED'];
    }
    const knock = () => {
      S.crumbT -= dt;
      if (this.nav.speed > 0.2 && S.crumbT <= 0) {
        S.crumbT = B.knockEveryS;
        this.tells.knock = true;
      }
    };
    switch (S.phase) {
      case 'hall': {
        if (S.t >= B.rockerAfterS && !S.rocker) {
          S.rocker = true;
          this.events.push({ type: 'b05_return', phase: 'rocker' });
        }
        this.nav.toNode('b05:foot', 'G_STAIRFOOT', this.doors);
        const arrived = this.nav.follow(dt, B.hallSpeed, this.doors, this.t, this.events);
        knock();
        if (arrived || this.nav.blocked) go('climb', 'climb');
        return [B.hallSpeed, 'walk', 'hall', 'SCRIPTED'];
      }
      case 'climb': {
        if (S.t >= B.rockerAfterS && !S.rocker) {
          S.rocker = true;
          this.events.push({ type: 'b05_return', phase: 'rocker' });
        }
        if (this.nav.pos[2] >= B.treadZ10 && S.clock < B.blindUntilS) {
          go('blind_wait', 'blind_wait');
          this.nav.stop();
          return [0, 'idle', 'listen', 'LISTEN'];
        }
        this.nav.toNode('b05:top', 'U_STAIRTOP', this.doors);
        const arrived = this.nav.follow(dt, B.climbSpeed, this.doors, this.t, this.events);
        knock();
        if (arrived || this.nav.blocked) {
          go('top', 'top');
          this.endScripted();
          // the normal rules from here, after the 6 s calm — in place, NO relocation: the player may be watching her
          // (grace()'s teleport is for respawns behind a black frame; QA c2c-handover idle saw it pop her away in view)
          this.calm();
          return [0, 'idle', 'top', 'PATROL'];
        }
        return [B.climbSpeed, 'walk', 'climb', 'SCRIPTED'];
      }
      case 'blind_wait':
        this.nav.speed = 0;
        if (S.clock >= B.blindUntilS) {
          S.phase = 'climb';
          S.t = 0;
          S.clock = Math.max(S.clock, B.blindUntilS); // never re-enter the wait
          S.waited = true;
        }
        return [0, 'idle', 'listen', 'LISTEN'];
      default:
        return [0, 'idle', 'top', 'SCRIPTED'];
    }
  }

  /** B05: to the slats, drip stops, crack, "…Harlan?", look 3 s (unfailable), lower, back to her vigil. */
  private tickHideDemo(dt: number, p: PlayerView): [number, AdaAnim, string, AdaState] {
    const S = this.scripted!;
    const hide = this.hides.hide(S.hideId!)!;
    const node = this.g.hideCheckNode(hide);
    if (!p.hiddenIn && S.phase !== 'leave') {
      // the player left the hide early: back to the rules (if her head is up she may see them)
      const wasLooking = S.phase === 'look_sight';
      this.endScripted();
      if (wasLooking) this.look = { phase: 'sight', t: S.lookT, windup: 0, yaw: S.lookYaw, reason: 'beam', hideId: null, owner: 0, seen: false };
      return [0, 'idle', 'released', 'PATROL'];
    }
    switch (S.phase) {
      case 'start':
      case 'approach': {
        S.phase = 'approach';
        this.nav.toNode(`demo:${node.id}`, node.id, this.doors);
        const arrived = this.nav.follow(dt, TUNING.speed.patrol, this.doors, this.t, this.events);
        if (arrived || this.nav.blocked) {
          S.phase = 'listen';
          S.t = 0;
        }
        return [TUNING.speed.patrol, 'walk', 'approach', 'SCRIPTED'];
      }
      case 'listen':
        this.nav.speed = 0;
        this.nav.facing = node.lookYaw ?? this.nav.facing;
        if (S.t >= TUNING.hideDemo.listenS) {
          S.phase = 'look_windup';
          S.t = 0;
          S.lookYaw = this.nav.facing;
          this.tells.crack = true;
          this.head = 'lifting';
        }
        return [0, 'hide_check', 'listen', 'LISTEN'];
      case 'look_windup':
        this.head = 'lifting';
        this.lookYawNow = S.lookYaw;
        if (S.t >= TUNING.look.windupHide) {
          S.phase = 'look_sight';
          S.t = 0;
          S.lookT = 0;
          this.head = 'lifted';
          this.voice('ai:hide_check_look');
        }
        return [0, 'look_windup', 'look_windup', 'LOOK'];
      case 'look_sight':
        this.head = 'lifted';
        this.lookYawNow = S.lookYaw;
        S.lookT += dt;
        if (S.t >= TUNING.look.sight) {
          S.phase = 'leave';
          S.t = 0;
          this.head = 'lowering';
          this.voice('ai:look_not_him');
          this.hides.spendFirstHide();
        }
        return [0, 'look_hold', 'look_sight', 'LOOK'];
      default: {
        const v = ROUTINES[this.routine.kind].vigil ?? 'U_VIGIL';
        this.nav.toNode('demo-leave', v, this.doors);
        const arrived = this.nav.follow(dt, TUNING.speed.patrol, this.doors, this.t, this.events);
        if (arrived || this.nav.blocked) {
          this.endScripted();
          this.routine = this.newRoutine(this.routine.kind, 'vigil');
          return [0, 'vigil_scrape', 'vigil', 'VIGIL'];
        }
        return [TUNING.speed.patrol, 'walk', 'leave', 'SCRIPTED'];
      }
    }
  }

  /** B09 / C4: the dress visit. Finale works here too (locket rule is checked in sense()). */
  private tickDress(dt: number, p: PlayerView): [number, AdaAnim, string, AdaState] {
    const S = this.scripted!;
    void p;
    const wardrobe = this.layout.hides.find((h) => h.room === 'U3') ?? this.layout.hides[0];
    const hc = this.g.hideCheckNode(wardrobe);
    S.hideId = wardrobe.id;
    switch (S.phase) {
      case 'start':
      case 'approach': {
        S.phase = 'approach';
        this.nav.toNode('dress', 'U3_DRESS', this.doors);
        const arrived = this.nav.follow(dt, TUNING.speed.patrol, this.doors, this.t, this.events);
        this.noteDoorEvents();
        if (arrived || this.nav.blocked) {
          S.phase = 'hem';
          S.t = 0;
          this.voice('c4:hand_on_hem');
        }
        return [TUNING.speed.patrol, 'walk', 'approach', 'SCRIPTED'];
      }
      case 'hem':
        this.nav.speed = 0;
        this.nav.facing = 0;
        if (S.t >= TUNING.dress.hemS) {
          S.phase = 'to_wardrobe';
          S.t = 0;
          this.nav.goalKey = '';
        }
        return [0, 'dress_hem', 'hem', 'SCRIPTED'];
      case 'to_wardrobe': {
        this.nav.toNode('dress-hc', hc.id, this.doors);
        const arrived = this.nav.follow(dt, TUNING.speed.patrol, this.doors, this.t, this.events);
        if (arrived || this.nav.blocked) {
          S.phase = 'look_windup';
          S.t = 0;
          S.lookYaw = hc.lookYaw ?? this.yawTo(wardrobe.eye);
          this.tells.crack = true;
          this.head = 'lifting';
        }
        return [TUNING.speed.patrol, 'walk', 'to_wardrobe', 'SCRIPTED'];
      }
      case 'look_windup':
        this.nav.speed = 0;
        this.nav.facing = S.lookYaw;
        this.head = 'lifting';
        this.lookYawNow = S.lookYaw;
        if (S.t >= Math.min(this.windup(false), TUNING.look.windupHide)) {
          S.phase = 'look_sight';
          S.t = 0;
          S.lookT = 0;
          this.head = 'lifted';
          this.voice('ai:hide_check_look');
        }
        return [0, 'look_windup', 'look_windup', 'LOOK'];
      case 'look_sight':
        this.head = 'lifted';
        this.lookYawNow = S.lookYaw;
        S.lookT += dt;
        if (S.t >= TUNING.look.sight) {
          S.phase = 'leave';
          S.t = 0;
          this.head = 'lowering';
          this.voice('ai:look_not_him');
          this.nav.goalKey = '';
        }
        return [0, 'look_hold', 'look_sight', 'LOOK'];
      default: {
        this.nav.toNode('dress-leave', 'U_STAIRTOP', this.doors);
        const arrived = this.nav.follow(dt, TUNING.speed.patrol, this.doors, this.t, this.events);
        this.noteDoorEvents();
        if (arrived || this.nav.blocked || S.t > 20) {
          this.endScripted();
          return [0, 'idle', 'done', 'PATROL'];
        }
        return [TUNING.speed.patrol, 'walk', 'leave', 'SCRIPTED'];
      }
    }
  }

  // ------------------------------------------------------------------ routine (PATROL / VIGIL)

  private newRoutine(kind: RoutineKind, mode: 'vigil' | 'patrol'): RoutineLayer {
    const R = ROUTINES[kind];
    const lap = R.laps.length > 1 && this.rng?.chance(TUNING.throughU2Chance[this.escalation ?? 0]) ? 1 : 0;
    return { kind, mode: R.vigil ? mode : 'patrol', lap, idx: 0, t: 0, dur: 0, vigilVoiced: false };
  }

  private atVigil(): boolean {
    const v = ROUTINES[this.routine.kind].vigil;
    return !!v && this.nav.atNode === v && this.nav.idle;
  }

  private tickRoutine(dt: number): [number, AdaAnim, string, AdaState] {
    const R = this.routine;
    const def = ROUTINES[R.kind];
    const speed = TUNING.speed.patrol * this.speedMul();
    // respawn fairness (round E ruling b): for grace.awayS after a death she only takes legs that keep grace.awayM
    // from the player; when none does she holds where she is (scraping if at her vigil) and re-plans every 1.5 s
    const away = this.awayActive;
    if (away && this.t < this.awayHoldT) return this.holdAway();
    if (R.mode === 'vigil' && def.vigil && !this.patrolOnly && away && this.nav.goalKey !== `vigil:${def.vigil}` && !this.atVigil() && !this.legClearOfPlayer(def.vigil))
      R.mode = 'patrol';
    if (R.mode === 'vigil' && def.vigil && !this.patrolOnly) {
      this.nav.toNode(`vigil:${def.vigil}`, def.vigil, this.doors);
      const arrived = this.nav.follow(dt, speed, this.doors, this.t, this.events);
      this.noteDoorEvents();
      if (this.nav.blocked) {
        R.mode = 'patrol';
        return [0, 'idle', 'blocked', 'PATROL'];
      }
      if (!arrived) return [speed, 'walk', 'to_vigil', 'PATROL'];
      if (R.dur === 0) {
        const [a, b] = TUNING.vigil[this.escalation];
        R.dur = this.rng.range(a, b);
        R.t = 0;
      }
      R.t += dt;
      this.nav.facing = this.g.node(def.vigil).lookYaw ?? this.nav.facing;
      if (!R.vigilVoiced && R.t >= TUNING.voice.vigilLongS) {
        R.vigilVoiced = true;
        this.voice('ai:vigil_long');
      }
      if (R.t >= R.dur) {
        const lap = def.laps.length > 1 && this.rng.chance(TUNING.throughU2Chance[this.escalation]) ? 1 : 0;
        this.routine = { kind: R.kind, mode: 'patrol', lap, idx: 0, t: 0, dur: 0, vigilVoiced: false };
      }
      return [0, 'vigil_scrape', 'vigil', 'VIGIL'];
    }
    // patrol lap
    const lap = def.laps[R.lap % def.laps.length];
    if (R.idx >= lap.length) {
      if (def.vigil && !this.patrolOnly) this.routine = { ...R, mode: 'vigil', idx: 0, t: 0, dur: 0 };
      else this.routine = { ...R, idx: 0, lap: (R.lap + 1) % def.laps.length };
      return [0, 'idle', 'lap_end', 'PATROL'];
    }
    const wp = lap[R.idx];
    const legKey = `patrol:${R.kind}:${R.lap}:${R.idx}`;
    if (away && this.nav.goalKey !== legKey && !this.legClearOfPlayer(wp)) {
      R.idx++;
      R.skipped = (R.skipped ?? 0) + 1;
      // a whole cycle of laps without a clear leg: hold
      const total = def.laps.reduce((n, l) => n + l.length, 0);
      if (R.skipped >= total) {
        R.skipped = 0;
        this.awayHoldT = this.t + 1.5;
        return this.holdAway();
      }
      return [0, 'idle', 'away_skip', 'PATROL'];
    }
    R.skipped = 0;
    const ok = this.nav.toNode(legKey, wp, this.doors);
    if (!ok) {
      R.idx++; // unreachable waypoint (locked door): skip it
      return [0, 'idle', 'skip', 'PATROL'];
    }
    const arrived = this.nav.follow(dt, speed, this.doors, this.t, this.events);
    this.noteDoorEvents();
    if (arrived) {
      R.idx++;
      const n = this.g.node(wp);
      const lookNode = n.tags.includes('look') && n.lookYaw !== undefined;
      if (lookNode && !this.patrolOnly && (ALWAYS_LOOK.has(wp) || this.rng.chance(TUNING.lookChance[this.escalation]))) {
        this.startLook('patrol', n.lookYaw!, false, null, 0);
      }
    }
    return [speed, 'walk', `to:${wp}`, 'PATROL'];
  }

  /** Held during the post-death away window: stand still; at her vigil node the scrape loop says she is still there. */
  private holdAway(): [number, AdaAnim, string, AdaState] {
    this.nav.stop();
    this.nav.goalKey = '';
    const v = ROUTINES[this.routine.kind].vigil;
    if (v && this.nav.atNode === v) {
      this.nav.facing = this.g.node(v).lookYaw ?? this.nav.facing;
      return [0, 'vigil_scrape', 'away_hold', 'VIGIL'];
    }
    return [0, 'idle', 'away_hold', 'PATROL'];
  }

  private noteDoorEvents(): void {
    for (const e of this.events)
      if (e.type === 'door') {
        this.lastDoorReqT = this.t;
        this.lastDoorReqPos = [...this.nav.pos] as P3;
      }
  }

  // =================================================================== persistence

  snapshot(): AdaSnapshot {
    const c = <T>(x: T): T => (x === null || x === undefined ? x : JSON.parse(JSON.stringify(x)));
    return {
      v: 1,
      t: this.t,
      rng: this.rng.state,
      pos: [...this.nav.pos] as P3,
      room: this.nav.room,
      facing: this.nav.facing,
      atNode: this.nav.atNode,
      scripted: c(this.scripted),
      finale: c(this.finale),
      caught: this.caught,
      chase: c(this.chase),
      look: c(this.look),
      lure: c(this.lure),
      lureQueued: this.lureQueued,
      inv: c(this.inv),
      search: c(this.search),
      routine: c(this.routine),
      lurePulls: this.lurePulls,
      escalation: this.escalation,
      assist: { ...this.assist },
      graceT: Number.isFinite(this.graceT) ? this.graceT : -1e9,
      calmUntil: Number.isFinite(this.calmUntil) ? this.calmUntil : -1e9,
      beamMissT: Number.isFinite(this.beamMissT) ? this.beamMissT : -1e9,
      seenAcc: this.seenAcc,
      thunder: c(this.thunder.windows),
      firstHideDone: this.hides.firstHideDone,
      lastSeenT: Number.isFinite(this.lastSeenT) ? this.lastSeenT : -1e9,
      pantUntil: Number.isFinite(this.pantUntil) ? this.pantUntil : -1e9,
      nextId: this.nextId,
      display: this.display,
      parked: this.parked,
      pendingRelocate: this.pendingRelocate,
    };
  }

  restore(s: AdaSnapshot): void {
    const c = <T>(x: T): T => (x === null || x === undefined ? x : JSON.parse(JSON.stringify(x)));
    this.t = s.t;
    this.rng.state = s.rng >>> 0;
    if (s.atNode && this.g.nodes.has(s.atNode) && dist3(this.g.node(s.atNode).pos, s.pos) < 0.05) this.nav.placeAt(s.atNode);
    else this.nav.placeFree(s.pos, s.room);
    this.nav.facing = s.facing;
    this.scripted = c(s.scripted);
    this.finale = c(s.finale);
    this.caught = s.caught;
    this.chase = c(s.chase);
    this.look = c(s.look);
    this.lure = c(s.lure);
    this.lureQueued = !!s.lureQueued;
    this.inv = c(s.inv);
    this.search = c(s.search);
    this.routine = c(s.routine);
    this.lurePulls = s.lurePulls;
    this.escalation = s.escalation;
    this.assist = { ...s.assist };
    this.graceT = s.graceT;
    this.calmUntil = s.calmUntil ?? -Infinity;
    this.beamMissT = s.beamMissT ?? -Infinity;
    this.seenAcc = s.seenAcc ?? 0;
    this.thunder.windows = c(s.thunder);
    this.hides.firstHideDone = s.firstHideDone;
    this.hides.exit();
    this.prevHidden = null;
    this.lastSeenT = s.lastSeenT;
    this.pantUntil = s.pantUntil;
    this.nextId = s.nextId;
    this.display = s.display;
    this.noiseQueue = [];
    this.parked = !!s.parked;
    this.pendingRelocate = s.pendingRelocate ?? null;
  }
}
