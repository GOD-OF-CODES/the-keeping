"""Geometry kit for the house: plain-Python accumulation of pieces into output meshes.

A `Mesh` collects pieces (shared-vertex polygons) with a material id per face and UV0 in METRES (same rule as
blender/props/kit.py: runtime tiling = 1 / tileMetres). Bevelled solids go through a temporary bmesh
(bmesh.ops.bevel), everything else is emitted analytically, so there are no modifiers to apply and no Booleans.

UV0 rules (uv='box'): the face normal's dominant axis picks the projection plane.
  * vertical faces: u = horizontal distance along the face (reads left->right seen from the front), v = z;
  * horizontal faces: u = x, v = y;
  * grain='z' on vertical faces swaps to u = z (vertical boards / stiles); grain='y' on horizontal faces gives
    u = y (boards running north-south); grain='x' on vertical faces facing x is the default already.
Custom per-loop UVs (sweeps, roof courses, siding) are passed explicitly.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

UP = Vector((0.0, 0.0, 1.0))


def V(*a):
    if len(a) == 1:
        a = a[0]
    return Vector((float(a[0]), float(a[1]), float(a[2]) if len(a) > 2 else 0.0))


def newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    k = len(pts)
    for i in range(k):
        a, b = pts[i], pts[(i + 1) % k]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n.normalized() if n.length > 1e-12 else Vector((0, 0, 1))


def box_uv(p, n, grain=None):
    ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
    if az >= ax and az >= ay:
        if grain == 'y':
            return (p.y, -p.x) if n.z > 0 else (p.y, p.x)
        return (p.x, p.y) if n.z > 0 else (p.x, -p.y)
    if ax >= ay:
        u = p.y if n.x > 0 else -p.y
    else:
        u = -p.x if n.y > 0 else p.x
    if grain == 'z':
        return (p.z, u)
    return (u, p.z)


class Mesh:
    """One output object. Pieces keep their own vertices (no welding across pieces)."""

    def __init__(self, name, **extras):
        self.name = name
        self.extras = dict(extras)
        self.V = []
        self.F = []
        self.FM = []
        self.LUV = []
        self.mats = []
        self.smooth = True
        self._detail = None

    @property
    def d(self):
        """Companion mesh for small detail parts (nails, hinges, balusters, louvres...): exported without a
        lightmap (probe-lit at runtime, details_<atlas>.glb) but kept in the bake scene as occluders."""
        if self._detail is None:
            ex = {k: v for k, v in self.extras.items() if k not in ('lm_weight', 'lm_planar', 'kind')}
            ex['detail'] = True
            ex['kind'] = 'detail'
            self._detail = Mesh(self.name + '_detail', **ex)
        return self._detail

    def mat(self, mid):
        if mid not in self.mats:
            self.mats.append(mid)
        return self.mats.index(mid)

    @property
    def tris(self):
        return sum(len(f) - 2 for f in self.F)

    def piece(self, verts, faces, mid, uv='box', grain=None, uvoff=(0.0, 0.0), loop_uvs=None, mids=None):
        """verts: Vectors (world); faces: index lists (CCW seen from the front). loop_uvs: per face list of (u,v).
        mids: optional per-face material ids (overrides mid)."""
        base = len(self.V)
        self.V.extend(Vector(v) for v in verts)
        mi = self.mat(mid) if mid else 0
        ou, ov = uvoff
        for k, f in enumerate(faces):
            idx = [base + i for i in f]
            self.F.append(idx)
            self.FM.append(self.mat(mids[k]) if mids else mi)
            if loop_uvs is not None:
                self.LUV.append([(u + ou, v + ov) for (u, v) in loop_uvs[k]])
            else:
                pts = [self.V[i] for i in idx]
                n = newell(pts)
                self.LUV.append([(a + ou, b + ov) for (a, b) in (box_uv(p, n, grain) for p in pts)])
        return base

    def poly(self, pts, mid, **kw):
        return self.piece(pts, [list(range(len(pts)))], mid, **kw)

    def add_bm(self, bm, mid, matrix=None, grain=None, uvoff=(0.0, 0.0), mids=None):
        if matrix is not None:
            bm.transform(matrix)
        bm.verts.index_update()
        verts = [v.co.copy() for v in bm.verts]
        faces = [[v.index for v in f.verts] for f in bm.faces]
        fm = None
        if mids is not None:
            fm = [mids[min(f.material_index, len(mids) - 1)] for f in bm.faces]
        self.piece(verts, faces, mid, grain=grain, uvoff=uvoff, mids=fm)
        bm.free()

    def extend(self, other):
        base = len(self.V)
        self.V.extend(other.V)
        for k, f in enumerate(other.F):
            self.F.append([base + i for i in f])
            self.FM.append(self.mat(other.mats[other.FM[k]]))
            self.LUV.append(other.LUV[k])

    def transform_all(self, fn):
        self.V = [fn(v) for v in self.V]

    def to_object(self, collection=None, sharp_angle=32.0):
        from lib import materials
        me = bpy.data.meshes.new(self.name)
        me.from_pydata([tuple(v) for v in self.V], [], [tuple(f) for f in self.F])
        me.update()
        if len(me.polygons) != len(self.F):
            raise RuntimeError(f'{self.name}: {len(self.F)} faces -> {len(me.polygons)} polygons (degenerate faces)')
        me.polygons.foreach_set('material_index', self.FM)
        uvl = me.uv_layers.new(name='UVMap')
        flat = [c for face in self.LUV for uv in face for c in uv]
        uvl.data.foreach_set('uv', flat)
        for mid in self.mats:
            me.materials.append(materials.from_spec(mid))
        if self.smooth:
            me.shade_smooth()
            me.set_sharp_from_angle(angle=math.radians(sharp_angle))
        ob = bpy.data.objects.new(self.name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        for k, v in self.extras.items():
            ob[k] = v
        return ob


# --------------------------------------------------------------------------------------------- frames and quads
def rect(M, o, u, v, mid, **kw):
    """Planar rectangle o, o+u, o+u+v, o+v (normal = u x v)."""
    return M.poly([o, o + u, o + u + v, o + v], mid, **kw)


def grid_rect(M, o, u, v, mid, cell=0.75, **kw):
    """Rectangle split into a grid (so global deformation can bend it)."""
    nu = max(1, int(math.ceil(u.length / cell - 1e-6)))
    nv = max(1, int(math.ceil(v.length / cell - 1e-6)))
    verts = [o + u * (i / nu) + v * (j / nv) for j in range(nv + 1) for i in range(nu + 1)]
    faces = []
    for j in range(nv):
        for i in range(nu):
            a = j * (nu + 1) + i
            faces.append([a, a + 1, a + nu + 2, a + nu + 1])
    return M.piece(verts, faces, mid, **kw)


def splits(a, b, cuts, cell):
    """Sorted breakpoints between a and b: interior cuts + a regular grid of size <= cell."""
    pts = {round(a, 5), round(b, 5)}
    for c in cuts:
        if a + 1e-4 < c < b - 1e-4:
            pts.add(round(c, 5))
    pts = sorted(pts)
    out = [pts[0]]
    for x in pts[1:]:
        n = max(1, int(math.ceil((x - out[-1]) / cell - 1e-6)))
        x0 = out[-1]
        for k in range(1, n + 1):
            out.append(x0 + (x - x0) * k / n)
    return out


def plane_with_holes(M, frame, s0, s1, t0, t1, holes, mid, cell=0.75, **kw):
    """Planar region [s0,s1]x[t0,t1] in frame (origin, S, T; normal = S x T) minus axis-aligned holes
    [(hs0, ht0, hs1, ht1)], split into a grid of cells. Shared vertices; returns number of faces."""
    o, S, T = frame
    xs = splits(s0, s1, [h[0] for h in holes] + [h[2] for h in holes], cell)
    ys = splits(t0, t1, [h[1] for h in holes] + [h[3] for h in holes], cell)
    idx = {}
    verts = []
    faces = []

    def vid(i, j):
        k = (i, j)
        if k not in idx:
            idx[k] = len(verts)
            verts.append(o + S * xs[i] + T * ys[j])
        return idx[k]
    for j in range(len(ys) - 1):
        for i in range(len(xs) - 1):
            cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            if any(h[0] < cx < h[2] and h[1] < cy < h[3] for h in holes):
                continue
            faces.append([vid(i, j), vid(i + 1, j), vid(i + 1, j + 1), vid(i, j + 1)])
    if faces:
        M.piece(verts, faces, mid, **kw)
    return len(faces)


# --------------------------------------------------------------------------------------------- bevelled solids
def _bevel(bm, amount, segs=1, profile=0.5):
    if amount <= 0:
        return
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=amount, offset_type='OFFSET', segments=segs, profile=profile,
                    affect='EDGES', clamp_overlap=True, miter_outer='SHARP', miter_inner='SHARP')


def box(M, mn, mx, mid, bevel=0.003, segs=1, grain=None, matrix=None, uvoff=(0, 0), drop_bottom=False):
    """Axis-aligned box between mn and mx (local), optional matrix, bevelled edges.
    drop_bottom removes downward faces (planar-lightmapped parts must not overlap in UV2)."""
    mn, mx = V(mn), V(mx)
    size = mx - mn
    if min(size) <= 1e-5:
        return
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bmesh.ops.translate(bm, vec=(mn + mx) / 2, verts=bm.verts)
    b = min(bevel, min(size) * 0.45)
    _bevel(bm, b, segs)
    if drop_bottom:
        if matrix is not None:
            bm.transform(matrix)
            matrix = None
        bm.normal_update()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < -0.3], context='FACES')
    M.add_bm(bm, mid, matrix=matrix, grain=grain, uvoff=uvoff)


def oriented_box(M, center, x, y, z, hx, hy, hz, mid, bevel=0.003, segs=1, grain=None, uvoff=(0, 0)):
    """Box with half sizes along orthonormal axes x, y, z around center (z flipped if left-handed)."""
    x, y, z = Vector(x), Vector(y), Vector(z)
    if x.cross(y).dot(z) < 0:
        z = -z
    m = Matrix((
        (x[0], y[0], z[0], center[0]),
        (x[1], y[1], z[1], center[1]),
        (x[2], y[2], z[2], center[2]),
        (0, 0, 0, 1)))
    box(M, (-hx, -hy, -hz), (hx, hy, hz), mid, bevel=bevel, segs=segs, grain=grain, matrix=m, uvoff=uvoff)


def prism(M, poly, o, S, T, depth, mid, bevel=0.0, segs=1, grain=None, uvoff=(0, 0)):
    """Extrude a 2D polygon (s,t in the frame o,S,T; CCW) by `depth` along S x T (the polygon is the back face)."""
    W = S.cross(T).normalized()
    bm = bmesh.new()
    vs = [bm.verts.new(o + S * p[0] + T * p[1]) for p in poly]
    f = bm.faces.new(vs)
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    top = [e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=W * depth, verts=top)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    _bevel(bm, bevel, segs)
    M.add_bm(bm, mid, grain=grain, uvoff=uvoff)


def lathe(M, prof, center, mid, segs=12, axis=None, cap=True, uvoff=(0, 0)):
    """Surface of revolution: prof = [(r, z)] bottom->top about a vertical axis through center."""
    center = V(center)
    rot = axis or Matrix.Identity(3)
    verts, faces, luv = [], [], []
    n = len(prof)
    for j, (r, z) in enumerate(prof):
        for i in range(segs):
            a = 2 * math.pi * i / segs
            verts.append(center + rot @ Vector((r * math.cos(a), r * math.sin(a), z)))
    lens = [0.0]
    for j in range(1, n):
        lens.append(lens[-1] + math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]))
    for j in range(n - 1):
        for i in range(segs):
            i2 = (i + 1) % segs
            a, b, c, d = j * segs + i, j * segs + i2, (j + 1) * segs + i2, (j + 1) * segs + i
            faces.append([a, b, c, d])
            r = max(prof[j][0], 0.01)
            circ = 2 * math.pi * r
            luv.append([(circ * i / segs, lens[j]), (circ * (i + 1) / segs, lens[j]),
                        (circ * (i + 1) / segs, lens[j + 1]), (circ * i / segs, lens[j + 1])])
    if cap:
        if prof[0][0] > 1e-5:
            faces.append(list(reversed(range(segs))))
            luv.append([(0, 0)] * segs)
        if prof[-1][0] > 1e-5:
            faces.append([(n - 1) * segs + i for i in range(segs)])
            luv.append([(0, 0)] * segs)
    M.piece(verts, faces, mid, loop_uvs=luv, uvoff=uvoff)


def cylinder_between(M, a, b, r, mid, segs=8, cap=True):
    a, b = V(a), V(b)
    d = b - a
    L = d.length
    z = d.normalized()
    x = z.orthogonal().normalized()
    y = z.cross(x)
    rot = Matrix((x, y, z)).transposed()
    lathe(M, [(r, 0.0), (r, L)], a, mid, segs=segs, axis=rot, cap=cap)


# --------------------------------------------------------------------------------------------- sweeps
def sweep(M, path, profile, mid, up=UP, closed=False, caps=(True, True), side_sign=1.0, uvoff=(0, 0),
          cap_close=True, closed_profile=False):
    """Sweep a 2D profile [(x, y)] along a 3D polyline with mitered joints.

    Frame per segment: T = direction, B = `up` made orthogonal to T, N = side_sign * (B x T) (left of T when
    up = +z and side_sign = 1). Profile x goes along N, y along B. Faces are wound so that the surface faces
    +N/+B when the profile runs from (0, 0) upward/outward (a moulding hugging a wall on the right of N).
    """
    P = [V(p) for p in path]
    capring = len(profile)
    if closed_profile:
        profile = list(profile) + [profile[0]]
    npts = len(P)
    nseg = npts if closed else npts - 1
    frames = []
    for s in range(nseg):
        a, b = P[s], P[(s + 1) % npts]
        T = (b - a).normalized()
        B = (up - T * up.dot(T)).normalized()
        N = B.cross(T) * side_sign
        frames.append((T, N, B))
    rings = []
    for i in range(npts):
        if closed or 0 < i < npts - 1:
            fa = frames[(i - 1) % nseg]
            fb = frames[i % nseg]
            m = (fa[0] + fb[0]).normalized()
            ring = []
            for (x, y) in profile:
                off = fa[1] * x + fa[2] * y
                den = fa[0].dot(m)
                lam = -off.dot(m) / den if abs(den) > 1e-6 else 0.0
                # average B so vertical profiles stay continuous on sloped joints
                ring.append(P[i] + off + fa[0] * lam)
            rings.append(ring)
        else:
            f = frames[0] if i == 0 else frames[-1]
            rings.append([P[i] + f[1] * x + f[2] * y for (x, y) in profile])
    k = len(profile)
    plen = [0.0]
    for j in range(1, k):
        plen.append(plen[-1] + math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]))
    along = [0.0]
    for i in range(1, npts):
        along.append(along[-1] + (P[i] - P[i - 1]).length)
    if closed:
        along.append(along[-1] + (P[0] - P[-1]).length)
    # one piece per straight segment: mitre corners become seams, so every run unwraps as a straight strip
    # (a loop around a room would otherwise project as one huge hollow lightmap island)
    for s in range(nseg):
        i0, i1 = s, (s + 1) % npts
        verts = list(rings[i0]) + list(rings[i1])
        faces, luv = [], []
        for j in range(k - 1):
            a, b, c, d = j, k + j, k + j + 1, j + 1
            faces.append([a, d, c, b] if side_sign > 0 else [a, b, c, d])
            u0, u1 = along[s], along[s + 1]
            q = [(u0, plen[j]), (u0, plen[j + 1]), (u1, plen[j + 1]), (u1, plen[j])]
            luv.append(q if side_sign > 0 else [q[0], q[3], q[2], q[1]])
        M.piece(verts, faces, mid, loop_uvs=luv, uvoff=uvoff)
    if not closed and cap_close:
        for end, ci in ((0, caps[0]), (npts - 1, caps[1])):
            if not ci:
                continue
            ring = list(range(capring))
            f = ring if (end != 0) == (side_sign > 0) else list(reversed(ring))
            uv = [(profile[j][0], profile[j][1]) for j in f]
            M.piece([rings[end][j] for j in range(capring)], [f], mid, loop_uvs=[uv], uvoff=uvoff)


def arc_pts(cx, cy, r, a0, a1, n):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def ogee(x0, y0, x1, y1, n=4):
    """S-curve from (x0,y0) to (x1,y1): cove then bead (cyma recta)."""
    pts = []
    for i in range(n * 2 + 1):
        t = i / (2 * n)
        s = 0.5 - 0.5 * math.cos(math.pi * t)
        pts.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * s))
    return pts


def quarter(x0, y0, x1, y1, n=3, convex=True):
    """Quarter-round from (x0,y0) to (x1,y1)."""
    pts = []
    for i in range(n + 1):
        a = (math.pi / 2) * i / n
        if convex:
            pts.append((x0 + (x1 - x0) * math.sin(a), y0 + (y1 - y0) * (1 - math.cos(a))))
        else:
            pts.append((x0 + (x1 - x0) * (1 - math.cos(a)), y0 + (y1 - y0) * math.sin(a)))
    return pts


def dedupe(pts, eps=1e-6):
    out = []
    for p in pts:
        if not out or abs(out[-1][0] - p[0]) > eps or abs(out[-1][1] - p[1]) > eps:
            out.append(p)
    return out


# --------------------------------------------------------------------------------------------- 1D / 2D helpers
def subtract_intervals(a, b, cuts):
    """[a,b] minus a list of (c0,c1) -> list of (x0,x1)."""
    segs = [(a, b)]
    for c0, c1 in cuts:
        nxt = []
        for s0, s1 in segs:
            if c1 <= s0 or c0 >= s1:
                nxt.append((s0, s1))
                continue
            if c0 > s0:
                nxt.append((s0, c0))
            if c1 < s1:
                nxt.append((c1, s1))
        segs = nxt
    return [(s0, s1) for s0, s1 in segs if s1 - s0 > 1e-4]


def clip_poly(poly, a, b, c):
    """Sutherland-Hodgman: keep the half-plane a*x + b*y <= c."""
    out = []
    n = len(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        fp = a * p[0] + b * p[1] - c
        fq = a * q[0] + b * q[1] - c
        if fp <= 0:
            out.append(p)
        if (fp < 0 < fq) or (fq < 0 < fp):
            t = fp / (fp - fq)
            out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    return out
