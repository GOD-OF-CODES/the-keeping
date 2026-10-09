// C0 'County Road 9' — the 30 s title cinematic before C1 (docs/C1-OPENING.md §3, lead-approved 2026-10-08).
// The Shining's opening aerial at night in the rain: one pair of headlights alone in a forest that goes on forever,
// lightning showing the land to the horizon with no light anywhere, a dead billboard and sagging wires, the crane
// under the title, then a pull-back through the windscreen that match-cuts into C1 on a wiper sweep.
//
// Played by the cutscene host as C1's preroll (host.ts PREROLL): the Director asks for C1, C0 runs first, and its
// end (or a skip, once seen) starts C1 with `chained` (no fade-in). All positions are PLAN (Z-up) from road-rc9.json.

import { DRIVER_EYE } from './stage.ts';
import { roadTrack } from './road.ts';
import type { CameraShot, Cue, Timeline, TimelineFactory } from './types.ts';

export const C0_DURATION = 30;
/** 35 mm etc. on the 24 mm gate (§1). */
const MM = { 28: 46.4, 35: 37.8, 40: 33.4 } as const;
const WEST = 1.75; // the westbound lane (our lane)
/** Wiper: a blade crosses the frame at 29.75 (§3 shot 4); C1 starts on the same sweep (phase continues). */
export const WIPER_PERIOD = 1.25;
export const C0_WIPER_START = 26.0;
/** Phase at the wipers' start so that ph(29.75) = 0.4 (blade high in its upstroke, crossing the driver's view). */
const WIPER_PHASE0 = 0.4;
/** C1's start phase when chained: 0.25 s after the crossing. */
export const C1_WIPER_PHASE = (WIPER_PHASE0 + (C0_DURATION - C0_WIPER_START) / WIPER_PERIOD) % 1;

const DATE_CARD = 'Tuesday, 11 October 1994';
export const TITLE = 'THE KEEPING';
export const BYLINE = 'a game by Raj Vardhan Singh';

/** Lightning (§3): far cloud-to-ground over the forest, near behind the billboard, a cloud-to-cloud flicker. */
export const C0_FLASHES = [
  { t: 9.2, strength: 0.7 },
  { t: 15.6, strength: 0.9 },
  { t: 23.6, strength: 0.25 },
] as const;

export const c0Road: TimelineFactory = () => {
  const aerial: CameraShot = {
    t: 3.5,
    d: 9.0,
    // over the road's axis 6 m south of the centreline (inside the 14 m clearing), looking east down seg E: the §3
    // position (70 m south of the road) put the south pine wall between the lens and the road at 8° depression, so
    // neither the road nor the beam pool could be seen (r3 frame 6 s). Depression ≈ 8°, horizon high in the band.
    path: [
      [902.0, -343.0, 62],
      [922.0, -342.4, 52],
    ],
    target: [
      [1262.0, -337.5, 12],
      [1250.0, -337.0, 6],
    ],
    fov: MM[35],
    ease: 'inOut',
    handheld: 0,
    roll: [0.0026, -0.0026], // ±0.15° of slow wind sway over the push
  };
  const shots: CameraShot[] = [
    // Shot 0: black (the aerial's opening pose, under the fade)
    { t: 0, d: 3.5, path: [aerial.path[0]], target: [aerial.target[0]], fov: MM[35], handheld: 0 },
    // Shot 1: the aerial — one pair of headlights crawling out of the fog toward camera on seg E
    aerial,
    // Shot 2: from behind the power line on the +n side of bend D; the beams rake the billboard; the car passes
    {
      t: 12.5,
      d: 6.5,
      path: [
        [903.7, -316.6, 4.2],
        [903.2, -317.4, 4.0],
      ],
      target: [
        [872.6, -343.8, 4.6],
        [868.0, -340.5, 3.6],
      ],
      fov: MM[35],
      ease: 'inOut',
      handheld: 0.15,
    },
    // Shot 3: the crane on the +n shoulder at s 800: the car approaches, passes beneath at 22.9, recedes west
    {
      t: 19.0,
      d: 7.0,
      path: [
        [762.2, -269.0, 2.0],
        [762.2, -269.0, 6.5],
        [762.2, -269.0, 14.0],
      ],
      target: [
        [820.0, -306.0, 1.0],
        [770.0, -277.0, 0.5],
        [630.0, -198.0, 1.0],
      ],
      fov: [MM[28], MM[35]],
      ease: 'inOut',
      handheld: 0.1,
    },
    // Shot 4: car space — over the hood, pull straight back through the windscreen to just above the rim
    {
      t: 26.0,
      d: 4.0,
      space: 'car',
      path: [
        [-0.3, 3.4, 1.3],
        [-0.3, 1.6, 1.24],
        [-0.3, 0.3, 1.13],
      ],
      target: [
        [-0.3, 30, 0.9],
        [-0.3, 25, 0.95],
      ],
      fov: MM[40],
      // 'out': a fast pull that settles behind the glass — it crosses y ≈ 0.48 at u 0.94 → t ≈ 29.0, leaving ≈ 1 s
      // inside on the drops before the blade crosses at 29.75 (with 'in' it crossed at 29.9: no time inside at all)
      ease: 'out',
      handheld: 0.15,
    },
  ];

  const cues: Cue[] = [
    { t: 0, type: 'lock', mode: 'full' },
    { t: 0, type: 'light', op: 'storm_auto', on: false },
    { t: 0, type: 'light', op: 'flashlight', on: false },
    { t: 0, type: 'weather', rain: 1, wind: 0.6, inside: 0 },
    { t: 0, type: 'score', state: 'drone' },
    // our car: the interior rides it (driver_proxy as a silhouette in the exterior shots); low beams, the cluster
    { t: 0, type: 'fx', id: 'car_mount', params: { on: true, pov: false } },
    { t: 0, type: 'fx', id: 'c0_look', params: { on: true } },
    { t: 0, type: 'light', op: 'runtime', id: 'L_HEADLIGHT_L', on: true },
    { t: 0, type: 'light', op: 'runtime', id: 'L_HEADLIGHT_R', on: true },
    { t: 0, type: 'light', op: 'runtime', id: 'L_DASH', on: true },
    { t: 0, type: 'fx', id: 'dash', params: { on: true, fuelNeedle: -0.05, fuelLamp: false } },
    { t: 0, type: 'fx', id: 'windshield_rain', params: { on: false, intensity: 0 } },
    { t: 0, type: 'fx', id: 'wipers', params: { on: false } },
    { t: 0, type: 'loop', key: 'rain_ext', id: 'rain_leaves', gain: 0.9, fade: 2.5 },
    // Shot 0: the date card
    { t: 0.8, type: 'card', text: DATE_CARD, style: 'date' },
    { t: 1.4, type: 'sfx', id: 'thunder_distant', gain: 0.7 },
    { t: 2.9, type: 'card', text: null, style: 'date' },
    // Shot 1: the aerial — a hard-held night meter so the one pair of lights reads alone in the black
    { t: 3.5, type: 'fx', id: 'exposure', params: { hold: false, snap: true, biasEV: 0.3 } },
    { t: 4.0, type: 'loop', key: 'car_ext', id: 'car_pass_by', gain: 0.25, fade: 3 },
    // Shot 2: wires in the wind; the meter holds at the cut so the headlight rake reads as light arriving
    { t: 12.5, type: 'fx', id: 'exposure', params: { hold: true, snap: true, biasEV: -0.5 } },
    { t: 12.5, type: 'dof', dof: { focusDistance: 37, focalLength: 14, bokehScale: 2 } },
    { t: 12.5, type: 'loop', key: 'wire', id: 'wire_wind', gain: 0.6, fade: 0.6 },
    { t: 12.5, type: 'fx', id: 'billboard', params: { flutter: 1 } },
    { t: 15.0, type: 'sfx', id: 'car_pass_by', pos: [871.0, -333.0, 0.6], gain: 1.0 },
    { t: 16.8, type: 'sfx', id: 'thunder_near' },
    // Shot 3: the crane; focus follows the car; the title
    { t: 19.0, type: 'loop', key: 'wire', id: null, fade: 1.2 },
    { t: 19.0, type: 'fx', id: 'exposure', params: { hold: false, snap: true, biasEV: 0.3 } },
    { t: 19.0, type: 'dof', dof: { focusDistance: 30, focalLength: 40, bokehScale: 1.5 } },
    { t: 20.0, type: 'card', text: TITLE, style: 'title' },
    { t: 20.0, type: 'score', state: 'drone', stinger: 'score_reveal' },
    { t: 20.8, type: 'card', text: BYLINE, style: 'byline' },
    { t: 22.9, type: 'sfx', id: 'car_pass_by', pos: [770.0, -277.0, 0.6], gain: 1.2, rate: 1.05 },
    { t: 24.0, type: 'card', text: null, style: 'title' },
    // Shot 4: through the glass; the exterior bed goes under the glass; the wiper match-cut
    { t: 26.0, type: 'loop', key: 'car_ext', id: null, fade: 0.4 },
    { t: 26.0, type: 'fx', id: 'windshield_rain', params: { on: true, intensity: 1 } },
    { t: 26.0, type: 'fx', id: 'wipers', params: { on: true, period: WIPER_PERIOD, phase: WIPER_PHASE0 } },
    // runtime lane D: the road is the only lit surface here, so the meter (bias +1) normalised the wet asphalt to
    // mid-grey ("pale dry concrete"). road.mjs (scratch/rd/road): at 1.7 the low-beam-lit road still read pale —
    // 2 × 15 kcd at 0.64 m over 10–30 m gives ≈ 3–10 lux, L = 0.04·E/π ≈ 0.05–0.13 cd/m²; at 1.0 that maps to
    // ≈ 0.5 × the 0.18 key, a dark wet road with the puddles black (the no-headlight frame shows the wet sparkle).
    { t: 26.0, type: 'fx', id: 'exposure', params: { min: 1.0, max: 1.0, snap: true } },
    { t: 26.0, type: 'dof', dof: { focusDistance: 20, focalLength: 30, bokehScale: 1.5 } },
    // 29.0: the camera passes behind the glass — the driver proxy hides (we are now him), the bed goes muffled
    // (interior weather: the exterior rain lowpassed, §7.13 1.8 kHz), focus racks to the drops 0.18 m away
    { t: 29.0, type: 'fx', id: 'car_mount', params: { on: true, pov: true } },
    { t: 29.0, type: 'weather', rain: 1, wind: 0.6, inside: 1, surface: 'car' },
    { t: 29.0, type: 'loop', key: 'rain_ext', id: 'rain_leaves', gain: 0.2, fade: 0.3 },
    { t: 29.0, type: 'loop', key: 'engine', id: 'engine_idle', gain: 0.6, fade: 0.3 },
    { t: 29.0, type: 'loop', key: 'radio', id: 'radio_static', gain: 0.18, fade: 0.6 },
    { t: 28.6, type: 'dof', dof: { focusDistance: 0.2, focalLength: 0.25, bokehScale: 2.5 } },
    { t: 28.8, type: 'sfx', id: 'wiper', gain: 0.6 },
    { t: 29.5, type: 'fx', id: 'c0_look', params: { on: false } },
    { t: C0_DURATION, type: 'loop', key: 'rain_ext', id: null, fade: 0.05 },
  ];
  for (const f of C0_FLASHES) cues.push({ t: f.t, type: 'light', op: 'lightning', strength: f.strength });
  cues.sort((a, b) => a.t - b.t);

  const tl: Timeline = {
    id: 'C0',
    duration: C0_DURATION,
    lock: 'full',
    // black under the date card; a hard cut into the aerial (no fade at the end: C1 match-cuts on the wiper)
    fade: [
      { t: 0, v: 1 },
      { t: 3.5, v: 1 },
      { t: 3.501, v: 0 },
    ],
    letterbox: [
      { t: 0, v: 1 },
      { t: C0_DURATION, v: 1 },
    ],
    vehicle: [
      roadTrack(0, 3.5, 1306, 1240, WEST),
      roadTrack(3.5, 9.0, 1240, 1070, WEST),
      roadTrack(12.5, 6.5, 1010, 890, WEST),
      roadTrack(19.0, 7.0, 870, 745, WEST),
      roadTrack(26.0, 4.0, 745, 670, WEST),
    ],
    shots,
    cues,
  };
  return tl;
};

/** Driver-eye reference for tests (shot 4 ends 15 cm above the rim, near the driver's eye). */
export const C0_END_EYE = DRIVER_EYE;
