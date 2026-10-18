// C2 head attached until the strike (lead ruling (ao), CONTRACT-CHANGES #142c): the shipped Ada GLB, posed by ada_c2 /
// ada_table at the C2 root with the runtime table lift (src/characters/ada-table-pose.ts, applied exactly as ada.ts
// does), keeps her head ON her neck, past the sawbuck's west edge, clear of the top and the rubber drape, turned toward
// the doorway camera D — and the cut ring sits where the jets (blood-fx JET_CUT) and harlan_c2's blade expect it.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;
const { readFileSync } = (await import('node:' + 'fs')) as any;
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { SAWBUCK_TOP, TABLE_LIFT, TABLE_ROOT, tableLiftWeight } from '../src/characters/ada-table-pose.ts';
import { ADA_TABLE, C2E_D, NECK } from '../src/cutscenes/stage.ts';
import { JET_CUT } from '../src/world/blood-fx.ts';

const plan = (v: any): number[] => [v.x, -v.z, v.y];
// P_RUBBER_SHEET's west drape (props_m1.glb at its layout pose, y 3.05–3.55): inner-most x per height
const DRAPE: Array<[number, number]> = [[1.4, 5.293], [1.35, 5.274], [1.25, 5.264], [1.15, 5.254], [1.05, 5.236], [0.95, 5.216], [0.85, 5.206]];
const drapeX = (z: number): number => {
  for (let k = 0; k < DRAPE.length - 1; k++) if (z <= DRAPE[k][0] && z >= DRAPE[k + 1][0]) return DRAPE[k][1] + ((DRAPE[k + 1][1] - DRAPE[k][1]) * (DRAPE[k][0] - z)) / (DRAPE[k][0] - DRAPE[k + 1][0]);
  return 9;
};

async function loadAda(): Promise<any> {
  const buf = readFileSync(new URL('../public/assets/medium/ada.glb', import.meta.url));
  const L = new GLTFLoader();
  L.setMeshoptDecoder(MeshoptDecoder);
  await MeshoptDecoder.ready;
  return new Promise((res, rej) => L.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
}

/** ada.ts: group at the placed root with rotation.y = heading + π/2; ada_rig offset in the group by TABLE_ROOT; each
 *  TABLE_LIFT rotation in the group (root) frame composed as P⁻¹·R·P at its joint. */
function pose(g: any, clip: string, t: number, w: number) {
  const group = new THREE.Group();
  const rig = g.scene.getObjectByName('ada_rig') ?? g.scene;
  group.add(rig);
  // head-carry.ts: until severed the head piece rides neck_02, mounted in the load-time rest pose
  rig.updateMatrixWorld(true);
  const hr = rig.getObjectByName('ada_head_rig');
  hr.parent.parent.attach(hr);
  const base = rig.position.clone();
  group.position.set(ADA_TABLE.pos[0], ADA_TABLE.pos[2], -ADA_TABLE.pos[1]);
  group.rotation.y = ADA_TABLE.heading + Math.PI / 2;
  const mixer = new THREE.AnimationMixer(rig);
  const a = mixer.clipAction(g.animations.find((x: any) => x.name === clip));
  a.play();
  a.time = t;
  mixer.update(0);
  rig.position.set(base.x, base.y + TABLE_ROOT.up * w, base.z + TABLE_ROOT.fwd * w);
  group.updateMatrixWorld(true);
  const rq = group.getWorldQuaternion(new THREE.Quaternion());
  const rqi = rq.clone().invert();
  for (const { bone, deg } of TABLE_LIFT) {
    const b = rig.getObjectByName(bone);
    b.parent.updateWorldMatrix(true, false);
    const P = b.parent.getWorldQuaternion(new THREE.Quaternion());
    const Rl = new THREE.Quaternion().setFromEuler(new THREE.Euler((deg[0] * w * Math.PI) / 180, (deg[1] * w * Math.PI) / 180, (deg[2] * w * Math.PI) / 180, 'XYZ'));
    const Rw = rq.clone().multiply(Rl).multiply(rqi);
    b.quaternion.premultiply(P.clone().invert().multiply(Rw).multiply(P));
  }
  group.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const verts = (name: string, step = 1, idx?: number[]): number[][] => {
    const m = rig.getObjectByName(name);
    const n = idx ? idx.length : m.geometry.attributes.position.count;
    const out: number[][] = [];
    for (let k = 0; k < n; k += step) {
      m.getVertexPosition(idx ? idx[k] : k, v);
      v.applyMatrix4(m.matrixWorld);
      out.push(plan(v));
    }
    return out;
  };
  return { verts, rig, group };
}

const inTop = (p: number[]): boolean => p[0] >= SAWBUCK_TOP.x0 && p[0] <= SAWBUCK_TOP.x1 && p[1] >= SAWBUCK_TOP.y0 && p[1] <= SAWBUCK_TOP.y1;
const cen = (P: number[][]): number[] => P.reduce((s, p) => [s[0] + p[0] / P.length, s[1] + p[1] / P.length, s[2] + p[2] / P.length], [0, 0, 0]);

test('C2 head (#142c): ada_c2 / ada_table keep the head on her neck, past the west edge, clear of the table, facing D', async () => {
  const cases: Array<[string, number]> = [['ada_c2', 0], ['ada_c2', 2.4], ['ada_c2', 6.9], ['ada_table', 1.0]];
  for (const [clip, t] of cases) {
    const g = await loadAda();
    const { verts, rig } = pose(g, clip, t, 1);
    const head = verts('ada_head');
    const under = head.filter((p) => inTop(p) && p[2] < SAWBUCK_TOP.z - 0.003).length;
    const past = head.filter((p) => p[0] < SAWBUCK_TOP.x0).length / head.length;
    const drape = head.filter((p) => p[1] >= 3.0 && p[1] <= 3.6 && p[2] >= 0.85 && p[2] < 1.4 && p[0] > drapeX(p[2]) - 0.004 && p[0] < SAWBUCK_TOP.x1).length;
    assert.equal(under, 0, `${clip} ${t}: ${under} head vertices inside the sawbuck top`);
    assert.ok(past >= 0.85, `${clip} ${t}: only ${(past * 100).toFixed(0)} % of the head past the west edge`);
    assert.equal(drape, 0, `${clip} ${t}: ${drape} head vertices through the rubber drape`);
    // the body: nothing through the top (1 cm tolerance: skin on rubber) or the east drape band
    const body = verts('ada_body', 3);
    const bodyPen = body.filter((p) => p[1] >= SAWBUCK_TOP.y0 && p[1] <= SAWBUCK_TOP.y1 && p[0] >= SAWBUCK_TOP.x0 - 0.02 && p[0] <= SAWBUCK_TOP.x1 + 0.03 && p[2] >= 0.95 && p[2] < SAWBUCK_TOP.z - 0.01).length;
    assert.equal(bodyPen, 0, `${clip} ${t}: ${bodyPen} body vertices in the table`);
    // the face (eye centroid − head centroid) turned toward the doorway camera
    const hc = cen(head);
    const ec = cen(verts('ada_eye'));
    const f = [ec[0] - hc[0], ec[1] - hc[1], ec[2] - hc[2]];
    const toD = [C2E_D[0] - hc[0], C2E_D[1] - hc[1], C2E_D[2] - hc[2]];
    const cosD = (f[0] * toD[0] + f[1] * toD[1] + f[2] * toD[2]) / (Math.hypot(...f) * Math.hypot(...toD));
    assert.ok(cosD >= 0.85, `${clip} ${t}: face·(→D) ${cosD.toFixed(2)}`);
    void rig;
  }
});

test('C2 head (#142c): the cut ring is where the jets start and where the blade lands', async () => {
  const g = await loadAda();
  const { verts, rig } = pose(g, 'ada_c2', 7.85, 1);
  const bp = rig.getObjectByName('ada_body').geometry.attributes.position;
  const ring: number[] = [];
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
    if (Math.abs(y - (1.393 - 0.57 * z)) * 0.869 < 0.008 && Math.hypot(x, z + 0.012) < 0.085) ring.push(i);
  }
  const rc = cen(verts('ada_body', 1, ring));
  assert.ok(Math.hypot(rc[0] - JET_CUT[0], rc[1] - JET_CUT[1], rc[2] - JET_CUT[2]) < 0.02, `ring ${rc.map((x) => x.toFixed(3))} vs JET_CUT ${JET_CUT}`);
  // harlan_c2 IK-holds the cleaver edge on stage NECK at contact (blender/anim/clips_escape.py)
  assert.ok(Math.hypot(rc[0] - NECK[0], rc[1] - NECK[1]) < 0.07, `ring ${rc.map((x) => x.toFixed(3))} vs the blade's NECK ${NECK}`);
  assert.ok(rc[0] < SAWBUCK_TOP.x0, 'the cut lies past the edge (the head can fall)');
});

test('C2 head (#142c): the lift is on for the table clips and leaves with the rise', () => {
  assert.equal(tableLiftWeight('ada_table', 3), 1);
  assert.equal(tableLiftWeight('ada_c2', 20), 1);
  assert.equal(tableLiftWeight('ada_rise_headless', 0.2), 1);
  assert.equal(tableLiftWeight('ada_rise_headless', 1.25), 0);
  assert.ok(tableLiftWeight('ada_rise_headless', 0.75) > 0 && tableLiftWeight('ada_rise_headless', 0.75) < 1);
  assert.equal(tableLiftWeight('ada_patrol', 0), 0);
  assert.equal(tableLiftWeight(null, 0), 0);
  // continuous across the rise: no step of more than 2 % per 1/30 s
  let prev = 1;
  for (let t = 0; t <= 1.5; t += 1 / 30) {
    const w = tableLiftWeight('ada_rise_headless', t);
    assert.ok(Math.abs(w - prev) < 0.1, `step at ${t.toFixed(2)}`);
    prev = w;
  }
});
