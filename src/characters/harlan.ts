// Harlan at runtime: never runs, never attacks — he is posed or plays a clip at a world pose (cutscenes, lightning
// poses, the pre-C2 tableau). Sack skirt and apron flaps swing on verlet chains; the cleaver bone can be hidden.
// Static poses are 2-frame clips: `pose(name)` holds their first frame.

import * as THREE from 'three/webgpu';
import { PoseCache, type LoadedCharacter } from './loader.ts';
import { StopMotion, VerletChain } from './secondary.ts';

export interface HarlanPlay {
  clip: string;
  pos: [number, number, number];
  yaw: number;
  time?: number;
  loop?: boolean;
  timeScale?: number;
}

export class HarlanCharacter {
  readonly group: any;
  readonly c: LoadedCharacter;
  readonly mixer: any;
  private readonly actions = new Map<string, any>();
  private current: any = null;
  private currentClip: string | null = null;
  private readonly chains: VerletChain[] = [];
  private readonly cache: PoseCache;
  /** Harlan moves smoothly (only Ada is stop-motion); kept for symmetry with cutscene options. */
  private readonly stop = new StopMotion();
  private primed = false;

  constructor(c: LoadedCharacter) {
    this.c = c;
    this.group = new THREE.Group();
    this.group.name = 'harlan';
    this.group.add(c.root);
    this.group.visible = false;
    this.mixer = new THREE.AnimationMixer(c.root);
    this.stop.enabled = false;
    const cached: any[] = [];
    for (let k = 0; k < 4; k++) {
      const b = c.bones.get(`sack_${k}`);
      if (b) {
        this.chains.push(new VerletChain([b], { stiffness: 0.25, damping: 0.85 }));
        cached.push(b);
      }
    }
    for (const s of ['l', 'r']) {
      const list = [c.bones.get(`apron_${s}_01`), c.bones.get(`apron_${s}_02`)].filter(Boolean);
      if (list.length) {
        this.chains.push(new VerletChain(list, { stiffness: 0.35, damping: 0.8 }));
        cached.push(...list);
      }
    }
    this.cache = new PoseCache(cached);
  }

  get visible(): boolean {
    return this.group.visible;
  }

  set visible(v: boolean) {
    this.group.visible = v;
    if (!v) this.primed = false;
  }

  /** Show/hide the hog cleaver (weighted 100 % to the `cleaver` bone). */
  setCleaver(v: boolean): void {
    const b = this.c.bones.get('cleaver');
    if (b) b.scale.setScalar(v ? 1 : 1e-4);
  }

  place(pos: [number, number, number], yaw: number): void {
    this.group.position.set(...pos);
    this.group.rotation.y = yaw;
  }

  play(o: HarlanPlay, fade = 0.3): void {
    this.place(o.pos, o.yaw);
    this.visible = true;
    const clip = this.c.clips.get(o.clip);
    if (!clip) {
      console.warn(`[harlan] unknown clip ${o.clip}`);
      return;
    }
    let a = this.actions.get(o.clip);
    if (!a) {
      a = this.mixer.clipAction(clip);
      this.actions.set(o.clip, a);
    }
    const isStatic = clip.duration < 0.1;
    if (this.currentClip !== o.clip) {
      a.reset();
      a.setLoop(o.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = true;
      a.play();
      if (this.current && fade > 0) this.current.crossFadeTo(a, fade, false);
      else this.current?.stop();
      this.current = a;
      this.currentClip = o.clip;
    }
    if (o.time !== undefined) a.time = o.time;
    a.timeScale = isStatic ? 0 : (o.timeScale ?? 1);
  }

  /** Hold a static pose (or any clip's frame at `time`). */
  pose(clip: string, pos: [number, number, number], yaw: number, time = 0): void {
    this.play({ clip, pos, yaw, time, timeScale: 0 }, 0);
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    const step = this.stop.step(dt);
    if (step > 0 || !this.primed) {
      this.mixer.update(step);
      this.c.root.updateMatrixWorld(true);
      this.cache.capture();
    } else this.cache.restore();
    this.c.root.updateMatrixWorld(true);
    for (const ch of this.chains) ch.update(this.primed ? dt : 0);
    this.primed = true;
  }
}
