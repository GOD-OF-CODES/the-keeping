"""Small hand-scale items: bucket, books, letter, cleaver, hammer, nail can, jerry can, shears, sewing basket, locket,
bus ticket, whetstone, rubber sheet, air freshener. Text/photos are runtime decals (child nodes, extras.decal)."""
import math

from mathutils import Vector

from .kit import (Part, T, anchor, bisect, box, cyl, decal, extrude, fillet, jitter, lathe, plane, prop,
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
    part.add(tube(bail, 0.0024, sides=6), 'cast_iron')
    mid = Vector(pts[8])
    grip_dir = Vector(pts[10]) - Vector(pts[6])
    grip = cyl(0.011, 0.105, n=12, bevel_w=0.003)
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
        cb = box(w + 0.008, h + 0.012, 0.004, 0.0015, 1, cuts={0: 2})
        for v in cb.verts:
            v.co.z += 0.003 * max(0.0, 1 - abs(v.co.x) / 0.02) * 0
        part.add(cb, cover, T((s * (w / 2 + 0.004), 0, 0.002)))
        _book_block(part, rng, w, h - 0.006, th, paper, T((0, 0, 0.004), (0, 0, 0 if s > 0 else math.pi)))
        page = Part(f'guest_book.page_{"right" if s > 0 else "left"}', rng)

        def f(u, v, s=s):
            x, z = _page_surface(u if s > 0 else 1 - u, w, th, True)
            return (s * x, (v - 0.5) * (h - 0.01), 0.0045 + z)
        page.add_grid(10, 1, f, paper, flip=(s < 0))
        page.extras = {'decal': 'handwriting', 'page': 'right' if s > 0 else 'left', 'text_param': 'state',
                       'lines': int(p.get('lines', 11))}
        part.children.append((page, None))
    part.add(tube([(0.0, -0.12, 0.012), (0.004, 0.06, 0.012)], 0.0035, sides=6), 'wood_raw_plank')
    part.add(tube([(0.004, 0.06, 0.012), (0.0045, 0.075, 0.012)], 0.0035, sides=6, radii=[1.0, 0.2]), 'cast_iron')
    part.add(box(0.012, 0.13, 0.0006, 0.0002, 1), 'flannel_red', T((0.0, -0.225, 0.004)))
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
    part.add(box(w - 0.008, h - 0.01, t - 0.008, 0.001, 1), paper, T((0.002, 0, 0.004 + (t - 0.008) / 2)))
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
    return [part]


@prop('letter', instance_keys=('unsent',), budget=800)
def letter(p, rng):
    """Unsent letter half out of its unsealed envelope; the sheet (folded in thirds, springing open) is a runtime
    handwriting canvas (child node)."""
    part = Part('letter', rng)
    paper = p.get('mat', 'paper_aged') + '@2s'
    ew, eh = 0.165, 0.095
    part.add(box(ew, eh, 0.0012, 0.0004, 1), paper.replace('@2s', ''), T((0, 0, 0.0006)))
    part.add_grid(4, 2, lambda u, v: ((u - 0.5) * ew * (1 - 0.6 * v), eh / 2 + v * 0.055, 0.0013 + 0.004 * v), paper)
    sheet = Part('letter.sheet', rng)
    sw, sh = 0.2, 0.26
    sheet.add_grid(6, 12, lambda u, v: ((u - 0.5) * sw, v * sh - 0.02,
                                        0.0025 + 0.012 * abs(math.sin(v * 3 * math.pi / 2)) * (0.3 + 0.7 * v)), paper)
    sheet.extras = {'decal': 'handwriting', 'page': 'letter', 'unsent': bool(p.get('unsent', True))}
    part.children.append((sheet, T((0.01, 0.0, 0.0), (0, 0, rng.j(0.15)))))
    return [part]


@prop('bus_ticket', instance_keys=('text',), budget=200)
def bus_ticket(p, rng):
    part = Part('bus_ticket', rng)
    part.add_grid(4, 2, lambda u, v: ((u - 0.5) * 0.07, (v - 0.5) * 0.035, 0.001 + 0.004 * (2 * u - 1) ** 2),
                  p.get('mat', 'paper_aged') + '@2s')
    part.extras.update({'print': 'ticket', 'text': str(p.get('text', '')), 'text_param': 'text'})
    return [part]


@prop('hog_cleaver', budget=2500)
def hog_cleaver(p, rng):
    """Heavy butcher's cleaver lying flat: wedge-ground 20 x 10 cm blade (6 mm spine), hanging hole, riveted
    hardwood scales. Blade material from params (rust); baked unique texture per PLAN."""
    part = Part('hog_cleaver', rng)
    outline = [(0.0, 0.0), (0.2, -0.004), (0.205, 0.02), (0.2, 0.098), (0.185, 0.102), (0.02, 0.1), (0.0, 0.085)]
    bm = extrude(outline, 0.006, 0.0008, 1)
    bisect(bm, 1, [0.03, 0.06])
    for v in bm.verts:   # wedge grind towards the cutting edge (y ~ 0)
        k = max(0.0, 1 - v.co.y / 0.035)
        v.co.z = 0.003 + (v.co.z - 0.003) * (1 - 0.9 * k)
    jitter(bm, 0.0005, freq=30.0, seed=rng.randint(0, 999), axes=(0, 0, 1))
    part.add(bm, p.get('mat', 'rust'), T((-0.06, -0.05, 0.0)))
    part.add(lathe([(0.008, 0.0), (0.011, 0.0), (0.011, 0.007), (0.008, 0.007)], n=12, closed=True), p.get('mat', 'rust'),
             T((0.1, 0.035, -0.0005)))
    hm = p.get('handleMat', 'wood_furniture_dark')
    hdl = box(0.13, 0.032, 0.022, 0.008, 3, cuts={0: 3})
    for v in hdl.verts:
        v.co.y *= 1 + 0.15 * (v.co.x / 0.065)
    part.add(hdl, hm, T((-0.06 - 0.065, 0.035 - 0.05 + 0.03, 0.003)))
    for x in (-0.09, -0.125, -0.16):
        part.add(cyl(0.0035, 0.024, n=8), 'cast_iron', T((x, 0.013, -0.009)))
    part.apply(T((0, 0, 0)), ground=True)
    return [part]


@prop('whetstone', budget=600)
def whetstone(p, rng):
    """Bench whetstone, 20 x 5 x 2.5 cm, the top dished from years of use."""
    part = Part('whetstone', rng)
    bm = box(0.2, 0.05, 0.025, 0.002, 2, cuts={0: 6}, base=True)
    for v in bm.verts:
        if v.co.z > 0.02:
            v.co.z -= 0.003 * (1 - (v.co.x / 0.1) ** 2)
    jitter(bm, 0.0006, freq=25.0, seed=rng.randint(0, 999))
    part.add(bm, p.get('mat', 'stone_foundation'))
    return [part]


@prop('claw_hammer', budget=1500)
def claw_hammer(p, rng):
    """16 oz claw hammer lying on its side: forged head with curved split claw, hickory handle."""
    part = Part('claw_hammer', rng)
    hm = p.get('mat', 'cast_iron')
    part.add(cyl(0.015, 0.045, n=12, bevel_w=0.003), hm, T((0.0, 0, 0.016), (0, math.pi / 2, 0)))
    claw = [(0.0, 0.0, 0.016), (-0.03, 0.0, 0.016), (-0.06, 0.006, 0.016), (-0.085, 0.018, 0.016),
            (-0.1, 0.034, 0.016)]
    for dz in (-0.0045, 0.0045):
        part.add(tube([(x, y, z + dz) for x, y, z in claw], 0.006, section=rect_section(0.012, 0.006, 0.002),
                      radii=[1.2, 1.1, 1.0, 0.8, 0.5]), hm)
    part.add(box(0.03, 0.026, 0.034, 0.004, 2), hm, T((-0.005, 0, 0.016)))
    hdl = [(-0.01, 0, 0.016), (-0.01, 0.12, 0.016), (-0.008, 0.25, 0.016), (-0.006, 0.31, 0.016)]
    part.add(tube(hdl, 0.013, section=[(0.011 * math.cos(a), 0.015 * math.sin(a)) for a in
                                       [math.tau * k / 10 for k in range(10)]], radii=[0.95, 0.8, 1.0, 1.05]),
             p.get('handleMat', 'wood_furniture_dark'))
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


@prop('jerry_can', instance_keys=('plate', 'chalk', 'full'), budget=3000)
def jerry_can(p, rng):
    """20 L jerry can: pressed X panels, perimeter weld bead, triple handle, cam-lever spout. A chalk plate number
    is a runtime decal on the flank (extras.text from the placement's `plate`)."""
    part = Part('jerry_can', rng)
    mat = p.get('mat', 'rust')
    W, D, H = 0.345, 0.165, 0.47
    body = box(W, D, H - 0.02, 0.014, 3, cuts={0: 2, 2: 2}, base=True)
    jitter(body, 0.0015, freq=6.0, seed=rng.randint(0, 999))
    part.add(body, mat, T((0, 0, 0.0)))
    part.add(tube([(-W / 2, 0, 0.0), (W / 2, 0, 0.0), (W / 2, 0, H - 0.02), (-W / 2, 0, H - 0.02)], 0.004, sides=5,
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
    part.add(cyl(0.022, 0.035, n=14, bevel_w=0.003), mat, sp)
    part.add(tube([(0.0, -0.028, 0.03), (-0.04, -0.028, 0.06), (-0.08, -0.028, 0.05)], 0.006,
                  section=rect_section(0.012, 0.004, 0.001)), mat, sp)
    decal(part, 'jerry_can.chalk', 0.2, 0.08, T((0, -D / 2 - 0.004, H * 0.62)), str(p.get('plate', '')),
          mat='paper_aged', style='chalk', extra={'text_param': 'plate'})
    part.extras['full'] = bool(p.get('full', True))
    return [part]


def shears_parts(part, rng, m, mat='cast_iron'):
    """Dressmaker's shears lying flat (25 cm): two ground blades, pivot screw, a small and a large bow."""
    for s, dz in ((1, 0.0), (-1, 0.0032)):
        blade = [(0.0, -0.004 * s), (0.13, -0.002 * s), (0.14, 0.001 * s), (0.0, 0.009 * s)]
        bl = extrude(blade if s > 0 else blade[::-1], 0.003, 0.0006, 1)
        part.add(bl, mat, m @ T((0, 0, dz)))
        bow_c = (-0.07, 0.022 * s if s > 0 else -0.018)
        rx, ry = (0.03, 0.014) if s > 0 else (0.022, 0.012)
        loop = [(bow_c[0] + rx * math.cos(a), bow_c[1] + ry * math.sin(a), dz + 0.0015) for a in
                [math.tau * k / 14 for k in range(14)]]
        part.add(tube(loop, 0.004, section=rect_section(0.008, 0.004, 0.0015), closed=True), mat, m)
        part.add(tube([(0.0, 0.002 * s, dz + 0.0015), (bow_c[0] + rx * 0.8, bow_c[1] - s * ry * 0.3, dz + 0.0015)],
                      0.004, section=rect_section(0.007, 0.004, 0.0015)), mat, m)
    part.add(cyl(0.004, 0.008, n=10), mat, m @ T((0, 0.002, -0.0005)))


@prop('sewing_shears', budget=1500)
def sewing_shears(p, rng):
    part = Part('sewing_shears', rng)
    shears_parts(part, rng, T((0.03, 0, 0)), p.get('mat', 'cast_iron'))
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
    for k in range(3):   # swallowtail fingers (copper tacks as dots)
        ang = 0.4 + k * 0.08
        part.add(extrude([(0, 0), (0.05, -0.012), (0.06, 0), (0.05, 0.012)], 0.0015, 0.0003, 1), mat,
                 T((a * math.cos(ang), b * math.sin(ang), 0.05 + k * 0.05), (math.pi / 2, 0, ang + math.pi / 2)))
    part.add_grid(6, 3, lambda u, v: ((u - 0.5) * 0.09 + 0.05, -b + 0.012 - v * 0.012, H + 0.018 - v * 0.07), 'flannel_red@2s')
    return [part]


@prop('locket', instance_keys=('engraving',), budget=2500)
def locket(p, rng):
    """Oval hinged brass locket (3 x 2.4 cm) with bail and a fine chain pooled beside it; engraving + water-bloomed
    photo are runtime decals. open=true splays the lid on its hinge (child `lid`)."""
    part = Part('locket', rng)
    mat = p.get('mat', 'brass_tarnished')
    ov = T((0, 0, 0), scale=(1.0, 0.8, 1.0))
    part.add(lathe([(0, 0.0), (0.013, 0.0), (0.015, 0.002), (0.015, 0.0035), (0, 0.0035)], n=24), mat, ov)
    lid = Part('locket.lid', rng)
    lid.add(lathe([(0, 0.0), (0.015, 0.0), (0.015, 0.0015), (0.012, 0.0035), (0, 0.004)], n=24), mat,
            T((0, 0.012, 0), scale=(1.0, 0.8, 1.0)))
    lid.extras = {'part': 'lid', 'hinge_axis': [1, 0, 0], 'open': bool(p.get('open', False))}
    part.children.append((lid, T((0, -0.012, 0.0035), (math.radians(-110) if p.get('open') else 0, 0, 0))))
    part.add(tube([(0.0025 * math.cos(a), 0.0145 + 0.0025 * math.sin(a), 0.002) for a in
                   [math.tau * k / 8 for k in range(8)]], 0.0007, sides=4, closed=True), mat)
    chain = []
    for k in range(60):
        t = k / 59
        r = 0.018 + 0.01 * t
        a = t * math.tau * 1.7
        chain.append((0.03 * t + r * math.cos(a) - 0.018, 0.02 + r * math.sin(a) * 0.8, 0.0008))
    part.add(tube(chain, 0.0008, sides=4), mat)
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
