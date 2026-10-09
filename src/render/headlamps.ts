// Vehicle headlamps with a real beam pattern (docs/C1-OPENING.md §5.1, §7.2): the layout's L_HEADLIGHT_L/R (our
// sedan, 1980s 4×6 in H4656-class halogen low beam) and L_TRUCK_HI_L/R (the logging truck's high beams) get a
// procedural photometric cookie (SpotLightNode calls light.colorNode(lightCoord), r186 SpotLightNode.setupDirect;
// lightShadowMatrix updates the projection even without a shadow map). light.intensity = the layout `cd` = the
// cookie's 1.0 level, so the lobes below are in units of that peak:
//   low beam   hot spot 15 kcd at 1.5° down / 2° right, σ 5° h × 1.5° v; spread 3 kcd σ 18° × 3° at 2° down;
//              foreground 1 kcd σ 40° × 8° at 6° down; above the horizon a soft US cut-off ≈ 700 cd (a gradient).
//   high beam  + 30 kcd at 0°, σ 3° × 2° (uHibeam mixes it in for the two flashes in S5).
//   truck high peak 35 kcd σ 3° × 2° aimed 0.5° down + a 4 kcd spread σ 15°.
// Integrated low beam ≈ 720 lm per lamp. The light colour carries the kelvin (3200 K / 3300 K).

import * as THREE from 'three/webgpu';
import { Fn, float, uniform, vec3, atan, exp, max, min, smoothstep, mix } from 'three/tsl';
import type { PresetConfig } from './presets.ts';

const DEG = Math.PI / 180;
/** Spot half-angle of the projection (the cookie lives inside it): ±50° covers the 40° foreground lobe. */
const HALF = 50 * DEG;
const TAN_HALF = Math.tan(HALF);

/** Layer of the objects that cast into the vehicle lamps' shadow maps (ShadowNode uses shadow.camera.layers when it
 *  has any bit beyond layer 0). */
export const HEADLAMP_SHADOW_LAYER = 5;

/** 0 = low beam only … 1 = high-beam lobe fully on (our car's flashes at C1 32.4 / 32.6 s). */
export const uHibeam = uniform(0);

/** Gaussian lobe in degrees: amp · exp(−½((h−h0)/σh)² − ½((v−v0)/σv)²). */
const lobe = (h: any, v: any, amp: number, h0: number, v0: number, sh: number, sv: number) => {
  const dh = h.sub(h0).div(sh);
  const dv = v.sub(v0).div(sv);
  return exp(dh.mul(dh).add(dv.mul(dv)).mul(-0.5)).mul(amp);
};

/** lightCoord (projected, 0..1 over the ±HALF square) → beam angles in degrees (h right, v up). */
const anglesOf = (lc: any) => {
  const p = lc.xy.sub(0.5).mul(2 * TAN_HALF);
  return { h: atan(p.x).mul(1 / DEG), v: atan(p.y).mul(1 / DEG) };
};

/** The low-beam pattern (relative to the 15 kcd peak) at beam angles h, v in degrees (TSL nodes). */
export function lowBeamPattern(h: any, v: any): any {
  const below = lobe(h, v, 1.0, 2, -1.5, 5, 1.5)
    .add(lobe(h, v, 0.2, 0, -2, 18, 3))
    .add(lobe(h, v, 1 / 15, 0, -6, 40, 8));
  const upper = exp(max(v, 0).div(6).pow(2).mul(-0.5)).mul(0.047).mul(lobe(h, float(0), 1, 0, 0, 20, 1));
  return mix(min(below, upper), below, smoothstep(0.6, -1.0, v)).add(lobe(h, v, 2.0, 0, 0, 3, 2).mul(uHibeam));
}

export const halogenLowCookie = Fn(([lightCoord]: [any]) => {
  const { h, v } = anglesOf(lightCoord);
  const below = lobe(h, v, 1.0, 2, -1.5, 5, 1.5)
    .add(lobe(h, v, 0.2, 0, -2, 18, 3))
    .add(lobe(h, v, 1 / 15, 0, -6, 40, 8));
  // US visual-optical cut-off: above the line the beam is limited to ≈ 700 cd (0.047 of the peak), fading upward
  const upper = exp(max(v, 0).div(6).pow(2).mul(-0.5)).mul(0.047).mul(lobe(h, float(0), 1, 0, 0, 20, 1));
  const cut = smoothstep(0.6, -1.0, v); // 1 below −1°, 0 above +0.6°: a gradient, not a step
  const low = mix(min(below, upper), below, cut);
  const hi = lobe(h, v, 2.0, 0, 0, 3, 2).mul(uHibeam);
  const k = max(low.add(hi), 0);
  return vec3(k, k, k);
});

export const truckHighCookie = Fn(([lightCoord]: [any]) => {
  const { h, v } = anglesOf(lightCoord);
  const k = lobe(h, v, 1.0, 0, -0.5, 3, 2).add(lobe(h, v, 4 / 35, 0, -1, 15, 6)).add(lobe(h, v, 0.02, 0, -4, 40, 10));
  return vec3(k, k, k);
});

export interface Headlamps {
  lights: any[];
  /** Low-beam colour shift for the stall (S8: 3200 K → 2600 K at ×0.35 brightness, set by the cutscene). */
  setStall(k: number): void;
}

/** Install the cookies on the layout's runtime lamp lights (call once at load, before shader compilation). */
export function installHeadlamps(get: (id: string) => any | null, preset: PresetConfig, kelvinRGB: (k: number) => [number, number, number]): Headlamps {
  const lights: any[] = [];
  const shadowTier = preset.id === 'low' ? 0 : preset.id === 'max' ? 2 : 1;
  const ours = ['L_HEADLIGHT_L', 'L_HEADLIGHT_R'];
  for (const id of [...ours, 'L_TRUCK_HI_L', 'L_TRUCK_HI_R']) {
    const l = get(id);
    if (!l || !l.isSpotLight) continue;
    const truck = id.startsWith('L_TRUCK');
    l.colorNode = truck ? truckHighCookie : halogenLowCookie;
    l.angle = HALF;
    l.penumbra = 0.15; // the cookie shapes the beam; the cone only trims the projection's corners
    l.distance = truck ? 260 : 180; // ≈ the 0.1 lux range of each peak (√(I/0.1))
    l.decay = 2;
    // shadows: Max both of our lamps, Medium the left one (≈ the midpoint pool), Low none; truck one lamp on Med/Max
    // one shadowed lamp of ours on Medium AND Max: every shadowed runtime light adds samplers to every probe-lit
    // material (characters see all runtime lights) and Max hit WebGPU's 16-samplers-per-stage limit with both lamps
    // + dome + veil (look 6: harlan_apron pipeline invalid). The two lamps are 1.16 m apart; one map from the left
    // lamp carries the beam shadows.
    const shadow = shadowTier > 0 && id.endsWith('_L');
    l.castShadow = shadow;
    if (shadow) {
      const s = truck ? 512 : 1024;
      l.shadow.mapSize.set(s, s);
      l.shadow.camera.near = 0.3;
      // r186 SpotLightShadow.updateMatrices sets camera.far = light.distance (the shadow frustum ends with the lighting
      // cutoff — shortening it would also drop the cookie past it). What the pass renders is limited by layer instead:
      // only objects on HEADLAMP_SHADOW_LAYER (the road set, the gate, the cars — src/world/opening.ts) cast into it
      // (look 5: the house + yard trees ahead doubled the 54 s frame to 1246 draws).
      l.shadow.camera.layers.set(HEADLAMP_SHADOW_LAYER);
      l.shadow.bias = -0.0006;
      l.shadow.normalBias = 0.03;
      l.shadow.radius = 2;
    }
    lights.push(l);
  }
  const c3200 = new THREE.Color(...kelvinRGB(3200));
  const c2600 = new THREE.Color(...kelvinRGB(2600));
  return {
    lights,
    setStall(k: number) {
      for (const id of ours) {
        const l = get(id);
        if (l) l.color.copy(c3200).lerp(c2600, Math.max(0, Math.min(1, k)));
      }
    },
  };
}
