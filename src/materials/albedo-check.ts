// avgAlbedo check math (pure; no three.js — unit-tested in tests/materials-library.test.ts).
// The baker measures each baked map's mean linear albedo on the GPU (a 16×16 mip readback) and compares it with
// material-spec.json avgAlbedo — the colour Cycles uses for bounce light, so it must describe the final look.

export const ALBEDO_TOLERANCE = 0.1;
const GAIN_MIN = 0.5;
const GAIN_MAX = 2.0;
/** Channels darker than this compare against it (a 0.015 → 0.017 difference is not a 13 % colour error). */
export const ALBEDO_FLOOR = 0.02;

/** Max per-channel relative deviation of measured from target (with an absolute floor for near-black channels). */
export function albedoDeviation(measured: readonly number[], target: readonly number[]): number {
  let e = 0;
  for (let i = 0; i < 3; i++) e = Math.max(e, Math.abs(measured[i] - target[i]) / Math.max(target[i], ALBEDO_FLOOR));
  return e;
}

/** Runtime per-channel gain (bind.ts) that maps measured onto target, clamped so a broken generator can't blow up. */
export function albedoGain(measured: readonly number[], target: readonly number[]): [number, number, number] {
  const g = (i: number) => Math.min(GAIN_MAX, Math.max(GAIN_MIN, target[i] / Math.max(measured[i], 1e-4)));
  return [g(0), g(1), g(2)];
}

/** GPU bytes of the two RGBA8 maps with a full mip chain. */
export const bakedBytes = (size: number): number => Math.round(2 * size * size * 4 * (4 / 3));
