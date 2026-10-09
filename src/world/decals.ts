// Written/printed surfaces on props (docs/PROPS.md decal children: userData.decal / text / paintedOut /
// decal_size_m): every one is drawn at load with our own stroke font (src/render/handwriting.ts) into a
// CanvasTexture — sign faces, the ROOMS board, the VACANCY plate, plates, chalked cans, guest-book pages, the letter,
// the ticket, the photos. The decal mesh keeps its LightsNode (probe-lit like every prop).

import * as THREE from 'three/webgpu';
import { DOCUMENTS } from '../story/documents.ts';
import { paintGrimeAtlas } from '../materials/grime-atlas.ts';
import { PENS, drawGuestBook, drawPage, drawText, hashRng, measure, paintBoard, paintOut, paintPaper, paintTin, seedOf, type PenStyle } from '../render/handwriting.ts';

export interface DecalInfo {
  mesh: any;
  kind: string;
  text: string;
}

type Ctx2D = CanvasRenderingContext2D;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: Ctx2D } {
  const c = document.createElement('canvas');
  c.width = Math.max(16, Math.round(w));
  c.height = Math.max(16, Math.round(h));
  return { c, g: c.getContext('2d')! };
}

/** Pixel size for a decal of `m` metres (≈ ppm px/m, clamped). */
function px(sizeM: [number, number], ppm: number, max = 1024, min = 128): [number, number] {
  const a = sizeM[0] / Math.max(1e-3, sizeM[1]);
  let w = Math.min(max, Math.max(min, sizeM[0] * ppm));
  let h = w / a;
  if (h > max) {
    h = max;
    w = h * a;
  }
  return [Math.round(w), Math.round(Math.max(min / 4, h))];
}

/** Centred single line that fills the width (em fitted to the box). */
function fitLine(g: Ctx2D, text: string, w: number, h: number, pen: PenStyle, fill = 0.84, rng = hashRng(seedOf(text))): { x: number; em: number; y: number } {
  const emW = (w * fill) / Math.max(0.5, measure(text, pen));
  const em = Math.min(emW, h * 0.62);
  const tw = measure(text, pen) * em;
  const x = (w - tw) / 2;
  const y = h / 2 + em / 2;
  drawText(g, text, x, y, em, pen, rng);
  return { x, em, y };
}

function sizeOf(mesh: any, ud: any): [number, number] {
  if (Array.isArray(ud.decal_size_m)) return [Number(ud.decal_size_m[0]), Number(ud.decal_size_m[1])];
  mesh.geometry.computeBoundingBox();
  const s = mesh.geometry.boundingBox.getSize(new THREE.Vector3());
  const dims = [s.x, s.y, s.z].sort((a, b) => b - a);
  return [dims[0] || 0.2, dims[1] || 0.1];
}

/** Hero decal canvas cap (C1-OPENING §7.6): 2048 on Medium/Max, 1024 on Low (bindDecals sets it from the preset's
 *  anisotropy: Low 4, Medium 8, Max 16). */
let HERO_MAX = 2048;

/** Draw one decal; returns the canvas (or null for kinds left to other lanes). */
export function drawDecal(kind: string, ud: any, sizeM: [number, number], name = ''): HTMLCanvasElement | null {
  const text = String(ud.text ?? '');
  const rng = hashRng(seedOf(name + text));
  switch (kind) {
    case 'sign_painted': {
      const [w, h] = px(sizeM, 520);
      const { c, g } = canvas(w, h);
      paintBoard(g, w, h, rng);
      const pen = { ...PENS.brush, width: 0.15 };
      // border line
      g.strokeStyle = 'rgba(122,24,18,0.8)';
      g.lineWidth = h * 0.03;
      g.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12);
      const r = fitLine(g, text, w, h, pen, 0.86, rng);
      const out = String(ud.paintedOut ?? '');
      if (out) {
        const i = text.toUpperCase().indexOf(out.toUpperCase());
        if (i >= 0) {
          const x0 = r.x + measure(text.slice(0, i), pen) * r.em + (i > 0 ? pen.tracking * r.em : 0);
          const ww = measure(text.slice(i, i + out.length), pen) * r.em;
          paintOut(g, x0 - r.em * 0.12, r.y - r.em * 1.12, ww + r.em * 0.24, r.em * 1.3, rng);
        }
      }
      return c;
    }
    case 'hand_lettered': {
      const [w, h] = px(sizeM, 560);
      const { c, g } = canvas(w, h);
      paintBoard(g, w, h, rng, [196, 188, 164], [80, 70, 60]);
      fitLine(g, text, w, h, { ...PENS.brushBlack, slant: 0.06, jitter: 0.035 }, 0.8, rng);
      return c;
    }
    case 'stencil': {
      const [w, h] = px(sizeM, 900);
      const { c, g } = canvas(w, h);
      paintTin(g, w, h, rng);
      fitLine(g, text, w, h, PENS.stencil, 0.82, rng);
      return c;
    }
    case 'plate': {
      const [w, h] = px(sizeM, 1200, 512);
      const { c, g } = canvas(w, h);
      g.fillStyle = 'rgb(214,208,188)';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgb(40,50,90)';
      g.lineWidth = h * 0.05;
      g.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1);
      drawText(g, 'CO. RD. 9', w * 0.36, h * 0.2, h * 0.12, { ...PENS.print, color: 'rgb(40,50,90)' }, rng);
      fitLine(g, text, w, h, { ...PENS.print, color: 'rgb(34,44,86)', width: 0.12 }, 0.8, rng);
      paintGrime(g, w, h, rng, 0.25);
      return c;
    }
    case 'road_sign':
      return drawGuideSign(text, sizeM, rng, !!ud.retro);
    case 'county_shield':
      return drawCountyShield(text, sizeM, rng);
    case 'billboard':
      return drawBillboard(text, sizeM, rng);
    case 'road_map':
      return drawRoadMap(rng);
    case 'vfd': {
      const { c, g } = canvas(384, 96);
      drawVfd(g, 384, 96, 'FM  88.1');
      return c;
    }
    case 'price_dial': {
      const [w, h] = px(sizeM, 900, 512);
      const { c, g } = canvas(w, h);
      g.fillStyle = 'rgb(208,200,178)';
      g.fillRect(0, 0, w, h);
      drawText(g, 'PRICE PER GAL', w * 0.12, h * 0.26, h * 0.13, PENS.print, rng);
      const box = (x: number, y: number, s: string) => {
        g.fillStyle = 'rgb(30,28,26)';
        g.fillRect(x, y, w * 0.16, h * 0.34);
        drawText(g, s, x + w * 0.035, y + h * 0.29, h * 0.24, { ...PENS.print, color: 'rgb(220,214,196)' }, rng);
      };
      box(w * 0.14, h * 0.36, '5');
      box(w * 0.32, h * 0.36, '9');
      box(w * 0.5, h * 0.36, '9');
      drawText(g, '1976', w * 0.72, h * 0.62, h * 0.12, PENS.print, rng);
      paintGrime(g, w, h, rng, 0.35);
      return c;
    }
    case 'chalk': {
      const [w, h] = px(sizeM, 1400, 384);
      const { c, g } = canvas(w, h);
      g.fillStyle = 'rgb(58,62,46)';
      g.fillRect(0, 0, w, h);
      paintGrime(g, w, h, rng, 0.4);
      fitLine(g, text, w, h, PENS.chalk, 0.84, rng);
      return c;
    }
    case 'handwriting': {
      const page = String(ud.page ?? '');
      if (page === 'letter') {
        const { c, g } = canvas(360, 512);
        drawPage(g, 360, 512, DOCUMENTS.letter.text, { pen: PENS.ink, em: 15, lineGap: 1.75, seed: 76, paper: { age: 0.5, fold: 2, foxing: 10, seed: 761 } });
        return c;
      }
      const book = String(ud.text ?? '') === 'sting' ? DOCUMENTS.guest_book_sting : DOCUMENTS.guest_book;
      const rows = book.lines ?? [];
      const { c, g } = canvas(360, 512);
      // guest book: ~30 years in a hall drawer — age 0.7, heavier foxing (PROPS-FINISH §4.4)
      if (page === 'left') drawGuestBook(g, 360, 512, rows.slice(0, 6), { seed: 1977, paper: { age: 0.7, foxing: 22, seed: 1977 } });
      else drawGuestBook(g, 360, 512, rows.slice(6), { seed: 1978, header: false, paper: { age: 0.7, foxing: 22, seed: 1978 } });
      return c;
    }
    case 'photo':
      return drawPhoto(String(ud.photo ?? text), sizeM, rng);
    default:
      return null;
  }
}

// ------------------------------------------------------------------ County Road 9 (C1-OPENING §7.6)

/** A text run with the two marks the stroke font lacks: '·' (a round interpunct) and '½' (a built fraction). */
function signText(g: Ctx2D, text: string, x: number, y: number, em: number, pen: PenStyle, rng: () => number): number {
  let cx = x;
  for (const part of text.split(/([·½])/)) {
    if (!part) continue;
    if (part === '·') {
      g.fillStyle = pen.color;
      g.beginPath();
      g.arc(cx + em * 0.28, y - em * 0.42, em * pen.width * 0.75, 0, Math.PI * 2);
      g.fill();
      cx += em * 0.56 + pen.tracking * em;
    } else if (part === '½') {
      drawText(g, '1', cx, y - em * 0.42, em * 0.55, pen, rng);
      g.strokeStyle = pen.color;
      g.lineWidth = em * pen.width * 0.7;
      g.beginPath();
      g.moveTo(cx + em * 0.08, y - em * 0.02);
      g.lineTo(cx + em * 0.62, y - em * 0.92);
      g.stroke();
      drawText(g, '2', cx + em * 0.38, y, em * 0.55, pen, rng);
      cx += em * 0.95 + pen.tracking * em;
    } else cx = drawText(g, part, cx, y, em, pen, rng);
  }
  return cx;
}
const signMeasure = (text: string, pen: PenStyle): number =>
  text.split(/([·½])/).reduce((w, p) => w + (p === '·' ? 0.56 + pen.tracking : p === '½' ? 0.95 + pen.tracking : p ? measure(p, pen) + pen.tracking : 0), 0);

/** Rounded rectangle path. */
function rrect(g: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Vertical rust / water streaks running down from points (bolts, lamp brackets) along the top. */
function streaks(g: Ctx2D, w: number, h: number, rng: () => number, n: number, rgb: [number, number, number], amt: number, from = 0): void {
  for (let i = 0; i < n; i++) {
    const x = rng() * w;
    const len = h * (0.15 + rng() * 0.7);
    const wd = Math.max(1, w * (0.002 + rng() * 0.008));
    const y0 = from + rng() * h * 0.08;
    const grad = g.createLinearGradient(0, y0, 0, y0 + len);
    grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${amt * (0.5 + rng() * 0.5)})`);
    grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    g.fillStyle = grad;
    let x1 = x;
    for (let y = y0; y < y0 + len; y += h * 0.02) {
      x1 += (rng() - 0.5) * wd * 0.6;
      g.fillRect(x1 - wd / 2, y, wd, h * 0.022);
    }
  }
}

/**
 * MUTCD-style guide sign (D-series road-card): FHWA green ground (≈ 0.06 albedo), white legend + rounded border in
 * Series E-like stroke proportions, two lines ("NEXT SERVICES" / "48 MI"). 1990s engineering-grade sheeting: light
 * chalking, a few dents, dirt and moss along the bottom edge. The legend's retroreflection is a material term
 * (glimpses.ts), not painted in.
 */
function drawGuideSign(text: string, sizeM: [number, number], rng: () => number, hero: boolean): HTMLCanvasElement {
  const [w, h] = px(sizeM, hero ? 900 : 600, hero ? HERO_MAX : 1024);
  const { c, g } = canvas(w, h);
  g.fillStyle = 'rgb(18,72,44)';
  g.fillRect(0, 0, w, h);
  // sheeting texture: faint horizontal roll-banding + chalking
  for (let y = 0; y < h; y += 3) {
    g.fillStyle = `rgba(255,255,255,${0.012 + rng() * 0.018})`;
    g.fillRect(0, y, w, 1);
  }
  const white = 'rgb(232,234,226)';
  g.strokeStyle = white;
  g.lineWidth = h * 0.028;
  rrect(g, h * 0.045, h * 0.045, w - h * 0.09, h - h * 0.09, h * 0.08);
  g.stroke();
  const pen: PenStyle = { ...PENS.print, color: white, width: 0.15, tracking: 0.12 };
  const m = /^(.*?)(\s+\d+\s*MI)$/i.exec(text);
  const lines = m ? [m[1].trim(), m[2].trim()] : [text];
  const em = Math.min((h * 0.8) / (lines.length * 1.45), ...lines.map((l) => (w * 0.82) / Math.max(0.5, signMeasure(l, pen))));
  lines.forEach((l, i) => {
    const tw = signMeasure(l, pen) * em;
    const y = h / 2 + em / 2 + (i - (lines.length - 1) / 2) * em * 1.45;
    signText(g, l, (w - tw) / 2, y, em, pen, rng);
  });
  paintGrime(g, w, h, rng, 0.12);
  streaks(g, w, h, rng, 10, [60, 50, 30], 0.18);
  // moss / road film along the bottom edge
  const bot = g.createLinearGradient(0, h * 0.82, 0, h);
  bot.addColorStop(0, 'rgba(40,46,24,0)');
  bot.addColorStop(1, 'rgba(40,46,24,0.45)');
  g.fillStyle = bot;
  g.fillRect(0, h * 0.82, w, h * 0.18);
  return c;
}

/** County route marker (MUTCD M1-6): a blue pentagon, yellow border, "COUNTY" over a large route number. */
function drawCountyShield(text: string, sizeM: [number, number], rng: () => number): HTMLCanvasElement {
  const [w, h] = px(sizeM, 1100, 512, 192);
  const { c, g } = canvas(w, h);
  const [top, num] = text.split('|');
  g.fillStyle = 'rgb(24,24,22)';
  g.fillRect(0, 0, w, h);
  const pent = (inset: number) => {
    g.beginPath();
    g.moveTo(w * 0.12 + inset, inset);
    g.lineTo(w * 0.88 - inset, inset);
    g.lineTo(w - inset, h * 0.42);
    g.lineTo(w * 0.5, h - inset);
    g.lineTo(inset, h * 0.42);
    g.closePath();
  };
  const yel = 'rgb(228,178,40)';
  pent(0);
  g.fillStyle = yel;
  g.fill();
  pent(w * 0.05);
  g.fillStyle = 'rgb(22,52,120)';
  g.fill();
  const pen: PenStyle = { ...PENS.print, color: yel, width: 0.16, tracking: 0.08 };
  const e1 = (w * 0.62) / Math.max(0.5, measure(top ?? 'COUNTY', pen));
  drawText(g, top ?? 'COUNTY', (w - measure(top ?? 'COUNTY', pen) * e1) / 2, h * 0.15 + e1, e1, pen, rng);
  const e2 = Math.min(h * 0.42, (w * 0.5) / Math.max(0.3, measure(num ?? '9', pen)));
  drawText(g, num ?? '9', (w - measure(num ?? '9', pen) * e2) / 2, h * 0.36 + e2, e2, { ...pen, width: 0.2 }, rng);
  paintGrime(g, w, h, rng, 0.15);
  return c;
}

/**
 * The billboard face (P_RC9_BILLBOARD, 7.6 × 3.7 m; PROPS.md layers): plywood under two generations.
 *  - 1960s hand paint (the oldest, the house's own sign): cream ground, red brush "STROUD'S" and "ROOMS ½ MI" with a
 *    hand arrow — only where the paper has torn away; chalky, sun-bleached.
 *  - 1980s printed interstate poster pasted over it in sheets: faded blue sky band, the I-58 shield, "CARVEL EXIT 4",
 *    "EAT · SLEEP · GAS" — 15 Mississippi summers bleached the cyan + magenta inks (yellow survives longest), torn in
 *    ragged bands along the sheet seams (the 3-D peel strips hang from those tears).
 *  - weathering: rust streaks from the four gooseneck-lamp brackets and the bolts, water tide-lines, mildew low down.
 */
function drawBillboard(text: string, sizeM: [number, number], rng: () => number): HTMLCanvasElement {
  const [w, h] = px(sizeM, 300, HERO_MAX, 256);
  const { c, g } = canvas(w, h);
  const [poster, paint] = text.split('|');
  // plywood
  paintBoard(g, w, h, rng, [150, 140, 122], [86, 78, 66]);
  // 1960s paint layer
  g.fillStyle = 'rgba(214,204,178,0.94)';
  g.fillRect(w * 0.02, h * 0.04, w * 0.96, h * 0.92);
  const red: PenStyle = { ...PENS.brush, color: 'rgba(150,40,30,0.92)', width: 0.17, tracking: 0.12 };
  const words = (paint ?? "STROUD'S · ROOMS ½ MI").split('·').map((x) => x.trim());
  const e1 = Math.min(h * 0.3, (w * 0.62) / Math.max(0.5, signMeasure(words[0], red)));
  signText(g, words[0], w * 0.06, h * 0.08 + e1, e1, red, rng);
  const e2 = Math.min(h * 0.32, (w * 0.6) / Math.max(0.5, signMeasure(words[1] ?? '', red)));
  signText(g, words[1] ?? '', w * 0.3, h * 0.88, e2, { ...red, color: 'rgba(40,36,34,0.9)' }, rng);
  // the painted hand arrow, pointing west (left), down toward the house
  g.strokeStyle = 'rgba(150,40,30,0.85)';
  g.lineWidth = h * 0.05;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(w * 0.27, h * 0.72);
  g.lineTo(w * 0.07, h * 0.72);
  g.moveTo(w * 0.12, h * 0.62);
  g.lineTo(w * 0.06, h * 0.72);
  g.lineTo(w * 0.12, h * 0.82);
  g.stroke();
  // chalking of the old paint
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(230,224,206,${rng() * 0.12})`;
    g.fillRect(rng() * w, rng() * h, w * 0.01 * rng(), h * 0.01 * rng());
  }
  // 1980s poster on a separate canvas, then torn into the face
  const pc = canvas(w, h);
  const p = pc.g;
  const sky = p.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, 'rgb(150,176,184)'); // a faded cyan sky (cyan ink mostly gone)
  sky.addColorStop(0.62, 'rgb(196,200,186)');
  sky.addColorStop(1, 'rgb(184,170,130)');
  p.fillStyle = sky;
  p.fillRect(0, 0, w, h);
  // interstate shield
  const sx = w * 0.1;
  const sy = h * 0.14;
  const sw = h * 0.42;
  p.fillStyle = 'rgb(150,64,64)';
  p.fillRect(sx, sy, sw, sw * 0.22);
  p.fillStyle = 'rgb(56,76,120)';
  p.beginPath();
  p.moveTo(sx, sy + sw * 0.22);
  p.lineTo(sx + sw, sy + sw * 0.22);
  p.quadraticCurveTo(sx + sw, sy + sw * 0.95, sx + sw / 2, sy + sw * 1.1);
  p.quadraticCurveTo(sx, sy + sw * 0.95, sx, sy + sw * 0.22);
  p.fill();
  const wpen: PenStyle = { ...PENS.print, color: 'rgba(236,232,220,0.95)', width: 0.16, tracking: 0.1 };
  const segs = (poster ?? '58 · CARVEL EXIT 4 · EAT · SLEEP · GAS').split('·').map((x) => x.trim());
  drawText(p, segs[0] ?? '58', sx + sw * 0.18, sy + sw * 0.82, sw * 0.5, wpen, rng);
  const ink: PenStyle = { ...PENS.print, color: 'rgba(40,46,70,0.9)', width: 0.15, tracking: 0.1 };
  const head = segs.slice(1, 3).join(' ');
  const eh = Math.min(h * 0.2, (w * 0.5) / Math.max(0.5, measure(head, ink)));
  drawText(p, head, w * 0.42, h * 0.36, eh, ink, rng);
  const sub = segs.slice(3).join(' · ');
  const es = Math.min(h * 0.14, (w * 0.5) / Math.max(0.5, signMeasure(sub, ink)));
  signText(p, sub, w * 0.42, h * 0.58, es, { ...ink, color: 'rgba(150,60,40,0.85)' }, rng);
  // fade + sheet seams (a 6 × 3 grid of paper sheets)
  p.fillStyle = 'rgba(210,206,190,0.35)';
  p.fillRect(0, 0, w, h);
  p.strokeStyle = 'rgba(90,90,80,0.35)';
  p.lineWidth = Math.max(1, w * 0.0012);
  for (let i = 1; i < 6; i++) {
    p.beginPath();
    p.moveTo((w * i) / 6, 0);
    p.lineTo((w * i) / 6, h);
    p.stroke();
  }
  for (let j = 1; j < 3; j++) {
    p.beginPath();
    p.moveTo(0, (h * j) / 3);
    p.lineTo(w, (h * j) / 3);
    p.stroke();
  }
  // tear the poster: ragged holes concentrated along the seams and the lower-right (where "STROUD'S"/"ROOMS" show)
  p.globalCompositeOperation = 'destination-out';
  const tear = (cx: number, cy: number, rw: number, rh: number) => {
    p.beginPath();
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const k = 0.6 + rng() * 0.55;
      p.lineTo(cx + Math.cos(a) * rw * k, cy + Math.sin(a) * rh * k);
    }
    p.closePath();
    p.fill();
  };
  tear(w * 0.2, h * 0.24, w * 0.12, h * 0.12); // "STROUD'S" shows through top-left (the poster's shield edge torn)
  tear(w * 0.36, h * 0.16, w * 0.09, h * 0.1);
  tear(w * 0.55, h * 0.8, w * 0.22, h * 0.14); // "ROOMS ½ MI" along the bottom
  tear(w * 0.84, h * 0.84, w * 0.12, h * 0.12);
  tear(w * 0.14, h * 0.74, w * 0.1, h * 0.12); // the arrow
  for (let i = 0; i < 9; i++) tear(((1 + Math.floor(rng() * 5)) * w) / 6 + (rng() - 0.5) * w * 0.03, rng() * h, w * 0.025, h * (0.08 + rng() * 0.18));
  p.globalCompositeOperation = 'source-over';
  // the paper's torn edges curl: a pale fibre rim + a shadow on the paint (drawn on the face below the poster)
  g.save();
  g.shadowColor = 'rgba(20,16,12,0.55)';
  g.shadowBlur = w * 0.004;
  g.shadowOffsetY = w * 0.002;
  g.drawImage(pc.c, 0, 0);
  g.restore();
  // weathering over everything: rust from the 4 lamp brackets + bolts, tide-lines, mildew low down
  for (let i = 0; i < 4; i++) {
    const x = w * (0.14 + i * 0.24);
    g.save();
    g.translate(x - w * 0.5, 0);
    streaks(g, w, h, rng, 3, [120, 60, 28], 0.55);
    g.restore();
  }
  streaks(g, w, h, rng, 26, [96, 70, 50], 0.22);
  const mil = g.createLinearGradient(0, h * 0.7, 0, h);
  mil.addColorStop(0, 'rgba(46,52,36,0)');
  mil.addColorStop(1, 'rgba(46,52,36,0.5)');
  g.fillStyle = mil;
  g.fillRect(0, h * 0.7, w, h * 0.3);
  paintGrime(g, w, h, rng, 0.25);
  return c;
}

/**
 * The radio's vacuum-fluorescent display (sedan_interior v2 `-radio_vfd`, 60 × 14 mm): blue-green phosphor segments
 * on black glass, the unlit segments faintly visible (the classic VFD ghost). Redrawn live while the radio seeks.
 * The canvas is the emissive map (bindDecals); its luminance is set by the material.
 */
export function drawVfd(g: Ctx2D, w: number, h: number, text: string): void {
  g.fillStyle = 'rgb(4,8,8)';
  g.fillRect(0, 0, w, h);
  const em = h * 0.62;
  const pen: PenStyle = { ...PENS.print, color: 'rgba(80,255,210,0.07)', width: 0.12, tracking: 0.22 };
  const ghost = '888.8'.padStart(text.length, ' ');
  const tw = measure(ghost, pen) * em;
  drawText(g, text.replace(/[0-9]/g, '8').replace(/[A-Z]/g, ' '), w - tw - w * 0.06, h * 0.82, em, pen, () => 0.5);
  drawText(g, text, w * 0.06, h * 0.82, em, { ...pen, color: 'rgba(110,255,220,0.95)' }, () => 0.5);
  // the phosphor grid mesh in front of the segments
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let x = 0; x < w; x += 3) g.fillRect(x, 0, 1, h);
}

/**
 * The County Road 9 road map (C1-OPENING §7.10; sedan_interior `-map_folded/_open`, decal `road_map`, UV = the full
 * sheet, the folded cover = u 0.5..1, v 0.75..1 — glTF v runs down the canvas). 2048² on Medium/Max, 1024² on Low.
 * Aged off-white paper (albedo ≈ 0.75) with fold-crease shading on a 4 × 4 panel fold; state-forest green fills; the
 * I-58 red double line and the CARVEL town dot; County Road 9 as a thin black wandering line; two red junction dots
 * with a red 48 between them; legend box, scale bar, compass rose; the driver's ballpoint X and arrow. No real place
 * names besides the game's own.
 */
function drawRoadMap(rng: () => number): HTMLCanvasElement {
  const n = HERO_MAX;
  const { c, g } = canvas(n, n);
  const k = n / 2048;
  paintPaper(g, n, n, rng, [226, 220, 202]);
  // the inside (u 0..1, v 0..0.75): the map proper
  const mh = n * 0.75;
  // state forest fills (soft green blobs), lakes
  for (let i = 0; i < 26; i++) {
    const x = rng() * n;
    const y = rng() * mh;
    const r = (60 + rng() * 260) * k;
    g.fillStyle = `rgba(140,172,120,${0.35 + rng() * 0.2})`;
    g.beginPath();
    for (let a = 0; a < 14; a++) {
      const t = (a / 14) * Math.PI * 2;
      const rr = r * (0.7 + rng() * 0.5);
      g.lineTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr * 0.8);
    }
    g.closePath();
    g.fill();
  }
  for (let i = 0; i < 5; i++) {
    g.fillStyle = 'rgba(150,180,200,0.7)';
    g.beginPath();
    g.ellipse(rng() * n, rng() * mh, (20 + rng() * 50) * k, (10 + rng() * 30) * k, rng() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // minor county roads: thin grey
  g.strokeStyle = 'rgba(90,86,80,0.55)';
  g.lineWidth = 2 * k;
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    let x = rng() * n;
    let y = rng() * mh;
    g.moveTo(x, y);
    for (let j = 0; j < 6; j++) {
      x += (rng() - 0.5) * 360 * k;
      y += (rng() - 0.5) * 360 * k;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // I-58: red double line across the top third, CARVEL town dot + label, EXIT 4 shield
  const iy = (x: number) => mh * 0.2 + Math.sin(x / n * 3.1) * 40 * k;
  for (const off of [-5 * k, 5 * k]) {
    g.strokeStyle = 'rgba(176,40,34,0.9)';
    g.lineWidth = 4 * k;
    g.beginPath();
    for (let x = 0; x <= n; x += 16) g.lineTo(x, iy(x) + off);
    g.stroke();
  }
  const carvel: [number, number] = [n * 0.72, iy(n * 0.72)];
  g.fillStyle = 'rgba(30,28,26,0.9)';
  g.beginPath();
  g.arc(carvel[0], carvel[1] - 30 * k, 16 * k, 0, Math.PI * 2);
  g.fill();
  drawText(g, 'CARVEL', carvel[0] + 26 * k, carvel[1] - 44 * k, 40 * k, PENS.print, rng);
  drawText(g, '58', n * 0.3, iy(n * 0.3) - 30 * k, 34 * k, { ...PENS.print, color: 'rgba(40,60,120,0.9)' }, rng);
  // County Road 9: a thin black wandering line from the interstate junction down to the second junction
  const j1: [number, number] = [n * 0.66, iy(n * 0.66) + 2 * k];
  const j2: [number, number] = [n * 0.22, mh * 0.86];
  g.strokeStyle = 'rgba(24,22,20,0.92)';
  g.lineWidth = 2.6 * k;
  g.beginPath();
  g.moveTo(j1[0], j1[1]);
  let x = j1[0];
  let y = j1[1];
  const pts: Array<[number, number]> = [];
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    x = j1[0] + (j2[0] - j1[0]) * t + Math.sin(t * 11 + 1.3) * 60 * k + (rng() - 0.5) * 18 * k;
    y = j1[1] + (j2[1] - j1[1]) * t + Math.cos(t * 7) * 30 * k;
    pts.push([x, y]);
    g.lineTo(x, y);
  }
  g.stroke();
  drawText(g, '9', pts[9][0] + 18 * k, pts[9][1], 30 * k, PENS.print, rng);
  // the two red junction dots and the red 48 between them (printed mileage)
  for (const p of [j1, j2]) {
    g.fillStyle = 'rgba(190,36,30,0.95)';
    g.beginPath();
    g.arc(p[0], p[1], 11 * k, 0, Math.PI * 2);
    g.fill();
  }
  const mid = pts[12];
  drawText(g, '48', mid[0] + 26 * k, mid[1] + 12 * k, 44 * k, { ...PENS.print, color: 'rgba(190,36,30,0.95)', width: 0.12 }, rng);
  // legend box, scale bar, compass rose (bottom-left of the inside)
  g.strokeStyle = 'rgba(40,38,34,0.8)';
  g.lineWidth = 2 * k;
  g.strokeRect(n * 0.04, mh * 0.62, n * 0.2, mh * 0.18);
  drawText(g, 'LEGEND', n * 0.055, mh * 0.66, 24 * k, PENS.print, rng);
  const leg = [
    ['rgba(176,40,34,0.9)', 'INTERSTATE'],
    ['rgba(24,22,20,0.9)', 'COUNTY ROAD'],
    ['rgba(140,172,120,0.9)', 'STATE FOREST'],
  ];
  leg.forEach(([col, lab], i) => {
    g.fillStyle = col;
    g.fillRect(n * 0.055, mh * (0.69 + i * 0.035), 40 * k, 10 * k);
    drawText(g, lab, n * 0.055 + 52 * k, mh * (0.69 + i * 0.035) + 12 * k, 18 * k, PENS.print, rng);
  });
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? 'rgba(240,236,224,1)' : 'rgba(30,28,26,0.9)';
    g.fillRect(n * 0.3 + i * 60 * k, mh * 0.9, 60 * k, 10 * k);
  }
  g.strokeRect(n * 0.3, mh * 0.9, 240 * k, 10 * k);
  drawText(g, '0      5      10 MI', n * 0.3, mh * 0.9 + 40 * k, 18 * k, PENS.print, rng);
  const cx = n * 0.9;
  const cy = mh * 0.84;
  g.fillStyle = 'rgba(30,28,26,0.85)';
  g.beginPath();
  g.moveTo(cx, cy - 70 * k);
  g.lineTo(cx + 14 * k, cy);
  g.lineTo(cx - 14 * k, cy);
  g.closePath();
  g.fill();
  drawText(g, 'N', cx - 10 * k, cy - 80 * k, 28 * k, PENS.print, rng);
  // the driver's ballpoint: an X on the second junction, an arrow down CR 9, "48?" scribbled
  const pen = { ...PENS.ink, color: 'rgba(28,30,80,0.9)', width: 0.08 };
  g.strokeStyle = pen.color;
  g.lineWidth = 4 * k;
  g.beginPath();
  g.moveTo(j2[0] - 22 * k, j2[1] - 22 * k);
  g.lineTo(j2[0] + 22 * k, j2[1] + 24 * k);
  g.moveTo(j2[0] + 24 * k, j2[1] - 20 * k);
  g.lineTo(j2[0] - 20 * k, j2[1] + 22 * k);
  g.stroke();
  const a0 = pts[4];
  const a1 = pts[8];
  g.beginPath();
  g.moveTo(a0[0] + 50 * k, a0[1]);
  g.quadraticCurveTo(a1[0] + 90 * k, (a0[1] + a1[1]) / 2, a1[0] + 50 * k, a1[1]);
  g.lineTo(a1[0] + 66 * k, a1[1] - 22 * k);
  g.moveTo(a1[0] + 50 * k, a1[1]);
  g.lineTo(a1[0] + 26 * k, a1[1] - 14 * k);
  g.stroke();
  drawText(g, 'gas?', a1[0] + 80 * k, a1[1] + 10 * k, 30 * k, pen, rng);
  // the cover (u 0.5..1, v 0.75..1): the state's road map, a printed band and a photo-ish plate
  g.fillStyle = 'rgb(196,186,150)';
  g.fillRect(n * 0.5, mh, n * 0.5, n - mh);
  g.fillStyle = 'rgb(46,88,62)';
  g.fillRect(n * 0.5, mh, n * 0.5, (n - mh) * 0.34);
  drawText(g, 'OFFICIAL', n * 0.53, mh + 70 * k, 48 * k, { ...PENS.print, color: 'rgb(232,226,204)' }, rng);
  drawText(g, 'HIGHWAY MAP', n * 0.53, mh + 140 * k, 56 * k, { ...PENS.print, color: 'rgb(232,226,204)' }, rng);
  drawText(g, 'CARVEL COUNTY  1988', n * 0.53, mh + 260 * k, 34 * k, PENS.print, rng);
  // fold creases: 4 × 4 panels (light ridge + dark valley), wear along the folds, coffee ring
  for (let i = 1; i < 4; i++) {
    for (const [x0, y0, x1, y1] of [
      [(n * i) / 4, 0, (n * i) / 4, n],
      [0, (n * i) / 4, n, (n * i) / 4],
    ] as const) {
      g.strokeStyle = 'rgba(80,70,56,0.28)';
      g.lineWidth = 5 * k;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      g.strokeStyle = 'rgba(255,252,240,0.4)';
      g.lineWidth = 2 * k;
      g.beginPath();
      g.moveTo(x0 + 4 * k, y0 + 4 * k);
      g.lineTo(x1 + 4 * k, y1 + 4 * k);
      g.stroke();
    }
  }
  g.strokeStyle = 'rgba(120,80,40,0.25)';
  g.lineWidth = 9 * k;
  g.beginPath();
  g.arc(n * 0.82, mh * 0.5, 70 * k, 0.3, 5.6);
  g.stroke();
  paintGrime(g, n, n, rng, 0.08);
  return c;
}

function paintGrime(g: Ctx2D, w: number, h: number, rng: () => number, amt: number): void {
  for (let i = 0; i < 24; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = (0.05 + rng() * 0.25) * Math.max(w, h);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(40,30,20,${amt * (0.3 + rng() * 0.4)})`);
    grad.addColorStop(1, 'rgba(40,30,20,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** Procedural sepia photographs: figures as soft silhouettes, the man's face knifed out. */
function drawPhoto(kind: string, sizeM: [number, number], rng: () => number): HTMLCanvasElement {
  const [w, h] = px(sizeM, 1600, 512, 192);
  const { c, g } = canvas(w, h);
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, 'rgb(170,150,118)');
  bg.addColorStop(1, 'rgb(96,80,60)');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  const figure = (cx: number, top: number, s: number, tone: string, veil: boolean) => {
    g.fillStyle = tone;
    g.beginPath();
    g.ellipse(cx, top + s * 0.12, s * 0.09, s * 0.11, 0, 0, Math.PI * 2); // head
    g.fill();
    g.beginPath();
    g.moveTo(cx - s * 0.1, top + s * 0.24);
    g.quadraticCurveTo(cx - s * 0.28, top + s * 0.7, cx - s * (veil ? 0.34 : 0.2), top + s);
    g.lineTo(cx + s * (veil ? 0.34 : 0.2), top + s);
    g.quadraticCurveTo(cx + s * 0.28, top + s * 0.7, cx + s * 0.1, top + s * 0.24);
    g.closePath();
    g.fill();
    if (veil) {
      g.fillStyle = 'rgba(236,228,210,0.55)';
      g.beginPath();
      g.moveTo(cx, top - s * 0.02);
      g.quadraticCurveTo(cx - s * 0.3, top + s * 0.3, cx - s * 0.26, top + s * 0.6);
      g.lineTo(cx + s * 0.26, top + s * 0.6);
      g.quadraticCurveTo(cx + s * 0.3, top + s * 0.3, cx, top - s * 0.02);
      g.fill();
    }
  };
  const knife = (cx: number, cy: number, r: number) => {
    g.fillStyle = 'rgb(18,14,12)';
    g.beginPath();
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.75 + rng() * 0.5);
      g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(230,220,200,0.6)';
    g.lineWidth = 1;
    g.stroke();
  };
  if (kind.startsWith('wedding')) {
    figure(w * 0.36, h * 0.2, h * 0.8, 'rgb(226,216,196)', true);
    figure(w * 0.64, h * 0.16, h * 0.84, 'rgb(40,34,30)', false);
    knife(w * 0.64, h * 0.16 + h * 0.84 * 0.12, h * 0.1);
  } else if (kind.startsWith('pump')) {
    g.fillStyle = 'rgb(70,60,48)';
    g.fillRect(w * 0.06, h * 0.3, w * 0.16, h * 0.62); // the pump
    g.fillStyle = 'rgb(200,190,164)';
    g.fillRect(w * 0.03, h * 0.08, w * 0.94, h * 0.14); // the sign
    drawText(g, "STROUD'S GAS & FEED", w * 0.08, h * 0.19, h * 0.08, { ...PENS.print, color: 'rgb(60,40,30)' }, rng);
    figure(w * 0.46, h * 0.3, h * 0.66, 'rgb(190,178,150)', false);
    figure(w * 0.72, h * 0.26, h * 0.7, 'rgb(44,38,32)', false);
    knife(w * 0.72, h * 0.26 + h * 0.7 * 0.12, h * 0.085);
  } else {
    // locket: one bloomed face, silver-sulphided
    g.fillStyle = 'rgb(120,110,96)';
    g.fillRect(0, 0, w, h);
    figure(w * 0.5, h * 0.12, h * 1.1, 'rgb(60,52,44)', false);
  }
  // age: vignette, scratches, silvering
  const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(30,20,10,0.6)');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 30; i++) {
    g.strokeStyle = `rgba(240,230,210,${0.1 + rng() * 0.2})`;
    g.lineWidth = 0.6;
    g.beginPath();
    const x = rng() * w;
    const y = rng() * h;
    g.moveTo(x, y);
    g.lineTo(x + (rng() - 0.5) * w * 0.3, y + (rng() - 0.5) * h * 0.3);
    g.stroke();
  }
  return c;
}

/** Replace every decal mesh's material under `root` with a drawn CanvasTexture. Returns what was drawn. */
export function bindDecals(root: any, o: { anisotropy?: number } = {}): DecalInfo[] {
  const done: DecalInfo[] = [];
  const meshes: any[] = [];
  HERO_MAX = (o.anisotropy ?? 8) >= 8 ? 2048 : 1024;
  root.traverse((n: any) => {
    const ud = n.userData ?? {};
    if (n.isMesh && (ud.decal || ud.print === 'ticket')) meshes.push(n);
  });
  for (const mesh of meshes) {
    const ud = mesh.userData;
    const kind = ud.print === 'ticket' ? 'ticket' : String(ud.decal);
    if (kind === 'grime') {
      // PROPS-FINISH §4.2: one shared atlas material for every grime quad (rings, wax, soot, rust runs, smudges)
      mesh.material = grimeMaterial(mesh.material, o.anisotropy ?? 4);
      mesh.renderOrder = 1;
      done.push({ mesh, kind, text: '' });
      continue;
    }
    let cv: HTMLCanvasElement | null;
    if (kind === 'ticket') {
      const { c, g } = canvas(512, 256);
      const rng = hashRng(1976);
      paintPaper(g, 512, 256, rng, [200, 176, 150], { age: 0.3, foxing: 4, seed: 1976 });
      drawText(g, 'CARVEL', 40, 90, 50, PENS.print, rng);
      drawText(g, String(ud.text ?? '').replace(/^CARVEL\s*/, ''), 40, 170, 30, PENS.print, rng);
      drawText(g, 'ONE WAY', 330, 90, 26, { ...PENS.print, color: 'rgba(120,30,30,0.9)' }, rng);
      cv = c;
    } else cv = drawDecal(kind, ud, sizeOf(mesh, ud), mesh.name);
    if (!cv) continue;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false; // glTF UV convention (v down)
    tex.anisotropy = o.anisotropy ?? 4;
    tex.needsUpdate = true;
    const old = mesh.material;
    const m = new THREE.MeshStandardNodeMaterial({ map: tex, roughness: kind === 'stencil' || kind === 'plate' ? 0.55 : 0.88, metalness: 0 });
    m.name = `decal_${kind}`;
    m.side = old?.side ?? THREE.FrontSide;
    if (kind === 'photo') m.roughness = 0.35;
    if (kind === 'vfd') {
      // a dimmed-for-night VFD ≈ 15 cd/m² (full brightness 300–700; the dash dimmer at night ≈ 3–5 %)
      m.map = null;
      m.color.setRGB(0, 0, 0);
      m.emissiveMap = tex;
      m.emissive.setRGB(1, 1, 1);
      m.emissiveIntensity = 15;
      m.roughness = 0.15;
    }
    if (kind === 'road_map') m.roughness = 0.92;
    if (old?.lightsNode) m.lightsNode = old.lightsNode;
    // decals sit a hair above their base surface: avoid z-fighting
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -2;
    mesh.material = m;
    done.push({ mesh, kind, text: String(ud.text ?? '') });
  }
  return done;
}

let GRIME_MAT: any = null;
/** The session's grime decal material: atlas colour + alpha, per-cell roughness, blended over the prop, no depth write. */
function grimeMaterial(old: any, anisotropy: number): any {
  if (GRIME_MAT) return GRIME_MAT;
  const n = anisotropy >= 8 ? 1024 : 512; // 512² on Low (anisotropy 4)
  const a = canvas(n, n);
  const r = canvas(n, n);
  paintGrimeAtlas(a.g, r.g, n);
  const map = new THREE.CanvasTexture(a.c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false;
  map.anisotropy = anisotropy;
  const rough = new THREE.CanvasTexture(r.c);
  rough.flipY = false;
  const m = new THREE.MeshStandardNodeMaterial({ map, roughnessMap: rough, roughness: 1, metalness: 0, transparent: true, depthWrite: false });
  m.name = 'decal_grime';
  m.side = old?.side ?? THREE.FrontSide;
  if (old?.lightsNode) m.lightsNode = old.lightsNode;
  m.polygonOffset = true;
  m.polygonOffsetFactor = -1;
  m.polygonOffsetUnits = -2;
  GRIME_MAT = m;
  return m;
}

/** Redraw the guest-book pages for the sting (C7 / debug). */
export function setGuestBookState(root: any, state: 'tonight_blank' | 'sting'): void {
  root.traverse((n: any) => {
    const ud = n.userData ?? {};
    if (!n.isMesh || ud.decal !== 'handwriting' || (ud.page !== 'left' && ud.page !== 'right')) return;
    const cv = drawDecal('handwriting', { ...ud, text: state }, [0.25, 0.35], n.name);
    if (cv && n.material?.map) {
      n.material.map.image = cv;
      n.material.map.needsUpdate = true;
    }
  });
}
