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
import { setCandleShadow } from '../world/lights.ts';
import { hasRecipe } from '../audio/synth/index.ts';

/** C2-ESCAPE: stand-ins for NEW sound ids (§2.3) until their recipes exist. */
const SFX_STANDIN: Record<string, string> = {
  cleaver_sever: 'wet_chop',
  head_drop: 'board_drop',
  blood_drip: 'ada_drip',
  bare_feet_wet: 'ada_slap',
  stump_breath: 'ada_gurgle',
  body_fall_stairs: 'board_drop',
  newel_knock: 'knock',
};
import { requestExposureSnap } from '../render/exposure.ts';
import { BEAM_CLAMP } from '../characters/arms.ts';
import { CUTSCENES } from './index.ts';
import { VIEW_CULL_SCOPE } from '../render/view-caster-cull.ts'; // PERF review (contract 116)
import { TitleCards } from '../ui/title-card.ts'; // C0 date card + byline (opening lane)
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
  pipeline?: () => { setCutscene(fx: { dof?: DofSettings; motionBlur?: number } | null): void; setBlurAmount?(v: number): void; blurAvailable?: boolean } | null;
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
/** PERF review (contract 115): interior cutscene cameras keep room/window culling; `?cscull=0` restores render-all. */
const CS_CULL = typeof location === 'undefined' || new URLSearchParams(location.search).get('cscull') !== '0';
/**
 * Cutscenes verified with interior culling (same-build A/B, docs/STATUS-perf-g.md R8/R34). Not C5: the camera-feet
 * room changes which flicker lamps its `seen` set lights (C5 shadowplay rendered brighter, R34) — opt others in only
 * after an A/B of their stills.
 */
const CS_CULL_IDS = new Set(['C2', 'C2c']);
/** PERF review (contract 116): the torch's view-frustum caster cull. Lead ruling 2026-10-11: OFF everywhere until it tests
 *  each caster's shadow volume rather than the caster (it changed the C5 still for an unknown reason); add 'C2c' to re-enable. */
const TORCH_CULL_IDS = new Set<string>();

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
  private readonly cards: TitleCards;

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
    this.cards = new TitleCards(this.root);
    const track = div({ height: '2px', marginTop: '6px', background: 'rgba(255,255,255,.15)' }, this.skip);
    this.skipBar = div({ height: '100%', width: '0', background: '#d9d2c3' }, track);
  }

  overlay(fade: number, letterbox: number): void {
    this.fadeEl.style.opacity = String(fade);
    const h = `${(letterbox * 12.8).toFixed(3)}vh`; // 2.39:1 on 16:9
    this.top.style.height = h;
    this.bottom.style.height = h;
  }
  setCard(text: string | null, style: string): void {
    if (this.cards.set(text, style)) return;
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
  const tmpD = new THREE.Vector3();
  const lastCamPos = new THREE.Vector3();
  const lastCamDir = new THREE.Vector3(0, 0, -1);
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

  // C2-ESCAPE §2.3: sounds lane B-STORY is still synthesising play their nearest existing recipe (or nothing) until
  // they land — never an unknown-recipe warning in the console
  const sfxId = (id: string): string | null => {
    if (hasRecipe(id)) return id;
    const f = SFX_STANDIN[id];
    return f && hasRecipe(f) ? f : null;
  };
  // C2-ESCAPE B8: the cutscene chain = DOF and/or the motion-blur variant (one cached RenderPipeline per shape)
  let csDof: DofSettings | null = null;
  let csBlur: number | null = null;
  const applyChain = () => {
    const pl = g.pipeline?.();
    if (!pl) return;
    pl.setCutscene(csDof || csBlur !== null ? { ...(csDof ? { dof: csDof } : {}), ...(csBlur !== null ? { motionBlur: csBlur } : {}) } : null);
  };

  const applyPlayerCamera = () => {
    const p = g.player;
    if (!p) return;
    p.applyCamera?.(0, 0);
  };

  const deps: CutsceneDeps = {
    camera: {
      apply(p: CameraPose) {
        if (!camHeld && g.level?.cullingEnabled && g.level.setCulling) cullWas = true;
        if (cullWas) {
          // room culling follows the camera's room; road shots leave every room rect (and cut across floors) →
          // render everything there. PERF review (contract 115): a camera INSIDE the house keeps room + window
          // culling on, its room looked up at the camera's own feet (cam z − 0.5 m: ground eye ≤ 3.9 m → ground,
          // upper ≥ 4.4 m → upper; rooms.ts floorForZ threshold 3.5 m) — the C2 parlor / C2c stair views drew the
          // yard pines, the parked sedan + its interior and (torch shadow) props of rooms the PVS hides: 205 + 240
          // frames over 400 / 1.5 M on Medium. A doorway (roomAt null) keeps the last decision. ?cscull=0 = old path.
          const lv = g.level;
          VIEW_CULL_SCOPE.on = TORCH_CULL_IDS.has(player.active ?? '');
          const feet = p.pos[2] - 0.5;
          const r = CS_CULL && CS_CULL_IDS.has(player.active ?? '') ? lv.index?.roomAt?.(p.pos[0], p.pos[1], feet) : undefined;
          const inside = r === null ? lv.viewerFeetZ !== null : r !== undefined && lv.index.rooms.get(r)?.kind === 'interior';
          lv.viewerFeetZ = inside ? feet : null;
          if (lv.cullingEnabled !== inside) lv.setCulling(inside);
        }
        const w = planToWorld(p.pos);
        const t = planToWorld(p.target);
        // R2-5 (round 3): a CUT (first held frame, or the pose jumps > 1.2 m (a 15 m/s car moves 0.75 m a frame at 20 fps) or turns > 20° between two frames) adapts the
        // exposure with it — the auto snap only fires on > 2.5 m moves, so same-room cuts eased in over τ 6 s
        const dir = tmpD.set(t[0] - w[0], t[1] - w[1], t[2] - w[2]).normalize();
        if (!camHeld || lastCamPos.distanceToSquared(tmpT.set(w[0], w[1], w[2])) > 1.44 || dir.dot(lastCamDir) < 0.94) requestExposureSnap();
        lastCamPos.set(w[0], w[1], w[2]);
        lastCamDir.copy(dir);
        camHeld = true;
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
        BEAM_CLAMP.on = false;
        BEAM_CLAMP.at = null;
        if (cullWas) {
          cullWas = false;
          if (g.level) g.level.viewerFeetZ = null;
          VIEW_CULL_SCOPE.on = false;
          g.level?.setCulling?.(true);
        }
        cam.fov = g.ctx.settings.fovDeg;
        cam.updateProjectionMatrix();
        applyPlayerCamera();
        g.rig?.snap?.();
        requestExposureSnap(); // R2-5: back on the player's eye = a cut
      },
    },
    characters: g.characters ?? undefined,
    audio: g.audio
      ? {
          play: (id0, o) => {
            const id = sfxId(id0);
            if (!id) return;
            g.audio.play(id, { ...(o.pos ? { pos: planToWorld(o.pos) } : {}), ...(o.room ? { room: o.room } : {}), ...(o.gain !== undefined ? { gain: o.gain } : {}), ...(o.rate !== undefined ? { rate: o.rate } : {}), ...(o.delay !== undefined && g.audio.scheduleTime ? { when: g.audio.scheduleTime(o.delay) } : {}) });
          },
          loop: (k, id0, o) => {
            const id = sfxId(id0);
            if (id) g.audio.layers?.loop(`cs_${k}`, id, { gain: o.gain, fade: o.fade });
          },
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
        if (!f.direct) scaleLight(f, on ? 4.5 : 1); // C2-ESCAPE K3: the lamp is already its full 12 cd direct light
        // PERF-PLAN P0-2: the candle casts from load (castShadow never toggles — that rebuilds every material on
        // its LightsNode); this only unmutes / mutes its shadow
        setCandleShadow(f.light, on);
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
      mark: (name) => g.ctx.events.emit('flag', { name: `mark:${name}`, value: true }), // story markers (beats.ts onFlag)
      fx: (id, params) => {
        if (id === 'mirror_view' && g.canvas) g.canvas.style.transform = params.on ? 'scaleX(-1)' : '';
        if (id === 'lens_wet_hand') overlay?.lensHand(!!params.on);
        if (id === 'beamClamp') {
          BEAM_CLAMP.on = !!params.on; // C2-ESCAPE review: the climb's torch stays within 12° of the gaze (arms.ts)
          // fix round: optional aim point (PLAN) — glance #2 points the torch at her hand on the rail
          BEAM_CLAMP.at = params.atX !== undefined ? (planToWorld([Number(params.atX), Number(params.atY), Number(params.atZ)]) as [number, number, number]) : null;
          return;
        }
        if (id === 'torchHold' && g.rig) {
          g.rig.hold = !!params.on; // C2-ESCAPE: the torch arm stays forward while the head turns back
          return;
        }
        hooks.fx?.(id, params);
      },
      placePlayer: (eye: P3, heading: number, pitch: number) => {
        const p = g.player;
        if (!p) return;
        const before = g.camera?.position?.clone?.();
        p.teleport?.(planToWorld(eye), heading - Math.PI / 2, pitch);
        if (camHeld) g.rig?.snap?.();
        // R2-5: a teleport is a cut — but C2c hands over on its exact last camera (no cut): no exposure pop there
        const w = planToWorld(eye);
        if (!before || Math.hypot(before.x - w[0], before.y - w[1], before.z - w[2]) > 0.3) requestExposureSnap();
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
        csDof = d;
        applyChain();
      },
      blur: (v) => {
        const pl = g.pipeline?.();
        if (!pl) return;
        if (v === null) {
          csBlur = null;
          applyChain();
          return;
        }
        if (csBlur === null) {
          csBlur = v; // first call of the sequence: switch the (prewarmed, cached) blur chain in
          applyChain();
        } else {
          csBlur = v;
          pl.setBlurAmount?.(v); // afterwards only the uniform
        }
      },
    },
    context: () => {
      const w = cam.position;
      const eye = worldToPlan([w.x, w.y, w.z]);
      const p = g.player;
      const heading = p ? p.yaw + Math.PI / 2 : 0;
      const pitch = p ? p.pitch : 0;
      return { player: { eye, heading, pitch, fov: g.ctx.settings.fovDeg }, ada: g.characters?.pose?.('ada') ?? null, flags: g.ctx.flags, motionBlur: !!g.pipeline?.()?.blurAvailable };
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
