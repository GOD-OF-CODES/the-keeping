// JUMPSCARE (#147m): the death cutaway is the jumpscare (docs/STATUS-jumpscare.md Spec §4). Timeline shape: 3 s, lock
// full, never skippable, the lunge → the cut at 0.15 s (sting scheduled on it, fixed film exposure, arms gone) → black by
// 1.40 → taken down under black → respawn untouched; ONLY her face (no wet hand over the lens, no hair-filling frames, no
// eye-glint insert); reducedFlash: no strobe (≤ 2 luminance transitions in any second, i.e. < 3 Hz), the cut a ramp.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
import { DEATH_DURATION, LUNGE_FREEZE_RAMP_S, deathCutaway } from '../src/cutscenes/death.ts';
import { Sequencer, type SequencerSink } from '../src/cutscenes/sequencer.ts';
import { sampleKeys } from '../src/cutscenes/math.ts';
import type { Cue, CutsceneContext } from '../src/cutscenes/types.ts';
import { hasRecipe } from '../src/audio/synth/index.ts';
import {
  SCARE_BLACK_AFTER_S,
  SCARE_BLACK_MEDIA_T,
  SCARE_CLIP_S,
  SCARE_CUT_T,
  SCARE_EXPOSURE,
  SCARE_FADE_T,
  SCARE_FALLBACK,
  SCARE_OFF_T,
  SCARE_PREVIEW_EV,
  SCARE_RADIANCE_SCALE,
  SCARE_REDUCED_RAMP_S,
  coverFit,
  keyAt,
  scareGain,
} from '../src/world/jumpscare-math.ts';

const ctx: CutsceneContext = { player: { eye: [2.4, 5.0, 5.75], heading: Math.PI / 2, pitch: 0, fov: 70 }, ada: { pos: [2.4, 7.0, 4.1], heading: -Math.PI / 2 }, flags: new Map([['ada_severed', true]]), seen: true };
const tl = deathCutaway(ctx);
const at = (t: number, pred: (c: Cue) => boolean) => tl.cues.filter((c) => Math.abs(c.t - t) < 1e-9 && pred(c));
const fx = (c: Cue, id: string) => c.type === 'fx' && c.id === id;

test('death = the jumpscare: 3 s, lock full, never skippable (respawn timing untouched)', () => {
  assert.equal(DEATH_DURATION, 3);
  assert.equal(tl.duration, DEATH_DURATION);
  assert.equal(tl.lock, 'full');
  assert.equal(tl.skippable, false);
  assert.ok(at(0, (c) => c.type === 'lock' && c.mode === 'full').length === 1);
  assert.ok(at(DEATH_DURATION, (c) => c.type === 'release' && c.char === 'ada').length === 1, 'Ada released at the end');
  assert.ok(at(DEATH_DURATION, (c) => c.type === 'visible' && c.char === 'arms' && c.visible).length === 1, 'arms back at the end');
});

test('the cut at 0.15 s: sting scheduled on it, jumpscare on, fixed film exposure + snap, arms hidden', () => {
  assert.equal(SCARE_CUT_T, 0.15);
  const sting = at(SCARE_CUT_T, (c) => c.type === 'sfx' && c.id === 'scare_sting');
  assert.equal(sting.length, 1);
  assert.equal((sting[0] as any).sched, true, 'clock-scheduled at the cutaway start (host.ts scheduleAhead) → lands on the cut frame');
  assert.ok(at(0, (c) => c.type === 'sfx' && c.id === 'scare_whoosh' && !(c as any).sched).length === 1, 'the whoosh plays plain at 0');
  assert.ok(hasRecipe('scare_sting') && hasRecipe('scare_whoosh') && hasRecipe('drowning_rush'));
  assert.equal(at(SCARE_CUT_T, (c) => fx(c, 'jumpscare') && (c as any).params?.on === true).length, 1);
  const ex = at(SCARE_CUT_T, (c) => fx(c, 'exposure'));
  assert.equal(ex.length, 1);
  const p = (ex[0] as any).params;
  assert.equal(p.snap, true);
  assert.equal(p.ramp, undefined, 'a film camera: no ramp, no pumping');
  // the exposed value of the clip's radiance (the quad outputs L × SCARE_RADIANCE_SCALE) ≈ Blender's preview EV
  assert.ok(Math.abs(Math.log2(p.fixed * SCARE_RADIANCE_SCALE) - SCARE_PREVIEW_EV) < 0.5, `fixed ${p.fixed} × ${SCARE_RADIANCE_SCALE} ≈ 2^${SCARE_PREVIEW_EV}`);
  assert.ok(p.fixed >= 1e-3, 'the exposure uniform stays ≥ 1e-3 (pipeline.ts bloom threshold clamp)');
  assert.equal(p.fixed, SCARE_EXPOSURE);
  assert.ok(at(SCARE_CUT_T, (c) => c.type === 'visible' && c.char === 'arms' && c.visible === false).length === 1);
});

test('black by 1.40 (fade 0 → 1 over 1.38 → 1.40, never two keys at one t), taken down under black, rush after', () => {
  const f = tl.fade!;
  for (let i = 1; i < f.length; i++) assert.ok(f[i].t > f[i - 1].t, 'strictly increasing fade keys');
  assert.equal(sampleKeys(f, SCARE_CUT_T + 0.5), 0, 'the face is not dimmed by the overlay');
  assert.equal(sampleKeys(f, SCARE_FADE_T[0]), 0);
  assert.equal(sampleKeys(f, SCARE_FADE_T[1]), 1);
  assert.equal(sampleKeys(f, DEATH_DURATION), 1, 'black until the respawn fade-in');
  assert.ok(SCARE_CUT_T + SCARE_CLIP_S < SCARE_FADE_T[0], 'the clip ends before the backstop fade');
  assert.ok(SCARE_OFF_T > SCARE_FADE_T[1], 'the quad comes down only under full black');
  assert.equal(at(SCARE_OFF_T, (c) => fx(c, 'jumpscare') && (c as any).params?.on === false).length, 1);
  assert.equal(at(SCARE_OFF_T, (c) => fx(c, 'exposure') && (c as any).params?.reset === true).length, 1);
  assert.ok(at(SCARE_OFF_T, (c) => c.type === 'visible' && c.char === 'ada' && c.visible === false).length === 1);
  assert.ok(tl.cues.some((c) => c.type === 'sfx' && c.id === 'drowning_rush' && c.t >= SCARE_FADE_T[1]));
});

test('ONLY her face: no wet hand over the lens, no hair-filling frames, no eye-glint insert, no grab_hit thud', () => {
  const ids = tl.cues.flatMap((c) => (c.type === 'fx' ? [c.id] : []));
  for (const banned of ['lens_wet_hand', 'eye_glint', 'hair_fill', 'lens_hair']) assert.ok(!ids.includes(banned), `fx ${banned}`);
  assert.ok(!tl.cues.some((c) => c.type === 'sfx' && c.id === 'grab_hit'), 'grab_hit folded into the sting');
  // the held shot (the face) is the long lens of the fallback; the lunge is ≤ the cut
  const held = tl.shots!.find((s) => Math.abs(s.t - SCARE_CUT_T) < 1e-9)!;
  assert.ok(held && held.t + held.d >= SCARE_OFF_T - 1e-9, 'one held shot covers the whole face');
  assert.equal(held.fov, SCARE_FALLBACK.fov);
  assert.ok(tl.moves!.every((m) => m.t + m.d <= SCARE_CUT_T + 1e-9), 'she lunges BEFORE the cut (no body move over the face)');
  // the arms are hidden over the whole face window (no hands in frame)
  const vis = tl.cues.filter((c) => c.type === 'visible' && c.char === 'arms').sort((a, b) => a.t - b.t);
  assert.ok(vis[0].t <= SCARE_CUT_T && (vis[0] as any).visible === false);
  assert.ok(vis.slice(1).every((c) => c.t >= SCARE_OFF_T));
});

test('the sequencer fires the cue set in order with any frame split (60 Hz / 30 Hz)', () => {
  for (const dt of [1 / 60, 1 / 30]) {
    const seen: string[] = [];
    const sink: SequencerSink = {
      cue: (c) => seen.push(`${c.t.toFixed(2)}:${c.type}:${'id' in c ? (c as any).id : ''}`),
      camera: () => {},
      move: () => {},
      gate: () => {},
      overlay: () => {},
      end: () => {},
    };
    const s = new Sequencer(tl, sink);
    s.update(0);
    for (let t = 0; t < DEATH_DURATION + 0.1; t += dt) s.update(dt);
    const cut = seen.filter((x) => x.startsWith('0.15:'));
    assert.deepEqual(cut.map((x) => x.split(':').slice(1).join(':')).sort(), ['fx:exposure', 'fx:jumpscare', 'sfx:scare_sting', 'visible:'].sort());
  }
});

test('quad gain: hard cut, black after the last frame / ended / the backstop; reducedFlash = 2-frame ramp, < 3 Hz', () => {
  assert.equal(scareGain(0, 0, false, false), 1, 'a one-frame cut');
  assert.equal(scareGain(0.5, 0.5, false, false), 1);
  assert.equal(scareGain(0.97, 29 / 30, false, false), 1, 'frame 29 (pts 0.967) is shown');
  assert.equal(scareGain(0.99, SCARE_BLACK_MEDIA_T, false, false), 0);
  assert.equal(scareGain(0.6, 0.6, true, false), 0, 'ended = black');
  assert.equal(scareGain(SCARE_BLACK_AFTER_S, 0.5, false, false), 0, 'a stalled decoder never freezes a face on screen');
  assert.equal(scareGain(0, 0, false, true), 0);
  assert.ok(Math.abs(scareGain(SCARE_REDUCED_RAMP_S / 2, 0, false, true) - 0.5) < 1e-9);
  assert.equal(scareGain(SCARE_REDUCED_RAMP_S, 0.07, false, true), 1);
  // transitions of the on-screen state (dark room → face → black) at 60 Hz over the cutaway, both settings
  for (const rf of [false, true]) {
    const lv: number[] = [];
    for (let t = 0; t <= DEATH_DURATION; t += 1 / 60) {
      const tOn = t - SCARE_CUT_T;
      const g = tOn < 0 ? 0.3 /* the dim room */ : t >= SCARE_OFF_T ? 0 : scareGain(tOn, Math.min(tOn, 29 / 30), tOn >= SCARE_CLIP_S, rf);
      lv.push(Math.max(g, 0) * (1 - sampleKeys(tl.fade!, t)));
    }
    // count direction changes of luminance steps > 10 % (WCAG general-flash logic): a flash = an opposing pair
    let last = 0;
    const flips: number[] = [];
    for (let i = 1; i < lv.length; i++) {
      const d = lv[i] - lv[i - 1];
      if (Math.abs(d) < 0.1) continue;
      const s = Math.sign(d);
      if (s !== last) flips.push(i / 60);
      last = s;
    }
    for (const t0 of flips) assert.ok(flips.filter((t) => t >= t0 && t < t0 + 1).length <= 2, `${rf ? 'reducedFlash' : 'default'}: ≤ 2 transitions per second (${flips.map((x) => x.toFixed(2))})`);
  }
});

test('fallback numbers + helpers: face fills the frame at 0.28 m, jaw spasm keys, cover-fit', () => {
  const h = 2 * SCARE_FALLBACK.dist * Math.tan((SCARE_FALLBACK.fov * Math.PI) / 360);
  assert.ok(h > 0.13 && h < 0.17, `frame height at the face ${h.toFixed(3)} m ≈ brow-to-chin`);
  assert.equal(keyAt(SCARE_FALLBACK.jaw, 0), 0.25);
  assert.equal(keyAt(SCARE_FALLBACK.jaw, 0.4), 0.6);
  assert.ok(keyAt(SCARE_FALLBACK.jaw, 0.45) < 0.6 && keyAt(SCARE_FALLBACK.jaw, 0.45) > 0.4);
  const f169 = coverFit(16 / 9, 1.6);
  assert.equal(f169.sx, 1);
  assert.ok(Math.abs(f169.sy - 0.9) < 1e-9 && Math.abs(f169.oy - 0.05) < 1e-9, '16:9 crops 5 % top and bottom');
  const f43 = coverFit(4 / 3, 1.6);
  assert.equal(f43.sy, 1);
  assert.ok(Math.abs(f43.sx - (4 / 3) / 1.6) < 1e-9);
  assert.deepEqual(coverFit(1.6, 1.6), { sx: 1, sy: 1, ox: 0, oy: 0 });
});

// ------------------------------------------------------------------ #147n (final review fixes)

test('#147n the lunge has a direction when she is AT the player (walked into her), and never pulls her backwards', () => {
  const eye: [number, number, number] = [2.4, 5.0, 5.75];
  const heading = Math.PI / 2; // +y (north)
  const lunge = (ada: [number, number, number]) => {
    const t = deathCutaway({ ...ctx, player: { ...ctx.player, eye, heading }, ada: { pos: ada, heading: 0 } });
    const m = t.moves![0];
    const end = m.path[m.path.length - 1] as number[];
    const shot = t.shots![0];
    const face = shot.target![shot.target!.length - 1] as number[];
    return { end, face, d: Math.hypot(end[0] - eye[0], end[1] - eye[1]), dir: Math.atan2(end[1] - eye[1], end[0] - eye[0]) };
  };
  // the final review's B06 catch: her feet 0.02 m off the eye's plumb line (any side) → the player's own heading
  for (const [ox, oy] of [[0.02, 0], [0, -0.012], [-0.014, 0.014], [0.1, -0.1]]) {
    const r = lunge([eye[0] + ox, eye[1] + oy, 4.1]);
    assert.ok(Math.abs(r.dir - heading) < 1e-9, `inside the player (${ox}, ${oy}): heading ${r.dir}`);
    assert.ok(r.d >= 0.3 - 1e-9 && r.d <= 0.45 + 1e-9, `grab ${r.d.toFixed(3)} m before the lens`);
    assert.ok(r.face[1] - eye[1] > 0.29, 'the camera turns to where she is drawn (ahead), not into noise');
  }
  // pressed against her (0.35 m ahead, the new body-overlap catch range): she holds her distance — no backward "lunge"
  assert.ok(Math.abs(lunge([eye[0], eye[1] + 0.35, 4.1]).d - 0.35) < 1e-9);
  assert.ok(Math.abs(lunge([eye[0], eye[1] + 0.2, 4.1]).d - 0.3) < 1e-9, 'never closer than 0.3 m (the lens clear of her body)');
  // a normal catch from 2 m to her right: towards her, 0.45 m before the lens
  const far = lunge([eye[0] + 2, eye[1], 4.1]);
  assert.ok(Math.abs(far.dir - 0) < 1e-9 && Math.abs(far.d - 0.45) < 1e-9);
});

test('#147n exposure: the exposure on screen is frozen through the 0.15 s lunge (no snap / meter step), film exposure at the cut', () => {
  const freeze = at(0, (c) => fx(c, 'exposure'));
  assert.equal(freeze.length, 1);
  const p = (freeze[0] as any).params ?? {};
  // a film-camera cue (fixed) — exposure.ts's fixed branch drops a pending snap — eased from the exposure on screen
  // (opening.ts `ramp` starts at exposureNow) over a ramp so long that it cannot move before the cut replaces it
  assert.ok(p.fixed > 0 && p.ramp === LUNGE_FREEZE_RAMP_S && p.hold === undefined, JSON.stringify(p));
  const u = SCARE_CUT_T / LUNGE_FREEZE_RAMP_S;
  const sm = u * u * (3 - 2 * u); // opening.ts exposureTick's smoothstep (log space)
  const e0 = 0.05; // a dim gameplay exposure; the cut's film exposure is ~2.5 EV darker
  const dEV = Math.abs(sm * Math.log2(p.fixed / e0));
  assert.ok(dEV < 1e-4, `the lunge drifts ${dEV} EV before the cut`);
  assert.ok(!tl.cues.some((c) => fx(c, 'exposure') && c.t > 0 && c.t < SCARE_CUT_T), 'nothing else touches it before the cut');
  const cut = at(SCARE_CUT_T, (c) => fx(c, 'exposure'));
  assert.equal(cut.length, 1);
  assert.ok((cut[0] as any).params?.fixed > 0 && !(cut[0] as any).params?.ramp, 'the cut replaces the frozen lunge (no ramp)');
});
