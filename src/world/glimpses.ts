// The opening's "middle of nowhere" glimpses (docs/C1-OPENING.md §3 C0, §4, §7.4–7.6, §7.11), opening-runtime
// builder 2. Driven through cutscene fx cues (dispatched from opening.ts):
//   c0_look {on}           C0's look: the aerial camera range (near 1 m / far 2000 m, §7.4), C0 fog + darkness so the
//                          canopy sheet past ≈ 200 m dissolves into the rain (§7.5)
//   billboard {flutter}    the peeling strips on P_RC9_BILLBOARD flutter in the wind (0 = still)
// Every frame while a cutscene holds the camera on the road (C0 / C1 / C7): the camera's near/far follow the shot —
// gameplay keeps near 0.03 / far 90 (main.ts), which clipped every long view of the opening (the C0 aerial showed
// nothing but fog; the lantern and NEXT SERVICES at 160 m in C1). Restored the moment the camera is released.

import { createYardCull } from './yard-cull.ts';
import * as THREE from 'three/webgpu';
import { clamp, positionLocal, sin, smoothstep, time, uniform, vec3 } from 'three/tsl';
import { LOOK } from '../render/look.ts';
import { SKY_U } from './atmosphere.ts';
import type { Level } from './level.ts';
import { RETRO, makeRetro, retroLuminance, updateRetroLamps } from './retro.ts';
import { drawVfd } from './decals.ts';

type Params = Record<string, number | string | boolean>;

export interface GlimpseDeps {
  level: Level;
  camera: any;
  cameraHeld: () => boolean;
  /** The detailed interior rides the car (C1 POV / car-space shots). */
  mounted: () => boolean;
  /** Our sedan (P_CAR_GATE), moved by the vehicle track. */
  car: any;
  presetId?: 'low' | 'medium' | 'max';
  /** The storm-night opening (C0/C1): the interior props stay hidden even at the gate. */
  night?: () => boolean;
}

/**
 * C0 look (§3 shot 1 "fog 0.003", §7.5). Physical reasoning per key:
 *  - fogDensity 0.003: V = √3 / D = 577 m of heavy-rain visibility (σ = 0.0068 /m).
 *  - fogScale 0.45: the haze's in-scatter radiance is the average of what lights it — the overcast above (the horizon
 *    sky) AND the black forest below (≈ 0) — so ≈ half the horizon sky from an aerial, not all of it (the default 1
 *    is a ground-level value; at 1 the whole canopy greyed to the horizon colour, r2 frame 6 s).
 *  - groundL 0.0018 cd/m²: the sky shader's "ground below the horizon" = the fogged far canopy (fog colour ≈
 *    0.00327 × 0.45 × 1.3 = 0.0019) so the geometry's far edge has no seam against the shader band.
 *  - treeR0/R1/H: the sky treeline becomes the far ridges — crown-fringed forested ridges 1.4–3.2 km out whose tops
 *    sit 0.2–1.0° above the horizon (top 14–34 m above the shader's eye at 2 km; r3: H 40 read as a row of identical cotton-ball domes); fogged to a silhouette darker than
 *    the deck, black against the lit cloud base in a flash.
 */
/* AD review (open-review m1/m2, C0 4.5 / 9.25): at fogScale 0.45 the whole forest read as one grey-blue veil (a
 * "foggy matte painting", not a black forest under overcast), and treeH 34 made the far ridges a row of identical
 * cotton-ball bumps. A real night aerial over conifer forest in rain: canopy ≈ black (albedo 0.03 under ≈ 0.01 lux),
 * the haze only visible as depth fade toward the horizon. fogScale 0.3 (in-scatter ≈ ⅓ of the horizon sky — the
 * forest below contributes ≈ 0) and lower ridges (treeH 22 → 0.13–0.6° above the horizon) keep the car's pool the
 * only bright thing. groundL scales with fogScale (0.0019 × 0.3 / 0.45 ≈ 0.0012) so the far edge stays seamless. */
const C0_LOOK: Record<string, number> = {
  fogDensity: 0.003,
  fogMist: 0,
  fogScale: 0.3,
  groundL: 0.0012,
  treeR0: 3000,
  treeR1: 6000,
  treeH: 22,
};
/** The house (PLAN ≈ (2, 5)): ground-level exterior shots end their far plane short of it (fog has eaten it by then:
 *  e^(−0.0068 · 400) = 7 %), so a camera 700 m down the road does not draw EXT2 (1.04 M tris). */
/** Low ships no L2 crown band (details_corridor Low: 1387 trees, the canopy blanket begins at n ≈ 54 m): its aerial
 *  must read through fog — V = √3 / 0.0045 = 385 m swallows the bare blanket before its edge shows. */
const C0_LOOK_LOW: Record<string, number> = { ...C0_LOOK, fogDensity: 0.0045 };
const HOUSE_PLAN: [number, number] = [2, 5];

export function createGlimpses(d: GlimpseDeps) {
  const cam = d.camera;
  const indoor = new Set(d.level.layout.props.filter((p: any) => !/^(EXT|RC9|CAR)/.test(p.room)).map((p: any) => p.id as string));
  const yard = createYardCull(d.level.root, HOUSE_PLAN, indoor); // AD review: S8 budget (yard dressing beyond 60 m, interiors)
  let c0 = false;
  let saved: { near: number; far: number } | null = null;
  let lookSaved: Record<string, number> | null = null;
  let flutter = 0;
  const { level } = d;

  // ---- retroreflection (§7.6): the hero guide sign + county shields (decal meshes flagged `retro`), the centre-line
  // paint and the corridor's post reflectors. Installed at load (decals.ts has bound the decal materials by now), so
  // the load-time warm-up compiles them.
  const retroMats = new Set<any>();
  for (const id of ['P_RC9_NEXT_SERVICES', 'P_RC9_CR9_A', 'P_RC9_CR9_B']) {
    level.prop(id)?.traverse((o: any) => {
      if (o.isMesh && o.userData?.retro && makeRetro(o.material, RETRO.sheeting)) retroMats.add(o.material);
    });
  }
  let reflectorMat: any = null;
  level.root?.traverse((o: any) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (/_paint$/.test(o.name) && mats[0]?.name === 'paint_road_yellow' && makeRetro(mats[0], RETRO.paint)) retroMats.add(mats[0]);
    if (/reflector/.test(o.name)) {
      // the prismatic lens is the glass part (trim_chipped is the post): one shared retro clone for every reflector
      const i = mats.findIndex((m: any) => m?.name === 'glass_grimy');
      if (i < 0) return;
      if (!reflectorMat) {
        reflectorMat = mats[i].clone();
        makeRetro(reflectorMat, RETRO.reflector, [0.85, 0.82, 0.7]);
        retroMats.add(reflectorMat);
      }
      if (Array.isArray(o.material)) o.material[i] = reflectorMat;
      else o.material = reflectorMat;
    }
  });

  // ---- deer (§7.11): per-deer head yaw from the root's params (the shared mesh carries none), eye-shine glints
  const lampL = level.runtimeLight('L_HEADLIGHT_L');
  const lampR = level.runtimeLight('L_HEADLIGHT_R');
  const eyes: Array<{ anchor: any; quad: any; area: any; deer: number }> = [];
  const eyeGeo = new THREE.PlaneGeometry(1, 1);
  const EYE_D = 0.008; // a deer's night-dilated pupil ≈ 8 mm wide (the tapetum glints through it; §7.11 "3 mm discs" ≈ r)
  for (let i = 1; i <= 3; i++) {
    const root = level.prop(`P_RC9_DEER_${i}`);
    if (!root) continue;
    let params: Record<string, any> = {};
    try {
      params = typeof root.userData?.params === 'string' ? JSON.parse(root.userData.params) : (root.userData?.params ?? {});
    } catch {
      params = {};
    }
    root.traverse((o: any) => {
      const ud = o.userData ?? {};
      if (ud.turn_joint && ud.yaw_param) o.rotateY(Number(params[ud.yaw_param] ?? 0)); // about the head's local up
    });
    root.traverse((o: any) => {
      if (!o.userData?.eye_glint) return;
      const tint = (o.userData.glint_color as [number, number, number]) ?? [0.85, 1.0, 0.8];
      const area = uniform(1);
      const m = new THREE.MeshBasicNodeMaterial();
      // luminance = the tapetum's retro × our lamps' E × f(α), × (true pupil area / drawn quad area): a sub-pixel glint
      // keeps its flux when the quad is held at ≥ 1.5 px
      m.colorNode = vec3(...tint).mul(retroLuminance()).mul(RETRO.eye).mul(area);
      m.transparent = true;
      m.blending = THREE.AdditiveBlending;
      m.depthWrite = false;
      m.depthTest = false; // the anchor sits on the head surface: a sub-pixel glint must not lose to its own eyelid (r5)
      m.fog = false;
      m.toneMapped = true;
      const q = new THREE.Mesh(eyeGeo, m);
      q.name = `${o.name}-glint`;
      q.frustumCulled = false;
      q.renderOrder = 5;
      q.visible = false;
      o.add(q);
      eyes.push({ anchor: o, quad: q, area, deer: i });
    });
  }
  const eyesOn = new Set<number>();
  let warm = false;
  const _dir = new THREE.Vector3();

  // ---- the billboard's torn strips (`-billboard-peel`, local: face at z ≈ 0, strips curl out to z 1.65, hang from the
  // tears between y 3.0 and 6.5; the fallen sheets lie at y ≈ 0): a wet-paper flap in the gusts. Weighted by height
  // (fallen sheets stay put) and by how far the strip has curled off the face (the free ends move, the glued roots
  // don't). Wet poster paper ≈ 120 g/m² flaps at 1–2 Hz in a 6–10 m/s wind.
  const uFlutter = uniform(0);
  level.prop('P_RC9_BILLBOARD')?.traverse((o: any) => {
    if (!o.isMesh || !o.userData?.flutter || !o.material) return;
    const m = o.material.clone();
    const y = positionLocal.y;
    const z = positionLocal.z;
    const w = smoothstep(0.6, 3.0, y).mul(clamp(z.div(0.45), 0.15, 1)).mul(uFlutter);
    const ph = positionLocal.x.mul(1.9).add(y.mul(2.6));
    const flap = sin(time.mul(9.4).add(ph)).mul(0.6).add(sin(time.mul(5.3).add(ph.mul(0.7))).mul(0.4));
    const gust = sin(time.mul(0.9)).mul(0.35).add(0.65);
    m.positionNode = positionLocal.add(vec3(flap.mul(0.025), flap.mul(0.015), flap.mul(0.07).mul(gust)).mul(w));
    o.material = m;
  });

  // ---- the radio's VFD (S1 seek): the decal canvas is redrawn as the tuner races and stops on nothing
  let vfdTex: any = null;
  level.prop('P_CAR_INTERIOR')?.traverse((o: any) => {
    if (o.isMesh && o.userData?.decal === 'vfd') vfdTex = o.material?.emissiveMap ?? null;
  });
  let seek: { band: 'FM' | 'AM'; t: number; d: number } | null = null;
  let vfdText = 'FM  88.1';
  const showVfd = (text: string) => {
    if (!vfdTex?.image || text === vfdText) return;
    vfdText = text;
    const cv = vfdTex.image as HTMLCanvasElement;
    drawVfd(cv.getContext('2d')!, cv.width, cv.height, text);
    vfdTex.needsUpdate = true;
  };
  /** FM: 88.1 → 107.9 in 0.2 MHz steps, wrap to 87.9, race on, stop on 91.3 (nothing there); AM: 540 → 1600 kHz in
   *  10 kHz steps, whistle, stop on 1430. A 1990s seek tuner dwells ≈ 15–25 ms per channel. */
  const seekText = (band: 'FM' | 'AM', u: number): string => {
    if (band === 'FM') {
      const steps = 100 + 18; // 88.1→107.9 (100 ch) + wrap 87.9→91.3 (18 ch)
      const i = Math.min(steps, Math.floor(u * steps));
      const f = i <= 99 ? 88.1 + i * 0.2 : 87.9 + (i - 100) * 0.2;
      return `FM ${f.toFixed(1).padStart(5, ' ')}`;
    }
    const f = Math.round((540 + u * (1430 - 540)) / 10) * 10;
    return `AM ${String(f).padStart(5, ' ')}`;
  };
  const _wp = new THREE.Vector3();
  const _wq = new THREE.Quaternion();
  const _ws = new THREE.Vector3();

  const setLook = (on: boolean) => {
    const L = LOOK as unknown as Record<string, number>;
    if (on && !lookSaved) {
      lookSaved = {};
      const look = d.presetId === 'low' ? C0_LOOK_LOW : C0_LOOK;
      for (const k of Object.keys(look)) {
        lookSaved[k] = L[k];
        L[k] = look[k];
      }
    } else if (!on && lookSaved) {
      for (const k of Object.keys(lookSaved)) L[k] = lookSaved[k];
      lookSaved = null;
    }
  };

  const restoreRange = () => {
    if (!saved) return;
    cam.near = saved.near;
    cam.far = saved.far;
    cam.updateProjectionMatrix();
    saved = null;
  };

  const fx = (id: string, p: Params): boolean => {
    switch (id) {
      case 'c0_look':
        c0 = !!p.on;
        setLook(c0);
        if (!c0) uFlutter.value = flutter = 0;
        return true;
      case 'billboard':
        flutter = Number(p.flutter ?? 1);
        uFlutter.value = flutter;
        return true;
      case 'radio':
        // {seek: 'FM' | 'AM', d}: the VFD races and stops on nothing; {show: text} holds a reading
        if (p.seek) seek = { band: String(p.seek).toUpperCase() === 'AM' ? 'AM' : 'FM', t: 0, d: Number(p.d ?? 0.9) };
        else if (p.show !== undefined) showVfd(String(p.show));
        return true;
      case 'deer': {
        // {eyes: bool, i?: 1..3 (default all)}: a pair looks away / blinks out (S7)
        const ids = p.i !== undefined ? [Number(p.i)] : [1, 2, 3];
        for (const i of ids) {
          if (p.eyes) eyesOn.add(i);
          else eyesOn.delete(i);
        }
        return true;
      }
      default:
        return false;
    }
  };

  const update = (dt: number) => {
    const held = d.cameraHeld();
    updateRetroLamps([lampL, lampR]);
    if (seek) {
      seek.t += dt;
      showVfd(seekText(seek.band, Math.min(1, seek.t / seek.d)));
      if (seek.t >= seek.d) seek = null;
    }
    // eye-shine quads: face the camera, ≥ 1.5 px (sub-pixel flux conserved through `area`)
    if (eyes.length) {
      const pxAngle = ((cam.fov * Math.PI) / 180 / Math.max(1, window.innerHeight || 800)) * 1.5;
      for (const e of eyes) {
        const on = (held && eyesOn.has(e.deer)) || warm;
        e.quad.visible = on;
        if (!on) continue;
        e.anchor.getWorldPosition(_wp);
        const dist = _wp.distanceTo(cam.position);
        const size = Math.max(EYE_D, dist * pxAngle);
        e.area.value = (EYE_D / size) ** 2;
        e.anchor.getWorldQuaternion(_wq);
        e.anchor.getWorldScale(_ws);
        e.quad.quaternion.copy(_wq).invert().multiply(cam.quaternion);
        e.quad.scale.set(size / Math.max(1e-6, _ws.x), size / Math.max(1e-6, _ws.y), 1);
      }
    }
    if (c0 && lookSaved) {
      // the sky shader's ground band (the fogged far canopy) is lit by the flash like the real canopy is: without this
      // the r4 9.35 s frame showed a dark seam band between the lit forest and the ridges
      const k = Math.max(0, (SKY_U.flashSky.value - 1) / Math.max(1e-3, LOOK.flashSky - 1));
      (LOOK as unknown as Record<string, number>).groundL = C0_LOOK.groundL * (1 + 3.5 * k);
    }
    if (!held) {
      eyesOn.clear();
      restoreRange();
      yard.restore();
      if (c0) {
        c0 = false;
        setLook(false);
      }
      flutter = 0;
      uFlutter.value = 0;
      return;
    }
    // camera range: only while the opening owns the road (C0 look on, or the interior mounted in the moving car)
    if (c0 || d.mounted()) {
      saved ??= { near: cam.near, far: cam.far };
      const h = cam.position.y; // world Y = PLAN z (the road is ≈ 0 m)
      // near: a cabin (car-space) shot needs mm; an exterior one never has a surface closer than ≈ 1 m (shot 2's pole
      // is 3 m away) — a near of 0.5–1 keeps depth precision at 500 m+ (dz ≈ z² / (near · 2^24))
      const cp = d.car?.position;
      const cw = cam.position; // the cutscene camera has no parent: local = world
      const inCabin = !!cp && Math.hypot(cw.x - cp.x, cw.y - cp.y - 1, cw.z - cp.z) < 2.6;
      const near = inCabin ? 0.03 : h > 30 ? 1.0 : 0.25;
      // far: 2000 m for the aerial (§7.4) but, when the house is in view, never past the house − 300 m (budget; fog
      // transmittance < 7 % there). r4: capping regardless of direction clipped the road's far end in the aerial.
      const hx = HOUSE_PLAN[0] - cw.x;
      const hy = -HOUSE_PLAN[1] - cw.z; // world z of the house = −PLAN y
      const toHouse = Math.hypot(hx, hy);
      cam.getWorldDirection(_dir);
      const facing = (_dir.x * hx + _dir.z * hy) / Math.max(1, toHouse * Math.hypot(_dir.x, _dir.z));
      const cap = facing > -0.2 ? toHouse - 300 : Infinity;
      const far = Math.round(Math.max(250, Math.min(h > 30 ? 2000 : 900, cap)));
      if (cam.near !== near || cam.far !== far) {
        cam.near = near;
        cam.far = far;
        cam.updateProjectionMatrix();
      }
      yard.update(cw, true, d.night?.() ?? true);
    } else {
      restoreRange();
      yard.update(cam.position, false);
    }
  };

  /** Load warm-up: the eye-shine quads are drawn once (their shader compiles with the level). */
  const setWarm = (on: boolean) => {
    warm = on;
    for (const e of eyes) e.quad.visible = on;
  };

  return { fx, update, setWarm, debug: () => ({ yard: yard.stats(), c0, near: cam.near, far: cam.far, flutter, retro: retroMats.size, reflector: !!reflectorMat, eyes: eyes.length, eyesOn: [...eyesOn] }) };
}
