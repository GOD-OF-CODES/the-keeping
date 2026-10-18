// PERF round 2 (#150, ROADMAP ruling (aq)): per-character light cost. Every character material (Ada, Harlan, her
// props) shares ONE light list of ≈ 20 lights (torch + bounce, lightning directional + window spots, the yard
// headlights, the lamp's cube-shadowed light, 9 candle / lamp flicker lights, 3 probe grids), and three inlines a full
// evaluation per light (LightsNode.setupLights → lightingModel.direct per light; the skin / gown / strand-hair models
// add their own lobes per light). Fenced GPU ms at frozen C2 states (docs/STATUS-perf2.md S4, S7, S9): the cost follows
// the PROGRAM's light count (code size / registers), not the lights executed — removing the dark / out-of-reach lights
// from the list saved 7–9 ms of 18–23, skipping them with uniform branches only 0–3 ms.
//
// So, with a FIXED list (no LightsNode change, no program rebuild, ever):
//   • PointPoolNode — the list's plain point lights (unshadowed, map-less, no colour node: the 8 candle / lantern
//     flicker lights) are ONE loop over uniform arrays re-filled every frame with the pooled lights that can reach a
//     figure; the plain spot lights likewise (Medium: the torch bounce + 3 lightning window spots). One direct() copy
//     per pool instead of one per light: Medium C2 20.8 / 24.0 / 20.0 → 12.7 / 14.5 / 11.6 ms (C2 3 / 7.4 / 9.3, 0.8).
//   • GatedLightsNode — every other light (shadowed / cookie lights, the grids) sits in `if (gate > 0.5) { … }` on a
//     per-light renderGroup uniform (uniform control flow), open only while it can add something to a figure.
// Exactness: a pooled / gated light is left out only when it adds exactly 0 to every character pixel (dark, or its
// cutoff sphere / grid falloff box misses every subject sphere — char-light-select.ts); per light the pool evaluates
// exactly three's PointLightNode / SpotLightNode math. Shadow maps render as before (the shadow nodes are still built).
//
// TSL scoping: a light built inside an If body runs in an isolated node cache (ConditionalNode → isolate()), so
// expressions it shares with other lights are re-generated per branch; the shared fragment VARIABLES (VarNodes are
// global: positionViewDirection, normalView, normalWorld, clearcoatNormalView, the lighting context's accumulators and
// the lighting model's constants) are put on the lighting stack BEFORE the first branch / loop, so they are assigned
// once at top level and never first inside a branch that may be skipped. QA: `__game.story.charLights.force = true`
// opens every gate and pools every light (same program) for same-frame A/Bs; `.audit(scene)` = meshes outside the
// subject spheres; `?charpool=0` = gates only; `?charlights=0` = the plain shared list.

import * as THREE from 'three/webgpu';
import { If, Loop, Stack, cameraViewMatrix, clearcoatNormalView, getDistanceAttenuation, int, normalView, normalWorld, positionView, positionViewDirection, renderGroup, smoothstep, uniform, uniformArray, vec4 } from 'three/tsl';
import { gridReaches, reachOf, type LightCand, type Subject } from './char-light-select.ts';

/** LightsNode whose lights are each evaluated only while their gate uniform is open (> 0.5). */
export class GatedLightsNode extends (THREE as any).LightsNode {
  /** light → its gate uniform (lights without one are always evaluated). */
  readonly gates = new Map<any, any>();

  setupLights(builder: any, lightNodes: any[]): void {
    const self = this as any;
    // shared fragment variables first (see the header): assigned at top level, before any gated branch
    // (the lighting context's accumulators first of all: reflectedLight.directDiffuse … and radiance / irradiance —
    // left to the first light that touches them, `directDiffuse = vec3(0)` was emitted INSIDE each gated branch, so
    // every open branch wiped the lights before it)
    const ctx = builder.context;
    const lm = ctx.lightingModel;
    const shared: any[] = [];
    const addVars = (o: any) => {
      if (o) for (const v of Object.values(o)) if ((v as any)?.isVarNode === true && !shared.includes(v)) shared.push(v);
    };
    addVars(ctx.reflectedLight);
    addVars(ctx);
    shared.push(positionViewDirection, normalView, normalWorld);
    if (lm?.clearcoat === true) shared.push(clearcoatNormalView);
    addVars(lm);
    for (const v of shared) Stack(v);
    for (const ln of lightNodes) {
      const g = ln.light ? this.gates.get(ln.light) : undefined;
      if (!g) {
        ln.build(builder);
        continue;
      }
      If(g.greaterThan(0.5), () => {
        // the body is set up after LightsNode.setup returned (the stack is built later): the light's setup calls
        // builder.lightsNode.setupDirectLight(…) — point it back at this node for the duration
        const prev = builder.lightsNode;
        builder.lightsNode = self;
        ln.build(builder);
        builder.lightsNode = prev;
      });
    }
  }
}

/**
 * The unshadowed, map-less point lights of the list (the candle / lantern flicker lights) as ONE loop: `count` live
 * lights, packed every frame into uniform arrays (world position + cutoff, colour × intensity + decay) — one copy of the
 * lighting model's direct() in the program instead of one per light. The ablation (STATUS-perf2 S4) showed the cost
 * is the PROGRAM's light count, not only the lights executed (a gated branch skips the work but not the size); this
 * takes 8 BRDF copies out of every character program. Per light it is exactly three's PointLightNode
 * (directPointLight: lightVector = view position − positionView, getDistanceAttenuation, colour × attenuation; the view
 * position is cameraViewMatrix × world position, i.e. the render's own camera, as lightViewPosition()).
 */
export class PointPoolNode extends (THREE as any).LightingNode {
  readonly max: number;
  /** 'spot': the pooled lights are map-less unshadowed SpotLights (cone attenuation as SpotLightNode). */
  readonly spot: boolean;
  readonly count: any;
  readonly posCut: any;
  readonly colDecay: any;
  readonly dirCone: any;
  readonly penumbra: any;
  readonly posArr: any[];
  readonly colArr: any[];
  readonly dirArr: any[];
  readonly penArr: any[];

  constructor(max: number, spot = false) {
    super();
    this.max = max;
    this.spot = spot;
    const v4 = () => Array.from({ length: max }, () => new THREE.Vector4());
    this.posArr = v4();
    this.colArr = v4();
    this.dirArr = spot ? v4() : [];
    this.penArr = spot ? v4() : [];
    this.count = uniform(0, 'int').setGroup(renderGroup);
    this.posCut = uniformArray(this.posArr, 'vec4');
    this.colDecay = uniformArray(this.colArr, 'vec4');
    this.dirCone = spot ? uniformArray(this.dirArr, 'vec4') : null;
    this.penumbra = spot ? uniformArray(this.penArr, 'vec4') : null;
  }

  setup(builder: any): void {
    const { lightingModel, reflectedLight } = builder.context;
    if (!lightingModel) return;
    Loop({ start: int(0), end: this.count, type: 'int', condition: '<' }, ({ i }: { i: any }) => {
      const pc = this.posCut.element(i);
      const cd = this.colDecay.element(i);
      const lightVector = cameraViewMatrix.mul(vec4(pc.xyz, 1)).xyz.sub(positionView);
      const lightDirection = lightVector.normalize();
      const lightDistance = lightVector.length();
      const attenuation = getDistanceAttenuation({ lightDistance, cutoffDistance: pc.w, decayExponent: cd.w });
      let lightColor = cd.xyz;
      if (this.spot) {
        // SpotLightNode: angleCos = L · lightTargetDirection (view-space light − target, normalised);
        // smoothstep(cos(angle), cos(angle·(1 − penumbra)), angleCos)
        const dc = this.dirCone.element(i);
        const targetDir = cameraViewMatrix.mul(vec4(dc.xyz, 0)).xyz.normalize();
        const angleCos = lightDirection.dot(targetDir);
        lightColor = lightColor.mul(smoothstep(dc.w, this.penumbra.element(i).x, angleCos));
      }
      lightingModel.direct({ lightDirection, lightColor: lightColor.mul(attenuation), reflectedLight, lightNode: this }, builder);
    });
  }
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

type Kind = 'point' | 'spot' | 'dir' | 'grid';

/** Which lights can be gated, and how (null = always evaluated). */
function kindOf(l: any): Kind | null {
  if (l?.isLightProbeGrid) return 'grid';
  if (l?.isSpotLight) return 'spot'; // SpotLightNode's colour is the uniform colour × intensity even with a colorNode (cookie)
  if (l?.colorNode) return null; // a custom colour node may light at intensity 0: never gated
  if (l?.isPointLight) return 'point';
  if (l?.isDirectionalLight) return 'dir';
  return null;
}

export class CharacterLights {
  /** The gated LightsNode every character material uses. */
  readonly node: GatedLightsNode;
  /** Its light list (unchanged order). */
  readonly list: any[];
  /** Subject spheres (world) this frame — set by the caller before update() (bounds of every figure / held prop). */
  readonly subjects: Subject[] = [];
  /** QA A/B: every gate open (the pre-#150 shader work, same program). */
  force = false;
  /** QA: frames updated, gates open now, the most / fewest open seen. */
  readonly stats = { frames: 0, open: 0, gated: 0, maxOpen: 0, minOpen: Infinity };
  private readonly items: Array<{ l: any; kind: Kind; gate: any; c: LightCand }> = [];
  /** The pooled point / spot lights (one loop each in the program); empty with `pool: false`. */
  readonly pools: Array<{ node: PointPoolNode; lights: Array<{ l: any; c: LightCand }> }> = [];

  /**
   * `list`: the characters' lights. `pool` (default on): the unshadowed, map-less, colour-node-less point lights as one
   * loop, and the same kind of spot lights as another (a pool of one is left as a light).
   */
  constructor(list: any[], o: { pool?: boolean } = {}) {
    this.list = list;
    const plain = (l: any) => !l.castShadow && !l.map && !l.colorNode;
    const inPool = new Set<any>();
    if (o.pool !== false) {
      for (const spot of [false, true]) {
        const ls = list.filter((l) => plain(l) && (spot ? l?.isSpotLight === true : l?.isPointLight === true));
        if (ls.length < 2) continue;
        for (const l of ls) inPool.add(l);
        this.pools.push({ node: new PointPoolNode(ls.length, spot), lights: ls.map((l) => ({ l, c: { x: 0, y: 0, z: 0, intensity: 0, distance: 0, decay: 2 } })) });
      }
    }
    this.node = new GatedLightsNode();
    this.node.setLights([...list.filter((l) => !inPool.has(l)), ...this.pools.map((p) => p.node)]);
    for (const l of list) {
      if (inPool.has(l)) continue;
      const kind = kindOf(l);
      if (!kind) continue;
      // open until the first update; no custom name: a uniform name becomes a WGSL struct member (light names hold "-")
      const gate = uniform(1).setGroup(renderGroup);
      this.node.gates.set(l, gate);
      this.items.push({ l, kind, gate, c: { x: 0, y: 0, z: 0, intensity: 0, distance: 0, decay: 2 } });
    }
    this.stats.gated = this.items.length;
    // like the gates, the pools start with every light in them (renders before the first per-frame update)
    this.force = true;
    this.update();
    this.force = false;
    this.stats.frames = 0;
  }

  /** Opens the gates of the lights that can reach a subject. Call once per frame after every light has its value. */
  update(): void {
    const subs = this.subjects;
    let open = 0;
    for (const it of this.items) {
      const l = it.l;
      let on = true;
      if (!this.force) {
        const lum = (l.intensity ?? 0) * Math.max(l.color?.r ?? 1, l.color?.g ?? 1, l.color?.b ?? 1);
        if (it.kind === 'grid') on = !!l.boundingBox && gridReaches(l.boundingBox, l.falloff ?? 0, l.intensity ?? 0, subs);
        else if (it.kind === 'dir') on = lum > 0;
        else {
          l.updateWorldMatrix(true, false);
          _v.setFromMatrixPosition(l.matrixWorld);
          const c = it.c;
          c.x = _v.x;
          c.y = _v.y;
          c.z = _v.z;
          c.intensity = lum;
          c.distance = l.distance ?? 0;
          c.decay = l.decay ?? 2;
          on = reachOf(c, subs) > 0;
        }
      }
      it.gate.value = on ? 1 : 0;
      if (on) open++;
    }
    for (const pool of this.pools) {
      const P = pool.node;
      let n = 0;
      for (const p of pool.lights) {
        const l = p.l;
        l.updateWorldMatrix(true, false);
        _v.setFromMatrixPosition(l.matrixWorld);
        const c = p.c;
        c.x = _v.x;
        c.y = _v.y;
        c.z = _v.z;
        c.intensity = (l.intensity ?? 0) * Math.max(l.color.r, l.color.g, l.color.b);
        c.distance = l.distance ?? 0;
        c.decay = l.decay ?? 2;
        if (!this.force && !(reachOf(c, subs) > 0)) continue;
        P.posArr[n].set(c.x, c.y, c.z, c.distance);
        // = AnalyticLightNode.update: colour × intensity (linear)
        P.colArr[n].set(l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity, c.decay);
        if (P.spot) {
          // = lightTargetDirection: world light − target (normalised in the shader after the view transform);
          // SpotLightNode.update: coneCos = cos(angle), penumbraCos = cos(angle · (1 − penumbra))
          l.target.updateWorldMatrix(true, false);
          _w.setFromMatrixPosition(l.target.matrixWorld);
          P.dirArr[n].set(c.x - _w.x, c.y - _w.y, c.z - _w.z, Math.cos(l.angle));
          P.penArr[n].set(Math.cos(l.angle * (1 - l.penumbra)), 0, 0, 0);
        }
        n++;
      }
      P.count.value = n;
      open += n;
    }
    this.stats.frames++;
    this.stats.open = open;
    this.stats.maxOpen = Math.max(this.stats.maxOpen, open);
    this.stats.minOpen = Math.min(this.stats.minOpen, open);
  }

  /** QA: the gated lights open this frame (names). */
  openNames(): string[] {
    const names = this.items.filter((it) => it.gate.value > 0.5).map((it) => String(it.l.name || it.l.type));
    for (const pool of this.pools) {
      const n = pool.node.count.value;
      names.push(...pool.lights.filter((p) => this.force || reachOf(p.c, this.subjects) > 0).slice(0, n).map((p) => 'pool:' + String(p.l.name || p.l.type)));
    }
    return names;
  }

  /**
   * QA: meshes drawn with this list whose world bounding sphere is NOT inside a subject sphere (must be empty, else a
   * closed gate could darken them). `root` = the scene.
   */
  audit(root: any): string[] {
    const out: string[] = [];
    const sph = new THREE.Sphere();
    root.traverse((o: any) => {
      if (!o.isMesh || !o.visible) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (!mats.some((m: any) => m?.lightsNode === this.node)) return;
      for (let p = o; p; p = p.parent) if (!p.visible) return;
      if (o.isSkinnedMesh) {
        const keep = o.boundingSphere ? o.boundingSphere.clone() : null; // three's frustum test reads it: restore
        o.computeBoundingSphere(); // r186 SkinnedMesh: the POSED vertices (applyBoneTransform), object space
        sph.copy(o.boundingSphere).applyMatrix4(o.matrixWorld);
        if (keep) o.boundingSphere.copy(keep);
        else o.boundingSphere = null;
      } else {
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        sph.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);
      }
      const inside = this.subjects.some((s) => Math.hypot(sph.center.x - s.x, sph.center.y - s.y, sph.center.z - s.z) + sph.radius <= s.r);
      if (!inside) out.push(`${o.name || o.type}@${sph.center.x.toFixed(2)},${sph.center.y.toFixed(2)},${sph.center.z.toFixed(2)} r${sph.radius.toFixed(2)}`);
    });
    return out;
  }
}

/** Bounding sphere (world) of a bone list + `margin` m (flesh, cloth, a hand-held prop beyond the bones). */
export function boneSphere(bones: Iterable<any>, margin: number, out: Subject): Subject | null {
  let n = 0;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  const pts: number[] = [];
  for (const b of bones) {
    _w.setFromMatrixPosition(b.matrixWorld);
    pts.push(_w.x, _w.y, _w.z);
    x0 = Math.min(x0, _w.x);
    y0 = Math.min(y0, _w.y);
    z0 = Math.min(z0, _w.z);
    x1 = Math.max(x1, _w.x);
    y1 = Math.max(y1, _w.y);
    z1 = Math.max(z1, _w.z);
    n++;
  }
  if (!n) return null;
  out.x = (x0 + x1) / 2;
  out.y = (y0 + y1) / 2;
  out.z = (z0 + z1) / 2;
  let r2 = 0;
  for (let i = 0; i < pts.length; i += 3) r2 = Math.max(r2, (pts[i] - out.x) ** 2 + (pts[i + 1] - out.y) ** 2 + (pts[i + 2] - out.z) ** 2);
  out.r = Math.sqrt(r2) + margin;
  return out;
}
