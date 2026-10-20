// JUMPSCARE (#147m) — the in-game player of the pre-rendered severed-head clip (docs/STATUS-jumpscare.md Spec §3, the
// 147l runtime handoff). The death cutaway (src/cutscenes/death.ts) cuts to it with `fx jumpscare {on}` at 0.15 s and
// takes it down with `{on: false}` at 1.45 s, under black.
//
// Playback: a <video> (muted, inline) → THREE.VideoTexture (SRGBColorSpace: WebGPU uploads it with
// copyExternalImageToTexture into an rgba8unorm-srgb texture, WebGL2 decodes in the shader — GLSLNodeBuilder
// needsToWorkingColorSpace) → a camera-child quad drawn INSIDE the scene pass, so the game's own film look applies
// natively (lens CA, bloom, the fixed exposure the timeline sets, AgX, vignette, grain, TAAU). The quad's colour node
// undoes the clip's log encoding: v = sRGBTransferOETF(texel), L = L0·(2^(v·R) − 1) per channel (scare_face.json) —
// real scene radiance, tone-mapped once by the game (jumpscare-math.ts is the CPU mirror, tested).
// The quad is TRANSPARENT (alpha 1, normal blending) with renderOrder 1e6, depthTest / depthWrite off: last in the
// transparent queue, so rain, decals and Max's volumetric beam never draw over her face, and the pipeline's GTAO context
// (getAO skips transparent materials) never darkens it. A camera child → zero motion vectors → no TAAU smear on it.
//
// Timing: the module, not the cutscene clock, owns the end of the face — real time: play() at the cut, black once the
// presented frame's media time ≥ 0.98 s, on `ended`, or 1.12 s after the cut (a stalled decoder never freezes a face on
// screen); stepped QA (`stepped = true`, scripts/qa/jumpscare.mjs): the video is SEEKED to the game clock instead.
// Prefetch: when B05 begins (or at load when a save / debug start is already at B05+) — json + mp4 (≈ 1.0 MB Max,
// 0.5 MB Medium, manifest kind `data`: level.ts never downloads it) → Blob URL → prime (play / pause / seek 0 / one
// presented frame) → renderer.initTexture uploads frame 0, so the first catch never waits. The quad is registered for
// the load-time prewarm (src/render/cs-prewarm.ts) with the VideoTexture still empty (three draws its default texture),
// so its pipeline exists before any catch.
// Fallback (no H.264 decoder for the codec; a fetch / decode error; or `ada_severed` false — since #147n Low ships its own
// 640x400 clip, the final review failed Low's fallback as "a blown-out plaster mannequin"): her REAL
// severed head held 0.28 m before the lens, chin up 20°, torch-lit, jaw spasm keys, her body hidden — honest note: that
// is the in-engine "plaster mask"; 1 s on screen and the cut hide most of it.

import * as THREE from 'three/webgpu';
import { Fn, exp2, float, floor, fract, dot, sin, max, mrt, screenCoordinate, sRGBTransferOETF, texture, uniform, uv, vec2, vec4 } from 'three/tsl';
import { assetUrl } from './assets.ts';
import { registerPrewarm } from '../render/cs-prewarm.ts';
import { EXPOSURE_CUE } from '../render/exposure.ts';
import { BEAM_CLAMP } from '../characters/arms.ts';
import {
  SCARE_CLIP_S,
  SCARE_CLIP_TIERS,
  SCARE_CUT_T,
  SCARE_FALLBACK,
  SCARE_OFF_T,
  SCARE_RADIANCE_SCALE,
  codecFor,
  coverFit,
  keyAt,
  metaProblems,
  scareGain,
  type ScareMeta,
} from './jumpscare-math.ts';

/** What the module needs from Ada (src/characters/ada.ts AdaCharacter, duck-typed). */
interface AdaLike {
  group: any;
  c: { meshes: any[] };
  severed: boolean;
  headNode(): any | null;
  bone(name: string): any | null;
  carryHeadBy(socket: any | null): void;
  headCarry: { holder: any | null };
}

export interface JumpscareDeps {
  renderer: any;
  camera: any;
  /** The scene (its sky backgroundNode is taken off while the clip covers the frame). */
  scene?: any;
  presetId: string;
  settings: { reducedFlash?: boolean };
  flags: Map<string, boolean>;
  /** AudioEngine (ensure() the lazy sting when the clip is prefetched). */
  audio: { ensure?(id: string): Promise<unknown> } | null;
  ada: AdaLike | null;
  /** The player's torch (FlashlightRig): the fallback head is lit by it, so it is on for the second (restored after). */
  rig?: { on: boolean; setOn(on: boolean): void; flashlight?: { light?: any } } | null;
}

export type JumpscareMode = 'clip' | 'fallback' | null;

/**
 * The read-noise floor under the clip (AD4-r37 rank 2a: the frames hold exact-0 "digital void" a real sensor never
 * shows): an ADDITIVE floor in scene radiance (the game's grain is multiplicative, black stays black), ~1.4 px cells,
 * re-seeded per clip frame (30 Hz — TAAU would average a per-render-frame seed away). `L` is scene radiance (the clip's
 * units, Blender W/(4π) = cd), seen at the fixed cut exposure (2^-11.96): L 12 ± 90 % ≈ 2.7 ± 2.1 /255 on screen after
 * three's AgX (147m model; target ≈ 3 ± 2.5 /255, AD4 2a).
 */
export const SCARE_FLOOR = { L: 12, noise: 0.9, cellPx: 1.4 } as const;

const PLANE_Z = -0.05; // 5 cm before the lens (near plane 0.03)
/** The quad's own layer (free: 5–9 and 30 are taken). While the clip covers the frame the view camera sees ONLY this
 *  layer: the house behind an opaque full-frame face is not drawn (the death cutaway is not in CS_CULL_IDS, so it would
 *  render the whole house for nothing; shadow / cube cameras have their own layers and are untouched). */
const QUAD_LAYER = 29;

export function createJumpscare(d: JumpscareDeps) {
  const tier = d.presetId;
  const hasClipTier = (SCARE_CLIP_TIERS as readonly string[]).includes(tier);

  // ---------------------------------------------------------------- video + texture (created at once: prewarm)
  const video = document.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-hidden', 'true');
  // kept in the DOM, 1 px and transparent (not display:none): requestVideoFrameCallback / frame presentation stay alive
  Object.assign(video.style, { position: 'fixed', left: '0', top: '0', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none', zIndex: '-1' } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(video);
  const tex = new THREE.VideoTexture(video);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;

  const uL0 = uniform(1.2401357889175415); // replaced from scare_face.json at load
  const uR = uniform(12.0003521774803);
  const uGain = uniform(0);
  const uScale = uniform(new THREE.Vector2(1, 1));
  const uOffset = uniform(new THREE.Vector2(0, 0));
  const uFloor = uniform(SCARE_FLOOR.L);
  const uFloorNoise = uniform(SCARE_FLOOR.noise);
  const uSeed = uniform(0);

  const hash21 = (p: any) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));
  const colorNode = Fn(() => {
    const st = uv().mul(uScale).add(uOffset);
    const c = texture(tex, st).rgb; // linear (sRGB-decoded by the format / in the shader)
    const v = sRGBTransferOETF(c); // the clip's code values (the encoder's log curve, per channel)
    const L = exp2(v.mul(uR)).sub(1).mul(uL0); // scene radiance
    // the sensor's read-noise floor (additive; see SCARE_FLOOR), re-seeded per clip frame
    const cell = floor(screenCoordinate.xy.div(SCARE_FLOOR.cellPx)).add(vec2(uSeed.mul(17.13), uSeed.mul(29.71)));
    const n = hash21(cell).sub(0.5).mul(2);
    const fl = max(float(0), uFloor.mul(n.mul(uFloorNoise).add(1)));
    return vec4(L.add(fl).mul(uGain.mul(SCARE_RADIANCE_SCALE)), 1); // × the radiance scale (the exposure has its inverse)
  })();
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, fog: false });
  mat.colorNode = colorNode;
  mat.opacityNode = float(1);
  // TAAU must not accumulate the clip: its motion is IN the texture (the quad itself is camera-locked, velocity 0), so
  // history reprojected with zero velocity ghosts every moving strand and edge, and TAAU's thin-feature LOCK keeps the
  // ghost unclipped (TAAUNode.js resolve: lockedHistoryColor) — measured as a smeared, painterly face in the first
  // capture (147m). A material-level MRT velocity far off-screen makes historyUV invalid → hasValidHistory false →
  // currentWeight 1 (the current frame only, still the 9-tap reconstruction + RCAS) and canLock false.
  // #147n: Medium / Max only. Low (FXAA / canvas MSAA, no TAAU) renders its scene pass WITHOUT an MRT, and r186
  // NodeMaterial.setupOutput then makes a material's mrtNode THE output (renderer.getMRT() null → resultNode =
  // materialMRT): the quad would draw the velocity vec4(8, 8, 0, 1) instead of her face.
  if (tier !== 'low') mat.mrtNode = mrt({ velocity: vec4(8, 8, 0, 1) });
  mat.name = 'jumpscare_quad';
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  quad.name = 'jumpscare_quad';
  quad.renderOrder = 1e6;
  quad.frustumCulled = false;
  quad.castShadow = false;
  quad.receiveShadow = false;
  quad.visible = false;
  quad.position.set(0, 0, PLANE_Z);
  quad.layers.enable(QUAD_LAYER); // layer 0 too: the load prewarm compiles it with the normal view camera
  d.camera.add(quad);
  // main.ts afterCompile 'cs-prewarm': compiled in the frame's own context at load (every tier ships a clip since #147n)
  if (hasClipTier) registerPrewarm(quad);
  /** Every light also on QUAD_LAYER: three r186 collects a view's lights inside `object.layers.test(camera.layers)`
   *  (Renderer._projectObject), so a quad-only view would have NO lights → another renderList.lightsNode → a fresh
   *  RenderObject + node build for the quad and the sky at each cut (147m m3 / x4). With the lights on both layers the
   *  light set is identical and the prewarmed objects are reused. Shadow / cube cameras keep their own layers. */
  const lightLayers = () => {
    if (!d.scene || !hasClipTier) return;
    d.scene.traverse((o: any) => {
      if (o.isLight && !o.layers.isEnabled(QUAD_LAYER)) o.layers.enable(QUAD_LAYER);
    });
  };
  lightLayers();

  // ---------------------------------------------------------------- load / prime
  let meta: ScareMeta | null = null;
  let blobUrl: string | null = null;
  let ready = false;
  let why = hasClipTier ? 'not loaded' : `no clip on ${tier}`;
  let loadP: Promise<boolean> | null = null;
  let clipAspect = 1.6;

  const waitEvent = (type: string, ms: number) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        cleanup();
        reject(new Error(`video '${type}' timed out`));
      }, ms);
      const ok = () => {
        cleanup();
        resolve();
      };
      const bad = () => {
        cleanup();
        reject(new Error(`video error ${video.error?.code ?? '?'} ${video.error?.message ?? ''}`));
      };
      const cleanup = () => {
        clearTimeout(t);
        video.removeEventListener(type, ok);
        video.removeEventListener('error', bad);
      };
      video.addEventListener(type, ok, { once: true });
      video.addEventListener('error', bad, { once: true });
    });
  /** One presented frame (rVFC), or a short timeout where rVFC is unavailable / never fires (a hidden tab). */
  const presented = (ms = 300) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      if ('requestVideoFrameCallback' in video)
        (video as any).requestVideoFrameCallback(() => {
          clearTimeout(t);
          resolve();
        });
    });
  /** Seek, wait for the frame, upload it now (initTexture: the quad may be hidden, and hidden objects upload nothing). */
  const seekUpload = async (t: number) => {
    if (Math.abs(video.currentTime - t) > 1e-4 || video.seeking) {
      const p = waitEvent('seeked', 3000);
      video.currentTime = t;
      await p;
    }
    tex.needsUpdate = true;
    try {
      d.renderer.initTexture(tex);
    } catch (e) {
      console.warn('[jumpscare] initTexture:', e);
    }
  };

  async function load(): Promise<boolean> {
    if (!hasClipTier) return false;
    const mres = await fetch(assetUrl(`assets/${tier}/scare_face.json`));
    if (!mres.ok) throw new Error(`scare_face.json: HTTP ${mres.status}`);
    const m = (await mres.json()) as ScareMeta;
    const probs = metaProblems(m, [tier]);
    if (probs.length) throw new Error(`scare_face.json: ${probs.join('; ')}`);
    const codec = codecFor(m, tier)!;
    if (video.canPlayType(`video/mp4; codecs="${codec}"`) === '') {
      why = `no decoder for ${codec}`;
      return false;
    }
    const vres = await fetch(assetUrl(`assets/${tier}/scare_face.mp4`));
    if (!vres.ok) throw new Error(`scare_face.mp4: HTTP ${vres.status}`);
    const blob = await vres.blob();
    blobUrl = URL.createObjectURL(blob);
    const loaded = waitEvent('loadeddata', 15000);
    video.src = blobUrl;
    video.load();
    await loaded;
    meta = m;
    uL0.value = m.L0;
    uR.value = m.R;
    clipAspect = video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 1.6;
    // prime: PLAY a few frames with the quad drawn at a sub-pixel size (nothing on screen) so the whole playing path —
    // the decoder's hardware frames, the per-frame copyExternalImageToTexture (Dawn converts a playing frame through its
    // own blit pipeline, compiled on first use) and the quad's draw in the scene pass — has run once before the first
    // catch (Max QA x2: the first cut cost 33 / 50 / 33 ms frames, later cuts none). Then back to frame 0, uploaded.
    try {
      quad.scale.set(1e-6, 1e-6, 1);
      uGain.value = 0;
      quad.visible = true;
      await video.play();
      for (let i = 0; i < 4; i++) await presented(200);
    } catch {
      // play() refused (autoplay policy): a seek still decodes frame 0; play() at the cut runs inside the user's game
    } finally {
      if (mode !== 'clip') quad.visible = false;
    }
    video.pause();
    await seekUpload(0);
    ready = true;
    why = 'ready';
    console.info(`[jumpscare] clip ready: ${tier} ${video.videoWidth}x${video.videoHeight} ${(blob.size / 1024).toFixed(0)} KB ${codec}`);
    return true;
  }

  /** Fetch + prime the clip (idempotent), and make sure the lazy sting is rendered. Resolves true when the clip is ready. */
  const prefetch = (): Promise<boolean> => {
    lightLayers(); // lights added after the module was created (cheap: once per prefetch call)
    void d.audio?.ensure?.('scare_sting')?.catch(() => {});
    void d.audio?.ensure?.('scare_whoosh')?.catch(() => {});
    loadP ??= load().catch((e) => {
      why = `load failed: ${e?.message ?? e}`;
      console.warn('[jumpscare] clip unavailable, in-engine fallback:', e);
      return false;
    });
    return loadP;
  };

  // ---------------------------------------------------------------- the scare
  let mode: JumpscareMode = null;
  let tOn = 0;
  let ended = false;
  let media: number | null = null;
  let seekBusy = false;
  let lastUpload = -1;
  /** Uploads: 'rvfc' = once per presented video frame (three's VideoTexture sets needsUpdate from
   *  requestVideoFrameCallback: 30 Hz); 'frame' = every render frame the element clock moved (QA A/B: currentTime is a
   *  continuous clock while playing, so that uploaded the same 1600×1000 frame twice at 60 Hz). Without rVFC: 'frame'. */
  let uploadMode: 'rvfc' | 'frame' = 'requestVideoFrameCallback' in video ? 'rvfc' : 'frame';
  /** QA: ms spent inside video.play() at the last cut (the synchronous part). */
  let playMs = 0;
  /** QA: stepped captures (`__game.advance`) drive the video by the game clock instead of real time. */
  let stepped = false;
  let pausedVideo = false;
  /** QA A/B: the cutaway without the face (on() does nothing) — the baseline for the stall check. */
  let disabled = false;
  /** While the clip covers the frame, render only the quad's layer (QA A/B `setSceneOff(false)`): the face's frame CPU
   *  drops from 6–27 ms to ~2 ms on Max (147m QA x4 / x5: the death cutaway is not in CS_CULL_IDS, so the whole house
   *  was drawn behind an opaque full-frame face; Max hitched 50–130 ms at the cut). The scene's sky (backgroundNode,
   *  three's Background mesh — drawn regardless of layers) is taken off for the same second: in the quad-only view it
   *  node-built twice per cut (x4 / m3); with it off the pass just clears. Both restored at off. */
  let sceneOff = true;
  let savedMask: number | null = null;
  let savedBg: any = undefined;
  const restoreLayers = () => {
    if (savedMask !== null) d.camera.layers.mask = savedMask;
    savedMask = null;
    if (savedBg !== undefined && d.scene) d.scene.backgroundNode = savedBg;
    savedBg = undefined;
  };
  /** The frame the cut happened in renders tOn = 0 (frame 0): the first update after on() does not advance the clock. */
  let justOn = false;
  /** #147n (final review rank 3): the brain's `ai:catch` captions — "(choking)", "(a wet breath against your face)",
   *  on by default — sat over her mouth for the whole second: "ONLY her face" (ruling au). While the face is up the
   *  subtitle layer is hidden (visibility only, like subtitles.ts's QA `tk-qa-nosubs`: timing, events and the voice duck
   *  are untouched, so a caption still running after the cut shows again under the black). */
  const hideSubs = (hide: boolean) => {
    if (typeof document === 'undefined') return;
    if (hide && !document.getElementById('tk-scare-nosubs-style')) {
      const st = document.createElement('style');
      st.id = 'tk-scare-nosubs-style';
      st.textContent = '.tk-scare-on .tk-subs{visibility:hidden!important}';
      document.head.appendChild(st);
    }
    document.documentElement.classList.toggle('tk-scare-on', hide);
  };
  video.addEventListener('ended', () => {
    if (mode === 'clip') ended = true;
  });
  const onFrame = (_now: number, md: any) => {
    if (mode !== 'clip') return;
    media = typeof md?.mediaTime === 'number' ? md.mediaTime : video.currentTime;
    (video as any).requestVideoFrameCallback?.(onFrame);
  };

  const sizeQuad = () => {
    const cam = d.camera;
    const h = 2 * Math.abs(PLANE_Z) * Math.tan((cam.fov * Math.PI) / 360);
    const w = h * cam.aspect;
    quad.scale.set(w * 1.02, h * 1.02, 1); // 1 % bleed: TAAU jitter / CA never show an edge
    const f = coverFit(cam.aspect, clipAspect);
    uScale.value.set(f.sx, f.sy);
    uOffset.value.set(f.ox, f.oy);
  };

  // ---- fallback: her real head before the lens
  let fbLens: [number, number, number] | null = null;
  let fbDist = 0;
  const fb = { was: null as any, jaw: [] as any[], eye: [] as any[], torchWas: true, clampOn: false, clampAt: null as [number, number, number] | null };
  const _q = new THREE.Quaternion();
  const _q2 = new THREE.Quaternion();
  const _v = new THREE.Vector3();
  const _f = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _x = new THREE.Vector3(1, 0, 0);
  /** Face centre (the nose bridge / cheekbone line) in the ada_head_rig frame: origin = the crown grip, +Z = the face,
   *  +X = her left (head-carry.ts; ada.eyeOpen: the eye at (−0.032, −0.10, +0.09)). */
  const FACE_IN_NODE = new THREE.Vector3(0, -0.115, 0.1);
  /** Ada's hair chains (secondary.ts VerletChain; `reset()` re-primes a chain from the current pose on its next update). */
  const resetHair = () => {
    for (const c of ((d.ada as any)?.hairChains ?? []) as any[]) c?.reset?.();
  };
  const startFallback = (): boolean => {
    const ada = d.ada;
    const node = ada?.headNode?.();
    if (!ada || !node || !ada.severed) return false;
    fb.was = ada.headCarry.holder;
    // the face is lit by YOUR torch (as in the clip): on for the second even if you had it off, restored under black
    fb.torchWas = d.rig?.on ?? true;
    if (d.rig && !d.rig.on) d.rig.setOn(true);
    // ... and aimed at her face from the hand (BEAM_CLAMP.at; the gaze-point aim would pass under her chin), restored after
    fb.clampOn = BEAM_CLAMP.on;
    fb.clampAt = BEAM_CLAMP.at;
    // FREE (head-carry leaves a free head alone): posed here after ada.update every frame, so the hair chains simulate
    // against the pose they are drawn with (a head held by a socket was re-hung by the pendulum before each override and
    // the strands flailed — 147m l3). A loose head's side effects in ada.ts are already in force since C2 (the pool smear
    // latches when the head lies in its pool) or harmless here (slack hair; its floor plane is 1.6 m below).
    ada.carryHeadBy(null);
    resetHair();
    fb.jaw = [];
    fb.eye = [];
    for (const m of ada.c.meshes) {
      const dict = m.morphTargetDictionary;
      if (!dict || !m.morphTargetInfluences) continue;
      if ('jaw_open' in dict) fb.jaw.push([m, dict.jaw_open]);
      if ('eyelid_l_open' in dict) fb.eye.push([m, dict.eyelid_l_open]);
    }
    return true;
  };
  const placeHead = () => {
    const ada = d.ada!;
    const node = ada.headNode();
    if (!node) return;
    const cam = d.camera;
    cam.updateMatrixWorld(true);
    // facing the lens (the node's +Z = the camera's +Z), chin up
    cam.getWorldQuaternion(_q);
    _q2.setFromAxisAngle(_x, -SCARE_FALLBACK.chinUp);
    _q.multiply(_q2);
    // the face centre on the optical axis, `dist` before the lens, a touch low (the eyes above the frame centre) — and
    // always ≥ 15 cm beyond the torch's lens (the hidden arms leave it 0.51 m forward, 0.27 m down in the hand — 147m l5:
    // a face level with it was lit as a grazing sliver, l4), so the beam reaches her face from below and in front
    let dist: number = SCARE_FALLBACK.dist;
    const lamp = d.rig?.flashlight?.light;
    if (lamp?.getWorldPosition) {
      lamp.getWorldPosition(_v);
      cam.worldToLocal(_v);
      fbLens = [+_v.x.toFixed(3), +_v.y.toFixed(3), +_v.z.toFixed(3)];
      dist = Math.max(dist, Math.min(0.6, -_v.z + 0.15));
    }
    fbDist = dist;
    // the long lens: the face (brow to chin ≈ 0.13 m) fills ~70 % of the frame height at whatever distance the torch
    // allowed (the timeline's 30° was sized for 0.28 m; l6: at 0.6 m the face was ~35 % of the frame)
    const fov = (2 * Math.atan(0.095 / dist) * 180) / Math.PI;
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    _f.set(0, -0.01, -dist).applyMatrix4(cam.matrixWorld);
    BEAM_CLAMP.on = true;
    BEAM_CLAMP.at = [_f.x, _f.y, _f.z];
    _v.copy(FACE_IN_NODE).applyQuaternion(_q);
    const pos = _f.sub(_v);
    const parent = node.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      pos.applyMatrix4(_m.copy(parent.matrixWorld).invert());
      parent.getWorldQuaternion(_q2);
      _q.premultiply(_q2.invert());
    }
    node.position.copy(pos);
    node.quaternion.copy(_q);
    node.visible = true;
    node.updateMatrixWorld(true);
    ada.group.visible = false; // ONLY her face: the body behind is hidden for the second
    const jaw = keyAt(SCARE_FALLBACK.jaw, tOn);
    for (const [m, i] of fb.jaw) m.morphTargetInfluences[i] = jaw;
    for (const [m, i] of fb.eye) m.morphTargetInfluences[i] = 1;
  };
  const endFallback = () => {
    BEAM_CLAMP.on = fb.clampOn;
    BEAM_CLAMP.at = fb.clampAt;
    if (d.rig && !fb.torchWas) d.rig.setOn(false);
    const ada = d.ada;
    if (!ada) return;
    ada.carryHeadBy(fb.was ?? ada.bone('prop_r'));
    resetHair();
    const node = ada.headNode();
    if (node) node.visible = false; // under black; ada.update shows it with her again once the AI drives her
  };

  const on = () => {
    off();
    tOn = 0;
    justOn = true;
    ended = false;
    media = null;
    if (disabled) {
      mode = null;
      return;
    }
    const severed = d.flags.get('ada_severed') === true || !!d.ada?.severed;
    if (ready && severed) {
      mode = 'clip';
      hideSubs(true);
      sizeQuad();
      uGain.value = scareGain(0, 0, false, !!d.settings.reducedFlash);
      uSeed.value = 0;
      quad.visible = true;
      if (sceneOff && savedMask === null) {
        savedMask = d.camera.layers.mask;
        d.camera.layers.set(QUAD_LAYER);
        if (d.scene) {
          savedBg = d.scene.backgroundNode ?? null;
          d.scene.backgroundNode = null;
        }
      }
      if (!stepped) {
        if (video.currentTime !== 0) video.currentTime = 0; // primed at 0 already (off() re-primes): no needless seek
        const t0 = performance.now();
        const p = video.play();
        playMs = performance.now() - t0;
        p?.catch?.((e: any) => console.warn('[jumpscare] play():', e));
        (video as any).requestVideoFrameCallback?.(onFrame);
      }
      return;
    }
    if (!ready && hasClipTier && loadP === null) void prefetch(); // the next catch can have it
    if (startFallback()) {
      mode = 'fallback';
      hideSubs(true);
      placeHead();
    } else mode = null;
    console.info(`[jumpscare] fallback (${severed ? why : 'ada not severed'})${mode ? '' : ': no head node — the lunge only'}`);
  };

  function off() {
    restoreLayers(); // unconditional + idempotent: a quad-only camera / a missing sky must never outlive the scare
    hideSubs(false); // likewise: the captions are back with the black
    if (mode === 'clip') {
      quad.visible = false;
      uGain.value = 0;
      video.pause();
      // back to frame 0 for the next catch (uploaded now, so the first frame of the next cut is never the last face)
      if (ready) void seekUpload(0).catch(() => {});
    } else if (mode === 'fallback') endFallback();
    mode = null;
    pausedVideo = false;
  }

  /** Per frame, after the characters (the fallback head overrides ada.update's pose + morphs). dt = 0 while paused. */
  const update = (dt: number) => {
    if (!mode) return;
    const step = justOn ? 0 : dt;
    justOn = false;
    // watchdog: the timeline takes the face down at SCARE_OFF_T; a cancelled / aborted cutaway never sends that cue —
    // never leave a frozen face, a quad-only camera or a missing sky behind (story-runtime also calls off on its end)
    if (tOn > SCARE_OFF_T - SCARE_CUT_T + 0.5) {
      off();
      return;
    }
    if (mode === 'fallback') {
      tOn += step;
      placeHead();
      // the in-engine head is lit by whatever reaches it in the game (the probes, the torch spill — the beam itself aims
      // at the gaze point past her): the timeline's fixed exposure is the CLIP's (2^-11.96 of scaled radiance) and left
      // the head at exactly 0 on Low (147m l1/l2). The fallback meters instead: the cut's snap (`exposure {snap}`) adapts
      // the eye to the head on the next frame; the timeline's `exposure {reset}` at 1.45 hands it back
      if (EXPOSURE_CUE.fixed !== null) EXPOSURE_CUE.fixed = null;
      return;
    }
    // clip
    if (!stepped) {
      // a paused game pauses the clip (the face never plays on behind the pause menu)
      if (dt <= 0 && !pausedVideo && !video.paused) {
        video.pause();
        pausedVideo = true;
      } else if (dt > 0 && pausedVideo) {
        pausedVideo = false;
        void video.play()?.catch?.(() => {});
      }
      tOn += step;
      // where rVFC never reports, fall back to the element clock
      const m = media ?? (video.currentTime > 0 ? video.currentTime : null);
      if (uploadMode === 'frame' && video.currentTime !== lastUpload) {
        lastUpload = video.currentTime;
        tex.needsUpdate = true;
      }
      uGain.value = scareGain(tOn, m, ended || video.ended, !!d.settings.reducedFlash);
      uSeed.value = Math.floor((m ?? tOn) * 30) % 997;
    } else {
      tOn += step;
      const frames = meta?.frames ?? 30;
      const fps = meta?.fps ?? 30;
      const k = Math.min(frames - 1, Math.floor(tOn * fps + 1e-6));
      const want = (k + 0.5) / fps;
      if (!seekBusy && Math.floor(video.currentTime * fps + 1e-3) !== k) {
        seekBusy = true;
        void seekUpload(want).finally(() => {
          seekBusy = false;
        });
      }
      // the frame's own pts, as rVFC reports it in real time (frame 29 = 0.967 s is shown; black from 1.0 s)
      media = tOn + 1e-6 >= frames / fps ? SCARE_CLIP_S : k / fps;
      uGain.value = scareGain(tOn, media, false, !!d.settings.reducedFlash);
      uSeed.value = k;
    }
    sizeQuad();
  };

  return {
    /** Fetch + prime the clip (B05 entry / a restore at B05+). */
    prefetch,
    /** Cutscene fx `jumpscare {on}` (true = the cut, false = take it down). Returns true (handled). */
    fx(id: string, p: Record<string, number | string | boolean>): boolean {
      if (id !== 'jumpscare') return false;
      if (p.on) on();
      else off();
      return true;
    },
    update,
    get mode(): JumpscareMode {
      return mode;
    },
    /** QA (`__game.jumpscare`): state, stepped capture control, the decode uniforms. */
    debug: {
      state: () => ({
        /** fallback: the head node's crown origin in CAMERA space (m; −z = in front) and whether it is visible */
        head: (() => {
          const n = d.ada?.headNode?.();
          if (mode !== 'fallback' || !n) return null;
          const p = n.getWorldPosition(new THREE.Vector3());
          d.camera.worldToLocal(p);
          // the drawn head's bounds (skinned, precise) in camera space + where the node origin projects (NDC)
          const box = new THREE.Box3().setFromObject(n, true);
          const c = box.getCenter(new THREE.Vector3());
          const sz = box.getSize(new THREE.Vector3());
          d.camera.worldToLocal(c);
          const ndc = n.getWorldPosition(new THREE.Vector3()).project(d.camera);
          const meshes: string[] = [];
          n.traverse((o: any) => {
            if (o.isMesh && meshes.length < 8) meshes.push(`${o.name}${o.isSkinnedMesh ? '(skin)' : ''}${o.visible ? '' : '(hidden)'}`);
          });
          return { x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), vis: !!n.visible, torch: d.rig?.on ?? null, lens: fbLens, dist: +fbDist.toFixed(3),
            boxC: [+c.x.toFixed(3), +c.y.toFixed(3), +c.z.toFixed(3)], boxS: [+sz.x.toFixed(3), +sz.y.toFixed(3), +sz.z.toFixed(3)], ndc: [+ndc.x.toFixed(3), +ndc.y.toFixed(3)], fov: d.camera.fov, meshes };
        })(),
        tier, ready, why, mode, uploadMode, playMs, tOn, media, ended, gain: uGain.value, videoTime: video.currentTime, paused: video.paused, readyState: video.readyState, size: [video.videoWidth, video.videoHeight], meta, stepped, floor: uFloor.value, floorNoise: uFloorNoise.value }),
      setStepped: (on: boolean) => {
        stepped = on;
      },
      setDisabled: (on: boolean) => {
        disabled = on;
      },
      setSceneOff: (on: boolean) => {
        sceneOff = on;
      },
      setUploadMode: (m: 'rvfc' | 'frame') => {
        uploadMode = m;
      },
      /** Stepped capture: resolves once the frame the NEXT advance(dt) shows is decoded and uploaded. */
      stepTo: async (t: number) => {
        if (mode !== 'clip') return;
        const fps = meta?.fps ?? 30;
        const frames = meta?.frames ?? 30;
        const k = Math.min(frames - 1, Math.floor(Math.max(0, t) * fps + 1e-6));
        while (seekBusy) await new Promise((r) => setTimeout(r, 5));
        seekBusy = true;
        try {
          await seekUpload((k + 0.5) / fps);
        } finally {
          seekBusy = false;
        }
      },
      /**
       * Colour-path gate (Spec §3, ≤ 1.5 codes): the encoder's calibration clip (`scare_encode.mjs --calib`: 16 × 4 patches,
       * rows grey / R / G / B, v = col / 15) through the SAME sampler path as the quad (VideoTexture SRGBColorSpace →
       * sRGBTransferOETF) into a float target, read back; plus the browser's 2D-canvas decode of the same frame.
       * Returns the max / p50 |code error| (0–255) of the patch centres for each path.
       */
      calibRead: async (b64: string, cols = 16, rows = 4) => {
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        Object.assign(v.style, { position: 'fixed', left: '0', top: '0', width: '1px', height: '1px', opacity: '0' });
        document.body.appendChild(v);
        const url = URL.createObjectURL(new Blob([bin], { type: 'video/mp4' }));
        try {
          await new Promise<void>((res, rej) => {
            v.addEventListener('loadeddata', () => res(), { once: true });
            v.addEventListener('error', () => rej(new Error('calib video error')), { once: true });
            v.src = url;
            v.load();
          });
          await new Promise<void>((res) => {
            v.addEventListener('seeked', () => res(), { once: true });
            v.currentTime = 0.5 / 30;
          });
          const W = v.videoWidth;
          const H = v.videoHeight;
          const t = new THREE.VideoTexture(v);
          t.colorSpace = THREE.SRGBColorSpace;
          t.needsUpdate = true;
          const m = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
          m.colorNode = vec4(sRGBTransferOETF(texture(t).rgb), 1);
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
          mesh.frustumCulled = false;
          const sc = new THREE.Scene();
          sc.add(mesh);
          const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
          const rt = new THREE.RenderTarget(W, H, { type: THREE.FloatType });
          const r = d.renderer;
          const prevRt = r.getRenderTarget();
          const prevTm = r.toneMapping;
          r.toneMapping = THREE.NoToneMapping;
          r.setRenderTarget(rt);
          r.render(sc, cam);
          r.setRenderTarget(prevRt);
          r.toneMapping = prevTm;
          const px = (await r.readRenderTargetPixelsAsync(rt, 0, 0, W, H)) as Float32Array;
          const c2 = document.createElement('canvas');
          c2.width = W;
          c2.height = H;
          const g2 = c2.getContext('2d', { willReadFrequently: true })!;
          g2.drawImage(v, 0, 0, W, H);
          const cpx = g2.getImageData(0, 0, W, H).data;
          const patch = (get: (x: number, y: number, ch: number) => number, flip: boolean) => {
            const errs: number[] = [];
            for (let rr = 0; rr < rows; rr++)
              for (let cc = 0; cc < cols; cc++) {
                const x0 = Math.floor(((cc + 0.3) / cols) * W);
                const x1 = Math.floor(((cc + 0.7) / cols) * W);
                const y0 = Math.floor(((rr + 0.3) / rows) * H);
                const y1 = Math.floor(((rr + 0.7) / rows) * H);
                const sum = [0, 0, 0];
                let n = 0;
                for (let y = y0; y < y1; y += 2)
                  for (let x = x0; x < x1; x += 2) {
                    const yy = flip ? H - 1 - y : y;
                    for (let ch = 0; ch < 3; ch++) sum[ch] += get(x, yy, ch);
                    n++;
                  }
                const want = cc / 15;
                const exp = [rr === 0 || rr === 1 ? want : 0, rr === 0 || rr === 2 ? want : 0, rr === 0 || rr === 3 ? want : 0];
                errs.push(Math.max(...sum.map((s, ch) => Math.abs(s / n - exp[ch]))) * 255);
              }
            errs.sort((a, b) => a - b);
            return { max: +errs[errs.length - 1].toFixed(2), p50: +errs[errs.length >> 1].toFixed(2) };
          };
          const gpuA = patch((x, y, ch) => px[(y * W + x) * 4 + ch], false);
          const gpuB = patch((x, y, ch) => px[(y * W + x) * 4 + ch], true);
          const canvas = patch((x, y, ch) => cpx[(y * W + x) * 4 + ch] / 255, false);
          rt.dispose();
          t.dispose();
          m.dispose();
          mesh.geometry.dispose();
          return { size: [W, H], gpu: gpuA.max <= gpuB.max ? { ...gpuA, flipped: false } : { ...gpuB, flipped: true }, canvas };
        } finally {
          URL.revokeObjectURL(url);
          v.remove();
        }
      },
      setFloor: (L: number, noise = SCARE_FLOOR.noise) => {
        uFloor.value = L;
        uFloorNoise.value = noise;
      },
      quad,
      video,
    },
  };
}

export type Jumpscare = ReturnType<typeof createJumpscare>;
