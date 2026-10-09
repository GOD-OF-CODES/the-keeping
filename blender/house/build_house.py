"""Build the house shell from src/shared/level-layout.json (lane A job 'house', see docs/HOUSE.md).

  build_house.py -- [--out public/assets] [--tiers low,medium,max] [--blend .cache/house/house.blend]
                    [--pad 4] [--smallest 1024] [--no-export]

Outputs:
  public/assets/<tier>/house_<atlas>.glb   static, lightmapped (UVMap + Lightmap), meshopt, extras
  public/assets/<tier>/doors.glb            door leaves / boards / bolt (pivot at origin, probe-lit)
  public/assets/<tier>/collision.glb        collision proxies (boxes / ramps) with extras
  .cache/house/house.blend                  the exact geometry + UV2 the bake jobs open
  .cache/house/build.json                   triangle counts, charts, timings
"""
import json
import math
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402

from lib import export, scene  # noqa: E402
from house import deform, doors, exterior, lmuv, rooms, stairs, terrain, trim, windows, collision  # noqa: E402
from house.geom import Mesh  # noqa: E402
from house.plan import Plan, main_soffit  # noqa: E402

args = scene.job_args()
OUT = Path(args.get('out', scene.REPO / 'public' / 'assets'))
TIERS = str(args.get('tiers', 'low,medium,max')).split(',')
BLEND = Path(args.get('blend', scene.CACHE / 'house' / 'house.blend'))
PAD = int(args.get('pad', 4))
SMALLEST = int(args.get('smallest', 1024))
T = scene.Timer()
t_start = time.perf_counter()

scene.reset()
P = Plan()

ATLAS_FILE = {a['id']: 'house_' + a['id'].replace('LM_', '').lower() for a in P.L['atlases']}


def room_mesh(rid, suffix='', **extra):
    r = P.rooms[rid]
    atlas = P.atlas_of_room[rid]
    return Mesh(f'{rid}{suffix}', room=rid, atlas=atlas, floor=r['floor'], lightmap=ATLAS_FILE[atlas].replace(
        'house_', 'lm_'), kind='level', **extra)


with T('build'):
    meshes = {rid: room_mesh(rid) for rid, r in P.rooms.items() if r['kind'] == 'interior'}
    soffits = {'ST_MAIN': lambda x, y: main_soffit(P, x, y)}
    rooms.build_rooms(P, meshes, soffits)
    stair_m = room_mesh('G1', '_stair')
    stairs.main_stair(P, stair_m)
    back_m = room_mesh('U4', '_stair')
    stairs.back_stair(P, back_m)
    trim.build_trim(P, meshes)
    ext = exterior.build_exterior(P, lambda suffix, **kw: room_mesh('EXT2', suffix, **kw))
    glass = windows.build_windows(P, meshes, ext, room_mesh)
    door_parts, door_static = doors.build_doors(P, meshes, ext)
    all_static = list(meshes.values()) + [stair_m, back_m] + list(ext.values()) + glass + door_static
    all_static = [m for m in all_static if m.F]
    details = [m._detail for m in all_static if m._detail is not None and m._detail.F]

with T('deform'):
    deform.apply(P, all_static)
    deform.apply(P, details)

with T('terrain'):
    terrain_m = room_mesh('EXT2', '_terrain', lm_weight=terrain.TERRAIN_LM_WEIGHT)
    terrain_stats = terrain.build(P, terrain_m)
    all_static.append(terrain_m)
    deform.apply(P, [d['mesh'] for d in door_parts], rigid=True)

with T('objects'):
    objs = []
    for m in all_static:
        ob = m.to_object()
        objs.append(ob)
        if m.extras.get('lm_planar'):
            o, U, Vv = m.extras['lm_planar']
            lmuv.planar_layer(ob, o, U, Vv)
            ob['lm_prebuilt'] = True
            del ob['lm_planar']
    detail_objs = []
    for m in details:
        ob = m.to_object()
        ob['bake_occluder'] = True
        detail_objs.append(ob)
    door_objs = doors.to_objects(door_parts)
    knocker = doors.mount_knocker(P, door_objs)
    if knocker:
        door_objs += knocker.pop('objects')
    coll_objs = collision.build(P)
    for ob in coll_objs:
        ob.hide_render = True          # proxies must never render or occlude in the bake

by_atlas = {}
for ob in objs:
    by_atlas.setdefault(ob['atlas'], []).append(ob)

charts = {}
with T('uv2'):
    for atlas, obs in sorted(by_atlas.items()):
        charts[atlas] = lmuv.pack_atlas(obs, pad_texels=PAD, smallest_px=SMALLEST, region=lmuv.house_region(atlas))

stats = {}
for atlas, obs in sorted(by_atlas.items()):
    tris = sum(len(p.vertices) - 2 for o in obs for p in o.data.polygons)
    dtris = sum(len(p.vertices) - 2 for o in detail_objs if o['atlas'] == atlas for p in o.data.polygons)
    stats[atlas] = {'objects': len(obs), 'triangles': tris, 'detail_triangles': dtris,
                    'file': ATLAS_FILE[atlas] + '.glb', **charts[atlas]}

with T('save_blend'):
    BLEND.parent.mkdir(parents=True, exist_ok=True)
    for ob in door_objs:
        ob['bake_occluder'] = True
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=False)

sizes = {}
if not args.get('no_export'):
    with T('export'):
        tmp = scene.CACHE / 'house' / 'glb'
        tmp.mkdir(parents=True, exist_ok=True)
        files = []
        for atlas, obs in sorted(by_atlas.items()):
            f = tmp / f'{ATLAS_FILE[atlas]}.glb'
            sizes[f.name] = export.export_glb(f, obs, 'static')
            files.append(f)
            dets = [o for o in detail_objs if o['atlas'] == atlas]
            if dets:
                f = tmp / f"{ATLAS_FILE[atlas].replace('house_', 'details_')}.glb"
                sizes[f.name] = export.export_glb(f, dets, 'static')
                files.append(f)
        f = tmp / 'doors.glb'
        sizes[f.name] = export.export_glb(f, door_objs, 'static')
        files.append(f)
        f = tmp / 'collision.glb'
        sizes[f.name] = export.export_glb(f, coll_objs, 'static', export_materials='NONE', export_texcoords=False)
        files.append(f)
        for tier in TIERS:
            d = OUT / tier
            d.mkdir(parents=True, exist_ok=True)
            for f in files:
                shutil.copyfile(f, d / f.name)
    # ground cover (instanced, per-tier density; not in house.blend, so never in the bakes)
    with T('groundcover'):
        from house import groundcover
        terrain_ob = next(o for o in objs if o.name.endswith('_terrain'))
        G = groundcover.build(P, terrain_ob)
        gc_stats = groundcover.export_tiers(G, {t: OUT / t for t in TIERS}, export.export_glb)
        gc_stats['placed'] = G['counts']
        gc_stats['variant_tris'] = G['tris']
    # background hedgerow trees outside the walkable rooms (instanced, probe-lit, not in the bakes)
    with T('treeline'):
        from house import treeline
        tl_stats = treeline.build_export(P, terrain_ob, {t: OUT / t for t in TIERS}, export.export_glb)

res = {
    'job': 'house', 'ok': True, 'atlases': stats, 'glb_bytes': sizes,
    'doors': [d['name'] for d in door_parts], 'door_tris': sum(d['mesh'].tris for d in door_parts),
    'collision_objects': len(coll_objs), 'timings_s': T.t, 'terrain': terrain_stats, 'knocker': knocker,
    'groundcover': locals().get('gc_stats'), 'treeline': locals().get('tl_stats'),
    'total_triangles': sum(s['triangles'] for s in stats.values()),
    'process_seconds_in_python': round(time.perf_counter() - t_start, 2),
}
scene.write_json(scene.CACHE / 'house' / 'build.json', res)
scene.result(res)
