// C4c 'She Remembers' (CUTSCENES-PLAN §3, M-A, 11 s, B11): the authored FINALE take. The locket sharp in the beam,
// her face a soft blur behind it; 0.4 s memory flash-frames as her fingers close; one tender, terrible line before
// C5's violence. The brain is frozen at 'take' and resumes at 'carry' from c4cCarryEnd (src/story/director.ts); the
// hand-off itself (locket_given, the item removed, the nonstop bell stopped) lands at the cutscene's end (beats.ts).
//
//   0–2.5    POV, the lit locket at 0.42 m (DOF band 5 cm), fov 30 → 26°: behind it her lifted head is a blur of wet
//            hair and one pale eye shape (ada_look held). Every sound but the drip drops away.
//   2.5–3.3  memory, warm (grade cue): the hem of the dress on its form (U3), the spring bell (G2) — 0.4 s each.
//            Re-staged on the props as they stand (ruling af: no 1976 dressing until M-B/M-E — F1's needle and C3b's
//            bell-run are not built yet); the torch on the camera lights each like a memory.
//   3.3–5.5  POV 76 mm on the locket: her grey left hand enters the beam (ada_finale_take at 0.5×; the reach lands at
//            clip 0.45 s = 4.3 s) and closes over it; the locket moves to her prop_l, the glove is empty.
//   5.5–6.3  memory, cold: the cistern hatch (G3), wide then close.
//   6.3–9    POV 26°, focus on her fist at her breastbone; she whispers at 7.2 (c4c:there); a drop from her hair.
//   9–11     locked off: she turns to the parlor door and takes one step (c4cCarryEnd). Release.
// Faces-hidden audit: her face is only ever behind the in-focus locket (out of focus, hair over it); on Low (no DOF)
// the beam's glare on the locket and the 26–30° crop keep her at hair and eye shape. Flash-frames hold no figure.

import { sweepTargets, turnBetween } from './math.ts';
import { add, dist, fwd, headingTo, lens } from './stage.ts';
import { c4cCarryEnd } from './c4c-step.ts';
import type { CameraShot, Cue, GradeSpec, P3, TimelineFactory } from './types.ts';

export const C4C_DURATION = 11;
/** The reach of ada_finale_take lands at clip 0.45 s; at 0.5× from 3.4 s that is 4.3 s. */
export const C4C_TAKE_AT = 4.3;
/** The C4c film camera's fixed exposure (derivation at its cue). */
export const C4C_CAMERA_E = 0.2;

/**
 * SMOOTH-FIX (#145, F2b follow-up): each 0.4 s memory flash-frame is its own set-up, exposed for its subject. Since the
 * 17:00 exposure fix (ROADMAP ar: exposure now scales RGB before AgX, not after it), the take's 0.2 put the beam-lit
 * memories deep in AgX's shoulder: scratch/fix/after1 C4c luma 0.29 (hem) / 0.35 (bell) / 0.47 / 0.67 (hatch, flat
 * white) against the take's 0.10. The scene's own mean radiance under the torch at each camera (scratch/fix/diag `hl`,
 * Medium: hem 4.7 at 1.2 m, bell 11 at 0.7 m, hatch wide 12.7, hatch close 56 at 0.4 m from the boards) metered so
 * that e·L̄ ≈ 0.15 (just under AgX's mid-grey 0.18 — the memory grade's vignette and grain sit on top): bright, bleached,
 * still with the hem's satin, the bell's brass and the boards' grain in them.
 */
export const C4C_MEMORY_E = { hem: 0.032, bell: 0.014, hatchWide: 0.012, hatchClose: 0.0027 } as const;

/** CUTSCENES-PLAN §5 memory looks: saturation 0.55–0.6, warm (1.06, 0.97, 0.86) / cold (0.86, 0.95, 1.05), grain ×1.6. */
export const MEMORY_WARM: GradeSpec = { tint: [1.06, 0.97, 0.86], saturation: 0.6, grain: 1.6, vignette: 1.5 };
export const MEMORY_COLD: GradeSpec = { tint: [0.86, 0.95, 1.05], saturation: 0.55, grain: 1.6, vignette: 1.5 };

/** Flash-frame cameras (PLAN, inside U3 / G2 / G3 — eye, target, fov). */
// r2: at 0.65 m the hem camera sat INSIDE the gown's flare (black frame); r3: 85 mm on the satin was a featureless blur —
// 50 mm, 1.2 m out, low on the hem's edge where it meets the boards
const HEM = { eye: [6.6, 6.6, 4.55] as P3, target: [7.55, 7.0, 4.15] as P3 };
const BELL = { eye: [4.55, 1.2, 3.32] as P3, target: [3.88, 1.45, 3.4] as P3 };
const HATCH_WIDE = { eye: [4.85, 7.55, 1.3] as P3, target: [5.5, 8.2, 0.62] as P3 };
const HATCH_CLOSE = { eye: [5.85, 7.85, 0.98] as P3, target: [5.52, 8.2, 0.61] as P3 };

const fovOf = (mm: number) => Math.round(lens(mm) * 10) / 10;

export const c4cRemembers: TimelineFactory = (ctx) => {
  const eye = ctx.player.eye;
  const noDof = ctx.tier === 'low';
  // her root (the brain froze her at arm's length); a debug start without her stages her 0.9 m ahead
  const ada = ctx.ada ?? { pos: add([eye[0], eye[1], eye[2] - 1.65], fwd(ctx.player.heading, 0, 0.9)), heading: ctx.player.heading + Math.PI };
  const toPlayer = headingTo(ada.pos, eye);
  // the lifted head: 0.25 m ahead of the stump at 1.5 m (TUNING.sight eyeHeight / headAheadM)
  const herEye = add(ada.pos, add(fwd(toPlayer, 0, 0.25), [0, 0, 1.5]));
  const herFist = add(ada.pos, add(fwd(toPlayer, 0, 0.18), [0, 0, 1.25]));
  // r5: framed at her (absent) eye line, every POV showed the neck stump square-on as a flat red disc — she is headless
  // since C2; the POV frames her hands and chest below it (the stump stays above the letterbox)
  const herChest = add(ada.pos, add(fwd(toPlayer, 0, 0.2), [0, 0, 1.18]));
  const locketD = 0.42;
  // the lit locket in the glove (arms_locket_hold): 0.42 m out along the line to her, a hand-width below the eye line
  const locketAt = add(eye, add(fwd(headingTo(eye, ada.pos), 0, locketD), [0, 0, -0.12]));
  const aim = (t: number, p: P3): Cue => ({ t, type: 'fx', id: 'beamClamp', params: { on: true, atX: p[0], atY: p[1], atZ: p[2] } });
  const arms = (t: number, visible: boolean): Cue => ({ t, type: 'visible', char: 'arms', visible });
  const end = c4cCarryEnd(ada.pos);
  const dof = (focusDistance: number, focalLength: number, bokehScale = 3) => ({ focusDistance, focalLength, bokehScale });
  const pov = (t: number, d: number, target: P3, fov: number | [number, number], handheld = 0.25): CameraShot => ({ t, d, path: [eye], target: [target], fov, handheld });
  const flashShot = (t: number, s: { eye: P3; target: P3 }, mm: number): CameraShot => ({ t, d: 0.4, path: [s.eye], target: [s.target], fov: fovOf(mm), handheld: 0.15 });

  // SMOOTH-FRAMES (#142): the take eases in from the player's own view (1 s push-in) and back out to it. It cut in on the same eye
  // (the gaze snapped onto her chest and the lens jumped from the gameplay 60° to 30° on the first frame) and handed
  // back from the 26° close-up to the start look at 60° in one frame (no player cue), the DOF snapping off with it.
  const pf = ctx.player.fov ?? 60;
  const look0 = add(eye, fwd(ctx.player.heading, ctx.player.pitch, dist(eye, herChest)));
  const endChest = add(end.pos, [0, 0, 1.2]);
  const IN = 1.0; // a 1 s push-in (the lens 60–70° → 30° peaks at ≈ 4°/frame at 30 fps)
  const OUT_T = 9.8; // a 1.2 s pull-back (26° → the 60–70° gameplay lens peaks ≈ 3.7°/frame at 30 fps)
  const shots: CameraShot[] = [
    { t: 0, d: IN, path: [eye], target: sweepTargets(eye, look0, herChest, turnBetween(eye, look0, herChest), 3), fov: [pf, 30], ease: 'inOut', handheld: 0.25 },
    pov(IN, 2.5 - IN, herChest, [30, 26]),
    flashShot(2.5, HEM, 50),
    flashShot(2.9, BELL, 85),
    // r4: a 76 mm frame at eye level looked over her shoulders (she is headless) into the dark room — 50 mm, down on
    // the locket and her hands
    pov(3.3, 2.2, add(locketAt, [0, 0, -0.3]), fovOf(50), 0.2),
    flashShot(5.5, HATCH_WIDE, 50),
    flashShot(5.9, HATCH_CLOSE, 85),
    pov(6.3, 2.7, herFist, 26, 0.2),
    pov(9, OUT_T - 9, herFist, 26, 0),
    { t: OUT_T, d: C4C_DURATION - OUT_T, path: [eye], target: sweepTargets(eye, herFist, endChest, turnBetween(eye, herFist, endChest), 3), fov: [26, pf], ease: 'inOut', handheld: 0 },
  ];
  /** The DOF eased in / out by its bokeh, one step per 30 fps frame (uniforms only: the cutscene chain stays) — no
   *  one-frame blur snap. */
  const bokehRamp = (t0: number, d: number, base: { focusDistance: number; focalLength: number; bokehScale: number }, from: number, to: number, n = Math.max(1, Math.round(d * 30))): Cue[] =>
    Array.from({ length: n + 1 }, (_, i) => ({ t: Math.round((t0 + (d * i) / n) * 1000) / 1000, type: 'dof' as const, dof: { ...base, bokehScale: from + ((to - from) * i) / n } }));

  const cues: Cue[] = [
    { t: 0, type: 'lock', mode: 'full' },
    { t: 0, type: 'light', op: 'storm_auto', on: false },
    { t: 0, type: 'fx', id: 'locket_in_hand', params: { on: true } },
    // a film camera, not an eye (as C2): one fixed exposure for the whole take so the 0.4 s flash-frames never pump the
    // meter (r1: the hem frame black, the bell frame blown). Calibrated on the game's own torch-adapted eye (C4a r2: 0.094
    // at the boards 0.75 m away, 0.16 in the doorway): 0.12, so the locket in the beam rides AgX's shoulder, her gown in
    // the spill reads, the room falls to black (r2's physical ISO 800 f/4 guess, 0.03, rendered it near-black; r3's 0.12
    // still hid her behind the locket — 0.3, about the eye's own reading in r1). AD review M-A: 0.3 clipped the
    // beam-lit gown/torso to flat white at 0.85 m (≈ 3.5 klx from a 2–3 kcd torch) on Medium and Max; same-frame A/B
    // 0.3 / 0.18 / 0.12 → 0.2 keeps the gown's tones and the hand + locket glint, the room still falls to black)
    { t: 0, type: 'fx', id: 'exposure', params: { fixed: C4C_CAMERA_E } },
    // the torch held on the locket / just past it (a hand points the beam where it looks)
    aim(0, add(locketAt, fwd(headingTo(eye, ada.pos), 0, 0.25))),
    { t: 0, type: 'place', char: 'ada', pos: ada.pos, heading: toPlayer },
    { t: 0, type: 'clip', char: 'ada', clip: 'ada_look', at: 1.2, speed: 0, fade: 0.2 },
    { t: 0, type: 'heartbeat', bpm: 0 },
    { t: 0.4, type: 'sfx', id: 'ada_drip', pos: herEye, gain: 0.5 },
    ...(noDof ? [] : bokehRamp(0, IN, dof(locketD, 0.05), 0, 3)),
    // memory, warm: the hem, the bell
    { t: 2.5, type: 'grade', grade: MEMORY_WARM },
    // SMOOTH-FIX (#145): each flash-frame exposed for itself (C4C_MEMORY_E), back to the take's camera on the cut out
    { t: 2.5, type: 'fx', id: 'exposure', params: { fixed: C4C_MEMORY_E.hem } },
    { t: 2.9, type: 'fx', id: 'exposure', params: { fixed: C4C_MEMORY_E.bell } },
    { t: 3.3, type: 'fx', id: 'exposure', params: { fixed: C4C_CAMERA_E } },
    arms(2.5, false),
    aim(2.5, HEM.target),
    aim(2.9, BELL.target),
    ...(noDof ? [] : ([{ t: 2.5, type: 'dof', dof: dof(dist(HEM.eye, HEM.target), 0.35) }, { t: 2.9, type: 'dof', dof: dof(dist(BELL.eye, BELL.target), 0.1) }] as Cue[])),
    { t: 2.95, type: 'sfx', id: 'spring_bell', pos: BELL.target, room: 'G2', gain: 0.5 },
    { t: 3.3, type: 'grade', grade: null },
    arms(3.3, true),
    // SMOOTH-FIX (#145): the beam lands in THIS shot's frame (its target, under the locket) — aimed at locketAt it passed
    // over the glove and lit her out of frame above: 3.33–3.87 rendered pure black (luma 0.0000, scene radiance 0.004,
    // scratch/fix/after2 C4c f129–f145) after the memory flash, until her hand entered the beam at the top
    aim(3.3, add(locketAt, [0, 0, -0.3])),
    // the take: her hand enters the beam and closes over the locket
    ...(noDof ? [] : ([{ t: 3.3, type: 'dof', dof: dof(locketD, 0.05) }] as Cue[])),
    // SMOOTH-FIX (#145b, re-verify N2): ada_finale_take's first frame is a different pose from ada_look's held 1.2 s
    // frame (her left arm hangs instead of being raised, the right arm and the head she carries hang lower): cross-faded
    // in 0.15 s on screen at 3.4, it read as one pose pop (3.4 → 3.433: FLICK 64, POP 52–62 to 3.57, no camera move).
    // The take's first frame is now cross-faded in UNSEEN, under the memory flash-frames (2.5–3.3: other rooms), held
    // (speed 0, as C7 holds ada_sting's), and the same clip runs on from it at 3.4 (bank.ts keeps a re-cued clip's time) —
    // the reach still lands at clip 0.45 s = C4C_TAKE_AT.
    { t: 2.55, type: 'clip', char: 'ada', clip: 'ada_finale_take', speed: 0, fade: 0.4 },
    { t: 3.4, type: 'clip', char: 'ada', clip: 'ada_finale_take', speed: 0.5, fade: 0.15 },
    { t: C4C_TAKE_AT, type: 'sfx', id: 'locket_click', pos: add(eye, fwd(ctx.player.heading, 0, locketD)), gain: 0.7 },
    { t: C4C_TAKE_AT, type: 'attach', char: 'ada', prop: 'locket', bone: 'prop_l' },
    { t: C4C_TAKE_AT, type: 'fx', id: 'locket_in_hand', params: { on: false } },
    aim(C4C_TAKE_AT, herFist), // the torch follows her closed hand
    // memory, cold: the hatch
    { t: 5.5, type: 'grade', grade: MEMORY_COLD },
    { t: 5.5, type: 'fx', id: 'exposure', params: { fixed: C4C_MEMORY_E.hatchWide } },
    { t: 5.9, type: 'fx', id: 'exposure', params: { fixed: C4C_MEMORY_E.hatchClose } },
    { t: 6.3, type: 'fx', id: 'exposure', params: { fixed: C4C_CAMERA_E } },
    arms(5.5, false),
    aim(5.5, HATCH_WIDE.target),
    aim(5.9, HATCH_CLOSE.target),
    ...(noDof ? [] : ([{ t: 5.5, type: 'dof', dof: dof(dist(HATCH_WIDE.eye, HATCH_WIDE.target), 0.3) }, { t: 5.9, type: 'dof', dof: dof(dist(HATCH_CLOSE.eye, HATCH_CLOSE.target), 0.08) }] as Cue[])),
    { t: 5.6, type: 'sfx', id: 'ada_drip', pos: HATCH_WIDE.target, room: 'G3', gain: 0.6, rate: 0.7 },
    { t: 6.3, type: 'grade', grade: null },
    arms(6.3, true),
    aim(6.3, herFist),
    // she draws it to her breastbone; the whisper; a drop on the glove
    ...(noDof ? [] : ([{ t: 6.3, type: 'dof', dof: dof(dist(eye, herFist), 0.25, 2.5) }, ...bokehRamp(OUT_T, C4C_DURATION - OUT_T - 0.1, dof(dist(eye, herFist), 0.25, 2.5), 2.5, 0), { t: C4C_DURATION - 0.05, type: 'dof', dof: null }] as Cue[])),
    { t: 7.2, type: 'voice', trigger: 'c4c:there' },
    { t: 7.9, type: 'sfx', id: 'ada_drip', pos: add(eye, [0, 0, -0.5]), gain: 0.35 },
    // she turns to the parlor door
    { t: 9.0, type: 'clip', char: 'ada', clip: 'ada_finale_carry', loop: true, fade: 0.5 },
    { t: 10.8, type: 'light', op: 'storm_auto', on: true },
    { t: 10.9, type: 'fx', id: 'beamClamp', params: { on: false } },
    { t: 10.9, type: 'fx', id: 'exposure', params: { snap: true } }, // back to the eye, snapped (as C4a: a reset alone adapts over seconds)
    // SMOOTH-FRAMES (#142): gameplay resumes on the last camera (her back as she steps off toward the parlor door)
    { t: C4C_DURATION, type: 'player', pos: eye, heading: headingTo(eye, endChest), pitch: Math.atan2(endChest[2] - eye[2], Math.hypot(endChest[0] - eye[0], endChest[1] - eye[1])) },
  ];

  return {
    id: 'C4c',
    duration: C4C_DURATION,
    lock: 'full',
    shots,
    moves: [{ char: 'ada', t: 9.2, d: 1.6, path: [ada.pos, end.pos], heading: [toPlayer, end.heading], ease: 'inOut' }],
    cues,
    // no 2.39:1 bars: a POV take whose subject is the locket in the glove at the bottom of the frame (r6 Max: the bars
    // cut the glove and locket away, leaving her torso)
    letterbox: [{ t: 0, v: 0 }],
  };
};
