"""Loblolly / white-pine character conifers for the County Road 9 corridor (docs/C1-OPENING.md §6.4).

What makes the "black walls" of the opening: straight self-pruned boles 18-28 m (dead branch stubs below the live
crown), a live crown over the top 38-48 % built from whorled tiers of foliage "plates" (flattened, drooping,
jittered ellipsoids on short branch arms), irregular and a little one-sided like a real roadside edge tree. Solid
geometry only: no alpha cards, no textures (materials bark_wet + pine_needles from material-spec).

LODs (reference height 22 m, scaled per instance): L0 <= 1.8k tris (whorls of 3-5 plates, branch arms, stubs),
L1 <= 400 (5 tiers of 2 plates), L2 <= 70 (one crown ellipsoid + top spire). Three variants share the seeds across
LODs, so a tree keeps its silhouette when the runtime swaps LOD.
"""
import math
import random

from mathutils import Matrix, Vector

from props.kit import Part, T, cyl, jitter, sphere, tube, lathe

H_REF = 22.0
BARK = 'bark_wet'
NEEDLES = 'pine_needles'

SPEC = {
    'L0': dict(sides=6, trunk_rings=7, tiers=12, plates=(3, 3), plate_seg=(6, 3), arms=True, stubs=14, tris=1800,
               points=8),
    'L1': dict(sides=5, trunk_rings=4, tiers=6, plates=(2, 2), plate_seg=(5, 3), arms=False, stubs=3, tris=400,
               points=7),
    'L2': dict(sides=3, trunk_rings=2, tiers=0, plates=(0, 0), plate_seg=(6, 3), arms=False, stubs=0, tris=70),
}


def _shape(variant):
    rng = random.Random(7700 + 131 * variant)
    return {
        'crown_base': rng.uniform(0.36, 0.46),       # edge trees keep foliage low on the open (road) side
        'r_max': rng.uniform(3.2, 4.1),              # widest crown radius (m) at reference height
        'lean': (rng.uniform(-0.25, 0.25), rng.uniform(-0.25, 0.25)),
        'bias': rng.uniform(0, math.tau),            # the open (road) side carries more foliage
        'seed': 7700 + 131 * variant,
    }


def _trunk_xy(z, sh):
    t = z / H_REF
    return sh['lean'][0] * t * t + 0.12 * math.sin(z * 0.35 + sh['seed']), sh['lean'][1] * t * t


def _crown_r(t, sh):
    """Crown radius at fraction t (0 = crown base, 1 = tip): loblolly - rounded, widest a third of the way up."""
    return sh['r_max'] * max(0.08, math.sin(math.pi * (0.18 + 0.82 * min(1.0, t))) ** 0.8) * (1.0 - 0.55 * t)


def _plate(part, rng, centre, rx, ry, rz, droop, yaw, seg, mat):
    bm = sphere(1.0, seg[0], seg[1])
    for v in bm.verts:
        v.co.x *= rx
        v.co.y *= ry
        v.co.z *= rz
        if v.co.z < 0:
            v.co.z *= 0.55                            # flat-bottomed plate: needles hang from the top
        d = math.hypot(v.co.x, v.co.y) / max(rx, ry)
        v.co.z -= droop * d * d                        # tips droop
    jitter(bm, 0.26 * min(rx, ry), freq=1.3, seed=rng.randint(0, 9999))
    jitter(bm, 0.10 * min(rx, ry), freq=4.0, seed=rng.randint(0, 9999))      # ragged needle-clump edges
    part.add(bm, mat, T(tuple(centre), (0, 0, yaw)), smooth=True)


def _skirt(part, rng, centre, rx, ry, rz, droop, yaw, points, mat):
    """A drooping needle 'skirt': a low cone whose rim is a ragged star (alternating long tips / short notches), so
    the silhouette breaks up into tufts the way a pine branch spray does, with a shallow underside. 4 * points tris.
    (Review r2: the smooth ellipsoid plates read as stacked caps / boxes at 30-120 m.)"""
    import bmesh
    bm = bmesh.new()
    n2 = 2 * points
    top = bm.verts.new((rng.uniform(-0.15, 0.15) * rx, rng.uniform(-0.15, 0.15) * ry, rz * 0.95))
    bot = bm.verts.new((0.0, 0.0, -rz * 0.45))     # r3: thicker sprays (r2 read as paper stars)
    rim = []
    ph = rng.uniform(0, math.tau)
    for i in range(n2):
        a = ph + math.tau * i / n2 + rng.uniform(-0.12, 0.12)
        k = rng.uniform(0.92, 1.12) if i % 2 == 0 else rng.uniform(0.5, 0.68)
        x, y = math.cos(a) * rx * k, math.sin(a) * ry * k
        z = -droop * k * k + rng.uniform(-0.12, 0.12) * rz
        rim.append(bm.verts.new((x, y, z)))
    for i in range(n2):
        a, b = rim[i], rim[(i + 1) % n2]
        bm.faces.new((top, a, b))
        bm.faces.new((bot, b, a))
    part.add(bm, mat, T(tuple(centre), (0, 0, yaw)), smooth=True)


def pine(lod, variant):
    """Part (origin at the root collar, z up) for one LOD of one variant."""
    sp = SPEC[lod]
    sh = _shape(variant)
    rng = random.Random(sh['seed'])
    part = Part(f'pine_{lod}_{variant}')
    hc = H_REF * sh['crown_base']
    # bole: flared root collar, taper to the leader tip; a gentle sweep
    rings = []
    n = sp['trunk_rings']
    for k in range(n + 1):
        t = k / n
        z = H_REF * t ** 1.05
        r = 0.30 * (1 - t) ** 1.15 + 0.02
        if k == 0:
            r *= 1.35
        x, y = _trunk_xy(z, sh)
        rings.append(((x, y, z), r))
    bark = tube([p for p, _ in rings], 1.0, sides=sp['sides'], radii=[r for _, r in rings], caps=False)
    part.add(bark, BARK, smooth=True)
    # dead branch stubs on the pruned bole (L0)
    for k in range(sp['stubs']):
        z = rng.uniform(H_REF * 0.18, hc * 0.97)
        a = rng.uniform(0, math.tau)
        x, y = _trunk_xy(z, sh)
        ln = rng.uniform(0.4, 1.6)
        d = Vector((math.cos(a), math.sin(a), rng.uniform(-0.45, -0.05))).normalized()
        p0 = Vector((x, y, z))
        k1 = p0 + d * ln * 0.55 + Vector((rng.uniform(-0.1, 0.1), rng.uniform(-0.1, 0.1), -0.08))
        part.add(tube([tuple(p0), tuple(k1), tuple(k1 + d * ln * 0.45)], 0.035, sides=3, radii=[1.0, 0.55, 0.15]),
                 BARK)
    tiers = sp['tiers']
    if tiers == 0:
        # L2: one crown ellipsoid + a spire, matching the L0 silhouette from far away
        zc = hc + (H_REF - hc) * 0.45
        x, y = _trunk_xy(zc, sh)
        # r3: two ragged skirts (lower wide, upper narrow) + spire tip instead of one smooth ellipsoid, so the far
        # wall keeps the tiered pine silhouette of L0/L1 (2 x 20 + bole 12 tris)
        for f, rr, hh in ((0.28, 0.95, 0.42), (0.68, 0.6, 0.5)):
            z = hc + (H_REF - hc) * f
            x, y = _trunk_xy(z, sh)
            _skirt(part, rng, (x, y, z), sh['r_max'] * rr, sh['r_max'] * rr * 0.9, (H_REF - hc) * hh * 0.6,
                   (H_REF - hc) * 0.12, sh['bias'], 5, NEEDLES)
        return part
    for k in range(tiers):
        t = (k + 0.5) / tiers
        z = hc + (H_REF - hc) * t * 0.94
        r = _crown_r(t, sh)
        x, y = _trunk_xy(z, sh)
        m = rng.randint(*sp['plates'])
        a0 = rng.uniform(0, math.tau)
        for j in range(m):
            a = a0 + math.tau * j / m + rng.uniform(-0.4, 0.4)
            # foliage is fuller toward the open side (the road)
            full = 1.0 + 0.25 * math.cos(a - sh['bias'])
            reach = r * rng.uniform(0.45, 0.62) * full
            c = Vector((x + math.cos(a) * reach, y + math.sin(a) * reach, z + rng.uniform(-0.25, 0.25)))
            rx = r * rng.uniform(0.48, 0.62) * full
            ry = rx * rng.uniform(0.6, 0.85)
            rz = rng.uniform(0.5, 0.85) * (1.0 if lod == 'L0' else 1.45)
            _skirt(part, rng, c, rx * 1.25, ry * 1.3, rz, 0.8 * rx / 2.5, a, sp['points'], NEEDLES)
            if sp['arms']:
                part.add(tube([(x, y, z - 0.05), (c.x * 0.8 + x * 0.2, c.y * 0.8 + y * 0.2, c.z - 0.2)], 0.045,
                              sides=3, radii=[1.0, 0.5]), BARK)
    # leader tip spire
    x, y = _trunk_xy(H_REF * 0.96, sh)
    sp_cone = lathe([(0.0, 0.0), (0.55, 0.25), (0.0, 1.9)], 5)
    jitter(sp_cone, 0.08, freq=2.0, seed=rng.randint(0, 999))
    part.add(sp_cone, NEEDLES, T((x, y, H_REF * 0.9)))
    return part


def understory(variant):
    """Edge understory clump (young pine / sumac / greenbrier at the forest edge), ~90 tris, 1.6 m reference."""
    rng = random.Random(8800 + 17 * variant)
    part = Part(f'understory_{variant}')
    # review r2: isolated ellipsoid clumps read as 'cabbages'. Now a young pine (3 ragged whorls on a leaning
    # leader) beside a low spray of brush; the star rims break the silhouette like the big trees.
    lx, ly = rng.uniform(-0.12, 0.12), rng.uniform(-0.12, 0.12)
    part.add(tube([(0, 0, 0), (lx * 0.5, ly * 0.5, 0.9), (lx, ly, 1.75)], 0.03, sides=3, radii=[1.0, 0.6, 0.2]), BARK)
    for k, (z, r) in enumerate(((0.5, 1.0), (1.05, 0.74), (1.5, 0.46))):    # r3: was too small / sparse
        f = z / 1.75
        _skirt(part, rng, (lx * f, ly * f, z), r, r * rng.uniform(0.8, 1.0), 0.3, 0.16 * r, rng.uniform(0, math.tau),
               6, NEEDLES)
    a = rng.uniform(0, math.tau)
    _skirt(part, rng, (math.cos(a) * 0.8, math.sin(a) * 0.8, 0.25), 0.8, 0.6, 0.4, 0.1, a, 6, NEEDLES)
    for k in range(3):   # a few bare whips / dead stems poking out
        a = rng.uniform(0, math.tau)
        part.add(tube([(0, 0, 0), (math.cos(a) * 0.5, math.sin(a) * 0.5, rng.uniform(1.3, 2.0))], 0.012, sides=3,
                      radii=[1.0, 0.3]), BARK)
    return part
