// The world side of the cutscene `fx` hooks (docs/CUTSCENES.md fx table) — all from scratch, all created at load
// (before shader compilation) so nothing compiles mid-cutscene:
//   windshield_rain {on, intensity}   droplets + running streaks on both windshields (the CAR set and your sedan):
//                                     a CPU droplet simulation drawn into a CanvasTexture on a mesh cut from the
//                                     glass_rain triangles; the wiper blades clear their arcs as they pass
//   wipers {on, period, phase}             both blades swing about the windshield normal (sweep_deg), in tandem
//   dash {on, fuelNeedle, fuelLamp}   the instrument cluster drawn to a CanvasTexture (speedo + fuel dial, needle,
//                                     amber low-fuel lamp, blinking for the sting), backlit; + engine vibration shake
//   taillights {on, intensity}        sedan tail lamps glow (and the head lamps follow L_HEADLIGHT_L/R)
//   rope_run {dir}                    the three pulley sheaves spin and the rope's splice runs along P_DOOR_ROPE's path
//   silhouette {id, on}               C5 shadow-play: the table candle's (prewarmed) shadow-casting light moves to the
//                                     window, goes cold and flashes with the lightning; Ada and Harlan play the
//                                     *_finale_shadow clips between it and the tally wall — her shadow pulls the sack /
//                                     lifts his cleaver across the tallies
//   blue_hour {mist, rain}            sky/fog toward pale dawn, mist density, a cool desaturated grade
//   car_trim {style}                  the sting's maroon interior
//   fresh tallies (dressing 'sting')  a new column of clumsy strokes on the tally wall
//   wardrobe_back_give {amount}       the loose back boards bow out a little (C4)
// Driven by story-runtime (cutsceneFx → fx(id, params); update(dt) after cs.update; lateUpdate() after the level's
// light update so light overrides win).

import * as THREE from 'three/webgpu';
import { uniform, texture as tslTexture, vec4, vec3, float, vec2, uv, mix, smoothstep, screenUV, viewportSharedTexture, positionLocal, abs, exp } from 'three/tsl';
import type { Level } from './level.ts';
import type { CharacterBank } from '../characters/bank.ts';
import { planToWorld } from '../shared/coords.ts';
import { setCandleShadow, kelvinToLinearRGB } from './lights.ts';
import { LOOK } from '../render/look.ts';
import { uParlorBake } from '../render/lightmap-material.ts'; // AD review: C5 ghost-bake dimming
import { requestExposureSnap } from '../render/exposure.ts'; // AD review: C5 cut
import { hashRng, PENS, drawText } from '../render/handwriting.ts';
import { createOpening } from './opening.ts';

type Params = Record<string, number | string | boolean>;

export interface CutsceneFxDeps {
  level: Level;
  camera: any;
  characters: CharacterBank | null;
  pipeline: () => any | null;
  lightningLevel: () => number;
  /** Is a cutscene holding the camera right now? (engine shake only then) */
  cameraHeld: () => boolean;
  /** Graphics preset (opening: lamp/dome shadow tiers). */
  preset?: { id: 'low' | 'medium' | 'max' } & Record<string, any>;
}

// ------------------------------------------------------------------------------------------------ rain sim

interface Drop {
  x: number; // metres across the glass (s)
  y: number; // metres up the slope (t)
  r: number; // radius m
  vy: number; // sliding speed (m/s, negative = down)
  trail: number; // m of streak left above it
  age: number;
}

/** Droplets on a windshield plane (s across, t up the slope), wiped by blades pivoting at spindles. */
class RainSim {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  readonly tex: any;
  drops: Drop[] = [];
  intensity = 0;
  on = false;
  private rng = hashRng(4711);
  film = 0;
  /** Road spray sheet 0..1 (C1 S5, opening builder 2): a thick, blotchy water layer the blades clear in ≈ 2 strokes. */
  sheet = 0;
  private sheetImg: HTMLCanvasElement | null = null;
  readonly W: number;
  readonly H: number;
  constructor(W: number, H: number) {
    this.W = W;
    this.H = H;
    const ppm = 500; // opening: 2 mm drops need ≥ 1 texel radius (was 330: blocky square drops)
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(64, Math.round(W * ppm));
    this.canvas.height = Math.max(32, Math.round(H * ppm));
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.flipY = true;
  }

  /** blades: spindle (s,t), length, previous + current angle (rad, 0 = along +s). */
  step(dt: number, blades: { s: number; t: number; len: number; a0: number; a1: number }[]): void {
    const r = this.rng;
    if (this.on && this.intensity > 0) {
      // new impacts: ~260 /m²/s at full rain
      let n = this.W * this.H * 260 * this.intensity * dt;
      while (n > 0) {
        if (n < 1 && r() > n) break;
        n -= 1;
        const big = r() < 0.08;
        this.drops.push({ x: r() * this.W, y: r() * this.H, r: big ? 0.0026 + r() * 0.0018 : 0.0007 + r() * 0.0014, vy: 0, trail: 0, age: 0 });
      }
      this.film = Math.min(1, this.film + dt * 0.25 * this.intensity);
    } else this.film = Math.max(0, this.film - dt * 0.15);
    // big drops start to run once they are heavy
    for (const d of this.drops) {
      d.age += dt;
      if (d.r > 0.0024 && d.age > 0.4) {
        d.vy = Math.max(-0.35, d.vy - dt * 0.6);
        d.y += d.vy * dt;
        d.x += Math.sin(d.y * 60 + d.r * 1e4) * 0.002 * dt * 10;
        d.trail = Math.min(0.12, d.trail - d.vy * dt);
      }
    }
    // wipers: a drop inside a blade's swept sector this frame is gone
    for (const b of blades) {
      const lo = Math.min(b.a0, b.a1) - 0.02;
      const hi = Math.max(b.a0, b.a1) + 0.02;
      if (hi - lo < 1e-4) continue;
      // stable in-place compaction (no per-blade array): keep the drops outside the swept sector
      const ds = this.drops;
      let n = 0;
      for (let k = 0; k < ds.length; k++) {
        const d = ds[k];
        const dx = d.x - b.s;
        const dy = d.y - b.t;
        const rr = Math.hypot(dx, dy);
        let keep = rr > b.len || rr < 0.03;
        if (!keep) {
          const a = Math.atan2(dy, dx);
          keep = a < lo || a > hi;
        }
        if (keep) ds[n++] = d;
      }
      ds.length = n;
      if (b.a0 !== b.a1) {
        this.film *= 0.985;
        this.sheet *= 0.955; // a fast blade stroke (0.375 s ≈ 11 frames) leaves ≈ 60 %; two full cycles ≈ 2 %
      }
    }
    {
      const ds = this.drops;
      let n = 0;
      for (let k = 0; k < ds.length; k++) if (ds[k].y > -0.02 && ds[k].age < 40) ds[n++] = ds[k];
      ds.length = n;
    }
    if (this.drops.length > 1400) this.drops.splice(0, this.drops.length - 1400);
    this.draw(blades);
  }

  /**
   * LIGHTING lane (REALISM-BACKLOG item 18): the canvas is a water-THICKNESS map (alpha), not a picture of drops —
   * the glass shader turns its gradient into each drop's lens normal and refracts the scene behind it (screen-space
   * offset, viewportSharedTexture), so a drop shows a tiny inverted view of the road / headlights / dash and is
   * bright only where a light is behind it. Was: lit grey dots with a painted white rim. Drops are domes (radial
   * thickness), running drops leave a thin rivulet (0.1–0.35 m/s), the wet film is a faint uniform layer the blades
   * clear in their arcs.
   */
  private draw(blades: { s: number; t: number; len: number; a1: number }[]): void {
    const g = this.g;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const kx = w / this.W;
    const ky = h / this.H;
    g.clearRect(0, 0, w, h);
    if (this.sheet > 0.01) {
      // thickness blotches (5–25 mm patches of standing water, overlapping): the glass shader refracts the whole view
      // through them — the windscreen "goes white-grey" by lensing every light, not by painting white
      if (!this.sheetImg) {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const sg = c.getContext('2d')!;
        const r = hashRng(9161);
        for (let i = 0; i < 2600; i++) {
          const x = r() * w;
          const y = r() * h;
          const rad = (0.005 + r() * 0.02) * kx;
          const gr = sg.createRadialGradient(x, y, 0, x, y, rad);
          gr.addColorStop(0, `rgba(255,255,255,${0.35 + r() * 0.4})`);
          gr.addColorStop(1, 'rgba(255,255,255,0)');
          sg.fillStyle = gr;
          sg.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        }
        this.sheetImg = c;
      }
      g.globalAlpha = Math.min(1, this.sheet);
      g.drawImage(this.sheetImg, 0, 0);
      g.globalAlpha = 1;
    }
    if (this.film > 0.01) {
      g.fillStyle = `rgba(255,255,255,${(0.07 * this.film).toFixed(3)})`;
      g.fillRect(0, 0, w, h);
      g.save();
      g.globalCompositeOperation = 'destination-out';
      for (const b of blades) {
        g.beginPath();
        g.moveTo(b.s * kx, h - b.t * ky);
        g.arc(b.s * kx, h - b.t * ky, b.len * kx, -Math.PI + 0, 0, false);
        g.closePath();
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fill();
      }
      g.restore();
    }
    for (const d of this.drops) {
      const x = d.x * kx;
      const y = h - d.y * ky;
      const rp = Math.max(1.1, d.r * kx * 1.15);
      if (d.trail > 0.004) {
        g.strokeStyle = 'rgba(255,255,255,0.32)';
        g.lineWidth = Math.max(1, rp * 0.7);
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - Math.sin(d.y * 40) * 2, y - d.trail * ky);
        g.stroke();
      }
      const gr = g.createRadialGradient(x, y, 0, x, y, rp);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.55, 'rgba(255,255,255,0.8)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, rp, 0, Math.PI * 2);
      g.fill();
    }
    this.tex.needsUpdate = true;
  }
}

/** LIGHTING lane (item 18): refractive water on a windshield from a RainSim thickness map (see RainSim.draw). */
function rainGlassMaterial(sim: RainSim): any {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const du = 1.5 / sim.canvas.width;
  const dv = 1.5 / sim.canvas.height;
  const th = (o: any) => tslTexture(sim.tex, uv().add(o)).a;
  const t = tslTexture(sim.tex).a;
  // lens normal from the thickness gradient; a drop is a short-focus inverted lens: the view behind is flipped
  // and minified → sample against the gradient. 0.02 of the screen per unit slope (backlog), × the dome slope.
  const grad = vec2(th(vec2(du, 0)).sub(th(vec2(-du, 0))), th(vec2(0, dv)).sub(th(vec2(0, -dv))));
  const behind = viewportSharedTexture(screenUV.sub(grad.mul(uRainRefract))).rgb;
  const drop = smoothstep(0.12, 0.45, t);
  const film = t.min(0.08);
  // Opening (C1-OPENING §7.3, "drops of light, not specks"): a 1–4 mm drop is a short-focus ball lens — it images a
  // ±50–60° field into itself, so every bright source in front of the car (our lit verge, the truck's lamps, the
  // lantern) shows up as a point inside most drops. Two wide taps along the lens normal (≈ 0.2 / 0.38 of the screen)
  // stand in for that field; the brighter one wins (the lens concentrates it), at ~0.55 transmission.
  const nrm = grad.mul(6).clamp(-1, 1);
  const wideA = viewportSharedTexture(screenUV.sub(nrm.mul(0.2))).rgb;
  const wideB = viewportSharedTexture(screenUV.sub(nrm.mul(0.38))).rgb;
  const field = wideA.max(wideB).mul(0.55);
  // drops: the refracted scene less ~8 % (two Fresnel interfaces + a little absorption); film: forward scatter lifts
  // the background ~15 % (the grey sheen of a wet screen)
  m.colorNode = mix(behind.mul(1.15), behind.mul(0.92).max(field), drop);
  m.opacityNode = drop.max(film.mul(4));
  m.fog = false;
  return m;
}
/** Screen-space refraction strength of the drops (fraction of the screen per unit thickness slope). */
const uRainRefract = uniform(0.15);

// ------------------------------------------------------------------------------------------------ car rig

interface Wiper {
  node: any;
  rest: any; // quaternion
  axis: any; // local rotation axis (node's parent space)
  sign: number;
  /** spindle + blade length on the windshield plane (s, t metres) */
  s: number;
  t: number;
  len: number;
  sweep: number;
  a: number;
  /** blade angle on the plane at rest, and the direction the sweep turns it (plane coordinates) */
  restAng: number;
  planeSign: number;
}

interface CarRig {
  id: string;
  root: any;
  glass: any | null;
  wipers: Wiper[];
  cluster: any | null;
  lamps: { head: any[]; tail: any[] };
}

/** Triangles of the windshield (the glass facing along the nose axis, slanted up), as a new mesh in `mesh`'s frame. */
function windshieldFrom(mesh: any, noseSign: number): { geo: any; normal: any; origin: any; sAxis: any; tAxis: any; W: number; H: number } | null {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const idx = geo.index;
  const tri = (i: number) => (idx ? idx.getX(i) : i);
  const n = idx ? idx.count : pos.count;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const nn = new THREE.Vector3();
  const keep: number[] = [];
  const avgN = new THREE.Vector3();
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const midZ = (bb.min.z + bb.max.z) / 2;
  for (let i = 0; i + 2 < n; i += 3) {
    a.fromBufferAttribute(pos, tri(i));
    b.fromBufferAttribute(pos, tri(i + 1));
    c.fromBufferAttribute(pos, tri(i + 2));
    nn.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    const area = nn.length();
    if (area < 1e-9) continue;
    nn.divideScalar(area);
    const cz = (a.z + b.z + c.z) / 3;
    // nose end, facing along the nose axis (either side of the pane), not a side window
    if ((cz - midZ) * noseSign < 0.02) continue;
    if (Math.abs(nn.z) < 0.35 || Math.abs(nn.x) > 0.5) continue;
    keep.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    avgN.addScaledVector(nn.z * noseSign > 0 ? nn : nn.clone().negate(), area);
  }
  if (keep.length < 9) return null;
  avgN.normalize(); // outward (toward the nose)
  // plane basis: s = local +x, t = up the slope (perpendicular to s in the plane)
  const sAxis = new THREE.Vector3(1, 0, 0).addScaledVector(avgN, -avgN.x).normalize();
  const tAxis = new THREE.Vector3().crossVectors(avgN, sAxis).normalize();
  if (tAxis.y < 0) tAxis.negate();
  let smin = Infinity;
  let smax = -Infinity;
  let tmin = Infinity;
  let tmax = -Infinity;
  const p = new THREE.Vector3();
  for (let i = 0; i < keep.length; i += 3) {
    p.set(keep[i], keep[i + 1], keep[i + 2]);
    const s = p.dot(sAxis);
    const t = p.dot(tAxis);
    smin = Math.min(smin, s);
    smax = Math.max(smax, s);
    tmin = Math.min(tmin, t);
    tmax = Math.max(tmax, t);
  }
  const W = smax - smin;
  const H = tmax - tmin;
  const uvs: number[] = [];
  const out: number[] = [];
  for (let i = 0; i < keep.length; i += 3) {
    p.set(keep[i], keep[i + 1], keep[i + 2]);
    uvs.push((p.dot(sAxis) - smin) / W, (p.dot(tAxis) - tmin) / H);
    p.addScaledVector(avgN, -0.004); // 4 mm inside the pane (the camera is in the cabin)
    out.push(p.x, p.y, p.z);
  }
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  g2.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g2.computeVertexNormals();
  const origin = new THREE.Vector3().addScaledVector(sAxis, smin).addScaledVector(tAxis, tmin);
  return { geo: g2, normal: avgN, origin, sAxis, tAxis, W, H };
}

function findByMaterial(root: any, id: string): any | null {
  let hit: any = null;
  root.traverse((n: any) => {
    if (hit || !n.isMesh) return;
    const mats = Array.isArray(n.material) ? n.material : [n.material];
    if (mats.some((m: any) => m?.userData?.material_id === id)) hit = n;
  });
  return hit;
}

function findPart(root: any, suffix: string): any[] {
  const out: any[] = [];
  root.traverse((n: any) => {
    if (typeof n.name === 'string' && n.name.endsWith(suffix)) out.push(n);
  });
  return out;
}

// ------------------------------------------------------------------------------------------------ gauges

/** v2 cluster dial layout (uv centre + radius in v units) from the gauges decal extras; null = the old CAR set. */
let clusterLayout: Record<string, { uv: [number, number]; r_uv: number }> | null = null;

function drawCluster(g: CanvasRenderingContext2D, w: number, h: number, st: { on: boolean; fuel: number; lamp: boolean; speed: number }): void {
  const L = clusterLayout;
  g.fillStyle = '#050605';
  g.fillRect(0, 0, w, h);
  const glow = st.on ? 1 : 0.12;
  const ink = (a: number) => `rgba(${Math.round(170 * glow)},${Math.round(214 * glow)},${Math.round(178 * glow)},${a})`;
  const dial = (cx: number, cy: number, r: number, a0: number, a1: number, ticks: number, labels: [number, string][], v: number) => {
    g.strokeStyle = ink(0.8);
    g.lineWidth = 2;
    g.beginPath();
    g.arc(cx, cy, r, a0, a1);
    g.stroke();
    for (let i = 0; i <= ticks; i++) {
      const a = a0 + ((a1 - a0) * i) / ticks;
      const big = i % 2 === 0;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      g.lineTo(cx + Math.cos(a) * (r - (big ? 11 : 6)), cy + Math.sin(a) * (r - (big ? 11 : 6)));
      g.stroke();
    }
    const rng = hashRng(99);
    for (const [f, t] of labels) {
      const a = a0 + (a1 - a0) * f;
      drawText(g, t, cx + Math.cos(a) * (r - 24) - t.length * 5, cy + Math.sin(a) * (r - 24) + 7, 15, { ...PENS.print, color: ink(0.9) }, rng);
    }
    if (L) return; // v2: real 3-D needles (src/world/opening.ts turns them)
    // needle (warm orange, lit), hub
    const a = a0 + (a1 - a0) * v;
    g.strokeStyle = st.on ? 'rgba(255,120,40,0.95)' : 'rgba(60,30,12,0.9)';
    g.lineWidth = 3.2;
    g.beginPath();
    g.moveTo(cx - Math.cos(a) * 8, cy - Math.sin(a) * 8);
    g.lineTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6));
    g.stroke();
    g.fillStyle = '#111';
    g.beginPath();
    g.arc(cx, cy, 6, 0, Math.PI * 2);
    g.fill();
  };
  const r = h * 0.4;
  const sp = L?.speedo ? { x: w * L.speedo.uv[0], y: h * L.speedo.uv[1], r: h * L.speedo.r_uv * 0.92 } : { x: w * 0.3, y: h * 0.56, r };
  const fu = L?.fuel ? { x: w * L.fuel.uv[0], y: h * L.fuel.uv[1], r: h * L.fuel.r_uv * 0.92 } : { x: w * 0.72, y: h * 0.62, r: r * 0.78 };
  // speedo: 0–120 mph over 252° (v2 needle zero −126°, 2.1°/mph)
  if (L) dial(sp.x, sp.y, sp.r, Math.PI * 0.8, Math.PI * 2.2, 12, [[0, '0'], [0.33, '40'], [0.66, '80'], [1, '120']], st.speed);
  else dial(sp.x, sp.y, sp.r, Math.PI * 0.8, Math.PI * 2.2, 12, [[0, '0'], [0.33, '40'], [0.66, '80'], [1, '120']], st.speed);
  // fuel: E … F over a 90–100° arc; the needle may sit below E (negative)
  const fuel = Math.max(-0.06, Math.min(1, st.fuel));
  dial(fu.x, fu.y, fu.r, Math.PI * 1.25, Math.PI * 1.75, 4, [[0, 'E'], [1, 'F']], fuel);
  if (L?.temp) dial(w * L.temp.uv[0], h * L.temp.uv[1], h * L.temp.r_uv * 0.92, Math.PI * 1.25, Math.PI * 1.75, 2, [[0, 'C'], [1, 'H']], 0.45);
  // low-fuel lamp (amber pump pictogram)
  const lx = fu.x;
  const ly = L ? Math.min(h - 14, fu.y + fu.r * 0.55) : h * 0.86;
  g.fillStyle = st.lamp ? 'rgba(255,150,20,1)' : 'rgba(40,26,8,0.9)';
  g.fillRect(lx - 9, ly - 12, 12, 16);
  g.fillRect(lx + 4, ly - 8, 4, 10);
  if (st.lamp) {
    // AD review: a small amber icon with a TIGHT glow (light leaking round the pictogram mask, ≈ 2 mm), not a disc
    const rg = g.createRadialGradient(lx - 2, ly - 4, 4, lx - 2, ly - 4, 12);
    rg.addColorStop(0, 'rgba(255,150,30,0.22)');
    rg.addColorStop(1, 'rgba(255,150,30,0)');
    g.fillStyle = rg;
    g.fillRect(lx - 16, ly - 18, 30, 30);
  }
}

// ------------------------------------------------------------------------------------------------ the fx system

export function createCutsceneFx(d: CutsceneFxDeps) {
  const { level } = d;
  const cars: CarRig[] = [];
  let rainSim: RainSim | null = null;
  const rainMeshes: any[] = [];
  let rainOn = false;
  let wipersOn = false;
  let wiperPeriod = 1.25;
  let wiperT = 0;
  let wiperParkT = 0;
  const dash = { on: false, fuel: 0.05, lamp: false as boolean | 'blink', speed: 0.35, dirty: true, blinkOn: true, blinkT: 0 };
  let clusterCanvas: HTMLCanvasElement | null = null;
  let clusterTex: any = null;
  const clusterGain = uniform(0.1);
  let tailGlow = 0;
  const headGlow = uniform(0);
  const tailU = uniform(0);
  let shakeT = 0;

  // ---- car rigs (the CAR set interior: nose local −Z; the sedans: nose local +Z)
  const buildCar = (id: string, noseSign: number): CarRig | null => {
    const root = level.prop(id);
    if (!root) return null;
    root.updateMatrixWorld(true);
    const glassMesh = findByMaterial(root, 'glass_rain') ?? findByMaterial(root, 'glass_grimy');
    let glass: any = null;
    let ws: ReturnType<typeof windshieldFrom> = null;
    if (glassMesh) {
      ws = windshieldFrom(glassMesh, noseSign);
      if (ws) {
        rainSim ??= new RainSim(Math.max(0.8, ws.W), Math.max(0.3, ws.H));
        const m = rainGlassMaterial(rainSim); // LIGHTING lane (item 18): refractive drops
        glass = new THREE.Mesh(ws.geo, m);
        glass.name = `${id}-rain`;
        glass.renderOrder = 7;
        glass.frustumCulled = false;
        glassMesh.add(glass);
        rainMeshes.push(glass);
      }
    }
    const wipers: Wiper[] = [];
    for (const node of findPart(root, '-wiper_d').concat(findPart(root, '-wiper_p'))) {
      if (!ws || !glassMesh) break;
      node.matrixAutoUpdate = true;
      const ud = node.userData ?? {};
      const sweep = THREE.MathUtils.degToRad(Number(ud.sweep_deg ?? 95));
      // the windshield normal in the node's parent frame
      const toParent = new THREE.Matrix4().copy(node.parent.matrixWorld).invert().multiply(glassMesh.matrixWorld);
      const nrm = ws.normal.clone().transformDirection(toParent).normalize();
      // the blade's rest direction = its longest extent from the spindle (node origin); which way lifts it?
      let bladeLen = 0.5;
      const x0 = new THREE.Vector3(1, 0, 0);
      if (node.geometry) {
        node.geometry.computeBoundingBox();
        const gb = node.geometry.boundingBox;
        const far = [gb.min, gb.max].reduce((a: any, v: any) => (v.length() > a.length() ? v : a), gb.min);
        const ext = gb.getSize(new THREE.Vector3());
        const ax = ext.x >= ext.y && ext.x >= ext.z ? 0 : ext.y >= ext.z ? 1 : 2;
        x0.set(0, 0, 0).setComponent(ax, Math.sign(far.getComponent(ax)) || 1);
        bladeLen = Math.max(0.2, ext.getComponent(ax));
      }
      x0.applyQuaternion(node.quaternion);
      const up = new THREE.Vector3(0, 1, 0).transformDirection(new THREE.Matrix4().copy(node.parent.matrixWorld).invert());
      const test = x0.clone().applyAxisAngle(nrm, 0.2);
      const sign = test.dot(up) > x0.dot(up) ? 1 : -1;
      // spindle on the windshield plane (glass mesh frame)
      const sp = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld).applyMatrix4(new THREE.Matrix4().copy(glassMesh.matrixWorld).invert());
      const rel = sp.sub(ws.origin);
      // blade direction on the plane (glass frame): rest angle + which way the sweep turns it
      const parentToGlass = new THREE.Matrix4().copy(glassMesh.matrixWorld).invert().multiply(node.parent.matrixWorld);
      const dG = x0.clone().transformDirection(parentToGlass);
      const dG2 = x0.clone().applyAxisAngle(nrm, 0.2 * sign).transformDirection(parentToGlass);
      const restAng = Math.atan2(dG.dot(ws.tAxis), dG.dot(ws.sAxis));
      const ang2 = Math.atan2(dG2.dot(ws.tAxis), dG2.dot(ws.sAxis));
      const planeSign = Math.sign(Math.atan2(Math.sin(ang2 - restAng), Math.cos(ang2 - restAng))) || 1;
      wipers.push({ node, rest: node.quaternion.clone(), axis: nrm, sign, s: rel.dot(ws.sAxis), t: rel.dot(ws.tAxis), len: bladeLen, sweep, a: 0, restAng, planeSign });
    }
    // instrument cluster (the gauges decal)
    let cluster: any = null;
    for (const n of findPart(root, '-cluster')) if (n.isMesh) cluster = n;
    if (cluster) {
      if (!clusterCanvas) {
        clusterCanvas = document.createElement('canvas');
        clusterCanvas.width = 512;
        // sedan_interior v2 (C1-OPENING §6.1): the gauges decal says where its dials are and has 3-D needles
        const ud = cluster.userData ?? {};
        if (ud.dials) clusterLayout = ud.dials;
        clusterCanvas.height = Array.isArray(ud.canvas_px) ? Number(ud.canvas_px[1]) : 160;
        clusterTex = new THREE.CanvasTexture(clusterCanvas);
        clusterTex.colorSpace = THREE.SRGBColorSpace;
        clusterTex.flipY = false;
      }
      const m = new THREE.MeshBasicNodeMaterial();
      m.colorNode = tslTexture(clusterTex).rgb.mul(clusterGain);
      cluster.material = m;
    }
    // lamps
    const lamps = { head: [] as any[], tail: [] as any[] };
    root.traverse((n: any) => {
      const lamp = n.userData?.lamp;
      if (lamp !== 'head' && lamp !== 'tail') return;
      // C1-OPENING §7.8: a red tail lens through AgX desaturates toward pink once it clips; real 1980s red acrylic
      // passes 600–700 nm with a little orange, so the emitted colour is red-orange (it stays red when bright)
      const ec = lamp === 'tail' ? [1, 0.13, 0.035] : (n.userData.emissive_color ?? [1, 0.92, 0.75]);
      const col = new THREE.Color(ec[0], ec[1], ec[2]);
      n.traverse((mesh: any) => {
        if (!mesh.isMesh) return;
        // runtime lane D (AD review C1 60.5: "cold flat white LED panels"): the chrome bezel (sedan.py: chrome_pitted
        // in the same part) stays a lit metal ring; only the glass glows.
        const mn = String((Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.name ?? '');
        if (lamp === 'head' && /chrome/i.test(mn)) return;
        const m = new THREE.MeshBasicNodeMaterial();
        const gain = lamp === 'head' ? headGlow : tailU;
        if (lamp === 'head') {
          // 1980s rectangular halogen sealed beam (200 × 142 mm, sedan.py lens 0.40 × 0.14 m at ±0.58 m): 3200 K, the
          // filament image a hot core in the reflector (clips white) with the fluted lens falling off to a warm rim.
          // Lens-local coords from the part's bbox: lateral = longest axis, vertical = middle, lamp centres ±0.58 m.
          mesh.geometry.computeBoundingBox();
          const bb = mesh.geometry.boundingBox;
          const ext = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
          const ord = [0, 1, 2].sort((a, b) => ext[b] - ext[a]);
          const ax = (i: number) => (i === 0 ? positionLocal.x : i === 1 ? positionLocal.y : positionLocal.z);
          const ctr = (i: number) => (i === 0 ? (bb.min.x + bb.max.x) / 2 : i === 1 ? (bb.min.y + bb.max.y) / 2 : (bb.min.z + bb.max.z) / 2);
          const top = ord[1] === 0 ? bb.max.x : ord[1] === 1 ? bb.max.y : bb.max.z;
          const lat = abs(ax(ord[0]).sub(ctr(ord[0]))).sub(0.58).div(0.2);
          const ver = ax(ord[1]).sub(top - 0.07).div(0.07);
          const core = exp(lat.mul(lat).add(ver.mul(ver)).mul(-2.2));
          const k = kelvinToLinearRGB(3200);
          m.colorNode = vec3(k[0], k[1], k[2]).mul(gain.mul(core.mul(9).add(1.2)).add(0.015));
        } else m.colorNode = vec4(col.r, col.g, col.b, 1).rgb.mul(gain.mul(3).add(0.015));
        mesh.material = m;
      });
      lamps[lamp === 'head' ? 'head' : 'tail'].push(n);
    });
    const rig = { id, root, glass, wipers, cluster, lamps };
    cars.push(rig);
    return rig;
  };
  buildCar('P_CAR_INTERIOR', -1);
  buildCar('P_CAR_GATE', 1);
  buildCar('P_CAR_ROW', 1);
  // Which car's blades clear the shared rain sim: the CAR set, or (interior mounted in the moving sedan, C1-OPENING
  // §7.1) the exterior sedan, whose glass + blades are the visible ones.
  let rainCar = 'P_CAR_INTERIOR';
  const opening = createOpening({
    level,
    presetId: d.preset?.id ?? 'medium',
    camera: d.camera,
    preset: d.preset ?? { id: 'medium' },
    cameraHeld: d.cameraHeld,
    setRainCar: (id) => (rainCar = id),
    glassWet: () => (rainSim ? Math.min(1, rainSim.film) : 0),
    night: () => blueHour < 0.5, // C0/C1 storm night (C6/C7 blue hour mounts the car at the house too)
  });
  const redrawCluster = () => {
    if (!clusterCanvas) return;
    const lamp = dash.lamp === 'blink' ? dash.blinkOn : !!dash.lamp;
    drawCluster(clusterCanvas.getContext('2d')!, clusterCanvas.width, clusterCanvas.height, { on: dash.on, fuel: dash.fuel, lamp: dash.on && lamp, speed: dash.speed });
    clusterTex.needsUpdate = true;
    clusterGain.value = dash.on ? 1.4 : 0.25;
    opening.setGauges({ mph: dash.speed * 120, fuel: dash.fuel, on: dash.on });
    opening.setWarn({ fuel: dash.on || dash.lamp ? lamp : false, batt: !dash.on && dash.lamp !== false, oil: !dash.on && dash.lamp !== false });
    dash.dirty = false;
  };
  redrawCluster();

  // ---- rope run
  const ropeRoot = level.prop('P_DOOR_ROPE');
  let ropePath: any[] = [];
  ropeRoot?.traverse((n: any) => {
    const pl = n.userData?.path_local;
    if (Array.isArray(pl) && !ropePath.length) {
      const base = ropeRoot.userData?.plan_pos ?? [1.8, 0.1, 3.6];
      ropePath = pl.map((p: number[]) => new THREE.Vector3(...planToWorld([base[0] + p[0], base[1] + p[1], base[2] + p[2]])));
    }
  });
  const sheaves: any[] = [];
  for (const id of ['P_PULLEY_1', 'P_PULLEY_2', 'P_PULLEY_3']) for (const n of findPart(level.prop(id) ?? new THREE.Group(), '-sheave')) sheaves.push(n);
  const knotMat = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0.09, 0.07, 0.05), roughness: 0.9 });
  if (level.probeLightsNode) knotMat.lightsNode = level.probeLightsNode;
  const knot = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.07, 8), knotMat);
  knot.name = 'rope-splice';
  knot.frustumCulled = false;
  level.root.add(knot);
  let ropeRun: { t: number; dir: 1 | -1; len: number } | null = null;
  const ropeLen = ropePath.reduce((a, p, i) => (i ? a + p.distanceTo(ropePath[i - 1]) : 0), 0);
  const ropeAt = (dist: number, out: any) => {
    let acc = 0;
    for (let i = 1; i < ropePath.length; i++) {
      const L = ropePath[i].distanceTo(ropePath[i - 1]);
      if (acc + L >= dist) return out.lerpVectors(ropePath[i - 1], ropePath[i], (dist - acc) / Math.max(1e-6, L));
      acc += L;
    }
    return out.copy(ropePath[ropePath.length - 1] ?? out);
  };

  // ---- C5 shadow-play (LIGHTING lane, REALISM-BACKLOG item 19): a real candle throws the figures on the tally wall.
  // The table candle's shadow light (casts from load, P0-2) becomes the one candle left burning: 1850 K, 0.95 cd
  // (≈ 12 W / 4π, the layout's table candle), 0.4 m behind Ada and 2.1 m from the north (tally) wall, at 2.05 m so
  // both heads land at ≈ 2.9 m on the wall (Ada × 5.4, Harlan × 2.4: shadow size = distance ratio). Its diffuse runs
  // at the full candela on the lightmapped wall (share 1) — the bake holds no light from here, so the shadow reads
  // ≈ 2–3 : 1 against the baked ambient. Was: the same light moved to the window, cold, 0.02 + 38·flash.
  const shadowLight = level.lights.flickers.find((f) => f.def.id === 'L_CANDLE_TABLE') ?? null;
  let shadow: { id: string; t: number; saved: { pos: any; color: any; distance: number; cast: boolean } } | null = null;
  const SHADOW_LIGHT_POS = planToWorld([5.0, 3.85, 2.05]);
  const SHADOW_CANDLE_CD = 0.95;
  const ADA_SIL: [number, number, number] = [5.1, 4.25, 0.6];
  const HARLAN_SIL: [number, number, number] = [5.5, 4.75, 0.6];
  const silhouetteOn = (id: string, lightOnly = false) => {
    const bank = d.characters;
    if (bank && !lightOnly) {
      const hA = Math.atan2(HARLAN_SIL[1] - ADA_SIL[1], HARLAN_SIL[0] - ADA_SIL[0]);
      bank.place('ada', ADA_SIL, hA);
      bank.place('harlan', HARLAN_SIL, hA + Math.PI);
      bank.setVisible('ada', true);
      bank.setVisible('harlan', true);
      const at = id === 'unmask' ? 0.35 : 3.1;
      const okA = bank.play('ada', 'ada_finale_shadow', { loop: false, fade: 0, speed: 1, at });
      const okH = bank.play('harlan', 'harlan_finale_shadow', { loop: false, fade: 0, speed: 1, at });
      if (!okA) bank.play('ada', 'ada_look', { loop: false, fade: 0, speed: 1, at: 1.4 });
      if (!okH) bank.play('harlan', 'harlan_opening', { loop: false, fade: 0, speed: 0, at: 3 });
      if (id === 'cleaver') {
        bank.harlan?.setSack(false);
        bank.harlan?.setCleaver(false);
        bank.attach('ada', 'cleaver', 'prop_r');
      }
    }
    if (shadowLight && !shadow) {
      const L = shadowLight.light;
      shadow = { id, t: 0, saved: { pos: L.position.clone(), color: L.color.clone(), distance: L.distance, cast: L.shadow.intensity > 0 } };
      L.position.set(...SHADOW_LIGHT_POS);
      L.distance = 6; // keeps its own 1850 K colour
      setCandleShadow(L, true); // PERF-PLAN P0-2: casts from load; unmute (never toggle castShadow)
      if (shadowLight.flame) shadowLight.flame.visible = false;
      uParlorBake.value = LOOK.c5Bake; // AD review: the guttered candles' baked light goes out with them (look.ts)
      setGroundProbes(LOOK.c5Bake); // r3 AD review: …and out of the probe grid that lights the characters + cleaver
      requestExposureSnap(); // AD review: it lands on the cut to the wall — adapt with the cut, not over 6 s
    } else if (shadow) {
      shadow.id = id;
      shadow.t = 0;
    }
  };
  // r3 AD review (R2-6): the ground-floor probe grid is baked from the same lightmaps, so it still held the guttered
  // candles (and the moonlit window) at full strength while the parlor bake was at c5Bake: Harlan, Ada and the
  // cleaver stayed lit by light that had gone out, and the steel blade's multi-scatter term showed that probe light
  // as a flat blue-grey card against the dimmed orange wall. Scale the grid with the bake (C5 frames only the parlor).
  const setGroundProbes = (k: number) => {
    const grid = level.grids.find((g) => g.id === 'ground')?.grid;
    if (grid) grid.intensity = k;
  };
  const silhouetteOff = () => {
    if (!shadow || !shadowLight) return;
    const L = shadowLight.light;
    L.position.copy(shadow.saved.pos);
    L.color.copy(shadow.saved.color);
    L.distance = shadow.saved.distance;
    setCandleShadow(L, shadow.saved.cast);
    uParlorBake.value = 1; // AD review: back to the bake as the room returns (C5 ends on a cut to black)
    setGroundProbes(1);
    shadow = null;
  };
  /** Between the two flashes the sack comes off (the unmask clip yanks it at 0.5–0.9 s). */
  const updateShadow = (dt: number) => {
    if (!shadow) return;
    shadow.t += dt;
    if (shadow.id === 'unmask' && shadow.t > 0.45) d.characters?.harlan?.setSack(false);
  };

  // ---- C7: a fresh column of clumsy tallies on the tally wall (north wall of the parlor, y = 6)
  const tallyCanvas = document.createElement('canvas');
  tallyCanvas.width = 256;
  tallyCanvas.height = 512;
  {
    const g = tallyCanvas.getContext('2d')!;
    const r = hashRng(1994);
    g.clearRect(0, 0, 256, 512);
    g.lineCap = 'round';
    let y = 28;
    for (let grp = 0; grp < 6; grp++) {
      const n = grp === 5 ? 1 : 4;
      for (let i = 0; i < n; i++) {
        const x = 40 + i * 34 + (r() - 0.5) * 10;
        g.strokeStyle = `rgba(28,24,22,${0.75 + r() * 0.2})`;
        g.lineWidth = 5 + r() * 3;
        g.beginPath();
        g.moveTo(x + (r() - 0.5) * 12, y + (r() - 0.5) * 8);
        g.lineTo(x + (r() - 0.5) * 22, y + 62 + (r() - 0.5) * 14);
        g.stroke();
      }
      if (n === 4) {
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(24, y + 50 + r() * 8);
        g.lineTo(176, y + 10 + r() * 10);
        g.stroke();
      }
      y += 80;
    }
  }
  const tallyTex = new THREE.CanvasTexture(tallyCanvas);
  tallyTex.colorSpace = THREE.SRGBColorSpace;
  const tallyMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const tt = tslTexture(tallyTex);
  tallyMat.colorNode = tt.rgb;
  tallyMat.opacityNode = tt.a.mul(float(0.92));
  const tally = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.68), tallyMat);
  tally.position.set(...planToWorld([6.35, 5.985, 1.62]));
  tally.rotation.y = 0; // plane faces +Z (three) = −y PLAN: into the parlor
  tally.name = 'sting-tallies';
  tally.frustumCulled = false;
  tally.renderOrder = 3;
  (level.roomGroups.get('G2') ?? level.root).add(tally);

  // ---- car trim (the sting's maroon interior)
  const trimSaved = new Map<any, any>();
  const setTrim = (style: string) => {
    const root = level.prop('P_CAR_INTERIOR');
    if (!root) return;
    root.traverse((n: any) => {
      if (!n.isMesh) return;
      const m = n.material;
      if (style === 'maroon') {
        if (m?.userData?.material_id !== 'car_interior_tan' || trimSaved.has(n)) return;
        trimSaved.set(n, m);
        const c = m.clone();
        c.userData = { ...m.userData };
        if (c.colorNode) c.colorNode = c.colorNode.mul(vec4(1.35, 0.42, 0.44, 1).rgb);
        else c.color?.multiply?.(new THREE.Color(1.35, 0.42, 0.44));
        n.material = c;
      } else if (trimSaved.has(n)) {
        n.material = trimSaved.get(n);
        trimSaved.delete(n);
      }
    });
  };

  // ---- blue hour / dawn grade
  let blueHour = 0;
  let blueTarget = 0;
  let mist = 0;

  // ---- wardrobe back
  const giveBack = (amount: number) => {
    const dd = level.doors.doors.get('D_WARDROBE_BACK');
    if (!dd || Math.abs(dd.angle) > 5) return;
    dd.target = Math.min(6, 120 * amount); // a few degrees: the boards bow out, cold air
    dd.speed = 8;
  };

  // ------------------------------------------------------------------------------------------------ api
  const fx = (id: string, p: Params): boolean => {
    switch (id) {
      case 'windshield_rain':
        rainOn = !!p.on;
        if (rainSim) {
          rainSim.on = rainOn;
          rainSim.intensity = Number(p.intensity ?? 1);
          if (!rainOn) rainSim.drops.length = 0;
        }
        for (const m of rainMeshes) m.visible = rainOn;
        return true;
      case 'wipers': {
        const was = wipersOn;
        const oldPeriod = wiperPeriod;
        wipersOn = !!p.on;
        if (p.period !== undefined) wiperPeriod = Number(p.period);
        // phase: C0 → C1 match-cut on one sweep; a period change while running (S5 fast wipers) keeps the blade where
        // it is (was: wiperT reset → the blades jumped to park mid-stroke)
        if (wipersOn && was && p.phase === undefined) wiperT = (wiperT / Math.max(0.3, oldPeriod)) * wiperPeriod;
        else if (wipersOn) wiperT = Number(p.phase ?? 0) * wiperPeriod;
        return true;
      }
      case 'spray':
        // {amount}: a sheet of road spray hits the glass (C1 S5, the truck at 34.8 s)
        if (rainSim) {
          rainSim.sheet = Math.min(1.2, rainSim.sheet + Number(p.amount ?? 1));
          rainSim.film = 1;
        }
        return true;
      case 'dash':
        dash.on = !!p.on;
        if (p.fuelNeedle !== undefined) dash.fuel = Number(p.fuelNeedle);
        dash.lamp = p.fuelLamp === 'blink' ? 'blink' : !!p.fuelLamp;
        dash.dirty = true;
        return true;
      case 'fuel':
        dash.fuel = Number(p.level ?? dash.fuel);
        dash.dirty = true;
        return true;
      case 'taillights':
        tailGlow = p.on ? Number(p.intensity ?? 1) : 0;
        return true;
      case 'rope_run':
        ropeRun = ropePath.length > 1 ? { t: 0, dir: p.dir === 'open' ? 1 : -1, len: ropeLen } : null;
        return true;
      case 'silhouette':
        if (p.on) silhouetteOn(String(p.id ?? 'unmask'), p.lightOnly === true); // lightOnly: the candle first (item 19)
        else silhouetteOff();
        return true;
      case 'blue_hour':
        mist = Number(p.mist ?? 0);
        blueTarget = Math.max(0, Math.min(1, mist));
        return true;
      case 'car_trim':
        setTrim(String(p.style ?? 'tan'));
        return true;
      case 'wardrobe_back_give':
        giveBack(Number(p.amount ?? 0.02));
        return true;
      default:
        return opening.fx(id, p);
    }
  };

  const prevWiperA: number[] = [];
  const bladeBuf: { s: number; t: number; len: number; a0: number; a1: number }[] = [];
  /** Per frame, after the cutscene player applied the camera. */
  const update = (dt: number) => {
    uRainRefract.value = LOOK.rainRefract; // LIGHTING lane (item 18): live look value
    // wipers
    // last frame's wiper angles (flattened over the cars, cars[0] first), into a reused buffer
    prevWiperA.length = 0;
    for (const w of (cars.find((c) => c.id === rainCar) ?? cars[0])?.wipers ?? []) prevWiperA.push(w.a);
    if (wipersOn) {
      wiperT += dt;
      wiperParkT = 0;
    } else if (wiperT > 0) {
      // finish the stroke back to park
      wiperParkT += dt;
    }
    for (const car of cars) {
      for (const w of car.wipers) {
        let a: number;
        if (wipersOn || w.a > 1e-3) {
          const ph = (wiperT / Math.max(0.3, wiperPeriod)) % 1;
          a = (w.sweep * (1 - Math.cos(ph * Math.PI * 2))) / 2;
          if (!wipersOn) a = Math.max(0, w.a - dt * 2.5);
        } else a = 0;
        w.a = a;
        w.node.quaternion.copy(w.rest);
        if (a > 0) w.node.quaternion.premultiply(_q.setFromAxisAngle(w.axis, a * w.sign));
      }
    }
    // rain (one shared simulation; the set's blades clear it)
    if (rainSim && (rainOn || rainSim.drops.length)) {
      const set = cars.find((c) => c.id === rainCar) ?? cars[0];
      const ws = set?.wipers ?? [];
      bladeBuf.length = ws.length;
      for (let i = 0; i < ws.length; i++) {
        const w = ws[i];
        const b = (bladeBuf[i] ??= { s: 0, t: 0, len: 0, a0: 0, a1: 0 });
        b.s = w.s;
        b.t = w.t;
        b.len = w.len;
        b.a0 = w.restAng + w.planeSign * (prevWiperA[i] ?? w.a);
        b.a1 = w.restAng + w.planeSign * w.a;
      }
      rainSim.step(dt, bladeBuf);
    }
    // dash
    if (dash.lamp === 'blink') {
      dash.blinkT += dt;
      const on = dash.blinkT % 0.9 < 0.45;
      if (on !== dash.blinkOn) {
        dash.blinkOn = on;
        dash.dirty = true;
      }
    }
    if (dash.on) {
      const target = 0.33 + Math.sin(performance.now() * 0.0007) * 0.01;
      if (Math.abs(target - dash.speed) > 0.003) {
        dash.speed += (target - dash.speed) * Math.min(1, dt * 2);
        dash.dirty = true;
      }
    }
    if (dash.dirty) redrawCluster();
    // lamps follow the headlight spots / taillights fx
    const hl = level.runtimeLight('L_HEADLIGHT_L');
    headGlow.value = hl ? Math.min(1.2, hl.intensity / Math.max(1e-3, hl.userData.csBase ?? 1)) : 0;
    tailU.value = tailGlow;
    // engine vibration: a fine, fast camera tremor while the engine runs and a cutscene holds the camera
    if (dash.on && d.cameraHeld()) {
      shakeT += dt;
      const cam = d.camera;
      const a = 0.0016;
      cam.rotateX(Math.sin(shakeT * 83) * a + Math.sin(shakeT * 51.3) * a * 0.6);
      cam.rotateZ(Math.sin(shakeT * 67.1) * a * 0.5);
      cam.updateMatrixWorld(true);
    }
    // rope run
    if (ropeRun) {
      ropeRun.t += dt;
      const speed = 3.2;
      const dist = Math.min(ropeRun.len, ropeRun.t * speed);
      const along = ropeRun.dir > 0 ? dist : ropeRun.len - dist;
      ropeAt(along, knot.position);
      knot.visible = true;
      for (const s of sheaves) s.rotateX(dt * 24 * ropeRun.dir);
      if (dist >= ropeRun.len) ropeRun = null;
    } else knot.visible = false;
    updateShadow(dt);
    opening.update(dt);
    // blue hour eases in
    blueHour += (blueTarget - blueHour) * Math.min(1, dt * 0.6);
    const pl = d.pipeline();
    if (pl?.uniforms?.tint) {
      pl.uniforms.tint.value.setRGB(1 - blueHour * 0.1, 1 - blueHour * 0.02, 1 + blueHour * 0.1);
      pl.uniforms.saturation.value = 1 - blueHour * 0.3;
    }
  };

  /** After the level's light update (the flicker loop would overwrite the shadow light). */
  const lateUpdate = () => {
    if (shadow && shadowLight) {
      // a still-air candle: ±6 % breathing, full diffuse share (see the C5 shadow-play note above)
      const t = performance.now() / 1000;
      shadowLight.light.intensity = SHADOW_CANDLE_CD * (1 + 0.04 * Math.sin(t * 2.3) + 0.02 * Math.sin(t * 13.7));
      const share = shadowLight.light.userData.lmDiffuseShare;
      if (share) share.value = 1;
    }
  };

  /** Load-time warm-up: everything visible once (compiled with the level), then hidden in `start`. */
  const setWarm = (on: boolean) => {
    opening.setWarm(on);
    for (const m of rainMeshes) m.visible = on;
    knot.visible = on;
    tally.visible = on;
  };
  setWarm(true);

  return {
    fx,
    update,
    lateUpdate,
    setWarm,
    /** Load warm-up: our sedan (interior mounted) + the truck parked on County Road 9 (returns a camera eye, world). */
    warmRoad: (on: boolean, s?: number) => opening.warmRoad(on, s),
    /** The FP arms need the CAR light list: the interior is mounted in our sedan, or C0 runs (runtime lane E: the
     *  switch rebuilds the arms' shaders, so it happens on C0's black date card, not at its first live cut). */
    mounted: () => opening.armsCar(),
    /** Driver POV in the mounted interior: the FP arms ride the car, not the turning head (FpArms.anchorTo). */
    driverAnchor: () => opening.driverAnchor(),
    /** C7 dressing: the fresh tally column. */
    setSting(on: boolean) {
      tally.visible = on;
      if (!on) setTrim('tan');
    },
    /** C6 → B12: 0 storm night … 1 pale dawn (sky, fog). */
    blueHour: () => blueHour,
    mist: () => mist,
    /** After C5: restore Harlan's sack/cleaver state and drop the silhouette light. */
    resetSilhouette() {
      silhouetteOff();
      d.characters?.harlan?.setSack(true);
      d.characters?.harlan?.setCleaver(true);
      d.characters?.attach('ada', 'cleaver', null);
    },
    opening,
    debug: () => ({ opening: opening.debug(), cars: cars.map((c) => ({ id: c.id, glass: !!c.glass, wipers: c.wipers.length, cluster: !!c.cluster, lamps: c.lamps.head.length + c.lamps.tail.length })), rope: ropePath.length, sheaves: sheaves.length, drops: rainSim?.drops.length ?? 0 }),
  };
}

const _q = new THREE.Quaternion();

export type CutsceneFx = ReturnType<typeof createCutsceneFx>;
