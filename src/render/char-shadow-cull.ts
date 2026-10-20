// PERF round 2, BUDGETS (#150b): shadow-pass culling of the character figures.
//
// Every character mesh is `frustumCulled = false` (src/characters/loader.ts: a SkinnedMesh's bounds don't follow the
// pose), so each figure was drawn into EVERY shadow map and into all six faces of the parlor lamp's cube, wherever it
// stood: the Medium budget audit (scratch/perf2/b1, STATUS-perf2 B1) shows Ada's 6 meshes in the lamp cube at 10–36
// draws / 167–518 k triangles per frame (C4c 6.33: 36 draws / 518 k, B05 213.2: 30 / 500 k, C5 / B11: 10–12 / 167 k).
// While a shadow map renders, each registered mesh gets `frustumCulled = true` with a bounding sphere that provably
// contains its drawn geometry: its FIGURE's subject sphere of this frame (the bones' bounding sphere + 0.7–0.8 m, the
// spheres the #150 character light gates already rely on — src/game/story-runtime.ts updateCharLights; their
// containment of every posed character mesh is audited by `audit()` here and by CharacterLights.audit). three r186's
// shadow render (ShadowNode.renderShadow / PointShadowNode.renderShadow → renderer.render → _projectObject) then
// tests that sphere against each shadow camera / cube face frustum like any static caster, and a face that cannot
// contain the figure skips its draws. A sphere that contains every vertex a mesh draws makes the test conservative:
// a skipped draw could not have written a depth texel. The view pass is untouched (meshes keep frustumCulled = false
// there — no first-frame-in-view TAA / motion-vector change); everything is restored right after each shadow update.
// `?charshcull=0` = off at load; `window.__charShCull = false` = off at runtime (same-state A/Bs).
import * as THREE from 'three/webgpu';

/** A figure: meshes under `root` (minus the `skip` subtrees) cull against `subject` (world sphere, valid when `ok()`). */
export interface ShadowFigure {
  root: any;
  skip?: any[];
  subject: { x: number; y: number; z: number; r: number };
  ok(): boolean;
}

const ENABLED = typeof location === 'undefined' || new URLSearchParams(location.search).get('charshcull') !== '0';
let figures: ShadowFigure[] = [];
let patched = false;
const stats = { updates: 0, applied: 0 };

interface Saved {
  m: any;
  fc: boolean;
  bs: any;
  had: boolean;
}
const saved: Saved[] = [];
const spheres = new WeakMap<object, any>();
const inv = new THREE.Matrix4();
const v = new THREE.Vector3();

/** The figures (call once the characters exist; an empty list = off). */
export function setShadowFigures(list: ShadowFigure[]): void {
  figures = list;
}

export function charShadowCullStats() {
  return { ...stats, figures: figures.length, enabled: ENABLED };
}

function collect(f: ShadowFigure, out: any[]): void {
  const skip = f.skip ?? [];
  const walk = (n: any) => {
    if (skip.includes(n)) return;
    if (n.isMesh && n.castShadow && !n.frustumCulled) out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(f.root);
}

const meshes: any[] = [];
function apply(): void {
  for (const f of figures) {
    if (!f.root || !f.ok() || !(f.subject.r > 0)) continue;
    meshes.length = 0;
    collect(f, meshes);
    for (const m of meshes) {
      let s = spheres.get(m);
      if (!s) spheres.set(m, (s = new THREE.Sphere()));
      // local sphere: Frustum.intersectsObject applies matrixWorld (centre exact, radius × max axis scale)
      inv.copy(m.matrixWorld).invert();
      s.center.copy(v.set(f.subject.x, f.subject.y, f.subject.z).applyMatrix4(inv));
      const sc = m.matrixWorld.getMaxScaleOnAxis();
      s.radius = f.subject.r / (sc > 1e-9 ? sc : 1);
      const had = Object.prototype.hasOwnProperty.call(m, 'boundingSphere');
      saved.push({ m, fc: m.frustumCulled, bs: m.boundingSphere, had });
      m.boundingSphere = s;
      m.frustumCulled = true;
      stats.applied++;
    }
  }
}

function restore(): void {
  for (let i = saved.length - 1; i >= 0; i--) {
    const s = saved[i]!;
    s.m.frustumCulled = s.fc;
    if (s.had) s.m.boundingSphere = s.bs;
    else delete s.m.boundingSphere;
  }
  saved.length = 0;
}

/** Wraps three's ShadowNode.updateShadow (PointShadowNode inherits it; r186 ShadowNode.js 665 → renderShadow). */
export function installCharShadowCull(): void {
  if (patched || !ENABLED) return;
  const SN = (THREE as any).ShadowNode?.prototype;
  if (!SN?.updateShadow) return;
  patched = true;
  const upd = SN.updateShadow;
  SN.updateShadow = function (this: any, frame: any) {
    if (!figures.length || (globalThis as any).__charShCull === false || saved.length) return upd.call(this, frame);
    stats.updates++;
    apply();
    try {
      return upd.call(this, frame);
    } finally {
      restore();
    }
  };
}

/** QA: every registered mesh's POSED bounds (r186 SkinnedMesh.computeBoundingSphere = skinned vertices) inside its
 *  figure's subject sphere; returns the violations (empty = the cull is exact for this pose). */
export function auditCharShadowCull(): string[] {
  const out: string[] = [];
  const w = new THREE.Sphere();
  for (const f of figures) {
    if (!f.root || !f.ok()) continue;
    const list: any[] = [];
    collect(f, list);
    for (const m of list) {
      let vis = true;
      for (let p = m; p; p = p.parent) if (!p.visible) vis = false;
      if (!vis) continue;
      if (m.isSkinnedMesh) {
        const keep = m.boundingSphere ? m.boundingSphere.clone() : null;
        m.computeBoundingSphere();
        w.copy(m.boundingSphere).applyMatrix4(m.matrixWorld);
        if (keep) m.boundingSphere.copy(keep);
        else m.boundingSphere = null;
      } else {
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
        w.copy(m.geometry.boundingSphere).applyMatrix4(m.matrixWorld);
      }
      const d = Math.hypot(w.center.x - f.subject.x, w.center.y - f.subject.y, w.center.z - f.subject.z);
      if (d + w.radius > f.subject.r + 1e-4) out.push(`${m.name || m.type}: ${(d + w.radius).toFixed(3)} > ${f.subject.r.toFixed(3)}`);
    }
  }
  return out;
}
