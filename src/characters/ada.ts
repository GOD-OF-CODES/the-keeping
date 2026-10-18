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

import { ContactShadow, uHairVeilClear, uHeadSmear, uNeckBlood } from './skin.ts';
import * as THREE from 'three/webgpu';
import type { AdaAnim, AdaOutput } from '../ai/types.ts';
import { planToWorld } from '../shared/coords.ts';
import { PoseCache, type LoadedCharacter } from './loader.ts';
import { AngularSpring, StopMotion, VerletChain, type Capsule3 } from './secondary.ts';
import { HeadCarry } from './head-carry.ts';
import { SAWBUCK_TOP, SEAM_RIM, TABLE_LIFT, TABLE_ROOT, tableLiftWeight } from './ada-table-pose.ts';

/**
 * Clip preferences per AdaAnim: M2 clips first (picked up automatically once the GLB has them), then the M1 clip
 * that stands in for them. `has` = does the loaded GLB contain the clip (omitted → the M1 fallback).
 */
const CLIP_PREFS: Partial<Record<AdaAnim, readonly string[]>> = {
  walk: ['ada_patrol'],
  door_push: ['ada_door_push', 'ada_patrol'],
  finale_approach: ['ada_finale_approach', 'ada_patrol'],
  finale_carry: ['ada_finale_carry', 'ada_patrol'],
  chase_run: ['ada_chase'],
  look_windup: ['ada_look'],
  look_hold: ['ada_look'],
  look_lower: ['ada_look'],
  finale_look: ['ada_look'],
  finale_take: ['ada_finale_take', 'ada_look'],
  vigil_scrape: ['ada_vigil'],
  lured_scrape: ['ada_vigil'],
  search_plaster: ['ada_search', 'ada_vigil'],
  search_bed: ['ada_search_bed', 'ada_search', 'ada_vigil'],
  dress_hem: ['ada_dress', 'ada_vigil'],
  hide_check: ['ada_hide_check'],
  hide_tear_open: ['ada_hide_tear'],
  catch_grab: ['ada_catch'],
};

/** Clip for an AdaAnim (vertical velocity picks the stair direction). */
export function adaClipFor(anim: AdaAnim, velZ = 0, has?: (clip: string) => boolean): string | null {
  if (anim === 'hidden') return null;
  if (anim === 'stairs') return velZ < 0 ? 'ada_stairs_down' : 'ada_stairs_up';
  const prefs = CLIP_PREFS[anim] ?? ['ada_listen'];
  if (has) for (const c of prefs) if (has(c)) return c;
  return prefs[prefs.length - 1];
}

const ONCE = new Set(['ada_search_bed', 'ada_listen', 'ada_look', 'ada_hide_check', 'ada_hide_tear', 'ada_catch', 'ada_rise', 'ada_opening', 'ada_finale_take', 'ada_finale', 'ada_sting', 'ada_dress']);
const CLIP_SPEED: Record<string, number> = { ada_patrol: 0.9, ada_chase: 3.2, ada_stairs_up: 0.35, ada_stairs_down: 0.35, ada_finale_approach: 0.8, ada_finale_carry: 0.9, ada_door_push: 0.9 };
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
  private readonly hairChains: VerletChain[] = [];
  /** M-A: the severed head has lain loose in its pool (the face smear stays while severed). */
  private smeared = false;
  /** The hair chain parted off the open eye (S6), or null. */
  private partedChain: VerletChain | null = null;
  private readonly legCaps: Capsule3[] = [];
  private readonly spring = new AngularSpring(34, 4.2);
  private readonly bones: Map<string, any>;
  private out: AdaOutput | null = null;
  private ov: AdaOverride | null = null;
  private lastAnim: AdaAnim | null = null;
  private readonly lastPos = new THREE.Vector3();
  private readonly lastVel = new THREE.Vector3();
  private readonly _vel = new THREE.Vector3();
  private readonly _acc = new THREE.Vector3();
  private primed = false;
  private yaw = 0;
  private gurgle = 0;
  private headYaw = 0;
  private readonly morphMeshes: any[] = [];
  private readonly contact: ContactShadow;
  /** C2-ESCAPE B3: the severed head + the one runtime head-carry mechanism (head-carry.ts). */
  readonly headCarry: HeadCarry;
  private warnedNoHead = false;

  constructor(c: LoadedCharacter) {
    this.c = c;
    this.bones = c.bones;
    this.group = new THREE.Group();
    this.group.name = 'ada';
    this.group.add(c.root);
    this.group.visible = false;
    // LIGHTING lane (REALISM-BACKLOG item 17): floor contact shadow (presets without GTAO; src/characters/skin.ts)
    this.contact = new ContactShadow(this.group, [c.bones.get('foot_l'), c.bones.get('foot_r')], c.bones.get('hips') ?? null);
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
        const hc = new VerletChain(hb, { stiffness: 0.16, damping: 0.86 });
        this.chains.push(hc);
        this.hairChains.push(hc);
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
    // the arm override layer (head carry) rotates the arms after the sampled pose: cache them too, or the rotation
    // would accumulate on the frames that restore instead of sampling
    for (const n of ['neck_01', 'neck_02', 'head', 'upperarm_r', 'forearm_r', 'hand_r', 'upperarm_l', 'forearm_l', 'hand_l']) {
      const b = this.bones.get(n);
      if (b) cached.push(b);
    }
    this.cache = new PoseCache(cached);
    const tri = (s: string): [any, any, any] | null => {
      const t = [this.bones.get(`upperarm_${s}`), this.bones.get(`forearm_${s}`), this.bones.get(`hand_${s}`)];
      return t.every(Boolean) ? (t as [any, any, any]) : null;
    };
    this.headCarry = new HeadCarry(c.root, { head: this.bones.get('head') ?? null, propR: this.bones.get('prop_r') ?? this.bones.get('hand_r') ?? null, armR: tri('r'), armL: tri('l') });
    const carryClip = c.clips.get('ada_carry_r');
    if (carryClip) this.headCarry.setGrip(carryClip, this.bones);
    for (const m of c.meshes) if (m.morphTargetDictionary && 'eyelid_l_open' in m.morphTargetDictionary && !this.morphMeshes.includes(m)) this.morphMeshes.push(m);
    // escape fix-round review: the GLB ships every shape-key weight at 1 (glTF mesh.weights [1, 1, 1]) — the left eye was
    // OPEN from load, so the C2 13.6 "one clouded eye opens" beat (ruling d) changed nothing. Closed until eyeOpen(true).
    this.eyeOpen(false);
    this.initSeam(); // #142c: the rest pose, before any clip samples it
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

  /** World box of the sawbuck top (hair rests on it while her head lies there; #142c). */
  private readonly shelf = (() => {
    const a = planToWorld([SAWBUCK_TOP.x0, SAWBUCK_TOP.y1, SAWBUCK_TOP.z]);
    const b = planToWorld([SAWBUCK_TOP.x1, SAWBUCK_TOP.y0, SAWBUCK_TOP.z]);
    // the rubber sheet's west drape (props_m1.glb P_RUBBER_SHEET, measured): its face stays west of x 5.24 down to 0.9 m
    return { minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minZ: Math.min(a[2], b[2]), maxZ: Math.max(a[2], b[2]), y: a[1] + 0.004, wallX: SAWBUCK_TOP.drapeX, wallY0: planToWorld([0, 0, SAWBUCK_TOP.drapeZ0])[1] };
  })();

  /** #142c: the sampled local rotations the table lift replaced this frame (restored by undoTableLift). */
  private readonly liftSaved = new Map<any, any>();
  private rigBase: any = null;

  /** #142c seam: rest matrices (rig-local) of the rim bones and of the head piece's neck_stub, taken at the first update. */
  private seam: { rim: Array<{ bone: any; w: number; rest: any }>; stub: any; stubRest: any; restPos: any; restQuat: any; restScale: any; driven: boolean } | null | undefined;

  /** Load-time rest pose (called from the constructor, after head-carry mounted the head piece on neck_02). */
  private initSeam(): void {
    this.seam = null;
    const stub = this.c.root.getObjectByName('neck_stub');
    const rim = SEAM_RIM.map(([n, w]) => ({ bone: this.bones.get(n), w, rest: null as any }));
    if (!stub || !rim.every((r) => r.bone)) return;
    this.c.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.c.root.matrixWorld).invert();
    for (const r of rim) r.rest = inv.clone().multiply(r.bone.matrixWorld).invert();
    this.seam = { rim, stub, stubRest: inv.clone().multiply(stub.matrixWorld), restPos: stub.position.clone(), restQuat: stub.quaternion.clone(), restScale: stub.scale.clone(), driven: false };
  }

  private driveSeam(severed: boolean): void {
    if (this.seam === undefined) this.initSeam();
    const s = this.seam;
    if (!s) return;
    if (severed) {
      if (s.driven) {
        s.stub.position.copy(s.restPos);
        s.stub.quaternion.copy(s.restQuat);
        s.stub.scale.copy(s.restScale);
        s.driven = false;
      }
      return;
    }
    // Δ_i = R_i · R_i,rest⁻¹ (rig-local motion of each rim bone); the stub's rest point moved by Σ w_i Δ_i and its rest
    // rotation by the weighted mean of the Δ_i rotations
    _sInv.copy(this.c.root.matrixWorld).invert();
    _sP0.setFromMatrixPosition(s.stubRest);
    _sTarget.set(0, 0, 0);
    _sQ.set(0, 0, 0, 0);
    for (const r of s.rim) {
      _sD.multiplyMatrices(_sInv, r.bone.matrixWorld).multiply(r.rest);
      _sTarget.addScaledVector(_sP1.copy(_sP0).applyMatrix4(_sD), r.w);
      _sD.decompose(_sT, _sQi, _sS);
      if (_sQ.x * _sQi.x + _sQ.y * _sQi.y + _sQ.z * _sQi.z + _sQ.w * _sQi.w < 0) _sQi.set(-_sQi.x, -_sQi.y, -_sQi.z, -_sQi.w);
      _sQ.set(_sQ.x + _sQi.x * r.w, _sQ.y + _sQi.y * r.w, _sQ.z + _sQi.z * r.w, _sQ.w + _sQi.w * r.w);
    }
    _sQ.normalize();
    s.stubRest.decompose(_sT, _sQi, _sS);
    _sM.compose(_sTarget, _sQ.multiply(_sQi), _sS).premultiply(this.c.root.matrixWorld);
    s.stub.parent.updateWorldMatrix(true, false);
    _sM.premultiply(_sInv.copy(s.stub.parent.matrixWorld).invert());
    _sM.decompose(s.stub.position, s.stub.quaternion, s.stub.scale);
    s.stub.updateMatrixWorld(true);
    s.driven = true;
  }

  private undoTableLift(): void {
    if (!this.liftSaved.size) return;
    for (const [b, q] of this.liftSaved) b.quaternion.copy(q);
    this.liftSaved.clear();
    if (this.rigBase) this.c.root.position.copy(this.rigBase);
  }

  /** #142c: TABLE_ROOT's offset + TABLE_LIFT's root-frame rotations (each P⁻¹·R·P, chains root → tip), scaled by `w`. */
  private applyTableLift(w: number): void {
    this.rigBase ??= this.c.root.position.clone();
    this.c.root.position.set(this.rigBase.x, this.rigBase.y + TABLE_ROOT.up * w, this.rigBase.z + TABLE_ROOT.fwd * w);
    this.group.updateWorldMatrix(true, false);
    this.group.getWorldQuaternion(_lrq);
    _lrqi.copy(_lrq).invert();
    for (const { bone, deg } of TABLE_LIFT) {
      const b = this.bones.get(bone);
      if (!b?.parent) continue;
      if (!this.liftSaved.has(b)) this.liftSaved.set(b, b.quaternion.clone());
      b.parent.updateWorldMatrix(true, false);
      b.parent.getWorldQuaternion(_lpq);
      _le.set(deg[0] * w * DEG2RAD, deg[1] * w * DEG2RAD, deg[2] * w * DEG2RAD, 'XYZ');
      _lrw.copy(_lrq).multiply(_lrl.setFromEuler(_le)).multiply(_lrqi);
      b.quaternion.premultiply(_lpq.invert().multiply(_lrw).multiply(b.parent.getWorldQuaternion(_lpq2)));
    }
    this.c.root.updateMatrixWorld(true);
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

  /** The clip a cutscene override is playing (null = AI-driven). */
  get overrideClip(): string | null {
    return this.ov?.clip ?? null;
  }

  // ------------------------------------------------------------------ C2-ESCAPE B3: severed Ada

  /** The world root the free head lives in (the level root Ada's group sits in). */
  private world(): any | null {
    return this.group.parent ?? null;
  }

  /** C2's cut (B-CINE `fx adaHead sever`, the story flag `ada_severed`): the head becomes its own node; neck spring off. */
  sever(on: boolean): void {
    if (on && !this.headCarry.real && !this.warnedNoHead) {
      this.warnedNoHead = true;
      console.info('[ada] severed: no ada_head_rig in this GLB yet (lane A A0/A1) — the head is a stand-in node; the body stays whole');
    }
    this.headCarry.sever(on, this.world());
    if (!on) this.eyeOpen(false);
  }

  get severed(): boolean {
    return this.headCarry.severed;
  }

  /** The head node (world-space while free; B-CINE's head puppet positions it) — null before the split asset lands. */
  headNode(): any | null {
    return this.headCarry.real ? this.headCarry.node : null;
  }

  /** Hang the head from a socket (Harlan's prop_l in C2, her own prop_r) — null = leave it free where it is. */
  carryHeadBy(socket: any | null): void {
    this.headCarry.carryBy(socket, this.world());
  }

  /** The left eyelid opens (C2 13.6, `eyelid_l_open`; no-op until the morph exists). */
  eyeOpen(on: boolean): void {
    for (const m of this.morphMeshes) {
      const d = m.morphTargetDictionary;
      if (m.morphTargetInfluences && 'eyelid_l_open' in d) m.morphTargetInfluences[d.eyelid_l_open] = on ? 1 : 0;
    }
    // part the strand nearest her image-left eye (her right eye, the one that opens): in the head node's frame
    // (origin = the crown, +Z = the face, +X = her left) the eye sits ≈ (−0.032, −0.10, +0.09) m (lane A's head)
    const node = this.headCarry.node;
    if (!on) this.partedChain = null; // review: closing (load / restore) must not flick a strand up
    if (!node || !on) return;
    node.updateWorldMatrix(true, false);
    const eye = new THREE.Vector3(-0.032, -0.1, 0.09).applyMatrix4(node.matrixWorld);
    const tmp = new THREE.Vector3();
    let best = Infinity;
    for (const hc of this.hairChains) {
      const b = hc.bones[Math.min(1, hc.bones.length - 1)];
      b.updateWorldMatrix(true, false);
      const d = tmp.setFromMatrixPosition(b.matrixWorld).distanceTo(eye);
      if (d < best) {
        best = d;
        this.partedChain = hc;
      }
    }
  }

  /** Bone by name (sockets prop_l / prop_r, hand_*, head …). */
  bone(name: string): any | null {
    return this.bones.get(name) ?? null;
  }

  /** The clip currently sampled (AI or override). */
  get clipName(): string | null {
    return this.currentClip;
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
    // #142c: take the table lift off before anything samples or caches the pose (the mixer only rewrites a bone whose
    // clip value changed, so on a static clip the layer would otherwise compound frame after frame)
    this.undoTableLift();
    // ---- visibility + root
    if (ov) {
      this.group.visible = this.forceVisible ?? true;
    } else if (!out || !out.visible) {
      this.group.visible = false;
      this.primed = false;
      // the head she carries goes offstage with her (a head another hand holds stays where it is)
      if (this.headCarry.severed && this.headCarry.holder === this.headCarry.bones.propR) this.headCarry.node.visible = false;
      this.contact.update();
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
    if (!this.primed) {
      this.lastPos.copy(pos);
      this.lastVel.set(0, 0, 0);
    }
    const vel = this._vel;
    const acc = this._acc.set(0, 0, 0);
    if (dt > 0) {
      vel.subVectors(pos, this.lastPos).divideScalar(Math.max(dt, 1e-3));
      acc.subVectors(vel, this.lastVel).divideScalar(Math.max(dt, 1e-3));
      this.lastPos.copy(pos);
      this.lastVel.copy(vel);
    }
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
    // ---- C2 head attached (lead ruling (ao), #142c): the table clips re-posed so the head rests ON the sawbuck,
    // turned toward the doorway, instead of inside it (ada-table-pose.ts). After the sampled pose, before the spring.
    const liftW = ov ? tableLiftWeight(this.currentClip, this.current?.time ?? 0) : 0;
    if (liftW > 0) this.applyTableLift(liftW);

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
    const severed = this.headCarry.severed;
    const neck = severed ? null : this.bones.get('neck_02'); // C2-ESCAPE: the neck spring is off once she is severed
    const head = severed ? null : this.bones.get('head');
    const neck1 = severed ? null : this.bones.get('neck_01');
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
    // #142c: while whole, the head piece's neck stub follows the body's rim (no cut faces before the blade)
    this.driveSeam(severed);

    // ---- chains (gown collides with the legs)
    this.updateLegCaps();
    // ---- the carried head + the arm override layer (after the clip pose, before the hair chains)
    if (severed) {
      const hc = this.headCarry;
      const own = hc.bones.propR;
      // in gameplay the head is always in her right hand (unless she set it down); a cutscene decides its own
      if (!ov && out && out.visible && hc.mode !== 'placed' && hc.holder !== own && own) this.carryHeadBy(own);
      if (!ov) hc.node.visible = this.group.visible;
      hc.update(dt, this.group, ov ? null : (out?.head ?? 'hanging'), this.legCaps[2] ?? null, this.headYaw);
      this.c.root.updateMatrixWorld(true);
    }
    const cdt = this.primed ? dt : 0;
    // C2-ESCAPE review (S6, §2.1 "the swing parts a 2 cm gap over the left eye"): the one strand chain over the open eye
    // is flicked up and let go of its authored veil pose (stiffness 0.16 → 0.02); the rest of the curtain stays.
    // (only while another hand holds it: once she carries it herself — C2c / B05 — the curtain falls back)
    if (this.partedChain && this.headCarry.holder === this.headCarry.bones.propR) this.partedChain = null;
    // escape fix-round review: the face veil is off a severed head in Harlan's fist (hair gathered in a fist is pulled
    // off the face), back on in her own hand. Fix round 2 (ruling g): ON the floor the wet hair stays over most of the
    // face — the cut, the blood and his action carry the horror, the face is the subject only in the lit eye insert.
    // (QA A/B: globalThis.__veil = 0 | 1 forces it)
    const veilQa = (globalThis as { __veil?: number }).__veil;
    const hc0 = this.headCarry;
    // M-A C2 upgrades (ruling z5 item 1, sweep scratch/mac2/s1): ON THE FLOOR too — a face-up head's wet hair falls off
    // the face to the boards (gravity; the rigid shell cannot), and the veil cards' own cube shadow (skin.ts
    // maskShadowNode) were what kept the lamp-lit face black at 10.5 (face L 0.006 → 0.057 with the veil off in both
    // passes). Still ON in her own hand (C2c / B05).
    uHairVeilClear.value = veilQa ?? (hc0.severed && hc0.holder !== hc0.bones.propR ? 1 : 0);
    uNeckBlood.value = this.headCarry.severed ? 1 : 0;
    // fix round 4 (ruling u): a severed head nobody holds lies on the floor her root stands on — its wet hair lies on the
    // boards (≈ 3 mm of hair thickness above them) and goes slack (wet hair has no spring of its own)
    const loose = hc0.severed && !hc0.holder;
    // M-A: the face's pool smear (skin.ts uHeadSmear) — latched once the severed head has lain loose in its pool
    // (QA: globalThis.__headSmear = 0 | 1 forces it)
    if (!hc0.severed) this.smeared = false;
    else if (loose) this.smeared = true;
    uHeadSmear.value = (globalThis as { __headSmear?: number }).__headSmear ?? (this.smeared ? 1 : 0);
    for (const hc of this.hairChains) {
      const part = hc === this.partedChain;
      hc.gravity = part ? -40 : 9.81;
      hc.stiffness = part ? 0.02 : loose ? Number((globalThis as { __c2HairK?: number }).__c2HairK ?? 0.05) : 0.16; // QA: __c2HairK
      hc.floorY = loose ? this.group.position.y + 0.003 : null;
      // #142c: while her head lies on the sawbuck the wet hair lies on the rubber sheet / hangs off its edge, not through it
      hc.shelf = liftW > 0 && !hc0.severed ? this.shelf : null;
    }
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
    this.contact.update();
  }

  private selectAnim(out: AdaOutput): void {
    const anim = out.anim;
    const clip = adaClipFor(anim, out.vel[2], (c) => this.c.clips.has(c));
    if (!clip) return;
    const loop = !ONCE.has(clip);
    const changed = anim !== this.lastAnim;
    const a = this.play(clip, 0.22, loop);
    if (!a) return;
    // travel clips follow her speed
    const nominal = CLIP_SPEED[clip];
    if (nominal) a.timeScale = Math.max(0.35, Math.min(2.2, out.speed / nominal || 1));
    else if (clip === 'ada_finale_take') a.timeScale = 1.25; // the brain's take lasts 0.8 s; the clip 1.0 s
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
const DEG2RAD = Math.PI / 180;
const _lrq = new THREE.Quaternion();
const _lrqi = new THREE.Quaternion();
const _lpq = new THREE.Quaternion();
const _lpq2 = new THREE.Quaternion();
const _lrl = new THREE.Quaternion();
const _lrw = new THREE.Quaternion();
const _le = new THREE.Euler();
const _sInv = new THREE.Matrix4();
const _sD = new THREE.Matrix4();
const _sM = new THREE.Matrix4();
const _sP0 = new THREE.Vector3();
const _sP1 = new THREE.Vector3();
const _sTarget = new THREE.Vector3();
const _sT = new THREE.Vector3();
const _sS = new THREE.Vector3();
const _sQ = new THREE.Quaternion();
const _sQi = new THREE.Quaternion();
const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) } as const;

/** bone.quaternion *= rotation(axis, angle) (local frame). */
export function rotateLocal(bone: any, axis: 'x' | 'y' | 'z', angle: number): void {
  if (!angle) return;
  _q.setFromAxisAngle(AX[axis], angle);
  bone.quaternion.multiply(_q);
}
