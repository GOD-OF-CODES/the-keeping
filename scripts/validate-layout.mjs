#!/usr/bin/env node
// Validates src/shared/level-layout.json (or --layout=<file>) against src/shared/layout-types.ts (+ material-spec.json, voice-script.json)
// and renders plan drawings docs/layout-{ground,upper,exterior}.svg (+ .png via macOS qlmanage when available).
// Plain Node, no dependencies.  Usage: node scripts/validate-layout.mjs [--no-render] [--no-png] [--layout=<file>]
// Exit code 1 on any error. Warnings do not fail.
//
// NOTE: JSON imports widen string-literal unions to `string` under tsc, so the enum lists below are copied from the
// .ts schema files and must be kept in sync with them by hand.

import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const layoutArg = process.argv.find((x) => x.startsWith('--layout='));
const L = JSON.parse(readFileSync(layoutArg ? resolve(layoutArg.slice(9)) : resolve(ROOT, 'src/shared/level-layout.json'), 'utf8'));
const M = JSON.parse(readFileSync(resolve(ROOT, 'src/shared/material-spec.json'), 'utf8'));
const voicePath = resolve(ROOT, 'src/shared/voice-script.json');
const V = existsSync(voicePath) ? JSON.parse(readFileSync(voicePath, 'utf8')) : null;

// ---------------------------------------------------------------- enums (copied from the .ts schemas)
// layout-types.ts
const FLOOR_IDS = ['exterior', 'ground', 'upper', 'car'];
const ACOUSTIC = ['runner', 'bare_wood', 'porch_wood', 'stair_wood', 'tile', 'linoleum', 'gravel', 'mud', 'asphalt', 'grass', 'carpet', 'car'];
const ROOM_KIND = ['interior', 'exterior', 'set'];
const MILESTONE = ['M1', 'M2'];
const OPENING_KIND = ['door', 'window', 'arch', 'passthrough'];
const WINDOW_STATE = ['nailed', 'shuttered', 'nailed_shuttered', 'clear'];
const DOOR_STYLE = ['front', 'panel', 'boarded', 'passage_bolted', 'closet', 'wardrobe_back'];
const DOOR_INITIAL = ['closed', 'ajar', 'open', 'locked', 'bolted', 'boarded'];
const DIRS = ['N', 'S', 'E', 'W'];
const BALUSTRADE = ['left', 'right', 'both', 'none'];
const HIDE_KIND = ['armoire', 'wardrobe', 'closet'];
const LIGHT_ROLE = ['candle', 'lamp', 'lantern', 'moon', 'sky', 'lightning', 'headlight', 'dashboard', 'flame', 'other'];
const LIGHT_TYPE = ['point', 'spot', 'area', 'sun'];
const LIGHT_MODE = ['bake', 'flash', 'runtime', 'bake_flicker'];
const LINK_VIA = ['door', 'arch', 'stairwell', 'floor', 'grate', 'wall'];
const AI_TAGS = ['vigil', 'look', 'patrol', 'door', 'stair', 'hide_check', 'lure', 'anchor', 'window'];
const EDGE_KIND = ['walk', 'door', 'stair'];
const ATLAS_RES = [1024, 2048, 4096];
// material-types.ts
const MAT_FAMILY = ['wood_floor', 'wood_bare', 'wood_painted', 'clapboard', 'porch_boards', 'wallpaper', 'plaster', 'ceiling_plaster', 'trim_paint',
  'rug', 'fabric', 'crepe', 'burlap', 'rubber', 'leather', 'flannel', 'nightgown', 'shingles', 'brick', 'stone', 'gravel', 'asphalt', 'mud', 'grass', 'bark',
  'rust', 'cast_iron', 'enamel', 'tile', 'glass', 'chrome', 'car_paint', 'car_interior', 'wax', 'paper', 'skin', 'hair', 'metal_brass', 'rope', 'zinc'];
const MAT_SOURCE = ['generated', 'baked_unique', 'constant'];
// voice-types.ts
const SPEAKERS = ['driver', 'harlan', 'ada', 'traveler2'];
const CHAINS = ['in_head', 'whisper_in_head', 'sack', 'through_floor', 'revenant', 'memory', 'clean'];
const LINE_KIND = ['line', 'vocal', 'reading'];

// ---------------------------------------------------------------- reporting
const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);
const EPS = 1e-3;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isP = (v, n) => Array.isArray(v) && v.length === n && v.every(isNum);
const isRect = (r) => isP(r, 4) && r[0] < r[2] && r[1] < r[3];
const inRect = (r, x, y, tol = EPS) => x >= r[0] - tol && x <= r[2] + tol && y >= r[1] - tol && y <= r[3] + tol;
const rectInRect = (inner, outer, tol = EPS) => inRect(outer, inner[0], inner[1], tol) && inRect(outer, inner[2], inner[3], tol);
const overlap = (a, b) => a[0] < b[2] - EPS && b[0] < a[2] - EPS && a[1] < b[3] - EPS && b[1] < a[3] - EPS;
function need(obj, where, spec) {
  for (const [k, t] of Object.entries(spec)) {
    const v = obj[k];
    const opt = t.endsWith('?');
    const tt = opt ? t.slice(0, -1) : t;
    if (v === undefined) { if (!opt) err(`${where}: missing field '${k}'`); continue; }
    const ok = tt === 'num' ? isNum(v) : tt === 'str' ? typeof v === 'string' && v.length > 0 : tt === 'bool' ? typeof v === 'boolean'
      : tt === 'p2' ? isP(v, 2) : tt === 'p3' ? isP(v, 3) : tt === 'rect' ? isRect(v) : tt === 'arr' ? Array.isArray(v) : tt === 'obj' ? v && typeof v === 'object' : true;
    if (!ok) err(`${where}: field '${k}' has wrong type (expected ${tt}): ${JSON.stringify(v)}`);
  }
}
const oneOf = (v, list, where) => { if (!list.includes(v)) err(`${where}: '${v}' not one of ${list.join('|')}`); };
function unique(list, what) {
  const seen = new Set();
  for (const x of list) { if (seen.has(x.id)) err(`duplicate ${what} id '${x.id}'`); seen.add(x.id); }
  return new Map(list.map((x) => [x.id, x]));
}

// ---------------------------------------------------------------- top level
if (L.version !== 1) err('version must be 1');
for (const k of ['meta', 'floors', 'rooms', 'walls', 'doors', 'stairs', 'roof', 'props', 'hides', 'lights', 'surfaces', 'creakers', 'roomLinks', 'aiNodes', 'aiEdges', 'cameras', 'spawns', 'triggers', 'atlases']) {
  if (L[k] === undefined) err(`missing top-level '${k}'`);
}
need(L.meta, 'meta', { title: 'str', date: 'str', notes: 'arr' });

// ---------------------------------------------------------------- materials
const mats = unique(M.materials ?? [], 'material');
if (M.version !== 1) err('material-spec version must be 1');
for (const m of M.materials) {
  const w = `material ${m.id}`;
  need(m, w, { id: 'str', family: 'str', params: 'obj', avgAlbedo: 'p3', roughness: 'num', metalness: 'num', tileMetres: 'num', hero: 'bool', wetness: 'num', source: 'str', notes: 'str?' });
  oneOf(m.family, MAT_FAMILY, w);
  oneOf(m.source, MAT_SOURCE, w);
  if (m.avgAlbedo?.some((c) => c < 0.005 || c > 0.9)) warn(`${w}: avgAlbedo component outside plausible 0.005..0.9 (${m.avgAlbedo})`);
  if (m.avgAlbedo?.some((c) => c < 0 || c > 1)) err(`${w}: avgAlbedo outside 0..1`);
  for (const k of ['roughness', 'metalness', 'wetness']) if (!(m[k] >= 0 && m[k] <= 1)) err(`${w}: ${k} outside 0..1`);
  if (!(m.tileMetres > 0)) err(`${w}: tileMetres must be > 0`);
  for (const [k, v] of Object.entries(m.params)) {
    if (Array.isArray(v) && v.length === 3 && /color|colour|base|ground|figure|paint|tone|mortar|field|border|stripe|vinyl|silt|secondary|under|bare|ink|grout|chip/i.test(k) && !k.endsWith('_srgb')) {
      if (v.some((c) => c < 0 || c > 1)) err(`${w}: param ${k} colour outside 0..1`);
    }
  }
}
const usedMats = new Set();
function mat(id, where, allowNone = false) {
  if (allowNone && id === 'none') return;
  usedMats.add(id);
  if (!mats.has(id)) err(`${where}: unknown material '${id}'`);
}

// ---------------------------------------------------------------- floors & rooms
const floors = unique(L.floors, 'floor');
for (const f of L.floors) { need(f, `floor ${f.id}`, { id: 'str', elevation: 'num', slabThickness: 'num' }); oneOf(f.id, FLOOR_IDS, `floor ${f.id}`); }
const rooms = unique(L.rooms, 'room');
const elev = (roomId) => floors.get(rooms.get(roomId)?.floor)?.elevation ?? 0;
for (const r of L.rooms) {
  const w = `room ${r.id}`;
  need(r, w, { id: 'str', name: 'str', floor: 'str', kind: 'str', rect: 'rect', ceiling: 'num', floorMat: 'str', wallMat: 'str', ceilingMat: 'str', trimMat: 'str',
    floorHoles: 'arr', ceilingHoles: 'arr', reverb: 'obj', visibleRooms: 'arr', atlas: 'str', playable: 'bool', milestone: 'str', wainscot: 'obj?', within: 'str?' });
  oneOf(r.floor, FLOOR_IDS, w); oneOf(r.kind, ROOM_KIND, w); oneOf(r.milestone, MILESTONE, w);
  if (!floors.has(r.floor)) err(`${w}: floor '${r.floor}' not defined`);
  const noCeil = r.kind !== 'interior';
  mat(r.floorMat, w); mat(r.wallMat, w); mat(r.ceilingMat, w, noCeil); mat(r.trimMat, w, noCeil);
  if (r.wainscot) { need(r.wainscot, `${w}.wainscot`, { height: 'num', mat: 'str' }); mat(r.wainscot.mat, `${w}.wainscot`); if (r.wainscot.height >= r.ceiling) err(`${w}: wainscot above ceiling`); }
  if (r.kind === 'interior' && !(r.ceiling >= 1.8)) err(`${w}: interior ceiling ${r.ceiling} too low`);
  for (const h of [...r.floorHoles, ...r.ceilingHoles]) { if (!isRect(h)) err(`${w}: bad hole ${JSON.stringify(h)}`); else if (!rectInRect(h, r.rect)) err(`${w}: hole ${h} outside room rect`); }
  need(r.reverb, `${w}.reverb`, { size: 'num', damping: 'num', wet: 'num' });
  if (!(r.reverb.size > 0 && r.reverb.damping >= 0 && r.reverb.damping <= 1 && r.reverb.wet >= 0 && r.reverb.wet <= 1)) err(`${w}: reverb out of range`);
  if (!r.visibleRooms.includes(r.id)) err(`${w}: visibleRooms must include itself`);
  for (const v of r.visibleRooms) if (!rooms.has(v)) err(`${w}: visibleRooms references unknown room '${v}'`);
  if (r.within) {
    const p = rooms.get(r.within);
    if (!p) err(`${w}: within unknown room '${r.within}'`);
    else { if (p.floor !== r.floor) err(`${w}: within room on another floor`); if (!rectInRect(r.rect, p.rect)) err(`${w}: not contained in '${r.within}'`); }
  }
}
// no overlapping rooms on a floor (except declared nesting)
for (let i = 0; i < L.rooms.length; i++) for (let j = i + 1; j < L.rooms.length; j++) {
  const a = L.rooms[i], b = L.rooms[j];
  if (a.floor !== b.floor || !overlap(a.rect, b.rect)) continue;
  if (a.within === b.id || b.within === a.id) continue;
  err(`rooms ${a.id} and ${b.id} overlap on floor ${a.floor}`);
}
/** Innermost room containing (x,y) on a floor, also accepting rooms of other floors whose vertical extent contains z. */
function roomAt(x, y, floor, z) {
  const hits = L.rooms.filter((r) => {
    if (!inRect(r.rect, x, y, 0)) return false;
    if (r.floor === floor) return true;
    if (z === undefined || r.kind !== 'interior') return false;
    const e = floors.get(r.floor).elevation;
    return z > e + 0.05 && z < e + r.ceiling;
  });
  if (!hits.length) return null;
  hits.sort((a, b) => (a.rect[2] - a.rect[0]) * (a.rect[3] - a.rect[1]) - (b.rect[2] - b.rect[0]) * (b.rect[3] - b.rect[1]));
  return hits[0].id;
}

// ---------------------------------------------------------------- atlases
const atlases = unique(L.atlases, 'atlas');
const atlasOf = new Map();
for (const a of L.atlases) {
  need(a, `atlas ${a.id}`, { id: 'str', rooms: 'arr', maxResolution: 'num', flash: 'bool' });
  oneOf(a.maxResolution, ATLAS_RES, `atlas ${a.id}`);
  if (!a.rooms.length) err(`atlas ${a.id}: no rooms`);
  for (const r of a.rooms) {
    if (!rooms.has(r)) err(`atlas ${a.id}: unknown room '${r}'`);
    if (atlasOf.has(r)) err(`room ${r} is in atlases ${atlasOf.get(r)} and ${a.id}`);
    atlasOf.set(r, a.id);
  }
}
for (const r of L.rooms) {
  if (!atlases.has(r.atlas)) err(`room ${r.id}: unknown atlas '${r.atlas}'`);
  else if (atlasOf.get(r.id) !== r.atlas) err(`room ${r.id}: atlas '${r.atlas}' does not list it`);
}
if (L.atlases.length > 8) warn(`${L.atlases.length} atlases (> 8): each is one Blender bake process`);

// ---------------------------------------------------------------- walls & openings
const walls = unique(L.walls, 'wall');
const openings = new Map();
for (const wl of L.walls) {
  const w = `wall ${wl.id}`;
  need(wl, w, { id: 'str', floor: 'str', a: 'p2', b: 'p2', base: 'num', height: 'num', thickness: 'num', left: 'str', right: 'str', leftMat: 'str', rightMat: 'str', openings: 'arr' });
  oneOf(wl.floor, FLOOR_IDS, w);
  if (wl.facadeDetail && !['hero', 'fog'].includes(wl.facadeDetail)) err(`${w}: bad facadeDetail`);
  mat(wl.leftMat, `${w}.leftMat`); mat(wl.rightMat, `${w}.rightMat`);
  const len = Math.hypot(wl.b[0] - wl.a[0], wl.b[1] - wl.a[1]);
  if (len < 0.05) err(`${w}: zero length`);
  if (Math.abs(wl.base - floors.get(wl.floor).elevation) > EPS) warn(`${w}: base ${wl.base} != floor elevation`);
  if (!(wl.thickness > 0.02 && wl.thickness < 0.8)) err(`${w}: thickness ${wl.thickness}`);
  for (const side of ['left', 'right']) {
    const ref = wl[side];
    if (ref !== 'exterior' && ref !== 'void' && !rooms.has(ref)) { err(`${w}: ${side} references unknown room '${ref}'`); continue; }
    // sample 0.2 m to that side of the midpoint (and of each quarter point)
    const dx = (wl.b[0] - wl.a[0]) / len, dy = (wl.b[1] - wl.a[1]) / len;
    const nx = side === 'left' ? -dy : dy, ny = side === 'left' ? dx : -dx;
    const off = wl.thickness / 2 + 0.12;
    for (const tq of [0.25, 0.5, 0.75]) {
      const x = wl.a[0] + dx * len * tq + nx * off, y = wl.a[1] + dy * len * tq + ny * off;
      const got = roomAt(x, y, wl.floor, wl.base + 0.1);
      const expect = ref === 'exterior' || ref === 'void' ? null : ref;
      if (got !== expect && !(expect && rooms.get(expect)?.within === got) && !(got && rooms.get(got)?.within === expect)) {
        err(`${w}: ${side} side at t=${tq} (${x.toFixed(2)},${y.toFixed(2)}) is in '${got ?? 'nothing'}', declared '${ref}'`);
      }
    }
    if (ref !== 'exterior' && ref !== 'void') {
      // the wall face must touch the room rect (within 5 cm)
      const r = rooms.get(ref).rect;
      const mx = (wl.a[0] + wl.b[0]) / 2 + nx * (wl.thickness / 2), my = (wl.a[1] + wl.b[1]) / 2 + ny * (wl.thickness / 2);
      if (!inRect(r, mx, my, 0.06)) err(`${w}: ${side} face (${mx.toFixed(2)},${my.toFixed(2)}) does not touch room ${ref} rect`);
    }
  }
  const spans = [];
  for (const o of wl.openings) {
    const ow = `${w} opening ${o.id}`;
    need(o, ow, { id: 'str', kind: 'str', offset: 'num', width: 'num', height: 'num', sill: 'num', doorId: 'str?', window: 'obj?' });
    oneOf(o.kind, OPENING_KIND, ow);
    if (openings.has(o.id)) err(`duplicate opening id '${o.id}'`);
    openings.set(o.id, { ...o, wall: wl });
    if (o.offset - o.width / 2 < -EPS || o.offset + o.width / 2 > len + EPS) err(`${ow}: extends beyond wall (offset ${o.offset}, width ${o.width}, length ${len.toFixed(3)})`);
    if (o.sill < 0 || o.sill + o.height > wl.height + EPS) err(`${ow}: vertical extent ${o.sill}..${o.sill + o.height} outside wall height ${wl.height}`);
    if (o.kind === 'door') { if (!o.doorId) err(`${ow}: door opening without doorId`); if (o.sill !== 0) err(`${ow}: door sill must be 0`); }
    else if (o.doorId) err(`${ow}: only door openings may have doorId`);
    if (o.kind === 'window') {
      if (o.window?.lightLeak !== undefined && typeof o.window.lightLeak !== 'boolean') err(`${ow}: window.lightLeak must be boolean`);
      if (!o.window) err(`${ow}: window without window{}`);
      else { need(o.window, `${ow}.window`, { state: 'str', sashes: 'num', broken: 'bool', skyPortal: 'bool' }); oneOf(o.window.state, WINDOW_STATE, ow); if (![1, 2].includes(o.window.sashes)) err(`${ow}: sashes must be 1|2`);
        if (wl.left !== 'exterior' && wl.right !== 'exterior') warn(`${ow}: window in an interior wall`);
        if (o.window.state === 'clear') warn(`${ow}: clear window contradicts "every sash nailed"`); }
    } else if (o.window) err(`${ow}: only windows may have window{}`);
    // margin from wall ends for doors/windows
    if ((o.kind === 'door' || o.kind === 'window') && (o.offset - o.width / 2 < 0.05 || o.offset + o.width / 2 > len - 0.05)) warn(`${ow}: less than 5 cm from the wall end`);
    for (const s of spans) {
      const hOverlap = o.offset - o.width / 2 < s.offset + s.width / 2 - EPS && s.offset - s.width / 2 < o.offset + o.width / 2 - EPS;
      const vOverlap = o.sill < s.sill + s.height - EPS && s.sill < o.sill + o.height - EPS;
      if (hOverlap && vOverlap) err(`${ow}: overlaps opening ${s.id}`);
    }
    spans.push(o);
  }
}

// ---------------------------------------------------------------- doors (1:1 with door openings)
const doors = unique(L.doors, 'door');
const doorOpenings = [...openings.values()].filter((o) => o.kind === 'door');
const flags = new Set();
for (const d of L.doors) {
  const w = `door ${d.id}`;
  need(d, w, { id: 'str', openingId: 'str', style: 'str', hinge: 'str', swingInto: 'str', initial: 'str', unlockFlag: 'str?', interactive: 'bool' });
  oneOf(d.style, DOOR_STYLE, w); oneOf(d.initial, DOOR_INITIAL, w); oneOf(d.hinge, ['left', 'right'], w);
  const o = openings.get(d.openingId);
  if (!o) { err(`${w}: unknown opening '${d.openingId}'`); continue; }
  if (o.kind !== 'door') err(`${w}: opening ${o.id} is a ${o.kind}`);
  if (o.doorId !== d.id) err(`${w}: opening ${o.id} points at door '${o.doorId}'`);
  if (![o.wall.left, o.wall.right].includes(d.swingInto)) err(`${w}: swingInto '${d.swingInto}' is not a side of wall ${o.wall.id}`);
  if (['locked', 'bolted', 'boarded'].includes(d.initial) && !d.unlockFlag && d.style !== 'front') warn(`${w}: ${d.initial} with no unlockFlag`);
  if (d.unlockFlag) flags.add(d.unlockFlag);
  if (d.style === 'boarded' && d.initial !== 'boarded') err(`${w}: boarded style must start boarded`);
  if (d.mat) mat(d.mat, `${w}.mat`);
  if (d.boardMat) mat(d.boardMat, `${w}.boardMat`);
}
for (const o of doorOpenings) if (!doors.has(o.doorId)) err(`opening ${o.id}: doorId '${o.doorId}' has no door`);
const extRooms = L.rooms.filter((r) => r.kind === 'exterior').map((r) => r.id);
const doorRooms = (id) => { const d = doors.get(id); const o = d && openings.get(d.openingId); return o ? [o.wall.left, o.wall.right].flatMap((s) => (s === 'exterior' ? extRooms : [s])) : []; };

// ---------------------------------------------------------------- stairs
const stairs = unique(L.stairs, 'stair');
const DIRV = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] };
const turn = (d, t) => (t === 'left' ? [-d[1], d[0]] : [d[1], -d[0]]);
const rectFrom = (cx, cy, d, len, width) => {
  // rect spanning from centre point along d for len, width across
  const x1 = cx + d[0] * len, y1 = cy + d[1] * len;
  const hx = Math.abs(d[1]) * width / 2, hy = Math.abs(d[0]) * width / 2;
  return [Math.min(cx, x1) - hx, Math.min(cy, y1) - hy, Math.max(cx, x1) + hx, Math.max(cy, y1) + hy];
};
/** Tread geometry: [{rect, step (1-based), z (top of tread above 'from' floor)}], arrival point. */
function stairGeometry(st) {
  const out = [];
  let d = DIRV[st.direction];
  let [x, y] = st.start;
  const treads = st.risers - 1;
  let step = 1;
  const addStraight = (count) => {
    for (let i = 0; i < count; i++, step++) {
      out.push({ rect: rectFrom(x, y, d, st.treadDepth, st.width), step, z: step * st.riserHeight });
      x += d[0] * st.treadDepth; y += d[1] * st.treadDepth;
    }
  };
  if (st.winder) {
    addStraight(st.winder.atStep - 1);
    const sq = rectFrom(x, y, d, st.width, st.width);
    for (let k = 0; k < 3; k++, step++) out.push({ rect: sq, step, z: step * st.riserHeight, winder: true });
    const cx = x + d[0] * st.width / 2, cy = y + d[1] * st.width / 2;
    d = turn(d, st.winder.turn);
    x = cx + d[0] * st.width / 2; y = cy + d[1] * st.width / 2;
    addStraight(treads - (st.winder.atStep - 1) - 3);
  } else addStraight(treads);
  return { treads: out, top: [x + d[0] * 0.2, y + d[1] * 0.2], topDir: d };
}
const stairGeo = new Map();
for (const st of L.stairs) {
  const w = `stair ${st.id}`;
  need(st, w, { id: 'str', from: 'str', to: 'str', start: 'p2', direction: 'str', width: 'num', risers: 'num', riserHeight: 'num', treadDepth: 'num', balustrade: 'str', enclosed: 'bool', creakySteps: 'arr', rooms: 'arr', winder: 'obj?' });
  oneOf(st.direction, DIRS, w); oneOf(st.balustrade, BALUSTRADE, w);
  const e0 = floors.get(st.from)?.elevation, e1 = floors.get(st.to)?.elevation;
  if (e0 === undefined || e1 === undefined) { err(`${w}: unknown floors`); continue; }
  if (Math.abs(st.risers * st.riserHeight - (e1 - e0)) > 0.005) err(`${w}: risers*riserHeight = ${(st.risers * st.riserHeight).toFixed(3)} != ${(e1 - e0).toFixed(3)}`);
  if (st.riserHeight > 0.26 || st.riserHeight < 0.15) warn(`${w}: riser ${st.riserHeight} unusual`);
  const rule = 2 * st.riserHeight + st.treadDepth;
  if (rule < 0.55 || rule > 0.78) warn(`${w}: 2R+G = ${rule.toFixed(2)} outside 0.55..0.78`);
  for (const c of st.creakySteps) if (!(Number.isInteger(c) && c >= 1 && c <= st.risers)) err(`${w}: creaky step ${c} out of range`);
  if (st.winder) { need(st.winder, `${w}.winder`, { atStep: 'num', turn: 'str' }); oneOf(st.winder.turn, ['left', 'right'], w); }
  for (const r of st.rooms) if (!rooms.has(r)) err(`${w}: unknown room '${r}'`);
  const g = stairGeometry(st);
  stairGeo.set(st.id, g);
  const fromRooms = L.rooms.filter((r) => r.floor === st.from);
  const toRooms = L.rooms.filter((r) => r.floor === st.to);
  const stairRoomRects = st.rooms.map((id) => rooms.get(id)).filter(Boolean).filter((r) => r.floor === st.from);
  for (const tr of g.treads) {
    const [x0, y0, x1, y1] = tr.rect;
    for (const [px, py] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      if (!stairRoomRects.some((r) => inRect(r.rect, px, py, 0.02))) { err(`${w}: tread ${tr.step} corner (${px.toFixed(2)},${py.toFixed(2)}) outside its ${st.from} rooms (${st.rooms.join(',')})`); break; }
    }
    // headroom: where the tread is within 2.0 m of the upper slab underside, the upper floor must be open above it
    const slabUnder = e1 - floors.get(st.to).slabThickness;
    const head = slabUnder - (e0 + tr.z);
    if (head < 2.0) {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const coveredBy = toRooms.find((r) => inRect(r.rect, cx, cy, -0.01) && !r.floorHoles.some((h) => inRect(h, cx, cy, 0.01)));
      if (coveredBy) err(`${w}: tread ${tr.step} has ${head.toFixed(2)} m headroom under ${coveredBy.id}'s floor (needs a floorHole)`);
      const lower = fromRooms.find((r) => r.kind === 'interior' && inRect(r.rect, cx, cy, -0.01) && r.ceiling < (e1 - e0) - 0.01 && !r.ceilingHoles.some((h) => inRect(h, cx, cy, 0.01)) && !r.within);
      if (lower) err(`${w}: tread ${tr.step} passes through ${lower.id}'s ceiling (needs a ceilingHole)`);
    }
  }
  const arrive = roomAt(g.top[0], g.top[1], st.to);
  if (!arrive || !st.rooms.includes(arrive)) err(`${w}: top arrival (${g.top.map((v) => v.toFixed(2))}) lands in '${arrive}', not in its rooms`);
}
// floor holes above must match ceiling holes below (same rect) where rooms stack
for (const up of L.rooms.filter((r) => r.floor === 'upper')) for (const h of up.floorHoles) {
  const below = L.rooms.filter((r) => r.floor === 'ground' && overlap(r.rect, h) && !r.within);
  for (const b of below) if (!b.ceilingHoles.some((c) => c.every((v, i) => Math.abs(v - h[i]) < EPS))) err(`floor hole ${h} in ${up.id} has no matching ceilingHole in ${b.id}`);
}

// ---------------------------------------------------------------- roof
need(L.roof, 'roof', { kind: 'str', ridgeAxis: 'str', eaveZ: 'num', ridgeZ: 'num', overhang: 'num', mat: 'str', chimney: 'obj?' });
mat(L.roof.mat, 'roof');
if (L.roof.ridgeZ <= L.roof.eaveZ) err('roof: ridge below eave');
const upperExt = L.walls.filter((w) => w.floor === 'upper' && (w.left === 'exterior' || w.right === 'exterior'));
for (const w of upperExt) if (Math.abs(w.base + w.height - L.roof.eaveZ) > 0.02) err(`wall ${w.id}: top ${(w.base + w.height).toFixed(2)} != eaveZ ${L.roof.eaveZ}`);
if (L.roof.chimney) { need(L.roof.chimney, 'roof.chimney', { pos: 'p2', size: 'p2', top: 'num', mat: 'str' }); mat(L.roof.chimney.mat, 'roof.chimney'); if (L.roof.chimney.top <= L.roof.eaveZ) err('chimney top below eave'); }

// ---------------------------------------------------------------- generic "inside its room"
function inRoom(where, roomId, pos, { tol = 0.05, zCheck = true } = {}) {
  const r = rooms.get(roomId);
  if (!r) { err(`${where}: unknown room '${roomId}'`); return; }
  if (!inRect(r.rect, pos[0], pos[1], tol)) err(`${where}: (${pos[0]},${pos[1]}) outside room ${roomId} ${JSON.stringify(r.rect)}`);
  if (zCheck && pos.length > 2 && r.kind === 'interior') {
    const e = floors.get(r.floor).elevation;
    if (pos[2] < e - 0.05 || pos[2] > e + r.ceiling + 0.05) err(`${where}: z ${pos[2]} outside ${roomId} ${e}..${(e + r.ceiling).toFixed(2)}`);
  }
}

// ---------------------------------------------------------------- props
const props = unique(L.props, 'prop');
const propTypes = new Map();
for (const p of L.props) {
  const w = `prop ${p.id}`;
  need(p, w, { id: 'str', type: 'str', room: 'str', pos: 'p3', yaw: 'num', params: 'obj?', lighting: 'str', collider: 'str', interaction: 'str?', milestone: 'str' });
  oneOf(p.lighting, ['static', 'dynamic'], w); oneOf(p.collider, ['box', 'mesh', 'none'], w); oneOf(p.milestone, MILESTONE, w);
  if (!/^[a-z][a-z0-9_]*$/.test(p.type)) err(`${w}: type id '${p.type}' must be snake_case`);
  inRoom(w, p.room, p.pos);
  if (p.room && rooms.get(p.room)?.milestone === 'M2' && p.milestone === 'M1') warn(`${w}: M1 prop in an M2 room`);
  propTypes.set(p.type, (propTypes.get(p.type) ?? 0) + 1);
  for (const [k, v] of Object.entries(p.params ?? {})) {
    if (typeof v === 'string' && (/mat$/i.test(k) || k === 'paint' || k === 'interior' || k === 'trim' || k === 'altTrim')) mat(v, `${w}.params.${k}`);
    if (k === 'path') {
      const pts = String(v).split(';').map((q) => q.split(',').map(Number));
      if (pts.length < 2 || pts.some((q) => q.length !== 3 || q.some((c) => !Number.isFinite(c)))) err(`${w}: bad path`);
    }
    if (['from', 'to'].includes(k) && typeof v === 'string' && !L.props.some((q) => q.id === v)) err(`${w}: params.${k} references unknown prop '${v}'`);
    if (k === 'looseBackDoor' && !doors.has(v)) err(`${w}: looseBackDoor '${v}' unknown`);
  }
}

// ---------------------------------------------------------------- hides
const hides = unique(L.hides, 'hide');
for (const h of L.hides) {
  const w = `hide ${h.id}`;
  need(h, w, { id: 'str', propId: 'str', room: 'str', kind: 'str', entry: 'p3', eye: 'p3', eyeYaw: 'num', unfailable: 'bool?' });
  oneOf(h.kind, HIDE_KIND, w);
  const p = props.get(h.propId);
  if (!p) err(`${w}: unknown prop '${h.propId}'`); else if (p.room !== h.room) err(`${w}: prop is in ${p.room}, hide says ${h.room}`);
  inRoom(`${w}.eye`, h.room, h.eye);
  const er = roomAt(h.entry[0], h.entry[1], rooms.get(h.room)?.floor);
  if (!er) err(`${w}: entry point is in no room`);
  if (Math.hypot(h.entry[0] - h.eye[0], h.entry[1] - h.eye[1]) > 1.6) warn(`${w}: entry is far from the eye`);
}

// ---------------------------------------------------------------- lights
const lights = unique(L.lights, 'light');
for (const l of L.lights) {
  const w = `light ${l.id}`;
  need(l, w, { id: 'str', room: 'str', role: 'str', type: 'str', pos: 'p3', target: 'p3?', watts: 'num', kelvin: 'num', radius: 'num', mode: 'str' });
  oneOf(l.role, LIGHT_ROLE, w); oneOf(l.type, LIGHT_TYPE, w); oneOf(l.mode, LIGHT_MODE, w);
  inRoom(w, l.room, l.pos, { zCheck: l.type !== 'sun', tol: l.type === 'sun' || l.type === 'area' ? 1e9 : 0.05 });
  if (!(l.watts > 0)) err(`${w}: watts must be > 0`);
  if (!(l.kelvin >= 1000 && l.kelvin <= 12000)) err(`${w}: kelvin out of range`);
  if (l.role === 'lightning' && l.mode !== 'flash') err(`${w}: lightning must be mode flash`);
  if (l.mode === 'flash' && l.role !== 'lightning') err(`${w}: only lightning uses mode flash`);
  if ((l.type === 'spot' || l.type === 'sun' || l.type === 'area') && !l.target) err(`${w}: ${l.type} needs a target`);
  if (l.role === 'candle' && (l.watts < 3 || l.watts > 30)) warn(`${w}: candle watts ${l.watts} (expected ~6..20)`);
  if (l.type === 'sun' && l.watts > 20) warn(`${w}: sun strength ${l.watts} W/m^2 is very high for a night scene`);
}
// every skyPortal window gets a lightning light nearby
for (const o of openings.values()) {
  if (!o.window?.skyPortal) continue;
  const wl = o.wall, len = Math.hypot(wl.b[0] - wl.a[0], wl.b[1] - wl.a[1]);
  const cx = wl.a[0] + (wl.b[0] - wl.a[0]) * o.offset / len, cy = wl.a[1] + (wl.b[1] - wl.a[1]) * o.offset / len;
  if (!L.lights.some((l) => l.role === 'lightning' && l.type !== 'sun' && Math.hypot(l.pos[0] - cx, l.pos[1] - cy) < 2)) err(`window ${o.id}: skyPortal without a lightning light within 2 m`);
}
const flashRooms = new Set(L.atlases.filter((a) => a.flash).flatMap((a) => a.rooms));
for (const o of openings.values()) if (o.window?.skyPortal) { const side = [o.wall.left, o.wall.right].find((s) => rooms.has(s)); if (side && !flashRooms.has(side)) warn(`window ${o.id}: skyPortal into ${side} whose atlas has flash:false`); }

// ---------------------------------------------------------------- surfaces, creakers
for (const [i, s] of L.surfaces.entries()) {
  const w = `surface #${i} (${s.room})`;
  need(s, w, { room: 'str', rect: 'rect', surface: 'str' });
  oneOf(s.surface, ACOUSTIC, w);
  if (s.mat) mat(s.mat, `${w}.mat`);
  const r = rooms.get(s.room);
  if (!r) err(`${w}: unknown room`); else if (!rectInRect(s.rect, r.rect)) err(`${w}: rect outside room`);
}
for (const r of L.rooms) if (!L.surfaces.some((s) => s.room === r.id && rectInRect(r.rect, s.rect))) err(`room ${r.id}: no acoustic surface zone covering the whole room`);
unique(L.creakers, 'creaker');
for (const c of L.creakers) { need(c, `creaker ${c.id}`, { id: 'str', room: 'str', pos: 'p2', radius: 'num' }); inRoom(`creaker ${c.id}`, c.room, c.pos); }

// ---------------------------------------------------------------- room links
const linkAdj = new Map(L.rooms.map((r) => [r.id, new Set()]));
for (const [i, k] of L.roomLinks.entries()) {
  const w = `roomLink #${i} ${k.a}-${k.b}`;
  need(k, w, { a: 'str', b: 'str', via: 'str', doorId: 'str?', attenuation: 'num', openAttenuation: 'num?' });
  oneOf(k.via, LINK_VIA, w);
  if (!rooms.has(k.a) || !rooms.has(k.b)) { err(`${w}: unknown room`); continue; }
  if (k.a === k.b) err(`${w}: self link`);
  if (!(k.attenuation > 0 && k.attenuation <= 1)) err(`${w}: attenuation out of (0,1]`);
  if (k.via === 'door') {
    if (!k.doorId || !doors.has(k.doorId)) err(`${w}: door link needs a valid doorId`);
    else { const dr = doorRooms(k.doorId); if (!(dr.includes(k.a) && dr.includes(k.b))) err(`${w}: door ${k.doorId} joins ${dr.join('/')}`); }
    if (k.openAttenuation === undefined) err(`${w}: door link needs openAttenuation`);
    if (Math.abs(k.attenuation - 0.5) > EPS && !['closet', 'wardrobe_back'].includes(doors.get(k.doorId)?.style)) warn(`${w}: closed-door attenuation ${k.attenuation} != 0.5`);
  } else if (k.doorId) err(`${w}: doorId on a non-door link`);
  if (k.via === 'floor' && Math.abs(k.attenuation - 0.4) > EPS) warn(`${w}: floor attenuation ${k.attenuation} != 0.4`);
  if (k.via === 'stairwell' && k.attenuation !== 1) warn(`${w}: open stairwell attenuation should be 1`);
  linkAdj.get(k.a).add(k.b); linkAdj.get(k.b).add(k.a);
}
for (const d of L.doors) if (!L.roomLinks.some((k) => k.doorId === d.id)) err(`door ${d.id}: no roomLink`);
{ // hearing graph connectivity (sets excluded)
  const start = 'G1', seen = new Set([start]), q = [start];
  while (q.length) for (const nb of linkAdj.get(q.shift())) if (!seen.has(nb)) { seen.add(nb); q.push(nb); }
  for (const r of L.rooms) if (r.kind !== 'set' && !seen.has(r.id)) err(`room ${r.id} unreachable in the roomLinks graph`);
}

// ---------------------------------------------------------------- AI
const nodes = unique(L.aiNodes, 'aiNode');
const NO_AI_ROOMS = new Set(['U4', 'U4T', 'CAR', 'EXT1', 'EXT2']);
for (const nd of L.aiNodes) {
  const w = `aiNode ${nd.id}`;
  need(nd, w, { id: 'str', room: 'str', pos: 'p3', tags: 'arr', lookYaw: 'num?' });
  for (const t of nd.tags) oneOf(t, AI_TAGS, w);
  inRoom(w, nd.room, nd.pos);
  const r = rooms.get(nd.room);
  if (r && Math.abs(nd.pos[2] - floors.get(r.floor).elevation) > 0.05) err(`${w}: z must be the floor elevation`);
  if (NO_AI_ROOMS.has(nd.room)) err(`${w}: Ada never enters ${nd.room}`);
  if (nd.tags.includes('look') && nd.lookYaw === undefined) err(`${w}: look node without lookYaw`);
  if (r && r.playable === false) err(`${w}: node in non-playable room ${nd.room}`);
}
const loops = new Map();
const nodeAdj = new Map(L.aiNodes.map((x) => [x.id, []]));
for (const [i, ed] of L.aiEdges.entries()) {
  const w = `aiEdge #${i} ${ed.a}-${ed.b}`;
  need(ed, w, { a: 'str', b: 'str', kind: 'str', doorId: 'str?', stairId: 'str?', loops: 'arr' });
  oneOf(ed.kind, EDGE_KIND, w);
  const A = nodes.get(ed.a), B = nodes.get(ed.b);
  if (!A || !B) { err(`${w}: unknown node`); continue; }
  nodeAdj.get(ed.a).push(ed.b); nodeAdj.get(ed.b).push(ed.a);
  for (const lp of ed.loops) { if (!loops.has(lp)) loops.set(lp, []); loops.get(lp).push(ed); }
  const dist = Math.hypot(A.pos[0] - B.pos[0], A.pos[1] - B.pos[1]);
  if (ed.kind === 'walk') {
    if (A.room !== B.room && !(L.roomLinks.some((k) => k.via === 'arch' && [k.a, k.b].includes(A.room) && [k.a, k.b].includes(B.room)))) err(`${w}: walk edge crosses rooms ${A.room}->${B.room} without an arch`);
    if (ed.doorId || ed.stairId) err(`${w}: walk edge must not carry doorId/stairId`);
    if (dist > 6) warn(`${w}: long walk edge ${dist.toFixed(1)} m`);
    // walk edge must not pass through a floor hole of its room
    const r = rooms.get(A.room);
    for (let k = 1; k < 20; k++) { const x = A.pos[0] + (B.pos[0] - A.pos[0]) * k / 20, y = A.pos[1] + (B.pos[1] - A.pos[1]) * k / 20;
      if (r.floorHoles.some((h) => inRect(h, x, y, -0.05)) && r.id !== 'U2') { err(`${w}: passes over a floor hole`); break; }
      if (!inRect(r.rect, x, y, 0.05) && A.room === B.room) { err(`${w}: leaves room ${r.id}`); break; }
      const onStair = L.stairs.find((st) => st.from === r.floor && stairGeo.get(st.id)?.treads.some((tr) => inRect(tr.rect, x, y, -0.02)));
      if (onStair) { err(`${w}: walk edge crosses stair ${onStair.id} (use a stair edge)`); break; } }
  } else if (ed.kind === 'door') {
    if (!ed.doorId || !doors.has(ed.doorId)) err(`${w}: door edge needs a valid doorId`);
    else { const dr = doorRooms(ed.doorId); if (!(dr.includes(A.room) && dr.includes(B.room)) || A.room === B.room) err(`${w}: door ${ed.doorId} joins ${dr.join('/')}, nodes in ${A.room}/${B.room}`); }
  } else if (ed.kind === 'stair') {
    const st = stairs.get(ed.stairId);
    if (!st) err(`${w}: stair edge needs a valid stairId`);
    else if (!(st.rooms.includes(A.room) && st.rooms.includes(B.room))) err(`${w}: stair ${st.id} does not serve ${A.room}/${B.room}`);
    if (st?.enclosed) err(`${w}: Ada never uses the enclosed servants' stair`);
  }
}
for (const [name, edges] of loops) {
  const ids = new Set(edges.flatMap((e2) => [e2.a, e2.b]));
  if (ids.size < 3) err(`loop '${name}': fewer than 3 nodes`);
  const adj = new Map([...ids].map((id) => [id, []]));
  for (const e2 of edges) { adj.get(e2.a).push(e2.b); adj.get(e2.b).push(e2.a); }
  const first = ids.values().next().value, seen = new Set([first]), q = [first];
  while (q.length) for (const nb of adj.get(q.shift())) if (!seen.has(nb)) { seen.add(nb); q.push(nb); }
  if (seen.size !== ids.size) err(`loop '${name}': not connected (${[...ids].filter((x) => !seen.has(x)).join(',')})`);
  const hasCycle = edges.length >= ids.size; // connected graph with >= V edges contains a cycle
  if (['upper', 'harlan_loop', 'ground_finale'].includes(name) && !hasCycle) err(`loop '${name}': must contain a cycle`);
}
for (const req of ['upper', 'harlan_loop', 'ground_finale', 'lure']) if (!loops.has(req)) err(`missing AI loop '${req}'`);
{ // whole graph connected
  const first = L.aiNodes[0]?.id, seen = new Set([first]), q = [first];
  while (q.length) for (const nb of nodeAdj.get(q.shift())) if (!seen.has(nb)) { seen.add(nb); q.push(nb); }
  for (const nd of L.aiNodes) if (!seen.has(nd.id)) err(`aiNode ${nd.id}: disconnected from the graph`);
}
for (const tag of ['vigil', 'lure', 'anchor', 'hide_check', 'window']) if (!L.aiNodes.some((x) => x.tags.includes(tag))) err(`no AI node tagged '${tag}'`);
for (const h of L.hides) if (!L.aiNodes.some((x) => x.tags.includes('hide_check') && Math.hypot(x.pos[0] - h.entry[0], x.pos[1] - h.entry[1]) < 1.2 && rooms.get(x.room)?.floor === rooms.get(h.room)?.floor)) err(`hide ${h.id}: no hide_check node within 1.2 m of its entry`);
{ const lure = L.aiNodes.find((x) => x.tags.includes('lure')); if (lure && lure.room !== doorRooms('D_PARLOR').find((r) => r !== 'G2')) err('lure node must be on the hall side of the parlor door'); }

// ---------------------------------------------------------------- cameras, spawns, triggers
unique(L.cameras, 'camera');
for (const c of L.cameras) {
  need(c, `camera ${c.id}`, { id: 'str', pos: 'p3', target: 'p3', fovDeg: 'num', note: 'str' });
  if (!(c.fovDeg > 10 && c.fovDeg < 120)) err(`camera ${c.id}: fov`);
}
for (const req of ['parlor_threshold', 'parlor_grate', 'porch_approach']) if (!L.cameras.some((c) => c.id === req)) err(`missing camera '${req}'`);
unique(L.spawns, 'spawn');
for (const s of L.spawns) {
  need(s, `spawn ${s.id}`, { id: 'str', room: 'str', pos: 'p3', yaw: 'num', pitch: 'num', note: 'str' });
  inRoom(`spawn ${s.id}`, s.room, s.pos, { zCheck: false });
  const e = elev(s.room);
  if (rooms.get(s.room)?.kind === 'interior' && (s.pos[2] - e < 1.0 || s.pos[2] - e > 1.8)) err(`spawn ${s.id}: eye height ${(s.pos[2] - e).toFixed(2)}`);
  if (!/^(CP[1-8]|debug_[a-z0-9_]+)$/.test(s.id)) err(`spawn ${s.id}: id must be CP1..CP8 or debug_*`);
}
for (let i = 1; i <= 8; i++) if (!L.spawns.some((s) => s.id === `CP${i}`)) err(`missing spawn CP${i}`);
unique(L.triggers, 'trigger');
for (const t of L.triggers) {
  need(t, `trigger ${t.id}`, { id: 'str', room: 'str', rect: 'rect', zMin: 'num', zMax: 'num', event: 'str' });
  const r = rooms.get(t.room);
  if (!r) err(`trigger ${t.id}: unknown room`); else if (!rectInRect(t.rect, r.rect)) err(`trigger ${t.id}: rect outside room ${t.room}`);
  if (t.zMax <= t.zMin) err(`trigger ${t.id}: zMax <= zMin`);
  if (!/^b\d\d:[a-z0-9_]+$/.test(t.event)) err(`trigger ${t.id}: event '${t.event}' must look like bNN:name`);
}

// ---------------------------------------------------------------- materials: unused ones
for (const m of M.materials) if (!usedMats.has(m.id)) {
  // character / vehicle materials are referenced by characters and cutscenes rather than the layout
  if (!/^(skin_|hair_|nightgown_|flannel_|leather_|burlap_|rubber_|car_)/.test(m.id)) warn(`material ${m.id}: not referenced by the layout`);
}

// ---------------------------------------------------------------- voice script (schema check if present)
if (V) {
  if (V.version !== 1) err('voice-script version must be 1');
  need(V, 'voice-script', { model: 'str', designModel: 'str', outputFormat: 'str', speakers: 'arr', lines: 'arr' });
  const sp = unique(V.speakers, 'speaker');
  for (const s of V.speakers) {
    const w = `speaker ${s.id}`;
    need(s, w, { id: 'str', displayName: 'str', voiceDescription: 'str', previewText: 'str', seed: 'num', settings: 'obj', defaultChain: 'str' });
    oneOf(s.id, SPEAKERS, w); oneOf(s.defaultChain, CHAINS, w);
    if (s.previewText.length < 100 || s.previewText.length > 1000) err(`${w}: previewText length ${s.previewText.length} not in 100..1000`);
    if (s.voiceDescription.length < 20 || s.voiceDescription.length > 1000) err(`${w}: voiceDescription length ${s.voiceDescription.length}`);
    need(s.settings, `${w}.settings`, { stability: 'num', similarity_boost: 'num', style: 'num', speed: 'num', use_speaker_boost: 'bool' });
    for (const k of ['stability', 'similarity_boost', 'style']) if (!(s.settings[k] >= 0 && s.settings[k] <= 1)) err(`${w}: ${k} out of 0..1`);
    if (!(s.settings.speed >= 0.7 && s.settings.speed <= 1.2)) err(`${w}: speed out of 0.7..1.2`);
  }
  for (const req of SPEAKERS) if (!sp.has(req)) err(`voice-script: missing speaker ${req}`);
  unique(V.lines, 'voice line');
  for (const ln of V.lines) {
    const w = `voice line ${ln.id}`;
    need(ln, w, { id: 'str', speaker: 'str', text: 'str', subtitle: 'any?', caption: 'str?', beat: 'str', trigger: 'str', chain: 'str?', kind: 'str', variants: 'num', previousText: 'str?', nextText: 'str?', priority: 'num', milestone: 'str' });
    if (typeof ln.subtitle !== 'string') err(`${w}: subtitle must be a string (may be empty)`);
    oneOf(ln.speaker, SPEAKERS, w); oneOf(ln.kind, LINE_KIND, w); oneOf(ln.milestone, MILESTONE, w);
    if (ln.chain) oneOf(ln.chain, CHAINS, w);
    if (ln.subtitle === '' && !ln.caption) err(`${w}: empty subtitle needs a caption`);
    if (/\[[^\]]*\]/.test(ln.subtitle ?? '')) err(`${w}: subtitle contains an audio tag`);
    if (!(Number.isInteger(ln.variants) && ln.variants >= 1 && ln.variants <= 6)) err(`${w}: variants must be 1..6`);
    if (!/^(B\d\d|AI|ANY)$/.test(ln.beat)) err(`${w}: beat '${ln.beat}' must be Bnn, AI or ANY`);
    if (!/^[a-z0-9_]+:[a-z0-9_]+$/.test(ln.trigger)) err(`${w}: trigger '${ln.trigger}' must look like scope:event`);
    if (ln.kind === 'reading') { const words = ln.subtitle.split(/\s+/).filter(Boolean).length; if (words > 60) err(`${w}: reading has ${words} words (> 60)`); }
    if (ln.text.length > 800) warn(`${w}: very long TTS text`);
  }
  const takes = V.lines.reduce((a, l) => a + l.variants, 0);
  const chars = V.lines.reduce((a, l) => a + l.text.length * l.variants, 0);
  console.log(`voice-script: ${V.lines.length} lines, ${takes} takes, ~${chars} TTS characters`);
}

// ---------------------------------------------------------------- report
for (const w of warnings) console.warn(`warn: ${w}`);
for (const e of errors) console.error(`ERROR: ${e}`);
console.log(`layout: ${L.rooms.length} rooms, ${L.walls.length} walls, ${openings.size} openings, ${L.doors.length} doors, ${L.stairs.length} stairs, ${L.props.length} props (${propTypes.size} generator types), ${L.hides.length} hides, ${L.lights.length} lights, ${L.aiNodes.length} AI nodes / ${L.aiEdges.length} edges, loops: ${[...loops.keys()].join(', ')}`);
console.log(`prop types: ${[...propTypes.keys()].sort().join(', ')}`);
console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);

// ================================================================= SVG plans
if (!args.has('--no-render')) render();
process.exitCode = errors.length ? 1 : 0;

function render() {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const FONT = 'Helvetica, Arial, sans-serif';
  const roomFill = { ground: '#f3ead8', upper: '#e6eef5', exterior: '#e9efe2', car: '#eee' };
  const loopColor = { upper: '#c0392b', harlan_loop: '#8e44ad', ground_finale: '#d35400', lure: '#16a085', upper_b08: '#2980b9' };

  function sheet(name, title, bounds, scale, drawFloor, legend) {
    const [bx0, by0, bx1, by1] = bounds;
    const pad = 60;
    // Quick Look thumbnails are square: draw on a square canvas so nothing is cropped.
    const W0 = Math.round((bx1 - bx0) * scale + pad * 2), H0 = Math.round((by1 - by0) * scale + pad * 2 + 150);
    const W = Math.max(W0, H0), Hh = W;
    const X = (x) => (pad + (x - bx0) * scale).toFixed(1);
    const Y = (y) => (pad + (by1 - y) * scale).toFixed(1);
    const o = [];
    o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}">`);
    o.push(`<rect x="0" y="0" width="${W}" height="${Hh}" fill="#ffffff"/>`);
    o.push(`<text x="${pad}" y="32" font-family="${FONT}" font-size="22" font-weight="bold" fill="#222">${esc(title)}</text>`);
    // grid
    for (let gx = Math.ceil(bx0); gx <= bx1; gx++) o.push(`<line x1="${X(gx)}" y1="${Y(by0)}" x2="${X(gx)}" y2="${Y(by1)}" stroke="#eee" stroke-width="${gx % 5 ? 0.5 : 1.2}"/>`);
    for (let gy = Math.ceil(by0); gy <= by1; gy++) o.push(`<line x1="${X(bx0)}" y1="${Y(gy)}" x2="${X(bx1)}" y2="${Y(gy)}" stroke="#eee" stroke-width="${gy % 5 ? 0.5 : 1.2}"/>`);
    for (let gx = Math.ceil(bx0 / 5) * 5; gx <= bx1; gx += 5) o.push(`<text x="${X(gx)}" y="${Number(Y(by0)) + 16}" font-family="${FONT}" font-size="11" fill="#999" text-anchor="middle">${gx}</text>`);
    for (let gy = Math.ceil(by0 / 5) * 5; gy <= by1; gy += 5) o.push(`<text x="${Number(X(bx0)) - 6}" y="${Number(Y(gy)) + 4}" font-family="${FONT}" font-size="11" fill="#999" text-anchor="end">${gy}</text>`);
    const ctx = { X, Y, scale, o, esc, FONT };
    drawFloor(ctx);
    // north arrow + scale bar
    const nx = W - pad - 20, ny = pad + 10;
    o.push(`<path d="M ${nx} ${ny + 30} L ${nx} ${ny} M ${nx - 7} ${ny + 10} L ${nx} ${ny} L ${nx + 7} ${ny + 10}" stroke="#222" stroke-width="2" fill="none"/><text x="${nx}" y="${ny - 6}" font-family="${FONT}" font-size="13" text-anchor="middle" fill="#222">N</text>`);
    const sb = 5 * scale;
    o.push(`<line x1="${pad}" y1="${Hh - 120}" x2="${pad + sb}" y2="${Hh - 120}" stroke="#222" stroke-width="3"/><text x="${pad + sb / 2}" y="${Hh - 126}" font-family="${FONT}" font-size="12" text-anchor="middle">5 m</text>`);
    legend.forEach((t, i) => o.push(`<text x="${pad + (i % 2) * (W / 2 - pad)}" y="${Hh - 95 + Math.floor(i / 2) * 17}" font-family="${FONT}" font-size="12" fill="#333">${esc(t)}</text>`));
    o.push('</svg>');
    const file = resolve(ROOT, 'docs', `${name}.svg`);
    writeFileSync(file, o.join('\n'));
    return file;
  }

  function drawRooms(ctx, floor) {
    const { X, Y, o, esc, FONT, scale } = ctx;
    for (const r of L.rooms.filter((x) => x.floor === floor)) {
      const [x0, y0, x1, y1] = r.rect;
      o.push(`<rect x="${X(x0)}" y="${Y(y1)}" width="${((x1 - x0) * scale).toFixed(1)}" height="${((y1 - y0) * scale).toFixed(1)}" fill="${r.within ? '#e3d6bc' : roomFill[floor]}" stroke="#bbb" stroke-width="0.8"/>`);
      for (const h of r.floorHoles) o.push(`<rect x="${X(h[0])}" y="${Y(h[3])}" width="${((h[2] - h[0]) * scale).toFixed(1)}" height="${((h[3] - h[1]) * scale).toFixed(1)}" fill="#fff" fill-opacity="0.6" stroke="#555" stroke-dasharray="6 4" stroke-width="1.2"/>`);
      for (const h of r.ceilingHoles) o.push(`<rect x="${X(h[0])}" y="${Y(h[3])}" width="${((h[2] - h[0]) * scale).toFixed(1)}" height="${((h[3] - h[1]) * scale).toFixed(1)}" fill="none" stroke="#9aa" stroke-dasharray="2 3" stroke-width="1"/>`);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const lbl = r.kind === 'exterior' ? r.id : `${r.id} ${(x1 - x0).toFixed(2)}x${(y1 - y0).toFixed(2)}`;
      o.push(`<text x="${X(r.within ? x0 + 0.53 : cx)}" y="${Y(r.within ? y0 + 0.4 : cy)}" font-family="${FONT}" font-size="${r.within ? 11 : 15}" font-weight="bold" fill="#8a7a5a" text-anchor="middle" opacity="0.85">${esc(lbl)}</text>`);
    }
  }
  function drawSurfaces(ctx, floor) {
    const { X, Y, o, scale } = ctx;
    const col = { runner: '#b03a2e', carpet: '#a0522d', stair_wood: '#6d4c2f', porch_wood: '#8d6e4a', gravel: '#9e9e9e', asphalt: '#555', mud: '#6b4f2a', grass: '#7a9a5a' };
    for (const s of L.surfaces) {
      if (rooms.get(s.room)?.floor !== floor || !col[s.surface]) continue;
      if (s.rect.join() === rooms.get(s.room).rect.join()) continue;
      const [x0, y0, x1, y1] = s.rect;
      o.push(`<rect x="${X(x0)}" y="${Y(y1)}" width="${((x1 - x0) * scale).toFixed(1)}" height="${((y1 - y0) * scale).toFixed(1)}" fill="${col[s.surface]}" fill-opacity="0.18" stroke="none"/>`);
    }
  }
  function drawStairs(ctx, floor) {
    const { X, Y, o, scale, FONT } = ctx;
    for (const st of L.stairs) {
      const g = stairGeo.get(st.id);
      if (!g) continue;
      const own = floor === st.from || floor === st.to;
      if (!own) continue;
      const seen = new Set();
      for (const tr of g.treads) {
        const [x0, y0, x1, y1] = tr.rect;
        const key = tr.rect.join();
        const first = !seen.has(key); seen.add(key);
        const creaky = st.creakySteps.includes(tr.step);
        if (first) o.push(`<rect x="${X(x0)}" y="${Y(y1)}" width="${((x1 - x0) * scale).toFixed(1)}" height="${((y1 - y0) * scale).toFixed(1)}" fill="${floor === st.to ? '#fff' : '#d9c7a7'}" fill-opacity="${floor === st.to ? 0.3 : 0.9}" stroke="#6d4c2f" stroke-width="0.8"/>`);
        if (tr.winder && first) { o.push(`<line x1="${X(x0)}" y1="${Y(y0)}" x2="${X(x1)}" y2="${Y(y1)}" stroke="#6d4c2f" stroke-width="0.8"/><line x1="${X((x0 + x1) / 2)}" y1="${Y(y0)}" x2="${X(x1)}" y2="${Y(y1)}" stroke="#6d4c2f" stroke-width="0.8"/>`); }
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const lab = tr.winder ? `w${tr.step}` : `${tr.step}`;
        o.push(`<text x="${X(cx) - 0 + (tr.winder ? (tr.step - 2) * 9 : 0)}" y="${Number(Y(cy)) + 4}" font-family="${FONT}" font-size="10" fill="${creaky ? '#c0392b' : '#4a3520'}" font-weight="${creaky ? 'bold' : 'normal'}" text-anchor="middle">${lab}</text>`);
      }
      const [sx, sy] = st.start, [tx, ty] = g.top;
      o.push(`<circle cx="${X(sx)}" cy="${Y(sy)}" r="4" fill="#6d4c2f"/><text x="${Number(X(sx)) + 6}" y="${Number(Y(sy)) + 14}" font-family="${FONT}" font-size="11" fill="#6d4c2f">${st.id} UP (${st.risers}R x ${st.riserHeight.toFixed(3)})</text>`);
      o.push(`<circle cx="${X(tx)}" cy="${Y(ty)}" r="4" fill="none" stroke="#6d4c2f" stroke-width="1.5"/>`);
    }
  }
  function drawWalls(ctx, floor) {
    const { X, Y, o, scale, FONT, esc } = ctx;
    for (const wl of L.walls.filter((w) => w.floor === floor)) {
      const len = Math.hypot(wl.b[0] - wl.a[0], wl.b[1] - wl.a[1]);
      const dx = (wl.b[0] - wl.a[0]) / len, dy = (wl.b[1] - wl.a[1]) / len;
      const nx = -dy, ny = dx, t = wl.thickness / 2;
      // solid segments between floor-level openings (doors/arches/windows cut the drawn wall; passthroughs are marked only)
      const cuts = wl.openings.filter((q) => q.kind !== 'passthrough').map((q) => [q.offset - q.width / 2, q.offset + q.width / 2]).sort((a, b) => a[0] - b[0]);
      const segs = []; let s0 = 0;
      for (const [c0, c1] of cuts) { if (c0 > s0) segs.push([s0, c0]); s0 = Math.max(s0, c1); }
      if (s0 < len) segs.push([s0, len]);
      const ext = wl.left === 'exterior' || wl.right === 'exterior';
      const color = ext ? '#2b2b2b' : wl.clipToStair ? '#8d6e4a' : '#555';
      for (const [u0, u1] of segs) {
        const P = (u, s) => `${X(wl.a[0] + dx * u + nx * s)},${Y(wl.a[1] + dy * u + ny * s)}`;
        o.push(`<polygon points="${P(u0, t)} ${P(u1, t)} ${P(u1, -t)} ${P(u0, -t)}" fill="${color}"/>`);
      }
      for (const q of wl.openings) {
        const u0 = q.offset - q.width / 2, u1 = q.offset + q.width / 2;
        const cx = wl.a[0] + dx * q.offset, cy = wl.a[1] + dy * q.offset;
        if (q.kind === 'window') {
          const col = q.window.skyPortal ? '#2e86c1' : '#7fb3d5';
          const P = (u, s) => `${X(wl.a[0] + dx * u + nx * s)},${Y(wl.a[1] + dy * u + ny * s)}`;
          o.push(`<polygon points="${P(u0, t)} ${P(u1, t)} ${P(u1, -t)} ${P(u0, -t)}" fill="#fff" stroke="${col}" stroke-width="1.5"/>`);
          o.push(`<line x1="${X(wl.a[0] + dx * u0)}" y1="${Y(wl.a[1] + dy * u0)}" x2="${X(wl.a[0] + dx * u1)}" y2="${Y(wl.a[1] + dy * u1)}" stroke="${col}" stroke-width="2.5"/>`);
          if (q.window.state.includes('nailed')) o.push(`<text x="${X(cx + nx * 0.35)}" y="${Number(Y(cy + ny * 0.35)) + 4}" font-family="${FONT}" font-size="10" fill="${col}" text-anchor="middle">${q.window.state === 'nailed' ? 'N' : 'NS'}${q.window.skyPortal ? '*' : ''}</text>`);
        } else if (q.kind === 'door') {
          const d = doors.get(q.doorId);
          if (!d) continue;
          // leaf swings into d.swingInto: pick the normal pointing into that room
          const sideSign = wl.left === d.swingInto ? 1 : -1;
          const hingeU = (d.hinge === 'left') === (sideSign === 1) ? u1 : u0; // approximate
          const hx = wl.a[0] + dx * hingeU, hy = wl.a[1] + dy * hingeU;
          const otherU = hingeU === u0 ? u1 : u0;
          const ox = wl.a[0] + dx * otherU, oy = wl.a[1] + dy * otherU;
          const lx = hx + nx * sideSign * q.width, ly = hy + ny * sideSign * q.width;
          const dcol = { bolted: '#c0392b', boarded: '#c0392b', locked: '#c0392b', ajar: '#27ae60', open: '#27ae60', closed: '#555' }[d.initial];
          o.push(`<line x1="${X(hx)}" y1="${Y(hy)}" x2="${X(lx)}" y2="${Y(ly)}" stroke="${dcol}" stroke-width="2"/>`);
          o.push(`<path d="M ${X(lx)} ${Y(ly)} A ${(q.width * scale).toFixed(1)} ${(q.width * scale).toFixed(1)} 0 0 ${sideSign * (hingeU === u0 ? 1 : -1) > 0 ? 0 : 1} ${X(ox)} ${Y(oy)}" fill="none" stroke="${dcol}" stroke-width="0.8" stroke-dasharray="3 2"/>`);
          o.push(`<text x="${X(cx - nx * 0.28)}" y="${Number(Y(cy - ny * 0.28)) + 4}" font-family="${FONT}" font-size="10" fill="${dcol}" text-anchor="middle">${esc(d.id.replace('D_', ''))}${d.initial !== 'closed' ? ` (${d.initial})` : ''}</text>`);
        } else if (q.kind === 'arch') {
          o.push(`<text x="${X(cx)}" y="${Number(Y(cy)) + 4}" font-family="${FONT}" font-size="9" fill="#555" text-anchor="middle">arch</text>`);
        } else if (q.kind === 'passthrough') {
          o.push(`<circle cx="${X(cx)}" cy="${Y(cy)}" r="3" fill="#e67e22"/>`);
        }
      }
    }
  }
  function drawProps(ctx, floor) {
    const { X, Y, o, FONT, esc } = ctx;
    for (const p of L.props) {
      if (rooms.get(p.room)?.floor !== floor) continue;
      if (p.params?.path) {
        const pts = String(p.params.path).split(';').map((q) => q.split(',').map(Number));
        const col = p.type === 'door_rope' ? '#e67e22' : '#16a085';
        o.push(`<polyline points="${pts.map((q) => `${X(q[0])},${Y(q[1])}`).join(' ')}" fill="none" stroke="${col}" stroke-width="1.8" stroke-dasharray="${p.type === 'door_rope' ? '' : '5 3'}"/>`);
      }
      const col = p.interaction ? '#1f618d' : p.lighting === 'dynamic' ? '#7d3c98' : '#444';
      const [x, y] = p.pos;
      // facing tick: front = (sin yaw, -cos yaw)
      const fx = x + Math.sin(p.yaw) * 0.3, fy = y - Math.cos(p.yaw) * 0.3;
      o.push(`<rect x="${Number(X(x)) - 3.5}" y="${Number(Y(y)) - 3.5}" width="7" height="7" fill="${col}"/><line x1="${X(x)}" y1="${Y(y)}" x2="${X(fx)}" y2="${Y(fy)}" stroke="${col}" stroke-width="1.2"/>`);
      o.push(`<text x="${Number(X(x)) + 5}" y="${Number(Y(y)) - 4}" font-family="${FONT}" font-size="8.5" fill="${col}">${esc(p.id.replace(/^P_/, ''))}</text>`);
    }
  }
  function drawAi(ctx, floor) {
    const { X, Y, o, FONT, esc } = ctx;
    for (const ed of L.aiEdges) {
      const A = nodes.get(ed.a), B = nodes.get(ed.b);
      if (!A || !B) continue;
      const fa = rooms.get(A.room).floor, fb = rooms.get(B.room).floor;
      if (fa !== floor && fb !== floor) continue;
      const col = loopColor[ed.loops[0]] ?? '#999';
      o.push(`<line x1="${X(A.pos[0])}" y1="${Y(A.pos[1])}" x2="${X(B.pos[0])}" y2="${Y(B.pos[1])}" stroke="${col}" stroke-width="${ed.kind === 'walk' ? 1.4 : 2.4}" stroke-opacity="0.7" stroke-dasharray="${ed.kind === 'stair' ? '2 3' : ed.kind === 'door' ? '6 2' : ''}"/>`);
    }
    for (const nd of L.aiNodes) {
      if (rooms.get(nd.room).floor !== floor) continue;
      const [x, y] = nd.pos;
      const big = nd.tags.includes('vigil') || nd.tags.includes('lure');
      o.push(`<circle cx="${X(x)}" cy="${Y(y)}" r="${big ? 6 : 4}" fill="${nd.tags.includes('hide_check') ? '#f1c40f' : '#c0392b'}" stroke="#fff" stroke-width="1"/>`);
      if (nd.lookYaw !== undefined) o.push(`<line x1="${X(x)}" y1="${Y(y)}" x2="${X(x + Math.cos(nd.lookYaw) * 0.45)}" y2="${Y(y + Math.sin(nd.lookYaw) * 0.45)}" stroke="#c0392b" stroke-width="1.5"/>`);
      o.push(`<text x="${Number(X(x)) + 6}" y="${Number(Y(y)) + 12}" font-family="${FONT}" font-size="8" fill="#c0392b">${esc(nd.id)}</text>`);
    }
  }
  function drawMisc(ctx, floor) {
    const { X, Y, o, FONT, esc, scale } = ctx;
    for (const t of L.triggers) {
      if (rooms.get(t.room)?.floor !== floor) continue;
      const [x0, y0, x1, y1] = t.rect;
      o.push(`<rect x="${X(x0)}" y="${Y(y1)}" width="${((x1 - x0) * scale).toFixed(1)}" height="${((y1 - y0) * scale).toFixed(1)}" fill="none" stroke="#27ae60" stroke-dasharray="4 3" stroke-width="1"/><text x="${Number(X(x0)) + 2}" y="${Number(Y(y0)) - 2}" font-family="${FONT}" font-size="8" fill="#27ae60">${esc(t.event)}</text>`);
    }
    for (const c of L.creakers) { if (rooms.get(c.room)?.floor !== floor) continue; o.push(`<circle cx="${X(c.pos[0])}" cy="${Y(c.pos[1])}" r="${(c.radius * scale).toFixed(1)}" fill="none" stroke="#c0392b" stroke-width="1.5"/><text x="${X(c.pos[0])}" y="${Number(Y(c.pos[1])) + 3}" font-family="${FONT}" font-size="9" fill="#c0392b" text-anchor="middle">creak</text>`); }
    for (const l of L.lights) {
      if (rooms.get(l.room)?.floor !== floor && !(l.role === 'lightning' && l.type === 'area' && floor === 'upper')) continue;
      if (l.type === 'sun') continue;
      o.push(`<circle cx="${X(l.pos[0])}" cy="${Y(l.pos[1])}" r="6" fill="${l.role === 'lightning' ? '#85c1e9' : '#f4d03f'}" stroke="#b7950b" stroke-width="1"/><text x="${Number(X(l.pos[0])) + 7}" y="${Number(Y(l.pos[1])) + 10}" font-family="${FONT}" font-size="8" fill="#9a7d0a">${esc(l.id.replace('L_', ''))} ${l.watts}W ${l.mode}</text>`);
    }
    for (const h of L.hides) {
      if (rooms.get(h.room)?.floor !== floor) continue;
      o.push(`<circle cx="${X(h.eye[0])}" cy="${Y(h.eye[1])}" r="5" fill="none" stroke="#1abc9c" stroke-width="2"/><line x1="${X(h.eye[0])}" y1="${Y(h.eye[1])}" x2="${X(h.eye[0] + Math.cos(h.eyeYaw) * 0.6)}" y2="${Y(h.eye[1] + Math.sin(h.eyeYaw) * 0.6)}" stroke="#1abc9c" stroke-width="2"/><text x="${Number(X(h.eye[0])) - 6}" y="${Number(Y(h.eye[1])) - 7}" font-family="${FONT}" font-size="9" fill="#117a65" text-anchor="end">${esc(h.id)}</text>`);
    }
    for (const s of L.spawns) {
      if (rooms.get(s.room)?.floor !== floor) continue;
      const [x, y] = s.pos;
      o.push(`<polygon points="${X(x + Math.cos(s.yaw) * 0.35)},${Y(y + Math.sin(s.yaw) * 0.35)} ${X(x + Math.cos(s.yaw + 2.5) * 0.2)},${Y(y + Math.sin(s.yaw + 2.5) * 0.2)} ${X(x + Math.cos(s.yaw - 2.5) * 0.2)},${Y(y + Math.sin(s.yaw - 2.5) * 0.2)}" fill="#2c3e50"/><text x="${Number(X(x)) - 4}" y="${Number(Y(y)) + 14}" font-family="${FONT}" font-size="9" font-weight="bold" fill="#2c3e50" text-anchor="end">${esc(s.id)}</text>`);
    }
    for (const c of L.cameras) {
      const zf = c.pos[2] > 4.05 ? 'upper' : 'ground';
      if (zf !== floor || c.pos[1] < -1) continue;
      o.push(`<polygon points="${X(c.pos[0])},${Y(c.pos[1])} ${X(c.pos[0] + (c.target[0] - c.pos[0]) * 0.18 - (c.target[1] - c.pos[1]) * 0.08)},${Y(c.pos[1] + (c.target[1] - c.pos[1]) * 0.18 + (c.target[0] - c.pos[0]) * 0.08)} ${X(c.pos[0] + (c.target[0] - c.pos[0]) * 0.18 + (c.target[1] - c.pos[1]) * 0.08)},${Y(c.pos[1] + (c.target[1] - c.pos[1]) * 0.18 - (c.target[0] - c.pos[0]) * 0.08)}" fill="#e74c3c" fill-opacity="0.35" stroke="#e74c3c"/><text x="${X(c.pos[0])}" y="${Number(Y(c.pos[1])) - 6}" font-family="${FONT}" font-size="8" fill="#e74c3c">cam:${esc(c.id)}</text>`);
    }
  }
  const legend = [
    'Walls: black = exterior, grey = interior, brown = stair-clipped partition. Door leaf colour: red locked/bolted/boarded, green ajar, grey closed.',
    'Windows: blue; N = nailed, NS = nailed+shuttered, * = lightning sky portal. Orange dot = rope / bell-wire passthrough.',
    'Stairs: numbered treads (red bold = creaky, w = winder); dashed rect = floor hole, dotted = ceiling hole.',
    'AI: red nodes (yellow = hide_check), lines coloured by loop; look yaw tick. Teal circle = hide eye. Yellow = light. Green dashed = trigger.',
    'Props: squares with facing tick (blue = interactive, purple = dynamic). Orange line = door rope, teal dashed = bell wire.',
    'Loops: red upper, purple harlan_loop, orange ground_finale, teal lure, blue upper_b08.',
  ];
  const houseBounds = [-1.5, -3.5, 10.5, 12.5];
  const files = [];
  files.push(sheet('layout-ground', 'THE KEEPING — ground floor (FFL 0.6 m) + porch', houseBounds, 105, (ctx) => {
    drawRooms(ctx, 'ground'); drawSurfaces(ctx, 'ground'); drawStairs(ctx, 'ground'); drawWalls(ctx, 'ground'); drawProps(ctx, 'ground'); drawMisc(ctx, 'ground'); drawAi(ctx, 'ground');
    // porch outline from EXT2
    const pr = L.props.find((p) => p.id === 'P_PORCH');
    if (pr) { const { X, Y, o, scale } = ctx; const w = pr.params.width, d = pr.params.depth; o.push(`<rect x="${X(pr.pos[0] - w / 2)}" y="${Y(pr.pos[1] + d / 2)}" width="${(w * scale).toFixed(1)}" height="${(d * scale).toFixed(1)}" fill="#8d6e4a" fill-opacity="0.15" stroke="#8d6e4a"/><text x="${X(pr.pos[0])}" y="${Y(pr.pos[1] - 0.3)}" font-family="Helvetica" font-size="13" fill="#8d6e4a" text-anchor="middle">PORCH 9 x 2.5 (EXT2)</text>`); }
  }, legend));
  files.push(sheet('layout-upper', 'THE KEEPING — upper floor (FFL 4.1 m)', houseBounds, 105, (ctx) => {
    drawRooms(ctx, 'upper'); drawSurfaces(ctx, 'upper'); drawStairs(ctx, 'upper'); drawWalls(ctx, 'upper'); drawProps(ctx, 'upper'); drawMisc(ctx, 'upper'); drawAi(ctx, 'upper');
    // servants' shaft (a ground room spanning both floors) drawn for reference
    const u4 = rooms.get('U4'); if (u4) { const { X, Y, o, scale } = ctx; const [x0, y0, x1, y1] = u4.rect; o.push(`<rect x="${X(x0)}" y="${Y(y1)}" width="${((x1 - x0) * scale).toFixed(1)}" height="${((y1 - y0) * scale).toFixed(1)}" fill="none" stroke="#6d4c2f" stroke-dasharray="8 4"/><text x="${X((x0 + x1) / 2)}" y="${Y(y0) - 4}" font-family="Helvetica" font-size="11" fill="#6d4c2f" text-anchor="middle">U4 shaft (open to the landing)</text>`); }
  }, legend));
  files.push(sheet('layout-exterior', 'THE KEEPING — exterior: County Road 9, drive, porch, wreck field', [-21, -39, 58, 17], 19, (ctx) => {
    drawRooms(ctx, 'exterior'); drawSurfaces(ctx, 'exterior');
    const { X, Y, o, scale, FONT } = ctx;
    o.push(`<rect x="${X(-0.3)}" y="${Y(11.95)}" width="${(9.35 * scale).toFixed(1)}" height="${(12.25 * scale).toFixed(1)}" fill="#555" fill-opacity="0.55" stroke="#222"/><text x="${X(4.4)}" y="${Y(6)}" font-family="${FONT}" font-size="13" fill="#fff" text-anchor="middle">HOUSE</text>`);
    if (L.roof.chimney) { const c = L.roof.chimney; o.push(`<rect x="${X(c.pos[0] - c.size[0] / 2)}" y="${Y(c.pos[1] + c.size[1] / 2)}" width="${(c.size[0] * scale).toFixed(1)}" height="${(c.size[1] * scale).toFixed(1)}" fill="#922"/>`); }
    drawProps(ctx, 'exterior'); drawMisc(ctx, 'exterior');
    for (const c of L.cameras.filter((c) => c.pos[1] < -1)) o.push(`<circle cx="${X(c.pos[0])}" cy="${Y(c.pos[1])}" r="4" fill="#e74c3c"/><line x1="${X(c.pos[0])}" y1="${Y(c.pos[1])}" x2="${X(c.target[0])}" y2="${Y(c.target[1])}" stroke="#e74c3c" stroke-dasharray="3 3"/><text x="${Number(X(c.pos[0])) + 6}" y="${Y(c.pos[1])}" font-family="${FONT}" font-size="10" fill="#e74c3c">cam:${c.id}</text>`);
  }, legend.slice(4)));

  // PNG via macOS Quick Look (skipped elsewhere)
  if (args.has('--no-png') || process.platform !== 'darwin') { console.log(`rendered ${files.map((f) => basename(f)).join(', ')}`); return; }
  for (const f of files) {
    try {
      execFileSync('qlmanage', ['-t', '-s', '1600', '-o', resolve(ROOT, 'docs'), f], { stdio: 'ignore' });
      const pngQ = `${f}.png`, png = f.replace(/\.svg$/, '.png');
      if (existsSync(pngQ)) renameSync(pngQ, png);
    } catch (e2) { warn(`qlmanage failed for ${basename(f)}: ${e2.message}`); }
  }
  console.log(`rendered ${files.map((f) => basename(f).replace('.svg', '.{svg,png}')).join(', ')}`);
}
