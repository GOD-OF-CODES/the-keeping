// In-game pause menu (Esc / pointer-lock loss). Reuses the boot card's styles (boot.css stays in the document).
// Live settings: FPS counter, frame cap + divisor mode, reduced flash, mouse sensitivity, invert Y, FOV.
// Preset change is saved and "applies after reload" (renderer, MSAA and pipeline are fixed at creation).
// The full settings screen (volumes, captions …) belongs to the UI lane (src/ui/pause.ts) and will replace this.

import { PRESETS } from '../render/presets.ts';
import { PRESET_IDS, type FpsCap, type PresetId, type Settings } from '../shared/types.ts';

export interface PauseMenuHooks {
  onResume(): void;
  onChange(key: keyof Settings): void;
  onReloadWithPreset(id: PresetId): void;
  onRerunDeviceTest(): void;
  effectiveCapText(): string;
}

const CSS = `
.tk-pause { position: fixed; inset: 0; z-index: 40; display: none; align-items: center; justify-content: center;
  background: radial-gradient(80% 70% at 50% 45%, rgba(10,8,6,.55), rgba(0,0,0,.86)); backdrop-filter: blur(3px); }
.tk-pause.open { display: flex; }
.tk-pause-card { width: min(520px, calc(100% - 32px)); max-height: calc(100% - 32px); overflow-y: auto; }
.tk-pause-card .tk-opts { grid-template-columns: 1fr; margin-top: 4px; }
.tk-pause h2 { margin: 0 0 12px; font: 400 26px/1.1 var(--tk-serif); letter-spacing: .28em; text-transform: uppercase; color: #e6dfcf; text-align: center; }
.tk-range { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; align-items: center; }
.tk-range input { grid-column: 1 / -1; accent-color: var(--tk-accent); width: 100%; }
.tk-range output { color: var(--tk-dim); font-size: 12px; font-variant-numeric: tabular-nums; }
.tk-select { font: inherit; color: var(--tk-ink); background: #13110f; border: 1px solid var(--tk-line-strong); border-radius: 4px; padding: 4px 8px; }
.tk-pause .tk-actions { margin-top: 16px; }
.tk-pause .tk-start { padding: 12px 26px 12px 32px; font-size: 15px; }
.tk-pause-note { color: var(--tk-faint); font-size: 12px; }
.tk-click { position: fixed; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 10px;
  color: #d8d2c4; background: rgba(0,0,0,.45); cursor: pointer; font: italic 18px/1.4 ui-serif, Georgia, serif; letter-spacing: .06em; }
.tk-click small { font: 12px/1.4 system-ui, sans-serif; color: #8d877b; letter-spacing: .04em; font-style: normal; }
`;

export class PauseMenu {
  readonly el: HTMLDivElement;
  private open = false;
  private readonly capNote: HTMLSpanElement;

  constructor(settings: Settings, currentPreset: PresetId, hooks: PauseMenuHooks) {
    if (!document.getElementById('tk-pause-css')) {
      const st = document.createElement('style');
      st.id = 'tk-pause-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const el = document.createElement('div');
    el.className = 'tk-pause';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Paused');
    const card = document.createElement('div');
    card.className = 'tk-body tk-pause-card';
    el.appendChild(card);
    const h2 = document.createElement('h2');
    h2.textContent = 'Paused';
    card.appendChild(h2);

    const syncers: Array<() => void> = [];
    const opts = document.createElement('fieldset');
    opts.className = 'tk-opts';
    card.appendChild(opts);

    const toggle = (text: string, key: 'showFps' | 'fpsCapDivisorMode' | 'reducedFlash' | 'invertY') => {
      const l = document.createElement('label');
      l.className = 'tk-toggle';
      const i = document.createElement('input');
      i.type = 'checkbox';
      i.checked = settings[key];
      syncers.push(() => (i.checked = settings[key]));
      i.addEventListener('change', () => {
        settings[key] = i.checked;
        hooks.onChange(key);
        this.refresh();
      });
      const sw = document.createElement('span');
      sw.className = 'tk-switch';
      const tx = document.createElement('span');
      tx.className = 'tk-toggle-text';
      tx.textContent = text;
      l.append(i, sw, tx);
      opts.appendChild(l);
      return l;
    };

    toggle('Show FPS counter', 'showFps');

    const capRow = document.createElement('div');
    capRow.className = 'tk-cap';
    const capLabel = document.createElement('span');
    capLabel.className = 'tk-cap-label';
    capLabel.textContent = 'Frame-rate cap';
    const seg = document.createElement('div');
    seg.className = 'tk-seg';
    const btns: HTMLButtonElement[] = [];
    for (const [v, t] of [
      [30, '30'],
      [60, '60'],
      [0, 'Uncapped'],
    ] as Array<[FpsCap, string]>) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tk-seg-btn';
      b.textContent = t;
      b.dataset.cap = String(v);
      b.addEventListener('click', () => {
        settings.fpsCap = v;
        hooks.onChange('fpsCap');
        this.refresh();
      });
      btns.push(b);
      seg.appendChild(b);
    }
    capRow.append(capLabel, seg);
    opts.appendChild(capRow);
    const div = toggle('Match display refresh (divisor mode)', 'fpsCapDivisorMode');
    this.capNote = document.createElement('span');
    this.capNote.className = 'tk-hint';
    div.appendChild(this.capNote);
    toggle('Reduced flash', 'reducedFlash');

    const range = (text: string, key: 'mouseSensitivity' | 'fovDeg', min: number, max: number, step: number, fmt: (v: number) => string) => {
      const l = document.createElement('label');
      l.className = 'tk-range';
      const t = document.createElement('span');
      t.textContent = text;
      const out = document.createElement('output');
      out.textContent = fmt(settings[key]);
      const i = document.createElement('input');
      i.type = 'range';
      i.min = String(min);
      i.max = String(max);
      i.step = String(step);
      i.value = String(settings[key]);
      i.addEventListener('input', () => {
        settings[key] = Number(i.value);
        out.textContent = fmt(settings[key]);
        hooks.onChange(key);
      });
      l.append(t, out, i);
      opts.appendChild(l);
    };
    range('Mouse sensitivity', 'mouseSensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2) + '×');
    toggle('Invert mouse Y', 'invertY');
    range('Field of view', 'fovDeg', 60, 85, 1, (v) => `${v}°`);

    // Preset (applies after reload).
    const presetRow = document.createElement('div');
    presetRow.className = 'tk-cap';
    const pl = document.createElement('span');
    pl.className = 'tk-cap-label';
    pl.textContent = 'Graphics preset';
    const sel = document.createElement('select');
    sel.className = 'tk-select';
    for (const id of PRESET_IDS) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = PRESETS[id].label + (id === currentPreset ? ' (current)' : '');
      sel.appendChild(o);
    }
    sel.value = settings.preset;
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'tk-link';
    reload.textContent = 'Apply & reload';
    const note = document.createElement('span');
    note.className = 'tk-pause-note';
    const syncPreset = () => {
      reload.hidden = sel.value === currentPreset;
      note.textContent = sel.value === currentPreset ? '' : 'Applies after reload.';
    };
    sel.addEventListener('change', () => {
      settings.preset = sel.value as PresetId;
      hooks.onChange('preset');
      syncPreset();
    });
    reload.addEventListener('click', () => hooks.onReloadWithPreset(sel.value as PresetId));
    presetRow.append(pl, sel, reload, note);
    opts.appendChild(presetRow);
    syncPreset();

    const actions = document.createElement('div');
    actions.className = 'tk-actions';
    const rerun = document.createElement('button');
    rerun.type = 'button';
    rerun.className = 'tk-link';
    rerun.textContent = 'Re-run device test';
    rerun.addEventListener('click', () => hooks.onRerunDeviceTest());
    const resume = document.createElement('button');
    resume.type = 'button';
    resume.className = 'tk-start';
    resume.textContent = 'Resume';
    resume.addEventListener('click', () => hooks.onResume());
    actions.append(rerun, resume);
    card.appendChild(actions);

    document.body.appendChild(el);
    this.el = el;
    this.refresh = () => {
      for (const sync of syncers) sync();
      for (const b of btns) {
        const on = Number(b.dataset.cap) === settings.fpsCap;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      }
      this.capNote.textContent = hooks.effectiveCapText();
    };
    this.refresh();
  }

  refresh: () => void;

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.open = true;
    this.refresh();
    this.el.classList.add('open');
  }

  hide(): void {
    this.open = false;
    this.el.classList.remove('open');
  }
}

/** "Click to begin" overlay; resolves on click (a user gesture, so pointer lock can be requested). */
export function clickToBegin(text: string, sub: string): { el: HTMLDivElement; wait: Promise<void>; show(): void; hide(): void } {
  const el = document.createElement('div');
  el.className = 'tk-click';
  el.textContent = text;
  const s = document.createElement('small');
  s.textContent = sub;
  el.appendChild(s);
  document.body.appendChild(el);
  let resolve!: () => void;
  const wait = new Promise<void>((r) => (resolve = r));
  el.addEventListener('click', () => resolve());
  return {
    el,
    wait,
    show: () => (el.style.display = 'flex'),
    hide: () => (el.style.display = 'none'),
  };
}
