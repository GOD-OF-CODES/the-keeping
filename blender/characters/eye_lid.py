"""C2-ESCAPE A3 — the eye insert's parts (docs/C2-ESCAPE.md §3.6 'The eye'), first working version.

Naming (K11): `_l` is IMAGE-left = Ada's RIGHT eye, the one visible eye she has always had (fn.socket_r); the other
stays under the hair veil. Parts:
  * an upper eyelid shell joined into `ada_head` (skin material, atlas texels from the skin shader): Basis = CLOSED
    (the margin 30 deg below the eye's horizon), shape key `eyelid_l_open` = open (the lid rolls up about the eye
    centre into the crease, the margin 8 deg above the horizon -> a 2.5 mm peel of the margin over the cornea at
    influence ~0.35, fully open at 1). Runtime (B3): 0 = closed by default, 0 -> 1 over 250 ms at C2 13.6.
  * `ada_cornea_l`: a thin clear shell over the corneal bulge (7.8 mm radius of curvature region of the 11.8 mm
    globe), extras {cornea: 1, ior: 1.376, f0: 0.025, roughness: 0.02} so the lamp's flame gives one sharp specular
    over the milky clouded eye (post-mortem clouding: grey-white 0.55/0.57/0.58, iris ghost 0.45).
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

from lib.scene import log

R_EYE = 0.0118
BULGE = 0.00126           # build_eye: cornea bulge at the apex
LID_R = R_EYE + BULGE + 0.0009
AZ = (-58.0, 58.0)        # lid width (deg, around the eye's vertical axis)
EL_TOP = 52.0             # tucked under the brow skin
EL_CLOSED = -30.0         # margin, closed
EL_OPEN = 8.0             # margin, open (influence 1)
NA, NE = 14, 7


def _sph(c, r, az, el):
    """Sphere point around eye centre c: forward = -y, az toward +x (her left), el up."""
    a, e = math.radians(az), math.radians(el)
    return Vector((c[0] + r * math.sin(a) * math.cos(e), c[1] - r * math.cos(a) * math.cos(e), c[2] + r * math.sin(e)))


def add_lid(head_ob, eye_center):
    """Append the upper-lid shell to head_ob (closed in Basis) and add the `eyelid_l_open` key."""
    c = Vector(tuple(eye_center))
    me = head_ob.data
    if not me.shape_keys:
        head_ob.shape_key_add(name='Basis', from_mix=False)
    bm = bmesh.new()
    bm.from_mesh(me)
    shape_layers = {k: bm.verts.layers.shape.get(k) for k in [kb.name for kb in me.shape_keys.key_blocks]}
    dl = bm.verts.layers.deform.verify()
    gidx = head_ob.vertex_groups['head_root'].index
    rows_closed, rows_open = [], []
    for j in range(NE + 1):
        t = j / NE                                       # 0 = margin .. 1 = top
        el_c = EL_CLOSED + (EL_TOP - EL_CLOSED) * t
        el_o = EL_OPEN + (EL_TOP + 40.0 - EL_OPEN) * t   # rolls up into the crease / under the brow
        rc, ro = [], []
        for i in range(NA + 1):
            az = AZ[0] + (AZ[1] - AZ[0]) * i / NA
            # the lid hugs the globe: a little proud at the cornea, thinner toward the canthi
            r = LID_R - 0.0007 * (abs(az) / AZ[1]) ** 2
            # margin curve: the lid margin is an arc (lower at the centre, up at the canthi)
            lift = 9.0 * (az / AZ[1]) ** 2 * (1.0 - t)
            rc.append(_sph(c, r, az, el_c + lift))
            ro.append(_sph(c, r + 0.0006 * t, az, el_o + lift * 0.6))
        rows_closed.append(rc)
        rows_open.append(ro)
    # margin thickness: one inner row 1 mm under the margin toward the globe
    inner_c = [c + (p - c).normalized() * (R_EYE + BULGE * 0.6 + 0.0002) for p in rows_closed[0]]
    inner_o = [c + (p - c).normalized() * (R_EYE + BULGE * 0.6 + 0.0002) for p in rows_open[0]]
    grid_c = [inner_c] + rows_closed
    grid_o = [inner_o] + rows_open
    V = []
    for row_c, row_o in zip(grid_c, grid_o):
        vr = []
        for pc, po in zip(row_c, row_o):
            v = bm.verts.new(pc)
            v[dl][gidx] = 1.0
            for name, lay in shape_layers.items():
                v[lay] = po if name == 'eyelid_l_open' else pc
            vr.append((v, po))
        V.append(vr)
    faces = []
    for j in range(len(V) - 1):
        for i in range(NA):
            f = bm.faces.new((V[j][i][0], V[j][i + 1][0], V[j + 1][i + 1][0], V[j + 1][i][0]))
            f.smooth = True
            faces.append(f)
    for f in faces:
        n = f.normal
        cen = f.calc_center_median()
        if n.dot(cen - c) < 0:
            f.normal_flip()
    bm.to_mesh(me)
    bm.free()
    kb = me.shape_keys.key_blocks.get('eyelid_l_open') or head_ob.shape_key_add(name='eyelid_l_open', from_mix=False)
    co = np.empty(len(me.vertices) * 3)
    kb.data.foreach_get('co', co)
    co = co.reshape(-1, 3)
    n0 = len(me.vertices) - sum(len(r) for r in V)
    k = n0
    for row in V:
        for _, po in row:
            co[k] = tuple(po)
            k += 1
    kb.data.foreach_set('co', co.ravel())
    me.update()
    log(f'eye_lid: {len(faces)} lid quads on {head_ob.name}, keys {[kb.name for kb in me.shape_keys.key_blocks]}')
    return len(faces)


def add_cornea(eye_ob, eye_center, head_rig, material=None):
    """`ada_cornea_l`: a clear shell 0.25 mm over the bulge (fwd > 0.70), rigid on head_root."""
    c = Vector(tuple(eye_center))
    bm = bmesh.new()
    rings, segs = 6, 24
    top = bm.verts.new(c + Vector((0, -(R_EYE + BULGE + 0.00025), 0)))
    prev = None
    rows = []
    for k in range(1, rings + 1):
        ang = math.radians(44.0) * k / rings           # cos(44 deg) = 0.72: the bulge edge
        fwd = math.cos(ang)
        r = R_EYE + np.clip(fwd - 0.72, 0, None) / 0.28 * BULGE + 0.00025
        row = []
        for i in range(segs):
            phi = 2 * math.pi * i / segs
            d = Vector((math.sin(ang) * math.cos(phi), -fwd, math.sin(ang) * math.sin(phi)))
            row.append(bm.verts.new(c + d * r))
        rows.append(row)
    for i in range(segs):
        bm.faces.new((top, rows[0][i], rows[0][(i + 1) % segs]))
    for k in range(rings - 1):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((rows[k][i], rows[k + 1][i], rows[k + 1][j], rows[k][j]))
    for f in bm.faces:
        f.smooth = True
        if f.normal.dot(f.calc_center_median() - c) < 0:
            f.normal_flip()
    me = bpy.data.meshes.new('ada_cornea_l')
    bm.to_mesh(me)
    bm.free()
    uv = me.uv_layers.new(name='UVMap')
    for lp in me.loops:
        p = me.vertices[lp.vertex_index].co - c
        uv.data[lp.index].uv = (0.5 + p.x / 0.026, 0.5 + p.z / 0.026)
    ob = bpy.data.objects.new('ada_cornea_l', me)
    for col in head_rig.users_collection:
        col.objects.link(ob)
    g = ob.vertex_groups.new(name='head_root')
    g.add(list(range(len(me.vertices))), 1.0, 'REPLACE')
    if material is not None:
        me.materials.append(material)
    mod = ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = head_rig
    ob.parent = head_rig
    ob.matrix_parent_inverse = head_rig.matrix_world.inverted()
    log(f'eye_lid: ada_cornea_l {len(me.polygons)} faces')
    return ob
