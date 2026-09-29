"""Collision proxies -> collision.glb: simple convex boxes / prisms, joined per (kind, room), with extras
{collider: wall|floor|slab|stair|porch|rail|chimney|foundation, room, surface?}.

Walls are solid full-thickness boxes around door and arch openings (windows and passthroughs stay solid; door
leaves are dynamic and collide at runtime). Stairs: ST_MAIN is a ramp through the nosings plus a rail blocker;
ST_BACK is one prism per tread (kite winders) so the capsule steps up. Nothing here is rendered.
"""
import math

from mathutils import Vector

from .geom import Mesh, prism
from .plan import StairGeo, main_soffit
from .geom import subtract_intervals

UP = Vector((0, 0, 1))


def _convex(M, v, f):
    """Add a convex solid with every face wound outward (the capsule solver uses triangle normals)."""
    from .geom import newell
    c = sum(v, Vector()) / len(v)
    out = []
    for face in f:
        pts = [v[i] for i in face]
        fc = sum(pts, Vector()) / len(pts)
        if newell(pts).dot(fc - c) < 0:
            face = list(reversed(face))
        out.append(face)
    M.piece(v, out, None, loop_uvs=[[(0, 0)] * len(ff) for ff in out])


def _box(M, mn, mx):
    x0, y0, z0 = mn
    x1, y1, z1 = mx
    if x1 - x0 < 1e-4 or y1 - y0 < 1e-4 or z1 - z0 < 1e-4:
        return
    v = [Vector(p) for p in ((x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                             (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))]
    f = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    _convex(M, v, f)


def _prism(M, poly, o, S, T, depth):
    """Convex polygon (s,t) in frame o,S,T extruded along S x T."""
    W = S.cross(T).normalized()
    n = len(poly)
    base = [o + S * p[0] + T * p[1] for p in poly]
    top = [b + W * depth for b in base]
    v = base + top
    f = [list(reversed(range(n))), [n + i for i in range(n)]]
    for i in range(n):
        j = (i + 1) % n
        f.append([i, j, n + j, n + i])
    _convex(M, v, f)


class Coll:
    def __init__(self):
        self.m = {}

    def get(self, kind, room, **extra):
        k = (kind, room)
        if k not in self.m:
            self.m[k] = Mesh(f'col_{kind}_{room}', collider=kind, room=room, **extra)
            self.m[k].smooth = False
        return self.m[k]


def build(P):
    C = Coll()
    # ---------------------------------------------------------------- walls
    for w in P.walls:
        a, b, d, nl, L = P.wall_frame(w)
        t = w['thickness']
        room = w['left'] if w['left'] not in ('exterior', 'void') else w['right']
        M = C.get('wall', room if room not in ('exterior', 'void') else 'EXT2')
        z0, z1 = w['base'], w['base'] + w['height']
        cuts = []
        for o in w['openings']:
            if o['kind'] in ('door', 'arch'):
                cuts.append((o['offset'] - o['width'] / 2, o['offset'] + o['width'] / 2, z0 + o['sill'],
                             z0 + o['sill'] + o['height']))
        # full-height pieces between openings
        spans = subtract_intervals(0.0, L, [(c[0], c[1]) for c in cuts])
        pieces = [(s0, s1, z0, z1) for s0, s1 in spans]
        for c in cuts:  # lintel above each opening
            pieces.append((c[0], c[1], c[3], z1))
        for s0, s1, za, zb in pieces:
            if zb - za < 1e-3:
                continue
            if w.get('clipToStair'):
                # partition under the stair: sloped top following the soffit
                S = Vector((d[0], d[1], 0))
                o = Vector((a[0], a[1], 0)) + S * s0 - Vector((nl[0], nl[1], 0)) * (t / 2)
                pts = []
                for s in (s0, s1):
                    p = Vector((a[0], a[1], 0)) + S * s
                    pts.append((s - s0, min(zb, main_soffit(P, p.x, p.y) - 0.02)))
                poly = [(0, za), (s1 - s0, za), (s1 - s0, max(za + 0.05, pts[1][1])), (0, max(za + 0.05, pts[0][1]))]
                _prism(M, poly, o, S, UP, t) if S.cross(UP).dot(Vector((nl[0], nl[1], 0))) > 0 else \
                    _prism(M, poly, o + Vector((nl[0], nl[1], 0)) * t, S, UP, t)
                continue
            p = Vector((a[0] + d[0] * s0, a[1] + d[1] * s0, 0))
            q = Vector((a[0] + d[0] * s1, a[1] + d[1] * s1, 0))
            n = Vector((nl[0], nl[1], 0)) * (t / 2)
            xs = [p.x + n.x, p.x - n.x, q.x + n.x, q.x - n.x]
            ys = [p.y + n.y, p.y - n.y, q.y + n.y, q.y - n.y]
            _box(M, (min(xs), min(ys), za), (max(xs), max(ys), zb))
    # ---------------------------------------------------------------- floors + slabs
    for rid, r in P.rooms.items():
        if r['kind'] != 'interior':
            continue
        z0, z1 = P.room_z(rid)
        x0, y0, x1, y1 = r['rect']
        holes = [tuple(h) for h in r['floorHoles']]
        M = C.get('floor', rid)
        xs = sorted({x0, x1} | {h[0] for h in holes if x0 < h[0] < x1} | {h[2] for h in holes if x0 < h[2] < x1})
        ys = sorted({y0, y1} | {h[1] for h in holes if y0 < h[1] < y1} | {h[3] for h in holes if y0 < h[3] < y1})
        for i in range(len(xs) - 1):
            for j in range(len(ys) - 1):
                cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
                if any(h[0] < cx < h[2] and h[1] < cy < h[3] for h in holes):
                    continue
                _box(M, (xs[i] - 0.02, ys[j] - 0.02, z0 - 0.12), (xs[i + 1] + 0.02, ys[j + 1] + 0.02, z0))
    fx0, fy0, fx1, fy1 = P.footprint()
    # ---------------------------------------------------------------- stairs
    sg = StairGeo(P.stairs['ST_MAIN'], P.floors)
    M = C.get('stair', 'G1', stair='ST_MAIN')
    a_top = (sg.n - 1) * sg.td
    x0, x1 = sg.start[0] - sg.w / 2, sg.start[0] + sg.w / 2
    ramp = [(0.0, sg.z0), (a_top, sg.z1), (a_top, sg.z1 - 0.25), (0.25, sg.z0)]
    _prism(M, [(sg.start[1] + a, z) for a, z in ramp], Vector((x0, 0, 0)), Vector((0, 1, 0)), UP, x1 - x0)
    M = C.get('rail', 'G1')
    rail = [(-0.1, sg.z0), (a_top, sg.z1 - 0.05), (a_top, sg.z1 + 1.0), (-0.1, sg.z0 + 1.1)]
    _prism(M, [(sg.start[1] + a, z) for a, z in rail], Vector((x1, 0, 0)), Vector((0, 1, 0)), UP, 0.1)
    st = P.stairs['ST_BACK']
    bg = StairGeo(st, P.floors)
    M = C.get('stair', 'U4', stair='ST_BACK')
    sx, sy = bg.start
    w = bg.w
    xa, xb, ya, yb = sx - w / 2, sx + w / 2, sy, sy + w
    piv = (xa, ya)
    kites = [
        [piv, (xb, ya), (xb, ya + w * math.tan(math.radians(30)))],
        [piv, (xb, ya + w * math.tan(math.radians(30))), (xb, yb), (xa + w / math.tan(math.radians(60)), yb)],
        [piv, (xa + w / math.tan(math.radians(60)), yb), (xa, yb)]]
    for k, poly in enumerate(kites, start=1):
        zt = bg.z0 + k * bg.rh
        _prism(M, poly, Vector((0, 0, bg.z0 - 0.05)), Vector((1, 0, 0)), Vector((0, 1, 0)), zt - bg.z0 + 0.05)
    for k in range(4, bg.n):
        xr = xa - (k - 4) * bg.td
        zt = bg.z0 + k * bg.rh
        _box(M, (xr - bg.td, ya, bg.z0 - 0.05), (xr, yb, zt))
    # ---------------------------------------------------------------- porch, steps, rails, chimney, foundation
    pr = next(p for p in P.L['props'] if p['type'] == 'porch')
    q = pr['params']
    cx, cy = pr['pos'][0], pr['pos'][1]
    px0, px1 = cx - q['width'] / 2, cx + q['width'] / 2
    py0, py1 = cy - q['depth'] / 2, cy + q['depth'] / 2
    dz = q['deckZ']
    M = C.get('porch', 'EXT2', surface='porch_wood')
    _box(M, (px0, py0, dz - 0.3), (px1, py1, dz))
    sxc, sw, ns = q['stepsCentreX'], q['stepsWidth'], q['steps']
    M = C.get('stair', 'EXT2', stair='porch_steps')
    ramp = [(py0, dz), (py0 - ns * 0.29, 0.0), (py0 - ns * 0.29, -0.2), (py0, -0.2)]
    _prism(M, ramp, Vector((sxc - sw / 2, 0, 0)), Vector((0, 1, 0)), UP, sw)
    M = C.get('rail', 'EXT2')
    y_post = py0 + 0.09
    xs_posts = [px0 + 0.08, sxc - sw / 2 - 0.1, sxc + sw / 2 + 0.1]
    _box(M, (px0, y_post - 0.06, dz), (sxc - sw / 2 - 0.04, y_post + 0.06, dz + 1.0))
    _box(M, (sxc + sw / 2 + 0.04, y_post - 0.06, dz), (px1, y_post + 0.06, dz + 1.0))
    _box(M, (px0, y_post, dz), (px0 + 0.14, py1, dz + 1.0))
    _box(M, (px1 - 0.14, y_post, dz), (px1, py1, dz + 1.0))
    ch = P.L['roof'].get('chimney')
    if ch:
        M = C.get('chimney', 'EXT2')
        ccx, ccy = ch['pos']
        sx_, sy_ = ch['size']
        _box(M, (ccx - sx_ / 2, ccy - sy_ / 2, 0.0), (ccx + sx_ / 2, ccy + sy_ / 2, ch['top']))
    M = C.get('foundation', 'EXT2')
    _box(M, (fx0 - 0.05, fy0 - 0.05, -0.2), (fx1 + 0.05, fy1 + 0.05, 0.6))
    objs = []
    for m in C.m.values():
        if m.F:
            ob = m.to_object()
            objs.append(ob)
    return objs
