// PERF smoothness (#143, ROADMAP ruling (am) item 2): the camera poses of every cutscene shot, for the load warm-up.
// PURE (no three.js; types only from src/cutscenes). The real-time whole-route runs (docs/STATUS-smooth-perf.md) showed
// the late cutscenes' freezes start at shot changes: a view first drawn inside a cutscene builds its render objects in
// the cutscene chain's scene-pass contexts (DOF / motion blur) in that frame — C5 0.02: 743 ms of node builds then
// 2.8 s of GPU pipeline work; C4c 5.37 (the G3 hatch flash-frame) 1.3 s; C7 0.0 (the car set) 3.4 s on Max.
// src/game/main.ts ('cs-shots' warm step) puts the camera at each pose below, with the shot's chain and the cutscene's
// culling, behind the loading screen — so the first cutscene frame of every shot finds its pipelines built.

import type { CutsceneContext, P3, Timeline, TimelineFactory } from '../cutscenes/types.ts';

export interface ShotPose {
  id: string;
  /** cutscene clock (s) */
  t: number;
  pos: P3;
  target: P3;
  fov: number;
  /** a DOF cue is live at t */
  dof: boolean;
  /** the sequence has switched the motion-blur variant in by t (fx blurAmount) */
  blur: boolean;
}

interface CameraAt {
  cameraAt(t: number, wall?: number): { pos: P3; target: P3; fov: number } | null;
}
type SequencerCtor = new (tl: Timeline, sink: any) => CameraAt;

const NULL_SINK = { cue() {}, camera() {}, vehicle() {}, move() {}, overlay() {}, gate() {}, end() {} };

/**
 * Poses for each shot of each timeline: its first frame (+ 0.04 s) and, for long shots, the middle and 85 % (a moving
 * camera reveals more). `midAfter`: shots longer than this get the extra samples.
 */
export function cutsceneShotPoses(lib: Record<string, TimelineFactory>, Seq: SequencerCtor, ids: readonly string[], ctxFor: (id: string) => CutsceneContext, midAfter = 2.5): ShotPose[] {
  const out: ShotPose[] = [];
  for (const id of ids) {
    const f = lib[id];
    if (!f) continue;
    let tl: Timeline;
    try {
      tl = f(ctxFor(id));
    } catch {
      continue; // a factory that needs live state the load has not got: skipped, never fatal
    }
    const seq = new Seq(tl, NULL_SINK);
    const dofCues = tl.cues.filter((c) => c.type === 'dof').sort((a, b) => a.t - b.t) as Array<{ t: number; dof: unknown }>;
    const blurAt = Math.min(...tl.cues.filter((c) => c.type === 'fx' && (c as { id?: string }).id === 'blurAmount').map((c) => c.t), Infinity);
    const times = new Set<number>();
    for (const s of tl.shots ?? []) {
      const add = (t: number) => {
        if (t >= 0 && t < tl.duration) times.add(Math.round(t * 1000) / 1000);
      };
      add(s.t + 0.04);
      if (s.d > midAfter) add(s.t + s.d * 0.5);
      if (s.d > 2 * midAfter) add(s.t + s.d * 0.85);
    }
    for (const t of [...times].sort((a, b) => a - b)) {
      const p = seq.cameraAt(t, t);
      if (!p) continue;
      let dof = false;
      for (const c of dofCues) if (c.t <= t + 1e-6) dof = !!c.dof;
      out.push({ id, t, pos: p.pos, target: p.target, fov: p.fov, dof, blur: blurAt <= t + 1e-6 });
    }
  }
  return out;
}

/**
 * Props each timeline SHOWS with a `prop` cue (visible: true) — hidden at load, so the load warm-up never drew them
 * (real-time Max route: C7 0.0 built P_AIR_FRESHENER's dust_sheet + paper_aged programs and 2 new pipelines → a 1.9 s
 * GPU stall at C7 0.25). main.ts shows them for that cutscene's warm poses, then restores them.
 */
export function cutsceneShownProps(lib: Record<string, TimelineFactory>, ids: readonly string[], ctxFor: (id: string) => CutsceneContext): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const id of ids) {
    const f = lib[id];
    if (!f) continue;
    try {
      const tl = f(ctxFor(id));
      const shown = [...new Set(tl.cues.filter((c) => c.type === 'prop' && (c as { visible?: boolean }).visible === true).map((c) => (c as { id: string }).id))];
      if (shown.length) out.set(id, shown);
    } catch {
      /* a factory that needs live state: nothing to show */
    }
  }
  return out;
}
