"""UV2 ('Lightmap' layer, exported as TEXCOORD_1 -> three `uv1`) and multi-object atlas packing.

Padding is sized for the SMALLEST tier the atlas ships at: `pad_texels` texels at `smallest_px` is
pad_texels / smallest_px in UV units (pack_islands margin_method='FRACTION'). At larger tiers the same gap is
proportionally more texels, and the bake margin (px, at the bake size) must fill at least half of it.
"""
import bmesh
import bpy
import numpy as np

from .scene import select

LIGHTMAP = 'Lightmap'


def margin_fraction(pad_texels=4, smallest_px=1024):
    return pad_texels / float(smallest_px)


def ensure_uvmap(ob):
    """Make sure the first UV layer ('UVMap', TEXCOORD_0) exists; smart-project it if the mesh has none."""
    me = ob.data
    if len(me.uv_layers) == 0:
        me.uv_layers.new(name='UVMap')
        me.uv_layers.active = me.uv_layers[0]
        select([ob])
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=1.15192, island_margin=0.0, correct_aspect=True, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    return me.uv_layers[0]


def add_lightmap_uv(objs, pad_texels=4, smallest_px=1024, method='smart', angle_limit=1.15192, shape='AABB'):
    """Create/replace the Lightmap layer on every object and pack them together into ONE atlas.

    method='smart': multi-object edit mode smart_project -> average_islands_scale -> pack_islands (verified 0 overlap).
    method='lightmap': uv.lightmap_pack PACK_IN_ONE (fast, for boxes).
    shape: pack_islands shape_method. 'AABB' is instant; 'CONVEX'/'CONCAVE' run an iterative optimiser that took
    6-11 s on 4 boxes and 80 s on the S4 room (docs/SMOKE.md S4) — use them only for organic props.
    Returns stats {'uv_min','uv_max'}. active_render stays on UVMap.
    """
    frac = margin_fraction(pad_texels, smallest_px)
    for ob in objs:
        ensure_uvmap(ob)
        me = ob.data
        old = me.uv_layers.get(LIGHTMAP)
        if old:
            me.uv_layers.remove(old)
        lm = me.uv_layers.new(name=LIGHTMAP)
        me.uv_layers.active = lm
        me.uv_layers[0].active_render = True
    select(objs)
    if method == 'lightmap':
        bpy.ops.uv.lightmap_pack(PREF_CONTEXT='ALL_FACES', PREF_PACK_IN_ONE=True, PREF_NEW_UVLAYER=False,
                                 PREF_BOX_DIV=12, PREF_MARGIN_DIV=max(0.05, frac * 50))
    else:
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.context.scene.tool_settings.use_uv_select_sync = True
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=angle_limit, margin_method='FRACTION', island_margin=frac,
                                 rotate_method='AXIS_ALIGNED_Y', area_weight=0.0, correct_aspect=True,
                                 scale_to_bounds=False)
        bpy.ops.uv.average_islands_scale()
        bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, rotate_method='ANY', scale=True,
                                merge_overlap=False, margin_method='FRACTION', margin=frac, pin=False,
                                shape_method=shape)
        bpy.ops.object.mode_set(mode='OBJECT')
    for ob in objs:
        ob.data.uv_layers.active = ob.data.uv_layers[0]
    return uv_stats(objs)


def uv_stats(objs, layer=LIGHTMAP):
    lo, hi = [1e9, 1e9], [-1e9, -1e9]
    for ob in objs:
        uv = ob.data.uv_layers[layer].uv
        a = np.empty(len(uv) * 2, np.float32)
        uv.foreach_get('vector', a)
        a = a.reshape(-1, 2)
        lo = np.minimum(lo, a.min(0)).tolist()
        hi = np.maximum(hi, a.max(0)).tolist()
    return {'uv_min': [round(v, 4) for v in lo], 'uv_max': [round(v, 4) for v in hi]}


def remove_faces(ob, predicate):
    """Delete faces whose (world-space centre, world normal) satisfy predicate — e.g. outer shell faces nobody sees."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    mw = ob.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    dead = [f for f in bm.faces if predicate(mw @ f.calc_center_median(), (nm @ f.normal).normalized())]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bm.to_mesh(me)
    bm.free()
    return len(dead)
