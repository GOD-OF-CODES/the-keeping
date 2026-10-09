// Hand-held flashlight rig: src/render/flashlight.ts (cookie spot + shadow, Max beam) parented to a rig that
// FOLLOWS the camera with a little rotational lag and hand sway instead of being welded to it. F toggles it
// (click sound); the lag is critically damped so fast turns sweep the beam behind the view like a real hand.

import * as THREE from 'three/webgpu';
import { createFlashlight, type Flashlight } from '../render/flashlight.ts';
import type { PresetConfig } from '../render/presets.ts';

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
    this.rig.position.setFromMatrixPosition(this.camera.matrixWorld);
    if (!this.primed) {
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
  }
}
