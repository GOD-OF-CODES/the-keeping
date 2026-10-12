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
import { Fn, uniform, instancedBufferAttribute, positionGeometry, varyingProperty, vec2, vec3, vec4, float, exp, normalize, cross, dot, max, min, step, smoothstep, pow, sqrt, mix, abs, cameraPosition, texture, length, clamp, select, attribute, sin, cos, fwidth, atan, tanh, screenUV, viewportOpaqueMipTexture } from 'three/tsl';
import { planToWorld } from '../shared/coords.ts';
import { BLOOD_TIERS, ballistic, poolRadius, rng, seedC2, stainsOf, tauFor, terminate, type Particle, type Stain } from './blood-math.ts';
import { C2_CONTACT, C2_PULSES, C2_DURATION } from '../cutscenes/c2-room.ts';
import { HEAD_REST, HEAD_LAND, treadNosing } from '../cutscenes/stage.ts';
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
// review fix round 3 (#127): the boards' luminance albedo (floor_varnished avg 0.145/0.086/0.047) for the pools' key visibility
const FLOOR_RHO = (specById('floor_varnished')?.avgAlbedo as [number, number, number]) ?? [0.145, 0.086, 0.047];
const FLOOR_RHO_LUM = 0.2126 * FLOOR_RHO[0] + 0.7152 * FLOOR_RHO[1] + 0.0722 * FLOOR_RHO[2];

/** Fix round 2 (probe scratch/esc2/sweep2.mjs, Medium, C2 8.45, lane A build 1b): the body's cut cap centroid and the
 *  neck axis there (cap − the ring 7 cm below it): (−0.809, 0.052, +0.586) = bearing 176.3°, elevation +35.9° — the
 *  stump points west and UP off the table end, so the carotids fountain: pulse 1 (2.8 m/s) peaks 0.14 m above the cut
 *  and lands 1.3 m west at 0.63 s (x 4.2), pulse 4 (1.0 m/s) at x 5.07 (scratch/esc2/land.ts). Stage NECK sits 17 cm
 *  west of the real cut: the jets used to start in mid-air. */
// fix round 3 (#124, lane A build 3: the cut 25 mm further up the neck, tilted 20°): re-probed at C2 8.45 on the posed
// body (scripts/qa/c2-look.mjs CAP=1, 800 cap verts): cap centroid plan (5.484, 3.307, 1.446), neck axis (cap − the ring
// 6–8 cm below) bearing 175.0°, elevation +4.8° — the stump now lies near-level along the table end, so the carotids
// throw west almost horizontally from 0.85 m: pulse 1 (2.8 m/s) lands ≈ 1.1 m west in ≈ 0.42 s.
export const JET_CUT: P3 = [5.484, 3.307, 1.446];
export const JET_AZ = (175.0 * Math.PI) / 180;
// review fix round 3 (#127): the ring axis is +4.8° at 6–8 cm but +30.5° at 10–12 cm (the posed neck curves ≈ 25° over
// its last 10 cm, LOOK gl1); a cut carotid retracts ≈ 1.5–2.5 cm into the stump, so its lumen — the jet's direction — lies
// on the deeper, steeper axis: 18° (mid-range). At 4.8° the jets ran level at the cleaver's height into Harlan's hands
// and were hidden from the strike camera D at 7.75–8.2.
// fix round 4 LOOK (ruling v; r1-01 at 7.75 under the restaged key: the stream is a 1 px level line hidden along the
// cleaver/forearm band): 28° — inside the measured chord (4.8° at 6–8 cm … 30.5° at 10–12 cm; ≤ 30° by ruling v): a
// cut carotid retracts ≈ 2 cm into the stump, so the lumen's axis is the deeper, steeper one. Pulse 1 (2.8 m/s) now
// arcs ≈ 8 cm higher (v²sin²θ/2g = 0.09 m vs 0.04 m) and clears the arm band from D.
export const JET_EL = (28 * Math.PI) / 180;

export interface BloodDeps {
  scene: any;
  /** the session's one shadow light (lamp / roaming stroke) */
  keyLight: () => any | null;
  preset: 'low' | 'medium' | 'max';
  /** the severed head's world position (its cut end), when the head node exists */
  headPos?: () => any | null;
  /** the severed head's centre (world), for its soft shadow on its own pool */
  headCenter?: () => any | null;
}

export function createBloodFx(d: BloodDeps) {
  const tier = BLOOD_TIERS[d.preset];
  // ---- the C2 seed (deterministic; terminations precomputed)
  const parts: Particle[] = seedC2({
    neck: JET_CUT,
    jetAz: JET_AZ,
    jetEl: JET_EL,
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
    // fix round 3 LOOK: a jet element becomes ONE Rayleigh–Plateau drop past its break time — its radius from its own
    // volume (pulse 1 on Medium: 25 mL / 55 elements / 2 jets = 0.23 mL → r 3.8 mm; RP predicts d ≈ 1.89·2a ≈ 9.5 mm)
    const r = p.kind === 0 ? Math.min(0.0048, Math.max(0.0015, Math.cbrt((3 * p.ml * 1e-6) / (4 * Math.PI)))) : p.r;
    aC.set([r, p.tau, p.kind, (i * 0.618) % 1], i * 4);
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
  // escape fix round (lane CINE): the severed head occludes the lamp on its own pool (a sphere, r 0.09 m; y −100 = none)
  const uReflK = uniform(1); // debug A/B (__bloodFx.uReflK)
  const uStainDbg = uniform(0); // debug A/B (__bloodFx.uStainDbg)
  const uPoolV2 = uniform(1); // M-A C2 upgrades (pools: seams, satellites, thickness tone); debug A/B (__bloodFx.uPoolV2 = 0 → fix round 4)
  const uHeadOcc = uniform(new THREE.Vector4(0, -100, 0, 0.09));
  /** Soft sphere shadow of the head on the key light at P (1 = lit). */
  const headShadow = (P: any) => {
    const Ld = normalize(uKeyPos.sub(P));
    const oc = uHeadOcc.xyz.sub(P);
    const tca = dot(oc, Ld);
    const dd = sqrt(max(dot(oc, oc).sub(tca.mul(tca)), 0));
    return mix(float(1), smoothstep(uHeadOcc.w.mul(0.55), uHeadOcc.w.mul(1.5), dd), step(0, tca));
  };

  // fix round 3 LOOK (the C2c stair prints glowing pink under a lamp two walls away): the analytic shading has no shadow
  // map, so the parlor lamp lit every stain in the house. The walls are the occluder that matters: the key light only
  // reaches stains in its own room box (the parlor G2: world x 3.75–8.75, z −6…0, below the 3.8 m ceiling) — a stain
  // and the light on the same side of that box (the lamp inside, a lightning stroke outside) keep it.
  const inParlor = (P: any) => step(3.75, P.x).mul(step(P.x, 8.75)).mul(step(-6, P.z)).mul(step(P.z, 0)).mul(step(P.y, 3.8));
  const sameRoom = (P: any) => float(1).sub(abs(inParlor(P).sub(inParlor(uKeyPos))));
  // fix round 4 LOOK (ruling v; R3 review: 'a jet inside Harlan's shadow renders as a lamp-lit red laser line'): the
  // particles and the stream take the key light's REAL shadow-map visibility — the light's own shadow node (lights.ts
  // userData.shadowVis: one cube map, no extra pass; gated/muted exactly like every lit surface), sampled at the
  // particle's world position (material.receivedShadowPositionNode). 1 = lit; no shadow light → 1.
  const visNode = d.keyLight()?.userData?.shadowVis ?? null;
  const keyVis = () => (visNode ? vec3(visNode).x : float(1));
  const A = instancedBufferAttribute(bufA);
  const B = instancedBufferAttribute(bufB);
  const C = instancedBufferAttribute(bufC);
  const vNormal = varyingProperty('vec3', 'vBloodN');
  const vPos = varyingProperty('vec3', 'vBloodP');
  const vRad = varyingProperty('float', 'vBloodR');
  const vKind = varyingProperty('float', 'vBloodK');
  const vAlpha = varyingProperty('float', 'vBloodA');

  const position = Fn(() => {
    const t = uT.sub(A.w);
    const life = B.w.sub(A.w);
    // fix round 2: the jet beads (kind 0) were retired for the continuous stream tube; fix round 3: they are the DROPS
    // the ligament breaks into — alive only past their break time (0.075–0.12 s, the tube's tBr band)
    const tBrk = C.w.mul(0.045).add(0.075);
    const alive = step(0, t).mul(step(t, life)).mul(max(step(0.5, C.z), step(tBrk, t)));
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
    // fix round 3 LOOK: film motion blur — a drop crossing its own length many times inside the exposure leaves a faint
    // streak, not an opaque red rod: coverage ≈ its diameter over the streak length (energy kept)
    vAlpha.assign(clamp(r.div(r.add(half)), 0.12, 1));
    return mix(p, wp, alive).mul(alive); // dead/unborn: collapsed at the origin (degenerate, nothing drawn)
  })();

  /** GGX specular × N·L (height-correlated Smith), Schlick F. */
  // escape fix round (lane CINE): sphere-light normalisation (Karis 2013, "Real Shading in UE4"): a real source has a
  // size — α' = α + r/(2d), energy × (α/α')². Without it a 0.05-rough film under a POINT lamp saturated far beyond the
  // flame's image (peak D ≈ 5·10⁴): the jet-landing pool, at the lamp's mirror point from D, clipped to a cream disc.
  // srcK = source radius (m): the flat-wick flame ≈ 0.012 m, the torch's 2-D-cell reflector ≈ 0.025 m.
  const ggx = (N: any, V: any, L: any, rough: any, f0: any, srcR: any = float(0), dist: any = float(1)) => {
    const H = normalize(V.add(L));
    const nl = max(dot(N, L), 0);
    const nv = max(dot(N, V), 1e-3);
    const nh = max(dot(N, H), 0);
    const vh = max(dot(V, H), 0);
    const a0 = rough.mul(rough).max(1e-4);
    const a = min(a0.add(srcR.div(dist.mul(2))), float(1));
    const a2 = a.mul(a);
    const norm = a0.div(a).mul(a0.div(a));
    const dd = nh.mul(nh).mul(a2.sub(1)).add(1);
    const D = a2.div(dd.mul(dd).mul(Math.PI)).mul(norm);
    const vis = float(0.5).div(nl.mul(sqrt(nv.mul(nv).mul(float(1).sub(a2)).add(a2))).add(nv.mul(sqrt(nl.mul(nl).mul(float(1).sub(a2)).add(a2)))).max(1e-4));
    // fix round (the PRINTS' DARK SQUARES, found by A/B: alpha-0 → gone, magenta colour → clean feet): for the torch
    // L ≈ V (the light is at the eye), so v·h rounds to 1 + ε, the Schlick base goes negative and WGSL pow(neg, 5) is
    // NaN; NaN × alpha 0 is still NaN in the blend → a black quad (and min(NaN, 6) → the pale "foot images"). Every
    // pow base is clamped to [0, 1].
    const F = f0.add(float(1).sub(f0).mul(pow(clamp(float(1).sub(vh), 0, 1), 5)));
    return D.mul(vis).mul(F).mul(nl);
  };

  /** Lambert + GGX from the key light and the torch at P with normal N (radiance, linear). */
  const shade = (P: any, N: any, albedo: any, rough: any, f0: any, kOcc: any = float(1)) => {
    const V = normalize(cameraPosition.sub(P));
    const Lk = uKeyPos.sub(P);
    const dk2 = dot(Lk, Lk).max(1e-4);
    const lk = Lk.div(sqrt(dk2));
    const Ek = uKeyCol.mul(uKeyI.div(dk2)).mul(kOcc);
    const Lt = uTorchPos.sub(P);
    const dt2 = dot(Lt, Lt).max(1e-4);
    const lt = Lt.div(sqrt(dt2));
    const cone = smoothstep(uTorchCos.x, uTorchCos.y, dot(lt.negate(), uTorchDir));
    const Et = uTorchCol.mul(uTorchI.mul(cone).div(dt2));
    const diff = albedo.mul(1 / Math.PI);
    // fix round r3 (st8 diag: the 9.9 cream disc = the jet-landing pool at the lamp's mirror point; even Karis-normalised
    // GGX at α 0.05 leaves a tail ≈ 30× over white across the whole 17 cm pool): a fresh liquid film is a MIRROR. The
    // lamp's specular is the flame's IMAGE — radiance F·L_flame (flat-wick flame r ≈ 1.2 cm: L = I / (π r²) ≈ 26 kcd/m²
    // for 12 cd) only where the reflected ray passes within r of the flame (widened by the film's roughness, energy kept)
    const Rk = V.negate().reflect(N);
    const tk = dot(Lk, Rk);
    const dRay = length(Lk.sub(Rk.mul(tk.max(0))));
    const rF = float(0.012);
    // review fix round 2 (the jets read as neon wires): a glossy cylinder mirrors a point flame as ONE line along its
    // axis, physically ≈ R·(r_flame/d)/2 ≈ 0.02 mm wide on a 2 mm stream — far below a pixel. Shading one normal per
    // pixel lit whole pixels at the flame's full 26 kcd/m² → a clipped continuous line. The pixel's footprint spans a
    // range of normals (fwidth N; the reflected ray turns 2× as fast): widen the flame's image cone by it, energy kept
    // ((rF/wF)² below) → the highlight's true sub-pixel energy (specular anti-aliasing, Kaplanyan & Hoffman 2016).
    const wF = rF.add(rough.mul(rough).mul(2).mul(tk.max(0))).add(length(fwidth(N)).mul(2).mul(tk.max(0)));
    const covF = float(1).sub(smoothstep(wF.mul(0.6), wF, dRay)).mul(step(0, tk)).mul(step(0, dot(N, lk)));
    const nvK = max(dot(N, V), 0);
    const FK = f0.add(float(1).sub(f0).mul(pow(clamp(float(1).sub(nvK), 0, 1), 5)));
    const flameImg = uKeyCol.mul(uKeyI.div(rF.mul(rF).mul(Math.PI))).mul(rF.div(wF).pow(2)).mul(FK).mul(covF).mul(kOcc);
    const ck = Ek.mul(diff.mul(max(dot(N, lk), 0))).add(flameImg);
    const tSpec = Et.mul(ggx(N, V, lt, rough, f0, float(0.025), sqrt(dt2)));
    const ct = Et.mul(diff.mul(max(dot(N, lt), 0))).add(tSpec);
    // review fix round 3 (#127): the specular pieces separately (the floor-stain path takes its diffuse from the boards)
    return { c: ck.add(ct).add(albedo.mul(uAmbient)), V, Ek, lk, Et, lt, flame: flameImg, tSpec };
  };

  const partMat = new THREE.MeshBasicNodeMaterial();
  partMat.name = 'blood-particles';
  partMat.positionNode = position;
  partMat.transparent = true; // fix round 3: motion-blurred drops (vAlpha)
  partMat.depthWrite = false;
  partMat.receivedShadowPositionNode = vPos; // the key's shadow map at the drop (fix round 4)
  partMat.colorNode = Fn(() => {
    const N = normalize(vNormal);
    const jet = step(vKind, 0.5);
    const albedo = mix(vec3(...ALB_POOL), vec3(...ALB_JET), jet);
    // R3 (#127): outside the parlor the key is the roaming lightning light (unshadowed here) — drops there take the torch only
    const s = shade(vPos, N, albedo, float(0.12), float(0.022), sameRoom(vPos).mul(inParlor(vPos)).mul(keyVis()));
    // the back-lit term: chord d (mm) through the drop at this pixel, Beer–Lambert per channel, Henyey–Greenstein
    const nv = max(dot(N, s.V), 0.05);
    const dmm = vRad.mul(2000).mul(nv);
    const muA = mix(vec3(...MUA_POOL), vec3(...MUA_JET), jet);
    const T = exp(muA.mul(dmm).negate());
    const cosT = dot(s.lk.negate(), s.V); // lamp → particle vs particle → eye: 1 = looking into the light through it
    const g = 0.95;
    const pHG = float((1 - g * g) / (4 * Math.PI)).div(pow(max(float(1 + g * g).sub(cosT.mul(2 * g)), float((1 - g) * (1 - g))), 1.5));
    const F = float(0.022).add(float(0.978).mul(pow(clamp(float(1).sub(nv), 0, 1), 5)));
    const back = s.Ek.mul(T).mul(pHG).mul(float(1).sub(F));
    return vec4(s.c.add(back), vAlpha);
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

  // ------------------------------------------------------------------------------------------------ the arterial jets
  // Fix round 2 (ruling h): the two carotid jets are CONTINUOUS STREAMS — a tube per jet whose vertices are fluid
  // elements indexed by their age a (0 at the cut → JAGE), evaluated in the vertex stage on the blood clock: an element
  // emitted at τ = t − a left the cut at the pulse speed of τ and flew the same linear-drag ballistic as the particles.
  // Physics (stated): systolic ≈ 120 mmHg = 16 kPa over a fully transected common carotid (Ø 6–7 mm) gives the
  // Bernoulli bound v = √(2ΔP/ρ) ≈ 5.5 m/s; with the cut's losses the field figure is 2.5–4 m/s → C2_PULSES 2.8 → 1.0
  // m/s (the heart failing, beats 0.82 → 1.05 s apart). Flow → cross-section: pulse 1 = 25 mL / 0.22 s = 114 mL/s over
  // two jets at 2.8 m/s → A = Q/v = 20 mm² each → r ≈ 2.5 mm (r = √(Q·env / (2π·v)) per element). Between beats the
  // diastolic pressure (≈ 60 → 0 mmHg as she exsanguinates) keeps a dribble: ≈ 10 mL/s at 0.45 m/s decaying τ 2.5 s,
  // which sags over the table edge (the run-off sheet). Breakup: Weber's laminar breakup length L/d = 12(√We + 3We/Re)
  // (We = ρv²d/σ ≈ 900, Re ≈ 5000 at μ 3.5 mPa·s) is metres, so the stream stays coherent over its ≈ 1 m arc to the
  // boards; each pulse front is a slug (faster fluid catching slower). The jet beads (particle kind 0) are retired;
  // the mist and the drops stay particles, the jet LANDINGS stay stains. Draws +1 (child of the particle mesh).
  const JSEG = d.preset === 'low' ? 32 : 96;
  const JRING = d.preset === 'low' ? 5 : 8;
  const JAGE = 0.7; // s: the oldest element drawn (pulse 1's flight to the boards is 0.63 s)
  {
    const nv = 2 * (JSEG + 1) * JRING;
    const jt = new Float32Array(nv * 3);
    const idx: number[] = [];
    let o = 0;
    for (const side of [-1, 1]) {
      const base = o;
      for (let i = 0; i <= JSEG; i++) for (let k = 0; k < JRING; k++) { jt.set([i / JSEG, (k / JRING) * Math.PI * 2, side], o * 3); o++; }
      for (let i = 0; i < JSEG; i++)
        for (let k = 0; k < JRING; k++) {
          const a = base + i * JRING + k, b = base + i * JRING + ((k + 1) % JRING), c = a + JRING, e = b + JRING;
          idx.push(a, c, b, b, c, e);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
    g.setAttribute('jtube', new THREE.BufferAttribute(jt, 3));
    g.setIndex(idx);
    const J = attribute('jtube', 'vec3');
    const vJN = varyingProperty('vec3', 'vJetN');
    const vJP = varyingProperty('vec3', 'vJetP');
    const vJR = varyingProperty('float', 'vJetR');
    const tauJ = tauFor(0.0025, 2.5);
    const pulses = C2_PULSES.slice(0, 4);
    const jetPos = Fn(() => {
      const age = J.x.mul(J.x).mul(JAGE); // fix round 3: x² spacing — ≈ 3 ms segments over the coherent first 0.12 s
      const te = uT.sub(age); // emission time of this element
      let sp: any = float(0);
      let el: any = float(0);
      let rr: any = float(0);
      pulses.forEach((pu, k) => {
        const u = te.sub(pu.t);
        const inside = step(0, u).mul(step(u, pu.d));
        const env = clamp(min(u.div(0.04), float(pu.d).sub(u).div(0.08)), 0, 1).mul(inside);
        const v = env.mul(0.45).add(0.55).mul(pu.v).mul(inside);
        const q = (pu.ml * 1e-6) / pu.d; // m³/s, both jets
        sp = sp.add(v);
        el = el.add(inside.mul(JET_EL - (k * 3.5 * Math.PI) / 180));
        rr = rr.add(sqrt(env.mul(q / (2 * Math.PI)).div(v.max(0.05))).mul(inside));
      });
      // the diastolic dribble between the beats
      const tb = te.sub(C2_CONTACT);
      const onB = step(0, tb).mul(step(tb, 14));
      const fb = exp(tb.max(0).div(-2.5)).mul(onB);
      const vb = fb.mul(0.45);
      const rb = sqrt(fb.mul(5e-6 / Math.PI).div(vb.max(0.05))).mul(onB);
      const pulse = step(rb, rr);
      sp = mix(vb, sp, pulse).max(1e-3).mul(J.z.mul(0.06).add(1));
      el = mix(float(Math.min(JET_EL, (-38 * Math.PI) / 180)), el, pulse).add(J.z.mul((3 * Math.PI) / 180));
      const born = step(C2_CONTACT, te).mul(step(age, uT.sub(C2_CONTACT)));
      // fix round 3 LOOK (m6max-01: the jets = two constant-radius glowing arcs): a torn carotid is not a quiet nozzle —
      // the pulsing, ragged exit seeds disturbances δ0/a ≈ 0.1–0.3, so Rayleigh–Plateau break-up governs, not Weber's
      // quiet-nozzle length. Jet a ≈ 2.5 mm, ρ 1060 kg/m³, σ 0.058 N/m: capillary time √(ρa³/σ) = 17 ms, max growth rate
      // 0.34/17 ms → e-folding τ ≈ 50 ms; pinch-off after ln(a/δ0) ≈ 1.2–2.3 τ ≈ 60–120 ms (≈ 15–30 cm at 2.5 m/s); the
      // fastest wavelength λ = 9.02 a ≈ 23 mm → drops of d ≈ 1.89 × 2a ≈ 9.5 mm (the beads below, alive past their own
      // break time). The tube is the coherent ligament only: varicose from the cut (growing e^(age/τ)), pinched to 0 by
      // tBr; the drops carry on as particles (kind 0).
      const ph = J.z.mul(1.7);
      const sAl = age.mul(sp); // m along the stream
      const tBr = float(0.095).add(sin(te.mul(2 * Math.PI * 3.1).add(ph)).mul(0.025));
      const grow = min(exp(age.div(0.05)).mul(0.04), float(0.6));
      const vari = float(1).add(sin(sAl.mul(2 * Math.PI / 0.023).add(ph)).mul(grow));
      const brk = float(1).sub(smoothstep(tBr.sub(0.02), tBr, age));
      const rad = mix(rb, rr.mul(vari).mul(brk), pulse).mul(born);
      const az = J.z.mul((6 * Math.PI) / 180).add(JET_AZ).add(sin(te.mul(2 * Math.PI * 9)).mul((4 * Math.PI) / 180));
      // PLAN direction → WORLD (x, z, −y)
      const dirW = vec3(cos(az).mul(cos(el)), sin(el), sin(az).mul(cos(el)).negate());
      const v0 = dirW.mul(sp);
      // the two lumens ±2.2 cm across the axis (PLAN (−sin az, cos az)) → WORLD (x, z, −y)
      const p0 = vec3(J.z.mul(-Math.sin(JET_AZ) * 0.022).add(JET_CUT[0]), JET_CUT[2] - 0.01, J.z.mul(Math.cos(JET_AZ) * 0.022).add(JET_CUT[1]).negate());
      const e = exp(age.negate().div(tauJ));
      const kk = float(tauJ).mul(float(1).sub(e));
      const vtY = -9.81 * tauJ;
      const pc = p0.add(v0.mul(kk)).add(vec3(0, age.mul(vtY).sub(kk.mul(vtY)), 0));
      const vel = v0.mul(e).add(vec3(0, float(vtY).mul(float(1).sub(e)), 0));
      const uu = normalize(vel.add(vec3(1e-5, 0, 0)));
      const ref = select(abs(uu.y).greaterThan(0.9), vec3(1, 0, 0), vec3(0, 1, 0));
      const ax = normalize(cross(uu, ref));
      const bx = cross(uu, ax);
      const n = ax.mul(cos(J.y)).add(bx.mul(sin(J.y)));
      // the boards: the stream spreads flat where it lands (clamped onto the floor + 1 mm)
      const wp = pc.add(n.mul(rad));
      const floorY = float(0.6 + 0.001);
      const wpc = vec3(wp.x, max(wp.y, floorY), wp.z);
      vJN.assign(n);
      vJP.assign(wpc);
      vJR.assign(rad);
      return wpc;
    })();
    const jetMat = new THREE.MeshBasicNodeMaterial();
    jetMat.name = 'blood-jets';
    jetMat.positionNode = jetPos;
    jetMat.receivedShadowPositionNode = vJP; // fix round 4: the key's shadow map along the stream
    jetMat.colorNode = Fn(() => {
      const N = normalize(vJN);
      const s0 = shade(vJP, N, vec3(...ALB_JET), float(0.06), float(0.022), keyVis());
      const nv = max(dot(N, s0.V), 0.05);
      const dmm = vJR.mul(2000).mul(nv);
      // review fix round 2 (the jets read as glowing red neon wires at 7.75): whole blood is not a clear absorber — red
      // cells scatter (μs ≈ 50–80 /mm, g ≈ 0.98 → μs' ≈ 1.5 /mm), so nothing goes BALLISTICALLY through a 3–4 mm stream;
      // the light that gets through is diffuse: T ≈ exp(−μeff·d), μeff = √(3 μa (μa + μs')) (diffusion theory), radiance
      // ≈ E·T/π (no forward HG peak). A thick stream is a near-black glossy rod with a deep-red glow only at its thin edges.
      const muEff = sqrt(vec3(...MUA_JET).mul(vec3(...MUA_JET).add(1.5)).mul(3));
      const T = exp(muEff.mul(dmm).negate());
      const F = float(0.022).add(float(0.978).mul(pow(clamp(float(1).sub(nv), 0, 1), 5)));
      // fix round 3 LOOK: diffuse transmission leaves the stream on its FAR side from the lamp only (the old term lit
      // every silhouette edge whatever the light direction → a glowing rim on both sides = the neon outline)
      const back = max(dot(N, s0.lk.negate()), 0);
      return vec4(s0.c.add(s0.Ek.mul(T).mul(back).mul(1 / Math.PI).mul(float(1).sub(F))), 1);
    })();
    const jetMesh = new THREE.Mesh(g, jetMat);
    jetMesh.name = 'blood-jets';
    jetMesh.frustumCulled = false;
    jetMesh.castShadow = false;
    jetMesh.receiveShadow = false;
    jetMesh.renderOrder = 2;
    partMesh.add(jetMesh);
  }

  // ------------------------------------------------------------------------------------------------ the stain atlas
  const atlas = paintAtlas(1234);
  const atlasTex = new THREE.CanvasTexture(atlas);
  atlasTex.colorSpace = THREE.NoColorSpace;
  // escape fix round (lane CINE, item 2): NO mip chain. The "dark squares" under the prints were mip bleed: at the
  // treads' grazing angle the sampler picks mip ≥ 5, where one texel averages a whole 128 px cell (a foot's mean
  // coverage ≈ 0.3 passes the coverage floor) → a uniformly tinted QUAD. Level 0 only: each texel is its own cell's.
  atlasTex.generateMipmaps = false;
  atlasTex.minFilter = THREE.LinearFilter;
  atlasTex.magFilter = THREE.LinearFilter;
  atlasTex.anisotropy = 1;

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
    // fix round 2 (look 1: a stippled pool rim): the meniscus normal came from ±1 texel of an 8-bit height → quantised
    // steps = speckle. ±2.5 texels (a wider, smoother rim gradient) and half the gain
    const px = float(2.5 / 512);
    const m = atlasNode.sample(vUv);
    const hx = atlasNode.sample(vUv.add(vec2(px, 0))).g.sub(atlasNode.sample(vUv.sub(vec2(px, 0))).g);
    const hz = atlasNode.sample(vUv.add(vec2(0, px))).g.sub(atlasNode.sample(vUv.sub(vec2(0, px))).g);
    const kind = SB.w;
    const isPrint = step(1.5, kind);
    // the meniscus: the film's height gradient tilts the normal at the rim (thick pools steeper)
    // review fix round 2 (zoom of the E4 pool: the rim is a 12 px band of pink lit bumps): the meniscus of blood on
    // varnish is ≈ 1–2 mm wide (≈ 1–2 px at 1.4 m), but the atlas ramp spans ≈ 3 texels (≈ 1.5 cm) and the gain 1.4
    // tilted it ≈ 55° toward the lamp → a broad lit band with 8-bit quantisation bumps. Gain 1.4 → 0.45 (≤ 25°).
    const Na = normalize(vec3(hx.mul(-0.45), 1, hz.mul(0.45)));
    // fix round 3 LOOK (m6max-03: the pool = a perfect circle with a fuzzy dotted rim — one 128 px atlas cell magnified
    // ≈ 4×): POOLS are analytic. Edge r(θ) = R·(1 + Σ a_k cos(kθ + φ_k)) — a viscous front creeping along the boards
    // (7 seeded harmonics, a ∝ k^−1.3, + a 1.2× stretch along the quad's long axis) — and a signed distance d (m, + inside)
    // anti-aliased over one pixel (fwidth). The meniscus is the capillary profile h = h0·tanh(d/lc), lc = √(σ/ρg) =
    // √(0.058 / (1060·9.81)) = 2.4 mm (whole blood σ ≈ 58 mN/m), h0 = 2.75 mm (the settled film, blood-math): the tilt
    // lives in the outer ≈ 2–3 mm only (≈ 2 px at 1.4 m) — a thin bright lip where it faces the flame, not a band.
    const isPool = step(0.5, kind).mul(step(kind, 1.5));
    const pl = vec2(vLoc.x.mul(SB.x), vLoc.y.mul(SB.y)); // metres in the quad frame
    const rq = length(pl).max(1e-5);
    const th = atan(pl.y, pl.x.mul(0.83));
    let hsum: any = float(0);
    [0.12, 0.08, 0.055, 0.041, 0.035, 0.03, 0.026].forEach((a, i) => {
      const k = i + 2;
      hsum = hsum.add(cos(th.mul(k).add(SC.z.mul(6.283 * (k * 1.618 + 0.37)).fract().mul(6.283))).mul(a));
    });
    const Rp = SB.y.mul(0.9 / 3.8).mul(float(1).add(hsum)); // pools: SB = 3.8·r (updatePools) → mean edge 0.9 r (the 1.2× stretch keeps the area)
    const Rdir = float(1).div(length(vec2(cos(th).mul(0.83), sin(th))).max(0.5)); // the 1.2× stretch along x
    const dP = Rp.mul(Rdir).sub(rq).mul(mix(float(0.55), float(1), smoothstep(SC.x, SC.x.add(0.25), uT))); // grows with the quad
    const lc = 0.0024;
    const hP = tanh(clamp(dP.div(lc), 0, 8)); // 0 at the contact line → 1 in the flat film (clamped: tanh(≫ 40) is inf/inf = NaN on WGSL/GLSL)
    const slope = float(1).sub(hP.mul(hP)).mul(2.75 / 2.4).mul(step(0, dP)); // dh/dd = h0/lc · sech²
    const cy = SA.w.cos();
    const sy = SA.w.sin();
    const rl = pl.div(rq); // outward, quad frame → world (x' = lx·c + lz·s, z' = −lx·s + lz·c)
    const outW = vec3(rl.x.mul(cy).add(rl.y.mul(sy)), 0, rl.x.mul(sy).negate().add(rl.y.mul(cy)));
    const Npool = normalize(vec3(0, 1, 0).add(outW.mul(slope)));
    const wP = max(fwidth(dP), float(1e-4));
    const coverP0 = smoothstep(wP.negate(), wP, dP);
    // M-A C2 upgrades (ruling z5 item 3, the AD's 'flat matte red felt lobes'): a fresh pool on varnished boards
    // (a) RUNS ALONG THE BOARD SEAMS — the 2.8 mm gaps (floor_varnished, boards() gapM) wick the blood ahead of the front
    // by capillarity. The seams are read from the boards themselves: the opaque frame under the pool at full resolution
    // vs its 8 px average (mip 3) — a seam is ≥ 35 % darker than its neighbourhood — so the runs follow the real seams,
    // their real direction, with no knowledge of the floor's UVs. A run reaches ≤ 0.55 R past the mean front (hashed by
    // bearing: some seams take a long tongue, most a short one) and is a THIN film (tone below).
    const lum = (c: any) => dot(c, vec3(0.2126, 0.7152, 0.0722));
    const b0 = lum(viewportOpaqueMipTexture(screenUV).level(float(0)).rgb);
    const b3 = lum(viewportOpaqueMipTexture(screenUV).level(float(3)).rgb);
    // (ab3 seam map: the hair on the boards, Harlan's shadow and the defocused dark areas also passed the test →)
    // only on LIT BOARDS: the 8 px mean must be ≥ ~40 % of the unshadowed lamp-lit floor exitance (ρ_floor/π·E)
    const lkS = uKeyPos.sub(vSP);
    const d2S = dot(lkS, lkS).max(1e-4);
    const expS = dot(vec3(uKeyCol), vec3(0.2126, 0.7152, 0.0722)).mul(uKeyI).div(d2S).mul(max(lkS.y.div(sqrt(d2S)), 0)).mul(FLOOR_RHO_LUM / Math.PI);
    const litBoards = smoothstep(0.25, 0.5, b3.div(expS.max(1e-6)));
    const seam = smoothstep(0.8, 0.6, b0.div(b3.max(1e-6))).mul(step(1e-5, b3)).mul(litBoards);
    const Rm = SB.y.mul(0.9 / 3.8);
    const bearingH = th.mul(5).floor().add(SC.z.mul(17)).sin().mul(43758.5453).fract(); // 5 bearing sectors per radian
    const runLen = Rm.mul(mix(float(0.2), float(0.8), bearingH.mul(bearingH)));
    const dOut = dP.negate();
    const run = smoothstep(0.25, 0.6, seam).mul(float(1).sub(smoothstep(runLen.mul(0.6), runLen, dOut))).mul(step(0, dOut));
    // (b) SATELLITE DROPS: the jet / the head's landing threw 2–7 mm drops ahead of the front (1.1–1.6 R; 7 per pool)
    let sat: any = float(0);
    for (let k = 0; k < 7; k++) {
      const hk = SC.z.mul(91.7 + k * 13.1).add(k * 0.613).sin().mul(43758.5453).fract();
      const hk2 = SC.z.mul(57.3 + k * 7.7).add(k * 1.37).sin().mul(24634.6345).fract();
      const ang = hk.mul(6.283);
      const ck = vec2(cos(ang), sin(ang)).mul(Rm.mul(float(1.1).add(hk2.mul(0.5))));
      const rk = float(0.002).add(hk2.mul(hk).mul(0.005));
      const dk = rk.sub(length(pl.sub(ck)));
      sat = max(sat, smoothstep(wP.negate(), wP, dk));
    }
    // fine wetting-line irregularity (k 11–23): the front pins on the varnish's grain, it is never a smooth lobe
    const fineE = cos(th.mul(13).add(SC.z.mul(40))).mul(0.5).add(cos(th.mul(23).add(SC.z.mul(71))).mul(0.3)).mul(0.0018);
    const coverV2 = max(max(smoothstep(wP.negate(), wP, dP.add(fineE)), run.mul(0.92)), sat);
    const coverP = mix(coverP0, coverV2, uPoolV2);
    // M-A (d) FROTH: arterial blood that fell as a jet traps air — a fresh pool carries small bubbles (≈ 0.5–1.5 mm)
    // whose spherical caps mirror the flame from ANY view, the sparse bright specks that read 'liquid' at once (the
    // flat film can only mirror the flame at its one mirror point). Hashed 4 mm cells, ≈ 7 % hold a bubble, none in
    // the outer 1 cm (the front is thin); the cap normal feeds the flame image below (energy kept by its fwidth AA).
    const bc = pl.div(0.004);
    const bid = bc.floor();
    const bf = bc.sub(bid).sub(0.5);
    const bh = dot(bid.add(SC.z.mul(31)), vec2(12.9898, 78.233)).sin().mul(43758.5453).fract();
    const bh2 = bh.mul(7.31).fract();
    const br = mix(float(0.12), float(0.38), bh2);
    const bq = dot(bf, bf);
    const inB = step(bq, br.mul(br)).mul(step(0.93, bh)).mul(step(0.01, dP)).mul(uPoolV2);
    const bz = sqrt(br.mul(br).sub(bq).max(1e-6));
    const Nb = normalize(vec3(bf.x.mul(cy).add(bf.y.mul(sy)), bz, bf.x.mul(sy).negate().add(bf.y.mul(cy))));
    const NpoolB = normalize(mix(Npool, Nb, inB));
    const N = normalize(mix(Na, NpoolB, isPool));
    const mg = mix(m.g, hP, isPool);
    const ageMin = uGameAge.add(uT.sub(SC.x).max(0).div(60));
    const edge = float(1).sub(mg);
    const clot = clamp(ageMin.sub(3).div(7), 0, 1);
    const dry = clamp(ageMin.sub(10).div(20), 0, 1);
    const roughB = float(0.05).add(edge.mul(clot).mul(0.2)).add(dry.mul(0.3));
    // prints: water + a little blood on varnish, beaded (hash sparkle tilts the normal at the bead scale)
    const bead = vUv.mul(2048).floor();
    const hb = dot(bead, vec2(12.9898, 78.233)).sin().mul(43758.5453).fract();
    const Np = normalize(N.add(vec3(hb.sub(0.5).mul(0.25), 0, hb.mul(7.1).fract().sub(0.5).mul(0.25))));
    // a wet print is the boards darkened by a water film (wet wood ≈ 35 % darker) with a hint of blood: near-black
    // albedo at ≈ 0.38 opacity + the film's specular (r5/r6: a 0.03 albedo under the torch read as pink stickers)
    // fix round 2 (ruling h, "pale slipper stickers"): her soles stepped through the pool — a print is BLOOD, a thin
    // (≈ 0.1–0.3 mm) whole-blood film on the varnish: Hb absorbs G/B within 0.1 mm, so the boards show through deep red
    // (wood ≈ (0.10, 0.06, 0.04) × T(0.2 mm) ≈ (0.07, 0.008, 0.006)); plasma-wet roughness 0.15
    // fix round 2: a thick pool is darkest at its core (the light path through ≥ 2 mm of whole blood is absorbed even
    // in the red) and redder at the thin meniscus where the boards show through: × 0.5 at full height → × 1.5 at the rim
    const thickK0 = mix(float(1.15), float(0.5), mg); // (review r5: the × 1.5 rim + the tilt = the pink band)
    // M-A (c) THICKNESS TONE (Beer–Lambert, MUA_POOL ≈ 3 /mm red): the boards show through a thin film as deep red
    // (T² = e^(−2·3·0.1) ≈ 0.55 at 0.1 mm) and not at all through the ≈ 2.75 mm core (e^(−16) → only the film's own
    // ≈ 4 % back-scatter, near-black maroon). The film thins over the outer ≈ 1 cm (the front is still creeping); the
    // seam runs and the satellites are thin (≈ 0.1–0.3 mm).
    const hT = tanh(clamp(dP.div(0.005), 0, 6)); // (j2: a 1.5 cm thin band read as a blurred edge — a fresh front is sharp)
    const thin = max(max(run, sat).mul(float(1).sub(coverP0)), float(1).sub(hT));
    // inside the pool the gaps under it hold ≈ 3 mm MORE blood (the seam's depth): the seams show through the film
    // as darker lines (× 0.6) — the board pattern continuing under the liquid, not a painted lid over it
    const thickK1 = mix(float(0.3), float(1.25), thin.mul(isPool)).mul(mix(float(1), float(0.6), seam.mul(hT).mul(isPool)));
    const thickK = mix(thickK0, mix(thickK0, thickK1, isPool), uPoolV2);
    const albedo = mix(mix(vec3(...ALB_POOL).mul(thickK), vec3(0.06, 0.016, 0.012), dry), vec3(0.07, 0.008, 0.006), isPrint);
    const rough = mix(roughB, float(0.15), isPrint);
    const Nn = mix(N, Np, isPrint);
    // review fix round 3 (#127): the analytic key had no shadow map, so a pool lobe lying in the table's / Harlan's
    // shadow stayed lit saturated red beside black boards (the 'red cardboard' read, r1max-04). The boards UNDER the
    // pool already carry the true lamp visibility: the opaque frame behind it (mip 5 ≈ 32 px — R5: mip 3 let the board seams show through — averages out the
    // wood figure) holds L_floor ≈ ρ_floor/π·E·V (+ the small indirect). With ρ_floor = floor_varnished's luminance and
    // the unshadowed E from the analytic key, R = L_floor / L_expected ≈ V: ≥ 0.7 lit, ≤ 0.2 in shadow. Floor stains
    // only (world y < 0.66: the boards at 0.6); table / rubber-sheet stains keep the old occlusion.
    // R3 (pr1, C2c 13.0 'pink sticker' prints): outside the parlor the blood key is the ROAMING lightning light (1100 cd
    // at plan (2.1, −1.4, 5.6), outside the house) — unshadowed it lit every stair print at L ≈ 1.1 (rgb 4.5, 0.23, 0.07:
    // 30× the treads beside them). Every stain outside the parlor (hall boards, stair treads: horizontal varnished wood
    // like the parlor boards) takes the same visibility from the surface under it: lit only inside the real window patch.
    const lkF = uKeyPos.sub(vSP);
    const dkF = dot(lkF, lkF).max(1e-4);
    const cosF = max(lkF.y.div(sqrt(dkF)), 0);
    const keyLum = dot(vec3(uKeyCol), vec3(0.2126, 0.7152, 0.0722));
    const expF = keyLum.mul(uKeyI).div(dkF).mul(cosF).mul(FLOOR_RHO_LUM / Math.PI);
    const behind = viewportOpaqueMipTexture(screenUV).level(float(5)).rgb;
    const visF = smoothstep(0.2, 0.7, dot(behind, vec3(0.2126, 0.7152, 0.0722)).div(expF.max(1e-6)));
    const onFloor = max(step(vSP.y, 0.66), float(1).sub(inParlor(vSP)));
    const keyVis = mix(float(1), visF, onFloor.mul(step(1e-6, expF)));
    const s = shade(vSP, Nn, albedo, rough, float(0.022), headShadow(vSP).mul(sameRoom(vSP)).mul(keyVis));
    // R4 (r3max 13.0: the stair prints still red-orange stickers brighter than the treads): the analytic TORCH lights
    // its whole 45° cone at the hot-centre 2 kcd (the real beam is a hot centre + a far dimmer spill ring, and it is
    // shadowed). For the board stains the DIFFUSE now comes from the boards themselves: L = L_behind ⊙ ρ_blood / ρ_floor
    // per channel — every light (lamp, torch profile, lightmap, the lightning patch) with its real shadows. Only the
    // speculars stay analytic: the flame image (× the key visibility above) and the torch lobe × its own visibility.
    const ltF = uTorchPos.sub(vSP);
    const cosT = max(ltF.y.div(length(ltF).max(1e-4)), 0);
    const expT = dot(vec3(s.Et), vec3(0.2126, 0.7152, 0.0722)).mul(cosT).mul(FLOOR_RHO_LUM / Math.PI);
    const visT = smoothstep(0.2, 0.7, dot(behind, vec3(0.2126, 0.7152, 0.0722)).div(expT.max(1e-6)));
    const diffB = behind.mul(albedo).div(vec3(...FLOOR_RHO));
    const cBoards = diffB.add(s.flame).add(s.tSpec.mul(visT));
    const cStain = mix(s.c, cBoards, onFloor);
    // escape fix round (lane CINE, item 2): a fresh film is a mirror — the room cube (box-projected) along the
    // reflection × Schlick (F0 0.022, IOR 1.35): the pool shows the lit wall / ceiling / Harlan's dark shape in it
    // instead of reading as a matte painted ellipse. Fallback (no probes): a dim warm room constant.
    // r4 (s8med 9.9: the cream disc survived Karis, the env clamp AND the mirror-flame term; by the shader maths only the
    // box-projected probe-cube lookup is left — a non-finite sample clipped by min(…, 6) to white, red at the tilted
    // meniscus rim): the room-cube lookup is OFF; the film reflects a dim warm room constant (lamp-lit plaster seen at
    // grazing incidence) and the flame's mirror image above. roomRadianceWorld stays for a later, verified retry.
    // fix round 2 (ruling h, "restore a SAFE room reflection"): no probe lookup — the reflected ray is traced
    // ANALYTICALLY to the parlor's box (G2: x 3.75–8.75, plan y 0–6, floor 0.6 → ceiling 3.8 m) and the hit is shaded
    // by the key light alone: L = ρ/π · I/d² · cos θ (wallpaper ochre ρ ≈ 0.30 × (1, 0.78, 0.5), ceiling plaster 0.6).
    // Every term is finite and bounded (d² ≥ 0.04, the result capped at 0.5), so it cannot paint a pool white again; it
    // gives the film the lit-wall → dark-ceiling gradient (and the lamp's falloff across the room) that reads as liquid.
    const Rr = s.V.negate().reflect(Nn);
    const rr = vec3(select(abs(Rr.x).lessThan(1e-4), float(1e-4), Rr.x), Rr.y.max(1e-3), select(abs(Rr.z).lessThan(1e-4), float(1e-4), Rr.z));
    const tx = select(rr.x.greaterThan(0), float(8.75).sub(vSP.x), float(3.75).sub(vSP.x)).div(rr.x);
    const ty = float(3.8).sub(vSP.y).div(rr.y);
    const tz = select(rr.z.greaterThan(0), float(0).sub(vSP.z), float(-6).sub(vSP.z)).div(rr.z);
    const tH = min(min(tx, ty), tz).max(0);
    const Hp = vSP.add(rr.mul(tH));
    const ceil = step(ty, min(tx, tz));
    const nW = select(ceil.greaterThan(0.5), vec3(0, -1, 0), select(tx.lessThan(tz), vec3(rr.x.sign().negate(), 0, 0), vec3(0, 0, rr.z.sign().negate())));
    const Lh = uKeyPos.sub(Hp);
    const dh2 = dot(Lh, Lh).max(0.04);
    const cosH = max(dot(nW, Lh.div(sqrt(dh2))), 0);
    const rhoW = mix(vec3(0.3, 0.234, 0.15), vec3(0.6, 0.58, 0.55), ceil);
    const roomL = uKeyCol.mul(uKeyI.div(dh2)).mul(cosH).mul(rhoW).mul(1 / Math.PI).add(vec3(0.004, 0.003, 0.0025));
    const envH0 = vec3(0.01, 0.008, 0.007);
    const envP = mix(envH0, roomL, inParlor(vSP)); // R4: the analytic room box is the parlor's — elsewhere the dim constant
    const envH = envH0;
    const nvE = max(dot(Nn, s.V), 0.02);
    const Fe = float(0.022).add(float(0.978).mul(pow(clamp(float(1).sub(nvE), 0, 1), 5)));
    // capped at 0.5: a lamp-lit room never reflects brighter (a unit error must not paint a pool white again)
    const refl = min(mix(envP, envH, isPrint).mul(Fe).mul(float(1).sub(dry.mul(0.85))).mul(uReflK), vec3(0.5));
    // opacity: a thick film hides the boards (blood transmits only red through ≲ 1–2 mm); a print is a thin wet film
    // r7: dark squares around the prints on the torch-lit treads — whatever leaks into a cell's border (mip bleed of
    // the neighbour cell, filtering) is cut: a soft fade to 0 at the quad edge and a coverage floor
    const edgeQ = max(abs(vLoc.x), abs(vLoc.y));
    // review fix round 2 (d3: the pools' spiky pink 'fur' rim is the STAIN, with or without particles): a 25 cm pool
    // spans ≈ 60 texels of its 128 px cell and is magnified ≈ 4× at E4; the old floor smoothstep(0.06, 0.2, m.r) drew
    // the bilinear halo of every edge texel (staircase) as a faint pink fringe. A liquid front is a sharp contour:
    // pools/streaks take the iso-line m.r = 0.5 anti-aliased over one screen pixel (fwidth), like an SDF edge.
    const wE = max(fwidth(m.r), float(0.02));
    const sharp = smoothstep(float(0.5).sub(wE), float(0.5).add(wE), m.r);
    const cover = mix(mix(sharp, coverP, isPool), m.r.mul(smoothstep(0.06, 0.2, m.r)), isPrint).mul(SC.w).mul(float(1).sub(smoothstep(0.42, 0.5, edgeQ)));
    // r4: prints read as painted pink/white marks — a wet print is mostly darkened boards with a sparse glint
    // review fix round 2 (every pool rim a soft PINK halo): the thin meniscus was alpha-blended at 0.75 over the tan
    // boards — tan G/B leaking through reads salmon-pink. A 0.1 mm whole-blood film is a red FILTER (Hb absorbs G/B
    // within 0.1 mm): nothing green/blue of the boards survives it → the film is opaque to G/B right to its edge; the
    // edge softness is the 2-texel coverage ramp alone.
    const a = mix(cover.mul(0.97), cover.mul(0.85), isPrint).mul(smoothstep(SC.x, SC.x.add(0.04), uT));
    const ring = m.b.mul(dry).mul(0.5);
    // ?debug A/B (__bloodFx.uStainDbg): 1 = alpha 0 everywhere, 2 = magenta at the real alpha
    const col = min(cStain.mul(float(1).sub(ring)).add(refl), vec3(6));
    // belt and braces: where nothing is drawn the colour is exactly 0 (a select never blends the other branch)
    const colS = select(a.greaterThan(1e-4), col, vec3(0));
    // 3 = M-A seam map on the pool quads (green = seam, red = run cover, blue = satellites) at alpha 0.9
    const dbg3 = uStainDbg.equal(3).and(isPool.greaterThan(0.5));
    return vec4(select(dbg3, vec3(run, seam, sat), select(uStainDbg.equal(2), vec3(4, 0, 4), colS)), select(dbg3, float(0.9), select(uStainDbg.equal(1), float(0), a)));
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
    // (fix round r5: t0 starts at 1e9 = off; updatePools stamps the real first-visible clock — the old −1e6 "on" flag
    // made every pool ≈ 16 700 min old in the shader: fully clotted + dried, roughness 0.35–0.55 → the 9.9 cream disc)
    const i = addStain(p, r0() * 6.28, 0.01, 0.01, CELL.pool, 1, 1e9, 0);
    if (i >= 0) pools.push({ i, ml });
  };
  const sat = (x: number) => Math.max(0, Math.min(1, x));
  // under the neck: B03's drip + the first stroke (≈ 40 mL), fed by the stump down the table edge after the cut; it
  // spreads to the head (10 cm away) by ≈ 9.5 s and reaches ≈ 260 mL by 12 s, then the seep
  addPool([5.24, 3.24, 0.6], (t) => 40 + 220 * sat((t - 7.7) / 4.3) + Math.max(0, t - 12) * 0.6);
  // where pulses 1–2 land (x ≈ 4.2–4.8, y 3.38 — fix round 2 axis): the jets' summed volume as it lands
  addPool([4.48, 3.37, 0.6], (t) => 45 * sat((t - 7.98) / 0.7) + 15 * sat((t - 9.7) / 0.3));
  if (d.preset !== 'low') {
    // the sheet-corner drip (1 mL/s from 10.4)
    addPool([5.3, 2.2, 0.6], (t) => Math.max(0, Math.min(t, 40) - 10.6) * 1.0);
    // escape fix round (lane CINE): the head lies IN its own blood. A severed head drains from both carotids and
    // jugulars (≈ 10 % of the 5 L blood volume is in the head/neck) — tens of mL in the first seconds. The landing
    // (0.8 m fall, cut face first-ish) splashes ≈ 15 mL at HEAD_LAND at 7.9; at rest the pool is centred 8 cm toward
    // the cut ring (bearing 174°, cutscene-fx REST_FACE) and grows 15 → 40 mL (r ≈ 4 → 7 cm, POOL_THICK 2.75 mm) by
    // the lift at 10.6, then holds (the head is gone; the film only spreads)
    addPool([HEAD_LAND[0] - 0.05, HEAD_LAND[1], 0.6], (t) => (t < 7.9 ? 0 : 15 + 20 * sat((t - 7.9) / 1.2))); // landing splash + 1.2 s of drain
    // fix round 2: the rest pose's neck end bears 151° and is tilted up 35°: the stub drains from its lower rim ≈ 7 cm
    // from the head centre. Both carotids + both jugulars of a severed head drain tens of mL/s at first (≈ 10 % of the
    // 5 L blood volume is above the cut) → ≈ 70 mL by the lift at 10.6 (r ≈ 9 cm at 2.75 mm), the head lies IN it
    addPool([HEAD_REST[0] - 0.061, HEAD_REST[1] + 0.034, 0.6], (t) => (t < 9.6 ? 0 : 25 + 45 * sat((t - 9.6) / 1.0)));
    // fix round 2 (ruling h): the boot roll (9.45–9.8) drags the bleeding cut and the soaked hair across the boards —
    // a smear from the landing to the rest
    addStain([(HEAD_LAND[0] + HEAD_REST[0]) / 2, (HEAD_LAND[1] + HEAD_REST[1]) / 2, 0.6], Math.atan2(HEAD_REST[1] - HEAD_LAND[1], HEAD_REST[0] - HEAD_LAND[0]), 0.2, 0.08, CELL.streak[1], 0, 9.7, 4, 0.9);
  }

  // ---- C2c: her wet prints (hall + treads 1–11), the puddle on tread 11, the drip onto tread 10
  const C2C0 = C2_DURATION; // C2c t = 0 on the blood clock
  const prints: Array<{ p: P3; yaw: number; t: number; left: boolean }> = [];
  {
    // the hall: from the parlor door to the stair foot, 0.55 m steps — times follow c2c-up's walk (fix round: 0.5 m/s
    // to G1_TO at 4.47, then 1.1 m/s round the newel)
    const path: P3[] = [[3.3, 1.75, 0.6], [2.3, 2.7, 0.6], [0.85, 3.35, 0.6]];
    let sAll = 0;
    // (r2: 0.61 m/s to G1_FROM at 3.84 (2.34 m), 0.52 m/s to G1_TO at 4.47, then ≈ 1.1 m/s round the newel)
    const tAt = (sx: number) => (sx <= 2.34 ? sx / 0.61 : sx <= 2.67 ? 3.84 + (sx - 2.34) / 0.52 : 4.47 + (sx - 2.67) / 1.1);
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
        prints.push({ p: [a[0] + (b[0] - a[0]) * f - Math.sin(h) * side, a[1] + (b[1] - a[1]) * f + Math.cos(h) * side, 0.6], yaw: h, t: C2C0 + tAt(sAll + s), left });
        left = !left;
      }
      s -= L;
      sAll += L;
    }
    // the treads (her right hand on the rail: feet a little east of centre); the times follow her moves (§4.1)
    const tTread = (k: number) => (k <= 4 ? 5.3 + (k - 1) * 0.387 : k <= 9 ? 6.46 + ((k - 4) / 5) * 0.39 : k === 10 ? 8.4 : 8.9);
    for (let k = 1; k <= ADA_LAST_TREAD; k++) {
      const a = adaOnTread(k);
      const left2 = k % 2 === 1;
      prints.push({ p: [a[0] + (left2 ? 0.08 : -0.08), a[1] - 0.02, a[2]], yaw: Math.PI / 2, t: C2C0 + tTread(k), left: left2 });
    }
  }
  const printIdx: number[] = [];
  // fix round 2: each step leaves less of the pool on the boards — the soles' load decays ≈ e^(−n/12) (a wet sole
  // transfers ≈ 8 % of what it carries per contact), never below a faint 0.3 smear
  for (let n = 0; n < prints.length; n++) {
    const pr = prints[n];
    const i = addStain(pr.p, pr.yaw, 0.25, 0.1, pr.left ? CELL.print[0] : CELL.print[1], 2, pr.t, 2, Math.max(0.3, 0.97 * Math.exp(-n / 12)));
    if (i >= 0) printIdx.push(i);
  }
  const t11 = treadNosing(ADA_LAST_TREAD);
  addStain([adaOnTread(ADA_LAST_TREAD)[0], t11[1] - 0.13, t11[2]], 1.3, 0.2, 0.15, CELL.puddle, 2, C2C0 + 8.95, 6, 1);
  const t10 = treadNosing(10);
  addStain([adaOnTread(10)[0], t10[1] - 0.04, t10[2]], 0.2, 0.1, 0.095, CELL.puddle, 1, /* fix round 3: analytic pool, 3.8 r */ C2C0 + 10.05, 1, 0.8);

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
  // fix round: the falling / lying head bleeds from its cut end too (carotids + jugulars of the head side): drops trail
  // it through the fall (every 30 ms, carried at the head's own velocity) and drip into its pool while it lies (every
  // 0.18 s) until the lift at 10.6 — the dark tumbling mass reads as a bleeding head
  let fallNext = 7.6;
  const fallPrev = new THREE.Vector3();
  let fallPrevT = -1;

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
      // fix round 3 LOOK: analytic pools need room for the lobes + the stretch inside the quad's edge fade (0.84 × half)
      s2[p.i * 4] = on ? r * 3.8 : 0.0001;
      s2[p.i * 4 + 1] = on ? r * 3.8 : 0.0001;
      if (on && s3[p.i * 4] > 1e8) s3[p.i * 4] = clock; // fresh from the moment it appears (wet, α 0.05)
      else if (!on) s3[p.i * 4] = 1e9;
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
        for (const q of pools) s3[q.i * 4] = 1e9; // re-stamped by updatePools from this clock
        fallNext = 7.6;
        fallPrevT = -1;
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
      // the head's soft shadow on its own pool (fix round): fed every frame from the head's centre
      {
        const hc = d.headCenter?.();
        if (hc) uHeadOcc.value.set(hc.x, hc.y, hc.z, 0.09);
        else uHeadOcc.value.y = -100;
      }
      if (d.headPos && clock >= fallNext && clock >= 7.6 && clock < 10.6) {
        const hp = d.headPos();
        if (hp) {
          const dtv = fallPrevT >= 0 ? Math.max(1e-3, clock - fallPrevT) : 0;
          const v: P3 = dtv > 0 ? [(hp.x - fallPrev.x) / dtv, -(hp.z - fallPrev.z) / dtv, (hp.y - fallPrev.y) / dtv] : [0, 0, 0];
          const falling = clock < 7.95;
          const r = falling ? 0.0028 : 0.0024;
          const p: Particle = { kind: 1, t0: clock, p0: [hp.x, -hp.z, hp.y], v0: falling ? [v[0] * 0.8, v[1] * 0.8, v[2] * 0.8 - 0.2] : [0, 0, -0.05], r, tau: tauFor(r), tEnd: 0, ml: 0.06, hit: null };
          terminate(p);
          spawn(p);
          fallPrev.copy(hp);
          fallPrevT = clock;
        }
        fallNext = clock + (clock < 7.95 ? 0.03 : 0.18);
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
      // fix round: the blade comes out of the neck COATED and the impact spatter reaches his apron at once — 45 % within
      // 60 ms of contact, then the runs / soak spread over 3 s (was a linear 3 s ramp: 7 % wet at 7.78)
      {
        const k = clock - C2_CONTACT;
        BLOOD_UNIFORMS.amount.value = 0.45 * Math.max(0, Math.min(1, k / 0.06)) + 0.55 * Math.max(0, Math.min(1, (k - 0.06) / 3));
      }
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
  // ?debug handle (QA scenarios): reflection gain + the alive particles of a kind at the blood clock (PLAN coords)
  if (typeof location !== 'undefined' && /[?&]debug\b/.test(location.search)) {
    (globalThis as any).__bloodFx = {
      uReflK,
      uStainDbg,
      uPoolV2,
      atlas,
      stainArrays: () => ({ s1: Array.from(s1), s2: Array.from(s2), s3: Array.from(s3) }),
      keys: () => ({ keyI: uKeyI.value, keyPos: uKeyPos.value.toArray?.(), keyCol: uKeyCol.value.toArray?.(), torchI: uTorchI.value, amb: uAmbient.value }),
      stainMesh,
      clock: () => clock,
      alive: (kind: number) =>
        parts.filter((q) => q.kind === kind && q.t0 <= clock && clock < q.tEnd).map((q) => ({ p: ballistic(q.p0, q.v0, q.tau, clock - q.t0), r: q.r, age: +(clock - q.t0).toFixed(3) })),
    };
  }
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
  // fix round 2 (ruling h, "pools read as lobed petals"): the edge was 3–4 low harmonics = petals. A spreading pool's
  // front is fractal (fingering of a viscous film on a rough, grained surface): radius noise from 2..34 harmonics with
  // a 1/k^1.1 spectrum and random phases, stretched ≈ 1.3× along the grain (u; it wicks along the board seams); the
  // film is FLAT-TOPPED with a meniscus only within the capillary length (√(σ/ρg) ≈ 2.3 mm ≈ 4 % of a 6 cm radius)
  const blob = (rad: number, harm: number[], crown: number) => {
    // (r2 look: K 32 at 1/k^1.1 aliased into a spray-paint stipple in the 128 px cell → 14 harmonics at 1/k^1.7: a
    // viscous front is smooth at the mm scale and irregular at the cm scale)
    const K = 14;
    const amp: number[] = [];
    const ph: number[] = [];
    let norm = 0;
    for (let k = 0; k < K; k++) {
      amp.push((0.5 + r()) / Math.pow(k + 2, 1.7));
      ph.push(r() * 6.283);
      norm += amp[k];
    }
    // (look 2: ±50 % radius swings with 14 harmonics made a spiky, fuzzy 'spray' rim when magnified → ±10–15 %)
    const rough = 0.07 + harm.reduce((a, b) => a + b, 0) * 0.15;
    return (u: number, v: number) => {
      const a = Math.atan2(v, u);
      let n = 0;
      for (let k = 0; k < K; k++) n += amp[k] * Math.sin((k + 2) * a + ph[k]);
      let R = rad * (1 + ((rough * n) / norm) * 1.2);
      R *= 1.3 / Math.sqrt((Math.cos(a) * 1.0) ** 2 + (Math.sin(a) * 1.3) ** 2); // grain along u
      R *= 1 + crown * Math.max(0, Math.sin(a * 14 + rad * 30)) ** 6;
      const d = Math.hypot(u, v) / R;
      const cover = 1 - smooth(0.95, 1.01, d);
      const height = 1 - smooth(0.88, 1.0, d); // flat top, steep meniscus rim
      const ring = smooth(0.86, 0.96, d) * (1 - smooth(0.98, 1.03, d));
      return [cover, cover * height, ring] as [number, number, number];
    };
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
    // review fix round 2 (every pool edge read as a soft spiky red fringe at 1.4 m): the 'crown' (sin^6 spikes, 14 round
    // the rim) is a drop-IMPACT splash shape; a pool fed by a stream / the stub spreads as a viscous front — a smooth,
    // cm-scale irregular meniscus with satellites outside it (kept). Crown 0.12 / 0.04 → 0.
    const main = blob(0.2 + r() * 0.08, [r() * 0.12, r() * 0.08, r() * 0.06], 0);
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
  // prints (12, 13): a bare foot's WET SOLE in metres (fix round: the old cells were striped ellipses): an adult foot
  // 24 cm long, ball 9.5 cm, heel 6 cm; contact = heel, the lateral band, the ball and five toe pads — the medial arch
  // never touches. The quad is 0.25 × 0.10 m: u (−0.5…0.5) → x along (heel −, toes +), v → y across (medial +, left foot)
  const foot = (mirror: number) => (u0: number, v0: number): [number, number, number] => {
    const x = u0 * 0.25;
    const y = v0 * 0.1 * mirror;
    const ell = (cx: number, cy: number, rx: number, ry: number) => Math.hypot((x - cx) / rx, (y - cy) / ry);
    const cap = (ax: number, ay: number, bx: number, by: number, r: number) => {
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(x - ax - dx * t, y - ay - dy * t) / r;
    };
    let d = Math.min(
      ell(-0.083, 0.0, 0.034, 0.028), // heel
      cap(-0.07, -0.02, 0.035, -0.03, 0.013), // the lateral band
      ell(0.045, 0.004, 0.026, 0.045), // the ball
    );
    const toes: Array<[number, number, number]> = [[0.097, 0.03, 0.0135], [0.103, 0.007, 0.009], [0.1, -0.011, 0.0082], [0.093, -0.026, 0.0076], [0.083, -0.039, 0.007]];
    for (const [tx, ty, tr] of toes) d = Math.min(d, Math.hypot(x - tx, y - ty) / tr);
    // a wet print breaks up at the rim (skin ridges, uneven pressure): coverage noise only near the edge
    const n = 0.5 + 0.5 * Math.sin(x * 410 + Math.sin(y * 530) * 2.1) * Math.sin(y * 370 + x * 90);
    const cover = 1 - smooth(0.78 - 0.12 * n, 1.02, d);
    return [cover, cover * 0.55, 0];
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
