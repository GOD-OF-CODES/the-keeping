// Checkpoints (DESIGN "Fail states & checkpoints") and save snapshots.
//
// Death loses ONLY position: items, pried boards, opened doors, read documents and the can persist (the story state
// is never rolled back on death). A checkpoint is therefore (a) the respawn spawn point and (b) the section for
// death-count assists. `SaveGame` serialises everything (story + AI incl. grace + whatever the host adds: doors,
// inventory, player) for continue / reload.

import type { LevelLayout, SpawnPoint } from '../shared/layout-types.ts';
import type { AdaSnapshot } from '../ai/ada-brain.ts';
import { CHECKPOINTS, type CheckpointId, type EscapeState } from './escape-state.ts';

export const CHECKPOINT_INFO: Record<CheckpointId, string> = {
  CP1: 'at the gate after C1',
  CP2: 'the hall as she rises (C2 replays in 3 s)',
  CP3: 'after the first hide',
  CP4: 'taking the hammer or the ledger',
  CP5: 'after each pried board',
  CP6: 'taking the locket (the dress visit replays)',
  CP7: 'taking the can',
  CP8: 'the finale',
};

export function isCheckpointId(id: string): id is CheckpointId {
  return (CHECKPOINTS as readonly string[]).includes(id);
}

export function checkpointSpawn(layout: Pick<LevelLayout, 'spawns'>, id: CheckpointId): SpawnPoint {
  const s = layout.spawns.find((x) => x.id === id);
  if (!s) throw new Error(`layout has no spawn ${id}`);
  return s;
}

export const SAVE_VERSION = 1;

export interface SaveGame {
  version: number;
  story: EscapeState;
  ai: AdaSnapshot;
  /** Host-owned state (door leaves, inventory, journal, player transform …), opaque here. */
  host?: Record<string, unknown>;
}

export function serializeSave(s: SaveGame): string {
  return JSON.stringify(s);
}

export function parseSave(json: string): SaveGame | null {
  try {
    const s = JSON.parse(json) as SaveGame;
    if (!s || s.version !== SAVE_VERSION || !s.story || !s.ai || s.story.v !== 1 || s.ai.v !== 1) return null;
    return s;
  } catch {
    return null;
  }
}
