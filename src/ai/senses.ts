// Ada's senses as pure functions (DESIGN "Senses" + "Rules"). No raycasts in here: occlusion comes from the room
// graph (hearing) or from the caller's lineOfSight predicate (light / sight).
//
// SOUND  effective radius = source radius × best room-graph attenuation (closed door ×0.5, floor ×0.4, open
//        stairwell ×1, grate 0.75, walls 0.35 — numbers from layout.roomLinks, the same graph audio occlusion uses)
//        × hearing multipliers (grace −30 %, assist −20 %). Heard when her distance to the source ≤ that radius.
//        Thunder rolls mask every non-script sound (rule 8).
// LIGHT  beam touching her body → fast LOOK toward it; beam landing within 6 m → INVESTIGATE; the player is lit
//        when the flashlight is on or within 1.5 m of a fixed flame. Lightning is never an input (never counts).
// SIGHT  only while her head is lifted (LOOK / CHASE): 60° cone, 14 m lit / 5 m dark / 2 m dark + crouched.
//        Hidden players are never seen. The open, lit locket within 4 m in the cone outranks the face (FINALE).

import type { LevelLayout, LightDef, RoomLink, StairDef } from '../shared/layout-types.ts';
import type { AdaState, BeamView, DoorStateFn, NoiseInput, P3, PlayerView } from './types.ts';
import { TUNING } from './tuning.ts';

// ------------------------------------------------------------------ hearing

export interface HearingPath {
  attenuation: number;
  rooms: string[];
}

function linkAtt(l: RoomLink, doors: DoorStateFn): number {
  if (l.via === 'door' && l.doorId && doors(l.doorId) === 'open') return l.openAttenuation ?? 1;
  return l.attenuation;
}

/** Max-product attenuation between two rooms over layout.roomLinks (Dijkstra on −log). 0 = no path. */
export function hearingPath(links: readonly RoomLink[], from: string, to: string, doors: DoorStateFn, skipStairwells = false): HearingPath {
  if (from === to) return { attenuation: 1, rooms: [from] };
  const adj = new Map<string, { to: string; w: number }[]>();
  for (const l of links) {
    if (skipStairwells && l.via === 'stairwell') continue;
    const a = linkAtt(l, doors);
    if (a <= 0) continue;
    const w = -Math.log(Math.min(1, a));
    (adj.get(l.a) ?? adj.set(l.a, []).get(l.a)!).push({ to: l.b, w });
    (adj.get(l.b) ?? adj.set(l.b, []).get(l.b)!).push({ to: l.a, w });
  }
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  for (;;) {
    let u: string | null = null;
    let best = Infinity;
    for (const [k, d] of dist) if (!done.has(k) && d < best) { best = d; u = k; }
    if (u === null || u === to) break;
    done.add(u);
    for (const e of adj.get(u) ?? []) {
      const nd = best + e.w;
      if (nd < (dist.get(e.to) ?? Infinity) - 1e-12) {
        dist.set(e.to, nd);
        prev.set(e.to, u);
      }
    }
  }
  const d = dist.get(to);
  if (d === undefined) return { attenuation: 0, rooms: [] };
  const rooms = [to];
  while (rooms[0] !== from) rooms.unshift(prev.get(rooms[0])!);
  return { attenuation: Math.exp(-d), rooms };
}

export function dist3(a: P3, b: P3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Mid-flight point of the stair joining two rooms (sound crossing a stairwell travels through it). */
export function stairPortals(stairs: readonly StairDef[], floorZ: (id: StairDef['from']) => number): Map<string, P3> {
  const m = new Map<string, P3>();
  const dir: Record<StairDef['direction'], [number, number]> = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] };
  for (const s of stairs) {
    const [dx, dy] = dir[s.direction];
    const run = (s.risers - 1) * s.treadDepth * 0.5;
    const z = floorZ(s.from) + (s.risers * s.riserHeight) / 2;
    const p: P3 = [s.start[0] + dx * run, s.start[1] + dy * run, z];
    for (const a of s.rooms) for (const b of s.rooms) if (a !== b) m.set(`${a}|${b}`, p);
  }
  return m;
}

export interface HearingContext {
  links: readonly RoomLink[];
  doors: DoorStateFn;
  /** Her feet position and room. */
  pos: P3;
  room: string;
  /** Product of hearing multipliers (grace 0.7, assist 0.8 …). */
  mul: number;
  /** A thunder roll is masking sound right now. */
  masked: boolean;
  /** Stairwell portals (stairPortals); when given, sound that crosses a stairwell is measured through it. */
  portals?: Map<string, P3>;
}

/** Effective (attenuated) radius of a noise as she hears it from her room; 0 if masked / no path. */
export function effectiveRadius(n: NoiseInput, h: HearingContext): number {
  if (h.masked && n.source !== 'script') return 0;
  const att = hearingPath(h.links, n.room, h.room, h.doors).attenuation;
  return n.radius * att * h.mul;
}

/**
 * Heard? Two ways for a sound to reach her: (a) the best room-graph path, measured as a walk through each stairwell
 * it crosses (sound goes down the open stairwell, not through the slab), or (b) the best path that avoids
 * stairwells (through floors ×0.4 / walls / doors), measured straight. Heard when either reaches her.
 * Returns the audible margin: effective radius − distance of the better way (≥ 0 = heard; −∞ = masked / no path).
 */
export function hearingMargin(n: NoiseInput, h: HearingContext): number {
  if (h.masked && n.source !== 'script') return -Infinity;
  const pa = hearingPath(h.links, n.room, h.room, h.doors);
  let best = -Infinity;
  if (pa.attenuation > 0) {
    let d = 0;
    let at = n.pos;
    for (let i = 1; i < pa.rooms.length; i++) {
      const portal = h.portals?.get(`${pa.rooms[i - 1]}|${pa.rooms[i]}`);
      const viaStair = portal && h.links.some((l) => l.via === 'stairwell' && ((l.a === pa.rooms[i - 1] && l.b === pa.rooms[i]) || (l.b === pa.rooms[i - 1] && l.a === pa.rooms[i])));
      if (viaStair) {
        d += dist3(at, portal!);
        at = portal!;
      }
    }
    d += dist3(at, h.pos);
    best = n.radius * pa.attenuation * h.mul - d;
  }
  if (h.portals) {
    const pb = hearingPath(h.links, n.room, h.room, h.doors, true);
    if (pb.attenuation > 0) best = Math.max(best, n.radius * pb.attenuation * h.mul - dist3(n.pos, h.pos));
  }
  return best;
}

export function hears(n: NoiseInput, h: HearingContext): boolean {
  return hearingMargin(n, h) >= 0;
}

// ------------------------------------------------------------------ thunder mask

/** Thunder-roll windows on the brain's clock. A `thunder` event at time t masks [t + delay, t + delay + duration]. */
export class ThunderMask {
  windows: { from: number; to: number }[] = [];

  add(now: number, delayMs: number = TUNING.thunder.delayMs, durationMs: number = TUNING.thunder.durationMs): void {
    const from = now + Math.max(0, delayMs) / 1000;
    this.windows.push({ from, to: from + Math.max(0, durationMs) / 1000 });
  }

  isMasked(t: number): boolean {
    return this.windows.some((w) => t >= w.from && t <= w.to);
  }

  /** Seconds until the next roll starts (0 inside one, Infinity if none is scheduled). */
  nextRollIn(t: number): number {
    let best = Infinity;
    for (const w of this.windows) {
      if (t >= w.from && t <= w.to) return 0;
      if (w.from > t) best = Math.min(best, w.from - t);
    }
    return best;
  }

  prune(t: number): void {
    this.windows = this.windows.filter((w) => w.to >= t - 1);
  }
}

// ------------------------------------------------------------------ light

const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: P3, b: P3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: P3): number => Math.hypot(a[0], a[1], a[2]);

/** Fixed flames of the layout (candles, lamps, lanterns, flames). */
export function flamesOf(layout: Pick<LevelLayout, 'lights'>): LightDef[] {
  return layout.lights.filter((l) => l.role === 'candle' || l.role === 'lamp' || l.role === 'lantern' || l.role === 'flame');
}

/** Lit = flashlight on, or standing within 1.5 m (horizontal, same floor) of a fixed flame. */
export function isPlayerLit(p: Pick<PlayerView, 'pos' | 'beam'>, flames: readonly LightDef[]): boolean {
  if (p.beam.on) return true;
  for (const f of flames) {
    if (Math.abs(f.pos[2] - p.pos[2]) > 2.2) continue;
    if (Math.hypot(f.pos[0] - p.pos[0], f.pos[1] - p.pos[1]) <= TUNING.light.flameLit) return true;
  }
  return false;
}

/** Does the beam cone touch a sphere (her body) at `target`? */
export function beamTouches(beam: BeamView, target: P3, radius: number, los: (a: P3, b: P3) => boolean): boolean {
  if (!beam.on) return false;
  const v = sub(target, beam.origin);
  const d = len(v);
  if (d < 1e-6) return true;
  if (d > beam.range + radius) return false;
  const cos = dot(v, beam.dir) / (d * (len(beam.dir) || 1));
  const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
  if (ang > beam.halfAngle + Math.atan(radius / d)) return false;
  return los(beam.origin, target);
}

/** The beam "plays within 6 m of her": its landing point is within 6 m (same floor band). */
export function beamNear(beam: BeamView, adaPos: P3): boolean {
  if (!beam.on || !beam.hit) return false;
  if (Math.abs(beam.hit[2] - adaPos[2]) > 3) return false;
  return Math.hypot(beam.hit[0] - adaPos[0], beam.hit[1] - adaPos[1]) <= TUNING.light.beamInvestigate;
}

// ------------------------------------------------------------------ sight

export function sightRange(lit: boolean, crouched: boolean): number {
  return lit ? TUNING.sight.lit : crouched ? TUNING.sight.darkCrouched : TUNING.sight.dark;
}

/** Is `target` inside her 60° cone (horizontal angle to her look heading)? */
export function inCone(eye: P3, lookYaw: number, target: P3, halfAngleDeg: number = TUNING.sight.halfAngleDeg): boolean {
  const dx = target[0] - eye[0];
  const dy = target[1] - eye[1];
  if (Math.hypot(dx, dy) < 1e-6) return true;
  let a = Math.atan2(dy, dx) - lookYaw;
  a = Math.atan2(Math.sin(a), Math.cos(a));
  return Math.abs(a) <= (halfAngleDeg * Math.PI) / 180;
}

export interface SightContext {
  headLifted: boolean;
  eye: P3;
  lookYaw: number;
  los: (a: P3, b: P3) => boolean;
}

/** Can she see the player? (head lifted, not hidden, in cone, within the lit/dark range, unobstructed) */
export function seesPlayer(s: SightContext, p: PlayerView, lit: boolean): boolean {
  if (!s.headLifted || p.hiddenIn) return false;
  if (dist3(s.eye, p.eye) > sightRange(lit, p.crouched)) return false;
  if (!inCone(s.eye, s.lookYaw, p.eye)) return false;
  return s.los(s.eye, p.eye);
}

/** Locket rule: the open, LIT locket (raised into the beam) within 4 m in her cone, while her head is lifted. */
export function seesLocket(s: SightContext, p: PlayerView): boolean {
  if (!s.headLifted || p.hiddenIn || !p.locketRaised || !p.beam.on) return false;
  // the locket is held in front of the face, in the beam: ≈ 0.35 m ahead of the eye
  const d = p.beam.dir;
  const l = len(d) || 1;
  const locket: P3 = [p.eye[0] + (d[0] / l) * 0.35, p.eye[1] + (d[1] / l) * 0.35, p.eye[2] - 0.1];
  if (dist3(s.eye, locket) > TUNING.locket.range) return false;
  if (!inCone(s.eye, s.lookYaw, locket)) return false;
  return s.los(s.eye, locket);
}

// ------------------------------------------------------------------ priority

/** Which layers want control this tick (timestamps order LURED vs INVESTIGATE: newest wins). */
export interface PriorityInput {
  finale: boolean;
  catch: boolean;
  scripted: boolean;
  chase: boolean;
  look: boolean;
  /** Time the lure stimulus arrived, or null. */
  luredAt: number | null;
  /** Time the newest investigate stimulus arrived, or null. */
  investigateAt: number | null;
  search: boolean;
  patrol: boolean;
}

/**
 * FINALE > CATCH > SCRIPTED > CHASE > LOOK > newest(LURED | INVESTIGATE) > SEARCH > PATROL > VIGIL (rule 3).
 * (LISTEN is the first second of an INVESTIGATE; the brain displays it as LISTEN.)
 */
export function resolvePriority(p: PriorityInput): AdaState {
  if (p.finale) return 'FINALE';
  if (p.catch) return 'CATCH';
  if (p.scripted) return 'SCRIPTED';
  if (p.chase) return 'CHASE';
  if (p.look) return 'LOOK';
  if (p.luredAt !== null || p.investigateAt !== null) {
    if (p.investigateAt === null) return 'LURED';
    if (p.luredAt === null) return 'INVESTIGATE';
    return p.luredAt > p.investigateAt ? 'LURED' : 'INVESTIGATE';
  }
  if (p.search) return 'SEARCH';
  if (p.patrol) return 'PATROL';
  return 'VIGIL';
}

/** Bell lure hold time for the n-th pull (1-based) since the last reset: 60, 50, 40, 40 … (floor 40). */
export function lureDuration(pull: number): number {
  const d = TUNING.lure.durations;
  return Math.max(TUNING.lure.floor, d[Math.min(Math.max(pull, 1), d.length) - 1]);
}
