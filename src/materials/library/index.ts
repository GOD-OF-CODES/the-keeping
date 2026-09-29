// Generator registry: material family → generator (library/*.ts). Every family resolves (generic fallback), so a
// bake of the whole spec never dies on an unlisted family. tests/materials-library.test.ts checks coverage.

import type { MaterialFamily, MaterialSpec } from '../../shared/material-types.ts';
import type { Generator } from '../gen-types.ts';
import { genericGenerator } from './common.ts';
import { WOOD_GENERATORS } from './wood.ts';
import { WALL_BY_ID, WALL_GENERATORS } from './walls.ts';
import { GROUND_GENERATORS } from './ground.ts';
import { METAL_GENERATORS } from './metal.ts';
import { CLOTH_GENERATORS } from './cloth.ts';
import { MISC_GENERATORS } from './misc.ts';

const REGISTRY: Partial<Record<MaterialFamily, Generator>> = {
  ...WOOD_GENERATORS,
  ...WALL_GENERATORS,
  ...GROUND_GENERATORS,
  ...METAL_GENERATORS,
  ...CLOTH_GENERATORS,
  ...MISC_GENERATORS,
};

/** Material ids with a dedicated generator that differs from their family's (e.g. wall_tally). */
const BY_ID: Record<string, Generator> = { ...WALL_BY_ID };

export function registerFamily(f: MaterialFamily, g: Generator): void {
  REGISTRY[f] = g;
}
export function registerId(id: string, g: Generator): void {
  BY_ID[id] = g;
}

export function generatorFor(spec: MaterialSpec): Generator {
  return BY_ID[spec.id] ?? REGISTRY[spec.family] ?? genericGenerator;
}

export function hasDedicatedGenerator(spec: MaterialSpec): boolean {
  return !!(BY_ID[spec.id] ?? REGISTRY[spec.family]);
}

/**
 * Super-tile factor: bake N×N spec repeats into one texture so per-repeat variation (each wallpaper strip peels
 * differently) doesn't repeat every tileMetres. Texel density drops by N — only where the spec tile is small.
 */
export function superTileFor(spec: MaterialSpec): number {
  if (spec.family === 'wallpaper' && spec.id !== 'wall_tally') return 2;
  return 1;
}
