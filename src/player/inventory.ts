// Inventory (silent items: hammer, shears, locket, jerry can …) and the journal stub (documents re-readable
// with Tab: guest book, portrait, ledger, letter, ticket). Pure state + a minimal DOM overlay for the journal.

import type { GameContext } from '../game/context.ts';
import { PENS, drawGuestBook, drawPage, type GuestRow } from '../render/handwriting.ts';

export interface Item {
  id: string;
  label: string;
  /** Prop id the item was taken from (hidden in the world when taken). */
  propId?: string;
}

export class Inventory {
  readonly items = new Map<string, Item>();
  private ctx: GameContext;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  add(item: Item): void {
    if (this.items.has(item.id)) return;
    this.items.set(item.id, item);
    this.ctx.flags.set(`has_${item.id}`, true);
    this.ctx.events.emit('flag', { name: `has_${item.id}`, value: true });
  }

  remove(id: string): void {
    if (!this.items.delete(id)) return;
    this.ctx.flags.set(`has_${id}`, false);
    this.ctx.events.emit('flag', { name: `has_${id}`, value: false });
  }

  snapshot(): string[] {
    return [...this.items.keys()];
  }
}

export interface JournalEntry {
  id: string;
  title: string;
  text: string;
  /** Guest book: structured rows for the ruled ledger renderer. */
  lines?: GuestRow[];
}

/** One document page in our own handwriting (the reading overlay and the journal share it). */
export function drawDocumentPage(g: CanvasRenderingContext2D, w: number, h: number, doc: { id: string; title: string; text: string; lines?: GuestRow[] }): void {
  if (doc.lines && doc.lines.length) {
    drawGuestBook(g, w, h, doc.lines, { seed: 1977 });
    return;
  }
  const pencil = doc.id === 'ticket' || doc.id === 'can_plate' || doc.id === 'portrait' || doc.id === 'pump_photo' || doc.id.startsWith('ledger');
  drawPage(g, w, h, `${doc.title}\n\n${doc.text}`, { pen: pencil ? PENS.pencil : PENS.ink, em: Math.round(w / 24), lineGap: 1.8, ruled: doc.id.startsWith('ledger'), seed: doc.id.length * 977 });
}

/**
 * The journal (Tab): every document read so far, re-readable as the handwritten page it was found on. ← / → (or the
 * mouse wheel, or 1–9) turn the pages; Tab / Esc closes. Newest entry opens first.
 */
export class Journal {
  readonly entries: JournalEntry[] = [];
  private el: HTMLDivElement | null = null;
  private page = 0;
  private canvas: HTMLCanvasElement | null = null;
  private list: HTMLDivElement | null = null;
  private readonly onKey = (e: KeyboardEvent) => {
    if (!this.el) return;
    if (e.code === 'ArrowRight' || e.code === 'PageDown') this.turn(1);
    else if (e.code === 'ArrowLeft' || e.code === 'PageUp') this.turn(-1);
    else if (e.code === 'Escape') this.close();
    else if (/^Digit[1-9]$/.test(e.code)) this.show(Number(e.code.slice(5)) - 1);
  };
  private readonly onWheel = (e: WheelEvent) => {
    if (this.el && Math.abs(e.deltaY) > 4) this.turn(e.deltaY > 0 ? 1 : -1);
  };

  add(e: JournalEntry): void {
    const i = this.entries.findIndex((x) => x.id === e.id);
    if (i < 0) this.entries.push(e);
    else this.entries[i] = e; // the sting's guest book replaces the first one
    if (this.el) this.render();
  }

  get open(): boolean {
    return !!this.el;
  }

  toggle(): void {
    if (this.el) this.close();
    else this.openJournal();
  }

  close(): void {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    this.canvas = null;
    this.list = null;
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('wheel', this.onWheel);
  }

  private turn(d: number): void {
    this.show(this.page + d);
  }

  private show(i: number): void {
    if (!this.entries.length) return;
    this.page = Math.max(0, Math.min(this.entries.length - 1, i));
    this.render();
  }

  private openJournal(): void {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '25',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '22px',
      padding: '16px',
      background: 'radial-gradient(ellipse at 50% 50%, rgba(8,7,6,.72), rgba(0,0,0,.92))',
      pointerEvents: 'none',
      boxSizing: 'border-box',
    } as Partial<CSSStyleDeclaration>);
    const list = document.createElement('div');
    Object.assign(list.style, { width: '190px', maxWidth: '30vw', color: '#b8b0a0', font: '13px/1.7 ui-serif, Georgia, serif', letterSpacing: '.02em' } as Partial<CSSStyleDeclaration>);
    const right = document.createElement('div');
    Object.assign(right.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: 'calc(100vw - 260px)' } as Partial<CSSStyleDeclaration>);
    const cv = document.createElement('canvas');
    cv.width = 720;
    cv.height = 960;
    Object.assign(cv.style, { width: 'min(460px, calc(100vw - 260px), 62vh)', height: 'auto', boxShadow: '0 14px 48px rgba(0,0,0,.8)' } as Partial<CSSStyleDeclaration>);
    const hint = document.createElement('div');
    hint.textContent = '\u2190 \u2192  turn the page     Tab  close';
    Object.assign(hint.style, { marginTop: '12px', color: 'rgba(230,223,207,.55)', font: '12px system-ui, sans-serif', letterSpacing: '.12em' } as Partial<CSSStyleDeclaration>);
    right.append(cv, hint);
    el.append(list, right);
    document.body.appendChild(el);
    this.el = el;
    this.canvas = cv;
    this.list = list;
    this.page = Math.max(0, this.entries.length - 1);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    this.render();
  }

  private render(): void {
    const cv = this.canvas;
    const list = this.list;
    if (!cv || !list) return;
    list.replaceChildren();
    const head = document.createElement('div');
    head.textContent = 'JOURNAL';
    Object.assign(head.style, { letterSpacing: '.35em', fontSize: '12px', color: '#8f846e', marginBottom: '10px' });
    list.appendChild(head);
    this.entries.forEach((e, i) => {
      const r = document.createElement('div');
      r.textContent = `${i + 1}  ${e.title}`;
      r.style.color = i === this.page ? '#efe6d2' : '#8d877b';
      list.appendChild(r);
    });
    const g = cv.getContext('2d')!;
    const e = this.entries[this.page];
    if (!e) {
      drawPage(g, cv.width, cv.height, 'Nothing written down yet.', { pen: PENS.pencil, em: 30, seed: 7 });
      return;
    }
    drawDocumentPage(g, cv.width, cv.height, e);
  }
}
