"""Double-hung sash windows (2-over-2): frame (pulley stiles, head jamb, sloped sill with horns, blind/parting/stop
beads), two sashes with bevelled members and a muntin, interior jamb extensions, stool + apron, casings with a
capped head; exterior casings, drip cap, closed louvred shutters with strap hinges; nails per state.
Glass panes are separate objects (glass_<opening>) with slightly wavy crown-glass faces.
"""
import math
import random

from mathutils import Vector, noise

from .geom import Mesh, box, cylinder_between
from .openings import Frame
from .trim import APRON, CASE_HEAD, CASE_W

JAMB = 0.022
E_FRAME = 0.15          # frame depth from the exterior face
UP = Vector((0, 0, 1))


def pane(G, fr, s0, s1, z0, z1, e, seed, thick=0.003):
    """Glass pane as a thin slab; both faces gently wavy (old crown glass)."""
    nu, nv = 4, 5
    for side, ee in ((0, e - thick / 2), (1, e + thick / 2)):
        verts, faces = [], []
        for j in range(nv + 1):
            for i in range(nu + 1):
                s = s0 + (s1 - s0) * i / nu
                z = z0 + (z1 - z0) * j / nv
                edge = 0 < i < nu and 0 < j < nv
                wob = 0.0007 * noise.noise(Vector((s * 7.1 + seed, z * 5.3, seed * 0.37))) if edge else 0.0
                verts.append(fr.P(s, ee + wob, z))
        for j in range(nv):
            for i in range(nu):
                a = j * (nu + 1) + i
                f = [a, a + 1, a + nu + 2, a + nu + 1]
                faces.append(f)
        from .geom import newell
        want = -fr.n0 if side == 1 else fr.n0
        fx = []
        for f in faces:
            if newell([verts[k] for k in f]).dot(want) < 0:
                f = list(reversed(f))
            fx.append(f)
        G.piece(verts, fx, 'glass_grimy')
    # thin edges
    for (sa, za), (sb, zb) in (((s0, z0), (s1, z0)), ((s1, z0), (s1, z1)), ((s1, z1), (s0, z1)), ((s0, z1), (s0, z0))):
        A, B = fr.P(sa, e - thick / 2, za), fr.P(sb, e - thick / 2, zb)
        C, D = fr.P(sb, e + thick / 2, zb), fr.P(sa, e + thick / 2, za)
        G.poly([A, B, C, D], 'glass_grimy')


def sash(M, G, fr, s0, s1, z0, z1, e0, e1, bottom, top, stile=0.052, muntin=0.022, mat='trim_chipped', seed=0):
    box_ = fr.box
    box_(M, s0, s0 + stile, e0, e1, z0, z1, mat, bevel=0.004)
    box_(M, s1 - stile, s1, e0, e1, z0, z1, mat, bevel=0.004)
    box_(M, s0 + stile - 0.002, s1 - stile + 0.002, e0, e1, z0, z0 + bottom, mat, bevel=0.004)
    box_(M, s0 + stile - 0.002, s1 - stile + 0.002, e0, e1, z1 - top, z1, mat, bevel=0.004)
    sm = (s0 + s1) / 2
    em = (e0 + e1) / 2
    box_(M, sm - muntin / 2, sm + muntin / 2, e0 + 0.006, e1 - 0.006, z0 + bottom - 0.002, z1 - top + 0.002, mat,
         bevel=0.004)
    # glass sits in a rebate in the middle of the sash depth
    ge = em - 0.004
    pane(G, fr, s0 + stile - 0.006, sm - muntin / 2 + 0.006, z0 + bottom - 0.006, z1 - top + 0.006, ge, seed)
    pane(G, fr, sm + muntin / 2 - 0.006, s1 - stile + 0.006, z0 + bottom - 0.006, z1 - top + 0.006, ge, seed + 3.1)


def nail(M, p, dirv, bent=None, head=0.009, length=0.03):
    """Square cut nail driven along dirv (unit), head at p; optional bent-over shank direction."""
    d = Vector(dirv).normalized()
    ax = d.orthogonal().normalized()
    ay = d.cross(ax)
    from .geom import oriented_box
    oriented_box(M, p - d * 0.0015, ax, ay, d, head / 2, head / 2, 0.0018, 'rust', bevel=0.0008)
    if bent is not None:
        b = Vector(bent).normalized()
        cylinder_between(M, p - d * 0.001, p - d * 0.001 + b * length, 0.0018, 'rust', segs=4)


def window(P, oid, meshes, ext, glass_factory):
    w, o = P.openings[oid]
    room = w['left'] if w['left'] not in ('exterior', 'void') else w['right']
    fr = Frame(P, oid, 'exterior')
    t, W, H, z0, z1 = fr.t, fr.W, fr.H, fr.z0, fr.z1
    M = meshes[room]
    X = ext['trim']
    G = glass_factory(room, '_glass_' + oid, glass=True, opening=oid, lm_weight=0.35)
    rng = random.Random(hash(oid) & 0xffff)
    hw = W / 2
    trim_mat = P.rooms[room]['trimMat']
    st = o['window']['state']
    # ---- frame
    fr.box(M, -hw, -hw + JAMB, 0.0, E_FRAME, z0, z1, 'trim_chipped', bevel=0.002)
    fr.box(M, hw - JAMB, hw, 0.0, E_FRAME, z0, z1, 'trim_chipped', bevel=0.002)
    fr.box(M, -hw, hw, 0.0, E_FRAME, z1 - JAMB, z1, 'trim_chipped', bevel=0.002)
    # sloped sill: top at z0+0.035 inside, falling to z0+0.012 at the nose; horns outside
    sill = [(-0.07, z0 - 0.015), (E_FRAME, z0 - 0.015), (E_FRAME, z0 + 0.036), (0.02, z0 + 0.03), (-0.07, z0 + 0.012)]
    fr.prism_ez(X, sill, -hw - 0.135, hw + 0.135, 'trim_chipped', bevel=0.003)
    # blind stop (outside), parting bead, interior stop bead
    for s_a, s_b in ((-hw + JAMB, -hw + JAMB + 0.014), (hw - JAMB - 0.014, hw - JAMB)):
        fr.box(M, s_a, s_b, 0.0, 0.03, z0 + 0.03, z1 - JAMB, 'trim_chipped', bevel=0.0015)
        fr.box(M, s_a, s_b, 0.079, 0.089, z0 + 0.03, z1 - JAMB, 'trim_chipped', bevel=0.0015)
        fr.box(M, s_a, s_b, 0.135, 0.149, z0 + 0.03, z1 - JAMB, 'trim_chipped', bevel=0.0015)
    fr.box(M, -hw + JAMB, hw - JAMB, 0.0, 0.03, z1 - JAMB - 0.014, z1 - JAMB, 'trim_chipped', bevel=0.0015)
    fr.box(M, -hw + JAMB, hw - JAMB, 0.135, 0.149, z1 - JAMB - 0.014, z1 - JAMB, 'trim_chipped', bevel=0.0015)
    # ---- sashes (upper outside track, lower inside track), meeting rails overlap
    si0, si1 = -hw + JAMB + 0.001, hw - JAMB - 0.001
    zs0, zs1 = z0 + 0.034, z1 - JAMB - 0.001
    zm = (zs0 + zs1) / 2 + 0.02
    lower_lift = 0.0
    sash(M, G, fr, si0, si1, zm - 0.02, zs1, 0.031, 0.034, 0.030, 0.076, mat='trim_chipped', seed=rng.random() * 50)
    sash(M, G, fr, si0, si1, zs0 + lower_lift, zm + 0.02, 0.090, 0.133, 0.075, 0.031, mat='trim_chipped',
         seed=rng.random() * 50)
    # sash lock on the meeting rail + lift handles
    fr.box(M.d, -0.035, 0.035, 0.11, 0.14, zm + 0.02, zm + 0.032, 'brass_tarnished', bevel=0.002)
    for sx in (-0.18 * W, 0.18 * W):
        fr.box(M.d, sx - 0.015, sx + 0.015, 0.133, 0.15, zs0 + 0.05, zs0 + 0.07, 'brass_tarnished', bevel=0.003)
    # ---- interior: jamb extensions, stool, apron, casings
    fr.box(M, -hw, -hw + 0.018, E_FRAME - 0.004, t + 0.001, z0 + 0.036, z1, trim_mat, bevel=0.0015)
    fr.box(M, hw - 0.018, hw, E_FRAME - 0.004, t + 0.001, z0 + 0.036, z1, trim_mat, bevel=0.0015)
    fr.box(M, -hw, hw, E_FRAME - 0.004, t + 0.001, z1 - 0.018, z1, trim_mat, bevel=0.0015)
    sw = hw + CASE_W + 0.03
    fr.box(M, -sw, sw, E_FRAME - 0.01, t + 0.038, z0 + 0.008, z0 + 0.036, trim_mat, bevel=0.004, segs=2)
    fr.box(M, -hw - CASE_W + 0.005, hw + CASE_W - 0.005, t - 0.002, t + 0.02, z0 + 0.008 - (APRON - 0.03),
           z0 + 0.008, trim_mat, bevel=0.003)
    for sgn in (-1, 1):
        a, b = sorted((sgn * hw, sgn * (hw + CASE_W)))
        fr.box(M, a, b, t - 0.002, t + 0.02, z0 + 0.036, z1 + 0.002, trim_mat, bevel=0.003)
        a2, b2 = sorted((sgn * (hw + CASE_W - 0.014), sgn * (hw + CASE_W)))
        fr.box(M, a2, b2, t - 0.002, t + 0.03, z0 + 0.036, z1 + CASE_HEAD - 0.03, trim_mat, bevel=0.003)  # back band
    fr.box(M, -hw - CASE_W, hw + CASE_W, t - 0.002, t + 0.022, z1, z1 + CASE_HEAD - 0.03, trim_mat, bevel=0.003)
    fr.box(M, -hw - CASE_W - 0.016, hw + CASE_W + 0.016, t - 0.002, t + 0.036, z1 + CASE_HEAD - 0.03,
           z1 + CASE_HEAD - 0.012, trim_mat, bevel=0.004, segs=2)
    fr.box(M, -hw - CASE_W - 0.01, hw + CASE_W + 0.01, t - 0.002, t + 0.03, z1 + CASE_HEAD - 0.012,
           z1 + CASE_HEAD, trim_mat, bevel=0.003)
    # ---- nails (nailed states): through the lower sash stiles into the pulley stiles, one bent
    if st in ('nailed', 'nailed_shuttered'):
        for k, (sx, zz) in enumerate(((si0 + 0.028, zs0 + 0.25), (si1 - 0.028, zs0 + 0.31), (si0 + 0.028, zm - 0.12),
                                       (si1 - 0.028, zm - 0.05), (0.03, zm + 0.012))):
            p = fr.P(sx, 0.1335, zz)
            toward_jamb = -1.0 if sx < 0 else 1.0
            dirv = fr.n0 + fr.d * (0.35 * toward_jamb) + UP * rng.uniform(-0.15, 0.15)
            bent = (fr.d * -toward_jamb + UP * 0.5) if k == 3 else None
            nail(M.d, p, dirv, bent=bent)
    # ---- exterior casing + drip cap
    cw, ct = 0.115, 0.032
    for sgn in (-1, 1):
        a, b = sorted((sgn * hw, sgn * (hw + cw)))
        fr.box(X, a, b, -ct, 0.004, z0 + 0.01, z1 + 0.004, 'trim_chipped', bevel=0.003)
    fr.box(X, -hw - cw, hw + cw, -ct, 0.004, z1, z1 + 0.13, 'trim_chipped', bevel=0.003)
    drip = [(-ct - 0.02, z1 + 0.13), (0.004, z1 + 0.13), (0.004, z1 + 0.16), (-ct - 0.012, z1 + 0.148),
            (-ct - 0.02, z1 + 0.14)]
    fr.prism_ez(X, drip, -hw - cw - 0.015, hw + cw + 0.015, 'trim_chipped', bevel=0.002)
    # bed moulding under the sill nose
    fr.box(X, -hw - cw + 0.01, hw + cw - 0.01, -ct + 0.004, 0.002, z0 - 0.045, z0 - 0.015, 'trim_chipped', bevel=0.004)
    # ---- shutters
    if st in ('shuttered', 'nailed_shuttered'):
        shutters(P, X, fr, hw, z0 + 0.012, z1 - 0.004, rng, nailed=(st == 'nailed_shuttered'),
                 leak=bool(o['window'].get('lightLeak')))
    return G


def shutters(P, X, fr, hw, z0, z1, rng, nailed=False, leak=False):
    """Closed pair of louvred shutters seated inside the exterior casing (e from -0.03 to 0)."""
    e0, e1 = -0.03, -0.001
    mat = 'door_front'
    gap = 0.004
    for side in (-1, 1):
        s_in, s_out = side * gap / 2, side * (hw - 0.003)
        a, b = sorted((s_in, s_out))
        warp = rng.uniform(-0.004, 0.004)
        stile = 0.048
        fr.box(X, a, a + stile, e0 + warp, e1, z0, z1, mat, bevel=0.003)
        fr.box(X, b - stile, b, e0, e1, z0, z1, mat, bevel=0.003)
        zc = z0 + (z1 - z0) * 0.52
        for (za, zb) in ((z0, z0 + 0.085), (zc - 0.03, zc + 0.03), (z1 - 0.06, z1)):
            fr.box(X, a + stile - 0.002, b - stile + 0.002, e0 + 0.002, e1 - 0.002, za, zb, mat, bevel=0.003)
        # louvres: slats tilted ~40 deg, slight random tilt; gaps pass light
        for (za, zb) in ((z0 + 0.085, zc - 0.03), (zc + 0.03, z1 - 0.06)):
            n = max(1, int((zb - za) / 0.042))
            pitch = (zb - za) / n
            for k in range(n):
                zz = za + pitch * (k + 0.5)
                tilt = math.radians(40 + rng.uniform(-6, 6) + (18 if leak and rng.random() < 0.25 else 0))
                h2, d2 = 0.019, 0.004
                ce, cz = (e0 + e1) / 2, zz
                ca, sa = math.cos(tilt), math.sin(tilt)
                poly = [(ce - h2 * ca + d2 * sa, cz - h2 * sa - d2 * ca), (ce + h2 * ca + d2 * sa, cz + h2 * sa - d2 * ca),
                        (ce + h2 * ca - d2 * sa, cz + h2 * sa + d2 * ca), (ce - h2 * ca - d2 * sa, cz - h2 * sa + d2 * ca)]
                # inner edge (larger e) is higher: rain sheds outward, no view in from below
                fr.prism_ez(X.d, poly, a + stile - 0.003, b - stile + 0.003, mat, bevel=0.0)
        # strap hinges + pintles on the outer stile / casing
        for zz in (z0 + 0.12, z1 - 0.14):
            sa_, sb_ = sorted((side * (hw - 0.003 - 0.16), side * (hw - 0.003)))
            fr.box(X.d, sa_, sb_, e0 - 0.004, e0, zz - 0.012, zz + 0.012, 'cast_iron', bevel=0.001)
            pa, pb = sorted((side * (hw - 0.004), side * (hw + 0.03)))
            fr.box(X.d, pa, pb, e0 - 0.016, e0 - 0.002, zz - 0.02, zz + 0.02, 'cast_iron', bevel=0.002)
        if nailed:
            for zz in (z0 + 0.3, (z0 + z1) / 2, z1 - 0.35):
                p = fr.P(side * 0.022, e0 - 0.0005, zz + rng.uniform(-0.05, 0.05))
                nail(X.d, p, fr.n0 * -1 + fr.d * rng.uniform(-0.2, 0.2))


def build_windows(P, meshes, ext, room_mesh):
    glass = []
    for w in P.walls:
        for o in w['openings']:
            if o['kind'] == 'window':
                glass.append(window(P, o['id'], meshes, ext, room_mesh))
    return glass
