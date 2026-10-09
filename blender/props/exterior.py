"""Roadside + yard: mailbox, reflector posts, fence runs, farm gate, utility pole, rain barrel (trees: trees.py)."""
import math

from mathutils import Vector

from .kit import (Part, T, anchor, bisect, box, cyl, decal, extrude, fillet, jitter, lathe, plane, prop,
                  rect_section, rot_to, sag, sphere, tube)


def wood_post(part, rng, w, h, mat, x=0.0, y=0.0, below=0.4, lean=0.02, round_=False, r_top=None):
    """Weathered square (or round) post sunk `below` into the ground, with a slight lean and checks."""
    if round_:
        bm = cyl(w / 2, h + below, n=10, r_top=r_top or w / 2 * 0.92, bevel_w=0.01, z0=-below)
        bisect(bm, 2, [h * 0.3, h * 0.6])
    else:
        bm = box(w, w, h + below, 0.006, 2, cuts={2: 3}, center=(0, 0, (h - below) / 2))
    lx, ly = rng.j(lean), rng.j(lean)
    for v in bm.verts:
        f = max(0.0, v.co.z) / h
        v.co.x += lx * f
        v.co.y += ly * f
    jitter(bm, 0.003, freq=2.0, seed=rng.randint(0, 9999))
    part.add(bm, mat, T((x, y, 0)))
    return Vector((x + lx, y + ly, h))


@prop('mailbox', instance_keys=('name',), budget=5000)
def mailbox(p, rng):
    """US rural mailbox (Standard No.1, 48 x 16 x 20 cm, arched top) on a 4x4 post with a cross board."""
    mat = p.get('mat', 'rust')
    part = Part('mailbox', rng)
    top = wood_post(part, rng, 0.09, 1.0, 'wood_raw_plank', lean=0.04)
    part.add(box(0.14, 0.46, 0.035, 0.004, 2), 'wood_raw_plank', T((top.x, top.y, 1.0 + 0.0175)))
    L, W, Hs = 0.48, 0.16, 0.12
    r = W / 2
    prof = [(-W / 2, 0), (W / 2, 0), (W / 2, Hs)] + [(r * math.cos(a), Hs + r * math.sin(a))
                                                    for a in [math.pi * k / 12 for k in range(1, 12)]] + [(-W / 2, Hs)]
    body = extrude(prof, L, bevel_w=0.004, segs=2)
    bisect(body, 2, [L * 0.33, L * 0.66])
    d = rng.u(0.004, 0.01)
    for v in body.verts:   # a dent in the roof where the county plough clipped it
        if v.co.y > Hs and 0.1 < v.co.z < 0.3:
            v.co.y -= d * math.sin((v.co.z - 0.1) / 0.2 * math.pi)
    part.add(body, mat, T((top.x, top.y + L / 2 - 0.08, 1.035), (math.pi / 2, 0, 0)))
    door = Part('mailbox.door', rng)
    dprof = [(x * 1.02, y * 1.01) for x, y in prof]
    door.add(extrude(dprof, 0.006, 0.0015, 1), mat, T((0, 0, 0), (math.pi / 2, 0, 0)))
    door.add(box(0.03, 0.02, 0.012, 0.003, 1), mat, T((0, -0.012, Hs + r * 0.8)))
    door.extras = {'part': 'door', 'hinge_axis': [1, 0, 0]}
    part.children.append((door, T((top.x, top.y - L / 2 - 0.08 + 0.001, 1.035))))
    flag = Part('mailbox.flag', rng)
    flag.add(box(0.006, 0.22, 0.025, 0.002, 1), mat, T((0, 0.08, 0)))
    flag.add(box(0.006, 0.07, 0.06, 0.002, 1), mat, T((0, 0.17, 0.035)))
    flag.add(lathe([(0.0065, 0.0), (0.0055, 0.0015), (0.003, 0.0026), (0.0, 0.003)], n=16), 'rust',
             T((0.003, 0.0, 0.0), (0, math.pi / 2, 0)))                 # pivot rivet head (Ø 13 mm) on the flag arm
    flag.extras = {'part': 'flag', 'pivot_at': 'bolt', 'raise_axis': [1, 0, 0]}
    part.children.append((flag, T((top.x + W / 2 + 0.004, top.y - 0.05, 1.035 + Hs * 0.6), (-0.12, 0, 0))))
    decal(part, 'mailbox.name', 0.3, 0.06, T((top.x - W / 2 - 0.002, top.y - 0.08, 1.035 + Hs * 0.55), (0, 0, -math.pi / 2)),
          p.get('name', 'STROUD'), style='stencil', extra={'text_param': 'name'})
    return [part]


@prop('reflector_post', budget=1200)
def reflector_post(p, rng):
    """Painted timber delineator post with an amber reflector disc (extras.reflector for the runtime)."""
    part = Part('reflector_post', rng)
    top = wood_post(part, rng, 0.09, 1.05, 'trim_chipped', lean=0.05)
    part.add(lathe([(0, 0), (0.04, 0), (0.042, 0.004), (0.038, 0.012), (0, 0.014)], n=16), 'glass_grimy',
             T((top.x, top.y - 0.045, 0.9), (math.pi / 2, 0, 0)))
    part.extras['reflector'] = 'amber'
    return [part]


@prop('road_card', instance_keys=('text',), budget=1500)
def road_card(p, rng):
    """County service sign: galvanised plate on two punched U-channel posts.

    hero=True (C0/C1 'NEXT SERVICES 48 MI', docs/C1-OPENING.md §6.3): a w x h guide sign (default 2.4 x 1.2 m) of
    green retroreflective sheeting on an aluminium blank with two horizontal stiffener channels, bolted to two
    4 x 4 in creosoted wooden posts, bottom edge at 2.1 m. The runtime 'road_sign' decal draws the legend.
    """
    if p.get('hero'):
        return _road_card_hero(p, rng)
    part = Part('road_card', rng)
    w, h = 1.2, 0.45
    for sx in (-0.38, 0.38):
        bm = tube([(sx, 0.0, -0.6), (sx, 0, 2.05)], 0.02, section=[(-0.025, -0.012), (0.025, -0.012), (0.025, 0.012),
                                                                    (0.018, 0.012), (0.018, -0.004), (-0.018, -0.004),
                                                                    (-0.018, 0.012), (-0.025, 0.012)])
        part.add(bm, 'rust', T((0, 0, 0), (rng.j(0.02), rng.j(0.02), 0)))
    plate = box(w, 0.003, h, 0.002, 1, cuts={0: 4})
    for v in plate.verts:
        v.co.y += 0.008 * (v.co.x / w) ** 2 + 0.004 * v.co.z
    part.add(plate, 'zinc_galvanized', T((0, -0.018, 1.75)))
    decal(part, 'road_card.face', w - 0.05, h - 0.05, T((0, -0.021, 1.75)), p.get('text', 'NEXT SERVICES 48 MI'),
          style='road_sign', extra={'text_param': 'text'})
    return [part]


@prop('fence_run', budget=6000)
def fence_run(p, rng):
    """Cedar posts + 3 sagging strands of rusty barbed wire; a few strands broken and curled."""
    L = float(p.get('length', 10.0))
    sp = float(p.get('postSpacing', 2.4))
    part = Part('fence_run', rng)
    n = max(2, int(round(L / sp)) + 1)
    tops = []
    for i in range(n):
        x = -L / 2 + L * i / (n - 1) + rng.j(0.08)
        tops.append(wood_post(part, rng, rng.u(0.1, 0.13), 1.2 + rng.j(0.06), 'bark_wet', x=x, lean=0.07, round_=True))
    for zi, z in enumerate((0.45, 0.8, 1.1)):
        for i in range(n - 1):
            a, b = tops[i], tops[i + 1]
            if rng.chance(0.07):   # broken strand: two curled ends
                for s, e in ((a, 1), (b, -1)):
                    pts = [(s.x, s.y - 0.06, z + rng.j(0.02))]
                    for k in range(1, 6):
                        pts.append((s.x + e * 0.12 * k, s.y - 0.06 + rng.j(0.05), z - 0.05 * k * k * 0.3))
                    part.add(tube(pts, 0.002, sides=4), 'rust')
                continue
            pts = []
            for k in range(9):
                t = k / 8
                x = a.x + (b.x - a.x) * t
                y = a.y + (b.y - a.y) * t - 0.06
                zz = z * (a.z / 1.2 * (1 - t) + b.z / 1.2 * t) - 0.06 * 4 * t * (1 - t) * rng.u(0.5, 1.5)
                pts.append((x, y, zz))
            part.add(tube(pts, 0.002, sides=4), 'rust')
    part.extras['run_axis'] = [1, 0, 0]
    return [part]


@prop('farm_gate', budget=6000)
def farm_gate(p, rng):
    """Tubular 5-bar steel farm gate on a timber hinge post, swung open and sagging onto the gravel."""
    W = float(p.get('width', 2.6))
    mat = p.get('mat', 'rust')
    part = Part('farm_gate', rng)
    hx = -W / 2
    wood_post(part, rng, 0.2, 1.4, 'bark_wet', x=hx - 0.12, lean=0.03, round_=True)
    wood_post(part, rng, 0.18, 1.3, 'bark_wet', x=W / 2 + 0.12, lean=0.05, round_=True)
    leaf = Part('farm_gate.leaf', rng)
    H = 1.12
    r = 0.019
    frame = [(0, 0, 0.12), (W - 0.06, 0, 0.12), (W - 0.06, 0, H), (0, 0, H)]
    leaf.add(tube(fillet(frame + [frame[0]], 0.06, 3), r, sides=8), mat)
    for z in (0.33, 0.55, 0.77):
        leaf.add(tube([(0, 0, z), (W - 0.06, 0, z)], 0.0125, sides=6), mat)
    leaf.add(tube([(0.05, 0, 0.14), (W * 0.55, 0, H - 0.02)], 0.0125, sides=6), mat)
    leaf.add(tube([(W * 0.55, 0, 0.14), (W * 0.55, 0, H - 0.02)], 0.0125, sides=6), mat)
    for z in (0.25, 1.0):   # hinge straps
        leaf.add(box(0.12, 0.012, 0.05, 0.003, 1), mat, T((0.03, 0, z)))
    droop = math.radians(3.5 + rng.j(0.8))
    for i, v in enumerate(leaf.verts):   # sag: far end drops, bars bow slightly
        leaf.verts[i] = Vector((v.x, v.y, v.z - v.x * math.sin(droop) - 0.02 * math.sin(v.x / W * math.pi)))
    open_a = math.radians(72 if 'open' in str(p.get('state', 'open')) else 0)
    leaf.extras = {'part': 'leaf', 'hinge_axis': [0, 0, 1], 'open_deg': round(math.degrees(open_a), 1)}
    part.children.append((leaf, T((hx, 0, 0), (0, 0, open_a))))
    return [part]


@prop('utility_pole', budget=5000)
def utility_pole(p, rng):
    """Creosoted cedar pole with a crossarm, braces, 4 glass pin insulators and the cut line ends hanging down."""
    mat = p.get('mat', 'bark_wet')
    part = Part('utility_pole', rng)
    H = 9.2
    bm = cyl(0.15, H + 1.8, n=14, r_top=0.105, z0=-1.8)
    bisect(bm, 2, [H * k / 6 for k in range(1, 6)])
    lean = (rng.j(0.12), rng.j(0.12))
    for v in bm.verts:
        f = max(0.0, v.co.z) / H
        v.co.x += lean[0] * f * f
        v.co.y += lean[1] * f * f
    jitter(bm, 0.006, freq=0.8, seed=rng.randint(0, 999))
    part.add(bm, mat)
    top = Vector((lean[0], lean[1], H))
    za = H - 0.55
    part.add(box(2.4, 0.09, 0.11, 0.008, 2, cuts={0: 6}), 'wood_raw_plank', T((top.x * 0.95, top.y * 0.95 - 0.16, za)))
    for s in (-1, 1):
        part.add(tube([(top.x + s * 0.55, top.y - 0.14, za - 0.05), (top.x * 0.9, top.y - 0.12, za - 0.65)], 0.02,
                      section=rect_section(0.04, 0.008)), 'rust')
    ins = [(0, 0), (0.035, 0), (0.042, 0.03), (0.03, 0.04), (0.045, 0.05), (0.035, 0.07), (0.028, 0.1), (0, 0.105)]
    for i, x in enumerate((-1.05, -0.62, 0.62, 1.05)):
        m = T((top.x * 0.95 + x, top.y * 0.95 - 0.16, za + 0.055))
        part.add(cyl(0.012, 0.06, n=6), 'cast_iron', m)
        part.add(lathe(ins, n=12), 'glass_grimy', m @ T((0, 0, 0.05)))
        if p.get('wiresCut', True) and i != 2:
            pts = [(0, 0, 0.14), (0.05 * (-1) ** i, 0, 0.12)]
            ln = rng.u(0.8, 2.6)
            for k in range(1, 8):
                t = k / 7
                pts.append((0.08 * (-1) ** i + rng.j(0.06), rng.j(0.06) - 0.05 * t, 0.12 - ln * t))
            part.add(tube(fillet(pts, 0.05, 2), 0.004, sides=5), 'rust', m)
    for k in range(10):   # step spikes
        z = 2.4 + k * 0.45
        a = math.pi / 2 if k % 2 else -math.pi / 2
        part.add(cyl(0.008, 0.18, n=5), 'rust', T((top.x * z / H, top.y * z / H, z), (0, a, 0)))
    return [part]


@prop('rain_barrel', budget=5000)
def rain_barrel(p, rng):
    """A 55-gallon steel drum used as a rain barrel: two rolling hoops, chimes, open top brimming over."""
    mat = p.get('mat', 'rust')
    part = Part('rain_barrel', rng)
    R, H = 0.286, 0.88
    prof = [(0, 0.004), (R - 0.01, 0.004), (R - 0.004, 0.0), (R, 0.012), (R, H * 0.33 - 0.02), (R + 0.012, H * 0.33),
            (R, H * 0.33 + 0.02), (R, H * 0.67 - 0.02), (R + 0.012, H * 0.67), (R, H * 0.67 + 0.02), (R, H - 0.012),
            (R + 0.006, H - 0.004), (R + 0.002, H + 0.006), (R - 0.004, H), (R - 0.004, 0.012), (0, 0.012)]
    bm = lathe(prof, n=32)
    jitter(bm, 0.003, freq=5.0, seed=rng.randint(0, 999))
    part.add(bm, mat)
    water = Part('rain_barrel.water', rng)
    water.add(lathe([(0, H - 0.008), (R - 0.004, H - 0.008), (0, H - 0.0079)], n=32), 'glass_rain')
    water.extras = {'liquid': 'water_rain', 'overflowing': bool(p.get('overflowing', False))}
    part.children.append((water, None))
    part.add(box(0.8, 0.8, 0.1, 0.02, 2), 'stone_foundation', T((0, 0, -0.08), (0, 0, 0.3)))
    return [part]


def _road_card_hero(p, rng):
    part = Part('road_card', rng)
    w, h = float(p.get('w', 2.4)), float(p.get('h', 1.2))
    z0 = float(p.get('bottom', 2.1))
    zc = z0 + h / 2
    px = w * 0.3
    for i, sx in enumerate((-px, px)):
        top = wood_post(part, rng, 0.089, z0 + h - 0.08, 'bark_wet', x=sx, y=0.06, below=0.9, lean=0.012)
        # a 1 in drilled breakaway hole + saw kerf low on each post (real US practice), and a weathered top bevel
        part.add(box(0.095, 0.095, 0.012, 0.002, 1, center=(sx, 0.06, 0.1 + 0.03 * i)), 'rubber_black')
    # aluminium blank (slightly oil-canned) with the sheeting on its face
    blank = box(w, 0.004, h, 0.0015, 1, cuts={0: 8, 2: 4})
    for v in blank.verts:
        v.co.y += 0.006 * (1 - (2 * v.co.x / w) ** 2) * (1 - (2 * v.co.z / h) ** 2) + rng.j(0.0008)
    part.add(blank, 'sign_sheeting', T((0, 0, zc)))
    # two horizontal Z-bar stiffeners behind, bolted to the posts
    for zz in (zc - h * 0.3, zc + h * 0.3):
        part.add(box(w - 0.06, 0.03, 0.05, 0.003, 1, center=(0, 0.02, zz)), 'zinc_galvanized')
        for sx in (-px, px):
            part.add(cyl(0.009, 0.012, n=8, z0=0), 'zinc_galvanized', T((sx, -0.004, zz), (math.pi / 2, 0, 0)))
    # a shotgun-pellet ding pattern is a material job; geometry: one bent corner (snowplough)
    decal(part, 'road_card.face', w - 0.06, h - 0.06, T((0, -0.004, zc)), p.get('text', 'NEXT SERVICES 48 MI'),
          style='road_sign', extra={'text_param': 'text', 'retro': 1.0})
    return [part]
