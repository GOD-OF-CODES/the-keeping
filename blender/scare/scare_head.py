"""JUMPSCARE (#147) — Ada's severed head for the Cycles-only catch close-up (docs/STATUS-jumpscare.md "## Spec" §1).

A NEW implicit (SDF) head sculpted for a 0.27 m view. #147b rebuild (r1): the first version smin'ed ~40 ellipsoids and
capsules (skull masses, malar pads, a brow chain, an orbital pocket) and read as a rubber bust: goggle-ring eyes, tube
nostrils, lobed cheeks, a flat profile. The base is now a RADIAL RELIEF head:
  * per-z cross-section curves (head space, her left half, Catmull-Rom, mirrored) around a vertical axis at y = AY give
    R0(theta, z), the distance from the axis to the skin, interpolated C1 between levels (Hermite);
  * smooth compact relief terms in (u = R_REF * theta, v = z) mm are ADDED to R (brow ridge, frontal eminences,
    temporal hollows, sunken orbits + upper-lid sulcus, tear troughs, malar eminences, zygomatic arches, buccal
    hollows, nasolabial folds, the nose (dorsum, tip lobules, alae, alar creases), philtrum, the lips (vermilion
    relief with a sharp border and a soft lower edge), muzzle, mentolabial sulcus, chin pad, jawline, masseters);
  * all of it is precomputed on a 0.25 deg x 0.5 mm grid, so the SDF is a bilinear lookup normalised by the slope.
Features that are not a relief stay SDF: lid shells on the globes + the palpebral fissure, nostrils and vestibules,
the oral slit + cavity (the jaw warp opens it), teeth (their own meshes), ears (under the hair), the cleaver cut.
Pure numpy (no bpy): the same file meshes in Blender and previews in plain CPython.

HEAD SPACE (this file works in MILLIMETRES; `Face.__call__` takes/returns metres):
  origin = midpoint of the two globe centres, +x = HER LEFT, +y = back (she faces -y), +z = up.
Anthropometry (adult women, Farkas 1994 norms; the in-game Ada is 1.62 m): head breadth eu-eu 142, length g-op 175,
bizygomatic 130, bigonial 97, intercanthal en-en 32, biocular ex-ex 88 (fissure 30 x 10-11), nose n-sn 50, al-al 31,
tip projection sn-prn 18, mouth ch-ch 49, sn-sto 19, n-gn 113, v-gn 218, globe 24 mm (axial), cornea r 7.8 mm.
Profile (y at x 0): glabella -25 (z 16), nasion -20.5 (z 6), rhinion -33 (z -15), pronasale -46 (z -30), subnasale
-27 (z -42), labrale sup. -31 (z -54), stomion (z -59.6), labrale inf. -31 (z -66), mentolabial -24 (z -80),
pogonion -29 (z -96), menton -14 (z -107), cervical point +10 (z -118).
"""
import math

import numpy as np

from characters import sdf
from characters.sdf import smin, smax
from lib import noise
from lib.noise import smoothstep as ss


def V(*a):
    return np.array(a, float)


def _n(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def ell(X, c, r, fwd=None, up=(0.0, 0.0, 1.0)):
    """Ellipsoid; radii (side, fwd, up) along an optional frame whose y axis is `fwd`."""
    R = None if fwd is None else sdf.frame(fwd, up)
    return sdf.ellipsoid(X, np.asarray(c, float), r, R)


def cap(X, a, b, r):
    return sdf.capsule(X, np.asarray(a, float), np.asarray(b, float), r)


def chain(X, pts, rads):
    pts = [np.asarray(p, float) for p in pts]
    d = None
    for a, b, ra, rb in zip(pts[:-1], pts[1:], rads[:-1], rads[1:]):
        di = sdf.capsule(X, a, b, ra) if abs(ra - rb) < 1e-6 else sdf.round_cone(X, a, b, ra, rb)
        d = di if d is None else np.minimum(d, di)
    return d


_SWEEP_CACHE = {}


def sweep(X, rows, power=2.0, step=0.5):
    """sdf.sweep for MILLIMETRE tables: sdf.sweep densifies its rows at a 0.01 step on every call (sized for metres),
    which in mm is ~10^4 Python iterations per evaluation; here the Catmull-Rom table is densified once (0.5 mm)."""
    key = (id(rows) if not isinstance(rows, list) else repr(rows), step)
    R = _SWEEP_CACHE.get(key)
    if R is None:
        R = _SWEEP_CACHE[key] = sdf.densify(rows, step)
    z = np.clip(X[:, 2], R[0, 0], R[-1, 0])
    cy = np.interp(z, R[:, 0], R[:, 1])
    sx = np.interp(z, R[:, 0], R[:, 2])
    fr = np.interp(z, R[:, 0], R[:, 3])
    bk = np.interp(z, R[:, 0], R[:, 4])
    cx = np.interp(z, R[:, 0], R[:, 5]) if R.shape[1] > 5 else 0.0
    x = X[:, 0] - cx
    y = cy - X[:, 1]
    ry = np.where(y >= 0, fr, bk)
    r = np.sqrt(x * x + y * y)
    c = np.where(r > 1e-9, np.abs(x) / np.maximum(r, 1e-9), 0.0)
    s = np.where(r > 1e-9, np.abs(y) / np.maximum(r, 1e-9), 1.0)
    Rr = (np.power(c / sx, power) + np.power(s / ry, power)) ** (-1.0 / power)
    side = r - Rr
    along = np.maximum(R[0, 0] - X[:, 2], X[:, 2] - R[-1, 0])
    return np.minimum(np.maximum(side, along), 0.0) + np.sqrt(np.maximum(side, 0.0) ** 2 + np.maximum(along, 0.0) ** 2)


def mir(p, s):
    p = np.array(p, float)
    p[0] *= s
    return p


def rot_x(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], float)


def rot_y(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], float)


def rot_z(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], float)


# ------------------------------------------------------------------------------------------------ the eyes
R_GLOBE = 12.0          # mm, sclera sphere
R_LID_IN = 12.35        # lid inner surface (0.35 mm tear-film gap over the sclera)
CORNEA_R = 7.8          # anterior radius of curvature (Gullstrand)
# #147d: the cornea is a separate clear dome (scare_scene.build_eyes). Limbus radius 5.5 mm (HVID 11 mm) where the
# 7.8 mm cornea sphere meets the 12 mm sclera: limbal plane 10.67 mm in front of the globe centre, sagitta 2.27 mm,
# apex 12.94 mm. (r1-r8: offset 4.9 put the geometric limbus at 24.3 deg / r 4.9 mm while the texture painted the
# cornea out to 28.9 deg = a white disc bigger than the dome: "a contact lens button".)
LIMBUS_R = 5.5
LIMBUS_ANG = math.degrees(math.asin(LIMBUS_R / R_GLOBE))           # 27.3 deg from the visual axis
LIMBUS_Y = math.sqrt(R_GLOBE ** 2 - LIMBUS_R ** 2)                 # 10.67 mm
CORNEA_OFF = LIMBUS_Y - math.sqrt(CORNEA_R ** 2 - LIMBUS_R ** 2)   # 5.14 mm: cornea sphere centre ahead of the globe's
IRIS_Y = LIMBUS_Y - 0.20                                           # iris plane (r9 0.32: a dark shadowed ring at the root)
AZ_CANTH = 78.0         # the canthi wrap round the globe (en-ex 30 mm on a 24 mm globe)
# #147d: a real fissure is ~30 x 10 mm with the upper lid over 1-2 mm of the limbus and the lower lid at the limbus
# (a little scleral show). r5-r8 had the margins at +26.5 / -27 deg: sclera above AND below a painted disc = a doll.
# At 21.5 deg the upper margin rests on the dome (cornea surface r 12.35 there = R_LID_IN). Her LEFT eye (0) a touch
# narrower (under the hair, older swelling).
EYE_UP = (17.5, 18.5)          # r11: the 1.0 mm margin fillet erodes ~0.6 mm, so 21.5 (r9-r10) still showed sclera
EYE_LO = (-26.5, -27.0)        # above the cornea; the lid shell is re-carved round the dome (rests ON the cornea)
MEDIAL_NOTCH = 3.4      # mm the fissure continues medially past the globe (lacrimal lake + caruncle): ex-en ~28 mm


def margins(az, k):
    """Upper / lower lid margin elevation (deg) vs azimuth (deg, + lateral) for eye k; 0 = her left, 1 = her right.
    Canthi at +-AZ_CANTH; positive canthal tilt (lateral canthus 4 deg higher); upper peak medial of the pupil, lower
    lid's lowest point lateral (Farkas / oculoplastic norms)."""
    u = np.clip(np.asarray(az, float) / AZ_CANTH, -1.0, 1.0)
    b = np.power(np.clip(1.0 - u * u, 0.0, 1.0), 0.85)        # 0.62 read as a round goggle opening
    up = EYE_UP[k] * b + 4.0 * u - 7.0 * u * b
    lo = EYE_LO[k] * b + 4.0 * u - 6.0 * u * b
    return up, lo


# ------------------------------------------------------------------------------------------------ radial relief base
AY = 60.0               # the radial axis: the vertical line x = 0, y = AY (head centre; the neck is centred here too)
R_REF = 75.0            # u = R_REF * theta: relief coordinates ~ mm across the face front
TH_STEP = 0.25          # deg
Z_STEP = 0.5            # mm
Z_LO, Z_HI = -175.0, 113.0

# Cross-sections: (z, [(x, y), ...]) — her LEFT half (x >= 0) from the front midline to the back midline, head space mm.
# The base face WITHOUT the nose, lips, orbits and the other relief terms below.
SECTIONS = [
    (113.0, [(0, 54), (6, 56), (8, 60), (6, 65), (0, 67)]),
    (110.0, [(0, 36), (14, 40), (21, 52), (21, 70), (13, 84), (0, 88)]),
    (104.0, [(0, 20), (22, 25), (35, 40), (39, 62), (35, 88), (21, 104), (0, 108)]),
    (94.0, [(0, 4), (27, 9), (44, 26), (51, 56), (48, 90), (32, 116), (0, 124)]),
    (78.0, [(0, -10), (30, -6), (51, 12), (62, 45), (61, 88), (44, 122), (0, 136)]),
    (60.0, [(0, -18), (30, -14), (52, 3), (66, 37), (69, 80), (52, 122), (0, 142)]),
    (40.0, [(0, -22.5), (30, -19.5), (50, -5), (65, 24), (71, 62), (58, 112), (0, 147)]),
    (24.0, [(0, -24), (20, -23), (36, -18.5), (49, -6), (60, 16), (69, 50), (63, 100), (0, 150)]),
    (11.0, [(0, -22.5), (16, -21), (32, -16), (46, -5), (56, 12), (66, 45), (64, 98), (0, 150)]),
    (0.0, [(0, -15), (12, -12.5), (18, -9.5), (31, -8), (45, -3), (55, 14), (64, 45), (64, 95), (0, 146)]),
    (-12.0, [(0, -17), (14, -13), (28, -9.5), (43, -5), (55, 10), (63, 38), (64, 80), (55, 115), (0, 138)]),
    (-25.0, [(0, -21), (14, -19), (28, -15.5), (43, -7.5), (56, 12), (64, 40), (63, 75), (52, 112), (0, 130)]),
    (-40.0, [(0, -24.5), (12, -23), (24, -18.5), (36, -10.5), (48, 2), (56, 25), (58, 55), (52, 85), (38, 108), (0, 118)]),
    (-55.0, [(0, -26), (12, -24.5), (22, -19.5), (33, -11), (45, 2), (52, 24), (54, 52), (48, 80), (34, 100), (0, 107)]),
    (-70.0, [(0, -25), (12, -23.5), (24, -16), (36, -5), (46, 12), (50, 35), (50, 60), (45, 84), (30, 100), (0, 105)]),
    (-85.0, [(0, -23.5), (12, -21.5), (25, -12.5), (36, 0), (44, 17), (48, 40), (49, 64), (43, 88), (26, 102), (0, 105)]),
    (-97.0, [(0, -26.5), (10, -25), (20, -18.5), (30, -7), (37, 9), (43, 30), (48, 55), (45, 82), (28, 100), (0, 104)]),
    (-106.0, [(0, -15), (10, -13.5), (20, -7), (30, 6), (40, 25), (47, 50), (46, 80), (30, 100), (0, 104)]),
    (-114.0, [(0, 3), (14, 5.5), (28, 13), (40, 28), (48, 52), (47, 80), (30, 100), (0, 104)]),
    (-124.0, [(0, 12), (15, 14.5), (30, 22), (43, 36), (50, 58), (47, 82), (30, 100), (0, 104)]),
    (-140.0, [(0, 15), (18, 17.5), (33, 26), (45, 41), (51, 62), (47, 84), (30, 100), (0, 104)]),
    (-175.0, [(0, 15), (18, 17.5), (33, 26), (45, 41), (51, 62), (47, 84), (30, 100), (0, 104)]),
]


def _catmull_closed(P, per=16):
    """Closed uniform Catmull-Rom through P (n, 2)."""
    n = len(P)
    out = []
    for i in range(n):
        p0, p1, p2, p3 = P[(i - 1) % n], P[i], P[(i + 1) % n], P[(i + 2) % n]
        t = np.linspace(0.0, 1.0, per, endpoint=False)[:, None]
        t2, t3 = t * t, t * t * t
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    return np.concatenate(out)


def section_rho(half, th_deg):
    """rho(theta) of one cross-section: the half curve is mirrored to a closed loop; theta 0 = front, + = her left."""
    half = np.asarray(half, float)
    full = np.concatenate([half, (half[-2:0:-1] * np.array([-1.0, 1.0]))])   # front -> left -> back -> right
    C = _catmull_closed(full, 24)
    th = np.degrees(np.arctan2(C[:, 0], AY - C[:, 1]))
    rho = np.hypot(C[:, 0], AY - C[:, 1])
    o = np.argsort(th)
    th, rho = th[o], rho[o]
    th = np.concatenate([th - 360.0, th, th + 360.0])
    rho = np.concatenate([rho, rho, rho])
    return np.interp(th_deg, th, rho)


def _hermite_z(zs, vals, zq):
    """C1 cubic Hermite through (zs, vals[i, :]) with finite-difference tangents; vals (nz, nth) -> (len(zq), nth)."""
    zs = np.asarray(zs, float)
    m = np.zeros_like(vals)
    m[1:-1] = (vals[2:] - vals[:-2]) / (zs[2:] - zs[:-2])[:, None]
    m[0] = (vals[1] - vals[0]) / (zs[1] - zs[0])
    m[-1] = (vals[-1] - vals[-2]) / (zs[-1] - zs[-2])
    k = np.clip(np.searchsorted(zs, zq) - 1, 0, len(zs) - 2)
    h = zs[k + 1] - zs[k]
    t = ((zq - zs[k]) / h)[:, None]
    h = h[:, None]
    t2, t3 = t * t, t * t * t
    return ((2 * t3 - 3 * t2 + 1) * vals[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * vals[k + 1]
            + (t3 - t2) * h * m[k + 1])


def _bump(u, v, u0, v0, a, b, amp, rot=0.0, p=2.0):
    """Compact C1 bump amp * (1 - q^2)^p, q = elliptic distance (a along the rotated u axis, b along v)."""
    c, s_ = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    du, dv = u - u0, v - v0
    qu = (du * c + dv * s_) / a
    qv = (-du * s_ + dv * c) / b
    q2 = qu * qu + qv * qv
    return amp * np.power(np.clip(1.0 - q2, 0.0, 1.0), p)


def _seg2(u, v, pts):
    """Distance from (u, v) to a 2-D polyline and the arc parameter 0..1 of the nearest point."""
    pts = np.asarray(pts, float)
    L = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(pts, axis=0).T))])
    best = np.full(u.shape, 1e9)
    par = np.zeros(u.shape)
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ab = b - a
        t = np.clip(((u - a[0]) * ab[0] + (v - a[1]) * ab[1]) / max(ab @ ab, 1e-12), 0.0, 1.0)
        d = np.hypot(u - (a[0] + t * ab[0]), v - (a[1] + t * ab[1]))
        m = d < best
        best = np.where(m, d, best)
        par = np.where(m, (L[i] + t * (L[i + 1] - L[i])) / L[-1], par)
    return best, par


def _ridge(u, v, pts, w, amp, p=2.0, taper=(1.0, 1.0)):
    """amp * (1 - (d/w)^2)^p along a polyline (negative amp = a groove); amplitude tapers linearly end to end."""
    d, t = _seg2(u, v, pts)
    a = amp * (taper[0] + (taper[1] - taper[0]) * t)
    return a * np.power(np.clip(1.0 - (d / w) ** 2, 0.0, 1.0), p)


def _ring(u, v, u0, v0, a, b, w, amp, rot=0.0, arc=(0.0, 360.0), soft=25.0):
    """A curved groove/ridge following the ellipse (a, b) round (u0, v0): amp * (1 - (dq*a/w)^2)^2 near q = 1, only
    over the polar arc (deg, measured from +u counter-clockwise, after `rot`), fading over `soft` deg at the ends."""
    c, s_ = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    du, dv = u - u0, v - v0
    qu = (du * c + dv * s_) / a
    qv = (-du * s_ + dv * c) / b
    q = np.sqrt(qu * qu + qv * qv)
    ph = np.degrees(np.arctan2(qv, qu)) % 360.0
    a0, a1 = arc
    span = (a1 - a0) % 360.0
    rel = (ph - a0) % 360.0
    win = ss(0.0, soft, rel) * ss(span, span - soft, rel) * (rel <= span)
    return amp * win * np.power(np.clip(1.0 - ((q - 1.0) * a / w) ** 2, 0.0, 1.0), 2.0)


def _tab(v, rows):
    """Smooth 1-D table lookup (Catmull-Rom densified) — rows [(v, value), ...] with v DESCENDING or ascending."""
    rows = np.asarray(sorted(rows), float)
    R = sdf.densify(rows, 0.25)
    return np.interp(v, R[:, 0], R[:, 1], left=R[0, 1], right=R[-1, 1])


# nose (u = 0 midline): height over the base and half-width vs z
NOSE_H = [(10.0, 0.0), (6.0, 1.5), (0.0, 4.6), (-8.0, 9.4), (-15.0, 14.2), (-22.0, 18.6), (-27.0, 21.8), (-31.0, 23.6),
          (-34.0, 23.4), (-36.5, 20.5), (-38.5, 14.0), (-40.0, 7.0), (-41.5, 2.5), (-43.0, 0.0)]
NOSE_W = [(10.0, 9.0), (0.0, 9.5), (-10.0, 10.5), (-20.0, 11.0), (-28.0, 11.2), (-33.0, 11.5), (-37.0, 12.8), (-40.0, 14.5), (-44.0, 15.5)]
# cross-profile exponent (1 - t^2)^p: a narrow bony ridge high up, a rounded dome at the tip (p 2 everywhere = a blade)
NOSE_P = [(10.0, 2.0), (0.0, 1.9), (-10.0, 1.6), (-20.0, 1.2), (-27.0, 0.9), (-32.0, 0.75), (-36.0, 0.8), (-40.0, 1.2), (-44.0, 1.6)]


# split lower lip (her LEFT, x +6): a vertical laceration across the vermilion, its axis 0.6 mm under the lip surface
# (measured: lower lip y -31.6 / -32.8 / -29.6 at z -61 / -63.5 / -68 for x 6)
LACERATION = [V(6.0, -31.7, -60.8), V(6.3, -32.9, -63.0), V(6.4, -32.6, -64.6)]   # axis ON the skin (0.6 mm under
# it left a 0.1 mm membrane in front of the cut = a hanging flap)


def lip_lines(u):
    """(upper vermilion border z, stomion z, lower border z) vs u (mm across); commissures at +-24.5. Cupid's bow peaks
    at |u| 5, the philtral dip at 0; her LEFT lower lip swollen (the split)."""
    a = np.clip(np.abs(u) / 24.5, 0.0, 1.0)
    drop = -1.4 * a * a                                            # slack, down-turned corners (r4 read as a grin)
    st = -59.6 - 0.35 * (1.0 - a * a) + drop
    up = -59.4 + drop + 7.0 * np.power(1.0 - a * a, 0.6) + 0.7 * np.exp(-((np.abs(u) - 5.0) / 2.6) ** 2) - 0.9 * np.exp(-(u / 2.0) ** 2)
    lo = -59.6 + drop - 9.6 * np.power(1.0 - a * a, 0.7) - 1.6 * np.exp(-((u - 8.0) / 6.5) ** 2)
    return up, st, lo


def lip_relief(u, v):
    """Vermilion relief (mm outward): the upper lip rises at a sharp border (white roll), rolls back toward the slit;
    the lower lip is fuller with a soft lower edge; her LEFT lower half swollen +2.2 mm (split lip)."""
    up, st, lo = lip_lines(u)
    a = np.clip(np.abs(u) / 24.5, 0.0, 1.0)
    side = np.power(np.clip(1.0 - a * a, 0.0, 1.0), 0.45)
    tu = (up - v) / np.maximum(up - st, 0.3)                       # 0 at the border, 1 at the stomion
    # upper-lip skin ramps forward from subnasale (0) to 0.5 at the border; the vermilion carries on to 1 and rolls back
    gu = (0.5 * ss(-1.25, 0.0, tu) + 0.5 * ss(-0.02, 0.35, tu)) * (1.0 - 0.4 * ss(0.5, 1.0, tu)) * (tu <= 1.15)
    Au = 2.4 * side + 0.6 * np.exp(-(u / 4.0) ** 2)                # + the tubercle
    roll = 0.35 * np.exp(-((v - (up + 0.55)) / 0.5) ** 2) * side   # white roll just above the border
    tl = (st - v) / np.maximum(st - lo, 0.3)                       # 0 at the stomion, 1 at the lower border
    gl = ss(-0.35, 0.38, tl) * (1.0 - ss(0.5, 1.2, tl)) * (tl >= -0.15)
    Al = 4.8 * side + 2.2 * np.exp(-((u - 8.0) / 6.5) ** 2)
    return np.where(v > st, Au * gu + roll, Al * gl)


def relief(u, v, asym=1.0):
    """All the smooth relief terms (mm outward) at (u, v); her LEFT side is u > 0. `asym` scales her left side."""
    R = np.zeros_like(u)
    for s, k in ((1.0, asym), (-1.0, 1.0)):
        su = s * u
        # ---- forehead / brow / temples
        R += k * _bump(su, v, 24.0, 46.0, 24.0, 20.0, 2.2)                                      # frontal eminences
        R += k * _ridge(su, v, [(8.0, 14.0), (20.0, 16.0), (32.0, 16.0), (42.0, 13.5)], 9.0, 2.0, taper=(0.9, 0.6))  # brow ridge
        R += k * _bump(su, v, 61.0, 18.0, 13.0, 22.0, -4.5)                                     # temporal hollow (gaunt)
        # ---- orbits: sunken eyes, the upper-lid sulcus, tear trough, crow's region
        R += k * _bump(su, v, 31.0, 4.0, 20.0, 13.0, -8.5, p=2.0)
        R += k * _bump(su, v, 31.5, 11.5, 14.0, 5.0, -7.0)                                      # upper-lid sulcus (deep: gaunt)
        R += k * _ridge(su, v, [(17.0, -9.0), (25.0, -14.0), (35.0, -16.5), (45.0, -14.0)], 3.5, -1.5, taper=(1.0, 0.4))
        # ---- cheekbones, arches, hollows, folds
        R += k * _bump(su, v, 44.0, -18.0, 14.0, 9.5, 4.0, rot=-25.0)                           # malar eminence
        R += k * _ridge(su, v, [(52.0, -12.0), (67.0, -10.0)], 6.0, 2.0)                       # zygomatic arch
        R += k * _bump(su, v, 30.0, -27.0, 11.0, 11.0, 1.8)                                     # malar fat (thin)
        R += k * _bump(su, v, 42.0, -50.0, 14.0, 18.0, -7.5)                                    # buccal hollow (gaunt)
        R += k * _ridge(su, v, [(17.5, -38.0), (22.5, -50.0), (26.5, -61.0)], 3.4, -0.9, taper=(1.0, 0.3))
        R += k * _ridge(su, v, [(21.5, -38.0), (27.0, -50.0), (31.0, -61.0)], 6.5, 1.4, taper=(1.0, 0.2))
        R += k * _ridge(su, v, [(26.0, -67.0), (26.5, -78.0)], 3.0, -0.4, taper=(1.0, 0.2))        # marionette line
        R += k * _bump(su, v, 52.0, -58.0, 10.0, 18.0, 0.8)                                     # masseter
        R += k * _ridge(su, v, [(14.0, -101.0), (30.0, -97.0), (44.0, -88.0), (53.0, -76.0)], 5.0, 1.8)   # jawline
        # ---- the mouth corners: commissure pit + modiolus
        R += k * _bump(su, v, 24.8, -60.0, 3.5, 3.0, -1.4)
        R += k * _bump(su, v, 29.0, -60.0, 6.0, 8.0, 1.0)
        # ---- nose: alae + alar creases + supra-alar crease + tip lobules; philtral columns
        R += k * _ridge(su, v, [(7.0, -39.0), (10.8, -38.6), (13.8, -36.8), (15.2, -33.8)], 3.4, 4.0, taper=(0.7, 1.0))  # alar rim
        R += k * _bump(su, v, 13.0, -35.2, 4.6, 4.2, 2.2)                                       # alar lobule fullness
        R += k * _ring(su, v, 12.4, -35.0, 6.4, 5.6, 1.4, -1.3, rot=10.0, arc=(-25.0, 95.0), soft=35.0)   # alar-facial crease
        R += k * _bump(su, v, 4.2, -33.0, 5.5, 6.0, 1.8)                                        # tip lobule (domes)
        R += k * _ridge(su, v, [(3.4, -43.0), (5.4, -51.8)], 2.3, 0.35, taper=(0.5, 1.0))        # philtral column
    # ---- midline
    R += _bump(u, v, 0.0, 15.5, 12.0, 9.0, 1.4)                                                 # glabella
    R += _ridge(u, v, [(0.0, -37.0), (0.0, -41.5)], 3.4, 2.0, taper=(0.5, 1.0))                 # columella
    R += _bump(u, v, 0.0, -58.0, 27.0, 16.0, 2.4)                                               # muzzle (orbicularis)
    R += _bump(u, v, 0.0, -47.0, 9.0, 3.5, -0.5)                                                # upper-lip skin concavity
    R += _ridge(u, v, [(-11.0, -79.5), (0.0, -80.5), (11.0, -79.5)], 5.5, -1.6)                 # mentolabial sulcus
    R += _bump(u, v, 0.0, -95.0, 16.0, 11.0, 3.4)                                               # chin pad
    nh = _tab(v, NOSE_H)
    nw = _tab(v, NOSE_W)
    t = np.abs(u) / nw
    R += nh * np.power(np.clip(1.0 - t * t, 0.0, 1.0), _tab(v, NOSE_P))
    R += lip_relief(u, v)
    return R


class Face:
    """The scare head SDF (rest model + jaw warp). Call with metres -> metres."""

    def __init__(self, jaw_deg=9.0, seed=1976):
        self.jaw = float(jaw_deg)
        self.seed = seed
        self.H = V(0.0, 55.0, -18.0)                     # TMJ hinge (axis = x)
        self.S = V(0.0, -31.0, -61.0)                    # stomion, rest
        self.E = [V(31.0, 0.0, -1.2), V(-31.0, 0.0, 0.0)]   # globe centres: 0 = her LEFT (1.2 mm lower), 1 = her right
        d = self.S - self.H
        self.ang_d = math.degrees(math.atan2(d[2], d[1]))
        # mandible lower border (menton -> gonion), opened by the jaw angle: the neck below it does not rotate
        R = rot_x(self.jaw)
        M = self.H + R @ (V(0, -16, -106) - self.H)
        G = self.H + R @ (V(0, 38, -80) - self.H)
        t = _n(G - M)
        self.Mb = M
        self.nb = V(0.0, t[2], -t[1])
        # cleaver cut (C4-C5, rising toward the nape: a blow from behind and above, sever.py TILT 20 deg)
        self.cut_c = V(0.0, 12.0, -128.0)
        self.cut_n = _n(V(0.0, -0.36, 1.0))
        # dental arches (mm): labial surface of the incisors, y = y0 + k x^2
        self.arch_up = (-21.5, 0.034)      # incisor labial surface ~11 mm behind labrale superius (#147b r1)
        self.arch_lo = (-19.5, 0.036)
        self._build_base()

    # ---------------------------------------------------------------- jaw warp (deformed -> rest)
    def jaw_weight(self, X):
        """Fraction of the jaw angle each DEFORMED point is rotated by. Space splits along the oral slit (z -59.4 at
        the lips, rising 0.3/mm behind with the occlusal plane); across the opening the weight ramps LINEARLY over a
        band a little taller than the opening itself, so deformed -> rest stays monotonic (rest = s + r*theta*w) and
        only the slit is stretched into the open mouth. In the lip zone the angle follows a lens (soft lips: the
        commissures stay closed); bone and everything deeper rotates rigidly; the neck below the mandible and
        everything behind the hinge stays."""
        x, y, z = X[:, 0], X[:, 1], X[:, 2]
        rel = X - self.H
        r = np.sqrt(rel[:, 1] ** 2 + rel[:, 2] ** 2)
        # corners closed. #147d: a power-1.15 parabola, not sqrt: the sqrt profile opened the mouth as an ellipse with
        # vertical ends ("a rectangular puppet slot"); a slack dead mouth is an almond, pinched at the commissures
        c = np.clip(1.0 - (x / 24.0) ** 2, 0.0, 1.0) ** 1.15
        lz = ss(-10.0, -19.0, y) * (1.0 - ss(13.0, 24.0, np.abs(z + 61.0)))
        m = 1.0 - lz * (1.0 - c)
        th = math.radians(self.jaw) * m
        zs = -59.4 + 0.3 * 3.0 * np.logaddexp(0.0, (y + 20.0) / 3.0)
        sd = z - zs
        bw = 6.0 * ss(18.0, 32.0, np.abs(x))
        top = 0.8 + bw
        bot = -(r * th + 1.0) - bw
        w = np.clip((top - sd) / (top - bot), 0.0, 1.0) * m
        e = (X - self.Mb) @ self.nb                                   # mm below the opened mandible border
        w = w * ss(22.0, 3.0, e)        # 19 mm band (with the condylar glide below the chin moves ~8 mm back, not 15)
        w = w * ss(8.0, -6.0, rel[:, 1])                              # nothing behind the hinge rotates
        return w

    GLIDE = (0.0, -6.0, -1.5)           # mm per 9 deg: the condyle glides forward/down as the jaw opens (#147b)

    def rotate_jaw(self, X, w, deg):
        """FORWARD jaw motion by deg (scaled per point by w): hinge rotation about the TMJ axis + the condylar glide.
        A pure 9 deg hinge drove the menton 15 mm back into the throat (the inverse warp then folded the neck)."""
        w = np.broadcast_to(np.asarray(w, float), (len(X),))
        rel = X - self.H
        a = np.radians(deg * w)
        c, s = np.cos(a), np.sin(a)
        y = rel[:, 1] * c - rel[:, 2] * s
        z = rel[:, 1] * s + rel[:, 2] * c
        g = (deg / 9.0) * w
        return np.stack([X[:, 0], y + self.H[1] + g * self.GLIDE[1], z + self.H[2] + g * self.GLIDE[2]], 1)

    def unrotate_jaw(self, X, w, deg):
        """Inverse of rotate_jaw for the same w."""
        w = np.broadcast_to(np.asarray(w, float), (len(X),))
        g = (deg / 9.0) * w
        Y = X - np.stack([np.zeros(len(X)), g * self.GLIDE[1], g * self.GLIDE[2]], 1)
        rel = Y - self.H
        a = np.radians(-deg * w)
        c, s = np.cos(a), np.sin(a)
        y = rel[:, 1] * c - rel[:, 2] * s
        z = rel[:, 1] * s + rel[:, 2] * c
        return np.stack([X[:, 0], y + self.H[1], z + self.H[2]], 1)

    def to_rest(self, X):
        if self.jaw == 0.0:
            return X, np.zeros(len(X))
        w = self.jaw_weight(X)
        return self.unrotate_jaw(X, w, self.jaw), w

    # ---------------------------------------------------------------- the eye region
    def eye_local(self, X, k):
        s = 1.0 if k == 0 else -1.0
        v = X - self.E[k]
        r = np.maximum(np.linalg.norm(v, axis=1), 1e-9)
        az = np.degrees(np.arctan2(s * v[:, 0], -v[:, 1]))          # + = lateral
        el = np.degrees(np.arcsin(np.clip(v[:, 2] / r, -1.0, 1.0)))
        return v, r, az, el

    def lids(self, X, k):
        """(shell, slot): the lid shell around globe k and the palpebral fissure carved through it."""
        v, r, az, el = self.eye_local(X, k)
        up, lo = margins(az, k)
        du = el - up
        dl = lo - el
        t_up = 1.9 + 0.9 * ss(0.0, 10.0, du) + 0.9 * ss(14.0, 34.0, du)     # margin 1.9 -> tarsus 2.8 -> fold 3.7
        t_lo = 1.7 + 0.7 * ss(0.0, 9.0, dl) + 0.7 * ss(12.0, 30.0, dl)
        t = np.where(el > (up + lo) * 0.5, t_up, t_lo)
        shell = np.maximum(r - (R_LID_IN + t), R_LID_IN - r)
        ang = np.maximum.reduce([el - up, lo - el, np.abs(az) - AZ_CANTH])
        # the fissure cuts the lid shell only (r up to R_LID_IN + 5: the thickest fold is 3.7 mm) — a deeper slot left
        # a 7 mm moat round the globe (the eye read as a bead in a trench, #147b slices)
        slot = np.maximum(ang * (math.pi / 180.0) * np.maximum(r, R_LID_IN), np.maximum(r - (R_LID_IN + 5.0), (R_LID_IN - 3.0) - r))
        return shell, slot

    # ---------------------------------------------------------------- the rest model
    def _build_base(self):
        """R(theta, z) on the grid: cross-sections (C1 in z) + relief; and the slope terms for the SDF normalisation."""
        th = np.arange(-180.0, 180.0 + 1e-9, TH_STEP)
        zq = np.arange(Z_LO, Z_HI + 1e-9, Z_STEP)
        zs = np.array([z for z, _ in SECTIONS])[::-1]
        rows = np.stack([section_rho(h, th) for _, h in SECTIONS])[::-1]
        R0 = _hermite_z(zs, rows, zq)                                   # (nz, nth)
        TH, ZZ = np.meshgrid(th, zq)
        U = R_REF * np.radians(TH)
        R = R0 + relief(U.ravel(), ZZ.ravel(), asym=1.04).reshape(R0.shape)
        # 1-2 mm of irregularity at 10-30 mm (no CG symmetry): fbm on the unwrapped surface
        P2 = np.stack([U.ravel() / 22.0, ZZ.ravel() / 22.0, np.full(U.size, 0.37)], 1)
        R += (0.55 * noise.fbm(P2, 3, self.seed + 7)).reshape(R0.shape)
        self.R_th, self.R_z, self.R = th, zq, R
        dRz = np.gradient(R, Z_STEP, axis=0)
        dRt = np.gradient(R, math.radians(TH_STEP), axis=1)             # per radian
        self.R_dz, self.R_dt = dRz, dRt

    def _lookup(self, A, th, z):
        fi = (th + 180.0) / TH_STEP
        fj = (np.clip(z, Z_LO, Z_HI) - Z_LO) / Z_STEP
        i0 = np.clip(np.floor(fi).astype(np.int64), 0, A.shape[1] - 2)
        j0 = np.clip(np.floor(fj).astype(np.int64), 0, A.shape[0] - 2)
        a = np.clip(fi - i0, 0.0, 1.0)
        b = np.clip(fj - j0, 0.0, 1.0)
        return ((A[j0, i0] * (1 - a) + A[j0, i0 + 1] * a) * (1 - b) + (A[j0 + 1, i0] * (1 - a) + A[j0 + 1, i0 + 1] * a) * b)

    def base(self, X):
        """SDF of the radial relief head (mm)."""
        dx = X[:, 0]
        dy = AY - X[:, 1]
        rho = np.hypot(dx, dy)
        th = np.degrees(np.arctan2(dx, dy))
        z = X[:, 2]
        R = self._lookup(self.R, th, z)
        gz = self._lookup(self.R_dz, th, z)
        gt = self._lookup(self.R_dt, th, z) / np.maximum(rho, 8.0)
        side = (rho - R) / np.sqrt(1.0 + gz * gz + gt * gt)
        along = np.maximum(Z_LO - z, z - Z_HI)
        return np.where(along > 0, np.sqrt(np.maximum(side, 0) ** 2 + along ** 2) * (side > 0) + np.maximum(side, along) * (side <= 0), side)

    def surface_y(self, x, z):
        """Rest-space y of the base skin (incl. relief) in front of the axis at (x, z) (mm), by bisection on base()."""
        x = np.atleast_1d(np.asarray(x, float))
        z = np.atleast_1d(np.asarray(z, float))
        lo = np.full(x.shape, -90.0)
        hi = np.full(x.shape, AY)
        for _ in range(40):
            mid = 0.5 * (lo + hi)
            d = self.base(np.stack([x, mid, z], 1))
            out = d > 0
            lo = np.where(out, mid, lo)
            hi = np.where(out, hi, mid)
        return 0.5 * (lo + hi)

    def skin_radial(self, th_deg, z, inset=0.0):
        """Point(s) on the base skin at polar angle th (deg, 0 = front, + = her left) and height z (mm), `inset` mm
        under the surface (bisection along the radial ray from the axis)."""
        th = np.radians(np.atleast_1d(np.asarray(th_deg, float)))
        z = np.atleast_1d(np.asarray(z, float))
        lo = np.zeros(th.shape)
        hi = np.full(th.shape, 140.0)
        for _ in range(40):
            mid = 0.5 * (lo + hi)
            P = np.stack([mid * np.sin(th), AY - mid * np.cos(th), z], 1)
            out = self.base(P) > 0
            hi = np.where(out, mid, hi)
            lo = np.where(out, lo, mid)
        r = 0.5 * (lo + hi) - inset
        return np.stack([r * np.sin(th), AY - r * np.cos(th), z], 1)

    def lip_parts(self, X):
        """(upper, lower) vermilion pseudo-distances (mm, < 0 inside) in the frontal (x, z) plane, for masks; only on
        the face front (y < -18)."""
        x, z = X[:, 0], X[:, 2]
        up, st, lo = lip_lines(x)
        side = np.abs(x) - 24.6
        front = np.where(X[:, 1] < -18.0, 0.0, 50.0)
        du = np.maximum(np.maximum(z - up, st - z), side) + front
        dl = np.maximum(np.maximum(z - st, lo - z), side) + front
        return du, dl

    def nostrils(self, X, d):
        """Carve the nostrils (oblique teardrop openings from below, converging to the tip) and the vestibules."""
        for s in (1.0, -1.0):
            fwd = _n((-s * 0.36, -1.0, 0.42))
            d = smax(d, -ell(X, V(s * 6.9, -35.2, -39.4), (2.6, 4.4, 2.0), fwd=fwd, up=(0.0, 0.3, 1.0)), 0.6)
            d = smax(d, -ell(X, V(s * 7.2, -34.6, -36.0), (3.0, 4.2, 3.0)), 1.0)                      # vestibule
        return d

    @staticmethod
    def cavity(X, grow=0.0):
        """Oral cavity envelope between the gum lines (z -67.5 .. -50.5), front at y -24 (behind the lips)."""
        return ell(X, V(0.0, 4.5, -59.5), (22.0 + grow, 28.5 + grow, 10.0 + grow))      # rounded (the box read as a black box)

    def rest(self, X):
        x, y, z = X[:, 0], X[:, 1], X[:, 2]
        d = self.base(X)
        m = (np.abs(x) < 26) & (y > -60) & (y < -15) & (z > -50) & (z < -26)
        if m.any():
            d[m] = self.nostrils(X[m], d[m])
        for k in (0, 1):
            E = self.E[k]
            s = 1.0 if k == 0 else -1.0
            m = np.all(np.abs(X - E) < 26.0, axis=1)
            if not m.any():
                continue
            Xm = X[m]
            dm = d[m]
            gsp = np.minimum(np.linalg.norm(Xm - E, axis=1) - R_LID_IN,                       # the globe's space
                             np.linalg.norm(Xm - (E + V(0.0, -CORNEA_OFF, 0.0)), axis=1) - (CORNEA_R + 0.3))   # + dome
            dm = smax(dm, -gsp, 0.4)
            shell, slot = self.lids(Xm, k)
            dm = smin(dm, shell, 3.0)
            dm = smax(dm, -gsp, 0.25)          # r11: the lids rest ON the cornea (the dome is re-carved out of the shell)
            # #147d: the medial canthus continues ~3.4 mm past the globe (lacrimal lake): a rounded pocket the caruncle
            # sits in, so the fissure reads ~28 mm long, pointed laterally, rounded medially (r1-r8: 23 mm, a round hole)
            dm = smax(dm, -ell(Xm, E + V(-s * (13.0 + MEDIAL_NOTCH * 0.25), -6.2, -1.1), (2.0 + MEDIAL_NOTCH * 0.5, 3.6, 1.45)), 0.5)
            # #147d: 1.0 mm fillet on the margin (0.6 left a flat, square-edged "gasket" face)
            dm = smax(dm, -slot, 1.0)
            # caruncle + plica: the floor of the lake, added AFTER the slot (r1-r8 placed it inside the slot's window,
            # which carved it away: the medial canthus was an empty corner)
            dm = smin(dm, ell(Xm, E + V(-s * 14.3, -4.0, -0.9), (1.6, 1.7, 1.1)) + 0.25 * noise.fbm(Xm / 0.8, 2, self.seed + 9), 0.6)   # r13: lumpy, deeper
            d[m] = dm
        m = (np.abs(x) < 40) & (y > -55) & (y < 45) & (z > -90) & (z < -36)
        if m.any():
            Xm = X[m]
            dm = d[m]
            dm = smax(dm, -chain(Xm, LACERATION, [0.8, 0.95, 0.7]), 0.3)                      # lip laceration
            up, st, lo = lip_lines(Xm[:, 0])
            cx = np.clip(1.0 - (Xm[:, 0] / 25.0) ** 2, 0.0, 1.0) ** 1.2          # #147d: almond, pinched corners
            slot = np.maximum(np.abs(Xm[:, 2] - st) - (0.25 + 1.1 * cx), np.maximum(np.abs(Xm[:, 1] + 31.0) - 11.0, np.abs(Xm[:, 0]) - 24.8))
            # oral cavity between the gum lines (z -67.5 .. -50.5)
            cav = self.cavity(Xm)
            dm = smax(dm, -smin(slot, cav, 2.0), 0.8)
            dm = smin(dm, ell(Xm, V(0.0, 5.0, -67.0), (18.5, 25.0, 7.0)), 2.5)               # tongue (swollen, high)
            xs = np.linspace(-22.0, 22.0, 9)
            y0, kk = self.arch_up
            dm = smin(dm, chain(Xm, [V(xx, y0 + kk * xx * xx + 2.6, -49.6) for xx in xs], [2.5] * len(xs)), 1.6)
            y0, kk = self.arch_lo
            dm = smin(dm, chain(Xm, [V(xx, y0 + kk * xx * xx + 2.6, -70.2) for xx in xs], [2.5] * len(xs)), 1.6)
            d[m] = dm
        for s in (1.0, -1.0):                                                                 # ears (under the hair)
            ec = V(s * 66.0, 62.0, -14.0)
            m = np.all(np.abs(X - ec) < V(22, 30, 42), axis=1)
            if m.any():
                Xm = X[m]
                e = ell(Xm, ec, (4.5, 14.0, 27.0), fwd=_n((s * 0.18, -1.0, 0.0)))
                e = smin(e, chain(Xm, [ec + V(s * 3.5, -8.0, 15.0), ec + V(s * 4.5, 3.0, 25.0), ec + V(s * 4.5, 13.0, 10.0),
                                       ec + V(s * 3.5, 11.0, -14.0), ec + V(s * 2.5, 2.0, -24.0)], [2.4] * 5), 1.8)
                d[m] = smin(d[m], e, 4.0)
        d = d + 0.25 * noise.fbm(X / 9.0, 2, self.seed + 1)
        cutd = self.cut_dist(X)
        m = z < -95.0
        if m.any():
            # #147d: the cut must read FROM THE FRONT (r1-r8: a smooth rounded edge under the chin, invisible). Cut skin
            # retracts: it ends 4-12 mm above the cleaver plane in a ragged torn line, over an exposed band of fat and
            # muscle 1.2-2 mm inside the skin surface that bulges in bundles; the trachea stump hangs out of the cut.
            Xm = X[m]
            band = self.tissue_band(Xm, cutd[m])
            bul = ss(-0.15, 0.55, noise.fbm(Xm * np.array([1.0 / 3.2, 1.0 / 3.2, 1.0 / 7.0]), 3, self.seed + 40))
            d[m] = d[m] + band * (1.9 - 1.5 * bul)
        d = smax(d, cutd, 0.6)
        if m.any():
            d[m] = smin(d[m], self.neck_extras(X[m]), 1.2)
        return d

    # ---------------------------------------------------------------- the cut neck (#147d)
    def cut_dist(self, X):
        """Signed distance-ish to the cleaver plane (> 0 = cut away), with a 2.2 mm irregular hack."""
        return -((X - self.cut_c) @ self.cut_n) + 2.2 * noise.fbm(X / 11.0, 3, self.seed + 2)

    def skin_line(self, X):
        """Height (mm above the cut) of the retracted, torn skin edge: 4-12 mm, ragged (tears + 1 mm saw teeth)."""
        return (7.5 + 3.2 * noise.fbm(X / 13.0, 2, self.seed + 41) + 1.3 * noise.fbm(X / 2.4, 2, self.seed + 42)
                + 0.6 * np.abs(noise.perlin(X / 0.9, self.seed + 43)))

    def tissue_band(self, X, cutd=None):
        """1 on the exposed tissue between the torn skin edge and the cut plane, 0 on skin (0.5 mm transition)."""
        if cutd is None:
            cutd = self.cut_dist(X)
        return ss(-self.skin_line(X) - 0.25, -self.skin_line(X) + 0.25, cutd)

    TRACH_A = V(0.0, 25.0, -112.0)          # trachea axis (rest/deformed: the neck does not move with the jaw)
    TRACH_B = V(0.0, 20.5, -139.0)          # #147e: its torn end hangs ~15 mm below the front of the cut (r9-r14: 9 mm,
    #                                         hidden behind the chin from the hero camera)
    TRACH_R = 8.3                           # adult female trachea ~16-17 mm outer diameter, 2 mm wall

    def trachea(self, X):
        """(outer SDF of the protruding trachea stump with cartilage rings + a ragged torn end, lumen SDF)."""
        A, B = self.TRACH_A, self.TRACH_B
        ab = B - A
        L = np.linalg.norm(ab)
        u = ab / L
        q = X - A
        t = q @ u
        rad = np.linalg.norm(q - t[:, None] * u[None], axis=1)
        # C-rings, 3.9 mm pitch, irregular (r9: 0.32 mm regular rings read as a plastic bottle's screw thread)
        ring = (0.16 + 0.08 * noise.perlin(X / 3.0, self.seed + 46)) * np.cos(2.0 * math.pi * (t + 0.6 * noise.perlin(X / 6.0, self.seed + 47)) / 3.9) * ss(0.0, 3.0, t)
        back = (X[:, 1] - (A[1] + 6.2 + 0.0 * t))                                      # flat membranous back wall
        side = np.maximum(rad - (self.TRACH_R + ring), back)
        end = t - (L + 1.8 * noise.fbm(X / 2.2, 2, self.seed + 44))                     # torn end
        outer = np.maximum(side, np.maximum(end, -t))
        lumen = rad - 6.1
        return outer, lumen

    def neck_anchor(self, x, inset):
        """A point `inset` mm inside the front neck skin at lateral x, 1 mm above the cleaver plane there."""
        key = (round(float(x), 2), round(float(inset), 2))
        cache = self.__dict__.setdefault('_anchors', {})
        if key not in cache:
            z = -126.0
            for _ in range(3):                                     # the plane rises 0.36 mm per mm toward the back
                y = float(self.surface_y(x, z)[0])
                z = float(self.cut_c[2] + 0.36 * (y - self.cut_c[1]) / 1.0) + 1.0
            n = _n(V(x, y - AY, 0.0))                              # outward (radial from the axis)
            cache[key] = V(x, y, z) - n * inset
        return cache[key]

    # torn muscle tags (x, radius, hang length) and clotted drips (x, length): strap muscles and the sternocleidomastoid
    # ends retract unevenly and hang out of the cut; blood beads at the lowest front points
    TAGS = ((-21.0, 3.0, 8.0), (16.0, 2.4, 5.5))      # #147d look: 3 tags + 3 drips read as a row of icicles
    DRIPS = ((6.0, 8.0), (-12.5, 4.5), (-3.0, 6.0))   # #147e: longer (they hung inside the bottom edge's dark)

    def neck_extras(self, X):
        """Trachea stump (hollow) + torn muscle tags + clotted drips, unioned under the cut."""
        outer, lumen = self.trachea(X)
        d = smax(outer, -lumen, 0.5)
        for x, r, ln in self.TAGS:
            c = self.neck_anchor(x, r * 0.8)
            # a torn flap, not a stalactite: flattened front-back, lumpy
            q = (X - c) * np.array([1.0, 1.7, 1.0])
            dt = sdf.round_cone(q, V(0.0, 0.0, 0.0), V(0.0, -1.0, -ln), r, r * 0.6) + 0.7 * noise.fbm(X / 2.0, 2, self.seed + 45)
            d = smin(d, dt, 1.0)
        for x, ln in self.DRIPS:
            c = self.neck_anchor(x, 0.6)
            d = smin(d, sdf.round_cone(X, c + V(0.0, 0.0, 1.5), c + V(0.0, 0.2, -ln), 0.7, 1.55), 0.6)   # r18: rounder drop bulbs (glints)
        return d


    def __call__(self, X):
        Xmm = np.asarray(X, float) * 1000.0
        Xr, _ = self.to_rest(Xmm)
        return self.rest(Xr) * 0.001

    # ---------------------------------------------------------------- teeth (their own meshes)
    def teeth(self, X, lower=False):
        """Teeth SDF in REST space (mm). Upper: incisal edges at z -61 (2 mm under the upper lip), lower 2 mm behind
        and overlapping (overjet 2.5 / overbite 2). Crown sizes (mesiodistal x labiolingual x height, mm): central
        8.5x7x10.5, lateral 6.5x6x9, canine 7.5x8x10, premolars 7x9x8, first molar 10x11x7 (Wheeler's dental
        anatomy), lowers 5.4/6/7/7/11 wide. Her upper right central incisor is broken (mesial-incisal corner)."""
        y0, kk = self.arch_lo if lower else self.arch_up
        widths = [5.4, 6.0, 7.0, 7.0, 7.2, 11.0] if lower else [8.5, 6.5, 7.5, 7.0, 6.6, 10.0]
        heights = [9.0, 9.5, 11.0, 8.0, 8.0, 7.5] if lower else [10.5, 9.0, 10.0, 8.5, 8.0, 7.0]
        thick = [6.0, 6.2, 7.6, 8.0, 8.4, 10.5] if lower else [7.0, 6.2, 8.0, 9.0, 9.0, 11.0]
        zedge = -59.6 if lower else -61.6
        d = np.full(len(X), 1e9)
        for s in (1.0, -1.0):
            x = 0.0
            for i, (w, h, t) in enumerate(zip(widths, heights, thick)):
                xc = s * (x + w * 0.5 + 0.15)
                x += w + 0.3
                yc = y0 + kk * xc * xc
                tang = _n((1.0, 2.0 * kk * xc, 0.0))
                out = _n((-2.0 * kk * xc, 1.0, 0.0)) * -1.0       # labial normal (toward the lips, -y at the midline)
                up = V(0.0, 0.0, -1.0 if lower else 1.0)           # crown -> root
                R = np.stack([tang, -out, up])                      # rows: mesiodistal, lingual, rootward
                c = V(xc, yc, 0.0) - out * (t * 0.5) + up * (h * 0.5) + V(0, 0, zedge)
                if i >= 3:
                    c = c + up * (-0.6 if lower else 0.4)
                q = (X - c) @ R.T
                # crown: rounded box tapering to the cervix; incisors thin at the edge (lingual face slanted)
                taper = 1.0 - 0.18 * np.clip(q[:, 2] / (h * 0.5), -1, 1)
                qq = q.copy()
                qq[:, 0] = q[:, 0] / taper
                td = sdf.round_box(qq, V(0, 0, 0), (w * 0.5, t * 0.5, h * 0.5 + 6.0), 1.1 if i < 3 else 1.8)
                if i != 2:
                    td = np.maximum(td, -(q[:, 2] + h * 0.5))                       # flat-ish incisal edge
                if i < 2:
                    # lingual slope: thin incisal edge (1.2 mm) -> full thickness 5 mm up
                    lin = q[:, 1] - (-t * 0.5 + 1.2 + (t - 1.2) * np.clip((q[:, 2] + h * 0.5) / 5.0, 0, 1))
                    td = smax(td, lin, 0.6)
                elif i == 2:
                    # canine cusp: two slopes meeting at the cusp tip
                    td = smax(td, -(q[:, 2] + h * 0.5) + 0.35 * np.abs(q[:, 0]) - 1.2, 0.7)
                td = td + 0.08 * noise.fbm(q * 0.9 + i * 7.1, 2, 31)                 # cast-free, not CAD-perfect
                if (not lower) and i == 0 and s < 0:
                    td = smax(td, -sdf.round_box(q, V(-w * 0.45, 0.0, -h * 0.5), (3.0, 6.0, 2.6), 0.4), 0.3)
                d = np.minimum(d, td)
        return d


# ------------------------------------------------------------------------------------------------ surface helpers
def ray_hit(fn, o, dirs, tmax=400.0, eps=0.02, steps=160, step=0.85):
    """Sphere-trace mm rays (fn in mm): returns (t, hit)."""
    o = np.asarray(o, float)
    D = np.asarray(dirs, float)
    if o.ndim == 1:
        o = np.broadcast_to(o, D.shape)
    t = np.zeros(len(D))
    alive = np.ones(len(D), bool)
    hit = np.zeros(len(D), bool)
    for _ in range(steps):
        idx = np.nonzero(alive)[0]
        if len(idx) == 0:
            break
        dd = fn(o[idx] + D[idx] * t[idx, None])
        h = dd < eps
        hit[idx[h]] = True
        alive[idx[h]] = False
        t[idx[~h]] += np.maximum(dd[~h] * step, eps * 0.5)
        far = t > tmax
        alive &= ~far
    return t, hit


def surface_point(fn, o, d):
    t, h = ray_hit(fn, o, np.asarray(d, float)[None, :])
    return np.asarray(o, float) + _n(d) * t[0]
