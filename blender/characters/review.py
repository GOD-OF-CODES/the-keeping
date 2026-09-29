"""Review renders for characters: fast Workbench shape sheets and dim, moody Cycles key poses (scratch/characters/).

sheet(views, path): renders each (name, cam_loc, target, lens) view and tiles them into one labelled PNG.
"""
import math
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

from lib.scene import REPO, log

OUT = REPO / 'scratch' / 'characters'


def _camera():
    cam = bpy.data.objects.get('__review_cam')
    if cam is None:
        cd = bpy.data.cameras.new('__review_cam')
        cam = bpy.data.objects.new('__review_cam', cd)
        bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam


def look(cam, loc, target, lens=50.0):
    cam.location = Vector(loc)
    d = Vector(target) - Vector(loc)
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = d.to_track_quat('-Z', 'Y')
    cam.data.lens = lens
    cam.data.clip_start = 0.01


def workbench(res=(420, 640)):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_cavity = True
    sh.cavity_type = 'BOTH'
    sh.show_shadows = False
    sh.show_specular_highlight = True
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'


def cycles(res=(480, 720), samples=48):
    sc = bpy.context.scene
    from lib.scene import setup_cycles
    setup_cycles(samples, device='GPU')
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 6
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'None'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'


def render_to_array(path):
    sc = bpy.context.scene
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(str(path), check_existing=False)
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)[::-1]     # top-down


def sheet(views, path, label=None):
    """views: list of (label, cam_loc, target, lens). Returns path of the tiled PNG."""
    try:
        from props.preview import draw_text
    except Exception:          # labels are optional (props lane owns the bitmap font)
        def draw_text(*a, **k):
            return 0
    OUT.mkdir(parents=True, exist_ok=True)
    cam = _camera()
    tiles = []
    tmp = OUT / '__tile.png'
    for (lab, loc, tgt, lens) in views:
        look(cam, loc, tgt, lens)
        a = render_to_array(tmp)
        draw_text(a, 6, 6, lab, scale=2)
        tiles.append(a)
    tmp.unlink(missing_ok=True)
    h = max(t.shape[0] for t in tiles)
    row = np.concatenate([np.pad(t, ((0, h - t.shape[0]), (0, 0), (0, 0))) for t in tiles], 1)
    if label:
        draw_text(row, 6, h - 22, label, scale=2)
    H, W = row.shape[:2]
    img = bpy.data.images.new('__sheet', W, H, alpha=False)
    img.pixels.foreach_set(np.ascontiguousarray(row[::-1]).ravel())
    img.filepath_raw = str(path)
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    log('review sheet', path)
    return path


def studio_lights(strength=1.0):
    """Neutral review lighting for Cycles (dim): key, rim, faint fill."""
    for nm, loc, e, size in (('__key', (1.2, -2.0, 2.6), 180, 1.2), ('__rim', (-1.4, 2.0, 2.2), 120, 0.8),
                             ('__fill', (-2.0, -1.5, 1.0), 25, 2.0)):
        ld = bpy.data.lights.new(nm, 'AREA')
        ld.energy = e * strength
        ld.size = size
        lo = bpy.data.objects.new(nm, ld)
        bpy.context.scene.collection.objects.link(lo)
        lo.location = loc
        lo.rotation_mode = 'QUATERNION'
        lo.rotation_quaternion = (Vector((0, 0, 1.0)) - Vector(loc)).to_track_quat('-Z', 'Y')


def floor(size=6.0, rgb=(0.05, 0.045, 0.04)):
    bpy.ops.mesh.primitive_plane_add(size=size)
    f = bpy.context.active_object
    f.name = '__floor'
    m = bpy.data.materials.new('__floor')
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = 0.8
    f.data.materials.append(m)
    return f


def turnaround(center_z, dist, height=None, lens=50, n=4, start=0.0):
    views = []
    for i in range(n):
        ang = math.radians(start + i * 360.0 / n)
        loc = (math.sin(ang) * dist, -math.cos(ang) * dist, height if height is not None else center_z)
        views.append((f'{int(start + i * 360 / n)}', loc, (0, 0, center_z), lens))
    return views
