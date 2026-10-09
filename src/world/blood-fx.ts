// C2-ESCAPE §3.3–3.7 (B4 + B5): the blood of C2 / C2c as real-time geometry.
//
// Particles: ONE instanced mesh of low-poly spheres, stretched into capsules along their velocity. Every particle's
// flight is the closed-form linear-drag ballistic of src/world/blood-math.ts evaluated in the TSL vertex stage on one
// clock uniform (no per-frame CPU work); its death time and landing were precomputed at load (240 Hz against the stage
// proxies), so the stain appears where and when the drop dies. A small ring of dynamic slots carries the live
// emitters (the tread-11 drip and its crown, the head's stream once the head node exists).
// Shading (unlit material, analytic, one light + the torch): Lambert + GGX (F0 0.022) from the session's shadow light
// (the lamp, or the roaming stroke) and the player's torch, plus the BACK-LIT term (§3.4)
//   L_t = E · T(d) · p_HG(g = 0.95, cos θ) · (1 − F),  T = exp(−μa·d) per channel, d = the chord at the pixel,
// so a back-lit 4 mm jet keeps a near-black core with a glowing deep-red rim and the mist glows red.
// Stains / pools / prints: ONE instanced mesh of quads on the receivers (procedural stain atlas painted on a canvas at
// load, 4 × 4 cells), alpha-blended, the same analytic shading with a meniscus normal from the atlas height and the
// roughness from the age (clotting, §3.4). Pools grow from their fed volume (2.75 mm settled film).
// Draws: 2 (particles + stains). Tiers: particles 100 / 620 / 1450, stains 12 / 40 / 80.

import * as THREE from 'three/webgpu';
import { Fn, uniform, instancedBufferAttribute, positionGeometry, varyingProperty, vec2, vec3, vec4, float, exp, normalize, cross, dot, max, min, step, smoothstep, pow, sqrt, mix, abs, cameraPosition, texture, length, clamp, select } from 'three/tsl';
import { planToWorld } from '../shared/coords.ts';
import { BLOOD_TIERS, poolRadius, rng, seedC2, stainsOf, tauFor, terminate, type Particle, type Stain } from './blood-math.ts';
import { C2_CONTACT, C2_PULSES, C2_DURATION } from '../cutscenes/c2-room.ts';
import { NECK, HEAD_REST, treadNosing } from '../cutscenes/stage.ts';
import { ADA_LAST_TREAD, adaOnTread } from '../cutscenes/c2c-up.ts';
import type { P3 } from '../cutscenes/types.ts';
import { BLOOD_UNIFORMS } from '../materials/blood.ts';
import { specById } from '../materials/spec-index.ts';

const DYN = 64; // dynamic particle slots
const W = (p: P3) => planToWorld(p);
const WV = (v: P3): [number, number, number] => [v[0], v[2], -v[1]]; // PLAN vector → WORLD

/** §3.4 / K7 (material-spec blood_wet): absorption μa (/mm) of the arterial jets (toward oxygenated) and the seep /
 *  pools, the thick-layer albedos. */
const BW = (specById('blood_wet')?.params ?? {}) as Record<string, any>;
const MUA_JET: [number, number, number] = BW.muA ?? [1.0, 100, 120];
const MUA_POOL: [number, number, number] = BW.muA_pool ?? [3.0, 110, 130];
const ALB_JET: [number, number, number] = BW.albedoJet ?? [0.18, 0.012, 0.01];
const ALB_POOL: [number, number, number] = (specById('blood_wet')?.avgAlbedo as [number, number, number]) ?? [0.11, 0.009, 0.008];

export interface BloodDeps {
  scene: any;
  /** the session's one shadow light (lamp / roaming stroke) */
  keyLight: () => any | null;
  preset: 'low' | 'medium' | 'max';
  /** the severed head's world position (its cut end), when the head node exists */
  headPos?: () => any | null;
}

export function createBloodFx(d: BloodDeps) {
  const tier = BLOOD_TIERS[d.preset];
  // ---- the C2 seed (deterministic; terminations precomputed)
  const parts: Particle[] = seedC2({
    neck: NECK,
    pulses: C2_PULSES.slice(0, 4),
    contact: C2_CONTACT,
    castoff: { p: [5.02, 3.74, 2.42], t: [2.0, 3.2, 4.4, 5.6, 6.8] },
    seep: { p: [5.3, 2.21, 1.38], from: 10.4, to: 22.5 },
    tier,
  });
  const stains: Stain[] = stainsOf(parts, Math.max(4, tier.stains - 6));

  // ------------------------------------------------------------------------------------------------ particles
  const N = parts.length + DYN;
  const aA = new Float32Array(N * 4); // p0.xyz, t0
  const aB = new Float32Array(N * 4); // v0.xyz, tEnd
  const aC = new Float32Array(N * 4); // r, tau, kind, seed
  const write = (i: number, p: Particle) => {
    const w = W(p.p0);
    const v = WV(p.v0);
    aA.set([w[0], w[1], w[2], p.t0], i * 4);
    aB.set([v[0], v[1], v[2], p.tEnd], i * 4);
    aC.set([p.r, p.tau, p.kind, (i * 0.618) % 1], i * 4);
  };
  parts.forEach((p, i) => write(i, p));
  for (let i = parts.length; i < N; i++) aA[i * 4 + 3] = 1e9; // dynamic slots: not born
  const bufA = new THREE.InstancedBufferAttribute(aA, 4);
  const bufB = new THREE.InstancedBufferAttribute(aB, 4);
  const bufC = new THREE.InstancedBufferAttribute(aC, 4);
  for (const b of [bufA, bufB, bufC]) b.setUsage(THREE.DynamicDrawUsage);

  const uT = uniform(-100); // the blood clock (s since C2 t = 0); −100 = nothing alive
  const uStreak = uniform(d.preset === 'low' ? 0 : 1 / 60); // capsule stretch = speed × one 60 Hz exposure
  const uKeyPos = uniform(new THREE.Vector3(4.6, 1.35, -4.25));
  const uKeyCol = uniform(new THREE.Color(1, 0.5, 0.2));
  const uKeyI = uniform(0);
  const uTorchPos = uniform(new THREE.Vector3());
  const uTorchDir = uniform(new THREE.Vector3(0, 0, -1));
  const uTorchCol = uniform(new THREE.Color(1, 0.8, 0.6));
  const uTorchI = uniform(0);
  const uTorchCos = uniform(new THREE.Vector2(Math.cos(0.4), Math.cos(0.05)));
  const uAmbient = uniform(0.02);

  const A = instancedBufferAttribute(bufA);
  const B = instancedBufferAttribute(bufB);
  const C = instancedBufferAttribute(bufC);
  const vNormal = varyingProperty('vec3', 'vBloodN');
  const vPos = varyingProperty('vec3', 'vBloodP');
  const vRad = varyingProperty('float', 'vBloodR');
  const vKind = varyingProperty('float', 'vBloodK');

  const position = Fn(() => {
    const t = uT.sub(A.w);
    const life = B.w.sub(A.w);
    const alive = step(0, t).mul(step(t, life));
    const tau = C.y;
    const e = exp(t.max(0).negate().div(tau));
    const k = tau.mul(float(1).sub(e));
    const vtY = tau.mul(-9.81);
    const p = A.xyz.add(B.xyz.mul(k)).add(vec3(0, vtY.mul(t).sub(vtY.mul(k)), 0));
    const vel = B.xyz.mul(e).add(vec3(0, vtY.mul(float(1).sub(e)), 0));
    const sp = length(vel).max(1e-4);
    const u = vel.div(sp);
    const ref = select(abs(u.y).greaterThan(0.9), vec3(1, 0, 0), vec3(0, 1, 0));
    const a = normalize(cross(u, ref));
    const b = cross(u, a);
    const r = C.x;
    // jets: the element spacing is filled by the stretch (≥ the 4 ms spacing); drops: one 60 Hz exposure
    const half = min(sp.mul(select(C.z.lessThan(0.5), max(uStreak, 0.0025), uStreak)).mul(0.5), 0.05);
    const g = positionGeometry;
    const lx = r.add(half);
    const wp = p.add(u.mul(g.x.mul(lx))).add(a.mul(g.y.mul(r))).add(b.mul(g.z.mul(r)));
    vNormal.assign(normalize(u.mul(g.x.div(lx)).add(a.mul(g.y.div(r))).add(b.mul(g.z.div(r)))));
    vPos.assign(wp);
    vRad.assign(r);
    vKind.assign(C.z);
    return mix(p, wp, alive).mul(alive); // dead/unborn: collapsed at the origin (degenerate, nothing drawn)
  })();

  /** GGX specular × N·L (height-correlated Smith), Schlick F. */
  const ggx = (N: any, V: any, L: any, rough: any, f0: any) => {
    const H = normalize(V.add(L));
    const nl = max(dot(N, L), 0);
    const nv = max(dot(N, V), 1e-3);
    const nh = max(dot(N, H), 0);
    const vh = max(dot(V, H), 0);
    const a = rough.mul(rough);
    const a2 = a.mul(a);
    const dd = nh.mul(nh).mul(a2.sub(1)).add(1);
    const D = a2.div(dd.mul(dd).mul(Math.PI));
    const vis = float(0.5).div(nl.mul(sqrt(nv.mul(nv).mul(float(1).sub(a2)).add(a2))).add(nv.mul(sqrt(nl.mul(nl).mul(float(1).sub(a2)).add(a2)))).max(1e-4));
    const F = f0.add(float(1).sub(f0).mul(pow(float(1).sub(vh), 5)));
    return D.mul(vis).mul(F).mul(nl);
  };

  /** Lambert + GGX from the key light and the torch at P with normal N (radiance, linear). */
  const shade = (P: any, N: any, albedo: any, rough: any, f0: any) => {
    const V = normalize(cameraPosition.sub(P));
    const Lk = uKeyPos.sub(P);
    const dk2 = dot(Lk, Lk).max(1e-4);
    const lk = Lk.div(sqrt(dk2));
    const Ek = uKeyCol.mul(uKeyI.div(dk2));
    const Lt = uTorchPos.sub(P);
    const dt2 = dot(Lt, Lt).max(1e-4);
    const lt = Lt.div(sqrt(dt2));
    const cone = smoothstep(uTorchCos.x, uTorchCos.y, dot(lt.negate(), uTorchDir));
    const Et = uTorchCol.mul(uTorchI.mul(cone).div(dt2));
    const diff = albedo.mul(1 / Math.PI);
    const ck = Ek.mul(diff.mul(max(dot(N, lk), 0)).add(ggx(N, V, lk, rough, f0)));
    const ct = Et.mul(diff.mul(max(dot(N, lt), 0)).add(ggx(N, V, lt, rough, f0)));
    return { c: ck.add(ct).add(albedo.mul(uAmbient)), V, Ek, lk };
  };

  const partMat = new THREE.MeshBasicNodeMaterial();
  partMat.name = 'blood-particles';
  partMat.positionNode = position;
  partMat.colorNode = Fn(() => {
    const N = normalize(vNormal);
    const jet = step(vKind, 0.5);
    const albedo = mix(vec3(...ALB_POOL), vec3(...ALB_JET), jet);
    const s = shade(vPos, N, albedo, float(0.12), float(0.022));
    // the back-lit term: chord d (mm) through the drop at this pixel, Beer–Lambert per channel, Henyey–Greenstein
    const nv = max(dot(N, s.V), 0.05);
    const dmm = vRad.mul(2000).mul(nv);
    const muA = mix(vec3(...MUA_POOL), vec3(...MUA_JET), jet);
    const T = exp(muA.mul(dmm).negate());
    const cosT = dot(s.lk.negate(), s.V); // lamp → particle vs particle → eye: 1 = looking into the light through it
    const g = 0.95;
    const pHG = float((1 - g * g) / (4 * Math.PI)).div(pow(float(1 + g * g).sub(cosT.mul(2 * g)), 1.5));
    const F = float(0.022).add(float(0.978).mul(pow(float(1).sub(nv), 5)));
    const back = s.Ek.mul(T).mul(pHG).mul(float(1).sub(F));
    return vec4(s.c.add(back), 1);
  })();
  const sphere = new THREE.IcosahedronGeometry(1, d.preset === 'low' ? 0 : 1);
  const partMesh = new THREE.InstancedMesh(sphere, partMat, N);
  partMesh.name = 'blood-particles';
  partMesh.frustumCulled = false;
  partMesh.castShadow = false;
  partMesh.receiveShadow = false;
  partMesh.visible = false;
  partMesh.renderOrder = 2;
  d.scene.add(partMesh);

  // ------------------------------------------------------------------------------------------------ the stain atlas
  const atlas = paintAtlas(1234);
  const atlasTex = new THREE.CanvasTexture(atlas);
  atlasTex.colorSpace = THREE.NoColorSpace;
  atlasTex.generateMipmaps = true;
  atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
  atlasTex.anisotropy = 4;

  // stain instances: s1 = world centre.xyz + yaw, s2 = len, wid, cell, kind (0 blood, 1 pool, 2 print), s3 = t0, ml, seed, opacity
  const SMAX = tier.stains + 24;
  const s1 = new Float32Array(SMAX * 4);
  const s2 = new Float32Array(SMAX * 4);
  const s3 = new Float32Array(SMAX * 4);
  for (let i = 0; i < SMAX; i++) s3[i * 4] = 1e9;
  const sb1 = new THREE.InstancedBufferAttribute(s1, 4);
  const sb2 = new THREE.InstancedBufferAttribute(s2, 4);
  const sb3 = new THREE.InstancedBufferAttribute(s3, 4);
  for (const b of [sb1, sb2, sb3]) b.setUsage(THREE.DynamicDrawUsage);
  let sCount = 0;
  const addStain = (p: P3, yaw: number, len: number, wid: number, cell: number, kind: number, t0: number, ml: number, opacity = 1): number => {
    if (sCount >= SMAX) return -1;
    const i = sCount++;
    const w = W(p);
    // world yaw: PLAN heading h → rotation about +Y by h (x' = cos h, z' = −sin h maps PLAN (cos h, sin h))
    s1.set([w[0], w[1] + 0.0012 + i * 0.00002, w[2], yaw], i * 4);
    s2.set([len, wid, cell, kind], i * 4);
    s3.set([t0, ml, (i * 0.37) % 1, opacity], i * 4);
    return i;
  };
  const SA = instancedBufferAttribute(sb1);
  const SB = instancedBufferAttribute(sb2);
  const SC = instancedBufferAttribute(sb3);
  const vUv = varyingProperty('vec2', 'vStainUv');
  const vSP = varyingProperty('vec3', 'vStainP');
  const vLoc = varyingProperty('vec2', 'vStainLoc');
  const stainPos = Fn(() => {
    const g = positionGeometry; // PlaneGeometry in XY, [−0.5, 0.5]
    const appear = smoothstep(SC.x, SC.x.add(0.25), uT);
    const grow = mix(float(0.55), float(1), appear);
    const c = SA.w.cos();
    const s = SA.w.sin();
    const lx = g.x.mul(SB.x).mul(grow);
    const lz = g.y.mul(SB.y).mul(grow);
    const wp = SA.xyz.add(vec3(lx.mul(c).add(lz.mul(s)), 0, lx.mul(s).negate().add(lz.mul(c))));
    const cell = SB.z;
    const cx = cell.mod(4);
    const cy = float(3).sub(cell.div(4).floor()); // CanvasTexture flipY: canvas row r is uv row 3 − r
    vUv.assign(vec2(cx.add(g.x.add(0.5)), cy.add(g.y.add(0.5))).div(4));
    vLoc.assign(vec2(g.x, g.y));
    vSP.assign(wp);
    return wp.mul(step(SC.x, uT));
  })();
  const uGameAge = uniform(0); // minutes since the strike (clotting / drying)
  const stainMat = new THREE.MeshBasicNodeMaterial();
  stainMat.name = 'blood-stains';
  stainMat.transparent = true;
  stainMat.depthWrite = false;
  stainMat.side = THREE.DoubleSide;
  stainMat.polygonOffset = true;
  stainMat.polygonOffsetFactor = -2;
  stainMat.polygonOffsetUnits = -4;
  stainMat.positionNode = stainPos;
  const atlasNode = texture(atlasTex);
  stainMat.colorNode = Fn(() => {
    const px = float(1 / 512);
    const m = atlasNode.sample(vUv);
    const hx = atlasNode.sample(vUv.add(vec2(px, 0))).g.sub(atlasNode.sample(vUv.sub(vec2(px, 0))).g);
    const hz = atlasNode.sample(vUv.add(vec2(0, px))).g.sub(atlasNode.sample(vUv.sub(vec2(0, px))).g);
    const kind = SB.w;
    const isPrint = step(1.5, kind);
    // the meniscus: the film's height gradient tilts the normal at the rim (thick pools steeper)
    const N = normalize(vec3(hx.mul(-3.5), 1, hz.mul(3.5)));
    const ageMin = uGameAge.add(uT.sub(SC.x).max(0).div(60));
    const edge = float(1).sub(m.g);
    const clot = clamp(ageMin.sub(3).div(7), 0, 1);
    const dry = clamp(ageMin.sub(10).div(20), 0, 1);
    const roughB = float(0.05).add(edge.mul(clot).mul(0.2)).add(dry.mul(0.3));
    // prints: water + a little blood on varnish, beaded (hash sparkle tilts the normal at the bead scale)
    const bead = vUv.mul(2048).floor();
    const hb = dot(bead, vec2(12.9898, 78.233)).sin().mul(43758.5453).fract();
    const Np = normalize(N.add(vec3(hb.sub(0.5).mul(0.25), 0, hb.mul(7.1).fract().sub(0.5).mul(0.25))));
    // a wet print is the boards darkened by a water film (wet wood ≈ 35 % darker) with a hint of blood: near-black
    // albedo at ≈ 0.38 opacity + the film's specular (r5/r6: a 0.03 albedo under the torch read as pink stickers)
    const albedo = mix(mix(vec3(...ALB_POOL), vec3(0.06, 0.016, 0.012), dry), vec3(0.006, 0.0025, 0.002), isPrint);
    const rough = mix(roughB, float(0.22), isPrint);
    const s = shade(vSP, mix(N, Np, isPrint), albedo, rough, float(0.022));
    // opacity: a thick film hides the boards (blood transmits only red through ≲ 1–2 mm); a print is a thin wet film
    // r7: dark squares around the prints on the torch-lit treads — whatever leaks into a cell's border (mip bleed of
    // the neighbour cell, filtering) is cut: a soft fade to 0 at the quad edge and a coverage floor
    const edgeQ = max(abs(vLoc.x), abs(vLoc.y));
    const cover = m.r.mul(SC.w).mul(float(1).sub(smoothstep(0.42, 0.5, edgeQ))).mul(smoothstep(0.06, 0.2, m.r));
    // r4: prints read as painted pink/white marks — a wet print is mostly darkened boards with a sparse glint
    const a = mix(cover.mul(mix(float(0.75), float(0.97), m.g)), cover.mul(0.38), isPrint).mul(smoothstep(SC.x, SC.x.add(0.04), uT));
    const ring = m.b.mul(dry).mul(0.5);
    return vec4(min(s.c.mul(float(1).sub(ring)), vec3(6)), a);
  })();
  const quad = new THREE.PlaneGeometry(1, 1);
  const stainMesh = new THREE.InstancedMesh(quad, stainMat, SMAX);
  stainMesh.name = 'blood-stains';
  stainMesh.frustumCulled = false;
  stainMesh.visible = false;
  stainMesh.renderOrder = 1;
  d.scene.add(stainMesh);

  // ---- C2's stains (from the landings) and the pools
  const CELL = { splat: [0, 1, 2, 3, 4, 5, 6, 7], streak: [8, 9, 10], pool: 11, print: [12, 13], puddle: 14, crown: 15 } as const;
  const r0 = rng(99);
  for (const s of stains) {
    const cells = s.shape === 'streak' ? CELL.streak : CELL.splat;
    addStain(s.p, s.yaw, Math.min(0.35, s.len), Math.min(0.2, s.wid), cells[Math.floor(r0() * cells.length)], 0, s.t, s.ml);
  }
  /** Pools (§3.7: 4 on Medium/Max, 2 on Low): centre, fed volume over time. */
  const pools: Array<{ i: number; ml: (t: number) => number }> = [];
  const addPool = (p: P3, ml: (t: number) => number) => {
    const i = addStain(p, r0() * 6.28, 0.01, 0.01, CELL.pool, 1, -1e6, 0);
    if (i >= 0) pools.push({ i, ml });
  };
  const sat = (x: number) => Math.max(0, Math.min(1, x));
  // under the neck: B03's drip + the first stroke (≈ 40 mL), fed by the stump down the table edge after the cut; it
  // spreads to the head (10 cm away) by ≈ 9.5 s and reaches ≈ 260 mL by 12 s, then the seep
  addPool([5.24, 3.24, 0.6], (t) => 40 + 220 * sat((t - 7.7) / 4.3) + Math.max(0, t - 12) * 0.6);
  // where pulses 1–2 land (x ≈ 4.3–4.7): the jets' summed volume as it lands
  addPool([4.42, 3.23, 0.6], (t) => 45 * sat((t - 7.98) / 0.7) + 15 * sat((t - 9.7) / 0.3));
  if (d.preset !== 'low') {
    // the sheet-corner drip (1 mL/s from 10.4)
    addPool([5.3, 2.2, 0.6], (t) => Math.max(0, Math.min(t, 40) - 10.6) * 1.0);
    // under the head at rest (the cut end bleeds 0.5 mL/s until it is lifted at 10.6)
    addPool([HEAD_REST[0] + 0.04, HEAD_REST[1] + 0.03, 0.6], (t) => 3 * sat((t - 9.7) / 0.9) + 2);
  }

  // ---- C2c: her wet prints (hall + treads 1–11), the puddle on tread 11, the drip onto tread 10
  const C2C0 = C2_DURATION; // C2c t = 0 on the blood clock
  const prints: Array<{ p: P3; yaw: number; t: number; left: boolean }> = [];
  {
    // the hall: from the parlor door to the stair foot (0–2.6 s), 0.55 m steps
    const path: P3[] = [[3.3, 1.75, 0.6], [2.3, 2.7, 0.6], [0.85, 3.35, 0.6]];
    let s = 0;
    let left = true;
    for (let k = 0; k < path.length - 1; k++) {
      const a = path[k];
      const b = path[k + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const h = Math.atan2(b[1] - a[1], b[0] - a[0]);
      for (; s < L; s += 0.55) {
        const f = s / L;
        const side = left ? 0.07 : -0.07;
        prints.push({ p: [a[0] + (b[0] - a[0]) * f - Math.sin(h) * side, a[1] + (b[1] - a[1]) * f + Math.cos(h) * side, 0.6], yaw: h, t: C2C0 + (k === 0 ? 1.2 * f : 1.2 + 1.4 * f), left });
        left = !left;
      }
      s -= L;
    }
    // the treads (her right hand on the rail: feet a little east of centre); the times follow her moves (§4.1)
    const tTread = (k: number) => (k <= 4 ? 4.5 + (k - 1) * 0.653 : k <= 9 ? 6.46 + ((k - 4) / 5) * 0.39 : k === 10 ? 8.4 : 8.9);
    for (let k = 1; k <= ADA_LAST_TREAD; k++) {
      const a = adaOnTread(k);
      const left2 = k % 2 === 1;
      prints.push({ p: [a[0] + (left2 ? 0.08 : -0.08), a[1] - 0.02, a[2]], yaw: Math.PI / 2, t: C2C0 + tTread(k), left: left2 });
    }
  }
  const printIdx: number[] = [];
  for (const pr of prints) {
    const i = addStain(pr.p, pr.yaw, 0.25, 0.1, pr.left ? CELL.print[0] : CELL.print[1], 2, pr.t, 2, 0.9);
    if (i >= 0) printIdx.push(i);
  }
  const t11 = treadNosing(ADA_LAST_TREAD);
  addStain([adaOnTread(ADA_LAST_TREAD)[0], t11[1] - 0.13, t11[2]], 1.3, 0.2, 0.15, CELL.puddle, 2, C2C0 + 8.95, 6, 1);
  const t10 = treadNosing(10);
  addStain([adaOnTread(10)[0], t10[1] - 0.04, t10[2]], 0.2, 0.06, 0.05, CELL.puddle, 1, C2C0 + 10.05, 1, 0.8);

  // ---- dynamic particles: the tread-11 drip (one drop every 0.6 s; slowing to one every 2 s by B05 + 60 s) + crowns
  let dynNext = parts.length;
  const spawn = (p: Particle) => {
    write(dynNext, p);
    bufA.needsUpdate = true;
    bufB.needsUpdate = true;
    bufC.needsUpdate = true;
    dynNext = dynNext + 1 >= N ? parts.length : dynNext + 1;
  };
  const dripFrom: P3 = [adaOnTread(ADA_LAST_TREAD)[0] + 0.05, t11[1] + 0.006, t11[2] - 0.004];
  let dripNext = C2C0 + 10.0;
  let dripOn = false;
  const dripCrown = (at: Particle, t: number) => {
    const rr = rng(Math.floor(t * 1000));
    for (let k = 0; k < (d.preset === 'low' ? 0 : 6); k++) {
      const a = rr() * 6.28;
      const sp = 0.4 + rr() * 0.6;
      const r = (0.3 + rr() * 0.5) / 1000;
      const p: Particle = { kind: 2, t0: at.tEnd, p0: [at.hit!.p[0], at.hit!.p[1], at.hit!.p[2] + 0.001], v0: [Math.cos(a) * sp * 0.6, Math.sin(a) * sp * 0.6, sp], r, tau: tauFor(r, sp), tEnd: 0, ml: 0, hit: null };
      spawn(terminate(p, [], at.hit!.p[2]));
    }
  };
  // the head's stream (S5–S8): 3–4 mm stream breaking into 6–7 mm drops ≈ every 0.11 s, from the cut end
  let headNext = 10.9;

  // ------------------------------------------------------------------------------------------------ runtime
  let clock = -100;
  let running = false;
  const tmp = new THREE.Vector3();
  const tmpQ = new THREE.Vector3();
  let torch: any = null;
  const findTorch = () => {
    if (torch) return torch;
    const rig = d.scene.getObjectByName?.('flashlight-rig');
    rig?.traverse?.((o: any) => {
      if (!torch && o.isSpotLight && o.name !== 'flashlight-bounce') torch = o;
    });
    return torch;
  };

  const syncLights = () => {
    const k = d.keyLight();
    if (k) {
      k.getWorldPosition(tmp);
      uKeyPos.value.copy(tmp);
      uKeyCol.value.copy(k.color);
      uKeyI.value = k.intensity;
    } else uKeyI.value = 0;
    const t = findTorch();
    if (t && t.intensity > 0) {
      t.getWorldPosition(tmp);
      uTorchPos.value.copy(tmp);
      t.target.getWorldPosition(tmpQ);
      uTorchDir.value.copy(tmpQ.sub(tmp).normalize());
      uTorchCol.value.copy(t.color);
      uTorchI.value = t.intensity;
      uTorchCos.value.set(Math.cos(t.angle), Math.cos(t.angle * (1 - (t.penumbra ?? 0.5))));
    } else uTorchI.value = 0;
  };

  const updatePools = () => {
    for (const p of pools) {
      const r = poolRadius(p.ml(clock));
      const on = r > 0.004;
      s2[p.i * 4] = on ? r * 2.1 : 0.0001;
      s2[p.i * 4 + 1] = on ? r * 2.0 : 0.0001;
      s3[p.i * 4] = on ? -1e6 : 1e9;
    }
    sb2.needsUpdate = true;
    sb3.needsUpdate = true;
  };

  const api = {
    /** `fx blood {seq: 'c2' | 'c2c', phase: 'start' | 'end'}` */
    fx(p: Record<string, number | string | boolean>): void {
      const seq = String(p.seq ?? 'c2');
      const phase = String(p.phase ?? 'start');
      if (seq === 'c2' && phase === 'start') {
        clock = 0;
        running = true;
        partMesh.visible = true;
        stainMesh.visible = true;
        headNext = 10.9;
      } else if (seq === 'c2' && phase === 'end') {
        clock = Math.max(clock, C2_DURATION);
        running = true;
        partMesh.visible = true;
        stainMesh.visible = true;
      } else if (seq === 'c2c' && phase === 'start') {
        clock = Math.max(clock, C2C0);
        dripOn = true;
        dripNext = C2C0 + 10.0;
      } else if (seq === 'c2c' && phase === 'end') {
        clock = Math.max(clock, C2C0 + 13.9);
        dripOn = true;
        partMesh.visible = true;
        stainMesh.visible = true;
        running = true;
      }
      uT.value = clock;
      updatePools();
    },
    /** Per frame with the game-loop dt (after the cutscene player). */
    update(dt: number): void {
      if (!running) return;
      clock += dt;
      uT.value = clock;
      syncLights();
      updatePools();
      // the tread-11 drip (C2c 10.0 →), slowing from every 0.6 s to every 2 s over the first minute of B05
      if (dripOn && clock >= dripNext) {
        const p: Particle = { kind: 1, t0: clock, p0: dripFrom, v0: [0, 0, -0.02], r: 0.002, tau: tauFor(0.002), tEnd: 0, ml: 0.03, hit: null };
        terminate(p, [], treadNosing(10)[2]);
        spawn(p);
        if (p.hit) dripCrown(p, clock);
        const since = clock - (C2C0 + 13.9);
        dripNext = clock + (since < 0 ? 0.6 : Math.min(2, 0.6 + (1.4 * since) / 60));
      }
      // the head's stream (when the head node exists): 10.9 – 22 s of C2
      if (d.headPos && clock >= headNext && clock < 22) {
        const hp = d.headPos();
        if (hp) {
          const pp: P3 = [hp.x, -hp.z, hp.y]; // WORLD → PLAN
          const p: Particle = { kind: 1, t0: clock, p0: pp, v0: [0, 0, -0.1], r: 0.0032, tau: tauFor(0.0032), tEnd: 0, ml: 0.17, hit: null };
          terminate(p);
          spawn(p);
        }
        headNext = clock + 0.11;
      }
      // the blood stays wet for minutes: the stains fade only by drying (age), never vanish
      uGameAge.value = 0;
      // B6: the TSL masks on Harlan / the cleaver / the gown (src/materials/blood.ts) share this clock
      BLOOD_UNIFORMS.amount.value = Math.max(0, Math.min(1, (clock - C2_CONTACT) / 3));
      BLOOD_UNIFORMS.ageMin.value = Math.max(0, clock - C2_CONTACT) / 60;
    },
    /** Load warm-up: make both meshes compile (B11). */
    setWarm(on: boolean): void {
      partMesh.visible = on || running;
      stainMesh.visible = on || running;
      if (on && !running) uT.value = C2_CONTACT + 0.3; // a back-lit jet in flight (the prewarm sees a real frame)
      if (!on && !running) uT.value = -100;
    },
    /** Hide everything (new game / debug start before C2). */
    reset(): void {
      running = false;
      dripOn = false;
      clock = -100;
      uT.value = clock;
      partMesh.visible = false;
      stainMesh.visible = false;
    },
    get clock() {
      return clock;
    },
    debug: () => ({ particles: parts.length, dyn: DYN, stains: sCount, pools: pools.length, prints: printIdx.length, clock: +clock.toFixed(3), tier: d.preset, keyI: +uKeyI.value.toFixed(3), torchI: +uTorchI.value.toFixed(1), torch: torch ? `${torch.name}|${torch.parent?.name}|vis ${torch.visible}` : null }),
    meshes: [partMesh, stainMesh],
  };
  stainMesh.userData.debug = () => api.debug(); // QA: scene.getObjectByName('blood-stains').userData.debug()
  return api;
}

export type BloodFx = ReturnType<typeof createBloodFx>;

// ------------------------------------------------------------------------------------------------ the stain atlas

/** 512² canvas, 4 × 4 cells: R = coverage, G = film thickness (meniscus), B = the dried "coffee ring". */
function paintAtlas(seed: number): HTMLCanvasElement {
  const S = 512;
  const C = 128;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  const r = rng(seed);
  const img = g.getImageData(0, 0, S, S);
  const px = img.data;
  const put = (cx: number, cy: number, fn: (x: number, y: number) => [number, number, number]) => {
    for (let y = 0; y < C; y++) {
      for (let x = 0; x < C; x++) {
        const u = (x + 0.5) / C - 0.5;
        const v = (y + 0.5) / C - 0.5;
        const [a, h, ring] = fn(u, v);
        const i = ((cy * C + y) * S + cx * C + x) * 4;
        px[i] = Math.max(px[i], Math.round(255 * Math.min(1, a)));
        px[i + 1] = Math.max(px[i + 1], Math.round(255 * Math.min(1, h)));
        px[i + 2] = Math.max(px[i + 2], Math.round(255 * Math.min(1, ring)));
        px[i + 3] = 255;
      }
    }
  };
  // an irregular blob: radius modulated by a few harmonics (+ a scalloped crown edge for splats)
  const blob = (rad: number, harm: number[], crown: number) => (u: number, v: number) => {
    const a = Math.atan2(v, u);
    let R = rad;
    harm.forEach((h, k) => (R *= 1 + h * Math.sin((k + 2) * a + k * 1.7)));
    R *= 1 + crown * Math.max(0, Math.sin(a * 14 + rad * 30)) ** 6;
    const d = Math.hypot(u, v) / R;
    const cover = 1 - smooth(0.92, 1.02, d);
    const height = Math.sqrt(Math.max(0, 1 - Math.min(1, d) ** 2)) ** 0.5; // a settled film: flat top, steep rim
    const ring = smooth(0.8, 0.95, d) * (1 - smooth(0.98, 1.05, d));
    return [cover, cover * height, ring] as [number, number, number];
  };
  const sats = (n: number, maxR: number) => {
    const list: Array<[number, number, number]> = [];
    for (let k = 0; k < n; k++) {
      const a = r() * 6.283;
      const d = 0.28 + r() * 0.18;
      list.push([Math.cos(a) * d, Math.sin(a) * d, 0.008 + r() * maxR]);
    }
    return (u: number, v: number): [number, number, number] => {
      let best: [number, number, number] = [0, 0, 0];
      for (const [x, y, rr] of list) {
        const dd = Math.hypot(u - x, v - y) / rr;
        if (dd < 1.05) {
          const c = 1 - smooth(0.85, 1.05, dd);
          if (c > best[0]) best = [c, c * 0.8, 0];
        }
      }
      return best;
    };
  };
  for (let i = 0; i < 8; i++) {
    const main = blob(0.2 + r() * 0.08, [r() * 0.12, r() * 0.08, r() * 0.06], i < 4 ? 0.12 : 0.04);
    const s = sats(4 + Math.floor(r() * 8), 0.02);
    put(i % 4, Math.floor(i / 4), (u, v) => {
      const a = main(u, v);
      const b = s(u, v);
      return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), a[2]];
    });
  }
  // streaks (8–10): a jet's line, thick at the landing end with a scalloped tail and satellites downrange
  for (let i = 8; i < 11; i++) {
    const wob = r() * 6;
    put(i % 4, Math.floor(i / 4), (u, v) => {
      const along = u + 0.5; // 0 tail … 1 head
      const w = 0.06 + 0.16 * along ** 1.5 + 0.015 * Math.sin(along * 40 + wob);
      const d = Math.abs(v) / w;
      const cover = (1 - smooth(0.85, 1.05, d)) * smooth(0.02, 0.1, along) * (1 - smooth(0.93, 0.99, along));
      return [cover, cover * (0.5 + 0.5 * along), 0];
    });
  }
  // pool (11): a near-round settled film with a lobed edge
  // r8: a smooth ellipse read as a painted disc — a settled pool creeps along the board seams and lobes out
  put(3, 2, (u, v) => {
    const a = blob(0.4, [0.12, 0.09, 0.07, 0.05], 0)(u, v);
    const lobe = blob(0.16, [0.2], 0)(u - 0.2, v + 0.17);
    const seam = Math.abs(v - 0.08) < 0.018 && Math.abs(u) < 0.46 ? 0.85 : 0; // wicked into a board seam
    return [Math.max(a[0], lobe[0], seam), Math.max(a[1], lobe[1] * 0.7, seam * 0.3), a[2]];
  });
  // prints (12, 13): a bare foot — heel, the outer edge, the ball, five toes (left; the right is mirrored)
  const foot = (mirror: number) => (u0: number, v0: number): [number, number, number] => {
    const u = u0; // along the foot (−0.5 heel … 0.5 toes)
    const v = v0 * mirror * 2.4; // across (the quad is 0.25 × 0.10 m)
    const e = (cx: number, cy: number, rx: number, ry: number) => Math.hypot((u - cx) / rx, (v - cy) / ry);
    const heel = e(-0.32, 0, 0.15, 0.55);
    const arch = e(-0.02, -0.38, 0.25, 0.28);
    const ball = e(0.22, 0.05, 0.13, 0.75);
    let d = Math.min(heel, arch, ball);
    const toes: Array<[number, number, number]> = [[0.41, 0.42, 0.075], [0.4, 0.08, 0.06], [0.37, -0.18, 0.055], [0.33, -0.4, 0.05], [0.28, -0.6, 0.045]];
    for (const [tx, ty, tr] of toes) d = Math.min(d, Math.hypot((u - tx) / tr, (v - ty) / (tr * 4.5)));
    const cover = (1 - smooth(0.8, 1.05, d)) * (0.75 + 0.25 * Math.sin(u * 60 + v * 23));
    return [cover, cover * 0.6, 0];
  };
  put(0, 3, foot(1));
  put(1, 3, foot(-1));
  // puddle (14) and a drop's crown (15)
  put(2, 3, blob(0.4, [0.15, 0.1, 0.08], 0.02));
  put(3, 3, (u, v) => {
    const b = blob(0.12, [0.05], 0.4)(u, v);
    const s = sats(9, 0.012)(u, v);
    return [Math.max(b[0], s[0]), Math.max(b[1], s[1]), 0];
  });
  g.putImageData(img, 0, 0);
  return cv;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
