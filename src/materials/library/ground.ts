// Exterior ground + roof families: wet gravel, wet asphalt (puddles, cracks, centre line), mud (tyre tracks),
// wet grass, bark, asphalt shingles.

import type { MaterialFamily } from '../../shared/material-types.ts';
import type { Generator, N } from '../gen-types.ts';
import { fbm, fbm01, gn, hashf, worley } from '../tsl-noise.ts';
import { abs, floor, fract, max, min } from 'three/tsl';
import { c3, cracks, dots, float, lines, mix, patches, smoothDown, smoothstep, vec2, vec3 } from './common.ts';

// ---------------------------------------------------------------- gravel ---------------------------------

const gravel: Generator = (c) => {
  const size = c.num('stoneSize', 0.025);
  // Two stone layers (big + small) as rounded Worley cells, mud filling between.
  const w1 = worley(c.uv, c.cells(size), c.seed, 0.9);
  const w2 = worley(c.uv.add(vec2(0.37, 0.61)), c.cells(size * 0.55), c.seed + 1, 0.9);
  const s1 = smoothstep(0.02, 0.22, w1.w); // stone interior (1) → gap (0)
  const s2 = smoothstep(0.02, 0.2, w2.w);
  const dome1 = s1.mul(float(1).sub(w1.x.mul(w1.x).mul(0.9)));
  const dome2 = s2.mul(float(1).sub(w2.x.mul(w2.x).mul(0.9))).mul(0.7);
  const top = max(dome1, dome2);
  const which = dome1.greaterThan(dome2);
  const id = which.select(w1.z, w2.z);
  // Stone colours: greys, buff limestone, a few dark basalt and rusty ones.
  const grey = mix(vec3(0.24, 0.23, 0.21), vec3(0.12, 0.12, 0.12), id);
  const buff = vec3(0.3, 0.26, 0.2);
  const rusty = vec3(0.26, 0.16, 0.1);
  const stoneC = mix(mix(grey, buff, smoothstep(0.7, 0.75, id)), rusty, smoothstep(0.92, 0.95, id)).mul(fbm(c.uv, c.cells(size * 0.3), 3, c.seed + 2).mul(0.2).add(1));
  const mudFill = c.num('mudFill', 0.4);
  const mudC = vec3(0.07, 0.055, 0.04).mul(fbm01(c.uv, c.cells(0.05), 3, c.seed + 3).mul(0.4).add(0.8));
  const mudLevel = fbm01(c.uv, c.cells(0.4), 4, c.seed + 4).mul(0.5).add(mudFill * 0.5);
  const buried = smoothstep(mudLevel.sub(0.05), mudLevel.add(0.05), top).oneMinus();
  let alb: N = mix(stoneC, mudC, buried);
  let height: N = max(top, mudLevel.mul(0.8));
  // Ruts: two parallel low bands along u (vehicle tracks), wetter.
  let rut: N = float(0);
  if (c.flag('ruts', false)) {
    const y = fract(c.uv.y.add(fbm(c.uv, [1, 2], 3, c.seed + 5).mul(0.03)));
    rut = max(smoothDown(0.12, 0.0, abs(y.sub(0.3))), smoothDown(0.12, 0.0, abs(y.sub(0.72))));
    height = height.sub(rut.mul(0.3));
  }
  const pud = c.num('puddles', 0.35);
  const lowN = fbm01(c.uv, c.cells(0.8), 4, c.seed + 6).add(rut.mul(0.35));
  const puddle = smoothstep(1 - pud * 0.7, 1.02 - pud * 0.65, lowN).mul(float(1).sub(top.mul(0.6)));
  alb = mix(alb, mudC.mul(0.7), puddle.mul(0.5));
  return { albedo: alb, roughness: mix(float(0.55), float(0.85), buried), height, heightDepthM: size * 0.5, cavity: 0.7, puddle };
};

// ---------------------------------------------------------------- asphalt --------------------------------

const asphalt: Generator = (c) => {
  // Binder with exposed aggregate (polished by tyres → lighter chips), cracks with weeds/tar seal, patches,
  // worn centre line, puddles in the low areas.
  const agg = worley(c.uv, c.cells(0.008), c.seed, 1);
  const chip = smoothDown(0.35, 0.15, agg.x).mul(smoothstep(0.35, 0.7, agg.z)).mul(c.num('aggregate', 0.5) * 1.6).clamp(0, 1);
  const binder = vec3(0.035, 0.035, 0.037).mul(fbm(c.uv, c.cells(0.3), 4, c.seed + 1).mul(0.2).add(1));
  const chipC = mix(vec3(0.16, 0.155, 0.15), vec3(0.09, 0.085, 0.08), agg.z);
  let alb: N = mix(binder, chipC, chip.mul(0.55));
  let height: N = chip.mul(0.35).add(fbm(c.uv, c.cells(0.03), 3, c.seed + 2).mul(0.1)).add(0.4);
  // Patches: darker, smoother rectangles-ish of newer tar.
  const patch = patches(c.uv, c.cells(1.2), c.num('patches', 0.3) * 0.5, 0.01, c.seed + 3, 3);
  alb = mix(alb, vec3(0.02, 0.02, 0.021), patch.mul(0.8));
  // Cracks: alligator network + long cracks; tar-sealed (glossy black) or open (with grit).
  const cr = cracks(c.uv, c.cells(0.25), 0.04, c.num('cracks', 0.4), c.seed + 4);
  alb = mix(alb, vec3(0.012, 0.012, 0.012), cr.mul(0.8));
  height = height.sub(cr.mul(0.4));
  // Centre line (yellow paint, worn to fragments) — along u at v = 0.5 of the tile (road UVs run u along the road).
  const lineC = c3(c.col('centreLine', [0.75, 0.6, 0.15]));
  const lw = 0.1 / c.tile; // 10 cm line
  const onLine = smoothDown(lw * 0.5 + 0.002, lw * 0.5, abs(c.uv.y.sub(0.5)));
  const dashes = smoothDown(0.02, 0.0, abs(fract(c.uv.x.mul(Math.max(1, Math.round(c.tile / 3)))).sub(0.25)).sub(0.25)); // 3 m dash pattern
  const wear = c.num('centreLineWear', 0.7);
  const paintLeft = smoothstep(wear * 0.8, wear * 0.8 + 0.1, fbm01(c.uv, c.cells(0.05), 4, c.seed + 5).add(chip.mul(-0.2)));
  const paint = onLine.mul(dashes).mul(paintLeft);
  alb = mix(alb, lineC.mul(0.8), paint);
  const pud = c.num('puddles', 0.5);
  const lowN = fbm01(c.uv, c.cells(1.5), 5, c.seed + 6);
  const puddle = smoothstep(1 - pud * 0.55, 1.02 - pud * 0.5, lowN);
  height = height.sub(lowN.mul(0.3));
  return { albedo: alb, roughness: mix(float(0.55), float(0.3), patch).add(chip.mul(0.1)), height, heightDepthM: 0.006, cavity: 0.5, puddle };
};

// ---------------------------------------------------------------- mud -----------------------------------

const mud: Generator = (c) => {
  const base = c.col('base', [0.075, 0.055, 0.038]);
  const n = fbm(c.uv, c.cells(0.4), 5, c.seed);
  const clumps = fbm01(c.uv, c.cells(0.04), 4, c.seed + 1);
  let height: N = n.mul(0.3).add(clumps.mul(0.3)).add(0.3);
  // Tyre tracks: two bands along u with a chevron tread (tile-periodic).
  const tt = c.num('tyreTracks', 0.4);
  const y = fract(c.uv.y.add(fbm(c.uv, [1, 1], 3, c.seed + 2).mul(0.04)));
  const trackW = 0.18 / c.tile;
  const inTrack = max(smoothDown(trackW, trackW * 0.7, abs(y.sub(0.3))), smoothDown(trackW, trackW * 0.7, abs(y.sub(0.75))));
  const tread = fract(c.uv.x.mul(c.cells(0.035)).add(abs(fract(y.mul(c.tile / 0.18)).sub(0.5)).mul(0.8)));
  const treadH = smoothstep(0.4, 0.5, tread).mul(float(1).sub(smoothstep(0.8, 0.9, tread)));
  const track = inTrack.mul(tt).mul(patches(c.uv, [1, 3], 0.75, 0.2, c.seed + 3, 3));
  height = mix(height, float(0.15).add(treadH.mul(0.12)), track);
  const clr = c3(base).mul(clumps.mul(0.4).add(0.8)).mul(n.mul(0.15).add(1));
  // Debris: twigs (thin dark lines) + leaf litter (flat brown blotches).
  const deb = c.num('debris', 0.3);
  const twig = lines(c.uv, [c.cells(0.15), c.cells(0.03)], 0.03, c.seed + 4).mul(patches(c.uv, c.cells(0.2), deb * 0.5, 0.1, c.seed + 5, 3));
  const leaf = dots(c.uv, c.cells(0.06), 0.35, deb * 0.4, c.seed + 6).mask;
  let alb: N = mix(clr, vec3(0.03, 0.022, 0.015), twig.mul(0.8));
  alb = mix(alb, vec3(0.12, 0.07, 0.03), leaf.mul(0.7));
  height = height.add(twig.mul(0.1)).add(leaf.mul(0.05));
  const pud = c.num('puddles', 0.6);
  const lowN = fbm01(c.uv, c.cells(0.7), 4, c.seed + 7).add(track.mul(0.25));
  const puddle = smoothstep(1 - pud * 0.6, 1.02 - pud * 0.56, lowN);
  return { albedo: alb, roughness: float(0.55).sub(clumps.mul(0.15)), height, heightDepthM: 0.03, cavity: 0.5, puddle };
};

// ---------------------------------------------------------------- grass (wet) ---------------------------

const grass: Generator = (c) => {
  // Top-down matted wet grass: dense blade strokes in random directions (three rotated line sets), dead straw
  // patches, weeds (broad leaves), mud showing through.
  const dead = c.num('dead', 0.5);
  const b1 = lines(c.uv, [c.cells(0.12), c.cells(0.004)], 0.08, c.seed);
  const b2 = lines(vec2(c.uv.x.add(c.uv.y), c.uv.x.sub(c.uv.y)), [c.cells(0.1), c.cells(0.005)], 0.08, c.seed + 1);
  const b3 = lines(vec2(c.uv.y, c.uv.x), [c.cells(0.12), c.cells(0.0045)], 0.08, c.seed + 2);
  const blades = max(max(b1, b2), b3);
  const deadM = patches(c.uv, c.cells(0.5), dead * 0.8, 0.2, c.seed + 3, 4);
  const green = mix(vec3(0.04, 0.07, 0.02), vec3(0.07, 0.09, 0.03), fbm01(c.uv, c.cells(0.1), 3, c.seed + 4));
  const straw = vec3(0.15, 0.12, 0.06);
  const bladeC = mix(green, straw, deadM);
  const soil = vec3(0.04, 0.03, 0.02);
  let alb: N = mix(soil, bladeC, blades.mul(c.num('bladeDensity', 0.7) * 0.5 + 0.5));
  // Weeds: clusters of broad leaves (elongated cells in two orientations), not round dots.
  const wA = worley(c.uv, [c.cells(0.03), c.cells(0.012)], c.seed + 5, 1);
  const wB = worley(vec2(c.uv.y, c.uv.x), [c.cells(0.03), c.cells(0.012)], c.seed + 7, 1);
  const leafM = max(smoothstep(0.08, 0.2, wA.w), smoothstep(0.08, 0.2, wB.w)).mul(patches(c.uv, c.cells(0.25), c.num('weeds', 0.5) * 0.3, 0.1, c.seed + 8, 3));
  const weeds = { mask: leafM };
  alb = mix(alb, mix(vec3(0.04, 0.07, 0.02), vec3(0.07, 0.1, 0.03), wA.z), weeds.mask.mul(0.85));
  const height = blades.mul(0.5).add(weeds.mask.mul(0.3)).add(fbm01(c.uv, c.cells(0.3), 3, c.seed + 6).mul(0.3));
  return { albedo: alb, roughness: mix(float(0.7), float(0.85), deadM), height, heightDepthM: 0.012, cavity: 0.7 };
};

// ---------------------------------------------------------------- bark ----------------------------------

const bark: Generator = (c) => {
  // Deeply furrowed bark: vertical (v) ridges from anisotropic ridged noise, broken into plates; lichen patches.
  const r = fbm01(vec2(c.uv.x, c.uv.y), [c.cells(0.05), c.cells(0.3)], 5, c.seed);
  const plates = worley(c.uv, [c.cells(0.06), c.cells(0.18)], c.seed + 1, 1);
  const ridge = smoothstep(0.3, 0.7, r).mul(smoothstep(0.02, 0.15, plates.w));
  const alb0 = mix(vec3(0.025, 0.02, 0.016), vec3(0.09, 0.075, 0.06), ridge).mul(fbm(c.uv, c.cells(0.02), 3, c.seed + 2).mul(0.25).add(1));
  const lichen = patches(c.uv, c.cells(0.15), c.num('lichen', 0.3) * 0.5, 0.05, c.seed + 3, 5).mul(ridge);
  const alb = mix(alb0, mix(vec3(0.18, 0.2, 0.14), vec3(0.1, 0.12, 0.06), fbm01(c.uv, c.cells(0.01), 2, c.seed + 4)), lichen.mul(0.85));
  return { albedo: alb, roughness: mix(float(0.8), float(0.9), lichen), height: ridge.mul(0.8).add(r.mul(0.2)), heightDepthM: c.num('furrowDepth', 0.02), cavity: 0.8 };
};

// ---------------------------------------------------------------- shingles ------------------------------

const shingles: Generator = (c) => {
  // Three-tab asphalt shingles: courses along u, exposure along v; tabs with slots, granule texture, curl,
  // missing tabs (felt shows), moss in the slots and along the lower edges.
  const rows = c.cells(c.num('exposure', 0.14));
  const v = c.uv.y.mul(rows);
  const row = floor(v);
  const t = fract(v); // 0 = bottom (butt edge) … 1 = under the next course
  const tabW = c.num('shingleWidth', 0.3);
  const cols = c.cells(tabW);
  const off = hashf(row, c.seed).mul(0.5).add(fract(row.mul(0.5)));
  const x = c.uv.x.mul(cols).add(off);
  const tab = floor(x);
  const tx = fract(x);
  const id = hashf(tab.add(row.mul(211)), c.seed + 1);
  const slot = smoothDown(0.03, 0.02, min(tx, float(1).sub(tx))).mul(smoothDown(0.62, 0.55, t)); // keyway slot
  const missing = smoothstep(1 - c.num('missing', 0.05), 1 - c.num('missing', 0.05) + 0.001, id);
  const granules = gn(c.uv, c.cells(0.0025), c.seed + 2).mul(0.5).add(gn(c.uv, c.cells(0.0015), c.seed + 3).mul(0.5));
  const tone = id.mul(0.5).add(0.7);
  // Blended granules: each granule one of three tones (charcoal / slate / weathered brown).
  const gpick = worley(c.uv, c.cells(0.0022), c.seed + 9, 1).z;
  const gcol = mix(mix(vec3(0.045, 0.045, 0.045), vec3(0.085, 0.085, 0.09), smoothstep(0.5, 0.52, gpick)), vec3(0.09, 0.07, 0.05), smoothstep(0.85, 0.87, gpick));
  const tabC = gcol.mul(tone).mul(granules.mul(0.2).add(1));
  const felt = vec3(0.03, 0.028, 0.025);
  const curl = c.num('curl', 0.35);
  const butt = float(1).sub(smoothstep(0.0, 0.06, t)); // the butt edge shadow line
  let alb: N = mix(tabC, felt, max(slot, missing));
  alb = alb.mul(float(1).sub(butt.mul(0.85)));
  const mossM = smoothstep(0.45, 0.8, fbm01(c.uv, c.cells(0.3), 4, c.seed + 4).add(slot.mul(0.4)).add(butt.mul(0.2))).mul(c.num('moss', 0.3) * 1.5).clamp(0, 1);
  alb = mix(alb, mix(vec3(0.05, 0.075, 0.02), vec3(0.09, 0.1, 0.03), granules.mul(0.5).add(0.5)), mossM.mul(0.85));
  const height = float(1).sub(t.mul(0.5)).add(t.mul(t).mul(curl * 0.6)).sub(max(slot, missing).mul(0.5)).add(granules.mul(0.04)).add(mossM.mul(0.15));
  return { albedo: alb, roughness: mix(float(0.75), float(0.9), mossM), height, heightDepthM: 0.006, cavity: 0.6 };
};

export const GROUND_GENERATORS: Partial<Record<MaterialFamily, Generator>> = {
  gravel,
  asphalt,
  mud,
  grass,
  bark,
  shingles,
};
