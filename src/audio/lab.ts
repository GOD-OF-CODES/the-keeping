// Audio lab: audition every synthesized sound, the live layers, spatial occlusion, room reverbs and voice lines.
// Dev-only. Reached two ways, both dynamic so nothing here touches the boot chunk:
//   - `?scene=audiolab` → the game entry does `(await import('../audio/lab.ts')).startAudioLab(document.body)`
//   - directly at http://localhost:5173/src/audio/lab.html (no renderer, no WebGPU — light on the M1)

import { DEFAULT_SETTINGS, type Settings } from '../shared/types.ts';
import { EventBus } from '../core/events.ts';
import type { LevelLayout } from '../shared/layout-types.ts';
import type { VoiceScript } from '../shared/voice-types.ts';
import { AudioEngine, type PlayHandle } from './engine.ts';
import { RECIPES } from './synth/index.ts';
import { renderRecipe, encodeWav } from './synth/render.ts';
import { withDefaults, type Params, type Recipe, type RecipeCategory } from './synth/types.ts';
import { bestPath, occlusionFor } from './spatial.ts';
import { rt60For } from './reverb.ts';
import { VoicePlayer, loadVoiceScript } from './voice.ts';
import { Subtitles } from '../ui/subtitles.ts';

const CSS = `
.lab{font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e7e2d8;background:#111013;min-height:100vh;padding:16px;box-sizing:border-box}
.lab h1{font-size:18px;margin:0 0 4px;font-weight:650;letter-spacing:.02em}
.lab h2{font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:#a0978a;margin:18px 0 8px;font-weight:600}
.lab .muted{color:#8d857a}
.lab .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px}
.lab .card{background:#1b1a1f;border:1px solid #2b2930;border-radius:8px;padding:8px 10px}
.lab .card b{font-weight:600}
.lab button{font:inherit;color:#eee;background:#2c2a33;border:1px solid #3c3945;border-radius:6px;padding:4px 9px;cursor:pointer;margin:2px 4px 2px 0}
.lab button:hover{background:#39364a}
.lab button.on{background:#5b3b2a;border-color:#8a5a3a}
.lab label{display:flex;gap:6px;align-items:center;margin:3px 0;color:#bdb5a8}
.lab input[type=range]{flex:1;min-width:80px}
.lab select{font:inherit;background:#1b1a1f;color:#eee;border:1px solid #3c3945;border-radius:5px;padding:2px 4px}
.lab .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.lab .meter{font-variant-numeric:tabular-nums}
.lab .sticky{position:sticky;top:0;background:#111013;padding:8px 0;z-index:5;border-bottom:1px solid #26242b}
`;

const CAT_LABEL: Record<RecipeCategory, string> = {
  ada: 'Ada — tells',
  weather: 'Weather',
  footsteps: 'Footsteps',
  doors: 'Doors & hardware',
  bells: 'Bells',
  harlan: 'Harlan',
  car: 'Car',
  props: 'Props',
  player: 'Player',
  score: 'Score',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { cls?: string } = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const { cls, ...rest } = props;
  if (cls) e.className = cls;
  Object.assign(e, rest);
  for (const k of kids) e.append(k);
  return e;
}

function slider(label: string, min: number, max: number, value: number, step: number, on: (v: number) => void): HTMLLabelElement {
  const out = el('span', { cls: 'meter', textContent: String(value) });
  const inp = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  inp.oninput = () => {
    out.textContent = inp.value;
    on(parseFloat(inp.value));
  };
  return el('label', {}, label, inp, out);
}

export async function startAudioLab(root: HTMLElement = document.body, o: { context?: AudioContext; settings?: Settings } = {}): Promise<void> {
  document.title = 'THE KEEPING — audio lab';
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
  root.style.margin = '0';
  const wrap = el('div', { cls: 'lab' });
  root.appendChild(wrap);
  wrap.append(
    el('h1', { textContent: 'THE KEEPING — audio lab' }),
    el('div', { cls: 'muted', textContent: 'Every sound is synthesized in code (src/audio/synth). Use headphones for HRTF.' }),
  );
  const startBtn = el('button', { textContent: 'Start audio' });
  const startRow = el('div', { cls: 'row' }, startBtn);
  startRow.style.marginTop = '10px';
  wrap.append(startRow);
  await new Promise<void>((res) => (startBtn.onclick = () => res()));
  startBtn.remove();

  const settings: Settings = o.settings ?? structuredClone(DEFAULT_SETTINGS);
  const events = new EventBus();
  const layout = (await import('../shared/level-layout.json')).default as unknown as LevelLayout;
  const engine = new AudioEngine({ context: o.context, settings, events, layout });
  await engine.unlock();

  // ---- header: prerender + meter + master
  const status = el('span', { cls: 'muted' });
  const meter = el('span', { cls: 'meter', textContent: 'peak — dBFS' });
  const header = el('div', { cls: 'sticky row' }, status, meter,
    slider('master', 0, 1, settings.volume.master, 0.01, (v) => { settings.volume.master = v; engine.applyVolumes(settings); }),
  );
  wrap.append(header);
  const an = engine.ctx.createAnalyser();
  an.fftSize = 2048;
  engine.limiter.connect(an);
  const tmp = new Float32Array(an.fftSize);
  let hold = 0;
  const meterLoop = () => {
    an.getFloatTimeDomainData(tmp);
    let pk = 0;
    for (let i = 0; i < tmp.length; i++) pk = Math.max(pk, Math.abs(tmp[i]));
    hold = Math.max(pk, hold * 0.97);
    meter.textContent = `peak ${hold > 1e-5 ? (20 * Math.log10(hold)).toFixed(1) : '-∞'} dBFS`;
    engine.update(1 / 60);
    requestAnimationFrame(meterLoop);
  };
  requestAnimationFrame(meterLoop);

  const t0 = performance.now();
  await engine.prerender({ onProgress: (f, label) => (status.textContent = `rendering banks ${(f * 100).toFixed(0)}% — ${label}`) });
  status.textContent = `banks ready in ${(performance.now() - t0).toFixed(0)} ms @ ${engine.ctx.sampleRate} Hz (lazy sounds render on first play)`;

  // ---- spatial panel
  const sp = { on: false, az: 30, dist: 3, height: 0, listenerRoom: 'U1', sourceRoom: 'U1', doorsOpen: false };
  engine.setListener(0, 1.6, 0, 0, 0, -1);
  engine.setDoorStateProvider(() => sp.doorsOpen);
  const posFor = (): [number, number, number] => {
    const a = (sp.az * Math.PI) / 180;
    return [Math.sin(a) * sp.dist, 1.6 + sp.height, -Math.cos(a) * sp.dist];
  };
  const rooms = layout.rooms.map((r) => r.id);
  const occInfo = el('div', { cls: 'muted meter' });
  const updOcc = () => {
    engine.setListenerRoom(sp.listenerRoom);
    const p = bestPath(layout.roomLinks, sp.listenerRoom, sp.sourceRoom, () => sp.doorsOpen);
    const oc = occlusionFor(p);
    const def = layout.rooms.find((r) => r.id === sp.listenerRoom)!;
    occInfo.textContent = `path ${p.rooms.join('→') || '—'} via ${p.via.join(',') || 'same room'} · att ${p.attenuation.toFixed(2)} → gain ${oc.gain.toFixed(2)}, lowpass ${oc.cutoff.toFixed(0)} Hz · reverb ${sp.listenerRoom} RT60 ${rt60For(def.reverb).toFixed(2)} s`;
  };
  const roomSel = (label: string, key: 'listenerRoom' | 'sourceRoom') => {
    const s = el('select');
    for (const r of rooms) s.append(el('option', { value: r, textContent: r, selected: r === sp[key] }));
    s.onchange = () => { sp[key] = s.value; updOcc(); };
    return el('label', {}, label, s);
  };
  const posChk = el('input', { type: 'checkbox' });
  posChk.onchange = () => (sp.on = posChk.checked);
  const doorChk = el('input', { type: 'checkbox' });
  doorChk.onchange = () => { sp.doorsOpen = doorChk.checked; updOcc(); };
  wrap.append(
    el('h2', { textContent: 'Spatial & rooms' }),
    el('div', { cls: 'card' },
      el('div', { cls: 'row' }, el('label', {}, posChk, 'play one-shots positionally (HRTF + occlusion)'), el('label', {}, doorChk, 'doors open')),
      slider('azimuth°', -180, 180, sp.az, 1, (v) => (sp.az = v)),
      slider('distance m', 0.3, 20, sp.dist, 0.1, (v) => (sp.dist = v)),
      slider('height m', -4, 4, sp.height, 0.1, (v) => (sp.height = v)),
      el('div', { cls: 'row' }, roomSel('listener room', 'listenerRoom'), roomSel('source room', 'sourceRoom')),
      occInfo,
    ),
  );
  updOcc();

  // ---- live layers
  const dripBtn = el('button', { textContent: 'Drip loop' });
  let dripOn = false;
  dripBtn.onclick = () => {
    dripOn = !dripOn;
    dripBtn.classList.toggle('on', dripOn);
    if (dripOn) {
      engine.layers.startDrip(1.2);
      const p = posFor();
      engine.layers.setDripPosition(p[0], p[1], p[2], sp.sourceRoom);
    } else engine.layers.stopDrip(false);
  };
  const tellBtn = el('button', { textContent: 'Drip stops (LISTEN tell)' });
  tellBtn.onclick = () => { engine.layers.stopDrip(true); dripOn = false; dripBtn.classList.remove('on'); };
  const thunderBtn = el('button', { textContent: 'Flash → thunder (1.5 s, 2.5 s roll)' });
  let thunderDist = 0.2;
  thunderBtn.onclick = () => events.emit('thunder', { delayMs: 1500, durationMs: 2500, distance: thunderDist });
  const weather = { rain: 0, wind: 0, inside: 0, surface: 'gravel' as 'roof' | 'glass' | 'porch' | 'car' | 'gravel' };
  const applyWeather = () => engine.layers.setWeather(weather);
  const surfSel = el('select');
  for (const s of ['gravel', 'porch', 'glass', 'roof', 'car'] as const) surfSel.append(el('option', { value: s, textContent: s }));
  surfSel.onchange = () => { weather.surface = surfSel.value as typeof weather.surface; applyWeather(); };
  const scoreBtns = (['none', 'drone', 'chase', 'blue_hour'] as const).map((s) => {
    const b = el('button', { textContent: s });
    b.onclick = () => engine.layers.setScore(s);
    return b;
  });
  const breathBtns = (['calm', 'strained', 'panting', null] as const).map((k) => {
    const b = el('button', { textContent: k ?? 'breath off' });
    b.onclick = () => engine.layers.setBreath(k);
    return b;
  });
  const holdBtn = el('button', { textContent: 'Hold breath (hold mouse)' });
  holdBtn.onpointerdown = () => events.emit('player:breath', { holding: true });
  holdBtn.onpointerup = () => events.emit('player:breath', { holding: false });
  const aiBtns = ['PATROL', 'LISTEN', 'CHASE', 'SEARCH'].map((s) => {
    const b = el('button', { textContent: `ai:${s}` });
    b.onclick = () => events.emit('ai:state', { from: '', to: s });
    return b;
  });
  wrap.append(
    el('h2', { textContent: 'Live layers' }),
    el('div', { cls: 'grid' },
      el('div', { cls: 'card' }, el('b', { textContent: "Ada's drip" }), el('br'), dripBtn, tellBtn,
        slider('rate /s (her speed)', 0.2, 4, 1.2, 0.1, (v) => engine.layers.setDripRate(v)),
        el('div', { cls: 'muted', textContent: 'Position = spatial panel (press Drip loop again to re-place).' })),
      el('div', { cls: 'card' }, el('b', { textContent: 'Weather' }),
        slider('rain', 0, 1, 0, 0.01, (v) => { weather.rain = v; applyWeather(); }),
        slider('wind', 0, 1, 0, 0.01, (v) => { weather.wind = v; applyWeather(); }),
        slider('inside', 0, 1, 0, 0.01, (v) => { weather.inside = v; applyWeather(); }),
        el('label', {}, 'surface', surfSel), thunderBtn,
        slider('thunder distance', 0, 1, thunderDist, 0.05, (v) => (thunderDist = v))),
      el('div', { cls: 'card' }, el('b', { textContent: 'Score / body' }), el('br'), ...scoreBtns, el('br'), ...breathBtns, holdBtn,
        slider('heartbeat bpm (0 = off)', 0, 170, 0, 1, (v) => engine.layers.setHeartRate(v)), el('br'), ...aiBtns),
    ),
  );

  // ---- every recipe
  const loops = new Map<string, PlayHandle>();
  let lastRender: { id: string; chs: Float32Array[]; sr: number } | null = null;
  const byCat = new Map<RecipeCategory, Recipe[]>();
  for (const r of RECIPES) (byCat.get(r.category) ?? byCat.set(r.category, []).get(r.category)!).push(r);
  for (const [cat, list] of byCat) {
    wrap.append(el('h2', { textContent: CAT_LABEL[cat] }));
    const grid = el('div', { cls: 'grid' });
    for (const r of list) {
      const params: Params = withDefaults(r);
      let custom = false;
      let variant = 0;
      const info = el('span', { cls: 'muted' });
      const play = el('button', { textContent: r.loop ? '▶ loop' : '▶ play' });
      const next = el('button', { textContent: 'next variant' });
      const wav = el('button', { textContent: '⤓ wav' });
      const doPlay = async () => {
        if (r.loop && loops.has(r.id)) {
          loops.get(r.id)!.stop(0.4);
          loops.delete(r.id);
          play.classList.remove('on');
          return;
        }
        let buffer: AudioBuffer | null = null;
        if (custom) {
          const out = renderRecipe(r, engine.ctx.sampleRate, variant, params);
          buffer = engine.ctx.createBuffer(out.channels.length, out.channels[0].length, out.sampleRate);
          out.channels.forEach((c, i) => buffer!.copyToChannel(c as Float32Array<ArrayBuffer>, i));
          lastRender = { id: r.id, chs: out.channels, sr: out.sampleRate };
          info.textContent = `${out.ms.toFixed(0)} ms render · ${buffer.duration.toFixed(2)} s`;
        } else {
          const bufs = await engine.ensure(r.id);
          buffer = bufs[variant % bufs.length];
          info.textContent = `v${(variant % bufs.length) + 1}/${bufs.length} · ${buffer.duration.toFixed(2)} s`;
        }
        const positional = sp.on && !r.stereo;
        const h = engine.playBuffer(buffer, { bus: r.bus, loop: r.loop, pos: positional ? posFor() : undefined, room: positional ? sp.sourceRoom : undefined, fadeIn: r.loop ? 0.3 : 0 });
        if (r.loop) {
          loops.set(r.id, h);
          play.classList.add('on');
        }
      };
      play.onclick = () => void doPlay();
      next.onclick = () => { variant++; void doPlay(); };
      wav.onclick = () => {
        const out = lastRender?.id === r.id ? lastRender : (() => { const x = renderRecipe(r, engine.ctx.sampleRate, variant, params); return { id: r.id, chs: x.channels, sr: x.sampleRate }; })();
        const blob = new Blob([encodeWav(out.chs, out.sr) as Uint8Array<ArrayBuffer>], { type: 'audio/wav' });
        const a = el('a', { href: URL.createObjectURL(blob), download: `${r.id}_v${variant + 1}.wav` });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      };
      const card = el('div', { cls: 'card' }, el('b', { textContent: r.label }), el('div', { cls: 'muted', textContent: `${r.id} · ${r.bus}${r.stereo ? ' · stereo' : ''}${r.preload === false ? ' · lazy' : ''}` }), play);
      if (r.variants > 1) card.append(next);
      card.append(wav);
      for (const [k, spec] of Object.entries(r.params ?? {})) {
        const step = spec.max - spec.min > 20 ? 1 : 0.01;
        card.append(slider(spec.label ?? k, spec.min, spec.max, spec.default, step, (v) => { params[k] = v; custom = true; }));
      }
      card.append(info);
      grid.append(card);
    }
    wrap.append(grid);
  }

  // ---- voices
  wrap.append(el('h2', { textContent: 'Voice lines' }));
  const script: VoiceScript | null = await loadVoiceScript();
  if (!script) {
    wrap.append(el('div', { cls: 'muted', textContent: 'src/shared/voice-script.json not found yet.' }));
    return;
  }
  const subs = new Subtitles(document.body);
  subs.attach(events);
  const voice = new VoicePlayer({ engine, script, events, subtitles: subs, settings });
  await voice.load();
  const vgrid = el('div', { cls: 'grid' });
  for (const l of script.lines) {
    const b = el('button', { textContent: '▶' });
    b.onclick = () => void voice.play(l.id, { pos: sp.on ? posFor() : [1, 1.6, -2], room: sp.sourceRoom });
    vgrid.append(el('div', { cls: 'card' }, b, el('b', { textContent: l.id }),
      el('div', { cls: 'muted', textContent: `${l.speaker} · ${l.chain ?? 'default chain'} · ${voice.hasAudio(l.id) ? 'audio' : 'subtitle-only'}` }),
      el('div', { textContent: l.subtitle || l.caption || '' })));
  }
  wrap.append(vgrid);
}
