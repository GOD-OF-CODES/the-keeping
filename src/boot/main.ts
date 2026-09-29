// Boot entry. MUST NOT import three.js or game modules statically (CLAUDE.md; enforced by scripts/verify-boot.mjs).
// Flow: settings card → detect + benchmark → recommendation → Start (user gesture) → save → release the benchmark
// context → dynamic import('../game/main.ts').

import './boot.css';
import { detect, releaseContext, type DetectResult } from './detect.ts';
import { runBenchmark } from './benchmark.ts';
import { recommend, scoreFromRaw } from './recommend.ts';
import { clearDeviceRerun, hasChosenPreset, loadBenchmark, loadSettings, markPresetChosen, saveBenchmark, saveSettings } from './store.ts';
import { createBootUI } from './ui.ts';
import type { BootHandoff, GameModule } from './handoff.ts';
import type { DeviceInfo, Recommendation } from '../shared/types.ts';

const bootEl = document.getElementById('boot') ?? document.body;
const settings = loadSettings();
const ui = createBootUI(bootEl, settings);

let detected: DetectResult | null = null;
let rec: Recommendation | null = null;
let busy = false;

function estimateRefreshHz(ms = 700): Promise<number> {
  return new Promise((resolve) => {
    const ts: number[] = [];
    const t0 = performance.now();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const d = ts.slice(1).map((x, i) => x - ts[i]).filter((x) => x > 0 && x < 100).sort((a, b) => a - b);
      resolve(d.length >= 5 ? 1000 / d[d.length >> 1] : 0);
    };
    const step = (t: number) => {
      if (done) return;
      ts.push(t);
      if (t - t0 < ms) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
    setTimeout(finish, ms + 400); // rAF never fires in a hidden tab: don't block the device test on it
  });
}

async function runDeviceTest(force: boolean): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    ui.setStatus('Detecting your device…', true);
    if (!detected) detected = await detect();
    const { info, gl } = detected;
    let raw: number | null = null;
    let source = 'measured';
    const cached = force ? null : loadBenchmark(info.rendererString, info.browser);
    if (cached) {
      raw = cached.raw;
      source = 'cached';
    } else if (gl && !info.majorPerformanceCaveat) {
      ui.setStatus('Testing your graphics (about 2 seconds)…', true);
      await new Promise((r) => setTimeout(r, 50)); // let the status paint first
      const b = await runBenchmark(gl);
      raw = b.raw;
      if (raw != null) saveBenchmark({ raw, rendererString: info.rendererString, browser: info.browser, at: Date.now() });
      console.info(`[boot] benchmark raw=${raw?.toFixed(1) ?? 'null'} Mpix·iter/ms, samples=${b.samples}, median draw=${b.medianDrawMs?.toFixed(3) ?? '–'} ms, ${b.elapsedMs.toFixed(0)} ms`);
    }
    const scored: DeviceInfo = { ...info, benchmarkRaw: raw, benchmarkScore: scoreFromRaw(raw, info.browser) };
    detected = { info: scored, gl };
    rec = recommend(scored);
    const detail = [
      `renderer: ${info.rendererString || 'n/a'}`,
      `WebGPU: ${info.webgpu.available ? `${info.webgpu.vendor || '?'} ${info.webgpu.architecture}` : 'unavailable'}`,
      `benchmark raw: ${raw?.toFixed(1) ?? 'n/a'} (${source})`,
      `browser: ${info.browser}`,
    ].join('\n');
    ui.setRecommendation(rec, detail);
    if (!hasChosenPreset()) ui.select(rec.preset);
    ui.setStatus(`Device test ${source === 'cached' ? 'loaded' : 'complete'}.`, false);
    console.info(`[boot] ${rec.reason}`, { gpuClass: rec.gpuClass, score: scored.benchmarkScore, raw, source, info: scored });
    (window as unknown as { __boot?: unknown }).__boot = { info: scored, recommendation: rec };
  } catch (e) {
    console.error('[boot] device test failed', e);
    ui.setStatus('Device test failed — pick a preset manually.', false);
  } finally {
    busy = false;
  }
}

ui.onRerun(() => void runDeviceTest(true));

ui.onStart(async (chosen) => {
  saveSettings(chosen);
  markPresetChosen();
  clearDeviceRerun();
  ui.setStarting('Loading…');
  // Start is the user gesture: unlock audio now so the game can play sound without another click.
  let audioContext: AudioContext | undefined;
  try {
    audioContext = new AudioContext({ latencyHint: 'interactive' });
    void audioContext.resume();
  } catch {
    audioContext = undefined;
  }
  releaseContext(detected?.gl ?? null);
  if (detected) detected = { ...detected, gl: null };
  try {
    const game = (await import('../game/main.ts')) as GameModule;
    const handoff: BootHandoff = {
      settings: chosen,
      device: detected?.info ?? null,
      recommendation: rec,
      bootRoot: bootEl,
      audioContext,
      status: (text) => ui.setStarting(text),
    };
    await game.startGame(handoff);
  } catch (e) {
    console.error('[boot] failed to start the game', e);
    ui.setStarting(`Could not start: ${e instanceof Error ? e.message : String(e)}. Reload to try again.`);
  }
});

// Refresh estimate first (the benchmark's 40 ms batches would distort rAF deltas), then the device test.
void estimateRefreshHz()
  .then((hz) => ui.setRefreshHz(hz))
  .finally(() => runDeviceTest(new URLSearchParams(location.search).has('rerun')));
