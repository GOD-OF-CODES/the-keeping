// Our own single-stroke font + renderer for everything written in the world: the guest book, ledger, letter,
// ticket, chalked cans, the painted STROUD'S GAS & FEED sign (GAS painted out), the hand-lettered ROOMS board, the
// stencilled VACANCY plate, the plate RVX-318 … No font files: each glyph is a few polylines on a 0..1 box
// (x right, y DOWN; baseline y = 1, x-height 0.45, cap 0.0 … 1.0), drawn with a pen model per style
// (pencil/ink: jittered, pressure-varying, slanted; brush: thick, dry-edged; stencil: bridged caps; chalk: grainy).
// Pure data + Canvas 2D; the texture wrapper lives in src/world/decals.ts.

export type Stroke = number[]; // flat [x0, y0, x1, y1, …]
export interface Glyph {
  w: number;
  s: Stroke[];
}

const X = 0.45; // x-height top (y), baseline at 1
const D = 1.32; // descender

// ------------------------------------------------------------------------------------------------ glyph data
// Capitals: 0..1 box, width ~0.6. Lower case: x-height 0.45..1. Circles are sampled polylines (ellipse()).

function ellipse(cx: number, cy: number, rx: number, ry: number, a0 = 0, a1 = Math.PI * 2, n = 14): Stroke {
  const s: Stroke = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    s.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  return s;
}

const PI = Math.PI;

export const GLYPHS: Record<string, Glyph> = {
  A: { w: 0.62, s: [[0, 1, 0.31, 0, 0.62, 1], [0.12, 0.62, 0.5, 0.62]] },
  B: { w: 0.56, s: [[0.02, 1, 0.02, 0, 0.36, 0, 0.5, 0.08, 0.5, 0.38, 0.34, 0.48, 0.02, 0.48], [0.34, 0.48, 0.54, 0.58, 0.54, 0.9, 0.38, 1, 0.02, 1]] },
  C: { w: 0.58, s: [ellipse(0.32, 0.5, 0.3, 0.5, -0.25 * PI, -1.75 * PI, 16)] },
  D: { w: 0.6, s: [[0.02, 0, 0.02, 1, 0.3, 1], [0.02, 0, 0.3, 0], ellipse(0.3, 0.5, 0.28, 0.5, -0.5 * PI, 0.5 * PI, 10)] },
  E: { w: 0.5, s: [[0.48, 0, 0.02, 0, 0.02, 1, 0.48, 1], [0.02, 0.5, 0.38, 0.5]] },
  F: { w: 0.48, s: [[0.46, 0, 0.02, 0, 0.02, 1], [0.02, 0.5, 0.36, 0.5]] },
  G: { w: 0.62, s: [[...ellipse(0.32, 0.5, 0.3, 0.5, -0.25 * PI, -1.95 * PI, 16), 0.62, 0.55, 0.36, 0.55]] },
  H: { w: 0.58, s: [[0.02, 0, 0.02, 1], [0.56, 0, 0.56, 1], [0.02, 0.5, 0.56, 0.5]] },
  I: { w: 0.2, s: [[0.1, 0, 0.1, 1]] },
  J: { w: 0.44, s: [[0.4, 0, 0.4, 0.75, ...ellipse(0.22, 0.75, 0.18, 0.25, 0, PI, 6).slice(2)]] },
  K: { w: 0.54, s: [[0.02, 0, 0.02, 1], [0.52, 0, 0.02, 0.6], [0.18, 0.46, 0.54, 1]] },
  L: { w: 0.46, s: [[0.02, 0, 0.02, 1, 0.44, 1]] },
  M: { w: 0.72, s: [[0.02, 1, 0.04, 0, 0.36, 0.7, 0.68, 0, 0.7, 1]] },
  N: { w: 0.6, s: [[0.02, 1, 0.02, 0, 0.58, 1, 0.58, 0]] },
  O: { w: 0.64, s: [ellipse(0.32, 0.5, 0.31, 0.5, 0, 2 * PI, 18)] },
  P: { w: 0.52, s: [[0.02, 1, 0.02, 0, 0.34, 0, 0.5, 0.1, 0.5, 0.42, 0.34, 0.52, 0.02, 0.52]] },
  Q: { w: 0.66, s: [ellipse(0.32, 0.5, 0.31, 0.5, 0, 2 * PI, 18), [0.4, 0.74, 0.64, 1.04]] },
  R: { w: 0.56, s: [[0.02, 1, 0.02, 0, 0.34, 0, 0.5, 0.1, 0.5, 0.4, 0.34, 0.5, 0.02, 0.5], [0.26, 0.5, 0.56, 1]] },
  S: { w: 0.52, s: [[0.48, 0.1, 0.36, 0, 0.16, 0, 0.03, 0.1, 0.03, 0.34, 0.18, 0.46, 0.36, 0.53, 0.5, 0.64, 0.5, 0.9, 0.36, 1, 0.14, 1, 0.02, 0.9]] },
  T: { w: 0.56, s: [[0, 0, 0.56, 0], [0.28, 0, 0.28, 1]] },
  U: { w: 0.58, s: [[0.02, 0, 0.02, 0.7, ...ellipse(0.29, 0.7, 0.27, 0.3, PI, 0, 8).slice(2), 0.56, 0]] },
  V: { w: 0.6, s: [[0, 0, 0.3, 1, 0.6, 0]] },
  W: { w: 0.82, s: [[0, 0, 0.2, 1, 0.41, 0.35, 0.62, 1, 0.82, 0]] },
  X: { w: 0.56, s: [[0, 0, 0.56, 1], [0.56, 0, 0, 1]] },
  Y: { w: 0.56, s: [[0, 0, 0.28, 0.5, 0.56, 0], [0.28, 0.5, 0.28, 1]] },
  Z: { w: 0.54, s: [[0.02, 0, 0.52, 0, 0.02, 1, 0.52, 1]] },
  a: { w: 0.46, s: [[...ellipse(0.2, 0.73, 0.19, 0.27, -0.2 * PI, -2.1 * PI, 12), 0.41, 0.46, 0.41, 0.94, 0.46, 1]] },
  b: { w: 0.44, s: [[0.03, 0, 0.03, 1], ellipse(0.22, 0.73, 0.19, 0.27, PI, 3 * PI, 12)] },
  c: { w: 0.38, s: [ellipse(0.2, 0.73, 0.18, 0.27, -0.25 * PI, -1.8 * PI, 12)] },
  d: { w: 0.46, s: [ellipse(0.2, 0.73, 0.19, 0.27, 0, 2 * PI, 12), [0.39, 0, 0.39, 0.94, 0.45, 1]] },
  e: { w: 0.4, s: [[0.04, 0.72, 0.37, 0.72, 0.36, 0.58, 0.26, 0.47, 0.14, 0.47, 0.04, 0.58, 0.02, 0.76, 0.08, 0.93, 0.2, 1, 0.3, 0.99, 0.38, 0.92]] },
  f: { w: 0.32, s: [[0.3, 0.04, 0.22, 0, 0.14, 0.04, 0.12, 0.2, 0.12, 1], [0.0, 0.47, 0.28, 0.47]] },
  g: { w: 0.44, s: [ellipse(0.2, 0.72, 0.18, 0.26, 0, 2 * PI, 12), [0.38, 0.46, 0.38, 1.16, 0.3, 1.3, 0.14, 1.32, 0.04, 1.24]] },
  h: { w: 0.44, s: [[0.03, 0, 0.03, 1], [0.03, 0.62, 0.14, 0.49, 0.28, 0.46, 0.38, 0.52, 0.41, 0.66, 0.41, 1]] },
  i: { w: 0.16, s: [[0.07, 0.47, 0.07, 1], [0.07, 0.26, 0.08, 0.28]] },
  j: { w: 0.2, s: [[0.12, 0.47, 0.12, 1.2, 0.06, 1.32, -0.04, 1.3], [0.12, 0.26, 0.13, 0.28]] },
  k: { w: 0.4, s: [[0.03, 0, 0.03, 1], [0.36, 0.47, 0.03, 0.76], [0.14, 0.68, 0.4, 1]] },
  l: { w: 0.16, s: [[0.06, 0, 0.06, 0.92, 0.12, 1]] },
  m: { w: 0.66, s: [[0.03, 0.47, 0.03, 1], [0.03, 0.6, 0.12, 0.48, 0.22, 0.46, 0.31, 0.53, 0.33, 1], [0.33, 0.6, 0.42, 0.48, 0.52, 0.46, 0.6, 0.53, 0.63, 1]] },
  n: { w: 0.44, s: [[0.03, 0.47, 0.03, 1], [0.03, 0.62, 0.14, 0.49, 0.28, 0.46, 0.38, 0.52, 0.41, 0.66, 0.41, 1]] },
  o: { w: 0.44, s: [ellipse(0.21, 0.73, 0.2, 0.27, 0, 2 * PI, 14)] },
  p: { w: 0.44, s: [[0.03, 0.47, 0.03, D], ellipse(0.22, 0.73, 0.19, 0.27, PI, 3 * PI, 12)] },
  q: { w: 0.44, s: [ellipse(0.2, 0.73, 0.19, 0.27, 0, 2 * PI, 12), [0.39, 0.47, 0.39, D, 0.46, 1.24]] },
  r: { w: 0.32, s: [[0.03, 0.47, 0.03, 1], [0.03, 0.64, 0.12, 0.5, 0.22, 0.46, 0.31, 0.48]] },
  s: { w: 0.36, s: [[0.32, 0.52, 0.22, 0.46, 0.1, 0.47, 0.03, 0.55, 0.06, 0.66, 0.18, 0.72, 0.3, 0.78, 0.34, 0.9, 0.26, 0.99, 0.12, 1, 0.02, 0.94]] },
  t: { w: 0.3, s: [[0.12, 0.14, 0.12, 0.92, 0.18, 1, 0.27, 0.98], [0.0, 0.47, 0.26, 0.47]] },
  u: { w: 0.44, s: [[0.03, 0.47, 0.03, 0.84, 0.1, 0.97, 0.2, 1, 0.32, 0.95, 0.4, 0.84], [0.4, 0.47, 0.4, 0.94, 0.45, 1]] },
  v: { w: 0.42, s: [[0.0, 0.47, 0.21, 1, 0.42, 0.47]] },
  w: { w: 0.6, s: [[0.0, 0.47, 0.14, 1, 0.3, 0.6, 0.46, 1, 0.6, 0.47]] },
  x: { w: 0.4, s: [[0.02, 0.47, 0.38, 1], [0.38, 0.47, 0.02, 1]] },
  y: { w: 0.42, s: [[0.0, 0.47, 0.21, 1], [0.42, 0.47, 0.16, 1.18, 0.08, 1.3, 0.0, 1.3]] },
  z: { w: 0.38, s: [[0.02, 0.47, 0.36, 0.47, 0.02, 1, 0.36, 1]] },
  '0': { w: 0.5, s: [ellipse(0.25, 0.5, 0.23, 0.5, 0, 2 * PI, 16)] },
  '1': { w: 0.32, s: [[0.04, 0.2, 0.2, 0, 0.2, 1]] },
  '2': { w: 0.5, s: [[0.04, 0.2, 0.14, 0.04, 0.3, 0, 0.44, 0.08, 0.46, 0.28, 0.36, 0.46, 0.02, 1, 0.48, 1]] },
  '3': { w: 0.48, s: [[0.04, 0.08, 0.2, 0, 0.36, 0.02, 0.44, 0.14, 0.42, 0.34, 0.22, 0.46], [0.22, 0.46, 0.42, 0.56, 0.46, 0.8, 0.36, 0.96, 0.2, 1, 0.02, 0.92]] },
  '4': { w: 0.5, s: [[0.36, 1, 0.36, 0, 0.02, 0.68, 0.48, 0.68]] },
  '5': { w: 0.48, s: [[0.44, 0, 0.08, 0, 0.04, 0.44, 0.22, 0.38, 0.4, 0.44, 0.46, 0.66, 0.42, 0.9, 0.24, 1, 0.02, 0.94]] },
  '6': { w: 0.48, s: [[0.4, 0.02, 0.22, 0.06, 0.08, 0.3, 0.03, 0.62, ...ellipse(0.24, 0.72, 0.21, 0.28, PI, 3 * PI, 12)]] },
  '7': { w: 0.46, s: [[0.02, 0, 0.44, 0, 0.16, 1]] },
  '8': { w: 0.48, s: [ellipse(0.24, 0.24, 0.18, 0.23, 0, 2 * PI, 12), ellipse(0.24, 0.73, 0.22, 0.27, 0, 2 * PI, 12)] },
  '9': { w: 0.48, s: [[...ellipse(0.24, 0.28, 0.21, 0.28, 0, 2 * PI, 12), 0.44, 0.6, 0.36, 0.9, 0.16, 1]] },
  '.': { w: 0.14, s: [[0.06, 0.96, 0.07, 1]] },
  ',': { w: 0.14, s: [[0.08, 0.94, 0.08, 1.02, 0.02, 1.14]] },
  "'": { w: 0.12, s: [[0.06, 0, 0.05, 0.22]] },
  '’': { w: 0.12, s: [[0.07, 0, 0.06, 0.12, 0.02, 0.22]] },
  '"': { w: 0.2, s: [[0.05, 0, 0.05, 0.2], [0.15, 0, 0.15, 0.2]] },
  ':': { w: 0.14, s: [[0.07, 0.5, 0.07, 0.54], [0.07, 0.94, 0.07, 1]] },
  ';': { w: 0.14, s: [[0.07, 0.5, 0.07, 0.54], [0.08, 0.94, 0.08, 1.02, 0.02, 1.14]] },
  '-': { w: 0.3, s: [[0.03, 0.66, 0.27, 0.64]] },
  '—': { w: 0.6, s: [[0.03, 0.66, 0.57, 0.64]] },
  '–': { w: 0.44, s: [[0.03, 0.66, 0.41, 0.64]] },
  '/': { w: 0.36, s: [[0.34, 0, 0.02, 1.05]] },
  '&': { w: 0.6, s: [[0.58, 1, 0.14, 0.42, 0.1, 0.2, 0.2, 0.02, 0.34, 0.02, 0.42, 0.16, 0.36, 0.34, 0.06, 0.62, 0.04, 0.84, 0.16, 1, 0.34, 0.98, 0.56, 0.62]] },
  '!': { w: 0.14, s: [[0.07, 0, 0.07, 0.72], [0.07, 0.95, 0.07, 1]] },
  '?': { w: 0.44, s: [[0.04, 0.18, 0.12, 0.04, 0.26, 0, 0.4, 0.08, 0.4, 0.3, 0.22, 0.46, 0.22, 0.7], [0.22, 0.95, 0.22, 1]] },
  '(': { w: 0.22, s: [ellipse(0.24, 0.52, 0.2, 0.6, 0.62 * PI, 1.38 * PI, 8)] },
  ')': { w: 0.22, s: [ellipse(-0.02, 0.52, 0.2, 0.6, -0.38 * PI, 0.38 * PI, 8)] },
  '#': { w: 0.5, s: [[0.18, 0.1, 0.12, 0.95], [0.38, 0.1, 0.32, 0.95], [0.04, 0.36, 0.48, 0.36], [0.02, 0.68, 0.46, 0.68]] },
  '$': { w: 0.5, s: [[0.44, 0.18, 0.3, 0.1, 0.14, 0.12, 0.06, 0.26, 0.16, 0.44, 0.36, 0.56, 0.44, 0.74, 0.34, 0.9, 0.14, 0.9, 0.04, 0.82], [0.25, 0, 0.25, 1]] },
  ' ': { w: 0.3, s: [] },
};

/** Characters the font covers (tests check every document/sign string against it). */
export function missingGlyphs(text: string): string[] {
  const miss = new Set<string>();
  for (const ch of text) if (ch !== '\n' && !(ch in GLYPHS) && !(ch.toUpperCase() in GLYPHS)) miss.add(ch);
  return [...miss];
}

// ------------------------------------------------------------------------------------------------ layout

/** Deterministic hash RNG (visual jitter must be stable across frames and reloads). */
export function hashRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface PenStyle {
  kind: 'pencil' | 'ink' | 'brush' | 'stencil' | 'chalk' | 'print';
  color: string;
  /** Stroke width as a fraction of the em (glyph height). */
  width: number;
  /** Italic slant (x shift per unit up). */
  slant: number;
  /** Positional jitter (em units) — handwriting wobble. */
  jitter: number;
  /** Letter spacing (em). */
  tracking: number;
  /** Upper-case everything (signs, stencils). */
  caps?: boolean;
}

export const PENS: Record<string, PenStyle> = {
  pencil: { kind: 'pencil', color: 'rgba(52,48,46,0.85)', width: 0.055, slant: 0.18, jitter: 0.028, tracking: 0.06 },
  ink: { kind: 'ink', color: 'rgba(28,26,40,0.92)', width: 0.06, slant: 0.22, jitter: 0.022, tracking: 0.05 },
  inkRed: { kind: 'ink', color: 'rgba(96,24,20,0.9)', width: 0.065, slant: 0.2, jitter: 0.03, tracking: 0.05 },
  brush: { kind: 'brush', color: 'rgba(122,24,18,0.96)', width: 0.16, slant: 0.0, jitter: 0.012, tracking: 0.16, caps: true },
  brushBlack: { kind: 'brush', color: 'rgba(20,18,16,0.95)', width: 0.15, slant: 0.04, jitter: 0.02, tracking: 0.14, caps: true },
  stencil: { kind: 'stencil', color: 'rgba(24,26,24,0.94)', width: 0.17, slant: 0, jitter: 0.004, tracking: 0.18, caps: true },
  chalk: { kind: 'chalk', color: 'rgba(226,222,208,0.9)', width: 0.08, slant: 0.1, jitter: 0.03, tracking: 0.1, caps: true },
  print: { kind: 'print', color: 'rgba(30,30,32,0.95)', width: 0.085, slant: 0, jitter: 0.0, tracking: 0.1, caps: true },
};

export function glyphFor(ch: string): Glyph | null {
  return GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? null;
}

/** Text advance in em units. */
export function measure(text: string, pen: PenStyle): number {
  let w = 0;
  for (const ch of pen.caps ? text.toUpperCase() : text) {
    const g = glyphFor(ch);
    w += (g ? g.w : 0.4) + pen.tracking;
  }
  return Math.max(0, w - pen.tracking);
}

/** Greedy word wrap to `maxEm` (em units). Keeps explicit newlines. */
export function wrap(text: string, pen: PenStyle, maxEm: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const cand = line ? `${line} ${word}` : word;
      if (line && measure(cand, pen) > maxEm) {
        out.push(line);
        line = word;
      } else line = cand;
    }
    out.push(line);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ drawing

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Draws `text` with its baseline at (x, y) and em size `em` px. Returns the advance in px.
 * `rng` makes the wobble deterministic.
 */
export function drawText(g: Ctx2D, text: string, x: number, y: number, em: number, pen: PenStyle, rng: () => number): number {
  const t = pen.caps ? text.toUpperCase() : text;
  let cx = x;
  const top = y - em; // glyph box top
  // per-line drift (handwriting slopes a little)
  const drift = (rng() - 0.5) * em * 0.08 * (pen.jitter > 0.01 ? 1 : 0);
  let i = 0;
  for (const ch of t) {
    const gl = glyphFor(ch);
    const w = (gl ? gl.w : 0.4) * em;
    if (gl && gl.s.length) {
      const sizeJ = 1 + (rng() - 0.5) * pen.jitter * 3;
      const baseJ = (rng() - 0.5) * pen.jitter * em;
      const dy = drift * (i / Math.max(1, t.length));
      for (const s of gl.s) strokePath(g, s, cx, top + baseJ + dy, em * sizeJ, pen, rng);
    }
    cx += w + pen.tracking * em;
    i++;
  }
  return cx - x;
}

function strokePath(g: Ctx2D, s: Stroke, ox: number, oy: number, em: number, pen: PenStyle, rng: () => number): void {
  const n = s.length / 2;
  if (n < 1) return;
  const pts: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const gx = s[k * 2];
    const gy = s[k * 2 + 1];
    const jx = (rng() - 0.5) * pen.jitter * em;
    const jy = (rng() - 0.5) * pen.jitter * em;
    pts.push([ox + (gx + (1 - gy) * pen.slant) * em + jx, oy + gy * em + jy]);
  }
  const w = Math.max(0.6, pen.width * em);
  g.lineCap = pen.kind === 'stencil' || pen.kind === 'print' ? 'butt' : 'round';
  g.lineJoin = 'round';
  if (pen.kind === 'chalk') {
    // grainy: many thin passes with dropouts
    for (let p = 0; p < 4; p++) {
      g.strokeStyle = pen.color;
      g.globalAlpha = 0.28 + rng() * 0.2;
      g.lineWidth = w * (0.5 + rng() * 0.6);
      g.setLineDash([w * (0.6 + rng() * 2), w * (0.2 + rng() * 0.8)]);
      polyline(g, pts, (rng() - 0.5) * w * 0.6, (rng() - 0.5) * w * 0.6);
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
    return;
  }
  if (pen.kind === 'brush') {
    // body + dry-brush streaks along the stroke
    g.strokeStyle = pen.color;
    g.globalAlpha = 0.92;
    g.lineWidth = w;
    polyline(g, pts, 0, 0);
    g.globalAlpha = 0.35;
    for (let p = 0; p < 3; p++) {
      g.lineWidth = w * (0.15 + rng() * 0.2);
      g.setLineDash([w * (1 + rng() * 3), w * (0.3 + rng())]);
      polyline(g, pts, (rng() - 0.5) * w * 0.9, (rng() - 0.5) * w * 0.9);
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
    return;
  }
  if (pen.kind === 'stencil') {
    // bridged stencil: gaps at the ends of every stroke segment
    g.strokeStyle = pen.color;
    g.lineWidth = w;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, ay] = pts[k];
      const [bx, by] = pts[k + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-3) continue;
      const gap = Math.min(len * 0.2, w * 0.45);
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      const s0 = k === 0 ? gap : 0;
      const s1 = k + 2 === pts.length ? gap : 0;
      g.beginPath();
      g.moveTo(ax + ux * s0, ay + uy * s0);
      g.lineTo(bx - ux * s1, by - uy * s1);
      g.stroke();
    }
    return;
  }
  // pencil / ink / print: pressure varies along the stroke (two passes)
  g.strokeStyle = pen.color;
  const segs = pts.length - 1;
  if (segs <= 0) {
    g.fillStyle = pen.color;
    g.beginPath();
    g.arc(pts[0][0], pts[0][1], w * 0.5, 0, Math.PI * 2);
    g.fill();
    return;
  }
  for (let k = 0; k < segs; k++) {
    const t = k / segs;
    const pressure = pen.kind === 'print' ? 1 : 0.7 + 0.45 * Math.sin(Math.PI * (0.15 + t * 0.8)) + (rng() - 0.5) * 0.15;
    g.lineWidth = w * pressure;
    g.globalAlpha = pen.kind === 'pencil' ? 0.75 + rng() * 0.25 : 1;
    g.beginPath();
    g.moveTo(pts[k][0], pts[k][1]);
    g.lineTo(pts[k + 1][0], pts[k + 1][1]);
    g.stroke();
  }
  g.globalAlpha = 1;
}

function polyline(g: Ctx2D, pts: [number, number][], dx: number, dy: number): void {
  g.beginPath();
  g.moveTo(pts[0][0] + dx, pts[0][1] + dy);
  for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0] + dx, pts[k][1] + dy);
  if (pts.length === 1) g.lineTo(pts[0][0] + dx + 0.5, pts[0][1] + dy);
  g.stroke();
}

// ------------------------------------------------------------------------------------------------ surfaces

/** Aged paper background: warm base, fibre noise, foxing spots, a water stain. */
export function paintPaper(g: Ctx2D, w: number, h: number, rng: () => number, tone: [number, number, number] = [214, 200, 168]): void {
  g.fillStyle = `rgb(${tone[0]},${tone[1]},${tone[2]})`;
  g.fillRect(0, 0, w, h);
  // fibre / tooth
  for (let i = 0; i < (w * h) / 900; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const d = (rng() - 0.5) * 26;
    g.fillStyle = `rgba(${d > 0 ? 255 : 60},${d > 0 ? 245 : 50},${d > 0 ? 220 : 30},${Math.abs(d) / 260})`;
    g.fillRect(x, y, 1 + rng() * 3, 1);
  }
  // foxing
  for (let i = 0; i < 10; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = (0.005 + rng() * 0.02) * Math.max(w, h);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(120,80,40,0.22)');
    grad.addColorStop(1, 'rgba(120,80,40,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // edge darkening
  const e = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  e.addColorStop(0, 'rgba(90,60,30,0)');
  e.addColorStop(1, 'rgba(90,60,30,0.35)');
  g.fillStyle = e;
  g.fillRect(0, 0, w, h);
}

/** Weathered painted board (sign faces): cream paint over grey wood, flaking. */
export function paintBoard(g: Ctx2D, w: number, h: number, rng: () => number, paint = [206, 198, 176], wood = [92, 84, 72]): void {
  g.fillStyle = `rgb(${wood[0]},${wood[1]},${wood[2]})`;
  g.fillRect(0, 0, w, h);
  // grain
  for (let y = 0; y < h; y += 2) {
    g.fillStyle = `rgba(40,34,28,${0.05 + rng() * 0.08})`;
    g.fillRect(0, y, w, 1);
  }
  g.fillStyle = `rgb(${paint[0]},${paint[1]},${paint[2]})`;
  g.fillRect(0, 0, w, h);
  // flakes (wood showing through)
  for (let i = 0; i < 70; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const fw = (0.01 + rng() * 0.05) * w;
    const fh = (0.01 + rng() * 0.05) * h;
    g.fillStyle = `rgba(${wood[0]},${wood[1]},${wood[2]},${0.5 + rng() * 0.5})`;
    g.beginPath();
    g.ellipse(x, y, fw, fh * 0.6, rng() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  // grime from the top
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, 'rgba(40,36,28,0.35)');
  gr.addColorStop(0.5, 'rgba(40,36,28,0.05)');
  gr.addColorStop(1, 'rgba(30,26,20,0.3)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
}

/** Galvanised tin plate with rust bloom. */
export function paintTin(g: Ctx2D, w: number, h: number, rng: () => number): void {
  g.fillStyle = 'rgb(150,154,152)';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = (0.02 + rng() * 0.08) * w;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, i % 3 ? 'rgba(190,196,194,0.4)' : 'rgba(120,60,30,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** Painted-out block over part of a sign (an older word covered with a slightly different cream). */
export function paintOut(g: Ctx2D, x: number, y: number, w: number, h: number, rng: () => number): void {
  g.fillStyle = 'rgba(188,182,160,0.97)';
  g.beginPath();
  const n = 10;
  g.moveTo(x, y);
  for (let i = 0; i <= n; i++) g.lineTo(x + (w * i) / n, y + (rng() - 0.5) * h * 0.12);
  for (let i = n; i >= 0; i--) g.lineTo(x + (w * i) / n, y + h + (rng() - 0.5) * h * 0.12);
  g.closePath();
  g.fill();
  // brush marks
  for (let i = 0; i < 14; i++) {
    g.strokeStyle = `rgba(${rng() < 0.5 ? 170 : 200},${rng() < 0.5 ? 164 : 192},150,0.35)`;
    g.lineWidth = 1 + rng() * 3;
    const yy = y + rng() * h;
    g.beginPath();
    g.moveTo(x + rng() * w * 0.1, yy);
    g.lineTo(x + w - rng() * w * 0.1, yy + (rng() - 0.5) * 4);
    g.stroke();
  }
}

// ------------------------------------------------------------------------------------------------ pages

export interface PageOptions {
  pen?: PenStyle;
  /** Em size in px. */
  em?: number;
  margin?: number;
  lineGap?: number;
  ruled?: boolean;
  title?: string;
  seed?: number;
}

/** A handwritten page (reading overlay / letter / ledger): paper + wrapped text. */
export function drawPage(g: Ctx2D, w: number, h: number, text: string, o: PageOptions = {}): void {
  const rng = hashRng(o.seed ?? seedOf(text));
  const pen = o.pen ?? PENS.ink;
  const em = o.em ?? Math.round(h / 26);
  const margin = o.margin ?? Math.round(w * 0.08);
  const gap = (o.lineGap ?? 1.9) * em;
  paintPaper(g, w, h, rng);
  if (o.ruled) {
    g.strokeStyle = 'rgba(90,110,150,0.25)';
    g.lineWidth = 1;
    for (let y = margin + gap; y < h - margin * 0.5; y += gap) {
      g.beginPath();
      g.moveTo(0, y + em * 0.1);
      g.lineTo(w, y + em * 0.1);
      g.stroke();
    }
    g.strokeStyle = 'rgba(160,60,60,0.25)';
    g.beginPath();
    g.moveTo(margin * 0.8, 0);
    g.lineTo(margin * 0.8, h);
    g.stroke();
  }
  let y = margin + gap;
  const lines = wrap(text, pen, (w - margin * 2) / em);
  for (const line of lines) {
    if (y > h - margin * 0.4) break;
    if (line) drawText(g, line, margin + (rng() - 0.5) * em * 0.3, y, em, pen, rng);
    y += gap;
  }
}

export interface GuestRow {
  date: string;
  name: string;
  vehicle: string;
  ruled: boolean;
}

/** Guest-book page: header + rows, each in a DIFFERENT hand, ruled through when `ruled`. */
export function drawGuestBook(g: Ctx2D, w: number, h: number, rows: GuestRow[], o: { seed?: number; header?: boolean } = {}): void {
  const rng = hashRng(o.seed ?? 1976);
  paintPaper(g, w, h, rng, [218, 206, 176]);
  const n = Math.max(12, rows.length + (o.header === false ? 0 : 1));
  const gap = h / (n + 1.2);
  const em = gap * 0.62;
  // printed rules + columns
  g.strokeStyle = 'rgba(70,90,120,0.3)';
  g.lineWidth = 1;
  for (let i = 1; i <= n; i++) {
    g.beginPath();
    g.moveTo(w * 0.04, gap * i + gap * 0.25);
    g.lineTo(w * 0.96, gap * i + gap * 0.25);
    g.stroke();
  }
  const colDate = w * 0.05;
  const colName = w * 0.3;
  const colCar = w * 0.62;
  let row = 1;
  if (o.header !== false) {
    drawText(g, 'DATE', colDate, gap * row, em * 0.7, PENS.print, rng);
    drawText(g, 'NAME', colName, gap * row, em * 0.7, PENS.print, rng);
    drawText(g, 'VEHICLE', colCar, gap * row, em * 0.7, PENS.print, rng);
    row++;
  }
  const hands = [PENS.ink, PENS.pencil, PENS.ink, PENS.inkRed, PENS.pencil];
  for (const r of rows) {
    const y = gap * row;
    const pen = { ...hands[Math.floor(rng() * hands.length)] };
    pen.slant = (rng() - 0.3) * 0.4;
    pen.jitter = 0.015 + rng() * 0.03;
    // the date column is always the keeper's pencil
    if (r.date) drawText(g, r.date, colDate, y, em, PENS.pencil, rng);
    const nameW = r.name ? drawText(g, r.name, colName, y, em, pen, rng) : 0;
    const carW = r.vehicle ? drawText(g, r.vehicle, colCar, y, em * 0.9, pen, rng) : 0;
    if (r.ruled && (nameW || carW)) {
      // ruled through in the keeper's hand: one hard pencil line across name + vehicle
      g.strokeStyle = 'rgba(40,36,34,0.9)';
      g.lineWidth = Math.max(1.5, em * 0.07);
      g.beginPath();
      g.moveTo(colName - em * 0.2, y - em * 0.35 + (rng() - 0.5) * em * 0.1);
      g.lineTo(Math.max(colName + nameW, colCar + carW) + em * 0.3, y - em * 0.3 + (rng() - 0.5) * em * 0.15);
      g.stroke();
    }
    row++;
    if (row > n) break;
  }
}
