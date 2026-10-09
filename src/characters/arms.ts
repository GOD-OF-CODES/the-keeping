// First-person arms (docs/CHARACTERS.md "First-person arms conventions"): the arms rig's root is the eye, so the
// GLB hangs at identity under the lagging flashlight rig (src/player/flashlight-rig.ts) — arms and beam sway
// together. Every frame the SpotLight (+ its target and the Max beam cone) is moved to the `flashlight_beam` bone:
// the beam leaves the lens in the left hand. Clips: idle loop, one-shots (knock, bell pull, door rattle, toggle,
// hide push, freeze) crossfaded back to idle, breath-hold loop while Space is held.

import * as THREE from 'three/webgpu';
import { float, mix, normalView, normalWorld, positionViewDirection, reflectVector, roughness, smoothstep, vec3 } from 'three/tsl';
import type { LoadedCharacter } from './loader.ts';
import { TORCH_POOL, torchPoolRadiance } from '../render/flashlight-bounce.ts';
import { SKY_U, skyIrradiance, skyRadiance } from '../world/atmosphere.ts';

/**
 * Round 3 (R2-3): the arms' own environment. They rendered as black cut-outs in every torch view: the barrel is
 * metal and the glove/snaps glossy, but nothing gave them anything to reflect, and the hand's back faces away from
 * the bounce spot. Radiance = the torch's lit pool (render/flashlight-bounce.ts TORCH_POOL) + outdoors the overcast
 * sky along the lobe's dominant direction; irradiance = the analytic sky once the camera is beyond the exterior probe
 * grid (inside it the grid lights them, as before), plus indoors the torch's interreflected fill (TORCH_POOL.fill). Candles / lamps / probes stay in the LightsNode (story-runtime).
 */
class ArmsEnvNode extends (THREE as any).LightingNode {
  /** runtime lane E (item 6): an environment-only sheen for the glove leather where the Charlie lobe is off (Medium). */
  sheen = false;
  setup(builder: any): void {
    const ctx = builder.context;
    const a2 = roughness.mul(roughness);
    const d = mix(reflectVector, normalWorld, a2).normalize();
    const w = roughness.mul(0.35).add(0.03);
    const sky = mix(SKY_U.ground, skyRadiance(d), smoothstep(w.negate(), w, d.y)).mul(SKY_U.outside);
    // the room's interreflected field is (near) isotropic: it lights the diffuse (E) AND is what the glossy leather /
    // snaps / barrel reflect wherever the pool isn't in their lobe (L = E/π) — the worn edges' sheen in torch views
    const fill = TORCH_POOL.fill.mul(TORCH_POOL.gain).mul(SKY_U.outside.oneMinus());
    const env = torchPoolRadiance().add(sky).add(fill.mul(1 / Math.PI));
    ctx.radiance.addAssign(env);
    ctx.irradiance.addAssign(skyIrradiance(normalWorld).mul(SKY_U.beyondGrid).add(fill));
    if (this.sheen && ctx.reflectedLight) {
      // napped / oiled hide back-scatters at grazing angles (the Charlie sheen of Max, sheenColor 0.16/0.14/0.12,
      // roughness 0.5): its directional albedo rises ≈ (1 − n·v)³ toward the silhouette. Environment only — no
      // per-light cost — lit by what the leather sees: the torch pool, the room's fill, the sky. Creases and worn
      // knuckles (normal map) catch it, so the glove's form reads against the dark instead of a flat blob.
      const nv = normalView.dot(positionViewDirection).abs().clamp(0, 1);
      const rim = float(1).sub(nv).pow(3);
      ctx.reflectedLight.indirectSpecular.addAssign(vec3(0.16, 0.14, 0.12).mul(env.add(fill.mul(1 / Math.PI))).mul(rim));
    }
  }
}

const ONE_SHOTS = new Set(['arms_flashlight_toggle', 'arms_knock', 'arms_bell_pull', 'arms_door_rattle', 'arms_freeze', 'arms_hide_push', 'arms_key', 'arms_pickup_read', 'arms_pry_board', 'arms_cut_hem', 'arms_raise_locket', 'arms_slide_bolt', 'arms_pour_can']);

/** C2-ESCAPE review: while on (C2c's climb, cue fx `beamClamp`; cleared when a cutscene releases the camera) the beam
 *  is held within BEAM_MAX of the gaze. Gameplay is unchanged (off). */
export const BEAM_CLAMP = { on: false };
/** Max angle between the beam and the gaze (rig −Z): 12° (r3: 20° left glance #2 her hand outside the beam). */
const BEAM_MAX_COS = Math.cos((12 * Math.PI) / 180);
const BEAM_MAX_SIN = Math.sin((12 * Math.PI) / 180);

export class FpArms {
  readonly c: LoadedCharacter;
  /** The uniforms of the arms' environment (ArmsEnvNode), for the ?debug console. */
  readonly env = { pool: TORCH_POOL, sky: SKY_U };
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
  private readonly _p2 = new THREE.Vector3();
  /** True when the clip's torch bone pointed > 12° off the gaze this frame (debug). */
  beamClamped = false;

  constructor(c: LoadedCharacter, parent: any) {
    this.c = c;
    this.parent = parent;
    for (const m of c.meshes) {
      m.castShadow = false; // the light sits inside the flashlight body
      m.receiveShadow = false;
      m.renderOrder = 5;
    }
    for (const m of c.materials) {
      if (m.isMeshBasicNodeMaterial) continue;
      const glove = String(m.userData?.material_id) === 'leather_worn' && !(m.sheen > 0);
      m.setupEnvironment = () => {
        const n = new ArmsEnvNode();
        n.sheen = glove;
        return n;
      };
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

  private anchor: any = null;

  /**
   * Review fix (C1 driver POV): the car clips (arms_wheel, knob, stalk, radio, map) are authored in the eye frame of
   * blender/anim/clips_arms.py — car − EYE with the CAR's axes. Riding the camera rig, the gloves turned with every
   * head turn (radio glance, dome knob, passenger seat, visor, the 48 sign) and left the rim: at C1 20 the right glove
   * sat on the horn pad and the left hung off the column. With `obj` (the mounted interior, local = car space as
   * (x, z, −y)) the root is fixed at the driver's eye in the car frame, so the hands stay on the wheel while the head
   * turns, as a driver's do. null = back on the rig (walking play).
   */
  anchorTo(obj: any | null, eye: readonly [number, number, number] = [0, 0, 0]): void {
    const root = this.c.root;
    if (obj === this.anchor) return;
    this.anchor = obj;
    if (obj) {
      obj.add(root);
      root.position.set(eye[0], eye[2], -eye[1]);
      root.quaternion.identity();
    } else {
      this.parent.add(root);
      root.position.set(0, 0, 0);
      root.quaternion.identity();
    }
    root.updateMatrixWorld(true);
  }

  private lightSets: { house: Map<any, any>; car: Map<any, any> } | null = null;
  private carLights = false;

  /**
   * runtime lane E (item 3): two FIXED material sets — one per LightsNode — instead of switching material.lightsNode
   * (+ needsUpdate) at the car mount. The switch rebuilt all 7 arm shaders at C0's first live cut (12.5 s: 0.17 s
   * Medium / 0.42 s Max, scratch/re/cut3). A render object is keyed by its material, so with a set per light list both
   * are built once (the load warm-up draws both) and the mount only swaps mesh.material.
   */
  setLightSets(house: any, car: any): void {
    const hm = new Map<any, any>();
    const cm = new Map<any, any>();
    for (const m of this.c.materials) {
      m.lightsNode = house;
      const alt = m.clone();
      // instance overrides (setupEnvironment, lighting model hooks) are not part of Material.copy
      for (const k of Object.keys(m)) if (typeof m[k] === 'function') alt[k] = m[k];
      alt.userData = m.userData;
      alt.lightsNode = car;
      hm.set(alt, m);
      cm.set(m, alt);
    }
    this.lightSets = { house: hm, car: cm };
    this.carLights = false;
  }

  /** Swaps every arm mesh to the car-light (true) or house-light (false) material set. */
  useCarLights(on: boolean): void {
    if (!this.lightSets || on === this.carLights) return;
    this.carLights = on;
    const map = on ? this.lightSets.car : this.lightSets.house;
    for (const mesh of this.c.meshes) {
      const next = map.get(mesh.material);
      if (next) mesh.material = next;
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
    // C2-ESCAPE review: a torch held while running/stumbling still points within ≈ 12° of where the eyes go (you light
    // where you look). arms_run_torch's bone aimed the beam off the flight (and its lens glow at the camera): the
    // climb rendered black. While BEAM_CLAMP.on (C2c) the beam is clamped to a 12° cone around the rig's forward (−Z).
    // The real fix is lane A's arms_run_torch beam bone (requested); this keeps C2c lit until then.
    const cosDev = -dir.z; // dot(dir, (0, 0, −1))
    if (BEAM_CLAMP.on && cosDev < BEAM_MAX_COS) {
      const ortho = this._p2.set(dir.x, dir.y, 0);
      if (ortho.lengthSq() < 1e-8) ortho.set(0, -1, 0);
      ortho.normalize();
      dir.set(ortho.x * BEAM_MAX_SIN, ortho.y * BEAM_MAX_SIN, -BEAM_MAX_COS);
      this.beamClamped = true;
    } else this.beamClamped = false;
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
