// The world side of the cutscene `fx` hooks (docs/CUTSCENES.md fx table) — all from scratch, all created at load
// (before shader compilation) so nothing compiles mid-cutscene:
//   windshield_rain {on, intensity}   droplets + running streaks on both windshields (the CAR set and your sedan):
//                                     a CPU droplet simulation drawn into a CanvasTexture on a mesh cut from the
//                                     glass_rain triangles; the wiper blades clear their arcs as they pass
//   wipers {on, period}               both blades swing about the windshield normal (sweep_deg), in tandem
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
import { uniform, texture as tslTexture, vec4, float } from 'three/tsl';
import type { Level } from './level.ts';
import type { CharacterBank } from '../characters/bank.ts';
import { planToWorld } from '../shared/coords.ts';
import { hashRng, PENS, drawText } from '../render/handwriting.ts';

type Params = Record<string, number | string | boolean>;

export interface CutsceneFxDeps {
  level: Level;
  camera: any;
  characters: CharacterBank | null;
  pipeline: () => any | null;
  lightningLevel: () => number;
  /** Is a cutscene holding the camera right now? (engine shake only then) */
  cameraHeld: () => boolean;
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
  private film = 0;
  readonly W: number;
  readonly H: number;
  constructor(W: number, H: number) {
    this.W = W;
    this.H = H;
    const ppm = 330;
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
      this.drops = this.drops.filter((d) => {
        const dx = d.x - b.s;
        const dy = d.y - b.t;
        const rr = Math.hypot(dx, dy);
        if (rr > b.len || rr < 0.03) return true;
        const a = Math.atan2(dy, dx);
        return a < lo || a > hi;
      });
      if (b.a0 !== b.a1) this.film *= 0.985;
    }
    this.drops = this.drops.filter((d) => d.y > -0.02 && d.age < 40);
    if (this.drops.length > 1400) this.drops.splice(0, this.drops.length - 1400);
    this.draw(blades);
  }

  private draw(blades: { s: number; t: number; len: number; a1: number }[]): void {
    const g = this.g;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const kx = w / this.W;
    const ky = h / this.H;
    g.clearRect(0, 0, w, h);
    // the wet film: a faint grey haze, cleared where the blades just passed
    if (this.film > 0.01) {
      g.fillStyle = `rgba(150,160,172,${(0.06 * this.film).toFixed(3)})`;
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
      const rp = Math.max(0.8, d.r * kx);
      if (d.trail > 0.004) {
        g.strokeStyle = 'rgba(170,182,196,0.16)';
        g.lineWidth = rp * 0.9;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - Math.sin(d.y * 40) * 2, y - d.trail * ky);
        g.stroke();
      }
      // a drop is a tiny inverted lens: dark body, the bright world (headlights, dash) caught on its lower rim
      g.fillStyle = 'rgba(12,14,18,0.28)';
      g.beginPath();
      g.arc(x, y, rp, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(214,222,232,0.55)';
      g.lineWidth = Math.max(0.6, rp * 0.45);
      g.beginPath();
      g.arc(x, y, rp * 0.72, 0.25 * Math.PI, 0.85 * Math.PI);
      g.stroke();
    }
    this.tex.needsUpdate = true;
  }
}

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

function drawCluster(g: CanvasRenderingContext2D, w: number, h: number, st: { on: boolean; fuel: number; lamp: boolean; speed: number }): void {
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
  dial(w * 0.3, h * 0.56, r, Math.PI * 0.8, Math.PI * 2.2, 12, [[0, '0'], [0.33, '40'], [0.66, '80'], [1, '120']], st.speed);
  // fuel: E … F over a 100° arc; the needle may sit below E (negative)
  const fuel = Math.max(-0.06, Math.min(1, st.fuel));
  dial(w * 0.72, h * 0.62, r * 0.78, Math.PI * 1.22, Math.PI * 1.78, 4, [[0, 'E'], [1, 'F']], fuel);
  // low-fuel lamp (amber pump pictogram)
  const lx = w * 0.72;
  const ly = h * 0.86;
  g.fillStyle = st.lamp ? 'rgba(255,150,20,1)' : 'rgba(40,26,8,0.9)';
  g.fillRect(lx - 9, ly - 12, 12, 16);
  g.fillRect(lx + 4, ly - 8, 4, 10);
  if (st.lamp) {
    const rg = g.createRadialGradient(lx, ly - 4, 2, lx, ly - 4, 26);
    rg.addColorStop(0, 'rgba(255,160,40,0.45)');
    rg.addColorStop(1, 'rgba(255,160,40,0)');
    g.fillStyle = rg;
    g.fillRect(lx - 30, ly - 30, 60, 60);
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
        const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
        const t = tslTexture(rainSim.tex);
        m.colorNode = t.rgb;
        m.opacityNode = t.a;
        m.fog = false;
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
        clusterCanvas.height = 160;
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
      const ec = n.userData.emissive_color ?? (lamp === 'head' ? [1, 0.92, 0.75] : [0.8, 0.03, 0.02]);
      const col = new THREE.Color(ec[0], ec[1], ec[2]);
      n.traverse((mesh: any) => {
        if (!mesh.isMesh) return;
        const m = new THREE.MeshBasicNodeMaterial();
        const gain = lamp === 'head' ? headGlow : tailU;
        m.colorNode = vec4(col.r, col.g, col.b, 1).rgb.mul(gain.mul(lamp === 'head' ? 6 : 3).add(0.015));
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
  const redrawCluster = () => {
    if (!clusterCanvas) return;
    const lamp = dash.lamp === 'blink' ? dash.blinkOn : !!dash.lamp;
    drawCluster(clusterCanvas.getContext('2d')!, clusterCanvas.width, clusterCanvas.height, { on: dash.on, fuel: dash.fuel, lamp: dash.on && lamp, speed: dash.speed });
    clusterTex.needsUpdate = true;
    clusterGain.value = dash.on ? 1.4 : 0.25;
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

  // ---- C5 shadow-play: the table candle's shadow light, repurposed as the window flash
  const shadowLight = level.lights.flickers.find((f) => f.def.id === 'L_CANDLE_TABLE') ?? null;
  let shadow: { id: string; t: number; saved: { pos: any; color: any; distance: number; cast: boolean } } | null = null;
  const SHADOW_LIGHT_POS = planToWorld([5.35, 0.75, 1.95]);
  const ADA_SIL: [number, number, number] = [5.1, 3.05, 0.6];
  const HARLAN_SIL: [number, number, number] = [5.5, 3.55, 0.6];
  const silhouetteOn = (id: string) => {
    const bank = d.characters;
    if (bank) {
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
      shadow = { id, t: 0, saved: { pos: L.position.clone(), color: L.color.clone(), distance: L.distance, cast: L.castShadow } };
      L.position.set(...SHADOW_LIGHT_POS);
      L.color.setRGB(0.72, 0.82, 1.0);
      L.distance = 10;
      L.castShadow = true;
      L.shadow.mapSize.set(512, 512);
      L.shadow.bias = -0.002;
      if (shadowLight.flame) shadowLight.flame.visible = false;
    } else if (shadow) {
      shadow.id = id;
      shadow.t = 0;
    }
  };
  const silhouetteOff = () => {
    if (!shadow || !shadowLight) return;
    const L = shadowLight.light;
    L.position.copy(shadow.saved.pos);
    L.color.copy(shadow.saved.color);
    L.distance = shadow.saved.distance;
    L.castShadow = shadow.saved.cast;
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
      case 'wipers':
        wipersOn = !!p.on;
        if (p.period !== undefined) wiperPeriod = Number(p.period);
        if (wipersOn) wiperT = 0;
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
        if (p.on) silhouetteOn(String(p.id ?? 'unmask'));
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
        return false;
    }
  };

  /** Per frame, after the cutscene player applied the camera. */
  const update = (dt: number) => {
    // wipers
    const prev = cars.flatMap((c) => c.wipers.map((w) => w.a));
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
      const set = cars[0];
      let i = 0;
      const blades = (set?.wipers ?? []).map((w) => ({ s: w.s, t: w.t, len: w.len, a0: w.restAng + w.planeSign * (prev[i++] ?? w.a), a1: w.restAng + w.planeSign * w.a }));
      rainSim.step(dt, blades);
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
      const lvl = d.lightningLevel();
      shadowLight.light.intensity = 0.02 + lvl * 38;
    }
  };

  /** Load-time warm-up: everything visible once (compiled with the level), then hidden in `start`. */
  const setWarm = (on: boolean) => {
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
    debug: () => ({ cars: cars.map((c) => ({ id: c.id, glass: !!c.glass, wipers: c.wipers.length, cluster: !!c.cluster, lamps: c.lamps.head.length + c.lamps.tail.length })), rope: ropePath.length, sheaves: sheaves.length, drops: rainSim?.drops.length ?? 0 }),
  };
}

const _q = new THREE.Quaternion();

export type CutsceneFx = ReturnType<typeof createCutsceneFx>;
