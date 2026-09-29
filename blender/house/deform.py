"""Seeded, continuous imperfection fields applied to finished meshes (so touching parts never crack apart):

* whole-house lean (out of plumb) + low-frequency waviness (a few mm);
* floors dip and ceilings sag toward the middle of each room;
* the roof ridge and eaves sag between the gables, the porch roof and deck sag between posts.

Every field is a pure function of world position, so coincident vertices of different objects move together.
Door leaves (rigid=True) only get a tiny global shift so they still rotate cleanly about their hinge.
"""
import math

from mathutils import Vector, noise

SEED = Vector((13.1, 7.7, 3.3))


def _smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


class Field:
    def __init__(self, P):
        self.rooms = []
        for r in P.rooms.values():
            if r['kind'] != 'interior':
                continue
            z0, z1 = P.room_z(r['id'])
            x0, y0, x1, y1 = r['rect']
            span = min(x1 - x0, y1 - y0)
            self.rooms.append((x0, y0, x1, y1, z0, z1, 0.004 + 0.0025 * span, 0.006 + 0.003 * span))
        fx0, fy0, fx1, fy1 = P.footprint()
        R = P.L['roof']
        self.roof = (fy0 - 0.8, fy1 + 0.8, R['eaveZ'], R['ridgeZ'] + 0.3)
        porch = next((p for p in P.L['props'] if p['type'] == 'porch'), None)
        self.porch = None
        if porch:
            w, dpt = porch['params']['width'], porch['params']['depth']
            cx, cy = porch['pos'][0], porch['pos'][1]
            self.porch = (cx - w / 2 - 0.3, cx + w / 2 + 0.3, cy - dpt / 2 - 0.6, cy + dpt / 2,
                          porch['params']['roofZ'])

    def base(self, p):
        """Lean + waviness (all objects)."""
        n = noise.noise_vector(p * 0.37 + SEED)
        z = p.z
        return Vector((0.0022 * z / 3.5 + 0.0025 * n.x, -0.0012 * z / 3.5 + 0.0025 * n.y, 0.003 * n.z))

    def rooms_sag(self, p):
        dz = 0.0
        for x0, y0, x1, y1, z0, z1, fs, cs in self.rooms:
            if not (x0 - 0.05 < p.x < x1 + 0.05 and y0 - 0.05 < p.y < y1 + 0.05):
                continue
            u = min(max((p.x - x0) / (x1 - x0), 0.0), 1.0)
            v = min(max((p.y - y0) / (y1 - y0), 0.0), 1.0)
            b = math.sin(math.pi * u) * math.sin(math.pi * v)
            wf = max(0.0, 1.0 - abs(p.z - z0) / 0.35)
            wc = max(0.0, 1.0 - abs(p.z - z1) / 0.35)
            dz -= b * (fs * wf + cs * wc)
        return dz

    def exterior_sag(self, p):
        dz = 0.0
        y0, y1, eave, ridge = self.roof
        if p.z > 6.3 and y0 < p.y < y1:
            t = (p.y - y0) / (y1 - y0)
            s = math.sin(math.pi * t)
            w = _smooth((p.z - 6.3) / 0.7)
            dz -= s * w * (0.018 + 0.05 * _smooth((p.z - eave) / (ridge - eave)))
        if self.porch:
            x0, x1, py0, py1, rz = self.porch
            if x0 < p.x < x1 and py0 < p.y < py1:
                s = math.sin(math.pi * (p.x - x0) / (x1 - x0))
                out = _smooth((py1 - p.y) / (py1 - py0))
                if rz - 0.6 < p.z < rz + 0.9:
                    dz -= 0.028 * s * out * _smooth((p.z - (rz - 0.6)) / 0.3)
                elif p.z < 0.7:
                    dz -= 0.012 * s * out * _smooth(p.z / 0.3)
        return dz


def apply(P, meshes, rigid=False):
    F = Field(P)
    for m in meshes:
        ext = m.extras.get('room') in ('EXT1', 'EXT2')
        if rigid:
            pivot = m.extras.get('_pivot')
            d = F.base(pivot) if pivot is not None else Vector((0, 0, 0))
            m.V = [v + d for v in m.V]
            continue
        out = []
        for v in m.V:
            d = F.base(v)
            if ext:
                d.z += F.exterior_sag(v)
            else:
                d.z += F.rooms_sag(v)
            out.append(v + d)
        m.V = out
