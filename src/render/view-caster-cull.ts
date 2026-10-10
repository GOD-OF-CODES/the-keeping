// PERF review (contract 116): shadow-caster culling against the view frustum (see enableViewCasterCull).
import * as THREE from 'three/webgpu';

/**
 * PERF review (contract 116): view-frustum caster filter for shadow maps whose light is flagged with
 * `enableViewCasterCull` (the torch's spot shadow; the lightning-stroke cube, src/world/lights.ts).
 * A shadow matters only on a receiver the VIEW camera sees (P inside the view frustum F). Its occluder O lies on the
 * segment light L → P, and a plane's signed distance is affine along it, so for each of F's four side planes
 * dist(O) ≥ min(dist(P), dist(L)) ≥ min(0, dist(L)): a caster whose bounding sphere lies further outside any side
 * plane than min(0, dist(L)) (+ pad) can't shadow a visible pixel. Measured: the torch's 90° / 18 m frustum reached
 * through floor slabs and walls into other rooms (C2c 6.83 Medium = 218 draws of G1/G2/U2 props). A map that is not
 * redrawn every frame (the stroke cube: once per pulse onset) gets `fovPadDeg` of extra view angle for camera turns
 * until its next redraw. Exact for the frame it's drawn in; CubeCamera faces (reflection captures), non-perspective
 * cameras and skinned / instanced / unculled meshes fall back to three's own set. `?torchcull=0` = off (A/B).
 * r186: ShadowNode.updateShadow calls this.getShadowRenderObjectFunction(renderer, shadow) once per update
 * (ShadowNode.js 689, ShadowBaseNode.js 204; PointShadowNode inherits both) — re-verify on a three upgrade.
 */
const VIEW_CASTER_CULL = typeof location === 'undefined' || new URLSearchParams(location.search).get('torchcull') !== '0';
const VIEW_CULL_PAD = 0.15; // m: penumbra / PCF radius, bounding-sphere slack
interface ViewCullCfg {
  fovPadDeg: number;
  st: { u: number; v: number; cut: number; other: number };
}
const viewCull = new WeakMap<object, ViewCullCfg>();
/**
 * Scope gate: the cull runs only while `on` (set by src/cutscenes/bindings.ts for the cutscenes it was verified in —
 * C2c). R38: in C5 (t > 7, 34° telephoto at the parlor threshold) it lost torch shadows (still lum 19 → 32) for a
 * reason not yet isolated, so it is NOT a general gameplay/cutscene optimisation until that is understood.
 */
export const VIEW_CULL_SCOPE = { on: false };
let viewCullPatched = false;
export function enableViewCasterCull(light: any, fovPadDeg = 0): void {
  if (!VIEW_CASTER_CULL || !light) return;
  // debug counters (light.userData.viewCull): updates, main-view updates, culled casters, other cameras
  const stats = (light.userData.viewCull = { u: 0, v: 0, cut: 0, other: 0 });
  viewCull.set(light, { fovPadDeg, st: stats });
  if (viewCullPatched) return;
  const SN = (THREE as any).ShadowNode?.prototype;
  const SB = (THREE as any).ShadowBaseNode?.prototype;
  if (!SN?.updateShadow || !SB?.getShadowRenderObjectFunction) return;
  viewCullPatched = true;
  const fr = new THREE.Frustum();
  const m = new THREE.Matrix4();
  const sph = new THREE.Sphere();
  const lp = new THREE.Vector3();
  const tmpCam = new THREE.PerspectiveCamera();
  const lim = new Float64Array(4);
  let activeShadow: any = null;
  let st: ViewCullCfg['st'] | null = null;
  let dbg: any = null;
  const wrapped = new WeakMap<object, any>();
  const pass = (o: any): boolean => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.frustumCulled === false || !o.geometry) return true;
    const g = o.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    if (!g.boundingSphere || !Number.isFinite(g.boundingSphere.radius)) return true;
    sph.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
    for (let i = 0; i < 4; i++)
      if (fr.planes[i]!.distanceToPoint(sph.center) < lim[i]! - sph.radius) {
        st!.cut++;
        if (dbg) dbg.cut.push(String(o.name || o.parent?.name || '?').slice(0, 28));
        return false;
      }
    return true;
  };
  const upd = SN.updateShadow;
  SN.updateShadow = function (this: any, frame: any) {
    const cfg = this.light ? viewCull.get(this.light) : undefined;
    if (!cfg || !VIEW_CULL_SCOPE.on) return upd.call(this, frame);
    const cam = frame?.camera;
    cfg.st.u++;
    // the view camera: any perspective camera except a CubeCamera face (reflection captures)
    if (!cam?.isPerspectiveCamera || cam.parent?.isCubeCamera) {
      cfg.st.other++;
      return upd.call(this, frame);
    }
    let c = cam;
    if (cfg.fovPadDeg > 0) {
      tmpCam.copy(cam, false);
      tmpCam.fov = Math.min(170, cam.fov + cfg.fovPadDeg);
      tmpCam.updateProjectionMatrix();
      c = tmpCam;
    }
    m.multiplyMatrices(c.projectionMatrix, cam.matrixWorldInverse);
    fr.setFromProjectionMatrix(m); // side planes 0–3 are the same in either clip-space convention
    this.light.getWorldPosition(lp);
    for (let i = 0; i < 4; i++) lim[i] = Math.min(0, fr.planes[i]!.distanceToPoint(lp)) - VIEW_CULL_PAD;
    activeShadow = this.shadow || this.light.shadow;
    st = cfg.st;
    cfg.st.v++;
    // ?debug probe (window.__vcDebug = true): the last update's camera + culled names
    dbg = (globalThis as any).__vcDebug ? { cam: cam.uuid.slice(0, 8), name: cam.name, fov: cam.fov, pos: cam.position.toArray(), parent: cam.parent?.type ?? null, lim: Array.from(lim), lp: lp.toArray(), cut: [] as string[] } : null;
    (cfg.st as any).last = dbg;
    try {
      return upd.call(this, frame);
    } finally {
      activeShadow = null;
    }
  };
  const gsf = SB.getShadowRenderObjectFunction;
  SB.getShadowRenderObjectFunction = function (this: any, renderer: any, shadow?: any) {
    const f = gsf.call(this, renderer, shadow);
    if (!activeShadow || (shadow ?? this.light?.shadow) !== activeShadow) return f;
    let w = wrapped.get(f);
    if (!w) {
      w = (o: any, ...a: any[]) => {
        if (pass(o)) f(o, ...a);
      };
      wrapped.set(f, w);
    }
    return w;
  };
}

export function disableViewCasterCull(light: any): void {
  if (light) viewCull.delete(light);
}
