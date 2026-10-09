// C0's DOM cards (docs/C1-OPENING.md §3, §7.14): the date card ("Tuesday, 11 October 1994", small, centred low) and
// the byline under the title ("a game by Raj Vardhan Singh", smaller, its own fade). System serif stack only (no web
// fonts — CLAUDE.md). The title itself stays the overlay's big centred card; this adds the two other styles.
// Pure DOM, no three.js.

export type ExtraCardStyle = 'date' | 'byline';

const SERIF = 'ui-serif, Georgia, "Times New Roman", serif';

export class TitleCards {
  private readonly date: HTMLElement;
  private readonly byline: HTMLElement;

  constructor(parent: HTMLElement) {
    const el = (css: Partial<CSSStyleDeclaration>) => {
      const d = document.createElement('div');
      Object.assign(d.style, {
        position: 'absolute',
        left: '16px',
        right: '16px',
        textAlign: 'center',
        color: '#d9d2c3',
        opacity: '0',
        pointerEvents: 'none',
        zIndex: '2',
        ...css,
      });
      parent.appendChild(d);
      return d;
    };
    // low in frame, inside the bottom letterbox edge (12.8 vh bar)
    this.date = el({ bottom: '19vh', font: `400 clamp(13px,1.35vw,19px)/1.3 ${SERIF}`, letterSpacing: '.14em', transition: 'opacity 0.7s ease' });
    // under the centred title (the title's em is clamp(28px,5vw,64px))
    this.byline = el({ top: 'calc(50% + clamp(26px,3.6vw,48px))', font: `italic 400 clamp(13px,1.5vw,20px)/1.3 ${SERIF}`, letterSpacing: '.18em', transition: 'opacity 0.8s ease' });
  }

  /** Handles 'date' / 'byline' (returns true); a null 'title' also clears the byline (both fade together). */
  set(text: string | null, style: string): boolean {
    if (style === 'title' && !text) {
      this.show(this.byline, null);
      return false; // the overlay fades its title too
    }
    if (style === 'date') return this.show(this.date, text);
    if (style === 'byline') return this.show(this.byline, text);
    return false;
  }

  private show(el: HTMLElement, text: string | null): true {
    if (text) {
      el.textContent = text;
      requestAnimationFrame(() => (el.style.opacity = '1'));
    } else el.style.opacity = '0';
    return true;
  }
}
