"""Lightmap encoding per tier (container/channel/resolution decisions: docs/SMOKE.md S2).

Arrays are (H, W, 4) float32, rows bottom -> top (Blender pixel order), alpha = coverage mask (1 covered texel,
0 gutter). Every container keeps that row order:
  * KLM (primary, ours): gzip( 16-byte header + half-float payload ), planar channels, byte planes (all low bytes,
    then all high bytes), byte-wise delta — the same trick as EXR ZIP — optionally with the half mantissa rounded
    to N bits (bounded relative error 2^-(N+1)). Decoded with DecompressionStream('gzip') + a tiny JS loop
    (reference decoder: decodeKlm() in blender/tests/check_exr.mjs). Extension '.klm' (NOT .gz: static servers
    may add Content-Encoding: gzip and fetch() would transparently inflate it).
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


def klm_bytes(rgba, mantissa_bits=10, channels=3):
    """Encode to the KLM container (see module doc). Returns the gzip'd bytes."""
    h, w = rgba.shape[:2]
    a = np.clip(rgba[..., :channels], 0.0, 65000.0).astype('<f2')
    planar = np.ascontiguousarray(a.transpose(2, 0, 1)).view('<u2')
    if mantissa_bits < 10:
        drop = 10 - mantissa_bits
        planar = (((planar.astype(np.uint32) + (1 << (drop - 1))) >> drop) << drop).astype('<u2')
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


def save_klm(rgba, path, mantissa_bits=10, channels=3):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(klm_bytes(rgba, mantissa_bits, channels))
    return path.stat().st_size


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


# Per-tier lightmap policy (decided in docs/SMOKE.md S2 from measured sizes). The base bake happens at the Max
# size; lower tiers are coverage-weighted downsamples of it. container 'klm' | 'exr'.
TIER_POLICY = {
    'max': {'size': 2048, 'container': 'klm', 'mantissa_bits': 10},     # lossless half, ~7.1 MB / atlas (S4 room)
    'medium': {'size': 2048, 'container': 'klm', 'mantissa_bits': 7},   # <= 0.39 % rel. error, ~3.7 MB / atlas
    'low': {'size': 1024, 'container': 'klm', 'mantissa_bits': 7},      # ~1.0 MB / atlas
}


def encode_tiers(rgba, atlas_id, out_root, policy=None, intensity=None):
    """Write <out_root>/<tier>/lm_<atlas_id>.<klm|exr> + lm_<atlas_id>.json sidecar per tier.

    Returns [{tier, path, bytes}]. `intensity` is the runtime lightMapIntensity (S3: pi).
    """
    policy = policy or TIER_POLICY
    base = rgba.shape[0]
    written = []
    cache = {}
    for tier, p in policy.items():
        size = min(p['size'], base)
        if size not in cache:
            cache[size] = downsample(rgba, base // size)
        img = cache[size]
        d = Path(out_root) / tier
        if p['container'] == 'exr':
            f = d / f'lm_{atlas_id}.exr'
            n = save_exr(img, f, p.get('codec', 'ZIP'), 'RGB')
        elif p['container'] == 'klm':
            f = d / f'lm_{atlas_id}.klm'
            n = save_klm(img, f, p.get('mantissa_bits', 10), 3)
        else:
            raise ValueError(p['container'])
        sidecar(d / f'lm_{atlas_id}.json', atlas=atlas_id, tier=tier, width=size, height=size,
                container=p['container'], codec=p.get('codec'), mantissaBits=p.get('mantissa_bits'), channels=3,
                intensity=intensity, stats=stats(img), file=f.name)
        written.append({'tier': tier, 'path': str(f), 'bytes': n})
    return written
