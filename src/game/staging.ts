// Pure staging rules for story-runtime (no three.js: unit-tested under node).

/**
 * Harlan is held frozen at the parlor table between C2 and C5 (beat indices 3..10 = B04..B11) whenever he is not
 * shown. Never while a cutscene runs (C3 / C5 hide him on purpose between their own cues) and never once C5 took
 * him (`harlan_taken`: C5 hides him at 21.6 s, while the beat is still B11 until its end handler runs).
 */
export const harlanHeldAtTable = (beatIndex: number, cutscene: string | null, harlanTaken: boolean): boolean =>
  !cutscene && !harlanTaken && beatIndex >= 3 && beatIndex <= 10;

/**
 * The end card's stacking: above the black fade (30) and the loading overlay (35), BELOW the pause menu (.tk-pause,
 * z 40). The card says "Esc  menu": at z 40 it was appended after the menu and covered it, so the menu opened
 * invisible and unclickable under a black title. The card also takes no pointer events: if the browser refuses the
 * pointer lock on Resume, the "click to continue" overlay (z 30) sits under the card and must still get the click.
 */
export const END_CARD_Z = 36;
