// Retroreflection on County Road 9 (docs/C1-OPENING.md §7.6, §7.11): sign sheeting, county shields, reflector posts,
// yellow centre-line paint — and the deer's tapetum. A retroreflector sends light back toward its source in a narrow
// cone, so its luminance depends on the OBSERVATION angle α (light → surface → eye):
//     L = R_A · E · f(α),   f(α) = exp(−(α/σ)²),  σ ≈ 1°
// with E the illuminance our headlamps put on the surface (the lamp's photometric pattern, headlamps.ts, ÷ d², × the
// cosine of incidence) and R_A the coefficient of retroreflection at the reference geometry (0.2° observation):
//   - engineering-grade white sheeting (ASTM D4956 Type I, 1990s)  R_A ≈ 70 cd/lx/m² (green ≈ 9, yellow ≈ 50, blue ≈ 4)
//     → the decal's own colour carries the per-colour ratio (white legend ≈ 0.85 → ×82, green ground ≈ 0.07 → 6);
//   - glass-bead wet road paint: R_L ≈ 35 mcd/m²/lx (dry ≈ 150; rain floods the beads) → 0.035 at f = 1;
//   - a 3-inch amber/white post reflector (prismatic) ≈ 0.6 cd/lx over its 0.0045 m² → R_A ≈ 130;
//   - deer tapetum lucidum (eye-shine): the eye is a cat's-eye retroreflector (cornea + lens focus onto the tapetum at
//     the focal plane), ρ ≈ 0.3 returned into a ≈ 2° cone (Ω = π·0.0175² = 9.6e-4 sr): R_A = ρ / Ω ≈ 300 over the pupil,
//     greenish-white (r4: R_A 40 left the 40 m glints far below one grey level).
// From the driver's seat the lamps sit ≈ 0.6 m below and ±0.7 m beside the eye: α ≈ 1° at 50 m (f ≈ 0.37), so the
// sign BLAZES from the POV and is dull from any exterior camera (α ≫ σ) — exactly the §7.6 requirement.
// Two lamps (L_HEADLIGHT_L/R); their world pose and live intensity are fed into uniforms every frame (update()).

import * as THREE from 'three/webgpu';
import { Fn, acos, atan, cameraPosition, clamp, dot, exp, float, max, normalWorld, positionWorld, texture, uniform, vec3, materialColor } from 'three/tsl';
import { lowBeamPattern } from '../render/headlamps.ts';

const DEG = Math.PI / 180;
const SIGMA = 1.0 * DEG;

interface LampU {
  pos: any;
  fwd: any;
  right: any;
  up: any;
  cd: any;
}
const mkLamp = (): LampU => ({ pos: uniform(new THREE.Vector3()), fwd: uniform(new THREE.Vector3(0, 0, -1)), right: uniform(new THREE.Vector3(1, 0, 0)), up: uniform(new THREE.Vector3(0, 1, 0)), cd: uniform(0) });
const LAMPS: LampU[] = [mkLamp(), mkLamp()];

/** Retro luminance (cd/m² per unit R_A) at this fragment from both lamps: Σ E_i · f(α_i). */
const retroE = Fn(() => {
  const P = positionWorld;
  const toEye = cameraPosition.sub(P).normalize();
  let sum: any = float(0);
  for (const L of LAMPS) {
    const d = P.sub(L.pos);
    const dist2 = max(dot(d, d), 1);
    const dir = d.div(dist2.sqrt());
    const fz = max(dot(dir, L.fwd), 1e-3);
    const h = atan(dot(dir, L.right).div(fz)).mul(1 / DEG);
    const v = atan(dot(dir, L.up).div(fz)).mul(1 / DEG);
    const pattern = lowBeamPattern(h, v).mul(dot(dir, L.fwd).greaterThan(0).select(float(1), float(0)));
    const cosI = max(dot(dir.negate(), normalWorld), 0.15); // sheeting keeps ≈ 30 % at 60° entrance
    const E = L.cd.mul(pattern).mul(cosI).div(dist2);
    const alpha = acos(clamp(dot(dir.negate(), toEye), -1, 1));
    sum = sum.add(E.mul(exp(alpha.div(SIGMA).pow(2).negate())));
  }
  return sum;
});

/** Σ E·f(α) at this fragment (TSL node) for custom materials (deer eye-shine). */
export const retroLuminance = (): any => retroE();

/** Coefficients (see header). Per-unit-albedo for colour-carrying decals (÷ white sheeting's 0.85 albedo). */
export const RETRO = { sheeting: 70 / 0.85, paint: 0.035 / 0.5, reflector: 130 / 0.5, eye: 300 } as const;

/** Make `mat` retroreflective: emissive = colour (map or base colour) × k × Σ E·f(α). Returns true if installed. */
export function makeRetro(mat: any, k: number, tint?: [number, number, number]): boolean {
  if (!mat || mat.userData?.retro) return false;
  const base = tint ? vec3(...tint) : mat.map ? texture(mat.map).rgb : materialColor.rgb;
  mat.emissiveNode = base.mul(retroE()).mul(k);
  mat.userData = { ...(mat.userData ?? {}), retro: k };
  mat.needsUpdate = true;
  return true;
}

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Feed the lamps' live pose + candela (0 when off) — call once per frame. */
export function updateRetroLamps(lights: Array<any | null>): void {
  lights.forEach((l, i) => {
    const U = LAMPS[i];
    if (!U) return;
    if (!l || !l.visible || l.intensity <= 0) {
      U.cd.value = 0;
      return;
    }
    l.updateMatrixWorld?.();
    l.getWorldPosition(_p);
    (l.target ? l.target.getWorldPosition(_t) : _t.copy(_p).add(new THREE.Vector3(0, 0, -1)));
    U.pos.value.copy(_p);
    const f = U.fwd.value.copy(_t).sub(_p).normalize();
    const r = U.right.value.crossVectors(f, _up).normalize();
    U.up.value.crossVectors(r, f).normalize();
    U.cd.value = l.intensity;
  });
}
