// Coordinate conventions (single rule for every module and every build script):
//
//   PLAN space (level-layout.json, Blender): metres, right-handed, Z-up.
//     x = east, y = north, z = up. The house's south (front) facade faces -y.
//   WORLD space (three.js runtime, glTF): metres, right-handed, Y-up.
//     The Blender glTF exporter (export_yup=True) maps plan (x, y, z) -> world (x, z, -y).
//
// Use these helpers instead of hand-converting.

export type Vec3Tuple = [number, number, number];

export function planToWorld(p: Vec3Tuple): Vec3Tuple {
  return [p[0], p[2], -p[1]];
}

export function worldToPlan(w: Vec3Tuple): Vec3Tuple {
  return [w[0], -w[2], w[1]];
}

/** Plan yaw (radians, counter-clockwise from +x/east about +z) -> world yaw about +y. Identical numerically. */
export function planYawToWorldYaw(yaw: number): number {
  return yaw;
}
