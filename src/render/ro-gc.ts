// PERF G (ruling f, live heap / GC pauses): frees the renderer's render objects of a ONE-SHOT camera set.
//
// three r186 (src/renderers/common/RenderObjects.js) keys every RenderObject by (object, material, scene, CAMERA,
// lights, context, …) and never evicts one until its object/material/geometry is disposed. A reflection capture builds
// a new CubeCamera per capture (src/render/reflections.ts), so its ~1250 render objects (+ their node-builder data,
// bindings and pipeline refs) are unreachable for drawing yet stay alive for the whole session — measured in the
// runtime-F heap diag (docs/STATUS-runtime-f.md B15: "reflection cube capture 1254 RO all untouched").
// RenderObject.dispose() runs RenderObjects' onDispose (pipelines.delete, bindings.deleteForRender, nodes.delete,
// chain-map delete): ref-counted node-builder states / programs another live render object still uses survive.

/** Disposes every render object drawn with one of `cameras`. Returns how many were freed (0 if the internals moved). */
export function disposeRenderObjectsFor(renderer: any, cameras: Iterable<any>): number {
  const set = renderer?._objects?._renderObjects as Set<any> | undefined;
  if (!(set instanceof Set)) return 0;
  const cams = new Set(cameras);
  if (!cams.size) return 0;
  const doomed: any[] = [];
  for (const ro of set) if (cams.has(ro.camera)) doomed.push(ro);
  for (const ro of doomed) {
    try {
      ro.dispose();
    } catch {
      /* already half-disposed with its object: nothing more to free */
    }
  }
  return doomed.length;
}

/** `?rogc=0` (A/B debug): keep the one-shot render objects (the pre-PERF-G behaviour). */
export function noRoGc(): boolean {
  try {
    return new URLSearchParams(location.search).get('rogc') === '0';
  } catch {
    return false;
  }
}
