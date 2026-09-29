// Glass (grime, fly specks, rain streaks/droplets), candle wax, aged paper, and the skin / hair fallbacks used
// until the characters' baked textures exist (bind.ts falls back here when a baked_unique asset has no map).

import type { MaterialFamily } from '../../shared/material-types.ts';
import type { Generator, N, RGB } from '../gen-types.ts';
import { fbm, fbm01, gn, worley } from '../tsl-noise.ts';
import { abs, fract, max } from 'three/tsl';
import { c3, dots, float, lines, mix, patches, smoothDown, smoothstep, tideStain, vec2, vec3 } from './common.ts';

const glass: Generator = (c) => {
  // B.a = opacity/grime. Grime film collects in the lower part of the pane (v low) and in wiped arcs; fly specks;
  // rain: vertical streak channels + droplets (lensing is faked by the normal).
  const grime = c.num('grime', 0.5);
  const film = fbm01(c.uv, c.cells(0.3), 5, c.seed).mul(0.6).add(float(1).sub(smoothstep(0.0, 0.7, c.uv.y)).mul(0.4)).mul(grime).clamp(0, 1);
  const wipe = smoothDown(0.03, 0.0, abs(fract(vec2(c.uv.x.sub(0.5), c.uv.y.sub(0.1)).length().mul(3)).sub(0.5))).mul(0.3).mul(grime);
  const specks = dots(c.uv, c.cells(0.01), 0.25, c.num('fly_specks', 0) * 0.4, c.seed + 1).mask;
  let opacity: N = film.mul(0.7).add(wipe).add(specks).clamp(0, 1);
  let albedo: N = mix(vec3(0.04, 0.04, 0.04), vec3(0.12, 0.11, 0.09), film).mul(float(1).sub(specks.mul(0.8)));
  let rough: N = float(c.spec.roughness).add(film.mul(0.5));
  let height: N = gn(c.uv, [1, 3], c.seed + 2).mul(c.num('waviness', 0) * 0.3).add(0.5); // crown glass waviness
  const rainAmt = c.num('rainStreaks', 0);
  const drops = c.num('droplets', 0);
  if (rainAmt > 0 || drops > 0) {
    const chanX = fract(c.uv.x.mul(c.cells(0.012)).add(fbm(c.uv, [c.cells(0.05), c.cells(0.3)], 3, c.seed + 3).mul(0.4)));
    const chan = smoothDown(0.12, 0.0, abs(chanX.sub(0.5))).mul(smoothstep(0.35, 0.7, fbm01(c.uv, [c.cells(0.012), c.cells(0.4)], 3, c.seed + 4))).mul(rainAmt);
    const w = worley(c.uv, c.cells(0.006), c.seed + 5, 1);
    const r = w.z.mul(0.35).add(0.12);
    const drop = smoothDown(r, r.mul(0.8), w.x).mul(smoothstep(1 - drops * 0.6, 1 - drops * 0.6 + 0.01, w.z.oneMinus().add(0.4)));
    const dome = float(1).sub(w.x.div(r).pow(2)).max(0).mul(drop);
    height = height.add(dome.mul(0.6)).add(chan.mul(0.25));
    rough = rough.mul(float(1).sub(max(drop, chan).mul(0.8)));
    opacity = opacity.mul(float(1).sub(chan.mul(0.8))).add(drop.mul(0.08)); // rain washes the grime
  }
  return { albedo, roughness: rough, height, heightDepthM: 0.0008, cavity: 0, extra: opacity };
};

const wax: Generator = (c) => {
  // Tallow/beeswax: creamy, translucent-looking (lighter, low contrast), drips (vertical runs along v), soot.
  const drips = smoothstep(0.45, 0.85, fbm01(c.uv, [c.cells(0.01), c.cells(0.06)], 4, c.seed)).mul(c.num('drips', 0.8));
  const base = c3(c.spec.avgAlbedo as RGB).mul(1.04);
  let alb: N = base.mul(fbm(c.uv, c.cells(0.02), 3, c.seed + 1).mul(0.04).add(1)).mul(drips.mul(0.06).add(0.97));
  const soot = fbm01(c.uv, c.cells(0.05), 3, c.seed + 2).mul(c.num('soot', 0.3)).mul(smoothstep(0.5, 1.0, c.uv.y));
  alb = alb.mul(float(1).sub(soot.mul(0.5)));
  return { albedo: alb, roughness: float(0.4).sub(drips.mul(0.15)), height: drips.mul(0.6).add(0.3), heightDepthM: 0.002, cavity: 0.15 };
};

const paper: Generator = (c) => {
  // Aged rag paper: fibre mottle, faint ruled lines, foxing spots, water damage tide marks, cockling.
  const fib = fbm(c.uv, c.cells(0.004), 3, c.seed).mul(0.04).add(gn(c.uv, c.cells(0.0012), c.seed + 1).mul(0.02));
  const base = c3(c.spec.avgAlbedo as RGB).mul(1.04);
  let alb: N = base.mul(fib.add(1)).mul(mix(vec3(1, 1, 1), vec3(0.95, 0.9, 0.78), fbm01(c.uv, 2, 3, c.seed + 2)));
  if (c.flag('ruled', false)) {
    const ln = smoothDown(0.06, 0.03, abs(fract(c.uv.y.mul(c.cells(0.008))).sub(0.5)));
    alb = mix(alb, vec3(0.22, 0.28, 0.38), ln.mul(0.35));
  }
  const fox = dots(c.uv, c.cells(0.015), 0.45, c.num('foxing', 0) * 0.35, c.seed + 3);
  alb = mix(alb, alb.mul(vec3(0.72, 0.55, 0.38)), fox.mask.mul(float(1).sub(fox.d.mul(0.6))));
  const st = tideStain(c.uv, c.cells(0.15), c.num('waterDamage', 0) * 0.5, c.seed + 4);
  alb = mix(alb, alb.mul(vec3(0.85, 0.75, 0.6)), st.body.mul(0.6)).mul(float(1).sub(st.rim.mul(0.35)));
  const cockle = fbm(c.uv, c.cells(0.08), 3, c.seed + 5).mul(st.body.mul(0.8).add(0.2));
  return { albedo: alb, roughness: float(c.spec.roughness), height: cockle.mul(0.5).add(0.5).add(fib), heightDepthM: 0.0015, cavity: 0.2 };
};

const skin: Generator = (c) => {
  // Fallback skin: pores, fine creases, blotchy tone (lividity / liver spots), veins for the drowned girl.
  const tone = c3(c.col('tone', c.spec.avgAlbedo as RGB));
  const pores = dots(c.uv, c.cells(0.0012), 0.3, 0.6, c.seed).mask;
  const creases = lines(c.uv, [c.cells(0.02), c.cells(0.004)], 0.03, c.seed + 1).mul(0.5);
  const blotch = fbm01(c.uv, c.cells(0.04), 4, c.seed + 2);
  let alb: N = tone.mul(blotch.mul(0.12).add(0.94)).mul(float(1).sub(pores.mul(0.08)));
  const veins = c.num('veins', 0);
  if (veins > 0) {
    const v = lines(c.uv, [c.cells(0.05), c.cells(0.03)], 0.02, c.seed + 3).mul(patches(c.uv, c.cells(0.1), veins * 0.6, 0.2, c.seed + 4, 3));
    alb = mix(alb, vec3(0.16, 0.2, 0.3), v.mul(0.45));
  }
  const liv = c.num('lividity', 0) + c.num('liverSpots', 0);
  if (liv > 0) alb = mix(alb, alb.mul(vec3(0.75, 0.62, 0.72)), smoothstep(0.6, 0.85, blotch).mul(liv));
  const wrinkle = c.num('wrinklingFromWater', 0) > 0 ? lines(c.uv, [c.cells(0.008), c.cells(0.002)], 0.1, c.seed + 5).mul(0.3) : float(0);
  return { albedo: alb, roughness: float(c.spec.roughness).add(pores.mul(0.1)), height: float(0.6).sub(pores.mul(0.3)).sub(creases.mul(0.3)).sub(wrinkle.mul(0.3)), heightDepthM: 0.0003, cavity: 0.3 };
};

const hair: Generator = (c) => {
  // Fallback hair: strand streaks along v, clumped, wet-glossy.
  const strands = gn(c.uv, [c.cells(0.0008), c.cells(0.1)], c.seed).mul(0.5).add(0.5);
  const clump = fbm01(c.uv, [c.cells(0.01), c.cells(0.3)], 3, c.seed + 1);
  const base = c3(c.spec.avgAlbedo as RGB);
  const alb = base.mul(strands.mul(0.6).add(0.7)).mul(clump.mul(0.4).add(0.8));
  return { albedo: alb, roughness: float(c.spec.roughness).add(strands.mul(0.1)), height: strands.mul(0.6).add(clump.mul(0.4)), heightDepthM: 0.0008, cavity: 0.4 };
};

export const MISC_GENERATORS: Partial<Record<MaterialFamily, Generator>> = {
  glass,
  wax,
  paper,
  skin,
  hair,
};


