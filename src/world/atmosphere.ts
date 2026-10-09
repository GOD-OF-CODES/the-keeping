// Atmosphere + camera driver (docs/REALISM-BACKLOG.md items 2, 3, 4, 7, 8, 14, 15). One update per simulation step,
// called from the level runtime's world() after the level's light update. Owns:
//   sky      scene.backgroundNode: the bake's CIE overcast dome (L = Lz(1 + 2 sin h)/3, 7500 K, Lz 0.00982 cd/m²)
//            with a skyglow lift at the horizon; below the horizon the wet ground fogged by its distance from the eye;
//            a procedural distant treeline (bare deciduous woodland 140-230 m out, canopy ~16 m) drawn in the
//            background shader — no geometry and no far-plane limit (the camera's far plane is 90 m).
//   fog      Beer–Lambert extinction + in-scatter (round 3, R2-1): L = L0·e^(−σd) + L_sky·(1 − e^(−σd)), d = eye
//            distance, σ = 3.912 / V (Koschmieder). LOOK.fogDensity keeps its FogExp2 meaning (V = √3 / D), so
//            0.006 → V 290 m → σ 0.0135 /m (heavy night rain), mist 0.012 → 145 m. The squared FogExp2 left the field
//            at 60 m with 12 % haze; Beer–Lambert gives 55 %. In-scatter colour = the horizon sky (meets it seamlessly).
//            scene.fogNode (takes precedence over scene.fog, NodeManager.getFogNode r186); scene.fog stays as the
//            parameter holder (density 0 indoors).
//   lightning cloud base × LOOK.flashSky and fog × LOOK.flashFog at the peak (not a +0.3 grey wash); exposure held;
//            the lightning DirectionalLight casts a shadow outdoors: one 2048² orthographic map over a 60 m box around
//            the player, drawn once per strike (autoUpdate off, needsUpdate at the strike), castShadow fixed from
//            load so the LightsNode key never changes; azimuth jittered ±40° per strike around L_LTN_SUN.
//   camera   auto exposure (src/render/exposure.ts), white balance per zone (3000 K inside / 4500 K outside, blended
//            in mired over ~1 s), and the live LOOK values → pipeline uniforms (sharpen, CA, grain, vignette, bloom).

import * as THREE from 'three/webgpu';
import { Fn, If, atan, fog as fogNodeFn, normalWorld, positionView, reflectVector, roughness, clamp, dot, exp, float, floor, fract, length, max, mix, mx_fractal_noise_float, mx_noise_float, normalWorldGeometry, sin, smoothstep, time, uniform, vec2, vec3 } from 'three/tsl';
import { LOOK, attachLookApi, initLook } from '../render/look.ts';
import type { PresetConfig } from '../render/presets.ts';
import { AutoExposure } from '../render/exposure.ts';

/** σ (1/m) per FogExp2 density D at the same visibility: V = √3 / D (5 % contrast), σ = 3.912 / V (2 %, Koschmieder). */
export const SIGMA_PER_D = 3.912 / Math.sqrt(3);

/** The sky/fog uniforms (one atmosphere per page): module-level so load-time code (level.ts' exterior materials)
 *  can build nodes on them before the Atmosphere exists. */
export const SKY_U = {
  horizon: uniform(new THREE.Color(0, 0, 0)),
  glow: uniform(1.3),
  flashSky: uniform(1),
  cloud: uniform(0.35),
  ground: uniform(new THREE.Color(0, 0, 0)),
  fogColor: uniform(new THREE.Color(0, 0, 0)),
  fogD: uniform(0.006),
  /** Beer–Lambert extinction σ (1/m) for scene geometry: 0 indoors. */
  fogSigma: uniform(0),
  tree: uniform(new THREE.Color(0, 0, 0)),
  treeR0: uniform(140),
  treeR1: uniform(230),
  treeH: uniform(16),
  // LIGHTING builder 2 (item 19): civil twilight for C6 / B12 — sun-side and anti-sun horizon radiance (× tint)
  twSun: uniform(new THREE.Color(0, 0, 0)),
  twAnti: uniform(new THREE.Color(0, 0, 0)),
  twZenith: uniform(0.3),
  /** Round 3 (R2-3): 1 outdoors (smoothed), for things that carry their own sky term (the first-person arms). */
  outside: uniform(0),
  /** 1 once the camera is past the exterior probe grid by its falloff (0.35 m): the grid no longer lights it. */
  beyondGrid: uniform(0),
};

/** Exterior probe grid box (world), set by level.ts at load: beyond it the arms take the analytic sky irradiance. */
let extGridBox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null = null;
export function setExteriorGridBox(b: typeof extGridBox): void {
  extGridBox = b;
}

/** CIE-overcast sky radiance along world direction d (the background's dome without the cloud noise). */
export const skyRadiance = (d: any): any => {
  const u = SKY_U;
  const e = d.y;
  const up = max(e, 0);
  const glow = mix(float(1), u.glow, exp(up.div(-0.12)));
  return u.horizon.mul(up.mul(2).add(1)).mul(glow).mul(u.flashSky).add(u.twSun.add(u.twAnti).mul(0.5));
};

/**
 * Irradiance from the overcast sky + wet ground on a surface with world normal n, as a fit of the exact integrals of
 * L(h) = L_hz(1 + 2 sin h): up 7π/3·L_hz = 7.33, vertical (π/2 + 4/3 + ground) ≈ 3.2, down (ground ρ 0.08) ≈ 0.6.
 */
export const skyIrradiance = (n: any): any => {
  const ny = n.y;
  return SKY_U.horizon.mul(SKY_U.flashSky).mul(ny.mul(ny).mul(0.77).add(ny.mul(3.37)).add(3.2));
};

/**
 * R2-1: specular sky light for exterior probe-lit surfaces (wet grass, mud, gravel, bark …). They had no environment
 * at all (only glossy materials get the yard reflection cube), so a wet field at grazing view reflected nothing of
 * the lit overcast above it. Radiance = the background's CIE overcast L(h) = L_hz·(1 + 2 sin h) (with the horizon
 * skyglow, flash and twilight) along the lobe's dominant direction (Frostbite: mix(R, N, α²)); below the horizon the
 * near ground. The BRDF (Fresnel, roughness) is the lighting model's own environment term, so the amount is physical:
 * rough 0.6 dielectric at grazing ≈ 0.1–0.2 × L_sky. No texture fetch; a handful of ALU per fragment.
 */
export class SkySpecularNode extends (THREE as any).LightingNode {
  setup(builder: any): void {
    const u = SKY_U;
    const a2 = roughness.mul(roughness);
    const d = mix(reflectVector, normalWorld, a2).normalize();
    const e = d.y;
    const sky = skyRadiance(d);
    const w = roughness.mul(0.35).add(0.03);
    builder.context.radiance.addAssign(mix(u.ground, sky, smoothstep(w.negate(), w, e)));
  }
}
import { whiteBalanceGain } from '../render/camera-fx.ts';
import { kelvinToLinearRGB } from './lights.ts';
import type { Pipeline } from '../render/pipeline.ts';
import { GLARE_BASE } from '../render/pipeline.ts';

/** Eye height above the ground for the background's ground/treeline geometry (m). */
const EYE = 1.65;
/** Treeline crowns round the horizon (2π·180 m / 160 ≈ 7 m apart). */
const TREE_CELLS = 160;
const TWO_PI = Math.PI * 2;
/** float → [0, 1) hash. */
const hash11 = (x: any) => fract(sin(dot(vec2(x, x.mul(0.618)), vec2(12.9898, 78.233))).mul(43758.5453));

/**
 * Exposure per zone where nothing can be metered (Low on WebGL2, DirectRenderPipeline): the equilibrium the meter
 * reaches on Medium at the zone's typical views (docs/REALISM-STATUS.md: parlor 1.7-2.7, hall 3.7-4.3, facade 12-13,
 * drive 7). The U1/U4/CLOSET values are unmetered guesses (those rooms read black until the upper-floor bake lands).
 * Rooms not listed use `interior`.
 */
const FALLBACK_EXPOSURE: Record<string, number> = { outdoor: 9, interior: 4, G2: 2.2, G1: 4, U1: 16, U4: 16, U4T: 16, CLOSET: 12 };

/**
 * Room-aware exposure range (linear) for set pieces design wants darker or brighter than the global clamp
 * (REALISM-BACKLOG item 4 "per-room exposureMax"). Empty by default: every room uses LOOK.minExposure/maxExposure.
 */
export const ROOM_EXPOSURE: Record<string, { min?: number; max?: number }> = {};

export interface AtmosphereOptions {
  renderer: any;
  scene: any;
  camera: any;
  fog: any;
  preset: PresetConfig;
  /** level.lights.lightningDir */
  lightningDir: any;
  events: { on(type: 'lightning', fn: (p: { strength: number; durationMs: number }) => void): () => void };
}

export class Atmosphere {
  private readonly o: AtmosphereOptions;
  private pipeline: Pipeline | null = null;
  private exposure: AutoExposure | null = null;
  private mired = 1e6 / LOOK.wbOutdoorK;
  private outside = true;
  private readonly baseDir = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly u = SKY_U;
  private readonly skyRGB: [number, number, number];
  /** Twilight colours at unit luminance: sun side ≈ 4500 K (low warm glow), anti-sun / zenith ≈ 12 000 K. */
  private readonly twSunRGB = unitLum(kelvinToLinearRGB(4500));
  private readonly twAntiRGB = unitLum(kelvinToLinearRGB(12000));

  constructor(o: AtmosphereOptions) {
    this.o = o;
    initLook(o.preset);
    const k = kelvinToLinearRGB(LOOK.skyKelvin);
    const y = 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2];
    this.skyRGB = [k[0] / y, k[1] / y, k[2] / y]; // unit luminance: strength = luminance (as in the bake)
    o.scene.backgroundNode = this.skyNode();
    // R2-1: physically based fog (see header); positionView.length() = true eye distance, not view depth
    o.scene.fogNode = fogNodeFn(this.u.fogColor, float(1).sub(exp(this.u.fogSigma.mul(length(positionView)).negate())));

    // Lightning shadow (item 3): fixed castShadow from load (LightsNode key stable), map drawn once per strike.
    const d = o.lightningDir;
    this.baseDir.copy(d.position).sub(d.target.position).normalize();
    d.castShadow = true;
    d.shadow.mapSize.set(2048, 2048);
    const cam = d.shadow.camera;
    cam.left = -30;
    cam.right = 30;
    cam.top = 30;
    cam.bottom = -30;
    cam.near = 1;
    cam.far = 220;
    cam.updateProjectionMatrix();
    d.shadow.bias = -0.0006;
    d.shadow.normalBias = 0.03;
    d.shadow.autoUpdate = false;
    d.shadow.needsUpdate = true; // one draw at load: its shadow-pass render objects compile with the level
    o.events.on('lightning', () => this.strike());
  }

  /** The pipeline exists after the level (main.ts): exposure metering needs its scene texture. */
  setPipeline(p: Pipeline): void {
    this.pipeline = p;
    this.exposure?.dispose();
    this.exposure = new AutoExposure(this.o.renderer, p.meterTexture, p.uniforms.exposure);
  }

  /** Debug API (window.__game.look): attaches to the existing look(heading, pitch) function. */
  attachApi(target: any): any {
    return attachLookApi(target, {
      meter: () => ({ ...(this.exposure?.last ?? {}), exposure: this.exposure?.exposure ?? null, ev: this.exposure?.ev ?? null, range: this.exposure?.range, mired: this.mired }),
      snap: () => this.exposure?.snap(),
    });
  }

  private strike(): void {
    if (!this.outside || !LOOK.flashShadow) return;
    const d = this.o.lightningDir;
    const az = ((Math.random() * 2 - 1) * LOOK.flashAzimuthJitter * Math.PI) / 180;
    this.tmp.copy(this.baseDir).applyAxisAngle(THREE.Object3D.DEFAULT_UP, az);
    this.o.camera.getWorldPosition(this.camPos);
    // (also on County Road 9 at ground level — world x > 60 is the road set, far from the house's window spots,
    // whose fixed directions the yard's flashes must keep matching)
    if (this.camPos.y > 15 || this.camPos.x > 60) {
      // runtime lane E (item 7): seen from the C0 aerial a stroke over the forest lights the canopy from the SIDE —
      // the channel stands a few km off at 1–3 km height, ≈ 25–40° above the horizon, 50–90° off the view axis — so
      // the crowns are modelled (lit flank, rim, shadowed flank) and their shadows run long across the road.
      this.o.camera.getWorldDirection(this.fwd);
      const view = Math.atan2(this.fwd.x, this.fwd.z);
      const side = (Math.random() < 0.5 ? -1 : 1) * ((50 + Math.random() * 40) * Math.PI) / 180;
      const el = ((25 + Math.random() * 15) * Math.PI) / 180;
      this.tmp.set(Math.sin(view + side) * Math.cos(el), Math.sin(el), Math.cos(view + side) * Math.cos(el));
    }
    // runtime lane E (item 7): fit the 2048² map to what the camera sees. A ±30 m box around the eye left C0's aerial
    // (52–62 m up, looking 100s of m down the road) with no lightning shadow at all — a flat sky-coloured wash on the
    // canopy. Aerial: a ±110 m box centred ≈ 110 m ahead on the ground (10.7 cm texels: crown-scale shadows); at
    // eye level ±35 m, 20 m ahead (the near road and the tree trunks' hard shadows).
    const aerial = this.camPos.y > 15;
    const half = aerial ? 110 : 35;
    this.o.camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, -1);
    this.fwd.normalize();
    const sc = d.shadow.camera;
    if (sc.right !== half) {
      sc.left = -half;
      sc.right = half;
      sc.top = half;
      sc.bottom = -half;
      sc.far = aerial ? 320 : 220;
      sc.updateProjectionMatrix();
    }
    d.target.position.copy(this.camPos).addScaledVector(this.fwd, aerial ? 110 : 20);
    if (aerial) d.target.position.y = 0;
    d.position.copy(d.target.position).addScaledVector(this.tmp, aerial ? 160 : 100);
    d.target.updateMatrixWorld();
    d.updateMatrixWorld();
    d.shadow.needsUpdate = true;
  }

  /**
   * Per step, after level.update (which sets the lightning/moon light). outside: player outdoors; room: current room
   * id; mist: story mist (0..1.5); skyTint: C6/B12 blue hour (0..1).
   */
  update(dt: number, lightning: number, outside: boolean, room: string | null, mist: number, skyTint: number): void {
    this.outside = outside;
    const u = this.u;
    // ---- sky: CIE overcast at the bake's Lz (horizon Lz/3) + blue-hour pale-up toward dawn (C6)
    const h = LOOK.skyLz / 3;
    const [sr, sg, sb] = this.skyRGB;
    u.horizon.value.setRGB(h * sr + skyTint * 0.025, h * sg + skyTint * 0.035, h * sb + skyTint * 0.055);
    u.glow.value = LOOK.skyGlow;
    u.cloud.value = LOOK.skyCloud;
    u.flashSky.value = 1 + (LOOK.flashSky - 1) * lightning;
    u.ground.value.setRGB(LOOK.groundL * 0.9, LOOK.groundL, LOOK.groundL * 1.1);
    u.tree.value.setRGB(LOOK.treeL * 0.9, LOOK.treeL, LOOK.treeL * 1.05);
    u.treeR0.value = LOOK.treeR0;
    u.treeR1.value = LOOK.treeR1;
    u.treeH.value = LOOK.treeH;
    // ---- fog (item 7): outdoor density; indoors none (the background keeps the outdoor value for the windows)
    const dens = Math.min(0.012, LOOK.fogDensity + Math.max(0, mist) * LOOK.fogMist);
    u.fogD.value = dens;
    const fog = this.o.fog;
    fog.density = outside ? dens : 0;
    u.fogSigma.value = outside ? dens * SIGMA_PER_D : 0;
    // R2-3: sky terms of the first-person arms (smoothed so the doorway crossing never pops)
    const ka = 1 - Math.exp(-dt * 4);
    u.outside.value += ((outside ? 1 : 0) - u.outside.value) * ka;
    let beyond = 0;
    if (outside && extGridBox) {
      const c = this.o.camera.getWorldPosition(this.tmp);
      const b = extGridBox;
      const dx = Math.max(b.min.x - c.x, 0, c.x - b.max.x);
      const dy = Math.max(b.min.y - c.y, 0, c.y - b.max.y);
      const dz = Math.max(b.min.z - c.z, 0, c.z - b.max.z);
      const t = Math.min(1, Math.hypot(dx, dy, dz) / 0.35);
      beyond = t * t * (3 - 2 * t);
    }
    u.beyondGrid.value = beyond;
    const fogK = LOOK.fogScale * LOOK.skyGlow * (1 + (LOOK.flashFog - 1) * lightning);
    fog.color.setRGB(u.horizon.value.r * fogK, u.horizon.value.g * fogK, u.horizon.value.b * fogK);
    // LIGHTING builder 2 (item 19): civil twilight (C6 / B12 blue hour) — sky gradient + the mist glows with it
    const tw = Math.max(0, Math.min(1, skyTint)) * LOOK.twilightL;
    u.twSun.value.setRGB(this.twSunRGB[0] * tw, this.twSunRGB[1] * tw, this.twSunRGB[2] * tw);
    u.twAnti.value.setRGB(this.twAntiRGB[0] * tw * LOOK.twilightAnti, this.twAntiRGB[1] * tw * LOOK.twilightAnti, this.twAntiRGB[2] * tw * LOOK.twilightAnti);
    u.twZenith.value = LOOK.twilightZenith;
    const twFog = tw * 0.45 * LOOK.fogScale;
    fog.color.r += twFog * this.twAntiRGB[0];
    fog.color.g += twFog * this.twAntiRGB[1];
    fog.color.b += twFog * this.twAntiRGB[2];
    u.fogColor.value.copy(fog.color);
    // ---- camera
    const p = this.pipeline;
    if (!p) return;
    const un = p.uniforms;
    un.grain.value = LOOK.grain;
    un.grainPerEV.value = LOOK.grainPerEV;
    un.chromaticAberration.value = LOOK.caPx;
    un.sharpness.value = LOOK.sharpen;
    un.vignette.value = LOOK.vignette;
    un.bloomStrength.value = LOOK.bloom;
    if (un.bloomThreshold) un.bloomThreshold.value = LOOK.bloomThreshold;
    GLARE_BASE.value = LOOK.glareBase;
    // white balance (item 14): mired blend (perceptually even) toward the zone's kelvin
    const target = 1e6 / (outside ? LOOK.wbOutdoorK : LOOK.wbIndoorK);
    this.mired += (target - this.mired) * (dt > 0 ? 1 - Math.exp(-dt / Math.max(1e-3, LOOK.wbTau)) : 0);
    const g = whiteBalanceGain(1e6 / this.mired, LOOK.wbStrength);
    un.whiteBalance.value.setRGB(g[0], g[1], g[2]);
    // exposure (item 4)
    if (this.exposure) {
      const rr = (room && ROOM_EXPOSURE[room]) || {};
      this.exposure.range.min = rr.min ?? LOOK.minExposure;
      this.exposure.range.max = rr.max ?? LOOK.maxExposure;
      const fb = outside ? FALLBACK_EXPOSURE.outdoor : (room && FALLBACK_EXPOSURE[room]) || FALLBACK_EXPOSURE.interior;
      this.o.camera.getWorldPosition(this.camPos);
      this.exposure.update(dt, lightning, this.camPos, fb); // writes un.exposure
    }
  }

  /** Background node: sky dome, fogged ground below the horizon and the distant treeline. */
  private skyNode(): any {
    const u = this.u;
    return Fn(() => {
      const d = normalWorldGeometry.normalize();
      const e = d.y; // sin(elevation)
      const up = max(e, 0);
      // CIE overcast: L(h) = horizon · (1 + 2 sin h); skyglow concentrated within ~10° of the horizon
      const glow = mix(float(1), u.glow, exp(up.div(-0.12)));
      // cloud base: the overcast is a stratus deck ~1 km up, not a flat dome — its underside varies ±~20 % in
      // luminance (thicker/thinner cloud), drifting with the storm wind; a flash lights it unevenly
      const cuv = vec2(d.x, d.z).div(up.add(0.08)).mul(0.9);
      const cloud = mx_fractal_noise_float(vec3(cuv.add(vec2(time.mul(0.011), time.mul(0.004))), time.mul(0.006)), 3, 2, 0.5);
      const deck = cloud.mul(u.cloud).add(1);
      const flashLit = u.flashSky.sub(1).mul(cloud.mul(1.4).add(0.8).max(0.15)).add(1);
      let sky: any = u.horizon.mul(up.mul(2).add(1)).mul(glow).mul(deck).mul(flashLit);
      // LIGHTING builder 2 (item 19): civil twilight (sun 4° below the eastern horizon, +x): brightest low toward the
      // sun, ×0.3 at the zenith, dimmer and bluer opposite; the thinning deck still modulates it
      const hzd = vec2(d.x, d.z).div(max(length(vec2(d.x, d.z)), 1e-4));
      const toward = hzd.x.mul(0.5).add(0.5).pow(2);
      const zen = mix(u.twZenith, float(1), exp(up.div(-0.22)));
      sky = sky.add(mix(u.twAnti, u.twSun, toward).mul(zen).mul(cloud.mul(u.cloud).mul(0.5).add(1)));
      // below the horizon: wet ground at distance EYE / sin(depression), fogged (FogExp2) — meets the horizon colour
      const dist = float(EYE).div(max(e.negate(), 1e-4));
      const ground = mix(u.ground, u.fogColor, float(1).sub(exp(u.fogD.mul(SIGMA_PER_D).mul(dist).negate())));
      const col = mix(ground, sky, smoothstep(-0.002, 0.002, e)).toVar();
      // distant treeline (only near the horizon)
      If(e.lessThan(0.09).and(e.greaterThan(-0.03)), () => {
        const hzl = length(vec2(d.x, d.z));
        const hz = vec2(d.x, d.z).div(max(hzl, 1e-4)); // azimuth on the unit circle: noise wraps seamlessly
        const r = mix(u.treeR0, u.treeR1, mx_noise_float(vec3(hz.mul(1.7), 3.1)).mul(0.5).add(0.5));
        // individual bare crowns: TREE_CELLS cells round the horizon (~7 m spacing at 180 m), each holding one tree
        // of random height (0.6-1.35 × treeH), offset and crown width; the canopy top is the max of the 3 nearest
        // crowns (rounded ellipse profiles), over a low understorey of saplings/hedge (~0.35 × treeH)
        const cf = atan(hz.y, hz.x).div(TWO_PI).add(0.5).mul(TREE_CELLS);
        const ci = floor(cf);
        const fx = cf.sub(ci);
        const top = u.treeH.mul(mx_noise_float(vec3(hz.mul(9), 1.3)).mul(0.12).add(0.35)).toVar();
        for (const k of [-1, 0, 1]) {
          const c0 = ci.add(k);
          const c = c0.sub(floor(c0.div(TREE_CELLS)).mul(TREE_CELLS)); // wrap: cells are continuous across ±π
          const h1 = hash11(c);
          const h2 = hash11(c.add(71.3));
          const h3 = hash11(c.add(17.9));
          const hw = h3.mul(0.45).add(0.45); // crown half-width, cells (≈ 3-6 m)
          const dx = fx.sub(h2.mul(0.6).add(k + 0.2)).div(hw);
          const t = u.treeH.mul(h1.mul(0.75).add(0.6)).mul(max(float(1).sub(dx.mul(dx)), 1e-6).pow(0.45));
          top.assign(max(top, t));
        }
        const eTop = top.sub(EYE).div(r);
        const eBase = float(-EYE).div(r);
        // bare branches: lacy near the tips (≈ 30 % cover), denser toward the trunks (≈ 90 %); 2D noise at ~1 m
        const depth = eTop.sub(e).mul(r); // metres below the local canopy top
        const lace = mx_noise_float(vec3(hz.mul(r.mul(0.9)), e.mul(r).mul(0.9))).mul(0.5).add(0.5);
        const dens = smoothstep(0, 6, depth).mul(0.6).add(0.3).add(lace.sub(0.5).mul(0.5));
        const cover = smoothstep(-0.25, 0.25, depth).mul(clamp(dens, 0, 0.97)).mul(smoothstep(eBase.sub(0.0005), eBase, e));
        const tree = mix(u.tree, u.fogColor, float(1).sub(exp(u.fogD.mul(SIGMA_PER_D).mul(r).negate())));
        col.assign(mix(col, tree, cover));
      });
      return col;
    })();
  }
}

/** Scales an RGB triple to unit Rec.709 luminance. */
function unitLum(c: [number, number, number]): [number, number, number] {
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return [c[0] / l, c[1] / l, c[2] / l];
}
