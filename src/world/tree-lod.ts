// Runtime lane D (item 4, docs/STATUS-blender-c.md §8): far LOD for the three hero yard trees (P_TREE_1..3).
//
// The GLB ships ONE node per tree (≈ 64.4–64.8k tris on Medium/Max). blender/props/build_props.py makes Low's mesh by
// deleting every face ≥ `lod_twig_from` (the twig/spur tail); that cut is an exact triangle PREFIX of the Medium/Max
// index buffer (verified on all three trees, scratch/rd/treecmp.mjs: 255/255, 276/276, 247/247 sampled triangles
// identical, triangle order preserved through the meshopt export). So the far LOD is just geometry.drawRange —
// no second mesh, no download, no shader variant, no pipeline compile.
//
// Switch distance: at 35 m a 1.8 mm twig projects to 0.03 px and a 12 mm spur to 0.2 px (600 px / 60° vFOV), so
// dropping them is below a pixel; 3 m hysteresis (in at 32 m, out at 35 m) keeps a camera hovering at the edge from
// toggling every frame. The prefix triangle counts (= Low's triangle counts) are keyed by the full index count, so a
// re-exported tree whose mesh changed simply gets no LOD until the table is updated (request: an `lod_twig_tris` extra).

import * as THREE from 'three/webgpu';

const FAR_IN_M = 35;
const FAR_OUT_M = 32;

/** full triangle count → trunk + limbs prefix (Low's triangles), per tree; public/assets/{medium,max}/props_m*.glb */
const PREFIX: Record<string, Record<number, number>> = {
  P_TREE_1: { 64749: 24717 },
  P_TREE_2: { 64780: 26716 },
  P_TREE_3: { 64412: 23870 },
};

export interface TreeLod {
  /** Trees that got a far LOD (debug / QA). */
  readonly count: number;
}

/** Installs the drawRange far LOD on the hero trees (no-op on Low, whose mesh already is the prefix). */
export function installTreeLod(prop: (id: string) => any | null): TreeLod {
  let count = 0;
  for (const [id, table] of Object.entries(PREFIX)) {
    const root = prop(id);
    if (!root) continue;
    root.traverse((o: any) => {
      if (!o.isMesh || !o.geometry?.index) return;
      const tris = o.geometry.index.count / 3;
      const near = table[tris];
      if (!near) return;
      const geo = o.geometry;
      const fullCount = geo.index.count;
      const farCount = near * 3;
      const centre = new THREE.Vector3();
      const eye = new THREE.Vector3();
      let far = false;
      // onBeforeRender runs before the renderer reads geometry.drawRange for this draw (Renderer.renderObject,
      // r186); the shadow passes see their own camera, which is what decides what that map can resolve too.
      o.onBeforeRender = (_r: any, _s: any, camera: any) => {
        o.getWorldPosition(centre);
        const d = centre.distanceTo(eye.setFromMatrixPosition(camera.matrixWorld));
        const want = far ? d > FAR_OUT_M : d > FAR_IN_M;
        if (want !== far) {
          far = want;
          geo.drawRange.count = far ? farCount : fullCount;
        }
      };
      count++;
    });
  }
  return { count };
}
