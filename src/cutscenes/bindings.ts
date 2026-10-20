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
import { C4_HIDE_LM_TAU_IN, C4_HIDE_LM_TAU_OUT, HemOverlay } from './c4-hem.ts';
import { GRADE } from '../render/grade.ts'; // SMOOTH-FIX (#145b): the C4 hide view's night-light lift (tickHideLm)
import { setCandleShadow } from '../world/lights.ts';
import { uHideDim } from '../world/hide-dim.ts'; // FINAL-B (#154, R1-4): the wardrobe's own parts stay un-lifted
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
  // M-A (SCENES): CUTSCENES-PLAN §6 audio-voice new sfx, stand-ins until lane C synthesises them
  match: 'knob_click',
  sizzle: 'gutter',
  rope_creak: 'apron_creak',
};
import { requestExposureSnap } from '../render/exposure.ts';
import { LOOK } from '../render/look.ts'; // SMOOTH-FIX (#145): the torch fade scales the beam bounce with the beam
import { BEAM_CLAMP } from '../characters/arms.ts';
import { TORCH_WORLD } from '../render/flashlight-bounce.ts'; // SMOOTH-FIX (#145b): the beam's gaze aim (static sight ray)
import { CUTSCENES } from './index.ts';
import { CREDITS_ROLL_S } from './cr-credits.ts'; // M-A: the end-credits roll speed
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
  ctx: {
    settings: { fovDeg: number; reducedFlash?: boolean };
    flags: Map<string, boolean>;
    events: { emit(type: string, payload: unknown): void; on?(type: string, fn: (payload: any) => void): () => void };
    presetId?: string;
    time?: { now: number };
  };
  camera: any;
  /** Lazy: the pipeline is created after the level in main.ts. */
  pipeline?: () => { setCutscene(fx: { dof?: DofSettings; motionBlur?: number } | null): void; setBlurAmount?(v: number): void; blurAvailable?: boolean; uniforms?: { exposure?: { value: number } } } | null;
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
 * Cutscenes verified with interior culling (same-build A/B, docs/STATUS-perf-g.md R8/R34; C5: docs/STATUS-perf2.md).
 * Opt others in only after a same-state A/B of their stills.
 */
// M-A (infra, surgical): + C4a, C4c, C2b — interior cameras; without it they rendered the whole house (C4a POV at the
// door 562–661 draws / 1.82–1.94 M on Medium, over 400 / 1.5 M)
// PERF round 2 (#150, ruling (aq) "C5 cutscene culling"): + C5. The R34 caveat cannot apply to it: over C5's whole
// timeline the room (and PVS) at the camera's feet equals the room at the camera xy + the player's feet, the
// render-all path's lookup (scratch/perf2/c5rooms.ts: G1 / G2 at every 0.1 s), so RuntimeLights gets the same `seen`
// set and viewer room in both paths; the R34 / G5 luminance "modes" were playthrough timing noise (STATUS-perf-g G5).
// Same-state A/B (cull vs render-all, light state + stills + ms at the frozen frame): docs/STATUS-perf2.md.
// QA: `__game.csCull()` returns this Set (delete / add an id for a same-frame A/B).
export const CS_CULL_IDS = new Set(['C2', 'C2c', 'C4a', 'C4c', 'C2b', 'C5', 'C5b', 'C6b', 'CR']);
/** M-A (SCENES, surgical): yard / gate cameras that keep the GAMEPLAY exterior culling (the player's own PVS from an
 *  exterior room) instead of render-all — CR at the gate drew 627 / 1.49 M, C5b's crane 1045 / 2.24 M on Medium. */
export const CS_CULL_EXT_IDS = new Set(['C5b', 'C6b', 'CR']);
/** AD review M-A: the parlor, for C5b's 135 mm shutter shot (see camera.apply). */
const C5B_SHUTTER_ROOMS: readonly string[] = ['G2'];
/** PERF review (contract 116): the torch's view-frustum caster cull. Lead ruling 2026-10-11: OFF everywhere until it tests
 *  each caster's shadow volume rather than the caster (it changed the C5 still for an unknown reason); add 'C2c' to re-enable.
 *  PERF fix round 3 (ruling q, contract 121): re-enabled for C2c with the shadow-cone test — same-state per-frame A/B over
 *  all 834 C2c frames 0 px; the C5 change was playthrough run noise (docs/STATUS-perf-g.md G4–G5). */
// PERF2 BUDGETS (#150b): + C5 (the torch is lit in its hall / parlor shots 0–15.6 s and 21.3–33 s: 112–168 torch-map
// draws per frame, the biggest pass after the view; exact same-state per-pixel A/B: docs/STATUS-perf2.md B-log).
// Exported for the QA hook `__game.torchCull()` (same-frame A/B: delete / add an id).
export const TORCH_CULL_IDS = new Set<string>(['C2c', 'C4a', 'C4c', 'C5']); // M-A: + C4a, C4c (torch-lit POV shots)

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
  /** M-A CR: the end-credits roll (system serif, centred, one slow pass upward). */
  private readonly roll: HTMLElement;

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
    this.roll = div({ position: 'absolute', left: '0', right: '0', top: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', color: '#d9d2c3', font: '400 clamp(15px,1.7vw,22px)/1.5 ui-serif, Georgia, "Times New Roman", serif', letterSpacing: '.08em', textAlign: 'center', textShadow: '0 1px 4px rgba(0,0,0,.7)', opacity: '0', willChange: 'transform', padding: '0 16px', zIndex: '1' }, this.root);
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
    if (style === 'roll' || !text) this.setRoll(style === 'roll' ? text : null);
    if (style === 'roll') return;
    if (this.cards.set(text, style)) return;
    if (text) {
      this.card.textContent = text;
      this.card.style.fontSize = style === 'small' ? 'clamp(16px,2vw,24px)' : '';
      this.card.style.zIndex = '2';
      // AD review M-A: the fade-in waits a frame; a clear (cue or skip/teardown) before that frame must win — a
      // skipped C6 → C6b chain left "Three weeks later" on screen over the next scene (the late rAF re-showed it)
      const token = ++this.cardSeq;
      requestAnimationFrame(() => {
        if (this.cardSeq === token) this.card.style.opacity = '1';
      });
    } else {
      this.cardSeq++;
      this.card.style.opacity = '0';
    }
  }
  private cardSeq = 0;
  /** CR: lay the credits out and roll them from below the frame to above it, linear, over CREDITS_ROLL_S. */
  private setRoll(text: string | null): void {
    const r = this.roll;
    r.style.transition = 'none';
    if (!text) {
      r.style.opacity = '0';
      r.replaceChildren();
      this.rollT = -1;
      return;
    }
    r.replaceChildren();
    for (const raw of text.split('\n')) {
      const line = document.createElement('div');
      if (raw.startsWith('# ')) Object.assign(line.style, { font: '400 clamp(26px,3.6vw,48px)/1.2 ui-serif, Georgia, "Times New Roman", serif', letterSpacing: '.32em', marginBottom: '.2em' });
      else if (raw.startsWith('~ ')) Object.assign(line.style, { fontStyle: 'italic', letterSpacing: '.16em', opacity: '.85' });
      else if (raw.startsWith('> ')) Object.assign(line.style, { fontVariant: 'small-caps', fontSize: '.82em', letterSpacing: '.2em', color: '#a99f8e', marginTop: '.25em' });
      line.textContent = raw.replace(/^(# |~ |> )/, '') || '\u00a0';
      if (!raw) line.style.height = '2.2em';
      r.appendChild(line);
    }
    r.style.opacity = '1';
    this.rollT = 0;
    this.tickRoll(0);
  }
  /** The roll runs on the game clock (pause / headless stepping keep it in sync with the cues). */
  private rollT = -1;
  tickRoll(dt: number): void {
    if (this.rollT < 0) return;
    this.rollT += dt;
    const k = Math.min(1, this.rollT / CREDITS_ROLL_S);
    const vh = (typeof window !== 'undefined' ? window.innerHeight : 1080) || 1080;
    const y = vh - k * (vh + this.roll.offsetHeight);
    this.roll.style.transform = `translateY(${y.toFixed(1)}px)`;
    if (k >= 1) this.rollT = -1;
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
  /** SMOOTH-FRAMES (#142): the camera pose the last frame rendered (end of update()) — a cutscene's first held frame is
   *  a cut only if it jumps from THIS pose; and a pending release-snap decision (see camera.release). */
  const renderedPos = new THREE.Vector3(NaN, NaN, NaN);
  const renderedDir = new THREE.Vector3(0, 0, -1);
  let releaseCheck = false;
  let cullWas = false;
  let lockMode: LockMode = 'none';
  let saved: { enabled: boolean; look: boolean } | null = null;
  const gutters: { f: any; base: number; t: number; d: number }[] = [];
  // SMOOTH-FIX (#145, hunt F1): `fx torchFade {d, e1}` — the torch goes down as a film camera takes over from the eye.
  // C2 switched the torch off on its first frame while its film camera (0.625) replaced the torch-adapted eye (0.066):
  // the TAAU history still held the torch-lit haze, so the first C2 frame was ×16 brighter than the B03 frame before it
  // and decayed over 10 frames. Now the cutscene's exposure cue eases e0 → e1 over `d` s (opening.ts `ramp`) and the
  // beam fades with it so that the torch pool's brightness ON SCREEN falls linearly to 0: beam × (1 − s) · e0/e(t),
  // e(t) = e0·(e1/e0)^s, s = smoothstep(t/d) — the same clock and curve as the exposure ramp. Then it is switched off.
  // `lowerX/Y/Z` (PLAN, optional): the beam is LOWERED onto that point over the fade (BEAM_CLAMP.at moves from where the
  // beam points now) — after1 C2: with the beam left on the doorway the eye's last 0.4 m toward the jamb brightened its
  // pool ×2.6 (1/d²) while it faded, then the pool slid off the jamb (×0.06 in 4 frames). `de`: the exposure ramp's
  // length when it differs from the fade.
  type Fade = { t: number; d: number; de: number; e0: number; e1: number; base: number; bounce: number; aim0: any; aim1: any; clampOn: boolean; clampAt: [number, number, number] | null };
  let torchFade: Fade | null = null;
  const smooth01 = (x: number) => {
    const u = Math.min(1, Math.max(0, x));
    return u * u * (3 - 2 * u);
  };
  const endTorchFade = (off: boolean) => {
    if (!torchFade) return;
    const f = torchFade;
    torchFade = null;
    const fl = g.rig?.flashlight;
    if (fl) fl.intensity = f.base;
    LOOK.bounce = f.bounce;
    if (f.aim1) {
      BEAM_CLAMP.on = f.clampOn;
      BEAM_CLAMP.at = f.clampAt;
    }
    if (off) g.rig?.setOn?.(false);
  };
  const tickTorchFade = (dt: number) => {
    const f = torchFade;
    if (!f) return;
    f.t += dt;
    const sf = smooth01(f.t / f.d);
    const se = smooth01(f.t / f.de);
    const k = Math.max(0, Math.min(1, (1 - sf) * Math.pow(f.e0 / f.e1, se)));
    const fl = g.rig?.flashlight;
    if (fl) fl.intensity = f.base * k;
    LOOK.bounce = f.bounce * k;
    if (f.aim1) {
      const p = f.aim0.clone().lerp(f.aim1, sf);
      BEAM_CLAMP.on = true;
      BEAM_CLAMP.at = [p.x, p.y, p.z];
    }
    if (f.t >= f.d) endTorchFade(true);
  };
  // SMOOTH-FIX (#145b, re-verify F7 + N1): `fx beamClamp {on, gaze: 1, d?}` — the torch lights what the eye looks at.
  // The plain clamp holds the beam within 12° of the GAZE DIRECTION, but the torch hangs 0.25–0.7 m under the eye in the
  // run / stumble / breath clips (scratch/reverify rows `tl`): parallel to the gaze, its pool lands that far BELOW the
  // gaze point — 18–30° at 1–1.5 m, under the bottom of C2c's 38° frame — and the frame went black: C2c 6.63–6.8 (the
  // stumble whip, 6 frames), 8.53–8.93 / 10.73–11.03 (the landing wall 0.9 m away). A hand points a torch AT what the
  // eyes are on: each held frame the beam is aimed (BEAM_CLAMP.at) at the gaze ray's hit on the house (the static
  // sight ray, flashlight-bounce TORCH_WORLD.sight, ≤ GAZE_FAR m) — or, with `d`, at the point d m along the gaze
  // (glance #2: her hand, which the static ray goes past). The aim distance eases in log space (GAZE_TAU) so a ray
  // grazing a newel or a door edge (1 m ↔ 5 m) swings the beam over a few frames instead of one. From the shot's own
  // un-shaken gaze (the handheld shake moves the frame round the pool, as a hand-held camera does); while `torchHold`
  // keeps the torch arm forward (glance #1), from the held rig's forward instead. Off with any other beamClamp cue and
  // on release.
  const GAZE_FAR = 8;
  const GAZE_NEAR = 0.25;
  const GAZE_TAU = 0.08;
  let beamGaze: { d: number; fixed: number | null; primed: boolean } | null = null;
  const poseW = new THREE.Vector3(NaN, NaN, NaN);
  const poseT = new THREE.Vector3();
  const gazeO = new THREE.Vector3();
  const gazeD = new THREE.Vector3();
  const gazeAt: [number, number, number] = [0, 0, 0];
  const tickBeamGaze = (dt: number) => {
    const bg = beamGaze;
    if (!bg || !camHeld || Number.isNaN(poseW.x)) return;
    const rr = g.rig?.rig;
    if (g.rig?.hold && rr) {
      rr.updateWorldMatrix(true, false);
      gazeO.setFromMatrixPosition(rr.matrixWorld);
      gazeD.set(0, 0, -1).transformDirection(rr.matrixWorld);
    } else {
      gazeO.copy(poseW);
      gazeD.copy(poseT).sub(poseW);
      if (gazeD.lengthSq() < 1e-8) return;
      gazeD.normalize();
    }
    let want = bg.fixed;
    if (want == null) {
      const hit = TORCH_WORLD.sight ? TORCH_WORLD.sight(gazeO, gazeD, GAZE_FAR) : Infinity;
      want = Number.isFinite(hit) ? hit : GAZE_FAR;
    }
    want = Math.max(GAZE_NEAR, want);
    if (!bg.primed) {
      // continue from where the beam points now (an explicit aim point) — no jump when the mode takes over
      const at = BEAM_CLAMP.on ? BEAM_CLAMP.at : null;
      bg.d = at ? Math.max(GAZE_NEAR, (at[0] - gazeO.x) * gazeD.x + (at[1] - gazeO.y) * gazeD.y + (at[2] - gazeO.z) * gazeD.z) : want;
      bg.primed = true;
    }
    if (dt > 0) bg.d = Math.exp(Math.log(bg.d) + (Math.log(want) - Math.log(bg.d)) * (1 - Math.exp(-dt / GAZE_TAU)));
    gazeAt[0] = gazeO.x + gazeD.x * bg.d;
    gazeAt[1] = gazeO.y + gazeD.y * bg.d;
    gazeAt[2] = gazeO.z + gazeD.z * bg.d;
    BEAM_CLAMP.on = true;
    BEAM_CLAMP.at = gazeAt;
  };
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
        // QA hook (fix round 2, hero-still sweeps): globalThis.__csCam = { pos, target, fov } (PLAN) overrides the pose
        const qo = (globalThis as { __csCam?: { pos: P3; target: P3; fov: number } }).__csCam;
        if (qo) p = { ...p, pos: qo.pos, target: qo.target, fov: qo.fov, shake: [0, 0, 0], roll: 0 };
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
          const ext = CS_CULL_EXT_IDS.has(player.active ?? '');
          const inside = r === null ? lv.viewerFeetZ !== null : r !== undefined && (ext || lv.index.rooms.get(r)?.kind === 'interior');
          lv.viewerFeetZ = inside ? feet : null;
          // AD review M-A: C5b's telephoto on the parlor shutter (135 mm) from the porch needs G2 (the sill candle catching
          // behind the slats is the shot); EXT2's PVS has only G1 — added for that narrow exterior lens only
          lv.extraVisible = player.active === 'C5b' && ext && p.fov < 20 ? C5B_SHUTTER_ROOMS : null;
          if (lv.cullingEnabled !== inside) lv.setCulling(inside);
        }
        const w = planToWorld(p.pos);
        const t = planToWorld(p.target);
        // R2-5 (round 3): a CUT (the pose jumps > 1.2 m (a 15 m/s car moves 0.75 m a frame at 20 fps) or turns > 20° between two frames) adapts the
        // exposure with it — the auto snap only fires on > 2.5 m moves, so same-room cuts eased in over τ 6 s
        // SMOOTH-FRAMES (#142): the FIRST held frame is compared like any other — with the frame rendered before it (the
        // gameplay camera, or the pose a chained cutscene ended on this same frame). It always snapped: a cutscene that
        // starts on the player's own eye (C3, C4a, C4c, C5, C6) stepped the exposure ×3 in one frame 0.3 s in
        // (scripts/qa/cs-frames.mjs C3 0.333).
        const dir = tmpD.set(t[0] - w[0], t[1] - w[1], t[2] - w[2]).normalize();
        poseW.set(w[0], w[1], w[2]); // SMOOTH-FIX (#145b): the un-shaken gaze for the beam's gaze aim
        poseT.set(t[0], t[1], t[2]);
        if (!camHeld) {
          lastCamPos.copy(renderedPos);
          lastCamDir.copy(renderedDir);
        }
        if (Number.isNaN(lastCamPos.x) || lastCamPos.distanceToSquared(tmpT.set(w[0], w[1], w[2])) > 1.44 || dir.dot(lastCamDir) < 0.94) requestExposureSnap();
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
        // SMOOTH-FIX (#145, hunt F2b): pose the torch rig on THIS camera now. The arms (story-runtime, after this update)
        // aim the beam — BEAM_CLAMP / its `at` point — in the rig's frame, but the rig only followed the camera later in
        // the frame (world → rig.update): on every cut the beam was aimed for the previous shot's pose, so C4c's 0.4 s
        // memory flash-frames opened on a black frame (the torch lit nothing in view) and fast whips lagged a frame.
        // The second snap leaves the frame's own rig.update exactly as before.
        if (g.rig?.update) {
          g.rig.update(0, g.ctx?.time?.now ?? 0);
          g.rig.snap?.();
        }
      },
      release() {
        camHeld = false;
        beamGaze = null;
        poseW.set(NaN, NaN, NaN);
        BEAM_CLAMP.on = false;
        BEAM_CLAMP.at = null;
        if (cullWas) {
          cullWas = false;
          if (g.level) {
            g.level.viewerFeetZ = null;
            g.level.extraVisible = null;
          }
          VIEW_CULL_SCOPE.on = false;
          g.level?.setCulling?.(true);
        }
        cam.fov = g.ctx.settings.fovDeg;
        cam.updateProjectionMatrix();
        applyPlayerCamera();
        g.rig?.snap?.();
        // R2-5: back on the player's eye = a cut — SMOOTH-FRAMES (#142): only when it IS one (the hand-backs that end on
        // the player's own camera — C2c, C4a, C4c, C5, C5b — snapped the exposure 0.3 s into gameplay). Decided at the end
        // of this frame's update(): a cutscene chained on the same frame takes the camera first (its own first frame
        // then compares with the pose rendered before it).
        releaseCheck = true;
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
          heartbeat: (bpm) => g.audio.layers?.setHeartRate(bpm, true),
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
        endTorchFade(false); // a later torch cue (C2c's run, a skip) ends a fade where it is
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
          // SMOOTH-FIX (#145b): `gaze` — aim at what the eye looks at, every held frame (tickBeamGaze); `d` = a fixed
          // distance along the gaze. The aim point it starts from is the current one (no jump when it takes over).
          if (params.on && params.gaze) {
            beamGaze = { d: beamGaze?.d ?? 1, fixed: params.d !== undefined ? Number(params.d) : null, primed: !!beamGaze };
            return;
          }
          beamGaze = null;
          BEAM_CLAMP.on = !!params.on; // C2-ESCAPE review: the climb's torch stays within 12° of the gaze (arms.ts)
          // fix round: optional aim point (PLAN) — glance #2 points the torch at her hand on the rail
          BEAM_CLAMP.at = params.atX !== undefined ? (planToWorld([Number(params.atX), Number(params.atY), Number(params.atZ)]) as [number, number, number]) : null;
          return;
        }
        if (id === 'torchHold' && g.rig) {
          g.rig.hold = !!params.on; // C2-ESCAPE: the torch arm stays forward while the head turns back
          return;
        }
        if (id === 'torchFade') {
          endTorchFade(false);
          const fl = g.rig?.flashlight;
          if (!g.rig?.on || !fl) {
            g.rig?.setOn?.(false);
            return;
          }
          const now = g.pipeline?.()?.uniforms?.exposure?.value;
          const e1 = Math.max(1e-4, Number(params.e1 ?? now ?? 1));
          const e0 = Math.max(1e-4, typeof now === 'number' && Number.isFinite(now) && now > 0 ? now : e1);
          const d = Math.max(0.05, Number(params.d ?? 1));
          let aim0: any = null;
          let aim1: any = null;
          if (params.lowerX !== undefined && fl.light?.target) {
            fl.light.target.updateWorldMatrix?.(true, false);
            aim0 = fl.light.target.getWorldPosition(new THREE.Vector3());
            const w = planToWorld([Number(params.lowerX), Number(params.lowerY), Number(params.lowerZ)]);
            aim1 = new THREE.Vector3(w[0], w[1], w[2]);
          }
          torchFade = { t: 0, d, de: Math.max(0.05, Number(params.de ?? d)), e0, e1, base: fl.intensity, bounce: LOOK.bounce, aim0, aim1, clampOn: BEAM_CLAMP.on, clampAt: BEAM_CLAMP.at };
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
      return { player: { eye, heading, pitch, fov: g.ctx.settings.fovDeg, torch: !!g.rig?.on }, ada: g.characters?.pose?.('ada') ?? null, flags: g.ctx.flags, motionBlur: !!g.pipeline?.()?.blurAvailable, tier: g.ctx.presetId };
    },
  };

  const player = new CutscenePlayer({ deps, library: g.library ?? CUTSCENES, seen: g.seen ?? localSeenStore() });
  const hem = new HemOverlay(player);
  let pourHeld = 0;
  // SMOOTH-FIX (#145b, re-verify F9 second half): inside Ada's wardrobe the U3 night bake is lifted × C4_HIDE_LM
  // (c4-hem.ts: the room's 0.0005 lux to the real 0.003–0.03 lux range). Eased in log space (in τ C4_HIDE_LM_TAU_IN as the
  // player settles into the hide, out τ C4_HIDE_LM_TAU_OUT after they leave it) on GRADE.lm itself, so an ease cut short
  // by a Director cutscene (death, C5 …: they own the grade, their teardown resets it) resumes from what it left. The
  // hem segments carry no grade cues. Outside cutscenes nothing else writes GRADE.lm (host.ts lmScale / resetGrade only).
  let hideLmPrev = 1;
  const tickHideLm = (dt: number) => {
    const act = player.active;
    if (act && !act.startsWith('C4_')) return;
    const want = hem.lmWanted;
    // LEAD (re-verify r2, R2-1): leaving the hide is a camera cut (out through its back into U4T, or out of the doors) —
    // the lift ends ON that cut. Eased out over τ 1.2 s, the first exit frames showed U4T ×10 over-exposed.
    const left = hideLmPrev > 1 && want === 1;
    hideLmPrev = want;
    if (left) {
      GRADE.lm = 1;
      uHideDim.value = 1;
      return;
    }
    const cur = Math.max(1e-3, GRADE.lm);
    if (cur !== want && dt > 0) {
      const tau = want > cur ? C4_HIDE_LM_TAU_IN : C4_HIDE_LM_TAU_OUT;
      let next = Math.exp(Math.log(cur) + (Math.log(want) - Math.log(cur)) * (1 - Math.exp(-dt / tau)));
      if (Math.abs(Math.log(next / want)) < 0.004) next = want;
      GRADE.lm = next;
    }
    // FINAL-B (#154, R1-4): inside the wardrobe its own slats keep the un-lifted light (src/world/hide-dim.ts)
    uHideDim.value = want > 1 ? 1 / Math.max(1, GRADE.lm) : 1;
  };
  // FINAL-B (#154, R1-1): the exit cut itself. tickHideLm runs inside update() BEFORE the frame's exits happen — the
  // wardrobe-back push (m2-world, after this update) and hem.update(…, hides.active) — so it saw the hide a frame late
  // and the exit frame + the one after rendered U4T × C4_HIDE_LM (exit+0 13.9, exit+2 0.9 at e 24, R1/R2 reviews).
  // hides.exit() emits `player:hide` synchronously, before cutscene-fx copies GRADE.lm into the lightmap / probe-grid
  // scale (story-runtime fxw.update, later in the same frame): end the lift right there, and keep hem in step.
  const offHide = g.ctx.events.on?.('player:hide', (p: { hideId?: string; inside?: boolean }) => {
    if (p?.hideId !== hem.hide) return;
    hem.setHidden(p.inside ? p.hideId : null);
    if (p.inside) return;
    hideLmPrev = 1;
    uHideDim.value = 1;
    const act = player.active;
    if (act && !act.startsWith('C4_')) return; // a Director cutscene owns the grade (its teardown resets it)
    GRADE.lm = 1;
  });

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
      overlay?.tickRoll(dt); // M-A CR roll
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
      tickTorchFade(dt);
      tickBeamGaze(dt);
      tickHideLm(dt);
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
      // SMOOTH-FRAMES (#142): a release this frame that no chained cutscene took over: snap only if the player's eye is a
      // cut from the cutscene's last pose; then remember the pose this frame renders
      cam.updateMatrixWorld(true);
      if (releaseCheck) {
        releaseCheck = false;
        if (!camHeld && (lastCamPos.distanceToSquared(cam.position) > 1.44 || cam.getWorldDirection(tmpT).dot(lastCamDir) < 0.94)) requestExposureSnap();
      }
      renderedPos.copy(cam.position);
      cam.getWorldDirection(renderedDir);
    },
    dispose() {
      offHide?.();
      endTorchFade(false);
      player.cancel();
      overlay?.dispose();
      warned = new Set();
    },
  };
}
