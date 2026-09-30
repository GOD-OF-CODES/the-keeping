// The sting's sack (C7, DESIGN B13): "a round, heavy feed sack tied at the neck" — Harlan's head in his own feed-sack
// mask, carried by the knot. Built here from scratch: a lathe profile (heavy round bottom, pinched neck, twine
// wrap, frayed ruff above the knot) with seeded lumps, two ragged eyeholes on one side, a dark wet bottom and a
// procedural weave (TSL) on the spec's burlap albedo. Origin = the knot (so it hangs from a hand); eyeholes face +Z.

import * as THREE from 'three/webgpu';
import { Fn, float, fract, mix, sin, uv, vec3, color as tslColor, attribute } from 'three/tsl';

/** docs/MATERIALS burlap_sack avgAlbedo (linear). */
const BURLAP: [number, number, number] = [0.33, 0.25, 0.15];

export function makeFeedSack(lightsNode: any | null): any {
  const group = new THREE.Group();
  group.name = 'sting_sack';

  // ---- body: lathe around Y, hanging DOWN from the knot at y = 0
  const prof: any[] = [];
  const N = 22;
  for (let i = 0; i <= N; i++) {
    const u = i / N; // 0 bottom … 1 neck
    const y = -0.36 + u * 0.3;
    // round, heavy bottom → pinched neck
    const r = u < 0.78 ? 0.155 * Math.sin(Math.min(1, (u + 0.04) / 0.8) * Math.PI * 0.62 + 0.28) + 0.02 * Math.sin(u * 9) : 0.03 + (1 - (u - 0.78) / 0.22) * 0.07;
    prof.push(new THREE.Vector2(Math.max(0.004, r), y));
  }
  const body = new THREE.LatheGeometry(prof, 40);
  // seeded lumps (a head inside a sack) + the colour attribute (wet, dark bottom)
  const pos = body.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const lump = 1 + 0.06 * Math.sin(a * 3 + v.y * 11) + 0.04 * Math.sin(a * 5 - v.y * 23 + 1.3);
    const flat = v.z < -0.05 ? 0.93 : 1; // it rests on the back
    v.x *= lump;
    v.z *= lump * flat;
    pos.setXYZ(i, v.x, v.y, v.z);
    const wet = THREE.MathUtils.smoothstep(-v.y, 0.2, 0.34); // bottom soaked dark
    const k = 1 - wet * 0.62;
    col[i * 3] = k;
    col[i * 3 + 1] = k * (1 - wet * 0.25);
    col[i * 3 + 2] = k * (1 - wet * 0.35);
  }
  body.setAttribute('color', new THREE.BufferAttribute(col, 3));
  body.computeVertexNormals();

  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
  // plain weave: two crossing thread sines on the lathe UVs (u around, v along) + slub noise
  mat.colorNode = Fn(() => {
    const t = uv();
    const wu = sin(t.x.mul(40 * 6.2831)).mul(0.5).add(0.5);
    const wv = sin(t.y.mul(18 * 6.2831)).mul(0.5).add(0.5);
    const weave = mix(float(0.78), float(1.06), wu.mul(wv).add(wu.max(wv).mul(0.4)).min(1));
    const slub = fract(sin(t.x.mul(311.7).add(t.y.mul(74.3)).floor().mul(12.9898)).mul(43758.5)).mul(0.14).add(0.93);
    return tslColor(new THREE.Color(...BURLAP)).mul(weave).mul(slub).mul(attribute('color', 'vec3'));
  })();
  if (lightsNode) mat.lightsNode = lightsNode;
  const bodyMesh = new THREE.Mesh(body, mat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  // ---- twine wrap at the neck
  const twineMat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0.36, 0.3, 0.2), roughness: 0.9 });
  if (lightsNode) twineMat.lightsNode = lightsNode;
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.052 - i * 0.004, 0.0045, 6, 24), twineMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.045 + i * 0.009;
    group.add(ring);
  }
  // ---- frayed ruff above the knot (a flared, ragged cone)
  const ruffProf = [new THREE.Vector2(0.03, -0.035), new THREE.Vector2(0.045, -0.01), new THREE.Vector2(0.06, 0.02), new THREE.Vector2(0.07, 0.04)];
  const ruff = new THREE.LatheGeometry(ruffProf, 18);
  const rp = ruff.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    v.fromBufferAttribute(rp, i);
    if (v.y > 0.03) v.y += 0.012 * Math.sin(i * 2.7) - 0.006;
    rp.setXYZ(i, v.x, v.y, v.z);
  }
  ruff.computeVertexNormals();
  const ruffMat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(...BURLAP).multiplyScalar(0.9), roughness: 0.97, side: THREE.DoubleSide });
  if (lightsNode) ruffMat.lightsNode = lightsNode;
  group.add(new THREE.Mesh(ruff, ruffMat));

  // ---- two ragged eyeholes (black, slightly inset), facing +Z
  const holeMat = new THREE.MeshBasicNodeMaterial({ colorNode: vec3(0.004, 0.003, 0.003) });
  for (const sx of [-1, 1]) {
    const shape = new THREE.Shape();
    const n = 11;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 1 + 0.22 * Math.sin(a * 3 + sx) + 0.12 * Math.sin(a * 7);
      const x = Math.cos(a) * 0.022 * r;
      const y = Math.sin(a) * 0.016 * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    const hole = new THREE.Mesh(new THREE.ShapeGeometry(shape), holeMat);
    const ang = sx * 0.33;
    const y = -0.2;
    const rr = 0.163;
    hole.position.set(Math.sin(ang) * rr, y, Math.cos(ang) * rr);
    hole.rotation.y = ang;
    group.add(hole);
  }
  group.traverse((n: any) => {
    if (n.isMesh) n.frustumCulled = false;
  });
  return group;
}
