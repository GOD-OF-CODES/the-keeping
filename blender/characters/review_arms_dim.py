"""Dim, game-like review renders of the first-person arms (.cache/characters/arms.blend, textures wired by
build_characters.finish) -> scratch/blender-realism/arms_dim.png (2 x 2 sheet).

  node blender/characters/dev.mjs blender/characters/review_arms_dim.py [--out name] [--samples 96]

Light uses real numbers (CLAUDE.md "Photoreal standard"):
  - the torch: 1990s 2-cell D krypton, peak beam ~2.5 kcd. Blender spot intensity = P / (4 pi) W/sr and
    1 W = 683 lm here, so P = 2500 * 4 pi / 683 = 46 W, ~2900 K, 24 deg cone with a soft spill (blend 0.6).
  - an aged-plaster wall (albedo 0.6, rough 0.9) 1.9 m ahead and a dark varnished floor (0.1 / 0.3) 1.65 m below
    the eye: the hands are lit only by that bounce + a faint overcast-moon sky (~0.02 lux), exactly like the game.
  - close-ups add one flat-wick kerosene lamp (~12 cd, 1950 K) 1.2 m to the side: 12 * 4 pi / 683 = 0.22 W.
Views: game view (vertical FOV 60 deg, the player's camera), left glove + torch close-up, right glove back,
right palm / cuff from below.
"""
import math

import bpy
import numpy as np
from mathutils import Vector

from lib.scene import CACHE, REPO, job_args, log, setup_cycles

A = job_args()
OUT = REPO / 'scratch' / 'blender-realism'
OUT.mkdir(parents=True, exist_ok=True)
NAME = A.get('out') or 'arms_dim'
SAMPLES = int(A.get('samples') or 96)
RES = (int(A.get('w') or 640), int(A.get('h') or 400))

bpy.ops.wm.open_mainfile(filepath=str(A.get('blend') or CACHE / 'characters' / 'arms.blend'))
sc = bpy.context.scene


def kelvin_rgb(k):
    """Approximate blackbody chromaticity (linear sRGB, normalised to max 1) for 1000-10000 K."""
    t = k / 100.0
    r = 255.0 if t <= 66 else 329.698727446 * (t - 60) ** -0.1332047592
    g = 99.4708025861 * math.log(t) - 161.1195681661 if t <= 66 else 288.1221695283 * (t - 60) ** -0.0755148492
    b = 255.0 if t >= 66 else (0.0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307)
    c = [max(0.0, min(255.0, x)) / 255.0 for x in (r, g, b)]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    m = max(c)
    return tuple(x / m for x in c)


def principled(name, rgb, rough):
    m = bpy.data.materials.new(name)
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    return m


def plane(name, loc, rot, size, mat):
    bpy.ops.mesh.primitive_plane_add(size=size, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.materials.append(mat)
    return ob


# the room: wall ahead, floor below (eye at 1.65 m), a side wall on the left
plane('__wall', (0, 1.9, 0), (math.radians(90), 0, 0), 8, principled('__plaster', (0.6, 0.57, 0.52), 0.9))
plane('__floor', (0, 0, -1.65), (0, 0, 0), 8, principled('__boards', (0.1, 0.07, 0.045), 0.3))
plane('__side', (-1.4, 0, 0), (0, math.radians(90), 0), 8, principled('__paper', (0.25, 0.27, 0.2), 0.85))

# the torch at the flashlight_beam bone (posed: --pose clip:seconds on the anims blend, e.g.
#   --job-args="--blend .cache/anims/arms_anim.blend --pose arms_stumble_catch:0.4 --tread 1")
rig = bpy.data.objects['arms_rig']
if A.get('pose'):
    clip, tt = str(A['pose']).split(':')
    ad = rig.animation_data or rig.animation_data_create()
    ad.use_nla = False
    act = bpy.data.actions[clip]
    ad.action = act
    if act.slots:
        ad.action_slot = act.slots[0]
    sc.frame_set(1 + int(round(float(tt) * 30)))
    bpy.context.view_layer.update()
pbb = rig.pose.bones['flashlight_beam']
beam_o = rig.matrix_world @ pbb.head
beam_d = (rig.matrix_world.to_3x3() @ (pbb.tail - pbb.head)).normalized()
if A.get('tread'):
    # C2c 6.62: the gloves slapped onto tread 13 (dark varnished pine, wet prints), 0.4-0.5 m from the eye
    hz = min((rig.matrix_world @ rig.pose.bones[b].head).z for b in ('hand_l', 'hand_r'))
    plane('__tread', (0, 0.45, hz - 0.035), (math.radians(28), 0, 0), 1.2, principled('__varnish', (0.09, 0.055, 0.035), 0.28))
sp = bpy.data.lights.new('__torch', 'SPOT')
sp.energy = 46.0
sp.color = kelvin_rgb(2900)
sp.spot_size = math.radians(24)
sp.spot_blend = 0.6
sp.shadow_soft_size = 0.012
so = bpy.data.objects.new('__torch', sp)
sc.collection.objects.link(so)
so.location = beam_o + beam_d * 0.005
so.rotation_mode = 'QUATERNION'
so.rotation_quaternion = beam_d.to_track_quat('-Z', 'Y')

# overcast moonlit sky: ~0.02 lux -> radiance L = E / pi in Blender W units (683 lm/W)
w = bpy.data.worlds.new('__sky')
sc.world = w
bg = w.node_tree.nodes.get('Background')
bg.inputs['Color'].default_value = (*kelvin_rgb(7500), 1)
bg.inputs['Strength'].default_value = 0.02 / 683 / math.pi * 50   # x50: a window-lit room, not a sealed box

lamp = bpy.data.lights.new('__lamp', 'POINT')
lamp.energy = 0.0
lamp.color = kelvin_rgb(float(A.get('lamp_k') or 4300))   # neutral-warm so materials can be judged
lamp.shadow_soft_size = 0.02
lo = bpy.data.objects.new('__lamp', lamp)
sc.collection.objects.link(lo)
lo.location = (0.9, 0.9, -0.35)

setup_cycles(SAMPLES, device='GPU')
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 6
sc.cycles.diffuse_bounces = 3
sc.render.resolution_x, sc.render.resolution_y = RES
sc.render.resolution_percentage = 100
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'None'
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGB'

cd = bpy.data.cameras.new('__cam')
cam = bpy.data.objects.new('__cam', cd)
sc.collection.objects.link(cam)
sc.camera = cam
cd.clip_start = 0.01
cd.sensor_fit = 'VERTICAL'


def view(loc, tgt, vfov_deg, exposure, lamp_w):
    cam.location = Vector(loc)
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y')
    cd.angle = math.radians(vfov_deg)
    sc.view_settings.exposure = exposure
    lamp.energy = lamp_w
    p = OUT / '__tile.png'
    sc.render.filepath = str(p)
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(str(p), check_existing=False)
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(a)
    a = a.reshape(img.size[1], img.size[0], 4)
    bpy.data.images.remove(img)
    p.unlink(missing_ok=True)
    return a


lh = bpy.data.bones if False else None
hand_l = rig.matrix_world @ rig.pose.bones['hand_l'].head
hand_r = rig.matrix_world @ rig.pose.bones['hand_r'].head
fl_mid = beam_o - beam_d * 0.12
EV = float(A.get('ev') or 5.0)   # eye adapted to a lamp-lit room (~8 lux) vs the beam spot (~700 lux)
views = [
    ((0, 0, 0), (0.0, 1, -0.45), 60, float(A.get('ev0') or 3.5), 0.22),               # game view, looking down
    (tuple(fl_mid + Vector((0.16, -0.06, 0.12))), tuple(fl_mid - Vector((0.0, 0.02, 0.02))), 34, EV, 0.22),
    (tuple(hand_r + Vector((-0.05, -0.12, 0.2))), tuple(hand_r + Vector((0, 0.05, 0))), 38, EV, 0.22),
    ((0, 0, 0), tuple(hand_l + Vector((0.0, -0.05, -0.02))), 26, EV - 1.0, 0.22),         # the left cuff, eye's view
]
if A.get('judge'):
    # fix round A12: a USABLE glove close-up sheet (no tread plane; neutral 4300 K key 0.5 W (27 cd) at ~0.65 m, ~65 lux on the
    # leather, so seams/creases/wear can be judged; exposure fixed, AgX): back of the right glove, the knuckles from
    # the thumb side, the left glove on the torch, the cuff + snap
    for o in [o for o in sc.objects if o.name in ('__tread', '__wall', '__side')]:
        o.hide_render = True
    lo.location = tuple(hand_r + Vector((0.35, -0.45, 0.35)))
    views = [
        (tuple(hand_r + Vector((0.02, -0.16, 0.16))), tuple(hand_r + Vector((0, 0.04, 0))), 30, 3.0, 0.5),
        (tuple(hand_r + Vector((-0.17, -0.06, 0.07))), tuple(hand_r + Vector((0, 0.05, 0))), 30, 3.0, 0.5),
        (tuple(hand_l + Vector((0.16, -0.14, 0.12))), tuple(hand_l + Vector((0, 0.03, 0))), 32, 3.0, 0.5),
        (tuple(hand_l + Vector((-0.04, -0.2, 0.05))), tuple(hand_l + Vector((0, -0.06, 0))), 26, 3.0, 0.5),
    ]
tiles = [view(*v) for v in views]
top = np.concatenate([tiles[2], tiles[3]], 1)
bot = np.concatenate([tiles[0], tiles[1]], 1)
sheet = np.concatenate([top, bot], 0)    # Blender pixel rows are bottom-up: tiles 0/1 end up on top
H, W = sheet.shape[:2]
img = bpy.data.images.new('__sheet', W, H, alpha=False)
img.pixels.foreach_set(np.ascontiguousarray(sheet).ravel())
path = OUT / f'{NAME}.png'
img.filepath_raw = str(path)
img.file_format = 'PNG'
img.save()
log('arms review ->', path)
