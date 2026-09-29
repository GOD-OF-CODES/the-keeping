"""Ada's long wet black hair as bmesh card geometry (hair CURVES can't export to glTF).

Strands are integrated from scalp roots as wet hair that sticks to whatever it touches: while near the surface it
slides along the tangent plane under gravity (plastered over the face, the scalp, the shoulders, the chest), it
detaches where the surface turns to face down (chin, jaw, nape), then hangs and collides.

Layers:
  * cap   — scalp shell (opaque wet-hair texture) so no scalp shows through the cards.
  * veil  — continuous sheets woven between neighbouring strands of a crown ring: covers the WHOLE face; a narrow
            slit over the right eye is the only opening (the one clouded eye). Opaque centre, alpha fringe ends.
  * cards — clumped strand ribbons (alpha texture) on top and continuing below the sheet: the long wet ropes.
Weights: everything above the detach point is 100 % `head` (the face never uncovers when the head lolls or is
lifted); hanging lengths go to hair chain bones (runtime verlet), blended by arc length.
UV: u across, v along (0 root -> 1 tip) into the hair atlas regions written by textures.hair_atlas().
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

from . import sdf

# hair atlas layout (u ranges): veil strip [0, 0.25), eight clump card strips in [0.25, 1)
VEIL_U = (0.0, 0.25)
CARD_STRIPS = 6


def card_u(k):
    w = (1.0 - VEIL_U[1]) / CARD_STRIPS
    u0 = VEIL_U[1] + (k % CARD_STRIPS) * w
    return u0 + 0.004, u0 + w - 0.004


def integrate(roots, dirs, lengths, fn_stick, fn_coll, step=0.008, offset=0.004, stick=0.012, grav=0.35,
              detach_dot=0.25, rng=None, wander=0.0):
    """Integrate K strands at once. Returns a list of (points (n,3), attached (n,), normals (n,3)) per strand."""
    Pp = np.array(roots, float)
    D = np.array(dirs, float)
    D /= np.linalg.norm(D, axis=1)[:, None]
    lengths = np.asarray(lengths, float)
    K = len(Pp)
    g = np.array([0.0, 0.0, -1.0])
    n = int(np.ceil(lengths.max() / step))
    attached = np.ones(K, bool)
    pts = [Pp.copy()]
    att = [attached.copy()]
    G0 = sdf.gradient(fn_stick, Pp)
    G0 /= np.maximum(sdf.norm(G0), 1e-9)[:, None]
    nrm = [G0]

    def unit(v):
        return v / np.maximum(sdf.norm(v), 1e-9)[:, None]
    for i in range(n):
        ds = fn_stick(Pp)
        gr = unit(sdf.gradient(fn_stick, Pp))
        stick_now = attached & (ds < stick) & ((gr @ g) < detach_dot)
        attached = stick_now
        # attached: slide in the tangent plane under gravity
        v = D + g * grav
        if wander and rng is not None:
            v = v + rng.normal(0, wander, (K, 3))
        vt = v - gr * (v * gr).sum(1)[:, None]
        vt = np.where((sdf.norm(vt) < 1e-6)[:, None], g - gr * (gr @ g)[:, None], vt)
        vfree = D + g * 0.55
        V = np.where(attached[:, None], vt, vfree)
        D = unit(V)
        Pp = Pp + D * step
        d2 = fn_stick(Pp)
        g2 = unit(sdf.gradient(fn_stick, Pp))
        # plastered strands stay at the offset
        Pp = np.where(attached[:, None], Pp - g2 * (d2 - offset)[:, None], Pp)
        # free strands collide, and lie against surfaces they brush (wet hair sticks to the chest/back)
        dc = fn_coll(Pp)
        gc = unit(sdf.gradient(fn_coll, Pp))
        push = (~attached) & (dc < offset)
        Pp = np.where(push[:, None], Pp - gc * (dc - offset)[:, None], Pp)
        Dn = D - gc * np.minimum((D * gc).sum(1), 0.0)[:, None]
        D = np.where(push[:, None], unit(Dn), D)
        near = (~attached) & (~push) & (dc < stick * 1.5) & ((gc @ g) < 0.3)
        Pp = np.where(near[:, None], Pp - gc * ((dc - offset) * 0.5)[:, None], Pp)
        pts.append(Pp.copy())
        att.append(attached.copy())
        nrm.append(np.where(attached[:, None], g2, gc))
    pts = np.stack(pts, 1)
    att = np.stack(att, 1)
    nrm = np.stack(nrm, 1)
    out = []
    for k in range(K):
        m = int(np.ceil(lengths[k] / step)) + 1
        out.append((pts[k, :m], att[k, :m], nrm[k, :m]))
    return out


def ribbon_verts(pts, nrm, width, lift=0.0):
    """Left/right edge points of a card lying flat on the surface normals."""
    n = len(pts)
    L, R = [], []
    for i in range(n):
        t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        t /= max(np.linalg.norm(t), 1e-9)
        nn = nrm[i] - t * nrm[i].dot(t)
        nn /= max(np.linalg.norm(nn), 1e-9)
        side = np.cross(t, nn)
        w = width[i] if hasattr(width, '__len__') else width
        c = pts[i] + nn * lift
        L.append(c + side * w * 0.5)
        R.append(c - side * w * 0.5)
    return np.array(L), np.array(R)


class HairBuilder:
    def __init__(self, name):
        self.name = name
        self.verts, self.faces, self.uvs, self.layer, self.arc, self.att, self.group = [], [], [], [], [], [], []

    def add_strip(self, L, R, u0, u1, arc, att, group, layer):
        """Quad strip between edge polylines L and R (same length). arc = normalised arclength per row."""
        base = len(self.verts)
        n = len(L)
        for i in range(n):
            self.verts += [tuple(L[i]), tuple(R[i])]
            self.arc += [arc[i], arc[i]]
            self.att += [att[i], att[i]]
            self.group += [group, group]
            self.layer += [layer, layer]
        for i in range(n - 1):
            a = base + 2 * i
            self.faces.append((a, a + 1, a + 3, a + 2))
            self.uvs.append(((u0, arc[i]), (u1, arc[i]), (u1, arc[i + 1]), (u0, arc[i + 1])))

    def add_sheet(self, rows, u_range, arc, att, group_of_col, layer, skip=None):
        """rows: (ncols, nrows, 3) strand polylines side by side; quads between neighbouring columns."""
        ncol, nrow = rows.shape[:2]
        base = len(self.verts)
        for c in range(ncol):
            for r in range(nrow):
                self.verts.append(tuple(rows[c, r]))
                self.arc.append(arc[c][r])
                self.att.append(att[c][r])
                self.group.append(group_of_col[c])
                self.layer.append(layer)
        u0, u1 = u_range
        for c in range(ncol - 1):
            for r in range(nrow - 1):
                if skip is not None and skip(c, r):
                    continue
                a = base + c * nrow + r
                b = base + (c + 1) * nrow + r
                ua = u0 + (u1 - u0) * ((c * 0.37) % 1.0)
                ub = ua + (u1 - u0) * 0.37
                if ub > u1:
                    ua, ub = u0, u0 + (u1 - u0) * 0.37
                self.faces.append((a, b, b + 1, a + 1))
                self.uvs.append(((ua, arc[c][r]), (ub, arc[c + 1][r]), (ub, arc[c + 1][r + 1]), (ua, arc[c][r + 1])))

    def build(self):
        me = bpy.data.meshes.new(self.name)
        me.from_pydata(self.verts, [], self.faces)
        uv = me.uv_layers.new(name='UVMap')
        loop = 0
        for p, fuv in zip(me.polygons, self.uvs):
            for k in range(p.loop_total):
                uv.data[p.loop_start + k].uv = fuv[k]
        for p in me.polygons:
            p.use_smooth = True
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob['_arc'] = list(map(float, self.arc))
        return ob, np.array(self.arc), np.array(self.att), np.array(self.group), np.array(self.layer)
