// County Road 9 corridor culling (docs/C1-OPENING.md §6.4, §6.6; lead ruling: "cull the corridor instances by
// chunk/distance"). details_corridor.glb ships its instanced pines/understory/snags/reflectors as one node per
// (prototype, LOD, 150 m chunk) with extras { corridor, lod, chunk, s_range }. All of it is ≈ 0.98 M triangles; a
// POV on the road needs the chunks around the car only. Per frame (cheap: ~160 samples of the centreline):
//   - the camera's chainage s and lateral offset from road-rc9.json;
//   - L0 (hero trees, ≈ 1.7 k tris) within 220 m of the camera along the road, L1 within 520 m, L2 (crown cards for
//     the aerial / far walls) within 900 m — or all of them from high above (C0 aerial, z > 40 m);
//   - chunks wholly behind a ground-level camera (beyond 60 m) are hidden.
// Chunk-less corridor nodes (road, paint, canopy blanket, poles, wires) stay as they are.

import * as THREE from 'three/webgpu';
import { worldToPlan } from '../shared/coords.ts';
import { roadFrame } from '../cutscenes/road.ts';

interface Chunk {
  node: any;
  lod: string;
  s0: number;
  s1: number;
  /** Centreline point (PLAN x, y) at the chunk's middle. */
  mid: [number, number];
}

const RANGE: Record<string, number> = { L0: 220, L1: 520, L2: 900 };
const SAMPLES: Array<[number, number, number]> = [];
for (let s = -20; s <= 1550; s += 10) {
  const [x, y] = roadFrame(s);
  SAMPLES.push([s, x, y]);
}

/** Nearest chainage to a PLAN point (10 m samples, refined to ±1 m). */
export function chainageOf(x: number, y: number): { s: number; off: number } {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < SAMPLES.length; i++) {
    const d = (SAMPLES[i][1] - x) ** 2 + (SAMPLES[i][2] - y) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  let s = SAMPLES[best][0];
  for (let k = 0; k < 2; k++) {
    let bs = s;
    for (let ds = -5; ds <= 5; ds += 1) {
      const [fx, fy] = roadFrame(s + ds);
      const d = (fx - x) ** 2 + (fy - y) ** 2;
      if (d < bd) {
        bd = d;
        bs = s + ds;
      }
    }
    s = bs;
  }
  return { s, off: Math.sqrt(bd) };
}

export function createCorridorCuller(root: any) {
  const chunks: Chunk[] = [];
  root?.traverse((n: any) => {
    const e = n.userData ?? {};
    // runtime lane E (item 7): the road, verges and canopy blanket receive the lightning's tree shadows
    if (e.corridor)
      n.traverse((m: any) => {
        if (m.isMesh) m.receiveShadow = true;
      });
    if (!e.corridor || e.chunk === undefined || !Array.isArray(e.s_range)) return;
    // runtime lane E (item 7): the pines and snags cast into the lightning's directional shadow (drawn once per strike,
    // atmosphere.ts) and receive it — C0's aerial flash had no tree shadow at all (a flat sky-coloured wash). L2 crown
    // cards (far / aerial fill) neither cast nor receive.
    const lodTag = String(e.lod ?? 'L1');
    n.traverse((m: any) => {
      if (!m.isMesh) return;
      m.receiveShadow = true;
      if (lodTag !== 'L2') m.castShadow = true;
    });
    const [s0, s1] = e.s_range as [number, number];
    const [x, y] = roadFrame((s0 + s1) / 2);
    chunks.push({ node: n, lod: String(e.lod ?? 'L1'), s0, s1, mid: [x, y] });
  });
  const p = { x: 0, y: 0, z: 0 };
  return {
    count: chunks.length,
    /** camera: three camera (world space). active = a cutscene is on the corridor; otherwise everything is left alone. */
    update(camera: any, active: boolean): void {
      if (!chunks.length) return;
      if (!active) {
        for (const c of chunks) c.node.visible = true; // room culling handles play; the warm-up sees all
        return;
      }
      const w = camera.getWorldPosition(_v);
      const plan = worldToPlan([w.x, w.y, w.z]);
      p.x = plan[0];
      p.y = plan[1];
      p.z = plan[2];
      const aerial = p.z > 40;
      const { s } = chainageOf(p.x, p.y);
      camera.getWorldDirection(_d);
      const fwd = worldToPlan([_d.x, _d.y, _d.z]);
      for (const c of chunks) {
        const near = s < c.s0 ? c.s0 - s : s > c.s1 ? s - c.s1 : 0;
        let on = aerial || near <= (RANGE[c.lod] ?? 520);
        if (on && !aerial && near > 60) {
          const dx = c.mid[0] - p.x;
          const dy = c.mid[1] - p.y;
          const len = Math.hypot(dx, dy) || 1;
          if ((dx * fwd[0] + dy * fwd[1]) / len < -0.35) on = false; // wholly behind the camera
        }
        c.node.visible = on;
      }
    },
    stats: () => ({ chunks: chunks.length, visible: chunks.filter((c) => c.node.visible).length }),
  };
}

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
