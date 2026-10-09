"""Prop modelling kit (lane A). Pure geometry: bmesh primitives -> Part accumulators -> one mesh object per part.

Conventions (docs/PROPS.md):
- PLAN space, metres, Z-up. A prop's FRONT faces -y at yaw 0; its origin is the centre of its base (z = 0 at the floor).
- A Part is one exported glTF node. Geometry is added per material id (src/shared/material-spec.json); each id becomes
  a material slot -> one glTF primitive. Moving pieces (doors, the VACANCY plate, planks) are separate Parts whose
  origin sits on the hinge/pivot.
- UV0 ('UVMap' -> TEXCOORD_0 -> three `uv`) is a box projection computed in each primitive's LOCAL frame, in METRES,
  with u running along the primitive's longest axis (wood grain follows the plank). Runtime tiling = 1 / tileMetres.
  Every primitive gets a seeded random UV offset so repeated pieces don't show the same texture patch.
- Imperfection comes from seeded coherent noise (mathutils.noise) applied in prop space, so touching pieces move
  together and never crack apart.
"""
import math
import random
import zlib

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

from lib import materials

TAU = math.tau


# ----------------------------------------------------------------------------------------------- random + transforms
class Rng(random.Random):
    """Seeded RNG with a few modelling helpers. Always derive from the prop seed so rebuilds are identical."""

    def u(self, a, b):
        return self.uniform(a, b)

    def j(self, amp):
        """Symmetric jitter in [-amp, amp]."""
        return self.uniform(-amp, amp)

    def chance(self, p):
        return self.random() < p

    def sub(self, salt):
        # zlib.crc32, not hash(): str hashes are salted per process (PYTHONHASHSEED), which made every props /
        # corridor run produce different geometry (and lightmap UV2) from the same code (lane A round C)
        return Rng(zlib.crc32(repr((self.random(), salt)).encode()) & 0xFFFFFFFF)


def T(loc=(0, 0, 0), rot=(0, 0, 0), scale=None):
    """Matrix from location, XYZ Euler rotation (radians) and optional scale (number or xyz)."""
    from mathutils import Euler
    m = Matrix.Translation(Vector(loc)) @ Euler(rot, 'XYZ').to_matrix().to_4x4()
    if scale is not None:
        s = (scale, scale, scale) if isinstance(scale, (int, float)) else scale
        m = m @ Matrix.Diagonal((*s, 1.0))
    return m


def rot_to(direction, up=(0, 0, 1)):
    """Rotation matrix taking +z to `direction`."""
    d = Vector(direction).normalized()
    return d.to_track_quat('Z', 'Y').to_matrix().to_4x4()


# ----------------------------------------------------------------------------------------------- bmesh primitives
def _bm():
    return bmesh.new()


def bevel(bm, width, segments=2, edges=None, profile=0.5):
    if width <= 0:
        return bm
    geom = list(bm.edges) if edges is None else list(edges)
    bmesh.ops.bevel(bm, geom=geom, offset=width, offset_type='OFFSET', segments=segments, profile=profile,
                    affect='EDGES', clamp_overlap=True)
    return bm


def bisect(bm, axis, positions):
    """Add edge loops at the given coordinates along axis 0/1/2 (for bending, sagging and noise)."""
    no = [0, 0, 0]
    no[axis] = 1
    for p in positions:
        co = [0, 0, 0]
        co[axis] = p
        bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), dist=1e-6,
                               plane_co=co, plane_no=no)
    return bm


def box(sx, sy, sz, bevel_w=0.003, segs=2, cuts=None, center=(0, 0, 0), base=False):
    """Box of size sx*sy*sz, bevelled. base=True puts z=0 at its bottom. cuts={axis: n} adds loops (after bevel)."""
    bm = _bm()
    bmesh.ops.create_cube(bm, size=1.0)
    cz = sz / 2 if base else 0
    for v in bm.verts:
        v.co = Vector((v.co.x * sx + center[0], v.co.y * sy + center[1], v.co.z * sz + center[2] + cz))
    bw = min(bevel_w, 0.45 * min(sx, sy, sz))
    bevel(bm, bw, segs)
    if cuts:
        dims = (sx, sy, sz)
        for axis, n in cuts.items():
            lo = center[axis] - dims[axis] / 2 + (cz if axis == 2 else 0)
            bisect(bm, axis, [lo + dims[axis] * (i + 1) / (n + 1) for i in range(n)])
    return bm


def lathe(profile, n=24, cap_bottom=True, cap_top=True, a0=0.0, a1=TAU, closed=False):
    """Surface of revolution about z. profile: [(r, z), ...] bottom to top; r=0 makes a pole.

    closed=True joins the last profile point back to the first (a ring/torus-like solid, e.g. a rolled rim)."""
    if closed:
        profile = list(profile) + [profile[0]]
        cap_bottom = cap_top = False
    bm = _bm()
    full = abs(a1 - a0 - TAU) < 1e-6
    segs = n if full else n + 1
    rings = []
    for r, z in profile:
        if r <= 1e-7:
            rings.append([bm.verts.new((0, 0, z))])
            continue
        ring = []
        for i in range(segs):
            a = a0 + (a1 - a0) * i / n
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
        rings.append(ring)
    for ra, rb in zip(rings, rings[1:]):
        if len(ra) == 1 and len(rb) == 1:
            continue
        m = n if full else n
        for i in range(m):
            i2 = (i + 1) % segs if full else i + 1
            if len(ra) == 1:
                bm.faces.new((ra[0], rb[i], rb[i2]))
            elif len(rb) == 1:
                bm.faces.new((ra[i], ra[i2], rb[0]))
            else:
                bm.faces.new((ra[i], ra[i2], rb[i2], rb[i]))
    if full:
        if cap_bottom and len(rings[0]) > 2:
            bm.faces.new(list(reversed(rings[0])))
        if cap_top and len(rings[-1]) > 2:
            bm.faces.new(rings[-1])
    if closed:
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return bm


def cyl(r, h, n=16, r_top=None, bevel_w=0.0, z0=0.0):
    """Cylinder on z (z0..z0+h), optionally tapered, with a small edge round built into the profile."""
    rt = r if r_top is None else r_top
    b = min(bevel_w, 0.4 * min(r, rt, h / 2))
    if b > 0:
        prof = [(0, z0), (r - b, z0), (r - b * 0.3, z0 + b * 0.3), (r, z0 + b), (rt, z0 + h - b),
                (rt - b * 0.3, z0 + h - b * 0.3), (rt - b, z0 + h), (0, z0 + h)]
    else:
        prof = [(0, z0), (r, z0), (rt, z0 + h), (0, z0 + h)]
    return lathe(prof, n)


def sphere(r, seg=16, rings=10):
    bm = _bm()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    return bm


def extrude(outline, depth, bevel_w=0.0, segs=2, holes=None):
    """Prism from a 2D outline [(x, y), ...] (CCW) extruded along +z from 0 to depth."""
    bm = _bm()
    vs = [bm.verts.new((x, y, 0)) for x, y in outline]
    f = bm.faces.new(vs)
    if f.normal.z > 0:
        f.normal_flip()
    ret = bmesh.ops.extrude_face_region(bm, geom=[f], use_keep_orig=True)
    top = [e for e in ret['geom'] if isinstance(e, bmesh.types.BMVert)]
    for v in top:
        v.co.z += depth
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    if bevel_w > 0:
        bevel(bm, min(bevel_w, depth * 0.45), segs)
    return bm


def plane(sx, sy, nx=1, ny=1, center=(0, 0, 0)):
    bm = _bm()
    bmesh.ops.create_grid(bm, x_segments=nx, y_segments=ny, size=0.5)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx + center[0], v.co.y * sy + center[1], center[2]))
    return bm


def _frames(pts, closed=False):
    """Parallel-transport frames along a polyline; tangents are the bisectors of adjacent segments."""
    n = len(pts)
    tans = []
    for i in range(n):
        if closed:
            a, b = pts[(i - 1) % n], pts[(i + 1) % n]
            d0, d1 = (pts[i] - a), (b - pts[i])
        else:
            d0 = pts[i] - pts[max(0, i - 1)]
            d1 = pts[min(n - 1, i + 1)] - pts[i]
        d0 = d0.normalized() if d0.length > 1e-9 else None
        d1 = d1.normalized() if d1.length > 1e-9 else None
        if d0 is None and d1 is None:
            t = Vector((0, 0, 1))
        elif d0 is None:
            t = d1
        elif d1 is None:
            t = d0
        else:
            t = d0 + d1
            t = t.normalized() if t.length > 1e-9 else d1
        tans.append(t)
    t0 = tans[0]
    ref = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
    nrm = t0.cross(ref).normalized()
    frames = []
    for i, t in enumerate(tans):
        if i > 0:
            q = tans[i - 1].rotation_difference(t)
            nrm = (q @ nrm)
            nrm = (nrm - t * nrm.dot(t)).normalized()
        frames.append((t, nrm, t.cross(nrm)))
    return frames


def _miter(pts, i, closed):
    """(bend direction k, scale) for the section at an interior corner: stretch along k by 1/cos(half angle)."""
    n = len(pts)
    if not closed and (i == 0 or i == n - 1):
        return None, 1.0
    d0 = (pts[i] - pts[(i - 1) % n])
    d1 = (pts[(i + 1) % n] - pts[i])
    if d0.length < 1e-9 or d1.length < 1e-9:
        return None, 1.0
    d0.normalize()
    d1.normalize()
    c = max(-1.0, min(1.0, d0.dot(d1)))
    if c > 0.9999:
        return None, 1.0
    half = math.acos(c) / 2
    k = (d1 - d0)
    if k.length < 1e-9:
        return None, 1.0
    return k.normalized(), 1.0 / max(0.2, math.cos(half))


def fillet(points, radius, segs=4):
    """Round the interior corners of a polyline with arcs of the given radius."""
    P = [Vector(p) for p in points]
    if len(P) < 3 or radius <= 0:
        return P
    out = [P[0]]
    for i in range(1, len(P) - 1):
        a, b, c = P[i - 1], P[i], P[i + 1]
        d1 = (a - b)
        d2 = (c - b)
        l1, l2 = d1.length, d2.length
        if l1 < 1e-6 or l2 < 1e-6:
            continue
        d1.normalize()
        d2.normalize()
        ang = d1.angle(d2)
        if ang > math.pi - 1e-3:
            out.append(b)
            continue
        t = min(radius / math.tan(ang / 2), l1 * 0.45, l2 * 0.45)
        p1 = b + d1 * t
        p2 = b + d2 * t
        for k in range(segs + 1):
            s = k / segs
            # quadratic Bezier through the corner: good enough for small radii
            out.append(p1 * (1 - s) ** 2 + b * 2 * s * (1 - s) + p2 * s * s)
    out.append(P[-1])
    return out


def tube(points, radius, sides=8, caps=True, section=None, radii=None, twist=0.0, closed=False, miter=True):
    """Sweep a circle (or a 2D `section` [(x, y), ...]) along a polyline, with mitred corners.

    radii: per-point scale. closed: the path loops (no caps). The section's x runs along the frame normal, y along
    the binormal; for planar paths in XZ the normal starts perpendicular to the path in-plane.
    """
    P = [Vector(p) for p in points]
    if closed and (P[0] - P[-1]).length < 1e-9:
        P = P[:-1]
    fr = _frames(P, closed)
    if radii and len(radii) != len(P):   # resample per-point radii onto the (e.g. filleted) path
        src = list(radii)
        radii = []
        for i in range(len(P)):
            f = i / max(1, len(P) - 1) * (len(src) - 1)
            k = min(int(f), len(src) - 2)
            radii.append(src[k] + (src[k + 1] - src[k]) * (f - k))
    if section is None:
        section = [(math.cos(TAU * k / sides), math.sin(TAU * k / sides)) for k in range(sides)]
        section = [(x * radius, y * radius) for x, y in section]
    bm = _bm()
    rings = []
    for i, (p, (t, nrm, bn)) in enumerate(zip(P, fr)):
        s = radii[i] if radii else 1.0
        tw = twist * i
        c, sn = math.cos(tw), math.sin(tw)
        k, ms = _miter(P, i, closed) if miter else (None, 1.0)
        ring = []
        for x, y in section:
            xx, yy = (x * c - y * sn) * s, (x * sn + y * c) * s
            o = nrm * xx + bn * yy
            if k is not None:
                o = o + k * (o.dot(k) * (ms - 1.0))
            ring.append(bm.verts.new(p + o))
        rings.append(ring)
    m = len(section)
    pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if closed else [])
    for ra, rb in pairs:
        for k in range(m):
            bm.faces.new((ra[k], ra[(k + 1) % m], rb[(k + 1) % m], rb[k]))
    if caps and not closed:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return bm


def arc(center, radius, a0, a1, n, plane='xz', z=0.0):
    """Points on a circular arc in the given plane (angles in radians)."""
    out = []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        u, v = radius * math.cos(a), radius * math.sin(a)
        if plane == 'xz':
            out.append((center[0] + u, center[1], center[2] + v))
        elif plane == 'yz':
            out.append((center[0], center[1] + u, center[2] + v))
        else:
            out.append((center[0] + u, center[1] + v, center[2]))
    return out


def rect_section(w, h, r=0.0, n=2):
    """Rounded-rectangle 2D section (w along frame normal, h along binormal), CCW."""
    if r <= 0:
        return [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    r = min(r, w / 2 * 0.95, h / 2 * 0.95)
    pts = []
    for cx, cy, a0 in ((w / 2 - r, -h / 2 + r, -math.pi / 2), (w / 2 - r, h / 2 - r, 0),
                       (-w / 2 + r, h / 2 - r, math.pi / 2), (-w / 2 + r, -h / 2 + r, math.pi)):
        for k in range(n + 1):
            a = a0 + (math.pi / 2) * k / n
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


# ----------------------------------------------------------------------------------------------- deformers
def deform(bm, fn):
    """fn(Vector) -> Vector, applied to every vertex."""
    for v in bm.verts:
        v.co = fn(v.co.copy())
    return bm


def transform(bm, m):
    bmesh.ops.transform(bm, matrix=m, verts=list(bm.verts))
    return bm


def nz(p, seed, freq):
    """Coherent noise vector in [-1, 1]^3 at point p."""
    q = Vector(p) * freq + Vector((seed * 17.31 % 97.0, seed * 5.77 % 89.0, seed * 3.13 % 83.0))
    return noise.noise_vector(q)


def jitter(bm, amp, freq=6.0, seed=0, axes=(1, 1, 1)):
    for v in bm.verts:
        d = nz(v.co, seed, freq)
        v.co += Vector((d.x * amp * axes[0], d.y * amp * axes[1], d.z * amp * axes[2]))
    return bm


def sag(bm, axis, length, amount, down=2):
    """Parabolic sag along `axis` (centred), displacing along `down` axis (negative)."""
    for v in bm.verts:
        t = v.co[axis] / (length / 2) if length else 0
        v.co[down] -= amount * max(0.0, 1 - t * t)
    return bm


def bend_z(bm, amount_per_m2):
    """Bow along x: z += k * x^2 (use for warped boards)."""
    for v in bm.verts:
        v.co.z += amount_per_m2 * v.co.x * v.co.x
    return bm


def screw_head(d=0.0079, slot=True):
    """Slotted round-head wood screw head, axis +z, sitting on z=0 (#8 = 7.9 mm; slot 1.2 mm wide, 0.8 mm deep).
    Two half-domes either side of the slot over a slot floor; <= 120 tris."""
    r = d / 2
    dome = [(r, 0.0), (r * 0.95, r * 0.25), (r * 0.7, r * 0.45), (0.0, r * 0.52)]
    if not slot:
        return lathe(dome, n=12)
    out = merge(*[transform(lathe(dome, n=6, a0=-math.pi / 2, a1=math.pi / 2),
                            Matrix.Translation((0.0006 * s, 0, 0)) @ Matrix.Rotation(0 if s > 0 else math.pi, 4, 'Z'))
                  for s in (1, -1)])
    return merge(out, cyl(r * 0.92, max(0.0002, r * 0.52 - 0.0008), n=12))


def nail_head(d=0.005):
    """Cut-nail head: a slightly domed rectangle d x 0.7 d, 1.2 mm proud, z=0 at the surface."""
    bm = box(d, d * 0.7, 0.0012, 0.0004, 1, base=True)
    for v in bm.verts:
        if v.co.z > 0.001:
            v.co.z += 0.0003 * (1 - (2 * v.co.x / d) ** 2)
    return bm


def hinge_butt(h=0.064, w=0.05, knuckles=5, leaves=(-1, 1), barrel=True):
    """Butt hinge seen closed on a door edge: two leaves (w/2 each, 2 mm) + a knuckle barrel (Ø 6 mm in `knuckles`
    segments with 0.4 mm gaps) along z, 3 screw heads per leaf. Leaves lie in the y=0 plane, barrel at x=0.
    leaves/barrel pick the pieces (a door carries its own leaf; the carcass the other leaf + barrel)."""
    parts = []
    for s in leaves:
        parts.append(box(w / 2 - 0.003, 0.002, h, 0.0004, 1, center=(s * (w / 4 + 0.0015), 0, 0)))
        for k in (-1, 0, 1):
            m = Matrix.Translation((s * w / 4, -0.001, k * h * 0.32)) @ Matrix.Rotation(math.pi / 2, 4, 'X')
            parts.append(transform(screw_head(0.0055), m))
    seg = h / knuckles
    for k in (range(knuckles) if barrel else ()):
        parts.append(transform(cyl(0.003, seg - 0.0004, n=12), Matrix.Translation((0, 0, -h / 2 + k * seg + 0.0002))))
    return merge(*parts)


def escutcheon(h=0.04, w=0.018):
    """Keyhole plate h x w (1 mm, domed edges) with a 10 x 4 mm keyhole read as a dark inset (separate slot box
    returned second: give it a dark material). Plate faces -y, centred on the origin."""
    plate = box(w, 0.0012, h, 0.0005, 1)
    hole = merge(transform(cyl(0.0022, 0.0004, n=12), Matrix.Translation((0, -0.0004, 0.002)) @
                           Matrix.Rotation(math.pi / 2, 4, 'X')),
                 box(0.0018, 0.0004, 0.006, 0.0, 1, center=(0, -0.0006, -0.0015)))
    return plate, hole


def knurl(r, h, n=24, depth=0.0004):
    """Straight-knurled cylinder (axis z, from z=0): n ridges round the rim."""
    bm = cyl(r, h, n=n * 2)
    for v in bm.verts:
        a = math.atan2(v.co.y, v.co.x)
        k = int(round(a / (math.pi / n))) % 2
        rr = math.hypot(v.co.x, v.co.y)
        if rr > r * 0.9:
            f = (r - depth * k) / rr
            v.co.x *= f
            v.co.y *= f
    return bm


def merge(*bms):
    """Concatenate bmeshes into the first (topology copied through a temp mesh)."""
    out = bms[0]
    for b in bms[1:]:
        me = bpy.data.meshes.new('_tmp')
        b.to_mesh(me)
        out.from_mesh(me)
        bpy.data.meshes.remove(me)
        b.free()
    return out


# ----------------------------------------------------------------------------------------------- UVs
def _box_uv(bm, grain_axis=None, offset=(0.0, 0.0), scale=1.0):
    """Metric box projection in the primitive's local frame; u runs along grain_axis (default: longest extent)."""
    if not bm.verts:
        return {}
    lo = Vector((min(v.co.x for v in bm.verts), min(v.co.y for v in bm.verts), min(v.co.z for v in bm.verts)))
    hi = Vector((max(v.co.x for v in bm.verts), max(v.co.y for v in bm.verts), max(v.co.z for v in bm.verts)))
    ext = hi - lo
    order = sorted(range(3), key=lambda a: -ext[a])
    L = order[0] if grain_axis is None else grain_axis
    uvs = {}
    for f in bm.faces:
        n = f.normal
        a = max(range(3), key=lambda k: abs(n[k]))
        rest = [k for k in (0, 1, 2) if k != a]
        if L in rest:
            ua, va = L, [k for k in rest if k != L][0]
        else:
            ua, va = sorted(rest, key=lambda k: -ext[k])
        uvs[f.index] = [((l.vert.co[ua] - lo[ua]) * scale + offset[0], (l.vert.co[va] - lo[va]) * scale + offset[1])
                        for l in f.loops]
    return uvs


# ----------------------------------------------------------------------------------------------- Part (one glTF node)
class Part:
    """Geometry accumulator for one exported node. add() takes ownership of the bmesh (frees it)."""

    def __init__(self, name, rng=None):
        self.name = name
        self.rng = rng or Rng(0)
        self.verts = []
        self.faces = []
        self.face_mat = []
        self.face_smooth = []
        self.loop_uv = []
        self.mats = []
        self.extras = {}
        self.children = []   # (Part, matrix) — attached as child nodes (e.g. a hinged door inside a cabinet)
        self.origin = Matrix.Identity(4)   # node transform relative to its parent (pivot for moving parts)
        self.subsurf = 0                     # Catmull-Clark levels applied at build (car body panels)
        self.sharp_angle = None              # override build()'s auto-sharp angle (trees: smooth thin tubes)
        self.no_sharp = False                # round E: cloth — never split normals by angle (keeps wear finishing)

    def add(self, bm, mat, m=None, smooth=True, grain=None, uv_scale=1.0, face_mats=None):
        """Add a bmesh (freed afterwards). face_mats: optional per-face material ids (bm.faces order) for one
        connected mesh with several materials (e.g. the subdivided car shell)."""
        bm.verts.index_update()
        bm.faces.index_update()
        bm.normal_update()
        off = (self.rng.u(0, 3.0), self.rng.u(0, 3.0))
        uvs = _box_uv(bm, grain, off, uv_scale)
        if m is not None:
            bmesh.ops.transform(bm, matrix=m, verts=list(bm.verts))
        for mid in ([mat] if face_mats is None else face_mats):
            if mid not in self.mats:
                self.mats.append(mid)
        mi = self.mats.index(mat) if face_mats is None else None
        base = len(self.verts)
        self.verts.extend(v.co.copy() for v in bm.verts)
        for f in bm.faces:
            self.faces.append([base + v.index for v in f.verts])
            self.face_mat.append(mi if face_mats is None else self.mats.index(face_mats[f.index]))
            self.face_smooth.append(smooth)
            self.loop_uv.append(uvs.get(f.index) or [(0.0, 0.0)] * len(f.verts))
        bm.free()
        return self

    def add_grid(self, nx, ny, fn, mat, uv_size=None, smooth=True, closed_u=False, flip=False):
        """Parametric surface: fn(u, v) -> (x, y, z) for u, v in [0, 1] on an nx * ny quad grid.

        UVs are normalised 0..1 (decal canvases: pages, photos) unless uv_size=(w, h) metres is given (cloth tiling).
        Thin single-layer surfaces should use a double-sided material id suffix '@2s'.
        """
        if mat not in self.mats:
            self.mats.append(mat)
        mi = self.mats.index(mat)
        base = len(self.verts)
        cols = nx if closed_u else nx + 1
        for j in range(ny + 1):
            for i in range(cols):
                self.verts.append(Vector(fn(i / nx, j / ny)))
        su, sv = (uv_size or (1.0, 1.0))
        ou, ov = ((self.rng.u(0, 3), self.rng.u(0, 3)) if uv_size else (0.0, 0.0))
        for j in range(ny):
            for i in range(nx):
                i2 = (i + 1) % cols if closed_u else i + 1
                q = [base + j * cols + i, base + j * cols + i2, base + (j + 1) * cols + i2, base + (j + 1) * cols + i]
                uv = [(i / nx * su + ou, j / ny * sv + ov), ((i + 1) / nx * su + ou, j / ny * sv + ov),
                      ((i + 1) / nx * su + ou, (j + 1) / ny * sv + ov), (i / nx * su + ou, (j + 1) / ny * sv + ov)]
                if flip:
                    q, uv = q[::-1], uv[::-1]
                self.faces.append(q)
                self.face_mat.append(mi)
                self.face_smooth.append(smooth)
                self.loop_uv.append(uv)
        return self

    def jitter(self, amp, freq=4.0, seed=None, zmin=None):
        """Coherent noise over the whole part (prop space). zmin: leave verts below this z alone (feet on floor)."""
        s = self.rng.randint(0, 9999) if seed is None else seed
        for i, v in enumerate(self.verts):
            if zmin is not None and v.z <= zmin:
                continue
            d = nz(v, s, freq)
            self.verts[i] = v + d * amp
        return self

    def apply(self, m, ground=False):
        """Transform all geometry (and child placements) by m; ground=True then drops it so min z = 0."""
        self.verts = [m @ v for v in self.verts]
        self.children = [(c, (m @ cm) if cm is not None else (m @ c.origin)) for c, cm in self.children]
        if ground and self.verts:
            dz = -min(v.z for v in self.verts)
            self.verts = [v + Vector((0, 0, dz)) for v in self.verts]
            self.children = [(c, Matrix.Translation((0, 0, dz)) @ cm) for c, cm in self.children]
        return self

    def merge(self, other, m=None):
        """Append another Part's geometry (optionally transformed) into this one; its children come along."""
        mi = []
        for mid in other.mats:
            if mid not in self.mats:
                self.mats.append(mid)
            mi.append(self.mats.index(mid))
        base = len(self.verts)
        self.verts.extend((m @ v) if m is not None else v.copy() for v in other.verts)
        self.faces.extend([i + base for i in f] for f in other.faces)
        self.face_mat.extend(mi[k] for k in other.face_mat)
        self.face_smooth.extend(other.face_smooth)
        self.loop_uv.extend(other.loop_uv)
        for c, cm in other.children:
            self.children.append((c, (m @ (cm if cm is not None else c.origin)) if m is not None else cm))
        return self

    def tri_count(self):
        return sum(len(f) - 2 for f in self.faces)

    def build(self, collection=None, sharp_angle=48.0):
        """Create the Blender object (materials from the spec, smooth + sharp-by-angle, UV0). Returns the object.

        A Part without faces becomes an empty (an anchor node, e.g. a flame position or a hinge)."""
        if not self.faces:
            ob = empty(self.name, collection, self.extras)
            ob['_local'] = self.name
            ob.matrix_basis = self.origin
            for child, cm in self.children:
                c = child.build(collection, sharp_angle)
                c.parent = ob
                c.matrix_parent_inverse = Matrix.Identity(4)
                c.matrix_basis = cm if cm is not None else child.origin
            return ob
        me = bpy.data.meshes.new(self.name)
        me.from_pydata([tuple(v) for v in self.verts], [], self.faces)
        me.validate(clean_customdata=False)
        uv = me.uv_layers.new(name='UVMap')
        flat = []
        for luv in self.loop_uv:
            for u, v in luv:
                flat.extend((u, v))
        if len(flat) == len(uv.data) * 2:
            uv.data.foreach_set('uv', flat)
        me.polygons.foreach_set('material_index', self.face_mat)
        me.polygons.foreach_set('use_smooth', self.face_smooth)
        # wear finishing (props/wear.py, docs/PROPS-FINISH.md §1.4): support loops on the final topology
        from props import wear
        anchors = [(c.name.split('.')[0].split(' ')[0], (cm if cm is not None else c.origin).to_translation(), c.extras)
                   for c, cm in self.children if not c.faces and c.name.startswith('wear_')]
        self.children = [(c, cm) for c, cm in self.children if c.faces or not c.name.startswith('wear_')]
        finish = wear.ENABLED and not (self.extras.get('decal') or self.extras.get('print')) and self.sharp_angle is None
        skip = {i for i, mid in enumerate(self.mats) if wear.family(mid) in wear.NO_MASK_FAMILIES}
        if finish and wear.LOOPS and wear.CURRENT_TYPE in wear.LOOP_TYPES and not self.subsurf and len(skip) < len(self.mats):
            wear.support_loops(me, wear.loop_width(self.verts), skip)
        try:
            if not self.no_sharp:
                me.set_sharp_from_angle(angle=math.radians(self.sharp_angle or sharp_angle))
        except Exception:
            pass
        for mid in self.mats:
            me.materials.append(spec_material(mid))
        ob = bpy.data.objects.new(self.name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        if self.subsurf:
            from lib.scene import apply_all_modifiers
            md = ob.modifiers.new('subsurf', 'SUBSURF')
            md.levels = md.render_levels = int(self.subsurf)
            md.uv_smooth = 'PRESERVE_BOUNDARIES'
            apply_all_modifiers(ob)
            try:
                ob.data.set_sharp_from_angle(angle=math.radians(sharp_angle))
            except Exception:
                pass
        if finish and len(skip) < len(self.mats):
            wear.weighted_normals(ob)
            wear.STATS[(wear.CURRENT_KEY or wear.CURRENT_TYPE, self.name)] = wear.bake(ob, wear.SCALARS.get(wear.CURRENT_TYPE, wear.DEFAULT), anchors, skip)['mean']
        for k, v in self.extras.items():
            ob[k] = v
        ob['_local'] = self.name
        ob.matrix_basis = self.origin
        for child, cm in self.children:
            c = child.build(collection, sharp_angle)
            c.parent = ob
            c.matrix_parent_inverse = Matrix.Identity(4)
            c.matrix_basis = cm if cm is not None else child.origin
        return ob


def spec_material(mid):
    """Material for a spec id. Single-sided (glTF doubleSided=false) unless the id carries the '@2s' suffix
    (cloth, paper, crepe: thin sheets seen from both sides). Both variants carry extras.material_id = the spec id."""
    base, two = (mid[:-3], True) if mid.endswith('@2s') else (mid, False)
    mat = materials.from_spec(base)
    if two:
        m2 = bpy.data.materials.get(base + '@2s')
        if m2 is None:
            m2 = mat.copy()
            m2.name = base + '@2s'
            m2['material_id'] = base
        m2.use_backface_culling = False
        m2['double_sided'] = True
        return m2
    mat.use_backface_culling = True
    return mat


def empty(name, collection=None, extras=None):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = 0.2
    (collection or bpy.context.scene.collection).objects.link(ob)
    for k, v in (extras or {}).items():
        ob[k] = v
    return ob


def decal(part, name, w, h, m, text, mat='paper_aged', style='painted', extra=None):
    """A flat text/label region as its own child Part: runtime draws `text` on it (our stroke font / stencil).

    The quad lies in local XZ facing -y (towards the viewer at yaw 0), centred on its origin; u runs 0..1 across
    the text, v 0..1 bottom->top (normalised, NOT metres — decals map the whole canvas).
    """
    d = Part(name, part.rng)
    bm = _bm()
    vs = [bm.verts.new(p) for p in ((-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2))]
    bm.faces.new(vs)
    bm.normal_update()
    d.mats.append(mat)
    d.verts.extend(v.co.copy() for v in vs)
    d.faces.append([0, 1, 2, 3])
    d.face_mat.append(0)
    d.face_smooth.append(False)
    d.loop_uv.append([(0, 0), (1, 0), (1, 1), (0, 1)])
    bm.free()
    d.extras = {'decal': style, 'text': text, 'decal_size_m': [round(w, 4), round(h, 4)], **(extra or {})}
    part.children.append((d, m))
    return d


GRIME = True    # PROPS-FINISH §4 + ruling (h) 2026-10-09: on (runtime decals.ts 'grime' + grime_decal spec are live)


def grime(part, quads):
    """All of a part's grime quads as ONE child Part '<part>_grime' (PROPS-FINISH §4.1): one mesh, one draw call.

    quads: [(cell, seed, loc, rot, w, h)] — each quad is built like decal() (local XZ, facing -y), placed by
    T(loc, rot) in the part's space and lifted 0.3 mm along its normal; its UVs map the 4x4 atlas cell
    (col + u) / 4, (row + v) / 4 with cell = row * 4 + col. rot (-pi/2, 0, 0) lays a quad face-up on a top.
    Returns None (builds nothing) while GRIME is off.
    """
    if not GRIME or not quads:
        return None
    g = Part(part.name + '_grime', part.rng)
    g.mats.append('grime_decal')
    for cell, seed, loc, rot, w, h in quads:
        m = T(loc, rot)
        n = (m.to_3x3() @ Vector((0, -1, 0))).normalized()
        col, row = cell % 4, cell // 4
        base = len(g.verts)
        for x, z in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)):
            g.verts.append(m @ Vector((x, 0, z)) + n * 0.0003)
        g.faces.append([base, base + 1, base + 2, base + 3])
        g.face_mat.append(0)
        g.face_smooth.append(False)
        g.loop_uv.append([((col + u) / 4, (row + v) / 4) for u, v in ((0, 0), (1, 0), (1, 1), (0, 1))])
    g.extras = {'decal': 'grime', 'grime': [[int(q[0]), int(q[1])] for q in quads],
                'decal_size_m': [round(max(q[4] for q in quads), 4), round(max(q[5] for q in quads), 4)]}
    part.children.append((g, T()))
    return g


def anchor(part, name, loc, extras=None):
    """Named empty child (glTF node without mesh): flame positions, hang points, lantern mounts."""
    a = Part(name, part.rng)
    a.extras = dict(extras or {})
    part.children.append((a, T(loc)))
    return a


# ----------------------------------------------------------------------------------------------- registry
REGISTRY = {}


def prop(type_id, instance_keys=(), budget=15000, preview=None):
    """Register a generator fn(params, rng) -> [Part, ...] for a level-layout prop `type`.

    instance_keys: params that do not change geometry (text on decals, per-instance offsets). Placements that differ
    only in these share one mesh; decal children carrying extras['text_param'] get the placement's value.
    budget: triangle budget checked by build_props.py and check_props.mjs.
    """
    def deco(fn):
        REGISTRY[type_id] = {'fn': fn, 'instance_keys': set(instance_keys), 'budget': budget, 'preview': preview}
        return fn
    return deco
