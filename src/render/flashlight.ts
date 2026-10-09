// Player flashlight: shadowed SpotLight with a procedural TSL cookie (SpotLightNode: light.colorNode(lightCoord)),
// plus a volumetric-beam STUB for Max (an additive soft cone; the real VolumeNodeMaterial beam comes later).
// Intensity convention: runtime candela = Blender W / (4π) (CLAUDE.md light units).

import * as THREE from 'three/webgpu';
import { Fn, If, abs, dot, float, max, mx_noise_float, normalView, positionGeometry, positionViewDirection, positionWorld, smoothstep, uniform, vec3 } from 'three/tsl';
import type { PresetConfig } from './presets.ts';
import { kelvinToLinearRGB } from '../world/lights.ts';

/**
 * LIGHTING lane (REALISM-BACKLOG item 11) — beam profile of a 2-D-cell incandescent torch with a smooth reflector:
 * a hot core (the reflector's focus, ±3.5° to half maximum) on a flat spill shelf that carries most of the flux,
 * and a faint corona (reflector-rim stray light) out to the cone edge.
 *   peak 120 cd (core 0.87 + shelf 0.13), shelf 16 cd to ~20°, corona 2.4 cd, cone 45° with penumbra 0.5:
 *   ≈ 21 lm total (beamFlux(), numerically integrated with three's spot falloff), hot:spill 7.7:1.
 * The old cookie (core 0.6, σ² 0.07, a spill RAMP 0.5 → 0 inside a 27.7° penumbra-0.8 cone, 30 cd) put out ~4 lm
 * with a hotspot 2× its spill: a flat near-white disc with black 20 cm outside it. The AD's 60 cd / 0.9 / 0.12 inside
 * the old cone integrates to only 2.3 lm, so the shelf and the wider cone carry the 15–25 lm a 2-D-cell bulb
 * (≈ 1.2 W PR2) puts out; peak 120 cd is the lower end of real 2-D incandescent torches (100–1000 cd).
 * Every term is a uniform (look API torchCore/torchSigma2/torchSpill/torchShelf/torchTail). */
export const uTorchCore = uniform(0.87);
export const uTorchSigma2 = uniform(0.012);
export const uTorchSpill = uniform(0.13);
/** Normalised radius where the spill shelf starts to fade (fades out by 0.95). */
export const uTorchShelf = uniform(0.4);
/** Corona: stray light off the reflector rim, a faint skirt out to the cone edge (fraction of peak). */
export const uTorchTail = uniform(0.02);

/** Reflector mouth diameter (m) of a 2-D-cell torch. */
const REFLECTOR_D = 0.05;
/** World position of the torch (updated per render from the light). */
export const uTorchPos = uniform(new THREE.Vector3());
/** 1 while the torch is on (R2-2: its cookie and shadow PCF are skipped in every fragment while it is off). */
export const uTorchLit = uniform(1);

/** Flashlight cookie: hot core, flat spill shelf, a faint reflector ring, lens smudges. lightCoord.xy in [0,1]. */
export const flashlightCookie = Fn(([lightCoord]: [any]) => {
  const out = vec3(0).toVar();
  If(uTorchLit.greaterThan(0.5), () => {
    out.assign(cookieLit(lightCoord));
  });
  return out;
});

const cookieLit = Fn(([lightCoord]: [any]) => {
  const p = lightCoord.xy.sub(0.5).mul(2);
  const r = p.length();
  const core = r.mul(r).div(uTorchSigma2).negate().exp().mul(uTorchCore);
  const spill = float(1).sub(smoothstep(uTorchShelf, 0.95, r)).mul(uTorchSpill);
  // reflector seam (round 3, item 11): a FAR-field feature — the seam images to a sharp ring only once the reflector
  // (Ø ≈ 5 cm) is small next to the throw. Near the torch every point of the surface sees the whole mouth, so the
  // ring is smeared by its angular size (D/d rad, ÷ tan 45° in r units): width² = 0.08² + (D/d)². Amplitude 0.01
  // (was 0.025, read as a lens halo at 1 m), scaled 0.08/width so its flux is conserved while it smears.
  const dist = positionWorld.distance(uTorchPos).max(0.05);
  const smear = float(REFLECTOR_D).div(dist);
  const width = smear.mul(smear).add(0.0064).sqrt();
  const ringOffset = r.sub(0.42).div(width);
  const ring = ringOffset.mul(ringOffset).negate().exp().mul(float(0.01 * 0.08).div(width));
  const smudge = mx_noise_float(vec3(p.mul(3.1), 0.37)).mul(0.02);
  const tail = float(1).sub(smoothstep(0.6, 1.0, r)).mul(uTorchTail);
  const v = max(core.add(spill).add(ring).add(tail).add(smudge.mul(spill.add(core))), 0);
  return vec3(v, v, v); // the bulb's 2900 K colour is the light colour (no extra tint here)
});

/** Torch colour: a 2-D-cell vacuum bulb run slightly under-volted ≈ 2900 K (was 0xfff1dc ≈ 5000 K). */
export const TORCH_KELVIN = 2900;

export interface Flashlight {
  light: any;
  beam: any | null;
  intensity: any; // base intensity (cd), flicker multiplies this
  /** Unused since item 11: the camera adapts (src/render/exposure.ts), not the torch. Kept for old callers. */
  gain: number;
  /** Beam bounce (item 11): unshadowed wide spot at the beam's hit point (src/render/flashlight-bounce.ts). */
  bounce: any;
  /** 1 while the torch is on (uTorchLit). */
  lit: any;
  setOn(on: boolean): void;
  update(dt: number, t: number): void;
}

export function createFlashlight(camera: any, preset: PresetConfig): Flashlight {
  // A tired 2-D-cell incandescent torch: ~30 cd peak (≈ 377 W in Blender units). At 60 cd the hot spot clipped to
  // white on any surface within ~1.5 m; the cookie's gaussian core carries the centre, the wide penumbra the edge.
  // LIGHTING lane (item 11): 120 cd peak / ≈ 21 lm, cone 45° with penumbra 0.5 (the cookie shapes the core and the
  // spill shelf), 2900 K. Auto-exposure (item 4) now handles near walls — the torch is never dimmed for them.
  const baseIntensity = 120;
  const kc = kelvinToLinearRGB(TORCH_KELVIN);
  const light = new THREE.SpotLight(new THREE.Color(kc[0], kc[1], kc[2]), baseIntensity, 18, (45 * Math.PI) / 180, 0.5, 2);
  light.castShadow = true;
  light.shadow.mapSize.set(preset.shadows.flashlightMapSize, preset.shadows.flashlightMapSize);
  light.shadow.radius = preset.shadows.radius;
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.02;
  light.shadow.camera.near = 0.08;
  light.shadow.camera.far = 18;
  // Must be the TSL Fn itself (LightsNode hashes light.colorNode.getCacheKey(); SpotLightNode calls it with lightCoord).
  light.colorNode = flashlightCookie;
  uTorchPos.onRenderUpdate(() => uTorchPos.value.setFromMatrixPosition(light.matrixWorld));
  // Held slightly right/below the eye so shadows are visible from the camera.
  light.position.set(0.18, -0.16, 0.05);
  light.target.position.set(0.02, -0.05, -3);
  camera.add(light);
  camera.add(light.target);

  let beam: any = null;
  if (preset.post.volumetricBeam) {
    const len = 5;
    const geo = new THREE.ConeGeometry(Math.tan(light.angle * 0.5) * len, len, 32, 1, true);
    geo.translate(0, -len / 2, 0);
    geo.rotateX(-Math.PI / 2); // apex at origin, pointing -z
    const uBeam = uniform(0.05);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const along = positionGeometry.z.negate().div(len); // 0 at the lens, 1 at the far end
    const soft = abs(dot(normalView, positionViewDirection)).pow(2); // fade the silhouette edges
    const fall = float(1).sub(along).pow(1.6).mul(smoothstep(0.0, 0.08, along));
    mat.colorNode = vec3(1, 0.95, 0.85).mul(fall.mul(soft).mul(uBeam));
    beam = new THREE.Mesh(geo, mat);
    beam.position.copy(light.position);
    beam.lookAt(light.target.position);
    beam.renderOrder = 10;
    beam.castShadow = false;
    beam.receiveShadow = false;
    beam.frustumCulled = false;
    beam.name = 'flashlight-beam-stub';
    camera.add(beam);
  }

  // Beam bounce: a wide (85°, penumbra 1 ≈ cosine lobe) unshadowed spot at the hit point aimed back out of the
  // surface — the hit surface does not relight itself; its walls, floor and ceiling around it do. Driven per frame
  // by src/render/flashlight-bounce.ts; dark until then. Must exist from load (the LightsNode light set is fixed).
  const bounce = new THREE.SpotLight(0xffffff, 0, 5, (85 * Math.PI) / 180, 1, 2);
  bounce.castShadow = false;
  bounce.name = 'flashlight-bounce';

  let on = true;
  let flickerT = 0;
  let flickerLevel = 1;
  return {
    light,
    beam,
    intensity: baseIntensity,
    gain: 1,
    bounce,
    lit: uTorchLit, // ?debug A/B (R2-2)
    setOn(v: boolean) {
      on = v;
      // PERF (review): the light stays visible — light.visible = false drops it from the scene's light list, which
      // changes the scene LightsNode key and rebuilds every visible render object on each torch toggle. Off = dark
      // (intensity 0; explicit LightsNodes ignore .visible anyway) and its shadow map frozen.
      if (!v) light.intensity = 0;
      uTorchLit.value = v ? 1 : 0;
      light.shadow.autoUpdate = v;
      if (v) light.shadow.needsUpdate = true;
      if (beam) beam.visible = v;
    },
    update(dt: number, t: number) {
      if (!on) return;
      // Battery flicker: rare short dips.
      flickerT -= dt;
      if (flickerT <= 0) {
        flickerT = 3 + Math.random() * 9;
        flickerLevel = Math.random() < 0.35 ? 0.35 + Math.random() * 0.4 : 1;
      }
      const target = flickerLevel < 1 && flickerT > 0.12 ? 1 : flickerLevel;
      const wobble = 1 + 0.015 * Math.sin(t * 13.1) * Math.sin(t * 7.3);
      light.intensity = this.intensity * target * wobble; // LIGHTING lane (item 11): no near-wall dimming (gain)
    },
  };
}
