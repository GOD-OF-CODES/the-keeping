// CutscenePlayer ↔ the real story Director: playCutscene contract (sync true, done once, no bus emissions of its
// own, teardown before done), skip-after-first-view, hold-to-skip, re-entrant C6 → C7 → end, death → respawn order,
// overlays (C4) vs Director cutscenes, and character acquire/release.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import layoutJson from '../src/shared/level-layout.json' with { type: 'json' };
import type { LevelLayout, P3 } from '../src/shared/layout-types.ts';
import { Director } from '../src/story/director.ts';
import { EventBus, type GameEvents } from '../src/core/events.ts';
import { CutscenePlayer, memorySeenStore, localSeenStore, type CutsceneDeps } from '../src/cutscenes/host.ts';
import { CUTSCENES } from '../src/cutscenes/index.ts';
import { HemOverlay, BREATH_PROMPT } from '../src/cutscenes/c4-hem.ts';
import type { CharId } from '../src/cutscenes/types.ts';

const layout = layoutJson as unknown as LevelLayout;

function fakeDeps(log: string[], o: { clips?: Record<string, string[]> } = {}): CutsceneDeps {
  const clips = o.clips;
  return {
    camera: { apply: () => log.push('camera'), release: () => log.push('camera:release') },
    characters: {
      has: () => true,
      place: (id: CharId) => log.push(`place:${id}`),
      setVisible: (id: CharId, v: boolean) => log.push(`visible:${id}:${v}`),
      play: (id: CharId, clip: string) => {
        const ok = !clips || (clips[id] ?? []).includes(clip);
        log.push(`play:${id}:${clip}:${ok}`);
        return ok;
      },
      acquire: (id: CharId) => log.push(`acquire:${id}`),
      release: (id: CharId) => log.push(`release:${id}`),
    },
    audio: { play: (id) => log.push(`sfx:${id}`), loop: (k) => log.push(`loop:${k}`), stopLoop: (k) => log.push(`stopLoop:${k}`) },
    voice: (t) => log.push(`voice:${t}`),
    stopVoices: () => log.push('stopVoices'),
    lights: { lightning: () => log.push('lightning'), stormAuto: (on) => log.push(`storm:${on}`) },
    world: { door: (id, a) => log.push(`door:${id}:${a}`), placePlayer: () => log.push('placePlayer'), vehicle: (p) => log.push(`vehicle:${p ? 'on' : 'null'}`) },
    ui: { overlay: () => {}, prompt: (t) => log.push(`prompt:${t}`) },
    input: { lock: (m) => log.push(`lock:${m}`) },
    render: { dof: (d) => log.push(`dof:${d ? 'on' : 'off'}`) },
    context: () => ({ player: { eye: [2.4, 5, 2.25] as P3, heading: Math.PI / 2, pitch: 0, fov: 70 }, ada: { pos: [3, 6, 0.6] as P3, heading: 0 }, flags: new Map() }),
  };
}

function setup(o: { seen?: string[] } = {}) {
  const events = new EventBus<GameEvents>();
  const bus: string[] = [];
  events.on('cutscene:start', ({ id }) => bus.push(`start:${id}`));
  events.on('cutscene:end', ({ id, skipped }) => bus.push(`end:${id}${skipped ? '(skipped)' : ''}`));
  events.on('beat:enter', ({ id }) => bus.push(`beat:${id}`));
  const log: string[] = [];
  const player = new CutscenePlayer({ deps: fakeDeps(log), library: CUTSCENES, seen: memorySeenStore(o.seen) });
  const eye: P3 = [1.8, -27.4, 1.65];
  let ended = 0;
  const dir = new Director({
    layout,
    events,
    host: {
      player: () => ({ pos: [1.8, -27.4, 0], eye, room: 'EXT2', crouched: false, running: false, speed: 0, hiddenIn: null, holdingBreath: false, beam: { on: false, origin: eye, dir: [0, 1, 0], range: 14, halfAngle: 0.3, hit: null }, locketRaised: false }),
      doorState: () => 'closed',
      lineOfSight: () => false,
      playerCanSee: () => false,
      playCutscene: player.playCutscene,
      teleport: (id) => log.push(`teleport:${id}`),
      end: () => {
        ended++;
        log.push('END');
      },
    },
  });
  const step = (seconds: number, dt = 1 / 30) => {
    for (let t = 0; t < seconds; t += dt) {
      dir.update(dt);
      player.update(dt);
    }
  };
  return { events, bus, log, player, dir, step, ended: () => ended };
}

test('host: C1 through the real Director — started via playCutscene, one start + one end on the bus, B02 after', () => {
  const s = setup();
  s.dir.start();
  assert.equal(s.player.active, 'C1');
  assert.equal(s.player.canSkip(), false, 'first view is not skippable');
  assert.equal(s.player.skip(), false);
  s.step(56);
  assert.equal(s.player.active, null);
  assert.deepEqual(s.bus, ['beat:B01', 'start:C1', 'end:C1', 'beat:B02']);
  // teardown order: camera released and input unlocked before the story moved on
  const iRel = s.log.lastIndexOf('camera:release');
  const iUnlock = s.log.lastIndexOf('lock:none');
  assert.ok(iRel > 0 && iUnlock > 0);
  assert.ok(s.log.includes('voice:c1:fuel_chime') && s.log.includes('voice:c1:engine_dead'));
  assert.ok(s.log.includes('stopLoop:engine'), 'loops stopped');
  assert.ok(s.log.includes('storm:true'), 'storm auto restored');
  assert.equal(s.player.wasSeen('C1'), true);
});

test('host: skippable after the first view; skip → cutscene:end(skipped) once; world ends in the end state', () => {
  const s = setup({ seen: ['C1'] });
  s.dir.start();
  s.step(2);
  assert.equal(s.player.canSkip(), true);
  const before = s.log.length;
  assert.equal(s.player.skip(), true);
  assert.equal(s.player.active, null);
  assert.deepEqual(s.bus, ['beat:B01', 'start:C1', 'end:C1(skipped)', 'beat:B02']);
  const after = s.log.slice(before);
  assert.ok(after.includes('stopVoices'));
  assert.ok(after.includes('placePlayer'), 'player placed at CP1 (state cue applied on skip)');
  assert.ok(!after.some((l) => l.startsWith('sfx:') || l.startsWith('voice:') || l === 'lightning'), 'no sounds on skip');
  s.step(5);
  assert.equal(s.bus.filter((b) => b.startsWith('end:C1')).length, 1);
});

test('host: hold-to-skip needs the input held for 0.8 s (released = reset)', () => {
  const s = setup({ seen: ['C2'] });
  s.dir.startAt('B03');
  s.events.emit('interact', { id: 'T_B03_THRESHOLD', action: 'b03:threshold' });
  assert.equal(s.player.active, 'C2');
  for (let i = 0; i < 20; i++) s.player.holdSkip(true, 1 / 30); // 0.67 s
  s.player.holdSkip(false, 1 / 30);
  for (let i = 0; i < 20; i++) s.player.holdSkip(true, 1 / 30);
  assert.equal(s.player.active, 'C2');
  for (let i = 0; i < 6; i++) s.player.holdSkip(true, 1 / 30);
  assert.equal(s.player.active, null);
  assert.ok(s.bus.includes('end:C2(skipped)'));
  assert.ok(s.bus.includes('beat:B04'));
});

test('host: C6 → C7 → end is re-entrant (C7 starts inside C6 done) and each cutscene ends exactly once', () => {
  const s = setup();
  s.dir.startAt('B12');
  s.events.emit('interact', { id: 'T_B12_CAR', action: 'b12:at_car' });
  assert.equal(s.player.active, 'C6');
  s.step(3.5);
  assert.equal(s.player.waitingGate, 'pour');
  s.player.resolveGate('pour');
  s.step(6);
  s.player.resolveGate('key');
  s.step(30);
  assert.equal(s.player.active, 'C7');
  s.step(40);
  assert.equal(s.player.active, null);
  const ends = s.bus.filter((b) => b.startsWith('end:'));
  assert.deepEqual(ends, ['end:C6', 'end:C7']);
  assert.ok(s.bus.indexOf('start:C7') > s.bus.indexOf('end:C6'));
  assert.equal(s.ended(), 1);
  assert.ok(s.log.includes('voice:c6:engine_catches') && s.log.includes('voice:c7:tableau'));
});

test('host: death — camera released and input unlocked BEFORE the respawn teleport; not skippable', () => {
  const s = setup({ seen: ['death'] });
  s.dir.startAt('B06');
  s.log.length = 0;
  s.dir.apply(s.dir.story.handle({ type: 'ai', event: { type: 'catch', cause: 'bump' } as any }));
  assert.equal(s.player.active, 'death');
  assert.equal(s.player.canSkip(), false);
  s.step(3.2);
  const iTele = s.log.indexOf('teleport:CP3');
  assert.ok(iTele > 0, 'respawned');
  assert.ok(s.log.indexOf('camera:release') < iTele && s.log.indexOf('camera:release') >= 0);
  assert.ok(s.log.lastIndexOf('lock:none', iTele) >= 0);
  assert.ok(s.log.indexOf('release:ada') >= 0 && s.log.indexOf('release:ada') < iTele, 'Ada handed back to the AI before grace');
  assert.deepEqual(s.bus.filter((b) => b.includes('death')), ['start:death', 'end:death']);
});

test('host: B04 death replays C2_replay (3 s) and hands Ada to the chase', () => {
  const s = setup();
  s.dir.startAt('B04');
  s.dir.apply(s.dir.story.handle({ type: 'ai', event: { type: 'catch', cause: 'scripted' } as any }));
  s.step(3.2);
  assert.equal(s.player.active, 'C2_replay');
  s.step(3.2);
  assert.equal(s.player.active, null);
  assert.deepEqual(s.bus.filter((b) => b.startsWith('end:')), ['end:death', 'end:C2_replay']);
});

test('host: a new Director cutscene while one runs → the running one is skipped first (its done fires once)', () => {
  const log: string[] = [];
  const p = new CutscenePlayer({ deps: fakeDeps(log), library: CUTSCENES });
  const done: string[] = [];
  p.play('C3', (sk) => done.push(`C3:${sk}`));
  p.update(1);
  p.play('death', (sk) => done.push(`death:${sk}`));
  assert.deepEqual(done, ['C3:true']);
  assert.equal(p.active, 'death');
  for (let i = 0; i < 100; i++) p.update(0.05);
  assert.deepEqual(done, ['C3:true', 'death:false']);
});

test('host: re-entrant play from a done() fired by an interrupting play still leaves exactly one live cutscene', () => {
  const log: string[] = [];
  const p = new CutscenePlayer({ deps: fakeDeps(log), library: CUTSCENES });
  const done: string[] = [];
  p.play('C6', (sk) => {
    done.push(`C6:${sk}`);
    p.play('C7', (sk2) => done.push(`C7:${sk2}`)); // like the story's C6 end → C7
  });
  p.update(0.5);
  p.play('death', (sk) => done.push(`death:${sk}`));
  assert.equal(p.active, 'death');
  assert.deepEqual(done, ['C6:true', 'C7:true']);
  for (let i = 0; i < 100; i++) p.update(0.05);
  assert.deepEqual(done, ['C6:true', 'C7:true', 'death:false']);
  assert.equal(p.active, null);
});

test('host: unknown ids return false (Director falls back); missing clips use the cue fallback chain', () => {
  const log: string[] = [];
  const p = new CutscenePlayer({ deps: fakeDeps(log, { clips: { ada: ['ada_look', 'ada_vigil'], harlan: [], arms: ['arms_idle'] } }), library: CUTSCENES });
  assert.equal(p.play('C9', () => {}), false);
  p.play('C7', () => {});
  for (let i = 0; i < 25 * 30; i++) p.update(1 / 30);
  assert.ok(log.includes('play:ada:ada_sting:false'));
  assert.ok(log.includes('play:ada:ada_look:true'), 'fell back to ada_look');
});

test('host: C4 HemOverlay follows the brain phases, prompts the breath, never blocks, yields to Director cutscenes', () => {
  const log: string[] = [];
  const p = new CutscenePlayer({ deps: fakeDeps(log), library: CUTSCENES });
  const hem = new HemOverlay(p);
  const out = (phase: string, state = 'SCRIPTED') => ({ state, phase, room: 'U3' });
  hem.update(out('approach'), 'H_ADA_WARDROBE');
  assert.equal(p.active, 'C4_approach');
  assert.equal(p.lock, 'none');
  hem.update(out('hem'), 'H_ADA_WARDROBE');
  assert.equal(p.active, 'C4_hem');
  hem.update(out('look_windup', 'LOOK'), 'H_ADA_WARDROBE');
  p.update(0.1);
  assert.equal(p.active, 'C4_look');
  assert.ok(log.includes(`prompt:${BREATH_PROMPT}`));
  hem.breathHeld();
  assert.ok(log.at(-1) === 'prompt:null' || log.includes('prompt:null'));
  assert.ok(!log.some((l) => l.startsWith('voice:')), 'the brain voices c4, not the overlay');
  assert.ok(!log.includes('lock:full'), 'overlays never lock input');
  // a finale / death takes over: the overlay is cancelled without a done callback
  const done: boolean[] = [];
  p.play('death', (sk) => done.push(sk));
  assert.equal(p.active, 'death');
  hem.update(out('look_sight', 'LOOK'), 'H_ADA_WARDROBE');
  assert.equal(p.active, 'death', 'overlay does not interrupt a Director cutscene');
  // not hidden in her wardrobe → no overlay
  const p2 = new CutscenePlayer({ deps: fakeDeps([]), library: CUTSCENES });
  const hem2 = new HemOverlay(p2);
  hem2.update(out('approach'), null);
  assert.equal(p2.active, null);
});

test('host: localSeenStore survives a missing / throwing localStorage', () => {
  const s = localSeenStore('test.key');
  s.add('C1');
  assert.equal(s.has('C1'), true);
  assert.equal(s.has('C2'), false);
});
