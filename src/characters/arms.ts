// First-person arms (docs/CHARACTERS.md "First-person arms conventions"): the arms rig's root is the eye, so the
// GLB hangs at identity under the lagging flashlight rig (src/player/flashlight-rig.ts) — arms and beam sway
// together. Every frame the SpotLight (+ its target and the Max beam cone) is moved to the `flashlight_beam` bone:
// the beam leaves the lens in the left hand. Clips: idle loop, one-shots (knock, bell pull, door rattle, toggle,
// hide push, freeze) crossfaded back to idle, breath-hold loop while Space is held.

import * as THREE from 'three/webgpu';
import { max, mix, normalView, normalWorld, positionViewDirection, positionWorld, reflectVector, roughness, smoothstep, uniform, vec3 } from 'three/tsl';
import type { LoadedCharacter } from './loader.ts';
import { TORCH_POOL, TORCH_WORLD, torchPoolRadiance } from '../render/flashlight-bounce.ts';
import { EXPOSURE_CUE } from '../render/exposure.ts';
import { SKY_U, skyIrradiance, skyRadiance } from '../world/atmosphere.ts';

/**
 * Round 3 (R2-3): the arms' own environment. They rendered as black cut-outs in every torch view: the barrel is
 * metal and the glove/snaps glossy, but nothing gave them anything to reflect, and the hand's back faces away from
 * the bounce spot. Radiance = the torch's lit pool (render/flashlight-bounce.ts TORCH_POOL) + outdoors the overcast
 * sky along the lobe's dominant direction; irradiance = the analytic sky once the camera is beyond the exterior probe
 * grid (inside it the grid lights them, as before), plus indoors the torch's interreflected fill (TORCH_POOL.fill). Candles / lamps / probes stay in the LightsNode (story-runtime).
 */
/** FLASH #146b QA: gain on the Medium glove's environment sheen (1 = physical; 0 = off, for same-frame A/B). */
export const ARMS_SHEEN = uniform(1);

class ArmsEnvNode extends (THREE as any).LightingNode {
  /** runtime lane E (item 6): an environment-only sheen for the glove leather where the Charlie lobe is off (Medium). */
  sheen = false;
  setup(builder: any): void {
    const ctx = builder.context;
    const a2 = roughness.mul(roughness);
    const d = mix(reflectVector, normalWorld, a2).normalize();
    const w = roughness.mul(0.35).add(0.03);
    const sky = mix(SKY_U.ground, skyRadiance(d), smoothstep(w.negate(), w, d.y)).mul(SKY_U.outside);
    // the room's interreflected field is (near) isotropic: it lights the diffuse (E) AND is what the glossy leather /
    // snaps / barrel reflect wherever the pool isn't in their lobe (L = E/π) — the worn edges' sheen in torch views
    const fill = TORCH_POOL.fill.mul(TORCH_POOL.gain).mul(SKY_U.outside.oneMinus());
    const env = torchPoolRadiance().add(sky).add(fill.mul(1 / Math.PI));
    ctx.radiance.addAssign(env);
    ctx.irradiance.addAssign(skyIrradiance(normalWorld).mul(SKY_U.beyondGrid).add(fill));
    if (this.sheen && ctx.reflectedLight) {
      // napped / oiled hide back-scatters at grazing angles (the Charlie sheen of Max, sheenColor 0.16/0.14/0.12,
      // roughness 0.5). Environment only — no per-light cost. FLASH #146b: three r186's OWN indirect sheen, as Max
      // evaluates it (PhysicalLightingModel: E · sheenColor · DG(n·v) / π with the Charlie directional-albedo fit
      // IBLSheenBRDF at sheenRoughness 0.5: DG = exp(−2.70 μ − 0.65) — 0.52 at grazing, 0.14 at μ 0.5, 0.035 head-on),
      // lit by the IRRADIANCE at the normal: the pool as a Lambertian disc (E = π L r²/(r² + d²) · cos θ_s · cos θ_p),
      // the room's fill, the sky outdoors. The old term — (1 − n·v)³ × the pool's REFLECTED radiance — lit every
      // silhouette edge alike (at grazing the reflection runs on into the lit floor): a bright outline round each finger
      // (A/B scratch/flash-hand/r1ab/ab-outline.jpg: gone with the sheen off, unchanged with the sharpen off); now only
      // the edges that face the pool catch it, ≈ 1/10 as bright.
      const P = TORCH_POOL;
      const pv = P.pos.sub(positionWorld);
      const pd2 = max(pv.dot(pv), 1e-4);
      const ph = pv.mul(pd2.inverseSqrt());
      const pr2 = P.radius.mul(P.radius);
      const ePool = P.radiance.mul(Math.PI).mul(pr2.div(pd2.add(pr2))).mul(max(normalWorld.dot(ph), 0)).mul(max(ph.dot(P.normal).negate(), 0));
      const eSheen = ePool.add(fill).add(skyIrradiance(normalWorld).mul(SKY_U.outside));
      const nv = normalView.dot(positionViewDirection).abs().clamp(0, 1);
      const dg = nv.mul(-2.6995).sub(0.6505).exp();
      ctx.reflectedLight.indirectSpecular.addAssign(vec3(0.16, 0.14, 0.12).mul(eSheen).mul(dg).mul(1 / Math.PI).mul(ARMS_SHEEN));
    }
  }
}

/**
 * FLASH #146b: clips whose LEFT hand is on the wheel / a control, not on the torch (blender/anim/clips_arms.py: "the left
 * hand leaves the torch (the runtime hides the flashlight mesh in the car)" — nothing did). With the #146b grip the torch
 * stayed in the wheel fist pointing 49° UP (the rest pose's barrel-in-palm, carried by the rim frame): while one of these
 * is the base clip (or the arms ride the car anchor) the torch meshes are hidden and the SpotLight (off in the car;
 * C1 switches it on at 73.6 with the wheel clip still loaded) leaves from the idle pose's lens, not the wheel fist.
 * Switching between a car clip and a torch clip is a cut-level change (hands off the wheel ↔ torch in the fist): no
 * crossfade (a 0.35 s blend swept the torch through the frame at C1 73.7).
 */
const CAR_CLIPS = new Set(['arms_wheel', 'arms_map', 'arms_radio_seek', 'arms_headlamp_knob', 'arms_stalk_flick', 'arms_brace']);
/** Mounted in the car with the torch on (C6 may carry it on from B12): the light where the pre-#146b wheel clip had it —
 *  the torch at the left knee pointing into the door well (lens (−0.265, 0.416, −0.354) camera space, beam (−0.617,
 *  −0.145, −0.774); scratch/flash-hand/clipcheck.mjs on HEAD arms.glb) — so a lit cabin keeps its reviewed look. Rig frame. */
const CAR_LENS = [-0.265, -0.354, -0.416] as const;
const CAR_DIR = [-0.617, -0.774, 0.145] as const;

/**
 * FLASH #146b (smooth motion): the arms GLB's rotation keys are QUANTISED. Blender 5.2's glTF exporter encodes every
 * animation rotation through meshopt's quaternion filter at a hard-coded 8 bits (io_scene_gltf2/io/exp/meshopt.py
 * QUAT_FILTER_BITS = 8): ≈ 0.4–1.1° steps (scratch/flash-hand/trackq.mjs on arms_idle: hand_l 75 of 120 key steps exactly
 * 0, then 0.4–1.1° jumps). The idle sway moves ≈ 0.09°/frame, so the torch hand stood still, then jumped 3–7 mm at the
 * lens — a stop-motion twitch at rest (hand-motion.mjs: 6 px one-frame steps, also on the pre-#146b build). Until the
 * export keeps more bits (requested), the SLOW loops are low-passed at load: a Gaussian over the keys (σ in keys, 30 keys
 * per s; circular for loops, so the seam stays continuous), per quaternion component after aligning hemispheres, then
 * renormalised. σ 4 keys (0.13 s) passes the idle's 0.2–0.35 Hz sway at 99 % and turns a 0.6° quantum into a ramp over
 * ≈ 8 frames. Fast clips (knock, toggle, the breath hold's 7 Hz tremble) are left as baked: their motion hides the steps.
 */
const SMOOTH_SIGMA: Record<string, number> = { arms_idle: 4, arms_wheel: 4, arms_locket_hold: 2 };

/** Gaussian low-pass of a clip's quaternion tracks (in place); loops (first key == last key) are filtered circularly. */
export function smoothQuaternionTracks(clip: any, sigma: number): number {
  let n0 = 0;
  const r = Math.ceil(sigma * 3);
  const w: number[] = [];
  for (let k = -r; k <= r; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  for (const tr of clip.tracks ?? []) {
    if (!String(tr.name).endsWith('.quaternion')) continue;
    const v = tr.values;
    const n = v.length / 4;
    if (n < 4) continue;
    // loops: the baker copies key 0 onto the last key (blender/anim/clip.py) → filter the n − 1 unique keys circularly
    let loop = true;
    for (let c = 0; c < 4; c++) if (Math.abs(v[c] - v[4 * (n - 1) + c]) > 1e-4) loop = false;
    const m = loop ? n - 1 : n;
    const q = new Float64Array(4 * m);
    for (let i = 0; i < m; i++) {
      let sgn = 1;
      if (i > 0) {
        let d = 0;
        for (let c = 0; c < 4; c++) d += v[4 * i + c] * q[4 * (i - 1) + c];
        if (d < 0) sgn = -1;
      }
      for (let c = 0; c < 4; c++) q[4 * i + c] = sgn * v[4 * i + c];
    }
    const out = new Float64Array(4 * m);
    for (let i = 0; i < m; i++) {
      let ws = 0;
      const acc = [0, 0, 0, 0];
      for (let k = -r; k <= r; k++) {
        let j = i + k;
        if (loop) j = ((j % m) + m) % m;
        else if (j < 0 || j >= m) continue;
        // keep the neighbour on this key's hemisphere (circular wrap may cross a flip)
        let d = 0;
        for (let c = 0; c < 4; c++) d += q[4 * j + c] * q[4 * i + c];
        const sg = d < 0 ? -1 : 1;
        const wk = w[k + r];
        for (let c = 0; c < 4; c++) acc[c] += wk * sg * q[4 * j + c];
        ws += wk;
      }
      const len = Math.hypot(acc[0], acc[1], acc[2], acc[3]) || 1;
      for (let c = 0; c < 4; c++) out[4 * i + c] = acc[c] / len;
    }
    for (let i = 0; i < m; i++) for (let c = 0; c < 4; c++) v[4 * i + c] = out[4 * i + c];
    if (loop) for (let c = 0; c < 4; c++) v[4 * (n - 1) + c] = out[c];
    n0++;
  }
  return n0;
}

const ONE_SHOTS = new Set(['arms_flashlight_toggle', 'arms_knock', 'arms_bell_pull', 'arms_door_rattle', 'arms_freeze', 'arms_hide_push', 'arms_key', 'arms_pickup_read', 'arms_pry_board', 'arms_cut_hem', 'arms_raise_locket', 'arms_slide_bolt', 'arms_pour_can']);

/** C2-ESCAPE review: while on (C2c's climb, cue fx `beamClamp`; cleared when a cutscene releases the camera) the beam
 *  is held within BEAM_MAX of the gaze. Gameplay is unchanged (off). */
export const BEAM_CLAMP: { on: boolean; at: [number, number, number] | null } = { on: false, at: null };
/** (fix round) BEAM_CLAMP.at: a WORLD point the beam is aimed at while set (C2c glance #2: her hand on the rail — you
 *  point the torch where you look; at the real 0.25 exposure the hand was outside the hot spot). */
/** Max angle between the beam and the gaze (rig −Z): 12° (r3: 20° left glance #2 her hand outside the beam). */
const BEAM_MAX_COS = Math.cos((12 * Math.PI) / 180);
const BEAM_MAX_SIN = Math.sin((12 * Math.PI) / 180);

/**
 * FLASH lane (#146) — the torch arm near walls. The idle pose holds the lens ≈ 0.55 m ahead of the eye (CHARACTERS.md
 * flash_center (−0.135, 0.44, −0.235) + the head), but the body capsule lets the eye come within 0.27 m of a wall: the
 * lens and glove went THROUGH the wall and the SpotLight lit the wall from behind (N·L < 0 — a black frame; measured in
 * scratch/flash-beam). A person bends the elbow instead: each frame three short rays (the torch line abeam of the eye,
 * ± the head radius) find the free distance F ahead of the torch; the hand is drawn back along the beam axis by a
 * smooth hinge of the penetration x = s + MARGIN − F (s = the clip's lens distance ahead of the eye):
 *   pull = 0 (x ≤ −KNEE) · (x + KNEE)² / 4·KNEE · x (x ≥ KNEE), ≤ PULL_MAX,
 * eased (τ 0.05 s withdrawing, 0.3 s relaxing) and applied as a two-bone IK on the LEFT arm: the elbow folds in the
 * clip's own bend plane and the hand keeps its world orientation, so the beam's aim — and its pool on the wall — stay
 * where they were (the hand moves along the beam axis). The right hand (knock, bell, latch clips) is untouched.
 */
/** Lens-to-surface clearance kept (m): a 2-D-cell head is Ø ≈ 6.5 cm, a glove's knuckles stand ≈ 3 cm proud of it. */
const PULL_MARGIN = 0.06;
/** The elbow starts to bend this far (m) before the margin would be reached (C¹ hinge half-width). */
const PULL_KNEE = 0.15;
/** Largest pullback (m): the lens 0.55 → ≈ 0.13 m ahead of the eye (the hand at the chest, below the frame). */
const PULL_MAX = 0.42;
/** Withdraw / relax time constants (s): at 1.6 m/s walking the 0.05 s lag is 8 cm, inside the knee. */
const PULL_TAU_OUT = 0.05;
const PULL_TAU_IN = 0.3;
/** Torch head radius (m) for the side rays (a thin capsule round the torch line, not a single ray). */
const PULL_R = 0.035;
/** Lead of the free-distance probe on an approach (s): the ease lags v·τ (18 cm at the 3.6 m/s run) — the target is
 *  taken at F − v_approach·PULL_LEAD (≤ 0.25 m), so a sprint at a wall withdraws the hand in time. */
const PULL_LEAD = 0.06;
/** The hand rises as it comes in (m per m of pullback). LOOK #146c: 0.25 → 0. Lifted toward the chin, the drawn-in torch
 *  head stayed in the bottom-left corner of the frame (0.09 m under the eye, 0.11 m ahead, its glass facing the camera
 *  under the near-wall aim) and swept out of it in ONE frame at wall contact (scratch/flash-look/after-med/walk-strip2.jpg
 *  f55: a blue-white sliver of lens glass, detect FLICKER 32). Drawn straight back the fist stays at the chest (0.18 m
 *  under the eye) and leaves the frame through its bottom edge 2 frames earlier, ≤ 27 px/frame @640 (offline
 *  scratch/flash-look/pullsim.ts, 1.6 m/s at 30 fps; was 59), and never creeps back into the corner while the pull relaxes. */
const PULL_LIFT = 0;
/**
 * Near-wall aim (FLASH #146): you light where you look. The idle clip holds the lens 0.235 m below the eye aiming ≈ 3°
 * down, so the pool lands below the gaze by 0.235 m + 0.05·d — 9° at 2.3 m (the "torch held low" look the B05 tuning
 * relies on, unchanged), but 27° at 0.5 m and 40° (out of the 70° frame) at 0.3 m: walking at a wall the hot spot slid
 * off the bottom of the view and the centre was left in the dim spill. Inside AIM_FAR the hand turns the torch toward the
 * gaze point (the gaze ray's hit): weight 1 − smoothstep(AIM_NEAR, AIM_FAR, gaze distance), eased (AIM_W), ≤ AIM_MAX.
 * FLASH part 2: AIM_NEAR 0.8 → 1.25 m — with the aim now exact the pool sits ON the gaze point from 1.25 m in (< 2 cm; at
 * 0.8 it was still 4–9 cm under it at 1.0–1.25 m); AIM_FAR unchanged, so B05 at 2.3 m keeps the torch held low (aim 0).
 */
const AIM_NEAR = 1.25;
const AIM_FAR = 2.0;
/**
 * FLASH part 2: the aim weight follows its target through a critically damped spring (natural frequency AIM_W): it
 * starts from rest. The old first-order ease (τ 0.15 s) moved 20 % of a whole re-aim in the first 30 fps frame — a one-frame
 * 34–53 px torch twitch the moment the gaze ray landed on a stair rail (verify pan2 f44 / f14). 10–90 % in ≈ 3.4/ω =
 * 0.34 s, as the old τ 0.15 s (0.33 s).
 */
const AIM_W = 10;
/**
 * FLASH part 2: when the gaze point HOPS (the hit point jumps by more than the eye's own motion could explain: ≥ 0.25 m
 * and ≥ 3× the eye's move since the last ray — a rail, a door-frame edge, a baluster entering the gaze, a surface found
 * again after the gaze left it), the aim target glides from the old point to the new one over GAZE_HOP s (smoothstep) instead of re-aiming in one
 * frame. Sliding over one surface (turning, walking at it) is tracked exactly: no lag where the hot spot must sit.
 */
const GAZE_HOP = 0.25;
/** FLASH part 2: 50° → 65°. With the aim solved exactly, looking DOWN at a wall within 0.4 m needs the hand turned 54°
 *  (pitch −20°) to 60° (−35°): at 50° the beam fell 3–4 cm short of the gaze point (outside the 1–2 cm near core). A
 *  real wrist + forearm reach that turn easily with the fist drawn in to the chest (out of frame at level gaze). */
const AIM_MAX = (65 * Math.PI) / 180;
/**
 * FLASH part 2 (fixer r2) — the ELBOW beside a wall. The near-wall pull only probes along the torch line, so a wall at
 * the player's LEFT never moved the arm: the clip holds the elbow ≈ 0.42 m left of the eye, the body capsule lets the eye
 * come within 0.27 m of a wall, and the forearm went into the wallpaper — looking down 35° hugging a left wall, 116 of
 * 16 000 frame cells showed sleeve BEHIND the wall plane (a cut line at the bottom-left; scratch/flash-fixr2/elbowsim.ts,
 * the real arms.glb). A person drops the elbow against the body instead. Each frame one ray from the shoulder to the
 * IK elbow's OUTER sleeve surface (the elbow + ELBOW_MARGIN along its bend direction); if a wall is nearer, the elbow
 * swings DOWN about the shoulder→wrist line to the first clear angle (sampled every ELBOW_STEP, the crossing
 * interpolated, ≤ ELBOW_MAX), eased (τ out / in), the margin led by the elbow's approach speed (ELBOW_LEAD). The hand
 * keeps its world pose — the torch, its beam and its pool do not move; only the arm's angle changes. Offline
 * (elbowsim.ts): hugging a left wall looking down 35° the sleeve cells behind the wall 116 → 0; strafing into it at
 * 1.6 m/s ≤ 17 cells for 2 frames (was 183 sustained), the elbow ≤ 3.8 cm per 30 fps frame.
 */
const ELBOW_MARGIN = 0.02;
const ELBOW_STEP = (15 * Math.PI) / 180;
const ELBOW_MAX = (90 * Math.PI) / 180;
const ELBOW_TAU_OUT = 0.08;
const ELBOW_TAU_IN = 0.3;
/** How far beyond the margin the elbow ray looks (m) — the signed clearance's range and the lead's cap. */
const ELBOW_LOOK = 0.3;
/** Lead (s) of the elbow probe on an approach: margin + v·ELBOW_LEAD (≤ ELBOW_LOOK). */
const ELBOW_LEAD = 0.12;
/**
 * FLASH #146b (the hand): the torch hand is on the body, not on the skull. Looking up or down is mostly the neck: a
 * person raises or lowers the torch to light where they look, but the fist does not ride the head through the whole
 * pitch — welded (the old rig), the fist sat at the same spot of the frame at −45° and +30° (scratch/flash-hand/before
 * down45/up30: identical bboxes). The arms' root (and the lens with it — the beam keeps its direction, so the pool stays
 * where you look) swings about the eye by −PITCH_K × the view pitch, ≤ PITCH_MAX: looking down 45° the fist rises 9° in
 * the frame, looking up 30° it sinks 6° toward the frame edge. Eased with PITCH_TAU (the arm's inertia: a fast look
 * leaves the hand a beat behind). Off (eased to 0) under a cutscene, a cue, BEAM_CLAMP or the car anchor.
 */
const PITCH_K = 0.2;
const PITCH_MAX = (10 * Math.PI) / 180;
const PITCH_TAU = 0.12;
/** The swung point: the grip (blender/characters/arms.py GRIP center, camera (−0.15, 0.36, −0.26) → rig (x, z, −y)). */
const GRIP_RIG = [-0.15, -0.26, -0.36] as const;

export class FpArms {
  readonly c: LoadedCharacter;
  /** The uniforms of the arms' environment (ArmsEnvNode), for the ?debug console. */
  readonly env = { pool: TORCH_POOL, sky: SKY_U, sheen: ARMS_SHEEN };
  readonly mixer: any;
  private readonly actions = new Map<string, any>();
  private base = 'arms_idle';
  private oneShot: any = null;
  private readonly beamBone: any;
  /** Beam axis in the bone's local frame (found at load: the axis that points forward in the idle pose). */
  private readonly beamAxis = new THREE.Vector3(0, 1, 0);
  private readonly parent: any;
  private readonly _p = new THREE.Vector3();
  private readonly _d = new THREE.Vector3();
  private readonly _m = new THREE.Matrix4();
  private readonly _q = new THREE.Quaternion();
  private readonly _p2 = new THREE.Vector3();
  /** True when the clip's torch bone pointed > 12° off the gaze this frame (debug). */
  beamClamped = false;
  /** FLASH (#146): the torch hand's current pullback along the beam axis (m, smoothed; QA reads it). */
  pull = 0;
  /** Debug A/B: false = the old behaviour (the lens may enter walls). */
  pullEnabled = true;
  /** QA A/B: the hand's rise per m of pullback (PULL_LIFT) and the near-wall aim's largest turn (AIM_MAX, rad). */
  pullLift = PULL_LIFT;
  aimMax = AIM_MAX;
  /** While BEAM_CLAMP is on (C2c, the SMOOTHNESS FRAMES lane's authored climb) the pullback stays off unless this is set
   *  (FLASH #146 hands C2c's "light inside the wall" frames to that lane: set it from the cue to opt in). */
  pullInClamp = false;
  /** True while a cutscene holds the camera (story-runtime's camHeldByCutscene, to be wired by the lead): the
   *  near-wall pullback/aim stay off so authored shots are untouched. Until wired, any exposure cue (C2/C2c's film
   *  camera, the opening's hold) also turns them off. */
  cutsceneHold = false;
  private freeD = Infinity;
  private approach = 0;
  /** The probes run every 2nd frame (≈ 0.05 ms per octree ray; the eases interpolate): cached targets + their dt. */
  private probeDt = 0;
  private wantP = 0;
  private wantA = 0;
  /** FLASH (#146): near-wall aim weight toward the gaze point (0..1, smoothed; QA reads it) and its debug switch. */
  aim = 0;
  aimEnabled = true;
  /** FLASH part 2 (fixer r2): the elbow's swing down from a side wall (rad, smoothed; QA reads it) and its switch. */
  fold = 0;
  foldEnabled = true;
  /** The clip elbow's last signed clearance (m) and its smoothed approach speed (m/s) for ELBOW_LEAD. */
  private elbowC = Infinity;
  private elbowV = 0;
  /** FLASH #146b: the pitch decoupling (PITCH_K; 0 = the welded hand, A/B) and its current eased swing (rad, QA). */
  pitchK = PITCH_K;
  pitchSwing = 0;
  private readonly gazeP = new THREE.Vector3();
  /** The aim weight's velocity (1/s; AIM_W spring). */
  private aimV = 0;
  /** The gaze ray's latest hit, its distance and eye; the hop glide (GAZE_HOP): start point and progress 0..1. */
  private readonly gazeRaw = new THREE.Vector3();
  private gazeG = Infinity;
  private readonly gazeEye = new THREE.Vector3();
  private readonly gazeFrom = new THREE.Vector3();
  private gazeHop = 1;
  /** QA: gaze hops glided so far (GAZE_HOP). */
  gazeHops = 0;
  /**
   * FLASH part 2 (V1/V3): the game poses the arms BEFORE the rig follows the eye (story-runtime's arms.update runs ahead
   * of main.ts's rig.update), so every world-space input of the aim — the gaze ray, the lens — was one frame stale:
   * walking at a wall at 1.6 m/s the rig then moved 5.3 cm on and the aimed beam passed ≈ 5 cm below the gaze point (the
   * hot spot slid out of the shrinking core: gaze irradiance 774 → 331 lx from 0.8 m to contact, offline walksim.ts),
   * and at the stop it jumped. FlashlightRig.update calls afterRig() once the rig has moved: the aim is re-solved with
   * this frame's rig and the light re-placed (update() alone — tests, or a rig that is not updated — keeps its result).
   */
  private lastLight: any = null;
  private lastBeam: any = null;
  /** The near-wall IK may act this frame (no car anchor, arms visible, an arm to bend); the aim is live (no cutscene,
   *  cue or C2c clamp). */
  private armActive = false;
  private aimFree = false;
  private readonly _qr = new THREE.Quaternion();
  private readonly _qi = new THREE.Quaternion();
  private readonly armL: { up: any; fore: any; hand: any } | null;
  private readonly _w = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly _qa = new THREE.Quaternion();
  private readonly _qb = new THREE.Quaternion();
  private readonly _qh = new THREE.Quaternion();
  /** The clip pose of upperarm/forearm/hand before the IK (restored before the next mixer update: never accumulates). */
  private readonly ikSaved = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
  private ikApplied = false;

  constructor(c: LoadedCharacter, parent: any) {
    this.c = c;
    this.parent = parent;
    for (const m of c.meshes) {
      m.castShadow = false; // the light sits inside the flashlight body
      m.receiveShadow = false;
      m.renderOrder = 5;
    }
    for (const m of c.materials) {
      if (m.isMeshBasicNodeMaterial) continue;
      const glove = String(m.userData?.material_id) === 'leather_worn' && !(m.sheen > 0);
      m.setupEnvironment = () => {
        const n = new ArmsEnvNode();
        n.sheen = glove;
        return n;
      };
    }
    for (const [name, sigma] of Object.entries(SMOOTH_SIGMA)) {
      const clip = c.clips.get(name);
      if (clip) smoothQuaternionTracks(clip, sigma);
    }
    parent.add(c.root);
    // FlashlightRig.update calls this once the rig has moved this frame (see afterRig)
    parent.userData.afterRig = () => this.afterRig();
    this.mixer = new THREE.AnimationMixer(c.root);
    this.mixer.addEventListener('finished', (e: any) => {
      if (e.action === this.oneShot) this.endOneShot();
    });
    this.beamBone = c.bones.get('flashlight_beam') ?? null;
    const up = c.bones.get('upperarm_l');
    const fore = c.bones.get('forearm_l');
    const hand = c.bones.get('hand_l');
    this.armL = up && fore && hand ? { up, fore, hand } : null;
    this.loop('arms_idle', 0);
    this.mixer.update(0.5);
    // Which local axis of flashlight_beam points forward (rig −Z) in the idle pose? (CHARACTERS.md: +Y in Blender)
    if (this.beamBone) {
      c.root.updateMatrixWorld(true);
      const q = new THREE.Quaternion();
      this.relMatrix(this._m).decompose(this._p, q, this._d);
      const fwd = new THREE.Vector3(0, 0, -1);
      let best = -2;
      for (const ax of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ] as const) {
        const v = new THREE.Vector3(...ax).applyQuaternion(q);
        const d = v.dot(fwd);
        if (d > best) {
          best = d;
          this.beamAxis.set(...ax);
        }
      }
      // the idle lens + beam (rig frame): where the light leaves while the hands are on the wheel (CAR_CLIPS)
      this.idleLens.copy(this._p);
      this.idleDir.copy(this.beamAxis).applyQuaternion(q).normalize();
    }
    this.torchMeshes = c.meshes.filter((m: any) => String(m.name ?? '').startsWith('arms_flashlight'));
  }

  private readonly idleLens = new THREE.Vector3(-0.14, -0.27, -0.51);
  private readonly idleDir = new THREE.Vector3(0, 0, -1);
  private torchMeshes: any[] = [];
  /** True while the hands are on the wheel / car controls (CAR_CLIPS base or the car anchor): torch hidden (QA). */
  carHands = false;

  private anchor: any = null;

  /**
   * Review fix (C1 driver POV): the car clips (arms_wheel, knob, stalk, radio, map) are authored in the eye frame of
   * blender/anim/clips_arms.py — car − EYE with the CAR's axes. Riding the camera rig, the gloves turned with every
   * head turn (radio glance, dome knob, passenger seat, visor, the 48 sign) and left the rim: at C1 20 the right glove
   * sat on the horn pad and the left hung off the column. With `obj` (the mounted interior, local = car space as
   * (x, z, −y)) the root is fixed at the driver's eye in the car frame, so the hands stay on the wheel while the head
   * turns, as a driver's do. null = back on the rig (walking play).
   */
  anchorTo(obj: any | null, eye: readonly [number, number, number] = [0, 0, 0]): void {
    const root = this.c.root;
    if (obj === this.anchor) return;
    this.anchor = obj;
    if (obj) {
      obj.add(root);
      root.position.set(eye[0], eye[2], -eye[1]);
      root.quaternion.identity();
    } else {
      this.parent.add(root);
      root.position.set(0, 0, 0);
      root.quaternion.identity();
    }
    root.updateMatrixWorld(true);
  }

  private lightSets: { house: Map<any, any>; car: Map<any, any> } | null = null;
  private carLights = false;

  /**
   * runtime lane E (item 3): two FIXED material sets — one per LightsNode — instead of switching material.lightsNode
   * (+ needsUpdate) at the car mount. The switch rebuilt all 7 arm shaders at C0's first live cut (12.5 s: 0.17 s
   * Medium / 0.42 s Max, scratch/re/cut3). A render object is keyed by its material, so with a set per light list both
   * are built once (the load warm-up draws both) and the mount only swaps mesh.material.
   */
  setLightSets(house: any, car: any): void {
    const hm = new Map<any, any>();
    const cm = new Map<any, any>();
    for (const m of this.c.materials) {
      m.lightsNode = house;
      const alt = m.clone();
      // instance overrides (setupEnvironment, lighting model hooks) are not part of Material.copy
      for (const k of Object.keys(m)) if (typeof m[k] === 'function') alt[k] = m[k];
      alt.userData = m.userData;
      alt.lightsNode = car;
      hm.set(alt, m);
      cm.set(m, alt);
    }
    this.lightSets = { house: hm, car: cm };
    this.carLights = false;
  }

  /** Swaps every arm mesh to the car-light (true) or house-light (false) material set. */
  useCarLights(on: boolean): void {
    if (!this.lightSets || on === this.carLights) return;
    this.carLights = on;
    const map = on ? this.lightSets.car : this.lightSets.house;
    for (const mesh of this.c.meshes) {
      const next = map.get(mesh.material);
      if (next) mesh.material = next;
    }
  }

  get visible(): boolean {
    return this.c.root.visible;
  }

  set visible(v: boolean) {
    this.c.root.visible = v;
  }

  private action(clip: string): any {
    let a = this.actions.get(clip);
    if (a) return a;
    const c = this.c.clips.get(clip);
    if (!c) return null;
    a = this.mixer.clipAction(c);
    this.actions.set(clip, a);
    return a;
  }

  /** Base loop (idle / breath hold / wheel). */
  loop(clip: string, fade = 0.35): void {
    const a = this.action(clip);
    if (!a) return;
    const prev = this.action(this.base);
    if (CAR_CLIPS.has(this.base) !== CAR_CLIPS.has(clip)) fade = 0; // wheel ↔ torch: no blend (see CAR_CLIPS)
    this.base = clip;
    if (this.oneShot) return; // resumes after the one-shot
    a.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    if (prev && prev !== a && fade > 0) prev.crossFadeTo(a, fade, false);
    else if (prev && prev !== a) prev.stop();
  }

  /** One-shot clip over the base loop. */
  play(clip: string, fade = 0.15): void {
    const a = this.action(clip);
    if (!a) return;
    const from = this.oneShot ?? this.action(this.base);
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.play();
    if (from && from !== a) from.crossFadeTo(a, fade, false);
    this.oneShot = a;
    void ONE_SHOTS;
  }

  /** Does the GLB have this clip (M2 clips arrive with the character lane's rebuild)? */
  has(clip: string): boolean {
    return this.c.clips.has(clip);
  }

  /** Abort the current one-shot (a hold interaction released early) and blend back to the base loop. */
  cancelOneShot(): void {
    if (this.oneShot) this.endOneShot();
  }

  private endOneShot(): void {
    const from = this.oneShot;
    this.oneShot = null;
    const b = this.action(this.base);
    if (!b) return;
    b.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    if (from) from.crossFadeTo(b, 0.3, false);
  }

  /** Beam-bone transform relative to the parent (the flashlight rig). */
  private relMatrix(out: any): any {
    this.parent.updateWorldMatrix(true, false);
    this.beamBone.updateWorldMatrix(true, false);
    return out.copy(this.parent.matrixWorld).invert().multiply(this.beamBone.matrixWorld);
  }

  /**
   * Advance the clips and put the light at the lens. `light`/`target`/`beam` are children of the same parent
   * (the flashlight rig).
   */
  update(dt: number, light: any, beam: any | null, on = true, level = 1): void {
    if (this.ikApplied && this.armL) {
      this.armL.up.quaternion.copy(this.ikSaved[0]);
      this.armL.fore.quaternion.copy(this.ikSaved[1]);
      this.armL.hand.quaternion.copy(this.ikSaved[2]);
      this.ikApplied = false;
    }
    this.mixer.update(dt);
    this.swingRoot(dt);
    const carHands = this.anchor != null || CAR_CLIPS.has(this.base);
    if (carHands !== this.carHands) {
      this.carHands = carHands;
      for (const m of this.torchMeshes) m.visible = !carHands;
    }
    this.c.lensGlow.value = on ? level : 0;
    if (!this.beamBone || !light) return;
    this.c.root.updateMatrixWorld(true);
    this.relMatrix(this._m).decompose(this._p, this._q, this._d);
    let dir = this._d.copy(this.beamAxis).applyQuaternion(this._q).normalize();
    this.lastLight = light;
    this.lastBeam = beam;
    this.armActive = !!this.armL && !this.anchor && this.c.root.visible;
    if (this.armActive) {
      const cue = EXPOSURE_CUE.fixed != null || EXPOSURE_CUE.min != null || EXPOSURE_CUE.max != null || EXPOSURE_CUE.hold;
      const free = (!BEAM_CLAMP.on || this.pullInClamp) && !this.cutsceneHold && !cue;
      this.aimFree = free && this.aimEnabled;
      this.probeDt += dt;
      // LOOK #146c: probed EVERY frame (5 BVH rays). Every 2nd frame, the pull's target stepped on alternate frames and the
      // τ 0.05 s ease turned that into a 15 Hz sawtooth of the hand on a wall approach (lens steps 7.2 / 3.6 cm per frame
      // at 30 fps, pullsim.ts); per frame: an even ≤ 5.5 cm.
      this.wantP = this.pullEnabled && free ? this.wantPull(this._p, dir, this.probeDt) : 0;
      if (dt > 0) this.gazeHop = Math.min(1, this.gazeHop + dt / GAZE_HOP);
      this.wantA = this.aimEnabled && free ? this.wantAim() : 0;
      this.probeDt = 0;
      const want = this.wantP;
      if (dt > 0) this.pull += (want - this.pull) * (1 - Math.exp(-dt / (want > this.pull ? PULL_TAU_OUT : PULL_TAU_IN)));
      let wantF = 0;
      if (this.foldEnabled && free) wantF = this.wantFold(this.pull, dir, dt);
      else {
        this.elbowC = Infinity; // no stale clearance → no fake approach speed when the fold comes back on
        this.elbowV = 0;
      }
      if (dt > 0) this.fold += (wantF - this.fold) * (1 - Math.exp(-dt / (wantF > this.fold ? ELBOW_TAU_OUT : ELBOW_TAU_IN)));
      const wantAim = this.wantA;
      if (dt > 0) {
        // critically damped (AIM_W), the exact step: x(t) = x* + (c1 + c2 t) e^(−ωt), c1 = x0 − x*, c2 = v0 + ω c1
        const w = AIM_W;
        const c1 = this.aim - wantAim;
        const c2 = this.aimV + w * c1;
        const e = Math.exp(-w * dt);
        this.aim = wantAim + (c1 + c2 * dt) * e;
        this.aimV = (c2 - w * (c1 + c2 * dt)) * e;
        if (this.aim < 0 || this.aim > 1) {
          this.aim = Math.min(1, Math.max(0, this.aim));
          this.aimV = 0;
        }
      }
      if (this.pull > 1e-4 || this.aim > 1e-3 || this.fold > 1e-3) {
        this.poseArm(this.pull, dir, this.aim);
        this.relMatrix(this._m).decompose(this._p, this._q, this._d);
        dir = this._d.copy(this.beamAxis).applyQuaternion(this._q).normalize();
      }
    } else {
      this.pull = 0;
      this.aim = 0;
      this.aimV = 0;
      this.fold = 0;
      this.elbowC = Infinity;
      this.elbowV = 0;
      this.aimFree = false;
    }
    this.placeLight(light, beam, dir);
  }

  /**
   * FLASH part 2 (V1/V3): FlashlightRig.update calls this once the rig has followed the eye THIS frame (it runs after
   * update() in the game loop). The clip pose is restored and the near-wall IK re-solved with this frame's rig: a fresh
   * gaze ray (the aim) and lens/wrist positions; the eased pull/aim of update() are kept. Then the light is re-placed.
   */
  afterRig(): void {
    const light = this.lastLight;
    if (!light || !this.beamBone) return;
    if (this.ikApplied && this.armL) {
      this.armL.up.quaternion.copy(this.ikSaved[0]);
      this.armL.fore.quaternion.copy(this.ikSaved[1]);
      this.armL.hand.quaternion.copy(this.ikSaved[2]);
      this.ikApplied = false;
    }
    this.c.root.updateMatrixWorld(true);
    this.relMatrix(this._m).decompose(this._p, this._q, this._d);
    let dir = this._d.copy(this.beamAxis).applyQuaternion(this._q).normalize();
    if (this.armActive && (this.pull > 1e-4 || this.aim > 1e-3 || this.fold > 1e-3)) {
      // a fresh gaze ray only while the aim is live (under a cutscene / cue it decays toward the last gameplay point)
      if (this.aim > 1e-3 && this.aimFree) this.gazeRay();
      this.poseArm(this.pull, dir, this.aim);
      this.relMatrix(this._m).decompose(this._p, this._q, this._d);
      dir = this._d.copy(this.beamAxis).applyQuaternion(this._q).normalize();
    }
    this.placeLight(light, this.lastBeam, dir);
    // the rig's updateMatrixWorld ran before this re-place: refresh what moved (anything reading matrixWorld before the
    // render — the bounce trace uses getWorldPosition, but be explicit)
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
    this.lastBeam?.updateMatrixWorld();
  }

  /** The light, its target and the Max beam cone at the lens (this._p, rig frame) along `dir` — after the C2c clamp and
   *  the car-hands override. */
  private placeLight(light: any, beam: any | null, dir: any): void {
    // C2-ESCAPE review: a torch held while running/stumbling still points within ≈ 12° of where the eyes go (you light
    // where you look). arms_run_torch's bone aimed the beam off the flight (and its lens glow at the camera): the
    // climb rendered black. While BEAM_CLAMP.on (C2c) the beam is clamped to a 12° cone around the rig's forward (−Z).
    // The real fix is lane A's arms_run_torch beam bone (requested); this keeps C2c lit until then.
    const cosDev = -dir.z; // dot(dir, (0, 0, −1))
    if (BEAM_CLAMP.on && BEAM_CLAMP.at) {
      this.parent.updateWorldMatrix(true, false);
      const tgt = this.parent.worldToLocal(this._p2.set(BEAM_CLAMP.at[0], BEAM_CLAMP.at[1], BEAM_CLAMP.at[2]));
      dir.copy(tgt.sub(this._p)).normalize();
      this.beamClamped = true;
    } else if (BEAM_CLAMP.on && cosDev < BEAM_MAX_COS) {
      const ortho = this._p2.set(dir.x, dir.y, 0);
      if (ortho.lengthSq() < 1e-8) ortho.set(0, -1, 0);
      ortho.normalize();
      dir.set(ortho.x * BEAM_MAX_SIN, ortho.y * BEAM_MAX_SIN, -BEAM_MAX_COS);
      this.beamClamped = true;
    } else this.beamClamped = false;
    if (this.carHands && this.anchor) {
      this._p.set(...CAR_LENS);
      dir.set(...CAR_DIR).normalize();
    } else if (this.carHands) {
      // hands on the wheel but the rig back on the eye (C1 73.6: the torch switched on before the idle clip): the
      // light leaves from the idle pose's lens, as the player picks the torch up — never from the empty wheel fist
      this._p.copy(this.idleLens);
      dir.copy(this.idleDir);
    }
    light.position.copy(this._p);
    light.target.position.copy(this._p).addScaledVector(dir, 3);
    if (beam) {
      // Object3D.lookAt works in WORLD space (and aims +Z, the cone's open end)
      beam.position.copy(this._p);
      beam.updateMatrixWorld();
      beam.lookAt(this.parent.localToWorld(this._d.copy(light.target.position)));
    }
  }

  /** FLASH #146b: the root's pitch swing about the eye (see PITCH_K): translation only, so the beam keeps its aim. */
  private swingRoot(dt: number): void {
    const root = this.c.root;
    if (this.anchor) {
      this.pitchSwing = 0;
      return; // the car anchor owns the root's transform
    }
    const cue = EXPOSURE_CUE.fixed != null || EXPOSURE_CUE.min != null || EXPOSURE_CUE.max != null || EXPOSURE_CUE.hold;
    this.parent.updateWorldMatrix(true, false);
    const f = this._p2.set(0, 0, -1).transformDirection(this.parent.matrixWorld);
    const eye = this._w[0].setFromMatrixPosition(this.parent.matrixWorld);
    // a camera cut this frame (the rig snaps to a cutscene camera): > 15° of turn or > 0.3 m in one frame
    const cut = this.primedSwing && (f.dot(this.swingFwd) < 0.966 || eye.distanceToSquared(this.swingEye) > 0.09);
    this.swingFwd.copy(f);
    this.swingEye.copy(eye);
    let want = 0;
    const free = this.pitchK > 0 && !this.cutsceneHold && !cue && !BEAM_CLAMP.on && root.visible;
    if (free) {
      const pitch = Math.asin(Math.max(-1, Math.min(1, f.y)));
      want = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, -this.pitchK * pitch));
    }
    // a cutscene taking over at a cut gets the clip pose on its first frame (no drift after the cut); without a cut
    // (a scene that starts from the player's own eye) and back in play the swing eases (no one-frame pop)
    if (!this.primedSwing || (cut && !free)) this.pitchSwing = want;
    else if (dt > 0) this.pitchSwing += (want - this.pitchSwing) * (1 - Math.exp(-dt / PITCH_TAU));
    this.primedSwing = true;
    // rotate the grip point about the rig's X axis (through the eye) by the swing; the root carries the difference
    const a = this.pitchSwing;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const [, y, z] = GRIP_RIG;
    root.position.set(0, y * c - z * s - y, y * s + z * c - z);
    root.updateMatrixWorld(true);
  }

  private primedSwing = false;
  private readonly swingFwd = new THREE.Vector3(0, 0, -1);
  private readonly swingEye = new THREE.Vector3();

  /** Target pullback (m) for the clip's lens at `lensRig` (rig frame) aiming `dirRig` (unit, rig frame). */
  private wantPull(lensRig: any, dirRig: any, dt: number): number {
    const sight = TORCH_WORLD.sight;
    if (!sight) return 0;
    const [eye, dW, lensW, q, side, upv] = this._w;
    this.parent.updateWorldMatrix(true, false);
    eye.setFromMatrixPosition(this.parent.matrixWorld);
    lensW.copy(lensRig).applyMatrix4(this.parent.matrixWorld);
    dW.copy(dirRig).transformDirection(this.parent.matrixWorld);
    const s = (lensW.x - eye.x) * dW.x + (lensW.y - eye.y) * dW.y + (lensW.z - eye.z) * dW.z; // lens ahead of the eye
    if (s <= 0.05) return 0;
    // the torch line abeam of the eye (inside the body capsule, so it starts in free space)
    q.copy(lensW).addScaledVector(dW, -s);
    side.set(0, 1, 0).cross(dW);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    upv.copy(dW).cross(side).normalize();
    const far = s + PULL_MARGIN + PULL_KNEE + 0.5; // the approach speed is known before the hinge's soft zone
    let F = sight(q, dW, far);
    if (Number.isFinite(F)) {
      // something ahead: the torch head's rim (a thin capsule, not a line) — door-frame edges, corners
      F = Math.min(F, sight(lensW.copy(q).addScaledVector(side, PULL_R), dW, far));
      F = Math.min(F, sight(lensW.copy(q).addScaledVector(side, -PULL_R), dW, far));
      F = Math.min(F, sight(lensW.copy(q).addScaledVector(upv, PULL_R), dW, far));
    }
    // approach speed along the torch line (smoothed; a jump onto a door frame edge is not a speed: capped 6 m/s)
    if (dt > 0) {
      const v = Number.isFinite(F) && Number.isFinite(this.freeD) ? Math.min(6, Math.max(0, (this.freeD - F) / dt)) : 0;
      this.approach += (v - this.approach) * (1 - Math.exp(-dt / 0.1));
    }
    this.freeD = F;
    if (!Number.isFinite(F)) return 0;
    const x = s + PULL_MARGIN - (F - Math.min(0.25, this.approach * PULL_LEAD));
    const p = x <= -PULL_KNEE ? 0 : x >= PULL_KNEE ? x : ((x + PULL_KNEE) * (x + PULL_KNEE)) / (4 * PULL_KNEE);
    return Math.min(PULL_MAX, p);
  }

  /** Near-wall aim weight: the gaze ray's static hit (the rig's −Z from the eye) → this.gazeP; 0 when nothing is near. */
  private wantAim(): number {
    const g = this.gazeRay();
    if (!Number.isFinite(g)) return 0;
    const t = Math.min(1, Math.max(0, (g - AIM_NEAR) / (AIM_FAR - AIM_NEAR)));
    return 1 - t * t * (3 - 2 * t);
  }

  /** The rig's gaze ray (−Z from the eye) against the static world (+ closed leaves): its hit → this.gazeP (kept when
   *  nothing is hit); returns the distance (∞ = no hit within AIM_FAR + 0.1). */
  private gazeRay(): number {
    // the visible surface (door leaves' slabs, not their knob-padded blockers: FLASH part 2), else the sight probe
    const sight = TORCH_WORLD.surface ?? TORCH_WORLD.sight;
    if (!sight) return Infinity;
    const [eye, fwd] = this._w;
    this.parent.updateWorldMatrix(true, false);
    eye.setFromMatrixPosition(this.parent.matrixWorld);
    fwd.set(0, 0, -1).transformDirection(this.parent.matrixWorld);
    const g = sight(eye, fwd, AIM_FAR + 0.1);
    if (Number.isFinite(g)) {
      // a hop to another surface (GAZE_HOP) glides from where the target is now; with no aim to speak of, it snaps
      const raw = this._w[6].copy(eye).addScaledVector(fwd, g);
      if (this.aim < 0.05) this.gazeHop = 1;
      else if (Number.isFinite(this.gazeG) && raw.distanceTo(this.gazeRaw) > Math.max(0.25, 3 * eye.distanceTo(this.gazeEye))) {
        // a jump of the hit point itself — onto a nearer / farther surface, across an edge, or back onto a surface after
        // the gaze left it (a fast pan across balusters): sliding over one surface moves it ≤ 7 cm per 30 fps frame
        this.gazeFrom.copy(this.gazeP);
        this.gazeHop = 0;
        this.gazeHops++;
      }
      this.gazeRaw.copy(raw);
      this.gazeG = g;
      this.gazeEye.copy(eye);
    } else if (Number.isFinite(this.gazeG)) {
      // nothing near (open space, a far wall): the target rides along the gaze at the last hit's distance while the aim
      // fades — a world-fixed point left behind by a pan swung the decaying aim ever further off the view (verify pan2:
      // a 20 px one-frame lens jump at 45°/s as it passed the clamp)
      this.gazeRaw.copy(eye).addScaledVector(fwd, this.gazeG);
      this.gazeEye.copy(eye);
    }
    // the aim target: the hit itself, or on its way to it from the previous surface's point
    if (this.gazeHop >= 1) this.gazeP.copy(this.gazeRaw);
    else {
      const h = this.gazeHop;
      this.gazeP.copy(this.gazeFrom).lerp(this.gazeRaw, h * h * (3 - 2 * h));
    }
    return g;
  }

  /** The two-bone IK frame for a wrist drawn back by `pull` along the beam (`dirRig`): fills S (shoulder), T (unit
   *  shoulder→wrist), pole (the clip's bend direction ⊥ T) and side (T × pole, signed so +side lowers the elbow);
   *  returns [a, L, cosA, sinA]. Reads the CURRENT bone pose (the clip pose: call before the IK is applied). */
  private ikFrame(pull: number, dW: any, S: any, T: any, pole: any, side: any): [number, number, number, number] {
    const { up, fore, hand } = this.armL!;
    const E = this._w[1];
    const H = this._w[2];
    up.getWorldPosition(S);
    fore.getWorldPosition(E);
    hand.getWorldPosition(H);
    const a = S.distanceTo(E);
    const b = E.distanceTo(H);
    T.copy(H).addScaledVector(dW, -pull).sub(S);
    side.set(0, 1, 0).transformDirection(this.parent.matrixWorld);
    T.addScaledVector(side, pull * this.pullLift);
    const L = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, T.length()));
    T.normalize();
    pole.copy(E).sub(S);
    pole.addScaledVector(T, -pole.dot(T));
    if (pole.lengthSq() < 1e-8) pole.set(0, -1, 0).addScaledVector(T, T.y); // straight arm: bend down
    pole.normalize();
    side.copy(T).cross(pole);
    if (side.y > 0) side.negate();
    const cosA = Math.min(1, Math.max(-1, (a * a + L * L - b * b) / (2 * a * L)));
    return [a, L, cosA, Math.sqrt(1 - cosA * cosA)];
  }

  /** FLASH part 2 (fixer r2): the elbow's swing (rad) that keeps it ELBOW_MARGIN out of the walls (see ELBOW_MARGIN).
   *  Signed clearance c(φ) = wall distance along the shoulder→elbow ray − (a + margin), sampled every ELBOW_STEP; the
   *  target is the first zero crossing, linearly interpolated (no 15° quantisation). The margin grows with the elbow's
   *  approach speed (ELBOW_LEAD): strafing into a wall the fold starts early instead of catching up 6 cm per frame. */
  private wantFold(pull: number, dirRig: any, dt: number): number {
    const sight = TORCH_WORLD.sight;
    if (!sight || !this.armL) return 0;
    const [S, , , T, pole, dW, side, q] = this._w;
    this.parent.updateWorldMatrix(true, false);
    dW.copy(dirRig).transformDirection(this.parent.matrixWorld);
    const [a, , cosA, sinA] = this.ikFrame(pull, dW, S, T, pole, side);
    // the probe: shoulder → the elbow's OUTER sleeve surface (the elbow + m along its bend direction p(φ) — the side of
    // the elbow that meets a wall), so the margin holds across the arm even when the upper arm runs along the wall
    const clear = (phi: number, m: number): number => {
      const c = Math.cos(phi);
      const sn = Math.sin(phi);
      q.copy(T).multiplyScalar(a * cosA).addScaledVector(pole, (a * sinA + m) * c).addScaledVector(side, (a * sinA + m) * sn);
      const dist = q.length();
      const h = sight(S, q.divideScalar(dist), dist + ELBOW_LOOK);
      return Math.min(h, dist + ELBOW_LOOK) - dist;
    };
    // the clip elbow's approach speed toward what is beside it (smoothed; capped: a door swinging shut is not a speed)
    const c0raw = clear(0, ELBOW_MARGIN);
    if (dt > 0) {
      const v = Number.isFinite(this.elbowC) ? Math.min(4, Math.max(0, (this.elbowC - c0raw) / dt)) : 0;
      this.elbowV += (v - this.elbowV) * (1 - Math.exp(-dt / 0.1));
    }
    this.elbowC = c0raw;
    const m = ELBOW_MARGIN + Math.min(ELBOW_LOOK, this.elbowV * ELBOW_LEAD);
    let prev = c0raw - (m - ELBOW_MARGIN);
    if (prev >= 0) return 0;
    for (let phi = ELBOW_STEP; phi <= ELBOW_MAX + 1e-6; phi += ELBOW_STEP) {
      const c = clear(phi, m);
      if (c >= 0) return phi - ELBOW_STEP * (c / Math.max(1e-6, c - prev));
      prev = c;
    }
    return ELBOW_MAX;
  }

  /** Two-bone IK on the left arm: the hand (and the torch it holds) drawn back by `pull` m along the beam axis
   *  (`dirRig`, rig frame) and lifted PULL_LIFT × pull, the elbow folding in the clip pose's bend plane; the hand keeps
   *  its world orientation, turned by `aim` (0..1) of the rotation that points the beam at the gaze point. */
  private poseArm(pull: number, dirRig: any, aim: number): void {
    const { up, fore, hand } = this.armL!;
    this.ikSaved[0].copy(up.quaternion);
    this.ikSaved[1].copy(fore.quaternion);
    this.ikSaved[2].copy(hand.quaternion);
    this.ikApplied = true;
    const [S, E, H, T, pole, dW] = this._w;
    up.getWorldPosition(S);
    fore.getWorldPosition(E);
    hand.getWorldPosition(H);
    hand.getWorldQuaternion(this._qh);
    dW.copy(dirRig).transformDirection(this.parent.matrixWorld);
    // the aim rotation (world) R: the hand turns about the WRIST (the hand bone's origin), so it is solved for the
    // wrist, not the lens. FLASH part 2 (V1): it used to be solved from the lens (0.204 m ahead of the wrist) and then
    // applied about the wrist — the lens swung up-right by (R − I)(lens − wrist) and the beam passed 13–16 cm above-right
    // of the gaze point at 0.7 m (in game U3N/G3E/PD/U4T; offline scratch/flash-fixr1/walksim.ts: 14 cm), so the hot spot
    // hopped over what you look at. Now: the wrist lands at Hw = H − pull·dW (+ lift) and the beam LINE leaves it at the
    // clip's perpendicular offset ℓ⊥ (lens − H minus its component along the beam: 8.1 cm in arms.glb — the barrel lies
    // in the palm, not through the wrist). The turned line Hw + R(ℓ⊥ + t·dW) passes through the gaze point G iff
    // R(ℓ⊥ + t·dW) = g = G − Hw, and |ℓ⊥ + t·dW| = |g| fixes t = √(|g|² − |ℓ⊥|²) (forward): R is the shortest turn of
    // q* = ℓ⊥ + t·dW onto g — exact in one step (a fixed-point iteration left 4–5 cm looking down at a wall at 0.3 m).
    this._qr.identity();
    if (aim > 1e-3) {
      const Hw = this._w[6];
      const lp = this._w[7];
      Hw.copy(H).addScaledVector(dW, -pull);
      pole.set(0, 1, 0).transformDirection(this.parent.matrixWorld);
      Hw.addScaledVector(pole, pull * this.pullLift);
      this.beamBone.getWorldPosition(lp).sub(H);
      lp.addScaledVector(dW, -lp.dot(dW)); // ℓ⊥
      pole.copy(this.gazeP).sub(Hw); // g
      const g2 = pole.lengthSq();
      const l2 = lp.lengthSq();
      if (g2 > l2 + 1e-4) {
        T.copy(lp).addScaledVector(dW, Math.sqrt(g2 - l2)); // q*
        this._qr.setFromUnitVectors(T.normalize(), pole.normalize());
        const ang = 2 * Math.acos(Math.min(1, Math.abs(this._qr.w)));
        this._qr.copy(this._qi.identity().slerp(this._qr, (aim * Math.min(ang, this.aimMax)) / Math.max(1e-6, ang)));
      }
    }
    const a = S.distanceTo(E);
    const b = E.distanceTo(H);
    T.copy(H).addScaledVector(dW, -pull).sub(S); // shoulder → target
    pole.set(0, 1, 0).transformDirection(this.parent.matrixWorld);
    T.addScaledVector(pole, pull * this.pullLift);
    const L = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, T.length()));
    T.normalize(); // u
    pole.copy(E).sub(S);
    pole.addScaledVector(T, -pole.dot(T));
    if (pole.lengthSq() < 1e-8) pole.set(0, -1, 0).addScaledVector(T, T.y); // straight arm: bend down
    pole.normalize();
    if (this.fold > 1e-4) {
      // FLASH part 2 (fixer r2): the elbow swung down from a side wall (see ELBOW_MARGIN) — about u, toward −y
      const side = this._w[7].copy(T).cross(pole);
      if (side.y > 0) side.negate();
      pole.multiplyScalar(Math.cos(this.fold)).addScaledVector(side, Math.sin(this.fold)).normalize();
    }
    const cosA = Math.min(1, Math.max(-1, (a * a + L * L - b * b) / (2 * a * L)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    // new elbow E' = S + a(cos A u + sin A pole); new wrist T' = S + L u
    const ex = S.x + a * (cosA * T.x + sinA * pole.x);
    const ey = S.y + a * (cosA * T.y + sinA * pole.y);
    const ez = S.z + a * (cosA * T.z + sinA * pole.z);
    this.rotateTo(up, E.sub(S), pole.set(ex - S.x, ey - S.y, ez - S.z));
    up.updateMatrixWorld(true);
    fore.getWorldPosition(E);
    hand.getWorldPosition(H);
    // T' − E'
    pole.set(S.x + L * T.x - E.x, S.y + L * T.y - E.y, S.z + L * T.z - E.z);
    this.rotateTo(fore, H.sub(E), pole);
    fore.updateMatrixWorld(true);
    // the hand keeps its world orientation (turned by the aim): local = parentWorld⁻¹ · (aim · clip world)
    fore.getWorldQuaternion(this._qa);
    this._qh.premultiply(this._qr);
    hand.quaternion.copy(this._qa.invert().multiply(this._qh));
    hand.updateMatrixWorld(true);
  }

  /** Rotates `bone` in world space by the shortest arc taking direction `from` to `to` (both world, unnormalised). */
  private rotateTo(bone: any, from: any, to: any): void {
    this._qa.setFromUnitVectors(from.normalize(), to.normalize());
    bone.getWorldQuaternion(this._qb);
    this._qb.premultiply(this._qa); // new world orientation
    bone.parent.getWorldQuaternion(this._qa);
    bone.quaternion.copy(this._qa.invert().multiply(this._qb));
  }
}
