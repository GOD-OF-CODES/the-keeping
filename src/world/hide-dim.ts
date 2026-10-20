// FINAL-B (#154, R1-4): the C4 hide view's slats. Inside Ada's wardrobe the U3 night bake and the probe grids are lifted
// × C4_HIDE_LM (c4-hem.ts, bindings.ts tickHideLm: the room's 0.0005 lux to the real 0.003–0.03 lux range, so the room
// reads between the louvres). The wardrobe's own moving parts (the slatted door leaves) are probe-lit: the lifted
// 'upper' grid — interpolated from probes out in the room (warm wallpaper / wood bounce) — lit their INNER faces a warm
// red-brown (hide view at e 24: frame rgb 9.0 / 1.7 / 1.4, mean 3.2, against 0.4 / 0.5 / 1.1 with the grid at 1). Those
// faces look into the wardrobe's black interior and are shadowed by the wardrobe itself: they should stay
// near-silhouettes. So the prop's probe-lit materials get their own diffuse scale uHideDim, which bindings.ts holds at
// 1 / GRADE.lm while the player hides in it (the slats keep their un-lifted light: the cool moonlit edge, black faces)
// and at 1 everywhere else (an identical program; one clone per material, built at load).

import { materialColor, renderGroup, uniform, vec4 } from 'three/tsl';

/** Diffuse scale of the hide prop's probe-lit surfaces (1 = as lit). */
export const uHideDim = uniform(1).setGroup(renderGroup);

/** Clone the prop's probe-lit (non-lightmapped) materials with colour × uHideDim. Call once, before reflections attach. */
export function installHideDim(prop: any, probeLit: any[]): number {
  if (!prop) return 0;
  const clones = new Map<any, any>();
  let meshes = 0;
  const swap = (m: any): any => {
    if (!m || m.isLightmapMaterial || !m.isNodeMaterial) return m;
    let c = clones.get(m);
    if (!c) {
      c = m.clone();
      c.userData = m.userData; // same identity (spec id, wear) as the original, like reflections.ts' variants
      const base = m.colorNode ? vec4(m.colorNode) : materialColor;
      c.colorNode = vec4(base.rgb.mul(uHideDim), base.a);
      probeLit.push(c);
      clones.set(m, c);
    }
    return c;
  };
  prop.traverse((o: any) => {
    if (!o.isMesh) return;
    const before = o.material;
    o.material = Array.isArray(before) ? before.map(swap) : swap(before);
    if (o.material !== before) meshes++;
  });
  return meshes;
}
