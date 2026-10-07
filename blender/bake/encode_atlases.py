"""Re-encode the cached float lightmaps into the shipped per-tier KLM files — no re-bake.

  encode_atlases.py -- [--out public/assets] [--only lm_ground,lm_upper_hall_flash] [--no-qa]

Input: .cache/bake/lm_<atlas>[_flash].npz (rgb float32 + coverage mask, post-OIDN; written by
blender/house/bake_house.py). Output: public/assets/<tier>/lm_<atlas>.klm + .json with lib/encode.py TIER_POLICY
(flash maps: Max tier only, as in bake_house.py). A tier the policy no longer ships for an atlas is removed.
QA per written file: decode it again (reference decoder) and measure the display-referred error against the
tier-size float source on every covered texel — 8-bit sRGB code values after three r186 AgX, per albedo
0.2/0.5/0.8, worst over the runtime exposure envelope (lib.encode.display_error).
Result: .cache/bake/encode.json (+ RESULT line). Fails if any file is off by >= 0.5 code value.
"""
import json
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402

from lib import encode, scene  # noqa: E402

args = scene.job_args()
OUT = Path(args.get('out', scene.REPO / 'public' / 'assets'))
ONLY = set(filter(None, str(args.get('only', '')).split(',')))
QA = not args.get('no_qa')
BAKE = scene.CACHE / 'bake'
t_start = time.perf_counter()

layout = json.loads((scene.SHARED / 'level-layout.json').read_text())
atlases = {a['id']: a for a in layout['atlases']}
files = sorted(p for p in BAKE.glob('lm_*.npz') if not ONLY or p.stem in ONLY)
if not files:
    raise SystemExit(f'no cached atlases in {BAKE} (run the bake jobs first)')

report = {'policy': encode.TIER_POLICY, 'qa': {'albedos': encode.QA_ALBEDOS, 'exposures': encode.QA_EXPOSURES},
          'files': {}, 'totals_bytes': {}}
tier_qa = {}
worst = 0.0
for f in files:
    lm_id = f.stem                                   # lm_ground | lm_upper_hall_flash
    flash = lm_id.endswith('_flash')
    short = lm_id[3:-6] if flash else lm_id[3:]
    adef = atlases.get('LM_' + short.upper())
    if adef is None:
        scene.log(f'skip {lm_id}: no atlas LM_{short.upper()} in level-layout.json (stale cache file?)')
        continue
    z = np.load(f)
    rgba = np.empty(z['rgb'].shape[:2] + (4,), np.float32)
    rgba[..., :3] = z['rgb']
    rgba[..., 3] = z['mask']
    policy = {t: p for t, p in encode.TIER_POLICY.items() if not flash or t == 'max'}
    for tier in encode.TIER_POLICY:                  # drop files of tiers / containers no longer shipped
        for ext in ('klm', 'exr', 'json'):
            stale = OUT / tier / f'{lm_id}.{ext}'
            keep = tier in policy and (ext == 'json' or ext == policy[tier]['container'])
            if stale.exists() and not keep:
                stale.unlink()
                scene.log(f'removed {stale.relative_to(scene.REPO)}')
    qa = {}

    def check(tier, src, path):
        if not QA or path.suffix != '.klm':
            return
        dec = encode.klm_decode(path.read_bytes())
        mask = src[..., 3] > 0.5
        qa[tier] = encode.display_error(src[..., :3], dec, mask)

    t0 = time.perf_counter()
    written = encode.encode_tiers(rgba, lm_id[3:], OUT, policy=policy, intensity=math.pi,
                                  max_resolution=int(adef.get('maxResolution', 2048)), on_written=check)
    row = {'seconds': round(time.perf_counter() - t0, 2), 'tiers': {}}
    for w in written:
        q = qa.get(w['tier'], {})
        row['tiers'][w['tier']] = {'bytes': w['bytes'], 'MiB': round(w['bytes'] / 2**20, 3), **q}
        report['totals_bytes'][w['tier']] = report['totals_bytes'].get(w['tier'], 0) + w['bytes']
        worst = max(worst, q.get('max', 0.0))
        tq = tier_qa.setdefault(w['tier'], {})    # per tier, per albedo: worst max / p99 over all atlases
        for alb, v in q.get('albedo', {}).items():
            t = tq.setdefault(alb, {'max': 0.0, 'p99': 0.0, 'frac_ge_half': 0.0})
            for k in t:
                t[k] = max(t[k], v[k])
    report['files'][lm_id] = row
    scene.log(f'{lm_id}: ' + '  '.join(f"{t} {v['MiB']:.2f} MiB (max {v.get('max', float('nan')):.3f} "
                                        f"p99 {v.get('p99', float('nan')):.3f} code)"
                                        for t, v in row['tiers'].items()) + f"  [{row['seconds']} s]")

report['totals_MiB'] = {t: round(b / 2**20, 2) for t, b in report['totals_bytes'].items()}
report['worst_display_error_code'] = round(worst, 4)
report['tier_display_error'] = tier_qa
report['seconds'] = round(time.perf_counter() - t_start, 1)
report['ok'] = worst < 0.5
scene.write_json(BAKE / 'encode.json', report)
scene.result({'job': 'encode', 'ok': report['ok'], 'totals_MiB': report['totals_MiB'],
              'worst_display_error_code': report['worst_display_error_code'], 'tier_display_error': tier_qa,
               'files': len(report['files'])})
if not report['ok']:
    raise SystemExit(f'encode: display error {worst:.3f} code values >= 0.5 — policy too lossy')
