"""JUMPSCARE skin LAB (#147h): A/B the skin shader (scare_scene.SKIN overrides) and the torch placement on the REAL
cached scare head — the face front only (no hair, eyes or teeth), the hero pose, camera and IES torch — rendering one
--border crop per variant in ONE Blender session (seconds per variant instead of a 25-minute look round).

Runs inside the scare-look job (one Blender lock):
  node scripts/assets.mjs --only scare-look --force --job-args="--lab /abs/variants.json --labout /abs/dir
       --border 860,120,1300,680 --spp 128 --dist 0.21 --center -6,-24,-42 --pitch -4 --yaw 15 --torch 0.07,-0.05,-0.17
       --aim -11,-38,-43 --fstop 8 --focus -21,-24,-10 --ev -10.19"
variants.json = [{"name": "v0"}, {"name": "v1", "skin": {"c_under": 0.0}, "torch": "0.06,-0.03,-0.11"}, ...]
Writes <labout>/<name>.exr (linear) + <name>.png (AgX at the fixed --ev, the game WB 3300 K) and a RESULT line.
"""
import json
import math
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix

from lib.scene import REPO, job_args, log, peak_rss_mb, reset, result, setup_cycles
from scare import scare_head as sh, scare_scene as S

A = job_args()
VARS = json.loads(Path(str(A['lab'])).read_text())
OUT = Path(str(A.get('labout', REPO / 'scratch' / 'jumpscare' / 'lab')))
OUT.mkdir(parents=True, exist_ok=True)
W, H = (int(v) for v in str(A.get('res', '1920x1200')).split('x'))
SPP = int(A.get('spp', 128))
EV = float(A.get('ev', -10.19))
DIST = float(A.get('dist', 0.21))
CENTER = sh.V(*(float(v) for v in str(A.get('center', '-6,-24,-42')).split(',')))
T = {}
t_all = time.perf_counter()

reset()
sc = bpy.context.scene
face = sh.Face(jaw_deg=float(A.get('jaw', 9.0)))
HA = S.head_arrays(face, float(A.get('h', 0.6)), float(A.get('spasm', 6.0)))
V, Q = HA['V'], HA['Q']
keep = (V[:, 1] < 35.0) & (V[:, 2] > -128.0) & (V[:, 2] < 48.0)          # the face front (head mm)
kq = keep[Q].all(1)
used = np.unique(Q[kq])
remap = -np.ones(len(V), np.int64)
remap[used] = np.arange(len(used))
ob = S.make_mesh('lab_head', V[used] * S.MM, remap[Q[kq]])
me = ob.data
S.set_attr(me, 'alb', HA['alb'][used], 'FLOAT_COLOR')
for k in ('rough', 'wet', 'sss', 'pore', 'pet', 'lip', 'muc', 'cap', 'blood', 'mar', 'w_h', 'w_v', 'w_c', 'w_d', 'pbig', 'scar', 'bru'):
    S.set_attr(me, k, HA[k][used] if k in HA else np.zeros(len(used)))
rp = me.attributes.new('rp', 'FLOAT_VECTOR', 'POINT')
rp.data.foreach_set('vector', (V[used] * S.MM).astype(np.float32).ravel())
log(f'scare lab: face patch {len(used)} of {len(V)} verts')
del HA

M, R = S.pose_matrix(yaw=float(A.get('yaw', 15.0)), pitch=float(A.get('pitch', -4.0)), T=CENTER, dist=DIST)
if str(A.get('mirror', '1')) not in ('0', 'false', 'False'):
    R = R @ np.diag([-1.0, 1.0, 1.0])
    M[:3, :3] = R
    M[:3, 3] = -(R @ (np.asarray(CENTER) * 0.001))
pose = bpy.data.objects.new('scare_pose', None)
sc.collection.objects.link(pose)
pose.matrix_world = Matrix([list(r) for r in M])
ob.parent = pose

FOCUS = sh.V(*(float(v) for v in str(A.get('focus', '-21,-24,-10')).split(',')))
AIM0 = str(A.get('aim', '-11,-38,-43'))
TORCH0 = str(A.get('torch', '0.07,-0.05,-0.17'))
CAMUP = float(A.get('camup', 0.04))

setup_cycles(SPP, device='GPU', max_bounces=12, diffuse_bounces=4)
cy = sc.cycles
cy.glossy_bounces = 6
cy.transmission_bounces = 8
cy.transparent_max_bounces = 32
cy.use_denoising = not A.get('nodenoise')
cy.denoiser = 'OPENIMAGEDENOISE'
try:
    cy.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
    cy.denoising_prefilter = 'ACCURATE'
    cy.denoising_use_gpu = True
except Exception as e:
    log(f'denoise opts: {e}')
cy.use_animated_seed = False
cy.caustics_refractive = False
sc.render.resolution_x, sc.render.resolution_y = W, H
sc.render.resolution_percentage = 100
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'None'
sc.view_settings.exposure = EV
sc.view_settings.use_white_balance = True
sc.view_settings.white_balance_temperature = 3300.0
sc.view_settings.white_balance_tint = 10.0
if A.get('border'):
    bx0, by0, bx1, by1 = (float(v) for v in str(A['border']).split(','))
    sc.render.use_border = True
    sc.render.use_crop_to_border = True
    sc.render.border_min_x, sc.render.border_max_x = bx0 / W, bx1 / W
    sc.render.border_min_y, sc.render.border_max_y = 1.0 - by1 / H, 1.0 - by0 / H

BASE = dict(S.SKIN)
rig = None
done = []
for v in VARS:
    name = str(v['name'])
    S.SKIN.clear()
    S.SKIN.update(BASE)
    S.SKIN.update({k: (tuple(x) if isinstance(x, list) else x) for k, x in v.get('skin', {}).items()})
    me.materials.clear()
    me.materials.append(S.skin_material(face))
    key = (v.get('torch', TORCH0), v.get('aim', AIM0))
    if rig is None or rig[0] != key:
        if rig is not None:
            for o in [rig[1]] + list(rig[2]):
                bpy.data.objects.remove(o)
        cam, lights, _ = S.setup_camera_and_torch(M, R, dist=DIST, fstop=float(A.get('fstop', 8.0)), focus_head_mm=FOCUS,
                                                  aim_head_mm=sh.V(*(float(x) for x in key[1].split(','))),
                                                  torch_off=tuple(float(x) for x in key[0].split(',')), cam_up=CAMUP)
        rig = (key, cam, lights)
    sc.view_settings.exposure = float(v.get('ev', EV))          # per-variant exposure (an albedo gain re-meters)
    t0 = time.perf_counter()
    bpy.ops.render.render(write_still=False)
    T[name] = round(time.perf_counter() - t0, 1)
    img = bpy.data.images['Render Result']
    ims = sc.render.image_settings
    ims.file_format = 'OPEN_EXR'
    ims.color_depth = '32'
    ims.exr_codec = 'ZIP'
    img.save_render(filepath=str(OUT / f'{name}.exr'), scene=sc)
    ims.file_format = 'PNG'
    ims.color_mode = 'RGB'
    ims.color_depth = '8'
    img.save_render(filepath=str(OUT / f'{name}.png'), scene=sc)
    done.append(name)
    log(f'scare lab: {name} in {T[name]} s')
T['total'] = round(time.perf_counter() - t_all, 1)
result({'job': 'scare-look', 'lab': True, 'variants': done, 'times': T, 'out': str(OUT), 'peak_rss_mb': round(peak_rss_mb(), 1)})
