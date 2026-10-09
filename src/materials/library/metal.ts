// Metal families. The B.a channel carries METALNESS itself (bind.ts), so rust/paint/verdigris over metal is a proper
// dielectric-over-metal mask: rust, cast iron, chipped enamel (steel under the chips), pitted chrome, galvanised
// zinc, tarnished brass, car paint (clearcoat in bind).

import type { MaterialFamily } from '../../shared/material-types.ts';
import type { GenCtx, Generator, N, RGB } from '../gen-types.ts';
import { fbm, fbm01, gn, worley } from '../tsl-noise.ts';
import { abs, max } from 'three/tsl';
import { c3, chipMask, dots, float, grunge, lines, mix, patches, rot45, smoothDown, smoothstep, vec2, vec3 } from './common.ts';
import { coverThreshold } from '../noise-cpu.ts';

/** Oxide colour field: orange-brown rust with dark scale, yellow-ochre bloom, fine pitting. */
function rustColor(c: GenCtx, base: RGB, seed: number): { alb: N; h: N } {
  const n1 = fbm01(c.uv, c.cells(0.12), 5, seed);
  const n2 = fbm01(c.uv, c.cells(0.02), 4, seed + 1);
  const fine = fbm01(c.uv, c.cells(0.003), 3, seed + 2);
  const scale = smoothstep(0.55, 0.85, n1.add(fine.sub(0.5).mul(0.4))); // darker, flaky scale
  const ochre = smoothstep(0.55, 0.9, n2).mul(0.5);
  const b = c3(base);
  let alb: N = mix(b.mul(1.15), b.mul(vec3(0.5, 0.45, 0.42)), scale.mul(0.8));
  alb = mix(alb, vec3(0.3, 0.17, 0.06), ochre.mul(float(1).sub(scale)));
  alb = alb.mul(fine.sub(0.5).mul(0.35).add(1));
  const h = n1.mul(0.4).add(n2.mul(0.3)).add(fine.mul(0.3));
  return { alb, h };
}

const rust: Generator = (c) => {
  const r = rustColor(c, c.col('base', [0.22, 0.08, 0.03]), c.seed);
  // Flaking lamellae (raised, lighter edges), a few bare-steel scrapes, traces of the old red paint.
  const fl = worley(c.uv, c.cells(0.015), c.seed + 3, 1);
  const flakeM = smoothstep(0.02, 0.1, fl.w).mul(grunge(c, 0.1, c.num('flake', 0.5) * 0.6, c.seed + 7));
  const bare = grunge(c, 0.15, c.num('bareMetalPatches', 0.15) * 0.6, c.seed + 4, 0.7);
  const paint = grunge(c, 0.3, 0.12, c.seed + 5, 0.8).mul(float(1).sub(bare));
  const steel = vec3(0.4, 0.39, 0.38).mul(fbm01(c.uv, [c.cells(0.05), c.cells(0.002)], 3, c.seed + 6).mul(0.3).add(0.75));
  let alb: N = r.alb.mul(float(1).add(flakeM.mul(0.2)));
  alb = mix(alb, c3(c.col('paintRemnant', [0.55, 0.12, 0.1])).mul(0.7), paint.mul(0.85));
  alb = mix(alb, steel, bare);
  const metal = bare.mul(0.95);
  const rough = mix(mix(float(0.85), float(0.6), paint), float(0.4), bare);
  const height = r.h.mul(0.5).add(flakeM.mul(0.25)).add(paint.mul(0.2)).sub(bare.mul(0.25)).add(0.25);
  return { albedo: alb, roughness: rough, height, heightDepthM: 0.0015, cavity: 0.6, extra: metal };
};

const castIron: Generator = (c) => {
  // Sand-cast skin (fine pitting), black stove-polish finish, rust bloom creeping from low spots, worn bright spots.
  const pits = dots(c.uv, c.cells(0.002), 0.3, 0.25, c.seed).mask;
  const sand = gn(c.uv, c.cells(0.0012), c.seed + 1).mul(0.5).add(fbm(c.uv, c.cells(0.04), 3, c.seed + 2).mul(0.5));
  const polish = grunge(c, 0.2, c.num('polishOnEdges', 0.2) * 0.35, c.seed + 3, 0.6);
  const rustM = grunge(c, 0.12, c.num('rust', 0.25) * 0.6, c.seed + 4, 0.8);
  const iron = c3(c.col('base', [0.06, 0.06, 0.06])).mul(sand.mul(0.3).add(1));
  let alb: N = mix(iron, vec3(0.16, 0.16, 0.155), polish.mul(0.6));
  const r = rustColor(c, [0.14, 0.065, 0.03], c.seed + 5);
  alb = mix(alb, r.alb, rustM.mul(0.85));
  alb = alb.mul(float(1).sub(pits.mul(0.3)));
  const metal = mix(float(0.7), float(1), polish).mul(float(1).sub(rustM));
  const rough = mix(mix(float(0.6), float(0.42), polish), float(0.88), rustM).add(pits.mul(0.1));
  const height = sand.mul(0.3).add(0.5).sub(pits.mul(0.25)).add(rustM.mul(r.h).mul(0.3));
  return { albedo: alb, roughness: rough, height, heightDepthM: 0.0008, cavity: 0.5, extra: metal };
};

const enamel: Generator = (c) => {
  // Vitreous enamel: glossy, slightly wavy; a few conchoidal chips (black steel core, rust halo), rust-ring tide
  // marks, fine crazing, grime in the crazing.
  const chip = chipMask(c, c.num('chips', 0.4) * 0.12, 0.035, c.seed);
  const halo = chipMask(c, c.num('chips', 0.4) * 0.2, 0.035, c.seed).sub(chip).clamp(0, 1); // rust bleeding around
  let base: N = c3(c.col('base', [0.6, 0.6, 0.55])).mul(fbm(c.uv, c.cells(0.2), 3, c.seed + 1).mul(0.03).add(1));
  const mottle = c.num('mottle', 0);
  if (mottle > 0) {
    // Round E: grey-and-white mottled porcelain (1920s–30s ranges): a warped dark ground (≈ 0.12) with white
    // splashes (≈ 0.55) 3–15 mm and fine flecks, all under the glass-smooth top coat.
    const wuv = c.uv.add(vec2(fbm(c.uv, c.cells(0.02), 3, c.seed + 20), fbm(c.uv, c.cells(0.02), 3, c.seed + 21)).mul(0.25 / c.cells(0.02)));
    const sp = fbm01(wuv, c.cells(0.012), 4, c.seed + 22);
    const fleck = dots(c.uv, c.cells(0.0025), 0.3, 0.35, c.seed + 23).mask;
    const white = smoothstep(0.5, 0.56, sp).add(fleck.mul(0.7)).clamp(0, 1);
    base = mix(base, mix(c3(c.col('dark', [0.11, 0.115, 0.125])), c3(c.col('light', [0.55, 0.56, 0.57])), white), mottle);
  }
  const chipC = mix(c3(c.col('chipColor', [0.03, 0.03, 0.03])), vec3(0.12, 0.05, 0.02), fbm01(c.uv, c.cells(0.005), 3, c.seed + 2));
  const ringN = fbm01(c.uv, c.cells(0.3), 4, c.seed + 3);
  const ringT = coverThreshold(c.num('rustRings', 0.3) * 0.5);
  const ring = smoothDown(0.015, 0.0, abs(ringN.sub(ringT))).mul(0.7).add(smoothstep(ringT, ringT + 0.08, ringN).mul(0.2));
  let alb: N = mix(base, base.mul(vec3(0.75, 0.55, 0.35)), ring.mul(fbm01(c.uv, c.cells(0.01), 3, c.seed + 5).mul(0.6).add(0.4)));
  alb = mix(alb, alb.mul(vec3(0.7, 0.5, 0.3)), halo.mul(0.6));
  alb = mix(alb, chipC, chip);
  const craze = float(1).sub(smoothstep(0.0, 0.02, worley(c.uv, c.cells(0.012), c.seed + 4, 1).w)).mul(0.5);
  alb = alb.mul(float(1).sub(craze.mul(0.15)));
  const rough = mix(float(0.1).add(ring.mul(0.2)).add(craze.mul(0.05)).add(halo.mul(0.2)), float(0.7), chip);
  const height = float(1).sub(chip.mul(0.8)).sub(craze.mul(0.03)).add(fbm(c.uv, c.cells(0.15), 2, c.seed + 6).mul(0.05));
  return { albedo: alb, roughness: rough, height, heightDepthM: 0.0008, cavity: 0.4 };
};

const chrome: Generator = (c) => {
  // Pitted chrome plating: mostly mirror; pits are pinpricks with rust haloes; a haze where the plating thinned.
  const pitD = c.num('pitting', 0.5);
  const pit = dots(c.uv, c.cells(0.004), 0.18, pitD * 0.35, c.seed);
  const haloM = dots(c.uv, c.cells(0.004), 0.45, pitD * 0.35, c.seed).mask.sub(pit.mask).clamp(0, 1);
  const haze = fbm01(c.uv, c.cells(0.15), 3, c.seed + 1);
  const rustM = grunge(c, 0.08, c.num('rustSpots', 0.3) * 0.3, c.seed + 2, 0.9);
  const r = rustColor(c, [0.2, 0.08, 0.03], c.seed + 3);
  let alb: N = vec3(0.62, 0.62, 0.64).mul(float(1).sub(haze.mul(0.08)));
  alb = mix(alb, r.alb, max(rustM, pit.mask).mul(0.9));
  alb = mix(alb, alb.mul(vec3(0.8, 0.65, 0.5)), haloM.mul(0.5));
  const metal = float(1).sub(max(rustM, pit.mask));
  const rough = float(0.07).add(haze.mul(0.06)).add(haloM.mul(0.12)).add(rustM.mul(0.75));
  return { albedo: alb, roughness: rough, height: float(0.6).sub(pit.mask.mul(0.4)).add(rustM.mul(0.2)), heightDepthM: 0.0003, cavity: 0.3, extra: metal };
};

const zinc: Generator = (c) => {
  // Hot-dip galvanising: spangle crystals (cells with per-grain brightness + dendritic texture), dull grey
  // patina, white rust blooms along the bottom and in patches, dents.
  const sp = worley(c.uv, c.cells(0.02), c.seed, 1);
  const spangleAmt = c.num('spangle', 0.6);
  const spangle = sp.z.mul(0.3).add(0.82).mul(spangleAmt).add(1 - spangleAmt);
  const dend = lines(rot45(c.uv), [c.cells(0.012), c.cells(0.003)], 0.05, c.seed + 1).mul(0.06).mul(smoothstep(0.02, 0.06, sp.w));
  const white = grunge(c, 0.12, c.num('whiteRust', 0.35) * 0.3, c.seed + 2, 0.9).mul(0.8);
  const patina = fbm01(c.uv, c.cells(0.2), 3, c.seed + 5);
  let alb: N = vec3(0.47, 0.48, 0.49).mul(spangle).mul(float(1).add(dend)).mul(patina.mul(0.15).add(0.92));
  alb = mix(alb, vec3(0.6, 0.6, 0.58).mul(fbm01(c.uv, c.cells(0.005), 3, c.seed + 3).mul(0.3).add(0.8)), white);
  const dent = fbm(c.uv, c.cells(0.12), 3, c.seed + 4).mul(c.num('dents', 0.3));
  const metal = float(1).sub(white.mul(0.9));
  const rough = mix(float(0.36).add(sp.z.mul(0.08)).add(patina.mul(0.08)), float(0.8), white);
  return { albedo: alb, roughness: rough, height: dent.mul(0.5).add(0.5).add(white.mul(0.05)), heightDepthM: 0.004, cavity: 0.3, extra: metal };
};

const brass: Generator = (c) => {
  // Tarnished brass: continuous brown-olive tarnish film (thicker in recesses), bright where hands rub, a little
  // verdigris only in the deepest spots. Fine polishing scratches.
  const tarnN = fbm01(c.uv, c.cells(0.08), 5, c.seed);
  const touched = grunge(c, 0.1, c.num('polishedWhereTouched', 0.7) * 0.3, c.seed + 1, 0.5);
  const tarnish = smoothstep(0.2, 0.8, tarnN).mul(c.num('tarnish', 0.6) * 1.3).mul(float(1).sub(touched.mul(0.85))).clamp(0, 1);
  const verd = grunge(c, 0.04, c.num('verdigris', 0.25) * 0.12, c.seed + 2, 1.0).mul(float(1).sub(touched));
  const brassC = vec3(0.6, 0.44, 0.18);
  const tarnC = vec3(0.22, 0.16, 0.08);
  let alb: N = mix(brassC, tarnC, tarnish.mul(0.85));
  alb = mix(alb, vec3(0.18, 0.3, 0.24), verd.mul(0.9));
  const scratches = lines(rot45(c.uv), [c.cells(0.04), c.cells(0.004)], 0.03, c.seed + 3).mul(touched).mul(0.5);
  const metal = float(1).sub(verd).sub(tarnish.mul(0.15)).clamp(0, 1);
  const rough = mix(mix(float(0.22), float(0.45), tarnish), float(0.85), verd).sub(touched.mul(0.1)).add(scratches.mul(0.1));
  return { albedo: alb, roughness: rough, height: fbm01(c.uv, c.cells(0.05), 3, c.seed + 4).mul(0.3).add(verd.mul(0.3)).sub(scratches.mul(0.05)), heightDepthM: 0.0002, cavity: 0.15, extra: metal };
};

const carPaint: Generator = (c) => {
  // Old metallic paint: base (sRGB param), metallic flake (tiny bright specks), oxidised chalky patches,
  // road dirt thicker toward the bottom (v = 0 low), rust-through + moss on wrecks.
  const wreck = c.spec.id.includes('wreck');
  const base = c.col('base', c.col('baseVariants', [0.28, 0.35, 0.45]));
  const flake = gn(c.uv, c.cells(0.0012), c.seed).mul(c.num('metallicFlake', 0.3) * 0.25);
  // Chalky oxidation: a soft, low-frequency lightening/flattening of the clear (sun-facing panels in reality).
  const ox = fbm01(c.uv, c.cells(0.6), 4, c.seed + 1).mul(c.num('oxidation', 0.4)).mul(fbm01(c.uv, c.cells(0.02), 3, c.seed + 8).mul(0.4).add(0.8));
  let alb: N = c3(base).mul(float(1).add(flake));
  alb = mix(alb, alb.mul(1.3).add(0.03), ox.mul(0.8));
  // Road film: thin, darker toward the bottom of the repeat (sills/doors on the sedan's UVs), speckled splash.
  const dirtN = fbm01(c.uv, c.cells(0.08), 4, c.seed + 2);
  const low = float(1).sub(smoothstep(0.0, 0.45, c.uv.y));
  const dirt = grunge(c, 0.1, c.num('dirtLower', 0.6) * 0.15, c.seed + 9, 0.8).mul(0.5).add(low.mul(dirtN).mul(c.num('dirtLower', 0.6) * 0.6)).clamp(0, 0.85);
  alb = mix(alb, vec3(0.09, 0.075, 0.055), dirt);
  // Water spots / streak marks.
  const spots = dots(c.uv, c.cells(0.02), 0.4, 0.3, c.seed + 3).mask.mul(0.3);
  alb = alb.mul(float(1).sub(spots.mul(0.2)));
  let rough: N = float(0.3).add(ox.mul(0.35)).add(dirt.mul(0.4));
  let height: N = float(0.5).add(dirt.mul(0.1)).add(gn(c.uv, c.cells(0.03), c.seed + 4).mul(0.02)); // orange-peel
  let metal: N = float(0);
  if (wreck) {
    const rt = patches(c.uv, c.cells(0.2), c.num('rustThrough', 0.5) * 0.5, 0.03, c.seed + 5, 5);
    const r = rustColor(c, [0.2, 0.075, 0.03], c.seed + 6);
    alb = mix(alb, r.alb, rt);
    rough = mix(rough, float(0.9), rt);
    height = height.sub(rt.mul(0.3)).add(r.h.mul(rt).mul(0.2));
    const moss = smoothstep(0.5, 0.8, fbm01(c.uv, c.cells(0.15), 4, c.seed + 7).add(low.mul(0.3))).mul(c.num('moss', 0.3) * 2).clamp(0, 1);
    alb = mix(alb, vec3(0.05, 0.07, 0.02), moss.mul(0.8));
    rough = mix(rough, float(0.9), moss);
  }
  void metal;
  void vec2;
  return { albedo: alb, roughness: rough, height, heightDepthM: 0.0003, cavity: 0.2 };
};

const steel: Generator = (c) => {
  // Hand-forged / ground carbon steel (round E, R3): steel_forged (hammer head, shears) and steel_cleaver. Fresh-ground
  // steel F0 ≈ 0.56 (Gulbrandsen); decades of handling leave a grey-brown oxide/oil patina (≈ 0.25–0.35, rough
  // 0.35–0.5) that the grind lines still cut through, pinprick pits with rust haloes, and orange rust blooms where
  // water sat. Grind lines run along u (the blade / head axis on our UVs), capped at the texel Nyquist limit.
  const across = Math.min(c.cells(0.0006), Math.round(c.size * 0.5));
  const grind = gn(c.uv, [c.cells(0.12), across], c.seed).mul(0.5).add(gn(c.uv, [c.cells(0.04), Math.round(across / 2)], c.seed + 1).mul(0.5));
  const grindAmt = c.num('grind', 0.6);
  const patN = fbm01(c.uv, c.cells(0.06), 4, c.seed + 2);
  const patina = smoothstep(0.25, 0.8, patN).mul(c.num('patina', 0.5) * 1.4).clamp(0, 1);
  const pitD = c.num('pitting', 0.3);
  const pit = dots(c.uv, c.cells(0.003), 0.2, pitD * 0.3, c.seed + 3);
  const haloM = dots(c.uv, c.cells(0.003), 0.5, pitD * 0.3, c.seed + 3).mask.sub(pit.mask).clamp(0, 1);
  const rustM = grunge(c, 0.03, c.num('rustSpots', 0.2) * 0.25, c.seed + 4, 0.9);
  const r = rustColor(c, [0.2, 0.08, 0.03], c.seed + 5);
  const bright = vec3(0.55, 0.55, 0.54).mul(grind.mul(0.08 * grindAmt).add(1));
  const oxide = vec3(0.24, 0.22, 0.2).mul(fbm01(c.uv, c.cells(0.01), 3, c.seed + 6).mul(0.3).add(0.85));
  let alb: N = mix(bright, oxide, patina.mul(0.85));
  alb = mix(alb, alb.mul(vec3(0.75, 0.6, 0.45)), haloM.mul(0.6));
  alb = mix(alb, r.alb, max(rustM, pit.mask).mul(0.9));
  const metal = float(1).sub(max(rustM, pit.mask).mul(0.95)).sub(patina.mul(0.1));
  const rough = float(0.22).add(abs(grind).mul(0.08 * grindAmt)).add(patina.mul(0.2)).add(haloM.mul(0.12)).add(rustM.mul(0.6));
  const height = float(0.6).add(grind.mul(0.04 * grindAmt)).sub(pit.mask.mul(0.4)).add(rustM.mul(r.h).mul(0.25));
  return { albedo: alb, roughness: rough, height, heightDepthM: 0.0003, cavity: 0.35, extra: metal };
};

const paintedSteel: Generator = (c) => {
  // Painted sheet steel (round E, R3: the jerry cans). Air-dried alkyd enamel over red-oxide primer on pressed steel:
  // chalked (oxidised, sun side lighter + desaturated), orange-peel, fine scuffs through to primer, small chips through
  // to dark steel with rust haloes, rust runs below the chips (gravity along −v), dull fuel/oil stains. The prop's
  // COLOR_0 wear adds the edge chips / polished handles / seam rust on top (wear-math painted_steel).
  const paint = c3(c.col('base', [0.3, 0.035, 0.022]));
  const chalk = fbm01(c.uv, c.cells(0.25), 4, c.seed).mul(c.num('chalking', 0.4));
  let alb: N = mix(paint, paint.mul(1.25).add(vec3(0.035, 0.03, 0.03)), chalk);
  alb = alb.mul(fbm01(c.uv, c.cells(0.02), 3, c.seed + 1).mul(0.12).add(0.94));
  const peel = gn(c.uv, c.cells(0.002), c.seed + 2); // orange-peel ≈ 2 mm
  // Scuffs: short straight scratches at random angles (two rotated line fields), through the top coat to primer.
  const sc1 = lines(c.uv, [c.cells(0.08), c.cells(0.004)], 0.025, c.seed + 3);
  const sc2 = lines(rot45(c.uv), [c.cells(0.06), c.cells(0.005)], 0.025, c.seed + 4);
  const scuffMask = grunge(c, 0.08, c.num('scuffs', 0.5) * 0.5, c.seed + 5, 0.6);
  const scuff = max(sc1, sc2).mul(scuffMask);
  const primer = vec3(0.2, 0.075, 0.042);
  alb = mix(alb, primer, scuff.mul(0.8));
  // Chips to steel with a rust halo, and rust runs dripping below them.
  const chip = chipMask(c, c.num('chips', 0.25) * 0.1, 0.004, c.seed + 6);
  const halo = chipMask(c, c.num('chips', 0.25) * 0.18, 0.004, c.seed + 6).sub(chip).clamp(0, 1);
  const r = rustColor(c, [0.2, 0.075, 0.03], c.seed + 7);
  const runN = fbm01(c.uv, [c.cells(0.012), c.cells(0.25)], 4, c.seed + 8);
  const runs = smoothstep(0.62, 0.8, runN).mul(grunge(c, 0.12, c.num('rustRuns', 0.3) * 0.5, c.seed + 9, 0.5));
  alb = mix(alb, alb.mul(vec3(0.7, 0.5, 0.35)).add(vec3(0.03, 0.012, 0.004)), runs.mul(0.7));
  alb = mix(alb, mix(r.alb, primer, 0.3), halo.mul(0.85));
  const steelC = vec3(0.1, 0.1, 0.1);
  alb = mix(alb, mix(steelC, r.alb, fbm01(c.uv, c.cells(0.003), 2, c.seed + 10)), chip);
  // Fuel / oil stains: darker, glossier tide-free blotches.
  const oil = grunge(c, 0.1, c.num('stains', 0.2) * 0.3, c.seed + 11, 0.3);
  alb = alb.mul(float(1).sub(oil.mul(0.3)));
  const metal = chip.mul(fbm01(c.uv, c.cells(0.003), 2, c.seed + 10).oneMinus()).mul(0.8);
  const rough = float(c.spec.roughness).add(chalk.mul(0.2)).sub(oil.mul(0.2)).add(scuff.mul(0.15)).add(halo.mul(0.25)).add(runs.mul(0.1)).add(chip.mul(0.2)).clamp(0.05, 1);
  const height = float(0.7).add(peel.mul(0.03)).sub(scuff.mul(0.15)).sub(chip.mul(0.55)).add(halo.mul(r.h).mul(0.1));
  return { albedo: alb, roughness: rough, height, heightDepthM: 0.0002, cavity: 0.3, extra: metal };
};

/** Metal materials whose generator differs from their family's. */
export const METAL_BY_ID: Record<string, Generator> = {
  steel_cleaver: steel,
  steel_forged: steel,
  paint_steel_can: paintedSteel,
  paint_steel_sign: paintedSteel,
};

export const METAL_GENERATORS: Partial<Record<MaterialFamily, Generator>> = {
  rust,
  cast_iron: castIron,
  enamel,
  chrome,
  zinc,
  metal_brass: brass,
  car_paint: carPaint,
};
