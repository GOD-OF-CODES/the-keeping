// CUTSCENES-PLAN §4 (M-A): brain freeze / resume, the optional-cutscene safety gate, the 20 s drop, C4a's deferral,
// the once-per-save flags and C4c's resume at 'carry'. Through the real Director (pure; no three.js).

const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
import layoutJson from '../src/shared/level-layout.json' with { type: 'json' };
import type { LevelLayout, P3 } from '../src/shared/layout-types.ts';
import type { DoorState, PlayerView } from '../src/ai/types.ts';
import { TUNING } from '../src/ai/tuning.ts';
import { Director } from '../src/story/director.ts';
import { OPTIONAL_WAIT_S } from '../src/story/beats.ts';
import { EventBus, type GameEvents } from '../src/core/events.ts';
import { c4cCarryEnd, C4C_STEP_M } from '../src/cutscenes/c4c-step.ts';

const layout = layoutJson as unknown as LevelLayout;
const DOORS: Record<string, DoorState> = {};
for (const d of layout.doors) DOORS[d.id] = d.initial === 'bolted' || d.initial === 'boarded' || d.initial === 'locked' ? 'locked' : d.initial === 'ajar' || d.initial === 'open' ? 'open' : 'closed';

const view = (pos: P3, room: string): PlayerView => {
  const eye: P3 = [pos[0], pos[1], pos[2] + 1.65];
  return { pos, eye, room, crouched: false, running: false, speed: 0, hiddenIn: null, holdingBreath: false, beam: { on: false, origin: eye, dir: [0, 1, 0], range: 14, halfAngle: 0.3, hit: null }, locketRaised: false };
};

function rig(beat: 'B08' | 'B05' = 'B08', played = false) {
  const events = new EventBus<GameEvents>();
  const flags = new Map<string, boolean>();
  const starts: string[] = [];
  events.on('cutscene:start', ({ id }) => starts.push(id));
  let player = view([1.8, -27.4, 0], 'EXT2'); // out on the drive: far from everything
  let los = false;
  let doneCb: ((skipped: boolean) => void) | null = null;
  const dir = new Director({
    layout,
    events,
    flags,
    host: {
      player: () => player,
      doorState: (id) => DOORS[id] ?? 'closed',
      lineOfSight: () => los,
      playerCanSee: () => false,
      ...(played
        ? {
            playCutscene: (_id: string, done: (s: boolean) => void) => {
              doneCb = done;
              return true;
            },
          }
        : {}),
    },
  });
  dir.startAt(beat);
  const b = dir.brain;
  b.graceT = -Infinity;
  const tick = (sec = 0.05) => {
    for (let t = 0; t < sec - 1e-9; t += 0.05) dir.update(0.05);
  };
  tick(0.1);
  return {
    dir,
    b,
    bi: b as any,
    events,
    flags,
    starts,
    tick,
    setPlayer: (p: P3, room: string) => (player = view(p, room)),
    setLos: (v: boolean) => (los = v),
    finish: (skipped = false) => doneCb?.(skipped),
  };
}

/** Pry the three boards inside a thunder roll (silent: she hears nothing, so only the gate decides). */
const pry3 = (r: ReturnType<typeof rig>) => {
  r.b.thunderRoll(0, 8000);
  r.tick(0.1);
  for (const k of [1, 2, 3]) r.events.emit('interact', { id: `board_${k}`, action: 'pry' });
};

test('freeze holds her clock, timers and hearing; resume gives the deaf grace; restore is unfrozen', () => {
  const { b, bi, tick, dir } = rig();
  b.bell();
  assert.ok(b.lure, 'lured');
  const lureT = b.lure!.t;
  const t0 = b.t;
  const out0 = b.update(0.05, view([1.8, -27.4, 0], 'EXT2'));
  b.freeze();
  const held = b.update(1, view([1.8, -27.4, 0], 'EXT2'));
  assert.equal(b.t, t0 + 0.05, 'her clock does not advance while frozen');
  assert.deepEqual(held.pos, out0.pos, 'position held');
  assert.equal(held.state, out0.state, 'state held');
  assert.equal(b.lure!.t, lureT, 'the lure window is paused');
  b.noise({ pos: b.pos, room: b.room, radius: 40, source: 'player' });
  assert.equal(bi.noiseQueue.length, 0, 'a frozen brain hears nothing');
  b.resume();
  assert.ok(!b.frozen);
  assert.ok(b.calmUntil - b.t >= TUNING.grace.resumeDeafS - 1e-9, 'resume adds ≥ 2 s deaf grace');
  b.freeze();
  dir.restore(dir.snapshot() as any);
  assert.ok(!dir.brain.frozen, 'a save restores her unfrozen');
  void tick;
});

test('the Director freezes her for every cutscene and resumes with the 6 s calm', () => {
  const r = rig('B08', true);
  pry3(r);
  r.tick(0.2);
  assert.deepEqual(r.starts, ['C4a'], 'C4a fires when the third board drops (she is far, not chasing)');
  assert.ok(r.b.frozen, 'frozen while the cutscene plays');
  assert.equal(r.flags.get('cs_C4a_done'), true, 'flag set at start: never replays');
  r.finish(false);
  assert.ok(!r.b.frozen, 'resumed');
  assert.ok(r.b.calmActive, 'post-cutscene calm');
  r.tick(1);
  pry3(r);
  r.events.emit('interact', { id: 'T_B09', action: 'b09:enter_u3' });
  r.tick(0.5);
  assert.deepEqual(r.starts, ['C4a'], 'once per save');
});

test('safety gate: CHASE / INVESTIGATE hold the request; a close Ada with line of sight holds it; 20 s → dropped', () => {
  const r = rig('B08', true);
  // she is close, in the same room, in line of sight: the gate fails on distance
  r.setPlayer([r.b.pos[0] + 2, r.b.pos[1], r.b.pos[2]], r.b.room);
  r.setLos(true);
  assert.equal(r.dir.gateHolds('safe'), false, 'close + visible');
  r.setLos(false);
  assert.equal(r.dir.gateHolds('safe'), false, 'the behind-a-door rule needs another room: same room + no LOS still fails');
  r.setLos(true);
  r.bi.chase = { t0: 0 };
  assert.equal(r.dir.gateHolds('safe'), false, 'never from CHASE');
  assert.equal(r.dir.gateHolds('none'), true);
  r.bi.chase = null;
  r.bi.inv = { t0: 0 };
  assert.equal(r.dir.gateHolds('safe'), false, 'never from INVESTIGATE');
  r.bi.inv = null;
  // the request waits while she stays close and in sight (the player shadows her 2 m away, same room, LOS)
  pry3(r);
  const shadow = (sec: number) => {
    for (let t = 0; t < sec - 1e-9; t += 0.05) {
      r.setPlayer([r.b.pos[0] + 1.5, r.b.pos[1], r.b.pos[2]], r.b.room);
      r.dir.update(0.05);
    }
  };
  shadow(1);
  assert.deepEqual(r.dir.pendingCutscenes, ['C4a'], 'waiting on the gate');
  assert.deepEqual(r.starts, []);
  shadow(OPTIONAL_WAIT_S);
  assert.deepEqual(r.dir.pendingCutscenes, [], 'dropped after 20 s');
  assert.deepEqual(r.starts, []);
  assert.equal(r.flags.get('c4a_deferred'), true, 'C4a defers once to the U3 doorway');
  assert.notEqual(r.flags.get('cs_C4a_done'), true);
  r.setPlayer([1.8, -27.4, 0], 'EXT2');
  r.bi.look = r.bi.inv = r.bi.search = r.bi.chase = null;
  r.bi.display = 'PATROL';
  r.events.emit('interact', { id: 'T_B09', action: 'b09:enter_u3' });
  r.dir.update(0.05);
  assert.deepEqual(r.starts, ['C4a'], 'the deferred C4a plays from the doorway');
});

test('pacing: a second optional cutscene within 45 s waits', () => {
  const r = rig('B08', true);
  pry3(r);
  r.tick(0.2);
  r.finish(false);
  assert.equal(r.dir.gateHolds('safe'), false, 'just ended: the 45 s pacing window holds the next one');
  r.tick(46);
  r.bi.look = r.bi.inv = r.bi.search = r.bi.chase = null; // her own wandering states are not under test here
  r.bi.display = 'PATROL';
  assert.equal(r.dir.gateHolds('safe'), true, `after 45 s (she is ${r.b.state}, frozen ${r.b.frozen}, ${r.b.pos})`);
});

test('C4c: the authored take resumes FINALE at carry, one step toward the parlor door', () => {
  const end = c4cCarryEnd([6, 5, 0.6]);
  assert.ok(Math.abs(Math.hypot(end.pos[0] - 6, end.pos[1] - 5) - C4C_STEP_M) < 1e-9);
  const { b } = rig('B08');
  (b as any).finale = { phase: 'take', t: 0.1, lostT: 0, lastPos: [6, 5, 0.6], lastRoom: 'G2' };
  b.finaleSkipTake(end.pos, b.room, end.heading);
  assert.equal(b.finale!.phase, 'carry');
  assert.ok(Math.abs(b.pos[0] - end.pos[0]) < 1e-6 && Math.abs(b.pos[1] - end.pos[1]) < 1e-6);
});

test('C4a: walking into U3 while the request waits turns it into the doorway variant (never the door behind you)', () => {
  const r = rig('B08', true);
  r.setPlayer([r.b.pos[0] + 1.5, r.b.pos[1], r.b.pos[2]], r.b.room);
  r.setLos(true);
  r.bi.inv = { t0: 0 }; // she is investigating: the gate holds the request
  pry3(r);
  r.events.emit('interact', { id: 'T_B09', action: 'b09:enter_u3' });
  assert.equal(r.flags.get('c4a_deferred'), true, 'flag set on entering B09 before the cutscene starts');
  assert.deepEqual(r.starts, []);
  r.bi.inv = null;
  r.bi.look = r.bi.search = r.bi.chase = null;
  r.bi.display = 'PATROL';
  r.setPlayer([1.8, -27.4, 0], 'EXT2');
  r.dir.update(0.05);
  assert.deepEqual(r.starts, ['C4a']);
});
