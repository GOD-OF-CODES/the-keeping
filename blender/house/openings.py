"""Local frame of a wall opening: s along the wall (0 = opening centre), e = depth into the wall measured from one
face (e = 0) to the other (e = t), z absolute. Walls are axis aligned, so boxes stay axis aligned in world space.
"""
from mathutils import Vector

from .geom import box, prism

UP = Vector((0, 0, 1))


class Frame:
    def __init__(self, P, opening_id, from_side):
        """from_side: room id (or 'exterior') whose face is e = 0."""
        w, o = P.openings[opening_id]
        self.w, self.o = w, o
        a, b, d, nl, L = P.wall_frame(w)
        self.t = w['thickness']
        self.W = o['width']
        self.H = o['height']
        self.z0 = w['base'] + o['sill']
        self.z1 = self.z0 + self.H
        c = (a[0] + d[0] * o['offset'], a[1] + d[1] * o['offset'])
        self.c = Vector((c[0], c[1], 0))
        self.d = Vector((d[0], d[1], 0))
        nlv = Vector((nl[0], nl[1], 0))
        if w['left'] == from_side:
            self.n0 = nlv            # outward normal of the e=0 face (points into from_side)
        elif w['right'] == from_side:
            self.n0 = -nlv
        else:
            raise ValueError(f'{opening_id}: {from_side} not on wall {w["id"]}')
        self.side0 = from_side
        self.side1 = w['right'] if w['left'] == from_side else w['left']

    def P(self, s, e, z):
        return self.c + self.d * s + self.n0 * (self.t / 2 - e) + UP * z

    def box(self, M, s0, s1, e0, e1, z0, z1, mat, bevel=0.002, segs=1, grain=None):
        p, q = self.P(s0, e0, z0), self.P(s1, e1, z1)
        mn = Vector((min(p.x, q.x), min(p.y, q.y), min(p.z, q.z)))
        mx = Vector((max(p.x, q.x), max(p.y, q.y), max(p.z, q.z)))
        box(M, mn, mx, mat, bevel=bevel, segs=segs, grain=grain)

    def prism_ez(self, M, poly_ez, s0, s1, mat, bevel=0.002):
        """Polygon in (e, z) extruded along s from s0 to s1."""
        o = self.P(s0, 0, 0)
        S = -self.n0            # +e direction
        T = UP
        W = S.cross(T)
        if W.dot(self.d) < 0:
            prism(M, poly_ez, self.P(s1, 0, 0), S, T, s1 - s0, mat, bevel=bevel)
        else:
            prism(M, poly_ez, o, S, T, s1 - s0, mat, bevel=bevel)

    def prism_sz(self, M, poly_sz, e0, e1, mat, bevel=0.002):
        """Polygon in (s, z) extruded along e from e0 to e1."""
        S, T = self.d, UP
        W = S.cross(T)
        if W.dot(-self.n0) > 0:          # extrusion direction is +e
            prism(M, poly_sz, self.c + self.n0 * (self.t / 2 - e0), S, T, e1 - e0, mat, bevel=bevel)
        else:
            prism(M, poly_sz, self.c + self.n0 * (self.t / 2 - e1), S, T, e1 - e0, mat, bevel=bevel)
