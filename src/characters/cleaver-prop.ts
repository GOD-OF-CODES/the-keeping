// A hog cleaver for Ada's hand in C5's shadow-play (Harlan's own is skinned to his `cleaver` bone and can't move
// hands): a wide, thin blade with a hole and a riveted wooden handle, from scratch. Origin = the grip centre; the
// blade extends along +Y (knuckles), edge toward −Z.

import * as THREE from 'three/webgpu';

export function makeCleaver(lightsNode: any | null): any {
  const g = new THREE.Group();
  g.name = 'cleaver';
  const steel = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0.42, 0.4, 0.38), roughness: 0.42, metalness: 1 });
  const wood = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0.12, 0.07, 0.04), roughness: 0.75, metalness: 0 });
  if (lightsNode) {
    steel.lightsNode = lightsNode;
    wood.lightsNode = lightsNode;
  }
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.2, 0.0);
  shape.lineTo(0.215, -0.1);
  shape.lineTo(0.0, -0.105);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0.17, -0.025, 0.011, 0, Math.PI * 2, false);
  shape.holes.push(hole);
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: false }), steel);
  blade.rotation.set(0, Math.PI / 2, Math.PI / 2);
  blade.position.set(0.002, 0.06, 0.03);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.12, 10), wood);
  handle.position.set(0, 0, 0);
  g.add(blade, handle);
  g.traverse((n: any) => {
    if (n.isMesh) {
      n.castShadow = true;
      n.frustumCulled = false;
    }
  });
  return g;
}
