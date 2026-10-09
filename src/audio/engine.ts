// Audio engine: context unlock, buses → master limiter, volume settings, pause, listener, the one-shot bank, live
// layers (rain, wind, drone, chase cluster, heartbeat, Ada's drip loop, thunder locked to each flash), room reverb
// and room-graph occlusion. Registered as the 'audio' System (update order: … world → audio → render).
//
// No three.js dependency: the listener API takes plain numbers (or a column-major 4×4 matrix array, e.g.
// `camera.matrixWorld.elements`).

import type { EventBus, GameEvents } from '../core/events.ts';
import type { Settings } from '../shared/types.ts';
import type { LevelLayout, RoomLink } from '../shared/layout-types.ts';
import type { GameContext, System } from '../game/context.ts';
import { BUS_NAMES, type BusName } from './synth/types.ts';
import type { Params } from './synth/types.ts';
import { getRecipe } from './synth/index.ts';
import { prerenderBanks, renderVariants, type Bank, type PrerenderOptions } from './offline.ts';
import { SpatialEmitter, bestPath, occlusionFor, roomAtWorld, type DoorOpenFn, type PannerOpts } from './spatial.ts';
import { RoomReverb, type ReverbParams } from './reverb.ts';

type AnyEvents = EventBus<GameEvents>;

/** Which Settings.volume channel drives each bus. */
export const BUS_VOLUME: Record<BusName, keyof Settings['volume'] | null> = {
  ambience: 'ambience',
  weather: 'ambience',
  sfx: 'sfx',
  creature: 'sfx',
  player: 'sfx',
  voice: 'voice',
  score: 'music',
  ui: null, // master only
};

/** Fixed mix trims per bus (dB) on top of the user volumes — the house mix. */
const BUS_TRIM_DB: Record<BusName, number> = {
  ambience: -4,
  weather: -3,
  sfx: 0,
  creature: 0,
  player: -2,
  voice: 0,
  score: -6,
  ui: -6,
};

const dbToGain = (db: number) => Math.pow(10, db / 20);
/** Perceptual volume curve: slider 0..1 → gain (≈ -50 dB at 0.05, 0 dB at 1). */
export const volumeCurve = (v: number): number => (v <= 0 ? 0 : Math.pow(Math.min(1, v), 2));

export interface PlayOptions {
  bus?: BusName;
  /** World position → positional (HRTF + occlusion). Omit for non-positional. */
  pos?: [number, number, number];
  /** Room of a positional source (else looked up from the layout). */
  room?: string;
  gain?: number;
  /** Playback-rate multiplier. */
  rate?: number;
  /** Context time; default now. */
  when?: number;
  variant?: number;
  loop?: boolean;
  /** Fade-in seconds. */
  fadeIn?: number;
  panner?: PannerOpts;
}

export interface PlayHandle {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly emitter: SpatialEmitter | null;
  stop(fadeSec?: number): void;
  setPosition(x: number, y: number, z: number, room?: string): void;
  readonly ended: Promise<void>;
}

// ------------------------------------------------------------------------------------------------ engine

export interface AudioEngineOptions {
  context?: AudioContext;
  settings: Settings;
  events?: AnyEvents;
  layout?: LevelLayout;
}

export class AudioEngine implements System {
  readonly id = 'audio';
  readonly ctx: AudioContext;
  readonly buses: Record<BusName, GainNode>;
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
  bank: Bank = new Map();
  settings: Settings;
  private events: AnyEvents | null = null;
  private offs: (() => void)[] = [];
  private layout: LevelLayout | null = null;
  private links: RoomLink[] = [];
  private isDoorOpen: DoorOpenFn = () => false;
  private listenerRoom: string | null = null;
  private emitters = new Set<SpatialEmitter>();
  private reverbs = new Map<string, RoomReverb>();
  private reverbIn: GainNode;
  private activeReverb: RoomReverb | null = null;
  private occlusionClock = 0;
  private pending = new Map<string, Promise<AudioBuffer[]>>();
  private userPaused = false;
  private hidden = false;
  readonly layers: LiveLayers;

  constructor(o: AudioEngineOptions) {
    this.settings = o.settings;
    this.ctx = o.context ?? new AudioContext({ latencyHint: 'interactive' });
    const c = this.ctx;
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.2;
    this.master = c.createGain();
    this.master.connect(this.limiter).connect(c.destination);
    this.buses = {} as Record<BusName, GainNode>;
    for (const b of BUS_NAMES) {
      const g = c.createGain();
      g.connect(this.master);
      this.buses[b] = g;
    }
    this.reverbIn = c.createGain();
    this.applyVolumes(o.settings, 0);
    if (o.layout) this.setLayout(o.layout);
    if (o.events) this.attachEvents(o.events);
    this.layers = new LiveLayers(this);
    this.installUnlock();
    if (typeof document !== 'undefined') {
      const onVis = () => {
        this.hidden = document.visibilityState === 'hidden';
        this.syncSuspend();
      };
      document.addEventListener('visibilitychange', onVis);
      this.offs.push(() => document.removeEventListener('visibilitychange', onVis));
    }
  }

  // ---------------------------------------------------------------- System

  async init(gctx: GameContext): Promise<void> {
    if (!this.events) this.attachEvents(gctx.events);
    if (gctx.layout?.rooms) this.setLayout(gctx.layout);
  }

  update(dt: number, gctx?: GameContext): void {
    if (gctx?.settings && gctx.settings !== this.settings) this.applyVolumes(gctx.settings);
    const m = gctx?.camera?.matrixWorld?.elements as ArrayLike<number> | undefined;
    if (m) this.setListenerMatrix(m);
    this.layers.update(dt);
    this.occlusionClock -= dt;
    if (this.occlusionClock <= 0) {
      this.occlusionClock = 0.1;
      this.refreshOcclusion();
    }
  }

  dispose(): void {
    this.offs.forEach((f) => f());
    this.offs = [];
    this.layers.stopAll();
    for (const e of this.emitters) e.dispose();
    this.emitters.clear();
    for (const r of this.reverbs.values()) r.dispose();
    void this.ctx.close().catch(() => {});
  }

  // ---------------------------------------------------------------- unlock / pause / volume

  /** Resume the context (call from a user gesture if it is still suspended). */
  async unlock(): Promise<void> {
    if (this.ctx.state !== 'running' && !this.userPaused && !this.hidden) {
      try {
        await this.ctx.resume();
      } catch {
        /* ignored — will retry on the next gesture */
      }
    }
  }

  private installUnlock(): void {
    if (typeof window === 'undefined') return;
    const kick = () => {
      if (this.ctx.state === 'running') return;
      void this.unlock();
    };
    const evs = ['pointerdown', 'keydown', 'touchend'] as const;
    for (const e of evs) window.addEventListener(e, kick, { capture: true });
    this.offs.push(() => evs.forEach((e) => window.removeEventListener(e, kick, { capture: true })));
  }

  setPaused(paused: boolean): void {
    this.userPaused = paused;
    this.syncSuspend();
  }

  private syncSuspend(): void {
    const want = this.userPaused || this.hidden;
    const t = this.ctx.currentTime;
    if (want && this.ctx.state === 'running') {
      this.master.gain.setTargetAtTime(0, t, 0.03);
      setTimeout(() => {
        if (this.userPaused || this.hidden) void this.ctx.suspend().catch(() => {});
      }, 120);
    } else if (!want) {
      void this.ctx.resume().catch(() => {}).then(() => {
        this.master.gain.setTargetAtTime(volumeCurve(this.settings.volume.master), this.ctx.currentTime, 0.05);
      });
    }
  }

  applyVolumes(s: Settings, ramp = 0.05): void {
    this.settings = s;
    const t = this.ctx.currentTime;
    if (!this.userPaused && !this.hidden) this.master.gain.setTargetAtTime(volumeCurve(s.volume.master), t, ramp || 0.001);
    for (const b of BUS_NAMES) {
      const ch = BUS_VOLUME[b];
      const v = ch ? volumeCurve(s.volume[ch]) : 1;
      this.buses[b].gain.setTargetAtTime(v * dbToGain(BUS_TRIM_DB[b]), t, ramp || 0.001);
    }
  }

  private attachEvents(ev: AnyEvents): void {
    this.events = ev;
    this.offs.push(
      ev.on('pause', ({ paused }) => this.setPaused(paused)),
      ev.on('settings:changed', () => this.applyVolumes(this.settings)),
      ev.on('thunder', (p) => this.layers.thunder(p.delayMs / 1000, p.durationMs / 1000, p.distance)),
      ev.on('player:breath', ({ holding }) => this.layers.breathHold(holding)),
      ev.on('ai:state', ({ to }) => this.layers.onAiState(to)),
    );
  }

  // ---------------------------------------------------------------- listener

  /** Listener position + forward + up (world space). */
  setListener(px: number, py: number, pz: number, fx: number, fy: number, fz: number, ux = 0, uy = 1, uz = 0): void {
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(px, t, 0.02);
      l.positionY.setTargetAtTime(py, t, 0.02);
      l.positionZ.setTargetAtTime(pz, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02);
      l.forwardY.setTargetAtTime(fy, t, 0.02);
      l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.setTargetAtTime(ux, t, 0.02);
      l.upY.setTargetAtTime(uy, t, 0.02);
      l.upZ.setTargetAtTime(uz, t, 0.02);
    } else {
      const legacy = l as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void };
      legacy.setPosition(px, py, pz);
      legacy.setOrientation(fx, fy, fz, ux, uy, uz);
    }
    if (this.layout) {
      const room = roomAtWorld(this.layout, px, py, pz);
      if (room && room !== this.listenerRoom) this.setListenerRoom(room);
    }
  }

  /** From a column-major 4×4 world matrix (three.js `matrixWorld.elements`): camera looks down its local −Z. */
  setListenerMatrix(e: ArrayLike<number>): void {
    this.setListener(e[12], e[13], e[14], -e[8], -e[9], -e[10], e[4], e[5], e[6]);
  }

  // ---------------------------------------------------------------- rooms, reverb, occlusion

  setLayout(layout: LevelLayout): void {
    this.layout = layout;
    this.links = layout.roomLinks ?? [];
  }

  /** The world/door system tells us door states (open/ajar = true). Occlusion re-evaluates at 10 Hz. */
  setDoorStateProvider(fn: DoorOpenFn): void {
    this.isDoorOpen = fn;
  }

  setListenerRoom(room: string): void {
    this.listenerRoom = room;
    const def = this.layout?.rooms.find((r) => r.id === room);
    if (def) this.useReverb(room, def.reverb);
    this.refreshOcclusion();
  }

  getListenerRoom(): string | null {
    return this.listenerRoom;
  }

  /** Crossfade the global reverb to the listener's room IR (emitters send post-occlusion into it). */
  useReverb(key: string, p: ReverbParams): void {
    let r = this.reverbs.get(key);
    if (!r) {
      r = new RoomReverb(this.ctx, p);
      r.output.connect(this.master);
      this.reverbs.set(key, r);
    }
    if (r === this.activeReverb) return;
    const t = this.ctx.currentTime;
    const prev = this.activeReverb;
    if (prev) {
      const pg = prev.output.gain;
      pg.setTargetAtTime(0, t, 0.15);
      setTimeout(() => {
        try {
          this.reverbIn.disconnect(prev.input);
        } catch {
          /* already disconnected */
        }
      }, 800);
    }
    this.reverbIn.connect(r.input);
    r.output.gain.cancelScheduledValues(t);
    r.output.gain.setTargetAtTime(r.params.wet * 0.35, t, 0.15);
    this.activeReverb = r;
  }

  /** Send bus for anything that should reverberate in the listener's room (non-positional sources too). */
  get reverbInput(): AudioNode {
    return this.reverbIn;
  }

  createEmitter(bus: BusName = 'creature', o?: PannerOpts): SpatialEmitter {
    const e = new SpatialEmitter(this.ctx, this.buses[bus], o);
    e.sendTo(this.reverbIn);
    this.emitters.add(e);
    return e;
  }

  releaseEmitter(e: SpatialEmitter): void {
    e.dispose();
    this.emitters.delete(e);
  }

  /** Attenuation between the listener's room and `room` (1 when unknown). Exposed for the AI/debug overlay. */
  pathTo(room: string | null): ReturnType<typeof bestPath> {
    if (!room || !this.listenerRoom || !this.links.length) return { attenuation: 1, rooms: [], via: [] };
    return bestPath(this.links, this.listenerRoom, room, this.isDoorOpen);
  }

  refreshOcclusion(): void {
    for (const e of this.emitters) e.setOcclusion(occlusionFor(this.pathTo(e.room)));
  }

  // ---------------------------------------------------------------- bank

  async prerender(opts: PrerenderOptions = {}): Promise<void> {
    const { bank } = await prerenderBanks(this.ctx, opts);
    for (const [k, v] of bank) this.bank.set(k, v);
  }

  /** Make sure a (lazy) sound is rendered; resolves when ready. */
  ensure(id: string, params?: Params): Promise<AudioBuffer[]> {
    const have = this.bank.get(id);
    if (have) return Promise.resolve(have);
    let p = this.pending.get(id);
    if (!p) {
      p = renderVariants(this.ctx, id, { params }).then((b) => {
        this.bank.set(id, b);
        this.pending.delete(id);
        return b;
      });
      this.pending.set(id, p);
    }
    return p;
  }

  private lastVariant = new Map<string, number>();

  /** Pick a variant, never repeating the previous one. */
  pickBuffer(id: string, variant?: number): AudioBuffer | null {
    const list = this.bank.get(id);
    if (!list?.length) return null;
    if (variant !== undefined) return list[variant % list.length];
    if (list.length === 1) return list[0];
    const last = this.lastVariant.get(id) ?? -1;
    let v = Math.floor(Math.random() * (list.length - 1));
    if (v >= last) v++;
    this.lastVariant.set(id, v);
    return list[v];
  }

  /** Play a bank sound. Returns null if it isn't rendered yet (lazy sounds start rendering in the background). */
  play(id: string, o: PlayOptions = {}): PlayHandle | null {
    const b = this.pickBuffer(id, o.variant);
    if (!b) {
      void this.ensure(id).catch((e) => console.warn(`[audio] ${id}:`, e));
      return null;
    }
    return this.playBuffer(b, { ...o, bus: o.bus ?? getRecipe(id).bus, loop: o.loop ?? getRecipe(id).loop });
  }

  /**
   * C2-ESCAPE B12: the AudioContext time at which a sound must START to be HEARD `delayS` from now, i.e. on the video
   * frame the cutscene clock reaches its cue. The output path adds `outputLatency` (≈ 10–40 ms on macOS Chrome) after
   * start(); the frame we are building is presented ≈ one 60 Hz frame (16.7 ms) after this tick. Clamped to "now".
   */
  scheduleTime(delayS: number): number {
    const c: any = this.ctx;
    const out = Number.isFinite(c.outputLatency) && c.outputLatency > 0 ? c.outputLatency : Number.isFinite(c.baseLatency) ? c.baseLatency : 0;
    return c.currentTime + Math.max(0, delayS + 1 / 60 - out);
  }

  /** Play once it's available (renders lazily if needed). */
  async playWhenReady(id: string, o: PlayOptions = {}): Promise<PlayHandle | null> {
    await this.ensure(id);
    return this.play(id, o);
  }

  playBuffer(b: AudioBuffer, o: PlayOptions = {}): PlayHandle {
    const c = this.ctx;
    const when = o.when ?? c.currentTime;
    const src = c.createBufferSource();
    src.buffer = b;
    src.loop = !!o.loop;
    src.playbackRate.value = o.rate ?? 1;
    const g = c.createGain();
    const target = o.gain ?? 1;
    if (o.fadeIn) {
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(target, when + o.fadeIn);
    } else g.gain.value = target;
    src.connect(g);
    let emitter: SpatialEmitter | null = null;
    const bus = this.buses[o.bus ?? 'sfx'];
    if (o.pos) {
      emitter = this.createEmitter(o.bus ?? 'sfx', o.panner);
      emitter.room = o.room ?? (this.layout ? roomAtWorld(this.layout, o.pos[0], o.pos[1], o.pos[2]) : null);
      emitter.setPosition(o.pos[0], o.pos[1], o.pos[2]);
      emitter.setOcclusion(occlusionFor(this.pathTo(emitter.room)), 0.001);
      g.connect(emitter.input);
    } else {
      g.connect(bus);
    }
    const ended = new Promise<void>((resolve) => {
      src.onended = () => {
        if (emitter) this.releaseEmitter(emitter);
        g.disconnect();
        resolve();
      };
    });
    src.start(when);
    const self = this;
    return {
      source: src,
      gain: g,
      emitter,
      ended,
      stop(fade = 0.05) {
        const t = self.ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0, t, Math.max(0.005, fade / 3));
        try {
          src.stop(t + fade + 0.05);
        } catch {
          /* not started / already stopped */
        }
      },
      setPosition(x, y, z, room) {
        if (!emitter) return;
        emitter.setPosition(x, y, z);
        const r = room ?? (self.layout ? roomAtWorld(self.layout, x, y, z) : null);
        if (r !== emitter.room) {
          emitter.room = r;
          emitter.setOcclusion(occlusionFor(self.pathTo(r)));
        }
      },
    };
  }
}

// ------------------------------------------------------------------------------------------------ live layers

type ScoreState = 'none' | 'drone' | 'chase' | 'blue_hour';

/**
 * Long-running layers driven by game state. All crossfade; none allocate per frame.
 * - Ada's drip: scheduled drops (rate follows her speed), positional, stops when she LISTENs.
 * - Heartbeat: scheduled beats at a bpm (0 = off).
 * - Rain/wind beds per surface with an indoor/outdoor mix; thunder locked to each flash.
 * - Score: drone / chase cluster / blue-hour pad.
 */
export class LiveLayers {
  private e: AudioEngine;
  private loops = new Map<string, PlayHandle>();
  // drip
  private dripEmitter: SpatialEmitter | null = null;
  private dripRate = 0;
  private dripNext = 0;
  private dripOn = false;
  // heartbeat
  private bpm = 0;
  private beatNext = 0;
  private score: ScoreState = 'none';
  private scoreBeforeChase: ScoreState = 'drone';
  private holdHandle: PlayHandle | null = null;

  constructor(e: AudioEngine) {
    this.e = e;
  }

  update(_dt: number): void {
    const now = this.e.ctx.currentTime;
    const horizon = now + 0.15; // lookahead
    if (this.dripOn && this.dripRate > 0 && this.dripEmitter) {
      if (this.dripNext < now) this.dripNext = now + 0.02;
      while (this.dripNext < horizon) {
        const b = this.e.pickBuffer('ada_drip');
        if (b) this.fire(b, this.dripNext, this.dripEmitter.input, 0.7 + Math.random() * 0.3, 0.9 + Math.random() * 0.2);
        // irregular: exponential-ish around the mean interval
        const mean = 1 / this.dripRate;
        this.dripNext += mean * (0.55 + Math.random() * 0.9);
      }
    }
    if (this.bpm > 0) {
      if (this.beatNext < now) this.beatNext = now + 0.02;
      while (this.beatNext < horizon) {
        const b = this.e.pickBuffer('heartbeat');
        if (b) this.fire(b, this.beatNext, this.e.buses.player, 1, 1);
        this.beatNext += 60 / this.bpm;
      }
    }
  }

  private fire(b: AudioBuffer, when: number, dest: AudioNode, gain: number, rate: number): void {
    const s = this.e.ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate;
    const g = this.e.ctx.createGain();
    g.gain.value = gain;
    s.connect(g).connect(dest);
    s.onended = () => g.disconnect();
    s.start(when);
  }

  // ---- Ada's drip

  /** Attach the drip to Ada (position updated by the character system every frame via `setDripPosition`). */
  startDrip(ratePerSec = 1.2): void {
    if (!this.dripEmitter) this.dripEmitter = this.e.createEmitter('creature', { refDistance: 1.2, rolloffFactor: 0.9 });
    this.dripRate = ratePerSec;
    this.dripOn = true;
  }

  /** Rate follows her speed: e.g. 0.8/s at vigil, ~1.5 walking, ~3 running. */
  setDripRate(ratePerSec: number): void {
    this.dripRate = Math.max(0, ratePerSec);
  }

  setDripPosition(x: number, y: number, z: number, room?: string | null): void {
    if (!this.dripEmitter) return;
    this.dripEmitter.setPosition(x, y, z);
    if (room !== undefined && room !== this.dripEmitter.room) {
      this.dripEmitter.room = room;
      this.dripEmitter.setOcclusion(occlusionFor(this.e.pathTo(room)));
    }
  }

  /** The tell: the drip stops (she is listening). Plays the last heavy drop. */
  stopDrip(withTell = true): void {
    if (!this.dripOn) return;
    this.dripOn = false;
    if (withTell && this.dripEmitter) {
      const b = this.e.pickBuffer('ada_drip_stop');
      if (b) this.fire(b, this.e.ctx.currentTime + 0.05, this.dripEmitter.input, 1, 1);
    }
  }

  resumeDrip(): void {
    if (this.dripEmitter) this.dripOn = true;
  }

  onAiState(to: string): void {
    const s = to.toLowerCase();
    if (s === 'listen') this.stopDrip(true);
    else if (this.dripEmitter && !this.dripOn && s !== 'finale' && s !== 'scripted') this.resumeDrip();
    if (s === 'chase') {
      if (this.score !== 'chase') this.scoreBeforeChase = this.score === 'none' ? 'drone' : this.score;
      this.setScore('chase');
      this.setHeartRate(135);
    } else if (this.score === 'chase') {
      this.setScore(this.scoreBeforeChase);
      this.setHeartRate(0);
    }
  }

  // ---- heartbeat

  setHeartRate(bpm: number): void {
    this.bpm = Math.max(0, bpm);
  }

  // ---- loops (rain, wind, drones…)

  /** Start (or retarget the gain of) a named looping layer. */
  loop(key: string, id: string, o: { gain?: number; fade?: number; bus?: BusName; rate?: number } = {}): void {
    const have = this.loops.get(key);
    const gain = o.gain ?? 1;
    const fade = o.fade ?? 1.5;
    if (have) {
      const t = this.e.ctx.currentTime;
      have.gain.gain.cancelScheduledValues(t);
      have.gain.gain.setTargetAtTime(gain, t, fade / 3);
      return;
    }
    const start = () => {
      if (this.loops.has(key)) return;
      const h = this.e.play(id, { loop: true, gain, fadeIn: fade, bus: o.bus, rate: o.rate });
      if (h) this.loops.set(key, h);
    };
    if (this.e.bank.has(id)) start();
    else void this.e.ensure(id).then(start);
  }

  stopLoop(key: string, fade = 1.5): void {
    const h = this.loops.get(key);
    if (!h) return;
    this.loops.delete(key);
    h.stop(fade);
  }

  isLooping(key: string): boolean {
    return this.loops.has(key);
  }

  /**
   * Weather mix. `inside` 0 = outdoors, 1 = deep inside; `surface` = what rain is audible on near the listener.
   * Outdoors → surface bed dominant; inside → muffled roof + glass at windows.
   */
  setWeather(o: { rain: number; wind: number; inside: number; surface?: 'roof' | 'glass' | 'porch' | 'car' | 'gravel' }): void {
    const out = 1 - o.inside;
    const surf = o.surface ?? 'gravel';
    const all = ['roof', 'glass', 'porch', 'car', 'gravel'] as const;
    for (const s of all) {
      const g = s === surf ? o.rain * (surf === 'car' ? 1 : out) : 0;
      if (g > 0.001) this.loop(`rain_${s}`, `rain_${s}`, { gain: g });
      else this.stopLoop(`rain_${s}`, 1);
    }
    if (o.rain * o.inside > 0.001) this.loop('rain_inside', 'rain_inside', { gain: o.rain * o.inside });
    else this.stopLoop('rain_inside');
    if (o.wind > 0.001) this.loop('wind', 'wind', { gain: o.wind * (0.4 + 0.6 * out) });
    else this.stopLoop('wind');
  }

  /**
   * Thunder locked to a flash. The design contract: the roll that masks player noise starts ~1.5 s after the flash
   * and lasts 2.5 s — callers pass the same delay/duration they give the AI (`thunder` event).
   */
  thunder(delaySec: number, durSec: number, distance: number): void {
    const id = distance < 0.5 ? 'thunder_near' : 'thunder_distant';
    const list = this.e.bank.get(id);
    if (!list?.length) {
      void this.e.ensure(id);
      return;
    }
    const variant = Math.floor(Math.random() * list.length);
    const b = list[variant];
    // stretch the nearest-length variant to the requested roll length (≤ ±20% keeps it natural)
    const nominal = Math.max(0.5, b.duration - 0.8);
    const rate = Math.min(1.2, Math.max(0.8, nominal / Math.max(0.5, durSec)));
    const gain = 1 - 0.5 * Math.min(1, distance);
    this.e.play(id, { when: this.e.ctx.currentTime + Math.max(0, delaySec), rate, gain, bus: 'weather', variant });
    if (distance < 0.6 && this.e.bank.has('window_rattle')) {
      this.e.play('window_rattle', { when: this.e.ctx.currentTime + Math.max(0, delaySec) + 0.05, gain: 0.6 * (1 - distance), bus: 'weather' });
    }
  }

  // ---- score

  setScore(s: ScoreState, fade = 2.5): void {
    if (s === this.score) return;
    this.score = s;
    const map: Record<Exclude<ScoreState, 'none'>, string> = { drone: 'score_drone', chase: 'score_chase', blue_hour: 'score_blue_hour' };
    for (const [k, id] of Object.entries(map)) {
      if (k === s) this.loop(`score_${k}`, id, { fade: k === 'chase' ? 0.4 : fade, bus: 'score' });
      else this.stopLoop(`score_${k}`, k === 'chase' ? 3 : fade);
    }
  }

  stinger(id = 'score_stinger'): void {
    void this.e.playWhenReady(id, { bus: 'score' });
  }

  // ---- breath (Space)

  breathHold(holding: boolean): void {
    if (holding) {
      this.holdHandle?.stop(0.05);
      this.holdHandle = this.e.play('breath_hold', { bus: 'player' });
      this.stopLoop('breath', 0.2);
    } else {
      this.holdHandle = null;
      this.e.play('breath_release', { bus: 'player' });
    }
  }

  /** Player breathing bed: 'calm' | 'strained' | 'panting' | null. */
  setBreath(kind: 'calm' | 'strained' | 'panting' | null, gain = 1): void {
    const id = kind ? (kind === 'calm' ? 'breath_calm' : kind === 'strained' ? 'breath_strained' : 'panting') : null;
    const cur = this.currentBreath;
    if (id === cur) {
      if (id) this.loop('breath', id, { gain, bus: 'player' });
      return;
    }
    this.stopLoop('breath', 0.6);
    this.currentBreath = id;
    if (id) setTimeout(() => this.loop('breath', id, { gain, fade: 0.6, bus: 'player' }), 50);
  }
  private currentBreath: string | null = null;

  stopAll(): void {
    for (const k of [...this.loops.keys()]) this.stopLoop(k, 0.1);
    this.dripOn = false;
    this.bpm = 0;
  }
}

/** Convenience for lane B: create, prerender and register in one call. */
export async function createAudioSystem(gctx: GameContext, o: { context?: AudioContext; onProgress?: PrerenderOptions['onProgress'] } = {}): Promise<AudioEngine> {
  const engine = new AudioEngine({ context: o.context, settings: gctx.settings, events: gctx.events, layout: gctx.layout?.rooms ? gctx.layout : undefined });
  await engine.prerender({ onProgress: o.onProgress, maxVariants: gctx.presetId === 'low' ? 3 : undefined });
  gctx.systems.set(engine.id, engine);
  return engine;
}
