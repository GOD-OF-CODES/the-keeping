// runtime lane E (item 1 — the Max "stall at U4T"): parallel pipeline compilation for renderer.compileAsync.
//
// three r186 Renderer.compileAsync (Renderer.js ≈1066–1093) walks its render objects ONE AT A TIME: build the nodes,
// create the pipeline with createRenderPipelineAsync, then `await Promise.all(pipelinePromises)` for THAT object before
// it touches the next. So every GPU pipeline compile ran strictly serially. With a warm macOS Metal cache a compile is
// a cache lookup (~ms) and nobody noticed; cold (a first-time player, or any changed shader) each one is a real
// MSL → GPU compile (~0.2–0.3 s on the M1) and the Max load took 472 s (scratch/re/maxcold1: warm-up 316 s, EXT1 104 s
// for 385 builds). Metal compiles in parallel (several MTLCompilerService processes) — if it is asked to.
//
// The fix keeps three's own compileAsync (its frustum, render-context and pre-compiling state are module-private) and
// only changes WHO waits: while a compileAsync runs, Pipelines.getForRender receives our shared `pending` list instead
// of the per-object array three awaits, so three moves straight on to the next object's node build while the GPU
// process compiles; our wrapper then awaits every pipeline it started before it resolves. Same pipelines, same render
// objects, same cache keys — only the waiting is batched.

let pending: Promise<unknown>[] = [];
let depth = 0;
let deferDepth = 0;

/**
 * Runs `fn` with compileAsync NOT waiting for its own pipelines: every compileAsync inside resolves once its node
 * builds are done (they stay serial, so identical keys are never built twice), while the GPU process compiles every
 * pipeline requested so far in parallel; the pipelines are awaited once, at the end. Render calls in between simply
 * skip objects whose pipeline is still pending (Renderer._renderObjectDirect → Pipelines.isReady).
 */
export async function deferCompileWaits<T>(fn: () => Promise<T>): Promise<T> {
  deferDepth++;
  let out: T;
  try {
    out = await fn();
  } finally {
    deferDepth--;
  }
  if (deferDepth === 0) await flushCompiles();
  return out;
}

/** Awaits every pipeline requested by compileAsync so far. */
export async function flushCompiles(): Promise<void> {
  // allSettled: a rejected pipeline (e.g. a stage over the device's sampler limit) used to reject inside compileAsync
  // and was caught by compileView ("compileView failed (continuing)"); deferred, it must not abort the level start
  let failed = 0;
  let first: unknown = null;
  while (pending.length) {
    const all = pending;
    pending = [];
    for (const r of await Promise.allSettled(all)) {
      if (r.status === 'rejected') {
        failed++;
        first ??= r.reason;
      }
    }
  }
  if (failed) console.warn(`[render] ${failed} pipeline compile(s) failed (continuing):`, first);
}

export function installParallelCompile(renderer: any): void {
  if (renderer.__parallelCompile) return;
  renderer.__parallelCompile = true;
  const orig = renderer.compileAsync.bind(renderer);
  const patchPipelines = () => {
    const p = renderer._pipelines;
    if (!p || p.__parallel) return;
    p.__parallel = true;
    const get = p.getForRender.bind(p);
    p.getForRender = (ro: any, promises: Promise<unknown>[] | null = null) => get(ro, promises !== null && depth > 0 ? pending : promises);
  };
  renderer.compileAsync = async (...args: any[]) => {
    if (renderer._initialized === false) await renderer.init();
    patchPipelines();
    depth++;
    try {
      await orig(...args);
    } finally {
      depth--;
    }
    if (deferDepth > 0) return; // deferCompileWaits: the caller awaits them all at the end
    const mine = pending.slice();
    if (depth === 0) pending = [];
    await Promise.all(mine); // as before: a rejection reaches the caller (compileView catches it)
  };
}
