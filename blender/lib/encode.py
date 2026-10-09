"""Lightmap encoding per tier (container/channel/resolution decisions: docs/SMOKE.md S2).

Arrays are (H, W, 4) float32, rows bottom -> top (Blender pixel order), alpha = coverage mask (1 covered texel,
0 gutter). Every container keeps that row order:
  * KLM (primary, ours): gzip( 16-byte header + half-float payload ), planar channels, byte planes (all low bytes,
    then all high bytes), byte-wise delta — the same trick as EXR ZIP — optionally with the half mantissa rounded
    to N bits (bounded relative error 2^-(N+1)) and an absolute floor: below 2^-E the values sit on a fixed grid
    of step 2^-(E+N) (the N-bit spacing at 2^-E), so near-black noise that AgX maps to black stops costing bits.
    Both are pure pre-quantization of the half values: the decoder is unchanged (it just reads halves).
    Decoded with DecompressionStream('gzip') + a tiny JS loop (reference decoder: decodeKlm() in
    blender/tests/check_exr.mjs; runtime: src/render/klm.ts). Extension '.klm' (NOT .gz: static servers may add
    Content-Encoding: gzip and fetch() would transparently inflate it).
  * EXR half (verified with three r186 EXRLoader: ZIP/ZIPS/PIZ/PXR24 lossless, DWAA/DWAB/B44 lossy).
  * f16gz: raw little-endian float16 gzip'd (the original fallback idea; ~1.9x larger than KLM).
glTF writes TEXCOORD_1 as (u, 1 - v), so the runtime samples the lightmap at (uv1.x, 1 - uv1.y).

KLM header (little-endian, 16 bytes): 'KLM1' | u16 width | u16 height | u8 channels | u8 mantissaBits |
u8 rowOrder (0 = bottom-up) | u8 layout (1 = planar byte-split delta) | u32 reserved (0).
"""
import gzip
import json
import struct
from pathlib import Path

import bpy
import numpy as np

from .bake import dilate

ROW_ORDER = 'bottom-up'
UV_DECODE = 'vec2(uv1.x, 1 - uv1.y)'


def downsample(rgba, factor):
    """Coverage-weighted box downsample (gutter texels never darken island borders), then re-dilate."""
    if factor == 1:
        return rgba.copy()
    h, w = rgba.shape[:2]
    assert h % factor == 0 and w % factor == 0, (h, w, factor)
    m = rgba[..., 3:4]
    rgb = rgba[..., :3]
    hh, ww = h // factor, w // factor
    msum = m.reshape(hh, factor, ww, factor, 1).sum((1, 3))
    wsum = (rgb * m).reshape(hh, factor, ww, factor, 3).sum((1, 3))
    plain = rgb.reshape(hh, factor, ww, factor, 3).mean((1, 3))
    out = np.empty((hh, ww, 4), np.float32)
    covered = msum[..., 0] > 0
    out[..., :3] = np.where(covered[..., None], wsum / np.maximum(msum, 1e-8), plain)
    out[..., 3] = covered.astype(np.float32)
    return dilate(out, covered, iterations=4)


def _image(rgba, name='__encode'):
    h, w = rgba.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Linear Rec.709'
    img.pixels.foreach_set(np.ascontiguousarray(rgba, np.float32).ravel())
    return img


def save_exr(rgba, path, codec='ZIP', channels='RGB', depth='16'):
    """Write an OpenEXR (half by default) through Blender's writer. Linear data: no view transform is applied
    (proved numerically by the S2 round trip, values up to 8.4 exact)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    sc = bpy.context.scene
    s = sc.render.image_settings
    s.file_format = 'OPEN_EXR'
    s.color_mode = channels
    s.color_depth = depth
    s.exr_codec = codec
    if channels == 'RGB':
        rgba = rgba.copy()
        rgba[..., 3] = 1.0
    img = _image(rgba)
    img.save_render(str(path), scene=sc)
    bpy.data.images.remove(img)
    return path.stat().st_size


def save_f16gz(rgba, path, channels=3, level=9):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = np.ascontiguousarray(rgba[..., :channels]).astype('<f2').tobytes()
    path.write_bytes(gzip.compress(raw, compresslevel=level, mtime=0))
    return path.stat().st_size


def quantize_half(rgb, mantissa_bits=10, floor_exp=None):
    """(H, W, C) float -> (H, W, C) '<f2' pre-quantized for KLM.

    mantissa_bits N < 10: round the half mantissa to N bits (round-half-up on the bit pattern; relative error
    <= 2^-(N+1)). floor_exp E: values < 2^-E are rounded to multiples of 2^-(E+N) instead (absolute error
    <= 2^-(E+N+1)); every such multiple is exactly representable in half. E=None: no floor.
    """
    v = np.clip(np.asarray(rgb, np.float32), 0.0, 65000.0)
    u = v.astype('<f2').view('<u2').astype(np.uint32)
    if mantissa_bits < 10:
        drop = 10 - mantissa_bits
        u = ((u + (1 << (drop - 1))) >> drop) << drop
    out = u.astype('<u2').view('<f2')
    if floor_exp is not None:
        q = np.float32(2.0 ** -(floor_exp + mantissa_bits))
        small = v < np.float32(2.0 ** -floor_exp)
        out = np.where(small, (np.round(v / q) * q).astype('<f2'), out)
    return out.astype('<f2')


def klm_bytes(rgba, mantissa_bits=10, channels=3, floor_exp=None):
    """Encode to the KLM container (see module doc). Returns the gzip'd bytes."""
    h, w = rgba.shape[:2]
    a = quantize_half(rgba[..., :channels], mantissa_bits, floor_exp)
    planar = np.ascontiguousarray(a.transpose(2, 0, 1)).view('<u2')
    b = planar.view(np.uint8).reshape(-1, 2)
    s = np.concatenate([b[:, 0], b[:, 1]])
    d = np.empty_like(s)
    d[0] = s[0]
    d[1:] = s[1:] - s[:-1]  # uint8 wrap-around == mod 256
    header = b'KLM1' + struct.pack('<HHBBBBI', w, h, channels, mantissa_bits, 0, 1, 0)
    return gzip.compress(header + d.tobytes(), compresslevel=9, mtime=0)


def klm_decode(data):
    """Python reference decoder (tests): returns (H, W, C) float32, rows bottom-up."""
    raw = gzip.decompress(data)
    assert raw[:4] == b'KLM1', raw[:4]
    w, h, c, _bits, _order, layout, _ = struct.unpack_from('<HHBBBBI', raw, 4)
    assert layout == 1
    d = np.frombuffer(raw, np.uint8, offset=16)
    s = np.cumsum(d, dtype=np.uint8)  # wraps mod 256
    n = w * h * c
    u16 = s[:n].astype(np.uint16) | (s[n:].astype(np.uint16) << 8)
    return u16.view('<f2').astype(np.float32).reshape(c, h, w).transpose(1, 2, 0)


def save_klm(rgba, path, mantissa_bits=10, channels=3, floor_exp=None):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(klm_bytes(rgba, mantissa_bits, channels, floor_exp))
    return path.stat().st_size


# ---- display-referred QA: three r186 AgX (src/nodes/display/ToneMappingFunctions.js agxToneMapping) ----
def _cols(*c):  # three mat3(vec3 col0, col1, col2) -> row-major numpy matrix
    return np.array(c, np.float64).T


_SRGB_TO_2020 = _cols((0.6274, 0.0691, 0.0164), (0.3293, 0.9195, 0.0880), (0.0433, 0.0113, 0.8956))
_2020_TO_SRGB = _cols((1.6605, -0.1246, -0.0182), (-0.5876, 1.1329, -0.1006), (-0.0728, -0.0083, 1.1187))
_AGX_IN = _cols((0.856627153315983, 0.137318972929847, 0.11189821299995),
                (0.0951212405381588, 0.761241990602591, 0.0767994186031903),
                (0.0482516061458583, 0.101439036467562, 0.811302368396859))
_AGX_OUT = _cols((1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
                 (-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
                 (-0.016493938717834573, -0.016493938717834257, 1.2519364065950405))


def agx_srgb8(rgb):
    """Linear-sRGB radiance (n, 3) -> 8-bit sRGB code values (unrounded floats), exactly as three r186 AgX."""
    c = np.maximum(np.asarray(rgb, np.float64) @ _SRGB_TO_2020.T @ _AGX_IN.T, 1e-10)
    x = np.clip((np.log2(c) + 12.47393) / (4.026069 + 12.47393), 0.0, 1.0)
    x2 = x * x
    x4 = x2 * x2
    c = 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232
    c = np.clip(np.power(np.maximum(c @ _AGX_OUT.T, 0.0), 2.2) @ _2020_TO_SRGB.T, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055) * 255.0


# Runtime envelope (src/render/pipeline.ts + main.ts + cutscene-fx.ts): exposure uniform 1, lightning kick 1.18,
# blue-hour tint up to 1.1 per channel -> 1.3 covers kick x tint.
QA_ALBEDOS = (0.2, 0.5, 0.8)
QA_EXPOSURES = (1.0, 1.18, 1.3)


def display_error(ref_rgb, test_rgb, mask=None, albedos=QA_ALBEDOS, exposures=QA_EXPOSURES, chunk=1 << 20):
    """Display difference (8-bit sRGB code values after three r186 AgX) between two lightmaps, on EVERY covered texel.

    A lightmapped Lambert surface renders texel * albedo * exposure (lightMapIntensity pi cancels the BRDF's 1/pi,
    SMOKE S3). Per albedo, a texel's error is its worst channel over all `exposures`; reported per albedo:
    max, p99, p99.99 and the fraction of texels >= 0.5 code (the only ones that can round to a different 8-bit
    code). Top level: the worst of each over the albedos.
    """
    idx = np.flatnonzero(np.ones(ref_rgb.shape[:2], bool) if mask is None else mask.ravel())
    ref = ref_rgb.reshape(-1, 3)
    test = test_rgb.reshape(-1, 3)
    d = np.zeros((len(albedos), len(idx)), np.float32)
    for s in range(0, len(idx), chunk):
        sl = idx[s:s + chunk]
        a = ref[sl].astype(np.float64)
        b = test[sl].astype(np.float64)
        for i, alb in enumerate(albedos):
            for ex in exposures:
                e = np.abs(agx_srgb8(a * (alb * ex)) - agx_srgb8(b * (alb * ex))).max(1)
                np.maximum(d[i, s:s + chunk], e, out=d[i, s:s + chunk])
    per = {}
    for i, alb in enumerate(albedos):
        di = d[i]
        per[str(alb)] = {'max': round(float(di.max()), 4) if len(di) else 0.0,
                         'p99': round(float(np.percentile(di, 99)), 4) if len(di) else 0.0,
                         'p9999': round(float(np.percentile(di, 99.99)), 4) if len(di) else 0.0,
                         'frac_ge_half': round(float((di >= 0.5).mean()), 7) if len(di) else 0.0}
    out = {'texels': int(len(idx)), 'exposures': list(exposures), 'albedo': per}
    for k in ('max', 'p99', 'p9999', 'frac_ge_half'):
        out[k] = max(v[k] for v in per.values())
    out['max_code'] = out['max']   # back-compat key used by encode_atlases.py
    return out


def stats(rgba):
    m = rgba[..., 3] > 0.5
    v = rgba[..., :3][m] if m.any() else rgba[..., :3].reshape(-1, 3)
    lum = v @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    return {'mean': round(float(lum.mean()), 5), 'p99': round(float(np.percentile(lum, 99)), 5),
            'max': round(float(lum.max()), 5), 'coverage': round(float(m.mean()), 4)}


def sidecar(path, **fields):
    data = {'rowOrder': ROW_ORDER, 'uvDecode': UV_DECODE, 'colorSpace': 'linear', **fields}
    Path(path).write_text(json.dumps(data, indent=2) + '\n')
    return data


# Per-tier lightmap policy (docs/SMOKE.md S2 + "Release lightmap budgets"). The base bake happens at the Max size;
# lower tiers are coverage-weighted downsamples of it. container 'klm' | 'exr'.
# floor_exp 8: below 2^-8 = 0.0039 the step is absolute (2^-(8+N)), so near-black noise that AgX maps to black stops
# costing bits (the house is dark: 42-97 % of texels < 2^-12). Measured by blender/bake/encode_atlases.py on the
# 2048^2 @ 128 spp release atlases, every covered texel, 8-bit sRGB code error after three r186 AgX, albedo
# 0.2/0.5/0.8, worst over exposure 1 / 1.18 / 1.3 (docs/SMOKE.md "Release lightmap budgets"):
#   max    m10 f8: 70.2 MiB for 9 maps (was 90.3)  max 0.027 code, p99 0.021 (= plain float32 -> half rounding)
#   medium m7  f8: 26.5 MiB for 7 maps (was 43.7)  max 0.24 code,  p99 0.18
#   low    m6  f8:  1.6 MiB for 7 maps             max 0.44 code,  p99 0.35
# The encode job fails if any file reaches 0.5 code (the point where a pixel can round to a different 8-bit value).
TIER_POLICY = {
    'max': {'size': 2048, 'container': 'klm', 'mantissa_bits': 10, 'floor_exp': 8},
    'medium': {'size': 2048, 'container': 'klm', 'mantissa_bits': 7, 'floor_exp': 8},
    # Low (25 MB budget for EVERYTHING): 512^2 m6 (<= 0.78 % rel. error). UV2 gutters are 4 texels at 1024 =
    # 2 texels at 512, and the coverage-weighted downsample never mixes islands.
    'low': {'size': 512, 'container': 'klm', 'mantissa_bits': 6, 'floor_exp': 8},
}
# docs/REALISM-BACKLOG.md #9: in the dark atlases (upper floor ~1e-4..1e-3 irradiance, moonlit exterior/car at
# ~0.003-0.03 lux) the floor_exp 8 absolute step (2^-14..2^-18 ~ 6e-5..4e-6) bands once eye adaptation lifts them
# by +4 EV. floor_exp 13 = steps of 2^-(13+N) (1.2e-6 at m6, 1.5e-8 at m10); cost < 3 % in size.
FLOOR_EXP_DARK = {'upper_hall': 13, 'upper_rooms': 13, 'car': 13, 'exterior': 13}


def encode_tiers(rgba, atlas_id, out_root, policy=None, intensity=None, max_resolution=2048, on_written=None):
    """Write <out_root>/<tier>/lm_<atlas_id>.<klm|exr> + lm_<atlas_id>.json sidecar per tier.

    Returns [{tier, path, bytes}]. `intensity` is the runtime lightMapIntensity (S3: pi).
    `max_resolution` (layout atlases[].maxResolution) scales every tier's size by max_resolution / 2048, so a
    1024-max atlas (LM_CAR) ships 1024 / 1024 / 256. A tier is never larger than the bake itself.
    `on_written(tier, source_rgba, path)` is called after each file (QA hook; source = the tier-size float image).
    """
    policy = policy or TIER_POLICY
    if atlas_id in FLOOR_EXP_DARK:
        policy = {t: {**p, 'floor_exp': FLOOR_EXP_DARK[atlas_id]} for t, p in policy.items()}
    base = rgba.shape[0]
    scale = min(1.0, max_resolution / 2048.0)
    written = []
    cache = {}
    for tier, p in policy.items():
        size = min(max(64, int(p['size'] * scale)), base)
        if size not in cache:
            cache[size] = downsample(rgba, base // size)
        img = cache[size]
        d = Path(out_root) / tier
        if p['container'] == 'exr':
            f = d / f'lm_{atlas_id}.exr'
            n = save_exr(img, f, p.get('codec', 'ZIP'), 'RGB')
        elif p['container'] == 'klm':
            f = d / f'lm_{atlas_id}.klm'
            n = save_klm(img, f, p.get('mantissa_bits', 10), 3, p.get('floor_exp'))
        else:
            raise ValueError(p['container'])
        sidecar(d / f'lm_{atlas_id}.json', atlas=atlas_id, tier=tier, width=size, height=size,
                container=p['container'], codec=p.get('codec'), mantissaBits=p.get('mantissa_bits'),
                floorExp=p.get('floor_exp'), channels=3, intensity=intensity, stats=stats(img), file=f.name)
        written.append({'tier': tier, 'path': str(f), 'bytes': n})
        if on_written:
            on_written(tier, img, f)
    return written
