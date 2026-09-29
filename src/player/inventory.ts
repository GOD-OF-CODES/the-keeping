// Inventory (silent items: hammer, shears, locket, jerry can …) and the journal stub (documents re-readable
// with Tab: guest book, portrait, ledger, letter, ticket). Pure state + a minimal DOM overlay for the journal.

import type { GameContext } from '../game/context.ts';

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
}

export class Journal {
  readonly entries: JournalEntry[] = [];
  private el: HTMLDivElement | null = null;

  add(e: JournalEntry): void {
    if (!this.entries.some((x) => x.id === e.id)) this.entries.push(e);
  }

  get open(): boolean {
    return !!this.el;
  }

  toggle(): void {
    if (this.el) {
      this.el.remove();
      this.el = null;
      return;
    }
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      width: 'min(520px, calc(100% - 32px))',
      maxHeight: '70vh',
      overflowY: 'auto',
      zIndex: '25',
      padding: '22px 26px',
      background: 'rgba(14,12,10,.92)',
      color: '#d8d2c4',
      font: '15px/1.55 ui-serif, Georgia, serif',
      border: '1px solid #3a342c',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    const h = document.createElement('div');
    h.textContent = 'Journal';
    Object.assign(h.style, { letterSpacing: '.3em', textTransform: 'uppercase', fontSize: '13px', color: '#9a8f78', marginBottom: '12px' });
    el.appendChild(h);
    if (!this.entries.length) {
      const p = document.createElement('div');
      p.textContent = 'Nothing written down yet.';
      p.style.color = '#8d877b';
      el.appendChild(p);
    }
    for (const e of this.entries) {
      const t = document.createElement('div');
      t.textContent = e.title;
      Object.assign(t.style, { marginTop: '10px', color: '#e6dfcf' });
      const p = document.createElement('div');
      p.textContent = e.text;
      p.style.color = '#b8b0a0';
      el.append(t, p);
    }
    document.body.appendChild(el);
    this.el = el;
  }
}
