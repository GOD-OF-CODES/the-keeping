"""Review renders of the house shell (Cycles, layout lights, AgX): scratch/house/<view>.png.

  render_review.py -- [--samples 48] [--res 960x540] [--views hall,parlor,...] [--exposure 4] [--fill 0]

Views use layout cameras / spawns. 'leak' renders the hall with every interior light off and a bright sky:
any bright seam inside the house is a crack in the shell.
"""
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from lib import scene  # noqa: E402
from house import scene_prep  # noqa: E402
from house.plan import Plan  # noqa: E402

args = scene.job_args()
SPP = int(args.get('samples', 48))
RES = [int(v) for v in str(args.get('res', '960x540')).split('x')]
OUT = Path(args.get('out', scene.REPO / 'scratch' / 'house'))
BLEND = Path(args.get('blend', scene.CACHE / 'house' / 'house.blend'))
FILL = float(args.get('fill', 0.0))
OUT.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=str(BLEND))
P = Plan()
L = P.L
cams = {c['id']: c for c in L['cameras']}
spawns = {s['id']: s for s in L['spawns']}


def spawn_view(sid, fov=70, pitch=None, dz=0.0):
    s = spawns[sid]
    p = Vector(s['pos']) + Vector((0, 0, dz))
    yaw = s['yaw']
    pt = s['pitch'] if pitch is None else pitch
    t = p + Vector((math.cos(yaw) * math.cos(pt), math.sin(yaw) * math.cos(pt), math.sin(pt)))
    return (p, t, fov)


VIEWS = {
    # name: (pos, target, fov, exposure, mode)
    'hall': ((2.6, 0.45, 2.2), (1.2, 7.5, 2.4), 72, 2.0, 'lit'),
    'stair': ((3.2, 2.2, 1.9), (0.4, 6.2, 2.6), 70, 2.0, 'lit'),
    'parlor': (tuple(cams['parlor_threshold']['pos']), tuple(cams['parlor_threshold']['target']),
               cams['parlor_threshold']['fovDeg'], 2.0, 'lit'),
    'upper_hall': ((2.5, 0.5, 5.75), (1.9, 8.6, 5.3), 72, 5.0, 'lit'),
    'u1_stairwell': ((2.9, 8.4, 5.9), (0.7, 5.0, 4.4), 70, 5.0, 'lit'),
    'facade': (tuple(cams['porch_approach']['pos']), tuple(cams['porch_approach']['target']),
               cams['porch_approach']['fovDeg'], 2.5, 'lit'),
    'house_sw': ((-9.0, -15.0, 4.0), (4.0, 4.0, 4.5), 50, 2.5, 'lit'),
    'porch': ((6.5, -4.6, 1.7), (0.5, -0.5, 1.9), 70, 5.0, 'lit'),
    'c_chimney': ((17.0, -3.0, 5.0), (8.0, 4.0, 6.0), 55, 0.0, 'clay'),
    'kitchen': ((4.3, 7.0, 2.2), (8.5, 10.5, 1.8), 72, 4.5, 'lit'),
    'backstair': ((8.35, 10.2, 1.7), (7.0, 11.3, 2.6), 72, 5.0, 'lit'),
    'u2': ((4.2, 0.5, 5.7), (8.5, 4.2, 5.0), 72, 5.0, 'lit'),
    'u3': ((4.2, 5.0, 5.7), (8.6, 8.8, 5.0), 72, 5.0, 'lit'),
    'leak': ((2.6, 0.45, 2.2), (1.2, 7.5, 2.4), 72, 0.0, 'leak'),
    # clay views: white override material + a light on the camera, to judge geometry only
    'c_stair': ((2.9, 3.0, 1.7), (0.6, 5.2, 1.9), 65, 0.0, 'clay'),
    'c_stair_top': ((2.4, 8.3, 5.9), (0.6, 5.8, 4.2), 70, 0.0, 'clay'),
    'c_hall': ((2.6, 0.45, 2.2), (1.2, 7.5, 2.4), 72, 0.0, 'clay'),
    'c_parlor_door': ((2.2, 1.5, 1.8), (3.6, 1.5, 1.7), 70, 0.0, 'clay'),
    'c_window': ((6.2, 1.9, 1.9), (5.0, -0.2, 1.9), 60, 0.0, 'clay'),
    'c_porch': ((5.5, -4.2, 1.3), (1.8, -1.8, 1.0), 65, 0.0, 'clay'),
    'c_eave': ((-2.5, -3.5, 6.2), (0.2, 0.5, 7.2), 60, 0.0, 'clay'),
    'c_backstair': ((7.6, 11.25, 2.1), (5.4, 11.25, 3.9), 75, 0.0, 'clay'),
    'c_backstair_top': ((5.0, 9.6, 5.8), (6.2, 11.2, 4.2), 75, 0.0, 'clay'),
    'c_upper': ((2.5, 0.5, 5.75), (1.9, 8.6, 5.3), 72, 0.0, 'clay'),
    'c_kitchen': ((4.3, 7.0, 2.2), (8.5, 10.5, 1.8), 72, 0.0, 'clay'),
    'x_stair': ((4.6, 2.0, 3.2), (0.5, 5.8, 2.0), 60, 0.0, 'clay'),
}
# the same framings rendered from the BAKED lightmaps (emission = lightmap texel x albedo, like the runtime)
for _n in ('hall', 'stair', 'parlor', 'upper_hall', 'facade', 'house_sw', 'porch', 'kitchen', 'u2', 'u3'):
    _v = VIEWS[_n]
    VIEWS['b_' + _n] = (_v[0], _v[1], _v[2], _v[3], 'baked')
ISO = [n for n in str(args.get('isolate', '')).split(',') if n]
if ISO:
    for ob in bpy.data.objects:
        if ob.type == 'MESH' and not any(ob.name.startswith(n) for n in ISO):
            ob.hide_render = True
want = str(args.get('views', ','.join(VIEWS))).split(',')

sc = bpy.context.scene
used = scene.setup_cycles(SPP, device='GPU', max_bounces=6, diffuse_bounces=4)
sc.cycles.use_denoising = True
try:
    sc.cycles.denoiser = 'OPENIMAGEDENOISE'
except Exception:
    pass
sc.render.resolution_x, sc.render.resolution_y = RES
sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = 'PNG'
try:
    sc.view_settings.view_transform = 'AgX'
except Exception:
    sc.view_settings.view_transform = 'Filmic'

scene_prep.glass_transmissive()
scene_prep.pose_doors()
scene_prep.ground(P)
lights_lit = scene_prep.add_lights(L, ('bake', 'bake_flicker'))
cam_d = bpy.data.cameras.new('review')
cam = bpy.data.objects.new('review', cam_d)
sc.collection.objects.link(cam)
sc.camera = cam
cam_d.clip_start = 0.02
clay = bpy.data.materials.new('clay')
clay.diffuse_color = (0.6, 0.6, 0.6, 1)
from lib import materials as _m  # noqa: E402
_m.principled(clay).inputs['Base Color'].default_value = (0.55, 0.55, 0.55, 1)
_m.principled(clay).inputs['Roughness'].default_value = 0.8
camlight = bpy.data.objects.new('camlight', bpy.data.lights.new('camlight', 'POINT'))
camlight.data.energy = 60.0
camlight.data.shadow_soft_size = 0.15
sc.collection.objects.link(camlight)
done = {}
baked_ready = False


def use_lightmaps():
    """Swap every lightmapped object's materials for emission = lightmap(uv1) x albedo (.cache/bake/*.npz)."""
    import numpy as np
    imgs = {}
    for ob in bpy.data.objects:
        if ob.type != 'MESH' or not ob.get('atlas') or ob.get('detail') or 'Lightmap' not in ob.data.uv_layers:
            continue
        lm = ob['lightmap']
        if lm not in imgs:
            f = scene.CACHE / 'bake' / f'{lm}.npz'
            if not f.exists():
                continue
            rgb = np.load(f)['rgb']
            h, w = rgb.shape[:2]
            im = bpy.data.images.new(lm, w, h, alpha=True, float_buffer=True)
            im.colorspace_settings.name = 'Linear Rec.709'
            rgba = np.concatenate([rgb, np.ones((h, w, 1), np.float32)], 2)
            im.pixels.foreach_set(rgba.ravel())
            imgs[lm] = im
        if lm not in imgs:
            continue
        for i, mat in enumerate(ob.data.materials):
            key = f'{mat.name}__{lm}'
            nm = bpy.data.materials.get(key)
            if nm is None:
                from lib import materials as mm
                alb = mm.principled(mat).inputs['Base Color'].default_value[:] if mat.node_tree else (0.5, 0.5, 0.5, 1)
                nm = bpy.data.materials.new(key)
                nt = nm.node_tree
                for n in list(nt.nodes):
                    if n.type != 'OUTPUT_MATERIAL':
                        nt.nodes.remove(n)
                out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
                uvn = nt.nodes.new('ShaderNodeUVMap')
                uvn.uv_map = 'Lightmap'
                tex = nt.nodes.new('ShaderNodeTexImage')
                tex.image = imgs[lm]
                tex.interpolation = 'Linear'
                mul = nt.nodes.new('ShaderNodeMix')
                mul.data_type = 'RGBA'
                mul.blend_type = 'MULTIPLY'
                mul.inputs['Factor'].default_value = 1.0
                mul.inputs['B'].default_value = alb
                em = nt.nodes.new('ShaderNodeEmission')
                nt.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
                nt.links.new(tex.outputs['Color'], mul.inputs['A'])
                nt.links.new(mul.outputs['Result'], em.inputs['Color'])
                if mat.get('material_id') in ('glass_grimy', 'glass_rain'):
                    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
                    mx = nt.nodes.new('ShaderNodeMixShader')
                    mx.inputs['Fac'].default_value = 0.1
                    nt.links.new(tr.outputs[0], mx.inputs[1])
                    nt.links.new(em.outputs[0], mx.inputs[2])
                    nt.links.new(mx.outputs[0], out.inputs['Surface'])
                else:
                    nt.links.new(em.outputs[0], out.inputs['Surface'])
            ob.data.materials[i] = nm
for name in want:
    if name not in VIEWS:
        continue
    pos, tgt, fov, ev, mode = VIEWS[name]
    cam.location = Vector(pos)
    cam.rotation_euler = (Vector(tgt) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()
    cam_d.angle = math.radians(fov) if fov > 1 else fov
    cam_d.sensor_fit = 'VERTICAL' if fov < 60 else 'HORIZONTAL'
    if name in ('parlor', 'facade'):
        cam_d.sensor_fit = 'VERTICAL'
    sc.view_settings.exposure = ev
    for ob in lights_lit:
        ob.hide_render = mode in ('leak', 'clay')
    camlight.hide_render = mode != 'clay'
    camlight.location = cam.location + Vector((0.0, 0.0, 0.25))
    sc.view_layers[0].material_override = clay if mode == 'clay' else None
    if mode == 'baked' and not baked_ready:
        use_lightmaps()
        baked_ready = True
    if mode == 'baked':
        for ob in lights_lit:
            ob.hide_render = True
        sc.cycles.max_bounces = 0
    else:
        sc.cycles.max_bounces = 6
    if mode == 'leak':
        scene_prep.night_world(0.0)
        scene.world_color((0.8, 0.85, 1.0), 25.0)
    elif mode == 'clay':
        scene.world_color((0.3, 0.32, 0.36), 1.0)
    else:
        scene.world_color((0.0035, 0.005, 0.009), 1.0 + FILL)
    sc.render.filepath = str(OUT / f'{name}.png')
    t0 = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    done[name] = round(time.perf_counter() - t0, 1)
    scene.log(f'rendered {name} in {done[name]} s')
scene.result({'job': 'house-review', 'ok': True, 'views': done, 'device': used, 'samples': SPP})
