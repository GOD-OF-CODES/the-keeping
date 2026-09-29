// Periodic noise (src/materials/noise-cpu.ts, the CPU twin of tsl-noise.ts): tiling, range, determinism.
const { test } = (await import('node:' + 'test')) as any;
const assert = ((await import('node:' + 'assert/strict')) as any).default;

import { cellsPerTile, fbm, gnoise, hash2u, pcg, ridged, seedHash, srgbToLinear, vnoise, warp, worley, wrap, type V2 } from '../src/materials/noise-cpu.ts';

// Deterministic sample points.
function* points(n: number, seed = 1): Generator<V2> {
  let s = seed >>> 0;
  const r = () => {
    s = pcg(s);
    return (s >>> 8) / 16777216;
  };
  for (let i = 0; i < n; i++) yield [r(), r()];
}

const close = (a: number, b: number, eps: number, msg: string) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

test('pcg matches reference values (uint32 arithmetic)', () => {
  // Reference: PCG-RXS-M-XS as in Jarzynski & Olano, computed with BigInt.
  const ref = (v: number) => {
    const M = 0xffffffffn;
    const s = (BigInt(v) * 747796405n + 2891336453n) & M;
    const w = (((s >> ((s >> 28n) + 4n)) ^ s) * 277803737n) & M;
    return Number((w >> 22n) ^ w);
  };
  for (const v of [0, 1, 2, 12345, 0x7fffffff, 0x80000000, 0xffffffff, 2891336453]) assert.equal(pcg(v), ref(v), `pcg(${v})`);
  assert.notEqual(hash2u(1, 2, seedHash(3)), hash2u(2, 1, seedHash(3)));
});

test('wrap is exact at integer multiples (fp-safe)', () => {
  for (const m of [1, 3, 5, 7, 12, 22, 64, 511]) {
    for (let k = -3; k <= 3; k++) {
      assert.equal(wrap(k * m, m), 0, `wrap(${k * m}, ${m})`);
      assert.equal(wrap(k * m + 1, m), m === 1 ? 0 : 1);
      assert.equal(wrap(k * m - 1, m), m - 1 === 0 ? 0 : m - 1);
    }
  }
});

test('value + gradient noise tile with their period (both axes, non-square periods)', () => {
  const S = seedHash(7);
  for (const per of [[3, 5], [8, 8], [1, 13], [22, 2]] as V2[]) {
    for (const [u, v] of points(200)) {
      const p: V2 = [u * per[0], v * per[1]];
      for (const [kx, ky] of [[1, 0], [0, 1], [2, -1], [-3, 4]]) {
        const q: V2 = [p[0] + kx * per[0], p[1] + ky * per[1]];
        close(vnoise(q, per, S), vnoise(p, per, S), 1e-9, `vnoise per=${per}`);
        close(gnoise(q, per, S), gnoise(p, per, S), 1e-9, `gnoise per=${per}`);
      }
    }
  }
});

test('noise is continuous across the tile seam (u→1 meets u→0)', () => {
  const S = seedHash(2);
  const per: V2 = [6, 4];
  for (let i = 0; i <= 20; i++) {
    const v = i / 20;
    const a = gnoise([per[0] * (1 - 1e-7), v * per[1]], per, S);
    const b = gnoise([0, v * per[1]], per, S);
    close(a, b, 1e-5, 'seam u');
    const c = vnoise([v * per[0], per[1] * (1 - 1e-7)], per, S);
    const d = vnoise([v * per[0], 0], per, S);
    close(c, d, 1e-5, 'seam v');
  }
});

test('noise ranges', () => {
  const S = seedHash(11);
  let gmin = 9;
  let gmax = -9;
  let vmin = 9;
  let vmax = -9;
  let sum = 0;
  let n = 0;
  for (const [u, v] of points(20000, 5)) {
    const g = gnoise([u * 16, v * 16], [16, 16], S);
    const vv = vnoise([u * 16, v * 16], [16, 16], S);
    gmin = Math.min(gmin, g);
    gmax = Math.max(gmax, g);
    vmin = Math.min(vmin, vv);
    vmax = Math.max(vmax, vv);
    sum += g;
    n++;
  }
  assert.ok(gmin >= -1.05 && gmax <= 1.05, `gnoise range ${gmin}..${gmax}`);
  assert.ok(gmax - gmin > 1.0, `gnoise spread ${gmin}..${gmax}`);
  assert.ok(vmin >= 0 && vmax <= 1, `vnoise range ${vmin}..${vmax}`);
  assert.ok(Math.abs(sum / n) < 0.05, `gnoise mean ${sum / n}`);
});

test('fBm, ridged and domain warp tile on the unit square (tile space)', () => {
  const o = { octaves: 5, seed: 3 };
  for (const [u, v] of points(150, 9)) {
    for (const f of [[2, 3], [4, 4], [1, 7]] as V2[]) {
      close(fbm([u + 1, v], f, o), fbm([u, v], f, o), 1e-9, 'fbm u');
      close(fbm([u, v - 1], f, o), fbm([u, v], f, o), 1e-9, 'fbm v');
      close(ridged([u + 2, v + 1], f, o), ridged([u, v], f, o), 1e-9, 'ridged');
      const a = warp([u, v], f, 0.08, o);
      const b = warp([u + 1, v + 1], f, 0.08, o);
      // Warp adds a periodic offset: the warped point moves by exactly the tile shift.
      close(b[0] - a[0], 1, 1e-9, 'warp x');
      close(b[1] - a[1], 1, 1e-9, 'warp y');
      // …so noise sampled at the warped point is periodic too.
      close(fbm(b, [5, 5], o), fbm(a, [5, 5], o), 1e-9, 'fbm∘warp');
    }
    const r = ridged([u, v], [4, 4], o);
    assert.ok(r >= 0 && r <= 1, `ridged range ${r}`);
  }
});

test('Worley tiles (F1, F2, id, edge) and is well-formed', () => {
  const S = seedHash(21);
  for (const per of [[5, 5], [3, 8]] as V2[]) {
    for (const [u, v] of points(300, 13)) {
      const p: V2 = [u * per[0], v * per[1]];
      const a = worley(p, per, S, 0.9);
      const b = worley([p[0] + per[0], p[1] - per[1]], per, S, 0.9);
      close(a.f1, b.f1, 1e-9, 'F1');
      close(a.f2, b.f2, 1e-9, 'F2');
      close(a.edge, b.edge, 1e-9, 'edge');
      assert.equal(a.id, b.id);
      assert.ok(a.f1 >= 0 && a.f1 <= a.f2 + 1e-12, `F1 ≤ F2 (${a.f1}, ${a.f2})`);
      assert.ok(a.edge >= -1e-9 && a.edge <= a.f2, `edge ${a.edge}`);
      assert.ok(a.id >= 0 && a.id < 1);
    }
  }
  // Edge distance ≈ 0 on a bisector: between two neighbouring points F1 ≈ F2.
  let near = 0;
  for (const [u, v] of points(4000, 17)) {
    const w = worley([u * 5, v * 5], [5, 5], S, 1);
    if (w.edge < 0.01) {
      near++;
      assert.ok(w.f2 - w.f1 < 0.05, `edge≈0 but F2-F1=${w.f2 - w.f1}`);
    }
  }
  assert.ok(near > 0);
});

test('helpers: cellsPerTile integer ≥ 1, sRGB decode', () => {
  assert.equal(cellsPerTile(2.4, 0.11), 22);
  assert.equal(cellsPerTile(0.2, 5), 1);
  close(srgbToLinear(0.5), 0.2140, 1e-4, 'srgb 0.5');
  close(srgbToLinear(1), 1, 1e-12, 'srgb 1');
});
