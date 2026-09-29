"""Game-like review renders: dark room, a flashlight spot from the viewer's position, faint cold moonlight, AgX.
Loads .cache/anims/<char>_anim.blend and poses each shot from a clip frame -> scratch/characters/<char>_moody.png.
  node blender/characters/dev.mjs blender/characters/review_moody.py --only ada,harlan [--samples 96]
"""
import math

import bpy
import numpy as np
from mathutils import Vector

from lib.scene import CACHE, job_args, log
from characters import review

ARGS = job_args()
ONLY = (ARGS.get('only') or 'ada,harlan').split(',')
SHOTS = {
    # (label, clip, seconds, camera, target, lens, flashlight on camera?)
    'ada': [('look', 'ada_look', 2.4, (0.25, -1.3, 1.5), (0.0, -0.1, 1.45), 45),
            ('look close', 'ada_look', 2.6, (0.08, -0.55, 1.52), (0.0, -0.05, 1.5), 50),
            ('patrol', 'ada_patrol', 0.5, (1.4, -2.6, 1.55), (0.0, 0.0, 0.9), 35),
            ('catch', 'ada_catch', 0.9, (0.1, -0.75, 1.45), (0.0, 0.0, 1.2), 28),
            ('feet', 'ada_patrol', 0.2, (0.5, -1.0, 0.45), (0.05, 0.0, 0.2), 40),
            ('eye', 'ada_look', 2.6, (-0.05, -0.42, 1.5), (-0.03, -0.05, 1.49), 70),
            ('chase', 'ada_chase', 0.3, (1.2, -2.2, 1.4), (0.0, 0.0, 1.0), 35),
            ('stairs', 'ada_stairs_up', 0.4, (-1.5, -1.8, 1.2), (0.0, 0.0, 0.9), 35),
            ('vigil', 'ada_vigil', 1.0, (-1.1, -1.1, 1.5), (0.0, -0.2, 1.3), 40)],
    'harlan': [('sack', 'harlan_pose_look_up', 0.0, (0.5, -1.2, 1.7), (0.0, -0.05, 1.72), 45),
               ('sack front', 'harlan_seated_look_up', 0.0, (0.05, -1.4, 0.95), (0.0, -0.1, 1.2), 45),
               ('stairs', 'harlan_pose_stairs_foot', 0.0, (1.6, -2.8, 1.9), (0.0, 0.0, 1.1), 35),
               ('car push', 'harlan_pose_car_push', 0.0, (2.2, -1.5, 1.4), (0.0, -0.3, 0.9), 35),
               ('opening', 'harlan_opening', 9.5, (-1.8, -2.2, 1.6), (0.0, -0.1, 1.3), 35),
               ('hands', 'harlan_opening', 3.0, (0.8, -0.9, 1.5), (0.1, -0.2, 1.4), 35)],
}


def set_clip(rig, name, t):
    ad = rig.animation_data
    ad.use_nla = False
    act = bpy.data.actions[name]
    ad.action = act
    ad.action_slot = act.slots[0]
    bpy.context.scene.frame_set(1 + int(round(t * 30)))


def stage():
    sc = bpy.context.scene
    review.cycles((560, 400), samples=int(ARGS.get('samples') or 96))
    sc.view_settings.exposure = 0.0
    w = sc.world
    bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (0.004, 0.005, 0.008, 1)
    bg.inputs['Strength'].default_value = 1.0
    review.floor(10, rgb=(0.04, 0.03, 0.022))
    bpy.ops.mesh.primitive_plane_add(size=10, location=(0, 1.2, 2.0), rotation=(math.radians(90), 0, 0))
    wall = bpy.context.active_object
    m = bpy.data.materials.new('wall')
    next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].default_value = (0.06, 0.07, 0.05, 1)
    wall.data.materials.append(m)
    moon = bpy.data.lights.new('moon', 'AREA')
    moon.energy = 18
    moon.size = 1.5
    moon.color = (0.55, 0.65, 1.0)
    mo = bpy.data.objects.new('moon', moon)
    sc.collection.objects.link(mo)
    mo.location = (-2.5, -1.0, 2.6)
    mo.rotation_mode = 'QUATERNION'
    mo.rotation_quaternion = (Vector((0, 0, 1.0)) - mo.location).to_track_quat('-Z', 'Y')
    spot = bpy.data.lights.new('flashlight', 'SPOT')
    spot.energy = 25
    spot.spot_size = math.radians(34)
    spot.spot_blend = 0.6
    spot.shadow_soft_size = 0.02
    spot.color = (1.0, 0.9, 0.75)
    so = bpy.data.objects.new('flashlight', spot)
    sc.collection.objects.link(so)
    return so


def main():
    try:
        from props.preview import draw_text
    except Exception:
        def draw_text(*a, **k):
            return 0
    for char in ONLY:
        bpy.ops.wm.open_mainfile(filepath=str(CACHE / 'anims' / f'{char}_anim.blend'))
        rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
        so = stage()
        cam = review._camera()
        tiles = []
        for lab, clip, t, loc, tgt, lens in SHOTS[char]:
            set_clip(rig, clip, t)
            review.look(cam, loc, tgt, lens)
            so.location = Vector(loc) + Vector((0.18, 0.05, -0.25))
            so.rotation_mode = 'QUATERNION'
            so.rotation_quaternion = (Vector(tgt) - so.location).to_track_quat('-Z', 'Y')
            a = review.render_to_array(review.OUT / '__m.png')
            draw_text(a, 6, 6, lab, scale=2)
            tiles.append(a)
        rows = [np.concatenate(tiles[i:i + 3], 1) for i in range(0, len(tiles), 3)]
        sheet = np.concatenate(rows, 0)
        H, W = sheet.shape[:2]
        img = bpy.data.images.new('m', W, H)
        img.pixels.foreach_set(np.ascontiguousarray(sheet[::-1]).ravel())
        img.filepath_raw = str(review.OUT / f'{char}_moody.png')
        img.file_format = 'PNG'
        img.save()
        log(f'{char} moody sheet')


main()
