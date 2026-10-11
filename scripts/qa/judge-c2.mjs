// AD review fix round 4 (copy of scratch/restage/final.mjs; subs hidden by CSS on any build; NOPROBE for live)
// Fix round 4 restage — the after-stills in ONE session: C2 / C2c marks (shipped code, no overrides), a same-frame
// diagnostic at 10.5 (veil cleared / lamp shadow off), then the parlor fixed views at B05 and C5 / C7.
const C2_LEN = 29.0;
const HEADPTS = [
  { name: 'face', obj: 'ada_head_rig', local: [0, -0.12, 0.1], r: 3 },
  { name: 'cheek_R', obj: 'ada_head_rig', local: [-0.055, -0.15, 0.06], r: 3 },
  { name: 'eye_R', obj: 'ada_head_rig', local: [-0.031, -0.07, 0.08], r: 2 },
  { name: 'cut', obj: 'ada_head_rig', local: [0, -0.212, 0.01], r: 3 },
  { name: 'stump', obj: 'ada/neck_01', r: 3 },
];
const VIEWS = [
  ['thr', [3.42, 1.5, 2.22], [5.4, 3.4, 1.3]],
  ['wide', [3.95, 0.3, 2.9], [6.4, 5.2, 1.9]],
  ['lean', [3.7, 1.26, 2.17], [5.31, 3.25, 1.4]],
  ['stool', [5.6, 2.0, 2.25], [4.4, 3.7, 0.9]],
];
export default async function (qa) {
  await qa.eval(`(() => { const s = document.createElement('style'); s.textContent = '.tk-subs{visibility:hidden!important}'; document.head.appendChild(s); return 1; })()`);
  await qa.game('loop.stop()');
  const w = await qa.eval(`(async () => {
    const g = window.__game; g.unpause?.();
    const active = () => g.cutscenes?.player?.active ?? g.director.cutscene ?? null;
    for (let i = 0; i < 900 && active(); i++) await g.advance(1, 1/30);
    const legs = [[1.8, -1.5], [1.8, 0.6], [3.1, 1.5]]; let k = 0;
    for (let i = 0; i < 30 * 40 && !active(); i++) {
      const p = g.pos(); const to = legs[Math.min(k, legs.length - 1)];
      if (k < legs.length - 1 && Math.hypot(p[0] - to[0], p[1] - to[1]) < 0.3) { k++; continue; }
      g.look(Math.atan2(to[1] - p[1], to[0] - p[0]), 0);
      await g.advance(1, 1/30, Math.hypot(p[0] - to[0], p[1] - to[1]) > 0.2 ? ['KeyW'] : []);
    }
    return { started: active(), t: g.ctx.time.now };
  })()`);
  qa.log('C2 start ' + JSON.stringify(w));
  const t0 = w.t;
  const until = async (sec) => qa.eval(`(async () => { const g = window.__game; while (g.ctx.time.now - ${t0} < ${sec} - 1e-6) await g.advance(1, 1/60); return 1; })()`);
  const probe = async (label) => { if (process.env.NOPROBE) return;
    const r = await qa.eval(`(async () => { const g = window.__game; const ex = g.look.exposure(); const info = g.renderer.info; const a = info.autoReset; info.autoReset = false; info.reset(); await g.advance(1, 1/1200); const ri = [info.render.drawCalls, info.render.triangles]; info.autoReset = a; return { e: ex.applied, ri, p: await g.look.hdr(${JSON.stringify(HEADPTS)}) }; })()`);
    qa.log(`[final] ${label} e ${r.e} draws ${r.ri[0]} tris ${r.ri[1]} ` + r.p.map((q) => `${q.name} ${q.off ? 'off' : (+q.lum).toPrecision(3) + '@' + q.uv}`).join(' · '));
  };
  for (const m of (process.env.MARKS ?? '7.75,7.95,8.2,8.4,9.3,10.5,13.9,22.95,24.0').split(',').map(Number)) {
    await until(m);
    await probe(`c2-${m}`);
    await qa.shot(`c2-${m.toFixed(2)}`);
    if (Math.abs(m - 10.5) < 1e-3 && process.env.DIAG3) {
      const hl = await qa.eval(`(async () => { const g = window.__game; window.__hh = []; const names = new Set(); g.scene.traverse((o) => { if (!o.isMesh || !o.visible) return; const mm = Array.isArray(o.material) ? o.material : [o.material]; if (mm.some((x) => /hair|veil|lock/i.test(x.name || ''))) { names.add(o.name + ':' + mm.map((x) => x.name).join(',')); o.visible = false; window.__hh.push(o); } }); await g.advance(1, 1/1000); await g.advance(1, 1/1000); return [...names].join(' | '); })()`);
      qa.log('[diag3] hidden hair meshes: ' + hl);
      await probe('diag3-nohair');
      await qa.shot('diag3-nohair');
      await qa.eval(`(async () => { for (const o of window.__hh) o.visible = true; return 1; })()`);
    }
    if (Math.abs(m - 10.5) < 1e-3 && process.env.DIAG2) {
      const near = await qa.eval(`(() => { const g = window.__game; let H = null; g.scene.traverse((o) => { if (!H && o.name === 'ada_head_rig') H = o; }); if (!H) return 'no rig'; const hp = H.getWorldPosition(new H.position.constructor()); const out = []; window.__dg = []; g.scene.traverse((o) => { if (!o.isMesh || !o.visible) return; if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); const c = o.geometry.boundingSphere.center.clone().applyMatrix4(o.matrixWorld); const d = c.distanceTo(hp); if (d < 0.6 || /head/i.test(o.name)) { window.__dg.push(o); const mm = Array.isArray(o.material) ? o.material : [o.material]; out.push(o.name + ':' + mm.map((x) => (x.name || '?') + '/' + x.type).join(',') + '@' + d.toFixed(2) + (o.isSkinnedMesh ? 'S' : '')); } }); return out.join(' | '); })()`);
      qa.log('[diag2] near head: ' + near);
      await qa.eval(`(async () => { const g = window.__game; window.__sw = []; for (const o of window.__dg) { if (/hair|veil|lock|strand/i.test(o.name + (o.material?.name ?? ''))) continue; const mm = o.material; if (Array.isArray(mm)) continue; const w = new mm.constructor(); w.color?.setRGB?.(0.5, 0.5, 0.5); w.roughness = 0.7; w.metalness = 0; w.skinning = mm.skinning; window.__sw.push([o, mm]); o.material = w; } await g.advance(1, 1/1000); await g.advance(1, 1/1000); return window.__sw.length; })()`).then((n) => qa.log('[diag2] grey-swapped ' + n));
      await probe('diag-grey');
      await qa.shot('diag-grey');
      await qa.eval(`(async () => { for (const [o, mm] of window.__sw) o.material = mm; window.__hh = []; for (const o of window.__dg) if (/hair|veil|lock|strand/i.test(o.name + (o.material?.name ?? ''))) { o.visible = false; window.__hh.push(o); } const g = window.__game; await g.advance(1, 1/1000); await g.advance(1, 1/1000); return window.__hh.length; })()`).then((n) => qa.log('[diag2] hair hidden ' + n));
      await probe('diag-nohair');
      await qa.shot('diag-nohair');
      await qa.eval(`(async () => { for (const o of window.__hh) o.visible = true; return 1; })()`);
    }
    if (Math.abs(m - 10.5) < 1e-3 && process.env.DIAG) {
      await qa.eval(`(async () => { globalThis.__veil = 1; const g = window.__game; await g.advance(1, 1/1000); await g.advance(1, 1/1000); return 1; })()`);
      await probe('diag-veil1');
      await qa.eval(`(async () => { globalThis.__veil = undefined; const g = window.__game; let L = null; g.scene.traverse((o) => { if (!L && o.isLight && o.castShadow && /LAMP_PARLOR/.test(o.name + (o.parent?.name ?? ''))) L = o; }); window.__dl = L; if (L) { L.userData.__si = L.shadow.intensity; L.shadow.intensity = 0; } await g.advance(1, 1/1000); await g.advance(1, 1/1000); return !!L; })()`).then((ok) => qa.log('shadow light found ' + ok));
      await probe('diag-noshadow');
      await qa.eval(`(async () => { const L = window.__dl; if (L) L.shadow.intensity = L.userData.__si; return 1; })()`);
    }
  }
  for (const m of (process.env.C2C ?? '4.1,7.1,13.0,15.5').split(',').filter(Boolean).map(Number)) { await until(C2_LEN + m); await qa.shot(`c2c-${m.toFixed(2)}`); if (process.env.DIAG3) qa.log('[diag3] rays ' + m + ': ' + await qa.eval(`(() => { const g = window.__game; const cam = g.camera; const cp = cam.getWorldPosition(cam.position.clone()); const out = []; g.scene.traverse((o) => { if (!o.isMesh || !o.visible) return; if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); const bs = o.geometry.boundingSphere; const c = bs.center.clone().applyMatrix4(o.matrixWorld); const d = c.distanceTo(cp); const v = c.clone().project(cam); if ((d < 1.6 && v.z < 1 && Math.abs(v.x) < 1.3 && Math.abs(v.y) < 1.3) || o.isSkinnedMesh) out.push(o.name + (o.isSkinnedMesh ? '[S]' : '') + ' d' + d.toFixed(2) + ' ndc ' + v.x.toFixed(2) + ',' + v.y.toFixed(2)); }); return 'cam ' + cp.toArray().map((x) => x.toFixed(2)) + ' :: ' + out.join(' | '); })()`)); }
  if (process.env.NOVIEWS) return;
  // B05: let the chain end, then the parlor's fixed views
  await qa.eval(`(async () => { const g = window.__game; for (let i = 0; i < 30 * 40 && (g.cutscenes?.player?.active ?? null); i++) await g.advance(1, 1/30); await g.advance(30, 1/30); return g.storyState?.().beat; })()`).then((b) => qa.log('after chain beat ' + b));
  for (const [n, e, t] of VIEWS) {
    const h = Math.atan2(t[1] - e[1], t[0] - e[0]), p = Math.atan2(t[2] - e[2], Math.hypot(t[0] - e[0], t[1] - e[1]));
    const cs = await qa.eval(`(async () => { const g = window.__game; g.goto(${e[0]}, ${e[1]}, ${e[2] - 1.65}, ${h}, ${p}); await g.advance(20, 1/30); g.goto(${e[0]}, ${e[1]}, ${e[2] - 1.65}, ${h}, ${p}); await g.advance(2, 1/30); return g.cutscenes?.player?.active ?? null; })()`);
    qa.log(`view ${n} cs ${cs}`);
    await qa.shot(`v-${n}`);
  }
  for (const [id, at] of [['C5', [17.6, 20.6]], ['C7', [22.0, 24.6]]]) {
    for (let i = 0; i < 4; i++) { const cs = await qa.eval(`(() => { const c = window.__game.cutscenes?.player; const id = c?.active ?? null; if (id) c.skip(true); return id; })()`); if (!cs) break; await qa.eval(`window.__game.advance(45, 1/30)`); }
    const ok = await qa.eval(`window.__game.cutscenes.player.play('${id}')`);
    qa.log(`play ${id} → ${ok}`);
    let t = 0;
    for (const s of at) { await qa.eval(`window.__game.advance(${Math.round((s - t) * 30)}, 1/30)`); t = s; await qa.shot(`${id}-${s}`); }
  }
}
