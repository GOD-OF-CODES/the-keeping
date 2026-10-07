// M2 gameplay on the world side (B06–B13), driven by story flags and interactions (docs/INTEGRATION.md "M2"):
//   • prop states from flags — load defaults (the locket + ticket only exist after the hem is cut, the sting's air
//     freshener, your car in the wreck row only after C3) and `syncFlag` for every flag event, so debug starts
//     (?beat=), checkpoint respawns and saves rebuild the same world: items in the inventory, taken props hidden,
//     the dress cut, the cars where C3 left them;
//   • the embroidered bell pull moving, the parlor bell far below; the hem cut → the bundle drops (locket + ticket);
//   • the kitchen: the thump under the hatch (it jolts), the can grating on the floor;
//   • Ada's wardrobe: after her visit the loose back gives — hold S inside the hide to push through to the servants'
//     stair;
//   • the open locket in your hand in front of the lens while RMB is held (or forced after a finale death);
//   • C6's can at the filler.
// Everything is three.js object toggling on the level's props; the story (src/story) stays the only authority.

import * as THREE from 'three/webgpu';
import type { GameContext } from './context.ts';
import type { Input } from '../core/input.ts';
import type { Level } from '../world/level.ts';
import type { PlayerController } from '../player/controller.ts';
import type { HideSystem } from '../world/hides.ts';
import type { FlashlightRig } from '../player/flashlight-rig.ts';
import type { Inventory } from '../player/inventory.ts';
import type { FpArms } from '../characters/arms.ts';
import { planToWorld } from '../shared/coords.ts';
import { headingToCameraYaw } from '../world/rooms.ts';
import { CAR_ROW, inCar } from '../cutscenes/stage.ts';

export interface M2Deps {
  ctx: GameContext;
  input: Input;
  level: Level;
  player: PlayerController;
  hides: HideSystem;
  rig: FlashlightRig;
  inventory: Inventory;
  audio: any | null;
  arms: FpArms | null;
  /** Is the locket raised right now (RMB held with the locket, or forced after a finale death)? */
  locketRaised(): boolean;
}

/** Items the story tracks as has_<id> flags → the prop they are taken from. */
export const ITEM_PROPS: Record<string, { prop: string; label: string }> = {
  hammer: { prop: 'P_HAMMER', label: 'Claw hammer' },
  shears: { prop: 'P_SHEARS', label: 'Sewing shears' },
  locket: { prop: 'P_LOCKET', label: 'Locket' },
  can: { prop: 'P_JERRY_10', label: 'Jerry can' },
};

/** Behind Ada's wardrobe: the servants' stair top landing (T_B10_BACKSTAIR), eye height, facing north. */
const BACKSTAIR_EYE: [number, number, number] = [5.0, 9.8, 4.1 + 1.65];
const PUSH_HOLD_S = 0.7;

interface Tween {
  obj: any;
  t: number;
  d: number;
  fn(obj: any, u: number, t: number): void;
  done?(): void;
}

export function createM2World(d: M2Deps) {
  const { ctx, input, level, player, hides, rig, inventory, audio } = d;
  const flag = (n: string) => ctx.flags.get(n) === true;
  const prop = (id: string) => level.prop(id);
  const setVisible = (id: string, v: boolean) => {
    const o = prop(id);
    if (o) o.visible = v;
  };
  const worldPosOf = (o: any): [number, number, number] => {
    const b = new THREE.Box3().setFromObject(o);
    const c = b.isEmpty() ? o.getWorldPosition(new THREE.Vector3()) : b.getCenter(new THREE.Vector3());
    return [c.x, c.y, c.z];
  };
  const play = (id: string, o: any = {}) => audio?.play(id, o);
  const tweens: Tween[] = [];
  const tween = (obj: any, dur: number, fn: Tween['fn'], done?: () => void) => {
    for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].obj === obj) tweens.splice(i, 1);
    tweens.push({ obj, t: 0, d: dur, fn, done });
  };
  /** When true, flag events rebuild state instantly (debug starts, restores) instead of animating. */
  let restoring = false;

  // ------------------------------------------------------------------ the dress (intact / cut hem)
  const dressParts = (): { intact: any[]; cut: any[] } => {
    const out = { intact: [] as any[], cut: [] as any[] };
    prop('P_DRESS')?.traverse((n: any) => {
      const st = n.userData?.state;
      if (st === 'intact') out.intact.push(n);
      else if (st === 'cut_hem') out.cut.push(n);
    });
    return out;
  };
  const setDress = (cut: boolean) => {
    const p = dressParts();
    if (!p.intact.length && !p.cut.length) return;
    for (const n of p.intact) n.visible = !cut;
    for (const n of p.cut) n.visible = cut;
  };

  // rest positions of the bundle (the layout places them on the floor under the hem)
  const rest = new Map<string, any>();
  for (const id of ['P_LOCKET', 'P_TICKET']) {
    const o = prop(id);
    if (o) rest.set(id, { p: o.position.clone(), q: o.quaternion.clone() });
  }
  const dropFromHem = (id: string, delay: number) => {
    const o = prop(id);
    const r = rest.get(id);
    if (!o || !r) return;
    o.visible = true;
    const flutter = id === 'P_TICKET';
    tween(o, delay + (flutter ? 1.0 : 0.45), (obj, _u, t) => {
      const k = Math.max(0, t - delay) / (flutter ? 1.0 : 0.45);
      const u = Math.min(1, k);
      obj.visible = t >= delay;
      obj.position.copy(r.p);
      obj.position.y += (1 - u * u) * 0.42 + (u >= 1 ? 0 : 0);
      if (flutter) {
        obj.position.x += Math.sin(u * 9) * 0.05 * (1 - u);
        obj.rotation.set(0, 0, 0);
        obj.quaternion.copy(r.q);
        obj.rotateZ(Math.sin(u * 7) * 0.5 * (1 - u));
      }
      obj.updateMatrixWorld(true);
      if (u >= 1 && !obj.userData.landed) {
        obj.userData.landed = true;
        play(flutter ? 'paper' : 'locket_click', { pos: worldPosOf(obj), room: 'U3', gain: 0.6 });
      }
    });
  };

  // ------------------------------------------------------------------ load defaults
  setVisible('P_LOCKET', false);
  setVisible('P_TICKET', false);
  setVisible('P_AIR_FRESHENER', false); // the sting's car only (params.stingOnly)
  setVisible('P_CAR_ROW', false); // your car joins the row in C3
  setDress(false);

  // ------------------------------------------------------------------ flags → world
  const syncFlag = (name: string, value: boolean) => {
    const m = /^has_(\w+)$/.exec(name);
    if (m && ITEM_PROPS[m[1]]) {
      const it = ITEM_PROPS[m[1]];
      if (value) {
        if (!inventory.has(m[1])) inventory.add({ id: m[1], label: it.label, propId: it.prop });
        setVisible(it.prop, false);
      } else if (inventory.has(m[1])) inventory.remove(m[1]);
      return;
    }
    if (!value) return;
    switch (name) {
      case 'has_ticket':
        setVisible('P_TICKET', false); // pocketed after reading
        return;
      case 'hem_cut':
        setDress(true);
        if (restoring) {
          if (!flag('has_locket') && !flag('locket_given')) setVisible('P_LOCKET', true);
          if (!flag('has_ticket')) setVisible('P_TICKET', true);
        } else {
          dropFromHem('P_LOCKET', 0.25);
          dropFromHem('P_TICKET', 0.35);
        }
        return;
      case 'c3_done':
        setVisible('P_CAR_GATE', false);
        setVisible('P_CAR_ROW', true);
        return;
      default:
        return;
    }
  };
  /** Rebuild everything from ctx.flags (after a debug start / restore). */
  const syncAll = () => {
    restoring = true;
    try {
      for (const [k, v] of ctx.flags) syncFlag(k, v);
    } finally {
      restoring = false;
    }
  };

  // ------------------------------------------------------------------ interactions
  const kitchenThump = (delay: number, sound = true) => {
    const hatch = prop('P_HATCH');
    if (!hatch) return;
    const base = hatch.userData.restPos ?? (hatch.userData.restPos = hatch.position.clone());
    if (sound) setTimeout(() => play('hatch_thump', { pos: worldPosOf(hatch), room: 'G3' }), delay * 1000);
    tween(hatch, delay + 0.6, (o, _u, t) => {
      const k = t - delay;
      o.position.copy(base);
      if (k > 0 && k < 0.5) o.position.y += Math.sin((k / 0.5) * Math.PI) * 0.018 * Math.exp(-k * 4);
      o.updateMatrixWorld(true);
    });
  };
  let kitchenDone = false;
  const onInteract = (id: string, action: string) => {
    switch (action) {
      case 'pull_bell': {
        const pull = prop('P_BELL_PULL');
        if (pull) {
          // rest pose cached once: a re-pull inside the 1.3 s tween must not start from the displaced position
          const base = pull.userData.restPos ?? (pull.userData.restPos = pull.position.clone());
          tween(pull, 1.3, (o, u) => {
            o.position.copy(base);
            o.position.y -= Math.sin(Math.min(1, u * 1.6) * Math.PI) * 0.08;
            o.updateMatrixWorld(true);
          });
        }
        // far below, the parlor bell jangles
        const bell = prop('P_SPRING_BELL');
        if (bell) setTimeout(() => play('spring_bell', { pos: worldPosOf(bell), room: 'G2', gain: 0.85 }), 380);
        return;
      }
      case 'b10:kitchen_enter':
        if (!kitchenDone) {
          kitchenDone = true;
          kitchenThump(1.4);
        }
        return;
      case 'listen_hatch':
        kitchenThump(0.05, false); // the story plays the thump itself; here only the lid jolts
        return;
      case 'take_can': {
        const can = prop('P_JERRY_10');
        const pos = can ? worldPosOf(can) : planToWorld([3.98, 8.345, 0.8]);
        play('can_scrape', { pos, room: 'G3', gain: 0.9 });
        // it grates on the floor: a short player noise
        ctx.events.emit('noise', { pos: [3.98, 8.3, 0.6], room: 'G3', radius: 6, source: 'player' });
        return;
      }
      default:
        void id;
        return;
    }
  };

  // ------------------------------------------------------------------ wardrobe back → servants' stair
  const hint = document.createElement('div');
  Object.assign(hint.style, {
    position: 'fixed',
    left: '50%',
    top: '64%',
    transform: 'translateX(-50%)',
    zIndex: '20',
    color: '#e6dfcf',
    font: '13px/1.3 system-ui, sans-serif',
    letterSpacing: '0.06em',
    textShadow: '0 1px 3px #000',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity .3s',
  } as Partial<CSSStyleDeclaration>);
  hint.textContent = 'Hold S  push through the back';
  document.body.appendChild(hint);
  let pushT = 0;
  const pushThrough = () => {
    if (hides.active) hides.exit();
    play('armoire_slats', { pos: planToWorld([5, 9.1, 5.2]), room: 'U4T', gain: 0.9 });
    level.doors.open('D_WARDROBE_BACK', false, true);
    player.teleport(planToWorld(BACKSTAIR_EYE), headingToCameraYaw(Math.PI / 2), -0.1);
    rig.snap();
    level.setViewer(BACKSTAIR_EYE[0], BACKSTAIR_EYE[1], BACKSTAIR_EYE[2] - 1.65);
    ctx.events.emit('noise', { pos: [5, 9.3, 4.1], room: 'U4T', radius: 2, source: 'player' });
  };

  // ------------------------------------------------------------------ the locket in your hand (RMB)
  let held: any = null;
  let raise = 0;
  let wasUp = false;
  /** With the M2 arms clips the locket rides the arms' `locket` socket (+Y along the view, +Z up); otherwise it is
   *  posed in front of the lens on the flashlight rig. Either way the open photo side faces the player. */
  let onSocket = false;
  const makeHeld = () => {
    const src = prop('P_LOCKET');
    if (!src) return null;
    const c = src.clone(true);
    c.position.set(0, 0, 0);
    c.quaternion.identity();
    c.traverse((n: any) => {
      n.visible = true;
      n.matrixAutoUpdate = true;
      n.frustumCulled = false;
      if (n.isMesh) {
        n.castShadow = false;
        n.renderOrder = 6;
      }
      if (n.userData?.part === 'lid') n.rotation.x = -1.95; // open
    });
    const holder = new THREE.Group();
    holder.name = 'locket-in-hand';
    holder.add(c);
    holder.visible = false;
    const sock = d.arms && d.arms.has('arms_locket_hold') ? d.arms.c.bones.get('locket') : null;
    if (sock) {
      // prop front (+Z three) → toward the eye (socket −Y), prop up (+Y) → socket +Z: a +90° turn about X
      c.rotation.x = Math.PI / 2;
      sock.add(holder);
      onSocket = true;
    } else {
      c.scale.setScalar(1.6); // a little larger than life: 30 cm from the eye, it must read in the beam
      rig.rig.add(holder);
    }
    return holder;
  };

  // ------------------------------------------------------------------ C6: the can at the filler
  let fillerCan: any = null;
  const canAtFiller = (on: boolean) => {
    if (on && !fillerCan) {
      const src = prop('P_JERRY_10');
      if (!src) return;
      fillerCan = src.clone(true);
      fillerCan.traverse((n: any) => {
        n.visible = true;
        n.matrixAutoUpdate = true;
      });
      const f = inCar([-0.95, -1.62, 0.55], CAR_ROW);
      const w = planToWorld(f);
      fillerCan.position.set(w[0], w[1], w[2]);
      fillerCan.rotation.set(0, CAR_ROW.heading + Math.PI / 2, 0.9);
      level.root.add(fillerCan);
    }
    if (fillerCan) fillerCan.visible = on;
  };

  // ------------------------------------------------------------------ per frame
  const update = (dt: number) => {
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      tw.t += dt;
      const u = Math.min(1, tw.t / tw.d);
      tw.fn(tw.obj, u, tw.t);
      if (u >= 1) {
        tweens.splice(i, 1);
        tw.done?.();
      }
    }
    // wardrobe back
    const inWardrobe = hides.active?.id === 'H_ADA_WARDROBE' && flag('dress_visit_done');
    hint.style.opacity = inWardrobe && hides.inputEnabled ? '1' : '0';
    // never under a cutscene lock (hides.inputEnabled): a push mid-death would free the body and teleport it
    if (inWardrobe && hides.inputEnabled && input.isDown('KeyS')) {
      pushT += dt;
      if (pushT >= PUSH_HOLD_S) {
        pushT = 0;
        pushThrough();
      }
    } else pushT = 0;
    // locket
    const up = d.locketRaised() && inventory.has('locket') && !hides.active;
    if (up && !held) held = makeHeld();
    if (held) {
      raise += ((up ? 1 : 0) - raise) * Math.min(1, dt * 9);
      held.visible = onSocket ? up || raise > 0.6 : raise > 0.02;
      if (!onSocket) {
        held.position.set(0.035, -0.28 + raise * 0.215, -0.3);
        held.rotation.set(-0.12 + (1 - raise) * 0.6, 0.05, 0);
      }
    }
    if (up !== wasUp && d.arms) {
      if (up) {
        d.arms.play('arms_raise_locket');
        d.arms.loop('arms_locket_hold', 0.2);
      } else d.arms.loop('arms_idle', 0.3);
    }
    wasUp = up;
  };

  return {
    syncFlag,
    syncAll,
    onInteract,
    update,
    canAtFiller,
    setDress,
    /** Wrap a block of flag events that must rebuild instantly (debug start / restore). */
    restore(fn: () => void) {
      restoring = true;
      try {
        fn();
      } finally {
        restoring = false;
      }
    },
  };
}

export type M2World = ReturnType<typeof createM2World>;
