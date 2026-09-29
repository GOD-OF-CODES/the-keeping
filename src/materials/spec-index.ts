// material-spec.json accessors (no three.js import: usable from tests and generators).
import type { MaterialSpec, MaterialSpecFile } from '../shared/material-types.ts';
import specFile from '../shared/material-spec.json' with { type: 'json' };

export const MATERIAL_SPECS: MaterialSpec[] = (specFile as unknown as MaterialSpecFile).materials;
const SPEC_BY_ID = new Map(MATERIAL_SPECS.map((m) => [m.id, m]));
/** Looks up a spec by material_id (a trailing `@2s` double-sided suffix is ignored). */
export const specById = (id: string): MaterialSpec | undefined => SPEC_BY_ID.get(id.replace(/@2s$/, ''));
