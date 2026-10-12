// C4c "She Remembers" (CUTSCENES-PLAN §3): the step she takes toward the parlor door at the end of the authored take.
// Shared by the timeline (her root move) and the Director (the brain resumes FINALE 'carry' from the same point), so
// the hand-back never pops. Pure (no three.js).

import type { P3 } from './types.ts';

/** G_PARLOR_LURE (level-layout aiNodes): where her FINALE carry walks to (src/ai/ada-brain.ts LURE_NODE). */
export const C4C_PARLOR_LURE: P3 = [3.2, 1.5, 0.6];
/** One unhurried step (m) — short enough never to cross a wall from where she stands at arm's length. */
export const C4C_STEP_M = 0.35;

/** Her root + heading at C4c's end, from her root at its start (PLAN). */
export function c4cCarryEnd(ada: P3): { pos: P3; heading: number } {
  const dx = C4C_PARLOR_LURE[0] - ada[0];
  const dy = C4C_PARLOR_LURE[1] - ada[1];
  const d = Math.hypot(dx, dy);
  if (d < 1e-3) return { pos: [ada[0], ada[1], ada[2]], heading: 0 };
  const k = Math.min(C4C_STEP_M, d) / d;
  return { pos: [ada[0] + dx * k, ada[1] + dy * k, ada[2]], heading: Math.atan2(dy, dx) };
}
