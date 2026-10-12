// M-A cues (CUTSCENES-PLAN §6 runtime 1, lighting-post 1–2): clip `at` + speed-0 holds, the `dof` focus pull
// (to, over), the `grade` cue and `lmScale` — eased, applied on skip, reset to identity at teardown. Pure.

const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
import { CutscenePlayer, memorySeenStore, type CutsceneDeps } from '../src/cutscenes/host.ts';
import type { CharId, DofSettings, Timeline } from '../src/cutscenes/types.ts';
import { GRADE, gradeIsIdentity, resetGrade } from '../src/render/grade.ts';

function rig() {
  const plays: { id: CharId; clip: string; speed: number; at: number }[] = [];
  const dofs: (DofSettings | null)[] = [];
  const fades: number[] = [];
  const deps: CutsceneDeps = {
    camera: { apply: () => {}, release: () => {} },
    characters: {
      has: () => true,
      place: () => {},
      setVisible: () => {},
      play: (id, clip, o) => (plays.push({ id, clip, speed: o.speed, at: o.at }), true),
    },
    ui: { overlay: (f) => fades.push(f) },
    render: { dof: (d) => dofs.push(d ? { ...d } : null) },
    context: () => ({ player: { eye: [0, 0, 1.6], heading: 0, pitch: 0 }, ada: null, flags: new Map() }),
  };
  const tl: Timeline = {
    id: 'T',
    duration: 4,
    lock: 'full',
    cues: [
      { t: 0, type: 'clip', char: 'ada', clip: 'ada_look', at: 0.7, speed: 0 },
      { t: 0.5, type: 'clip', char: 'ada', clip: 'ada_finale_take', at: 0.2, speed: 0.5 },
      { t: 0, type: 'dof', dof: { focusDistance: 0.42, focalLength: 0.05, bokehScale: 3 }, to: 2.0, over: 1 },
      { t: 0, type: 'grade', grade: { tint: [1.06, 0.97, 0.86], saturation: 0.6, grain: 1.6, vignette: 1.5, fade: 0.2 }, over: 1 },
      { t: 0, type: 'lmScale', scale: 0.45, over: 2 },
      { t: 3, type: 'grade', grade: null },
    ],
  };
  const player = new CutscenePlayer({ deps, library: { T: () => tl }, seen: memorySeenStore(['T']) });
  return { player, plays, dofs, fades };
}

test('clip cue `at` offsets the start and speed 0 holds that frame (late time never advances a hold)', () => {
  resetGrade();
  const r = rig();
  r.player.play('T', () => {});
  assert.deepEqual(r.plays[0], { id: 'ada', clip: 'ada_look', speed: 0, at: 0.7 });
  r.player.update(0.6); // the 0.5 cue fires 0.1 s late
  const p = r.plays[1];
  assert.equal(p.clip, 'ada_finale_take');
  assert.ok(Math.abs(p.at - (0.2 + 0.1 * 0.5)) < 1e-9, `at ${p.at}`);
  r.player.cancel();
});

test('dof focus pull eases 0.42 → 2.0 m over 1 s (smoothstep), only the focus distance changes', () => {
  resetGrade();
  const r = rig();
  r.player.play('T', () => {});
  assert.equal(r.dofs[0]!.focusDistance, 0.42);
  r.player.update(0.5);
  const mid = r.dofs[r.dofs.length - 1]!;
  assert.ok(Math.abs(mid.focusDistance - 1.21) < 0.02, `mid ${mid.focusDistance}`);
  assert.equal(mid.focalLength, 0.05);
  r.player.update(0.6);
  assert.equal(r.dofs[r.dofs.length - 1]!.focusDistance, 2.0);
  r.player.cancel();
  assert.equal(r.dofs[r.dofs.length - 1], null, 'teardown clears DOF');
});

test('grade + lmScale ease in, the fade composes with the overlay, reset at the end and at teardown', () => {
  resetGrade();
  const r = rig();
  r.player.play('T', () => {});
  r.player.update(0.5);
  assert.ok(GRADE.saturation < 1 && GRADE.saturation > 0.6, `easing saturation ${GRADE.saturation}`);
  r.player.update(0.6);
  assert.ok(Math.abs(GRADE.saturation - 0.6) < 1e-9 && Math.abs(GRADE.tint[2] - 0.86) < 1e-9 && GRADE.grain === 1.6);
  assert.ok(r.fades[r.fades.length - 1] >= 0.2 - 1e-9, 'the grade fade darkens the overlay');
  r.player.update(1);
  assert.ok(Math.abs(GRADE.lm - 0.45) < 1e-9, `lm ${GRADE.lm}`);
  r.player.update(1); // the t=3 reset (a cut)
  assert.equal(GRADE.saturation, 1);
  assert.ok(Math.abs(GRADE.lm - 0.45) < 1e-9, 'a grade reset leaves lmScale alone');
  r.player.cancel();
  assert.ok(gradeIsIdentity(), 'teardown restores identity');
});

test('skip applies the end state: grade cut to its final cue, lmScale to its target, then identity on finish', () => {
  resetGrade();
  const r = rig();
  let skipped: boolean | null = null;
  r.player.play('T', (s) => (skipped = s));
  assert.ok(r.player.skip());
  assert.equal(skipped, true);
  assert.ok(gradeIsIdentity(), 'nothing graded after the cutscene');
});
