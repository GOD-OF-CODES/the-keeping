"""Review renders of the County Road 9 set props (docs/C1-OPENING.md §6.3) under the shot's light.

  node scripts/assets.mjs --only road-review --force      (manual job; reads scratch/opening/road_review.json)

Each type in cfg.types is built with the params of its first RC9 placement (front -y), on a wet gravel/asphalt
ground, and rendered in two passes:
  clay   flat grey world (shape, bevels, silhouettes; back faces magenta)
  night  CIE-overcast moonlit dome (scene_prep.night_world, ~0.027 lux) + moon, and the westbound car's low beams
         (15 kcd hot spot + 2.5 kcd spread, 3200 K) raking from cfg.beam (car-relative), film exposure log2(cfg.expo)
Views: 'front' (3/4 from the road side) and cfg.extra views. -> scratch/opening/road/<type>_<pass>_<view>.png
"""
import json
import math

import bpy
from mathutils import Vector

from lib.scene import REPO, SHARED, log, reset, result, setup_cycles
from props import registry
from house import scene_prep

OUT = REPO / 'scratch' / 'opening' / 'road'
OUT.mkdir(parents=True, exist_ok=True)
CFG_PATH = REPO / 'scratch' / 'opening' / 'road_review.json'
CFG = {'types': ['billboard'], 'passes': ['clay', 'night'], 'samples': 24, 'res': [800, 500], 'expo': 1.7,
       'views': ['front'], 'beam': [-6.0, -24.0, 0.65]}
if CFG_PATH.exists():
    CFG.update(json.loads(CFG_PATH.read_text()))


def flat(name, rgb, rough=0.8):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    return m


def backface_mode(on):
    for m in bpy.data.materials:
        if not m.node_tree:
            continue
        nt = m.node_tree
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
        if out is None:
            continue
        old = nt.nodes.get('_bf_mix')
        if old:
            src = old.inputs[1].links[0].from_socket if old.inputs[1].links else None
            nt.nodes.remove(nt.nodes.get('_bf_geo'))
            nt.nodes.remove(nt.nodes.get('_bf_em'))
            nt.nodes.remove(old)
            if src:
                nt.links.new(src, out.inputs['Surface'])
        if not on or not out.inputs['Surface'].links:
            continue
        src = out.inputs['Surface'].links[0].from_socket
        geo = nt.nodes.new('ShaderNodeNewGeometry'); geo.name = '_bf_geo'
        em = nt.nodes.new('ShaderNodeEmission'); em.name = '_bf_em'
        em.inputs['Color'].default_value = (1, 0, 1, 1)
        mix = nt.nodes.new('ShaderNodeMixShader'); mix.name = '_bf_mix'
        nt.links.new(geo.outputs['Backfacing'], mix.inputs[0])
        nt.links.new(src, mix.inputs[1])
        nt.links.new(em.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs['Surface'])


def spot(coll, name, pos, aim, size_deg, blend, cd, kelvin, radius=0.04):
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


def bbox(objs):
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi


def main():
    reset()
    setup_cycles(int(CFG['samples']))
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = CFG['res']
    sc.view_settings.view_transform = 'AgX'
    coll = sc.collection
    layout = json.loads((SHARED / 'level-layout.json').read_text())
    # ground: 80 m wet gravel lot + a strip of asphalt along x at y -9 (the road side of the prop)
    bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0))
    g = bpy.context.active_object
    g.data.materials.append(flat('_gravel', (0.05, 0.045, 0.04), 0.55))
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -12, 0.002))
    a = bpy.context.active_object
    a.scale = (80, 7, 1)
    a.data.materials.append(flat('_asphalt', (0.03, 0.03, 0.03), 0.25))
    moon = bpy.data.lights.new('_moon', 'SUN')
    moon.energy = 0.02
    moon.angle = math.radians(2.0)
    moon.color = scene_prep.kelvin_rgb(4100)
    mo = bpy.data.objects.new('_moon', moon)
    coll.objects.link(mo)
    mo.rotation_euler = (math.radians(50), 0, math.radians(140))
    bx, by, bz = CFG['beam']
    beams = []
    for sx in (-0.62, 0.62):
        p = (bx + sx, by, bz)
        aim = (-bx, -by, -bz + 1.2)
        beams.append(spot(coll, f'_hot{sx}', p, aim, 14, 0.85, 15000, 3200))
        beams.append(spot(coll, f'_spread{sx}', p, aim, 60, 1.0, 2500, 3200))
    cam_d = bpy.data.cameras.new('_cam')
    cam = bpy.data.objects.new('_cam', cam_d)
    coll.objects.link(cam)
    sc.camera = cam
    renders, stats = [], {}
    for t in CFG['types']:
        pl = next((q for q in layout['props'] if q['type'] == t and q.get('room') == 'RC9'), None)
        params = (pl or {}).get('params', {})
        tcoll = bpy.data.collections.new(f'_t_{t}')
        coll.children.link(tcoll)
        objs = registry.build(t, params, collection=tcoll)
        lo, hi = bbox(objs)
        tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs if o.type == 'MESH')
        stats[t] = {'dims': [round(v, 2) for v in (hi - lo)], 'tris': tris}
        ctr = (lo + hi) / 2
        size = max((hi - lo).length, 0.5)
        fr = CFG.get('frame', {}).get(t)          # [cx, cy, cz, size] override (e.g. the diner without its lot)
        if fr:
            ctr, size = Vector(fr[:3]), float(fr[3])
        views = {
            'front': (Vector((size * 0.55, -size * 1.25, size * 0.35)), 35),
            'side': (Vector((size * 1.3, size * 0.15, size * 0.25)), 35),
            'low': (Vector((-size * 0.35, -size * 0.9, -ctr.z + 1.3)), 24),
            'close': (Vector((size * 0.2, -size * 0.45, size * 0.05)), 50),
            'back': (Vector((-size * 0.6, size * 1.2, size * 0.3)), 35),
        }
        if t in CFG.get('hide_glass', []):     # art review: see through the opaque preview glass (e.g. sedan driver_proxy)
            for o in objs:
                mats = [m.name.lower() for m in getattr(o.data, 'materials', []) if m] if o.type == 'MESH' else []
                if any('glass' in m for m in mats) or any(k in o.name for k in ('glass', 'windshield', 'window')):
                    o.hide_render = True
        bpy.context.view_layer.update()
        own = []                      # 'own' pass: moonlight + the prop's own head lamps (lamp:'head' nodes)
        if 'own' in CFG['passes']:
            for o in objs:
                if o.get('lamp') != 'head':
                    continue
                em = bpy.data.materials.new('_ownlens')
                b = next(n for n in em.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
                b.inputs['Emission Color'].default_value = (*scene_prep.kelvin_rgb(float(o.get('kelvin', 3300))), 1)
                b.inputs['Emission Strength'].default_value = 20000.0
                if o.type == 'MESH':
                    for i in range(len(o.data.materials)):
                        o.data.materials[i] = em
                al = o.get('aim_local')
                d = Vector(json.loads(al) if isinstance(al, str) else list(al)) if al is not None else Vector((0, -1, 0))
                if o.type == 'MESH' and len(o.data.vertices):    # lamp parts are baked in place: use the lens centre
                    wp = sum((o.matrix_world @ v.co for v in o.data.vertices), Vector()) / len(o.data.vertices)
                else:
                    wp = o.matrix_world.translation
                wd = objs[0].matrix_world.to_3x3() @ d      # aim_local is in the prop's frame (nose -y)
                cd = float(o.get('lm', 1500)) * 12.0       # ~1500 lm high beam -> ~18 kcd hot spot
                own.append(spot(coll, f'_own_{o.name}', tuple(wp), tuple(wd), 18, 0.8, cd,
                                float(o.get('kelvin', 3300))))
                log('own lamp', o.name, [round(v, 2) for v in wp], [round(v, 2) for v in wd])
        for pas in CFG['passes']:
            backface_mode(pas == 'clay')
            for o in own:
                o.hide_render = pas != 'own'
            if pas in ('moon', 'own'):
                scene_prep.night_world(1.0)
                sc.view_settings.exposure = math.log2(float(CFG.get('moon_expo', 30)))
                mo.hide_render = False
                for o in beams:
                    o.hide_render = True
            elif pas == 'clay':
                scene_prep.uniform_world((0.5, 0.5, 0.5), 1.0)
                sc.view_settings.exposure = 0.0
                for o in (mo, *beams):
                    o.hide_render = True
            else:
                scene_prep.night_world(1.0)
                sc.view_settings.exposure = math.log2(float(CFG['expo']))
                for o in (mo, *beams):
                    o.hide_render = False
            for v in CFG['views']:
                off, lens = views[v]
                cam.location = ctr + off
                cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
                cam_d.lens = lens
                f = OUT / f'{t}_{pas}_{v}.png'
                sc.render.filepath = str(f)
                bpy.ops.render.render(write_still=True)
                renders.append(f.name)
                log('rendered', f.name)
        tcoll.hide_render = True
    result({'renders': renders, 'stats': stats}, OUT / 'stats.json')


main()
