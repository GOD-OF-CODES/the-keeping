// Dedicated generators for the opening drive's materials (docs/C1-OPENING.md §6, §10.8): the hero sedan cabin
// (headliner, auto carpet, gas-station foam cup, gauge-cluster ABS) and the corridor's deer coat. Each builds the real
// micro-structure at its real size (cells(m) = features of m metres) and leaves the MEAN on the spec albedo
// (calibration.ts trims the rest).

import type { GenCtx, Generator, N, RGB } from '../gen-types.ts';
import { fbm01, gn, hashf, worley } from '../tsl-noise.ts';
import { abs, fract, sin } from 'three/tsl';
import { c3, float, mix, patches, smoothDown, smoothstep, tideStain, vec3 } from './common.ts';
import { MISC_GENERATORS } from './misc.ts';

const avg = (c: GenCtx): N => c3(c.spec.avgAlbedo as RGB);

/** Foam-backed knit headliner (1980s GM/Ford): a fine 1.2 mm tricot loop, nicotine yellowing toward the front
 *  (smoker's breath drifts up and forward), dust in the lows, and big soft sag pillows where the foam let go. */
const headliner: Generator = (c) => {
  const loopU = fract(c.uv.x.mul(c.cells(0.0012)));
  const loopV = fract(c.uv.y.mul(c.cells(0.0009)).add(loopU.mul(0.5)));
  const loopH = sin(loopU.mul(Math.PI)).mul(sin(loopV.mul(Math.PI)));
  const fuzzN = fbm01(c.uv, c.cells(0.0006), 2, c.seed + 1);
  const sag = fbm01(c.uv, c.cells(0.18), 3, c.seed + 2);
  const nic = fbm01(c.uv, c.cells(0.25), 3, c.seed + 3).mul(c.num('nicotine', 0.5)).add(c.uv.y.mul(0.25).mul(c.num('yellowing', 0.6)));
  let alb: N = avg(c).mul(1.08).mul(loopH.mul(0.18).add(0.86)).mul(fuzzN.mul(0.12).add(0.94));
  alb = mix(alb, alb.mul(vec3(0.95, 0.82, 0.58)), nic.clamp(0, 1).mul(0.6));
  const dust = smoothDown(0.4, 0.1, loopH).mul(c.num('dust', 0.3));
  alb = mix(alb, vec3(0.3, 0.29, 0.27), dust.mul(0.3));
  // water stain rings by the windscreen header (leaking seal): a tide line, brown
  const st = tideStain(c.uv, c.cells(0.3), 0.08, c.seed + 4);
  alb = mix(alb, alb.mul(vec3(0.82, 0.7, 0.52)), st.body.mul(0.35).add(st.rim.mul(0.5)));
  return { albedo: alb, roughness: float(0.96), height: loopH.mul(0.5).add(sag.mul(0.5)), heightDepthM: 0.0016, cavity: 0.35 };
};

/** Molded cut-pile auto carpet: 2 mm tufts in gauge rows, crushed and dark-greasy under the driver's heel pad,
 *  road grit and salt tide marks. */
const carpetAuto: Generator = (c) => {
  const t = worley(c.uv, c.cells(0.0022), c.seed, 0.9);
  const tuft = smoothDown(0.55, 0.0, t.x);
  const shade = hashf(t.z, c.seed + 1).mul(0.25).add(0.85);
  const wear = patches(c.uv, c.cells(0.12), c.num('heelWear', 0.6) * 0.45, 0.25, c.seed + 2, 3);
  const dirt = fbm01(c.uv, c.cells(0.06), 4, c.seed + 3).mul(c.num('dirt', 0.75));
  let alb: N = avg(c).mul(1.1).mul(tuft.mul(0.35).add(0.75)).mul(shade);
  alb = mix(alb, alb.mul(vec3(0.55, 0.5, 0.45)), wear.mul(0.8));
  alb = mix(alb, vec3(0.07, 0.06, 0.05), dirt.mul(0.35));
  const salt = tideStain(c.uv, c.cells(0.2), 0.12, c.seed + 4);
  alb = mix(alb, vec3(0.32, 0.3, 0.27), salt.rim.mul(0.45));
  const rough = mix(float(1.0), float(0.82), wear); // crushed pile goes greasy-flat
  return { albedo: alb, roughness: rough, height: tuft.mul(float(1).sub(wear.mul(0.7))), heightDepthM: 0.004, cavity: 0.7 };
};

/** Expanded-polystyrene cup: 2–3 mm fused beads (each a slightly different white), a dried coffee tide line. */
const styrofoam: Generator = (c) => {
  const b = worley(c.uv, c.cells(c.num('beads', 0.8) > 0 ? 0.0025 : 0.01), c.seed, 0.85);
  const bead = smoothDown(0.6, 0.05, b.x);
  const edge = smoothDown(0.06, 0.0, b.w);
  let alb: N = avg(c).mul(1.03).mul(hashf(b.z, c.seed + 1).mul(0.06).add(0.97)).mul(float(1).sub(edge.mul(0.12)));
  const st = tideStain(c.uv, c.cells(0.05), c.num('coffeeStain', 0.5) * 0.3, c.seed + 2);
  alb = mix(alb, vec3(0.32, 0.18, 0.08), st.rim.mul(0.7).add(st.body.mul(0.2)));
  return { albedo: alb, roughness: float(0.55).add(edge.mul(0.2)), height: bead.mul(0.8).add(0.2), heightDepthM: 0.0004, cavity: 0.6 };
};

/** Grained black ABS (cluster bezel, radio face, switches): a fine 0.3 mm stipple mould texture, polished where
 *  thumbs rub, grey dust in the grain and the occasional scuff. */
const plasticCluster: Generator = (c) => {
  const g = gn(c.uv, c.cells(0.0003), c.seed);
  const g2 = fbm01(c.uv, c.cells(0.0012), 2, c.seed + 1);
  const rub = patches(c.uv, c.cells(0.05), 0.2, 0.3, c.seed + 2, 3);
  const scuff = smoothDown(0.06, 0.0, abs(gn(c.uv, [c.cells(0.02), c.cells(0.004)], c.seed + 3))).mul(patches(c.uv, c.cells(0.08), c.num('scuffs', 0.3) * 0.3, 0.1, c.seed + 4, 2));
  const dust = smoothstep(0.55, 0.8, g2).mul(0.5);
  let alb: N = avg(c).mul(1.0).mul(g.mul(0.08).add(1));
  alb = mix(alb, vec3(0.12, 0.115, 0.11), dust.mul(0.25).add(scuff.mul(0.3)));
  const rough = float(0.52).sub(rub.mul(0.22)).add(dust.mul(0.15)).add(scuff.mul(0.15));
  return { albedo: alb, roughness: rough, height: g.mul(0.25).add(0.5).sub(scuff.mul(0.2)), heightDepthM: 0.00015, cavity: 0.4 };
};

/** Whitetail winter coat: hollow guard hairs ~5 cm laid along the body (u), grizzled grey-brown tips over a darker
 *  under-coat, wet clumping into partings. */
const furDeer: Generator = (c) => {
  const lanes = c.cells(0.0015);
  const hair = fract(c.uv.y.mul(lanes).add(gn(c.uv, [c.cells(0.03), c.cells(0.006)], c.seed).mul(1.5)));
  const strand = sin(hair.mul(Math.PI));
  const along = fbm01(c.uv, [c.cells(0.05), c.cells(0.002)], 2, c.seed + 1);
  const clump = smoothDown(0.08, 0.0, worley(c.uv, [c.cells(0.025), c.cells(0.012)], c.seed + 2, 1).w);
  const tip = smoothstep(0.55, 0.85, along);
  let alb: N = avg(c).mul(strand.mul(0.3).add(0.78));
  alb = mix(alb, alb.mul(vec3(1.35, 1.32, 1.28)), tip.mul(0.5));
  alb = alb.mul(float(1).sub(clump.mul(0.45)));
  return { albedo: alb, roughness: float(0.78).sub(clump.mul(0.2)), height: strand.mul(0.6).add(along.mul(0.4)).sub(clump.mul(0.4)), heightDepthM: 0.003, cavity: 0.6 };
};

/** Standing ditch water: the glass generator (grime, waviness, rain rings) at water's own albedo (the dark bed shows
 *  through ≈ 0.02); glass's palette is ~2× too bright for it. */
const waterDitch: Generator = (c) => {
  const r = MISC_GENERATORS.glass!(c);
  return { ...r, albedo: r.albedo.mul(0.5) };
};

export const OPENING_BY_ID: Record<string, Generator> = {
  headliner_cloth: headliner,
  carpet_auto: carpetAuto,
  styrofoam,
  plastic_cluster: plasticCluster,
  fur_deer: furDeer,
  water_ditch: waterDitch,
};
