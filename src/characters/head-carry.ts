// C2-ESCAPE B3 — severed Ada: THE ONE runtime head-carry mechanism (lead ruling, Phase 1). Instead of re-authoring
// every later clip with the head in her hand, the `ada_head_rig` node (lane A's sever.py: the head + hair + eye as
// their own armature, bone-parented to `ada_rig.head` until C2) is re-parented at runtime and posed here:
//   • 'free'  — world space; a cutscene positions it (B-CINE's head puppet: the fall, the nudge — C2 7.60–10.6);
//   • 'held'  — hanging by the hair from a hand socket (Harlan's prop_l in C2, her own prop_r in gameplay): a damped
//               pendulum (ω² = g / L with L ≈ 0.17 m fist → head centre: ≈ 58 s⁻², period ≈ 0.83 s; wet-hair damping),
//               excited by the socket's acceleration; the face turned toward her thigh; a sphere (r 0.11 m) pushed out
//               of her right-thigh capsule with restitution 0.3 (no interpenetration);
//   • 'lifted' — raised in both hands to face height, 0.25 m in front of the stump (the brain's eye() is there), the
//               face along her look; blended in/out over the wind-up/lower;
//   • 'placed' — set down on the boards in front of her feet (blind).
// The arm override layer: a world-space two-bone IK (axis-convention-free) that drives the right hand to the hip
// carry point (hanging) or both hands to the sides of the lifted head, blended by the same weight. It runs after the
// sampled clip on every AI clip, so the later clips need no re-authoring.
// Asset gating: until the split GLB lands (A0/A1) there is no `ada_head_rig`; an empty Group stands in so the cues and
// the arm layer run, and the body stays whole (a hollow neck tube is worse than no sever).

import * as THREE from 'three/webgpu';
import type { Capsule3 } from './secondary.ts';
import type { HeadState } from '../ai/types.ts';

export type HeadMode = 'attached' | 'free' | 'held' | 'lifted' | 'placed';

const G = 9.81;
/** Fist → head centre, m: ≈ 5 cm of gripped hair above the scalp + crown → centre ≈ 0.12 m (pendulum length L). */
const ROPE_L = 0.17;
/** Lane A's A0 decision: the `ada_head_rig` ORIGIN is at the crown grip, ≈ 0.12 m above the head centre. */
const ORIGIN_ABOVE_CENTRE = 0.12;
const HEAD_R = 0.11;
const RESTITUTION = 0.3;
/** Lifted: the head centre at 1.48 m, 0.25 m ahead of her (C2-ESCAPE §4.6; TUNING.sight.headAheadM). */
const LIFT = { up: 1.48, ahead: 0.25, handSide: 0.095 } as const;
/** Hanging carry: the right fist at her right hip, ≈ 0.27 m out, 0.78 m up, a little forward. */
const CARRY_HAND = new THREE.Vector3(-0.27, 0.78, 0.04);

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);

/** Rotate `bone` in WORLD space by q (keeps its parent), then refresh its world matrices. */
function rotateWorld(bone: any, q: any, weight: number): void {
  bone.parent.getWorldQuaternion(_pq);
  bone.getWorldQuaternion(_q2);
  const target = _q.copy(q).multiply(_q2); // new world rotation
  const local = _pq.invert().multiply(target);
  if (weight >= 1) bone.quaternion.copy(local);
  else bone.quaternion.slerp(local, weight);
  bone.updateMatrixWorld(true);
}

/**
 * Two-bone IK in world space: rotates `upper` and `lower` so `end` reaches `target`, the elbow bending toward `pole`.
 * Independent of the rig's local axis conventions (setFromUnitVectors on world directions).
 */
export function twoBoneIK(upper: any, lower: any, end: any, target: any, pole: any, weight: number): void {
  if (weight <= 1e-3) return;
  upper.updateWorldMatrix(true, true);
  const A = _a.setFromMatrixPosition(upper.matrixWorld);
  const B = _b.setFromMatrixPosition(lower.matrixWorld);
  const C = _c.setFromMatrixPosition(end.matrixWorld);
  const la = A.distanceTo(B);
  const lb = B.distanceTo(C);
  const toT = _t.subVectors(target, A);
  const dist = Math.max(1e-4, Math.min(la + lb - 1e-4, toT.length()));
  const dir = toT.normalize();
  const cosA = Math.max(-1, Math.min(1, (la * la + dist * dist - lb * lb) / (2 * la * dist)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  const pd = _d.subVectors(pole, A);
  pd.addScaledVector(dir, -pd.dot(dir));
  if (pd.lengthSq() < 1e-8) pd.set(0, -1, 0).addScaledVector(dir, -dir.y);
  pd.normalize();
  const elbow = _p.copy(A).addScaledVector(dir, cosA * la).addScaledVector(pd, sinA * la);
  // upper: current A→B onto A→elbow
  const from = new THREE.Vector3().subVectors(B, A).normalize();
  const to = new THREE.Vector3().subVectors(elbow, A).normalize();
  rotateWorld(upper, new THREE.Quaternion().setFromUnitVectors(from, to), weight);
  // lower: current B→C onto B→target
  const B2 = new THREE.Vector3().setFromMatrixPosition(lower.matrixWorld);
  const C2 = new THREE.Vector3().setFromMatrixPosition(end.matrixWorld);
  const f2 = C2.sub(B2).normalize();
  const t2 = new THREE.Vector3().subVectors(target, B2).normalize();
  rotateWorld(lower, new THREE.Quaternion().setFromUnitVectors(f2, t2), weight);
}

export interface HeadCarryBones {
  head: any | null;
  propR: any | null;
  armR: [any, any, any] | null;
  armL: [any, any, any] | null;
}

export class HeadCarry {
  /** The ada_head_rig node from the GLB, or a stand-in Group (asset not split yet). */
  readonly node: any;
  readonly real: boolean;
  mode: HeadMode = 'attached';
  severed = false;
  /** The socket holding the head in 'held' (her prop_r, or Harlan's prop_l). */
  holder: any | null = null;
  /** 0 = hanging at the hip, 1 = lifted in both hands. */
  lift = 0;
  /** C2 S5–S7 (reviewer fix, CONTRACT-CHANGES): while ANOTHER hand holds it (Harlan's prop_l), he turns the face to
   *  this world point (the camera) — a head held up by the crown hair to be shown. null = the pendulum's own yaw. */
  faceAt: any | null = null;
  readonly bones: HeadCarryBones;
  private readonly restParent: any | null;
  private readonly restPos = new THREE.Vector3();
  private readonly restQuat = new THREE.Quaternion();
  // pendulum state (swing angles about her local X = fore/aft, Z = sideways), rad, rad/s
  private sx = 0;
  private sz = 0;
  private vx = 0;
  private vz = 0;
  private readonly lastGrip = new THREE.Vector3();
  private readonly lastGripVel = new THREE.Vector3();
  private primed = false;
  private readonly placedAt = new THREE.Vector3();
  private placedYaw = 0;
  /** Contact this frame against the thigh at speed (m/s, 0 = none) — for an optional knock cue. */
  contactSpeed = 0;
  /** The right fist closed on the hair: lane A's 1-frame `ada_carry_r` grip layer, finger bones only (the arm is IK). */
  private grip: { bone: any; q: any }[] = [];

  constructor(root: any, bones: HeadCarryBones) {
    this.bones = bones;
    const found = root.getObjectByName('ada_head_rig') ?? null;
    this.real = !!found;
    this.node = found ?? new THREE.Group();
    if (!found) this.node.name = 'ada_head_standin';
    this.restParent = found ? found.parent : bones.head;
    if (found) {
      this.restPos.copy(found.position);
      this.restQuat.copy(found.quaternion);
    } else if (bones.head) bones.head.add(this.node); // follows the head bone until severed
  }

  /**
   * Take the finger rotations of the right hand from lane A's `ada_carry_r` (a 1-frame pose); applied over the clip
   * while she holds the head in her own hand. Arm/shoulder tracks are ignored (the IK layer owns the arm).
   */
  setGrip(clip: any, bones: Map<string, any>): void {
    this.grip = [];
    for (const tr of clip?.tracks ?? []) {
      const [name, prop] = String(tr.name).split('.');
      if (prop !== 'quaternion' || !/_r$/.test(name) || !/(finger|thumb|index|middle|ring|pinky|f_)/i.test(name)) continue;
      const b = bones.get(name);
      if (!b || tr.values.length < 4) continue;
      this.grip.push({ bone: b, q: new THREE.Quaternion(tr.values[0], tr.values[1], tr.values[2], tr.values[3]) });
    }
  }

  /** C2's cut (true) / back to whole (false: a fresh game or a restore before C2). */
  sever(on: boolean, world: any | null): void {
    if (on === this.severed) return;
    this.severed = on;
    if (on) {
      if (world) world.attach(this.node); // keep the world transform: a cutscene takes it from here
      this.mode = 'free';
      this.primed = false;
    } else {
      if (this.restParent) {
        this.restParent.add(this.node);
        this.node.position.copy(this.restPos);
        this.node.quaternion.copy(this.restQuat);
      }
      this.mode = 'attached';
      this.holder = null;
      this.lift = 0;
    }
  }

  /** Hang the head from `socket` (null → free in the world where it is). */
  carryBy(socket: any | null, world: any | null): void {
    if (!this.severed) return;
    if (!socket) {
      if (world && this.node.parent !== world) world.attach(this.node);
      this.mode = 'free';
      this.holder = null;
      return;
    }
    if (world && this.node.parent !== world) world.attach(this.node);
    if (this.holder !== socket) this.primed = false;
    this.holder = socket;
    this.mode = 'held';
  }

  /** Set the head down on the boards in front of her (blind; 'placed'). */
  place(feetWorld: any, yaw: number): void {
    this.placedAt.set(feetWorld.x + Math.sin(yaw) * 0.35, feetWorld.y + HEAD_R, feetWorld.z + Math.cos(yaw) * 0.35);
    this.placedYaw = yaw;
    this.mode = 'placed';
  }

  /**
   * Per frame, after the clip pose is applied (and before the body's chains): the head and the arm layer.
   * `body` = Ada's group (world root, +Z forward), `headState` = the brain's head (null = a cutscene owns her),
   * `thigh` = her right-thigh capsule (world), `lookYaw` = her look relative to her body (rad, +Y).
   */
  update(dt: number, body: any, headState: HeadState | null, thigh: Capsule3 | null, lookYaw: number): void {
    this.contactSpeed = 0;
    if (!this.severed || this.mode === 'attached' || this.mode === 'free') return;
    const yaw = body.rotation.y;
    // lift weight: the wind-up raises it, the lower drops it (≈ the brain's 1–1.2 s wind-up)
    const want = headState === 'lifted' || headState === 'lifting' ? 1 : 0;
    const rate = headState === 'lifting' ? 1.1 : headState === 'lowering' ? 1.6 : 2.5;
    this.lift += Math.sign(want - this.lift) * Math.min(Math.abs(want - this.lift), rate * dt);
    if (headState === 'placed' && this.mode !== 'placed') this.place(body.position, yaw);
    if (headState && headState !== 'placed' && this.mode === 'placed') this.mode = 'held';
    const b = this.bones;
    const w = this.lift * this.lift * (3 - 2 * this.lift); // smoothstep
    // ---- the arm layer (her own hands only: a cutscene's Harlan grip is his clip)
    const ownHand = this.holder && this.holder === b.propR;
    if (ownHand && b.armR && this.mode === 'held') {
      const toWorld = (v: any) => v.applyAxisAngle(_up, yaw).add(body.position);
      const hip = toWorld(new THREE.Vector3().copy(CARRY_HAND));
      const pole = toWorld(new THREE.Vector3(-0.35, 1.0, -0.4)); // elbow back and out
      const centre = toWorld(new THREE.Vector3(0, LIFT.up, LIFT.ahead));
      const handR = new THREE.Vector3().copy(hip).lerp(toWorld(new THREE.Vector3(-LIFT.handSide, LIFT.up - 0.02, LIFT.ahead)), w);
      twoBoneIK(b.armR[0], b.armR[1], b.armR[2], handR, pole, 0.85 + 0.15 * w);
      for (const gp of this.grip) gp.bone.quaternion.copy(gp.q); // the fist closed on the hair
      if (this.grip.length) b.armR[2].updateMatrixWorld(true);
      if (b.armL && w > 0.01) {
        const handL = toWorld(new THREE.Vector3(LIFT.handSide, LIFT.up - 0.02, LIFT.ahead));
        twoBoneIK(b.armL[0], b.armL[1], b.armL[2], handL, toWorld(new THREE.Vector3(0.35, 1.0, -0.4)), w);
      }
      void centre;
    }
    // ---- where the head goes
    if (this.mode === 'placed') {
      this.setWorld(this.placedAt, this.placedYaw, 0, 0); // upright on the cut, face to the planks
      return;
    }
    if (!this.holder) return;
    this.holder.updateWorldMatrix(true, false);
    const grip = _a.setFromMatrixPosition(this.holder.matrixWorld);
    // socket acceleration → pendulum drive (in her frame: fwd = +Z rotated, side = +X rotated)
    if (!this.primed) {
      this.lastGrip.copy(grip);
      this.lastGripVel.set(0, 0, 0);
      this.sx = this.sz = this.vx = this.vz = 0;
      this.primed = true;
    }
    const h = Math.max(1e-3, Math.min(dt, 1 / 30));
    const vel = _b.subVectors(grip, this.lastGrip).divideScalar(h);
    const acc = _c.subVectors(vel, this.lastGripVel).divideScalar(h).clampLength(0, 40);
    this.lastGrip.copy(grip);
    this.lastGripVel.copy(vel);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const aF = acc.x * sy + acc.z * cy;
    const aS = acc.x * cy - acc.z * sy;
    const k = G / ROPE_L; // ω² of a pendulum of length L
    const damp = 1.6; // wet hair + air: a swing dies in ~2 s
    this.vx += (-aF / ROPE_L - k * Math.sin(this.sx) - damp * this.vx) * h;
    this.vz += (aS / ROPE_L - k * Math.sin(this.sz) - damp * this.vz) * h;
    this.sx = Math.max(-1.2, Math.min(1.2, this.sx + this.vx * h));
    this.sz = Math.max(-1.2, Math.min(1.2, this.sz + this.vz * h));
    // hanging centre: straight down the rope, swung by (sx about her X, sz about her Z)
    const hang = _d.set(0, -ROPE_L, 0);
    _e.set(this.sx, 0, -this.sz, 'XYZ');
    hang.applyEuler(_e).applyAxisAngle(_up, yaw);
    const hanging = _p.copy(grip).add(hang);
    // thigh contact (hanging only): push the sphere out of the capsule, reflect the swing (restitution 0.3)
    if (thigh && w < 0.5) {
      const ab = _t.subVectors(thigh.b, thigh.a);
      const u = Math.max(0, Math.min(1, _c.subVectors(hanging, thigh.a).dot(ab) / Math.max(1e-6, ab.lengthSq())));
      const closest = _c.copy(thigh.a).addScaledVector(ab, u);
      const n = new THREE.Vector3().subVectors(hanging, closest);
      const d = n.length();
      const minD = HEAD_R + thigh.r;
      if (d < minD && d > 1e-6) {
        n.divideScalar(d);
        hanging.addScaledVector(n, minD - d);
        this.contactSpeed = Math.hypot(this.vx, this.vz) * ROPE_L;
        this.vx *= -RESTITUTION;
        this.vz *= -RESTITUTION;
      }
    }
    // lifted centre: in front of the stump at face height, turned with her look
    const lifted = _t.set(0, LIFT.up, LIFT.ahead).applyAxisAngle(_up, yaw).add(body.position);
    const centre = hanging.lerp(lifted, w);
    // orientation: hanging = face toward her thigh (yaw + π/2), the swing tilts it; lifted = face along her look
    let faceYaw = yaw + (1 - w) * (Math.PI / 2) + w * lookYaw;
    if (this.faceAt && !ownHand) faceYaw = Math.atan2(this.faceAt.x - centre.x, this.faceAt.z - centre.z);
    this.setWorld(centre, faceYaw, this.sz * (1 - w), this.sx * (1 - w));
  }

  /** Place the node so its HEAD CENTRE is at `centre` (world), yaw about +Y, then roll (Z) / pitch (X). */
  private setWorld(centre: any, yaw: number, roll: number, pitch: number): void {
    const n = this.node;
    _q.setFromEuler(_e.set(pitch, yaw, roll, 'YXZ'));
    // the origin (the crown grip) is ORIGIN_ABOVE_CENTRE above the centre along the head's own up
    const off = _b.set(0, ORIGIN_ABOVE_CENTRE, 0).applyQuaternion(_q);
    const p = _c.copy(centre).add(off);
    if (n.parent) {
      n.parent.updateWorldMatrix(true, false);
      _m.copy(n.parent.matrixWorld).invert();
      p.applyMatrix4(_m);
      n.parent.getWorldQuaternion(_pq);
      _q.premultiply(_pq.invert());
    }
    n.position.copy(p);
    n.quaternion.copy(_q);
    n.updateMatrixWorld(true);
  }
}
