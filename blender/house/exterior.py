"""Exterior shell: facades (real clapboard lap geometry on EVERY facade), corner boards, water table,
frieze, boxed eaves with returns, gable rakes, wood-shingle roof courses, ridge cap, gutters + downspouts,
exterior brick chimney, stone foundation, porch (deck, frame, steps, posts, railings, lattice, shed roof).
"""
import math
import random

from mathutils import Vector

from .geom import (Mesh, box, clip_poly, cylinder_between, dedupe, lathe, oriented_box, plane_with_holes, prism,
                   subtract_intervals, sweep)
from .rooms import facing
from .plan import dot, sub

UP = Vector((0, 0, 1))
SIDING_T = 0.02          # clapboard butt thickness (proud of the sheathing plane)
CASING_T = 0.03          # exterior casings stand proud of the siding
EXPOSURE = 0.10          # board exposure == material-spec clapboard_peeling boardExposure (tile 3 m -> 30 rows)
SIDING_Z0 = 0.83         # bottom of the first course (top of the water table); every course starts at Z0 + k*EXPOSURE
DRIP_CH = 0.004          # 45-degree drip chamfer on each board's bottom front edge (catches a highlight over the shadow)
# Lightmap: the siding's planar chart is stretched in v (height) so the bake resolves each 10 cm course with ~4 texels
# at 1024 (2 at the 512 Low tier): the dark band under every butt and the lit drip edge are IN the lightmap, not only
# in the albedo. u (along the facade) keeps the atlas density. Costs ~15 % of LM_EXTERIOR's density elsewhere.
LM_V_STRETCH = 2.5
FACADE_TAG = {(0, -1): 'S', (1, 0): 'E', (0, 1): 'N', (-1, 0): 'W'}


def clapboard_v(z):
    """Blender UV v for clapboard at height z. The glTF exporter writes 1 - v, and the runtime generators see that
    value (baker.ts: generator uv == sampling uv), so runtime uv.y = z - SIDING_Z0: it increases UPWARD and every
    course bottom (drip edge, t = 0 in the clapboard generator) lands exactly on a row boundary."""
    return 1.0 - (z - SIDING_Z0)


def clapboard_uvs(M, mid='clapboard_peeling'):
    """Re-map the box UVs (u along the facade, v = z) of every clapboard face of M to the clapboard convention."""
    if mid not in M.mats:
        return
    k = M.mats.index(mid)
    for i, fm in enumerate(M.FM):
        if fm == k:
            M.LUV[i] = [(u, clapboard_v(v)) for (u, v) in M.LUV[i]]


class Roof:
    """Gable roof numbers (ridge along y)."""

    def __init__(self, P):
        R = P.L['roof']
        self.R = R
        fx0, fy0, fx1, fy1 = P.footprint()
        self.fx0, self.fy0, self.fx1, self.fy1 = fx0, fy0, fx1, fy1
        self.xr = (fx0 + fx1) / 2
        self.eave = R['eaveZ']
        self.ridge = R['ridgeZ']
        self.over = R['overhang']
        self.rake = 0.30
        self.half = self.xr - fx0
        self.tan = (self.ridge - self.eave) / self.half
        self.pitch = math.atan(self.tan)
        self.lift = 0.22            # shingle surface above the wall plate line
        self.y0 = fy0 - self.rake
        self.y1 = fy1 + self.rake

    def z_surface(self, x):
        """Top (shingle) surface height at plan x."""
        return self.ridge + self.lift - abs(x - self.xr) * self.tan

    def z_gable(self, x):
        """Height of the gable wall top (under the rake board) at plan x."""
        return self.ridge - abs(x - self.xr) * self.tan


def openings_on_plane(P, fp):
    """[(opening, s_centre, z0, z1, wall)] in facade coordinates."""
    out = []
    for o, s, base, w in fp['openings']:
        z0 = w['base'] + o['sill']
        out.append((o, s, z0, z0 + o['height'], w))
    return out


def casing_rect(o, s, z0, z1):
    """Exterior trim footprint around an opening (s0, z0, s1, z1)."""
    if o['kind'] == 'passthrough':
        return (s - o['width'] / 2, z0, s + o['width'] / 2, z1)
    cw = 0.115 if o['kind'] == 'window' else 0.16
    below = 0.06 if o['kind'] == 'window' else 0.0
    head = 0.17 if o['kind'] == 'window' else 0.30
    return (s - o['width'] / 2 - cw, z0 - below, s + o['width'] / 2 + cw, z1 + head)


def fp_point(fp, s, z, out=0.0):
    o, d, n = fp['origin'], fp['dir'], fp['n']
    return Vector((o[0] + d[0] * s + n[0] * out, o[1] + d[1] * s + n[1] * out, z))


def facade_flat(P, fp, M, roof):
    """Plain facade face (fog facades): the sheathing plane itself carries the clapboard material."""
    ops = openings_on_plane(P, fp)
    n = Vector((fp['n'][0], fp['n'][1], 0))
    d = Vector((fp['dir'][0], fp['dir'][1], 0))
    holes = [(s - o['width'] / 2, z0, s + o['width'] / 2, z1) for o, s, z0, z1, w in ops]
    # frame: origin at s=0, S = dir, T = up -> normal = dir x up = ... dir=(-n.y, n.x): d x up = (n.x, n.y) = n
    o = fp_point(fp, 0, 0)
    plane_with_holes(M, (o, d, UP), fp['s0'], fp['s1'], fp['z0'], fp['z1'], holes, 'clapboard_peeling', cell=1.0)
    reveals(M, fp, ops)


def reveals(M, fp, ops):
    n = Vector((fp['n'][0], fp['n'][1], 0))
    d = Vector((fp['dir'][0], fp['dir'][1], 0))
    for o, s, z0, z1, w in ops:
        dd = w['thickness'] / 2
        A = fp_point(fp, s - o['width'] / 2, z0)
        B = fp_point(fp, s + o['width'] / 2, z0)
        h = UP * (z1 - z0)
        back = -n * dd
        facing(M, [A, A + back, A + back + h, A + h], d, 'trim_chipped')
        facing(M, [B, B + back, B + back + h, B + h], -d, 'trim_chipped')
        facing(M, [A + h, B + h, B + h + back, A + h + back], -UP, 'trim_chipped')
        facing(M, [A, B, B + back, A + back], UP, 'trim_chipped' if o['sill'] > 0 else 'porch_boards_wet')


# ------------------------------------------------------------------------------------------------ helpers
def _convex_minus_rect(poly, r):
    """Convex polygon minus axis-aligned rect r=(s0,z0,s1,z1) -> list of convex polygons."""
    s0, z0, s1, z1 = r
    out = []
    left = clip_poly(poly, 1, 0, s0)            # s <= s0
    if len(left) >= 3:
        out.append(left)
    right = clip_poly(poly, -1, 0, -s1)         # s >= s1
    if len(right) >= 3:
        out.append(right)
    mid = clip_poly(clip_poly(poly, -1, 0, -s0), 1, 0, s1)
    if len(mid) >= 3:
        below = clip_poly(mid, 0, 1, z0)       # z <= z0
        above = clip_poly(mid, 0, -1, -z1)     # z >= z1
        for q in (below, above):
            if len(q) >= 3:
                out.append(q)
    return out


def _area(poly):
    a = 0.0
    for i in range(len(poly)):
        p, q = poly[i], poly[(i + 1) % len(poly)]
        a += p[0] * q[1] - q[0] * p[1]
    return a / 2


def facade_region(fp, roof, zmin):
    """Convex (s, z) polygon of a facade's sided area: rectangle up to the eave, gable triangle on gable ends."""
    s0, s1 = fp['s0'], fp['s1']
    gable = abs(fp['n'][0]) < 0.5            # ridge along y -> the y-facing facades are gables
    if not gable:
        return [(s0, zmin), (s1, zmin), (s1, roof.eave - 0.4), (s0, roof.eave - 0.4)], gable
    # s -> x along the gable wall
    def x_of(s):
        return fp['origin'][0] + fp['dir'][0] * s
    zt = lambda s: roof.z_gable(x_of(s)) - 0.17  # noqa: E731
    sr = (roof.xr - fp['origin'][0]) / fp['dir'][0]
    return [(s0, zmin), (s1, zmin), (s1, zt(s1)), (sr, zt(sr)), (s0, zt(s0))], gable


# ------------------------------------------------------------------------------------------------ siding
def hero_siding(P, fp, M, roof, rng, strip=0.8):
    """Real lap siding (every facade): each course a tilted board face + drip chamfer + butt underside; boards
    3-4.8 m with staggered joints, slight warps and sags (the warp shows per `strip` m). Returns nothing; the Mesh
    gets a planar lightmap projection in the facade plane (v stretched by LM_V_STRETCH)."""
    zw = SIDING_Z0
    region, gable = facade_region(fp, roof, zw)
    zmax = max(p[1] for p in region)
    cuts = [casing_rect(o, s, z0, z1) for o, s, z0, z1, w in openings_on_plane(P, fp)]
    n = Vector((fp['n'][0], fp['n'][1], 0))
    verts, faces, luv = [], [], []

    def V_(s, z, out):
        return fp_point(fp, s, z, out)
    c = 0
    zc = zw
    while zc < zmax - 0.01:
        z_top = zc + EXPOSURE
        band = clip_poly(clip_poly(region, 0, -1, -zc), 0, 1, z_top)
        if len(band) < 3:
            zc = z_top
            c += 1
            continue
        pieces = [band]
        for r in cuts:
            nxt = []
            for pc in pieces:
                if min(p[0] for p in pc) >= r[2] or max(p[0] for p in pc) <= r[0] or \
                        min(p[1] for p in pc) >= r[3] or max(p[1] for p in pc) <= r[1]:
                    nxt.append(pc)
                else:
                    nxt.extend(_convex_minus_rect(pc, r))
            pieces = [q for q in nxt if abs(_area(q)) > 1e-5]
        # board joints: staggered every 3..4.8 m
        joints = []
        s = fp['s0'] + rng.uniform(0.3, 3.6)
        while s < fp['s1'] - 0.3:
            joints.append(s)
            s += rng.uniform(3.0, 4.8)
        bounds = [fp['s0'] - 1] + joints + [fp['s1'] + 1]
        for pc in pieces:
            for bi in range(len(bounds) - 1):
                q = clip_poly(clip_poly(pc, -1, 0, -(bounds[bi] + (0.0015 if bi > 0 else 0))), 1, 0,
                              bounds[bi + 1] - (0.0015 if bi < len(bounds) - 2 else 0))
                if len(q) < 3 or abs(_area(q)) < 1e-5:
                    continue
                # per-board warp: butt thickness varies linearly along the board, slight sag of the butt line
                sa, sb = min(p[0] for p in q), max(p[0] for p in q)
                t0 = SIDING_T + rng.uniform(-0.003, 0.004)
                t1 = SIDING_T + rng.uniform(-0.003, 0.004)
                sag = rng.uniform(0.0, 0.003)

                def out_at(s_, z_):
                    u = 0.0 if sb - sa < 1e-6 else (s_ - sa) / (sb - sa)
                    tb = t0 + (t1 - t0) * u
                    h = (z_ - zc) / EXPOSURE
                    return tb + (0.004 - tb) * h

                def z_at(s_, z_):
                    u = 0.0 if sb - sa < 1e-6 else (s_ - sa) / (sb - sa)
                    return z_ - sag * math.sin(math.pi * u) * (1.0 - (z_ - zc) / EXPOSURE)
                # split the piece along s into ~0.8 m strips so the warp shows
                nsplit = max(1, int((sb - sa) / strip))
                for k in range(nsplit):
                    a_ = sa + (sb - sa) * k / nsplit
                    b_ = sa + (sb - sa) * (k + 1) / nsplit
                    qq = clip_poly(clip_poly(q, -1, 0, -a_), 1, 0, b_)
                    if len(qq) < 3 or abs(_area(qq)) < 1e-6:
                        continue
                    if _area(qq) < 0:
                        qq = list(reversed(qq))
                    # the board face starts DRIP_CH above the course bottom; the chamfer closes the corner
                    ch = DRIP_CH if max(p[1] for p in qq) - zc > 3 * DRIP_CH else 0.0

                    def zf(z_):
                        return zc + ch if abs(z_ - zc) < 1e-6 else z_
                    base = len(verts)
                    for (s_, z_) in qq:
                        verts.append(V_(s_, z_at(s_, zf(z_)), out_at(s_, zf(z_))))
                    faces.append(list(range(base, base + len(qq))))
                    luv.append([(s_, clapboard_v(zf(z_))) for (s_, z_) in qq])
                    # drip chamfer + butt underside along edges lying on z = zc
                    from .geom import newell
                    for i in range(len(qq)):
                        p1, p2 = qq[i], qq[(i + 1) % len(qq)]
                        if abs(p1[1] - zc) < 1e-6 and abs(p2[1] - zc) < 1e-6:
                            A = V_(p1[0], z_at(p1[0], zc), out_at(p1[0], zc) - ch)
                            B = V_(p2[0], z_at(p2[0], zc), out_at(p2[0], zc) - ch)
                            if ch > 0:
                                F1 = V_(p1[0], z_at(p1[0], zc + ch), out_at(p1[0], zc + ch))
                                F2 = V_(p2[0], z_at(p2[0], zc + ch), out_at(p2[0], zc + ch))
                                b2 = len(verts)
                                verts += [A, B, F2, F1]
                                faces.append([b2, b2 + 1, b2 + 2, b2 + 3])   # outward fix below (|n.z| ~ 0.7)
                                luv.append([(p1[0], clapboard_v(zc + 0.001)), (p2[0], clapboard_v(zc + 0.001)),
                                            (p2[0], clapboard_v(zc + ch)), (p1[0], clapboard_v(zc + ch))])
                            A2 = V_(p1[0], z_at(p1[0], zc), 0.0035)
                            B2 = V_(p2[0], z_at(p2[0], zc), 0.0035)
                            b2 = len(verts)
                            verts += [A, B, B2, A2]
                            f = [b2, b2 + 1, b2 + 2, b2 + 3]
                            if newell([verts[j] for j in f]).dot(Vector((0, 0, -1))) < 0:
                                f = list(reversed(f))
                            faces.append(f)
                            # the underside is the darkest line of the lap shadow (t 0..0.01)
                            luv.append([(p1[0], clapboard_v(zc)), (p2[0], clapboard_v(zc)),
                                        (p2[0], clapboard_v(zc + 0.001)), (p1[0], clapboard_v(zc + 0.001))])
                            if f[0] != b2:
                                luv[-1] = list(reversed(luv[-1]))
        zc = z_top
        c += 1
    # orient the board faces outward
    from .geom import newell
    fixed_f, fixed_uv = [], []
    for f, uv in zip(faces, luv):
        nn = newell([verts[j] for j in f])
        if abs(nn.z) < 0.9 and nn.dot(n) < 0:
            f, uv = list(reversed(f)), list(reversed(uv))
        fixed_f.append(f)
        fixed_uv.append(uv)
    M.piece(verts, fixed_f, 'clapboard_peeling', loop_uvs=fixed_uv)


# ------------------------------------------------------------------------------------------------ facade trim
def facade_trim(P, fp, M, roof, hero):
    """Water table with drip cap, corner boards, frieze under the eave (side walls)."""
    ops = openings_on_plane(P, fp)
    n = Vector((fp['n'][0], fp['n'][1], 0))
    d = Vector((fp['dir'][0], fp['dir'][1], 0))
    gable = abs(fp['n'][0]) < 0.5
    cuts = []
    for o, s, z0, z1, w in ops:
        if z0 < 0.9:
            r = casing_rect(o, s, z0, z1)
            cuts.append((r[0], r[2]))
    for a, b in subtract_intervals(fp['s0'] + 0.13, fp['s1'] - 0.13, cuts):
        # water table board + sloped drip cap
        _prism_n_z(M, fp, a, b, [(-0.002, 0.6), (0.03, 0.6), (0.03, 0.8), (-0.002, 0.8)], 'trim_chipped')
        _prism_n_z(M, fp, a, b, [(-0.002, 0.8), (0.048, 0.8), (0.048, 0.812), (-0.002, 0.835)], 'trim_chipped')
    # corner boards on both ends of the facade
    ztop = roof.eave - 0.33 if not gable else roof.eave - 0.2
    for s_a, s_b in ((fp['s0'], fp['s0'] + 0.135), (fp['s1'] - 0.135, fp['s1'])):
        _prism_n_z(M, fp, s_a, s_b, [(-0.002, 0.6), (0.034, 0.6), (0.034, ztop), (-0.002, ztop)], 'trim_chipped',
                   bevel=0.004)
    if not gable:
        # frieze board under the soffit
        _prism_n_z(M, fp, fp['s0'] + 0.12, fp['s1'] - 0.12, [(-0.002, roof.soffit_z - 0.24), (0.026,
                   roof.soffit_z - 0.24), (0.026, roof.soffit_z + 0.002), (-0.002, roof.soffit_z + 0.002)],
                   'trim_chipped', bevel=0.003)
    return


def _prism_n_z(M, fp, s0, s1, poly_nz, mat, bevel=0.003):
    """Polygon in (out, z) extruded along the facade from s0 to s1."""
    n = Vector((fp['n'][0], fp['n'][1], 0))
    d = Vector((fp['dir'][0], fp['dir'][1], 0))
    W = n.cross(UP)
    if W.dot(d) > 0:
        prism(M, poly_nz, fp_point(fp, s0, 0.0), n, UP, s1 - s0, mat, bevel=bevel)
    else:
        prism(M, poly_nz, fp_point(fp, s1, 0.0), n, UP, s1 - s0, mat, bevel=bevel)


# ------------------------------------------------------------------------------------------------ roof
def shingle_side(M, roof, side, rng, holes=(), exp=0.185):
    """Wood-shingle courses on one roof side (side -1 = west, +1 = east). Prebuilt planar lightmap chart."""
    p = roof.pitch
    cp, sp = math.cos(p), math.sin(p)
    Dn = Vector((side * cp, 0, -sp))                   # down-slope
    Nr = Vector((side * sp, 0, cp))                    # outward normal
    Y = Vector((0, 1, 0))
    top = Vector((roof.xr, 0, roof.ridge + roof.lift))
    x_edge = roof.fx1 + roof.over + 0.05 if side > 0 else roof.fx0 - roof.over - 0.05
    d_max = abs(x_edge - roof.xr) / cp
    y0, y1 = roof.y0 - 0.04, roof.y1 + 0.04
    verts, faces, luv = [], [], []

    def W(y, d, h):
        return top + Y * y + Dn * d + Nr * h

    def add(pts, uvs):
        base = len(verts)
        verts.extend(pts)
        faces.append(list(range(base, base + len(pts))))
        luv.append(uvs)
    k = 0
    d_k = d_max
    while d_k > 0.02:
        d_up = max(d_k - exp, 0.0)
        top_line = d_up + 0.007 if d_up > 0 else 0.0
        y = y0
        while y < y1 - 0.02:
            wdt = rng.uniform(0.16, 0.42)
            ya, yb = y, min(y + wdt, y1)
            if y1 - yb < 0.08:
                yb = y1
            y = yb
            # clip shingles against the chimney stack (course x-span overlapping the hole): keep the parts beside it
            xa_c = roof.xr + side * cp * max(d_k - exp, 0.0)
            xb_c = roof.xr + side * cp * d_k
            lo_x, hi_x = min(xa_c, xb_c), max(xa_c, xb_c)
            pieces = [(ya, yb)]
            for h in holes:
                if hi_x > h[0] - 0.005 and lo_x < h[2] + 0.005:
                    pieces = [q for pc in pieces for q in subtract_intervals(pc[0], pc[1], [(h[1] - 0.003, h[3] + 0.003)])]
            pieces = [q for q in pieces if q[1] - q[0] > 0.015]
            if not pieces:
                continue
            for ya, yb in pieces:
                bj = rng.uniform(-0.006, 0.006) if k > 0 else 0.0
                tb = rng.uniform(0.009, 0.016) if k > 0 else 0.018
                dB = d_k + bj
                ht = 0.003
                lift = rng.uniform(0.0, 0.004) if rng.random() < 0.12 else 0.0   # the odd curled shingle
                g = 0.0
                a_, b_ = ya, yb
                # top face (up-slope edge first), butt, two side triangles, under-butt strip
                add([W(a_, top_line, ht), W(a_, dB, tb + lift), W(b_, dB, tb), W(b_, top_line, ht)],
                    [(a_, -top_line), (a_, -dB), (b_, -dB), (b_, -top_line)])
                add([W(a_, dB, tb + lift), W(a_, dB, 0.0015), W(b_, dB, 0.0015), W(b_, dB, tb)],
                    [(a_, -dB), (a_, -dB), (b_, -dB), (b_, -dB)])
                add([W(a_, top_line, ht), W(a_, dB, 0.0015), W(a_, dB, tb + lift)],
                    [(a_, -top_line), (a_, -dB), (a_, -dB)])
                add([W(b_, top_line, ht), W(b_, dB, tb), W(b_, dB, 0.0015)],
                    [(b_, -top_line), (b_, -dB), (b_, -dB)])
                low = d_k + 0.007 if k > 0 else d_k
                if low > dB + 1e-5:
                    add([W(ya, dB, 0.0015), W(ya, low, 0.0015), W(yb, low, 0.0015), W(yb, dB, 0.0015)],
                        [(ya, -dB), (ya, -low), (yb, -low), (yb, -dB)])
                if g > 0:   # keyway floor between shingles
                    add([W(b_, top_line, 0.0015), W(b_, low, 0.0015), W(yb + g, low, 0.0015), W(yb + g, top_line, 0.0015)],
                        [(b_, -top_line), (b_, -low), (yb + g, -low), (yb + g, -top_line)])
        d_k = d_up
        k += 1
    from .geom import newell
    ff, fu = [], []
    for f, uv in zip(faces, luv):
        pts = [verts[j] for j in f]
        nn = newell(pts)
        # top faces and keyways should face outward (Nr); butts face down-slope (Dn); sides face +-Y
        if abs(nn.dot(Y)) > 0.7:
            want = None
        elif nn.dot(Nr) * nn.dot(Nr) > 0.5:
            want = Nr
        else:
            want = Dn
        if want is not None and nn.dot(want) < 0:
            f, uv = list(reversed(f)), list(reversed(uv))
        ff.append(f)
        fu.append(uv)
    # side triangles: orient away from the shingle centre (computed per pair above: first +Y for b_ side)
    out_f = []
    for i, f in enumerate(ff):
        pts = [verts[j] for j in f]
        nn = newell(pts)
        if abs(nn.dot(Y)) > 0.7:
            # the a_-side triangle faces -Y, the b_-side faces +Y: decide by comparing with the top quad
            pass
        out_f.append(f)
    M.piece(verts, out_f, roof.R['mat'], loop_uvs=fu)
    M.extras['lm_planar'] = (tuple(top), tuple(Y), tuple(Dn))


def ridge_cap(M, roof, rng):
    """Two-piece ridge cap shingles lapped along the ridge (butts face the prevailing south)."""
    p = roof.pitch
    zt = roof.ridge + roof.lift + 0.012
    y = roof.y1 + 0.05
    while y > roof.y0 - 0.05:
        L_ = 0.16
        ya = max(y - L_ - 0.07, roof.y0 - 0.05)
        for side in (-1, 1):
            a = Vector((side * math.cos(p), 0, -math.sin(p)))
            nrm = Vector((side * math.sin(p), 0, math.cos(p)))
            w = 0.13 + rng.uniform(-0.01, 0.01)
            c = Vector((roof.xr, (ya + y) / 2, zt)) + a * (w / 2) + nrm * 0.004
            oriented_box(M, c, Vector((0, 1, 0)), a, nrm, (y - ya) / 2, w / 2, 0.007, roof.R['mat'], bevel=0.002)
        y -= L_


def build_roof(P, roof, meshes_ext, rng):
    chim = P.L['roof'].get('chimney')
    holes = []
    if chim:
        holes.append(chimney_stack(chim))   # only the STACK passes the eave/roof (the shoulders end below it)
    for side, key in ((-1, 'roof_w'), (1, 'roof_e')):
        shingle_side(meshes_ext[key], roof, side, rng, holes=holes)
    ridge_cap(meshes_ext['roof_trim'].d, roof, rng)
    eaves(P, roof, meshes_ext['roof_trim'], holes)


def eaves(P, roof, M, holes):
    """Boxed eaves (fascia, soffit, bed moulding, gutters) on the long sides; rakes + returns on the gables."""
    over, rake = roof.over, roof.rake
    zs = roof.soffit_z
    for side in (-1, 1):
        xw = roof.fx0 if side < 0 else roof.fx1
        xf = xw + side * over                  # fascia outer line
        zf_top = roof.z_surface(xf) - 0.01
        y_segs = subtract_intervals(roof.y0, roof.y1, [(h[1] - 0.004, h[3] + 0.004) for h in holes
                                                        if (h[0] < xf < h[2] + 1.0) or (h[0] - 1 < xw < h[2])]
                                    if side > 0 else [])
        for ya, yb in y_segs:
            # fascia board
            x0, x1 = sorted((xf, xf + side * 0.03))
            box(M, (x0, ya, zs - 0.02), (x1, yb, zf_top), 'trim_chipped', bevel=0.004)
            # soffit board (horizontal, wall -> fascia)
            xa, xb = sorted((xw, xf))
            box(M, (xa, ya, zs - 0.02), (xb, yb, zs), 'trim_chipped', bevel=0.002)
            # bed moulding in the frieze/soffit corner (only along the wall length)
            wy0, wy1 = max(ya, roof.fy0 + 0.13), min(yb, roof.fy1 - 0.13)
            if wy1 > wy0:
                prof = [(0.0, 0.0), (0.004, 0.0)] + [(0.004 + 0.03 - 0.03 * math.cos(t), 0.03 * math.sin(t))
                                                     for t in [math.pi / 2 * i / 5 for i in range(1, 6)]] + \
                    [(0.04, 0.03), (0.0, 0.03)]
                a = Vector((xw + side * 0.026, wy0 if side > 0 else wy1, zs - 0.032))
                b = Vector((xw + side * 0.026, wy1 if side > 0 else wy0, zs - 0.032))
                sweep(M, [a, b], prof, 'trim_chipped', side_sign=1.0)
            # close the eave box where it stops against the chimney
            for yend, sgn_ in ((ya, 1), (yb, -1)):
                if roof.y0 + 0.01 < yend < roof.y1 - 0.01:
                    xa2, xb2 = sorted((xw, xf + side * 0.03))
                    poly = [(xa2, zs - 0.02), (xb2, zs - 0.02), (xb2, roof.z_surface(xb2) - 0.01),
                            (xa2, roof.z_surface(xa2) - 0.01)]
                    y_hi = yend + sgn_ * 0.02 if sgn_ > 0 else yend
                    y_hi = max(yend, yend + sgn_ * 0.02)
                    prism(M, poly, Vector((0, y_hi, 0)), Vector((1, 0, 0)), Vector((0, 0, 1)), 0.02, 'trim_chipped',
                          bevel=0.002)
            # half-round gutter on hangers, slight fall toward the downspout end
            gutter(M, Vector((xf + side * 0.1, ya, zf_top - 0.07)), Vector((xf + side * 0.1, yb, zf_top - 0.09)),
                   side)
        # soffit + bed between the wall and a stack standing proud of the wall (no open slot up into the roof)
        for h in holes:
            if side > 0 and h[0] > xw + 0.01 and h[0] < xf:
                box(M, (xw, h[1] - 0.006, zs - 0.02), (h[0] + 0.004, h[3] + 0.006, zs), 'trim_chipped', bevel=0.002)
                box(M, (xw, h[1] - 0.006, zs), (h[0] + 0.004, h[3] + 0.006, roof.z_surface(h[0]) - 0.01),
                    'trim_chipped', bevel=0.002)
    # rakes on both gables
    for yg, sgn in ((roof.fy0, -1), (roof.fy1, 1)):
        y_out = yg + sgn * rake
        for side in (-1, 1):
            xe = (roof.fx0 - over) if side < 0 else (roof.fx1 + over)
            xa, xb = roof.xr, xe
            # rake board: sloped, follows the roof edge
            n = 10
            poly = []
            for i in range(2):
                x = xa + (xb - xa) * i
                poly.append((x, roof.z_surface(x) - 0.235))
            for i in range(2):
                x = xb + (xa - xb) * i
                poly.append((x, roof.z_surface(x) - 0.005))
            y0_, y1_ = sorted((y_out, y_out + sgn * 0.03))
            prism(M, poly, Vector((0, y1_, 0)), Vector((1, 0, 0)), Vector((0, 0, 1)), y1_ - y0_, 'trim_chipped',
                  bevel=0.003)
            # rake soffit (sloped) wall -> rake board
            ys0, ys1 = sorted((yg, y_out))
            sp = [(xa, roof.z_surface(xa) - 0.255), (xb, roof.z_surface(xb) - 0.255), (xb, roof.z_surface(xb) - 0.235),
                  (xa, roof.z_surface(xa) - 0.235)]
            prism(M, sp, Vector((0, ys1, 0)), Vector((1, 0, 0)), Vector((0, 0, 1)), ys1 - ys0, 'trim_chipped',
                  bevel=0.001)
            # rake frieze on the gable wall under the soffit
            xw = roof.fx0 if side < 0 else roof.fx1
            fa, fb = xa, xw - side * 0.13
            fr_poly = [(fa, roof.z_gable(fa) - 0.19), (fb, roof.z_gable(fb) - 0.19),
                       (fb, roof.z_surface(fb) - 0.25), (fa, roof.z_surface(fa) - 0.25)]
            yf0, yf1 = sorted((yg, yg + sgn * 0.026))
            prism(M, fr_poly, Vector((0, yf1, 0)), Vector((1, 0, 0)), Vector((0, 0, 1)), yf1 - yf0, 'trim_chipped',
                  bevel=0.002)
            # end board closing the eave box under the rake (sloped top meets the rake board)
            xa2, xb2 = sorted((xe, xw))
            yb0, yb1 = sorted((y_out, y_out - sgn * 0.025))
            poly = [(xa2, zs - 0.02), (xb2, zs - 0.02), (xb2, roof.z_surface(xb2) - 0.23),
                    (xa2, roof.z_surface(xa2) - 0.23)]
            prism(M, poly, Vector((0, yb1, 0)), Vector((1, 0, 0)), Vector((0, 0, 1)), yb1 - yb0, 'trim_chipped',
                  bevel=0.003)


def gutter(M, a, b, side):
    """Half-round gutter (open top) with a rolled bead; hangers every 0.8 m."""
    r = 0.065
    th = 0.0025
    outer = [(r * math.cos(t), -r * math.sin(t)) for t in [math.pi * i / 10 for i in range(11)]]
    inner = [((r - th) * math.cos(t), -(r - th) * math.sin(t)) for t in [math.pi * i / 10 for i in range(11)]]
    prof = outer + [(-r - 0.008, 0.0), (-r - 0.008, 0.008), (-r + 0.002, 0.008)] + list(reversed(inner))
    # profile x across (horizontal, perpendicular to the run), y up
    sweep(M, [a, b], prof, 'zinc_galvanized', up=UP, side_sign=1.0, closed_profile=True)
    d = b - a
    L = d.length
    # soldered end caps (half discs, a 2 mm plate: one face outward, one into the trough)
    t_ = d.normalized()
    X_ = UP.cross(t_)
    half = [(r * math.cos(t), -r * math.sin(t)) for t in [math.pi * i / 12 for i in range(13)]]
    from .geom import newell
    for end, outward in ((a, -t_), (b, t_)):
        for off, facing_ in ((0.0, outward), (-0.002, -outward)):
            c = end + outward * off
            pts = [c + X_ * px + UP * py for px, py in half]
            if newell(pts).dot(facing_) < 0:
                pts = list(reversed(pts))
            M.poly(pts, 'zinc_galvanized')
    nh = max(2, int(L / 0.8))
    for i in range(nh + 1):
        p = a + d * (i / nh)
        xa_ = d.normalized()
        ya_ = UP.cross(xa_)
        oriented_box(M.d, p + UP * 0.0065, ya_, xa_, UP, r + 0.01, 0.008, 0.0025, 'zinc_galvanized', bevel=0.001)


def downspout(M, top, x_wall, side, z_bottom, name_kick=True):
    """Round downspout: outlet at the gutter, two elbows back to the wall, straps, kick-out at the bottom."""
    r = 0.036
    wall_off = x_wall + side * 0.06
    p0 = top
    p1 = Vector((top.x, top.y, top.z - 0.12))
    p2 = Vector((wall_off, top.y, top.z - 0.32))
    p3 = Vector((wall_off, top.y, z_bottom + 0.2))
    p4 = Vector((wall_off + side * 0.18, top.y, z_bottom + 0.05))
    for a, b in ((p0, p1), (p1, p2), (p2, p3), (p3, p4)):
        cylinder_between(M, a, b, r, 'zinc_galvanized', segs=12, cap=False)
    for z in [p3.z + (p2.z - p3.z) * t for t in (0.15, 0.5, 0.85)]:
        c = Vector((wall_off, top.y, z))
        box(M, c + Vector((-r - 0.004, -r - 0.004, -0.012)), c + Vector((r + 0.004, r + 0.004, 0.012)),
            'zinc_galvanized', bevel=0.002)


# ------------------------------------------------------------------------------------------------ chimney
def chimney_stack(ch):
    """(x0, y0, x1, y1) of the chimney STACK above the shoulders (what passes through the eave and roof)."""
    cx, cy = ch['pos']
    sx, sy = ch['size']
    x0, x1 = cx - sx / 2, cx + sx / 2
    y0, y1 = cy - sy / 2, cy + sy / 2
    return (x0 + 0.1, y0 + 0.22, x1 - 0.15, y1 - 0.22)


def chimney(P, roof, M, rng):
    ch = P.L['roof']['chimney']
    cx, cy = ch['pos']
    sx, sy = ch['size']
    top = ch['top']
    mat = ch['mat']
    x0, x1 = cx - sx / 2, cx + sx / 2
    y0, y1 = cy - sy / 2, cy + sy / 2
    # firebox base up to the shoulders
    zs = 3.6
    box(M, (x0, y0, -0.1), (x1, y1, zs), mat, bevel=0.01, segs=1)
    # stepped shoulders (weathered brick slopes)
    bx0, by0, bx1, by1 = chimney_stack(ch)
    poly = [(y0, zs), (y1, zs), (by1, zs + 0.45), (by0, zs + 0.45)]
    prism(M, poly, Vector((x0, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)), x1 - x0, mat, bevel=0.006)
    # stack
    box(M, (bx0, by0, zs + 0.3), (bx1, by1, top - 0.34), mat, bevel=0.008)
    # corbelled courses at the top
    for k, (dz0, dz1, out) in enumerate(((0.34, 0.26, 0.025), (0.26, 0.18, 0.045), (0.18, 0.1, 0.025))):
        box(M, (bx0 - out, by0 - out, top - dz0), (bx1 + out, by1 + out, top - dz1), mat, bevel=0.006)
    box(M, (bx0, by0, top - 0.1), (bx1, by1, top - 0.02), mat, bevel=0.006)
    # mortar wash cap + two flue pots
    box(M, (bx0 + 0.01, by0 + 0.01, top - 0.02), (bx1 - 0.01, by1 - 0.01, top + 0.03), 'stone_foundation', bevel=0.01)
    for fy in (by0 + (by1 - by0) * 0.3, by0 + (by1 - by0) * 0.7):
        c = Vector(((bx0 + bx1) / 2, fy, top + 0.03))
        lathe(M, [(0.075, 0.0), (0.08, 0.02), (0.07, 0.06), (0.068, 0.24), (0.075, 0.26), (0.075, 0.28),
                  (0.06, 0.28), (0.058, 0.1)], c, 'brick_old', segs=14, cap=False)
    # zinc apron lying on the shingles around the stack (covers the cut shingle ends): two side strips running
    # down-slope past the fascia line and a back apron on the up-slope face
    xe = roof.fx1 + roof.over + 0.03
    for y_a, y_b in ((by0 - 0.11, by0 + 0.004), (by1 - 0.004, by1 + 0.11)):
        pts = [Vector((bx0 - 0.1, y_a, roof.z_surface(bx0 - 0.1) + 0.022)),
               Vector((xe, y_a, roof.z_surface(xe) + 0.022)),
               Vector((xe, y_b, roof.z_surface(xe) + 0.022)),
               Vector((bx0 - 0.1, y_b, roof.z_surface(bx0 - 0.1) + 0.022))]
        M.poly(pts, 'zinc_galvanized')
    pts = [Vector((bx0 - 0.1, by0 - 0.11, roof.z_surface(bx0 - 0.1) + 0.024)),
           Vector((bx0 + 0.004, by0 - 0.11, roof.z_surface(bx0 + 0.004) + 0.024)),
           Vector((bx0 + 0.004, by1 + 0.11, roof.z_surface(bx0 + 0.004) + 0.024)),
           Vector((bx0 - 0.1, by1 + 0.11, roof.z_surface(bx0 - 0.1) + 0.024))]
    M.poly(pts, 'zinc_galvanized')
    # upturned leg of the back apron against the stack
    box(M, (bx0 - 0.006, by0 - 0.11, roof.z_surface(bx0) + 0.01), (bx0, by1 + 0.11, roof.z_surface(bx0) + 0.14),
        'zinc_galvanized', bevel=0.001)
    # zinc flashing where the stack meets the roof overhang / wall
    zr = roof.z_surface(bx0)
    for y_a, y_b in ((by0 - 0.012, by0), (by1, by1 + 0.012)):
        box(M, (x0 - 0.05, y_a, roof.soffit_z - 0.3), (bx1, y_b, roof.z_surface(x0 - 0.05) + 0.12),
            'zinc_galvanized', bevel=0.001)


# ------------------------------------------------------------------------------------------------ foundation
def foundation(P, M, rng):
    fx0, fy0, fx1, fy1 = P.footprint()
    o = 0.045
    x0, y0, x1, y1 = fx0 - o, fy0 - o, fx1 + o, fy1 + o
    faces = [((x0, y0), (x1, y0), (0, -1)), ((x1, y0), (x1, y1), (1, 0)), ((x1, y1), (x0, y1), (0, 1)),
             ((x0, y1), (x0, y0), (-1, 0))]
    from .geom import newell
    for a, b, nn in faces:
        A, B = Vector((a[0], a[1], 0)), Vector((b[0], b[1], 0))
        L = (B - A).length
        nu, nv = max(2, int(L / 0.18)), 4
        verts, fcs = [], []
        for j in range(nv + 1):
            for i in range(nu + 1):
                p = A + (B - A) * (i / nu) + UP * (-0.15 + 0.73 * j / nv)
                edge = 0 < i < nu and 0 < j < nv
                if edge:
                    p = p + Vector((nn[0], nn[1], 0)) * rng.uniform(-0.006, 0.012)
                verts.append(p)
        for j in range(nv):
            for i in range(nu):
                a_ = j * (nu + 1) + i
                f = [a_, a_ + 1, a_ + nu + 2, a_ + nu + 1]
                if newell([verts[k] for k in f]).dot(Vector((nn[0], nn[1], 0))) < 0:
                    f = list(reversed(f))
                fcs.append(f)
        M.piece(verts, fcs, 'stone_foundation')
        # sloped mortar wash on top
        n3 = Vector((nn[0], nn[1], 0))
        C, D = A + UP * 0.58, B + UP * 0.58
        top = [C, D, D - n3 * 0.047 + UP * 0.022, C - n3 * 0.047 + UP * 0.022]
        if newell(top).dot(UP) < 0:
            top = list(reversed(top))
        M.poly(top, 'stone_foundation')
    # crawlspace vents on the fog sides
    for (vx, vy, nn) in ((x1, 3.0 + 3.2, (1, 0)), (x1, 9.5, (1, 0)), (x0, 4.0, (-1, 0)), (x0, 8.5, (-1, 0)),
                         (5.0, y1, (0, 1))):
        n3 = Vector((nn[0], nn[1], 0))
        t3 = Vector((-nn[1], nn[0], 0))
        c = Vector((vx, vy, 0.3))
        oriented_box(M, c - n3 * 0.02, t3, UP, n3, 0.2, 0.09, 0.025, 'cast_iron', bevel=0.004)
        for k in range(-3, 4):
            p = c + t3 * (k * 0.05) + n3 * 0.006
            cylinder_between(M.d, p - UP * 0.08, p + UP * 0.08, 0.006, 'rust', segs=5)


# ------------------------------------------------------------------------------------------------ porch
def porch(P, meshes_ext, roof, rng):
    pr = next(p for p in P.L['props'] if p['type'] == 'porch')
    q = pr['params']
    W_, D_ = q['width'], q['depth']
    cx, cy = pr['pos'][0], pr['pos'][1]
    x0, x1 = cx - W_ / 2, cx + W_ / 2
    y_wall = cy + D_ / 2           # -0.3 (the house face)
    y_edge = cy - D_ / 2           # -2.8
    dz = q['deckZ']
    M = meshes_ext['porch']
    DK = meshes_ext['porch_deck']
    DK.extras['lm_planar'] = ((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0))
    R = meshes_ext['porch_roof']
    sx = q['stepsCentreX']
    sw = q['stepsWidth']
    nsteps = q['steps']
    deck = q.get('deckMat', 'porch_boards_wet')
    tmat = q.get('mat', 'trim_chipped')
    # --- deck boards (run north-south), gaps, some cupped or sunk
    bw, gap = 0.089, 0.006
    x = x0 + 0.004
    while x < x1 - 0.02:
        xb = min(x + bw, x1 - 0.004)
        sink = rng.uniform(-0.0025, 0.001)
        tilt = rng.uniform(-0.002, 0.002)
        y_a = y_edge - 0.028
        # boards in two lengths with a staggered butt joint
        yj = rng.uniform(y_edge + 0.6, y_wall - 0.6)
        for ya, yb in ((y_a, yj - 0.002), (yj + 0.002, y_wall + 0.02)):
            box(DK, (x, ya, dz - 0.028 + sink), (xb, yb, dz + sink + tilt * (1 if ya < yj else -1)), deck,
                bevel=0.003, grain='y', drop_bottom=True)
        x = xb + gap
    # --- joists / rim, fascia skirt board
    box(M, (x0 - 0.03, y_edge - 0.03, dz - 0.25), (x1 + 0.03, y_edge, dz - 0.03), tmat, bevel=0.004)
    for xe in (x0 - 0.03, x1):
        box(M, (xe, y_edge, dz - 0.25), (xe + 0.03, y_wall, dz - 0.03), tmat, bevel=0.004)
    # --- lattice skirt under the rim (except at the steps)
    lat_runs = [((x0, y_edge - 0.015), (sx - sw / 2 - 0.05, y_edge - 0.015), (0, -1)),
                ((sx + sw / 2 + 0.05, y_edge - 0.015), (x1, y_edge - 0.015), (0, -1)),
                ((x0 - 0.015, y_wall), (x0 - 0.015, y_edge), (-1, 0)),
                ((x1 + 0.015, y_edge), (x1 + 0.015, y_wall), (1, 0))]
    for a, b, nn in lat_runs:
        lattice(M, Vector((a[0], a[1], 0)), Vector((b[0], b[1], 0)), Vector((nn[0], nn[1], 0)), -0.05, dz - 0.25,
                tmat, rng)
    # --- steps (stringers, treads, risers)
    rh = dz / nsteps
    td = 0.29
    for k in range(1, nsteps):
        zt = dz - k * rh
        ya = y_edge - k * td
        for bx in ((sx - sw / 2, sx - 0.003), (sx + 0.003, sx + sw / 2)):
            box(M, (bx[0], ya - 0.03, zt - 0.032), (bx[1], ya + td, zt), deck, bevel=0.003, grain='x')
        box(M, (sx - sw / 2 + 0.02, ya, zt - rh), (sx + sw / 2 - 0.02, ya + 0.022, zt - 0.03), tmat, bevel=0.002)
    box(M, (sx - sw / 2 + 0.02, y_edge - 0.02, dz - rh), (sx + sw / 2 - 0.02, y_edge, dz - 0.03), tmat, bevel=0.002)
    slope = dz / (nsteps * td)
    # closed (housed) stringers: top edge 3 cm above the nosing line, plumb-cut at the bottom tread's nosing (no
    # wedge running out past the steps onto the ground), level cut on the ground, 0.3 m deep
    y_front = y_edge - (nsteps - 1) * td - 0.035
    z_front = dz + 0.03 - (y_edge - y_front) * slope
    y_heel = y_edge - (dz - 0.3) / slope
    for xs in (sx - sw / 2 - 0.04, sx + sw / 2):
        poly = [(y_edge, dz + 0.03), (y_front, z_front), (y_front, 0.0), (max(y_heel, y_front + 0.05), 0.0),
                (y_edge, dz - 0.3)]
        prism(M, poly, Vector((xs, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)), 0.04, tmat, bevel=0.004)
    # --- posts
    n_posts = int(q.get('posts', 5))
    y_post = y_edge + 0.09
    xs_posts = [x0 + 0.08, sx - sw / 2 - 0.1, sx + sw / 2 + 0.1, (sx + sw / 2 + x1) / 2 + 0.3, x1 - 0.08]
    xs_posts = xs_posts[:n_posts]
    beam_z = q.get('roofZ', 3.9) - 0.35
    for xp in xs_posts:
        post(M, Vector((xp, y_post, dz)), beam_z - dz, tmat)
    # --- beam (built-up header) along the front
    box(M, (x0 - 0.02, y_post - 0.085, beam_z), (x1 + 0.02, y_post + 0.085, beam_z + 0.3), tmat, bevel=0.005, segs=2)
    box(M, (x0 - 0.04, y_post - 0.105, beam_z + 0.28), (x1 + 0.04, y_post + 0.105, beam_z + 0.31), tmat, bevel=0.004)
    # --- railings between posts (not at the steps), and on the two ends back to the house
    rail_h = 0.86
    spans = []
    for i in range(len(xs_posts) - 1):
        a, b = xs_posts[i], xs_posts[i + 1]
        if a < sx < b:
            continue
        spans.append((Vector((a + 0.075, y_post, dz)), Vector((b - 0.075, y_post, dz))))
    spans.append((Vector((xs_posts[0], y_post + 0.075, dz)), Vector((xs_posts[0], y_wall - 0.05, dz))))
    spans.append((Vector((xs_posts[-1], y_post + 0.075, dz)), Vector((xs_posts[-1], y_wall - 0.05, dz))))
    for a, b in spans:
        railing(M, a, b, rail_h, tmat, rng)
    # --- shed roof, ceiling, fascia, gutter
    porch_roof(P, R, meshes_ext['porch_trim'], x0, x1, y_wall, y_post, beam_z + 0.31, q, rng)
    return xs_posts, y_post


def post(M, base, h, mat):
    s = 0.06
    box(M, base + Vector((-s - 0.02, -s - 0.02, 0)), base + Vector((s + 0.02, s + 0.02, 0.22)), mat, bevel=0.006,
        segs=2)
    box(M, base + Vector((-s, -s, 0.2)), base + Vector((s, s, h - 0.18)), mat, bevel=0.012, segs=1, grain='z')
    box(M, base + Vector((-s - 0.012, -s - 0.012, h - 0.2)), base + Vector((s + 0.012, s + 0.012, h - 0.16)), mat,
        bevel=0.005, segs=2)
    box(M, base + Vector((-s - 0.03, -s - 0.03, h - 0.16)), base + Vector((s + 0.03, s + 0.03, h)), mat, bevel=0.006,
        segs=2)


def railing(M, a, b, h, mat, rng):
    d = b - a
    L = d.length
    x = d.normalized()
    y = UP.cross(x)
    # bottom rail, top rail with a sloped cap
    oriented_box(M, (a + b) / 2 + UP * 0.1, x, y, UP, L / 2, 0.03, 0.03, mat, bevel=0.004)
    oriented_box(M, (a + b) / 2 + UP * (h - 0.03), x, y, UP, L / 2, 0.035, 0.03, mat, bevel=0.004)
    cap = [(-0.05, 0.0), (0.05, 0.0), (0.05, 0.012), (0.0, 0.03), (-0.05, 0.012)]
    sweep(M, [a + UP * h, b + UP * h], cap, mat, up=UP, side_sign=1.0, closed_profile=True)
    n = max(1, int(L / 0.115))
    for i in range(n):
        t = (i + 0.5) / n
        c = a + d * t + UP * (0.13 + (h - 0.06 - 0.13) / 2)
        lean = rng.uniform(-0.01, 0.01)
        oriented_box(M.d, c, x, y, (UP + x * lean).normalized(), 0.019, 0.019, (h - 0.06 - 0.13) / 2 + 0.005, mat,
                     bevel=0.003)


def lattice(M, a, b, n, z0, z1, mat, rng, pitch=0.11, w=0.036, t=0.008):
    """Diagonal lattice panel between a and b (plan points), from z0 to z1, set on a thin frame."""
    d = b - a
    L = d.length
    x = d.normalized()
    H = z1 - z0
    for layer, sign in ((0, 1), (1, -1)):
        k = -int(H / pitch) - 2
        while k * pitch < L + H:
            # slat along direction (1, sign) in (s, z) starting at s = k*pitch on the bottom
            s0 = k * pitch
            p0 = (s0, 0.0) if sign > 0 else (s0 + H, 0.0)
            p1 = (s0 + H, H) if sign > 0 else (s0, H)
            # clip to [0, L] in s
            (sa, za), (sb, zb) = p0, p1
            def clip(sa, za, sb, zb):
                if sb == sa:
                    return None
                ta = (0 - sa) / (sb - sa)
                tb = (L - sa) / (sb - sa)
                t0, t1 = max(0.0, min(ta, tb)), min(1.0, max(ta, tb))
                if t1 <= t0:
                    return None
                return (sa + (sb - sa) * t0, za + (zb - za) * t0, sa + (sb - sa) * t1, za + (zb - za) * t1)
            c = clip(sa, za, sb, zb)
            k += 1
            if not c or math.hypot(c[2] - c[0], c[3] - c[1]) < 0.03:
                continue
            P0 = a + x * c[0] + UP * (z0 + c[1])
            P1 = a + x * c[2] + UP * (z0 + c[3])
            mid = (P0 + P1) / 2 + n * (layer * t)
            ax = (P1 - P0).normalized()
            oriented_box(M.d, mid, ax, n, ax.cross(n), (P1 - P0).length / 2, t / 2, w / 2, mat, bevel=0.0)
    # frame top rail
    oriented_box(M, (a + b) / 2 + UP * (z1 - 0.03) + n * 0.01, x, n, UP, L / 2, 0.012, 0.03, mat, bevel=0.003)


def porch_roof(P, R, M, x0, x1, y_wall, y_beam, z_beam_top, q, rng):
    """Shed roof from a ledger on the facade to the beam; shingle courses (butts facing south), fascia,
    beadboard ceiling, flashing."""
    over = 0.28
    z_wall_top = q.get('roofZ', 3.9) + 0.55          # surface height at the facade
    z_edge = z_beam_top + 0.2
    ya = y_wall - 0.02
    yb = y_beam - over
    slope = (z_wall_top - z_edge) / (ya - y_beam)
    zs = lambda y: z_edge + (y - y_beam) * slope  # noqa: E731
    xa, xb = x0 - 0.22, x1 + 0.22
    # shingles: courses along x, down-slope toward -y
    L_ = math.hypot(ya - yb, zs(ya) - zs(yb))
    Dn = Vector((0, yb - ya, zs(yb) - zs(ya))).normalized()
    Xv = Vector((1, 0, 0))
    Nr = Xv.cross(Dn)
    if Nr.z < 0:
        Nr = -Nr
    top = Vector((0, ya, zs(ya)))
    verts, faces, luv = [], [], []
    exp = 0.18
    d_k = L_ + 0.03
    k = 0
    while d_k > 0.02:
        d_up = max(d_k - exp, 0.0)
        tl = d_up + 0.007 if d_up > 0 else 0.0
        x = xa
        while x < xb - 0.02:
            ww = rng.uniform(0.16, 0.42)
            xa_, xb_ = x, min(x + ww, xb)
            if xb - xb_ < 0.08:
                xb_ = xb
            x = xb_
            bj = rng.uniform(-0.006, 0.006) if k > 0 else 0.0
            tb = rng.uniform(0.009, 0.015)
            dB = d_k + bj
            low = d_k + 0.007 if k > 0 else d_k
            W_ = lambda xx, d, h: top + Xv * xx + Dn * d + Nr * h  # noqa: E731
            for pts, uv in (
                    ([W_(xa_, tl, 0.003), W_(xa_, dB, tb), W_(xb_, dB, tb), W_(xb_, tl, 0.003)],
                     [(xa_, -tl), (xa_, -dB), (xb_, -dB), (xb_, -tl)]),
                    ([W_(xa_, dB, tb), W_(xa_, dB, 0.0015), W_(xb_, dB, 0.0015), W_(xb_, dB, tb)],
                     [(xa_, -dB)] * 2 + [(xb_, -dB)] * 2),
                    ([W_(xa_, tl, 0.003), W_(xa_, dB, 0.0015), W_(xa_, dB, tb)], [(xa_, -tl), (xa_, -dB), (xa_, -dB)]),
                    ([W_(xb_, tl, 0.003), W_(xb_, dB, tb), W_(xb_, dB, 0.0015)], [(xb_, -tl), (xb_, -dB), (xb_, -dB)])):
                base = len(verts)
                verts.extend(pts)
                faces.append(list(range(base, base + len(pts))))
                luv.append(uv)
            if low > dB + 1e-5:
                base = len(verts)
                verts.extend([W_(xa_, dB, 0.0015), W_(xa_, low, 0.0015), W_(xb_, low, 0.0015), W_(xb_, dB, 0.0015)])
                faces.append([base, base + 1, base + 2, base + 3])
                luv.append([(xa_, -dB), (xa_, -low), (xb_, -low), (xb_, -dB)])
        d_k = d_up
        k += 1
    from .geom import newell
    ff, fu = [], []
    for f, uv in zip(faces, luv):
        nn = newell([verts[j] for j in f])
        if abs(nn.x) < 0.7:
            want = Nr if abs(nn.dot(Nr)) > 0.7 else Dn
            if nn.dot(want) < 0:
                f, uv = list(reversed(f)), list(reversed(uv))
        ff.append(f)
        fu.append(uv)
    R.piece(verts, ff, 'shingles_wet', loop_uvs=fu)
    R.extras['lm_planar'] = (tuple(top), tuple(Xv), tuple(Dn))
    # roof deck edge + fascia + ceiling
    th = 0.16
    edge_z = zs(yb)
    box(M, (xa - 0.03, yb - 0.03, edge_z - th - 0.06), (xb + 0.03, yb, edge_z - 0.005), 'trim_chipped', bevel=0.004)
    for xe in (xa - 0.03, xb):
        poly = [(yb, zs(yb) - th - 0.06), (ya, zs(ya) - th - 0.06), (ya, zs(ya) - 0.005), (yb, zs(yb) - 0.005)]
        prism(M, poly, Vector((xe, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)), 0.03, 'trim_chipped',
              bevel=0.003)
    # beadboard ceiling (sloped, under the rafters), boards along y
    zc = lambda y: zs(y) - th  # noqa: E731
    xk = xa
    while xk < xb - 0.01:
        xk2 = min(xk + 0.089, xb)
        c0 = Vector((xk, yb, zc(yb)))
        verts = [Vector((xk + 0.002, yb, zc(yb))), Vector((xk2 - 0.002, yb, zc(yb))),
                 Vector((xk2 - 0.002, ya, zc(ya))), Vector((xk + 0.002, ya, zc(ya)))]
        if newell(verts).z > 0:
            verts = list(reversed(verts))
        M.poly(verts, 'trim_chipped', grain='y')
        # V-groove between boards
        g0 = [Vector((xk2 - 0.002, yb, zc(yb))), Vector((xk2, yb, zc(yb) + 0.004)), Vector((xk2, ya, zc(ya) + 0.004)),
              Vector((xk2 - 0.002, ya, zc(ya)))]
        g1 = [Vector((xk2, yb, zc(yb) + 0.004)), Vector((xk2 + 0.002, yb, zc(yb))), Vector((xk2 + 0.002, ya, zc(ya))),
              Vector((xk2, ya, zc(ya) + 0.004))]
        for g in (g0, g1):
            if newell(g).z > 0:
                g = list(reversed(g))
            M.poly(g, 'trim_chipped')
        xk = xk2
    # ledger / flashing strip on the facade
    box(M, (xa, y_wall - 0.035, zs(ya) - 0.02), (xb, y_wall - 0.012, zs(ya) + 0.14), 'zinc_galvanized', bevel=0.001)
    box(M, (xa, y_wall - 0.03, zc(ya) - 0.2), (xb, y_wall - 0.008, zc(ya) + 0.004), 'trim_chipped', bevel=0.003)
    # gutter on the front edge
    gutter(M, Vector((xb + 0.02, yb - 0.1, edge_z - 0.07)), Vector((xa - 0.02, yb - 0.1, edge_z - 0.085)), -1)
    return


# ------------------------------------------------------------------------------------------------ entry
def build_exterior(P, factory):
    rng = random.Random(1994)
    roof = Roof(P)
    roof.soffit_z = roof.z_surface(roof.fx0 - roof.over) - 0.26
    ext = {
        'walls': factory('_walls'),
        'trim': factory('_trim'),
        'roof_w': factory('_roof_W', lm_weight=0.55),
        'roof_e': factory('_roof_E', lm_weight=0.55),
        'roof_trim': factory('_roof_trim'),
        'chimney': factory('_chimney'),
        'foundation': factory('_foundation'),
        'porch': factory('_porch'),
        'porch_deck': factory('_porch_deck', lm_weight=0.8),
        'porch_roof': factory('_porch_roof', lm_weight=0.8),
        'porch_trim': factory('_porch_trim'),
    }
    for fp in P.facade_planes():
        ops = openings_on_plane(P, fp)
        # Every facade gets real lap boards (the fog facades read as flat plaster up close otherwise); the hero
        # facade keeps the finer 0.8 m warp strips, the others warp per 1.6 m (fewer triangles).
        tag = FACADE_TAG.get((round(fp['n'][0]), round(fp['n'][1])), f"{len(ext)}")
        M = ext.setdefault(f'siding_{tag}', factory(f'_siding_{tag}', lm_weight=1.0))
        hero = fp['detail'] == 'hero'
        hero_siding(P, fp, M, roof, rng, strip=0.8 if hero else 1.6)
        M.extras['lm_planar'] = (tuple(fp_point(fp, 0, 0)), (fp['dir'][0], fp['dir'][1], 0.0),
                                 (0.0, 0.0, LM_V_STRETCH))
        reveals(ext['walls'], fp, ops)
        facade_trim(P, fp, ext['trim'], roof, hero)
    clapboard_uvs(ext['walls'])          # (no clapboard faces left on the walls; kept for facade_flat fallbacks)
    build_roof(P, roof, ext, rng)
    chimney(P, roof, ext['chimney'], rng)
    foundation(P, ext['foundation'], rng)
    posts = porch(P, ext, roof, rng)
    # downspouts at the four corners (the SE one ends over the rain barrel)
    fx0, fy0, fx1, fy1 = P.footprint()
    zg = roof.z_surface(fx1 + roof.over) - 0.1
    for (x, y, side, zb) in ((fx1 + roof.over + 0.1, fy0 + 0.25, 1, 0.95), (fx1 + roof.over + 0.1, fy1 - 0.25, 1, 0.0),
                             (fx0 - roof.over - 0.1, fy0 + 0.25, -1, 0.0), (fx0 - roof.over - 0.1, fy1 - 0.25, -1, 0.0)):
        downspout(ext['roof_trim'].d, Vector((x, y, zg - 0.08)), fx1 if side > 0 else fx0, side, zb)
    return ext


def facade_flat_region(P, fp, M, roof, region):
    """Flat facade (fog): rectangle part with openings via plane_with_holes, gable triangle as one polygon."""
    ops = openings_on_plane(P, fp)
    d = Vector((fp['dir'][0], fp['dir'][1], 0))
    holes = [(s - o['width'] / 2, z0, s + o['width'] / 2, z1) for o, s, z0, z1, w in ops]
    o = fp_point(fp, 0, 0)
    zr = min(p[1] for p in region[2:]) if len(region) > 4 else region[2][1]
    zr = min(zr, roof.eave)
    plane_with_holes(M, (o, d, UP), fp['s0'], fp['s1'], fp['z0'], zr, holes, 'clapboard_peeling', cell=1.0)
    if len(region) > 4:
        tri = [(s, z) for s, z in region if z >= zr - 1e-6]
        # region above zr: the gable polygon
        poly = clip_poly(region, 0, -1, -zr)
        pts = [fp_point(fp, s, z) for s, z in poly]
        from .geom import newell
        n = Vector((fp['n'][0], fp['n'][1], 0))
        if newell(pts).dot(n) < 0:
            pts = list(reversed(pts))
        M.poly(pts, 'clapboard_peeling', uv='box')
