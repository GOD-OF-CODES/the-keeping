// Spatial audio: HRTF PannerNode helpers + room-graph occlusion.
//
// Occlusion uses the SAME authored room graph (layout.roomLinks) and attenuation numbers as Ada's hearing
// (DESIGN: "what she hears, you hear"): the best path between the listener's room and the source's room is the one
// with the largest product of link attenuations (closed door 0.5, floor 0.4, open stairwell 1, …). That product
// becomes a gain and a lowpass cutoff; paths through floors/walls get an extra-heavy lowpass (structure-borne sound
// loses its highs). Pure functions here are unit-tested; the Web Audio parts are thin wrappers.

import type { RoomLink, LevelLayout, RoomDef } from '../shared/layout-types.ts';

// ---------------------------------------------------------------- room graph (pure)

export type DoorOpenFn = (doorId: string) => boolean;

export interface AudioPath {
  /** Product of link attenuations along the best path (1 = same room / fully open). 0 = unreachable. */
  attenuation: number;
  /** Rooms along the path, from → to. */
  rooms: string[];
  /** Link kinds crossed. */
  via: RoomLink['via'][];
}

function linkAtt(l: RoomLink, isOpen: DoorOpenFn): number {
  if (l.via === 'door' && l.doorId && isOpen(l.doorId)) return l.openAttenuation ?? 1;
  return l.attenuation;
}

/**
 * Best (max-product) path between two rooms — Dijkstra on −log(attenuation). Parallel links between the same pair
 * (G2–U2 has both a floor and the grate) naturally resolve to the better one.
 */
export function bestPath(links: readonly RoomLink[], from: string, to: string, isOpen: DoorOpenFn = () => false): AudioPath {
  if (from === to) return { attenuation: 1, rooms: [from], via: [] };
  const adj = new Map<string, { to: string; w: number; via: RoomLink['via'] }[]>();
  for (const l of links) {
    const a = linkAtt(l, isOpen);
    if (a <= 0) continue;
    const w = -Math.log(Math.min(1, a));
    (adj.get(l.a) ?? adj.set(l.a, []).get(l.a)!).push({ to: l.b, w, via: l.via });
    (adj.get(l.b) ?? adj.set(l.b, []).get(l.b)!).push({ to: l.a, w, via: l.via });
  }
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, { room: string; via: RoomLink['via'] }>();
  const done = new Set<string>();
  // graphs are tiny (≈15 rooms): O(V²) selection is fine and allocation-free enough
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
        prev.set(e.to, { room: u, via: e.via });
      }
    }
  }
  const d = dist.get(to);
  if (d === undefined) return { attenuation: 0, rooms: [], via: [] };
  const rooms = [to];
  const via: RoomLink['via'][] = [];
  let cur = to;
  while (cur !== from) {
    const p = prev.get(cur)!;
    via.unshift(p.via);
    rooms.unshift(p.room);
    cur = p.room;
  }
  return { attenuation: Math.exp(-d), rooms, via };
}

export interface OcclusionParams {
  gain: number;
  /** Lowpass cutoff (Hz). 20000 = transparent. */
  cutoff: number;
}

/**
 * Attenuation → (gain, lowpass). Log-interpolated cutoff: att 1 → 20 kHz, 0.5 (closed door) → ≈3 kHz, 0.25 → ≈900
 * Hz. Floors and walls multiply the cutoff by 0.35 (structure-borne: the "through the floor" thump).
 */
export function occlusionFor(path: Pick<AudioPath, 'attenuation' | 'via'>): OcclusionParams {
  const a = Math.max(0, Math.min(1, path.attenuation));
  if (a <= 0) return { gain: 0, cutoff: 200 };
  if (a >= 0.999) return { gain: 1, cutoff: 20000 };
  const lo = Math.log(250);
  const hi = Math.log(20000);
  let cutoff = Math.exp(lo + (hi - lo) * Math.pow(a, 1.6));
  if (path.via.some((v) => v === 'floor' || v === 'wall')) cutoff *= 0.35;
  return { gain: Math.pow(a, 1.25), cutoff: Math.max(120, Math.min(20000, cutoff)) };
}

// ---------------------------------------------------------------- room lookup (pure)

const area = (r: RoomDef) => (r.rect[2] - r.rect[0]) * (r.rect[3] - r.rect[1]);

/**
 * Which room contains a PLAN-space point. Picks the highest floor at or below the point's height, then the
 * smallest containing rect (the under-stair closet sits inside the hall's rect; EXT2 contains the house).
 */
export function roomAtPlan(layout: Pick<LevelLayout, 'rooms' | 'floors'>, x: number, y: number, z: number): string | null {
  const elev = new Map(layout.floors.map((f) => [f.id, f.elevation]));
  let best: RoomDef | null = null;
  let bestElev = -Infinity;
  for (const r of layout.rooms) {
    const [x0, y0, x1, y1] = r.rect;
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const e = elev.get(r.floor) ?? 0;
    if (e > z + 0.35) continue;
    if (r.kind === 'interior' && z > e + r.ceiling + 0.3) continue;
    if (e > bestElev || (e === bestElev && best && area(r) < area(best))) {
      best = r;
      bestElev = e;
    }
  }
  return best?.id ?? null;
}

/** Same, taking a three.js WORLD position (Y-up): plan = (x, -z, y). */
export function roomAtWorld(layout: Pick<LevelLayout, 'rooms' | 'floors'>, wx: number, wy: number, wz: number): string | null {
  return roomAtPlan(layout, wx, -wz, wy);
}

// ---------------------------------------------------------------- Web Audio

export interface PannerOpts {
  refDistance?: number;
  maxDistance?: number;
  rolloffFactor?: number;
  /** Directional sources (a voice facing away) — degrees. */
  coneInner?: number;
  coneOuter?: number;
  coneOuterGain?: number;
}

/** HRTF panner with inverse-distance rolloff tuned for a house (1 m reference, 30 m max). */
export function createHrtfPanner(ctx: BaseAudioContext, o: PannerOpts = {}): PannerNode {
  const p = ctx.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'inverse';
  p.refDistance = o.refDistance ?? 1;
  p.maxDistance = o.maxDistance ?? 30;
  p.rolloffFactor = o.rolloffFactor ?? 1.1;
  p.coneInnerAngle = o.coneInner ?? 360;
  p.coneOuterAngle = o.coneOuter ?? 360;
  p.coneOuterGain = o.coneOuterGain ?? 0;
  return p;
}

export function setPannerPosition(p: PannerNode, x: number, y: number, z: number, when: number, ramp = 0.03): void {
  if (p.positionX) {
    p.positionX.setTargetAtTime(x, when, ramp);
    p.positionY.setTargetAtTime(y, when, ramp);
    p.positionZ.setTargetAtTime(z, when, ramp);
  } else {
    (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z);
  }
}

export function setPannerOrientation(p: PannerNode, x: number, y: number, z: number, when: number): void {
  if (p.orientationX) {
    p.orientationX.setTargetAtTime(x, when, 0.03);
    p.orientationY.setTargetAtTime(y, when, 0.03);
    p.orientationZ.setTargetAtTime(z, when, 0.03);
  } else {
    (p as unknown as { setOrientation(x: number, y: number, z: number): void }).setOrientation(x, y, z);
  }
}

/**
 * A positional emitter: input → occlusion lowpass → occlusion gain → HRTF panner → bus, plus a pre-panner send
 * to its room's reverb. Everything Ada does plays through one of these.
 */
export class SpatialEmitter {
  readonly input: GainNode;
  readonly panner: PannerNode;
  readonly reverbSend: GainNode;
  room: string | null = null;
  private lp: BiquadFilterNode;
  private occ: GainNode;
  private ctx: BaseAudioContext;
  constructor(ctx: BaseAudioContext, out: AudioNode, o: PannerOpts = {}) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 20000;
    this.lp.Q.value = 0.5;
    this.occ = ctx.createGain();
    this.panner = createHrtfPanner(ctx, o);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    this.input.connect(this.lp).connect(this.occ).connect(this.panner).connect(out);
    this.occ.connect(this.reverbSend);
  }
  setPosition(x: number, y: number, z: number): void {
    setPannerPosition(this.panner, x, y, z, this.ctx.currentTime);
  }
  setOcclusion(o: OcclusionParams, ramp = 0.12): void {
    const t = this.ctx.currentTime;
    this.occ.gain.setTargetAtTime(o.gain, t, ramp);
    this.lp.frequency.setTargetAtTime(o.cutoff, t, ramp);
  }
  /** Route the reverb send to a room's reverb input (or detach). */
  sendTo(node: AudioNode | null): void {
    this.reverbSend.disconnect();
    if (node) this.reverbSend.connect(node);
  }
  dispose(): void {
    for (const n of [this.input, this.lp, this.occ, this.panner, this.reverbSend]) n.disconnect();
  }
}
