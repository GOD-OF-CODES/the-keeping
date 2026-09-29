// The object every runtime system receives. Created once in src/game/main.ts after the preset is chosen.

import type { EventBus } from '../core/events.ts';
import type { Settings, PresetId } from '../shared/types.ts';
import type { LevelLayout } from '../shared/layout-types.ts';

/** Frame timing, advanced by src/core/loop.ts. dt is clamped (≤ 0.1 s) and 0 while paused. */
export interface FrameTime {
  now: number; // seconds since start
  dt: number;
  frame: number;
}

export interface GameContext {
  settings: Settings;
  presetId: PresetId;
  /** Resolved preset values (see src/render/presets.ts, type PresetConfig). */
  preset: import('../render/presets.ts').PresetConfig;
  /** three.js objects (typed `any`: three ships no .d.ts and no @types package is allowed). */
  renderer: any;
  scene: any;
  camera: any;
  backend: 'webgpu' | 'webgl2';
  events: EventBus;
  time: FrameTime;
  layout: LevelLayout;
  debug: boolean;
  /** Registry for cross-system lookups (prefer events). */
  systems: Map<string, System>;
  /** Story flags (escape-state); persisted in checkpoints. */
  flags: Map<string, boolean>;
}

/**
 * A runtime system. Update order is registration order (see src/game/main.ts):
 * input → player → ai → characters → story → cutscenes → world → audio → render.
 */
export interface System {
  readonly id: string;
  init?(ctx: GameContext): Promise<void> | void;
  update?(dt: number, ctx: GameContext): void;
  dispose?(): void;
}
