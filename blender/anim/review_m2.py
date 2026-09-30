"""Big review tiles for chosen clips (dev): opens .cache/anims/<char>_anim.blend (written by build_anims.py) and
renders K frames per clip, one or two views, into scratch/characters/m2_<clip>.png. Socket bones get small marker
spheres so prop contacts can be judged.

  node blender/characters/dev.mjs blender/anim/review_m2.py --char ada --clips ada_sting,ada_finale [--k 5] [--views front,side]
"""
import bpy
import numpy as np
from mathutils import Matrix, Vector

from lib.scene import CACHE, job_args, log
from characters import review

ARGS = job_args()
CHAR = ARGS.get('char', 'ada')
CLIPS = [c for c in (ARGS.get('clips') or '').split(',') if c]
K = int(ARGS.get('k', 5))
VIEWS = (ARGS.get('views') or ('cam' if CHAR == 'arms' else 'front,side')).split(',')
TILE = (560, 700) if CHAR != 'arms' else (640, 480)

try:
    from props.preview import draw_text
except Exception:  # pragma: no cover
    def draw_text(*a, **k):
        return 0


def markers(rig):
    ad = rig.animation_data
    ad.use_nla = False
    ad.action = None
    for pb in rig.pose.bones:
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()
    mat = bpy.data.materials.new('__marker')
    mat.diffuse_color = (1.0, 0.25, 0.1, 1.0)
    for name in ('prop_r', 'prop_l', 'locket', 'jaw_hold', 'cleaver'):
        b = rig.data.bones.get(name)
        if b is None:
            continue
        me = bpy.data.meshes.new('__m_' + name)
        import bmesh
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=0.014 if CHAR != 'arms' else 0.01)
        if name == 'locket':           # a flat disc showing the photo face (+Y) and hinge (+Z)
            bm.clear()
            bmesh.ops.create_circle(bm, cap_ends=True, segments=16, radius=0.016)
            bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(1.5708, 3, 'X'))
        bm.to_mesh(me)
        bm.free()
        me.materials.append(mat)
        ob = bpy.data.objects.new('__m_' + name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = rig
        ob.parent_type = 'BONE'
        ob.parent_bone = name
        bpy.context.view_layer.update()
        M = rig.matrix_world @ rig.pose.bones[name].matrix
        ob.matrix_world = M
    ad.use_nla = True


def view(cam, name):
    if CHAR == 'arms':
        if name == 'side':
            review.look(cam, (0.95, 0.05, 0.25), (0.0, 0.3, -0.18), 24)
        elif name == 'front':
            review.look(cam, (0.1, 1.05, 0.0), (0.02, 0.35, -0.15), 30)
        elif name == 'top':
            review.look(cam, (0.1, 0.25, 0.9), (0.0, 0.3, -0.2), 24)
        else:
            review.look(cam, (0.0, 0.0, 0.0), (0.0, 1.0, -0.12), 16)
        return
    h = 1.9 if CHAR == 'harlan' else 1.62
    if name == 'front':
        review.look(cam, (1.05, -1.9, 1.2), (0, -0.25, 0.78 * h / 1.62), 35)
    elif name == 'side':
        review.look(cam, (2.2, -0.3, 1.0), (0, -0.25, 0.78 * h / 1.62), 35)
    elif name == 'back':
        review.look(cam, (-1.2, 2.6, 1.3), (0, -0.2, 0.8 * h / 1.62), 35)
    elif name == 'close':
        review.look(cam, (0.9, -1.5, 1.35), (0, -0.3, 1.1), 40)


def main():
    bpy.ops.wm.open_mainfile(filepath=str(CACHE / 'anims' / f'{CHAR}_anim.blend'))
    rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE' and o.get('character') == CHAR)
    markers(rig)
    review.workbench(TILE)
    sc = bpy.context.scene
    sc.display.shading.color_type = 'MATERIAL'
    cam = review._camera()
    if CHAR == 'arms':
        cam.data.sensor_fit = 'VERTICAL'
    ad = rig.animation_data
    for cname in CLIPS:
        act = bpy.data.actions.get(cname)
        if act is None:
            log(f'no action {cname}')
            continue
        ad.use_nla = False
        ad.action = act
        ad.action_slot = act.slots[0]
        n = int(round(act.frame_range[1]))
        rows = []
        for v in VIEWS:
            tiles = []
            for k in range(K):
                f = 1 + int(round((n - 1) * k / max(K - 1, 1)))
                sc.frame_set(f)
                view(cam, v)
                a = review.render_to_array(review.OUT / '__m2.png')
                draw_text(a, 6, 6, f'{cname} {v} {(f - 1) / 30:.2f}S', scale=2)
                tiles.append(a)
            rows.append(np.concatenate(tiles, 1))
        sheet = np.concatenate(rows, 0)
        H, W = sheet.shape[:2]
        img = bpy.data.images.new('__s', W, H)
        img.pixels.foreach_set(np.ascontiguousarray(sheet[::-1]).ravel())
        img.filepath_raw = str(review.OUT / f'm2_{cname}.png')
        img.file_format = 'PNG'
        img.save()
        bpy.data.images.remove(img)
        log(f'wrote m2_{cname}.png ({n} frames)')


main()
