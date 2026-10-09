// RUNTIME F2 (docs/RUNTIME-F-PLAN.md F2, lead ruling 2026-10-09): indoor window-portal culling of the exterior rooms.
//
// Inside the house the layout's room PVS lists EXT2 (U1/U2/U3/G1 → EXT2), so every yard mesh inside the 100°-wide view
// frustum was drawn although only a window's worth of the yard can reach the screen — u1-armoire: room_EXT2 = 177 main
// draws / 0.8–0.9 M tris (Medium / Max). From an interior eye, an exterior point is visible only along a ray that
// crosses one of the house's exterior openings (8 in the layout: 7 windows + the front door). Any ray through a hole
// in a wall of thickness t crosses the wall's centre plane inside the hole's rectangle, so the four planes through the
// eye and the (inflated) rectangle edges bound everything visible through it EXACTLY — a mesh whose world bounding
// sphere lies outside every such sub-frustum cannot produce a pixel through that opening.
//
// Culled meshes leave camera layer 0 for WINDOW_CULL_LAYER instead of `visible = false`, so shadow maps that may need
// them keep them: every shadow light whose shadow camera follows the view layers (three r186 ShadowNode.updateShadow
// copies camera.layers when the shadow camera has no bit above 0) gets WINDOW_CULL_LAYER added — the lightning's
// window shadows of the yard trees on the floor stay identical. Lights with explicit caster layers (the headlamps,
// the torch's indoor/outdoor caster layers, F3) keep their own masks. Lights are never touched (Renderer.js 994 tests
// a light's layers against the camera).

import { planToWorld } from '../shared/coords.ts';
import type { LevelLayout } from '../shared/layout-types.ts';

/** Exterior meshes outside every window sub-frustum live on this layer (not rendered by the view camera). */
export const WINDOW_CULL_LAYER = 6;
/** Opening rectangle inflation (m): casing, sash and board edges proud of the wall plane, glass refraction ≈ 0. */
const PORTAL_PAD = 0.15;
/** Bounding-sphere inflation (m): vertex animation (rain-blown foliage cards), stale matrices. */
const SPHERE_PAD = 0.5;
/** An eye closer than this to an opening's wall plane makes its sub-frustum degenerate → that opening shows all. */
const PLANE_EPS = 0.2;

interface Portal {
  room: string;
  /** Corners (world), counter-clockwise or clockwise — orientation fixed per plane against `mid`. */
  p: Array<[number, number, number]>;
  /** Centre (world) and the wall plane's normal pointing INTO the interior room. */
  c: [number, number, number];
  n: [number, number, number];
}

interface Unit {
  m: any;
  /** local bounding sphere centre + radius */
  lc: [number, number, number];
  lr: number;
  culled: boolean;
}

const sub = (a: number[], b: number[]): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: number[], b: number[]): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function buildPortals(layout: LevelLayout): Portal[] {
  const kind = new Map(layout.rooms.map((r) => [r.id, r.kind as string]));
  const isInterior = (s: string) => kind.get(s) === 'interior';
  const out: Portal[] = [];
  for (const w of layout.walls) {
    const li = isInterior(w.left);
    const ri = isInterior(w.right);
    if (li === ri) continue; // interior–interior or exterior–exterior
    const room = li ? w.left : w.right;
    const dx = w.b[0] - w.a[0];
    const dy = w.b[1] - w.a[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // left of a→b (plan, z-up) = (−uy, ux); the interior side's normal in plan
    const nx = li ? -uy : uy;
    const ny = li ? ux : -ux;
    for (const o of w.openings) {
      const cx = w.a[0] + ux * o.offset;
      const cy = w.a[1] + uy * o.offset;
      const hw = o.width / 2 + PORTAL_PAD;
      const z0 = w.base + o.sill - PORTAL_PAD;
      const z1 = w.base + o.sill + o.height + PORTAL_PAD;
      const P = (s: number, z: number) => planToWorld([cx + ux * s, cy + uy * s, z]) as [number, number, number];
      const c = planToWorld([cx, cy, (z0 + z1) / 2]) as [number, number, number];
      const n = planToWorld([nx, ny, 0]) as [number, number, number];
      out.push({ room, p: [P(-hw, z0), P(hw, z0), P(hw, z1), P(-hw, z1)], c, n });
    }
  }
  return out;
}

export function createWindowCull(layout: LevelLayout, roomGroups: Map<string, any>, scene: any) {
  const portals = buildPortals(layout);
  // `?wcull=0` turns it off (A/B frame diffs)
  let disabled = (() => { try { return new URLSearchParams(location.search).get('wcull') === '0'; } catch { return false; } })();
  const exteriorRooms = layout.rooms.filter((r) => r.kind !== 'interior').map((r) => r.id);
  let units: Unit[] | null = null;
  let active = false;
  let culledCount = 0;
  let lightScanAt = -1;
  // per-frame scratch: up to 4 planes × portals (normal xyz + offset)
  const planes = new Float64Array(portals.length * 16);
  const live = new Uint8Array(portals.length);
  const bit = 1 << WINDOW_CULL_LAYER;

  const collect = () => {
    units = [];
    for (const id of exteriorRooms) {
      const g = roomGroups.get(id);
      g?.traverse((m: any) => {
        if (!(m.isMesh || m.isPoints || m.isLine || m.isSprite) || m.isSkinnedMesh) return;
        let bs: any = null;
        if (m.isInstancedMesh || m.isBatchedMesh) {
          if (!m.boundingSphere) m.computeBoundingSphere?.();
          bs = m.boundingSphere;
        } else if (m.geometry) {
          if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
          bs = m.geometry.boundingSphere;
        }
        if (!bs || !Number.isFinite(bs.radius) || bs.radius < 0) return;
        units!.push({ m, lc: [bs.center.x, bs.center.y, bs.center.z], lr: bs.radius, culled: false });
      });
    }
  };

  /** Shadow cameras that follow the view layers also render WINDOW_CULL_LAYER (see the header). */
  const scanLights = () => {
    scene.traverse((o: any) => {
      if (!o.isLight || !o.castShadow || !o.shadow?.camera) return;
      if (o.userData?.windowCullCasters === false) return; // the torch (F3): view-layer casters only
      const L = o.shadow.camera.layers;
      if ((L.mask & ~1 & ~bit) === 0) L.mask |= 1 | bit;
    });
  };

  const setCulled = (u: Unit, c: boolean) => {
    if (u.culled === c) return;
    const L = u.m.layers;
    if (c) {
      if ((L.mask & 1) === 0) return; // someone else took it off the view layer: not ours to manage
      L.mask = (L.mask & ~1) | bit;
      culledCount++;
    } else {
      L.mask = (L.mask & ~bit) | 1;
      culledCount--;
    }
    u.culled = c;
  };

  const restore = () => {
    if (units) for (const u of units) setCulled(u, false);
    active = false;
  };

  return {
    /**
     * eye: world camera position. on: the camera is in an interior room with room culling on. visible: the room
     * PVS (only openings of visible interior rooms can show anything). now: seconds (light rescans).
     */
    update(eye: any, on: boolean, visible: ReadonlySet<string>, now: number): void {
      if (!on || disabled) {
        if (active) restore();
        return;
      }
      if (!units) collect();
      if (!active || now - lightScanAt > 1) {
        scanLights();
        lightScanAt = now;
      }
      active = true;
      const E = [eye.x, eye.y, eye.z];
      let all = false;
      let nLive = 0;
      for (let i = 0; i < portals.length; i++) {
        const P = portals[i]!;
        live[i] = 0;
        if (!visible.has(P.room)) continue;
        const side = dot(sub(E, P.c), P.n);
        if (side < PLANE_EPS) {
          // eye in / beyond the opening's plane: no valid sub-frustum → nothing is culled this frame
          all = true;
          break;
        }
        const far = sub(P.c, E); // a point through the opening, beyond it
        for (let k = 0; k < 4; k++) {
          const a = sub(P.p[k]!, E);
          const b = sub(P.p[(k + 1) & 3]!, E);
          let n = cross(a, b);
          const l = Math.hypot(n[0], n[1], n[2]) || 1;
          n = [n[0] / l, n[1] / l, n[2] / l];
          if (dot(n, far) < 0) n = [-n[0], -n[1], -n[2]];
          const o = i * 16 + k * 4;
          planes[o] = n[0];
          planes[o + 1] = n[1];
          planes[o + 2] = n[2];
          planes[o + 3] = -dot(n, E);
        }
        live[i] = 1;
        nLive++;
      }
      for (const u of units!) {
        if (all) {
          setCulled(u, false);
          continue;
        }
        const e = u.m.matrixWorld.elements;
        const x = e[0] * u.lc[0] + e[4] * u.lc[1] + e[8] * u.lc[2] + e[12];
        const y = e[1] * u.lc[0] + e[5] * u.lc[1] + e[9] * u.lc[2] + e[13];
        const z = e[2] * u.lc[0] + e[6] * u.lc[1] + e[10] * u.lc[2] + e[14];
        const s = Math.sqrt(Math.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2], e[4] * e[4] + e[5] * e[5] + e[6] * e[6], e[8] * e[8] + e[9] * e[9] + e[10] * e[10]));
        const r = u.lr * s + SPHERE_PAD;
        let vis = false;
        if (nLive > 0)
          for (let i = 0; i < portals.length && !vis; i++) {
            if (!live[i]) continue;
            let inside = true;
            for (let k = 0; k < 4; k++) {
              const o = i * 16 + k * 4;
              if (planes[o]! * x + planes[o + 1]! * y + planes[o + 2]! * z + planes[o + 3]! < -r) {
                inside = false;
                break;
              }
            }
            vis = inside;
          }
        setCulled(u, !vis);
      }
    },
    restore,
    /** debug / A/B: false restores every mesh and keeps the cull off. */
    setEnabled(v: boolean): void {
      disabled = !v;
      if (disabled && active) restore();
    },
    stats: () => ({ portals: portals.length, units: units?.length ?? 0, culled: culledCount, active }),
  };
}
