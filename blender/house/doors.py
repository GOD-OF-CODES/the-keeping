"""Door frames (static, into the room meshes) and door leaves (dynamic, doors.glb).

Leaves are exported CLOSED with the object origin on the hinge axis at floor level (pivot = hinge edge of the
leaf's swing-side face). Rotating the node about world +Y (plan +Z) by `swingSign * angle` swings the leaf into
`swingInto`. Extras on every leaf: doorId, openingId, style, hinge, swingInto, initial, interactive, unlockFlag,
swingSign, initialAngleDeg, leafWidth, leafHeight, thickness. Extra parts (Ada's 3 boards, the passage bolt)
are separate nodes with their own extras.
"""
import math

from mathutils import Matrix, Vector

from .geom import Mesh, box, cylinder_between, lathe, oriented_box, sweep
from .openings import Frame
from .trim import CASE_HEAD, CASE_W
from .windows import nail, pane

UP = Vector((0, 0, 1))
LINING = 0.02
GAP = 0.003
INITIAL_ANGLE = {'closed': 0.0, 'locked': 0.0, 'bolted': 0.0, 'boarded': 0.0, 'ajar': 20.0, 'open': 95.0}


def casing(fr, M, face, mat, rough=False, plinth=True, top_only=False):
    """Casing on one face of an opening: face 0 = the e=0 side, face 1 = the e=t side."""
    hw, z0, z1, t = fr.W / 2, fr.z0, fr.z1, fr.t
    th = 0.022 if not rough else 0.025
    e0, e1 = (-th, 0.002) if face == 0 else (t - 0.002, t + th)
    eb0, eb1 = (-th - 0.01, 0.002) if face == 0 else (t - 0.002, t + th + 0.01)
    cw = CASE_W if not rough else 0.09
    for sgn in (-1, 1):
        a, b = sorted((sgn * hw, sgn * (hw + cw)))
        fr.box(M, a, b, e0, e1, z0, z1 + 0.002, mat, bevel=0.003 if not rough else 0.002)
        if not rough:
            a2, b2 = sorted((sgn * (hw + cw - 0.014), sgn * (hw + cw)))
            fr.box(M, a2, b2, eb0, eb1, z0, z1 + CASE_HEAD - 0.03, mat, bevel=0.003)
            if plinth:
                a3, b3 = sorted((sgn * (hw - 0.004), sgn * (hw + cw + 0.008)))
                pe0, pe1 = (-0.038, 0.002) if face == 0 else (t - 0.002, t + 0.038)
                fr.box(M, a3, b3, pe0, pe1, z0, z0 + 0.23, mat, bevel=0.004, segs=2)
    if rough:
        fr.box(M, -hw - cw, hw + cw, e0, e1, z1, z1 + 0.11, mat, bevel=0.002)
        return
    fr.box(M, -hw - cw, hw + cw, e0, e1, z1, z1 + CASE_HEAD - 0.03, mat, bevel=0.003)
    ce0, ce1 = (-0.036, 0.002) if face == 0 else (t - 0.002, t + 0.036)
    fr.box(M, -hw - cw - 0.016, hw + cw + 0.016, ce0, ce1, z1 + CASE_HEAD - 0.03, z1 + CASE_HEAD - 0.012, mat,
           bevel=0.004, segs=2)
    ce0, ce1 = (-0.03, 0.002) if face == 0 else (t - 0.002, t + 0.03)
    fr.box(M, -hw - cw - 0.01, hw + cw + 0.01, ce0, ce1, z1 + CASE_HEAD - 0.012, z1 + CASE_HEAD, mat, bevel=0.003)


def lining(fr, M, mat, e0=-0.001, e1=None, z_top=None):
    hw, z0, z1 = fr.W / 2, fr.z0, fr.z1 if z_top is None else z_top
    e1 = fr.t + 0.001 if e1 is None else e1
    fr.box(M, -hw, -hw + LINING, e0, e1, z0, fr.z1, mat, bevel=0.0015)
    fr.box(M, hw - LINING, hw, e0, e1, z0, fr.z1, mat, bevel=0.0015)
    fr.box(M, -hw, hw, e0, e1, fr.z1 - LINING, fr.z1, mat, bevel=0.0015)


# --------------------------------------------------------------------------------------------- leaves
class Leaf:
    """Local leaf frame: x from the hinge edge (0) to the latch edge (W), y from the swing face (0) into the
    door (T), z from the bottom (0) to the top (H)."""

    def __init__(self, pivot, X, Y, W, H, T):
        self.o, self.X, self.Y, self.W, self.H, self.T = pivot, X, Y, W, H, T

    def P(self, x, y, z):
        return self.o + self.X * x + self.Y * y + UP * z

    def box(self, M, x0, x1, y0, y1, z0, z1, mat, bevel=0.003, segs=1, grain=None):
        p, q = self.P(x0, y0, z0), self.P(x1, y1, z1)
        mn = Vector((min(p.x, q.x), min(p.y, q.y), min(p.z, q.z)))
        mx = Vector((max(p.x, q.x), max(p.y, q.y), max(p.z, q.z)))
        box(M, mn, mx, mat, bevel=bevel, segs=segs, grain=grain)

    def face_normal(self, side):
        return -self.Y if side == 0 else self.Y


def raised_panel(M, L, x0, z0, x1, z1, mat, field=0.03, t_edge=0.009, t_field=0.022):
    """Raised-and-fielded panel centred in the door thickness: both faces bevel from t_edge to t_field."""
    ym = L.T / 2
    verts, faces = [], []

    def ring(inset, half):
        return [(x0 + inset, z0 + inset, half), (x1 - inset, z0 + inset, half), (x1 - inset, z1 - inset, half),
                (x0 + inset, z1 - inset, half)]
    for side in (-1, 1):
        base = len(verts)
        outer = ring(0.0, t_edge / 2)
        inner = ring(field, t_field / 2)
        for (x, z, h) in outer + inner:
            verts.append(L.P(x, ym + side * h, z))
        for k in range(4):
            k2 = (k + 1) % 4
            f = [base + k, base + k2, base + 4 + k2, base + 4 + k]
            faces.append(f if side > 0 else list(reversed(f)))
        f = [base + 4, base + 5, base + 6, base + 7]
        faces.append(f if side > 0 else list(reversed(f)))
    # outer edge band (hidden in the groove)
    for k in range(4):
        k2 = (k + 1) % 4
        f = [k, 8 + k, 8 + k2, k2]
        faces.append(f)
    from .geom import newell
    c = L.P((x0 + x1) / 2, ym, (z0 + z1) / 2)
    fixed = []
    for f in faces:
        pts = [verts[i] for i in f]
        n = newell(pts)
        cen = sum(pts, Vector()) / len(pts)
        if n.dot(cen - c) < 0:
            f = list(reversed(f))
        fixed.append(f)
    M.piece(verts, fixed, mat, grain='z')


def sticking(M, L, x0, z0, x1, z1, mat, side):
    """Quarter-round moulding around a panel opening on one face (inside corner frame edge / panel)."""
    y = 0.0 if side == 0 else L.T
    inset_y = 0.0155 if side == 0 else -0.0155
    path = [L.P(x0, y + inset_y, z0), L.P(x1, y + inset_y, z0), L.P(x1, y + inset_y, z1), L.P(x0, y + inset_y, z1)]
    nrm = L.face_normal(side)
    # CCW seen from the face normal: check winding
    from .geom import newell
    if newell(path).dot(nrm) < 0:
        path = list(reversed(path))
    prof = [(0.0, 0.0), (0.011, 0.0)] + [(0.011 * math.cos(a), 0.011 * math.sin(a))
                                         for a in [math.pi / 2 * i / 4 for i in range(1, 5)]]
    sweep(M, path, prof, mat, up=nrm, closed=True, side_sign=1.0)


def panel_leaf(M, L, mat, front=False):
    W, H, T = L.W, L.H, L.T
    st = 0.12 if front else 0.11
    top = 0.12 if front else 0.11
    bot = 0.24 if front else 0.22
    lock = 0.2
    zl = 0.88
    L.box(M, 0, st, 0, T, 0, H, mat, bevel=0.003, grain='z')
    L.box(M, W - st, W, 0, T, 0, H, mat, bevel=0.003, grain='z')
    L.box(M, st - 0.002, W - st + 0.002, 0, T, 0, bot, mat, bevel=0.003)
    L.box(M, st - 0.002, W - st + 0.002, 0, T, H - top, H, mat, bevel=0.003)
    L.box(M, st - 0.002, W - st + 0.002, 0, T, zl, zl + lock, mat, bevel=0.003)
    mw = 0.1
    xm = W / 2
    L.box(M, xm - mw / 2, xm + mw / 2, 0, T, bot - 0.002, zl + 0.002, mat, bevel=0.003, grain='z')
    L.box(M, xm - mw / 2, xm + mw / 2, 0, T, zl + lock - 0.002, H - top + 0.002, mat, bevel=0.003, grain='z')
    for (a, b) in ((st, xm - mw / 2), (xm + mw / 2, W - st)):
        for (c, d) in ((bot, zl), (zl + lock, H - top)):
            raised_panel(M, L, a - 0.006, c - 0.006, b + 0.006, d + 0.006, mat)
            for side in (0, 1):
                sticking(M, L, a, c, b, d, mat, side)


def hardware(M, L, knob_mat='brass_tarnished', knob_z=0.95, hinges=3, lock_both=True):
    W, H, T = L.W, L.H, L.T
    for side in (0, 1):
        y = 0.0 if side == 0 else T
        out = -1 if side == 0 else 1
        c = L.P(W - 0.065, y, knob_z)
        axis = L.Y * out
        rot = Matrix((L.X, axis.cross(L.X), axis)).transposed()
        rose = [(0.0, 0.0), (0.026, 0.0), (0.026, 0.004), (0.02, 0.008), (0.01, 0.011), (0.009, 0.03),
                (0.012, 0.042), (0.024, 0.05), (0.028, 0.06), (0.026, 0.07), (0.016, 0.078), (0.0, 0.08)]
        lathe(M, rose, c, knob_mat, segs=14, axis=rot, cap=False)
        # escutcheon with keyhole below the knob
        ez = knob_z - 0.11
        e0, e1 = (y - 0.003, y) if side == 0 else (y, y + 0.003)
        L.box(M, W - 0.085, W - 0.045, e0, e1, ez - 0.035, ez + 0.035, knob_mat, bevel=0.0015)
    for k in range(hinges):
        z = 0.22 if k == 0 else (H - 0.25 if k == hinges - 1 else H / 2)
        a = L.P(0.0, -0.002, z - 0.05)
        cylinder_between(M, a, a + UP * 0.1, 0.0075, 'cast_iron', segs=8)
        cylinder_between(M, a + UP * 0.1, a + UP * 0.112, 0.0045, 'cast_iron', segs=6)


def louvred_leaf(M, L, mat):
    W, H, T = L.W, L.H, L.T
    st, top, bot, mid = 0.075, 0.1, 0.15, 0.1
    L.box(M, 0, st, 0, T, 0, H, mat, bevel=0.003, grain='z')
    L.box(M, W - st, W, 0, T, 0, H, mat, bevel=0.003, grain='z')
    zm = H * 0.5
    for (a, b) in ((0, bot), (zm - mid / 2, zm + mid / 2), (H - top, H)):
        L.box(M, st - 0.002, W - st + 0.002, 0, T, a, b, mat, bevel=0.003)
    for (za, zb) in ((bot, zm - mid / 2), (zm + mid / 2, H - top)):
        n = max(1, int((zb - za) / 0.038))
        pitch = (zb - za) / n
        for k in range(n):
            zz = za + pitch * (k + 0.5)
            ang = math.radians(42)
            # slat: rotated box about the leaf's x axis
            ce = L.P(W / 2, T / 2, zz)
            ax_y = (L.Y * math.cos(ang) + UP * math.sin(ang)).normalized()
            ax_z = L.X.cross(ax_y).normalized()
            oriented_box(M, ce, L.X, ax_y, ax_z, (W - 2 * st) / 2 + 0.004, (T - 0.004) / 2 / math.cos(ang) * 0.95,
                         0.0035, mat, bevel=0.0008)


def plank_leaf(M, L, mat, boards=5, battens_side=1):
    W, H, T = L.W, L.H, L.T
    bw = W / boards
    for k in range(boards):
        L.box(M, k * bw + 0.0015, (k + 1) * bw - 0.0015, 0, T - 0.022, 0, H, mat, bevel=0.002, grain='z')
    for zz in (0.18, H - 0.3):
        L.box(M, 0.03, W - 0.03, T - 0.022, T, zz, zz + 0.09, mat, bevel=0.003)
    # a finger pull notch block on the hinge-far edge
    L.box(M, W - 0.07, W - 0.03, -0.012, 0.0, H * 0.5 - 0.04, H * 0.5 + 0.04, mat, bevel=0.003)


def fanlight(P, fr, M, G, e0, e1, zt, mat):
    """Transom bar + fixed fanlight sash with radiating muntins in the transom above the front door."""
    hw = fr.W / 2 - LINING
    z1 = fr.z1 - LINING
    fr.box(M, -hw, hw, e0 - 0.01, e1 + 0.01, zt, zt + 0.07, mat, bevel=0.004, segs=2)
    zb = zt + 0.07
    em = (e0 + e1) / 2
    # sash frame
    fr.box(M, -hw, -hw + 0.04, e0, e1, zb, z1, mat, bevel=0.003)
    fr.box(M, hw - 0.04, hw, e0, e1, zb, z1, mat, bevel=0.003)
    fr.box(M, -hw + 0.04, hw - 0.04, e0, e1, z1 - 0.04, z1, mat, bevel=0.003)
    fr.box(M, -hw + 0.04, hw - 0.04, e0, e1, zb, zb + 0.03, mat, bevel=0.003)
    cz = zb + 0.03
    rx = hw - 0.06
    rz = (z1 - 0.04) - cz - 0.02
    # elliptical arc muntin
    pts = [fr.P(rx * math.cos(a), em, cz + rz * math.sin(a)) for a in [math.pi * i / 16 for i in range(17)]]
    prof = [(-0.009, -0.016), (0.009, -0.016), (0.009, 0.016), (-0.009, 0.016)]
    sweep(M, pts, prof, mat, up=-fr.n0, closed=False, side_sign=1.0, closed_profile=True)
    # hub
    hub = [fr.P(0.07 * math.cos(a), em, cz + 0.07 * math.sin(a)) for a in [math.pi * i / 8 for i in range(9)]]
    sweep(M, hub, prof, mat, up=-fr.n0, closed=False, side_sign=1.0, closed_profile=True)
    # spokes
    for k in range(1, 6):
        a = math.pi * k / 6
        p0 = fr.P(0.07 * math.cos(a), em, cz + 0.07 * math.sin(a))
        p1 = fr.P(rx * math.cos(a), em, cz + rz * math.sin(a))
        d = (p1 - p0)
        L_ = d.length
        x = d.normalized()
        y = (-fr.n0).normalized()
        z = x.cross(y)
        oriented_box(M, (p0 + p1) / 2, x, y, z, L_ / 2, 0.015, 0.008, mat, bevel=0.002)
    pane(G, fr, -hw + 0.035, hw - 0.035, zb + 0.025, z1 - 0.035, em, 7.0)


def leaf_extras(P, door, fr, L, swing_sign, W, H, T, style):
    return {'doorId': door['id'], 'openingId': door['openingId'], 'style': style, 'hinge': door['hinge'],
            'swingInto': door['swingInto'], 'initial': door['initial'], 'interactive': bool(door['interactive']),
            'unlockFlag': door.get('unlockFlag', ''), 'swingSign': swing_sign,
            'initialAngleDeg': INITIAL_ANGLE.get(door['initial'], 0.0), 'leafWidth': round(W, 4),
            'leafHeight': round(H, 4), 'thickness': round(T, 4), 'kind': 'door'}


def build_doors(P, meshes, ext):
    parts = []
    static = []
    for door in P.L['doors']:
        oid = door['openingId']
        w, o = P.openings[oid]
        R = door['swingInto']
        other = w['right'] if w['left'] == R else w['left']
        fr = Frame(P, oid, R)
        hw, t, z0, z1 = fr.W / 2, fr.t, fr.z0, fr.z1
        style = door['style']
        M0 = meshes.get(R)
        M1 = meshes.get(other) if other not in ('exterior', 'void') else (ext['trim'] if other == 'exterior' else None)
        mat_leaf = door.get('mat', 'door_painted')
        rough0 = P.rooms[R]['trimMat'] == 'wood_raw_plank'
        rough1 = other in P.rooms and P.rooms[other]['trimMat'] == 'wood_raw_plank'
        trim0 = P.rooms[R]['trimMat']
        trim1 = P.rooms[other]['trimMat'] if other in P.rooms else 'trim_chipped'
        T = {'front': 0.048, 'panel': 0.04, 'boarded': 0.04, 'passage_bolted': 0.04, 'closet': 0.032,
             'wardrobe_back': 0.04}[style]
        # leaf placement across the thickness
        e_leaf = 0.006 if style != 'wardrobe_back' else t - T - 0.002
        # frame: lining + stops + casings
        lining_mat = trim0 if not rough0 else 'wood_raw_plank'
        zt_leaf = z1 - LINING - GAP
        if style == 'front':
            zt_leaf = z0 + 2.15
        lining(fr, M0, lining_mat)
        if style != 'wardrobe_back':
            stop_e0 = e_leaf + T + 0.001
            for sgn in (-1, 1):
                a, b = sorted((sgn * (hw - LINING), sgn * (hw - LINING - 0.013)))
                fr.box(M0, a, b, stop_e0, stop_e0 + 0.034, z0, zt_leaf, lining_mat, bevel=0.002)
            fr.box(M0, -hw + LINING, hw - LINING, stop_e0, stop_e0 + 0.034, zt_leaf - 0.0, zt_leaf + 0.013,
                   lining_mat, bevel=0.002)
        if style == 'wardrobe_back':
            casing(fr, M0, 0, 'wood_raw_plank', rough=True)
        else:
            casing(fr, M0, 0, trim0, rough=rough0)
        if M1 is not None and style != 'wardrobe_back':
            if style == 'front':
                front_surround(P, fr, M1)
            else:
                casing(fr, M1, 1, trim1, rough=rough1, plinth=not rough1)
        if style == 'front':
            G = Mesh(f'{R}_glass_{oid}', room=R, atlas=P.atlas_of_room[R], floor=P.rooms[R]['floor'],
                     lightmap='lm_' + P.atlas_of_room[R].replace('LM_', '').lower(), kind='level', glass=True,
                     opening=oid, lm_weight=0.35)
            fanlight(P, fr, M0, G, e_leaf, e_leaf + T, zt_leaf + GAP, trim0)
            static.append(G)
            # oak threshold
            fr.box(M0, -hw - 0.02, hw + 0.02, -0.02, t + 0.06, z0 - 0.02, z0 + 0.018, 'stair_treads', bevel=0.004,
                   segs=2)
        # leaf
        W = fr.W - 2 * LINING - 2 * GAP
        H = zt_leaf - GAP - (z0 + (0.012 if style != 'front' else 0.02))
        zb = z0 + (0.012 if style != 'front' else 0.02)
        # hinge side as seen from R: viewer faces the wall (-n0); right = (v.y, -v.x)
        v = -fr.n0
        right = Vector((v.y, -v.x, 0))
        hdir = right if door['hinge'] == 'right' else -right
        X = -hdir
        Y = -fr.n0        # from the swing face into the door
        pivot = fr.c + hdir * (W / 2) + fr.n0 * (t / 2 - e_leaf) + UP * zb
        pivot_floor = pivot.copy()
        L = Leaf(pivot, X, Y, W, H, T)
        u = X
        swing_sign = 1 if UP.cross(u).dot(fr.n0) > 0 else -1
        name = 'door_' + door['id']
        LM = Mesh(name, **leaf_extras(P, door, fr, L, swing_sign, W, H, T, style))
        LM.extras['_pivot'] = pivot_floor
        if style in ('panel', 'boarded', 'passage_bolted', 'front'):
            panel_leaf(LM, L, mat_leaf, front=(style == 'front'))
            hardware(LM, L, knob_z=0.95 if style != 'front' else 1.0)
        elif style == 'closet':
            louvred_leaf(LM, L, mat_leaf)
            hardware(LM, L, knob_mat='wood_furniture_dark', hinges=2)
        elif style == 'wardrobe_back':
            plank_leaf(LM, L, mat_leaf)
            for k in range(2):
                a = L.P(0.0, T - 0.01, 0.2 + k * (H - 0.5))
                cylinder_between(LM, a, a + UP * 0.07, 0.006, 'cast_iron', segs=6)
        parts.append({'name': name, 'mesh': LM, 'pivot': pivot_floor})
        if style == 'boarded':
            parts.extend(ada_boards(P, door, fr, M1 if M1 is not None else M0))
        if style == 'passage_bolted':
            parts.append(passage_bolt(P, door, fr, L, M0))
    # cased openings (no leaf): the kitchen arch
    for w in P.walls:
        for o in w['openings']:
            if o['kind'] == 'arch':
                R, other = w['left'], w['right']
                fr = Frame(P, o['id'], R)
                lining(fr, meshes[R], P.rooms[R]['trimMat'])
                casing(fr, meshes[R], 0, P.rooms[R]['trimMat'])
                casing(fr, meshes[other], 1, P.rooms[other]['trimMat'])
    return parts, static


def front_surround(P, fr, M):
    """Hero entrance on the facade: pilasters with plinths and capitals, frieze, cornice cap."""
    hw, t, z0, z1 = fr.W / 2, fr.t, fr.z0, fr.z1
    mat = 'trim_chipped'
    pw = 0.16
    e_face = t        # the exterior face is e = t for a frame built from the interior side
    for sgn in (-1, 1):
        a, b = sorted((sgn * hw, sgn * (hw + pw)))
        fr.box(M, a, b, e_face - 0.002, e_face + 0.034, z0, z1 + 0.02, mat, bevel=0.003)
        fr.box(M, a - 0.012, b + 0.012, e_face - 0.002, e_face + 0.05, z0, z0 + 0.26, mat, bevel=0.004, segs=2)
        fr.box(M, a - 0.014, b + 0.014, e_face - 0.002, e_face + 0.052, z1 - 0.06, z1 + 0.02, mat, bevel=0.004,
               segs=2)
        for k in range(3):  # flutes suggested by thin fillets
            cs = (a + b) / 2 + (k - 1) * 0.04
            fr.box(M, cs - 0.006, cs + 0.006, e_face + 0.03, e_face + 0.039, z0 + 0.32, z1 - 0.1, mat, bevel=0.002)
    fr.box(M, -hw - pw - 0.02, hw + pw + 0.02, e_face - 0.002, e_face + 0.04, z1 + 0.02, z1 + 0.22, mat, bevel=0.003)
    fr.box(M, -hw - pw - 0.05, hw + pw + 0.05, e_face - 0.002, e_face + 0.075, z1 + 0.22, z1 + 0.25, mat, bevel=0.004,
           segs=2)
    cap = [(e_face - 0.002, z1 + 0.25), (e_face + 0.09, z1 + 0.25), (e_face + 0.09, z1 + 0.275),
           (e_face - 0.002, z1 + 0.30)]
    fr.prism_ez(M, cap, -hw - pw - 0.07, hw + pw + 0.07, mat, bevel=0.002)


def ada_boards(P, door, fr, M_static):
    """Three rough planks nailed across Ada's door on the hallway side (separate, prised off one by one)."""
    out = []
    hw, t, z0 = fr.W / 2, fr.t, fr.z0
    e_face = t + 0.024       # proud of the hallway casing
    specs = [(0.62, -7.5, 0.16), (1.24, 4.0, 0.15), (1.78, -3.0, 0.14)]
    for k, (hz, deg, bh) in enumerate(specs, start=1):
        name = f'board_D_ADA_{k}'
        c = fr.P(0.0, e_face + 0.0125, z0 + hz)
        x = fr.d.copy()
        a = math.radians(deg)
        n_out = fr.n0 * -1  # e increasing direction (toward the hallway side)
        xr = (x * math.cos(a) + UP * math.sin(a)).normalized()
        zr = xr.cross(n_out).normalized()
        Lb = 2 * hw + 2 * CASE_W + 0.12 + 0.05 * k
        BM = Mesh(name, doorId=door['id'], board=k, flag=f'ada_board_{k}', kind='door_board')
        BM.extras['_pivot'] = c
        oriented_box(BM, c, xr, n_out, zr, Lb / 2, 0.0125, bh / 2, 'wood_raw_plank', bevel=0.004, grain=None)
        for sx in (-Lb / 2 + 0.05, Lb / 2 - 0.05):
            for sz in (-bh / 4, bh / 4):
                p = c + xr * sx + zr * sz + n_out * 0.0126
                nail(BM, p, -n_out)
        out.append({'name': name, 'mesh': BM, 'pivot': c})
    return out


def passage_bolt(P, door, fr, L, M_static):
    """Barrel bolt on the passage-side face of the leaf near the latch edge; the keeper is static."""
    z = 1.25
    # leaf face on the swing side (G3P) is y = 0
    x_body0, x_body1 = L.W - 0.2, L.W - 0.06
    name = 'bolt_D_PASSAGE'
    BM = Mesh(name, doorId=door['id'], kind='door_bolt', slideTravel=0.045, initial='bolted')
    c = L.P((x_body0 + x_body1) / 2, -0.012, z)
    BM.extras['_pivot'] = c
    # sliding barrel + knob (moves toward the latch jamb when bolted)
    shift = 0.045
    a = L.P(x_body0 + 0.01 + shift, -0.012, z)
    b = L.P(x_body1 + shift + 0.02, -0.012, z)
    cylinder_between(BM, a, b, 0.0065, 'cast_iron', segs=8)
    kb = L.P(x_body0 + 0.05 + shift, -0.012, z)
    cylinder_between(BM, kb, kb + (-L.Y) * 0.028, 0.004, 'cast_iron', segs=6)
    BM.extras['slideAxis'] = [round(v, 4) for v in L.X]
    # body plate + guides stay with the LEAF: returned mesh gets them through a second part
    LB = Mesh(name + '_plate', doorId=door['id'], kind='door_bolt_plate')
    LB.extras['_pivot'] = L.o
    L.box(LB, x_body0, x_body1, -0.004, 0.0, z - 0.03, z + 0.03, 'cast_iron', bevel=0.0015)
    for gx in (x_body0 + 0.015, x_body1 - 0.015):
        L.box(LB, gx - 0.008, gx + 0.008, -0.02, -0.003, z - 0.011, z + 0.011, 'cast_iron', bevel=0.002)
    # keeper on the latch-side lining/casing (static, in the room mesh)
    kp = L.P(L.W + 0.03, -0.012, z)
    box(M_static, kp - Vector((0.012, 0.012, 0.012)), kp + Vector((0.012, 0.012, 0.012)), 'cast_iron', bevel=0.002)
    return {'name': name, 'mesh': BM, 'pivot': c, 'plate': LB}


def to_objects(parts):
    import bpy
    objs = []
    for d in parts:
        meshes = [d['mesh']] + ([d['plate']] if d.get('plate') else [])
        for m in meshes:
            pivot = m.extras.pop('_pivot', d['pivot'])
            m.V = [v - pivot for v in m.V]
            ob = m.to_object()
            ob.location = pivot
            ob['pivotWorldPlan'] = [round(c, 4) for c in pivot]
            objs.append(ob)
    # parent the bolt plate to the passage leaf so it swings with it
    by = {o.name: o for o in objs}
    leaf = by.get('door_D_PASSAGE')
    for o in objs:
        if leaf is not None and o.name.startswith('bolt_D_PASSAGE'):
            world = o.location.copy()
            o.parent = leaf
            o.matrix_parent_inverse.identity()
            o.location = world - leaf.location      # leaf is unrotated (closed) at export
    return objs
