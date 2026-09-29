// Ada's locomotion on the authored graph: route planning (A* between the endpoints of the edge she is on and the
// endpoints of the target's nearest edge), constant-speed following, slow door pushes, and short free legs inside a
// room (to reach a point off the graph — never into hides, the parlor or the servants' stair). PURE.

import type { P3 } from '../shared/layout-types.ts';
import { AiGraph, dist3, lerp3, type GraphEdge } from './graph.ts';
import type { AiEvent, DoorStateFn } from './types.ts';
import { TUNING } from './tuning.ts';

export interface RouteStep {
  pos: P3;
  /** Node reached at the end of this step (null = a point on an edge or a free point). */
  node: string | null;
  /** Edge this step travels along (null = free leg). */
  via: GraphEdge | null;
}

/** Rooms she never enters on a free leg (hides are inside furniture; G2 is never free-roamed; U4/U4T: rule 4). */
const NO_FREE_LEG = new Set(['CLOSET', 'G2', 'U4', 'U4T', 'CAR']);

export class Nav {
  readonly g: AiGraph;
  pos: P3;
  room: string;
  facing = Math.PI / 2;
  atNode: string | null;
  onEdge: GraphEdge | null = null;
  route: RouteStep[] = [];
  goalKey = '';
  /** true when the last plan could not reach its goal (locked door…). */
  blocked = false;
  speed = 0;
  vel: P3 = [0, 0, 0];
  private doorWait = 0;
  private doorWaiting: string | null = null;
  private readonly doorOpenedAt = new Map<string, number>();
  private stepStarted = false;
  private segFromRoom: string;

  constructor(g: AiGraph, startNode: string) {
    this.g = g;
    const n = g.node(startNode);
    this.pos = [...n.pos] as P3;
    this.room = n.room;
    this.atNode = n.id;
    this.segFromRoom = n.room;
  }

  /** Teleport onto a node (relocation / grace / scripted placement). */
  placeAt(nodeId: string): void {
    const n = this.g.node(nodeId);
    this.pos = [...n.pos] as P3;
    this.room = n.room;
    this.atNode = n.id;
    this.onEdge = null;
    this.segFromRoom = n.room;
    this.stop();
  }

  /** Teleport to a free point (scripted: parked in the parlor, following the B04 trail). */
  placeFree(p: P3, room: string): void {
    this.pos = [...p] as P3;
    this.room = room;
    this.atNode = null;
    this.onEdge = null;
    this.segFromRoom = room;
    this.stop();
  }

  stop(): void {
    this.route = [];
    this.goalKey = '';
    this.blocked = false;
    this.doorWaiting = null;
    this.doorWait = 0;
    this.stepStarted = false;
    this.speed = 0;
    this.vel = [0, 0, 0];
  }

  get idle(): boolean {
    return this.route.length === 0;
  }

  get onStair(): boolean {
    return !!this.route.length && this.route[0].via?.kind === 'stair';
  }

  get waitingForDoor(): boolean {
    return this.doorWaiting !== null;
  }

  // ------------------------------------------------------------------ planning

  private starts(doors: DoorStateFn): { node: string; cost: number; prefix: RouteStep[] }[] {
    const g = this.g;
    if (this.atNode && !this.onEdge && dist3(this.pos, g.node(this.atNode).pos) < 0.05) return [{ node: this.atNode, cost: 0, prefix: [] }];
    const cur = this.route.length ? this.route[0].via : this.onEdge;
    if (cur) {
      const out: { node: string; cost: number; prefix: RouteStep[] }[] = [];
      for (const id of [cur.a, cur.b]) {
        if (cur.kind === 'door' && cur.doorId && doors(cur.doorId) === 'locked' && dist3(this.pos, g.node(id).pos) > 0.3) continue;
        out.push({ node: id, cost: dist3(this.pos, g.node(id).pos), prefix: [{ pos: g.node(id).pos, node: id, via: cur }] });
      }
      if (out.length) return out;
    }
    // free: re-enter the graph at the nearest edge point in this room
    const ep = g.nearestEdgePoint(this.pos, this.room, (e) => g.passable(e, doors));
    if (!ep) return [];
    const d0 = dist3(this.pos, ep.point);
    const entry: RouteStep = { pos: ep.point, node: null, via: null };
    return [ep.edge.a, ep.edge.b].map((id) => ({
      node: id,
      cost: d0 + dist3(ep.point, g.node(id).pos),
      prefix: [entry, { pos: g.node(id).pos, node: id, via: ep.edge }],
    }));
  }

  private stepsFor(nodes: string[]): RouteStep[] {
    const out: RouteStep[] = [];
    for (let i = 1; i < nodes.length; i++) out.push({ pos: this.g.node(nodes[i]).pos, node: nodes[i], via: this.g.edgeBetween(nodes[i - 1], nodes[i]) });
    return out;
  }

  /** Plan to a node. Returns false when unreachable (route cleared, blocked = true). */
  toNode(key: string, nodeId: string, doors: DoorStateFn): boolean {
    if (key === this.goalKey && (this.route.length || this.atNode === nodeId)) return !this.blocked;
    this.goalKey = key;
    if (this.atNode === nodeId && !this.onEdge && dist3(this.pos, this.g.node(nodeId).pos) < 0.05) {
      this.route = [];
      this.blocked = false;
      return true;
    }
    let best: { cost: number; steps: RouteStep[] } | null = null;
    for (const s of this.starts(doors)) {
      const p = this.g.path(s.node, nodeId, doors);
      if (!p) continue;
      const cost = s.cost + p.cost;
      if (!best || cost < best.cost) best = { cost, steps: [...s.prefix, ...this.stepsFor(p.nodes)] };
    }
    return this.commit(best?.steps ?? null);
  }

  /** Plan to a free point in `room` (graph approach + a free leg when allowed). */
  toPoint(key: string, p: P3, room: string | null, doors: DoorStateFn): boolean {
    if (key === this.goalKey && this.route.length) return !this.blocked;
    this.goalKey = key;
    const g = this.g;
    const et = g.nearestEdgePoint(p, room, (e) => g.passable(e, doors));
    if (!et) return this.commit(null);
    const freeOk = room !== null && !NO_FREE_LEG.has(room) && Math.abs(p[2] - et.point[2]) < 0.5 && dist3(p, et.point) > 0.05 && g.roomOnEdge(et.edge, et.s) === room;
    const tail: RouteStep[] = [{ pos: et.point, node: null, via: et.edge }];
    if (freeOk) tail.push({ pos: [...p] as P3, node: null, via: null });
    // same edge (or at one of its endpoints): go straight along it
    const cur = this.route.length ? this.route[0].via : this.onEdge;
    if (cur === et.edge || (this.atNode && !this.onEdge && (et.edge.a === this.atNode || et.edge.b === this.atNode))) return this.commit(tail);
    let best: { cost: number; steps: RouteStep[] } | null = null;
    for (const s of this.starts(doors))
      for (const end of [et.edge.a, et.edge.b]) {
        const path = g.path(s.node, end, doors);
        if (!path) continue;
        const cost = s.cost + path.cost + dist3(g.node(end).pos, et.point);
        if (!best || cost < best.cost) best = { cost, steps: [...s.prefix, ...this.stepsFor(path.nodes), ...tail] };
      }
    return this.commit(best?.steps ?? null);
  }

  private commit(steps: RouteStep[] | null): boolean {
    this.stepStarted = false;
    this.doorWaiting = null;
    this.doorWait = 0;
    if (!steps) {
      this.route = [];
      this.blocked = true;
      return false;
    }
    // drop zero-length leading steps
    while (steps.length && dist3(steps[0].pos, this.pos) < 1e-4 && steps.length > 1) {
      this.arrive(steps.shift()!);
    }
    this.route = steps;
    this.blocked = false;
    return true;
  }

  /** Straight at a free point in the same room (chase lunge, finale approach). Keeps the goal key. */
  direct(key: string, p: P3): void {
    this.goalKey = key;
    this.route = [{ pos: [...p] as P3, node: null, via: null }];
    this.blocked = false;
    this.stepStarted = false;
  }

  // ------------------------------------------------------------------ following

  private arrive(s: RouteStep): void {
    this.pos = [...s.pos] as P3;
    if (s.node) {
      this.atNode = s.node;
      this.onEdge = null;
      this.room = this.g.node(s.node).room;
      this.segFromRoom = this.room;
    } else {
      this.atNode = null;
      this.onEdge = s.via;
      if (!s.via) this.room = this.g.roomAt(this.pos) ?? this.room;
    }
  }

  /**
   * Advance along the route at `speed`. Door edges: a closed (unlocked) door is pushed open first (one `door`
   * event, then a wait of openS). Returns true when the route is finished (arrived).
   */
  follow(dt: number, speed: number, doors: DoorStateFn, now: number, events: AiEvent[], fastDoors = false): boolean {
    const start: P3 = [...this.pos] as P3;
    let budget = speed * dt;
    while (this.route.length && budget > 1e-9) {
      const s = this.route[0];
      if (!this.stepStarted) {
        this.stepStarted = true;
        if (s.via) this.onEdge = s.via;
        this.segFromRoom = this.room;
        const d = s.via?.kind === 'door' ? s.via.doorId : undefined;
        if (d && doors(d) === 'closed' && now - (this.doorOpenedAt.get(d) ?? -1e9) > 6) {
          this.doorWaiting = d;
          this.doorWait = fastDoors ? TUNING.door.openChaseS : TUNING.door.openS;
          this.doorOpenedAt.set(d, now);
          events.push({ type: 'door', doorId: d, fast: fastDoors });
        }
      }
      if (this.doorWaiting) {
        this.doorWait -= dt;
        if (this.doorWait > 0 && doors(this.doorWaiting) !== 'open') {
          budget = 0;
          break;
        }
        this.doorWaiting = null;
      }
      const d = dist3(this.pos, s.pos);
      if (d <= budget) {
        budget -= d;
        this.route.shift();
        this.stepStarted = false;
        this.arrive(s);
      } else {
        const dir: P3 = [(s.pos[0] - this.pos[0]) / d, (s.pos[1] - this.pos[1]) / d, (s.pos[2] - this.pos[2]) / d];
        this.pos = [this.pos[0] + dir[0] * budget, this.pos[1] + dir[1] * budget, this.pos[2] + dir[2] * budget];
        budget = 0;
        // room while moving: an edge takes the nearer endpoint's room; free legs look it up
        if (s.via) {
          const a = this.g.node(s.via.a).pos;
          const b = this.g.node(s.via.b).pos;
          const ab = dist3(a, b) || 1;
          const sParam = Math.min(1, dist3(a, this.pos) / ab);
          this.room = this.g.roomOnEdge(s.via, sParam);
        } else this.room = this.g.roomAt(this.pos) ?? this.room;
      }
    }
    const moved: P3 = [this.pos[0] - start[0], this.pos[1] - start[1], this.pos[2] - start[2]];
    const m = Math.hypot(moved[0], moved[1]);
    this.vel = dt > 0 ? [moved[0] / dt, moved[1] / dt, moved[2] / dt] : [0, 0, 0];
    this.speed = dt > 0 ? Math.hypot(moved[0], moved[1], moved[2]) / dt : 0;
    if (m > 1e-4) this.facing = Math.atan2(moved[1], moved[0]);
    return this.route.length === 0;
  }

  /** Point along the current route `ahead` metres ahead (for the characters lane's look-ahead / tests). */
  lookAhead(ahead: number): P3 {
    let p = this.pos;
    let left = ahead;
    for (const s of this.route) {
      const d = dist3(p, s.pos);
      if (d >= left) return lerp3(p, s.pos, left / (d || 1));
      left -= d;
      p = s.pos;
    }
    return p;
  }
}
