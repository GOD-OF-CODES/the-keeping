// AI lane (src/ai): graph + A*, hearing attenuation (parity with audio occlusion), thunder masking, light, sight
// distances, the locket rule, state priority, lure decay, hide rules, grace, determinism, and the M1 exit test.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import layoutJson from '../src/shared/level-layout.json' with { type: 'json' };
import type { LevelLayout, P3 } from '../src/shared/layout-types.ts';
import { AiGraph } from '../src/ai/graph.ts';
import { AdaBrain, bedBox, bedNearest } from '../src/ai/ada-brain.ts';
import { TUNING } from '../src/ai/tuning.ts';
import { ADA_STATES, type BeamView, type DoorState, type PlayerView, type WorldQuery } from '../src/ai/types.ts';
import {
  beamNear,
  beamTouches,
  effectiveRadius,
  flamesOf,
  hearingPath,
  hears,
  hearingMargin,
  stairPortals,
  inCone,
  isPlayerLit,
  lureDuration,
  resolvePriority,
  seesLocket,
  seesPlayer,
  sightRange,
  ThunderMask,
  type PriorityInput,
} from '../src/ai/senses.ts';
import { HideTracker, audibleFromHide, breathGivesAway, seenEntering } from '../src/ai/hide-check.ts';
import { bestPath } from '../src/audio/spatial.ts';

const layout = layoutJson as unknown as LevelLayout;
const g = new AiGraph(layout);

// ------------------------------------------------------------------ helpers

type DoorMap = Record<string, DoorState>;
function initialDoors(extra: DoorMap = {}): DoorMap {
  const m: DoorMap = {};
  for (const d of layout.doors) m[d.id] = d.initial === 'bolted' || d.initial === 'boarded' || d.initial === 'locked' ? 'locked' : d.initial === 'ajar' || d.initial === 'open' ? 'open' : 'closed';
  return { ...m, ...extra };
}
function world(doors: DoorMap = initialDoors(), los: WorldQuery['lineOfSight'] = () => true, canSee: WorldQuery['playerCanSee'] = () => false): WorldQuery {
  return { doorState: (id) => doors[id] ?? 'closed', lineOfSight: los, playerCanSee: canSee };
}
const beamOff = (eye: P3): BeamView => ({ on: false, origin: eye, dir: [1, 0, 0], range: 14, halfAngle: 0.3, hit: null });
function player(pos: P3, o: Partial<PlayerView> = {}): PlayerView {
  const eye: P3 = [pos[0], pos[1], pos[2] + 1.65];
  return { pos, eye, room: g.roomAt(pos), crouched: false, running: false, speed: 0, hiddenIn: null, holdingBreath: false, beam: beamOff(eye), locketRaised: false, ...o };
}
function run(b: AdaBrain, p: PlayerView | (() => PlayerView), seconds: number, dt = 0.05) {
  const events: any[] = [];
  let out: any = null;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    out = b.update(dt, typeof p === 'function' ? p() : p);
    events.push(...out.events);
  }
  return { out, events };
}
const states = (events: any[]) => events.filter((e) => e.type === 'state').map((e) => e.to);
const FAR_PLAYER = () => player([5.0, 9.8, 0.6]); // on the servants' stair shaft, well away

// ------------------------------------------------------------------ graph

test('graph: every aiEdge endpoint exists; loops upper / harlan_loop / ground_finale / upper_b08 are connected', () => {
  assert.equal(g.edges.length, layout.aiEdges.length);
  for (const l of ['upper', 'harlan_loop', 'ground_finale', 'upper_b08']) assert.ok(g.loopConnected(l), l);
  // Harlan's two-door loop is a real cycle through both doors
  const dh = g.edges.find((e) => e.doorId === 'D_HARLAN')!;
  const dd = g.edges.find((e) => e.doorId === 'D_DRESSING')!;
  assert.ok(g.cycleThrough('harlan_loop', dh.index));
  assert.ok(g.cycleThrough('harlan_loop', dd.index));
});

test('graph: A* honours locks — boarded D_ADA and bolted D_PASSAGE block, unlocking opens the route', () => {
  const locked = initialDoors();
  assert.equal(g.path('U_VIGIL', 'U3_DRESS', (id) => locked[id]), null);
  assert.equal(g.path('G_HALL_N', 'G_KITCHEN_C', (id) => locked[id]), null);
  const open = initialDoors({ D_ADA: 'closed', D_PASSAGE: 'closed' });
  const p1 = g.path('U_VIGIL', 'U3_DRESS', (id) => open[id])!;
  assert.deepEqual(p1.nodes.slice(0, 2), ['U_VIGIL', 'U3_DOOR_I']);
  const p2 = g.path('U_VIGIL', 'G_KITCHEN_C', (id) => open[id])!;
  assert.ok(p2.nodes.includes('U_STAIRTOP') && p2.nodes.includes('G_STAIRFOOT'), 'down the main stair');
  assert.ok(p2.nodes.includes('G_PDOOR_S') && p2.nodes.includes('G_PDOOR_N'), 'through the back passage');
});

test('graph: a closed door costs more than an open one; she never uses the servants stair or enters the parlor', () => {
  const a = initialDoors({ D_HARLAN: 'open' });
  const b = initialDoors({ D_HARLAN: 'closed' });
  const ca = g.path('U_HDOOR_O', 'U2_BEDLOOK', (id) => a[id])!.cost;
  const cb = g.path('U_HDOOR_O', 'U2_BEDLOOK', (id) => b[id])!.cost;
  assert.ok(cb > ca);
  for (const n of g.nodes.values()) assert.ok(!['U4', 'U4T', 'G2'].includes(n.room), `${n.id} in ${n.room}`);
});

test('graph: room lookup (floor by height, CLOSET nested in G1, exterior)', () => {
  assert.equal(g.roomAt([2, 4, 0.6]), 'G1');
  assert.equal(g.roomAt([2, 4, 4.1]), 'U1');
  assert.equal(g.roomAt([0.5, 6, 0.6]), 'CLOSET');
  assert.equal(g.roomAt([5, 8, 4.1]), 'U3');
  assert.equal(g.roomAt([1.8, -20, 0]), 'EXT2');
  for (const n of g.nodes.values()) assert.equal(g.roomAt(n.pos), n.room, n.id);
});

test('graph: every hide has a hide-check node within 1 m of its entry', () => {
  for (const h of layout.hides) {
    const n = g.hideCheckNode(h);
    const d = Math.hypot(n.pos[0] - h.entry[0], n.pos[1] - h.entry[1]);
    assert.ok(d < 1, `${h.id} → ${n.id} ${d.toFixed(2)} m`);
    assert.equal(g.hideForCheckNode(n.id)?.id, h.id);
  }
});

// ------------------------------------------------------------------ hearing

test('hearing: closed door ×0.5, floor ×0.4, open stairwell ×1, open door ×1 (layout numbers)', () => {
  const d = initialDoors();
  const f = (id: string) => d[id];
  assert.equal(hearingPath(layout.roomLinks, 'U1', 'U1', f).attenuation, 1);
  assert.equal(hearingPath(layout.roomLinks, 'U1', 'G1', f).attenuation, 1, 'open stairwell');
  // both bedroom doors closed (and the parlor shut, as after C2): one closed door
  assert.equal(hearingPath(layout.roomLinks, 'U1', 'U2', (id) => (id === 'D_HARLAN' || id === 'D_DRESSING' || id === 'D_PARLOR' ? 'closed' : f(id))).attenuation, 0.5);
  // with the parlor door ajar (B03) the best path is the stairwell → hall → parlor → floor grate (0.75)
  assert.equal(hearingPath(layout.roomLinks, 'U1', 'U2', (id) => (id === 'D_HARLAN' || id === 'D_DRESSING' ? 'closed' : f(id))).attenuation, 0.75);
  assert.equal(hearingPath(layout.roomLinks, 'U1', 'U2', (id) => (id === 'D_HARLAN' ? 'open' : 'closed')).attenuation, 1);
  // U3 → G3 straight through the floor (0.4) beats U3 → U1 (boarded 0.5) → G1 (1) → wall 0.35
  assert.ok(Math.abs(hearingPath(layout.roomLinks, 'U3', 'G3', f).attenuation - 0.4) < 1e-9);
  // G2 ↔ U2 prefers the grate (0.75) over the floor (0.4) when every door is shut
  assert.ok(Math.abs(hearingPath(layout.roomLinks, 'G2', 'U2', () => 'closed').attenuation - 0.75) < 1e-9);
});

test('hearing: parity with the audio lane occlusion graph (bestPath) on every room pair, doors open and closed', () => {
  const rooms = layout.rooms.map((r) => r.id);
  for (const open of [false, true]) {
    const ds = (_: string) => (open ? 'open' : 'closed') as DoorState;
    for (const a of rooms)
      for (const b of rooms) {
        const mine = hearingPath(layout.roomLinks, a, b, ds).attenuation;
        const theirs = bestPath(layout.roomLinks, a, b, () => open).attenuation;
        assert.ok(Math.abs(mine - theirs) < 1e-9, `${a}→${b} open=${open}: ${mine} vs ${theirs}`);
      }
  }
});

test('hearing: radius × attenuation × multipliers vs distance; thunder masks player sound but not script sound', () => {
  const doors = initialDoors();
  const ada: P3 = [3.2, 8.2, 4.1]; // her vigil
  const h = { links: layout.roomLinks, doors: (id: string) => doors[id], pos: ada, room: 'U1', mul: 1, masked: false };
  const at = (x: number, y: number, z: number, room: string, radius: number, source: 'player' | 'script' = 'player') => ({ pos: [x, y, z] as P3, room, radius, source });
  // same room, 5 m south on the runner: walking (2 m) no, running (10 m) yes
  assert.equal(hears(at(3.2, 3.2, 4.1, 'U1', TUNING.noise.runner), h), false);
  assert.equal(hears(at(3.2, 3.2, 4.1, 'U1', TUNING.noise.run), h), true);
  // G1 straight below via the open stairwell: 3.5 m vertical; bare boards 4 m heard, crouch 1.5 not
  assert.equal(hears(at(3.2, 8.2, 0.6, 'G1', TUNING.noise.bare), h), true);
  assert.equal(hears(at(3.2, 8.2, 0.6, 'G1', TUNING.noise.crouch), h), false);
  // kitchen: best path is the arch → back passage → (bolted) passage door ×0.5 → hall → stairwell: 10 m → 5 m
  assert.ok(Math.abs(effectiveRadius(at(4, 8.2, 0.6, 'G3', 10), h) - 5) < 1e-9);
  // grace/assist multipliers shrink the radius
  assert.equal(effectiveRadius(at(3, 3, 4.1, 'U1', 10), { ...h, mul: 0.7 }), 7);
  // thunder
  assert.equal(hears(at(3.2, 3.2, 4.1, 'U1', TUNING.noise.run), { ...h, masked: true }), false);
  assert.equal(hears(at(3.2, 3.2, 4.1, 'U1', 10, 'script'), { ...h, masked: true }), true);
});

test('hearing: sound crosses the open stairwell THROUGH the stair (not the slab): parlor-door lure vs the upper floor', () => {
  const doors = initialDoors({ D_PARLOR: 'locked' });
  const fz = new Map(layout.floors.map((f) => [f.id, f.elevation]));
  const portals = stairPortals(layout.stairs, (id) => fz.get(id) ?? 0);
  const lure: P3 = [3.2, 1.5, 0.6]; // G_PARLOR_LURE, where the bell holds her
  const h = { links: layout.roomLinks, doors: (id: string) => doors[id], pos: lure, room: 'G1', mul: 1, masked: false, portals };
  const n = (x: number, y: number, radius: number) => ({ pos: [x, y, 4.1] as P3, room: 'U1', radius, source: 'player' as const });
  // walking on bare boards right above her (3.5 m up) is NOT heard: the slab is ×0.4 and the stairwell is far
  assert.ok(!hears(n(3.15, 3.0, TUNING.noise.bare), h));
  // a pry at Ada's door outside a thunder roll (14 m) carries down the stairwell to her; 8 m would not
  assert.ok(hears(n(3.4, 8.2, TUNING.noise.pry), h));
  assert.ok(!hears(n(3.4, 8.2, 8), h));
  // running the upper corridor is heard
  assert.ok(hears(n(2.4, 4.0, TUNING.noise.run), h));
  assert.ok(hearingMargin(n(2.4, 4.0, TUNING.noise.run), h) > 0);
});

test('thunder mask: [t+delay, t+delay+duration] (AUDIO.md contract 1.5 s / 2.5 s by default)', () => {
  const m = new ThunderMask();
  m.add(10);
  assert.equal(m.isMasked(11.4), false);
  assert.equal(m.isMasked(11.6), true);
  assert.equal(m.isMasked(13.9), true);
  assert.equal(m.isMasked(14.1), false);
  m.add(20, 500, 4000);
  assert.equal(m.isMasked(24.4), true);
  assert.equal(m.nextRollIn(15), 5.5);
});

test('brain: a run inside a thunder roll is not heard; the same run outside it is', () => {
  const mk = () => new AdaBrain(layout, world(), { seed: 7 });
  const p = player([3.2, 3.2, 4.1]);
  const b1 = mk();
  b1.thunderRoll(0, 2500);
  b1.noise({ pos: [3.2, 3.2, 4.1], room: 'U1', radius: 10, source: 'player' });
  assert.ok(!states(run(b1, p, 0.5).events).includes('LISTEN'));
  const b2 = mk();
  b2.noise({ pos: [3.2, 3.2, 4.1], room: 'U1', radius: 10, source: 'player' });
  assert.ok(states(run(b2, p, 0.5).events).includes('LISTEN'));
});

// ------------------------------------------------------------------ light and sight

test('light: beam cone touches her body; beam landing within 6 m; lit near a flame or with the torch on', () => {
  const beam: BeamView = { on: true, origin: [0, 0, 1.6], dir: [1, 0, 0], range: 14, halfAngle: 0.25, hit: null };
  assert.ok(beamTouches(beam, [8, 0, 1.2], 0.35, () => true));
  assert.ok(!beamTouches(beam, [8, 5, 1.2], 0.35, () => true), 'outside the cone');
  assert.ok(!beamTouches(beam, [8, 0, 1.2], 0.35, () => false), 'occluded');
  assert.ok(!beamTouches({ ...beam, on: false }, [8, 0, 1.2], 0.35, () => true));
  assert.ok(beamNear({ ...beam, hit: [5, 0, 1] }, [0, 3, 0.6]));
  assert.ok(!beamNear({ ...beam, hit: [9, 0, 1] }, [0, 3, 0.6]));
  const flames = flamesOf(layout);
  const hallCandle = flames.find((f) => f.id === 'L_CANDLE_HALL')!;
  const off = beamOff([0, 0, 0]);
  assert.ok(isPlayerLit({ pos: [hallCandle.pos[0] - 1, hallCandle.pos[1], 0.6], beam: off }, flames));
  assert.ok(!isPlayerLit({ pos: [hallCandle.pos[0] - 2, hallCandle.pos[1], 0.6], beam: off }, flames));
  assert.ok(isPlayerLit({ pos: [1, 1, 0.6], beam: { ...off, on: true } }, flames));
});

test('sight: 60° cone; 8 m lit / 4 m dark / 2 m dark+crouched (difficulty 2026-10-08); head hanging = blind; hidden = never', () => {
  assert.equal(sightRange(true, false), 8);
  assert.equal(sightRange(false, false), 4);
  assert.equal(sightRange(false, true), 2);
  assert.ok(inCone([0, 0, 0], 0, [10, 5, 0]));
  assert.ok(!inCone([0, 0, 0], 0, [10, 6.2, 0]));
  const eye: P3 = [0, 0, 5.6];
  const s = { headLifted: true, eye, lookYaw: 0, los: () => true };
  const at = (x: number, o: Partial<PlayerView> = {}) => player([x, 0, 4.1], o);
  assert.ok(seesPlayer(s, at(3.5), false));
  assert.ok(!seesPlayer(s, at(4.5), false));
  assert.ok(seesPlayer(s, at(7.5), true));
  assert.ok(!seesPlayer(s, at(8.5), true));
  assert.ok(seesPlayer(s, at(1.8, { crouched: true }), false));
  assert.ok(!seesPlayer(s, at(2.5, { crouched: true }), false));
  assert.ok(!seesPlayer({ ...s, headLifted: false }, at(2), true), 'head hanging = blind');
  assert.ok(!seesPlayer(s, at(2, { hiddenIn: 'H_ARMOIRE' }), true));
  assert.ok(!seesPlayer({ ...s, los: () => false }, at(2), true));
});

test('locket rule: the open lit locket within 4 m in her cone, head lifted', () => {
  const eye: P3 = [0, 0, 5.6];
  const s = { headLifted: true, eye, lookYaw: 0, los: () => true };
  const facingHer = (x: number, o: Partial<PlayerView> = {}) => {
    const p = player([x, 0, 4.1], o);
    return { ...p, beam: { on: true, origin: p.eye, dir: [-1, 0, 0] as P3, range: 14, halfAngle: 0.3, hit: null }, locketRaised: true, ...o };
  };
  assert.ok(seesLocket(s, facingHer(3.5)));
  assert.ok(!seesLocket(s, facingHer(4.8)), 'beyond 4 m');
  assert.ok(!seesLocket(s, { ...facingHer(3), locketRaised: false }));
  assert.ok(!seesLocket(s, { ...facingHer(3), beam: { ...facingHer(3).beam, on: false } }), 'unlit locket');
  assert.ok(!seesLocket({ ...s, headLifted: false }, facingHer(3)));
  assert.ok(!seesLocket({ ...s, lookYaw: Math.PI }, facingHer(3)), 'behind her');
});

test('brain: sighting the lit locket in LOOK enters FINALE even over a chase; she takes it and carries it to the parlor door', () => {
  const b = new AdaBrain(layout, world(initialDoors({ D_ADA: 'open' })), { seed: 3 });
  // player lit, 3 m east of the vigil on the landing, locket raised in the beam toward her
  const ppos: P3 = [2.0, 6.0, 4.1];
  const p = () => {
    const pl = player(ppos);
    const her = b.pos;
    const d: P3 = [her[0] - pl.eye[0], her[1] - pl.eye[1], her[2] + 1.4 - pl.eye[2]];
    const l = Math.hypot(...d);
    return { ...pl, beam: { on: true, origin: pl.eye, dir: [d[0] / l, d[1] / l, d[2] / l] as P3, range: 14, halfAngle: 0.3, hit: null }, locketRaised: true };
  };
  const { events } = run(b, p, 25);
  const fin = events.filter((e) => e.type === 'finale').map((e) => e.phase);
  assert.deepEqual(fin, ['start', 'take', 'at_door']);
  assert.equal(b.state, 'FINALE');
  assert.equal(b.nav.atNode, 'G_PARLOR_LURE');
  assert.ok(!events.some((e) => e.type === 'catch'), 'no catch during the finale');
});

// ------------------------------------------------------------------ priority

test('priority: FINALE > CATCH > SCRIPTED > CHASE > LOOK > newest(LURED|INVESTIGATE) > SEARCH > PATROL > VIGIL', () => {
  const base: PriorityInput = { finale: false, catch: false, scripted: false, chase: false, look: false, luredAt: null, investigateAt: null, search: false, patrol: false };
  const order: [keyof PriorityInput, any, string][] = [
    ['finale', true, 'FINALE'],
    ['catch', true, 'CATCH'],
    ['scripted', true, 'SCRIPTED'],
    ['chase', true, 'CHASE'],
    ['look', true, 'LOOK'],
    ['luredAt', 1, 'LURED'],
    ['search', true, 'SEARCH'],
    ['patrol', true, 'PATROL'],
  ];
  // each layer beats every layer below it, whatever combination is present
  for (let i = 0; i < order.length; i++) {
    const inp: any = { ...base, [order[i][0]]: order[i][1] };
    for (let mask = 0; mask < 1 << (order.length - i - 1); mask++) {
      const x: any = { ...inp };
      for (let j = i + 1; j < order.length; j++) if (mask & (1 << (j - i - 1))) x[order[j][0]] = order[j][1];
      assert.equal(resolvePriority(x), order[i][2], JSON.stringify(x));
    }
  }
  assert.equal(resolvePriority(base), 'VIGIL');
  // newest of LURED / INVESTIGATE
  assert.equal(resolvePriority({ ...base, luredAt: 5, investigateAt: 3 }), 'LURED');
  assert.equal(resolvePriority({ ...base, luredAt: 5, investigateAt: 7 }), 'INVESTIGATE');
  assert.equal(resolvePriority({ ...base, investigateAt: 7, search: true }), 'INVESTIGATE');
  assert.equal(resolvePriority({ ...base, finale: true, catch: true }), 'FINALE', 'FINALE beats CATCH in the same tick');
  for (const s of ['FINALE', 'CATCH', 'SCRIPTED', 'CHASE', 'LOOK', 'LURED', 'INVESTIGATE', 'SEARCH', 'PATROL', 'VIGIL']) assert.ok((ADA_STATES as readonly string[]).includes(s));
});

test('brain: a bell never breaks a CHASE (it is queued); a bell cancels a LOOK; newer noise overrides the lure', () => {
  const b = new AdaBrain(layout, world(), { seed: 11 });
  // lit player in the corridor 4 m south, beam on her → fast LOOK → sees → CHASE
  const p = player([3.0, 4.2, 4.1]);
  const lit = { ...p, beam: { on: true, origin: p.eye, dir: [0.05, 1, -0.1] as P3, range: 14, halfAngle: 0.3, hit: null } };
  const r1 = run(b, lit, 3.0); // wind-up + notice dwell (difficulty 2026-10-08)
  assert.ok(states(r1.events).includes('CHASE'), states(r1.events).join(','));
  assert.equal(b.bell(), 'queued', 'bell queued behind the CHASE');
  assert.ok(b.chase && b.lureQueued && !b.lure);
  assert.equal(b.lurePulls, 0);
  // LOOK then bell: the bell cancels the LOOK
  const b2 = new AdaBrain(layout, world(), { seed: 11 });
  b2.update(0.05, FAR_PLAYER());
  (b2 as any).startLook('patrol', 0, false, null, 0);
  b2.update(0.05, FAR_PLAYER());
  assert.equal(b2.state, 'LOOK');
  assert.equal(b2.bell(), 'lured');
  assert.equal(b2.look, null);
  const r2 = run(b2, FAR_PLAYER, 0.2);
  assert.deepEqual(states(r2.events), ['LURED']);
  // a newer noise pulls her off the lure (a pry outside the thunder brings her back)
  const b3 = new AdaBrain(layout, world(), { seed: 11 });
  b3.bell();
  run(b3, FAR_PLAYER, 20);
  assert.equal(b3.state, 'LURED');
  b3.noise({ pos: [3.4, 8.2, 4.1], room: 'U1', radius: 14, source: 'player' });
  const r3 = run(b3, FAR_PLAYER, 0.2);
  assert.ok(['LISTEN', 'INVESTIGATE'].includes(b3.state), b3.state);
  assert.equal(b3.lure, null);
  void r3;
});

// ------------------------------------------------------------------ lure

test('lure: 60 / 50 / 40 / 40 s (floor 40); reset on death (grace)', () => {
  assert.deepEqual([1, 2, 3, 4, 7].map(lureDuration), [60, 50, 40, 40, 40]);
  const b = new AdaBrain(layout, world(), { seed: 5 });
  const holds: number[] = [];
  for (let k = 0; k < 4; k++) {
    assert.equal(b.bell(), 'lured');
    let arrive = -1;
    let end = -1;
    let t = 0;
    while (end < 0 && t < 200) {
      const o = b.update(0.05, FAR_PLAYER());
      t += 0.05;
      for (const e of o.events) if (e.type === 'lured') (e.phase === 'arrive' ? (arrive = t) : (end = t));
    }
    holds.push(Math.round(end - arrive));
    run(b, FAR_PLAYER, 5);
  }
  assert.deepEqual(holds, [60, 50, 40, 40]);
  b.grace([2.5, 8.2, 0.6], 'G1');
  assert.equal(b.lurePulls, 0);
  assert.equal(b.nextLureDuration(), 60);
});

// ------------------------------------------------------------------ hides

test('hide rule: seen within 2 s of entry; audible within 2 m; breath at the slats; first hide unfailable', () => {
  assert.ok(seenEntering(10, 8.5));
  assert.ok(!seenEntering(10, 7.9));
  assert.ok(!seenEntering(10, -Infinity));
  assert.ok(audibleFromHide(1.5, 3));
  assert.ok(!audibleFromHide(2.5, 3), 'beyond 2 m');
  assert.ok(!audibleFromHide(1.5, 1.2), 'too quiet');
  assert.ok(breathGivesAway(true, 1, false));
  assert.ok(!breathGivesAway(true, 1, true));
  assert.ok(!breathGivesAway(false, 1, false));
  const tr = new HideTracker(layout.hides);
  const first = tr.enter('H_ARMOIRE', 10, 9.5);
  assert.equal(first.unfailable, true);
  assert.equal(first.found, null, 'seen entering the FIRST hide: still safe');
  assert.equal(tr.fail('breath'), false);
  tr.exit();
  tr.spendFirstHide();
  const second = tr.enter('H_ARMOIRE', 20, 19);
  assert.equal(second.found, 'seen_entering');
});

test('brain: hiding right after being seen → she tears the hide open (CATCH)', () => {
  const b = new AdaBrain(layout, world(initialDoors({ D_HARLAN: 'open' })), { seed: 2 });
  b.spendFirstHide();
  const pos: P3 = [2.55, 4.2, 4.1]; // at the armoire
  const p = player(pos);
  const lit = { ...p, beam: { on: true, origin: p.eye, dir: [0.1, 1, -0.1] as P3, range: 14, halfAngle: 0.3, hit: null } };
  run(b, lit, 3.0); // beam → LOOK → notice → CHASE (difficulty 2026-10-08 timings)
  assert.equal(b.state, 'CHASE');
  const { events } = run(b, { ...player(pos), hiddenIn: 'H_ARMOIRE' }, 6);
  assert.ok(events.some((e) => e.type === 'hide_found' && e.hideId === 'H_ARMOIRE'));
  assert.ok(events.some((e) => e.type === 'catch' && e.cause === 'hide'));
});

test('brain: breath at the slats — held = safe, unheld = found; a gasp within 2 m = found', () => {
  const setup = () => {
    const b = new AdaBrain(layout, world(), { seed: 9, startNode: 'U_ARMOIRE' });
    b.spendFirstHide();
    b.update(0.05, { ...player([2.55, 4.2, 4.1]), hiddenIn: 'H_ARMOIRE' });
    return b;
  };
  const hidden = (holding: boolean) => ({ ...player([2.55, 4.2, 4.1]), hiddenIn: 'H_ARMOIRE', holdingBreath: holding });
  // she LOOKs at the slats (a hide-check look)
  const b1 = setup();
  (b1 as any).startLook('hide', 0, false, 'H_ARMOIRE', 0);
  const r1 = run(b1, hidden(true), 5);
  assert.ok(!r1.events.some((e) => e.type === 'catch'), 'held breath: safe');
  const b2 = setup();
  (b2 as any).startLook('hide', 0, false, 'H_ARMOIRE', 0);
  const r2 = run(b2, hidden(false), 5);
  assert.ok(r2.events.some((e) => e.type === 'catch' && e.cause === 'hide'), 'unheld: found');
  const b3 = setup();
  b3.noise({ pos: [2.55, 4.2, 4.1], room: 'U1', radius: TUNING.noise.gasp, source: 'player' });
  const r3 = run(b3, hidden(false), 0.2);
  assert.ok(r3.events.some((e) => e.type === 'catch'), 'gasp');
});

test('brain: B05 demo — the first hide cannot be failed even without holding the breath; she returns to her vigil', () => {
  const b = new AdaBrain(layout, world(), { seed: 4 });
  b.setScripted('hide_demo', { hideId: 'H_ARMOIRE' });
  const events: any[] = [];
  let doneAt: string | null = null;
  for (let i = 0; i < 800 && !doneAt; i++) {
    const o = b.update(0.05, { ...player([2.55, 4.2, 4.1]), hiddenIn: 'H_ARMOIRE' });
    events.push(...o.events);
    if (o.events.some((e: any) => e.type === 'scripted_done')) doneAt = b.nav.atNode;
  }
  assert.ok(!events.some((e) => e.type === 'catch'));
  assert.ok(events.some((e) => e.type === 'voice' && e.trigger === 'ai:hide_check_look'), '…Harlan? at the slats');
  assert.ok(events.some((e) => e.type === 'scripted_done' && e.mode === 'hide_demo'));
  assert.equal(b.hides.firstHideDone, true);
  assert.equal(doneAt, 'U_VIGIL');
  assert.equal(b.state, 'VIGIL');
});

test('brain: post-sprint panting (2.5 m, 4 s) gives a hider away within 2 m', () => {
  const b = new AdaBrain(layout, world(), { seed: 12, startNode: 'U_ARMOIRE' });
  b.spendFirstHide();
  const pos: P3 = [2.55, 4.2, 4.1];
  run(b, { ...player(pos), running: true, speed: 3.6 }, 2); // sprinting right there (she cannot see: head hanging)
  const r = run(b, { ...player(pos), hiddenIn: 'H_ARMOIRE' }, 1);
  assert.ok(r.events.some((e) => e.type === 'hide_found'));
});

// ------------------------------------------------------------------ grace, relocation, determinism

test('grace: farthest anchor not in view, PATROL-only, hearing −30 % for 30 s (difficulty 2026-10-08)', () => {
  const canSee = (p: P3) => Math.hypot(p[0] - 1.8, p[1] - 0.45) < 0.1; // the player can see the south window only
  const b = new AdaBrain(layout, world(initialDoors(), () => true, canSee), { seed: 1 });
  run(b, FAR_PLAYER, 1);
  const chosen = b.grace([3.1, 8.2, 4.1], 'U1'); // standing at her vigil: farthest = the south window, but it is in view
  assert.equal(chosen, 'U_VIGIL');
  assert.equal(b.state, 'PATROL');
  assert.ok(b.patrolOnly && b.graceActive);
  // patrol-only: a loud noise right beside her is ignored for the first seconds
  b.noise({ pos: b.pos, room: b.room, radius: 10, source: 'player' });
  const r = run(b, FAR_PLAYER, 1);
  assert.ok(!states(r.events).includes('LISTEN'));
  assert.equal((b as any).hearingMul(), TUNING.grace.hearingMul);
  run(b, FAR_PLAYER, TUNING.grace.hearingS);
  assert.ok(!b.graceActive);
  assert.equal((b as any).hearingMul(), 1);
  const b2 = new AdaBrain(layout, world(), { seed: 1 });
  assert.equal(b2.grace([3.1, 8.2, 4.1], 'U1'), 'U_SWINDOW');
});

test('grace with every anchor in view: she waits offstage (parked, even under a scripted order) until one is not; saves keep it', () => {
  let seeing = true;
  const b = new AdaBrain(layout, world(initialDoors(), () => true, () => seeing), { seed: 1 });
  b.grace([2.4, 5, 4.1], 'U1');
  assert.equal(b.parked, true);
  b.setScripted('dress');
  let r = run(b, FAR_PLAYER, 2);
  assert.equal(r.out.visible, false);
  assert.equal(r.out.anim, 'hidden');
  const snap = JSON.parse(JSON.stringify(b.snapshot()));
  const c = new AdaBrain(layout, world(initialDoors(), () => true, () => seeing), { seed: 1 });
  c.restore(snap);
  assert.equal(c.parked, true);
  seeing = false;
  r = run(c, FAR_PLAYER, 0.1);
  assert.ok(r.events.some((e) => e.type === 'relocated' && !e.forced));
  assert.equal(c.parked, false);
});

test('a found hide she cannot reach becomes a SEARCH there, not an instant catch', () => {
  const doors = initialDoors({ D_PASSAGE: 'locked' });
  const b = new AdaBrain(layout, world(doors), { seed: 6 });
  b.spendFirstHide();
  (b as any).hideFound('H_CLOSET'); // the closet's check node is behind the bolted passage
  const r = run(b, { ...player([0.55, 9.65, 0.6]), hiddenIn: 'H_CLOSET' }, 3);
  assert.ok(!r.events.some((e) => e.type === 'catch'));
  assert.ok(['SEARCH', 'LOOK', 'LISTEN', 'INVESTIGATE'].includes(b.state), b.state);
});

test('relocation never happens in the player\'s view (deferred until out of sight)', () => {
  let seeing = true;
  const b = new AdaBrain(layout, world(initialDoors(), () => true, () => seeing), { seed: 1 });
  assert.equal(b.relocate('U_SWINDOW'), false);
  run(b, FAR_PLAYER, 1);
  assert.notEqual(b.nav.atNode, 'U_SWINDOW');
  seeing = false;
  const r = run(b, FAR_PLAYER, 0.1);
  assert.ok(r.events.some((e) => e.type === 'relocated' && e.node === 'U_SWINDOW' && !e.forced));
});

test('determinism: same seed + same inputs → identical trajectories; snapshot/restore resumes identically', () => {
  const trace = (seed: number, snapAt = -1) => {
    let b = new AdaBrain(layout, world(), { seed });
    const out: string[] = [];
    for (let i = 0; i < 1600; i++) {
      if (i === 400) b.bell();
      if (i === snapAt) {
        const snap = JSON.parse(JSON.stringify(b.snapshot()));
        b = new AdaBrain(layout, world(), { seed: 999 });
        b.restore(snap);
      }
      const o = b.update(0.05, FAR_PLAYER());
      if (i % 20 === 0) out.push(`${o.state}:${o.pos.map((v: number) => v.toFixed(3)).join(',')}`);
    }
    return out.join('|');
  };
  assert.equal(trace(42), trace(42));
  assert.notEqual(trace(42), trace(43));
  assert.equal(trace(42, 800), trace(42), 'restore mid-lure');
});

// ------------------------------------------------------------------ M1 exit test

test('M1: at her vigil, walking the runner 5 m away is safe; running is not', () => {
  const walk = new AdaBrain(layout, world(), { seed: 21 });
  const runB = new AdaBrain(layout, world(), { seed: 21 });
  for (let i = 0; i < 40; i++) {
    const y = 4.0 - i * 0.05;
    const p = player([2.4, y, 4.1]);
    if (i % 6 === 0) walk.noise({ pos: p.pos, room: 'U1', radius: TUNING.noise.runner, source: 'player' });
    if (i % 3 === 0) runB.noise({ pos: p.pos, room: 'U1', radius: TUNING.noise.run, source: 'player' });
    walk.update(0.05, p);
    runB.update(0.05, { ...p, running: true, speed: 3.6 });
  }
  assert.equal(walk.state, 'VIGIL');
  assert.ok(['LISTEN', 'INVESTIGATE'].includes(runB.state), runB.state);
});

test('brain: investigate → LISTEN (drip stops) → walk at 1.4 m/s → LOOK with the crack and "…Harlan?"', () => {
  const b = new AdaBrain(layout, world(initialDoors({ D_HARLAN: 'open' })), { seed: 8 });
  b.noise({ pos: [2.2, 6.9, 4.1], room: 'U1', radius: 4, source: 'player' }); // away from any hide
  const outs: any[] = [];
  const ev: any[] = [];
  for (let i = 0; i < 200; i++) {
    const o = b.update(0.05, FAR_PLAYER());
    outs.push(o);
    ev.push(...o.events);
  }
  const st = states(ev);
  assert.deepEqual(st.slice(0, 3), ['LISTEN', 'INVESTIGATE', 'LOOK']);
  assert.ok(outs.find((o) => o.state === 'LISTEN')!.tells.dripStopped);
  const walking = outs.filter((o) => o.state === 'INVESTIGATE' && o.speed > 0.1);
  const atSpeed = walking.filter((o) => Math.abs(o.speed - TUNING.speed.investigate) < 0.05).length;
  assert.ok(atSpeed >= walking.length * 0.8 && walking.every((o) => o.speed <= TUNING.speed.investigate + 1e-6), 'investigate speed');
  assert.ok(outs.some((o) => o.tells.crack));
  assert.ok(ev.some((e) => e.type === 'voice' && e.trigger === 'ai:look_lift'));
});

test('brain: CHASE lost for 4 s → SEARCH (≤ 2 LOOKs, then listens at the nearest hide)', () => {
  const b = new AdaBrain(layout, world(), { seed: 13 });
  (b as any).startChase([2.4, 4.0, 4.1], 'U1');
  const ev: any[] = [];
  let listened = false;
  for (let i = 0; i < 900; i++) {
    const o = b.update(0.05, FAR_PLAYER());
    ev.push(...o.events);
    if (o.state === 'SEARCH' && o.phase === 'hide_listen') listened = true;
  }
  const st = states(ev);
  assert.ok(st.includes('SEARCH'), st.join(','));
  const lookCount = st.slice(st.indexOf('SEARCH')).filter((s) => s === 'LOOK').length;
  assert.ok(lookCount >= 2 && lookCount <= 3, `looks ${lookCount} (2 search looks + 1 at the slats)`);
  assert.ok(listened, 'listened at a hide');
});

test('brain: chase speed bursts at 3.2 m/s (never faster than the player run 3.6)', () => {
  const b = new AdaBrain(layout, world(), { seed: 14 });
  (b as any).startChase([2.4, 0.6, 4.1], 'U1');
  let max = 0;
  for (let i = 0; i < 60; i++) {
    const o = b.update(0.05, { ...player([2.4, 0.6, 4.1]) });
    if (o.state === 'CHASE') max = Math.max(max, o.speed);
    if (b.state !== 'CHASE') break;
  }
  assert.ok(max <= TUNING.speed.chase + 1e-6 && max > 3.0, `max ${max}`);
});

// ------------------------------------------------------------------ search at Harlan's bed

test("search: beside Harlan's bed (U2) she plays search_bed for the whole 4 s clip, facing the bed; elsewhere search_plaster", () => {
  const bed = bedBox(layout);
  assert.ok(bed && bed.room === 'U2', 'P_BED is in U2');
  const searchAt = (b: AdaBrain) =>
    (b.search = { id: 50, phase: 'plaster', t: 0, dur: 0, looks: 0, target: [...b.pos] as P3, room: b.room, hideNode: null, hideId: null } as any);
  const b = new AdaBrain(layout, world(), { seed: 3 });
  b.relocate('U2_BEDLOOK', true);
  assert.equal(b.room, 'U2');
  searchAt(b);
  const o = b.update(0.05, FAR_PLAYER());
  assert.equal(o.state, 'SEARCH');
  assert.equal(o.anim, 'search_bed');
  assert.equal(o.tells.loop, null, 'no nails-on-plaster foley at the bed');
  const q = bedNearest(bed!, b.pos);
  const want = Math.atan2(q[1] - b.pos[1], q[0] - b.pos[0]);
  assert.ok(Math.abs(Math.atan2(Math.sin(o.facing - want), Math.cos(o.facing - want))) < 1e-6, 'she faces the bed edge');
  run(b, FAR_PLAYER, TUNING.search.bedS - 0.3);
  assert.equal(b.search?.phase, 'plaster', 'the one-shot is not cut at the 2 s plaster beat');
  run(b, FAR_PLAYER, 0.5);
  assert.equal(b.search?.phase, 'look', 'then she looks round');
  // anywhere else: the plaster search
  const b2 = new AdaBrain(layout, world(), { seed: 3 });
  b2.relocate('U_VIGIL', true);
  searchAt(b2);
  const o2 = b2.update(0.05, FAR_PLAYER());
  assert.equal(o2.anim, 'search_plaster');
  assert.equal(o2.tells.loop, 'nails_plaster');
  run(b2, FAR_PLAYER, TUNING.search.betweenLooksS + 0.1);
  assert.equal(b2.search?.phase, 'look');
});

// ------------------------------------------------------------------ difficulty tuning 2026-10-08 (ROADMAP "Difficulty")

test('difficulty: a glance across her cone is a near miss — she must hold you in sight for noticeS before a CHASE', () => {
  const b = new AdaBrain(layout, world(), { seed: 5 });
  b.update(0.05, FAR_PLAYER());
  const at = b.pos;
  const pv = player([at[0], at[1] - 3.2, at[2]]); // dark, 3.2 m away (beyond closeM), straight ahead of her look
  (b as any).startLook('patrol', (b as any).yawTo(pv.eye), true, null, 0);
  run(b, FAR_PLAYER, TUNING.look.windupFast + 0.05); // head lifted, sight phase
  const brief = run(b, pv, TUNING.sight.noticeS * 0.5);
  run(b, FAR_PLAYER, 0.3);
  assert.ok(!states(brief.events).includes('CHASE') && !b.chase, 'a brief glance is not a chase');
  const held = run(b, pv, TUNING.sight.noticeS + 0.2);
  assert.ok(b.chase || states(held.events).includes('CHASE'), 'held in sight → CHASE');
});

test('difficulty: post-cutscene calm — nothing is perceived (sight, noise, beam, contact) for 6 s, then rules resume', () => {
  const b = new AdaBrain(layout, world(), { seed: 6 });
  b.update(0.05, FAR_PLAYER());
  const at = b.pos;
  b.calm();
  const close = () => {
    const pv = player([at[0] + 0.3, at[1], at[2]]);
    return { ...pv, beam: { on: true, origin: pv.eye, dir: [-1, 0, -0.1] as P3, range: 14, halfAngle: 0.3, hit: null } };
  };
  b.noise({ pos: at, room: b.room, radius: 10, source: 'player' });
  const r = run(b, close, TUNING.grace.calmS - 0.2);
  assert.ok(!r.events.some((e) => e.type === 'catch'), 'no catch inside the calm window');
  assert.ok(!['LISTEN', 'LOOK', 'CHASE', 'INVESTIGATE'].some((s) => states(r.events).includes(s)), states(r.events).join(','));
  // (gameplay review) the bump first startles her (fast LOOK wind-up, the tell), then the grab
  const after = run(b, close, 3);
  assert.ok(after.events.some((e) => e.type === 'catch'), 'standing in her path after the calm is a catch');
});

test('difficulty: she abandons a chase after giveUpS even while she still senses you', () => {
  const b = new AdaBrain(layout, world(), { seed: 7 });
  b.update(0.05, FAR_PLAYER());
  const far = FAR_PLAYER();
  (b as any).startChase(far.pos, far.room);
  let t = 0;
  while (t < TUNING.chase.giveUpS + 1 && b.chase) {
    (b as any).chase.lastSenseT = (b as any).t; // she keeps sensing you every tick
    b.update(0.05, far);
    t += 0.05;
  }
  assert.ok(!b.chase, `chase still on after ${t.toFixed(1)} s`);
  assert.ok(t > TUNING.chase.giveUpS - 0.1 && t <= TUNING.chase.giveUpS + 0.2, t.toFixed(2));
});

test('difficulty: the beam on her body is a FAST wind-up only within fastBeamM; from across the room a normal LOOK', () => {
  for (const [d, fast] of [[3, true], [6, false]] as const) {
    const b = new AdaBrain(layout, world(), { seed: 8 });
    b.update(0.05, FAR_PLAYER());
    const at = b.pos;
    const pv = player([at[0], at[1] - d, at[2]]);
    const lit = { ...pv, beam: { on: true, origin: pv.eye, dir: [0, 1, -0.05] as P3, range: 14, halfAngle: 0.3, hit: null } };
    b.update(0.05, lit);
    assert.ok(b.look, `LOOK at ${d} m`);
    assert.equal(b.look!.windup, fast ? TUNING.look.windupFast : TUNING.look.windup, `${d} m`);
  }
});

test('difficulty (gameplay review): an unaware bump is a tell first — she stops and looks (fast wind-up); step away and you live, stay and she grabs', () => {
  const mk = () => {
    const b = new AdaBrain(layout, world(), { seed: 9 });
    b.update(0.05, FAR_PLAYER());
    return b;
  };
  // stay: caught within a few seconds, and the first state after the bump is a LOOK (not an instant catch)
  const b1 = mk();
  const at = b1.pos;
  const stay = () => player([at[0] + 0.3, at[1], at[2]]);
  const r1 = run(b1, stay, 0.3);
  assert.ok(!r1.events.some((e) => e.type === 'catch'), 'no instant catch on the bump');
  assert.ok(states(r1.events).includes('LOOK'), 'the bump starts a LOOK: ' + states(r1.events).join(','));
  const r1b = run(b1, stay, 3);
  assert.ok(r1b.events.some((e) => e.type === 'catch'), 'staying in contact after the wind-up is a catch');
  // step away during the wind-up: no catch
  const b2 = mk();
  const at2 = b2.pos;
  run(b2, () => player([at2[0] + 0.3, at2[1], at2[2]]), 0.2);
  const r2 = run(b2, FAR_PLAYER, 3);
  assert.ok(!r2.events.some((e) => e.type === 'catch'), 'stepping away during the wind-up survives');
});

// ------------------------------------------------------------------ respawn fairness (round E ruling b)

test('grace away rule: an idle torch-off player at each upper/ground checkpoint survives 60 s; she resumes after awayS; walking into her still kills', () => {
  const CPS: [string, P3, 'upper' | 'upper_dress' | 'ground_finale', DoorMap][] = [
    ['CP3', [2.55, 4.2, 4.1], 'upper', {}],
    ['CP4', [5.6, 2.3, 4.1], 'upper', { D_HARLAN: 'open', D_DRESSING: 'open' }],
    ['CP5', [2.5, 7.3, 4.1], 'upper', { D_ADA: 'open' }],
    ['CP6', [6.4, 7.6, 4.1], 'upper_dress', { D_ADA: 'open' }],
    ['CP7', [4.7, 8.6, 0.6], 'ground_finale', { D_ADA: 'open', D_PASSAGE: 'open' }],
  ];
  for (const [cp, pos, kind, extra] of CPS)
    for (const seed of [1, 3, 5]) {
      const b = new AdaBrain(layout, world(initialDoors(extra)), { seed });
      b.setRoutine(kind);
      run(b, FAR_PLAYER, seed); // she is somewhere on her lap when the player dies
      const P = player(pos);
      b.grace(P.pos, P.room);
      let minD = 99;
      const { events } = run(b, () => {
        if (Math.abs(b.pos[2] - pos[2]) < 2) minD = Math.min(minD, Math.hypot(b.pos[0] - pos[0], b.pos[1] - pos[1]));
        return P;
      }, 60);
      assert.ok(!events.some((e) => e.type === 'catch'), `${cp} seed ${seed}: caught while idle`);
      assert.ok(minD >= 4, `${cp} seed ${seed}: she came to ${minD.toFixed(2)} m`);
    }
  // after the window she patrols the full lap again (CP3: she held at her vigil, then walks the runner)
  const b = new AdaBrain(layout, world(), { seed: 1 });
  b.grace([2.55, 4.2, 4.1], 'U1');
  run(b, player([2.55, 4.2, 4.1]), 30);
  const held = b.pos;
  let moved = 0;
  run(b, () => {
    moved = Math.max(moved, Math.hypot(b.pos[0] - held[0], b.pos[1] - held[1]));
    return player([2.55, 4.2, 4.1]);
  }, TUNING.grace.awayS);
  assert.ok(moved > 2, `she resumes her lap after awayS (moved ${moved.toFixed(2)} m)`);
  // a player who walks into her during the window still gets the bump tell, then the grab
  const b2 = new AdaBrain(layout, world(), { seed: 1 });
  b2.grace([2.55, 4.2, 4.1], 'U1');
  run(b2, player([2.55, 4.2, 4.1]), 15);
  const at = b2.pos;
  const r = run(b2, player([at[0] + 0.3, at[1], at[2]]), 4);
  assert.ok(r.events.some((e) => e.type === 'catch'), 'contact during the away window still catches');
});

test("B11 'let her look' stall (round E): beam on her body but her eyes can't reach the holder → she walks toward the light, looks at it from 2.5 m, sees the locket", () => {
  const P: P3 = [2.41, 8.28, 0.6];
  let b: AdaBrain;
  // the main stair's balustrade/soffit: her eye → the player is blocked while she is > 4.5 m away; lens → her chest is clear
  const los: WorldQuery['lineOfSight'] = (a, c) => {
    const e = (b as any).eye() as P3;
    const atEye = (q: P3) => Math.hypot(q[0] - e[0], q[1] - e[1], q[2] - e[2]) < 0.05;
    return !(atEye(a) || atEye(c)) || Math.hypot(e[0] - P[0], e[1] - P[1]) < 4.5;
  };
  const doors: DoorMap = {};
  for (const d of layout.doors) doors[d.id] = 'open';
  b = new AdaBrain(layout, world(doors, los), { seed: 1 });
  b.setRoutine('ground_finale');
  (b as any).nav.placeFree([0.11, 3.73, 1.24], 'G1');
  const pv = (): PlayerView => {
    const eye: P3 = [P[0], P[1], P[2] + 1.65];
    const a = b.pos;
    const v: P3 = [a[0] - eye[0], a[1] - eye[1], a[2] + TUNING.light.chestHeight - eye[2]];
    const l = Math.hypot(...v);
    return player(P, { locketRaised: true, beam: { on: true, origin: [eye[0] + (v[0] / l) * 0.3, eye[1] + (v[1] / l) * 0.3, eye[2]], dir: [v[0] / l, v[1] / l, v[2] / l], range: 14, halfAngle: 0.3, hit: null } });
  };
  const { events } = run(b, pv, 30, 1 / 30);
  const fin = events.find((e) => e.type === 'finale' && e.phase === 'start');
  assert.ok(fin, `no finale in 30 s (state ${b.state} at ${b.pos.map((x) => x.toFixed(2))})`);
  assert.ok(!events.some((e) => e.type === 'catch'));
});

// ---- C2-ESCAPE §4.5: b05_return (B05 from the stair top; b04_chase is retired)
const TOP: P3 = [0.55, 8.25, 4.1]; // CP2 feet (the stair-top eye S = (1.05, 8.25, 5.75))
function b05(seed = 1) {
  const doors = initialDoors({ D_PARLOR: 'locked' } as DoorMap);
  const b = new AdaBrain(layout, world(doors), { seed });
  b.setScripted('b05_return', { node: 'G_PARLOR_LURE', force: true });
  b.calm();
  return b;
}
function runB05(b: AdaBrain, pv: (t: number) => PlayerView, seconds: number) {
  const log: { t: number; e: any }[] = [];
  let firstVisible = -1;
  let out: any = null;
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    const p = pv(t);
    out = b.update(dt, p);
    if (out.visible && firstVisible < 0) firstVisible = t;
    for (const e of out.events) log.push({ t, e });
  }
  return { log, firstVisible, out };
}

test('b05_return idle (player stays in the open at the stair top): offstage 15 s, key → door → hall → stops blind at tread 10 until 45 s → tops the stair; never catches', () => {
  const b = b05();
  const { log, firstVisible, out } = runB05(b, () => player(TOP), 70);
  const ph = (p: string) => log.find((x) => x.e.type === 'b05_return' && x.e.phase === p)?.t ?? -1;
  assert.ok(Math.abs(ph('key') - TUNING.b05.maxStartS) < 0.1, `key at ${ph('key')}`);
  assert.ok(firstVisible >= TUNING.b05.minStartS, `first seen at ${firstVisible}`);
  assert.ok(ph('door') > ph('key') && ph('hall') > ph('door') && ph('climb') > ph('hall'), 'phase order');
  assert.ok(ph('rocker') > ph('hall'), 'the rocker after the hall');
  const wait = ph('blind_wait');
  assert.ok(wait > 0 && wait < TUNING.b05.blindUntilS, `blind wait at ${wait}`);
  assert.ok(ph('top') >= TUNING.b05.blindUntilS, `tops the stair at ${ph('top')}`);
  assert.ok(log.some((x) => x.e.type === 'door' && x.e.doorId === 'D_PARLOR'), 'she pushes the parlor door');
  assert.ok(log.some((x) => x.e.type === 'scripted_done' && x.e.mode === 'b05_return'));
  const top = ph('top');
  assert.ok(!log.some((x) => x.e.type === 'catch' && x.t < top + TUNING.grace.calmS), 'no catch inside the mode nor in the 6 s calm after it');
  assert.ok(!log.some((x) => x.e.type === 'relocated' && x.t >= top - 0.01), 'no relocation when she tops the stair (she stays where the player can see her)');
  assert.ok(out.pos[2] > 3.5, `upstairs at the end (${out.pos.map((v: number) => v.toFixed(2))})`);
});

test('b05_return: the head is carried hanging (blind) the whole return; the carried head knocks on her thigh while she walks', () => {
  const b = b05(3);
  let lifted = false;
  let knocks = 0;
  for (let t = 0; t < 40; t += 1 / 30) {
    const o = b.update(1 / 30, player(TOP, { beam: { on: true, origin: [1.05, 8.0, 5.75], dir: [0, -0.6, -0.8], range: 14, halfAngle: 0.3, hit: null } }));
    if (o.head !== 'hanging') lifted = true;
    if (o.tells.knock) knocks++;
  }
  assert.equal(lifted, false);
  assert.ok(knocks >= 3, `knocks ${knocks}`);
});

test('b05_return hidden early (armoire at +3 s): the return starts at +10 s and turns into the unfailable slat demo', () => {
  const b = b05(2);
  const { log } = runB05(b, (t) => (t < 3 ? player(TOP) : player([2.55, 4.2, 4.1], { hiddenIn: 'H_ARMOIRE' })), 60);
  const key = log.find((x) => x.e.type === 'b05_return' && x.e.phase === 'key')!.t;
  assert.ok(Math.abs(key - TUNING.b05.minStartS) < 0.1, `key at ${key}`);
  assert.ok(log.some((x) => x.e.type === 'scripted_done' && x.e.mode === 'b05_return'), 'handed to the demo');
  assert.ok(log.some((x) => x.e.type === 'scripted_done' && x.e.mode === 'hide_demo'), 'the demo finished');
  assert.ok(!log.some((x) => x.e.type === 'catch' || x.e.type === 'hide_found'), 'unfailable');
});

test('b05_return hidden at +12 s: the key turns as the player hides (between 10 and 15 s)', () => {
  const b = b05(4);
  const { log } = runB05(b, (t) => (t < 12 ? player(TOP) : player([2.55, 4.2, 4.1], { hiddenIn: 'H_ARMOIRE' })), 20);
  const key = log.find((x) => x.e.type === 'b05_return' && x.e.phase === 'key')!.t;
  assert.ok(key >= 12 - 0.05 && key <= 12.1, `key at ${key}`);
});

test('b05_return flee: a player who runs down the stair into her path is never caught inside the mode', () => {
  const b = b05(5);
  // down the flight to the foot, then stand in the hall between her and the stair
  const { log } = runB05(b, (t) => (t < 4 ? player([0.55, 8.0 - t, 4.1 - t * 0.85], { speed: 3, running: true }) : player([1.2, 2.6, 0.6], { speed: 0 })), 40);
  const done = log.find((x) => x.e.type === 'scripted_done')?.t ?? Infinity;
  assert.ok(!log.some((x) => x.e.type === 'catch' && x.t < done), 'no catch inside b05_return');
});

test('far sighting (round E careless gate): a lit player seen at 7 m makes her come and look (INVESTIGATE), not chase; at 3 m she chases', () => {
  for (const [d, want] of [[7, 'INVESTIGATE'], [3, 'CHASE']] as const) {
    const b = new AdaBrain(layout, world(initialDoors({ D_ADA: 'open' })), { seed: 2 });
    b.setRoutine('ground_finale');
    (b as any).nav.placeFree([2.3, 1.2, 0.6], 'G1');
    (b as any).nav.facing = Math.PI / 2; // facing north, up the hall
    const P: P3 = [2.3, 1.2 + d, 0.6];
    const eye: P3 = [P[0], P[1], P[2] + 1.65];
    const toHer: P3 = [0, -1, -0.15];
    const pv = player(P, { beam: { on: true, origin: eye, dir: toHer, range: 14, halfAngle: 0.3, hit: null } });
    const seen = states(run(b, pv, 6, 1 / 30).events);
    assert.ok(seen.includes(want), `${d} m: states ${seen.join(',')}`);
    if (want === 'INVESTIGATE') assert.ok(!seen.includes('CHASE'), `${d} m: chased (${seen.join(',')})`);
  }
});
