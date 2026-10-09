"""C4-C5 cross-section of an adult female neck (docs/C2-ESCAPE.md §3.2) as procedural fields on the cut plane.

Coordinates: u = across the neck toward HER LEFT (m), v = toward her FRONT (m), origin = the rim centroid. The neck
section is ~10.5 x 11 cm. `fields(u, v)` -> (height m, albedo linear rgb, roughness, blood film 0..1) vectorised; the
same height drives the cap geometry (A1, 3-8 mm relief) and the baked normal map (A2).

Anti-diagram rules (R2): every boundary is perturbed by +-1.5 mm noise with ragged fibre ends, the colour regions
bleed into each other under the blood film, and the film is thicker in the lower (front) half — she lies face-down,
so the front of the neck is the low side (gravity).
"""
import numpy as np

from lib import noise

A_U, B_V = 0.0525, 0.055           # section half-axes (10.5 x 11 cm)

# (name, centre u, centre v, half-axes ru, rv, height m, albedo, roughness)
STRUCT = [
    ('scm_l', 0.031, 0.020, 0.0125, 0.006, -0.003, (0.12, 0.04, 0.04), 0.25),
    ('scm_r', -0.031, 0.020, 0.0125, 0.006, -0.003, (0.12, 0.04, 0.04), 0.25),
    ('oesoph', 0.0, 0.0125, 0.010, 0.004, -0.001, (0.30, 0.16, 0.15), 0.30),
    ('vert', 0.0, -0.008, 0.0085, 0.0075, 0.003, (0.62, 0.58, 0.50), 0.35),
    ('canal', 0.0, -0.0225, 0.0068, 0.0058, -0.002, (0.04, 0.03, 0.03), 0.40),
    ('cord', 0.0, -0.0225, 0.0050, 0.0040, 0.0, (0.55, 0.52, 0.50), 0.30),
]
VESSELS = [   # (u, v, outer radius, wall, recess m) carotids: jet sources, white wall; jugulars: collapsed slits
    ('car_l', 0.019, 0.017, 0.00325, 0.001, -0.006),
    ('car_r', -0.019, 0.017, 0.00325, 0.001, -0.006),
]
JUGULARS = [(0.030, 0.010), (-0.030, 0.010)]
TRACHEA = (0.0, 0.031, 0.009, 0.002)    # centre u, v, outer radius (18 mm OD), C-ring wall


def _ss(e0, e1, x):
    return noise.smoothstep(e0, e1, x)


def fields(u, v, seed=211):
    u = np.atleast_1d(np.asarray(u, float))
    v = np.atleast_1d(np.asarray(v, float))
    P3 = np.stack([u, v, np.zeros_like(u)], 1)
    # boundary noise (+-1.5 mm) and fibre direction noise
    jit_u = 0.0015 * noise.fbm(P3 * 180.0, 3, seed)
    jit_v = 0.0015 * noise.fbm(P3 * 180.0 + 7.3, 3, seed + 1)
    uu, vv = u + jit_u, v + jit_v
    rho = np.sqrt((uu / A_U) ** 2 + (vv / B_V) ** 2)
    # base: muscle mass, retracted 2-6 mm, fibres (ragged, anisotropic) and water-desaturated
    fib = noise.fbm(np.stack([u * 900.0, v * 140.0, np.zeros_like(u)], 1), 3, seed + 2)
    h = -0.002 - 0.004 * _ss(0.2, 0.9, 0.5 + 0.5 * noise.fbm(P3 * 60.0, 2, seed + 3)) + 0.0006 * fib
    alb = np.tile(np.array([0.16, 0.055, 0.05]), (len(u), 1)) * (1.0 + 0.25 * fib)[:, None]
    rough = np.full(len(u), 0.3)
    # posterior muscle: rougher, the 2 mm step where the two strokes met
    post = _ss(-0.012, -0.020, vv)
    rough = rough + 0.15 * post
    step = _ss(-0.0345, -0.0355, vv + 0.002 * noise.fbm(P3 * 90, 2, seed + 4))
    h = h - 0.002 * step
    # fat ring (2-5 mm inside the skin) and the skin edge (1.5-2 mm)
    fat = _ss(0.90, 0.94, rho) * (1 - _ss(0.97, 0.985, rho))
    skin = _ss(0.97, 0.985, rho)
    alb = alb * (1 - fat[:, None]) + np.array([0.55, 0.50, 0.38]) * fat[:, None]
    h = h * (1 - fat) + (-0.001) * fat
    rough = rough * (1 - fat) + 0.35 * fat
    alb = alb * (1 - skin[:, None]) + np.array([0.45, 0.38, 0.36]) * skin[:, None]
    h = h * (1 - skin)
    rough = rough * (1 - skin) + 0.3 * skin
    for _, cu, cv, ru, rv, hh, col, ro in STRUCT:
        d = np.sqrt(((uu - cu) / ru) ** 2 + ((vv - cv) / rv) ** 2)
        w = 1 - _ss(0.85, 1.05, d)
        alb = alb * (1 - w[:, None]) + np.array(col) * w[:, None]
        h = h * (1 - w) + hh * w
        rough = rough * (1 - w) + ro * w
    # vertebral marrow speckle
    dvert = np.sqrt(((uu) / 0.0085) ** 2 + ((vv + 0.008) / 0.0075) ** 2)
    marrow = (dvert < 0.8) * _ss(0.2, 0.6, noise.fbm(P3 * 900.0, 2, seed + 5))
    alb = alb * (1 - 0.7 * marrow[:, None]) + np.array([0.35, 0.18, 0.15]) * (0.7 * marrow)[:, None]
    # trachea: C-ring cartilage 2 mm proud, lumen dark (open at the back: the C)
    tu, tv, tr, tw = TRACHEA
    dt = np.sqrt((uu - tu) ** 2 + (vv - tv) ** 2)
    ring = _ss(tr - tw - 0.0004, tr - tw, dt) * (1 - _ss(tr, tr + 0.0004, dt)) * (1 - _ss(-0.5, -0.8, (vv - tv) / tr))
    lumen = 1 - _ss(tr - tw - 0.0006, tr - tw, dt)
    alb = alb * (1 - ring[:, None]) + np.array([0.60, 0.58, 0.52]) * ring[:, None]
    h = h * (1 - ring) + 0.002 * ring
    alb = alb * (1 - lumen[:, None]) + np.array([0.025, 0.012, 0.012]) * lumen[:, None]
    h = h * (1 - lumen) + (-0.008) * lumen
    # carotids: white 1 mm wall, recessed 5-8 mm lumen
    for _, cu, cv, r, wall, rec in VESSELS:
        dc = np.sqrt((uu - cu) ** 2 + (vv - cv) ** 2)
        wl = _ss(r - wall - 0.0003, r - wall, dc) * (1 - _ss(r, r + 0.0003, dc))
        lu = 1 - _ss(r - wall - 0.0003, r - wall, dc)
        alb = alb * (1 - wl[:, None]) + np.array([0.55, 0.48, 0.45]) * wl[:, None]
        alb = alb * (1 - lu[:, None]) + np.array([0.05, 0.004, 0.004]) * lu[:, None]
        h = h * (1 - lu) + rec * lu
    # jugulars: collapsed dark slits (10-12 mm)
    for cu, cv in JUGULARS:
        dj = np.sqrt(((uu - cu) / 0.0055) ** 2 + ((vv - cv) / 0.0012) ** 2)
        sl = 1 - _ss(0.8, 1.1, dj)
        alb = alb * (1 - sl[:, None]) + np.array([0.03, 0.01, 0.012]) * sl[:, None]
        h = h - 0.002 * sl
    # blood film 0.1-0.5 mm over >= 60 %, thicker toward the front (the low side), pooled in the recesses
    fn = noise.fbm(P3 * 70.0, 4, seed + 9)
    film = np.clip(0.45 + 0.6 * fn + 0.35 * np.clip(v / B_V, -1, 1) + 30.0 * np.clip(-h - 0.003, 0, 0.01), 0, 1)
    film = film * (1 - 0.6 * ring) * (1 - 0.5 * (dvert < 0.9) * _ss(0.4, 0.7, fn + 0.5))   # bone and cartilage break it
    film = film * (rho < 1.0)
    blood = np.array([0.11, 0.009, 0.008])
    alb = alb * (1 - film[:, None]) + blood * film[:, None]
    rough = rough * (1 - film) + 0.05 * film
    h = h + 0.0004 * film
    return h, alb, rough, film


def height(u, v):
    h = fields(u, v)[0]
    return float(h[0]) if np.ndim(u) == 0 else h
