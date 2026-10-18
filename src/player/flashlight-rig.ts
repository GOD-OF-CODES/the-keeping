// Hand-held flashlight rig: src/render/flashlight.ts (cookie spot + shadow, Max beam) parented to a rig that
// FOLLOWS the camera with a little rotational lag and hand sway instead of being welded to it. F toggles it
// (click sound); the lag is critically damped so fast turns sweep the beam behind the view like a real hand.

import * as THREE from 'three/webgpu';
import { createFlashlight, type Flashlight } from '../render/flashlight.ts';
import type { PresetConfig } from '../render/presets.ts';

/** FLASH #146b hand spring: natural frequency 4.5 Hz (a loosely held arm's bounce, the torch's 0.7 kg at the end of a
 *  bent forearm), damping ratio 0.75 (no visible ringing), and an arm's play of at most 2.5 cm. */
const HAND_W = 2 * Math.PI * 4.5;
const HAND_ZETA = 0.75;
const HAND_MAX = 0.025;

export class FlashlightRig {
  readonly rig: any;
  readonly flashlight: Flashlight;
  on = true;
  private readonly camera: any;
  private readonly q = new THREE.Quaternion();
  private readonly sway = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'YXZ');
  private t = Math.random() * 10;
  private primed = false;
  /** Extra tremble 0..1 (the beam trembles near her — driven by the AI/story lanes). */
  tremble = 0;
  /** C2-ESCAPE (C2c glance #1): the torch arm stays forward while the head turns back — the rig keeps its world
   *  orientation (it still follows the eye's position) until released. Set by the cutscene fx `torchHold`. */
  hold = false;
  /**
   * FLASH #146b (the hand): the arm is not welded to the skull. The hand (≈ 0.5 kg glove + 0.7 kg torch on a bent arm)
   * follows the eye through a damped spring: x″ = −ω²(x − eye) − 2ζω(x′ − eye′). Relative to the eye's VELOCITY, so a
   * steady walk or strafe leaves no offset; only the eye's accelerations do — the stride bob (≈ 4 m/s² at 2.2 Hz →
   * ≈ 4 mm of hand lag), starting / stopping (8 m/s² → ≈ 8 mm), crouching, landing. Snapped on cuts / teleports and
   * every frame a cutscene camera snaps the rig. false = the old welded hand (A/B).
   */
  handInertia = true;
  private readonly hx = new THREE.Vector3();
  private readonly hv = new THREE.Vector3();
  private readonly eyePrev = new THREE.Vector3();
  private readonly eyeNow = new THREE.Vector3();
  private readonly ev = new THREE.Vector3();
  private readonly ht = new THREE.Vector3();
  /** QA: the hand's current offset from the eye (m, world). */
  readonly handOffset = new THREE.Vector3();

  constructor(scene: any, camera: any, preset: PresetConfig) {
    this.camera = camera;
    this.rig = new THREE.Object3D();
    this.rig.name = 'flashlight-rig';
    scene.add(this.rig);
    this.flashlight = createFlashlight(this.rig, preset);
    // LIGHTING lane (item 11): the beam-bounce light lives in world space (driven by render/flashlight-bounce.ts)
    if (this.flashlight.bounce) scene.add(this.flashlight.bounce, this.flashlight.bounce.target);
  }

  setOn(v: boolean): void {
    this.on = v;
    this.flashlight.setOn(v);
    // Explicit LightsNodes (lightmapped + probe-lit materials) ignore light.visible: zero the intensity too.
    if (!v) this.flashlight.light.intensity = 0;
  }

  toggle(): boolean {
    this.setOn(!this.on);
    return this.on;
  }

  /** Next update aligns the rig with the camera instantly (teleports, cuts). */
  snap(): void {
    this.primed = false;
  }

  update(dt: number, t: number): void {
    this.t += dt;
    this.camera.updateMatrixWorld();
    this.camera.getWorldQuaternion(this.q);
    const eye = this.eyeNow.setFromMatrixPosition(this.camera.matrixWorld);
    const jump = eye.distanceToSquared(this.eyePrev) > 0.25; // > 0.5 m in one frame: a teleport / cut
    if (!this.primed || !this.handInertia || jump || dt > 0.1) {
      // a cut (snap), a teleport, a hitch or the inertia off: the hand at the eye, moving with it (a jump has no
      // meaningful velocity: at rest)
      this.hx.copy(eye);
      if (!jump && dt > 0 && dt <= 0.1) this.hv.copy(eye).sub(this.eyePrev).divideScalar(dt);
      else this.hv.set(0, 0, 0);
    } else if (dt > 0) {
      this.stepHand(eye, dt);
    }
    this.eyePrev.copy(eye);
    this.handOffset.copy(this.hx).sub(eye);
    this.rig.position.copy(this.hx);
    if (this.hold) {
      // keep the last orientation (sway below is re-applied on top of it: strip last frame's sway first). Cutscene
      // cameras snap() every frame — a held rig ignores that
      this.rig.quaternion.multiply(this.sway.invert());
      this.primed = true;
    } else if (!this.primed) {
      this.rig.quaternion.copy(this.q);
      this.primed = true;
    } else {
      // rotational lag (hand follows the head), ~70 ms time constant
      this.rig.quaternion.slerp(this.q, 1 - Math.exp(-dt * 14));
    }
    // hand sway: slow wander + tremble
    const w = 0.006 + 0.02 * this.tremble;
    this.e.set(
      Math.sin(this.t * 0.9) * 0.004 + Math.sin(this.t * 13.7) * w * 0.3 * this.tremble,
      Math.sin(this.t * 0.63 + 1.1) * 0.005 + Math.sin(this.t * 11.3) * w * 0.3 * this.tremble,
      0,
    );
    this.sway.setFromEuler(this.e);
    this.rig.quaternion.multiply(this.sway);
    this.rig.updateMatrixWorld(true);
    this.flashlight.update(dt, t);
    // FLASH part 2 (V1/V3): the first-person arms are posed earlier in the frame (story-runtime) against LAST frame's rig;
    // now that the rig has followed the eye they re-solve the near-wall aim and re-place the light (FpArms.afterRig)
    this.rig.userData.afterRig?.();
  }

  /** The hand spring (handInertia) over one frame: semi-implicit Euler in ≤ 1/240 s substeps with the eye moving
   *  linearly across the frame (its velocity = this frame's displacement / dt), so the result does not depend on fps. */
  private stepHand(eye: any, dt: number): void {
    const w = HAND_W;
    const z2w = 2 * HAND_ZETA * w;
    const ev = this.ev.copy(eye).sub(this.eyePrev).divideScalar(dt);
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 1; i <= n; i++) {
      // the eye at the start of this substep (symplectic Euler: force at t, then v, then x — exact for a steady walk)
      const e = this.ht.copy(this.eyePrev).addScaledVector(ev, (i - 1) * h);
      const ax = -w * w * (this.hx.x - e.x) - z2w * (this.hv.x - ev.x);
      const ay = -w * w * (this.hx.y - e.y) - z2w * (this.hv.y - ev.y);
      const az = -w * w * (this.hx.z - e.z) - z2w * (this.hv.z - ev.z);
      this.hv.x += ax * h;
      this.hv.y += ay * h;
      this.hv.z += az * h;
      this.hx.addScaledVector(this.hv, h);
    }
    // a hand is on an arm: never more than HAND_MAX from where the clip holds it
    const off = this.ht.copy(this.hx).sub(eye);
    const len = off.length();
    if (len > HAND_MAX) {
      this.hx.copy(eye).addScaledVector(off, HAND_MAX / len);
      this.hv.copy(ev);
    }
  }
}
