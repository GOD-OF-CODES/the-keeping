// Grime decal atlas (docs/PROPS-FINISH.md §4.2–4.3): one 4×4 atlas painted procedurally once per session (no
// downloaded art). Blender's kit.grime() quads map cell = row*4 + col with v up (Blender) → glTF flips v, and the
// CanvasTexture uses flipY = false, so Blender row r lands at canvas rows (3 − r). Two canvases: colour + alpha
// (sRGB) and roughness (linear, read from G by three's roughnessMap).

type Ctx2D = CanvasRenderingContext2D;

/** Per-cell kind and physical numbers (albedo sRGB 0..255 for the canvas, roughness 0..1). */
export const GRIME_CELLS = [
  { cell: 0, kind: 'ring_blush', rough: 0.55, note: 'water ring, white blush in shellac: Ø 65–85 mm glass base, ring 2–4 mm' },
  { cell: 1, kind: 'ring_blush', rough: 0.55, note: 'second blush ring variant' },
  { cell: 2, kind: 'ring_dark', rough: 0.45, note: 'water through the finish: dark tide line' },
  { cell: 3, kind: 'wax', rough: 0.35, note: 'paraffin drips 5–25 mm, warm white 0.75' },
  { cell: 4, kind: 'wax', rough: 0.35, note: 'wax drip variant' },
  { cell: 5, kind: 'soot', rough: 0.95, note: 'candle/kerosene soot plume 30–80 mm wide, falls off upward over 100–200 mm, albedo 0.03' },
  { cell: 6, kind: 'rust_streak', rough: 0.85, note: 'rust run from a fastener 50–300 mm, 3–8 mm wide, (0.29, 0.13, 0.06)' },
  { cell: 7, kind: 'rust_streak', rough: 0.85, note: 'rust run variant' },
  { cell: 8, kind: 'can_ring', rough: 0.8, note: 'jerry-can footprint rust ring (340 × 165 mm rounded rect)' },
  { cell: 9, kind: 'finger', rough: 0.4, note: 'oily finger grime 20–40 mm round a knob or pull ×0.75' },
  { cell: 10, kind: 'desilver', rough: 0.6, note: 'mirror desilvering blooms from the edge 10–60 mm, albedo 0.05' },
  { cell: 11, kind: 'ink', rough: 0.85, note: 'ink / tea stain with a tide rim (0.45, 0.32, 0.18)' },
] as const;

/** Canvas rectangle [x, y, size] of a cell in an N×N atlas (see the header for the v flip). */
export function cellRect(cell: number, n: number): [number, number, number] {
  const s = n / 4;
  const col = cell % 4;
  const row = Math.floor(cell / 4);
  return [col * s, (3 - row) * s, s];
}

function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linear 0..1 → sRGB byte (canvas colours are sRGB). */
function sb(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, c)) * 255);
}
const rgba = (lin: [number, number, number], a: number): string => `rgba(${sb(lin[0])},${sb(lin[1])},${sb(lin[2])},${a.toFixed(3)})`;

function blob(g: Ctx2D, x: number, y: number, r: number, inner: string, outer: string): void {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, inner);
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

/** A wobbly ring (tide line): radius R, width w, broken in places. */
function ring(g: Ctx2D, cx: number, cy: number, R: number, w: number, col: [number, number, number], a: number, r: () => number): void {
  const n = 96;
  const ph = r() * 6.28;
  for (let i = 0; i < n; i++) {
    const t0 = (i / n) * Math.PI * 2;
    const t1 = ((i + 1.2) / n) * Math.PI * 2;
    const k = 0.55 + 0.45 * Math.sin(t0 * 3 + ph) * Math.sin(t0 * 7 + ph * 2);
    const rr = R * (1 + 0.012 * Math.sin(t0 * 5 + ph));
    g.strokeStyle = rgba(col, a * Math.max(0, k));
    g.lineWidth = w * (0.6 + 0.6 * r());
    g.beginPath();
    g.arc(cx, cy, rr, t0, t1);
    g.stroke();
  }
}

function paintCell(g: Ctx2D, gr: Ctx2D, cell: (typeof GRIME_CELLS)[number], n: number): void {
  const [x0, y0, s] = cellRect(cell.cell, n);
  const r = rngOf(9100 + cell.cell * 37);
  g.save();
  gr.save();
  g.beginPath();
  g.rect(x0, y0, s, s);
  g.clip();
  const cx = x0 + s / 2;
  const cy = y0 + s / 2;
  switch (cell.kind) {
    case 'ring_blush': {
      // the cell spans the ring diameter + margin: ring 3 mm on a 75 mm glass ≈ 0.04 of the radius
      const R = s * 0.4;
      ring(g, cx, cy, R, s * 0.025, [0.62, 0.6, 0.56], 0.5, r);
      blob(g, cx, cy, R * 1.02, 'rgba(200,196,188,0.10)', 'rgba(200,196,188,0)');
      if (cell.cell === 1) ring(g, cx + s * 0.08, cy - s * 0.05, R * 0.95, s * 0.018, [0.6, 0.58, 0.55], 0.35, r);
      break;
    }
    case 'ring_dark':
      ring(g, cx, cy, s * 0.4, s * 0.03, [0.03, 0.02, 0.012], 0.45, r);
      blob(g, cx, cy, s * 0.4, 'rgba(20,12,6,0.18)', 'rgba(20,12,6,0)');
      break;
    case 'wax': {
      // a few overlapping round drips, crisp edges (wax freezes fast), warm white 0.75
      for (let i = 0; i < 5 + Math.floor(r() * 4); i++) {
        const x = cx + (r() - 0.5) * s * 0.55;
        const y = cy + (r() - 0.5) * s * 0.55;
        const rad = s * (0.05 + r() * 0.12);
        g.fillStyle = rgba([0.75, 0.72, 0.62], 0.9);
        g.beginPath();
        g.ellipse(x, y, rad, rad * (0.8 + r() * 0.4), r() * 3, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = rgba([0.55, 0.52, 0.44], 0.5);
        g.lineWidth = Math.max(1, s * 0.006);
        g.stroke();
      }
      break;
    }
    case 'soot': {
      // plume: dense at the bottom centre (flame), widening and fading upward (canvas up = world up)
      for (let i = 0; i < 40; i++) {
        const t = i / 39; // 0 bottom → 1 top
        const y = y0 + s * (0.95 - t * 0.85);
        const w = s * (0.12 + t * 0.32);
        const x = cx + (r() - 0.5) * s * 0.06 * (1 + t * 2);
        blob(g, x, y, w, rgba([0.03, 0.028, 0.025], 0.16 * (1 - t) ** 1.3), 'rgba(8,8,8,0)');
      }
      break;
    }
    case 'rust_streak': {
      // a run from a fastener at the top, 3–8 mm wide (cell ≈ 300 mm tall), fading and narrowing downward
      const x = cx + (r() - 0.5) * s * 0.2;
      blob(g, x, y0 + s * 0.08, s * 0.05, rgba([0.2, 0.08, 0.035], 0.9), 'rgba(80,30,10,0)');
      for (let i = 0; i < 60; i++) {
        const t = i / 59;
        const y = y0 + s * (0.08 + t * 0.88);
        const w = s * (0.022 - t * 0.012) * (0.7 + r() * 0.6);
        g.fillStyle = rgba([0.29, 0.13, 0.06], 0.75 * (1 - t) ** 0.8);
        g.fillRect(x - w / 2 + Math.sin(t * 9 + r()) * s * 0.01, y, w, s / 59 + 1);
      }
      break;
    }
    case 'can_ring': {
      g.strokeStyle = rgba([0.25, 0.11, 0.05], 0.55);
      g.lineWidth = s * 0.035;
      const w = s * 0.86;
      const h = w * (165 / 340);
      g.beginPath();
      g.roundRect(cx - w / 2, cy - h / 2, w, h, s * 0.05);
      g.stroke();
      blob(g, cx, cy, s * 0.4, 'rgba(70,30,12,0.15)', 'rgba(70,30,12,0)');
      break;
    }
    case 'finger':
      // dark oily smudges: overlapping thumb-sized ovals, low alpha (×0.75 over the base)
      for (let i = 0; i < 7; i++) {
        const x = cx + (r() - 0.5) * s * 0.5;
        const y = cy + (r() - 0.5) * s * 0.5;
        blob(g, x, y, s * (0.12 + r() * 0.12), 'rgba(18,14,10,0.16)', 'rgba(18,14,10,0)');
      }
      break;
    case 'desilver':
      for (let i = 0; i < 9; i++) {
        const x = x0 + (r() < 0.5 ? r() * s * 0.25 : s - r() * s * 0.25);
        const y = y0 + r() * s;
        blob(g, x, y, s * (0.06 + r() * 0.16), rgba([0.05, 0.05, 0.05], 0.85), 'rgba(13,13,13,0)');
      }
      break;
    case 'ink': {
      blob(g, cx, cy, s * 0.32, rgba([0.45, 0.32, 0.18], 0.45), 'rgba(115,82,46,0)');
      ring(g, cx, cy, s * 0.3, s * 0.012, [0.3, 0.2, 0.1], 0.5, r);
      break;
    }
  }
  // roughness: one value per cell (alpha-covered area only matters)
  const v = Math.round(cell.rough * 255);
  gr.fillStyle = `rgb(${v},${v},${v})`;
  gr.fillRect(x0, y0, s, s);
  g.restore();
  gr.restore();
}

/** Paints the atlas into two N×N canvases (colour+alpha, roughness). */
export function paintGrimeAtlas(color: Ctx2D, rough: Ctx2D, n: number): void {
  color.clearRect(0, 0, n, n);
  rough.fillStyle = 'rgb(230,230,230)';
  rough.fillRect(0, 0, n, n);
  for (const c of GRIME_CELLS) paintCell(color, rough, c, n);
}
