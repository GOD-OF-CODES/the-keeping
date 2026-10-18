// FLASH lane #146b (the hand): src/player/flashlight-rig.ts handInertia — the torch hand follows the eye through a
// damped spring driven by the eye's ACCELERATION (not its velocity): a steady walk leaves no offset, the stride bob
// leaves a few mm, a teleport / snap leaves none, the offset never exceeds the arm's play, and the result does not
// depend on the frame rate.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
import * as THREE_ from 'three/webgpu';
import { FlashlightRig } from '../src/player/flashlight-rig.ts';
import { PRESETS } from '../src/render/presets.ts';
const THREE = THREE_ as any;

function makeRig() {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(70, 1.6, 0.03, 90);
  scene.add(cam);
  const rig = new FlashlightRig(scene, cam, (PRESETS as any).medium);
  return { rig, cam };
}

/** Runs `secs` of a camera path eye(t) at `fps`; returns the hand offsets (m) per frame. */
function run(eye: (t: number) => [number, number, number], secs: number, fps: number, inertia = true): number[][] {
  const { rig, cam } = makeRig();
  rig.handInertia = inertia;
  const out: number[][] = [];
  const dt = 1 / fps;
  for (let i = 0; i <= Math.round(secs * fps); i++) {
    const t = i * dt;
    cam.position.set(...eye(t));
    rig.update(i === 0 ? 0 : dt, t);
    out.push([rig.handOffset.x, rig.handOffset.y, rig.handOffset.z]);
  }
  return out;
}

const mag = (v: number[]) => Math.hypot(v[0], v[1], v[2]);

test('a steady walk leaves the hand where the clip holds it (no velocity lag)', () => {
  const offs = run((t) => [0, 1.65, -1.6 * t], 3, 60);
  const tail = offs.slice(-60).map(mag);
  assert.ok(Math.max(...tail) < 1e-4, `steady offset ${Math.max(...tail)}`);
});

test('the stride bob moves the hand a few mm relative to the eye, smoothly', () => {
  // the controller's walking bob: 4.5 cm dip at 2.2 steps/s (1.6 m/s, 0.72 m stride) + 2.8 cm lateral
  const f = 1.6 / 0.72 / 2;
  const offs = run((t) => [0.028 * Math.sin(2 * Math.PI * f * t), 1.65 - 0.045 * (1 - Math.abs(Math.sin(2 * Math.PI * f * t))), -1.6 * t], 4, 60);
  const tail = offs.slice(-120);
  const peak = Math.max(...tail.map(mag));
  assert.ok(peak > 0.002 && peak < 0.012, `bob offset peak ${peak}`);
  // continuous: the controller's bob has a velocity kink at each heel strike (1 − |sin|), so the hand's relative
  // velocity kinks too (a bounce, as real hand-held footage shows), but its position never jumps: ≤ 0.5 m/s × dt
  let jump = 0;
  for (let i = 1; i < tail.length; i++) jump = Math.max(jump, mag([tail[i][0] - tail[i - 1][0], tail[i][1] - tail[i - 1][1], tail[i][2] - tail[i - 1][2]]));
  assert.ok(jump < 0.5 / 60, `per-frame change ${jump} vs peak ${peak}`);
});

test('a teleport (or a cutscene snap) leaves no offset', () => {
  const offs = run((t) => (t < 1 ? [0, 1.65, -1.6 * t] : [20, 1.65, 5]), 1.5, 60);
  const after = offs.slice(61, 64).map(mag);
  assert.ok(Math.max(...after) < 1e-6, `after teleport ${after}`);
});

test('the offset is bounded by the arm (a fall / landing)', () => {
  // a 1 m drop in 0.45 s then a hard stop
  const offs = run((t) => [0, 1.65 - (t < 0.45 ? 0.5 * 9.81 * t * t : 0.99), 0], 1.2, 60);
  const peak = Math.max(...offs.map(mag));
  assert.ok(peak <= 0.0251, `peak ${peak}`);
});

test('the hand does not depend on the frame rate', () => {
  // a smooth path (a 30 fps frame cannot sample a heel-strike kink the way a 120 fps one does: that is input, not drift)
  const path = (t: number): [number, number, number] => [0, 1.65 - 0.0225 * (1 - Math.cos(2 * Math.PI * 2.2 * t)), -1.6 * (t < 1 ? t * t / 2 : t - 0.5)];
  const a = run(path, 2, 30);
  const b = run(path, 2, 120);
  // compare at the same times (every 4th 120 fps frame = each 30 fps frame)
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, mag([a[i][0] - b[i * 4][0], a[i][1] - b[i * 4][1], a[i][2] - b[i * 4][2]]));
  assert.ok(worst < 0.001, `30 vs 120 fps differ by ${worst} m`);
});

test('handInertia off = the old welded hand', () => {
  const f = 1.1;
  const offs = run((t) => [0, 1.65 - 0.045 * Math.abs(Math.sin(2 * Math.PI * f * t)), -1.6 * t], 2, 60, false);
  assert.ok(Math.max(...offs.map(mag)) < 1e-9);
});
