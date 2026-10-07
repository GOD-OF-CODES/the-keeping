// Keyboard + mouse input. Keys by KeyboardEvent.code (layout-independent: WASD is physical position).
// Mouse look uses pointer-lock movement deltas, accumulated until consumed once per frame.
// Pause is driven by `pointerlockchange` (browsers exit pointer lock on Esc and often swallow that keydown).
//
// Overlays (journal, reading page, pause) BLOCK gameplay input through live predicates (`addBlocker`): while any
// returns true, isDown / wasPressed / consumeMouse report nothing, and every key or button pressed meanwhile is
// SWALLOWED until it is released — so ← / → turning a journal page never strafes, not even after the page closes
// with the arrow still held. Overlays read their own keys with `uiPressed` (raw, never blocked).

export class Input {
  readonly down = new Set<string>();
  private pressed = new Set<string>();
  private dx = 0;
  private dy = 0;
  locked = false;
  /** Called when pointer lock is lost (Esc, alt-tab, …). */
  onLockLost: (() => void) | null = null;
  onLockGained: (() => void) | null = null;
  /** The browser refused pointer lock after a request (e.g. the post-Esc cooldown, or a 'pointerlockerror'). */
  onLockError: (() => void) | null = null;
  private readonly target: HTMLElement;
  private readonly offs: Array<() => void> = [];
  private readonly blockers: Array<() => boolean> = [];
  /** Codes pressed while blocked: ignored by gameplay until their keyup / mouseup. */
  private readonly swallowed = new Set<string>();

  constructor(target: HTMLElement) {
    this.target = target;
    const on = <K extends keyof DocumentEventMap>(type: K, fn: (e: DocumentEventMap[K]) => void) => {
      document.addEventListener(type, fn as EventListener);
      this.offs.push(() => document.removeEventListener(type, fn as EventListener));
    };
    on('keydown', (e) => {
      if (e.repeat) return;
      if (isTextField(e.target)) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
      if (this.blocked) this.swallowed.add(e.code);
      if (this.locked && (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab')) e.preventDefault();
    });
    on('keyup', (e) => {
      this.down.delete(e.code);
      this.swallowed.delete(e.code);
    });
    on('mousemove', (e) => {
      if (!this.locked || this.blocked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    // Mouse buttons as pseudo-codes 'Mouse0' (left), 'Mouse2' (right: raise the locket) — only while locked.
    on('mousedown', (e) => {
      if (!this.locked) return;
      this.down.add(`Mouse${e.button}`);
      this.pressed.add(`Mouse${e.button}`);
      if (this.blocked) this.swallowed.add(`Mouse${e.button}`);
    });
    on('mouseup', (e) => {
      this.down.delete(`Mouse${e.button}`);
      this.swallowed.delete(`Mouse${e.button}`);
    });
    on('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
    on('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.target;
      if (was && !this.locked) {
        this.down.clear();
        this.swallowed.clear();
        this.dx = this.dy = 0;
        this.onLockLost?.();
      } else if (!was && this.locked) {
        this.onLockGained?.();
      }
    });
    on('pointerlockerror', () => this.onLockError?.());
    const blur = () => {
      this.down.clear();
      this.swallowed.clear();
    };
    window.addEventListener('blur', blur);
    this.offs.push(() => window.removeEventListener('blur', blur));
  }

  /** Must be called from a user gesture. Resolves false when the browser refuses (e.g. post-Esc cooldown). */
  async requestLock(): Promise<boolean> {
    try {
      // Chrome returns a Promise (rejects during the cooldown after Esc); other browsers return undefined.
      const r = (this.target.requestPointerLock as (o?: object) => Promise<void> | void).call(this.target, { unadjustedMovement: false });
      if (r && typeof (r as Promise<void>).then === 'function') await r;
      return true;
    } catch {
      return false;
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /**
   * Block gameplay input while `when()` is true (an overlay is open). Live: checked on every key event and query,
   * so a key pressed between the overlay opening and the next frame is already swallowed. Returns the remover.
   */
  addBlocker(when: () => boolean): () => void {
    this.blockers.push(when);
    return () => {
      const i = this.blockers.indexOf(when);
      if (i >= 0) this.blockers.splice(i, 1);
    };
  }

  /** An overlay owns the keyboard / mouse right now. */
  get blocked(): boolean {
    for (const b of this.blockers) if (b()) return true;
    return false;
  }

  /** Gameplay: held, not blocked, and not a key that was pressed while an overlay was open. */
  isDown(code: string): boolean {
    return this.down.has(code) && !this.swallowed.has(code) && !this.blocked;
  }

  /**
   * Gameplay: true once per physical press (cleared by endFrame()); never while blocked, and never for a press made
   * under an overlay that closed later in the same frame (the E / Tab that closed it must not also act).
   */
  wasPressed(code: string): boolean {
    return this.pressed.has(code) && !this.swallowed.has(code) && !this.blocked;
  }

  /** Overlays (journal toggle, closing a page): true once per physical press, blocked or not. */
  uiPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Mouse delta since the last call (pixels); zero (and drained) while blocked. */
  consumeMouse(): { dx: number; dy: number } {
    const blocked = this.blocked;
    const r = { dx: blocked ? 0 : this.dx, dy: blocked ? 0 : this.dy };
    this.dx = this.dy = 0;
    return r;
  }

  /** Swallow this frame's press (a key that closed an overlay must not also interact). */
  consume(code: string): void {
    this.pressed.delete(code);
  }

  endFrame(): void {
    this.pressed.clear();
  }

  dispose(): void {
    for (const off of this.offs) off();
  }
}

function isTextField(t: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined') return false; // no DOM (node tests)
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
}
