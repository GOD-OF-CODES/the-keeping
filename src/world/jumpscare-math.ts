// JUMPSCARE (#147l) pure math for the pre-rendered scare clip (STATUS-jumpscare Spec §3; no three.js, node-testable).
// The clip is LOG-encoded, scene-referred: Cycles' linear radiance L -> v = log2(1 + L/L0) / R per channel
// (blender/scare/scare_encode.mjs, line `out[i] = L > 0 ? Math.min(1, Math.log2(1 + L * iL0) * iR) : 0`), stored as
// R'G'B' = v in an H.264 stream tagged bt709 / bt709 / iec61966-2-1 / tv. The runtime samples it as an SRGBColorSpace
// VideoTexture (the sRGB EOTF is applied by the hardware / three's in-shader decode), re-applies three's
// sRGBTransferOETF to get v back, then L = L0 * (2^(v R) - 1) — real radiance for the game's exposure / AgX / grain.
// The per-clip numbers (L0, R, Lmax, codec strings) come from `public/assets/<tier>/scare_face.json` (manifest id
// `scare_face_meta`, kind `data`: never downloaded by level.ts), NOT from constants here.

/** `scare_face.json` as written by scare_encode.mjs (`meta`). */
export interface ScareMeta {
  name: string;
  fps: number;
  frames: number;
  stops: number;
  L0: number;
  R: number;
  Lmax: number;
  ref?: string | null;
  decode?: string;
  codecs: Record<string, string>;
}

/** Tiers that ship a clip. #147n: Low too — a 640x400 crf 24 clip (≈ 92 KB) inside the headroom the release bake left
 *  in Low's 27 MB (26.87 MB used; Spec §5 had ~10 KB, so Low had the in-engine fallback, which the final review failed
 *  as "a blown-out plaster mannequin"). A tier whose files are missing still falls back (load() rejects). */
export const SCARE_CLIP_TIERS = ['max', 'medium', 'low'] as const;
/** Size caps (Spec Probe: Max <= 3 MB, Medium <= 1.5 MB, Low <= 330 KB if it is ever funded). */
export const SCARE_CLIP_CAP_BYTES = { max: 3 * 1048576, medium: 1.5 * 1048576, low: 330 * 1024 } as const;
/** Blender AgX preview exposure of the shipped sequence (scare_render --ev; look-rl1 ev_metered). The game's fixed cut
 *  exposure must reproduce this look within 0.2 EV (Spec §3 'Exposure'); stated here so the player has one source. */
export const SCARE_PREVIEW_EV = -11.73;

/** three r186 `sRGBTransferEOTF` (src/nodes/display/ColorSpaceFunctions.js), per channel. */
export function srgbEOTF(c: number): number {
  return c <= 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

/** three r186 `sRGBTransferOETF` (same file; note its 0.41666 exponent), per channel. */
export function srgbOETF(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : Math.pow(c, 0.41666) * 1.055 - 0.055;
}

/** The encoder's log curve (scene radiance -> code value v in [0, 1]). */
export function logEncode(L: number, m: Pick<ScareMeta, 'L0' | 'R'>): number {
  return L > 0 ? Math.min(1, Math.log2(1 + L / m.L0) / m.R) : 0;
}

/** The decode: code value v -> scene radiance (the inverse of logEncode below the clip at Lmax). */
export function logDecode(v: number, m: Pick<ScareMeta, 'L0' | 'R'>): number {
  return m.L0 * (Math.pow(2, v * m.R) - 1);
}

/** What the shader does per channel: the sampled (already sRGB-decoded) texel -> scene radiance. */
export function decodeSampled(sampled: number, m: Pick<ScareMeta, 'L0' | 'R'>): number {
  return logDecode(srgbOETF(sampled), m);
}

/** EV error metric of the encoder's own round-trip check (scare_encode.mjs): log2((Ld + L0) / (L + L0)). */
export function evError(L: number, Ld: number, L0: number): number {
  return Math.log2((Math.max(Ld, 0) + L0) / (L + L0));
}

/** The canPlayType / MediaSource codec string for a tier, or null (no clip on that tier). */
export function codecFor(meta: ScareMeta, tier: string): string | null {
  const c = meta.codecs?.[tier];
  return typeof c === 'string' && /^avc1\.[0-9a-f]{6}$/i.test(c) ? c : null;
}

/** Consistency problems of a shipped meta (empty = ok): L0 = Lmax / 2^stops, R = log2(1 + Lmax / L0), sane fps/frames,
 *  an H.264 High-profile codec string whose level covers the encoded size. */
export function metaProblems(meta: ScareMeta, tiers: readonly string[] = SCARE_CLIP_TIERS): string[] {
  const out: string[] = [];
  const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
  if (!(meta.Lmax > 0) || !(meta.L0 > 0)) out.push(`bad Lmax/L0 ${meta.Lmax}/${meta.L0}`);
  if (rel(meta.L0, meta.Lmax / 2 ** meta.stops) > 1e-5) out.push(`L0 ${meta.L0} != Lmax / 2^${meta.stops}`);
  if (rel(meta.R, Math.log2(1 + meta.Lmax / meta.L0)) > 1e-5) out.push(`R ${meta.R} != log2(1 + Lmax / L0)`);
  if (meta.fps !== 30) out.push(`fps ${meta.fps} (the death timeline assumes 30)`);
  if (!(meta.frames >= 24 && meta.frames <= 30)) out.push(`frames ${meta.frames} (24-30 at 30 fps)`);
  for (const t of tiers) {
    const c = codecFor(meta, t);
    if (!c) out.push(`no codec for ${t}`);
    else if (!/^avc1\.6400(28|32)$/i.test(c)) out.push(`${t} codec ${c}: expected High profile level 4.0 or 5.0`);
  }
  return out;
}

// ------------------------------------------------------------------ #147m: the death-cutaway timing (pure: death.ts,
// src/world/jumpscare.ts and tests/jumpscare.test.ts share these numbers)

/** Cutaway time of the hard cut to her face (the 0.15 s in-engine lunge comes first). */
export const SCARE_CUT_T = 0.15;
/** The clip's length on screen: 30 frames at 30 fps. */
export const SCARE_CLIP_S = 1.0;
/** Media time from which the quad outputs black: the last frame's pts is 0.967 s, so rVFC `mediaTime` never reaches 1.0
 *  (147l handoff) — 0.98 s is "after the last frame has been shown for its 1/30 s". */
export const SCARE_BLACK_MEDIA_T = 0.98;
/** Backstop: the quad is black this long after the cut whatever the video clock says (a stalled decoder never holds a
 *  frozen face on screen). */
export const SCARE_BLACK_AFTER_S = SCARE_CLIP_S + 0.12;
/** The timeline's DOM fade to black (a backstop for a late `play()`; never two keys at one t: sampleKeys lerps). */
export const SCARE_FADE_T: readonly [number, number] = [1.38, 1.4];
/** Cutaway time the quad (or the fallback head) is taken down, under the black. */
export const SCARE_OFF_T = 1.45;
/** reducedFlash: the cut becomes a 2-frame (30 fps) ramp instead of a one-frame step. */
export const SCARE_REDUCED_RAMP_S = 2 / 30;

/**
 * The game's fixed (film-camera) exposure at the cut: the linear multiplier on scene radiance that reproduces the
 * Blender AgX preview the frames were judged at (EV SCARE_PREVIEW_EV), plus SCARE_GAME_EV_OFFSET — the measured
 * difference between Blender's AgX view (white balance 3300 K, tint 10) and the game's grade + three's AgX (the game WB
 * is the same 3300 K indoors; see STATUS-jumpscare 147m for the readback that sets it).
 */
// 147m readback (Medium, stepped, clip frame 15, central lit face, scripts/qa/jumpscare.mjs + scratchpad js/match.py):
// at the bare 2^-11.73 the game's face median was 80.8 /255 vs Blender's 73.6 → −0.23 EV of input exposure.
export const SCARE_GAME_EV_OFFSET = -0.23;
/**
 * The quad outputs the clip's radiance × this scale, and the cut exposure is raised by its inverse: the exposed values
 * (what AgX sees) are identical, but the exposure uniform stays ≥ 1e-3. Why: the pipeline's bloom threshold is
 * `bloomThreshold / max(exposure, 1e-3)` (src/render/pipeline.ts), so at the bare 2.5e-4 the 1.5 "exposed" threshold
 * fell to 0.375 and the whole lit face bloomed into a milky veil (147m QA m1). 2^-5: exposure 8e-3, threshold intact.
 */
export const SCARE_RADIANCE_SCALE = 1 / 32;
export const SCARE_EXPOSURE = Math.pow(2, SCARE_PREVIEW_EV + SCARE_GAME_EV_OFFSET) / SCARE_RADIANCE_SCALE;

/**
 * The quad's output gain at `tOn` s after the cut (1 = the frame as decoded, 0 = black). `media` = the presented frame's
 * media time (null = unknown), `ended` = the video fired `ended`. A hard cut (one frame) normally; under reducedFlash a
 * linear 2-frame ramp. Black from SCARE_BLACK_MEDIA_T of media time, on `ended`, or SCARE_BLACK_AFTER_S after the cut.
 */
export function scareGain(tOn: number, media: number | null, ended: boolean, reducedFlash: boolean): number {
  if (tOn < 0 || ended || tOn >= SCARE_BLACK_AFTER_S) return 0;
  if (media !== null && media >= SCARE_BLACK_MEDIA_T) return 0;
  if (reducedFlash) return Math.min(1, tOn / SCARE_REDUCED_RAMP_S);
  return 1;
}

/** The in-engine fallback (no codec; fetch / decode error; `ada_severed` false; since #147n Low ships a clip): her real severed head
 *  held `dist` m before the lens, chin up, torch-lit (Spec §3 'Fallback'). */
export const SCARE_FALLBACK = {
  /** Lens → face (m), the MINIMUM: the module keeps the face ≥ 15 cm beyond the torch's lens (in game it sits 0.51 m
   *  forward with the arms hidden → 0.6 m, the cap) and narrows the camera's fov to keep the framing (147m l5 / l6). */
  dist: 0.28,
  /** Chin up (rad): the cut shows as a sliver under the jaw. */
  chinUp: (20 * Math.PI) / 180,
  /** Vertical FOV (deg) of the held shot: the face fills the height at 0.28 m (2·0.28·tan 15° = 0.15 m). */
  fov: 30,
  /** jaw_open keys over the clip's second (t s after the cut → weight): the spasm at 0.33–0.5 s like the clip. */
  jaw: [
    [0, 0.25],
    [0.33, 0.25],
    [0.4, 0.6],
    [0.5, 0.4],
    [1, 0.45],
  ] as readonly (readonly [number, number])[],
} as const;

/** Piecewise-linear key lookup (held outside the keys). */
export function keyAt(keys: readonly (readonly [number, number])[], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      return v0 + ((v1 - v0) * (t - t0)) / Math.max(1e-9, t1 - t0);
    }
  }
  return keys[keys.length - 1][1];
}

/** Cover-fit UV transform of a `clipAspect` (w/h) frame on a `viewAspect` canvas: uv' = uv·scale + offset (centred). */
export function coverFit(viewAspect: number, clipAspect: number): { sx: number; sy: number; ox: number; oy: number } {
  if (viewAspect >= clipAspect) {
    // wider canvas: the clip fills the width, crops top + bottom
    const sy = clipAspect / viewAspect;
    return { sx: 1, sy, ox: 0, oy: (1 - sy) / 2 };
  }
  const sx = viewAspect / clipAspect;
  return { sx, sy: 1, ox: (1 - sx) / 2, oy: 0 };
}
