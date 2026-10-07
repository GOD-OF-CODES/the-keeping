// Who owns the player's body right now — gameplay, a cutscene, the death cutaway or a reading page — and the story's
// full-screen fade. PURE (no three.js, no DOM): lifted verbatim out of src/game/story-runtime.ts (its bus reactions to
// cutscene:start / cutscene:end / player:death / player:respawn, the per-frame lock block and makeUi's fade maths) so
// tests/e2e-playthrough.test.ts can drive the exact same rules headlessly. story-runtime keeps every visual side effect
// (arms, props, tableau, audio) in its own listeners; this module only flips the enable flags and the fade.

import type { EventBus, GameEvents } from '../core/events.ts';

/** src/cutscenes/types.ts LockMode (repeated here so this module stays import-light). */
export type BodyLockMode = 'full' | 'look' | 'none';

/** The slice of PlayerController this module drives. */
export interface BodyPlayer {
  enabled: boolean;
  lookEnabled: boolean;
  breathAllowed: boolean;
}

export interface BodyControlDeps {
  events: EventBus<GameEvents>;
  player: BodyPlayer;
  /** Interactables (E / hold-E verbs). */
  interact: { enabled: boolean };
  /** HideSystem: the hide the player is in (null/undefined = none) and whether E / Space act on it. */
  hides: { readonly active: unknown; inputEnabled: boolean };
  /** The cutscene lane's player is plugged in (it owns the input lock); false = the Director's fallback timers. */
  hasCutscenePlayer(): boolean;
  /** Story fade to black (1) / back (0) over sec seconds. */
  fade(to: number, sec: number): void;
  /** Hold black after sec seconds of game time (after the death cutaway's own fade). */
  snapBlackAfter(sec: number): void;
}

export interface BodyControl {
  /** The Director cutscene running now (incl. 'death'), or null. */
  readonly cutscene: string | null;
  /**
   * Once per frame after the cutscene system's update. lock = the cutscene system's lock (null when the cutscene
   * lane failed to load); reading = a document page is on screen.
   */
  frame(lock: BodyLockMode | null, reading: boolean): void;
  /** A cutscene owns the body: gameplay verbs outside the controller (F torch, Tab journal) must not act. */
  inputLocked(lock: BodyLockMode | null): boolean;
  dispose(): void;
}

export function createBodyControl(d: BodyControlDeps): BodyControl {
  const { events, player, interact, hides } = d;
  let cutscene: string | null = null;
  const offs = [
    events.on('cutscene:start', ({ id }) => {
      cutscene = id;
      if (id === 'death') return;
      interact.enabled = false;
      if (d.hasCutscenePlayer()) return; // the cutscene bindings own the input lock
      player.enabled = false;
      if (id !== 'C2') player.lookEnabled = false; // C2: frozen at the threshold, but you may still look
    }),
    events.on('cutscene:end', ({ id }) => {
      if (cutscene === id) cutscene = null;
      if (id === 'death') return;
      if (!hides.active && !d.hasCutscenePlayer()) {
        player.enabled = true;
        player.lookEnabled = true;
      }
      interact.enabled = true;
    }),
    events.on('player:death', () => {
      if (!d.hasCutscenePlayer()) d.fade(1, 0.35); // the death cutaway fades to black itself
      else d.snapBlackAfter(2.2);
      player.enabled = false;
      player.lookEnabled = false;
    }),
    events.on('player:respawn', () => {
      player.enabled = true;
      player.lookEnabled = true;
      d.fade(0, 1.4);
    }),
  ];
  return {
    get cutscene() {
      return cutscene;
    },
    frame(lock, reading) {
      if (lock !== null) {
        if (lock !== 'none') interact.enabled = false;
        else if (!reading && !cutscene) interact.enabled = true;
      }
      // Space is skip AND breath: breath only when gameplay has the body (or in a hide), never under a cutscene lock
      const locked = (lock !== null && lock !== 'none') || (!!cutscene && cutscene !== 'death');
      hides.inputEnabled = !locked;
      player.breathAllowed = !locked && (!!hides.active || player.enabled);
    },
    inputLocked: (lock) => (lock !== null && lock !== 'none') || !!cutscene,
    dispose() {
      for (const f of offs) f();
      offs.length = 0;
    },
  };
}

/**
 * The story's black fade (death, respawn, the end card). Game-time driven: a paused game (dt 0) doesn't go black
 * behind the menu. `opacity` is what the fade element shows; `black` = the screen is (going) black, so she may be
 * relocated anywhere (playerCanSee → false).
 */
export class FadeState {
  opacity = 0;
  black = false;
  private from = 0;
  private to = 0;
  private t = 1;
  private len = 1;
  private snapIn = 0;

  fade(to: number, sec: number): void {
    this.from = this.opacity;
    this.to = to;
    this.t = 0;
    this.len = Math.max(0.01, sec);
    if (to >= 1) this.black = true;
  }

  /** After the death cutaway's own fade: hold black (our overlay) until the respawn fade-in. */
  snapBlackAfter(sec: number): void {
    this.snapIn = sec;
  }

  /** Hold black now (the end card). */
  hold(): void {
    this.opacity = 1;
    this.from = this.to = 1;
    this.t = 1;
    this.black = true;
  }

  /** Advance; returns true when `opacity` changed (write it to the element). */
  update(dt: number): boolean {
    let changed = false;
    if (this.snapIn > 0) {
      this.snapIn -= dt;
      if (this.snapIn <= 0) {
        this.opacity = 1;
        this.from = 1;
        this.to = 1;
        this.t = 1;
        this.black = true;
        changed = true;
      }
    }
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.len);
      this.opacity = this.from + (this.to - this.from) * this.t;
      changed = true;
      if (this.t >= 1 && this.to < 1) this.black = false;
    }
    return changed;
  }
}
