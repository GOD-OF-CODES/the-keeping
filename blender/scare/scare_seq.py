"""JUMPSCARE (#147i) SEQUENCE path of the scare jobs: keyframes the 1.0 s arc on the scene scare_render.py built
(same head, hair, eyes, camera, IES torch, Cycles + OIDN settings) and renders frames with motion blur.

Reached from scare_render.py with --seq <tag> (dispatched just before its hero render, one Blender lock):
  motion test (a LOOK render, allowed before the AD passes a still):
    node scripts/assets.mjs --only scare-look --force --job-args="<r35 args> --res 960x600 --spp 48 --seq mt1
         --frames 0,4,12,20,27,29 --seqout scratch/jumpscare/seq-mt1 --ev -10.99 --mboff 20 --boilcrop 1000,330,1400,630"
  the sequence (ONLY after the AD passes a still; chunked, resume-safe: existing frames are skipped):
    ... --res 1920x1200 --spp 256 --seq final --frames 0-5      (then 6-11, ... 24-29) -> .cache/scare/frames/final

Motion (Spec §2 'Motion inside the 1.0 s', at the r31+ staging of ruling (au): the centre 0.19 m from the lens):
  f0-6   arrival: thrust up toward the lens from 3 cm further / 2 cm lower, a damped spring (~8 mm overshoot toward
         the lens at f4-5, chin swinging 5 deg) — 0.3-0.4 m/s at the cut.
  f4-26  hold: pendulum drift about the grip above the crown (yaw 1.0 + 0.35 deg, roll 1.5 + 0.3 deg, 2 mm sway),
         jaw spasm 0.33-0.50 s (key 0 -> 1 -> 0.3: +6 deg about the TMJ, then 30 % of it held).
  f26-29 lurch 8 cm into the lens (ease-in, 1.6 m/s at f29, chin up 4 deg), the mouth widening (key -> 1.3).
Deviations (logged in STATUS 147i): no lower-lid twitch (no lid shape key), no water gush (no water object), the hair
moves only rigidly with the head (strands are static arrays: no secondary swing; the face strands do not follow the
jaw key), camera and torch stay world-fixed (the player's eye and torch).

Writes <seqout>/fNNNN.exr (linear half ZIP; written to a temp name and renamed, so an interrupted chunk never leaves a
half file) + fNNNN-agx.png (AgX at the FIXED --ev, no film finish) + sheet.png (all frames of this run, or every 4th
frame of a full run) and a RESULT line with per-frame times, peak RSS and the boil / motion-blur cost probes.
"""
import math
import os
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

from lib.scene import REPO, log, peak_rss_mb, result

FPS = 30
BASE = 10            # Blender frame of sequence frame 0 (motion blur samples f - 0.25: keep every sample positive)
PIVOT = (0.0, 0.03, 0.15)   # world m: the grip above the crown (the frame centre is the head point at the origin)


def _ss(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def motion(f):
    """World-space delta of the head at sequence frame f: (dx, dy, dz) m (y = away from the lens), yaw / roll / pitch
    deg (about world z / y / x through PIVOT), spasm key value."""
    t = f / FPS
    e = math.exp(-t / 0.12)
    dy = 0.030 * e * math.cos(2.0 * math.pi * t / 0.33)
    dz = -0.020 * math.exp(-t / 0.10) * math.cos(2.0 * math.pi * t / 0.40)
    pitch = 5.0 * math.exp(-t / 0.10) * math.cos(2.0 * math.pi * t / 0.40 + 0.6)
    yaw = 1.0 * math.sin(2.0 * math.pi * t / 1.4 + 0.3) + 0.35 * math.sin(2.0 * math.pi * t / 0.53 + 1.1)
    roll = 1.5 * math.sin(2.0 * math.pi * t / 1.1 + 0.4) + 0.3 * math.sin(2.0 * math.pi * t / 0.37 + 2.0)
    dx = 0.002 * math.sin(2.0 * math.pi * t / 1.3)
    key = _ss(0.33, 0.40, t) - 0.7 * _ss(0.40, 0.50, t)
    u = min(1.0, max(0.0, (f - 26.0) / 3.0))
    dy -= 0.080 * u * u
    pitch += 4.0 * u * u
    key += 1.0 * _ss(26.0 / FPS, 29.0 / FPS, t)
    return (dx, dy, dz), yaw, roll, pitch, key


def delta_matrix(f):
    d, yaw, roll, pitch, _ = motion(f)
    Rm = (Matrix.Rotation(math.radians(yaw), 4, 'Z') @ Matrix.Rotation(math.radians(roll), 4, 'Y')
          @ Matrix.Rotation(math.radians(pitch), 4, 'X'))
    P = Vector(PIVOT)
    return Matrix.Translation(P + Vector(d)) @ Rm @ Matrix.Translation(-P)


def parse_frames(spec):
    out = []
    for part in str(spec).split(','):
        part = part.strip()
        if not part:
            continue
        if '-' in part[1:]:
            a, b = part.split('-', 1)
            out.extend(range(int(a), int(b) + 1))
        else:
            out.append(int(part))
    return sorted(set(out))


def rig(sc, pose, keyed):
    """A proper (unmirrored) parent empty carries the delta; the mirrored hero pose stays its child unchanged."""
    anim = bpy.data.objects.new('scare_anim', None)
    sc.collection.objects.link(anim)
    mw = pose.matrix_world.copy()
    pose.parent = anim
    pose.matrix_parent_inverse = Matrix.Identity(4)
    pose.matrix_world = mw
    anim.rotation_mode = 'QUATERNION'
    prev = None
    for f in range(-1, 31):
        D = delta_matrix(f)
        loc, q, _ = D.decompose()
        if prev is not None and prev.dot(q) < 0.0:
            q = Quaternion((-q.w, -q.x, -q.y, -q.z))
        prev = q
        anim.location = loc
        anim.rotation_quaternion = q
        anim.keyframe_insert('location', frame=BASE + f)
        anim.keyframe_insert('rotation_quaternion', frame=BASE + f)
        k = motion(f)[4]
        for o in keyed:
            kb = o.data.shape_keys.key_blocks['spasm']
            kb.slider_max = 1.5
            kb.value = k
            kb.keyframe_insert('value', frame=BASE + f)
    return anim


def set_motion_blur(sc, on):
    info = {}
    r = sc.render
    for name, val in (('use_motion_blur', bool(on)), ('motion_blur_shutter', 0.5)):
        if hasattr(r, name):
            setattr(r, name, val)
            info[name] = getattr(r, name)
        else:
            info[name] = 'MISSING'
    for owner, label in ((r, 'render'), (sc.cycles, 'cycles')):
        if hasattr(owner, 'motion_blur_position'):
            owner.motion_blur_position = 'CENTER'
            info['motion_blur_position'] = f'{label}:CENTER'
    return info


def _save(img, sc, path, fmt):
    ims = sc.render.image_settings
    if fmt == 'EXR':
        ims.file_format = 'OPEN_EXR'
        ims.color_depth = '16'
        ims.exr_codec = 'ZIP'
    else:
        ims.file_format = 'PNG'
        ims.color_mode = 'RGB'
        ims.color_depth = '8'
    tmp = path.with_name(path.stem + '.part' + path.suffix)
    img.save_render(filepath=str(tmp), scene=sc)
    os.replace(tmp, path)


def _load(path):
    im = bpy.data.images.load(str(path), check_existing=False)
    w, h = im.size
    a = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(h, w, 4)[..., :3]


def sheet(paths, dst, cols=3, scale=2):
    tiles = []
    for p in paths:
        a = _load(p)
        h, w = a.shape[0] // scale * scale, a.shape[1] // scale * scale
        tiles.append(a[:h, :w].reshape(h // scale, scale, w // scale, scale, 3).mean((1, 3)))
    th, tw = tiles[0].shape[:2]
    rows = (len(tiles) + cols - 1) // cols
    gap = 6
    S = np.zeros((rows * th + (rows - 1) * gap, cols * tw + (cols - 1) * gap, 3), np.float32) + 0.35
    for i, t in enumerate(tiles):
        r, c = divmod(i, cols)
        y0 = (rows - 1 - r) * (th + gap)                 # Blender rows are bottom-up: first tile at the TOP
        S[y0:y0 + th, c * (tw + gap):c * (tw + gap) + tw] = t
    from characters.texbake import write_png_optimal
    write_png_optimal(S, dst, alpha=False)


def run(A, sc, pose, keyed, W, H, SPP, T, t_all, info):
    tag = str(A.get('seq'))
    frames = parse_frames(A.get('frames', '0-29'))
    if tag == 'final' and not isinstance(A.get('approved'), str):
        # the gate in code (ruling au): the shipped sequence renders only for a still the AD passed
        log('scare seq final: REFUSED — pass --approved "<AD review id of the still>" with the approved look args')
        result({'job': 'scare-seq', 'seq': tag, 'refused': 'no --approved'})
        return
    outdir = Path(A['seqout']) if A.get('seqout') else REPO / '.cache' / 'scare' / 'frames' / tag
    if not outdir.is_absolute():
        outdir = REPO / outdir
    outdir.mkdir(parents=True, exist_ok=True)
    EVF = float(A.get('ev', -10.99))        # FIXED exposure for the previews (a film camera; r35 metered -10.99)
    rig(sc, pose, keyed)
    sc.render.fps = FPS
    sc.render.fps_base = 1.0
    sc.frame_start = BASE + min(frames)
    sc.frame_end = BASE + max(frames)
    mbinfo = set_motion_blur(sc, not A.get('nomb'))
    sc.render.filepath = str(outdir / 'f')          # never a nil path (the NSURL abort seen in #147c)
    sc.view_settings.exposure = EVF
    log(f'scare seq {tag}: frames {frames} -> {outdir}, motion blur {mbinfo}')
    times, stats, pngs = {}, {}, {}
    for f in frames:
        exr = outdir / f'f{f:04d}.exr'
        png = outdir / f'f{f:04d}-agx.png'
        if exr.exists() and not A.get('rerender'):
            log(f'f{f}: exists, skipped')
            if png.exists():
                pngs[f] = png
            continue
        sc.frame_set(BASE + f)
        t0 = time.perf_counter()
        bpy.ops.render.render(write_still=False)
        times[f] = round(time.perf_counter() - t0, 1)
        img = bpy.data.images['Render Result']
        _save(img, sc, exr, 'EXR')
        _save(img, sc, png, 'PNG')
        pngs[f] = png
        a = _load(png)
        stats[f] = round(float(a.mean()) * 255.0, 2)
        log(f'f{f}: {times[f]} s, display mean {stats[f]}/255, key {motion(f)[4]:.2f}, peak RSS {peak_rss_mb():.0f} MB')

    probes = {}
    # motion-blur cost probe: one frame again with motion blur OFF (same res/spp) -> the render-time ratio
    if A.get('mboff') is not None and A.get('mboff') is not True:
        fm = int(A['mboff'])
        set_motion_blur(sc, False)
        sc.frame_set(BASE + fm)
        t0 = time.perf_counter()
        bpy.ops.render.render(write_still=False)
        probes['mb_off_s'] = round(time.perf_counter() - t0, 1)
        probes['mb_off_frame'] = fm
        set_motion_blur(sc, not A.get('nomb'))
    # boil probe: a FULL-RES crop of frame --boilframe rendered with seed 0 and seed 1 at each --boilspp; the display
    # std of the difference / sqrt 2 = the per-frame denoiser residual (an upper bound for boil with the static seed)
    if A.get('boilcrop'):
        bx0, by0, bx1, by1 = (float(v) for v in str(A['boilcrop']).split(','))
        BW, BH = (int(v) for v in str(A.get('boilres', '1920x1200')).split('x'))
        fb = int(A.get('boilframe', 16))
        sc.render.resolution_x, sc.render.resolution_y = BW, BH
        sc.render.use_border = True
        sc.render.use_crop_to_border = True
        sc.render.border_min_x, sc.render.border_max_x = bx0 / BW, bx1 / BW
        sc.render.border_min_y, sc.render.border_max_y = 1.0 - by1 / BH, 1.0 - by0 / BH
        sc.frame_set(BASE + fb)
        for bs in (int(v) for v in str(A.get('boilspp', '128,256')).split(',')):
            sc.cycles.samples = bs
            pair = []
            for seed in (0, 1):
                sc.cycles.seed = seed
                t0 = time.perf_counter()
                bpy.ops.render.render(write_still=False)
                dt = round(time.perf_counter() - t0, 1)
                p = outdir / f'boil-{bs}spp-s{seed}.png'
                _save(bpy.data.images['Render Result'], sc, p, 'PNG')
                pair.append(_load(p))
            d = (pair[0] - pair[1]) * 255.0
            lumd = d @ np.array([0.2126, 0.7152, 0.0722])
            lit = (pair[0] @ np.array([0.2126, 0.7152, 0.0722])) > 0.15
            probes[f'boil_{bs}spp'] = {'s': dt, 'std_all': round(float(lumd.std() / math.sqrt(2.0)), 3),
                                       'std_lit': round(float(lumd[lit].std() / math.sqrt(2.0)), 3) if lit.any() else None,
                                       'lit_frac': round(float(lit.mean()), 3)}
            log(f'boil {bs} spp: {probes[f"boil_{bs}spp"]}')
        sc.cycles.seed = 0
        sc.render.use_border = False
        sc.render.resolution_x, sc.render.resolution_y = W, H
        sc.cycles.samples = SPP

    sh = None
    have = [pngs[f] for f in sorted(pngs)]
    if len(have) > 8:
        have = [pngs[f] for f in sorted(pngs) if f % 4 == 0]
    if have:
        sh = outdir / 'sheet.png'
        try:
            sheet(have, sh, cols=3 if len(have) <= 6 else 4)
        except Exception as e:
            log(f'sheet failed: {e}')
            sh = None
    T['total'] = round(time.perf_counter() - t_all, 1)
    done = sorted(int(p.stem[1:5]) for p in outdir.glob('f[0-9][0-9][0-9][0-9].exr'))
    result({'job': 'scare-seq', 'seq': tag, 'res': [W, H], 'spp': SPP, 'frames': frames, 'rendered': sorted(times),
            'frame_s': times, 'display_mean': stats, 'motion_blur': mbinfo, 'probes': probes, 'done': done,
            'sheet': str(sh) if sh else None, 'times': T, 'info': info, 'peak_rss_mb': round(peak_rss_mb(), 1)})
