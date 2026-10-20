"""Bake one lightmap atlas of the house (one atlas per Blender process, docs/SMOKE.md S4), then OIDN + per-tier KLM.

  bake_house.py -- --atlas LM_GROUND [--size 1024] [--samples 32] [--out public/assets] [--no-flash]
                   [--legacy-fill] [--no-ship] [--dump DIR]

Scene: .cache/house/house.blend (exact geometry + UV2 of the exported GLBs) + the placed props from
.cache/props/props.blend (static props of this atlas are bake targets in the atlas's top band, the rest occluders)
+ layout lights (mode bake / bake_flicker) + night world + door leaves at their initial pose + the terrain
(EXT2_terrain, part of LM_EXTERIOR). LM_CAR holds only the sedan interior set (props). Detail meshes and doors are
occluders only. Flash atlases (layout atlases[].flash) get a second bake with ONLY the lightning lights (mode
flash), a bright storm sky and Cycles portals in the sky-portal windows -> lm_<atlas>_flash.klm (additive).

Outputs: .cache/bake/lm_<id>.npz (rgb float32 + mask + island label map, post-OIDN), public/assets/<tier>/lm_<id>.klm
+ .json. Full quality (release): --size 2048 --samples 128 (browser closed; ~2.4 GB per process).

Post-process (FINAL-BAKE #152, lib/islands.py): every texel an island touches but Cycles did not bake is filled from
that island (or, for islands thinner than a texel, from the 3D-nearest baked surface), gutters grow from ONE island
each, and the gutters are rebuilt after OIDN — the old global dilate + whole-atlas OIDN gave sub-texel trim strips
their shelf neighbours' light (the U3 / U4T orange leak lines). --legacy-fill restores the old path.
--no-ship: bake + process only (nothing written to .cache/bake or public/assets); --dump DIR: raw / legacy / new
atlases as KLM m10 (+ raw .npy) for scratch/final-bake/lmdiag2.mjs.
"""
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from lib import bake, encode, islands, oidn, scene  # noqa: E402
from house import scene_prep  # noqa: E402
from house.plan import Plan  # noqa: E402

args = scene.job_args()
ATLAS = args['atlas']
SIZE = int(args.get('size', 1024))
SPP = int(args.get('samples', 32))
OUT = Path(args.get('out', scene.REPO / 'public' / 'assets'))
BLEND = Path(args.get('blend', scene.CACHE / 'house' / 'house.blend'))
SHORT = ATLAS.replace('LM_', '').lower()
LEGACY = bool(args.get('legacy_fill'))
NO_SHIP = bool(args.get('no_ship'))
DUMP = Path(args['dump']) if args.get('dump') else None
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


ISL = None
if not LEGACY:
    bpy.context.view_layer.update()       # appended props: matrix_world current before reading world positions
    with T('islands'):
        ISL = islands.analyse(objs, SIZE)


def _legacy(rgba, mask):
    rgba = bake.dilate(rgba, mask, iterations=16)
    return bake.fill_empty(rgba)


def _dump(tag, name, rgb):
    DUMP.mkdir(parents=True, exist_ok=True)
    (DUMP / f'{SHORT}_{tag}_{name}.klm').write_bytes(encode.klm_bytes(rgb, 10, 3, None))


def bake_one(tag):
    with T(f'bake_{tag}'):
        rgba, info = bake.bake_atlas(objs, SIZE, name=f'{SHORT}_{tag}')
    mask = bake.coverage_mask(rgba)
    label = None
    if DUMP:
        DUMP.mkdir(parents=True, exist_ok=True)
        np.save(DUMP / f'{SHORT}_{tag}_raw.npy', rgba)
    with T(f'dilate_{tag}'):
        if ISL is None:
            filled = _legacy(rgba, mask)
        else:
            filled, mask, label = islands.fill(rgba, mask, ISL)
    with T(f'oidn_{tag}'):
        den, oinfo = oidn.denoise(filled, prefer='cpu')
    den[..., 3] = mask
    if label is not None:
        with T(f'refill_{tag}'):
            den = islands.refill(den, mask, label)
    if DUMP:
        _dump(tag, 'new', den[..., :3])
        _dump(tag, 'filled', filled[..., :3])
        if label is not None:
            np.save(DUMP / f'{SHORT}_{tag}_label.npy', label)
            old, _ = oidn.denoise(_legacy(rgba, bake.coverage_mask(rgba)), prefer='cpu')
            _dump(tag, 'legacy', old[..., :3])
    return den, mask, info, oinfo, label


def save(den, mask, lm_id, policy, label=None):
    if NO_SHIP:
        return [], encode.stats(den)
    d = scene.CACHE / 'bake'
    d.mkdir(parents=True, exist_ok=True)
    extra = {} if label is None else {'label': label.astype(np.int32)}
    np.savez_compressed(d / f'{lm_id}.npz', rgb=den[..., :3].astype(np.float32), mask=mask, **extra)
    with T(f'encode_{lm_id}'):
        written = encode.encode_tiers(den, lm_id.replace('lm_', ''), OUT, policy=policy, intensity=math.pi,
                                      max_resolution=int(adef.get('maxResolution', 2048)), label=label)
    return written, encode.stats(den)


res = {'job': f'bake-house-{SHORT}', 'ok': True, 'atlas': ATLAS, 'size': SIZE, 'samples': SPP, 'device': device,
       'objects': len(objs), 'triangles': tris, 'prop_placements_in_scene': n_props,
       'lightmapped_prop_objects': sum(1 for o in objs if o.get('lm_prop')), 'portals': len(portals),
       'sky': {'model': 'CIE overcast', 'Lz': scene_prep.SKY_LZ * SKY_GAIN, 'kelvin': scene_prep.SKY_KELVIN}}
if ISL is not None:
    res['islands'] = ISL['info']
den, mask, info, oinfo, label = bake_one('base')
written, st = save(den, mask, f'lm_{SHORT}', encode.TIER_POLICY, label)
res['base'] = {'bake_seconds': info['bake_seconds'], 'coverage': info['coverage'], 'oidn': oinfo, 'stats': st,
               'files': {w['tier']: w['bytes'] for w in written}}

if adef.get('flash') and not args.get('no_flash'):
    for ob in base_lights:
        ob.hide_render = True
    flash = scene_prep.add_lights(L, ('flash',))
    scene_prep.uniform_world((0.55, 0.62, 0.8), 2.5)       # storm sky during a strike
    if not portals:
        portals = [scene_prep.portal(w, f"portal_{w['id']}") for w in scene_prep.window_openings(P, only_sky=True)]
    den, mask, info, oinfo, label = bake_one('flash')
    written, st = save(den, mask, f'lm_{SHORT}_flash', encode.FLASH_POLICY, label)   # Max-tier feature (PLAN)
    res['flash'] = {'bake_seconds': info['bake_seconds'], 'lights': len(flash), 'portals': len(portals),
                    'stats': st, 'files': {w['tier']: w['bytes'] for w in written}}

res['timings_s'] = T.t
res['process_seconds_in_python'] = round(time.perf_counter() - t_start, 2)
if not NO_SHIP:
    scene.write_json(scene.CACHE / 'bake' / f'lm_{SHORT}.json', res)
scene.result(res)
