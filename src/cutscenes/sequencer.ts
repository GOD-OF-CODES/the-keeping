// The cutscene sequencer: plays one Timeline (src/cutscenes/types.ts) on the game loop's dt. PURE and deterministic:
// no three.js, no DOM, no wall clock, no Math.random. Everything it produces goes to a SequencerSink (the host
// adapter in src/cutscenes/host.ts maps that onto the world, characters, audio, UI and renderer).
//
// Timing rules (tested in tests/cutscene.test.ts):
//  - A cue fires exactly once, when the clock passes its time: prev < t ≤ now (a t = 0 cue fires on the first update).
//    Equal times fire in authoring order. The order of fired cues never depends on how dt is split.
//  - A `gate` cue holds the clock at its time until resolveGate(id) or its timeout (counted in dt while waiting).
//    Leftover dt at a gate is dropped. Handheld noise keeps running on the separate "wall" clock (sum of dt).
//  - Move tracks finish (final pose emitted) before any cue at or after their end time, so later `place` cues win.
//  - skip(): every remaining STATE cue (isStateCue) and every unfinished move's final pose is applied in time order
//    (sounds/voices/subtitles/cards/lightning are dropped), gates resolve, the camera snaps to the end, end(true).
//  - end(skipped) is emitted exactly once; update() is a no-op afterwards.

import { ArcPath, carToPlan, ease, handheld, hashString, headingOf, lerp, lerpAngle, sampleKeys } from './math.ts';
import { isStateCue, type CameraPose, type CameraShot, type CharId, type Cue, type MoveTrack, type P3, type Timeline, type VehiclePose, type VehicleTrack } from './types.ts';

export interface CueInfo {
  /** true when applied by skip() (only state cues are). */
  skipped: boolean;
  /** Seconds between the cue's time and the clock after this update (start offset for clips; ≥ 0). */
  late: number;
}

export interface SequencerSink {
  cue(c: Cue, info: CueInfo): void;
  /** Every update: the cutscene camera, or null = the player's camera (no shot covers this time). */
  camera(p: CameraPose | null): void;
  /** When the vehicle pose changes (null = no vehicle track). */
  vehicle?(p: VehiclePose | null): void;
  /** Character root motion from move tracks. */
  move?(char: CharId, pos: P3, heading: number): void;
  /** When fade / letterbox change. */
  overlay?(fade: number, letterbox: number): void;
  /** Waiting at a gate (id, prompt) or no longer waiting (null). */
  gate?(id: string | null, prompt?: string): void;
  end(skipped: boolean): void;
}

interface ShotRt {
  s: CameraShot;
  eye: ArcPath;
  at: ArcPath;
}

interface MoveRt {
  m: MoveTrack;
  path: ArcPath;
  finished: boolean;
  /** GLITCH-FIX (MoveTrack.turnIn): the heading the character had before this move (null = no blend). */
  from: number | null;
}

interface VehRt {
  v: VehicleTrack;
  path: ArcPath;
}

export class Sequencer {
  readonly timeline: Timeline;
  private readonly sink: SequencerSink;
  private readonly cues: Cue[];
  private readonly shots: ShotRt[];
  private readonly moves: MoveRt[];
  private readonly veh: VehRt[];
  private readonly seed: number;
  private ci = 0;
  private now = 0;
  private wallT = 0;
  private started = false;
  private finished = false;
  private waiting: { id: string; waited: number; timeout?: number } | null = null;
  private readonly resolved = new Set<string>();
  private readonly announced = new Set<string>();
  private lastFade = NaN;
  private lastBox = NaN;
  private lastVeh = '';

  constructor(tl: Timeline, sink: SequencerSink) {
    this.timeline = tl;
    this.sink = sink;
    // stable sort by time (authoring order among equals)
    this.cues = tl.cues.map((c, i) => ({ c, i })).sort((a, b) => a.c.t - b.c.t || a.i - b.i).map((x) => x.c);
    this.shots = (tl.shots ?? []).map((s) => ({ s, eye: new ArcPath(s.path), at: new ArcPath(s.target) }));
    this.moves = (tl.moves ?? []).map((m) => ({ m, path: new ArcPath(m.path), finished: false, from: null as number | null }));
    // GLITCH-FIX (MoveTrack.turnIn, CONTRACT-CHANGES #139): the heading each turning move starts from — the end of the
    // character's last earlier move in this timeline, else its last `place` cue at or before the move's start
    for (const rt of this.moves) {
      if (!(rt.m.turnIn && rt.m.turnIn > 0)) continue;
      let prev: MoveRt | null = null;
      for (const o of this.moves) if (o !== rt && o.m.char === rt.m.char && o.m.t + o.m.d <= rt.m.t + 1e-6 && (!prev || o.m.t + o.m.d > prev.m.t + prev.m.d)) prev = o;
      if (prev) rt.from = this.moveAt(prev, prev.m.t + prev.m.d).heading;
      else {
        let place: { t: number; heading: number } | null = null;
        for (const c of this.cues) if (c.type === 'place' && c.char === rt.m.char && c.t <= rt.m.t + 1e-6 && (!place || c.t >= place.t)) place = c;
        rt.from = place ? place.heading : null;
      }
    }
    this.veh = (tl.vehicle ?? []).map((v) => ({ v, path: new ArcPath(v.path) })).sort((a, b) => a.v.t - b.v.t);
    this.seed = tl.seed ?? hashString(tl.id);
  }

  get id(): string {
    return this.timeline.id;
  }
  /** Cutscene clock (s). */
  get time(): number {
    return this.now;
  }
  /** Sum of dt since start (keeps running at gates). */
  get wall(): number {
    return this.wallT;
  }
  get done(): boolean {
    return this.finished;
  }
  get waitingGate(): string | null {
    return this.waiting?.id ?? null;
  }

  resolveGate(id: string): void {
    this.resolved.add(id);
    if (this.waiting?.id === id) {
      this.waiting = null;
      this.sink.gate?.(null);
    }
  }

  /** Advance by dt seconds (dt = 0 while paused is fine: nothing fires). */
  update(dt: number): void {
    if (this.finished) return;
    const d = Math.max(0, dt);
    this.wallT += d;
    this.started = true;
    if (this.waiting) {
      this.waiting.waited += d;
      if (this.waiting.timeout !== undefined && this.waiting.waited >= this.waiting.timeout - 1e-9) this.resolveGate(this.waiting.id);
    }
    const dur = this.timeline.duration;
    let target = this.waiting ? this.now : Math.min(dur, this.now + d);
    // fire cues in (prev, target] (t ≤ 0 cues fire on the first update, even with dt = 0)
    while (this.ci < this.cues.length) {
      const c = this.cues[this.ci];
      if (c.t > target) break;
      this.finishMovesUpTo(c.t, false);
      if (c.type === 'gate') {
        if (!this.resolved.has(c.id)) {
          if (!this.waiting) {
            this.waiting = { id: c.id, waited: 0, timeout: c.timeout };
            if (!this.announced.has(c.id)) {
              this.announced.add(c.id);
              this.sink.cue(c, { skipped: false, late: 0 });
            }
            this.sink.gate?.(c.id, c.prompt);
          }
          target = c.t;
          break;
        }
        this.ci++;
        if (!this.announced.has(c.id)) {
          this.announced.add(c.id);
          this.sink.cue(c, { skipped: false, late: 0 });
        }
        continue;
      }
      this.ci++;
      this.sink.cue(c, { skipped: false, late: Math.max(0, target - c.t) });
    }
    this.now = target;
    this.evalContinuous(this.now);
    if (!this.waiting && this.ci >= this.cues.length && this.now >= dur) this.finish(false);
  }

  /** Jump to the end, applying state cues (see header). Returns false if already finished. */
  skip(): boolean {
    if (this.finished) return false;
    this.started = true;
    const dur = this.timeline.duration;
    for (; this.ci < this.cues.length; this.ci++) {
      const c = this.cues[this.ci];
      this.finishMovesUpTo(c.t, true);
      if (c.type === 'gate') {
        this.resolved.add(c.id);
        continue;
      }
      if (isStateCue(c)) this.sink.cue(c, { skipped: true, late: Math.max(0, dur - c.t) });
    }
    if (this.waiting) {
      this.waiting = null;
      this.sink.gate?.(null);
    }
    this.finishMovesUpTo(Infinity, true);
    this.now = dur;
    this.evalContinuous(dur);
    this.finish(true);
    return true;
  }

  /**
   * C2-ESCAPE (skip into a chained cutscene, C2 → C2c 10.4): jump forward to time t, applying every STATE cue before
   * t exactly as skip() does (late = t − c.t, so clips start at their right offset) and finishing the moves that ended
   * before t. Cues at or after t fire normally on the next update. Gates before t count as resolved.
   */
  seek(t: number): void {
    if (this.finished) return;
    const to = Math.max(this.now, Math.min(this.timeline.duration, t));
    this.started = true;
    for (; this.ci < this.cues.length; this.ci++) {
      const c = this.cues[this.ci];
      if (c.t >= to) break;
      this.finishMovesUpTo(c.t, true);
      if (c.type === 'gate') {
        this.resolved.add(c.id);
        continue;
      }
      if (isStateCue(c)) this.sink.cue(c, { skipped: true, late: Math.max(0, to - c.t) });
    }
    this.finishMovesUpTo(to - 1e-9, true);
    this.now = to;
    this.evalContinuous(to);
  }

  /** Stop without applying anything (teardown); emits nothing. */
  abort(): void {
    this.finished = true;
    this.waiting = null;
  }

  // ------------------------------------------------------------------ evaluation

  /** Camera pose at cutscene time t (null = no shot covers t). Exposed for tests / previews. */
  cameraAt(t: number, wall = t): CameraPose | null {
    const dur = this.timeline.duration;
    let rt: ShotRt | null = null;
    for (const s of this.shots) {
      const end = s.s.t + s.s.d;
      if (t >= s.s.t && (t < end || (t >= dur - 1e-9 && end >= dur - 1e-6))) rt = s;
    }
    if (!rt) return null;
    const s = rt.s;
    const u = s.d > 0 ? (t - s.t) / s.d : 1;
    const e = ease(s.ease, u, 'inOut');
    let pos = rt.eye.at(e);
    let target = rt.at.at(e);
    if (s.space === 'car') {
      const v = this.vehicleAt(t);
      if (v) {
        pos = carToPlan(pos, v.pos, v.heading);
        target = carToPlan(target, v.pos, v.heading);
      }
    } else if (s.track) {
      target = this.trackYaw(rt, t, e, pos, target);
    }
    const fov = typeof s.fov === 'number' ? s.fov : lerp(s.fov[0], s.fov[1], e);
    let roll = s.roll === undefined ? 0 : typeof s.roll === 'number' ? s.roll : lerp(s.roll[0], s.roll[1], e);
    if (s.bob) {
      const tau = t - s.t;
      // SMOOTH-FRAMES (#142): centred on the path and ZERO at τ = 0 — the old amp·(1 − cos)/2 − amp/2 started every
      // bobbing shot amp/2 below its path (a 1.5–2 cm drop on its first frame); with hz·d an integer it ends at 0 too
      const dz = -(s.bob.amp / 2) * Math.sin(2 * Math.PI * s.bob.hz * tau); // down first: the first foot plant at 0.25/hz
      pos = [pos[0], pos[1], pos[2] + dz];
      target = [target[0], target[1], target[2] + dz];
      roll += (s.bob.roll ?? 0) * Math.sin(Math.PI * s.bob.hz * tau);
    }
    const shake = handheld(wall, this.seed, s.handheld ?? 0);
    for (const k of this.timeline.kicks ?? []) {
      const u = (t - k.t) / k.d;
      if (u <= 0 || u >= 1) continue;
      const w = Math.sin(Math.PI * u);
      shake[0] += (k.yaw ?? 0) * w;
      shake[1] += (k.pitch ?? 0) * w;
      shake[2] += (k.roll ?? 0) * w;
    }
    return { pos, target, fov, roll, shake };
  }

  /** SMOOTH-FIX (#145): CameraShot.track — the look's yaw follows the vehicle's bearing from the eye (see types.ts). */
  private trackYaw(rt: ShotRt, t: number, e: number, pos: P3, target: P3): P3 {
    const s = rt.s;
    const at = s.track?.at ?? [0, 2.4, 0.6];
    const bearing = (tt: number, eye: P3): number | null => {
      const v = this.vehicleAt(tt);
      if (!v) return null;
      const p = carToPlan(at, v.pos, v.heading);
      return Math.atan2(p[1] - eye[1], p[0] - eye[0]);
    };
    const yawOf = (eye: P3, tg: P3) => Math.atan2(tg[1] - eye[1], tg[0] - eye[0]);
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const e0 = rt.eye.at(0);
    const e1 = rt.eye.at(1);
    const b0 = bearing(s.t, e0);
    const b1 = bearing(s.t + s.d, e1);
    const b = bearing(t, pos);
    if (b0 === null || b1 === null || b === null) return target;
    const off0 = wrap(yawOf(e0, rt.at.at(0)) - b0);
    const off1 = wrap(yawOf(e1, rt.at.at(1)) - b1);
    // the offset moves with the car's own progress across the view (its bearing), not with the clock: the pan is then
    // monotonic whenever the car's bearing is (yaw rate = (1 + Δoff/Δb) × bearing rate), with no swing toward a car
    // that is still far off; a car that does not cross the view falls back to the shot's ease
    const db = wrap(b1 - b0);
    const k = Math.abs(db) > 1e-3 ? Math.min(1, Math.max(0, wrap(b - b0) / db)) : e;
    const yaw = b + off0 + wrap(off1 - off0) * k;
    const h = Math.hypot(target[0] - pos[0], target[1] - pos[1]);
    return [pos[0] + Math.cos(yaw) * h, pos[1] + Math.sin(yaw) * h, target[2]];
  }

  vehicleAt(t: number): VehiclePose | null {
    if (this.veh.length === 0) return null;
    let rt = this.veh[0];
    for (const v of this.veh) if (t >= v.v.t) rt = v;
    const v = rt.v;
    const u = ease(v.ease, v.d > 0 ? (t - v.t) / v.d : 1, 'linear');
    const pos = rt.path.at(u);
    const heading = typeof v.heading === 'number' ? v.heading : headingOf(rt.path.tangent(u));
    return { pos, heading };
  }

  private moveAt(rt: MoveRt, t: number): { pos: P3; heading: number } {
    const m = rt.m;
    const u = m.d > 0 ? (t - m.t) / m.d : 1;
    const e = ease(m.ease, u, 'linear');
    const pos = rt.path.at(e);
    let heading: number;
    if (m.heading === undefined || m.heading === 'path') heading = rt.path.points.length > 1 ? headingOf(rt.path.tangent(e)) : 0;
    else if (typeof m.heading === 'number') heading = m.heading;
    else heading = lerpAngle(m.heading[0], m.heading[1], e);
    if (rt.from !== null && m.turnIn) {
      const w = Math.min(1, Math.max(0, (t - m.t) / m.turnIn));
      if (w < 1) heading = lerpAngle(rt.from, heading, w * w * (3 - 2 * w));
    }
    return { pos, heading };
  }

  private finishMovesUpTo(t: number, _skipping: boolean): void {
    // moves whose end ≤ t, in end-time order
    const due = this.moves.filter((m) => !m.finished && m.m.t + m.m.d <= t).sort((a, b) => a.m.t + a.m.d - (b.m.t + b.m.d));
    for (const m of due) {
      m.finished = true;
      const p = this.moveAt(m, m.m.t + m.m.d);
      this.sink.move?.(m.m.char, p.pos, p.heading);
    }
  }

  private evalContinuous(t: number): void {
    this.finishMovesUpTo(t, false);
    for (const m of this.moves) {
      if (m.finished || t < m.m.t) continue;
      const p = this.moveAt(m, t);
      this.sink.move?.(m.m.char, p.pos, p.heading);
    }
    const v = this.vehicleAt(t);
    const vk = v ? `${v.pos.map((x) => x.toFixed(4)).join(',')},${v.heading.toFixed(4)}` : 'null';
    if (vk !== this.lastVeh) {
      this.lastVeh = vk;
      this.sink.vehicle?.(v);
    }
    this.sink.camera(this.cameraAt(t, this.wallT));
    const fade = sampleKeys(this.timeline.fade, t, 0);
    const box = sampleKeys(this.timeline.letterbox, t, 0);
    if (fade !== this.lastFade || box !== this.lastBox) {
      this.lastFade = fade;
      this.lastBox = box;
      this.sink.overlay?.(fade, box);
    }
  }

  private finish(skipped: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.sink.end(skipped);
  }
}
