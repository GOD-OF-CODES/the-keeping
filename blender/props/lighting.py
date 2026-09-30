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


@prop('kerosene_lamp', budget=6000)
def kerosene_lamp(p, rng):
    """Table kerosene lamp (~47 cm) that reads as an OBJECT around its flame: a stamped-brass font (reservoir) on a
    stepped brass foot with a finger-loop handle, a brass burner (collar, wick-raiser wheel, pronged gallery holding
    the chimney, domed flame deflector with its slot), a flat cotton wick charred at the tip standing out of the
    slot, and a thick-walled grimy glass chimney (bulged, sooty tip is a runtime/material matter).
    `mat` = chimney glass, `burnerMat` = the brass (font, foot, burner). Flame anchor sits on the wick tip."""
    glass = p.get('mat', 'glass_grimy')
    brass = p.get('burnerMat', 'brass_tarnished')
    part = Part('kerosene_lamp', rng)
    # stepped foot + stem (spun brass, a little dented)
    foot = [(0, 0), (0.068, 0), (0.07, 0.004), (0.069, 0.009), (0.06, 0.013), (0.057, 0.019), (0.046, 0.026),
            (0.032, 0.04), (0.022, 0.06), (0.019, 0.08), (0.024, 0.092), (0.03, 0.1), (0, 0.1)]
    bm = lathe(foot, n=28)
    jitter(bm, 0.0008, freq=30.0, seed=rng.randint(0, 999))
    part.add(bm, brass)
    # font: squat reservoir with a raised seam and a filler cap
    font = [(0.0, 0.1), (0.036, 0.1), (0.062, 0.112), (0.078, 0.13), (0.0805, 0.148), (0.0812, 0.151),
            (0.0805, 0.154), (0.076, 0.172), (0.062, 0.192), (0.042, 0.206), (0.03, 0.212), (0, 0.212)]
    bm = lathe(font, n=32)
    jitter(bm, 0.0006, freq=25.0, seed=rng.randint(0, 999))
    part.add(bm, brass)
    part.add(cyl(0.009, 0.008, n=12, bevel_w=0.001), brass, T((0.05, 0.0, 0.192), (0, -0.55, 0)))
    # finger-loop handle on the side (-x)
    loop = [(-0.07, 0, 0.165), (-0.098, 0, 0.17), (-0.108, 0, 0.145), (-0.094, 0, 0.122), (-0.072, 0, 0.125)]
    part.add(tube(fillet(loop, 0.012, 3), 0.0042, sides=8), brass)
    part.add(box(0.03, 0.012, 0.004, bevel_w=0.001, segs=1, center=(-0.098, 0, 0.1735)), brass)   # thumb rest
    # burner: threaded collar, body, wick-raiser wheel on its shaft
    collar = [(0.0, 0.211), (0.03, 0.211), (0.0325, 0.216), (0.03, 0.22), (0.0325, 0.224), (0.03, 0.228),
              (0.034, 0.236), (0.037, 0.25), (0.036, 0.258), (0.0, 0.258)]
    part.add(lathe(collar, n=24), brass)
    part.add(tube([(0.034, 0, 0.243), (0.056, 0, 0.243)], 0.0018, sides=6), brass)
    wheel = cyl(0.0105, 0.0035, n=16, bevel_w=0.0008)
    part.add(wheel, brass, T((0.052, 0, 0.243), (0, math.pi / 2, 0)))
    for k in range(10):      # knurled rim of the wheel
        a = k * math.tau / 10
        part.add(box(0.004, 0.0016, 0.0016, bevel_w=0.0, segs=1,
                     center=(0.0538, 0.0105 * math.cos(a), 0.243 + 0.0105 * math.sin(a))), brass)
    # gallery: a perforated ring with 4 spring prongs gripping the chimney base
    gal = [(0.029, 0.256), (0.0355, 0.256), (0.0365, 0.262), (0.035, 0.266), (0.0305, 0.266), (0.029, 0.262)]
    part.add(lathe(gal, n=24, closed=True), brass)
    for k in range(4):
        a = k * math.tau / 4 + 0.4
        c, s_ = math.cos(a), math.sin(a)
        part.add(tube([(0.034 * c, 0.034 * s_, 0.262), (0.041 * c, 0.041 * s_, 0.276), (0.0385 * c, 0.0385 * s_, 0.288)],
                      0.0017, sides=5), brass)
    # domed flame deflector (with the wick slot) inside the chimney
    dome = [(0.0, 0.262), (0.021, 0.262), (0.02, 0.272), (0.0155, 0.281), (0.0085, 0.2865), (0.0, 0.2875)]
    part.add(lathe(dome, n=20, cap_bottom=False), brass)
    part.add(box(0.026, 0.0045, 0.0022, bevel_w=0.0006, segs=1, center=(0, 0, 0.2875)), brass)   # slot lips
    # flat woven wick standing out of the slot; charred, frayed tip
    low = str(p.get('wick', 'low')) == 'low'
    top = 0.2905 if low else 0.297
    part.add(box(0.021, 0.0018, top - 0.004 - 0.279, bevel_w=0.0, segs=1, center=(0, 0, (0.279 + top - 0.004) / 2)),
             'wick_cotton')
    tip = box(0.0212, 0.002, 0.004, bevel_w=0.0005, segs=1, center=(0, 0, top - 0.002))
    for v in tip.verts:       # burnt into a shallow crown, a little frayed
        if v.co.z > top - 0.0015:
            v.co.z -= 0.0012 * (1.0 - (2.0 * v.co.x / 0.021) ** 2) + rng.u(0.0, 0.0006)
    part.add(tip, 'crepe_black')
    # chimney: thick-walled (2.5 mm) pressed glass, bulb above the flame, slightly fire-polished lip
    chim = [(0.0302, 0.268), (0.0335, 0.272), (0.042, 0.297), (0.0465, 0.33), (0.037, 0.368), (0.0245, 0.398),
            (0.0228, 0.462), (0.0242, 0.468), (0.0214, 0.47),
            (0.0203, 0.467), (0.0203, 0.398), (0.034, 0.368), (0.044, 0.33), (0.0395, 0.298), (0.031, 0.276),
            (0.0277, 0.271)]
    part.add(lathe(chim, n=24, closed=True), glass)
    anchor(part, 'kerosene_lamp.flame', (0, 0, top + 0.012), {'flame': True, 'kind': 'lamp', 'wick': 'low' if low else 'high'})
    return [part]
