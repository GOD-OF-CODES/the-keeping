// PERF smoothness (#143): the load warm-up's cutscene shot poses (src/render/cs-shots.ts) — every shot of every warmed
// cutscene gets its first frame, poses stay inside the timeline, the DOF / blur chain flags follow the cues.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
import { CUTSCENES } from '../src/cutscenes/index.ts';
import { Sequencer } from '../src/cutscenes/sequencer.ts';
import { cutsceneShotPoses, cutsceneShownProps } from '../src/render/cs-shots.ts';

const IDS = ['C2b', 'C3', 'C4a', 'C4c', 'C5', 'C5b', 'C6', 'C6b', 'C7', 'CR'];
const ctxFor = (id: string) => ({ player: { eye: [2.6, 1.9, 2.25] as [number, number, number], heading: 0, pitch: 0, fov: 60, torch: true }, ada: null, flags: new Map<string, boolean>(), seen: false, chained: id === 'C6b' || id === 'CR', motionBlur: true, tier: 'max' });

test('every shot start of every warmed cutscene is a pose (inside the timeline, finite)', () => {
  const poses = cutsceneShotPoses(CUTSCENES, Sequencer as any, IDS, ctxFor);
  for (const id of IDS) {
    const tl = CUTSCENES[id]!(ctxFor(id));
    const mine = poses.filter((p) => p.id === id);
    for (const s of tl.shots ?? []) {
      if (s.t + 0.04 >= tl.duration) continue;
      assert.ok(mine.some((p) => Math.abs(p.t - (s.t + 0.04)) < 1e-3), `${id}: shot at ${s.t} has its first-frame pose`);
    }
    for (const p of mine) {
      assert.ok(p.t >= 0 && p.t < tl.duration, `${id} pose t ${p.t} inside 0..${tl.duration}`);
      assert.ok([...p.pos, ...p.target, p.fov].every(Number.isFinite), `${id} pose at ${p.t} is finite`);
    }
  }
});

test('the chain flags follow the cues: C4c is DOF throughout, C7 has DOF only in its interior shots', () => {
  const poses = cutsceneShotPoses(CUTSCENES, Sequencer as any, ['C4c', 'C7'], ctxFor);
  assert.ok(poses.filter((p) => p.id === 'C4c').every((p) => p.dof), 'C4c: DOF on every pose');
  const c7 = poses.filter((p) => p.id === 'C7');
  assert.ok(!c7.find((p) => p.t < 1)!.dof, 'C7 opens in the car without DOF');
  assert.ok(c7.some((p) => p.dof), 'C7: the guest book / threshold shots are DOF');
});

test('an unknown id or a factory that throws is skipped, never fatal', () => {
  const lib = { ...CUTSCENES, BAD: () => { throw new Error('needs live state'); } } as any;
  const poses = cutsceneShotPoses(lib, Sequencer as any, ['nope', 'BAD', 'C3'], ctxFor);
  assert.ok(poses.length > 0 && poses.every((p) => p.id === 'C3'));
});

test('props a cutscene shows with a prop cue are warmed with it (C7: the air freshener; C3: your car in the row)', () => {
  const shown = cutsceneShownProps(CUTSCENES, IDS, ctxFor);
  assert.ok(shown.get('C7')?.includes('P_AIR_FRESHENER'), 'C7 shows P_AIR_FRESHENER');
  assert.ok(shown.get('C3')?.includes('P_CAR_ROW'), 'C3 shows P_CAR_ROW');
  assert.ok(!shown.get('C3')?.includes('P_CAR_GATE'), 'a prop a cue HIDES is not shown');
});
