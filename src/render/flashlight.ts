// Player flashlight: shadowed SpotLight with a procedural TSL cookie (SpotLightNode: light.colorNode(lightCoord)),
// plus a volumetric-beam STUB for Max (an additive soft cone; the real VolumeNodeMaterial beam comes later).
// Intensity convention: runtime candela = Blender W / (4π) (CLAUDE.md light units).

import * as THREE from 'three/webgpu';
import { Fn, abs, dot, float, max, mx_noise_float, normalView, positionGeometry, positionViewDirection, smoothstep, uniform, vec3 } from 'three/tsl';
import type { PresetConfig } from './presets.ts';

/** Flashlight cookie: soft hot centre, wide spill, a faint reflector ring, lens smudges. lightCoord.xy in [0,1]. */
export const flashlightCookie = Fn(([lightCoord]: [any]) => {
  const p = lightCoord.xy.sub(0.5).mul(2);
  const r = p.length();
  // Soft hot spot (gaussian, not a cone), a wide dim spill that is GONE before the cone edge (r = 1) so the
  // penumbra — not the cookie — sets the edge, and a faint reflector ring (no dark inner ring: it read as a hard disc).
  const core = r.mul(r).div(0.07).negate().exp().mul(0.6);
  const spill = float(1).sub(smoothstep(0.05, 0.95, r)).mul(0.5);
  const ringOffset = r.sub(0.62).div(0.1);
  const ring = ringOffset.mul(ringOffset).negate().exp().mul(0.05);
  const smudge = mx_noise_float(vec3(p.mul(3.1), 0.37)).mul(0.04);
  const v = max(core.add(spill).add(ring).add(smudge).mul(float(1).sub(smoothstep(0.8, 1.0, r))), 0);
  return vec3(v, v.mul(0.96), v.mul(0.88)); // slightly warm incandescent falloff
});

export interface Flashlight {
  light: any;
  beam: any | null;
  intensity: any; // base intensity (cd), flicker multiplies this
  /** Eye-adaptation gain (0..1) — the rig lowers it when the beam lands within ~1.5 m so near walls don't clip. */
  gain: number;
  setOn(on: boolean): void;
  update(dt: number, t: number): void;
}

export function createFlashlight(camera: any, preset: PresetConfig): Flashlight {
  // A tired 2-D-cell incandescent torch: ~30 cd peak (≈ 377 W in Blender units). At 60 cd the hot spot clipped to
  // white on any surface within ~1.5 m; the cookie's gaussian core carries the centre, the wide penumbra the edge.
  const baseIntensity = 30;
  const light = new THREE.SpotLight(0xfff1dc, baseIntensity, 18, Math.PI / 6.5, 0.8, 2);
  light.castShadow = true;
  light.shadow.mapSize.set(preset.shadows.flashlightMapSize, preset.shadows.flashlightMapSize);
  light.shadow.radius = preset.shadows.radius;
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.02;
  light.shadow.camera.near = 0.08;
  light.shadow.camera.far = 18;
  // Must be the TSL Fn itself (LightsNode hashes light.colorNode.getCacheKey(); SpotLightNode calls it with lightCoord).
  light.colorNode = flashlightCookie;
  // Held slightly right/below the eye so shadows are visible from the camera.
  light.position.set(0.18, -0.16, 0.05);
  light.target.position.set(0.02, -0.05, -3);
  camera.add(light);
  camera.add(light.target);

  let beam: any = null;
  if (preset.post.volumetricBeam) {
    const len = 5;
    const geo = new THREE.ConeGeometry(Math.tan(light.angle * 0.8) * len, len, 32, 1, true);
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

  let on = true;
  let flickerT = 0;
  let flickerLevel = 1;
  return {
    light,
    beam,
    intensity: baseIntensity,
    gain: 1,
    setOn(v: boolean) {
      on = v;
      light.visible = v;
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
      light.intensity = baseIntensity * target * wobble * this.gain;
    },
  };
}
