// Keyboard + mouse input. Keys by KeyboardEvent.code (layout-independent: WASD is physical position).
// Mouse look uses pointer-lock movement deltas, accumulated until consumed once per frame.
// Pause is driven by `pointerlockchange` (browsers exit pointer lock on Esc and often swallow that keydown).

export class Input {
  readonly down = new Set<string>();
  private pressed = new Set<string>();
  private dx = 0;
  private dy = 0;
  locked = false;
  /** Called when pointer lock is lost (Esc, alt-tab, …). */
  onLockLost: (() => void) | null = null;
  onLockGained: (() => void) | null = null;
  private readonly target: HTMLElement;
  private readonly offs: Array<() => void> = [];

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
      if (this.locked && (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab')) e.preventDefault();
    });
    on('keyup', (e) => {
      this.down.delete(e.code);
    });
    on('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    on('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.target;
      if (was && !this.locked) {
        this.down.clear();
        this.dx = this.dy = 0;
        this.onLockLost?.();
      } else if (!was && this.locked) {
        this.onLockGained?.();
      }
    });
    const blur = () => this.down.clear();
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

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True once per physical press (cleared by endFrame()). */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Mouse delta since the last call (pixels). */
  consumeMouse(): { dx: number; dy: number } {
    const r = { dx: this.dx, dy: this.dy };
    this.dx = this.dy = 0;
    return r;
  }

  endFrame(): void {
    this.pressed.clear();
  }

  dispose(): void {
    for (const off of this.offs) off();
  }
}

function isTextField(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
}
