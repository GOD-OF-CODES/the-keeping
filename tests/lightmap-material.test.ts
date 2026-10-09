// LightmapMaterial must survive Material.clone() (`new this.constructor().copy(this)`, no constructor arguments):
// QA found C7's first frame crashing in cutscene-fx setTrim('maroon') → m.clone() → `lm.base` of undefined.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import * as THREE from 'three/webgpu';
import { LightmapMaterial, LightmapLightingModel, LIGHTMAP_FLIP_V, LIGHTMAP_MULTIPLIER } from '../src/render/lightmap-material.ts';

test('LightmapMaterial constructs without arguments (clone path)', () => {
  const m = new (LightmapMaterial as any)();
  assert.equal(m.lmBase, null);
  assert.equal(m.lmFlash, null);
  assert.equal(m.lmFlipV, LIGHTMAP_FLIP_V);
  assert.equal(m.lmMultiplier, LIGHTMAP_MULTIPLIER);
  assert.equal(m.isLightmapMaterial, true);
  assert.equal(m.setupLightMap(), null);
});

test('LightmapMaterial.clone() keeps the lightmap, its options, the LightsNode and the reflection hook', () => {
  const base = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  const flash = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  const m = new LightmapMaterial({ name: 'car_interior_tan' }, { base, flash, flipV: false, multiplier: 2 });
  m.userData.material_id = 'car_interior_tan';
  const lightsNode = { isLightsNode: true };
  (m as any).lightsNode = lightsNode;
  const refl = () => null;
  m.lmReflection = refl;
  const c: any = m.clone();
  assert.ok(c instanceof LightmapMaterial);
  assert.notEqual(c, m);
  assert.equal(c.lmBase, base);
  assert.equal(c.lmFlash, flash);
  assert.equal(c.lmFlipV, false);
  assert.equal(c.lmMultiplier, 2);
  assert.equal(c.lightsNode, lightsNode);
  assert.equal(c.lmReflection, refl);
  assert.equal(c.name, 'car_interior_tan');
  assert.equal(c.userData.lightmapped, true);
  assert.ok(c.setupLightMap() instanceof THREE.IrradianceNode);
  assert.ok(c.setupLightingModel() instanceof LightmapLightingModel);
  // the source's lightmap texture is untouched by the copy (NodeMaterial.copy would .copy() into an existing one)
  assert.equal(m.lmBase, base);
});
