// PERF fix round 3: exact same-state A/B of the torch caster cull. Renders the CURRENT frame state three times with plain
// renderer.render(scene, camera) into half-float targets (no TAA / grain / post), node time frozen:
// __vcMode off, off, MODE, off, off (MODE at an odd slot like refs 1 and 5: some passes alternate per render) (floor = off vs off: anything that differs between two identical renders,
// e.g. a pipeline compile landing mid-sample; effect = the smaller of MODE vs either off) with MODE ('force' =
// cone cull, 'old' = fix-round-1 bound). Compares linear luminance per pixel. install(qa) once; then qa.eval('__abvc()').
export async function install(qa, W = 384) {
  await qa.eval(`(() => {
    const g = window.__game; const R = g.renderer;
    const f16 = (u) => { const s = (u & 0x8000) ? -1 : 1, e = (u >> 10) & 31, m = u & 1023; return e === 0 ? s * m * 2 ** -24 : e === 31 ? NaN : s * (1 + m / 1024) * 2 ** (e - 15); };
    const lum = (arr, i) => { const rd = (j) => arr instanceof Uint16Array ? f16(arr[j]) : arr[j]; return 0.2126 * rd(4 * i) + 0.7152 * rd(4 * i + 1) + 0.0722 * rd(4 * i + 2); };
    const cmp = (a, b, N, w) => {
      let n = 0, nBig = 0, maxD = 0, maxRel = 0, at = null;
      for (let i = 0; i < N; i++) {
        const la = lum(a, i), lb = lum(b, i); const d = Math.abs(la - lb); const rel = d / Math.max(1e-4, la, lb);
        if (d > 1e-5) n++; if (rel > 0.02 && d > 2e-4) nBig++;
        if (d > maxD) { maxD = d; at = [i % w, Math.floor(i / w)]; } if (d > 2e-4 && rel > maxRel) maxRel = rel;
      }
      return { n, nBig, maxD: +maxD.toExponential(2), maxRel: +maxRel.toFixed(3), at };
    };
    window.__abvc = async (mode = 'force') => {
      const cam = g.camera, scene = g.scene;
      let L = null; scene.traverse((o) => { if (o.isSpotLight && o.userData?.viewCull) L = o; });
      const Q = L.userData.viewCullQA;
      const size = R.getDrawingBufferSize(new (cam.position.constructor)());
      const w = ${W}, h = Math.round(w * size.y / size.x);
      if (!window.__abRT || window.__abRT[0].width !== w) window.__abRT = [0, 1, 2, 3, 4].map(() => new Q.RenderTarget(w, h, { type: Q.HalfFloatType }));
      const nf = R._nodes.nodeFrame; const t0 = nf.time; const prev = R.getRenderTarget();
      const modes = ['off', 'off', mode, 'off', 'off']; const cut = []; /* X at an odd slot like its references: some passes alternate per render */
      for (let k = 0; k < 5; k++) {
        globalThis.__vcMode = modes[k];
        const c0 = L.userData.viewCull.cut;
        nf.update(); nf.time = t0; nf.deltaTime = 0;
        R.setRenderTarget(window.__abRT[k]);
        R.render(scene, cam);
        cut.push(L.userData.viewCull.cut - c0);
      }
      R.setRenderTarget(prev);
      globalThis.__vcMode = undefined;
      const px = [];
      for (let k = 0; k < 5; k++) px.push(await R.readRenderTargetPixelsAsync(window.__abRT[k], 0, 0, w, h));
      if (px[0].length !== w * h * 4) return { err: 'readback size ' + px[0].length + ' != ' + w * h * 4 };
      const fo = cmp(px[0], px[4], w * h, w), fe = cmp(px[1], px[3], w * h, w);
      const floor = fo.nBig >= fe.nBig ? fo : fe;
      const e1 = cmp(px[0], px[2], w * h, w), e2 = cmp(px[4], px[2], w * h, w);
      const eff = e1.nBig <= e2.nBig ? e1 : e2;
      return { culled: cut[2], leak: cut[0] + cut[1] + cut[3] + cut[4], floor, eff, torch: L.intensity > 0 };
    };
    return 1;
  })()`);
  // flush first-use pipeline compiles of the plain-render contexts (results discarded)
  for (let i = 0; i < 4; i++) await qa.eval('(async () => JSON.stringify(await window.__abvc("force")))()');
}
