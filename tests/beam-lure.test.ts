// B08 regression (lane b08): the player waits at the U2 bell pull with the torch on, the beam lighting the north wall
// 0.46 m ahead. The lit spot is behind walls for Ada on her lure route (U1 → stair → G1), so it must NOT spend the
// lure. Before the fix beamNear() had no sight test and the spot drew her back up through the wall every 2.5 s.
// Also: a stimulus repeated at the same spot keeps her route (no re-plan oscillation).

const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
import layoutJson from '../src/shared/level-layout.json' with { type: 'json' };
import type { LevelLayout, P3 } from '../src/shared/layout-types.ts';
import type { DoorState, PlayerView } from '../src/ai/types.ts';
import { beamNear } from '../src/ai/senses.ts';
import { Director } from '../src/story/director.ts';
import { EventBus, type GameEvents } from '../src/core/events.ts';

const layout = layoutJson as unknown as LevelLayout;
const DOORS: Record<string, DoorState> = {};
for (const d of layout.doors) DOORS[d.id] = d.initial === 'bolted' || d.initial === 'boarded' || d.initial === 'locked' ? 'locked' : d.initial === 'ajar' || d.initial === 'open' ? 'open' : 'closed';

const EYE: P3 = [6.1, 4.0, 5.65];
const SPOT: P3 = [6.1, 4.46, 5.5]; // the north wall by P_BELL_PULL
const AT_BELL: PlayerView = { pos: [6.1, 4.0, 4.1], eye: EYE, room: 'U2', crouched: false, running: false, speed: 0, hiddenIn: null, holdingBreath: false, beam: { on: true, origin: EYE, dir: [0, 1, 0], range: 14, halfAngle: 0.3, hit: SPOT }, locketRaised: false };

test('beamNear: a lit spot she cannot see (wall / other floor) does not count; one she can see does', () => {
  const ada: P3 = [2.4, 6.4, 4.1]; // U1, 4.2 m from the spot
  assert.ok(beamNear(AT_BELL.beam, ada), 'distance-only (no world): within 6 m');
  assert.ok(!beamNear(AT_BELL.beam, ada, () => false), 'behind a wall: ignored');
  let probe: P3 | null = null;
  assert.ok(beamNear(AT_BELL.beam, ada, (_a, b) => ((probe = b), true)), 'in sight: investigate');
  assert.ok(probe![1] < SPOT[1] && probe![1] > SPOT[1] - 0.2, 'the sight probe sits just in front of the lit surface');
});

test('B08: the bell lure survives a torch held on the wall by the pull (spot out of her sight)', () => {
  const events = new EventBus<GameEvents>();
  const stims: string[] = [];
  const dir = new Director({
    layout,
    events,
    flags: new Map<string, boolean>(),
    host: { player: () => AT_BELL, doorState: (id) => DOORS[id] ?? 'closed', lineOfSight: () => false, playerCanSee: () => false, sfx: () => {} },
  });
  dir.startAt('B08');
  const b = dir.brain as any;
  b.graceT = -Infinity;
  const oStim = b.stimulus.bind(b);
  b.stimulus = (p: P3, room: string | null, l: number | null) => (stims.push(`${p} ${room}`), oStim(p, room, l));
  for (let i = 0; i < 2; i++) dir.update(0.05);
  events.emit('interact', { id: 'P_BELL_PULL', action: 'pull_bell' });
  let minD = Infinity;
  let scraped = false;
  for (let i = 0; i < 40 * 20; i++) {
    dir.update(0.05);
    minD = Math.min(minD, Math.hypot(b.pos[0] - SPOT[0], b.pos[1] - SPOT[1]));
    if (b.lure?.phase === 'scrape') scraped = true;
  }
  assert.ok(minD <= 6, `precondition: her lure route passes within 6 m of the lit spot (min ${minD.toFixed(1)} m)`);
  assert.deepEqual(stims, [], 'no stimulus from the unseen spot');
  assert.ok(scraped && b.state === 'LURED', `she answers the bell (state ${b.state})`);
});

test('a repeated stimulus at the same spot keeps her route; a moved one re-plans', () => {
  const events = new EventBus<GameEvents>();
  const FAR: PlayerView = { ...AT_BELL, pos: [1.8, -27.4, 0], eye: [1.8, -27.4, 1.65], room: 'EXT2', beam: { ...AT_BELL.beam, on: false, hit: null } };
  const dir = new Director({ layout, events, flags: new Map<string, boolean>(), host: { player: () => FAR, doorState: (id) => DOORS[id] ?? 'closed', lineOfSight: () => false, playerCanSee: () => false, sfx: () => {} } });
  dir.startAt('B08');
  const b = dir.brain as any;
  b.graceT = -Infinity;
  dir.update(0.05);
  const target = [...([...b.g.nodes.values()].find((n: any) => Math.hypot(n.pos[0] - b.pos[0], n.pos[1] - b.pos[1]) > 4 && Math.abs(n.pos[2] - b.pos[2]) < 0.5).pos)] as P3;
  b.stimulus(target, null, 0.05);
  for (let i = 0; i < 10; i++) dir.update(0.05);
  assert.equal(b.inv?.phase, 'go', 'investigating');
  const key = b.nav.goalKey;
  assert.ok(key, 'a route is planned');
  const route = b.nav.route.length;
  for (let k = 0; k < 4; k++) {
    b.stimulus([target[0] + 0.3, target[1], target[2]], b.inv.room, 0.3);
    dir.update(0.05);
    assert.equal(b.nav.goalKey, key, 'same spot: no re-plan (the route key survives the brain tick)');
  }
  assert.ok(b.nav.route.length <= route, 'still on the same route');
  b.stimulus([target[0] + 3, target[1], target[2]], null, 0.3);
  assert.equal(b.nav.goalKey, '', 'moved: re-plan');
});

test('a beam on her body at arm\'s length: the fast LOOK turns to the holder (not the lens beside him) and sees him', () => {
  const events = new EventBus<GameEvents>();
  let pv: PlayerView = { ...AT_BELL, pos: [1.8, -27.4, 0], eye: [1.8, -27.4, 1.65], room: 'EXT2', beam: { ...AT_BELL.beam, on: false, hit: null } };
  const dir = new Director({ layout, events, flags: new Map<string, boolean>(), host: { player: () => pv, doorState: (id) => DOORS[id] ?? 'closed', lineOfSight: () => true, playerCanSee: () => false, sfx: () => {} } });
  dir.startAt('B08');
  const b = dir.brain as any;
  b.graceT = -Infinity;
  const a: P3 = [...b.pos] as P3;
  // the player 0.7 m east of her; the torch lens held 0.5 m to his north (beside him), beam aimed at her chest
  const eye: P3 = [a[0] + 0.7, a[1], a[2] + 1.65];
  const lens: P3 = [eye[0], eye[1] + 0.5, eye[2] - 0.3];
  const chest: P3 = [a[0], a[1], a[2] + 1.2];
  const d = [chest[0] - lens[0], chest[1] - lens[1], chest[2] - lens[2]];
  const n = Math.hypot(...d);
  pv = { pos: [eye[0], eye[1], a[2]], eye, room: b.nav.room, crouched: false, running: false, speed: 0, hiddenIn: null, holdingBreath: false, beam: { on: true, origin: lens, dir: [d[0] / n, d[1] / n, d[2] / n] as P3, range: 14, halfAngle: 0.78, hit: chest }, locketRaised: false };
  const states = new Set<string>();
  for (let i = 0; i < 4 * 20; i++) {
    dir.update(0.05);
    states.add(b.state);
  }
  assert.ok(states.has('LOOK'), 'the beam forces a LOOK');
  assert.ok(states.has('CHASE') || states.has('CATCH'), `…and she sees the torch's holder (states ${[...states].join(',')})`);
});

test('a creeping stimulus (each step < 1 m, e.g. footsteps) still re-plans once it is > 1 m from the planned target', () => {
  const events = new EventBus<GameEvents>();
  const FAR: PlayerView = { ...AT_BELL, pos: [1.8, -27.4, 0], eye: [1.8, -27.4, 1.65], room: 'EXT2', beam: { ...AT_BELL.beam, on: false, hit: null } };
  const dir = new Director({ layout, events, flags: new Map<string, boolean>(), host: { player: () => FAR, doorState: (id) => DOORS[id] ?? 'closed', lineOfSight: () => false, playerCanSee: () => false, sfx: () => {} } });
  dir.startAt('B08');
  const b = dir.brain as any;
  b.graceT = -Infinity;
  dir.update(0.05);
  const target = [...([...b.g.nodes.values()].find((n: any) => Math.hypot(n.pos[0] - b.pos[0], n.pos[1] - b.pos[1]) > 4 && Math.abs(n.pos[2] - b.pos[2]) < 0.5).pos)] as P3;
  b.stimulus(target, null, 0.05);
  for (let i = 0; i < 10; i++) dir.update(0.05);
  assert.equal(b.inv?.phase, 'go', 'investigating');
  const room = b.inv.room;
  const key = b.nav.goalKey;
  let replanned = false;
  for (let k = 1; k <= 4 && !replanned; k++) {
    b.stimulus([target[0] + 0.4 * k, target[1], target[2]], room, 0.3);
    if (b.nav.goalKey !== key) replanned = true;
    dir.update(0.05);
  }
  assert.ok(replanned, 'three 0.4 m steps (1.2 m from the planned target) re-plan the route');
});
