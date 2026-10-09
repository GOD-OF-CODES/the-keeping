"""Review renders of the County Road 9 corridor (called by corridor.py --review; manual job `corridor-review`).

Shots (config scratch/opening/corridor_review.json: shots, samples, res, car_s):
  pov     westbound driver eye at s = car_s (24 mm), low beams 15 kcd hot spot / 2.5 kcd spread / 0.8 kcd foreground
  aerial  C0 shot 1: 140 m up over s 700 looking west, 28 mm, a lightning flash (7500 K sun) + moonlit dome
  dark    the same aerial without the flash: one pair of headlights in black forest (exposure 24)
  walls   C1 S6: 28 m above and behind the car, 35 mm, beams only (exposure 17)
  edge    the hero edge pines lit by the beams from the lane (exposure 1.7)
Photometry as the cabin review (Blender W ~ lm, W/m^2 ~ lux; film exposure = log2(game exposure)).
-> scratch/opening/corridor_<shot>.png + corridor_sheet.png
"""
import json
import math

import bpy
import numpy as np
from mathutils import Vector

from lib.scene import REPO, log, setup_cycles
from props import registry
from house import road_rc9 as RD
from house import scene_prep

OUT = REPO / 'scratch' / 'opening'
CFG = {'shots': ['pov', 'aerial', 'walls', 'edge'], 'samples': 24, 'res': [800, 500], 'car_s': 300.0}
p_ = OUT / 'corridor_review.json'
if p_.exists():
    CFG.update(json.loads(p_.read_text()))


def car_frame(s, n=1.75):
    """Westbound car at chainage s: origin, forward (−s), right."""
    x, y, h = RD.frame(s)
    o = Vector(RD.point(s, n))
    f = Vector((-math.cos(h), -math.sin(h), 0.0))
    r = Vector((f.y, -f.x, 0.0))
    return o, f, r


def to_plan(s, local):
    o, f, r = car_frame(s)
    return o + r * local[0] + f * local[1] + Vector((0, 0, local[2]))


def spot(coll, name, pos, aim, size_deg, blend, cd, kelvin, radius=0.04):
    ld = bpy.data.lights.new(name, 'SPOT')
    ld.energy = cd * 4 * math.pi
    ld.spot_size = math.radians(size_deg)
    ld.spot_blend = blend
    ld.color = scene_prep.kelvin_rgb(kelvin)
    ld.shadow_soft_size = radius
    ob = bpy.data.objects.new(name, ld)
    coll.objects.link(ob)
    ob.location = pos
    ob.rotation_euler = Vector(aim).to_track_quat('-Z', 'Y').to_euler()
    return ob


def render(objs, coll):
    sc = bpy.context.scene
    setup_cycles(int(CFG['samples']), 'GPU', max_bounces=6, diffuse_bounces=3)
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = CFG['res']
    sc.render.image_settings.file_format = 'PNG'
    sc.view_settings.view_transform = 'AgX'
    scene_prep.night_world(1.0)
    moon = bpy.data.lights.new('_moon', 'SUN')
    moon.energy = 0.004
    moon.color = scene_prep.kelvin_rgb(4100)
    mo = bpy.data.objects.new('_moon', moon)
    coll.objects.link(mo)
    mo.rotation_euler = (math.radians(45), 0, math.radians(150))
    flash = bpy.data.lights.new('_flash', 'SUN')
    flash.energy = 1.0
    flash.angle = math.radians(8)
    flash.color = scene_prep.kelvin_rgb(7800)
    fo = bpy.data.objects.new('_flash', flash)
    coll.objects.link(fo)
    fo.rotation_euler = (math.radians(35), 0, math.radians(-120))
    # the car (exterior sedan) + its low beams
    s_car = float(CFG['car_s'])
    car = registry.build('sedan', {'plate': 'RVX-318', 'paint': 'car_paint_sedan', 'interior': 'car_interior_tan'},
                         collection=coll)
    o, f, r = car_frame(s_car)
    car[0].location = o
    car[0].rotation_euler = (0, 0, math.atan2(f.x, -f.y))
    for ob in car:
        if ob.get('lamp') == 'head':
            m = ob.data.materials
            em = bpy.data.materials.new('_headlens')
            b = next(n for n in em.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
            b.inputs['Emission Color'].default_value = (*scene_prep.kelvin_rgb(3200), 1)
            b.inputs['Emission Strength'].default_value = 40000.0
            for i in range(len(m)):
                m[i] = em
        if ob.get('lamp') == 'tail':
            m = ob.data.materials
            em = bpy.data.materials.new('_taillens')
            b = next(n for n in em.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
            b.inputs['Emission Color'].default_value = (0.8, 0.03, 0.02, 1)
            b.inputs['Emission Strength'].default_value = 60.0
            for i in range(len(m)):
                m[i] = em
    beams = []
    for sx in (-1, 1):
        p = to_plan(s_car, (sx * 0.62, 2.45, 0.64))
        fwd = f
        beams.append(spot(coll, f'_hot{sx}', p, fwd + Vector((0, 0, -math.tan(math.radians(1.5)))), 14, 0.85, 15000, 3200))
        beams.append(spot(coll, f'_spr{sx}', p, fwd + Vector((0, 0, -math.tan(math.radians(2.5)))), 60, 1.0, 2500, 3200))
        beams.append(spot(coll, f'_fg{sx}', p, fwd + Vector((0, 0, -math.tan(math.radians(7)))), 100, 1.0, 800, 3200))
    cam_d = bpy.data.cameras.new('_cam')
    cam_d.sensor_fit = 'VERTICAL'
    cam_d.sensor_height = 24.0
    cam_d.clip_start = 0.05
    cam_d.clip_end = 3000
    cam = bpy.data.objects.new('_cam', cam_d)
    coll.objects.link(cam)
    sc.camera = cam
    eye = to_plan(s_car, (-0.35, -0.05, 1.12))
    shots = {
        'pov': (eye, eye + f * 30 + Vector((0, 0, -1.4)), 24, 1.7, False),
        'aerial': (Vector(RD.point(760, 0, 140)), Vector(RD.point(380, 0, 0)), 28, 6.0, True),
        'dark': (Vector(RD.point(760, 0, 140)), Vector(RD.point(380, 0, 0)), 28, 24.0, False),
        'walls': (to_plan(s_car, (0.0, -40.0, 28.0)), to_plan(s_car, (0.0, 8.0, 0.0)), 35, 17.0, False),
        'edge': (to_plan(s_car, (0.4, 1.0, 1.2)), Vector(RD.point(s_car - 22, 11.0, 5.0)), 24, 1.7, False),
    }
    cm = bpy.data.materials.get('canopy_far')
    if cm:          # a canopy proxy has no smooth specular sheet (needle clumps scatter it)
        b = next(n for n in cm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        b.inputs['Specular IOR Level'].default_value = 0.1
    for ob in objs:
        if CFG.get('hide_canopy') and ob.get('canopy'):
            ob.hide_render = True
    files = []
    for name in CFG['shots']:
        e, t, lens, expo, fl = shots[name]
        fo.hide_render = not fl
        for ob in car:                       # the POV camera sits inside the shell: hide the body for that shot
            ob.hide_render = name == 'pov'
        cam.location = e
        cam.rotation_euler = (t - e).to_track_quat('-Z', 'Y').to_euler()
        cam_d.lens = lens
        sc.view_settings.exposure = math.log2(expo)
        path = OUT / f'corridor_{name}.png'
        sc.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        files.append(path)
        log(f'rendered {path.name}')
    _sheet(files, OUT / 'corridor_sheet.png')


def _sheet(files, out, cols=2, tw=480, th=300):
    rows = math.ceil(len(files) / cols)
    S = np.zeros((rows * th, cols * tw, 4), np.float32)
    S[..., 3] = 1
    for i, f in enumerate(files):
        im = bpy.data.images.load(str(f), check_existing=False)
        w, h = im.size
        a = np.empty(w * h * 4, np.float32)
        im.pixels.foreach_get(a)
        a = a.reshape(h, w, 4)[::-1]
        ys = (np.arange(th) * h / th).astype(int)
        xs = (np.arange(tw) * w / tw).astype(int)
        r, c = divmod(i, cols)
        S[r * th:(r + 1) * th, c * tw:(c + 1) * tw] = a[ys][:, xs]
        bpy.data.images.remove(im)
    img = bpy.data.images.new('_sheet', S.shape[1], S.shape[0], alpha=False)
    img.pixels.foreach_set(S[::-1].ravel())
    img.filepath_raw = str(out)
    img.file_format = 'PNG'
    img.save()
