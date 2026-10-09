// Render pipelines per preset (docs/PLAN.md §2.4; APIs verified against three r186 sources).
//
// Low    : DirectRenderPipeline (output processing inside material shaders, MSAA from the renderer) →
//          renderOutput(AgX, sRGB) → vignette × hash grain. outputColorTransform=false + explicit tone map / colour
//          space, because DirectRenderPipeline sets renderer.toneMapping = NoToneMapping while it renders.
// Medium : RenderPipeline: pass(scene) MRT{output, velocity} at preset.sceneScale → TAAU → sharpen → lens CA (HDR)
//          + bloom → exposure / white balance / grade → renderOutput (outputColorTransform=false) → vignette × grain.
// Max    : Medium + GTAO prepass (normals, half-res AO) injected with a lightmap-aware getAO (lightmapped surfaces
//          already contain Cycles occlusion → keep only LIGHTMAP_AO_STRENGTH of it).
// Grain is always applied after TAAU / renderOutput: zero-mean, multiplicative (src/render/camera-fx.ts filmFinish).
// Cutscenes: setCutscene({ dof, motionBlur }) swaps in DOF / motion blur (outputNode rebuild + needsUpdate).

import * as THREE from 'three/webgpu';
import {
  context,
  float,
  Fn,
  smoothstep,
  luminance,
  mix,
  mrt,
  normalView,
  output,
  packNormalToRGB,
  pass,
  renderOutput,
  sample,
  screenUV,
  time,
  uniform,
  unpackRGBToNormal,
  vec3,
  vec4,
  velocity,
} from 'three/tsl';
import { taau } from 'three/addons/tsl/display/TAAUNode.js';
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

// Bloom high pass with a saturating excess (see the bloom call in the chain builder): same smoothstep gate as r186's
// luminosityHighPass, but the luminance above threshold T is compressed to e / (1 + e / (GLARE_SAT · T)).
const GLARE_SAT = 24;
/** Runtime E review: fraction of the threshold itself forwarded to the glare (LOOK.glareBase; 1 = r186 stock / round D,
 *  0 = only the light ABOVE the threshold scatters). Live uniform, synced by atmosphere.ts. */
export const GLARE_BASE = uniform(1);
const glareHighPass = Fn(({ input, threshold, smoothWidth }: any) => {
  const v = luminance(input.rgb);
  const alpha = smoothstep(threshold, threshold.add(smoothWidth), v);
  const e = v.sub(threshold).max(0);
  const target = threshold.mul(GLARE_BASE).add(e.div(e.div(threshold.mul(GLARE_SAT)).add(1)));
  const k = target.div(v.max(1e-6));
  return mix(vec4(0), vec4(input.rgb.mul(k), input.a), alpha);
});
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import type { PresetConfig } from './presets.ts';
import { lensCA, filmFinish } from './camera-fx.ts'; // LIGHTING lane: lens CA, film grain (REALISM-BACKLOG 1, 8)

/** Fraction of GTAO applied to lightmapped materials (Cycles bakes already contain occlusion). */
export const LIGHTMAP_AO_STRENGTH = 0.35;

export interface CutsceneFx {
  dof?: { focusDistance: number; focalLength: number; bokehScale: number };
  /** Motion-blur amount (velocity multiplier), Max only. */
  motionBlur?: number;
}

export interface Pipeline {
  /** 'direct' = Low with canvas MSAA (WebGL2); 'fxaa' = Low without MSAA (WebGPU); 'post' = Medium/Max. */
  readonly kind: 'direct' | 'fxaa' | 'post';
  /** Uniforms live-tunable from gameplay (lightning exposure kick, grain …). */
  readonly uniforms: {
    exposure: any;
    grain: any;
    vignette: any;
    chromaticAberration: any;
    bloomStrength: any;
    /** Glare high-pass threshold in EXPOSED (display) units — LOOK.bloomThreshold. */
    bloomThreshold: any;
    /** Scene grade (HDR, before tone mapping): colour multiplier (C6/B12 blue hour, dawn) … */
    tint: any;
    /** … and saturation (1 = unchanged). */
    saturation: any;
    /** LIGHTING lane: camera white balance gain (linear sRGB, per zone — src/world/atmosphere.ts). */
    whiteBalance: any;
    /** LIGHTING lane: RCAS sharpness (0 = max, 2 = none) and grain gain per EV of exposure. */
    sharpness: any;
    grainPerEV: any;
  };
  /** LIGHTING lane: the HDR scene colour (pre-exposure) the exposure meter reads; null on the Direct path. */
  readonly meterTexture: any | null;
  render(): void;
  /** Scene-pass resolution scale (post pipeline only; no-op on Low). */
  setScale(s: number): void;
  getScale(): number;
  /** Swap in cutscene DOF / motion blur (null = gameplay chain). Ignored where the preset disables it. */
  setCutscene(fx: CutsceneFx | null): void;
  /**
   * PERF-PLAN P0-1: compiles (async) everything the camera sees with the current culling, in the context the frame is
   * really drawn in, so the next render finds its shader pipelines ready. Render nothing until it resolves.
   */
  compileView(): Promise<void>;
  dispose(): void;
}

// ==== PERF lane: compileView (docs/PERF-PLAN.md P0-1) =========================================================
// renderer.compileAsync(scene, camera) alone compiles for the renderer's default context (framebuffer target, no
// MRT, call depth 0), which no frame of ours is drawn in. Render objects are keyed by (object, material, render
// context, lights node) and a render context by (attachments, MRT, call depth) — RenderObjects.js:99-118,
// RenderContexts.js:41-75 — and node builds read renderer.contextNode / render target / tone mapping at build time
// (NodeBuilder.js:3126, NodeManager.js:690). So compile with exactly the state the frame uses, and keep it until
// compileAsync resolves (its node builds run after awaits).

/** Per pass: the call depth it renders its scene at (PassNode.updateBefore → renderer.render → depth + 1) and the
 *  renderer.contextNode active then (a pass without its own contextNode inherits it — e.g. a pass nested in another). */
type PassState = { depth: number; ctx: any };
function trackPass(renderer: any, passNode: any, states: Map<any, PassState>): void {
  const orig = passNode.updateBefore;
  passNode.updateBefore = function (frame: any) {
    states.set(passNode, { depth: renderer._callDepth + 1, ctx: renderer.contextNode });
    return orig.call(this, frame);
  };
}

/** One frame with the scene hidden: builds the post chain, sizes the pass targets and records their call depths. */
function primeFrame(renderer: any, scene: any, render: () => void): void {
  const vis = scene.visible;
  scene.visible = false;
  try {
    renderer._nodes?.nodeFrame?.update();
    render();
  } finally {
    scene.visible = vis;
  }
}

/** renderer.compileAsync in a PassNode's context (PassNode.updateBefore state + RenderPipeline's tone-mapping swap). */
async function compileInPass(renderer: any, scene: any, camera: any, p: any, st: PassState, velProj: any = null): Promise<void> {
  const depth = st.depth;
  const rc = renderer._renderContexts;
  const saved = {
    rt: renderer.getRenderTarget(),
    mrt: renderer.getMRT(),
    ctx: renderer.contextNode,
    tm: renderer.toneMapping,
    cs: renderer.outputColorSpace,
    tr: renderer.transparent,
    op: renderer.opaque,
  };
  renderer.setRenderTarget(p.renderTarget);
  renderer.setMRT(p.getMRT());
  renderer.transparent = p.transparent;
  renderer.opaque = p.opaque;
  renderer.contextNode = p.contextNode !== null && p._contextNodeCache ? p._contextNodeCache.context : st.ctx;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.ColorManagement.workingColorSpace;
  // runtime lane D (C0 21.2 s freeze, scratch/rd/pd3.log): TAAU sets velocity.setProjectionMatrix(its unjittered
  // matrix) only inside its own updateBefore (TAAUNode.js:335/366), so the frame's programs read the projection from an
  // object uniform while compileAsync built them with render.cameraProjectionMatrix — a different WGSL program for
  // every material; the C0 cabin/road materials compiled their frame variant mid-cinematic. Compile with TAAU's state.
  const velPrev = velocity.projectionMatrix ?? null;
  if (velProj) velocity.setProjectionMatrix(velProj);
  let job: Promise<void>;
  // compileAsync takes its render context synchronously, before its first await: patch the depth just for that call
  const get = rc.get;
  rc.get = function (rt: any, mrt: any, d?: number) {
    return get.call(this, rt, mrt, d === undefined ? depth : d);
  };
  try {
    job = renderer.compileAsync(scene, camera);
  } finally {
    delete rc.get;
    if (rc.get !== get) rc.get = get;
  }
  try {
    await job;
  } finally {
    renderer.setRenderTarget(saved.rt);
    renderer.setMRT(saved.mrt);
    renderer.contextNode = saved.ctx;
    renderer.toneMapping = saved.tm;
    renderer.outputColorSpace = saved.cs;
    renderer.transparent = saved.tr;
    renderer.opaque = saved.op;
    if (velProj) velocity.setProjectionMatrix(velPrev);
  }
}

/** compileView for a RenderPipeline whose scene is drawn by `passes` (in order). */
function passCompiler(renderer: any, scene: any, camera: any, passes: any[], render: () => void, velProj: any = null): () => Promise<void> {
  const states = new Map<any, PassState>();
  for (const p of passes) trackPass(renderer, p, states);
  return async () => {
    if (passes.some((p) => !states.has(p))) primeFrame(renderer, scene, render);
    for (const p of passes) await compileInPass(renderer, scene, camera, p, states.get(p) ?? { depth: 1, ctx: renderer.contextNode }, velProj);
  };
}

/** compileView for DirectRenderPipeline: its render() state (DirectRenderPipeline.js render) around compileAsync. */
async function compileDirect(renderer: any, scene: any, camera: any, rp: any): Promise<void> {
  rp._update(); // (re)builds rp._contextNode (getOutput → grade / AgX / finish inside every material)
  const bg = rp._getBackgroundNode(scene);
  const saved = { bg: scene.backgroundNode, ctx: renderer.contextNode, tm: renderer.toneMapping, cs: renderer.outputColorSpace };
  if (bg !== null) scene.backgroundNode = bg;
  renderer.contextNode = rp._contextNode;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.ColorManagement.workingColorSpace;
  try {
    await renderer.compileAsync(scene, camera);
  } finally {
    if (bg !== null) scene.backgroundNode = saved.bg;
    renderer.contextNode = saved.ctx;
    renderer.toneMapping = saved.tm;
    renderer.outputColorSpace = saved.cs;
  }
}
// ==== end PERF lane: compileView ================================================================================

export function createPipeline(renderer: any, scene: any, camera: any, preset: PresetConfig): Pipeline {
  const uniforms = {
    exposure: uniform(1),
    grain: uniform(preset.post.filmGrain),
    vignette: uniform(preset.post.vignette),
    chromaticAberration: uniform(preset.post.chromaticAberration),
    bloomStrength: uniform(0.22),
    bloomThreshold: uniform(1.5),
    tint: uniform(new THREE.Color(1, 1, 1)),
    saturation: uniform(1),
    whiteBalance: uniform(new THREE.Color(1, 1, 1)),
    sharpness: uniform(preset.post.sharpen),
    grainPerEV: uniform(0.25),
  };
  const finish = filmFinish(uniforms.vignette, uniforms.grain, uniforms.exposure, uniforms.grainPerEV);
  /** rgb → graded rgb (white balance → saturation → tint). */
  const grade = (c: any) => {
    const wb = c.mul(uniforms.whiteBalance);
    const l = luminance(wb);
    return mix(vec3(l, l, l), wb, uniforms.saturation).mul(uniforms.tint);
  };
  /** rgba → graded rgba. */
  const grade4 = (c: any) => vec4(grade(c.rgb), c.a);

  // ==== PERF lane: Low without canvas MSAA (WebGPU) — docs/PERF-PLAN.md P0-3 ====
  // Same grade → AgX → vignette/grain as the Direct path below, drawn through one scene pass + FXAA instead of canvas
  // MSAA (WebGPU MSAA measured ~100× the frame cost). FXAA works on the display-referred image, before the grain.
  if (preset.pipeline === 'direct' && !(renderer.samples > 0)) {
    const rp = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera, { samples: 0 });
    const color = scenePass.getTextureNode();
    const ldr = renderOutput(vec4(grade(color.rgb.mul(uniforms.exposure)), color.a), THREE.AgXToneMapping, THREE.SRGBColorSpace);
    rp.outputColorTransform = false;
    rp.outputNode = finish(fxaa(ldr));
    const render = () => rp.render();
    return {
      kind: 'fxaa',
      uniforms,
      meterTexture: scenePass.getTexture('output'),
      render,
      setScale: () => {},
      getScale: () => 1,
      setCutscene: () => {},
      compileView: passCompiler(renderer, scene, camera, [scenePass], render),
      dispose: () => rp.dispose(),
    };
  }
  // ==== end PERF lane: Low FXAA ====

  if (preset.pipeline === 'direct') {
    const rp = new THREE.DirectRenderPipeline(renderer);
    rp.outputColorTransform = false;
    rp.outputNode = finish(renderOutput(vec4(grade(output.rgb.mul(uniforms.exposure)), output.a), THREE.AgXToneMapping, THREE.SRGBColorSpace));
    return {
      kind: 'direct',
      uniforms,
      meterTexture: null,
      render: () => rp.render(scene, camera),
      setScale: () => {},
      getScale: () => 1,
      setCutscene: () => {},
      compileView: () => compileDirect(renderer, scene, camera, rp), // PERF lane (P0-1)
      dispose: () => rp.dispose(),
    };
  }

  // ---- Post pipeline (Medium / Max) ----
  // runtime lane E (item 3): one RenderPipeline per chain shape. A single pipeline whose outputNode was swapped
  // (rp.needsUpdate → RenderPipeline._updateContext → quad material needsUpdate) re-built the whole post graph at every
  // switch — the C0 12.5 s first-DOF hitch (0.2 s Medium / 0.4 s Max). Each chain keeps its own quad material now, so a
  // cut only picks which pipeline renders; the scene pass / TAAU / bloom nodes are shared.
  const rps = new Map<string, any>();
  let rp: any = null;
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, velocity }));
  let scale = preset.sceneScale;
  scenePass.setResolutionScale(scale);

  const color = scenePass.getTextureNode('output');
  const depth = scenePass.getTextureNode('depth');
  const vel = scenePass.getTextureNode('velocity');

  let prePass: any = null;
  if (preset.post.gtao) {
    prePass = pass(scene, camera);
    prePass.name = 'GTAO Pre-Pass';
    prePass.transparent = false;
    prePass.setMRT(mrt({ output: packNormalToRGB(normalView) }));
    prePass.getTexture('output').type = THREE.UnsignedByteType;
    prePass.setResolutionScale(scale);
    const prePassNormal = sample((uv: any) => unpackRGBToNormal(prePass.getTextureNode().sample(uv)));
    const aoPass = ao(prePass.getTextureNode('depth'), prePassNormal, camera);
    aoPass.resolutionScale = 0.5;
    aoPass.useTemporalFiltering = true;
    const aoValue = aoPass.getTextureNode().sample(screenUV).r;
    // Lightmap-aware AO (research.critique: GTAO would darken Cycles lightmaps a second time).
    scenePass.contextNode = context({
      getAO: (inputNode: any, builder: any) => {
        const material = builder.material;
        if (material?.transparent === true) return inputNode;
        const a = material?.userData?.lightmapped ? mix(float(1), aoValue, LIGHTMAP_AO_STRENGTH) : aoValue;
        return inputNode !== null && inputNode !== undefined ? inputNode.mul(a) : a;
      },
    });
  }

  const taauNode = taau(color, depth, vel, camera);
  // runtime lane D (C0 freeze, pd3b): TAAU nulls velocity's projection after every pipeline frame
  // (TAAUNode.clearViewOffset), so a render object first built outside that window (a chain's first frame, compileAsync)
  // got the render.cameraProjectionMatrix twin — a second WGSL program per material, compiled mid-cutscene. Keep the
  // velocity node on TAAU's unjittered matrix for the whole session: one program variant everywhere.
  velocity.setProjectionMatrix(taauNode._originalProjectionMatrix);
  {
    const clear = taauNode.clearViewOffset.bind(taauNode);
    taauNode.clearViewOffset = () => {
      clear();
      velocity.setProjectionMatrix(taauNode._originalProjectionMatrix);
    };
  }
  // RCAS: sharpness 0 = maximum, 2 = none (SharpenNode.js:29); denoise attenuates it on noise (REALISM-BACKLOG 1)
  const sharpened = sharpen(taauNode.getTextureNode(), uniforms.sharpness, true);

  // DOF uniforms (world units) — shared by every cutscene chain.
  const dofU = { focus: uniform(2.5), focal: uniform(1.2), bokeh: uniform(3) };
  const mbAmount = uniform(1);
  let dofNode: any = null;

  // One output node per chain shape (gameplay / DOF / motion blur / both), built once and cached: a DOF cue only
  // updates the uniforms, and the node graph (bloom's render targets, the compiled output) is never rebuilt.
  const chains = new Map<string, any>();
  let current = '';
  function build(fx: CutsceneFx | null) {
    const useDof = !!fx?.dof && preset.post.cutsceneDof;
    const useMb = !!fx?.motionBlur && preset.post.cutsceneMotionBlur;
    if (useDof) {
      dofU.focus.value = fx!.dof!.focusDistance;
      dofU.focal.value = fx!.dof!.focalLength;
      dofU.bokeh.value = fx!.dof!.bokehScale;
    }
    if (useMb) mbAmount.value = fx!.motionBlur!;
    const key = `${useDof ? 'dof' : ''}|${useMb ? 'mb' : ''}`;
    let out = chains.get(key);
    if (!out) {
      let aa: any = sharpened;
      if (useDof) {
        dofNode ??= dof(sharpened, scenePass.getViewZNode(), dofU.focus, dofU.focal, dofU.bokeh);
        aa = dofNode;
      }
      if (useMb) {
        const src = aa === sharpened ? sharpened.getTextureNode() : aa.getTextureNode();
        aa = motionBlur(src, vel.mul(mbAmount));
      }
      let hdr: any = aa;
      // LIGHTING lane: lateral CA on the HDR texture, before bloom (no extra RTT pass; highlights fringe once)
      if (preset.post.chromaticAberration > 0 && typeof aa.getTextureNode === 'function') hdr = lensCA(aa.getTextureNode(), uniforms.chromaticAberration);
      // r3 AD review (R3-3): the threshold is in EXPOSED units (1.5 ≈ AgX's highlight shoulder), not scene radiance.
      // A fixed 0.9 cd-ish threshold meant that at the torch's exposure 0.25 every surface above 0.22 on screen bloomed
      // — the 1 m torch hot spot became a hazy luminous disc with the wallpaper washed out. Glare now comes only
      // from what the camera actually renders near white: flames, the bulb, the hot core, lightning windows.
      // round D (glare.mjs, C1 33): the stock high pass forwards the FULL radiance above threshold, so the truck's high
      // beams (~10³× the threshold on screen) spread a milky full-frame veil through the wide mips — with bloom 0 the
      // shot is a clean wet road. Film halation / lens flare is bounded: once the emulsion (or the eye's photoreceptors)
      // saturates, the scattered light stops growing linearly. The excess e above the threshold is soft-saturated,
      // e' = e / (1 + e / (K·T)), K = 24: a candle flame (e ≈ 2–5 T) keeps ≥ 83 % of its glare, a 10³ T lamp is capped ~24 T.
      if (preset.post.bloom) {
        const bl = bloom(aa, uniforms.bloomStrength, 0.35, uniforms.bloomThreshold.div(uniforms.exposure.max(1e-3)));
        bl.highPassFn = glareHighPass;
        hdr = hdr.add(bl);
      }
      hdr = grade4(hdr.mul(uniforms.exposure));
      let ldr: any = renderOutput(hdr);
      out = finish(ldr);
      chains.set(key, out);
    }
    if (key === current) return;
    current = key;
    let next = rps.get(key);
    if (!next) {
      next = new THREE.RenderPipeline(renderer);
      next.outputColorTransform = false;
      next.outputNode = out;
      next.needsUpdate = true;
      rps.set(key, next);
    }
    rp = next;
  }
  build(null);

  return {
    kind: 'post',
    uniforms,
    meterTexture: scenePass.getTexture('output'),
    render: () => rp.render(),
    setScale(s: number) {
      if (Math.abs(s - scale) < 1e-4) return;
      scale = s;
      scenePass.setResolutionScale(s);
      prePass?.setResolutionScale(s);
    },
    getScale: () => scale,
    setCutscene: (fx) => build(fx),
    compileView: passCompiler(renderer, scene, camera, prePass ? [prePass, scenePass] : [scenePass], () => rp.render(), taauNode._originalProjectionMatrix), // PERF lane (P0-1)
    dispose: () => {
      for (const p of rps.values()) p.dispose();
    },
  };
}
