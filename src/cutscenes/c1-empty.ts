// C1 'Empty' (B01, 75 s, M1) — DESIGN B01, built to docs/C1-OPENING.md §4 (lead-approved 2026-10-08). Night, hard
// rain, County Road 9. The detailed sedan_interior v2 is mounted in your moving sedan (fx car_mount), so every POV
// shot sees the real corridor through the real windscreen. Beats: the radio finds nothing → the dead diner → the
// needle below E → the dome light and the map → the truck that does not stop → black walls of forest → NEXT SERVICES
// 48 MI and eyes → the ROOMS sign, the engine dies → rolls to the gate → lightning on the house, "Forty-eight miles to
// anything…" → step out past plate RVX-318 → CP1 (the story sets the checkpoint on cutscene end).
//
// Our vehicle track drives road-rc9.json at the westbound lane (n +1.75, 19 m/s); POV shots run on landmark-free
// stretches (the treadmill), landmark shots keep their geography (§4 "Our vehicle track").

import { CAR_GATE, DRIVER_EYE, PLATE_LOCAL, PROP, SPAWN, CAM, add, every, fwd, inCar } from './stage.ts';
import { roadPath, roadPoint, roadTrack } from './road.ts';
import { C1_WIPER_PHASE } from './c0-road.ts';
import type { CameraShot, Cue, P3, Timeline, TimelineFactory, VehicleTrack } from './types.ts';

export const C1_DURATION = 75;
/** Engine cough / death (§4 S8) and the coasting stop at the gate (S9). */
const COUGH_1 = 51.4;
const COUGH_2 = 53.6;
const ENGINE_DIES = 55.8;
const STOP = 61.0;
const LIGHTS_DIE = 61.6;
const FLASH = 63.2;

/** Lens → vertical fov (24 mm gate, §1). */
const MM = { 24: 53.1, 28: 46.4, 35: 37.8, 40: 33.4, 44: 30.6, 50: 27.0, 65: 20.9 } as const;
const WEST = 1.75; // the westbound lane centre (our lane)
/** POV exposure ceiling (§5.2 expects ≈ 1.7 for the windscreen veil + verge + cluster; look 1 metered 6.3 because
 *  the meter only sees the beam pool once the black cabin is cut by meterLow — the lit wet road then read as dusk). */
// runtime lane D (road2.mjs, C1 54): at 2.4 the beam-lit road (low-beam cookie ≈ 8 kcd at 3.7° down → E ≈ 5 lux at
// 10 m, L = 0.04·E/π ≈ 0.07 cd/m²) was metered to ≈ the 0.18 key — mid-grey "dry concrete", as light as the verge;
// the spec-only frame was correct dark wet asphalt. Back to §5.2's ≈ 1.7: the road sits ≈ 0.7 EV under key, the
// specular streaks, centre line and verge carry the frame.
const POV_MAX = 0.85; // + the +1 EV bias = 1.7 on screen (§5.2)

// ---- car-space points (x right, y forward, z up from the road; DRIVER_EYE (−0.35, −0.05, 1.12))
/** Down the road, the POV rest framing: ≈ 9° below the horizon so the binnacle, the dials, the two-spoke rim and the
 *  A-pillars hold the bottom of frame and the headliner stays ≤ 12 % (C1-OPENING §0, art-director dash_pov). */
const AHEAD: P3 = [-0.32, 10, -0.47];
const RADIO: P3 = [0.03, 0.54, 0.73];
// sedan_interior v2 dressing (props_m1.glb node origins, car space): the knob left of the column, the passenger seat
// with the folded County Road 9 map, the cassettes and the torch; the foam cup in the console; the medal on the mirror
const HEADLAMP_KNOB: P3 = [-0.67, 0.54, 0.8];
const CONSOLE_CUP: P3 = [0.05, 0.09, 0.66];
const PASSENGER_SEAT: P3 = [0.42, 0.12, 0.5];
const MAP: P3 = [0.33, 0.12, 0.53];
const VISOR: P3 = [-0.36, 0.2, 1.24];
const MEDAL: P3 = [0, 0.28, 1.2];
const WINDSCREEN: P3 = [-0.1, 6, 1.25];

/** The two C1 shots other timelines re-use (C7): the road POV and the ROOMS sign POV. */
export const C1_SHOTS = {
  pov: { t: 0, d: 6.6, space: 'car', path: [DRIVER_EYE], target: [AHEAD], fov: MM[24], ease: 'linear', handheld: 0.35 } as CameraShot,
  rooms: { t: 50.4, d: 6.2, space: 'car', path: [DRIVER_EYE], target: [[2.6, 160, 2.0], [2.2, 40, 2.1]], fov: [MM[28], MM[40]], ease: 'inOut', handheld: 0.4 } as CameraShot,
};

/** Our sedan's track (§4): road segments per shot, the coast to the gate at the end. */
export function c1VehicleTrack(): VehicleTrack[] {
  const gate: P3 = [CAR_GATE.pos[0], CAR_GATE.pos[1], 0];
  return [
    roadTrack(0, 6.6, 560, 435, WEST),
    roadTrack(6.6, 5.0, 745, 650, WEST),
    roadTrack(11.6, 6.0, 640, 526, WEST),
    roadTrack(17.6, 9.0, 671, 500, WEST),
    roadTrack(26.6, 11.2, 668, 455, WEST),
    roadTrack(37.8, 5.6, 372, 270, WEST),
    roadTrack(43.4, 7.0, 360, 227, WEST),
    // 19 → 15 m/s, easing out; coughs at 51.4 / 53.6, dies at 55.8
    { t: 50.4, d: 6.2, path: roadPath(140, 23, WEST), ease: 'linear', heading: 'path' },
    // coast off the lane onto the verge at the gate (n 1.75 → 2.8), a soft stop at 61.0
    { t: 56.6, d: STOP - 56.6, path: [roadPoint(23, WEST), roadPoint(12, 1.9), roadPoint(2, 2.3), gate], ease: 'out', heading: 'path' },
  ];
}

const POV_SHOTS = new Set<number>(); // indices of shots that are the driver's own eyes (arms visible)

export const c1Empty: TimelineFactory = (ctx) => {
  const plate = inCar(PLATE_LOCAL, CAR_GATE);
  const cp1 = SPAWN.CP1;
  const cp1Look = add(cp1.pos, fwd(cp1.heading, -0.01, 10));
  const car = (t: number, d: number, target: P3[], fov: number | [number, number], o: Partial<CameraShot> = {}): CameraShot => ({
    t, d, space: 'car', path: [DRIVER_EYE], target, fov, ease: 'inOut', handheld: 0.35, ...o,
  });

  const shots: CameraShot[] = [
    // S1 Seek (0–6.6): the road in the low beams, a glance to the radio at 3.4–5.4, back by 6.2
    { ...C1_SHOTS.pov, d: 3.4 },
    car(3.4, 3.2, [AHEAD, RADIO, RADIO, AHEAD, AHEAD], MM[24]),
    // S2 EAT (6.6–11.6): the dead diner from its lot; our headlights rake the plywood and leave
    { t: 6.6, d: 5.0, path: [[701.0, -225.0, 1.1], [700.6, -224.6, 1.1]], target: [[667.7, -208.7, 2.4], [640.0, -197.0, 1.2], [614.3, -189.1, 0.8]], fov: MM[28], ease: 'inOut', handheld: 0.25 },
    // S3 Below E (11.6–17.6): lean in to the cluster; rack from the speedo to the fuel needle under E
    // (v2 cluster at car (−0.37, 0.72, 0.785); the eye drops to look through the two-spoke rim's upper opening)
    { t: 11.6, d: 6.0, space: 'car', path: [[-0.31, 0.1, 0.96], [-0.3, 0.17, 0.94]], target: [[-0.43, 0.724, 0.8], [-0.3, 0.724, 0.79], [-0.3, 0.724, 0.79]], fov: MM[65], ease: 'inOut', handheld: 0.3 },
    // S4a Dome on (17.6–21.8): road → the headlamp knob (dome detent) → the passenger seat → the map
    car(17.6, 4.2, [AHEAD, HEADLAMP_KNOB, CONSOLE_CUP, PASSENGER_SEAT], MM[24]),
    // S4b The map (21.8–26.6): lean over to the folded County Road 9 map on the seat ("48", the interstate line);
    // the held-map version waits for the arms_map clip (Blender lane, §10.9)
    { t: 21.8, d: 4.8, space: 'car', path: [DRIVER_EYE, [-0.22, 0.0, 1.06]], target: [MAP, add(MAP, [-0.03, 0.03, 0])], fov: MM[35], ease: 'inOut', handheld: 0.3 },
    // S4c Dome off (26.6–30.2): the map to the lap → the visor photo and the medal → the windscreen → the road
    car(26.6, 3.6, [MAP, MEDAL, VISOR, WINDSCREEN, AHEAD], MM[24]),
    // S5 The truck (30.2–37.8): watch the glow come round; a slow push; the flinch
    car(30.2, 7.6, [AHEAD, [-0.6, 25, 1.0], [-0.9, 12, 0.9], AHEAD], [MM[24], MM[28]], { handheld: 0.5 }),
    // S6 Walls (37.8–43.4): crane over bend B; a tiny car between black walls of forest
    { t: 37.8, d: 5.6, path: [[348.7, -46.4, 12.0], [349.6, -46.7, 15.5]], target: [[366.0, -52.0, 1.0], [330, -44, 0.6], [270.1, -31.4, 0.0]], fov: MM[50], ease: 'out', handheld: 0.2 },
    // S7 48 and eyes (43.4–50.4): NEXT SERVICES 48 MI slides past on the right; eye-shine in the trees
    car(43.4, 7.0, [[0.3, 30, 1.0], [1.4, 18, 1.6], [2.0, 10, 2.2], [0.8, 30, 1.0], [3.0, 30, 0.9]], [MM[24], MM[28]], { handheld: 0.4 }),
    // S8 ROOMS (50.4–56.6): the lantern out of the dark; coughs; the engine dies
    { ...C1_SHOTS.rooms },
    // S9 The gate (56.6–62.0): by the sign post under the lantern; the car rolls into its pool and stops; lights die
    // AD review (61.8 near-black, board + plates over-exposed): the old camera stood 3 m from the lantern inside the yard,
    // seeing the board's back edge-on at 0.5 m from the flame (+11 EV over the car). Now from the far verge, south: the
    // car rolls in from the right into the pool, the gate behind its nose, the lantern a small hot point 9 m away and
    // the ROOMS board (faces SE, yaw 45°) ≈ 36° off-axis — readable, not filling the meter
    // runtime lane D: aim ends 0.6 m higher so the ROOMS board (≈ 10° up from the verge) sits inside the letterbox
    { t: 56.6, d: 5.4, path: [[-0.6, -37.0, 1.5], [-0.4, -36.8, 1.45]], target: [[9.0, -31.0, 1.1], [0.8, -29.2, 1.6]], fov: MM[35], ease: 'out', handheld: 0.3 },
    // S10 The house (62.0–69.0): from the dead car, lightning on the rise
    { t: 62.0, d: 7.0, path: [CAM.c1_house_reveal.pos, add(CAM.c1_house_reveal.pos, [0.02, 0.05, 0.02])], target: [CAM.c1_house_reveal.target], fov: [MM[50], MM[44]], ease: 'inOut', handheld: 0.4 },
    // S11 Step out (69.0–75.0): past the tail lamp onto plate RVX-318, rising into the rain to CP1's view up the drive
    {
      t: 69.0,
      d: C1_DURATION - 69.0,
      path: [add(plate, [0.3, 1.2, 0.85]), add(plate, [0.2, 1.6, 1.0]), [3.3, -28.1, 1.6], cp1.pos],
      target: [plate, add(plate, [-1.2, 1.8, 0.7]), [2.4, -20, 1.7], cp1Look],
      fov: [MM[40], ctx.player.fov ?? 60],
      ease: 'inOut',
      handheld: 0.6,
    },
  ];
  POV_SHOTS.clear();
  shots.forEach((s, i) => {
    if (s.space === 'car') POV_SHOTS.add(i);
  });

  // arms: only in the driver's own POV shots (§7.1.4), never in exterior shots
  const armsCues: Cue[] = [];
  let armsOn: boolean | null = null;
  for (const [i, s] of shots.entries()) {
    const on = POV_SHOTS.has(i) && s.t < ENGINE_DIES + 1;
    if (on !== armsOn) armsCues.push({ t: s.t, type: 'visible', char: 'arms', visible: on });
    armsOn = on;
  }
  // the detailed interior rides the moving car; driver_proxy shows only in exterior shots of it
  const mountCues: Cue[] = shots
    .filter((s) => s.t < 69)
    .map((s, i) => ({ t: s.t, type: 'fx', id: 'car_mount', params: { on: true, pov: POV_SHOTS.has(i) || s.t >= 62 } }) as Cue);

  const cues: Cue[] = [
    // ---- the car, the rain, the radio
    { t: 0, type: 'lock', mode: 'full' },
    { t: 0, type: 'light', op: 'storm_auto', on: false },
    { t: 0, type: 'weather', rain: 1, wind: 0.55, inside: 1, surface: 'car' },
    { t: 0, type: 'score', state: 'none' },
    { t: 0, type: 'light', op: 'flashlight', on: false },
    ...mountCues,
    { t: 0, type: 'loop', key: 'engine', id: 'engine_idle', gain: 0.8, fade: 0.1 },
    { t: 0, type: 'loop', key: 'radio', id: 'radio_static', gain: 0.3, fade: 1.5 },
    { t: 0, type: 'fx', id: 'windshield_rain', params: { on: true, intensity: 1 } },
    { t: 0, type: 'fx', id: 'wipers', params: { on: true, period: 1.25, phase: ctx.chained ? C1_WIPER_PHASE : 0 } },
    { t: 0, type: 'fx', id: 'dash', params: { on: true, fuelNeedle: 0.02, fuelLamp: false } },
    { t: 0, type: 'light', op: 'runtime', id: 'L_DASH', on: true },
    { t: 0, type: 'light', op: 'runtime', id: 'L_HEADLIGHT_L', on: true },
    { t: 0, type: 'light', op: 'runtime', id: 'L_HEADLIGHT_R', on: true },
    { t: 0, type: 'clip', char: 'arms', clip: 'arms_wheel', loop: true, fallback: ['arms_idle'] },
    ...armsCues,
    // POV exposure (§5.2): +1 EV bias, meter the lower 45 % out (black windscreen) so the cabin forms read
    { t: 0, type: 'fx', id: 'exposure', params: { biasEV: 1.0, meterLow: 0.45, max: POV_MAX, snap: true } },
    ...every('wiper', 0.4, ENGINE_DIES, 1.25, { gain: 0.6 }),
    // S1: the radio finds nothing
    { t: 3.6, type: 'sfx', id: 'radio_seek', gain: 0.8 },
    { t: 3.6, type: 'loop', key: 'radio', id: 'radio_static', gain: 0.55, fade: 0.2 },
    { t: 4.6, type: 'sfx', id: 'radio_seek', gain: 0.7, rate: 0.8 },
    // the VFD races and stops on nothing (glimpses.ts radio fx)
    { t: 3.6, type: 'fx', id: 'radio', params: { seek: 'FM', d: 0.95 } },
    { t: 4.6, type: 'fx', id: 'radio', params: { seek: 'AM', d: 0.8 } },
    { t: 4.6, type: 'loop', key: 'radio', id: 'radio_static', gain: 0.45, fade: 0.2 },
    { t: 5.4, type: 'voice', trigger: 'c1:radio_seek' },
    // S2 diner: hold the night meter as our lights rake the lot
    { t: 6.6, type: 'fx', id: 'exposure', params: { hold: true, snap: true } },
    // S3: the needle, the lamp, the chime, "Come on…"
    { t: 11.6, type: 'fx', id: 'exposure', params: { biasEV: 1.0, meterLow: 0.45, max: POV_MAX, snap: true } },
    { t: 11.6, type: 'dof', dof: { focusDistance: 0.78, focalLength: 0.12, bokehScale: 2.5 } },
    { t: 13.6, type: 'fx', id: 'dash', params: { on: true, fuelNeedle: -0.02, fuelLamp: true } },
    { t: 14.2, type: 'sfx', id: 'fuel_chime' },
    { t: 15.0, type: 'voice', trigger: 'c1:fuel_chime' },
    { t: 17.6, type: 'dof', dof: null },
    // S4a–c: the dome light — warm, legible; the eye adapts +3–4 EV over ≈ 1.5 s (min 0.01 for the bright cabin).
    // The night key (0.034) would put the lit cabin's mean 2.4 EV under mid-grey; a photo of a lit car interior at
    // night exposes it at mid-grey (0.18): bias +2.3 EV (look 3: at +0.3 the cup/map frame was black at 0.037)
    { t: 18.4, type: 'fx', id: 'exposure', params: { biasEV: 2.3, meterLow: 0.3, min: 0.01, tauDarken: 0.6 } },
    { t: 18.4, type: 'fx', id: 'dome', params: { on: true } },
    { t: 18.3, type: 'sfx', id: 'knob_click', gain: 0.8 },
    { t: 22.2, type: 'sfx', id: 'map_paper', gain: 0.7 },
    { t: 28.5, type: 'sfx', id: 'knob_click', gain: 0.7, rate: 0.95 },
    { t: 23.2, type: 'voice', trigger: 'c1:map' },
    { t: 28.6, type: 'fx', id: 'dome', params: { on: false } },
    // dome off: 2–3 s of night blindness, then the cluster and the verge return (no hold, slow brightening)
    { t: 28.6, type: 'fx', id: 'exposure', params: { biasEV: 1.0, meterLow: 0.45, min: 0.01, tauDarken: 0.35 } },
    // S5: the truck that does not stop (eastbound n −1.75, 25 m/s; meets us at s 516, t 34.6)
    { t: 26.6, type: 'fx', id: 'truck', params: { on: true, s0: 316, s1: 651, d: 13.4, n: -1.75 } },
    { t: 32.0, type: 'voice', trigger: 'c1:truck' },
    { t: 32.8, type: 'sfx', id: 'truck_pass', gain: 1.0 },
    { t: 32.4, type: 'fx', id: 'hibeam', params: { on: true } },
    { t: 32.38, type: 'sfx', id: 'knob_click', gain: 0.5, rate: 1.3 },
    { t: 32.58, type: 'sfx', id: 'knob_click', gain: 0.5, rate: 1.3 },
    // 34.8 the truck's spray sheets the glass; 35.0 fast wipers clear it in two sweeps; back to normal at 37.8
    { t: 34.8, type: 'fx', id: 'spray', params: { amount: 1 } },
    { t: 34.8, type: 'sfx', id: 'spray_hit' },
    { t: 35.0, type: 'fx', id: 'wipers', params: { on: true, period: 0.75 } },
    { t: 37.8, type: 'fx', id: 'wipers', params: { on: true, period: 1.25 } },
    { t: 32.5, type: 'fx', id: 'hibeam', params: { on: false } },
    { t: 32.6, type: 'fx', id: 'hibeam', params: { on: true } },
    { t: 32.7, type: 'fx', id: 'hibeam', params: { on: false } },
    { t: 40.0, type: 'fx', id: 'truck', params: { on: false } },
    // S6 walls: hold the black; S7 back to the POV meter
    { t: 37.8, type: 'fx', id: 'exposure', params: { hold: true, snap: true } },
    { t: 37.8, type: 'light', op: 'lightning', strength: 0.2 },
    { t: 43.4, type: 'fx', id: 'exposure', params: { biasEV: 1.0, meterLow: 0.45, max: POV_MAX, snap: true } },
    // S7: three pairs of eye-shine in the tree line (40 m, right); one doe turns away at 49.9, the rest at 50.2
    { t: 49.2, type: 'fx', id: 'deer', params: { eyes: true } },
    { t: 49.9, type: 'fx', id: 'deer', params: { eyes: false, i: 2 } },
    { t: 50.2, type: 'fx', id: 'deer', params: { eyes: false } },
    { t: 48.2, type: 'loop', key: 'radio', id: 'radio_static', gain: 0.35, fade: 0.8 },
    // S8 ROOMS: the lantern; the engine coughs and dies
    { t: 50.4, type: 'fx', id: 'exposure', params: { biasEV: 1.0, meterLow: 0.4, max: POV_MAX } },
    { t: COUGH_1, type: 'sfx', id: 'engine_sputter' },
    { t: 52.4, type: 'sfx', id: 'vacancy_creak', pos: PROP.P_VACANCY_PLATE, room: 'EXT1', gain: 0.8 },
    { t: COUGH_2, type: 'sfx', id: 'engine_sputter', gain: 1.1 },
    { t: ENGINE_DIES, type: 'sfx', id: 'engine_stall' },
    { t: ENGINE_DIES + 0.05, type: 'loop', key: 'engine', id: null, fade: 0.15 },
    { t: ENGINE_DIES + 0.05, type: 'loop', key: 'radio', id: null, fade: 0.05 },
    { t: ENGINE_DIES + 0.1, type: 'fx', id: 'wipers', params: { on: false } },
    { t: ENGINE_DIES + 0.1, type: 'fx', id: 'dash', params: { on: false, fuelNeedle: -0.02, fuelLamp: true } },
    { t: ENGINE_DIES + 0.1, type: 'light', op: 'runtime', id: 'L_DASH', on: false },
    { t: ENGINE_DIES + 0.2, type: 'light', op: 'runtime', id: 'L_HEADLIGHT_L', on: true, scale: 0.35 },
    { t: ENGINE_DIES + 0.2, type: 'light', op: 'runtime', id: 'L_HEADLIGHT_R', on: true, scale: 0.35 },
    { t: ENGINE_DIES + 0.2, type: 'fx', id: 'stall', params: { k: 1 } },
    // S9 gate: the lantern pool; the lights die; a slow brightening
    { t: 56.6, type: 'fx', id: 'exposure', params: { snap: true } },
    { t: STOP - 0.3, type: 'sfx', id: 'tyres_gravel', gain: 0.5 },
    { t: LIGHTS_DIE, type: 'light', op: 'runtime', id: 'L_HEADLIGHT_L', on: false },
    { t: LIGHTS_DIE, type: 'light', op: 'runtime', id: 'L_HEADLIGHT_R', on: false },
    { t: LIGHTS_DIE, type: 'fx', id: 'stall', params: { k: 0 } },
    { t: 61.8, type: 'sfx', id: 'vacancy_creak', pos: PROP.P_VACANCY_PLATE, room: 'EXT1', gain: 0.9 },
    // S10: lightning reveals the house on the rise (flash hold), "Forty-eight miles to anything…"
    { t: 62.0, type: 'fx', id: 'exposure', params: { snap: true } },
    { t: FLASH, type: 'light', op: 'lightning', strength: 1 },
    { t: FLASH + 0.08, type: 'score', state: 'drone', stinger: 'score_reveal' },
    { t: 65.6, type: 'voice', trigger: 'c1:engine_dead' },
    // S11: step out into the rain
    { t: 68.6, type: 'sfx', id: 'latch', gain: 0.7 },
    { t: 69.0, type: 'fx', id: 'car_mount', params: { on: false } },
    { t: 69.0, type: 'fx', id: 'windshield_rain', params: { on: false, intensity: 0 } },
    { t: 69.0, type: 'fx', id: 'exposure', params: { reset: true } },
    { t: 69.0, type: 'weather', rain: 1, wind: 0.8, inside: 0, surface: 'gravel' },
    { t: 69.0, type: 'fx', id: 'taillights', params: { on: true, intensity: 0.35 } },
    { t: 69.2, type: 'sfx', id: 'coat_rustle' },
    { t: 70.4, type: 'sfx', id: 'door_slam', gain: 0.45, rate: 1.25 },
    { t: 73.6, type: 'light', op: 'flashlight', on: true },
    { t: 73.6, type: 'sfx', id: 'flashlight_click', gain: 0.6 },
    { t: 73.7, type: 'visible', char: 'arms', visible: true },
    { t: 73.7, type: 'clip', char: 'arms', clip: 'arms_idle', loop: true },
    { t: C1_DURATION, type: 'player', pos: cp1.pos, heading: cp1.heading, pitch: cp1.pitch },
    { t: C1_DURATION, type: 'fx', id: 'taillights', params: { on: false, intensity: 0 } },
    { t: C1_DURATION, type: 'release', char: 'arms' },
  ];
  cues.sort((a, b) => a.t - b.t);

  const tl: Timeline = {
    id: 'C1',
    duration: C1_DURATION,
    lock: 'full',
    // after C0 the cut is matched on the wiper: no fade-in (C1-OPENING §3 shot 4)
    fade: ctx.chained
      ? [{ t: 0, v: 0 }]
      : [
          { t: 0, v: 1 },
          { t: 1.6, v: 0 },
        ],
    letterbox: [
      { t: 0, v: 1 },
      { t: 72.4, v: 1 },
      { t: 74.6, v: 0 },
    ],
    vehicle: c1VehicleTrack(),
    shots,
    cues,
  };
  return tl;
};
