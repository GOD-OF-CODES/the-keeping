// Hide rules (DESIGN rule 5): a hide is SAFE unless
//   (a) she had sight of you within 2 s of your entering it, or
//   (b) you are audible within 2 m of her (gasp 3 m, post-sprint panting 2.5 m, any other player noise), or
//   (c) the hold-breath rule: while she LOOKs at your slats (head lifted, ≤ 2 m) you must hold your breath —
//       unheld breathing is a 1.2 m sound at the slats. Holding past 4.5 s ends in a gasp (the controller emits it
//       as a noise), which is (b). The breath lasts ≤ 7 s; her slat look is 1.2 s wind-up + 3 s, so holding from the
//       crack is always enough.
// The FIRST hide of the game (B05, taught by demonstration) can't be failed, whichever hide it is. The layout's
// `unfailable` flag on H_ARMOIRE is honoured only until that first hide is over (DESIGN: "The first hide can't be
// failed"; later armoire uses follow the normal rule).

import type { HideDef } from '../shared/layout-types.ts';
import { TUNING } from './tuning.ts';

export type HideVerdict = 'safe' | 'seen_entering' | 'audible' | 'breath';

/** Rule (a): seen within the 2 s window before (or at) entry. */
export function seenEntering(entryT: number, lastSeenT: number): boolean {
  return Number.isFinite(lastSeenT) && entryT - lastSeenT <= TUNING.hide.seenWindowS && lastSeenT <= entryT + 0.05;
}

/** Rule (b): a noise from inside the hide that she hears (attenuated radius covers her) while ≤ 2 m away. */
export function audibleFromHide(adaDist: number, effectiveRadius: number): boolean {
  return adaDist <= TUNING.hide.audibleDist && adaDist <= effectiveRadius;
}

/** Rule (c): she is looking at the slats (head lifted, ≤ 2 m) and the breath is not held. */
export function breathGivesAway(slatLook: boolean, adaDist: number, holdingBreath: boolean): boolean {
  return slatLook && !holdingBreath && adaDist <= TUNING.hide.audibleDist;
}

export interface HideStatus {
  hideId: string;
  entryT: number;
  seenOnEntry: boolean;
  unfailable: boolean;
  /** Set once a rule fails; she opens the hide when she gets to it. */
  found: HideVerdict | null;
}

/** Tracks the player's current hide and the first-hide exemption. */
export class HideTracker {
  current: HideStatus | null = null;
  firstHideDone = false;
  private readonly hides: Map<string, HideDef>;

  constructor(hides: readonly HideDef[]) {
    this.hides = new Map(hides.map((h) => [h.id, h]));
  }

  hide(id: string): HideDef | undefined {
    return this.hides.get(id);
  }

  enter(hideId: string, t: number, lastSeenT: number): HideStatus {
    const unfailable = !this.firstHideDone; // the first hide of the game (B05)
    const seen = seenEntering(t, lastSeenT);
    this.current = { hideId, entryT: t, seenOnEntry: seen, unfailable, found: null };
    if (seen && !unfailable) this.current.found = 'seen_entering';
    return this.current;
  }

  exit(): void {
    this.current = null;
  }

  /** Mark the first hide as spent (the brain calls it when the B05 slat demo ends). */
  spendFirstHide(): void {
    this.firstHideDone = true;
    if (this.current) this.current.unfailable = false;
  }

  /** Record a failed rule (ignored while unfailable). Returns true when the hide is now found. */
  fail(v: HideVerdict): boolean {
    const c = this.current;
    if (!c || c.unfailable) return false;
    if (!c.found) c.found = v;
    return true;
  }
}
