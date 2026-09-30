"""Shared scene preparation for the bake and the review renders (opens .cache/house/house.blend first):
layout lights (Blender watts, Kelvin via Light.temperature), glass made transmissive for light, door leaves posed
at their initial state, a bake-only ground (the terrain is not part of the house shell), night world.
"""
import math

import bpy
from mathutils import Vector

from lib import materials, scene


def kelvin_rgb(k):
    """Approximate blackbody -> linear RGB (normalised to max 1), for Light.color when temperature is n/a."""
    t = k / 100.0
    if t <= 66:
        r = 255
        g = 99.4708025861 * math.log(t) - 161.1195681661
        b = 0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307
    else:
        r = 329.698727446 * ((t - 60) ** -0.1332047592)
        g = 288.1221695283 * ((t - 60) ** -0.0755148492)
        b = 255
    c = [max(0.0, min(255.0, v)) / 255.0 for v in (r, g, b)]
    c = [v ** 2.2 for v in c]
    m = max(c)
    return tuple(v / m for v in c)


def add_light(L, collection=None, energy_scale=1.0):
    t = L['type']
    kind = {'point': 'POINT', 'spot': 'SPOT', 'area': 'AREA', 'sun': 'SUN'}[t]
    ld = bpy.data.lights.new(L['id'], kind)
    if kind == 'SUN':
        ld.energy = L['watts'] * energy_scale
        ld.angle = math.radians(max(0.5, L.get('radius', 0.5)))
    else:
        ld.energy = L['watts'] * energy_scale
    if hasattr(ld, 'use_temperature'):
        ld.use_temperature = True
        ld.temperature = float(L['kelvin'])
        ld.color = (1, 1, 1)
    else:
        ld.color = kelvin_rgb(L['kelvin'])
    if kind in ('POINT', 'SPOT'):
        ld.shadow_soft_size = max(L.get('radius', 0.01), 0.005)
    if kind == 'SPOT':
        ld.spot_size = math.radians(70)
        ld.spot_blend = 0.4
    if kind == 'AREA':
        ld.shape = 'DISK'
        ld.size = 2 * L.get('radius', 0.5)
    ob = bpy.data.objects.new(L['id'], ld)
    (collection or bpy.context.scene.collection).objects.link(ob)
    ob.location = Vector(L['pos'])
    if 'target' in L and kind in ('SPOT', 'AREA', 'SUN'):
        d = Vector(L['target']) - Vector(L['pos'])
        ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob


def add_lights(layout, modes, energy_scale=1.0):
    return [add_light(L, energy_scale=energy_scale) for L in layout['lights'] if L['mode'] in modes]


def glass_transmissive(strength=0.93):
    """Glass objects: mostly transparent to light (grimy): mix Transparent + a little diffuse grime."""
    for mat in bpy.data.materials:
        if mat.get('material_id', mat.name) not in ('glass_grimy', 'glass_rain'):
            continue
        nt = mat.node_tree
        out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        tr.inputs['Color'].default_value = (0.86, 0.87, 0.85, 1.0)
        df = nt.nodes.new('ShaderNodeBsdfDiffuse')
        df.inputs['Color'].default_value = (0.08, 0.08, 0.075, 1.0)
        mx = nt.nodes.new('ShaderNodeMixShader')
        mx.inputs['Fac'].default_value = 1.0 - strength
        nt.links.new(tr.outputs[0], mx.inputs[1])
        nt.links.new(df.outputs[0], mx.inputs[2])
        nt.links.new(mx.outputs[0], out.inputs['Surface'])


def pose_doors(angle_override=None):
    for ob in bpy.data.objects:
        if ob.get('kind') != 'door':
            continue
        a = ob.get('initialAngleDeg', 0.0) if angle_override is None else angle_override
        ob.rotation_euler = (0, 0, math.radians(a) * ob.get('swingSign', 1))


def ground(P, size=(-14, -30, 26, 20), z=-0.0):
    """Bake-only terrain proxy: gently undulating grass/gravel/mud plane (not exported). Skipped when the blend
    has the real terrain (EXT2_terrain, house/terrain.py), which is lightmapped with the exterior."""
    if any(o.get('terrain') for o in bpy.data.objects):
        return None
    import bmesh
    from mathutils import noise
    x0, y0, x1, y1 = size
    bm = bmesh.new()
    nx, ny = 40, 50
    verts = {}
    for j in range(ny + 1):
        for i in range(nx + 1):
            x = x0 + (x1 - x0) * i / nx
            y = y0 + (y1 - y0) * j / ny
            zz = z + 0.06 * noise.noise(Vector((x * 0.15, y * 0.15, 0.3)))
            fx0, fy0, fx1, fy1 = P.footprint()
            if fx0 - 0.3 < x < fx1 + 0.3 and fy0 - 0.3 < y < fy1 + 0.3:
                zz = z - 0.02
            verts[i, j] = bm.verts.new((x, y, zz))
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((verts[i, j], verts[i + 1, j], verts[i + 1, j + 1], verts[i, j + 1]))
    me = bpy.data.meshes.new('bake_ground')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('bake_ground', me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(materials.from_spec('grass_wet'))
    me.materials.append(materials.from_spec('gravel_wet'))
    for p in me.polygons:
        c = p.center
        if -0.7 < c.x < 4.3 and c.y < -2.8:
            p.material_index = 1
    ob['bake_occluder'] = True
    return ob


def night_world(strength=1.0):
    scene.world_color((0.0035, 0.005, 0.009), strength)


def portal(L_open, name='portal'):
    """Cycles portal (area light, is_portal) filling a window opening: guides world sampling indoors."""
    ld = bpy.data.lights.new(name, 'AREA')
    ld.shape = 'RECTANGLE'
    ld.size, ld.size_y = L_open['w'], L_open['h']
    ld.cycles.is_portal = True
    ob = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = L_open['c']
    ob.rotation_euler = L_open['n'].to_track_quat('-Z', 'Y').to_euler()
    return ob


def window_openings(P, only_sky=False):
    out = []
    for w in P.walls:
        a, b, d, nl, L = P.wall_frame(w)
        for o in w['openings']:
            if o['kind'] != 'window':
                continue
            if only_sky and not o['window'].get('skyPortal'):
                continue
            inside = Vector((nl[0], nl[1], 0)) if w['left'] not in ('exterior', 'void') else -Vector((nl[0], nl[1], 0))
            c = Vector((a[0] + d[0] * o['offset'], a[1] + d[1] * o['offset'], w['base'] + o['sill'] + o['height'] / 2))
            out.append({'id': o['id'], 'c': c - inside * (w['thickness'] / 2 + 0.01), 'n': inside,
                        'w': o['width'], 'h': o['height'], 'room': w['left'] if w['left'] != 'exterior' else w['right']})
    return out


def append_props(path=None):
    """Append the placed prop instances (.cache/props/props.blend, collection 'instances') and put every placement
    root at its layout pos/yaw (plan space == Blender space). Lightmapped prop meshes (atlas + Lightmap UVs, see
    blender/props/lightmap.py) become bake targets of their atlas automatically; everything else is an occluder.
    Collider proxies never render. Returns the number of placement roots (0 if the props job has not run)."""
    from pathlib import Path
    path = Path(path or (scene.CACHE / 'props' / 'props.blend'))
    if not path.exists():
        scene.log(f'append_props: {path} missing (run the props job) - props are not in this bake')
        return 0
    with bpy.data.libraries.load(str(path), link=False) as (src, dst):
        dst.collections = [c for c in src.collections if c == 'instances']
    if not dst.collections:
        return 0
    coll = dst.collections[0]
    bpy.context.scene.collection.children.link(coll)
    n = 0
    for ob in list(coll.all_objects):     # a live all_objects iterator breaks when ID props are written
        if ob.get('collider') in (True, 1) or ob.get('hide_proxy') or ob.name.endswith('-collider'):
            ob.hide_render = True
        if ob.parent is None and ob.get('prop_id'):
            x, y, z = ob['plan_pos']
            ob.location = (x, y, z)
            ob.rotation_euler = (0.0, 0.0, float(ob['plan_yaw']))
            n += 1
        if ob.type == 'MESH' and not ob.get('kind') == 'level':
            ob['bake_occluder'] = True
    bpy.context.view_layer.update()
    scene.log(f'append_props: {n} placements from {path.name}')
    return n
