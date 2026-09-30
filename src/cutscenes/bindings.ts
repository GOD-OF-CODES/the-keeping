// three.js / DOM side of the cutscene lane: builds CutsceneDeps (src/cutscenes/host.ts) from the real game objects
// and owns the cutscene overlay (letterbox, fade, title card, prompt, "hold to skip"). Everything is duck-typed on
// the objects src/game/main.ts already has (level, player, rig, audio, voice, pipeline, lightning); anything missing
// is simply skipped, so it also runs in the test room / preview.
//
// Integration (docs/CUTSCENES.md): one createCutsceneSystem(...) call, `playCutscene: cs.player.playCutscene` in the
// DirectorHost, and cs.update(dt, input) once per frame after director.update().

import * as THREE from 'three/webgpu';
import { planToWorld, worldToPlan } from '../shared/coords.ts';
import { CutscenePlayer, localSeenStore, type CharacterDirector, type CutsceneDeps, type SeenStore } from './host.ts';
import { HemOverlay } from './c4-hem.ts';
import { CUTSCENES } from './index.ts';
import type { CameraPose, DofSettings, DoorAction, LockMode, P3, TimelineFactory, VehiclePose } from './types.ts';

/** Optional hooks for effects other lanes own (all optional; unknown fx ids are ignored). */
export interface CutsceneHooks {
  /** Strike lightning (main.ts createLightning().strike). */
  lightning?(strength: number): void;
  /** Pause / resume the storm's random auto strikes (main.ts lightning needs a setAuto — see docs/CUTSCENES.md). */
  stormAuto?(on: boolean): void;
  /** A runtime light the world pre-created at load (L_HEADLIGHT_L/R, L_DASH); return null if absent. */
  runtimeLight?(id: string): any | null;
  /** Named visual effects: windshield_rain, wipers, dash, taillights, rope_run, silhouette, blue_hour, car_trim,
   *  fuel, can_in_hand, wardrobe_back_give, eye_glint … (built-ins: mirror_view, lens_wet_hand). */
  fx?(id: string, params: Record<string, number | string | boolean>): void;
  /** Swap set dressing ('sting'). */
  dressing?(set: string, on: boolean): void;
}

export interface CutsceneGame {
  ctx: { settings: { fovDeg: number; reducedFlash?: boolean }; flags: Map<string, boolean>; events: { emit(type: string, payload: unknown): void } };
  camera: any;
  /** Lazy: the pipeline is created after the level in main.ts. */
  pipeline?: () => { setCutscene(fx: { dof?: DofSettings } | null): void } | null;
  level?: any;
  player?: any;
  rig?: any;
  audio?: any;
  /** VoicePlayer + trigger index (src/story/voice-cues.ts buildTriggerIndex). */
  voice?: { play(id: string): unknown; stopAll?(): void } | null;
  voiceIndex?: Map<string, string[]>;
  /** Alternative to voice + voiceIndex: speak a voice-script trigger (e.g. the DirectorHost's own voice(t)). */
  sayTrigger?(trigger: string): void;
  characters?: CharacterDirector | null;
  hooks?: CutsceneHooks;
  seen?: SeenStore;
  library?: Record<string, TimelineFactory>;
  /** Element whose CSS transform flips for the rear-view mirror shot (the canvas). */
  canvas?: HTMLElement | null;
}

export interface CutsceneInput {
  /** Skip key held (e.g. Space or Enter while a locked cutscene runs). */
  skipHeld?: boolean;
  /** E held / pressed (C6 pour / key gates). */
  interactHeld?: boolean;
  interactPressed?: boolean;
  /** Breath held (C4 look). */
  breathHeld?: boolean;
}

const POUR_HOLD_S = 1.2;

// ------------------------------------------------------------------ overlay (DOM, system fonts)

export class CutsceneOverlay {
  readonly root: HTMLElement;
  private readonly top: HTMLElement;
  private readonly bottom: HTMLElement;
  private readonly fadeEl: HTMLElement;
  private readonly card: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly skip: HTMLElement;
  private readonly skipBar: HTMLElement;
  private readonly lens: HTMLElement;

  constructor(parent: HTMLElement = document.body) {
    const div = (css: Partial<CSSStyleDeclaration>, p: HTMLElement) => {
      const d = document.createElement('div');
      Object.assign(d.style, css);
      p.appendChild(d);
      return d;
    };
    this.root = div({ position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '30' }, parent);
    this.root.className = 'tk-cutscene';
    this.lens = div({ position: 'absolute', inset: '0', opacity: '0', background: 'radial-gradient(ellipse at 45% 60%, rgba(40,48,44,.15) 0%, rgba(10,12,11,.85) 55%, #050606 80%)', transition: 'opacity .12s' }, this.root);
    const bar = { position: 'absolute', left: '0', right: '0', height: '0', background: '#000' } as Partial<CSSStyleDeclaration>;
    this.top = div({ ...bar, top: '0' }, this.root);
    this.bottom = div({ ...bar, bottom: '0' }, this.root);
    this.fadeEl = div({ position: 'absolute', inset: '0', background: '#000', opacity: '0' }, this.root);
    this.card = div(
      { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d9d2c3', font: '400 clamp(28px,5vw,64px)/1.1 ui-serif, Georgia, "Times New Roman", serif', letterSpacing: '.32em', opacity: '0', transition: 'opacity 1.6s ease', textAlign: 'center', padding: '0 16px' },
      this.root,
    );
    this.promptEl = div({ position: 'absolute', left: '50%', bottom: '22%', transform: 'translateX(-50%)', color: '#e6dfcf', font: '500 15px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif', letterSpacing: '.06em', textShadow: '0 1px 3px #000', opacity: '0', transition: 'opacity .25s', maxWidth: 'calc(100% - 32px)', textAlign: 'center' }, this.root);
    this.skip = div({ position: 'absolute', right: '16px', bottom: '16px', color: '#a99f8e', font: '500 12px/1.3 system-ui, -apple-system, sans-serif', letterSpacing: '.1em', textTransform: 'uppercase', opacity: '0', transition: 'opacity .4s' }, this.root);
    this.skip.textContent = 'Hold Space to skip';
    const track = div({ height: '2px', marginTop: '6px', background: 'rgba(255,255,255,.15)' }, this.skip);
    this.skipBar = div({ height: '100%', width: '0', background: '#d9d2c3' }, track);
  }

  overlay(fade: number, letterbox: number): void {
    this.fadeEl.style.opacity = String(fade);
    const h = `${(letterbox * 12.8).toFixed(3)}vh`; // 2.39:1 on 16:9
    this.top.style.height = h;
    this.bottom.style.height = h;
  }
  setCard(text: string | null, style: 'title' | 'small'): void {
    if (text) {
      this.card.textContent = text;
      this.card.style.fontSize = style === 'small' ? 'clamp(16px,2vw,24px)' : '';
      this.card.style.zIndex = '2';
      requestAnimationFrame(() => (this.card.style.opacity = '1'));
    } else this.card.style.opacity = '0';
  }
  prompt(text: string | null): void {
    if (text) this.promptEl.textContent = text;
    this.promptEl.style.opacity = text ? '1' : '0';
  }
  skipHint(visible: boolean, progress: number): void {
    this.skip.style.opacity = visible ? '0.8' : '0';
    this.skipBar.style.width = `${Math.round(progress * 100)}%`;
  }
  lensHand(on: boolean): void {
    this.lens.style.opacity = on ? '1' : '0';
  }
  dispose(): void {
    this.root.remove();
  }
}

// ------------------------------------------------------------------ deps

export interface CutsceneSystem {
  player: CutscenePlayer;
  hem: HemOverlay;
  overlay: CutsceneOverlay | null;
  deps: CutsceneDeps;
  /** Once per frame, AFTER player.update + director.update, BEFORE the world/render. */
  update(dt: number, input?: CutsceneInput): void;
  /** Current input lock (gate interact/hide input on it: only 'none' allows interaction). */
  readonly lock: LockMode;
  /** A cutscene shot owns the camera right now. */
  readonly cameraHeld: boolean;
  dispose(): void;
}

export function createCutsceneSystem(g: CutsceneGame): CutsceneSystem {
  const hooks = g.hooks ?? {};
  const overlay = typeof document !== 'undefined' ? new CutsceneOverlay() : null;
  const cam = g.camera;
  const tmpT = new THREE.Vector3();
  let camHeld = false;
  let cullWas = false;
  let lockMode: LockMode = 'none';
  let saved: { enabled: boolean; look: boolean } | null = null;
  const gutters: { f: any; base: number; t: number; d: number }[] = [];
  const baseOf = new Map<any, number>();
  let vehicleSaved: { obj: any; pos: any; rotY: number; visible: boolean } | null = null;
  let warned = new Set<string>();
  const warnOnce = (k: string, msg: string) => {
    if (warned.has(k)) return;
    warned.add(k);
    console.info(`[cutscenes] ${msg}`);
  };

  const flicker = (id: string): any | null => g.level?.lights?.flickers?.find((f: any) => f.def?.id === id) ?? null;
  const scaleLight = (f: any, s: number) => {
    if (!baseOf.has(f)) baseOf.set(f, f.base);
    f.base = baseOf.get(f)! * s;
    if (f.flame) f.flame.visible = s > 0.02;
  };

  const applyPlayerCamera = () => {
    const p = g.player;
    if (!p) return;
    p.applyCamera?.(0, 0);
  };

  const deps: CutsceneDeps = {
    camera: {
      apply(p: CameraPose) {
        if (!camHeld && g.level?.cullingEnabled && g.level.setCulling) {
          // room culling follows the camera's room; road shots leave every room rect (and cut across floors):
          // render everything while a cutscene owns the camera
          cullWas = true;
          g.level.setCulling(false);
        }
        camHeld = true;
        const w = planToWorld(p.pos);
        const t = planToWorld(p.target);
        cam.position.set(w[0], w[1], w[2]);
        cam.up.set(0, 1, 0);
        cam.lookAt(tmpT.set(t[0], t[1], t[2]));
        if (p.shake[0]) cam.rotateY(p.shake[0]);
        if (p.shake[1]) cam.rotateX(p.shake[1]);
        if (p.roll || p.shake[2]) cam.rotateZ(p.roll + p.shake[2]);
        if (Math.abs(cam.fov - p.fov) > 1e-3) {
          cam.fov = p.fov;
          cam.updateProjectionMatrix();
        }
        cam.updateMatrixWorld(true);
        g.rig?.snap?.();
      },
      release() {
        camHeld = false;
        if (cullWas) {
          cullWas = false;
          g.level?.setCulling?.(true);
        }
        cam.fov = g.ctx.settings.fovDeg;
        cam.updateProjectionMatrix();
        applyPlayerCamera();
        g.rig?.snap?.();
      },
    },
    characters: g.characters ?? undefined,
    audio: g.audio
      ? {
          play: (id, o) => g.audio.play(id, { ...(o.pos ? { pos: planToWorld(o.pos) } : {}), ...(o.room ? { room: o.room } : {}), ...(o.gain !== undefined ? { gain: o.gain } : {}), ...(o.rate !== undefined ? { rate: o.rate } : {}) }),
          loop: (k, id, o) => g.audio.layers?.loop(`cs_${k}`, id, { gain: o.gain, fade: o.fade }),
          stopLoop: (k, fade) => g.audio.layers?.stopLoop(`cs_${k}`, fade),
          score: (s, stinger) => {
            g.audio.layers?.setScore(s);
            if (stinger) g.audio.layers?.stinger(stinger);
          },
          weather: (w) => g.audio.layers?.setWeather(w),
          heartbeat: (bpm) => g.audio.layers?.setHeartRate(bpm),
        }
      : undefined,
    voice: (trigger) => {
      if (g.sayTrigger) return g.sayTrigger(trigger);
      if (!g.voice || !g.voiceIndex) return;
      for (const id of g.voiceIndex.get(trigger) ?? []) void g.voice.play(id);
    },
    stopVoices: () => {
      g.voice?.stopAll?.();
      g.ctx.events.emit('subtitle', null);
    },
    lights: {
      lightning: (s) => (hooks.lightning ? hooks.lightning(s) : warnOnce('lightning', 'no lightning hook')),
      stormAuto: (on) => hooks.stormAuto?.(on),
      set: (id, scale) => {
        const f = flicker(id);
        if (f) scaleLight(f, scale);
      },
      gutter: (id, d) => {
        const f = flicker(id);
        if (!f) return;
        if (!baseOf.has(f)) baseOf.set(f, f.base);
        gutters.push({ f, base: baseOf.get(f)!, t: 0, d });
      },
      castShadow: (id, on) => {
        const f = flicker(id);
        if (!f?.light) return;
        // the shot's key: the candle throws the tableau across the tally wall — raise its runtime share while the
        // shadow is on (still one candle: dark, cinematic), back to normal with the shadow
        scaleLight(f, on ? 4.5 : 1);
        f.light.castShadow = on;
        if (on && f.light.shadow?.mapSize) {
          f.light.shadow.mapSize.set(512, 512);
          f.light.shadow.bias = -0.002;
        }
      },
      flashlight: (on, tremble) => {
        if (!g.rig) return;
        g.rig.setOn?.(on);
        g.rig.tremble = tremble;
      },
      runtime: (id, on, scale) => {
        const l = hooks.runtimeLight?.(id);
        if (!l) return warnOnce(`rl:${id}`, `runtime light ${id} not provided (hooks.runtimeLight)`);
        l.userData.csBase ??= l.intensity || 1;
        l.intensity = on ? l.userData.csBase * scale : 0;
      },
    },
    world: {
      door: (id, a: DoorAction) => {
        const d = g.level?.doors;
        if (!d) return;
        if (a === 'rope_open') d.ropeOpen?.();
        else if (a === 'rope_close' || a === 'slam') d.ropeClose?.();
        else if (a === 'open') d.open?.(id, false, true);
        else if (a === 'open_fast') d.open?.(id, true, true);
        else if (a === 'close') d.close?.(id, false);
        else if (a === 'lock') d.setLock?.(id, 'locked');
        else if (a === 'unlock') d.setLock?.(id, null);
      },
      propVisible: (id, v) => {
        const o = g.level?.prop?.(id);
        if (o) o.visible = v;
      },
      dressing: (set, on) => hooks.dressing?.(set, on),
      fx: (id, params) => {
        if (id === 'mirror_view' && g.canvas) g.canvas.style.transform = params.on ? 'scaleX(-1)' : '';
        if (id === 'lens_wet_hand') overlay?.lensHand(!!params.on);
        hooks.fx?.(id, params);
      },
      placePlayer: (eye: P3, heading: number, pitch: number) => {
        const p = g.player;
        if (!p) return;
        p.teleport?.(planToWorld(eye), heading - Math.PI / 2, pitch);
        if (camHeld) g.rig?.snap?.();
      },
      vehicle: (pose: VehiclePose | null) => {
        const obj = g.level?.prop?.('P_CAR_GATE');
        if (!obj) return;
        if (!pose) {
          if (vehicleSaved) {
            obj.position.copy(vehicleSaved.pos);
            obj.rotation.y = vehicleSaved.rotY;
            obj.visible = vehicleSaved.visible;
            vehicleSaved = null;
          }
          return;
        }
        vehicleSaved ??= { obj, pos: obj.position.clone(), rotY: obj.rotation.y, visible: obj.visible };
        const w = planToWorld(pose.pos);
        obj.position.set(w[0], vehicleSaved.pos.y + w[1], w[2]);
        obj.rotation.y = pose.heading + Math.PI / 2; // props face −y at yaw 0: yaw = heading + π/2
        obj.visible = true;
        obj.updateMatrixWorld?.(true);
      },
    },
    ui: overlay
      ? {
          overlay: (f, b) => overlay.overlay(f, b),
          card: (t, s) => overlay.setCard(t, s),
          subtitle: (speaker, text, durationMs, caption) => g.ctx.events.emit('subtitle', { speaker, text, durationMs, caption }),
          prompt: (t) => overlay.prompt(t),
          skipHint: (v, p) => overlay.skipHint(v, p),
        }
      : undefined,
    input: {
      lock: (m) => {
        const p = g.player;
        // remember what gameplay had (a hide disables the body) and give exactly that back on unlock
        if (p && lockMode === 'none' && m !== 'none') saved = { enabled: p.enabled, look: p.lookEnabled };
        lockMode = m;
        if (!p) return;
        if (m === 'none') {
          p.enabled = saved?.enabled ?? true;
          p.lookEnabled = saved?.look ?? true;
          saved = null;
        } else {
          p.enabled = false;
          p.lookEnabled = m === 'look';
        }
      },
    },
    render: {
      dof: (d) => {
        const pl = g.pipeline?.();
        if (!pl) return;
        pl.setCutscene(d ? { dof: d } : null);
      },
    },
    context: () => {
      const w = cam.position;
      const eye = worldToPlan([w.x, w.y, w.z]);
      const p = g.player;
      const heading = p ? p.yaw + Math.PI / 2 : 0;
      const pitch = p ? p.pitch : 0;
      return { player: { eye, heading, pitch, fov: g.ctx.settings.fovDeg }, ada: g.characters?.pose?.('ada') ?? null, flags: g.ctx.flags };
    },
  };

  const player = new CutscenePlayer({ deps, library: g.library ?? CUTSCENES, seen: g.seen ?? localSeenStore() });
  const hem = new HemOverlay(player);
  let pourHeld = 0;

  return {
    player,
    hem,
    overlay,
    deps,
    get lock() {
      return player.active ? lockMode : 'none';
    },
    get cameraHeld() {
      return camHeld;
    },
    update(dt, input = {}) {
      // interactive gates
      const gate = player.waitingGate;
      if (gate === 'pour') {
        pourHeld = input.interactHeld ? pourHeld + dt : 0;
        if (pourHeld >= POUR_HOLD_S) {
          pourHeld = 0;
          player.resolveGate('pour');
        }
      } else if (gate === 'key' && input.interactPressed) player.resolveGate('key');
      else if (gate === 'c4_breath' && input.breathHeld) hem.breathHeld();
      player.holdSkip(!!input.skipHeld, dt);
      player.update(dt);
      // 'look' lock without a cutscene camera: the player looks around from where they stand
      if (player.active && lockMode === 'look' && !camHeld) applyPlayerCamera();
      // candle gutters: flicker hard, then out
      for (let i = gutters.length - 1; i >= 0; i--) {
        const q = gutters[i];
        q.t += dt;
        const k = Math.min(1, q.t / Math.max(0.01, q.d));
        q.f.base = q.base * (1 - k) * (0.6 + 0.4 * Math.abs(Math.sin(q.t * 37)));
        if (k >= 1) {
          q.f.base = 0;
          if (q.f.flame) q.f.flame.visible = false;
          gutters.splice(i, 1);
        }
      }
    },
    dispose() {
      player.cancel();
      overlay?.dispose();
      warned = new Set();
    },
  };
}
