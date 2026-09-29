"""S2 — lightmap container, orientation and size.

1. Orientation/round-trip pattern (16 x 12, non-square so transposes show): Blender pixel (x, y) (y = row from the
   BOTTOM) holds R = 0.25 + 0.5 x, G = 0.125 + 0.75 y, B = 7.0 on an upright "F" else 0.0625 — values > 1 prove no
   view transform; all exactly representable in half. Written as EXR half with every candidate codec x RGB/RGBA,
   float32 ZIP, and f16gz. A GLB quad (UVMap = Lightmap = default plane UVs) is exported so check_exr.mjs can prove
   the (u, 1 - v) decode rule against three's GLTFLoader + EXRLoader output.
2. Real atlases from S4 (post-OIDN, dilated): sizes per codec/channels at 2048^2 (real 2048 bake if S4 ran it,
   else 2x upsample flagged as such), 1024^2 (real bake + 2048->1024 downsample) and 512^2; plus gzip'd float16
   and the pre-OIDN noisy atlas (noise inflates every codec).
check_exr.mjs then decodes EVERY file with three r186 EXRLoader and compares with the f16gz reference.
"""
import gzip
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from lib import encode, scene  # noqa: E402
from lib.export import export_glb  # noqa: E402

OUT = scene.CACHE / 'smoke' / 's2'
S4 = scene.CACHE / 'smoke' / 's4'
(OUT / 'pattern').mkdir(parents=True, exist_ok=True)
(OUT / 'atlas').mkdir(parents=True, exist_ok=True)
for f in list((OUT / 'pattern').iterdir()) + list((OUT / 'atlas').iterdir()):
    f.unlink()
scene.reset()
CODECS = ['NONE', 'ZIP', 'ZIPS', 'PIZ', 'PXR24', 'DWAA', 'DWAB', 'B44']

# ---------------- 1. pattern ----------------
PW, PH = 16, 12
F = set()
for y in range(2, 10):
    F.add((3, y))          # stem
for x in range(3, 10):
    F.add((x, 9))          # top bar
for x in range(3, 8):
    F.add((x, 6))          # middle bar
pat = np.zeros((PH, PW, 4), np.float32)
for y in range(PH):
    for x in range(PW):
        pat[y, x] = (0.25 + 0.5 * x, 0.125 + 0.75 * y, 7.0 if (x, y) in F else 0.0625, 0.5)
pattern_files = {}
for codec in CODECS:
    for ch in ('RGB', 'RGBA'):
        name = f'f_{codec.lower()}_{ch.lower()}.exr'
        pattern_files[name] = encode.save_exr(pat, OUT / 'pattern' / name, codec, ch, '16')
pattern_files['f_zip_rgb_f32.exr'] = encode.save_exr(pat, OUT / 'pattern' / 'f_zip_rgb_f32.exr', 'ZIP', 'RGB', '32')
pattern_files['f.f16.gz'] = encode.save_f16gz(pat, OUT / 'pattern' / 'f.f16.gz', 3)
pattern_files['f.klm'] = encode.save_klm(pat, OUT / 'pattern' / 'f.klm', 10, 3)
assert np.array_equal(encode.klm_decode((OUT / 'pattern' / 'f.klm').read_bytes()), pat[..., :3]), 'KLM round trip'
(OUT / 'pattern' / 'f_expected.json').write_text(__import__('json').dumps(
    {'width': PW, 'height': PH, 'rowOrder': 'bottom-up', 'rgba': pat.reshape(-1).tolist(), 'F': sorted(F)}))

# GLB quad: default plane UVs (vertex (+x,+y) -> uv (1,1)); Lightmap layer copies UVMap.
bpy.ops.mesh.primitive_plane_add(size=2.0)
quad = bpy.context.active_object
quad.name = 'OrientQuad'
lm = quad.data.uv_layers.new(name='Lightmap')
src = quad.data.uv_layers['UVMap']
for i in range(len(src.uv)):
    lm.uv[i].vector = src.uv[i].vector
export_glb(OUT / 'pattern' / 'quad.glb', [quad], 'static')

# ---------------- 2. real atlases ----------------


def load(tag):
    p = S4 / f'{tag}.npz'
    if not p.exists():
        return None
    z = np.load(p)
    rgba = np.empty(z['rgb'].shape[:2] + (4,), np.float32)
    rgba[..., :3] = z['rgb']
    rgba[..., 3] = z['mask']
    noisy = np.empty_like(rgba)
    noisy[..., :3] = z['noisy'].astype(np.float32)
    noisy[..., 3] = z['mask']
    return rgba, noisy


sources = {}
a1024 = load('room_1024_128') or load('room_1024_64')
a2048 = load('room_2048_32')
if a1024 is None:
    raise SystemExit('S2 needs an S4 atlas: run npm run assets -- --only smoke-s4-1024-128')
sources['1024_bake'] = (a1024[0], 'real 1024^2 bake (128 spp if available) + OIDN')
sources['1024_noisy'] = (encode.dilate(a1024[1], a1024[1][..., 3] > 0.5, 16), 'same bake BEFORE OIDN (dilated)')
if a2048 is not None:
    sources['2048_bake'] = (a2048[0], 'real 2048^2 bake @ 32 spp + OIDN')
    sources['1024_from2048'] = (encode.downsample(a2048[0], 2), '2048 bake coverage-weighted downsample to 1024')
    sources['512_from2048'] = (encode.downsample(a2048[0], 4), '2048 bake downsample to 512')
else:
    up = np.repeat(np.repeat(a1024[0], 2, 0), 2, 1)
    sources['2048_upsampled'] = (up, 'EXTRAPOLATED: 1024 bake nearest-upsampled (no real 2048 bake available)')
sources['512_from1024'] = (encode.downsample(a1024[0], 2), '1024 bake downsample to 512')

atlas = {}
for key, (img, desc) in sources.items():
    h = img.shape[0]
    row = {'desc': desc, 'size': h, 'raw_rgb_half_bytes': h * h * 3 * 2, 'stats': encode.stats(img), 'files': {}}
    plan = [(c, 'RGB') for c in ('ZIP', 'PIZ', 'PXR24', 'DWAA', 'DWAB', 'B44')] + [('ZIP', 'RGBA'), ('PIZ', 'RGBA')]
    if key.endswith('noisy'):
        plan = [('ZIP', 'RGB'), ('PIZ', 'RGB'), ('DWAA', 'RGB')]
    for codec, ch in plan:
        name = f'{key}_{codec.lower()}_{ch.lower()}.exr'
        t0 = time.perf_counter()
        n = encode.save_exr(img, OUT / 'atlas' / name, codec, ch, '16')
        row['files'][name] = {'bytes': n, 'write_s': round(time.perf_counter() - t0, 3)}
    name = f'{key}.f16.gz'
    t0 = time.perf_counter()
    n = encode.save_f16gz(img, OUT / 'atlas' / name, 3)
    row['files'][name] = {'bytes': n, 'write_s': round(time.perf_counter() - t0, 3)}
    for bits in ((10, 7) if key.endswith('noisy') else (10, 8, 7, 6)):
        name = f'{key}_m{bits}.klm'
        t0 = time.perf_counter()
        n = encode.save_klm(img, OUT / 'atlas' / name, bits, 3)
        row['files'][name] = {'bytes': n, 'write_s': round(time.perf_counter() - t0, 3)}
    # does HTTP gzip help an EXR ZIP? (it should not)
    zipf = OUT / 'atlas' / f'{key}_zip_rgb.exr'
    row['exr_zip_rgb_regzipped_bytes'] = len(gzip.compress(zipf.read_bytes(), 6))
    atlas[key] = row

# ---------------- 3. the shipping path: encode_tiers with the decided TIER_POLICY ----------------
best = a2048[0] if a2048 is not None else a1024[0]
t0 = time.perf_counter()
tiers = encode.encode_tiers(best, 'smokeroom', OUT / 'tiers', intensity=3.14159)
tiers_s = round(time.perf_counter() - t0, 2)
for t in tiers:
    t['path'] = str(Path(t['path']).relative_to(OUT))

scene.result({'test': 'S2', 'ok': True, 'pattern_files': pattern_files, 'atlas': atlas,
              'encode_tiers': tiers, 'encode_tiers_seconds': tiers_s, 'policy': encode.TIER_POLICY},
             OUT / 'result.json')
