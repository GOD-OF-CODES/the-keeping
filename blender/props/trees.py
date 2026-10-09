"""Bare deciduous trees in winter (layout type `dead_tree`): a field-grown oak or a vase elm, grown recursively.

Biology / real numbers used (sources: arboricultural rules of thumb, Leonardo's / the pipe-model rule):
- Trunk diameter at breast height ~ 4.5 cm per metre of height for an open-grown hardwood (9 m -> ~40 cm DBH),
  flared root collar ~1.6x, buttress lobes, 4-5 surface roots diving into the ground.
- Pipe model at every fork: r_parent^2.5 ~ sum r_child^2.5 (children 0.45-0.7 of the parent's local radius).
- 5 branch orders: trunk, scaffold limbs / co-dominant leaders, branches, branchlets, twigs (tips 2-3 mm).
  Laterals leave at 35-75 deg, successive laterals rotate ~137.5 deg round the parent (phyllotaxis).
- Gravitropism: trunk and scaffolds curve up, fine orders droop under their own weight (elm: pendulous twigs);
  a little phototropism pushes the crown outward. Tortuosity grows with the order (oaks zig-zag).
- Dead/storm-damaged wood: ~12 % of scaffold/branch limbs are snapped (jagged stubs, no further growth).
Bark: material `bark_wet`; UV0 u runs along each branch (metres, the bark furrows follow the wood), v round it
(metres; trunks snap their circumference to whole bark tiles so no seam shows). Not lightmapped (probe-lit,
props/lightmap.EXCLUDE_TYPES); one primitive per tree (1 draw call). The Low tier decimates it (build_props).
"""
import math

from mathutils import Vector, noise

from .kit import Part, prop

GOLD = math.radians(137.5)
BARK_TILE = 1.0                                 # material-spec bark_wet tileMetres
#        trunk scaffold branch branchlet twig  spur
SIDES = (18, 10, 7, 4, 3, 3)
SEG = (0.42, 0.36, 0.28, 0.2, 0.12, 0.07)
TIP_R = (0.0, 0.03, 0.012, 0.006, 0.0028, 0.0018)
MAX_ORDER = 5
DROP_ORDER = 4          # orders >= this are thinned uniformly to meet maxTris (distance trees: 3)

STYLES = {
    # broad, tortuous, wide-limbed field oak
    'oak': dict(fork=(0.28, 0.36), leaders=(2, 3), leader_ang=(26, 42), limbs=(3, 5), limb_ang=(50, 72),
                tort=(0.05, 0.14, 0.2, 0.26, 0.3, 0.3), grav=(0.0, 0.010, -0.002, -0.015, -0.02, -0.02),
                photo=(0, 0.05, 0.035, 0.015, 0, 0), kids=((0, 0), (10, 14), (8, 12), (0, 0), (1, 3), (0, 0)),
                kid_ang=(0, 0, 50, 52, 55, 50), len_f=(0, 0, 0.58, 0.5, 0, 0), spread=1.0),
    # vase-shaped elm: steep leaders, long arching branches, pendulous twigs
    'elm': dict(fork=(0.34, 0.44), leaders=(3, 4), leader_ang=(16, 30), limbs=(2, 3), limb_ang=(36, 52),
                tort=(0.03, 0.08, 0.13, 0.19, 0.26, 0.3), grav=(0.0, 0.018, -0.008, -0.03, -0.045, -0.04),
                photo=(0, 0.04, 0.03, 0.0, 0, 0), kids=((0, 0), (10, 14), (8, 12), (0, 0), (1, 3), (0, 0)),
                kid_ang=(0, 0, 40, 46, 50, 45), len_f=(0, 0, 0.6, 0.52, 0, 0), spread=0.92),
    # --- hedgerow / background forms (blender/house/treeline.py) ---
    # white ash: stout, upright; branch tips curve UP (gravitropism reversed in the fine orders), sparse coarse twigs
    'ash': dict(fork=(0.36, 0.5), leaders=(2, 3), leader_ang=(16, 30), limbs=(2, 4), limb_ang=(38, 56),
                tort=(0.03, 0.06, 0.09, 0.13, 0.17, 0.2), grav=(0.0, 0.014, 0.008, 0.01, 0.006, 0.0),
                photo=(0, 0.04, 0.03, 0.01, 0, 0), kids=((0, 0), (8, 11), (6, 9), (0, 0), (1, 2), (0, 0)),
                kid_ang=(0, 0, 44, 46, 38, 40), len_f=(0, 0, 0.55, 0.46, 0, 0), spread=0.85),
    # hedgerow-grown oak: crowded in a line, so a tall clean bole and a narrow, high crown (vs the open-grown 'oak')
    'hedge': dict(fork=(0.4, 0.52), leaders=(2, 3), leader_ang=(14, 28), limbs=(3, 5), limb_ang=(42, 62),
                  tort=(0.04, 0.11, 0.17, 0.24, 0.3, 0.3), grav=(0.0, 0.012, -0.004, -0.016, -0.02, -0.02),
                  photo=(0, 0.06, 0.04, 0.015, 0, 0), kids=((0, 0), (10, 14), (8, 12), (0, 0), (1, 3), (0, 0)),
                  kid_ang=(0, 0, 48, 52, 55, 50), len_f=(0, 0, 0.52, 0.48, 0, 0), spread=0.78),
    # storm-killed snag: the leader snapped off, a third of the limbs broken to jagged stubs, few fine twigs left
    'snag': dict(fork=(0.42, 0.62), leaders=(1, 2), leader_ang=(6, 20), limbs=(2, 4), limb_ang=(48, 76),
                 tort=(0.06, 0.16, 0.22, 0.28, 0.3, 0.3), grav=(0.0, 0.006, -0.006, -0.02, -0.02, -0.02),
                 photo=(0, 0.03, 0.02, 0.0, 0, 0), kids=((0, 0), (4, 7), (3, 6), (0, 0), (0, 1), (0, 0)),
                 kid_ang=(0, 0, 52, 55, 55, 50), len_f=(0, 0, 0.5, 0.45, 0, 0), spread=0.8,
                 broken=0.35, leader_broken=0.7),
    # hedgerow understory (hawthorn / sumac / box-elder suckers): 4-6 stems from the ground, 2-4 m, twiggy
    'shrub': dict(fork=(0.03, 0.08), leaders=(6, 9), leader_ang=(8, 40), limbs=(0, 0), limb_ang=(40, 60),
                  tort=(0.05, 0.12, 0.2, 0.26, 0.3, 0.3), grav=(0.0, 0.004, -0.01, -0.02, -0.02, -0.02),
                  photo=(0, 0.06, 0.03, 0.0, 0, 0), kids=((0, 0), (8, 12), (6, 9), (0, 0), (1, 2), (0, 0)),
                  kid_ang=(0, 0, 45, 50, 50, 45), len_f=(0, 0, 0.55, 0.5, 0, 0), spread=1.0),
}


class Tree:
    def __init__(self, part, rng, mat, st, max_tris):
        self.part = part
        self.rng = rng
        self.mat = mat
        self.st = st
        self.tris = 0
        self.max_tris = max_tris
        self.seed = Vector((rng.u(0, 100), rng.u(0, 100), rng.u(0, 100)))
        if mat not in part.mats:
            part.mats.append(mat)
        self.mi = part.mats.index(mat)
        self.skel = []
        self.emit_order = MAX_ORDER

    def emit(self):
        """Build the recorded skeleton; over budget, drop whole twig sub-trees uniformly (never lopsided, never a
        floating spur)."""
        D = DROP_ORDER
        cost = [2 * sd * (len(pts) - 1) + (sd if o < D else 0) for pts, _, sd, o, _, _ in self.skel]
        fixed = sum(c for c, b in zip(cost, self.skel) if b[3] < D)
        twig = sum(c for c, b in zip(cost, self.skel) if b[3] >= D)
        keep = 1.0 if fixed + twig <= self.max_tris else max(0.0, (self.max_tris - fixed) / max(twig, 1))
        dropped = set()
        for i, (pts, radii, sd, order, jag, parent) in enumerate(self.skel):
            if parent in dropped or (order == D and self.rng.random() > keep):
                dropped.add(i)
        # structure first, then the twigs: the twig faces are a contiguous tail (the Low tier drops them)
        for i, (pts, radii, sd, order, jag, parent) in enumerate(self.skel):
            if order < D and i not in dropped:
                self.tube(pts, radii, sd, jag=jag)
        self.twig_from = len(self.part.faces)
        for i, (pts, radii, sd, order, jag, parent) in enumerate(self.skel):
            if order >= D and i not in dropped:
                self.tube(pts, radii, sd, jag=jag, cap=False)
        return keep

    # ---------------------------------------------------------------------------------------- geometry
    def tube(self, pts, radii, sides, rfn=None, jag=0.0, cap=True):
        """Append a closed-start tube (start buried in the parent) with bark UVs to the part."""
        n = len(pts)
        tans = []
        for i in range(n):
            d = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
            tans.append(d.normalized() if d.length > 1e-9 else Vector((0, 0, 1)))
        ref = Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0))
        nrm = tans[0].cross(ref).normalized()
        circ = 2 * math.pi * radii[0]
        vlen = max(BARK_TILE, round(circ / BARK_TILE) * BARK_TILE) if circ > 0.5 * BARK_TILE else circ
        part = self.part
        base = len(part.verts)
        u = self.rng.u(0, 3.0)
        us = []
        for i in range(n):
            if i:
                q = tans[i - 1].rotation_difference(tans[i])
                nrm = q @ nrm
                nrm = (nrm - tans[i] * nrm.dot(tans[i])).normalized()
                u += (pts[i] - pts[i - 1]).length
            us.append(u)
            bn = tans[i].cross(nrm)
            for k in range(sides):
                a = 2 * math.pi * k / sides
                r = radii[i] * (rfn(i, a) if rfn else 1.0)
                off = nrm * (math.cos(a) * r) + bn * (math.sin(a) * r)
                p = pts[i] + off
                if jag and i == n - 1:
                    p = p + tans[i] * (self.rng.u(-1.0, 1.0) * jag)
                part.verts.append(p)
        v0 = self.rng.u(0, 3.0)
        for i in range(n - 1):
            for k in range(sides):
                k1 = (k + 1) % sides
                a, b = base + i * sides + k, base + i * sides + k1
                c, d = base + (i + 1) * sides + k1, base + (i + 1) * sides + k
                part.faces.append([a, b, c, d])
                part.face_mat.append(self.mi)
                part.face_smooth.append(True)
                va, vb = v0 + vlen * k / sides, v0 + vlen * (k + 1) / sides
                part.loop_uv.append([(us[i], va), (us[i], vb), (us[i + 1], vb), (us[i + 1], va)])
        if not cap:
            self.tris += 2 * sides * (n - 1)
            return
        # end cap (fan to a centre vertex, pushed slightly out: a rounded tip / the broken face)
        ci = len(part.verts)
        part.verts.append(pts[-1] + tans[-1] * radii[-1] * (0.4 if not jag else -0.3))
        last = base + (n - 1) * sides
        for k in range(sides):
            part.faces.append([last + k, last + (k + 1) % sides, ci])
            part.face_mat.append(self.mi)
            part.face_smooth.append(True)
            part.loop_uv.append([(us[-1], v0), (us[-1], v0 + 0.02), (us[-1] + 0.01, v0)])
        self.tris += 2 * sides * (n - 1) + sides

    # ---------------------------------------------------------------------------------------- growth
    def branch(self, p0, d0, length, r0, order, axis, parent=-1, leader=False, collar=None):
        st, rng = self.st, self.rng
        lb = st.get('leader_broken', 0.0)
        broken = (((order == 2 or (order == 1 and not leader)) and rng.chance(st.get('broken', 0.08)))
                  or (leader and lb > 0 and rng.chance(lb)))
        L = length * (rng.u(0.3, 0.65) if broken else 1.0)
        n = max(2, int(round(L / SEG[order])))
        ds = L / n
        # the branch collar: a child swells where it leaves its parent
        if collar is None:
            collar = 1.3 if order <= 2 else 1.1
        pts, radii, dirs = [p0.copy()], [r0 * collar], [d0.normalized()]
        d, pos = d0.normalized(), p0.copy()
        r_tip = min(TIP_R[order], r0 * 0.6)
        if broken:
            r_tip = r0 * rng.u(0.55, 0.8)
        freq = (0.6, 0.9, 1.4, 2.4, 4.0, 6.0)[order]
        for i in range(1, n + 1):
            nv = noise.noise_vector(pos * freq + self.seed + Vector((order * 7.1, 0, 0)))
            d = d + nv * st['tort'][order] + Vector((rng.j(1), rng.j(1), rng.j(1))) * st['tort'][order] * 0.35
            d.z += st['grav'][order] * (SEG[order] / 0.3)
            if pos.z < 1.6 and order >= 1:
                d.z += 0.12 * (1.6 - pos.z)              # nothing grows back into the ground
            out = Vector((pos.x - axis.x, pos.y - axis.y, 0.0))
            if out.length > 1e-6:
                d += out.normalized() * st['photo'][order]
            d.normalize()
            pos = pos + d * ds
            t = i / n
            pts.append(pos.copy())
            dirs.append(d.copy())
            radii.append(r0 + (r_tip - r0) * (t ** (0.8 if order < 3 else 1.0)))
        me = len(self.skel)
        if order <= self.emit_order:      # spurs (order 5) are grown (same random stream) but not emitted
            self.skel.append((pts, radii, SIDES[order], order, radii[-1] * 1.2 if broken else 0.0, parent))
        if order >= MAX_ORDER:
            return
        kmin, kmax = st['kids'][order]
        if order <= 2:
            k = rng.randint(kmin, kmax)
            k = max(2, int(round(k * min(1.3, max(0.45, L / 3.0)))))
        elif order == 3:
            k = max(2, int(round(L / 0.085)))          # twigs every ~8.5 cm along a branchlet
        else:
            k = rng.randint(kmin, kmax) if L > 0.18 else 0   # short spurs on the longer twigs
        if broken:
            k = max(0, k // 3)
        az = rng.u(0, 2 * math.pi)
        t0 = {1: 0.25, 2: 0.12, 3: 0.08, 4: 0.2}[order]
        for j in range(k):
            t = t0 + (0.97 - t0) * (j + rng.u(0.25, 0.75)) / max(k, 1)
            f = t * n
            i0 = min(int(f), n - 1)
            w = f - i0
            p = pts[i0].lerp(pts[i0 + 1], w)
            dp = dirs[i0].lerp(dirs[i0 + 1], w).normalized()
            rh = radii[i0] + (radii[i0 + 1] - radii[i0]) * w
            az += GOLD + rng.j(0.35)
            ref = Vector((0, 0, 1)) if abs(dp.z) < 0.95 else Vector((1, 0, 0))
            e1 = dp.cross(ref).normalized()
            e2 = dp.cross(e1)
            perp = e1 * math.cos(az) + e2 * math.sin(az)
            if order >= 2:
                # fine laterals prefer the sides/top of a branch, not straight down
                perp.z = max(perp.z, -0.3)
                perp.normalize()
            ang = math.radians(st['kid_ang'][order + 1] + rng.j(12))
            cd = dp * math.cos(ang) + perp * math.sin(ang)
            if order <= 2:
                clen = (L * (1 - t) * st['len_f'][order + 1] + L * 0.1) * rng.u(0.7, 1.15)
            elif order == 3:
                clen = rng.u(0.14, 0.42) * (1.15 - 0.5 * t)
            else:
                clen = rng.u(0.04, 0.12)
            cr = rh * rng.u(0.45, 0.68)
            if cr < TIP_R[order + 1] * 1.3:
                cr = TIP_R[order + 1] * 1.3
            self.branch(p + cd * rh * 0.3, cd, clen, cr, order + 1, axis, parent=me)


@prop('dead_tree', budget=90000)
def dead_tree(p, rng):
    """A bare deciduous tree in winter (oak or vase elm by seed): flared, buttressed trunk with surface roots,
    co-dominant leaders, 4 orders of tapering branches down to 2 mm twigs, a few snapped limbs."""
    H = float(p.get('height', 9.0))
    mat = p.get('mat', 'bark_wet')
    style = p.get('style') or ('oak' if rng.random() < 0.55 else 'elm')
    st = STYLES[style]
    part = Part('dead_tree', rng)
    part.sharp_angle = 180.0
    # 1.8 mm spurs (order 5) are sub-pixel beyond ~2 m (one pixel at 3 m is ~4 mm) and cost a fifth of a hero tree's
    # triangles: grown for the random stream, not emitted, and the cap lowered by that share (80k -> 64k) so the
    # twigs that DO read keep their density while the yard view stays inside the 1.5 M triangle budget.
    tree = Tree(part, rng, mat, st, max_tris=int(p.get('maxTris', 64000)))
    tree.emit_order = int(p.get('emitOrder', 4))
    r0 = float(p['r0']) if p.get('r0') else 0.10 + 0.0125 * H   # radius at breast height (11 m -> 0.24 m, DBH 48 cm)
    hf = H * rng.u(*st['fork'])
    lean = Vector((rng.j(0.06), rng.j(0.06), 1.0)).normalized()
    # trunk: root collar flare + buttress lobes + burls
    n = max(4, int(hf / SEG[0]) + 1)
    pts, radii = [], []
    lob = rng.u(0, 6.28)
    nl = rng.randint(4, 6)
    for i in range(n + 1):
        z = -0.35 + (hf + 0.35) * i / n
        bend = Vector((math.sin(z * 0.9 + lob) * 0.04, math.cos(z * 0.7 + lob) * 0.04, 0.0)) * min(1.0, z / 2.0 if z > 0 else 0)
        pts.append(lean * max(z, -0.35) / lean.z + bend if z > 0 else Vector((0, 0, z)))
        flare = 1.0 + 0.65 * max(0.0, 1.0 - max(z, 0.0) / 0.9) ** 2
        radii.append(r0 * flare * (1.0 - 0.18 * max(0.0, z) / hf))

    def trunk_r(i, a):
        z = -0.35 + (hf + 0.35) * i / n
        lo = max(0.0, 1.0 - max(z, 0.0) / 1.0)
        burl = 0.06 * noise.noise(Vector((math.cos(a) * 1.3, math.sin(a) * 1.3, z * 1.6)) + tree.seed)
        return 1.0 + lo * 0.45 * max(0.0, math.cos(nl * a + lob)) ** 2 + burl + 0.025 * math.cos(13 * a + z * 3)
    tree.tube(pts, radii, SIDES[0], rfn=trunk_r)
    axis = pts[-1].copy()
    top_r = radii[-1]
    # surface roots
    for k in range(nl):
        a = lob + 2 * math.pi * (k + rng.u(-0.15, 0.15)) / nl
        rp, rr = [], []
        for s in range(6):
            dist = r0 * 0.7 + s * rng.u(0.16, 0.24)
            rp.append(Vector((math.cos(a) * dist, math.sin(a) * dist, 0.12 - s * 0.05 - 0.012 * s * s)))
            rr.append(r0 * 0.36 * (1 - s / 6.2) ** 1.3)
            a += rng.j(0.1)
        tree.tube(rp, rr, 8)
    # co-dominant leaders from the fork + scaffold limbs lower on the trunk
    nlead = rng.randint(*st['leaders'])
    az = rng.u(0, 2 * math.pi)
    crown = H - hf
    for j in range(nlead):
        az += 2 * math.pi / nlead + rng.j(0.4)
        ang = math.radians(rng.u(*st['leader_ang']))
        d = Vector((math.cos(az) * math.sin(ang), math.sin(az) * math.sin(ang), math.cos(ang)))
        rl = top_r * (0.82 if nlead == 2 else 0.7) * rng.u(0.9, 1.05)
        tree.branch(axis - lean * 0.45, d, crown * rng.u(0.95, 1.15) * st['spread'], rl, 1, axis, leader=True,
                    collar=1.0)
    for j in range(rng.randint(*st['limbs'])):
        f = rng.u(0.68, 0.95)
        i0 = int(f * n)
        az += GOLD + rng.j(0.5)
        ang = math.radians(rng.u(*st['limb_ang']))
        d = Vector((math.cos(az) * math.sin(ang), math.sin(az) * math.sin(ang), math.cos(ang)))
        tree.branch(pts[i0], d, crown * rng.u(0.6, 0.85) * st['spread'], radii[i0] * rng.u(0.42, 0.55), 1, axis)
    keep = tree.emit()
    # fit the height: scale the crown so the tree is H tall (radii scale with it: still the pipe model)
    zmax = max(v.z for v in part.verts)
    s = H / zmax if zmax > 0 and p.get('fitHeight', True) else 1.0     # a snag keeps its broken height
    part.verts = [Vector((v.x * s, v.y * s, v.z * s if v.z > 0 else v.z)) for v in part.verts]
    part.extras = {'tree_style': style, 'tree_height': round(H, 2), 'twig_keep': round(keep, 2),
                   'lod_twig_from': tree.twig_from}
    return [part]
