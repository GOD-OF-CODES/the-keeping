"""Review renders of the layout's trees (exact placements' params -> same seeds as the props job).

  node blender/characters/dev.mjs blender/props/review_trees.py [--out trees] [--samples 32]

Row 1: each tree silhouetted against a lightning-lit overcast sky (sky ~8000 K, the way the player sees them in a
flash). Row 2: the same trees under a dim overcast-moon sky + a weak warm key, closer, to judge bark, roots, taper.
-> scratch/blender-realism/<out>.png
"""
import json
import math

import bpy
import numpy as np
from mathutils import Vector

from lib.scene import REPO, job_args, log, reset, setup_cycles
from props import registry

A = job_args()
OUT = REPO / 'scratch' / 'blender-realism'
OUT.mkdir(parents=True, exist_ok=True)
NAME = A.get('out') or 'trees'
SAMPLES = int(A.get('samples') or 32)
W, H = int(A.get('w') or 420), int(A.get('h') or 520)

reset()
sc = bpy.context.scene
layout = json.loads((REPO / 'src/shared/level-layout.json').read_text())
trees = [p for p in layout['props'] if p['type'] == 'dead_tree']
objs = []
x = 0.0
for p in trees:
    params = dict(p.get('params') or {})
    built = registry.build('dead_tree', params, pos=(x, 0, 0), yaw=float(p.get('yaw', 0)))
    roots = [o for o in built if o.parent is None]
    for o in roots:
        o.location.x = x
    tris = sum(sum(len(f.vertices) - 2 for f in o.data.polygons) for o in built if o.type == 'MESH')
    log(f"tree {p['id']}: {tris} tris, extras {dict((k, roots[0][k]) for k in roots[0].keys() if k.startswith('tree') or k == 'twig_keep')}")
    objs.append((p['id'], x, float(params.get('height', 9))))
    x += 16.0

# ground
bpy.ops.mesh.primitive_plane_add(size=200, location=(x / 2, 0, 0))
g = bpy.context.active_object
gm = bpy.data.materials.new('__ground')
gb = next(n for n in gm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
gb.inputs['Base Color'].default_value = (0.04, 0.045, 0.03, 1)
gb.inputs['Roughness'].default_value = 0.8
g.data.materials.append(gm)

world = bpy.data.worlds.new('__w')
sc.world = world
bg = world.node_tree.nodes['Background']
setup_cycles(SAMPLES, device='GPU')
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = W, H
sc.view_settings.view_transform = 'AgX'
sc.render.image_settings.file_format = 'PNG'
cd = bpy.data.cameras.new('__cam')
cam = bpy.data.objects.new('__cam', cd)
sc.collection.objects.link(cam)
sc.camera = cam
cd.sensor_fit = 'VERTICAL'
key = bpy.data.lights.new('__key', 'SUN')
key.angle = math.radians(8)
ko = bpy.data.objects.new('__key', key)
sc.collection.objects.link(ko)
ko.rotation_euler = (math.radians(55), 0, math.radians(35))


def shot(loc, tgt, vfov, sky_rgb, sky_w, key_w, ev):
    bg.inputs['Color'].default_value = (*sky_rgb, 1)
    bg.inputs['Strength'].default_value = sky_w
    key.energy = key_w
    sc.view_settings.exposure = ev
    cam.location = Vector(loc)
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y')
    cd.angle = math.radians(vfov)
    p = OUT / '__t.png'
    sc.render.filepath = str(p)
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(str(p), check_existing=False)
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(a)
    a = a.reshape(img.size[1], img.size[0], 4)
    bpy.data.images.remove(img)
    p.unlink(missing_ok=True)
    return a


row1, row2 = [], []
for tid, tx, th in objs:
    row1.append(shot((tx, -th * 1.9, 1.6), (tx, 0, th * 0.5), 50, (0.72, 0.78, 0.95), 1.6, 0.0, 0.0))
    row2.append(shot((tx + 2.5, -5.5, 1.7), (tx, 0, 2.2), 50, (0.5, 0.55, 0.7), 0.05, 0.25, 2.0))
sheet = np.concatenate([np.concatenate(row2, 1), np.concatenate(row1, 1)], 0)
img = bpy.data.images.new('__sheet', sheet.shape[1], sheet.shape[0], alpha=False)
img.pixels.foreach_set(np.ascontiguousarray(sheet).ravel())
img.filepath_raw = str(OUT / f'{NAME}.png')
img.file_format = 'PNG'
img.save()
log('trees review ->', OUT / f'{NAME}.png')
