// Player flashlight: shadowed SpotLight with a procedural TSL cookie (SpotLightNode: light.colorNode(lightCoord)),
// plus a volumetric-beam STUB for Max (an additive soft cone; the real VolumeNodeMaterial beam comes later).
// Intensity convention: runtime candela = Blender W / (4π) (CLAUDE.md light units).

import * as THREE from 'three/webgpu';
import { Fn, If, Loop, cameraPosition, dot, float, length, max, mx_noise_float, positionWorld, smoothstep, uniform, vec3 } from 'three/tsl';
import { SKY_U } from '../world/atmosphere.ts';
import type { PresetConfig } from './presets.ts';
import { kelvinToLinearRGB } from '../world/lights.ts';
import { enableViewCasterCull } from './view-caster-cull.ts';

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
 * Every term is a uniform (look API torchCore/torchSigma2/torchSpill/torchShelf/torchTail).
 * SUPERSEDED (runtime AD review, round D): the live profile is LOOK.torch* in look.ts — 2000 cd / 30.9 lm (CLAUDE.md). */
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
  // RUNTIME F3 (lead ruling): indoors the torch's caster set follows the VIEW layers, so the yard meshes the window
  // cull (src/world/window-cull.ts) moved off layer 0 — everything not seen through an opening — cast nothing into it.
  // An indoor receiver lit by an indoor torch can only be shadowed by an occluder between them: inside the house, or
  // in the opening's sub-frustum (still on layer 0). Measured u1-armoire before: torch pass 168–188 draws / 350 k tris,
  // of which EXT2 40–45 / 202 k (docs/RUNTIME-F-PLAN.md F3).
  light.userData.windowCullCasters = false;
  enableViewCasterCull(light); // PERF review (contract 116): torch casters limited to what can shadow the view
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
    // runtime lane E (item 10): single-scattering beam, replacing the round-2 stub (a uniform additive glow over the
    // whole 45° cone, blind to the 2000 cd / 2.9° HWHM core). Each pixel of the cone's far wall marches 12 steps along
    // its view ray, from the eye to the cone's far wall (depth-tested), summing the torch's in-scattered light:
    //   L = σs · Σ I(θ)/d² · p(cos) · Δt      (nits: σs 1/m · cd/m² · 1/sr · m)
    // I(θ) = the same cookie profile the spot uses (core gaussian + spill shelf + tail, look.ts torch*), d = distance
    // from the lens, p = Henyey–Greenstein g 0.6 (mist / drizzle droplets are strongly forward-scattering: looking
    // along your own beam you see their weak back-scatter — a faint shaft round the core, never a laser rod);
    // σs = the scene's fog extinction outdoors (SKY_U.fogSigma ≈ 0.01 /m in this rain), 4e-4 /m indoors (dusty air).
    const len = 14;
    const geo = new THREE.ConeGeometry(Math.tan(light.angle * 0.5) * len * 1.05, len, 32, 1, true);
    geo.translate(0, -len / 2, 0);
    geo.rotateX(-Math.PI / 2); // apex at origin, pointing -z
    const uAxis = uniform(new THREE.Vector3(0, 0, -1));
    const uCd = uniform(0);
    const uTanA = uniform(1);
    const uCol = uniform(new THREE.Color(kc[0], kc[1], kc[2]));
    const _q = new THREE.Vector3();
    uAxis.onRenderUpdate(() => {
      light.getWorldPosition(_q);
      uAxis.value.setFromMatrixPosition(light.target.matrixWorld).sub(_q).normalize();
      return uAxis.value;
    });
    uCd.onRenderUpdate(() => light.intensity);
    uTanA.onRenderUpdate(() => Math.tan(light.angle));
    const N = 12;
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: true, side: THREE.BackSide, blending: THREE.AdditiveBlending });
    mat.colorNode = Fn(() => {
      const toP = positionWorld.sub(cameraPosition);
      const tBack = length(toP);
      const rd = toP.div(tBack);
      // beamab3: reading viewportDepthTexture inside the MRT scene pass forces a framebuffer copy that split the pass
      // and lost the opaque frame (black). The cone is depth-TESTED instead: where a surface is nearer than the cone's
      // far wall the pixel is not drawn — the shaft simply ends where the beam meets the world (a hit within the
      // 14 m cone hides the glow in front of it, an acceptable loss: there the lit surface dominates).
      const dt = tBack.div(N);
      const sigma = max(SKY_U.fogSigma, 4e-4);
      const acc = float(0).toVar();
      Loop(N, ({ i }: any) => {
        const x = cameraPosition.add(rd.mul(float(i).add(0.5).mul(dt)));
        const v = x.sub(uTorchPos);
        // near field: a 5 cm reflector only forms its 2000 cd beam beyond ≈ I·A/Φcore = 2000 · 0.002 / 25 ≈ 0.16 m²
        // (d ≈ 0.4 m); inside that the column's illuminance is bounded by Φ/A ≈ 12.5 klux, not I/d² (beamab: the
        // unclamped 1/d² beside the lens read 75 nits and blacked the frame through the exposure meter)
        const d2 = dot(v, v).max(0.16);
        const s = dot(v, uAxis);
        If(s.greaterThan(0.01), () => {
          const r = length(v.sub(uAxis.mul(s))).div(s).div(uTanA);
          const core = r.mul(r).div(uTorchSigma2).negate().exp().mul(uTorchCore);
          const spill = float(1).sub(smoothstep(uTorchShelf, 0.95, r)).mul(uTorchSpill);
          const tail = float(1).sub(smoothstep(0.6, 1.0, r)).mul(uTorchTail);
          const prof = core.add(spill).add(tail);
          // scattering angle: light travels along v̂, leaves toward the eye along −rd
          const c = dot(v, rd).negate().div(d2.sqrt());
          const g = 0.6;
          const phase = float((1 - g * g) / (4 * Math.PI)).div(float(1 + g * g).sub(c.mul(2 * g)).pow(1.5));
          acc.addAssign(prof.mul(phase).div(d2));
        });
      });
      // beamab2 (Max, road): one NaN pixel here spread through bloom/TAAU and blacked the whole frame — clamp to a
      // finite, physically generous ceiling (≈ 4 nits: the near-lens column in thick mist)
      return vec3(uCol).mul(max(acc.mul(dt).mul(sigma).mul(uCd).mul(uTorchLit), 0).min(4));
    })();
    beam = new THREE.Mesh(geo, mat);
    beam.position.copy(light.position);
    beam.lookAt(light.target.position);
    beam.renderOrder = 10;
    beam.castShadow = false;
    beam.receiveShadow = false;
    beam.frustumCulled = false;
    beam.name = 'flashlight-beam';
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
