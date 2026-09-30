// Runtime lights from the layout (docs/PLAN.md §2.5 "Candles and lamps"; CLAUDE.md light units):
//   bake_flicker → the lightmap already holds the full, steady light; a small UNSHADOWED PointLight adds only the
//                  flicker on top (±, ~FLICKER_SHARE of W/4π) plus an emissive flame billboard at the prop's
//                  `*-flame` anchor (docs/PROPS.md) or the light position.
//   flash        → lightning. Max has additive flash lightmaps (uLightning); every tier also gets runtime lights
//                  driven by the same level: a DirectionalLight from L_LTN_SUN for exterior surfaces and probe-lit
//                  objects outdoors, and SpotLights at the window portals (L_LTN_U1S/U2E/U3E) aimed into the rooms
//                  (tiers without flash maps only).
//   bake         → nothing at runtime (moon, sky: baked).
//   runtime      → headlights / dashboard: created on demand by the cutscene lane (not here: the car is dead).
// The light SET never changes after load (toggling light.visible changes the LightsNode hash → recompiles);
// lights are faded by intensity instead.

import * as THREE from 'three/webgpu';
import { Fn, float, mix, smoothstep, time, uniform, uv, vec2, vec3, vec4, sin } from 'three/tsl';
import type { LevelLayout, LightDef } from '../shared/layout-types.ts';
import { planToWorld } from '../shared/coords.ts';

/** Share of the baked light the runtime flicker light swings by. */
const FLICKER_SHARE = 0.22;
/** Constant moonlight (directional, lux-like units) under the lightning peak. */
export const MOONLIGHT = 0.07;

export interface FlickerLight {
  def: LightDef;
  light: any;
  flame: any | null;
  base: number;
  room: string;
  seed: number;
  /** 1 = full flicker; faded to 0 when the room is culled. */
  fade: number;
  uFlicker: any;
}

/** Approximate blackbody colour (linear sRGB, normalised) — Tanner Helland fit, then sRGB → linear. */
export function kelvinToLinearRGB(k: number): [number, number, number] {
  const t = k / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const lin = (c: number) => {
    const s = Math.min(255, Math.max(0, c)) / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const out: [number, number, number] = [lin(r), lin(g), lin(b)];
  const m = Math.max(...out);
  return [out[0] / m, out[1] / m, out[2] / m];
}

/** Candle/lantern flame: a soft teardrop billboard (additive, HDR so bloom catches it), flickering with uFlicker. */
function flameMaterial(kind: string, uFlicker: any, seed: number): any {
  const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const hot = kind === 'lamp' ? 1.4 : kind === 'lantern' ? 1.2 : 1.0;
  m.colorNode = Fn(() => {
    const p = uv().sub(vec2(0.5, 0.3)).toVar();
    // lean + lick: sideways wobble growing toward the tip
    const up = p.y.max(0);
    const wob = sin(time.mul(9.0).add(seed)).mul(0.03).add(sin(time.mul(23.0).add(seed * 2.0)).mul(0.012));
    p.x.subAssign(wob.mul(up.mul(up)).mul(4.0));
    // teardrop: round base (radius 0.2), long tapering tip (0.62 up), narrowing with height
    const ny = p.y.div(p.y.lessThan(0).select(float(0.2), float(0.62)));
    const nx = p.x.div(0.2).mul(up.mul(1.6).add(1));
    const d = vec2(nx, ny).length();
    const tip = uv().y.clamp(0, 1);
    const body = smoothstep(1.0, 0.35, d);
    const core = smoothstep(0.6, 0.0, d).mul(smoothstep(0.75, 0.25, tip));
    const blue = smoothstep(0.3, 0.12, tip).mul(body).mul(0.4);
    const flick = uFlicker.mul(0.25).add(0.8);
    const col = vec3(1.0, 0.46, 0.12).mul(body).add(vec3(1.0, 0.85, 0.55).mul(core.mul(1.6))).add(vec3(0.1, 0.18, 0.6).mul(blue));
    return vec4(col.mul(flick).mul(hot * 6.0), body);
  })();
  return m;
}

export class RuntimeLights {
  readonly group: any;
  readonly flickers: FlickerLight[] = [];
  /** Lightning: directional (exterior) + window spots (interior, tiers without flash maps). */
  readonly lightningDir: any;
  readonly lightningSpots: Array<{ light: any; room: string; peak: number }> = [];
  private readonly lightningPeakDir: number;
  /** Layout `mode: runtime` lights (headlights, dashboard): created dark, driven by the cutscene lane. */
  readonly runtime = new Map<string, { light: any; room: string }>();

  constructor(layout: LevelLayout, flameAnchors: Map<string, any>, opts: { lightningSpots: boolean; props?: Map<string, any> }) {
    this.group = new THREE.Group();
    this.group.name = 'runtime-lights';
    let seed = 1;
    for (const def of layout.lights) {
      if (def.mode === 'bake_flicker') {
        const [x, y, z] = planToWorld(def.pos);
        const c = kelvinToLinearRGB(def.kelvin);
        const base = def.watts / (4 * Math.PI);
        const light = new THREE.PointLight(new THREE.Color(c[0], c[1], c[2]), 0, def.role === 'lamp' || def.role === 'lantern' ? 7 : 4.5, 2);
        light.castShadow = false;
        light.position.set(x, y, z);
        light.name = `flicker_${def.id}`;
        this.group.add(light);
        const uFlicker = uniform(1);
        let flame: any = null;
        const anchor = nearestAnchor(flameAnchors, x, y, z, 0.6);
        const kind = String(anchor?.userData?.kind ?? def.role);
        flame = new THREE.Sprite(flameMaterial(kind, uFlicker, seed * 1.7));
        const h = kind === 'lamp' ? 0.085 : kind === 'lantern' ? 0.075 : 0.07;
        flame.scale.set(h * 0.5, h, 1);
        flame.center.set(0.5, 0.2);
        if (anchor) {
          anchor.updateWorldMatrix(true, false);
          const p = new THREE.Vector3().setFromMatrixPosition(anchor.matrixWorld);
          flame.position.copy(p);
        } else flame.position.set(x, y - 0.01, z);
        flame.renderOrder = 5;
        flame.castShadow = false;
        flame.name = `flame_${def.id}`;
        this.group.add(flame);
        this.flickers.push({ def, light, flame, base, room: def.room, seed: seed++, fade: 1, uFlicker });
      }
    }
    // Lightning: direction from L_LTN_SUN (sun watts are W/m² — used as a relative peak).
    const sun = layout.lights.find((l) => l.role === 'lightning' && l.type === 'sun');
    this.lightningDir = new THREE.DirectionalLight(new THREE.Color(...kelvinToLinearRGB(sun?.kelvin ?? 9000)), 0);
    const sp = planToWorld(sun?.pos ?? [-30, -60, 80]);
    const st = planToWorld(sun?.target ?? [4, 4, 0]);
    this.lightningDir.position.set(sp[0], sp[1], sp[2]);
    this.lightningDir.target.position.set(st[0], st[1], st[2]);
    this.lightningDir.castShadow = false;
    this.lightningDir.name = 'lightning-dir';
    this.group.add(this.lightningDir, this.lightningDir.target);
    this.lightningPeakDir = 2.2 * (sun ? Math.max(0.5, Math.min(2, sun.watts / 3)) : 1);
    if (opts.props) this.createRuntime(layout, opts.props);
    if (opts.lightningSpots) {
      for (const l of layout.lights) {
        if (l.role !== 'lightning' || l.type !== 'area' || !l.target) continue;
        const [x, y, z] = planToWorld(l.pos);
        const [tx, ty, tz] = planToWorld(l.target);
        const s = new THREE.SpotLight(new THREE.Color(...kelvinToLinearRGB(l.kelvin)), 0, 12, Math.PI / 3.2, 0.85, 2);
        s.castShadow = false;
        s.position.set(x, y, z);
        s.target.position.set(tx, ty, tz);
        s.name = `lightning_${l.id}`;
        this.group.add(s, s.target);
        // Area watts over a window-sized portal → peak candela.
        this.lightningSpots.push({ light: s, room: roomForTarget(layout, l.target), peak: (l.watts / (4 * Math.PI)) * 0.9 });
      }
    }
  }

  /**
   * `mode: runtime` lights, pre-created at load (the light set is fixed once LightsNodes exist) with intensity 0 and
   * `userData.csBase` = the layout watts / 4π. Headlights hang off the gate sedan (P_CAR_GATE), the dashboard light off
   * the car interior set, so they follow the `vehicle` track.
   */
  private createRuntime(layout: LevelLayout, props: Map<string, any>): void {
    for (const l of layout.lights) {
      if (l.mode !== 'runtime') continue;
      const c = new THREE.Color(...kelvinToLinearRGB(l.kelvin));
      const cd = l.watts / (4 * Math.PI);
      let light: any;
      if (l.type === 'spot') {
        light = new THREE.SpotLight(c, 0, 45, Math.PI / 7, 0.55, 2);
      } else light = new THREE.PointLight(c, 0, 2.5, 2);
      light.castShadow = false;
      light.name = `runtime_${l.id}`;
      light.userData.csBase = l.role === 'headlight' ? cd * 0.6 : cd;
      const parent = l.role === 'dashboard' ? props.get('P_CAR_INTERIOR') : l.role === 'headlight' ? props.get('P_CAR_GATE') : null;
      const [x, y, z] = planToWorld(l.pos);
      const tgt = l.target ? planToWorld(l.target) : null;
      if (parent) {
        parent.updateWorldMatrix(true, false);
        light.position.copy(parent.worldToLocal(new THREE.Vector3(x, y, z)));
        parent.add(light);
        if (light.isSpotLight && tgt) {
          light.target.position.copy(parent.worldToLocal(new THREE.Vector3(...tgt)));
          parent.add(light.target);
        }
      } else {
        light.position.set(x, y, z);
        this.group.add(light);
        if (light.isSpotLight && tgt) {
          light.target.position.set(...tgt);
          this.group.add(light.target);
        }
      }
      this.runtime.set(l.id, { light, room: l.room });
    }
  }

  /** Every runtime light (for LightsNode lists). */
  all(): any[] {
    return [...this.flickers.map((f) => f.light), this.lightningDir, ...this.lightningSpots.map((s) => s.light), ...[...this.runtime.values()].map((r) => r.light)];
  }

  /** Lights relevant to one lightmap atlas's rooms (keeps per-pixel light loops short on lightmapped surfaces). */
  forRooms(rooms: Set<string>, exterior: boolean): any[] {
    const out: any[] = [];
    for (const f of this.flickers) if (rooms.has(f.room)) out.push(f.light);
    if (exterior) out.push(this.lightningDir);
    for (const r of this.runtime.values()) if (rooms.has(r.room) || (exterior && r.room.startsWith('EXT'))) out.push(r.light);
    for (const s of this.lightningSpots) if (rooms.has(s.room)) out.push(s.light);
    return out;
  }

  /** visible: the culling set; outside: player is outdoors (lightning directional only lights exteriors then). */
  update(dt: number, t: number, visible: Set<string> | null, lightning: number, outside: boolean): void {
    for (const f of this.flickers) {
      const want = !visible || visible.has(f.room) ? 1 : 0;
      f.fade += (want - f.fade) * Math.min(1, dt * 6);
      // Layered flicker: slow breathing + fast licks + rare gutters (seeded per light).
      const s = f.seed;
      const slow = Math.sin(t * 1.3 + s) * 0.5 + Math.sin(t * 2.9 + s * 3.1) * 0.35;
      const fast = Math.sin(t * 17.0 + s * 5.3) * 0.25 + Math.sin(t * 31.0 + s * 1.7) * 0.15;
      const gutter = Math.sin(t * 0.37 + s * 7) > 0.97 ? -0.9 : 0;
      const k = Math.max(-1, Math.min(1, (slow + fast) * 0.6 + gutter));
      f.uFlicker.value = 1 + k * 0.5;
      // The baked light is the mean: the runtime light only adds the positive half of the swing (never negative
      // light) plus a small constant so the flicker reads on nearby surfaces.
      f.light.intensity = f.base * FLICKER_SHARE * Math.max(0, 0.35 + k * 0.65) * f.fade;
      if (f.flame) f.flame.visible = f.fade > 0.01;
    }
    // Overcast moonlight: a faint constant through the storm clouds so the ground, the house and her silhouette
    // read outdoors (the lightning shares the same light; inside, only the windows let a little through).
    this.lightningDir.intensity = (MOONLIGHT + lightning * this.lightningPeakDir) * (outside ? 1 : 0.15);
    for (const s of this.lightningSpots) s.light.intensity = lightning * s.peak * (!visible || visible.has(s.room) ? 1 : 0);
  }
}

function nearestAnchor(anchors: Map<string, any>, x: number, y: number, z: number, maxD: number): any | null {
  let best: any = null;
  let bd = maxD;
  const p = new THREE.Vector3();
  for (const a of anchors.values()) {
    a.updateWorldMatrix(true, false);
    p.setFromMatrixPosition(a.matrixWorld);
    const d = Math.hypot(p.x - x, p.y - y, p.z - z);
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return best;
}

function roomForTarget(layout: LevelLayout, t: [number, number, number]): string {
  let best = '';
  let area = Infinity;
  for (const r of layout.rooms) {
    if (r.kind !== 'interior') continue;
    const [x0, y0, x1, y1] = r.rect;
    const e = layout.floors.find((f) => f.id === r.floor)?.elevation ?? 0;
    if (t[0] >= x0 && t[0] <= x1 && t[1] >= y0 && t[1] <= y1 && t[2] >= e - 0.5 && t[2] <= e + r.ceiling + 0.5) {
      const a = (x1 - x0) * (y1 - y0);
      if (a < area) {
        area = a;
        best = r.id;
      }
    }
  }
  return best;
}
