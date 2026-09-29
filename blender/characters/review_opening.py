"""Review: the C2 opening tableau as one scene (ada_opening + harlan_opening, staged per anim/clips_ada.py),
rendered dim from the doorway side (+X) at key moments -> scratch/characters/opening.png.
  node blender/characters/dev.mjs blender/characters/review_opening.py [--samples 48]
"""
import math

import bpy
import numpy as np
from mathutils import Vector

from lib.scene import CACHE, job_args, log
from characters import review
from anim.clips_ada import HARLAN_ROOT, TABLE_Y0, TABLE_Y1, TABLE_Z

ARGS = job_args()
bpy.ops.wm.open_mainfile(filepath=str(CACHE / 'anims' / 'ada_anim.blend'))
with bpy.data.libraries.load(str(CACHE / 'anims' / 'harlan_anim.blend')) as (src, dst):
    dst.objects = [n for n in src.objects if n.startswith('harlan')]
for o in dst.objects:
    bpy.context.scene.collection.objects.link(o)
hr = bpy.data.objects['harlan_rig']
hr.location = HARLAN_ROOT
hr.rotation_euler = (0, 0, math.pi)
ar = bpy.data.objects['ada_rig']
for rig, act in ((ar, 'ada_opening'), (hr, 'harlan_opening')):
    ad = rig.animation_data
    ad.use_nla = False
    ad.action = bpy.data.actions[act]
    ad.action_slot = bpy.data.actions[act].slots[0]
# sawbuck table top + legs (review stand-in)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, (TABLE_Y0 + TABLE_Y1) / 2, TABLE_Z - 0.03))
top = bpy.context.active_object
top.scale = (1.6, abs(TABLE_Y1 - TABLE_Y0), 0.06)
m = bpy.data.materials.new('table')
next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].default_value = (0.08, 0.05, 0.03, 1)
top.data.materials.append(m)
review.cycles((560, 400), samples=int(ARGS.get('samples') or 48))
review.floor(8)
ld = bpy.data.lights.new('lamp', 'POINT')
ld.energy = 60
ld.shadow_soft_size = 0.05
lo = bpy.data.objects.new('lamp', ld)
bpy.context.scene.collection.objects.link(lo)
lo.location = (1.2, -1.6, 2.1)
fill = bpy.data.lights.new('fill', 'AREA')
fill.energy = 12
fill.size = 3
fo = bpy.data.objects.new('fill', fill)
bpy.context.scene.collection.objects.link(fo)
fo.location = (3.0, 0.5, 1.5)
fo.rotation_mode = 'QUATERNION'
fo.rotation_quaternion = (Vector((0, -0.5, 1.0)) - fo.location).to_track_quat('-Z', 'Y')
cam = review._camera()
tiles = []
try:
    from props.preview import draw_text
except Exception:
    def draw_text(*a, **k):
        return 0
for t in (1.0, 6.0, 9.5, 12.8):
    bpy.context.scene.frame_set(1 + int(t * 30))
    for view, loc, tgt, lens in (('door', (3.4, -0.9, 1.6), (0, -0.7, 1.0), 38), ('close', (1.3, -1.0, 1.25), (0, -0.75, 0.95), 35)):
        review.look(cam, loc, tgt, lens)
        a = review.render_to_array(review.OUT / '__op.png')
        draw_text(a, 6, 6, f'{view} {t:.1f}S', scale=2)
        tiles.append(a)
rows = [np.concatenate(tiles[i:i + 4], 1) for i in range(0, len(tiles), 4)]
sheet = np.concatenate(rows, 0)
H, W = sheet.shape[:2]
img = bpy.data.images.new('op', W, H)
img.pixels.foreach_set(np.ascontiguousarray(sheet[::-1]).ravel())
img.filepath_raw = str(review.OUT / 'opening.png')
img.file_format = 'PNG'
img.save()
log('opening sheet written')
