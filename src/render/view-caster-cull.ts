// PERF (contract 116, fix round 3 ruling (q)): shadow-caster culling against the view frustum, by SHADOW CONE.
import * as THREE from 'three/webgpu';

/**
 * Contract 116 (rewritten fix round 3, lead ruling (q)): view-frustum caster filter for shadow maps whose light is
 * flagged with `enableViewCasterCull` (the torch's spot shadow, src/render/flashlight.ts).
 * A caster matters only if its SHADOW can land on a receiver the VIEW camera sees. Every point its shadow can reach is
 * on a ray from the light L through the caster's bounding sphere S(C, r), beyond the caster and no further than the
 * shadow camera's reach D (far / cos of the corner half-angle: far·√(1 + 2·tan²(fov/2)) for the square spot map). On
 * such a ray a plane's signed distance is affine, so it is bounded by its two ends: the near end lies in S, the far end
 * in the sphere S_F centred on L + D·û (û = (C − L)/|C − L|) with radius D·tan α, sin α = r / |C − L| (the cone through
 * S, widened). If both S and S_F lie wholly outside the SAME one of the view frustum's four side planes (beyond a pad
 * for PCF / penumbra / normal bias), no visible pixel can be shadowed by the caster and its shadow draw is skipped.
 * The light inside or touching S, a non-perspective shadow camera, or a caster beyond D → always cast. Skinned /
 * instanced / batched / morphed / vertex-displaced (positionNode, castShadowPositionNode) / frustumCulled=false meshes
 * always cast (their geometry bounds don't bound what they draw). CubeCamera faces and non-perspective cameras use
 * three's own caster set. Debug: `?torchcull=0` = off at load; `window.__vcMode = 'off' | 'force' | 'old'` at runtime
 * (A/B: off ignores the scope, force culls outside it, old = the fix-round-1 bound, for the C5 investigation); `window.__vcDebug = true` keeps the last update's culled names.
 * History: the fix-round-1 version bounded the caster by min(0, dist(L)) per plane (no far-plane reach); it was scoped
 * to C2c after the C5 shadow-play still brightened (R38–R39); the cause is logged in docs/STATUS-perf-g.md (fix round 3).
 * r186: ShadowNode.updateShadow calls this.getShadowRenderObjectFunction(renderer, shadow) once per update
 * (ShadowNode.js 689, ShadowBaseNode.js 204; PointShadowNode inherits both), updateBefore is per render & camera
 * (ShadowBaseNode.js 161, ShadowNode.js 804) — re-verify on a three upgrade.
 */
const VIEW_CASTER_CULL = typeof location === 'undefined' || new URLSearchParams(location.search).get('torchcull') !== '0';
const VIEW_CULL_PAD = 0.15; // m: PCF radius / penumbra / bias slack around both cone ends
interface ViewCullCfg {
  fovPadDeg: number;
  st: { u: number; v: number; cut: number; other: number };
}
const viewCull = new WeakMap<object, ViewCullCfg>();
/** Scope gate: the cull runs only while `on` (src/cutscenes/bindings.ts TORCH_CULL_IDS — the cutscenes it was A/B'd in)
 *  or `play` (PERF2 BUDGETS #150b: gameplay frames, set by src/game/main.ts world(); `?torchcullplay=0` = off). */
export const VIEW_CULL_SCOPE = { on: false, play: false };
let viewCullPatched = false;

/** Pure test (exported for tests): may a caster sphere (c, r) shadow anything inside the planes? planes = [nx, ny, nz, w]
 *  with inside = n·p + w ≥ 0; L = light position; reach = the shadow camera's longest ray; pad = slack (m). */
export function coneMayShadow(planes: ArrayLike<number>[], L: ArrayLike<number>, c: ArrayLike<number>, r: number, reach: number, pad: number): boolean {
  const ux = c[0]! - L[0]!, uy = c[1]! - L[1]!, uz = c[2]! - L[2]!;
  const d = Math.hypot(ux, uy, uz);
  if (!(d > r + 1e-4) || d - r >= reach) return true;
  const k = reach / d;
  const fx = L[0]! + ux * k, fy = L[1]! + uy * k, fz = L[2]! + uz * k;
  const rf = (reach * r) / Math.sqrt(d * d - r * r);
  for (const p of planes) {
    const dn = p[0]! * c[0]! + p[1]! * c[1]! + p[2]! * c[2]! + p[3]!;
    if (dn + r >= -pad) continue;
    const df = p[0]! * fx + p[1]! * fy + p[2]! * fz + p[3]!;
    if (df + rf < -pad) return false;
  }
  return true;
}

export function enableViewCasterCull(light: any, fovPadDeg = 0): void {
  if (!VIEW_CASTER_CULL || !light) return;
  // debug counters (light.userData.viewCull): updates, view-camera updates, culled casters, other cameras
  const stats = (light.userData.viewCull = { u: 0, v: 0, cut: 0, other: 0 });
  viewCull.set(light, { fovPadDeg, st: stats });
  // QA (scratch/pgr3/ab-lib.mjs, same-state A/B renders): three has no global in the page
  light.userData.viewCullQA = { RenderTarget: THREE.RenderTarget, HalfFloatType: THREE.HalfFloatType };
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
  const planes = [new Float64Array(4), new Float64Array(4), new Float64Array(4), new Float64Array(4)];
  const L = new Float64Array(3);
  const C = new Float64Array(3);
  let reach = 0;
  let oldMode = false;
  let activeShadow: any = null;
  let st: ViewCullCfg['st'] | null = null;
  let dbg: any = null;
  const wrapped = new WeakMap<object, any>();
  const displaced = (mat: any): boolean => {
    if (Array.isArray(mat)) return mat.some(displaced);
    return !!mat && !!(mat.positionNode || mat.castShadowPositionNode || mat.displacementMap);
  };
  const pass = (o: any): boolean => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.isBatchedMesh || o.frustumCulled === false || !o.geometry) return true;
    // PERF review fix round 3 (contract #128): meshes flagged torchNoShadow (the EXT2 terrain tiles, src/world/level.ts)
    // never cast into the in-scope torch map. Their bounding spheres contain the torch, so the cone test must keep them,
    // yet an indoor torch can't put a terrain shadow on anything the view sees: same-state A/B over all 834 C2c frames
    // (scratch/pgr4/ab-c2c-t.mjs, terrain casters off vs on) = 4 frames of 1–2 px, the renderer's own flicker class.
    if (o.userData?.torchNoShadow === true && !oldMode && (globalThis as any).__vcOnly === undefined) {
      st!.cut++;
      return false;
    }
    const g = o.geometry;
    if (g.morphAttributes?.position?.length || displaced(o.material)) return true;
    // a rebuilt position attribute (blood fx, tubes) makes a cached sphere stale: recompute when its version moved
    const pa = g.attributes?.position;
    if (!pa) return true;
    const pv = pa.version ?? pa.data?.version ?? 0; // InterleavedBufferAttribute: its buffer's version
    if (!g.boundingSphere || (g.userData.vcPosVersion ?? 0) !== pv) g.computeBoundingSphere();
    g.userData.vcPosVersion = pv;
    if (!g.boundingSphere || !Number.isFinite(g.boundingSphere.radius)) return true;
    sph.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
    C[0] = sph.center.x;
    C[1] = sph.center.y;
    C[2] = sph.center.z;
    if (oldMode) {
      // debug A/B only ('old'): the fix-round-1 bound — sphere beyond min(0, dist(L)) of one side plane
      let keep = true;
      for (const p of planes) {
        const dn = p[0]! * C[0]! + p[1]! * C[1]! + p[2]! * C[2]! + p[3]!;
        const dl = p[0]! * L[0]! + p[1]! * L[1]! + p[2]! * L[2]! + p[3]!;
        if (dn < Math.min(0, dl) - VIEW_CULL_PAD - sph.radius) keep = false;
      }
      if (keep) return true;
    } else if (coneMayShadow(planes, L, C, sph.radius, reach, VIEW_CULL_PAD)) return true;
    const only = (globalThis as any).__vcOnly; // debug bisection: cull just this object id
    if (only !== undefined && only !== o.id) return true;
    st!.cut++;
    if (dbg) dbg.cut.push(dbg.full ? { n: String(o.name || o.parent?.name || '?').slice(0, 28), id: o.id, c: [C[0], C[1], C[2]], r: sph.radius } : String(o.name || o.parent?.name || '?').slice(0, 28));
    return false;
  };
  const upd = SN.updateShadow;
  SN.updateShadow = function (this: any, frame: any) {
    const cfg = this.light ? viewCull.get(this.light) : undefined;
    const mode = (globalThis as any).__vcMode;
    if (!cfg || mode === 'off' || (!VIEW_CULL_SCOPE.on && !VIEW_CULL_SCOPE.play && mode !== 'force' && mode !== 'old')) return upd.call(this, frame);
    const cam = frame?.camera;
    const shadow = this.shadow || this.light.shadow;
    const scam = shadow?.camera;
    cfg.st.u++;
    // the view camera: any perspective camera except a CubeCamera face (reflection captures); perspective shadows only
    if (!cam?.isPerspectiveCamera || cam.parent?.isCubeCamera || !scam?.isPerspectiveCamera) {
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
    for (let i = 0; i < 4; i++) {
      const p = fr.planes[i]!;
      planes[i]![0] = p.normal.x;
      planes[i]![1] = p.normal.y;
      planes[i]![2] = p.normal.z;
      planes[i]![3] = p.constant;
    }
    this.light.getWorldPosition(lp);
    L[0] = lp.x;
    L[1] = lp.y;
    L[2] = lp.z;
    // longest ray of the square shadow frustum: to a far-plane corner (aspect 1 spot map)
    const th = Math.tan(THREE.MathUtils.degToRad(scam.fov) / 2);
    reach = scam.far * Math.sqrt(1 + th * th * (1 + scam.aspect * scam.aspect));
    oldMode = mode === 'old';
    activeShadow = shadow;
    st = cfg.st;
    cfg.st.v++;
    dbg = (globalThis as any).__vcDebug ? { cam: cam.uuid.slice(0, 8), name: cam.name, fov: cam.fov, pos: cam.position.toArray(), parent: cam.parent?.type ?? null, lp: lp.toArray(), reach, planes: planes.map((p) => Array.from(p)), full: (globalThis as any).__vcDebug === 'full', cut: [] as any[] } : null;
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
        if (!activeShadow || pass(o)) f(o, ...a);
      };
      wrapped.set(f, w);
    }
    return w;
  };
}

export function disableViewCasterCull(light: any): void {
  if (light) viewCull.delete(light);
}
