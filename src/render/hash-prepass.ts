// PERF smoothness (#143, ROADMAP ruling (am) item 3 — the C2 parlor judder): a DEPTH PRE-PASS for alpha-hashed meshes.
//
// Measured (scratch/smooth-perf/cp/cp-med-split.json, Medium 0.75, fenced gpuFrameMs, same frozen C2 frame per row):
// hiding the ONE alpha-hashed mesh (Ada's wet hair cards, src/characters/loader.ts alphaHash + skin.ts HairLightingModel)
// drops the frame from 22.1 → 12.1 ms at C2 9.5 (the held head), 21.1 → 11.5 at 12.5, 20.0 → 11.7 at 14.0 and
// 22.5 → 18.2 at 3.0. An alpha-hashed fragment DISCARDS, so the GPU cannot reject hidden fragments before shading
// (no hidden-surface removal for discard shaders): every one of the overlapping card layers ran the full strand
// lighting (R / TRT / TT lobes × every light of the character light list + probes + shadows).
//
// The pre-pass draws the same geometry first with a depth-only material (colour writes off, the SAME opacity node and
// alpha hash), so the depth buffer holds the nearest SURVIVING hair fragment of every pixel. The hair's own pass then
// tests against it (depthWrite off, LessEqual): only that fragment (and nearer ones its hash discards) is shaded.
// Result = the nearest surviving fragment's colour — what the single pass produced (depth write + LessEqual keeps the
// nearest survivor). The pre-pass sits ≤ 2 depth units behind (polygon offset) so the two programs' depth rounding
// can never reject the survivor itself. Shadows are untouched (the pre-pass casts none; the hair keeps casting).
//
// Pure three r186 API: SkinnedMesh.bind (shared skeleton + bind matrix), Material.colorWrite / depthWrite /
// polygonOffset (WebGPUPipelineUtils: writeMask None, depthBias / depthBiasSlopeScale), alphaHash (NodeMaterial
// setupDiffuseColor: diffuseColor.a < hash(positionLocal) → discard), opacityNode, layers.

import * as THREE from 'three/webgpu';

export interface HashPrepass {
  /** Meshes that got a pre-pass. */
  readonly count: number;
  /** A/B (QA): false = the old single pass (pre-pass hidden, hair depthWrite back on). Rebuilds the hair's pipelines. */
  setEnabled(on: boolean): void;
  readonly enabled: boolean;
}

/** The installed pre-pass (QA: `__game.hashPrepass()`), null before load / with `?hairpre=0`. */
export const HASH_PREPASS: { current: HashPrepass | null } = { current: null };

/** `?hairpre=0` = never install (A/B of the old path from load). */
export function hashPrepassOff(): boolean {
  try {
    return /[?&]hairpre=0\b/.test(location.search);
  } catch {
    return false;
  }
}

/**
 * Adds a depth pre-pass under every visible-or-not mesh in `root` whose single material is alpha-hashed and opaque.
 * Call once, after the characters' materials are final (skin.ts) and before the load warm-up compiles them.
 */
export function installHashPrepass(root: any, scene: any): HashPrepass {
  const pairs: Array<{ mesh: any; pre: any; mat: any; depthWrite: boolean }> = [];
  const targets: any[] = [];
  root.traverse((o: any) => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    const m = o.material;
    if (!m || m.alphaHash !== true || m.transparent === true || !m.isNodeMaterial) return;
    targets.push(o);
  });
  const preMats = new Map<any, any>();
  for (const mesh of targets) {
    const m = mesh.material;
    let pm = preMats.get(m);
    if (!pm) {
      pm = new THREE.MeshBasicNodeMaterial();
      pm.name = `${m.name || 'alphahash'}-prepass`;
      pm.colorWrite = false;
      pm.depthWrite = true;
      pm.depthTest = true;
      pm.side = m.side;
      pm.alphaHash = true;
      // the same coverage as the colour pass: its opacity node (texture alpha × the face-veil mask) and opacity
      pm.opacityNode = m.opacityNode ?? null;
      pm.opacity = m.opacity;
      if (m.alphaMap) pm.alphaMap = m.alphaMap;
      if (m.positionNode) pm.positionNode = m.positionNode;
      pm.polygonOffset = true;
      pm.polygonOffsetFactor = 1;
      pm.polygonOffsetUnits = 2;
      pm.fog = false;
      preMats.set(m, pm);
    }
    let pre: any;
    if (mesh.isSkinnedMesh) {
      pre = new THREE.SkinnedMesh(mesh.geometry, pm);
      pre.bindMode = mesh.bindMode;
      pre.bind(mesh.skeleton, mesh.bindMatrix);
    } else pre = new THREE.Mesh(mesh.geometry, pm);
    if (mesh.morphTargetInfluences) {
      pre.morphTargetInfluences = mesh.morphTargetInfluences;
      pre.morphTargetDictionary = mesh.morphTargetDictionary;
    }
    pre.name = `${mesh.name || 'mesh'}-prepass`;
    pre.castShadow = false;
    pre.receiveShadow = false;
    pre.frustumCulled = mesh.frustumCulled;
    pre.renderOrder = mesh.renderOrder - 1; // opaque list: renderOrder first (painterSortStable) → before the hair
    pre.layers.mask = mesh.layers.mask;
    pre.userData.hashPrepass = true;
    mesh.add(pre); // identity local transform: the hair's own matrixWorld
    pairs.push({ mesh, pre, mat: m, depthWrite: m.depthWrite });
  }
  let enabled = false;
  const apply = (on: boolean) => {
    enabled = on && pairs.length > 0;
    const mats = new Set<any>();
    for (const p of pairs) {
      p.pre.visible = enabled;
      mats.add(p.mat);
    }
    for (const m of mats) {
      const dw = pairs.find((p) => p.mat === m)!.depthWrite;
      const want = enabled ? false : dw;
      if (m.depthWrite !== want) {
        m.depthWrite = want;
        m.needsUpdate = true;
      }
    }
  };
  // a later material swap on a hair mesh (none today) must not leave a stale depth mask behind: the pre-pass follows
  // only while the mesh still draws the material it was built for
  if (pairs.length) {
    const prev = scene.onBeforeRender;
    scene.onBeforeRender = function (renderer: any, sc: any, camera: any, rt: any) {
      if (enabled) for (const p of pairs) p.pre.visible = p.mesh.material === p.mat;
      return prev.call(this, renderer, sc, camera, rt);
    };
  }
  apply(true);
  const api: HashPrepass = {
    count: pairs.length,
    setEnabled: apply,
    get enabled() {
      return enabled;
    },
  };
  HASH_PREPASS.current = api;
  return api;
}
