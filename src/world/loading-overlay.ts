// Minimal loading screen for the level (system fonts only). Weighted stages → one progress bar; the boot card's
// status line (BootHandoff.status) mirrors the label so automation/logs see the same text.

export interface LoadStage {
  id: string;
  label: string;
  weight: number;
}

export class LoadingOverlay {
  readonly el: HTMLDivElement;
  private bar: HTMLDivElement;
  private text: HTMLDivElement;
  private stages: LoadStage[];
  private frac = new Map<string, number>();
  private status: ((t: string) => void) | null;
  private last = '';

  constructor(stages: LoadStage[], status: ((t: string) => void) | null = null) {
    this.stages = stages;
    this.status = status;
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '35',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '14px',
      background: '#050505',
      color: '#cfc8b8',
      font: '13px/1.4 ui-serif, Georgia, "Times New Roman", serif',
      letterSpacing: '0.08em',
    } as Partial<CSSStyleDeclaration>);
    const title = document.createElement('div');
    title.textContent = 'THE KEEPING';
    Object.assign(title.style, { font: '400 22px/1 ui-serif, Georgia, serif', letterSpacing: '0.4em', color: '#e6dfcf' });
    const track = document.createElement('div');
    Object.assign(track.style, { width: 'min(360px, 70vw)', height: '2px', background: '#1c1a17', overflow: 'hidden' });
    const bar = document.createElement('div');
    Object.assign(bar.style, { width: '0%', height: '100%', background: '#9a8f78', transition: 'width .2s linear' });
    track.appendChild(bar);
    const text = document.createElement('div');
    Object.assign(text.style, { color: '#8d877b', fontSize: '12px', minHeight: '1.4em', fontFamily: 'system-ui, sans-serif', letterSpacing: '0.04em' });
    el.append(title, track, text);
    document.body.appendChild(el);
    this.el = el;
    this.bar = bar;
    this.text = text;
  }

  /** Stage progress 0..1 with an optional detail label. */
  set(id: string, f: number, detail?: string): void {
    this.frac.set(id, Math.max(0, Math.min(1, f)));
    const st = this.stages.find((s) => s.id === id);
    const total = this.stages.reduce((a, s) => a + s.weight, 0);
    const done = this.stages.reduce((a, s) => a + s.weight * (this.frac.get(s.id) ?? 0), 0);
    this.bar.style.width = `${((done / total) * 100).toFixed(1)}%`;
    const label = `${st?.label ?? id}${detail ? ` — ${detail}` : ''}`;
    this.text.textContent = label;
    if (label !== this.last) {
      this.last = label;
      this.status?.(`${label} (${Math.round((done / total) * 100)}%)`);
    }
  }

  remove(): void {
    this.el.remove();
  }
}
