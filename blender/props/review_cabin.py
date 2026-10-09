"""Review renders of the C1 cabin under the shot's real light (docs/C1-OPENING.md §5, §6.1 "Review renders").

  node scripts/assets.mjs --only cabin-review --force        (manual job; reads scratch/props/cabin_review.json)

Scene, in car space (x right, y = the nose, z up from the road): `sedan_interior` (layout params of P_CAR_INTERIOR)
mounted at identity inside the exterior `sedan` (turned 180 deg: the prop is authored nose -y; its `cabin_lo` node
hidden), on a wet two-lane road with black pine walls 9.5-40 m out. Photometry follows the project convention
(Blender W ~ lm, W/m^2 ~ lux, emission strength ~ cd/m^2): CIE-overcast moonlit dome (house/scene_prep.night_world,
~0.027 lux) + L_MOON; low beams 15 kcd hot spot 1.5 deg down + 2.5 kcd spread + 0.8 kcd foreground, 3200 K;
cab veil 1 cd; dials 3 cd/m^2, needles 8, fuel lamp 80, VFD 300; dome 120 lm at 2800 K through a 0.23 x 0.09 lens.
Film exposure = log2(game exposure) per §5.2 (dash POV 1.7, dome 0.014).

Passes: clay (flat grey world, back faces magenta: geometry + normals), dash (engine running, dome off),
dome (dome on). Shots: pov (24 mm at DRIVER_EYE, 9 deg down), map (35 mm), cluster (65 mm), glance (24 mm right).
-> scratch/props/cabin/<pass>_<shot>.png + <pass>_sheet.png (2 x 2, 960 x 600) + metrics.json (frame fractions).
"""
import json
import math
import random

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

from lib.scene import REPO, log, reset, result, setup_cycles
from props import registry, kit
from house import scene_prep

OUT = REPO / 'scratch' / 'props' / 'cabin'
OUT.mkdir(parents=True, exist_ok=True)
CFG_PATH = REPO / 'scratch' / 'props' / 'cabin_review.json'
CFG = {'passes': ['clay', 'dash', 'dome'], 'shots': ['pov', 'map', 'cluster', 'glance'], 'samples': 32,
       'res': [800, 500]}
if CFG_PATH.exists():
    CFG.update(json.loads(CFG_PATH.read_text()))
EYE = Vector((-0.35, -0.05, 1.12))
SHOTS = {
    'pov': {'eye': EYE, 'look': EYE + Vector((0.03, 1.0, -math.tan(math.radians(9)))), 'lens': 24},
    'map': {'eye': EYE + Vector((0.02, 0.0, -0.02)), 'look': Vector((0.30, 0.10, 0.55)), 'lens': 35},
    'cluster': {'eye': Vector((-0.36, 0.08, 1.02)), 'look': Vector((-0.37, 0.7255, 0.785)), 'lens': 65},
    'glance': {'eye': EYE, 'look': Vector((0.75, 0.35, 0.80)), 'lens': 24},
    'rear': {'eye': Vector((0.30, 0.55, 1.05)), 'look': Vector((-0.2, -1.0, 0.75)), 'lens': 18},
    'overhead': {'eye': Vector((0.0, 0.70, 1.20)), 'look': Vector((-0.1, -0.40, 0.95)), 'lens': 14},
}
EXPOSURE = {'clay': 0.0, 'dash': math.log2(1.7), 'dome': math.log2(0.014)}


def mat_emit(name, rgb, strength, base=(0.02, 0.02, 0.02)):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*base, 1)
    b.inputs['Emission Color'].default_value = (*rgb[:3], 1)
    b.inputs['Emission Strength'].default_value = strength
    b.inputs['Roughness'].default_value = 0.4
    return m


def flat(name, rgb, rough=0.8, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def cluster_image():
    """A stand-in for the runtime gauges canvas (512 x 167): dial arcs, ticks, labels-as-bars (green-aqua ink)."""
    w, h = 512, 167
    img = np.zeros((h, w, 4), np.float32)
    img[..., 3] = 1
    yy, xx = np.mgrid[0:h, 0:w]
    ink = np.array([0.30, 0.86, 0.66], np.float32)
    dials = {'speedo': ((0.30, 0.45), 0.40, -126, 126, 13), 'fuel': ((0.72, 0.40), 0.31, -45, 45, 5),
             'temp': ((0.89, 0.40), 0.22, -45, 45, 3)}
    for (u, v), r, a0, a1, nt in dials.values():
        cx, cy, R = u * w, (1 - v) * h, r * h
        d = np.hypot(xx - cx, yy - cy)
        ang = np.degrees(np.arctan2(xx - cx, -(yy - cy)))
        arc = (np.abs(d - R) < 1.6) & (ang >= a0) & (ang <= a1)
        img[arc, :3] = ink
        for k in range(nt):
            a = math.radians(a0 + (a1 - a0) * k / (nt - 1))
            for t in np.linspace(R * 0.78, R, 14):
                px, py = int(cx + t * math.sin(a)), int(cy - t * math.cos(a))
                img[max(0, py - 1):py + 2, max(0, px - 1):px + 2, :3] = ink
    img[int(h * 0.62):int(h * 0.62) + 6, int(w * 0.25):int(w * 0.35), :3] = ink * 0.8      # odometer digits block
    return img


def build_road(coll):
    """Wet asphalt strip, faded centre line, gravel verge, ditch grass, two black pine walls (cones)."""
    def add(name, verts, faces, mat):
        me = bpy.data.meshes.new(name)
        me.from_pydata(verts, [], faces)
        me.materials.append(mat)
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        return ob
    y0, y1 = -40.0, 400.0
    for name, xa, xb, z, mat in (('asphalt', -3.5, 3.5, 0.0, flat('_asph', (0.04, 0.04, 0.04), 0.22)),
                                 ('verge_l', -4.7, -3.5, -0.01, flat('_grav', (0.14, 0.13, 0.12), 0.8)),
                                 ('verge_r', 3.5, 4.7, -0.01, flat('_grav', (0.14, 0.13, 0.12), 0.8)),
                                 ('floor_l', -60, -4.7, -0.05, flat('_litter', (0.06, 0.045, 0.03), 0.8)),
                                 ('floor_r', 4.7, 60, -0.05, flat('_litter', (0.06, 0.045, 0.03), 0.8))):
        add(name, [(xa, y0, z), (xb, y0, z), (xb, y1, z), (xa, y1, z)], [(0, 1, 2, 3)], mat)
    paint = flat('_paint', (0.33, 0.24, 0.05), 0.35)
    for k in range(int((y1 - y0) / 12)):
        ya = y0 + k * 12
        add(f'line{k}', [(-0.05, ya, 0.002), (0.05, ya, 0.002), (0.05, ya + 3.0, 0.002), (-0.05, ya + 3.0, 0.002)],
            [(0, 1, 2, 3)], paint)
    rng = random.Random(9)
    bark = flat('_bark', (0.05, 0.04, 0.03), 0.9)
    needles = flat('_needles', (0.025, 0.035, 0.022), 0.85)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=2.4, radius2=0.0, depth=5.0)
    tier = bpy.data.meshes.new('_tier')
    bm.to_mesh(tier)
    bm.free()
    tier.materials.append(needles)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=6, radius1=0.25, radius2=0.08, depth=18.0)
    trunk = bpy.data.meshes.new('_trunk')
    bm.to_mesh(trunk)
    bm.free()
    trunk.materials.append(bark)
    n = 0
    for side in (-1, 1):
        for row, (d0, d1, step) in enumerate(((9.5, 13.0, 3.5), (14.0, 22.0, 5.0), (23.0, 40.0, 6.0))):
            y = y0
            while y < y1:
                x = side * rng.uniform(d0, d1)
                h = rng.uniform(16, 26)
                s = h / 22
                t = bpy.data.objects.new('_trk', trunk)
                coll.objects.link(t)
                t.location = (x, y, 9.0 * s)
                t.scale = (s, s, s)
                for k in range(4):
                    c = bpy.data.objects.new('_tier', tier)
                    coll.objects.link(c)
                    z = h * (0.35 + 0.16 * k)
                    sc = s * (1.25 - 0.25 * k) * rng.uniform(0.85, 1.1)
                    c.location = (x + rng.uniform(-0.3, 0.3), y, z)
                    c.scale = (sc, sc, s)
                n += 1
                y += step * rng.uniform(0.7, 1.3)
    log(f'road set: {n} pines')


def glass_and_backfaces():
    """Glass: thin-sheet Fresnel mix (transparent + 4 % glossy, so the dash and the dome reflect at night).
    Every single-sided spec material gets a Backfacing switch: 'cull' (transparent, what three's doubleSided=false
    shows: a flipped face is a hole) or 'magenta' (the clay pass)."""
    for mat in list(bpy.data.materials):
        if mat.name.startswith('_'):
            continue
        nt = mat.node_tree
        out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        if mat.get('material_id', mat.name) in ('glass_grimy', 'glass_rain', 'lens_flashlight'):
            tr = nt.nodes.new('ShaderNodeBsdfTransparent')
            tr.inputs['Color'].default_value = (0.9, 0.91, 0.9, 1.0)
            gl = nt.nodes.new('ShaderNodeBsdfGlossy')
            gl.inputs['Roughness'].default_value = 0.04 if 'rain' in mat.name else 0.12
            mx = nt.nodes.new('ShaderNodeMixShader')
            mx.inputs['Fac'].default_value = 0.06     # constant: a Fresnel node goes TIR on back faces
            nt.links.new(tr.outputs[0], mx.inputs[1])
            nt.links.new(gl.outputs[0], mx.inputs[2])
            nt.links.new(mx.outputs[0], out.inputs['Surface'])
        if mat.get('material_id', mat.name) in ('glass_grimy', 'glass_rain', 'lens_flashlight'):
            continue          # transparent: closed glass boxes would show their own far faces
        if not mat.use_backface_culling or not out.inputs['Surface'].links:
            continue
        src = out.inputs['Surface'].links[0].from_socket
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        mx = nt.nodes.new('ShaderNodeMixShader')
        mx.name = '_bf_mix'
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        tr.name = '_bf_cull'
        em = nt.nodes.new('ShaderNodeEmission')
        em.name = '_bf_mag'
        em.inputs['Color'].default_value = (1, 0, 1, 1)
        em.inputs['Strength'].default_value = 2.0
        nt.links.new(geo.outputs['Backfacing'], mx.inputs['Fac'])
        nt.links.new(src, mx.inputs[1])
        nt.links.new(tr.outputs[0], mx.inputs[2])
        nt.links.new(mx.outputs[0], out.inputs['Surface'])


def backface_mode(mode):
    for mat in bpy.data.materials:
        nt = mat.node_tree
        if nt is None or '_bf_mix' not in nt.nodes:
            continue
        mx = nt.nodes['_bf_mix']
        src = nt.nodes['_bf_mag'] if mode == 'magenta' else nt.nodes['_bf_cull']
        nt.links.new(src.outputs[0], mx.inputs[2])


def lamp_nodes(objs):
    out = {}
    for o in objs:
        lp = o.get('lamp')
        if lp:
            out.setdefault(lp, []).append(o)
    return out


def set_mat(o, m):
    if o.type != 'MESH':
        return
    for i in range(len(o.data.materials)):
        o.data.materials[i] = m


def main():
    reset()
    sc = bpy.context.scene
    setup_cycles(int(CFG['samples']), 'GPU', max_bounces=8, diffuse_bounces=4)
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    sc.render.resolution_x, sc.render.resolution_y = CFG['res']
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'None'
    layout = json.loads((REPO / 'src/shared/level-layout.json').read_text())
    P = {p['id']: p for p in layout['props']}
    coll = bpy.data.collections.new('review')
    sc.collection.children.link(coll)
    cab = registry.build('sedan_interior', P['P_CAR_INTERIOR'].get('params'), collection=coll)
    car = registry.build('sedan', P['P_CAR_GATE'].get('params'), collection=coll)
    car[0].rotation_euler.z = math.pi
    for o in car:
        if str(o.get('_local', '')).endswith('cabin_lo'):
            o.hide_render = True
    build_road(coll)
    tris = sum(sum(len(f.vertices) - 2 for f in o.data.polygons) for o in cab if o.type == 'MESH')
    log(f'sedan_interior: {len(cab)} nodes, {tris} tris')
    hold = CFG.get('map_hold')        # art review: lift map_open out from under the bench to a held pose
    if hold:
        for o in cab:
            if o.name.endswith('map_open'):
                o.matrix_world = Matrix.Translation(Vector(hold[:3])) @ Matrix.Rotation(math.radians(hold[3]), 4, 'X') \
                    @ Matrix.Rotation(math.radians(90), 4, 'Z')
                log('map_open held at', hold)
    bpy.context.view_layer.update()
    for o in cab:
        if o.type == 'MESH' and o.get('dressing'):
            bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
            lo = [round(min(v[i] for v in bb), 3) for i in range(3)]
            hi = [round(max(v[i] for v in bb), 3) for i in range(3)]
            log(f"bbox {o.get('_local')}: {lo} .. {hi}")
    # cluster face: the stand-in canvas as an emissive texture
    img = cluster_image()
    im = bpy.data.images.new('_gauges', img.shape[1], img.shape[0], alpha=False)
    im.pixels.foreach_set(img[::-1].ravel())
    cl_mat = bpy.data.materials.new('_cluster')
    nt = cl_mat.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = im
    nt.links.new(tex.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Base Color'].default_value = (0.01, 0.012, 0.011, 1)
    lamps = lamp_nodes(cab + car)
    for o in cab:
        if o.get('_local') == 'sedan_interior.cluster':
            set_mat(o, cl_mat)
    glass_and_backfaces()
    # lights
    moon = bpy.data.lights.new('_moon', 'SUN')
    moon.energy = 0.004
    moon.angle = math.radians(2.0)
    moon.color = scene_prep.kelvin_rgb(4100)
    mo = bpy.data.objects.new('_moon', moon)
    coll.objects.link(mo)
    mo.rotation_euler = (math.radians(45), 0, math.radians(150))

    def spot(name, pos, aim, size_deg, blend, cd, kelvin, radius=0.04):
        ld = bpy.data.lights.new(name, 'SPOT')
        ld.energy = cd * 4 * math.pi
        ld.spot_size = math.radians(size_deg)
        ld.spot_blend = blend
        ld.color = scene_prep.kelvin_rgb(kelvin)
        ld.shadow_soft_size = radius
        ob = bpy.data.objects.new(name, ld)
        coll.objects.link(ob)
        ob.location = Vector(pos)
        ob.rotation_euler = Vector(aim).to_track_quat('-Z', 'Y').to_euler()
        return ob
    beams = []
    for sx in (-1, 1):
        p = (sx * 0.62, 2.45, 0.64)
        beams.append(spot(f'_hot{sx}', p, (0.035 * sx * 0 + 0.02, 1, -math.tan(math.radians(1.5))), 14, 0.85, 15000, 3200))
        beams.append(spot(f'_spread{sx}', p, (0.0, 1, -math.tan(math.radians(2.5))), 60, 1.0, 2500, 3200))
        beams.append(spot(f'_fg{sx}', p, (0.0, 1, -math.tan(math.radians(7))), 100, 1.0, 800, 3200))
    veil = spot('_veil', (0, 1.6, 1.2), (0, -2.2, -0.4), 70, 1.0, 1.0, 3400, 0.4)
    dome = bpy.data.lights.new('_dome', 'AREA')
    dome.shape = 'RECTANGLE'
    dome.size, dome.size_y = 0.2, 0.08
    dome.energy = 120.0
    dome.color = scene_prep.kelvin_rgb(2800)
    do = bpy.data.objects.new('_dome', dome)
    coll.objects.link(do)
    do.location = (0, -0.40, 1.27)
    cam_d = bpy.data.cameras.new('_cam')
    cam_d.sensor_fit = 'VERTICAL'
    cam_d.sensor_height = 24.0
    cam_d.clip_start = 0.01
    cam_d.clip_end = 600
    cam = bpy.data.objects.new('_cam', cam_d)
    coll.objects.link(cam)
    sc.camera = cam
    orig_mats = {o.name: [m for m in o.data.materials] for o in cab + car if o.type == 'MESH'}
    sheets = {}
    metrics = {}
    passes = [p for p in CFG['passes'] if p != 'clay'] + (['clay'] if 'clay' in CFG['passes'] else [])
    for pas in passes:
        # restore materials, then per-pass emissives
        for o in cab + car:
            if o.type == 'MESH':
                for i, m in enumerate(orig_mats[o.name]):
                    o.data.materials[i] = m
        backface_mode('magenta' if pas == 'clay' else 'cull')
        for o in car:
            if not str(o.get('_local', '')).endswith('cabin_lo'):
                o.hide_render = pas == 'clay'      # clay: interior only (its flipped faces show magenta)
        if pas == 'clay':
            scene_prep.uniform_world((0.5, 0.5, 0.5), 1.0)
            for o in (mo, do, veil, *beams):
                o.hide_render = True
        else:
            scene_prep.night_world(1.0)
            mo.hide_render = False
            for o in (veil, *beams):
                o.hide_render = False
            do.hide_render = pas != 'dome'
            cl_b = next(n for n in cl_mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
            cl_b.inputs['Emission Strength'].default_value = 3.0
            for o in lamps.get('warn', []):
                on = o.get('warn') in ('fuel',)
                set_mat(o, mat_emit(f'_warn_{o.get("warn")}', list(o.get('emissive_color')), 80.0 if on else 0.0))
            for o in lamps.get('needle', []):
                set_mat(o, mat_emit('_needle', [0.95, 0.35, 0.12], 8.0, base=(0.6, 0.3, 0.1)))
            for o in cab:
                if o.get('_local') == 'sedan_interior.radio_vfd':
                    set_mat(o, mat_emit('_vfd', [0.25, 1.0, 0.85], 300.0))
                if o.get('_local') in ('sedan_interior.odometer', 'sedan_interior.prndl'):
                    set_mat(o, mat_emit('_odo', [0.30, 0.86, 0.66], 2.0))
                if o.get('_local') == 'sedan_interior.dome_lamp':
                    set_mat(o, mat_emit('_domelens', list(o.get('emissive_color')), 1900.0 if pas == 'dome' else 0.0,
                                        base=(0.5, 0.45, 0.3)))
        sc.view_settings.exposure = EXPOSURE.get(pas, 0.0)
        files = []
        for sh in CFG['shots']:
            S = SHOTS[sh]
            cam.location = S['eye']
            cam.rotation_euler = (S['look'] - S['eye']).to_track_quat('-Z', 'Y').to_euler()
            cam_d.lens = S['lens']
            f = OUT / f'{pas}_{sh}.png'
            sc.render.filepath = str(f)
            bpy.ops.render.render(write_still=True)
            files.append(f)
            log(f'rendered {f.name}')
        sheets[pas] = sheet(files, OUT / f'{pas}_sheet.png')
    for o in car:
        o.hide_viewport = True     # ray casts see the interior only
    bpy.context.view_layer.update()
    for sh in CFG.get('metric_shots', ['pov', 'glance', 'rear']):
        metrics[sh] = frame_fractions(cab, car, cam, SHOTS[sh], n=96)
    for sh, px, py in CFG.get('probes', []):      # what is at this pixel of a shot?
        S = SHOTS[sh]
        cam.location = S['eye']
        cam.rotation_euler = (S['look'] - S['eye']).to_track_quat('-Z', 'Y').to_euler()
        cam.data.lens = S['lens']
        bpy.context.view_layer.update()
        W, H = sc.render.resolution_x, sc.render.resolution_y
        vfov = 2 * math.atan(12 / cam.data.lens)
        hfov = 2 * math.atan(math.tan(vfov / 2) * W / H)
        u, v = (px + 0.5) / W * 2 - 1, 1 - (py + 0.5) / H * 2
        d = cam.matrix_world.to_3x3() @ Vector((u * math.tan(hfov / 2), v * math.tan(vfov / 2), -1)).normalized()
        hit, loc, nrm, idx, ob, _ = sc.ray_cast(bpy.context.evaluated_depsgraph_get(), cam.location, d)
        log(f'probe {sh} ({px},{py}): {ob.get("_local") if hit else None} at {tuple(round(c, 3) for c in loc) if hit else None}'
            f" mat {ob.data.materials[ob.data.polygons[idx].material_index].name if hit and ob.type == 'MESH' else ''}")
    (OUT / 'metrics.json').write_text(json.dumps(metrics, indent=1))
    result({'job': 'cabin-review', 'sheets': {k: str(v) for k, v in sheets.items()}, 'tris': tris,
            'metrics': metrics})


def sheet(files, out, cols=2, tw=480, th=300):
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
    return out


def frame_fractions(cab, car, cam, S, n=64):
    cam.location = S['eye']
    cam.rotation_euler = (S['look'] - S['eye']).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = S['lens']
    bpy.context.view_layer.update()
    return _fractions(cab, car, cam, n)


def _fractions(cab, car, cam, n):
    """Ray-cast the POV frame (full 16:10 and the 2.39:1 band): fraction of rays hitting windscreen glass
    (continuing to the outside), the headliner, the cluster/binnacle (+ rim)."""
    sc = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    W, H = sc.render.resolution_x, sc.render.resolution_y
    vfov = 2 * math.atan(12 / cam.data.lens)
    hfov = 2 * math.atan(math.tan(vfov / 2) * W / H)
    R = cam.matrix_world.to_3x3()
    counts = {'glass': 0, 'headliner': 0, 'cluster': 0, 'rim': 0, 'other': 0}
    back = {}
    band = {'glass': 0, 'headliner': 0, 'cluster': 0, 'rim': 0, 'other': 0}
    nb = 0
    for j in range(n):
        for i in range(n):
            u = (i + 0.5) / n * 2 - 1
            v = (j + 0.5) / n * 2 - 1
            d = R @ Vector((u * math.tan(hfov / 2), v * math.tan(vfov / 2), -1)).normalized()
            hit, loc, nrm, idx, ob, _ = sc.ray_cast(dg, cam.location, d)
            k = 'other'
            if hit:
                mats = [m.name for m in ob.data.materials] if ob.type == 'MESH' else []
                mi = ob.data.polygons[idx].material_index if ob.type == 'MESH' and idx < len(ob.data.polygons) else 0
                mn = mats[mi] if mi < len(mats) else ''
                loc_name = str(ob.get('_local', ''))
                if nrm.dot(d) > 0 and mn and not mn.endswith('@2s') and 'glass' not in mn:
                    key = f'{loc_name}|{mn}'
                    back[key] = back.get(key, 0) + 1
                if 'glass_rain' in mn:
                    k = 'glass'
                elif 'headliner' in mn:
                    k = 'headliner'
                elif loc_name in ('sedan_interior.cluster', 'sedan_interior.cluster_lens') or \
                        loc_name.startswith('sedan_interior.needle') or loc_name.startswith('sedan_interior.lamp_'):
                    k = 'cluster'
                elif loc_name == 'sedan_interior.steering':
                    k = 'rim'
            counts[k] += 1
            if abs(v) <= 0.67:
                band[k] += 1
                nb += 1
    tot = n * n
    return {'backface_hits': dict(sorted(back.items(), key=lambda kv: -kv[1])),
            'full': {k: round(c / tot, 3) for k, c in counts.items()},
            'band_2.39': {k: round(c / max(1, nb), 3) for k, c in band.items()}}


main()
