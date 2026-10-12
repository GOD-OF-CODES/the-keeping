// The cutscene grade + lightmap scale (CUTSCENES-PLAN §5, M-A `grade` / `lmScale` cues). PURE (no three.js): the
// cutscene host eases these numbers; the per-frame writers multiply them in —
//   src/world/cutscene-fx.ts  pipeline tint / saturation (on top of the C6 blue hour) and uLmScale,
//   src/world/atmosphere.ts   pipeline grain / vignette (on top of LOOK).
// Identity (all 1, fade 0) whenever no cutscene grades, so gameplay is untouched.

export interface GradeState {
  tint: [number, number, number];
  saturation: number;
  grain: number;
  vignette: number;
  /** Extra black over the frame 0..1 (composited with the timeline's fade by the host). */
  fade: number;
  /** Lightmap intensity multiplier (1 = as baked, × π irradiance in the material). */
  lm: number;
}

export const IDENTITY_GRADE: Readonly<GradeState> = Object.freeze({ tint: [1, 1, 1] as [number, number, number], saturation: 1, grain: 1, vignette: 1, fade: 0, lm: 1 });

/** The live values the writers read every frame. */
export const GRADE: GradeState = { tint: [1, 1, 1], saturation: 1, grain: 1, vignette: 1, fade: 0, lm: 1 };

interface Tween {
  from: GradeState;
  to: GradeState;
  t: number;
  over: number;
}
let tween: Tween | null = null;
let lmTween: { from: number; to: number; t: number; over: number } | null = null;

const copy = (g: Readonly<GradeState>): GradeState => ({ ...g, tint: [g.tint[0], g.tint[1], g.tint[2]] });
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** The grade fields (lm has its own ease). */
function assign(k: number, a: GradeState, b: GradeState): void {
  GRADE.tint[0] = lerp(a.tint[0], b.tint[0], k);
  GRADE.tint[1] = lerp(a.tint[1], b.tint[1], k);
  GRADE.tint[2] = lerp(a.tint[2], b.tint[2], k);
  GRADE.saturation = lerp(a.saturation, b.saturation, k);
  GRADE.grain = lerp(a.grain, b.grain, k);
  GRADE.vignette = lerp(a.vignette, b.vignette, k);
  GRADE.fade = lerp(a.fade, b.fade, k);
}

/** Ease the grade toward `target` (fields left out → identity) over `over` seconds (0 = cut). null = identity. */
export function gradeTo(target: Partial<Omit<GradeState, 'lm'>> | null, over = 0): void {
  const to: GradeState = { ...copy(IDENTITY_GRADE), ...(target ?? {}), tint: target?.tint ? ([...target.tint] as [number, number, number]) : [1, 1, 1] };
  if (over <= 0) {
    tween = null;
    assign(1, to, to);
    return;
  }
  tween = { from: copy(GRADE), to, t: 0, over };
}

/** Ease the lightmap scale (the `lmScale` cue). */
export function lmScaleTo(scale: number, over = 0): void {
  if (over <= 0) {
    lmTween = null;
    GRADE.lm = scale;
    return;
  }
  lmTween = { from: GRADE.lm, to: scale, t: 0, over };
}

/** Advance the eases (the cutscene host, every frame). */
export function tickGrade(dt: number): void {
  if (tween) {
    tween.t += dt;
    assign(ease(tween.t / tween.over), tween.from, tween.to);
    if (tween.t >= tween.over) tween = null;
  }
  if (lmTween) {
    lmTween.t += dt;
    GRADE.lm = lerp(lmTween.from, lmTween.to, ease(lmTween.t / lmTween.over));
    if (lmTween.t >= lmTween.over) lmTween = null;
  }
}

/** Back to identity at once (cutscene teardown, death, debug). */
export function resetGrade(): void {
  tween = null;
  lmTween = null;
  const id = copy(IDENTITY_GRADE);
  assign(1, id, id);
  GRADE.lm = 1;
}

export const gradeIsIdentity = (): boolean =>
  !tween && !lmTween && GRADE.tint[0] === 1 && GRADE.tint[1] === 1 && GRADE.tint[2] === 1 && GRADE.saturation === 1 && GRADE.grain === 1 && GRADE.vignette === 1 && GRADE.fade === 0 && GRADE.lm === 1;
