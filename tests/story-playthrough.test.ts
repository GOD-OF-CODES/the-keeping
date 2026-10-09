// SIMULATED FULL PLAYTHROUGHS (story + AI, B01 → B13) driven by a goal-driven scripted player over the real
// Director / AdaBrain / Story / EventBus (see tests/story-sim.ts). Asserts: every beat in order, every checkpoint,
// the ending, no soft-lock (every goal stays reachable, no beat stalls), deaths + respawns at each checkpoint with
// grace, the early-finale branch (finale before the fuel, and C5 before the can), save/restore mid-run, and that
// she is never relocated where the player can see her.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import { Sim } from './story-sim.ts';
import { BEATS, CHECKPOINTS } from '../src/story/escape-state.ts';
import { parseSave, serializeSave } from '../src/story/checkpoints.ts';

function assertClean(sim: Sim, label: string, beats: readonly string[] = BEATS) {
  assert.deepEqual(sim.softLocks, [], `${label}: soft-lock`);
  assert.ok(sim.ended, `${label}: did not reach the end (beat ${sim.director.story.beat} at ${sim.t.toFixed(1)} s)`);
  assert.deepEqual([...new Set(sim.beats)], [...beats], `${label}: beats in order`);
  // she is never (re)placed where the player can see her, except under cutscene cover (forced)
  for (const r of sim.relocations) assert.ok(r.forced || !r.inView, `${label}: relocated in view → ${r.node} at ${r.t.toFixed(1)}`);
  assert.ok(sim.flags.get('game_over'), `${label}: game_over flag`);
}

test('playthrough: main route B01 → B13 without a death', () => {
  const sim = new Sim({ seed: 1 }).play();
  assertClean(sim, 'main');
  assert.deepEqual([...new Set(sim.checkpoints)], [...CHECKPOINTS]);
  assert.equal(sim.deaths.length, 0, JSON.stringify(sim.deaths));
  // the finale happened in the hall, after the fuel (the intended order)
  const s = sim.director.story.s;
  assert.ok(s.flags.locket_given && s.flags.harlan_taken && s.flags.has_can);
  assert.equal(sim.flags.get('has_locket'), false, 'she took the locket');
});

test('playthrough: main route is stable across seeds', () => {
  for (const seed of [2, 3, 4, 5]) assertClean(new Sim({ seed }).play(), `seed ${seed}`);
});

test('playthrough: a death at EVERY checkpoint (CP3–CP8; CP2 has none — C2-ESCAPE) respawns there with grace and still finishes', () => {
  const dieAt = ['CP3', 'CP4', 'CP5', 'CP6', 'CP7', 'CP8'] as const;
  const sim = new Sim({ seed: 1, dieAt: [...dieAt] });
  const graceSeen: string[] = [];
  let pending: string | null = null;
  sim.events.on('player:respawn', ({ checkpoint }) => (pending = checkpoint));
  sim.afterStep.push(() => {
    // right after a respawn the brain is in grace (PATROL-only, hearing −30 %, lure reset)
    if (!pending) return;
    const b = sim.director.brain;
    if (b.graceActive && b.patrolOnly && b.lurePulls === 0) graceSeen.push(pending);
    pending = null;
  });
  sim.play();
  assertClean(sim, 'deaths');
  const died = sim.deaths.map((d) => d.cp);
  for (const cp of dieAt) assert.ok(died.includes(cp), `died at ${cp}: ${died.join(',')}`);
  // each death respawned at the checkpoint it happened after
  assert.deepEqual(sim.respawns, died);
  assert.deepEqual(graceSeen, [...dieAt]);
  // causes: the hide found at the dress visit (breath not held), the rest contact/chase; never a scripted grab
  assert.ok(!sim.deaths.some((d) => d.cause === 'scripted'));
  assert.equal(sim.deaths.find((d) => d.cp === 'CP6')!.cause, 'hide');
  // the finale retry hands the locket back raised, with the one-time prompt
  assert.equal(sim.prompts.length, 1);
  // death loses only position: every item, board and flag survived
  for (const f of ['has_hammer', 'ada_boards_pried', 'dress_visit_done', 'has_can', 'passage_unbolted']) assert.ok(sim.flags.get(f), f);
});

test('playthrough: repeated deaths in one section switch the assists on and never soft-lock', () => {
  const sim = new Sim({ seed: 7 });
  sim.director.start();
  // reach B08 (the boards), then die three times in a row at CP4/CP5
  assert.ok(sim.runUntil(() => sim.director.story.beat === 'B08'));
  for (let k = 0; k < 3; k++) {
    const n = sim.deaths.length;
    const ok = sim.runUntil(() => {
      const a = sim.ada;
      if (a && a.visible && a.state !== 'CATCH') sim.pos = [a.pos[0] + 0.2, a.pos[1], a.pos[2]]; // walk into her
      return sim.deaths.length > n && !sim.director.story.s.dead;
    }, 120);
    assert.ok(ok, `death ${k + 1}`);
  }
  const s = sim.director.story.s;
  assert.ok((s.deathsAt[s.checkpoint!] ?? 0) >= 2);
  assert.equal(sim.director.brain.assist.slow, true, 'slow assist after 2 deaths in a section');
  sim.resume();
  assertClean(sim, 'assists');
});

test('playthrough: EARLY FINALE — the lit locket during the dress visit (before the fuel) still ends the game', () => {
  const sim = new Sim({ seed: 1, earlyFinale: true });
  let finaleBeat = '';
  sim.events.on('flag', ({ name, value }) => {
    if (name === 'finale_started' && value && !finaleBeat) finaleBeat = sim.director.story.beat;
  });
  sim.play();
  assertClean(sim, 'early finale');
  assert.equal(finaleBeat, 'B09', 'finale sighted during the dress visit');
  // the wardrobe back must have opened (dress_visit_done set by the finale), or the can would be unreachable
  assert.ok(sim.flags.get('dress_visit_done'));
  assert.ok(!sim.flags.get('bell_nonstop'), 'no nonstop bell after she has taken the locket');
});

test('playthrough: EARLY FINALE + hall first — C5 plays before the can; the can is still reachable and the car waits for it', () => {
  const sim = new Sim({ seed: 1, earlyFinale: true, hallFirst: true });
  let canAtC5: boolean | null = null;
  let routeToCan: string[] | null = null;
  sim.events.on('cutscene:end', ({ id }) => {
    if (id === 'C5') {
      canAtC5 = sim.flags.get('has_can') === true;
      routeToCan = sim.route('hall_n', 'k_cans');
    }
  });
  let canAtC6: boolean | null = null;
  sim.events.on('cutscene:start', ({ id }) => {
    if (id === 'C6') canAtC6 = sim.flags.get('has_can') === true;
  });
  sim.play();
  // C5 comes before the kitchen: B09 → B12 directly (B10/B11 are the kitchen and the hall finale, both moot)
  assertClean(sim, 'hall first', BEATS.filter((b) => b !== 'B10' && b !== 'B11'));
  assert.equal(canAtC5, false, 'C5 happened before the can');
  assert.ok(routeToCan, 'after C5 the kitchen is reachable from the hall');
  assert.ok(routeToCan!.includes('u4t_top'), 'via the wardrobe back and the servants stair (the passage is bolted from the kitchen side)');
  assert.equal(canAtC6, true, 'the drive (C6) waited on the can');
});

test('playthrough: save at CP5, reload into a fresh game, finish', () => {
  const a = new Sim({ seed: 3 });
  a.director.start();
  assert.ok(a.runUntil(() => a.checkpoints.includes('CP5') && !a.cutscene));
  const json = serializeSave(a.director.snapshot(a.hostState()));
  const save = parseSave(json)!;
  assert.ok(save, 'save parses');
  const b = new Sim({ seed: 3 });
  b.restoreHost(save.host!);
  b.director.restore(save);
  assert.equal(b.director.story.beat, a.director.story.beat);
  assert.equal(b.director.brain.lurePulls, a.director.brain.lurePulls);
  b.resume();
  const from = BEATS.indexOf(a.director.story.beat);
  assertClean(b, 'restored', BEATS.slice(from));
  assert.equal(parseSave('{"version":99}'), null);
});
