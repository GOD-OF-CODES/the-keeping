// County Road 9 corridor (RC9) centreline: a JS port of blender/house/road_rc9.py (docs/C1-OPENING.md §2).
// PLAN space; chainage s eastbound from x 20, offset n positive to the left of eastbound (westbound driver's right).
const R = 300, ARC = Math.PI / 6, S_A = 240, S_B = S_A + R * ARC, S_C = S_B + 450, S_D = S_C + R * ARC;
const X0 = 20, Y0 = -33;
export const RC9 = { R, ARC, S_A, S_B, S_C, S_D, S_END: 1550, X0, Y0, GATE_S: -17.2 };

export function frame(s) {
  if (s <= S_A) return [X0 + s, Y0, 0];
  if (s <= S_B) {
    const a = (s - S_A) / R, cx = X0 + S_A, cy = Y0 - R, phi = Math.PI / 2 - a;
    return [cx + R * Math.cos(phi), cy + R * Math.sin(phi), -a];
  }
  const x1 = S_A + X0 + R * Math.sin(ARC), y1 = Y0 - R * (1 - Math.cos(ARC)), h = -ARC;
  if (s <= S_C) { const d = s - S_B; return [x1 + d * Math.cos(h), y1 + d * Math.sin(h), h]; }
  const x2 = x1 + 450 * Math.cos(h), y2 = y1 + 450 * Math.sin(h);
  const cx = x2 - R * Math.sin(h), cy = y2 + R * Math.cos(h);
  if (s <= S_D) { const a = (s - S_C) / R, phi = h - Math.PI / 2 + a; return [cx + R * Math.cos(phi), cy + R * Math.sin(phi), h + a]; }
  return [cx + (s - S_D), cy - R, 0];
}
/** PLAN point at chainage s, offset n. */
export function rcPoint(s, n = 0, z = 0) {
  const [x, y, h] = frame(s);
  return [x - n * Math.sin(h), y + n * Math.cos(h), z];
}
/** Layout yaw (front = -y at yaw 0) that makes a prop at (s, n) face along unit direction (dx, dy). */
export const yawFacing = (dx, dy) => Math.atan2(dx, -dy);
/** Yaw facing traffic that approaches from +s (westbound), turned `toRoad` (0..1) toward the centreline. */
export function rcFaceOncoming(s, n, toRoad = 0.15) {
  const h = frame(s)[2];
  const tx = Math.cos(h), ty = Math.sin(h);          // eastbound tangent = toward oncoming westbound traffic
  const nx = -Math.sin(h) * -Math.sign(n), ny = Math.cos(h) * -Math.sign(n); // toward the road
  return yawFacing(tx + toRoad * nx, ty + toRoad * ny);
}
/** Yaw facing the road squarely from offset n. */
export function rcFaceRoad(s, n) {
  const h = frame(s)[2];
  return yawFacing(Math.sin(h) * Math.sign(n), -Math.cos(h) * Math.sign(n));
}
/** src/shared/road-rc9.json: the shared corridor definition (lead-approved 2026-10-08, docs/C1-OPENING.md §2, §10.2).
 *  Same numbers as blender/house/road_rc9.py definition() minus its 2 m polyline (consumers rebuild it from segments). */
export function definition() {
  const r6 = (v) => Math.round(v * 1e6) / 1e6, r3 = (v) => Math.round(v * 1e3) / 1e3;
  const pB = frame(S_B), pC = frame(S_C), pD = frame(S_D);
  const h = -ARC;
  const cB = [X0 + S_A, Y0 - R];
  const cD = [pC[0] - R * Math.sin(h), pC[1] + R * Math.cos(h)];
  return {
    version: 1, space: 'PLAN', chainage: 'eastbound from x = 20; n positive = left of eastbound',
    width: { asphalt: 3.5, shoulder: 4.7, ditch: 7.5, backslope: 9.5, clearing: 14.0 },
    lanes: { westbound: 1.75, eastbound: -1.75 },
    crown: 0.02, gate_s: RC9.GATE_S, detail_end_s: 1250.0, end_s: RC9.S_END,
    segments: [
      { id: 'A', s0: 0, s1: S_A, kind: 'straight', start: [X0, Y0], heading: 0 },
      { id: 'B', s0: S_A, s1: r3(S_B), kind: 'arc', turn: 'cw', centre: cB.map(r3), radius: R, heading0: 0, heading1: r6(-ARC) },
      { id: 'C', s0: r3(S_B), s1: r3(S_C), kind: 'straight', start: [r3(pB[0]), r3(pB[1])], heading: r6(-ARC) },
      { id: 'D', s0: r3(S_C), s1: r3(S_D), kind: 'arc', turn: 'ccw', centre: cD.map(r3), radius: R, heading0: r6(-ARC), heading1: 0 },
      { id: 'E', s0: r3(S_D), s1: RC9.S_END, kind: 'straight', start: [r3(pD[0]), r3(pD[1])], heading: 0 },
    ],
  };
}
