"""Dev check: how deep do Ada's legs run through her gown, per clip?

  node blender/characters/dev.mjs blender/characters/gown_check.py [--blend .cache/anims/ada_anim.blend]

For every Ada action: evaluate the skinned gown every frame and measure, for the skirt vertices (below the hips),
the depth inside the leg capsules of anim/clip.py (LEG_CAPSULES, no clearance) BEYOND the rest pose (vertices that
already sit inside a capsule at rest, e.g. where the skirt drapes the thigh, are compared with their rest depth).
Prints per clip: frames with penetration > 5 mm, max depth (cm). Writes .cache/anims/gown_check.json.
"""
import json
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib.scene import CACHE, job_args, log, result  # noqa: E402
from anim.clip import LEG_CAPSULES  # noqa: E402

args = job_args()
blend = Path(args.get('blend', CACHE / 'anims' / 'ada_anim.blend'))
bpy.ops.wm.open_mainfile(filepath=str(blend))
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
gown = bpy.data.objects['ada_gown']
legs = [(f'{b}_{s}', r0, r1) for s in ('l', 'r') for b, r0, r1 in LEG_CAPSULES]
sc = bpy.context.scene


def verts_world():
    dg = bpy.context.evaluated_depsgraph_get()
    ev = gown.evaluated_get(dg)
    me = ev.to_mesh()
    a = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', a)
    ev.to_mesh_clear()
    a = a.reshape(-1, 3)
    M = np.array(gown.matrix_world)
    return a @ M[:3, :3].T + M[:3, 3]


def capsules():
    mw = rig.matrix_world
    out = []
    for name, r0, r1 in legs:
        pb = rig.pose.bones[name]
        out.append((name, np.array(mw @ pb.head), np.array(mw @ pb.tail), r0, r1))
    return out


def depths(P, radii):
    out = np.zeros(len(P))
    for (name, a, b, r0, r1) in capsules():
        ab = b - a
        t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
        c = a + t[:, None] * ab
        d = np.linalg.norm(P - c, axis=1)
        q0, q1 = radii[name]
        out = np.maximum(out, q0 + (q1 - q0) * t - d)
    return out


def calibrate(P):
    """Capsule radii shrunk so that NO skirt vertex is inside at rest (the skirt drapes close to the thighs)."""
    radii = {}
    for (name, a, b, r0, r1) in capsules():
        ab = b - a
        t = np.clip(((P - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
        d = np.linalg.norm(P - (a + t[:, None] * ab), axis=1)
        q0, q1 = r0, r1
        for lo, hi, which in ((0.0, 0.5, 0), (0.5, 1.0, 1)):
            m = (t >= lo) & (t <= hi)
            if m.any():
                lim = 0.95 * float(d[m].min())
                if which == 0:
                    q0 = min(q0, lim)
                else:
                    q1 = min(q1, lim)
        radii[name] = (q0, q1)
    return radii


ad = rig.animation_data
ad.use_nla = False
ad.action = None
for pb in rig.pose.bones:
    pb.rotation_euler = (0, 0, 0)
    pb.location = (0, 0, 0)
bpy.context.view_layer.update()
P0 = verts_world()
hip_z = (rig.matrix_world @ rig.pose.bones['hips'].head).z
skirt = P0[:, 2] < hip_z - 0.05
radii = calibrate(P0[skirt])
log(f'gown_check calibrated leg radii: {radii}')
report = {}
for act in bpy.data.actions:
    if not act.name.startswith('ada_'):
        continue
    ad.action = act
    ad.action_slot = act.slots[0]
    f0, f1 = (int(round(v)) for v in act.frame_range)
    worst, bad = 0.0, 0
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        P = verts_world()
        extra = depths(P, radii)[skirt]
        m = float(extra.max())
        worst = max(worst, m)
        bad += m > 0.005
    report[act.name] = {'frames': f1 - f0 + 1, 'frames_over_5mm': bad, 'max_cm': round(worst * 100, 2)}
    log(f'gown_check {act.name}: {bad}/{f1 - f0 + 1} frames > 5 mm, max {worst * 100:.1f} cm')
(CACHE / 'anims').mkdir(parents=True, exist_ok=True)
(CACHE / 'anims' / 'gown_check.json').write_text(json.dumps(report, indent=2) + '\n')
result({'gown_check': report})
