// Recipe registry: the single list the bank prerenderer, the audio lab and the tests iterate.

import { ADA_RECIPES } from './ada.ts';
import { WEATHER_RECIPES } from './weather.ts';
import { FOOTSTEP_RECIPES } from './footsteps.ts';
import { DOOR_RECIPES } from './doors.ts';
import { BELL_RECIPES } from './bells.ts';
import { HARLAN_RECIPES } from './harlan.ts';
import { CAR_RECIPES } from './car.ts';
import { ROAD_RECIPES } from './road.ts';
import { PROP_RECIPES } from './props.ts';
import { PLAYER_RECIPES } from './player.ts';
import { SCORE_RECIPES } from './score.ts';
import type { Recipe } from './types.ts';

export const RECIPES: readonly Recipe[] = [
  ...ADA_RECIPES,
  ...WEATHER_RECIPES,
  ...FOOTSTEP_RECIPES,
  ...DOOR_RECIPES,
  ...BELL_RECIPES,
  ...HARLAN_RECIPES,
  ...CAR_RECIPES,
  ...ROAD_RECIPES,
  ...PROP_RECIPES,
  ...PLAYER_RECIPES,
  ...SCORE_RECIPES,
];

const BY_ID = new Map(RECIPES.map((r) => [r.id, r]));

export function getRecipe(id: string): Recipe {
  const r = BY_ID.get(id);
  if (!r) throw new Error(`[audio] unknown recipe '${id}'`);
  return r;
}

export function hasRecipe(id: string): boolean {
  return BY_ID.has(id);
}

export { SURFACE_STEP } from './footsteps.ts';
export type { Recipe } from './types.ts';
