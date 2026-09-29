"""Light-source props: candles (4 holders), the sign lantern box, the kerosene lamp.

Flames are runtime (procedural shader, lean toward Ada): every light prop exports an empty `flame` anchor node at the
flame's centre, extras {flame: true, kind}. Wax/glass/metal come from material-spec ids.
"""
import math

from mathutils import Vector

from .kit import (Part, T, anchor, box, cyl, fillet, jitter, lathe, prop, rect_section, sphere, tube)


def _interp_r(profile, z):
    """Radius of a lathe profile at height z (profile sorted bottom->top, outer surface only)."""
    pts = [(r, zz) for r, zz in profile if r > 0]
    for (r0, z0), (r1, z1) in zip(pts, pts[1:]):
        if z0 <= z <= z1 and z1 > z0:
            t = (z - z0) / (z1 - z0)
            return r0 + (r1 - r0) * t
    return pts[-1][0] if z > pts[-1][1] else pts[0][0]


def _drip(part, rng, rfun, z_top, z_end, angle, rad, mat, m=None):
    """A wax run down a surface of revolution: thin at the top, a bead at the bottom."""
    n = 7
    pts, radii = [], []
    wob = rng.j(0.25)
    for i in range(n + 1):
        t = i / n
        z = z_top + (z_end - z_top) * t
        a = angle + wob * t * t * 0.3
        r = rfun(z) + rad * 0.35
        pts.append((r * math.cos(a), r * math.sin(a), z))
        radii.append(0.55 + 0.5 * t + (0.35 if i == n else 0))
    bm = tube(pts, rad, sides=6, radii=radii)
    part.add(bm, mat, m)


def _candle(part, rng, r, h, z0, mat, guttering=False, drips=2, wick_mat='crepe_black'):
    """Wax candle standing at z0: uneven melted crater, lopsided burn, runs down the side, charred wick."""
    crater = min(0.006, r * 0.45)
    lop = (0.35 if guttering else 0.12) * r
    prof = [(0, 0), (r, 0), (r * 1.004, h * 0.25), (r * 0.998, h * 0.6), (r * 1.003, h - 0.006),
            (r * 0.99, h - 0.002), (r * 0.9, h), (r * 0.55, h - crater * 0.7), (r * 0.18, h - crater), (0, h - crater)]
    bm = lathe(prof, n=16)
    ang = rng.u(0, math.tau)
    for v in bm.verts:   # lopsided burn: one side of the rim lower, organic wobble
        if v.co.z > h * 0.8:
            a = math.atan2(v.co.y, v.co.x)
            k = (v.co.z - h * 0.8) / (h * 0.2)
            v.co.z -= lop * (0.5 + 0.5 * math.cos(a - ang)) * k
    jitter(bm, r * 0.035, freq=90.0, seed=rng.randint(0, 999))
    part.add(bm, mat, T((0, 0, z0)))
    rfun = lambda z: _interp_r(prof, max(0.0, min(h, z - z0)))
    for i in range(drips):
        a = ang + rng.j(1.2) if i == 0 else rng.u(0, math.tau)
        zt = z0 + h - lop * 0.8 - 0.002
        ze = z0 + h * rng.u(0.15 if guttering else 0.45, 0.85)
        _drip(part, rng, lambda z: r, zt, ze, a, rng.u(0.0016, 0.0026), mat)
    wz = z0 + h - crater
    wick = [(0, 0, wz - 0.002), (0, 0, wz + 0.004), (0.0008, 0, wz + 0.008), (0.0022, 0.0004, wz + 0.0105)]
    part.add(tube(wick, 0.0007, sides=5), wick_mat)
    anchor(part, part.name + '.flame', (0.0012, 0.0002, wz + 0.024), {'flame': True, 'kind': 'candle'})
    return wz


@prop('candle', instance_keys=('leansTowardAda', 'castsShadowInCutscenes'), budget=4000)
def candle(p, rng):
    holder = p.get('holder', 'brass_stick')
    h = float(p.get('height', 0.18))
    wax = p.get('mat', 'wax_candle')
    gut = bool(p.get('guttering', False))
    part = Part('candle', rng)
    if holder == 'chamberstick':
        dish = [(0, 0), (0.052, 0), (0.06, 0.0015), (0.066, 0.007), (0.069, 0.015), (0.0715, 0.0185),
                (0.0695, 0.0205), (0.0665, 0.0165), (0.063, 0.009), (0.055, 0.0045), (0, 0.0035)]
        part.add(lathe(dish, n=28), 'brass_tarnished')
        sock = [(0, 0.003), (0.0165, 0.003), (0.0185, 0.007), (0.016, 0.011), (0.0142, 0.040), (0.0168, 0.043),
                (0.018, 0.047), (0.0165, 0.049), (0.0122, 0.049), (0.0118, 0.012), (0, 0.012)]
        part.add(lathe(sock, n=20), 'brass_tarnished')
        ring = [(0.068 + 0.018 * (1 + math.cos(a)) / 2 * 1.2, 0, 0.012 + 0.015 * math.sin(a))
                for a in [i * math.tau / 14 for i in range(14)]]
        part.add(tube(ring, 0.0028, sides=6, closed=True), 'brass_tarnished')
        part.add(tube([(0.064, 0, 0.018), (0.09, 0, 0.027), (0.098, 0, 0.028)], 0.004, sides=6,
                      section=rect_section(0.013, 0.0025, 0.001)), 'brass_tarnished')
        z0, r = 0.012, 0.0105
    elif holder == 'brass_stick':
        prof = [(0, 0), (0.048, 0), (0.0495, 0.003), (0.047, 0.008), (0.040, 0.012), (0.030, 0.018),
                (0.019, 0.028), (0.0125, 0.042), (0.0105, 0.068), (0.0155, 0.077), (0.0165, 0.083), (0.0105, 0.092),
                (0.0088, 0.135), (0.0125, 0.148), (0.0085, 0.158), (0.0095, 0.165), (0.024, 0.170), (0.0255, 0.173),
                (0.0175, 0.177), (0.0138, 0.180), (0.0132, 0.202), (0.0158, 0.207), (0.0118, 0.207), (0.0112, 0.186),
                (0, 0.186)]
        part.add(lathe(prof, n=24), 'brass_tarnished')
        z0, r = 0.186, 0.0106
    elif holder == 'saucer':
        prof = [(0, 0), (0.042, 0), (0.05, 0.003), (0.062, 0.012), (0.068, 0.017), (0.0685, 0.019), (0.066, 0.0185),
                (0.058, 0.013), (0.045, 0.006), (0, 0.005)]
        part.add(lathe(prof, n=28), 'enamel_chipped')
        puddle = [(0, 0.005), (0.03, 0.005), (0.033, 0.0065), (0.028, 0.009), (0.016, 0.0115), (0, 0.012)]
        bm = lathe(puddle, n=16)
        jitter(bm, 0.004, freq=40.0, seed=rng.randint(0, 999), axes=(1, 1, 0.3))
        part.add(bm, p.get('mat', 'wax_candle'))
        z0, r = 0.009, 0.0115
    else:   # bottle: a wine bottle with a stub jammed in the neck and years of runs down the shoulder
        prof = [(0, 0.004), (0.033, 0.0), (0.0365, 0.006), (0.0368, 0.19), (0.034, 0.212), (0.022, 0.238),
                (0.0145, 0.258), (0.0138, 0.282), (0.0158, 0.286), (0.016, 0.292), (0.0125, 0.294), (0.011, 0.26),
                (0.031, 0.205), (0.0335, 0.01), (0, 0.012)]
        part.add(lathe(prof, n=24), 'glass_grimy')
        collar = [(0.0105, 0.284), (0.0175, 0.285), (0.0195, 0.29), (0.017, 0.298), (0.012, 0.301)]
        bm = lathe(collar, n=14, closed=True)
        jitter(bm, 0.002, freq=60.0, seed=rng.randint(0, 999))
        part.add(bm, wax)
        rfun = lambda z: _interp_r(prof[:10], z)
        for i in range(9 if gut else 6):
            _drip(part, rng, rfun, 0.29, rng.u(0.13, 0.26), rng.u(0, math.tau), rng.u(0.0022, 0.0034), wax)
        z0, r = 0.29, 0.0105
    _candle(part, rng, r, h, z0, wax, guttering=gut, drips=3 if gut else 2)
    part.extras['holder'] = holder
    return [part]


@prop('kerosene_lamp', budget=5000)
def kerosene_lamp(p, rng):
    """Table kerosene lamp (~45 cm): pressed-glass font on a stepped base, brass burner collar with wick wheel,
    tall grimy chimney. Flame anchor sits on the (low) wick."""
    glass = p.get('mat', 'glass_grimy')
    brass = p.get('burnerMat', 'brass_tarnished')
    part = Part('kerosene_lamp', rng)
    base = [(0, 0), (0.07, 0), (0.072, 0.006), (0.065, 0.014), (0.045, 0.03), (0.028, 0.06), (0.024, 0.09),
            (0.03, 0.1), (0, 0.1)]
    part.add(lathe(base, n=24), glass)
    font = [(0.0, 0.1), (0.04, 0.1), (0.07, 0.12), (0.082, 0.15), (0.078, 0.18), (0.055, 0.205), (0.03, 0.215),
            (0, 0.215)]
    part.add(lathe(font, n=28), glass)
    collar = [(0.0, 0.212), (0.03, 0.212), (0.032, 0.225), (0.028, 0.23), (0.035, 0.24), (0.04, 0.26),
              (0.036, 0.275), (0.0, 0.272)]
    part.add(lathe(collar, n=20), brass)
    part.add(cyl(0.009, 0.004, n=12), brass, T((0.045, 0, 0.245), (0, math.pi / 2, 0)))
    part.add(tube([(0.036, 0, 0.245), (0.045, 0, 0.245)], 0.002, sides=5), brass)
    chim = [(0.03, 0.27), (0.034, 0.275), (0.042, 0.3), (0.046, 0.33), (0.036, 0.37), (0.024, 0.4), (0.022, 0.47),
            (0.0205, 0.47), (0.0205, 0.4), (0.0345, 0.37), (0.0445, 0.33), (0.0405, 0.3), (0.0325, 0.277),
            (0.0285, 0.272)]
    part.add(lathe(chim, n=20, closed=True), glass)
    for k in range(4):
        a = k * math.tau / 4 + 0.4
        part.add(tube([(0.034 * math.cos(a), 0.034 * math.sin(a), 0.26), (0.04 * math.cos(a), 0.04 * math.sin(a), 0.285)],
                      0.0015, sides=4), brass)
    low = str(p.get('wick', 'low')) == 'low'
    anchor(part, 'kerosene_lamp.flame', (0, 0, 0.285 if low else 0.295), {'flame': True, 'kind': 'lamp', 'wick': 'low' if low else 'high'})
    return [part]
