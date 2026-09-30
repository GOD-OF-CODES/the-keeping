// First-person arms (docs/CHARACTERS.md "First-person arms conventions"): the arms rig's root is the eye, so the
// GLB hangs at identity under the lagging flashlight rig (src/player/flashlight-rig.ts) — arms and beam sway
// together. Every frame the SpotLight (+ its target and the Max beam cone) is moved to the `flashlight_beam` bone:
// the beam leaves the lens in the left hand. Clips: idle loop, one-shots (knock, bell pull, door rattle, toggle,
// hide push, freeze) crossfaded back to idle, breath-hold loop while Space is held.

import * as THREE from 'three/webgpu';
import type { LoadedCharacter } from './loader.ts';

const ONE_SHOTS = new Set(['arms_flashlight_toggle', 'arms_knock', 'arms_bell_pull', 'arms_door_rattle', 'arms_freeze', 'arms_hide_push', 'arms_key', 'arms_pickup_read', 'arms_pry_board', 'arms_cut_hem', 'arms_raise_locket', 'arms_slide_bolt', 'arms_pour_can']);

export class FpArms {
  readonly c: LoadedCharacter;
  readonly mixer: any;
  private readonly actions = new Map<string, any>();
  private base = 'arms_idle';
  private oneShot: any = null;
  private readonly beamBone: any;
  /** Beam axis in the bone's local frame (found at load: the axis that points forward in the idle pose). */
  private readonly beamAxis = new THREE.Vector3(0, 1, 0);
  private readonly parent: any;
  private readonly _p = new THREE.Vector3();
  private readonly _d = new THREE.Vector3();
  private readonly _m = new THREE.Matrix4();
  private readonly _q = new THREE.Quaternion();

  constructor(c: LoadedCharacter, parent: any) {
    this.c = c;
    this.parent = parent;
    for (const m of c.meshes) {
      m.castShadow = false; // the light sits inside the flashlight body
      m.receiveShadow = false;
      m.renderOrder = 5;
    }
    parent.add(c.root);
    this.mixer = new THREE.AnimationMixer(c.root);
    this.mixer.addEventListener('finished', (e: any) => {
      if (e.action === this.oneShot) this.endOneShot();
    });
    this.beamBone = c.bones.get('flashlight_beam') ?? null;
    this.loop('arms_idle', 0);
    this.mixer.update(0.5);
    // Which local axis of flashlight_beam points forward (rig −Z) in the idle pose? (CHARACTERS.md: +Y in Blender)
    if (this.beamBone) {
      c.root.updateMatrixWorld(true);
      const q = new THREE.Quaternion();
      this.relMatrix(this._m).decompose(this._p, q, this._d);
      const fwd = new THREE.Vector3(0, 0, -1);
      let best = -2;
      for (const ax of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ] as const) {
        const v = new THREE.Vector3(...ax).applyQuaternion(q);
        const d = v.dot(fwd);
        if (d > best) {
          best = d;
          this.beamAxis.set(...ax);
        }
      }
    }
  }

  get visible(): boolean {
    return this.c.root.visible;
  }

  set visible(v: boolean) {
    this.c.root.visible = v;
  }

  private action(clip: string): any {
    let a = this.actions.get(clip);
    if (a) return a;
    const c = this.c.clips.get(clip);
    if (!c) return null;
    a = this.mixer.clipAction(c);
    this.actions.set(clip, a);
    return a;
  }

  /** Base loop (idle / breath hold / wheel). */
  loop(clip: string, fade = 0.35): void {
    const a = this.action(clip);
    if (!a) return;
    const prev = this.action(this.base);
    this.base = clip;
    if (this.oneShot) return; // resumes after the one-shot
    a.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    if (prev && prev !== a && fade > 0) prev.crossFadeTo(a, fade, false);
    else if (prev && prev !== a) prev.stop();
  }

  /** One-shot clip over the base loop. */
  play(clip: string, fade = 0.15): void {
    const a = this.action(clip);
    if (!a) return;
    const from = this.oneShot ?? this.action(this.base);
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.play();
    if (from && from !== a) from.crossFadeTo(a, fade, false);
    this.oneShot = a;
    void ONE_SHOTS;
  }

  /** Does the GLB have this clip (M2 clips arrive with the character lane's rebuild)? */
  has(clip: string): boolean {
    return this.c.clips.has(clip);
  }

  /** Abort the current one-shot (a hold interaction released early) and blend back to the base loop. */
  cancelOneShot(): void {
    if (this.oneShot) this.endOneShot();
  }

  private endOneShot(): void {
    const from = this.oneShot;
    this.oneShot = null;
    const b = this.action(this.base);
    if (!b) return;
    b.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    if (from) from.crossFadeTo(b, 0.3, false);
  }

  /** Beam-bone transform relative to the parent (the flashlight rig). */
  private relMatrix(out: any): any {
    this.parent.updateWorldMatrix(true, false);
    this.beamBone.updateWorldMatrix(true, false);
    return out.copy(this.parent.matrixWorld).invert().multiply(this.beamBone.matrixWorld);
  }

  /**
   * Advance the clips and put the light at the lens. `light`/`target`/`beam` are children of the same parent
   * (the flashlight rig).
   */
  update(dt: number, light: any, beam: any | null, on = true, level = 1): void {
    this.mixer.update(dt);
    this.c.lensGlow.value = on ? level : 0;
    if (!this.beamBone || !light) return;
    this.c.root.updateMatrixWorld(true);
    this.relMatrix(this._m).decompose(this._p, this._q, this._d);
    const dir = this._d.copy(this.beamAxis).applyQuaternion(this._q).normalize();
    light.position.copy(this._p);
    light.target.position.copy(this._p).addScaledVector(dir, 3);
    if (beam) {
      // Object3D.lookAt works in WORLD space (and aims +Z, the cone's open end)
      beam.position.copy(this._p);
      beam.updateMatrixWorld();
      beam.lookAt(this.parent.localToWorld(this._d.copy(light.target.position)));
    }
  }
}
