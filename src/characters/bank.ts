// One handle on all three characters for the cutscene lane (matches src/cutscenes/host.ts CharacterDirector
// structurally: has / place / setVisible / play / acquire / release / pose). PLAN positions + headings in,
// three transforms out (glTF characters face PLAN −y at rotation 0 ⇒ rotation.y = heading + π/2).

import type { P3 } from '../shared/layout-types.ts';
import { planToWorld, worldToPlan } from '../shared/coords.ts';
import type { AdaCharacter } from './ada.ts';
import type { HarlanCharacter } from './harlan.ts';
import type { FpArms } from './arms.ts';

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
    if (id === 'ada' && this.ada) {
      if (!this.ada.c.clips.has(clip)) return false;
      const g = this.ada.group;
      this.ada.override({ clip, pos: [g.position.x, g.position.y, g.position.z], yaw: g.rotation.y, loop: o.loop, timeScale: o.speed, time: o.at, fade: o.fade });
      return true;
    }
    if (id === 'harlan' && this.harlan) {
      if (!this.harlan.c.clips.has(clip)) return false;
      const g = this.harlan.group;
      this.harlan.play({ clip, pos: [g.position.x, g.position.y, g.position.z], yaw: g.rotation.y, loop: o.loop, timeScale: o.speed, time: o.at }, o.fade);
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

  pose(id: CharId): { pos: P3; heading: number } | null {
    const c = id === 'ada' ? this.ada : id === 'harlan' ? this.harlan : null;
    if (!c) return null;
    const g = c.group;
    return { pos: worldToPlan([g.position.x, g.position.y, g.position.z]) as P3, heading: g.rotation.y - Math.PI / 2 };
  }
}
