// Pure layout queries for the world/player runtime (no three.js: unit-tested under Node, tests/world-rooms.test.ts).
// Everything here is PLAN space (x = east, y = north, z = up, metres; see src/shared/coords.ts).
//
//  - roomAt(x, y, feetZ): which room the player/camera is in. Interior rooms first (smallest area wins: CLOSET is
//    nested in G1, G1 and U1 share a rect and are told apart by feet height), then set/exterior rooms. Inside the
//    house footprint but in no interior rect (wall thickness, a doorway) → null: callers keep the last room.
//  - visibleFrom(room, x, y, feetZ): culling set = the room's visibleRooms ∪ those of interior neighbours within a
//    margin (kills pops while crossing a doorway before the room lookup flips).
//  - surfaceAt / creakerAt / stairStepAt / triggersAt: footstep surfaces, creaking boards, creaky stair treads,
//    story trigger volumes.
//  - headingToCameraYaw: layout headings (spawn.yaw, hide.eyeYaw, aiNode.lookYaw) are CCW from +x (east). A YXZ
//    camera with rotation.y = 0 looks down world −z = plan +y (north) → camera yaw = heading − π/2.

import type { AcousticSurface, Creaker, LevelLayout, Rect, RoomDef, StairDef, SurfaceZone, TriggerVolume } from '../shared/layout-types.ts';

export const EYE_HEIGHT = 1.65;
export const CROUCH_EYE_HEIGHT = 1.05;

/** Layout heading (CCW from east) → world camera yaw (rotation.y, YXZ order, forward = −z at 0). */
export function headingToCameraYaw(heading: number): number {
  return heading - Math.PI / 2;
}

/** Inverse of headingToCameraYaw. */
export function cameraYawToHeading(yaw: number): number {
  return yaw + Math.PI / 2;
}

export const rectContains = (r: Rect, x: number, y: number, eps = 0): boolean =>
  x >= r[0] - eps && x <= r[2] + eps && y >= r[1] - eps && y <= r[3] + eps;

export const rectArea = (r: Rect): number => (r[2] - r[0]) * (r[3] - r[1]);

/** Distance from a point to a rect (0 inside). */
export function rectDistance(r: Rect, x: number, y: number): number {
  const dx = Math.max(r[0] - x, 0, x - r[2]);
  const dy = Math.max(r[1] - y, 0, y - r[3]);
  return Math.hypot(dx, dy);
}

export class RoomIndex {
  readonly layout: LevelLayout;
  readonly rooms: Map<string, RoomDef>;
  readonly floorElevation: Map<string, number>;
  /** Interior rooms sorted by area (smallest first). */
  private readonly interiors: RoomDef[];
  private readonly outside: RoomDef[];
  /** Bounding rect of every ground/upper interior room, grown by the wall thickness. */
  readonly footprint: Rect;
  private readonly upperZ: number;

  constructor(layout: LevelLayout) {
    this.layout = layout;
    this.rooms = new Map(layout.rooms.map((r) => [r.id, r]));
    this.floorElevation = new Map(layout.floors.map((f) => [f.id, f.elevation]));
    this.interiors = layout.rooms.filter((r) => r.kind === 'interior').sort((a, b) => rectArea(a.rect) - rectArea(b.rect));
    this.outside = layout.rooms.filter((r) => r.kind !== 'interior').sort((a, b) => rectArea(a.rect) - rectArea(b.rect));
    const f: Rect = [Infinity, Infinity, -Infinity, -Infinity];
    for (const r of this.interiors) {
      if (r.floor !== 'ground' && r.floor !== 'upper') continue;
      f[0] = Math.min(f[0], r.rect[0]);
      f[1] = Math.min(f[1], r.rect[1]);
      f[2] = Math.max(f[2], r.rect[2]);
      f[3] = Math.max(f[3], r.rect[3]);
    }
    const wall = 0.32;
    this.footprint = [f[0] - wall, f[1] - wall, f[2] + wall, f[3] + wall];
    this.upperZ = this.floorElevation.get('upper') ?? 4.1;
  }

  elevationOf(roomId: string): number {
    const r = this.rooms.get(roomId);
    return r ? (this.floorElevation.get(r.floor) ?? 0) : 0;
  }

  /** Floor the feet height belongs to (interiors): at/above ~0.6 m under the upper floor → upper. */
  floorForZ(feetZ: number): 'ground' | 'upper' {
    return feetZ >= this.upperZ - 0.6 ? 'upper' : 'ground';
  }

  /**
   * Room containing plan (x, y) at feet height z. null = inside the house footprint but in no interior rect
   * (wall thickness, door reveal): keep the previous room.
   */
  roomAt(x: number, y: number, feetZ: number): string | null {
    // On a straight flight (above its first riser) the stair's own rooms win: the main stair runs over the
    // CLOSET rect, and culling must keep both floors while climbing.
    for (const s of this.layout.stairs) {
      const k = stairStepIndex(s, x, y);
      if (k <= 0 || !s.rooms.length) continue;
      const e = this.floorElevation.get(s.from) ?? 0;
      if (feetZ < e + 0.1 || feetZ > e + s.risers * s.riserHeight + 0.3) continue;
      return k <= (s.risers - 1) / 2 ? s.rooms[0] : s.rooms[s.rooms.length - 1];
    }
    const fl = this.floorForZ(feetZ);
    let anyFloor: RoomDef | null = null;
    for (const r of this.interiors) {
      if (!rectContains(r.rect, x, y)) continue;
      if (r.floor === fl) return r.id;
      const e = this.floorElevation.get(r.floor) ?? 0;
      if (!anyFloor && feetZ >= e - 0.8 && feetZ <= e + r.ceiling) anyFloor = r; // U4's shaft, stairs
    }
    if (anyFloor) return anyFloor.id;
    if (feetZ > 0.3 && rectContains(this.footprint, x, y)) return null;
    for (const r of this.outside) if (rectContains(r.rect, x, y)) return r.id;
    return null;
  }

  /** Walkable bounds: inside some room, or inside the house footprint (walls / doorways). */
  inBounds(x: number, y: number, feetZ: number): boolean {
    return rectContains(this.footprint, x, y) || this.roomAt(x, y, feetZ) !== null;
  }

  /** Culling set for a camera: the room's visibleRooms plus those of interior rooms within `margin` metres. */
  visibleFrom(room: string | null, x: number, y: number, feetZ: number, margin = 0.6): Set<string> {
    const out = new Set<string>();
    const add = (id: string) => {
      const r = this.rooms.get(id);
      if (!r) return;
      out.add(id);
      for (const v of r.visibleRooms) out.add(v);
    };
    if (room) add(room);
    const fl = this.floorForZ(feetZ);
    for (const r of this.interiors) {
      if (r.id === room) continue;
      const e = this.floorElevation.get(r.floor) ?? 0;
      const sameLevel = r.floor === fl || (feetZ >= e - 0.8 && feetZ <= e + r.ceiling);
      if (sameLevel && rectDistance(r.rect, x, y) <= margin) add(r.id);
    }
    if (out.size === 0) for (const r of this.layout.rooms) out.add(r.id); // unknown position: render everything
    return out;
  }

  /** Acoustic surface under plan (x, y) in `room` (smallest containing zone wins). */
  surfaceAt(room: string | null, x: number, y: number): AcousticSurface {
    return surfaceAt(this.layout.surfaces, room, x, y);
  }

  creakerAt(room: string | null, x: number, y: number): Creaker | null {
    for (const c of this.layout.creakers) {
      if (room && c.room !== room) continue;
      if (Math.hypot(c.pos[0] - x, c.pos[1] - y) <= c.radius) return c;
    }
    return null;
  }

  /** Which stair tread (1-based) plan (x, y, feetZ) stands on, for creaky steps. */
  stairStepAt(x: number, y: number, feetZ: number): { stair: StairDef; step: number } | null {
    for (const s of this.layout.stairs) {
      const k = stairStepIndex(s, x, y);
      if (k <= 0) continue;
      const e = this.floorElevation.get(s.from) ?? 0;
      const expect = e + k * s.riserHeight;
      if (Math.abs(feetZ - expect) < 0.45) return { stair: s, step: k };
    }
    return null;
  }

  triggersAt(x: number, y: number, feetZ: number): TriggerVolume[] {
    return this.layout.triggers.filter((t) => rectContains(t.rect, x, y) && feetZ >= t.zMin && feetZ <= t.zMax);
  }
}

export function surfaceAt(zones: SurfaceZone[], room: string | null, x: number, y: number): AcousticSurface {
  let best: SurfaceZone | null = null;
  for (const z of zones) {
    if (room && z.room !== room) continue;
    if (!rectContains(z.rect, x, y)) continue;
    if (!best || rectArea(z.rect) < rectArea(best.rect)) best = z;
  }
  if (!best && room) return surfaceAt(zones, null, x, y);
  return best?.surface ?? 'bare_wood';
}

/**
 * 1-based tread index for a straight flight (winders count as ordinary treads along the flight direction from the
 * start line: good enough for creak placement). 0 = not on the flight.
 */
export function stairStepIndex(s: StairDef, x: number, y: number): number {
  const d = s.direction;
  const along = d === 'N' ? y - s.start[1] : d === 'S' ? s.start[1] - y : d === 'E' ? x - s.start[0] : s.start[0] - x;
  const across = d === 'N' || d === 'S' ? x - s.start[0] : y - s.start[1];
  if (s.winder) return 0; // the back stair turns: skip (its creaky steps are placed by the AI lane's stair nodes)
  if (Math.abs(across) > s.width / 2 + 0.05) return 0;
  const n = s.risers - 1; // treads between the first and last riser
  if (along < 0 || along > n * s.treadDepth) return 0;
  return Math.min(n, Math.floor(along / s.treadDepth) + 1);
}

// ------------------------------------------------------------------------------------------ exterior ground

export interface GroundCell {
  rect: Rect;
  surface: AcousticSurface;
  mat: string;
}

/**
 * Partitions the exterior rooms into non-overlapping rects, each owned by the smallest containing surface zone
 * (exact — every zone edge becomes a grid line, so no overlapping coplanar planes → no z-fighting). Cells inside
 * `skip` (the house footprint, hidden by the foundation) are dropped. Adjacent cells of the same material in a row
 * are merged to keep the triangle count low.
 */
export function partitionGround(layout: LevelLayout, skip: Rect | null, outer: Rect | null = null): GroundCell[] {
  const ext: Array<{ id: string; rect: Rect }> = layout.rooms.filter((r) => r.kind === 'exterior');
  // `outer`: a fallback grass field around everything so the ground has no visible edge before the fog.
  if (outer) ext.push({ id: '__outer', rect: outer });
  // Porch boards are raised house geometry (the deck at +0.58 m): the ground under them keeps the zone below.
  const zones = layout.surfaces.filter((z) => z.surface !== 'porch_wood' && ext.some((r) => r.id === z.room)) as (SurfaceZone & { mat?: string })[];
  if (outer) zones.push({ room: '__outer', rect: outer, surface: 'grass', mat: 'grass_wet' });
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const r of ext) {
    xs.add(r.rect[0]).add(r.rect[2]);
    ys.add(r.rect[1]).add(r.rect[3]);
  }
  for (const z of zones) {
    xs.add(z.rect[0]).add(z.rect[2]);
    ys.add(z.rect[1]).add(z.rect[3]);
  }
  if (skip) {
    xs.add(skip[0]).add(skip[2]);
    ys.add(skip[1]).add(skip[3]);
  }
  const X = [...xs].sort((a, b) => a - b);
  const Y = [...ys].sort((a, b) => a - b);
  const out: GroundCell[] = [];
  for (let j = 0; j < Y.length - 1; j++) {
    let run: GroundCell | null = null;
    for (let i = 0; i < X.length - 1; i++) {
      const cx = (X[i] + X[i + 1]) / 2;
      const cy = (Y[j] + Y[j + 1]) / 2;
      let cell: GroundCell | null = null;
      if (!(skip && rectContains(skip, cx, cy)) && ext.some((r) => rectContains(r.rect, cx, cy))) {
        let best: (SurfaceZone & { mat?: string }) | null = null;
        for (const z of zones) if (rectContains(z.rect, cx, cy) && (!best || rectArea(z.rect) < rectArea(best.rect))) best = z;
        if (best) cell = { rect: [X[i], Y[j], X[i + 1], Y[j + 1]], surface: best.surface, mat: best.mat ?? defaultGroundMat(best.surface) };
      }
      if (cell && run && run.mat === cell.mat && run.surface === cell.surface && run.rect[2] === cell.rect[0]) {
        run.rect = [run.rect[0], run.rect[1], cell.rect[2], run.rect[3]];
      } else {
        if (run) out.push(run);
        run = cell;
      }
    }
    if (run) out.push(run);
  }
  return out;
}

function defaultGroundMat(s: AcousticSurface): string {
  switch (s) {
    case 'asphalt':
      return 'asphalt_wet';
    case 'gravel':
      return 'gravel_wet';
    case 'mud':
      return 'mud_wet';
    case 'porch_wood':
      return 'porch_boards_wet';
    default:
      return 'grass_wet';
  }
}
