"""Built-in / architectural props that the layout places as props: gallery balustrades, the floor register,
the parlour mantel, the front porch, the stone foundation skirt, the bricked-up back door, the under-stair closet
contents and the cistern hatch."""
import math

from mathutils import Vector

from .kit import (Part, T, bisect, box, cyl, extrude, fillet, jitter, lathe, nz, prop, rect_section, sphere, tube)


def baluster_profile(h, sq=0.036):
    r = sq / 2
    b = 0.09
    return [(0, 0), (r * 1.0, 0), (r * 1.0, b), (r * 0.7, b + 0.01), (r * 0.9, b + 0.03), (r * 0.55, b + 0.06),
            (r * 0.62, h * 0.35), (r * 0.9, h * 0.55), (r * 0.75, h * 0.64), (r * 0.45, h * 0.72), (r * 0.5, h - b - 0.05),
            (r * 0.8, h - b - 0.03), (r * 0.7, h - b - 0.01), (r * 1.0, h - b), (r * 1.0, h), (0, h)]


def handrail_section(w=0.068, h=0.058):
    """Mushroom/moulded handrail cross-section (x across, y up), bottom at y=0."""
    return [(-w * 0.3, 0.0), (w * 0.3, 0.0), (w * 0.32, h * 0.25), (w * 0.5, h * 0.45), (w * 0.5, h * 0.7),
            (w * 0.35, h * 0.92), (0.0, h), (-w * 0.35, h * 0.92), (-w * 0.5, h * 0.7), (-w * 0.5, h * 0.45),
            (-w * 0.32, h * 0.25)]


def newel(part, mat, x, y, H, sq=0.11):
    part.add(box(sq, sq, H - 0.08, 0.008, 2, base=True), mat, T((x, y, 0)))
    for z, s in ((0.1, 1.12), (H - 0.18, 1.1)):
        part.add(box(sq * s, sq * s, 0.03, 0.006, 2, base=True), mat, T((x, y, z)))
    part.add(lathe([(0, 0), (sq * 0.6, 0), (sq * 0.62, 0.02), (sq * 0.4, 0.04), (sq * 0.2, 0.05), (sq * 0.42, 0.09),
                    (sq * 0.38, 0.12), (0, 0.13)], n=12), mat, T((x, y, H - 0.08)))


@prop('balustrade_run', budget=9000)
def balustrade_run(p, rng):
    """Gallery balustrade along local x: moulded handrail, turned balusters (11 cm centres), shoe rail, newels."""
    L, H = float(p.get('length', 3.0)), float(p.get('height', 0.95))
    rail = p.get('mat', 'stair_treads')
    bmat = p.get('balusterMat', 'trim_chipped')
    part = Part('balustrade_run', rng)
    ends = bool(p.get('newelEnds', True))
    x0, x1 = -L / 2 + (0.055 if ends else 0), L / 2 - (0.055 if ends else 0)
    part.add(box(x1 - x0, 0.07, 0.045, 0.006, 2, base=True), bmat, T(((x0 + x1) / 2, 0, 0)))
    sec = handrail_section()
    part.add(tube([(x0, 0, H - 0.058), (x1, 0, H - 0.058)], 0.03, section=[(-y, x) for x, y in sec]), rail)
    part.add(box(x1 - x0, 0.05, 0.02, 0.004, 1, base=True), rail, T(((x0 + x1) / 2, 0, H - 0.078)))
    n = max(1, int((x1 - x0) / 0.11))
    bh = H - 0.078 - 0.045
    for k in range(n):
        x = x0 + (x1 - x0) * (k + 0.5) / n
        bm = lathe(baluster_profile(bh), n=8)
        part.add(bm, bmat, T((x, 0, 0.045), (rng.j(0.008), rng.j(0.008), 0)))
    if ends:
        for x in (-L / 2 + 0.055, L / 2 - 0.055):
            newel(part, rail, x, 0, H + 0.2)
    return [part]


@prop('floor_register', budget=4000)
def floor_register(p, rng):
    """Cast-iron floor register (60 cm): moulded border and a lattice grille; the floor hole under it is the house
    kit's (params.hole). Lies flush: top at z = +6 mm."""
    S = float(p.get('size', 0.6))
    mat = p.get('mat', 'cast_iron')
    part = Part('floor_register', rng)
    b = 0.045
    ring = [(-S / 2 + b / 2, -S / 2 + b / 2, 0), (S / 2 - b / 2, -S / 2 + b / 2, 0), (S / 2 - b / 2, S / 2 - b / 2, 0),
            (-S / 2 + b / 2, S / 2 - b / 2, 0)]
    sec = [(-b / 2, 0.0), (b / 2, 0.0), (b / 2, 0.003), (b * 0.2, 0.006), (-b * 0.3, 0.006), (-b / 2, 0.004)]
    part.add(tube(ring, 0.01, section=[(y, x) for x, y in sec], closed=True), mat)
    inner = S - 2 * b
    pitch = 0.032
    n = int(inner / pitch)
    for k in range(n + 1):
        c = -inner / 2 + inner * k / n
        part.add(box(0.007, inner, 0.02, 0.0015, 1), mat, T((c, 0, 0.006 - 0.01)))
        part.add(box(inner, 0.007, 0.02, 0.0015, 1), mat, T((0, c, 0.006 - 0.01)))
    for sx in (-1, 1):
        for sy in (-1, 1):
            part.add(lathe([(0, 0), (0.006, 0), (0.005, 0.002), (0, 0.003)], n=8), mat,
                     T((sx * (S / 2 - b / 2), sy * (S / 2 - b / 2), 0.005)))
    part.extras['floor_hole'] = str(p.get('hole', ''))
    return [part]


@prop('fireplace_mantel', budget=9000)
def fireplace_mantel(p, rng):
    """Parlour fireplace: pilastered wooden surround with frieze and moulded shelf, brick firebox with a cast-iron
    grate of dead ash, brick hearth. Front -y, back against the chimney breast at +y."""
    Wm = float(p.get('width', 1.5))
    zs = float(p.get('shelfZ', 1.2))
    mat = p.get('mat', 'wood_furniture_dark')
    brick = p.get('hearthMat', 'brick_old')
    part = Part('fireplace_mantel', rng)
    D = 0.3
    ow, oh = 0.76, 0.82
    pw = (Wm - ow) / 2
    # firebox (brick-lined) behind the opening
    part.add(box(ow + 0.1, 0.03, oh + 0.05, 0.004, 1, base=True), brick, T((0, D / 2 - 0.015, 0)))
    for sx in (-1, 1):
        part.add(box(0.05, D, oh, 0.004, 1, base=True), brick, T((sx * (ow / 2 + 0.02), 0, 0)))
    part.add(box(ow + 0.1, D, 0.05, 0.004, 1, base=True), brick, T((0, 0, oh)))
    grate = Part('fireplace_mantel.grate', rng)
    for k in range(6):
        grate.add(tube([(-0.25, -0.05 + 0.03 * k, 0.12), (0.25, -0.05 + 0.03 * k, 0.12)], 0.006, sides=6), 'cast_iron')
    for sx in (-1, 1):
        grate.add(tube(fillet([(sx * 0.25, -0.1, 0), (sx * 0.25, -0.1, 0.18), (sx * 0.25, 0.12, 0.2)], 0.03, 3), 0.01,
                       sides=6), 'cast_iron')
    ash = lathe([(0, 0), (0.2, 0), (0.12, 0.03), (0, 0.045)], n=12)
    jitter(ash, 0.02, freq=8.0, seed=rng.randint(0, 999))
    grate.add(ash, 'stone_foundation', T((0, 0.02, 0.0), scale=(1.3, 0.8, 1.0)))
    part.merge(grate)
    # pilasters with plinths and capitals
    for sx in (-1, 1):
        x = sx * (ow / 2 + pw / 2)
        part.add(box(pw, 0.05, zs - 0.26, 0.004, 2, base=True), mat, T((x, -D / 2 + 0.025, 0)))
        part.add(box(pw * 0.7, 0.02, zs - 0.5, 0.006, 2, base=True), mat, T((x, -D / 2 - 0.005, 0.17)))
        part.add(box(pw + 0.02, 0.07, 0.15, 0.006, 2, base=True), mat, T((x, -D / 2 + 0.03, 0)))
        part.add(box(pw + 0.03, 0.075, 0.05, 0.008, 2, base=True), mat, T((x, -D / 2 + 0.03, zs - 0.31)))
        part.add(box(0.05, D, zs - 0.26, 0.004, 1, base=True), mat, T((sx * (Wm / 2 - 0.025), 0, 0)))
    # frieze + shelf
    part.add(box(Wm, 0.05, 0.26, 0.004, 2, base=True), mat, T((0, -D / 2 + 0.025, zs - 0.26)))
    part.add(box(ow - 0.06, 0.02, 0.14, 0.006, 2, base=True), mat, T((0, -D / 2 - 0.005, zs - 0.21)))
    sec = [(0.0, 0.0), (0.02, 0.0), (0.03, 0.012), (0.045, 0.02), (0.05, 0.035), (0.05, 0.045), (0.0, 0.045)]
    path = [(-Wm / 2 - 0.05, D / 2, 0), (-Wm / 2 - 0.05, -D / 2 - 0.05, 0), (Wm / 2 + 0.05, -D / 2 - 0.05, 0),
            (Wm / 2 + 0.05, D / 2, 0)]
    part.add(tube(path, 0.02, section=[(y, -x) for x, y in sec]), mat, T((0, 0, zs - 0.045)))
    part.add(box(Wm + 0.1, D + 0.05, 0.03, 0.005, 2, base=True), mat, T((0, -0.025, zs - 0.03)))
    # hearth: brick slab
    hb = box(Wm + 0.2, 0.5, 0.05, 0.006, 2, cuts={0: 6, 1: 2}, base=True)
    jitter(hb, 0.002, freq=6.0, seed=rng.randint(0, 999), axes=(0, 0, 1))
    part.add(hb, brick, T((0, -D / 2 - 0.25, 0)))
    part.jitter(0.0008, freq=2.0, zmin=0.001)
    part.extras['cold'] = bool(p.get('cold', True))
    return [part]


def _lattice(part, mat, x0, x1, z0, z1, y, pitch=0.12, w=0.034, t=0.008):
    """Diagonal lattice strips clipped to the rectangle x0..x1, z0..z1 (two layers at +-45 deg)."""
    for layer, sgn in ((0, 1), (1, -1)):
        k = (x0 - z1) if sgn > 0 else (x0 + z0)
        kend = (x1 - z0) if sgn > 0 else (x1 + z1)
        while k < kend:
            if sgn > 0:
                za, zb = max(z0, x0 - k), min(z1, x1 - k)
                pa, pb = (k + za, za), (k + zb, zb)
            else:
                za, zb = max(z0, k - x1), min(z1, k - x0)
                pa, pb = (k - za, za), (k - zb, zb)
            if zb - za > 0.02:
                yy = y + layer * t
                part.add(tube([(pa[0], yy, pa[1]), (pb[0], yy, pb[1])], 0.01, section=rect_section(t, w)), mat)
            k += pitch


@prop('porch', budget=40000)
def porch(p, rng):
    """Front porch: joisted deck of wet tongue-and-groove boards running to the house, lattice skirt between brick
    piers, 3 stairs, 5 chamfered posts, square-baluster railing, a shallow shed roof with beadboard ceiling, a
    half-round gutter and downspout. House wall at +y; `stepsCentreX` is absolute plan x (uses placement pos)."""
    W, Dp = float(p.get('width', 9.0)), float(p.get('depth', 2.5))
    dz = float(p.get('deckZ', 0.58))
    trim = p.get('mat', 'trim_chipped')
    deck = p.get('deckMat', 'porch_boards_wet')
    pos = p.get('_pos', [0, 0, 0])
    part = Part('porch', rng)
    yf = -Dp / 2
    # deck boards (run along y, 9 cm + 5 mm gaps), a few cupped or proud
    bw, gap = 0.09, 0.005
    n = int(W / (bw + gap))
    for k in range(n):
        x = -W / 2 + (bw + gap) * (k + 0.5)
        bm = box(bw, Dp + 0.03, 0.022, 0.003, 1, cuts={1: 3}, base=True)
        up = rng.j(0.002) + (0.004 if rng.chance(0.05) else 0)
        for v in bm.verts:
            v.co.z += up * (0.5 + v.co.y / (Dp + 0.03)) + 0.0015 * (2 * v.co.x / bw) ** 2
        part.add(bm, deck, T((x, -0.015, dz - 0.022)), grain=1)
    # rim/fascia boards
    part.add(box(W + 0.05, 0.03, 0.22, 0.004, 2, cuts={0: 8}, base=True), trim, T((0, yf - 0.01, dz - 0.24)))
    for sx in (-1, 1):
        part.add(box(0.03, Dp, 0.22, 0.004, 2, base=True), trim, T((sx * (W / 2 + 0.01), 0, dz - 0.24)))
    # piers + lattice skirt
    sx_steps = float(p.get('stepsCentreX', pos[0])) - pos[0]
    sw = float(p.get('stepsWidth', 1.6))
    posts = int(p.get('posts', 5))
    pxs = [-W / 2 + 0.08 + (W - 0.16) * k / (posts - 1) for k in range(posts)]
    for x in pxs:
        part.add(box(0.3, 0.3, dz - 0.24, 0.01, 2, base=True), 'brick_old', T((x, yf + 0.12, 0)))
    for a, b in zip(pxs, pxs[1:]):
        lo, hi = a + 0.15, b - 0.15
        if lo < sx_steps + sw / 2 and hi > sx_steps - sw / 2:
            for seg in ((lo, sx_steps - sw / 2 - 0.05), (sx_steps + sw / 2 + 0.05, hi)):
                if seg[1] - seg[0] > 0.1:
                    _lattice(part, trim, seg[0], seg[1], 0.02, dz - 0.25, yf + 0.03)
        else:
            _lattice(part, trim, lo, hi, 0.02, dz - 0.25, yf + 0.03)
    # steps: 3 treads + 4 equal risers, stringers either side
    nst = int(p.get('steps', 3))
    rise = dz / (nst + 1)
    run = 0.28
    for k in range(nst):
        zt = rise * (k + 1)
        yk = yf - run * (nst - k) + run / 2
        part.add(box(sw, run + 0.03, 0.03, 0.005, 2, cuts={0: 3}, base=True), deck, T((sx_steps, yk - 0.015, zt - 0.03)))
        part.add(box(sw - 0.04, 0.022, rise - 0.03, 0.003, 1, base=True), trim, T((sx_steps, yk - run / 2 + 0.03, zt - rise)))
    for s in (-1, 1):
        a = (sx_steps + s * (sw / 2 + 0.02), yf - run * nst - 0.05, 0.0)
        b = (sx_steps + s * (sw / 2 + 0.02), yf, dz - 0.05)
        part.add(tube([a, b], 0.1, section=rect_section(0.04, 0.24, 0.004)), trim)
    # posts (chamfered, with base block + capital)
    Hr = float(p.get('roofZ', 3.9))
    ph = Hr - dz - 0.22
    for x in pxs:
        post = box(0.12, 0.12, ph, 0.018, 1, cuts={2: 2}, base=True)
        part.add(post, trim, T((x, yf + 0.08, dz)))
        part.add(box(0.16, 0.16, 0.14, 0.006, 2, base=True), trim, T((x, yf + 0.08, dz)))
        part.add(box(0.17, 0.17, 0.05, 0.008, 2, base=True), trim, T((x, yf + 0.08, dz + ph - 0.05)))
    # railings (skip the stair opening)
    rail_h = 0.9
    runs = []
    for a, b in zip(pxs, pxs[1:]):
        lo, hi = a + 0.06, b - 0.06
        if lo < sx_steps + sw / 2 and hi > sx_steps - sw / 2:
            if sx_steps - sw / 2 - lo > 0.2:
                runs.append(((lo, yf + 0.08), (sx_steps - sw / 2 - 0.02, yf + 0.08)))
            if hi - (sx_steps + sw / 2) > 0.2:
                runs.append(((sx_steps + sw / 2 + 0.02, yf + 0.08), (hi, yf + 0.08)))
        else:
            runs.append(((lo, yf + 0.08), (hi, yf + 0.08)))
    for sx in (-1, 1):
        runs.append(((pxs[0 if sx < 0 else -1], yf + 0.14), (pxs[0 if sx < 0 else -1], Dp / 2 - 0.05)))
    for (ax, ay), (bx, by) in runs:
        a3, b3 = Vector((ax, ay, 0)), Vector((bx, by, 0))
        Lr = (b3 - a3).length
        for z, w, h in ((dz + rail_h - 0.05, 0.07, 0.05), (dz + 0.07, 0.06, 0.045)):
            part.add(tube([a3 + Vector((0, 0, z)), b3 + Vector((0, 0, z))], 0.03, section=rect_section(w, h, 0.008)), trim)
        nb = max(1, int(Lr / 0.11))
        for k in range(nb):
            c = a3 + (b3 - a3) * ((k + 0.5) / nb)
            part.add(box(0.036, 0.036, rail_h - 0.14, 0.004, 1, base=True), trim,
                     T((c.x, c.y, dz + 0.095), (rng.j(0.01), rng.j(0.01), 0)))
    # roof: header beam, beadboard ceiling, sloped roof deck, fascia, gutter + downspout
    part.add(box(W + 0.1, 0.12, 0.22, 0.006, 2, cuts={0: 8}, base=True), trim, T((0, yf + 0.08, Hr - 0.22)))
    part.add(box(W + 0.1, Dp, 0.015, 0.002, 1, cuts={0: 6}, base=True), 'wainscot_beadboard', T((0, 0.0, Hr - 0.22)))
    over = 0.3
    rz0, rz1 = Hr + 0.05, Hr + 0.38
    ry0, ry1 = yf - over, Dp / 2
    ang = math.atan2(rz1 - rz0, ry1 - ry0)
    Lroof = math.hypot(rz1 - rz0, ry1 - ry0)
    roof = box(W + 0.3, Lroof, 0.08, 0.006, 2, cuts={0: 10, 1: 3})
    for v in roof.verts:
        v.co.z -= 0.03 * math.sin(math.pi * (v.co.x / (W + 0.3) + 0.5)) * 0.4 * (v.co.y / Lroof + 0.5)
    part.add(roof, 'shingles_wet', T((0, (ry0 + ry1) / 2, (rz0 + rz1) / 2 + 0.04), (ang, 0, 0)), grain=0)
    part.add(box(W + 0.32, 0.025, 0.16, 0.004, 2, cuts={0: 8}), trim, T((0, ry0 - 0.01, rz0 - 0.02)))
    gut = [(0.06 * math.cos(a), 0.06 * math.sin(a)) for a in [math.pi + math.pi * k / 8 for k in range(9)]]
    gut = gut + [(x * 0.92, y * 0.92) for x, y in reversed(gut)]
    part.add(tube([(-W / 2 - 0.15, ry0 - 0.08, rz0 - 0.02), (W / 2 + 0.15, ry0 - 0.08, rz0 - 0.04)], 0.06,
                  section=gut, miter=False), 'zinc_galvanized')
    dsx = W / 2 + 0.05
    spout = [(dsx, ry0 - 0.08, rz0 - 0.08), (dsx, ry0 - 0.08, rz0 - 0.25), (dsx + 0.08, yf + 0.15, rz0 - 0.5),
             (dsx + 0.08, yf + 0.15, 0.35), (dsx + 0.08, yf - 0.2, 0.05)]
    part.add(tube(fillet(spout, 0.1, 3), 0.04, section=rect_section(0.07, 0.05, 0.008)), 'zinc_galvanized')
    part.jitter(0.002, freq=0.8, zmin=0.001)
    col = Part('porch.collider', rng)
    col.add(box(W, Dp, dz, 0.0, 1, base=True), 'dust_sheet')
    for k in range(nst):
        col.add(box(sw, 0.28 * (nst - k), rise * (k + 1), 0.0, 1, base=True), 'dust_sheet',
                T((sx_steps, yf - 0.28 * (nst - k) / 2, 0)))
    col.extras = {'collider': True}
    part.children.append((col, None))
    return [part]


@prop('foundation_skirt', budget=9000)
def foundation_skirt(p, rng):
    """Rubble-stone foundation face along local x (front at -y, wall line at y = 0), roughly coursed, mortar
    set back 15 mm."""
    W, H = float(p.get('width', 9.0)), float(p.get('height', 0.6))
    mat = p.get('mat', 'stone_foundation')
    part = Part('foundation_skirt', rng)
    part.add(box(W, 0.2, H, 0.004, 1, base=True), mat, T((0, 0.1 - 0.015, 0)))
    z = 0.0
    while z < H - 0.04:
        ch = min(H - z, rng.u(0.14, 0.24))
        x = -W / 2
        while x < W / 2 - 0.02:
            sw = min(W / 2 - x, rng.u(0.22, 0.48))
            st = box(sw - 0.018, rng.u(0.07, 0.12), ch - 0.016, rng.u(0.01, 0.025), 1)
            jitter(st, 0.012, freq=9.0, seed=rng.randint(0, 9999))
            part.add(st, mat, T((x + sw / 2, -0.02, z + ch / 2), (rng.j(0.04), rng.j(0.04), rng.j(0.03))))
            x += sw
        z += ch
    part.add(box(W + 0.02, 0.2, 0.04, 0.008, 2, base=True), mat, T((0, 0.06, H - 0.02)))
    return [part]


@prop('bricked_doorway', budget=12000)
def bricked_doorway(p, rng):
    """The kitchen back door, bricked up in a hurry: uneven courses, mortar squeezed out of the joints, the old
    painted casing left in place. ORIGIN = base centre on the kitchen face of the wall (bricks extend +y)."""
    W, H = float(p.get('width', 0.9)), float(p.get('height', 2.1))
    mat = p.get('mat', 'brick_infill')
    frame = p.get('frameMat', 'door_painted')
    part = Part('bricked_doorway', rng)
    bl, bh, mj = 0.215, 0.065, 0.012
    z = 0.0
    course = 0
    while z < H - 0.02:
        x = -W / 2 + (0 if course % 2 == 0 else -bl / 2)
        drift = rng.j(0.004)
        while x < W / 2:
            x0, x1 = max(-W / 2, x), min(W / 2, x + bl)
            if x1 - x0 > 0.03:
                b = box(x1 - x0 - mj, 0.1, bh, 0.004, 1)
                jitter(b, 0.0015, freq=20.0, seed=rng.randint(0, 9999))
                part.add(b, mat, T(((x0 + x1) / 2, 0.05 + rng.j(0.006), z + bh / 2 + drift),
                                   (rng.j(0.01), rng.j(0.015), rng.j(0.012))))
            x += bl + mj
        sq = box(W, 0.02, mj * 1.4, 0.004, 1, cuts={0: 8})   # mortar squeezed out along the bed joint
        jitter(sq, 0.004, freq=25.0, seed=rng.randint(0, 9999))
        part.add(sq, 'plaster_damp', T((0, 0.004, z + bh + mj / 2 + drift)))
        z += bh + mj
        course += 1
    part.add(box(W, 0.09, H, 0.002, 1, base=True), 'plaster_damp', T((0, 0.06, 0)))
    for sx in (-1, 1):
        part.add(box(0.1, 0.022, H + 0.1, 0.004, 2, base=True), frame, T((sx * (W / 2 + 0.05), -0.011, 0)))
    part.add(box(W + 0.3, 0.025, 0.12, 0.005, 2, base=True), frame, T((0, -0.012, H + 0.05)))
    for z in (0.3, 1.8):   # the old hinges, painted over
        part.add(box(0.012, 0.03, 0.09, 0.003, 1), 'cast_iron', T((-W / 2 + 0.006, 0.0, z)))
    return [part]


def crate(part, rng, m, w=0.5, d=0.35, h=0.3, mat='wood_raw_plank'):
    """Nailed slatted produce crate."""
    for z in (0.02, h / 2, h - 0.03):
        for s in (-1, 1):
            part.add(box(w, 0.012, 0.06, 0.003, 1), mat, m @ T((0, s * (d / 2 - 0.006), z + 0.03)))
    for sx in (-1, 1):
        part.add(box(0.02, d, h, 0.003, 1, base=True), mat, m @ T((sx * (w / 2 - 0.01), 0, 0)))
    for k in range(4):
        part.add(box(w - 0.04, d / 4 - 0.01, 0.01, 0.002, 1, base=True), mat,
                 m @ T((0, -d / 2 + d / 8 + k * d / 4, 0.0)))


@prop('closet_interior', instance_keys=('contents',), budget=12000)
def closet_interior(p, rng):
    """Under-stair closet contents: two brooms and a mop leaning in the low corner, stacked produce crates, a row
    of coat hooks with a sack coat. ORIGIN = closet floor centre; hide happens here (collider child)."""
    mat = p.get('mat', 'wood_raw_plank')
    part = Part('closet_interior', rng)
    for k in range(2):
        x = 0.2 + 0.08 * k
        base = Vector((x, 0.35 - 0.07 * k, 0.0))
        top = base + Vector((rng.j(0.05), 0.3, 1.25))
        part.add(tube([base + Vector((0, 0, 0.3)), top], 0.013, sides=8), mat)
        straw = lathe([(0.0, 0.0), (0.12, 0.0), (0.13, 0.05), (0.06, 0.3), (0.03, 0.34), (0, 0.34)], n=10)
        jitter(straw, 0.01, freq=12.0, seed=rng.randint(0, 999))
        d = (top - base).normalized()
        from .kit import rot_to
        part.add(straw, 'burlap_sack', T(tuple(base)) @ rot_to(d) @ T((0, 0, 0), scale=(1.0, 0.35, 1.0)))
    crate(part, rng, T((-0.12, -0.2, 0.0), (0, 0, 0.1)))
    crate(part, rng, T((-0.1, -0.22, 0.3), (0, 0, -0.08)))
    part.add(box(0.7, 0.02, 0.1, 0.004, 2), mat, T((0.0, 0.62, 1.5)))
    for x in (-0.2, 0.0, 0.2):
        part.add(tube(fillet([(x, 0.61, 1.5), (x, 0.55, 1.47), (x, 0.54, 1.52)], 0.01, 3), 0.004, sides=6), 'cast_iron')
    col = Part('closet_interior.collider', rng)
    col.add(box(0.6, 0.45, 0.6, 0.0, 1, base=True), 'dust_sheet', T((-0.1, -0.2, 0.0)))
    col.extras = {'collider': True, 'hide_proxy': True}
    part.children.append((col, None))
    return [part]


@prop('cistern_hatch', budget=6000)
def cistern_hatch(p, rng):
    """Plank hatch over the kitchen cistern: curb frame, battened boards, strap hinges, hasp and padlock on the
    kitchen side, two boards splintered UPWARD from beneath. Water seep is a runtime decal (extras.seep)."""
    S = float(p.get('size', 0.9))
    mat = p.get('mat', 'wood_raw_plank')
    hw = p.get('hardwareMat', 'cast_iron')
    part = Part('cistern_hatch', rng)
    for s in (-1, 1):
        part.add(box(S + 0.1, 0.05, 0.03, 0.004, 2, base=True), mat, T((0, s * (S / 2 + 0.025), 0.0)))
        part.add(box(0.05, S, 0.03, 0.004, 2, base=True), mat, T((s * (S / 2 + 0.025), 0, 0.0)))
    nb = 6
    bw = S / nb
    broken = {2, 3} if str(p.get('splintered', 'upward')) == 'upward' else set()
    for k in range(nb):
        x = -S / 2 + bw * (k + 0.5)
        if k in broken:
            cut = rng.u(-0.1, 0.12)
            for side, (y0, y1) in ((-1, (-S / 2, cut)), (1, (cut, S / 2))):
                L = y1 - y0
                b = box(bw - 0.004, L, 0.028, 0.003, 1, cuts={1: 3}, base=True)
                pivot_y = y0 if side < 0 else y1
                ang = rng.u(0.25, 0.45)
                # the broken ends lift: each half pivots on its outer end resting on the curb
                part.add(b, mat, T((x, pivot_y, 0.006), (ang if side < 0 else -ang, 0, 0))
                         @ T((0, L / 2 if side < 0 else -L / 2, 0)))
                for q in range(5):   # splinters at the break
                    sl = box(rng.u(0.005, 0.014), rng.u(0.05, 0.12), 0.004, 0.001, 1)
                    tip_y = cut + rng.j(0.02)
                    part.add(sl, mat, T((x + rng.j(bw / 2.5), tip_y, 0.05 + rng.u(0, 0.04)),
                                        (rng.u(-0.9, -0.3) * side, rng.j(0.3), rng.j(0.3))))
        else:
            b = box(bw - 0.004, S, 0.028, 0.003, 1, cuts={1: 3}, base=True)
            jitter(b, 0.0015, freq=4.0, seed=rng.randint(0, 999))
            part.add(b, mat, T((x, 0, 0.006)))
    for y in (-S / 2 + 0.12, S / 2 - 0.12):   # strap hinges on the hinge side (+x), across the boards
        part.add(extrude([(0, -0.02), (0.36, -0.008), (0.38, 0), (0.36, 0.008), (0, 0.02)], 0.004, 0.001, 1), hw,
                 T((S / 2 + 0.03, y, 0.034), (0, 0, math.pi)))
        part.add(cyl(0.01, 0.06, n=8), hw, T((S / 2 + 0.03, y - 0.03, 0.04), (math.pi / 2, 0, 0)))
    # hasp + padlock on the -x edge (kitchen side, "outside")
    part.add(extrude([(0, -0.02), (0.14, -0.02), (0.14, 0.02), (0, 0.02)], 0.004, 0.001, 1), hw,
             T((-S / 2 - 0.02, 0, 0.034)))
    part.add(tube([(-S / 2 - 0.04, 0, 0.03), (-S / 2 - 0.04, 0, 0.07)], 0.006, sides=6), hw)
    lock = Part('cistern_hatch.padlock', rng)
    lock.add(box(0.05, 0.022, 0.045, 0.006, 2), 'brass_tarnished', T((0, 0, -0.03)))
    lock.add(tube([(-0.015, 0, -0.01), (-0.015, 0, 0.02), (0.015, 0, 0.02), (0.015, 0, -0.01)], 0.004, sides=6),
             'chrome_pitted')
    lock.extras = {'part': 'padlock', 'side': str(p.get('padlock', 'outside'))}
    part.children.append((lock, T((-S / 2 - 0.04, 0, 0.1), (0, 0, math.pi / 2))))
    part.extras.update({'seep': bool(p.get('seep', False)), 'splintered': str(p.get('splintered', ''))})
    return [part]
