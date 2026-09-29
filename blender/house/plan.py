"""Pure-Python analysis of src/shared/level-layout.json (no bpy: runs under plain python3 for quick checks).

* room face segments: every wall side that faces a room, oriented so the room is on the LEFT (CCW walk),
  collinear pieces merged, ends trimmed to the true corners (line intersections with the neighbouring face);
* per-room chains (ordered, with inside/outside corner flags) for mouldings;
* exterior facade planes (outer faces grouped by plane) for siding;
* stair geometry numbers (riser/tread positions, soffit line) shared by stairs, clipToStair partitions, collision.
"""
import json
import math
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
LAYOUT_PATH = REPO / 'src' / 'shared' / 'level-layout.json'

TOL_CORNER = 0.45


def load(path=LAYOUT_PATH):
    return json.loads(Path(path).read_text())


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def add(a, b):
    return (a[0] + b[0], a[1] + b[1])


def mul(a, k):
    return (a[0] * k, a[1] * k)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1]


def cross(a, b):
    return a[0] * b[1] - a[1] * b[0]


def norm(a):
    L = math.hypot(a[0], a[1])
    return (a[0] / L, a[1] / L)


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


class Plan:
    def __init__(self, L=None):
        self.L = L or load()
        L = self.L
        self.rooms = {r['id']: r for r in L['rooms']}
        self.floors = {f['id']: f for f in L['floors']}
        self.walls = L['walls']
        self.doors = {d['id']: d for d in L['doors']}
        self.door_by_opening = {d['openingId']: d for d in L['doors']}
        self.stairs = {s['id']: s for s in L['stairs']}
        self.atlas_of_room = {}
        for a in L['atlases']:
            for r in a['rooms']:
                self.atlas_of_room[r] = a['id']
        self.openings = {}
        for w in self.walls:
            for o in w['openings']:
                self.openings[o['id']] = (w, o)

    # ------------------------------------------------------------------ rooms
    def room_z(self, rid):
        r = self.rooms[rid]
        z0 = self.floors[r['floor']]['elevation']
        return z0, z0 + r['ceiling']

    def wall_frame(self, w):
        a, b = tuple(w['a']), tuple(w['b'])
        d = norm(sub(b, a))
        nl = (-d[1], d[0])
        return a, b, d, nl, dist(a, b)

    def opening_point(self, w, o):
        a, b, d, nl, L = self.wall_frame(w)
        return add(a, mul(d, o['offset']))

    # ------------------------------------------------------------------ face segments
    def face_segments(self, rid):
        """Room faces: dict(p0, p1, dir, n (into room), wall, side, z0, z1, openings=[(opening, centre_s)])."""
        segs = []
        rz0, rz1 = self.room_z(rid)
        for w in self.walls:
            for side in ('left', 'right'):
                if w[side] != rid:
                    continue
                a, b, d, nl, L = self.wall_frame(w)
                t = w['thickness'] / 2
                if side == 'left':
                    off = mul(nl, t)
                    p0, p1, n = add(a, off), add(b, off), nl
                else:
                    off = mul(nl, -t)
                    p0, p1, n = add(b, off), add(a, off), mul(nl, -1)
                dd = norm(sub(p1, p0))
                ops = []
                for o in w['openings']:
                    c = add(self.opening_point(w, o), off)
                    ops.append((o, c))
                segs.append({'p0': p0, 'p1': p1, 'dir': dd, 'n': n, 'walls': [w['id']], 'wall': w, 'side': side,
                             'mat': w[side + 'Mat'], 'openings': ops, 'base': max(w['base'], rz0),
                             'top': min(w['base'] + w['height'], rz1), 'clip': w.get('clipToStair'),
                             'thickness': w['thickness'], 'fin0': False, 'fin1': False})
        segs = self._merge_collinear(segs)
        self._resolve_corners(segs)
        return segs

    def _merge_collinear(self, segs):
        merged = True
        while merged:
            merged = False
            for i in range(len(segs)):
                for j in range(len(segs)):
                    if i == j:
                        continue
                    A, B = segs[i], segs[j]
                    if dot(A['dir'], B['dir']) < 0.9999 or abs(cross(A['dir'], sub(B['p0'], A['p0']))) > 1e-4:
                        continue
                    if A['base'] != B['base'] or A['top'] != B['top'] or A['clip'] or B['clip']:
                        continue
                    if A['mat'] != B['mat']:
                        continue
                    # B continues A
                    if dist(A['p1'], B['p0']) < 0.2:
                        A['openings'] = A['openings'] + B['openings']
                        A['p1'] = B['p1']
                        A['walls'] = A['walls'] + B['walls']
                        A['thickness'] = max(A['thickness'], B['thickness'])
                        segs.pop(j)
                        merged = True
                        break
                if merged:
                    break
        return segs

    def _resolve_corners(self, segs):
        for S in segs:
            S['next'] = None
            S['prev'] = None
        for S in segs:
            best = None
            for T in segs:
                if T is S or abs(cross(S['dir'], T['dir'])) < 0.5:
                    continue
                X = line_x(S['p0'], S['dir'], T['p0'], T['dir'])
                if X is None:
                    continue
                if dist(X, S['p1']) > TOL_CORNER or dist(X, T['p0']) > TOL_CORNER:
                    continue
                # X must lie within both extents (with tolerance) and z ranges must overlap
                if min(S['top'], T['top']) - max(S['base'], T['base']) < 0.5:
                    continue
                score = dist(X, S['p1']) + dist(X, T['p0'])
                if best is None or score < best[0]:
                    best = (score, T, X)
            if best:
                _, T, X = best
                if T['prev'] is not None:
                    continue
                S['next'], T['prev'] = T, S
                S['p1'] = X
                T['p0'] = X
                turn = cross(S['dir'], T['dir'])
                S['corner1'] = 'inside' if turn > 0 else 'outside'
                T['corner0'] = S['corner1']
        for S in segs:
            if S['next'] is not None:
                continue
            for T in segs:
                if T is S or T['prev'] is not None or dot(S['dir'], T['dir']) < 0.9999:
                    continue
                if dist(S['p1'], T['p0']) < 0.02 and abs(cross(S['dir'], sub(T['p0'], S['p0']))) < 1e-4:
                    S['next'], T['prev'] = T, S
                    S['corner1'] = T['corner0'] = 'straight'
                    break
        for S in segs:
            S.setdefault('corner0', None)
            S.setdefault('corner1', None)
            # opening centres are measured from the ORIGINAL p0 -> re-measure against the trimmed p0
        for S in segs:
            S['length'] = dist(S['p0'], S['p1'])
            S['openings'] = sorted(((o, dot(sub(c, S['p0']), S['dir'])) for o, c in S['openings']),
                                   key=lambda t: t[1])

    def chains(self, rid):
        """Ordered lists of face segments (closed loops or open chains)."""
        segs = self.face_segments(rid)
        seen = set()
        out = []
        for S in segs:
            if id(S) in seen:
                continue
            # walk back to the chain start
            start = S
            while start['prev'] is not None and start['prev'] is not S:
                start = start['prev']
                if start is S:
                    break
            chain = []
            cur = start
            while cur is not None and id(cur) not in seen:
                seen.add(id(cur))
                chain.append(cur)
                cur = cur['next']
            closed = cur is not None and cur is chain[0]
            out.append((chain, closed))
        return out

    # ------------------------------------------------------------------ exterior
    def exterior_segments(self):
        segs = []
        for w in self.walls:
            for side in ('left', 'right'):
                if w[side] != 'exterior':
                    continue
                a, b, d, nl, L = self.wall_frame(w)
                t = w['thickness'] / 2
                if side == 'left':
                    off = mul(nl, t)
                    p0, p1, n = add(a, off), add(b, off), nl
                else:
                    off = mul(nl, -t)
                    p0, p1, n = add(b, off), add(a, off), mul(nl, -1)
                dd = norm(sub(p1, p0))
                ops = [(o, dot(sub(add(self.opening_point(w, o), off), p0), dd)) for o in w['openings']]
                segs.append({'p0': p0, 'p1': p1, 'dir': dd, 'n': n, 'wall': w, 'mat': w[side + 'Mat'],
                             'openings': ops, 'base': w['base'], 'top': w['base'] + w['height'],
                             'detail': w.get('facadeDetail', 'fog'), 'thickness': w['thickness']})
        return segs

    def facade_planes(self):
        """Group exterior faces by plane: key (normal, offset). Returns list of dicts with a common frame:
        origin p (s=0 at the left end seen from outside), dir, n (outward), s-extent, z-extent, openings."""
        planes = {}
        for S in self.exterior_segments():
            n = S['n']
            off = round(dot(S['p0'], n), 4)
            key = (round(n[0], 3), round(n[1], 3), off)
            planes.setdefault(key, []).append(S)
        out = []
        for key, segs in planes.items():
            n = (key[0], key[1])
            # seen from outside, s runs left -> right: dir = (-n.y, n.x) rotated so that dir x up = -n ...
            d = (-n[1], n[0])
            origin = mul(n, key[2])
            s_vals, ops, z0, z1 = [], [], 1e9, -1e9
            detail = 'fog'
            mats = set()
            for S in segs:
                for p in (S['p0'], S['p1']):
                    s_vals.append(dot(sub(p, origin), d))
                z0, z1 = min(z0, S['base']), max(z1, S['top'])
                for o, s in S['openings']:
                    c = add(S['p0'], mul(S['dir'], s))
                    ops.append((o, dot(sub(c, origin), d), S['base'], S['wall']))
                if S['detail'] == 'hero':
                    detail = 'hero'
                mats.add(S['mat'])
            fx0, fy0, fx1, fy1 = self.footprint()
            corners = [(fx0, fy0), (fx1, fy0), (fx1, fy1), (fx0, fy1)]
            on = [dot(sub(c, origin), d) for c in corners if abs(dot(c, n) - key[2]) < 1e-3]
            s_vals = on or s_vals
            out.append({'n': n, 'dir': d, 'origin': origin, 's0': min(s_vals), 's1': max(s_vals), 'z0': z0,
                        'z1': z1, 'openings': ops, 'detail': detail, 'segs': segs, 'mats': sorted(mats)})
        return out

    def footprint(self):
        xs, ys = [], []
        for S in self.exterior_segments():
            for p in (S['p0'], S['p1']):
                xs.append(p[0])
                ys.append(p[1])
        return (min(xs), min(ys), max(xs), max(ys))


def line_x(p, d, q, e):
    den = cross(d, e)
    if abs(den) < 1e-9:
        return None
    t = cross(sub(q, p), e) / den
    return add(p, mul(d, t))


# ---------------------------------------------------------------------- stairs
class StairGeo:
    """Straight flight numbers. Axis frame: f = forward (direction), r = right of forward."""
    DIRS = {'N': (0, 1), 'S': (0, -1), 'E': (1, 0), 'W': (-1, 0)}

    def __init__(self, st, floors):
        self.st = st
        self.f = self.DIRS[st['direction']]
        self.r = (self.f[1], -self.f[0])
        self.z0 = floors[st['from']]['elevation']
        self.z1 = floors[st['to']]['elevation']
        self.n = st['risers']
        self.rh = st['riserHeight']
        self.td = st['treadDepth']
        self.w = st['width']
        self.start = tuple(st['start'])

    def riser_pos(self, i):
        """Plan point (centre line) of riser i (1-based) for a straight flight."""
        return add(self.start, mul(self.f, (i - 1) * self.td))

    def nosing_z(self, along):
        """Pitch line through the nosings as a function of distance along f from the first riser."""
        return self.z0 + self.rh + along * (self.rh / self.td)

    def soffit_z(self, along, depth=0.30):
        return self.nosing_z(along) - depth


def main_soffit(plan, x, y, stair_id='ST_MAIN', depth=0.30):
    st = StairGeo(plan.stairs[stair_id], plan.floors)
    along = dot(sub((x, y), st.start), st.f)
    return st.soffit_z(along, depth)


if __name__ == '__main__':
    P = Plan()
    for rid in P.rooms:
        if P.rooms[rid]['kind'] != 'interior':
            continue
        print('==', rid)
        for chain, closed in P.chains(rid):
            print('  chain closed' if closed else '  chain open', len(chain))
            for S in chain:
                print('    %-12s p0=(%.3f,%.3f) p1=(%.3f,%.3f) n=(%.0f,%.0f) z %.2f-%.2f c0=%s c1=%s ops=%s' % (
                    ','.join(S['walls']), *S['p0'], *S['p1'], *S['n'], S['base'], S['top'], S['corner0'],
                    S['corner1'], [(o['id'], round(s, 3)) for o, s in S['openings']]))
    for fp in P.facade_planes():
        print('facade n=%s s %.3f..%.3f z %.2f..%.2f %s ops=%s' % (fp['n'], fp['s0'], fp['s1'], fp['z0'], fp['z1'],
              fp['detail'], [(o['id'], round(s, 3)) for o, s, b, w in fp['openings']]))
    print('footprint', P.footprint())
