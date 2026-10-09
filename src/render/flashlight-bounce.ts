// LIGHTING lane (REALISM-BACKLOG item 11) — the torch beam's first bounce.
//
// A real torch lights a room twice: the beam, and the light its hot spot throws back. Without the bounce the walls
// 20 cm outside the beam were black. The hit surface reflects ρ·Φ (Φ = the beam's flux, ≈ 19 lm, all of which lands
// somewhere near the aim point) as a Lambertian patch: a cosine lobe of peak intensity I = ρ·Φ / π, approximated by
// the flashlight's `bounce` SpotLight (85°, penumbra 1, decay 2, 5 m, unshadowed) at the hit point, aimed out along
// the surface normal — so the hit surface itself is not relit, its neighbours (side walls, floor, ceiling, her) are.
// Colour = the hit material's avgAlbedo (the Blender bounce colour, material-spec.json), normalised; intensity uses
// its luminance. Hit point + normal: the collision octree; material: a rate-limited, size-capped Raycaster (see below)
// on the meshes whose world box holds the hit. Every 2nd frame; smoothed so the bounce never pops.

import * as THREE from 'three/webgpu';
import { Fn, exp, float, max, normalize, positionWorld, reflectVector, roughness, uniform, vec3 } from 'three/tsl';
import { specById } from '../materials/spec-index.ts';
import type { Flashlight } from './flashlight.ts';

/** Beam flux (lm) of the cookie + spot falloff, by numerical integration (matches flashlight.ts's cookie). */
export function beamFlux(I0: number, core: number, sigma2: number, spill: number, shelf: number, angleRad: number, penumbra: number, tail = 0): number {
  const ss = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const cO = Math.cos(angleRad);
  const cI = Math.cos(angleRad * (1 - penumbra));
  const N = 400;
  let F = 0;
  for (let i = 0; i < N; i++) {
    const th = ((i + 0.5) / N) * angleRad;
    const r = Math.tan(th) / Math.tan(angleRad);
    const c = Math.exp((-r * r) / sigma2) * core + (1 - ss(shelf, 0.95, r)) * spill + (1 - ss(0.6, 1, r)) * tail;
    F += 2 * Math.PI * I0 * c * ss(cO, cI, Math.cos(th)) * Math.sin(th) * (angleRad / N);
  }
  return F;
}

interface Candidate {
  mesh: any;
  box: any;
  /** World-box volume (m³): the smallest box holding the hit is the most specific surface. */
  vol: number;
  /** Triangle count: meshes above TRACE_TRI_CAP are never ray-tested triangle by triangle (no BVH here). */
  tris: number;
}

/**
 * AD review (perf): `Raycaster.intersectObjects` has no BVH and walks every triangle of each candidate; the merged
 * room/house meshes holding a wall hit are 10⁴–10⁵ triangles, so the old every-2nd-frame trace cost ≈ 8 ms of CPU per
 * trace (+4.3 ms average on Medium in Harlan's room, measured with an in-session toggle) and hitched every other frame.
 * Now: the hit point AND its normal come from the collision octree every 2nd frame (≈ 0.05 ms); the material (albedo
 * colour) is re-sampled only when the hit moved > 0.25 m or after 0.5 s, only against the ≤ 4 smallest meshes whose
 * box holds the hit and that have ≤ TRACE_TRI_CAP triangles; a bigger surface uses its first material without a
 * triangle test. The colour is lerped (k = 12/s), so a re-sample never pops.
 */
const TRACE_TRI_CAP = 6000;
/** Mean albedo of the house's interior surfaces (wallpaper 0.3–0.45, plaster ceilings 0.6, floors 0.15–0.25). */
const ROOM_RHO = 0.3;

/**
 * Round 3 (R2-3): the beam's lit pool as seen by NEARBY glossy things (the torch barrel, the glove, the snaps). The
 * bounce SpotLight gives them the pool's diffuse light, but nothing reflected it: the metal barrel (F0 ≈ 0.6) and the
 * leather had no environment at all and rendered black against the lit floor/wall. The pool is a Lambertian disc at
 * the hit point: radiance L = I_b / A (I_b = ρΦ/π, the bounce intensity; A = π r², r ≈ dist·tan 18° — the shelf that
 * carries ~90 % of the flux — stretched by 1/cos at oblique incidence). Uniforms are written by FlashlightBounce.
 */
export const TORCH_POOL = {
  pos: uniform(new THREE.Vector3(0, -1000, 0)),
  normal: uniform(new THREE.Vector3(0, 1, 0)),
  /** Pool radiance (linear RGB, cd/m²-scaled like every light here). */
  radiance: uniform(new THREE.Color(0, 0, 0)),
  radius: uniform(0.3),
  /** The beam's interreflected light around the player (irradiance, lux): what lights the faces of the hand that
   *  see neither the beam nor the pool. Integrating-sphere estimate E = ρΦ / (A(1 − ρ)), A = 4πR², R ≈ 1–1.6 m (the
   *  near enclosure) — ≈ 0.4–0.7 lux (vs ≈ 20–120 lux in the hot spot: the hand reads ~1/40 of the pool, dim but
   *  solid). Indoors only (no enclosure outside: the open field returns nothing). */
  fill: uniform(new THREE.Color(0, 0, 0)),
  /** Debug A/B gain on the fill (1 = physical). */
  gain: uniform(1),
};

/**
 * Prefiltered radiance of the pool along the reflection direction: a Gaussian in angle whose integral (≈ L·Ω_pool) is
 * conserved as the roughness lobe (β ≈ 1.2·α²) widens it. Ω_pool = π·(r/d)²·|cos θ_pool| (projected disc).
 */
export const torchPoolRadiance = Fn(() => {
  const P = TORCH_POOL;
  const v = P.pos.sub(positionWorld);
  const d2 = max(v.dot(v), 1e-4);
  const vh = v.mul(d2.inverseSqrt());
  const cosP = max(vh.dot(P.normal).negate(), 0); // the pool faces back toward the viewer of it
  const a2 = P.radius.mul(P.radius).div(d2).mul(cosP); // α² of the projected disc (rad²)
  const rr = roughness.mul(roughness).mul(1.2);
  const s2 = a2.add(rr.mul(rr)).add(1e-4);
  const c = normalize(reflectVector).dot(vh);
  const phi2 = float(1).sub(c).mul(2).max(0); // ≈ angle² for small angles
  return P.radiance.mul(a2.div(s2)).mul(exp(phi2.div(s2).negate()));
});

const RESAMPLE_MOVE2 = 0.25 * 0.25;
const RESAMPLE_FRAMES = 15; // trace frames (every 2nd frame) ≈ 0.5 s at 60 fps

export class FlashlightBounce {
  private readonly fl: Flashlight;
  private readonly collision: { rayDistance(o: any, d: any, far: number): number; octree?: any };
  private readonly cands: Candidate[] = [];
  private readonly ray = new THREE.Raycaster();
  private readonly rayObj = new THREE.Ray();
  private readonly o = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly hit = new THREE.Vector3();
  private readonly lastSample = new THREE.Vector3(1e9, 1e9, 1e9);
  private readonly n = new THREE.Vector3(0, 0, 1);
  private readonly nTarget = new THREE.Vector3(0, 0, 1);
  private readonly col = new THREE.Color(1, 1, 1);
  private readonly colTarget = new THREE.Color(1, 1, 1);
  private rho = 0;
  private rhoTarget = 0;
  private rhoSurface = 0.3;
  private frame = 0;
  private sampleAge = 1e9;
  private valid = false;
  /** Multiplier on the physical bounce (look API `bounce`). */
  scale = 1;
  /** Beam flux at the base intensity (lm), recomputed by the look sync when the beam changes. */
  flux = 19;

  constructor(fl: Flashlight, roots: any[], collision: { rayDistance(o: any, d: any, far: number): number; octree?: any }) {
    this.fl = fl;
    this.collision = collision;
    const size = new THREE.Vector3();
    for (const r of roots) {
      r.updateMatrixWorld(true);
      r.traverse((m: any) => {
        if (!m.isMesh || m.isSprite || !m.geometry) return;
        const mat = Array.isArray(m.material) ? m.material[0] : m.material;
        if (!mat || mat.transparent) return; // glass: the beam goes through
        const box = new THREE.Box3().setFromObject(m).expandByScalar(0.06);
        box.getSize(size);
        const g = m.geometry;
        const tris = (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;
        this.cands.push({ mesh: m, box, vol: size.x * size.y * size.z, tris });
      });
    }
    this.cands.sort((a, b) => a.vol - b.vol);
  }

  update(dt: number, on: boolean): void {
    const L = this.fl.light;
    const B = this.fl.bounce;
    if (!B) return;
    if (!on || L.intensity <= 0) {
      this.rhoTarget = 0;
    } else if ((this.frame++ & 1) === 0) {
      L.getWorldPosition(this.o);
      L.target.getWorldPosition(this.d);
      this.d.sub(this.o).normalize();
      let dist = Infinity;
      const oct = this.collision.octree;
      if (oct?.rayIntersect) {
        this.rayObj.set(this.o, this.d);
        const h = oct.rayIntersect(this.rayObj);
        if (h && h.distance <= 12) {
          dist = h.distance;
          if (h.triangle?.getNormal) {
            h.triangle.getNormal(this.nTarget);
            if (this.nTarget.dot(this.d) > 0) this.nTarget.negate(); // face the torch
          } else this.nTarget.copy(this.d).negate();
        }
      } else dist = this.collision.rayDistance(this.o, this.d, 12);
      if (Number.isFinite(dist)) {
        this.hit.copy(this.o).addScaledVector(this.d, dist);
        if (!oct?.rayIntersect) this.nTarget.copy(this.d).negate();
        this.sampleAge++;
        if (this.sampleAge >= RESAMPLE_FRAMES || this.hit.distanceToSquared(this.lastSample) > RESAMPLE_MOVE2) {
          this.sampleAge = 0;
          this.lastSample.copy(this.hit);
          const s = this.sample(dist);
          this.rhoSurface = s ? s.rho : 0.3;
          if (s) this.colTarget.copy(s.col);
        }
        // fade with distance: beyond ~6 m the spot is large and its bounce reaches nothing near the player
        const fade = 1 - Math.min(1, Math.max(0, (dist - 6) / 4));
        this.rhoTarget = this.rhoSurface * fade;
        this.valid = true;
      } else this.rhoTarget = 0;
    }
    const k = 1 - Math.exp(-dt * 12);
    this.rho += (this.rhoTarget - this.rho) * k;
    this.n.lerp(this.nTarget, k).normalize();
    this.col.lerp(this.colTarget, k);
    if (!this.valid) return;
    const beam = L.intensity / Math.max(1e-3, this.fl.intensity); // battery dips follow
    // peak of a Lambertian lobe: I = ρ·Φ / π
    B.intensity = (this.rho * this.flux * beam * this.scale) / Math.PI;
    B.color.copy(this.col);
    B.position.copy(this.hit).addScaledVector(this.n, 0.04);
    B.target.position.copy(this.hit).addScaledVector(this.n, 1);
    B.updateMatrixWorld();
    B.target.updateMatrixWorld();
    // the pool as an emitter for nearby reflections (TORCH_POOL above)
    const dist = this.o.distanceTo(this.hit);
    const cosI = Math.max(0.3, Math.abs(this.n.dot(this.d)));
    const r = Math.max(0.05, (dist * 0.325) / cosI);
    const Lp = B.intensity / (Math.PI * r * r);
    TORCH_POOL.pos.value.copy(this.hit);
    TORCH_POOL.normal.value.copy(this.n);
    TORCH_POOL.radius.value = r;
    TORCH_POOL.radiance.value.copy(this.col).multiplyScalar(Lp);
    // the multi-bounce field is the whole room's, not the hit texel's: the beam's spill (~half its flux) lands on
    // walls/floor around the hot spot, so use the interior's mean albedo (ROOM_RHO) with the hit's share mixed in
    // enclosure: the hand sits ~1 m from the hall's walls, floor and ceiling, which the reflected flux fills before
    // it escapes down the hall — R = 1 m near a wall, growing slowly with the hit distance (A = 4πR²)
    const R = Math.min(1.6, 1 + 0.15 * Math.max(0, dist - 1));
    const rho = 0.5 * Math.min(0.8, this.rho) + 0.5 * ROOM_RHO;
    const lit = Math.min(1, this.rho / Math.max(1e-3, this.rhoSurface)); // the smoothed on/off + distance fade
    const flux = this.flux * beam * this.scale * lit;
    const E = (rho * flux) / (4 * Math.PI * R * R * (1 - rho));
    TORCH_POOL.fill.value.copy(L.color).multiplyScalar(E);
  }

  /** Albedo (avgAlbedo of the hit material, material-spec.json) near `dist` along the beam, cheaply (see above). */
  private sample(dist: number): { rho: number; col: any } | null {
    let fallback: any = null;
    let best: any = null;
    let tested = 0;
    this.ray.set(this.o, this.d);
    this.ray.near = Math.max(0, dist - 0.3);
    this.ray.far = dist + 0.3;
    for (const c of this.cands) {
      if (c.mesh.visible === false || !c.box.containsPoint(this.hit)) continue;
      if (c.tris > TRACE_TRI_CAP) {
        fallback ??= c.mesh;
        continue;
      }
      if (tested++ >= 4) break;
      const hits = this.ray.intersectObject(c.mesh, false);
      if (hits[0] && (!best || hits[0].distance < best.distance)) best = hits[0];
    }
    let mat: any = null;
    if (best) mat = Array.isArray(best.object.material) ? best.object.material[best.face?.materialIndex ?? 0] : best.object.material;
    else if (fallback) mat = Array.isArray(fallback.material) ? fallback.material[0] : fallback.material;
    if (!mat) return null;
    const spec = specById(String(mat?.userData?.material_id ?? ''));
    const a: [number, number, number] = spec ? (spec.avgAlbedo as [number, number, number]) : [0.3, 0.3, 0.3];
    const lum = 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    const col = new THREE.Color(a[0] / Math.max(1e-4, lum), a[1] / Math.max(1e-4, lum), a[2] / Math.max(1e-4, lum));
    // the beam's own colour (2900 K) is applied by the light colour × albedo tint
    col.multiply(this.fl.light.color);
    return { rho: lum, col };
  }
}
