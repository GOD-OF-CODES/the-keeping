"""First-person arms: unlined chestnut leather driving gloves (wrist snap on a strap tab, nickel snaps), heavy wool
overcoat sleeves with a turned hem and two horn cuff buttons, and a 1990s two-D-cell torch (250 mm, knurled black
anodised barrel, 50 mm head, rubber switch boot) gripped in the left hand. Origin = the camera; +Y is the view direction (three: -Z). See skeleton.ARMS.

Bones: root, upperarm/forearm/hand_{l,r} + 3-joint fingers, flashlight (child of hand_l), flashlight_beam (non-deform
helper at the lens, +Y along the beam: attach the SpotLight here).
"""
import math

import bmesh
import bpy
import numpy as np

from lib import noise
from lib.scene import log, select
from . import body, garments, mesher, rig, sdf, skeleton

P = skeleton.ARMS
# sharp_fingers / knuckle_k: close-up readability at 35 mm from 0.4 m (round C: the lead's "hands are blobs")
STYLE = dict(finger_r=0.0098, fem=False, sharp_fingers=True, knuckle_k=1.18)
FL_LEN = 0.250


def limbs_sdf(J):
    """Arm anatomy (no torso): tapered limbs + hands (body.hand_sdf)."""
    parts = []
    for side in ('l', 'r'):
        ua0, ua1 = J[f'upperarm_{side}']
        fa0, fa1 = J[f'forearm_{side}']
        wr, a, n, l, L = body.hand_axes(J, side)
        up = [(0.0, 0.05, 0.053, 0.053, 0.05), (0.5, 0.045, 0.047, 0.046, 0.042), (1.0, 0.036, 0.04, 0.041, 0.038)]
        fo = [(0.0, 0.037, 0.039, 0.041, 0.038), (0.25, 0.04, 0.035, 0.042, 0.039), (0.62, 0.031, 0.026, 0.034, 0.031),
              (0.92, 0.019, 0.017, 0.03, 0.027), (1.0, 0.017, 0.016, 0.029, 0.026), (1.1, 0.01, 0.009, 0.017, 0.015)]
        parts.append(lambda X, a0=ua0, a1=ua1: sdf.limb(X, a0, a1, [0, 0, 1], up))
        parts.append(lambda X, a0=fa0, a1=fa1, nn=n: sdf.limb(X, a0, a1, nn, fo))
        parts.append(lambda X, c=fa0: sdf.sphere(X, c, 0.035))
        hb = np.array([p for nm, (h0, t0) in J.items() if nm.endswith('_' + side)
                       and nm.startswith(('thumb', 'index', 'middle', 'ring', 'pinky', 'hand')) for p in (h0, t0)])
        S = dict(finger_r=STYLE['finger_r'], sharp_fingers=STYLE['sharp_fingers'], knuckle_k=STYLE['knuckle_k'])
        parts.append(mesher.bounded(body.hand_sdf(J, side, S), hb.min(0) - 0.03, hb.max(0) + 0.03))

    def fn(X):
        d = parts[0](X)
        for p in parts[1:]:
            d = sdf.smin(d, p(X), 0.014)
        return d
    return fn


def glove_sdf(fn, J, side, thick=0.0012, cuff_len=0.062, cuff_flare=0.0035):
    """Unlined driving-glove leather (~1 mm calf over a snug fit) as an implicit surface around one hand; the cuff
    ends `cuff_len` up the forearm with a slight flare (the coat sleeve covers its last ~2.7 cm)."""
    wr, a, n, l, L = body.hand_axes(J, side)
    fa0, fa1 = J[f'forearm_{side}']
    ax = _n(fa1 - fa0)
    cut = wr - ax * cuff_len

    def g(X):
        along = (X - wr) @ ax              # < 0 up the forearm
        flare = cuff_flare * np.clip(-along / cuff_len, 0, 1) ** 1.5
        d = fn(X) - thick - flare
        return sdf.smax(d, -((X - cut) @ ax), 0.0015)
    pts = np.array([p for nm, (h0, t0) in J.items() if nm.endswith('_' + side)
                    and nm.startswith(('thumb', 'index', 'middle', 'ring', 'pinky', 'hand')) for p in (h0, t0)] + [cut])
    return g, pts.min(0) - 0.03, pts.max(0) + 0.03


def snap_site(J, side, g):
    """Wrist-strap snap: on the back of the wrist, 1.8 cm above the wrist joint, a little toward the thumb.
    Returns (centre on the glove surface, outward normal, along-hand axis)."""
    wr, a, n, l, L = body.hand_axes(J, side)
    p0 = wr - a * 0.018 - n * 0.03 + l * 0.005
    p = sdf.project(g, p0[None, :], iters=10)[0]
    gr = sdf.gradient(g, p[None, :])[0]
    return p, _n(gr), a


def build_gloves(fn, J):
    parts = []
    for side in ('l', 'r'):
        g, lo, hi = glove_sdf(fn, J, side)
        # 1.1 mm voxels (was 1.7) and 12k tris per glove (was 10k; arms budget 48k tris): knuckle pads, creases, MCP
        # ridge survive the decimation (the finer voxels give it a better source surface).
        ob = body.sdf_object(g, lo, hi, 0.0011, f'arms_gloves_{side}')
        garments.decimate(ob, min(1.0, 12000 / max(1, sum(len(p.vertices) - 2 for p in ob.data.polygons))))
        parts.append(ob)
    return join(parts, 'arms_gloves')


def build_snaps(fn, J):
    """Nickel-plated brass glove snaps (line-24 cap, 15 mm) seated on the wrist tab of each glove."""
    objs = []
    prof = [(0.0, 0.0), (0.0075, 0.0), (0.0077, 0.0004), (0.0074, 0.0008), (0.0066, 0.0011), (0.0062, 0.0016),
            (0.0052, 0.0024), (0.0036, 0.0030), (0.0018, 0.0032), (0.0008, 0.0030), (0.0, 0.0029)]
    for side in ('l', 'r'):
        g, _, _ = glove_sdf(fn, J, side)
        c, nr, a = snap_site(J, side, g)
        ob = lathe([(z, r) for r, z in prof], c - nr * 0.0004, nr, 32, f'arms_snap_{side}')
        objs.append(ob)
    return join(objs, 'arms_glove_snaps')


def sleeve_frame(J, side):
    fa0, fa1 = J[f'forearm_{side}']
    ax = _n(fa1 - fa0)
    cut = fa1 - ax * 0.035                      # the coat cuff covers the glove cuff by ~2.7 cm
    ref = np.array([0, 0, 1.0]) - ax * ax[2]
    ref = _n(ref)
    return fa0, fa1, ax, cut, ref


def build_sleeves(fn, J):
    """Heavy wool overcoat sleeves (~650 g/m2 melton, 3 mm cloth + a turned 4.5 cm hem): a stiff cuff band, soft
    diagonal compression folds up the forearm, the under-sleeve bagging a little under its own weight."""
    objs = []
    for side in ('l', 'r'):
        ua0, ua1 = J[f'upperarm_{side}']
        fa0, fa1, ax, cut, ref = sleeve_frame(J, side)
        lo = np.minimum(ua0, fa1) - 0.12
        hi = np.maximum(ua0, fa1) + 0.12

        def sl(X, cut=cut, ax=ax, ua0=ua0, fa1=fa1):
            along = (X - fa1) @ ax
            ease = 0.016 + 0.005 * np.clip((-along - 0.1) / 0.2, 0, 1)
            # the cuff band (turned hem, interlined) stands a little proud of the forearm and flares 3 mm
            edge = (cut - X) @ ax
            ease += 0.003 * np.clip(1 - edge / 0.045, 0, 1)
            d = fn(X) - ease
            d = sdf.smax(d, (X - cut) @ ax, 0.004)                     # open at the cuff
            d = sdf.smax(d, -((X - ua0) @ _n(ua1 - ua0)) + 0.05, 0.01)  # stop inside the shoulder (off screen)
            return d
        ob = body.sdf_object(sl, lo, hi, 0.0035, f'arms_sleeve_{side}')
        me = ob.data
        kill = [p.index for p in me.polygons if abs((np.array(p.center) - cut) @ ax) < 0.004 and np.array(p.normal) @ ax > 0.6]
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.faces[i] for i in kill], context='FACES')
        bm.to_mesh(me)
        bm.free()
        garments.decimate(ob, min(1.0, 3600 / max(1, 2 * len(ob.data.polygons))))
        Pk, _ = body.mesh_arrays(ob.data)
        Nk = body.normals(ob.data)
        edge = (cut - Pk) @ ax                                   # metres up the sleeve from the opening
        rad = Pk - fa0 - np.outer((Pk - fa0) @ ax, ax)
        ang = np.arctan2(rad @ np.cross(ax, ref), rad @ ref)
        wob = noise.fbm(Pk * 9.0, 3, 81 + (side == 'r'))
        # compression folds: two diagonal families (the cloth spirals as the forearm pronates), soft and uneven
        f1 = np.sin(edge * 2 * math.pi / 0.062 + ang * 1.0 + 2.2 * wob)
        f2 = np.sin(edge * 2 * math.pi / 0.085 - ang * 2.0 + 1.7 * wob + 1.3)
        band = np.clip((edge - 0.05) / 0.03, 0, 1) * np.clip((0.3 - edge) / 0.08, 0, 1)
        folds = band * (0.0032 * np.maximum(f1, -0.4) + 0.0022 * np.maximum(f2, -0.5)) * (0.6 + 0.8 * np.clip(wob + 0.5, 0, 1))
        # the stiff hem band: a 1 mm roll at the fold line 4.5 cm up and a soft bulge where it rests on the glove
        folds += 0.0010 * np.exp(-((edge - 0.045) / 0.004) ** 2) + 0.0012 * np.exp(-((edge - 0.012) / 0.012) ** 2)
        # under-sleeve sag (gravity, -z) and a general lumpiness of heavy cloth
        folds += 0.0025 * np.clip(-Nk[:, 2], 0, 1) * band
        folds += 0.0012 * noise.fbm(Pk * 22.0, 3, 82)
        garments.displace_normal(ob, folds)
        garments.solidify(ob, 0.0045, offset=-1.0)
        objs.append(ob)
    return join(objs, 'arms_sleeves')


def build_buttons(J, sleeves):
    """Two 15 mm dark horn sleeve buttons per cuff on the outer (back) side, 2.5 / 4.5 cm up from the opening
    (an overcoat cuff carries 3; the third hides under the hem fold). Seated by ray-casting onto the sleeve."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(sleeves, dg)
    objs = []
    prof = [(0.0, 0.0), (0.0074, 0.0), (0.0076, 0.0008), (0.0072, 0.0022), (0.0062, 0.0029), (0.0046, 0.0026),
            (0.0030, 0.0022), (0.0, 0.0021)]
    for side in ('l', 'r'):
        fa0, fa1, ax, cut, ref = sleeve_frame(J, side)
        s = -1.0 if side == 'l' else 1.0
        o = np.array([s, 0.0, 0.55])
        out = _n(o - ax * (o @ ax))
        for k, e in enumerate((0.025, 0.045)):
            c0 = cut - ax * e + out * 0.15
            hit, nrm, _, _ = bvh.ray_cast(Vector(c0), Vector(-out))
            if hit is None:
                log(f'arms: button {side}{k} found no sleeve surface')
                continue
            c = np.array(hit)
            nr = _n(np.array(nrm))
            objs.append(lathe([(z, r) for r, z in prof], c - nr * 0.0006, nr, 24, f'arms_button_{side}{k}'))
    return join(objs, 'arms_coat_buttons')


def _n(v):
    return v / np.linalg.norm(v)


def lathe(profile, axis_o, axis_d, segs, name, phase=0.0):
    """profile: [(t along axis m, radius m)] -> surface of revolution; rows with radius 0 become a single pole
    vertex (triangle fans, no degenerate quads)."""
    d = _n(np.asarray(axis_d, float))
    up = np.array([0, 0, 1.0]) if abs(d[2]) < 0.9 else np.array([1.0, 0, 0])
    ref = _n(np.cross(d, up))
    ref2 = np.cross(d, ref)
    verts, faces, rows = [], [], []
    for t, r in profile:
        if r <= 1e-7:
            rows.append([len(verts)])
            verts.append(np.asarray(axis_o) + d * t)
            continue
        row = []
        for k in range(segs):
            th = 2 * math.pi * k / segs + phase
            row.append(len(verts))
            verts.append(np.asarray(axis_o) + d * t + r * (ref * math.cos(th) + ref2 * math.sin(th)))
        rows.append(row)
    for A, B in zip(rows[:-1], rows[1:]):
        if len(A) == 1 and len(B) == 1:
            continue
        for k in range(segs):
            k1 = (k + 1) % segs
            if len(A) == 1:
                faces.append((A[0], B[k], B[k1]))
            elif len(B) == 1:
                faces.append((A[k], A[k1], B[0]))
            else:
                faces.append((A[k], A[k1], B[k1], B[k]))
    return garments.new_object(name, [tuple(v) for v in verts], faces)


# 1990s two-D-cell torch (cf. the 2D Maglite: 254 mm long, 39 mm barrel, 56 mm head; steel Eveready-style heads
# run ~50 mm): 250 mm overall, 38 mm knurled black-anodised aluminium barrel, 50 mm head, rubber switch boot.
FL_PROFILE = [
    # tail cap: flat end with a lanyard boss, chamfer, three grip grooves, O-ring shoulder
    (0.0, 0.0), (0.0, 0.0105), (0.0004, 0.0150), (0.0016, 0.0182), (0.0034, 0.0194), (0.0060, 0.0196),
    (0.0072, 0.0189), (0.0084, 0.0196), (0.0106, 0.0196), (0.0118, 0.0189), (0.0130, 0.0196), (0.0152, 0.0196),
    (0.0164, 0.0189), (0.0176, 0.0196), (0.0280, 0.0196), (0.0290, 0.0193), (0.0296, 0.0187), (0.0312, 0.0187),
    (0.0318, 0.0190),
    # barrel: plain - knurl band (raised 0.25 mm) - plain switch housing
    (0.0440, 0.0190), (0.0446, 0.01925), (0.1470, 0.01925), (0.1476, 0.0190), (0.1640, 0.0190),
    # head: thread collar, grip rings, the flare, knurled bezel ring, front lip
    (0.1660, 0.0193), (0.1672, 0.0198), (0.1700, 0.0198), (0.1712, 0.0193), (0.1740, 0.0198), (0.1768, 0.0198),
    (0.1780, 0.0193), (0.1808, 0.0198), (0.1840, 0.0199), (0.1920, 0.0205), (0.2000, 0.0216), (0.2080, 0.0230),
    (0.2160, 0.0243), (0.2240, 0.0249), (0.2320, 0.0250), (0.2340, 0.0247), (0.2352, 0.0252), (0.2370, 0.0255),
    (0.2470, 0.0255), (0.2492, 0.0251), (0.2500, 0.0243), (0.2499, 0.0228), (0.2490, 0.0224),
    # the lens face (separate mesh): flat glass-covered parabolic reflector down to the krypton bulb
    (0.2480, 0.0222), (0.2440, 0.0190), (0.2390, 0.0150), (0.2340, 0.0105), (0.2300, 0.0068), (0.2285, 0.0046),
    (0.2290, 0.0034), (0.2310, 0.0030), (0.2335, 0.0024), (0.2350, 0.0012), (0.2354, 0.0)]
FL_TOTAL = 0.250
LENS_T_MIN, LENS_R_MAX = 0.2276, 0.02235


def build_flashlight():
    C = np.array(P['flash_center'])
    F = _n(np.array(P['flash_dir']))
    tail = C - F * 0.085
    body_ = lathe(FL_PROFILE, tail, F, 48, 'arms_flashlight')
    up = np.array([0, 0, 1.0])
    up = _n(up - F * up.dot(F))
    side = _n(np.cross(F, up))
    # lanyard ring through a boss on the tail cap
    ring_c = tail - F * 0.0035 + up * 0.0105
    rv, rf = [], []
    for i in range(20):
        a = 2 * math.pi * i / 20
        c = ring_c + (up * math.cos(a) - F * math.sin(a)) * 0.0085
        for k in range(6):
            b = 2 * math.pi * k / 6
            rv.append(c + (side * math.cos(b) + (up * math.cos(a) - F * math.sin(a)) * math.sin(b)) * 0.0011)
    for i in range(20):
        for k in range(6):
            a0, a1 = i * 6 + k, i * 6 + (k + 1) % 6
            b0, b1 = ((i + 1) % 20) * 6 + k, ((i + 1) % 20) * 6 + (k + 1) % 6
            rf.append((a0, a1, b1, b0))
    ring = garments.new_object('arms_ring', [tuple(v) for v in rv], rf)
    boss = lathe([(0.0, 0.0), (0.0, 0.0032), (0.0035, 0.0032), (0.0035, 0.0)], tail + up * 0.0105 + F * 0.0004, -F, 12,
                 'arms_boss')
    fl = join([body_, ring, boss], 'arms_flashlight')
    lens_c = tail + F * 0.236                 # just ahead of the bulb, inside the reflector (beam origin)
    return fl, tail, lens_c, F, up


def build_switch(tail, F, up):
    """The rubber push-switch boot under the thumb: a 15 x 10 mm oval dome, 2.6 mm proud, in a 1 mm collar."""
    side = _n(np.cross(F, up))
    c = tail + F * 0.150
    verts, faces = [], []
    nu, nv = 24, 9
    for j in range(nv + 1):
        s = j / nv                                   # 0 at the rim, 1 at the crown
        for i in range(nu):
            th = 2 * math.pi * i / nu
            ex, ey = 0.0075 * math.cos(th), 0.0050 * math.sin(th)
            rr = (1 - s ** 2) ** 0.5 if j < nv else 0.0
            x, y = ex * (0.35 + 0.65 * rr) if j else ex * 1.12, ey * (0.35 + 0.65 * rr) if j else ey * 1.12
            h = 0.0189 + (0.0004 if j == 0 else 0.0010 + 0.0016 * math.sin(s * math.pi / 2))
            # sit on the barrel's curvature
            r_side = y
            pos = c + F * x + side * r_side + up * (math.sqrt(max(h * h - r_side * r_side, 0.0)))
            verts.append(pos)
    for j in range(nv):
        for i in range(nu):
            a0, a1 = j * nu + i, j * nu + (i + 1) % nu
            faces.append((a0, a1, a1 + nu, a0 + nu))
    top = len(verts)
    verts.append(c + up * (0.0189 + 0.0026))
    for i in range(nu):
        faces.append((nv * nu + i, nv * nu + (i + 1) % nu, top))
    # skirt down into the barrel so no gap shows at the rim
    base = len(verts)
    for i in range(nu):
        th = 2 * math.pi * i / nu
        x, y = 0.0075 * 1.12 * math.cos(th), 0.0050 * 1.12 * math.sin(th)
        verts.append(c + F * x + side * y + up * math.sqrt(max(0.0186 ** 2 - y * y, 0.0)))
    for i in range(nu):
        faces.append((base + i, base + (i + 1) % nu, (i + 1) % nu, i))
    return garments.new_object('arms_flashlight_switch', [tuple(v) for v in verts], faces)


def join(objs, name):
    select(objs, objs[0])
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def build():
    bones = skeleton.arms_bones(P)
    J = body.joints(bones)
    fn = limbs_sdf(J)
    gloves = build_gloves(fn, J)
    snaps = build_snaps(fn, J)
    sleeves = build_sleeves(fn, J)
    buttons = build_buttons(J, sleeves)
    fl, tail, lens_c, F, up = build_flashlight()
    switch = build_switch(tail, F, up)
    bones.append(skeleton.B('flashlight', tail, tail + F * 0.12, 'hand_l', flex=(0, 0, 1)))
    bones.append(skeleton.B('flashlight_beam', lens_c, lens_c + F * 0.05, 'flashlight', flex=(0, 0, 1), deform=False))
    rig_ob = skeleton.build_armature('arms_rig', bones)
    # weights: heat on a watertight proxy of the arms (limb SDF), transfer to gloves/sleeves/snaps/buttons
    lo = np.min([p for h, t in J.values() for p in (h, t)], axis=0) - 0.1
    hi = np.max([p for h, t in J.values() for p in (h, t)], axis=0) + 0.1
    proxy = body.sdf_object(fn, lo, hi, 0.004, 'arms_proxy')
    garments.decimate(proxy, min(1.0, 30000 / max(1, 2 * len(proxy.data.polygons))))
    core = [b.name for b in skeleton.arms_bones(P) if b.deform]
    rig.auto_weights(proxy, rig_ob, only=core)
    empty = rig.check_groups(proxy, rig_ob, core)
    if empty:
        log(f'WARNING arms bone heat left empty groups: {empty}')
    for ob in (gloves, sleeves, snaps, buttons):
        rig.transfer_weights(proxy, ob, core)
    for ob in (fl, switch):
        for g in list(ob.vertex_groups):
            ob.vertex_groups.remove(g)
        gr = ob.vertex_groups.new(name='flashlight')
        gr.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')
    for ob in (gloves, sleeves, snaps, buttons, fl, switch):
        rig.cleanup(ob, rig_ob)
        rig.bind(ob, rig_ob)
    bpy.data.objects.remove(proxy)
    sites = {}
    for side in ('l', 'r'):
        g, _, _ = glove_sdf(fn, J, side)
        sites[side] = snap_site(J, side, g)
    return dict(rig=rig_ob, gloves=gloves, sleeves=sleeves, flashlight=fl, switch=switch, snaps=snaps,
                buttons=buttons, fn=fn, J=J, lens=lens_c, F=F, tail=tail, up=up, sites=sites)


# atlas: 2048^2 baked once; Max AND Medium ship it at 2048 (the arms are on screen all game: the highest texel
# density of anything we ship), Low at 1024.
ARMS_TIERS = {'max': 1, 'medium': 1, 'low': 2}


def build_all(material, bake_atlas):
    from characters import tex_arms
    from .harlan import bake_size
    R = build()
    ctx = dict(J=R['J'], lens=R['lens'], F=R['F'], tail=R['tail'], up=R['up'], sites=R['sites'])
    keys = ['gloves', 'sleeves', 'flashlight', 'switch', 'snaps', 'buttons']
    # texel budget: the sleeve's forearm (on screen) gets 7x the density of the upper sleeve (off screen except in
    # the locket raise): split it for the UV pass, join it back afterwards (UVs survive the join)
    upper = split_upper_sleeve(R['sleeves'], R['J'])
    shaders = {R[k].name: tex_arms.shader(k, ctx) for k in keys}
    shaders[upper.name] = tex_arms.shader('sleeves', ctx)
    importance = {'arms_gloves': 3.6, 'arms_sleeves': 0.8, 'arms_sleeves_upper': 0.15, 'arms_flashlight': 3.8,
                  'arms_flashlight_switch': 3.0, 'arms_glove_snaps': 3.0, 'arms_coat_buttons': 2.0}
    # heights are authored in metres: Bump distance 1.0 turns them into true slopes (0.002 flattened them ~500x)
    bake_atlas('arms', [R[k] for k in keys] + [upper], importance, shaders, bake_size(), tiers=ARMS_TIERS, distance=1.0)
    R['sleeves'] = join([R['sleeves'], upper], 'arms_sleeves')
    spec = {'gloves': 'leather_worn', 'sleeves': 'coat_rain_dark', 'flashlight': 'steel_flashlight',
            'switch': 'rubber_black', 'snaps': 'chrome_pitted', 'buttons': 'wood_furniture_dark'}
    mats = {}
    for k in keys:
        mats[k] = material(f'arms_{k}', spec[k], 'arms')
        R[k].data.materials.clear()
        R[k].data.materials.append(mats[k])
    # the lens/reflector/bulb face inside the bezel becomes its own mesh + material (same atlas UVs), so the runtime
    # can make it emissive when the light is on (material_id lens_flashlight, extras lens/emissive)
    R['flashlight_lens'] = split_lens(R['flashlight'], R['tail'], R['F'])
    mats['flashlight_lens'] = material('arms_flashlight_lens', 'lens_flashlight', 'arms',
                                       extras={'lens': 1, 'emissive': 1, 'emissive_color': [1.0, 0.86, 0.62]})
    R['flashlight_lens'].data.materials.clear()
    R['flashlight_lens'].data.materials.append(mats['flashlight_lens'])
    return R, mats


def split_upper_sleeve(sleeves, J):
    mask = []
    for p in sleeves.data.polygons:
        c = np.array(p.center)
        side = 'l' if c[0] < 0 else 'r'
        fa0, fa1, ax, cut, ref = sleeve_frame(J, side)
        mask.append(float((cut - c) @ ax) > 0.24)
    return garments.split_faces(sleeves, mask, 'arms_sleeves_upper')


def split_lens(fl, tail, F, t_min=LENS_T_MIN, r_max=LENS_R_MAX):
    """Separate the head's inner face (reflector cone + bulb: t > t_min along the beam axis, inside the bezel lip)
    into 'arms_flashlight_lens'."""
    mask = []
    for p in fl.data.polygons:
        c = np.array(p.center)
        t = float((c - tail) @ F)
        r = float(np.linalg.norm(c - tail - F * t))
        mask.append(t > t_min and r < r_max)
    lens = garments.split_faces(fl, mask, 'arms_flashlight_lens')
    log(f'arms: lens split {sum(mask)} faces -> {lens.name}')
    return lens
