"""Small hand-scale items: bucket, books, letter, cleaver, hammer, nail can, jerry can, shears, sewing basket, locket,
bus ticket, whetstone, rubber sheet, air freshener. Text/photos are runtime decals (child nodes, extras.decal)."""
import math

from mathutils import Vector

from .kit import (Part, T, anchor, bisect, box, cyl, decal, extrude, fillet, grime, jitter, lathe, plane, prop,
                  rect_section, sag, sphere, tube)


def _interp(prof, z):
    for (r0, z0), (r1, z1) in zip(prof, prof[1:]):
        if z0 <= z <= z1 and z1 > z0:
            return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
    return prof[-1][0]


@prop('zinc_bucket', budget=6000)
def zinc_bucket(p, rng):
    """Galvanised 10-quart pail: rolled rim, two swaged ribs, foot ring, riveted ears, wire bail with a wood grip."""
    mat = p.get('mat', 'zinc_galvanized')
    part = Part('zinc_bucket', rng)
    H, rb, rt = 0.265, 0.118, 0.148
    zb = 0.009
    wall = [(rb, zb), (rt, H)]
    rz = lambda z: rb + (rt - rb) * (z - zb) / (H - zb)
    body = [(0, zb), (rb, zb), (rz(0.08), 0.08), (rz(0.084) + 0.0025, 0.084), (rz(0.088), 0.088),
            (rz(0.175), 0.175), (rz(0.179) + 0.0025, 0.179), (rz(0.183), 0.183), (rt, H),
            (rt + 0.0035, H + 0.0015), (rt + 0.0052, H + 0.005), (rt + 0.0035, H + 0.0085), (rt - 0.0005, H + 0.0075),
            (rt - 0.0022, H + 0.003), (rt - 0.0016, H - 0.004), (rb - 0.0015, zb + 0.0012), (0, zb + 0.0012)]
    bm = lathe(body, n=36)
    ang = rng.u(0, math.tau)
    for v in bm.verts:   # a dent or two: pails are always knocked about
        a = math.atan2(v.co.y, v.co.x)
        d = math.exp(-((a - ang + math.pi) % math.tau - math.pi) ** 2 * 18) * math.exp(-((v.co.z - 0.13) / 0.05) ** 2)
        v.co.x -= math.cos(a) * d * 0.006
        v.co.y -= math.sin(a) * d * 0.006
    jitter(bm, 0.0008, freq=12.0, seed=rng.randint(0, 999))
    part.add(bm, mat)
    foot = [(rb - 0.006, 0.0), (rb + 0.0015, 0.0), (rb + 0.003, 0.004), (rb + 0.001, 0.013), (rb - 0.004, 0.012)]
    part.add(lathe(foot, n=36, closed=True), mat)
    ez = H - 0.035
    for s in (-1, 1):
        ear = box(0.006, 0.026, 0.034, 0.0015, 1)
        part.add(ear, mat, T((s * (rz(ez) + 0.003), 0, ez)))
        for dz in (-0.009, 0.009):
            part.add(sphere(0.0025, 8, 5), mat, T((s * (rz(ez) + 0.0062), 0, ez + dz)))
    # bail: lies tipped over to one side (~70 deg), the grip resting against the rim
    tilt = math.radians(68 + rng.j(6))
    R = rt + 0.012
    pts = []
    for i in range(17):
        a = math.pi * i / 16
        x, zz = R * math.cos(a), R * 0.95 * math.sin(a)
        pts.append((x, -zz * math.sin(tilt), ez + 0.004 + zz * math.cos(tilt)))
    ends = [(s * (rz(ez) + 0.009), 0, ez + 0.004) for s in (1, -1)]
    bail = [ends[0]] + pts + [ends[1]]
    part.add(tube(bail, 0.0024, sides=12), 'cast_iron')
    mid = Vector(pts[8])
    grip_dir = Vector(pts[10]) - Vector(pts[6])
    grip = cyl(0.011, 0.105, n=24, bevel_w=0.003)
    from .kit import rot_to
    m = T(tuple(mid)) @ rot_to(grip_dir) @ T((0, 0, -0.0525))
    part.add(grip, 'wood_furniture_dark', m)
    contents = p.get('contents')
    if contents:
        wz = 0.17
        water = Part('zinc_bucket.water', rng)
        water.add(lathe([(0, wz), (rz(wz) - 0.002, wz), (0, wz + 0.0001)], n=36), 'glass_grimy')
        water.extras = {'liquid': contents}
        part.children.append((water, None))
    return [part]


def _book_block(part, rng, w, h, thick, mat, m, curve=True):
    """Page block for an open book: profile rises from the gutter and falls to the fore-edge; extruded along y."""
    prof = [(0.002, 0.0), (w, 0.0), (w, thick * 0.55), (w - 0.01, thick * 0.8), (w * 0.5, thick),
            (0.03, thick * 0.95), (0.012, thick * 0.6), (0.002, thick * 0.25)]
    bm = extrude(prof, h)
    part.add(bm, mat, m @ T((0, h / 2, 0), (math.pi / 2, 0, 0)))
    return prof


def _page_surface(u, w, thick, curve):
    """Height of the page surface at fraction u from the gutter (matches _book_block)."""
    x = 0.002 + u * (w - 0.002)
    if x < 0.012:
        z = thick * 0.25 + (thick * 0.35) * (x - 0.002) / 0.01
    elif x < 0.03:
        z = thick * 0.6 + thick * 0.35 * (x - 0.012) / 0.018
    elif x < w * 0.5:
        z = thick * 0.95 + thick * 0.05 * (x - 0.03) / (w * 0.5 - 0.03)
    else:
        z = thick - thick * 0.2 * ((x - w * 0.5) / (w * 0.5 - 0.01)) ** 2
    return x, z


@prop('guest_book', instance_keys=('state', 'lines'), budget=4000)
def guest_book(p, rng):
    """Open register headed GUESTS (landscape ledger, 2 x 26 x 36 cm open), leather-bound; both pages are runtime
    handwriting canvases (child nodes, extras.decal='handwriting', page=left|right). A pencil lies in the gutter."""
    part = Part('guest_book', rng)
    cover = p.get('coverMat', 'leather_worn')
    paper = p.get('mat', 'paper_aged')
    w, h, th = 0.25, 0.36, 0.014
    for s in (-1, 1):
        cb = box(w + 0.008, h + 0.012, 0.004, 0.0015, 1, cuts={0: 6, 1: 4})
        for v in cb.verts:   # boards curl up 3 mm at the fore-edge (damp, decades open), corners a little more
            e = max(0.0, s * v.co.x / (w / 2 + 0.004))
            v.co.z += 0.003 * e * e * (1.0 + 0.4 * abs(v.co.y) / (h / 2))
        part.add(cb, cover, T((s * (w / 2 + 0.004), 0, 0.002)))
        _book_block(part, rng, w, h - 0.006, th, paper, T((0, 0, 0.004), (0, 0, 0 if s > 0 else math.pi)))
        page = Part(f'guest_book.page_{"right" if s > 0 else "left"}', rng)

        def f(u, v, s=s):
            uu = u if s > 0 else 1 - u
            x, z = _page_surface(uu, w, th, True)
            # top sheet lifts 1–4 mm at the outer corners (PROPS-FINISH §3.1b), a faint cockle across the page
            lift = 0.004 * max(0.0, (uu - 0.78) / 0.22) ** 2 * (0.35 + 0.65 * abs(2 * v - 1))
            cockle = 0.0003 * math.sin(uu * 17.0 + v * 5.0) * math.sin(v * 11.0)
            return (s * x, (v - 0.5) * (h - 0.01), 0.0045 + z + lift + cockle)
        page.add_grid(16, 12, f, paper)  # u is reversed AND x mirrored for s<0 -> winding already up (flip faced the left page down: culled)
        page.extras = {'decal': 'handwriting', 'page': 'right' if s > 0 else 'left', 'text_param': 'state',
                       'lines': int(p.get('lines', 11))}
        part.children.append((page, None))
    part.add(tube([(0.0, -0.12, 0.012), (0.004, 0.06, 0.012)], 0.0035, sides=6), 'wood_raw_plank')
    part.add(tube([(0.004, 0.06, 0.012), (0.0045, 0.075, 0.012)], 0.0035, sides=6, radii=[1.0, 0.2]), 'cast_iron')
    part.add(box(0.012, 0.13, 0.0006, 0.0002, 1), 'flannel_red', T((0.0, -0.225, 0.004)))
    for sx in (-1, 1):   # fingers turn the pages at the lower outer corners
        anchor(part, 'wear_handle', (sx * 0.22, -0.16, 0.015), {'r': 0.05})
    return [part]


@prop('ledger_book', instance_keys=('pages',), budget=2000)
def ledger_book(p, rng):
    """Closed account ledger: leather quarter-binding with corners, raised spine bands, page block, ribbon.
    The cover (child) hinges on the spine for the runtime read view."""
    part = Part('ledger_book', rng)
    cover = p.get('coverMat', 'leather_worn')
    paper = p.get('mat', 'paper_aged')
    w, h, t = 0.2, 0.3, 0.032
    part.add(box(w, h, 0.004, 0.0015, 1), cover, T((0, 0, 0.002)))
    # page block: fore-edge concave 3 mm (rounded-and-backed binding), 12 page-stack bands at ±0.2 mm on the
    # three open edges (PROPS-FINISH §3.2 #3)
    bw_, bh_, bt_ = w - 0.008, h - 0.01, t - 0.008
    blk = box(bw_, bh_, bt_, 0.0008, 1, cuts={2: 11, 1: 6})
    band = [rng.u(-0.0002, 0.0002) for _ in range(16)]
    for v in blk.verts:
        zr = (v.co.z + bt_ / 2) / bt_
        k = band[min(15, int(zr * 12))]
        if v.co.x > bw_ / 2 - 0.0012:
            v.co.x -= 0.003 * (1 - (2 * zr - 1) ** 2) - k
        if abs(v.co.y) > bh_ / 2 - 0.0012:
            v.co.y += k if v.co.y > 0 else -k
    part.add(blk, paper, T((0.002, 0, 0.004 + bt_ / 2)))
    part.add(box(0.014, h + 0.004, t + 0.004, 0.006, 3, cuts={1: 4}), cover, T((-w / 2 - 0.002, 0, t / 2)))
    for yb in (-0.09, -0.03, 0.03, 0.09):
        part.add(box(0.004, 0.006, t, 0.0015, 1), cover, T((-w / 2 - 0.009, yb, t / 2)))
    top = Part('ledger_book.cover', rng)
    top.add(box(w, h, 0.004, 0.0015, 1), cover, T((w / 2, 0, 0.002)))
    for sy in (-1, 1):   # leather corners
        top.add(extrude([(0, 0), (-0.035, 0), (0, -0.035)], 0.0012, 0.0004, 1), cover,
                T((w + 0.001, sy * (h / 2 + 0.001), 0.004), (0, 0, 0 if sy > 0 else math.pi / 2)))
    top.extras = {'part': 'cover', 'hinge_axis': [0, 1, 0], 'pages': int(p.get('pages', 3))}
    part.children.append((top, T((-w / 2, 0, t - 0.004))))
    part.add(box(0.01, 0.1, 0.0006, 0.0002, 1), 'flannel_red', T((0.03, -h / 2 - 0.045, 0.001), (0, 0, 0.2)))
    anchor(part, 'wear_handle', (w / 2, -h / 2, t / 2), {'r': 0.045})     # bottom fore-edge corner (page turning)
    anchor(part, 'wear_handle', (-w / 2, h / 2, t / 2), {'r': 0.04})      # spine top (pulled off the shelf)
    return [part]


@prop('letter', instance_keys=('unsent',), budget=800)
def letter(p, rng):
    """Unsent letter half out of its unsealed envelope; the sheet (folded in thirds, springing open) is a runtime
    handwriting canvas (child node)."""
    part = Part('letter', rng)
    paper = p.get('mat', 'paper_aged') + '@2s'
    ew, eh = 0.165, 0.095
    part.add(box(ew, eh, 0.0012, 0.0004, 1), paper.replace('@2s', ''), T((0, 0, 0.0006)))
    # diamond-cut back: side flaps under the bottom flap, each a 0.15 mm sheet with its overlap step
    pm = paper.replace('@2s', '')
    for sx in (-1, 1):
        tri = [(sx * (ew / 2 - 0.0004), -eh / 2 + 0.0004), (sx * (ew / 2 - 0.0004), eh / 2 - 0.0004),
               (sx * (ew / 2 - ew * 0.42), 0.004)]
        part.add(extrude(tri if sx < 0 else tri[::-1], 0.00015), pm, T((0, 0, 0.00122)))
    part.add(extrude([(-ew / 2 + 0.0004, -eh / 2 + 0.0004), (ew / 2 - 0.0004, -eh / 2 + 0.0004), (0, eh * 0.18)],
                     0.00015), pm, T((0, 0, 0.00138)))
    anchor(part, 'wear_handle', (ew / 2, -eh / 2, 0.001), {'r': 0.03})
    anchor(part, 'wear_handle', (-ew / 2, eh / 2, 0.001), {'r': 0.03})
    part.add_grid(4, 2, lambda u, v: ((u - 0.5) * ew * (1 - 0.6 * v), eh / 2 + v * 0.055, 0.0013 + 0.004 * v), paper)
    sheet = Part('letter.sheet', rng)
    sw, sh = 0.2, 0.26
    sheet.add_grid(6, 12, lambda u, v: ((u - 0.5) * sw, v * sh - 0.02,
                                        0.0025 + 0.012 * abs(math.sin(v * 3 * math.pi / 2)) * (0.3 + 0.7 * v)), paper)
    sheet.extras = {'decal': 'handwriting', 'page': 'letter', 'unsent': bool(p.get('unsent', True))}
    part.children.append((sheet, T((0.01, 0.0, 0.0), (0, 0, rng.j(0.15)))))
    return [part]


@prop('bus_ticket', instance_keys=('text',), budget=1000)
def bus_ticket(p, rng):
    """1976 card bus ticket, 70 x 35 mm, carried folded in a hem: a soft arch, one diagonal crease ridge (0.6 mm),
    a perforated tear-off stub edge (14 notches at 2.5 mm pitch, 0.6 mm deep) and a 6 mm dog-eared corner.
    16 x 28 grid (the notches need 2 verts each); budget 200 -> 1000 (PROPS-FINISH §3.2 #5)."""
    part = Part('bus_ticket', rng)
    W, H = 0.07, 0.035

    def f(u, v):
        x, y = (u - 0.5) * W, (v - 0.5) * H
        z = 0.001 + 0.004 * (2 * u - 1) ** 2
        d = abs((u - 0.15) * W - (v - 0.05) * H * 1.6) / 1.9          # distance to the diagonal crease (m)
        z += 0.0006 * max(0.0, 1 - d / 0.0025)
        if u >= 0.999:                                                 # torn stub perforation
            x -= 0.0006 * (round(v * 28) % 2)
        c = (u * W + v * H) - 0.006                                    # dog-ear at the (0, 0) corner, folded up
        if c < 0:
            z += -c * 0.8
        return (x, y, z)
    part.add_grid(16, 28, f, p.get('mat', 'paper_aged') + '@2s')
    part.extras.update({'print': 'ticket', 'text': str(p.get('text', '')), 'text_param': 'text'})
    anchor(part, 'wear_handle', (0.03, 0.0, 0.003), {'r': 0.02})
    return [part]


@prop('hog_cleaver', budget=3200)
def hog_cleaver(p, rng):
    """Heavy butcher's cleaver lying flat (PROPS-FINISH §3.2 #15): 200 x 100 mm blade, 4 mm spine tapering to 2 mm,
    then a 6 mm ground bevel down to a 0.5 mm edge; hanging hole Ø 8 mm; full tang (3 mm, exposed between the
    scales) with two 8.5 mm hardwood scales and 3 domed brass rivets Ø 6 mm. Blade material from params."""
    part = Part('hog_cleaver', rng)
    mat = p.get('mat', 'rust')
    outline = [(0.0, 0.0), (0.05, -0.001), (0.1, -0.002), (0.15, -0.003), (0.2, -0.004), (0.205, 0.02), (0.2, 0.098),
               (0.185, 0.102), (0.1, 0.101), (0.02, 0.1), (0.0, 0.085)]
    bm = extrude(outline, 0.004, 0.0006, 1)
    bisect(bm, 1, [0.002, 0.006, 0.012, 0.03, 0.06])
    bisect(bm, 0, [0.03, 0.07, 0.11, 0.15, 0.185])
    zc = 0.002
    for v in bm.verts:   # thickness profile measured from the (slightly rising) edge line
        ye = v.co.y + 0.004 * v.co.x / 0.2
        t = 0.002 + 0.002 * min(1.0, max(0.0, (ye - 0.006) / 0.094)) if ye >= 0.006 else 0.0005 + 0.0015 * max(0.0, ye) / 0.006
        v.co.z = zc + (v.co.z - zc) * t / 0.004
    jitter(bm, 0.0003, freq=30.0, seed=rng.randint(0, 999), axes=(0, 0, 1))
    part.add(bm, mat, T((-0.06, -0.05, 0.0)))
    part.add(lathe([(0.004, 0.0), (0.0065, 0.0), (0.0065, 0.0042), (0.004, 0.0042)], n=24, closed=True), mat,
             T((0.105, 0.035, -0.0001)))                                           # hole rim (rolled)
    part.add(cyl(0.004, 0.0002, n=24), 'crepe_black', T((0.105, 0.035, 0.0015)))   # the hole's shadowed depth
    hm = p.get('handleMat', 'wood_furniture_dark')
    L, Wd = 0.13, 0.032
    cx, cy = -0.06 - L / 2, 0.015
    taper = lambda b: [setattr(v.co, 'y', v.co.y * (1 + 0.15 * (v.co.x / (L / 2)))) for v in b.verts] and b
    part.add(taper(box(L, Wd - 0.001, 0.003, 0.0005, 1, cuts={0: 3})), mat, T((cx, cy, zc)))      # tang
    for sz in (1, -1):
        sc = box(L - 0.002, Wd, 0.0085, 0.003, 3, cuts={0: 3})
        part.add(taper(sc), hm, T((cx - 0.001, cy, zc + sz * (0.0015 + 0.00425))))
        for x in (-0.09, -0.125, -0.16):
            part.add(lathe([(0.003, 0.0), (0.0028, 0.0006), (0.0018, 0.0011), (0.0, 0.0013)], n=16), 'brass_tarnished',
                     T((x, cy, zc + sz * 0.01), (0 if sz > 0 else math.pi, 0, 0)))
    anchor(part, 'wear_handle', (cx - 0.012, cy, zc), {'r': 0.05})
    part.apply(T((0, 0, 0)), ground=True)
    return [part]


@prop('whetstone', budget=1400)
def whetstone(p, rng):
    """Combination bench stone 200 x 50 x 25 mm (PROPS-FINISH §3.2 #14): the face dished 1.5 mm at its centre by
    years of honing, two chipped corners, set 6 mm deep in a wooden box base (230 x 72 x 18 mm)."""
    part = Part('whetstone', rng)
    bm = box(0.2, 0.05, 0.025, 0.0015, 2, cuts={0: 7, 1: 2}, base=True)
    chips = [(rng.choice((-1, 1)) * 0.1, rng.choice((-1, 1)) * 0.025) for _ in range(2)]
    for v in bm.verts:
        if v.co.z > 0.02:   # dish: 1.5 mm at the centre, along the stroke (x) more than across (y)
            v.co.z -= 0.0015 * (1 - (v.co.x / 0.1) ** 2) * (1 - 0.4 * (v.co.y / 0.025) ** 2)
        for cxc, cyc in chips:
            d = math.hypot(v.co.x - cxc, v.co.y - cyc)
            if d < 0.007 and v.co.z > 0.012:
                k = 1 - d / 0.007
                v.co.z -= 0.003 * k
                v.co.x -= math.copysign(0.0015 * k, cxc)
                v.co.y -= math.copysign(0.0015 * k, cyc)
    jitter(bm, 0.0004, freq=25.0, seed=rng.randint(0, 999))
    part.add(bm, p.get('mat', 'stone_foundation'), T((0, 0, 0.012)))
    base = box(0.23, 0.072, 0.018, 0.0025, 2, base=True)
    jitter(base, 0.0004, freq=12.0, seed=rng.randint(0, 999))
    part.add(base, p.get('baseMat', 'wood_raw_plank'), grain=0)
    anchor(part, 'wear_protect', (0, 0, 0.0365), {'r': 0.06})    # the honing face stays clean of dust
    return [part]


@prop('claw_hammer', budget=2400)
def claw_hammer(p, rng):
    """16 oz curved-claw hammer lying on its side (PROPS-FINISH §3.2 #7). Real numbers: head 125 mm long, crowned face
    Ø 28 mm (0.5 mm crown, 1.5 mm chamfer), octagonal neck, eye block 36 x 25 mm, split claw with a 3 mm V-slot,
    hickory handle 330 mm, oval 32 x 24 mm at the grip, its end grain + steel wedge showing at the top of the eye.
    Budget 1500 -> 2400 tris (32-seg lathe face, 16-side handle; PROPS-FINISH §3.1a)."""
    part = Part('claw_hammer', rng)
    hm = p.get('mat', 'cast_iron')
    wm = p.get('handleMat', 'wood_furniture_dark')
    zc = 0.0125                                   # head centre line height when lying on its side
    face = [(0.0100, 0.006), (0.0100, 0.012), (0.0104, 0.018), (0.0122, 0.026), (0.0140, 0.032), (0.0145, 0.037),
            (0.0141, 0.0412), (0.0127, 0.0426), (0.0, 0.0431)]
    part.add(lathe(face, n=32, cap_top=False), hm, T((0.0, -0.004, zc), (0, math.pi / 2, 0)))
    part.add(lathe([(0.0113, 0.004), (0.0113, 0.020)], n=8), hm, T((0.0, -0.004, zc), (0, math.pi / 2, math.pi / 8)))
    part.add(box(0.03, 0.036, 0.025, 0.0018, 2), hm, T((-0.004, -0.004, zc)))
    claw = [(-0.012, -0.004, 0.0), (-0.036, -0.003, 0.0), (-0.058, 0.004, 0.0), (-0.073, 0.014, 0.0),
            (-0.082, 0.026, 0.0)]
    for dz in (-0.0045, 0.0045):                  # two tines 6 mm thick -> a 3 mm nail slot between them
        part.add(tube([(x, y, zc + z + dz) for x, y, z in claw], 0.006, section=rect_section(0.013, 0.006, 0.0018, 3),
                      radii=[1.15, 1.05, 0.95, 0.75, 0.45]), hm)
    # hickory handle: thin throat at the head, swelling grip, rounded butt (16 sides)
    sec = [(0.0118 * math.cos(a), 0.0158 * math.sin(a)) for a in [math.tau * k / 16 for k in range(16)]]
    hdl = [(-0.004, -0.0225, zc), (-0.004, 0.02, zc), (-0.005, 0.12, zc), (-0.0035, 0.25, zc), (-0.002, 0.302, zc),
           (-0.0015, 0.309, zc)]
    part.add(tube(hdl, 0.013, section=sec, radii=[0.78, 0.78, 0.74, 1.0, 1.0, 0.82]), wm)
    # end grain + steel cross wedge proud of the eye top by 0.5 mm
    part.add(box(0.0015, 0.0012, 0.019, 0.0003, 1), hm, T((-0.004, -0.0228, zc)))
    part.add(box(0.017, 0.0012, 0.0016, 0.0003, 1), wm, T((-0.004, -0.0226, zc), (0, 0, 0)))
    anchor(part, 'wear_handle', (-0.003, 0.26, zc), {'r': 0.055})     # grip at 70–85 % of the handle
    anchor(part, 'wear_handle', (0.043, -0.004, zc), {'r': 0.012})    # striking face (polished by use)
    part.apply(T((0, 0, 0)), ground=True)
    return [part]


def _cut_nail(part, m, mat='cast_iron'):
    part.add(tube([(0, 0, 0), (0, 0, 0.05)], 0.002, section=[(-0.0025, -0.0015), (0.0025, -0.0015), (0.0025, 0.0015),
                                                             (-0.0025, 0.0015)], radii=[0.35, 1.0]), mat, m)
    part.add(box(0.007, 0.005, 0.0025, 0.0005, 1), mat, m @ T((0, 0, 0.051)))


@prop('nail_can', budget=4000)
def nail_can(p, rng):
    """Galvanised can of square cut nails, a few spilled beside it."""
    part = Part('nail_can', rng)
    mat = p.get('mat', 'zinc_galvanized')
    prof = [(0, 0.0), (0.05, 0.0), (0.052, 0.003), (0.052, 0.115), (0.054, 0.12), (0.05, 0.12), (0.0495, 0.004),
            (0, 0.004)]
    part.add(lathe(prof, n=24), mat)
    part.add(lathe([(0, 0.085), (0.049, 0.085), (0, 0.09)], n=16), 'rust')
    for k in range(18):
        a, r = rng.u(0, math.tau), rng.u(0, 0.04)
        _cut_nail(part, T((r * math.cos(a), r * math.sin(a), 0.07), (rng.u(0.6, 1.4), 0, rng.u(0, 6.28))), 'rust')
    for k in range(5):
        _cut_nail(part, T((rng.u(0.07, 0.14), rng.j(0.08), 0.0025), (math.pi / 2, 0, rng.u(0, 6.28))), 'rust')
    return [part]


@prop('jerry_can', instance_keys=('plate', 'chalk', 'full'), budget=3800)   # +support loops (HERO)
def jerry_can(p, rng):
    """20 L jerry can: pressed X panels, perimeter weld bead, triple handle, cam-lever spout. A chalk plate number
    is a runtime decal on the flank (extras.text from the placement's `plate`)."""
    part = Part('jerry_can', rng)
    mat = p.get('mat', 'rust')
    W, D, H = 0.345, 0.165, 0.47
    body = box(W, D, H - 0.02, 0.014, 3, cuts={0: 2, 2: 2}, base=True)
    jitter(body, 0.0015, freq=6.0, seed=rng.randint(0, 999))
    part.add(body, mat, T((0, 0, 0.0)))
    part.add(tube([(-W / 2, 0, 0.0), (W / 2, 0, 0.0), (W / 2, 0, H - 0.02), (-W / 2, 0, H - 0.02)], 0.004, sides=8,
                  closed=True), mat, T((0, 0, 0.0)))
    for sy in (-1, 1):
        y = sy * (D / 2 + 0.002)
        for (x0, z0), (x1, z1) in (((-W / 2 + 0.04, 0.04), (W / 2 - 0.04, H - 0.08)),
                                   ((-W / 2 + 0.04, H - 0.08), (W / 2 - 0.04, 0.04))):
            part.add(tube([(x0, y, z0), (x1, y, z1)], 0.004, section=rect_section(0.02, 0.005, 0.002)), mat)
        frame = rect_section(W - 0.05, H - 0.1, 0.02, 2)
        part.add(tube([(x, y, (H - 0.02) / 2 + z) for x, z in frame], 0.003, sides=4, closed=True), mat)
    for x in (-0.07, 0.0, 0.07):
        hd = [(x, -0.035, H - 0.02), (x, -0.035, H + 0.03), (x, 0.035, H + 0.03), (x, 0.035, H - 0.02)]
        part.add(tube(fillet(hd, 0.012, 3), 0.007, section=rect_section(0.014, 0.008, 0.003)), mat)
    sp = T((W / 2 - 0.06, 0, H - 0.02), (0, math.radians(-30), 0))
    part.add(cyl(0.022, 0.035, n=24, bevel_w=0.003), mat, sp)
    part.add(tube([(0.0, -0.028, 0.03), (-0.04, -0.028, 0.06), (-0.08, -0.028, 0.05)], 0.006,
                  section=rect_section(0.012, 0.004, 0.001)), mat, sp)
    anchor(part, 'wear_handle', (0.0, 0.0, H + 0.03), {'r': 0.06})      # centre handle (carried)
    # Stand the can narrow end to the front (-y): the layout rows cans at a 205 mm pitch (P_JERRY_01..12), which
    # only fits their 165 mm depth — broad side to the row they interpenetrated into one red slab (audit row 8).
    part.apply(T((0, 0, 0), (0, 0, math.pi / 2)))
    decal(part, 'jerry_can.chalk', 0.13, 0.07, T((0, -W / 2 - 0.004, H * 0.6)), str(p.get('plate', '')),
          mat='paper_aged', style='chalk', extra={'text_param': 'plate'})
    # Round E: the rust/fuel ring the can has left on the boards (atlas cell 8), peeking 1–2 cm out from under it
    grime(part, [(8, rng.randint(0, 99), (rng.j(0.012), rng.j(0.015), 0.0004), (-math.pi / 2, 0, 0), 0.185, 0.36)])
    part.extras['full'] = bool(p.get('full', True))
    return [part]


def shears_parts(part, rng, m, mat='cast_iron', bow_mat=None):
    """8-inch dressmaker's shears lying flat (blade 130 mm, overall ~230 mm): two curved blades ground to a fine
    edge (6 mm bevel), a domed pivot screw Ø 8 mm with a 1.2 mm slot, offset bows (large 60 x 28, small 44 x 24 mm
    outside). PROPS-FINISH §3.2 #6. Round E: bows + shanks in `bow_mat` (black japanned iron), blades/pivot in `mat`."""
    bow_mat = bow_mat or mat
    for s, dz in ((1, 0.0), (-1, 0.0032)):
        spine = [(0.0, 0.0095), (0.04, 0.0092), (0.08, 0.0075), (0.115, 0.0048), (0.135, 0.0018), (0.141, 0.0)]
        edge = [(0.135, -0.0015), (0.1, -0.0022), (0.06, -0.003), (0.02, -0.0038), (0.0, -0.004)]
        blade = [(x, y * s) for x, y in edge[::-1] + spine[::-1]]
        bl = extrude(blade if s > 0 else blade[::-1], 0.003, 0.0004, 1)
        bisect(bl, 0, [0.02, 0.05, 0.08, 0.11])
        bisect(bl, 1, [s * 0.0005, s * 0.003])
        for v in bl.verts:   # ground bevel: the 6 mm next to the cutting edge thins to 0.4 mm at the edge
            k = max(0.0, 1 - (v.co.y * s + 0.004) / 0.006)
            if v.co.z > 0.0015:
                v.co.z = 0.0015 + (v.co.z - 0.0015) * (1 - 0.85 * k)
        part.add(bl, mat, m @ T((0, 0, dz)))
        bow_c = (-0.07, 0.022 * s if s > 0 else -0.018)
        rx, ry = (0.03, 0.014) if s > 0 else (0.022, 0.012)
        loop = [(bow_c[0] + rx * math.cos(a), bow_c[1] + ry * math.sin(a), dz + 0.0015) for a in
                [math.tau * k / 24 for k in range(24)]]
        part.add(tube(loop, 0.004, section=rect_section(0.008, 0.004, 0.0015, 3), closed=True), bow_mat, m)
        part.add(tube([(0.0, 0.002 * s, dz + 0.0015), (-0.02, 0.004 * s, dz + 0.0015),
                       (bow_c[0] + rx * 0.8, bow_c[1] - s * ry * 0.3, dz + 0.0015)],
                      0.004, section=rect_section(0.007, 0.004, 0.0015, 3)), bow_mat, m)
    part.add(cyl(0.004, 0.0072, n=24), mat, m @ T((0, 0.002, -0.0005)))
    dome = [(0.0045, 0.0), (0.0042, 0.0006), (0.0032, 0.0011), (0.0, 0.0013)]
    for side in (0, 1):      # domed screw head split by a 1.2 mm slot (two half-domes)
        part.add(lathe(dome, n=12, a0=-math.pi / 2, a1=math.pi / 2), mat,
                 m @ T((0.0006 if side == 0 else -0.0006, 0.002, 0.0067), (0, 0, 0 if side == 0 else math.pi)))
    part.add(cyl(0.0042, 0.0004, n=24), mat, m @ T((0, 0.002, 0.0064)))     # slot floor (0.9 mm deep)


@prop('sewing_shears', budget=3000)
def sewing_shears(p, rng):
    part = Part('sewing_shears', rng)
    shears_parts(part, rng, T((0.03, 0, 0)), p.get('mat', 'cast_iron'), p.get('bowMat'))
    anchor(part, 'wear_handle', (-0.04, 0.022, 0.002), {'r': 0.03})    # large bow (fingers)
    anchor(part, 'wear_handle', (-0.04, -0.018, 0.005), {'r': 0.025})  # small bow (thumb)
    anchor(part, 'wear_handle', (0.03, 0.002, 0.006), {'r': 0.008})    # pivot
    return [part]


@prop('sewing_basket', budget=4000)
def sewing_basket(p, rng):
    """Oval Shaker-style sewing box (38 x 27 x 24 cm) with swallowtail laps, fitted lid; things on top rest on it."""
    part = Part('sewing_basket', rng)
    mat = p.get('mat', 'wood_raw_plank')
    a, b, H = 0.19, 0.135, 0.215
    ov = T((0, 0, 0), scale=(1.0, b / a, 1.0))
    part.add(lathe([(0, 0.0), (a - 0.003, 0.0), (a, 0.004), (a, H - 0.02), (a - 0.003, H - 0.02), (a - 0.003, 0.006),
                    (0, 0.006)], n=40), mat, ov)
    part.add(lathe([(a - 0.004, H - 0.03), (a + 0.004, H - 0.03), (a + 0.004, H + 0.022), (a + 0.001, H + 0.025),
                    (0, H + 0.025), (0, H + 0.018), (a - 0.004, H + 0.018)], n=40), mat, ov)
    # swallowtail fingers at the band lap (Shaker #6 oval: 4 on the band, 1 on the lid rim), each held by a copper
    # tack (Ø 3 mm dome) at its tip (PROPS-FINISH §3.2 #13)
    fing = [(0.035 + k * 0.045, 0.06) for k in range(4)] + [(H - 0.022, 0.035)]
    ang = 0.42
    nrm = Vector((math.cos(ang) / a, math.sin(ang) / b, 0)).normalized()
    for k, (zf, lf) in enumerate(fing):
        x0, y0 = a * math.cos(ang) + nrm.x * 0.0005, b * math.sin(ang) + nrm.y * 0.0005
        yaw = math.atan2(nrm.y, nrm.x) - math.pi / 2
        hw = 0.011 if k < 4 else 0.008
        part.add(extrude([(0, -hw * 0.6), (lf * 0.8, -hw), (lf, 0), (lf * 0.8, hw), (0, hw * 0.6)], 0.0015, 0.0003, 1),
                 mat, T((x0, y0, zf), (math.pi / 2, 0, yaw)))
        tip = Vector((math.cos(yaw), math.sin(yaw), 0)) * (lf * 0.82)
        part.add(lathe([(0.0016, 0.0), (0.0013, 0.0007), (0.0, 0.0011)], n=8), 'brass_tarnished',
                 T((x0 + tip.x + nrm.x * 0.0015, y0 + tip.y + nrm.y * 0.0015, zf),
                   (0, math.pi / 2, math.atan2(nrm.y, nrm.x))))
    anchor(part, 'wear_handle', (a * 0.6, 0, H + 0.01), {'r': 0.05})    # lid lifted from the front
    part.add_grid(6, 3, lambda u, v: ((u - 0.5) * 0.09 + 0.05, -b + 0.012 - v * 0.012, H + 0.018 - v * 0.07), 'flannel_red@2s')
    return [part]


@prop('locket', instance_keys=('engraving',), budget=5200)
def locket(p, rng):
    """Oval hinged brass locket (Victorian, 30 x 24 x 8 mm) with bail and a fine chain pooled beside it; engraving +
    water-bloomed photo are runtime decals. open=true splays the lid on its hinge (child `lid`).
    PROPS-FINISH §3.2 #2: domed shells (32 seg) with a 0.3 mm parting line, raised bead border, 3-knuckle hinge
    Ø 1.6 mm, bail ring Ø 6 mm, chain of real links (oval 3 x 2 mm, wire Ø 0.5 mm, alternating 90°).
    Budget 2500 -> 5200 tris (the links); never decimated on Low (a collapsed chain turns into spikes)."""
    part = Part('locket', rng)
    mat = p.get('mat', 'brass_tarnished')
    ov = T((0, 0, 0), scale=(1.0, 0.8, 1.0))
    part.add(lathe([(0, 0.0), (0.0105, 0.0002), (0.0138, 0.0009), (0.0150, 0.0022), (0.0150, 0.0035),
                    (0.0146, 0.0036), (0, 0.0036)], n=32), mat, ov)
    lid = Part('locket.lid', rng)
    lid.add(lathe([(0, 0.0), (0.0146, 0.0), (0.0150, 0.0003), (0.0149, 0.0014), (0.0136, 0.0026), (0.0129, 0.0031),
                   (0.0126, 0.0034), (0.0121, 0.0033), (0.0090, 0.0040), (0, 0.0044)], n=32), mat,
            T((0, 0.012, 0.0003), scale=(1.0, 0.8, 1.0)))
    lid.extras = {'part': 'lid', 'hinge_axis': [1, 0, 0], 'open': bool(p.get('open', False))}
    part.children.append((lid, T((0, -0.012, 0.0035), (math.radians(-110) if p.get('open') else 0, 0, 0))))
    for k, x in enumerate((-0.0032, 0.0, 0.0032)):          # hinge knuckles: outer two on the body, middle on the lid
        part.add(cyl(0.0008, 0.0029, n=12), mat, T((x - 0.00145, -0.0122, 0.0036), (0, math.pi / 2, 0)))
    part.add(cyl(0.0013, 0.0025, n=12), mat, T((0, 0.0125, 0.0018), (-math.pi / 2, 0, 0)))   # bail boss
    part.add(tube([(0.003 * math.cos(a), 0.0172 + 0.003 * math.sin(a), 0.0018) for a in
                   [math.tau * k / 12 for k in range(12)]], 0.0005, sides=6, closed=True), mat)
    # chain: a pooled spiral, links every 2.3 mm along it, each a closed oval of 0.25 mm-radius wire
    path = []
    for k in range(240):
        t = k / 239
        r = 0.016 + 0.011 * t
        a = t * math.tau * 1.55 + rng.j(0.02)
        path.append(Vector((0.03 * t + r * math.cos(a) - 0.016, 0.022 + r * math.sin(a) * 0.8, 0.0)))
    links, acc, last = [], 0.0, path[0]
    for q in path[1:]:
        acc += (q - last).length
        last = q
        if acc >= 0.0023:
            links.append(q)
            acc = 0.0
    ring = [(0.0013 * math.cos(a), 0.0008 * math.sin(a)) for a in [math.tau * k / 6 for k in range(6)]]
    for n, c in enumerate(links[:96]):
        nxt = links[min(n + 1, len(links) - 1)] if n + 1 < len(links) else c + (c - links[n - 1])
        d = (nxt - c).normalized()
        ang = math.atan2(d.y, d.x)
        flat = n % 2 == 0                                      # alternate links lie flat / stand on edge
        pts = [(x, 0.0, y) if not flat else (x, y, 0.0) for x, y in ring]
        m = T((c.x, c.y, 0.00025 + (0.0 if flat else 0.0006) + rng.u(0, 0.0002)), (0, 0, ang))
        part.add(tube(pts, 0.00025, sides=3, closed=True), mat, m)
    part.extras['low_min_tris'] = 99999
    anchor(part, 'wear_handle', (0, 0.017, 0.002), {'r': 0.006})      # bail / clasp worn bright
    anchor(part, 'wear_handle', (0, -0.012, 0.004), {'r': 0.008})     # thumbnail catch at the hinge side
    ph = Part('locket.photo', rng)
    ph.add_grid(1, 1, lambda u, v: ((u - 0.5) * 0.02, (v - 0.5) * 0.016, 0.0037), p.get('photoMat', 'photo_print'))
    ph.extras = {'decal': 'photo', 'photo': 'locket_bloomed', 'engraving': str(p.get('engraving', '')),
                 'text_param': 'engraving'}
    part.children.append((ph, None))
    return [part]


@prop('air_freshener', budget=200)
def air_freshener(p, rng):
    """Pine-tree card air freshener on its string. ORIGIN = the string's top (mirror stem)."""
    part = Part('air_freshener', rng)
    tree = [(0.0, 0.0), (0.012, 0.0), (0.012, 0.012), (0.035, 0.012), (0.02, 0.035), (0.03, 0.035), (0.015, 0.06),
            (0.022, 0.06), (0.0, 0.1), (-0.022, 0.06), (-0.015, 0.06), (-0.03, 0.035), (-0.02, 0.035), (-0.035, 0.012),
            (-0.012, 0.012), (-0.012, 0.0)]
    part.add(extrude(tree, 0.0012), 'paper_aged', T((0, 0.0006, -0.18), (math.pi / 2, 0, 0)))
    part.add(tube([(0, 0, 0), (0.002, 0, -0.04), (0, 0, -0.08)], 0.0005, sides=3), 'dust_sheet')
    part.extras.update({'shape': str(p.get('shape', 'pine')), 'print': 'air_freshener', 'swing': True})
    return [part]
