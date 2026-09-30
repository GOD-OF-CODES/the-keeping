// Ada at runtime (docs/CHARACTERS.md, docs/AI.md): driven every tick by the Director's AdaOutput (PLAN space).
//   • root: planToWorld(out.pos) every frame (smooth), heading out.facing (glTF forward +Z ⇒ rotation.y = facing + π/2);
//   • pose: AdaAnim → clip with crossfades, SAMPLED stop-motion style (8–12 fps with random holds) while the root
//     glides — the stutter is in the body, never in the travel;
//   • LOOK: one `ada_look` action driven by segment (wind-up 0 → 1.2 s scaled to the brain's wind-up, sight 1.2 → 4.1
//     held, lower 4.2 → 5.0); when her head is lifted the neck turns toward out.lookYaw;
//   • neck spring (head loll on the half-cut neck) excited by root acceleration; hair + gown verlet chains (gown
//     collides with thigh/calf capsules); jaw_open/gurgle morphs on the gurgle tell;
//   • `override()` lets the cutscene lane (and the pre-C2 tableau) play any clip at a world pose; `release()` hands
//     her back to the AI.

import * as THREE from 'three/webgpu';
import type { AdaAnim, AdaOutput } from '../ai/types.ts';
import { planToWorld } from '../shared/coords.ts';
import { PoseCache, type LoadedCharacter } from './loader.ts';
import { AngularSpring, StopMotion, VerletChain, type Capsule3 } from './secondary.ts';

/** Clip for an AdaAnim (vertical velocity picks the stair direction). */
export function adaClipFor(anim: AdaAnim, velZ = 0): string | null {
  switch (anim) {
    case 'hidden':
      return null;
    case 'walk':
    case 'door_push':
    case 'finale_approach':
    case 'finale_carry':
      return 'ada_patrol';
    case 'stairs':
      return velZ < 0 ? 'ada_stairs_down' : 'ada_stairs_up';
    case 'chase_run':
      return 'ada_chase';
    case 'look_windup':
    case 'look_hold':
    case 'look_lower':
    case 'finale_look':
    case 'finale_take':
      return 'ada_look';
    case 'vigil_scrape':
    case 'lured_scrape':
    case 'search_plaster':
    case 'dress_hem':
      return 'ada_vigil';
    case 'hide_check':
      return 'ada_hide_check';
    case 'hide_tear_open':
      return 'ada_hide_tear';
    case 'catch_grab':
      return 'ada_catch';
    case 'listen':
    case 'idle':
    default:
      return 'ada_listen';
  }
}

const ONCE = new Set(['ada_listen', 'ada_look', 'ada_hide_check', 'ada_hide_tear', 'ada_catch', 'ada_rise', 'ada_opening']);
const CLIP_SPEED: Record<string, number> = { ada_patrol: 0.9, ada_chase: 3.2, ada_stairs_up: 0.35, ada_stairs_down: 0.35 };
const LOOK = { windupEnd: 1.2, holdEnd: 4.1, lowerStart: 4.2 } as const;

export interface AdaOverride {
  clip: string;
  /** World feet position + yaw (rotation.y). */
  pos: [number, number, number];
  yaw: number;
  time?: number;
  loop?: boolean;
  timeScale?: number;
  /** false = smooth playback (cutscenes may prefer it); default stop-motion. */
  stopMotion?: boolean;
  /** Crossfade seconds from the current clip (default 0.25; the first override snaps). */
  fade?: number;
}

export class AdaCharacter {
  readonly group: any;
  readonly c: LoadedCharacter;
  readonly mixer: any;
  /** Room visibility gate (level culling). */
  roomVisible: (room: string) => boolean = () => true;
  /** Cutscene visibility override (null = automatic). */
  forceVisible: boolean | null = null;
  private readonly actions = new Map<string, any>();
  private current: any = null;
  private currentClip: string | null = null;
  private readonly stop = new StopMotion();
  private readonly cache: PoseCache;
  private readonly chains: VerletChain[] = [];
  private readonly legCaps: Capsule3[] = [];
  private readonly spring = new AngularSpring(34, 4.2);
  private readonly bones: Map<string, any>;
  private out: AdaOutput | null = null;
  private ov: AdaOverride | null = null;
  private lastAnim: AdaAnim | null = null;
  private readonly lastPos = new THREE.Vector3();
  private readonly lastVel = new THREE.Vector3();
  private primed = false;
  private yaw = 0;
  private gurgle = 0;
  private headYaw = 0;
  private readonly morphMeshes: any[] = [];

  constructor(c: LoadedCharacter) {
    this.c = c;
    this.bones = c.bones;
    this.group = new THREE.Group();
    this.group.name = 'ada';
    this.group.add(c.root);
    this.group.visible = false;
    this.mixer = new THREE.AnimationMixer(c.root);
    for (const m of c.meshes) if (m.morphTargetDictionary && 'gurgle' in m.morphTargetDictionary) this.morphMeshes.push(m);
    // secondary chains
    const chain = (prefix: string, n: number) => {
      const list: any[] = [];
      for (let i = 1; i <= n; i++) {
        const b = this.bones.get(`${prefix}_0${i}`);
        if (b) list.push(b);
      }
      return list;
    };
    const cached: any[] = [];
    for (let g = 0; g < 8; g++) {
      const hb = chain(`hair_${g}`, 4);
      if (hb.length) {
        this.chains.push(new VerletChain(hb, { stiffness: 0.16, damping: 0.86 }));
        cached.push(...hb);
      }
      const gb = chain(`gown_${g}`, 3);
      if (gb.length) {
        const vc = new VerletChain(gb, { stiffness: 0.3, damping: 0.8 });
        vc.colliders = this.legCaps;
        this.chains.push(vc);
        cached.push(...gb);
      }
    }
    for (const s of ['l', 'r']) {
      this.legCaps.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.095 }, { a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.07 });
      void s;
    }
    for (const n of ['neck_01', 'neck_02', 'head']) {
      const b = this.bones.get(n);
      if (b) cached.push(b);
    }
    this.cache = new PoseCache(cached);
  }

  /** Per-tick AI output (Director host.ada). */
  apply(out: AdaOutput): void {
    this.out = out;
    if (out.tells.gurgle) this.gurgle = 1;
  }

  /** Cutscenes / tableau: play `clip` at a world pose until release(). */
  override(o: AdaOverride): void {
    const first = !this.ov;
    const same = this.ov?.clip === o.clip;
    this.ov = o;
    this.play(o.clip, first ? 0.0 : same ? 0 : (o.fade ?? 0.25), o.loop ?? !ONCE.has(o.clip));
    const a = this.actions.get(o.clip);
    if (a) {
      if (o.time !== undefined) a.time = o.time;
      a.timeScale = o.timeScale ?? 1;
    }
    this.group.position.set(...o.pos);
    this.yaw = o.yaw;
    this.group.rotation.y = o.yaw;
    this.stop.enabled = o.stopMotion ?? true;
    this.stop.kick();
    this.primed = false;
  }

  /** Move an overridden Ada without touching her clip. */
  moveOverride(pos: [number, number, number], yaw: number): void {
    if (!this.ov) return;
    this.ov.pos = pos;
    this.ov.yaw = yaw;
    this.group.position.set(...pos);
    this.yaw = yaw;
    this.group.rotation.y = yaw;
  }

  release(): void {
    this.ov = null;
    this.stop.enabled = true;
    this.lastAnim = null;
    this.primed = false;
  }

  get overridden(): boolean {
    return !!this.ov;
  }

  /** World position of her head (for camera framing / tests). */
  headWorld(target = new THREE.Vector3()): any {
    const h = this.bones.get('head');
    return h ? h.getWorldPosition(target) : target.copy(this.group.position).setY(this.group.position.y + 1.4);
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

  private play(clip: string, fade: number, loop: boolean): any {
    const a = this.action(clip);
    if (!a) return null;
    if (this.currentClip === clip && this.current === a) return a;
    a.reset();
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = !loop;
    a.enabled = true;
    a.setEffectiveWeight(1);
    if (this.current && fade > 0) {
      a.play();
      this.current.crossFadeTo(a, fade, false);
    } else {
      if (this.current) this.current.stop();
      a.play();
    }
    this.current = a;
    this.currentClip = clip;
    this.stop.kick();
    return a;
  }

  update(dt: number): void {
    const out = this.out;
    const ov = this.ov;
    // ---- visibility + root
    if (ov) {
      this.group.visible = this.forceVisible ?? true;
    } else if (!out || !out.visible) {
      this.group.visible = false;
      this.primed = false;
      return;
    } else {
      this.group.visible = this.roomVisible(out.room);
      const w = planToWorld(out.pos);
      const g = this.group.position;
      const jump = !this.primed || (g.x - w[0]) ** 2 + (g.y - w[1]) ** 2 + (g.z - w[2]) ** 2 > 1.5 * 1.5;
      if (jump) {
        g.set(w[0], w[1], w[2]);
        this.yaw = out.facing + Math.PI / 2;
        this.chains.forEach((c) => c.reset());
      } else {
        g.set(w[0], w[1], w[2]);
        const want = out.facing + Math.PI / 2;
        let d = want - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        const maxTurn = (out.state === 'CHASE' ? 7 : 4) * dt;
        this.yaw += Math.max(-maxTurn, Math.min(maxTurn, d));
      }
      this.group.rotation.y = this.yaw;
      this.selectAnim(out);
    }
    // ---- root acceleration → neck spring impulse (local frame)
    const pos = this.group.position;
    if (!this.primed || dt <= 0) {
      this.lastPos.copy(pos);
      this.lastVel.set(0, 0, 0);
    }
    const vel = new THREE.Vector3().subVectors(pos, this.lastPos).divideScalar(Math.max(dt, 1e-3));
    const acc = new THREE.Vector3().subVectors(vel, this.lastVel).divideScalar(Math.max(dt, 1e-3));
    this.lastPos.copy(pos);
    this.lastVel.copy(vel);
    acc.clampLength(0, 30);
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const accFwd = acc.x * sy + acc.z * cy; // along her forward (+Z rotated)
    const accSide = acc.x * cy - acc.z * sy;

    // ---- pose sampling (stop-motion)
    const step = dt > 0 ? this.stop.step(dt) : 0;
    if (step > 0 || !this.primed) {
      this.mixer.update(step);
      this.c.root.updateMatrixWorld(true);
      this.cache.capture();
    } else this.cache.restore();

    // ---- head: lifted → turn toward lookYaw; hanging → spring loll
    const headState = ov ? 'hanging' : (out?.head ?? 'hanging');
    const lifted = headState === 'lifted' || headState === 'lifting';
    let wantHeadYaw = 0;
    if (lifted && out) {
      let d = out.lookYaw + Math.PI / 2 - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      wantHeadYaw = Math.max(-0.9, Math.min(0.9, d));
    }
    this.headYaw += (wantHeadYaw - this.headYaw) * Math.min(1, dt * 5);
    this.spring.update(dt, -accFwd * 1.6, accSide * 1.6, lifted ? 0.12 : 0.5);
    const neck = this.bones.get('neck_02');
    const head = this.bones.get('head');
    const neck1 = this.bones.get('neck_01');
    const k = lifted ? 0.3 : 1;
    if (neck1 && Math.abs(this.headYaw) > 1e-3) rotateLocal(neck1, 'y', this.headYaw * 0.5);
    if (neck) {
      rotateLocal(neck, 'x', this.spring.x * 0.5 * k);
      rotateLocal(neck, 'z', this.spring.z * 0.5 * k);
    }
    if (head) {
      rotateLocal(head, 'x', this.spring.x * 0.5 * k);
      rotateLocal(head, 'z', this.spring.z * 0.5 * k);
      if (Math.abs(this.headYaw) > 1e-3) rotateLocal(head, 'y', this.headYaw * 0.5);
    }
    this.c.root.updateMatrixWorld(true);

    // ---- chains (gown collides with the legs)
    this.updateLegCaps();
    const cdt = this.primed ? dt : 0;
    for (const ch of this.chains) ch.update(cdt);

    // ---- morphs
    this.gurgle = Math.max(0, this.gurgle - dt / 0.9);
    const g = Math.sin(Math.min(1, 1 - this.gurgle) * Math.PI) * (this.gurgle > 0 ? 1 : 0);
    const jaw = (lifted ? 0.25 : 0.08) + g * 0.35;
    for (const m of this.morphMeshes) {
      const d = m.morphTargetDictionary;
      if (m.morphTargetInfluences) {
        if ('gurgle' in d) m.morphTargetInfluences[d.gurgle] = g;
        if ('jaw_open' in d) m.morphTargetInfluences[d.jaw_open] = jaw;
      }
    }
    this.primed = true;
  }

  private selectAnim(out: AdaOutput): void {
    const anim = out.anim;
    const clip = adaClipFor(anim, out.vel[2]);
    if (!clip) return;
    const loop = !ONCE.has(clip);
    const changed = anim !== this.lastAnim;
    const a = this.play(clip, 0.22, loop);
    if (!a) return;
    // travel clips follow her speed
    const nominal = CLIP_SPEED[clip];
    if (nominal) a.timeScale = Math.max(0.35, Math.min(2.2, out.speed / nominal || 1));
    else if (clip !== 'ada_look') a.timeScale = 1;
    if (clip === 'ada_look') {
      if (anim === 'look_windup') {
        if (changed) a.time = 0;
        a.timeScale = LOOK.windupEnd / Math.max(0.3, out.tells.lookWindup || 1.2);
        if (a.time > LOOK.windupEnd) a.timeScale = 0;
      } else if (anim === 'look_hold' || anim === 'finale_look' || anim === 'finale_take') {
        if (changed && a.time < LOOK.windupEnd) a.time = LOOK.windupEnd;
        a.timeScale = a.time >= LOOK.holdEnd ? 0 : 1;
      } else if (anim === 'look_lower') {
        if (changed && a.time < LOOK.lowerStart) a.time = LOOK.lowerStart;
        a.timeScale = 1;
      }
      a.paused = false;
    }
    this.lastAnim = anim;
  }

  private updateLegCaps(): void {
    const pairs: [string, string, string][] = [
      ['thigh_l', 'calf_l', 'foot_l'],
      ['thigh_r', 'calf_r', 'foot_r'],
    ];
    let i = 0;
    for (const [t, c, f] of pairs) {
      const bt = this.bones.get(t);
      const bc = this.bones.get(c);
      const bf = this.bones.get(f);
      if (!bt || !bc || !bf) {
        i += 2;
        continue;
      }
      this.legCaps[i].a.setFromMatrixPosition(bt.matrixWorld);
      this.legCaps[i].b.setFromMatrixPosition(bc.matrixWorld);
      this.legCaps[i + 1].a.setFromMatrixPosition(bc.matrixWorld);
      this.legCaps[i + 1].b.setFromMatrixPosition(bf.matrixWorld);
      i += 2;
    }
  }
}

const _q = new THREE.Quaternion();
const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) } as const;

/** bone.quaternion *= rotation(axis, angle) (local frame). */
export function rotateLocal(bone: any, axis: 'x' | 'y' | 'z', angle: number): void {
  if (!angle) return;
  _q.setFromAxisAngle(AX[axis], angle);
  bone.quaternion.multiply(_q);
}
