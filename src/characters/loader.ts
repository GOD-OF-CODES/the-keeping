// Character asset loading (docs/CHARACTERS.md): <char>.glb (skinned meshes, one armature, all clips) + the tier's
// baked atlas textures. Material contract:
//   • albedo `<char>_albedo.webp`: RGB = albedo (sRGB), A = roughness (linear) — the GLB baseColorFactor is only a
//     fallback average, so the colour is set to white when the map binds;
//   • hair `ada_hair_albedo.webp`: A = alpha coverage (alpha-hash on Medium/Max, alpha-test on Low), roughness 0.25;
//   • normal `<char>_normal.png` (tangent space, OpenGL +Y, tangents exported);
//   • metalness from the spec id: chrome_pitted 1, rust 0.25 (the cleaver), everything else 0;
//   • `void` (Harlan's head under the sack) = unlit black.
// Textures are decoded with createImageBitmap(premultiplyAlpha 'none') so the roughness/alpha channel survives
// intact, and glTF UVs mean flipY = false.

import { ContactShadow, applySkinOrHair } from './skin.ts';
import { roomEnvironment } from '../render/reflections.ts';
import * as THREE from 'three/webgpu';
import { float, mx_noise_float, positionGeometry, texture, uniform, vec3 } from 'three/tsl';
import type { PresetConfig } from '../render/presets.ts';
import type { AssetManifest, PresetId } from '../shared/types.ts';
import { assetUrl, fetchBytes, fetchManifest, parseGlb } from '../world/assets.ts';

export type CharacterId = 'ada' | 'harlan' | 'arms';

export interface LoadedCharacter {
  id: CharacterId;
  /** The `<char>_rig` node (root of the armature + skinned meshes). */
  root: any;
  clips: Map<string, any>;
  bones: Map<string, any>;
  meshes: any[];
  materials: any[];
  /** 0..1 glow of the flashlight lens/bulb (arms_flashlight_lens `lens` + `emissive` material); the arms drive it. */
  lensGlow: any;
}

export interface CharacterLoadOptions {
  presetId: PresetId;
  preset: PresetConfig;
  /** Lights the character materials see (the level's probe-lit LightsNode). */
  lightsNode?: any;
  manifest?: AssetManifest;
}

const METALNESS: Record<string, number> = { chrome_pitted: 1, steel_flashlight: 1, steel_cleaver: 1, rust: 0.25 };

const texCache = new Map<string, Promise<any | null>>();

async function loadBitmapTexture(url: string, srgb: boolean, anisotropy: number): Promise<any | null> {
  try {
    const bytes = await fetchBytes(url);
    const type = url.endsWith('.webp') ? 'image/webp' : 'image/png';
    const bmp = await createImageBitmap(new Blob([bytes], { type }), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const t = new THREE.Texture(bmp);
    t.flipY = false;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
    return t;
  } catch (e) {
    console.warn(`[characters] texture ${url} failed:`, e);
    return null;
  }
}

function texUrl(m: AssetManifest | undefined, tier: PresetId, base: string, ext: string): string {
  const hit = m?.files.find((f) => f.path.endsWith(`/${base}.${ext}`));
  return assetUrl(hit ? hit.path : `assets/${tier}/${base}.${ext}`);
}

function tex(m: AssetManifest | undefined, o: CharacterLoadOptions, base: string, ext: string, srgb: boolean): Promise<any | null> {
  const url = texUrl(m, o.presetId, base, ext);
  let p = texCache.get(url);
  if (!p) {
    p = loadBitmapTexture(url, srgb, o.preset.textures.anisotropy);
    texCache.set(url, p);
  }
  return p;
}

export async function loadCharacter(id: CharacterId, o: CharacterLoadOptions): Promise<LoadedCharacter> {
  const manifest = o.manifest ?? (await fetchManifest(o.presetId).catch(() => undefined));
  const entry = manifest?.files.find((f) => f.id === id && f.kind === 'character');
  const bytes = await fetchBytes(assetUrl(entry ? entry.path : `assets/${o.presetId}/${id}.glb`));
  const gltf = await parseGlb(bytes, id);
  const root = gltf.scene.getObjectByName(`${id}_rig`) ?? gltf.scene;
  const clips = new Map<string, any>();
  for (const c of gltf.animations) clips.set(c.name, c);
  const bones = new Map<string, any>();
  const meshes: any[] = [];
  root.traverse((n: any) => {
    if (n.isBone) bones.set(n.name, n);
    if (n.isMesh) meshes.push(n);
  });

  const materials: any[] = [];
  const lensGlow = uniform(0);
  const low = o.preset.id === 'low';
  ContactShadow.enabled &&= !o.preset.post.gtao; // LIGHTING lane (item 17): Max has GTAO contact occlusion
  await Promise.all(
    meshes.map(async (mesh) => {
      const src = mesh.material;
      const ud = src.userData ?? {};
      mesh.frustumCulled = false; // skinned bounds don't follow the pose
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (ud.void) {
        const m = new THREE.MeshBasicNodeMaterial({ color: 0x000000 });
        m.name = src.name;
        mesh.material = m;
        materials.push(m);
        return;
      }
      const [albedo, normal] = await Promise.all([
        ud.albedo_tex ? tex(manifest, o, String(ud.albedo_tex), 'webp', true) : Promise.resolve(null),
        ud.normal_tex ? tex(manifest, o, String(ud.normal_tex), 'png', false) : Promise.resolve(null),
      ]);
      const m = new THREE.MeshStandardNodeMaterial();
      m.name = src.name;
      m.side = src.side;
      m.userData = { ...ud };
      const alphaIsCoverage = ud.albedo_alpha === 'alpha';
      if (albedo) {
        const t = texture(albedo);
        m.colorNode = t.rgb;
        if (alphaIsCoverage) {
          m.opacityNode = t.a;
          m.roughness = 0.25;
          if (low) m.alphaTest = 0.5;
          else m.alphaHash = true;
        } else {
          m.roughnessNode = t.a;
        }
      } else {
        m.color.copy(src.color);
        m.roughness = 0.7;
      }
      if (normal) {
        m.normalMap = normal;
        m.normalScale = new THREE.Vector2(1, 1);
      }
      m.metalness = METALNESS[String(ud.material_id)] ?? 0;
      if (String(ud.material_id) === 'steel_cleaver' && albedo && !alphaIsCoverage) {
        // R2-6: the blade is one flat quad with one baked roughness, so every light/probe it reflects spread over it
        // evenly — a flat blue-grey card. Used carbon steel isn't uniform: honing smears and wipe marks (cm scale),
        // oxide/patina blooms that darken the reflectance, and pitting that roughens it (mm scale). Object space, so
        // the pattern rides the blade.
        const t = texture(albedo);
        const pos = positionGeometry;
        const smear = mx_noise_float(pos.mul(vec3(18, 60, 18)));
        const bloom = mx_noise_float(pos.mul(9).add(3.7)).mul(0.5).add(0.5).smoothstep(0.45, 0.85);
        const pits = mx_noise_float(pos.mul(260)).max(0);
        m.roughnessNode = t.a.mul(smear.mul(0.3).add(1)).add(bloom.mul(0.2)).add(pits.mul(0.1)).clamp(0.18, 0.9);
        m.colorNode = t.rgb.mul(float(1).sub(bloom.mul(0.45))).mul(smear.mul(0.12).add(1));
        // the parlor's cube (B02 sharpening, C5) — reflections.ts. Not on Max: Harlan's fragments there already use all
        // 16 samplers an M1 allows per stage (more shadowed lights); the cube made it 17 (invalid pipeline).
        if (o.presetId !== 'max') m.setupEnvironment = roomEnvironment('G2');
      }
      if (ud.eye) {
        // wet cornea: a little clearcoat-like sheen via lower roughness
        m.roughnessNode = float(0.12);
      }
      if (ud.lens && ud.emissive) {
        // the bulb + reflector inside the bezel glow while the torch is on
        const ec = Array.isArray(ud.emissive_color) ? ud.emissive_color.map(Number) : [1, 0.86, 0.62];
        const k = Number(ud.emissive) > 0 ? Number(ud.emissive) : 4;
        m.emissiveNode = vec3(ec[0], ec[1], ec[2]).mul(lensGlow).mul(k);
      }
      // r3 AD review (R3-2): the old "cold emissive lift" (0.004, 0.005, 0.007) on the sss skin is gone. Skin does
      // not emit; at the C2 cut exposure (≈ 10) and the 3300 K indoor white balance (blue gain ≈ 2.5) it turned her
      // unlit face into a saturated blue patch. The probe grids + room env now give her the ambient she needs.
      if (o.lightsNode) m.lightsNode = o.lightsNode;
      // LIGHTING lane (item 17): wrap-diffuse skin with a wet clearcoat film, dual-lobe strand hair (./skin.ts)
      const fm = applySkinOrHair(m, ud, o.presetId);
      mesh.material = fm;
      materials.push(fm);
      src.dispose?.();
    }),
  );
  return { id, root, clips, bones, meshes, materials, lensGlow };
}

/** Local quaternion snapshot of a bone list (the stop-motion sampler restores these before secondary motion). */
export class PoseCache {
  readonly bones: any[];
  private readonly q: any[];
  constructor(bones: any[]) {
    this.bones = bones;
    this.q = bones.map(() => new THREE.Quaternion());
  }
  capture(): void {
    for (let i = 0; i < this.bones.length; i++) this.q[i].copy(this.bones[i].quaternion);
  }
  restore(): void {
    for (let i = 0; i < this.bones.length; i++) this.bones[i].quaternion.copy(this.q[i]);
  }
}
