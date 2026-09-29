// Load-time LightProbeGrid bake for dynamic objects (docs/PLAN.md §2.5, research three-runtime Q4 / S6).
//  - Bake from the lightmapped static scene with bounces: 0 (lightmaps already contain bounced light) and with the
//    flashlight, characters and other dynamic objects hidden.
//  - The grid is a Light: once in the scene it lights every lit node material. Lightmapped materials must opt out
//    via material.lightsNode = lights([...runtime lights]) (excludeGridFromLightmapped) or indirect light doubles.
//  - bake() only SUBMITS GPU work and is synchronous; we follow it with an awaited 1×1 readback so the logged time
//    includes GPU execution. bake() is also the only place that registers LightProbeGridNode with the renderer's
//    node library → if it throws (e.g. an untested WebGL2 path) the grid must NOT be added to the scene.

import * as THREE from 'three/webgpu';
import { lights } from 'three/tsl';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';

export interface ProbeBakeOptions {
  /** Grid size in metres (centred on `center`). */
  size: [number, number, number];
  center: [number, number, number];
  /** Probes per axis. */
  counts: [number, number, number];
  cubemapSize: number;
  near?: number;
  far?: number;
  /** Objects hidden during the bake (flashlight, characters, dynamic props). */
  hide?: any[];
}

export interface ProbeBakeResult {
  grid: any | null;
  probes: number;
  submitMs: number;
  /** Submit + GPU completion (awaited readback). */
  totalMs: number;
  /** False when the completion fence timed out (hidden tab on WebGL2): totalMs is then not meaningful. */
  fenced: boolean;
  error?: string;
}

let fenceTarget: any = null;
let fenceQuad: any = null;

/**
 * Waits until previously submitted GPU work has executed (queue order) via a 1×1 readback.
 * Resolves false on timeout: the WebGL2 backend polls its fence with requestAnimationFrame, which never fires in a
 * hidden/occluded tab.
 */
export async function gpuFence(renderer: any, timeoutMs = 5000): Promise<boolean> {
  fenceTarget ??= new THREE.RenderTarget(1, 1);
  fenceQuad ??= new THREE.QuadMesh(new THREE.MeshBasicNodeMaterial({ color: 0x000000 }));
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(fenceTarget);
  fenceQuad.render(renderer);
  renderer.setRenderTarget(prev);
  let timer = 0;
  const timeout = new Promise<boolean>((r) => (timer = window.setTimeout(() => r(false), timeoutMs)));
  const done = renderer.readRenderTargetPixelsAsync(fenceTarget, 0, 0, 1, 1).then(() => true);
  const ok = await Promise.race([done, timeout]);
  clearTimeout(timer);
  return ok;
}

export async function bakeProbeGrid(renderer: any, scene: any, o: ProbeBakeOptions): Promise<ProbeBakeResult> {
  const [w, h, d] = o.size;
  const [nx, ny, nz] = o.counts;
  const probes = nx * ny * nz;
  const grid = new LightProbeGrid(w, h, d, nx, ny, nz);
  grid.position.set(o.center[0], o.center[1], o.center[2]);
  grid.updateMatrixWorld(true);
  const hidden = (o.hide ?? []).filter((x) => x && x.visible);
  for (const x of hidden) x.visible = false;
  const t0 = performance.now();
  let submitMs = 0;
  try {
    grid.bake(renderer, scene, { cubemapSize: o.cubemapSize, near: o.near ?? 0.05, far: o.far ?? 20, bounces: 0 });
    submitMs = performance.now() - t0;
    const fenced = await gpuFence(renderer);
    const totalMs = performance.now() - t0;
    return { grid, probes, submitMs, totalMs, fenced };
  } catch (e) {
    grid.dispose?.();
    return { grid: null, probes, submitMs, totalMs: performance.now() - t0, fenced: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    for (const x of hidden) x.visible = true;
  }
}

/** Lightmapped materials only receive these runtime lights (never the probe grid). One shared LightsNode. */
export function excludeGridFromLightmapped(materials: Iterable<any>, runtimeLights: any[]): any {
  const node = lights(runtimeLights);
  for (const m of materials) {
    m.lightsNode = node;
    m.needsUpdate = true;
  }
  return node;
}
