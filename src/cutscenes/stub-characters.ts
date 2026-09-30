// Stand-in characters for the cutscene preview (?scene=cutscene) when the real Ada / Harlan GLBs aren't wired:
// primitive silhouettes (our own geometry) that honour CharacterDirector — placement, visibility, and a few readable
// procedural poses keyed off the clip name (lying on the table, rising, lifted head, seated, arms raised).
// Never used in the shipped game path.

import * as THREE from 'three/webgpu';
import { planToWorld } from '../shared/coords.ts';
import type { CharacterDirector } from './host.ts';
import type { CharId, P3 } from './types.ts';

interface Stub {
  root: any;
  body: any;
  head: any;
  arm: any;
  clip: string;
  t: number;
  speed: number;
  pos: P3;
  heading: number;
}

function makeStub(kind: 'ada' | 'harlan'): Stub {
  const root = new THREE.Group();
  root.name = `stub_${kind}`;
  const tall = kind === 'ada' ? 1.62 : 1.88;
  const r = kind === 'ada' ? 0.16 : 0.24;
  const bodyMat = new THREE.MeshStandardNodeMaterial({ color: kind === 'ada' ? 0xb8b09a : 0x3a3026, roughness: 0.8 });
  const headMat = new THREE.MeshStandardNodeMaterial({ color: kind === 'ada' ? 0x0b0b0c : 0x8a7654, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(r, tall - 2 * r - 0.25, 4, 12), bodyMat);
  body.position.y = (tall - 0.25) / 2;
  const head = new THREE.Mesh(new THREE.SphereGeometry(kind === 'ada' ? 0.11 : 0.15, 16, 12), headMat);
  head.position.y = tall - 0.13;
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.55, 3, 8), bodyMat);
  arm.position.set(kind === 'ada' ? 0.2 : 0.3, tall - 0.45, 0);
  root.add(body, head, arm);
  root.traverse((o: any) => {
    if (o.isMesh) o.castShadow = true;
  });
  return { root, body, head, arm, clip: '', t: 0, speed: 1, pos: [0, 0, 0], heading: 0 };
}

export class StubCharacters implements CharacterDirector {
  private readonly stubs = new Map<CharId, Stub>();
  readonly group: any;

  constructor(scene: any) {
    this.group = new THREE.Group();
    this.group.name = 'cutscene-stub-characters';
    scene.add(this.group);
    for (const k of ['ada', 'harlan'] as const) {
      const s = makeStub(k);
      s.root.visible = false;
      this.group.add(s.root);
      this.stubs.set(k, s);
    }
  }

  has(id: CharId): boolean {
    return id === 'arms' || this.stubs.has(id);
  }

  place(id: CharId, pos: P3, heading: number): void {
    const s = this.stubs.get(id);
    if (!s) return;
    s.pos = pos;
    s.heading = heading;
    const w = planToWorld(pos);
    s.root.position.set(w[0], w[1], w[2]);
    // stubs are built facing +x of their local frame after this rotation: heading CCW from east = rotation.y
    s.root.rotation.set(0, heading, 0);
  }

  setVisible(id: CharId, visible: boolean): void {
    const s = this.stubs.get(id);
    if (s) s.root.visible = visible;
  }

  play(id: CharId, clip: string, o: { loop: boolean; fade: number; speed: number; at: number }): boolean {
    const s = this.stubs.get(id);
    if (!s) return true; // arms: nothing to show
    s.clip = clip;
    s.t = o.at;
    s.speed = o.speed;
    return true;
  }

  pose(id: CharId): { pos: P3; heading: number } | null {
    const s = this.stubs.get(id);
    return s ? { pos: s.pos, heading: s.heading } : null;
  }

  /** Procedural poses by clip name (readable blocking only). */
  update(dt: number): void {
    for (const s of this.stubs.values()) {
      s.t += dt * s.speed;
      const c = s.clip;
      s.root.rotation.z = 0;
      s.body.rotation.set(0, 0, 0);
      s.head.position.x = 0;
      s.arm.rotation.set(0, 0, 0);
      const bent = (a: number) => {
        // bend forward (toward local +x = facing) at the hips
        s.body.rotation.z = -a;
        s.head.position.x = Math.sin(a) * 1.2;
      };
      if (c === 'ada_table' || (c === 'ada_opening' && s.t < 4.5)) bent(1.35);
      else if (c === 'ada_opening') bent(s.t > 7.5 ? 0.9 : 1.35 - 0.45 * Math.min(1, (s.t - 4.5) / 1.5));
      else if (c === 'ada_rise') bent(Math.max(0, 1.35 * (1 - s.t / 4)));
      else if (c.startsWith('ada_look') || c === 'ada_hide_check' || c === 'ada_sting') s.arm.rotation.z = Math.min(2.4, s.t * 3);
      else if (c === 'ada_catch') s.arm.rotation.z = 1.6;
      else if (c === 'harlan_opening') s.arm.rotation.z = s.t < 12.35 ? 2.8 : 1.2;
      else if (c === 'harlan_pose_car_push') bent(0.5);
      else if (c === 'harlan_pose_look_up') s.head.position.x = -0.05;
      else if (c === 'harlan_seated' || c === 'harlan_seated_look_up') s.root.rotation.z = Math.sin(s.t * 1.5) * 0.05;
      else if (c === 'ada_patrol' || c === 'ada_chase') s.body.rotation.x = Math.sin(s.t * 8) * 0.06;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
