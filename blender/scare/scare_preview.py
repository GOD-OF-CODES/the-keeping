"""JUMPSCARE dev tool: shape preview of the scare head SDF WITHOUT Blender (plain CPython + numpy; Blender's bundled
interpreter works: PYTHONHOME=<Blender.app>/Contents/Resources/5.2/python PYTHONPATH=blender python3.13 ...).
Sphere-traces scare_head.Face (+ globes, teeth) and shades with the torch from below + a weak top fill, so anatomy can
be judged in seconds before a Cycles look round. Writes an 8-bit PNG sheet of the requested views side by side.

  python -m scare.scare_preview --out sheet.png --w 420 --views hero,front,side,low --jaw 9
"""
import math
import struct
import sys
import zlib
from pathlib import Path

import numpy as np

from scare import scare_head as sh


def write_png(path, img):
    img = np.clip(img * 255.0 + 0.5, 0, 255).astype(np.uint8)
    h, w, _ = img.shape
    raw = b''.join(b'\x00' + img[y].tobytes() for y in range(h))

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    data += chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b'')
    Path(path).write_bytes(data)


def hero_pose():
    """Head pose of the hero frame (spec §2): chin-up 20 deg, yaw 8, roll 6; returns R (head -> world)."""
    return sh.rot_z(8.0) @ sh.rot_y(6.0) @ sh.rot_x(-20.0)


def view(name, dist=270.0):
    """(camera origin, forward, up, right, vfov deg, target) in HEAD space (mm)."""
    T = sh.V(-6.0, -24.0, -42.0)
    if name == 'hero':
        R = hero_pose()
        C = T + R.T @ sh.V(0.0, -dist, 0.0)
        F, U = R.T @ sh.V(0, 1, 0), R.T @ sh.V(0, 0, 1)
        return C, F, U, 35.6, T
    if name == 'front':
        return T + sh.V(0, -420, 0), sh.V(0, 1, 0), sh.V(0, 0, 1), 32.0, T
    if name == 'side':          # her right profile
        T2 = sh.V(0.0, 0.0, -40.0)
        return T2 + sh.V(-420, 0, 0), sh.V(1, 0, 0), sh.V(0, 0, 1), 34.0, T2
    if name == 'low':           # three-quarter from below-left (her right), the torch's view
        R = sh.rot_z(-35.0) @ sh.rot_x(-35.0)
        return T + R.T @ sh.V(0, -330, 0), R.T @ sh.V(0, 1, 0), R.T @ sh.V(0, 0, 1), 34.0, T
    if name == 'eye':           # close-up of her right eye
        T3 = sh.V(-31.0, -10.0, 0.0)
        return T3 + sh.V(8, -110, -12), sh._n(sh.V(-8, 110, 12)), sh.V(0, 0, 1), 30.0, T3
    if name == 'mouth':
        T3 = sh.V(0.0, -30.0, -62.0)
        return T3 + sh.V(10, -130, -40), sh._n(sh.V(-10, 130, 40)), sh.V(0, 0, 1), 30.0, T3
    raise ValueError(name)


def render(face, name, W, Hh, with_teeth=True):
    C, F, U, vfov, T = view(name)
    Rt = np.cross(F, U)
    Rt /= np.linalg.norm(Rt)
    U = np.cross(Rt, F)
    th = math.tan(math.radians(vfov) * 0.5)
    ys, xs = np.mgrid[0:Hh, 0:W]
    sx = (xs + 0.5) / W * 2 - 1
    sy = 1 - (ys + 0.5) / Hh * 2
    aspect = W / Hh
    D = F[None, :] + Rt[None, :] * (sx.ravel() * th * aspect)[:, None] + U[None, :] * (sy.ravel() * th)[:, None]
    D /= np.linalg.norm(D, axis=1)[:, None]
    lower = None

    def fn(X):
        Xr, w = face.to_rest(X)
        d = face.rest(Xr)
        for E in face.E:
            d = np.minimum(d, np.minimum(np.linalg.norm(X - E, axis=1) - sh.R_GLOBE,
                                         np.linalg.norm(X - (E + sh.V(0, -sh.CORNEA_OFF, 0)), axis=1) - sh.CORNEA_R))
        if with_teeth:
            m = (np.abs(X[:, 0]) < 32) & (X[:, 1] < 10) & (X[:, 1] > -36) & (X[:, 2] < -40) & (X[:, 2] > -85)
            if m.any():
                tu = face.teeth(X[m], lower=False)
                Xl = face.rotate_jaw(X[m], np.ones(m.sum()), -face.jaw)
                tl = face.teeth(Xl, lower=True)
                d[m] = np.minimum(d[m], np.minimum(tu, tl))
        return d
    # start at the bounding sphere
    bc = sh.V(0.0, 20.0, -20.0)
    oc = C - bc
    b = D @ oc
    disc = b * b - (oc @ oc - 175.0 ** 2)
    t0 = np.where(disc > 0, np.maximum(-b - np.sqrt(np.maximum(disc, 0)), 0), 1e9)
    t = t0.copy()
    alive = disc > 0
    hit = np.zeros(len(D), bool)
    for _ in range(140):
        idx = np.nonzero(alive)[0]
        if len(idx) == 0:
            break
        P = C + D[idx] * t[idx, None]
        dd = fn(P)
        h = dd < 0.04
        hit[idx[h]] = True
        alive[idx[h]] = False
        t[idx[~h]] += np.maximum(dd[~h] * 0.6, 0.02)
        alive &= t < t0 + 400
    P = C + D * t[:, None]
    img = np.zeros((len(D), 3))
    idx = np.nonzero(hit)[0]
    Ph = P[idx]
    e = 0.12
    N = np.stack([fn(Ph + np.array(v) * e) - fn(Ph - np.array(v) * e) for v in ((1, 0, 0), (0, 1, 0), (0, 0, 1))], 1)
    N /= np.maximum(np.linalg.norm(N, axis=1), 1e-9)[:, None]
    # torch: below and in front of the camera (world (60, -230, -270) mm rel. the target in the hero pose)
    R = hero_pose()
    L = T + R.T @ sh.V(60.0, -230.0, -270.0)
    Ld = L - Ph
    dist = np.linalg.norm(Ld, axis=1)
    Ld /= dist[:, None]
    lam = np.clip((N * Ld).sum(1), 0, 1) * (360.0 / dist) ** 2
    fill = 0.18 * np.clip(N[:, 2] * 0.5 + 0.5, 0, 1)
    # cavity occlusion proxy: a 3-sample AO along the normal
    ao = np.ones(len(Ph))
    for k, s in enumerate((1.5, 4.0, 9.0)):
        ao -= np.clip((s - fn(Ph + N * s)) / s, 0, 1) * (0.33 - 0.06 * k)
    ao = np.clip(ao, 0.0, 1.0)
    shade = (lam * 0.85 + fill) * ao
    isglobe = np.zeros(len(Ph), bool)
    for E in face.E:
        isglobe |= np.minimum(np.linalg.norm(Ph - E, axis=1) - sh.R_GLOBE,
                              np.linalg.norm(Ph - (E + sh.V(0, -sh.CORNEA_OFF, 0)), axis=1) - sh.CORNEA_R) < 0.08
    base = np.where(isglobe[:, None], np.array([0.75, 0.74, 0.70])[None], np.array([0.62, 0.55, 0.52])[None])
    img[idx] = base * shade[:, None]
    img = img ** (1 / 2.2)
    return img.reshape(Hh, W, 3)


def main(argv):
    a = dict(out='preview.png', w='420', views='hero,front,side,low', jaw='9')
    i = 0
    while i < len(argv):
        if argv[i].startswith('--'):
            a[argv[i][2:]] = argv[i + 1]
            i += 2
        else:
            i += 1
    W = int(a['w'])
    Hh = int(W * 10 / 16) if a.get('aspect', '16:10') == '16:10' else W
    face = sh.Face(jaw_deg=float(a['jaw']))
    tiles = [render(face, v, W, Hh) for v in a['views'].split(',')]
    cols = int(a.get('cols', len(tiles)))
    while len(tiles) % cols:
        tiles.append(np.zeros_like(tiles[0]))
    rows = [np.concatenate(tiles[i:i + cols], 1) for i in range(0, len(tiles), cols)]
    write_png(a['out'], np.concatenate(rows, 0))
    print('wrote', a['out'])


if __name__ == '__main__':
    main(sys.argv[1:])
