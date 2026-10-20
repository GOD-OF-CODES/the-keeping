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
# #147j (AD round 3, rank 2a: "360 deg scleral show = a startled doll stare"): the ANTERIOR lid edge sits ~14.3 mm from
# the globe centre, so it projects ~1.3 mm above the margin elevation; at 17.5 / 18.5 the visible edge crossed the
# limbus only ~0.6 mm at 12 o'clock and sclera showed at 10-11 / 1-2 o'clock (scratchpad j/base_eyes.png). A dead,
# relaxed upper lid covers 1-2 mm of the cornea; her right (the beaten side) ~1 mm more closed.
EYE_UP = (12.5, 9.0)           # r11: the 1.0 mm margin fillet erodes ~0.6 mm, so 21.5 (r9-r10) still showed sclera
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
# #147f r23: moved to HER RIGHT half (x -> -x): the mirrored hero pose turns her left half away from the torch (split
# lip -5.6 EV in r22); the same kind of lane-internal side swap as #147d's grip hand
LACERATION = [V(-6.0, -31.8, -64.4), V(-6.3, -32.5, -66.6), V(-6.4, -31.2, -69.0)]   # #147j: on the drooped lower lip; axis ON the skin (0.6 mm under
# it left a 0.1 mm membrane in front of the cut = a hanging flap)


def lip_lines(u):
    """(upper vermilion border z, stomion z, lower border z) vs u (mm across); commissures at +-24.5. Cupid's bow peaks
    at |u| 5, the philtral dip at 0; her LEFT lower lip swollen (the split)."""
    a = np.clip(np.abs(u) / 24.5, 0.0, 1.0)
    drop = -1.4 * a * a                                            # slack, down-turned corners (r4 read as a grin)
    st = -59.6 - 0.35 * (1.0 - a * a) + drop
    # #147j (AD round 3, rank 1: "no Cupid's bow"): bow peaks +1.0 at |u| 5, the philtral dip -1.4 (a 2.4 mm bow; r1-r35
    # 1.6 mm read as one smooth arc)
    up = -59.4 + drop + 7.0 * np.power(1.0 - a * a, 0.6) + 1.0 * np.exp(-((np.abs(u) - 5.0) / 2.4) ** 2) - 1.4 * np.exp(-(u / 2.2) ** 2)
    lo = -59.6 + drop - 9.6 * np.power(1.0 - a * a, 0.7) - 1.6 * np.exp(-((u + 8.0) / 6.5) ** 2)   # r23: swollen RIGHT half
    return up, st, lo


# #147j (AD round 3, rank 1: "no lower teeth, no tongue, the lower lip merges into the chin"): the slack dead lower lip
# DROOPS and everts — its free edge sits LIP_SAG mm under the stomion at the midline, so ~3-4 mm of the lower incisors
# stand above it (and catch the under-torch over the lip), the wet inner mucosa rolls out on top and the vermilion
# border moves down a little (eversion shows more vermilion).
LIP_SAG = 3.6


def lip_sag(x):
    """mm the lower lip's free edge sits under the stomion, vs x (mm across): 3.6 at the midline -> 0 at the corners."""
    return LIP_SAG * np.power(np.clip(1.0 - (np.asarray(x, float) / 23.0) ** 2, 0.0, 1.0), 1.3)


def lower_lines(u):
    """(free edge z, vermilion border z) of the drooped, everted lower lip vs u."""
    up, st, lo = lip_lines(u)
    sg = lip_sag(u)
    return st - sg, lo - 0.45 * sg


# #147h r33: the dead upper lip RETRACTS (drying, tissue shrinkage) and bares the upper incisors — her broken right
# central incisor included. r1-r32 showed a 1.6 mm sliver of enamel under a full rubbery roll over a red hole: the
# "puppet mouth". The slit is widened UPWARD only (the jaw warp's split stays at the old stomion) and the upper
# vermilion's relief rolls back at the retracted edge.
LIP_RETRACT = 2.6
# #147j: the tongue (rest space, rides the jaw): swollen and HIGH (asphyxia), its dorsum ~1 mm over the lower incisal
# edges behind them, so the beam over the drooped lower lip reaches it (r1-r35: (0, 5, -67) r (18.5, 25, 7))
TONGUE_C = (0.0, 6.0, -64.3)
TONGUE_R = (19.0, 25.0, 7.4)


def lip_retract(x):
    """mm the upper lip's lower edge sits above the stomion, vs x (mm across): 2.6 at the midline -> 0 at the corners.
    #147j: decays to the commissure (|x| 24; r33-r35 by |x| 19): the unretracted lateral upper lip hung down beside the
    opening as a pale pointed lobe = the AD's "fang at the commissure"."""
    return LIP_RETRACT * np.power(np.clip(1.0 - (np.asarray(x, float) / 24.0) ** 2, 0.0, 1.0), 1.1)


def lip_relief(u, v):
    """Vermilion relief (mm outward): the upper lip rises at a sharp border (white roll), rolls back toward the slit;
    the lower lip is fuller with a soft lower edge; her LEFT lower half swollen +2.2 mm (split lip)."""
    up, st, lo = lip_lines(u)
    a = np.clip(np.abs(u) / 24.5, 0.0, 1.0)
    side = np.power(np.clip(1.0 - a * a, 0.0, 1.0), 0.45)
    edge = st + lip_retract(u)
    tu = (up - v) / np.maximum(up - edge, 0.3)                     # 0 at the border, 1 at the (retracted) lip edge
    # upper-lip skin ramps forward from subnasale (0) to 0.5 at the border; the vermilion carries on to 1 and rolls back
    gu = (0.5 * ss(-1.25, 0.0, tu) + 0.5 * ss(-0.02, 0.35, tu)) * (1.0 - 0.4 * ss(0.5, 1.0, tu)) * (tu <= 1.15)
    # #147j (AD round 3: "a smooth thick tube"): a thinner lateral vermilion and a distinct central TUBERCLE bulging at the
    # free edge (r22-r35: one even 1.5 mm roll); the WHITE ROLL a 0.7 mm ridge just above the border, catching the
    # under-torch as a thin highlight line (r35 0.35 mm, invisible)
    Au = 1.15 * side + 0.35 * np.exp(-(u / 4.0) ** 2)
    tub = 1.0 * np.exp(-(u / 4.2) ** 2) * ss(0.35, 0.85, tu) * (1.0 - ss(1.0, 1.15, tu))
    roll = 0.70 * np.exp(-((v - (up + 0.45)) / 0.42) ** 2) * side
    st_l, lo_l = lower_lines(u)
    tl = (st_l - v) / np.maximum(st_l - lo_l, 0.3)                 # 0 at the (drooped) free edge, 1 at the lower border
    # #147j: everted — the forward peak rides HIGH (the wet inner face rolls out on top), then a sharper fall at the
    # vermilion border into the mentolabial sulcus (r35's soft 0.5-1.2 fall merged the lip into the chin)
    gl = ss(-0.30, 0.30, tl) * (1.0 - ss(0.62, 1.08, tl)) * (tl >= -0.15)
    Al = 4.4 * side + 2.2 * np.exp(-((u + 8.0) / 6.5) ** 2)                # r23: her right half swollen; #147h 4.8 -> 3.9 (an inflated pillow); #147j 4.4 everted
    # a faint lower-lip border ridge (the lower lip's own white roll), a step at the colour border
    lroll = 0.30 * np.exp(-((v - (lo_l - 0.35)) / 0.45) ** 2) * side
    return np.where(v > st, Au * gu + tub + roll, Al * gl + lroll)


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
        # philtral column — #147j (AD round 3: "no philtrum"): +1.2 mm (r35 0.35), 7-10 mm apart, ending on the bow peaks
        R += k * _ridge(su, v, [(3.5, -42.6), (4.3, -47.0), (5.0, -51.6)], 2.5, 1.2, taper=(0.55, 1.0))
    # ---- midline
    R += _bump(u, v, 0.0, 15.5, 12.0, 9.0, 1.4)                                                 # glabella
    R += _ridge(u, v, [(0.0, -37.0), (0.0, -41.5)], 3.4, 2.0, taper=(0.5, 1.0))                 # columella
    R += _bump(u, v, 0.0, -58.0, 27.0, 16.0, 1.8)                                               # muzzle (orbicularis; r22 2.4 -> 1.8)
    R += _bump(u, v, 0.0, -47.0, 9.0, 3.5, -0.5)                                                # upper-lip skin concavity
    R += _ridge(u, v, [(0.0, -43.2), (0.0, -51.8)], 3.0, -0.9, taper=(0.6, 1.0))               # #147j philtral dimple (groove)
    R += _ridge(u, v, [(-11.0, -79.5), (0.0, -80.5), (11.0, -79.5)], 5.5, -1.6)                 # mentolabial sulcus
    R += _bump(u, v, 0.0, -95.0, 16.0, 11.0, 3.4)                                               # chin pad
    nh = _tab(v, NOSE_H)
    nw = _tab(v, NOSE_W)
    t = np.abs(u) / nw
    R += nh * np.power(np.clip(1.0 - t * t, 0.0, 1.0), _tab(v, NOSE_P))
    R += lip_relief(u, v)
    # ---- #147h (AD round 2 (b): "the macro forms are sculpt-smooth and inflated"): the soft tissue of a beaten,
    #      waterlogged face — a swollen bag under the black eye (HER RIGHT, u < 0) and the cheek oedema round it; the
    #      BROKEN nose (a dorsal fracture callus, the tip pushed ~1 mm toward her left); jowls sagging lateral to the
    #      marionette lines (a dead face sags)
    R += _bump(u, v, -31.0, -15.5, 12.5, 5.5, 1.8)
    R += _bump(u, v, -36.0, -22.0, 13.0, 9.0, 1.0, rot=-20.0)
    R += _bump(u, v, 0.6, -15.0, 5.0, 4.0, 0.8)
    R += _bump(u, v, 3.4, -31.5, 4.5, 5.0, 0.9) - _bump(u, v, -3.6, -31.5, 4.0, 5.0, 0.7)
    R += asym * _bump(u, v, 33.0, -82.0, 9.0, 8.0, 1.2) + _bump(-u, v, 33.0, -82.0, 9.0, 8.0, 1.3)
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
        self.cut_n = _n(V(0.0, self.CUT_TILT, 1.0))           # #147g: rising toward the face (was -0.36, toward the nape)
        self.cut_n2 = _n(V(0.0, self.CUT_TILT + 0.11, 1.0))   # the second stroke, 6 deg steeper
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

    def plica_pts(self, k):
        """#147j: the plica semilunaris of eye k — a crescent (concave laterally) on the globe at ~64 deg medial,
        elevation -8 .. +8 deg, 0.2 mm proud of the tear film."""
        s = 1.0 if k == 0 else -1.0
        out = []
        for el in np.linspace(-8.5, 8.5, 7):
            az = -63.5 - 2.2 * (1.0 - (el / 8.5) ** 2)                 # bows medially at the middle
            a, e = math.radians(az), math.radians(el - 0.6)
            out.append(self.E[k] + V(s * math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)) * (R_LID_IN - 0.05))
        return out

    def plica(self, X, k):
        pts = self.plica_pts(k)
        return chain(X, pts, [0.25, 0.42, 0.5, 0.52, 0.5, 0.42, 0.25])

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
        # #147h: fbm's std is ~0.2, so the line above is only +-0.11 mm. Real soft tissue undulates +-0.3-0.5 mm at
        # 15-25 mm and ~0.2 mm at 6-10 mm (fat pads, oedema, sag): stronger on the lower face, cheeks, chin and nose
        # (the AD's wax-knob tip, latex lip roll, smooth chin dome), none on the lids
        lowf = (ss(-12.0, -24.0, ZZ.ravel()) + 0.6 * ss(30.0, 50.0, np.abs(U.ravel()))) * ss(130.0, 95.0, np.abs(U.ravel()))
        R += (np.clip(lowf, 0.0, 1.0) * (1.3 * noise.fbm(P2 * 1.15 + 3.1, 3, self.seed + 8)
                                         + 0.9 * noise.fbm(P2 * 2.9 + 7.7, 2, self.seed + 9))).reshape(R0.shape)
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
        st_l, lo_l = lower_lines(x)                     # #147j: the drooped, everted lower lip
        side = np.abs(x) - 24.6
        front = np.where(X[:, 1] < -18.0, 0.0, 50.0)
        du = np.maximum(np.maximum(z - up, st - z), side) + front
        dl = np.maximum(np.maximum(z - st, lo_l - z), side) + front
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
            # #147j (AD round 3, rank 2c: "smooth pink pearls sitting outside the eye"): a flatter 3.5 x 3 mm LUMPY mound
            # set back into the lake (lobules 0.5-1 mm), + the plica semilunaris: a thin vertical crescent fold of
            # conjunctiva lying on the globe just lateral to it
            dm = smin(dm, ell(Xm, E + V(-s * 14.6, -3.3, -1.0), (1.9, 1.3, 1.6)) + 0.32 * noise.fbm(Xm / 0.55, 2, self.seed + 9)
                      + 0.12 * noise.fbm(Xm / 0.25, 1, self.seed + 19), 0.5)
            dm = smin(dm, self.plica(Xm, k), 0.35)
            d[m] = dm
        m = (np.abs(x) < 40) & (y > -55) & (y < 45) & (z > -90) & (z < -36)
        if m.any():
            Xm = X[m]
            dm = d[m]
            dm = smax(dm, -chain(Xm, LACERATION, [0.8, 0.95, 0.7]), 0.3)                      # lip laceration
            up, st, lo = lip_lines(Xm[:, 0])
            cx = np.clip(1.0 - (Xm[:, 0] / 25.0) ** 2, 0.0, 1.0) ** 1.2          # #147d: almond, pinched corners
            ret = lip_retract(Xm[:, 0])                                          # #147h r33: widened upward only
            sg = lip_sag(Xm[:, 0])                                               # #147j: and DOWNWARD (the drooped lower lip)
            slot = np.maximum(np.abs(Xm[:, 2] - (st + 0.5 * ret - 0.5 * sg)) - (0.25 + 1.1 * cx + 0.5 * ret + 0.5 * sg),
                              np.maximum(np.abs(Xm[:, 1] + 31.0) - 11.0, np.abs(Xm[:, 0]) - 24.8))
            # oral cavity between the gum lines (z -67.5 .. -50.5)
            cav = self.cavity(Xm)
            dm = smax(dm, -smin(slot, cav, 2.0), 0.8)
            dm = smin(dm, ell(Xm, V(*TONGUE_C), TONGUE_R) + 0.35 * noise.fbm(Xm / 3.0, 2, self.seed + 60), 2.5)   # tongue (swollen, high; #147j lumpy)
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
        m = z < -95.0
        if m.any():
            # #147d/#147g: cut skin retracts 5-10 mm above the cleaver surface over an exposed band of subcutaneous fat
            # 1.2-2 mm inside the skin surface (lobulated); the cut face carries the section anatomy in relief (section())
            Xm = X[m]
            cutp = self.cut_plane(Xm)
            near = cutp > -25.0
            band = self.tissue_band(Xm, cutp)
            bul = ss(-0.15, 0.55, noise.fbm(Xm * np.array([1.0 / 2.2, 1.0 / 2.2, 1.0 / 4.0]), 3, self.seed + 40))
            dm = d[m] + band * (1.9 - self.BAND_LUMP * bul)
            cutd = cutp.copy()
            if near.any():
                cutd[near] = self.cut_dist(Xm[near])
            dm = smax(dm, cutd, 0.5)
            if near.any():
                dm[near] = smax(dm[near], -self.holes(Xm[near]), 0.35)
            d[m] = smin(dm, self.neck_extras(Xm), 0.9)
        return d

    # ---------------------------------------------------------------- the cut neck (#147d; rebuilt #147g)
    # #147g (AD round 2, rank 1): a CLEAVER CHOP, not a tear. Two hog-cleaver strokes (DESIGN: he struck twice, she lay on
    # the sawbuck table): the main plane + a second stroke 3.2 mm higher over the front ~45 % of the section, 6 deg
    # steeper, meeting at a ledge; two V-shaped chop notches where the blade bit in and was wrenched out; a near-planar
    # face (1 mm hack, 0.25 mm blade chatter) carrying the SECTION ANATOMY of the neck at C4 in relief (soft tissue
    # retracts 1-3 mm, cut muscles bulge, bone and cartilage stand proud): yellow subcutaneous fat ring, SCM / strap /
    # scalene / longus / posterior muscle faces, the trachea C-ring (pale cartilage, flat posterior membrane, DARK OPEN
    # LUMEN 14 mm deep), the collapsed oesophagus slit behind it, carotid stubs (empty, clot-plugged) and collapsed
    # jugulars, the C4 vertebral body (cortical rim + cancellous face), lateral masses, laminae, the spinal cord in its
    # canal. The skin edge retracts 5-10 mm above the cut over an exposed band of fat. Three IRREGULAR fibrin-clot
    # strings (9 / 21 / 34 mm, beaded) replace r20-r24's even fringe of five drips + four tags (read as candle wax).
    # The plane rises toward the FACE (tilt +0.25, the stump faces down-forward; r1-r24: rising toward the nape, the
    # stump faced down-BACK and was invisible from any camera in front of the face — scratchpad g/cutstudy.py).
    CUT_TILT = 0.25
    BAND_LUMP = 0.5                          # mm of lobule bulge on the exposed fat band (r29: 1.0 = a pie-crust rim)
    LEDGE = 3.2                              # mm: the second stroke over the front of the section
    NOTCHES = (((-27.0, 47.0), (16.0, 41.0), 2.8, 1.5), ((4.0, 78.0), (30.0, 70.0), 2.2, 1.2))   # (a, b) xy, depth, half-width

    def cut_plane(self, X):
        """Signed distance-ish to the two-stroke cleaver surface WITHOUT the tissue relief (> 0 = cut away)."""
        x, y = X[:, 0], X[:, 1]
        d1 = -((X - self.cut_c) @ self.cut_n)
        d2 = -((X - (self.cut_c + V(0.0, 0.0, self.LEDGE))) @ self.cut_n2)
        ystep = 47.0 + 5.0 * np.sin(x / 17.0 + 0.6) + 1.5 * noise.fbm(X / 6.0, 2, self.seed + 3)
        w = ss(ystep - 0.7, ystep + 0.7, y)                                   # 0 front (stroke 2), 1 back (stroke 1)
        d = d2 * (1.0 - w) + d1 * w
        return d + 1.0 * noise.fbm(X / 11.0, 3, self.seed + 2) + 0.25 * noise.fbm(X / 1.4, 2, self.seed + 4)

    def cut_dist(self, X, sec=None):
        """The cut face (> 0 = cut away): cut_plane + the section relief (recessed > 0) + chop notches."""
        if sec is None:
            sec = self.section(X)
        d = self.cut_plane(X) + sec['rel']
        x, y = X[:, 0], X[:, 1]
        for (a, b, dep, hw) in self.NOTCHES:
            a, b = np.asarray(a, float), np.asarray(b, float)
            ab = b - a
            t = np.clip(((x - a[0]) * ab[0] + (y - a[1]) * ab[1]) / (ab @ ab), 0.0, 1.0)
            dd = np.hypot(x - (a[0] + t * ab[0]), y - (a[1] + t * ab[1]))
            taper = np.sin(np.pi * t) ** 0.5
            d = d + dep * taper * np.clip(1.0 - dd / hw, 0.0, 1.0)          # V-groove: more removed = recessed
        return d

    @staticmethod
    def _ell2(x, y, c, ab, rot=0.0, soft=0.12):
        """Soft 2-D elliptical mask (1 inside) and its normalised radius."""
        dx, dy = x - c[0], y - c[1]
        if rot:
            cr, sr = math.cos(math.radians(rot)), math.sin(math.radians(rot))
            dx, dy = dx * cr + dy * sr, -dx * sr + dy * cr
        rho = np.sqrt((dx / ab[0]) ** 2 + (dy / ab[1]) ** 2)
        return 1.0 - ss(1.0 - soft, 1.0 + soft, rho), rho

    def section(self, X):
        """Neck cross-section at the cut (C4, adult woman; head space x, y mm; Gray's / Netter proportions scaled to this
        neck: front skin at y 12, back at 104, +-50 mm wide). Returns masks (0..1) and `rel` (mm the cut face of each
        tissue sits RECESSED from the cleaver surface; < 0 = proud)."""
        x, y = X[:, 0], X[:, 1]
        ax = np.abs(x)
        n = len(X)
        dep = np.maximum(-self.base(X), 0.0)                                  # mm under the base skin
        fat_t = 2.0 + 3.0 * ss(30.0, 90.0, y)                                 # subcutaneous fat 2 mm front -> 5 mm nape
        nz = noise.fbm(X / 2.2, 2, self.seed + 60)
        nzb = noise.fbm(X / 4.5, 2, self.seed + 61)
        M = {}
        rel = 0.9 + 0.45 * nz                                                 # fat: lobulated, ~1 mm recessed
        kind_order = []

        def put(name, m, r):
            nonlocal rel
            M[name] = np.maximum(M.get(name, np.zeros(n)), m)
            rel = rel * (1.0 - m) + r * m
            kind_order.append(name)
        inner = ss(fat_t - 0.6, fat_t + 0.6, dep)
        # everything under the fat ring is muscle / connective tissue with thin fat septa (the numpy preview with fat as
        # the default fill read as a 'pizza': a flat yellow disc with red spots)
        septa = 1.0 - ss(0.0, 0.06, np.abs(nzb))
        put('muscle', inner * (1.0 - 0.8 * septa), 2.0 + 0.8 * nz)
        for s in (1.0, -1.0):
            m, rho = self._ell2(x, y, (s * 33.5, 28.0), (12.5, 6.2), rot=s * 32.0)                     # sternocleidomastoid
            put('muscle', m * inner, 2.7 - 1.5 * np.clip(1.0 - rho * rho, 0, 1) + 0.4 * nz)
            m, rho = self._ell2(x, y, (s * 8.0, 17.3), (7.5, 2.3), rot=s * -8.0)                       # strap muscles
            put('muscle', m, 1.7 - 0.8 * np.clip(1.0 - rho * rho, 0, 1))
            m, rho = self._ell2(x, y, (s * 31.0, 54.0), (7.5, 9.5), rot=s * 20.0)                      # scalenes / levator
            put('muscle', m * inner, 2.4 - 1.0 * np.clip(1.0 - rho * rho, 0, 1) + 0.5 * nz)
            m, rho = self._ell2(x, y, (s * 7.5, 47.5), (5.5, 2.8))                                    # longus colli
            put('muscle', m, 1.9 - 0.7 * np.clip(1.0 - rho * rho, 0, 1))
            m, _ = self._ell2(x, y, (s * 12.5, 31.0), (4.6, 6.5), rot=s * 15.0)                        # thyroid lobe
            put('thyroid', m, 1.3 + 0.3 * nz)
            m, _ = self._ell2(x, y, (s * 28.5, 35.5), (5.0, 2.4), rot=s * 25.0)                        # internal jugular (collapsed, clotted)
            put('vein', m, 0.4 + 0.3 * nz)
            m, rho = self._ell2(x, y, (s * 21.0, 37.0), (3.7, 3.7), soft=0.08)                         # common carotid stub
            put('artery', m, 0.4 + 0.3 * nz)                       # r27: proud stubs read as white PVC pipes; arteries retract
            m, _ = self._ell2(x, y, (s * 17.5, 62.0), (6.0, 5.0))                                     # lateral mass (bone)
            put('bone', m, -0.7)
        m, rho = self._ell2(x, y, (-2.5, 38.8), (9.5, 3.5), rot=-6.0)                                  # oesophagus (collapsed)
        put('oeso', m, 0.9)
        # trachea: a C of hyaline cartilage open at the back, the flat trachealis membrane closing it
        mt, rt = self._ell2(x, y, (0.0, 25.5), (8.6, 7.6), soft=0.06)
        back = ss(31.0, 32.0, y)
        put('membrane', mt * back, 0.5)
        put('cartilage', mt * (1.0 - back) * ss(0.70, 0.80, rt), -0.6)   # r27: -1.6 proud = a pipe
        # C4 vertebral body (cortical rim proud, cancellous face), the canal, the cord, the laminae + spinous process
        mv, rv = self._ell2(x, y, (0.0, 58.0), (10.5, 8.0), soft=0.06)
        put('bone', mv, -1.0 + 0.25 * ss(0.85, 0.6, rv))
        M['cancel'] = mv * ss(0.86, 0.80, rv)
        mc, rc = self._ell2(x, y, (0.0, 73.0), (10.5, 6.5), soft=0.08)
        put('canal', mc, 2.2)
        mcord, rcord = self._ell2(x, y, (0.0, 72.6), (6.4, 4.1), soft=0.10)
        put('cord', mcord, 0.7)
        M['dura'] = mc * ss(0.75, 0.92, rc) * (1.0 - mcord)
        # grey-matter butterfly (H): two crescents of the cord
        gx = np.abs(x) - 2.6
        M['grey'] = mcord * (1.0 - ss(0.8, 1.3, np.sqrt((gx / 1.6) ** 2 + ((y - 72.6) / 3.0) ** 2))) + mcord * (1.0 - ss(0.5, 0.9, np.hypot(x / 2.6, (y - 72.4) / 0.7)))
        lam = np.zeros(n)
        for s in (1.0, -1.0):
            a2, b2 = V(s * 11.0, 77.5, 0.0)[:2], V(s * 1.0, 87.5, 0.0)[:2]
            ab = b2 - a2
            t = np.clip(((x - a2[0]) * ab[0] + (y - a2[1]) * ab[1]) / (ab @ ab), 0, 1)
            lam = np.maximum(lam, 1.0 - ss(1.2, 1.8, np.hypot(x - a2[0] - t * ab[0], y - a2[1] - t * ab[1])))
        lam = np.maximum(lam, 1.0 - ss(1.0, 1.6, np.hypot(np.abs(x) - 1.6, np.clip(y - 87.5, 0, None) * 0.0 + np.maximum(np.abs(y - 90.5) - 3.0, 0))))
        put('bone', lam, -0.6)
        M['fat'] = np.clip(1.0 - sum(M.get(k, 0.0) for k in ('muscle', 'thyroid', 'vein', 'artery', 'bone', 'oeso', 'membrane',
                                                             'cartilage', 'canal')), 0.0, 1.0)
        M['dep'] = dep
        M['rel'] = rel
        return M

    def holes(self, X):
        """SDF of the open lumens cut into the face (trachea 14 mm deep, oesophagus slit 5 mm, carotids 2.5 mm), > 0
        outside; measured along the stump normal from the cleaver surface."""
        x, y = X[:, 0], X[:, 1]
        up = -self.cut_plane(X)                                                # mm above (inside) the cut surface
        out = np.full(len(X), 1e3)
        lum = np.hypot(x / 6.6, (y - 25.0) / 5.4)
        out = np.minimum(out, np.maximum((lum - 1.0) * 5.4, up - 14.0))
        oe = np.hypot((x + 2.5) / 7.0, (y - 38.8) / 0.9)
        out = np.minimum(out, np.maximum((oe - 1.0) * 0.9, up - 5.0))
        for s in (1.0, -1.0):
            ca = np.hypot(x - s * 21.0, y - 37.0) - 2.4
            out = np.minimum(out, np.maximum(ca, up - (2.5 if s > 0 else 1.6)))  # clot plug 1.6-2.5 mm down
        return out

    def skin_line(self, X):
        """Height (mm above the cut) of the retracted skin edge: 5-10 mm (AD round 2), ragged (tears + 1 mm saw teeth)."""
        # r27: the even 7.5 +- 2 mm band read as a cake layer: uneven retraction (3.5-11 mm, jagged)
        return (7.0 + 3.6 * noise.fbm(X / 9.0, 2, self.seed + 41) + 1.2 * noise.fbm(X / 2.4, 2, self.seed + 42)
                + 0.5 * np.abs(noise.perlin(X / 0.9, self.seed + 43)))

    def tissue_band(self, X, cutp=None):
        """1 on the exposed tissue between the retracted skin edge and the cut, 0 on skin (0.5 mm transition)."""
        if cutp is None:
            cutp = self.cut_plane(X)
        return ss(-self.skin_line(X) - 0.25, -self.skin_line(X) + 0.25, cutp)

    def cut_z(self, x, y):
        """z (mm) of the cleaver surface (no relief) at (x, y), by bisection."""
        lo, hi = -190.0, -60.0
        for _ in range(40):
            mid = 0.5 * (lo + hi)
            if self.cut_plane(V(x, y, mid)[None, :])[0] > 0:
                lo = mid
            else:
                hi = mid
        return 0.5 * (lo + hi)

    # fibrin-clot strings: (anchor x, y on the cut face, length mm, sway mm, seed) — irregular lengths and beading
    STRINGS = ((-5.5, 19.0, 34.0, 2.2, 1), (13.0, 33.5, 21.0, 1.4, 2), (-24.0, 27.0, 9.0, 0.8, 3))
    STRING_DOWN = (0.0, -0.30, -1.0)        # head space; the chin-up hold leans 'down' toward the face

    def string_pts(self, i):
        x0, y0, ln, sw, sd = self.STRINGS[i]
        a = V(x0, y0, self.cut_z(x0, y0) + 0.8)
        dn = _n(self.STRING_DOWN)
        side = _n(np.cross(dn, V(0.0, 1.0, 0.0)))
        k = 7
        pts, rads = [], []
        rng = np.random.default_rng(470 + sd)
        for j in range(k):
            t = j / (k - 1)
            pts.append(a + dn * (ln * t) + side * (sw * math.sin(2.6 * t * math.pi + sd)) + V(0.0, 0.4 * sd * t, 0.0))
            rads.append((1.25 - 0.55 * t) * (0.75 + 0.5 * rng.random()))     # beaded, thinning
        return pts, rads, ln

    def neck_extras(self, X):
        """Three fibrin-clot strings ending in drops (unioned under the cut)."""
        d = np.full(len(X), 1e3)
        for i in range(len(self.STRINGS)):
            pts, rads, ln = self.string_pts(i)
            th = chain(X, pts, rads)
            drop = sdf.ellipsoid(X, pts[-1] + V(0.0, 0.0, -0.5), (1.0 + 0.03 * ln, 1.0 + 0.03 * ln, 1.3 + 0.04 * ln))
            d = smin(d, smin(th, drop, 0.6), 0.5)
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
                # #147j (AD round 3: "the teeth are a flat even strip"): a real adult arch is not CAD — per tooth a
                # little crowding / rotation (+-4 deg about the long axis), labial-lingual offset and uneven incisal wear
                jr = np.random.default_rng(int(1000 * (2 if lower else 1) + 10 * (s + 1) + i))
                rot = math.radians(jr.uniform(-4.0, 4.0))
                tang, out = (tang * math.cos(rot) + out * math.sin(rot)), (out * math.cos(rot) - tang * math.sin(rot))
                R = np.stack([tang, -out, up])                      # rows: mesiodistal, lingual, rootward
                c = V(xc, yc, 0.0) - out * (t * 0.5) + up * (h * 0.5) + V(0, 0, zedge)
                c = c + out * jr.uniform(-0.35, 0.35) + up * jr.uniform(-0.15, 0.45)
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
                    # canine cusp: two slopes meeting at the cusp tip. #147j: a 45-year-old's canines are WORN — the tip
                    # 0.3 mm above the incisal plane, flatter slopes (r1-r35: 1.2 mm proud, 0.35 slope = the AD's fang)
                    td = smax(td, -(q[:, 2] + h * 0.5) + 0.22 * np.abs(q[:, 0]) + 0.3, 0.6)
                td = td + 0.08 * noise.fbm(q * 0.9 + i * 7.1, 2, 31)                 # cast-free, not CAD-perfect
                if (not lower) and i == 0 and s < 0:
                    td = smax(td, self.fracture_cut(q, w, h), 0.12)
                d = np.minimum(d, td)
        return d

    @staticmethod
    def fracture_cut(q, w, h):
        """#147j (AD round 3: "the broken incisor is a clean black rectangular notch = a missing tooth"): her upper right
        central incisor fractured OBLIQUELY — an enamel-dentin fracture running ~37 deg from 4.4 mm up the distal edge to
        the incisal edge 2/3 across, conchoidal (a lingual bevel) and jagged (0.3 mm). > 0 = broken away. q is the
        tooth frame (mesiodistal, lingual, rootward); e = height above the incisal edge."""
        e = q[:, 2] + h * 0.5
        f = 4.4 - 0.75 * (q[:, 0] + w * 0.5) + 0.9 * np.clip(q[:, 1] / 3.0, -1.0, 1.0)     # higher on the lingual side
        jag = 0.30 * noise.fbm(q * np.array([1.6, 1.6, 2.4]) + 3.3, 2, 47) + 0.10 * noise.fbm(q * 5.0, 1, 48)
        return f + jag - e

    def fracture_masks(self, X):
        """(dentin, pulp) 0..1 on the fracture face of her broken incisor, for upper-teeth points X (rest mm): points
        near the cut surface and deep enough inside the original crown (enamel ~0.8 mm thick at the incisal third)."""
        y0, kk = self.arch_up
        w, h, t = 8.5, 10.5, 7.0
        s, i = -1.0, 0
        xc = s * (w * 0.5 + 0.15)
        yc = y0 + kk * xc * xc
        tang = _n((1.0, 2.0 * kk * xc, 0.0))
        out = _n((-2.0 * kk * xc, 1.0, 0.0)) * -1.0
        up = V(0.0, 0.0, 1.0)
        jr = np.random.default_rng(int(1000 + 10 * (s + 1) + i))
        rot = math.radians(jr.uniform(-4.0, 4.0))
        tang, out = (tang * math.cos(rot) + out * math.sin(rot)), (out * math.cos(rot) - tang * math.sin(rot))
        R = np.stack([tang, -out, up])
        c = V(xc, yc, 0.0) - out * (t * 0.5) + up * (h * 0.5) + V(0, 0, -61.6)
        c = c + out * jr.uniform(-0.35, 0.35) + up * jr.uniform(-0.15, 0.45)
        q = (X - c) @ R.T
        cut = self.fracture_cut(q, w, h)
        taper = 1.0 - 0.18 * np.clip(q[:, 2] / (h * 0.5), -1, 1)
        qq = q.copy()
        qq[:, 0] = q[:, 0] / taper
        crown = sdf.round_box(qq, V(0, 0, 0), (w * 0.5, t * 0.5, h * 0.5 + 6.0), 1.1)
        lin = q[:, 1] - (-t * 0.5 + 1.2 + (t - 1.2) * np.clip((q[:, 2] + h * 0.5) / 5.0, 0, 1))
        crown = smax(crown, lin, 0.6)
        onface = 1.0 - ss(0.15, 0.45, np.abs(cut))
        dentin = onface * ss(0.55, 0.95, -crown)
        pulp = onface * (1.0 - ss(0.35, 0.7, np.hypot(q[:, 0] + 2.2, q[:, 1] + 1.0)))
        return np.clip(dentin, 0, 1), np.clip(pulp * ss(0.2, 0.6, -crown), 0, 1)


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
