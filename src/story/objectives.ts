// Objective line (top-left HUD, src/ui/objective.ts): the player's next step, derived from the story state. PURE.
// User request 2026-10-12: "a small next objective on the top left which keeps guiding players on what to do".
// It follows the same route as Beats.hintTarget() (the 90 s lightning hint): `target` is that interactable, so the
// line and the hint never disagree (tests/objectives.test.ts). Text is short, in-world and imperative; `detail` names
// the one non-obvious mechanic of the step (breath, thunder, the locket's right mouse).

import { beatIndex, boardsPried, flag, type EscapeState } from './escape-state.ts';

export interface Objective {
  /** Stable id (changes when the step changes: the HUD fades the new line in). */
  id: string;
  text: string;
  detail?: string;
  /** The interactable Beats.hintTarget() points at for this step (null = none). */
  target: string | null;
}

/** null while there is nothing to do (cutscenes, the death cutaway, the drive in, the ending). */
export function objectiveFor(s: EscapeState): Objective | null {
  if (s.cutscene || s.dead) return null;
  const f = (n: string) => flag(s, n);
  switch (s.beat) {
    case 'B02':
      if (f('front_door_open')) return { id: 'b02_enter', text: 'Go inside', target: 'D_FRONT' };
      if (f('rang_front_bell')) return { id: 'b02_wait', text: 'Wait at the door', target: 'D_FRONT' };
      if (f('knocked')) return { id: 'b02_bell', text: 'Ring the doorbell', detail: 'The bell pull beside the door', target: 'P_BELL_KNOB' };
      return { id: 'b02_knock', text: 'Ask at the house for help', detail: 'Knock on the front door', target: 'P_KNOCKER' };
    case 'B03':
      return { id: 'b03_parlor', text: 'Find whoever is home', detail: 'The sound came from the room on the right', target: 'D_PARLOR' };
    case 'B04':
      return { id: 'b04_run', text: 'Run upstairs', target: 'P_ARMOIRE' };
    case 'B05':
      if (f('first_hide_done')) return { id: 'b05_sneak', text: 'Slip into the bedroom down the hall', detail: 'Keep to the runner. Bare boards creak.', target: 'D_HARLAN' };
      return { id: 'b05_hide', text: 'Hide in the armoire', detail: 'Hold Space to hold your breath when she is close', target: 'P_ARMOIRE' };
    case 'B06':
      if (f('ledger_read')) return { id: 'b06_hammer', text: 'Take the hammer', target: 'P_HAMMER' };
      return { id: 'b06_search', text: 'Search the bedroom', detail: 'Read the ledger on the desk', target: 'P_LEDGER' };
    case 'B08': {
      if (s.bellPulls === 0 && !f('bell_used'))
        return { id: 'b08_lure', text: 'Lure her downstairs', detail: 'Pull the bell rope in the bedroom', target: 'P_BELL_PULL' };
      const n = boardsPried(s);
      if (n < 3) {
        const next = [1, 2, 3].find((k) => !f(`ada_board_${k}`)) ?? 1;
        return {
          id: `b08_boards_${n}`,
          text: `Pry the boards off her door (${n}/3)`,
          detail: 'Only while the thunder rolls. Ring the bell again if she comes back.',
          target: `board_${next}`,
        };
      }
      return { id: 'b08_enter', text: 'Go into her room', target: 'D_ADA' };
    }
    case 'B09':
      if (!f('letter_read')) return { id: 'b09_letter', text: 'Search her sewing room', detail: 'Read the letter', target: 'P_LETTER' };
      if (!f('has_shears')) return { id: 'b09_shears', text: 'Find something to cut with', target: 'P_SHEARS' };
      if (!f('hem_cut')) return { id: 'b09_hem', text: 'Cut open the hem of the wedding dress', target: 'P_DRESS' };
      if (!f('has_locket') && !f('locket_given')) return { id: 'b09_locket', text: 'Take the locket', target: 'P_LOCKET' };
      if (f('dress_visit_done'))
        return { id: 'b09_back', text: 'Climb out through the back of the wardrobe', detail: "The servants' stair leads down to the kitchen", target: 'P_ADA_WARDROBE' };
      return { id: 'b09_wardrobe', text: 'Hide in the wardrobe', detail: 'She is coming for the dress', target: 'P_ADA_WARDROBE' };
    case 'B10':
      if (!f('has_can')) return { id: 'b10_can', text: 'Find gas for the car', detail: 'The cans in the kitchen', target: 'P_JERRY_10' };
      return { id: 'b10_bolt', text: 'Unbolt the back passage', target: 'D_PASSAGE' };
    case 'B11':
      if (f('finale_started')) return { id: 'b11_still', text: 'Hold still. Let her look.', target: 'D_PARLOR' };
      return {
        id: 'b11_face',
        text: 'Face her in the front hall',
        detail: 'Hold the open locket up in your light (right mouse) and let her come close',
        target: 'D_PARLOR',
      };
    case 'B12':
      if (f('has_can')) return { id: 'b12_car', text: 'Get back to your car', detail: 'Fill the tank and leave', target: 'P_CAR_ROW' };
      return { id: 'b12_can', text: 'Find gas for the car', detail: 'The cans in the kitchen', target: 'P_JERRY_10' };
    default:
      // B01 (the drive), B07 (C3), B13 (the ending): cutscenes only
      return null;
  }
}

/** Steps after which the line is re-emphasised when the player has made no progress for this long (s). */
export const OBJECTIVE_REMIND_S = 45;

/** True once the story has handed the player control at least once (the line never shows over the title drive). */
export function objectivesActive(s: EscapeState): boolean {
  return beatIndex(s.beat) >= beatIndex('B02') && beatIndex(s.beat) <= beatIndex('B12');
}
