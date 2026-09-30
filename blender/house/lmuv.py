"""UV2 ('Lightmap' -> TEXCOORD_1) for one atlas, with our own island packer.

1. Every object without a prebuilt projection is smart-projected (multi-object edit mode, no margin) and its islands
   averaged to one texel density (bpy.ops.uv.average_islands_scale).
2. Objects with a prebuilt planar projection in metres (roof courses, clapboard sheet, porch deck / roof: thousands of
   disconnected strips that must stay ONE rigid chart) become a single island each, rescaled to the same density.
3. `lm_weight` (object custom prop) scales an object's texel density.
4. Islands (UV-connected faces) are turned landscape and shelf-packed (next-fit decreasing height) into the unit
   square; the common scale is found by bisection. Gap between islands = `pad_texels` texels of the smallest tier.
bpy.ops.uv.pack_islands(AABB) left ~60 % of the atlas empty on these interiors (thousands of thin moulding strips).
5. `region` (u0, v0, u1, v1) packs into a sub-rectangle: the house packs every atlas into [0, 1 - PROPS_BAND[atlas]]
   (v from the bottom) and the props job (blender/props/lightmap.py) packs that atlas's static props into the band on
   top, so static props share their room's lightmap file, lights and flash maps (docs/PROPS.md "Lightmaps").
"""

# Fraction of each atlas's height reserved for its static props (top band). Measured prop surface areas
# (.cache/props/lightmap.json) vs the house's own texel density decide these; LM_CAR is all props.
PROPS_BAND = {             # tuned so props ~= house texel density (dev run 2026-09-30, texel/m @1024)
    'LM_EXTERIOR': 0.13,      # house 19.8 / props 15.6 at 0.10
    'LM_GROUND': 0.12,        # 32.9 / 64 at 0.20
    'LM_PARLOR': 0.17,        # 53.6 / 47
    'LM_KITCHEN': 0.24,       # 40.0 / 31 at 0.19
    'LM_UPPER_HALL': 0.24,    # 52.7 / 41 at 0.20
    'LM_UPPER_ROOMS': 0.30,   # 37.7 / 35
    'LM_CAR': 1.0,
}


def band_region(atlas):
    """(u0, v0, u1, v1) of the props band of an atlas (Blender UV, v up)."""
    b = PROPS_BAND.get(atlas, 0.0)
    return (0.0, 1.0 - b, 1.0, 1.0)


def house_region(atlas):
    return (0.0, 0.0, 1.0, 1.0 - PROPS_BAND.get(atlas, 0.0))
import math

import bmesh
import bpy
import numpy as np

from lib.scene import log, select
from lib.uv2 import LIGHTMAP


def _uv_array(ob, layer=LIGHTMAP):
    uv = ob.data.uv_layers[layer].data
    a = np.empty(len(uv) * 2, np.float32)
    uv.foreach_get('uv', a)
    return a.reshape(-1, 2)


def _set_uv(ob, arr, layer=LIGHTMAP):
    ob.data.uv_layers[layer].data.foreach_set('uv', np.ascontiguousarray(arr, np.float32).ravel())


def _areas(ob, layer=LIGHTMAP):
    me = ob.data
    a3 = sum(p.area for p in me.polygons)
    uv = _uv_array(ob, layer)
    au = 0.0
    for p in me.polygons:
        pts = uv[list(p.loop_indices)]
        x, y = pts[:, 0], pts[:, 1]
        au += 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))
    return a3, au


def planar_layer(ob, origin, U, V):
    """Write the Lightmap layer as a planar projection (metres) onto the plane (origin, U, V)."""
    me = ob.data
    lay = me.uv_layers.get(LIGHTMAP) or me.uv_layers.new(name=LIGHTMAP)
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3) - np.asarray(origin, np.float32)
    li = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get('vertex_index', li)
    p = co[li]
    uv = np.stack([p @ np.asarray(U, np.float32), p @ np.asarray(V, np.float32)], 1)
    lay.data.foreach_set('uv', uv.ravel())
    me.uv_layers[0].active_render = True
    me.uv_layers.active = me.uv_layers[0]


def _islands(ob):
    """List of loop-index arrays, one per UV island (faces sharing an edge with identical UVs)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uvl = bm.loops.layers.uv[LIGHTMAP]
    bm.faces.ensure_lookup_table()
    parent = list(range(len(bm.faces)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) != 2:
            continue
        f1, f2 = lf
        same = True
        for v in e.verts:
            l1 = next(l for l in f1.loops if l.vert == v)
            l2 = next(l for l in f2.loops if l.vert == v)
            if (l1[uvl].uv - l2[uvl].uv).length_squared > 1e-12:
                same = False
                break
        if same:
            a, b = find(f1.index), find(f2.index)
            if a != b:
                parent[a] = b
    groups = {}
    for f in bm.faces:
        groups.setdefault(find(f.index), []).extend(l.index for l in f.loops)
    bm.free()
    return [np.asarray(g, np.int64) for g in groups.values()]


def _shelf(sizes, order, gap):
    """Next-fit decreasing-height shelves in a strip of width 1. Returns positions and used height."""
    pos = [None] * len(sizes)
    x = y = shelf = 0.0
    for i in order:
        w, h = sizes[i]
        if x > 0 and x + w + gap > 1.0:
            y += shelf + gap
            x = shelf = 0.0
        pos[i] = (x + gap, y + gap)
        x += w + gap
        shelf = max(shelf, h)
    return pos, y + shelf + 2 * gap


def pack_atlas(objs, pad_texels=4, smallest_px=1024, angle_limit=1.15192, region=(0.0, 0.0, 1.0, 1.0),
               max_texels_per_m=None):
    """Pack every object's Lightmap layer into `region` of the unit square. max_texels_per_m (at smallest_px) caps
    the density (a sparse props band would otherwise blow tiny props up)."""
    t_smart = [o for o in objs if not o.get('lm_prebuilt')]
    t_pre = [o for o in objs if o.get('lm_prebuilt')]
    k0 = 1.0
    if t_smart:
        for ob in t_smart:
            me = ob.data
            old = me.uv_layers.get(LIGHTMAP)
            if old:
                me.uv_layers.remove(old)
            lm = me.uv_layers.new(name=LIGHTMAP)
            me.uv_layers.active = lm
            me.uv_layers[0].active_render = True
        select(t_smart)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.context.scene.tool_settings.use_uv_select_sync = True
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=angle_limit, margin_method='FRACTION', island_margin=0.0,
                                 rotate_method='AXIS_ALIGNED_Y', area_weight=0.0, correct_aspect=True,
                                 scale_to_bounds=False)
        bpy.ops.uv.average_islands_scale()
        bpy.ops.object.mode_set(mode='OBJECT')
        a3 = au = 0.0
        for o in t_smart:
            x, y = _areas(o)
            a3 += x
            au += y
        k0 = math.sqrt(a3 / max(au, 1e-12))      # metres per smart-UV unit
    uvs = {}
    islands = []
    for o in t_smart:
        uvs[o.name] = _uv_array(o) * float(o.get('lm_weight', 1.0))
        for g in _islands(o):
            islands.append((o.name, g))
    for o in t_pre:
        uvs[o.name] = _uv_array(o) * (float(o.get('lm_weight', 1.0)) / k0)
        islands.append((o.name, np.arange(len(uvs[o.name]))))
    rects = []
    for name, g in islands:
        p = uvs[name][g]
        lo, hi = p.min(0), p.max(0)
        w, h = float(hi[0] - lo[0]), float(hi[1] - lo[1])
        rot = h > w * 1.05
        rects.append((name, g, lo, rot, (h, w) if rot else (w, h)))
    u0, v0, u1, v1 = region
    RW, RH = u1 - u0, v1 - v0            # pack in a strip of width 1 and height RH / RW, then scale by RW
    lim = RH / RW
    gap = pad_texels / float(smallest_px) / RW
    order = sorted(range(len(rects)), key=lambda i: -rects[i][4][1])
    total = sum(r[4][0] * r[4][1] for r in rects)
    lo_s, hi_s = 1e-6, math.sqrt(lim / max(total, 1e-12))
    if max_texels_per_m:
        hi_s = min(hi_s, max_texels_per_m / smallest_px * k0 / RW * 1.0001)
    best = None
    for _ in range(40):
        s = (lo_s + hi_s) / 2
        sizes = [(r[4][0] * s, r[4][1] * s) for r in rects]
        if max(w for w, h in sizes) + 2 * gap > 1.0:
            hi_s = s
            continue
        pos, used = _shelf(sizes, order, gap)
        if used <= lim:
            lo_s, best = s, (s, pos)
        else:
            hi_s = s
    if best is None:
        raise RuntimeError(f'lmuv: {len(rects)} islands do not fit region {region}')
    s, pos = best
    out = {n: u.copy() for n, u in uvs.items()}
    for (name, g, lo, rot, (w, h)), (px, py) in zip(rects, pos):
        p = uvs[name][g] - lo
        if rot:  # 90 degree rotation, no mirroring
            wid = float(p[:, 0].max())
            p = np.stack([p[:, 1], wid - p[:, 0]], 1)
        out[name][g] = (p * s + np.array([px, py], np.float32)) * RW + np.array([u0, v0], np.float32)
    s = s * RW
    for o in objs:
        _set_uv(o, out[o.name])
        o.data.uv_layers.active = o.data.uv_layers[0]
    fill = total * s * s / (RW * RH)
    tpm = s / k0 * smallest_px
    log(f'lmuv: {len(rects)} islands in {region}, bbox fill {fill:.2f}, {tpm:.1f} texel/m at {smallest_px}')
    return {'islands': len(rects), 'bbox_fill': round(fill, 3), 'texels_per_m_at_1024': round(tpm * 1024 / smallest_px, 2),
            'region': [round(v, 4) for v in region], 'area_m2': round(total * k0 * k0, 2)}
