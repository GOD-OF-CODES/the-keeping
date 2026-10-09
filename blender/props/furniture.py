"""Furniture family (1950s-70s rural American, much of it older inherited Victorian farmhouse stock).

Real dimensions, turned legs, bevelled/rounded edges (no knife edges), asymmetric wear via seeded noise.
"""
import math

from .kit import (Part, T, anchor, box, grime, cyl, escutcheon, extrude, fillet, hinge_butt, jitter, lathe, nz, prop,
                  rect_section, sphere, tube, bisect, sag)


def turned_leg(h, top_sq=0.045, foot_r=0.016, block=0.12, style=0):
    """Profile of a turned leg below a square block: collar, vase, taper, foot pad. Returns lathe profile."""
    r0 = top_sq * 0.5
    hb = h - block
    if style == 0:   # Victorian/farmhouse turning: pad foot, long taper, vase, ring, neck, collar under the block
        pts = [(0, 0), (foot_r * 0.92, 0), (foot_r * 1.08, 0.005), (foot_r * 1.1, 0.014), (foot_r * 0.95, 0.024),
               (r0 * 0.78, hb * 0.40), (r0 * 0.86, hb * 0.55), (r0 * 0.93, hb * 0.66), (r0 * 0.78, hb * 0.74),
               (r0 * 0.66, hb * 0.78), (r0 * 0.94, hb * 0.83), (r0 * 0.97, hb * 0.855), (r0 * 0.7, hb * 0.885),
               (r0 * 0.68, hb * 0.93), (r0 * 0.98, hb * 0.965), (r0 * 0.98, hb), (0, hb)]
    else:   # plain tapered (kitchen / country)
        pts = [(0, 0), (foot_r, 0), (foot_r * 1.02, 0.01), (r0 * 0.78, hb * 0.9), (r0 * 0.9, hb * 0.95),
               (r0 * 0.95, hb), (0, hb)]
    return pts


def add_leg(part, rng, x, y, h, mat, top_sq=0.045, foot_r=0.016, block=0.12, style=0, n=24):
    part.add(lathe(turned_leg(h, top_sq, foot_r, block, style), n=n), mat, T((x, y, 0)))
    part.add(box(top_sq, top_sq, block, bevel_w=0.003, segs=1, base=True), mat, T((x, y, h - block)))


@prop('hall_table', instance_keys=('dust',), budget=8000)
def hall_table(p, rng):
    L, D, H = float(p.get('length', 1.0)), float(p.get('depth', 0.42)), float(p.get('height', 0.8))
    mat = p.get('mat', 'wood_furniture_dark')
    part = Part('hall_table', rng)
    tt, over, ap_h, ap_t, leg = 0.024, 0.03, 0.10, 0.02, 0.045
    top = box(L, D, tt, bevel_w=0.006, segs=3, cuts={0: 6}, base=True)
    jitter(top, 0.0012, freq=3.0, seed=rng.randint(0, 999))
    part.add(top, mat, T((0, 0, H - tt)))
    lx, ly = L / 2 - over - leg / 2, D / 2 - over - leg / 2
    for sx in (-1, 1):
        for sy in (-1, 1):
            add_leg(part, rng, sx * lx, sy * ly, H - tt, mat, leg, 0.015, ap_h + 0.01)
    za = H - tt - ap_h
    # side + back aprons
    part.add(box(2 * lx - leg, ap_t, ap_h, 0.002, 1, base=True), mat, T((0, ly, za)))
    for sx in (-1, 1):
        part.add(box(ap_t, 2 * ly - leg, ap_h, 0.002, 1, base=True), mat, T((sx * lx, 0, za)))
    # front apron framed around a drawer
    dw = min(0.5, (2 * lx - leg) * 0.6)
    rail = (2 * lx - leg - dw) / 2
    for sx in (-1, 1):
        part.add(box(rail, ap_t, ap_h, 0.002, 1, base=True), mat, T((sx * (dw / 2 + rail / 2), -ly, za)))
    part.add(box(dw, ap_t, 0.012, 0.002, 1, base=True), mat, T((0, -ly, za)))
    drawer = Part('hall_table.drawer', rng)
    drawer.add(box(dw - 0.004, 0.018, ap_h - 0.016, 0.003, 2, base=True), mat, T((0, -0.009, 0)))
    drawer.add(box(dw - 0.03, D - 2 * over - 0.06, 0.07, 0.001, 1, base=True), mat, T((0, D / 2 - over - 0.03, 0.004)))
    knob = [(0, 0), (0.008, 0), (0.0075, 0.006), (0.004, 0.011), (0.011, 0.018), (0.012, 0.022), (0.007, 0.026),
            (0, 0.0265)]
    drawer.add(lathe(knob, n=24), mat, T((0, -0.018, (ap_h - 0.016) / 2), (math.pi / 2, 0, 0)))
    anchor(drawer, 'wear_handle', (0, -0.03, (ap_h - 0.016) / 2), {'r': 0.035})
    grime(drawer, [(9, 20, (0, -0.0185, (ap_h - 0.016) / 2), (0, 0, 0), 0.06, 0.05)])   # finger smudge
    grime(part, [(c, 37 + c, (x * L, y * D, H), (-math.pi / 2, 0, 0), 0.085, 0.085)           # Ø 65–85 mm
                 for c, x, y in ((0, -0.28, 0.12), (1, 0.31, -0.08))])                                   # glass rings
    drawer.extras = {'part': 'drawer', 'slide': [0, -1, 0], 'travel_m': 0.25}
    part.children.append((drawer, T((0, -ly - ap_t / 2 + 0.001, za + 0.012))))
    # low stretcher shelf, common on farmhouse hall tables
    part.add(box(2 * lx + 0.01, 2 * ly + 0.01, 0.016, 0.003, 2, base=True), mat, T((0, 0, 0.16)))
    part.jitter(0.0008, freq=2.0, zmin=0.001)
    return [part]


@prop('stool', budget=4000)
def stool(p, rng):
    mat = p.get('mat', 'wood_raw_plank')
    H = float(p.get('height', 0.55))
    part = Part('stool', rng)
    seat_r, st = 0.165, 0.035
    seat = lathe([(0, 0), (seat_r - 0.01, 0), (seat_r - 0.002, 0.004), (seat_r, 0.012), (seat_r - 0.001, st - 0.01),
                  (seat_r - 0.009, st - 0.001), (seat_r - 0.03, st), (0, st - 0.002)], n=28)
    jitter(seat, 0.0015, freq=6.0, seed=rng.randint(0, 999))
    part.add(seat, mat, T((0, 0, H - st)))
    splay = math.radians(9)
    rtop, h = 0.10, H - st
    ang0 = math.radians(45) + rng.j(0.05)
    feet = []
    for i in range(4):
        a = ang0 + i * math.pi / 2
        top = (rtop * math.cos(a), rtop * math.sin(a), h + 0.02)
        dx = math.tan(splay) * h
        foot = ((rtop + dx) * math.cos(a), (rtop + dx) * math.sin(a), 0.0)
        feet.append((top, foot))
        part.add(tube([foot, top], 0.0145, sides=10, radii=[0.9, 1.0]), mat)
    for i, zr in enumerate((0.17, 0.23, 0.17, 0.23)):
        (t0, f0), (t1, f1) = feet[i], feet[(i + 1) % 4]
        k = zr / h
        a = [f0[j] + (t0[j] - f0[j]) * k for j in range(3)]
        b = [f1[j] + (t1[j] - f1[j]) * k for j in range(3)]
        part.add(tube([a, b], 0.0095, sides=16), mat)
    part.jitter(0.001, freq=3.0, zmin=0.001)
    return [part]


def plank_top(part, rng, L, W, t, n, mat, z, gap=0.003, cuts=8, warp=0.003):
    """Table top of n planks running along x (each cups/warps a little), bottom at z."""
    pw = (W - gap * (n - 1)) / n
    for i in range(n):
        y = -W / 2 + pw / 2 + i * (pw + gap)
        bm = box(L + rng.j(0.004), pw, t, 0.004, 2, cuts={0: cuts, 1: 1}, base=True)
        k, c = rng.j(warp), rng.j(warp)
        for v in bm.verts:
            xx = 2 * v.co.x / L
            v.co.z += k * (1 - xx * xx) + c * (2 * v.co.y / pw) ** 2
        jitter(bm, 0.0012, freq=4.0, seed=rng.randint(0, 9999))
        part.add(bm, mat, T((rng.j(0.004), y, z)))


SAWBUCK_W = 0.6


@prop('sawbuck_table', budget=6000)
def sawbuck_table(p, rng):
    """Farm sawbuck table: 3-plank top on cleats, two pegged X-trestles, a through-tenoned stretcher with wedges.

    Width is FIXED at SAWBUCK_W = 0.6 m: Ada's `ada_table` / `ada_opening` clips assume the top spans 0.03-0.63 m in
    front of her root (her head hangs over the far edge). The layout's P_SAWBUCK.params.width (0.8) is overridden
    until the lead changes it to 0.6 (docs/PROPS.md)."""
    L, H = float(p.get('length', 2.2)), float(p.get('height', 0.8))
    W = SAWBUCK_W
    if abs(float(p.get('width', SAWBUCK_W)) - SAWBUCK_W) > 1e-6:
        print(f"[props] sawbuck_table: layout width {p.get('width')} overridden -> {SAWBUCK_W} (Ada's table clips)")
    mat = p.get('mat', 'wood_raw_plank')
    part = Part('sawbuck_table', rng)
    tt = 0.042
    plank_top(part, rng, L, W, tt, 3, mat, H - tt)
    xs = L / 2 - 0.32
    zc = (H - tt - 0.05) * 0.5
    for sx in (-1, 1):
        x = sx * xs
        part.add(box(0.06, W - 0.06, 0.05, 0.005, 2, base=True), mat, T((x, 0, H - tt - 0.05)))
        for sgn, dx in ((1, -0.018), (-1, 0.018)):
            a = (x + dx, -sgn * (W / 2 - 0.1), 0.0)
            b = (x + dx, sgn * (W / 2 - 0.12), H - tt - 0.05)
            part.add(tube([a, b], 0.03, section=rect_section(0.036, 0.075, 0.006, 2)), mat)
        part.add(cyl(0.011, 0.1, n=16), mat, T((x - 0.05, 0, zc), (0, math.pi / 2, 0)))
    part.add(box(2 * xs + 0.2, 0.05, 0.1, 0.006, 2, cuts={0: 4}), mat, T((0, 0, zc)))
    for sx in (-1, 1):
        part.add(extrude([(0, 0), (0.07, 0), (0.07, 0.018)], 0.022, 0.002, 1), mat,
                 T((sx * (xs + 0.07), -0.011, zc + 0.02), (math.pi / 2, 0, 0 if sx > 0 else math.pi)))
    part.jitter(0.001, freq=2.0, zmin=0.001)
    return [part]


@prop('rocking_chair', budget=13500)   # 12000 -> 13500: 16-side spindles/legs + support loops (PROPS-FINISH §3.1a)
def rocking_chair(p, rng):
    """Windsor-style farmhouse rocker: saddled plank seat, 7 spindles to a bent crest rail, scrolled arms, turned
    legs on long runners. Rocks about local x at the runner contact (extras.rock_axis)."""
    mat = p.get('mat', 'wood_furniture_dark')
    part = Part('rocking_chair', rng)
    R, zr = 1.15, 0.0
    run_y = 0.02
    for sx in (-1, 1):
        x = sx * 0.25
        pts = [(x, run_y + R * math.sin(a), R - R * math.cos(a) + 0.03)
               for a in [math.radians(-24 + 48 * k / 16) for k in range(17)]]
        part.add(tube(pts, 0.03, section=rect_section(0.024, 0.06, 0.008, 2)), mat)
    ys = 0.42
    # legs from runners into the seat
    legs = {(-1, -1): (-0.23, -0.2), (1, -1): (0.23, -0.2), (-1, 1): (-0.22, 0.17), (1, 1): (0.22, 0.17)}
    for (sx, sy), (x, y) in legs.items():
        a = math.asin(max(-1, min(1, (y - run_y) / R)))
        zb = R - R * math.cos(a) + 0.05
        part.add(tube([(x * 1.08, y, zb), (x, y, ys)], 0.017, sides=10, radii=[0.85, 1.0]), mat)
    for y in (-0.2, 0.17):   # side stretchers
        pass
    for sx in (-1, 1):
        part.add(tube([(sx * 0.235, -0.2, 0.2), (sx * 0.225, 0.17, 0.2)], 0.011, sides=16), mat)
    part.add(tube([(-0.235, -0.2, 0.17), (0.235, -0.2, 0.17)], 0.011, sides=16), mat)
    seat = box(0.5, 0.46, 0.036, 0.009, 3, cuts={0: 5, 1: 5}, base=True)
    for v in seat.verts:   # saddle: scooped either side of a centre pommel, front edge rounded down
        if v.co.z > 0.02:
            v.co.z -= 0.009 * (1 - (2 * v.co.y / 0.46) ** 2) * (0.6 + 0.4 * abs(2 * v.co.x / 0.5))
    part.add(seat, mat, T((0, -0.01, ys)))
    top = ys + 0.036
    rake = 0.16
    crest_z = 1.08
    cz0 = crest_z - 0.05
    for sx in (-1, 1):   # back posts continue the rear legs, raked back
        pts = [(sx * 0.22, 0.17, top - 0.02), (sx * 0.215, 0.17 + rake * 0.5, (top + cz0) / 2),
               (sx * 0.21, 0.17 + rake, cz0 + 0.06)]
        part.add(tube(pts, 0.016, sides=10, radii=[1.1, 1.0, 0.9]), mat)
    crest = []
    for k in range(9):
        t = k / 8
        x = -0.25 + 0.5 * t
        crest.append((x, 0.17 + rake + 0.04 * (1 - (2 * t - 1) ** 2), crest_z))
    part.add(tube(crest, 0.02, section=rect_section(0.024, 0.1, 0.01, 2)), mat)
    for k in range(7):
        t = (k + 1) / 8
        x = -0.2 + 0.4 * t
        yb = 0.12 + 0.02 * math.cos(x * 4)
        yt = 0.17 + rake + 0.04 * (1 - (2 * ((x + 0.25) / 0.5) - 1) ** 2) - 0.01
        part.add(tube([(x * 0.9, yb, top - 0.01), (x, (yb + yt) / 2 + 0.015, (top + crest_z) / 2), (x, yt, crest_z - 0.04)],
                      0.0085, sides=12, radii=[1.0, 1.1, 0.8]), mat)
    za = ys + 0.24
    for sx in (-1, 1):
        arm = [(sx * 0.215, 0.17 + rake * 0.35, za + 0.02), (sx * 0.25, 0.02, za), (sx * 0.26, -0.18, za - 0.01),
               (sx * 0.265, -0.25, za - 0.015)]
        part.add(tube(arm, 0.02, section=rect_section(0.06, 0.024, 0.009, 2)), mat)
        part.add(cyl(0.024, 0.026, n=24, bevel_w=0.006), mat, T((sx * 0.265, -0.255, za - 0.035)))
        part.add(tube([(sx * 0.235, -0.18, top - 0.01), (sx * 0.255, -0.2, za - 0.015)], 0.0125, sides=16,
                      radii=[1.0, 0.85]), mat)
        part.add(tube([(sx * 0.225, -0.02, top - 0.01), (sx * 0.24, -0.02, za - 0.01)], 0.008, sides=12), mat)
    part.jitter(0.0012, freq=2.5)
    for sx in (-1, 1):   # hands rest on the arm fronts; the crest rail is where it is pushed to rock
        anchor(part, 'wear_handle', (sx * 0.26, -0.15, 0.66), {'r': 0.09})
    anchor(part, 'wear_handle', (0.0, 0.22, 1.08), {'r': 0.12})
    anchor(part, 'wear_handle', (0.0, -0.05, 0.45), {'r': 0.14})    # the seat, polished by sitting
    part.extras.update({'rock_axis': [1, 0, 0], 'runner_radius_m': R, 'rocks': bool(p.get('rocks', True))})
    return [part]


def moulding_frame(part, w, h, sec, mat, m, closed=True):
    """Picture-frame style moulding swept round a w x h rectangle in local XZ (section in (outward, depth))."""
    rect = [(-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2)]
    part.add(tube(rect, 0.01, section=sec, closed=True), mat, m)


def frame_section(width, depth, style=0):
    """Moulding cross-section (x = outward from the opening, y = towards the viewer) — ogee + bead."""
    if style == 0:
        return [(0, 0), (width, 0), (width, depth * 0.55), (width * 0.85, depth * 0.8), (width * 0.62, depth),
                (width * 0.4, depth * 0.95), (width * 0.25, depth * 0.7), (width * 0.12, depth * 0.72), (0, depth * 0.5)]
    return [(0, 0), (width, 0), (width, depth), (width * 0.2, depth), (0, depth * 0.6)]


@prop('photo_frame', instance_keys=('photo',), budget=2500)
def photo_frame(p, rng):
    """Wall-hung moulded frame, glass, photo (decal: extras.photo, faces knifed out at runtime), backing board.
    ORIGIN = frame back centre on the wall; the frame leans forward ~4 deg as if hung on a cord."""
    size = p.get('size', 'medium')
    W, H = {'large': (0.46, 0.58), 'medium': (0.3, 0.38), 'small': (0.17, 0.22)}.get(size, (0.3, 0.38))
    part = Part('photo_frame', rng)
    fw = 0.045 if size == 'large' else 0.032
    fd = 0.028 if size == 'large' else 0.022
    ow, oh = W - 2 * fw, H - 2 * fw
    sec = [(x, -y) for x, y in frame_section(fw, fd)]
    rect = [(-ow / 2, 0, -oh / 2), (-ow / 2, 0, oh / 2), (ow / 2, 0, oh / 2), (ow / 2, 0, -oh / 2)]
    part.add(tube(rect, 0.01, section=[(-x, y) for x, y in sec], closed=True), 'wood_furniture_dark')
    part.add(box(ow + 0.01, 0.002, oh + 0.01, 0.0005, 1), 'glass_grimy', T((0, -0.004, 0)))
    part.add(box(ow + 0.01, 0.004, oh + 0.01, 0.0005, 1), 'wood_raw_plank', T((0, 0.002, 0)))
    photo = Part('photo_frame.photo', rng)
    photo.add_grid(1, 1, lambda u, v: ((u - 0.5) * ow, -0.0015, (v - 0.5) * oh), p.get('mat', 'photo_print'))
    photo.extras = {'decal': 'photo', 'photo': str(p.get('photo', '')), 'text_param': 'photo'}
    part.children.append((photo, None))
    # picture cord (jute, Ø 3 mm) from two screw eyes on the back up to a cut nail: the V shows above the frame
    ny_ = H / 2 + (0.07 if size == 'large' else 0.05)
    for sx in (-1, 1):
        part.add(tube([(sx * ow * 0.42, 0.006, oh * 0.3), (sx * ow * 0.2, 0.008, H / 2 + 0.01),
                       (sx * 0.004, 0.011, ny_ - 0.002)], 0.0015, sides=6), 'twine_jute')
    part.add(cyl(0.0035, 0.004, n=12), 'cast_iron', T((0, 0.006, ny_), (math.pi / 2, 0, 0)))
    part.apply(T((0, -0.01, 0), (math.radians(-4), 0, 0)))
    return [part]


def crepe_drape(part, rng, w, top_z, bot_z, front_y, depth, mat='crepe_black@2s', tail=0.12):
    """Mourning crepe thrown over a frame: lies across the top, a short tail behind, folds gathering to the hem."""
    seed = rng.randint(0, 999)
    L_front = top_z - bot_z
    ny = 34

    def f(u, v):
        # v: 0 = back tail end, ~0.18 = over the top, 1 = front hem
        vt = 0.16
        x = (u - 0.5) * w * 1.08
        if v < vt:
            s = v / vt
            y = depth * 0.5 - 0.004 + (1 - s) * 0.01
            z = top_z + 0.004 - (1 - s) * tail
            a = 0.0
        elif v < vt + 0.06:
            s = (v - vt) / 0.06
            y = depth * 0.5 - s * (depth + 0.008)
            z = top_z + 0.006 + 0.004 * math.sin(s * math.pi)
            a = 0.0
        else:
            s = (v - vt - 0.06) / (1 - vt - 0.06)
            y = front_y - 0.006
            z = top_z - s * L_front * (1 + 0.04 * math.sin(u * 7 + seed))
            a = s
        gather = 1 - 0.1 * (1 - a)
        n = nz((x, 0, z), seed, 4.0)
        fold = (0.012 + 0.02 * a) * (math.sin(u * 19 + seed + 2 * n.x) + 0.4 * math.sin(u * 43 + seed * 0.3))
        return (x * gather, y - abs(fold) * (0.4 + a), z + n.z * 0.004 * a)
    part.add_grid(30, ny, f, mat, uv_size=(w, L_front + tail))


@prop('mirror_crepe', budget=7000)
def mirror_crepe(p, rng):
    """Mirror draped in black crepe. style: pier (2.1 m floor-standing pier glass with a marble-topped base),
    overmantel (sits on the mantel shelf), washstand (hung above the washstand). ORIGIN = base centre at the wall."""
    style = p.get('style', 'pier')
    fmat = p.get('frameMat', 'wood_furniture_dark')
    part = Part('mirror_crepe', rng)
    if style == 'pier':
        H = float(p.get('height', 2.1))
        W = 0.72
        part.add(box(W + 0.08, 0.3, 0.06, 0.012, 3, base=True), fmat, T((0, -0.15 + 0.02, 0)))
        for sx in (-1, 1):
            part.add(lathe([(0, 0), (0.028, 0), (0.024, 0.08), (0.03, 0.2), (0.022, 0.3), (0.028, 0.33), (0, 0.34)],
                           n=24), fmat, T((sx * (W / 2 - 0.02), -0.24, 0.06)))
        part.add(box(W + 0.1, 0.3, 0.03, 0.01, 3, base=True), 'enamel_chipped', T((0, -0.13, 0.4)))
        z0, z1 = 0.46, H - 0.12
    elif style == 'overmantel':
        W = 0.95
        z0, z1 = 0.0, 0.82
    else:
        W = 0.46
        z0, z1 = 0.0, 0.58
    fw = 0.07 if style != 'washstand' else 0.045
    ow, oh = W - 2 * fw, (z1 - z0) - 2 * fw
    zc = (z0 + z1) / 2
    sec = [(-x, -y) for x, y in frame_section(fw, 0.035)]
    rect = [(-ow / 2, 0, -oh / 2), (-ow / 2, 0, oh / 2), (ow / 2, 0, oh / 2), (ow / 2, 0, -oh / 2)]
    part.add(tube(rect, 0.01, section=sec, closed=True), fmat, T((0, -0.02, zc)))
    part.add(box(ow + 0.02, 0.02, oh + 0.02, 0.001, 1), fmat, T((0, -0.008, zc)))
    part.add(box(ow + 0.01, 0.004, oh + 0.01, 0.0005, 1), 'glass_grimy', T((0, -0.02, zc)))
    if style == 'pier':   # carved crest
        crest = [(-W / 2, 0), (W / 2, 0), (W / 2 - 0.05, 0.06), (0.12, 0.08), (0, 0.14), (-0.12, 0.08), (-W / 2 + 0.05, 0.06)]
        part.add(extrude(crest, 0.03, 0.006, 2), fmat, T((0, -0.005, z1), (math.pi / 2, 0, 0)))
        top = z1 + 0.14
    else:
        top = z1
    drop = (z1 - z0) * (0.92 if style != 'pier' else 0.8)
    crepe_drape(part, rng, W + 0.04, top - 0.01, top - drop, -0.06, 0.06, p.get('mat', 'crepe_black') + '@2s')
    if style == 'overmantel':
        part.apply(T((0, 0, 0), (math.radians(-6), 0, 0)), ground=True)
    return [part]


@prop('nightstand', budget=5000)
def nightstand(p, rng):
    """Bedside cabinet: overhanging top, one drawer, a panelled cupboard door (child, hinged), tapered legs."""
    mat = p.get('mat', 'wood_furniture_dark')
    part = Part('nightstand', rng)
    W, D, H = 0.44, 0.36, 0.66
    part.add(box(W + 0.03, D + 0.025, 0.022, 0.005, 3, base=True), mat, T((0, 0, H - 0.022)))
    cz0 = 0.14
    ch = H - 0.022 - cz0
    part.add(box(W, D, ch, 0.003, 1, base=True), mat, T((0, 0.004, cz0)))
    for sx in (-1, 1):
        for sy in (-1, 1):
            part.add(lathe(turned_leg(cz0 + 0.02, 0.04, 0.013, 0.02, style=1), n=24), mat,
                     T((sx * (W / 2 - 0.025), sy * (D / 2 - 0.025), 0)))
    drawer = Part('nightstand.drawer', rng)
    drawer.add(box(W - 0.04, 0.02, 0.1, 0.003, 2, base=True), mat)
    drawer.add(lathe([(0, 0), (0.007, 0), (0.012, 0.012), (0.009, 0.02), (0, 0.021)], n=24), mat,
               T((0, -0.01, 0.05), (math.pi / 2, 0, 0)))
    drawer.add(box(W - 0.07, D - 0.06, 0.085, 0.0015, 1, base=True), mat, T((0, (D - 0.06) / 2, 0.008)))   # box sides
    anchor(drawer, 'wear_handle', (0, -0.02, 0.05), {'r': 0.03})
    grime(drawer, [(9, 54, (0, -0.0105, 0.05), (0, 0, 0), 0.06, 0.05)])                # finger smudge
    drawer.extras = {'part': 'drawer', 'slide': [0, -1, 0], 'travel_m': 0.22}
    part.children.append((drawer, T((0, -D / 2 - 0.006, H - 0.022 - 0.12))))
    door = Part('nightstand.door', rng)
    dh = ch - 0.15
    door.add(box(W - 0.04, 0.02, dh, 0.003, 2), mat, T(((W - 0.04) / 2, -0.01, dh / 2)))
    door.add(box(W - 0.12, 0.012, dh - 0.09, 0.006, 2), mat, T(((W - 0.04) / 2, -0.021, dh / 2)))
    door.add(lathe([(0, 0), (0.0065, 0), (0.0045, 0.006), (0.011, 0.014), (0.0095, 0.02), (0, 0.0215)], n=24), mat,
             T((W - 0.08, -0.02, dh * 0.6), (math.pi / 2, 0, 0)))
    plate, hole = escutcheon(0.04, 0.018)                       # keyhole plate below the knob (brass, 40 x 18 mm)
    door.add(plate, 'brass_tarnished', T((W - 0.08, -0.0206, dh * 0.6 - 0.045)))
    door.add(hole, 'crepe_black', T((W - 0.08, -0.0206, dh * 0.6 - 0.045)))
    for zf in (0.12, 0.88):                                     # 2 x 2.5" butt hinges: door leaf rides with the door
        door.add(hinge_butt(0.064, 0.05, leaves=(1,), barrel=False), 'brass_tarnished', T((0.0, -0.0206, dh * zf)))
        part.add(hinge_butt(0.064, 0.05, leaves=(-1,)), 'brass_tarnished',
                 T((-(W - 0.04) / 2, -D / 2 - 0.0216, cz0 + 0.015 + dh * zf)))
    anchor(door, 'wear_handle', (W - 0.08, -0.03, dh * 0.6), {'r': 0.035})
    grime(door, [(9, 71, (W - 0.08, -0.0211, dh * 0.6), (0, 0, 0), 0.07, 0.06)])     # finger smudge
    grime(part, [(0, 88, (0.09, -0.05, H), (-math.pi / 2, 0, 0), 0.08, 0.08)])          # glass ring
    door.extras = {'part': 'door', 'hinge_axis': [0, 0, 1]}
    part.children.append((door, T((-(W - 0.04) / 2, -D / 2 - 0.001, cz0 + 0.015))))
    part.jitter(0.0008, freq=3.0, zmin=0.001)
    return [part]


@prop('washstand', budget=8000)
def washstand(p, rng):
    """Victorian washstand: splashback gallery, towel rails, two cupboard doors, enamel bowl and jug on top."""
    mat = p.get('mat', 'wood_furniture_dark')
    bowl_mat = p.get('bowlMat', 'enamel_chipped')
    part = Part('washstand', rng)
    W, D, H = 0.84, 0.44, 0.78
    part.add(box(W + 0.03, D + 0.02, 0.025, 0.006, 3, base=True), mat, T((0, 0, H - 0.025)))
    part.add(box(W + 0.03, 0.022, 0.16, 0.005, 2, base=True), mat, T((0, D / 2 - 0.011, H)))
    for sx in (-1, 1):
        part.add(extrude([(0, 0), (0.14, 0), (0.0, 0.16)], 0.022, 0.004, 2), mat,
                 T((sx * (W / 2 + 0.004), D / 2 - 0.13, H), (math.pi / 2, 0, -math.pi / 2)))
    part.add(box(W, D - 0.02, H - 0.1, 0.003, 1, base=True), mat, T((0, 0.01, 0.08)))
    part.add(box(W + 0.01, D, 0.08, 0.004, 2, base=True), mat, T((0, 0.0, 0.0)))
    for sx in (-1, 1):
        part.add(tube([(sx * (W / 2 + 0.01), -0.12, H - 0.12), (sx * (W / 2 + 0.05), -0.12, H - 0.12),
                       (sx * (W / 2 + 0.05), 0.12, H - 0.12), (sx * (W / 2 + 0.01), 0.12, H - 0.12)], 0.007, sides=16),
                 mat)
        door = Part(f'washstand.door_{"l" if sx < 0 else "r"}', rng)
        dw = W / 2 - 0.03
        dh = H - 0.2
        door.add(box(dw, 0.02, dh, 0.003, 2), mat, T((-sx * dw / 2, -0.01, dh / 2)))
        door.add(box(dw - 0.08, 0.012, dh - 0.09, 0.008, 2), mat, T((-sx * dw / 2, -0.021, dh / 2)))
        door.add(sphere(0.01, 10, 6), mat, T((-sx * (dw - 0.035), -0.03, dh * 0.55)))
        door.extras = {'part': 'door', 'hinge_axis': [0, 0, 1]}
        part.children.append((door, T((sx * (W / 2 - 0.015), -D / 2 - 0.001, 0.1))))
    bowl = [(0, 0), (0.06, 0), (0.065, 0.008), (0.1, 0.03), (0.15, 0.075), (0.165, 0.09), (0.168, 0.097),
            (0.16, 0.096), (0.14, 0.078), (0.09, 0.034), (0.058, 0.012), (0, 0.01)]
    part.add(lathe(bowl, n=32), bowl_mat, T((-0.05, -0.02, H)))
    jug = [(0, 0), (0.06, 0), (0.07, 0.01), (0.085, 0.07), (0.08, 0.13), (0.06, 0.2), (0.058, 0.23), (0.07, 0.26),
           (0.066, 0.265), (0.052, 0.235), (0.054, 0.2), (0.074, 0.13), (0.078, 0.07), (0.064, 0.012), (0, 0.01)]
    part.add(lathe(jug, n=28), bowl_mat, T((-0.05, -0.02, H + 0.012)))
    part.add(tube(fillet([(-0.05 - 0.078, -0.02, H + 0.2), (-0.05 - 0.14, -0.02, H + 0.2), (-0.05 - 0.14, -0.02, H + 0.1),
                          (-0.05 - 0.084, -0.02, H + 0.07)], 0.04, 4), 0.011, section=rect_section(0.022, 0.01, 0.004)),
             bowl_mat)
    part.jitter(0.0008, freq=3.0, zmin=0.001)
    return [part]


@prop('kitchen_table', budget=5000)
def kitchen_table(p, rng):
    """Farmhouse kitchen table: scrubbed 3-board top, deep apron with a cutlery drawer, tapered square legs."""
    L, W = float(p.get('length', 1.3)), float(p.get('width', 0.8))
    H = 0.78
    mat = p.get('mat', 'wood_raw_plank')
    part = Part('kitchen_table', rng)
    plank_top(part, rng, L, W, 0.028, 3, mat, H - 0.028, gap=0.002)
    lx, ly = L / 2 - 0.08, W / 2 - 0.07
    for sx in (-1, 1):
        for sy in (-1, 1):
            leg = box(0.055, 0.055, H - 0.028, 0.004, 2, cuts={2: 2}, base=True)
            for v in leg.verts:   # taper the inside faces below the apron
                if v.co.z < H - 0.16:
                    k = 1 - 0.35 * (1 - v.co.z / (H - 0.16))
                    v.co.x = (v.co.x + sx * 0.0275) * k - sx * 0.0275
                    v.co.y = (v.co.y + sy * 0.0275) * k - sy * 0.0275
            part.add(leg, mat, T((sx * lx, sy * ly, 0)))
    za = H - 0.028 - 0.12
    part.add(box(2 * lx, 0.022, 0.12, 0.003, 1, base=True), mat, T((0, ly, za)))
    for sx in (-1, 1):
        part.add(box(0.022, 2 * ly, 0.12, 0.003, 1, base=True), mat, T((sx * lx, 0, za)))
    part.add(box(2 * lx, 0.022, 0.12, 0.003, 1, base=True), mat, T((0, -ly, za)))
    part.add(box(0.36, 0.006, 0.08, 0.002, 1), mat, T((0.15, -ly - 0.014, za + 0.06)))
    part.add(lathe([(0, 0), (0.008, 0), (0.012, 0.012), (0.009, 0.02), (0, 0.021)], n=24), mat,
             T((0.15, -ly - 0.016, za + 0.06), (math.pi / 2, 0, 0)))
    part.jitter(0.001, freq=2.0, zmin=0.001)
    return [part]


def _ladder_chair(part, rng, mat, seat='plank'):
    """Country ladder/spindle-back side chair (seat 0.45 high)."""
    ys = 0.45
    W, D = 0.42, 0.4
    for sx in (-1, 1):
        part.add(tube([(sx * W / 2 * 0.95, -D / 2 + 0.02, 0), (sx * W / 2 * 0.92, -D / 2 + 0.03, ys)], 0.016, sides=10,
                      radii=[0.85, 1.0]), mat)
        part.add(tube([(sx * W / 2 * 0.92, D / 2 - 0.02, 0), (sx * W / 2 * 0.9, D / 2 - 0.01, ys),
                       (sx * W / 2 * 0.86, D / 2 + 0.06, 0.95)], 0.017, sides=10, radii=[0.9, 1.0, 0.85]), mat)
        part.add(tube([(sx * W / 2 * 0.93, -D / 2 + 0.03, 0.16), (sx * W / 2 * 0.91, D / 2 - 0.015, 0.16)], 0.009,
                      sides=12), mat)
    part.add(tube([(-W / 2 * 0.95, -D / 2 + 0.025, 0.2), (W / 2 * 0.95, -D / 2 + 0.025, 0.2)], 0.009, sides=12), mat)
    part.add(tube([(-W / 2 * 0.9, D / 2 - 0.015, 0.2), (W / 2 * 0.9, D / 2 - 0.015, 0.2)], 0.009, sides=12), mat)
    for z, yy in ((0.62, D / 2 + 0.018), (0.76, D / 2 + 0.035), (0.9, D / 2 + 0.052)):
        slat = box(W * 0.84, 0.014, 0.06, 0.005, 2, cuts={0: 4})
        for v in slat.verts:
            v.co.y += 0.02 * (2 * v.co.x / (W * 0.84)) ** 2
        part.add(slat, mat, T((0, yy, z)))
    st = box(W + 0.02, D + 0.02, 0.028, 0.008, 3, cuts={0: 3, 1: 3}, base=True)
    for v in st.verts:
        if v.co.z > 0.02:
            v.co.z -= 0.005 * (1 - (2 * v.co.x / W) ** 2)
    part.add(st, mat, T((0, 0.0, ys)))


@prop('kitchen_chair', budget=5000)
def kitchen_chair(p, rng):
    """Ladder-back kitchen chair; tipped=true lies on its back where it fell."""
    part = Part('kitchen_chair', rng)
    _ladder_chair(part, rng, p.get('mat', 'wood_furniture_dark'))
    part.jitter(0.001, freq=2.5)
    if p.get('tipped'):
        part.apply(T((0, 0, 0), (math.radians(-78), 0, math.radians(rng.j(8)))), ground=True)
        part.extras['tipped'] = True
    return [part]


@prop('chair_sacks', budget=8000)
def chair_sacks(p, rng):
    """Harlan's chair with spare feed sacks slung over the back, a ball of twine and scissors on the seat."""
    from .textiles import drape
    part = Part('chair_sacks', rng)
    _ladder_chair(part, rng, p.get('mat', 'wood_furniture_dark'))
    sack = p.get('sackMat', 'burlap_sack') + '@2s'
    for k in range(3):
        off = rng.j(0.03)
        part.add_grid(14, 20, lambda u, v, k=k, off=off: (
            (u - 0.5) * 0.46 + off,
            0.24 + 0.05 * math.sin(v * math.pi) + (0.03 - (v - 0.5) * 0.3 if v > 0.5 else -0.03 + (0.5 - v) * 0.25) * 1.0
            + k * 0.008,
            0.97 + k * 0.006 - abs(v - 0.5) * 0.9 + 0.02 * math.sin(u * 13 + k) * abs(v - 0.5)), sack,
            uv_size=(0.5, 0.9))
    if p.get('twine', True):
        part.add(sphere(0.045, 12, 8), sack.replace('@2s', ''), T((0.08, -0.05, 0.52), (0, 0, 0), (1, 1, 0.8)))
    if p.get('scissors', True):
        from .small_items import shears_parts
        shears_parts(part, rng, T((-0.09, -0.06, 0.492), (0, 0, 0.6)), 'steel_forged', 'cast_iron')
    return [part]


@prop('iron_bed', budget=15000)
def iron_bed(p, rng):
    """Cast/wrought iron double bed: tube posts with ball finials, arched top rails, spindles, angle-iron side
    rails, ticking mattress with a slumped middle, a grey wool blanket, one pillow. Head at +y."""
    W, L = float(p.get('width', 1.4)), float(p.get('length', 2.0))
    mat = p.get('mat', 'cast_iron')
    part = Part('iron_bed', rng)
    r = 0.019
    for yend, H in ((L / 2, 1.25), (-L / 2, 0.95)):
        for sx in (-1, 1):
            part.add(cyl(r, H, n=24, bevel_w=0.004), mat, T((sx * W / 2, yend, 0)))
            part.add(sphere(0.03, 12, 8), mat, T((sx * W / 2, yend, H + 0.02)))
            part.add(lathe([(0.021, 0), (0.026, 0.01), (0.021, 0.02)], n=12, closed=True), mat,
                     T((sx * W / 2, yend, H - 0.12)))
        top = [(x, yend, H - 0.14 + 0.1 * (1 - (2 * x / W) ** 2)) for x in [(-W / 2 + W * k / 12) for k in range(13)]]
        part.add(tube(top, 0.013, sides=16), mat)
        part.add(tube([(-W / 2, yend, 0.36), (W / 2, yend, 0.36)], 0.013, sides=16), mat)
        n = 9
        for k in range(1, n):
            x = -W / 2 + W * k / n
            zt = H - 0.14 + 0.1 * (1 - (2 * x / W) ** 2)
            part.add(tube([(x, yend, 0.36), (x, yend, zt)], 0.0065, sides=12), mat)
        for sx in (-1, 1):   # scroll detail
            sc = [(sx * (W / 2 - 0.02 - 0.08 * (1 - math.cos(a)) * 0.5), yend,
                   0.6 + 0.12 * math.sin(a)) for a in [math.pi * k / 10 for k in range(11)]]
            part.add(tube(sc, 0.006, sides=12), mat)
    for sx in (-1, 1):
        part.add(tube([(sx * W / 2, -L / 2, 0.33), (sx * W / 2, L / 2, 0.33)], 0.02,
                      section=[(0, 0), (0.035, 0), (0.035, 0.004), (0.004, 0.004), (0.004, 0.035), (0, 0.035)]), mat,
                 T((0, 0, 0), (0, 0, 0)))
    mt = 0.18
    mz = 0.36
    mw, ml = W - 0.06, L - 0.06

    def mattress(u, v, top=True):
        x, y = (u - 0.5) * mw, (v - 0.5) * ml
        ex = min(1.0, (mw / 2 - abs(x)) / 0.05)
        ey = min(1.0, (ml / 2 - abs(y)) / 0.05)
        crown = math.sqrt(max(0.0, ex)) * math.sqrt(max(0.0, ey))
        slump = 0.035 * (1 - (2 * x / mw) ** 2) * (1 - (2 * y / ml) ** 2)
        return (x, y, mz + mt * (0.75 + 0.25 * crown) - slump if top else mz)
    mat_m = p.get('mattressMat', 'ticking_mattress')
    mb = box(mw, ml, mt, 0.05, 3, cuts={0: 6, 1: 8}, base=True)
    for v in mb.verts:
        v.co.z -= 0.035 * (1 - (2 * v.co.x / mw) ** 2) * (1 - (2 * v.co.y / ml) ** 2) * (v.co.z / mt)
    jitter(mb, 0.004, freq=4.0, seed=rng.randint(0, 999))
    part.add(mb, mat_m, T((0, 0, mz)))
    from .textiles import drape
    bl = p.get('blanketMat', 'wool_coats') + '@2s'
    top_h = lambda x, y: mz + mt - 0.035 * (1 - (2 * x / mw) ** 2) * (1 - (2 * y / ml) ** 2) + 0.004
    seed = rng.randint(0, 99)
    part.add_grid(34, 34, lambda u, v: (lambda q: (q[0], q[1] - 0.2, q[2]))(
        drape(u, v, mw + 0.5, ml * 0.72, mw, ml * 0.72, top_h, mz - 0.1, (0, 0), seed, 1.0, 0.04, 0.03)), bl,
        uv_size=(mw + 0.5, ml * 0.72))
    pil = box(0.6, 0.38, 0.12, 0.05, 3, cuts={0: 4, 1: 3}, base=True)
    for v in pil.verts:
        v.co.z *= 0.6 + 0.4 * (1 - (2 * v.co.x / 0.6) ** 2)
    part.add(pil, mat_m, T((rng.j(0.1), ml / 2 - 0.25, mz + mt - 0.02), (0, 0, rng.j(0.08))))
    return [part]
