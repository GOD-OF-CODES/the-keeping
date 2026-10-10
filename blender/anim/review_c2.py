"""A9 — C2-ESCAPE review renders (docs/C2-ESCAPE.md §5.1 A9, §8.1 step 1): Cycles, REAL light values, the house
shell + placed props + Ada / Harlan from the anim blends, posed at the doc's staging constants (§2.0).

Step 1 (before any animation) = the lamp-placement proof: C2 2.4 / 7.62 / 9.9 / 24.6 / 27.0 from the lean eye D or
the threshold eye T with the restaged lamp + blocking. Light values (CLAUDE.md, §2.4):
  L_LAMP_PARLOR  flat-wick kerosene lamp 12 cd, 1950 K -> Blender 12 * 4pi = 151 W, radius 0.012 (flame 2.5 x 1.2 cm)
  L_CANDLE_TABLE 0.95 cd, 1850 K (layout: 12 W)  ·  mantel / sill candles 0.8 cd (layout)
Exposure = the runtime eye (§2.4): a meter pass (EXR, linear) spot-weighted 60 % on the work-area ellipse + 40 % frame,
log-average, multiplier = key 0.12 / Lavg clamped to [0.7, 8] (runtime cd = W/4pi, so the units match the game).

  node scripts/assets.mjs --only c2-review --force [--job-args="--views d24,d76 --samples 64 --res 960x402"]
Outputs scratch/c2e/a9/<view>.png + meter.json.
"""
import json
import math
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

from lib import scene
from house import scene_prep
from house.plan import Plan

ARGS = scene.job_args()
SPP = int(ARGS.get('samples', 64))
RES = [int(v) for v in str(ARGS.get('res', '960x402')).split('x')]
OUT = Path(ARGS.get('out', scene.REPO / 'scratch' / 'c2e' / 'a9'))
OUT.mkdir(parents=True, exist_ok=True)

# ---- §2.0 staging constants (PLAN space == Blender space) ----
D = Vector((3.70, 1.26, 2.17))          # lean eye
T = Vector((3.42, 1.50, 2.22))          # threshold eye
NECK = Vector((5.31, 3.25, 1.40))       # cut point
HARLAN = (5.15, 3.95, -1.25)            # strike root, heading (rad, plan)
HARLAN_S10 = (4.05, 0.60, 0.92)         # S10: the dark SW corner (doc §2.1 S10), watching her rise
STOOL = Vector((4.60, 4.25, 0.60))
LAMP_BASE = Vector((4.60, 4.25, 1.05))
FLAME = Vector((4.60, 4.25, 1.35))
WHETSTONE = Vector((4.85, 4.50, 0.60))
HEAD_LAND = Vector((5.12, 3.18, 0.70))
HEAD_REST = Vector((5.02, 3.05, 0.70))
RISEN = Vector((6.10, 3.30, 0.60))      # risen body root (stump at z ~2.05)
LAMP_W = 12.0 * 4.0 * math.pi           # 12 cd -> 150.8 W

# views: name -> (eye, target, lens, state)
VIEWS = {
    'd24': (D, Vector((5.389, 3.237, 1.75)), 50, 'tableau'),         # C2 2.4: tableau, sack into darkness
    'd76': (D, NECK + Vector((-0.05, 0, -0.05)), 50, 'separate'),    # C2 7.62: the head separating, rigid frame
    'd99': (D, HEAD_REST + Vector((0, 0, 0.08)), 50, 'floor'),       # C2 9.9: the head rolled, cut toward the lamp
    'd246': (D, RISEN + Vector((0, 0, 1.15)), 50, 'risen'),          # C2 24.6: the body rising, split-lit
    't270': (T, Vector((4.45, 2.05, 1.75)), 50, 'walk'),             # C2 27.0: walking to the door, from T
    'cap273': (D, NECK, 50, 'separate_cap'),                         # the stump cap at 2.73 m / 50 mm (A2)
    'cap12': (NECK + (D - NECK).normalized() * 1.2, NECK, 50, 'separate_cap'),   # worst case 1.2 m
    'headcap': (HEAD_REST + Vector((-0.55, -0.75, 0.55)), HEAD_REST, 50, 'floor'),  # the head's cut ring, close
    'eye100': (D, None, 100, 'eye'),                                  # S6 insert: 100 mm from D on the eye
    'stump05': (None, None, 50, 'separate_cap'),        # the body's cap face-on-ish, 0.5 m along the neck axis
    'body': (T, RISEN + Vector((0, 0, 1.25)), 44, 'risen'),           # the headless body (S10), from T
    'body14': (RISEN + Vector((0, 0, 1.38)) + (T - RISEN - Vector((0, 0, 1.38))).normalized() * 1.4,
               RISEN + Vector((0, 0, 1.38)), 50, 'risen'),     # fix round: the risen stump from T's side at 1.4 m
}
want = [v for v in str(ARGS.get('views', 'd24,d76,d99,d246,t270')).split(',') if v in VIEWS]

bpy.ops.wm.open_mainfile(filepath=str(scene.CACHE / 'house' / 'house.blend'))
P = Plan()
L = P.L
sc = bpy.context.scene
used = scene.setup_cycles(SPP, device='GPU', max_bounces=8, diffuse_bounces=4)
sc.cycles.use_denoising = True
try:
    sc.cycles.denoiser = 'OPENIMAGEDENOISE'
except Exception:
    pass
sc.render.resolution_percentage = 100
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'None'
try:   # the runtime camera WB (src/render/look.ts wbIndoorK 3300, wbStrength 1): von Kries to 3300 K
    sc.view_settings.use_white_balance = True
    sc.view_settings.white_balance_temperature = float(ARGS.get('wb', 3300))
    sc.view_settings.white_balance_tint = 0.0
except Exception as e:
    scene.log(f'no view white balance: {e}')

scene_prep.append_props()
scene_prep.glass_transmissive()
scene_prep.pose_doors()
scene_prep.ground(P)
scene_prep.night_world(1.0)
# every layout light except the lightning (no lightning in C2, §2.4)
lights = scene_prep.add_lights({'lights': [l for l in L['lights'] if l.get('role') not in scene_prep.SKY_ROLES_REPLACED
                                           and 'LTN' not in l['id']]}, ('bake', 'bake_flicker', 'runtime', 'dynamic'))


def prop_root(pid):
    return next((o for o in bpy.data.objects if o.parent is None and o.get('prop_id') == pid), None)


# ---- the restaged lamp (A7 / A8): stool moved, seat 0.45 m, lamp on it, wick high ----
stool = prop_root('P_STOOL')
if stool:
    stool.location = STOOL
    stool.scale = (1, 1, 0.45 / 0.55)             # stool generator H 0.55 -> A8 asks height 0.45 (seat z 1.05)
ws = prop_root('P_WHETSTONE')
if ws:
    ws.location = WHETSTONE
lamp = prop_root('P_KEROSENE_LAMP')
if lamp:
    lamp.location = LAMP_BASE                    # (the U2 instance borrowed for the proof; P_LAMP_PARLOR = layout ask)
ld = bpy.data.lights.new('L_LAMP_PARLOR', 'POINT')
ld.energy = LAMP_W
ld.shadow_soft_size = 0.012
ld.use_temperature = True
ld.temperature = 1950.0
ld.color = (1, 1, 1)
lamp_ob = bpy.data.objects.new('L_LAMP_PARLOR', ld)
sc.collection.objects.link(lamp_ob)
lamp_ob.location = FLAME
# the flame itself (seen from T): a small emissive teardrop, 1950 K, ~1e4 cd/m2 over 2.5 x 1.2 cm
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.006, location=FLAME + Vector((0, 0, 0.002)), segments=12, ring_count=8)
fl = bpy.context.active_object
fl.scale = (1.0, 0.5, 2.1)
fm = bpy.data.materials.new('flame')
nt = fm.node_tree
for n in list(nt.nodes):
    if n.type != 'OUTPUT_MATERIAL':
        nt.nodes.remove(n)
em = nt.nodes.new('ShaderNodeEmission')
bb = nt.nodes.new('ShaderNodeBlackbody')
bb.inputs[0].default_value = 1950
nt.links.new(bb.outputs[0], em.inputs['Color'])
em.inputs['Strength'].default_value = 3000.0
nt.links.new(em.outputs[0], next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL').inputs['Surface'])
fl.data.materials.append(fm)
fl.visible_shadow = False


# ---- characters from the anim blends ----
def append_char(name):
    path = scene.CACHE / 'anims' / f'{name}_anim.blend'
    with bpy.data.libraries.load(str(path), link=False) as (src, dst):
        dst.objects = [o for o in src.objects]
        dst.actions = list(src.actions)
    objs = [o for o in dst.objects if o is not None]
    coll = bpy.data.collections.new(name)
    sc.collection.children.link(coll)
    for o in objs:
        if o.type in ('CAMERA', 'LIGHT'):
            continue
        coll.objects.link(o)
        low = o.name.lower()
        if 'lod' in low or low.endswith('_low') or '_low.' in low or o.name.startswith('__'):
            o.hide_render = True
    rig = next(o for o in objs if o.type == 'ARMATURE' and o.parent is None)
    return rig, [o for o in objs if o.type == 'MESH']


def set_pose(rig, clip, t):
    ad = rig.animation_data or rig.animation_data_create()
    ad.use_nla = False
    for tr in ad.nla_tracks:
        tr.mute = True
    act = bpy.data.actions.get(clip)
    if act is None:
        scene.log(f'missing clip {clip}')
        return
    ad.action = act
    if act.slots:
        ad.action_slot = act.slots[0]
    sc.frame_set(1 + int(round(t * 30)))


def place(rig, x, y, z, heading):
    rig.location = (x, y, z)
    rig.rotation_mode = 'XYZ'
    rig.rotation_euler = (0, 0, heading + math.pi / 2)   # characters face plan -y at rotation 0 (bank.ts)


def bone_world(rig, bone, tail=False):
    pb = rig.pose.bones[bone]
    return rig.matrix_world @ (pb.tail if tail else pb.head)


ada, ada_meshes = append_char('ada')
harlan, harlan_meshes = append_char('harlan')
scene.log('ada meshes', [m.name for m in ada_meshes], 'harlan meshes', [m.name for m in harlan_meshes])

# the cleaver (P_CLEAVER, lying on the table in the layout) moves into Harlan's right fist
cleaver = prop_root('P_CLEAVER')


def grip_cleaver(state):
    if not cleaver:
        return
    bitten = state in ('floor', 'risen', 'walk')
    for o in [cleaver] + list(cleaver.children_recursive):
        o.hide_render = not bitten or o.get('collider') in (True, 1) or o.name.endswith('-collider')
    for o in harlan_meshes:
        if 'cleaver' in o.name:
            o.hide_render = bitten
    if bitten:
        # bitten into the table's west edge after the strike (§2.1), handle up and out (A4 will key the real pose)
        cleaver.location = NECK + Vector((0.03, 0.10, 0.0))
        cleaver.rotation_euler = (math.radians(-70), 0, math.radians(90))


# ---- the head (A0 node: ada_head_rig, bone-parented to ada_rig.head; origin = the crown grip) ----
H = bpy.data.objects.get('ada_head_rig')
H_PAR = (H.parent, H.parent_type, H.parent_bone, H.matrix_parent_inverse.copy()) if H else None
CROWN_TO_CENTRE = Vector((0.0, -0.025, -0.078))     # rest: head centre relative to the crown (A0 node origin)
HEAD_MESH = bpy.data.objects.get('ada_head')
if H is None:
    scene.log('WARNING: no ada_head_rig in the anim blend (pre-A0 build): the head stays on the body')


def hair_gravity(on):
    """Free head: the hair chains hang toward world-down (what the runtime verlet does), like clip.py's hang."""
    if not H:
        return
    g = bpy.data.objects.get('__hair_down')
    if g is None:
        g = bpy.data.objects.new('__hair_down', None)
        sc.collection.objects.link(g)
        g.location = (0, 0, -40)
    for pb in H.pose.bones:
        if not pb.name.startswith('hair_'):
            continue
        c = pb.constraints.get('hang')
        if on and c is None:
            c = pb.constraints.new('DAMPED_TRACK')
            c.name = 'hang'
            c.target = g
            c.track_axis = 'TRACK_Y'
            c.influence = 0.9 if pb.name.endswith('_01') else 0.7
        if c:
            c.mute = not on


def head_attached():
    if H:
        H.parent, H.parent_type, H.parent_bone = H_PAR[0], H_PAR[1], H_PAR[2]
        H.matrix_parent_inverse = H_PAR[3]
        H.matrix_basis = Matrix.Identity(4)


def head_world(centre, rot):
    """Free head: `rot` = 3x3 world rotation of the rest-upright head; `centre` = where the head centre goes."""
    if not H:
        return
    H.parent = None
    R = rot.to_4x4()
    H.matrix_world = Matrix.Translation(Vector(centre) - rot @ CROWN_TO_CENTRE) @ R


def head_in_fist(rig, bone, yaw):
    """The runtime attach: crown in the fist, hanging upright (neck down), face toward plan heading `yaw`."""
    bpy.context.view_layer.update()
    p = rig.matrix_world @ rig.pose.bones[bone].head
    R = Matrix.Rotation(yaw + math.pi / 2, 3, 'Z')
    head_world(p + R @ CROWN_TO_CENTRE, R)


def eyelid(v):
    if HEAD_MESH and HEAD_MESH.data.shape_keys:
        kb = HEAD_MESH.data.shape_keys.key_blocks.get('eyelid_l_open')
        if kb:
            kb.value = v


def frame3(z_dir, x_dir):
    """3x3 rotation whose columns map rest +x -> x_dir, rest +z -> z_dir."""
    z = Vector(z_dir).normalized()
    x = Vector(x_dir)
    x = (x - z * x.dot(z)).normalized()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed()


def clip_or(rig, clip, t, fallback, ft=0.0):
    if bpy.data.actions.get(clip):
        set_pose(rig, clip, t)
        return True
    set_pose(rig, fallback, ft)
    return False


def stage(state):
    eyelid(0.0)
    head_attached()
    hair_gravity(state in ('separate', 'separate_cap', 'floor'))
    for o in harlan_meshes:
        o.hide_render = o.get('_hid_cap', False)
    if state in ('tableau', 'separate', 'separate_cap', 'floor', 'eye'):
        c2t = {'tableau': 2.4, 'separate': 7.62, 'separate_cap': 8.0, 'floor': 9.9, 'eye': 14.0}[state]
        if not clip_or(ada, 'ada_c2', c2t - 0.6, 'ada_table'):
            pass
        place(ada, 5.93, 3.3, 0.6, math.pi)
        bpy.context.view_layer.update()
        nk = bone_world(ada, 'head')                  # neck_02 -> head joint onto the doc's neck point
        ada.location += Vector((NECK.x - nk.x, NECK.y - nk.y, 0.0))
        clip_or(harlan, 'harlan_c2', c2t - 0.6, 'harlan_opening')
        hp = HARLAN if c2t < 9.1 else (5.10, 3.60, HARLAN[2])
        place(harlan, hp[0], hp[1], 0.6, hp[2])
        to_lamp = Vector((FLAME.x - HEAD_REST.x, FLAME.y - HEAD_REST.y, 0)).normalized()
        if state == 'separate':
            # ~60 ms after the separation: falling off the west edge, rolling forward
            head_world(NECK + Vector((-0.10, -0.03, -0.16)), frame3((-0.5, -0.1, 0.86), (0.2, 1, 0)))
        elif state == 'separate_cap':
            head_world(Vector((5.12, 3.18, 0.70)), frame3((1, 0, 0.1), (0, 0, 1)))
        elif state == 'floor':
            # on its LEFT side, the cut end toward the lamp (crown away from it): her parted RIGHT side (ear, jaw line,
            # cheek; fix round hair part) faces up into the lamp light and toward D
            head_world(HEAD_REST, frame3(-to_lamp, (0, 0, -1)))
        elif state == 'eye':
            head_in_fist(harlan, 'prop_l' if 'prop_l' in harlan.pose.bones else 'hand_l', math.atan2(D.y - 3.6, D.x - 5.0))
            eyelid(1.0)
    else:
        # the risen headless body, Harlan in the dark SW corner holding the head at his thigh
        if not clip_or(ada, 'ada_rise_headless', 3.95, 'ada_rise', 3.9):
            pass
        if state == 'risen':
            place(ada, RISEN.x, RISEN.y, RISEN.z, math.pi)
        else:
            clip_or(ada, 'ada_chase_headless', 0.2, 'ada_patrol', 0.5)
            place(ada, 4.45, 2.05, 0.6, math.atan2(1.50 - 2.05, 3.70 - 4.45))
        clip_or(harlan, 'harlan_c2', 24.0 - 0.6, 'harlan_pose_look_up')
        place(harlan, HARLAN_S10[0], HARLAN_S10[1], 0.6, HARLAN_S10[2])
        head_in_fist(harlan, 'prop_l' if 'prop_l' in harlan.pose.bones else 'hand_l', HARLAN_S10[2])
    grip_cleaver(state)
    if ARGS.get('debug_lift') and bpy.data.actions.get('harlan_c2'):
        for tt in (9.9, 10.6, 11.5, 12.4, 13.4, 16.0):
            set_pose(harlan, 'harlan_c2', tt)
            bpy.context.view_layer.update()
            scene.log(f'  lift dbg clip {tt}: hand_l z {bone_world(harlan, "hand_l").z:.2f} upperarm_l rot '
                      f'{tuple(round(math.degrees(a)) for a in harlan.pose.bones["upperarm_l"].rotation_euler)}')
        set_pose(harlan, 'harlan_c2', {'eye': 13.4}.get(state, 0.0)) if state == 'eye' else None
    bpy.context.view_layer.update()
    f = lambda v: tuple(round(c, 2) for c in v)
    scene.log(state, 'ada hips', f(bone_world(ada, 'hips')), 'head joint', f(bone_world(ada, 'head')),
              '| harlan hand_r', f(bone_world(harlan, 'hand_r')), 'hand_l', f(bone_world(harlan, 'hand_l')),
              '| head node', f(H.matrix_world.translation) if H else None)
    if 'cleaver_edge' in harlan.pose.bones:
        scene.log('  cleaver_edge', f(bone_world(harlan, 'cleaver_edge')), 'neck', f(NECK))


cam_d = bpy.data.cameras.new('c2')
cam = bpy.data.objects.new('c2', cam_d)
sc.collection.objects.link(cam)
sc.camera = cam
cam_d.clip_start = 0.02
cam_d.sensor_fit = 'HORIZONTAL'
cam_d.sensor_width = 38.4          # 50 mm -> 42.0 deg horizontal (the 16:10 frame, §conventions)


def aim(eye, tgt, lens):
    cam.location = eye
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = (tgt - eye).to_track_quat('-Z', 'Y')
    cam_d.lens = lens


def render(path, res, spp, exr):
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.cycles.samples = spp
    s = sc.render.image_settings
    s.file_format = 'OPEN_EXR' if exr else 'PNG'
    s.color_mode = 'RGB'
    if exr:
        s.color_depth = '32'
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def meter(path):
    img = bpy.data.images.load(str(path), check_existing=False)
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    a = a.reshape(h, w, 4)
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    yy, xx = np.mgrid[0:h, 0:w]
    ell = ((xx - w / 2) / (w * 0.22)) ** 2 + ((yy - h / 2) / (h * 0.3)) ** 2 <= 1.0
    lg = np.log(np.maximum(lum, 1e-5))
    lavg = float(np.exp(0.6 * lg[ell].mean() + 0.4 * lg.mean()))
    mult = min(8.0, max(0.7, 0.12 / max(lavg, 1e-6)))
    return lavg, mult, float(np.percentile(lum[ell], 95))


def coverage(out_name='coverage'):
    """A14 (fix round): the carried head's face coverage from 12 gameplay angles (doc §4.6: >= 90 % each).
    Ada mid-chase with her own head at prop_r (crown in the fist, face toward her right thigh), the hair chains hanging
    to world-down. All lights off, world black, every object but Ada hidden; the FACE polygons of ada_head (front-facing,
    hairline .. chin) emit white. Per view: face px with the hair vs without -> coverage = 1 - with / without.
    Cameras: a 1.6 m eye (floor z 0.6) at 2.0 m, every 30 deg around the head, 60 deg vertical FOV."""
    stage('walk')
    hd = math.atan2(1.50 - 2.05, 3.70 - 4.45)
    if 'prop_r' in ada.pose.bones:
        head_in_fist(ada, 'prop_r', hd + math.pi / 2)
    hair_gravity(True)
    bpy.context.view_layer.update()
    keep = set(ada_meshes) | {ada, H} | (set(H.children_recursive) if H else set())
    for o in sc.objects:
        if o.type in ('MESH', 'CURVE', 'LIGHT', 'EMPTY') and o not in keep and o is not cam:
            o.hide_render = True
    sc.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0
    me = HEAD_MESH.data
    zs = [v.co.z for v in me.vertices]
    zmax = max(zs)
    white = bpy.data.materials.new('__face')
    white.use_nodes = True
    nt = white.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = 1.0
    o_ = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs[0], o_.inputs[0])
    HEAD_MESH.data.materials.append(white)
    wi = len(HEAD_MESH.data.materials) - 1
    old = [p.material_index for p in me.polygons]
    nface = 0
    for p in me.polygons:
        c = p.center
        if p.normal.dot(Vector((0, -1, 0))) > 0.3 and zmax - 0.245 < c.z < zmax - 0.07:
            p.material_index = wi
            nface += 1
    for m in bpy.data.materials:                     # nothing else may glow (flame meshes etc. are hidden anyway)
        pass
    hair = bpy.data.objects.get('ada_hair')
    sc.cycles.use_denoising = False
    head_c = H.matrix_world @ CROWN_TO_CENTRE if H else bone_world(ada, 'head')
    floor_z = 0.6
    rows = []
    cam_d.sensor_fit = 'VERTICAL'
    cam_d.sensor_height = 24.0
    cam_d.lens = 24.0 / (2 * math.tan(math.radians(30)))
    for k in range(12):
        az = math.radians(30 * k)
        eye = Vector((head_c.x + 2.0 * math.cos(az), head_c.y + 2.0 * math.sin(az), floor_z + 1.6))
        cam.location = eye
        cam.rotation_mode = 'QUATERNION'
        cam.rotation_quaternion = (head_c - eye).to_track_quat('-Z', 'Y')
        cnt = []
        for hide in (False, True):
            if hair:
                hair.hide_render = hide
            path = OUT / f'__cov_{k}_{int(hide)}.exr'
            render(path, (960, 540), 8, True)     # fix round: 4x the face px (480x270 left 3-30 px views)
            img = bpy.data.images.load(str(path), check_existing=False)
            a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
            img.pixels.foreach_get(a)
            bpy.data.images.remove(img)
            path.unlink(missing_ok=True)
            cnt.append(int((a.reshape(-1, 4)[:, 0] > 0.3).sum()))
        cov = None if cnt[1] < 30 else round(1.0 - cnt[0] / cnt[1], 3)
        rows.append({'az': 30 * k, 'face_px_hair': cnt[0], 'face_px_bare': cnt[1], 'coverage': cov})
        scene.log(f'coverage az {30 * k:3d}: {rows[-1]}')
    for p, mi in zip(me.polygons, old):
        p.material_index = mi
    vals = [r['coverage'] for r in rows if r['coverage'] is not None]
    summ = {'face_polys': nface, 'views': rows, 'min': min(vals) if vals else None,
            'mean': round(sum(vals) / len(vals), 3) if vals else None, 'pass_90': all(v >= 0.9 for v in vals)}
    (OUT / f'{out_name}.json').write_text(json.dumps(summ, indent=1))
    scene.log('COVERAGE', json.dumps({k: v for k, v in summ.items() if k != 'views'}))


if ARGS.get('which'):      # fix round 2: which meshes have vertices in the halo-ring zone over the risen stump?
    stage('risen')
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    j = bone_world(ada, 'head')
    for o in sc.objects:
        if o.type != 'MESH' or o.hide_render:
            continue
        ev = o.evaluated_get(dg)
        mw = ev.matrix_world
        near = [mw @ v.co for v in ev.data.vertices if (mw @ v.co - j).length < float(ARGS.get('which_r', 0.14))]
        if near:
            zs = [p.z - j.z for p in near]
            scene.log(f'WHICH {o.name}: {len(near)} verts within 14 cm of the head joint, dz {min(zs):.3f}..{max(zs):.3f}')
            if o.name == 'ada_body':
                from collections import Counter
                gn = {g.index: g.name for g in o.vertex_groups}
                cnt, rz = Counter(), []
                for v, ve in zip(o.data.vertices, ev.data.vertices):
                    pw = mw @ ve.co
                    if (pw - j).length < 0.14 and pw.z - j.z > -0.01:
                        gs = sorted(((g.weight, gn[g.group]) for g in v.groups), reverse=True)
                        cnt[' '.join(f'{n}:{w:.2f}' for w, n in gs[:2])] += 1
                        rz.append(v.co.z)
                scene.log(f'WHICH body dz>-1cm: {len(rz)} verts, rest z {min(rz, default=0):.3f}..{max(rz, default=0):.3f}, groups {cnt.most_common(8)}')
                capf = set(o.data.get('_cap_faces', []))
                capv = {vi for f in o.data.polygons if f.index in capf for vi in f.vertices}
                scene.log(f'WHICH cap faces stored {len(capf)}, cap verts {len(capv)}')
                for lab, sel in (('cap', capv), ('noncap', set(range(len(o.data.vertices))) - capv)):
                    ds = [((mw @ ev.data.vertices[i].co) - (mw @ o.data.vertices[i].co)).length for i in sel
                          if o.data.vertices[i].co.z > 1.38 and abs(o.data.vertices[i].co.x) < 0.07]
                    if ds:
                        scene.log(f'WHICH {lab} z>1.38: n {len(ds)} displacement-from-rest(world) {min(ds):.3f}..{max(ds):.3f} mean {sum(ds)/len(ds):.3f}')
                # the same verts' evaluated z relative to the joint
                for lab, sel in (('cap', capv), ('noncap', set(range(len(o.data.vertices))) - capv)):
                    zz = [(mw @ ev.data.vertices[i].co).z - j.z for i in sel if o.data.vertices[i].co.z > 1.38 and abs(o.data.vertices[i].co.x) < 0.07]
                    if zz:
                        scene.log(f'WHICH {lab} z>1.38 posed dz {min(zz):.3f}..{max(zz):.3f}')
                hz = [v.co.z for v in o.data.vertices]
                scene.log(f'WHICH body rest z max {max(hz):.3f}; cut-ish verts z>1.40: {sum(1 for z in hz if z > 1.40)}')
    want = []

# fix round: --coverage 1 [--views a,b] -> the views render first (coverage hides the scene and does not restore it)
if ARGS.get('coverage') and not ARGS.get('views'):
    want = []

report = {}
for name in want:
    eye, tgt, lens, state = VIEWS[name]
    t0 = time.perf_counter()
    stage(state)
    if name == 'stump05':
        for o in harlan_meshes:
            o.hide_render = True
        j = bone_world(ada, 'head')
        ax = (j - bone_world(ada, 'neck_01')).normalized()
        side = ax.cross(Vector((0, 0, 1))).normalized()
        eye = j + ax * 0.45 + side * 0.12 + Vector((0, 0, 0.12))
        tgt = j
    if tgt is None:      # aim at the eye mesh
        eo = bpy.data.objects.get('ada_eye')
        dg = bpy.context.evaluated_depsgraph_get()
        ev = eo.evaluated_get(dg)
        tgt = sum((ev.matrix_world @ v.co for v in ev.data.vertices), Vector()) / len(ev.data.vertices)
    aim(eye, tgt, lens)
    for hn in [h for h in str(ARGS.get('hide', '')).split(',') if h]:      # fix round 2 diagnostics
        if bpy.data.objects.get(hn):
            bpy.data.objects[hn].hide_render = True
    sc.view_settings.exposure = 0.0
    mp = OUT / f'__meter_{name}.exr'
    render(mp, (RES[0] // 4, RES[1] // 4), 16, True)
    lavg, mult, p95 = meter(mp)
    sc.view_settings.exposure = math.log2(mult)
    render(OUT / f'{name}.png', RES, SPP, False)
    report[name] = {'lavg': round(lavg, 5), 'mult': round(mult, 3), 'ev': round(math.log2(mult), 2),
                    'p95_spot': round(p95, 4), 's': round(time.perf_counter() - t0, 1)}
    scene.log(f'{name}: {report[name]}')
(OUT / 'meter.json').write_text(json.dumps(report, indent=1))
if ARGS.get('coverage'):
    coverage()
scene.result({'job': 'c2-review', 'ok': True, 'views': report, 'device': used, 'samples': SPP})
