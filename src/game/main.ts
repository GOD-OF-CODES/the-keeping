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
import { uLightning } from '../render/lightmap-material.ts';
import { bakeProbeGrid, excludeGridFromLightmapped } from '../render/probes.ts';
import type { GameContext } from './context.ts';
import type { LevelLayout } from '../shared/layout-types.ts';
import layoutJson from '../shared/level-layout.json';
import { buildTestRoom, ROOM } from './test-room.ts';
import { TestController } from './test-controller.ts';
import { PauseMenu, clickToBegin } from './pause-menu.ts';

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
  try {
    // WebGL2 polls KHR_parallel_shader_compile with requestAnimationFrame, which stalls in a hidden tab: cap the
    // wait; anything not compiled yet compiles synchronously on the first frames.
    const done = await Promise.race([renderer.compileAsync(scene, camera).then(() => true), delay(20000).then(() => false)]);
    if (!done) console.warn('[game] compileAsync still pending after 20 s (hidden tab?) — continuing');
  } catch (e) {
    console.warn('[game] compileAsync failed (continuing):', e);
  }
  pipeline.render(); // warm-up frames compile the post chain behind the loading screen
  await (rt.expose.afterCompile as ((render: () => void) => Promise<void>) | undefined)?.(() => {
    renderer._nodes?.nodeFrame?.update(); // new node frame, or FRAME-updated passes (scene pass …) are skipped
    pipeline.render();
  });
  pipeline.render();
  console.info(`[game] shader compile + warm-up ${(performance.now() - tc).toFixed(0)} ms`);

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
  const loop: Loop = new Loop(
    {
      update(dt, nowSec) {
        ctx.time.dt = dt;
        ctx.time.now = nowSec;
        ctx.time.frame = loop.frame;
        if (!paused && input.wasPressed('KeyL')) lightning.strike();
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
    /**
     * Debug screenshot that works in hidden/occluded tabs: renders the pipeline into a render target, reads it back
     * and returns a JPEG data URL (w px wide; AgX output is already display-referred — sRGB-encoded here).
     */
    capture: async (w = 640) => {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      const h = Math.round((w * size.y) / size.x);
      const rtg = new THREE.RenderTarget(w, h, { type: THREE.UnsignedByteType }); // output is already display-encoded
      renderer._nodes?.nodeFrame?.update();
      renderer.setRenderTarget(rtg);
      pipeline.render();
      renderer.setRenderTarget(null);
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
  if (debug) (window as unknown as { __game: unknown }).__game = expose;
  ctx.systems.set('debug', { id: 'debug' });
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
    level = await loadLevel({ ctx, renderer, scene, preset, presetId: ctx.presetId, overlay, flashlight: rig.flashlight });
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
  const interact = new Interactables(camera, input, level);
  const toastEl = makeToast();
  // Hiding: the torch goes off inside (a lit wardrobe gives you away); it comes back on as you step out.
  let torchBeforeHide = true;
  ctx.events.on('player:hide', ({ inside }) => {
    if (inside) {
      torchBeforeHide = rig.on;
      rig.setOn(false);
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
  let torchPending = false;
  let lastRoom: string | null = null;
  let weatherKey = '';
  const insideTriggers = new Set<string>();
  const sky = new THREE.Color(...SKY_COLOR);
  const fog = new THREE.FogExp2(new THREE.Color(0.012, 0.014, 0.019), 0.0);
  scene.fog = fog;

  const world = (dt: number, t: number, lightning: number) => {
    // culling + room from the camera (hides move the camera, not the body)
    const cp = coords.worldToPlan([camera.position.x, camera.position.y, camera.position.z]);
    const feetZ = hides.active ? hides.active.entry[2] : player.planFeet()[2];
    const changed = level.setViewer(cp[0], cp[1], feetZ);
    const outside = level.isOutside();
    if (changed || lastRoom === null) {
      lastRoom = level.room;
      if (audio && level.room) audio.setListenerRoom(level.room);
    }
    // weather bed follows where you are (porch roof overhead = rain on the porch roof)
    if (audio) {
      const surf = outside ? (player.surface === 'porch_wood' ? 'porch' : 'gravel') : 'roof';
      const key = `${outside}|${surf}`;
      if (key !== weatherKey) {
        weatherKey = key;
        audio.layers.setWeather({ rain: 1, wind: outside ? 0.8 : 0.5, inside: outside ? 0 : 1, surface: surf });
      }
    }
    fog.density = outside ? 0.028 : 0.0;
    level.update(dt, t, lightning);
    rig.update(dt, t);
    // sky flash (+ C6's blue hour: the sky pales toward dawn)
    const bh = story.skyTint();
    if (bh > 0) sky.setRGB(SKY_COLOR[0] + bh * 0.05, SKY_COLOR[1] + bh * 0.07, SKY_COLOR[2] + bh * 0.11);
    (scene.background as any).setRGB(sky.r + lightning * 0.35, sky.g + lightning * 0.38, sky.b + lightning * 0.46);
    // the rain haze is lit by the same sky: fog colour follows the background (flashes included)
    fog.color.setRGB(sky.r * 1.05 + lightning * 0.3, sky.g * 1.05 + lightning * 0.33, sky.b * 1.05 + lightning * 0.4);
  };

  const runtime: SceneRuntime = {
    beginText: ['Click to begin', 'WASD move · Shift run · C crouch · mouse look · E interact · F flashlight · Space hold breath · RMB raise the locket · Tab journal · Esc pause'],
    update(dt, now, paused, lightning) {
      if (!paused) {
        hides.update(dt);
        player.update(dt, now);
        if (input.wasPressed('KeyF') && !torchPending) {
          // thumb reaches the slide switch at 0.2 s into arms_flashlight_toggle: click + light together
          story.arms?.play('arms_flashlight_toggle');
          torchPending = true;
          setTimeout(() => {
            torchPending = false;
            rig.toggle();
            audio?.play('flashlight_click', { gain: 0.6 });
          }, story.arms ? 200 : 0);
        }
        if (input.wasPressed('Tab')) journal.toggle();
        // story triggers (enter only): forwarded as `interact { id: trigger id, action: trigger event }`
        const [px, py, pz] = player.planFeet();
        const now2 = new Set(level.index.triggersAt(px, py, pz).map((t) => t.id));
        for (const id of now2)
          if (!insideTriggers.has(id)) {
            const tv = ctx.layout.triggers.find((x) => x.id === id)!;
            ctx.events.emit('interact', { id, action: tv.event });
            if (ctx.debug) console.info(`[trigger] ${id} → ${tv.event}`);
          }
        insideTriggers.clear();
        for (const id of now2) insideTriggers.add(id);
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
      setPipeline: story.setPipeline,
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
       * Shadow/depth pipelines compile lazily the first time an object enters the flashlight frustum (a visible
       * hitch). Walk the camera through every playable room's centre, 4 headings each, rendering with culling on,
       * so those pipelines exist before the player gets there.
       */
      afterCompile: async (render: () => void) => {
        const t0 = performance.now();
        level.setCulling(true);
        const saved = player.eye();
        const yaw = player.yaw;
        const pitch = player.pitch;
        overlay.set('compile', 0.3, 'warming rooms');
        const rooms = ctx.layout.rooms.filter((r) => r.kind !== 'set');
        let k = 0;
        for (const r of rooms) {
          const e = level.index.elevationOf(r.id);
          const cx = (r.rect[0] + r.rect[2]) / 2;
          const cy = r.kind === 'exterior' ? Math.min(r.rect[3], -3) - 6 : (r.rect[1] + r.rect[3]) / 2;
          const eye = coords.planToWorld([cx, cy, e + 1.6]);
          for (let d = 0; d < 4; d++) {
            camera.position.set(eye[0], eye[1], eye[2]);
            camera.rotation.set(-0.2, (d * Math.PI) / 2, 0);
            camera.updateMatrixWorld(true);
            level.setViewer(cx, cy, e);
            rig.snap();
            rig.update(0.016, 0);
            render();
          }
          overlay.set('compile', 0.3 + (0.7 * ++k) / rooms.length, r.id);
          await nextFrame();
        }
        // C2 turns on the table candle's shadow: compile that variant now (a pipeline hitch mid-cutscene otherwise)
        const candle = level.lights.flickers.find((f) => f.def.id === 'L_CANDLE_TABLE');
        if (candle) {
          candle.light.castShadow = true;
          candle.light.shadow.mapSize.set(512, 512);
          candle.light.shadow.bias = -0.002;
          const g2 = ctx.layout.rooms.find((r) => r.id === 'G2');
          if (g2) {
            const e = level.index.elevationOf('G2');
            const eye = coords.planToWorld([3.3, 1.5, e + 1.6]);
            camera.position.set(eye[0], eye[1], eye[2]);
            camera.rotation.set(-0.15, -Math.PI / 2 + 0.3, 0);
            camera.updateMatrixWorld(true);
            level.setViewer(3.3, 1.5, e);
            render();
            await nextFrame();
          }
          candle.light.castShadow = false;
        }
        player.teleport(saved, yaw, pitch);
        const pf = player.planFeet();
        level.setViewer(pf[0], pf[1], pf[2]);
        rig.snap();
        rig.update(0.016, 0);
        console.info(`[game] room warm-up ${(performance.now() - t0).toFixed(0)} ms`);
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
  const runtime: SceneRuntime = {
    beginText: ['Click to begin', 'WASD move · Shift walk faster · mouse look · F flashlight · L lightning · Esc pause'],
    update(dt, now, paused, lightning) {
      if (!paused) {
        controller.update(dt, settings);
        if (input.wasPressed('KeyF')) flashlight.setOn(!flashlight.light.visible);
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
      pulses = [
        { at: 0, peak: peak * 0.55, len: 0.07 },
        { at: 0.12, peak, len: 0.16 },
        { at: 0.38 + Math.random() * 0.2, peak: peak * 0.7, len: 0.22 },
      ];
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
      pipeline.uniforms.exposure.value = 1 + 0.18 * level * hooks.exposureScale;
    },
  };
  return api;
}
