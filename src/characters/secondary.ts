// Secondary motion on top of the (stop-motion sampled) clips:
//   • StopMotion: decides WHEN the mixer is advanced (8–12 fps with random holds) while the root moves every frame.
//   • VerletChain: hair / gown / sack / apron bone chains as verlet particles pinned to the animated chain root,
//     pulled toward the animated pose (stiffness), gravity, damping, optional capsule colliders; the solved points
//     are written back as bone rotations (world-space delta → local).
//   • AngularSpring: a damped 2-axis spring (head loll on the half-cut neck), excited by root acceleration.
// All of these write ON TOP of a pose restored from a PoseCache each frame, so held stop-motion frames never
// compound the offsets.

import * as THREE from 'three/webgpu';

/** Seeded-enough jitter (visual only; not gameplay). */
const rnd = Math.random;

export class StopMotion {
  /** Accumulated animation time not yet given to the mixer. */
  private acc = 0;
  private wait = 0;
  enabled = true;
  minFps = 8;
  maxFps = 12;
  /** Chance a sample is held for an extra interval. */
  holdChance = 0.14;

  /** Returns the dt to feed the mixer this frame (0 = hold the current pose). */
  step(dt: number): number {
    if (!this.enabled) {
      const a = this.acc + dt;
      this.acc = 0;
      return a;
    }
    this.acc += dt;
    this.wait -= dt;
    if (this.wait > 0) return 0;
    const fps = this.minFps + rnd() * (this.maxFps - this.minFps);
    this.wait = (1 / fps) * (rnd() < this.holdChance ? 2 + Math.floor(rnd() * 2) : 1);
    const a = this.acc;
    this.acc = 0;
    return a;
  }

  /** Force the next frame to sample (clip changes, teleports). */
  kick(): void {
    this.wait = 0;
  }
}

export interface Capsule3 {
  a: any; // world Vector3
  b: any;
  r: number;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _o = new THREE.Vector3();
const _c = new THREE.Vector3();

export class VerletChain {
  readonly bones: any[];
  /** Particles: index 0 = first bone origin (pinned), i = bone i origin, last = tip. */
  private readonly p: any[];
  private readonly prev: any[];
  private readonly target: any[];
  private readonly len: number[];
  /** Tip of the last bone in its own local frame (continues the bone's offset direction). */
  private readonly tipLocal: any;
  private primed = false;
  stiffness: number;
  damping: number;
  gravity: number;
  colliders: Capsule3[] = [];

  constructor(bones: any[], o: { stiffness?: number; damping?: number; gravity?: number; tipLength?: number } = {}) {
    this.bones = bones;
    this.stiffness = o.stiffness ?? 0.12;
    this.damping = o.damping ?? 0.9;
    this.gravity = o.gravity ?? 9.81;
    const n = bones.length + 1;
    this.p = Array.from({ length: n }, () => new THREE.Vector3());
    this.prev = Array.from({ length: n }, () => new THREE.Vector3());
    this.target = Array.from({ length: n }, () => new THREE.Vector3());
    // rest lengths from the bind pose (child offsets); the tip continues the last bone
    this.len = [];
    for (let i = 1; i < bones.length; i++) this.len.push(bones[i].position.length());
    this.len.push(o.tipLength ?? this.len[this.len.length - 1] ?? 0.08);
    const last = bones[bones.length - 1];
    const dir = last.position.lengthSq() > 1e-10 ? last.position.clone().normalize() : new THREE.Vector3(0, 1, 0);
    dir.applyQuaternion(last.quaternion.clone().invert());
    this.tipLocal = dir.multiplyScalar(this.len[this.len.length - 1]);
  }

  reset(): void {
    this.primed = false;
  }

  /** Animated (target) joint positions in world space. World matrices of the chain must be current. */
  private sampleTargets(): void {
    const b = this.bones;
    for (let i = 0; i < b.length; i++) this.target[i].setFromMatrixPosition(b[i].matrixWorld);
    this.target[b.length].copy(this.tipLocal).applyMatrix4(b[b.length - 1].matrixWorld);
  }

  update(dt: number): void {
    const b = this.bones;
    if (!b.length) return;
    b[0].parent?.updateWorldMatrix(true, false);
    b[0].updateWorldMatrix(false, true);
    this.sampleTargets();
    const n = this.p.length;
    if (!this.primed || dt <= 0) {
      for (let i = 0; i < n; i++) {
        this.p[i].copy(this.target[i]);
        this.prev[i].copy(this.target[i]);
      }
      this.primed = dt > 0 || this.primed;
      if (dt <= 0) return;
    }
    const h = Math.min(dt, 1 / 30);
    const g = this.gravity * h * h;
    const k = 1 - Math.pow(1 - this.stiffness, h * 60);
    this.p[0].copy(this.target[0]);
    this.prev[0].copy(this.target[0]);
    for (let i = 1; i < n; i++) {
      const p = this.p[i];
      const vel = _v1.subVectors(p, this.prev[i]).multiplyScalar(this.damping);
      this.prev[i].copy(p);
      p.add(vel);
      p.y -= g;
      p.lerp(this.target[i], k);
    }
    // constraints (2 iterations): segment lengths, colliders
    for (let it = 0; it < 2; it++) {
      for (let i = 1; i < n; i++) {
        const a = this.p[i - 1];
        const p = this.p[i];
        const d = _v2.subVectors(p, a);
        const l = d.length() || 1e-6;
        p.copy(a).addScaledVector(d, this.len[i - 1] / l);
        for (const c of this.colliders) pushOutOfCapsule(p, c);
      }
    }
    // write back (FK, root → tip): rotate each bone so its segment points at the solved particle
    for (let i = 0; i < b.length; i++) {
      const bone = b[i];
      const origin = _o.setFromMatrixPosition(bone.matrixWorld);
      const child = i + 1 < b.length ? _c.setFromMatrixPosition(b[i + 1].matrixWorld) : _c.copy(this.tipLocal).applyMatrix4(bone.matrixWorld);
      const from = _v2.subVectors(child, origin);
      const to = _v3.subVectors(this.p[i + 1], origin);
      if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) continue;
      _q1.setFromUnitVectors(from.normalize(), to.normalize()); // world-space delta
      bone.matrixWorld.decompose(_v2, _q2, _v3);
      _q2.premultiply(_q1); // new world rotation
      const parentQ = bone.parent ? bone.parent.getWorldQuaternion(_q3) : _q3.identity();
      bone.quaternion.copy(parentQ.invert().multiply(_q2));
      bone.updateMatrixWorld(true);
    }
  }
}

function pushOutOfCapsule(p: any, c: Capsule3): void {
  const ab = _v2.subVectors(c.b, c.a);
  const t = Math.max(0, Math.min(1, _v3.subVectors(p, c.a).dot(ab) / Math.max(1e-6, ab.lengthSq())));
  const q = _v3.copy(c.a).addScaledVector(ab, t);
  const d = p.distanceTo(q);
  if (d < c.r && d > 1e-6) p.sub(q).multiplyScalar(c.r / d).add(q);
}

/** 2-axis damped angular spring (radians): x = pitch (flexion), z = roll. */
export class AngularSpring {
  x = 0;
  z = 0;
  private vx = 0;
  private vz = 0;
  stiffness: number;
  damping: number;
  constructor(stiffness = 38, damping = 5.5) {
    this.stiffness = stiffness;
    this.damping = damping;
  }
  /** ax/az: angular acceleration impulses (rad/s²) from the root motion. */
  update(dt: number, ax: number, az: number, limit = 0.5): void {
    const h = Math.min(dt, 1 / 30);
    this.vx += (ax - this.stiffness * this.x - this.damping * this.vx) * h;
    this.vz += (az - this.stiffness * this.z - this.damping * this.vz) * h;
    this.x = Math.max(-limit, Math.min(limit, this.x + this.vx * h));
    this.z = Math.max(-limit, Math.min(limit, this.z + this.vz * h));
  }
}
