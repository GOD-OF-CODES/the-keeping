// First-person player (docs/PLAN.md §2.7): pointer-lock mouselook (sensitivity / invert Y from settings), WASD,
// Shift run 3.6 m/s, walk 1.6, C/Ctrl crouch 0.9; capsule vs the world Octree + door blockers (src/world/collision),
// step-up for small ledges and ground snapping down stairs; head bob tied to the actual stride, breathing sway,
// landing dip; footsteps by acoustic surface zone + creaking boards / creaky stair treads → sounds and `noise`
// events (PLAN positions); stamina with panting after a sprint; Space holds the breath (≤ 7 s, gasp after).

import * as THREE from 'three/webgpu';
import type { Input } from '../core/input.ts';
import type { GameContext } from '../game/context.ts';
import { worldToPlan } from '../shared/coords.ts';
import type { AcousticSurface } from '../shared/layout-types.ts';
import { Capsule, type WorldCollision } from '../world/collision.ts';
import { CROUCH_EYE_HEIGHT, EYE_HEIGHT, type RoomIndex } from '../world/rooms.ts';
import { SURFACE_STEP } from '../audio/synth/footsteps.ts';

export const SPEED = { walk: 1.6, run: 3.6, crouch: 0.9 } as const;
export const BREATH_HOLD_MAX = 7;

const RADIUS = 0.27;
const HEIGHT = 1.78;
const CROUCH_HEIGHT = 1.2;
const GRAVITY = 9.81;
const STEP_UP = 0.32;
const SNAP_DOWN = 0.38;

/**
 * Noise radius (m) of one WALKING footstep per surface (DESIGN: runner 2, bare wood 4). Crouching is at most
 * CROUCH_NOISE (half the surface value), running is RUN_NOISE on every surface ("running is never safe").
 */
export const STEP_NOISE: Record<AcousticSurface, number> = {
  runner: 2,
  carpet: 1.8,
  bare_wood: 4,
  stair_wood: 4,
  porch_wood: 4,
  tile: 3.5,
  linoleum: 3,
  gravel: 4,
  mud: 2.5,
  grass: 2,
  asphalt: 2.5,
  car: 1,
};
export const CROUCH_NOISE = 1.5;
export const RUN_NOISE = 10;
export const CREAK_NOISE = 7;
/** Horizontal speed above which a step counts as running (walk 1.6, run 3.6). */
export const RUN_SPEED_THRESHOLD = 2.6;
/** Gasp after a long breath hold (DESIGN 3 m); forced at the 7 s limit: 5 m. */
export const GASP_NOISE = 3;


export interface PlayerAudio {
  play(id: string, o?: { gain?: number; rate?: number; pos?: [number, number, number]; room?: string }): unknown;
  layers?: { setBreath(kind: 'calm' | 'strained' | 'panting' | null, gain?: number): void };
}

export interface PlayerWorld {
  collision: WorldCollision;
  index: RoomIndex;
  /** Current room (tracked by the level from the camera). */
  room(): string | null;
}

const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

export class PlayerController {
  readonly feet = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  enabled = true;
  /** Mouse look only (hides / fixed cameras disable movement). */
  lookEnabled = true;
  onFloor = false;
  crouch = 0; // 0 standing … 1 crouched
  stamina = 1;
  holdingBreath = false;
  breathHeld = 0;
  surface: AcousticSurface = 'bare_wood';
  noclip = false;
  readonly capsule: any;

  private readonly camera: any;
  private readonly input: Input;
  private readonly ctx: GameContext;
  private readonly world: PlayerWorld;
  private audio: PlayerAudio | null = null;
  private phase = 0;
  private lastStepHalf = 0;
  private bobAmp = 0;
  private speedNow = 0;
  private runningNow = false;
  private runTime = 0;
  private pantT = 0;
  private breathState: 'calm' | 'strained' | 'panting' | null = null;
  private landDip = 0;
  private fallStartY = 0;
  private swayT = Math.random() * 10;
  private lastCreaker: string | null = null;
  private lastStair = -1;
  private runLocked = false;
  private readonly lastSafe = new THREE.Vector3();
  private safeT = 0;

  constructor(camera: any, input: Input, ctx: GameContext, world: PlayerWorld) {
    this.camera = camera;
    this.input = input;
    this.ctx = ctx;
    this.world = world;
    this.capsule = new Capsule(new THREE.Vector3(), new THREE.Vector3(0, HEIGHT - 2 * RADIUS, 0), RADIUS);
    camera.rotation.order = 'YXZ';
  }

  setAudio(a: PlayerAudio | null): void {
    this.audio = a;
  }

  /** Places the player so the EYE is at `eye` (world), looking along camera yaw/pitch. */
  teleport(eye: [number, number, number], yaw: number, pitch = 0): void {
    // Stand on whatever floor is under the eye (layout spawns give eye heights over the room's nominal floor; the
    // porch deck, stair treads … sit higher).
    const floor = this.world.collision.floorBelow(eye[0], eye[1] + 0.2, eye[2], 2.6);
    this.feet.set(eye[0], floor ?? eye[1] - EYE_HEIGHT, eye[2]);
    this.lastSafe.copy(this.feet);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = pitch;
    this.crouch = 0;
    this.syncCapsule();
    this.fallStartY = this.feet.y;
    this.onFloor = false;
    this.applyCamera(0, 0);
  }

  /** World eye position (without bob). */
  eye(): [number, number, number] {
    return [this.feet.x, this.feet.y + this.eyeHeight(), this.feet.z];
  }

  planFeet(): [number, number, number] {
    return worldToPlan([this.feet.x, this.feet.y, this.feet.z]);
  }

  /** Actual horizontal speed (m/s). */
  get speed(): number {
    return this.speedNow;
  }

  /** Sprint key held, moving forward and actually running (PlayerView.running). */
  get running(): boolean {
    return this.runningNow && this.speedNow > RUN_SPEED_THRESHOLD;
  }

  eyeHeight(): number {
    return EYE_HEIGHT + (CROUCH_EYE_HEIGHT - EYE_HEIGHT) * this.crouch;
  }

  update(dt: number, t: number): void {
    const s = this.ctx.settings;
    const { dx, dy } = this.input.consumeMouse();
    if (this.lookEnabled && dt > 0) {
      const k = 0.0022 * s.mouseSensitivity;
      this.yaw -= dx * k;
      this.pitch -= dy * k * (s.invertY ? -1 : 1);
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    }
    if (!this.enabled || dt <= 0) {
      this.runningNow = false;
      if (!this.enabled) this.speedNow = 0;
      this.updateBreath(dt, false);
      if (this.enabled) this.applyCamera(dt, t);
      return;
    }
    const i = this.input;
    // ---- intent
    let f = 0;
    let r = 0;
    if (i.isDown('KeyW') || i.isDown('ArrowUp')) f += 1;
    if (i.isDown('KeyS') || i.isDown('ArrowDown')) f -= 1;
    if (i.isDown('KeyD') || i.isDown('ArrowRight')) r += 1;
    if (i.isDown('KeyA') || i.isDown('ArrowLeft')) r -= 1;
    const wantCrouch = i.isDown('KeyC') || i.isDown('ControlLeft') || i.isDown('ControlRight');
    const shift = i.isDown('ShiftLeft') || i.isDown('ShiftRight');
    const moving = f !== 0 || r !== 0;
    // crouch: only stand up when there's headroom
    const crouchTarget = wantCrouch ? 1 : this.headroomFor(HEIGHT) ? 0 : this.crouch;
    this.crouch += (crouchTarget - this.crouch) * Math.min(1, dt * 8);
    if (this.stamina <= 0.02) this.runLocked = true;
    if (this.stamina > 0.3) this.runLocked = false;
    const running = shift && moving && f > 0 && this.crouch < 0.3 && !this.runLocked;
    this.runningNow = running;
    const target = !moving ? 0 : this.crouch > 0.5 ? SPEED.crouch : running ? SPEED.run : SPEED.walk;
    // ---- stamina / breath
    if (running) {
      this.stamina = Math.max(0, this.stamina - dt / 8);
      this.runTime += dt;
    } else {
      this.stamina = Math.min(1, this.stamina + dt / (moving ? 14 : 9));
      if (this.runTime > 1.5) this.pantT = Math.max(this.pantT, Math.min(10, this.runTime * 0.9));
      this.runTime = 0;
    }
    this.updateBreath(dt, running);

    // ---- horizontal velocity
    const len = Math.hypot(f, r) || 1;
    _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = _v.set(0, 0, 0).addScaledVector(_fwd, f / len).addScaledVector(_right, r / len).multiplyScalar(target);
    const accel = this.onFloor ? (target > this.speedNow ? 9 : 12) : 1.5;
    const a = 1 - Math.exp(-accel * dt);
    this.velocity.x += (wish.x - this.velocity.x) * a;
    this.velocity.z += (wish.z - this.velocity.z) * a;

    // ---- integrate + collide (substeps keep the 0.27 m capsule out of thin walls)
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    const wasOnFloor = this.onFloor;
    for (let k = 0; k < steps; k++) this.step(h);
    if (!wasOnFloor && this.onFloor) {
      const fall = this.fallStartY - this.feet.y;
      if (fall > 0.35) {
        this.landDip = Math.min(0.09, 0.03 + fall * 0.03);
        this.footstep(Math.min(1.5, 0.8 + fall * 0.4), true);
      }
    }
    if (this.onFloor) this.fallStartY = this.feet.y;
    else this.fallStartY = Math.max(this.fallStartY, this.feet.y);

    // ---- bob / footsteps from the ACTUAL horizontal speed
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    this.speedNow = hs;
    if (this.onFloor && hs > 0.15) {
      const stride = hs > 2.6 ? 1.05 : this.crouch > 0.5 ? 0.55 : 0.72; // metres per step
      this.phase += (hs / stride) * Math.PI * dt;
      const half = Math.floor(this.phase / Math.PI);
      if (half !== this.lastStepHalf) {
        this.lastStepHalf = half;
        this.footstep(hs > 2.6 ? 1.25 : this.crouch > 0.5 ? 0.45 : 0.85, false);
      }
    }
    const ampTarget = this.onFloor ? Math.min(1, hs / SPEED.run) : 0;
    this.bobAmp += (ampTarget - this.bobAmp) * Math.min(1, dt * 6);
    this.applyCamera(dt, t);
  }

  private step(h: number): void {
    const c = this.capsule;
    c.end.set(c.start.x, c.start.y + HEIGHT + (CROUCH_HEIGHT - HEIGHT) * this.crouch - 2 * RADIUS, c.start.z);
    if (this.noclip) {
      this.feet.addScaledVector(this.velocity, h);
      this.syncCapsule();
      this.onFloor = true;
      return;
    }
    if (!this.onFloor) this.velocity.y -= GRAVITY * h;
    else this.velocity.y = Math.max(this.velocity.y - GRAVITY * h, -1);
    const start = c.start.clone();
    const move = _v.copy(this.velocity).multiplyScalar(h);
    c.translate(move);
    const vel = this.velocity;
    const hit = this.world.collision.resolve(c, vel);
    let onFloor = hit.onFloor;
    // step-up: blocked while grounded and moving → try the same move from STEP_UP higher
    if (hit.hitWall && this.onFloor) {
      const wantH = Math.hypot(move.x, move.z);
      const got = Math.hypot(c.start.x - start.x, c.start.z - start.z);
      if (wantH > 1e-5 && got < wantH * 0.6) {
        const trial = c.clone();
        trial.translate(new THREE.Vector3(start.x - c.start.x, start.y + STEP_UP - c.start.y, start.z - c.start.z));
        if (!this.world.collision.octree.capsuleIntersect(trial)) {
          trial.translate(new THREE.Vector3(move.x, 0, move.z));
          if (!this.world.collision.octree.capsuleIntersect(trial)) {
            c.copy(trial);
            onFloor = this.snapDown(STEP_UP + 0.05) || onFloor;
          }
        }
      }
    }
    // ground snap: walking down stairs / off the porch step keeps contact instead of hopping
    if (!onFloor && this.onFloor && this.velocity.y <= 0) onFloor = this.snapDown(SNAP_DOWN);
    this.onFloor = onFloor;
    // world bounds (the drive, yard and road; the fog hides the edge): slide back horizontally
    if (!this.world.index.inBounds(c.start.x, -c.start.z, c.start.y - RADIUS)) {
      c.translate(new THREE.Vector3(start.x - c.start.x, 0, start.z - c.start.z));
      this.velocity.x = 0;
      this.velocity.z = 0;
    }
    this.feet.set(c.start.x, c.start.y - RADIUS, c.start.z);
    // fall-through guard (holes in collision, spawning inside a collider): back to the last safe standing spot
    if (onFloor) {
      this.safeT += h;
      if (this.safeT > 0.25) {
        this.lastSafe.copy(this.feet);
        this.safeT = 0;
      }
    }
    if (this.feet.y < -0.6 || this.feet.y < this.lastSafe.y - 4) {
      this.feet.copy(this.lastSafe);
      this.feet.y += 0.05;
      this.velocity.set(0, 0, 0);
      this.syncCapsule();
    }
  }

  private snapDown(dist: number): boolean {
    const c = this.capsule;
    const trial = c.clone();
    trial.translate(new THREE.Vector3(0, -dist, 0));
    const v = new THREE.Vector3();
    const hit = this.world.collision.resolve(trial, v);
    if (hit.onFloor && trial.start.y < c.start.y + 1e-4) {
      c.copy(trial);
      return true;
    }
    return false;
  }

  private headroomFor(height: number): boolean {
    if (this.noclip) return true;
    const trial = new Capsule(this.capsule.start.clone(), this.capsule.start.clone().add(new THREE.Vector3(0, height - 2 * RADIUS, 0)), RADIUS * 0.9);
    const r = this.world.collision.octree.capsuleIntersect(trial);
    return !r || r.normal.y > 0.5;
  }

  private syncCapsule(): void {
    const hgt = HEIGHT + (CROUCH_HEIGHT - HEIGHT) * this.crouch;
    this.capsule.start.set(this.feet.x, this.feet.y + RADIUS, this.feet.z);
    this.capsule.end.set(this.feet.x, this.feet.y + hgt - RADIUS, this.feet.z);
  }

  private footstep(weight: number, landing: boolean): void {
    const [px, py, pz] = this.planFeet();
    const room = this.world.room();
    const idx = this.world.index;
    this.surface = idx.surfaceAt(room, px, py);
    const walk = STEP_NOISE[this.surface];
    let radius = (this.speedNow > RUN_SPEED_THRESHOLD ? RUN_NOISE : this.crouch > 0.5 ? Math.min(CROUCH_NOISE, walk * 0.5) : walk) * (landing ? 1.8 : 1);
    const snd = SURFACE_STEP[this.surface] ?? 'step_bare';
    this.audio?.play(snd, { gain: Math.min(1.4, weight), rate: 0.96 + Math.random() * 0.08 });
    // creaking boards (radius) and creaky stair treads
    const cr = idx.creakerAt(room, px, py);
    const st = idx.stairStepAt(px, py, pz);
    const creakyTread = st && st.stair.creakySteps.includes(st.step) && st.step !== this.lastStair ? st : null;
    this.lastStair = st?.step ?? -1;
    const creak = (cr && cr.id !== this.lastCreaker) || creakyTread;
    this.lastCreaker = cr?.id ?? null;
    if (creak && this.crouch < 0.8) {
      this.audio?.play('step_creaker', { gain: this.crouch > 0.5 ? 0.5 : 1 });
      radius = Math.max(radius, CREAK_NOISE * (this.crouch > 0.5 ? 0.6 : 1));
    }
    if (room) this.ctx.events.emit('noise', { pos: [px, py, pz], room, radius, source: 'player' });
  }

  private updateBreath(dt: number, running: boolean): void {
    const space = this.input.isDown('Space');
    if (space && !this.holdingBreath && this.breathHeld === 0) {
      this.holdingBreath = true;
      this.ctx.events.emit('player:breath', { holding: true });
    }
    if (this.holdingBreath) {
      this.breathHeld += dt;
      if (!space || this.breathHeld >= BREATH_HOLD_MAX) {
        const forced = this.breathHeld >= BREATH_HOLD_MAX;
        this.holdingBreath = false;
        this.ctx.events.emit('player:breath', { holding: false });
        if (this.breathHeld > 4.5) {
          this.audio?.play('gasp', { gain: forced ? 1 : 0.6 });
          const [px, py, pz] = this.planFeet();
          const room = this.world.room();
          if (room) this.ctx.events.emit('noise', { pos: [px, py, pz], room, radius: forced ? 5 : GASP_NOISE, source: 'player' });
          this.pantT = Math.max(this.pantT, forced ? 5 : 2.5);
        }
      }
    } else if (!space) this.breathHeld = 0;
    this.pantT = Math.max(0, this.pantT - dt);
    let want: 'calm' | 'strained' | 'panting' | null = this.holdingBreath ? null : this.pantT > 0 ? 'panting' : running && this.stamina < 0.5 ? 'strained' : 'calm';
    if (want !== this.breathState) {
      this.breathState = want;
      this.audio?.layers?.setBreath(want, want === 'calm' ? 0.35 : want === 'panting' ? 0.9 : 0.7);
    }
  }

  /** Re-applies the player camera pose (the cutscene bindings call it when they hand the camera back). */
  applyCamera(dt: number, t: number): void {
    this.swayT += dt;
    const pant = this.pantT > 0 ? Math.min(1, this.pantT / 4) : 0;
    const held = this.holdingBreath ? 0.2 : 1;
    // breathing sway (idle): slow pitch + a hint of yaw; bigger while panting, nearly still while holding breath
    const br = (0.0025 + 0.006 * pant) * held;
    const bf = 0.23 + 0.35 * pant;
    const swayPitch = Math.sin(this.swayT * Math.PI * 2 * bf) * br;
    const swayYaw = Math.sin(this.swayT * Math.PI * 2 * bf * 0.5 + 1.3) * br * 0.6;
    // stride bob: vertical dip at each foot plant, lateral once per two steps, tiny roll
    const a = this.bobAmp;
    const vy = -(1 - Math.abs(Math.sin(this.phase))) * 0.045 * a + 0.02 * a;
    const vx = Math.sin(this.phase) * 0.028 * a;
    const roll = Math.sin(this.phase) * 0.006 * a;
    this.landDip *= Math.exp(-dt * 7);
    const eyeH = this.eyeHeight();
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    this.camera.position.set(this.feet.x + vx * cos, this.feet.y + eyeH + vy - this.landDip + Math.sin(this.swayT * Math.PI * 2 * bf) * 0.004 * pant, this.feet.z - vx * sin);
    this.camera.rotation.set(this.pitch + swayPitch, this.yaw + swayYaw, roll);
  }
}
