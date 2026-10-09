// C2-ESCAPE (docs/C2-ESCAPE.md rev 2) — lane B-CINE: the stage constants against the layout, the framing rules, the
// C2 → C2c chain (camera continuity, skip → 10.4, the handover at S), the scheduled-cue maths and the stroke envelope.

const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import layoutJson from '../src/shared/level-layout.json' with { type: 'json' };
import type { LevelLayout } from '../src/shared/layout-types.ts';
import { CutscenePlayer, memorySeenStore, SCHED_LOOKAHEAD_S, type CutsceneDeps } from '../src/cutscenes/host.ts';
import { CUTSCENES } from '../src/cutscenes/index.ts';
import { Sequencer } from '../src/cutscenes/sequencer.ts';
import { C2E_D, C2E_T, NECK, LAMP_FLAME, STAIR_TOP_EYE, ST_MAIN, HARLAN_C2, lens, treadNosing } from '../src/cutscenes/stage.ts';
import { C2_DURATION, C2_END_EYE, C2_CONTACT, D_MAX_YAW, c2Room } from '../src/cutscenes/c2-room.ts';
import { C2C_DURATION, C2C_SKIP_AT, c2cUp } from '../src/cutscenes/c2c-up.ts';
import type { CutsceneContext, P3, Timeline } from '../src/cutscenes/types.ts';
import { SEVER_CONTACT_S } from '../src/audio/synth/escape.ts';

const layout = layoutJson as unknown as LevelLayout;
const near = (a: number[], b: number[], eps = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) <= eps);
const ctx = (o: Partial<CutsceneContext> = {}): CutsceneContext => ({ player: { eye: [3.3, 1.4, 2.25], heading: 0.8, pitch: 0, fov: 60 }, ada: null, flags: new Map(), seen: false, ...o });
const poses = (tl: Timeline, t: number) => {
  const seq = new Sequencer(tl, { cue: () => {}, camera: () => {}, move: () => {}, end: () => {} } as any);
  return seq.cameraAt(t);
};

test('C2-ESCAPE stage: constants match the layout (K2 lamp, K4 CP2, K5 parlor_lean, ST_MAIN)', () => {
  const lamp = layout.lights.find((l) => l.id === 'L_LAMP_PARLOR');
  assert.ok(lamp, 'L_LAMP_PARLOR in the layout');
  assert.ok(near(lamp!.pos as number[], LAMP_FLAME));
  assert.ok(Math.abs(lamp!.watts / (4 * Math.PI) - 12) < 0.1, '151 W / 4π ≈ 12 cd');
  const cam = layout.cameras.find((c) => c.id === 'parlor_lean');
  assert.ok(cam && near(cam.pos as number[], C2E_D) && near(cam.target as number[], NECK));
  const thr = layout.cameras.find((c) => c.id === 'parlor_threshold');
  assert.ok(thr && near(thr.pos as number[], C2E_T));
  const cp2 = layout.spawns.find((s) => s.id === 'CP2') as any;
  assert.ok(near(cp2.pos, STAIR_TOP_EYE.pos));
  assert.ok(Math.abs(cp2.pitch - STAIR_TOP_EYE.pitch) < 1e-3 && Math.abs(cp2.yaw - STAIR_TOP_EYE.heading) < 1e-3);
  const st = layout.stairs.find((s) => s.id === 'ST_MAIN')!;
  assert.equal(st.risers, ST_MAIN.risers);
  assert.ok(Math.abs(st.riserHeight - ST_MAIN.rise) < 1e-6 && Math.abs(st.treadDepth - ST_MAIN.run) < 1e-6);
  assert.deepEqual([...st.creakySteps], [...ST_MAIN.creaky]);
  assert.ok(near(treadNosing(16), [0.55, 8.08, 4.104]));
  assert.ok(Math.abs(lens(50) - 27.0) < 0.1 && Math.abs(lens(100) - 13.7) < 0.1);
  // the strike root is 10.7° left of the neck from D (§2.0 geom)
  const b = (p: number[]) => Math.atan2(p[1] - C2E_D[1], p[0] - C2E_D[0]);
  assert.ok(Math.abs(((b(HARLAN_C2.pos) - b(NECK)) * 180) / Math.PI - 10.7) < 1.5);
});

test('C2: every shot from the lean eye D keeps the lamp flame out of frame (aim yaw ≤ 49°, 16:9 at 50 mm)', () => {
  const tl = c2Room(ctx());
  const flame = Math.atan2(LAMP_FLAME[1] - C2E_D[1], LAMP_FLAME[0] - C2E_D[0]);
  for (let t = 3.0; t < 17.9; t += 0.05) {
    const p = poses(tl, t)!;
    if (Math.hypot(p.pos[0] - C2E_D[0], p.pos[1] - C2E_D[1]) > 0.02) continue;
    const yaw = Math.atan2(p.target[1] - p.pos[1], p.target[0] - p.pos[0]);
    const hHalf = Math.atan(Math.tan(((p.fov / 2) * Math.PI) / 180) * (16 / 9));
    if (p.fov > 20) assert.ok(yaw <= D_MAX_YAW + 0.2 * (Math.PI / 180), `t=${t.toFixed(2)} yaw ${(yaw * 180) / Math.PI}`); // not the 100 mm insert
    assert.ok(flame - yaw > hHalf, `t=${t.toFixed(2)}: flame inside the frame`);
  }
});

test('C2: the strike frame is rigid 7.30–8.60 (no handheld, the only motion is the head_drop flinch)', () => {
  const tl = c2Room(ctx());
  const a = poses(tl, 7.31)!;
  for (const t of [7.42, C2_CONTACT, 7.7, 8.2, 8.55]) {
    const p = poses(tl, t)!;
    assert.ok(near(p.pos, a.pos, 1e-9) && near(p.target, a.target, 1e-9));
    assert.ok(Math.abs(p.shake[0]) < 1e-9 && Math.abs(p.shake[2]) < 1e-9);
    assert.ok(Math.abs(p.shake[1]) <= 0.0035 + 1e-9);
  }
  const sev = tl.cues.find((c) => c.type === 'sfx' && c.id === 'cleaver_sever') as any;
  assert.ok(sev && sev.sched === true && Math.abs(sev.t + SEVER_CONTACT_S - C2_CONTACT) < 1e-3, 'the crack is heard on the contact frame');
});

test('C2 → C2c: same camera at the seam; C2c ends exactly at S with the gameplay FOV', () => {
  const c2 = c2Room(ctx());
  const c2c = c2cUp(ctx({ chained: true }));
  const end = poses(c2, C2_DURATION)!;
  const start = poses(c2c, 0)!;
  assert.ok(near(end.pos, start.pos, 1e-6) && near(end.target, start.target, 1e-6));
  assert.ok(near(end.pos, C2_END_EYE, 1e-6));
  assert.ok(Math.abs(end.fov - start.fov) < 1e-6);
  const last = poses(c2c, C2C_DURATION)!;
  assert.ok(near(last.pos, STAIR_TOP_EYE.pos, 1e-6));
  const h = Math.atan2(last.target[1] - last.pos[1], last.target[0] - last.pos[0]);
  const pitch = Math.atan2(last.target[2] - last.pos[2], Math.hypot(last.target[0] - last.pos[0], last.target[1] - last.pos[1]));
  assert.ok(Math.abs(h - STAIR_TOP_EYE.heading) < 1e-3 && Math.abs(pitch - STAIR_TOP_EYE.pitch) < 1e-3);
  assert.equal(last.fov, 60);
  const pl = c2c.cues.find((c) => c.type === 'player') as any;
  assert.ok(pl && near(pl.pos, STAIR_TOP_EYE.pos) && pl.pitch === STAIR_TOP_EYE.pitch && pl.t === C2C_DURATION);
  assert.ok(c2c.letterbox!.some((k) => k.t === 13.6 && k.v === 1) && c2c.letterbox!.some((k) => k.t === 13.9 && k.v === 0));
});

const fake = (log: string[]): CutsceneDeps => ({
  camera: { apply: () => {}, release: () => log.push('cam:release') },
  audio: { play: (id, o) => log.push(`sfx:${id}${o.delay !== undefined ? `@${o.delay.toFixed(3)}` : ''}`) },
  world: { fx: (id, p) => log.push(`fx:${id}:${JSON.stringify(p)}`), placePlayer: (e) => log.push(`player:${e.join(',')}`) },
  render: { dof: () => {}, blur: (v) => log.push(`blur:${v}`) },
});

test('host: the Director asks for C2 only; C2c follows chained; done fires once after C2c', () => {
  const log: string[] = [];
  const p = new CutscenePlayer({ deps: fake(log), library: CUTSCENES });
  const done: boolean[] = [];
  p.play('C2', (sk) => done.push(sk));
  for (let i = 0; i < Math.ceil(C2_DURATION / 0.05) + 2; i++) p.update(0.05);
  assert.equal(p.active, 'C2c');
  assert.deepEqual(done, []);
  for (let i = 0; i < Math.ceil(C2C_DURATION / 0.05) + 2; i++) p.update(0.05);
  assert.equal(p.active, null);
  assert.deepEqual(done, [false]);
  assert.ok(log.some((l) => l.startsWith('player:0.55,8.25,5.75')));
  assert.equal(log.filter((l) => l.startsWith('sfx:cleaver_sever')).length, 1, 'the chop plays once (scheduled)');
});

test('host: a skip in C2 lands in C2c at 10.4 with C2 state applied; a skip in C2c gives control at S', () => {
  const log: string[] = [];
  const p = new CutscenePlayer({ deps: fake(log), library: CUTSCENES, seen: memorySeenStore(['C2', 'C2c']) });
  const done: boolean[] = [];
  p.play('C2', (sk) => done.push(sk));
  p.update(1);
  assert.ok(p.skip());
  assert.equal(p.active, 'C2c');
  assert.ok(Math.abs(p.time - C2C_SKIP_AT) < 1e-9);
  assert.ok(log.some((l) => l === 'fx:blood:{"seq":"c2","phase":"end"}'));
  assert.ok(p.skip());
  assert.equal(p.active, null);
  assert.deepEqual(done, [true]);
  assert.ok(log.some((l) => l.startsWith('player:0.55,8.25,5.75')));
});

test('host B12: a sched sfx is handed to the audio clock ≤ 150 ms ahead with delay = cue time − clock, once', () => {
  const log: string[] = [];
  const tl: Timeline = { id: 'X', duration: 2, lock: 'full', cues: [{ t: 1.0, type: 'sfx', id: 'wet_chop', sched: true }, { t: 1.0, type: 'sfx', id: 'knock' }] };
  const p = new CutscenePlayer({ deps: fake(log), library: {} });
  p.play('X', () => {}, { timeline: tl });
  for (let i = 0; i < 17; i++) p.update(0.05); // 0.85 → inside the lookahead window (0.85, 1.0]
  const s = log.filter((l) => l.startsWith('sfx:wet_chop'));
  assert.equal(s.length, 1);
  const delay = Number(s[0].split('@')[1]);
  assert.ok(delay > 0 && delay <= SCHED_LOOKAHEAD_S + 1e-9 && Math.abs(delay - 0.15) < 1e-6);
  assert.ok(!log.includes('sfx:knock'));
  for (let i = 0; i < 10; i++) p.update(0.05);
  assert.equal(log.filter((l) => l.startsWith('sfx:wet_chop')).length, 1);
  assert.ok(log.includes('sfx:knock'));
});

import { BLOOD_TIERS, ballistic, poolRadius, seedC2, stainsOf, terminate, tauFor, vTerminal } from '../src/world/blood-math.ts';
import { C2_PULSES } from '../src/cutscenes/c2-room.ts';

test('B4 blood maths: drag, the pulse-1 landing (§3.3), tier caps, pools', () => {
  assert.ok(Math.abs(vTerminal(2) - 6.55) < 0.05 && Math.abs(vTerminal(4) - 8.7) < 0.05);
  // from rest a drop falls 0.80 m in ≈ 0.41 s (drag barely matters over 0.8 m)
  const p = terminate({ kind: 1, t0: 0, p0: [0, 0, 1.4], v0: [0, 0, 0], r: 0.002, tau: tauFor(0.002), tEnd: 0, ml: 0, hit: null }, [], 0.6);
  assert.ok(p.tEnd > 0.4 && p.tEnd < 0.45, `fall ${p.tEnd}`);
  assert.ok(Math.abs(ballistic([0, 0, 0], [1, 0, 0], 1e6, 0.5)[0] - 0.5) < 1e-3, 'no drag → straight line');
  for (const tier of ['low', 'medium', 'max'] as const) {
    const ps = seedC2({ neck: NECK, pulses: C2_PULSES.slice(0, 4), contact: C2_CONTACT, castoff: { p: [5.02, 3.74, 2.42], t: [2, 3.2] }, seep: { p: [5.3, 2.21, 1.38], from: 10.4, to: 22.5 }, tier: BLOOD_TIERS[tier] });
    assert.ok(ps.length <= BLOOD_TIERS[tier].cap, `${tier} cap`);
    assert.ok(stainsOf(ps, BLOOD_TIERS[tier].stains).length <= BLOOD_TIERS[tier].stains);
    const p1 = ps.filter((q) => q.kind === 0 && q.t0 < 7.85 && q.hit?.rec === 'floor');
    const first = Math.min(...p1.map((q) => q.tEnd));
    const far = Math.min(...p1.map((q) => q.hit!.p[0]));
    assert.ok(first > 7.9 && first < 8.05, `${tier} pulse 1 lands at ${first}`);
    assert.ok(NECK[0] - far > 0.95 && NECK[0] - far < 1.2, `${tier} pulse 1 reaches ${NECK[0] - far} m west`);
    // deterministic
    const again = seedC2({ neck: NECK, pulses: C2_PULSES.slice(0, 4), contact: C2_CONTACT, castoff: { p: [5.02, 3.74, 2.42], t: [2, 3.2] }, seep: { p: [5.3, 2.21, 1.38], from: 10.4, to: 22.5 }, tier: BLOOD_TIERS[tier] });
    assert.deepEqual(again.map((q) => q.tEnd), ps.map((q) => q.tEnd));
  }
  assert.ok(Math.abs(poolRadius(200) - 0.152) < 0.002, '200 mL ≈ 0.07 m² (r ≈ 15 cm)');
});
