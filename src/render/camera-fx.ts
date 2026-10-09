// Camera / film nodes for the post chain (docs/REALISM-BACKLOG.md items 1, 8, 14). TSL APIs verified against r186:
// screenCoordinate / screenSize (nodes/display/ScreenNode.js), uv(), TextureNode.sample().
//
// lensCA     : lateral chromatic aberration as a per-channel radial magnification (what a real lens does: red images
//              slightly larger than green, blue slightly smaller). The split is given in pixels at the frame corner,
//              so it is resolution-independent; 1 px total is a good prime lens wide open. Three taps of the HDR
//              texture before bloom, so highlights aren't fringed twice and no extra full-screen render target
//              is needed (r186 ChromaticAberrationNode wraps a non-texture input in an RTT pass).
// filmFinish : vignette × zero-mean film grain. Grain is multiplicative (c·(1+g)), so black stays black (the old
//              additive grain clipped its negative half and lifted black by ~4/255). On the display-encoded value
//              c ≈ lin^(1/2.2), c·(1 + g/2.2) ≈ (lin·(1 + g))^(1/2.2): the amplitude is specified in linear light.
//              Weighted by a mid-tone bell 4L(1-L) + 0.15 (film grain is most visible in the mid-tones), 1.5 px
//              grain (value noise on a 1.5 px lattice, bilinear), and scaled with the exposure gain (ISO push).
// whiteBalanceGain : von Kries gain (linear sRGB) that renders a `kelvin` illuminant neutral, unit luminance.

import { Fn, float, floor, fract, dot, sin, vec2, vec4, uv, screenCoordinate, screenSize, screenUV, smoothstep, luminance, mix, time, log2, max, min, clamp } from 'three/tsl';
import { kelvinToLinearRGB } from '../world/lights.ts';

/** Lateral CA on a texture node. uSplitPx: total red-blue split at the frame corner in px (uniform). */
export function lensCA(tex: any, uSplitPx: any): any {
  return Fn(() => {
    const p = uv();
    const d = p.sub(0.5);
    // channel magnification ±k about the centre; at the corner (|d|·size = half the diagonal) the R-B split is uSplitPx
    const k = uSplitPx.div(screenSize.length());
    const g = tex.sample(p);
    const r = tex.sample(d.mul(float(1).add(k)).add(0.5)).r;
    const b = tex.sample(d.mul(float(1).sub(k)).add(0.5)).b;
    return vec4(r, g.g, b, g.a);
  })();
}

/** 2D hash → [0, 1). */
const hash21 = (p: any) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));

/** Vignette × zero-mean multiplicative film grain on a display-encoded rgba. */
export function filmFinish(uVignette: any, uGrain: any, uExposure: any, uGrainPerEV: any) {
  return Fn(([c]: [any]) => {
    const dv = screenUV.sub(0.5).mul(vec2(1.25, 1)).length();
    const vig = float(1).sub(smoothstep(0.3, 0.95, dv).mul(uVignette));
    // value noise on a 1.5 px lattice, re-seeded every frame (golden-ratio offset), bilinear between the 4 cells
    const q = screenCoordinate.xy.div(1.5).add(fract(time.mul(0.6180339)).mul(vec2(419.2, 371.9)));
    const i = floor(q);
    const f = fract(q);
    const s = f.mul(f).mul(f.mul(-2).add(3));
    const a = hash21(i);
    const b = hash21(i.add(vec2(1, 0)));
    const cc = hash21(i.add(vec2(0, 1)));
    const e = hash21(i.add(vec2(1, 1)));
    // bilinear of 4 uniforms has σ ≈ 0.19 (vs 0.29): ×1.5 brings it back, centred → zero mean, ±~1 range
    const n = mix(mix(a, b, s.x), mix(cc, e, s.x), s.y).sub(0.5).mul(3);
    const l = clamp(luminance(c.rgb), 0, 1);
    const bell = l.mul(float(1).sub(l)).mul(4).add(0.15);
    const iso = float(1).add(max(log2(max(uExposure, 1e-3)), 0).mul(uGrainPerEV));
    const g = n.mul(uGrain).mul(min(bell, 1)).mul(iso).div(2.2);
    return vec4(c.rgb.mul(vig).mul(g.add(1)), c.a);
  });
}

/** Linear-sRGB gain that maps a `kelvin` white to neutral (unit luminance), mixed toward 1 by (1 - strength). */
export function whiteBalanceGain(kelvin: number, strength = 1): [number, number, number] {
  const w = kelvinToLinearRGB(kelvin);
  let g: [number, number, number] = [1 / w[0], 1 / w[1], 1 / w[2]];
  const y = 0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2];
  g = [g[0] / y, g[1] / y, g[2] / y];
  return [1 + (g[0] - 1) * strength, 1 + (g[1] - 1) * strength, 1 + (g[2] - 1) * strength];
}
