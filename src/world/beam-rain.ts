// Rain lit by our low beams (docs/C1-OPENING.md §5.1 "lit rain streaks", §7.2 "rain shows only inside beams").
// There is no world rain geometry; at night, rain is only visible where a lamp lights it. A box of streaks rides the
// car (interior root = car space: local (x, z, −y)), from 1.2 m to 40 m ahead, 12 m wide, 3 m tall. Each streak is a
// heavy-rain drop (Ø 2–3 mm, terminal ≈ 8 m/s) smeared over a 1/30 s exposure, plus the car's own 19 m/s: a 0.3–0.7 m
// streak slanting back toward the glass. Its radiance = the beam's illuminance at that point (both lamps,
// headlamps.lowBeamPattern × I_peak / d²) × a drop scattering factor, so it exists only inside the beams and fades
// with distance. Additive, no depth write, never lit by anything else.

import * as THREE from 'three/webgpu';
import { attribute, float, fract, uniform, vec3, varying, atan, max, time } from 'three/tsl';
import { lowBeamPattern } from '../render/headlamps.ts';

const VOL = { x0: -6, x1: 6, y0: 1.2, y1: 40, z0: 0, z1: 3 } as const;
/** Lamp centres in car space (sedan.py), the 15 kcd peak. */
const LAMPS: Array<[number, number, number]> = [[-0.58, 2.43, 0.64], [0.58, 2.43, 0.64]];
const PEAK_CD = 15000;
/** Streak radiance per lux of beam illuminance (cd/m² per lx): a sparse field of 2 mm drops, forward-scattered. */
const SCATTER = 0.0025;

export function createBeamRain(count: number) {
  const uOn = uniform(0); // headlights on × rain
  const uSpeed = uniform(19); // car speed, m/s
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 4 * 3);
  const seed = new Float32Array(count * 4 * 4);
  const corner = new Float32Array(count * 4 * 2);
  const idx = new Uint32Array(count * 6);
  let r = 12345;
  const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < count; i++) {
    const sx = rnd(), sy = rnd(), sz = rnd(), sr = rnd();
    for (let k = 0; k < 4; k++) {
      const j = i * 4 + k;
      seed.set([sx, sy, sz, sr], j * 4);
      corner.set([k & 1 ? 1 : -1, k & 2 ? 1 : 0], j * 2);
    }
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  geo.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.5, -20), 30);

  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  m.fog = false;
  const sd = attribute('seed', 'vec4');
  const cn = attribute('corner', 'vec2');
  const fall = sd.w.mul(2).add(7); // 7–9 m/s terminal velocity
  const H = VOL.z1 - VOL.z0;
  const L = VOL.y1 - VOL.y0;
  // car space position: drops fall and stream back past the moving car (wrap in the box)
  const cx = sd.x.mul(VOL.x1 - VOL.x0).add(VOL.x0);
  const cz = fract(sd.z.sub(time.mul(fall).div(H))).mul(H).add(VOL.z0);
  const cy = fract(sd.y.sub(time.mul(uSpeed).div(L))).mul(L).add(VOL.y0);
  // streak = velocity relative to the car × 1/30 s (motion blur of the film frame)
  const vel = vec3(0, uSpeed.negate(), fall.negate()).mul(1 / 30);
  const width = float(0.0012).add(cy.mul(0.00012)); // drop + blur, wider far away so it survives the pixel grid
  const p = vec3(cx.add(cn.x.mul(width)), cy, cz).add(vel.mul(cn.y));
  m.positionNode = vec3(p.x, p.z, p.y.negate()); // car → interior local (x, z, −y)
  // beam illuminance at the streak from both lamps (angles in degrees: h right, v up)
  let e: any = float(0);
  for (const [lx, ly, lz] of LAMPS) {
    const dx = cx.sub(lx);
    const dy = max(cy.sub(ly), 0.3);
    const dz = cz.sub(lz);
    const d2 = dx.mul(dx).add(dy.mul(dy)).add(dz.mul(dz));
    const h = atan(dx.div(dy)).mul(180 / Math.PI);
    const v = atan(dz.div(dy)).mul(180 / Math.PI);
    e = e.add(lowBeamPattern(h, v).mul(PEAK_CD).div(d2));
  }
  const lum = varying(e.mul(SCATTER).mul(uOn));
  // 3200 K-ish warm white
  m.colorNode = vec3(1.0, 0.82, 0.62).mul(lum);

  const mesh = new THREE.Mesh(geo, m);
  mesh.name = 'beam-rain';
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  return { mesh, uOn, uSpeed };
}
