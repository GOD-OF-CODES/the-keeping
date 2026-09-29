"""Lightmap bake: DIFFUSE {DIRECT, INDIRECT} (no COLOR => irradiance / pi, see docs/SMOKE.md S3) into a float image
through the 'Lightmap' UV layer, read back as a numpy array (rows bottom -> top, Blender pixel order).

We bake with margin=0 so alpha marks exactly the covered texels, then dilate ourselves (coverage mask is needed for
the coverage-weighted tier downsample in lib/encode.py anyway) and denoise afterwards with lib/oidn.py.
"""
import time

import bpy
import numpy as np

from . import materials
from .scene import log, select
from .uv2 import LIGHTMAP


def _target_node(mat, img):
    nt = mat.node_tree
    n = nt.nodes.get('__bake_target') or nt.nodes.new('ShaderNodeTexImage')
    n.name = '__bake_target'
    n.image = img
    n.interpolation = 'Closest'
    nt.nodes.active = n
    return n


def bake_atlas(objs, size, uv_layer=LIGHTMAP, name='LM', pass_filter=('DIRECT', 'INDIRECT'), bake_type='DIFFUSE',
               margin=0):
    """Bake all `objs` (ideally ONE joined mesh per atlas) into one size x size float image.

    Returns (rgba float32 array (H, W, 4) bottom-up, info dict with seconds + coverage).
    Samples/device come from lib.scene.setup_cycles().
    """
    img = bpy.data.images.new(name, size, size, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Linear Rec.709'
    zero = np.zeros(size * size * 4, np.float32)
    img.pixels.foreach_set(zero)
    grey = None
    nodes = []
    for ob in objs:
        if not ob.data.materials:
            grey = grey or materials.make('__bake_grey', (0.5, 0.5, 0.5))
            ob.data.materials.append(grey)
        for mat in ob.data.materials:
            if mat is not None:
                nodes.append((mat, _target_node(mat, img)))
    select(objs)
    t0 = time.perf_counter()
    r = bpy.ops.object.bake(type=bake_type, pass_filter=set(pass_filter), width=size, height=size, margin=margin,
                            margin_type='EXTEND', use_clear=True, uv_layer=uv_layer, target='IMAGE_TEXTURES',
                            save_mode='INTERNAL', use_selected_to_active=False)
    secs = time.perf_counter() - t0
    if r != {'FINISHED'}:
        raise RuntimeError(f'bake failed: {r}')
    a = np.empty(size * size * 4, np.float32)
    img.pixels.foreach_get(a)
    a = a.reshape(size, size, 4)
    for mat, n in nodes:
        mat.node_tree.nodes.remove(n)
    bpy.data.images.remove(img)
    cov = float((a[..., 3] > 0.5).mean())
    info = {'size': size, 'bake_seconds': round(secs, 3), 'coverage': round(cov, 4), 'objects': len(objs),
            'samples': bpy.context.scene.cycles.samples, 'device': bpy.context.scene.cycles.device}
    log(f'bake {name} {size}^2 {info["samples"]} spp on {info["device"]}: {secs:.2f} s, coverage {cov:.3f}')
    return a, info


def coverage_mask(rgba):
    return rgba[..., 3] > 0.5


def dilate(rgba, mask=None, iterations=16):
    """Grow covered texels outward by `iterations` px (8-neighbour average of already-filled texels).

    Keeps the original covered texels untouched; alpha of filled texels stays 0 so the mask is recoverable.
    """
    if mask is None:
        mask = coverage_mask(rgba)
    rgb = np.where(mask[..., None], rgba[..., :3], 0.0).astype(np.float32)
    filled = mask.copy()
    h, w = mask.shape
    for _ in range(iterations):
        if filled.all():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros((h, w), np.float32)
        fp = np.pad(filled, 1)
        rp = np.pad(rgb, ((1, 1), (1, 1), (0, 0)))
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                m = fp[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]
                acc += rp[1 + dy:1 + dy + h, 1 + dx:1 + dx + w] * m[..., None]
                cnt += m
        grow = (~filled) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        filled |= grow
    out = np.empty_like(rgba)
    out[..., :3] = rgb
    out[..., 3] = mask.astype(np.float32)
    return out


def fill_empty(rgba, mask_filled=None):
    """Fill every still-empty texel with the mean of covered texels (keeps OIDN / mips away from pure black)."""
    rgb = rgba[..., :3]
    empty = (rgb.sum(-1) == 0) & (rgba[..., 3] < 0.5)
    if empty.any() and (~empty).any():
        rgb[empty] = rgb[~empty].mean(0)
    return rgba
