// World collision: one static Octree (three/addons Octree) built from
//   - collision.glb (walls / floors / stair ramps / rails / porch / chimney / foundation, faces wound outward),
//   - an exterior ground plane at grade (the terrain is not part of the Blender shell: docs/HOUSE.md),
//   - prop colliders (layout `collider: box|mesh`): the prop's own `*-collider` proxy children when it has them
//     (hides keep their open interior), exact triangles for props up to PROP_TRI_LIMIT, oriented boxes per mesh
//     for heavier ones (sedans, wrecks),
// plus DYNAMIC blockers (door leaves) tested analytically each step: a vertical capsule vs the leaf's oriented box
// in its hinge frame (moving leaves never go into the octree).
//
// Player capsule: Capsule(start = feet + r, end = head − r, r). resolve() is the games_fps pattern: iterate
// octree.capsuleIntersect + push-out, floor when normal.y > FLOOR_NORMAL_Y (the ST_MAIN ramp is 40°: n.y 0.77).

import * as THREE from 'three/webgpu';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';

export { Capsule };

export const FLOOR_NORMAL_Y = 0.6;
const PROP_TRI_LIMIT = 9000;

export interface DynamicBlocker {
  /** World → blocker-local transform source (the hinge group). */
  object: any;
  /** Leaf box in the object's local frame (door closed geometry). */
  box: any; // THREE.Box3
  enabled(): boolean;
}

export interface CollisionHit {
  onFloor: boolean;
  floorNormal: any | null;
  hitWall: boolean;
}

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _q = new THREE.Quaternion();

export class WorldCollision {
  readonly octree: any;
  readonly blockers: DynamicBlocker[] = [];
  /** Visual debug group (collision proxies), hidden by default. */
  readonly debugGroup: any;
  triangles = 0;

  constructor(sources: any[]) {
    const root = new THREE.Group();
    root.name = 'collision-build';
    for (const s of sources) root.add(s);
    root.updateMatrixWorld(true);
    this.octree = new Octree();
    this.octree.fromGraphNode(root);
    let n = 0;
    root.traverse((o: any) => {
      if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    });
    this.triangles = Math.round(n);
    this.debugGroup = root;
    root.visible = false;
  }

  addBlocker(b: DynamicBlocker): void {
    this.blockers.push(b);
  }

  /** Resolves a capsule against the octree and the dynamic blockers; mutates the capsule and the velocity. */
  resolve(capsule: any, velocity: any): CollisionHit {
    const out: CollisionHit = { onFloor: false, floorNormal: null, hitWall: false };
    for (let iter = 0; iter < 3; iter++) {
      const r = this.octree.capsuleIntersect(capsule);
      if (!r) break;
      const n = r.normal;
      if (n.y > FLOOR_NORMAL_Y) {
        out.onFloor = true;
        out.floorNormal = n.clone();
        // Stand on slopes (stairs ramp): push straight up instead of along the normal so we don't slide down.
        const up = r.depth / Math.max(n.y, 0.3);
        capsule.translate(_v.set(0, up, 0));
        if (velocity.y < 0) velocity.y = 0;
      } else {
        out.hitWall = out.hitWall || Math.abs(n.y) < 0.3;
        capsule.translate(_v.copy(n).multiplyScalar(r.depth + 1e-4));
        const d = velocity.dot(n);
        if (d < 0) velocity.addScaledVector(n, -d);
      }
    }
    for (const b of this.blockers) if (b.enabled() && this.pushOutOfBox(capsule, velocity, b)) out.hitWall = true;
    return out;
  }

  /** Vertical capsule vs an oriented leaf box (rotation about Y only): 2D circle vs rect in the hinge frame. */
  private pushOutOfBox(capsule: any, velocity: any, b: DynamicBlocker): boolean {
    const o = b.object;
    const r = capsule.radius;
    const feet = capsule.start.y - r;
    const head = capsule.end.y + r;
    o.updateWorldMatrix(true, false);
    _inv.copy(o.matrixWorld).invert();
    _p.set(capsule.start.x, (feet + head) / 2, capsule.start.z).applyMatrix4(_inv);
    const box = b.box;
    // Height overlap (local y == world y up to the hinge offset; doors never tilt).
    const localFeet = feet - o.matrixWorld.elements[13];
    const localHead = head - o.matrixWorld.elements[13];
    if (localHead < box.min.y || localFeet > box.max.y) return false;
    const cx = Math.max(box.min.x, Math.min(_p.x, box.max.x));
    const cz = Math.max(box.min.z, Math.min(_p.z, box.max.z));
    let dx = _p.x - cx;
    let dz = _p.z - cz;
    let d = Math.hypot(dx, dz);
    if (d >= r) return false;
    if (d < 1e-6) {
      // Centre inside the box: push out along the thinnest axis.
      const px = Math.min(_p.x - box.min.x, box.max.x - _p.x);
      const pz = Math.min(_p.z - box.min.z, box.max.z - _p.z);
      if (px < pz) {
        dx = _p.x - (box.min.x + box.max.x) / 2 > 0 ? 1 : -1;
        dz = 0;
        d = 0;
      } else {
        dz = _p.z - (box.min.z + box.max.z) / 2 > 0 ? 1 : -1;
        dx = 0;
        d = 0;
      }
    } else {
      dx /= d;
      dz /= d;
    }
    const push = r - d + 1e-4;
    // local push direction → world (rotation only)
    o.getWorldQuaternion(_q);
    _v.set(dx, 0, dz).applyQuaternion(_q);
    _v.y = 0;
    _v.normalize();
    capsule.translate(_v.clone().multiplyScalar(push));
    const vd = velocity.x * _v.x + velocity.z * _v.z;
    if (vd < 0) {
      velocity.x -= _v.x * vd;
      velocity.z -= _v.z * vd;
    }
    return true;
  }

  /**
   * Walkable surface height under world (x, z), searching down from `fromY` (null = none within `maxDrop`).
   * Only up-facing hits count (floors, ramps, the porch deck).
   */
  floorBelow(x: number, fromY: number, z: number, maxDrop = 3): number | null {
    let y = fromY;
    for (let i = 0; i < 4; i++) {
      const hit = this.octree.rayIntersect(new THREE.Ray(new THREE.Vector3(x, y, z), new THREE.Vector3(0, -1, 0)));
      if (!hit || hit.distance > maxDrop) return null;
      const n = new THREE.Vector3();
      hit.triangle.getNormal(n);
      if (n.y > FLOOR_NORMAL_Y) return hit.position.y;
      y = hit.position.y - 0.01; // underside / wall: keep looking below it
    }
    return null;
  }

  /** Nearest static-collider hit along a ray (for interaction line-of-sight). */
  rayDistance(origin: any, dir: any, far: number): number {
    const ray = new THREE.Ray(origin, dir);
    const hit = this.octree.rayIntersect(ray);
    return hit && hit.distance <= far ? hit.distance : Infinity;
  }

  /** rayDistance + the enabled dynamic blockers (closed door leaves) — sight lines for the AI / relocation guard. */
  sightDistance(origin: any, dir: any, far: number): number {
    let best = this.rayDistance(origin, dir, far);
    for (const b of this.blockers) {
      if (!b.enabled()) continue;
      b.object.updateWorldMatrix(true, false);
      _sInv.copy(b.object.matrixWorld).invert();
      _ray.origin.copy(origin).applyMatrix4(_sInv);
      _ray.direction.copy(dir).transformDirection(_sInv);
      const p = _ray.intersectBox(b.box, _hitP);
      if (!p) continue;
      p.applyMatrix4(b.object.matrixWorld);
      const d = p.distanceTo(origin);
      if (d < best && d <= far) best = d;
    }
    return best;
  }
}

const _sInv = new THREE.Matrix4();
const _ray = new THREE.Ray();
const _hitP = new THREE.Vector3();

/** Ground collider: one quad at world y = `y` covering plan rect [x0, y0, x1, y1]. */
export function groundColliderMesh(rect: [number, number, number, number], y = 0): any {
  const [x0, py0, x1, py1] = rect;
  // plan (x, y) → world (x, −y); wind CCW seen from +Y so the normal points up.
  const g = new THREE.BufferGeometry();
  const v = new Float32Array([x0, y, -py0, x1, y, -py0, x1, y, -py1, x0, y, -py0, x1, y, -py1, x0, y, -py1]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  const m = new THREE.Mesh(g);
  m.name = 'col_ground';
  return m;
}

/**
 * Collider meshes for a placed prop root (already positioned in the world). Returns meshes in WORLD space
 * (geometry baked with matrixWorld) so they can be added to the collision build group directly.
 */
export function propColliderMeshes(root: any): any[] {
  const out: any[] = [];
  root.updateMatrixWorld(true);
  const proxies: any[] = [];
  const meshes: any[] = [];
  root.traverse((o: any) => {
    if (!o.isMesh) return;
    if (o.userData?.collider === true || /-collider$/.test(o.name)) proxies.push(o);
    else if (!o.userData?.decal) meshes.push(o);
  });
  const bake = (o: any) => {
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    const m = new THREE.Mesh(g);
    m.name = `col_${root.name}_${o.name}`;
    return m;
  };
  if (proxies.length) {
    for (const p of proxies) out.push(bake(p));
    return out;
  }
  let tris = 0;
  for (const m of meshes) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  if (tris <= PROP_TRI_LIMIT) {
    for (const m of meshes) out.push(bake(m));
    return out;
  }
  // Heavy props: an oriented box per mesh (local bounding box → world).
  for (const m of meshes) {
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    const size = bb.getSize(new THREE.Vector3());
    if (Math.max(size.x, size.y, size.z) < 0.08) continue;
    const g = new THREE.BoxGeometry(size.x, size.y, size.z);
    g.translate((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2);
    g.applyMatrix4(m.matrixWorld);
    const c = new THREE.Mesh(g);
    c.name = `col_${root.name}_${m.name}_box`;
    out.push(c);
  }
  return out;
}
