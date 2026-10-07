// Bell-pull lure robustness, through the Director (the runtime path: interact → Story → ai bell → brain → Story).
// Rule: the bell overrides every state except an active CHASE; during a CHASE the lure is QUEUED and fires when the
// chase ends; bell_used is never set without a lure or a queued lure; the pull always rings (sfx bell_pull).

const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
import layoutJson from '../src/shared/level-layout.json' with { type: 'json' };
import type { LevelLayout, P3 } from '../src/shared/layout-types.ts';
import type { DoorState, PlayerView } from '../src/ai/types.ts';
import { ROUTINES } from '../src/ai/ada-brain.ts';
import { TUNING } from '../src/ai/tuning.ts';
import { Director } from '../src/story/director.ts';
import { EventBus, type GameEvents } from '../src/core/events.ts';

const layout = layoutJson as unknown as LevelLayout;

const DOORS: Record<string, DoorState> = {};
for (const d of layout.doors) DOORS[d.id] = d.initial === 'bolted' || d.initial === 'boarded' || d.initial === 'locked' ? 'locked' : d.initial === 'ajar' || d.initial === 'open' ? 'open' : 'closed';

/** The player stands out on the drive: never seen, never heard, never within reach. */
const EYE: P3 = [1.8, -27.4, 1.65];
const FAR: PlayerView = { pos: [1.8, -27.4, 0], eye: EYE, room: 'EXT2', crouched: false, running: false, speed: 0, hiddenIn: null, holdingBreath: false, beam: { on: false, origin: EYE, dir: [0, 1, 0], range: 14, halfAngle: 0.3, hit: null }, locketRaised: false };

function setup() {
  const events = new EventBus<GameEvents>();
  const sfx: string[] = [];
  const stateLog: string[] = [];
  events.on('ai:state', ({ to }) => stateLog.push(to));
  const flags = new Map<string, boolean>();
  const dir = new Director({
    layout,
    events,
    flags,
    host: {
      player: () => FAR,
      doorState: (id) => DOORS[id] ?? 'closed',
      lineOfSight: () => false,
      playerCanSee: () => false,
      sfx: (id) => sfx.push(id),
    },
  });
  dir.startAt('B08');
  const b = dir.brain;
  b.graceT = -Infinity; // no post-respawn PATROL-only window: every state is reachable
  const tick = (sec = 0.05) => {
    for (let t = 0; t < sec - 1e-9; t += 0.05) dir.update(0.05);
  };
  tick(0.1);
  const pull = () => events.emit('interact', { id: 'P_BELL_PULL', action: 'pull_bell' });
  return { dir, b, bi: b as any, events, sfx, flags, stateLog, tick, pull };
}

type Rig = ReturnType<typeof setup>;
const far = (b: Rig['b']): P3 => {
  // a graph node on another floor: a long walk (INVESTIGATE / SEARCH / CHASE targets that don't resolve at once)
  const n = [...b.g.nodes.values()].filter((x) => Math.abs(x.pos[2] - b.pos[2]) > 2)[0];
  return [...n.pos] as P3;
};

/** Put her into `state` the way the brain would, and prove she is there before the pull. */
const ENTER: Record<string, (r: Rig) => void> = {
  VIGIL: ({ b, bi, tick }) => {
    b.setRoutine('upper');
    b.relocate(ROUTINES.upper.vigil!, true);
    b.routine = bi.newRoutine('upper', 'vigil');
    tick();
  },
  PATROL: ({ tick }) => tick(),
  LISTEN: ({ b, bi, tick }) => {
    bi.stimulus(far(b), null, 5);
    tick();
  },
  INVESTIGATE: ({ b, bi, tick }) => {
    bi.stimulus(far(b), null, 0.05);
    tick(0.3);
  },
  LOOK: ({ bi, tick }) => {
    bi.startLook('patrol', 0, false, null, 0);
    tick();
  },
  SEARCH: ({ b, tick }) => {
    b.search = { id: 900, phase: 'go', t: 0, dur: 0, looks: 0, target: far(b), room: null, hideNode: null, hideId: null } as any;
    tick();
  },
  CHASE: ({ b, bi, tick }) => {
    bi.startChase(far(b), null);
    tick();
  },
};

for (const state of ['VIGIL', 'PATROL', 'LISTEN', 'INVESTIGATE', 'LOOK', 'SEARCH'] as const) {
  test(`bell: during ${state} the pull lures her at once (bell_used ⇔ lure) and the pull rings`, () => {
    const r = setup();
    const { b, pull, tick, flags, sfx } = r;
    ENTER[state](r);
    assert.equal(b.state as string, state, `precondition: she is in ${state}`);
    assert.ok(!flags.get('bell_used'));
    pull();
    assert.ok(sfx.includes('bell_pull'), 'the pull always rings');
    assert.ok(b.lure, 'lured');
    assert.equal(flags.get('bell_used'), true);
    assert.equal(r.dir.story.s.flags.bell_used, true);
    assert.equal(b.look, null, 'a LOOK in progress is cancelled');
    assert.equal(b.inv, null, 'LISTEN / INVESTIGATE dropped');
    assert.equal(b.search, null, 'SEARCH dropped');
    tick();
    assert.equal(b.state, 'LURED');
  });
}

test('bell: during CHASE the lure is queued (bell_used set), the chase is not broken, and it fires when the chase ends', () => {
  const r = setup();
  const { b, pull, tick, flags, stateLog } = r;
  ENTER.CHASE(r);
  assert.equal(b.state, 'CHASE');
  pull();
  assert.equal(flags.get('bell_used'), true, 'bell_used with a queued lure');
  assert.ok(b.chase, 'a bell never breaks a CHASE');
  assert.equal(b.lure, null);
  assert.equal(b.lureQueued, true);
  pull(); // a second pull while queued stays one queued lure
  assert.equal(b.lurePulls, 0, 'counted when it fires');
  tick(0.5);
  assert.equal(b.state, 'CHASE', 'still chasing');
  stateLog.length = 0;
  tick(TUNING.chase.lostS + 1); // nobody sensed: the chase is lost
  assert.equal(b.chase, null);
  assert.equal(b.state, 'LURED', stateLog.join(','));
  assert.ok(!stateLog.includes('SEARCH'), `no SEARCH in between: ${stateLog.join(',')}`);
  assert.equal(b.lureQueued, false);
  assert.equal(b.lurePulls, 1);
});

test('bell: a lure queued behind a CHASE is dropped by a catch (the death resets it)', () => {
  const r = setup();
  const { b, bi, pull } = r;
  ENTER.CHASE(r);
  pull();
  assert.equal(b.lureQueued, true);
  bi.doCatch('chase');
  assert.equal(b.lureQueued, false);
  assert.equal(b.lure, null);
});

test('bell: ignored while SCRIPTED or once the nonstop bell runs — the pull rings but bell_used stays unset', () => {
  const r = setup();
  const { b, pull, flags, sfx } = r;
  b.setScripted('hold', { node: 'G_PARLOR_LURE', force: true });
  pull();
  assert.ok(sfx.includes('bell_pull'));
  assert.equal(b.lure, null);
  assert.equal(b.lureQueued, false);
  assert.ok(!flags.get('bell_used'), 'no lure → no bell_used');
  const r2 = setup();
  r2.b.setRoutine('ground_finale');
  r2.pull();
  assert.equal(r2.b.lure, null);
  assert.ok(!r2.flags.get('bell_used'));
});

test('bell: once lured she walks down the stairs (the drip recedes below) and scrapes at the parlor door', () => {
  const r = setup();
  const { b, pull } = r;
  const z0 = b.pos[2];
  assert.ok(z0 > 3, 'she starts upstairs');
  pull();
  let downAt = -1;
  let scraped = false;
  for (let i = 0; i < 1200 && !scraped; i++) {
    const out = r.dir.update(0.05);
    if (downAt < 0 && b.pos[2] < z0 - 2) downAt = i * 0.05;
    scraped = out?.anim === 'lured_scrape';
  }
  assert.ok(downAt >= 0, 'she went down a floor');
  assert.ok(scraped, 'she arrives and scrapes at the parlor door');
  assert.equal(b.state, 'LURED');
});

test('bell: a queued lure survives a save / restore (and older saves without it restore unqueued)', () => {
  const r = setup();
  ENTER.CHASE(r);
  r.pull();
  const snap = r.b.snapshot();
  assert.equal(snap.lureQueued, true);
  const r2 = setup();
  r2.b.restore(JSON.parse(JSON.stringify(snap)));
  assert.equal(r2.b.lureQueued, true);
  const old = JSON.parse(JSON.stringify(snap));
  delete old.lureQueued;
  r2.b.restore(old);
  assert.equal(r2.b.lureQueued, false);
});
