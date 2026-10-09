// LIGHTING builder 2 (surfaces + light): copies the live LOOK values (window.__game.look.set) into the shader
// uniforms / light settings of items 5 (candle specular), 6 (reflections) and 11 (flashlight + bounce) once per
// frame. Cheap: a handful of number writes; the beam flux is re-integrated only when a beam value changes.

import { LOOK } from './look.ts';
import { uCandleSpec, uOpenSkyE, uSkyFill, uSpecProxyHi, uSpecProxyLo } from './lightmap-material.ts';
import { uReflLod, uReflection } from './reflections.ts';
import { TORCH_KELVIN, uTorchCore, uTorchShelf, uTorchSigma2, uTorchSpill, uTorchTail, type Flashlight } from './flashlight.ts';
import { beamFlux, type FlashlightBounce } from './flashlight-bounce.ts';
import { kelvinToLinearRGB } from '../world/lights.ts';

let beamKey = '';

const TW_FILL = (() => {
  const c = kelvinToLinearRGB(9000); // twilight sky light: blue (≈ 9000 K at unit luminance)
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return [c[0] / l, c[1] / l, c[2] / l];
})();

/** skyTint: the story's blue-hour level 0..1 (C6 / B12): the twilight sky fill on the exterior lightmaps. */
export function syncSurfaceLook(fl?: Flashlight | null, bounce?: FlashlightBounce | null, skyTint = 0): void {
  const fill = Math.max(0, Math.min(1, skyTint)) * LOOK.twilightE;
  uSkyFill.value.setRGB(TW_FILL[0] * fill, TW_FILL[1] * fill, TW_FILL[2] * fill);
  uOpenSkyE.value = LOOK.openSkyE;
  uCandleSpec.value = LOOK.candleSpec;
  uSpecProxyLo.value = LOOK.specProxyLo;
  uSpecProxyHi.value = Math.max(LOOK.specProxyLo + 1e-3, LOOK.specProxyHi);
  uReflection.value = LOOK.reflections;
  uReflLod.value = LOOK.reflLod;
  if (!fl) return;
  const key = `${LOOK.torchCd}|${LOOK.torchCore}|${LOOK.torchSigma2}|${LOOK.torchSpill}|${LOOK.torchShelf}|${LOOK.torchTail}|${LOOK.torchAngle}|${LOOK.torchPenumbra}|${LOOK.torchKelvin}`;
  if (key !== beamKey) {
    beamKey = key;
    uTorchCore.value = LOOK.torchCore;
    uTorchSigma2.value = Math.max(1e-4, LOOK.torchSigma2);
    uTorchSpill.value = LOOK.torchSpill;
    uTorchShelf.value = Math.min(0.94, LOOK.torchShelf);
    uTorchTail.value = LOOK.torchTail;
    fl.intensity = LOOK.torchCd;
    fl.light.angle = (LOOK.torchAngle * Math.PI) / 180;
    fl.light.penumbra = LOOK.torchPenumbra;
    const c = kelvinToLinearRGB(LOOK.torchKelvin || TORCH_KELVIN);
    fl.light.color.setRGB(c[0], c[1], c[2]);
    if (bounce) bounce.flux = beamFlux(LOOK.torchCd, LOOK.torchCore, uTorchSigma2.value, LOOK.torchSpill, uTorchShelf.value, fl.light.angle, LOOK.torchPenumbra, LOOK.torchTail);
  }
  if (bounce) bounce.scale = LOOK.bounce;
}

/** The current beam flux in lumens (look API / docs). */
export function torchFlux(): number {
  return beamFlux(LOOK.torchCd, LOOK.torchCore, Math.max(1e-4, LOOK.torchSigma2), LOOK.torchSpill, Math.min(0.94, LOOK.torchShelf), (LOOK.torchAngle * Math.PI) / 180, LOOK.torchPenumbra, LOOK.torchTail);
}
