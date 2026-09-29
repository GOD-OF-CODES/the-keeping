// Game entry — reached ONLY via `import('../game/main.ts')` from the boot page after Start.
// Builds the GameContext, renderer (backend chosen before construction), pipeline, loop, FPS overlay, input,
// pause menu and — until the real level ships — the RENDER TEST ROOM (also forced with ?scene=test).
// Debug: ?debug exposes window.__game. ?backend=webgl forces the WebGL2 backend.

import * as THREE from 'three/webgpu';
import type { BootHandoff } from '../boot/handoff.ts';
import { requestDeviceRerun, saveSettings } from '../boot/store.ts';
import { EventBus } from '../core/events.ts';
import { FpsOverlay } from '../core/fps-overlay.ts';
import { Input } from '../core/input.ts';
import { Loop } from '../core/loop.ts';
import { PRESETS } from '../render/presets.ts';
import { createRenderer, effectivePixelRatio } from '../render/renderer.ts';
import { createPipeline } from '../render/pipeline.ts';
import { DynamicResolution } from '../render/dynres.ts';
import { createFlashlight } from '../render/flashlight.ts';
import { uLightning } from '../render/lightmap-material.ts';
import { bakeProbeGrid, excludeGridFromLightmapped } from '../render/probes.ts';
import type { GameContext } from './context.ts';
import type { LevelLayout } from '../shared/layout-types.ts';
import { buildTestRoom, ROOM } from './test-room.ts';
import { TestController } from './test-controller.ts';
import { PauseMenu, clickToBegin } from './pause-menu.ts';

/** String literal that survives minification; scripts/verify-boot.mjs asserts it never reaches the boot chunk. */
export const GAME_CHUNK_MARKER = 'the-keeping:game-runtime';

export async function startGame(h: BootHandoff): Promise<void> {
  console.info(`[game] ${GAME_CHUNK_MARKER} three r${THREE.REVISION}`);
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');
  const settings = h.settings;
  const presetId = settings.preset;
  const preset = PRESETS[presetId];
  const forceWebGL = settings.forceWebGL || params.get('backend') === 'webgl';

  const gameRoot = document.getElementById('game') ?? document.body;
  gameRoot.style.display = 'block';
  gameRoot.style.visibility = 'hidden'; // keep the boot card (with status text) visible while loading

  h.status('Starting the renderer…');
  const { renderer, canvas, backend, backendReason } = await createRenderer(preset, { forceWebGL, parent: gameRoot });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(settings.fovDeg, window.innerWidth / window.innerHeight, 0.03, 60);
  scene.add(camera); // the flashlight is parented to the camera: it must be in the scene graph

  const ctx: GameContext = {
    settings,
    presetId,
    preset,
    renderer,
    scene,
    camera,
    backend,
    events: new EventBus(),
    time: { now: 0, dt: 0, frame: 0 },
    layout: { version: 1 } as unknown as LevelLayout, // real layout arrives with src/shared/level-layout.json
    debug,
    systems: new Map(),
    flags: new Map(),
  };

  // ---- Scene: render test room (default until the real level exists; ?scene=test forces it) ----
  h.status('Building the test room…');
  await nextFrame();
  const room = buildTestRoom(scene, preset);
  const flashlight = createFlashlight(camera, preset);

  // Lightmapped surfaces: realtime lights only (never the probe grid → no double indirect).
  const lmLights = [flashlight.light, ...room.candleLights];
  if (!preset.lightmaps.lightningFlashMaps) lmLights.push(room.lightningLight);
  excludeGridFromLightmapped(room.lightmappedMaterials, lmLights);

  // ---- Light probes (dynamic objects) ----
  h.status('Baking light probes…');
  await nextFrame();
  const pc = preset.probes.cubemapSize;
  const probe = await bakeProbeGrid(renderer, scene, {
    size: [ROOM.maxX - ROOM.minX - 0.3, ROOM.height - 0.3, ROOM.maxZ - ROOM.minZ - 0.3],
    center: [0, ROOM.height / 2, 0],
    counts: [5, 3, 6],
    cubemapSize: pc,
    near: 0.05,
    far: 12,
    hide: [flashlight.light, flashlight.beam, room.dynamicGroup],
  });
  if (probe.grid) {
    scene.add(probe.grid);
    const total = probe.fenced ? `total (GPU-complete) ${probe.totalMs.toFixed(1)} ms` : 'GPU completion not measured (fence timed out)';
    console.info(`[probes] LightProbeGrid ${probe.probes} probes @ cubemap ${pc}: submit ${probe.submitMs.toFixed(1)} ms, ${total} [${backend}]`);
  } else {
    console.warn(`[probes] bake failed on ${backend}: ${probe.error}. Dynamic objects fall back to realtime lights only.`);
    scene.add(new THREE.HemisphereLight(0x303848, 0x120c08, 0.35)); // minimal fill; not added to lightmapped lightsNode
  }

  // ---- Pipeline ----
  h.status('Compiling shaders…');
  const pipeline = createPipeline(renderer, scene, camera, preset);
  const dynres = new DynamicResolution(preset.dynamicResolution, preset.sceneScale);
  const input = new Input(canvas);
  const controller = new TestController(camera, input, room.spawn, { x0: ROOM.minX, x1: ROOM.maxX, z0: ROOM.minZ, z1: ROOM.maxZ }, room.obstacles);
  camera.updateMatrixWorld(true);
  const tc = performance.now();
  try {
    // WebGL2 polls KHR_parallel_shader_compile with requestAnimationFrame, which stalls in a hidden tab: cap the
    // wait; anything not compiled yet compiles synchronously on the first frames.
    const done = await Promise.race([renderer.compileAsync(scene, camera).then(() => true), delay(15000).then(() => false)]);
    if (!done) console.warn('[game] compileAsync still pending after 15 s (hidden tab?) — continuing');
  } catch (e) {
    console.warn('[game] compileAsync failed (continuing):', e);
  }
  pipeline.render(); // warm-up frames compile the post chain behind the loading screen
  pipeline.render();
  console.info(`[game] shader compile + warm-up ${(performance.now() - tc).toFixed(0)} ms`);

  // ---- FPS overlay ----
  const overlay = new FpsOverlay(document.body);
  const extraLine = () => {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const sc = pipeline.getScale();
    const internal = pipeline.kind === 'post' ? ` · scene ${Math.round(size.x * sc)}×${Math.round(size.y * sc)}` : '';
    const eff = loop.cap.effectiveCap(settings.fpsCap, settings.fpsCapDivisorMode);
    const capText = settings.fpsCap === 0 ? 'uncapped' : `cap ${eff > 0 ? eff.toFixed(eff % 1 ? 1 : 0) : settings.fpsCap}`;
    return `${preset.label} · ${backend} · ${size.x}×${size.y}${internal}\n${capText} · ${loop.cap.refreshHz.toFixed(0)} Hz`;
  };
  overlay.setExtra(extraLine);
  overlay.setVisible(settings.showFps);

  // ---- Lightning (L, and occasionally on its own) ----
  const lightning = createLightning(ctx, pipeline.uniforms.exposure, room.lightningLight);

  // ---- Loop ----
  let paused = true;
  let lastRenderT = -1;
  const loop: Loop = new Loop(
    {
      update(dt, nowSec) {
        ctx.time.dt = dt;
        ctx.time.now = nowSec;
        ctx.time.frame = loop.frame;
        if (!paused) {
          controller.update(dt, settings);
          if (input.wasPressed('KeyL')) lightning.strike();
          if (input.wasPressed('KeyF')) flashlight.setOn(!flashlight.light.visible);
        }
        room.update(dt, nowSec);
        flashlight.update(dt, nowSec);
        lightning.update(dt, paused);
        input.endFrame();
      },
      render() {
        pipeline.render();
      },
      onRendered(t) {
        overlay.frame(t);
        if (lastRenderT >= 0 && !paused) {
          const capFps = loop.cap.effectiveCap(settings.fpsCap, settings.fpsCapDivisorMode);
          const target = Math.min(preset.targetFps, capFps > 0 ? capFps : Infinity);
          const s = dynres.update(t - lastRenderT, 1000 / target);
          if (s !== null) pipeline.setScale(s);
        }
        lastRenderT = t;
      },
    },
    {
      getCap: () => settings.fpsCap,
      getDivisorMode: () => settings.fpsCapDivisorMode,
      onVisibility: (hidden) => {
        overlay.reset();
        lastRenderT = -1;
        if (hidden && !paused) setPaused(true);
      },
    },
  );

  const onResize = () => {
    renderer.setPixelRatio(effectivePixelRatio(preset));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  // ---- Pause / pointer lock ----
  const begin = clickToBegin('Click to begin', 'WASD move · Shift walk faster · mouse look · F flashlight · L lightning · Esc pause');
  begin.hide();
  const menu = new PauseMenu(settings, presetId, {
    onResume: () => void resume(),
    onChange: (key) => {
      saveSettings(settings);
      if (key === 'showFps') overlay.setVisible(settings.showFps);
      if (key === 'fpsCap' || key === 'fpsCapDivisorMode') {
        loop.cap.reset();
        overlay.reset();
      }
      if (key === 'fovDeg') {
        camera.fov = settings.fovDeg;
        camera.updateProjectionMatrix();
      }
      ctx.events.emit('settings:changed', { key });
    },
    onReloadWithPreset: (id) => {
      settings.preset = id;
      saveSettings(settings);
      location.reload();
    },
    onRerunDeviceTest: () => {
      requestDeviceRerun();
      location.reload();
    },
    effectiveCapText: () => {
      const hz = loop.cap.refreshHz;
      if (settings.fpsCap === 0 || hz <= 0) return hz > 0 ? `display ≈ ${hz.toFixed(0)} Hz` : '';
      const eff = loop.cap.effectiveCap(settings.fpsCap, settings.fpsCapDivisorMode);
      return eff > 0 ? `≈ ${eff.toFixed(eff % 1 ? 1 : 0)} fps on this ${hz.toFixed(0)} Hz display` : `every frame on this ${hz.toFixed(0)} Hz display`;
    },
  });

  function setPaused(p: boolean) {
    paused = p;
    loop.paused = p;
    ctx.events.emit('pause', { paused: p });
    if (p) {
      if (!begin.el.isConnected || begin.el.style.display === 'none') menu.show();
    } else menu.hide();
  }
  async function resume() {
    menu.hide();
    const ok = await input.requestLock();
    if (!ok) {
      // Browser refused (cooldown right after Esc): ask for one more click.
      begin.show();
      return;
    }
  }
  input.onLockGained = () => {
    begin.hide();
    setPaused(false);
  };
  input.onLockLost = () => setPaused(true);
  begin.el.addEventListener('click', () => void input.requestLock());

  // ---- Start ----
  h.status('Ready.');
  if (h.bootRoot) h.bootRoot.style.display = 'none';
  gameRoot.style.visibility = 'visible';
  loop.start();
  begin.show();

  const expose = {
    ctx,
    renderer,
    scene,
    camera,
    pipeline,
    loop,
    overlay,
    probe,
    room,
    flashlight,
    dynres,
    lightning,
    input,
    backendReason,
    stats: () => overlay.last,
    setCap: (cap: 0 | 30 | 60, divisor = settings.fpsCapDivisorMode) => {
      settings.fpsCap = cap;
      settings.fpsCapDivisorMode = divisor;
      loop.cap.reset();
      overlay.reset();
      menu.refresh();
    },
    setShowFps: (v: boolean) => {
      settings.showFps = v;
      overlay.setVisible(v);
    },
    /** Starts simulation without pointer lock (automation / screenshots). */
    unpause: () => {
      begin.hide();
      setPaused(false);
    },
    memory: () => renderer.info.memory,
    /**
     * Renders n frames back-to-back WITHOUT rAF, fenced every 10 frames (1×1 readback), and returns the
     * mean GPU-complete frame time (throughput). Works in hidden tabs (automation) and gives a vsync-free cost estimate.
     */
    gpuFrameMs: async (n = 60) => {
      const probesMod = await import('../render/probes.ts');
      // WebGL2: a synchronous 1×1 readPixels is a reliable fence (the async readback polls with rAF → stalls in
      // hidden tabs). WebGPU: the async readback (mapAsync) resolves after all prior queue work.
      const gl = backend === 'webgl2' ? renderer.backend?.gl : null;
      const px = new Uint8Array(4);
      const gpuFence = async (r: any) => {
        if (gl) {
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          return true;
        }
        return probesMod.gpuFence(r);
      };
      await gpuFence(renderer);
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        // Without rAF the renderer's Animation loop doesn't advance the node frame, so FRAME-updated passes
        // (scene pass, TAAU, bloom …) would run once and then be skipped. Advance it like Animation does.
        renderer._nodes?.nodeFrame?.update();
        room.update(1 / 60, i / 60);
        flashlight.update(1 / 60, i / 60);
        pipeline.render();
        if (i % 10 === 9) await gpuFence(renderer); // bound the queue depth
      }
      await gpuFence(renderer);
      return (performance.now() - t0) / n;
    },
  };
  if (debug) (window as unknown as { __game: unknown }).__game = expose;
  ctx.systems.set('debug', { id: 'debug' });
  console.info(`[game] ready: preset=${presetId}, backend=${backend}, pixelRatio=${renderer.getPixelRatio()}, probes=${probe.grid ? 'ok' : 'failed'}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Lets the loading status paint. Falls back to a timeout: rAF never fires in hidden/occluded tabs. */
function nextFrame(): Promise<void> {
  return new Promise((r) => {
    let done = false;
    const go = () => {
      if (!done) {
        done = true;
        r();
      }
    };
    requestAnimationFrame(go);
    setTimeout(go, 50);
  });
}

/** Lightning pulses: uLightning (flash lightmaps, window), realtime spot, exposure kick. Reduced flash softens it. */
function createLightning(ctx: GameContext, exposure: any, spot: any) {
  let t = -1; // time since strike (s); <0 = idle
  let pulses: Array<{ at: number; peak: number; len: number }> = [];
  let auto = 18 + Math.random() * 20;
  const SPOT_PEAK = 90; // candela
  return {
    strike() {
      const r = ctx.settings.reducedFlash;
      const peak = r ? 0.3 : 1;
      pulses = [
        { at: 0, peak: peak * 0.55, len: 0.07 },
        { at: 0.12, peak, len: 0.16 },
        { at: 0.38 + Math.random() * 0.2, peak: peak * 0.7, len: 0.22 },
      ];
      if (r) pulses = pulses.map((p) => ({ ...p, len: p.len * 2.5 }));
      t = 0;
      ctx.events.emit('lightning', { strength: peak, durationMs: 800 });
      ctx.events.emit('thunder', { delayMs: 1500 + Math.random() * 2500, durationMs: 4000, distance: 1 });
    },
    update(dt: number, paused: boolean) {
      if (!paused) {
        auto -= dt;
        if (auto <= 0) {
          auto = 25 + Math.random() * 25;
          this.strike();
        }
      }
      let level = 0;
      if (t >= 0) {
        t += dt;
        for (const p of pulses) {
          const x = (t - p.at) / p.len;
          if (x >= 0 && x <= 1) level = Math.max(level, p.peak * (x < 0.15 ? x / 0.15 : Math.pow(1 - (x - 0.15) / 0.85, 1.8)));
        }
        if (t > 1.2) t = -1;
      }
      uLightning.value = level;
      spot.intensity = SPOT_PEAK * level;
      exposure.value = 1 + 0.18 * level;
    },
  };
}
