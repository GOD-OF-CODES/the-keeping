"""Job `head-lab` (manual, escape fix round 2): fast look at Ada's head anatomy WITHOUT the full characters build.
Meshes the body SDF (body.anatomy, Ada style) only in a box around the head + upper neck at --h (default 1.5 mm),
paints tex_ada.skin + tex_head.head as vertex colours (albedo only; the height detail needs the real bake), and
renders a 4-view sheet at 0.8 m / 50 mm under one point key (the parlor lamp's 12 cd scaled by --key) + a dim fill.

  node scripts/assets.mjs --only head-lab --job-args="--h 0.0015 --out scratch/c2e/fr2/lab1.png"
Args: --h <m>  --out <png>  --clay 1 (grey clay, no paint)  --kelvin <K, default 4300: neutral key for shape/albedo>
"""
import math
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

from lib.scene import REPO, job_args, log, reset, result
from characters import body, review, skeleton, tex_ada, tex_head

ARGS = job_args()
H = float(ARGS.get('h') or 0.0015)
OUT = Path(ARGS.get('out') or (REPO / 'scratch' / 'c2e' / 'fr2' / 'headlab.png'))


def main():
    reset()
    from characters import ada
    bones = skeleton.body_bones(ada.P)
    J = body.joints(bones)
    fn = ada.with_wound(body.anatomy(ada.P, J, ada.S), J)
    F = fn.face
    hc = np.asarray(F['hc'], float)
    lo = hc - np.array([0.13, 0.15, 0.24])
    hi = hc + np.array([0.13, 0.14, 0.14])
    ob = body.sdf_object(fn, lo, hi, H, 'head_lab', log=log)
    me = ob.data
    P, _ = body.mesh_arrays(me)
    N = body.normals(me)
    log(f'head-lab: {len(me.polygons)} faces at h {H * 1000:.1f} mm')
    if not ARGS.get('clay'):
        AO = np.ones(len(P))
        base = tex_ada.skin(P, N, AO, J, fn.wound_center)
        alb, rough, h = tex_head.head(P, N, AO, F, base)
    else:
        alb = np.tile([0.30, 0.32, 0.36], (len(P), 1))
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    rgba = np.ones((len(P), 4))
    rgba[:, :3] = alb
    col.data.foreach_set('color', rgba.ravel())
    m = bpy.data.materials.new('lab')
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    at = nt.nodes.new('ShaderNodeAttribute')
    at.attribute_name = 'Col'
    nt.links.new(at.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.42
    b.inputs['Subsurface Weight'].default_value = 0.15
    b.inputs['Subsurface Radius'].default_value = (0.004, 0.002, 0.0015)
    me.materials.append(m)
    review.cycles((560, 640), samples=int(ARGS.get('samples') or 48))
    sc = bpy.context.scene
    kel = float(ARGS.get('kelvin') or 4300)
    face = hc + np.array([0.0, -0.07, -0.035])

    def light(name, loc, watts, k):
        ld = bpy.data.lights.new(name, 'POINT')
        ld.energy = watts
        ld.shadow_soft_size = 0.02
        ld.use_nodes = True
        bb = ld.node_tree.nodes.new('ShaderNodeBlackbody')
        bb.inputs[0].default_value = k
        em = next(n for n in ld.node_tree.nodes if n.type == 'EMISSION')
        ld.node_tree.links.new(bb.outputs[0], em.inputs['Color'])
        o = bpy.data.objects.new(name, ld)
        sc.collection.objects.link(o)
        o.location = Vector(tuple(loc))
    # the key: 1.0 m from the face, 40 deg to her right and 30 deg up (the lamp on the stool, the head at the table)
    a = math.radians(-40)
    key = face + np.array([math.sin(a), -math.cos(a), 0.0]) * 0.95 + np.array([0, 0, 0.5])
    light('key', key, 12.0 * 4 * math.pi * float(ARGS.get('key') or 1.5), kel)
    light('fill', face + np.array([0.6, -0.8, -0.1]), 12.0 * 4 * math.pi * 0.6, 3300)
    sc.view_settings.exposure = float(ARGS.get('ev') or -1.0)
    views = []
    for lab, az in (('front 10', 10), ('3q 40', 40), ('3q R 35', -35), ('profile', 85)):
        r = math.radians(az)
        eye = face + np.array([math.sin(r), -math.cos(r), 0.0]) * float(ARGS.get('dist') or 0.42) + np.array([0, 0, 0.03])
        views.append((lab, tuple(eye), tuple(face), 50))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    review.sheet(views, OUT)
    result({'job': 'head-lab', 'ok': True, 'faces': len(me.polygons), 'out': str(OUT)})


main()
