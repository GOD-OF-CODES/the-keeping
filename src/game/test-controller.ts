// Minimal first-person controller for the render test room (the real one is src/player/controller.ts, later).
// WASD by KeyboardEvent.code, Shift to walk faster, mouse look (pointer lock), head bob, AABB push-out.

import type { Input } from '../core/input.ts';
import type { Settings } from '../shared/types.ts';

export interface Box2 {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export class TestController {
  yaw: number;
  pitch = 0;
  readonly pos: { x: number; y: number; z: number };
  private bob = 0;
  private readonly camera: any;
  private readonly input: Input;
  private readonly bounds: Box2;
  private readonly obstacles: Box2[];
  private readonly eye: number;
  private readonly radius = 0.28;

  constructor(camera: any, input: Input, spawn: { pos: [number, number, number]; yaw: number }, bounds: Box2, obstacles: Box2[]) {
    this.camera = camera;
    this.input = input;
    this.bounds = bounds;
    this.obstacles = obstacles;
    this.pos = { x: spawn.pos[0], y: spawn.pos[1], z: spawn.pos[2] };
    this.eye = spawn.pos[1];
    this.yaw = spawn.yaw;
    camera.rotation.order = 'YXZ';
    this.apply(0);
  }

  update(dt: number, s: Settings): void {
    const { dx, dy } = this.input.consumeMouse();
    if (dt > 0) {
      const k = 0.0022 * s.mouseSensitivity;
      this.yaw -= dx * k;
      this.pitch -= dy * k * (s.invertY ? -1 : 1);
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    }
    const i = this.input;
    let f = 0;
    let r = 0;
    if (i.isDown('KeyW') || i.isDown('ArrowUp')) f += 1;
    if (i.isDown('KeyS') || i.isDown('ArrowDown')) f -= 1;
    if (i.isDown('KeyD') || i.isDown('ArrowRight')) r += 1;
    if (i.isDown('KeyA') || i.isDown('ArrowLeft')) r -= 1;
    const len = Math.hypot(f, r);
    let moving = false;
    if (len > 0 && dt > 0) {
      const speed = i.isDown('ShiftLeft') || i.isDown('ShiftRight') ? 2.4 : 1.35;
      f /= len;
      r /= len;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // Camera looks down −z at yaw 0.
      const vx = (-sin * f + cos * r) * speed;
      const vz = (-cos * f - sin * r) * speed;
      this.pos.x += vx * dt;
      this.pos.z += vz * dt;
      this.collide();
      moving = true;
      this.bob += dt * speed * 5.2;
    }
    this.apply(moving ? 1 : 0);
  }

  private collide(): void {
    const b = this.bounds;
    const r = this.radius;
    this.pos.x = Math.min(b.x1 - r, Math.max(b.x0 + r, this.pos.x));
    this.pos.z = Math.min(b.z1 - r, Math.max(b.z0 + r, this.pos.z));
    for (const o of this.obstacles) {
      const cx = Math.max(o.x0, Math.min(this.pos.x, o.x1));
      const cz = Math.max(o.z0, Math.min(this.pos.z, o.z1));
      const dx = this.pos.x - cx;
      const dz = this.pos.z - cz;
      const d = Math.hypot(dx, dz);
      if (d < r) {
        if (d > 1e-5) {
          this.pos.x = cx + (dx / d) * r;
          this.pos.z = cz + (dz / d) * r;
        } else {
          this.pos.z = o.z1 + r;
        }
      }
    }
  }

  private apply(moving: number): void {
    const bobY = moving ? Math.sin(this.bob) * 0.022 : 0;
    const bobX = moving ? Math.cos(this.bob * 0.5) * 0.012 : 0;
    this.camera.position.set(this.pos.x + bobX * Math.cos(this.yaw), this.eye + bobY, this.pos.z - bobX * Math.sin(this.yaw));
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
