// One handle on all three characters for the cutscene lane (matches src/cutscenes/host.ts CharacterDirector
// structurally: has / place / setVisible / play / acquire / release / pose). PLAN positions + headings in,
// three transforms out (glTF characters face PLAN −y at rotation 0 ⇒ rotation.y = heading + π/2).

import type { P3 } from '../shared/layout-types.ts';
import { planToWorld, worldToPlan } from '../shared/coords.ts';
import type { AdaCharacter } from './ada.ts';
import type { HarlanCharacter } from './harlan.ts';
import type { FpArms } from './arms.ts';
import * as THREE from 'three/webgpu';
import { makeFeedSack } from './sack-prop.ts';
import { makeCleaver } from './cleaver-prop.ts';

export type CharId = 'ada' | 'harlan' | 'arms';

export class CharacterBank {
  readonly ada: AdaCharacter | null;
  readonly harlan: HarlanCharacter | null;
  readonly arms: FpArms | null;
  /** Characters a cutscene currently owns (the story runtime leaves them alone). */
  readonly acquired = new Set<CharId>();

  constructor(ada: AdaCharacter | null, harlan: HarlanCharacter | null, arms: FpArms | null) {
    this.ada = ada;
    this.harlan = harlan;
    this.arms = arms;
  }

  has(id: CharId): boolean {
    return !!this[id];
  }

  place(id: CharId, pos: P3, heading: number): void {
    const w = planToWorld(pos);
    const yaw = heading + Math.PI / 2;
    if (id === 'ada' && this.ada) {
      if (!this.ada.overridden) this.ada.override({ clip: 'ada_listen', pos: w, yaw });
      else this.ada.moveOverride(w, yaw);
    } else if (id === 'harlan' && this.harlan) this.harlan.place(w, yaw);
  }

  setVisible(id: CharId, visible: boolean): void {
    if (id === 'ada' && this.ada) this.ada.forceVisible = visible;
    else if (id === 'harlan' && this.harlan) this.harlan.visible = visible;
    else if (id === 'arms' && this.arms) this.arms.visible = visible;
  }

  play(id: CharId, clip: string, o: { loop: boolean; fade: number; speed: number; at: number }): boolean {
    // Re-cueing the clip that already plays continues it (C5 cues harlan_finale at 6.4 s and again at 10 s: clip
    // time = C5 time − 6.4; C7 holds ada_sting's first frame, then lets it run): only a skip's end offset seeks.
    const keep = (current: string | null) => current === clip && o.at < 0.5;
    if (id === 'ada' && this.ada) {
      if (!this.ada.c.clips.has(clip)) return false;
      const g = this.ada.group;
      const time = keep(this.ada.overrideClip) ? undefined : o.at;
      this.ada.override({ clip, pos: [g.position.x, g.position.y, g.position.z], yaw: g.rotation.y, loop: o.loop, timeScale: o.speed, time, fade: o.fade, stopMotion: !CUTSCENE_SMOOTH.has(clip) });
      return true;
    }
    if (id === 'harlan' && this.harlan) {
      if (!this.harlan.c.clips.has(clip)) return false;
      const g = this.harlan.group;
      const time = keep(this.harlan.clipName) ? undefined : o.at;
      this.harlan.play({ clip, pos: [g.position.x, g.position.y, g.position.z], yaw: g.rotation.y, loop: o.loop, timeScale: o.speed, time }, o.fade);
      return true;
    }
    if (id === 'arms' && this.arms) {
      if (!this.arms.c.clips.has(clip)) return false;
      if (o.loop) this.arms.loop(clip, o.fade);
      else this.arms.play(clip, o.fade);
      return true;
    }
    return false;
  }

  acquire(id: CharId): void {
    this.acquired.add(id);
    if (id === 'ada' && this.ada && !this.ada.overridden) {
      const g = this.ada.group;
      this.ada.override({ clip: 'ada_listen', pos: [g.position.x, g.position.y, g.position.z], yaw: g.rotation.y });
    }
  }

  release(id: CharId): void {
    this.acquired.delete(id);
    if (id === 'ada' && this.ada) {
      this.ada.forceVisible = null;
      this.ada.release();
    }
    if (id === 'arms' && this.arms) this.arms.loop('arms_idle', 0.3);
  }

  /**
   * Props on socket bones (docs/CHARACTERS.md "Prop sockets"): `sting_sack` (C7: the feed sack by its knot, eyeholes
   * along prop_r's local +X, hanging plumb), `locket` (Ada's left fist after the take), `cleaver` (C5 shadow-play).
   * bone null = detach (hidden). `hand_r` / `hand_l` resolve to the prop_r / prop_l sockets when they exist.
   */
  attach(id: CharId, prop: string, bone: string | null): void {
    // C2-ESCAPE B3: her severed head is not a prop clone — it is her own head node, hung from whichever hand holds it
    // (Harlan's prop_l in C2 10.6, her prop_r) or left free in the world (bone null) for a cutscene to place
    if (prop === 'ada_head') {
      if (!this.ada) return;
      const src = id === 'harlan' ? this.harlan?.c : id === 'ada' ? this.ada.c : null;
      const sock = bone ? (src?.bones.get(bone) ?? null) : null;
      this.ada.carryHeadBy(sock);
      return;
    }
    if (id !== 'ada' || !this.ada) return;
    let a = this.attached.get(prop);
    if (!bone) {
      if (a) a.obj.visible = false;
      return;
    }
    const sock = bone === 'hand_r' ? 'prop_r' : bone === 'hand_l' ? 'prop_l' : bone;
    const b = this.ada.bone(sock) ?? this.ada.bone(bone);
    if (!b) return;
    if (!a) {
      const obj = this.makeProp(prop);
      if (!obj) return;
      a = { obj, bone: b, plumb: prop === 'sting_sack' };
      this.attached.set(prop, a);
      (a.plumb ? this.ada.group.parent ?? this.ada.group : b).add(obj);
    } else if (!a.plumb && a.bone !== b) {
      b.add(a.obj);
      a.bone = b;
    } else a.bone = b;
    a.obj.visible = true;
  }

  /** A prop made at runtime or cloned from the level (`propSource(id)`). */
  propSource: ((id: string) => any | null) | null = null;
  lightsNode: any = null;
  private readonly attached = new Map<string, { obj: any; bone: any; plumb: boolean }>();

  private makeProp(prop: string): any | null {
    if (prop === 'sting_sack') return makeFeedSack(this.lightsNode);
    if (prop === 'cleaver') return makeCleaver(this.lightsNode);
    const src = this.propSource?.(prop === 'locket' ? 'P_LOCKET' : prop);
    if (!src) return null;
    const c = src.clone(true);
    c.position.set(0, 0, 0);
    c.quaternion.identity();
    c.traverse((n: any) => {
      n.visible = true;
      n.matrixAutoUpdate = true;
      n.frustumCulled = false;
    });
    return c;
  }

  /** Per frame (after the characters update): plumb props follow their socket. */
  update(): void {
    for (const a of this.attached.values()) {
      if (!a.plumb || !a.obj.visible) continue;
      a.bone.updateWorldMatrix(true, false);
      const parent = a.obj.parent;
      _p.setFromMatrixPosition(a.bone.matrixWorld);
      // eyeholes (+Z of the sack) along the socket's local +X, flattened to the horizontal
      _x.set(1, 0, 0).transformDirection(a.bone.matrixWorld).setY(0);
      if (_x.lengthSq() < 1e-6) _x.set(0, 0, 1);
      _x.normalize();
      _m.lookAt(_x, _o.set(0, 0, 0), _up); // Matrix4.lookAt: +Z = eye − target
      _q.setFromRotationMatrix(_m);
      if (parent) {
        parent.updateWorldMatrix(true, false);
        _inv.copy(parent.matrixWorld).invert();
        a.obj.position.copy(_p).applyMatrix4(_inv);
        parent.getWorldQuaternion(_pq);
        a.obj.quaternion.copy(_pq.invert().multiply(_q));
      }
    }
  }

  pose(id: CharId): { pos: P3; heading: number } | null {
    const c = id === 'ada' ? this.ada : id === 'harlan' ? this.harlan : null;
    if (!c) return null;
    const g = c.group;
    return { pos: worldToPlan([g.position.x, g.position.y, g.position.z]) as P3, heading: g.rotation.y - Math.PI / 2 };
  }
}

/** Cutscene clips Ada plays smoothly (the stop-motion stutter is for her hunting body). */
const CUTSCENE_SMOOTH = new Set<string>(['ada_finale_shadow']);
const _p = new THREE.Vector3();
const _x = new THREE.Vector3();
const _o = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _inv = new THREE.Matrix4();
