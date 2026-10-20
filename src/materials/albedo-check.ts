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

/**
 * FINAL #153d (LEAD RULING (bf), R2-2): runtime-only colour targets for specs whose avgAlbedo is physically off but
 * must stay as it is in material-spec.json (the file keys the shipped light probes and is the Cycles bounce colour;
 * editing it would stale both). Value = the target blue / red ratio of the linear mean colour; luminance is kept.
 * brass_tarnished: spec F0 0.42 / 0.30 / 0.12 = b/r 0.29, a saturated orange that reads as a glowing bar at night;
 * brass F0 (linear sRGB, polished ≈ 0.91 / 0.78 / 0.42 → b/r ≈ 0.46) → 0.46 at the same Rec.709 Y 0.3125.
 */
export const RUNTIME_BLUE_RED: Readonly<Record<string, number>> = { brass_tarnished: 0.46 };

/**
 * The colour of the same Rec.709 luminance whose b / r equals `br`: c' = Y + k (c − Y) (linear desaturation toward
 * grey, k from b' = br · r'); k is clamped to [0, 1] (never more saturated, never past grey).
 */
export function desaturateToBlueRed(c: readonly number[], br: number): [number, number, number] {
  const Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const den = c[2] - Y - br * (c[0] - Y);
  const k = Math.abs(den) < 1e-9 ? 1 : Math.min(1, Math.max(0, (Y * (br - 1)) / den));
  return [Y + k * (c[0] - Y), Y + k * (c[1] - Y), Y + k * (c[2] - Y)];
}

/** The runtime colour target of a spec (its avgAlbedo unless RUNTIME_BLUE_RED overrides it). */
export function runtimeAlbedo(id: string, avg: readonly number[]): [number, number, number] {
  const br = RUNTIME_BLUE_RED[id];
  return br === undefined ? [avg[0], avg[1], avg[2]] : desaturateToBlueRed(avg, br);
}
