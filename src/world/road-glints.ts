// Wet-road lamp reflections (runtime lane D, opening leftovers: "no specular streaks under the oncoming lights").
//
// A lamp seen across a wet road at night is reflected as a long streak running from under the lamp toward the viewer.
// The road material alone cannot draw it: the lamp lens is not a light-list entry with a size, the scene has no
// reflections of emissive meshes, and the lobe of a 0.05–0.2-roughness film at an 85–89° grazing angle is narrower than
// the shading normals resolve. So each lamp gets one additive quad on the road at its mirror point, shaped by
// microfacet optics (Walter et al. 2007 GGX; Trowbridge–Reitz slope distribution):
//  - the mirror point M lies on the ground line lamp-foot → camera-foot at h_l / (h_l + h_c) from the lamp foot;
//  - a slope spread σ (rain-pocked water film over tyre-polished binder: σ ≈ 0.12 rad — the meso-scale ripples, not the
//    0.05–0.2 micro roughness, set the width) maps to a lateral half-width w = σ·2·sinθ·d/cosθ (d = 1/(1/d_c + 1/d_l))
//    and an along-road half-length w / sinθ — the 1/sinθ elongation is why the streak is long at grazing angles;
//  - peak luminance L = F(θ)·I / (4π σ² d_l² sinθ_v): the lamp's intensity I toward M (its beam pattern) spread by the
//    lobe, Fresnel for water at the grazing angle (Schlick, F0 0.02).
// No light-list entry, no shadow, one 2-triangle draw per lamp; invisible when no lamp is lit.

import * as THREE from 'three/webgpu';
import { exp, uniform, uv, vec2, vec3 } from 'three/tsl';

export interface GlintSource {
  /** World position of the lens (updated by the caller before update()). */
  pos: any;
  /** World forward of the beam (unit). */
  dir: any;
  /** Linear colour. */
  color: [number, number, number];
  /** Axial intensity now, cd. */
  cd: () => number;
  /** Beam half-width (Gaussian σ), rad: halogen high ≈ 0.09 (≈ 5°), low ≈ 0.12. */
  beamSigma: number;
}

const SIGMA = 0.12; // rad, meso-slope spread of a rain-pocked water film (see header)
const F0 = 0.02; // water

export function createRoadGlints(parent: any, roadY: () => number) {
  const items: { src: GlintSource; mesh: any; uL: any; uC: any }[] = [];
  const geo = new THREE.PlaneGeometry(1, 1); // XY plane, uv 0..1; laid flat by the per-frame basis
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const m4 = new THREE.Matrix4();
  let warm = false;

  const add = (src: GlintSource) => {
    const uL = uniform(0);
    const uC = uniform(new THREE.Color(src.color[0], src.color[1], src.color[2]));
    const m = new THREE.MeshBasicNodeMaterial();
    m.transparent = true;
    m.depthWrite = false;
    m.blending = THREE.AdditiveBlending;
    m.fog = false;
    m.side = THREE.DoubleSide; // the basis below is left-handed (lat = up × along)
    // quad spans ±3σ in both axes: Gaussian lobe in slope space
    const q = uv().sub(vec2(0.5, 0.5)).mul(6.0);
    const g = exp(q.x.mul(q.x).add(q.y.mul(q.y)).mul(-0.5));
    m.colorNode = vec3(uC).mul(uL).mul(g);
    m.name = 'road_glint';
    const mesh = new THREE.Mesh(geo, m);
    mesh.name = 'road-glint';
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.visible = false;
    parent.add(mesh);
    items.push({ src, mesh, uL, uC });
  };

  const update = (camera: any) => {
    const cy = camera.getWorldPosition(tmpB);
    const cx = cy.x;
    const cz = cy.z;
    const camY = cy.y;
    const ry = roadY();
    for (const it of items) {
      const I = it.src.cd();
      const p = it.src.pos;
      const hl = p.y - ry;
      const hc = camY - ry;
      const dx = cx - p.x;
      const dz = cz - p.z;
      const D = Math.hypot(dx, dz);
      if (I <= 1e-3 || hl <= 0.05 || hc <= 0.05 || D < 1) {
        it.mesh.visible = warm;
        it.uL.value = 0;
        continue;
      }
      const t = hl / (hl + hc);
      const mx = p.x + dx * t;
      const mz = p.z + dz * t;
      const dl = D * t; // ground distance lamp foot → M
      const dc = D - dl;
      const sinT = Math.sin(Math.atan2(hc, dc)); // grazing elevation (equal both sides at the mirror point)
      const cosT = Math.cos(Math.atan2(hc, dc));
      const dlen = Math.hypot(dl, hl);
      // beam pattern toward M (Gaussian about the beam axis)
      tmpA.set(mx - p.x, ry - p.y, mz - p.z).normalize();
      const off = Math.acos(Math.max(-1, Math.min(1, tmpA.dot(it.src.dir))));
      const Idir = I * Math.exp(-0.5 * (off / it.src.beamSigma) ** 2);
      // Schlick: cos of the angle to the macro normal = sin of the elevation
      const F = F0 + (1 - F0) * Math.pow(1 - sinT, 5);
      const L = (F * Idir) / (4 * Math.PI * SIGMA * SIGMA * dlen * dlen * Math.max(0.01, sinT));
      const dd = 1 / (1 / Math.max(0.5, Math.hypot(dc, hc)) + 1 / Math.max(0.5, dlen));
      const w = (SIGMA * 2 * sinT * dd) / Math.max(0.05, cosT); // lateral σ, m
      const len = Math.min(w / Math.max(0.01, sinT), 0.45 * D); // along-road σ, m (capped inside lamp…camera)
      // basis: X = lateral, Y = along (toward the camera), Z = up; quad covers ±3σ
      const ax = dx / D;
      const az = dz / D;
      tmpA.set(ax, 0, az); // along
      const lat = new THREE.Vector3().crossVectors(up, tmpA).normalize();
      const sx = 6 * Math.max(w, 0.04);
      const sy = 6 * Math.max(len, 0.08);
      m4.makeBasis(lat.multiplyScalar(sx), tmpA.clone().multiplyScalar(sy), up.clone());
      m4.setPosition(mx, ry + 0.015, mz);
      it.mesh.matrix.copy(m4);
      it.mesh.matrixWorldNeedsUpdate = true; // parent: the scene (identity)
      it.uL.value = L;
      it.mesh.visible = L > 1e-3 || warm;
    }
  };

  return {
    add,
    update,
    setWarm(on: boolean) {
      warm = on;
      for (const it of items) it.mesh.visible = on;
    },
    meshes: () => items.map((i) => i.mesh),
  };
}
