// Render pipelines per preset (docs/PLAN.md §2.4; APIs verified against three r186 sources).
//
// Low    : DirectRenderPipeline (output processing inside material shaders, MSAA from the renderer) →
//          renderOutput(AgX, sRGB) → vignette × hash grain. outputColorTransform=false + explicit tone map / colour
//          space, because DirectRenderPipeline sets renderer.toneMapping = NoToneMapping while it renders.
// Medium : RenderPipeline: pass(scene) MRT{output, velocity} at preset.sceneScale → TAAU → sharpen → bloom →
//          renderOutput (outputColorTransform=false) → chromatic aberration × vignette → film grain.
// Max    : Medium + GTAO prepass (normals, half-res AO) injected with a lightmap-aware getAO (lightmapped surfaces
//          already contain Cycles occlusion → keep only LIGHTMAP_AO_STRENGTH of it).
// Grain is always applied after TAAU / renderOutput. Our own zero-mean grain (FilmNode brightens: base+base·noise).
// Cutscenes: setCutscene({ dof, motionBlur }) swaps in DOF / motion blur (outputNode rebuild + needsUpdate).

import * as THREE from 'three/webgpu';
import {
  Fn,
  context,
  dot,
  float,
  fract,
  luminance,
  mix,
  mrt,
  normalView,
  output,
  packNormalToRGB,
  pass,
  renderOutput,
  sample,
  screenCoordinate,
  screenUV,
  sin,
  smoothstep,
  time,
  uniform,
  unpackRGBToNormal,
  vec2,
  vec3,
  vec4,
  velocity,
} from 'three/tsl';
import { taau } from 'three/addons/tsl/display/TAAUNode.js';
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import type { PresetConfig } from './presets.ts';

/** Fraction of GTAO applied to lightmapped materials (Cycles bakes already contain occlusion). */
export const LIGHTMAP_AO_STRENGTH = 0.35;

export interface CutsceneFx {
  dof?: { focusDistance: number; focalLength: number; bokehScale: number };
  /** Motion-blur amount (velocity multiplier), Max only. */
  motionBlur?: number;
}

export interface Pipeline {
  readonly kind: 'direct' | 'post';
  /** Uniforms live-tunable from gameplay (lightning exposure kick, grain …). */
  readonly uniforms: {
    exposure: any;
    grain: any;
    vignette: any;
    chromaticAberration: any;
    bloomStrength: any;
    /** Scene grade (HDR, before tone mapping): colour multiplier (C6/B12 blue hour, dawn) … */
    tint: any;
    /** … and saturation (1 = unchanged). */
    saturation: any;
  };
  render(): void;
  /** Scene-pass resolution scale (post pipeline only; no-op on Low). */
  setScale(s: number): void;
  getScale(): number;
  /** Swap in cutscene DOF / motion blur (null = gameplay chain). Ignored where the preset disables it. */
  setCutscene(fx: CutsceneFx | null): void;
  dispose(): void;
}

/** Vignette × zero-mean hash grain, applied in display space (after tone mapping). */
function makeFinish(uVignette: any, uGrain: any) {
  return Fn(([c]: [any]) => {
    const d = screenUV.sub(0.5).mul(vec2(1.25, 1)).length();
    const vig = float(1).sub(smoothstep(0.3, 0.95, d).mul(uVignette));
    // Per-pixel, per-frame hash (screenCoordinate + a time-derived offset); ±0.5, zero mean.
    const p = screenCoordinate.xy.add(fract(time.mul(0.6180339)).mul(vec2(419.2, 371.9)));
    const n = fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5);
    const lum = luminance(c.rgb);
    // Film-like: grain strongest in the shadows/mids, fades in highlights.
    const g = n.mul(uGrain).mul(float(1).sub(lum).mul(0.7).add(0.3));
    return vec4(c.rgb.mul(vig).add(g), c.a);
  });
}

export function createPipeline(renderer: any, scene: any, camera: any, preset: PresetConfig): Pipeline {
  const uniforms = {
    exposure: uniform(1),
    grain: uniform(preset.post.filmGrain),
    vignette: uniform(preset.post.vignette),
    chromaticAberration: uniform(preset.post.chromaticAberration),
    bloomStrength: uniform(0.22),
    tint: uniform(new THREE.Color(1, 1, 1)),
    saturation: uniform(1),
  };
  const finish = makeFinish(uniforms.vignette, uniforms.grain);
  /** rgb → graded rgb. */
  const grade = (c: any) => {
    const l = luminance(c);
    return mix(vec3(l, l, l), c, uniforms.saturation).mul(uniforms.tint);
  };
  /** rgba → graded rgba. */
  const grade4 = (c: any) => vec4(grade(c.rgb), c.a);

  if (preset.pipeline === 'direct') {
    const rp = new THREE.DirectRenderPipeline(renderer);
    rp.outputColorTransform = false;
    rp.outputNode = finish(renderOutput(vec4(grade(output.rgb.mul(uniforms.exposure)), output.a), THREE.AgXToneMapping, THREE.SRGBColorSpace));
    return {
      kind: 'direct',
      uniforms,
      render: () => rp.render(scene, camera),
      setScale: () => {},
      getScale: () => 1,
      setCutscene: () => {},
      dispose: () => rp.dispose(),
    };
  }

  // ---- Post pipeline (Medium / Max) ----
  const rp = new THREE.RenderPipeline(renderer);
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
  const sharpened = sharpen(taauNode.getTextureNode(), preset.post.sharpen);

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
      if (preset.post.bloom) hdr = hdr.add(bloom(aa, uniforms.bloomStrength, 0.35, 0.9));
      hdr = grade4(hdr.mul(uniforms.exposure));
      let ldr: any = renderOutput(hdr);
      if (preset.post.chromaticAberration > 0) ldr = chromaticAberration(ldr, uniforms.chromaticAberration, vec2(0.5, 0.5), 1.1); // r186: a null centre crashes the build (JSDoc says it defaults)
      out = finish(ldr);
      chains.set(key, out);
    }
    if (key === current) return;
    current = key;
    rp.outputColorTransform = false;
    rp.outputNode = out;
    rp.needsUpdate = true;
  }
  build(null);

  return {
    kind: 'post',
    uniforms,
    render: () => rp.render(),
    setScale(s: number) {
      if (Math.abs(s - scale) < 1e-4) return;
      scale = s;
      scenePass.setResolutionScale(s);
      prePass?.setResolutionScale(s);
    },
    getScale: () => scale,
    setCutscene: (fx) => build(fx),
    dispose: () => rp.dispose(),
  };
}
