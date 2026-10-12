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
import * as THREE from 'three/webgpu';

const PATTERN = /^(P_TREE_\d+|P_WRECK_\d+|treeline_(shrub|mid)\d+_EXT[12]|groundcover_\w+_EXT2)/;
/** Camera–house distance below which nothing is culled (the reveal camera stands ≈ 30–40 m from the porch). */
const NEAR_HOUSE_M = 70;
/** A node farther than this from the camera is hidden (beam pool ends ≈ 60 m: 15 kcd hot spot → 4 lux at 60 m). */
const FAR_M = 60;
/** GLITCH-FIX: County Road 9's surface meshes (details_corridor.glb: rc9_road 5 prims / 13.1 k tris, rc9_paint 1 / 1 k). */
const SURFACE = /^(rc9_road|rc9_paint)$/;
/** GLITCH-FIX: a camera jump this large between two frames is a CUT (the car at 19 m/s covers 4.75 m in a 250 ms
 *  hitch; C1's shot changes jump 20–90 m). */
const CUT_M = 6;

export function createYardCull(root: any, housePlan: [number, number], interior: ReadonlySet<string> = new Set()) {
  let nodes: Array<{ n: any; c: any; r: number }> | null = null;
  const hidden = new Set<any>();
  const collect = () => {
    nodes = [];
    root?.updateMatrixWorld?.(true);
    root?.traverse((o: any) => {
      // runtime E review (c1dc: C1 60.5 = 432 renderer draws on Medium, 36 of them the 9 doors): the 8 interior doors
      // and their boards sit behind walls / unlit windows from the road like the interior props; only D_FRONT faces out.
      const ud = o.userData;
      const interiorDoor = (ud?.kind === 'door' || ud?.kind === 'door_board') && ud.doorId && ud.doorId !== 'D_FRONT';
      if (interior.has(o.name) || interiorDoor) {
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
  // runtime lane E (item 4, ruling b): County Road 9's set (corridor chunks, road dressing, truck) is occluded by the yard
  // treeline + fog once the opening camera is at the house: hiding it at C1 58 / 60.5 / 61.8 changes the frame by
  // 2.2 / 0.6 / 0.7 mean (8-bit, 160 px) against a frame-to-frame noise of 1.6 / 0.6 / 0.9 (scratch/re/occ2), while at
  // 55 s (camera 76 m out) it is visible (4.6). The room group's `visible` is masked through an accessor so the level's
  // own room culling keeps writing its value underneath.
  let rc9: any = null;
  let rc9Off = false;
  // GLITCH-FIX (user 2026-10-11: "the end of the car ride in the first cut scene has the glitch of road disappearing
  // and re appearing"; scratch/glitchfix/c1before): the mask above hid the WHOLE room_RC9 group — the County Road 9
  // SURFACE included (rc9_road x 20–1496 m, rc9_paint): mid-shot in S8 (the POV crossed 70 m from the house at C1
  // ≈ 54.6 s, the road under the moving car vanished), under the car rolling to the gate in S9, and it came back at
  // 69.0 (car_mount off → the cull released) only to go again at the hand-off (EXT1's PVS has no RC9). Two rules now:
  //  1. the road surface + paint (6 draws, 14 k tris) leave room_RC9 for their own group, drawn whenever the viewer is
  //     OUTDOORS (cutscene or gameplay: CP1 looking back down the road no longer ends at the EXT1 strip's x = 20 m
  //     edge) and never indoors — the rc9 mask and the room PVS no longer touch them;
  //  2. the mask (the corridor's tree chunks, poles, canopy blanket, road props) only changes on a CUT (the camera
  //     jumps > CUT_M between two frames), never inside a continuous shot.
  const surface = new THREE.Group();
  surface.name = 'rc9_surface';
  {
    const room = root?.getObjectByName?.('room_RC9') ?? null;
    const move: any[] = [];
    room?.traverse((o: any) => {
      if (o !== room && SURFACE.test(o.name ?? '')) move.push(o);
    });
    if (move.length) {
      root.add(surface);
      root.updateMatrixWorld?.(true);
      for (const o of move) surface.attach(o);
    }
  }
  let latched: boolean | null = null;
  const lastCam = new THREE.Vector3(Infinity, 0, 0);
  const rc9Mask = (off: boolean) => {
    if (!rc9) {
      rc9 = root?.getObjectByName?.('room_RC9') ?? null;
      if (!rc9) return;
      let base = rc9.visible;
      Object.defineProperty(rc9, 'visible', {
        configurable: true,
        enumerable: true,
        get: () => base && !rc9Off,
        set: (v: boolean) => {
          base = v;
        },
      });
    }
    rc9Off = off;
  };
  const restore = () => {
    for (const n of hidden) n.visible = true;
    hidden.clear();
    rc9Mask(false);
    latched = null;
    lastCam.set(Infinity, 0, 0);
  };
  return {
    /** camPos: world position; active: the opening holds the camera on the road. */
    update(camPos: any, active: boolean, opening = true): void {
      const dHouse = Math.hypot(camPos.x - housePlan[0], camPos.z + housePlan[1]); // world z = −PLAN y
      if (!active) {
        if (hidden.size || latched !== null) restore();
        return;
      }
      if (!nodes) collect();
      // runtime lane D (C1 60.5 / 61.8: 713 draws on Medium, ≈ 150 of them interior props): the opening camera never
      // enters the house, so the interior props stay hidden for as long as it holds the camera — also at the gate
      // (windows unlit, shutters nailed: dr.mjs frame shows no interior pixel). Yard dressing keeps the distance rule.
      // GLITCH-FIX: the near/far decision is taken on the first held frame and on cuts only (see rule 2 above)
      const cut = latched === null || camPos.distanceTo(lastCam) > CUT_M;
      lastCam.copy(camPos);
      if (cut) latched = dHouse < NEAR_HOUSE_M;
      const nearHouse = latched as boolean;
      rc9Mask(nearHouse);
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
    /** GLITCH-FIX rule 1: the road surface is drawn whenever the viewer is outdoors (per frame, cutscene or play). */
    surface(outdoors: boolean): void {
      if (surface.visible !== outdoors) surface.visible = outdoors;
    },
    stats: () => ({ nodes: nodes?.length ?? 0, hidden: hidden.size, near: latched, rc9Off, surface: surface.visible ? surface.children.length : 0 }),
  };
}
