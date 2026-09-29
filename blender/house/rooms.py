"""Interior shell: wall faces with exact openings + reveals, floors and ceilings with holes, slab liners.

Every wall side is built as its own half (face plane -> wall centre plane) and belongs to the room it faces, so a
partition between two atlases is split cleanly. Faces overlap 2 cm into hidden volume at inside corners and at
floor/ceiling junctions (never coplanar with a visible face) so the bake cannot leak light through cracks.
"""
import math

from mathutils import Vector

from .geom import Mesh, plane_with_holes, newell, splits
from .plan import StairGeo, dot, sub

EXT = 0.02
UP = Vector((0, 0, 1))


def v3(p, z=0.0):
    return Vector((p[0], p[1], z))


def facing(M, pts, n, mid, **kw):
    """Add one polygon, flipping it so its normal points along n."""
    if newell(pts).dot(Vector(n)) < 0:
        pts = list(reversed(pts))
    return M.poly(pts, mid, **kw)


def opening_rect(P, o, sc):
    w = P.openings[o['id']][0]
    zb = w['base'] + o['sill']
    return (sc - o['width'] / 2, zb, sc + o['width'] / 2, zb + o['height']), w


def seg_point(S, s, z):
    return Vector((S['p0'][0] + S['dir'][0] * s, S['p0'][1] + S['dir'][1] * s, z))


def wall_face(P, rid, S, M, soffit=None):
    z0, z1 = P.room_z(rid)
    L = S['length']
    e0 = EXT if S['corner0'] == 'inside' else 0.0
    e1 = EXT if S['corner1'] == 'inside' else 0.0
    zlo = S['base'] - (EXT if abs(S['base'] - z0) < 1e-6 else 0.0)
    zhi = S['top'] + (EXT if abs(S['top'] - z1) < 1e-6 else 0.0)
    n = Vector((S['n'][0], S['n'][1], 0))
    d = Vector((S['dir'][0], S['dir'][1], 0))
    mat = S['mat']
    holes = []
    for o, sc in S['openings']:
        (sa, zb, sb, zt), w = opening_rect(P, o, sc)
        holes.append((sa, max(zb, zlo), sb, min(zt, zhi)))
    if S['clip'] and soffit:
        # stair-clipped partition: columns whose top follows the soffit line
        cuts = []
        for s in (0.0, L):
            pass
        xs = splits(-e0, L + e1, [], 0.25)
        verts, faces = [], []
        for i, s in enumerate(xs):
            p = seg_point(S, s, 0)
            top = min(zhi, soffit(p.x, p.y))
            verts.append(seg_point(S, s, zlo))
            verts.append(seg_point(S, s, max(top, zlo + 0.01)))
        for i in range(len(xs) - 1):
            a = 2 * i
            q = [a, a + 2, a + 3, a + 1]
            pts = [verts[k] for k in q]
            if newell(pts).dot(n) < 0:
                q = list(reversed(q))
            faces.append(q)
        M.piece(verts, faces, mat)
    else:
        # frame: origin at p1, S axis = -dir, T = up  ->  normal = (-dir) x up = n
        o = seg_point(S, L, 0)
        hs = [(L - h[2], h[1], L - h[0], h[3]) for h in holes]
        plane_with_holes(M, (o, -d, UP), -e1, L + e0, zlo, zhi, hs, mat, cell=0.8)
    # reveals: this half only (face plane -> centre plane)
    for o, sc in S['openings']:
        (sa, zb, sb, zt), w = opening_rect(P, o, sc)
        dd = w['thickness'] / 2
        back = -n * dd
        A = seg_point(S, sa, zb)
        B = seg_point(S, sb, zb)
        facing(M, [A, A + back, A + back + UP * (zt - zb), A + UP * (zt - zb)], d, mat)
        facing(M, [B, B + back, B + back + UP * (zt - zb), B + UP * (zt - zb)], -d, mat)
        At, Bt = A + UP * (zt - zb), B + UP * (zt - zb)
        facing(M, [At, Bt, Bt + back, At + back], -UP, mat)
        if o['sill'] > 1e-6:
            facing(M, [A, B, B + back, A + back], UP, mat)
        else:
            facing(M, [A, B, B + back, A + back], UP, P.rooms[rid]['floorMat'], grain='x')


def _edge_has_wall(segs, axis, value, lo, hi):
    for S in segs:
        if axis == 'x' and abs(S['dir'][0]) < 1e-6 and abs(S['p0'][0] - value) < 0.13:
            a, b = sorted((S['p0'][1], S['p1'][1]))
        elif axis == 'y' and abs(S['dir'][1]) < 1e-6 and abs(S['p0'][1] - value) < 0.13:
            a, b = sorted((S['p0'][0], S['p1'][0]))
        else:
            continue
        if min(b, hi) - max(a, lo) > 0.2:
            return True
    return False


def expanded_rect(P, rid, amount=0.03):
    r = P.rooms[rid]
    x0, y0, x1, y1 = r['rect']
    segs = P.face_segments(rid)
    e = lambda axis, v, lo, hi: amount if _edge_has_wall(segs, axis, v, lo, hi) else 0.0  # noqa: E731
    return (x0 - e('x', x0, y0, y1), y0 - e('y', y0, x0, x1), x1 + e('x', x1, y0, y1), y1 + e('y', y1, x0, x1))


def nested_holes(P, rid):
    out = []
    for r in P.rooms.values():
        if r.get('within') == rid:
            x0, y0, x1, y1 = r['rect']
            out.append((x0 - 0.2, y0 - 0.04, x1 + 0.04, y1 + 0.2))
    return out


def floor_and_ceiling(P, rid, M, ceiling_holes_extra=()):
    r = P.rooms[rid]
    z0, z1 = P.room_z(rid)
    x0, y0, x1, y1 = expanded_rect(P, rid)
    grain = 'x' if (r['rect'][2] - r['rect'][0]) > (r['rect'][3] - r['rect'][1]) * 1.3 else 'y'
    fh = [tuple(h) for h in r['floorHoles']] + nested_holes(P, rid)
    plane_with_holes(M, (Vector((0, 0, z0)), Vector((1, 0, 0)), Vector((0, 1, 0))), x0, x1, y0, y1, fh,
                     r['floorMat'], cell=0.6, grain=grain)
    ch = [tuple(h) for h in r['ceilingHoles']] + nested_holes(P, rid) + list(ceiling_holes_extra)
    # ceiling: frame S = y, T = x -> normal -z; holes swapped to (y, x)
    chs = [(h[1], h[0], h[3], h[2]) for h in ch]
    plane_with_holes(M, (Vector((0, 0, z1)), Vector((0, 1, 0)), Vector((1, 0, 0))), y0, y1, x0, x1, chs,
                     r['ceilingMat'], cell=0.6)


def hole_liners(P, meshes):
    """Vertical faces through the slab around upper-floor holes (stairwell, floor register)."""
    for r in P.rooms.values():
        if r['floor'] != 'upper' or not r['floorHoles']:
            continue
        z_top = P.floors['upper']['elevation']
        below = [q for q in P.rooms.values() if q['floor'] == 'ground' and q['kind'] == 'interior'
                 and any(tuple(h) == tuple(ch) for h in r['floorHoles'] for ch in q['ceilingHoles'])]
        z_bot = P.room_z(below[0]['id'])[1] if below else z_top - 0.3
        segs = P.face_segments(r['id'])
        for h in r['floorHoles']:
            hx0, hy0, hx1, hy1 = h
            small = (hx1 - hx0) < 1.0
            M = meshes[r['id'] if small else below[0]['id']] if below else meshes[r['id']]
            edges = [  # (p, q, normal into the hole)
                ((hx0, hy0), (hx1, hy0), (0, 1)), ((hx1, hy0), (hx1, hy1), (-1, 0)),
                ((hx1, hy1), (hx0, hy1), (0, -1)), ((hx0, hy1), (hx0, hy0), (1, 0))]
            for p, q, nn in edges:
                if not small and _is_stair_top(P, p, q):
                    continue          # the stair's top riser + landing nosing close this edge
                axis = 'x' if p[0] == q[0] else 'y'
                val = p[0] if axis == 'x' else p[1]
                lo, hi = sorted((p[1], q[1]) if axis == 'x' else (p[0], q[0]))
                on_wall = _edge_has_wall(segs, axis, val, lo, hi)
                if small:
                    mat, za, zb = 'cast_iron', z_bot, z_top
                elif on_wall:
                    mat, za, zb = r['wallMat'], z_bot + EXT, z_top - EXT
                else:
                    mat, za, zb = 'trim_chipped', z_bot, z_top
                A, B = v3(p, za), v3(q, za)
                facing(M, [A, B, B + UP * (zb - za), A + UP * (zb - za)], Vector((*nn, 0)), mat)


def _is_stair_top(P, p, q):
    for st in P.stairs.values():
        sg = StairGeo(st, P.floors)
        if st.get('winder'):
            continue
        top = (sg.start[0] + sg.f[0] * (sg.n - 1) * sg.td, sg.start[1] + sg.f[1] * (sg.n - 1) * sg.td)
        if abs(sg.f[1]) > 0.5 and abs(p[1] - q[1]) < 1e-6 and abs(p[1] - top[1]) < 0.05:
            return True
        if abs(sg.f[0]) > 0.5 and abs(p[0] - q[0]) < 1e-6 and abs(p[0] - top[0]) < 0.05:
            return True
    return False


def ceiling_steps(P, meshes):
    """Vertical face where two rooms meet without a wall at different ceiling heights (U4 shaft / U4T landing)."""
    ids = [r for r in P.rooms if P.rooms[r]['kind'] == 'interior']
    for a in ids:
        for b in ids:
            ra, rb = P.rooms[a], P.rooms[b]
            za, zb = P.room_z(a)[1], P.room_z(b)[1]
            if a >= b or abs(za - zb) < 0.05:
                continue
            hi, lo = (a, b) if za > zb else (b, a)
            rh, rl = P.rooms[hi]['rect'], P.rooms[lo]['rect']
            z_lo, z_hi = min(za, zb), max(za, zb)
            if P.room_z(hi)[0] > z_lo or P.room_z(lo)[0] > z_lo:
                pass
            # shared vertical edge x = const
            for xh, xl, nx in ((rh[2], rl[0], -1), (rh[0], rl[2], 1)):
                if abs(xh - xl) < 0.02:
                    y0, y1 = max(rh[1], rl[1]), min(rh[3], rl[3])
                    if y1 - y0 > 0.1 and not _edge_has_wall(P.face_segments(hi), 'x', xh, y0, y1):
                        A = Vector((xh, y0, z_lo - EXT))
                        B = Vector((xh, y1, z_lo - EXT))
                        facing(meshes[hi], [A, B, B + UP * (z_hi - z_lo + 2 * EXT), A + UP * (z_hi - z_lo + 2 * EXT)],
                               Vector((nx, 0, 0)), P.rooms[hi]['ceilingMat'])


def above_soffit(P, parent, S, M, soffit):
    """Wall strip of the parent room above the stair soffit on a nested room's wall plane (hall wallpaper)."""
    z0, z1 = P.room_z(parent)
    zhi = z1 + EXT
    L = S['length']
    xs = splits(-0.08, L + 0.08, [], 0.25)      # reach over the partition ends to the parent's own corners
    n = Vector((S['n'][0], S['n'][1], 0))
    keep = []
    for s_ in xs:
        p = seg_point(S, s_, 0)
        keep.append((s_, soffit(p.x, p.y)))
    for i in range(len(keep) - 1):
        (sa, za), (sb, zb) = keep[i], keep[i + 1]
        if za >= zhi - 1e-4 and zb >= zhi - 1e-4:
            continue
        za, zb = min(za, zhi), min(zb, zhi)
        pts = [seg_point(S, sa, za), seg_point(S, sb, zb), seg_point(S, sb, zhi), seg_point(S, sa, zhi)]
        mat = P.rooms[parent]['wallMat']
        # only the wall planes shared with the parent (the exterior wall), not the partitions themselves
        if S['wall'][('left' if S['side'] == 'right' else 'right')] in ('exterior', 'void') or \
                S['wall']['left'] == 'exterior' or S['wall']['right'] == 'exterior':
            facing(M, pts, n, mat)


def build_rooms(P, meshes, soffits):
    for rid, r in P.rooms.items():
        if r['kind'] != 'interior':
            continue
        M = meshes[rid]
        under_stair = rid == 'CLOSET'
        for chain, closed in P.chains(rid):
            for S in chain:
                if under_stair:
                    S['clip'] = 'ST_MAIN'       # walls stop at the soffit; above it they belong to the hall
                wall_face(P, rid, S, M, soffit=soffits.get(S['clip']))
                if under_stair and r.get('within') in meshes:
                    above_soffit(P, r['within'], S, meshes[r['within']], soffits['ST_MAIN'])
        extra = []
        if rid == 'CLOSET':
            # the main stair's soffit IS the closet ceiling up to the landing edge
            st = StairGeo(P.stairs['ST_MAIN'], P.floors)
            top_y = st.start[1] + (st.n - 1) * st.td
            x0, y0, x1, y1 = r['rect']
            extra.append((x0 - 0.2, y0 - 0.2, x1 + 0.2, top_y))
        floor_and_ceiling(P, rid, M, extra)
    hole_liners(P, meshes)
    ceiling_steps(P, meshes)
