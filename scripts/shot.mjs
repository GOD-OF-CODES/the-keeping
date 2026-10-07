#!/usr/bin/env node
// Headless QA driver for THE KEEPING — zero npm dependencies (Node 22 fetch + WebSocket + Chrome DevTools Protocol).
//
// Agents use this INSTEAD of opening the game in the user's browser: it starts its own server, launches a private
// HEADLESS Chrome (separate profile, invisible), runs a scenario, writes screenshots + a JSON report, and tears
// everything down. A global lock (.cache/chrome.lock) guarantees only one headless Chrome at a time on the 8 GB M1.
//
//   node scripts/shot.mjs --preset medium --beat B05 --shots 2            # boot → Start → jump to B05 → 2 shots
//   node scripts/shot.mjs --preset low --spawn CP1 --wait 6 --fps 5        # measure real rAF fps for 5 s
//   node scripts/shot.mjs --boot-only                                      # no-download-before-Start check + recommender
//   node scripts/shot.mjs --scenario scripts/qa/playthrough.mjs            # scripted run (see API below)
//   node scripts/shot.mjs --query "scene=matlab" --no-start --shots 1       # any page/scene
//
// Options:
//   --preset low|medium|max   (default medium)      --backend webgpu|webgl (default: auto)
//   --beat B01..B13 | --spawn <id>                    --query "<extra url params>"
//   --wait <s>  settle time after start (default 6)   --fps <s> measure real frame rate for s seconds via __game.stats()
//   --shots <n> screenshots at the end (default 1)     --width/--height viewport (default 1280x800; width multiple of 64)
//   --dev (use vite dev instead of a production build) --no-build (reuse existing dist/)
//   --out <dir> (default scratch/shots)                --name <prefix>
//   --boot-only  only load the boot page, report requests/recommendation, do not press Start
//   --no-start   load the URL but don't press Start (e.g. ?scene=matlab pages)
//   --scenario <file.mjs>  module exporting `default async function (qa)` with qa = {
//        eval(expr) → value, game(expr) → evaluates `window.__game.<expr>`, shot(name), wait(s), key(code, s),
//        advance(frames, keys), log(msg), assert(cond, msg), report (object you can extend) }
//
// Output: <out>/<name>-*.jpg and <out>/<name>-report.json; prints a short summary. Exit 1 on console errors,
// page exceptions, failed assertions or (for boot) any asset/three request before Start.

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, mkdtempSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOCK = join(ROOT, '.cache', 'chrome.lock');

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const flag = (name) => argv.includes(`--${name}`);
const preset = opt('preset', 'medium');
const backend = opt('backend', 'auto');
const beat = opt('beat', null);
const spawnId = opt('spawn', null);
const extraQuery = opt('query', '');
const waitS = Number(opt('wait', 6));
const fpsS = Number(opt('fps', 0));
const shots = Number(opt('shots', 1));
const width = Number(opt('width', 1280));
const height = Number(opt('height', 800));
const useDev = flag('dev');
const noBuild = flag('no-build');
const bootOnly = flag('boot-only');
const noStart = flag('no-start');
const scenarioPath = opt('scenario', null);
const outDir = resolve(ROOT, opt('out', 'scratch/shots'));
const name = opt('name', bootOnly ? 'boot' : `${preset}${beat ? '-' + beat : spawnId ? '-' + spawnId : ''}`);
const TIMEOUT_MS = Number(opt('timeout', 240)) * 1000;

if (width % 64 !== 0) console.warn(`[shot] width ${width} is not a multiple of 64 — WebGPU readback may stripe`);
mkdirSync(outDir, { recursive: true });
mkdirSync(dirname(LOCK), { recursive: true });

// ---------------------------------------------------------------- lock (one headless Chrome at a time)
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
const BLENDER_LOCK = join(ROOT, '.cache', 'blender.lock'); // held by scripts/assets.mjs while a Blender job runs
function blenderBusy() {
  try {
    const owner = JSON.parse(readFileSync(join(BLENDER_LOCK, 'owner.json'), 'utf8'));
    return owner?.pid && pidAlive(owner.pid) ? owner.pid : 0;
  } catch {
    return existsSync(BLENDER_LOCK) ? -1 : 0; // lock dir just created, owner.json not written yet
  }
}
// One headless Chrome at a time, and never alongside a Blender job (8 GB machine). We never wait while holding our
// own lock: if a Blender job holds its lock we back off, so assets.mjs (which waits for us holding its lock) can't
// deadlock with us. A release bake can take ~80 min, hence the long timeout.
async function acquireLock() {
  const t0 = Date.now();
  let lastMsg = 0;
  const say = (m) => { if (Date.now() - lastMsg > 30000) { console.log(`[shot] ${m}`); lastMsg = Date.now(); } };
  for (;;) {
    if (Date.now() - t0 > 120 * 60 * 1000) throw new Error('waited >120 min for the headless-Chrome / Blender locks');
    const b = blenderBusy();
    if (b) { say(`waiting: a Blender job is running (pid ${b > 0 ? b : '?'}) …`); await sleep(2000 + Math.random() * 1000); continue; }
    try {
      mkdirSync(LOCK);
      writeFileSync(join(LOCK, 'pid'), String(process.pid));
      if (blenderBusy()) { rmSync(LOCK, { recursive: true, force: true }); continue; } // raced a Blender job: back off
      return;
    } catch {
      let pid = 0;
      try { pid = Number(readFileSync(join(LOCK, 'pid'), 'utf8')); } catch {}
      let age = 0;
      try { age = Date.now() - statSync(LOCK).mtimeMs; } catch {}
      if ((!pid && age > 10000) || (pid && !pidAlive(pid))) {
        rmSync(LOCK, { recursive: true, force: true });
        continue;
      }
      say(`waiting for the headless-Chrome lock (pid ${pid || '?'}) …`);
      await sleep(1000 + Math.random() * 500);
    }
  }
}
function releaseLock() {
  try {
    if (Number(readFileSync(join(LOCK, 'pid'), 'utf8')) === process.pid) rmSync(LOCK, { recursive: true, force: true });
  } catch {}
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- server
function freePortish() {
  return 5300 + Math.floor(Math.random() * 600);
}
async function startServer() {
  const port = freePortish();
  if (!useDev && !noBuild) {
    console.log('[shot] building production bundle…');
    execFileSync('npx', ['vite', 'build', '--logLevel', 'error'], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
  }
  const args = useDev ? ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1']
    : ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'];
  const proc = spawn('npx', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let buf = '';
  proc.stdout.on('data', (d) => (buf += d));
  proc.stderr.on('data', (d) => (buf += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(base + '/');
      if (r.ok) return { proc, base };
    } catch {}
    await sleep(250);
  }
  killTree(proc);
  throw new Error('server did not start:\n' + buf.slice(-2000));
}
function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  try { process.kill(-proc.pid, 'SIGTERM'); } catch { try { proc.kill('SIGTERM'); } catch {} }
}

// ---------------------------------------------------------------- chrome + CDP
async function startChrome() {
  const profile = mkdtempSync(join(tmpdir(), 'keeping-chrome-'));
  const args = [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--use-angle=metal',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    'about:blank',
  ];
  const proc = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  let err = '';
  proc.stderr.on('data', (d) => (err += d));
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) { killTree(proc); throw new Error('Chrome did not start:\n' + err.slice(-1500)); }
  const port = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
  const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  return { proc, profile, port, wsUrl: ver.webSocketDebuggerUrl };
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message + (m.error.data ? ': ' + m.error.data : ''))) : res(m.result);
      } else if (m.method) {
        for (const fn of this.handlers.get(m.method) ?? []) fn(m.params, m.sessionId);
      }
    });
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
    return new CDP(ws);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  close() { try { this.ws.close(); } catch {} }
}

// ---------------------------------------------------------------- main
const report = {
  when: new Date().toISOString(), preset, backend, beat, spawn: spawnId, viewport: [width, height],
  url: '', consoleErrors: [], consoleWarnings: [], exceptions: [], requestsBeforeStart: [], requests: 0,
  recommendation: null, gameBackend: null, fps: null, gpuFrameMs: null, memory: null, shots: [], assertions: [], notes: [],
};
let server, chrome, cdp, sessionId;
let exitCode = 0;
const deadline = setTimeout(() => { console.error('[shot] TIMEOUT'); cleanup().then(() => process.exit(2)); }, TIMEOUT_MS);

async function cleanup() {
  clearTimeout(deadline);
  try { cdp?.close(); } catch {}
  killTree(chrome?.proc);
  killTree(server?.proc);
  await sleep(300);
  if (chrome?.profile) rmSync(chrome.profile, { recursive: true, force: true });
  releaseLock();
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => cleanup().then(() => process.exit(130)));

async function evaluate(expr, awaitPromise = true) {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
  return r.result?.value;
}
async function waitFor(expr, timeoutS = 60, what = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutS * 1000) {
    try { if (await evaluate(`!!(${expr})`)) return true; } catch {}
    await sleep(250);
  }
  throw new Error(`timed out after ${timeoutS}s waiting for ${what}`);
}
let shotN = 0;
async function screenshot(label) {
  const file = join(outDir, `${name}-${String(++shotN).padStart(2, '0')}${label ? '-' + label.replace(/[^\w.-]+/g, '_') : ''}.jpg`);
  const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 82 }, sessionId);
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  report.shots.push(file);
  return file;
}

try {
  await acquireLock();
  server = await startServer();
  chrome = await startChrome();
  cdp = await CDP.connect(chrome.wsUrl);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  await Promise.all(['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable'].map((m) => cdp.send(m, {}, sessionId)));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);

  let started = false;
  cdp.on('Runtime.consoleAPICalled', (p) => {
    const text = p.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (p.type === 'error') report.consoleErrors.push(text.slice(0, 500));
    else if (p.type === 'warning') report.consoleWarnings.push(text.slice(0, 300));
  });
  cdp.on('Runtime.exceptionThrown', (p) => report.exceptions.push((p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 800)));
  cdp.on('Log.entryAdded', (p) => { if (p.entry.level === 'error' && !/favicon/.test(p.entry.url ?? '')) report.consoleErrors.push(`[log] ${p.entry.text}`.slice(0, 500)); });
  cdp.on('Network.requestWillBeSent', (p) => {
    report.requests++;
    if (!started) report.requestsBeforeStart.push(p.request.url.replace(server.base, ''));
  });

  const q = new URLSearchParams(extraQuery);
  q.set('debug', '');
  if (backend === 'webgl') q.set('backend', 'webgl');
  if (beat) q.set('beat', beat);
  if (spawnId) q.set('spawn', spawnId);
  const url = `${server.base}/?${q.toString().replace(/=(&|$)/g, '$1')}`;
  report.url = url.replace(server.base, '');
  await cdp.send('Page.navigate', { url }, sessionId);
  await waitFor(`document.readyState === 'complete'`, 60);

  if (!noStart) {
    // Boot card: wait for the recommendation, then pick the preset and press Start.
    await waitFor(`document.querySelector('.tk-start') && !document.querySelector('.tk-start').disabled`, 60, 'boot card');
    // Device test (benchmark ~1.5 s, slower headless): wait until a card is marked recommended.
    await waitFor(`document.querySelector('.tk-card.recommended')`, 45, 'device recommendation').catch((e) => report.notes.push(String(e)));
    report.recommendation = await evaluate(`(() => { const r = document.querySelector('.tk-reason'); const b = document.querySelector('.tk-card.recommended'); return { reason: r ? r.textContent : '', recommended: b ? b.querySelector('.tk-card-name').textContent : null }; })()`);
    // Allowed before Start: the HTML, whatever index.html itself references (the boot entry chunk + CSS), and in
    // dev mode the boot's own modules. Flagged: game asset tiers, binary assets, three.js, any other script chunk.
    const html = await (await fetch(server.base + '/')).text();
    const referenced = new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]));
    const bootDev = /^\/(src\/boot\/|src\/shared\/|src\/render\/presets\.ts|@vite\/client|node_modules\/vite\/)/;
    const bad = report.requestsBeforeStart.filter((u) => {
      const p = u.split('?')[0];
      if (p === '/' || p === '/favicon.ico' || referenced.has(p) || bootDev.test(p)) return false;
      if (/^\/assets\/(low|medium|max|voice)\//.test(p) || /\.(glb|klm|mp3|wasm|bin|ktx2)$/.test(p) || /three/.test(p)) return true;
      return /\.(js|mjs|ts)$/.test(p); // any script chunk the boot page did not reference itself
    });
    if (bad.length) { report.notes.push('ASSET/THREE REQUESTS BEFORE START: ' + bad.join(', ')); exitCode = 1; }
    if (bootOnly) {
      await screenshot('boot');
    } else {
      await evaluate(`(() => { const want = ${JSON.stringify(preset)}; const inputs = [...document.querySelectorAll('input[name=tk-preset]')]; const byVal = inputs.find(i => i.value === want); const i = byVal ?? inputs[['low','medium','max'].indexOf(want)]; if (i) { i.click(); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); } return !!i; })()`);
      started = true;
      await evaluate(`document.querySelector('.tk-start').click()`);
      await waitFor(`window.__game && window.__game.renderer`, 180, 'game start');
      // Wait for loading to finish (the loading overlay removes itself on ready), then unpause without pointer lock.
      await waitFor(`!document.querySelector('.tk-loading-overlay')`, 240, 'loading overlay removed').catch((e) => report.notes.push(String(e)));
      await evaluate(`window.__game.unpause && window.__game.unpause()`);
      report.gameBackend = await evaluate(`(() => { const g = window.__game; const b = g.renderer?.backend; return { backend: b?.isWebGPUBackend ? 'webgpu' : (b?.isWebGLBackend ? 'webgl2' : '?'), reason: g.backendReason ?? null }; })()`);
      await sleep(waitS * 1000);
    }
  } else {
    started = true;
    await sleep(waitS * 1000);
  }

  if (scenarioPath) {
    const mod = await import(pathToFileURL(resolve(ROOT, scenarioPath)).href);
    const qa = {
      report,
      eval: evaluate,
      game: (expr) => evaluate(`window.__game.${expr}`),
      shot: screenshot,
      wait: (s) => sleep(s * 1000),
      waitFor,
      key: async (code, s = 0.1) => {
        await evaluate(`window.__game.input.down.add(${JSON.stringify(code)})`);
        await sleep(s * 1000);
        await evaluate(`window.__game.input.down.delete(${JSON.stringify(code)})`);
      },
      advance: (frames, keys = []) => evaluate(`window.__game.advance(${frames}, 1/60, ${JSON.stringify(keys)})`),
      log: (m) => { report.notes.push(String(m)); console.log('[scenario]', m); },
      assert: (cond, msg) => { report.assertions.push({ ok: !!cond, msg }); if (!cond) { exitCode = 1; console.error('[assert] FAIL', msg); } },
    };
    await mod.default(qa);
  }

  if (!bootOnly && !noStart) {
    if (fpsS > 0) {
      await evaluate(`window.__game.setShowFps && window.__game.setShowFps(true)`);
      await sleep(fpsS * 1000);
      report.fps = await evaluate(`(() => { const s = window.__game.stats && window.__game.stats(); return s ? JSON.parse(JSON.stringify(s)) : null; })()`);
    }
    try { report.gpuFrameMs = await evaluate(`window.__game.gpuFrameMs ? window.__game.gpuFrameMs(60) : null`); } catch (e) { report.notes.push('gpuFrameMs: ' + e.message); }
    try { report.memory = await evaluate(`(() => { const m = window.__game.memory && window.__game.memory(); return m ? JSON.parse(JSON.stringify(m)) : null; })()`); } catch {}
    for (let i = 0; i < shots; i++) {
      await screenshot(i === 0 ? 'final' : `final${i + 1}`);
      if (i + 1 < shots) await sleep(1000);
    }
  } else if (noStart) {
    for (let i = 0; i < shots; i++) await screenshot('page');
  }

  if (report.consoleErrors.length || report.exceptions.length) exitCode = 1;
} catch (e) {
  report.notes.push('FATAL: ' + (e?.stack ?? e));
  exitCode = 2;
  try { await screenshot('fatal'); } catch {}
} finally {
  writeFileSync(join(outDir, `${name}-report.json`), JSON.stringify(report, null, 2));
  await cleanup();
}

const s = report;
console.log(`[shot] ${s.url}  backend=${s.gameBackend?.backend ?? '-'}  recommended=${s.recommendation?.recommended ?? '-'}`);
if (s.fps) console.log(`[shot] fps: ${JSON.stringify(s.fps)}`);
if (s.gpuFrameMs != null) console.log(`[shot] gpu frame ≈ ${Number(s.gpuFrameMs).toFixed(2)} ms`);
console.log(`[shot] requests before Start: ${s.requestsBeforeStart.length} · console errors: ${s.consoleErrors.length} · exceptions: ${s.exceptions.length}`);
for (const e of [...s.consoleErrors, ...s.exceptions].slice(0, 8)) console.log('  ✗', e.split('\n')[0]);
for (const n of s.notes.slice(0, 8)) console.log('  •', n.split('\n')[0]);
for (const f of s.shots) console.log('  📷', f.replace(ROOT + '/', ''));
process.exit(exitCode);
