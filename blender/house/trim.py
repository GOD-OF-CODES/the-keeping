"""Interior mouldings swept along each room's wall chain with true mitres (inside and outside corners):
baseboard with shoe and cap, crown moulding, picture rail, beadboard wainscot with chair-rail cap.

Runs break at door/window casings (casing footprints from casing_rect), over floor holes (stairwell), where the
stair strings take over, under ceiling holes (crown) and above stair-clipped partitions.
"""
import math

from mathutils import Vector

from .geom import dedupe, subtract_intervals, sweep
from .plan import StairGeo, dot, sub

UP = Vector((0, 0, 1))
CASE_W = 0.10          # interior casing width (doors, windows)
CASE_HEAD = 0.16       # head casing height above the opening
APRON = 0.16           # window apron below the sill (stool + apron)
NO_TRIM = {'wood_raw_plank'}


def _arc(cx, cy, r, a0, a1, n):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def baseboard_profile(h=0.2):
    """Board with a quarter-round shoe at the floor and a bead-and-ogee cap; (0,0) at the wall/floor corner."""
    pts = [(0.0, 0.0), (0.034, 0.0)]
    pts += [(0.018 + 0.016 * math.cos(t), 0.016 * math.sin(t)) for t in [math.pi / 2 * i / 4 for i in range(1, 5)]]
    pts += [(0.018, h - 0.042), (0.021, h - 0.04), (0.025, h - 0.034)]
    pts += _arc(0.018, h - 0.026, 0.009, -0.2, 1.2, 4)
    pts += [(0.012, h - 0.012), (0.009, h - 0.004), (0.006, h), (0.0, h)]
    return dedupe(pts)


def crown_profile(h=0.13, d=0.13):
    """Bed mould + big cove + top fillet; (0,0) on the wall at the bottom, (d, h) on the ceiling."""
    pts = [(0.0, 0.0), (0.008, 0.0)]
    pts += _arc(0.008, 0.008, 0.008, -math.pi / 2, 0.0, 3)[1:]            # small bead
    pts += [(0.018, 0.02)]
    # big cove (concave): centre above-out
    r = min(h, d) * 0.62
    cx, cy = 0.018 + r, 0.02
    pts += [(cx - r * math.cos(t), cy + r * math.sin(t)) for t in [math.pi / 2 * i / 7 for i in range(1, 8)]]
    top = pts[-1][1]
    pts += [(pts[-1][0] + 0.008, top), (pts[-1][0] + 0.008, top + 0.012)]
    pts += _arc(pts[-1][0] + 0.0, top + 0.012 + 0.009, 0.009, -math.pi / 2, 0.0, 3)[1:]
    x_end = max(p[0] for p in pts) + 0.004
    pts += [(x_end, h), (0.0, h)]
    return dedupe(pts)


def picture_rail_profile():
    return dedupe([(0.0, 0.0), (0.012, 0.0), (0.019, 0.005), (0.023, 0.014), (0.022, 0.024), (0.017, 0.03),
                   (0.0185, 0.034), (0.0185, 0.042), (0.012, 0.046), (0.0, 0.046)])


def chair_rail_profile():
    return dedupe([(0.0, -0.04), (0.017, -0.04), (0.017, -0.024), (0.023, -0.016), (0.031, -0.008),
                   (0.034, 0.002), (0.031, 0.011), (0.022, 0.017), (0.0, 0.017)])


def cove_profile(r=0.045):
    """Plain concave cove for the kitchen ceiling corner; (0,0) on the wall, the ceiling at y = r."""
    pts = [(0.0, 0.0), (0.004, 0.0)]
    pts += [(0.004 + r + r * math.cos(t), r * math.sin(t)) for t in [math.pi - (math.pi / 2) * i / 6 for i in range(1, 7)]]
    pts += [(0.004 + r + 0.006, r), (0.0, r)]
    return dedupe(pts)


def casing_cut(P, o, sc):
    """Interior casing footprint of an opening along its wall face: (s0, z0, s1, z1)."""
    w = P.openings[o['id']][0]
    z0 = w['base'] + o['sill']
    z1 = z0 + o['height']
    hw = o['width'] / 2
    if o['kind'] == 'passthrough':
        return (sc - hw, z0, sc + hw, z1)
    if o['kind'] == 'window':
        return (sc - hw - CASE_W - 0.03, z0 - APRON, sc + hw + CASE_W + 0.03, z1 + CASE_HEAD)
    return (sc - hw - CASE_W, z0, sc + hw + CASE_W, z1 + CASE_HEAD)


def _stair_footprints(P):
    out = []
    sg = StairGeo(P.stairs['ST_MAIN'], P.floors)
    # main stair along the west wall: from the wall string start to the landing
    a0, a1 = -0.26, (sg.n - 1) * sg.td + 0.03
    xs = [sg.start[0] - sg.w / 2 - 0.05, sg.start[0] + sg.w / 2 + 0.12]
    ys = [sg.start[1] + a0, sg.start[1] + a1]
    out.append((min(xs), min(ys), max(xs), max(ys), sg.z0))
    return out


def _seg_cuts(P, rid, S, zb, zt, band, soffit):
    """Intervals (s0, s1) along segment S where a band [zb, zt] must not run."""
    cuts = []
    for o, sc in S['openings']:
        c0, cz0, c1, cz1 = casing_cut(P, o, sc)
        if cz0 < zt and cz1 > zb:
            cuts.append((c0, c1))
    r = P.rooms[rid]
    z_floor, z_ceil = P.room_z(rid)
    L = S['length']
    d = S['dir']

    def line_cut(rect, margin=0.06):
        x0, y0, x1, y1 = rect
        # distance of the face line from the rect and the overlap along the line
        if abs(d[1]) < 1e-6:     # runs along x
            if not (y0 - margin <= S['p0'][1] <= y1 + margin):
                return None
            a, b = (x0 - S['p0'][0]) / d[0], (x1 - S['p0'][0]) / d[0]
        else:
            if not (x0 - margin <= S['p0'][0] <= x1 + margin):
                return None
            a, b = (y0 - S['p0'][1]) / d[1], (y1 - S['p0'][1]) / d[1]
        return (min(a, b), max(a, b))
    if band == 'floor':
        for h in r['floorHoles']:
            c = line_cut(h)
            if c:
                cuts.append(c)
        for x0, y0, x1, y1, z in _stair_footprints(P):
            if abs(z - z_floor) < 0.01:
                c = line_cut((x0, y0, x1, y1))
                if c:
                    cuts.append(c)
    if band == 'ceiling':
        for h in r['ceilingHoles']:
            c = line_cut(h)
            if c:
                cuts.append(c)
    if S['clip'] and soffit:
        bad = []
        n = 60
        for i in range(n + 1):
            s = L * i / n
            p = (S['p0'][0] + d[0] * s, S['p0'][1] + d[1] * s)
            if soffit(*p) < zt + 0.02:
                bad.append(s)
        if bad:
            cuts.append((min(bad) - 0.05, max(bad) + L / n))
    if S['top'] < zt - 1e-6:
        cuts.append((-1, L + 1))
    return cuts


def _runs(chain, closed, cutfn):
    """Split a chain into runs [(points...)] of path points on the face lines, given per-segment cut intervals."""
    runs = []
    cur = []
    allfree = True
    pieces = []
    for S in chain:
        free = subtract_intervals(0.0, S['length'], cutfn(S))
        full = len(free) == 1 and free[0][0] < 1e-4 and free[0][1] > S['length'] - 1e-4
        if not full:
            allfree = False
        pieces.append((S, free, full))
    if closed and allfree:
        pts = [S['p0'] for S, _, _ in pieces]
        return [(pts, True)]
    for S, free, full in pieces:
        for k, (a, b) in enumerate(free):
            pa = (S['p0'][0] + S['dir'][0] * a, S['p0'][1] + S['dir'][1] * a)
            pb = (S['p0'][0] + S['dir'][0] * b, S['p0'][1] + S['dir'][1] * b)
            starts_at_corner = a < 1e-4
            if cur and starts_at_corner:
                cur.append(pb)
            else:
                if cur:
                    runs.append(cur)
                cur = [pa, pb]
            if b < S['length'] - 1e-4:
                runs.append(cur)
                cur = []
    if cur:
        runs.append(cur)
    # a closed chain whose first run starts at the chain start and last run ends at the chain end: join them
    if closed and len(runs) > 1:
        S0 = pieces[0]
        Sl = pieces[-1]
        if S0[1] and S0[1][0][0] < 1e-4 and Sl[1] and Sl[1][-1][1] > Sl[0]['length'] - 1e-4:
            first = runs.pop(0)
            runs[-1] = runs[-1][:-1] + [first[0]] + first[1:]
    out = []
    for r in runs:
        r = [p for i, p in enumerate(r) if i == 0 or math.hypot(p[0] - r[i - 1][0], p[1] - r[i - 1][1]) > 1e-5]
        if len(r) >= 2:
            out.append((r, False))
    return out


def _sweep_runs(M, runs, z, profile, mat):
    for pts, closed in runs:
        path = [Vector((p[0], p[1], z)) for p in pts]
        if not closed:
            L = sum((path[i + 1] - path[i]).length for i in range(len(path) - 1))
            if L < 0.03:
                continue
        sweep(M, path, profile, mat, closed=closed, side_sign=1.0)


def wainscot_run(M, S, a, b, z0, z1, mat, pitch=0.089, depth=0.012, groove=0.006):
    """Beadboard sheet on segment S between s=a..b, z0..z1: flat boards with V-grooves at each joint."""
    n = Vector((S['n'][0], S['n'][1], 0))
    d = Vector((S['dir'][0], S['dir'][1], 0))
    p0 = Vector((S['p0'][0], S['p0'][1], 0))
    ss = []
    s = a
    k0 = math.ceil((a + 0.002) / pitch)
    xs = [a]
    k = k0
    while k * pitch < b - 0.004:
        xs.append(k * pitch)
        k += 1
    xs.append(b)
    prof = []  # (s, out)
    for i, x in enumerate(xs):
        if 0 < i < len(xs) - 1:
            prof += [(x - 0.0035, depth), (x, depth - groove), (x + 0.0035, depth)]
        else:
            prof.append((x, depth))
    prof = [(max(a, min(b, s_)), o) for s_, o in prof]
    verts = []
    for s_, o in prof:
        verts.append(p0 + d * s_ + n * o + UP * z0)
        verts.append(p0 + d * s_ + n * o + UP * z1)
    faces, luv, want = [], [], []
    for i in range(len(prof) - 1):
        A, B = 2 * i, 2 * i + 2
        faces.append([A, B, B + 1, A + 1])
        luv.append([(prof[i][0], z0), (prof[i + 1][0], z0), (prof[i + 1][0], z1), (prof[i][0], z1)])
        want.append(n)
    for s_, idx, wn in ((prof[0][0], 0, -d), (prof[-1][0], 2 * (len(prof) - 1), d)):
        w0 = p0 + d * s_ + UP * z0
        verts += [w0, w0 + UP * (z1 - z0)]
        faces.append([idx, idx + 1, len(verts) - 1, len(verts) - 2])
        luv.append([(0, z0), (0, z1), (depth, z1), (depth, z0)])
        want.append(wn)
    from .geom import newell
    out_f, out_uv = [], []
    for f, uv, wn in zip(faces, luv, want):
        if newell([verts[i] for i in f]).dot(wn) < 0:
            f, uv = list(reversed(f)), list(reversed(uv))
        out_f.append(f)
        out_uv.append(uv)
    M.piece(verts, out_f, mat, loop_uvs=out_uv)


def build_trim(P, meshes, soffits=None):
    from .plan import main_soffit
    soffit = lambda x, y: main_soffit(P, x, y)  # noqa: E731
    for rid, r in P.rooms.items():
        if r['kind'] != 'interior' or r['trimMat'] in NO_TRIM or rid not in meshes:
            continue
        M = meshes[rid]
        z0, z1 = P.room_z(rid)
        trim_mat = r['trimMat']
        big = rid in ('G1', 'G2')
        upper = r['floor'] == 'upper'
        kitchen = rid in ('G3', 'G3P')
        base_h = 0.16 if kitchen else (0.2 if not upper else 0.18)
        bprof = baseboard_profile(base_h)
        wain = r.get('wainscot')
        for chain, closed in P.chains(rid):
            def cuts_for(zb, zt, band):
                return lambda S: _seg_cuts(P, rid, S, zb, zt, band, soffit)
            # baseboard
            _sweep_runs(M, _runs(chain, closed, cuts_for(z0, z0 + base_h, 'floor')), z0, bprof, trim_mat)
            # crown / cove
            if kitchen:
                cp = cove_profile(0.05)
            else:
                cp = crown_profile(0.15 if big else 0.11, 0.15 if big else 0.11)
            ch = max(p[1] for p in cp)
            _sweep_runs(M, _runs(chain, closed, cuts_for(z1 - ch, z1, 'ceiling')), z1 - ch, cp, trim_mat)
            # picture rail
            if not kitchen:
                zr = z1 - (0.42 if big else 0.36)
                _sweep_runs(M, _runs(chain, closed, cuts_for(zr, zr + 0.046, 'wall')), zr, picture_rail_profile(),
                            trim_mat)
            # wainscot + chair rail
            if wain:
                zh = z0 + wain['height']
                zc = zh
                for S in chain:
                    for a, b in subtract_intervals(0.0, S['length'], _seg_cuts(P, rid, S, z0, zh, 'floor', soffit)):
                        wainscot_run(M, S, a, b, z0 + base_h - 0.02, zh - 0.035, wain['mat'])
                _sweep_runs(M, _runs(chain, closed, cuts_for(z0, zh + 0.02, 'floor')), zc, chair_rail_profile(),
                            trim_mat)
