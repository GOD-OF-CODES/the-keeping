// C2 head attached until the strike (lead ruling (ao), CONTRACT-CHANGES #142c) — a pure pose layer, no three import (the
// offline checks scratch/smooth-frames/head/posesearch.mjs and tests/smooth-c2-head.test.ts apply the same numbers).
//
// The table clips (ada_table, ada_c2: blender/anim/clips_ada.py table_pose — neck bend 36° + head 26°) were authored for a
// head hanging over the sawbuck's far (west) edge, but on this rig she stands at the east edge bent over: hip joint →
// neck_01 is 0.49 m and the top is 0.60 m wide, so the flexed neck drove the head INTO the table (75–79 % of ada_head's
// skinned vertices below the top at x 5.32–5.54, 0 % past the edge — scratch/smooth-frames/head/adaverts.mjs). Every C2
// shot then showed a neck entering the sheet with the baked wound coat at the line: a stump, and a head appeared on the
// floor after the strike (user report 2026-10-12).
//
// The fix restores the authored staging (docs/C2-ESCAPE.md §2.0/§3.1: "her head and neck over the WEST edge"): she is
// moved 0.20 m forward (west) and 3 cm up — which also ends the clip's 2.8 cm sink of chest and neck into the sheet —
// her pelvis rests on the top 0.12 m inside the east edge and her legs hang off the east side over it (thighs swung
// 55° back, knees bent 60°: toes 15 cm off the boards, behind the table from every C2 camera); the neck runs over the
// west edge and the head lolls just past it, turned on the neck toward the doorway (the camera D). Measured on the
// medium GLB with the head piece riding neck_02 as head-carry.ts mounts it (scratch/smooth-frames/head/posesearch.mjs,
// C2 7.5 and ada_table): ada_head 91 % past the edge, 0 vertices in the top or through the measured west drape of
// P_RUBBER_SHEET, 0 body vertices in the top or the east drape; head centre (5.23, 3.22, 1.55); face 235° (D bears
// 232°), 4° below level, face·(→D) 0.95; the body's cut ring at (5.28, 3.30, 1.47) — ≈ 3 cm from harlan_c2's IK'd
// contact on stage NECK (5.31, 3.25), which it never met before (the ring was at 5.49, inside the top). The head therefore falls off the edge on the cut as authored (cutscene-fx
// 'fall' → HEAD_LAND), and the jets leave the real stump (blood-fx JET_CUT / JET_AZ / JET_EL re-probed for this pose).
//
// Rotations are in Ada's ROOT frame (+X her left, +Y up, +Z forward), applied at each joint in list order (each chain
// root → tip), each composed as P⁻¹·R·P with the joint's parent world rotation P. Degrees, Euler 'XYZ'.

/** Root offset in her own frame (m): forward (+Z, west at C2's heading) and up. */
export const TABLE_ROOT = { fwd: 0.2, up: 0.03 } as const;

export type TableLiftBone = 'thigh_l' | 'thigh_r' | 'calf_l' | 'calf_r' | 'neck_01' | 'neck_02';

export const TABLE_LIFT: ReadonlyArray<{ bone: TableLiftBone; deg: readonly [number, number, number] }> = [
  { bone: 'thigh_l', deg: [55, 0, 0] },
  { bone: 'thigh_r', deg: [55, 0, 0] },
  { bone: 'calf_l', deg: [-60, 0, 0] },
  { bone: 'calf_r', deg: [-60, 0, 0] },
  // the head piece rides neck_02 while whole (head-carry.ts), so the head is turned through the neck only — a `head`
  // delta would twist the body's skin at the seam away from it: 75° of turn split over both neck joints, −60° extension
  { bone: 'neck_01', deg: [0, 0, 34] },
  { bone: 'neck_02', deg: [-60, -20, 41] },
];

/**
 * The seam (sever.py): the body's rim is skinned neck_02 0.583 · neck_01 0.252 · clavicle_l 0.085 · clavicle_r 0.080
 * (mean over the 959 rim pairs, medium GLB) while the head piece's rim is 99.5 % on its own `neck_stub` bone. While she
 * is whole ada.ts drives neck_stub with this weighted blend of the rim bones' motion from rest, so the stub follows the
 * body's rim instead of the head (the clip pose alone opened the seam up to 22 mm; this pose 47 → 25 mm max).
 */
export const SEAM_RIM: ReadonlyArray<readonly [string, number]> = [['neck_02', 0.583], ['neck_01', 0.252], ['clavicle_l', 0.085], ['clavicle_r', 0.08]];

/** Plan-space sawbuck the head rests on (P_SAWBUCK 0.6 × 2.2 m, top 1.40 + the 3 mm rubber sheet). */
export const SAWBUCK_TOP = { x0: 5.3, x1: 5.9, y0: 2.2, y1: 4.4, z: 1.403, drapeX: 5.24, drapeZ0: 0.9 } as const;

const smooth = (u: number): number => {
  const x = Math.max(0, Math.min(1, u));
  return x * x * (3 - 2 * x);
};

/**
 * Weight of the table lift for the clip Ada is playing (null = none). ada_table (the pre-C2 tableau, the B03 glimpses,
 * the load warm-up) and ada_c2 (all of C2 up to 21.9 — the body deltas hold through the sever so the stump never pops;
 * the head delta then moves an orphaned bone) → 1; ada_rise_headless starts from table_pose(0) and leaves it at clip
 * 0.3 → 1.2 (knees down at 1.05), so the lift blends out over the same span.
 */
export function tableLiftWeight(clip: string | null, clipTime: number): number {
  if (clip === 'ada_table' || clip === 'ada_c2') return 1;
  if (clip === 'ada_rise_headless') return 1 - smooth((clipTime - 0.3) / 0.9);
  return 0;
}
