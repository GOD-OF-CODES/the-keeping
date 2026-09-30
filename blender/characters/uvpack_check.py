"""Dev experiment: character atlas packing efficiency (docs/CHARACTERS.md open issue 4).

  node blender/characters/dev.mjs blender/characters/uvpack_check.py [--char harlan]

Opens .cache/characters/<char>.blend (meshes with their final UVMap), measures the UV fill (sum of island area in
the unit square), then re-packs the SAME islands with other pack_islands settings and reports each fill. Nothing
is saved.
"""
import sys
import time
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib.scene import CACHE, job_args, log, result, select  # noqa: E402

args = job_args()
char = args.get('char', 'harlan')
bpy.ops.wm.open_mainfile(filepath=str(CACHE / 'characters' / f'{char}.blend'))
objs = [o for o in bpy.data.objects if o.type == 'MESH' and o.get('character') == char and o.data.uv_layers]
hair = [o for o in objs if 'hair' in o.name]
objs = [o for o in objs if o not in hair]


def fill():
    tot = 0.0
    lo, hi = np.array([1e9, 1e9]), np.array([-1e9, -1e9])
    for o in objs:
        uv = o.data.uv_layers['UVMap']
        a = np.empty(len(uv.data) * 2)
        uv.data.foreach_get('uv', a)
        a = a.reshape(-1, 2)
        lo, hi = np.minimum(lo, a.min(0)), np.maximum(hi, a.max(0))
        for p in o.data.polygons:
            q = a[p.loop_start:p.loop_start + p.loop_total]
            x, y = q[:, 0], q[:, 1]
            tot += 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))
    return round(tot, 4), [round(v, 3) for v in lo], [round(v, 3) for v in hi]


def repack(**kw):
    select(objs, objs[0])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    t0 = time.time()
    bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', scale=True, margin_method='FRACTION', **kw)
    dt = time.time() - t0
    bpy.ops.object.mode_set(mode='OBJECT')
    return round(dt, 1)


out = {'baseline': fill()}
log(f'uvpack {char}: baseline fill {out["baseline"]}')
for name, kw in (('convex_any', dict(rotate=True, rotate_method='ANY', margin=0.004, shape_method='CONVEX')),
                 ('concave_any', dict(rotate=True, rotate_method='ANY', margin=0.004, shape_method='CONCAVE')),
                 ('concave_any_m3', dict(rotate=True, rotate_method='ANY', margin=0.003, shape_method='CONCAVE'))):
    dt = repack(**kw)
    out[name] = {'fill': fill(), 'seconds': dt}
    log(f'uvpack {char}: {name} fill {out[name]}')
result({'uvpack': out, 'char': char})
