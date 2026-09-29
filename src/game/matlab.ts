// MATERIAL LAB (?scene=matlab) — every material-spec entry baked at the current preset and shown on a panel + a
// sphere under a moving flashlight and a flickering candle, with labels, bake timings and the avgAlbedo check.
//
// URL options (all optional):
//   &mat=<id>            focus one material (big wall panel, floor patch, sphere, cube)
//   &only=a,b,c          subset of ids (grid mode)
//   &preset=low|medium|max   override the saved preset (bake sizes, pipeline)
//   &light=studio|dark   studio = static key + fill (judging texture); dark = flashlight + candle only (default: both
//                        moving + a dim fill). Keys: L cycles light modes, 1/2 toggle macro/dust layers.
//   &test=bump           bake the asymmetric bump test only (normal handedness check, both backends)
//   &debug               window.__matlab

import * as THREE from 'three/webgpu';
import { float, uint, uv, vec4 } from 'three/tsl';
import type { BootHandoff } from '../boot/handoff.ts';
import type { PresetId } from '../shared/types.ts';
import type { MaterialSpec } from '../shared/material-types.ts';
import { PRESETS } from '../render/presets.ts';
import { createRenderer, effectivePixelRatio } from '../render/renderer.ts';
import { createPipeline } from '../render/pipeline.ts';
import { flashlightCookie } from '../render/flashlight.ts';
import { prepareLightmapTexture } from '../render/lightmap-material.ts';
import { ALBEDO_TOLERANCE, MaterialBaker, bumpTestGenerator, readFloatTarget, textureSizeFor, type BakedMaterial } from '../materials/baker.ts';
import { MATERIAL_SPECS, createSurfaceMaterial, materialUniforms } from '../materials/bind.ts';
import { generatorFor, hasDedicatedGenerator, superTileFor } from '../materials/library/index.ts';
import { tkHash2u } from '../materials/tsl-noise.ts';
import { ALBEDO_CAL } from '../materials/library/calibration.ts';
import { hash2u, seedHash } from '../materials/noise-cpu.ts';

type LightMode = 'moving' | 'studio' | 'dark';

/** Rescales a geometry's 0..1 uv to metres (PROPS.md: UV0 is in metres). */
function uvToMetres(g: any, su: number, sv: number): any {
  const a = g.attributes.uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * su, a.getY(i) * sv);
  a.needsUpdate = true;
  return g;
}

function boxMetres(s: number): any {
  return uvToMetres(new THREE.BoxGeometry(s, s, s), s, s);
}

export async function startMatlab(h: BootHandoff): Promise<void> {
  const params = new URLSearchParams(location.search);
  const presetId = ((params.get('preset') as PresetId | null) ?? h.settings.preset) as PresetId;
  const preset = PRESETS[presetId] ?? PRESETS[h.settings.preset];
  const forceWebGL = h.settings.forceWebGL || params.get('backend') === 'webgl';
  const focusId = params.get('mat');
  const only = params.get('only')?.split(',').filter(Boolean) ?? null;
  const bumpTest = params.get('test') === 'bump';
  let lightMode: LightMode = (params.get('light') as LightMode) || 'moving';

  const gameRoot = document.getElementById('game') ?? document.body;
  gameRoot.style.display = 'block';
  gameRoot.style.visibility = 'hidden';
  h.status('Material lab: starting the renderer…');
  const { renderer, backend } = await createRenderer(preset, { forceWebGL, parent: gameRoot });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020203);
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 80);
  scene.add(camera);

  // ---- GPU vs CPU hash check (the TSL hash must be bit-identical to noise-cpu.ts)
  const hashCheck = await checkHash(renderer);

  // ---- bake
  let specs: MaterialSpec[] = MATERIAL_SPECS;
  if (focusId) specs = specs.filter((s) => s.id === focusId);
  else if (only) specs = specs.filter((s) => only.includes(s.id));
  const baker = new MaterialBaker(renderer, preset.textures.anisotropy);
  const baked = new Map<string, BakedMaterial>();
  const t0 = performance.now();
  if (bumpTest) {
    const spec: MaterialSpec = { ...MATERIAL_SPECS[0], id: 'bump_test', tileMetres: 1, hero: true, wetness: 0, avgAlbedo: [0.5, 0.35, 0.5], roughness: 0.4 };
    baked.set(spec.id, await baker.bake(spec, bumpTestGenerator, preset.textures.heroSize));
    specs = [spec];
  } else {
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      h.status(`Material lab: baking ${s.id} (${i + 1}/${specs.length})…`);
      try {
        baked.set(s.id, await baker.bake(s, generatorFor(s), textureSizeFor(s, preset), superTileFor(s)));
      } catch (e) {
        console.error(`[matlab] bake failed: ${s.id}`, e);
      }
    }
  }
  const bakeMs = performance.now() - t0;
  baker.releaseScratch();

  // ---- scene
  // &tangents=1: give every lab mesh vertex tangents (the character-GLB path) — the bump test must still light
  // from the same side. &lm=1: bind through LightmapMaterial with a flat synthetic lightmap (static-level path).
  // tangents=gltf emulates Blender-exported glTF tangents: three's computeTangents() with the bitangent sign (w)
  // negated, because the exporter flips V (glTF bitangent points toward decreasing uv.y). bind.ts flips the normal
  // map's y for meshes carrying a tangent attribute, i.e. for that convention. tangents=three = raw computeTangents.
  const tanMode = params.get('tangents');
  const useTangents = tanMode === 'gltf' || tanMode === 'three';
  let lightmap: { base: any } | null = null;
  if (params.get('lm') === '1') {
    const n = 4 * 4 * 4;
    const d = new Uint16Array(n);
    for (let i = 0; i < n; i++) d[i] = THREE.DataUtils.toHalfFloat(i % 4 === 3 ? 1 : 0.08);
    lightmap = { base: prepareLightmapTexture(new THREE.DataTexture(d, 4, 4, THREE.RGBAFormat, THREE.HalfFloatType)) };
  }
  const prepGeo = (g: any) => {
    if (lightmap && !g.attributes.uv1) g.setAttribute('uv1', g.attributes.uv.clone());
    if (useTangents && g.index) {
      g.computeTangents();
      if (tanMode === 'gltf') {
        const t = g.attributes.tangent;
        for (let i = 0; i < t.count; i++) t.setW(i, -t.getW(i));
      }
    }
    return g;
  };
  const matFor = (s: MaterialSpec, layers?: { macro?: boolean; dust?: boolean }) =>
    createSurfaceMaterial(s, baked.get(s.id) ?? null, { preset, layers, side: s.family === 'glass' ? THREE.DoubleSide : THREE.FrontSide, vertexTangents: tanMode === 'gltf', lightmap });
  const labels: Array<{ el: HTMLDivElement; pos: any }> = [];
  const labelRoot = document.createElement('div');
  Object.assign(labelRoot.style, { position: 'fixed', inset: '0', pointerEvents: 'none', font: '11px ui-monospace, Menlo, monospace', color: '#cfc8bb' });
  document.body.appendChild(labelRoot);
  const addLabel = (text: string, pos: any, bad: boolean) => {
    const el = document.createElement('div');
    el.textContent = text;
    Object.assign(el.style, { position: 'absolute', whiteSpace: 'pre', transform: 'translate(-50%, 0)', textAlign: 'center', textShadow: '0 1px 2px #000', color: bad ? '#ff9a7a' : '#cfc8bb' });
    labelRoot.appendChild(el);
    labels.push({ el, pos });
  };

  // Backdrop: a dark neutral room so bounce/fill reads like the game.
  const neutral = new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0.03, 0.03, 0.03), roughness: 0.9 });
  const room = new THREE.Mesh(new THREE.BoxGeometry(40, 12, 40), new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0.02, 0.02, 0.022), roughness: 0.95, side: THREE.BackSide }));
  room.position.y = 5.99;
  scene.add(room);
  void neutral;

  const allMaterials: Array<{ spec: MaterialSpec; meshes: any[] }> = [];
  const spheres: any[] = [];
  let center = new THREE.Vector3(0, 1.2, 0);

  if (focusId || bumpTest || specs.length === 1) {
    const s = specs[0];
    const mA = matFor(s);
    const wall = new THREE.Mesh(prepGeo(uvToMetres(new THREE.PlaneGeometry(2.6, 2.6), 2.6, 2.6)), mA);
    wall.position.set(0, 1.3, -1.2);
    const floorP = new THREE.Mesh(prepGeo(uvToMetres(new THREE.PlaneGeometry(3, 2.4), 3, 2.4)), mA);
    floorP.rotation.x = -Math.PI / 2;
    floorP.position.set(0, 0.001, 0);
    const sph = new THREE.Mesh(prepGeo(uvToMetres(new THREE.SphereGeometry(0.32, 96, 48), 2 * Math.PI * 0.32, Math.PI * 0.32)), mA);
    sph.position.set(-0.55, 0.32, 0.1);
    const cube = new THREE.Mesh(prepGeo(boxMetres(0.5)), mA);
    cube.position.set(0.6, 0.25, 0.05);
    cube.rotation.y = 0.6;
    for (const m of [wall, floorP, sph, cube]) {
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    }
    spheres.push(sph);
    allMaterials.push({ spec: s, meshes: [wall, floorP, sph, cube] });
    const b = baked.get(s.id);
    addLabel(`${s.id}  ${b ? `${b.size}² ${b.totalMs.toFixed(0)} ms  albedo err ${(b.albedoError * 100).toFixed(0)}%` : ''}`, new THREE.Vector3(0, 2.72, -1.2), !!b && b.albedoError > ALBEDO_TOLERANCE);
    camera.position.set(0.2, 1.45, 2.6);
    center = new THREE.Vector3(0, 0.8, -0.4);
  } else {
    const cols = Math.min(10, Math.max(3, Math.ceil(Math.sqrt(specs.length * 1.8))));
    const pitch = 1.25;
    const rows = Math.ceil(specs.length / cols);
    specs.forEach((s, i) => {
      const cx = ((i % cols) - (cols - 1) / 2) * pitch;
      const cy = 0.35 + (rows - 1 - Math.floor(i / cols)) * 1.3;
      const m = matFor(s);
      const panel = new THREE.Mesh(prepGeo(uvToMetres(new THREE.PlaneGeometry(1.05, 1.05), 1.05, 1.05)), m);
      panel.position.set(cx, cy + 0.55, -0.3);
      const sph = new THREE.Mesh(prepGeo(uvToMetres(new THREE.SphereGeometry(0.2, 64, 32), 2 * Math.PI * 0.2, Math.PI * 0.2)), m);
      sph.position.set(cx + 0.25, cy + 0.32, 0.0);
      for (const x of [panel, sph]) {
        x.castShadow = x.receiveShadow = true;
        scene.add(x);
      }
      spheres.push(sph);
      allMaterials.push({ spec: s, meshes: [panel, sph] });
      const b = baked.get(s.id);
      const bad = !!b && b.albedoError > ALBEDO_TOLERANCE;
      const gen = hasDedicatedGenerator(s) ? '' : ' (generic)';
      addLabel(`${s.id}${gen}\n${b ? `${b.size}² ${b.totalMs.toFixed(0)}ms ±${(b.albedoError * 100).toFixed(0)}%` : s.source}`, new THREE.Vector3(cx, cy - 0.06, -0.3), bad);
    });
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(cols * pitch + 0.6, 0.04, 0.9), new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(0.02, 0.02, 0.02), roughness: 0.8 }));
    shelf.position.set(0, 0.0, -0.1);
    scene.add(shelf);
    const tanH = Math.tan(((camera.fov / 2) * Math.PI) / 180);
    const dist = Math.max((rows * 1.3) / (2 * tanH), (cols * pitch) / (2 * tanH * camera.aspect)) * 1.02 + 0.3;
    camera.position.set(0, (rows * 1.3) / 2 + 0.2, dist);
    center = new THREE.Vector3(0, (rows * 1.3) / 2, -0.3);
  }

  // ---- lights
  const fill = new THREE.HemisphereLight(0x8090a8, 0x201810, 0.06);
  scene.add(fill);
  const key = new THREE.DirectionalLight(0xfff2e0, 1.5);
  key.position.set(-3, 4, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -8;
  key.shadow.camera.right = key.shadow.camera.top = 8;
  scene.add(key);
  const spot = new THREE.SpotLight(0xfff1dc, 60, 22, Math.PI / 7.5, 0.45, 2);
  spot.colorNode = flashlightCookie;
  spot.castShadow = true;
  spot.shadow.mapSize.set(preset.shadows.flashlightMapSize, preset.shadows.flashlightMapSize);
  spot.shadow.bias = -0.0004;
  scene.add(spot, spot.target);
  const candle = new THREE.PointLight(0xff9a45, 1.6, 6, 2);
  candle.castShadow = false;
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(4, 2.2, 0.8) }));
  candle.add(flame);
  scene.add(candle);

  let applyEnv = () => {};
  const applyLightMode = () => {
    applyEnv();
    key.visible = lightMode === 'studio';
    fill.intensity = lightMode === 'studio' ? 0.35 : lightMode === 'dark' ? 0.012 : 0.06;
    spot.visible = lightMode !== 'studio';
    candle.visible = lightMode !== 'studio';
  };
  applyLightMode();

  // ---- pipeline, controls
  const pipeline = createPipeline(renderer, scene, camera, preset);
  const controls = new MiniOrbit(camera, renderer.domElement, center);
  // Studio reflections: a code-built softbox room → PMREM (no assets; three/addons RoomEnvironment would pull a
  // second copy of three via its bare 'three' import).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(softboxScene(), 0.02);
  applyEnv = () => {
    scene.environment = lightMode === 'studio' ? envRT.texture : null;
    scene.environmentIntensity = 0.5;
  };

  // ---- HUD
  const hud = document.createElement('div');
  Object.assign(hud.style, { position: 'fixed', left: '10px', top: '10px', font: '12px ui-monospace, Menlo, monospace', color: '#e8e0d0', background: 'rgba(0,0,0,0.55)', padding: '8px 10px', whiteSpace: 'pre', pointerEvents: 'none', maxWidth: '46vw' });
  document.body.appendChild(hud);
  const results = [...baked.values()];
  const bad = results.filter((b) => b.albedoError > ALBEDO_TOLERANCE);
  const bytes = baker.totalBytes();
  const hudText = () =>
    [
      `MATERIAL LAB · ${preset.label} · ${backend} · hero ${preset.textures.heroSize}² base ${preset.textures.baseSize}² · aniso ${baker.anisotropy}`,
      `baked ${results.length} in ${bakeMs.toFixed(0)} ms (sum GPU-complete ${results.reduce((a, b) => a + b.totalMs, 0).toFixed(0)} ms) · maps ${(bytes / 1048576).toFixed(0)} MB`,
      `hash GPU==CPU: ${hashCheck}`,
      `avgAlbedo ±${ALBEDO_TOLERANCE * 100}%: ${results.length - bad.length}/${results.length} ok${bad.length ? ' · off: ' + bad.map((b) => `${b.id} ${(b.albedoError * 100).toFixed(0)}%`).join(', ') : ''}`,
      `light: ${lightMode} (L) · macro ${materialUniforms.macro.value} (1) · dust ${materialUniforms.dust.value} (2)`,
    ].join('\n');
  hud.textContent = hudText();
  console.info(`[matlab] ${hudText()}`);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyL') {
      lightMode = lightMode === 'moving' ? 'studio' : lightMode === 'studio' ? 'dark' : 'moving';
      applyLightMode();
    }
    if (e.code === 'Digit1') materialUniforms.macro.value = materialUniforms.macro.value ? 0 : 1;
    if (e.code === 'Digit2') materialUniforms.dust.value = materialUniforms.dust.value ? 0 : 1;
    hud.textContent = hudText();
  });
  window.addEventListener('resize', () => {
    renderer.setPixelRatio(effectivePixelRatio(preset));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  // ---- animate
  let frozenT: number | null = params.has('t') ? Number(params.get('t')) : null;
  const clockStart = performance.now();
  const v = new THREE.Vector3();
  const update = (t: number) => {
    // Flashlight: held near the camera, sweeping a Lissajous over the subject.
    spot.position.copy(camera.position).add(new THREE.Vector3(0.25, -0.2, 0).applyQuaternion(camera.quaternion));
    const span = focusId || bumpTest ? 1.2 : 5;
    spot.target.position.set(center.x + Math.sin(t * 0.37) * span, center.y + Math.sin(t * 0.53) * span * 0.45, center.z - 0.3);
    spot.target.updateMatrixWorld();
    candle.position.set(center.x + Math.sin(t * 0.21) * (focusId ? 0.9 : 5.2), focusId ? 0.55 : center.y - 0.2 + Math.sin(t * 0.13) * 1.2, focusId ? 0.6 : 0.75);
    candle.intensity = 1.6 * (0.85 + 0.1 * Math.sin(t * 13.1) + 0.05 * Math.sin(t * 31.7 + 1.3));
    for (const l of labels) {
      v.copy(l.pos).project(camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      l.el.style.display = vis ? 'block' : 'none';
      if (vis) {
        l.el.style.left = `${((v.x + 1) / 2) * window.innerWidth}px`;
        l.el.style.top = `${((1 - v.y) / 2) * window.innerHeight}px`;
      }
    }
  };
  h.status('Material lab: compiling…');
  update(frozenT ?? 0);
  pipeline.render();
  if (h.bootRoot) h.bootRoot.style.display = 'none';
  gameRoot.style.visibility = 'visible';
  renderer.setAnimationLoop(() => {
    const t = frozenT ?? (performance.now() - clockStart) / 1000;
    controls.update();
    update(t);
    pipeline.render();
  });

  const api = {
    renderer,
    scene,
    camera,
    controls,
    baker,
    baked,
    pipeline,
    uniforms: materialUniforms,
    report: () =>
      results.map((b) => ({ id: b.id, size: b.size, ms: +b.totalMs.toFixed(1), submitMs: +b.submitMs.toFixed(1), err: +(b.albedoError * 100).toFixed(1), measured: b.measured.map((x) => +x.toFixed(4)), gain: b.gain.map((x) => +x.toFixed(3)), rough: +b.roughnessMean.toFixed(3) })),
    summary: () => ({ preset: preset.id, backend, count: results.length, bakeMs: +bakeMs.toFixed(0), mb: +(bytes / 1048576).toFixed(1), hash: hashCheck, bad: bad.map((b) => b.id) }),
    /** New ALBEDO_CAL table text: old calibration × spec.avgAlbedo / measured (see library/calibration.ts). */
    calibration: () => {
      const rows = specs
        .filter((sp) => baked.has(sp.id))
        .map((sp) => {
          const b = baked.get(sp.id)!;
          const old = ALBEDO_CAL[sp.id] ?? [1, 1, 1];
          const k = [0, 1, 2].map((i) => +Math.min(4, Math.max(0.25, (old[i] * sp.avgAlbedo[i]) / Math.max(b.measured[i], 1e-4))).toFixed(3));
          return `  ${sp.id}: [${k.join(', ')}],`;
        });
      return `export const ALBEDO_CAL: Record<string, [number, number, number]> = {\n${rows.join('\n')}\n};\n`;
    },
    freeze: (t: number | null) => (frozenT = t),
    setLight: (m: LightMode) => {
      lightMode = m;
      applyLightMode();
      hud.textContent = hudText();
    },
    view: (pos: number[], target: number[]) => {
      camera.position.set(pos[0], pos[1], pos[2]);
      controls.target.set(target[0], target[1], target[2]);
      controls.sync();
    },
    hud: (on: boolean) => {
      hud.style.display = on ? 'block' : 'none';
      labelRoot.style.display = on ? 'block' : 'none';
    },
    /** PNG data URL of the next frame (WebGPU canvases clear after present: render first, then read synchronously). */
    snapshot: () => {
      pipeline.render();
      return renderer.domElement.toDataURL('image/png');
    },
  };
  (window as unknown as { __matlab: unknown }).__matlab = api;
}

/** Renders tkHash2u for a 16×16 lattice into a float target and compares every texel with the CPU hash. */
async function checkHash(renderer: any): Promise<string> {
  try {
    const S = seedHash(1234);
    const rt = new THREE.RenderTarget(16, 16, { type: THREE.FloatType, depthBuffer: false });
    const m = new THREE.NodeMaterial();
    const cell = uv().mul(16).floor();
    const hsh = tkHash2u(cell, uint(S));
    // Split into two 16-bit halves: exact in float32.
    m.fragmentNode = vec4(float(hsh.shiftRight(uint(16))), float(hsh.bitAnd(uint(0xffff))), cell.x, cell.y);
    const q = new THREE.QuadMesh(m);
    renderer.setRenderTarget(rt);
    q.render(renderer);
    renderer.setRenderTarget(null);
    // WebGL2's async readback polls with rAF (paused in hidden tabs): don't let the lab hang on it.
    const px = await Promise.race([readFloatTarget(renderer, rt, 16, 16), new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
    if (!px) return 'skipped (readback timed out — hidden tab?)';
    let bad = 0;
    for (let i = 0; i < 256; i++) {
      const hi = px[i * 4];
      const lo = px[i * 4 + 1];
      const x = px[i * 4 + 2];
      const y = px[i * 4 + 3];
      const cpu = hash2u(x, y, S);
      if (((hi << 16) >>> 0) + lo !== cpu) bad++;
    }
    rt.dispose();
    m.dispose();
    return bad === 0 ? 'ok (256/256)' : `MISMATCH ${bad}/256`;
  } catch (e) {
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Minimal orbit camera (drag = orbit, wheel = dolly, right-drag = pan). */
class MiniOrbit {
  target: any;
  private cam: any;
  private sph = new THREE.Spherical();
  constructor(cam: any, el: HTMLElement, target: any) {
    this.cam = cam;
    this.target = target.clone();
    this.sync();
    let drag = -1;
    let lx = 0;
    let ly = 0;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      drag = e.button;
      lx = e.clientX;
      ly = e.clientY;
    });
    window.addEventListener('pointerup', () => (drag = -1));
    window.addEventListener('pointermove', (e) => {
      if (drag < 0) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      if (drag === 0) {
        this.sph.theta -= dx * 0.005;
        this.sph.phi = Math.min(Math.PI - 0.05, Math.max(0.05, this.sph.phi - dy * 0.005));
      } else {
        const s = this.sph.radius * 0.0015;
        const right = new THREE.Vector3().setFromMatrixColumn(this.cam.matrix, 0).multiplyScalar(-dx * s);
        const up = new THREE.Vector3().setFromMatrixColumn(this.cam.matrix, 1).multiplyScalar(dy * s);
        this.target.add(right).add(up);
      }
      this.apply();
    });
    el.addEventListener('wheel', (e) => {
      this.sph.radius = Math.max(0.2, this.sph.radius * Math.exp(e.deltaY * 0.001));
      this.apply();
    });
  }
  sync(): void {
    this.sph.setFromVector3(this.cam.position.clone().sub(this.target));
    this.apply();
  }
  apply(): void {
    this.cam.position.setFromSpherical(this.sph).add(this.target);
    this.cam.lookAt(this.target);
  }
  update(): void {}
}

/** A dim grey room with two warm softboxes and a cool strip — reflection source for studio mode. */
function softboxScene(): any {
  const s = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 12), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0.05, 0.05, 0.055), side: THREE.BackSide }));
  s.add(room);
  const panel = (w: number, h: number, c: [number, number, number], p: [number, number, number]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(...c), side: THREE.DoubleSide }));
    m.position.set(...p);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  panel(3, 2, [6, 5.4, 4.6], [-3, 2.5, 4]);
  panel(2, 1.5, [3, 2.8, 2.5], [4, 2, 2]);
  panel(4, 0.4, [1.2, 1.4, 1.8], [0, 2.9, -4]);
  return s;
}
