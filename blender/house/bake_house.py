"""Bake one lightmap atlas of the house (one atlas per Blender process, docs/SMOKE.md S4), then OIDN + per-tier KLM.

  bake_house.py -- --atlas LM_GROUND [--size 1024] [--samples 32] [--out public/assets] [--no-flash]

Scene: .cache/house/house.blend (exact geometry + UV2 of the exported GLBs) + the placed props from
.cache/props/props.blend (static props of this atlas are bake targets in the atlas's top band, the rest occluders)
+ layout lights (mode bake / bake_flicker) + night world + door leaves at their initial pose + the terrain
(EXT2_terrain, part of LM_EXTERIOR). LM_CAR holds only the sedan interior set (props). Detail meshes and doors are
occluders only. Flash atlases (layout atlases[].flash) get a second bake with ONLY the lightning lights (mode
flash), a bright storm sky and Cycles portals in the sky-portal windows -> lm_<atlas>_flash.klm (additive).

Outputs: .cache/bake/lm_<id>.npz (rgb float32 + mask, post-OIDN), public/assets/<tier>/lm_<id>.klm + .json.
Full quality (release): --size 2048 --samples 128 (browser closed; ~2.4 GB per process).
"""
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from lib import bake, encode, oidn, scene  # noqa: E402
from house import scene_prep  # noqa: E402
from house.plan import Plan  # noqa: E402

args = scene.job_args()
ATLAS = args['atlas']
SIZE = int(args.get('size', 1024))
SPP = int(args.get('samples', 32))
OUT = Path(args.get('out', scene.REPO / 'public' / 'assets'))
BLEND = Path(args.get('blend', scene.CACHE / 'house' / 'house.blend'))
SHORT = ATLAS.replace('LM_', '').lower()
T = scene.Timer()
t_start = time.perf_counter()

bpy.ops.wm.open_mainfile(filepath=str(BLEND))
P = Plan()
L = P.L
adef = next(a for a in L['atlases'] if a['id'] == ATLAS)
device = scene.setup_cycles(SPP, device='GPU', max_bounces=8, diffuse_bounces=4)
sc = bpy.context.scene
sc.view_settings.view_transform = 'Standard'

n_props = scene_prep.append_props()
scene_prep.glass_transmissive()
scene_prep.pose_doors()
scene_prep.ground(P)
# CIE-overcast moonlit dome, ~0.027 lux at the ground (scene_prep). REALISM-BACKLOG #10: the upper floor sees the sky
# only through U1S and two bedroom windows, so its atlases bake under the skyglow of a lightning-lit cloud base,
# Lz ~ 0.02 cd/m^2 (x2.04 -> 0.049 lux horizontal; the backlog's design-safe compromise, above the 0.03 lux moonlit
# ceiling on purpose, lead-approved). Exterior/ground/car atlases keep the 0.024 lux sky.
SKY_GAIN = {'upper_hall': 0.02 / scene_prep.SKY_LZ, 'upper_rooms': 0.02 / scene_prep.SKY_LZ}.get(SHORT, 1.0)
scene_prep.night_world(SKY_GAIN)
base_lights = scene_prep.add_lights({'lights': [l for l in L['lights'] if l.get('role') not in
                                                scene_prep.SKY_ROLES_REPLACED]}, ('bake', 'bake_flicker'))
portals = [] if ATLAS in ('LM_EXTERIOR', 'LM_CAR') else scene_prep.interior_portals(P)

objs = [o for o in bpy.data.objects if o.type == 'MESH' and o.get('atlas') == ATLAS and not o.get('bake_occluder')
        and not o.get('detail') and 'Lightmap' in o.data.uv_layers]
if not objs:
    raise SystemExit(f'no objects for {ATLAS}')
tris = sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)
scene.log(f'{ATLAS}: {len(objs)} objects, {tris} triangles, {len(base_lights)} lights, {len(portals)} portals, '
          f'{SIZE}^2 @ {SPP} spp')


def bake_one(tag):
    with T(f'bake_{tag}'):
        rgba, info = bake.bake_atlas(objs, SIZE, name=f'{SHORT}_{tag}')
    mask = bake.coverage_mask(rgba)
    with T(f'dilate_{tag}'):
        rgba = bake.dilate(rgba, mask, iterations=16)
        rgba = bake.fill_empty(rgba)
    with T(f'oidn_{tag}'):
        den, oinfo = oidn.denoise(rgba, prefer='cpu')
    den[..., 3] = mask
    return den, mask, info, oinfo


def save(den, mask, lm_id, tiers=None):
    d = scene.CACHE / 'bake'
    d.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(d / f'{lm_id}.npz', rgb=den[..., :3].astype(np.float32), mask=mask)
    policy = {t: p for t, p in encode.TIER_POLICY.items() if tiers is None or t in tiers}
    with T(f'encode_{lm_id}'):
        written = encode.encode_tiers(den, lm_id.replace('lm_', ''), OUT, policy=policy, intensity=math.pi,
                                      max_resolution=int(adef.get('maxResolution', 2048)))
    return written, encode.stats(den)


res = {'job': f'bake-house-{SHORT}', 'ok': True, 'atlas': ATLAS, 'size': SIZE, 'samples': SPP, 'device': device,
       'objects': len(objs), 'triangles': tris, 'prop_placements_in_scene': n_props,
       'lightmapped_prop_objects': sum(1 for o in objs if o.get('lm_prop')), 'portals': len(portals),
       'sky': {'model': 'CIE overcast', 'Lz': scene_prep.SKY_LZ * SKY_GAIN, 'kelvin': scene_prep.SKY_KELVIN}}
den, mask, info, oinfo = bake_one('base')
written, st = save(den, mask, f'lm_{SHORT}')
res['base'] = {'bake_seconds': info['bake_seconds'], 'coverage': info['coverage'], 'oidn': oinfo, 'stats': st,
               'files': {w['tier']: w['bytes'] for w in written}}

if adef.get('flash') and not args.get('no_flash'):
    for ob in base_lights:
        ob.hide_render = True
    flash = scene_prep.add_lights(L, ('flash',))
    scene_prep.uniform_world((0.55, 0.62, 0.8), 2.5)       # storm sky during a strike
    if not portals:
        portals = [scene_prep.portal(w, f"portal_{w['id']}") for w in scene_prep.window_openings(P, only_sky=True)]
    den, mask, info, oinfo = bake_one('flash')
    written, st = save(den, mask, f'lm_{SHORT}_flash', tiers=('max',))   # flash maps are a Max-tier feature (PLAN)
    res['flash'] = {'bake_seconds': info['bake_seconds'], 'lights': len(flash), 'portals': len(portals),
                    'stats': st, 'files': {w['tier']: w['bytes'] for w in written}}

res['timings_s'] = T.t
res['process_seconds_in_python'] = round(time.perf_counter() - t_start, 2)
scene.write_json(scene.CACHE / 'bake' / f'lm_{SHORT}.json', res)
scene.result(res)
