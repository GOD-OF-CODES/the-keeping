// RENDER TEST ROOM — the default scene until the real level ships (also ?scene=test).
// A code-built ~5 × 6 × 3 m room (window on the north wall, door on the east wall into a dark hallway), stand-in
// furniture, simple procedural TSL materials, and a CPU-generated fake irradiance lightmap on uv1 per surface,
// rendered through LightmapMaterial (the same path the Blender lightmaps will use).
//
// Light budget (no double counting):
//   - Moonlight through the window: BAKED only (lightmap area light + a window-shaped directional patch).
//   - Candles: "mixed" lights — DIRECT is realtime (flickering PointLights, no shadows), their BOUNCE is baked
//     (a soft warm term in the lightmap). The lightmap never contains candle direct light.
//   - Flashlight: realtime only (shadowed SpotLight + cookie).
//   - Lightning: Max → additive flash lightmap (uLightning) for lightmapped surfaces + a realtime spot for dynamic
//     objects; other presets → the realtime spot lights everything.
//   - Dynamic / non-lightmapped objects (furniture, door leaf, hallway) are lit by the baked LightProbeGrid plus the
//     realtime lights; lightmapped materials exclude the grid via lightsNode (see probes.ts).
// World space: three.js Y-up (x = east, −z = north). Room interior x ∈ [−2.5, 2.5], z ∈ [−3, 3], y ∈ [0, 3].

import * as THREE from 'three/webgpu';
import { Fn, abs, float, floor, fract, hash, mix, mx_fractal_noise_float, mx_noise_float, positionWorld, smoothstep, step, uniform, uv, vec3 } from 'three/tsl';
import { LIGHTMAP_FLIP_V, LIGHTMAP_MULTIPLIER, LightmapMaterial, prepareLightmapTexture, uLightning } from '../render/lightmap-material.ts';
import type { PresetConfig } from '../render/presets.ts';

type V3 = [number, number, number];

export const ROOM = { minX: -2.5, maxX: 2.5, minZ: -3, maxZ: 3, height: 3 } as const;
const WINDOW = { x0: -0.6, x1: 0.6, y0: 0.9, y1: 2.2, z: -3, mullionX: 0, mullionY: 1.55, mullionHalf: 0.03 } as const;
const DOOR = { z0: -0.2, z1: 0.7, h: 2.1, x: 2.5 } as const;

// ---------------------------------------------------------------- CPU "bake" (fake irradiance) ----------------

interface Candle {
  pos: V3;
  intensity: number; // candela (nominal)
}

interface Footprint {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  inside: number; // occlusion factor under the object
}

const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a: V3): V3 => scale3(a, 1 / Math.hypot(a[0], a[1], a[2]));
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const MOON_L: V3 = [0.16, 0.2, 0.3]; // window radiance (linear)
const MOON_DIR = norm3([0.22, -0.62, 1]); // travel direction of the moonbeam
const MOON_E: V3 = [0.5, 0.6, 0.85]; // irradiance of the patch
const FLASH_L: V3 = [3.2, 3.6, 4.4];
const FLASH_DIR = norm3([-0.3, -0.72, 1]);
const FLASH_E: V3 = [9, 10, 12];
const AMBIENT: V3 = [0.018, 0.019, 0.024];

function roomAO(p: V3, n: V3, footprints: Footprint[]): number {
  let f = 1;
  const planes = [p[1] - 0, ROOM.height - p[1], p[0] - ROOM.minX, ROOM.maxX - p[0], p[2] - ROOM.minZ, ROOM.maxZ - p[2]];
  for (const s of planes) if (s > 1e-3) f *= 1 - 0.42 * Math.exp(-s / 0.28);
  if (n[1] > 0.5 && p[1] < 0.01) {
    for (const r of footprints) {
      const dx = Math.max(r.x0 - p[0], 0, p[0] - r.x1);
      const dz = Math.max(r.z0 - p[2], 0, p[2] - r.z1);
      const d = Math.hypot(dx, dz);
      f *= d === 0 ? r.inside : 1 - 0.5 * Math.exp(-d / 0.1);
    }
  }
  return f;
}

/** Window-shaped directional patch (with mullion shadows), sampled 2×2 over the texel footprint. */
function windowPatch(p: V3, n: V3, dir: V3, e: V3, jitter: [V3, V3]): V3 {
  const cosN = -dot3(n, dir);
  if (cosN <= 0) return [0, 0, 0];
  let hits = 0;
  for (const a of [-0.25, 0.25]) {
    for (const b of [-0.25, 0.25]) {
      const q0 = add3(p, add3(scale3(jitter[0], a), scale3(jitter[1], b)));
      const s = (q0[2] - WINDOW.z) / dir[2];
      if (s <= 0) continue;
      const qx = q0[0] - dir[0] * s;
      const qy = q0[1] - dir[1] * s;
      if (qx < WINDOW.x0 || qx > WINDOW.x1 || qy < WINDOW.y0 || qy > WINDOW.y1) continue;
      if (Math.abs(qx - WINDOW.mullionX) < WINDOW.mullionHalf || Math.abs(qy - WINDOW.mullionY) < WINDOW.mullionHalf) continue;
      hits++;
    }
  }
  return scale3(e, (cosN * hits) / 4);
}

/** Irradiance from the window treated as a Lambertian area emitter (4×4 samples). */
function windowArea(p: V3, n: V3, L: V3): V3 {
  const nx = 4;
  const ny = 4;
  const dA = ((WINDOW.x1 - WINDOW.x0) * (WINDOW.y1 - WINDOW.y0)) / (nx * ny);
  let acc = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const w: V3 = [WINDOW.x0 + ((i + 0.5) / nx) * (WINDOW.x1 - WINDOW.x0), WINDOW.y0 + ((j + 0.5) / ny) * (WINDOW.y1 - WINDOW.y0), WINDOW.z];
      const d: V3 = [w[0] - p[0], w[1] - p[1], w[2] - p[2]];
      const r2 = Math.max(dot3(d, d), 0.04);
      const r = Math.sqrt(r2);
      const cosP = dot3(n, d) / r;
      const cosW = -d[2] / r; // window normal is +z (into the room)
      if (cosP > 0 && cosW > 0) acc += (cosP * cosW * dA) / r2;
    }
  }
  return scale3(L, acc);
}

function baseIrradiance(p: V3, n: V3, candles: Candle[], fp: Footprint[], jitter: [V3, V3]): V3 {
  const ao = roomAO(p, n, fp);
  let e = scale3(AMBIENT, ao);
  e = add3(e, scale3(windowArea(p, n, MOON_L), 0.6 + 0.4 * ao));
  e = add3(e, windowPatch(p, n, MOON_DIR, MOON_E, jitter));
  for (const c of candles) {
    // Baked candle BOUNCE only (direct is realtime): soft, non-directional, warm.
    const d2 = (p[0] - c.pos[0]) ** 2 + (p[1] - c.pos[1]) ** 2 + (p[2] - c.pos[2]) ** 2;
    e = add3(e, scale3([1, 0.62, 0.32], (0.1 * c.intensity * ao) / (d2 + 0.6)));
  }
  return e;
}

function flashIrradiance(p: V3, n: V3, fp: Footprint[], jitter: [V3, V3]): V3 {
  const ao = roomAO(p, n, fp);
  let e = windowArea(p, n, FLASH_L);
  e = add3(e, windowPatch(p, n, FLASH_DIR, FLASH_E, jitter));
  e = add3(e, scale3([0.35, 0.38, 0.45], ao)); // bounce
  return e;
}

// ---------------------------------------------------------------- geometry ------------------------------------

interface QuadSpec {
  origin: V3;
  u: V3;
  v: V3;
  uLen: number;
  vLen: number;
  /** Offset of this piece inside its wall (keeps the tiling UVs continuous across pieces). */
  uvOffset?: [number, number];
}

function quadGeometry(q: QuadSpec): any {
  const n = cross3(q.u, q.v);
  const [ou, ov] = q.uvOffset ?? [0, 0];
  const p = (s: number, t: number) => add3(q.origin, add3(scale3(q.u, s * q.uLen), scale3(q.v, t * q.vLen)));
  const corners: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const pos: number[] = [];
  const nor: number[] = [];
  const uv0: number[] = [];
  const uv1: number[] = [];
  for (const [s, t] of corners) {
    pos.push(...p(s, t));
    nor.push(...n);
    uv0.push(ou + s * q.uLen, ov + t * q.vLen);
    uv1.push(s, t);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv0, 2));
  g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeBoundingSphere();
  return g;
}

function bakeQuad(q: QuadSpec, texelsPerM: number, fn: (p: V3, n: V3, jitter: [V3, V3]) => V3): any {
  const n = cross3(q.u, q.v);
  const resU = Math.max(4, Math.min(256, Math.ceil(q.uLen * texelsPerM)));
  const resV = Math.max(4, Math.min(256, Math.ceil(q.vLen * texelsPerM)));
  const data = new Uint16Array(resU * resV * 4);
  const jitter: [V3, V3] = [scale3(q.u, q.uLen / resU), scale3(q.v, q.vLen / resV)];
  const inv = 1 / LIGHTMAP_MULTIPLIER; // store E / multiplier (Cycles convention: E/π)
  const toHalf = THREE.DataUtils.toHalfFloat;
  for (let j = 0; j < resV; j++) {
    const t = (j + 0.5) / resV;
    // The decode samples v' = 1 − v when LIGHTMAP_FLIP_V: store row (resV−1−j) for v = t.
    const row = LIGHTMAP_FLIP_V ? resV - 1 - j : j;
    for (let i = 0; i < resU; i++) {
      const s = (i + 0.5) / resU;
      const p = add3(q.origin, add3(scale3(q.u, s * q.uLen), scale3(q.v, t * q.vLen)));
      const e = fn(p, n, jitter);
      const k = (row * resU + i) * 4;
      data[k] = toHalf(e[0] * inv);
      data[k + 1] = toHalf(e[1] * inv);
      data[k + 2] = toHalf(e[2] * inv);
      data[k + 3] = toHalf(1);
    }
  }
  const tex = new THREE.DataTexture(data, resU, resV, THREE.RGBAFormat, THREE.HalfFloatType);
  return prepareLightmapTexture(tex);
}

/** Splits a wall rectangle around an opening into up to four quads. Coordinates are in wall (u, v) metres. */
function wallPieces(origin: V3, u: V3, v: V3, uLen: number, vLen: number, hole: { u0: number; u1: number; v0: number; v1: number } | null): QuadSpec[] {
  const at = (a: number, b: number): V3 => add3(origin, add3(scale3(u, a), scale3(v, b)));
  const piece = (a0: number, a1: number, b0: number, b1: number): QuadSpec => ({ origin: at(a0, b0), u, v, uLen: a1 - a0, vLen: b1 - b0, uvOffset: [a0, b0] });
  if (!hole) return [piece(0, uLen, 0, vLen)];
  const out: QuadSpec[] = [];
  if (hole.u0 > 0) out.push(piece(0, hole.u0, 0, vLen));
  if (hole.u1 < uLen) out.push(piece(hole.u1, uLen, 0, vLen));
  if (hole.v0 > 0) out.push(piece(hole.u0, hole.u1, 0, hole.v0));
  if (hole.v1 < vLen) out.push(piece(hole.u0, hole.u1, hole.v1, vLen));
  return out;
}

// ---------------------------------------------------------------- procedural materials (TSL) ------------------

const floorColor = Fn(() => {
  const p = uv(); // metres
  const boardW = 0.14;
  const row = floor(p.y.div(boardW));
  const rowH = hash(row.add(1000));
  const plank = floor(p.x.add(rowH.mul(3)).div(1.7));
  const plankH = hash(plank.add(row.mul(37)).add(5000));
  const grain = mx_noise_float(vec3(p.x.mul(1.3), p.y.mul(38), plankH.mul(9))).mul(0.5).add(0.5);
  const fine = mx_noise_float(vec3(p.x.mul(9), p.y.mul(160), 2.3)).mul(0.5).add(0.5);
  const base = mix(vec3(0.075, 0.042, 0.024), vec3(0.16, 0.095, 0.052), plankH);
  const gap = step(0.035, fract(p.y.div(boardW))).mul(step(0.004, fract(p.x.add(rowH.mul(3)).div(1.7))));
  const wear = mx_fractal_noise_float(vec3(p.x.mul(0.6), p.y.mul(0.6), 1.7), 3).mul(0.5).add(0.5);
  return base.mul(grain.mul(0.45).add(0.65)).mul(fine.mul(0.2).add(0.9)).mul(gap.mul(0.75).add(0.25)).mul(mix(1.15, 0.8, wear));
});

const wallColor = Fn(() => {
  const p = uv();
  const stripe = smoothstep(0.46, 0.5, abs(fract(p.x.div(0.18)).sub(0.5)).mul(2));
  const motif = mx_noise_float(vec3(fract(p.x.div(0.18)).mul(3), p.y.mul(5.5), 0.4)).mul(0.5).add(0.5);
  const paper = mix(vec3(0.19, 0.17, 0.125), vec3(0.14, 0.135, 0.105), stripe).mul(motif.mul(0.25).add(0.85));
  const stainN = mx_fractal_noise_float(vec3(p.x.mul(0.7), p.y.mul(1.1), 3.1), 4).mul(0.5).add(0.5);
  const stain = smoothstep(0.35, 0.75, stainN.add(float(1.4).sub(p.y).mul(0.35)));
  const damp = paper.mul(mix(float(1), float(0.55), stain)).add(vec3(0.02, 0.012, 0).mul(stain));
  // Dark wood wainscot below 0.9 m with a rail.
  const wains = step(p.y, 0.9);
  const panel = vec3(0.07, 0.04, 0.025).mul(mx_noise_float(vec3(p.x.mul(2), p.y.mul(30), 8.1)).mul(0.25).add(0.85));
  const rail = step(0.86, p.y).mul(step(p.y, 0.92));
  return mix(damp, panel, wains).mul(float(1).sub(rail.mul(0.35)));
});

const ceilingColor = Fn(() => {
  const p = uv();
  const n = mx_fractal_noise_float(vec3(p.x.mul(1.4), p.y.mul(1.4), 7.7), 4).mul(0.5).add(0.5);
  const ring = float(1).sub(smoothstep(0.0, 0.02, abs(n.sub(0.62)))).mul(0.25);
  return vec3(0.33, 0.315, 0.28).mul(n.mul(0.25).add(0.8)).sub(vec3(0.05, 0.06, 0.08).mul(ring));
});

const woodColor = (tint: V3) =>
  Fn(() => {
    const p = positionWorld;
    const g = mx_noise_float(vec3(p.x.mul(2.2), p.y.mul(24), p.z.mul(2.2))).mul(0.5).add(0.5);
    return vec3(...tint).mul(g.mul(0.5).add(0.7));
  });

// ---------------------------------------------------------------- scene assembly -------------------------------

export interface TestRoom {
  group: any;
  /** Non-lightmapped (probe-lit) objects hidden during the probe bake. */
  dynamicGroup: any;
  lightmappedMaterials: any[];
  candleLights: any[];
  lightningLight: any;
  /** Axis-aligned obstacles (xz) for the test controller. */
  obstacles: Footprint[];
  spawn: { pos: V3; yaw: number };
  bakeMs: number;
  update(dt: number, t: number): void;
}

export function buildTestRoom(scene: any, preset: PresetConfig): TestRoom {
  const t0 = performance.now();
  const group = new THREE.Group();
  group.name = 'test-room';
  const dynamicGroup = new THREE.Group();
  dynamicGroup.name = 'test-room-dynamic';
  scene.add(group, dynamicGroup);

  const candles: Candle[] = [
    { pos: [-1.25, 0.93, -1.2], intensity: 1.4 },
    { pos: [1.95, 0.98, 2.25], intensity: 1.1 },
  ];
  const footprints: Footprint[] = [
    { x0: -1.85, x1: -0.65, z0: -1.55, z1: -0.85, inside: 0.55 }, // table
    { x0: -2.5, x1: -1.9, z0: 0.6, z1: 1.8, inside: 0.2 }, // wardrobe
    { x0: 1.6, x1: 2.3, z0: 2.0, z1: 2.5, inside: 0.3 }, // cabinet
    { x0: -0.6, x1: -0.15, z0: -1.1, z1: -0.65, inside: 0.45 }, // chair
  ];
  const texelsPerM = preset.lightmaps.resolution >= 2048 ? 24 : 16;
  const flashOn = preset.lightmaps.lightningFlashMaps;

  // Surfaces: [spec list, colour node, roughness]
  const H = ROOM.height;
  const surfaces: Array<{ quads: QuadSpec[]; color: any; roughness: number; name: string }> = [
    { name: 'floor', quads: [{ origin: [ROOM.minX, 0, ROOM.maxZ], u: [1, 0, 0], v: [0, 0, -1], uLen: 5, vLen: 6 }], color: floorColor(), roughness: 0.55 },
    { name: 'ceiling', quads: [{ origin: [ROOM.minX, H, ROOM.minZ], u: [1, 0, 0], v: [0, 0, 1], uLen: 5, vLen: 6 }], color: ceilingColor(), roughness: 0.92 },
    {
      name: 'wall-north',
      quads: wallPieces([ROOM.minX, 0, ROOM.minZ], [1, 0, 0], [0, 1, 0], 5, H, { u0: WINDOW.x0 - ROOM.minX, u1: WINDOW.x1 - ROOM.minX, v0: WINDOW.y0, v1: WINDOW.y1 }),
      color: wallColor(),
      roughness: 0.85,
    },
    { name: 'wall-south', quads: wallPieces([ROOM.maxX, 0, ROOM.maxZ], [-1, 0, 0], [0, 1, 0], 5, H, null), color: wallColor(), roughness: 0.85 },
    { name: 'wall-west', quads: wallPieces([ROOM.minX, 0, ROOM.maxZ], [0, 0, -1], [0, 1, 0], 6, H, null), color: wallColor(), roughness: 0.85 },
    {
      name: 'wall-east',
      quads: wallPieces([ROOM.maxX, 0, ROOM.minZ], [0, 0, 1], [0, 1, 0], 6, H, { u0: DOOR.z0 - ROOM.minZ, u1: DOOR.z1 - ROOM.minZ, v0: 0, v1: DOOR.h }),
      color: wallColor(),
      roughness: 0.85,
    },
  ];

  const lightmappedMaterials: any[] = [];
  let texels = 0;
  for (const s of surfaces) {
    s.quads.forEach((q, i) => {
      const base = bakeQuad(q, texelsPerM, (p, n, j) => baseIrradiance(p, n, candles, footprints, j));
      const flash = flashOn ? bakeQuad(q, texelsPerM * 0.5, (p, n, j) => flashIrradiance(p, n, footprints, j)) : null;
      texels += base.image.width * base.image.height;
      const mat = new LightmapMaterial({ roughness: s.roughness, metalness: 0 }, { base, flash });
      mat.colorNode = s.color;
      mat.name = `lm-${s.name}-${i}`;
      lightmappedMaterials.push(mat);
      const mesh = new THREE.Mesh(quadGeometry(q), mat);
      mesh.name = `${s.name}-${i}`;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      group.add(mesh);
    });
  }

  // Window: emissive "sky" pane + frame and mullions.
  const skyU = uniform(1);
  const sky = new THREE.MeshBasicNodeMaterial();
  sky.colorNode = Fn(() => {
    const p = uv();
    const clouds = mx_fractal_noise_float(vec3(p.x.mul(2.5), p.y.mul(1.4), 4.2), 4).mul(0.5).add(0.5);
    const night = mix(vec3(0.012, 0.016, 0.028), vec3(0.05, 0.06, 0.085), clouds).mul(skyU);
    return mix(night, vec3(5.5, 6.0, 7.2).mul(clouds.mul(0.5).add(0.6)), uLightning);
  })();
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW.x1 - WINDOW.x0, WINDOW.y1 - WINDOW.y0), sky);
  pane.position.set((WINDOW.x0 + WINDOW.x1) / 2, (WINDOW.y0 + WINDOW.y1) / 2, WINDOW.z - 0.08);
  group.add(pane);

  const paint = new THREE.MeshStandardNodeMaterial({ roughness: 0.7 });
  paint.colorNode = woodColor([0.06, 0.055, 0.05])();
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: any, parent: any = dynamicGroup, name = '') => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    if (name) m.name = name;
    parent.add(m);
    return m;
  };
  const wx = (WINDOW.x0 + WINDOW.x1) / 2;
  const ww = WINDOW.x1 - WINDOW.x0;
  const wh = WINDOW.y1 - WINDOW.y0;
  const wz = WINDOW.z;
  box(ww + 0.16, 0.08, 0.16, wx, WINDOW.y0 - 0.02, wz + 0.02, paint); // sill
  box(ww + 0.16, 0.08, 0.12, wx, WINDOW.y1 + 0.04, wz + 0.01, paint); // head
  box(0.08, wh + 0.12, 0.12, WINDOW.x0 - 0.04, (WINDOW.y0 + WINDOW.y1) / 2, wz + 0.01, paint);
  box(0.08, wh + 0.12, 0.12, WINDOW.x1 + 0.04, (WINDOW.y0 + WINDOW.y1) / 2, wz + 0.01, paint);
  box(WINDOW.mullionHalf * 2, wh, 0.05, WINDOW.mullionX, (WINDOW.y0 + WINDOW.y1) / 2, wz - 0.04, paint);
  box(ww, WINDOW.mullionHalf * 2, 0.05, wx, WINDOW.mullionY, wz - 0.04, paint);

  // Furniture (probe-lit).
  const darkWood = new THREE.MeshStandardNodeMaterial({ roughness: 0.62 });
  darkWood.colorNode = woodColor([0.12, 0.065, 0.035])();
  const paleWood = new THREE.MeshStandardNodeMaterial({ roughness: 0.7 });
  paleWood.colorNode = woodColor([0.2, 0.14, 0.09])();
  // Table
  box(1.2, 0.05, 0.7, -1.25, 0.76, -1.2, darkWood, dynamicGroup, 'table-top');
  for (const [lx, lz] of [
    [-1.8, -1.5],
    [-0.7, -1.5],
    [-1.8, -0.9],
    [-0.7, -0.9],
  ])
    box(0.05, 0.74, 0.05, lx, 0.37, lz, darkWood);
  // Chair
  box(0.42, 0.04, 0.42, -0.38, 0.46, -0.88, paleWood, dynamicGroup, 'chair-seat');
  for (const [lx, lz] of [
    [-0.56, -1.06],
    [-0.2, -1.06],
    [-0.56, -0.7],
    [-0.2, -0.7],
  ])
    box(0.035, 0.46, 0.035, lx, 0.23, lz, paleWood);
  box(0.42, 0.5, 0.035, -0.38, 0.73, -0.68, paleWood, dynamicGroup, 'chair-back');
  // Wardrobe
  box(0.58, 2.05, 1.18, -2.2, 1.025, 1.2, darkWood, dynamicGroup, 'wardrobe');
  box(0.02, 1.7, 0.01, -1.905, 1.05, 1.2, paint); // door seam
  // Cabinet
  box(0.7, 0.9, 0.48, 1.95, 0.45, 2.25, paleWood, dynamicGroup, 'cabinet');

  // Door leaf (open ~70° into the hallway) + hallway.
  const hinge = new THREE.Group();
  hinge.position.set(DOOR.x, 0, DOOR.z1);
  hinge.rotation.y = -1.2;
  dynamicGroup.add(hinge);
  const leaf = box(0.04, DOOR.h - 0.02, DOOR.z1 - DOOR.z0 - 0.02, 0.02, (DOOR.h - 0.02) / 2, -(DOOR.z1 - DOOR.z0) / 2, darkWood, hinge, 'door-leaf');
  leaf.castShadow = true;
  const hallMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
  hallMat.colorNode = vec3(0.09, 0.08, 0.07);
  const hall: QuadSpec[] = [
    { origin: [2.5, 0, 1.6], u: [1, 0, 0], v: [0, 0, -1], uLen: 3.5, vLen: 3.2 }, // floor
    { origin: [2.5, 2.6, -1.6], u: [1, 0, 0], v: [0, 0, 1], uLen: 3.5, vLen: 3.2 }, // ceiling
    { origin: [6.0, 0, -1.6], u: [0, 0, 1], v: [0, 1, 0], uLen: 3.2, vLen: 2.6 }, // far (east) wall
    { origin: [2.5, 0, -1.6], u: [1, 0, 0], v: [0, 1, 0], uLen: 3.5, vLen: 2.6 }, // north side
    { origin: [6.0, 0, 1.6], u: [-1, 0, 0], v: [0, 1, 0], uLen: 3.5, vLen: 2.6 }, // south side
  ];
  for (const q of hall) {
    const m = new THREE.Mesh(quadGeometry(q), hallMat);
    m.receiveShadow = true;
    dynamicGroup.add(m);
  }

  // Candles: wax, flame (HDR emissive, flickers), realtime point light (direct only; bounce is baked).
  const wax = new THREE.MeshStandardNodeMaterial({ color: 0xd9cfb4, roughness: 0.45 });
  const candleLights: any[] = [];
  const flames: Array<{ mesh: any; u: any; light: any; base: number; seed: number }> = [];
  for (const [i, c] of candles.entries()) {
    const stickH = 0.14;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, stickH, 14), wax);
    stick.position.set(c.pos[0], c.pos[1] - 0.05 - stickH / 2 + 0.02, c.pos[2]);
    stick.castShadow = true;
    dynamicGroup.add(stick);
    const u = uniform(1);
    const fm = new THREE.MeshBasicNodeMaterial();
    fm.colorNode = vec3(9, 4.6, 1.5).mul(u);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.011, 12, 8), fm);
    flame.scale.set(1, 2.4, 1);
    flame.position.set(c.pos[0], c.pos[1] + 0.005, c.pos[2]);
    dynamicGroup.add(flame);
    const light = new THREE.PointLight(0xffa860, c.intensity, 9, 2);
    light.position.set(c.pos[0], c.pos[1] + 0.03, c.pos[2]);
    light.castShadow = false;
    light.name = `candle-${i}`;
    group.add(light);
    candleLights.push(light);
    flames.push({ mesh: flame, u, light, base: c.intensity, seed: i * 17.3 + 1 });
  }

  // Lightning spot (realtime; dynamic objects on every preset, lightmapped surfaces only when there is no flash map).
  const lightningLight = new THREE.SpotLight(0xcfd9ff, 0, 16, 0.62, 0.7, 2);
  lightningLight.position.set(0.35, 3.1, -5.4);
  lightningLight.target.position.set(-0.4, 0, 0.8);
  lightningLight.castShadow = false;
  lightningLight.name = 'lightning-spot';
  group.add(lightningLight, lightningLight.target);

  const bakeMs = performance.now() - t0;
  console.info(`[test-room] CPU lightmaps: ${lightmappedMaterials.length} surfaces, ${texels} texels @ ${texelsPerM}/m${flashOn ? ' + flash maps' : ''}, ${bakeMs.toFixed(0)} ms`);

  // Candle flicker: layered sines + occasional gutters.
  const noise1 = (x: number) => Math.sin(x) * 0.5 + Math.sin(x * 2.31 + 1.3) * 0.3 + Math.sin(x * 5.73 + 0.7) * 0.2;
  return {
    group,
    dynamicGroup,
    lightmappedMaterials,
    candleLights,
    lightningLight,
    obstacles: footprints,
    spawn: { pos: [0.6, 1.62, 2.2], yaw: 0.25 },
    bakeMs,
    update(_dt: number, t: number) {
      for (const f of flames) {
        const k = 0.86 + 0.1 * noise1(t * 7.1 + f.seed) + 0.04 * noise1(t * 23.0 + f.seed * 3);
        f.light.intensity = f.base * k;
        f.u.value = k;
        f.mesh.scale.y = 2.4 * (0.9 + 0.12 * noise1(t * 11 + f.seed));
      }
    },
  };
}
