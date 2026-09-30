// Hiding places (layout `hides[]`: armoire, coat wardrobe, Ada's wardrobe, the under-stair closet).
// Enter: the body stops, the camera moves to the layout eye (behind the slats) and looks along eyeYaw with a
// limited look cone; W presses the face to the slats (peek), Space holds the breath (player controller, ≤ 7 s),
// E leaves at the entry point. Emits `player:hide { hideId, inside }` (the AI's hide checks use it).

import type { Input } from '../core/input.ts';
import type { GameContext } from '../game/context.ts';
import type { HideDef } from '../shared/layout-types.ts';
import { planToWorld } from '../shared/coords.ts';
import type { PlayerController } from '../player/controller.ts';
import type { SoundSink } from './doors.ts';
import { headingToCameraYaw } from './rooms.ts';

const LOOK_YAW = 0.55;
const LOOK_PITCH = 0.35;
const PEEK = 0.07;

export class HideSystem {
  active: HideDef | null = null;
  /** Leaving with E is only allowed while gameplay owns the input (cutscene locks turn it off). */
  inputEnabled = true;
  private readonly ctx: GameContext;
  private readonly camera: any;
  private readonly player: PlayerController;
  private readonly input: Input;
  private sound: SoundSink | null;
  private dyaw = 0;
  private dpitch = 0;
  private peek = 0;
  private t = 0;
  private justEntered = false;
  private readonly hides: HideDef[];

  constructor(ctx: GameContext, camera: any, player: PlayerController, input: Input, sound: SoundSink | null) {
    this.ctx = ctx;
    this.camera = camera;
    this.player = player;
    this.input = input;
    this.sound = sound;
    this.hides = ctx.layout.hides ?? [];
  }

  setSound(s: SoundSink | null): void {
    this.sound = s;
  }

  enter(id: string): void {
    const h = this.hides.find((x) => x.id === id);
    if (!h || this.active) return;
    this.active = h;
    this.dyaw = 0;
    this.dpitch = 0;
    this.peek = 0;
    this.t = 0;
    this.justEntered = true;
    this.player.enabled = false;
    this.player.lookEnabled = false;
    this.player.velocity.set(0, 0, 0);
    const [x, y, z] = planToWorld(h.eye);
    this.sound?.play('armoire_slats', { pos: [x, y, z], gain: 0.8 });
    this.ctx.events.emit('player:hide', { hideId: h.id, inside: true });
  }

  exit(): void {
    const h = this.active;
    if (!h) return;
    this.active = null;
    const e = planToWorld([h.entry[0], h.entry[1], h.entry[2] + 1.65]);
    this.player.teleport(e, headingToCameraYaw(h.eyeYaw), 0); // facing out, the way the eye looked
    this.player.enabled = true;
    this.player.lookEnabled = true;
    this.sound?.play('armoire_slats', { pos: e, gain: 0.7 });
    this.ctx.events.emit('player:hide', { hideId: h.id, inside: false });
  }

  /** Call BEFORE the player controller (consumes the mouse while hidden). */
  update(dt: number): void {
    const h = this.active;
    if (!h) return;
    this.t += dt;
    const { dx, dy } = this.input.consumeMouse();
    const s = this.ctx.settings;
    const k = 0.0018 * s.mouseSensitivity;
    this.dyaw = clamp(this.dyaw - dx * k, -LOOK_YAW, LOOK_YAW);
    this.dpitch = clamp(this.dpitch - dy * k * (s.invertY ? -1 : 1), -LOOK_PITCH, LOOK_PITCH);
    const wantPeek = this.input.isDown('KeyW') ? 1 : 0;
    this.peek += (wantPeek - this.peek) * Math.min(1, dt * 6);
    if (!this.justEntered && this.inputEnabled && this.input.wasPressed('KeyE')) {
      this.exit();
      return;
    }
    this.justEntered = false;
    const yaw = headingToCameraYaw(h.eyeYaw) + this.dyaw;
    const [x, y, z] = planToWorld(h.eye);
    // cramped breathing sway, almost none while holding the breath
    const br = this.player.holdingBreath ? 0.0006 : 0.003;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    this.camera.position.set(x + fx * this.peek * PEEK, y + Math.sin(this.t * 1.6) * br, z + fz * this.peek * PEEK);
    this.camera.rotation.set(this.dpitch + Math.sin(this.t * 1.3) * br * 0.5, yaw, 0);
  }
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}
