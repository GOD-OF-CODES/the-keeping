// Interaction (docs/PLAN.md §2.7): a centre-screen raycast picks the nearest interactable within reach (with
// line-of-sight against the static collision), shows a prompt, E interacts; hold interactions (prying a board)
// fill a bar while E is held. Default actions are bound from the layout (`props[].interaction`, interactive doors,
// Ada's boards); every action also emits `interact { id, action }` so the story lane can react.

import * as THREE from 'three/webgpu';
import { CUTSCENE_SCREEN } from '../cutscenes/host.ts';
import type { Input } from '../core/input.ts';
import type { GameContext } from '../game/context.ts';
import type { Inventory, Journal } from '../player/inventory.ts';
import { worldToPlan } from '../shared/coords.ts';
import type { DoorSystem, SoundSink } from './doors.ts';
import type { Level } from './level.ts';
import type { HideSystem } from './hides.ts';

export interface Interactable {
  id: string;
  /** Raycast target (its visible meshes are tested). */
  object: any;
  /** Prompt text, or null when not usable right now. */
  label(): string | null;
  /** Seconds E must be held (0/undefined = press). */
  hold?: number;
  /** Action name for hold hooks (arms clips while E is held). */
  action?: string;
  /** fast = the run key is held (fast door push). */
  use(fast: boolean): void;
  reach?: number;
}

const REACH = 1.9;

export class Interactables {
  readonly items: Interactable[] = [];
  focus: Interactable | null = null;
  enabled = true;
  /** Hold interactions: 'start' when E goes down on one, 'cancel' when released early, 'done' on completion. */
  onHold: ((it: Interactable, phase: 'start' | 'cancel' | 'done') => void) | null = null;
  private holding: Interactable | null = null;
  private shownLabel: string | null = null;
  private barVis = '';
  private readonly ray = new THREE.Raycaster();
  private readonly camera: any;
  private readonly input: Input;
  private readonly level: Level;
  private readonly prompt: HTMLDivElement;
  private readonly promptText: HTMLSpanElement;
  private readonly bar: HTMLDivElement;
  private holdT = 0;
  private readonly centres = new Map<Interactable, { c: any; r: number }>();
  private readonly _o = new THREE.Vector3();
  private readonly _d = new THREE.Vector3();
  private readonly _p = new THREE.Vector3();
  private readonly _inv = new THREE.Matrix4();
  private readonly _lr = new THREE.Ray();
  private readonly proxyMeshes = new Map<Interactable, any[]>();
  private readonly cands: Interactable[] = [];
  private exactAge = 0;
  private exactBoxBest: Interactable | null = null;
  private exactBest: Interactable | null = null;
  private exactDist = Infinity;

  constructor(camera: any, input: Input, level: Level) {
    this.camera = camera;
    this.input = input;
    this.level = level;
    this.ray.far = 3;
    const p = document.createElement('div');
    Object.assign(p.style, {
      position: 'fixed',
      left: '50%',
      top: '58%',
      transform: 'translateX(-50%)',
      zIndex: '20',
      color: '#e6dfcf',
      font: '13px/1.3 system-ui, sans-serif',
      letterSpacing: '0.06em',
      textShadow: '0 1px 3px #000',
      pointerEvents: 'none',
      display: 'none',
      textAlign: 'center',
    } as Partial<CSSStyleDeclaration>);
    const key = document.createElement('span');
    key.textContent = 'E';
    Object.assign(key.style, { display: 'inline-block', border: '1px solid rgba(230,223,207,.55)', borderRadius: '3px', padding: '0 5px', marginRight: '7px', fontSize: '11px' });
    this.promptText = document.createElement('span');
    const track = document.createElement('div');
    Object.assign(track.style, { width: '90px', height: '2px', margin: '6px auto 0', background: 'rgba(255,255,255,.12)' });
    this.bar = document.createElement('div');
    Object.assign(this.bar.style, { width: '0%', height: '100%', background: '#cfc8b8' });
    track.appendChild(this.bar);
    p.append(key, this.promptText, track);
    document.body.appendChild(p);
    this.prompt = p;
    // centre dot
    const dot = document.createElement('div');
    Object.assign(dot.style, { position: 'fixed', left: '50%', top: '50%', width: '3px', height: '3px', margin: '-1.5px 0 0 -1.5px', borderRadius: '50%', background: 'rgba(230,223,207,.35)', zIndex: '19', pointerEvents: 'none' });
    document.body.appendChild(dot);
    this.dot = dot;
  }
  /** The centre dot (hidden while interaction is inactive: cutscenes, menus — it sat in every C0/C1 frame). */
  private dot: HTMLElement | null = null;
  private dotOn = true;

  add(it: Interactable): void {
    this.items.push(it);
    const b = new THREE.Box3().setFromObject(it.object);
    if (!b.isEmpty()) this.centres.set(it, { c: b.getCenter(new THREE.Vector3()), r: b.getSize(new THREE.Vector3()).length() / 2 });
  }

  update(dt: number, active: boolean): void {
    const dotOn = active && !CUTSCENE_SCREEN.held;
    if (this.dot && this.dotOn !== dotOn) {
      this.dotOn = dotOn;
      this.dot.style.display = dotOn ? '' : 'none';
    }
    this.focus = active && this.enabled ? this.pick() : null;
    const label = this.focus?.label() ?? null;
    if (!this.focus || !label) {
      this.focus = null;
      if (this.shownLabel !== null) {
        this.shownLabel = null;
        this.prompt.style.display = 'none';
      }
      this.holdT = 0;
      this.endHold('cancel');
      return;
    }
    if (this.shownLabel !== label) {
      this.shownLabel = label;
      this.prompt.style.display = 'block';
      this.promptText.textContent = label;
    }
    const hold = this.focus.hold ?? 0;
    const barVis = hold > 0 ? 'visible' : 'hidden';
    if (this.barVis !== barVis) {
      this.barVis = barVis;
      (this.bar.parentElement as HTMLElement).style.visibility = barVis;
    }
    const fast = this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight');
    if (this.holding && this.holding !== this.focus) this.endHold('cancel');
    if (hold > 0) {
      if (this.input.isDown('KeyE')) {
        if (!this.holding) {
          this.holding = this.focus;
          this.onHold?.(this.focus, 'start');
        }
        this.holdT += dt;
        if (this.holdT >= hold) {
          this.holdT = 0;
          const it = this.focus;
          this.holding = null;
          it.use(fast);
          this.onHold?.(it, 'done');
        }
      } else {
        this.holdT = 0;
        this.endHold('cancel');
      }
      const wpc = `${Math.min(100, (this.holdT / hold) * 100).toFixed(1)}%`;
      if (this.bar.style.width !== wpc) this.bar.style.width = wpc;
    } else if (this.input.wasPressed('KeyE')) this.focus.use(fast);
  }

  private endHold(phase: 'cancel'): void {
    if (!this.holding) return;
    const it = this.holding;
    this.holding = null;
    this.onHold?.(it, phase);
  }

  /**
   * RUNTIME F4 (lead ruling: raycast proxies instead of full-mesh per-frame picks). `Raycaster.intersectObject` walked
   * every triangle of each interactable whose box the 3 m ray entered — every frame (heap-med, u1-armoire: three
   * getVertexPosition 87 MB + intersectTriangle 14 MB of the 316 MB allocated in 6 s → GC pressure). Now each mesh of
   * an item is a proxy box (its geometry's local bounding box, tested in the mesh's space: an exact OBB, no
   * allocation) that pre-filters the items; the exact triangle test then runs on the box candidates only every
   * EXACT_EVERY-th frame (or at once when the nearest box changes), so the prompt still means "aimed at the surface".
   */
  private proxies(it: Interactable): any[] {
    let list = this.proxyMeshes.get(it);
    if (!list) {
      list = [];
      it.object.traverse((m: any) => {
        if (!m.isMesh || !m.geometry) return;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        if (m.geometry.boundingBox && !m.geometry.boundingBox.isEmpty()) list!.push(m);
      });
      this.proxyMeshes.set(it, list);
    }
    return list;
  }

  /** Nearest proxy-box entry distance along the current ray (Infinity if none within reach). */
  private boxDistance(it: Interactable, reach: number): number {
    let best = Infinity;
    for (const m of this.proxies(it)) {
      if (!isShown(m)) continue;
      this._inv.copy(m.matrixWorld).invert();
      this._lr.copy(this.ray.ray).applyMatrix4(this._inv);
      const p = this._lr.intersectBox(m.geometry.boundingBox, this._p);
      if (!p) continue;
      p.applyMatrix4(m.matrixWorld);
      const d = p.distanceTo(this._o);
      if (d <= reach && d < best) best = d;
    }
    return best;
  }

  private pick(): Interactable | null {
    const cam = this.camera;
    cam.updateMatrixWorld();
    this._o.setFromMatrixPosition(cam.matrixWorld);
    cam.getWorldDirection(this._d);
    this.ray.set(this._o, this._d);
    let best: Interactable | null = null;
    let bd = Infinity;
    let n = 0;
    const cands = this.cands;
    cands.length = 0;
    for (const it of this.items) {
      const reach = it.reach ?? REACH;
      const cs = this.centres.get(it);
      if (cs && cs.c.distanceTo(this._o) > reach + cs.r + 0.5) continue;
      if (!isShown(it.object)) continue;
      const d = this.boxDistance(it, reach);
      if (!Number.isFinite(d)) continue;
      cands.push(it);
      n++;
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    if (n === 0) {
      this.exactAge = 0;
      this.exactBoxBest = null;
      return null;
    }
    // Exact surface test (the pre-F4 rule) on the box candidates — every EXACT_EVERY-th frame, or at once when the
    // nearest box changes; between those the last exact answer is held (≤ 3 frames = 50 ms at 60 fps).
    const boxBest = best;
    if (boxBest === this.exactBoxBest && this.exactAge > 0 && this.exactAge < EXACT_EVERY) {
      this.exactAge++;
      best = this.exactBest;
      bd = this.exactDist;
    } else {
      this.exactAge = 1;
      this.exactBoxBest = boxBest;
      best = null;
      bd = Infinity;
      for (const it of cands) {
        const reach = it.reach ?? REACH;
        const hits = this.ray.intersectObject(it.object, true);
        for (const h of hits) {
          if (h.distance > reach) break;
          if (!isShown(h.object)) continue;
          if (h.distance < bd) {
            bd = h.distance;
            best = it;
          }
          break;
        }
      }
      this.exactBest = best;
      this.exactDist = bd;
    }
    if (!best) return null;
    // line of sight: static collision closer than the hit (minus slack for the prop's own collider surface) blocks it
    const wall = this.level.collision.rayDistance(this._o, this._d, bd);
    if (wall < bd - 0.12) return null;
    return best;
  }
}

/** RUNTIME F4: exact pick cadence (frames) while the nearest proxy box stays the same. */
const EXACT_EVERY = 4;

function isShown(o: any): boolean {
  for (let n = o; n; n = n.parent) if (n.visible === false) return false;
  return true;
}

// ------------------------------------------------------------------------------------------ default bindings

/**
 * Readable props. The TEXT comes from src/story/documents.ts through the Director (`host.document`): the story
 * owns which document/page a read shows (ledger pages cycle p1 → p3, the guest-book sting …), so the world only
 * plays the paper sound and emits `interact`.
 */
const READ_ACTIONS = new Set(['read_guest_book', 'examine_portrait', 'examine_pump_photo', 'read_ledger', 'read_letter', 'read_ticket', 'read_can_plate']);

const TAKE_LABEL: Record<string, string> = {
  take_hammer: 'Claw hammer',
  take_shears: 'Sewing shears',
  take_locket: 'Locket',
  take_can: 'Jerry can',
};

export interface BindDeps {
  ctx: GameContext;
  level: Level;
  doors: DoorSystem;
  hides: HideSystem;
  inventory: Inventory;
  journal: Journal;
  sound: SoundSink | null;
  toast(text: string): void;
}

export function bindDefaultInteractions(ix: Interactables, d: BindDeps): void {
  const { ctx, level, doors, hides, inventory } = d;
  const emit = (id: string, action: string) => ctx.events.emit('interact', { id, action });
  const posOf = (o: any): [number, number, number] => {
    const b = new THREE.Box3().setFromObject(o);
    const c = b.getCenter(new THREE.Vector3());
    return [c.x, c.y, c.z];
  };
  const noise = (o: any, room: string, radius: number) => ctx.events.emit('noise', { pos: worldToPlan(posOf(o)) as [number, number, number], room, radius, source: 'prop' });

  // doors
  for (const door of doors.doors.values()) {
    if (!door.interactive) continue;
    ix.add({
      id: door.id,
      object: door.group,
      label: () => {
        if (door.lock === 'boarded') return null; // the boards are the interaction
        if (door.lock) {
          // the passage bolt is on the kitchen side: from there you slide it
          if (door.id === 'D_PASSAGE' && door.lock === 'bolted' && (level.room === 'G3P' || level.room === 'G3')) return 'Slide the bolt';
          return 'Try the door';
        }
        return door.target > 10 ? 'Close' : 'Open';
      },
      use: (fast) => {
        doors.toggle(door.id, fast);
        emit(door.id, door.target > 10 ? 'open' : 'close');
      },
    });
  }
  // Ada's boards: pry (hold) with the hammer
  const ada = doors.doors.get('D_ADA');
  for (const b of ada?.boards ?? []) {
    const k = Number(b.userData?.board ?? 0);
    ix.add({
      id: `board_${k}`,
      object: b,
      get hold() {
        return inventory.has('hammer') ? 2.0 : 0; // DESIGN: each pry is a 2 s hold (a press without the hammer explains)
      },
      action: 'pry',
      label: () => (!b.visible || b.userData.removed || ctx.flags.get(`ada_board_${k}`) ? null : inventory.has('hammer') ? 'Pry the board' : 'Nailed shut'),
      use: () => {
        if (!inventory.has('hammer')) {
          d.toast('The boards are nailed fast. I need something to pry them with.');
          return;
        }
        // The 14 m screech noise is emitted by the story (src/story/beats.ts onPry) so a pry inside a thunder roll
        // stays silent to her; the world only plays the sound.
        d.sound?.play('nail_screech', { pos: posOf(b), room: 'U1' });
        doors.livePry = k; // this plank falls (animated); flag restores snap it to the floor
        const flag = `ada_board_${k}`;
        ctx.flags.set(flag, true);
        ctx.events.emit('flag', { name: flag, value: true });
        doors.livePry = 0;
        emit(`board_${k}`, 'pry');
        if ([1, 2, 3].every((i) => ctx.flags.get(`ada_board_${i}`))) {
          ctx.flags.set('ada_boards_pried', true);
          ctx.events.emit('flag', { name: 'ada_boards_pried', value: true });
        }
      },
    });
  }
  // layout prop interactions
  for (const p of level.layout.props) {
    if (!p.interaction) continue;
    const obj = level.prop(p.id);
    if (!obj) continue;
    const act = p.interaction;
    let it: Interactable | null = null;
    if (act === 'hide') {
      const h = level.layout.hides.find((x) => x.propId === p.id);
      if (!h) continue;
      it = { id: p.id, object: obj, label: () => (hides.active ? null : 'Hide'), use: () => hides.enter(h.id) };
    } else if (READ_ACTIONS.has(act)) {
      it = {
        id: p.id,
        object: obj,
        action: act,
        label: () => (act.startsWith('read') ? 'Read' : 'Examine'),
        use: () => {
          d.sound?.play('paper', { gain: 0.7 });
          emit(p.id, act);
        },
      };
    } else if (act in TAKE_LABEL) {
      const itemId = act.replace(/^take_/, '');
      it = {
        id: p.id,
        object: obj,
        action: act,
        label: () => (inventory.has(itemId) ? null : `Take the ${TAKE_LABEL[act].toLowerCase()}`),
        use: () => {
          inventory.add({ id: itemId, label: TAKE_LABEL[act], propId: p.id });
          obj.visible = false;
          d.sound?.play('coat_rustle', { gain: 0.5 });
          d.toast(TAKE_LABEL[act]);
          emit(p.id, act);
        },
      };
    } else if (act === 'knock') {
      it = {
        id: p.id,
        object: obj,
        label: () => 'Knock',
        use: () => {
          d.sound?.play('knocker', { pos: posOf(obj), room: 'EXT2' });
          noise(obj, 'G1', 12);
          emit(p.id, act);
        },
      };
    } else if (act === 'ring_bell') {
      it = {
        id: p.id,
        object: obj,
        label: () => 'Pull the bell',
        use: () => {
          d.sound?.play('bell_knob', { pos: posOf(obj), room: 'EXT2' });
          const bell = level.prop('P_SPRING_BELL');
          if (bell) setTimeout(() => d.sound?.play('spring_bell', { pos: posOf(bell), room: 'G2' }), 180);
          noise(obj, 'G2', 12);
          emit(p.id, act);
        },
      };
    } else if (act === 'rattle_front_door') {
      it = {
        id: p.id,
        object: obj,
        label: () => (doors.lockOf('D_FRONT') ? 'Lift the bolt' : null),
        use: () => {
          d.sound?.play('bolt_box_clank', { pos: posOf(obj), room: 'G1' });
          noise(obj, 'G1', 6);
          d.toast("It won't lift. The bolt is held from somewhere else.");
          emit(p.id, act);
        },
      };
    } else if (act === 'cut_hem') {
      // B09: hold with the shears; without them, a press explains (the story toasts)
      it = {
        id: p.id,
        object: obj,
        action: act,
        get hold() {
          return inventory.has('shears') ? 1.6 : 0;
        },
        label: () => (ctx.flags.get('hem_cut') ? null : inventory.has('shears') ? 'Cut the hem' : 'The hem'),
        use: () => emit(p.id, act),
      };
    } else {
      const labels: Record<string, string> = { car: 'The car', peek_grate: 'Look through the grate', listen_hatch: 'Listen', pull_bell: 'Pull the bell' };
      it = { id: p.id, object: obj, action: act, label: () => labels[act] ?? 'Use', use: () => emit(p.id, act) };
    }
    if (it) ix.add(it);
  }
}
