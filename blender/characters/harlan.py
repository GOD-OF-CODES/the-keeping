"""Harlan Stroud — big, stooped (1.88 m), sixties. Burlap feed sack over his head (STROUD FEED & SEED, uneven
eyeholes, twine at the neck), red buffalo-check flannel with rolled sleeves, leather suspenders, black rubber apron,
rubber knee boots, leather work gloves, hog cleaver. His face is never rendered: under the sack is a dark void.

Runtime chains: sack_0..3 (sack skirt below the twine), apron_l/r_01..02. Prop bone: cleaver (child of hand_r).
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

from lib import noise
from lib.scene import log, select
from . import body, garments, mesher, rig, sdf, sim, skeleton

P = skeleton.HARLAN
S = body.STYLE_HARLAN
WAIST_Z = 1.05
BOOT_TOP = 0.44
SLEEVE_T = 0.42            # rolled sleeves end at this fraction of the forearm


def starts(arr, pre):
    return np.array([str(x).startswith(pre) for x in arr])


# ------------------------------------------------------------------------------------------------ clothes
def shell(full, fn, J, mask, name, offset, fold_amp=0.004, fold_freq=(7.0, 7.0, 16.0), seed=1, decimate=0.2):
    ob = garments.extract(full, mask, name)
    garments.decimate(ob, decimate)
    garments.project_offset(ob, fn, offset)
    Pk, _ = body.mesh_arrays(ob.data)
    amp = fold_amp * noise.fbm(Pk * np.array(fold_freq), 3, seed) + 0.5 * fold_amp * (noise.ridged(Pk * 20.0, 3, seed + 1) - 0.5)
    garments.displace_normal(ob, amp)
    return ob


def labels(full, J):
    Pv, _ = body.mesh_arrays(full.data)
    core = [n for n in J if n != 'root']
    lab, t, _ = garments.nearest_bone(Pv, J, core)
    return Pv, np.array(core)[lab], t


def build_shirt(full, fn, J, Pv, name, t):
    z = Pv[:, 2]
    torso = np.isin(name, ['hips', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'clavicle_l', 'clavicle_r'])
    arm = starts(name, 'upperarm') | (starts(name, 'forearm') & (t < SLEEVE_T))
    mask = (torso & (z > WAIST_Z - 0.07) & (z < 1.585)) | arm

    def off(X):
        o = np.full(len(X), 0.011)
        for side in ('l', 'r'):
            a, b = J[f'forearm_{side}']
            ab = b - a
            tt = ((X - a) @ ab) / ab.dot(ab)
            d = sdf.norm(X - (a + np.clip(tt, 0, 1)[:, None] * ab))
            near = d < 0.09
            # rolled cuff: a thick roll over the last 7 cm of the sleeve
            roll = np.exp(-((tt - (SLEEVE_T - 0.09)) / 0.07) ** 2)
            o = np.where(near & (tt > -0.3), 0.012 + 0.012 * roll, o)
        # blouses over the belly a little, tucked at the waist
        o += 0.006 * np.clip((X[:, 2] - WAIST_Z) / 0.1, 0, 1) * np.clip((1.3 - X[:, 2]) / 0.2, 0, 1)
        return o
    return shell(full, fn, J, mask, 'harlan_shirt', off, fold_amp=0.005, seed=86)


def build_trousers(full, fn, J, Pv, name, t):
    z = Pv[:, 2]
    legs = np.isin(name, ['hips', 'spine_01']) | starts(name, ('thigh', 'calf'))
    mask = legs & (z > BOOT_TOP - 0.1) & (z < WAIST_Z + 0.03)

    def off(X):
        return 0.013 + 0.006 * np.clip((0.62 - X[:, 2]) / 0.15, 0, 1)       # bunched over the boot tops
    return shell(full, fn, J, mask, 'harlan_trousers', off, fold_amp=0.006, fold_freq=(9, 9, 14), seed=31)


def sdf_part(fn, lo, hi, h, name, target_tris):
    ob = body.sdf_object(fn, lo, hi, h, name)
    garments.decimate(ob, min(1.0, target_tris / max(1, sum(len(p.vertices) - 2 for p in ob.data.polygons))))
    return ob


def build_boots(fn, J):
    lo = np.array([-0.25, -0.35, -0.02])
    hi = np.array([0.25, 0.25, BOOT_TOP + 0.02])

    def boot(X):
        d = fn(X) - 0.012
        # toe box: fill between the toes, square the front a little
        d = sdf.smax(d, X[:, 2] - BOOT_TOP, 0.004)
        # welted sole slab, 18 mm, slightly wider than the upper
        sole = np.full(len(X), 1e3)
        for side in ('l', 'r'):
            a = J[f'foot_{side}'][0]
            b = J[f'toe_{side}'][1]
            heel = np.array([a[0], a[1] + 0.045, 0.0])
            toe = np.array([b[0], b[1] - 0.004, 0.0])
            sole = np.minimum(sole, sdf.limb(X, heel, toe, [0, 0, 1], [(0, 0.012, 0.012, 0.046, 0.046), (0.7, 0.012, 0.012, 0.056, 0.058), (1.0, 0.012, 0.012, 0.045, 0.047)], power=3.0) )
        sole = sdf.smax(sole, -X[:, 2] - 0.0, 0.002)
        return sdf.smin(sdf.smax(d, -X[:, 2] + 0.016, 0.003), sole, 0.006)
    return sdf_part(boot, lo, hi, 0.004, 'harlan_boots', 7000)


def build_gloves(fn, J, name='harlan_gloves', thick=0.003, cuff_len=0.075, cuff_flare=0.01, h=0.0025, tris=9000):
    parts = []
    for side in ('l', 'r'):
        wr, a, n, l, L = body.hand_axes(J, side)
        fa0, fa1 = J[f'forearm_{side}']
        ax = (fa1 - fa0) / np.linalg.norm(fa1 - fa0)
        cut = wr - ax * cuff_len
        pts = np.array([p for nm, (h0, t0) in J.items() if nm.endswith('_' + side)
                        and nm.startswith(('thumb', 'index', 'middle', 'ring', 'pinky', 'hand')) for p in (h0, t0)] + [cut])
        lo, hi = pts.min(0) - 0.035, pts.max(0) + 0.035

        def g(X, cut=cut, ax=ax, wr=wr):
            along = (X - wr) @ ax              # < 0 up the forearm
            flare = cuff_flare * np.clip(-along / cuff_len, 0, 1) ** 1.5
            d = fn(X) - thick - flare
            return sdf.smax(d, -((X - cut) @ ax), 0.002)
        parts.append(sdf_part(g, lo, hi, h, f'{name}_{side}', tris // 2))
    return join(parts, name)


def build_apron(fn, J):
    shirt_fn = lambda X: fn(X) - 0.011
    ap = garments.curtain(shirt_fn, (-0.26, 0.26), (0.5, 1.43), 30, 56, front_offset=0.02, slack=0.0035,
                          width_fn=lambda s: 0.62 + 0.38 * np.clip((s - 0.1) / 0.3, 0, 1) if True else 1.0,
                          name='harlan_apron')
    # bib narrower at the top: already via width_fn (s: 0 top -> 1 bottom)
    Pk, E = body.mesh_arrays(ap.data)
    # heavy rubber: gentle vertical waves and a curl at the hem
    wave = 0.006 * np.sin(Pk[:, 0] * 23.0 + 1.3) * np.clip((1.05 - Pk[:, 2]) / 0.4, 0, 1)
    Pk[:, 1] -= wave + 0.02 * np.clip((0.56 - Pk[:, 2]) / 0.06, 0, 1) ** 2
    body.set_positions(ap.data, Pk)
    garments.solidify(ap, 0.003, offset=1.0)
    # neck strap and waist ties
    top = Pk[Pk[:, 2] > 1.42]
    xl, xr = top[:, 0].max(), top[:, 0].min()
    yt = top[:, 1].mean()
    strap_pts = [np.array([xl - 0.01, yt, 1.43]), np.array([0.07, -0.04, 1.6]), np.array([0.05, 0.08, 1.63]),
                 np.array([0.0, 0.1, 1.6]), np.array([-0.05, 0.08, 1.63]), np.array([-0.07, -0.04, 1.6]),
                 np.array([xr + 0.01, yt, 1.43])]
    sp, sn = garments.surface_path(fn, strap_pts, 0.016, samples=40)
    strap = garments.ribbon(sp, sn, 0.022, 'harlan_apron_strap', thickness=0.003)
    ties = []
    for s in (1, -1):
        w = Pk[(np.abs(Pk[:, 2] - WAIST_Z) < 0.02)]
        xe = w[:, 0].max() if s > 0 else w[:, 0].min()
        pts = [np.array([xe, w[:, 1].mean(), WAIST_Z]), np.array([s * 0.2, 0.0, WAIST_Z]), np.array([s * 0.12, 0.13, WAIST_Z]),
               np.array([0.0, 0.14, WAIST_Z])]
        tp, tn = garments.surface_path(fn, pts, 0.017, samples=24)
        ties.append(garments.ribbon(tp, tn, 0.018, f'harlan_tie_{s}', thickness=0.002))
    # the knot's hanging ends
    knot = np.array([0.0, 0.16, WAIST_Z])
    for s in (1, -1):
        pts = np.array([knot + np.array([s * 0.01 * k, 0.005 * k, -0.04 * k]) for k in range(7)])
        nr = np.tile(np.array([0, 1.0, 0]), (len(pts), 1))
        ties.append(garments.ribbon(pts, nr, 0.016, f'harlan_tail_{s}', thickness=0.002))
    return join([ap, strap] + ties, 'harlan_apron')


def build_suspenders(fn, J):
    straps = []
    for s in (1, -1):
        pts = [np.array([s * 0.1, -0.3, WAIST_Z + 0.02]), np.array([s * 0.11, -0.3, 1.3]), np.array([s * 0.12, -0.1, 1.5]),
               np.array([s * 0.1, 0.1, 1.5]), np.array([s * 0.04, 0.3, 1.3]), np.array([-s * 0.07, 0.3, WAIST_Z + 0.02])]
        sp, sn = garments.surface_path(lambda X: fn(X) - 0.011, pts, 0.0045, samples=60)
        straps.append(garments.ribbon(sp, sn, 0.034, f'harlan_susp_{s}', thickness=0.0035))
    return join(straps, 'harlan_suspenders')


# ------------------------------------------------------------------------------------------------ sack
def build_sack(fn, J, collider=None):
    """The feed sack, sculpted as an implicit surface: the head inflated by the loose burlap, the slack closed end
    flopping over the crown with its sewn seam and two dog-ear corners, gathered by twine at the neck, the mouth
    of the sack flaring over the collar. Mesh: surface nets -> folds/pleats -> open skirt (bottom cap removed)."""
    hc = fn.head_center
    neck_z = J['neck_02'][0][2] + 0.012
    Hh = S['head']['height']
    top = hc + np.array([0.0, 0.03, Hh * 0.95])
    ear_l = top + np.array([0.16, -0.01, -0.045])
    ear_r = top + np.array([-0.15, 0.015, -0.06])
    skirt_z = neck_z - 0.065

    def sack(X):
        z = X[:, 2]
        off = 0.004 + 0.014 * np.clip((z - neck_z) / 0.06, 0, 1)
        d = fn.head(X) - off
        nk = sdf.round_cone(X, np.array([hc[0], hc[1] + 0.02, neck_z - 0.01]), hc + np.array([0, 0.0, -0.04]), 0.07, 0.085)
        d = sdf.smin(d, nk, 0.03)
        # the slack closed end: a flattened lump across the crown, seam along X, corners as dog ears
        lump = sdf.ellipsoid(X, top + np.array([0, 0.0, -0.01]), (0.17, 0.075, 0.05))
        d = sdf.smin(d, lump, 0.04)
        d = sdf.smin(d, sdf.capsule(X, ear_l, top + np.array([0.06, 0, 0.02]), 0.016), 0.025)
        d = sdf.smin(d, sdf.capsule(X, ear_r, top + np.array([-0.06, 0, 0.015]), 0.015), 0.025)
        d = sdf.smin(d, sdf.capsule(X, ear_l + np.array([0.01, 0, 0.0]), ear_r + np.array([-0.01, 0, 0.0]) , 0.004), 0.006)
        # gathered at the twine, then the mouth of the sack flares over the collar
        tw = sdf.round_cone(X, np.array([hc[0], hc[1] + 0.005, neck_z]), np.array([hc[0], hc[1] + 0.005, neck_z + 0.001]), 0.078, 0.078)
        cone = sdf.round_cone(X, np.array([hc[0], hc[1] + 0.02, skirt_z]), np.array([hc[0], hc[1] + 0.005, neck_z - 0.005]), 0.118, 0.08)
        d = sdf.smax(d, -(X[:, 2] - neck_z + 0.004), 0.0)          # above the twine only...
        d = sdf.smin(d, sdf.smin(tw, cone, 0.01), 0.008)          # ...plus the tie and the skirt
        return sdf.smax(d, skirt_z - X[:, 2], 0.002)
    lo = hc - np.array([0.3, 0.2, 0.3])
    hi = hc + np.array([0.3, 0.2, 0.25])
    lo[2] = skirt_z - 0.03
    ob = body.sdf_object(sack, lo, hi, 0.0035, 'harlan_sack')
    # open the mouth: drop the flat bottom cap
    me = ob.data
    kill = [p.index for p in me.polygons if p.center.z < skirt_z + 0.004 and p.normal.z < -0.6]
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in kill], context='FACES')
    bm.to_mesh(me)
    bm.free()
    garments.decimate(ob, min(1.0, 6500 / max(1, 2 * len(ob.data.polygons))))
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.dissolve_degenerate(bm, dist=0.0005, edges=bm.edges)
    bm.to_mesh(ob.data)
    bm.free()
    me = ob.data
    # burlap folds: broad slack wrinkles over the head, tight pleats radiating from the twine
    Pk, E = body.mesh_arrays(me)
    th = np.arctan2(Pk[:, 0] - hc[0], -(Pk[:, 1] - hc[1]))
    dz = Pk[:, 2] - neck_z
    pleat = 0.0035 * np.sin(th * 13 + 2.0 * noise.fbm(Pk * 20, 2, 71)) * np.exp(-(dz / 0.03) ** 2)
    slack = 0.006 * noise.fbm(Pk * np.array([9.0, 9.0, 6.0]), 3, 72) * np.clip((dz - 0.04) / 0.05, 0, 1)
    sag = 0.004 * (noise.ridged(Pk * 14, 3, 73) - 0.5)
    garments.displace_normal(ob, pleat + slack + sag)
    me = ob.data
    # fabric coordinates for weave + stencil: u around (0 = front centre), v metres down from the crown
    uvm = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    uvf = me.uv_layers.new(name='Fabric')
    Pk, _ = body.mesh_arrays(me)
    for p in me.polygons:
        for li in range(p.loop_start, p.loop_start + p.loop_total):
            q = Pk[me.loops[li].vertex_index]
            u = (math.atan2(q[0] - hc[0], -(q[1] - hc[1])) / (2 * math.pi)) % 1.0
            uvf.data[li].uv = (u, top[2] + 0.02 - q[2])
    return ob, neck_z


def cut_eyeholes(sack, fn, rng):
    hc = fn.head_center
    B = S['head']['breadth']
    me = sack.data
    Pk, _ = body.mesh_arrays(me)
    kill = np.zeros(len(me.polygons), bool)
    eyes = [(hc + np.array([s * B * 0.44, 0, -S['head']['height'] * 0.12]), r) for s, r in ((1, 0.021), (-1, 0.017))]
    cen = np.array([p.center for p in me.polygons])
    for e, r in eyes:
        d2 = np.sqrt((cen[:, 0] - e[0]) ** 2 + ((cen[:, 2] - e[2]) * 1.25) ** 2)
        ang = np.arctan2(cen[:, 2] - e[2], cen[:, 0] - e[0])
        rag = r * (1 + 0.28 * np.sin(ang * 3 + rng.uniform(0, 6)) + 0.18 * np.sin(ang * 7 + rng.uniform(0, 6)))
        kill |= (d2 < rag) & (cen[:, 1] < hc[1] - 0.02)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in np.nonzero(kill)[0]], context='FACES')
    bm.to_mesh(me)
    bm.free()
    return eyes


def build_twine(neck_z, fn, J):
    hc = fn.head_center
    c = np.array([hc[0], hc[1] + 0.005, neck_z])
    # gathered sack radius at the twine ~ neck + gather
    r = 0.087
    pts = [c + np.array([r * math.sin(th), -r * math.cos(th) * 0.95, 0.002 * math.sin(3 * th)]) for th in np.linspace(0, 2 * math.pi, 49)]
    knot = c + np.array([0.035, -r * 0.93, -0.004])
    tails = [[knot + np.array([0.004 * k, -0.006 * k, -0.018 * k]) for k in range(8)],
             [knot + np.array([0.012 * k, -0.004 * k, -0.014 * k]) for k in range(7)]]
    objs = [tube(pts, 0.0032, 'harlan_twine_ring', closed=True)]
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.009, location=tuple(knot))
    k = bpy.context.active_object
    k.name = 'harlan_knot'
    objs.append(k)
    for i, t in enumerate(tails):
        objs.append(tube(t, 0.0026, f'harlan_twine_tail{i}'))
    return join(objs, 'harlan_twine')


def tube(pts, r, name, sides=6, closed=False):
    pts = [np.asarray(p, float) for p in pts]
    n = len(pts)
    verts, faces = [], []
    for i in range(n):
        t = pts[(i + 1) % n] - pts[i - 1] if closed else pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        t /= np.linalg.norm(t)
        a = np.cross(t, [0, 0, 1.0])
        if np.linalg.norm(a) < 1e-3:
            a = np.cross(t, [1.0, 0, 0])
        a /= np.linalg.norm(a)
        b = np.cross(t, a)
        for k in range(sides):
            th = 2 * math.pi * k / sides
            verts.append(pts[i] + r * (a * math.cos(th) + b * math.sin(th)))
    rng_ = n if closed else n - 1
    for i in range(rng_):
        j = (i + 1) % n
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((i * sides + k, i * sides + k2, j * sides + k2, j * sides + k))
    return garments.new_object(name, verts, faces)


# ------------------------------------------------------------------------------------------------ cleaver
def build_cleaver(J):
    """Hog cleaver in the right hand's grip: handle across the palm, blade forward/down of the fist."""
    wr, a, n, l, L = body.hand_axes(J, 'r')
    grip = wr + a * 0.085 + n * 0.024
    hdir = l / np.linalg.norm(l)           # handle across the palm, the blade beyond the thumb/index side
    bdir = a                               # blade width toward the knuckles: the edge leads the fist
    edge = np.cross(hdir, bdir)
    edge /= np.linalg.norm(edge)
    verts, faces = [], []

    def box(c, ax, ay, az, hx, hy, hz, taper_edge=0.0):
        base = len(verts)
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    t = hz * (1 - taper_edge if sy > 0 else 1)
                    verts.append(c + ax * sx * hx + ay * sy * hy + az * sz * t)
        for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
            faces.append(tuple(base + i for i in f))
    # handle: 0.13 m, 26x22 mm, rivets are texture
    box(grip, hdir, bdir, edge, 0.068, 0.013, 0.011)
    # blade: 0.28 x 0.11 x 5 mm, thinning to the edge; attached at the handle's front end
    bc = grip + hdir * (0.068 + 0.14) + bdir * 0.03
    box(bc, hdir, bdir, edge, 0.14, 0.055, 0.0026, taper_edge=0.85)
    ob = garments.new_object('harlan_cleaver', [tuple(v) for v in verts], faces, smooth=False)
    return ob, grip, hdir


# ------------------------------------------------------------------------------------------------ helpers
def join(objs, name):
    select(objs, objs[0])
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def set_single(ob, bone):
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    g = ob.vertex_groups.new(name=bone)
    g.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')


def chain_blend(ob, rig_ob, chains, zspan, base_weight=0.25):
    """Lower parts follow the nearest chain (by azimuth/side), blended with their transferred weights."""
    names = [g.name for g in ob.vertex_groups]
    allnames = names + [c for ch in chains.values() for c in ch if c not in names]
    W = rig.weight_arrays(ob, allnames)
    Pk, _ = body.mesh_arrays(ob.data)
    z0, z1 = zspan
    bl = np.clip((z0 - Pk[:, 2]) / (z0 - z1), 0, 1)
    Wc = np.zeros_like(W)
    for key, bones_ in chains.items():
        sel = key(Pk)
        seg = np.clip(bl * len(bones_), 0, len(bones_) - 1e-3).astype(int)
        for i, bn in enumerate(bones_):
            Wc[sel & (seg == i), allnames.index(bn)] = 1.0
    has = Wc.sum(1) > 0
    f = (bl * (1 - base_weight))[:, None] * has[:, None]
    W = W * (1 - f) + Wc * f
    rig.set_weights(ob, allnames, W, limit=4)


# ------------------------------------------------------------------------------------------------ main
def build(log_=log):
    rng = np.random.default_rng(102)
    bones = skeleton.body_bones(P)
    J = body.joints(bones)
    fn = body.anatomy(P, J, S)
    lo, hi = body.body_bounds(J)
    full = body.sdf_object(fn, lo, hi, 0.004, 'harlan_full', log=log_)
    garments.decimate(full, 0.5)
    Pv, name, t = labels(full, J)
    shirt = build_shirt(full, fn, J, Pv, name, t)
    trousers = build_trousers(full, fn, J, Pv, name, t)
    boots = build_boots(fn, J)
    gloves = build_gloves(fn, J)
    apron = build_apron(fn, J)
    susp = build_suspenders(fn, J)
    collider = full.copy()
    collider.data = full.data.copy()
    bpy.context.scene.collection.objects.link(collider)
    garments.decimate(collider, 0.12)
    sack, neck_z = build_sack(fn, J)
    eyes = cut_eyeholes(sack, fn, rng)
    garments.solidify(sack, 0.0022, offset=-1.0)
    twine = build_twine(neck_z, fn, J)
    cleaver, grip, hdir = build_cleaver(J)
    # the void under the sack: his head, rendered pitch black (never a face)
    head_mask = (Pv[:, 2] > neck_z - 0.02)
    void = garments.extract(full, head_mask, 'harlan_void')
    garments.decimate(void, 0.1)
    garments.project_offset(void, fn, -0.004)
    # visible skin: forearms between the rolled cuff and the glove cuff
    fore = starts(name, 'forearm') & (t > SLEEVE_T - 0.12)
    hidden = ~fore
    # ---- rig
    hc = fn.head_center
    for side in ('l', 'r'):
        pass
    bones.append(skeleton.B('cleaver', grip, grip + hdir * 0.1, 'hand_r', flex=(0, 0, 1)))
    for k in range(4):
        ang = 2 * math.pi * k / 4 + math.pi / 4
        d2 = np.array([math.sin(ang), -math.cos(ang), 0.0])
        h0 = np.array([hc[0], hc[1], neck_z]) + d2 * 0.08
        bones.append(skeleton.B(f'sack_{k}', h0, h0 + d2 * 0.05 + np.array([0, 0, -0.07]), 'neck_02', flex=tuple(d2)))
    for s, side in ((1, 'l'), (-1, 'r')):
        a0 = np.array([s * 0.12, -0.27, 0.9])
        bones.append(skeleton.B(f'apron_{side}_01', a0, a0 + np.array([0, -0.01, -0.2]), 'hips', flex=(0, -1, 0)))
        bones.append(skeleton.B(f'apron_{side}_02', a0 + np.array([0, -0.01, -0.2]), a0 + np.array([0, -0.03, -0.38]),
                                f'apron_{side}_01', connect=True, flex=(0, -1, 0)))
    rig_ob = skeleton.build_armature('harlan_rig', bones)
    core = [b.name for b in skeleton.body_bones(P) if b.deform]
    rig.auto_weights(collider, rig_ob, only=core)
    empty = rig.check_groups(collider, rig_ob, core)
    if empty:
        log_(f'WARNING harlan bone heat left empty groups: {empty}')
    body_vis = full
    body_vis.name = 'harlan_body'
    body_vis.data.name = 'harlan_body'
    garments.delete_verts(body_vis, hidden)
    garments.decimate(body_vis, 0.5)
    parts = [body_vis, shirt, trousers, boots, gloves, apron, susp, void, twine]
    for ob in parts:
        rig.transfer_weights(collider, ob, core)
    set_single(sack, 'head')
    # sack skirt below the twine -> sack chains
    Pk, _ = body.mesh_arrays(sack.data)
    names = ['head', 'neck_02'] + [f'sack_{k}' for k in range(4)]
    W = np.zeros((len(Pk), len(names)))
    below = np.clip((neck_z + 0.005 - Pk[:, 2]) / 0.03, 0, 1)
    ang = (np.arctan2(Pk[:, 0] - hc[0], -(Pk[:, 1] - hc[1])) - math.pi / 4) % (2 * math.pi)
    kk = (np.round(ang / (math.pi / 2)).astype(int)) % 4
    W[:, 0] = 1 - below
    for k in range(4):
        W[:, 2 + k] = below * 0.7 * (kk == k)
    W[:, 1] = below * 0.3
    rig.set_weights(sack, names, W)
    set_single(cleaver, 'cleaver')
    chain_blend(apron, rig_ob, {
        (lambda X: X[:, 0] >= 0): ['apron_l_01', 'apron_l_02'],
        (lambda X: X[:, 0] < 0): ['apron_r_01', 'apron_r_02'],
    }, (0.92, 0.5))
    objs = parts + [sack, cleaver]
    for ob in objs:
        rig.cleanup(ob, rig_ob)
        rig.bind(ob, rig_ob)
    bpy.data.objects.remove(collider)
    R = dict(rig=rig_ob, body=body_vis, shirt=shirt, trousers=trousers, boots=boots, gloves=gloves, apron=apron,
             suspenders=susp, sack=sack, twine=twine, void=void, cleaver=cleaver, fn=fn, J=J, eyes=eyes, neck_z=neck_z)
    return R


def build_all(material, bake_atlas):
    from characters import tex_harlan
    R = build()
    fn, J = R['fn'], R['J']
    ctx = dict(fn=fn, J=J, neck_z=R['neck_z'], eyes=R['eyes'])
    keys = ['body', 'shirt', 'trousers', 'boots', 'gloves', 'apron', 'suspenders', 'sack', 'twine', 'void', 'cleaver']
    shaders = {R[k].name: tex_harlan.shader(k, ctx) for k in keys}
    importance = {'harlan_body': 1.4, 'harlan_shirt': 0.9, 'harlan_trousers': 0.6, 'harlan_boots': 0.8, 'harlan_gloves': 1.5,
                  'harlan_apron': 0.8, 'harlan_suspenders': 0.8, 'harlan_sack': 2.2, 'harlan_twine': 0.8,
                  'harlan_void': 0.05, 'harlan_cleaver': 1.6}
    objs = [R[k] for k in keys]
    tex_harlan.prepare(R)
    bake_atlas('harlan', objs, importance, shaders, bake_size(), normal_strength=1.0)
    # the cleaver's wooden handle (tex_harlan.cleaver: within 0.12 m of the wrist) becomes its own mesh so the blade
    # can carry a metal spec (steel_cleaver, metalness 1) and the handle a wood one
    wr = np.asarray(J['hand_r'][0])
    mask = [float(np.linalg.norm(np.asarray(p.center) - wr)) < 0.12 for p in R['cleaver'].data.polygons]
    R['cleaver_handle'] = garments.split_faces(R['cleaver'], mask, 'harlan_cleaver_handle')
    keys = keys + ['cleaver_handle']
    spec = {'body': 'skin_harlan', 'shirt': 'flannel_red', 'trousers': 'trousers_wool', 'boots': 'rubber_black',
            'gloves': 'leather_worn', 'apron': 'rubber_black', 'suspenders': 'leather_worn', 'sack': 'burlap_sack',
            'twine': 'twine_jute', 'void': 'crepe_black', 'cleaver': 'steel_cleaver', 'cleaver_handle': 'wood_furniture_dark'}
    mats = {}
    for k in keys:
        mats[k] = material(f'harlan_{k}', spec[k], 'harlan', double_sided=k in ('sack', 'apron'),
                           extras={'void': 1} if k == 'void' else None)
        R[k].data.materials.clear()
        R[k].data.materials.append(mats[k])
    return R, mats


def bake_size():
    import sys
    from lib.scene import job_args
    return int(job_args().get('tex') or 2048)
