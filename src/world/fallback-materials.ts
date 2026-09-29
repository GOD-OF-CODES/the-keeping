// Fallback material binding: used only when src/materials/bind.ts fails (e.g. the GPU texture baker throws on a
// backend). Flat PBR from material-spec.json avgAlbedo / roughness / metalness, LightmapMaterial on lightmapped
// meshes, so the level still renders with correct baked light.

import * as THREE from 'three/webgpu';
import { float, vec3 } from 'three/tsl';
import { LightmapMaterial, type LightmapOptions } from '../render/lightmap-material.ts';
import { specById } from '../materials/spec-index.ts';

export function bindFallbackMaterials(root: any, lightmapFor: (mesh: any) => LightmapOptions | null): { materials: any[]; lightmapped: any[]; missing: string[] } {
  const shared = new Map<string, any>();
  const materials: any[] = [];
  const lightmapped: any[] = [];
  const missing = new Set<string>();
  root.traverse((mesh: any) => {
    if (!mesh.isMesh) return;
    const lm = lightmapFor(mesh);
    const swap = (mat: any) => {
      const id = mat?.userData?.material_id;
      if (typeof id !== 'string') return mat;
      const spec = specById(id);
      if (!spec) missing.add(id);
      const side = mat.side ?? THREE.FrontSide;
      const key = `${id}|${side}|${lm ? lm.base?.uuid : '-'}`;
      let m = shared.get(key);
      if (!m) {
        const params = { name: id, side };
        m = lm ? new LightmapMaterial(params, lm) : new THREE.MeshStandardNodeMaterial(params);
        const a = spec?.avgAlbedo ?? [0.3, 0.3, 0.3];
        m.colorNode = vec3(a[0], a[1], a[2]);
        m.roughnessNode = float(spec?.roughness ?? 0.8);
        m.metalnessNode = float(spec?.metalness ?? 0);
        m.userData.material_id = id;
        if (spec?.family === 'glass') {
          m.transparent = true;
          m.depthWrite = false;
          m.opacity = 0.2;
        }
        shared.set(key, m);
        materials.push(m);
        if (lm) lightmapped.push(m);
      }
      return m;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  return { materials, lightmapped, missing: [...missing] };
}
