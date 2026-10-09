// Opening budget cull (AD review, docs/STATUS-opening-rt.md): while the opening drive approaches the house (C1 S8,
// "rooms", 50.4–56.6 s) the yard's dense dressing — the three dead trees (≈ 65 k tris each), the EXT2 shrub/mid
// treeline rows and the groundcover turf chunks — was drawn in full from 70–110 m away: 710 draws / 1.63 M tris on
// Medium (budget 400 / 1.5 M), 1241 / 3.33 M on Max. At that range, at night, in heavy rain, they are invisible:
// fog transmittance e^(−0.0068·90) ≈ 54 % on a surface lit only by the overcast moon (≈ 0.01 lux → ≈ 4e-4 cd/m² at
// albedo 0.12), i.e. black on black behind the bright beam pool. So, while the camera is still far from the house,
// hide each such node whose bounding sphere is more than FAR_M from the camera. Nearer nodes (the verge turf in our
// beams) stay. The house shell, roofs, terrain, far treeline silhouettes and the lantern are never touched.
// Everything is restored the moment the camera comes within NEAR_HOUSE_M of the house or the opening releases it,
// so the house reveal (62 s) and gameplay are unchanged.

// m4 diag (draws by prop at 54 s): the nine yard wrecks (≈ 110 draws) join the distance rule; the house's INTERIOR
// props (wardrobe, stove, guest book, …: `interior` ids from the layout) are hidden outright while the camera is far
// from the house — behind nailed shutters and unlit windows at 70 m+ they cannot contribute a pixel.
const PATTERN = /^(P_TREE_\d+|P_WRECK_\d+|treeline_(shrub|mid)\d+_EXT[12]|groundcover_\w+_EXT2)/;
/** Camera–house distance below which nothing is culled (the reveal camera stands ≈ 30–40 m from the porch). */
const NEAR_HOUSE_M = 70;
/** A node farther than this from the camera is hidden (beam pool ends ≈ 60 m: 15 kcd hot spot → 4 lux at 60 m). */
const FAR_M = 60;

export function createYardCull(root: any, housePlan: [number, number], interior: ReadonlySet<string> = new Set()) {
  let nodes: Array<{ n: any; c: any; r: number }> | null = null;
  const hidden = new Set<any>();
  const collect = () => {
    nodes = [];
    root?.updateMatrixWorld?.(true);
    root?.traverse((o: any) => {
      if (interior.has(o.name)) {
        nodes!.push({ n: o, c: null, r: -1 });
        return;
      }
      if (!PATTERN.test(o.name ?? '')) return;
      // one entry per matched subtree root (the dead trees are groups, the treeline rows meshes)
      for (let p = o.parent; p; p = p.parent) if (PATTERN.test(p.name ?? '')) return;
      let r = 0;
      const c = o.getWorldPosition(o.position.clone());
      o.traverse((m: any) => {
        if (!m.isMesh || !m.geometry) return;
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        const bs = m.geometry.boundingSphere;
        const wc = bs.center.clone().applyMatrix4(m.matrixWorld);
        r = Math.max(r, wc.distanceTo(c) + bs.radius * m.matrixWorld.getMaxScaleOnAxis());
      });
      nodes!.push({ n: o, c, r });
    });
  };
  const restore = () => {
    for (const n of hidden) n.visible = true;
    hidden.clear();
  };
  return {
    /** camPos: world position; active: the opening holds the camera on the road. */
    update(camPos: any, active: boolean, opening = true): void {
      const dHouse = Math.hypot(camPos.x - housePlan[0], camPos.z + housePlan[1]); // world z = −PLAN y
      if (!active) {
        if (hidden.size) restore();
        return;
      }
      if (!nodes) collect();
      // runtime lane D (C1 60.5 / 61.8: 713 draws on Medium, ≈ 150 of them interior props): the opening camera never
      // enters the house, so the interior props stay hidden for as long as it holds the camera — also at the gate
      // (windows unlit, shutters nailed: dr.mjs frame shows no interior pixel). Yard dressing keeps the distance rule.
      const nearHouse = dHouse < NEAR_HOUSE_M;
      for (const e of nodes!) {
        const far = e.r < 0 ? opening || !nearHouse : !nearHouse && e.c.distanceTo(camPos) - e.r > FAR_M;
        if (far && e.n.visible) {
          e.n.visible = false;
          hidden.add(e.n);
        } else if (!far && hidden.has(e.n)) {
          e.n.visible = true;
          hidden.delete(e.n);
        }
      }
    },
    restore,
    stats: () => ({ nodes: nodes?.length ?? 0, hidden: hidden.size }),
  };
}
