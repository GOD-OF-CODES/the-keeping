"""Sculpted ground around the house (EXT1 road + EXT2 drive/yard), baked into LM_EXTERIOR (docs/HOUSE.md "Terrain").

A height field on a grid whose lines include every surface-zone edge of the layout (`surfaces[]` of the exterior
rooms, later entries win), so each quad has exactly one material id: grass_wet, gravel_wet, mud_wet, asphalt_wet.
Shape: gentle fBm lumps (grass), a crowned road, a flooded ditch along the south edge, two wheel ruts down the drive,
puddle dips in the ruts and mud zones. Walkable areas stay within a few cm of z = 0 (the runtime ground collider is
flat at 0); dips stay away from props standing on the ground; heights feather to exactly 0 at the rect edge so the
runtime's far ground plane (z = 0, outside `terrainRect`) meets it without a seam.
UV0 = plan (x, y) in metres; UV2 = one planar top-down chart (lm_planar), lm_weight TERRAIN_LM_WEIGHT.
"""
import math

from mathutils import Vector, noise

RECT = (-22.0, -41.0, 22.0, 16.0)       # plan x0, y0, x1, y1 (EXT1 road + ditch, drive, yard, first wrecks)
CELL = 0.45
FEATHER = 2.5
TERRAIN_LM_WEIGHT = 0.3
PUDDLES = [   # (x, y, radius, depth): ruts of the drive, the mud zones, the yard by the porch steps, road shoulder
    (0.95, -24.0, 0.7, 0.05), (2.75, -19.5, 0.9, 0.055), (0.9, -12.8, 0.6, 0.045), (2.7, -7.6, 0.8, 0.05),
    (1.6, -4.2, 0.6, 0.035), (5.6, -9.5, 1.1, 0.065), (7.2, -13.8, 0.8, 0.05), (12.4, -1.8, 1.2, 0.07),
    (14.6, 0.4, 0.9, 0.06), (-3.5, -29.0, 0.8, 0.04), (7.5, -29.1, 0.7, 0.035), (-2.4, -6.0, 0.6, 0.03),
]
RUTS_X = (0.95, 2.75)                    # drive wheel tracks (drive x -0.7..4.3)
DRIVE = (-0.7, -28.0, 4.3, -2.8)
ROAD = (-36.5, -29.5)                    # asphalt y range
DITCH = (-38.0, -37.2)


def _smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def _fbm(x, y, f, octaves=3, seed=0.0):
    a, s, amp = 0.0, 0.0, 1.0
    for _ in range(octaves):
        a += amp * noise.noise(Vector((x * f, y * f, seed)))
        s += amp
        f *= 2.03
        amp *= 0.5
    return a / s


def zones(P):
    """[(rect, mat)] for the exterior rooms, in layout order (later wins). The porch deck zone becomes mud."""
    out = []
    for s in P.L['surfaces']:
        if s.get('room') not in ('EXT1', 'EXT2') or not s.get('mat'):
            continue
        mat = s['mat']
        if mat == 'porch_boards_wet':
            mat = 'mud_wet'
        out.append((tuple(s['rect']), mat))
    return out


def mat_at(zs, x, y):
    m = 'grass_wet'
    for (x0, y0, x1, y1), mid in zs:
        if x0 <= x <= x1 and y0 <= y <= y1:
            m = mid
    return m


def height(x, y, mat, pads):
    x0, y0, x1, y1 = RECT
    h = 0.0
    if mat == 'grass_wet':
        h = 0.035 * _fbm(x, y, 0.35, 3, 1.7) + 0.012 * _fbm(x, y, 2.1, 2, 4.1)
    elif mat == 'mud_wet':
        h = 0.025 * _fbm(x, y, 0.8, 3, 2.3) - 0.01
    elif mat == 'gravel_wet':
        h = 0.012 * _fbm(x, y, 1.1, 2, 3.3)
    elif mat == 'asphalt_wet':
        yc = (ROAD[0] + ROAD[1]) / 2
        hw = (ROAD[1] - ROAD[0]) / 2
        h = 0.045 * (1.0 - ((y - yc) / hw) ** 2) + 0.004 * _fbm(x, y, 0.6, 2, 5.5)
    # wheel ruts down the drive
    if DRIVE[0] - 0.3 < x < DRIVE[2] + 0.3 and DRIVE[1] < y < DRIVE[3] + 0.5:
        for rx in RUTS_X:
            h -= 0.035 * math.exp(-((x - rx) / 0.17) ** 2) * (0.75 + 0.25 * _fbm(x, y, 0.5, 2, 7.0))
        h += 0.012 * math.exp(-((x - sum(RUTS_X) / 2) / 0.35) ** 2)     # crown between the ruts
    # flooded ditch along the south edge of the road
    if y < DITCH[1] + 0.4:
        t = _smooth(DITCH[1] + 0.4, DITCH[0] + 0.35, y)
        h -= 0.28 * math.sin(t * math.pi / 2) ** 2
    for px, py, r, d in PUDDLES:
        q = ((x - px) ** 2 + (y - py) ** 2) / (r * r)
        if q < 1.0:
            h -= d * (1.0 - q) ** 2 * (0.8 + 0.2 * _fbm(x, y, 1.3, 1, 9.0))
    # props standing on the ground (built for z = 0): no dips under them (a prop may sink a little into a bump,
    # never float over a hollow)
    for px, py, r in pads:
        dd = math.hypot(x - px, y - py)
        if dd < r * 1.8 and h < 0:
            h *= _smooth(r, r * 1.8, dd)
    # feather to 0 at the rect edge
    e = min(x - x0, x1 - x, y - y0, y1 - y)
    return h * _smooth(0.0, FEATHER, e)


def _lines(a, b, cell, cuts):
    """Regular grid lines plus every zone edge; regular lines closer than 4 cm to an edge are dropped."""
    n = max(1, round((b - a) / cell))
    cuts = sorted({round(c, 5) for c in cuts if a < c < b})
    reg = [a + (b - a) * i / n for i in range(n + 1)]
    keep = [v for v in reg if all(abs(v - c) > 0.04 for c in cuts) or v in (a, b)]
    return sorted(set(keep) | set(cuts))


def build(P, M):
    """Fill Mesh M (EXT2_terrain) and set its extras. Returns stats."""
    x0, y0, x1, y1 = RECT
    zs = zones(P)
    fx0, fy0, fx1, fy1 = P.footprint()
    hole = (fx0 + 0.05, fy0 + 0.05, fx1 - 0.05, fy1 - 0.05)      # under the house (foundation covers the edge)
    pads = []
    for p in P.L['props']:
        if p.get('room') in ('EXT1', 'EXT2') and abs(p['pos'][2]) < 0.01 and p['type'] not in (
                'porch', 'foundation_skirt', 'harlan_pose_marker', 'fx_drip_emitter'):
            r = {'sedan': 2.6, 'wreck_sedan': 2.6, 'gas_pump': 0.9, 'rain_barrel': 0.6, 'dead_tree': 0.9,
                 'fence_run': 0.4, 'farm_gate': 0.5}.get(p['type'], 0.45)
            pads.append((p['pos'][0], p['pos'][1], r))
    cx = [r[0] for r, _ in zs] + [r[2] for r, _ in zs] + [hole[0], hole[2]]
    cy = [r[1] for r, _ in zs] + [r[3] for r, _ in zs] + [hole[1], hole[3]]
    xs = _lines(x0, x1, CELL, cx)
    ys = _lines(y0, y1, CELL, cy)
    idx, verts = {}, []
    mats_at = {}

    def vid(i, j):
        k = (i, j)
        if k not in idx:
            x, y = xs[i], ys[j]
            idx[k] = len(verts)
            verts.append(Vector((x, y, 0.0)))
        return idx[k]
    faces, fmats, luv = [], [], []
    for j in range(len(ys) - 1):
        for i in range(len(xs) - 1):
            cxm, cym = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            if hole[0] < cxm < hole[2] and hole[1] < cym < hole[3]:
                continue
            m = mat_at(zs, cxm, cym)
            q = [vid(i, j), vid(i + 1, j), vid(i + 1, j + 1), vid(i, j + 1)]
            faces.append(q)
            fmats.append(m)
            for v in q:
                mats_at.setdefault(v, set()).add(m)
            luv.append([(xs[a], ys[b]) for a, b in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))])
    # heights: a vertex shared by several zones takes the mean of each zone's height (no cracks, soft zone edges)
    for v, ms in mats_at.items():
        p = verts[v]
        p.z = sum(height(p.x, p.y, m, pads) for m in ms) / len(ms)
    M.piece(verts, faces, None, loop_uvs=luv, mids=fmats)
    M.extras['lm_planar'] = ((x0, y0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0))
    M.extras['terrain'] = True
    M.extras['terrainRect'] = list(RECT)
    M.extras['terrainHole'] = [round(v, 4) for v in hole]
    zsv = [p.z for p in verts]
    return {'quads': len(faces), 'verts': len(verts), 'z_min': round(min(zsv), 3), 'z_max': round(max(zsv), 3),
            'cells': (len(xs) - 1, len(ys) - 1)}
