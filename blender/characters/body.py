"""Body meshes: skeleton-derived vertex graph with anatomical per-vertex radii -> Skin modifier + Subdivision (the
quad scaffold, applied) -> projected by script onto an implicit anatomy (characters/sdf.py: tapered elliptical limbs,
muscle ellipsoids, bone landmarks such as collarbones, kneecaps, malleoli, knuckles, tendons, ribs) with
relax-and-project iterations, so the Skin topology keeps clean edge loops while the shape comes from anatomy tables.

Public:
  build_body(P, bones, style) -> (object, sdf_fn)
  anatomy(P, J, style) -> sdf callable
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

from . import mesher, sdf
from .sdf import V

# ------------------------------------------------------------------------------------------------ joints / frames


def joints(bones):
    return {b.name: (np.array(b.head, float), np.array(b.tail, float)) for b in bones}


def _n(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def hand_axes(J, side):
    """(wrist, a along hand, n palm normal, l thumb side, L hand length) from the finger bones."""
    wr = J[f'hand_{side}'][0]
    mid = J[f'middle_01_{side}'][0]
    idx = J[f'index_01_{side}'][0]
    pin = J[f'pinky_01_{side}'][0]
    a = _n(mid - wr)
    l = _n(idx - pin)
    l = _n(l - a * l.dot(a))
    n = np.cross(a, l)
    # n must point out of the palm: the thumb bones sit on the palm side
    th = J[f'thumb_02_{side}'][0]
    if (th - wr).dot(n) < 0:
        n = -n
    tip = J[f'middle_03_{side}'][1]
    L = float(np.linalg.norm(tip - wr))
    return wr, a, n, l, L


# ------------------------------------------------------------------------------------------------ anatomy tables
# torso rows: z, cy, side, front, back (front is toward -Y). limb rows: t, front, back, out, in (half-thickness m).
STYLE_ADA = dict(
    name='ada', gaunt=1.0, breasts=True, belly=0.0, fem=True,
    torso=[
        (0.748, 0.012, 0.09, 0.062, 0.072),
        (0.79, 0.012, 0.145, 0.073, 0.094),
        (0.855, 0.01, 0.162, 0.078, 0.104),
        (0.92, 0.006, 0.148, 0.08, 0.088),
        (0.98, 0.0, 0.127, 0.077, 0.071),
        (1.04, 0.0, 0.113, 0.073, 0.068),
        (1.10, -0.002, 0.117, 0.079, 0.074),
        (1.16, -0.006, 0.124, 0.086, 0.08),
        (1.22, -0.006, 0.129, 0.09, 0.084),
        (1.27, 0.0, 0.13, 0.084, 0.084),
        (1.305, 0.012, 0.12, 0.068, 0.074),
        (1.335, 0.024, 0.07, 0.047, 0.05),
    ],
    upperarm=[(0.0, 0.041, 0.043, 0.043, 0.041), (0.3, 0.034, 0.037, 0.036, 0.033), (0.75, 0.029, 0.031, 0.03, 0.028),
              (1.0, 0.027, 0.03, 0.031, 0.029)],
    forearm=[(0.0, 0.027, 0.029, 0.03, 0.028), (0.22, 0.03, 0.027, 0.031, 0.029), (0.6, 0.023, 0.02, 0.026, 0.024),
             (0.9, 0.0145, 0.013, 0.0245, 0.021), (1.0, 0.0128, 0.0118, 0.0232, 0.0205), (1.1, 0.007, 0.006, 0.014, 0.012)],
    thigh=[(0.0, 0.074, 0.08, 0.07, 0.066), (0.15, 0.076, 0.082, 0.082, 0.068), (0.5, 0.066, 0.067, 0.068, 0.062),
           (0.85, 0.05, 0.05, 0.051, 0.049), (1.0, 0.046, 0.044, 0.048, 0.047)],
    calf=[(0.0, 0.045, 0.043, 0.047, 0.046), (0.28, 0.037, 0.055, 0.043, 0.046), (0.6, 0.032, 0.039, 0.035, 0.036),
          (0.9, 0.024, 0.027, 0.026, 0.027), (1.0, 0.023, 0.027, 0.027, 0.027)],
    neck=(0.05, 0.043), head=dict(breadth=0.07, length=0.092, height=0.084, jaw=0.05),
    finger_r=0.0079, foot_scale=1.0, trap=0.026, delt=(0.036, 0.058, 0.038),
)
STYLE_HARLAN = dict(
    name='harlan', gaunt=0.0, breasts=False, belly=1.0, fem=False,
    torso=[
        (0.86, 0.02, 0.1, 0.075, 0.08),
        (0.905, 0.02, 0.16, 0.095, 0.108),
        (0.97, 0.015, 0.176, 0.11, 0.112),
        (1.04, 0.005, 0.18, 0.13, 0.1),
        (1.12, -0.005, 0.182, 0.145, 0.1),
        (1.2, -0.01, 0.18, 0.142, 0.104),
        (1.28, -0.005, 0.178, 0.128, 0.11),
        (1.36, 0.0, 0.18, 0.122, 0.114),
        (1.43, 0.015, 0.182, 0.112, 0.114),
        (1.48, 0.03, 0.168, 0.094, 0.104),
        (1.51, 0.045, 0.14, 0.075, 0.085),
        (1.545, 0.06, 0.085, 0.056, 0.06),
    ],
    upperarm=[(0.0, 0.055, 0.058, 0.058, 0.054), (0.3, 0.049, 0.052, 0.051, 0.046), (0.75, 0.042, 0.044, 0.043, 0.039),
              (1.0, 0.038, 0.041, 0.042, 0.039)],
    forearm=[(0.0, 0.038, 0.04, 0.042, 0.039), (0.22, 0.042, 0.037, 0.044, 0.04), (0.6, 0.033, 0.028, 0.036, 0.033),
             (0.9, 0.02, 0.018, 0.032, 0.028), (1.0, 0.018, 0.016, 0.03, 0.027), (1.1, 0.01, 0.009, 0.018, 0.016)],
    thigh=[(0.0, 0.085, 0.09, 0.08, 0.075), (0.15, 0.088, 0.095, 0.094, 0.08), (0.5, 0.078, 0.08, 0.08, 0.074),
           (0.85, 0.06, 0.06, 0.062, 0.06), (1.0, 0.055, 0.052, 0.058, 0.056)],
    calf=[(0.0, 0.054, 0.052, 0.056, 0.055), (0.28, 0.046, 0.067, 0.054, 0.056), (0.6, 0.04, 0.05, 0.044, 0.045),
          (0.9, 0.03, 0.033, 0.033, 0.034), (1.0, 0.029, 0.034, 0.034, 0.034)],
    neck=(0.07, 0.06), head=dict(breadth=0.079, length=0.1, height=0.098, jaw=0.06),
    finger_r=0.0102, foot_scale=1.15, trap=0.045, delt=(0.05, 0.08, 0.054),
)


def _surface(fn, p, depth=0.0, iters=12, target=None):
    """Project a point onto fn's surface (from outside, along -gradient), then move `depth` inward along the normal.
    target: if given, start the search from this point toward p (use a point inside the part)."""
    P = np.array([p], float)
    P = sdf.project(fn, P, iters=iters, max_move=0.05)
    g = sdf.gradient(fn, P)[0]
    g /= max(np.linalg.norm(g), 1e-9)
    return P[0] - g * depth


def _ray_surface(fn, inside, direction, depth=0.0, rmax=0.5):
    """First surface crossing going from `inside` outward along `direction`; then `depth` back inward."""
    d = _n(direction)
    rs = np.linspace(0.0, rmax, 800)
    X = inside[None] + rs[:, None] * d[None]
    v = fn(X)
    k = int(np.argmax(v > 0))
    if k == 0:
        return inside
    r0, r1 = rs[k - 1], rs[k]
    v0, v1 = v[k - 1], v[k]
    r = r0 + (r1 - r0) * (-v0) / (v1 - v0)
    return inside + d * (r - depth)


def anatomy(P, J, style):
    """Implicit body for proportions P, joints J and a style table. Returns sdf(points) with attributes
    .head (head-only sdf, for hair plastering), .torso and .J."""
    S = style
    fem = S['fem']
    rows = S['torso']
    zs = [r[0] for r in rows]

    def base_torso(X):
        return sdf.sweep(X, rows, power=2.15)

    def tcenter(z):
        return np.array([0.0, np.interp(z, zs, [r[1] for r in rows]), z])

    feats = []

    def add(fn, k):
        feats.append((fn, k))

    for side, s in (('l', 1.0), ('r', -1.0)):
        sh = J[f'upperarm_{side}'][0]
        up_dir = _n(J[f'upperarm_{side}'][1] - sh)
        # trapezius: sloped mass from the side of the neck to the acromion
        nz = J['neck_01'][0][2] + 0.03
        nb = np.array([s * 0.028, J['neck_01'][0][1] + 0.004, nz])
        ac = sh + np.array([-s * 0.018, 0.0, 0.01])
        add(lambda X, a=nb, b=ac, r=S['trap']: sdf.capsule(X, a, b, r), 0.03)
        # deltoid cap
        dc = sh + up_dir * (0.03 if fem else 0.04) + np.array([s * 0.004, 0.0, 0.006])
        R = sdf.frame(up_dir, [s, 0, 0.4])
        add(lambda X, c=dc, R=R, r=S['delt']: sdf.ellipsoid(X, c, r, R), 0.03)
        if fem and S['breasts']:
            bc = _ray_surface(base_torso, tcenter(1.2) + [s * 0.075, 0, 0], [s * 0.18, -1, -0.05], depth=0.017)
            add(lambda X, c=bc: sdf.ellipsoid(X, c, (0.043, 0.03, 0.04), sdf.frame([s * 0.2, -1, -0.2], [0, 0, 1])), 0.028)
        elif not fem:
            pc = _ray_surface(base_torso, tcenter(1.38) + [s * 0.085, 0, 0], [0, -1, 0], depth=0.035)
            add(lambda X, c=pc: sdf.ellipsoid(X, c, (0.08, 0.04, 0.06)), 0.045)
        gz = 0.835 if fem else 0.95
        gc = _ray_surface(base_torso, tcenter(gz) + [s * 0.06, 0, 0], [s * 0.2, 1, 0], depth=0.045)
        add(lambda X, c=gc: sdf.ellipsoid(X, c, (0.068 if fem else 0.075, 0.052, 0.072)), 0.045)
        scz = 1.24 if fem else 1.42
        scc = _ray_surface(base_torso, tcenter(scz) + [s * 0.07, 0, 0], [s * 0.15, 1, 0], depth=0.011)
        add(lambda X, c=scc: sdf.ellipsoid(X, c, (0.038, 0.055, 0.01), sdf.frame([0, 0, 1], [s * 0.25, 1, 0])), 0.02)
    if S['belly'] > 0:
        bc = _ray_surface(base_torso, tcenter(1.1), [0, -1, -0.1], depth=0.1)
        add(lambda X, c=bc: sdf.ellipsoid(X, c, (0.165, 0.12, 0.165)), 0.07)

    def torso_mid(X):
        d = base_torso(X)
        for fn, k in feats:
            d = sdf.smin(d, fn(X), k)
        return d

    # collarbones + ribs placed on the torso surface (not the full body: rays must not hit the arms)
    land = []
    for s in (1, -1):
        zc = J['clavicle_l'][0][2]
        c_in = _ray_surface(torso_mid, tcenter(zc - 0.01) + [s * 0.02, 0, 0], [0, -1, 0.1], depth=0.005)
        c_out = _ray_surface(torso_mid, tcenter(zc - 0.02) + [s * 0.11, 0, 0], [s * 0.3, -1, 0.35], depth=0.005)
        land.append((lambda X, a=c_in, b=c_out: sdf.capsule(X, a, b, 0.0068 if fem else 0.009), 0.01))
        if fem and S['gaunt'] > 0:
            for i in range(4):
                z = 1.095 + i * 0.03
                pts = []
                for ang in (68, 88, 108, 124):
                    r = math.radians(ang)
                    pts.append(_ray_surface(base_torso, tcenter(z - (ang - 68) * 0.0005), [s * math.sin(r), -math.cos(r), 0], depth=0.0042))
                for p0, p1 in zip(pts[:-1], pts[1:]):
                    land.append((lambda X, a=p0, b=p1: sdf.capsule(X, a, b, 0.004), 0.008))

    def torso_full(X):
        d = torso_mid(X)
        for fn, k in land:
            d = sdf.smin(d, fn(X), k)
        return d

    # ---- neck
    n0 = J['neck_01'][0]
    n2 = J['head'][0]
    rn0, rn1 = S['neck']
    neck_a = n0 + np.array([0, -0.012, -0.03])
    neck_b = n2 + np.array([0, -0.016, 0.02])
    H = S['head']
    hc = J['head'][0] + np.array([0, -0.004, 0.09 if fem else 0.1])
    B, Lh, Hh = H['breadth'], H['length'], H['height']
    scm = []
    for s in (1, -1):
        ear = hc + np.array([s * B * 0.78, 0.012, -Hh * 0.62])
        st = _ray_surface(lambda X: sdf.round_cone(X, neck_a, neck_b, rn0, rn1), n0 + [s * 0.012, 0, -0.005], [s * 0.15, -1, 0], depth=0.004)
        scm.append((ear, st))

    def f_neck(X):
        d = sdf.round_cone(X, neck_a, neck_b, rn0, rn1)
        for ear, st in scm:
            d = sdf.smin(d, sdf.capsule(X, ear, st, 0.0085 if fem else 0.014), 0.012)
        return d

    # ---- head: cranium + face mass, features placed on that base surface
    face_c = hc + np.array([0, -0.03, -0.062 if fem else -0.072])
    face_r = (B * 0.8, Lh * 0.62, Hh * 0.75)

    def head_base(X):
        d = sdf.ellipsoid(X, hc + np.array([0, 0.012, 0.0]), (B, Lh, Hh))
        return sdf.smin(d, sdf.ellipsoid(X, face_c, face_r), 0.022)

    fwd = np.array([0, -1.0, 0])
    hs = lambda z, x=0.0, depth=0.0, dirn=fwd: _ray_surface(head_base, hc + [x, 0, z], dirn, depth)
    brow_l, brow_r = hs(0.012, 0.03, 0.007), hs(0.012, -0.03, 0.007)
    nose_b = hs(-0.005, 0.0, 0.004)
    nose_t = nose_b + np.array([0, -0.013 if fem else -0.019, -0.036 if fem else -0.046])
    lips = hs(-0.074 if fem else -0.086, 0.0, 0.005)
    chin = hs(-0.106 if fem else -0.12, 0.0, 0.009)
    socket = [hs(-0.006, s * 0.031, 0.003) for s in (1, -1)]
    cheek = [hs(-0.03, s * 0.046, 0.011, _n([s * 0.5, -1, 0])) for s in (1, -1)]
    jaw_a = [hc + np.array([s * H['jaw'], 0.012, -Hh * 1.0]) for s in (1, -1)]

    def f_head(X):
        d = head_base(X)
        d = sdf.smin(d, sdf.capsule(X, brow_l, brow_r, 0.0075 if fem else 0.01), 0.012)
        for s, sk, ck, ja in zip((1, -1), socket, cheek, jaw_a):
            d = sdf.smin(d, sdf.ellipsoid(X, ck, (0.016, 0.01, 0.01)), 0.012)
            d = sdf.smin(d, sdf.capsule(X, ja, chin + np.array([s * 0.012, 0.004, 0.004]), 0.011 if fem else 0.015), 0.018)
            d = sdf.smin(d, sdf.ellipsoid(X, hc + np.array([s * B * 0.98, 0.012, -Hh * 0.22]), (0.008, 0.019, 0.03)), 0.006)
            d = sdf.smax(d, -sdf.ellipsoid(X, sk, (0.0165, 0.011, 0.0105)), 0.006)
            d = sdf.smin(d, sdf.sphere(X, sk + np.array([0, 0.0095, 0]), 0.0115), 0.003)
        d = sdf.smin(d, sdf.round_cone(X, nose_b, nose_t, 0.0048, 0.0075 if fem else 0.0098), 0.006)
        for s in (1, -1):
            d = sdf.smin(d, sdf.ellipsoid(X, nose_t + np.array([s * 0.011, 0.009, -0.002]), (0.0075, 0.0068, 0.006)), 0.004)
        d = sdf.smin(d, sdf.ellipsoid(X, lips, (0.02, 0.0075, 0.0085)), 0.007)
        d = sdf.smax(d, -sdf.ellipsoid(X, lips + np.array([0, -0.0075, 0.0]), (0.018, 0.006, 0.0008)), 0.0012)
        d = sdf.smin(d, sdf.ellipsoid(X, chin, (0.018, 0.013, 0.015)), 0.01)
        return d

    head_lo = hc - np.array([B + 0.03, Lh + 0.06, Hh * 1.6 + 0.03])
    head_hi = hc + np.array([B + 0.03, Lh + 0.03, Hh + 0.03])
    f_head_b = mesher.bounded(f_head, head_lo, head_hi)

    # ---- limbs
    parts = []
    for side, s in (('l', 1.0), ('r', -1.0)):
        ua0, ua1 = J[f'upperarm_{side}']
        fa0, fa1 = J[f'forearm_{side}']
        wr, a, n, l, L = hand_axes(J, side)
        parts.append(('arm', lambda X, a0=ua0, a1=ua1: sdf.limb(X, a0, a1, [0, -1, 0], S['upperarm'])))
        parts.append(('arm', lambda X, a0=fa0, a1=fa1, nn=n: sdf.limb(X, a0, a1, nn, S['forearm'])))
        re = min(S['upperarm'][-1][1:]) * 0.9
        parts.append(('arm', lambda X, c=fa0, r=re: sdf.sphere(X, c, r)))
        # olecranon (point of the elbow, behind) and ulna head (back of the wrist, little-finger side)
        back = _n(np.cross(_n(fa1 - fa0), np.array([s, 0.0, 0.0])))
        back = back if back[1] > 0 else -back
        parts.append(('arm', lambda X, c=fa0 + back * (re * 0.55): sdf.sphere(X, c, re * 0.55)))
        uh = wr - l * 0.013 * (L / 0.17) - n * 0.006 - a * 0.012
        parts.append(('arm', lambda X, c=uh: sdf.sphere(X, c, 0.0075 if fem else 0.0095)))
        hb = np.array([p for nm, (h0, t0) in J.items() if nm.endswith('_' + side)
                       and nm.startswith(('thumb', 'index', 'middle', 'ring', 'pinky', 'hand')) for p in (h0, t0)])
        parts.append(('hand', mesher.bounded(hand_sdf(J, side, S), hb.min(0) - 0.025, hb.max(0) + 0.025)))
        th0, th1 = J[f'thigh_{side}']
        c0, c1 = J[f'calf_{side}']
        parts.append(('leg', lambda X, a0=th0 + np.array([0, 0, 0.01]), a1=th1: sdf.limb(X, a0, a1, [0, -1, 0], S['thigh'])))
        parts.append(('leg', lambda X, a0=c0, a1=c1: sdf.limb(X, a0, a1, [0, -1, 0], S['calf'])))
        kc = c0 + np.array([0, -min(S['calf'][0][1], S['thigh'][-1][1]) + 0.004, 0.01])
        parts.append(('knee', lambda X, c=kc: sdf.ellipsoid(X, c, (0.019, 0.009, 0.022))))
        fb = np.array([J[f'foot_{side}'][0], J[f'toe_{side}'][1], J[f'calf_{side}'][1] + [0, 0, 0.12]])
        parts.append(('foot', mesher.bounded(foot_sdf(J, side, S), fb.min(0) - np.array([0.07, 0.09, 0.08]),
                                             fb.max(0) + np.array([0.07, 0.09, 0.02]))))

    kinds = {'arm': 0.016, 'hand': 0.012, 'leg': 0.05, 'knee': 0.008, 'foot': 0.02}

    def body(X):
        d = torso_full(X)
        d = sdf.smin(d, f_neck(X), 0.03 if fem else 0.04)
        d = sdf.smin(d, f_head_b(X), 0.022)
        for kind, fn in parts:
            d = sdf.smin(d, fn(X), kinds[kind])
        return d

    legs = [fn for kind, fn in parts if kind in ('leg', 'knee')]

    def trunk(X):
        d = torso_full(X)
        for fn in legs:
            d = sdf.smin(d, fn(X), 0.05)
        return d

    body.trunk = trunk
    body.head = f_head_b
    body.head_center = hc
    body.torso = torso_full
    body.J = J
    body.socket_r = socket[1]      # the right eye socket centre (Ada's visible eye)
    return body


def hand_sdf(J, side, S):
    wr, a, n, l, L = hand_axes(J, side)
    fr = S['finger_r']
    sc = L / 0.172
    W = float(np.linalg.norm(J[f'index_01_{side}'][0] - J[f'pinky_01_{side}'][0]))
    R = np.stack([l, a, n])      # local x = thumb side, y = along, z = palm normal
    palm_c = wr + a * (0.3 * L) + n * 0.001
    prims = []
    fingers = {'index': 1.0, 'middle': 1.04, 'ring': 0.96, 'pinky': 0.83, 'thumb': 1.1}
    for f, fs in fingers.items():
        r0 = fr * fs
        rad = (1.0, 0.93, 0.86, 0.72) if f != 'thumb' else (1.15, 0.98, 0.9, 0.74)
        for i in range(3):
            h, t = J[f'{f}_{i + 1:02d}_{side}']
            prims.append(('cone', h, t, r0 * rad[i], r0 * rad[i + 1]))
            if i > 0:
                prims.append(('knuck', h - n * (r0 * rad[i] * 0.38), r0 * rad[i] * 0.52))
        if f != 'thumb':
            mcp = J[f'{f}_01_{side}'][0]
            prims.append(('mcp', mcp - n * 0.0058 * sc, 0.0078 * sc * fs ** 0.5))
    tendons = []
    for f in ('index', 'middle', 'ring', 'pinky'):
        mcp = J[f'{f}_01_{side}'][0]
        lat = (mcp - wr) - a * (mcp - wr).dot(a)
        start = wr + a * 0.07 * L + lat * 0.35 - n * 0.0098 * sc
        tendons.append((start, mcp - n * 0.0098 * sc))
    thumb_base = J[f'thumb_01_{side}'][0]

    def fn(X):
        q = sdf.to_local(X, palm_c, R)
        u = q[:, 1] / (0.3 * L)
        half_w = np.interp(u, [-1.2, -0.6, 0.0, 0.9, 1.1], [0.34 * W, 0.4 * W, 0.46 * W, 0.56 * W, 0.52 * W])
        th = np.interp(u, [-1.2, -0.5, 0.2, 0.9, 1.15], [0.0105, 0.0112, 0.0105, 0.0092, 0.0075]) * sc
        # palm slightly convex on the back of the hand, flatter on the palm side
        rr = th * 0.85
        qd = np.abs(q) - np.stack([half_w - rr, np.full(len(q), 0.33 * L) - rr, th - rr], 1)
        d = sdf.norm(np.maximum(qd, 0.0)) + np.minimum(qd.max(1), 0.0) - rr
        # thenar (thumb ball) and hypothenar pads on the palm side
        d = sdf.smin(d, sdf.ellipsoid(X, thumb_base + a * 0.018 * sc + n * 0.004 - l * 0.004, (0.0135 * sc, 0.024 * sc, 0.0095 * sc),
                                      np.stack([l, a, n])), 0.01)
        d = sdf.smin(d, sdf.ellipsoid(X, wr + a * 0.27 * L - l * 0.34 * W + n * 0.0045, (0.0095 * sc, 0.026 * sc, 0.0085 * sc),
                                      np.stack([l, a, n])), 0.008)
        for p in prims:
            if p[0] == 'cone':
                d = sdf.smin(d, sdf.round_cone(X, p[1], p[2], p[3], p[4]), 0.004)
            elif p[0] == 'mcp':
                d = sdf.smin(d, sdf.sphere(X, p[1], p[2]), 0.006)
            else:
                d = sdf.smin(d, sdf.sphere(X, p[1], p[2]), 0.0035)
        for s0, s1 in tendons:
            d = sdf.smin(d, sdf.capsule(X, s0, s1, 0.0021 * sc), 0.0035)
        return d
    return fn


def foot_sdf(J, side, S):
    s = 1.0 if side == 'l' else -1.0
    an = J[f'foot_{side}'][0]
    ball = J[f'toe_{side}'][0]
    fs = S['foot_scale']
    fwd = ball - an
    fwd[2] = 0
    fwd = _n(fwd)
    lat = np.cross(fwd, [0, 0, 1])
    med = -lat * s                        # toward the body midline
    heel = np.array([an[0], an[1], 0.0]) - fwd * 0.036 * fs + np.array([0, 0, 0.031 * fs])
    ballc = np.array([ball[0], ball[1], 0.0]) + np.array([0, 0, 0.02 * fs]) - fwd * 0.012 * fs
    rows = [(0.0, 0.028, 0.03, 0.027, 0.027), (0.3, 0.052, 0.03, 0.03, 0.032), (0.65, 0.034, 0.02, 0.035, 0.036),
            (1.0, 0.018, 0.019, 0.04, 0.043)]
    rows = [(t, a * fs, b * fs, c * fs, d * fs) for t, a, b, c, d in rows]
    toes = []
    spec = [(0.0, 0.05, 0.0112, 0.0098), (0.021, 0.044, 0.0074, 0.0064), (0.037, 0.038, 0.007, 0.006),
            (0.051, 0.033, 0.0066, 0.0056), (0.064, 0.026, 0.0062, 0.0053)]
    width_ball = 0.083 * fs
    for i, (off, ln, r0, r1) in enumerate(spec):
        base = ballc + fwd * 0.01 * fs + med * (0.5 * width_ball - 0.012 * fs) - med * (off * fs) + fwd * (-0.004 * i * fs)
        base = base + np.array([0, 0, -0.004 * fs])
        d = _n(fwd + med * (0.07 - 0.045 * i))
        t = base + d * ln * fs + np.array([0, 0, -0.009 * fs])
        toes.append((base, t, r0 * fs, r1 * fs))
    mt_a = toes[0][0] - fwd * 0.004 + np.array([0, 0, 0.003])
    mt_b = toes[4][0] - fwd * 0.004 + np.array([0, 0, 0.001])
    c1 = J[f'calf_{side}'][1]

    def fn(X):
        d = sdf.limb(X, heel, ballc, [0, 0, 1], rows, power=2.4)
        d = sdf.smin(d, sdf.ellipsoid(X, heel + np.array([0, 0, 0.003]), (0.027 * fs, 0.031 * fs, 0.03 * fs)), 0.012)
        d = sdf.smin(d, sdf.capsule(X, mt_a, mt_b, 0.0165 * fs), 0.014)
        for b0, b1, r0, r1 in toes:
            d = sdf.smin(d, sdf.round_cone(X, b0, b1, r0, r1), 0.006)
        d = sdf.smin(d, sdf.sphere(X, an + med * 0.019 * fs + np.array([0, 0, 0.004]), 0.011 * fs), 0.008)
        d = sdf.smin(d, sdf.sphere(X, an - med * 0.021 * fs + np.array([0, 0, -0.008]) + fwd * 0.005, 0.0105 * fs), 0.008)
        d = sdf.smin(d, sdf.capsule(X, c1 + np.array([0, 0.018, 0.09]), heel - fwd * 0.004 + np.array([0, 0, 0.014]), 0.0075 * fs), 0.014)
        d = sdf.smax(d, -X[:, 2] + 0.0015, 0.006)
        return d
    return fn


# ------------------------------------------------------------------------------------------------ scaffold graph
class Graph:
    def __init__(self):
        self.v, self.r, self.e = [], [], []

    def add(self, p, r):
        self.v.append(tuple(float(x) for x in p))
        self.r.append((float(r[0]), float(r[1])) if hasattr(r, '__len__') else (float(r), float(r)))
        return len(self.v) - 1

    def link(self, i, j):
        self.e.append((i, j))

    def chain(self, pts, radii, start=None):
        ids = []
        prev = start
        for p, r in zip(pts, radii):
            i = self.add(p, r)
            if prev is not None:
                self.link(prev, i)
            ids.append(i)
            prev = i
        return ids


def _lerp(a, b, t):
    return a + (b - a) * t


def scaffold(P, J, S):
    """Skin-modifier vertex graph. Radii are only approximate (the SDF projection sets the real shape)."""
    g = Graph()
    rows = S['torso']
    torso_ids = []
    zlist = [r[0] for r in rows]
    z0, z1 = zlist[0] + 0.02, zlist[-1]
    nz = 16
    for i in range(nz):
        z = _lerp(z0, z1, i / (nz - 1))
        cy = np.interp(z, zlist, [r[1] for r in rows])
        sx = np.interp(z, zlist, [r[2] for r in rows])
        dep = np.interp(z, zlist, [0.5 * (r[3] + r[4]) for r in rows])
        torso_ids.append(g.add((0, cy, z), (sx * 0.8, dep * 0.8)))
    for a, b in zip(torso_ids[:-1], torso_ids[1:]):
        g.link(a, b)
    # neck (dense: the wound needs rings) and head
    n0 = J['neck_01'][0]
    h0 = J['head'][0]
    ht = J['head'][1]
    neck_pts = [_lerp(n0 + np.array([0, -0.01, 0.01]), h0, t) for t in np.linspace(0.0, 1.0, 9)[1:]]
    rn = S['neck'][1] * 0.8
    ids = g.chain(neck_pts, [(rn, rn)] * len(neck_pts), start=torso_ids[-1])
    hc = h0 + np.array([0, -0.004, 0.09 if S['fem'] else 0.1])
    B = S['head']['breadth']
    head_pts = [hc + np.array([0, -0.01, -0.045]), hc + np.array([0, 0.0, -0.01]), hc + np.array([0, 0.004, 0.03]),
                hc + np.array([0, 0.008, 0.06])]
    g.chain(head_pts, [(B * 0.75, B * 0.95), (B * 0.85, B * 1.05), (B * 0.8, B * 1.0), (B * 0.55, B * 0.7)], start=ids[-1])
    # face branch: toward the chin/nose so the lower face has its own loops
    g.chain([hc + np.array([0, -0.045, -0.055])], [(B * 0.5, B * 0.45)], start=ids[-1] + 1)

    def nearest_torso(z):
        return min(torso_ids, key=lambda i: abs(g.v[i][2] - z))

    for side, s in (('l', 1.0), ('r', -1.0)):
        # ---- leg
        hj, kn = J[f'thigh_{side}']
        an = J[f'calf_{side}'][1]
        tb = nearest_torso(hj[2] + 0.02)
        pel = g.add(np.array([s * 0.045, g.v[tb][1], hj[2] + 0.02]), (0.08, 0.08))
        g.link(tb, pel)
        th = [_lerp(hj, kn, t) for t in np.linspace(0, 1, 8)]
        thr = [np.interp(t, [r[0] for r in S['thigh']], [np.mean(r[1:]) for r in S['thigh']]) * 0.85 for t in np.linspace(0, 1, 8)]
        ids = g.chain(th, thr, start=pel)
        ca = [_lerp(kn, an, t) for t in np.linspace(0, 1, 9)[1:]]
        car = [np.interp(t, [r[0] for r in S['calf']], [np.mean(r[1:]) for r in S['calf']]) * 0.85 for t in np.linspace(0, 1, 9)[1:]]
        ids = g.chain(ca, car, start=ids[-1])
        ank = ids[-1]
        ball = J[f'toe_{side}'][0]
        fs = S['foot_scale']
        fwd = ball - an
        fwd[2] = 0
        fwd = _n(fwd)
        heel = g.chain([np.array([an[0], an[1], 0.035 * fs]) - fwd * 0.045 * fs], [(0.026 * fs, 0.026 * fs)], start=ank)
        mid = g.chain([np.array([an[0], an[1], 0.045 * fs]) + fwd * 0.03 * fs, np.array([ball[0], ball[1], 0.03 * fs]) - fwd * 0.03 * fs],
                      [(0.03 * fs, 0.025 * fs), (0.035 * fs, 0.02 * fs)], start=ank)
        med = -np.cross(fwd, [0, 0, 1]) * s
        for i, (off, ln) in enumerate([(0.0, 0.052), (0.021, 0.045), (0.037, 0.039), (0.051, 0.034), (0.064, 0.027)]):
            base = np.array([ball[0], ball[1], 0.02 * fs]) + med * (0.5 * 0.083 * fs - 0.012 * fs - off * fs)
            dd = _n(fwd + med * (0.08 - 0.05 * i))
            r = (0.011 if i == 0 else 0.0068) * fs
            g.chain([base, base + dd * ln * fs * 0.55, base + dd * ln * fs], [(r, r)] * 3, start=mid[-1])
        # ---- arm
        cl0, cl1 = J[f'clavicle_{side}']
        ua0, ua1 = J[f'upperarm_{side}']
        fa1 = J[f'forearm_{side}'][1]
        ct = nearest_torso(cl0[2] - 0.02)
        c_mid = g.add(_lerp(cl0, cl1, 0.5) + np.array([0, 0.02, -0.03]), (0.05, 0.05))
        g.link(ct, c_mid)
        up = [_lerp(ua0, ua1, t) for t in np.linspace(0, 1, 7)]
        upr = [np.interp(t, [r[0] for r in S['upperarm']], [np.mean(r[1:]) for r in S['upperarm']]) * 0.85 for t in np.linspace(0, 1, 7)]
        ids = g.chain(up, upr, start=c_mid)
        fo = [_lerp(ua1, fa1, t) for t in np.linspace(0, 1, 8)[1:]]
        forr = [np.interp(t, [r[0] for r in S['forearm']], [np.mean(r[1:]) for r in S['forearm']]) * 0.85 for t in np.linspace(0, 1, 8)[1:]]
        ids = g.chain(fo, forr, start=ids[-1])
        wid = ids[-1]
        wr, a, n, l, L = hand_axes(J, side)
        W = float(np.linalg.norm(J[f'index_01_{side}'][0] - J[f'pinky_01_{side}'][0]))
        pm = g.chain([wr + a * 0.2 * L, wr + a * 0.38 * L], [(0.36 * W, 0.012), (0.4 * W, 0.011)], start=wid)
        fr = S['finger_r']
        for f, sc in (('index', 1.0), ('middle', 1.04), ('ring', 0.95), ('pinky', 0.8)):
            pts, rr = [], []
            for i in range(3):
                h, t = J[f'{f}_{i + 1:02d}_{side}']
                pts += [h, _lerp(h, t, 0.5)]
                rr += [fr * sc * 0.85] * 2
            pts.append(J[f'{f}_03_{side}'][1] - _n(J[f'{f}_03_{side}'][1] - J[f'{f}_03_{side}'][0]) * 0.004)
            rr.append(fr * sc * 0.6)
            g.chain(pts, rr, start=pm[-1])
        pts, rr = [], []
        for i in range(3):
            h, t = J[f'thumb_{i + 1:02d}_{side}']
            pts += [h, _lerp(h, t, 0.5)]
            rr += [fr * 1.2 * 0.85] * 2
        pts.append(J['thumb_03_' + side][1] - _n(J['thumb_03_' + side][1] - J['thumb_03_' + side][0]) * 0.005)
        rr.append(fr * 0.7)
        g.chain(pts, rr, start=pm[0])
    return g


# ------------------------------------------------------------------------------------------------ mesh ops
def graph_to_skin_mesh(g, name, levels=3):
    me = bpy.data.meshes.new(name + '_graph')
    me.from_pydata(g.v, g.e, [])
    ob = bpy.data.objects.new(name + '_graph', me)
    bpy.context.scene.collection.objects.link(ob)
    sk = ob.modifiers.new('Skin', 'SKIN')
    sk.branch_smoothing = 0.6
    sk.use_smooth_shade = True
    sd = me.skin_vertices[0].data
    for v, r in zip(sd, g.r):
        v.radius = r
    sd[0].use_root = True
    ss = ob.modifiers.new('Subsurf', 'SUBSURF')
    ss.levels = levels
    ss.render_levels = levels
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    mesh.name = name
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    out = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(out)
    return out


def mesh_arrays(me):
    n = len(me.vertices)
    P = np.empty(n * 3)
    me.vertices.foreach_get('co', P)
    E = np.empty(len(me.edges) * 2, np.int64)
    me.edges.foreach_get('vertices', E)
    return P.reshape(-1, 3), E.reshape(-1, 2)


def set_positions(me, P):
    me.vertices.foreach_set('co', np.ascontiguousarray(P, np.float64).ravel())
    me.update()


def normals(me):
    N = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('normal', N)
    return N.reshape(-1, 3)


def laplacian(P, E, lam, mask=None):
    n = len(P)
    acc = np.zeros_like(P)
    cnt = np.zeros(n)
    np.add.at(acc, E[:, 0], P[E[:, 1]])
    np.add.at(acc, E[:, 1], P[E[:, 0]])
    np.add.at(cnt, E[:, 0], 1)
    np.add.at(cnt, E[:, 1], 1)
    avg = acc / np.maximum(cnt, 1)[:, None]
    d = (avg - P) * lam
    if mask is not None:
        d *= mask[:, None]
    return P + d


def taubin(P, E, iters=2, lam=0.5, mu=-0.53, mask=None):
    for _ in range(iters):
        P = laplacian(P, E, lam, mask)
        P = laplacian(P, E, mu, mask)
    return P


def fit_to_sdf(ob, fn, rounds=4, relax=2):
    """Relax-and-project the scaffold onto the implicit surface."""
    me = ob.data
    P, E = mesh_arrays(me)
    P = sdf.project(fn, P, iters=6, max_move=0.03)
    for _ in range(rounds):
        P = taubin(P, E, iters=relax)
        P = sdf.project(fn, P, iters=4, max_move=0.02)
    set_positions(me, P)
    return ob


def sdf_object(fn, lo, hi, h, name, target_faces=None, smooth_iters=2, log=None):
    """Mesh an SDF with sparse surface nets, relax + re-project, optionally decimate. Returns the object."""
    V_, Q = mesher.surface_nets(fn, lo, hi, h, log=log)
    me = bpy.data.meshes.new(name)
    me.from_pydata(V_.tolist(), [], Q.tolist())
    me.validate()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=h * 0.05)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    P, E = mesh_arrays(me)
    for _ in range(smooth_iters):
        P = taubin(P, E, iters=2)
        P = sdf.project(fn, P, iters=2, max_move=h)
    set_positions(me, P)
    if target_faces and len(me.polygons) * 2 > target_faces:
        m = ob.modifiers.new('Dec', 'DECIMATE')
        m.decimate_type = 'COLLAPSE'
        m.ratio = target_faces / (len(me.polygons) * 2.0)
        dg = bpy.context.evaluated_depsgraph_get()
        me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        ob.modifiers.clear()
        ob.data = me2
        bpy.data.meshes.remove(me)
        me2.name = name
    for poly in ob.data.polygons:
        poly.use_smooth = True
    return ob


def body_bounds(J, pad=0.12):
    pts = np.array([p for h, t in J.values() for p in (h, t)])
    lo = pts.min(0) - pad
    hi = pts.max(0) + pad
    lo[2] = -0.01
    return lo, hi


def build_body(P, bones, style, h=0.0028, target_tris=None, name=None, log=None):
    J = joints(bones)
    fn = anatomy(P, J, style)
    lo, hi = body_bounds(J)
    ob = sdf_object(fn, lo, hi, h, name or (P['name'] + '_body'), target_faces=target_tris, log=log)
    return ob, fn, J
