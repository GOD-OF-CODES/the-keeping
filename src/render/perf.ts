// Load-phase instrumentation (docs/PERF-PLAN.md §6, P2-9). Counts node builds (one per new render-object/material
// variant: renderer.debug.onNodeBuilderCreated, NodeManager.js:168) and reads renderer.info.memory.programs (vertex +
// fragment/compute stages, Info.js:420) at phase boundaries. Each perfMark() logs the phase that just ended as
//   [perf] phase=<p> builds=<n> programs=<n> ms=<t>
// (builds/ms are for that phase; programs is the running total). shot.mjs keeps the lines in report.console.
// Builds are counted after ready too (perfBuilds()): the QA scenarios diff it per beat to find runtime recompiles.

let renderer: any = null;
let phase = 'boot';
let phaseStart = 0;
let phaseBuilds = 0;
let totalBuilds = 0;
const log: Array<{ phase: string; builds: number; programs: number; ms: number }> = [];

/** Hooks the renderer. Outside ?debug also turns off WebGL2's synchronous shader status/log queries. */
export function installPerf(r: any, debug: boolean): void {
  renderer = r;
  phaseStart = performance.now();
  r.debug.onNodeBuilderCreated = () => {
    phaseBuilds++;
    totalBuilds++;
  };
  if (!debug) r.debug.checkShaderErrors = false;
}

/** Ends the current phase (logged) and starts `next`. */
export function perfMark(next: string): void {
  if (!renderer) return;
  const now = performance.now();
  const e = { phase, builds: phaseBuilds, programs: renderer.info?.memory?.programs ?? -1, ms: Math.round(now - phaseStart) };
  log.push(e);
  console.info(`[perf] phase=${e.phase} builds=${e.builds} programs=${e.programs} ms=${e.ms}`);
  phase = next;
  phaseStart = now;
  phaseBuilds = 0;
}

/** Node builds since the renderer was created (debug: diff it around a beat to catch runtime shader variants). */
export function perfBuilds(): number {
  return totalBuilds;
}

export function perfLog(): ReadonlyArray<{ phase: string; builds: number; programs: number; ms: number }> {
  return log;
}
