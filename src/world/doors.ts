// Hinged door leaves from doors.glb (docs/HOUSE.md "Extras"):
//   door_<id>: origin = hinge axis at the leaf bottom, leaf exported CLOSED, open by rotating about world +Y by
//   swingSign · angle (it swings into `swingInto`); initialAngleDeg: ajar 20°, open 95°.
//   board_D_ADA_k: Ada's three nailed planks (flag ada_board_k removes one); bolt_D_PASSAGE: child of its leaf,
//   exported BOLTED, slides −slideTravel along slideAxis (leaf-local plan axis) to unbolt.
// States: closed / opening / open / closing, plus a lock reason: 'bolted' (front: the rope; passage: flag
// passage_unbolted), 'boarded' (D_ADA: flag ada_boards_pried = all three planks off), 'locked' (story).
// Slow pushes are quiet; fast pushes (sprint key held) are loud and can slam — both emit `noise` events
// (PLAN positions; the AI hears them) and play the synthesized door sounds.

import * as THREE from 'three/webgpu';
import type { GameContext } from '../game/context.ts';
import type { DoorDef, LevelLayout } from '../shared/layout-types.ts';
import { worldToPlan } from '../shared/coords.ts';
import type { WorldCollision } from './collision.ts';

export interface SoundSink {
  play(id: string, o?: { pos?: [number, number, number]; room?: string; gain?: number; rate?: number; params?: Record<string, number> }): unknown;
}

export type LockReason = 'bolted' | 'boarded' | 'locked' | null;

export interface Door {
  id: string;
  def: DoorDef | null;
  group: any;
  extras: Record<string, any>;
  /** Rooms on either side of the opening (culling + audio). */
  rooms: string[];
  swingSign: number;
  /** Current / target opening angle in degrees (0 = closed). */
  angle: number;
  target: number;
  speed: number;
  lock: LockReason;
  interactive: boolean;
  /** Leaf box in the hinge frame (closed). */
  box: any;
  bolt: any | null;
  boltRest: any | null;
  boltTravel: number;
  boltAxis: any | null;
  boards: any[];
  fast: boolean;
}

const OPEN_DEG = 92;
const SLOW_DPS = 70;
const FAST_DPS = 260;

/** Noise radii (m, at the source) — the AI's hearing multiplies by room-graph attenuation. */
export const DOOR_NOISE = { slow: 3, fast: 8, slam: 13, rattle: 6, bolt: 5 } as const;

export class DoorSystem {
  readonly doors = new Map<string, Door>();
  readonly group: any;
  private ctx: GameContext;
  private sound: SoundSink | null = null;
  /** Set by the pry interaction just before its flag: that board falls (animated) instead of snapping. */
  livePry = 0;
  private offFlag: (() => void) | null = null;

  constructor(ctx: GameContext, gltfScene: any, layout: LevelLayout) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'doors';
    const defs = new Map(layout.doors.map((d) => [d.id, d]));
    const openingRooms = new Map<string, string[]>();
    for (const w of layout.walls)
      for (const op of w.openings) openingRooms.set(op.id, [w.left, w.right].filter((r) => r !== 'exterior' && r !== 'void'));
    const boards = new Map<string, any[]>();
    const nodes = [...gltfScene.children];
    for (const n of nodes) {
      const ud = n.userData ?? {};
      if (ud.kind === 'door_board') {
        const list = boards.get(ud.doorId) ?? [];
        list.push(n);
        boards.set(ud.doorId, list);
      }
    }
    for (const n of nodes) {
      const ud = n.userData ?? {};
      if (ud.kind !== 'door') {
        if (ud.kind === 'door_board') this.group.add(n);
        continue;
      }
      const def = defs.get(ud.doorId) ?? null;
      let rooms = openingRooms.get(ud.openingId) ?? [];
      if (ud.doorId === 'D_FRONT' && !rooms.includes('EXT2')) rooms = [...rooms, 'EXT2'];
      if (!rooms.length && def) rooms = [def.swingInto];
      // Leaf box in the hinge frame (children are local to the hinge group; skip the bolt, it hangs off the leaf).
      const box = new THREE.Box3();
      n.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(n.matrixWorld).invert();
      n.traverse((o: any) => {
        if (!o.isMesh || /^bolt_/.test(o.name)) return;
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
        box.union(b);
      });
      box.expandByScalar(0.005);
      let bolt: any = null;
      n.traverse((o: any) => {
        if (o.userData?.kind === 'door_bolt') bolt = o;
      });
      const initial = String(ud.initial ?? def?.initial ?? 'closed');
      const lock: LockReason = initial === 'bolted' ? 'bolted' : initial === 'boarded' ? 'boarded' : initial === 'locked' ? 'locked' : null;
      const angle = Number(ud.initialAngleDeg ?? 0);
      const d: Door = {
        id: String(ud.doorId),
        def,
        group: n,
        extras: ud,
        rooms,
        swingSign: Number(ud.swingSign ?? 1) || 1,
        angle,
        target: angle,
        speed: SLOW_DPS,
        lock,
        interactive: ud.interactive !== false && def?.interactive !== false,
        box,
        bolt,
        boltRest: bolt ? bolt.position.clone() : null,
        boltTravel: Number(bolt?.userData?.slideTravel ?? 0.045),
        boltAxis: bolt ? planAxisToWorld(bolt.userData?.slideAxis ?? [-1, 0, 0]) : null,
        boards: boards.get(String(ud.doorId)) ?? [],
        fast: false,
      };
      this.applyPose(d);
      this.doors.set(d.id, d);
      this.group.add(n);
    }
    // Flags that unlock doors / remove boards (story lane sets ctx.flags + emits 'flag').
    this.offFlag = ctx.events.on('flag', ({ name, value }) => this.onFlag(name, value));
    for (const [name, value] of ctx.flags) this.onFlag(name, value);
  }

  setSound(s: SoundSink | null): void {
    this.sound = s;
  }

  /** Registers every leaf as a dynamic blocker (closed or not: an open leaf blocks where it stands). */
  attachCollision(c: WorldCollision): void {
    for (const d of this.doors.values()) c.addBlocker({ object: d.group, box: d.box, enabled: () => d.group.visible !== false || true, moving: () => d.angle !== d.target });
  }

  isOpen(id: string): boolean {
    const d = this.doors.get(id);
    return !!d && Math.abs(d.angle) > 8;
  }

  /** Door state for the audio occlusion provider and AI: open/ajar = true. */
  readonly isOpenFn = (id: string): boolean => this.isOpen(id);

  lockOf(id: string): LockReason {
    return this.doors.get(id)?.lock ?? null;
  }

  setLock(id: string, lock: LockReason): void {
    const d = this.doors.get(id);
    if (!d) return;
    d.lock = lock;
    if (d.bolt) this.applyBolt(d);
  }

  /** Opens a door (fails with a rattle when locked). Returns false when it didn't move. */
  open(id: string, fast = false, force = false): boolean {
    const d = this.doors.get(id);
    if (!d) return false;
    if (d.lock && !force) {
      this.rattle(d);
      return false;
    }
    if (force) d.lock = null;
    this.moveTo(d, OPEN_DEG, fast);
    return true;
  }

  close(id: string, fast = false): void {
    const d = this.doors.get(id);
    if (d) this.moveTo(d, 0, fast);
  }

  toggle(id: string, fast = false): boolean {
    const d = this.doors.get(id);
    if (!d) return false;
    const opening = d.target < 10;
    if (opening) return this.open(id, fast);
    this.close(id, fast);
    return true;
  }

  /** B02 / B11: the parlor pull lifts the drop-bolt and the counterweight rope swings the front door open. */
  ropeOpen(): void {
    const d = this.doors.get('D_FRONT');
    if (!d) return;
    d.lock = null;
    const pos = this.worldPos(d);
    this.sound?.play('bolt_box_clank', { pos, room: 'G1' });
    setTimeout(() => {
      this.sound?.play('door_swing', { pos, room: 'G1' });
      d.speed = 32; // heavy, slow swing on the counterweight
      d.target = OPEN_DEG;
      d.fast = false;
    }, 450);
  }

  /** Finale: the counterweight drags it shut and the bolt drops. */
  ropeClose(): void {
    const d = this.doors.get('D_FRONT');
    if (!d) return;
    this.moveTo(d, 0, true);
    d.lock = 'bolted';
  }

  /**
   * A pried plank comes off: it swings about its far nail, drops and lies on the landing floor in front of the door
   * (pried boards stay pried — and stay visible). `animate` false = straight to the floor pose (debug starts,
   * checkpoint restores, the all-pried flag).
   */
  removeBoard(k: number, animate = false): void {
    const d = this.doors.get('D_ADA');
    const b = d?.boards.find((x) => Number(x.userData?.board) === k);
    if (!d || !b || b.userData.removed) return;
    b.userData.removed = true;
    const fall = boardFallPose(d, b, k);
    if (!fall) {
      b.visible = false;
      return;
    }
    if (!animate) {
      b.position.copy(fall.pos);
      b.quaternion.copy(fall.quat);
      b.updateMatrixWorld(true);
      return;
    }
    this.falling.push({ b, t: 0, ...fall, pos0: b.position.clone(), quat0: b.quaternion.clone(), pivot: fall.pivot, landed: false });
  }

  private readonly falling: { b: any; t: number; pos: any; quat: any; pos0: any; quat0: any; pivot: any; landed: boolean; pos1?: any; quat1?: any }[] = [];

  update(dt: number): void {
    this.updateFalling(dt);
    for (const d of this.doors.values()) {
      if (d.angle === d.target) continue;
      const step = d.speed * dt;
      const delta = d.target - d.angle;
      // Ease the last 12° so leaves settle instead of stopping dead.
      const ease = Math.min(1, Math.abs(delta) / 12 + 0.25);
      if (Math.abs(delta) <= step * ease) {
        d.angle = d.target;
        if (d.target === 0) this.onClosed(d);
      } else d.angle += Math.sign(delta) * step * ease;
      this.applyPose(d);
    }
  }

  dispose(): void {
    this.offFlag?.();
  }

  // ---------------------------------------------------------------------------------------------- internals

  /** Board fall: 0–0.35 s it hinges on the far nail (drops its near end), then falls flat with a small bounce. */
  private updateFalling(dt: number): void {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.t += dt;
      const T1 = 0.35;
      const T2 = 0.95;
      const b = f.b;
      if (f.t < T1) {
        // swing about the far nail (pivot, parent space) by up to 28° around the door normal
        const a = (f.t / T1) ** 2 * 0.5;
        _q.setFromAxisAngle(f.pivot.axis, a * f.pivot.sign);
        b.quaternion.copy(_q).multiply(f.quat0);
        b.position.copy(f.pos0).sub(f.pivot.p).applyQuaternion(_q).add(f.pivot.p);
        f.pos1 ??= b.position.clone();
        f.quat1 ??= b.quaternion.clone();
        f.pos1.copy(b.position);
        f.quat1.copy(b.quaternion);
      } else {
        const u = Math.min(1, (f.t - T1) / (T2 - T1));
        const from = f.pos1 ?? f.pos0;
        const qf = f.quat1 ?? f.quat0;
        b.position.lerpVectors(from, f.pos, u);
        b.position.y = from.y + (f.pos.y - from.y) * u * u; // gravity: slow start, fast end
        if (u >= 1) {
          const bt = f.t - T2; // one small bounce
          b.position.y = f.pos.y + Math.max(0, Math.sin(Math.min(1, bt / 0.18) * Math.PI)) * 0.025;
        }
        b.quaternion.slerpQuaternions(qf, f.quat, Math.min(1, u * 1.15));
        if (u >= 1 && !f.landed) {
          f.landed = true;
          const w = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
          this.sound?.play('board_drop', { pos: [w.x, w.y, w.z], room: 'U1', gain: 0.9 });
        }
        if (f.t > T2 + 0.2) this.falling.splice(i, 1);
      }
      b.updateMatrixWorld(true);
    }
  }

  private moveTo(d: Door, target: number, fast: boolean): void {
    if (d.target === target) return;
    d.target = target;
    d.fast = fast;
    d.speed = fast ? FAST_DPS : SLOW_DPS;
    const pos = this.worldPos(d);
    const room = d.rooms[0];
    if (fast) this.sound?.play('door_creak', { pos, room, gain: 0.6, rate: 1.25 });
    else this.sound?.play('door_creak', { pos, room, gain: 0.8 });
    this.noise(d, fast ? DOOR_NOISE.fast : DOOR_NOISE.slow);
  }

  private onClosed(d: Door): void {
    const pos = this.worldPos(d);
    if (d.fast) {
      this.sound?.play('door_slam', { pos, room: d.rooms[0] });
      this.noise(d, DOOR_NOISE.slam);
    } else this.sound?.play('latch', { pos, room: d.rooms[0], gain: 0.8 });
  }

  private rattle(d: Door): void {
    const pos = this.worldPos(d);
    this.sound?.play(d.lock === 'bolted' ? 'bolt_box_clank' : 'latch', { pos, room: d.rooms[0], gain: 0.9 });
    this.noise(d, DOOR_NOISE.rattle);
    this.ctx.events.emit('interact', { id: d.id, action: `rattle_${d.lock ?? 'door'}` });
  }

  private noise(d: Door, radius: number): void {
    const w = this.worldPos(d);
    this.ctx.events.emit('noise', { pos: worldToPlan(w) as [number, number, number], room: d.rooms[0] ?? '', radius, source: 'door' });
  }

  private worldPos(d: Door): [number, number, number] {
    const c = d.box.getCenter(new THREE.Vector3()).applyMatrix4(d.group.matrixWorld);
    return [c.x, c.y, c.z];
  }

  private applyPose(d: Door): void {
    d.group.rotation.set(0, THREE.MathUtils.degToRad(d.angle) * d.swingSign, 0);
    d.group.updateMatrixWorld(true);
  }

  private applyBolt(d: Door): void {
    if (!d.bolt || !d.boltRest || !d.boltAxis) return;
    d.bolt.position.copy(d.boltRest);
    if (d.lock !== 'bolted') d.bolt.position.addScaledVector(d.boltAxis, -d.boltTravel);
  }

  private onFlag(name: string, value: boolean): void {
    if (!value) return;
    const m = /^ada_board_(\d)$/.exec(name);
    if (m) this.removeBoard(Number(m[1]), this.livePry === Number(m[1]));
    for (const d of this.doors.values()) {
      if (d.def?.unlockFlag && d.def.unlockFlag === name && d.lock) {
        d.lock = null;
        if (d.bolt) {
          this.applyBolt(d);
          this.sound?.play('bolt_slide', { pos: this.worldPos(d), room: d.rooms[0] });
          this.noise(d, DOOR_NOISE.bolt);
        }
        if (name === 'ada_boards_pried') for (const b of d.boards) this.removeBoard(Number(b.userData?.board ?? 0));
      }
    }
  }
}

const _q = new THREE.Quaternion();

/**
 * Where a plank of D_ADA ends up: flat on the landing floor, 0.3–0.6 m out from the door on the side it was nailed
 * (the hallway), long axis roughly along the door. Also the pivot for the first swing (the far nail).
 * Everything in the board's parent space.
 */
function boardFallPose(d: Door, b: any, k: number): { pos: any; quat: any; pivot: { p: any; axis: any; sign: number } } | null {
  if (!b.parent) return null;
  // bounds in the board's own frame (a plank with two materials loads as a Group of two meshes)
  b.updateMatrixWorld(true);
  const invB = new THREE.Matrix4().copy(b.matrixWorld).invert();
  const bb = new THREE.Box3();
  b.traverse((o: any) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    bb.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(invB, o.matrixWorld)));
  });
  if (bb.isEmpty()) return null;
  const size = bb.getSize(new THREE.Vector3());
  const center = bb.getCenter(new THREE.Vector3());
  const dims = [size.x, size.y, size.z];
  const order = [0, 1, 2].sort((a, c) => dims[c] - dims[a]); // long, width, thickness
  const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  b.updateMatrixWorld(true);
  const parent = b.parent;
  parent.updateMatrixWorld(true);
  const toParent = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const pq = new THREE.Quaternion();
  parent.matrixWorld.decompose(new THREE.Vector3(), pq, new THREE.Vector3());
  const wq = new THREE.Quaternion();
  b.matrixWorld.decompose(new THREE.Vector3(), wq, new THREE.Vector3());
  const longW = axes[order[0]].clone().applyQuaternion(wq);
  const thickW = axes[order[2]].clone().applyQuaternion(wq);
  const cW = center.clone().applyMatrix4(b.matrixWorld);
  // hallway side = the side of the leaf the board sits on
  const leafC = d.box.getCenter(new THREE.Vector3()).applyMatrix4(d.group.matrixWorld);
  const out = thickW.clone().setY(0).normalize();
  if (out.lengthSq() < 0.5) return null;
  if (out.dot(new THREE.Vector3().subVectors(cW, leafC)) < 0) out.negate();
  const floorY = new THREE.Vector3().setFromMatrixPosition(d.group.matrixWorld).y;
  const along = longW.clone().setY(0);
  if (along.lengthSq() < 1e-4) along.crossVectors(out, new THREE.Vector3(0, 1, 0));
  along.normalize();
  // end orientation: long axis along the door (turned a little per board), thickness up
  const turn = [0.35, -0.22, 0.12][(k - 1) % 3] ?? 0;
  const endLong = along.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
  const up = new THREE.Vector3(0, 1, 0);
  const third = new THREE.Vector3().crossVectors(endLong, up).normalize();
  // map local axes → world basis (long → endLong, thickness → up, width → third), keeping handedness
  const basisLocal = new THREE.Matrix4().makeBasis(axes[order[0]], axes[order[1]], axes[order[2]]);
  let basisWorld = new THREE.Matrix4().makeBasis(endLong, third, up);
  if (basisLocal.determinant() * basisWorld.determinant() < 0) basisWorld = new THREE.Matrix4().makeBasis(endLong, third.clone().negate(), up);
  const qWorld = new THREE.Quaternion().setFromRotationMatrix(basisWorld.multiply(basisLocal.clone().invert()));
  const halfT = dims[order[2]] / 2;
  const restW = new THREE.Vector3().copy(cW).setY(floorY + halfT + 0.002).addScaledVector(out, 0.28 + k * 0.1);
  // mesh origin such that the bbox centre lands on restW
  const originW = restW.clone().sub(center.clone().applyQuaternion(qWorld));
  const pos = originW.applyMatrix4(toParent);
  const quat = pq.clone().invert().multiply(qWorld);
  // swing pivot: the end of the plank farther from the door's hinge side (world → parent)
  const endA = cW.clone().addScaledVector(longW, dims[order[0]] / 2);
  const endB = cW.clone().addScaledVector(longW, -dims[order[0]] / 2);
  const pivotW = k % 2 ? endA : endB;
  const axisP = out.clone().applyQuaternion(pq.clone().invert()).normalize();
  // drop the free end: sign so the far end goes down
  const free = (k % 2 ? endB : endA).clone().sub(pivotW);
  const test = free.clone().applyAxisAngle(out, 0.3);
  const sign = test.y < free.y ? 1 : -1;
  return { pos, quat, pivot: { p: pivotW.applyMatrix4(toParent), axis: axisP, sign } };
}

/** Plan-space direction (x east, y north, z up) → world direction (x, z, −y). */
function planAxisToWorld(a: number[]): any {
  return new THREE.Vector3(a[0] ?? 0, a[2] ?? 0, -(a[1] ?? 0)).normalize();
}
