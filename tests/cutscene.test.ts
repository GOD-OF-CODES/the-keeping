// Cutscene lane (src/cutscenes): sequencer timing (half-open cue windows, dt-split invariance, gates, moves, skip),
// Catmull-Rom parity with three r186, and data validation of every authored timeline (voice triggers, sfx ids,
// clip names, stage constants vs the layout, determinism).
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import layoutJson from '../src/shared/level-layout.json' with { type: 'json' };
import scriptJson from '../src/shared/voice-script.json' with { type: 'json' };
import type { LevelLayout } from '../src/shared/layout-types.ts';
import type { VoiceScript } from '../src/shared/voice-types.ts';
import { Sequencer, type SequencerSink } from '../src/cutscenes/sequencer.ts';
import { ArcPath, catmullRomPoint, carToPlan, handheld } from '../src/cutscenes/math.ts';
import { isStateCue, type CameraPose, type Cue, type CutsceneContext, type Timeline } from '../src/cutscenes/types.ts';
import { CUTSCENES, DIRECTOR_CUTSCENES, KNOWN_CLIPS, PENDING_CLIPS, PENDING_SFX } from '../src/cutscenes/index.ts';
import { ADA_TABLE, CAM, HARLAN_TABLE, PROP, SPAWN, NODE, CAR_GATE, CAR_ROW, ROCKER_HEADING, yawToHeading, DOOR } from '../src/cutscenes/stage.ts';
import { hasRecipe } from '../src/audio/synth/index.ts';
import { AI_VOICE_TRIGGERS, STORY_VOICE_TRIGGERS } from '../src/story/voice-cues.ts';

const layout = layoutJson as unknown as LevelLayout;
const script = scriptJson as unknown as VoiceScript;

// ------------------------------------------------------------------ helpers

interface Rec {
  cues: string[];
  cueObjs: { c: Cue; skipped: boolean; late: number }[];
  cams: (CameraPose | null)[];
  moves: string[];
  gates: (string | null)[];
  ends: boolean[];
  overlays: [number, number][];
}

function recorder(): { sink: SequencerSink; rec: Rec } {
  const rec: Rec = { cues: [], cueObjs: [], cams: [], moves: [], gates: [], ends: [], overlays: [] };
  const sink: SequencerSink = {
    cue: (c, i) => {
      rec.cues.push(`${c.t}:${c.type}:${'id' in c ? (c as any).id : 'name' in c ? (c as any).name : ''}`);
      rec.cueObjs.push({ c, skipped: i.skipped, late: i.late });
    },
    camera: (p) => rec.cams.push(p),
    move: (ch, pos, h) => rec.moves.push(`${ch}:${pos.map((x) => x.toFixed(3)).join(',')}:${h.toFixed(3)}`),
    gate: (id) => rec.gates.push(id),
    overlay: (f, b) => rec.overlays.push([f, b]),
    end: (s) => rec.ends.push(s),
  };
  return { sink, rec };
}

const mark = (t: number, name: string): Cue => ({ t, type: 'mark', name });

function simpleTimeline(extra: Partial<Timeline> = {}): Timeline {
  return {
    id: 'T',
    duration: 3,
    lock: 'full',
    cues: [mark(0, 'a'), mark(1, 'b'), mark(1, 'b2'), mark(2.5, 'c'), mark(3, 'end')],
    ...extra,
  };
}

function run(tl: Timeline, dts: number[]): Rec {
  const { sink, rec } = recorder();
  const s = new Sequencer(tl, sink);
  for (const dt of dts) s.update(dt);
  return rec;
}

const ctx0: CutsceneContext = { player: { eye: [2.4, 5.0, 2.25], heading: Math.PI / 2, pitch: 0, fov: 70 }, ada: { pos: [3.0, 6.0, 0.6], heading: -Math.PI / 2 }, flags: new Map(), seen: false };

// ------------------------------------------------------------------ sequencer

test('sequencer: t=0 cues fire on the first update (even dt=0); each cue once; end once', () => {
  const r = run(simpleTimeline(), [0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual(r.cues, ['0:mark:a', '1:mark:b', '1:mark:b2', '2.5:mark:c', '3:mark:end']);
  assert.deepEqual(r.ends, [false]);
});

test('sequencer: cue order is independent of how dt is split (60 Hz, 10 Hz, one giant step)', () => {
  const tl = simpleTimeline({ cues: [mark(0.5, 'x'), mark(0, 'a'), mark(1, 'b'), mark(1, 'b2'), mark(2.999, 'c'), mark(1, 'b3'), mark(3, 'end')] });
  const a = run(tl, Array(400).fill(1 / 60));
  const b = run(tl, Array(40).fill(0.1));
  const c = run(tl, [10]);
  const d = run(tl, [0.37, 0.001, 1.9, 0.0, 5]);
  assert.deepEqual(a.cues, b.cues);
  assert.deepEqual(a.cues, c.cues);
  assert.deepEqual(a.cues, d.cues);
  assert.deepEqual(a.cues, ['0:mark:a', '0.5:mark:x', '1:mark:b', '1:mark:b2', '1:mark:b3', '2.999:mark:c', '3:mark:end']);
  for (const r of [a, b, c, d]) assert.deepEqual(r.ends, [false]);
});

test('sequencer: half-open windows — a cue exactly at the step boundary fires in that step, not the next', () => {
  const { sink, rec } = recorder();
  const s = new Sequencer(simpleTimeline(), sink);
  s.update(1); // 0 → 1 : a, b, b2
  assert.deepEqual(rec.cues, ['0:mark:a', '1:mark:b', '1:mark:b2']);
  s.update(1.5); // (1, 2.5]
  assert.deepEqual(rec.cues.slice(3), ['2.5:mark:c']);
  assert.equal(s.time, 2.5);
  s.update(0.4);
  assert.equal(rec.ends.length, 0);
  s.update(0.2);
  assert.deepEqual(rec.ends, [false]);
  s.update(1);
  assert.equal(rec.cues.length, 5, 'no cue after the end');
});

test('sequencer: late offset = clock after the update minus the cue time (clip start offsets)', () => {
  const tl = simpleTimeline({ cues: [mark(0.2, 'x')] });
  const r = run(tl, [0.5, 3]);
  assert.ok(Math.abs(r.cueObjs[0].late - 0.3) < 1e-9);
});

test('sequencer: a gate holds the clock until resolved; later cues wait; wall clock keeps running', () => {
  const tl: Timeline = { id: 'G', duration: 4, lock: 'full', cues: [mark(0.5, 'before'), { t: 1, type: 'gate', id: 'pour', prompt: 'Hold E' }, mark(1, 'afterSameT'), mark(2, 'after')] };
  const { sink, rec } = recorder();
  const s = new Sequencer(tl, sink);
  s.update(0.8);
  s.update(0.8); // reaches the gate at 1.0
  assert.equal(s.time, 1);
  assert.equal(s.waitingGate, 'pour');
  for (let i = 0; i < 100; i++) s.update(0.1);
  assert.equal(s.time, 1, 'held');
  assert.ok(s.wall > 10);
  assert.deepEqual(rec.cues, ['0.5:mark:before', '1:gate:pour']);
  assert.deepEqual(rec.gates, ['pour']);
  s.resolveGate('pour');
  assert.deepEqual(rec.gates, ['pour', null]);
  s.update(0.5);
  assert.deepEqual(rec.cues, ['0.5:mark:before', '1:gate:pour', '1:mark:afterSameT']);
  s.update(5);
  assert.deepEqual(rec.cues.slice(-1), ['2:mark:after']);
  assert.equal(rec.cues.filter((c) => c.includes('gate')).length, 1, 'gate cue announced once');
  assert.deepEqual(rec.ends, [false]);
});

test('sequencer: gate timeout auto-resolves (no soft-lock); pre-resolved gates pass straight through', () => {
  const tl: Timeline = { id: 'G', duration: 3, lock: 'full', cues: [{ t: 1, type: 'gate', id: 'key', timeout: 2 }, mark(1.5, 'x')] };
  const { sink, rec } = recorder();
  const s = new Sequencer(tl, sink);
  for (let i = 0; i < 34; i++) s.update(0.1); // ~1 s to reach + 2 s timeout
  assert.equal(s.waitingGate, null);
  for (let i = 0; i < 30; i++) s.update(0.1);
  assert.deepEqual(rec.ends, [false]);
  assert.ok(rec.cues.includes('1.5:mark:x'));
  const r2 = recorder();
  const s2 = new Sequencer(tl, r2.sink);
  s2.resolveGate('key');
  s2.update(10);
  assert.deepEqual(r2.rec.ends, [false]);
  assert.deepEqual(r2.rec.gates, []);
});

test('sequencer: skip applies remaining STATE cues in order, drops sounds/voices, resolves gates, ends once', () => {
  const cues: Cue[] = [
    { t: 0, type: 'place', char: 'ada', pos: [1, 1, 0], heading: 0 },
    { t: 1, type: 'sfx', id: 'knock' },
    { t: 1.5, type: 'gate', id: 'g' },
    { t: 2, type: 'voice', trigger: 'c2:rope_slip' },
    { t: 2, type: 'door', id: 'D_FRONT', action: 'slam' },
    { t: 2.5, type: 'light', op: 'lightning' },
    { t: 2.6, type: 'light', op: 'set', id: 'L_LANTERN', scale: 0 },
    { t: 3, type: 'clip', char: 'ada', clip: 'ada_rise' },
    { t: 3.5, type: 'player', pos: [0, 0, 1.6], heading: 1 },
  ];
  const tl: Timeline = { id: 'S', duration: 4, lock: 'full', cues, moves: [{ char: 'ada', t: 3.2, d: 0.5, path: [[0, 0, 0], [2, 0, 0]] }] };
  // full playback (gate resolved up front) vs skip after 0.5 s
  const full = recorder();
  const sf = new Sequencer(tl, full.sink);
  sf.resolveGate('g');
  for (let i = 0; i < 100; i++) sf.update(0.05);
  const sk = recorder();
  const ss = new Sequencer(tl, sk.sink);
  ss.update(0.5);
  assert.equal(ss.skip(), true);
  assert.equal(ss.skip(), false);
  const stateSeq = (r: Rec) => r.cueObjs.filter((x) => isStateCue(x.c)).map((x) => `${x.c.t}:${x.c.type}`);
  assert.deepEqual(stateSeq(sk.rec), stateSeq(full.rec), 'same state cues, same order');
  assert.ok(!sk.rec.cueObjs.some((x) => x.skipped && !isStateCue(x.c)), 'no sound/voice/lightning on skip');
  assert.deepEqual(sk.rec.ends, [true]);
  assert.equal(sk.rec.moves.at(-1), full.rec.moves.at(-1), 'move tracks end in the same pose');
  // skipped clip starts at its end (late = duration − t)
  const clip = sk.rec.cueObjs.find((x) => x.c.type === 'clip')!;
  assert.equal(clip.skipped, true);
  assert.equal(clip.late, 1);
});

test('sequencer: a move finishes before a later place cue in the same step (later cue wins)', () => {
  const tl: Timeline = {
    id: 'M',
    duration: 3,
    lock: 'full',
    moves: [{ char: 'ada', t: 0, d: 1, path: [[0, 0, 0], [1, 0, 0]], heading: 0 }],
    cues: [{ t: 2, type: 'place', char: 'ada', pos: [9, 9, 0], heading: 0 }],
  };
  const order: string[] = [];
  const s = new Sequencer(tl, { cue: (c) => order.push(`place@${c.t}`), camera: () => {}, move: (_c, p) => order.push(`move:${p[0].toFixed(2)}`), end: () => {} });
  s.update(0);
  s.update(5);
  assert.deepEqual(order.slice(-2), ['move:1.00', 'place@2']);
});

test('sequencer: camera — shots cut, uncovered time = player camera (null), last shot holds at the end', () => {
  const tl: Timeline = {
    id: 'C',
    duration: 4,
    lock: 'full',
    shots: [
      { t: 0, d: 1, path: [[0, 0, 1]], target: [[1, 0, 1]], fov: 50 },
      { t: 2, d: 2, path: [[0, 0, 1], [4, 0, 1]], target: [[5, 0, 1]], fov: [40, 60], ease: 'linear' },
    ],
    cues: [],
  };
  const { sink, rec } = recorder();
  const s = new Sequencer(tl, sink);
  s.update(0.5);
  assert.equal(rec.cams.at(-1)!.fov, 50);
  s.update(1);
  assert.equal(rec.cams.at(-1), null);
  s.update(1.5); // 3.0 → halfway through shot 2
  const mid = rec.cams.at(-1)!;
  assert.ok(Math.abs(mid.fov - 50) < 1e-9);
  assert.ok(Math.abs(mid.pos[0] - 2) < 0.02, `arc-length midpoint ${mid.pos[0]}`);
  s.update(5);
  const last = rec.cams.at(-1)!;
  assert.ok(last && Math.abs(last.pos[0] - 4) < 1e-6 && last.fov === 60);
});

test('sequencer: deterministic — identical output for identical dt streams (handheld included)', () => {
  const tl = CUTSCENES.C2(ctx0);
  const dts = Array.from({ length: 1500 }, (_, i) => (i % 3 === 0 ? 1 / 30 : 1 / 60));
  const a = run(tl, dts);
  const b = run(CUTSCENES.C2(ctx0), dts);
  assert.deepEqual(a.cues, b.cues);
  assert.deepEqual(JSON.stringify(a.cams), JSON.stringify(b.cams));
  assert.deepEqual(a.moves, b.moves);
});

// ------------------------------------------------------------------ math

test('math: catmullRomPoint matches three r186 CatmullRomCurve3 (centripetal) and ArcPath ≈ getPointAt', async () => {
  const [{ CatmullRomCurve3 }, { Vector3 }] = await Promise.all([import('three/src/extras/curves/CatmullRomCurve3.js' as string), import('three/src/math/Vector3.js' as string)]);
  const sets: [number, number, number][][] = [
    [[0, 0, 0], [1, 2, 0], [3, 3, 1], [6, 1, 2]],
    [[2.6, -30.1, 1.15], [3.3, -28.1, 1.6], [1.8, -27.4, 1.65]],
    [[0, 0, 0], [0, 0, 0], [1, 0, 0]],
    [[5, 5, 5], [6, 5, 5]],
  ];
  for (const pts of sets) {
    const curve = new CatmullRomCurve3(pts.map((p) => new Vector3(...p)), false, 'centripetal');
    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      const a = curve.getPoint(t);
      const b = catmullRomPoint(pts, t);
      assert.ok(Math.abs(a.x - b[0]) < 1e-9 && Math.abs(a.y - b[1]) < 1e-9 && Math.abs(a.z - b[2]) < 1e-9, `t=${t}`);
      if (pts.length > 2 && pts[0] !== pts[1]) {
        const c = curve.getPointAt(t);
        const d = new ArcPath(pts).at(t);
        assert.ok(Math.hypot(c.x - d[0], c.y - d[1], c.z - d[2]) < 5e-3, `arc t=${t}`);
      }
    }
  }
});

test('math: carToPlan (x right, y forward) and handheld bounds', () => {
  const p = carToPlan([1, 2, 0.5], [10, 0, 0], Math.PI / 2); // facing north: right = east
  assert.ok(Math.abs(p[0] - 11) < 1e-9 && Math.abs(p[1] - 2) < 1e-9 && p[2] === 0.5);
  for (let t = 0; t < 30; t += 0.37) for (const v of handheld(t, 42, 1)) assert.ok(Math.abs(v) <= 0.0087 * 1.0001);
  assert.deepEqual(handheld(3, 1, 0), [0, 0, 0]);
});

// ------------------------------------------------------------------ authored data

const allTimelines = (): Timeline[] => Object.entries(CUTSCENES).map(([, f]) => f(ctx0));
const allCues = (): { id: string; c: Cue }[] => allTimelines().flatMap((tl) => tl.cues.map((c) => ({ id: tl.id, c })));

test('data: every Director cutscene id has a timeline; ids match; durations sane; death is not skippable', () => {
  for (const id of DIRECTOR_CUTSCENES) assert.ok(CUTSCENES[id], id);
  for (const [id, f] of Object.entries(CUTSCENES)) {
    const tl = f(ctx0);
    assert.equal(tl.id, id);
    assert.ok(tl.duration > 0 && tl.duration <= 80, `${id} duration`); // C1 is 75 s (docs/C1-OPENING.md §4, lead-approved)
    for (const c of tl.cues) assert.ok(c.t >= 0 && c.t <= tl.duration + 1e-9, `${id}: cue at ${c.t} outside 0..${tl.duration}`);
    for (const s of tl.shots ?? []) {
      assert.ok(s.d > 0 && s.t >= 0 && s.t + s.d <= tl.duration + 1e-6, `${id}: shot ${s.t}+${s.d}`);
      assert.ok(s.path.length >= 1 && s.target.length >= 1);
      for (const p of [...s.path, ...s.target]) assert.ok(p.every(Number.isFinite), `${id}: finite shot point`);
    }
    for (const m of tl.moves ?? []) assert.ok(m.t >= 0 && m.t + m.d <= tl.duration + 1e-6, `${id}: move window`);
  }
  assert.equal(CUTSCENES.death(ctx0).skippable, false);
  assert.equal(CUTSCENES.death(ctx0).duration, 3);
  assert.ok(!('C2_replay' in CUTSCENES), 'C2_replay retired (C2-ESCAPE K8)');
});

test('data: every voice trigger referenced by a cutscene exists in voice-script.json', () => {
  const triggers = new Set(script.lines.map((l) => l.trigger));
  const used = new Set(allCues().filter((x) => x.c.type === 'voice').map((x) => (x.c as any).trigger as string));
  assert.ok(used.size >= 10);
  for (const t of used) assert.ok(triggers.has(t), `unknown voice trigger ${t}`);
  // the cutscene-owned lines are all covered (c1/c2/c3/c5/c6/c7 triggers + the threshold freeze)
  const cutsceneTriggers = script.lines.map((l) => l.trigger).filter((t) => /^c[123567]:/.test(t) || t === 'b03:threshold_freeze');
  for (const t of cutsceneTriggers) assert.ok(used.has(t), `voice trigger ${t} is never cued`);
  // no double voicing: triggers the AI or the story already emit are not cued by Director cutscenes
  const emittedElsewhere = new Set<string>([...AI_VOICE_TRIGGERS, ...STORY_VOICE_TRIGGERS]);
  for (const tl of allTimelines()) {
    if (tl.id === 'C4') continue; // preview-only (stands in for the brain)
    for (const c of tl.cues) if (c.type === 'voice') assert.ok(!emittedElsewhere.has(c.trigger), `${tl.id} re-voices ${c.trigger}`);
  }
});

test('data: every sfx / loop / stinger id exists in the synthesized bank', () => {
  for (const { id, c } of allCues()) {
    if (c.type === 'sfx') assert.ok(hasRecipe(c.id) || PENDING_SFX.includes(c.id), `${id}: sfx ${c.id}`);
    if (c.type === 'loop' && c.id) assert.ok(hasRecipe(c.id) || PENDING_SFX.includes(c.id), `${id}: loop ${c.id}`);
    if (c.type === 'score' && c.stinger) assert.ok(hasRecipe(c.stinger), `${id}: stinger ${c.stinger}`);
  }
});

test('data: clip names exist (or are known pending M2 clips with a built fallback)', () => {
  for (const { id, c } of allCues()) {
    if (c.type !== 'clip') continue;
    const known = KNOWN_CLIPS[c.char];
    if (known.includes(c.clip)) continue;
    assert.ok((PENDING_CLIPS as readonly string[]).includes(c.clip), `${id}: unknown clip ${c.clip}`);
    assert.ok((c.fallback ?? []).some((f) => known.includes(f)), `${id}: pending clip ${c.clip} needs a built fallback`);
  }
});

test('data: layout ids referenced by cues exist (doors, props, lights)', () => {
  const doors = new Set(layout.doors.map((d) => d.id));
  const props = new Set(layout.props.map((p) => p.id));
  const lights = new Set(layout.lights.map((l) => l.id));
  for (const { id, c } of allCues()) {
    if (c.type === 'door') assert.ok(doors.has(c.id), `${id}: door ${c.id}`);
    if (c.type === 'prop') assert.ok(props.has(c.id), `${id}: prop ${c.id}`);
    if (c.type === 'light' && 'id' in c) assert.ok(lights.has(c.id), `${id}: light ${c.id}`);
  }
});

test('stage: constants match the layout (cameras, spawns, props, nodes, doors) and the C2 staging rule', () => {
  const near = (a: number[], b: number[], eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);
  for (const [k, v] of Object.entries(CAM)) {
    const c = layout.cameras.find((x) => x.id === k)!;
    assert.ok(c, k);
    assert.ok(near(v.pos, c.pos) && near(v.target, c.target) && v.fov === c.fovDeg, `camera ${k}`);
  }
  for (const [k, v] of Object.entries(SPAWN)) {
    const s = layout.spawns.find((x) => x.id === k)!;
    assert.ok(near(v.pos, s.pos) && v.heading === s.yaw && v.pitch === s.pitch, `spawn ${k}`);
  }
  for (const [k, v] of Object.entries(PROP)) {
    const p = layout.props.find((x) => x.id === k)!;
    assert.ok(p && near(v, p.pos), `prop ${k}`);
  }
  for (const [k, v] of Object.entries(NODE)) assert.ok(near(v, layout.aiNodes.find((n) => n.id === k)!.pos), `node ${k}`);
  const yaw = (id: string) => (layout.props.find((p) => p.id === id) as any).yaw as number;
  assert.ok(Math.abs(CAR_GATE.heading - Math.PI) < 1e-3 && Math.abs(yawToHeading(yaw('P_CAR_GATE')) + Math.PI) < 1e-3);
  assert.equal(CAR_ROW.heading, yawToHeading(yaw('P_CAR_ROW')));
  assert.equal(ROCKER_HEADING, yawToHeading(yaw('P_ROCKER')));
  // doors: front/parlor opening centres
  const wall = (id: string) => layout.walls.find((w) => w.openings?.some((o) => o.id === id))!;
  const centre = (id: string) => {
    const w = wall(id);
    const o = w.openings!.find((x) => x.id === id)!;
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    return [w.a[0] + ((w.b[0] - w.a[0]) * o.offset) / len, w.a[1] + ((w.b[1] - w.a[1]) * o.offset) / len];
  };
  assert.ok(near(centre('O_FRONT'), DOOR.front.slice(0, 2), 1e-3) && near(centre('O_PARLOR'), DOOR.parlor.slice(0, 2), 1e-3));
  // C2: Harlan at (0.02, −1.08) in Ada's frame (Ada faces −Y, left = +X); the threshold camera on Ada's +X side, 3–4 m
  const toLocal = (p: number[]) => {
    const h = ADA_TABLE.heading + Math.PI / 2; // local −Y = facing ⇒ rotation = heading + π/2
    const dx = p[0] - ADA_TABLE.pos[0];
    const dy = p[1] - ADA_TABLE.pos[1];
    return [dx * Math.cos(-h) - dy * Math.sin(-h), dx * Math.sin(-h) + dy * Math.cos(-h)];
  };
  const hl = toLocal(HARLAN_TABLE.pos);
  assert.ok(Math.abs(hl[0] - 0.02) < 0.01 && Math.abs(hl[1] + 1.08) < 0.01, `harlan local ${hl}`);
  assert.ok(Math.abs(HARLAN_TABLE.heading - (ADA_TABLE.heading + Math.PI - 2 * Math.PI)) < 1e-9);
  const cl = toLocal(CAM.parlor_threshold.pos);
  const d = Math.hypot(CAM.parlor_threshold.pos[0] - ADA_TABLE.pos[0], CAM.parlor_threshold.pos[1] - ADA_TABLE.pos[1]);
  assert.ok(cl[0] > 1.5 && d >= 3 && d <= 4, `camera on Ada's left, 3–4 m (local ${cl}, d ${d.toFixed(2)})`);
});

test('data: every plan-space camera position lies inside a layout room rect (culling / sanity)', () => {
  const inRoom = (p: number[]) => layout.rooms.some((r) => p[0] >= r.rect[0] - 0.05 && p[0] <= r.rect[2] + 0.05 && p[1] >= r.rect[1] - 0.05 && p[1] <= r.rect[3] + 0.05);
  for (const tl of allTimelines())
    for (const s of tl.shots ?? []) {
      if (s.space === 'car') continue; // road shots ride the car (may leave every rect; bindings render unculled)
      for (const p of s.path) assert.ok(inRoom(p), `${tl.id}: shot at ${s.t}s eye ${p.map((v) => v.toFixed(2))} is outside every room`);
    }
});

test('data: every timeline plays to the end on the loop dt with gates auto-resolving (no stalls)', () => {
  for (const [id, f] of Object.entries(CUTSCENES)) {
    const { sink, rec } = recorder();
    const s = new Sequencer(f(ctx0), sink);
    let frames = 0;
    while (!s.done && frames < 60 * 120) {
      s.update(1 / 60);
      frames++;
    }
    assert.deepEqual(rec.ends, [false], `${id} did not finish`);
    assert.ok(rec.cams.every((p) => p === null || [...p.pos, ...p.target, p.fov].every(Number.isFinite)), `${id}: finite camera`);
  }
});
