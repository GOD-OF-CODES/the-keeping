"""The two stairs: ST_MAIN (hall, open string on the right, turned balusters, moulded handrail, newels) and ST_BACK
(enclosed servants' stair: 3 kite winders then a straight flight west, rough boards, pole handrail).

Numbers come from level-layout.json via plan.StairGeo: riser i (1-based) stands at along = (i-1)*treadDepth,
tread i top = z0 + i*riserHeight; riser n lands on the upper floor.
"""
import math

from mathutils import Matrix, Vector

from .geom import box, lathe, prism, sweep, quarter, dedupe
from .plan import StairGeo

NOSING = 0.028
TREAD_T = 0.03
RISER_T = 0.02


def _pt(sg, along, across, z):
    return Vector((sg.start[0] + sg.f[0] * along + sg.r[0] * across,
                   sg.start[1] + sg.f[1] * along + sg.r[1] * across, z))


def tread_profile(back, front, ztop, t=TREAD_T, nose=NOSING):
    """(along, z) polygon of a tread whose bullnose projects `nose` in front of `front` (toward -along)."""
    r = t / 2
    cx = front - nose + r
    pts = [(back, ztop - t), (cx, ztop - t)]
    for k in range(1, 6):
        a = -math.pi / 2 - math.pi * k / 6
        pts.append((cx + r * math.cos(a), ztop - r + r * math.sin(a)))
    pts += [(cx, ztop), (back, ztop)]
    return dedupe(pts)


def _prism_flip(M, sg, poly_af, across0, across1, mat, bevel):
    # frame with S = along, T = up gives normal S x T = -r (for f=(0,1): (0,1,0)x(0,0,1) = (1,0,0) = +x = r!)
    o = _pt(sg, 0, across0, 0)
    S = Vector((sg.f[0], sg.f[1], 0))
    T = Vector((0, 0, 1))
    prism(M, poly_af, o, S, T, across1 - across0, mat, bevel=bevel)


def band_poly(y0, y1, top_fn, bot_fn, zmin=None, zmax=None, n=2):
    """Polygon (along, z) between two straight lines over [y0, y1], clipped to zmin/zmax."""
    from .geom import clip_poly
    poly = [(y0, bot_fn(y0)), (y1, bot_fn(y1)), (y1, top_fn(y1)), (y0, top_fn(y0))]
    if zmin is not None:
        poly = clip_poly(poly, 0, -1, -zmin)
    if zmax is not None:
        poly = clip_poly(poly, 0, 1, zmax)
    return poly


# ------------------------------------------------------------------------------------------------ main stair
def main_stair(P, M, Mu=None, rail_side_extra=0.1):
    sg = StairGeo(P.stairs['ST_MAIN'], P.floors)
    n, rh, td, w = sg.n, sg.rh, sg.td, sg.w
    z0 = sg.z0
    a_left, a_right = -w / 2, w / 2                       # tread extent across (wall side = left)
    s_in, s_out = a_right, a_right + rail_side_extra      # outer string (right side)
    top_along = (n - 1) * td
    nose = lambda a: sg.nosing_z(a)  # noqa: E731
    # treads 1..n-1, risers 1..n-1 (riser n = landing edge, built as a nosing + liner)
    for i in range(1, n):
        a0 = (i - 1) * td                     # nosing line of step i
        zt = z0 + i * rh
        _prism_flip(M, sg, tread_profile(a0 + td + NOSING + RISER_T, a0 + NOSING, zt), a_left - 0.012, s_in + 0.012,
                    'stair_treads', bevel=0.002)
        zb = z0 + (i - 1) * rh
        box(M, _pt_min(sg, a0 + NOSING, a_left - 0.01, zb, a0 + NOSING + RISER_T, s_in + 0.01, zt - TREAD_T),
            _pt_max(sg, a0 + NOSING, a_left - 0.01, zb, a0 + NOSING + RISER_T, s_in + 0.01, zt - TREAD_T),
            'trim_chipped', bevel=0.001)
        # scotia under the nosing
        pa = _pt(sg, a0 + NOSING, s_in, zt - TREAD_T)
        pb = _pt(sg, a0 + NOSING, a_left, zt - TREAD_T)
        sweep(M, [pa, pb], [(0.0, 0.0), (0.0, -0.016), (0.0045, -0.0115), (0.009, -0.007), (0.0125, -0.0035),
                            (0.016, 0.0)], 'trim_chipped', side_sign=1.0)
    # landing edge nosing (top of riser n) + riser n
    a_top = top_along
    zt = z0 + n * rh
    _prism_flip(M, sg, tread_profile(a_top + 0.14, a_top + NOSING, zt), a_left - 0.012, s_out + 0.02,
                'stair_treads', bevel=0.002)
    zb = z0 + (n - 1) * rh
    box(M, _pt_min(sg, a_top + NOSING, a_left - 0.01, zb, a_top + NOSING + RISER_T, s_in, zt - TREAD_T),
        _pt_max(sg, a_top + NOSING, a_left - 0.01, zb, a_top + NOSING + RISER_T, s_in, zt - TREAD_T),
        'trim_chipped', bevel=0.001)
    # wall string (left, against the wall)
    y0 = -0.25
    poly = band_poly(y0, a_top + 0.05, lambda a: nose(a) + 0.075, lambda a: nose(a) - 0.23, zmin=z0,
                     zmax=zt + 0.075)
    _prism_flip(M, sg, poly, a_left - 0.004, a_left + 0.022, 'stair_treads', bevel=0.003)
    # outer (closed) string on the right: bottom follows the soffit
    newel_a = -0.09
    poly = band_poly(newel_a, a_top, lambda a: nose(a) + 0.09, lambda a: nose(a) - 0.30, zmin=z0)
    _prism_flip(M, sg, poly, s_in, s_out, 'stair_treads', bevel=0.004)
    # string cap (small moulding along the top edge)
    capz = lambda a: nose(a) + 0.09  # noqa: E731
    ca, cb = newel_a + 0.06, a_top - 0.06
    pa = _pt(sg, ca, (s_in + s_out) / 2, capz(ca))
    pb = _pt(sg, cb, (s_in + s_out) / 2, capz(cb))
    sweep(M, [pa, pb], [(-0.058, 0.0), (0.058, 0.0), (0.058, 0.012), (0.05, 0.02), (-0.05, 0.02),
                        (-0.058, 0.012)], 'stair_treads', up=Vector((0, 0, 1)), side_sign=1.0, closed_profile=True)
    # soffit (underside) - also the closet ceiling
    soff = lambda a: nose(a) - 0.30  # noqa: E731
    a_floor = (z0 + 0.0 - (z0 + rh - 0.30)) / (rh / td)
    a_floor = max(a_floor, 0.0)
    p0 = _pt(sg, a_floor, a_left - 0.02, z0)
    p1 = _pt(sg, a_top, a_left - 0.02, soff(a_top))
    p2 = _pt(sg, a_top, s_in, soff(a_top))
    p3 = _pt(sg, a_floor, s_in, z0)
    from .rooms import facing
    facing(M, [p0, p1, p2, p3], Vector((0, 0, -1)), 'stair_rough', grain='y')
    # balusters (2 per tread) on the string cap, handrail, newels
    rail_across = (s_in + s_out) / 2
    rail_top = lambda a: nose(a) + 0.88  # noqa: E731
    for i in range(1, n):
        for k in (0.25, 0.75):
            a = (i - 1) * td + k * td
            zb_ = capz(a) + 0.015
            zt_ = rail_top(a) - 0.05
            baluster(M.d, _pt(sg, a, rail_across, zb_), zt_ - zb_)
    handrail(M, _pt(sg, newel_a + 0.02, rail_across, rail_top(newel_a + 0.02)),
             _pt(sg, a_top + 0.02, rail_across, rail_top(a_top + 0.02)))
    newel(M, _pt(sg, newel_a, rail_across, z0), height=1.22, drop=None)
    newel(M, _pt(sg, a_top + 0.07, rail_across + 0.01, sg.z1), height=1.06)
    return sg


def _pt_min(sg, a0, c0, z0, a1, c1, z1):
    p, q = _pt(sg, a0, c0, z0), _pt(sg, a1, c1, z1)
    return Vector((min(p.x, q.x), min(p.y, q.y), min(p.z, q.z)))


def _pt_max(sg, a0, c0, z0, a1, c1, z1):
    p, q = _pt(sg, a0, c0, z0), _pt(sg, a1, c1, z1)
    return Vector((max(p.x, q.x), max(p.y, q.y), max(p.z, q.z)))


BALUSTER_PROFILE = [  # (r, z) normalised to height 1 (turned section only)
    (0.0145, 0.00), (0.0175, 0.02), (0.0175, 0.05), (0.013, 0.08), (0.011, 0.12), (0.0145, 0.22),
    (0.0185, 0.34), (0.019, 0.42), (0.016, 0.52), (0.012, 0.64), (0.0105, 0.80), (0.0125, 0.9),
    (0.015, 0.95), (0.015, 1.0)]


def baluster(M, base, height, mat='trim_chipped', block=0.036):
    blo = min(0.13, height * 0.18)
    bhi = min(0.09, height * 0.12)
    h = block / 2
    box(M, base + Vector((-h, -h, -0.02)), base + Vector((h, h, blo)), mat, bevel=0.003)
    box(M, base + Vector((-h, -h, height - bhi)), base + Vector((h, h, height + 0.02)), mat, bevel=0.003)
    mid = height - blo - bhi
    prof = [(r, blo + z * mid) for r, z in BALUSTER_PROFILE]
    lathe(M, prof, base, mat, segs=10, cap=False)


RAIL_PROFILE = [  # closed (x across, y up) around the rail centre line; top of the rail at y = 0
    (-0.022, -0.055), (0.022, -0.055), (0.024, -0.045), (0.026, -0.036), (0.034, -0.03), (0.036, -0.02),
    (0.034, -0.009), (0.027, -0.002), (0.014, 0.0), (-0.014, 0.0), (-0.027, -0.002), (-0.034, -0.009),
    (-0.036, -0.02), (-0.034, -0.03), (-0.026, -0.036), (-0.024, -0.045)]


def handrail(M, a, b, mat='stair_treads'):
    sweep(M, [a, b], RAIL_PROFILE, mat, up=Vector((0, 0, 1)), side_sign=1.0, closed_profile=True)


def newel(M, base, height=1.2, drop=None, mat='stair_treads', size=0.12):
    h = size / 2
    zt = base.z + height
    zb = base.z - (drop or 0.0)
    # plinth, shaft with sunk panels, cap, ball
    box(M, Vector((base.x - h - 0.015, base.y - h - 0.015, zb)),
        Vector((base.x + h + 0.015, base.y + h + 0.015, base.z + 0.18 if not drop else zb + 0.05)), mat,
        bevel=0.006, segs=2)
    box(M, Vector((base.x - h, base.y - h, zb)), Vector((base.x + h, base.y + h, zt - 0.07)), mat, bevel=0.008,
        segs=2)
    from .geom import oriented_box
    pz0, pz1 = (base.z + 0.28), (zt - 0.2)
    for nx, ny in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nrm = Vector((nx, ny, 0))
        tan = Vector((-ny, nx, 0))
        c = Vector((base.x, base.y, (pz0 + pz1) / 2)) + nrm * (h + 0.0015)
        oriented_box(M, c, nrm, tan, Vector((0, 0, 1)), 0.0035, h - 0.028, (pz1 - pz0) / 2, mat, bevel=0.0025)
    box(M, Vector((base.x - h - 0.022, base.y - h - 0.022, zt - 0.075)),
        Vector((base.x + h + 0.022, base.y + h + 0.022, zt - 0.04)), mat, bevel=0.008, segs=2)
    ball = [(0.0, 0.0), (0.03, 0.0), (0.03, 0.012), (0.018, 0.02), (0.014, 0.03), (0.03, 0.05), (0.042, 0.075),
            (0.045, 0.1), (0.04, 0.125), (0.028, 0.145), (0.012, 0.155), (0.0, 0.157)]
    lathe(M, ball, Vector((base.x, base.y, zt - 0.04)), mat, segs=16, cap=False)
    if drop:
        pend = [(0.0, -0.1), (0.012, -0.098), (0.028, -0.085), (0.035, -0.06), (0.03, -0.035), (0.04, -0.012),
                (0.04, 0.0)]
        lathe(M, pend, Vector((base.x, base.y, zb)), mat, segs=16, cap=False)


# ------------------------------------------------------------------------------------------------ back stair
def back_stair(P, M):
    st = P.stairs['ST_BACK']
    sg = StairGeo(st, P.floors)
    n, rh, td, w = sg.n, sg.rh, sg.td, sg.w
    z0 = sg.z0
    sx, sy = sg.start
    x0, x1 = sx - w / 2, sx + w / 2          # winder square
    y0, y1 = sy, sy + w
    piv = (x0, y0)
    mat_t, mat_r = 'stair_rough', 'stair_rough'
    # kite treads 1..3 (rays from the pivot at 0, 30, 60, 90 degrees)
    def ray_end(deg):
        a = math.radians(deg)
        if deg <= 45:
            return (x1, y0 + w * math.tan(a))
        return (x0 + w / math.tan(a) if deg < 90 else x0, y1)
    rays = [0, 30, 60, 90]
    for k in range(1, 4):
        a0, a1 = rays[k - 1], rays[k]
        e0, e1 = ray_end(a0), ray_end(a1)
        poly = [piv, e0]
        if a0 < 45 < a1:
            poly.append((x1, y1))
        poly.append(e1)
        # nosing: push the front edge (ray a0) outward along its normal
        na = math.radians(a0) - math.pi / 2
        nv = (math.cos(na) * 0.02, math.sin(na) * 0.02)
        poly2 = [(poly[0][0] + nv[0], poly[0][1] + nv[1]), (poly[1][0] + nv[0], poly[1][1] + nv[1])] + poly[2:]
        zt = z0 + k * rh
        prism(M, poly2, Vector((0, 0, zt - TREAD_T)), Vector((1, 0, 0)), Vector((0, 1, 0)), TREAD_T, mat_t,
              bevel=0.003)
        # riser under the front edge
        zb = z0 + (k - 1) * rh
        _riser_along(M, piv, e0, zb, zt - TREAD_T, mat_r, inward=(math.cos(na + math.pi), math.sin(na + math.pi)))
    # straight flight west: riser k at x = x0 - (k-4)*td
    for k in range(4, n):
        xr = x0 - (k - 4) * td
        zt = z0 + k * rh
        zb = z0 + (k - 1) * rh
        box(M, (xr - td - 0.015, y0 - 0.01, zt - TREAD_T), (xr + 0.02, y1 + 0.01, zt), mat_t, bevel=0.003)
        box(M, (xr - RISER_T, y0 - 0.005, zb), (xr, y1 + 0.005, zt - TREAD_T), mat_r, bevel=0.001)
    xr_top = x0 - (n - 4) * td
    zt = z0 + n * rh
    box(M, (xr_top - 0.1, y0 - 0.01, zt - TREAD_T), (xr_top + 0.02, y1 + 0.01, zt + 0.004), mat_t, bevel=0.003)
    box(M, (xr_top - RISER_T, y0, z0 + (n - 1) * rh), (xr_top, y1, zt - TREAD_T), mat_r, bevel=0.001)
    # wall strings along the straight flight (both walls)
    nose = lambda x: z0 + 4 * rh + (x0 - x) * (rh / td)  # noqa: E731  (nosing line of the straight run)
    for ya, yb in ((y0 - 0.004, y0 + 0.022), (y1 - 0.022, y1 + 0.004)):
        xa, xb = xr_top - 0.02, x0 + 0.02
        poly = [(xa, nose(xa) - 0.25), (xb, nose(xb) - 0.25), (xb, nose(xb) + 0.07), (xa, nose(xa) + 0.07)]
        prism(M, poly, Vector((0, yb, 0)), Vector((1, 0, 0)), Vector((0, 0, 1)), yb - ya, mat_t, bevel=0.003)
    # pole handrail on iron brackets along the north wall
    ry = y1 - 0.075
    ra = Vector((x0 - 0.1, ry, nose(x0 - 0.1) + 0.86))
    rb = Vector((xr_top + 0.15, ry, nose(xr_top + 0.15) + 0.86))
    from .geom import cylinder_between
    cylinder_between(M, ra, rb, 0.022, 'wood_raw_plank', segs=10)
    for t in (0.1, 0.5, 0.9):
        p = ra.lerp(rb, t)
        cylinder_between(M, p - Vector((0, 0, 0.035)), Vector((p.x, y1 + 0.005, p.z - 0.035)), 0.007, 'cast_iron',
                         segs=6)
        cylinder_between(M, p - Vector((0, 0, 0.02)), p - Vector((0, 0, 0.045)), 0.008, 'cast_iron', segs=6)
    return sg


def _riser_along(M, a, b, zb, zt, mat, inward):
    """Riser board along the plan segment a->b, set back `RISER_T` toward `inward`."""
    A = Vector((a[0], a[1], zb))
    B = Vector((b[0], b[1], zb))
    d = (B - A)
    L = d.length
    x = d.normalized()
    y = Vector((inward[0], inward[1], 0)).normalized()
    z = Vector((0, 0, 1))
    if x.cross(y).dot(z) < 0:
        y = -y
        m = Matrix(((x.x, y.x, z.x, A.x), (x.y, y.y, z.y, A.y), (0, 0, 1, A.z), (0, 0, 0, 1)))
        box(M, (0, -RISER_T, 0), (L, 0, zt - zb), mat, bevel=0.001, matrix=m)
    else:
        m = Matrix(((x.x, y.x, z.x, A.x), (x.y, y.y, z.y, A.y), (0, 0, 1, A.z), (0, 0, 0, 1)))
        box(M, (0, 0, 0), (L, RISER_T, zt - zb), mat, bevel=0.001, matrix=m)
