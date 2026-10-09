// Runtime prop wear (docs/PROPS-FINISH.md §2): Blender's per-vertex 'wear' masks (COLOR_0 → geometry `color`,
// vec4 linear: x edge, y cavity, z handled, w dust) drive per-family layers from wear-math.ts. One shader structure
// for every family (numbers are uniforms), object-space non-periodic noise so chips stay on a prop that moves.
//
// Never `vertexColor()` here: it returns white when the attribute is missing (= fully worn). bind.ts only calls this
// when the mesh really has a `color` attribute and the spec's family has a rule.

import * as THREE from 'three/webgpu';
import { attribute, dot, float, mix, mx_fractal_noise_float, mx_noise_float, mx_worley_noise_float, positionLocal, select, smoothstep, uniform, vec3 } from 'three/tsl';
import type { MaterialSpec } from '../shared/material-types.ts';
import { wearDustAmount, type WearLayer, type WearRule } from './wear-math.ts';

type N = any;

const uf = (v: number): N => uniform(v);
const u3 = (v: ArrayLike<number>): N => uniform(new THREE.Vector3(v[0], v[1], v[2]));
const LUMA = vec3(0.2126, 0.7152, 0.0722);
const DUST_RGB: [number, number, number] = [0.3, 0.285, 0.26];

/** Global wear uniforms (debug A/B: ?nowear sets amount 0 at load; the material-lab can scrub it). */
export const wearUniforms = {
  amount: uniform(1),
  /** `?debug` only: -1 off, 0..3 shows one mask channel (E, C, H, D) as grey, 4 the composite (R=E, G=H, B=C). */
  view: uniform(-1),
};

/** The wearView branch is compiled only under `?debug` (zero cost in the shipped game). */
const WEAR_DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');

/** `window.__game.debug.wearView(ch)` (PROPS-FINISH §5.4): ch 0..3 one channel, 4 composite, null/-1 off. */
export function setWearView(ch: number | null = null): number {
  const v = ch == null || ch < 0 || ch > 4 ? -1 : Math.floor(ch);
  wearUniforms.view.value = v;
  if (!WEAR_DEBUG && v >= 0) console.warn('[wear] wearView needs ?debug');
  return v;
}

export interface WearOptions {
  /** Low preset: one noise call, no Worley (§2.4). */
  cheap: boolean;
  /** Global dust multiplier node (materialUniforms.dust). */
  dust: N;
  /** Skip the dust term (matlab layer toggle, wet specs). */
  noDust?: boolean;
}

export interface WearResult {
  albedo: N;
  rough: N;
  metal: N;
  /** Edge and handled amounts (fabric sheen roughness). */
  edge: N;
  handled: N;
}

function layer(albedo: N, rough: N, metal: N, Ly: WearLayer, a: N): { albedo: N; rough: N; metal: N } {
  const tinted = mix(albedo.mul(u3(Ly.mul)), u3(Ly.rgb), uf(Ly.abs));
  const t = mix(tinted, vec3(dot(tinted, LUMA)), uf(Ly.desat));
  const r = mix(rough.add(uf(Ly.dRough)), uf(Ly.rough), uf(Ly.rAbs));
  return {
    albedo: mix(albedo, t, a),
    rough: mix(rough, r, a),
    metal: mix(metal, uf(Ly.metal), a.mul(uf(Ly.mAbs))),
  };
}

export function applyWear(spec: MaterialSpec, rule: WearRule, albedo0: N, rough0: N, metal0: N, o: WearOptions): WearResult {
  const M = attribute('color', 'vec4');
  const amt = wearUniforms.amount;
  const E = M.x.mul(amt);
  const C = M.y.mul(amt);
  const H = M.z.mul(amt);
  const D = M.w;
  const P = positionLocal;
  // n1: chip breakup (rule frequency); n2: cavity + dust patches (6 /m). Low: one value noise for both.
  const n1 = o.cheap ? mx_noise_float(P.mul(uf(rule.chipFreq))).mul(0.5).add(0.5) : mx_fractal_noise_float(P.mul(uf(rule.chipFreq)), 3, 2, 0.5).mul(0.5).add(0.5);
  const n2 = o.cheap ? n1 : mx_fractal_noise_float(P.mul(6), 2, 2, 0.5).mul(0.5).add(0.5);

  let albedo = albedo0;
  let rough = rough0;
  let metal = metal0;
  // Round E (6a): wear is never uniform on a real object — some runs of an arris are rubbed through, the next 10 cm
  // barely touched. A slow object-space field (≈ 2.5 /m, 2 octaves; Low reuses n2) scales the edge/cavity masks
  // 0.6–1.4× so worn stretches read as worn at 1–3 m instead of a thin even line (mean unchanged).
  const macro = o.cheap ? n2 : mx_fractal_noise_float(P.mul(2.5), 2, 2, 0.5).mul(0.5).add(0.5);
  const mk = macro.mul(0.8).add(0.6);
  // ---- edge (chip / abrasion), deeper second layer, chip rim
  const x = E.mul(mk).mul(n1.mul(0.45).add(0.55));
  const cov = uf(rule.edgeCov);
  const w = uf(rule.edgeWidth);
  const edge = smoothstep(cov.sub(w), cov.add(w), x);
  let r = layer(albedo, rough, metal, rule.edge, edge);
  if (rule.cov2 <= 1) {
    const c2 = uf(rule.cov2);
    r = layer(r.albedo, r.rough, r.metal, rule.edge2, smoothstep(c2.sub(w), c2.add(w), x));
  }
  if (rule.rimAmt > 0) {
    // a band just outside the chip boundary (threshold 0.03 lower): darkened paint lip / enamel rust halo
    const c3 = cov.sub(0.03);
    const rim = smoothstep(c3.sub(w), c3.add(w), x).sub(edge).clamp(0, 1);
    r.albedo = mix(r.albedo, u3(rule.rimRGB), rim.mul(uf(rule.rimAmt)));
  }
  // ---- handled (polish / skin oil)
  r = layer(r.albedo, r.rough, r.metal, rule.handled, H);
  // ---- cavity (grime, tarnish, rust bloom)
  if (rule.cavAmt > 0) {
    const brk = rule.cellular && !o.cheap ? float(1).sub(mx_worley_noise_float(P.mul(90)).clamp(0, 1)).mul(0.6).add(n2.mul(0.4)) : n2;
    const cav = smoothstep(0.3, 0.7, C.mul(mk).mul(brk.mul(0.6).add(0.6))).mul(uf(rule.cavAmt));
    r = layer(r.albedo, r.rough, r.metal, rule.cavity, cav);
  }
  albedo = r.albedo;
  rough = r.rough;
  metal = r.metal;
  // ---- dust (§2.3): where it settled in the rest pose (mask) — replaces the generic up-facing term
  const dustAmt = wearDustAmount(spec, rule);
  if (!o.noDust && dustAmt > 0 && spec.wetness < 0.3) {
    const d = D.mul(uf(dustAmt)).mul(o.dust).mul(smoothstep(0.3, 0.7, n2)).clamp(0, 1);
    albedo = mix(albedo, vec3(...DUST_RGB), d.mul(0.8));
    rough = mix(rough, float(0.97), d);
    metal = metal.mul(float(1).sub(d));
  }
  // §2.5: never brighter than physical albedo for the worn material (bare wood ≤ 0.35, primer ≤ 0.65)
  albedo = albedo.min(uf(rule.cap));
  if (WEAR_DEBUG) {
    const v = wearUniforms.view;
    const one = select(v.equal(0), M.x, select(v.equal(1), M.y, select(v.equal(2), M.z, M.w)));
    const dbg = select(v.equal(4), vec3(M.x, M.z, M.y), vec3(one));
    albedo = select(v.lessThan(0), albedo, dbg);
  }
  return { albedo, rough, metal, edge, handled: H };
}
