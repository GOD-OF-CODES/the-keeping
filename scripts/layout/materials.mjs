// Material table for THE KEEPING — source of src/shared/material-spec.json (schema: src/shared/material-types.ts).
// build-layout.mjs writes the JSON from this list; the layout only references ids defined here.
// avgAlbedo is LINEAR sRGB (what Cycles uses for bounce colour); the runtime generators must average to it ±10%.
// Colours inside params are linear triplets unless the key ends in _srgb.

/** @param {string} id @param {string} family @param {object} o */
function m(id, family, o) {
  return {
    id,
    family,
    params: o.params ?? {},
    avgAlbedo: o.albedo,
    roughness: o.rough,
    metalness: o.metal ?? 0,
    tileMetres: o.tile ?? 1,
    hero: o.hero ?? false,
    wetness: o.wet ?? 0,
    source: o.source ?? 'generated',
    ...(o.notes ? { notes: o.notes } : {}),
  };
}

export const MATERIALS = [
  // ---------- wood floors & stairs ----------
  m('floor_varnished', 'wood_floor', {
    albedo: [0.145, 0.086, 0.047], rough: 0.35, tile: 2.4, hero: true,
    params: { boardWidth: 0.11, boardLengthMin: 0.9, boardLengthMax: 2.6, species: 'oak', baseColor: [0.17, 0.1, 0.055], grainContrast: 0.35, varnish: 0.7, varnishWear: 0.45, wearPath: true, gapDepth: 0.004, dirtInGaps: 0.6, scratchDensity: 0.4, seed: 11 },
    notes: 'Hall G1 and parlor G2. Wear path down the middle of the hall; dull traffic lanes.',
  }),
  m('floor_bare', 'wood_bare', {
    albedo: [0.2, 0.155, 0.105], rough: 0.78, tile: 2.4,
    params: { boardWidth: 0.14, boardLengthMin: 1.2, boardLengthMax: 3.6, species: 'pine', baseColor: [0.23, 0.18, 0.12], greyed: 0.35, grainContrast: 0.5, nailHeads: true, gapDepth: 0.006, dirtInGaps: 0.8, seed: 12 },
    notes: 'Upper floor margins, back passage, closet, servants\' landing.',
  }),
  m('floor_scrubbed', 'wood_bare', {
    albedo: [0.27, 0.22, 0.16], rough: 0.82, tile: 2.4,
    params: { boardWidth: 0.16, boardLengthMin: 1.5, boardLengthMax: 4, species: 'pine', baseColor: [0.3, 0.245, 0.18], greyed: 0.5, grainContrast: 0.3, waterStains: 0.55, gapDepth: 0.008, dirtInGaps: 0.7, seed: 13 },
    notes: 'Kitchen G3: lye-scrubbed boards, dark water stains radiating from the cistern hatch.',
  }),
  m('stair_treads', 'wood_floor', {
    albedo: [0.075, 0.042, 0.021], rough: 0.5, tile: 1.2, hero: true,
    params: { boardWidth: 0.28, species: 'oak', baseColor: [0.09, 0.05, 0.025], varnish: 0.6, varnishWear: 0.75, nosingWear: 0.9, grainContrast: 0.4, seed: 14 },
    notes: 'Main stair treads/risers/handrail. Varnish worn through at every nosing centre.',
  }),
  m('stair_rough', 'wood_bare', {
    albedo: [0.16, 0.125, 0.085], rough: 0.85, tile: 1.2,
    params: { boardWidth: 0.25, species: 'pine', baseColor: [0.18, 0.14, 0.095], greyed: 0.2, grainContrast: 0.55, cobwebDust: 0.8, seed: 15 },
    notes: 'Servants\' stair treads and its board enclosure.',
  }),
  m('wood_furniture_dark', 'wood_bare', {
    albedo: [0.06, 0.035, 0.018], rough: 0.5, tile: 1,
    params: { species: 'walnut', baseColor: [0.07, 0.04, 0.02], varnish: 0.85, varnishWear: 0.15, grainContrast: 0.45, edgeWear: 0.5, dust: 0.5, seed: 16 },
    notes: 'Armoire, wardrobes, hall table, nightstand, washstand, mantel, rocking chair.',
  }),
  m('wood_raw_plank', 'wood_bare', {
    albedo: [0.24, 0.185, 0.12], rough: 0.88, tile: 1.5,
    params: { species: 'pine', baseColor: [0.27, 0.21, 0.14], greyed: 0.1, saw: 'rough', grainContrast: 0.6, seed: 17 },
    notes: 'Sawbuck table, the 3 nailed planks on Ada\'s door, jerry-can shelf, closet boards.',
  }),

  // ---------- walls, ceilings, trim ----------
  m('wallpaper_damask_green', 'wallpaper', {
    albedo: [0.085, 0.11, 0.07], rough: 0.8, tile: 0.53, hero: true,
    params: { ground: [0.09, 0.12, 0.075], figure: [0.06, 0.08, 0.05], figureGloss: 0.2, motif: 'damask_a', repeatDrop: 0.5, damp: 0.45, peel: 0.3, seamSpacing: 0.53, waterStainFromCeiling: 0.35, seed: 21 },
    notes: 'Hall G1 and upper hall U1.',
  }),
  m('wallpaper_damask_rose', 'wallpaper', {
    albedo: [0.3, 0.16, 0.14], rough: 0.8, tile: 0.53,
    params: { ground: [0.32, 0.17, 0.15], figure: [0.22, 0.1, 0.09], figureGloss: 0.15, motif: 'damask_b', repeatDrop: 0.5, damp: 0.25, peel: 0.15, fade: 0.4, seamSpacing: 0.53, seed: 22 },
    notes: 'Ada\'s sewing room U3: faded, sun-bleached above the dado, sealed since 1976.',
  }),
  m('wallpaper_damask_ochre', 'wallpaper', {
    albedo: [0.33, 0.25, 0.12], rough: 0.82, tile: 0.53,
    params: { ground: [0.35, 0.27, 0.13], figure: [0.24, 0.17, 0.07], figureGloss: 0.2, motif: 'damask_c', repeatDrop: 0.5, damp: 0.35, peel: 0.25, smokeStain: 0.5, seamSpacing: 0.53, seed: 23 },
    notes: 'Parlor G2 (candle smoke above the mantel) and Harlan\'s bedroom U2.',
  }),
  m('wall_tally', 'wallpaper', {
    albedo: [0.25, 0.19, 0.095], rough: 0.8, tile: 5,
    params: { base: 'wallpaper_damask_ochre', tallyCount: 6000, tallyGroups: 5, strokeColor: [0.035, 0.035, 0.04], strokeWidth: 0.0025, strokeLength: 0.045, topLimit: 2.3, graphiteGloss: 0.35, freshColumn: false, seed: 24 },
    notes: 'Parlor north wall (shared with the kitchen): ~6,000 pencil tallies to the picture rail. freshColumn=true for the C7 sting.',
  }),
  m('plaster_damp', 'plaster', {
    albedo: [0.42, 0.39, 0.33], rough: 0.9, tile: 2,
    params: { base: [0.46, 0.43, 0.36], mould: 0.45, efflorescence: 0.3, cracks: 0.5, riseDampHeight: 0.8, seed: 31 },
    notes: 'Kitchen, back passage, void faces. Rising damp line ~0.8 m.',
  }),
  m('ceiling_plaster', 'ceiling_plaster', {
    albedo: [0.5, 0.47, 0.4], rough: 0.92, tile: 2.5,
    params: { base: [0.55, 0.52, 0.44], waterStains: 0.45, cracks: 0.4, sagging: 0.1, smokeAboveLights: 0.35, seed: 32 },
  }),
  m('trim_chipped', 'trim_paint', {
    albedo: [0.46, 0.44, 0.38], rough: 0.55, tile: 1,
    params: { paint: [0.5, 0.48, 0.42], underlayer: [0.1, 0.075, 0.05], chip: 0.35, grimeInCorners: 0.6, gloss: 0.4, seed: 33 },
    notes: 'Skirting, picture rail, architraves, window casings, balusters.',
  }),
  m('wainscot_beadboard', 'wood_painted', {
    albedo: [0.22, 0.24, 0.2], rough: 0.6, tile: 1,
    params: { paint: [0.24, 0.26, 0.21], beadSpacing: 0.1, chip: 0.4, scuff: 0.5, underlayer: [0.12, 0.09, 0.06], seed: 34 },
    notes: 'Tongue-and-groove dado in the hall, back passage and kitchen.',
  }),
  m('door_painted', 'wood_painted', {
    albedo: [0.3, 0.29, 0.25], rough: 0.5, tile: 1,
    params: { paint: [0.33, 0.32, 0.27], chip: 0.35, handGrime: 0.6, panelShadow: 0.5, seed: 35 },
    notes: 'All panel doors (front door uses door_front).',
  }),
  m('door_front', 'wood_painted', {
    albedo: [0.05, 0.035, 0.03], rough: 0.45, tile: 1, hero: true, wet: 0.35,
    params: { paint: [0.055, 0.04, 0.035], chip: 0.45, blister: 0.4, underlayer: [0.16, 0.12, 0.08], seed: 36 },
    notes: 'Front door, oxblood-black, rain-wet on the outside face.',
  }),

  // ---------- exterior envelope ----------
  m('clapboard_peeling', 'clapboard', {
    albedo: [0.36, 0.35, 0.32], rough: 0.7, tile: 3, hero: true, wet: 0.6,
    params: { boardExposure: 0.10, paint: [0.42, 0.41, 0.37], bareWood: [0.27, 0.25, 0.22], peel: 0.18, peelBand: 0.45, gloss: 0.55, mildew: 0.35, rainStreaks: 0.6, seed: 41 },
    notes: 'bareWood = silver weathered pine, peel 0.18 everywhere + peelBand (runtime, world-space) low and under the eaves ≈ 0.25 overall; gloss 0.55 → wet paint rough ≈ 0.35 (STATUS-blender-c #5).',
  }),
  m('porch_boards_wet', 'porch_boards', {
    albedo: [0.1, 0.088, 0.072], rough: 0.35, tile: 2, hero: true, wet: 0.8,
    params: { boardWidth: 0.09, paintRemnant: [0.2, 0.2, 0.19], paintRemaining: 0.25, rot: 0.3, puddles: 0.4, seed: 42 },
  }),
  m('shingles_wet', 'shingles', {
    albedo: [0.055, 0.055, 0.052], rough: 0.55, tile: 2, wet: 0.9,
    params: { shingleWidth: 0.3, exposure: 0.14, material: 'asphalt', missing: 0.05, moss: 0.3, curl: 0.35, seed: 43 },
  }),
  m('brick_old', 'brick', {
    albedo: [0.2, 0.075, 0.048], rough: 0.85, tile: 1.2, wet: 0.5,
    params: { brickSize: [0.2, 0.09], bond: 'common', mortar: [0.35, 0.33, 0.28], mortarRecess: 0.008, spalling: 0.3, soot: 0.5, seed: 44 },
    notes: 'Chimney stack and foundation piers.',
  }),
  m('brick_infill', 'brick', {
    albedo: [0.24, 0.1, 0.065], rough: 0.88, tile: 1.2,
    params: { brickSize: [0.2, 0.09], bond: 'stretcher', mortar: [0.4, 0.38, 0.32], mortarSquish: 0.8, sloppy: 0.9, seed: 45 },
    notes: 'The bricked kitchen back door: hurried, mortar squeezed out of the joints.',
  }),
  m('stone_foundation', 'stone', {
    albedo: [0.17, 0.16, 0.145], rough: 0.9, tile: 1.5, wet: 0.6,
    params: { stoneSize: 0.35, mortar: [0.3, 0.29, 0.26], moss: 0.4, seed: 46 },
  }),

  // ---------- ground ----------
  m('gravel_wet', 'gravel', {
    albedo: [0.17, 0.16, 0.145], rough: 0.6, tile: 2.5, wet: 0.7,
    params: { stoneSize: 0.025, sizeVariance: 0.6, mudFill: 0.4, puddles: 0.35, ruts: true, seed: 51 },
  }),
  m('asphalt_wet', 'asphalt', {
    albedo: [0.04, 0.04, 0.04], rough: 0.25, tile: 4, wet: 1,
    params: { aggregate: 0.5, cracks: 0.4, patches: 0.3, centreLine_srgb: [0.75, 0.6, 0.15], centreLineWear: 0.7, puddles: 0.5, seed: 52 },
  }),
  m('mud_wet', 'mud', {
    albedo: [0.065, 0.048, 0.033], rough: 0.3, tile: 2, wet: 0.95,
    params: { base: [0.075, 0.055, 0.038], tyreTracks: 0.4, puddles: 0.6, debris: 0.3, seed: 53 },
  }),
  m('grass_wet', 'grass', {
    // lead-approved spec request #41 (2026-10-08): avg albedo [0.09, 0.12, 0.06] (wet winter pasture, measured grass 0.1-0.2)
    albedo: [0.09, 0.12, 0.06], rough: 0.6, tile: 3, wet: 0.7,
    params: { dead: 0.55, weeds: 0.5, bladeDensity: 0.7, seed: 54 },
  }),
  m('grass_dead', 'grass', {
    // lead-approved spec request #34 (2026-10-08): winter-killed straw verge grass, albedo ~0.20, roughness 0.70, wetness 0.6
    albedo: [0.25, 0.2, 0.13], rough: 0.7, tile: 3, wet: 0.6,
    params: { dead: 0.95, weeds: 0.2, bladeDensity: 0.8, seed: 156 },
    notes: 'Dead straw-coloured verge and field-edge grass (corridor verges, EXT1 ditch).',
  }),
  m('bark_wet', 'bark', {
    albedo: [0.06, 0.05, 0.04], rough: 0.7, tile: 1, wet: 0.8,
    params: { furrowDepth: 0.02, lichen: 0.3, seed: 55 },
  }),

  // ---------- metals & ceramics ----------
  m('rust', 'rust', {
    albedo: [0.2, 0.075, 0.03], rough: 0.85, metal: 0.25, tile: 0.8, wet: 0.3,
    params: { base: [0.22, 0.08, 0.03], flake: 0.5, bareMetalPatches: 0.15, paintRemnant_srgb: [0.55, 0.12, 0.1], seed: 61 },
    notes: 'Gas pump, wrecks, jerry cans, sign post brackets, nail can.',
  }),
  m('cast_iron', 'cast_iron', {
    albedo: [0.05, 0.05, 0.05], rough: 0.65, metal: 0.8, tile: 0.6,
    params: { base: [0.06, 0.06, 0.06], rust: 0.25, polishOnEdges: 0.2, seed: 62 },
    notes: 'Stove, floor register, iron bed, hatch hasp, drop-bolt, pulleys.',
  }),
  m('enamel_chipped', 'enamel', {
    albedo: [0.55, 0.55, 0.5], rough: 0.2, tile: 0.6,
    params: { base: [0.6, 0.6, 0.55], chips: 0.4, chipColor: [0.03, 0.03, 0.03], rustRings: 0.3, seed: 63 },
    notes: 'Pump sink basin, washstand bowl and jug, stove door.',
  }),
  m('tile_kitchen', 'tile', {
    albedo: [0.5, 0.5, 0.45], rough: 0.25, tile: 0.6,
    params: { tileSize: 0.15, groutWidth: 0.004, grout: [0.2, 0.19, 0.16], crazing: 0.5, grime: 0.5, seed: 64 },
    notes: 'Splashback behind the pump sink.',
  }),
  m('chrome_pitted', 'chrome', {
    albedo: [0.55, 0.55, 0.55], rough: 0.3, metal: 1, tile: 0.5,
    params: { pitting: 0.5, rustSpots: 0.3, seed: 65 },
    notes: 'Sedan bumpers, trim, pump nozzle.',
  }),
  m('zinc_galvanized', 'zinc', {
    albedo: [0.45, 0.46, 0.47], rough: 0.5, metal: 1, tile: 0.5,
    params: { spangle: 0.6, whiteRust: 0.35, dents: 0.3, seed: 66 },
    notes: 'Parlor bucket, VACANCY plate, nail can, lantern box.',
  }),
  m('brass_tarnished', 'metal_brass', {
    albedo: [0.42, 0.3, 0.12], rough: 0.4, metal: 1, tile: 0.3,
    params: { tarnish: 0.6, verdigris: 0.25, polishedWhereTouched: 0.7, seed: 67 },
    notes: 'Bell-pull knob, spring bell, door knocker, locket, bolt-box plate, lamp burner.',
  }),

  // ---------- glass ----------
  m('glass_grimy', 'glass', {
    albedo: [0.04, 0.04, 0.04], rough: 0.15, tile: 1,
    params: { ior: 1.52, transmission: 0.85, grime: 0.6, fly_specks: 0.3, waviness: 0.4, seed: 71 },
  }),
  m('glass_rain', 'glass', {
    albedo: [0.04, 0.04, 0.04], rough: 0.05, tile: 1, wet: 1,
    params: { ior: 1.52, transmission: 0.9, rainStreaks: 1, droplets: 0.8, grime: 0.3, seed: 72 },
    notes: 'Exterior window faces and the car windscreen.',
  }),

  // ---------- textiles ----------
  m('runner_rug', 'rug', {
    albedo: [0.1, 0.03, 0.025], rough: 0.95, tile: 0.9,
    params: { field: [0.11, 0.03, 0.025], border: [0.05, 0.04, 0.02], pattern: 'turkey_runner', wornPath: 0.6, fringe: true, pile: 0.6, seed: 81 },
  }),
  m('rag_rug', 'rug', {
    albedo: [0.16, 0.13, 0.1], rough: 0.95, tile: 0.6,
    params: { pattern: 'braided_oval', colours: 5, dirt: 0.6, seed: 82 },
  }),
  m('dust_sheet', 'fabric', {
    albedo: [0.46, 0.44, 0.38], rough: 0.95, tile: 0.8,
    params: { weave: 'plain_cotton', dust: 0.8, yellowing: 0.5, foldCreases: 0.6, seed: 83 },
  }),
  m('crepe_black', 'crepe', {
    albedo: [0.015, 0.014, 0.014], rough: 0.9, tile: 0.2,
    params: { maxSize: 512, crinkle: 0.8, dustOnTop: 0.4, fade: 0.2, seed: 84 },
    notes: 'Mourning crepe over every mirror.',
  }),
  m('burlap_sack', 'burlap', {
    albedo: [0.33, 0.25, 0.15], rough: 0.95, tile: 0.25,
    params: { weave: 0.004, stencil: 'STROUD FEED & SEED', stencilColor_srgb: [0.15, 0.2, 0.3], stains: 0.6, fraying: 0.5, seed: 85 },
    notes: 'Harlan\'s mask is baked_unique on the character; this tiling version is for spare sacks and the mask-making chair.',
  }),
  m('flannel_red', 'flannel', {
    albedo: [0.22, 0.035, 0.03], rough: 0.9, tile: 0.15, source: 'baked_unique',
    params: { check: 'buffalo', checkSize: 0.05, secondary: [0.02, 0.02, 0.02], pilling: 0.6, stains: 0.4, seed: 86 },
  }),
  m('nightgown_silt', 'nightgown', {
    albedo: [0.4, 0.39, 0.33], rough: 0.7, tile: 0.4, wet: 0.9, source: 'baked_unique',
    params: { base: [0.55, 0.52, 0.44], silt: [0.12, 0.13, 0.08], siltAmount: 0.6, translucencyWet: 0.4, lace: true, seed: 87 },
  }),
  m('wedding_satin', 'fabric', {
    albedo: [0.55, 0.52, 0.44], rough: 0.45, tile: 0.4, hero: true,
    params: { weave: 'satin', yellowing: 0.55, dust: 0.5, foxing: 0.3, lace: true, seed: 88 },
    notes: 'The wedding dress on the dummy (two mesh states: intact hem / cut hem).',
  }),
  m('ticking_mattress', 'fabric', {
    albedo: [0.35, 0.33, 0.3], rough: 0.9, tile: 0.3,
    params: { weave: 'ticking_stripe', stripe: [0.05, 0.06, 0.1], stains: 0.7, seed: 89 },
  }),
  m('wool_coats', 'fabric', {
    albedo: [0.07, 0.065, 0.06], rough: 0.95, tile: 0.3,
    params: { weave: 'twill', variants: 4, dust: 0.3, seed: 90 },
    notes: 'Strangers\' coats in Harlan\'s wardrobe.',
  }),

  // ---------- rubber / leather ----------
  m('rubber_black', 'rubber', {
    albedo: [0.018, 0.018, 0.018], rough: 0.4, tile: 0.5, wet: 0.5,
    params: { sheen: 0.5, cracks: 0.35, scuffs: 0.4, seed: 91 },
    notes: 'Rubber sheet on the sawbuck table, apron, boots, tyres.',
  }),
  m('leather_worn', 'leather', {
    albedo: [0.035, 0.022, 0.015], rough: 0.55, tile: 0.2,
    params: { maxSize: 512, grain: 0.5, creases: 0.6, wear: 0.5, seed: 92 },
    notes: 'Driving gloves, handbag, bell-pull backing, ledger binding.',
  }),

  // ---------- characters (baked unique) ----------
  m('skin_ada', 'skin', {
    albedo: [0.3, 0.32, 0.34], rough: 0.45, tile: 1, wet: 0.8, source: 'baked_unique',
    params: { tone: [0.33, 0.35, 0.37], veins: 0.55, wrinklingFromWater: 0.6, sss: 0.3, lividity: 0.4, seed: 101 },
  }),
  m('skin_harlan', 'skin', {
    albedo: [0.42, 0.28, 0.22], rough: 0.5, tile: 1, source: 'baked_unique',
    params: { tone: [0.45, 0.3, 0.23], weathering: 0.7, liverSpots: 0.4, sss: 0.4, seed: 102 },
    notes: 'Only his forearms/neck; the face is never rendered.',
  }),
  m('hair_wet_black', 'hair', {
    albedo: [0.012, 0.011, 0.011], rough: 0.25, tile: 1, wet: 1, source: 'baked_unique',
    params: { strandWidth: 0.0004, clumping: 0.85, specShift: 0.05, alphaThreshold: 0.35, seed: 103 },
  }),

  // ---------- characters: garments & hand props (baked unique on the character; factors are the fallback) ----------
  m('trousers_wool', 'fabric', {
    albedo: [0.055, 0.05, 0.042], rough: 0.92, tile: 0.3, source: 'baked_unique',
    params: { weave: 'twill', dust: 0.4, kneeWear: 0.6, mud: 0.5, seed: 104 },
    notes: 'Harlan\'s work trousers (brown-black wool twill, muddy hems).',
  }),
  m('twine_jute', 'rope', {
    albedo: [0.3, 0.23, 0.13], rough: 0.95, tile: 0.1, source: 'baked_unique',
    params: { strands: 2, twist: 0.9, fuzz: 0.7, grime: 0.5, seed: 105 },
    notes: 'Twine tying Harlan\'s sack at the neck; spare twine on the mask-making chair.',
  }),
  m('steel_cleaver', 'chrome', {
    albedo: [0.3, 0.3, 0.29], rough: 0.45, metal: 1, tile: 0.3, source: 'baked_unique',
    params: { pitting: 0.7, rustSpots: 0.55, honedEdge: 0.8, seed: 106 },
    notes: 'Hog-cleaver blade: carbon steel, pitted, rust blooms, bright honed edge.',
  }),
  // ---------- round E (R3, approved 2026-10-08): handheld story props ----------
  m('steel_forged', 'chrome', {
    albedo: [0.4, 0.39, 0.38], rough: 0.32, metal: 1, tile: 0.15,
    params: { maxSize: 512, grind: 0.7, patina: 0.45, pitting: 0.25, rustSpots: 0.15, seed: 160 },
    notes: 'Hammer head + sewing-shear blades: forged/ground carbon steel, F0 0.56 fresh (Gulbrandsen) under a grey-brown handling patina (0.25), rough 0.2-0.45.',
  }),
  m('hickory_handle', 'wood_bare', {
    albedo: [0.3, 0.19, 0.095], rough: 0.5, tile: 0.4,
    params: { maxSize: 512, species: 'hickory', boardWidth: 0.05, boardLengthMin: 0.4, boardLengthMax: 0.4, baseColor: [0.36, 0.23, 0.115], grainContrast: 0.45, varnish: 0.35, varnishWear: 0.55, seed: 161 },
    notes: 'Claw-hammer handle: hickory (light tan, ρ 0.35-0.45 sRGB-ish → linear ≈ 0.3), worn factory lacquer, hand-oiled grip.',
  }),
  m('paint_steel_can', 'enamel', {
    albedo: [0.13, 0.024, 0.017], rough: 0.55, metal: 0.05, tile: 0.5,
    params: { base: [0.17, 0.022, 0.016], chalking: 0.45, scuffs: 0.55, chips: 0.3, rustRuns: 0.35, stains: 0.25, seed: 162 },
    notes: 'Jerry cans: aged, dirt-dulled oxide-red alkyd enamel (≈ sRGB 115/40/34 — a 30-year-old can, not showroom red) over red-oxide primer on pressed sheet steel; chalked, scuffed, chipped (wear rule painted_steel).',
  }),
  m('enamel_stove', 'enamel', {
    albedo: [0.27, 0.275, 0.285], rough: 0.15, tile: 0.4,
    params: { maxSize: 512, mottle: 1, dark: [0.11, 0.115, 0.125], light: [0.55, 0.56, 0.57], chips: 0.8, rustRings: 0.25, seed: 164 },
    notes: 'Iron-stove oven-door panel: grey-and-white mottled porcelain enamel, chipped to black iron at the rim with rust haloes.',
  }),
  m('wood_weathered_post', 'wood_bare', {
    albedo: [0.13, 0.12, 0.105], rough: 0.7, tile: 1.2, wet: 0.25,
    params: { species: 'pine', boardWidth: 0.14, boardLengthMin: 4, boardLengthMax: 4, baseColor: [0.2, 0.15, 0.1], greyed: 0.85, grainContrast: 0.7, checks: 0.7, mildew: 0.5, dirtInGaps: 0.8, gapDepth: 0.003, seed: 165 },
    notes: 'Roadside sign post + sign planks: 40-year exterior cedar/pine, silver-grey UV weathering (wet: ×0.6 albedo), season checks, mildew streaks.',
  }),
  m('paint_steel_sign', 'enamel', {
    albedo: [0.42, 0.4, 0.33], rough: 0.5, metal: 0.05, tile: 0.5,
    params: { base: [0.58, 0.55, 0.45], chalking: 0.5, scuffs: 0.35, chips: 0.6, rustRuns: 0.7, stains: 0.15, seed: 166 },
    notes: 'VACANCY plate: cream sign enamel on tinplate, chalked, chipped to rusty steel at the folded hems, rust runs from the hook holes.',
  }),
  m('wool_needlepoint', 'fabric', {
    albedo: [0.12, 0.05, 0.035], rough: 0.9, tile: 0.3,
    params: { maxSize: 512, fade: 0.45, dust: 0.4, seed: 163 },
    notes: 'Bell pull: Berlin wool-work tent stitch on 10-count canvas, claret ground with a faded floral motif.',
  }),
  m('coat_rain_dark', 'fabric', {
    albedo: [0.04, 0.04, 0.045], rough: 0.8, tile: 0.3, wet: 0.7, source: 'baked_unique',
    params: { weave: 'twill', dust: 0.1, seed: 107 },
    notes: 'Player\'s rain-dark coat sleeves (first-person arms).',
  }),
  m('steel_flashlight', 'chrome', {
    albedo: [0.45, 0.45, 0.44], rough: 0.35, metal: 1, tile: 0.2, source: 'baked_unique',
    params: { pitting: 0.2, rustSpots: 0.05, knurl: 0.8, seed: 108 },
    notes: 'Steel two-cell flashlight body (first-person arms).',
  }),
  m('lens_flashlight', 'glass', {
    albedo: [0.04, 0.04, 0.04], rough: 0.05, tile: 0.1, source: 'constant',
    params: { ior: 1.5, transmission: 0.9, grime: 0.2, emissive_srgb: [1.0, 0.86, 0.62], seed: 109 },
    notes: 'Flashlight lens + reflector/bulb (separate mesh arms_flashlight_lens): emissive warm white when the light is on.',
  }),
  m('eye_ada', 'skin', {
    albedo: [0.36, 0.35, 0.31], rough: 0.05, tile: 1, wet: 1, source: 'baked_unique',
    params: { clouded: 0.8, bloodshot: 0.5, seed: 110 },
    notes: 'Ada\'s single visible eye: milky, clouded cornea under a wet clearcoat.',
  }),

  // ---------- vehicles ----------
  m('car_paint_sedan', 'car_paint', {
    albedo: [0.05, 0.075, 0.11], rough: 0.35, tile: 1, hero: true, wet: 0.9,
    params: { base_srgb: [0.28, 0.35, 0.45], metallicFlake: 0.3, clearcoat: 0.6, oxidation: 0.4, dirtLower: 0.6, seed: 111 },
    notes: 'Player sedan RVX-318: faded late-80s steel blue.',
  }),
  m('car_paint_wreck', 'car_paint', {
    albedo: [0.1, 0.075, 0.055], rough: 0.75, tile: 1, wet: 0.7,
    params: { baseVariants_srgb: [0.5, 0.45, 0.35], variants: 5, oxidation: 0.9, rustThrough: 0.5, moss: 0.3, seed: 112 },
  }),
  m('car_interior_tan', 'car_interior', {
    albedo: [0.28, 0.2, 0.13], rough: 0.7, tile: 0.5, hero: true, source: 'baked_unique',
    params: { vinyl: [0.3, 0.22, 0.14], velour: 0.5, dashCrack: 0.4, seed: 113 },
  }),
  m('plastic_wheel_tan', 'rubber', {
    // constant (no maps): a 1980s colour-keyed injection-moulded rim, hand-polished smooth where it is held
    // (AD review: no vinyl crazing on the rim). Runtime remaps sedan_interior-steering's car_interior_tan slot to it.
    albedo: [0.26, 0.185, 0.12], rough: 0.42, tile: 0.3, source: 'constant',
    params: { sheen: 0.5, cracks: 0.0, scuffs: 0.2, seed: 157 },
    notes: 'Steering wheel rim/spokes/horn bar of the hero sedan interior (worn smooth tan plastic).',
  }),
  m('grime_decal', 'wax', {
    // PROPS-FINISH §4.1 / R1: placeholder id on kit.grime() quads (rings, wax, soot, rust runs, smudges); the runtime
    // replaces it with the shared grime-atlas material (src/world/decals.ts 'grime'). Constant, no wear rule.
    albedo: [0.1, 0.09, 0.08], rough: 0.7, tile: 1, source: 'constant',
    notes: 'Grime decal quads (replaced at load by the procedural grime atlas).',
  }),
  m('car_interior_maroon', 'car_interior', {
    albedo: [0.11, 0.025, 0.03], rough: 0.7, tile: 0.5, source: 'baked_unique',
    params: { vinyl: [0.12, 0.028, 0.032], velour: 0.6, dashCrack: 0.2, seed: 114 },
    notes: 'C7 sting re-trim of the same sedan interior.',
  }),

  // ---------- small props ----------
  m('wax_candle', 'wax', {
    albedo: [0.62, 0.57, 0.44], rough: 0.4, tile: 0.2,
    params: { maxSize: 512, sss: 0.6, drips: 0.8, soot: 0.3, seed: 121 },
  }),
  m('paper_aged', 'paper', {
    albedo: [0.55, 0.48, 0.35], rough: 0.9, tile: 0.3,
    params: { foxing: 0.5, waterDamage: 0.3, ruled: true, ink: [0.02, 0.02, 0.04], seed: 122 },
    notes: 'Guest book, ledger, letter, bus ticket. Text drawn at runtime by src/materials/handwriting.ts.',
  }),
  m('wick_cotton', 'rope', {
    albedo: [0.3, 0.27, 0.22], rough: 0.95, tile: 0.05,
    params: { maxSize: 256, strands: 12, twist: 0.2, fuzz: 0.8, grime: 0.4, charredTip: 0.9, seed: 125 },
    notes: 'Flat woven kerosene-lamp wick (charred at the tip) and candle wicks.',
  }),
  m('rope_hemp', 'rope', {
    albedo: [0.28, 0.22, 0.14], rough: 0.9, tile: 0.15,
    params: { maxSize: 512, strands: 3, twist: 0.8, fuzz: 0.5, grime: 0.5, seed: 123 },
    notes: 'The door rope, the bell wire uses cast_iron.',
  }),
  m('photo_print', 'paper', {
    albedo: [0.25, 0.23, 0.2], rough: 0.35, tile: 1, source: 'baked_unique',
    params: { sepia: 0.7, faceKnifedOut: true, foxing: 0.4, seed: 124 },
    notes: 'Wedding portrait and 1970 pump photo (faces knifed out); locket photo is water-bloomed.',
  }),
  // ---------- the opening (C0 County Road 9 + C1 Empty; docs/C1-OPENING.md §6) ----------
  m('vinyl_dash_black', 'car_interior', {
    albedo: [0.032, 0.03, 0.028], rough: 0.6, tile: 0.5,
    params: { vinyl: [0.035, 0.033, 0.03], velour: 0.0, dashCrack: 0.7, sunCraze: 0.6, seed: 140 },
    notes: 'Padded crash pad, binnacle hood, column shroud: sun-crazed black vinyl with three real geometry cracks.',
  }),
  m('headliner_cloth', 'fabric', {
    albedo: [0.4, 0.33, 0.24], rough: 0.95, tile: 0.4,
    params: { weave: 'knit_foam_back', dust: 0.3, yellowing: 0.6, nicotine: 0.5, seed: 141 },
    notes: 'Foam-backed tan headliner knit, nicotine-yellowed; sags at the rear.',
  }),
  m('carpet_auto', 'rug', {
    albedo: [0.1, 0.075, 0.05], rough: 1.0, tile: 0.4,
    params: { pattern: 'cut_pile', colours: 1, dirt: 0.75, heelWear: 0.6, seed: 142 },
    notes: 'Molded cut-pile auto carpet; heel pad worn through under the driver.',
  }),
  m('styrofoam', 'paper', {
    albedo: [0.72, 0.7, 0.64], rough: 0.5, tile: 0.1,
    params: { maxSize: 512, beads: 0.8, coffeeStain: 0.5, foxing: 0.0, seed: 143 },
    notes: 'Gas-station 12 oz foam coffee cup and its sip lid.',
  }),
  m('plastic_cluster', 'rubber', {
    albedo: [0.03, 0.03, 0.03], rough: 0.35, tile: 0.3,
    params: { sheen: 0.7, cracks: 0.1, scuffs: 0.3, seed: 144 },
    notes: 'Gauge-cluster bezel, radio face, switches, stalks, PRNDL bezel: grained black ABS.',
  }),
  m('plywood_weathered', 'wood_bare', {
    albedo: [0.2, 0.17, 0.13], rough: 0.9, tile: 2.4, wet: 0.6,
    params: { species: 'pine', baseColor: [0.22, 0.19, 0.15], greyed: 0.7, saw: 'rough', grainContrast: 0.5, delamination: 0.4, waterStains: 0.6, seed: 145 },
    notes: 'Boards over the dead diner windows; greyed, delaminating at the edges.',
  }),
  m('sign_sheeting', 'enamel', {
    albedo: [0.03, 0.12, 0.06], rough: 0.3, tile: 1, wet: 0.8,
    params: { base: [0.02, 0.13, 0.06], chips: 0.1, chipColor: [0.3, 0.3, 0.3], rustRings: 0.0, retro: 1.0, seed: 146 },
    notes: 'Highway-green retroreflective sheeting (guide signs, county shield). retro = retroreflective gain at runtime.',
  }),
  m('paint_road_yellow', 'trim_paint', {
    albedo: [0.33, 0.24, 0.05], rough: 0.35, tile: 2, wet: 1,
    params: { paint: [0.35, 0.25, 0.04], underlayer: [0.04, 0.04, 0.04], chip: 0.5, grimeInCorners: 0.0, gloss: 0.5, retro: 0.4, seed: 147 },
    notes: 'Faded double-yellow centre line, 40-70 % worn, glass-bead retroreflection.',
  }),
  m('leaf_litter_wet', 'mud', {
    albedo: [0.06, 0.045, 0.03], rough: 0.7, tile: 2, wet: 0.8,
    params: { base: [0.07, 0.05, 0.032], tyreTracks: 0.0, puddles: 0.2, debris: 0.9, seed: 148 },
    notes: 'Forest floor under the pines: needles, cones, leaf litter.',
  }),
  m('fur_deer', 'fabric', {
    albedo: [0.18, 0.12, 0.07], rough: 0.8, tile: 0.3, wet: 0.4,
    params: { weave: 'fur', dust: 0.0, seed: 149 },
    notes: 'Whitetail winter coat (greyer brown); white throat and tail underside via vertex colour-free bands.',
  }),
  m('cloth_dark', 'fabric', {
    // constant (no baked maps): a back-lit silhouette never shows weave; keeps Max baked-map memory < 1000 MB
    albedo: [0.04, 0.04, 0.042], rough: 0.85, tile: 0.3, wet: 0.3, source: 'constant',
    params: { weave: 'twill', dust: 0.1, seed: 150 },
    notes: 'The driver silhouette proxy (exterior shots only): never lit from the front.',
  }),
  m('water_ditch', 'glass', {
    albedo: [0.02, 0.022, 0.02], rough: 0.05, tile: 2,
    params: { ior: 1.33, transmission: 0.0, grime: 0.3, fly_specks: 0.0, waviness: 0.6, rainRings: 1.0, seed: 151 },
    notes: 'Standing water in the corridor ditch bottom (rain-ring normals at runtime).',
  }),
  m('pine_needles', 'grass', {
    albedo: [0.028, 0.042, 0.024], rough: 0.75, tile: 2, wet: 0.6,
    params: { dead: 0.12, weeds: 0.0, bladeDensity: 1.0, needles: true, seed: 154 },
    notes: 'Loblolly / white-pine foliage plates and the corridor canopy blanket (solid geometry, no cards).',
  }),
  m('canopy_far', 'grass', {
    albedo: [0.014, 0.021, 0.012], rough: 1.0, tile: 8, wet: 0.0,
    params: { dead: 0.1, weeds: 0.0, bladeDensity: 1.0, needles: true, seed: 155 },
    notes: 'Corridor canopy blanket: the EFFECTIVE albedo of a conifer canopy seen as one surface (needle albedo x crown self-shadowing ~0.5).',
  }),
  m('truck_paint', 'car_paint', {
    albedo: [0.12, 0.03, 0.02], rough: 0.6, tile: 1, wet: 0.9,
    params: { base_srgb: [0.42, 0.12, 0.08], metallicFlake: 0.0, clearcoat: 0.2, oxidation: 0.7, dirtLower: 0.9, seed: 152 },
    notes: 'Logging-truck cab: faded oxide red, road grime to the doors.',
  }),
  m('concrete_wet', 'stone', {
    albedo: [0.16, 0.155, 0.145], rough: 0.7, tile: 2, wet: 0.8,
    params: { stoneSize: 4.0, mortar: [0.15, 0.15, 0.14], moss: 0.3, seed: 153 },
    notes: 'Diner pump island and stoop.',
  }),
];

export const MATERIAL_IDS = new Set(MATERIALS.map((x) => x.id));
