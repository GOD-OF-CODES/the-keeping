// Per-material albedo calibration (linear RGB multipliers on the generator's albedo, applied in bake pass 1).
// The generators build structure and colour relationships by hand; this table trims their MEAN onto the spec's
// avgAlbedo (the Cycles bounce colour) so the ±10 % check holds without a big runtime gain.
// Regenerate after changing a generator: open /?scene=matlab&debug&preset=medium, run
//   copy(__matlab.calibration())   → paste over ALBEDO_CAL below.
// Values are measured means (mip-averaged over the whole tile), so they are resolution-independent to ~1–3 %.

export const ALBEDO_CAL: Record<string, [number, number, number]> = {
  floor_varnished: [0.771, 0.852, 1.026], // round E (Nyquist 0.5, matlab)
  floor_bare: [0.89, 0.865, 0.847], // round E (Nyquist 0.5, matlab)
  floor_scrubbed: [0.964, 0.951, 0.923], // round E (Nyquist 0.5, matlab)
  stair_treads: [0.694, 0.764, 0.879], // round E (Nyquist 0.5, matlab)
  stair_rough: [0.889, 0.847, 0.778], // round E (Nyquist 0.5, matlab)
  wood_furniture_dark: [0.862, 0.996, 1.111], // round E (Nyquist 0.5, matlab)
  wood_raw_plank: [0.918, 0.917, 0.909], // round E (Nyquist 0.5, matlab)
  wallpaper_damask_green: [0.974, 0.978, 0.996],
  wallpaper_damask_rose: [0.932, 0.948, 0.952],
  wallpaper_damask_ochre: [1.098, 1.117, 1.161],
  wall_tally: [0.86, 0.87, 0.919], // r3 (R2-6 lighter true-width strokes): matlab HUD read +11 % → ×0.91 estimate; re-run copy(__matlab.calibration())
  plaster_damp: [1.182, 1.192, 1.238],
  ceiling_plaster: [1.035, 1.05, 1.094],
  trim_chipped: [1.03, 1.05, 1.109], // round D: paintOver brush Nyquist cap
  wainscot_beadboard: [1.029, 1.041, 1.08],
  door_painted: [1.013, 1.017, 1.046],
  door_front: [0.935, 0.878, 0.911],
  clapboard_peeling: [1.16, 1.158, 1.177], // round D props-runtime: bareWood silver 0.27, peel 0.18, gloss 0.55, rain runs 5 cm (matlab copy(__matlab.calibration()))
  porch_boards_wet: [1.812, 1.691, 1.53],
  shingles_wet: [1.411, 1.41, 1.566],
  brick_old: [1.468, 1.142, 1.007],
  brick_infill: [1.086, 0.921, 0.85],
  stone_foundation: [1.377, 1.313, 1.358],
  gravel_wet: [1.429, 1.49, 1.563],
  asphalt_wet: [1.612, 1.653, 1.619],
  mud_wet: [1.391, 1.411, 1.418],
  grass_wet: [1.302, 1.804, 1.874],
  bark_wet: [1.872, 1.804, 1.865],
  rust: [0.923, 0.811, 0.616],
  cast_iron: [0.672, 0.77, 0.837],
  enamel_chipped: [0.94, 0.949, 0.949],
  tile_kitchen: [1.011, 1.015, 1.021],
  chrome_pitted: [0.979, 1.002, 0.984],
  zinc_galvanized: [0.95, 0.953, 0.959],
  brass_tarnished: [0.856, 0.829, 0.778],
  glass_grimy: [0.66, 0.689, 0.759],
  glass_rain: [0.835, 0.859, 0.911],
  runner_rug: [0.982, 0.505, 0.536],
  rag_rug: [1.568, 1.517, 1.42],
  dust_sheet: [1.037, 1.057, 1.079],
  crepe_black: [0.912, 0.935, 0.971],
  burlap_sack: [1.142, 1.146, 1.21],
  flannel_red: [1.09, 1.341, 1.15],
  nightgown_silt: [1.238, 1.267, 1.285],
  wedding_satin: [0.987, 1.001, 1.047],
  ticking_mattress: [1.236, 1.212, 1.172],
  wool_coats: [0.735, 0.729, 0.735],
  rubber_black: [1.073, 1.073, 1.012],
  leather_worn: [0.786, 0.812, 0.833],
  skin_ada: [1.118, 1.139, 1.133],
  skin_harlan: [0.963, 0.966, 0.982],
  hair_wet_black: [1.149, 1.144, 1.144],
  car_paint_sedan: [0.81, 0.826, 0.759],
  car_paint_wreck: [0.631, 0.627, 0.814],
  car_interior_tan: [1.128, 1.101, 1.137],
  car_interior_maroon: [1.09, 1.046, 1.115],
  wax_candle: [1.001, 0.999, 0.999],
  paper_aged: [1.034, 1.064, 1.131],
  rope_hemp: [1.141, 1.159, 1.175],
  photo_print: [0.994, 1.029, 1.11],
  // 2026-09-30: character/prop specs added by the Blender quality pass (measured in the material lab, Medium)
  trousers_wool: [0.609, 0.597, 0.578],
  twine_jute: [1.138, 1.156, 1.17],
  steel_cleaver: [0.704, 0.748, 0.763], // round E props (matlab)
  coat_rain_dark: [1.081, 1.091, 1.144],
  steel_flashlight: [0.764, 0.767, 0.729],
  lens_flashlight: [0.853, 0.87, 0.906],
  eye_ada: [1.053, 1.053, 1.054],
  wick_cotton: [1.108, 1.121, 1.135],
  grass_dead: [1.111, 1.714, 1.63],
  vinyl_dash_black: [0.929, 0.914, 0.953],
  headliner_cloth: [1.022, 1.042, 1.08],
  carpet_auto: [1.243, 1.23, 1.197],
  styrofoam: [1.016, 1.024, 1.034],
  plastic_cluster: [0.88, 0.889, 0.895],
  plywood_weathered: [1.419, 1.38, 1.316],
  sign_sheeting: [1.547, 0.958, 1.036],
  paint_road_yellow: [1.4, 1.429, 1.404],
  leaf_litter_wet: [1.105, 1.19, 1.276],
  fur_deer: [1.276, 1.274, 1.279],
  water_ditch: [0.79, 0.894, 0.864],
  pine_needles: [1.392, 1.92, 1.926],
  canopy_far: [1.135, 1.549, 1.56],
  truck_paint: [0.94, 1.285, 1.192],
  concrete_wet: [1.789, 1.712, 1.763],
  steel_forged: [0.861, 0.857, 0.863], // round E props (matlab)
  hickory_handle: [0.868, 0.903, 0.96], // round E props (matlab)
  paint_steel_can: [0.708, 0.768, 0.71], // round E props (matlab r2: oxide-red 0.17 base)
  enamel_stove: [0.875, 0.883, 0.892], // round E props (matlab)
  wood_weathered_post: [0.845, 0.941, 1.11], // round E props (matlab r2: wet 0.25)
  paint_steel_sign: [0.727, 0.748, 0.76], // round E props (matlab)
  wool_needlepoint: [0.815, 0.506, 0.534], // round E props (matlab r2: palette fix)
};
