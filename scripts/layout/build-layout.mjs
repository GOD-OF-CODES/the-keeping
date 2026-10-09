#!/usr/bin/env node
// Generates src/shared/level-layout.json (schema: src/shared/layout-types.ts) and
// src/shared/material-spec.json (schema: src/shared/material-types.ts, table: ./materials.mjs).
// Plain Node, no dependencies. Run: node scripts/layout/build-layout.mjs   then: node scripts/validate-layout.mjs
//
// PLAN space: metres, Z-up, x = east, y = north. The front (south) facade faces -y.
// Conventions used here (also written into meta.notes):
//  - Prop `yaw` is a ROTATION of the generator's model (models face -y at yaw 0). faceYaw(dx,dy) gives the yaw that
//    turns the front toward (dx,dy).
//  - Headings (spawn.yaw, hide.eyeYaw, aiNode.lookYaw) are DIRECTIONS, CCW from +x (east = 0, north = pi/2).
//  - Wall a->b: `left` is the room on the left looking from a to b. Exterior walls run counter-clockwise (left = inside).

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATERIALS } from './materials.mjs';
import { rcPoint, rcFaceOncoming, rcFaceRoad, frame as rcFrame, definition as rcDefinition } from './rc9.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PI = Math.PI;
const r3 = (v) => Math.round(v * 1000) / 1000;
const deep = (v) => (typeof v === 'number' ? r3(v) : Array.isArray(v) ? v.map(deep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);
/** Prop yaw that turns a model built facing -y toward direction (dx, dy). */
const faceYaw = (dx, dy) => Math.atan2(dx, -dy);
const FACE = { S: 0, N: PI, E: PI / 2, W: -PI / 2 };
/** Heading (CCW from +x) of direction (dx, dy). */
const heading = (dx, dy) => Math.atan2(dy, dx);
const H = { E: 0, N: PI / 2, W: PI, S: -PI / 2 };

// ------------------------------------------------------------------ levels
const GRADE = 0;
const EG = 0.6; // ground finished floor (3 porch steps above grade)
const SLAB = 0.3;
const CEIL_G = 3.2;
const EU = EG + CEIL_G + SLAB; // 4.1
const CEIL_U = 2.9;
const EAVE = EU + CEIL_U + 0.2; // 7.2
const EYE = 1.65;
const TE = 0.3; // exterior wall
const TI = 0.15; // interior wall

const MAIN_RISERS = 16;
const MAIN_RISER_H = (EU - EG) / MAIN_RISERS; // 0.21875
const MAIN_TREAD = 0.28;
const BACK_RISERS = 14;
const BACK_RISER_H = (EU - EG) / BACK_RISERS; // 0.25
const BACK_TREAD = 0.25;

const floors = [
  { id: 'exterior', elevation: GRADE, slabThickness: 0 },
  { id: 'ground', elevation: EG, slabThickness: SLAB },
  { id: 'upper', elevation: EU, slabThickness: SLAB },
  { id: 'car', elevation: 0, slabThickness: 0 },
];

// ------------------------------------------------------------------ rooms
const R = {
  EXT1: [-20, -38, 20, -28],
  EXT2: [-10, -28, 70, 16],
  G1: [0, 0, 3.6, 9],
  CLOSET: [0, 5.4, 1.06, 9],
  G3P: [0, 9.15, 3.6, 10.75],
  G2: [3.75, 0, 8.75, 6],
  G3: [3.75, 6.15, 8.75, 10.75],
  U4: [5.45, 10.85, 8.75, 11.65],
  U1: [0, 0, 3.6, 9],
  U2: [3.75, 0, 8.75, 4.5],
  U3: [3.75, 4.65, 8.75, 9.15],
  U4T: [4.6, 9.3, 5.45, 11.65],
  CAR: [100, 0, 101.6, 2.8],
  RC9: [70, -420, 1500, -10],   // County Road 9 corridor set (docs/C1-OPENING.md §2): C0/C1 only, hidden in play
};
const STAIRWELL = [0, 4.6, 1.2, 7.8];
const GRATE = [5.7, 2.9, 6.3, 3.5];

const rooms = [];
function room(id, name, floor, kind, o) {
  rooms.push({
    id, name, floor, kind, rect: R[id], ceiling: o.ceiling ?? 0,
    floorMat: o.floorMat, wallMat: o.wallMat, ceilingMat: o.ceilingMat ?? 'ceiling_plaster', trimMat: o.trimMat ?? 'trim_chipped',
    ...(o.wainscot ? { wainscot: o.wainscot } : {}),
    floorHoles: o.floorHoles ?? [], ceilingHoles: o.ceilingHoles ?? [],
    reverb: o.reverb, visibleRooms: o.visible, atlas: o.atlas, playable: o.playable ?? true, milestone: o.ms,
    ...(o.within ? { within: o.within } : {}),
    ...(o.note ? { note: o.note } : {}),
  });
}
room('EXT1', 'County Road 9 & the ROOMS sign', 'exterior', 'exterior', {
  floorMat: 'asphalt_wet', wallMat: 'bark_wet', ceilingMat: 'none', trimMat: 'none',
  reverb: { size: 40, damping: 0.9, wet: 0.05 }, visible: ['EXT1', 'EXT2'], atlas: 'LM_EXTERIOR', ms: 'M1',
  note: '7 m two-lane asphalt (y -36.5..-29.5), gravel shoulders, flooded ditch south, fence + gate north. Fog wall ~30 m.',
});
room('EXT2', 'Drive, yard, porch & east field', 'exterior', 'exterior', {
  floorMat: 'gravel_wet', wallMat: 'clapboard_peeling', ceilingMat: 'none', trimMat: 'trim_chipped',
  reverb: { size: 30, damping: 0.85, wet: 0.08 }, visible: ['EXT2', 'EXT1', 'G1'], atlas: 'LM_EXTERIOR', ms: 'M1',
  note: 'Walkable: drive (x -0.7..4.3, y -28..-2.8), porch, yard in front of the facade. East of x 12 is the wreck-field vista (mist/lightning only). The house footprint sits inside this rect but on other floors.',
});
room('G1', 'Entrance hall & main stair', 'ground', 'interior', {
  ceiling: CEIL_G, floorMat: 'floor_varnished', wallMat: 'wallpaper_damask_green', wainscot: { height: 0.95, mat: 'wainscot_beadboard' },
  ceilingHoles: [STAIRWELL], reverb: { size: 9, damping: 0.45, wet: 0.3 },
  visible: ['G1', 'G2', 'U1', 'EXT2', 'G3P', 'CLOSET'], atlas: 'LM_GROUND', ms: 'M1',
});
room('CLOSET', 'Under-stair closet', 'ground', 'interior', {
  ceiling: CEIL_G, floorMat: 'floor_bare', wallMat: 'wood_raw_plank', trimMat: 'wood_raw_plank', ceilingMat: 'stair_rough',
  reverb: { size: 1.5, damping: 0.75, wet: 0.12 }, visible: ['CLOSET', 'G3P', 'G1'], atlas: 'LM_GROUND', ms: 'M2', within: 'G1',
  note: 'Nested inside G1 (optional field `within`). Its ceiling is the underside of the main stair (walls use clipToStair).',
});
room('G3P', 'Back passage', 'ground', 'interior', {
  ceiling: CEIL_G, floorMat: 'floor_bare', wallMat: 'plaster_damp', wainscot: { height: 0.95, mat: 'wainscot_beadboard' },
  reverb: { size: 3.6, damping: 0.5, wet: 0.25 }, visible: ['G3P', 'G1', 'G3', 'CLOSET'], atlas: 'LM_GROUND', ms: 'M2',
});
room('G2', 'The parlor (first room on the right)', 'ground', 'interior', {
  ceiling: CEIL_G, floorMat: 'floor_varnished', wallMat: 'wallpaper_damask_ochre', ceilingHoles: [GRATE],
  reverb: { size: 6, damping: 0.55, wet: 0.25 }, visible: ['G2', 'G1', 'U2'], atlas: 'LM_PARLOR', playable: false, ms: 'M1',
  note: 'Never free-roamed: seen from cameras parlor_threshold / parlor_wide / parlor_grate. North wall (G3 side) carries wall_tally.',
});
room('G3', 'Kitchen', 'ground', 'interior', {
  ceiling: CEIL_G, floorMat: 'floor_scrubbed', wallMat: 'plaster_damp', wainscot: { height: 1.1, mat: 'wainscot_beadboard' },
  reverb: { size: 5.5, damping: 0.4, wet: 0.3 }, visible: ['G3', 'G3P', 'G1', 'U4'], atlas: 'LM_KITCHEN', ms: 'M2',
  note: 'Clear 5 x 4.6 m; with the boxed servants\' stair along the north wall the kitchen footprint is 5 x 5.5 m. No hide by design.',
});
room('U4', 'Servants\' back stair (shaft)', 'ground', 'interior', {
  ceiling: EU - EG + 2.4, floorMat: 'stair_rough', wallMat: 'wood_raw_plank', ceilingMat: 'wood_raw_plank', trimMat: 'wood_raw_plank',
  reverb: { size: 3.5, damping: 0.35, wet: 0.35 }, visible: ['U4', 'U4T', 'G3'], atlas: 'LM_KITCHEN', ms: 'M2',
  note: 'Enclosed, pitch-black shaft rising from the kitchen NE corner (winder) west to the upper landing U4T. Spans both floors (ceiling 5.9 above ground). Ada never enters.',
});
room('U1', 'Upper hallway & landing', 'upper', 'interior', {
  ceiling: CEIL_U, floorMat: 'floor_bare', wallMat: 'wallpaper_damask_green', floorHoles: [STAIRWELL],
  reverb: { size: 9, damping: 0.5, wet: 0.28 }, visible: ['U1', 'G1', 'U2', 'U3', 'EXT2'], atlas: 'LM_UPPER_HALL', ms: 'M1',
  note: 'Corridor 2.4 m clear beside the balustraded stairwell (x 0..1.2); full 3.6 m width on the south landing and the north stair-top landing.',
});
room('U2', 'Harlan\'s bedroom', 'upper', 'interior', {
  ceiling: CEIL_U, floorMat: 'floor_bare', wallMat: 'wallpaper_damask_ochre', floorHoles: [GRATE],
  reverb: { size: 5, damping: 0.6, wet: 0.22 }, visible: ['U2', 'U1', 'G2', 'EXT2'], atlas: 'LM_UPPER_ROOMS', ms: 'M1',
  note: 'M1 greybox, M2 final. Two doors to U1 (bedroom door + old dressing-room door) make the LOS loop. Floor register over the parlor.',
});
room('U3', 'Ada\'s sewing room', 'upper', 'interior', {
  ceiling: CEIL_U, floorMat: 'floor_bare', wallMat: 'wallpaper_damask_rose',
  reverb: { size: 4.5, damping: 0.7, wet: 0.2 }, visible: ['U3', 'U1', 'U4T', 'EXT2'], atlas: 'LM_UPPER_ROOMS', ms: 'M2',
  note: '5 x 4.5 m (design asked 3.5 x 4.5; widened so the dress can stand at a real east window).',
});
room('U4T', 'Servants\' stair top landing', 'upper', 'interior', {
  ceiling: CEIL_U, floorMat: 'stair_rough', wallMat: 'wood_raw_plank', ceilingMat: 'wood_raw_plank', trimMat: 'wood_raw_plank',
  reverb: { size: 2.4, damping: 0.4, wet: 0.3 }, visible: ['U4T', 'U4', 'U3'], atlas: 'LM_KITCHEN', ms: 'M2',
  note: 'Narrow boarded landing behind Ada\'s wardrobe; the flight drops away east from its north end.',
});
room('RC9', 'County Road 9 corridor (opening set)', 'exterior', 'set', {
  floorMat: 'asphalt_wet', wallMat: 'bark_wet', ceilingMat: 'none', trimMat: 'none',
  reverb: { size: 60, damping: 0.92, wet: 0.04 }, visible: ['RC9', 'EXT1', 'EXT2'], atlas: 'LM_EXTERIOR', playable: false, ms: 'M1',
  note: 'C0/C1 only: 1550 m of road east of the gate (scripts/layout/rc9.mjs), details_corridor.glb + props_road.glb, all runtime-lit (no atlas texels). No gameplay room lists it, so it is culled in play.',
});
room('CAR', 'Sedan interior set', 'car', 'set', {
  ceiling: 1.34, floorMat: 'car_interior_tan', wallMat: 'car_interior_tan', ceilingMat: 'car_interior_tan', trimMat: 'chrome_pitted',
  reverb: { size: 1.8, damping: 0.85, wet: 0.08 }, visible: ['CAR', 'EXT1'], atlas: 'LM_CAR', playable: false, ms: 'M1',
  note: 'Set apart from the house (x 100). Used by C1, C6 and the C7 re-trim (car_interior_maroon).',
});
const ROOM = Object.fromEntries(rooms.map((r) => [r.id, r]));

// ------------------------------------------------------------------ walls
const walls = [];
const matOf = (side) => (side === 'exterior' ? 'clapboard_peeling' : side === 'void' ? 'plaster_damp' : ROOM[side].wallMat);
/** Opening helper: centre given as a plan point on the wall line. */
function op(id, kind, at, width, height, sill, extra = {}) {
  return { id, kind, at, width, height, sill, ...extra };
}
const win = (state, skyPortal, sashes = 2, broken = false) => ({ state, sashes, broken, skyPortal });
function wall(id, floor, a, b, left, right, o = {}) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const openings = (o.openings ?? []).map((p) => {
    const offset = ((p.at[0] - a[0]) * dx + (p.at[1] - a[1]) * dy) / len;
    const { at, ...rest } = p;
    return { id: rest.id, kind: rest.kind, offset, width: rest.width, height: rest.height, sill: rest.sill, ...(rest.doorId ? { doorId: rest.doorId } : {}), ...(rest.window ? { window: rest.window } : {}) };
  });
  const base = o.base ?? (floor === 'upper' ? EU : EG);
  walls.push({
    id, floor, a, b, base, height: o.h ?? (floor === 'upper' ? CEIL_U : EU - EG), thickness: o.t ?? TI,
    left, right, leftMat: o.lm ?? matOf(left), rightMat: o.rm ?? matOf(right), openings,
    ...(o.facade ? { facadeDetail: o.facade } : {}),
    ...(o.clipToStair ? { clipToStair: o.clipToStair } : {}),
  });
}
const X_HALL_E = 3.675; // hall/parlor, U1/U2 wall centre line
const X_EXT_E = 8.9;
const Y_EXT_S = -0.15;
const Y_EXT_N = 11.8;
const X_EXT_W = -0.15;
const extG = { t: TE, h: EU - EG };
const extU = { t: TE, h: EAVE - EU };

// Ground floor exterior (counter-clockwise: left = inside)
wall('WG_S1', 'ground', [-0.3, Y_EXT_S], [X_HALL_E, Y_EXT_S], 'G1', 'exterior', { ...extG, facade: 'hero', openings: [
  op('O_FRONT', 'door', [1.8, Y_EXT_S], 1.0, 2.75, 0, { doorId: 'D_FRONT' }),
] });
wall('WG_S2', 'ground', [X_HALL_E, Y_EXT_S], [9.05, Y_EXT_S], 'G2', 'exterior', { ...extG, facade: 'hero', openings: [
  op('O_G2_S1', 'window', [5.0, Y_EXT_S], 0.9, 1.7, 0.75, { window: { ...win('nailed_shuttered', false), lightLeak: true } }),
  op('O_G2_S2', 'window', [7.5, Y_EXT_S], 0.9, 1.7, 0.75, { window: win('nailed_shuttered', false) }),
] });
wall('WG_E1', 'ground', [X_EXT_E, -0.3], [X_EXT_E, 6.075], 'G2', 'exterior', { ...extG, facade: 'fog' });
wall('WG_E2', 'ground', [X_EXT_E, 6.075], [X_EXT_E, 10.8], 'G3', 'exterior', { ...extG, facade: 'fog', openings: [
  op('O_G3_E', 'window', [X_EXT_E, 8.4], 0.8, 1.5, 0.9, { window: win('nailed_shuttered', false) }),
] });
wall('WG_E3', 'ground', [X_EXT_E, 10.8], [X_EXT_E, Y_EXT_N], 'U4', 'exterior', { ...extG, facade: 'fog' });
wall('WG_N2', 'ground', [9.05, Y_EXT_N], [5.4, Y_EXT_N], 'U4', 'exterior', { ...extG, facade: 'fog' });
wall('WG_N1', 'ground', [5.4, Y_EXT_N], [-0.3, Y_EXT_N], 'void', 'exterior', { ...extG, facade: 'fog' });
wall('WG_W4', 'ground', [X_EXT_W, 11.95], [X_EXT_W, 10.8], 'void', 'exterior', { ...extG, facade: 'fog' });
wall('WG_W3', 'ground', [X_EXT_W, 10.8], [X_EXT_W, 9.075], 'G3P', 'exterior', { ...extG, facade: 'fog' });
wall('WG_W2', 'ground', [X_EXT_W, 9.075], [X_EXT_W, 5.4], 'CLOSET', 'exterior', { ...extG, facade: 'fog' });
wall('WG_W1', 'ground', [X_EXT_W, 5.4], [X_EXT_W, -0.3], 'G1', 'exterior', { ...extG, facade: 'fog' });

// Ground floor interior
wall('WG_G1G2', 'ground', [X_HALL_E, Y_EXT_S], [X_HALL_E, 6.075], 'G1', 'G2', { openings: [
  op('O_PARLOR', 'door', [X_HALL_E, 1.5], 0.9, 2.15, 0, { doorId: 'D_PARLOR' }),
  op('O_ROPE_PASS', 'passthrough', [X_HALL_E, 1.5], 0.3, 0.14, 2.9),
] });
wall('WG_G1G3', 'ground', [X_HALL_E, 6.075], [X_HALL_E, 9.075], 'G1', 'G3');
wall('WG_PG3', 'ground', [X_HALL_E, 9.075], [X_HALL_E, 10.8], 'G3P', 'G3', { openings: [
  op('O_KITCHEN_ARCH', 'arch', [X_HALL_E, 9.95], 0.9, 2.1, 0),
] });
wall('WG_G2G3', 'ground', [X_HALL_E, 6.075], [X_EXT_E, 6.075], 'G3', 'G2', { rm: 'wall_tally' });
wall('WG_HN_W', 'ground', [X_EXT_W, 9.075], [1.1, 9.075], 'G3P', 'CLOSET', { openings: [
  op('O_CLOSET', 'door', [0.55, 9.075], 0.6, 1.9, 0, { doorId: 'D_CLOSET' }),
] });
wall('WG_HN_E', 'ground', [1.1, 9.075], [X_HALL_E, 9.075], 'G3P', 'G1', { openings: [
  op('O_PASSAGE', 'door', [2.5, 9.075], 0.85, 2.1, 0, { doorId: 'D_PASSAGE' }),
] });
wall('WG_CLOSET_E', 'ground', [1.1, 9.0], [1.1, 5.36], 'G1', 'CLOSET', { t: 0.08, h: CEIL_G, clipToStair: 'ST_MAIN', lm: 'stair_treads', rm: 'wood_raw_plank' });
wall('WG_CLOSET_S', 'ground', [0, 5.36], [1.14, 5.36], 'CLOSET', 'G1', { t: 0.08, h: 1.3, clipToStair: 'ST_MAIN', lm: 'wood_raw_plank', rm: 'stair_treads' });
wall('WG_PASS_N', 'ground', [X_EXT_W, 10.8], [X_HALL_E, 10.8], 'void', 'G3P');
wall('WG_LARDER', 'ground', [X_HALL_E, 10.8], [5.4, 10.8], 'void', 'G3', { t: 0.1 });
wall('WG_SHAFT_S', 'ground', [5.4, 10.8], [X_EXT_E, 10.8], 'U4', 'G3', { t: 0.1, h: EU - EG + 2.4, lm: 'wood_raw_plank', rm: 'wood_raw_plank', openings: [
  op('O_BACKSTAIR', 'door', [8.35, 10.8], 0.7, 1.95, 0, { doorId: 'D_BACKSTAIR' }),
] });
wall('WG_SHAFT_W', 'ground', [5.4, 10.8], [5.4, Y_EXT_N], 'void', 'U4', { t: 0.1, lm: 'plaster_damp', rm: 'wood_raw_plank' });

// Upper floor exterior
wall('WU_S1', 'upper', [-0.3, Y_EXT_S], [X_HALL_E, Y_EXT_S], 'U1', 'exterior', { ...extU, facade: 'hero', openings: [
  op('O_U1_S', 'window', [1.8, Y_EXT_S], 0.9, 1.6, 0.8, { window: win('nailed', true) }),
] });
wall('WU_S2', 'upper', [X_HALL_E, Y_EXT_S], [9.05, Y_EXT_S], 'U2', 'exterior', { ...extU, facade: 'hero', openings: [
  op('O_U2_S', 'window', [6.2, Y_EXT_S], 0.9, 1.6, 0.8, { window: win('nailed_shuttered', false) }),
] });
wall('WU_E1', 'upper', [X_EXT_E, -0.3], [X_EXT_E, 4.575], 'U2', 'exterior', { ...extU, facade: 'fog', openings: [
  op('O_U2_E', 'window', [X_EXT_E, 1.3], 0.8, 1.5, 0.85, { window: win('nailed', true) }),
] });
wall('WU_E2', 'upper', [X_EXT_E, 4.575], [X_EXT_E, 9.225], 'U3', 'exterior', { ...extU, facade: 'fog', openings: [
  op('O_U3_E', 'window', [X_EXT_E, 7.2], 0.8, 1.5, 0.85, { window: win('nailed', true) }),
] });
wall('WU_E3', 'upper', [X_EXT_E, 9.225], [X_EXT_E, 10.8], 'void', 'exterior', { ...extU, facade: 'fog' });
wall('WU_E4', 'upper', [X_EXT_E, 10.8], [X_EXT_E, Y_EXT_N], 'U4', 'exterior', { ...extU, facade: 'fog' });
wall('WU_N3', 'upper', [9.05, Y_EXT_N], [5.525, Y_EXT_N], 'U4', 'exterior', { ...extU, facade: 'fog' });
wall('WU_N2', 'upper', [5.525, Y_EXT_N], [4.525, Y_EXT_N], 'U4T', 'exterior', { ...extU, facade: 'fog' });
wall('WU_N1', 'upper', [4.525, Y_EXT_N], [-0.3, Y_EXT_N], 'void', 'exterior', { ...extU, facade: 'fog' });
wall('WU_W2', 'upper', [X_EXT_W, 11.95], [X_EXT_W, 9.075], 'void', 'exterior', { ...extU, facade: 'fog' });
wall('WU_W1', 'upper', [X_EXT_W, 9.075], [X_EXT_W, -0.3], 'U1', 'exterior', { ...extU, facade: 'fog' });

// Upper floor interior
wall('WU_U1U2', 'upper', [X_HALL_E, Y_EXT_S], [X_HALL_E, 4.575], 'U1', 'U2', { openings: [
  op('O_DRESSING', 'door', [X_HALL_E, 0.8], 0.85, 2.05, 0, { doorId: 'D_DRESSING' }),
  op('O_HARLAN', 'door', [X_HALL_E, 3.0], 0.85, 2.05, 0, { doorId: 'D_HARLAN' }),
  op('O_WIRE_PASS', 'passthrough', [X_HALL_E, 4.4], 0.06, 0.06, 2.75),
] });
wall('WU_U1U3', 'upper', [X_HALL_E, 4.575], [X_HALL_E, 9.225], 'U1', 'U3', { openings: [
  op('O_ADA', 'door', [X_HALL_E, 8.2], 0.85, 2.05, 0, { doorId: 'D_ADA' }),
] });
wall('WU_U1N', 'upper', [X_EXT_W, 9.075], [X_HALL_E, 9.075], 'void', 'U1');
wall('WU_U2U3', 'upper', [X_HALL_E, 4.575], [X_EXT_E, 4.575], 'U3', 'U2');
wall('WU_U3N_W', 'upper', [X_HALL_E, 9.225], [4.525, 9.225], 'void', 'U3');
wall('WU_U3N_M', 'upper', [4.525, 9.225], [5.525, 9.225], 'U4T', 'U3', { openings: [
  op('O_WBACK', 'door', [5.0, 9.225], 0.7, 1.8, 0, { doorId: 'D_WARDROBE_BACK' }),
] });
wall('WU_U3N_E', 'upper', [5.525, 9.225], [X_EXT_E, 9.225], 'void', 'U3');
wall('WU_U4T_W', 'upper', [4.525, Y_EXT_N], [4.525, 9.225], 'U4T', 'void', { lm: 'wood_raw_plank' });
wall('WU_U4T_E', 'upper', [5.525, 9.225], [5.525, 10.8], 'U4T', 'void', { lm: 'wood_raw_plank' });

// ------------------------------------------------------------------ doors
const doors = [
  { id: 'D_FRONT', openingId: 'O_FRONT', style: 'front', hinge: 'right', swingInto: 'G1', initial: 'bolted', interactive: true, mat: 'door_front',
    note: 'Opened only by the rope (B02 pull, B11 finale). Knock / bell knob / rattle are interactions on the outside/inside faces.' },
  { id: 'D_PARLOR', openingId: 'O_PARLOR', style: 'panel', hinge: 'left', swingInto: 'G2', initial: 'ajar', interactive: false, mat: 'door_painted',
    note: 'Ajar and candlelit in B03; locked by Harlan in C2; opened by him for her at B05 +10-20 s (C2-ESCAPE K6); cracked by Harlan in C5.' },
  { id: 'D_PASSAGE', openingId: 'O_PASSAGE', style: 'passage_bolted', hinge: 'left', swingInto: 'G3P', initial: 'bolted', unlockFlag: 'passage_unbolted', interactive: true, mat: 'door_painted',
    note: 'Bolt on the passage side: dead end in B04, slid from the kitchen side in B10.' },
  { id: 'D_CLOSET', openingId: 'O_CLOSET', style: 'closet', hinge: 'right', swingInto: 'G3P', initial: 'closed', interactive: true, mat: 'wood_raw_plank' },
  { id: 'D_BACKSTAIR', openingId: 'O_BACKSTAIR', style: 'panel', hinge: 'left', swingInto: 'G3', initial: 'closed', interactive: true, mat: 'door_painted' },
  { id: 'D_ADA', openingId: 'O_ADA', style: 'boarded', hinge: 'right', swingInto: 'U3', initial: 'boarded', unlockFlag: 'ada_boards_pried', interactive: true, mat: 'door_painted', boardMat: 'wood_raw_plank',
    note: '3 planks pried one at a time (flags ada_board_1..3); opens when all 3 are off.' },
  { id: 'D_HARLAN', openingId: 'O_HARLAN', style: 'panel', hinge: 'left', swingInto: 'U2', initial: 'ajar', interactive: true, mat: 'door_painted' },
  { id: 'D_DRESSING', openingId: 'O_DRESSING', style: 'panel', hinge: 'right', swingInto: 'U2', initial: 'closed', interactive: true, mat: 'door_painted' },
  { id: 'D_WARDROBE_BACK', openingId: 'O_WBACK', style: 'wardrobe_back', hinge: 'left', swingInto: 'U4T', initial: 'closed', unlockFlag: 'dress_visit_done', interactive: true, mat: 'wood_furniture_dark',
    note: 'Loose back boards of Ada\'s wardrobe; give after the C4 dress visit.' },
];

// ------------------------------------------------------------------ stairs
const stairs = [
  { id: 'ST_MAIN', from: 'ground', to: 'upper', start: [0.55, 3.6], direction: 'N', width: 1.1, risers: MAIN_RISERS, riserHeight: MAIN_RISER_H,
    treadDepth: MAIN_TREAD, balustrade: 'right', enclosed: false, creakySteps: [5, 12], rooms: ['G1', 'U1'] },
  { id: 'ST_BACK', from: 'ground', to: 'upper', start: [8.35, 10.85], direction: 'N', width: 0.8, risers: BACK_RISERS, riserHeight: BACK_RISER_H,
    treadDepth: BACK_TREAD, winder: { atStep: 1, turn: 'left' }, balustrade: 'none', enclosed: true, creakySteps: [7, 11], rooms: ['U4', 'U4T'] },
];

// ------------------------------------------------------------------ roof
const roof = {
  kind: 'gable', ridgeAxis: 'y', eaveZ: EAVE, ridgeZ: EAVE + 3.6, overhang: 0.45, mat: 'shingles_wet',
  chimney: { pos: [9.35, 3.0], size: [0.8, 1.2], top: EAVE + 2.6, mat: 'brick_old' },
};

// ------------------------------------------------------------------ props
const props = [];
/** p(id, type, room, [x,y,z], yaw, {params, lighting, collider, interaction, ms}) — z is ABSOLUTE plan z. */
function p(id, type, room, pos, yaw, o = {}) {
  props.push({
    id, type, room, pos, yaw, ...(o.params ? { params: o.params } : {}),
    lighting: o.lighting ?? 'static', collider: o.collider ?? 'box', ...(o.interaction ? { interaction: o.interaction } : {}), milestone: o.ms ?? 'M1',
  });
}
const path = (pts) => pts.map((q) => q.map(r3).join(',')).join(';');
const zG = EG, zU = EU;

// EXT1 — road & ROOMS sign
p('P_SIGN', 'sign_post', 'EXT1', [-1.8, -28.6, 0], faceYaw(1, -1), { params: { text: "STROUD'S GAS & FEED", gasPaintedOut: true, board: 'ROOMS', vacancyPlate: true, mat: 'wood_weathered_post', plateMat: 'paint_steel_sign' }, collider: 'mesh' });
p('P_SIGN_LANTERN', 'sign_lantern', 'EXT1', [-1.8, -28.45, 2.05], faceYaw(1, -1), { params: { box: 'tin', mat: 'zinc_galvanized', lit: true }, lighting: 'dynamic', collider: 'none' });
p('P_VACANCY_PLATE', 'vacancy_plate', 'EXT1', [-1.8, -28.62, 1.75], faceYaw(1, -1), { params: { text: 'VACANCY', mat: 'paint_steel_sign', swing: true }, lighting: 'dynamic', collider: 'none' });
p('P_MAILBOX', 'mailbox', 'EXT1', [4.4, -28.7, 0], FACE.S, { params: { name: 'STROUD', mat: 'rust' } });
p('P_FENCE_W', 'fence_run', 'EXT1', [-9.8, -28.25, 0], 0, { params: { length: 20.4, postSpacing: 2.4, style: 'post_and_wire' }, collider: 'box' });
p('P_FENCE_E', 'fence_run', 'EXT1', [11.6, -28.25, 0], 0, { params: { length: 16.8, postSpacing: 2.4, style: 'post_and_wire' } });
p('P_GATE', 'farm_gate', 'EXT1', [0.5, -28.25, 0], 0.35, { params: { width: 2.6, state: 'open_sagging', mat: 'rust' } });
for (const [i, x] of [-14, -6, 8, 16].entries()) p(`P_REFLECTOR_${i + 1}`, 'reflector_post', 'EXT1', [x, -29.0, 0], FACE.S, { collider: 'none' });
p('P_NEXT_SERVICES', 'road_card', 'EXT1', [18.6, -28.9, 0], FACE.E, { params: { text: 'CARVEL 48' }, collider: 'none' });
p('P_CAR_GATE', 'sedan', 'EXT1', [2.8, -30.2, 0], faceYaw(-1, 0), { params: { plate: 'RVX-318', paint: 'car_paint_sedan', interior: 'car_interior_tan', state: 'dead_at_gate' }, lighting: 'dynamic', collider: 'box', interaction: 'car', ms: 'M1' });
p('P_UTILITY_POLE', 'utility_pole', 'EXT1', [-12.5, -37.4, 0], FACE.N, { params: { wiresCut: true, mat: 'bark_wet' } });

// RC9 — County Road 9 opening set (docs/C1-OPENING.md §2, §6.3): positions from the shared centreline (rc9.mjs)
{
  const at = (s, n, z = 0) => rcPoint(s, n, z).map(r3);
  const rd = { lighting: 'dynamic', collider: 'none', ms: 'M1' };
  p('P_RC9_NEXT_SERVICES', 'road_card', 'RC9', at(255, 6.2), rcFaceOncoming(255, 6.2, 0.2), { ...rd, params: { text: 'NEXT SERVICES 48 MI', hero: true, w: 2.4, h: 1.2 } });
  p('P_RC9_CR9_A', 'county_shield', 'RC9', at(510, 6.0), rcFaceOncoming(510, 6.0, 0.2), { ...rd, params: { text: 'COUNTY|9' } });
  p('P_RC9_BILLBOARD', 'billboard', 'RC9', at(930, -15), 2.11, { ...rd, params: { text: "58 · CARVEL EXIT 4 · EAT · SLEEP · GAS|STROUD'S · ROOMS ½ MI" } });
  p('P_RC9_DINER', 'diner', 'RC9', at(700, 24), rcFaceRoad(700, 24), { ...rd });
  p('P_RC9_EAT', 'eat_sign', 'RC9', at(688, 11.5), rcFaceOncoming(688, 11.5, 0.0), { ...rd });
  p('P_RC9_TRUCK', 'logging_truck', 'RC9', at(1400, -1.75), rcFrame(1400)[2] + PI / 2, { ...rd, params: { note: 'parked at its track start; the C1 S5 track moves it (§7)' } });
  for (const [i, [s, n, yawOff, headYaw]] of [[198, 12.5, 0.15, 0.0], [205, 13.5, -0.25, 0.35], [212, 13.0, 0.9, -0.7]].entries())
    p(`P_RC9_DEER_${i + 1}`, 'deer', 'RC9', at(s, n), rcFaceRoad(s, n) + yawOff, { ...rd, params: { headYaw, pose: i === 2 ? 'mid_turn' : 'alert' } });
  p('P_RC9_CR9_B', 'county_shield', 'RC9', at(1100, -6.0), rcFrame(1100)[2] + PI / 2 + 0.2, { ...rd, params: { text: 'COUNTY|9' } });
}

// EXT2 — drive, porch, field
p('P_PORCH', 'porch', 'EXT2', [4.375, -1.55, 0], 0, { params: { width: 9, depth: 2.5, deckZ: EG - 0.02, steps: 3, stepsCentreX: 1.8, stepsWidth: 1.6, posts: 5, roof: true, roofZ: 3.9, deckMat: 'porch_boards_wet', mat: 'trim_chipped' }, collider: 'mesh' });
p('P_FOUNDATION', 'foundation_skirt', 'EXT2', [4.375, -0.25, 0], 0, { params: { width: 9.35, height: EG, mat: 'stone_foundation' }, collider: 'none' });
p('P_KNOCKER', 'door_knocker', 'EXT2', [1.8, -0.36, EG + 1.45], FACE.S, { params: { mat: 'cast_iron' }, collider: 'none', interaction: 'knock' });
p('P_BELL_KNOB', 'bell_pull_knob', 'EXT2', [2.55, -0.34, EG + 1.3], FACE.S, { params: { mat: 'brass_tarnished' }, collider: 'none', interaction: 'ring_bell' });
p('P_PUMP', 'gas_pump', 'EXT2', [4.9, -14.0, 0], faceYaw(-1, 0), { params: { brand: "STROUD'S GAS & FEED", priceDial: '1976', nozzle: 'dry', mat: 'rust', globe: 'broken' }, collider: 'box' });
p('P_TREE_1', 'dead_tree', 'EXT2', [-6.5, -12.0, 0], 0.4, { params: { height: 9, mat: 'bark_wet' }, collider: 'mesh' });
p('P_TREE_2', 'dead_tree', 'EXT2', [11.5, 3.0, 0], 2.1, { params: { height: 11, mat: 'bark_wet' }, collider: 'mesh' });
p('P_TREE_3', 'dead_tree', 'EXT2', [-7.5, 7.0, 0], 4.0, { params: { height: 8, mat: 'bark_wet' }, collider: 'mesh', ms: 'M2' });
p('P_RAIN_BARREL', 'rain_barrel', 'EXT2', [9.35, -0.6, 0], 0, { params: { mat: 'rust', overflowing: true } });
// the wreck row: 9 wrecks, 5 instanced variants, receding east into mist
const wrecks = [[17, 0.3], [21, 2.6], [25.5, 1.0], [30, 3.6], [34.5, 2.1], [39, 4.7], [44, 3.2], [49, 5.8], [54.5, 4.4]];
wrecks.forEach(([x, y], i) => p(`P_WRECK_${i + 1}`, 'wreck_sedan', 'EXT2', [x, y, 0], faceYaw(0, 1) + ((i * 0.37) % 0.6) - 0.3, { params: { variant: (i % 5) + 1, mat: 'car_paint_wreck', sunkInWeeds: 0.2 + (i % 3) * 0.1 }, collider: 'box', ms: 'M2' }));
p('P_CAR_ROW', 'sedan', 'EXT2', [13.4, -1.6, 0], faceYaw(0, 1) - 0.35, { params: { plate: 'RVX-318', paint: 'car_paint_sedan', interior: 'car_interior_tan', state: 'pushed_into_row' }, lighting: 'dynamic', collider: 'box', interaction: 'car', ms: 'M2' });

// G1 — hall
p('P_HALL_TABLE', 'hall_table', 'G1', [3.33, 4.2, zG], FACE.W, { params: { length: 1.0, depth: 0.42, height: 0.8, mat: 'wood_furniture_dark' } });
p('P_GUEST_BOOK', 'guest_book', 'G1', [3.33, 4.1, zG + 0.8], FACE.W, { params: { state: 'tonight_blank', lines: 11, mat: 'paper_aged' }, lighting: 'dynamic', collider: 'none', interaction: 'read_guest_book' });
p('P_CANDLE_HALL', 'candle', 'G1', [3.4, 4.5, zG + 0.8], 0, { params: { holder: 'chamberstick', height: 0.18, mat: 'wax_candle', leansTowardAda: true }, lighting: 'dynamic', collider: 'none' });
p('P_MIRROR_HALL', 'mirror_crepe', 'G1', [3.5, 7.4, zG], FACE.W, { params: { style: 'pier', height: 2.1, mat: 'crepe_black', frameMat: 'wood_furniture_dark' }, collider: 'box' });
p('P_PORTRAIT', 'photo_frame', 'G1', [3.58, 2.9, zG + 1.45], FACE.W, { params: { photo: 'wedding_knifed', size: 'large', mat: 'photo_print' }, collider: 'none', interaction: 'examine_portrait' });
p('P_BOLT_BOX', 'bolt_box', 'G1', [1.8, 0.1, zG + 2.82], FACE.N, { params: { mat: 'cast_iron', plateMat: 'brass_tarnished' }, lighting: 'dynamic', collider: 'none', interaction: 'rattle_front_door' });
const PULLEYS = [[2.35, 0.1, zG + 3.1], [3.5, 0.1, zG + 3.1], [3.5, 1.5, zG + 3.1]];
PULLEYS.forEach((q, i) => p(`P_PULLEY_${i + 1}`, 'rope_pulley', 'G1', q, i === 0 ? 0 : FACE.W, { params: { mat: 'cast_iron' }, lighting: 'dynamic', collider: 'none' }));
p('P_DOOR_ROPE', 'door_rope', 'G1', [1.8, 0.1, zG + 3.0], 0, {
  params: { path: path([[1.8, 0.1, zG + 3.0], ...PULLEYS, [X_HALL_E, 1.5, zG + 2.97], [3.85, 1.9, zG + 1.6]]), diameter: 0.018, mat: 'rope_hemp', note: 'bolt -> 3 cornice pulleys -> through O_ROPE_PASS -> cleat P_CLEAT' },
  lighting: 'dynamic', collider: 'none',
});
p('P_COUNTERWEIGHT', 'door_counterweight', 'G1', [0.5, 0.15, zG + 2.0], FACE.N, { params: { mat: 'cast_iron', cord: 'rope_hemp' }, lighting: 'dynamic', collider: 'none' });
p('P_BELL_WIRE_FRONT', 'bell_wire', 'G1', [2.55, 0.05, zG + 1.3], 0, {
  params: { path: path([[2.55, -0.34, zG + 1.3], [2.55, 0.05, zG + 1.3], [2.55, 0.05, zG + 3.12], [3.52, 0.05, zG + 3.12], [3.52, 1.45, zG + 3.12], [X_HALL_E, 1.45, zG + 2.95], [3.85, 1.45, zG + 2.8]]), mat: 'cast_iron', from: 'P_BELL_KNOB', to: 'P_SPRING_BELL' },
  lighting: 'dynamic', collider: 'none',
});
p('P_BELL_CRANK_1', 'bell_crank', 'G1', [2.55, 0.05, zG + 3.12], 0, { params: { mat: 'brass_tarnished' }, collider: 'none' });
p('P_BELL_CRANK_2', 'bell_crank', 'G1', [3.52, 0.05, zG + 3.12], 0, { params: { mat: 'brass_tarnished' }, collider: 'none' });
p('P_BELL_WIRE_UPPER', 'bell_wire', 'U1', [3.52, 4.4, zU + 2.78], 0, {
  params: { path: path([[6.1, 4.46, zU + 2.1], [6.1, 4.46, zU + 2.78], [X_HALL_E, 4.4, zU + 2.78], [3.52, 4.4, zU + 2.78], [3.52, 8.95, zU + 2.78], [3.52, 8.95, zG + 3.12], [3.52, 1.55, zG + 3.12], [X_HALL_E, 1.55, zG + 2.95], [3.85, 1.45, zG + 2.8]]), mat: 'cast_iron', from: 'P_BELL_PULL', to: 'P_SPRING_BELL', note: 'U2 north cornice -> O_WIRE_PASS -> U1 east cornice to the stair top -> drops through the floor in the NE corner (drilled) -> hall east cornice -> O_ROPE_PASS' },
  lighting: 'dynamic', collider: 'none', ms: 'M2',
});
p('P_BELL_CRANK_3', 'bell_crank', 'U1', [3.52, 8.95, zU + 2.78], 0, { params: { mat: 'brass_tarnished' }, collider: 'none', ms: 'M2' });
p('P_BELL_CRANK_4', 'bell_crank', 'G1', [3.52, 8.95, zG + 3.12], 0, { params: { mat: 'brass_tarnished' }, collider: 'none', ms: 'M2' });
p('P_HALL_RUNNER', 'runner_rug', 'G1', [2.35, 2.2, zG], FACE.E, { params: { length: 3.6, width: 0.8, mat: 'runner_rug' }, collider: 'none' });

// G2 — parlor (dressed for the tableau)
p('P_SAWBUCK', 'sawbuck_table', 'G2', [5.6, 3.3, zG], FACE.E, { params: { length: 2.2, width: 0.6, height: 0.8, mat: 'wood_raw_plank' }, collider: 'box' });
p('P_RUBBER_SHEET', 'rubber_sheet', 'G2', [5.6, 3.3, zG + 0.8], FACE.E, { params: { mat: 'rubber_black', spatter: true }, lighting: 'dynamic', collider: 'none' });
p('P_BUCKET', 'zinc_bucket', 'G2', [6.25, 2.5, zG], 0.6, { params: { mat: 'zinc_galvanized', contents: 'water_dark' }, collider: 'box' });
p('P_ROCKER', 'rocking_chair', 'G2', [7.4, 4.95, zG], faceYaw(3.6 - 7.4, 1.5 - 4.95), { params: { mat: 'wood_furniture_dark', rocks: true }, lighting: 'dynamic', collider: 'box' });
p('P_MANTEL', 'fireplace_mantel', 'G2', [8.55, 3.0, zG], FACE.W, { params: { width: 1.5, shelfZ: 1.2, mat: 'wood_furniture_dark', hearthMat: 'brick_old', cold: true }, collider: 'box' });
p('P_MIRROR_MANTEL', 'mirror_crepe', 'G2', [8.7, 3.0, zG + 1.25], FACE.W, { params: { style: 'overmantel', mat: 'crepe_black', frameMat: 'wood_furniture_dark' }, collider: 'none' });
p('P_CANDLE_MANTEL', 'candle', 'G2', [8.6, 3.4, zG + 1.2], 0, { params: { holder: 'brass_stick', height: 0.22, mat: 'wax_candle', leansTowardAda: true }, lighting: 'dynamic', collider: 'none' });
p('P_CANDLE_TABLE', 'candle', 'G2', [5.6, 2.3, zG + 0.82], 0, { params: { holder: 'saucer', height: 0.14, mat: 'wax_candle', castsShadowInCutscenes: true }, lighting: 'dynamic', collider: 'none' });
p('P_CANDLE_SILL', 'candle', 'G2', [5.0, 0.18, zG + 0.78], 0, { params: { holder: 'saucer', height: 0.1, mat: 'wax_candle' }, lighting: 'dynamic', collider: 'none' });
// C2-ESCAPE K1: the stool moves to the NW of the sawbuck and carries the parlor lamp (the C2 hard side-key, flame
// 0.75 m above the floor); the whetstone goes to the floor beside it
p('P_STOOL', 'stool', 'G2', [4.6, 4.25, zG], 0.3, { params: { mat: 'wood_raw_plank', height: 0.45 }, note: 'C2-ESCAPE A8: seat top z 1.05 (stool generator height 0.45; flame anchor of P_LAMP_PARLOR wick high = base + 0.309 = z 1.359).' });
p('P_WHETSTONE', 'whetstone', 'G2', [4.85, 4.5, zG], 0.3, { params: { mat: 'stone_foundation' }, lighting: 'dynamic', collider: 'none' });
p('P_LAMP_PARLOR', 'kerosene_lamp', 'G2', [4.6, 4.25, zG + 0.45], 0.4, { params: { wick: 'high', mat: 'glass_grimy', burnerMat: 'brass_tarnished' }, lighting: 'dynamic', collider: 'none',
  note: 'C2-ESCAPE K1: on the stool seat (z 1.05); flame anchor (4.60, 4.25, 1.35) = L_LAMP_PARLOR.' });
p('P_SPRING_BELL', 'spring_bell', 'G2', [3.85, 1.45, zG + 2.8], FACE.E, { params: { mat: 'brass_tarnished', ringsFor: 'P_BELL_KNOB,P_BELL_PULL' }, lighting: 'dynamic', collider: 'none' });
p('P_CLEAT', 'rope_cleat', 'G2', [3.8, 1.9, zG + 1.6], FACE.E, { params: { mat: 'cast_iron' }, collider: 'none' });
p('P_CLEAVER', 'hog_cleaver', 'G2', [5.95, 3.95, zG + 0.83], 1.2, { params: { mat: 'steel_cleaver', handleMat: 'wood_furniture_dark', state: 'bitten' }, lighting: 'dynamic', collider: 'none',
  note: 'C2-ESCAPE K6: state bitten = after C2 the blade is left bitten in the sawbuck edge at the neck point (5.31, 3.25, 1.40); before C2 it lies here.' });
p('P_PARLOR_RUG', 'rag_rug', 'G2', [7.2, 4.4, zG], 0.2, { params: { mat: 'rag_rug', w: 1.6, d: 1.1 }, collider: 'none' });

// G3 — kitchen
p('P_HATCH', 'cistern_hatch', 'G3', [5.5, 8.2, zG], 0.08, { params: { size: 0.9, padlock: 'outside', splintered: 'upward', seep: true, mat: 'wood_raw_plank', hardwareMat: 'cast_iron' }, collider: 'none', interaction: 'listen_hatch', ms: 'M2' });
p('P_STOVE', 'iron_stove', 'G3', [7.4, 6.55, zG], FACE.N, { params: { mat: 'cast_iron', doorMat: 'enamel_stove', cold: true, pipeTo: 'chimney' }, collider: 'box', ms: 'M2' });
p('P_PUMP_SINK', 'pump_sink', 'G3', [8.4, 8.4, zG], FACE.W, { params: { mat: 'enamel_chipped', pumpMat: 'cast_iron', splashbackMat: 'tile_kitchen', drips: true }, collider: 'box', ms: 'M2' });
// Ruling (d) 2026-10-09 (props lane E, capsule clearance map scratch/pe/lane.log): at x 7.2 the table's corner left
// 0.31 m to the pump sink — the back-stair route into the kitchen was closed. Table, its candle + light and chair 1 move
// 0.6 m west: table east edge 7.25 → 0.875 m clear to the sink front (8.125).
p('P_KITCHEN_TABLE', 'kitchen_table', 'G3', [6.6, 9.5, zG], 0, { params: { length: 1.3, width: 0.8, mat: 'wood_raw_plank' }, collider: 'box', ms: 'M2' });
p('P_KITCHEN_CHAIR_1', 'kitchen_chair', 'G3', [5.9, 9.55, zG], FACE.E, { params: { mat: 'wood_furniture_dark' }, ms: 'M2' });
// Ruling (d) 2026-10-09: the tipped chair lies north of the table (back toward the west, legs toward the door), out of
// the back-stair lane (measured capsule-blocked span ≈ origin −1.15 … +0.45 m in x).
p('P_KITCHEN_CHAIR_2', 'kitchen_chair', 'G3', [6.95, 10.3, zG], FACE.E + 0.12, { params: { mat: 'wood_furniture_dark', tipped: true }, ms: 'M2' });
p('P_CANDLE_KITCHEN', 'candle', 'G3', [6.75, 9.6, zG + 0.78], 0, { params: { holder: 'bottle', height: 0.06, mat: 'wax_candle', guttering: true }, lighting: 'dynamic', collider: 'none', ms: 'M2' });
p('P_CAN_SHELF', 'can_shelf', 'G3', [4.0, 7.62, zG], FACE.E, { params: { length: 2.5, mat: 'wood_raw_plank' }, collider: 'box', ms: 'M2' });
const PLATES = ['DRIFTER', 'OKB 441', 'D. PRUITT', '7L 2290', 'HYX 904', 'CARVEL 12', '3M-7718', 'TNR 506', 'KJ 3395', 'WRD 118', 'LBE 260', 'RVX-318'];
PLATES.forEach((plate, i) => p(`P_JERRY_${String(i + 1).padStart(2, '0')}`, 'jerry_can', 'G3', [3.98, 6.5 + i * 0.205, zG], FACE.E, {
  params: { plate, full: i < 11, chalk: true, mat: 'paint_steel_can' }, lighting: 'dynamic', collider: 'box', ms: 'M2',
  interaction: i === 11 ? 'read_can_plate' : i === 9 ? 'take_can' : undefined,
}));
// Round E: the bricked doorway moved 0.4 m south (y 9.15–10.05, clear of the sink ≤ 8.95) so it no longer crowds the
// back-stair door mouth visually (it has no collider; the 0.62 m door-mouth pinch is the open leaf vs the east jamb,
// by design — blender/house/collision.py JAMB_CLEAR).
p('P_BRICKED_DOOR', 'bricked_doorway', 'G3', [8.72, 9.6, zG], FACE.W, { params: { width: 0.9, height: 2.1, mat: 'brick_infill', frameMat: 'door_painted' }, collider: 'none', ms: 'M2' });
p('P_CEILING_DRIP', 'fx_drip_emitter', 'G3', [6.4, 7.6, zG + CEIL_G], 0, { params: { mode: 'ceiling_beads', followsAdaOnFloorAbove: true, area: '4.2,6.4,8.6,9.0' }, lighting: 'dynamic', collider: 'none', ms: 'M2' });

// CLOSET + back passage
p('P_CLOSET_INTERIOR', 'closet_interior', 'CLOSET', [0.53, 7.4, zG], FACE.N, { params: { contents: 'brooms,crates,coat_hooks', mat: 'wood_raw_plank' }, collider: 'mesh', ms: 'M2' });
p('P_TREAD_DRIP', 'fx_drip_emitter', 'CLOSET', [0.55, 7.55, zG + 2.2], 0, { params: { mode: 'through_treads', stair: 'ST_MAIN' }, lighting: 'dynamic', collider: 'none', ms: 'M2' });
p('P_PASSAGE_HOOKS', 'coat_hooks', 'G3P', [1.6, 10.72, zG + 1.6], FACE.S, { params: { items: 'oilskin,lantern_hook' }, collider: 'none', ms: 'M2' });

// U1 — upper hallway
p('P_ARMOIRE', 'slatted_cabinet', 'U1', [3.28, 4.2, zU], FACE.W, { params: { variant: 'armoire', width: 1.1, depth: 0.6, height: 2.1, ajar: true, mat: 'wood_furniture_dark' }, collider: 'mesh', interaction: 'hide' });
p('P_RUNNER_U1', 'runner_rug', 'U1', [2.4, 4.5, zU], FACE.E, { params: { length: 8.0, width: 0.9, mat: 'runner_rug' }, collider: 'none' });
p('P_GALLERY_RAIL_E', 'balustrade_run', 'U1', [1.2, 6.2, zU], FACE.E, { params: { length: 3.2, height: 0.95, newelEnds: true, mat: 'stair_treads', balusterMat: 'trim_chipped' }, collider: 'box' });
p('P_GALLERY_RAIL_S', 'balustrade_run', 'U1', [0.6, 4.6, zU], FACE.S, { params: { length: 1.2, height: 0.95, newelEnds: true, mat: 'stair_treads', balusterMat: 'trim_chipped' }, collider: 'box' });
p('P_PUMP_PHOTO', 'photo_frame', 'U1', [0.03, 2.4, zU + 1.5], FACE.E, { params: { photo: 'pump_1970_knifed', size: 'medium', mat: 'photo_print' }, collider: 'none', interaction: 'examine_pump_photo' });
p('P_HALL_CONSOLE_U1', 'hall_table', 'U1', [0.3, 1.2, zU], FACE.E, { params: { length: 0.8, depth: 0.35, height: 0.78, mat: 'wood_furniture_dark', dust: true } });
// REALISM-BACKLOG #10 (lead-approved, ROADMAP round C): the key light of the upper floor, a full candle (12 W ~ 1 cd,
// 12.6 lm, 1850 K like the hall candle) on a saucer on the gallery's SE newel cap (newel 1.15 m) — straight ahead of
// the armoire hide eye (3.12, 4.45) looking west, so the hide view shows the flame and the lit hallway beyond the slats.
p('P_CANDLE_LANDING', 'candle', 'U1', [1.2, 4.6, zU + 1.17], 0, { params: { holder: 'saucer', height: 0.12, mat: 'wax_candle' }, lighting: 'dynamic', collider: 'none', ms: 'M2' });

// U2 — Harlan's bedroom
p('P_BED', 'iron_bed', 'U2', [7.6, 3.5, zU], FACE.S, { params: { width: 1.4, length: 2.0, mat: 'cast_iron', mattressMat: 'ticking_mattress', blanketMat: 'wool_coats' }, collider: 'mesh', ms: 'M1' });
p('P_NIGHTSTAND', 'nightstand', 'U2', [6.55, 4.22, zU], FACE.S, { params: { mat: 'wood_furniture_dark' }, ms: 'M1' });
p('P_LEDGER', 'ledger_book', 'U2', [6.5, 4.15, zU + 0.66], 0.25, { params: { pages: 3, mat: 'paper_aged', coverMat: 'leather_worn' }, lighting: 'dynamic', collider: 'none', interaction: 'read_ledger', ms: 'M2' });
p('P_KEROSENE_LAMP', 'kerosene_lamp', 'U2', [6.66, 4.33, zU + 0.66], 0, { params: { wick: 'low', mat: 'glass_grimy', burnerMat: 'brass_tarnished' }, lighting: 'dynamic', collider: 'none', ms: 'M1' });
p('P_BELL_PULL', 'bell_pull_embroidered', 'U2', [6.1, 4.46, zU + 0.95], FACE.S, { params: { length: 1.2, mat: 'wool_needlepoint', tasselMat: 'brass_tarnished' }, lighting: 'dynamic', collider: 'none', interaction: 'pull_bell', ms: 'M2' });
p('P_COAT_WARDROBE', 'slatted_cabinet', 'U2', [4.07, 1.9, zU], FACE.E, { params: { variant: 'wardrobe_coats', width: 1.1, depth: 0.62, height: 2.05, contents: 'coats,handbag,trucker_cap', mat: 'wood_furniture_dark', coatMat: 'wool_coats' }, collider: 'mesh', interaction: 'hide', ms: 'M2' });
p('P_SACK_CHAIR', 'chair_sacks', 'U2', [8.05, 0.75, zU], faceYaw(-1, 1), { params: { mat: 'wood_furniture_dark', sackMat: 'burlap_sack', twine: true, scissors: true }, ms: 'M2' });
p('P_WASHSTAND', 'washstand', 'U2', [6.3, 0.28, zU], FACE.N, { params: { mat: 'wood_furniture_dark', bowlMat: 'enamel_chipped' }, ms: 'M2' });
p('P_MIRROR_WASHSTAND', 'mirror_crepe', 'U2', [6.3, 0.05, zU + 1.05], FACE.N, { params: { style: 'washstand', mat: 'crepe_black', frameMat: 'wood_furniture_dark' }, collider: 'none', ms: 'M2' });
p('P_HAMMER', 'claw_hammer', 'U2', [8.7, 1.15, zU + 0.87], 0.3, { params: { mat: 'steel_forged', handleMat: 'hickory_handle' }, lighting: 'dynamic', collider: 'none', interaction: 'take_hammer', ms: 'M2' });
p('P_NAIL_CAN', 'nail_can', 'U2', [8.7, 1.5, zU + 0.87], 0, { params: { mat: 'zinc_galvanized', contents: 'square_nails' }, lighting: 'dynamic', collider: 'none', ms: 'M2' });
p('P_GRATE', 'floor_register', 'U2', [6.0, 3.2, zU], 0, { params: { size: 0.6, mat: 'cast_iron', hole: GRATE.join(',') }, collider: 'none', interaction: 'peek_grate', ms: 'M1' });
p('P_BED_RUG', 'rag_rug', 'U2', [6.4, 2.2, zU], 0.1, { params: { mat: 'rag_rug', w: 1.2, d: 0.8 }, collider: 'none', ms: 'M2' });

// U3 — Ada's sewing room
p('P_DRESS', 'dress_dummy', 'U3', [8.15, 7.2, zU], FACE.W, { params: { state: 'intact', states: 'intact,cut_hem', mat: 'wedding_satin', sheetMat: 'dust_sheet', sheetSlidOffShoulder: true }, lighting: 'dynamic', collider: 'box', interaction: 'cut_hem', ms: 'M2' });
p('P_LOCKET', 'locket', 'U3', [8.15, 7.0, zU + 0.12], 0, { params: { engraving: 'A. from H. 1968', open: false, mat: 'brass_tarnished', photoMat: 'photo_print', inHem: true }, lighting: 'dynamic', collider: 'none', interaction: 'take_locket', ms: 'M2' });
p('P_TICKET', 'bus_ticket', 'U3', [8.1, 7.0, zU + 0.12], 0, { params: { text: 'CARVEL 6:10, TUE OCT 12 1976', mat: 'paper_aged', inHem: true }, lighting: 'dynamic', collider: 'none', interaction: 'read_ticket', ms: 'M2' });
p('P_SEW_BASKET', 'sewing_basket', 'U3', [7.25, 8.3, zU], 0.4, { params: { mat: 'wood_raw_plank' }, collider: 'none', ms: 'M2' });
p('P_SHEARS', 'sewing_shears', 'U3', [7.2, 8.28, zU + 0.24], 0.9, { params: { mat: 'steel_forged', bowMat: 'cast_iron' }, lighting: 'dynamic', collider: 'none', interaction: 'take_shears', ms: 'M2' });
p('P_LETTER', 'letter', 'U3', [7.3, 8.33, zU + 0.24], 0.2, { params: { mat: 'paper_aged', unsent: true }, lighting: 'dynamic', collider: 'none', interaction: 'read_letter', ms: 'M2' });
p('P_SHEET_CHAIR', 'dust_sheet_proxy', 'U3', [4.6, 5.4, zU], 0.5, { params: { shape: 'chair', mat: 'dust_sheet' }, ms: 'M2' });
p('P_SHEET_TREADLE', 'dust_sheet_proxy', 'U3', [6.3, 5.15, zU], FACE.N, { params: { shape: 'treadle_machine', mat: 'dust_sheet' }, ms: 'M2' });
p('P_SHEET_TRUNK', 'dust_sheet_proxy', 'U3', [7.8, 5.2, zU], 0.1, { params: { shape: 'trunk', mat: 'dust_sheet' }, ms: 'M2' });
p('P_ADA_WARDROBE', 'slatted_cabinet', 'U3', [5.0, 8.83, zU], FACE.S, { params: { variant: 'wardrobe_loose_back', width: 1.2, depth: 0.62, height: 2.1, looseBackDoor: 'D_WARDROBE_BACK', mat: 'wood_furniture_dark' }, collider: 'mesh', interaction: 'hide', ms: 'M2' });

// U4 / U4T — servants' stair
p('P_COBWEB_1', 'cobweb_curtain', 'U4T', [5.0, 10.2, zU + 1.2], FACE.S, { params: { density: 0.8 }, lighting: 'dynamic', collider: 'none', ms: 'M2' });
p('P_COBWEB_2', 'cobweb_curtain', 'U4', [6.8, 11.25, EG + 2.7], FACE.E, { params: { density: 0.6 }, lighting: 'dynamic', collider: 'none', ms: 'M2' });
p('P_COBWEB_3', 'cobweb_curtain', 'U4', [8.35, 11.3, EG + 1.4], FACE.S, { params: { density: 0.5 }, lighting: 'dynamic', collider: 'none', ms: 'M2' });

// Harlan's static lightning poses (markers for src/characters + cutscenes; never collide, never baked)
p('P_HARLAN_POSE_PUSH', 'harlan_pose_marker', 'EXT2', [13.0, -3.4, 0], faceYaw(0.2, 1), { params: { pose: 'push_car', beat: 'B07', target: 'P_CAR_ROW' }, lighting: 'dynamic', collider: 'none', ms: 'M2' });
p('P_HARLAN_POSE_LOOKUP', 'harlan_pose_marker', 'EXT2', [12.2, 0.6, 0], faceYaw(-1, 0.1), { params: { pose: 'look_up_at_window', beat: 'B07', lookAt: '8.9,1.3,5.6' }, lighting: 'dynamic', collider: 'none', ms: 'M2' });
p('P_HARLAN_POSE_STAIRFOOT', 'harlan_pose_marker', 'G1', [1.7, 2.6, zG], faceYaw(-0.3, 1), { params: { pose: 'watch_from_stair_foot', beat: 'B08', lookAt: '1.8,8.0,5.7' }, lighting: 'dynamic', collider: 'none', ms: 'M2' });

// CAR set
p('P_CAR_INTERIOR', 'sedan_interior', 'CAR', [100.8, 1.4, 0], 0, { params: { trim: 'car_interior_tan', altTrim: 'car_interior_maroon', fuelNeedle: 'below_E', radio: 'cassette', wipers: true, glassMat: 'glass_rain', gloveMat: 'leather_worn' }, lighting: 'dynamic', collider: 'none' });
p('P_AIR_FRESHENER', 'air_freshener', 'CAR', [100.8, 1.95, 0.95], 0, { params: { shape: 'pine', stingOnly: true }, lighting: 'dynamic', collider: 'none', ms: 'M2' });

// ------------------------------------------------------------------ hides
const hides = [
  { id: 'H_ARMOIRE', propId: 'P_ARMOIRE', room: 'U1', kind: 'armoire', entry: [2.55, 4.2, zU], eye: [3.12, 4.45, zU + 1.55], eyeYaw: H.W, unfailable: true },
  { id: 'H_COATS', propId: 'P_COAT_WARDROBE', room: 'U2', kind: 'wardrobe', entry: [4.75, 1.9, zU], eye: [4.07, 1.9, zU + 1.55], eyeYaw: H.E },
  { id: 'H_ADA_WARDROBE', propId: 'P_ADA_WARDROBE', room: 'U3', kind: 'wardrobe', entry: [5.0, 8.1, zU], eye: [5.0, 8.85, zU + 1.55], eyeYaw: H.S },
  { id: 'H_CLOSET', propId: 'P_CLOSET_INTERIOR', room: 'CLOSET', kind: 'closet', entry: [0.55, 9.65, zG], eye: [0.55, 8.4, zG + 1.5], eyeYaw: H.N },
];

// ------------------------------------------------------------------ lights
/** P_RC9_TRUCK's frame (s 1400, n -1.75, eastbound): at(right, forward, z) in PLAN. The runtime re-anchors its
 *  high-beam lights to the prop's `-hi_l/_r` nodes; these positions are the parked fallback. */
function layoutTruck() {
  const [bx, by] = rcPoint(1400, -1.75), h = rcFrame(1400)[2];
  const f = [Math.cos(h), Math.sin(h)], r = [Math.sin(h), -Math.cos(h)];
  return { at: (x, y, z) => [r3(bx + r[0] * x + f[0] * y), r3(by + r[1] * x + f[1] * y), r3(z)] };
}
// point/spot: watts = Blender W, runtime intensity = W / (4*pi).  sun: Blender strength (W/m^2, NOT divided).  area: Blender W.
const lights = [
  { id: 'L_LANTERN', room: 'EXT1', role: 'lantern', type: 'point', pos: [-1.8, -28.45, 2.15], watts: 150, // flat-wick kerosene ~12 cd (lead-approved 60 -> 150 W)
    kelvin: 1900, radius: 0.03, mode: 'bake_flicker' },
  { id: 'L_MOON', room: 'EXT2', role: 'moon', type: 'sun', pos: [30, -50, 60], target: [4, 4, 0], watts: 0.004, kelvin: 4100, radius: 0.5, mode: 'bake' },
  { id: 'L_SKY', room: 'EXT2', role: 'sky', type: 'area', pos: [4, -10, 35], target: [4, -10, 0], watts: 600, kelvin: 7500, radius: 30, mode: 'bake' },
  { id: 'L_LTN_SUN', room: 'EXT2', role: 'lightning', type: 'sun', pos: [-30, -60, 80], target: [4, 4, 0], watts: 3, kelvin: 9000, radius: 1.5, mode: 'flash' },
  { id: 'L_LTN_U1S', room: 'EXT2', role: 'lightning', type: 'area', pos: [1.8, -1.2, zU + 1.6], target: [1.8, 4, zU + 0.5], watts: 800, kelvin: 9000, radius: 0.6, mode: 'flash' },
  { id: 'L_LTN_U2E', room: 'EXT2', role: 'lightning', type: 'area', pos: [10.0, 1.3, zU + 1.6], target: [5, 1.3, zU + 0.5], watts: 800, kelvin: 9000, radius: 0.6, mode: 'flash' },
  { id: 'L_LTN_U3E', room: 'EXT2', role: 'lightning', type: 'area', pos: [10.0, 7.2, zU + 1.6], target: [5, 7.2, zU + 0.5], watts: 800, kelvin: 9000, radius: 0.6, mode: 'flash' },
  { id: 'L_CANDLE_HALL', room: 'G1', role: 'candle', type: 'point', pos: [3.4, 4.5, zG + 1.0], watts: 12, kelvin: 1850, radius: 0.012, mode: 'bake_flicker' },
  { id: 'L_CANDLE_TABLE', room: 'G2', role: 'candle', type: 'point', pos: [5.6, 2.3, zG + 0.98], watts: 12, kelvin: 1850, radius: 0.012, mode: 'bake_flicker' },
  // C2-ESCAPE K2: the parlor kerosene lamp on the stool — flat-wick lamp ≈ 10–15 cd (CLAUDE.md) → 12 cd = 151 W / 4π,
  // 1950 K. Baked indirect-only (bakePass) once the release bake lands; until then runtime-only (CONTRACT-CHANGES)
  { id: 'L_LAMP_PARLOR', room: 'G2', role: 'lamp', type: 'point', pos: [4.6, 4.25, zG + 0.75], watts: 151, kelvin: 1950, radius: 0.012, mode: 'runtime', bakePass: 'indirect' },
  { id: 'L_CANDLE_MANTEL', room: 'G2', role: 'candle', type: 'point', pos: [8.6, 3.4, zG + 1.44], watts: 10, kelvin: 1850, radius: 0.012, mode: 'bake_flicker' },
  { id: 'L_CANDLE_SILL', room: 'G2', role: 'candle', type: 'point', pos: [5.0, 0.18, zG + 0.9], watts: 10, kelvin: 1850, radius: 0.012, mode: 'bake_flicker' },
  { id: 'L_CANDLE_KITCHEN', room: 'G3', role: 'candle', type: 'point', pos: [6.75, 9.6, zG + 0.86], watts: 6, kelvin: 1800, radius: 0.01, mode: 'bake_flicker' },
  { id: 'L_CANDLE_LANDING', room: 'U1', role: 'candle', type: 'point', pos: [1.2, 4.6, zU + 1.33], watts: 12, kelvin: 1850, radius: 0.012, mode: 'bake_flicker' },
  { id: 'L_LAMP_U2', room: 'U2', role: 'lamp', type: 'point', pos: [6.66, 4.33, zU + 0.86], watts: 60, kelvin: 2100, radius: 0.02, mode: 'bake_flicker' },
  // Opening (docs/C1-OPENING.md §5.1, lead-approved 2026-10-08). Headlights: 1980s 4x6 in H4656-class halogen low beam,
  // ~720 lm/lamp, hot spot 15 kcd (cd = peak candela of the beam cookie, `beam` names its lobe table), 3200 K.
  // Lamp centres from sedan.py (car space (+-0.58, 2.43, 0.64)) on P_CAR_GATE (nose west); aim = straight ahead, the
  // cookie carries the 1.5 deg dip. watts kept = cd*4pi for readers of the old field.
  { id: 'L_HEADLIGHT_L', room: 'EXT1', role: 'headlight', type: 'spot', pos: [0.37, -30.78, 0.64], target: [-29.63, -30.78, 0.64], watts: r3(15000 * 4 * PI), cd: 15000, beam: 'halogen_low', kelvin: 3200, radius: 0.08, mode: 'runtime' },
  { id: 'L_HEADLIGHT_R', room: 'EXT1', role: 'headlight', type: 'spot', pos: [0.37, -29.62, 0.64], target: [-29.63, -29.62, 0.64], watts: r3(15000 * 4 * PI), cd: 15000, beam: 'halogen_low', kelvin: 3200, radius: 0.08, mode: 'runtime' },
  // L_DASH: the gauge cluster as a source: dials ~3 cd/m2 over 0.035 m2 -> ~0.1 cd toward the driver (green-aqua at runtime).
  { id: 'L_DASH', room: 'CAR', role: 'dashboard', type: 'spot', pos: [100.43, 2.1, 0.84], target: [100.43, 1.3, 0.8], watts: r3(0.1 * 4 * PI), cd: 0.1, angle: 35, kelvin: 6500, radius: 0.1, mode: 'runtime' },
  // L_DOME: 211-2 festoon (12 cp) behind a yellowed lens, ~120 lm -> I0 = phi/pi ~ 38 cd, Lambertian lens: a hemisphere (spot full cone 170 deg, penumbra 1 ~ cos falloff).
  { id: 'L_DOME', room: 'CAR', role: 'other', type: 'spot', pos: [100.8, 1.0, 1.29], target: [100.8, 1.0, 0], watts: r3(38 * 4 * PI), cd: 38, angle: 170, kelvin: 2800, radius: 0.04, mode: 'runtime' },
  // L_CAB_VEIL: rain backscatter in the beams across the lower windscreen (0.05-0.15 cd/m2) -> ~1 cd fill on the cabin.
  { id: 'L_CAB_VEIL', room: 'CAR', role: 'other', type: 'spot', pos: [100.8, 2.75, 1.15], target: [100.8, 0.8, 0.8], watts: r3(1 * 4 * PI), cd: 1, angle: 120, kelvin: 3400, radius: 0.5, mode: 'runtime' },
  // L_TRUCK_HI_L/R: logging-truck high beams, ~1500 lm/lamp, peak 35 kcd (truck local (+-0.82, front 10.3, 1.22) per props_road -hi_l/_r); follow P_RC9_TRUCK.
  ...[['L', -0.85], ['R', 0.85]].map(([k, x]) => {
    const t = layoutTruck();
    return { id: `L_TRUCK_HI_${k}`, room: 'RC9', role: 'other', type: 'spot', pos: t.at(x, 10.3, 1.22), target: t.at(x, 70, 1.22 - 60 * Math.tan(0.5 * PI / 180)), watts: r3(35000 * 4 * PI), cd: 35000, beam: 'halogen_high', kelvin: 3300, radius: 0.09, mode: 'runtime' };
  }),
];

// ------------------------------------------------------------------ acoustic surfaces (smallest containing zone wins)
const surfaces = [
  { room: 'EXT1', rect: R.EXT1, surface: 'grass', mat: 'grass_wet' },
  { room: 'EXT1', rect: [-20, -36.5, 20, -29.5], surface: 'asphalt', mat: 'asphalt_wet' },
  { room: 'EXT1', rect: [-20, -29.5, 20, -28.5], surface: 'gravel', mat: 'gravel_wet' },
  { room: 'EXT1', rect: [-20, -38, 20, -37.3], surface: 'mud', mat: 'mud_wet' },
  { room: 'EXT2', rect: R.EXT2, surface: 'grass', mat: 'grass_wet' },
  { room: 'RC9', rect: R.RC9, surface: 'asphalt', mat: 'asphalt_wet' },   // the opening set: only the car is ever on it
  { room: 'EXT2', rect: [-0.7, -28, 4.3, -2.8], surface: 'gravel', mat: 'gravel_wet' },
  { room: 'EXT2', rect: [4.3, -16, 8.5, -7], surface: 'mud', mat: 'mud_wet' },
  { room: 'EXT2', rect: [10.5, -4, 16, 1.5], surface: 'mud', mat: 'mud_wet' },
  { room: 'EXT2', rect: [-0.125, -2.8, 8.875, -0.3], surface: 'porch_wood', mat: 'porch_boards_wet' },
  { room: 'G1', rect: R.G1, surface: 'bare_wood' },
  { room: 'G1', rect: [1.95, 0.4, 2.75, 4.0], surface: 'runner' },
  { room: 'G1', rect: [0, 3.6, 1.1, 7.8], surface: 'stair_wood' },
  { room: 'CLOSET', rect: R.CLOSET, surface: 'bare_wood' },
  { room: 'G3P', rect: R.G3P, surface: 'bare_wood' },
  { room: 'G2', rect: R.G2, surface: 'bare_wood' },
  { room: 'G2', rect: [6.4, 3.85, 8.0, 4.95], surface: 'carpet' },
  { room: 'G3', rect: R.G3, surface: 'bare_wood' },
  { room: 'U4', rect: R.U4, surface: 'stair_wood' },
  { room: 'U1', rect: R.U1, surface: 'bare_wood' },
  { room: 'U1', rect: [1.95, 0.5, 2.85, 8.5], surface: 'runner' },
  { room: 'U2', rect: R.U2, surface: 'bare_wood' },
  { room: 'U2', rect: [5.8, 1.8, 7.0, 2.6], surface: 'carpet' },
  { room: 'U3', rect: R.U3, surface: 'bare_wood' },
  { room: 'U4T', rect: R.U4T, surface: 'bare_wood' },
  { room: 'CAR', rect: R.CAR, surface: 'car' },
];

// ------------------------------------------------------------------ creakers (the two marked U1 boards + one by Ada's wardrobe)
const creakers = [
  { id: 'CR_U1_A', room: 'U1', pos: [3.05, 5.85], radius: 0.28 },
  { id: 'CR_U1_B', room: 'U1', pos: [1.72, 6.95], radius: 0.28 },
  { id: 'CR_U3_A', room: 'U3', pos: [6.2, 7.6], radius: 0.3 },
];

// ------------------------------------------------------------------ room graph (hearing / audio occlusion)
const roomLinks = [
  { a: 'EXT1', b: 'EXT2', via: 'arch', attenuation: 1 },
  { a: 'EXT2', b: 'G1', via: 'door', doorId: 'D_FRONT', attenuation: 0.5, openAttenuation: 1 },
  { a: 'EXT2', b: 'G2', via: 'wall', attenuation: 0.35 },
  { a: 'G1', b: 'G2', via: 'door', doorId: 'D_PARLOR', attenuation: 0.5, openAttenuation: 1 },
  { a: 'G1', b: 'U1', via: 'stairwell', attenuation: 1 },
  { a: 'G1', b: 'G3P', via: 'door', doorId: 'D_PASSAGE', attenuation: 0.5, openAttenuation: 1 },
  { a: 'G1', b: 'G3', via: 'wall', attenuation: 0.35 },
  { a: 'G3P', b: 'CLOSET', via: 'door', doorId: 'D_CLOSET', attenuation: 0.7, openAttenuation: 1 },
  { a: 'G1', b: 'CLOSET', via: 'wall', attenuation: 0.6 },
  { a: 'G3P', b: 'G3', via: 'arch', attenuation: 1 },
  { a: 'G2', b: 'G3', via: 'wall', attenuation: 0.35 },
  { a: 'G3', b: 'U4', via: 'door', doorId: 'D_BACKSTAIR', attenuation: 0.5, openAttenuation: 1 },
  { a: 'U4', b: 'U4T', via: 'stairwell', attenuation: 1 },
  { a: 'U4T', b: 'U3', via: 'door', doorId: 'D_WARDROBE_BACK', attenuation: 0.6, openAttenuation: 1 },
  { a: 'U1', b: 'U2', via: 'door', doorId: 'D_HARLAN', attenuation: 0.5, openAttenuation: 1 },
  { a: 'U1', b: 'U2', via: 'door', doorId: 'D_DRESSING', attenuation: 0.5, openAttenuation: 1 },
  { a: 'U1', b: 'U3', via: 'door', doorId: 'D_ADA', attenuation: 0.5, openAttenuation: 1 },
  { a: 'G2', b: 'U2', via: 'floor', attenuation: 0.4 },
  { a: 'G2', b: 'U2', via: 'grate', attenuation: 0.75 },
  { a: 'G2', b: 'U3', via: 'floor', attenuation: 0.4 },
  { a: 'G3', b: 'U3', via: 'floor', attenuation: 0.4 },
  { a: 'G3', b: 'U4T', via: 'floor', attenuation: 0.4 },
  { a: 'G1', b: 'U1', via: 'floor', attenuation: 0.4 },
];

// ------------------------------------------------------------------ AI graph
const aiNodes = [];
const n = (id, room, x, y, tags, lookYaw) => aiNodes.push({ id, room, pos: [x, y, ROOM[room].floor === 'upper' ? zU : zG], tags, ...(lookYaw !== undefined ? { lookYaw } : {}) });
// upper floor
n('U_VIGIL', 'U1', 3.2, 8.2, ['vigil', 'anchor'], H.E);
n('U_STAIRTOP', 'U1', 0.55, 8.3, ['stair', 'look'], H.S);
n('U_LANDING', 'U1', 2.0, 8.35, ['patrol']);
n('U_RUNNER_N', 'U1', 2.4, 6.3, ['patrol']);
n('U_ARMOIRE', 'U1', 2.55, 4.2, ['patrol', 'hide_check'], H.E);
n('U_HDOOR_O', 'U1', 3.15, 3.0, ['door', 'look'], H.E);
n('U2_HDOOR_I', 'U2', 4.3, 3.0, ['door']);
n('U2_BEDLOOK', 'U2', 6.35, 2.15, ['look', 'patrol'], heading(1.2, 1.0));
n('U2_WARD_HC', 'U2', 4.85, 1.9, ['hide_check'], H.W);
n('U2_DDOOR_I', 'U2', 4.3, 0.8, ['door']);
n('U_DDOOR_O', 'U1', 3.15, 0.8, ['door', 'look'], H.E);
n('U_RUNNER_S', 'U1', 2.4, 1.9, ['patrol']);
n('U_SWINDOW', 'U1', 1.8, 0.45, ['look', 'window', 'anchor'], H.S);
n('U_SLANDING', 'U1', 0.6, 2.6, ['patrol']);
n('U3_DOOR_I', 'U3', 4.3, 8.2, ['door']);
n('U3_DRESS', 'U3', 7.4, 7.2, ['look', 'vigil', 'anchor'], H.E);
n('U3_WARD_HC', 'U3', 5.0, 7.95, ['hide_check'], H.N);
// ground floor
n('G_STAIRFOOT', 'G1', 0.9, 3.2, ['stair', 'look'], H.N);
n('G_HALL_S', 'G1', 1.9, 1.0, ['patrol', 'look'], H.S);
n('G_PARLOR_LURE', 'G1', 3.2, 1.5, ['lure', 'door', 'anchor'], H.E);
n('G_HALL_MID', 'G1', 2.3, 5.0, ['patrol']);
n('G_HALL_N', 'G1', 2.4, 8.3, ['patrol', 'look'], H.S);
n('G_PDOOR_S', 'G1', 2.5, 8.65, ['door']);
n('G_PDOOR_N', 'G3P', 2.5, 9.55, ['door']);
n('G_CLOSET_HC', 'G3P', 0.6, 9.75, ['hide_check'], H.S);
n('G_PASSAGE_E', 'G3P', 3.2, 9.95, ['patrol']);
n('G_KITCHEN_W', 'G3', 4.35, 9.95, ['patrol']);
n('G_KITCHEN_C', 'G3', 6.3, 9.0, ['patrol', 'look', 'anchor'], H.S);
n('G_KITCHEN_S', 'G3', 5.8, 6.9, ['patrol', 'look'], H.W);

const aiEdges = [];
const e = (a, b, kind, loops, x = {}) => aiEdges.push({ a, b, kind, ...x, loops });
// upper patrol: vigil -> stair top (LOOK) -> runner -> Harlan's doors -> south window (LOOK) -> back
e('U_VIGIL', 'U_STAIRTOP', 'walk', ['upper']);
e('U_STAIRTOP', 'U_LANDING', 'walk', ['upper']);
e('U_LANDING', 'U_RUNNER_N', 'walk', ['upper']);
e('U_RUNNER_N', 'U_ARMOIRE', 'walk', ['upper']);
e('U_ARMOIRE', 'U_HDOOR_O', 'walk', ['upper', 'harlan_loop']);
e('U_HDOOR_O', 'U2_HDOOR_I', 'door', ['upper', 'harlan_loop'], { doorId: 'D_HARLAN' });
e('U2_HDOOR_I', 'U2_BEDLOOK', 'walk', ['upper', 'harlan_loop']);
e('U2_BEDLOOK', 'U2_WARD_HC', 'walk', ['upper', 'harlan_loop']);
e('U2_WARD_HC', 'U2_DDOOR_I', 'walk', ['upper', 'harlan_loop']);
e('U2_DDOOR_I', 'U_DDOOR_O', 'door', ['upper', 'harlan_loop'], { doorId: 'D_DRESSING' });
e('U_DDOOR_O', 'U_SWINDOW', 'walk', ['upper']);
e('U_SWINDOW', 'U_SLANDING', 'walk', ['upper']);
e('U_SLANDING', 'U_RUNNER_S', 'walk', ['upper']);
e('U_DDOOR_O', 'U_RUNNER_S', 'walk', ['harlan_loop']);
e('U_RUNNER_S', 'U_ARMOIRE', 'walk', ['upper', 'harlan_loop']);
e('U_LANDING', 'U_VIGIL', 'walk', ['upper']);
// after B08 her room opens (her vigil moves beside the dress after B09)
e('U_VIGIL', 'U3_DOOR_I', 'door', ['upper_b08'], { doorId: 'D_ADA' });
e('U3_DOOR_I', 'U3_WARD_HC', 'walk', ['upper_b08']);
e('U3_WARD_HC', 'U3_DRESS', 'walk', ['upper_b08']);
e('U3_DRESS', 'U3_DOOR_I', 'walk', ['upper_b08']);
// the stair joins the floors (lure + finale)
e('U_STAIRTOP', 'G_STAIRFOOT', 'stair', ['lure', 'ground_finale'], { stairId: 'ST_MAIN' });
// ground: lure to the parlor door; finale loop stair foot -> parlor door -> back passage -> kitchen
e('G_STAIRFOOT', 'G_HALL_S', 'walk', ['ground_finale']);
e('G_HALL_S', 'G_PARLOR_LURE', 'walk', ['ground_finale']);
e('G_STAIRFOOT', 'G_PARLOR_LURE', 'walk', ['lure']);
e('G_PARLOR_LURE', 'G_HALL_MID', 'walk', ['ground_finale']);
e('G_HALL_MID', 'G_STAIRFOOT', 'walk', ['ground_finale']);
e('G_HALL_MID', 'G_HALL_N', 'walk', ['ground_finale']);
e('G_HALL_N', 'G_PDOOR_S', 'walk', ['ground_finale']);
e('G_PDOOR_S', 'G_PDOOR_N', 'door', ['ground_finale'], { doorId: 'D_PASSAGE' });
e('G_PDOOR_N', 'G_CLOSET_HC', 'walk', ['ground_finale']);
e('G_PDOOR_N', 'G_PASSAGE_E', 'walk', ['ground_finale']);
e('G_PASSAGE_E', 'G_KITCHEN_W', 'walk', ['ground_finale']);
e('G_KITCHEN_W', 'G_KITCHEN_C', 'walk', ['ground_finale']);
e('G_KITCHEN_C', 'G_KITCHEN_S', 'walk', ['ground_finale']);
e('G_KITCHEN_S', 'G_KITCHEN_W', 'walk', ['ground_finale']);

// ------------------------------------------------------------------ fixed cameras
const THRESHOLD_POS = [3.42, 1.5, zG + 1.62];
const THRESHOLD_TARGET = [6.3, 4.8, zG + 1.05];
const cameras = [
  { id: 'parlor_threshold', pos: THRESHOLD_POS, target: THRESHOLD_TARGET, fovDeg: 50, note: 'C2 tableau, C5 walk-back, C7 sting: the opening\'s exact threshold and lens. Table candle -> shadows across the north tally wall.' },
  { id: 'parlor_wide', pos: [3.95, 0.3, zG + 2.3], target: [6.4, 5.2, zG + 1.3], fovDeg: 62, note: 'C5 finale shadow-play (tally wall + door gap), from the SW corner.' },
  { id: 'parlor_grate', pos: [6.0, 3.2, zU + 0.45], target: [6.9, 4.7, zG + 0.9], fovDeg: 55, note: 'B06/B07 peek through the U2 floor register: tally wall, table, rocking chair.' },
  { id: 'porch_approach', pos: [2.3, -13.0, 1.6], target: [1.8, -0.3, 2.4], fovDeg: 45, note: 'B02 / C7: the drive toward the porch, lit parlor shutters right of the door.' },
  { id: 'c1_house_reveal', pos: [2.6, -30.1, 1.15], target: [3.5, 0, 5.5], fovDeg: 50, note: 'C1: from the dead car at the gate, lightning reveals the house on the rise.' },
  { id: 'c3_field', pos: [8.45, 1.3, zU + 1.6], target: [18, 0.5, 0.6], fovDeg: 55, note: 'C3 reference view from the U2 east window over the wreck row (player keeps look control). Your car ends at the near end, ~5 m below-right of the window.' },
  { id: 'c7_guest_book', pos: [2.85, 4.1, zG + 1.55], target: [3.33, 4.1, zG + 0.8], fovDeg: 38, note: 'C7: the waiting line now reads HARLAN, ruled through.' },
  { id: 'parlor_lean', pos: [3.7, 1.26, zG + 1.57], target: [5.31, 3.25, zG + 0.8], fovDeg: 27, note: 'C2-ESCAPE K5: the lean eye D inside the doorway reveal (50 mm = 27 deg vertical); aims at the neck on the sawbuck.' },
  { id: 'c7_sting_threshold', pos: THRESHOLD_POS, target: THRESHOLD_TARGET, fovDeg: 50, note: 'C7 final tableau: identical to parlor_threshold (Ada in the rocker, the sack raised).' },
];

// ------------------------------------------------------------------ spawns / checkpoints (pos = eye)
const s = (id, room, x, y, yaw, pitch, note, eye = EYE) => ({ id, room, pos: [x, y, ROOM[room].floor === 'upper' ? zU + eye : ROOM[room].floor === 'ground' ? zG + eye : eye], yaw, pitch, note });
const spawns = [
  s('CP1', 'EXT2', 1.8, -27.4, H.N, 0.05, 'At the gate after C1, facing the drive.'),
  s('CP2', 'U1', 0.55, 8.25, H.S, -0.87, 'Stair top after C2c (C2-ESCAPE K4; x 0.55 = the flight centreline, C6 prototype + B-CINE, CONTRACT-CHANGES): looking down the flight, pitch -50 deg.'),
  s('CP3', 'U1', 2.55, 4.2, H.S, 0, 'Out of the armoire after the first hide; her vigil is north.'),
  s('CP4', 'U2', 5.6, 2.3, H.E, -0.05, 'Harlan\'s bedroom on taking the hammer or the ledger.'),
  s('CP5', 'U1', 2.5, 7.3, heading(1, 0.4), 0, 'Before Ada\'s door, after each pried board.'),
  s('CP6', 'U3', 6.4, 7.6, H.N, 0, 'Sewing room after taking the locket (dress visit replays).'),
  s('CP7', 'G3', 4.7, 8.6, H.W, 0, 'Kitchen after taking the can.'),
  s('CP8', 'G1', 2.5, 8.2, H.S, 0, 'Hall, finale: through the back passage, the stair ahead.'),
  s('debug_road', 'EXT1', 6.0, -31.5, H.W, 0, 'Road beside the car.'),
  s('debug_porch', 'EXT2', 1.8, -2.0, H.N, 0.05, 'Porch at the front door.'),
  s('debug_hall', 'G1', 2.4, 1.2, H.N, 0, 'Hall inside the front door.'),
  s('debug_parlor', 'G2', 4.3, 1.5, heading(1, 1), 0, 'Inside the parlor (debug only; never free-roamed).'),
  s('debug_kitchen', 'G3', 6.0, 7.2, H.N, 0, 'Kitchen.'),
  s('debug_upper', 'U1', 2.4, 7.2, H.S, 0, 'Upper hall at the stair top.'),
  s('debug_u2', 'U2', 5.0, 2.0, H.E, 0, 'Harlan\'s bedroom.'),
  s('debug_u3', 'U3', 5.2, 7.2, H.E, 0, 'Ada\'s sewing room.'),
  s('debug_backstair', 'U4T', 5.0, 9.8, H.N, 0, 'Servants\' stair top landing.'),
  s('debug_car', 'CAR', 100.45, 1.35, H.N, -0.05, 'Driver\'s seat (car set).', 1.1),
];

// ------------------------------------------------------------------ triggers
const t = (id, room, rect, event) => {
  const f = ROOM[room].floor;
  const z0 = f === 'upper' ? zU : f === 'ground' ? zG : 0;
  return { id, room, rect, zMin: z0 - 0.2, zMax: z0 + 3, event };
};
const triggers = [
  t('T_B02_GATE', 'EXT2', [-0.7, -27.6, 4.3, -26.5], 'b02:gate_passed'),
  t('T_B02_PUMP', 'EXT2', [-0.7, -16.0, 4.3, -12.0], 'b02:pump_passed'),
  t('T_B02_PORCH', 'EXT2', [0.6, -2.8, 3.0, -0.3], 'b02:at_door'),
  t('T_B03_HALL', 'G1', [0.2, 0.05, 3.4, 1.0], 'b03:hall_enter'),
  t('T_B03_THRESHOLD', 'G1', [2.75, 1.0, 3.6, 2.0], 'b03:threshold'),
  // C2-ESCAPE K6: T_B04_STAIRTOP / T_B04_ARMOIRE_FLASH retired (B04 is the C2c cutscene only; B05 starts at the stair top)
  t('T_B05_ENTER_U2', 'U2', [3.75, 0, 5.3, 4.5], 'b05:enter_u2'),
  t('T_B06_GRATE', 'U2', [5.4, 2.6, 6.6, 3.8], 'b06:near_grate'),
  t('T_B06_WINDOW', 'U2', [7.9, 0.4, 8.75, 2.2], 'b06:east_window'),
  t('T_B08_ADA_DOOR', 'U1', [2.6, 7.5, 3.6, 8.9], 'b08:at_ada_door'),
  t('T_B09_ENTER_U3', 'U3', [3.75, 7.4, 5.2, 9.15], 'b09:enter_u3'),
  t('T_B10_BACKSTAIR', 'U4T', [4.6, 9.3, 5.45, 11.65], 'b10:backstair_enter'),
  t('T_B10_KITCHEN', 'G3', [7.6, 9.9, 8.75, 10.75], 'b10:kitchen_enter'),
  t('T_B11_PASSAGE', 'G3P', [0, 9.15, 3.6, 10.75], 'b11:passage_enter'),
  t('T_B11_HALL', 'G1', [1.2, 3.0, 3.6, 9.0], 'b11:hall_finale'),
  t('T_B12_CAR', 'EXT2', [11.6, -3.4, 15.2, 0.2], 'b12:at_car'),
];

// ------------------------------------------------------------------ lightmap atlases
const atlases = [
  { id: 'LM_EXTERIOR', rooms: ['EXT1', 'EXT2', 'RC9'], maxResolution: 2048, flash: false },
  { id: 'LM_GROUND', rooms: ['G1', 'CLOSET', 'G3P'], maxResolution: 2048, flash: false },
  { id: 'LM_PARLOR', rooms: ['G2'], maxResolution: 2048, flash: false },
  { id: 'LM_KITCHEN', rooms: ['G3', 'U4', 'U4T'], maxResolution: 2048, flash: false },
  { id: 'LM_UPPER_HALL', rooms: ['U1'], maxResolution: 2048, flash: true },
  { id: 'LM_UPPER_ROOMS', rooms: ['U2', 'U3'], maxResolution: 2048, flash: true },
  { id: 'LM_CAR', rooms: ['CAR'], maxResolution: 1024, flash: false },
];

// ------------------------------------------------------------------ assemble
const layout = {
  version: 1,
  meta: {
    title: 'THE KEEPING — Stroud house, County Road 9',
    date: '1994-10-11',
    notes: [
      'Generated by scripts/layout/build-layout.mjs — edit the generator, not this file. Validate with scripts/validate-layout.mjs.',
      'PLAN space: metres, Z-up, x=east, y=north; front facade faces -y. All pos/z values are ABSOLUTE plan z (ground floor finished level 0.6, upper 4.1; exterior grade 0).',
      'Prop yaw = rotation of a model built facing -y (yaw 0 faces south, pi faces north, pi/2 faces east, -pi/2 faces west). Headings (spawn.yaw, hide.eyeYaw, aiNode.lookYaw) are directions CCW from +x (east 0, north pi/2).',
      'Walls: centre lines a->b; `left` is the room on the left looking from a to b. Exterior walls run counter-clockwise (left = inside). Ground walls run from 0.6 to 4.1 (include the upper slab); upper interior walls 2.9, upper exterior walls to the eave (7.2). Gable ends and roof above the eave come from `roof`.',
      'Opening offset = distance along a->b to the opening centre. passthrough openings are small holes for the door rope / bell wire. window.lightLeak (optional) = shutter slats leak interior candlelight (B02 parlor shutters).',
      'Lights: point/spot watts are Blender W, runtime intensity = W/(4*pi). sun watts are Blender strength in W/m^2 (NOT divided). area watts are Blender W (used for sky fill and lightning portals). Candle 12 W ~ 1 cd.',
      'Stairs: start = centre of the first riser nosing; treads run along `direction`. winder.atStep = first of 3 kite treads filling a width x width square, after which the flight turns (left/right). The main stair hole is ST_MAIN top 11 treads (G1.ceilingHoles = U1.floorHoles).',
      'Surfaces: when zones overlap, the SMALLEST containing zone wins.',
      'Optional fields beyond layout-types.ts: door.mat / door.boardMat, surface.mat, window.lightLeak (visual ground material of exterior zones), room.within (CLOSET is nested in G1), room.note, wall.clipToStair (closet partitions follow ST_MAIN soffit), door.note. Prop params.path = "x,y,z;x,y,z;…" polylines for the rope and bell wires.',
      'Story flags used by doors: passage_unbolted (B10), ada_boards_pried (B08: ada_board_1..3), dress_visit_done (B09 C4).',
      'Deviations from DESIGN sizes: facade 9.35 m wall-to-wall (10.25 m at the eaves) — side-hall plan 3.6 + 5 m cannot reach 11 m without an extra room; U3 is 5 x 4.5 (needs the east window); U1 corridor beside the stairwell is 2.4 m clear; kitchen 5 x 4.6 m clear plus the boxed servants\' stair (5 x 5.5 footprint); back passage 3.6 x 1.6 m.',
    ],
  },
  floors, rooms, walls, doors, stairs, roof, props, hides, lights, surfaces, creakers, roomLinks, aiNodes, aiEdges, cameras, spawns, triggers, atlases,
};

const out = resolve(ROOT, 'src/shared/level-layout.json');
writeFileSync(out, JSON.stringify(deep(layout), null, 1) + '\n');
const matOut = resolve(ROOT, 'src/shared/material-spec.json');
writeFileSync(matOut, JSON.stringify(deep({ version: 1, materials: MATERIALS }), null, 1) + '\n');
console.log(`level-layout.json: ${rooms.length} rooms, ${walls.length} walls, ${doors.length} doors, ${props.length} props, ${lights.length} lights, ${aiNodes.length} AI nodes, ${aiEdges.length} edges`);
console.log(`material-spec.json: ${MATERIALS.length} materials`);
writeFileSync(resolve(ROOT, 'src/shared/road-rc9.json'), JSON.stringify(rcDefinition(), null, 1) + '\n');
console.log('road-rc9.json: County Road 9 corridor definition');

// The voice script lives in its own module; regenerate it too so one command rebuilds all three shared JSON files.
await import('./build-voices.mjs');
