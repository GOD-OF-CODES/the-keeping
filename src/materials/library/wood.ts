// Wood families: varnished + bare floorboards, stair treads, furniture, raw planks, painted wood (beadboard, doors),
// clapboard siding, wet porch boards, painted trim.

import type { MaterialFamily } from '../../shared/material-types.ts';
import type { GenCtx, Generator, N, RGB } from '../gen-types.ts';
import { fbm, fbm01, hashf } from '../tsl-noise.ts';
import { abs, band, boards, c3, dots, float, fract, lines, max, min, mix, paintOver, patches, rot45, smoothstep, tideStain, vec3, woodGrain } from './common.ts';

interface Species {
  rings: number; // visible rings across a 0.11 m board
  late: number; // latewood darkness multiplier
  early: number; // earlywood brightness multiplier
  pores: number;
  figure: number;
  hueVar: RGB; // per-board tint variation (multiplier at id=1 vs 0)
}
const SPECIES: Record<string, Species> = {
  oak: { rings: 7, late: 0.62, early: 1.12, pores: 0.6, figure: 2.2, hueVar: [1.12, 1.05, 0.92] },
  pine: { rings: 4, late: 0.52, early: 1.16, pores: 0, figure: 3.2, hueVar: [1.08, 1.04, 0.95] },
  walnut: { rings: 6, late: 0.6, early: 1.1, pores: 0.4, figure: 1.8, hueVar: [1.1, 1.0, 1.0] },
};

/** Bare wood albedo for a board layout (grain, per-board tone, streaks). */
function woodAlbedo(c: GenCtx, b: ReturnType<typeof boards>, base: RGB, sp: Species, contrast: number, seed: number): { alb: N; late: N; ring: N } {
  const ringsPerBoard = sp.rings * (b.widthM / 0.11);
  const g = woodGrain(c, b, { ringsPerBoard: Math.max(2, ringsPerBoard), contrast: 1, seed, figure: sp.figure, pores: sp.pores });
  const tone = b.id.mul(0.45).add(0.78); // per-board brightness
  const tint = mix(vec3(1, 1, 1), vec3(...sp.hueVar), b.id2);
  const grainMul = mix(float(sp.early), float(sp.late), g.late.mul(contrast * 1.6).clamp(0, 1));
  // Streaky tone along the grain (heartwood/sapwood, mineral streaks) — long along u, narrow across.
  const streaks = fbm(c.uv, [c.cells(1.2), b.rows * 5], 3, seed + 20).mul(0.14);
  const alb = c3(base).mul(tone).mul(tint).mul(grainMul).mul(g.streak.mul(0.5 * contrast).add(1)).mul(streaks.add(1));
  return { alb, late: g.late, ring: g.ring };
}

// ---------------------------------------------------------------- varnished floor / stair treads -------------

const woodFloor: Generator = (c) => {
  const seed = c.seed;
  const sp = SPECIES[c.str('species', 'oak')] ?? SPECIES.oak;
  const bw = c.num('boardWidth', 0.11);
  const isStair = c.spec.id.includes('stair');
  const b = boards(c, bw, c.num('boardLengthMin', isStair ? 5 : 0.9), c.num('boardLengthMax', isStair ? 5 : 2.6), isStair ? 0.0015 : 0.0028, seed);
  const base = c.col('baseColor', [0.1, 0.056, 0.028]);
  const wood = woodAlbedo(c, b, base, sp, c.num('grainContrast', 0.35) * 1.4, seed + 5);

  // Varnish: amber film, glossy; worn through in traffic lanes (low-freq along the boards) and on board edges.
  const varnish = c.num('varnish', 0.7);
  const wearAmt = Math.max(c.num('varnishWear', 0.45), isStair ? c.num('nosingWear', 0) * 0.8 : 0);
  const lanes = fbm01(c.uv, [c.cells(2.4), c.cells(0.8)], 4, seed + 40);
  const wearEdge = float(1).sub(smoothstep(0.0, 0.012, b.edge)).mul(0.6); // board arrises lose varnish first
  const wearN = fbm01(c.uv, [c.cells(0.4), c.cells(0.05)], 4, seed + 41); // streaky along the boards
  const wear = smoothstep(0.6 - wearAmt * 0.4, 0.85 - wearAmt * 0.3, lanes.mul(0.75).add(wearN.mul(0.3)).add(wearEdge)).clamp(0, 1);
  const film = float(varnish).mul(float(1).sub(wear));
  // Worn bare wood is lighter, greyer and dirtier (ground-in grime).
  const worn = wood.alb.mul(vec3(1.25, 1.2, 1.12)).mul(mix(float(1), fbm01(c.uv, c.cells(0.03), 3, seed + 42).mul(0.5).add(0.6), 0.6));
  const varnished = wood.alb.mul(vec3(0.92, 0.82, 0.62)); // amber absorption
  let alb: N = mix(worn, varnished, film);
  let rough: N = mix(float(0.62), float(0.2), film).add(fbm(c.uv, c.cells(0.2), 3, seed + 43).mul(0.05));

  // Scratches: fine lines in two orientations (along boards + 45°), lighter and rougher in the varnish.
  const sd = c.num('scratchDensity', 0.4);
  const sAlong = lines(c.uv, [c.cells(0.35), c.cells(0.02)], 0.035, seed + 50).mul(patches(c.uv, c.cells(0.4), sd, 0.1, seed + 51, 3));
  const sDiag = lines(rot45(c.uv), [c.cells(0.25), c.cells(0.06)], 0.03, seed + 52).mul(patches(c.uv, c.cells(0.5), sd * 0.6, 0.1, seed + 53, 3));
  const scratch = max(sAlong, sDiag).mul(0.8);
  alb = alb.mul(float(1).add(scratch.mul(film.mul(0.5).add(0.15))));
  rough = mix(rough, float(0.55), scratch.mul(film));

  // Dirt packed in the gaps + dust at the joints.
  const dirt = c3([0.018, 0.014, 0.01]);
  const gapDirt = b.gap.mul(c.num('dirtInGaps', 0.6) * 0.6 + 0.4);
  alb = mix(alb, dirt, gapDirt);
  rough = mix(rough, float(0.9), b.gap);

  // Height: gaps, slight cupping across each board, softwood-style grain relief where worn.
  const cup = b.across.sub(0.5).mul(b.across.sub(0.5)).mul(0.25);
  const height = float(1).sub(b.gap).mul(0.85).add(cup).sub(wood.late.mul(wear).mul(0.04)).sub(scratch.mul(0.03));
  return { albedo: alb, roughness: rough, height, heightDepthM: c.num('gapDepth', 0.004), cavity: 0.55, normalStrength: 1 };
};

// ---------------------------------------------------------------- bare / scrubbed / rough boards + furniture --

const woodBare: Generator = (c) => {
  const seed = c.seed;
  const id = c.spec.id;
  const sp = SPECIES[c.str('species', 'pine')] ?? SPECIES.pine;
  const furniture = id === 'wood_furniture_dark';
  const raw = id === 'wood_raw_plank';
  const bw = c.num('boardWidth', furniture ? 0.35 : raw ? 0.2 : 0.14);
  const b = boards(c, bw, c.num('boardLengthMin', furniture ? 3 : 1.2), c.num('boardLengthMax', furniture ? 3 : 3.6), furniture ? 0.0006 : 0.0035, seed);
  const base = c.col('baseColor', [0.23, 0.18, 0.12]);
  const wood = woodAlbedo(c, b, base, sp, c.num('grainContrast', 0.5) * 1.2, seed + 5);
  let alb: N = wood.alb;
  let rough: N = float(c.spec.roughness).add(fbm(c.uv, c.cells(0.3), 3, seed + 6).mul(0.05));

  // Weathering to silver-grey, stronger on earlywood and board ends.
  const greyed = c.num('greyed', 0);
  if (greyed > 0) {
    const gN = fbm01(c.uv, c.cells(0.5), 4, seed + 7);
    // Weathered wood silvers in the soft earlywood first; latewood stays browner and stands proud.
    const g = float(greyed).mul(gN.mul(0.6).add(0.6)).mul(float(1).sub(wood.late.mul(0.5))).clamp(0, 1);
    const grey = vec3(0.24, 0.23, 0.21).mul(c3(base).length().div(0.3).clamp(0.5, 1.3));
    alb = mix(alb, grey.mul(alb.length().div(c3(base).length()).clamp(0.6, 1.3)), g.mul(0.55));
  }
  // Varnish on furniture: darker, glossier, with rubbed-through patches.
  const varnish = c.num('varnish', 0);
  if (varnish > 0) {
    const worn = patches(c.uv, c.cells(0.3), c.num('varnishWear', 0.3), 0.1, seed + 8);
    const film = float(varnish).mul(float(1).sub(worn));
    alb = mix(alb.mul(1.12), alb.mul(vec3(0.9, 0.82, 0.7)), film);
    rough = mix(rough.add(0.2), float(0.28), film);
  }
  // Circular-saw arcs on rough-sawn stock.
  let sawH: N = float(0);
  if (c.str('saw', '') === 'rough' || raw) {
    const arcs = fract(c.uv.x.mul(c.cells(0.009)).add(b.across.sub(0.5).mul(b.across.sub(0.5)).mul(1.6)).add(b.id.mul(3)));
    const saw = band(arcs, 0.0, 0.35, 0.08);
    alb = alb.mul(saw.mul(0.12).add(0.94));
    rough = rough.add(saw.mul(0.04));
    sawH = saw.mul(0.08);
  }
  // Lye-scrubbed kitchen boards: pale, raised grain; dark tide-marked water stains.
  const ws = c.num('waterStains', 0);
  let stainH: N = float(0);
  if (ws > 0) {
    const st = tideStain(c.uv, c.cells(0.9), ws * 0.55, seed + 9);
    alb = alb.mul(float(1).sub(st.body.mul(0.28))).mul(float(1).sub(st.rim.mul(0.35)));
    alb = mix(alb, alb.mul(vec3(0.9, 0.85, 0.8)), st.body);
    stainH = st.rim.mul(0.02);
  }
  // Nail heads: two per board end and at 0.4 m joists.
  let nailM: N = float(0);
  if (c.flag('nailHeads', false)) {
    const joist = fract(c.uv.x.mul(c.cells(0.4)));
    const ax = abs(joist.sub(0.5)).mul(c.tile / c.cells(0.4)); // metres from the joist line
    const ay = min(abs(b.across.sub(0.28)), abs(b.across.sub(0.72))).mul(b.widthM);
    const r = ax.mul(ax).add(ay.mul(ay)).sqrt();
    nailM = float(1).sub(smoothstep(0.0022, 0.0032, r));
    const halo = float(1).sub(smoothstep(0.003, 0.012, r)).mul(0.5);
    alb = mix(alb, alb.mul(vec3(0.55, 0.45, 0.4)), halo); // tannin/rust stain
    alb = mix(alb, c3([0.03, 0.028, 0.026]), nailM);
    rough = mix(rough, float(0.55), nailM);
  }
  // Dirt in gaps (or grey dust fill on the neglected stair).
  const cob = c.num('cobwebDust', 0);
  const gapFill = cob > 0 ? c3([0.2, 0.19, 0.17]) : c3([0.02, 0.016, 0.012]);
  alb = mix(alb, gapFill, b.gap.mul(c.num('dirtInGaps', 0.7) * 0.5 + 0.5));
  if (cob > 0) {
    const dust = patches(c.uv, c.cells(0.25), cob * 0.5, 0.2, seed + 12).mul(0.45);
    alb = mix(alb, c3([0.21, 0.2, 0.18]), dust);
    rough = mix(rough, float(0.95), dust);
  }
  // Furniture dust + edge wear are world-space (bind: up-facing dust); keep the texture clean-ish.
  const height = float(1).sub(b.gap).mul(0.85).add(b.across.sub(0.5).mul(b.across.sub(0.5)).mul(0.2)).sub(wood.late.mul(0.05)).add(stainH).add(nailM.mul(0.06)).add(sawH);
  return { albedo: alb, roughness: rough, height, heightDepthM: c.num('gapDepth', furniture ? 0.001 : 0.005), cavity: furniture ? 0.3 : 0.6 };
};

// ---------------------------------------------------------------- painted wood (beadboard, doors) ----------

const woodPainted: Generator = (c) => {
  const seed = c.seed;
  const id = c.spec.id;
  const bead = id.includes('beadboard');
  const paint = c.col('paint', [0.33, 0.32, 0.27]);
  const under = c.col('underlayer', [0.14, 0.1, 0.07]);
  // Substrate: old wood / earlier paint coat under the chips.
  const underN = fbm01(c.uv, c.cells(0.05), 4, seed + 3);
  const underA = c3(under).mul(underN.mul(0.5).add(0.75));
  const p = paintOver(c, { color: paint, under: underA, underRough: float(0.75), chip: c.num('chip', 0.35) * 0.25, chipSizeM: 0.015, gloss: 1 - c.spec.roughness, dir: bead ? 'v' : 'v', seed, thicknessFrac: 0.3 });
  let alb: N = p.albedo;
  let rough: N = p.rough;
  let height: N = p.height.mul(0.25).add(0.7);

  if (bead) {
    // Vertical V-grooves with a rounded bead beside each at beadSpacing.
    const n = c.cells(c.num('beadSpacing', 0.1));
    const x = fract(c.uv.x.mul(n));
    const groove = float(1).sub(smoothstep(0.0, 0.035, min(x, float(1).sub(x))));
    const beadX = x.sub(0.07).div(0.045);
    const beadH = float(1).sub(beadX.mul(beadX)).max(0).sqrt();
    height = height.sub(groove.mul(0.6)).add(beadH.mul(0.18));
    alb = alb.mul(float(1).sub(groove.mul(0.35)));
    // Scuffs low on the wall (v ≈ height in metres, tile = 1 m): shoe scuffs + grime.
    const low = float(1).sub(smoothstep(0.08, 0.3, c.uv.y));
    const scuff = lines(rot45(c.uv), [c.cells(0.15), c.cells(0.4)], 0.08, seed + 60).mul(low).mul(c.num('scuff', 0.5));
    alb = mix(alb, c3([0.05, 0.045, 0.04]), scuff.mul(0.6));
  }
  // Grime / hand grime: blotchy darkening concentrated in patches (door edges get it in world space).
  const grime = patches(c.uv, c.cells(0.35), c.num('handGrime', 0.3) * 0.6 + 0.15, 0.2, seed + 70).mul(0.35);
  alb = alb.mul(float(1).sub(grime.mul(0.45)));
  rough = rough.add(grime.mul(0.1));
  // Blisters on the weather-side front door: raised domes in the paint film.
  const blister = c.num('blister', 0);
  if (blister > 0) {
    const d = dots(c.uv, c.cells(0.018), 0.4, blister * 0.5, seed + 80);
    const dome = float(1).sub(d.d.mul(d.d)).max(0).mul(d.mask.min(1)).mul(float(1).sub(p.chip));
    height = height.add(dome.mul(0.25));
    alb = alb.mul(float(1).sub(dome.mul(0.08)));
  }
  return { albedo: alb, roughness: rough, height, heightDepthM: bead ? 0.004 : 0.0012, cavity: 0.6 };
};

// ---------------------------------------------------------------- trim paint ------------------------------

const trimPaint: Generator = (c) => {
  const under = c3(c.col('underlayer', [0.1, 0.075, 0.05])).mul(fbm01(c.uv, c.cells(0.04), 3, c.seed + 2).mul(0.5).add(0.75));
  const p = paintOver(c, { color: c.col('paint', [0.5, 0.48, 0.42]), under, underRough: float(0.7), chip: c.num('chip', 0.35) * 0.25, chipSizeM: 0.012, gloss: c.num('gloss', 0.4), dir: 'u', seed: c.seed, thicknessFrac: 0.4 });
  // Yellowed, dirty old gloss: grime in patches, runs of darker grime along v.
  const grime = patches(c.uv, c.cells(0.25), 0.3 + c.num('grimeInCorners', 0.6) * 0.2, 0.2, c.seed + 9).mul(0.3);
  const runs = smoothstep(0.3, 0.9, fbm01(c.uv, [c.cells(0.02), c.cells(0.6)], 3, c.seed + 10)).mul(0.25);
  const alb = p.albedo.mul(vec3(1, 0.98, 0.92)).mul(float(1).sub(grime.add(runs).mul(0.4)));
  return { albedo: alb, roughness: p.rough.add(grime.mul(0.15)), height: p.height, heightDepthM: 0.0008, cavity: 0.8 };
};

// ---------------------------------------------------------------- clapboard siding -------------------------

const clapboard: Generator = (c) => {
  const seed = c.seed;
  const exposure = c.num('boardExposure', 0.11);
  const rows = c.cells(exposure);
  const v = c.uv.y.mul(rows);
  const t = fract(v); // 0 at the bottom (drip edge) → 1 under the lap of the next board
  const row = v.floor();
  // Board profile: thick at the bottom, tapering upward; sharp step (the lap shadow line) at t = 0.
  const profile = float(1).sub(t.mul(0.55)).sub(smoothstep(0.0, 0.035, t).oneMinus().mul(0.6));
  const b = { row, id: hashf(row, seed), id2: hashf(row, seed + 1) };
  // Bare weathered wood under the paint: grey, grain along u.
  const grainB = { row, id: b.id, id2: b.id2, along: fract(c.uv.x.add(b.id)), across: t, lenM: float(c.tile), widthM: c.tile / rows, gap: float(0), edge: float(1), rows };
  const g = woodAlbedo(c, grainB as any, c.col('bareWood', [0.12, 0.1, 0.08]), SPECIES.pine, 0.8, seed + 3);
  const p = paintOver(c, { color: c.col('paint', [0.42, 0.41, 0.37]), under: g.alb, underRough: float(0.85), chip: c.num('peel', 0.55) * 0.8, chipSizeM: 0.02, gloss: 0.3, dir: 'u', seed: seed + 5, thicknessFrac: 0.3, aniso: [5, 1] });
  let alb: N = p.albedo;
  let rough: N = p.rough;
  // Paint peels along the grain: stretch the missing areas horizontally (curled flake edges catch light).
  const curl = smoothstep(0.35, 0.5, p.chip).mul(float(1).sub(smoothstep(0.5, 0.65, p.chip)));
  // Mildew: dark green-black speckle, heaviest just under each lap (t near 1) and in blotches.
  const mild = c.num('mildew', 0.35);
  const mN = fbm01(c.uv, c.cells(0.02), 4, seed + 7).mul(patches(c.uv, c.cells(0.6), mild, 0.25, seed + 8));
  const underLap = smoothstep(0.55, 1.0, t);
  const mildew = smoothstep(0.45, 0.75, mN.add(underLap.mul(0.25))).mul(mild * 1.4).clamp(0, 1);
  alb = mix(alb, c3([0.035, 0.04, 0.028]), mildew.mul(0.8));
  // Rain streaks: vertical grime runs below the laps.
  const streak = smoothstep(0.5, 0.9, fbm01(c.uv, [c.cells(0.015), c.cells(0.9)], 4, seed + 9)).mul(c.num('rainStreaks', 0.6));
  alb = alb.mul(float(1).sub(streak.mul(0.35)));
  // The lap shadow (the underside of the board above is not lit: bake a thin dark line).
  const lapShadow = float(1).sub(smoothstep(0.0, 0.06, t));
  // The facade now has real lap geometry (each course is a board with its own shadow line in the bake): keep only a
  // faint painted-edge darkening and a shallow profile so the laps are not doubled by the normal map.
  alb = alb.mul(float(1).sub(lapShadow.mul(0.18)));
  rough = mix(rough, float(0.9), mildew);
  const height = profile.mul(0.25).add(p.height.mul(0.5)).add(curl.mul(0.25));
  return { albedo: alb, roughness: rough, height, heightDepthM: 0.003, cavity: 0.4, normalStrength: 1 };
};

// ---------------------------------------------------------------- porch boards (wet) ------------------------

const porchBoards: Generator = (c) => {
  const seed = c.seed;
  const b = boards(c, c.num('boardWidth', 0.09), 1.0, 2.0, 0.006, seed);
  const wood = woodAlbedo(c, b, [0.16, 0.14, 0.12], SPECIES.pine, 0.9, seed + 2);
  // Silver-grey weathered decking with dark wet end grain.
  let alb: N = mix(wood.alb, vec3(0.13, 0.125, 0.115).mul(float(1).sub(wood.late.mul(0.4))), 0.6);
  let rough: N = float(0.75);
  // Remnants of grey deck paint in the low-traffic areas.
  const remain = c.num('paintRemaining', 0.25);
  const paintM = patches(c.uv, [c.cells(0.5), c.cells(0.06)], remain, 0.03, seed + 3, 5).mul(float(1).sub(b.gap));
  alb = mix(alb, c3(c.col('paintRemnant', [0.2, 0.2, 0.19])).mul(fbm01(c.uv, c.cells(0.05), 3, seed + 4).mul(0.3).add(0.85)), paintM);
  rough = mix(rough, float(0.5), paintM);
  // Rot: soft dark areas at board ends and in patches; slightly sunken.
  const endRot = float(1).sub(smoothstep(0.0, 0.12, min(b.along, float(1).sub(b.along)))).mul(b.id2.greaterThan(0.6).select(1, 0));
  const rot = max(endRot, patches(c.uv, c.cells(0.5), c.num('rot', 0.3) * 0.4, 0.15, seed + 5)).mul(c.num('rot', 0.3) * 2).clamp(0, 1);
  alb = mix(alb, c3([0.035, 0.03, 0.025]), rot.mul(0.7));
  // Gaps: black (void under the porch).
  alb = mix(alb, c3([0.005, 0.005, 0.005]), b.gap);
  // Height: cupped boards (edges up), sunken rot, gaps. Puddles collect in the cup centres and low patches.
  const cup = b.across.sub(0.5).mul(b.across.sub(0.5)).mul(0.6);
  const lowN = fbm01(c.uv, c.cells(0.6), 4, seed + 6);
  const height = float(1).sub(b.gap).mul(0.7).add(cup).sub(rot.mul(0.12)).sub(lowN.mul(0.15)).sub(wood.late.mul(0.05));
  const puddle = smoothstep(0.62 - c.num('puddles', 0.4) * 0.35, 0.7 - c.num('puddles', 0.4) * 0.35, lowN.add(float(0.5).sub(cup).mul(0.4))).mul(float(1).sub(b.gap));
  return { albedo: alb, roughness: rough, height, heightDepthM: 0.006, cavity: 0.5, puddle };
};

export const WOOD_GENERATORS: Partial<Record<MaterialFamily, Generator>> = {
  wood_floor: woodFloor,
  wood_bare: woodBare,
  wood_painted: woodPainted,
  trim_paint: trimPaint,
  clapboard,
  porch_boards: porchBoards,
};

