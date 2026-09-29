// Wall + masonry families: damask wallpapers (pattern, water stains, peeling seams), the tally wall, damp plaster,
// ceiling plaster, glazed tile + grout, brick + mortar, rubble stone foundation.

import type { MaterialFamily } from '../../shared/material-types.ts';
import type { GenCtx, Generator, N, RGB } from '../gen-types.ts';
import { fbm, fbm01, gn, hashf, worley } from '../tsl-noise.ts';
import { abs, atan, cos, exp, floor, fract, max, min, sin, sqrt, vec2 as v2 } from 'three/tsl';
import { c3, cracks, dots, float, lines, mix, patches, smoothDown, smoothstep, tideStain, vec2, vec3 } from './common.ts';
import { specById } from '../spec-index.ts';

// ---------------------------------------------------------------- damask motif -----------------------------

/** Soft ellipse mask centred at c with radii r, rotated by a (radians). aa in local units. */
function ellipse(q: N, cx: number, cy: number, rx: number, ry: number, a: number, aa: number): N {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const dx = q.x.sub(cx);
  const dy = q.y.sub(cy);
  const x = dx.mul(ca).add(dy.mul(sa)).div(rx);
  const y = dy.mul(ca).sub(dx.mul(sa)).div(ry);
  const d = sqrt(x.mul(x).add(y.mul(y)));
  return float(1).sub(smoothstep(1 - aa / Math.min(rx, ry), 1 + aa / Math.min(rx, ry), d));
}

/** Ring arc (scroll) mask: circle radius R about (cx,cy), width w, restricted to an angular window. */
function arc(q: N, cx: number, cy: number, R: number, w: number, a0: number, a1: number, aa: number): N {
  const dx = q.x.sub(cx);
  const dy = q.y.sub(cy);
  const r = sqrt(dx.mul(dx).add(dy.mul(dy)));
  const ang = atan(dy, dx);
  const ring = float(1).sub(smoothstep(w - aa, w + aa, abs(r.sub(R))));
  const win = smoothstep(a0 - 0.08, a0 + 0.08, ang).mul(float(1).sub(smoothstep(a1 - 0.08, a1 + 0.08, ang)));
  return ring.mul(win);
}

/**
 * Mirror-symmetric damask motif in a local frame q ∈ [-1,1]² (x mirrored). Three variants (a/b/c).
 * Returns 0..1 figure coverage.
 */
function damaskMotif(q0: N, variant: string, aa: number): N {
  const q = vec2(abs(q0.x), q0.y);
  const v = variant.endsWith('b') ? 1 : variant.endsWith('c') ? 2 : 0;
  // Central flower: petalled rosette.
  const fx = q0.x;
  const fy = q0.y.sub(0.05);
  const r = sqrt(fx.mul(fx).add(fy.mul(fy).mul(1.15)));
  const th = atan(fy, fx);
  const petals = [6, 8, 5][v];
  const rose = float(0.2).mul(cos(th.mul(petals)).mul(0.22).add(0.78));
  let m: N = float(1).sub(smoothstep(rose.sub(aa), rose.add(aa), r));
  m = m.mul(float(1).sub(float(1).sub(smoothstep(0.05, 0.05 + aa, r)).mul(0.9))); // hollow eye
  m = max(m, float(1).sub(smoothstep(0.025, 0.025 + aa, r))); // centre dot
  // Big side leaves (serrated edge via a sin on the radius).
  const leafA = [0.75, 0.55, 0.95][v];
  m = max(m, ellipse(q, 0.34, -0.3, 0.3, 0.1, leafA, aa)); // lower leaves sweep up-outward (vase)
  m = max(m, ellipse(q, 0.26, 0.34, 0.2, 0.07, -leafA * 0.6, aa)); // upper leaves droop outward
  // Palmette fan above.
  for (let i = -2; i <= 2; i++) {
    const a = Math.PI / 2 + i * 0.32;
    m = max(m, ellipse(q0, Math.cos(a) * 0.2, 0.52 + Math.sin(a) * 0.2, 0.14, 0.035, a, aa));
  }
  // Scrolls (C-curves) at the sides.
  m = max(m, arc(q, 0.62, 0.05, 0.16, 0.022, -2.2, 1.6, aa));
  m = max(m, arc(q, 0.56, -0.55, 0.12, 0.018, -0.3, 3.0, aa));
  // Stem + pendant bud below.
  m = max(m, float(1).sub(smoothstep(0.018, 0.018 + aa, q.x)).mul(smoothstep(-0.8, -0.75, q0.y)).mul(float(1).sub(smoothstep(-0.2, -0.15, q0.y))));
  m = max(m, ellipse(q0, 0, -0.82, 0.07, 0.1, 0, aa));
  // Variant c: ogee frame line.
  if (v === 2) {
    const ogX = float(0.8).mul(cos(q0.y.mul(Math.PI / 2)));
    m = max(m, float(1).sub(smoothstep(0.012, 0.012 + aa, abs(q.x.sub(ogX)))).mul(0.8));
  }
  // Leaf veins cut back into the figure (tone-on-tone detail).
  const vein = float(1).sub(smoothstep(0.006, 0.006 + aa, abs(q.y.add(0.3).sub(q.x.sub(0.34).mul(Math.tan(leafA)))))).mul(ellipse(q, 0.34, -0.3, 0.26, 0.07, leafA, aa));
  return m.mul(float(1).sub(vein.mul(0.8))).clamp(0, 1);
}

/** Small secondary sprig (between main motifs). */
function sprig(q0: N, aa: number): N {
  const q = vec2(abs(q0.x), q0.y);
  let m: N = ellipse(q, 0.12, 0.05, 0.14, 0.05, 0.6, aa);
  m = max(m, ellipse(q0, 0, 0.2, 0.05, 0.12, 0, aa));
  m = max(m, ellipse(q0, 0, -0.08, 0.05, 0.05, 0, aa));
  return m;
}

function wallpaper(c: GenCtx, forTally = false): { albedo: N; roughness: N; height: N; peelMask: N } {
  const seed = c.seed;
  const uv = c.uv;
  // The baked tile may hold k×k paper repeats (super-tile): strips are one repeat wide.
  const k = Math.max(1, Math.round(c.tile / c.num('seamSpacing', c.spec.tileMetres)));
  const stripM = c.tile / k;
  const wob = v2(fbm(uv, 3 * k, 2, seed + 90), fbm(uv, 3 * k, 2, seed + 91)).mul(0.003 / k); // print registration wobble
  const p = fract(uv.add(wob).mul(k));
  const aa = (3.0 * k) / c.size;
  // Diamond lattice: main motif at the repeat centre, secondary sprigs at the corners.
  const qMain = p.sub(0.5).mul(v2(2.2, 1.9));
  const cq = p.sub(v2(p.x.greaterThan(0.5).select(1, 0), p.y.greaterThan(0.5).select(1, 0))); // to nearest corner
  const qSec = cq.mul(v2(3.2, 3.2));
  const variant = c.str('motif', 'damask_a');
  const fig = max(damaskMotif(qMain, variant, aa), sprig(qSec, aa * 1.5));
  const ground = c.col('ground', [0.09, 0.12, 0.075]);
  const figure = c.col('figure', [0.06, 0.08, 0.05]);
  // Paper: fibrous mottle; printed figure has ink texture + a slight gloss.
  const fibre = gn(uv, [c.cells(0.01), c.cells(0.004)], seed + 1).mul(0.03).add(fbm(uv, c.cells(0.12), 4, seed + 2).mul(0.06));
  const inkTex = fbm01(uv, c.cells(0.004), 2, seed + 3);
  let alb: N = mix(c3(ground), c3(figure).mul(inkTex.mul(0.15).add(0.92)), fig).mul(fibre.add(1));
  let rough: N = mix(float(c.spec.roughness), float(c.spec.roughness - c.num('figureGloss', 0.2)), fig);
  // Per-strip tone shift (different print runs / uneven fading).
  const strip = floor(uv.x.mul(k));
  alb = alb.mul(hashf(strip, seed + 12).sub(0.5).mul(0.06).add(1));

  const fade = c.num('fade', 0);
  if (fade > 0) alb = mix(alb, alb.mul(vec3(1.25, 1.2, 1.12)).add(0.02), fbm01(uv, 2, 3, seed + 4).mul(fade));
  const smoke = c.num('smokeStain', 0);
  if (smoke > 0) alb = alb.mul(mix(vec3(1, 1, 1), vec3(0.8, 0.72, 0.55), fbm01(uv, 1, 3, seed + 5).mul(smoke)));

  // Small-scale damp in the texture (large tide-marked stains are a world-space layer in bind.ts, so they
  // never repeat): thin brown runs down the paper + mould freckles.
  const damp = c.num('damp', 0.3);
  const run = smoothstep(0.62, 0.95, fbm01(uv, [c.cells(0.05), 1], 4, seed + 7)).mul(damp);
  const brown = vec3(0.62, 0.46, 0.26);
  alb = mix(alb, alb.mul(brown), run.mul(0.45));
  const frM = patches(uv, c.cells(0.3), damp * 0.4, 0.2, seed + 13, 3);
  const freckle = dots(uv, c.cells(0.008), 0.35, 0.35, seed + 8).mask.mul(frM);
  alb = mix(alb, c3([0.02, 0.022, 0.015]), freckle.mul(0.7));

  // Seams every strip: hairline gap; in places the edge lifts and peels back, the old sizing/plaster shows.
  const fx = fract(uv.x.mul(k));
  const du = min(fx, float(1).sub(fx)).mul(stripM); // metres from the seam
  const peelAmt = c.num('peel', 0.25);
  const lift = fbm01(uv, [k, c.cells(0.45)], 4, seed + 9);
  const peelW = smoothstep(0.62 - peelAmt * 0.3, 0.95, lift).mul(peelAmt * 0.1); // metres of paper gone
  const peelOn = smoothstep(0.0008, 0.003, peelW);
  const peeled = float(1).sub(smoothstep(peelW, peelW.add(0.0015), du)).mul(peelOn);
  const sizing = vec3(0.17, 0.15, 0.11).mul(fbm01(uv, c.cells(0.05), 3, seed + 10).mul(0.35).add(0.75));
  // The lifted edge curls: a lighter paper back + shadow band just beyond it.
  const curlZone = smoothstep(peelW, peelW.add(0.002), du).mul(float(1).sub(smoothstep(peelW.add(0.002), peelW.add(0.009), du))).mul(peelOn);
  const shadow = smoothstep(peelW.add(0.004), peelW.add(0.009), du).mul(float(1).sub(smoothstep(peelW.add(0.009), peelW.add(0.02), du))).mul(peelOn);
  const seamLine = float(1).sub(smoothstep(0.0002, 0.0007, du));
  alb = mix(alb, sizing, peeled).mul(float(1).sub(seamLine.mul(0.45))).mul(float(1).add(curlZone.mul(0.25))).mul(float(1).sub(shadow.mul(0.2)));
  rough = mix(rough, float(0.95), peeled);
  // Occasional tears away from the seam.
  const tear = patches(uv, c.cells(0.5), peelAmt * 0.025, 0.006, seed + 11, 5).mul(forTally ? 0 : 1);
  alb = mix(alb, sizing, tear);
  const height = float(0.6).add(fig.mul(0.04)).sub(peeled.mul(0.4)).add(curlZone.mul(0.45)).sub(seamLine.mul(0.15)).add(fibre.mul(0.3)).sub(tear.mul(0.3));
  return { albedo: alb, roughness: rough, height, peelMask: max(peeled, tear) };
}

const wallpaperGen: Generator = (c) => {
  const w = wallpaper(c);
  return { albedo: w.albedo, roughness: w.roughness, height: w.height, heightDepthM: 0.0006, cavity: 0.4 };
};

/** Room 3: ochre damask covered with ~6000 graphite tally marks (groups of five, the fifth struck through). */
const wallTally: Generator = (c) => {
  const baseSpec = specById(c.str('base', 'wallpaper_damask_ochre'));
  const bc: GenCtx = baseSpec ? { ...c, spec: baseSpec, num: (n, d) => (typeof baseSpec.params[n] === 'number' ? (baseSpec.params[n] as number) : d), col: (n, d) => { const v = baseSpec.params[n]; return Array.isArray(v) ? (v.slice(0, 3) as RGB) : d; }, str: (n, d) => (typeof baseSpec.params[n] === 'string' ? (baseSpec.params[n] as string) : d) } : c;
  // Tally wall tile is 5 m: the wallpaper repeat inside it must be 0.53 m → sample the paper at uv·(5/0.53 rounded).
  const k = Math.max(1, Math.round(c.tile / (baseSpec?.tileMetres ?? 0.53)));
  const paper = wallpaper({ ...bc, uv: fract(c.uv.mul(k)), tile: c.tile / k, size: Math.round(c.size / k) * 4 }, true);
  const uv = c.uv;
  // Tally grid: groups of 4 strokes + a diagonal; cell = one group.
  const sl = c.num('strokeLength', 0.045);
  // Strokes narrower than ~1.3 texels would vanish at 5 m/tile: widen to stay visible (coverage stays plausible).
  const sw = Math.max(c.num('strokeWidth', 0.003), (1.3 * c.tile) / c.size);
  const gw = sl * 1.35; // group width (m)
  const cols = Math.max(1, Math.round(c.tile / gw));
  const rowsN = Math.max(1, Math.round(c.tile / (sl * 1.5)));
  const g = v2(uv.x.mul(cols), uv.y.mul(rowsN));
  const cell = floor(g);
  const f = fract(g);
  const h = hashf(cell.x.add(cell.y.mul(997)), c.seed + 5);
  const jit = v2(hashf(cell.x.mul(3).add(cell.y.mul(13)), c.seed + 6).sub(0.5).mul(0.15), h.sub(0.5).mul(0.2));
  const q = f.add(jit).mul(v2(gw, sl * 1.5)); // metres within the cell
  let ink: N = float(0);
  const slant = h.sub(0.5).mul(0.25);
  for (let i = 0; i < 4; i++) {
    const x0 = 0.006 + i * sl * 0.22;
    const dx = abs(q.x.sub(x0).sub(q.y.sub(sl * 0.2).mul(slant)));
    const onY = smoothstep(sl * 0.2 - 0.001, sl * 0.2, q.y).mul(float(1).sub(smoothstep(sl * 1.2, sl * 1.2 + 0.001, q.y)));
    ink = max(ink, float(1).sub(smoothstep(sw * 0.3, sw * 0.6, dx)).mul(onY));
  }
  // The fifth: a diagonal through the four.
  const dd = abs(q.y.sub(sl * 0.2).sub(q.x.sub(0.0).mul(0.72)));
  const onX = smoothstep(0.0, 0.002, q.x).mul(float(1).sub(smoothstep(sl * 0.9, sl * 0.9 + 0.002, q.x)));
  ink = max(ink, float(1).sub(smoothstep(sw * 0.3, sw * 0.6, dd)).mul(onX));
  // Pencil texture: broken strokes, pressure variation; density thins toward the top limit (v in metres = z).
  const grainP = fbm01(uv, [c.cells(0.004), c.cells(0.001)], 2, c.seed + 7);
  const heightM = uv.y.mul(c.tile);
  const top = float(1).sub(smoothstep(c.num('topLimit', 2.3) - 0.2, c.num('topLimit', 2.3), heightM));
  const fillN = fbm01(uv, 4, 3, c.seed + 8);
  const present = smoothstep(0.25, 0.35, fillN.mul(0.6).add(top.mul(0.6)).sub(0.1)).mul(top);
  ink = ink.mul(grainP.mul(0.6).add(0.55)).mul(present).clamp(0, 1);
  const graphite = c3(c.col('strokeColor', [0.035, 0.035, 0.04]));
  const alb = mix(paper.albedo, graphite, ink.mul(0.85));
  const rough = mix(paper.roughness, float(1 - c.num('graphiteGloss', 0.35)), ink);
  return { albedo: alb, roughness: rough, height: paper.height, heightDepthM: 0.0006, cavity: 0.3 };
};

// ---------------------------------------------------------------- plaster ---------------------------------

function plasterBase(c: GenCtx, base: RGB): { alb: N; h: N } {
  // Hand-troweled lime plaster: broad undulation + trowel arcs + fine sand grain.
  const und = fbm(c.uv, c.cells(0.6), 4, c.seed + 1);
  const trowel = fbm(v2(c.uv.x.add(c.uv.y.mul(0.5)), c.uv.y), [c.cells(0.25), c.cells(0.08)], 3, c.seed + 2);
  const sand = gn(c.uv, c.cells(0.0015), c.seed + 3).mul(0.5).add(gn(c.uv, c.cells(0.003), c.seed + 4).mul(0.5));
  const tone = und.mul(0.05).add(trowel.mul(0.04)).add(sand.mul(0.03)).add(1);
  return { alb: c3(base).mul(tone), h: und.mul(0.35).add(trowel.mul(0.25)).add(sand.mul(0.06)).add(0.5) };
}

const plaster: Generator = (c) => {
  const pb = plasterBase(c, c.col('base', [0.46, 0.43, 0.36]));
  let alb: N = pb.alb;
  let rough: N = float(c.spec.roughness);
  let h: N = pb.h;
  // Rising damp: darker band from the floor (v = height in metres on walls) with a salt tide line.
  const rd = c.num('riseDampHeight', 0.8);
  const heightM = c.uv.y.mul(c.tile);
  const edgeN = fbm(c.uv, [c.cells(0.3), 2], 4, c.seed + 5).mul(0.15);
  const dampM = float(1).sub(smoothstep(rd - 0.05, rd + 0.05, heightM.add(edgeN)));
  const tide = exp(heightM.add(edgeN).sub(rd).div(0.025).mul(heightM.add(edgeN).sub(rd).div(0.025)).negate());
  alb = alb.mul(float(1).sub(dampM.mul(0.3))).mul(mix(vec3(1, 1, 1), vec3(0.92, 0.88, 0.8), dampM));
  // Efflorescence: white salt bloom at the tide line and in patches within the damp zone.
  const eff = c.num('efflorescence', 0.3);
  const salt = tide.mul(0.7).add(patches(c.uv, c.cells(0.2), eff * 0.5, 0.15, c.seed + 6).mul(dampM)).mul(eff * 1.5).clamp(0, 1).mul(fbm01(c.uv, c.cells(0.01), 3, c.seed + 7));
  alb = mix(alb, vec3(0.7, 0.69, 0.65), salt.mul(0.8));
  rough = rough.add(salt.mul(0.05));
  // Mould blooms: dark clustered speckle with a greenish-black core and soft halo.
  const mould = c.num('mould', 0.45);
  const bloom = patches(c.uv, c.cells(0.5), mould * 0.45, 0.2, c.seed + 8, 5);
  const speck = dots(c.uv, c.cells(0.004), 0.45, 0.55, c.seed + 9).mask;
  const mDens = bloom.mul(speck.mul(0.7).add(bloom.mul(0.4))).clamp(0, 1);
  alb = mix(alb, c3([0.035, 0.04, 0.03]), mDens.mul(0.85));
  alb = mix(alb, alb.mul(vec3(0.85, 0.83, 0.72)), bloom.mul(0.4)); // halo staining
  // Cracks (fine, branching) with dirt in them + small plaster losses.
  const cr = cracks(c.uv, c.cells(0.35), 0.03, c.num('cracks', 0.5) * 0.7, c.seed + 10);
  alb = alb.mul(float(1).sub(cr.mul(0.6)));
  h = h.sub(cr.mul(0.5));
  const loss = patches(c.uv, c.cells(0.3), c.num('cracks', 0.5) * 0.05, 0.01, c.seed + 11, 5);
  alb = mix(alb, vec3(0.3, 0.27, 0.22), loss.mul(0.8));
  h = h.sub(loss.mul(0.4));
  return { albedo: alb, roughness: rough, height: h, heightDepthM: 0.004, cavity: 0.5 };
};

const ceilingPlaster: Generator = (c) => {
  const pb = plasterBase(c, c.col('base', [0.55, 0.52, 0.44]));
  let alb: N = pb.alb;
  let h: N = pb.h;
  // Brown water stains with multiple tide rings (leaks from the roof).
  const st = tideStain(c.uv, c.cells(1.2), c.num('waterStains', 0.45) * 0.5, c.seed + 5);
  alb = mix(alb, alb.mul(vec3(0.8, 0.66, 0.45)), st.body.mul(0.7)).mul(float(1).sub(st.rim.mul(0.4)));
  // Soot above lamps: soft dark blotches.
  const soot = patches(c.uv, c.cells(1.5), c.num('smokeAboveLights', 0.35) * 0.4, 0.3, c.seed + 6, 3);
  alb = alb.mul(float(1).sub(soot.mul(0.35)));
  // Cracks: long map cracks (bigger cells), hairline.
  const cr = cracks(c.uv, c.cells(0.6), 0.02, c.num('cracks', 0.4) * 0.8, c.seed + 7);
  alb = alb.mul(float(1).sub(cr.mul(0.55)));
  h = h.sub(cr.mul(0.6)).add(fbm(c.uv, c.cells(1.2), 2, c.seed + 8).mul(c.num('sagging', 0.1) * 2));
  return { albedo: alb, roughness: float(c.spec.roughness).add(st.body.mul(0.03)), height: h, heightDepthM: 0.003, cavity: 0.5 };
};

// ---------------------------------------------------------------- glazed tile -----------------------------

const tile: Generator = (c) => {
  const n = c.cells(c.num('tileSize', 0.15));
  const g = c.uv.mul(n);
  const f = fract(g);
  const id = hashf(floor(g.x).add(floor(g.y).mul(131)), c.seed);
  const tileM = c.tile / n;
  const gw = c.num('groutWidth', 0.004);
  const dEdge = min(min(f.x, float(1).sub(f.x)), min(f.y, float(1).sub(f.y))).mul(tileM);
  const grout = float(1).sub(smoothstep(gw * 0.5, gw * 0.5 + 0.0006, dEdge));
  // Glaze: slightly domed (pillowed edges), per-tile tint, crazing network, grime settling near the grout.
  const pillow = smoothstep(gw * 0.5, gw * 0.5 + 0.004, dEdge);
  const base = c3(c.spec.avgAlbedo as RGB).mul(1.08).mul(id.mul(0.08).add(0.96));
  const craze = worley(c.uv, c.cells(0.012), c.seed + 3, 1).w;
  const crazing = float(1).sub(smoothstep(0.0, 0.04, craze)).mul(c.num('crazing', 0.5)).mul(patches(c.uv, c.cells(0.3), 0.6, 0.2, c.seed + 4, 3));
  const grimeAmt = c.num('grime', 0.5);
  const nearGrout = float(1).sub(smoothstep(0.0, 0.02, dEdge.sub(gw * 0.5)));
  const grime = nearGrout.mul(0.5).add(patches(c.uv, c.cells(0.2), 0.3, 0.25, c.seed + 5, 4).mul(0.4)).mul(grimeAmt);
  let alb: N = base.mul(float(1).sub(crazing.mul(0.35))).mul(float(1).sub(grime.mul(0.25)));
  alb = mix(alb, alb.mul(vec3(0.85, 0.8, 0.7)), grime.mul(0.4));
  const groutC = c3(c.col('grout', [0.2, 0.19, 0.16])).mul(fbm01(c.uv, c.cells(0.01), 3, c.seed + 6).mul(0.4).add(0.8));
  alb = mix(alb, groutC, grout);
  // Chips at tile corners.
  const chip = dots(c.uv, n, 0.12, 0.15, c.seed + 7).mask.mul(float(1).sub(grout));
  alb = mix(alb, vec3(0.3, 0.28, 0.25), chip);
  const rough = mix(float(0.08).add(grime.mul(0.35)).add(crazing.mul(0.1)), float(0.9), max(grout, chip));
  const height = pillow.mul(0.7).add(0.1).sub(crazing.mul(0.05)).sub(chip.mul(0.4)).add(gn(c.uv, c.cells(0.05), c.seed + 8).mul(0.05));
  return { albedo: alb, roughness: rough, height, heightDepthM: 0.003, cavity: 0.4 };
};

// ---------------------------------------------------------------- brick ----------------------------------

const brick: Generator = (c) => {
  const size = (c.spec.params.brickSize as number[] | undefined) ?? [0.2, 0.09];
  const mortarW = 0.01;
  const cols = c.cells(size[0] + mortarW);
  const rows = c.cells(size[1] + mortarW);
  const bondHeader = c.str('bond', 'stretcher') === 'common';
  const gy = c.uv.y.mul(rows);
  const row = floor(gy);
  // Running bond: half offset each course; common bond: every 6th course is headers (double count).
  const header = bondHeader ? fract(row.div(6)).lessThan(0.08) : float(0).greaterThan(1);
  const colsR = header.select(float(cols * 2), float(cols));
  const off = fract(row.mul(0.5)).mul(1).add(hashf(row, c.seed).mul(0.08));
  const gx = c.uv.x.mul(colsR).add(off);
  const f = v2(fract(gx), fract(gy));
  const bid = hashf(floor(gx).add(row.mul(257)), c.seed + 1);
  const bid2 = hashf(floor(gx).add(row.mul(263)), c.seed + 2);
  const bw = header.select(float(c.tile / (cols * 2)), float(c.tile / cols));
  const bh = c.tile / rows;
  const sloppy = c.num('sloppy', 0.3);
  // Irregular, chipped arrises: warped edge distance + Worley bites out of the corners.
  const edgeN = fbm(c.uv, c.cells(0.03), 3, c.seed + 3).mul(0.003 + sloppy * 0.004);
  const bite = worley(c.uv, c.cells(0.025), c.seed + 12, 1);
  const dx = min(f.x, float(1).sub(f.x)).mul(bw);
  const dy = min(f.y, float(1).sub(f.y)).mul(bh);
  const d = min(dx, dy).add(edgeN).sub(smoothDown(0.3, 0.1, bite.x).mul(smoothstep(0.7, 0.72, bite.z)).mul(0.006));
  const mortar = float(1).sub(smoothstep(mortarW * 0.5 - 0.001, mortarW * 0.5 + 0.0008, d));
  const arris = smoothstep(mortarW * 0.5, mortarW * 0.5 + 0.007, d); // rounded, worn brick edges
  // Brick body: fired clay, strong per-brick variation (salmon underfired, dark overfired clinkers), speckle.
  const clay = c3(c.spec.avgAlbedo as RGB).mul(1.12);
  const pale = smoothstep(0.86, 0.9, bid2);
  const clinker = smoothDown(0.12, 0.08, bid2);
  let variant: N = mix(vec3(1.0, 1.0, 1.0), vec3(1.35, 1.3, 1.25), pale);
  variant = mix(variant, vec3(0.45, 0.38, 0.42), clinker);
  const flash = smoothstep(0.4, 1.0, fbm01(c.uv, c.cells(0.12), 3, c.seed + 4)).mul(0.3);
  const speck = dots(c.uv, c.cells(0.006), 0.35, 0.35, c.seed + 5).mask;
  const pits = dots(c.uv, c.cells(0.004), 0.3, 0.25, c.seed + 13).mask;
  let alb: N = clay.mul(variant).mul(bid.mul(0.45).add(0.75)).mul(float(1).sub(flash)).mul(float(1).sub(speck.mul(0.35))).mul(float(1).sub(pits.mul(0.3)));
  alb = alb.mul(fbm(c.uv, c.cells(0.03), 4, c.seed + 6).mul(0.18).add(1));
  // Spalling: faces broken away, lighter raw clay, rough.
  const spall = patches(c.uv, c.cells(0.1), c.num('spalling', 0) * 0.25, 0.02, c.seed + 7, 5).mul(float(1).sub(mortar));
  alb = mix(alb, alb.mul(vec3(1.25, 1.1, 1.0)), spall);
  // Mortar: lime, recessed, gritty, weathered and dirty.
  const mortarC = c3(c.col('mortar', [0.35, 0.33, 0.28])).mul(fbm01(c.uv, c.cells(0.005), 3, c.seed + 8).mul(0.4).add(0.6));
  alb = mix(alb, mortarC, mortar);
  // Soot / rain grime: vertical streaks + overall darkening; efflorescence where wet.
  const soot = c.num('soot', 0);
  alb = alb.mul(float(1).sub(smoothstep(0.45, 0.85, fbm01(c.uv, [c.cells(0.1), c.cells(0.8)], 4, c.seed + 9)).mul(soot * 0.55)));
  const eff = patches(c.uv, c.cells(0.3), c.spec.wetness * 0.15, 0.1, c.seed + 14, 4).mul(fbm01(c.uv, c.cells(0.01), 2, c.seed + 15));
  alb = mix(alb, vec3(0.45, 0.43, 0.4), eff.mul(0.5));
  const bump = gn(c.uv, c.cells(0.012), c.seed + 10).mul(0.07).add(fbm(c.uv, c.cells(0.06), 3, c.seed + 11).mul(0.12));
  const squish = c.num('mortarSquish', 0) * 0.3;
  const height = arris.mul(0.85).add(mortar.mul(squish * 0.5)).add(bump).sub(spall.mul(0.3)).sub(pits.mul(0.1));
  const rough = mix(float(c.spec.roughness), float(0.95), mortar);
  return { albedo: alb, roughness: rough, height, heightDepthM: c.num('mortarRecess', 0.008) + 0.004, cavity: 0.6 };
};

// ---------------------------------------------------------------- rubble stone ----------------------------

const stone: Generator = (c) => {
  const cells = c.cells(c.num('stoneSize', 0.35));
  const wuv = c.uv.add(v2(fbm(c.uv, cells * 2, 3, c.seed + 1), fbm(c.uv, cells * 2, 3, c.seed + 2)).mul(0.12 / cells));
  const w = worley(wuv, cells, c.seed, 0.85);
  const joint = float(1).sub(smoothstep(0.04, 0.09, w.w));
  const dome = smoothstep(0.0, 0.35, w.w).mul(0.6).add(0.4);
  const rock = mix(vec3(0.2, 0.19, 0.17), vec3(0.14, 0.14, 0.135), w.z).mul(fbm(c.uv, c.cells(0.05), 5, c.seed + 3).mul(0.25).add(1));
  const veins = lines(c.uv, [c.cells(0.2), c.cells(0.15)], 0.02, c.seed + 4).mul(0.15);
  let alb: N = rock.mul(float(1).add(veins));
  alb = mix(alb, c3(c.col('mortar', [0.3, 0.29, 0.26])).mul(fbm01(c.uv, c.cells(0.01), 3, c.seed + 5).mul(0.3).add(0.8)), joint);
  // Moss in the joints and on the lower stones.
  const moss = smoothstep(0.35, 0.8, fbm01(c.uv, c.cells(0.08), 4, c.seed + 6).add(joint.mul(0.3))).mul(c.num('moss', 0.4));
  alb = mix(alb, vec3(0.05, 0.07, 0.02), moss.mul(0.8));
  const height = dome.mul(float(1).sub(joint.mul(0.7))).add(fbm(c.uv, c.cells(0.04), 4, c.seed + 7).mul(0.12));
  return { albedo: alb, roughness: mix(float(0.85), float(0.95), moss), height, heightDepthM: 0.03, cavity: 0.6 };
};

export const WALL_GENERATORS: Partial<Record<MaterialFamily, Generator>> = {
  wallpaper: wallpaperGen,
  plaster,
  ceiling_plaster: ceilingPlaster,
  tile,
  brick,
  stone,
};

export const WALL_BY_ID: Record<string, Generator> = {
  wall_tally: wallTally,
};

void sin;
