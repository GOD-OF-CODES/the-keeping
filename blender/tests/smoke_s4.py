"""S4 — bake budget on a real-ish room.

Closed 5 x 6 x 3 m room with 0.15 m walls (Boolean shell), a 1.2 x 1.4 m window hole, a table, wardrobe and bed,
all modifiers applied and joined into ONE mesh; outer shell faces deleted (nobody sees them, they waste atlas).
Two point lights (ceiling 100 W warm, lamp 25 W) + dim night-blue world through the window.
Pipeline: UV2 (smart project, 4-texel padding at the smallest 1024 tier) -> Cycles Metal bake (margin 0) ->
dilate 16 px -> OIDN RT hdr -> .npz for S2.

  smoke_s4.py -- --size 1024 --samples 64 [--min-avail-gb 2.5] [--oidn metal|cpu]
"""
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402

from lib import bake, materials, oidn, scene, uv2  # noqa: E402

args = scene.job_args()
SIZE = int(args.get('size', 1024))
SPP = int(args.get('samples', 64))
MIN_AVAIL = float(args.get('min_avail_gb', 0))
OUT = scene.CACHE / 'smoke' / 's4'
OUT.mkdir(parents=True, exist_ok=True)
TAG = f'room_{SIZE}_{SPP}'
T = scene.Timer()
t_start = time.perf_counter()


def vm_available_gb():
    txt = subprocess.run(['vm_stat'], capture_output=True, text=True).stdout
    page = int(txt.split('page size of ')[1].split(' ')[0])
    val = {ln.split(':')[0].strip(): int(ln.split(':')[1].strip().rstrip('.')) for ln in txt.splitlines()[1:] if ':' in ln}
    avail = sum(val.get(k, 0) for k in ('Pages free', 'Pages inactive', 'Pages speculative', 'Pages purgeable'))
    swap = subprocess.run(['sysctl', '-n', 'vm.swapusage'], capture_output=True, text=True).stdout.strip()
    return round(avail * page / 1e9, 2), swap


avail, swap = vm_available_gb()
if MIN_AVAIL and avail < MIN_AVAIL:
    scene.result({'test': 'S4', 'tag': TAG, 'ok': True, 'skipped': True, 'avail_gb': avail, 'swap': swap,
                  'reason': f'available {avail} GB < {MIN_AVAIL} GB'}, OUT / f'{TAG}.json')
    raise SystemExit(0)

scene.reset()
device = scene.setup_cycles(samples=SPP, device='GPU', max_bounces=8, diffuse_bounces=4)
scene.world_color((0.08, 0.1, 0.16), 0.35)

W, D, H, TH = 5.0, 6.0, 3.0, 0.15


def box(name, size, loc):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bmesh.ops.translate(bm, vec=loc, verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return scene.link(bpy.data.objects.new(name, me))


with T('build'):
    shell = box('Shell', (W + 2 * TH, D + 2 * TH, H + 2 * TH), (0, 0, H / 2))
    inner = box('Inner', (W, D, H), (0, 0, H / 2))
    window = box('WindowCut', (1.2, 1.0, 1.4), (0.4, D / 2 + TH / 2, 1.6))
    for cutter in (inner, window):
        m = shell.modifiers.new(cutter.name, 'BOOLEAN')
        m.operation = 'DIFFERENCE'
        m.solver = 'EXACT'
        m.object = cutter
    scene.apply_all_modifiers(shell)
    bpy.data.objects.remove(inner)
    bpy.data.objects.remove(window)
    removed = uv2.remove_faces(shell, lambda c, n: abs(c.x) > W / 2 + 0.1 or abs(c.y) > D / 2 + 0.1 or c.z < -0.1
                               or c.z > H + 0.1)
    # per-face material slots: floor / walls / ceiling
    mats = {
        'floor': materials.make('floor', (0.22, 0.13, 0.07), 0.55),
        'wall': materials.make('wall', (0.42, 0.40, 0.30), 0.85),
        'ceiling': materials.make('ceiling', (0.62, 0.60, 0.55), 0.9),
        'wood': materials.make('wood', (0.16, 0.10, 0.06), 0.6),
        'linen': materials.make('linen', (0.55, 0.52, 0.47), 0.95),
    }
    for mat in mats.values():
        shell.data.materials.append(mat)
    names = list(mats)
    for p in shell.data.polygons:
        z = p.center.z
        p.material_index = names.index('floor' if z < 0.01 and p.normal.z > 0.5 else
                                        'ceiling' if z > H - 0.01 and p.normal.z < -0.5 else 'wall')
    furniture = [
        ('TableTop', (1.4, 0.8, 0.05), (-0.8, 0.5, 0.75), 'wood'),
        ('LegA', (0.06, 0.06, 0.72), (-1.44, 0.14, 0.36), 'wood'),
        ('LegB', (0.06, 0.06, 0.72), (-0.16, 0.14, 0.36), 'wood'),
        ('LegC', (0.06, 0.06, 0.72), (-1.44, 0.86, 0.36), 'wood'),
        ('LegD', (0.06, 0.06, 0.72), (-0.16, 0.86, 0.36), 'wood'),
        ('Wardrobe', (1.2, 0.6, 2.1), (1.8, -2.6, 1.05), 'wood'),
        ('Bed', (1.6, 2.1, 0.55), (-1.6, -1.8, 0.275), 'linen'),
    ]
    parts = [shell]
    for name, size, loc, mname in furniture:
        o = box(name, size, loc)
        o.data.materials.append(mats[mname])
        parts.append(o)
    room = scene.join(parts, 'Room')
    tris = sum(len(p.vertices) - 2 for p in room.data.polygons)

    lamp = bpy.data.lights.new('Ceiling', 'POINT')
    lamp.energy = 100.0
    lamp.color = (1.0, 0.85, 0.65)
    lamp.shadow_soft_size = 0.05
    scene.link(bpy.data.objects.new('Ceiling', lamp)).location = (0.0, 0.3, 2.7)
    lamp2 = bpy.data.lights.new('Lamp', 'POINT')
    lamp2.energy = 25.0
    lamp2.color = (1.0, 0.7, 0.4)
    lamp2.shadow_soft_size = 0.02
    scene.link(bpy.data.objects.new('Lamp', lamp2)).location = (-1.1, 0.4, 1.05)

with T('uv2'):
    uvs = uv2.add_lightmap_uv([room], pad_texels=4, smallest_px=1024, method='smart')

with T('bake'):
    rgba, info = bake.bake_atlas([room], SIZE, name=TAG)
mask = bake.coverage_mask(rgba)
noisy = rgba.copy()
with T('dilate'):
    rgba = bake.dilate(rgba, mask, iterations=16)
    rgba = bake.fill_empty(rgba)
oidn_runs = {}
with T('oidn'):
    den, oinfo = oidn.denoise(rgba, prefer=args.get('oidn', 'cpu'))
oidn_runs['used'] = oinfo
if args.get('oidn', 'cpu') == 'cpu':
    try:  # probe the Metal OIDN device once (unverified before this test); result is only recorded
        _, minfo = oidn.denoise(rgba, prefer='metal')
        oidn_runs['metal_probe'] = minfo
    except Exception as e:  # noqa: BLE001
        oidn_runs['metal_probe'] = {'error': str(e)}
den[..., 3] = mask
with T('save'):
    np.savez_compressed(OUT / f'{TAG}.npz', rgb=den[..., :3].astype(np.float32), mask=mask,
                        noisy=noisy[..., :3].astype(np.float16))

covered = info['coverage']
texel_samples = covered * SIZE * SIZE * SPP
lum = den[..., :3][mask] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
res = {
    'test': 'S4', 'tag': TAG, 'ok': True, 'size': SIZE, 'samples': SPP, 'cycles_device': device,
    'triangles': tris, 'outer_faces_removed': removed, 'uv': uvs, 'coverage': covered,
    'timings_s': T.t, 'bake_seconds': info['bake_seconds'],
    'sec_per_covered_texel_sample': texel_samples and info['bake_seconds'] / texel_samples,
    'oidn': oidn_runs, 'avail_gb_before': avail, 'swap_before': swap,
    'lum_covered': {'mean': round(float(lum.mean()), 4), 'p50': round(float(np.median(lum)), 4),
                    'p99': round(float(np.percentile(lum, 99)), 4), 'max': round(float(lum.max()), 4)},
    'process_seconds_in_python': round(time.perf_counter() - t_start, 2),
}
scene.result(res, OUT / f'{TAG}.json')
