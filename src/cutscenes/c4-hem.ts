// C4 'The Hem' (B09, ~20 s, M2, INTERACTIVE HIDE) — DESIGN B09. Not a Director cutscene: the AI brain runs the dress
// visit (ScriptedMode 'dress': approach → hem → to_wardrobe → look_windup → look_sight → leave) and voices
// 'c4:hand_on_hem' itself. The player is hidden in her wardrobe (H_ADA_WARDROBE) with normal hide controls.
//
// This module adds the cinematic layer ON TOP, phase by phase, as short overlay timelines (no camera shots, never
// blocking the story): depth of field through the slats, heartbeat, the breath prompt when her head lifts toward you,
// "the boards at your back give a little" (the wardrobe's back unlocks when the story sets dress_visit_done).
//
// Wiring: `const hem = new HemOverlay(cutscenes)`, then every frame after director.update():
//   hem.update(director output (AdaOutput) , hides.active?.id ?? null)
// It never emits voices the brain already emits and never touches Ada.
//
// 'C4' (the full ~20 s linear version, with Ada staged by move tracks) exists for the preview harness only.

import { NODE, PROP, WARDROBE_EYE, focusAt } from './stage.ts';
import type { CutscenePlayer } from './host.ts';
import type { Cue, Timeline, TimelineFactory } from './types.ts';

/** Brain dress-visit phases (src/ai/ada-brain.ts tickDress). */
export type DressPhase = 'approach' | 'hem' | 'to_wardrobe' | 'look_windup' | 'look_sight' | 'leave';
export const DRESS_PHASES: readonly DressPhase[] = ['approach', 'hem', 'to_wardrobe', 'look_windup', 'look_sight', 'leave'];

export const BREATH_PROMPT = 'Hold your breath (Space)';
const DRESS_POINT: [number, number, number] = [PROP.P_DRESS[0], PROP.P_DRESS[1], PROP.P_DRESS[2] + 1.0];
const SLATS_FACE: [number, number, number] = [NODE.U3_WARD_HC[0], NODE.U3_WARD_HC[1], NODE.U3_WARD_HC[2] + 1.45];

/** Segments hold their DOF/heartbeat until the next phase replaces them (or HemOverlay.stop()). */
const SEGMENT_HOLD = 60;

/** One overlay timeline per phase group. Ids: C4_approach, C4_hem, C4_look, C4_leave. */
export function hemSegment(phase: DressPhase): Timeline {
  const base = { lock: 'none' as const, skippable: false };
  switch (phase) {
    case 'approach':
      return {
        ...base,
        id: 'C4_approach',
        duration: SEGMENT_HOLD,
        cues: [
          { t: 0, type: 'heartbeat', bpm: 105 },
          { t: 0, type: 'dof', dof: focusAt(WARDROBE_EYE, DRESS_POINT, 1.6, 2) },
        ],
      };
    case 'hem':
    case 'to_wardrobe':
      return {
        ...base,
        id: 'C4_hem',
        duration: SEGMENT_HOLD,
        cues: [
          { t: 0, type: 'heartbeat', bpm: phase === 'hem' ? 92 : 118 },
          { t: 0, type: 'dof', dof: phase === 'hem' ? focusAt(WARDROBE_EYE, DRESS_POINT, 1.0, 2.5) : { focusDistance: 1.6, focalLength: 1.4, bokehScale: 2 } },
        ],
      };
    case 'look_windup':
    case 'look_sight':
      return {
        ...base,
        id: 'C4_look',
        duration: SEGMENT_HOLD,
        cues: [
          { t: 0, type: 'heartbeat', bpm: 140 },
          { t: 0, type: 'dof', dof: focusAt(WARDROBE_EYE, SLATS_FACE, 0.5, 3) },
          { t: 0, type: 'gate', id: 'c4_breath', prompt: BREATH_PROMPT, timeout: 5.5 },
          // "the boards at your back give a little"
          { t: 0.2, type: 'sfx', id: 'armoire_slats', gain: 0.3, rate: 0.7 },
          { t: 0.2, type: 'fx', id: 'wardrobe_back_give', params: { amount: 0.02 } },
        ],
      };
    case 'leave':
    default:
      return {
        ...base,
        id: 'C4_leave',
        duration: 2.5,
        cues: [
          { t: 0, type: 'heartbeat', bpm: 84 },
          { t: 0, type: 'dof', dof: { focusDistance: 2.5, focalLength: 2.5, bokehScale: 1.5 } },
          { t: 2.5, type: 'heartbeat', bpm: 0 },
          { t: 2.5, type: 'dof', dof: null },
        ],
      };
  }
}

const SEGMENT_OF: Record<DressPhase, string> = {
  approach: 'C4_approach',
  hem: 'C4_hem',
  to_wardrobe: 'C4_hem',
  look_windup: 'C4_look',
  look_sight: 'C4_look',
  leave: 'C4_leave',
};

/** Minimal slice of src/ai/types.ts AdaOutput this overlay reads. */
export interface DressView {
  state: string;
  phase: string;
  room: string;
  anim?: string;
}

/**
 * Drives the C4 overlay from the brain's dress-visit phases. Active only while the player hides in Ada's wardrobe
 * and a dress phase is running in U3 (the B05 hide demo shares phase names but not the room/hide).
 */
export class HemOverlay {
  private readonly player: CutscenePlayer;
  private readonly hideId: string;
  private segment: string | null = null;
  private lastPhase: string | null = null;

  constructor(player: CutscenePlayer, hideId = 'H_ADA_WARDROBE') {
    this.player = player;
    this.hideId = hideId;
  }

  get current(): string | null {
    return this.segment;
  }

  update(out: DressView | null, hiddenIn: string | null): void {
    const inVisit =
      !!out && hiddenIn === this.hideId && (out.state === 'SCRIPTED' || out.state === 'LOOK') && (out.room === 'U3' || out.room === 'U1') && (DRESS_PHASES as readonly string[]).includes(out.phase);
    if (!inVisit) {
      if (this.segment) this.stop();
      this.lastPhase = null;
      return;
    }
    if (out!.phase === this.lastPhase) return;
    this.lastPhase = out!.phase;
    const seg = SEGMENT_OF[out!.phase as DressPhase];
    // a Director cutscene (death / C5 …) always wins; overlays never interrupt one
    if (this.player.active && this.player.active !== this.segment) return;
    if (seg === this.segment && seg !== 'C4_hem') return;
    this.segment = seg;
    this.player.play(seg, undefined, { timeline: hemSegment(out!.phase as DressPhase) });
  }

  /** The player held their breath through the look (hide system → resolves the prompt early). */
  breathHeld(): void {
    if (this.segment === 'C4_look') this.player.resolveGate('c4_breath');
  }

  stop(): void {
    if (this.segment && this.player.active === this.segment) this.player.cancel();
    this.segment = null;
  }
}

/** Preview-only linear version (~20 s) with Ada staged by move tracks, timed like the brain's visit. */
export const c4Hem: TimelineFactory = () => {
  const door: [number, number, number] = [4.3, 8.2, 4.1];
  const cues: Cue[] = [
    { t: 0, type: 'lock', mode: 'look' },
    { t: 0, type: 'place', char: 'ada', pos: door, heading: 0 },
    { t: 0, type: 'visible', char: 'ada', visible: true },
    { t: 0, type: 'clip', char: 'ada', clip: 'ada_patrol', loop: true },
    ...hemSegment('approach').cues,
    { t: 4, type: 'clip', char: 'ada', clip: 'ada_dress', fallback: ['ada_listen'] },
    { t: 4, type: 'voice', trigger: 'c4:hand_on_hem' },
    { t: 4, type: 'heartbeat', bpm: 92 },
    { t: 4, type: 'dof', dof: focusAt(WARDROBE_EYE, DRESS_POINT, 1.0, 2.5) },
    { t: 7.5, type: 'clip', char: 'ada', clip: 'ada_patrol', loop: true },
    { t: 10.5, type: 'clip', char: 'ada', clip: 'ada_hide_check', fallback: ['ada_look'] },
    ...hemSegment('look_windup').cues.filter((c) => c.type !== 'gate').map((c) => ({ ...c, t: c.t + 10.5 })),
    { t: 10.5, type: 'mark', name: 'prompt:' + BREATH_PROMPT },
    { t: 11.5, type: 'sfx', id: 'ada_bone_crack', pos: SLATS_FACE, room: 'U3' },
    { t: 11.7, type: 'voice', trigger: 'ai:hide_check_look' },
    { t: 14.7, type: 'voice', trigger: 'ai:look_not_him' },
    { t: 15.2, type: 'clip', char: 'ada', clip: 'ada_patrol', loop: true },
    ...hemSegment('leave').cues.map((c) => ({ ...c, t: c.t + 15.2 })),
    { t: 20, type: 'visible', char: 'ada', visible: false },
    { t: 20, type: 'release', char: 'ada' },
  ];
  return {
    id: 'C4',
    duration: 20,
    lock: 'look',
    shots: [{ t: 0, d: 20, path: [WARDROBE_EYE], target: [[7.5, 7.3, 5.0], [6.4, 7.7, 5.1], [5, 7.95, 5.4], [4.6, 8.2, 5.2]], fov: 55, ease: 'linear', handheld: 0.4 }],
    moves: [
      { char: 'ada', t: 0, d: 4, path: [door, [6.2, 7.6, 4.1], NODE.U3_DRESS], ease: 'linear', heading: 'path' },
      { char: 'ada', t: 7.5, d: 3, path: [NODE.U3_DRESS, [6.2, 7.8, 4.1], NODE.U3_WARD_HC], ease: 'linear', heading: 'path' },
      { char: 'ada', t: 10.5, d: 4.7, path: [NODE.U3_WARD_HC], heading: Math.PI / 2 },
      { char: 'ada', t: 15.2, d: 4.8, path: [NODE.U3_WARD_HC, door, [3.4, 8.2, 4.1]], ease: 'linear', heading: 'path' },
    ],
    cues,
  };
};
