"""Soft goods: runner and rag rugs, the rubber sheet, dust-sheet proxies, cobweb curtains.

Drapes are procedural (no cloth sim): a sheet grid is folded over a support heightfield, hangs vertically past its
edges, pools on the floor, and gets folds whose amplitude grows with hang depth. Thin sheets use '@2s' materials.
"""
import math

from mathutils import Vector

from .kit import (Part, T, box, cyl, jitter, lathe, nz, prop, rect_section, sphere, tube)


def drape(u, v, sheet_w, sheet_d, bw, bd, height, floor=0.0, off=(0.0, 0.0), seed=0, fold=1.0, edge_r=0.015,
          rot=0.0):
    """Point on a sheet (u, v in 0..1) laid over a support of footprint bw x bd whose top is height(x, y).
    rot: the sheet is thrown on skewed by this angle (radians), so hang lengths differ side to side."""
    px = (u - 0.5) * sheet_w + off[0]
    py = (v - 0.5) * sheet_d + off[1]
    sx = px * math.cos(rot) - py * math.sin(rot)
    sy = px * math.sin(rot) + py * math.cos(rot)
    ex = max(0.0, abs(sx) - bw / 2)
    ey = max(0.0, abs(sy) - bd / 2)
    cx = max(-bw / 2, min(bw / 2, sx))
    cy = max(-bd / 2, min(bd / 2, sy))
    top = height(cx, cy)
    n = nz((sx, sy, 0), seed, 3.0)
    if ex <= 0 and ey <= 0:
        return (sx, sy, top + 0.002 + abs(n.z) * 0.006)
    hang = math.hypot(ex, ey) if (ex > 0 and ey > 0) else ex + ey
    if ex > 0 and ey > 0:   # corner: fabric falls in a cone off the corner and bunches
        hang = max(ex, ey) + 0.35 * min(ex, ey)
        d = Vector((math.copysign(1, sx) * ex, math.copysign(1, sy) * ey, 0)).normalized()
        base = Vector((cx, cy, 0)) + d * (edge_r + 0.12 * min(ex, ey))
    else:
        d = Vector((math.copysign(1, sx) if ex > 0 else 0, math.copysign(1, sy) if ey > 0 else 0, 0))
        base = Vector((cx, cy, 0)) + d * edge_r
    if hang < edge_r * 1.57:   # roll over the edge
        a = hang / edge_r
        p = Vector((cx, cy, 0)) + d * (edge_r * math.sin(a))
        return (p.x, p.y, top - edge_r * (1 - math.cos(a)))
    drop = hang - edge_r * 1.57
    z = top - edge_r - drop
    along = sy if ex > 0 and ey <= 0 else sx
    amp = fold * min(0.05, 0.09 * drop) * (1 + 0.6 * n.x)
    wave = (math.sin(along * 17.0 + seed + 3 * n.y) + 0.5 * math.sin(along * 41.0 + 2 * seed)) * amp
    p = base + d * (0.004 + abs(wave) * 0.6 + 0.02 * drop * drop)
    side = Vector((-d.y, d.x, 0))
    p = p + side * wave * 0.3
    if z < floor + 0.003:   # pool on the floor
        extra = min(0.12, floor + 0.003 - z)
        p = p + d * extra * 0.5
        z = floor + 0.003 + abs(n.z) * 0.01
    return (p.x, p.y, z)


@prop('runner_rug', budget=6000)
def runner_rug(p, rng):
    """Wool runner along local x: bound edges, a ruck where feet catch it, a curled corner, knotted fringe ends."""
    L, W = float(p.get('length', 3.6)), float(p.get('width', 0.8))
    mat = p.get('mat', 'runner_rug')
    part = Part('runner_rug', rng)
    t = 0.007
    ruck_x = rng.u(-0.3, 0.3) * L
    ruck_h = rng.u(0.006, 0.014)
    curl = rng.choice((-1, 1))
    nx, ny = max(12, int(L / 0.12)), 8

    def top(u, v, lift=0.0):
        x, y = (u - 0.5) * L, (v - 0.5) * W
        z = t + ruck_h * math.exp(-((x - ruck_x) / 0.09) ** 2) * (0.6 + 0.4 * math.sin(v * 3.1))
        cu = max(0.0, (x * curl - L / 2 + 0.25) / 0.25) * max(0.0, (y - W / 2 + 0.2) / 0.2)
        z += 0.03 * cu * cu
        return (x, y, z + lift + nz((x, y, 0), 3, 2.0).z * 0.0015)
    part.add_grid(nx, ny, lambda u, v: top(u, v), mat, uv_size=(L, W))
    part.add_grid(nx, ny, lambda u, v: (lambda q: (q[0], q[1], max(0.0005, q[2] - t)))(top(u, v)), mat,
                  uv_size=(L, W), flip=True)
    for v0 in (0.0, 1.0):   # bound long edges
        part.add_grid(nx, 1, lambda u, v, v0=v0: (lambda q: (q[0], q[1], q[2] - t * v))(top(u, v0)), mat,
                      uv_size=(L, t), flip=(v0 == 0.0))
    for s in (-1, 1):
        for k in range(22):
            y = -W / 2 + W * (k + 0.5) / 22
            x0 = s * L / 2
            ln = 0.055 + rng.j(0.012)
            pts = [(x0, y, 0.004), (x0 + s * ln * 0.5, y + rng.j(0.006), 0.002),
                   (x0 + s * ln, y + rng.j(0.012), 0.0015)]
            part.add(tube(pts, 0.0022, sides=3), mat)
    return [part]


@prop('rag_rug', budget=9000)
def rag_rug(p, rng):
    """Oval braided rag rug: one flattened braid spiralling out from a centre line (u runs along the braid)."""
    w, d = float(p.get('w', 1.6)), float(p.get('d', 1.1))
    mat = p.get('mat', 'rag_rug')
    part = Part('rag_rug', rng)
    bw = 0.03
    straight = max(0.0, w - d)
    rmax = d / 2
    pts = []
    r = bw * 0.5
    step = 0.075
    while r < rmax:
        per = 2 * straight + math.tau * r
        n = max(8, int(per / step))
        for k in range(n):
            s = k / n * per
            rr = r + bw * k / n
            if s < straight:
                q = (-straight / 2 + s, -rr)
            elif s < straight + math.pi * r:
                a = -math.pi / 2 + (s - straight) / r
                q = (straight / 2 + rr * math.cos(a), rr * math.sin(a))
            elif s < 2 * straight + math.pi * r:
                q = (straight / 2 - (s - straight - math.pi * r), rr)
            else:
                a = math.pi / 2 + (s - 2 * straight - math.pi * r) / r
                q = (-straight / 2 + rr * math.cos(a), rr * math.sin(a))
            pts.append((q[0], q[1], 0.006 + nz((q[0], q[1], 0), 5, 3.0).z * 0.002))
        r += bw
    sec = [(0.0155 * math.cos(a), 0.0055 * math.sin(a)) for a in [math.tau * k / 5 for k in range(5)]]
    part.add(tube(pts, 0.015, section=sec, miter=False), mat)
    return [part]


@prop('rubber_sheet', budget=5000)
def rubber_sheet(p, rng):
    """Black rubber sheet thrown over the sawbuck table (2.2 x 0.6 x 0.8 m): stiff, broad folds, hanging edges.

    ORIGIN = the TABLE TOP centre (the layout places P_RUBBER_SHEET at table-top height, floor + 0.8 m): the sheet
    lies at z ~ 0 and hangs down the sides; the floor is at z = -tableHeight (hem pools there if it ever reaches)."""
    part = Part('rubber_sheet', rng)
    L, W, H = float(p.get('tableLength', 2.2)), float(p.get('tableWidth', 0.6)), float(p.get('tableHeight', 0.8))
    sw, sd = 2.0, 1.5
    off = (rng.j(0.08), rng.j(0.1))
    sd_seed = rng.randint(0, 99)
    rot = rng.j(0.12)
    top = lambda x, y: 0.003 + 0.0 * x   # noqa: E731  (clears the cupped planks)
    part.add_grid(48, 36, lambda u, v: drape(u, v, sw, sd, L - 0.02, W, top, -H, off, sd_seed, 1.4, 0.012, rot),
                  p.get('mat', 'rubber_black') + '@2s', uv_size=(sw, sd))
    part.extras['spatter'] = bool(p.get('spatter', False))
    return [part]


def _proxy_height(shape):
    """Support heightfield + footprint for the dust-sheet proxies."""
    if shape == 'chair':
        return 0.46, 0.5, (lambda x, y: 0.96 if y > 0.16 else (0.47 + 0.49 * max(0.0, (y - 0.08) / 0.08)
                                                              if y > 0.08 else 0.47))
    if shape == 'treadle_machine':
        return 0.95, 0.5, (lambda x, y: 0.78 + (0.22 * math.exp(-((x - 0.1) / 0.18) ** 2) if abs(y) < 0.12 else 0.0))
    return 0.9, 0.5, (lambda x, y: 0.55 + 0.04 * math.cos(y / 0.25 * 1.4))   # trunk: domed lid


@prop('dust_sheet_proxy', budget=5000)
def dust_sheet_proxy(p, rng):
    """Furniture under a dust sheet (chair / treadle sewing machine / trunk): the sheet shape is the prop."""
    shape = p.get('shape', 'trunk')
    bw, bd, h = _proxy_height(shape)
    part = Part('dust_sheet_proxy', rng)
    hs = max(h(0, 0), h(0, bd / 2 - 0.01))
    sw, sd = bw + 2 * hs * 0.92, bd + 2 * hs * 0.92
    off = (rng.j(0.1), rng.j(0.1))
    seed = rng.randint(0, 99)
    rot = rng.j(0.15)
    part.add_grid(40, 34, lambda u, v: drape(u, v, sw, sd, bw, bd, h, 0.0, off, seed, 1.3, 0.03, rot),
                  p.get('mat', 'dust_sheet') + '@2s', uv_size=(sw, sd))
    for sx in (-1, 1):   # a hint of legs/feet under the hem
        for sy in (-1, 1):
            part.add(cyl(0.02, 0.05, n=8), 'wood_furniture_dark', T((sx * (bw / 2 - 0.04), sy * (bd / 2 - 0.04), 0)))
    part.extras['shape'] = shape
    return [part]


@prop('cobweb_curtain', budget=4000)
def cobweb_curtain(p, rng):
    """Cobwebs across a 1 x 1.2 m opening: sagging silk strands + a few torn sheet patches (extras.decal='cobweb'
    for an alpha texture at runtime)."""
    dens = float(p.get('density', 0.6))
    part = Part('cobweb_curtain', rng)
    W, H = 1.0, 1.2
    anchors = [(rng.u(-W / 2, W / 2), 0, H) for _ in range(6)] + [(-W / 2, 0, rng.u(0.2, H)) for _ in range(4)] + \
              [(W / 2, 0, rng.u(0.2, H)) for _ in range(4)]
    for k in range(int(30 * dens)):
        a, b = rng.sample(anchors, 2)
        a, b = Vector(a), Vector(b)
        pts = []
        sagv = rng.u(0.03, 0.15)
        for i in range(7):
            t = i / 6
            q = a + (b - a) * t
            pts.append((q.x, q.y + rng.j(0.02), q.z - sagv * 4 * t * (1 - t)))
        part.add(tube(pts, 0.0005, sides=3), 'dust_sheet')
    patches = Part('cobweb_curtain.sheets', rng)
    for k in range(max(1, int(4 * dens))):
        cx, cz = rng.u(-0.35, 0.35), rng.u(0.5, 1.05)
        pw, ph = rng.u(0.2, 0.4), rng.u(0.15, 0.35)
        sg = rng.u(0.02, 0.06)
        patches.add_grid(4, 4, lambda u, v, cx=cx, cz=cz, pw=pw, ph=ph, sg=sg:
                         (cx + (u - 0.5) * pw, rng.j(0.0) + sg * math.sin(u * math.pi) * math.sin(v * math.pi),
                          cz + (v - 0.5) * ph - sg * math.sin(u * math.pi)), 'dust_sheet@2s')
    patches.extras = {'decal': 'cobweb', 'alpha': True}
    part.children.append((patches, None))
    return [part]


def _form_radius(z, a):
    """Dress-form torso cross-section (elliptical: wider across x), z from hip (0) to neck (0.62)."""
    prof = [(0.0, 0.16, 0.12), (0.12, 0.17, 0.125), (0.24, 0.125, 0.095), (0.3, 0.12, 0.09), (0.42, 0.155, 0.11),
            (0.5, 0.17, 0.1), (0.56, 0.16, 0.08), (0.6, 0.07, 0.055), (0.62, 0.05, 0.045)]
    for (z0, rx0, ry0), (z1, rx1, ry1) in zip(prof, prof[1:]):
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0)
            rx, ry = rx0 + (rx1 - rx0) * t, ry0 + (ry1 - ry0) * t
            break
    else:
        rx, ry = prof[-1][1], prof[-1][2]
    bust = 0.02 * max(0.0, math.cos(a + math.pi / 2)) * math.exp(-((z - 0.44) / 0.05) ** 2)
    return (rx + bust) * math.cos(a), (ry + bust * 1.5) * math.sin(a)


@prop('dress_dummy', instance_keys=('states',), budget=14000)
def dress_dummy(p, rng):
    """Dressmaker's form on a tripod stand wearing Ada's wedding dress; the dust sheet has slid off one shoulder.
    Two dress mesh states as children (`dress_intact`, `dress_cut_hem`); runtime shows the one matching `state`."""
    part = Part('dress_dummy', rng)
    satin = p.get('mat', 'wedding_satin')
    hip = 0.95
    part.add_grid(20, 12, lambda u, v: (*_form_radius(v * 0.62, u * math.tau), hip + v * 0.62), 'leather_worn',
                  closed_u=True)
    part.add(lathe([(0, 0), (0.05, 0), (0.05, 0.03), (0.02, 0.05), (0, 0.06)], n=12), 'wood_furniture_dark',
             T((0, 0, hip + 0.62)))
    part.add(cyl(0.014, hip - 0.18, n=10), 'wood_furniture_dark', T((0, 0, 0.18)))
    part.add(cyl(0.03, 0.08, n=12, bevel_w=0.01), 'wood_furniture_dark', T((0, 0, 0.16)))
    for k in range(3):
        a = k * math.tau / 3 + 0.3
        part.add(tube([(0, 0, 0.2), (0.3 * math.cos(a), 0.3 * math.sin(a), 0.02)], 0.014, sides=8), 'wood_furniture_dark')
        part.add(sphere(0.02, 8, 6), 'wood_furniture_dark', T((0.31 * math.cos(a), 0.31 * math.sin(a), 0.015)))
    seed = rng.randint(0, 999)
    for state in ('intact', 'cut_hem'):
        d = Part(f'dress_dummy.dress_{state}', rng)
        # bodice: a shell 6 mm off the form, long sleeves omitted (form has no arms): cap sleeves at the shoulders
        d.add_grid(20, 10, lambda u, v: (*[c * 1.05 for c in _form_radius(0.22 + v * 0.36, u * math.tau)],
                                         hip + 0.22 + v * 0.36), satin, closed_u=True)
        hem_z = 0.02 if state == 'intact' else 0.04

        def skirt(u, v, cut=(state == 'cut_hem')):
            a = u * math.tau
            z = hip + 0.24 - v * (hip + 0.24 - hem_z)
            flare = 0.17 + 0.42 * v ** 1.3
            train = 0.25 * max(0.0, math.cos(a - math.pi / 2)) * v ** 3
            fold = 1 + (0.06 + 0.05 * v) * math.sin(a * 11 + seed) * v + 0.03 * math.sin(a * 23 + 2 * seed) * v
            r = (flare + train) * fold
            zz = z
            if cut and v > 0.93:   # the cut: a ragged strip missing from the front hem
                if abs(((a - (-math.pi / 2)) + math.pi) % math.tau - math.pi) < 0.9:
                    zz = z + 0.06 + 0.02 * math.sin(a * 37)
            return (r * math.cos(a) * 1.05, r * math.sin(a), max(0.005, zz))
        d.add_grid(40, 18, skirt, satin + '@2s', closed_u=True, uv_size=(3.0, hip))
        d.extras = {'part': 'dress', 'state': state, 'visible_when': state}
        part.children.append((d, None))
    # dust sheet: slid off the left shoulder, hanging down the back
    sheet = p.get('sheetMat', 'dust_sheet') + '@2s'
    part.add_grid(18, 22, lambda u, v: (
        -0.05 + (u - 0.5) * 0.7 * (0.7 + 0.5 * v) + 0.1 * v,
        0.12 + 0.12 * v + 0.03 * math.sin(u * 17 + seed) * v,
        hip + 0.62 - v * (hip + 0.5) * (0.9 + 0.1 * math.sin(u * 5))), sheet, uv_size=(0.8, 1.6))
    part.extras['sheet_slid'] = bool(p.get('sheetSlidOffShoulder', True))
    return [part]
