// FLASH lane #146b (smooth motion): src/characters/arms.ts smoothQuaternionTracks — the arms GLB's rotation keys come
// out of Blender's glTF exporter quantised by meshopt's 8-bit quaternion filter (≈ 0.4–1.1° steps), so a slow idle sway
// stood still for several frames and then jumped. The load-time Gaussian low-pass must turn the staircase back into a
// smooth curve, keep the slow motion's amplitude, keep a loop's seam continuous and leave unit quaternions.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
import * as THREE_ from 'three/webgpu';
import { smoothQuaternionTracks } from '../src/characters/arms.ts';
const THREE = THREE_ as any;

/** A 4 s, 30 fps loop: rotation about X by a(t) = 1.2° sin(2π t / 4), quantised to `q` degrees (the 8-bit filter's step). */
function quantisedLoop(q: number) {
  const n = 121;
  const times = new Float32Array(n);
  const vals = new Float32Array(4 * n);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * 4;
    times[i] = t;
    const a = (1.2 * Math.sin((2 * Math.PI * t) / 4)) * (Math.PI / 180);
    const aq = Math.round(a / ((q * Math.PI) / 180)) * ((q * Math.PI) / 180);
    vals.set([Math.sin(aq / 2), 0, 0, Math.cos(aq / 2)], 4 * i);
  }
  vals.set(vals.slice(0, 4), 4 * (n - 1)); // the baker's loop: last key = first key
  const track = new THREE.QuaternionKeyframeTrack('hand_l.quaternion', times, vals);
  return new THREE.AnimationClip('arms_idle', 4, [track]);
}
const angleDeg = (v: any, i: number) => 2 * Math.atan2(v[4 * i], v[4 * i + 3]) * (180 / Math.PI);

test('a quantised slow loop becomes smooth: no frame step larger than the true motion allows', () => {
  const clip = quantisedLoop(0.6);
  const v = clip.tracks[0].values;
  let rawMax = 0;
  for (let i = 1; i < 121; i++) rawMax = Math.max(rawMax, Math.abs(angleDeg(v, i) - angleDeg(v, i - 1)));
  assert.ok(rawMax >= 0.59, `the fixture is a staircase (${rawMax}°)`);
  assert.equal(smoothQuaternionTracks(clip, 4), 1);
  let maxStep = 0;
  let maxErr = 0;
  for (let i = 1; i < 121; i++) maxStep = Math.max(maxStep, Math.abs(angleDeg(v, i) - angleDeg(v, i - 1)));
  for (let i = 0; i < 121; i++) maxErr = Math.max(maxErr, Math.abs(angleDeg(v, i) - 1.2 * Math.sin((2 * Math.PI * i) / 120)));
  // the true curve moves ≤ 2π·1.2/120 = 0.063°/key
  assert.ok(maxStep < 0.15, `largest key step ${maxStep.toFixed(3)}° (was ${rawMax.toFixed(2)}°)`);
  assert.ok(maxErr < 0.35, `error vs the unquantised sway ${maxErr.toFixed(3)}° (quantum 0.6°)`);
});

test('the loop seam stays continuous and the quaternions stay unit', () => {
  const clip = quantisedLoop(0.6);
  smoothQuaternionTracks(clip, 4);
  const v = clip.tracks[0].values;
  for (let c = 0; c < 4; c++) assert.ok(Math.abs(v[c] - v[4 * 120 + c]) < 1e-6, 'last key = first key');
  const seam = Math.abs(angleDeg(v, 1) - angleDeg(v, 0)) + Math.abs(angleDeg(v, 120) - angleDeg(v, 119));
  assert.ok(seam < 0.3, `steps either side of the seam ${seam.toFixed(3)}°`);
  for (let i = 0; i < 121; i++) assert.ok(Math.abs(Math.hypot(v[4 * i], v[4 * i + 1], v[4 * i + 2], v[4 * i + 3]) - 1) < 1e-5);
});

test('a hemisphere flip in the keys does not tear the filtered curve', () => {
  const clip = quantisedLoop(0.6);
  const v = clip.tracks[0].values;
  for (let i = 40; i < 60; i++) for (let c = 0; c < 4; c++) v[4 * i + c] = -v[4 * i + c]; // same rotations, other sign
  smoothQuaternionTracks(clip, 4);
  const q0 = new THREE.Quaternion();
  const q1 = new THREE.Quaternion();
  let maxStep = 0;
  for (let i = 1; i < 121; i++) {
    q0.fromArray(v, 4 * (i - 1));
    q1.fromArray(v, 4 * i);
    maxStep = Math.max(maxStep, (q0.angleTo(q1) * 180) / Math.PI);
  }
  assert.ok(maxStep < 0.15, `largest key step across the flipped run ${maxStep.toFixed(3)}°`);
});
