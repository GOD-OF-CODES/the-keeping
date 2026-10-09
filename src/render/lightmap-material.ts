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
import { luminance, normalView, smoothstep, texture, uniform, uv, vec2, vec3 } from 'three/tsl';
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

/**
 * LIGHTING lane (REALISM-BACKLOG item 5) — candle specular at full physical strength.
 *
 * The bake holds every candle's DIFFUSE light (Cycles diffuse bake, no specular), so the candle's runtime PointLight
 * has two jobs on a lightmapped surface: (a) the flicker swing of the diffuse (the mean is baked), and (b) ALL of the
 * specular (varnish, brass, glass, wet paint — nothing in the bake). Before, one light did both at
 * FLICKER_SHARE 0.22 × (0.35 + 0.65k) ≈ 8 % of the candle's candela, so highlights were ~8 % of physical.
 * Now the light runs at the full base × (1 + 0.3k) cd (0.8–0.95 cd for a 1800 K taper) and this model splits it:
 *   directDiffuse  × light.userData.lmDiffuseShare (a per-light uniform = old diffuse / new intensity, so the diffuse
 *                    flicker on the walls is EXACTLY what it was);
 *   directSpecular × uCandleSpec (1 = physical) × shadow proxy.
 * Shadow proxy: the flicker lights are unshadowed (one 512² map for the whole house would cost too much), so a
 * highlight would leak through walls. The lightmap knows where the candle reaches: on a surface the candle lights,
 * the baked irradiance ≥ this candle's own unoccluded irradiance (I·cosθ/d²) — the bake adds bounce and the other
 * lights on top. Behind a wall or a cabinet only bounce reaches the bake (≲ 30 % of the direct term), so
 * proxy = smoothstep(0.3, 0.85, E_lightmap / E_expected) shuts the specular there.
 * Lights without the tag (flashlight, lightning, cutscene lamps) go through the stock PhysicalLightingModel path.
 */
export const uCandleSpec = uniform(1);
/** Shadow-proxy ramp (ratio of baked irradiance to the candle's own unoccluded irradiance): [lo, hi]. */
export const uSpecProxyLo = uniform(0.3);
export const uSpecProxyHi = uniform(0.85);

/**
 * LIGHTING lane (REALISM-BACKLOG item 19) — civil-twilight sky fill on the EXTERIOR / CAR lightmaps (C6, B12).
 * The bake holds a 0.027-lux night sky; at sun −4° the sky gives ≈ 3 lux. Scaling the lightmap would also scale the
 * baked lantern ×100, so the bake is used as a sky-visibility estimate instead: E += fill · saturate(E_lm / E_open)
 * (open ground = 1, under the porch roof ≈ its baked fraction, lantern pools saturate at 1 — never multiplied).
 * uSkyFill = twilight colour × twilightE × tint (0 at night: no cost beyond one multiply-add).
 */
export const uSkyFill = uniform(new THREE.Color(0, 0, 0));
export const uOpenSkyE = uniform(0.027);
const SKY_FILL_ATLAS = /^lm_(exterior|car)/i;
/**
 * AD review — scale of the PARLOR bake (LM_PARLOR only; 1 = as baked). The C5 shadow-play sets it to LOOK.c5Bake
 * while the guttered candles are out (src/world/cutscene-fx.ts silhouetteOn/Off). Flash light (lmFlash) is unscaled.
 */
export const uParlorBake = uniform(1);
const PARLOR_ATLAS = /^lm_parlor/i;

export class LightmapLightingModel extends THREE.PhysicalLightingModel {
  direct(input: any, builder: any): void {
    const light = input.lightNode?.light;
    const share = light?.userData?.lmDiffuseShare; // uniform node (candle flicker lights only)
    if (!share) {
      super.direct(input, builder);
      return;
    }
    const tmp = { directDiffuse: vec3(0).toVar(), directSpecular: vec3(0).toVar() };
    super.direct({ ...input, reflectedLight: tmp }, builder);
    const rl = input.reflectedLight;
    rl.directDiffuse.addAssign(tmp.directDiffuse.mul(share));
    let spec: any = tmp.directSpecular.mul(uCandleSpec);
    const lmE = builder.material?.lmIrradianceNode?.();
    if (lmE) {
      const dotNL = normalView.dot(input.lightDirection).clamp();
      const expected = luminance(input.lightColor).mul(dotNL).max(1e-6);
      spec = spec.mul(smoothstep(uSpecProxyLo, uSpecProxyHi, luminance(lmE).div(expected)));
    }
    rl.directSpecular.addAssign(spec);
  }
}

export class LightmapMaterial extends THREE.MeshStandardNodeMaterial {
  lmBase: any;
  lmFlash: any;
  lmFlipV: boolean;
  lmMultiplier: number;
  /**
   * Optional reflection lighting node factory (render/reflections.ts, item 6): returns a LightingNode that adds
   * box-projected cubemap radiance to context.radiance only (never iblIrradiance — the lightmap IS the diffuse).
   */
  lmReflection: (() => any) | null = null;
  readonly isLightmapMaterial = true;
  private _lmE: any = null;
  private _lmEKey: any = null;

  /**
   * Clone-safe: Material.clone() is `new this.constructor().copy(this)` — no arguments (cutscene-fx setTrim('maroon')
   * at the first frame of C7 crashed on `lm.base` of undefined). Defaults here, real values via copy().
   */
  constructor(params: Record<string, unknown> = {}, lm: LightmapOptions | null = null) {
    super(params);
    this.lmBase = lm?.base ?? null;
    this.lmFlash = lm?.flash ?? null;
    this.lmFlipV = lm?.flipV ?? LIGHTMAP_FLIP_V;
    this.lmMultiplier = lm?.multiplier ?? LIGHTMAP_MULTIPLIER;
    this.userData.lightmapped = true;
  }

  /** The decoded lightmap irradiance (+ flash), one node per lightmap (shared by setupLightMap and the specular proxy). */
  lmIrradianceNode(): any {
    if (!this.lmBase) return null;
    const key = this.lmBase;
    if (this._lmE && this._lmEKey === key) return this._lmE;
    const u = uv(1);
    const lmUV = this.lmFlipV ? vec2(u.x, u.y.oneMinus()) : u;
    let e: any = texture(this.lmBase, lmUV).rgb.mul(this.lmMultiplier);
    if (PARLOR_ATLAS.test(String(this.lmBase.name ?? ''))) e = e.mul(uParlorBake); // AD review: C5 candles out
    if (this.lmFlash) e = e.add(texture(this.lmFlash, lmUV).rgb.mul(this.lmMultiplier).mul(uLightning));
    if (SKY_FILL_ATLAS.test(String(this.lmBase.name ?? ''))) e = e.add(uSkyFill.mul(luminance(e).div(uOpenSkyE).clamp(0, 1)));
    this._lmE = e;
    this._lmEKey = key;
    return e;
  }

  setupLightMap(/* builder */): any {
    const e = this.lmIrradianceNode();
    return e ? new THREE.IrradianceNode(e) : null;
  }

  /** Debug A/B (`?lmmodel=0`): the stock PhysicalLightingModel (candle specular at the diffuse share, pre item 5). */
  static stockModel = false;

  setupLightingModel(/* builder */): any {
    return LightmapMaterial.stockModel ? new THREE.PhysicalLightingModel() : new LightmapLightingModel();
  }

  setupEnvironment(builder: any): any {
    if (this.lmReflection) return this.lmReflection();
    return super.setupEnvironment(builder);
  }

  copy(source: any): this {
    // NodeMaterial.copy() would call .copy() on an existing lightmap texture in place: start clean.
    this.lmBase = null;
    this.lmFlash = null;
    super.copy(source);
    this.lmBase = source.lmBase ?? null;
    this.lmFlash = source.lmFlash ?? null;
    this.lmFlipV = source.lmFlipV ?? LIGHTMAP_FLIP_V;
    this.lmMultiplier = source.lmMultiplier ?? LIGHTMAP_MULTIPLIER;
    this.lmReflection = source.lmReflection ?? null;
    this._lmE = null;
    this._lmEKey = null;
    return this;
  }
}
