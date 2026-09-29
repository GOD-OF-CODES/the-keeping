"""S3 — photometric calibration of baked lightmaps vs three.js.

A 4x4 m rough dielectric plane (Roughness 1, Specular IOR Level 0, Diffuse Roughness 0 = Lambert) under a
point light of P watts (radius 0) at height d; black world, no other geometry (so INDIRECT is exactly 0).
Bake DIFFUSE {DIRECT, INDIRECT} (no COLOR) and compare every texel with the analytic irradiance
  E = P / (4 pi) * cos(theta) / r^2 = P d / (4 pi r^3).
three r186 shades a lightmapped Lambert surface as  lightmap * lightMapIntensity * albedo / pi  and a PointLight
(decay 2) of intensity I as  I * cos(theta) / r^2 * albedo / pi.  With I = P / (4 pi) the two agree iff
  lightMapIntensity k = E / texel.
Runs several (P, d, albedo) cases: k must not move with albedo (else "no COLOR = divided by albedo" is wrong) or
with d (inverse-square convention).
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from lib import bake, materials, scene  # noqa: E402

OUT = scene.CACHE / 'smoke' / 's3'
OUT.mkdir(parents=True, exist_ok=True)
N = 64          # texels across the plane
SIZE = 4.0      # metres
CASES = [
    {'P': 100.0, 'd': 1.0, 'albedo': 0.8},
    {'P': 100.0, 'd': 1.0, 'albedo': 0.2},
    {'P': 100.0, 'd': 2.0, 'albedo': 0.8},
    {'P': 1000.0, 'd': 2.5, 'albedo': 0.5},
]


def run_case(P, d, albedo, device):
    scene.reset()
    scene.setup_cycles(samples=64, device=device, max_bounces=4)
    bpy.ops.mesh.primitive_plane_add(size=SIZE, location=(0, 0, 0))
    plane = bpy.context.active_object
    mat = materials.make('rough', (albedo,) * 3, roughness=1.0, specular_level=0.0)
    b = materials.principled(mat)
    b.inputs['Diffuse Roughness'].default_value = 0.0
    plane.data.materials.append(mat)
    ld = bpy.data.lights.new('P', 'POINT')
    ld.energy = P
    ld.shadow_soft_size = 0.0
    lo = scene.link(bpy.data.objects.new('P', ld))
    lo.location = (0, 0, d)
    rgba, info = bake.bake_atlas([plane], N, uv_layer='UVMap', name='S3')
    tex = rgba[..., :3].mean(-1)  # grey
    # texel centres in world space (default plane UVs: u -> +x, v -> +y; pixel rows are bottom -> top)
    c = (np.arange(N) + 0.5) / N * SIZE - SIZE / 2
    X, Y = np.meshgrid(c, c)  # X[row, col] = x(col), Y[row, col] = y(row)
    r = np.sqrt(X ** 2 + Y ** 2 + d ** 2)
    E = P * d / (4 * math.pi * r ** 3)
    ratio = E / np.maximum(tex, 1e-12)
    rho = np.sqrt(X ** 2 + Y ** 2)
    rings = {}
    for lo_, hi_ in ((0, 0.25), (0.25, 0.75), (0.75, 1.5), (1.5, 2.9)):
        m = (rho >= lo_) & (rho < hi_)
        rings[f'{lo_}-{hi_}m'] = {'k_mean': round(float(ratio[m].mean()), 4), 'k_std': round(float(ratio[m].std()), 4),
                                   'n': int(m.sum())}
    peak = np.unravel_index(np.argmax(tex), tex.shape)
    return {
        'P_W': P, 'd_m': d, 'albedo': albedo, 'device': info['device'],
        'texel_centre': round(float(tex[N // 2 - 1:N // 2 + 1, N // 2 - 1:N // 2 + 1].mean()), 5),
        'E_centre_analytic': round(float(E[N // 2 - 1:N // 2 + 1, N // 2 - 1:N // 2 + 1].mean()), 5),
        'k_all': round(float(np.median(ratio)), 5),
        'k_mean': round(float(ratio.mean()), 5),
        'k_std': round(float(ratio.std()), 5),
        'rings': rings,
        'peak_texel_rowcol': [int(peak[0]), int(peak[1])],
        'bake_seconds': info['bake_seconds'],
    }


rows = [run_case(**c, device='CPU') for c in CASES]
rows.append(dict(run_case(**CASES[0], device='GPU'), note='same as case 0 on Metal'))
ks = np.array([r['k_all'] for r in rows])
res = {
    'test': 'S3',
    'k_median_over_cases': round(float(np.median(ks)), 5),
    'k_min': round(float(ks.min()), 5), 'k_max': round(float(ks.max()), 5),
    'pi': round(math.pi, 5),
    'rel_err_vs_pi': round(float(abs(np.median(ks) - math.pi) / math.pi), 5),
    'cases': rows,
}
res['ok'] = bool(res['rel_err_vs_pi'] < 0.02 and (ks.max() - ks.min()) / math.pi < 0.03)
scene.result(res, OUT / 'result.json')
if not res['ok']:
    raise SystemExit('S3: k is not a single constant within 2-3% (see result.json)')
