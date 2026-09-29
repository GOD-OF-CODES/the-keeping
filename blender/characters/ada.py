"""Ada Stroud — the revenant. Slight (1.62 m), barefoot, sodden ivory nightgown, grey-blue skin, long wet black hair
plastered over the whole face (one clouded, iris-less right eye is the most ever shown), half-severed neck.

build() returns a dict of objects; build_characters.py textures, validates and saves them.
Runtime chains (keyed lightly by clips, driven by verlet at runtime): hair_<g>_01..04 (8 groups), gown_<k>_01..03
(8 around the skirt). Shape keys on ada_body + ada_hair: jaw_open, gurgle.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector

from lib.scene import log
from lib import noise
from . import body, garments, hair, rig, sdf, sim, skeleton

P = skeleton.ADA
S = body.STYLE_ADA
HEM_Z = 0.30
SKIRT_TOP = 1.205
BODICE_BOTTOM = 1.172
N_HAIR_GROUPS = 8
N_GOWN_CHAINS = 8


def neckline(y):
    w = np.clip((0.03 - y) / 0.08, 0.0, 1.0)
    return 1.352 - 0.034 * w


def with_wound(fn, J):
    """Half-severed neck: a lens-shaped gash from the front (slightly to her left) through ~2/3 of the neck."""
    a, b = J['neck_02'][0], J['head'][0]
    c = a * 0.55 + b * 0.45 + np.array([0.006, -0.032, 0.0])
    R = sdf.frame([0.22, -1.0, 0.05], [0.0, 0.12, 1.0])

    def f(X):
        return sdf.smax(fn(X), -sdf.ellipsoid(X, c, (0.052, 0.047, 0.0058), R), 0.0028)
    for k in ('head', 'head_center', 'torso', 'trunk', 'J', 'socket_r'):
        setattr(f, k, getattr(fn, k))
    f.wound_center = c
    return f


# ------------------------------------------------------------------------------------------------ chains
def gown_chain_specs(skirt_ob):
    """8 chains around the skirt (azimuth 0 = front), 3 bones each from the hips to the hem."""
    Pk, _ = body.mesh_arrays(skirt_ob.data)
    specs = []
    zs = [0.9, 0.72, 0.52, HEM_Z + 0.01]
    for k in range(N_GOWN_CHAINS):
        ang = 2 * math.pi * k / N_GOWN_CHAINS
        d2 = np.array([math.sin(ang), -math.cos(ang)])
        pts = []
        for z in zs:
            m = np.abs(Pk[:, 2] - z) < 0.02
            Q = Pk[m]
            if len(Q) == 0:
                Q = Pk
            proj = Q[:, :2] @ d2
            r = np.percentile(proj, 90) * 0.85
            pts.append(np.array([d2[0] * r, d2[1] * r, z]))
        for i in range(3):
            specs.append(skeleton.B(f'gown_{k}_{i + 1:02d}', pts[i], pts[i + 1], 'hips' if i == 0 else f'gown_{k}_{i:02d}',
                                    connect=i > 0, flex=(d2[0], d2[1], 0.0)))
    return specs


def hair_chain_specs(groups):
    """groups: {g: list of hanging polylines (n,3)} -> 4 bones per group along the mean hanging path."""
    specs = []
    for g, lines in sorted(groups.items()):
        if not lines:
            continue
        # resample each to 5 points by arclength, average
        res = []
        for L in lines:
            seg = np.linalg.norm(np.diff(L, axis=0), axis=1)
            s = np.concatenate([[0], np.cumsum(seg)])
            if s[-1] < 1e-4:
                continue
            u = np.linspace(0, s[-1], 5)
            res.append(np.stack([np.interp(u, s, L[:, k]) for k in range(3)], 1))
        M = np.mean(res, axis=0)
        for i in range(4):
            d = M[i + 1] - M[i]
            specs.append(skeleton.B(f'hair_{g}_{i + 1:02d}', M[i], M[i + 1], 'head' if i == 0 else f'hair_{g}_{i:02d}',
                                    connect=i > 0, flex=(0, -1, 0) if abs(d[1]) < 0.9 * np.linalg.norm(d) else (1, 0, 0)))
    return specs


# ------------------------------------------------------------------------------------------------ gown
def build_gown(body_full, fn, J):
    Pv, _ = body.mesh_arrays(body_full.data)
    core = [n for n in J if not n.startswith(('root',))]
    lab, t, _ = garments.nearest_bone(Pv, J, core)
    name = np.array(core)[lab]
    z, y = Pv[:, 2], Pv[:, 1]
    starts = lambda arr, pre: np.array([str(x).startswith(pre) for x in arr])
    is_arm = starts(name, ('upperarm', 'clavicle')) | (starts(name, 'forearm') & (t < 0.955))
    is_torso = np.isin(name, ['spine_02', 'spine_03', 'neck_01', 'neck_02', 'hips', 'spine_01'])
    mask = (is_torso & (z >= BODICE_BOTTOM) & (z < neckline(y))) | (is_arm & ~(is_torso))
    bodice = garments.extract(body_full, mask, 'ada_bodice')
    garments.decimate(bodice, 0.16)
    # wet cotton: clings (3.5 mm) on the torso, a little looser along the sleeves, flaring slightly at the cuffs
    J_ = J

    def offset(X):
        o = np.full(len(X), 0.0075)
        # the bust does not get shrink-wrapped: fabric bridges from the bust to the ribs
        o = o + 0.006 * np.clip((X[:, 2] - 1.14) / 0.04, 0, 1) * np.clip((1.25 - X[:, 2]) / 0.03, 0, 1) * (X[:, 1] < -0.02)
        for side in ('l', 'r'):
            a, b = J_[f'upperarm_{side}'][0], J_[f'forearm_{side}'][1]
            ab = b - a
            tt = np.clip(((X - a) @ ab) / ab.dot(ab), 0, 1)
            dist = sdf.norm(X - (a + tt[:, None] * ab))
            on = dist < 0.07
            o = np.where(on, 0.009 + 0.006 * np.clip((tt - 0.85) / 0.15, 0, 1), o)
        return o
    garments.project_offset(bodice, fn, offset)
    Pb, _ = body.mesh_arrays(bodice.data)
    amp = 0.0045 * noise.fbm(Pb * np.array([8.0, 8.0, 18.0]), 3, 5) + 0.0035 * (noise.ridged(Pb * np.array([30.0, 30.0, 14.0]), 3, 9) - 0.5)
    # drape: vertical folds falling from the bust to the yoke seam, compression rings in the sleeves
    ang = np.arctan2(Pb[:, 0], -Pb[:, 1])
    drape = 0.004 * np.sin(ang * 16 + 3 * noise.fbm(Pb * 10, 2, 11)) * np.clip((1.25 - Pb[:, 2]) / 0.05, 0, 1) * (Pb[:, 2] > BODICE_BOTTOM) \
        * (np.abs(Pb[:, 0]) < 0.14)
    rings = np.zeros(len(Pb))
    for side in ('l', 'r'):
        a, b = J[f'upperarm_{side}'][0], J[f'forearm_{side}'][1]
        ab = b - a
        tt = ((Pb - a) @ ab) / ab.dot(ab)
        near = sdf.norm(Pb - (a + np.clip(tt, 0, 1)[:, None] * ab)) < 0.07
        rings += near * 0.0035 * np.sin(tt * 55 + 2 * noise.fbm(Pb * 15, 2, 12)) * (0.4 + 0.6 * np.exp(-((tt - 0.55) / 0.12) ** 2))
    garments.displace_normal(bodice, amp + drape + rings)

    # skirt: gathered under the bust, hangs to mid-shin, heavy and wet
    rows = S['torso']
    zs_ = [r[0] for r in rows]

    def center(zz):
        if zz >= zs_[0]:
            return np.array([0.0, float(np.interp(zz, zs_, [r[1] for r in rows]))])
        return np.array([0.0, 0.01])
    skirt = garments.skirt(fn.trunk, SKIRT_TOP, HEM_Z, 76, 34, ease=lambda s: 0.004 + 0.034 * s ** 1.3,
                           folds=lambda s: 0.0015 + 0.011 * s ** 0.9, seed=87, center_fn=center, hem_wave=0.012,
                           name='ada_skirt')
    return bodice, skirt


def settle_skirt(skirt, collider):
    me = skirt.data
    Pk, _ = body.mesh_arrays(me)
    top = Pk[:, 2] > SKIRT_TOP - 0.035
    g = skirt.vertex_groups.new(name='pin')
    g.add(np.nonzero(top)[0].tolist(), 1.0, 'REPLACE')
    sim.add_collider(collider, thickness=0.004, friction=8.0)
    sim.settle(skirt, frames=24, pin_group='pin', mass=0.55, tension=18.0, bending=0.08, shear=6.0, air=3.0,
               quality=7, distance=0.004)
    skirt.vertex_groups.clear()
    sim.remove_colliders([collider])


def cling(ob, fn, reach=0.018, offset=0.0042, strength=0.75, zmax=None):
    """Wet cloth sticks: vertices within `reach` of the body are pulled most of the way onto body + offset."""
    me = ob.data
    Pk, E = body.mesh_arrays(me)
    d = fn(Pk)
    g = sdf.gradient(fn, Pk)
    g /= np.maximum(sdf.norm(g), 1e-9)[:, None]
    w = np.clip(1.0 - (d - offset) / reach, 0.0, 1.0) ** 1.5 * strength
    if zmax is not None:
        w *= (Pk[:, 2] < zmax)
    target = Pk - g * (d - offset)[:, None]
    Pk = Pk + (target - Pk) * w[:, None]
    Pk = body.taubin(Pk, E, iters=1)
    body.set_positions(me, Pk)


# ------------------------------------------------------------------------------------------------ hair
def build_hair(fn, J, rng):
    hc = fn.head_center
    head = fn.head
    # stick to head + body (wet hair plastered on the face, then onto the neck/chest/back); gown ~ body + 5 mm
    stick = fn

    def coll(X):
        return fn(X) - 0.004
    B, Lh, Hh = S['head']['breadth'], S['head']['length'], S['head']['height']
    crown = hc + np.array([0.0, 0.028, Hh * 0.9])
    crown = sdf.project(head, crown[None], iters=10)[0]
    hb = hair.HairBuilder('ada_hair')
    groups_hang = {g: [] for g in range(N_HAIR_GROUPS)}
    sock = fn.socket_r
    # ---- veil: crown ring of strands radiating over the whole head (face included)
    M = 72
    veil_rows, veil_att, veil_arc, veil_grp = [], [], [], []
    roots, dirs, lens, phis = [], [], [], []
    for k in range(M):
        phi = 2 * math.pi * k / M                         # 0 = front (-Y), + toward her left (+X)
        dirh = np.array([math.sin(phi), -math.cos(phi), 0.0])
        root = crown + dirh * 0.018 + np.array([0, 0, 0.004])
        root = sdf.project(head, root[None], iters=8)[0]
        gr = sdf.gradient(head, root[None])[0]
        gr /= np.linalg.norm(gr)
        roots.append(root)
        dirs.append(dirh - gr * dirh.dot(gr))
        front = math.cos(phi)                            # 1 = face side
        lens.append(0.64 + 0.3 * (1 - front) * 0.5 + rng.uniform(-0.04, 0.04))   # chest in front, waist behind
        phis.append(phi)
    res = hair.integrate(roots, dirs, lens, stick, coll, step=0.009, offset=0.0055, stick=0.014, grav=0.3,
                         detach_dot=0.3, rng=rng, wander=0.02)
    ring = [(phi, *r) for phi, r in zip(phis, res)]
    # the veil part of each strand: up to the detach point + 3 cm
    nrow = 26
    Lsheet = []
    for phi, pts, att, nrm in ring:
        seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        s = np.concatenate([[0], np.cumsum(seg)])
        det = np.argmin(att) if (~att).any() else len(att) - 1
        Lsheet.append(min(s[det] + rng.uniform(0.02, 0.09), s[-1]))
    for (phi, pts, att, nrm), Ls in zip(ring, Lsheet):
        seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        s = np.concatenate([[0], np.cumsum(seg)])
        u = np.linspace(0, Ls, nrow)
        rowp = np.stack([np.interp(u, s, pts[:, k]) for k in range(3)], 1)
        veil_rows.append(rowp)
        veil_att.append([True] * nrow)
        veil_arc.append(list(np.linspace(0.0, 0.5, nrow)))      # veil strip: opaque to v=0.38, frays to 0.5
        veil_grp.append(-1)
    rows = np.array(veil_rows)
    # eye slit: the column pair straddling the right-eye socket opens a narrow gap at eye height
    xs = []
    for c in range(M):
        r = rows[c]
        k = np.argmin(np.abs(r[:, 2] - sock[2]) + 5 * (r[:, 1] > sock[1] + 0.02))
        xs.append((r[k, 0], r[k, 1], c, k))
    front_cols = [x for x in xs if x[1] < sock[1] + 0.01]
    best = min(front_cols, key=lambda x: abs(x[0] - (sock[0] + 0.004)))
    c_slit = best[2]
    c0, c1 = (c_slit, (c_slit + 1) % M) if rows[c_slit][best[3], 0] > sock[0] else ((c_slit - 1) % M, c_slit)
    ks = [k for k in range(nrow) if abs(rows[c0][k, 2] - sock[2]) < 0.012]
    for k in range(nrow):
        wgt = math.exp(-((rows[c0][k, 2] - sock[2]) / 0.012) ** 2)
        side = np.array([1.0, 0.0, 0.0])
        rows[c0][k] += side * 0.002 * wgt
        rows[c1][k] -= side * 0.002 * wgt
    skipset = {(c0, k) for k in ks[:-1]} if len(ks) > 1 else set()
    rows_closed = np.concatenate([rows, rows[:1]], 0)
    arc_closed = veil_arc + veil_arc[:1]
    att_closed = veil_att + veil_att[:1]
    hb.add_sheet(rows_closed, hair.VEIL_U, arc_closed, att_closed, [-1] * (M + 1), layer=0,
                 skip=lambda c, r: (c, r) in skipset)
    log(f'hair veil: {M} strands x {nrow} rows, eye slit between columns {c0}/{c1} rows {ks}')

    # ---- cards: clumps continuing each strand below the sheet + extra clumps over the veil
    ncard = 0

    def add_card(pts, att, nrm, width, lift, group, strip):
        nonlocal ncard
        keep = list(range(0, len(pts) - 1, 2)) + [len(pts) - 1]
        pts, att, nrm = pts[keep], att[keep], nrm[keep]
        n = len(pts)
        seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        s = np.concatenate([[0], np.cumsum(seg)])
        tot = max(s[-1], 1e-3)
        wprof = width * np.clip(np.minimum(s / 0.03 + 0.35, 1.0), 0, 1) * np.clip((tot - s) / 0.08 * 0.8 + 0.2, 0.15, 1.0)
        Lp, Rp = hair.ribbon_verts(pts, nrm, wprof, lift=lift)
        u0, u1 = hair.card_u(strip)
        hb.add_strip(Lp, Rp, u0, u1, list(s / 0.9), list(att), group, layer=1)
        ncard += 1

    for i, (phi, pts, att, nrm) in enumerate(ring):
        g = int(((phi / (2 * math.pi)) * N_HAIR_GROUPS + 0.5)) % N_HAIR_GROUPS
        det = np.argmin(att) if (~att).any() else len(att)
        if det < len(att) - 2:
            groups_hang[g].append(pts[det:])
        # every strand continues as a rope; alternate widths so ropes separate
        w = rng.uniform(0.012, 0.024) if i % 2 == 0 else rng.uniform(0.008, 0.016)
        k0 = int(rng.integers(3, 9))                       # start below the crown: the veil covers the whorl
        add_card(pts[k0:], att[k0:], nrm[k0:], w, 0.0015 + 0.001 * (i % 3), g, rng.integers(0, hair.CARD_STRIPS))
    # extra loose clumps across the face and crown (stringy wet ropes over the veil)
    roots, dirs, lens, phis = [], [], [], []
    for j in range(46):
        phi = rng.uniform(-math.pi, math.pi)
        if j < 26:
            phi = rng.normal(0.0, 0.55)                      # biased to the face
        dirh = np.array([math.sin(phi), -math.cos(phi), 0.0])
        root = crown + dirh * rng.uniform(0.045, 0.085)
        root = sdf.project(head, root[None], iters=8)[0]
        gr = sdf.gradient(head, root[None])[0]
        gr /= np.linalg.norm(gr)
        roots.append(root)
        dirs.append(dirh - gr * dirh.dot(gr))
        lens.append(0.58 + 0.3 * (1 - math.cos(phi)) * 0.5 + rng.uniform(-0.06, 0.06))
        phis.append(phi)
    res = hair.integrate(roots, dirs, lens, stick, coll, step=0.009, offset=0.0075, stick=0.016, grav=0.3,
                         detach_dot=0.3, rng=rng, wander=0.03)
    for j, (phi, (pts, att, nrm)) in enumerate(zip(phis, res)):
        # keep clumps off the eye slit so the eye stays glimpsable
        if np.min(np.linalg.norm(pts - sock, axis=1)) < 0.014:
            continue
        g = int((((phi % (2 * math.pi)) / (2 * math.pi)) * N_HAIR_GROUPS + 0.5)) % N_HAIR_GROUPS
        add_card(pts, att, nrm, rng.uniform(0.007, 0.018), 0.0035 + 0.001 * (j % 3), g, rng.integers(0, hair.CARD_STRIPS))
    # crown cap: small disc of hair over the whorl
    cap_r = 0.024
    capv, capf = [crown + np.array([0, 0, 0.004])], []
    for k in range(16):
        phi = 2 * math.pi * k / 16
        p = crown + np.array([math.sin(phi), -math.cos(phi), 0]) * cap_r
        p = sdf.project(lambda X: head(X) - 0.006, p[None], iters=8)[0]
        capv.append(p)
    base = len(hb.verts)
    for p in capv:
        hb.verts.append(tuple(p))
        hb.arc.append(0.0)
        hb.att.append(True)
        hb.group.append(-1)
        hb.layer.append(0)
    for k in range(16):
        a, b = base + 1 + k, base + 1 + (k + 1) % 16
        hb.faces.append((base, a, b))
        hb.uvs.append(((0.12, 0.0), (0.02, 0.05), (0.22, 0.05)))
    ob, arc, att, grp, layer = hb.build()
    log(f'hair: {ncard} cards, {len(ob.data.polygons)} faces')
    return ob, arc, att, grp, groups_hang


def hair_weights(hair_ob, att, grp, rig):
    """Plastered part: 100 % head. Hanging part: its group's chain by arc length past the detach point."""
    me = hair_ob.data
    Pk, _ = body.mesh_arrays(me)
    names = ['head'] + [b.name for b in rig.data.bones if b.name.startswith('hair_')]
    idx = {n: i for i, n in enumerate(names)}
    W = np.zeros((len(Pk), len(names)))
    W[:, 0] = 1.0
    chains = {}
    for b in rig.data.bones:
        if b.name.startswith('hair_'):
            g = int(b.name.split('_')[1])
            chains.setdefault(g, []).append(b)
    for g, bl in chains.items():
        bl.sort(key=lambda b: b.name)
        heads = np.array([np.array(b.head_local) for b in bl])
        tails = np.array([np.array(b.tail_local) for b in bl])
        sel = (grp == g) & (~att)
        if not sel.any():
            continue
        Q = Pk[sel]
        # distance along the chain: project onto each bone, pick nearest, blend with neighbour
        best = np.full(len(Q), 1e9)
        pos = np.zeros(len(Q))
        for i, (h, t) in enumerate(zip(heads, tails)):
            ab = t - h
            tt = np.clip(((Q - h) @ ab) / ab.dot(ab), 0, 1)
            dd = sdf.norm(Q - (h + tt[:, None] * ab))
            m = dd < best
            best[m] = dd[m]
            pos[m] = i + tt[m]
        rowsW = np.zeros((len(Q), len(names)))
        for q in range(len(Q)):
            x = pos[q] - 0.5
            i0 = int(np.clip(math.floor(x), 0, len(bl) - 1))
            i1 = min(i0 + 1, len(bl) - 1)
            f = float(np.clip(x - i0, 0, 1)) if x >= 0 else 0.0
            if x < 0:
                # near the first bone's head: blend with the head bone
                wh = float(np.clip(-x * 2, 0, 1))
                rowsW[q, 0] = wh
                rowsW[q, idx[bl[0].name]] += 1 - wh
            else:
                rowsW[q, idx[bl[i0].name]] += 1 - f
                rowsW[q, idx[bl[i1].name]] += f
        W[sel] = rowsW
    rig_names = names
    rig.data  # keep reference
    set_w = rig_names
    from .rig import set_weights
    set_weights(hair_ob, set_w, W, limit=4)


# ------------------------------------------------------------------------------------------------ eye
def build_eye(fn):
    c = fn.socket_r + np.array([0, 0.0095, 0])
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, radius=0.0118, location=tuple(c))
    eye = bpy.context.active_object
    eye.name = 'ada_eye'
    # cornea bulge toward -Y (she looks forward)
    me = eye.data
    Pk, _ = body.mesh_arrays(me)
    q = Pk - c
    fwd = -q[:, 1] / 0.0118
    bulge = np.clip(fwd - 0.72, 0, None) * 0.0045
    Pk[:, 1] -= bulge
    body.set_positions(me, Pk)
    for p in me.polygons:
        p.use_smooth = True
    # UV: planar front projection (iris-less clouded cornea centred at (0.5, 0.5))
    uv = me.uv_layers[0] if me.uv_layers else me.uv_layers.new(name='UVMap')
    for p in me.polygons:
        for li in range(p.loop_start, p.loop_start + p.loop_total):
            v = Pk[me.loops[li].vertex_index] - c
            uv.data[li].uv = (0.5 + v[0] / 0.026, 0.5 + v[2] / 0.026)
    return eye


# ------------------------------------------------------------------------------------------------ shape keys
def jaw_field(Pk, J):
    """Rotation of the lower face about the jaw hinge (radians per unit key) as displacement for jaw_open."""
    j0, j1 = J['jaw']
    hinge = j0
    axis = np.array([1.0, 0.0, 0.0])
    q = Pk - hinge
    # influence: below the hinge, in front of the neck
    below = np.clip((hinge[2] - Pk[:, 2]) / 0.02, 0, 1)
    front = np.clip((hinge[1] + 0.005 - Pk[:, 1]) / 0.03, 0, 1)
    low = np.clip((Pk[:, 2] - (j1[2] - 0.035)) / 0.02, 0, 1)
    w = below * front * low
    ang = math.radians(16)
    c, s = math.cos(ang), math.sin(ang)
    # rotate about +X: chin goes down and back
    y = q[:, 1] * c - q[:, 2] * s
    z = q[:, 1] * s + q[:, 2] * c
    rot = np.stack([q[:, 0], y, z], 1) + hinge
    return (rot - Pk) * w[:, None]


def add_shape_keys(ob, J, wound_c, is_hair=False):
    me = ob.data
    Pk, _ = body.mesh_arrays(me)
    if ob.data.shape_keys is None:
        ob.shape_key_add(name='Basis')
    k = ob.shape_key_add(name='jaw_open', from_mix=False)
    D = jaw_field(Pk, J)
    if is_hair:
        D *= 1.05
    k.data.foreach_set('co', (Pk + D).ravel())
    k2 = ob.shape_key_add(name='gurgle', from_mix=False)
    # throat pulse: the gash lips part and the throat below swells
    d = sdf.norm(Pk - wound_c)
    w = np.exp(-(d / 0.03) ** 2)
    up = np.sign(Pk[:, 2] - wound_c[2])
    G = np.zeros_like(Pk)
    G[:, 2] = up * 0.0035 * w
    G[:, 1] = -0.003 * w * (Pk[:, 1] < wound_c[1] + 0.01)
    if is_hair:
        G *= 0.4
    k2.data.foreach_set('co', (Pk + G + D * 0.25).ravel())


# ------------------------------------------------------------------------------------------------ main
def build(h=0.003, log_=log):
    rng = np.random.default_rng(103)
    bones = skeleton.body_bones(P)
    J = body.joints(bones)
    fn = with_wound(body.anatomy(P, J, S), J)
    lo, hi = body.body_bounds(J)
    full = body.sdf_object(fn, lo, hi, h, 'ada_full', log=log_)
    garments.decimate(full, 0.5)
    log_(f'ada full body: {len(full.data.polygons)} faces')
    # gown
    bodice, skirt = build_gown(full, fn, J)
    collider = full.copy()
    collider.data = full.data.copy()
    bpy.context.scene.collection.objects.link(collider)
    garments.decimate(collider, 0.15)
    settle_skirt(skirt, collider)
    cling(skirt, fn.trunk, reach=0.02, offset=0.0045, strength=0.7)
    # hair
    hair_ob, arc, att, grp, hang = build_hair(fn, J, rng)
    # skeleton + runtime chains
    hc = fn.head_center
    jh = hc + np.array([0.0, -0.045, -0.128])
    bones.append(skeleton.B('jaw_hold', jh, jh + np.array([0.0, 0.0, -0.03]), 'head', flex=(0, -1, 0), deform=False))
    bones += hair_chain_specs(hang)
    bones += gown_chain_specs(skirt)
    rig_ob = skeleton.build_armature('ada_rig', bones)
    # weights: bone heat on a proxy of the whole body (core bones only), then transfer
    proxy = collider
    core = [b.name for b in skeleton.body_bones(P) if b.deform]
    rig.auto_weights(proxy, rig_ob, only=core)
    empty = rig.check_groups(proxy, rig_ob, core)
    if empty:
        log_(f'WARNING bone heat left empty groups: {empty}')
    # visible body: delete what the gown covers (with overlap margins), then decimate
    Pv, _ = body.mesh_arrays(full.data)
    lab_i, t, _ = garments.nearest_bone(Pv, J, core)
    labs = np.array(core)[lab_i]
    z, y = Pv[:, 2], Pv[:, 1]
    covered = (z > 0.62) & (z < neckline(y) - 0.022)      # legs kept to mid-thigh: knees swing past the hem
    starts = lambda arr, pre: np.array([str(x).startswith(pre) for x in arr])
    arm = starts(labs, ('upperarm', 'clavicle'))
    fore = starts(labs, 'forearm') & (t < 0.8)
    hidden = (covered & ~starts(labs, ('hand', 'thumb', 'index', 'middle', 'ring', 'pinky', 'forearm', 'upperarm'))) | arm | fore
    body_vis = full
    body_vis.name = 'ada_body'
    body_vis.data.name = 'ada_body'
    garments.delete_verts(body_vis, hidden)
    garments.decimate(body_vis, 0.27)
    # gown pieces joined
    gown = join([bodice, skirt], 'ada_gown')
    for ob in (body_vis, gown):
        rig.transfer_weights(proxy, ob, core)
    skirt_chain_weights(gown, rig_ob, J)
    hair_weights(hair_ob, att, grp, rig_ob)
    eye = build_eye(fn)
    set_single(eye, 'head')
    add_shape_keys(body_vis, J, fn.wound_center)
    add_shape_keys(hair_ob, J, fn.wound_center, is_hair=True)
    for ob in (body_vis, gown, hair_ob, eye):
        rig.cleanup(ob, rig_ob)
        rig.bind(ob, rig_ob)
    bpy.data.objects.remove(proxy)
    return dict(rig=rig_ob, body=body_vis, gown=gown, hair=hair_ob, eye=eye, fn=fn, J=J)


def join(objs, name):
    from lib.scene import select
    select(objs, objs[0])
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def set_single(ob, bone):
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    g = ob.vertex_groups.new(name=bone)
    g.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')


def skirt_chain_weights(gown, rig_ob, J):
    """Below the hips the skirt follows its gown chains (runtime springs), with a residual thigh influence."""
    from .rig import weight_arrays, set_weights
    names = [g.name for g in gown.vertex_groups]
    chain_names = [b.name for b in rig_ob.data.bones if b.name.startswith('gown_')]
    allnames = names + [n for n in chain_names if n not in names]
    W = weight_arrays(gown, allnames)
    Pk, _ = body.mesh_arrays(gown.data)
    z = Pk[:, 2]
    blend = np.clip((0.9 - z) / 0.25, 0, 1)
    ang = np.arctan2(Pk[:, 0], -Pk[:, 1]) % (2 * math.pi)
    Wc = np.zeros_like(W)
    zb = [0.9, 0.72, 0.52, HEM_Z]
    for i in range(len(Pk)):
        if blend[i] <= 0:
            continue
        a = ang[i] / (2 * math.pi) * N_GOWN_CHAINS
        k0 = int(math.floor(a)) % N_GOWN_CHAINS
        k1 = (k0 + 1) % N_GOWN_CHAINS
        fa = a - math.floor(a)
        zz = z[i]
        bi = 0 if zz > zb[1] else (1 if zz > zb[2] else 2)
        for k, wk in ((k0, 1 - fa), (k1, fa)):
            Wc[i, allnames.index(f'gown_{k}_{bi + 1:02d}')] += wk
    W = W * (1 - blend[:, None] * 0.8) + Wc * (blend[:, None] * 0.8)
    set_weights(gown, allnames, W, limit=4)
