// SMOOTH-FRAMES lane (contract #142, ROADMAP rulings (ak) "smooth motion is part of the photoreal bar" and (am)): every
// cutscene timeline, sampled at 30 fps straight from the sequencer, must move like a camera and a body do — no look
// whip or picture spin that is not an authored whip, no near-match jump at a shot boundary (a cut that is too small
// to read as a cut reads as a pop), no one-frame zoom, no car-speed step, no root-yaw snap, and a hand-back to gameplay
// on the very camera the cutscene ends on. The authored exceptions are listed (with the reason) so a new one is a
// conscious decision, not an accident.

const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import { Sequencer } from '../src/cutscenes/sequencer.ts';
import { CUTSCENES } from '../src/cutscenes/index.ts';
import { sampleKeys } from '../src/cutscenes/math.ts';
import type { CutsceneContext, P3, Timeline } from '../src/cutscenes/types.ts';

const DT = 1 / 30;
const R2D = 180 / Math.PI;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The real-route start poses (scripts/qa/cs-frames.mjs rows, Medium, 2026-10-12 capA–capD; gameplay FOV 70). */
const CTX: Record<string, Partial<CutsceneContext>> = {
  C0: {},
  C1: { chained: true },
  C2: { player: { eye: [3.1, 1.5, 2.25], heading: 0.8, pitch: 0, fov: 60 } },
  C2c: { chained: true },
  C2b: { player: { eye: [3.12, 4.45, 5.652], heading: Math.PI, pitch: -0.119, fov: 70, torch: true }, ada: { pos: [3.2, 8.2, 4.1], heading: 0 } },
  C3: { player: { eye: [8.046, 1.386, 5.744], heading: -0.497, pitch: 0, fov: 70 } },
  C4a: { player: { eye: [2.863, 7.86, 5.752], heading: 1.309, pitch: 0, fov: 70 } },
  C4c: { player: { eye: [2.413, 8.26, 2.251], heading: -1.915, pitch: 0.019, fov: 70 }, ada: { pos: [2.1, 7.45, 0.6], heading: 1.2 } },
  C5: { player: { eye: [2.413, 8.26, 2.251], heading: -1.457, pitch: 0.021, fov: 70 }, ada: { pos: [3.2, 1.5, 0.6], heading: 0 } },
  C5b: { player: { eye: [1.963, -0.246, 2.258], heading: -1.705, pitch: -0.002, fov: 70 } },
  C6: { player: { eye: [11.583, -2.859, 1.652], heading: 0.621, pitch: 0, fov: 70 } },
  C6b: { chained: true },
  C7: { chained: true },
  CR: { chained: true, tier: 'medium' },
};
const ctxOf = (id: string): CutsceneContext => ({ player: { eye: [0, 0, 1.65], heading: 0, pitch: 0, fov: 60 }, ada: null, flags: new Map(), seen: false, chained: false, motionBlur: true, tier: 'medium', ...CTX[id] });

interface Frame {
  t: number;
  k: number;
  pos: P3;
  u: number[];
  fov: number;
}
function frames(tl: Timeline): Array<Frame | null> {
  const seq = new Sequencer(tl, { cue: () => {}, camera: () => {}, move: () => {}, end: () => {} } as any);
  const shotAt = (t: number) => {
    let k = -1;
    (tl.shots ?? []).forEach((s, i) => {
      const end = s.t + s.d;
      if (t >= s.t && (t < end || (t >= tl.duration - 1e-9 && end >= tl.duration - 1e-6))) k = i;
    });
    return k;
  };
  const out: Array<Frame | null> = [];
  for (let i = 0; i <= Math.round(tl.duration / DT); i++) {
    const t = i * DT;
    const c = seq.cameraAt(t, t);
    if (!c) {
      out.push(null);
      continue;
    }
    const d = [c.target[0] - c.pos[0], c.target[1] - c.pos[1], c.target[2] - c.pos[2]];
    const L = Math.hypot(d[0], d[1], d[2]);
    out.push({ t, k: shotAt(t), pos: c.pos, u: d.map((x) => x / L), fov: c.fov });
  }
  return out;
}
const angle = (a: number[], b: number[]) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * R2D;
const near = (t: number, list: readonly number[]) => list.some((x) => Math.abs(t - x) < 0.6);

/** Authored whips / spins (time windows, s): the camera is MEANT to move this fast there. */
const AUTHORED_WHIP: Record<string, readonly number[]> = {
  C0: [22.93], // the car passes 9 m under the crane (58° down): a pan head tracking it turns the picture ≈ 6°/frame
  C2: [20.2], // S9 rope whip (GLITCH residual 4)
  C2c: [0.35, 3.7, 4.58, 6.75, 7.55], // the 154° whip, the head turns (GLITCH residual 4)
};
/** Authored cut-ins on the same axis (a cut that is small on purpose): id → boundary times. */
const AUTHORED_CUT_IN: Record<string, readonly number[]> = {
  C2: [12.9, 14.9], // the 100 mm eye insert
  C2c: [3.63, 6.63], // the look-back's snap start; the slap on tread 13 ends the fall
  C6: [8.4, 12.4], // the dash-clock insert (0.17 m, 24°, 26° lens from the driver's eye)
};

test('smooth: no look whip > 12°/frame and no picture spin > 6°/frame outside the authored whips', () => {
  for (const id of Object.keys(CTX)) {
    const tl = CUTSCENES[id](ctxOf(id));
    const f = frames(tl);
    for (let i = 1; i < f.length; i++) {
      const a = f[i - 1], b = f[i];
      if (!a || !b || a.k !== b.k || near(b.t, AUTHORED_WHIP[id] ?? [])) continue;
      const fade = sampleKeys(tl.fade, b.t, 0);
      if (fade > 0.97) continue;
      const turn = angle(a.u, b.u);
      assert.ok(turn <= 12, `${id} ${b.t.toFixed(3)}: look turns ${turn.toFixed(1)}°/frame`);
      const dh = Math.abs(wrap(Math.atan2(b.u[1], b.u[0]) - Math.atan2(a.u[1], a.u[0]))) * R2D;
      assert.ok(dh * Math.abs(b.u[2]) <= 6, `${id} ${b.t.toFixed(3)}: the picture spins ${(dh * Math.abs(b.u[2])).toFixed(1)}°/frame (heading ${dh.toFixed(1)}° at pitch ${(Math.asin(b.u[2]) * R2D).toFixed(0)}°)`);
      // a lens move may be quick but never a one-frame step: ≤ 5°/frame, and no frame > 1.5° above both neighbours
      const df = Math.abs(b.fov - a.fov);
      const c = f[i + 1];
      const dn = c && c.k === b.k ? Math.abs(c.fov - b.fov) : df;
      const dp = i >= 2 && f[i - 2] && f[i - 2]!.k === a.k ? Math.abs(a.fov - f[i - 2]!.fov) : df;
      assert.ok(df <= 5 && df - Math.max(dn, dp) <= 1.5, `${id} ${b.t.toFixed(3)}: fov ${(b.fov - a.fov).toFixed(1)}°/frame (neighbours ${dp.toFixed(1)} / ${dn.toFixed(1)})`);
    }
  }
});

test('smooth: every shot boundary is either continuous or a real cut (no near-match jump)', () => {
  for (const id of Object.keys(CTX)) {
    const tl = CUTSCENES[id](ctxOf(id));
    const f = frames(tl);
    // the pose JUMP at each boundary: the outgoing shot's pose an instant before the boundary vs the incoming shot's
    // first pose (no frame of motion mixed in)
    const seq = new Sequencer(tl, { cue: () => {}, camera: () => {}, move: () => {}, end: () => {} } as any);
    const pose = (t: number) => {
      const c = seq.cameraAt(t, t)!;
      const d = [c.target[0] - c.pos[0], c.target[1] - c.pos[1], c.target[2] - c.pos[2]];
      const L = Math.hypot(d[0], d[1], d[2]);
      return { pos: c.pos, u: d.map((x) => x / L), fov: c.fov };
    };
    for (let i = 1; i < f.length; i++) {
      const a = f[i - 1], b = f[i];
      if (!a || !b || a.k === b.k) continue;
      if (sampleKeys(tl.fade, b.t, 0) > 0.97 || sampleKeys(tl.fade, a.t, 0) > 0.97) continue;
      if (near(b.t, AUTHORED_CUT_IN[id] ?? [])) continue;
      const tb = tl.shots![b.k].t;
      if (!(tb > a.t && tb <= b.t)) continue; // a later-listed shot ending (an insert) — compare at its end below
      const A = pose(tb - 1e-6), B = pose(tb);
      const step = Math.hypot(B.pos[0] - A.pos[0], B.pos[1] - A.pos[1], B.pos[2] - A.pos[2]);
      const turn = angle(A.u, B.u);
      const dfov = Math.abs(B.fov - A.fov);
      const cut = step >= 0.35 || turn >= 25;
      const continuous = step <= 0.02 && turn <= 1 && dfov <= 1;
      assert.ok(cut || continuous, `${id} ${tb.toFixed(3)} shot ${a.k}→${b.k}: ${step.toFixed(2)} m / ${turn.toFixed(1)}° / fov ${dfov.toFixed(1)}° — neither a cut nor continuous`);
    }
  }
});

test('smooth: gameplay resumes on the camera the cutscene ends on (position, look, lens)', () => {
  for (const id of ['C2b', 'C3', 'C4a', 'C4c', 'C5', 'C5b', 'C2c']) {
    const ctx = ctxOf(id);
    const tl = CUTSCENES[id](ctx);
    const f = frames(tl);
    const last = f[f.length - 1];
    if (!last) continue; // the player's own camera already
    const pc = tl.cues.filter((c) => c.type === 'player').sort((a, b) => a.t - b.t).pop() as any;
    const eye: P3 = pc ? pc.pos : ctx.player.eye;
    const h = pc ? pc.heading : ctx.player.heading;
    const p = pc ? (pc.pitch ?? 0) : ctx.player.pitch;
    const u = [Math.cos(h) * Math.cos(p), Math.sin(h) * Math.cos(p), Math.sin(p)];
    const step = Math.hypot(last.pos[0] - eye[0], last.pos[1] - eye[1], last.pos[2] - eye[2]);
    assert.ok(step < 0.05 && angle(last.u, u) < 2 && Math.abs(last.fov - (ctx.player.fov ?? 60)) < 1, `${id}: the hand-back jumps ${step.toFixed(2)} m / ${angle(last.u, u).toFixed(1)}° / fov ${(last.fov - (ctx.player.fov ?? 60)).toFixed(1)}°`);
  }
});

test('smooth: car-space shots ride a car whose speed never steps (C1 / C6 / C7 vehicle tracks)', () => {
  for (const id of ['C6', 'C7']) {
    const tl = CUTSCENES[id](ctxOf(id));
    const seq = new Sequencer(tl, { cue: () => {}, camera: () => {}, end: () => {} } as any);
    let prev: P3 | null = null, pv: number | null = null;
    for (let i = 0; i <= Math.round(tl.duration / DT); i++) {
      const t = i * DT;
      const v = seq.vehicleAt(t);
      const shot = (tl.shots ?? []).filter((s) => t >= s.t && t < s.t + s.d).pop();
      if (!v || !shot || shot.space !== 'car' || sampleKeys(tl.fade, t, 0) > 0.97) {
        prev = null;
        pv = null;
        continue;
      }
      if (prev) {
        const sp = Math.hypot(v.pos[0] - prev[0], v.pos[1] - prev[1]);
        if (pv !== null) assert.ok(Math.abs(sp - pv) < 0.05, `${id} ${t.toFixed(3)}: car speed ${(pv * 30).toFixed(1)} → ${(sp * 30).toFixed(1)} m/s in one frame`);
        pv = sp;
      }
      prev = v.pos;
    }
  }
});

test('smooth: the C2c head bob starts and ends every bobbing shot on its path', () => {
  const tl = CUTSCENES.C2c(ctxOf('C2c'));
  for (const s of tl.shots ?? []) {
    if (!s.bob) continue;
    const steps = s.bob.hz * s.d;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-6, `bob at ${s.t}: ${steps.toFixed(2)} steps (not whole)`);
  }
});
