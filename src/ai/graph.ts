// Ada's authored node graph (layout.aiNodes / aiEdges) — no navmesh (DESIGN, "AI engineering").
//
//  - A* over edges, honouring door states: 'locked' (bolted / boarded / key-locked) is impassable, 'closed' costs a
//    slow push (she opens ordinary doors, slowly and audibly). Stair edges are traversed like walks (a little dearer).
//    The servants' stair and the parlor have no nodes: she never uses them (rule 4).
//  - Room lookup for plan points (floor by feet height, smallest containing interior rect wins).
//  - Nearest point on the graph for arbitrary targets (noises, the player's last known position).
//  - Named loops (edge `loops` tags) and hide ↔ hide-check node pairing.

import type { AiEdge, AiNode, FloorId, HideDef, LevelLayout, P3, Rect, RoomDef } from '../shared/layout-types.ts';
import type { DoorStateFn } from './types.ts';

export interface GraphEdge extends AiEdge {
  index: number;
  len: number;
}

export interface EdgePoint {
  edge: GraphEdge;
  /** Parameter along a → b (0..1). */
  s: number;
  point: P3;
  dist: number;
}

export interface GraphPath {
  nodes: string[];
  cost: number;
}

const DOOR_CLOSED_COST = 1.5;
const STAIR_COST_MUL = 1.3;

export const dist3 = (a: P3, b: P3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const dist2 = (a: P3, b: P3): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp3 = (a: P3, b: P3, s: number): P3 => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
const inRect = (r: Rect, x: number, y: number): boolean => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
const area = (r: Rect): number => (r[2] - r[0]) * (r[3] - r[1]);

export class AiGraph {
  readonly layout: LevelLayout;
  readonly nodes = new Map<string, AiNode>();
  readonly edges: GraphEdge[] = [];
  readonly adj = new Map<string, GraphEdge[]>();
  private readonly rooms: Map<string, RoomDef>;
  private readonly interiors: RoomDef[];
  private readonly outside: RoomDef[];
  private readonly elevation: Map<FloorId, number>;
  private readonly upperZ: number;

  constructor(layout: LevelLayout) {
    this.layout = layout;
    for (const n of layout.aiNodes) {
      this.nodes.set(n.id, n);
      this.adj.set(n.id, []);
    }
    layout.aiEdges.forEach((e, index) => {
      const a = this.nodes.get(e.a);
      const b = this.nodes.get(e.b);
      if (!a || !b) throw new Error(`aiEdge ${e.a}–${e.b}: unknown node`);
      const ge: GraphEdge = { ...e, index, len: dist3(a.pos, b.pos) };
      this.edges.push(ge);
      this.adj.get(e.a)!.push(ge);
      this.adj.get(e.b)!.push(ge);
    });
    this.rooms = new Map(layout.rooms.map((r) => [r.id, r]));
    this.interiors = layout.rooms.filter((r) => r.kind === 'interior').sort((a, b) => area(a.rect) - area(b.rect));
    this.outside = layout.rooms.filter((r) => r.kind !== 'interior').sort((a, b) => area(a.rect) - area(b.rect));
    this.elevation = new Map(layout.floors.map((f) => [f.id, f.elevation]));
    this.upperZ = this.elevation.get('upper') ?? 4.1;
  }

  node(id: string): AiNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`unknown ai node ${id}`);
    return n;
  }

  other(e: GraphEdge, id: string): string {
    return e.a === id ? e.b : e.a;
  }

  /** Edge between two nodes (either direction), if any. */
  edgeBetween(a: string, b: string): GraphEdge | null {
    for (const e of this.adj.get(a) ?? []) if (this.other(e, a) === b) return e;
    return null;
  }

  passable(e: GraphEdge, doors: DoorStateFn): boolean {
    return !(e.kind === 'door' && e.doorId && doors(e.doorId) === 'locked');
  }

  edgeCost(e: GraphEdge, doors: DoorStateFn): number {
    let c = e.len * (e.kind === 'stair' ? STAIR_COST_MUL : 1);
    if (e.kind === 'door' && e.doorId && doors(e.doorId) === 'closed') c += DOOR_CLOSED_COST;
    return c;
  }

  /** A* between nodes; null when unreachable (a locked door in the way). */
  path(from: string, to: string, doors: DoorStateFn): GraphPath | null {
    if (!this.nodes.has(from) || !this.nodes.has(to)) return null;
    if (from === to) return { nodes: [from], cost: 0 };
    const goal = this.node(to).pos;
    const g = new Map<string, number>([[from, 0]]);
    const f = new Map<string, number>([[from, dist3(this.node(from).pos, goal)]]);
    const prev = new Map<string, string>();
    const open = new Set<string>([from]);
    const closed = new Set<string>();
    while (open.size) {
      let u = '';
      let best = Infinity;
      for (const k of open) {
        const v = f.get(k)!;
        if (v < best || (v === best && k < u)) {
          best = v;
          u = k;
        }
      }
      if (u === to) {
        const nodes = [to];
        while (nodes[0] !== from) nodes.unshift(prev.get(nodes[0])!);
        return { nodes, cost: g.get(to)! };
      }
      open.delete(u);
      closed.add(u);
      for (const e of this.adj.get(u)!) {
        if (!this.passable(e, doors)) continue;
        const v = this.other(e, u);
        if (closed.has(v)) continue;
        const ng = g.get(u)! + this.edgeCost(e, doors);
        if (ng < (g.get(v) ?? Infinity) - 1e-9) {
          g.set(v, ng);
          f.set(v, ng + dist3(this.node(v).pos, goal));
          prev.set(v, u);
          open.add(v);
        }
      }
    }
    return null;
  }

  /** Dijkstra costs from a node to every reachable node. */
  distances(from: string, doors: DoorStateFn): Map<string, number> {
    const d = new Map<string, number>([[from, 0]]);
    const done = new Set<string>();
    for (;;) {
      let u: string | null = null;
      let best = Infinity;
      for (const [k, v] of d) if (!done.has(k) && v < best) { best = v; u = k; }
      if (u === null) break;
      done.add(u);
      for (const e of this.adj.get(u)!) {
        if (!this.passable(e, doors)) continue;
        const v = this.other(e, u);
        const nd = best + this.edgeCost(e, doors);
        if (nd < (d.get(v) ?? Infinity)) d.set(v, nd);
      }
    }
    return d;
  }

  // ------------------------------------------------------------------ rooms

  floorOfRoom(room: string): FloorId | null {
    return this.rooms.get(room)?.floor ?? null;
  }

  elevationOfRoom(room: string): number {
    const r = this.rooms.get(room);
    return r ? (this.elevation.get(r.floor) ?? 0) : 0;
  }

  /** Room containing a PLAN point at feet height z (null = in a wall / doorway / nowhere). */
  roomAt(p: P3): string | null {
    const [x, y, z] = p;
    const fl: FloorId = z >= this.upperZ - 0.6 ? 'upper' : 'ground';
    let anyFloor: RoomDef | null = null;
    for (const r of this.interiors) {
      if (!inRect(r.rect, x, y)) continue;
      if (r.floor === fl) return r.id;
      const e = this.elevation.get(r.floor) ?? 0;
      if (!anyFloor && z >= e - 0.8 && z <= e + r.ceiling) anyFloor = r;
    }
    if (anyFloor) return anyFloor.id;
    if (z > 0.3) return null;
    for (const r of this.outside) if (inRect(r.rect, x, y)) return r.id;
    return null;
  }

  /** The room of a position on an edge: the room of the nearer endpoint (stable across a stair). */
  roomOnEdge(e: GraphEdge, s: number): string {
    return (s < 0.5 ? this.node(e.a) : this.node(e.b)).room;
  }

  // ------------------------------------------------------------------ nearest

  /**
   * Nearest point on the graph to `p`. Candidate edges: those touching `room` (if given and any exist), else those
   * whose endpoints lie within 1.6 m of p's height (same floor band).
   */
  nearestEdgePoint(p: P3, room: string | null, filter?: (e: GraphEdge) => boolean): EdgePoint | null {
    let cands = this.edges.filter((e) => (!filter || filter(e)) && room !== null && (this.node(e.a).room === room || this.node(e.b).room === room));
    if (!cands.length)
      cands = this.edges.filter((e) => (!filter || filter(e)) && (Math.abs(this.node(e.a).pos[2] - p[2]) < 1.6 || Math.abs(this.node(e.b).pos[2] - p[2]) < 1.6));
    if (!cands.length) cands = this.edges.filter((e) => !filter || filter(e));
    let best: EdgePoint | null = null;
    for (const e of cands) {
      const a = this.node(e.a).pos;
      const b = this.node(e.b).pos;
      const ab: P3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
      let s = l2 > 0 ? ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2 : 0;
      s = Math.max(0, Math.min(1, s));
      const q = lerp3(a, b, s);
      const d = dist3(p, q);
      if (!best || d < best.dist - 1e-9) best = { edge: e, s, point: q, dist: d };
    }
    return best;
  }

  nearestNode(p: P3, filter?: (n: AiNode) => boolean): AiNode | null {
    let best: AiNode | null = null;
    let bd = Infinity;
    for (const n of this.nodes.values()) {
      if (filter && !filter(n)) continue;
      const d = dist3(p, n.pos);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ tags, loops, hides

  tagged(tag: AiNode['tags'][number]): AiNode[] {
    return [...this.nodes.values()].filter((n) => n.tags.includes(tag));
  }

  loopEdges(name: string): GraphEdge[] {
    return this.edges.filter((e) => e.loops.includes(name));
  }

  loopNodes(name: string): string[] {
    const s = new Set<string>();
    for (const e of this.loopEdges(name)) {
      s.add(e.a);
      s.add(e.b);
    }
    return [...s];
  }

  /** Is every node of the loop reachable from every other using only the loop's edges? */
  loopConnected(name: string): boolean {
    const nodes = this.loopNodes(name);
    if (!nodes.length) return false;
    const es = this.loopEdges(name);
    const seen = new Set([nodes[0]]);
    const stack = [nodes[0]];
    while (stack.length) {
      const u = stack.pop()!;
      for (const e of es) {
        const v = e.a === u ? e.b : e.b === u ? e.a : null;
        if (v && !seen.has(v)) {
          seen.add(v);
          stack.push(v);
        }
      }
    }
    return seen.size === nodes.length;
  }

  /** Does the loop contain a cycle that uses edge `edgeIndex`? (e.g. Harlan's two-door loop). */
  cycleThrough(name: string, edgeIndex: number): boolean {
    const es = this.loopEdges(name);
    const e = es.find((x) => x.index === edgeIndex);
    if (!e) return false;
    // remove e; if a and b are still connected within the loop, e lies on a cycle
    const rest = es.filter((x) => x.index !== edgeIndex);
    const seen = new Set([e.a]);
    const stack = [e.a];
    while (stack.length) {
      const u = stack.pop()!;
      for (const x of rest) {
        const v = x.a === u ? x.b : x.b === u ? x.a : null;
        if (v && !seen.has(v)) {
          seen.add(v);
          stack.push(v);
        }
      }
    }
    return seen.has(e.b);
  }

  /** The hide-check node that serves a hide (nearest hide_check node to its entry). */
  hideCheckNode(hide: HideDef): AiNode {
    return this.nearestNode(hide.entry, (n) => n.tags.includes('hide_check'))!;
  }

  hideForCheckNode(nodeId: string): HideDef | null {
    for (const h of this.layout.hides) if (this.hideCheckNode(h).id === nodeId) return h;
    return null;
  }
}
