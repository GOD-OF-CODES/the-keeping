"""Review render of the hedgerow treeline (blender/house/treeline.py: same placements, variants, LODs, shrubs and
power line) silhouetted the way the player sees it in a lightning flash: eye 1.65 m, 60 deg vertical FOV.

  node blender/characters/dev.mjs blender/house/review_treeline.py [--out tl] [--samples 24] [--view row|gate|pole]

Light (CLAUDE.md "Photoreal standard"): a sky-coloured (~8000 K) flash lighting the cloud deck, the trees as dark
bark_wet silhouettes (albedo 0.06, rough 0.7) against it; flat ground at grass_wet albedo.
-> scratch/blender-r2/<out>.png
"""
import math

import bpy
from mathutils import Vector

from lib.scene import REPO, job_args, log, reset, setup_cycles
from house import treeline

A = job_args()
OUT = REPO / 'scratch' / 'blender-r2'
OUT.mkdir(parents=True, exist_ok=True)
NAME = A.get('out') or 'tl'
VIEW = A.get('view') or 'row'
VIEWS = {   # plan x, y, heading (0 = east, pi/2 = north), pitch
    'row': (-4.0, -18.0, 2.6, 0.12),
    'gate': (1.8, -27.4, math.pi / 2, 0.08),
    'pole': (-6.0, -31.0, -2.2, 0.2),
}
reset()
sc = bpy.context.scene
setup_cycles(int(A.get('samples') or 24), max_bounces=3, diffuse_bounces=1)
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = int(A.get('w') or 800), int(A.get('h') or 500)
sc.view_settings.view_transform = 'AgX'
sc.render.image_settings.file_format = 'PNG'

bark = bpy.data.materials.new('bark')
bark.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.06, 0.05, 0.04, 1)
bark.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.7
zinc = bpy.data.materials.new('zinc')
zinc.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.5, 0.5, 0.5, 1)
zinc.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 1.0
grass = bpy.data.materials.new('grass')
grass.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.05, 0.055, 0.03, 1)

coll = bpy.data.collections.new('tl')
sc.collection.children.link(coll)
me = bpy.data.meshes.new('ground')
me.from_pydata([(-200, -200, 0), (200, -200, 0), (200, 200, 0), (-200, 200, 0)], [], [(0, 1, 2, 3)])
me.materials.append(grass)
g = bpy.data.objects.new('ground', me)
sc.collection.objects.link(g)

pl = treeline.placements()
cache = {}
n = 0
for p in pl:
    lod = treeline.lod_for('medium', p)
    if lod not in cache:
        cache[lod] = treeline.variants(lod, coll)
    me = cache[lod][p['variant']]
    ob = bpy.data.objects.new(f't{n}', me)
    coll.objects.link(ob)
    s = p['h'] / (treeline.SHRUB_H if p.get('shrub') else 13.0)
    ta, tr = p.get('tilt', (0.0, 0.0))
    from mathutils import Matrix
    ob.matrix_world = (Matrix.Translation((p['x'], p['y'], -0.08)) @
                       Matrix.Rotation(tr, 4, Vector((math.cos(ta), math.sin(ta), 0.0))) @
                       Matrix.Rotation(p['yaw'], 4, 'Z') @ Matrix.Diagonal((s, s, s, 1.0)))
    n += 1


class _P:      # pole_line needs the layout's props only
    import json
    from lib.scene import SHARED
    L = json.loads((SHARED / 'level-layout.json').read_text())


lobjs, lstats = treeline.pole_line(_P, coll)
for ob in list(coll.objects):
    if ob.type == 'MESH':
        ob.data.materials.clear()
        ob.data.materials.append(zinc if ob.name.startswith('line_wires') else bark)

w = bpy.data.worlds.new('w')
sc.world = w
bg = w.node_tree.nodes['Background']
bg.inputs['Color'].default_value = (0.78, 0.84, 1.0, 1)
bg.inputs['Strength'].default_value = 1.0

x, y, h, pt = VIEWS[VIEW]
cd = bpy.data.cameras.new('cam')
cam = bpy.data.objects.new('cam', cd)
sc.collection.objects.link(cam)
sc.camera = cam
cd.sensor_fit = 'VERTICAL'
cd.angle = math.radians(60)
cam.location = (x, y, 1.65)
cam.rotation_mode = 'XYZ'
cam.rotation_euler = (math.radians(90) + pt, 0, h - math.pi / 2)
sc.view_settings.exposure = float(A.get('ev') or -0.5)
sc.render.filepath = str(OUT / f'{NAME}.png')
bpy.ops.render.render(write_still=True)
log('treeline review ->', OUT / f'{NAME}.png', n, 'trees', lstats)
