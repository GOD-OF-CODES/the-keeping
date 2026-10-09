// Staging constants shared by the cutscene timelines — every number is derived from src/shared/level-layout.json
// (tests/cutscene.test.ts checks them against the layout) or from docs/CHARACTERS.md (the C2 tableau).
// PLAN space: metres, Z-up, x = east, y = north. Headings: radians CCW from +x.

import { carToPlan } from './math.ts';
import type { CameraShot, Cue, P3 } from './types.ts';

export const GROUND = 0.6; // ground-floor elevation
export const UPPER = 4.1;
export const EYE = 1.65; // standing eye height above the floor (spawn eye = floor + 1.65)

/** layout.cameras (pos / target / fovDeg). */
export const CAM = {
  parlor_threshold: { pos: [3.42, 1.5, 2.22] as P3, target: [6.3, 4.8, 1.65] as P3, fov: 50 },
  parlor_wide: { pos: [3.95, 0.3, 2.9] as P3, target: [6.4, 5.2, 1.9] as P3, fov: 62 },
  porch_approach: { pos: [2.3, -13, 1.6] as P3, target: [1.8, -0.3, 2.4] as P3, fov: 45 },
  c1_house_reveal: { pos: [2.6, -30.1, 1.15] as P3, target: [3.5, 0, 5.5] as P3, fov: 50 },
  c3_field: { pos: [8.45, 1.3, 5.7] as P3, target: [18, 0.5, 0.6] as P3, fov: 55 },
  c7_guest_book: { pos: [2.85, 4.1, 2.15] as P3, target: [3.33, 4.1, 1.4] as P3, fov: 38 },
  c7_sting_threshold: { pos: [3.42, 1.5, 2.22] as P3, target: [6.3, 4.8, 1.65] as P3, fov: 50 },
} as const;

/** layout.spawns used as hand-off points (eye, heading, pitch). */
export const SPAWN = {
  CP1: { pos: [1.8, -27.4, 1.65] as P3, heading: 1.571, pitch: 0.05 },
  CP2: { pos: [0.55, 8.25, 5.75] as P3, heading: -1.571, pitch: -0.87 }, // C2-ESCAPE K4: the stair top after C2c
} as const;

/** Props (layout.props pos) the cutscenes aim at. */
export const PROP = {
  P_SAWBUCK: [5.6, 3.3, 0.6] as P3,
  P_CANDLE_TABLE: [5.6, 2.3, 1.42] as P3,
  P_ROCKER: [7.4, 4.95, 0.6] as P3,
  P_CLEAT: [3.8, 1.9, 2.2] as P3,
  P_PULLEY_1: [2.35, 0.1, 3.7] as P3,
  P_PULLEY_3: [3.5, 1.5, 3.7] as P3,
  P_BOLT_BOX: [1.8, 0.1, 3.42] as P3,
  P_SPRING_BELL: [3.85, 1.45, 3.4] as P3,
  P_KNOCKER: [1.8, -0.36, 2.05] as P3,
  P_VACANCY_PLATE: [-1.8, -28.62, 1.75] as P3,
  P_SIGN_LANTERN: [-1.8, -28.45, 2.05] as P3,
  P_NEXT_SERVICES: [18.6, -28.9, 0] as P3,
  P_CAR_GATE: [2.8, -30.2, 0] as P3,
  P_CAR_ROW: [13.4, -1.6, 0] as P3,
  P_PUMP: [4.9, -14, 0] as P3,
  P_CAR_INTERIOR: [100.8, 1.4, 0] as P3,
  P_DRESS: [8.15, 7.2, 4.1] as P3,
  P_HARLAN_POSE_PUSH: [13, -3.4, 0] as P3,
  P_HARLAN_POSE_LOOKUP: [12.2, 0.6, 0] as P3,
} as const;

/** Layout prop yaw → facing heading (props face −y at yaw 0 ⇒ heading = yaw − π/2). */
export const yawToHeading = (yaw: number): number => yaw - Math.PI / 2;

/** Door centres (walls WG_S1 / WG_G1G2 openings O_FRONT / O_PARLOR, ground floor). */
export const DOOR = {
  front: [1.8, -0.15, GROUND] as P3,
  parlor: [3.675, 1.5, GROUND] as P3,
} as const;

/** aiNodes */
export const NODE = {
  G_PARLOR_LURE: [3.2, 1.5, 0.6] as P3,
  U3_DRESS: [7.4, 7.2, 4.1] as P3,
  U3_WARD_HC: [5, 7.95, 4.1] as P3,
} as const;

/** H_ADA_WARDROBE eye (C4 is seen from here). */
export const WARDROBE_EYE: P3 = [5, 8.85, 5.65];

// ---- the C2 tableau (docs/CHARACTERS.md "The opening (C2) staging")
// Ada's frame: root at the origin facing −Y, table long axis along X, head over the far edge; Harlan at
// (0.02, −1.08) yawed 180°; the player on Ada's left (+X), 3–4 m away. The sawbuck (yaw 1.571) runs north–south,
// so Ada's +X must point south (toward the threshold camera, south-west of the table): Ada faces WEST (heading π),
// her root 0.33 m east of the table centre; Harlan stands west of the table facing east (heading 0).
export const ADA_TABLE: { pos: P3; heading: number } = { pos: [5.93, 3.3, GROUND], heading: Math.PI };
export const HARLAN_TABLE: { pos: P3; heading: number } = { pos: [4.85, 3.28, GROUND], heading: 0 };
/** Where her head hangs / is lifted (approx. head height when lifted, for aim + DOF). */
export const ADA_HEAD_LIFTED: P3 = [5.2, 3.22, 1.55];
export const HARLAN_SACK: P3 = [4.85, 3.28, 2.35];

/** P_ROCKER yaw −0.834 → faces the doorway. */
export const ROCKER_HEADING = yawToHeading(-0.834);

// ---- cars
/** Car-local driver eye (x right, y forward, z up): the CAR set's debug_car eye relative to P_CAR_INTERIOR. */
export const DRIVER_EYE: P3 = [-0.35, -0.05, 1.12];
/** The CAR set (interior close-ups) faces north. */
export const CAR_SET = { pos: PROP.P_CAR_INTERIOR, heading: Math.PI / 2 } as const;
/** Your sedan at the gate (P_CAR_GATE yaw −1.571 → heading π, nose west). */
export const CAR_GATE = { pos: PROP.P_CAR_GATE, heading: Math.PI } as const;
/** Your sedan at the near end of the wreck row (P_CAR_ROW yaw 2.792). */
export const CAR_ROW = { pos: PROP.P_CAR_ROW, heading: yawToHeading(2.792) } as const;
/** Rear plate RVX-318 (car-local). */
export const PLATE_LOCAL: P3 = [0, -2.35, 0.55];

export const inCar = (local: P3, car: { pos: P3; heading: number }): P3 => carToPlan(local, car.pos, car.heading);

// ---- small authoring helpers

export const add = (a: P3, b: P3): P3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const fwd = (heading: number, pitch = 0, d = 1): P3 => [Math.cos(heading) * Math.cos(pitch) * d, Math.sin(heading) * Math.cos(pitch) * d, Math.sin(pitch) * d];
export const headingTo = (from: P3, to: P3): number => Math.atan2(to[1] - from[1], to[0] - from[0]);
export const dist = (a: P3, b: P3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** A locked-off shot. */
export function still(t: number, d: number, pos: P3, target: P3, fov: number, handheld = 0): CameraShot {
  return { t, d, path: [pos], target: [target], fov, handheld };
}

/** Repeating one-shot sfx cues (wipers, rocking …). */
export function every(id: string, from: number, to: number, period: number, extra: Partial<Extract<Cue, { type: 'sfx' }>> = {}): Cue[] {
  const out: Cue[] = [];
  for (let t = from; t < to - 1e-6; t += period) out.push({ t: Math.round(t * 1000) / 1000, type: 'sfx', id, ...extra });
  return out;
}

/** DOF focused at a point from a camera position. */
export const focusAt = (cam: P3, p: P3, focal = 1.2, bokeh = 2.5) => ({ focusDistance: Math.round(dist(cam, p) * 100) / 100, focalLength: focal, bokehScale: bokeh });

// ---- C2-ESCAPE (docs/C2-ESCAPE.md §2.0 staging constants; PLAN; tests/c2-escape-stage.test.ts checks them)
/** Vertical FOV (deg) of a prime on the 24 mm gate: 2·atan(12 / f). 50 mm = 27.0°, 35 mm = 37.8°, 100 mm = 13.7°. */
export const lens = (mm: number): number => (2 * Math.atan(12 / mm) * 180) / Math.PI;
/** The lean eye D inside the doorway reveal (layout camera parlor_lean, K5). */
export const C2E_D: P3 = [3.7, 1.26, 2.17];
/** The threshold eye T (camera parlor_threshold). */
export const C2E_T: P3 = [3.42, 1.5, 2.22];
/** The cut point (C4–C5) on the west edge of the sawbuck; the cap normal points west, 20° up. */
export const NECK: P3 = [5.31, 3.25, 1.4];
/** L_LAMP_PARLOR flame (K2) on the moved stool. */
export const LAMP_FLAME: P3 = [4.6, 4.25, 1.35];
/** Harlan's strike root and heading (SSE). */
export const HARLAN_C2: { pos: P3; heading: number } = { pos: [5.15, 3.95, GROUND], heading: -1.25 };
/** The head's landing (centre) and its rest after the boot nudge (cut end toward the lamp, NW). */
export const HEAD_LAND: P3 = [5.12, 3.18, 0.7];
export const HEAD_REST: P3 = [5.02, 3.05, 0.7];
/** The stair-top eye S = CP2 (K4). */
export const STAIR_TOP_EYE = { pos: [0.55, 8.25, 5.75] as P3, heading: -1.571, pitch: -0.87 } as const;
/** ST_MAIN: 16 risers × 0.219 m, treads 0.28 m, from (0.55, 3.60) running north; tread k's nosing. */
export const ST_MAIN = { x: 0.55, y0: 3.6, risers: 16, rise: 0.219, run: 0.28, width: 1.1, creaky: [5, 12] } as const;
export const treadNosing = (k: number): P3 => [ST_MAIN.x, ST_MAIN.y0 + ST_MAIN.run * k, GROUND + ST_MAIN.rise * k];
