"""Garment construction from the body: shells (body region duplicated and projected onto an offset of the anatomy
SDF, with fold noise), lofted skirt tubes (convex hull of the body section + ease + gathered folds), curtain sheets
(apron), ribbons (straps, twine), plus region classification by nearest bone.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

from lib import noise
from . import body as bodymod
from . import sdf


# ------------------------------------------------------------------------------------------------ classification
def nearest_bone(P, J, names):
    """Label each point with the nearest bone segment among `names`; returns (idx (N,), t (N,), dist (N,))."""
    best = np.full(len(P), 1e9)
    lab = np.zeros(len(P), np.int64)
    tt = np.zeros(len(P))
    for i, nm in enumerate(names):
        a, b = J[nm]
        ab = b - a
        t = np.clip(((P - a) @ ab) / ab.dot(ab), 0.0, 1.0)
        d = sdf.norm(P - (a + t[:, None] * ab))
        m = d < best
        best[m] = d[m]
        lab[m] = i
        tt[m] = t[m]
    return lab, tt, best


def bone_names(J, prefixes):
    return [n for n in J if any(n.startswith(p) for p in prefixes)]


# ------------------------------------------------------------------------------------------------ mesh helpers
def new_object(name, verts, faces, coll=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.validate()
    ob = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(ob)
    for p in me.polygons:
        p.use_smooth = smooth
    return ob


def extract(src, vmask, name, coll=None):
    """New object with the faces of `src` whose vertices are ALL in vmask (bool per vertex)."""
    me = src.data
    P, _ = bodymod.mesh_arrays(me)
    keep_faces = []
    for p in me.polygons:
        vs = p.vertices
        if all(vmask[v] for v in vs):
            keep_faces.append(tuple(vs))
    used = sorted({v for f in keep_faces for v in f})
    remap = {v: i for i, v in enumerate(used)}
    return new_object(name, P[used], [[remap[v] for v in f] for f in keep_faces], coll)


def split_faces(ob, face_mask, name):
    """Separate the faces where face_mask (bool per polygon) into a new object `name` (keeps UVs, weights,
    modifiers, custom props). Works on meshes without shape keys. Returns the new object."""
    from lib.scene import select
    me = ob.data
    select([ob], ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_mode(type='FACE')
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.object.mode_set(mode='OBJECT')
    me.polygons.foreach_set('select', [bool(x) for x in face_mask])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    new = next(o for o in bpy.context.selected_objects if o is not ob)
    new.name = name
    new.data.name = name
    return new


def delete_verts(ob, vmask):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    kill = [bm.verts[i] for i in np.nonzero(vmask)[0]]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def boundary_verts(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    out = np.zeros(len(me.vertices), bool)
    for e in bm.edges:
        if e.is_boundary:
            out[e.verts[0].index] = True
            out[e.verts[1].index] = True
    bm.free()
    return out


def project_offset(ob, fn, offset, iters=6, relax=2, pin=None):
    """Move vertices onto the level set fn = offset(P) (offset: float or callable of P)."""
    me = ob.data
    P, E = bodymod.mesh_arrays(me)

    def g(X):
        off = offset(X) if callable(offset) else offset
        return fn(X) - off
    P = sdf.project(g, P, iters=iters, max_move=0.03)
    for _ in range(2):
        Q = bodymod.taubin(P, E, iters=relax)
        if pin is not None:
            Q[pin] = P[pin]
        P = sdf.project(g, Q, iters=3, max_move=0.02)
    bodymod.set_positions(me, P)
    return ob


def displace_normal(ob, amount):
    """amount: (N,) metres along the vertex normal."""
    me = ob.data
    P, _ = bodymod.mesh_arrays(me)
    N = bodymod.normals(me)
    bodymod.set_positions(me, P + N * amount[:, None])


def solidify(ob, thickness, offset=-1.0, rim=True):
    m = ob.modifiers.new('Solidify', 'SOLIDIFY')
    m.thickness = thickness
    m.offset = offset
    m.use_rim = rim
    m.use_even_offset = False
    m.use_quality_normals = True
    m.thickness_clamp = 1.0
    apply_modifiers(ob)


def apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    me.name = old.name
    bpy.data.meshes.remove(old)


def subdivide(ob, levels=1, simple=False):
    m = ob.modifiers.new('Sub', 'SUBSURF')
    m.levels = levels
    m.subdivision_type = 'SIMPLE' if simple else 'CATMULL_CLARK'
    apply_modifiers(ob)


def decimate(ob, ratio):
    if ratio >= 1.0:
        return
    m = ob.modifiers.new('Dec', 'DECIMATE')
    m.decimate_type = 'COLLAPSE'
    m.ratio = ratio
    m.use_collapse_triangulate = False
    apply_modifiers(ob)


def fold_field(P, axis_dir, center, amp, freq, seed, along_freq=None):
    """Fold displacement: waves around an axis (sleeves/trousers wrinkle perpendicular to the limb) + noise."""
    n1 = noise.fbm(P * freq, 3, seed)
    n2 = noise.ridged(P * freq * 1.7 + 3.1, 3, seed + 7)
    return amp * (0.65 * n1 + 0.35 * (n2 - 0.5))


# ------------------------------------------------------------------------------------------------ skirt
def section_boundary(fn, z, center, dirs=144, rmax=0.5, step=0.002):
    """Outer boundary points of the body's cross-section at height z (2D, outermost hit along each ray)."""
    th = np.linspace(0, 2 * math.pi, dirs, endpoint=False)
    rs = np.arange(rmax, 0.0, -step)
    X = np.empty((dirs * len(rs), 3))
    X[:, 0] = (center[0] + np.outer(np.sin(th), rs)).ravel()
    X[:, 1] = (center[1] - np.outer(np.cos(th), rs)).ravel()
    X[:, 2] = z
    d = fn(X).reshape(dirs, len(rs))
    inside = d < 0
    first = np.argmax(inside, axis=1)
    hit = inside.any(1)
    r = np.where(hit, rs[first], 0.0)
    pts = np.stack([center[0] + np.sin(th) * r, center[1] - np.cos(th) * r], 1)
    return pts[hit]


def convex_hull(pts):
    pts = sorted(map(tuple, pts))
    if len(pts) < 3:
        return np.array(pts)

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return np.array(lower[:-1] + upper[:-1])


def ray_polygon(center, th, poly):
    """Distance from center along direction theta (x = sin, y = -cos; 0 = front) to the polygon boundary."""
    d = np.array([math.sin(th), -math.cos(th)])
    best = 0.0
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        e = b - a
        m = np.array([[d[0], -e[0]], [d[1], -e[1]]])
        det = np.linalg.det(m)
        if abs(det) < 1e-12:
            continue
        s, u = np.linalg.solve(m, a - center)
        if s > 0 and -1e-9 <= u <= 1 + 1e-9:
            best = max(best, s)
    return best


def skirt(fn, z_top, z_hem, n_around, n_rings, ease, folds, seed=0, center_fn=None, hem_wave=0.0, name='skirt'):
    """Lofted tube from z_top down to z_hem (ring 0 = top). ease(z01) metres, folds(z01) fold amplitude metres."""
    rng = np.random.default_rng(seed)
    nf = 9
    phases = rng.uniform(0, 2 * math.pi, nf)
    freqs = rng.integers(5, 13, nf)
    amps = rng.uniform(0.4, 1.0, nf)
    verts = []
    zs = np.linspace(z_top, z_hem, n_rings)
    th = np.linspace(0, 2 * math.pi, n_around, endpoint=False)
    for ri, z in enumerate(zs):
        s = ri / (n_rings - 1)
        c = center_fn(z) if center_fn else np.array([0.0, 0.0])
        pts = section_boundary(fn, z, c)
        if len(pts) < 3:
            pts = np.array([[0.05, 0], [-0.05, 0], [0, 0.05], [0, -0.05]]) + c
        hull = convex_hull(pts)
        cc = hull.mean(0)
        e = ease(s)
        fa = folds(s)
        for t in th:
            r = ray_polygon(cc, t, hull) + e
            w = sum(a * math.sin(f * t + p + s * 1.3 * a) for a, f, p in zip(amps, freqs, phases)) / nf
            r += fa * w * 2.2
            zz = z + (hem_wave * math.sin(3 * t + phases[0]) if ri == n_rings - 1 else 0.0) * s
            verts.append((cc[0] + math.sin(t) * r, cc[1] - math.cos(t) * r, zz))
    faces = []
    for ri in range(n_rings - 1):
        for i in range(n_around):
            j = (i + 1) % n_around
            a, b = ri * n_around + i, ri * n_around + j
            faces.append((a, b, b + n_around, a + n_around))
    return new_object(name, verts, faces)


# ------------------------------------------------------------------------------------------------ curtain sheet (apron)
def curtain(fn, x_range, z_range, nx, nz, front_offset, slack=0.004, y_start=-0.6, name='curtain', width_fn=None):
    """Sheet hanging in front of the body (-Y side): for each column, from the top down, y is the frontmost body
    surface minus offset but never tucks back in below the widest point (a stiff sheet bridges the legs)."""
    xs = np.linspace(x_range[0], x_range[1], nx)
    zs = np.linspace(z_range[1], z_range[0], nz)           # top -> bottom
    ys = np.linspace(y_start, 0.3, 300)
    Y = np.empty((nz, nx))
    for j, z in enumerate(zs):
        X = np.empty((nx * len(ys), 3))
        X[:, 0] = np.repeat(xs, len(ys))
        X[:, 1] = np.tile(ys, nx)
        X[:, 2] = z
        d = fn(X).reshape(nx, len(ys))
        inside = d < 0
        first = np.argmax(inside, axis=1)
        hit = inside.any(1)
        yfront = np.where(hit, ys[first], np.nan)
        if np.isnan(yfront).all():
            yfront[:] = y_start + 0.2
        idx = np.arange(nx)
        good = ~np.isnan(yfront)
        yfront = np.interp(idx, idx[good], yfront[good])      # past the body's edge: continue flat, never wrap
        Y[j] = yfront - front_offset
    # hang: going down, the sheet can move toward the body only by `slack` per row (it drapes, never tucks)
    for j in range(1, nz):
        Y[j] = np.minimum(Y[j], Y[j - 1] + slack)
    # smooth across columns
    for _ in range(6):
        Y[:, 1:-1] = 0.25 * Y[:, :-2] + 0.5 * Y[:, 1:-1] + 0.25 * Y[:, 2:]
    verts, faces = [], []
    for j, z in enumerate(zs):
        for i, x in enumerate(xs):
            xx = x
            if width_fn is not None:
                xx = x * width_fn(j / (nz - 1))
            verts.append((xx, Y[j, i], z))
    for j in range(nz - 1):
        for i in range(nx - 1):
            a = j * nx + i
            faces.append((a, a + nx, a + nx + 1, a + 1))
    return new_object(name, verts, faces)


# ------------------------------------------------------------------------------------------------ ribbons
def ribbon(points, normals, width, name, thickness=0.0, twist=None):
    """Flat strip along a polyline; normals give the strip's facing (it lies in the plane perpendicular to them)."""
    pts = [np.asarray(p, float) for p in points]
    verts, faces = [], []
    n = len(pts)
    for i in range(n):
        t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        t /= max(np.linalg.norm(t), 1e-9)
        nn = np.asarray(normals[i], float)
        side = np.cross(t, nn)
        side /= max(np.linalg.norm(side), 1e-9)
        w = width(i / (n - 1)) if callable(width) else width
        verts.append(pts[i] + side * w * 0.5)
        verts.append(pts[i] - side * w * 0.5)
    for i in range(n - 1):
        a = 2 * i
        faces.append((a, a + 1, a + 3, a + 2))
    ob = new_object(name, verts, faces)
    if thickness > 0:
        solidify(ob, thickness, offset=0.0)
    return ob


def surface_path(fn, pts, offset, samples=40):
    """Resample a polyline and project it onto the offset surface; returns (points, outward normals)."""
    pts = np.asarray(pts, float)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    u = np.linspace(0, s[-1], samples)
    P = np.stack([np.interp(u, s, pts[:, k]) for k in range(3)], 1)
    P = sdf.project(lambda X: fn(X) - offset, P, iters=10)
    G = sdf.gradient(fn, P)
    G /= np.maximum(sdf.norm(G), 1e-9)[:, None]
    return P, G
