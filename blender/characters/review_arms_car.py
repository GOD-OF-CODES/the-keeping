"""Review: the first-person arm clips of the C1 car (arms_wheel, arms_radio_seek, arms_headlamp_knob, arms_stalk_flick,
arms_brace, arms_map) posed from .cache/anims/arms_anim.blend in a clay stand-in of the sedan_interior controls
(15 in wheel on a 25 deg column, dash face, radio, headlamp knob, stalk; camera = the driver eye, vertical FOV 50 deg)
-> scratch/blender-realism/<out>.png (3 x 2 sheet). Run through the pipeline: node scripts/assets.mjs --only arms-review

Light: the dome light (~0.5 cd, 4100 K warm-white so the leather can be judged) + the overcast night sky through the
glass; this is a pose/shape review, not a lighting reference.
"""
import math

import bpy
import numpy as np
from mathutils import Vector

from lib.scene import CACHE, REPO, job_args, log, setup_cycles
from anim import clips_arms as ca

A = job_args()
OUT = REPO / 'scratch' / 'blender-realism'
OUT.mkdir(parents=True, exist_ok=True)
NAME = A.get('out') or 'arms_car'
SAMPLES = int(A.get('samples') or 48)
RES = (int(A.get('w') or 480), int(A.get('h') or 320))
SHOTS = [('arms_wheel', 1.5), ('arms_radio_seek', 0.8), ('arms_headlamp_knob', 0.75), ('arms_stalk_flick', 0.45),
         ('arms_brace', 1.2), ('arms_map', 3.6)]
if A.get('shots'):
    SHOTS = [(s.split('@')[0], float(s.split('@')[1])) for s in A['shots'].split(',')]

bpy.ops.wm.open_mainfile(filepath=str(A.get('blend') or CACHE / 'anims' / 'arms_anim.blend'))
sc = bpy.context.scene
rig = bpy.data.objects['arms_rig']
# the torch is hidden in the car (runtime does the same)
for o in bpy.data.objects:
    if o.type == 'MESH' and 'flashlight' in o.name:
        o.hide_render = True


def mat(name, rgb, rough):
    m = bpy.data.materials.new(name)
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    return m


clay = mat('__clay', (0.18, 0.17, 0.16), 0.6)
dash = mat('__dash', (0.03, 0.03, 0.03), 0.55)
# wheel rim: a torus at the hub, tilted with the column
bpy.ops.mesh.primitive_torus_add(major_radius=ca.RIM_R, minor_radius=0.014, major_segments=64, minor_segments=12,
                                 location=tuple(ca.HUB), rotation=(math.pi / 2 - ca.WHEEL_TILT, 0, 0))
bpy.context.active_object.data.materials.append(clay)
# dash face (plane leaning back) + radio box + knob + stalk tip markers
# dash: top edge at car z 0.85 (camera -0.27), face ~0.62-0.70 m ahead of the eye
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.70, -0.45))
bpy.context.active_object.scale = (1.6, 0.08, 0.36)
bpy.context.active_object.data.materials.append(dash)
for loc, size in ((ca.RADIO_SEEK + Vector((-0.05, 0.02, 0)), (0.18, 0.03, 0.05)), (ca.HEADLAMP_KNOB, (0.024, 0.016, 0.024)),
                  (ca.STALK_TIP, (0.04, 0.022, 0.022))):
    bpy.ops.mesh.primitive_cube_add(size=1, location=tuple(loc))
    ob = bpy.context.active_object
    ob.scale = size
    ob.data.materials.append(clay)

w = bpy.data.worlds.new('__sky')
sc.world = w
bg = w.node_tree.nodes.get('Background')
bg.inputs['Color'].default_value = (0.55, 0.62, 0.8, 1)
bg.inputs['Strength'].default_value = 0.004
ld = bpy.data.lights.new('__dome', 'POINT')
ld.energy = float(A.get('dome_w') or 4.0)
ld.shadow_soft_size = 0.06
ld.color = (1.0, 0.82, 0.62)
lo = bpy.data.objects.new('__dome', ld)
sc.collection.objects.link(lo)
lo.location = (0.25, 0.15, 0.22)          # dome lamp: overhead, a little right and ahead of the driver's eye

setup_cycles(SAMPLES, device='GPU')
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = RES
sc.render.resolution_percentage = 100
sc.view_settings.view_transform = 'AgX'
sc.view_settings.exposure = float(A.get('exposure') or 0.0)
sc.render.image_settings.file_format = 'PNG'
cd = bpy.data.cameras.new('__cam')
cam = bpy.data.objects.new('__cam', cd)
sc.collection.objects.link(cam)
sc.camera = cam
cd.sensor_fit = 'VERTICAL'
cd.angle = math.radians(50)
cd.clip_start = 0.01
cam.location = (0, 0, 0)
cam.rotation_mode = 'QUATERNION'
cam.rotation_quaternion = Vector((0, 1, -0.28)).to_track_quat('-Z', 'Y')

# the folded County Road 9 map (review stand-in): 0.34 x 0.24 m sheet in prop_l socket space (+X along the map from
# the left-edge pinch, +Y away from the eye, +Z up the sheet), two vertical fold creases, shown while attached (0.6-5.8 s)
paper = mat('__paper', (0.62, 0.58, 0.48), 0.8)
bpy.ops.mesh.primitive_grid_add(x_subdivisions=7, y_subdivisions=2, size=1)
mp = bpy.context.active_object
for v in mp.data.vertices:
    u, w = v.co.x + 0.5, v.co.y
    x = -0.01 + 0.34 * u
    v.co = (x, 0.012 * abs(math.sin(u * 3 * math.pi)), 0.24 * w)
mp.data.materials.append(paper)
mp.name = '__map'
pb_map = rig.pose.bones.get('prop_l')
tiles = []
ad = rig.animation_data or rig.animation_data_create()
for clip, t in SHOTS:
    act = bpy.data.actions.get(clip)
    if act is None:
        log(f'missing action {clip}')
        continue
    ad.use_nla = False
    ad.action = act
    if act.slots:
        ad.action_slot = act.slots[0]
    sc.frame_set(1 + int(round(t * 30)))
    mp.hide_render = not (clip == 'arms_map' and pb_map is not None and 0.6 <= t <= 5.8)
    if not mp.hide_render:
        mp.matrix_world = rig.matrix_world @ pb_map.matrix
    p = OUT / '__tile.png'
    sc.render.filepath = str(p)
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(str(p), check_existing=False)
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(a)
    tiles.append(a.reshape(img.size[1], img.size[0], 4))
    bpy.data.images.remove(img)
    p.unlink(missing_ok=True)
    log(f'rendered {clip} @ {t}s')

cols = 3
rows = (len(tiles) + cols - 1) // cols
H, W = RES[1], RES[0]
sheet = np.zeros((rows * H, cols * W, 4), np.float32)
sheet[..., 3] = 1
for i, a in enumerate(tiles):
    r, c = divmod(i, cols)
    sheet[(rows - 1 - r) * H:(rows - r) * H, c * W:(c + 1) * W] = a
img = bpy.data.images.new('__sheet', cols * W, rows * H, alpha=True)
img.pixels.foreach_set(sheet.ravel())
img.filepath_raw = str(OUT / f'{NAME}.png')
img.file_format = 'PNG'
img.save()
log(f'wrote {OUT / (NAME + ".png")}')
