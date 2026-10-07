// Boot settings card (DOM only, system fonts, no assets). Rendered before anything heavy downloads.

import { PRESETS } from '../render/presets.ts';
import { PRESET_IDS, type FpsCap, type PresetId, type Recommendation, type Settings } from '../shared/types.ts';

export interface BootUI {
  setStatus(text: string, busy: boolean): void;
  setRecommendation(rec: Recommendation | null, detail: string): void;
  setRefreshHz(hz: number): void;
  setStarting(text: string): void;
  onStart(cb: (s: Settings) => void): void;
  onRerun(cb: () => void): void;
  /** Preselects a preset (used when the player never chose one). */
  select(id: PresetId): void;
  readonly root: HTMLElement;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function resolutionLine(id: PresetId): string {
  const p = PRESETS[id];
  const dpr = Math.min(window.devicePixelRatio || 1, p.pixelRatioCap);
  const w = Math.round(window.innerWidth * dpr);
  const hh = Math.round(window.innerHeight * dpr);
  if (p.pipeline === 'direct') return `${w}×${hh} · MSAA 4×`;
  const iw = Math.round(w * p.sceneScale);
  const ih = Math.round(hh * p.sceneScale);
  return `${iw}×${ih} → ${w}×${hh} · temporal upscale`;
}

export function createBootUI(host: HTMLElement, initial: Settings): BootUI {
  const s: Settings = structuredClone(initial);
  let startCb: ((s: Settings) => void) | null = null;
  let rerunCb: (() => void) | null = null;
  let refreshHz = 0;
  let recommended: PresetId | null = null;

  host.textContent = '';
  const root = h('main', 'tk-boot');
  root.setAttribute('aria-labelledby', 'tk-title');
  host.appendChild(root);

  const head = h('header', 'tk-head');
  const title = h('h1', 'tk-title', 'The Keeping');
  title.id = 'tk-title';
  head.append(title, h('p', 'tk-by', 'A game by Raj Vardhan Singh'), h('p', 'tk-sub', 'A short first-person horror story. About twelve minutes. Headphones recommended.'));

  const warn = h('section', 'tk-warn');
  warn.setAttribute('aria-label', 'Content warning');
  warn.append(
    h('span', 'tk-warn-label', 'Content warning'),
    h('p', 'tk-warn-text', 'Depictions of domestic violence, murder, drowning and gore. Flashing light (lightning) — see “Reduced flash”.'),
  );

  const status = h('div', 'tk-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const statusDot = h('span', 'tk-dot');
  const statusText = h('span', 'tk-status-text', 'Detecting your device…');
  status.append(statusDot, statusText);
  status.classList.add('busy');

  const reason = h('p', 'tk-reason');

  // Preset cards (radio group).
  const presetsEl = h('fieldset', 'tk-presets');
  presetsEl.append(h('legend', 'tk-legend', 'Graphics'));
  const cards = new Map<PresetId, { label: HTMLLabelElement; input: HTMLInputElement; badge: HTMLSpanElement; res: HTMLSpanElement }>();
  for (const id of PRESET_IDS) {
    const p = PRESETS[id];
    const label = h('label', 'tk-card');
    const input = h('input');
    input.type = 'radio';
    input.name = 'tk-preset';
    input.value = id;
    input.checked = s.preset === id;
    input.addEventListener('change', () => {
      if (input.checked) {
        s.preset = id;
        syncCards();
      }
    });
    const top = h('span', 'tk-card-top');
    top.append(h('span', 'tk-card-name', p.label));
    const badge = h('span', 'tk-badge', 'Recommended for your device');
    badge.hidden = true;
    const res = h('span', 'tk-card-res', resolutionLine(id));
    label.append(input, top, badge, h('span', 'tk-card-sum', p.summary), res, h('span', 'tk-card-dl', `≈ ${p.downloadMB} MB download · target ${p.targetFps} fps`));
    presetsEl.append(label);
    cards.set(id, { label, input, badge, res });
  }
  function syncCards() {
    for (const [id, c] of cards) {
      c.label.classList.toggle('selected', id === s.preset);
      c.label.classList.toggle('recommended', id === recommended);
      c.input.checked = id === s.preset;
      c.badge.hidden = id !== recommended;
    }
  }

  // Options.
  const opts = h('fieldset', 'tk-opts');
  opts.append(h('legend', 'tk-legend', 'Options'));
  const toggle = (text: string, get: () => boolean, set: (v: boolean) => void, hint?: string) => {
    const l = h('label', 'tk-toggle');
    const i = h('input');
    i.type = 'checkbox';
    i.checked = get();
    i.addEventListener('change', () => set(i.checked));
    l.append(i, h('span', 'tk-switch'), h('span', 'tk-toggle-text', text));
    if (hint) l.append(h('span', 'tk-hint', hint));
    return l;
  };
  opts.append(toggle('Show FPS counter', () => s.showFps, (v) => (s.showFps = v)));

  const capRow = h('div', 'tk-cap');
  capRow.append(h('span', 'tk-cap-label', 'Frame-rate cap'));
  const seg = h('div', 'tk-seg');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Frame-rate cap');
  const capOptions: Array<[FpsCap, string]> = [
    [30, '30'],
    [60, '60'],
    [0, 'Uncapped'],
  ];
  const capButtons: HTMLButtonElement[] = [];
  for (const [v, text] of capOptions) {
    const b = h('button', 'tk-seg-btn', text);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => {
      s.fpsCap = v;
      syncCap();
    });
    b.dataset.cap = String(v);
    capButtons.push(b);
    seg.append(b);
  }
  capRow.append(seg);
  const divisor = toggle('Match display refresh (divisor mode)', () => s.fpsCapDivisorMode, (v) => {
    s.fpsCapDivisorMode = v;
    syncCap();
  });
  const capNote = h('span', 'tk-hint tk-cap-note');
  divisor.append(capNote);
  function syncCap() {
    for (const b of capButtons) {
      const on = Number(b.dataset.cap) === s.fpsCap;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    let note = '';
    if (refreshHz > 0) {
      const hz = Math.round(refreshHz);
      if (s.fpsCap === 0) note = `display ≈ ${hz} Hz`;
      else if (s.fpsCapDivisorMode && refreshHz > s.fpsCap * 1.05) {
        const eff = refreshHz / Math.max(1, Math.round(refreshHz / s.fpsCap));
        note = `≈ ${eff.toFixed(eff % 1 ? 1 : 0)} fps on this ${hz} Hz display`;
      } else note = `display ≈ ${hz} Hz`;
    }
    capNote.textContent = note;
  }
  opts.append(capRow, divisor);
  opts.append(toggle('Reduced flash', () => s.reducedFlash, (v) => (s.reducedFlash = v), 'Softens lightning and camera flashes'));

  // Actions.
  const actions = h('div', 'tk-actions');
  const rerun = h('button', 'tk-link', 'Re-run device test');
  rerun.type = 'button';
  rerun.disabled = true;
  rerun.addEventListener('click', () => rerunCb?.());
  const start = h('button', 'tk-start', 'Start');
  start.type = 'button';
  start.addEventListener('click', () => {
    if (start.disabled) return;
    start.disabled = true;
    startCb?.(structuredClone(s));
  });
  actions.append(rerun, start);

  const foot = h('p', 'tk-foot', 'Keyboard and mouse. Nothing is downloaded until you press Start.');

  const body = h('div', 'tk-body');
  body.append(status, reason, presetsEl, opts);
  root.append(head, warn, body, actions, foot);

  syncCards();
  syncCap();
  window.addEventListener('resize', () => {
    for (const [id, c] of cards) c.res.textContent = resolutionLine(id);
  });
  requestAnimationFrame(() => root.classList.add('in'));

  return {
    root,
    setStatus(text, busy) {
      statusText.textContent = text;
      status.classList.toggle('busy', busy);
      rerun.disabled = busy;
    },
    setRecommendation(rec, detail) {
      recommended = rec?.preset ?? null;
      reason.textContent = rec ? rec.reason + (rec.warnings.length ? ` · ${rec.warnings.join(' ')}` : '') : '';
      reason.title = detail;
      syncCards();
    },
    setRefreshHz(hz) {
      refreshHz = hz;
      syncCap();
    },
    setStarting(text) {
      start.disabled = true;
      rerun.disabled = true;
      root.classList.add('starting');
      statusText.textContent = text;
      status.classList.add('busy');
    },
    onStart(cb) {
      startCb = cb;
    },
    onRerun(cb) {
      rerunCb = cb;
    },
    select(id) {
      s.preset = id;
      syncCards();
    },
  };
}
