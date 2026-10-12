// M-A cutscene effects (docs/CUTSCENES-PLAN.md §6 runtime 4) for the SCENES lane: `drops` (C5b eave macro), `mist_roll`
// (C5 front door), `match_flare` (C6b lantern), `dash_ticket` (C6 insert). Kept out of cutscene-fx.ts (shared by
// several lanes this round); cutscene-fx.ts forwards unknown fx ids here first. Existing assets only: every mesh is a
// primitive or a clone of a level prop; every texture is drawn at load on a canvas.
//
// Real numbers:
//  - a pendant water drop detaches at ≈ 4.6 mm diameter (Tate's law with the capillary length of water, 2.7 mm) and
//    falls at g = 9.81 m/s²; an eave drips one drop every 2–3 s after rain stops;
//  - a safety match burns ≈ 1.5 cd for ≈ 1 s at ≈ 1700 K (yellow-orange core, blue base);
//  - dawn mist (advection fog) drifts at ≈ 0.2–0.5 m/s at floor height through an open door.

import * as THREE from 'three/webgpu';
import { uniform, vec3, vec4, float, mix, pow, oneMinus, saturate, dot, normalView, positionViewDirection, texture as tslTexture, uv } from 'three/tsl';
import { planToWorld } from '../shared/coords.ts';
import { registerPrewarm } from '../render/cs-prewarm.ts';
import type { Level } from './level.ts';

type Params = Record<string, number | string | boolean>;

const G = 9.81;
const DROP_D = 0.0046; // m at detachment

/** A soft cloud texture (canvas, value noise sums), alpha only. */
function mistTexture(): any {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  let seed = 9173;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const grid = (n: number) => Array.from({ length: n * n }, rnd);
  const octs = [grid(4), grid(8), grid(16)];
  const sample = (gr: number[], n: number, x: number, y: number) => {
    const fx = x * n, fy = y * n;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const at = (i: number, j: number) => gr[((j % n) + n) % n * n + (((i % n) + n) % n)];
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
  };
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const n = sample(octs[0], 4, u, v) * 0.55 + sample(octs[1], 8, u, v) * 0.3 + sample(octs[2], 16, u, v) * 0.15;
      // soft edge so the quad never shows
      const e = Math.min(u, 1 - u, v, 1 - v) * 4;
      const a = Math.max(0, Math.min(1, (n - 0.35) * 2.2)) * Math.min(1, e);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function createMaFx(level: Level) {
  const root = level.root;

  // ---------------------------------------------------------------- drops: one drop swells on a lip, detaches, falls
  const uSky = uniform(new THREE.Color(0.32, 0.36, 0.42)); // the pale overcast dawn it mirrors (linear, × exposure)
  const uSkyGain = uniform(1);
  const dropMat = new THREE.MeshBasicNodeMaterial();
  // a water sphere mirrors the sky at grazing angles (Fresnel, F0 0.02) and shows the dark eave/ground through its
  // middle: dark core, bright rim, a small specular kick at the top
  const facing = saturate(dot(normalView, positionViewDirection));
  const rim = pow(oneMinus(facing), float(2.5));
  const top = pow(saturate(normalView.y), float(24));
  // seen against the sky a drop is a small inverted lens: its body refracts the bright sky/fog (≈ 70–90 % of it), the
  // rim goes dark (total internal reflection of the dark ground and eave), a point highlight sits near the top
  const body = pow(facing, float(0.6)).mul(0.82);
  dropMat.colorNode = mix(vec3(0.02, 0.022, 0.025), uSky.mul(uSkyGain), body.sub(rim.mul(0.5)).max(0.0)).add(uSky.mul(uSkyGain).mul(top).mul(2.2));
  const drop = new THREE.Mesh(new THREE.SphereGeometry(DROP_D / 2, 18, 14), dropMat);
  drop.name = 'ma-drop';
  drop.visible = false;
  drop.frustumCulled = false;
  root.add(drop);
  const drops = { on: false, at: new THREE.Vector3(), period: 2.6, t: 0 };

  // ---------------------------------------------------------------- mist roll: low cloud layers drift in over a sill
  const mistTex = mistTexture();
  const uMist = uniform(0);
  const uMistCol = uniform(new THREE.Color(0.5, 0.54, 0.58));
  const mistLayers: { m: any; off: any; speed: number; y0: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const off = uniform(new THREE.Vector2(i * 0.31, i * 0.17));
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const a = tslTexture(mistTex, uv().mul(1.3).add(off)).a;
    // fades out with depth into the hall (uv.y 0 = the sill, 1 = 2.4 m in): the hall is dark, only the sill is lit
    const depth = oneMinus(uv().y).mul(0.85).add(0.15);
    m.colorNode = vec4(uMistCol, a.mul(uMist).mul(depth).mul(0.3 - i * 0.04));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.4), m);
    mesh.name = `ma-mist-${i}`;
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    root.add(mesh);
    mistLayers.push({ m: mesh, off, speed: 0.06 + i * 0.025, y0: 0 });
  }
  const mist = { on: false, t: 0, base: new THREE.Vector3() };

  // ---------------------------------------------------------------- match flare: a 1 s flame (a lit card, 1700 K)
  const flareMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const uFlare = uniform(0);
  const fu = uv().sub(0.5);
  const flame = saturate(oneMinus(fu.x.mul(fu.x).mul(28).add(fu.y.add(0.12).mul(fu.y.add(0.12)).mul(9))));
  flareMat.colorNode = vec4(vec3(1.0, 0.5, 0.13).mul(uFlare).mul(2.2), pow(flame, float(2.2)).mul(saturate(uFlare)));
  const flare = new THREE.Mesh(new THREE.PlaneGeometry(0.018, 0.04), flareMat);
  flare.name = 'ma-match-flare';
  flare.visible = false;
  flare.frustumCulled = false;
  root.add(flare);
  const match = { on: false, t: 0 };
  // M-A infra (surgical, logged): compiled at load by the warm-up's 'cs-prewarm' step (src/render/cs-prewarm.ts)
  registerPrewarm(drop, flare, ...mistLayers.map((l) => l.m));

  // ---------------------------------------------------------------- dash ticket: the bus ticket laid on the dash
  let ticket: any = null;

  const fx = (id: string, p: Params): boolean => {
    switch (id) {
      case 'drops': {
        drops.on = !!p.on;
        drops.t = 0;
        if (p.period !== undefined) drops.period = Number(p.period);
        if (p.x !== undefined) drops.at.set(...planToWorld([Number(p.x), Number(p.y), Number(p.z)]));
        if (p.sky !== undefined) uSkyGain.value = Number(p.sky);
        drop.visible = drops.on;
        return true;
      }
      case 'mist_roll': {
        mist.on = !!p.on;
        mist.t = 0;
        // the front door (D_FRONT, O_FRONT centre (1.8, −0.15), floor 0.6): layers start on the sill, drift north
        const door = String(p.door ?? 'D_FRONT');
        if (door === 'D_FRONT') mist.base.set(...planToWorld([1.8, -0.35, 0.62]));
        if (!mist.on) uMist.value = 0;
        for (const L of mistLayers) L.m.visible = mist.on;
        return true;
      }
      case 'match_flare': {
        match.on = !!p.on;
        match.t = 0;
        if (p.x !== undefined) flare.position.set(...planToWorld([Number(p.x) + 0.05, Number(p.y) - 0.04, Number(p.z) - 0.02]));
        if (!match.on) uFlare.value = 0;
        flare.visible = match.on;
        return true;
      }
      case 'dash_ticket': {
        const interior = level.prop('P_CAR_INTERIOR');
        if (p.on && !ticket) {
          const src = level.prop('P_TICKET');
          if (!src || !interior) return true;
          ticket = src.clone(true);
          ticket.name = 'ma-dash-ticket';
          // car-local (x right, y forward, z up) → the interior's local frame (nose −Z) = planToWorld(car-local)
          const L = [Number(p.x ?? 0.12), Number(p.y ?? 0.62), Number(p.z ?? 0.985)] as [number, number, number];
          // AD review M-A: the fixed (−π/2, 0, yaw) turn left the card standing ≈ 45° up on the dash (measured in C6,
          // car-local extents 7.0 × 3.2 × 3.6 cm) — the hem-pocket prop carries its own tilt. Lay it truly flat: the
          // card's normal = the smallest principal axis of its vertices (PCA), turned onto the interior's up (+Y);
          // then the yaw; its lowest point rests on the dash at L.
          ticket.position.set(0, 0, 0);
          ticket.rotation.set(0, 0, 0);
          ticket.updateMatrixWorld(true);
          const pts: any[] = [];
          ticket.traverse((m: any) => {
            const a = m.isMesh ? m.geometry?.attributes?.position : null;
            if (a) for (let i = 0; i < a.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld));
          });
          if (pts.length >= 3) {
            const c = new THREE.Vector3();
            for (const q of pts) c.add(q);
            c.multiplyScalar(1 / pts.length);
            const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
            for (const q of pts) {
              const d = [q.x - c.x, q.y - c.y, q.z - c.z];
              for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) C[r * 3 + k] += d[r] * d[k];
            }
            const tr = C[0] + C[4] + C[8];
            let n = new THREE.Vector3(0.577, 0.577, 0.577);
            for (let it = 0; it < 60; it++) {
              const v = [n.x, n.y, n.z];
              const o = [0, 1, 2].map((r) => tr * v[r] - (C[r * 3] * v[0] + C[r * 3 + 1] * v[1] + C[r * 3 + 2] * v[2]));
              n = new THREE.Vector3(o[0], o[1], o[2]);
              if (n.lengthSq() < 1e-20) n.set(0.3, 0.9, 0.2);
              n.normalize();
            }
            const up = new THREE.Vector3(0, 1, 0);
            if (n.dot(up) < 0) n.negate();
            const q = new THREE.Quaternion().setFromUnitVectors(n, up);
            ticket.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(up, Number(p.yaw ?? 0.35)).multiply(q));
            let minY = Infinity;
            for (const v of pts) minY = Math.min(minY, v.clone().applyQuaternion(ticket.quaternion).y);
            const cc = c.clone().applyQuaternion(ticket.quaternion);
            const at = new THREE.Vector3(...planToWorld(L));
            ticket.position.set(at.x - cc.x, at.y - minY, at.z - cc.z);
          } else {
            ticket.position.set(...planToWorld(L));
            ticket.rotation.set(-Math.PI / 2, 0, Number(p.yaw ?? 0.35));
          }
          interior.add(ticket);
        }
        if (ticket) ticket.visible = !!p.on;
        return true;
      }
      default:
        return false;
    }
  };

  const update = (dt: number, camera?: any) => {
    if (drops.on) {
      drops.t += dt;
      const P = drops.period;
      const swell = 0.75 * P; // swells for 3/4 of the period, then falls
      const t = drops.t % P;
      if (t < swell) {
        const k = t / swell;
        const s = 0.35 + 0.65 * Math.cbrt(k); // volume grows linearly → radius ∝ ∛
        drop.scale.set(s, s * (1 + 0.28 * k * k), s);
        drop.position.copy(drops.at);
        drop.position.y -= (DROP_D / 2) * s * (1 + 0.28 * k * k);
      } else {
        const tf = t - swell;
        drop.scale.set(0.92, 1.12, 0.92);
        drop.position.copy(drops.at);
        drop.position.y -= DROP_D / 2 + 0.5 * G * tf * tf;
      }
    }
    if (mist.on) {
      mist.t += dt;
      uMist.value = Math.min(1, mist.t / 2.5);
      mistLayers.forEach((L, i) => {
        // the layers roll in over the sill (north), slightly rising, the noise scrolling against the drift
        const adv = Math.min(1.2, mist.t * (0.32 + i * 0.05));
        L.m.position.set(mist.base.x + (i - 1.5) * 0.12, mist.base.y + 0.02 + i * 0.07, mist.base.z + 0.6 - adv);
        L.off.value.x += dt * 0.012 * (i % 2 ? 1 : -1);
        L.off.value.y += dt * L.speed;
      });
    }
    if (match.on) {
      match.t += dt;
      // strike flare (0.15 s) → steady flame with a soft flicker
      const k = match.t < 0.15 ? 1.6 - match.t * 4 : 1 + 0.12 * Math.sin(match.t * 31) * Math.sin(match.t * 7.3);
      uFlare.value = k;
      if (camera) flare.quaternion.copy(camera.quaternion);
    }
  };

  return { fx, update };
}

export type MaFx = ReturnType<typeof createMaFx>;
