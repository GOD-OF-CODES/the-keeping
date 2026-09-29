// FPS overlay (DOM): average / 1% low / p99, refreshed 4× per second. Toggled by settings.showFps.

import { FpsMeter, type FpsStats } from './fps-meter.ts';

export class FpsOverlay {
  readonly meter = new FpsMeter();
  readonly el: HTMLDivElement;
  private visible = false;
  private timer = 0;
  private extra: () => string = () => '';
  last: FpsStats = this.meter.stats();

  constructor(parent: HTMLElement = document.body) {
    const el = document.createElement('div');
    el.className = 'tk-fps';
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
      position: 'fixed',
      top: '10px',
      left: '10px',
      zIndex: '50',
      padding: '6px 9px',
      font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      color: '#cfc8b6',
      background: 'rgba(8,7,6,0.62)',
      border: '1px solid rgba(207,200,182,0.14)',
      borderRadius: '4px',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      display: 'none',
      fontVariantNumeric: 'tabular-nums',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(el);
    this.el = el;
    // Stats are refreshed 4×/s even while hidden so `__game` / tests can read them.
    this.timer = window.setInterval(() => this.refresh(), 250);
  }

  /** Extra line provider (backend, preset, resolution …). */
  setExtra(fn: () => string): void {
    this.extra = fn;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.style.display = v ? 'block' : 'none';
    if (v) this.refresh();
  }

  frame(t: number): void {
    this.meter.frame(t);
  }

  reset(): void {
    this.meter.reset();
  }

  private refresh(): void {
    this.last = this.meter.stats();
    if (!this.visible) return;
    const s = this.last;
    const f = (x: number) => (x > 0 ? x.toFixed(0).padStart(3) : '  –');
    const extra = this.extra();
    this.el.textContent = `${f(s.avg)} fps  ${s.avgMs > 0 ? s.avgMs.toFixed(1) : '–'} ms\n1% low ${f(s.low1)}   p99 ${f(s.p99)}` + (extra ? `\n${extra}` : '');
  }

  dispose(): void {
    clearInterval(this.timer);
    this.el.remove();
  }
}
