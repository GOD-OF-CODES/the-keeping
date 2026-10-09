// Story lane (src/story): documents, voice triggers, beat machine rules (idempotency, gating, hints, pries, deaths,
// finale assists, debug starts), checkpoints/saves, and the Director's cutscene fallback.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import layoutJson from '../src/shared/level-layout.json' with { type: 'json' };
import scriptJson from '../src/shared/voice-script.json' with { type: 'json' };
import type { LevelLayout } from '../src/shared/layout-types.ts';
import type { VoiceScript } from '../src/shared/voice-types.ts';
import { DOCUMENTS, wordCount } from '../src/story/documents.ts';
import { AI_VOICE_TRIGGERS, STORY_VOICE_TRIGGERS, buildTriggerIndex, linesForTrigger } from '../src/story/voice-cues.ts';
import { Story, HINT_AFTER_S, FINALE_PROMPT, BEAT_CHECKPOINT, type StoryCommand, type StoryView } from '../src/story/beats.ts';
import { BEATS, CHECKPOINTS, FLAGS, newEscapeState } from '../src/story/escape-state.ts';
import { checkpointSpawn, parseSave, serializeSave } from '../src/story/checkpoints.ts';
import { Director } from '../src/story/director.ts';
import { EventBus, type GameEvents } from '../src/core/events.ts';

const layout = layoutJson as unknown as LevelLayout;
const script = scriptJson as unknown as VoiceScript;
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const view = (o: Partial<StoryView> = {}): StoryView => ({ playerRoom: 'U1', playerPos: [2, 5, 4.1], hidden: false, locketRaised: false, thunderMasked: false, aiState: 'PATROL', ...o });
const has = (cmds: StoryCommand[], pred: (c: any) => boolean) => cmds.some(pred);
const ai = (cmds: StoryCommand[], op: string) => cmds.find((c) => c.type === 'ai' && c.cmd.op === op) as any;

// ------------------------------------------------------------------ data

test('documents: every text ≤ 60 words; ledger + letter match the voice script word for word', () => {
  for (const d of Object.values(DOCUMENTS)) assert.ok(wordCount(d.text) <= 60, `${d.id}: ${wordCount(d.text)} words`);
  const line = (id: string) => script.lines.find((l) => l.id === id)!.subtitle;
  assert.equal(norm(DOCUMENTS.ledger_p1.text), norm(line('doc_ledger_1')));
  assert.equal(norm(DOCUMENTS.ledger_p2.text), norm(line('doc_ledger_2')));
  assert.equal(norm(DOCUMENTS.ledger_p3.text), norm(line('doc_ledger_3')));
  assert.equal(norm(DOCUMENTS.letter.text), norm(line('doc_letter')));
  // guest book: eleven ruled-through guests, tonight's line blank; the sting reads HARLAN with a blank under it
  const gb = DOCUMENTS.guest_book.lines!;
  assert.equal(gb.filter((l) => l.ruled).length, 11);
  assert.equal(gb[gb.length - 1].name, '');
  const st = DOCUMENTS.guest_book_sting.lines!;
  assert.equal(st[11].name, 'HARLAN');
  assert.ok(st[11].ruled && !st[12].ruled);
  assert.equal(gb.filter((l) => l.vehicle && l.vehicle !== 'on foot').length, 9, 'nine cars in the field');
});

test('voice: every trigger the AI and the story emit exists in voice-script.json', () => {
  const idx = buildTriggerIndex(script.lines);
  for (const t of [...AI_VOICE_TRIGGERS, ...STORY_VOICE_TRIGGERS]) assert.ok(linesForTrigger(idx, t).length > 0, t);
  assert.deepEqual(linesForTrigger(idx, 'ai:catch').sort(), ['ada_catch', 'drv_death']);
  for (const d of Object.values(DOCUMENTS)) if (d.voiceTrigger) assert.ok(idx.has(d.voiceTrigger), d.voiceTrigger);
});

test('layout contracts: CP1–CP8 spawns exist; door unlock flags are story flags; hint targets are real', () => {
  for (const cp of CHECKPOINTS) assert.equal(checkpointSpawn(layout, cp).id, cp);
  for (const d of layout.doors) if (d.unlockFlag) assert.ok(d.unlockFlag in FLAGS, d.unlockFlag);
  const ids = new Set([...layout.props.map((p) => p.id), ...layout.doors.map((d) => d.id), 'board_1', 'board_2', 'board_3']);
  for (const b of BEATS) {
    const st = new Story(Story.debugStateAt(b));
    const t = st.hintTarget();
    if (t) assert.ok(ids.has(t), `${b} → ${t}`);
  }
  const triggerEvents = new Set(layout.triggers.map((t) => t.event));
  for (const e of ['b03:hall_enter', 'b03:threshold', 'b05:enter_u2', 'b09:enter_u3', 'b10:backstair_enter', 'b11:passage_enter', 'b11:hall_finale', 'b12:at_car']) assert.ok(triggerEvents.has(e), e);
});

// ------------------------------------------------------------------ beat machine

test('beats: start plays C1; C1 → CP1 + B02; ring → the door opens by itself; idempotent triggers', () => {
  const s = new Story();
  const c0 = s.start();
  assert.ok(has(c0, (c) => c.type === 'cutscene' && c.id === 'C1'));
  assert.ok(ai(c0, 'scripted')?.cmd.mode === 'hidden');
  const c1 = s.handle({ type: 'cutscene_end', id: 'C1' });
  assert.ok(has(c1, (c) => c.type === 'checkpoint' && c.id === 'CP1'));
  assert.equal(s.beat, 'B02');
  assert.deepEqual(s.handle({ type: 'interact', id: 'T_B03_HALL', action: 'b03:hall_enter' }), [], 'hall before the door opens: nothing');
  const k = s.handle({ type: 'interact', id: 'P_KNOCKER', action: 'knock' });
  assert.ok(has(k, (c) => c.type === 'voice' && c.trigger === 'b02:first_knock'));
  assert.ok(!has(s.handle({ type: 'interact', id: 'P_KNOCKER', action: 'knock' }), (c) => c.type === 'voice'), 'first knock only');
  s.handle({ type: 'interact', id: 'P_BELL_KNOB', action: 'ring_bell' });
  const later = s.update(3, view({ playerRoom: 'EXT2' }));
  assert.ok(has(later, (c) => c.type === 'door' && c.id === 'D_FRONT' && c.action === 'rope_open'));
  const hall = s.handle({ type: 'interact', id: 'T_B03_HALL', action: 'b03:hall_enter' });
  assert.equal(s.beat, 'B03');
  // C2-ESCAPE §1: the first stroke from the parlor, then the slow drip into the pool (once)
  assert.ok(has(hall, (c) => c.type === 'sfx' && c.id === 'cleaver_chop_partial' && c.room === 'G2'));
  assert.ok(has(hall, (c) => c.type === 'sfx' && c.id === 'parlor_drip_loop'));
  assert.ok(!has(s.handle({ type: 'interact', id: 'T_B03_HALL', action: 'b03:hall_enter' }), (c) => c.type === 'sfx'), 'stroke once');
  const thr = s.handle({ type: 'interact', id: 'T_B03_THRESHOLD', action: 'b03:threshold' });
  assert.ok(has(thr, (c) => c.type === 'cutscene' && c.id === 'C2'));
  assert.ok(has(thr, (c) => c.type === 'sfx' && c.id === 'parlor_drip_stop'));
  const again = s.handle({ type: 'interact', id: 'T_B03_THRESHOLD', action: 'b03:threshold' });
  assert.deepEqual(again, [], 're-fired threshold during C2');
  // C2's strike marker → severed + the strike time; C2c's first frame → B04 (the cutscene beat), parlor locked
  s.update(4, view({ playerRoom: 'G1' }));
  const st = s.handle({ type: 'flag', name: 'c2_struck', value: true });
  assert.ok(has(st, (c) => c.type === 'door' && c.id === 'D_FRONT' && c.action === 'rope_close'));
  assert.equal(s.s.flags.ada_severed, true);
  assert.equal(s.s.c2StrikeTime, s.s.time);
  assert.equal(s.beat, 'B03');
  const c2c = s.handle({ type: 'flag', name: 'c2c_started', value: true });
  assert.equal(s.beat, 'B04');
  assert.ok(has(c2c, (c) => c.type === 'door' && c.id === 'D_PARLOR' && c.action === 'lock'));
  assert.equal(ai(c2c, 'scripted').cmd.mode, 'hidden', 'the C2c body is a puppet; the brain stays offstage');
  // the host reports 'C2' once, at C2c's end → B05 at the stair top (CP2) with her return below
  const c2 = s.handle({ type: 'cutscene_end', id: 'C2' });
  assert.equal(ai(c2, 'scripted').cmd.mode, 'b05_return');
  assert.ok(has(c2, (c) => c.type === 'checkpoint' && c.id === 'CP2'));
  assert.equal(s.beat, 'B05');
  assert.equal(s.s.flags.cs_C2c_done, true);
  assert.ok(!has(c2, (c) => c.type === 'cutscene'), 'C2c is chained by the host, never requested');
  assert.deepEqual(s.handle({ type: 'cutscene_end', id: 'C2' }), [], 'duplicate cutscene end ignored');
  // the armoire flash 2.5 s after control (not hidden), and the hint points at the armoire until the first hide
  const fl = s.update(2.6, view({ playerRoom: 'U1' }));
  assert.ok(has(fl, (c) => c.type === 'lightning' && c.reason === 'armoire'));
  assert.equal(s.hintTarget(), 'P_ARMOIRE');
});

test('beats: gating — B09 needs all three boards, B10 needs the dress visit, B11 needs the unbolted passage', () => {
  const s = new Story(Story.debugStateAt('B08'));
  s.handle({ type: 'interact', id: 'T_B09_ENTER_U3', action: 'b09:enter_u3' });
  assert.equal(s.beat, 'B08');
  for (const k of [1, 2, 3]) s.handle({ type: 'flag', name: `ada_board_${k}`, value: true });
  assert.ok(s.s.flags.ada_boards_pried, 'three board flags imply ada_boards_pried');
  s.update(0.1, view({ playerRoom: 'U3' }));
  assert.equal(s.beat, 'B09', 'room fallback');
  s.handle({ type: 'interact', id: 'T_B10_BACKSTAIR', action: 'b10:backstair_enter' });
  assert.equal(s.beat, 'B09');
  const t = new Story(Story.debugStateAt('B10'));
  t.s.flags.passage_unbolted = false;
  t.handle({ type: 'interact', id: 'T_B11_PASSAGE', action: 'b11:passage_enter' });
  assert.equal(t.beat, 'B10');
  // the bolt only slides from the kitchen side
  t.update(0.1, view({ playerRoom: 'G1' }));
  const hall = t.handle({ type: 'interact', id: 'D_PASSAGE', action: 'rattle_bolted' });
  assert.ok(!t.s.flags.passage_unbolted && has(hall, (c) => c.type === 'toast'));
  t.update(0.1, view({ playerRoom: 'G3P' }));
  const k = t.handle({ type: 'interact', id: 'D_PASSAGE', action: 'rattle_bolted' });
  assert.ok(t.s.flags.passage_unbolted && has(k, (c) => c.type === 'door' && c.action === 'unlock'));
  t.update(0.1, view({ playerRoom: 'G3P' }));
  assert.equal(t.beat, 'B11');
});

test('beats: B08 — bell → AI bell; a pry outside a thunder roll screeches (14 m) and two such pries lengthen the rumbles', () => {
  const s = new Story(Story.debugStateAt('B08'));
  for (const k of [1, 2, 3]) s.s.flags[`ada_board_${k}`] = false;
  s.s.flags.ada_boards_pried = false;
  assert.ok(ai(s.handle({ type: 'interact', id: 'P_BELL_PULL', action: 'pull_bell' }), 'bell'));
  s.update(0.05, view({ thunderMasked: true }));
  const quiet = s.handle({ type: 'interact', id: 'board_1', action: 'pry' });
  assert.ok(!has(quiet, (c) => c.type === 'noise'), 'inside the roll: silent');
  assert.ok(has(quiet, (c) => c.type === 'checkpoint' && c.id === 'CP5'));
  s.update(0.05, view({ thunderMasked: false }));
  const loud = s.handle({ type: 'interact', id: 'board_2', action: 'pry' });
  assert.ok(has(loud, (c) => c.type === 'noise' && c.radius === 14));
  const loud2 = s.handle({ type: 'interact', id: 'board_3', action: 'pry' });
  assert.ok(has(loud2, (c) => c.type === 'storm' && c.rumbleScale > 1));
  assert.ok(s.s.flags.ada_boards_pried);
  assert.ok(has(loud2, (c) => c.type === 'ai' && c.cmd.op === 'escalation' && c.cmd.level === 1), 'escalation after the boards');
});

test('beats: stuck 90 s → a hint (lightning on the next interactable); progress resets the timer', () => {
  const s = new Story(Story.debugStateAt('B06'));
  s.s.flags.ledger_read = false;
  let cmds = s.update(HINT_AFTER_S - 1, view());
  assert.ok(!has(cmds, (c) => c.type === 'hint'));
  s.handle({ type: 'interact', id: 'P_LEDGER', action: 'read_ledger' }); // progress
  cmds = s.update(HINT_AFTER_S - 1, view());
  assert.ok(!has(cmds, (c) => c.type === 'hint'));
  cmds = s.update(2, view());
  assert.ok(has(cmds, (c) => c.type === 'hint' && c.target === 'P_HAMMER'));
});

test('beats: the ledger pages through p1 → p2 → p3 (each voiced); CP4 on the first read', () => {
  const s = new Story(Story.debugStateAt('B06'));
  s.s.flags.ledger_read = false;
  const docs: string[] = [];
  let cp = false;
  for (let i = 0; i < 4; i++)
    for (const c of s.handle({ type: 'interact', id: 'P_LEDGER', action: 'read_ledger' })) {
      if (c.type === 'document') docs.push(c.id);
      if (c.type === 'checkpoint' && c.id === 'CP4') cp = true;
    }
  assert.deepEqual(docs, ['ledger_p1', 'ledger_p2', 'ledger_p3', 'ledger_p1']);
  assert.ok(cp);
});

test('deaths: catch → death cutaway → respawn at the checkpoint + grace (no B04 death: C2c is a cutscene)', () => {
  const s = new Story(Story.debugStateAt('B06'));
  const d = s.handle({ type: 'ai', event: { type: 'catch', cause: 'bump' } });
  assert.ok(has(d, (c) => c.type === 'death') && has(d, (c) => c.type === 'cutscene' && c.id === 'death'));
  assert.deepEqual(s.handle({ type: 'ai', event: { type: 'catch', cause: 'bump' } }), [], 'no double death');
  const r = s.handle({ type: 'cutscene_end', id: 'death' });
  const iResp = r.findIndex((c) => c.type === 'respawn');
  const iGrace = r.findIndex((c) => c.type === 'ai' && c.cmd.op === 'grace');
  assert.ok(iResp >= 0 && iGrace > iResp, 'respawn before grace');
  assert.equal((r[iResp] as any).checkpoint, BEAT_CHECKPOINT.B06);
  // second death in the same section → slow assist
  s.handle({ type: 'ai', event: { type: 'catch', cause: 'bump' } });
  const r2 = s.handle({ type: 'cutscene_end', id: 'death' });
  assert.ok(has(r2, (c) => c.type === 'ai' && c.cmd.op === 'assist' && c.cmd.slow === true));
  // C2-ESCAPE: nothing replays C2 any more — a death respawns like any other section
  const b5 = new Story(Story.debugStateAt('B05'));
  b5.s.checkpoint = 'CP2';
  b5.handle({ type: 'ai', event: { type: 'catch', cause: 'bump' } });
  const r5 = b5.handle({ type: 'cutscene_end', id: 'death' });
  assert.ok(!has(r5, (c) => c.type === 'cutscene'), 'no C2 replay');
  assert.ok(has(r5, (c) => c.type === 'respawn' && c.checkpoint === 'CP2'));
});

test('finale assists: 1st finale death → locket raised + one-time prompt; 2nd → she waits at 4 m', () => {
  const s = new Story(Story.debugStateAt('B11'));
  s.s.checkpoint = 'CP8';
  s.handle({ type: 'ai', event: { type: 'catch', cause: 'chase' } });
  const r1 = s.handle({ type: 'cutscene_end', id: 'death' });
  assert.ok(has(r1, (c) => c.type === 'raise_locket'));
  assert.ok(has(r1, (c) => c.type === 'prompt' && c.text === FINALE_PROMPT));
  s.handle({ type: 'ai', event: { type: 'catch', cause: 'chase' } });
  const r2 = s.handle({ type: 'cutscene_end', id: 'death' });
  assert.ok(!has(r2, (c) => c.type === 'prompt'), 'prompt only once');
  assert.ok(has(r2, (c) => c.type === 'ai' && c.cmd.op === 'assist' && c.cmd.finaleWait === true));
});

test('finale: take → locket removed; C5 only when she is at the door AND you are in the hall; then B12 with the rope open', () => {
  const s = new Story(Story.debugStateAt('B11'));
  s.handle({ type: 'ai', event: { type: 'finale', phase: 'start' } });
  const t = s.handle({ type: 'ai', event: { type: 'finale', phase: 'take' } });
  assert.ok(has(t, (c) => c.type === 'item' && c.id === 'locket'));
  assert.ok(s.s.flags.locket_given && !s.s.flags.has_locket);
  s.handle({ type: 'ai', event: { type: 'finale', phase: 'at_door' } });
  assert.ok(!has(s.update(0.1, view({ playerRoom: 'G3P' })), (c) => c.type === 'cutscene'));
  assert.ok(has(s.update(0.1, view({ playerRoom: 'G1' })), (c) => c.type === 'cutscene' && c.id === 'C5'));
  const e = s.handle({ type: 'cutscene_end', id: 'C5' });
  assert.ok(has(e, (c) => c.type === 'door' && c.id === 'D_FRONT' && c.action === 'rope_open'));
  assert.equal(s.beat, 'B12');
  // the car without the can
  const s2 = new Story(Story.debugStateAt('B12'));
  s2.s.flags.has_can = false;
  assert.ok(has(s2.handle({ type: 'interact', id: 'T_B12_CAR', action: 'b12:at_car' }), (c) => c.type === 'toast'));
  s2.handle({ type: 'flag', name: 'has_can', value: true });
  assert.ok(has(s2.handle({ type: 'interact', id: 'P_CAR_ROW', action: 'car' }), (c) => c.type === 'cutscene' && c.id === 'C6'));
  s2.handle({ type: 'cutscene_end', id: 'C6' });
  assert.equal(s2.beat, 'B13');
  assert.ok(has(s2.handle({ type: 'cutscene_end', id: 'C7' }), (c) => c.type === 'end'));
});

test('finale during the dress visit sets dress_visit_done (the wardrobe back opens — no soft-lock)', () => {
  const s = new Story(Story.debugStateAt('B09'));
  s.s.flags.dress_visit_done = false;
  s.s.flags.has_locket = true; // she can only see the locket once it is taken
  const c = s.handle({ type: 'ai', event: { type: 'finale', phase: 'start' } });
  assert.ok(has(c, (x) => x.type === 'flag' && x.name === 'dress_visit_done' && x.value));
});

test('taking the can during B10 rings the nonstop bell and sends her to the ground loop (not after the locket is given)', () => {
  const s = new Story(Story.debugStateAt('B10'));
  s.s.flags.has_can = false;
  s.s.flags.bell_nonstop = false;
  const c = s.handle({ type: 'flag', name: 'has_can', value: true });
  assert.ok(has(c, (x) => x.type === 'voice' && x.trigger === 'b10:bell_nonstop_start'));
  assert.equal(ai(c, 'routine').cmd.kind, 'ground_finale');
  assert.ok(has(c, (x) => x.type === 'checkpoint' && x.id === 'CP7'));
  const t = new Story(Story.debugStateAt('B10'));
  t.s.flags.has_can = false;
  t.s.flags.locket_given = true;
  assert.ok(!has(t.handle({ type: 'flag', name: 'has_can', value: true }), (x) => x.type === 'voice'));
});

test('debug starts: every beat has a consistent state and resume commands respawn at its checkpoint', () => {
  for (const b of BEATS) {
    const s = new Story(Story.debugStateAt(b));
    const cmds = s.resumeCommands();
    assert.ok(has(cmds, (c) => c.type === 'respawn' && c.checkpoint === BEAT_CHECKPOINT[b]), b);
    assert.ok(has(cmds, (c) => c.type === 'beat' && c.to === b), b);
  }
});

test('saves: serialize / parse round-trip; bad versions rejected', () => {
  const st = newEscapeState();
  st.flags.has_hammer = true;
  const json = serializeSave({ version: 1, story: st, ai: { v: 1 } as any, host: { x: 1 } });
  const back = parseSave(json)!;
  assert.deepEqual(back.story, st);
  assert.equal(parseSave('nope'), null);
  assert.equal(parseSave(JSON.stringify({ version: 1, story: { v: 2 }, ai: { v: 1 } })), null);
});

test('director: without a cutscene player each cutscene times out, emits cutscene:start/end and advances the story', () => {
  const events = new EventBus<GameEvents>();
  const seen: string[] = [];
  events.on('cutscene:start', ({ id }) => seen.push(`start:${id}`));
  events.on('cutscene:end', ({ id }) => seen.push(`end:${id}`));
  events.on('beat:enter', ({ id }) => seen.push(`beat:${id}`));
  const eye: [number, number, number] = [1.8, -27.4, 1.65];
  const dir = new Director({
    layout,
    events,
    host: {
      player: () => ({ pos: [1.8, -27.4, 0], eye, room: 'EXT2', crouched: false, running: false, speed: 0, hiddenIn: null, holdingBreath: false, beam: { on: false, origin: eye, dir: [0, 1, 0], range: 14, halfAngle: 0.3, hit: null }, locketRaised: false }),
      doorState: () => 'closed',
      lineOfSight: () => false,
      playerCanSee: () => false,
    },
    cutsceneFallbackS: 1,
  });
  dir.start();
  for (let i = 0; i < 30; i++) dir.update(0.05);
  assert.deepEqual(seen.slice(0, 4), ['beat:B01', 'start:C1', 'end:C1', 'beat:B02']);
  // world lanes talk to the story through the bus
  events.emit('interact', { id: 'P_BELL_KNOB', action: 'ring_bell' });
  for (let i = 0; i < 60; i++) dir.update(0.05);
  assert.equal(dir.story.s.flags.front_door_open, true);
  dir.dispose();
});

test('C2-ESCAPE: timeline marks arrive as flags mark:c2:strike / mark:c2c:start (host → bindings → bus); ignored outside C2; C2 end without marks still lands B05 severed', () => {
  const s = new Story(Story.debugStateAt('B03'));
  assert.deepEqual(s.handle({ type: 'flag', name: 'mark:c2c:start', value: true }), [], 'no C2 playing → ignored');
  assert.equal(s.s.flags['mark:c2c:start'], undefined, 'markers are never stored as flags');
  s.handle({ type: 'interact', id: 'T_B03_THRESHOLD', action: 'b03:threshold' });
  s.update(7.56, view({ playerRoom: 'G1' }));
  s.handle({ type: 'flag', name: 'mark:c2:strike', value: true });
  assert.equal(s.s.flags.ada_severed, true);
  const t = s.s.c2StrikeTime;
  s.update(21.4, view({ playerRoom: 'G1' }));
  s.handle({ type: 'flag', name: 'mark:c2c:start', value: true });
  assert.equal(s.beat, 'B04');
  assert.equal(s.s.c2StrikeTime, t, 'the strike time is the strike, not C2c');
  s.handle({ type: 'cutscene_end', id: 'C2', skipped: false });
  assert.equal(s.beat, 'B05');
  // no marks at all (an old timeline / a skip before the strike): the C2 end still severs her and lands B05
  const u = new Story(Story.debugStateAt('B03'));
  u.handle({ type: 'interact', id: 'T_B03_THRESHOLD', action: 'b03:threshold' });
  u.handle({ type: 'cutscene_end', id: 'C2', skipped: true });
  assert.equal(u.beat, 'B05');
  assert.equal(u.s.flags.ada_severed, true);
  assert.equal(u.s.flags.parlor_locked, true);
});
