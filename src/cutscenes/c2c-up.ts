// C2c 'Up' — docs/C2-ESCAPE.md rev 2 §2.2 + §4 (13.9 s, full lock, chained from C2 on the same camera). POV only:
// the 154° whip turn to the stair foot, the run across the hall, the newel, risers 1–5 at 3.1 risers/s (the creak on
// 5), lightning through the front-door FANLIGHT behind her (the roaming shadow light), glance #1 held 630 ms on her
// hard back-lit silhouette rounding the newel, risers 6–12, the stumble on the creaker 12 (hands and knees), glance #2
// held 600 ms on her hand on the wet handrail 0.9 m away, the scramble up 13–16, the top, the slow turn, and the
// EMPTY stair: her wet prints climb to tread 11 and stop, a drop falls from 11's nosing every 0.6 s, the U1 window
// stroke flares the far end. Control returns on the exact last camera (S, pitch −0.87) as the letterbox retracts.
//
// Her catch-up happens unseen (6.46–6.85, the camera is in the treads). At 10.4 (the camera faces north, away from
// the flight) she becomes invisible and her root goes to G_PARLOR_LURE: no sound, no prints, no motion on screen.
// The riser maths: tread k's nosing is at y = 3.60 + 0.28k, z = 0.60 + 0.219k (ST_MAIN, 16 risers).

import { C2_ADA_END, C2_END_EYE, C2_END_TARGET } from './c2-room.ts';
import { GROUND, NODE, STAIR_TOP_EYE, ST_MAIN, add, fwd, headingTo, lens, treadNosing } from './stage.ts';
import type { CameraShot, Cue, MoveTrack, P3, Timeline, TimelineFactory } from './types.ts';
import { sweepTargets, turnBetween } from './math.ts';

/** Fix round 3 (ruling m): C2's film camera (ISO 3200, f/2, 1/48 s → e_phys = 0.18/L_mid = 0.24, see C2_CAMERA_E) in
 *  scene units for the TORCH-lit climb: the 2900 K torch colour is max-normalised (luminance 0.5244 of its nominal
 *  candela) → 0.24 / 0.5244 = 0.458. (The lamp-lit parlor behind reads 0.36× darker than at C2's 0.625 — the
 *  convention, not the camera; one exposure per take.) */
export const C2C_CAMERA_E = 0.458;
export const C2C_DURATION = 13.9;
/** A skip inside C2 lands here (the slow turn). */
export const C2C_SKIP_AT = 10.4;
/** Eye heights above the floor/tread: crouched sprint, standing at the top. */
export const RUN_EYE = 1.55;
export const TOP_EYE = 1.65;
/** The fanlight stroke (glance #1) and the U1 window stroke (the reveal): C2c times of the pulse onsets. */
export const FANLIGHT_STROKE = { t: 3.62, pulses: '0.7@0,0.5@0.12,1.0@0.26,0.8@0.40:0.18' } as const;
export const WINDOW_STROKE = { t: 12.9, pulses: '0.6@0,1.0@0.1,0.7@0.24:0.18' } as const;
/** Ada's last tread (her prints stop here; the drip falls from its nosing onto tread 10). */
export const ADA_LAST_TREAD = 11;

/** The eye on tread k (fractional), `back` m behind the nosing, `h` above the tread. */
export const eyeOnTread = (k: number, h = RUN_EYE, back = 0.14, x = ST_MAIN.x): P3 => {
  const n = treadNosing(k);
  return [x, n[1] - back, n[2] + h];
};

/** Ada's root on tread k (feet on the tread, centre of the 1.1 m flight, a little east: her right hand on the rail). */
export const adaOnTread = (k: number): P3 => {
  const n = treadNosing(k);
  return [ST_MAIN.x + 0.18, n[1] - 0.12, n[2]];
};

const DEG = Math.PI / 180;
/** Glance #1 (C2c 3.84–4.47): her root as the glance opens / closes (fix round re-block, see g1Target). */
// r2 (s2med C2c 4.0): at (1.81, 2.92) only her HIPS covered the patch — the torso projected onto dark floor. From the
// tread-5 eye (0.55, 4.87, 3.25) the chest (z ≈ 1.9) is 51 % of the way down the ray to the floor, so the chest and
// the cut neck sit on the patch (≈ (2.15, 2.15)) only when she stands at ≈ (1.37, 3.48): by the newel.
export const G1_FROM: P3 = [1.55, 3.3, GROUND];
export const G1_TO: P3 = [1.25, 3.45, GROUND];

export const c2cUp: TimelineFactory = (ctx) => {
  const L35 = lens(35);
  const L28 = lens(28);
  const blur = ctx.motionBlur === true;
  // the whip: 650 ms with blur, 850 ms without (B8: the smear + a slower turn on tiers without the blur variant)
  const whipD = blur ? 0.65 : 0.85;
  const hallEnd = 1.65 + (whipD - 0.65);
  const h0 = -0.85;
  const hStair = 2.75;
  const ring = (eye: P3, h: number, pitch = -0.1, d = 2.2): P3 => add(eye, fwd(h, pitch, d));
  const startEye: P3 = ctx.chained ? C2_END_EYE : C2_END_EYE;
  const hallEye: P3 = [startEye[0], startEye[1], GROUND + RUN_EYE];
  const footEye: P3 = [0.8, 3.4, GROUND + RUN_EYE];
  const S = STAIR_TOP_EYE;
  const sLook = add(S.pos, fwd(S.heading, S.pitch, 3.2));
  // the climb: tread index at time t (piecewise, §2.2 pace)
  const e5 = eyeOnTread(5);
  const e12low: P3 = [ST_MAIN.x - 0.05, treadNosing(12)[1] - 0.05, treadNosing(12)[2] + 0.85];
  const topA: P3 = [0.55, 8.1, 4.1 + TOP_EYE];
  // GLITCH-FIX (C2c 9.53 → ≈ 11.6 went BLACK with the torch on and aimed: scratch/glitchfix/d2_strip.jpg): the torch
  // light rides 0.56 m ahead of the eye (diag2 lpRel), and topB stood 0.55 m from the landing's north wall (WU_U1N face
  // y = 9.0) — the light entered the wall at 9.53 and lit only its far side until the slow turn swung it out. The
  // landing is 0.92 m deep: the run now stops 0.8 m from the wall (light 0.24 m off it)
  const topB: P3 = [0.72, 8.2, 4.1 + TOP_EYE];
  const north = Math.PI / 2;
  // SMOOTH-FIX (#145, hunt F7: C2c 8.53–8.93 went black for 6 frames): at the top of the flight the eye is 0.9 m from the
  // landing's north wall (WU_U1N face y 9.0) with the run's torch 0.3 m from it and 0.16–0.43 m BELOW the eye
  // (scratch/fix/diag `tl`: the lens at y 8.66–8.69, z 5.32–5.60). A pool that close is small (the 45° cone ≈ 0.13 m
  // round at 0.3 m) and it lands that far below the gaze: looking level, the 38° frame shows the wall from z 5.44 up, so
  // each downstroke of the running arm took the whole pool out of the frame (the speckle in the dark frames is the
  // wallpaper's sparkle under the beam's own bounce light). A runner looks down at the last treads and the landing: the
  // scramble's look ends 14° down — the frame's lower half holds the pool through the arm's stroke — and the stop
  // (9.0–10.4) raises it to the landing's eye line as the breath-hold clip brings the torch up.
  const topLook = add(topA, fwd(north, -14 * DEG, 3));
  // glance #1: her silhouette rounding the newel (her root (0.85, 3.35)), seen from tread 5 back and down
  // escape fix round (lane CINE, item 5): re-blocked so she reads HEADLESS — her torso stands between the tread-5 eye and
  // the fanlight's lightning patch on the hall floor (≈ (1.9–2.4, 1.9–2.4); eye→torso ray × 1.43 lands in it), a hard
  // silhouette on the brightest thing in the frame; she walks the hall at a relentless 0.5 m/s (G1_FROM → G1_TO)
  const g1Target: P3 = [1.4, 3.38, 1.55];
  // glance #2: her right hand on the wet handrail 0.9 m away (the rail is on the east side, ≈ 0.9 m above the treads)
  const handAt: P3 = [ST_MAIN.x + 0.52, treadNosing(10.6)[1], treadNosing(10.6)[2] + 0.88];

  // SMOOTH-FRAMES (#142): a whole number of steps per bobbing shot, so the bob (sequencer.ts, 0 at τ = 0) is also 0 at
  // the shot's end and hands over to the next shot without a jump (it ended 0.3–1.75 cm / 0.6° off before)
  const steps = (hz: number, d: number) => Math.max(1, Math.round(hz * d)) / d;
  const shots: CameraShot[] = [
    // 0.0 the whip turn right, 154° through south, to the stair foot (35 mm, blur 1.0)
    {
      t: 0,
      d: whipD,
      path: [C2_END_EYE, hallEye],
      target: [C2_END_TARGET, ring(hallEye, h0 - 0.9), ring(hallEye, h0 - 1.8), ring(hallEye, hStair - 2 * Math.PI, -0.12)],
      fov: [lens(40), L35],
      ease: 'inOut',
      handheld: 0.6,
    },
    // the hall: 1.95 m in 1.0 s, bob 3 cm at 2.6 Hz
    // SMOOTH-FRAMES (#142): 'in' ran into the newel at its top speed (16 cm and 8°/frame) and the swing shot started
    // from rest — the run stopped dead in one frame at 1.65; inOut checks the run into the newel (same 5.9 m/s peak)
    { t: whipD, d: hallEnd - whipD, path: [hallEye, footEye], target: [ring(hallEye, hStair, -0.12), [0.55, 4.4, 1.9]], fov: L35, ease: 'inOut', handheld: 0.9, bob: { amp: 0.03, hz: steps(2.6, hallEnd - whipD), roll: 0.0105 } },
    // the newel: swing round it (yaw to the flight in 400 ms); the torch fist knocks the cap at 1.80
    { t: hallEnd, d: 0.45, path: [footEye, eyeOnTread(0.4)], target: [[0.55, 4.4, 1.9], add(eyeOnTread(0.4), fwd(north, 12 * DEG, 3))], fov: L35, ease: 'inOut', handheld: 0.9 },
    // risers 1–5 at 3.1 risers/s, pitch +12°
    { t: hallEnd + 0.45, d: 3.62 - (hallEnd + 0.45), path: [eyeOnTread(0.4), eyeOnTread(2.5), e5], target: [add(eyeOnTread(0.4), fwd(north, 12 * DEG, 3)), add(e5, fwd(north, 12 * DEG, 3))], fov: L35, ease: 'linear', handheld: 0.9, bob: { amp: 0.035, hz: steps(3.1, 3.62 - (hallEnd + 0.45)), roll: 0.0105 } },
    // 3.62–3.84 the head turns 150° back over the right shoulder (220 ms); the torch arm stays forward; 28 mm
    { t: 3.62, d: 0.22, path: [e5], target: [add(e5, fwd(north, 12 * DEG, 3)), add(e5, fwd(north - 1.6, -0.2, 2.2)), g1Target], fov: [L35, L28], ease: 'out', handheld: 0.6 },
    // 3.84–4.47 GLANCE #1 held 630 ms: the hard back-lit silhouette against the lightning patch on the hall floor
    { t: 3.84, d: 0.63, path: [e5, add(e5, [0, 0.03, 0.01])], target: [g1Target], fov: L28, ease: 'linear', handheld: 0.5 },
    // 4.47–4.69 turn forward
    // GLITCH-FIX (C2c 4.6, detect.py's top LOCAL POP f1006): the two-point target path cut the chord 1.1 m from the eye
    // — 83° in ONE frame; now a sphere sweep back the way the head went (counter-clockwise), same 220 ms
    { t: 4.47, d: 0.22, path: [add(e5, [0, 0.03, 0.01]), eyeOnTread(5.4)], target: sweepTargets(e5, g1Target, add(eyeOnTread(5.4), fwd(north, 10 * DEG, 3)), turnBetween(e5, g1Target, add(eyeOnTread(5.4), fwd(north, 10 * DEG, 3)), 1), 4), fov: [L28, L35], ease: 'inOut', handheld: 0.6 },
    // risers 6–12, pitch +10°, breath ragged
    { t: 4.69, d: 1.77, path: [eyeOnTread(5.4), eyeOnTread(8.5), eyeOnTread(11.6)], target: [add(eyeOnTread(5.4), fwd(north, 10 * DEG, 3)), add(eyeOnTread(11.6), fwd(north, 10 * DEG, 3))], fov: L35, ease: 'linear', handheld: 1.0, bob: { amp: 0.035, hz: steps(3.1, 1.77), roll: 0.0105 } },
    // 6.46 THE STUMBLE on the creaker 12: pitch −28° in 150 ms, roll −6°, the eye drops to ≈ 0.85 m above tread 12
    { t: 6.46, d: 0.16, path: [eyeOnTread(11.6), e12low], target: [add(eyeOnTread(11.6), fwd(north, 10 * DEG, 3)), add(e12low, fwd(north, -28 * DEG, 1.2))], fov: L35, ease: 'in', handheld: 1.2, roll: [0, -6 * DEG] },
    // gloves slap tread 13 (6.62); the beam swings wild
    // GLITCH-FIX (C2c 6.73–6.87, f1070–1074): the wild swing's targets sat 1.0–1.2 m off the eye and the path passed
    // 0.65 m from it — 29° and 74° in single frames, then a 26° jump onto glance #2 at 6.85. Same beat, same 230 ms:
    // a jerk left with the fall (≈ 28°), then round to the right onto her hand, ending exactly on glance #2's aim.
    { t: 6.62, d: 0.23, path: [e12low], target: [add(e12low, fwd(north, -28 * DEG, 2)), ...sweepTargets(e12low, add(e12low, fwd(north + 0.5, -35 * DEG, 2)), handAt, turnBetween(e12low, add(e12low, fwd(north + 0.5, -35 * DEG, 2)), handAt, -1), 4)], fov: L35, ease: 'inOut', handheld: 1.4, roll: [-6 * DEG, -3 * DEG] },
    // 6.85–7.45 GLANCE #2 held 600 ms: her hand on the wet handrail, 0.9 m away; her feet a dark shape at tread 9
    { t: 6.85, d: 0.6, path: [e12low], target: [handAt, add(handAt, [0, 0.04, 0.01])], fov: L35, ease: 'linear', handheld: 0.5, roll: -3 * DEG },
    // 7.45–7.66 back round to the flight
    // GLITCH-FIX (C2c 7.53–7.57, f1094): the path from her hand (0.72 m away) to the flight passed 0.47 m from the eye —
    // 47° and 60° in single frames; now a sphere sweep back (counter-clockwise), same 210 ms
    // SMOOTH-FRAMES (#142): starts from where glance #2's drift ENDS (handAt + 4 cm) — it started from handAt: 2.3° jump
    { t: 7.45, d: 0.21, path: [e12low, add(e12low, [0, 0.12, 0.1])], target: sweepTargets(e12low, add(handAt, [0, 0.04, 0.01]), add(e12low, fwd(north, 20 * DEG, 2)), turnBetween(e12low, add(handAt, [0, 0.04, 0.01]), add(e12low, fwd(north, 20 * DEG, 2)), 1), 4), fov: L35, ease: 'inOut', handheld: 1.2, roll: [-3 * DEG, 0] },
    // 7.66–9.0 scramble up 13–16 (4 risers in 1.34 s), pitch +20°
    { t: 7.66, d: 1.34, path: [add(e12low, [0, 0.12, 0.1]), eyeOnTread(14, 1.3), eyeOnTread(16, 1.6, 0.05), topA], target: [add(e12low, fwd(north, 20 * DEG, 2)), topLook], fov: L35, ease: 'out', handheld: 1.4, bob: { amp: 0.04, hz: steps(3.0, 1.34), roll: 0.012 } },
    // 9.0–10.4 the top: onto the landing; the run stops; breath heaving
    // (SMOOTH-FIX #145: inOut — the scramble's 'out' ends at rest, an 'out' here restarted the eye and the look at full
    // speed in one frame)
    { t: 9.0, d: 1.4, path: [topA, topB], target: [topLook, add(topB, fwd(north, -0.05, 3))], fov: L35, ease: 'inOut', handheld: 0.7, bob: { amp: 0.008, hz: steps(0.5, 1.4) } },
    // 10.4–12.4 the slow turn right (south) 180° in 2.0 s, slow at first (dread), pitch down to −50°
    {
      t: C2C_SKIP_AT,
      d: 2.0,
      path: [topB, S.pos],
      target: [add(topB, fwd(north, -0.05, 3)), add(topB, fwd(north - 0.5, -0.12, 3)), add(S.pos, fwd(0, -0.45, 3)), add(S.pos, fwd(-1.2, -0.75, 3.2)), sLook],
      fov: L35,
      // SMOOTH-FRAMES (#142, GLITCH residual 2): 'in' ended the turn at its full speed (≈ 9°/frame) into the 12.4 hold —
      // the view stopped dead; inOut keeps the slow start and settles onto the empty stair
      ease: 'inOut',
      handheld: 0.5,
    },
    // 12.4–13.9 the empty stair: hold (breath held); 12.9 an involuntary 4 cm lean over the rail; the FOV eases to the
    // gameplay FOV inside the last 600 ms so control returns on this exact camera (no snap)
    { t: 12.4, d: 0.5, path: [S.pos], target: [sLook], fov: L35, handheld: 0.4 },
    // SMOOTH-FRAMES (#142): the lean and the FOV's return to the gameplay lens share ONE second (was the last 0.5 s for
    // the lens: 37.8 → 70° peaked at ≈ 6°/frame at 30 fps, a zoom lurch at the hand-back)
    { t: 12.9, d: 1.0, path: [S.pos, add(S.pos, [0, -0.04, -0.01]), S.pos], target: [sLook, add(sLook, [0, -0.04, -0.01]), sLook], fov: [L35, ctx.player.fov ?? 60], ease: 'inOut', handheld: 0.4 },
  ];

  // Ada's root keys (§4.1, C2c time)
  const t1 = adaOnTread(1);
  const t4 = adaOnTread(4);
  const t9 = adaOnTread(9);
  const t10 = adaOnTread(10);
  const t11 = adaOnTread(ADA_LAST_TREAD);
  const newel: P3 = [1.05, 3.45, GROUND];
  const moves: MoveTrack[] = [
    // the hall at 0.5 m/s (a walk, never a run): through the lightning patch's sight line during glance #1
    { char: 'ada', t: 0, d: 3.84, path: [C2_ADA_END, [2.3, 2.7, GROUND], G1_FROM], ease: 'linear', heading: 'path' },
    { char: 'ada', t: 3.84, d: 0.63, path: [G1_FROM, G1_TO], ease: 'linear', heading: 'path', turnIn: 0.25 }, // GLITCH-FIX: was a 12° yaw snap in glance #1
    // rounding the newel unseen (the camera is back on the flight), the right hand on its cap
    { char: 'ada', t: 4.47, d: 0.83, path: [G1_TO, [0.92, 3.45, GROUND], add(newel, [-0.25, 0.25, 0]), t1], ease: 'linear', heading: [headingTo([2.3, 2.7, 0], [0.85, 3.35, 0]), Math.PI / 2] },
    { char: 'ada', t: 5.3, d: 1.16, path: [t1, t4], ease: 'linear', heading: Math.PI / 2 },
    // the unseen catch-up: the camera is in the treads
    { char: 'ada', t: 6.46, d: 0.39, path: [t4, t9], ease: 'linear', heading: Math.PI / 2 },
    { char: 'ada', t: 6.85, d: 0.6, path: [t9, add(t9, [0, 0.06, 0])], ease: 'linear', heading: Math.PI / 2 },
    { char: 'ada', t: 7.45, d: 0.95, path: [add(t9, [0, 0.06, 0]), t10], ease: 'linear', heading: Math.PI / 2 },
    { char: 'ada', t: 8.4, d: 0.5, path: [t10, t11], ease: 'out', heading: Math.PI / 2 },
  ];

  const room = 'G1';
  const cues: Cue[] = [
    { t: 0, type: 'mark', name: 'c2c:start' },
    { t: 0, type: 'lock', mode: 'full' },
    { t: 0, type: 'light', op: 'storm_auto', on: false },
    { t: 0, type: 'light', op: 'flashlight', on: true, tremble: 0.6 },
    { t: 0.02, type: 'sfx', id: 'flashlight_click', gain: 0.6 },
    { t: 0, type: 'fx', id: 'shadowLight', params: { at: 'off' } },
    // fix round 3 (ruling m): the same film camera as C2 (ISO 3200, f/2, 1/48 s) for the whole climb — C2C_CAMERA_E;
    // the eye adapts again only after the handover (release → reset, from this value: no pop)
    { t: 0, type: 'fx', id: 'exposure', params: { fixed: C2C_CAMERA_E } },
    { t: 0, type: 'fx', id: 'blurAmount', params: { v: blur ? 1 : 0 } },
    { t: whipD, type: 'fx', id: 'blurAmount', params: { v: 0 } },
    // GLITCH-FIX: the four authored head whips (≈ 120–150° in 210–230 ms: the look back 3.62, the turn forward 4.47,
    // the stumble swing 6.62, back round 7.45) get the same 180° shutter smear as the first whip where it exists (Max)
    ...[[3.62, 3.84], [4.47, 4.69], [6.62, 6.85], [7.45, 7.66]].flatMap(([a, b]): Cue[] => [
      { t: a, type: 'fx', id: 'blurAmount', params: { v: blur ? 1 : 0 } },
      { t: b, type: 'fx', id: 'blurAmount', params: { v: 0 } },
    ]),
    { t: 0, type: 'fx', id: 'blood', params: { seq: 'c2c', phase: 'start' } },
    { t: 0, type: 'heartbeat', bpm: 150 },
    { t: 0, type: 'score', state: 'chase' },
    { t: 0, type: 'clip', char: 'arms', clip: 'arms_run_torch', loop: true, fade: 0.1, fallback: ['arms_idle'] },
    { t: 0, type: 'visible', char: 'ada', visible: true },
    { t: 0, type: 'clip', char: 'ada', clip: 'ada_chase_headless', loop: true, fade: 0.1, fallback: ['ada_chase', 'ada_patrol'] },
    { t: 0, type: 'loop', key: 'stump', id: 'stump_breath', gain: 0.8 },
    { t: 0.05, type: 'sfx', id: 'step_bare', pos: [2.3, 2.75, 0.6], room, gain: 1 },
    { t: 0.1, type: 'sfx', id: 'breath_strained', gain: 0.8 },
    { t: 0.6, type: 'loop', key: 'panting', id: 'panting', gain: 0.75 },
    { t: hallEnd - 0.05 + 0.15, type: 'sfx', id: 'newel_knock', pos: [1.05, 3.5, 1.6], room, gain: 0.9 },
    // the stair: Ada climbs with her right hand on the rail
    // (fix round: kept at 4.5 — the 1.333 s loop's phase at glance #2 (7.1) puts her right hand ON the rail; she is unseen
    // 4.47–5.3, so the climb cycle on the last flat metre never shows)
    { t: 4.5, type: 'clip', char: 'ada', clip: 'ada_climb_headless', loop: true, fade: 0.15, fallback: ['ada_stairs_up', 'ada_chase'] },
    // 3.62–4.47 the head turns back but the torch arm stays forward (§2.2): the beam keeps lighting the flight ahead,
    // not her (the rig holds its world orientation while the camera turns)
    // (r4/r5: an off/on toggle left the level unlit by the torch afterwards — the arm is held instead)
    // review: arms_run_torch's beam bone points off the flight (black climb) — hold the beam within 12° of the gaze
    // SMOOTH-FIX (#145b, re-verify F7 + N1): aimed AT the gaze point, not parallel to the gaze (bindings.ts `gaze`): the
    // run / stumble / breath clips carry the torch 0.25–0.7 m under the eye, and a parallel beam put its pool under the
    // frame wherever the eye was within ≈ 1.5 m of a surface (6.63–6.8 the stumble whip, 8.53–8.93 and 10.73–11.03 at the
    // landing wall: black frames). Glance #1 keeps the torch on the flight (torchHold: the held rig's forward).
    { t: 0, type: 'fx', id: 'beamClamp', params: { on: true, gaze: 1 } },
    { t: 3.6, type: 'fx', id: 'torchHold', params: { on: true } },
    // fix round (item 5): glance #1 — the lightning patch on the hall floor is the brightest thing in frame; the eye
    // stops down for it (cap 1.0, was ≈ 2.2) so her front falls to silhouette and the near balusters stop glowing
    // (fix round 3: the fixed camera already sits below that cap — 0.458 < 1.0; the stroke over-exposes it briefly)
    { t: 4.6, type: 'fx', id: 'torchHold', params: { on: false } },
    // 3.62 the fanlight stroke behind her — the reason to look back (the roaming shadow light)
    { t: FANLIGHT_STROKE.t, type: 'fx', id: 'shadowLight', params: { at: 'fanlight', pulses: FANLIGHT_STROKE.pulses } },
    { t: 3.88, type: 'sfx', id: 'score_hit', sched: true, gain: 0.9 },
    { t: 3.95, type: 'sfx', id: 'handrail_squeak', pos: [1.05, 3.5, 1.5], room, gain: 0.7 },
    { t: 4.5, type: 'fx', id: 'shadowLight', params: { at: 'off' } },
    { t: 4.55, type: 'sfx', id: 'gasp', gain: 0.5 },
    // 6.46 the stumble on the creaker 12
    { t: 6.46, type: 'sfx', id: 'step_creaker', pos: treadNosing(12), room, gain: 1.2 },
    // FINAL #153c (the C2c 6.733 one-frame dark dip, BLACK on Low; STATUS-flash fixer r3 item 2): the catch clip starts
    // 40 ms after the creak (was 6.46, with it). At clip 0.273 s the fist with the torch is jammed in the corner of
    // tread 13 and riser 14 — the lens 7 cm in front of the riser, below its nosing (plan (0.42, 7.17, 3.60); the
    // render treads per blender/house/plan.py StairGeo) — so nothing above the nosing can be lit from it, and at 6.733 the
    // camera's whip was passing straight up the flight: every surface in frame was hidden from the lens (pre-exposure
    // HDR 13.3 → 0.02 → 10.5; the aim was on the gaze hit, the light on). Now that pose meets the whip at 6.773, past
    // north, looking east over tread 13 at the rail, which the lens does see; 6.733 shows the 6.69 pose (lens 0.26 m
    // above the tread). The slap still lands with the 6.62 impact / 6.64 knock (≤ 40 ms, under the A/V lead threshold).
    { t: 6.5, type: 'clip', char: 'arms', clip: 'arms_stumble_catch', fade: 0.05, fallback: ['arms_idle'] },
    { t: 6.62, type: 'sfx', id: 'body_fall_stairs', pos: treadNosing(13), room, sched: true },
    // fix round 4 (audio lane, ruling x; contract #132): measured in the real mix (scratch/listen) this stumble was the
    // LOUDEST moment of the escape (−11.1 LUFS momentary vs the strike's −13.7) — the knock 0.8 → 0.5, the gasp
    // 0.9 → 0.45 (below the strike's own 0.8 gasp: it is a caught stumble, not the beheading)
    { t: 6.64, type: 'sfx', id: 'torch_knock', pos: treadNosing(13), room, gain: 0.5 },
    { t: 6.66, type: 'sfx', id: 'gasp', gain: 0.45 },
    { t: 6.85, type: 'sfx', id: 'handrail_squeak', pos: handAt, room, gain: 1 },
    // fix round (item 6): glance #2 — the torch's hot centre on her hand 0.9 m away, its spill on the stair wall 0.4 m
    // away (≈ 15 klx) clipped at the climb's exposure 1.8 → capped at 0.55 for the glance (the pupil constricts), the
    // highlight protect on; the climb's auto exposure comes back after it
    // (fix round 3: the fixed camera 0.458 is below the old 0.55 glance cap — no cue)
    // (s8med at the real 0.25 exposure: the hot spot sat on the wall upper-left, her hand dark) — the torch on her hand
    // SMOOTH-FIX (#145b): the gaze aim at her hand's distance (the camera looks at handAt; the static sight ray goes past
    // her hand to the wall) — eased from the swing's aim, no jump at 6.85; back to the gaze's own hit for the turn back
    // to the flight at 7.45 (with the aim left on her hand, the turn took the pool out of the frame: 7.567–7.633 black)
    // (#145b, N1: a fixed aim along the flight for the stumble (tread 14's middle, 0.5 m from the lens) was tried — b1:
    // the 6.6–6.73 white-out was unchanged (luma 0.52 vs 0.50 with the gaze aim): the light there is not the core's spot.
    // See docs/STATUS-smooth-fix.md "ROUND 2" N1.)
    { t: 6.85, type: 'fx', id: 'beamClamp', params: { on: true, gaze: 1, d: Math.round(Math.hypot(handAt[0] - e12low[0], handAt[1] - e12low[1], handAt[2] - e12low[2]) * 1000) / 1000 } },
    { t: 7.45, type: 'fx', id: 'beamClamp', params: { on: true, gaze: 1 } },
    { t: 7.66, type: 'clip', char: 'arms', clip: 'arms_run_torch', loop: true, fade: 0.1, fallback: ['arms_idle'] },
    // the top (9.0): her steps stopped with his; breath held 9.6; one drop below (10.0); heartbeat 120
    { t: 9.0, type: 'loop', key: 'panting', id: null, fade: 0.4 },
    // the run stops: the arms settle (breath heaving) — the held torch comes back up to the eye line
    // (SMOOTH-FIX #145 moved this to 8.4 to lift the torch for 8.53–8.93; that put the clip's lowering beat (clip ≈ 2.4 s)
    // at 10.8, under the eye's tilt up — 5 black frames at 10.73–11.03 (re-verify F7). #145b: back at the authored stop;
    // the pool stays in frame through both beats by the gaze aim above.)
    { t: 9.0, type: 'clip', char: 'arms', clip: 'arms_breath_hold', fade: 0.5, fallback: ['arms_idle'] },
    { t: 9.0, type: 'loop', key: 'stump', id: null, fade: 0.2 },
    { t: 9.1, type: 'heartbeat', bpm: 120 },
    { t: 9.6, type: 'sfx', id: 'breath_hold', gain: 0.7 },
    // 10.4: the camera faces north, away from the flight — she is gone (no sound, no prints, no motion on screen)
    { t: C2C_SKIP_AT, type: 'visible', char: 'ada', visible: false },
    { t: C2C_SKIP_AT, type: 'place', char: 'ada', pos: NODE.G_PARLOR_LURE, heading: 0 },
    // 12.9 the cold stroke through the U1 south window at the far end of the gallery
    { t: WINDOW_STROKE.t, type: 'fx', id: 'shadowLight', params: { at: 'u1_window', pulses: WINDOW_STROKE.pulses } },
    { t: 13.6, type: 'fx', id: 'shadowLight', params: { at: 'off' } },
    // 13.9 handover: control on the exact last camera
    { t: C2C_DURATION, type: 'fx', id: 'blood', params: { seq: 'c2c', phase: 'end' } },
    // §2.4: from B05 the shadow light is back at the lamp (behind the shut, locked parlor door: shadowed, no leak)
    { t: C2C_DURATION, type: 'fx', id: 'shadowLight', params: { at: 'lamp' } },
    { t: C2C_DURATION, type: 'clip', char: 'arms', clip: 'arms_idle', loop: true },
    { t: C2C_DURATION, type: 'release', char: 'arms' },
    { t: C2C_DURATION, type: 'player', pos: S.pos, heading: S.heading, pitch: S.pitch },
  ];
  // her heel slaps: 1.9 Hz on the flat, 1.5 Hz on the treads, stopping with the player's at 8.9
  // (fix round: a 0.5 m/s walk = 1.4 Hz heel slaps in the hall until the newel at 5.3)
  for (let t = 0.2; t < 5.2; t += 1 / 1.4) cues.push({ t: Math.round(t * 1000) / 1000, type: 'sfx', id: 'bare_feet_wet', pos: t < 2.76 ? [2.8, 2.2, 0.6] : [1.5, 3.3, 0.6], room, gain: 0.8 });
  for (const t of [5.35, 5.75, 6.15, 6.55, 7.2, 8.4, 8.9]) cues.push({ t, type: 'sfx', id: 'bare_feet_wet', pos: adaOnTread(Math.min(11, 1 + (t - 5.3) * 2.6)), room, gain: 0.9 });
  // the player's boots: the hall (2.6 Hz), the treads (3.1 risers/s; the creak on riser 5 at 3.45)
  // SMOOTH-FRAMES (#142): on the hall bob's own foot plants ((k + ¼)/hz, sequencer.ts) — 3 steps in the 1 s run
  for (let k = 0, hz = steps(2.6, hallEnd - whipD); k < Math.round(hz * (hallEnd - whipD)); k++) cues.push({ t: Math.round((whipD + (k + 0.25) / hz) * 1000) / 1000, type: 'sfx', id: 'step_bare', pos: [1.6, 3.0, 0.6], room, gain: 1 });
  for (let k = 1; k <= 16; k++) {
    const t = k <= 5 ? hallEnd + 0.45 + (k - 0.6) / 3.1 : k <= 11 ? 4.69 + (k - 5.4) / 3.7 : k === 12 ? -1 : 7.66 + (k - 12.4) * 0.335;
    if (t < 0 || t > 9.0) continue;
    cues.push({ t: Math.round(t * 1000) / 1000, type: 'sfx', id: k === 5 ? 'step_creaker' : 'step_stair', pos: treadNosing(k), room, gain: 1 });
  }
  // the drip from tread 11's nosing onto tread 10, every 0.6 s, from 10.0
  for (let t = 10.0; t < C2C_DURATION; t += 0.6) cues.push({ t: Math.round(t * 1000) / 1000, type: 'sfx', id: 'blood_drip', pos: treadNosing(10.5), room, gain: 0.5 });

  const tl: Timeline = {
    id: 'C2c',
    duration: C2C_DURATION,
    lock: 'full',
    letterbox: [
      { t: 0, v: 1 },
      { t: 13.6, v: 1 },
      { t: 13.9, v: 0 },
    ],
    shots,
    moves,
    kicks: [{ t: 6.62, d: 0.12, pitch: -0.02, roll: 0.01 }],
    cues,
  };
  return tl;
};
