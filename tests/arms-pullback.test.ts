// FLASH lane (#146): the torch arm near walls (src/characters/arms.ts FpArms — two-bone IK pullback + near-wall aim).
// A synthetic left arm with the CHARACTERS.md proportions (shoulder (−0.19, −0.08, −0.26) Blender camera space,
// upper arm 0.32, forearm 0.27, torch centre (−0.135, 0.44, −0.235)) hangs under a rig at the eye; the world probe
// (TORCH_WORLD.sight) is an analytic wall plane z = −D in front of the eye (three: −Z forward).
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
import * as THREE_ from 'three/webgpu';
import { FpArms } from '../src/characters/arms.ts';
import { TORCH_WORLD } from '../src/render/flashlight-bounce.ts';
const THREE = THREE_ as any;

/** Blender camera space (x right, y forward, z up) → three (x right, y up, z back). */
const b2t = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

function makeArms() {
  const rig = new THREE.Object3D();
  const root = new THREE.Bone();
  root.name = 'root';
  const S = b2t(-0.19, -0.08, -0.26);
  const H = b2t(-0.135, 0.36, -0.235); // the grip, behind the torch centre
  // elbow: 0.32 from the shoulder, 0.27 from the wrist, bent down/out (the idle pose's plane)
  const u = H.clone().sub(S);
  const L = u.length();
  u.normalize();
  const a = 0.32;
  const b = 0.27;
  const cosA = (a * a + L * L - b * b) / (2 * a * L);
  const pole = new THREE.Vector3(-0.4, -1, 0).addScaledVector(u, -new THREE.Vector3(-0.4, -1, 0).dot(u)).normalize();
  const E = S.clone().addScaledVector(u, a * cosA).addScaledVector(pole, a * Math.sqrt(1 - cosA * cosA));
  const lens = H.clone().add(b2t(0, 0.2, 0)); // the lens 0.2 m ahead of the grip (≈ 0.56 m ahead of the eye)
  const mk = (name: string, parent: any, at: any, parentAt: any) => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.copy(at).sub(parentAt);
    parent.add(bone);
    return bone;
  };
  const up = mk('upperarm_l', root, S, new THREE.Vector3());
  const fore = mk('forearm_l', up, E, S);
  const hand = mk('hand_l', fore, H, E);
  const fl = mk('flashlight', hand, H, H);
  const beam = mk('flashlight_beam', fl, lens, H);
  const bones = new Map<string, any>([
    ['root', root],
    ['upperarm_l', up],
    ['forearm_l', fore],
    ['hand_l', hand],
    ['flashlight', fl],
    ['flashlight_beam', beam],
  ]);
  const c = { root, meshes: [], materials: [], bones, clips: new Map(), lensGlow: { value: 0 } };
  const arms = new FpArms(c as any, rig);
  const light = new THREE.Object3D();
  light.target = new THREE.Object3D();
  rig.add(light, light.target);
  return { rig, arms, light, lensRest: lens.clone() };
}

/** The wall z = −D (world; the rig sits at the origin looking down −Z). */
function wallProbe(getD: () => number) {
  TORCH_WORLD.sight = (o: any, d: any, far: number) => {
    const D = getD();
    if (d.z >= -1e-6) return Infinity;
    const t = (-D - o.z) / d.z;
    return t >= 0 && t <= far ? t : t < 0 ? 0 : Infinity;
  };
}

const lensWorld = (light: any) => {
  light.parent.updateMatrixWorld(true);
  return new THREE.Vector3().copy(light.position).applyMatrix4(light.parent.matrixWorld);
};
const beamDir = (light: any) => light.target.position.clone().sub(light.position).normalize();

test('far from walls the clip pose is untouched (no pull, no aim)', () => {
  const { arms, light, lensRest } = makeArms();
  wallProbe(() => 5);
  for (let i = 0; i < 60; i++) arms.update(1 / 60, light, null);
  assert.ok(arms.pull < 1e-6 && arms.aim < 1e-6, `pull ${arms.pull} aim ${arms.aim}`);
  assert.ok(lensWorld(light).distanceTo(lensRest) < 1e-6, 'lens at the clip position');
  assert.ok(beamDir(light).z < -0.999, 'beam straight ahead');
});

for (const speed of [1.6, 3.6]) {
  test(`walking at a wall at ${speed} m/s: the lens never enters it and the hand moves smoothly`, () => {
    const { arms, light } = makeArms();
    arms.aimEnabled = false; // pure pullback: the beam's direction must be kept
    let D = 1.6;
    wallProbe(() => D);
    for (let i = 0; i < 30; i++) arms.update(1 / 60, light, null);
    let prev = lensWorld(light);
    let minClear = Infinity;
    let maxStep = 0;
    for (let i = 0; i < 120; i++) {
      D = Math.max(0.27, D - speed / 60); // the body capsule stops the eye 0.27 m from the wall
      arms.update(1 / 60, light, null);
      const p = lensWorld(light);
      minClear = Math.min(minClear, -p.z - D < 0 ? D - -p.z : D + p.z); // signed: wall at −D, lens at p.z
      maxStep = Math.max(maxStep, p.distanceTo(prev));
      prev = p;
      const dir = beamDir(light);
      assert.ok(dir.z < -0.999, `frame ${i}: beam turned (${dir.toArray().map((v: number) => v.toFixed(3))})`);
    }
    assert.ok(minClear > 0.01, `the lens stayed in front of the wall (min clearance ${minClear.toFixed(3)} m)`);
    assert.ok(arms.pull > 0.2 && arms.pull <= 0.42 + 1e-9, `pulled back ${arms.pull.toFixed(3)} m at the wall`);
    // the hand follows the body (≤ the walking step + the withdrawal rate): no single-frame jump
    assert.ok(maxStep < 0.09, `largest lens step per frame ${maxStep.toFixed(3)} m`);
  });
}

// LOOK (#146c): at the bot's 30 fps the pull's target was probed every 2nd frame — the τ 0.05 s ease turned it into a
// 15 Hz sawtooth of the hand (lens steps 7.2 / 3.6 cm alternating) and the torch head swept out of the frame corner in
// one frame at contact. Probed every frame: even steps.
test('walking at a wall at 30 fps: the hand withdraws in even steps (no every-2nd-frame sawtooth)', () => {
  const { arms, light } = makeArms();
  let D = 2.0;
  wallProbe(() => D);
  for (let i = 0; i < 15; i++) arms.update(1 / 30, light, null);
  let prev = lensWorld(light);
  const steps: number[] = [];
  for (let i = 0; i < 60; i++) {
    D = Math.max(0.27, D - 1.6 / 30);
    arms.update(1 / 30, light, null);
    const p = lensWorld(light);
    steps.push(p.distanceTo(prev));
    prev = p;
  }
  let saw = 0;
  for (let i = 2; i < steps.length; i++) {
    const [a, b, c] = [steps[i - 2], steps[i - 1], steps[i]];
    if (b > 0.01 && b > 1.5 * a && b > 1.5 * c) saw++; // a lone big step between two small ones
  }
  assert.ok(saw === 0, `sawtooth steps: ${saw} (${steps.map((s) => (s * 100).toFixed(1)).join(' ')} cm)`);
  assert.ok(Math.max(...steps) < 0.06, `largest lens step ${(Math.max(...steps) * 100).toFixed(1)} cm per 30 fps frame`);
});

/** Where the beam axis meets the wall z = −D (world) — the gaze point is (0, 0, −D) for the level rig at the origin. */
const wallHit = (light: any, D: number) => {
  const p = lensWorld(light);
  const dir = beamDir(light);
  return p.clone().addScaledVector(dir, (-D - p.z) / dir.z);
};

test('near-wall aim: the beam lands ON the gaze point (< 2 cm, 0.5–1.25 m), eased, and lets go away from the wall', () => {
  // FLASH part 2 (V1): the aim was solved from the lens and applied about the wrist — the beam passed 13–16 cm above-right
  // of the gaze point at 0.7 m in game (this test allowed 9.5 cm at 0.6 m only). Now exact wherever the turn ≤ AIM_MAX.
  for (const D0 of [1.25, 1.0, 0.85, 0.7, 0.6, 0.5]) {
    const { arms, light } = makeArms();
    wallProbe(() => D0);
    for (let i = 0; i < 120; i++) arms.update(1 / 60, light, null);
    const hit = wallHit(light, D0);
    const off = Math.hypot(hit.x, hit.y);
    assert.ok(off < 0.02, `D ${D0}: pool ${(off * 100).toFixed(1)} cm from the gaze point (aim ${arms.aim.toFixed(3)}, pull ${arms.pull.toFixed(3)})`);
  }
  const { arms, light } = makeArms();
  let D = 0.6;
  wallProbe(() => D);
  for (let i = 0; i < 120; i++) arms.update(1 / 60, light, null);
  D = 5;
  for (let i = 0; i < 120; i++) arms.update(1 / 60, light, null);
  assert.ok(arms.aim < 0.01 && arms.pull < 0.01, `released (aim ${arms.aim.toFixed(3)}, pull ${arms.pull.toFixed(3)})`);
  assert.ok(beamDir(light).z < -0.999, 'beam back to the clip direction');
});

test('the IK never accumulates across frames (same input → same pose)', () => {
  const { arms, light } = makeArms();
  wallProbe(() => 0.4);
  for (let i = 0; i < 120; i++) arms.update(1 / 60, light, null);
  const a = lensWorld(light);
  for (let i = 0; i < 120; i++) arms.update(1 / 60, light, null);
  assert.ok(lensWorld(light).distanceTo(a) < 1e-4, 'steady pose');
  TORCH_WORLD.sight = null;
});

// FLASH part 2 (V1/V3): in the game the arms are posed BEFORE the rig follows the eye (story-runtime → main.ts); the
// rig then calls FpArms.afterRig(). Posed against last frame's rig, the beam passed ≈ 5 cm below the gaze point while
// walking at a wall and jumped ≈ 90 px @1280 at the stop. A real FlashlightRig, the game's order, a camera walking at
// the wall at 1.6 m/s and stopping at the 0.27 m capsule: the pool stays on the gaze point and moves smoothly.
test('game frame order (arms, then the rig): walking at a wall the pool stays on the gaze point, no jump at the stop', async () => {
  const { FlashlightRig } = await import('../src/player/flashlight-rig.ts');
  const { PRESETS } = await import('../src/render/presets.ts');
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(70, 1.6, 0.03, 90);
  scene.add(cam);
  const rig = new FlashlightRig(scene, cam, (PRESETS as any).medium);
  const { arms } = (() => {
    const m = makeArms();
    rig.rig.add(m.arms.c.root); // re-parent the synthetic arm under the real rig
    return { arms: new FpArms(m.arms.c as any, rig.rig) };
  })();
  const L = rig.flashlight.light;
  const W = 2.0; // the wall z = −W
  TORCH_WORLD.sight = (o: any, d: any, far: number) => {
    if (d.z >= -1e-6) return Infinity;
    const t = (-W - o.z) / d.z;
    return t >= 0 && t <= far ? t : t < 0 ? 0 : Infinity;
  };
  cam.position.set(0, 0, 0);
  const dt = 1 / 30;
  let t = 0;
  const frame = () => {
    cam.updateMatrixWorld(true);
    arms.update(dt, L, null);
    rig.update(dt, (t += dt));
  };
  for (let i = 0; i < 60; i++) frame();
  let prev: any = null;
  let worstMiss = 0;
  let worstStep = 0;
  let worstRise = 0;
  let prevMiss: number | null = null;
  for (let i = 0; i < 75; i++) {
    cam.position.z = Math.max(-(W - 0.27), cam.position.z - 1.6 * dt);
    frame();
    const D = W + cam.position.z; // eye to wall
    L.updateMatrixWorld(true);
    L.target.updateMatrixWorld(true);
    const p = new THREE.Vector3().setFromMatrixPosition(L.matrixWorld);
    const dir = new THREE.Vector3().setFromMatrixPosition(L.target.matrixWorld).sub(p).normalize();
    const hit = p.clone().addScaledVector(dir, (-W - p.z) / dir.z);
    const s = hit.clone().project(cam);
    const px = [(s.x + 1) * 640, (1 - s.y) * 400];
    const miss = Math.hypot(hit.x - cam.position.x, hit.y - cam.position.y);
    // the aim spring trails the approach by ≈ 0.2 s: the pool climbs onto the gaze point by ≈ 0.85 m, never away from it
    if (D <= 0.85) worstMiss = Math.max(worstMiss, miss);
    if (D <= 1.25 && prevMiss != null) worstRise = Math.max(worstRise, miss - prevMiss);
    prevMiss = D <= 1.25 ? miss : null;
    if (prev && D <= 1.0) worstStep = Math.max(worstStep, Math.hypot(px[0] - prev[0], px[1] - prev[1]));
    prev = px;
  }
  TORCH_WORLD.sight = null;
  assert.ok(worstMiss < 0.03, `walking in from 0.85 m and stopped: the pool strays ${(worstMiss * 100).toFixed(1)} cm from the gaze point`);
  assert.ok(worstRise < 0.005, `from 1.25 m in the pool only closes on the gaze point (largest step away ${(worstRise * 100).toFixed(2)} cm)`);
  assert.ok(worstStep < 15, `largest pool step ${worstStep.toFixed(1)} px per 30 fps frame @1280×800`);
});

test('aim onset and gaze hops are smooth (no one-frame re-aim)', () => {
  // the aim weight starts from rest (AIM_W spring) and a hop of the gaze point to a nearer surface glides (GAZE_HOP):
  // the old first-order ease turned the beam 20 % of a whole re-aim in the first 30 fps frame (verify pan2: 34–53 px)
  const run = (D0: number, D1: number, warm: number) => {
    const { arms, light } = makeArms();
    let D = D0;
    wallProbe(() => D);
    for (let i = 0; i < warm; i++) arms.update(1 / 30, light, null);
    let prev = beamDir(light);
    let worst = 0;
    D = D1;
    for (let i = 0; i < 30; i++) {
      arms.update(1 / 30, light, null);
      const d = beamDir(light);
      worst = Math.max(worst, (d.angleTo(prev) * 180) / Math.PI);
      prev = d;
    }
    return { worst, arms };
  };
  const onset = run(5, 0.7, 30); // nothing near → a wall at 0.7 m enters the gaze
  assert.ok(onset.worst < 6, `onset: largest beam turn ${onset.worst.toFixed(2)}° per frame`);
  assert.ok(onset.arms.aim > 0.9 && onset.arms.aim <= 1, `onset settles (aim ${onset.arms.aim.toFixed(3)})`);
  const hop = run(1.2, 0.6, 60); // aimed at a wall at 1.2 m → a rail at 0.6 m enters the gaze
  assert.ok(hop.worst < 6, `hop: largest beam turn ${hop.worst.toFixed(2)}° per frame`);
  TORCH_WORLD.sight = null;
});

test('panning across stair balusters: the torch does not snap to each one (verify pan2: 34–53 px one-frame jumps)', () => {
  // the rig yaws 6° per 30 fps frame past balusters 0.66 m away (hit in 3 frames of every 8, nothing near in between)
  const { rig, arms, light } = makeArms();
  let k = 0;
  TORCH_WORLD.sight = (o: any, d: any, far: number) => {
    const onBaluster = k % 8 < 3;
    // the hit at 0.66 m along the ray only for the rig's gaze ray (near −Z of the rig) — the torch-line probes see nothing
    return onBaluster && Math.abs(d.y) < 0.2 && 0.66 <= far ? 0.66 : Infinity;
  };
  for (let i = 0; i < 30; i++) arms.update(1 / 30, light, null);
  let prev = beamDir(light).clone();
  let worst = 0;
  for (k = 0; k < 48; k++) {
    rig.rotation.set(0, (-k * 6 * Math.PI) / 180, 0);
    rig.updateMatrixWorld(true);
    arms.update(1 / 30, light, null);
    const d = beamDir(light); // rig frame: what the screen shows
    worst = Math.max(worst, (d.angleTo(prev) * 180) / Math.PI);
    prev = d.clone();
  }
  TORCH_WORLD.sight = null;
  // (the view itself turns 6° per frame; a beam held on a world point turns with it — old code: 23° in one frame)
  assert.ok(worst < 12, `largest beam turn in the view ${worst.toFixed(2)}° per frame`);
});

// FLASH #146b (the hand): the torch hand is on the body — looking down/up the fist swings about the eye by −0.2 × the
// view pitch (≤ 10°), translation only (the beam keeps its aim); level gaze, a cutscene hold or pitchK 0 = the clip pose.
const lensRig = (light: any) => light.position.clone();
test('pitch decoupling: looking down raises the fist in the frame, looking up lowers it; the beam keeps its aim', () => {
  wallProbe(() => 50);
  const run = (pitchDeg: number, setup?: (a: any) => void) => {
    const { rig, arms, light } = makeArms();
    setup?.(arms);
    rig.rotation.set((pitchDeg * Math.PI) / 180, 0, 0);
    rig.updateMatrixWorld(true);
    for (let i = 0; i < 90; i++) arms.update(1 / 60, light, null);
    return { arms, lens: lensRig(light), dir: beamDir(light) };
  };
  const level = run(0);
  const down = run(-45);
  const up = run(30);
  assert.ok(Math.abs(level.arms.pitchSwing) < 1e-9, 'level gaze: no swing');
  assert.ok(Math.abs(down.arms.pitchSwing - (9 * Math.PI) / 180) < 2e-3, `down 45: swing ${down.arms.pitchSwing}`);
  assert.ok(Math.abs(up.arms.pitchSwing + (6 * Math.PI) / 180) < 2e-3, `up 30: swing ${up.arms.pitchSwing}`);
  // rig frame (camera): +y up. Down → the lens higher in the frame; up → lower
  assert.ok(down.lens.y > level.lens.y + 0.04, `down: lens y ${down.lens.y} vs ${level.lens.y}`);
  assert.ok(up.lens.y < level.lens.y - 0.03, `up: lens y ${up.lens.y} vs ${level.lens.y}`);
  // translation only: the beam direction in the rig frame is unchanged
  assert.ok(down.dir.angleTo(level.dir) < 1e-6 && up.dir.angleTo(level.dir) < 1e-6, 'beam keeps its aim');
  const held = run(-45, (a) => (a.cutsceneHold = true));
  assert.ok(Math.abs(held.arms.pitchSwing) < 1e-9 && held.lens.distanceTo(level.lens) < 1e-9, 'cutscene hold: the clip pose');
  const off = run(-45, (a) => (a.pitchK = 0));
  assert.ok(off.lens.distanceTo(level.lens) < 1e-9, 'pitchK 0 = the welded hand');
});

test('pitch decoupling eases (no pop on a fast look)', () => {
  wallProbe(() => 50);
  const { rig, arms, light } = makeArms();
  for (let i = 0; i < 10; i++) arms.update(1 / 60, light, null);
  rig.rotation.set((-45 * Math.PI) / 180, 0, 0); // a flick down in one frame
  rig.updateMatrixWorld(true);
  let prev = lensRig(light);
  let maxStep = 0;
  for (let i = 0; i < 60; i++) {
    arms.update(1 / 60, light, null);
    const p = lensRig(light);
    maxStep = Math.max(maxStep, p.distanceTo(prev));
    prev = p;
  }
  assert.ok(maxStep < 0.01, `largest per-frame lens step ${maxStep} m (≤ 1 cm at 60 fps)`);
});

// FLASH part 2 (fixer r2): a wall BESIDE the player (the torch side). The pull only probes along the torch line, so the
// elbow went into a left-hand wall (in game: the sleeve cut by the wallpaper at the bottom-left, looking down while
// hugging a wall — scratch/flash-fixr2/elbowsim.ts). The elbow now swings down out of it; the torch does not move.
function sideWallProbe(getW: () => number) {
  TORCH_WORLD.sight = (o: any, d: any, far: number) => {
    const W = getW();
    if (d.x >= -1e-6) return Infinity;
    const t = (-W - o.x) / d.x;
    return t >= 0 && t <= far ? t : t < 0 ? 0 : Infinity;
  };
}
const elbowWorld = (arms: any) => {
  const e = new THREE.Vector3();
  arms.c.bones.get('forearm_l').getWorldPosition(e);
  return e;
};

test('a wall beside the torch arm: the elbow swings out of it, the torch and its beam stay put', () => {
  const W = 0.21; // the synthetic elbow sits ≈ 1.9 cm past x = −0.21 (the shoulder 2 cm clear of it)
  const run = (fold: boolean) => {
    const { arms, light } = makeArms();
    arms.foldEnabled = fold;
    sideWallProbe(() => W);
    for (let i = 0; i < 90; i++) arms.update(1 / 60, light, null);
    return { arms, lens: lensWorld(light), dir: beamDir(light), elbow: elbowWorld(arms) };
  };
  const off = run(false);
  const on = run(true);
  assert.ok(off.elbow.x < -W, `the clip elbow is inside the wall without the fold (x ${off.elbow.x.toFixed(3)})`);
  assert.ok(on.arms.fold > 0.05, `the elbow swung (${((on.arms.fold * 180) / Math.PI).toFixed(1)}°)`);
  assert.ok(on.elbow.x > -W, `the elbow is out of the wall (x ${on.elbow.x.toFixed(3)} vs wall −${W})`);
  assert.ok(on.elbow.y < off.elbow.y, 'it swung DOWN (toward the body), not up');
  assert.ok(on.lens.distanceTo(off.lens) < 1e-3, `the lens did not move (${(on.lens.distanceTo(off.lens) * 1000).toFixed(2)} mm)`);
  assert.ok(on.dir.angleTo(off.dir) < 1e-3, 'the beam kept its direction');
  // far from the wall: no swing
  const { arms, light } = makeArms();
  sideWallProbe(() => 2);
  for (let i = 0; i < 60; i++) arms.update(1 / 60, light, null);
  assert.ok(arms.fold < 1e-6, `no swing away from walls (${arms.fold})`);
});

test('strafing into a wall beside the torch arm: the elbow gives way smoothly (no one-frame swing)', () => {
  for (const speed of [1.6, 3.6]) {
    const { arms, light } = makeArms();
    let W = 0.8;
    sideWallProbe(() => W);
    for (let i = 0; i < 30; i++) arms.update(1 / 30, light, null);
    let prev = elbowWorld(arms);
    let maxStep = 0;
    let maxIn = 0;
    for (let i = 0; i < 45; i++) {
      W = Math.max(0.21, W - speed / 30);
      arms.update(1 / 30, light, null);
      const e = elbowWorld(arms);
      // the elbow's move relative to the body, minus nothing: the rig is fixed, the wall comes in
      maxStep = Math.max(maxStep, e.distanceTo(prev));
      maxIn = Math.max(maxIn, -W - e.x);
      prev = e;
    }
    assert.ok(maxStep < 0.06, `${speed} m/s: largest elbow step ${(maxStep * 100).toFixed(1)} cm per 30 fps frame`);
    assert.ok(maxIn < 0.03, `${speed} m/s: the elbow never went more than 3 cm into the wall (${(maxIn * 100).toFixed(1)} cm)`);
    assert.ok(-W - elbowWorld(arms).x < 0, 'settled: out of the wall');
  }
});
