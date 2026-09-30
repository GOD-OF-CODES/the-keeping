// Written/printed surfaces on props (docs/PROPS.md decal children: userData.decal / text / paintedOut /
// decal_size_m): every one is drawn at load with our own stroke font (src/render/handwriting.ts) into a
// CanvasTexture — sign faces, the ROOMS board, the VACANCY plate, plates, chalked cans, guest-book pages, the letter,
// the ticket, the photos. The decal mesh keeps its LightsNode (probe-lit like every prop).

import * as THREE from 'three/webgpu';
import { DOCUMENTS } from '../story/documents.ts';
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
    case 'road_sign': {
      const [w, h] = px(sizeM, 600);
      const { c, g } = canvas(w, h);
      g.fillStyle = 'rgb(28,70,46)';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgb(220,224,214)';
      g.lineWidth = h * 0.03;
      g.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1);
      fitLine(g, text, w, h, { ...PENS.print, color: 'rgb(226,230,220)' }, 0.86, rng);
      paintGrime(g, w, h, rng, 0.2);
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
        drawPage(g, 360, 512, DOCUMENTS.letter.text, { pen: PENS.ink, em: 15, lineGap: 1.75, seed: 76 });
        return c;
      }
      const book = String(ud.text ?? '') === 'sting' ? DOCUMENTS.guest_book_sting : DOCUMENTS.guest_book;
      const rows = book.lines ?? [];
      const { c, g } = canvas(360, 512);
      if (page === 'left') drawGuestBook(g, 360, 512, rows.slice(0, 6), { seed: 1977 });
      else drawGuestBook(g, 360, 512, rows.slice(6), { seed: 1978, header: false });
      return c;
    }
    case 'photo':
      return drawPhoto(String(ud.photo ?? text), sizeM, rng);
    default:
      return null;
  }
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
  root.traverse((n: any) => {
    const ud = n.userData ?? {};
    if (n.isMesh && (ud.decal || ud.print === 'ticket')) meshes.push(n);
  });
  for (const mesh of meshes) {
    const ud = mesh.userData;
    const kind = ud.print === 'ticket' ? 'ticket' : String(ud.decal);
    let cv: HTMLCanvasElement | null;
    if (kind === 'ticket') {
      const { c, g } = canvas(512, 256);
      const rng = hashRng(1976);
      paintPaper(g, 512, 256, rng, [200, 176, 150]);
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
