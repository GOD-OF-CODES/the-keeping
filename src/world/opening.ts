// The opening drive's world side (docs/C1-OPENING.md §7.1–7.4, §7.7–7.8), driven through cutscene `fx` cues:
//   car_mount {on, pov}    mount the detailed sedan_interior v2 (P_CAR_INTERIOR, built in car space) inside the moving
//                          gate sedan (P_CAR_GATE) at identity car space: hide the sedan's `-cabin_lo`, hide the
//                          interior's own windscreen + wipers (the exterior sedan's glass, rain layer and blades are
//                          the visible ones), show `-driver_proxy` only in exterior shots (pov false). Off = restore.
//   dome {on}              L_DOME (211-2 festoon, 38 cd, 2800 K): 80 ms filament warm-up on, 150 ms orange tail off;
//                          the lens glows with it
//   hibeam {on}            the high-beam lobe of our lamps (headlamps.ts uHibeam)
//   stall {k}              low beams sag to 2600 K (k 0..1; the ×0.35 is the cue's light scale)
//   exposure {hold, biasEV, min, max, meterLow, tauDarken, reset}  per-shot eye-adaptation settings (§5.2); undone
//                          automatically when no cutscene holds the camera
// Plus, every frame: L_CAB_VEIL (rain backscatter in our beams lighting the cabin, ≈ 1 cd) follows headlights × rain ×
// windscreen film; cabin materials get a LightsNode that sees the exterior lights AND the CAR-set lights.

import * as THREE from 'three/webgpu';
import { lights, uniform, vec3 } from 'three/tsl';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Level } from './level.ts';
import { installHeadlamps, uHibeam, HEADLAMP_SHADOW_LAYER, type Headlamps } from '../render/headlamps.ts';
import { kelvinToLinearRGB } from './lights.ts';
import { LOOK } from '../render/look.ts';
import { EXPOSURE_CUE, requestExposureSnap } from '../render/exposure.ts';
import { specById } from '../materials/spec-index.ts';
import { roadFrame, roadPoint } from '../cutscenes/road.ts';
import { chainageOf } from './corridor.ts';
import { planToWorld } from '../shared/coords.ts';
import { createCorridorCuller } from './corridor.ts';
import { createBeamRain } from './beam-rain.ts';
import { createGlimpses } from './glimpses.ts';
import { createRoadGlints } from './road-glints.ts';

type Params = Record<string, number | string | boolean>;

export interface OpeningDeps {
  level: Level;
  presetId: 'low' | 'medium' | 'max';
  camera: any;
  preset: any;
  cameraHeld: () => boolean;
  /** Choose which car's windscreen rain layer + blades are live ('P_CAR_INTERIOR' set or 'P_CAR_GATE'). */
  setRainCar: (id: string) => void;
  /** Rain film on the live glass 0..1 (for the cab veil). */
  glassWet: () => number;
  /** The storm-night opening (C0/C1), not C6/C7's blue hour. */
  night?: () => boolean;
}

const LOOK_KEYS = ['biasEV', 'meterLow', 'tauDarken', 'tauBrighten'] as const;

export function createOpening(d: OpeningDeps) {
  const { level } = d;
  const corridor = createCorridorCuller(level.root);
  const lamps: Headlamps = installHeadlamps((id) => level.runtimeLight(id), d.preset, kelvinToLinearRGB);
  const interior = level.prop('P_CAR_INTERIOR');
  const gate = level.prop('P_CAR_GATE');
  const dome = level.runtimeLight('L_DOME');
  const veil = level.runtimeLight('L_CAB_VEIL');
  const dash = level.runtimeLight('L_DASH');
  if (dash) dash.color.setRGB(0.3, 0.86, 0.66); // cluster backlight: green-aqua (§5.1)
  if (dome) {
    dome.distance = 3;
    if (d.presetId !== 'low') {
      dome.castShadow = true;
      dome.shadow.mapSize.set(512, 512);
      dome.shadow.bias = -0.0005;
      dome.shadow.camera.near = 0.05;
      dome.shadow.camera.far = 3;
    }
  }
  if (veil) {
    veil.distance = 4;
    // no shadow: §5.1 asks for one (256²) so the dash shades the footwells, but each shadowed runtime light costs a
    // sampler in every probe-lit material and Max hit the 16-sampler limit (look 6). The veil is ≈ 0.2 lux.
    veil.castShadow = false;
  }

  // what casts into the lamps' shadow maps: the road set, the gate (posts, sign, fence) and the vehicles
  for (const g of [level.roomGroups.get('RC9'), level.roomGroups.get('EXT1'), gate, interior, level.prop('P_RC9_TRUCK')]) {
    g?.traverse((o: any) => {
      if (o.isMesh) o.layers.enable(HEADLAMP_SHADOW_LAYER);
    });
  }
  const shadowLights = [...lamps.lights, dome, veil].filter((l) => l?.castShadow);
  for (const l of shadowLights) {
    l.shadow.autoUpdate = false; // gated per frame in update(); one render so each map is initialised
    l.shadow.needsUpdate = true;
  }

  // ---- cabin materials: own LightsNode (exterior lights + CAR-set lights), rim override, hideable glass
  const findName = (root: any, suffix: string): any[] => {
    const out: any[] = [];
    root?.traverse((n: any) => {
      if (typeof n.name === 'string' && n.name.endsWith(suffix)) out.push(n);
    });
    return out;
  };
  const carLights = [dome, veil, dash].filter(Boolean);
  const extLights: any[] = level.exteriorLights?.length ? level.exteriorLights : level.probeLights ?? [];
  // AD review (C1 34.4 near-black): L_TRUCK_HI_L/R live in RC9, not in extLights — the oncoming 35 kcd high beams
  // never lit the cabin (no front-lit dash/gloves at the dazzle). They join the cabin list (intensity 0 off-cue).
  const truckLights = ['L_TRUCK_HI_L', 'L_TRUCK_HI_R'].map((id) => level.runtimeLight(id)).filter(Boolean);
  const cabinNode = lights([...extLights, ...[...carLights, ...truckLights].filter((l) => !extLights.includes(l))]);
  const interiorGlass: any[] = [];
  const clones = new Map<any, any>();
  const rimSpec = specById('plastic_wheel_tan');
  const steering = findName(interior, '-steering')[0] ?? null;
  // AD review (open-review d1): the cluster lens drew a jagged cyan zig-zag across the dials (hiding the lens removes it).
  const lensMeshes = new Set(findName(interior, '-cluster_lens').flatMap((r: any) => {
    const out: any[] = [];
    r.traverse((x: any) => x.isMesh && out.push(x));
    return out;
  }));
  const SMOOTH_IDS = new Set(['car_interior_tan', 'vinyl_dash_black', 'carpet_auto', 'headliner_cloth']);
  interior?.traverse((n: any) => {
    if (!n.isMesh) return;
    if (lensMeshes.has(n)) {
      // r2 (m2 13.5 s): with flat normals and no L_DASH the artifact became a straight cyan band — the lit glass
      // itself is the problem, so the lens is an unlit faint smoky film (a 1980s acrylic lens ≈ 8 % grey, its
      // reflections at this distance are below the dial luminance). Also keeps it out of the cabin LightsNode.
      const m0 = Array.isArray(n.material) ? n.material[0] : n.material;
      const c = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
      c.colorNode = vec3(0, 0, 0); // m3: any emitted value lifted the black dial face to slate at the macro exposure
      c.opacity = 0.12;
      c.userData = { ...(m0?.userData ?? {}) };
      n.material = c;
      return;
    }
    const mats = Array.isArray(n.material) ? n.material : [n.material];
    // AD review (d5 A/B: facets stay with normalNode off → the export's flat normals): the moulded door cards, kick
    // panels, crash pad and seats were drawn as hard facets. Rebuild their normals smooth inside a 50° crease (m5: 35° left the door card faceted) (real
    // trim edges keep their hard break). Once, at load; vertex count grows (non-indexed) on ≈ 10 small meshes.
    if (!n.geometry.userData.creased && mats.some((m: any) => SMOOTH_IDS.has(m?.userData?.material_id))) {
      const g0 = n.geometry;
      const g = toCreasedNormals(g0, 50 * (Math.PI / 180));
      g.userData.creased = true;
      if (g !== g0) {
        n.geometry = g;
        g0.dispose();
      }
    }
    const out = mats.map((m: any) => {
      if (!m) return m;
      const id = m.userData?.material_id;
      if (id === 'glass_rain') {
        interiorGlass.push(n);
        return m;
      }
      if (m.lightMap || m.lmBase) return m; // lightmapped (LM_CAR seats): keep the atlas node (CAR lights in it)
      let inRim = false;
      for (let p = n; p; p = p.parent) if (p === steering) inRim = true;
      const key = inRim && id === 'car_interior_tan' ? `rim:${m.uuid}` : m;
      let c = clones.get(key);
      if (!c) {
        c = m.clone();
        c.userData = { ...m.userData };
        if (inRim && id === 'car_interior_tan' && rimSpec) {
          // AD review: no vinyl crazing on the rim — hand-polished tan plastic (plastic_wheel_tan, constant)
          const a = rimSpec.avgAlbedo as number[];
          c.colorNode = vec3(a[0], a[1], a[2]);
          c.roughnessNode = null;
          c.roughness = rimSpec.roughness;
          c.normalNode = null;
          c.userData.material_id = 'plastic_wheel_tan';
        }
        c.lightsNode = cabinNode;
        clones.set(key, c);
      }
      return c;
    });
    n.material = Array.isArray(n.material) ? out : out[0];
  });

  // ---- dome lens glow
  const uDomeGlow = uniform(0);
  for (const n of findName(interior, '-dome_lamp')) {
    n.traverse((mesh: any) => {
      if (!mesh.isMesh) return;
      const m = new THREE.MeshBasicNodeMaterial();
      // yellowed lens over a 12 cp festoon: ≈ 38 cd over ≈ 0.012 m² → ~3000 cd/m² (blooms, never a disc)
      m.colorNode = vec3(1.0, 0.62, 0.3).mul(uDomeGlow.mul(3000).add(0.02));
      mesh.material = m;
      mesh.castShadow = false; // L_DOME sits inside its own lens: the lens must not shadow the cabin
    });
  }

  // ---- rain lit by our beams (rides the interior = car space)
  const beamRain = createBeamRain(d.presetId === 'low' ? 1500 : d.presetId === 'max' ? 5000 : 3000);
  interior?.add(beamRain.mesh);
  let warm = true;
  let lastGatePos: any = null;

  // ---- warning lamps (sedan_interior v2 `-lamp_<warn>` nodes): physical luminance behind a small lens (§5.1):
  //      fuel/SES amber 80 cd/m², HI BEAM blue 40, BATT/OIL/BRAKE red 60, turn green 50
  const WARN_L: Record<string, number> = { fuel: 80, ses: 80, hibeam: 40, batt: 60, oil: 60, brake: 60, belts: 60, turn_l: 50, turn_r: 50 };
  const warnU = new Map<string, any>();
  interior?.traverse((n: any) => {
    const w = n.userData?.warn;
    if (!w || n.userData?.lamp !== 'warn') return;
    const u = warnU.get(w) ?? uniform(0);
    warnU.set(w, u);
    const ec = n.userData.emissive_color ?? [1, 0.45, 0.02];
    n.traverse((mesh: any) => {
      if (!mesh.isMesh) return;
      const m = new THREE.MeshBasicNodeMaterial();
      m.colorNode = vec3(ec[0], ec[1], ec[2]).mul(u.mul(WARN_L[w] ?? 60).add(0.004));
      mesh.material = m;
    });
  });

  // ---- v2 3-D needles: turn about their local axis from the exported rest pose (extras zero_deg, deg_per_unit,
  //      rest_deg; "positive = clockwise seen from the driver"); lit orange-red 8 cd/m² while the engine runs
  const uNeedle = uniform(0);
  const needles: Array<{ node: any; rest: any; axis: any; zero: number; per: number; restDeg: number; gauge: string }> = [];
  interior?.traverse((n: any) => {
    const u = n.userData ?? {};
    if (u.part !== 'needle') return;
    // extras axes are Blender-local (Z up); the glTF exporter maps (x, y, z) → (x, z, −y) (look 6: about the raw
    // [0, 0, 1] the needle spun about its own length and stayed at 0 mph)
    const ax = u.rotate_axis ?? [0, 0, 1];
    needles.push({ node: n, rest: n.quaternion.clone(), axis: new THREE.Vector3(ax[0], ax[2], -ax[1]).normalize(), zero: Number(u.zero_deg ?? 0), per: Number(u.deg_per_unit ?? 1), restDeg: Number(u.rest_deg ?? u.zero_deg ?? 0), gauge: String(u.gauge ?? '') });
    const ec = u.emissive_color ?? [0.95, 0.35, 0.12];
    n.traverse((mesh: any) => {
      if (!mesh.isMesh) return;
      const m = new THREE.MeshBasicNodeMaterial();
      m.colorNode = vec3(ec[0], ec[1], ec[2]).mul(uNeedle.mul(8).add(0.03));
      mesh.material = m;
    });
  });
  const gauges = { mph: 0, fuel: -0.02, temp: 0.45, on: false };
  const _q = new THREE.Quaternion();
  const turnNeedles = () => {
    for (const nd of needles) {
      const v = nd.gauge === 'speedo' ? gauges.mph * (gauges.on ? 1 : 0) : nd.gauge === 'fuel' ? gauges.fuel : gauges.on ? gauges.temp : 0;
      const deg = nd.zero + nd.per * v;
      nd.node.quaternion.copy(nd.rest).multiply(_q.setFromAxisAngle(nd.axis, -THREE.MathUtils.degToRad(deg - nd.restDeg)));
    }
    uNeedle.value = gauges.on ? 1 : 0;
  };
  turnNeedles();

  // ---- mount
  let mounted = false;
  let saved: { parent: any; pos: any; quat: any; scale: any } | null = null;
  const cabinLo = findName(gate, '-cabin_lo');
  // a driver never sees his own lamp lenses: from the POV eye the emissive `-headlights` boxes poke over the hood line
  const headLenses = findName(gate, '-headlights');
  const proxy = findName(gate, '-driver_proxy');
  const interiorWipers = [...findName(interior, '-wiper_d'), ...findName(interior, '-wiper_p')];
  for (const p of proxy) p.visible = false; // never at the gate in play (the player IS the driver)
  // runtime lane D (C1 60.5 / 61.8 over the Medium 400-draw budget: P_CAR_GATE 107 draws, most of them the mounted
  // interior's dash/console detail): in an exterior shot seen from > CAB_DETAIL_M the cluster, needles, warning lamps,
  // radio, cassettes, receipts… are sub-5-px specks behind rain-wet glass — hide them (seats, wheel, mirror, visors and
  // the shell stay for the silhouette through the glass). POV / close exterior (C0 26–29 push-in) keep everything.
  const CAB_DETAIL_M = 6;
  const CAB_KEEP = /-(seat_front|seat_rear|steering|mirror|visor_d|visor_p|shell_details|armrest|dome_lamp|wiper_d|wiper_p)$/;
  const cabDetail: any[] = [];
  interior?.traverse((o: any) => { if (o !== interior && o.isMesh && /sedan_interior-/.test(o.name) && !CAB_KEEP.test(o.name)) cabDetail.push(o); });
  let povNow = true;
  let cabDetailHidden = false;
  const _cabP = new THREE.Vector3();
  const mount = (on: boolean, pov: boolean) => {
    if (!interior || !gate) return;
    if (on && !mounted) {
      saved = { parent: interior.parent, pos: interior.position.clone(), quat: interior.quaternion.clone(), scale: interior.scale.clone() };
      gate.add(interior);
      interior.position.set(0, 0, 0);
      // the sedan is built nose −y PLAN (local +Z), the interior nose +y PLAN (local −Z): yaw π about local up
      interior.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
      interior.scale.set(1, 1, 1);
      interior.visible = true;
      for (const n of cabinLo) n.visible = false;
      for (const n of interiorGlass) n.visible = false;
      for (const n of interiorWipers) n.visible = false;
      d.setRainCar('P_CAR_GATE');
      mounted = true;
    } else if (!on && mounted && saved) {
      saved.parent.add(interior);
      interior.position.copy(saved.pos);
      interior.quaternion.copy(saved.quat);
      interior.scale.copy(saved.scale);
      for (const n of cabinLo) n.visible = true;
      for (const n of interiorGlass) n.visible = true;
      for (const n of interiorWipers) n.visible = true;
      d.setRainCar('P_CAR_INTERIOR');
      mounted = false;
      saved = null;
    }
    povNow = !on || pov;
    for (const p of proxy) p.visible = on && !pov;
    for (const n of headLenses) n.visible = !(on && pov);
    interior.updateMatrixWorld(true);
  };

  // ---- dome ramp
  let domeOn = false;
  let domeK = 0;
  const c2800 = new THREE.Color(...kelvinToLinearRGB(2800));
  const c2000 = new THREE.Color(...kelvinToLinearRGB(2000));
  const domeBase = dome?.userData.csBase ?? 38;

  // ---- exposure cue (restored when the camera is released)
  let lookSaved: Record<string, number> | null = null;
  const exposure = (p: Params) => {
    if (p.reset) {
      resetExposure();
      return;
    }
    if (!lookSaved) {
      lookSaved = {};
      for (const k of LOOK_KEYS) lookSaved[k] = (LOOK as any)[k];
    }
    for (const k of LOOK_KEYS) (LOOK as any)[k] = p[k] !== undefined ? Number(p[k]) : lookSaved[k];
    EXPOSURE_CUE.hold = p.hold === true;
    EXPOSURE_CUE.min = p.min !== undefined ? Number(p.min) : null;
    EXPOSURE_CUE.max = p.max !== undefined ? Number(p.max) : null;
    if (p.snap === true) requestExposureSnap();
  };
  const resetExposure = () => {
    if (lookSaved) for (const k of LOOK_KEYS) (LOOK as any)[k] = lookSaved[k];
    lookSaved = null;
    EXPOSURE_CUE.hold = false;
    EXPOSURE_CUE.min = null;
    EXPOSURE_CUE.max = null;
  };

  // ---- the logging truck (S5): eastbound along the road at constant speed, wheels turning
  const truck = level.prop('P_RC9_TRUCK');
  const truckAxles = findName(truck, '-axle_1').concat(findName(truck, '-axle_2'), findName(truck, '-axle_3'), findName(truck, '-axle_4'), findName(truck, '-axle_5'));
  // its lamps (emissive lenses on the glass_grimy slots): high beams ≈ 35 kcd over ≈ 0.03 m² is ~1e6 cd/m² — the frame
  // clips long before that, so 8e3 carries the bloom (2e4 milked the whole frame, look 6); clearance/markers amber ≈ 400 cd/m² (§5.1), tails red 150
  const uTruckLamps = uniform(0);
  const TRUCK_L: Record<string, number> = { head: 8e3, clearance: 400, marker: 400, tail: 150 };
  truck?.traverse((n: any) => {
    const lamp = n.userData?.lamp;
    if (!lamp || !(lamp in TRUCK_L)) return;
    const ec = lamp === 'tail' ? [1, 0.13, 0.035] : (n.userData.emissive_color ?? [1, 0.9, 0.72]);
    n.traverse((mesh: any) => {
      if (!mesh.isMesh || mesh.material?.userData?.material_id !== 'glass_grimy') return;
      const m = new THREE.MeshBasicNodeMaterial();
      m.colorNode = vec3(ec[0], ec[1], ec[2]).mul(uTruckLamps.mul(TRUCK_L[lamp]).add(0.01));
      mesh.material = m;
    });
  });
  // runtime lane D: the truck's high beams streak on the wet road toward us (road-glints.ts). Lens centres in truck
  // space (bbox of each 'head' lamp node), its beam axis = truck forward (from the truck centre to the lamps).
  const glints = createRoadGlints(level.root, () => 0); // RC9 road surface: PLAN z 0 (roadPoint) = world y 0
  if (truck) {
    truck.updateMatrixWorld(true);
    const inv = truck.matrixWorld.clone().invert();
    const heads: any[] = [];
    truck.traverse((n: any) => {
      if (n.userData?.lamp === 'head') heads.push(new THREE.Box3().setFromObject(n).getCenter(new THREE.Vector3()).applyMatrix4(inv));
    });
    const tc = new THREE.Box3().setFromObject(truck).getCenter(new THREE.Vector3()).applyMatrix4(inv);
    const avg = heads.reduce((a, h) => a.add(h), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, heads.length));
    const fwdLocal = new THREE.Vector3(avg.x - tc.x, 0, avg.z - tc.z).normalize();
    const hiRGB = kelvinToLinearRGB(3300);
    for (const h of heads.slice(0, 2)) {
      const pos = new THREE.Vector3();
      const dir = new THREE.Vector3();
      glints.add({
        pos,
        dir,
        color: hiRGB,
        beamSigma: 0.09, // halogen high beam: ≈ ±5° to half peak
        cd: () => {
          if (uTruckLamps.value <= 0) return 0;
          pos.copy(h).applyMatrix4(truck.matrixWorld);
          dir.copy(fwdLocal).transformDirection(truck.matrixWorld);
          return 35000 * uTruckLamps.value; // L_TRUCK_HI_L/R axial 35 kcd (layout)
        },
      });
    }
  }
  let truckRun: { t: number; s0: number; s1: number; d: number; n: number } | null = null;
  let truckSaved: { pos: any; rotY: number } | null = null;
  let warmSaved: { pos: any; quat: any; vis: boolean } | null = null;
  let warmCulled: any[] | null = null;
  const truckAt = (s: number, n: number) => {
    if (!truck) return;
    const p = roadPoint(s, n);
    const w = planToWorld(p);
    truckSaved ??= { pos: truck.position.clone(), rotY: truck.rotation.y };
    truck.position.set(w[0], truckSaved.pos.y + w[1], w[2]);
    truck.rotation.y = roadFrame(s)[2] + Math.PI / 2; // props face −y at yaw 0: yaw = heading + π/2
    truck.updateMatrixWorld(true);
  };
  const truckStop = () => {
    truckRun = null;
    if (truck && truckSaved) {
      truck.position.copy(truckSaved.pos);
      truck.rotation.y = truckSaved.rotY;
      truck.updateMatrixWorld(true);
    }
    truckSaved = null;
    uTruckLamps.value = 0;
    for (const id of ['L_TRUCK_HI_L', 'L_TRUCK_HI_R']) {
      const l = level.runtimeLight(id);
      if (l) l.intensity = 0;
    }
  };

  // builder 2: C0 look, camera range, billboard, deer, signs (glimpses.ts)
  const glimpses = createGlimpses({ level, camera: d.camera, cameraHeld: d.cameraHeld, mounted: () => mounted, car: gate, presetId: d.presetId, night: d.night });

  const fx = (id: string, p: Params): boolean => {
    switch (id) {
      case 'car_mount':
        mount(!!p.on, p.pov !== false);
        return true;
      case 'dome':
        domeOn = !!p.on;
        return true;
      case 'hibeam':
        uHibeam.value = p.on ? 1 : 0;
        return true;
      case 'stall':
        lamps.setStall(Number(p.k ?? 1));
        return true;
      case 'exposure':
        exposure(p);
        return true;
      case 'truck':
        if (p.on) {
          truckRun = { t: 0, s0: Number(p.s0 ?? 316), s1: Number(p.s1 ?? 651), d: Number(p.d ?? 13.4), n: Number(p.n ?? -1.75) };
          truckAt(truckRun.s0, truckRun.n);
        } else truckStop();
        return true;
      default:
        return glimpses.fx(id, p);
    }
  };

  const update = (dt: number) => {
    glimpses.update(dt);
    // dome: a festoon filament heats in ≈ 80 ms and cools in ≈ 150 ms (orange as it fades)
    const tau = domeOn ? 0.035 : 0.06;
    domeK += ((domeOn ? 1 : 0) - domeK) * (1 - Math.exp(-dt / tau));
    if (domeK < 1e-3 && !domeOn) domeK = 0;
    if (dome) {
      dome.intensity = domeBase * domeK * domeK;
      dome.color.copy(c2000).lerp(c2800, Math.min(1, domeK * 1.3));
    }
    uDomeGlow.value = domeK * domeK;
    // cab veil: our beams' rain backscatter, brighter as the film builds between strokes
    const hl = level.runtimeLight('L_HEADLIGHT_L');
    const hk = hl ? Math.min(1.5, hl.intensity / Math.max(1, hl.userData.csBase ?? 1)) : 0;
    // lit rain: on with our beams while the interior rides the car; speed from the car's motion
    if (gate) {
      const gp = gate.position;
      if (lastGatePos && dt > 0) {
        const v = Math.hypot(gp.x - lastGatePos.x, gp.z - lastGatePos.z) / dt;
        if (v < 60) beamRain.uSpeed.value += (v - beamRain.uSpeed.value) * Math.min(1, dt * 4);
      }
      (lastGatePos ??= gp.clone()).copy(gp);
    }
    beamRain.uOn.value = mounted ? hk : 0;
    beamRain.mesh.visible = warm || (mounted && hk > 0.01);
    if (veil) veil.intensity = mounted ? (veil.userData.csBase ?? 1) * hk * (0.7 + 0.3 * d.glassWet()) : 0;
    corridor.update(d.camera, d.cameraHeld());
    if (gate && cabDetail.length) {
      const hide = mounted && !povNow && d.camera.position.distanceTo(gate.getWorldPosition(_cabP)) > CAB_DETAIL_M;
      if (hide !== cabDetailHidden) {
        cabDetailHidden = hide;
        // restore only what this hid (another cue may own a part's visibility, e.g. the folded / open road map)
        for (const o of cabDetail) {
          if (hide) { o.userData.cabWasVisible = o.visible; o.visible = false; } else if (o.userData.cabWasVisible !== undefined) { o.visible = o.userData.cabWasVisible; delete o.userData.cabWasVisible; }
        }
      }
    }
    // shadow passes only while a lamp actually shines (castShadow stays on, so no shader variant changes): a dark
    // shadow-casting light still re-renders the scene into its map every frame (look 4: +600 draws at the gate)
    for (const l of shadowLights) {
      const on = l.intensity > 1e-4 && l.visible !== false;
      if (l.shadow.autoUpdate !== on) {
        l.shadow.autoUpdate = on;
        if (on) l.shadow.needsUpdate = true;
      }
    }
    if (truckRun) {
      truckRun.t += dt;
      const u = Math.min(1, truckRun.t / Math.max(0.01, truckRun.d));
      truckAt(truckRun.s0 + (truckRun.s1 - truckRun.s0) * u, truckRun.n);
      const v = (truckRun.s1 - truckRun.s0) / truckRun.d; // 25 m/s
      for (const a of truckAxles) a.rotateX((v / 0.52) * dt);
      uTruckLamps.value = 1;
      for (const id of ['L_TRUCK_HI_L', 'L_TRUCK_HI_R']) {
        const l = level.runtimeLight(id);
        if (l) l.intensity = l.userData.csBase ?? 35000;
      }
    }
    glints.update(d.camera); // after the truck moved (road-glints.ts)
    if (!d.cameraHeld()) {
      if (truckRun || truckSaved) truckStop();
      if (lookSaved || EXPOSURE_CUE.hold || EXPOSURE_CUE.min !== null) resetExposure();
      if (mounted) mount(false, true);
      if (uHibeam.value) uHibeam.value = 0;
      domeOn = false;
    }
  };

  return {
    fx,
    update,
    /** Cluster state → the v2 needles (mph, fuel 0..1, may sit below E). */
    setGauges(g: { mph: number; fuel: number; on: boolean }) {
      gauges.mph = g.mph;
      gauges.fuel = g.fuel;
      gauges.on = g.on;
      turnNeedles();
    },
    /** Warning lamps on/off (dash fx: fuel with the low-fuel lamp; BATT + OIL after the stall). */
    setWarn(st: Record<string, boolean>) {
      for (const [k, on] of Object.entries(st)) {
        const u = warnU.get(k);
        if (u) u.value = on ? 1 : 0;
      }
    },
    /**
     * Load warm-up (AD review, scratch/open-review/st2.log): C0 compiled ≈ 50 programs mid-cinematic (0.2–9 s hitches at
     * 14–23 s) — the mounted interior's cabin materials, the truck, and ground-level road dressing never drew in the
     * aerial `rc9` step. on: mount the interior in our sedan and park it + the truck on the road at chainage s, where
     * the warm-up camera looks; off: put everything back.
     */
    warmRoad(on: boolean, s?: number) {
      if (!gate) return null;
      if (on) {
        if (s === undefined) {
          // default: abreast of the billboard (C0 shot 3), where the diner, ditch and road dressing are
          const b = level.prop('P_RC9_BILLBOARD');
          const bw = b ? b.getWorldPosition(new THREE.Vector3()) : null;
          s = bw ? chainageOf(bw.x, -bw.z).s : 500;
        }
        warmSaved ??= { pos: gate.position.clone(), quat: gate.quaternion.clone(), vis: gate.visible };
        mount(true, false);
        const w = planToWorld(roadPoint(s, -1.75));
        gate.position.set(w[0], warmSaved.pos.y + w[1], w[2]);
        gate.rotation.set(0, roadFrame(s)[2] + Math.PI / 2, 0);
        gate.visible = true;
        gate.updateMatrixWorld(true);
        truckAt(s + 14, 1.75);
        // runtime lane D: the lamps are dark at load, so update() leaves their shadow maps off and the road set's
        // shadow-pass programs (HEADLAMP_SHADOW_LAYER) first built mid-C0. Render every lamp map during this step.
        for (const l of shadowLights) {
          l.shadow.autoUpdate = true;
          l.shadow.needsUpdate = true;
        }
        // runtime lane D (fz4.mjs: C0 cuts 12.5 / 19.0 / 22.0 stalled 1.3 / 1.3 / ≈ 2 s in NodeManager.getForRender):
        // r186 keys every InstancedMesh's render object by its uuid, so each corridor chunk is node-built the first
        // time it is drawn — at the cut that first frames it. Draw every instanced mesh in this warm step (frustum
        // culling off, the culler leaves all chunks visible while no cutscene holds the camera), then restore.
        warmCulled = [];
        level.root?.traverse((o: any) => {
          if (o.isInstancedMesh && o.frustumCulled) {
            o.frustumCulled = false;
            warmCulled!.push(o);
          }
        });
        return planToWorld(roadPoint(s - 9, -4, 2.2));
      }
      for (const o of warmCulled ?? []) o.frustumCulled = true;
      warmCulled = null;
      truckStop();
      mount(false, false);
      if (warmSaved) {
        gate.position.copy(warmSaved.pos);
        gate.quaternion.copy(warmSaved.quat);
        gate.visible = warmSaved.vis;
        gate.updateMatrixWorld(true);
      }
      warmSaved = null;
      return null;
    },
    setWarm(on: boolean) {
      warm = on;
      glimpses.setWarm(on);
      glints.setWarm(on);
      beamRain.mesh.visible = on;
    },
    mounted: () => mounted,
    debug: () => ({ glimpses: glimpses.debug(), truck: truck ? [+truck.position.x.toFixed(1), +(-truck.position.z).toFixed(1), truckRun ? +truckRun.t.toFixed(1) : -1] : null, corridor: corridor.stats(), mounted, lamps: lamps.lights.length, clones: clones.size, glass: interiorGlass.length, cabinLo: cabinLo.length, proxy: proxy.length, rim: !!steering }),
  };
}

export type Opening = ReturnType<typeof createOpening>;
