// JUMPSCARE (#147l, Spec §7 `jumpscare-decode`): the TS mirror of the scare clip's log curve round-trips <= 0.05 EV
// over its 12 stops through 8-bit codes and three's sRGB EOTF -> OETF; the shipped scare_face.json (when present) is
// self-consistent, its clips exist within the caps, and the manifests list them as kind `data` (never preloaded).
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
const fs = (await import('node:' + 'fs')) as any;
import {
  SCARE_CLIP_CAP_BYTES, SCARE_CLIP_TIERS, codecFor, decodeSampled, evError, logDecode, logEncode, metaProblems, srgbEOTF,
  srgbOETF,
} from '../src/world/jumpscare-math.ts';
import type { ScareMeta } from '../src/world/jumpscare-math.ts';

const ROOT = new URL('../', import.meta.url);
const STOPS = 12;
const LMAX = 5157.886;                   // the l1-staging trial encode (ref f0005 p99.9 1289.5 x 4)
const M = { L0: LMAX / 2 ** STOPS, R: Math.log2(1 + 2 ** STOPS) };

test('three r186 sRGB EOTF -> OETF is the identity on [0, 1] (the shader recovers v)', () => {
  let worst = 0;
  for (let i = 0; i <= 4096; i++) {
    const v = i / 4096;
    worst = Math.max(worst, Math.abs(srgbOETF(srgbEOTF(v)) - v));
  }
  assert.ok(worst < 2e-4, `worst |OETF(EOTF(v)) - v| = ${worst}`);
});

test('log curve: decode inverts encode below Lmax, clips above it', () => {
  for (const L of [0, M.L0 * 0.5, M.L0, 1, 37, 812, LMAX * 0.99]) {
    const v = logEncode(L, M);
    assert.ok(v >= 0 && v <= 1);
    assert.ok(Math.abs(logDecode(v, M) - L) <= 1e-9 * Math.max(1, L), `L ${L}`);
  }
  assert.equal(logEncode(LMAX * 4, M), 1);
  assert.ok(Math.abs(logDecode(1, M) - LMAX) / LMAX < 1e-9);
});

test('8-bit round trip <= 0.05 EV over 12 stops (full range and tv range 219 levels)', () => {
  for (const levels of [255, 219]) {
    let worst = 0;
    for (let s = 0; s <= STOPS * 8; s++) {
      const L = M.L0 * 2 ** (s / 8);                     // L0 .. Lmax in 1/8-stop steps
      const code = Math.round(logEncode(L, M) * levels) / levels;
      const sampled = srgbEOTF(code);                   // the GPU's sRGB texture decode
      const Ld = decodeSampled(sampled, M);              // the shader: OETF, then the log decode
      worst = Math.max(worst, Math.abs(evError(L, Ld, M.L0)));
    }
    assert.ok(worst <= 0.05, `${levels} levels: worst ${worst.toFixed(4)} EV`);
  }
});

test('metaProblems catches an inconsistent meta', () => {
  const ok: ScareMeta = { name: 'scare_face', fps: 30, frames: 30, stops: 12, L0: M.L0, R: M.R, Lmax: LMAX,
    codecs: { max: 'avc1.640028', medium: 'avc1.640028' } };
  assert.deepEqual(metaProblems(ok, ['max', 'medium']), []);
  assert.equal(codecFor(ok, 'low'), null);
  assert.ok(metaProblems(ok, ['low']).length > 0, 'a tier the meta has no codec for');
  assert.ok(metaProblems({ ...ok, L0: M.L0 * 2 }, ['max', 'medium']).length > 0);
  assert.ok(metaProblems({ ...ok, codecs: { max: 'avc1.4d401f', medium: 'avc1.640028' } }, ['max', 'medium']).length > 0);
  assert.ok(metaProblems({ ...ok, fps: 24 }, ['max', 'medium']).length > 0);
});

test('shipped clips (when present): meta consistent, files within caps, manifest kind data', (t: any) => {
  let seen = 0;
  for (const tier of SCARE_CLIP_TIERS) {
    const metaUrl = new URL(`public/assets/${tier}/scare_face.json`, ROOT);
    if (!fs.existsSync(metaUrl)) continue;
    seen++;
    const meta = JSON.parse(fs.readFileSync(metaUrl, 'utf8')) as ScareMeta;
    assert.deepEqual(metaProblems(meta, [tier]), [], `${tier} meta`);
    const mp4 = new URL(`public/assets/${tier}/scare_face.mp4`, ROOT);
    assert.ok(fs.existsSync(mp4), `${tier} scare_face.mp4 missing`);
    const bytes = fs.statSync(mp4).size;
    assert.ok(bytes > 50 * 1024 && bytes <= SCARE_CLIP_CAP_BYTES[tier], `${tier} clip ${bytes} B`);
    const man = JSON.parse(fs.readFileSync(new URL(`public/assets/${tier}/manifest.json`, ROOT), 'utf8'));
    const clip = man.files.find((f: any) => f.path === `assets/${tier}/scare_face.mp4`);
    const m2 = man.files.find((f: any) => f.path === `assets/${tier}/scare_face.json`);
    assert.ok(clip && clip.kind === 'data' && clip.id === 'scare_face', `${tier} manifest clip entry ${JSON.stringify(clip)}`);
    assert.ok(m2 && m2.kind === 'data' && m2.id === 'scare_face_meta', `${tier} manifest meta entry ${JSON.stringify(m2)}`);
  }
  // #147n: Low ships its own 640x400 clip too (the final review failed Low's in-engine fallback); every tier the same
  // log curve (one ref frame), so a tier switch never changes the face's exposure
  if (seen) {
    assert.equal(seen, SCARE_CLIP_TIERS.length, 'every clip tier ships its clip');
    const ms = SCARE_CLIP_TIERS.map((tier) => JSON.parse(fs.readFileSync(new URL(`public/assets/${tier}/scare_face.json`, ROOT), 'utf8')) as ScareMeta);
    for (const m of ms) assert.ok(m.L0 === ms[0].L0 && m.R === ms[0].R, 'one log curve on every tier');
  }
  if (!seen) t.diagnostic('no shipped scare_face.json yet');
});
