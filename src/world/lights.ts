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
import { Fn, If, float, mix, pointShadow, smoothstep, time, uniform, uv, vec2, vec3, vec4, sin } from 'three/tsl';
import type { LevelLayout, LightDef } from '../shared/layout-types.ts';
import { planToWorld } from '../shared/coords.ts';
import { LOOK } from '../render/look.ts'; // LIGHTING lane: moon / lightning peak are live look values

/** Share of the baked light the runtime flicker light swings by. */
const FLICKER_SHARE = 0.22;
/** Constant moonlight (directional, lux-like units) under the lightning peak. */
export const MOONLIGHT = 0.07;

/**
 * PERF-PLAN P0-2: the one runtime light that ever casts a shadow (C2's candle tableau, C5's shadow-play, C7). It casts
 * from load — a castShadow toggle changes the LightsNode cache key, so every material on it (parlor atlas, characters,
 * arms) would be disposed and rebuilt twice per toggle pair. Outside those shots the shadow is muted (shadow.intensity
 * 0, a uniform) and its map is never re-rendered (autoUpdate false): the same look as an unshadowed light.
 */
export const SHADOW_LIGHT_ID = 'L_LAMP_PARLOR';
/** Before C2-ESCAPE K3 the table candle was the shadow light; a layout without the lamp still uses it. */
export const LEGACY_SHADOW_ID = 'L_CANDLE_TABLE';
/** @deprecated the resolved id is RuntimeLights.shadowId (the lamp, or the legacy candle on an old layout). */
export const SHADOW_CANDLE_ID = SHADOW_LIGHT_ID;
/** C2-ESCAPE §2.4: the rooms the roaming shadow light may light (it is in their atlases' light lists from load: the
 *  parlor (lamp, C5), the hall (fanlight stroke, B03 door gap), the upper hall/landing (U1 window stroke, B05 flash)). */
export const SHADOW_ROAM_ROOMS = ['G2', 'G1', 'U1'] as const;

/** Turns the fixed candle shadow on (map re-rendered every frame, full strength) or off (muted, map frozen). */
export function setCandleShadow(light: any, on: boolean): void {
  const sh = light?.shadow;
  if (!sh) return;
  if (light.userData?.alwaysShadow) {
    // C2-ESCAPE K3: the lamp is a 12 cd FULL direct light — muting its shadow would light the hall through WG_G1G2.
    // Its shadow stays on; "off" only freezes the map (RuntimeLights.update redraws it at 10 Hz while the parlor is
    // seen; ShadowRoam zeroes the light itself when it is dark)
    sh.intensity = 1;
    const u0 = light.userData.uShadowOn;
    if (u0) u0.value = light.intensity > 0 || on ? 1 : 0;
    // B7 measured (Medium, AC, 2026-10-09): a cube map redrawn EVERY frame at distance 7 m cost C2 ≈ +13 ms GPU
    // (13.9: 24.1 ms vs ≈ 11 before) → the approved fallback: distance 4.5 m (below) and the map at 30 Hz while a shot
    // needs it (C2, C5), 10 Hz otherwise while the parlor is seen — never autoUpdate
    sh.autoUpdate = false;
    light.userData.shHz = on ? 30 : 10;
    sh.needsUpdate = true;
    return;
  }
  sh.intensity = on ? 1 : 0;
  sh.autoUpdate = on;
  const u = light.userData?.uShadowOn;
  if (u) u.value = on ? 1 : 0;
  if (on) sh.needsUpdate = true;
}

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
  /** C2-ESCAPE K2/K3: direct light is all runtime (the bake holds only its indirect, `bakePass: 'indirect'`, or
   *  nothing yet, mode `runtime`): full diffuse share on lightmapped surfaces, a flat-wick flicker (2 % at 6–9 Hz). */
  direct?: boolean;
  /** Roaming (cutscene-fx shadowLight): the light is driven by the roam controller, not by the flicker loop. */
  roaming?: boolean;
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
    // LIGHTING lane: the core is the flame's own ~1900 K white (linear (1, 0.7, 0.3)), not a D65-neutral cream —
    // under the camera's 3300 K indoor white balance a (1, 0.85, 0.55) core read blue-white once blown out
    const col = vec3(1.0, 0.46, 0.12).mul(body).add(vec3(1.0, 0.7, 0.3).mul(core.mul(1.6))).add(vec3(0.1, 0.18, 0.6).mul(blue));
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
  /** r3 AD review: room → floor id, and the ground rooms a stair climbs out of (see update()). */
  private readonly roomFloor = new Map<string, string>();
  private readonly stairFoot = new Set<string>();
  private readonly lightningPeakDir: number;
  /** Layout `mode: runtime` lights (headlights, dashboard): created dark, driven by the cutscene lane. */
  readonly runtime = new Map<string, { light: any; room: string }>();
  /** Runtime lights that follow a prop (headlights → gate sedan, dashboard → car interior) without being its child. */
  private readonly followers: Array<{ light: any; parent: any; local: any; targetLocal: any | null }> = [];
  private readonly tmpV = new THREE.Vector3();
  /** The one cube-shadow light (PERF-PLAN P0-2 / C2-ESCAPE K3): the lamp, or the legacy table candle. */
  readonly shadowId: string;
  shadow: FlickerLight | null = null;

  constructor(layout: LevelLayout, flameAnchors: Map<string, any>, opts: { lightningSpots: boolean; props?: Map<string, any>; gateShadow?: boolean }) {
    for (const r of layout.rooms) this.roomFloor.set(r.id, r.floor);
    for (const st of layout.stairs ?? []) {
      const e = layout.floors.find((f) => f.id === st.from)?.elevation ?? 0;
      const foot = roomForTarget(layout, [st.start[0], st.start[1], e + 1]);
      if (foot) this.stairFoot.add(foot);
    }
    this.group = new THREE.Group();
    this.group.name = 'runtime-lights';
    let seed = 1;
    this.shadowId = layout.lights.some((l) => l.id === SHADOW_LIGHT_ID) ? SHADOW_LIGHT_ID : LEGACY_SHADOW_ID;
    for (const def of layout.lights) {
      const isShadow = def.id === this.shadowId;
      if (def.mode === 'bake_flicker' || isShadow) {
        const [x, y, z] = planToWorld(def.pos);
        const c = kelvinToLinearRGB(def.kelvin);
        const base = (def as any).cd ?? def.watts / (4 * Math.PI); // lamp: 151 W / 4π = 12.0 cd (flat-wick kerosene 10–15 cd)
        // the shadow lamp: 4.5 m (B7 fallback — fewer casters per cube face; the bake carries its far bounce)
        const light = new THREE.PointLight(new THREE.Color(c[0], c[1], c[2]), 0, isShadow ? 4.5 : def.role === 'lamp' || def.role === 'lantern' ? 7 : 4.5, 2);
        light.castShadow = false;
        if (isShadow) {
          light.castShadow = true; // fixed for the session (P0-2); muted until a shot needs it
          light.shadow.mapSize.set(512, 512);
          light.shadow.bias = -0.002;
          // R2-2: sample the cube map only while a shot uses it. shadow.intensity 0 still ran the 512² cube PCF in
          // every parlor/kitchen fragment (≈ 0.5 ms on Medium); a branch on a uniform skips it (coherent, no rebuild).
          // Not on Max: there the gated node costs Harlan's fragments a 17th sampler (> the M1's 16 per stage).
          if (opts.gateShadow !== false) {
            const uShadowOn = uniform(0);
            light.userData.uShadowOn = uShadowOn;
            const inner = pointShadow(light);
            light.shadow.shadowNode = Fn(() => {
              const s = vec3(1).toVar();
              If(uShadowOn.greaterThan(0.5), () => { s.assign(inner); });
              return s;
            })();
          }
          setCandleShadow(light, false);
          light.shadow.needsUpdate = true; // one render so the map is initialised
        }
        light.position.set(x, y, z);
        light.name = `flicker_${def.id}`;
        this.group.add(light);
        const uFlicker = uniform(1);
        // LIGHTING lane (REALISM-BACKLOG item 5): lightmapped surfaces take only this share of the light's DIFFUSE
        // (render/lightmap-material.ts LightmapLightingModel); its specular runs at the full candela.
        light.userData.lmDiffuseShare = uniform(FLICKER_SHARE * 0.35);
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
        const direct = isShadow && (def.mode === 'runtime' || (def as any).bakePass === 'indirect');
        if (direct) {
          light.userData.alwaysShadow = true;
          setCandleShadow(light, false); // shadow on, map frozen (redrawn by policy in update())
        }
        const f: FlickerLight = { def, light, flame, base, room: def.room, seed: seed++, fade: 1, uFlicker, direct };
        this.flickers.push(f);
        if (isShadow) this.shadow = f;
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
      if (l.mode !== 'runtime' || l.id === this.shadowId) continue;
      const c = new THREE.Color(...kelvinToLinearRGB(l.kelvin));
      const cd = l.cd ?? l.watts / (4 * Math.PI); // opening: layout `cd` (photometric, C1-OPENING §5.1) wins
      let light: any;
      if (l.type === 'spot') {
        light = new THREE.SpotLight(c, 0, 45, l.angle ? (l.angle * Math.PI) / 360 : Math.PI / 7, l.angle ? 1 : 0.55, 2);
      } else light = new THREE.PointLight(c, 0, 2.5, 2);
      light.castShadow = false;
      light.name = `runtime_${l.id}`;
      light.userData.csBase = l.role === 'headlight' && l.cd === undefined ? cd * 0.6 : cd;
      // opening: CAR-set lights (dash, dome, cab veil) follow the interior, the truck's lamps follow P_RC9_TRUCK
      const parent = l.role === 'dashboard' || l.room === 'CAR' ? props.get('P_CAR_INTERIOR') : l.role === 'headlight' ? props.get('P_CAR_GATE') : l.id.startsWith('L_TRUCK') ? props.get('P_RC9_TRUCK') : null;
      const [x, y, z] = planToWorld(l.pos);
      const tgt = l.target ? planToWorld(l.target) : null;
      if (parent) {
        // PERF (review): the light lives in the always-visible group and follows its prop in update(). Parented to
        // the car it left the scene's light list whenever room culling hid the car (indoors), which changes the
        // scene LightsNode key → every visible render object was rebuilt at each indoor/outdoor crossing
        // (measured: ~40–60 node builds per crossing, see docs/PERF-PLAN.md §8).
        parent.updateWorldMatrix(true, false);
        const local = parent.worldToLocal(new THREE.Vector3(x, y, z));
        const targetLocal = light.isSpotLight && tgt ? parent.worldToLocal(new THREE.Vector3(...tgt)) : null;
        this.group.add(light);
        if (targetLocal) this.group.add(light.target);
        this.followers.push({ light, parent, local, targetLocal });
        this.follow(this.followers[this.followers.length - 1]);
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
    for (const f of this.flickers) if (rooms.has(f.room) || (f === this.shadow && SHADOW_ROAM_ROOMS.some((r) => rooms.has(r)))) out.push(f.light);
    if (exterior) out.push(this.lightningDir);
    for (const r of this.runtime.values()) if (rooms.has(r.room) || (exterior && r.room.startsWith('EXT'))) out.push(r.light);
    for (const s of this.lightningSpots) if (rooms.has(s.room)) out.push(s.light);
    return out;
  }

  /** visible: the culling set; outside: player is outdoors (lightning directional only lights exteriors then). */
  update(dt: number, t: number, visible: Set<string> | null, lightning: number, outside: boolean, seen: Set<string> | null = visible, viewer: string | null = null): void {
    // r3 AD review (R3-4): in cutscenes (`visible` null) every flicker light ran — L_LANTERN (11–14 cd) and LAMP_U2
    // (5 cd), unshadowed, lit C2/C5 characters through the floors. Gate them like the lightning spots: rooms seen
    // from the camera, and another floor only from a stair-foot room or outdoors. Gameplay culling is unchanged.
    const vf = viewer ? this.roomFloor.get(viewer) : undefined;
    const crossOk = !viewer || this.stairFoot.has(viewer) || vf === 'exterior';
    for (const f of this.flickers) {
      if (f.roaming) continue; // cutscene-fx drives it (position, colour, intensity, shadow redraws)
      const floorOk = visible || !vf || crossOk || this.roomFloor.get(f.room) === vf;
      const want = (visible ? visible.has(f.room) : (!seen || seen.has(f.room)) && floorOk) ? 1 : 0;
      f.fade = visible ? f.fade + (want - f.fade) * Math.min(1, dt * 6) : want; // cutscene cuts: snap, no fade-in
      // Layered flicker: slow breathing + fast licks + rare gutters (seeded per light).
      const s = f.seed;
      const slow = Math.sin(t * 1.3 + s) * 0.5 + Math.sin(t * 2.9 + s * 3.1) * 0.35;
      const fast = Math.sin(t * 17.0 + s * 5.3) * 0.25 + Math.sin(t * 31.0 + s * 1.7) * 0.15;
      const gutter = Math.sin(t * 0.37 + s * 7) > 0.97 ? -0.9 : 0;
      const k = Math.max(-1, Math.min(1, (slow + fast) * 0.6 + gutter));
      f.uFlicker.value = 1 + k * 0.5;
      // The baked light is the mean: the runtime light only adds the positive half of the swing (never negative
      // light) plus a small constant so the flicker reads on nearby surfaces.
      // LIGHTING lane (item 5): the light itself runs at the candle's full candela base × (1 + 0.3k) — that is the
      // specular (absent from the diffuse-only bake). The diffuse on lightmapped surfaces is scaled back to exactly
      // the old swing FLICKER_SHARE × max(0, 0.35 + 0.65k) by the per-light share uniform.
      if (f.direct) {
        // §2.4 update policy outside cutscenes: the map is redrawn at 10 Hz while the parlor is in view (Harlan,
        // the door), frozen otherwise; a cutscene's cast_shadow cue sets autoUpdate (every frame in C2)
        const hz = f.light.userData.shHz ?? 10;
        // RUNTIME F review: never while the lamp is (nearly) dark — in C1 (`visible` null, the parlor unseen → fade 0)
        // the 10 Hz redraw cost 303 draws / 1.28 M tris every 6th frame on Max (C1 60.5 703 d / 2.54 M) for a light at
        // intensity 0, and at the B05 handover 482 d / 1.6 M at 0.02 cd (fade-out tail). Below 2 % of 12 cd its shadow
        // is invisible; the first frame above redraws at once (shT is not advanced while dark).
        if (!f.light.shadow.autoUpdate && f.fade > 0.02 && (hz > 10 || (visible ? visible.has(f.room) : true)) && t - (f.light.userData.shT ?? -1) > 1 / hz - 1e-4) {
          f.light.userData.shT = t;
          f.light.shadow.needsUpdate = true;
        }
        if (f.light.userData.uShadowOn) f.light.userData.uShadowOn.value = 1;
        // a flat wick is steadier than a candle: 2 % at 6–9 Hz (C2-ESCAPE §2.4); no bake under it → full diffuse
        const w = 0.012 * Math.sin(t * 2 * Math.PI * 6.3 + s) + 0.008 * Math.sin(t * 2 * Math.PI * 8.7 + s * 2.3);
        f.uFlicker.value = 1 + w * 4;
        f.light.intensity = f.base * (1 + w) * f.fade;
        f.light.userData.lmDiffuseShare.value = 1;
        if (f.flame) f.flame.visible = f.fade > 0.01 && f.base > 1e-3;
        continue;
      }
      const full = 1 + 0.3 * k;
      f.light.intensity = f.base * full * f.fade;
      f.light.userData.lmDiffuseShare.value = (FLICKER_SHARE * Math.max(0, 0.35 + k * 0.65)) / full;
      if (f.flame) f.flame.visible = f.fade > 0.01 && f.base > 1e-3; // a guttered candle (base 0) stays out
    }
    // LIGHTING lane (REALISM-BACKLOG item 2): indoors the directional would light rooms through the roof (its shadow
    // map only covers the outdoor strike), so it is 0 there — the window spots / flash lightmaps carry lightning inside; outdoors
    // only the moon key LOOK.moon (0: the bake already holds the 0.0028-lux moon and 0.024-lux sky) plus
    // the flash. Its outdoor shadow (drawn once per strike) lives in src/world/atmosphere.ts.
    this.lightningDir.intensity = outside ? LOOK.moon + lightning * this.lightningPeakDir * (LOOK.lightningPeak / 2.2) : 0;
    // R2-6: the window spots are unshadowed — gate them by the rooms seen from the CAMERA even while culling is off
    // (cutscenes): with `visible` null every upstairs spot fired through the floors (C5: U1/U2/U3 at 32 cd lit the
    // parlor — the cleaver's flat blue-white blade)
    // r3 AD review: …and by floor. The parlor (G2) 'sees' U2 through the ceiling grate, so U2's east-window spot
    // (31.8 cd, 7500 K, unshadowed) lit the parlor through the floor in every C5 flash — the cleaver's blue card and
    // a cold wash on Harlan/Ada (measured at C5-17.62). Another floor's spot stays on only when the viewer stands in
    // a stair-foot room (the hall looking up the stairwell at the landing window).
    // outdoors (gate, C1 reveal) the upper windows must still flash from inside: keep every seen spot there (crossOk)
    for (const s of this.lightningSpots) {
      const sameFloor = !vf || this.roomFloor.get(s.room) === vf;
      s.light.intensity = lightning * s.peak * ((!seen || seen.has(s.room)) && (sameFloor || crossOk) ? 1 : 0);
    }
    for (const f of this.followers) this.follow(f);
  }

  /** Places a follower light (and its spot target) at its prop-local offsets, in this group's space. */
  private follow(f: { light: any; parent: any; local: any; targetLocal: any | null }): void {
    f.parent.updateWorldMatrix(true, false);
    this.group.updateWorldMatrix(true, false);
    f.light.position.copy(this.group.worldToLocal(this.tmpV.copy(f.local).applyMatrix4(f.parent.matrixWorld)));
    if (f.targetLocal) f.light.target.position.copy(this.group.worldToLocal(this.tmpV.copy(f.targetLocal).applyMatrix4(f.parent.matrixWorld)));
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

// ------------------------------------------------------------------------------------------------ the roaming shadow light

/**
 * C2-ESCAPE §2.4 / K3 (B7): the session's one cube-shadow point light is the parlor lamp; a cutscene cue
 * `fx shadowLight {at, pulses}` moves it to an opening for a lightning stroke ("real shadows through real openings":
 * the fanlight's muntins, her silhouette, the balusters) and back. Stroke: a lightning-lit cloud seen through grimy
 * glass ≈ 2000 cd/m² over the fanlight's 0.55 m² ≈ 1100 cd peak, 8000 K, distance 9 m. Pulses rise in 30 ms and decay
 * with τ 60 ms; the last (continuing current) with τ 180 ms. The cube map is redrawn once at each pulse onset.
 */
export const ROAM_SPOTS = {
  /** outside the front-door fanlight (PLAN) */
  fanlight: [1.6, -1.5, 4.4],
  /** outside the U1 south window */
  u1_window: [2.1, -1.4, 5.6],
} as const;
export const STROKE_CD = 1100;
export const STROKE_K = 8000;

export interface RoamPulse {
  /** onset (s after the cue) */
  t: number;
  /** relative strength 0..1 (× STROKE_CD) */
  v: number;
  /** decay τ (s) */
  tau: number;
}

/** "v@t[:tau]" comma list → pulses (cue params are flat). */
export function parsePulses(s: string | undefined): RoamPulse[] {
  if (!s) return [];
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [v, rest] = x.split('@');
      const [t, tau] = (rest ?? '0').split(':');
      return { v: Number(v), t: Number(t), tau: tau !== undefined ? Number(tau) : 0.06 };
    })
    .sort((a, b) => a.t - b.t);
}

/** Stroke envelope 0..~1 at time t after the cue (sum of pulses: 30 ms linear rise, exponential decay). */
export function strokeEnvelope(p: RoamPulse[], t: number): number {
  let e = 0;
  for (const q of p) {
    const u = t - q.t;
    if (u < 0) continue;
    e += q.v * (u < 0.03 ? u / 0.03 : Math.exp(-(u - 0.03) / q.tau));
  }
  return e;
}

export class ShadowRoam {
  private readonly lights: RuntimeLights;
  private at: 'lamp' | 'off' | keyof typeof ROAM_SPOTS = 'lamp';
  private t = 0;
  private pulses: RoamPulse[] = [];
  private next = 0;
  private readonly home: { pos: any; color: any; distance: number } | null;
  private readonly strokeColor = new THREE.Color(...kelvinToLinearRGB(STROKE_K));

  constructor(lights: RuntimeLights, root: any = null) {
    this.lights = lights;
    // Glass transmits ≈ 90 % (F0 0.04 per face): a pane must not be an opaque caster, or the fanlight stroke never
    // reaches the hall floor (r4: the glazed fanlight blacked out the patch behind her). Applies to every caster the
    // session's shadow lights see (the lamp through the chimney, the torch through windows) — all physically right.
    root?.traverse?.((o: any) => {
      if (!o.isMesh || !o.castShadow) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some((m: any) => /glass|window_pane|chimney/i.test(String(m?.name ?? '')) || m?.transmission > 0)) o.castShadow = false;
    });
    const L = lights.shadow?.light;
    this.home = L ? { pos: L.position.clone(), color: L.color.clone(), distance: L.distance } : null;
  }

  get where(): string {
    return this.at;
  }

  /** at: 'lamp' (home, normal flicker), 'off' (direct off: the parlor door is shut), or an opening + pulses. */
  set(at: string, pulses: RoamPulse[] = []): void {
    const f = this.lights.shadow;
    if (!f || !this.home) return;
    const L = f.light;
    if (at === 'lamp') {
      this.at = 'lamp';
      f.roaming = false;
      if (L.userData.uShadowOn) L.userData.uShadowOn.value = 1;
      L.position.copy(this.home.pos);
      L.color.copy(this.home.color);
      L.distance = this.home.distance;
      L.shadow.needsUpdate = true;
      return;
    }
    f.roaming = true;
    if (at === 'off' || !(at in ROAM_SPOTS)) {
      this.at = 'off';
      L.intensity = 0;
      if (L.userData.uShadowOn) L.userData.uShadowOn.value = 0; // a dark light: skip the PCF
      return;
    }
    this.at = at as keyof typeof ROAM_SPOTS;
    const [x, y, z] = planToWorld(ROAM_SPOTS[this.at] as unknown as [number, number, number]);
    L.position.set(x, y, z);
    L.color.copy(this.strokeColor);
    L.distance = 9;
    L.intensity = 0;
    L.userData.lmDiffuseShare.value = 1; // nothing of a stroke is baked
    setCandleShadow(L, true);
    L.shadow.autoUpdate = false; // redrawn at each pulse onset only (4 cube renders per stroke)
    this.t = 0;
    this.pulses = pulses;
    this.next = 0;
  }

  /** Per frame after RuntimeLights.update (it skips a roaming light). */
  update(dt: number): void {
    const f = this.lights.shadow;
    if (!f || this.at === 'lamp') return;
    const L = f.light;
    if (this.at === 'off') {
      L.intensity = 0;
      if (L.userData.uShadowOn) L.userData.uShadowOn.value = 0;
      return;
    }
    if (L.userData.uShadowOn) L.userData.uShadowOn.value = 1;
    this.t += dt;
    while (this.next < this.pulses.length && this.t >= this.pulses[this.next].t) {
      L.shadow.needsUpdate = true; // the figures moved since the last pulse
      this.next++;
    }
    L.intensity = STROKE_CD * strokeEnvelope(this.pulses, this.t);
  }
}
