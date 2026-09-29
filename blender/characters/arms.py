"""First-person arms: leather driving gloves, rain-dark wool coat sleeves, and a steel two-cell flashlight gripped
in the left hand. Origin = the camera; +Y is the view direction (three: -Z). See skeleton.ARMS.

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
STYLE = dict(finger_r=0.0098, fem=False)
FL_LEN = 0.245


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
        S = dict(finger_r=STYLE['finger_r'])
        parts.append(mesher.bounded(body.hand_sdf(J, side, S), hb.min(0) - 0.03, hb.max(0) + 0.03))

    def fn(X):
        d = parts[0](X)
        for p in parts[1:]:
            d = sdf.smin(d, p(X), 0.014)
        return d
    return fn


def build_gloves(fn, J):
    from .harlan import build_gloves as hg
    return hg(fn, J, name='arms_gloves', thick=0.0016, cuff_len=0.06, cuff_flare=0.004, h=0.0022, tris=12000)


def build_sleeves(fn, J):
    objs = []
    for side in ('l', 'r'):
        ua0, ua1 = J[f'upperarm_{side}']
        fa0, fa1 = J[f'forearm_{side}']
        ax = (fa1 - fa0) / np.linalg.norm(fa1 - fa0)
        cut = fa1 - ax * 0.035                      # the coat cuff covers the glove cuff by ~2.5 cm
        lo = np.minimum(ua0, fa1) - 0.12
        hi = np.maximum(ua0, fa1) + 0.12

        def sl(X, cut=cut, ax=ax, ua0=ua0, fa1=fa1):
            along = (X - fa1) @ ax
            ease = 0.017 + 0.004 * np.clip((-along - 0.1) / 0.2, 0, 1)
            d = fn(X) - ease
            d = sdf.smax(d, (X - cut) @ ax, 0.004)                     # open at the cuff
            d = sdf.smax(d, -((X - ua0) @ _n(ua1 - ua0)) + 0.05, 0.01)  # stop inside the shoulder (off screen)
            return d
        ob = body.sdf_object(sl, lo, hi, 0.004, f'arms_sleeve_{side}')
        me = ob.data
        kill = [p.index for p in me.polygons if abs((np.array(p.center) - cut) @ ax) < 0.004 and np.array(p.normal) @ ax > 0.6]
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.faces[i] for i in kill], context='FACES')
        bm.to_mesh(me)
        bm.free()
        garments.decimate(ob, min(1.0, 2600 / max(1, 2 * len(ob.data.polygons))))
        Pk, _ = body.mesh_arrays(ob.data)
        # heavy wool folds: rings bunching at the elbow crook and above the cuff
        t = ((Pk - fa0) @ ax)
        folds = 0.004 * np.sin(t * 95 + 3 * noise.fbm(Pk * 12, 2, 81)) * np.exp(-((t + 0.02) / 0.09) ** 2)
        folds += 0.003 * noise.fbm(Pk * np.array([14, 14, 14.0]), 3, 82)
        garments.displace_normal(ob, folds)
        garments.solidify(ob, 0.004, offset=-1.0)
        objs.append(ob)
    return join(objs, 'arms_sleeves')


def _n(v):
    return v / np.linalg.norm(v)


def lathe(profile, axis_o, axis_d, segs, name):
    """profile: [(t along axis m, radius m)] -> closed surface of revolution."""
    d = _n(np.asarray(axis_d, float))
    ref = _n(np.cross(d, [0, 0, 1.0]))
    ref2 = np.cross(d, ref)
    verts, faces = [], []
    for t, r in profile:
        for k in range(segs):
            th = 2 * math.pi * k / segs
            verts.append(np.asarray(axis_o) + d * t + r * (ref * math.cos(th) + ref2 * math.sin(th)))
    n = len(profile)
    for i in range(n - 1):
        for k in range(segs):
            a, b = i * segs + k, i * segs + (k + 1) % segs
            faces.append((a, b, b + segs, a + segs))
    return garments.new_object(name, [tuple(v) for v in verts], faces)


def build_flashlight():
    C = np.array(P['flash_center'])
    F = _n(np.array(P['flash_dir']))
    tail = C - F * 0.085
    # two D cells: 34 mm tube; head bell 58 mm; tail cap with a ring
    prof = [(0.0, 0.0), (0.0, 0.012), (0.003, 0.017), (0.008, 0.0195), (0.03, 0.0195), (0.031, 0.0182), (0.034, 0.0178),
            (0.036, 0.0178), (0.037, 0.0186), (0.17, 0.0186), (0.175, 0.021), (0.19, 0.0235), (0.215, 0.0285),
            (0.225, 0.0292), (0.235, 0.0292), (0.236, 0.027), (0.237, 0.024), (0.232, 0.0235), (0.228, 0.0)]
    body_ = lathe(prof, tail, F, 28, 'arms_flashlight')
    # slide switch on top (toward the thumb)
    up = _n(np.cross(F, np.cross([0, 0, 1.0], F)) * -1) if False else np.array([0, 0, 1.0])
    up = _n(up - F * up.dot(F))
    sw_c = tail + F * 0.15 + up * 0.0195
    side = _n(np.cross(F, up))
    verts, faces = [], []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                verts.append(sw_c + F * sx * 0.012 + side * sy * 0.005 + up * sz * 0.003)
    for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        faces.append(f)
    sw = garments.new_object('arms_switch', [tuple(v) for v in verts], faces, smooth=False)
    # lanyard ring at the tail
    ring_c = tail - F * 0.006 + up * 0.0
    rv, rf = [], []
    for i in range(16):
        a = 2 * math.pi * i / 16
        c = ring_c + (up * math.cos(a) + (-F) * math.sin(a) * 0.8) * 0.008 - F * 0.004
        for k in range(5):
            b = 2 * math.pi * k / 5
            rv.append(c + (side * math.cos(b) + (up * math.cos(a) - F * math.sin(a)) * math.sin(b)) * 0.0012)
    for i in range(16):
        for k in range(5):
            a0, a1 = i * 5 + k, i * 5 + (k + 1) % 5
            b0, b1 = ((i + 1) % 16) * 5 + k, ((i + 1) % 16) * 5 + (k + 1) % 5
            rf.append((a0, a1, b1, b0))
    ring = garments.new_object('arms_ring', [tuple(v) for v in rv], rf)
    fl = join([body_, sw, ring], 'arms_flashlight')
    lens_c = tail + F * 0.232
    return fl, tail, lens_c, F


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
    sleeves = build_sleeves(fn, J)
    fl, tail, lens_c, F = build_flashlight()
    bones.append(skeleton.B('flashlight', tail, tail + F * 0.12, 'hand_l', flex=(0, 0, 1)))
    bones.append(skeleton.B('flashlight_beam', lens_c, lens_c + F * 0.05, 'flashlight', flex=(0, 0, 1), deform=False))
    rig_ob = skeleton.build_armature('arms_rig', bones)
    # weights: heat on a watertight proxy of the arms (limb SDF), transfer to gloves/sleeves
    lo = np.min([p for h, t in J.values() for p in (h, t)], axis=0) - 0.1
    hi = np.max([p for h, t in J.values() for p in (h, t)], axis=0) + 0.1
    proxy = body.sdf_object(fn, lo, hi, 0.004, 'arms_proxy')
    garments.decimate(proxy, min(1.0, 30000 / max(1, 2 * len(proxy.data.polygons))))
    core = [b.name for b in skeleton.arms_bones(P) if b.deform]
    rig.auto_weights(proxy, rig_ob, only=core)
    empty = rig.check_groups(proxy, rig_ob, core)
    if empty:
        log(f'WARNING arms bone heat left empty groups: {empty}')
    for ob in (gloves, sleeves):
        rig.transfer_weights(proxy, ob, core)
    for g in list(fl.vertex_groups):
        fl.vertex_groups.remove(g)
    gr = fl.vertex_groups.new(name='flashlight')
    gr.add(list(range(len(fl.data.vertices))), 1.0, 'REPLACE')
    for ob in (gloves, sleeves, fl):
        rig.cleanup(ob, rig_ob)
        rig.bind(ob, rig_ob)
    bpy.data.objects.remove(proxy)
    return dict(rig=rig_ob, gloves=gloves, sleeves=sleeves, flashlight=fl, fn=fn, J=J, lens=lens_c, F=F, tail=tail)


def build_all(material, bake_atlas):
    from characters import tex_arms
    from .harlan import bake_size
    R = build()
    ctx = dict(J=R['J'], lens=R['lens'], F=R['F'], tail=R['tail'])
    keys = ['gloves', 'sleeves', 'flashlight']
    shaders = {R[k].name: tex_arms.shader(k, ctx) for k in keys}
    importance = {'arms_gloves': 2.5, 'arms_sleeves': 1.0, 'arms_flashlight': 3.0}
    bake_atlas('arms', [R[k] for k in keys], importance, shaders, bake_size())
    spec = {'gloves': 'leather_worn', 'sleeves': 'wool_coats', 'flashlight': 'chrome_pitted'}
    mats = {}
    for k in keys:
        mats[k] = material(f'arms_{k}', spec[k], 'arms', extras={'lens': 1} if k == 'flashlight' else None)
        R[k].data.materials.clear()
        R[k].data.materials.append(mats[k])
    return R, mats
