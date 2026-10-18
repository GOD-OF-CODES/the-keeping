// Objective line, top-left (DOM, system fonts, no three.js). Shows src/story/objectives.ts's current step: a new step
// fades in bright, then settles to a quiet line so it never competes with the picture; it brightens again as a reminder
// when the player has made no progress for a while. Hidden in cutscenes, the death cutaway, while reading a page and
// when Settings.showObjective is off. Sits below the FPS counter when that is shown (both live top-left).

export interface ObjectiveView {
  id: string;
  text: string;
  detail?: string;
}

const STYLE_ID = 'tk-objective-style';
const CSS = `
.tk-obj{position:fixed;left:max(16px,2.2vw);top:max(14px,2.2vh);z-index:21;pointer-events:none;max-width:min(36ch,calc(100vw - 32px));
  padding:.1em 0 .15em .75em;border-left:2px solid rgba(233,226,211,.38);
  font:500 clamp(13px,1.05vw,16px)/1.35 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  color:#ebe4d5;text-shadow:0 1px 3px rgba(0,0,0,.95),0 0 14px rgba(0,0,0,.65);letter-spacing:.01em;
  opacity:0;transform:translateX(-6px);transition:opacity .45s ease,transform .45s ease}
.tk-obj.is-on{opacity:.62;transform:none}
.tk-obj.is-on.is-fresh{opacity:1}
.tk-obj.is-cut{transition:none}
.tk-obj__label{display:block;font-size:.68em;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:rgba(214,206,190,.62);margin-bottom:.18em}
.tk-obj__detail{display:block;font-size:.84em;font-weight:400;color:rgba(224,216,200,.74);margin-top:.15em}
@media (prefers-reduced-motion: reduce){.tk-obj{transition:none;transform:none}}
`;

/** Seconds a new (or reminded) step stays at full brightness before settling. */
const FRESH_S = 7;
/** Cross-fade: the old line fades out for this long before the new text is swapped in. */
const SWAP_S = 0.45;
/** Debounce (ship-verify hunter 2026-10-12: the line flashed on/off on the 1–3 frames between a story trigger and the
 *  cutscene taking the camera, before C2 / C2b / C4a): the line appears only after `show` has held this long. */
const SHOW_HOLD_S = 0.4;
/** SMOOTH-FIX (#145, hunt F10): a NEW step waits this long (while the line may show) before it fades in. The step changes
 *  with the beat, often just before a cutscene takes the camera — the B03 hall → C2 0.47 s later, B05 → C2b 0.53 s — and
 *  the fresh full-brightness line faded in under the cut (scratch/fix/diag C2-1 f0000–f0005: 0 → 1036 lit px in 0.4 s,
 *  then gone). Now it comes up after the cutscene instead. */
const REVEAL_S = 1.0;

export class ObjectiveHud {
  readonly el: HTMLDivElement;
  private readonly textEl: HTMLSpanElement;
  private readonly detailEl: HTMLSpanElement;
  private shownId: string | null = null;
  private pending: ObjectiveView | null = null;
  private swapT = 0;
  private freshT = 0;
  private visible = false;
  private topPx = -1;
  private showT = 0;
  private revealT = 0;
  /** Seconds since the line was last set off (its CSS fade-out takes SWAP_S). */
  private hideT = 1e9;

  constructor(parent: HTMLElement = document.body) {
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const el = document.createElement('div');
    el.className = 'tk-obj';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    const label = document.createElement('span');
    label.className = 'tk-obj__label';
    label.textContent = 'Objective';
    this.textEl = document.createElement('span');
    this.detailEl = document.createElement('span');
    this.detailEl.className = 'tk-obj__detail';
    el.append(label, this.textEl, this.detailEl);
    parent.appendChild(el);
    this.el = el;
  }

  /**
   * Per frame. `o` = the current step (null = nothing to do); `show` = allowed on screen now (no cutscene, death,
   * page, setting off); `remind` = brighten the current line again (no progress for a while); `topPx` = where the
   * line starts (below the FPS counter when it is on).
   */
  update(dt: number, o: ObjectiveView | null, show: boolean, remind: boolean, topPx: number | null): void {
    if (topPx !== this.topPx) {
      this.topPx = topPx ?? -1;
      this.el.style.top = topPx == null ? '' : `${topPx}px`;
    }
    this.showT = show ? this.showT + dt : 0;
    if (!this.visible) this.hideT += dt;
    if (show && this.revealT > 0) this.revealT -= dt;
    // re-verify r1 (2026-10-12): a cut (cutscene / fade / page) takes the line off AT ONCE — no 0.45 s fade under the
    // cutscene's first frames; the fade is only for step changes in play
    this.el.classList.toggle('is-cut', !show);
    if (o && o.id !== this.shownId && o.id !== this.pending?.id) {
      // a new step: fade the old line out first (if one is up — or still fading out: SMOOTH-FIX #145, the text was swapped
      // mid-fade when the line had just been hidden, '(0/3)' → '(2/3)' in one frame before C4a), then swap; it fades in
      // bright REVEAL_S later
      this.pending = o;
      this.swapT = this.visible && this.shownId ? SWAP_S : this.shownId ? Math.max(0, SWAP_S - this.hideT) : 0;
      this.setOn(false);
    }
    if (this.pending) {
      this.swapT -= dt;
      if (this.swapT <= 0) {
        this.apply(this.pending);
        this.pending = null;
        this.freshT = FRESH_S;
        this.revealT = REVEAL_S;
      }
    }
    // computed AFTER the swap (re-verify r1: computed before it, the line switched on for the one frame the new step's
    // text was applied, before revealT held it back)
    const want = show && !!o && this.showT >= SHOW_HOLD_S && this.revealT <= 0;
    if (remind && this.freshT <= 0 && want && !this.pending) this.freshT = FRESH_S;
    if (this.freshT > 0 && want) this.freshT -= dt;
    this.el.classList.toggle('is-fresh', this.freshT > 0);
    this.setOn(want && !this.pending);
  }

  private apply(o: ObjectiveView): void {
    this.shownId = o.id;
    this.textEl.textContent = o.text;
    this.detailEl.textContent = o.detail ?? '';
    this.detailEl.style.display = o.detail ? '' : 'none';
  }

  private setOn(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    if (!on) this.hideT = 0;
    this.el.classList.toggle('is-on', on);
  }

  dispose(): void {
    this.el.remove();
  }
}
