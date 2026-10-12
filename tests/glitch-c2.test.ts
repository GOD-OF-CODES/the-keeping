// GLITCH-FIX (user report 2026-10-11: "the beheading still has glitches and isnt smooth enuf"; docs/STATUS-glitch.md):
// the C2 / C2c timelines must not snap a character's root yaw, whip the look through one frame, pass the look through
// the zenith (lookAt's up-vector degenerates) or jump the look across a non-cut shot boundary.

const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import { Sequencer } from '../src/cutscenes/sequencer.ts';
import { C2_GRIP, c2Room } from '../src/cutscenes/c2-room.ts';
import { c2cUp } from '../src/cutscenes/c2c-up.ts';
import { sweepTargets, turnBetween } from '../src/cutscenes/math.ts';
import type { CutsceneContext, P3, Timeline } from '../src/cutscenes/types.ts';

const ctx = (o: Partial<CutsceneContext> = {}): CutsceneContext => ({ player: { eye: [3.3, 1.4, 2.25], heading: 0.8, pitch: 0, fov: 60 }, ada: null, flags: new Map(), seen: false, chained: true, ...o });
const DT = 1 / 30;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Per-frame root yaw steps of every move (place cues excluded: they are authored teleports at cuts). */
function yawSteps(tl: Timeline): Array<{ t: number; char: string; deg: number }> {
  const last: Record<string, number> = {};
  const out: Array<{ t: number; char: string; deg: number }> = [];
  let now = 0;
  const sink: any = {
    cue: (c: any) => {
      if (c.type === 'place') last[c.char] = c.heading;
    },
    camera: () => {},
    end: () => {},
    move: (ch: string, _p: P3, h: number) => {
      if (last[ch] !== undefined) out.push({ t: now, char: ch, deg: (Math.abs(wrap(h - last[ch])) * 180) / Math.PI });
      last[ch] = h;
    },
  };
  const seq = new Sequencer(tl, sink);
  for (now = 0; now <= tl.duration + 1e-9; now += DT) seq.update(DT);
  return out;
}

/** Per-frame look turn (deg) and pitch (deg), without the handheld noise. */
function looks(tl: Timeline): Array<{ t: number; turn: number; pitch: number; dist: number }> {
  const seq = new Sequencer(tl, { cue: () => {}, camera: () => {}, move: () => {}, end: () => {} } as any);
  const out: Array<{ t: number; turn: number; pitch: number; dist: number }> = [];
  let prev: number[] | null = null;
  for (let t = 0; t <= tl.duration + 1e-9; t += DT) {
    const c = seq.cameraAt(t, t);
    if (!c) continue;
    const d = [c.target[0] - c.pos[0], c.target[1] - c.pos[1], c.target[2] - c.pos[2]];
    const L = Math.hypot(d[0], d[1], d[2]);
    const u = d.map((x) => x / L);
    const turn = prev ? (Math.acos(Math.max(-1, Math.min(1, u[0] * prev[0] + u[1] * prev[1] + u[2] * prev[2]))) * 180) / Math.PI : 0;
    out.push({ t, turn, pitch: (Math.asin(u[2]) * 180) / Math.PI, dist: L });
    prev = u;
  }
  return out;
}

test('glitch: no character root yaw snaps in C2 / C2c (turnIn on every heading change)', () => {
  for (const tl of [c2Room(ctx()), c2cUp(ctx())]) {
    const bad = yawSteps(tl).filter((s) => s.deg > 8);
    assert.deepEqual(bad, [], `${tl.id}: ${JSON.stringify(bad.slice(0, 3))}`);
  }
});

test('glitch: no single-frame look pops and no zenith in C2 / C2c (the authored whips stay under 60°/frame at 30 fps)', () => {
  // the 100 mm insert (12.9 / 14.9) are the only hard cuts in C2
  const cuts = new Set(['C2:12.9', 'C2:14.9']);
  for (const tl of [c2Room(ctx()), c2cUp(ctx())]) {
    for (const f of looks(tl)) {
      if (cuts.has(`${tl.id}:${(Math.round(f.t * 10) / 10).toFixed(1)}`)) continue;
      assert.ok(f.turn < 60, `${tl.id} ${f.t.toFixed(3)}: ${f.turn.toFixed(1)}°/frame`);
      assert.ok(f.pitch < 80, `${tl.id} ${f.t.toFixed(3)}: pitch ${f.pitch.toFixed(1)}° (lookAt degenerates at the zenith)`);
    }
  }
});

test('glitch: C2 S10 turns back without dipping to the floor or jumping onto S11', () => {
  const f = looks(c2Room(ctx())).filter((x) => x.t > 21.9 && x.t < 26);
  assert.ok(f.every((x) => x.pitch > -15), 'S10/S11 look stays off the floor boards');
  assert.ok(f.every((x) => x.turn < 20), `S10/S11 turn ≤ 20°/frame (max ${Math.max(...f.map((x) => x.turn)).toFixed(1)})`);
});

test('glitch: the head is gripped off the frame at the bottom of his squat (after 10.7)', () => {
  const tl = c2Room(ctx());
  const att = tl.cues.find((c) => c.type === 'attach' && (c as any).prop === 'ada_head') as any;
  assert.ok(att && att.t === C2_GRIP && C2_GRIP >= 10.7 && C2_GRIP <= 10.95);
});

test('glitch: sweepTargets keeps the endpoints and the radius between them', () => {
  const eye: P3 = [0, 0, 1.6];
  const a: P3 = [2, 0, 1.6];
  const b: P3 = [0, -3, 1.0];
  const pts = sweepTargets(eye, a, b, turnBetween(eye, a, b, -1), 3);
  assert.deepEqual(pts[0], a);
  assert.deepEqual(pts[pts.length - 1], b);
  for (const p of pts) {
    const r = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
    assert.ok(r >= 1.99 && r <= 3.07);
  }
  assert.ok(Math.abs(turnBetween(eye, a, b, 1) - (3 * Math.PI) / 2) < 1e-9);
});
