// Generator contract shared by the baker (baker.ts) and the per-family generators (library/*.ts).
// A generator is a JS function that builds TSL nodes for ONE texel of a tiling material in tile space.
// Pure types + tiny helpers: no three.js import (tests import this module under node).

import type { MaterialSpec } from '../shared/material-types.ts';
import { cellsPerTile, srgbToLinear3 } from './noise-cpu.ts';

export type N = any; // TSL node
export type RGB = [number, number, number];

export interface GenCtx {
  /** Tile-space coordinate [0,1)² (one texture repeat = spec.tileMetres). */
  uv: N;
  spec: MaterialSpec;
  /** Metres per baked repeat (spec.tileMetres × super-tile factor, see library superTileFor). */
  tile: number;
  /** Bake size (texels per side) — lets generators skip detail finer than a texel. */
  size: number;
  seed: number;
  /** Integer feature count per tile for a feature of `sizeM` metres (tile-safe frequency). */
  cells(sizeM: number): number;
  num(name: string, def: number): number;
  flag(name: string, def: boolean): boolean;
  str(name: string, def: string): string;
  /** Linear colour param; names ending in _srgb are decoded from sRGB. */
  col(name: string, def: RGB): RGB;
}

export interface GenResult {
  /** Linear albedo (vec3). */
  albedo: N;
  roughness: N;
  /** 0..1 height; heightDepthM metres between 0 and 1. */
  height: N;
  heightDepthM: number;
  /** Micro/baked ambient occlusion 0..1 (default 1). */
  ao?: N;
  /** Metal families: metalness mask 0..1 (× spec.metalness); glass: opacity/grime 0..1. */
  extra?: N;
  /** 0..1 standing-water mask: flattens normals, darkens, near-mirror roughness. */
  puddle?: N;
  /** Crevice darkening from the height field (0 = off, 1 = strong). Default 0.5. */
  cavity?: number;
  /** Multiplier on the derived normal slope (default 1). */
  normalStrength?: number;
}

export type Generator = (c: GenCtx) => GenResult;

export function makeCtx(spec: MaterialSpec, uv: N, size: number, tileM = spec.tileMetres): GenCtx {
  const p = spec.params as Record<string, unknown>;
  const tile = tileM;
  return {
    uv,
    spec,
    tile,
    size,
    seed: typeof p.seed === 'number' ? p.seed : 1,
    cells: (s: number) => cellsPerTile(tile, s),
    num: (n, d) => (typeof p[n] === 'number' ? (p[n] as number) : d),
    flag: (n, d) => (typeof p[n] === 'boolean' ? (p[n] as boolean) : d),
    str: (n, d) => (typeof p[n] === 'string' ? (p[n] as string) : d),
    col: (n, d) => {
      const v = p[n] ?? p[`${n}_srgb`];
      if (!Array.isArray(v) || v.length < 3) return d;
      const c = v as number[];
      return (p[n] === undefined ? srgbToLinear3(c) : [c[0], c[1], c[2]]) as RGB;
    },
  };
}

/** Which B.a channel content the bind step should expect for a spec. */
export function extraKind(spec: MaterialSpec): 'metal' | 'opacity' | 'height' {
  if (spec.family === 'glass') return 'opacity';
  if (spec.metalness > 0) return 'metal';
  return 'height';
}
