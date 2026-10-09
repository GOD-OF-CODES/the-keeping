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
# Overgrown two-track (art-director review 2026-10-07: a 5 m slab of gravel with ruler-straight edges read as a
# concrete runway). A rural drive nobody has re-gravelled for years: two gravel wheel tracks ~1.3 m wide on the 1.8 m
# track gauge of a sedan (ruts at RUTS_X), a grass crown 0.55-1.05 m wide between them (tyres never touch it), grass
# shoulders creeping in from both sides. Every gravel/grass boundary is a wavy line: the terrain vertices on these
# four grid lines move in x by _drive_jitter(y) (amplitude A, wavelength W metres), so the edge meanders like a real
# verge instead of following the 0.45 m grid. The layout's gravel rect is unchanged (CONTRACT-CHANGES row 35).
DRIVE_LINES = (   # (nominal x, jitter amplitude m, wavelength m, noise seed)
    (0.15, 0.20, 3.4, 11.0),    # grass shoulder | left track
    (1.45, 0.12, 2.2, 12.0),    # left track | grass crown
    (2.25, 0.12, 2.5, 13.0),    # grass crown | right track
    (3.50, 0.20, 3.8, 14.0),    # right track | grass shoulder
)
CROWN_PINCH = (1.74, 1.96)       # where the crown lines converge as the crown peters out at the gate / porch ends
# grid columns across the drive (replace the regular 0.45 m lines there; >= 0.35 m between jittered lines)
DRIVE_GRID = (-0.7, -0.27, 0.15, 0.55, 0.95, 1.45, CROWN_PINCH[0], CROWN_PINCH[1], 2.25, 2.75, 3.12, 3.50, 3.90, 4.3)
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


def _zone_mat(zs, x, y):
    m = 'grass_wet'
    for (x0, y0, x1, y1), mid in zs:
        if x0 <= x <= x1 and y0 <= y <= y1:
            m = mid
    return m


def _drive_jitter(k, y):
    """x offset (m) of drive boundary line k at plan y: two octaves of Perlin noise along the drive, |j| <= A."""
    _, a, w, seed = DRIVE_LINES[k]
    n = 0.7 * noise.noise(Vector((seed, y / w, 0.37))) + 0.3 * noise.noise(Vector((seed + 0.5, 2.7 * y / w, 0.81)))
    return a * max(-1.0, min(1.0, 1.8 * n))


def crown_t(y):
    """1 where the grass crown is full width, 0 where it has petered out (2 m fades at the gate and porch ends)."""
    return _smooth(DRIVE[1] + 0.3, DRIVE[1] + 2.3, y) * _smooth(DRIVE[3] - 0.6, DRIVE[3] - 2.6, y)


def drive_line_x(k, y, jitter=True):
    """Actual x of drive boundary line k at plan y (k = 0 left shoulder, 1-2 crown, 3 right shoulder).
    jitter=False: the nominal grid line (the terrain build classifies quads by grid column, then moves the vertices)."""
    if not jitter:
        return DRIVE_LINES[k][0]
    x = DRIVE_LINES[k][0] + _drive_jitter(k, y)
    if k in (1, 2):
        pin = CROWN_PINCH[k - 1]
        x = pin + (x - pin) * crown_t(y)
    return x


def _drive_mat(m, x, y, jitter=True):
    """The two-track split of the layout's gravel drive rect: shoulders and crown are grass."""
    if m != 'gravel_wet' or not (DRIVE[0] <= x <= DRIVE[2] and DRIVE[1] <= y <= DRIVE[3]):
        return m
    if x < drive_line_x(0, y, jitter) or x > drive_line_x(3, y, jitter):
        return 'grass_wet'
    if crown_t(y) > 0.15 and drive_line_x(1, y, jitter) < x < drive_line_x(2, y, jitter):
        return 'grass_wet'
    return m


def drive_edge_dist(x, y):
    """Distance (m, along x) from a point inside the drive rect to the nearest gravel/grass boundary."""
    ks = (0, 1, 2, 3) if crown_t(y) > 0.15 else (0, 3)
    return min(abs(x - drive_line_x(k, y)) for k in ks)


def mat_at(zs, x, y):
    """Surface material at plan (x, y), following the real (meandering) drive boundaries."""
    return _drive_mat(_zone_mat(zs, x, y), x, y)


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
    # the drive band gets its own columns (the jittered boundary lines need clear neighbours on both sides)
    keep_cuts = {round(c, 5) for c in cx}
    xs = sorted({v for v in xs if not (DRIVE[0] < v < DRIVE[2]) or round(v, 5) in keep_cuts} | set(DRIVE_GRID))
    line_ix = {}
    for k, (nx, *_r) in enumerate(DRIVE_LINES):
        i = min(range(len(xs)), key=lambda i: abs(xs[i] - nx))
        gap = min(xs[i] - xs[i - 1], xs[i + 1] - xs[i])
        line_ix[i] = (k, min(1.0, 0.7 * gap / DRIVE_LINES[k][1]))   # never cross a neighbouring grid line
    idx, verts = {}, []
    mats_at = {}

    def vid(i, j):
        k = (i, j)
        if k not in idx:
            x, y = xs[i], ys[j]
            idx[k] = len(verts)
            lk = line_ix.get(i)
            if lk is not None and DRIVE[1] <= y <= DRIVE[3]:
                kk, scale = lk
                pin = CROWN_PINCH[kk - 1] if kk in (1, 2) else None
                x = DRIVE_LINES[kk][0] + _drive_jitter(kk, y) * scale
                if pin is not None:
                    x = pin + (x - pin) * crown_t(y)
            verts.append(Vector((x, y, 0.0)))
        return idx[k]
    faces, fmats, luv = [], [], []
    for j in range(len(ys) - 1):
        for i in range(len(xs) - 1):
            cxm, cym = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            if hole[0] < cxm < hole[2] and hole[1] < cym < hole[3]:
                continue
            # nominal (un-jittered) classification; the boundary vertices move with the lines, so it matches mat_at
            m = _drive_mat(_zone_mat(zs, cxm, cym), cxm, cym, jitter=False)
            q = [vid(i, j), vid(i + 1, j), vid(i + 1, j + 1), vid(i, j + 1)]
            faces.append(q)
            fmats.append(m)
            for v in q:
                mats_at.setdefault(v, set()).add(m)
            luv.append([(verts[v].x, verts[v].y) for v in q])     # UV0 = actual plan position (no stretch)
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
