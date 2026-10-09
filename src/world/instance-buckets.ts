// One vertex program per material for instanced meshes (runtime lane D, fz2/fz3.mjs).
// three r186 Instance.js: when an InstancedMesh's matrices fit the uniform-buffer limit (count × 64 B ≤ 64 KiB, i.e.
// ≤ 1024 instances) they become a uniform array `buffer(array, 'mat4', count)`, and WGSLNodeBuilder names that buffer
// `NodeBuffer_<node id>` — so EVERY instanced mesh gets its own vertex program (and its own previous-matrix copy for
// the velocity pass). The corridor's pine chunks (one InstancedMesh per prototype × LOD × 150 m chunk) compiled
// 57 / 52 / 90 new bark_wet vertex programs at the C0 cuts 12.5 / 19.0 / 21.9 s: 1.1–1.9 s freezes on Medium.
// Above the limit three takes the per-instance vertex-attribute path (InstancedInterleavedBuffer over the same
// array), whose shader code is identical for every mesh of a material. `count` on a BufferAttribute is a plain
// property that only Instance.js' size test reads (the interleaved buffer, the uploads and the draw use the array and
// mesh.count; copy()/clone() carry it to the velocity pass's previous-matrix copy), so we raise it past any limit
// instead of padding the arrays (no extra memory). Same instances, same draws, same matrices.
// Caveat: never call setColorAt() on these afterwards (it sizes a new instanceColor from instanceMatrix.count).

import * as THREE from 'three/webgpu';
import { attribute, mat4, normalLocal, positionLocal, positionPrevious, transformNormal } from 'three/tsl';

/** Larger than any uniform-buffer limit in bytes / 64 that a WebGPU or WebGL2 device reports. */
const FORCE_ATTRIBUTE_PATH = 1 << 20;

/** Routes every InstancedMesh under `root` to three's instanced-attribute path. */
export function shareInstancePrograms(root: any): { meshes: number; counts: number } {
  const counts = new Set<number>();
  let meshes = 0;
  root?.traverse((o: any) => {
    if (!o.isInstancedMesh || !o.instanceMatrix || o.instanceMatrix.isStorageInstancedBufferAttribute) return;
    if (o.instanceMatrix.count >= FORCE_ATTRIBUTE_PATH) return;
    counts.add(o.instanceMatrix.count);
    o.instanceMatrix.count = FORCE_ATTRIBUTE_PATH;
    meshes++;
  });
  return { meshes, counts: counts.size };
}

// ==== runtime lane E (item 1/2: load time) — instancing as GEOMETRY attributes, one node build per material ========
// r186 RenderObject.getMaterialCacheKey (RenderObject.js:846) appends object.uuid for every InstancedMesh, so each
// corridor chunk (287 instanced primitives on Medium, 290 on Max) is node-built separately in every render context it
// is drawn in (main pass, DOF pass, each shadow map): rc9's warm step = 748 builds / 15–28 s on Medium, 1763 / 48 s on
// Max, and a cold Max load ran past 300 s. Sharing the build is impossible while the matrices are a node attribute
// (BufferAttributeNode keeps the FIRST mesh's buffer in the shared NodeBuilderState — RenderObject.getAttributes).
// So: the instance matrices move into the GEOMETRY as four named per-instance vec4 attributes (an
// InstancedInterleavedBuffer over the same array) on an InstancedBufferGeometry that shares the mesh's vertex/index
// attributes; the object stops being an InstancedMesh for the renderer (isInstancedMesh = false, count = 1 — the draw
// takes geometry.instanceCount, RenderObject.getDrawParameters); and NodeMaterial.setupPosition applies the matrix
// read BY NAME (geometry.getAttribute per render object) for any geometry carrying those attributes. The geometry
// cache key lists attribute names, so instanced and plain users of one material still build separately, but every
// chunk of a material shares one build per context — in the shadow pass too (the override material is a
// NodeMaterial). Same matrices, same draws, same shading: position, normal and the velocity pass's previous position
// are transformed exactly as Instance.js does (static instances: previous = current matrix).

const IM = ['instanceMatrix0', 'instanceMatrix1', 'instanceMatrix2', 'instanceMatrix3'] as const;
let patched = false;

function patchSetupPosition(): void {
  if (patched) return;
  patched = true;
  const proto = THREE.NodeMaterial.prototype;
  const orig = proto.setupPosition;
  proto.setupPosition = function (builder: any) {
    const g = builder.geometry;
    if (g && g.attributes && g.attributes[IM[0]] !== undefined && builder.object && builder.object.isInstancedMesh !== true) {
      const m = mat4(attribute(IM[0], 'vec4'), attribute(IM[1], 'vec4'), attribute(IM[2], 'vec4'), attribute(IM[3], 'vec4'));
      positionLocal.assign(m.mul(positionLocal).xyz);
      if (builder.needsPreviousData()) positionPrevious.assign(m.mul(positionPrevious).xyz);
      if (builder.hasGeometryAttribute('normal')) normalLocal.assign(transformNormal(normalLocal, m));
    }
    return orig.call(this, builder);
  };
}

/** Converts every static InstancedMesh under `root` (no instance colours / morphs) to geometry-attribute instancing. */
export function geometryInstancing(root: any): { meshes: number; geometries: number } {
  patchSetupPosition();
  let meshes = 0;
  const geos = new Set<any>();
  root?.traverse((o: any) => {
    if (!o.isInstancedMesh || o.userData.geoInstanced) return;
    const im = o.instanceMatrix;
    if (!im || im.isStorageInstancedBufferAttribute || o.instanceColor || o.morphTexture || o.geometry.morphAttributes?.position) return;
    if (o.boundingSphere === null) o.computeBoundingSphere(); // the instances' sphere, kept for culling (Frustum.js:148)
    if (o.boundingBox === null) o.computeBoundingBox();
    const src = o.geometry;
    const g = new THREE.InstancedBufferGeometry();
    g.index = src.index;
    for (const name of Object.keys(src.attributes)) g.setAttribute(name, src.attributes[name]);
    g.groups = src.groups.map((x: any) => ({ ...x }));
    g.drawRange = { ...src.drawRange };
    g.boundingBox = src.boundingBox;
    g.boundingSphere = src.boundingSphere;
    const buf = new THREE.InstancedInterleavedBuffer(im.array, 16, 1);
    for (let i = 0; i < 4; i++) g.setAttribute(IM[i], new THREE.InterleavedBufferAttribute(buf, 4, i * 4));
    g.instanceCount = o.count;
    g.name = src.name;
    o.geometry = g;
    o.isInstancedMesh = false; // own property: RenderObject cache key + NodeMaterial.setupPosition see a plain Mesh
    o.count = 1;
    o.userData.geoInstanced = true;
    geos.add(src);
    meshes++;
  });
  return { meshes, geometries: geos.size };
}
