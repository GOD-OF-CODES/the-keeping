// SMOOTH-FIX lane (contract #145): the hunt findings F1–F10 (scratch/hunt, docs/STATUS-smooth-fix.md) as timeline rules
// that hold without Chrome — every per-cut exposure lands ON a cut, C1's S9 pans with the car instead of losing its
// lamps off the frame edge, and C2's hand-off / iris ride / door / head roll are staged where the fixes put them.

const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import { Sequencer } from '../src/cutscenes/sequencer.ts';
import { CUTSCENES } from '../src/cutscenes/index.ts';
import { C2_CAMERA_E, C2_HALL_E, C2_HANDOFF_S, C2_HEAD_LANDS, C2_ROLL } from '../src/cutscenes/c2-room.ts';
import type { Cue, CutsceneContext, Timeline } from '../src/cutscenes/types.ts';

const R2D = 180 / Math.PI;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ctx = (o: Partial<CutsceneContext> = {}): CutsceneContext =>
  ({ player: { eye: [3.1, 1.5, 2.25], heading: 0.8, pitch: 0, fov: 70, torch: false }, ada: { pos: [3.2, 1.5, 0.6], heading: 0 }, flags: new Map(), seen: false, chained: true, motionBlur: true, tier: 'medium', ...o }) as CutsceneContext;
const expo = (tl: Timeline) => tl.cues.filter((c: Cue) => c.type === 'fx' && (c as any).id === 'exposure') as any[];

test('every per-cut exposure (cutE) lands on a shot boundary, where the camera jumps', () => {
  let n = 0;
  for (const id of ['C0', 'C1', 'C2b', 'C5', 'C5b', 'C6', 'C6b', 'C7']) {
    for (const torch of [false, true]) {
      const tl = CUTSCENES[id](ctx({ player: { eye: [11.583, -2.859, 1.652], heading: 0.62, pitch: 0, fov: 70, torch } }));
      const seq = new Sequencer(tl, { cue() {}, camera() {}, move() {}, end() {}, vehicle() {} } as any);
      for (const c of expo(tl).filter((c) => c.params?.cutE !== undefined)) {
        const edges = (tl.shots ?? []).flatMap((s) => [s.t, s.t + s.d]);
        assert.ok(edges.some((e) => Math.abs(e - c.t) < 1e-6), `${id} cutE at ${c.t}: no shot starts or ends there`);
        if (c.t > 0) {
          const a = seq.cameraAt(c.t - 1 / 30, c.t - 1 / 30)!;
          const b = seq.cameraAt(c.t + 1e-6, c.t + 1e-6)!;
          const dir = (p: any) => {
            const d = [p.target[0] - p.pos[0], p.target[1] - p.pos[1], p.target[2] - p.pos[2]];
            const L = Math.hypot(d[0], d[1], d[2]);
            return d.map((x) => x / L);
          };
          const da = dir(a), db = dir(b);
          const turn = Math.acos(Math.max(-1, Math.min(1, da[0] * db[0] + da[1] * db[1] + da[2] * db[2]))) * R2D;
          const step = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
          assert.ok(step > 1.2 || turn > 20, `${id} cutE at ${c.t}: not a cut (step ${step.toFixed(2)} m, turn ${turn.toFixed(1)}°)`);
        }
        assert.ok(c.params.cutE > 0 && c.params.cutE <= 24, `${id} cutE ${c.params.cutE} outside the eye's range`);
        n++;
      }
    }
  }
  assert.ok(n >= 40, `expected the hunt's metered cuts to carry cutE (got ${n})`);
});

test('C1 S9 pans with the car: its lamps never leave a 16:10 frame, the pan never reverses, the ends are authored', () => {
  const tl = CUTSCENES.C1(ctx());
  const s9 = tl.shots!.find((s) => s.t === 56.6)!;
  assert.ok(s9.track, 'S9 tracks the vehicle');
  const seq = new Sequencer(tl, { cue() {}, camera() {}, move() {}, end() {}, vehicle() {} } as any);
  let prevYaw: number | null = null;
  for (let t = 56.6 + 1 / 30; t < 62 - 1e-6; t += 1 / 30) {
    const c = seq.cameraAt(t, t)!;
    const v = seq.vehicleAt(t)!;
    const yaw = Math.atan2(c.target[1] - c.pos[1], c.target[0] - c.pos[0]);
    const half = Math.atan(Math.tan((c.fov * Math.PI) / 360) * 1.6) * R2D;
    for (const x of [-0.58, 0.58]) {
      const h = v.heading;
      const p = [v.pos[0] + Math.sin(h) * x + Math.cos(h) * 2.43, v.pos[1] - Math.cos(h) * x + Math.sin(h) * 2.43];
      const off = wrap(Math.atan2(p[1] - c.pos[1], p[0] - c.pos[0]) - yaw) * R2D;
      assert.ok(Math.abs(off) < half - 2, `S9 ${t.toFixed(3)}: lamp ${x} at ${off.toFixed(1)}° (half-hfov ${half.toFixed(1)}°)`);
    }
    if (prevYaw !== null) assert.ok(wrap(yaw - prevYaw) > -0.002, `S9 ${t.toFixed(3)}: the pan reverses`);
    prevYaw = yaw;
  }
  // the shot's first and last looks are the authored targets
  for (const [t, tg] of [[56.6, s9.target[0]], [62 - 1e-6, s9.target[s9.target.length - 1]]] as const) {
    const c = seq.cameraAt(t, t)!;
    const want = Math.atan2(tg[1] - c.pos[1], tg[0] - c.pos[0]);
    const got = Math.atan2(c.target[1] - c.pos[1], c.target[0] - c.pos[0]);
    assert.ok(Math.abs(wrap(got - want)) * R2D < 0.5, `S9 at ${t}: look ${(got * R2D).toFixed(1)}° vs authored ${(want * R2D).toFixed(1)}°`);
  }
});

test('C2: the hand-off eases from the eye with the torch going down; the iris rides the hall; door, roll and lamp staged', () => {
  const tl = CUTSCENES.C2(ctx({ chained: false }));
  const at0 = tl.cues.filter((c) => c.t === 0);
  assert.ok(!at0.some((c: any) => c.type === 'light' && c.op === 'flashlight'), 'no one-frame torch off at t 0');
  const fade = at0.find((c: any) => c.type === 'fx' && c.id === 'torchFade') as any;
  assert.ok(fade && fade.params.d === C2_HANDOFF_S && fade.params.e1 === C2_CAMERA_E, 'torchFade over the hand-off to the film camera');
  const e = expo(tl);
  const e0 = e.find((c) => c.t === 0);
  assert.equal(e0.params.fixed, C2_CAMERA_E);
  assert.equal(e0.params.ramp, C2_HANDOFF_S, 'the film camera eases in from the eye (no ×9.5 step)');
  // S9's iris ride: up to C2_HALL_E after the pan leaves the lamp, back to f/2 before the lit parlor swings into view
  const up = e.find((c) => c.params.fixed === C2_HALL_E);
  const down = e.find((c) => c.t > up.t && c.params.fixed === C2_CAMERA_E);
  assert.ok(up && up.t >= 20.0 && up.params.ramp > 0.3, 'the ride up starts on the pan, eased');
  // #145 after1 iteration: held open over Harlan's dark corner, pulled in as the lamp pool enters the sweep (22.43) — done by 22.65
  assert.ok(down && down.t >= 22.2 && down.params.ramp >= 0.15 && down.t + down.params.ramp <= 22.65, 'and back at f/2 as the pool comes in');
  // F6: the lamp goes off only once D_PARLOR (closing from 27.6 at 70°/s through ≤ 92°) is shut
  const close = tl.cues.find((c: any) => c.type === 'door' && c.id === 'D_PARLOR' && c.action === 'close')!;
  const off = tl.cues.find((c: any) => c.type === 'fx' && c.id === 'shadowLight' && c.params?.at === 'off')!;
  assert.ok(off.t >= close.t + 92 / 70, `shadowLight off at ${off.t} while the door still swings`);
  assert.ok(off.t >= tl.duration - 1e-6, 'and not before the cut to C2c (no dark last frame)');
  // F8: the head rolls over on its own momentum right after the landing, finished before the lurch (8.6) can see it
  const nudge = tl.cues.find((c: any) => c.type === 'fx' && c.id === 'adaHead' && c.params?.mode === 'nudge')!;
  assert.equal(nudge.t, C2_ROLL);
  assert.ok(nudge.t >= C2_HEAD_LANDS + 0.25 && nudge.t + 0.5 <= 8.75, 'the roll sits between the bounce and the lurch');
});

// ---- round 2 (contract #145b): re-verify F7, F9, N1, N2 (scratch/fix/r2, docs/STATUS-smooth-fix.md "ROUND 2")
import { C4A_DOLLY_E, C4A_HANDBACK_E } from '../src/cutscenes/c4a-door-gives.ts';
import { C4_HIDE_LM, C4_HIDE_LM_TAU_IN, C4_HIDE_LM_TAU_OUT, HemOverlay } from '../src/cutscenes/c4-hem.ts';

test('C2c (F7, N1): the climb beam is aimed at the gaze from t 0; glance #2 at her hand distance; breath-hold at the stop', () => {
  const tl = CUTSCENES.C2c(ctx());
  const clamps = tl.cues.filter((c: any) => c.type === 'fx' && c.id === 'beamClamp') as any[];
  const first = clamps.find((c) => c.t === 0)!;
  assert.ok(first.params.on && first.params.gaze, 'the climb lights what the eye looks at (not a cone round the gaze direction)');
  const g2 = clamps.find((c) => Math.abs(c.t - 6.85) < 1e-6)!;
  assert.ok(g2.params.gaze && g2.params.d > 0.3 && g2.params.d < 1.5, 'glance #2: the gaze aim at her hand distance');
  const back = clamps.find((c) => c.t > g2.t && c.t <= 7.5)!;
  assert.ok(back && back.params.gaze && back.params.d === undefined, 'back to the gaze hit for the 7.45 turn (not held on her hand)');
  assert.ok(!clamps.some((c) => c.t > 0 && c.params.atX !== undefined), 'no fixed aim point left in the climb');
  const bh = tl.cues.find((c: any) => c.type === 'clip' && c.char === 'arms' && c.clip === 'arms_breath_hold')!;
  assert.equal(bh.t, 9.0, 'the breath-hold clip at the authored stop (its lowering beat clear of the 10.7–11 tilt)');
});

test('C4c (N2): ada_finale_take is cross-faded in held under the memory flash-frames, then runs on from it at 3.4', () => {
  const tl = CUTSCENES.C4c(ctx());
  const takes = tl.cues.filter((c: any) => c.type === 'clip' && c.char === 'ada' && c.clip === 'ada_finale_take') as any[];
  const held = takes.find((c) => c.speed === 0)!;
  const run = takes.find((c) => c.speed > 0)!;
  assert.ok(held && run && held.t < run.t, 'a held first frame, then the run');
  // the hold's cross-fade starts and ends inside the flash-frames (other rooms: 2.5–3.3), never on her
  const flash = (tl.shots ?? []).filter((s) => s.t >= 2.5 - 1e-6 && s.t + s.d <= 3.3 + 1e-6);
  assert.ok(flash.length >= 2, 'the warm flash-frames');
  assert.ok(held.t >= 2.5 && held.t + (held.fade ?? 0) <= 3.3 + 1e-6, `the hold fades in ${held.t}–${held.t + held.fade}, off screen`);
  // bank.ts keeps a re-cued clip's time only when no seek is asked (at < 0.5): the run continues the held frame
  assert.ok(!(run.at >= 0.5), 'the run does not seek');
});

test('C4a (F9): the dolly is its own exposure set-up; the hand-back keeps its camera', () => {
  const e = expo(CUTSCENES.C4a(ctx()));
  const dolly = e.find((c) => c.t === 8)!;
  assert.equal(dolly.params.fixed, C4A_DOLLY_E);
  assert.equal(e.find((c) => c.t === 11)!.params.fixed, C4A_HANDBACK_E);
});

test('C4 (F9): the hide view lifts the U3 night bake while hidden in Ada\'s wardrobe, eased (no pop)', () => {
  const hem = new HemOverlay({ active: null, play() {}, cancel() {}, resolveGate() {} } as any);
  hem.update(null, null);
  assert.equal(hem.lmWanted, 1);
  hem.update(null, 'H_ADA_WARDROBE');
  assert.equal(hem.lmWanted, C4_HIDE_LM);
  hem.update(null, 'H_ARMOIRE');
  assert.equal(hem.lmWanted, 1, 'only in her wardrobe');
  // the eased lift (bindings.ts tickHideLm): log-space τ — the largest frame-to-frame step at 30 fps
  const step = (tau: number) => Math.exp(Math.log(C4_HIDE_LM) * (1 - Math.exp(-1 / 30 / tau)));
  assert.ok(step(C4_HIDE_LM_TAU_IN) < 1.06 && step(C4_HIDE_LM_TAU_OUT) < 1.08, `≤ 6–8 % per frame (${step(C4_HIDE_LM_TAU_IN).toFixed(3)}, ${step(C4_HIDE_LM_TAU_OUT).toFixed(3)})`);
  // 0.0005 lux × the lift lands inside the moonlit overcast night's 0.003–0.03 lux (CLAUDE.md)
  assert.ok(0.0005 * C4_HIDE_LM >= 0.003 && 0.0005 * C4_HIDE_LM <= 0.03);
});
