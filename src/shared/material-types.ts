// Schema of src/shared/material-spec.json — shared by the runtime TSL texture generators (src/materials)
// and the Blender bake materials (blender/lib/materials.py). The Blender side only needs avgAlbedo,
// roughness and metalness (bounce colour for the lightmap bake); the runtime uses family + params.

export type MaterialFamily =
  | 'wood_floor' | 'wood_bare' | 'wood_painted' | 'clapboard' | 'porch_boards'
  | 'wallpaper' | 'plaster' | 'ceiling_plaster' | 'trim_paint'
  | 'rug' | 'fabric' | 'crepe' | 'burlap' | 'rubber' | 'leather' | 'flannel' | 'nightgown'
  | 'shingles' | 'brick' | 'stone' | 'gravel' | 'asphalt' | 'mud' | 'grass' | 'bark'
  | 'rust' | 'cast_iron' | 'enamel' | 'tile' | 'glass' | 'chrome' | 'car_paint' | 'car_interior'
  | 'wax' | 'paper' | 'skin' | 'hair' | 'metal_brass' | 'rope' | 'zinc';

export interface MaterialSpec {
  id: string; // e.g. 'floor_varnished', 'wallpaper_damask_green'
  family: MaterialFamily;
  /** Generator parameters (colours are linear-sRGB triplets 0..1 unless named *_srgb). */
  params: Record<string, number | string | boolean | number[]>;
  /** Linear average albedo — used by Cycles for bounce colour. Must match the generator's mean output ±10%. */
  avgAlbedo: [number, number, number];
  roughness: number;
  metalness: number;
  /** Metres per texture repeat (world-space tiling). */
  tileMetres: number;
  /** Hero surfaces get the preset's larger texture size. */
  hero: boolean;
  /** Surface wetness 0..1 (rain-soaked exterior, drips). */
  wetness: number;
  /** How the runtime realises it: GPU-generated tiling texture, a baked unique texture, or a flat PBR constant. */
  source: 'generated' | 'baked_unique' | 'constant';
  notes?: string;
}

export interface MaterialSpecFile {
  version: 1;
  materials: MaterialSpec[];
}
