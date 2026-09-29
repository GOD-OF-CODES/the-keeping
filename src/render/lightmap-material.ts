// Lightmapped surface material (docs/PLAN.md §2.5, research three-runtime Q3a/Q3b + critique).
//
// MeshStandardNodeMaterial subclass that overrides setupLightMap() (NodeMaterial calls it unconditionally from
// setupMaterialLightings) and returns
//     IrradianceNode( decode(base) · LIGHTMAP_MULTIPLIER + decode(flash) · LIGHTMAP_MULTIPLIER · uLightning )
// → builder.context.irradiance → indirect diffuse (three then multiplies by albedo/π).
//  - Textures sample uv1 (glTF TEXCOORD_1; texture.channel = 1), NoColorSpace (linear irradiance).
//  - Container: our KLM format (src/render/klm.ts; lead decision). Rows are bottom-up (Blender order), uploaded
//    as-is with flipY = false; with glTF (u, 1−v) UVs that is mirrored → sample at (uv1.x, 1 − uv1.y)
//    (LIGHTMAP_FLIP_V = true, proven by SMOKE S2 through GLTFLoader + EXRLoader/KLM).
//  - LIGHTMAP_MULTIPLIER = π (SMOKE S3 measured k = 3.1412–3.1418: Cycles no-COLOR diffuse bakes store E/π).
//  - material.userData.lightmapped = true → the Max GTAO getAO keeps only LIGHTMAP_AO_STRENGTH on these.
//  - Set material.lightsNode = lights([runtime lights]) (see probes.ts) so the LightProbeGrid — which captured these
//    very surfaces — does not add indirect light a second time.

import * as THREE from 'three/webgpu';
import { texture, uniform, uv, vec2 } from 'three/tsl';
import { decodeKlm, type KlmImage } from './klm.ts';

/** Lightmap texel → irradiance multiplier. Confirmed by docs/SMOKE.md S3 (k = π ± 0.013 %). */
export const LIGHTMAP_MULTIPLIER = Math.PI;
/** Flip v in the decode (bottom-up KLM/EXR rows vs glTF UVs). Confirmed by docs/SMOKE.md S2. */
export const LIGHTMAP_FLIP_V = true;

/** 0..1 lightning flash level, driven by the lightning system (scaled down by "Reduced flash"). */
export const uLightning = uniform(0);

export interface LightmapOptions {
  base: any; // THREE.Texture (linear irradiance, uv1)
  flash?: any | null; // additive lightning-only bake (Max)
  flipV?: boolean;
  multiplier?: number;
}

/** Applies the texture flags every lightmap needs (channel 1, linear, no mips across islands). */
export function prepareLightmapTexture(tex: any): any {
  tex.channel = 1;
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = false;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Wraps a decoded KLM image as a lightmap texture (HalfFloat RGBA, channel 1, NoColorSpace, flipY false). */
export function klmToTexture(img: KlmImage): any {
  const tex = new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.name = `klm-${img.width}x${img.height}`;
  return prepareLightmapTexture(tex);
}

/** Fetches + decodes a .klm lightmap into a ready-to-use texture. */
export async function loadKlmLightmap(url: string, signal?: AbortSignal): Promise<any> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`lightmap ${url}: HTTP ${res.status}`);
  const tex = klmToTexture(await decodeKlm(await res.arrayBuffer()));
  tex.name = url.split('/').pop() ?? tex.name;
  return tex;
}

export class LightmapMaterial extends THREE.MeshStandardNodeMaterial {
  lmBase: any;
  lmFlash: any;
  lmFlipV: boolean;
  lmMultiplier: number;
  readonly isLightmapMaterial = true;

  constructor(params: Record<string, unknown>, lm: LightmapOptions) {
    super(params);
    this.lmBase = lm.base;
    this.lmFlash = lm.flash ?? null;
    this.lmFlipV = lm.flipV ?? LIGHTMAP_FLIP_V;
    this.lmMultiplier = lm.multiplier ?? LIGHTMAP_MULTIPLIER;
    this.userData.lightmapped = true;
  }

  setupLightMap(/* builder */): any {
    const u = uv(1);
    const lmUV = this.lmFlipV ? vec2(u.x, u.y.oneMinus()) : u;
    let e: any = texture(this.lmBase, lmUV).rgb.mul(this.lmMultiplier);
    if (this.lmFlash) e = e.add(texture(this.lmFlash, lmUV).rgb.mul(this.lmMultiplier).mul(uLightning));
    return new THREE.IrradianceNode(e);
  }

  copy(source: any): this {
    super.copy(source);
    this.lmBase = source.lmBase;
    this.lmFlash = source.lmFlash;
    this.lmFlipV = source.lmFlipV;
    this.lmMultiplier = source.lmMultiplier;
    return this;
  }
}
