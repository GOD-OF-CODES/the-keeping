// Subtitles & captions overlay (DOM, system fonts). Word-timed reveal when timings exist (generated voice clips or
// the 2.7 words/s fallback); captions like "(ragged breathing)" render in italics. Pure DOM: no three.js.
//
// Two ways in:
//  - direct: `show({ speaker, text, words, durationMs })` — used by src/audio/voice.ts (has word timings),
//  - events: `attach(events)` listens to 'subtitle' (payload or null) for any other system (cutscenes, story);
//    a payload identical to the cue already showing is ignored (voice.ts emits the event too).

import type { EventBus, GameEvents } from '../core/events.ts';
import { fallbackTiming, revealCount, type TimedWord } from '../audio/voice-timing.ts';

export interface SubtitleCue {
  speaker: string;
  text: string;
  /** Word spans in seconds from cue start. Omit to reveal proportionally over durationMs. */
  words?: TimedWord[];
  durationMs: number;
  /** A non-speech caption (rendered italic, no speaker label unless given). */
  caption?: boolean;
}

const STYLE_ID = 'tk-subtitles-style';
const CSS = `
.tk-subs{position:fixed;left:0;right:0;bottom:7vh;display:flex;justify-content:center;pointer-events:none;z-index:40;padding:0 16px}
.tk-subs__cue{max-width:min(62ch,90vw);text-align:center;font:500 clamp(15px,1.55vw,22px)/1.38 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  color:#ece6da;background:rgba(8,8,10,.55);padding:.35em .8em .42em;border-radius:6px;letter-spacing:.005em;
  text-shadow:0 1px 2px rgba(0,0,0,.85);opacity:0;transform:translateY(4px);transition:opacity .22s ease,transform .22s ease}
.tk-subs__cue.is-on{opacity:1;transform:none}
.tk-subs__speaker{display:block;font-size:.68em;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#a99f8e;margin-bottom:.15em}
.tk-subs__w{opacity:.0;transition:opacity .16s linear}
.tk-subs__w.is-on{opacity:1}
.tk-subs__cue.is-caption{font-style:italic;color:#cfc8bb;background:rgba(8,8,10,.4)}
@media (prefers-reduced-motion: reduce){.tk-subs__cue,.tk-subs__w{transition:none}}
`;

export class Subtitles {
  readonly root: HTMLElement;
  private cueEl: HTMLElement;
  private current: { cue: SubtitleCue; start: number; spans: HTMLElement[]; words: TimedWord[]; shown: number; token: number } | null = null;
  private raf = 0;
  private token = 0;
  private pausedAt: number | null = null;
  private offs: (() => void)[] = [];
  enabled = true;
  captionsEnabled = true;

  constructor(parent: HTMLElement = document.body) {
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.root = document.createElement('div');
    this.root.className = 'tk-subs';
    this.root.setAttribute('aria-live', 'polite');
    this.root.setAttribute('role', 'status');
    this.cueEl = document.createElement('div');
    this.cueEl.className = 'tk-subs__cue';
    this.root.appendChild(this.cueEl);
    parent.appendChild(this.root);
  }

  /** Show a cue; returns a token for `clear(token)` (clearing a stale token is a no-op). */
  show(cue: SubtitleCue): number {
    if (cue.caption ? !this.captionsEnabled : !this.enabled) return -1;
    const token = ++this.token;
    this.cueEl.textContent = '';
    this.cueEl.classList.toggle('is-caption', !!cue.caption);
    if (cue.speaker) {
      const sp = document.createElement('span');
      sp.className = 'tk-subs__speaker';
      sp.textContent = cue.speaker;
      this.cueEl.appendChild(sp);
    }
    const words = cue.words?.length ? cue.words : this.proportional(cue);
    const spans: HTMLElement[] = [];
    words.forEach((w, i) => {
      const s = document.createElement('span');
      s.className = 'tk-subs__w';
      s.textContent = w.text;
      this.cueEl.appendChild(s);
      if (i < words.length - 1) this.cueEl.appendChild(document.createTextNode(' '));
      spans.push(s);
    });
    // captions appear whole
    if (cue.caption) spans.forEach((s) => s.classList.add('is-on'));
    this.current = { cue, start: performance.now(), spans, words, shown: cue.caption ? spans.length : 0, token };
    requestAnimationFrame(() => this.cueEl.classList.add('is-on'));
    this.tick();
    return token;
  }

  clear(token?: number): void {
    if (token !== undefined && this.current && this.current.token !== token) return;
    this.current = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.cueEl.classList.remove('is-on');
  }

  /** Listen for 'subtitle' and 'pause' events. */
  attach(events: EventBus<GameEvents>): void {
    let eventToken = -1;
    this.offs.push(
      events.on('subtitle', (p) => {
        if (!p) {
          if (eventToken >= 0) this.clear(eventToken);
          eventToken = -1;
          return;
        }
        const c = this.current?.cue;
        if (c && c.text === p.text && c.speaker === p.speaker) return; // already shown via the direct API
        eventToken = this.show({ speaker: p.speaker, text: p.text, durationMs: p.durationMs });
      }),
      events.on('pause', ({ paused }) => this.setPaused(paused)),
    );
  }

  setPaused(paused: boolean): void {
    if (paused && this.pausedAt === null) this.pausedAt = performance.now();
    else if (!paused && this.pausedAt !== null) {
      if (this.current) this.current.start += performance.now() - this.pausedAt;
      this.pausedAt = null;
      this.tick();
    }
  }

  dispose(): void {
    this.offs.forEach((f) => f());
    cancelAnimationFrame(this.raf);
    this.root.remove();
  }

  private proportional(cue: SubtitleCue): TimedWord[] {
    const f = fallbackTiming(cue.text);
    // squeeze/stretch the natural pacing into the cue's speech span
    const speech = Math.max(0.3, cue.durationMs / 1000 - 0.6);
    const k = f.speechSec > 0 ? Math.min(1, speech / f.speechSec) : 1;
    return f.words.map((w) => ({ text: w.text, start: w.start * k, end: w.end * k }));
  }

  private tick = (): void => {
    const c = this.current;
    if (!c || this.pausedAt !== null) return;
    const t = (performance.now() - c.start) / 1000;
    const n = revealCount(c.words, t);
    for (let i = c.shown; i < n; i++) c.spans[i]?.classList.add('is-on');
    c.shown = Math.max(c.shown, n);
    if (t * 1000 >= c.cue.durationMs) {
      this.clear(c.token);
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}
