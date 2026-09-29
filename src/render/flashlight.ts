// Player flashlight: shadowed SpotLight with a procedural TSL cookie (SpotLightNode: light.colorNode(lightCoord)),
// plus a volumetric-beam STUB for Max (an additive soft cone; the real VolumeNodeMaterial beam comes later).
// Intensity convention: runtime candela = Blender W / (4π) (CLAUDE.md light units).

import * as THREE from 'three/webgpu';
import { Fn, abs, dot, float, max, mx_noise_float, normalView, positionGeometry, positionViewDirection, smoothstep, uniform, vec3 } from 'three/tsl';
import type { PresetConfig } from './presets.ts';

/** Flashlight cookie: hot centre, faint reflector ring, darker inner ring, lens smudges. lightCoord.xy in [0,1]. */
export const flashlightCookie = Fn(([lightCoord]: [any]) => {
  const p = lightCoord.xy.sub(0.5).mul(2);
  const r = p.length();
  const core = float(1).sub(smoothstep(0.0, 0.62, r)).mul(0.85);
  const spill = float(1).sub(smoothstep(0.55, 1.0, r)).mul(0.28);
  const ringOffset = r.sub(0.66).div(0.045);
  const ring = ringOffset.mul(ringOffset).negate().exp().mul(0.22);
  const innerDarkOffset = r.sub(0.42).div(0.06);
  const innerDark = innerDarkOffset.mul(innerDarkOffset).negate().exp().mul(0.1);
  const smudge = mx_noise_float(vec3(p.mul(3.1), 0.37)).mul(0.07);
  const v = max(core.add(spill).add(ring).sub(innerDark).add(smudge), 0);
  return vec3(v, v.mul(0.97), v.mul(0.9)); // slightly warm incandescent falloff
});

export interface Flashlight {
  light: any;
  beam: any | null;
  intensity: any; // base intensity (cd), flicker multiplies this
  setOn(on: boolean): void;
  update(dt: number, t: number): void;
}

export function createFlashlight(camera: any, preset: PresetConfig): Flashlight {
  const baseIntensity = 60; // candela (≈ 754 W in Blender units)
  const light = new THREE.SpotLight(0xfff1dc, baseIntensity, 18, Math.PI / 7.5, 0.45, 2);
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
    const geo = new THREE.ConeGeometry(Math.tan(Math.PI / 7.5) * len, len, 32, 1, true);
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
      light.intensity = baseIntensity * target * wobble;
    },
  };
}
