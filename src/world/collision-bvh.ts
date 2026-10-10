// PERF G (ruling f: live heap / GC pauses) — a flat triangle BVH with the Octree query surface WorldCollision and the
// player controller use (capsuleIntersect / rayIntersect, same semantics as three/addons/math/Octree.js r186).
//
// Why: three's Octree stores every triangle in EVERY leaf its box touches and splits until ≤ 8 triangles or level 16.
// Our main collision set spans the 1430 m road set (RC9) down to centimetre props, and prop/stair fans (> 8 triangles
// sharing a vertex) split to the depth limit: measured on Medium (scratch/pg/oct-med, 63 856 triangles) 899 962 nodes,
// 741 425 leaves, 3.07 M triangle references (48 × duplication) = 430 MB of the 1.31 GB live heap in ~9 M small JS
// objects (Octree + Box3 + Vector3 + arrays per node) — the bulk of what every major GC has to mark.
// Here every triangle lives once, in typed arrays (9 floats), under a median-split BVH (≈ 2·N/LEAF nodes, 6 floats +
// 2 ints each): ≈ 3 MB for the same set, two typed arrays instead of millions of objects.
//
// Semantics kept from Octree.js: capsuleIntersect collects the candidate triangles of the ORIGINAL capsule's bounds,
// then pushes a copy out of each intersecting triangle in turn (Octree.triangleCapsuleIntersect, the same exact test)
// and returns the total displacement as { normal (shared scratch vector, copy before the next query), depth }.
// rayIntersect returns the nearest front-face hit { distance, triangle, position } (backface culling on, like Octree).
// Only the candidate ORDER differs (tree order), which can move a multi-contact push-out by float noise.
import * as THREE from 'three/webgpu';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';

/** Triangles per leaf (median split stops at this count). */
const LEAF = 6;

const _tri = new THREE.Triangle();
const _capsule = new Capsule();
const _center = new THREE.Vector3();
const _c0 = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _normal = new THREE.Vector3();
/** Octree's exact capsule-vs-triangle test (a pure function of its arguments in r186; no instance state used). */
const _exact = new Octree();

export class TriangleBVH {
  /** Same role as Octree.layers: meshes whose layers intersect this mask are collected by fromGraphNode(). */
  readonly layers = new THREE.Layers();
  /** World-space triangles, 9 floats each (a, b, c), in BVH leaf order. */
  tris = new Float32Array(0);
  /** Per node: min xyz, max xyz. */
  private bounds = new Float32Array(0);
  /** Per node: internal → left child index (right child = right[i]); leaf → first triangle index. */
  private left = new Int32Array(0);
  /** Per node: internal → right child index; leaf → −(triangle count). */
  private right = new Int32Array(0);
  private nodes = 0;
  private stack = new Int32Array(64);
  private cand: number[] = [];
  /** rayIntersect's result, reused (per instance: GroundSplitOctree compares a main and a ground hit). Callers read
   *  it before the next query on the same tree, as with Octree's module-scoped scratch vectors. */
  private readonly hit = { distance: 0, triangle: new THREE.Triangle(), position: new THREE.Vector3() };

  get triangleCount(): number {
    return this.tris.length / 9;
  }

  get nodeCount(): number {
    return this.nodes;
  }

  /** Collects every mesh triangle under `group` (world space, like Octree.fromGraphNode) and builds the tree. */
  fromGraphNode(group: any): this {
    group.updateWorldMatrix(true, true);
    const out: number[] = [];
    const v = new THREE.Vector3();
    group.traverse((obj: any) => {
      if (obj.isMesh !== true || !this.layers.test(obj.layers)) return;
      const g = obj.geometry;
      const pos = g.getAttribute('position');
      const idx = g.index;
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i + 2 < n; i += 3) {
        for (let k = 0; k < 3; k++) {
          v.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(obj.matrixWorld);
          out.push(v.x, v.y, v.z);
        }
      }
    });
    this.build(new Float32Array(out));
    return this;
  }

  /** Builds the tree over `src` (9 floats per triangle). */
  build(src: Float32Array): void {
    const n = Math.floor(src.length / 9);
    const cen = new Float32Array(n * 3);
    for (let t = 0; t < n; t++) {
      const o = t * 9;
      cen[t * 3] = (src[o] + src[o + 3] + src[o + 6]) / 3;
      cen[t * 3 + 1] = (src[o + 1] + src[o + 4] + src[o + 7]) / 3;
      cen[t * 3 + 2] = (src[o + 2] + src[o + 5] + src[o + 8]) / 3;
    }
    const perm = new Uint32Array(n);
    for (let t = 0; t < n; t++) perm[t] = t;
    const cap = 2 * n + 1; // every leaf holds ≥ 1 triangle → ≤ 2n − 1 nodes (sliced to the used count below)
    this.bounds = new Float32Array(cap * 6);
    this.left = new Int32Array(cap);
    this.right = new Int32Array(cap);
    this.nodes = 0;
    // iterative build: [node, start, end) ranges of perm
    const work: number[] = [];
    const root = this.alloc();
    work.push(root, 0, n);
    let maxDepth = 1;
    const depth = new Int32Array(cap);
    depth[root] = 1;
    while (work.length) {
      const end = work.pop()!;
      const start = work.pop()!;
      const node = work.pop()!;
      // node bounds over the triangles' vertices; centroid bounds pick the split axis
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
      for (let i = start; i < end; i++) {
        const t = perm[i];
        const o = t * 9;
        for (let k = 0; k < 9; k += 3) {
          const x = src[o + k], y = src[o + k + 1], z = src[o + k + 2];
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
          if (z < z0) z0 = z; if (z > z1) z1 = z;
        }
        const cx = cen[t * 3], cy = cen[t * 3 + 1], cz = cen[t * 3 + 2];
        if (cx < cx0) cx0 = cx; if (cx > cx1) cx1 = cx;
        if (cy < cy0) cy0 = cy; if (cy > cy1) cy1 = cy;
        if (cz < cz0) cz0 = cz; if (cz > cz1) cz1 = cz;
      }
      const b = node * 6;
      this.bounds[b] = x0; this.bounds[b + 1] = y0; this.bounds[b + 2] = z0;
      this.bounds[b + 3] = x1; this.bounds[b + 4] = y1; this.bounds[b + 5] = z1;
      const count = end - start;
      const ex = cx1 - cx0, ey = cy1 - cy0, ez = cz1 - cz0;
      if (count <= LEAF || Math.max(ex, ey, ez) <= 0) {
        this.left[node] = start;
        this.right[node] = -count;
        continue;
      }
      const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
      const mid = (start + end) >> 1;
      selectNth(perm, cen, axis, start, end - 1, mid);
      const l = this.alloc();
      const r = this.alloc();
      depth[l] = depth[r] = depth[node] + 1;
      maxDepth = Math.max(maxDepth, depth[l]);
      this.left[node] = l;
      this.right[node] = r;
      work.push(l, start, mid, r, mid, end);
    }
    if (this.stack.length < maxDepth * 2 + 8) this.stack = new Int32Array(maxDepth * 2 + 8);
    // triangles in leaf order (each leaf's range is contiguous in perm)
    const tris = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) tris.set(src.subarray(perm[i] * 9, perm[i] * 9 + 9), i * 9);
    this.tris = tris;
    this.bounds = this.bounds.slice(0, this.nodes * 6);
    this.left = this.left.slice(0, this.nodes);
    this.right = this.right.slice(0, this.nodes);
  }

  private alloc(): number {
    return this.nodes++;
  }

  private loadTri(i: number, tri: any): any {
    const f = this.tris;
    const o = i * 9;
    tri.a.set(f[o], f[o + 1], f[o + 2]);
    tri.b.set(f[o + 3], f[o + 4], f[o + 5]);
    tri.c.set(f[o + 6], f[o + 7], f[o + 8]);
    return tri;
  }

  /** Candidate triangle indices whose node boxes overlap the axis-aligned box [x0..x1] × [y0..y1] × [z0..z1]. */
  private collectBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, out: number[]): void {
    out.length = 0;
    if (!this.nodes) return;
    const B = this.bounds, L = this.left, R = this.right, st = this.stack;
    let sp = 0;
    st[sp++] = 0;
    while (sp) {
      const n = st[--sp];
      const b = n * 6;
      if (B[b] > x1 || B[b + 3] < x0 || B[b + 1] > y1 || B[b + 4] < y0 || B[b + 2] > z1 || B[b + 5] < z0) continue;
      if (R[n] <= 0) {
        for (let i = L[n], e = L[n] - R[n]; i < e; i++) out.push(i);
      } else {
        st[sp++] = R[n];
        st[sp++] = L[n];
      }
    }
  }

  /** Octree.capsuleIntersect: total push-out of the capsule from every intersecting triangle, or false. */
  capsuleIntersect(capsule: any): { normal: any; depth: number } | false {
    _capsule.copy(capsule);
    const s = _capsule.start, e = _capsule.end, r = _capsule.radius;
    this.collectBox(
      Math.min(s.x, e.x) - r, Math.min(s.y, e.y) - r, Math.min(s.z, e.z) - r,
      Math.max(s.x, e.x) + r, Math.max(s.y, e.y) + r, Math.max(s.z, e.z) + r,
      this.cand,
    );
    let hit = false;
    for (const i of this.cand) {
      const res = _exact.triangleCapsuleIntersect(_capsule, this.loadTri(i, _tri));
      if (res) {
        hit = true;
        _capsule.translate(res.normal.multiplyScalar(res.depth));
      }
    }
    if (!hit) return false;
    const v = _capsule.getCenter(_center).sub(capsule.getCenter(_c0));
    const depth = v.length();
    return { normal: _normal.copy(v).normalize(), depth };
  }

  /** Octree.rayIntersect: nearest front-face hit along the ray, or false. */
  rayIntersect(ray: any): { distance: number; triangle: any; position: any } | false {
    if (!this.nodes) return false;
    const B = this.bounds, L = this.left, R = this.right, st = this.stack;
    const ox = ray.origin.x, oy = ray.origin.y, oz = ray.origin.z;
    const ix = 1 / ray.direction.x, iy = 1 / ray.direction.y, iz = 1 / ray.direction.z;
    const dl = ray.direction.length(); // slab t is in direction units; hit distances are metres
    let best = Infinity;
    let bestI = -1;
    let sp = 0;
    st[sp++] = 0;
    while (sp) {
      const n = st[--sp];
      const b = n * 6;
      // slab test (t ≥ 0, and nearer than the best hit so far)
      let t0 = (B[b] - ox) * ix, t1 = (B[b + 3] - ox) * ix;
      let tmin = Math.min(t0, t1), tmax = Math.max(t0, t1);
      t0 = (B[b + 1] - oy) * iy; t1 = (B[b + 4] - oy) * iy;
      tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
      t0 = (B[b + 2] - oz) * iz; t1 = (B[b + 5] - oz) * iz;
      tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
      // NaN (0 × ∞ on an axis-parallel ray in a box face plane) → keep the node (conservative)
      if (tmax < 0 || tmin > tmax || tmin * dl > best) continue;
      if (R[n] <= 0) {
        for (let i = L[n], e = L[n] - R[n]; i < e; i++) {
          this.loadTri(i, _tri);
          const p = ray.intersectTriangle(_tri.a, _tri.b, _tri.c, true, _hit);
          if (!p) continue;
          const d = _c0.copy(p).sub(ray.origin).length();
          if (d < best) {
            best = d;
            bestI = i;
            _center.copy(p);
          }
        }
      } else {
        st[sp++] = R[n];
        st[sp++] = L[n];
      }
    }
    if (bestI < 0) return false;
    const h = this.hit;
    this.loadTri(bestI, h.triangle);
    h.position.copy(_center);
    h.distance = best;
    return h;
  }
}

/** Quickselect: reorders perm[lo..hi] so perm[k] holds the k-th smallest centroid on `axis`, smaller ones before it. */
function selectNth(perm: Uint32Array, cen: Float32Array, axis: number, lo: number, hi: number, k: number): void {
  while (hi > lo) {
    const pv = cen[perm[(lo + hi) >> 1] * 3 + axis];
    let i = lo, j = hi;
    while (i <= j) {
      while (cen[perm[i] * 3 + axis] < pv) i++;
      while (cen[perm[j] * 3 + axis] > pv) j--;
      if (i <= j) {
        const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
        i++; j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return;
  }
}
