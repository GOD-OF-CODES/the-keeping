// Game entry — reached ONLY via `import('../game/main.ts')` from the boot page after Start.
// Builds the GameContext, renderer (backend chosen before construction), pipeline, loop, FPS overlay, input and
// pause menu, then the scene:
//   default        → THE LEVEL (src/world/level.ts) at spawn CP1 (outside at the gate); ?spawn=<id> picks another
//                    layout spawn. Falls back to the render test room if the tier's assets are missing.
//   ?scene=test    → the render test room (src/game/test-room.ts)
//   ?scene=matlab  → material lab (src/materials)          ?scene=audiolab → audio lab (src/audio/lab.ts)
// Debug: ?debug exposes window.__game (teleport, rooms, flags, doors, culling, noclip …). ?backend=webgl forces
// the WebGL2 backend. Update order: input → player/hides → world → audio → render.

import * as THREE from 'three/webgpu';
import type { BootHandoff } from '../boot/handoff.ts';
import { requestDeviceRerun, saveSettings } from '../boot/store.ts';
import { EventBus } from '../core/events.ts';
import { FpsOverlay } from '../core/fps-overlay.ts';
import { Input } from '../core/input.ts';
import { Loop } from '../core/loop.ts';
import { PRESETS, type PresetConfig } from '../render/presets.ts';
import { createRenderer, effectivePixelRatio } from '../render/renderer.ts';
import { createPipeline, type Pipeline } from '../render/pipeline.ts';
import { DynamicResolution } from '../render/dynres.ts';
import { createFlashlight } from '../render/flashlight.ts';
import { syncSurfaceLook } from '../render/surfaces.ts'; // LIGHTING lane (builder 2)
import { LightmapMaterial, uLightning } from '../render/lightmap-material.ts';
import { bakeProbeGrid, excludeGridFromLightmapped } from '../render/probes.ts';
import { deferCompileWaits, installParallelCompile } from '../render/parallel-compile.ts';
import { requestExposureSnap } from '../render/exposure.ts';
import { installPerf, perfBuildClasses, perfBuilds, perfLog, perfMark } from '../render/perf.ts';
import { SHADOW_CANDLE_ID, setCandleShadow } from '../world/lights.ts';
import type { GameContext } from './context.ts';
import type { LevelLayout, TriggerVolume } from '../shared/layout-types.ts';
import layoutJson from '../shared/level-layout.json';
import { buildTestRoom, ROOM } from './test-room.ts';
import { TestController } from './test-controller.ts';
import { PauseMenu, clickToBegin } from './pause-menu.ts';
import { setWearView } from '../materials/wear.ts';

/** String literal that survives minification; scripts/verify-boot.mjs asserts it never reaches the boot chunk. */
export const GAME_CHUNK_MARKER = 'the-keeping:game-runtime';

/** What a scene (level or test room) plugs into the shared loop. */
interface SceneRuntime {
  beginText: [string, string];
  /** Game logic for one frame (dt = 0 while paused is NOT passed: `paused` tells). */
  update(dt: number, now: number, paused: boolean, lightning: number): void;
  /** Same without input (automation: gpuFrameMs). */
  step(dt: number, t: number, lightning: number): void;
  expose: Record<string, unknown>;
}

export async function startGame(h: BootHandoff): Promise<void> {
  console.info(`[game] ${GAME_CHUNK_MARKER} three r${THREE.REVISION}`);
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');
  if (params.has('tslstack')) (THREE as any).Node.captureStackTrace = true; // debug: TSL build errors name their source
  LightmapMaterial.stockModel = params.get('lmmodel') === '0'; // LIGHTING lane debug A/B (item 5 load cost)
  const settings = h.settings;
  const presetId = settings.preset;
  const preset = PRESETS[presetId];
  const forceWebGL = settings.forceWebGL || params.get('backend') === 'webgl';
  const sceneParam = params.get('scene');
  if (sceneParam === 'matlab') return (await import('./matlab.ts')).startMatlab(h); // material lab (src/materials)
  if (sceneParam === 'audiolab') {
    if (h.bootRoot) h.bootRoot.style.display = 'none';
    return (await import('../audio/lab.ts')).startAudioLab(document.body, { context: h.audioContext, settings });
  }

  const gameRoot = document.getElementById('game') ?? document.body;
  gameRoot.style.display = 'block';
  gameRoot.style.visibility = 'hidden'; // keep the boot card (with status text) visible while loading

  h.status('Starting the renderer…');
  const { renderer, canvas, backend, backendReason } = await createRenderer(preset, { forceWebGL, parent: gameRoot });
  installPerf(renderer, debug);
  if (params.get('pcompile') !== '0') installParallelCompile(renderer); // runtime lane E item 1: batched pipeline compiles

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(settings.fovDeg, window.innerWidth / window.innerHeight, 0.03, 90);
  scene.add(camera); // flashlight rigs hang off the camera or follow it: keep it in the graph

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
    layout: layoutJson as unknown as LevelLayout,
    debug,
    systems: new Map(),
    flags: new Map(),
  };
  const input = new Input(canvas);

  // ---- Scene
  let runtime: SceneRuntime | null = null;
  let lightningHooks: LightningHooks = { exposureScale: 1 };
  if (sceneParam !== 'test') {
    try {
      const r = await startLevel(h, ctx, input, params);
      runtime = r.runtime;
      lightningHooks = r.lightning;
    } catch (e) {
      console.warn('[game] level failed to load — falling back to the render test room:', e);
      document.querySelectorAll('.tk-loading-overlay').forEach((n) => n.remove());
    }
  }
  if (!runtime) {
    const r = await startTestRoom(h, ctx, input, preset, backend);
    runtime = r.runtime;
    lightningHooks = r.lightning;
  }
  const rt = runtime;

  // ---- Pipeline
  h.status('Compiling shaders…');
  const pipeline = createPipeline(renderer, scene, camera, preset);
  (rt.expose.setPipeline as ((p: Pipeline) => void) | undefined)?.(pipeline);
  const dynres = new DynamicResolution(preset.dynamicResolution, preset.sceneScale);
  camera.updateMatrixWorld(true);
  const tc = performance.now();
  perfMark('warmup');
  // PERF-PLAN P0-1: compile in the context the frame is drawn in (pipeline.compileView), per room with culling on —
  // never renderer.compileAsync(scene, camera), whose default-context variants no frame of ours ever uses.
  const compileView = async () => {
    const slow = setTimeout(() => console.warn('[game] shader compile still running after 20 s (hidden tab?) — waiting'), 20000);
    try {
      await pipeline.compileView();
    } catch (e) {
      console.warn('[game] compileView failed (continuing):', e);
    } finally {
      clearTimeout(slow);
    }
  };
  const frame = () => {
    renderer._nodes?.nodeFrame?.update(); // new node frame, or FRAME-updated passes (scene pass …) are skipped
    pipeline.render();
  };
  const warm = rt.expose.afterCompile as ((render: () => void, compile: () => Promise<void>) => Promise<void>) | undefined;
  // runtime lane E (item 1): node builds stay serial, every pipeline compiles in parallel; awaited once at the end
  if (warm) await deferCompileWaits(() => warm(frame, compileView));
  else await compileView();
  perfMark('firstFrame');
  frame();
  // PERF (review): the cutscene DoF chain builds its post passes on first use (measured: ~16 node builds at the first
  // DoF cut). Build it once here, behind the loading screen; chains are cached per key in the pipeline.
  if (preset.post.cutsceneDof && pipeline.kind === 'post') {
    pipeline.setCutscene({ dof: { focusDistance: 2, focalLength: 0.5, bokehScale: 2 } });
    frame();
    pipeline.setCutscene(null);
    frame();
  }
  console.info(`[game] shader compile + warm-up ${(performance.now() - tc).toFixed(0)} ms`);
  perfMark('setup');

  // ---- FPS overlay
  const overlay = new FpsOverlay(document.body);
  const extraLine = () => {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const sc = pipeline.getScale();
    const internal = pipeline.kind === 'post' ? ` · scene ${Math.round(size.x * sc)}×${Math.round(size.y * sc)}` : '';
    const eff = loop.cap.effectiveCap(settings.fpsCap, settings.fpsCapDivisorMode);
    const capText = settings.fpsCap === 0 ? 'uncapped' : `cap ${eff > 0 ? eff.toFixed(eff % 1 ? 1 : 0) : settings.fpsCap}`;
    const where = (rt.expose.whereText as (() => string) | undefined)?.() ?? '';
    return `${preset.label} · ${backend} · ${size.x}×${size.y}${internal}\n${capText} · ${loop.cap.refreshHz.toFixed(0)} Hz${where ? `\n${where}` : ''}`;
  };
  overlay.setExtra(extraLine);

  // ---- Lightning (L, and on the story's storm cadence)
  const lightning = createLightning(ctx, pipeline, lightningHooks);
  (rt.expose.attachLightning as ((l: typeof lightning) => void) | undefined)?.(lightning);
  if (sceneParam === 'cutscene') await (await import('../cutscenes/preview.ts')).installCutscenePreview(rt as any, { ctx, pipeline, params, input, canvas, lightning });

  // ---- Loop
  let paused = true;
  let lastRenderT = -1;
  // the pause menu owns the keyboard: nothing pressed under it acts once play resumes (advance() plays as unpaused)
  let advancing = false;
  input.addBlocker(() => paused && !advancing);
  const loop: Loop = new Loop(
    {
      update(dt, nowSec) {
        ctx.time.dt = dt;
        ctx.time.now = nowSec;
        ctx.time.frame = loop.frame;
        if (!paused && ctx.debug && input.wasPressed('KeyL')) lightning.strike(); // debug only: thunder masks every noise
        lightning.update(dt, paused);
        rt.update(dt, nowSec, paused, lightning.level);
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

  overlay.setVisible(settings.showFps); // after `loop` exists: extraLine reads it

  const onResize = () => {
    renderer.setPixelRatio(effectivePixelRatio(preset));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  // ---- Pause / pointer lock
  const begin = clickToBegin(rt.beginText[0], rt.beginText[1]);
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
    if (input.locked) {
      // already locked (the lock came back before the menu click): just continue
      menu.hide();
      setPaused(false);
      return;
    }
    const ok = await input.requestLock();
    if (!ok) {
      // Browser refused (cooldown right after Esc): ask for one more click. The menu stays until the lock is gained.
      menu.hide();
      begin.show();
    }
  }
  input.onLockGained = () => {
    begin.hide();
    menu.hide();
    setPaused(false);
  };
  input.onLockError = () => {
    // never leave the player paused with no UI
    if (paused) {
      menu.hide();
      begin.show();
    }
  };
  input.onLockLost = () => setPaused(true);
  begin.el.addEventListener('click', () => void input.requestLock());

  // ---- Start
  h.status('Ready.');
  (rt.expose.onReady as (() => void) | undefined)?.();
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
    dynres,
    lightning,
    input,
    backendReason,
    ...rt.expose,
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
    /** Node builds so far (diff around a beat: > 0 = a shader variant compiled at runtime) and the load phases. */
    builds: () => perfBuilds(),
    perfLog: () => perfLog(),
    buildClasses: () => perfBuildClasses(),
    /**
     * Debug screenshot that works in hidden/occluded tabs: renders the pipeline into a render target, reads it back
     * and returns a JPEG data URL (w px wide; AgX output is already display-referred — sRGB-encoded here).
     */
    capture: async (w = 640) => {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      const h = Math.round((w * size.y) / size.x);
      const rtg = new THREE.RenderTarget(w, h, { type: THREE.UnsignedByteType }); // output is already display-encoded
      renderer._nodes?.nodeFrame?.update();
      // P1-6c: the OUTPUT target, so the frame goes through the same output path as on screen (Low: AgX / grade / FXAA)
      // in the same render contexts — no capture-only shader variants
      renderer.setOutputRenderTarget(rtg);
      try {
        pipeline.render();
      } finally {
        renderer.setOutputRenderTarget(null);
      }
      const px = await renderer.readRenderTargetPixelsAsync(rtg, 0, 0, w, h);
      rtg.dispose();
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g2 = c.getContext('2d')!;
      const img = g2.createImageData(w, h);
      const flipY = backend === 'webgl2';
      for (let y = 0; y < h; y++) {
        const sy = flipY ? h - 1 - y : y;
        img.data.set(px.subarray(sy * w * 4, sy * w * 4 + w * 4), y * w * 4);
      }
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
      g2.putImageData(img, 0, 0);
      return c.toDataURL('image/jpeg', 0.8);
    },
    /**
     * Advances the game n frames WITHOUT rAF (hidden tabs / automation): full update (as if unpaused) + render.
     * Optional `keys` are held down during the frames (KeyboardEvent.code, e.g. ['KeyW', 'ShiftLeft']).
     */
    advance: async (n = 1, dt = 1 / 60, keys: string[] = []) => {
      for (const k of keys) input.down.add(k);
      advancing = true;
      try {
        for (let i = 0; i < n; i++) {
          renderer._nodes?.nodeFrame?.update();
          const now = ctx.time.now + dt;
          ctx.time.dt = dt;
          ctx.time.now = now;
          lightning.update(dt, false);
          rt.update(dt, now, false, lightning.level);
          input.endFrame();
          pipeline.render();
          if (i % 20 === 19) await new Promise((r) => setTimeout(r, 0));
        }
      } finally {
        advancing = false;
        for (const k of keys) input.down.delete(k);
      }
      return rt.expose.whereText ? (rt.expose.whereText as () => string)() : '';
    },
    /** Measures `n` fenced frames of pure rendering at the current view: mean ms. */
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
        rt.step(1 / 60, i / 60, 0);
        pipeline.render();
        if (i % 10 === 9) await gpuFence(renderer); // bound the queue depth
      }
      await gpuFence(renderer);
      return (performance.now() - t0) / n;
    },
  };
  // PROPS-FINISH §5.4: __game.debug.wearView(0..3 | 4 composite | null) shows the Blender wear masks (props lane)
  (expose as Record<string, unknown>).debug = { ...((expose as Record<string, unknown>).debug as object | undefined), wearView: setWearView };
  if (debug) (window as unknown as { __game: unknown }).__game = expose;
  ctx.systems.set('debug', { id: 'debug' });
  perfMark('play');
  console.info(`[game] ready: preset=${presetId}, backend=${backend}, pixelRatio=${renderer.getPixelRatio()}`);
}

// ================================================================================================ the level

async function startLevel(h: BootHandoff, ctx: GameContext, input: Input, params: URLSearchParams): Promise<{ runtime: SceneRuntime; lightning: LightningHooks }> {
  const { renderer, scene, camera, preset } = ctx;
  const [{ loadLevel, SKY_COLOR }, { LoadingOverlay }, { FlashlightRig }, { PlayerController }, { HideSystem }, { Interactables, bindDefaultInteractions }, { Inventory, Journal }, coords] =
    await Promise.all([
      import('../world/level.ts'),
      import('../world/loading-overlay.ts'),
      import('../player/flashlight-rig.ts'),
      import('../player/controller.ts'),
      import('../world/hides.ts'),
      import('../world/interactables.ts'),
      import('../player/inventory.ts'),
      import('../shared/coords.ts'),
    ]);
  const overlay = new LoadingOverlay(
    [
      { id: 'download', label: 'Downloading the house', weight: 40 },
      { id: 'parse', label: 'Unpacking', weight: 6 },
      { id: 'materials', label: 'Generating materials', weight: 20 },
      { id: 'collision', label: 'Building collision', weight: 3 },
      { id: 'probes', label: 'Baking light probes', weight: 14 },
      { id: 'audio', label: 'Synthesizing sound', weight: 10 },
      { id: 'compile', label: 'Compiling shaders', weight: 7 },
    ],
    (t) => h.status(t),
  );
  overlay.el.classList.add('tk-loading-overlay');
  if (h.bootRoot) h.bootRoot.style.display = 'none';

  const rig = new FlashlightRig(scene, camera, preset);
  if (params.get('bounce') === '0') rig.flashlight.bounce = null; // LIGHTING lane debug A/B (item 11 GPU cost)

  // Audio prerender runs while the house downloads (it needs ctx.layout, already the real layout).
  const audioP = (async () => {
    try {
      const { createAudioSystem } = await import('../audio/engine.ts');
      return await createAudioSystem(ctx, { context: h.audioContext, onProgress: (f: number, l: string) => overlay.set('audio', f, l) });
    } catch (e) {
      console.warn('[game] audio unavailable:', e);
      return null;
    } finally {
      overlay.set('audio', 1);
    }
  })();

  let level: Awaited<ReturnType<typeof loadLevel>>;
  try {
    perfMark('download');
    level = await loadLevel({ ctx, renderer, scene, preset, presetId: ctx.presetId, overlay, flashlight: rig.flashlight });
    perfMark('story');
  } catch (e) {
    overlay.remove();
    scene.remove(rig.rig);
    throw e;
  }
  const audio: any = await audioP;

  // ---- player, hides, interaction
  const player = new PlayerController(camera, input, ctx, { collision: level.collision, index: level.index, room: () => level.room });
  const hides = new HideSystem(ctx, camera, player, input, audio);
  const inventory = new Inventory(ctx);
  const journal = new Journal();
  input.addBlocker(() => journal.open); // ← / → turn its pages: never a strafe, not even after it closes
  const interact = new Interactables(camera, input, level);
  const toastEl = makeToast();
  // Hiding: the torch goes off inside (a lit wardrobe gives you away); it comes back on as you step out.
  let torchBeforeHide = true;
  ctx.events.on('player:hide', ({ inside }) => {
    if (inside) {
      torchBeforeHide = rig.on;
      rig.setOn(false);
      // runtime lane E (item 9): the hide is a cut in light level (torch off, eye pressed to the slats); at the
      // brightening τ 6 s the first seconds showed only near-black bars (playthrough frame ptmed-05) — adapt to the
      // first reading taken inside, so the candle-lit hall reads between the louvres from the start
      requestExposureSnap();
    } else rig.setOn(torchBeforeHide);
  });
  bindDefaultInteractions(interact, { ctx, level, doors: level.doors, hides, inventory, journal, sound: audio, toast: toastEl.show });
  if (audio) {
    level.doors.setSound(audio);
    player.setAudio(audio);
    audio.setDoorStateProvider(level.doors.isOpenFn);
    audio.setLayout?.(ctx.layout);
  }

  // ---- written surfaces (signs, guest book, letter, plates, chalk): our stroke font on CanvasTextures
  try {
    const { bindDecals } = await import('../world/decals.ts');
    const drawn = bindDecals(level.root, { anisotropy: preset.textures.anisotropy });
    console.info(`[level] decals drawn: ${drawn.length}`);
  } catch (e) {
    console.warn('[level] decals failed:', e);
  }

  // ---- story: Director (Ada's brain + beats), characters, voices
  overlay.set('compile', 0.1, 'characters');
  const { createStoryRuntime } = await import('./story-runtime.ts');
  const story = await createStoryRuntime({ ctx, input, level, player, hides, rig, inventory, journal, interact, audio, toast: toastEl.show, params });

  const spawnId = params.get('spawn') ?? 'CP1';
  const teleport = (id: string): boolean => {
    const s = level.spawn(id);
    if (!s) return false;
    if (hides.active) hides.exit();
    player.teleport(s.eye, s.yaw, s.pitch);
    rig.snap();
    const pf = player.planFeet();
    level.setViewer(pf[0], pf[1], pf[2]);
    return true;
  };
  if (!teleport(spawnId)) {
    console.warn(`[game] unknown spawn '${spawnId}' — using CP1`);
    teleport('CP1');
  }

  // ---- per-frame state
  let peek: { dist: number; yaw: number } | null = null; // runtime lane E item 8 (debug posePeek)
  const peekV = new THREE.Vector3();
  let torchPending = false;
  let lastRoom: string | null = null;
  let weatherKey = '';
  let insideTriggers = new Set<string>();
  let triggersNow = new Set<string>();
  const triggerHits: TriggerVolume[] = [];
  const fog = new THREE.FogExp2(new THREE.Color(0.012, 0.014, 0.019), 0.0);
  scene.fog = fog;
  // LIGHTING lane: sky, fog, lightning shadow, exposure, white balance (src/world/atmosphere.ts, REALISM-BACKLOG)
  const { Atmosphere } = await import('../world/atmosphere.ts');
  const atmo = new Atmosphere({ renderer, scene, camera, fog, preset, lightningDir: level.lights.lightningDir, events: ctx.events });
  let warmPipe: Pipeline | null = null; // runtime lane D: the load warm-up also draws the opening through the DOF chain
  // LIGHTING lane (REALISM-BACKLOG item 6): box-projected per-room reflection cubes (Medium/Max), hooked into the
  // glossy materials BEFORE the first compile and captured once from the lightmapped house (src/render/reflections.ts)
  // LIGHTING lane (item 11): the torch beam's bounce light (src/render/flashlight-bounce.ts)
  const { FlashlightBounce } = await import('../render/flashlight-bounce.ts');
  const torchBounce = new FlashlightBounce(rig.flashlight, [level.root], level.collision);
  let refl: import('../render/reflections.ts').RoomReflections | null = null;
  // (WebGPU only: WebGL compiles every program synchronously and the cube context's shaders differ from the frame's
  //  — the capture alone took 51 s on WebGL2 Medium, measured — so the WebGL2 fallback keeps no reflections)
  if (ctx.presetId !== 'low' && !renderer.backend?.isWebGLBackend && params.get('refl') !== '0') {
    try {
      const { RoomReflections } = await import('../render/reflections.ts');
      refl = new RoomReflections({ renderer, scene, camera, layout: ctx.layout, roomGroups: level.roomGroups, doors: level.doors.doors.values(), darken: [rig.flashlight.light], keep: [level.root], extra: (c, m) => (m.isLightmapMaterial ? level.lightmapped : level.probeLit).push(c) });
      await refl.capture(); // first: the cube context renders the materials as they are (no reflection code built there)
      refl.attach();
      console.info(`[reflections] ${JSON.stringify(refl.stats)}`);
    } catch (e) {
      console.warn('[reflections] disabled:', e);
      refl = null;
    }
  }

  const world = (dt: number, t: number, lightning: number) => {
    // culling + room from the camera (hides move the camera, not the body)
    const cp = coords.worldToPlan([camera.position.x, camera.position.y, camera.position.z]);
    const feetZ = hides.active ? hides.active.entry[2] : player.planFeet()[2];
    const changed = level.setViewer(cp[0], cp[1], feetZ);
    level.updateWindowCull(camera.position, t); // RUNTIME F2
    const outside = level.isOutside();
    if (changed || lastRoom === null) {
      lastRoom = level.room;
      if (audio && level.room) audio.setListenerRoom(level.room);
    }
    // weather bed follows where you are (porch roof overhead = rain on the porch roof)
    if (audio) {
      const surf = outside ? (player.surface === 'porch_wood' ? 'porch' : 'gravel') : 'roof';
      const key = `${outside}|${surf}|${story.rain()}`;
      if (key !== weatherKey) {
        weatherKey = key;
        audio.layers.setWeather({ rain: story.rain(), wind: (outside ? 0.8 : 0.5) * (story.rain() > 0 ? 1 : 0.35), inside: outside ? 0 : 1, surface: surf });
      }
    }
    level.update(dt, t, lightning);
    story.lateUpdate();
    if (peek && story.ada) {
      // runtime lane E item 8 (debug only): Ada held `peek.dist` m in front of the camera, facing it, feet on the
      // player's floor — her brain is parked ('hold' far away), so the director can neither move nor catch.
      const g = story.ada.group;
      camera.getWorldDirection(peekV);
      peekV.y = 0;
      peekV.normalize();
      const pf = coords.planToWorld(player.planFeet());
      g.position.set(camera.position.x + peekV.x * peek.dist, pf[1], camera.position.z + peekV.z * peek.dist);
      g.rotation.y = Math.atan2(-peekV.x, -peekV.z) + peek.yaw;
      g.visible = true;
      g.updateMatrixWorld(true);
    }
    rig.update(dt, t);
    // sky + flash, fog (mist in B12/C6), C6's blue hour, exposure, white balance (LIGHTING lane)
    atmo.update(dt, lightning, outside, level.room, story.mist(), story.skyTint());
    refl?.update(lightning, camera, story.skyTint()); // LIGHTING lane (items 6, 19): flash, camera-in-room, dawn re-capture
    torchBounce.update(dt, rig.on); // LIGHTING lane (item 11): beam bounce at the hit point
    syncSurfaceLook(rig.flashlight, torchBounce, story.skyTint()); // LIGHTING lane (items 5, 6, 11, 19): look → uniforms
  };

  const runtime: SceneRuntime = {
    beginText: ['Click to begin', 'WASD move · Shift run · C crouch · mouse look · E interact · F flashlight · Space hold breath · RMB raise the locket · Tab journal · Esc pause'],
    update(dt, now, paused, lightning) {
      if (!paused) {
        hides.update(dt);
        player.update(dt, now);
        const csLocked = story.inputLocked();
        if (input.wasPressed('KeyF') && !torchPending && !csLocked) {
          // thumb reaches the slide switch at 0.2 s into arms_flashlight_toggle: click + light together
          story.arms?.play('arms_flashlight_toggle');
          torchPending = true;
          setTimeout(() => {
            torchPending = false;
            if (paused || story.inputLocked()) return; // a pause / cutscene began inside the 200 ms: no toggle
            rig.toggle();
            audio?.play('flashlight_click', { gain: 0.6 });
          }, story.arms ? 200 : 0);
        }
        if (input.uiPressed('Tab') && (journal.open || (!input.blocked && !csLocked))) journal.toggle();
        // story triggers (enter only): forwarded as `interact { id: trigger id, action: trigger event }`
        const [px, py, pz] = player.planFeet();
        // reused buffers (no per-frame arrays / Sets): hits → triggersNow, then the two Sets swap
        triggersNow.clear();
        for (const t of level.index.triggersAt(px, py, pz, triggerHits)) {
          if (triggersNow.has(t.id)) continue;
          triggersNow.add(t.id);
          if (!insideTriggers.has(t.id)) {
            ctx.events.emit('interact', { id: t.id, action: t.event });
            if (ctx.debug) console.info(`[trigger] ${t.id} → ${t.event}`);
          }
        }
        const prevInside = insideTriggers;
        insideTriggers = triggersNow;
        triggersNow = prevInside;
      }
      story.update(paused ? 0 : dt, paused);
      world(paused ? 0 : dt, now, lightning);
      interact.update(dt, !paused && !hides.active);
      audio?.update(paused ? 0 : dt, ctx);
    },
    step(dt, t, lightning) {
      world(dt, t, lightning);
    },
    expose: {
      attachLightning: story.attachLightning,
      setPipeline: (p: Pipeline) => {
        warmPipe = p;
        story.setPipeline(p);
        atmo.setPipeline(p); // LIGHTING lane: exposure meter reads the pipeline's scene texture
      },
      story,
      characters: story.characters,
      cutscenes: story.cutscenes,
      director: story.director,
      brain: story.director.brain,
      ada: story.ada,
      harlan: story.harlan,
      arms: story.arms,
      voice: story.voice,
      beat: () => story.director.story.beat,
      storyState: () => story.director.story.s,
      level,
      player,
      hides,
      inventory,
      journal,
      interact,
      audio,
      flashlight: rig.flashlight,
      rig,
      doors: level.doors,
      /**
       * Load-time shader warm-up (PERF-PLAN P0-1/P0-2). Walks the camera through every playable room's centre, 4
       * headings, culling ON: `compile()` builds the room's pipelines asynchronously in the context the frame is drawn
       * in, then one synchronous render per heading creates the shadow-pass objects (shadow maps share one depth
       * material, so that adds few programs). Then the special sets: the C2 tableau (Ada + Harlan + the table candle,
       * whose shadow light is fixed from load — no castShadow toggles) and the car set / your car in the row.
       * Each step logs `[game] warm <step> <ms> builds=<n>` so a stall names its step.
       */
      afterCompile: async (render: () => void, compile: () => Promise<void>) => {
        const t0 = performance.now();
        level.setCulling(true);
        const saved = player.eye();
        const yaw = player.yaw;
        const pitch = player.pitch;
        const fov = camera.fov;
        camera.fov = Math.max(fov, 100); // taller frustum: floors + ceilings in the same 4 headings
        camera.updateProjectionMatrix();
        overlay.set('compile', 0.3, 'warming rooms');
        const rooms = ctx.layout.rooms.filter((r) => r.kind !== 'set');
        // runtime lane E (item 1): every step names itself — the Max "stall at U4T" was the unlabelled tableau /
        // car-set / rc9 steps compiling cold for 5 min behind the last room's label
        let cf = 0.3;
        const step = async (label: string, place: () => void, headings: number[]) => {
          overlay.set('compile', cf, label);
          if (cf >= 0.9) cf = Math.min(0.99, cf + 0.015);
          const ts = performance.now();
          const b0 = perfBuilds();
          place();
          for (const rot of headings) {
            camera.rotation.set(-0.2, rot, 0);
            camera.updateMatrixWorld(true);
            rig.snap();
            rig.update(0.016, 0);
            await compile();
          }
          for (const rot of headings) {
            camera.rotation.set(-0.2, rot, 0);
            camera.updateMatrixWorld(true);
            rig.snap();
            rig.update(0.016, 0);
            render();
          }
          // runtime lane E (item 3): the arms' car-light set (C0/C1 driver POV), in the frame's own context too
          if (label.startsWith('rc9') && story.arms) {
            const arms = story.arms;
            const was = arms.visible;
            arms.visible = true;
            arms.useCarLights(true);
            for (const rot of headings) {
              camera.rotation.set(-0.2, rot, 0);
              camera.updateMatrixWorld(true);
              rig.snap();
              rig.update(0.016, 0);
              render();
            }
            arms.useCarLights(false);
            arms.visible = was;
          }
          // runtime lane D (fz7.mjs): with the cutscene DOF chain on, the scene pass draws in ANOTHER render context
          // (ctx 15 vs 10), so every road object warmed here was node-built again at C0's DOF cuts (12.5 / 19.0 /
          // 22.0 s: 1.1–2.9 s freezes on Medium). The opening steps also draw their headings through the DOF chain.
          if (label.startsWith('rc9') && preset.post.cutsceneDof && warmPipe?.kind === 'post') {
            // runtime lane E (item 3, cut2.mjs): the first DOF cut (C0 12.5, driver POV) built the 7 FP-arm meshes in
            // the DOF scene-pass context (0.28 s Medium, 0.4 s Max) — draw them through the DOF chain here too
            const arms = story.arms;
            const armsWas = arms?.visible;
            if (arms) arms.visible = true;
            warmPipe.setCutscene({ dof: { focusDistance: 30, focalLength: 40, bokehScale: 1.5 } });
            for (const car of [false, true]) {
              arms?.useCarLights(car); // both of the arms' light sets (FpArms.setLightSets), in the DOF context
              for (const rot of headings) {
                camera.rotation.set(-0.2, rot, 0);
                camera.updateMatrixWorld(true);
                rig.snap();
                rig.update(0.016, 0);
                render();
              }
            }
            arms?.useCarLights(false);
            warmPipe.setCutscene(null);
            if (arms) arms.visible = !!armsWas;
          }
          // C2-ESCAPE B11: C2 / C2c draw through the DOF chain, the DOF + motion-blur chain (C2 switches the blur variant in
          // at t = 0 and only moves its amount) and the blur-only chain (C2c): build the parlor + characters + the blood
          // in those scene-pass contexts now, not at C2's first frame / the strike / the whip
          if (label === 'tableau' && warmPipe?.kind === 'post' && preset.post.cutsceneDof) {
            const chains: Array<{ dof?: { focusDistance: number; focalLength: number; bokehScale: number }; motionBlur?: number }> = [{ dof: { focusDistance: 2.73, focalLength: 0.8, bokehScale: 2 } }];
            if (preset.post.cutsceneMotionBlur) chains.push({ dof: { focusDistance: 2.73, focalLength: 0.8, bokehScale: 2 }, motionBlur: 0 }, { motionBlur: 0 });
            for (const c of chains) {
              warmPipe.setCutscene(c);
              for (const rot of headings) {
                camera.rotation.set(-0.15, rot, 0);
                camera.updateMatrixWorld(true);
                render();
              }
            }
            warmPipe.setCutscene(null);
          }
          console.info(`[game] warm ${label} ${(performance.now() - ts).toFixed(0)} ms builds=${perfBuilds() - b0}`);
          await nextFrame();
        };
        const four = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
        let k = 0;
        for (const r of rooms) {
          const e = level.index.elevationOf(r.id);
          const cx = (r.rect[0] + r.rect[2]) / 2;
          const cy = r.kind === 'exterior' ? Math.min(r.rect[3], -3) - 6 : (r.rect[1] + r.rect[3]) / 2;
          await step(
            r.id,
            () => {
              const eye = coords.planToWorld([cx, cy, e + 1.6]);
              camera.position.set(eye[0], eye[1], eye[2]);
              level.setViewer(cx, cy, e);
            },
            four,
          );
          cf = 0.3 + (0.6 * ++k) / rooms.length;
          overlay.set('compile', cf, r.id);
        }
        // C2 tableau: Ada + Harlan at the table (their shadow-casting / receiving variants: C2, C5's shadow-play and
        // C7 reuse the table candle, whose shadow is always on in the LightsNodes — RuntimeLights, P0-2)
        if (ctx.layout.rooms.some((r) => r.id === 'G2')) {
          story.warmTableau(true);
          // PERF (review): unmute the candle's cube shadow for this step so its shadow-pass render objects (parlor
          // props, Ada, Harlan) build now — measured ~470 node builds / +146 programs at C2's first shadow frame else
          const candle = (level.lights.shadow ?? level.lights.flickers.find((f) => f.def.id === SHADOW_CANDLE_ID))?.light; // C2-ESCAPE K3: the lamp
          if (candle) setCandleShadow(candle, true);
          const e = level.index.elevationOf('G2');
          await step(
            'tableau',
            () => {
              const eye = coords.planToWorld([3.3, 1.5, e + 1.6]);
              camera.position.set(eye[0], eye[1], eye[2]);
              level.setViewer(3.3, 1.5, e);
            },
            [-Math.PI / 2 + 0.3],
          );
          if (candle) setCandleShadow(candle, false);
          story.warmTableau(false);
        }
        // the CAR set (C1/C7 interior: rain overlay, cluster, lamps) and your car in the row (shown at C3's flash)
        {
          const row = level.prop('P_CAR_ROW');
          const rowWas = row?.visible;
          if (row) row.visible = true;
          await step(
            'car-set',
            () => {
              const setEye = coords.planToWorld([100.45, 1.35, 1.1]);
              camera.position.set(setEye[0], setEye[1], setEye[2]);
              level.setViewer(100.45, 1.35, 0);
            },
            four,
          );
          const rowEye = coords.planToWorld([9.5, -5.5, 1.7]);
          const look = new THREE.Vector3(...coords.planToWorld([13.4, -1.6, 0.6]));
          await step(
            'car-row',
            () => {
              camera.position.set(rowEye[0], rowEye[1], rowEye[2]);
              level.setViewer(9.5, -5.5, 0);
            },
            [Math.atan2(-(look.x - rowEye[0]), -(look.z - rowEye[2]))],
          );
          if (row) row.visible = !!rowWas;
        }
        // County Road 9 (C0 / C1, opening builder 2): gameplay's 90 m far plane never reaches the billboard, diner, EAT
        // sign, truck, guide sign, shields, deer or most corridor chunks — compile them from above the road with the C0
        // aerial range (near 1 / far 2000), else their first frame inside the cutscene compiles (a hitch)
        if (level.prop('P_RC9_BILLBOARD')) {
          const near0 = camera.near;
          const far0 = camera.far;
          camera.near = 1;
          camera.far = 2000;
          camera.updateProjectionMatrix();
          await step(
            'rc9',
            () => {
              const eye = coords.planToWorld([600, -150, 60]);
              camera.position.set(eye[0], eye[1], eye[2]);
              level.setViewer(600, -150, 0);
              // runtime lane E (item 7, s1max: 683 ms at C0 9.0): the corridor's trees now cast into the lightning's
              // map, whose shadow-pass render objects were only built at the first strike. Draw that map once here,
              // with the aerial strike's ±110 m box over the road below (geometry instancing shares the builds per
              // material, so one stretch of corridor covers every chunk).
              const ld = level.lights.lightningDir;
              const sc = ld.shadow.camera;
              sc.left = -110;
              sc.right = 110;
              sc.top = 110;
              sc.bottom = -110;
              sc.far = 320;
              sc.updateProjectionMatrix();
              ld.target.position.set(eye[0], 0, eye[2]);
              ld.position.set(eye[0] + 80, 110, eye[2] + 60);
              ld.target.updateMatrixWorld();
              ld.updateMatrixWorld();
              ld.shadow.needsUpdate = true;
            },
            four,
          );
          // AD review (opening): ground level beside our sedan (interior mounted) + the truck at the billboard — C0
          // compiled their cabin/truck/road-dressing programs mid-cinematic otherwise (0.2–9 s hitches)
          camera.near = 0.03;
          camera.far = 900;
          camera.updateProjectionMatrix();
          const roadEye = story.fx.warmRoad?.(true);
          if (roadEye) {
            await step(
              'rc9-road',
              () => {
                camera.position.set(roadEye[0], roadEye[1], roadEye[2]);
                const p = coords.worldToPlan(roadEye);
                level.setViewer(p[0], p[1], 0);
              },
              [...four, Math.PI / 4, (5 * Math.PI) / 4],
            );
            story.fx.warmRoad(false);
          }
          camera.near = near0;
          camera.far = far0;
          camera.updateProjectionMatrix();
        }
        camera.fov = fov;
        camera.updateProjectionMatrix();
        overlay.set('compile', 1, 'ready');
        player.teleport(saved, yaw, pitch);
        const pf = player.planFeet();
        level.setViewer(pf[0], pf[1], pf[2]);
        rig.snap();
        rig.update(0.016, 0);
        console.info(`[game] room warm-up ${(performance.now() - t0).toFixed(0)} ms`);
      },
      /**
       * PERF-PLAN P1-4 (debug; scripts/qa/probes-export.mjs): the runtime-baked probe grids (load with ?probes=bake)
       * as a probes.bin file, base64 — the export writes it to public/assets/<tier>/probes.bin.
       */
      exportProbes: async () => {
        const { readGridData, encodeProbeFile } = await import('../render/probes.ts');
        const grids = [];
        for (const g of level.grids) {
          if (!g.grid || g.shipped || !g.spec) throw new Error(`grid ${g.id} was not baked at runtime (load with ?probes=bake)`);
          grids.push({ id: g.id, size: g.spec.size, center: g.spec.center, counts: g.spec.counts, far: g.spec.far, falloff: g.grid.falloff, data: await readGridData(renderer, g.grid) });
        }
        const bytes = encodeProbeFile({ key: level.probeKey, grids });
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { key: level.probeKey, bytes: bytes.length, grids: grids.map((g) => `${g.id} ${g.counts.join('x')}`), base64: btoa(bin) };
      },
      onReady: () => overlay.remove(),
      whereText: () => {
        const f = player.planFeet();
        return `${level.room ?? '?'} · ${f.map((v) => v.toFixed(2)).join(', ')} · ${level.visible.size} rooms\n${story.whereText()}`;
      },
      teleport,
      spawns: () => ctx.layout.spawns.map((s) => s.id),
      rooms: () => ctx.layout.rooms.map((r) => r.id),
      room: () => level.room,
      /** Plan-space feet position. */
      pos: () => player.planFeet(),
      /** Teleport to a PLAN position (feet) with a heading (CCW from east, like the layout). */
      /** runtime lane E item 8: hold Ada `dist` m in front of the camera (null = release). Debug scenarios only. */
      posePeek: (dist: number | null, yaw = 0) => {
        if (dist === null) {
          peek = null;
          story.director.brain.setScripted?.('hidden');
          return;
        }
        story.director.brain.setScripted?.('hold', { force: true });
        peek = { dist, yaw };
      },
      goto: (x: number, y: number, z: number, heading = Math.PI / 2, pitch = 0) => {
        player.teleport(coords.planToWorld([x, y, z + 1.65]), heading - Math.PI / 2, pitch);
      },
      look: (heading: number, pitch = 0) => {
        player.yaw = heading - Math.PI / 2;
        player.pitch = pitch;
      },
      setFlag: (name: string, value = true) => {
        ctx.flags.set(name, value);
        ctx.events.emit('flag', { name, value });
      },
      flags: () => Object.fromEntries(ctx.flags),
      openDoor: (id: string, fast = false) => level.doors.open(id, fast, true),
      closeDoor: (id: string, fast = false) => level.doors.close(id, fast),
      ropeOpen: () => level.doors.ropeOpen(),
      culling: (on: boolean) => level.setCulling(on),
      noclip: (on = true) => {
        player.noclip = on;
      },
      showCollision: (on = true) => {
        const g = level.collision.debugGroup;
        if (on && !g.parent) {
          g.traverse((m: any) => {
            if (m.isMesh) m.material = new THREE.MeshBasicNodeMaterial({ color: 0x00ff66, wireframe: true });
          });
          scene.add(g);
        }
        g.visible = on;
      },
      give: (id: string) => inventory.add({ id, label: id }),
      /** Move a camera to a layout fixed camera (debug view; the player stays put). */
      fixedCamera: (id: string) => {
        const c = level.camera(id);
        if (!c) return false;
        player.enabled = false;
        player.lookEnabled = false;
        camera.position.set(...c.pos);
        camera.lookAt(new THREE.Vector3(...c.target));
        camera.fov = c.fovDeg;
        camera.updateProjectionMatrix();
        return true;
      },
      freeCamera: () => {
        player.enabled = true;
        player.lookEnabled = true;
        camera.fov = ctx.settings.fovDeg;
        camera.updateProjectionMatrix();
      },
    },
  };
  atmo.attachApi(runtime.expose.look); // LIGHTING lane: window.__game.look.{get,set,meter,snap} (look() still turns)
  return {
    runtime,
    lightning: { exposureScale: 1 },
  };
}

function makeToast(): { show(text: string): void } {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed',
    left: '50%',
    bottom: '14%',
    transform: 'translateX(-50%)',
    maxWidth: 'min(640px, calc(100% - 32px))',
    zIndex: '21',
    color: '#e6dfcf',
    font: 'italic 16px/1.45 ui-serif, Georgia, serif',
    textAlign: 'center',
    textShadow: '0 1px 4px #000',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity .35s',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  let timer = 0;
  return {
    show(text: string) {
      el.textContent = text;
      el.style.opacity = '1';
      clearTimeout(timer);
      timer = window.setTimeout(() => (el.style.opacity = '0'), 2600 + text.length * 35);
    },
  };
}

// ================================================================================================ test room

async function startTestRoom(h: BootHandoff, ctx: GameContext, input: Input, preset: PresetConfig, backend: string): Promise<{ runtime: SceneRuntime; lightning: LightningHooks }> {
  const { renderer, scene, camera, settings } = ctx;
  h.status('Building the test room…');
  await nextFrame();
  const room = buildTestRoom(scene, preset);
  const flashlight = createFlashlight(camera, preset);

  // Lightmapped surfaces: realtime lights only (never the probe grid → no double indirect).
  const lmLights = [flashlight.light, ...room.candleLights];
  if (!preset.lightmaps.lightningFlashMaps) lmLights.push(room.lightningLight);
  excludeGridFromLightmapped(room.lightmappedMaterials, lmLights);

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
  const controller = new TestController(camera, input, room.spawn, { x0: ROOM.minX, x1: ROOM.maxX, z0: ROOM.minZ, z1: ROOM.maxZ }, room.obstacles);
  const SPOT_PEAK = 90; // candela
  let torchOn = true; // (the torch light stays visible when off: see flashlight.setOn)
  const runtime: SceneRuntime = {
    beginText: ['Click to begin', 'WASD move · Shift walk faster · mouse look · F flashlight · L lightning · Esc pause'],
    update(dt, now, paused, lightning) {
      if (!paused) {
        controller.update(dt, settings);
        if (input.wasPressed('KeyF')) flashlight.setOn((torchOn = !torchOn));
      }
      room.update(dt, now);
      flashlight.update(dt, now);
      room.lightningLight.intensity = SPOT_PEAK * lightning;
    },
    step(dt, t) {
      room.update(dt, t);
      flashlight.update(dt, t);
    },
    expose: { probe, room, flashlight },
  };
  return { runtime, lightning: { exposureScale: 1 } };
}

// ================================================================================================ shared

interface LightningHooks {
  exposureScale: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Lets the loading status paint. Falls back to a timeout: rAF never fires in hidden/occluded tabs. */
function nextFrame(): Promise<void> {
  // Visible: one animation frame (lets the loading bar paint). Hidden/occluded tabs never fire rAF and throttle
  // chained timers to once a minute, so yield through a MessageChannel instead (never throttled).
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return new Promise((r) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => r();
      ch.port2.postMessage(0);
    });
  }
  return new Promise((r) => {
    let done = false;
    const go = () => {
      if (!done) {
        done = true;
        r();
      }
    };
    requestAnimationFrame(go);
    setTimeout(go, 100);
  });
}

/**
 * Lightning pulses: uLightning (flash lightmaps, window), `level` for runtime lights, exposure kick. Reduced flash
 * softens it. Thunder contract (docs/AUDIO.md, docs/AI.md): every flash emits `thunder { delayMs 1500, durationMs
 * 2500 × rumbleScale }` — the audio roll and the AI's noise mask use that same window. The storm cadence comes from
 * the story (`setStorm(intervalSec, rumbleScale)`: 35 s normally, 28 s in B06–B07, 12 s in B08–B09, 0 = over).
 */
function createLightning(ctx: GameContext, pipeline: Pipeline, hooks: LightningHooks) {
  let t = -1; // time since strike (s); <0 = idle
  let pulses: Array<{ at: number; peak: number; len: number }> = [];
  let interval = 35;
  let rumble = 1;
  let auto = 18 + Math.random() * 20;
  const api = {
    level: 0,
    strike() {
      const r = ctx.settings.reducedFlash;
      const peak = r ? 0.3 : 1;
      // runtime lane E (item 7, CLAUDE.md): a cloud-to-ground flash is 3–4 return strokes 40–100 ms apart, the whole
      // flicker ≈ 0.4 s (the old 3 pulses ran 0.6–0.8 s). Each stroke: a fast rise, then the continuing current's decay.
      const j = () => 0.85 + Math.random() * 0.3;
      pulses = [
        { at: 0, peak: peak * 0.6, len: 0.06 },
        { at: 0.085 * j(), peak, len: 0.11 },
        { at: 0.19 * j(), peak: peak * 0.5, len: 0.07 },
      ];
      if (Math.random() < 0.6) pulses.push({ at: 0.3 * j(), peak: peak * 0.8, len: 0.12 });
      if (r) pulses = pulses.map((p) => ({ ...p, len: p.len * 2.5 }));
      t = 0;
      ctx.events.emit('lightning', { strength: peak, durationMs: 800 });
      ctx.events.emit('thunder', { delayMs: 1500, durationMs: 2500 * rumble, distance: 0.2 + Math.random() * 0.6 });
    },
    /** Story storm cadence: a flash every `intervalSec` (± a little so it never feels mechanical; 0 = storm over). */
    setStorm(intervalSec: number, rumbleScale: number) {
      const changed = intervalSec !== interval;
      interval = intervalSec;
      rumble = rumbleScale > 0 ? rumbleScale : 1;
      if (changed) auto = interval > 0 ? Math.min(auto, interval) : Infinity;
    },
    get stormInterval() {
      return interval;
    },
    update(dt: number, paused: boolean) {
      if (!paused && interval > 0) {
        auto -= dt;
        if (auto <= 0) {
          // B08 needs a regular rhythm (three rolls per lure): jitter only ±8 %
          auto = interval * (0.92 + Math.random() * 0.16);
          api.strike();
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
      api.level = level;
      uLightning.value = level;
      // LIGHTING lane (REALISM-BACKLOG item 3): no exposure kick — a 100 ms flash over-exposes, the eye can't follow;
      // the auto-exposure meter (src/render/exposure.ts) holds through flashes.
    },
  };
  return api;
}
