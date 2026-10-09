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
