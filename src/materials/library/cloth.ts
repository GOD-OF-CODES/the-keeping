// Textiles and soft goods: runner + rag rugs, woven fabrics (plain cotton dust sheet, satin, ticking, twill),
// crepe, burlap, flannel (buffalo check), nightgown fallback, leather, rubber, rope, car interior vinyl.
// All woven surfaces use a real thread-level weave (over/under per crossing) so the flashlight grazes a fibre relief.

import type { MaterialFamily } from '../../shared/material-types.ts';
import type { GenCtx, Generator, N, RGB } from '../gen-types.ts';
import { fbm, fbm01, gn, hashf, ridged, worley } from '../tsl-noise.ts';
import { abs, floor, fract, max, min, sin, sqrt } from 'three/tsl';
import { c3, dots, float, lines, mix, patches, rot45, smoothDown, smoothstep, tideStain, vec2, vec3 } from './common.ts';

type WeaveKind = 'plain' | 'twill' | 'satin' | 'basket';

interface Weave {
  h: N; // 0..1 thread relief
  warpTop: N; // 1 where the warp (v-running) thread is on top
  gap: N; // 1 in the holes between threads (open weaves)
  i: N; // warp thread index
  j: N; // weft thread index
  fu: N; // 0..1 across the crossing (u)
  fv: N; // 0..1 across the crossing (v)
}

/** Thread-level weave. `spacingM` = thread pitch; `open` 0..1 = gap between threads (burlap). */
function weave(c: GenCtx, spacingM: number, kind: WeaveKind, open = 0.1, seed = 0): Weave {
  const n = Math.min(c.cells(spacingM), Math.round(c.size / 3)); // ≥ 3 texels per thread
  const gx = c.uv.x.mul(n);
  const gy = c.uv.y.mul(n);
  // Slight thread wander so the grid isn't CG-perfect.
  const wob = fbm(c.uv, Math.max(2, Math.round(n / 16)), 2, seed + 1).mul(0.25);
  const i = floor(gx.add(wob));
  const j = floor(gy.sub(wob));
  const fu = fract(gx.add(wob));
  const fv = fract(gy.sub(wob));
  const m = (a: N, k: number) => a.sub(floor(a.add(0.5).div(k)).mul(k)); // int-safe mod
  let warpTop: N;
  if (kind === 'plain') warpTop = m(i.add(j), 2).lessThan(0.5).select(1, 0);
  else if (kind === 'basket') warpTop = m(floor(i.div(2)).add(floor(j.div(2))), 2).lessThan(0.5).select(1, 0);
  else if (kind === 'twill') warpTop = m(i.add(j), 4).lessThan(1.5).select(1, 0);
  else warpTop = m(i.mul(2).add(j), 5).lessThan(0.5).select(0, 1); // 5-shaft satin: warp floats
  // Thread thickness jitter (slubs) per thread.
  const tw = hashf(i, seed + 2).mul(0.25).add(0.75);
  const tf = hashf(j, seed + 3).mul(0.25).add(0.75);
  const halfW = 0.5 - open * 0.5;
  const warpProf = sqrt(max(float(1).sub(fu.sub(0.5).div(tw.mul(halfW)).pow(2)), 0));
  const weftProf = sqrt(max(float(1).sub(fv.sub(0.5).div(tf.mul(halfW)).pow(2)), 0));
  // The thread on top arches over the crossing (highest mid-crossing along its own length).
  const warpArch = sin(fv.mul(Math.PI)).mul(0.35).add(0.65);
  const weftArch = sin(fu.mul(Math.PI)).mul(0.35).add(0.65);
  const hWarp = warpProf.mul(warpArch);
  const hWeft = weftProf.mul(weftArch);
  const h = mix(max(hWeft, hWarp.mul(0.55)), max(hWarp, hWeft.mul(0.55)), warpTop);
  const gap = float(1).sub(smoothstep(0.0, 0.15, max(warpProf, weftProf)));
  return { h, warpTop, gap, i, j, fu, fv };
}

/** Fibre fuzz/hairiness (high-frequency directional noise). */
const fuzz = (c: GenCtx, seed: number) => gn(c.uv, [c.cells(0.004), c.cells(0.0008)], seed).mul(0.5).add(gn(c.uv, [c.cells(0.0008), c.cells(0.004)], seed + 1).mul(0.5));

// ---------------------------------------------------------------- rugs -----------------------------------

const rug: Generator = (c) => {
  if (c.str('pattern', '') === 'braided_oval') return ragRug(c);
  // Turkey runner: u along the runner, v across it (0..1 = one runner width). Border bands, guard stripes,
  // a field of hooked medallions; knotted pile (grid of tufts), worn centre path showing the warp.
  const field = c.col('field', [0.11, 0.03, 0.025]);
  const border = c.col('border', [0.05, 0.04, 0.02]);
  const v = c.uv.y;
  const u = c.uv.x;
  const dv = min(v, float(1).sub(v));
  const inBorder = smoothDown(0.16, 0.155, dv);
  const guard = smoothstep(0.155, 0.16, dv).mul(smoothDown(0.185, 0.18, dv)).add(smoothstep(0.035, 0.04, dv).mul(smoothDown(0.055, 0.05, dv)));
  // Field medallions: hooked diamonds on a lattice (2 per tile along u).
  const k = Math.max(1, Math.round(c.tile / 0.45));
  const mu = fract(u.mul(k)).sub(0.5);
  const mv = v.sub(0.5).div(0.68);
  const dia = abs(mu).mul(1.1).add(abs(mv));
  const med = smoothDown(0.42, 0.40, dia).mul(smoothstep(0.26, 0.28, dia)).add(smoothDown(0.14, 0.12, dia));
  const hooks = smoothDown(0.03, 0.02, abs(fract(dia.mul(6)).sub(0.5))).mul(smoothstep(0.28, 0.3, dia)).mul(smoothDown(0.4, 0.38, dia)).mul(0.6);
  // Border motif: running reciprocal triangles (Turkish "running dog" simplified).
  const bu = fract(u.mul(k * 6));
  const tri = smoothDown(0.02, 0.0, abs(bu.sub(dv.div(0.16)))).mul(inBorder);
  const ivory = vec3(0.32, 0.28, 0.2);
  const indigo = vec3(0.03, 0.04, 0.08);
  const gold = vec3(0.22, 0.14, 0.04);
  let col: N = c3(field);
  col = mix(col, indigo, med.clamp(0, 1));
  col = mix(col, gold, hooks);
  col = mix(col, c3(border), inBorder);
  col = mix(col, gold, tri.mul(0.8));
  col = mix(col, ivory, guard.clamp(0, 1).mul(0.8));
  // Abrash: dye-lot bands across the runner (natural dyes vary batch to batch).
  col = col.mul(fbm(vec2(u, float(0.5)), [c.cells(0.3), 1], 3, c.seed + 1).mul(0.12).add(1));
  // Pile: knot grid tufts + fibre noise.
  const knots = weave(c, 0.004, 'plain', 0.0, c.seed + 2);
  const pile = knots.h.mul(0.5).add(fuzz(c, c.seed + 3).mul(0.25)).add(0.4);
  // Worn path down the middle: pile gone, knots/foundation show (lighter, flatter, greyer), dirt.
  const worn = smoothDown(0.3, 0.12, abs(v.sub(0.5))).mul(c.num('wornPath', 0.6)).mul(fbm01(c.uv, [c.cells(0.3), 4], 4, c.seed + 4).mul(0.8).add(0.5)).clamp(0, 1);
  const warpC = vec3(0.25, 0.22, 0.17);
  let alb: N = mix(col.mul(pile.mul(0.4).add(0.8)), mix(col, warpC, knots.warpTop.mul(0.6)).mul(0.9), worn);
  alb = mix(alb, alb.mul(vec3(0.75, 0.7, 0.62)), fbm01(c.uv, c.cells(0.2), 3, c.seed + 5).mul(0.4)); // dirt
  const height = mix(pile, knots.h.mul(0.3).add(0.1), worn);
  return { albedo: alb, roughness: float(0.95), height, heightDepthM: 0.003, cavity: 0.6 };
};

function ragRug(c: GenCtx): ReturnType<Generator> {
  // Braided rag rug: rows of 3-strand braids (chevrons) along u; strand colours from a small palette of old
  // fabrics, changing every so often along the braid (the maker ran out of a scrap).
  const rows = c.cells(0.035);
  const v = c.uv.y.mul(rows);
  const row = floor(v);
  const t = fract(v);
  const along = c.uv.x.mul(c.cells(0.018));
  const chev = fract(along.add(abs(t.sub(0.5)).mul(1.4)));
  const strand = floor(fract(along.mul(1 / 3)).mul(3));
  const seg = floor(c.uv.x.mul(c.cells(0.25)).add(hashf(row, c.seed).mul(4)));
  const pick = hashf(seg.mul(7).add(row.mul(131)).add(strand.mul(17)), c.seed + 1);
  const palette = [
    [0.18, 0.05, 0.04],
    [0.05, 0.07, 0.12],
    [0.2, 0.17, 0.1],
    [0.08, 0.1, 0.05],
    [0.22, 0.2, 0.17],
  ] as RGB[];
  let col: N = c3(palette[0]);
  for (let i = 1; i < palette.length; i++) col = mix(col, c3(palette[i]), smoothstep(i / palette.length - 0.001, i / palette.length, pick));
  const bump = sin(chev.mul(Math.PI)).mul(sin(t.mul(Math.PI)));
  const dirt = c.num('dirt', 0.6);
  let alb: N = col.mul(bump.mul(0.35).add(0.7)).mul(fuzz(c, c.seed + 2).mul(0.12).add(1));
  alb = mix(alb, alb.mul(vec3(0.7, 0.65, 0.55)), fbm01(c.uv, c.cells(0.2), 3, c.seed + 3).mul(dirt * 0.6));
  const groove = smoothDown(0.1, 0.0, min(t, float(1).sub(t)));
  alb = alb.mul(float(1).sub(groove.mul(0.5)));
  return { albedo: alb, roughness: float(0.95), height: bump.mul(0.8).sub(groove.mul(0.3)).add(0.2), heightDepthM: 0.006, cavity: 0.6 };
}

// ---------------------------------------------------------------- woven fabrics --------------------------

const fabric: Generator = (c) => {
  const kindP = c.str('weave', 'plain_cotton');
  const kind: WeaveKind = kindP === 'satin' ? 'satin' : kindP === 'twill' ? 'twill' : 'plain';
  const spacing = kind === 'satin' ? 0.0008 : kind === 'twill' ? 0.0016 : 0.0012;
  const w = weave(c, spacing, kind, 0.05, c.seed);
  const avg = c.spec.avgAlbedo as RGB;
  let base: N = c3(avg).mul(1.06);
  if (kindP === 'ticking_stripe') {
    // Ticking: narrow indigo stripes on off-white, in groups.
    const x = fract(c.uv.x.mul(c.cells(0.03)));
    const stripe = smoothDown(0.28, 0.26, abs(x.sub(0.5))).mul(smoothstep(0.1, 0.12, abs(x.sub(0.5))));
    base = mix(c3([0.4, 0.38, 0.34]), c3(c.col('stripe', [0.05, 0.06, 0.1])), stripe.mul(0.9));
  }
  if (c.spec.id === 'wool_coats') {
    // Heathered wool: mixed light/dark fibres (coat-to-coat colour variants are per mesh, not in the texture).
    base = base.mul(fbm01(c.uv, c.cells(0.002), 2, c.seed + 9).mul(0.35).add(0.82));
  }
  // Thread tone: warp vs weft differ slightly; satin warp floats are brighter/glossier.
  const threadTone = mix(float(0.92), float(1.06), w.warpTop).mul(hashf(w.i, c.seed + 4).mul(0.06).add(0.97));
  let alb: N = base.mul(threadTone).mul(w.h.mul(0.25).add(0.8)).mul(fuzz(c, c.seed + 5).mul(0.06).add(1));
  let rough: N = kind === 'satin' ? mix(float(0.55), float(0.3), w.warpTop) : float(c.spec.roughness);
  // Yellowing (age), foxing (rust-brown spots), stains (tide-marked), dust (grey film, stronger on raised threads).
  const yel = c.num('yellowing', 0);
  alb = mix(alb, alb.mul(vec3(1.02, 0.95, 0.78)), fbm01(c.uv, c.cells(0.4), 3, c.seed + 6).mul(yel));
  const fox = c.num('foxing', 0);
  if (fox > 0) {
    const f = dots(c.uv, c.cells(0.015), 0.4, fox * 0.15, c.seed + 7);
    alb = mix(alb, alb.mul(vec3(0.7, 0.52, 0.35)), f.mask.mul(float(1).sub(f.d.mul(0.5))));
  }
  // Stains on small tiles would repeat every few cm: those are a world-space layer in bind.ts instead.
  const stains = c.tile >= 0.5 ? c.num('stains', 0) : 0;
  if (stains > 0) {
    const st = tideStain(c.uv, c.cells(0.3), stains * 0.4, c.seed + 8);
    alb = mix(alb, alb.mul(vec3(0.72, 0.62, 0.45)), st.body.mul(0.7)).mul(float(1).sub(st.rim.mul(0.3)));
  }
  const dust = c.num('dust', 0);
  alb = mix(alb, vec3(0.42, 0.4, 0.36), fbm01(c.uv, c.cells(0.15), 4, c.seed + 10).mul(dust * 0.35).add(w.h.mul(dust * 0.1)).clamp(0, 1));
  rough = mix(rough, float(0.97), float(dust * 0.5));
  // Fold creases (a stored dust sheet): long ridged lines.
  const creases = c.num('foldCreases', 0);
  let creaseH: N = float(0);
  if (creases > 0) {
    creaseH = ridged(c.uv, [c.cells(0.8), c.cells(0.25)], 3, c.seed + 11).pow(3).mul(creases);
    alb = alb.mul(float(1).sub(creaseH.mul(0.12)));
  }
  return { albedo: alb, roughness: rough, height: w.h.mul(0.12).add(creaseH.mul(0.88)), heightDepthM: creases > 0 ? 0.004 : kind === 'satin' ? 0.0002 : 0.0005, cavity: 0.3 };
};

const crepe: Generator = (c) => {
  // Mourning crepe: crinkled black silk — dense random micro-wrinkles (ridged, anisotropic), slightly rusty-faded.
  const wr = ridged(c.uv, [c.cells(0.004), c.cells(0.006)], 3, c.seed);
  const wr2 = ridged(rot45(c.uv), [c.cells(0.005), c.cells(0.004)], 2, c.seed + 1);
  const h = max(wr, wr2).mul(c.num('crinkle', 0.8));
  const fade = fbm01(c.uv, c.cells(0.1), 3, c.seed + 2).mul(c.num('fade', 0.2));
  const alb = mix(vec3(0.014, 0.013, 0.013), vec3(0.03, 0.025, 0.02), fade).mul(h.mul(0.4).add(0.8));
  return { albedo: alb, roughness: float(0.85).sub(h.mul(0.15)), height: h, heightDepthM: 0.0004, cavity: 0.2 };
};

const burlap: Generator = (c) => {
  // Coarse jute: open plain weave with visible holes (dark), hairy stray fibres, oil/feed stains.
  const w = weave(c, c.num('weave', 0.004), 'plain', 0.28, c.seed);
  const jute = mix(vec3(0.3, 0.22, 0.12), vec3(0.4, 0.31, 0.18), hashf(w.i.add(w.j.mul(0.37)), c.seed + 1));
  let alb: N = jute.mul(w.h.mul(0.35).add(0.75)).mul(fuzz(c, c.seed + 2).mul(0.15).add(1));
  const hair = lines(c.uv, [c.cells(0.03), c.cells(0.006)], 0.04, c.seed + 3).mul(0.4);
  alb = alb.add(hair.mul(0.04));
  alb = mix(alb, vec3(0.02, 0.015, 0.01), w.gap.mul(0.9));
  return { albedo: alb, roughness: float(0.95), height: w.h.add(hair.mul(0.2)), heightDepthM: 0.0015, cavity: 0.4 };
};

const flannel: Generator = (c) => {
  // Buffalo check: red and black yarn blocks in warp and weft → red / black / mixed squares, twill + brushed nap.
  const w = weave(c, 0.0012, 'twill', 0.0, c.seed);
  const n = c.cells(c.num('checkSize', 0.05));
  const redWarp = fract(c.uv.x.mul(n).mul(0.5)).lessThan(0.5);
  const redWeft = fract(c.uv.y.mul(n).mul(0.5)).lessThan(0.5);
  const red = vec3(0.3, 0.03, 0.03);
  const black = c3(c.col('secondary', [0.02, 0.02, 0.02]));
  const warpC = redWarp.select(red, black);
  const weftC = redWeft.select(red, black);
  const top = mix(weftC, warpC, w.warpTop);
  const under = mix(warpC, weftC, w.warpTop);
  const nap = fbm01(c.uv, c.cells(0.004), 3, c.seed + 1); // brushed fibres blur the weave
  let alb: N = mix(top, under, float(0.3).add(nap.mul(0.2))).mul(w.h.mul(0.2).add(0.85));
  const pill = dots(c.uv, c.cells(0.004), 0.4, c.num('pilling', 0.6) * 0.3, c.seed + 2).mask;
  alb = mix(alb, alb.mul(0.8).add(0.01), pill.mul(0.5));
  return { albedo: alb, roughness: float(0.92), height: w.h.mul(0.5).add(nap.mul(0.3)).add(pill.mul(0.3)), heightDepthM: 0.0006, cavity: 0.3 };
};

const nightgown: Generator = (c) => {
  // Fine cotton lawn, yellowed; river silt dried in tide marks, heavier toward the hem (v low).
  const w = weave(c, 0.0006, 'plain', 0.05, c.seed);
  const base = c3(c.col('base', [0.55, 0.52, 0.44]));
  let alb: N = base.mul(w.h.mul(0.15).add(0.9));
  const hem = float(1).sub(smoothstep(0.0, 0.6, c.uv.y));
  const siltN = fbm01(c.uv, c.cells(0.12), 5, c.seed + 1).mul(0.6).add(hem.mul(c.num('siltAmount', 0.6) * 0.7)).add(fbm01(c.uv, c.cells(0.01), 3, c.seed + 4).mul(0.2));
  const silt = smoothstep(0.6, 0.8, siltN);
  const rim = smoothDown(0.02, 0.0, abs(siltN.sub(0.6))).mul(0.5);
  alb = mix(alb, c3(c.col('silt', [0.12, 0.13, 0.08])).mul(fbm01(c.uv, c.cells(0.01), 3, c.seed + 2).mul(0.5).add(0.75)), silt.mul(0.85));
  alb = alb.mul(float(1).sub(rim.mul(0.35)));
  return { albedo: alb, roughness: mix(float(0.75), float(0.9), silt), height: w.h.mul(0.5).add(silt.mul(0.2)), heightDepthM: 0.0003, cavity: 0.3 };
};

// ---------------------------------------------------------------- leather / rubber / rope ----------------

const leather: Generator = (c) => {
  const grain = worley(c.uv, c.cells(0.0025), c.seed, 1);
  const pebble = smoothstep(0.0, 0.25, grain.w).mul(c.num('grain', 0.5) * 1.2 + 0.4);
  const crease = lines(c.uv, [c.cells(0.04), c.cells(0.015)], 0.05, c.seed + 1).mul(c.num('creases', 0.6));
  const crease2 = lines(c.uv.add(vec2(fbm(c.uv, c.cells(0.05), 3, c.seed + 4), fbm(c.uv, c.cells(0.05), 3, c.seed + 5)).mul(0.08)), [c.cells(0.03), c.cells(0.03)], 0.04, c.seed + 2).mul(c.num('creases', 0.6) * 0.5).mul(patches(c.uv, c.cells(0.06), 0.5, 0.2, c.seed + 6, 3));
  const wear = patches(c.uv, c.cells(0.08), c.num('wear', 0.5) * 0.5, 0.2, c.seed + 3, 4);
  const base = c3(c.spec.avgAlbedo as RGB).mul(1.1);
  let alb: N = base.mul(pebble.mul(0.2).add(0.9));
  alb = mix(alb, base.mul(vec3(2.2, 1.9, 1.6)), wear.mul(0.5)); // scuffed through the finish
  alb = alb.mul(float(1).sub(max(crease, crease2).mul(0.35)));
  const rough = float(0.5).add(wear.mul(0.25)).sub(pebble.mul(0.05));
  return { albedo: alb, roughness: rough, height: pebble.mul(0.5).sub(max(crease, crease2).mul(0.4)).add(0.4), heightDepthM: 0.0005, cavity: 0.6 };
};

const rubber: Generator = (c) => {
  // Black rubber sheet/apron: glossy, ozone cracks (short parallel fissures), scuffs, dusty bloom where dry.
  const ozone = lines(c.uv, [c.cells(0.03), c.cells(0.002)], 0.04, c.seed).mul(patches(c.uv, c.cells(0.08), c.num('cracks', 0.35), 0.1, c.seed + 1, 3));
  const scuff = lines(rot45(c.uv), [c.cells(0.06), c.cells(0.01)], 0.08, c.seed + 2).mul(patches(c.uv, c.cells(0.12), c.num('scuffs', 0.4) * 0.5, 0.1, c.seed + 3, 3));
  const bloom = fbm01(c.uv, c.cells(0.1), 4, c.seed + 4).mul(0.5);
  let alb: N = vec3(0.016, 0.016, 0.017).mul(float(1).add(bloom.mul(0.4)));
  alb = mix(alb, vec3(0.05, 0.05, 0.05), scuff.mul(0.6));
  const rough = float(0.35).sub(c.num('sheen', 0.5) * 0.1).add(bloom.mul(0.2)).add(scuff.mul(0.35)).add(ozone.mul(0.3));
  return { albedo: alb, roughness: rough, height: float(0.6).sub(ozone.mul(0.5)).add(fbm(c.uv, c.cells(0.03), 3, c.seed + 5).mul(0.08)), heightDepthM: 0.0006, cavity: 0.3 };
};

const rope: Generator = (c) => {
  // 3-strand hawser laid rope: u along the rope, v around it. Strands spiral (diagonal bands), each made of
  // yarns twisted the other way (fine opposite diagonals), with fuzz and grime.
  const strands = c.num('strands', 3);
  const k = c.cells(0.018); // lay length per strand
  const s = fract(c.uv.x.mul(k).add(c.uv.y.mul(strands)));
  const strandProf = sin(s.mul(Math.PI));
  const yarn = fract(c.uv.x.mul(k * 6).sub(c.uv.y.mul(strands * 5)));
  const yarnProf = sin(yarn.mul(Math.PI)).mul(0.35);
  const h = strandProf.mul(0.75).add(yarnProf.mul(strandProf));
  const hemp = c3(c.spec.avgAlbedo as RGB).mul(1.15);
  const grime = fbm01(c.uv, c.cells(0.05), 3, c.seed + 1).mul(c.num('grime', 0.5));
  let alb: N = hemp.mul(h.mul(0.45).add(0.65)).mul(fuzz(c, c.seed + 2).mul(0.15).add(1));
  alb = mix(alb, alb.mul(vec3(0.45, 0.4, 0.35)), grime);
  alb = alb.mul(float(1).sub(smoothDown(0.08, 0.0, min(s, float(1).sub(s))).mul(0.5)));
  return { albedo: alb, roughness: float(0.92), height: h, heightDepthM: 0.004, cavity: 0.5 };
};

const carInterior: Generator = (c) => {
  // Vinyl seats/dash: fine embossed grain, cracked in the sun, velour inserts (napped, darker) in bands.
  const grain = worley(c.uv, c.cells(0.0015), c.seed, 1);
  const emb = smoothstep(0.0, 0.2, grain.w);
  const vinyl = c3(c.col('vinyl', [0.3, 0.22, 0.14]));
  // Sun crazing (AD review: the old 3 cm cells read as a cartoon pattern on a 28 mm rim): real UV-aged vinyl crazes
  // in a 3–6 mm network of hairline cracks (~0.3 mm), in patches a few cm across where the sun hits; the large
  // dash cracks are real geometry on sedan_interior v2. Widths are in cell units, so 0.07 × 4.5 mm ≈ 0.3 mm.
  const cr = worley(c.uv, c.cells(0.0045), c.seed + 1, 1);
  const craze = Math.max(c.num('dashCrack', 0.4), c.num('sunCraze', 0));
  const crack = smoothDown(0.07, 0.0, cr.w).mul(0.8).mul(patches(c.uv, c.cells(0.035), craze, 0.15, c.seed + 2, 3));
  const velour = smoothstep(0.45, 0.55, fract(c.uv.y.mul(c.cells(0.25)))).mul(c.num('velour', 0.5) > 0 ? 1 : 0);
  const nap = fbm01(c.uv, c.cells(0.002), 3, c.seed + 3);
  let alb: N = vinyl.mul(emb.mul(0.1).add(0.93));
  alb = mix(alb, vinyl.mul(0.7).mul(nap.mul(0.2).add(0.9)), velour);
  alb = mix(alb, vec3(0.03, 0.025, 0.02), crack.mul(float(1).sub(velour)));
  const rough = mix(float(0.55).add(emb.mul(0.1)), float(0.95), velour);
  return { albedo: alb, roughness: rough, height: emb.mul(0.3).add(0.5).sub(crack.mul(0.5)).add(velour.mul(nap).mul(0.2)), heightDepthM: 0.0006, cavity: 0.5 };
};

const needlepoint: Generator = (c) => {
  // Berlin wool-work (round E, R3: the embroidered bell pull). Tent stitches on 10-count canvas (2.54 mm pitch): each
  // stitch is a slanted twisted wool tuft over one canvas crossing; the design is quantised PER STITCH from a mirrored
  // floral field into a period palette (claret ground, black outline, sage, old gold, cream). Aniline reds fade toward
  // brown, the raised wool catches dust, the canvas shows dark in the gaps. Wool ρ 0.03–0.45, rough 0.9.
  const n = Math.min(c.cells(0.00254), Math.floor(c.size / 4));
  const g = c.uv.mul(n);
  const cell = floor(g);
  const f = fract(g);
  const cc = cell.add(0.5).div(n);
  const mir = vec2(abs(cc.x.mul(2).sub(1)), cc.y);
  const m = fbm01(mir, [Math.max(1, Math.round(c.cells(0.05) / 2)), c.cells(0.05)], 3, c.seed);
  const m2 = fbm01(mir, [Math.max(1, Math.round(c.cells(0.02) / 2)), c.cells(0.02)], 2, c.seed + 1);
  const v = m.mul(0.75).add(m2.mul(0.25));
  const claret = vec3(0.1, 0.018, 0.02);
  let col: N = claret;
  col = mix(col, vec3(0.018, 0.014, 0.012), smoothstep(0.545, 0.55, v)); // outline
  col = mix(col, vec3(0.06, 0.085, 0.035), smoothstep(0.575, 0.58, v)); // sage leaves
  col = mix(col, vec3(0.3, 0.19, 0.055), smoothstep(0.65, 0.655, v)); // old gold
  col = mix(col, vec3(0.42, 0.37, 0.27), smoothstep(0.74, 0.745, v)); // cream highlights
  // Per-stitch yarn tone (hand-dyed lots) and dye fading (reds → brown) over the strip.
  col = col.mul(hashf(cell.x.add(cell.y.mul(7919)), c.seed + 2).mul(0.16).add(0.92));
  const fade = fbm01(c.uv, c.cells(0.15), 3, c.seed + 3).mul(c.num('fade', 0.4));
  col = mix(col, col.mul(vec3(0.85, 1.25, 1.2)).add(vec3(0.015, 0.012, 0.008)), fade);
  // Stitch relief: a tuft along the (0,0)→(1,1) diagonal, twisted plies, dark canvas at the open corners.
  const dDiag = abs(f.x.sub(f.y)).mul(0.7071);
  const tuft = float(1).sub(smoothstep(0.22, 0.42, dDiag));
  const ply = sin(f.x.add(f.y).mul(9.42).add(f.x.sub(f.y).mul(6))).mul(0.5).add(0.5);
  const h = tuft.mul(ply.mul(0.25).add(0.75));
  const gap = float(1).sub(tuft).mul(smoothstep(0.38, 0.5, dDiag));
  let alb: N = col.mul(h.mul(0.35).add(0.75)).mul(fuzz(c, c.seed + 4).mul(0.08).add(1));
  alb = mix(alb, vec3(0.09, 0.075, 0.055), gap.mul(0.7));
  const dust = c.num('dust', 0.4);
  alb = mix(alb, vec3(0.34, 0.32, 0.28), h.mul(fbm01(c.uv, c.cells(0.1), 3, c.seed + 5)).mul(dust * 0.25).clamp(0, 1));
  return { albedo: alb, roughness: float(0.88).add(gap.mul(0.07)).add(dust * 0.04), height: h.mul(0.85).add(0.1), heightDepthM: 0.0012, cavity: 0.55 };
};

/** Cloth materials whose generator differs from their family's. */
export const CLOTH_BY_ID: Record<string, Generator> = { wool_needlepoint: needlepoint };

export const CLOTH_GENERATORS: Partial<Record<MaterialFamily, Generator>> = {
  rug,
  fabric,
  crepe,
  burlap,
  flannel,
  nightgown,
  leather,
  rubber,
  rope,
  car_interior: carInterior,
};
