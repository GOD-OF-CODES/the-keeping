"""Unique baked character textures.

Pipeline (per character atlas):
  1. atlas_uv(): smart-project every object's UVMap, scale islands by importance (hands/feet/eye get more texels),
     pack all objects into one atlas.
  2. bake_geometry(): Cycles bakes per object into float images — POSITION (object = world, identity transforms),
     object-space NORMAL, AO — giving each texel its 3D point, normal, occlusion and an object mask.
  3. Material functions (tex_*.py, numpy + lib/noise.py) turn those per-texel samples into linear albedo, roughness
     and a height field. Everything is evaluated in 3D, so patterns run continuously across UV seams.
  4. bake_normal(): height -> Bump node -> Cycles NORMAL (tangent space, MikkTSpace) = the shipped normal map.
  5. save_tiers(): albedo (sRGB) + roughness in alpha -> <char>_albedo.<ext>; normal -> <char>_normal.<ext>,
     2048 (max) / 1024 (medium) / 512 (low), box-downsampled.
"""
import math
from pathlib import Path

import bpy
import numpy as np

from lib.scene import log, select, setup_cycles

TIERS = {'max': 1, 'medium': 2, 'low': 4}


# ------------------------------------------------------------------------------------------------ UVs
def atlas_uv(objs, importance, margin=0.003, angle=66.0):
    """objs: list of mesh objects; importance: {obj.name: texel-density scale}."""
    for ob in objs:
        uvm = ob.data.uv_layers.get('UVMap') or ob.data.uv_layers.new(name='UVMap')
        ob.data.uv_layers.active = uvm
    select(objs, objs[0])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    # smart_project normalises each object; rescale by true surface area * importance so texel density is even
    for ob in objs:
        me = ob.data
        uv = me.uv_layers['UVMap']
        area3d = sum(p.area for p in me.polygons)
        co = np.empty(len(uv.data) * 2)
        uv.data.foreach_get('uv', co)
        co = co.reshape(-1, 2)
        a2 = 0.0
        for p in me.polygons:
            idx = range(p.loop_start, p.loop_start + p.loop_total)
            pts = co[list(idx)]
            x, y = pts[:, 0], pts[:, 1]
            a2 += 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))
        s = math.sqrt(area3d / max(a2, 1e-12)) * importance.get(ob.name, 1.0)
        log(f'uv: {ob.name} area3d {area3d:.4f} m2, uv area {a2:.4f}, scale {s:.3f}, uv span {co.min(0)}..{co.max(0)}')
        uv.data.foreach_set('uv', (co * s).ravel())
    select(objs, objs[0])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    import time as _t
    t0 = _t.time()
    # CONCAVE + free rotation + 0.003 margin (6 px at 2048, 1.5 px at the 512 Low tier; islands are dilated):
    # Harlan 33 % -> 42 % fill (blender/characters/uvpack_check.py); CONVEX/0.004 was the old setting
    bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, rotate_method='ANY', scale=True,
                            margin_method='FRACTION', margin=margin, shape_method='CONCAVE')
    log(f'uv pack (CONCAVE): {_t.time() - t0:.1f} s')
    bpy.ops.object.mode_set(mode='OBJECT')


# ------------------------------------------------------------------------------------------------ bakes
def _float_image(name, size):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, size, size, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(np.zeros(size * size * 4, np.float32))
    return img


def _read(img):
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def _with_target(objs, img, fn):
    added = []
    for ob in objs:
        if not ob.data.materials:
            ob.data.materials.append(bpy.data.materials.new(ob.name + '_m'))
        for mat in ob.data.materials:
            nt = mat.node_tree
            n = nt.nodes.new('ShaderNodeTexImage')
            n.name = '__bake_target'
            n.image = img
            nt.nodes.active = n
            added.append((mat, n))
    try:
        return fn()
    finally:
        for mat, n in added:
            mat.node_tree.nodes.remove(n)


def bake_pass(objs, size, kind, samples=1, normal_space='OBJECT'):
    img = _float_image('__bake_' + kind, size)
    select(objs, objs[0])
    sc = bpy.context.scene
    sc.cycles.samples = samples

    def run():
        kw = dict(type=kind, width=size, height=size, margin=0, use_clear=True, target='IMAGE_TEXTURES',
                  save_mode='INTERNAL', uv_layer='UVMap')
        if kind == 'NORMAL':
            kw.update(normal_space=normal_space, normal_r='POS_X', normal_g='POS_Y', normal_b='POS_Z')
        r = bpy.ops.object.bake(**kw)
        if r != {'FINISHED'}:
            raise RuntimeError(f'bake {kind} failed')
    _with_target(objs, img, run)
    a = _read(img)
    bpy.data.images.remove(img)
    return a


def uv_coverage(ob, size, grow=1):
    """Rasterise the object's UVMap triangles into a (size, size) bool mask (rows bottom-up)."""
    me = ob.data
    me.calc_loop_triangles()
    uv = me.uv_layers['UVMap']
    co = np.empty(len(uv.data) * 2)
    uv.data.foreach_get('uv', co)
    co = co.reshape(-1, 2) * size - 0.5
    tri = np.empty(len(me.loop_triangles) * 3, np.int64)
    me.loop_triangles.foreach_get('loops', tri)
    T = co[tri.reshape(-1, 3)]
    mask = np.zeros((size, size), bool)
    lo = np.floor(T.min(1)).astype(int)
    hi = np.ceil(T.max(1)).astype(int)
    for (a, b, c), (x0, y0), (x1, y1) in zip(T, lo, hi):
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, size - 1), min(y1, size - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-12:
            continue
        l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
        l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
        l3 = 1 - l1 - l2
        e = -0.02
        m = (l1 >= e) & (l2 >= e) & (l3 >= e)
        mask[ys[m], xs[m]] = True
    for _ in range(grow):
        m2 = mask.copy()
        m2[1:] |= mask[:-1]
        m2[:-1] |= mask[1:]
        m2[:, 1:] |= mask[:, :-1]
        m2[:, :-1] |= mask[:, 1:]
        mask = m2
    return mask


def bake_uv_attr(ob, size, layer):
    """Bake a second UV layer's coordinates (as emission) into texels of UVMap."""
    tmp = bpy.data.materials.new('__uv_bake')
    nt = tmp.node_tree
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    em = nt.nodes.new('ShaderNodeEmission')
    uvn = nt.nodes.new('ShaderNodeUVMap')
    uvn.uv_map = layer
    nt.links.new(uvn.outputs['UV'], em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    saved = list(ob.data.materials)
    ob.data.materials.clear()
    ob.data.materials.append(tmp)
    try:
        a = bake_pass([ob], size, 'EMIT')
    finally:
        ob.data.materials.clear()
        for m in saved:
            ob.data.materials.append(m)
        bpy.data.materials.remove(tmp)
    return a


def bake_geometry(objs, size, ao_samples=16):
    """Per object: position, object normal, AO and coverage. Returns dict name -> (mask, P, N, AO) texel arrays
    (flattened over the covered texels) plus the index arrays into the (size, size) image (rows bottom-up)."""
    setup_cycles(1, device='CPU')
    out = {}
    for ob in objs:
        pos = bake_pass([ob], size, 'POSITION')
        nrm = bake_pass([ob], size, 'NORMAL', normal_space='OBJECT')
        out[ob.name] = {'pos': pos, 'nrm': nrm}
        if ob.data.uv_layers.get('Fabric') is not None:
            out[ob.name]['fab'] = bake_uv_attr(ob, size, 'Fabric')
    if ao_samples:
        setup_cycles(ao_samples, device='GPU')
        ao = bake_pass(objs, size, 'AO', samples=ao_samples)
    else:
        ao = None
    res = {}
    for ob in objs:
        pos = out[ob.name]['pos']
        m = uv_coverage(ob, size) & (np.abs(pos[..., :3]).sum(-1) > 0)
        idx = np.nonzero(m)
        P = pos[..., :3][idx].astype(np.float64)
        N = out[ob.name]['nrm'][..., :3][idx].astype(np.float64)
        N = N * 2.0 - 1.0 if N.min() >= 0 else N
        N /= np.maximum(np.linalg.norm(N, axis=1), 1e-9)[:, None]
        A = ao[..., 0][idx].astype(np.float64) if ao is not None else np.ones(len(P))
        res[ob.name] = dict(idx=idx, P=P, N=N, AO=A)
        if 'fab' in out[ob.name]:
            res[ob.name]['F'] = out[ob.name]['fab'][..., :2][idx].astype(np.float64)
        log(f'tex: {ob.name} covers {len(P)} texels')
    return res


# ------------------------------------------------------------------------------------------------ assembly
def compose(size, layers):
    """layers: list of (idx, albedo (n,3) linear, rough (n,), height (n,)). Returns full images + coverage."""
    alb = np.zeros((size, size, 3))
    rough = np.full((size, size), 0.6)
    height = np.zeros((size, size))
    cov = np.zeros((size, size), bool)
    for idx, a, r, h in layers:
        alb[idx] = a
        rough[idx] = r
        height[idx] = h
        cov[idx] = True
    return alb, rough, height, cov


def dilate(arr, cov, iters=12):
    """Grow covered texels into the gutter (8-neighbour mean), any channel count."""
    a = arr.copy()
    if a.ndim == 2:
        a = a[..., None]
    filled = cov.copy()
    h, w = cov.shape
    for _ in range(iters):
        if filled.all():
            break
        acc = np.zeros_like(a)
        cnt = np.zeros((h, w))
        fp = np.pad(filled, 1)
        ap = np.pad(a, ((1, 1), (1, 1), (0, 0)))
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                m = fp[1 + dy:1 + dy + h, 1 + dx:1 + dx + w]
                acc += ap[1 + dy:1 + dy + h, 1 + dx:1 + dx + w] * m[..., None]
                cnt += m
        grow = (~filled) & (cnt > 0)
        a[grow] = acc[grow] / cnt[grow][:, None]
        filled |= grow
    return a[..., 0] if arr.ndim == 2 else a


def linear_to_srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def bake_normal(objs, height, size, strength=1.0, distance=0.002, samples=4):
    """Tangent-space normal map from our height image via Cycles' Bump node (MikkTSpace tangents)."""
    himg = bpy.data.images.new('__height', size, size, alpha=False, float_buffer=True)
    himg.colorspace_settings.name = 'Non-Color'
    rgba = np.ones((size, size, 4), np.float32)
    rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = height.astype(np.float32)
    himg.pixels.foreach_set(rgba.ravel())
    saved = {}
    tmp = bpy.data.materials.new('__normal_bake')
    nt = tmp.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = himg
    tex.interpolation = 'Cubic'
    uvn = nt.nodes.new('ShaderNodeUVMap')
    uvn.uv_map = 'UVMap'
    nt.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = strength
    bump.inputs['Distance'].default_value = distance
    nt.links.new(tex.outputs['Color'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    for ob in objs:
        saved[ob.name] = [m for m in ob.data.materials]
        ob.data.materials.clear()
        ob.data.materials.append(tmp)
    setup_cycles(samples, device='CPU')
    try:
        a = bake_pass(objs, size, 'NORMAL', samples=samples, normal_space='TANGENT')
    finally:
        for ob in objs:
            ob.data.materials.clear()
            for m in saved[ob.name]:
                ob.data.materials.append(m)
        bpy.data.materials.remove(tmp)
        bpy.data.images.remove(himg)
    return a[..., :3]


def downsample(a, f):
    if f == 1:
        return a
    h, w = a.shape[:2]
    return a.reshape(h // f, f, w // f, f, *a.shape[2:]).mean((1, 3))


def write_png_optimal(arr, path, alpha):
    """Lossless 8-bit PNG straight from numpy with the smallest encoding we can get without extra tools: the
    best of the five PNG row filters per row (min sum |residual|, libpng's heuristic) + zlib level 9. Blender's
    img.save() uses compression 15 with a fixed filter: the 2048^2 arms normal map shrinks 4.95 -> 4.14 MB
    (identical pixels). arr: (H, W, C) 0..1, rows bottom-up (flipped to PNG's top-down here)."""
    import struct
    import zlib
    c = 4 if alpha else 3
    a = np.ones((*arr.shape[:2], 4), np.float32)
    a[..., :arr.shape[2]] = arr
    px = np.clip(np.floor(a[::-1, :, :c] * 255.0 + 0.5), 0, 255).astype(np.int16)
    h, w = px.shape[:2]
    cur = px.reshape(h, w * c)
    up = np.vstack([np.zeros((1, w * c), np.int16), cur[:-1]])
    left = np.hstack([np.zeros((h, c), np.int16), cur[:, :-c]])
    ul = np.hstack([np.zeros((h, c), np.int16), up[:, :-c]])
    pa, pb, pc = np.abs(up - ul), np.abs(left - ul), np.abs(left + up - 2 * ul)
    paeth = np.where((pa <= pb) & (pa <= pc), left, np.where(pb <= pc, up, ul))
    res = np.stack([cur, cur - left, cur - up, cur - ((left + up) >> 1), cur - paeth]) & 255     # (5, h, w*c)
    cost = np.where(res < 128, res, 256 - res).sum(axis=2)                                       # (5, h)
    best = cost.argmin(axis=0)
    rows = res[best, np.arange(h)].astype(np.uint8)
    raw = np.hstack([best.astype(np.uint8)[:, None], rows]).tobytes()

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6 if alpha else 2, 0, 0, 0)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    Path(path).write_bytes(data)
    return len(data)


def save_png(arr, path, alpha=True):
    """arr: (H, W, 3|4) values 0..1 already encoded (sRGB colour / raw data), rows bottom-up."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == '.png':
        return write_png_optimal(arr, path, alpha)
    h, w = arr.shape[:2]
    img = bpy.data.images.new('__save', w, h, alpha=alpha, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :arr.shape[2]] = arr
    img.pixels.foreach_set(np.clip(rgba, 0, 1).ravel())
    img.filepath_raw = str(path)
    fmt = 'WEBP' if path.suffix == '.webp' else 'PNG'
    img.file_format = fmt
    sc = bpy.context.scene
    if fmt == 'WEBP':
        # lossless-ish quality for data maps is controlled via the scene image settings used by save_render
        s = sc.render.image_settings
        s.file_format = 'WEBP'
        s.color_mode = 'RGBA' if alpha else 'RGB'
        s.quality = 92
        img.save_render(str(path), scene=sc)
    else:
        img.save()
    bpy.data.images.remove(img)
    return path.stat().st_size


def save_tiers(name, albedo_rgba, normal_rgb, outdir_fn, ext_color='webp', ext_normal='png', tiers=None):
    """albedo_rgba: sRGB-encoded rgb + roughness alpha (0..1); normal_rgb: 0..1 tangent normal."""
    sizes = {}
    for tier, f in (tiers or TIERS).items():
        d = outdir_fn(tier)
        a = downsample(albedo_rgba, f)
        n = downsample(normal_rgb, f)
        nl = n * 2 - 1
        nl /= np.maximum(np.linalg.norm(nl, axis=-1, keepdims=True), 1e-6)
        n = nl * 0.5 + 0.5
        sizes[tier] = (save_png(a, d / f'{name}_albedo.{ext_color}', alpha=True),
                       save_png(n, d / f'{name}_normal.{ext_normal}', alpha=False))
    return sizes
