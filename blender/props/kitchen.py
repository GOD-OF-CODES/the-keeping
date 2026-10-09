"""Kitchen: cast-iron wood range with its stovepipe, the pump sink (pitcher pump, enamel basin, tiled splashback),
the wall can shelf."""
import math

from mathutils import Vector

from .kit import (Part, T, anchor, box, cyl, extrude, fillet, grime, jitter, lathe, nail_head, prop, rect_section, screw_head, sphere, tube)


@prop('iron_stove', budget=16000)
def iron_stove(p, rng):
    """Farm wood range (~1930s): cast body on short cabriole legs, 6 lidded cooking holes, oven door with an
    enamel panel, firebox door, nickel towel rail, high warming closet, stovepipe with damper rising to the flue."""
    mat = p.get('mat', 'cast_iron')
    enamel = p.get('doorMat', 'enamel_chipped')
    part = Part('iron_stove', rng)
    W, D, H = 1.05, 0.66, 0.8
    lh = 0.16
    for sx in (-1, 1):
        for sy in (-1, 1):
            leg = [(sx * (W / 2 - 0.06), sy * (D / 2 - 0.06), lh), (sx * (W / 2 - 0.04), sy * (D / 2 - 0.05), lh * 0.5),
                   (sx * (W / 2 - 0.02), sy * (D / 2 - 0.035), 0.02), (sx * (W / 2 - 0.0), sy * (D / 2 - 0.03), 0.0)]
            part.add(tube(fillet(leg, 0.04, 3), 0.024, sides=8, radii=[1.2, 0.8, 0.7, 1.1]), mat)
    part.add(box(W, D, H - lh - 0.05, 0.012, 2, cuts={0: 3}, base=True), mat, T((0, 0, lh)))
    top = box(W + 0.06, D + 0.04, 0.05, 0.01, 2, base=True)
    part.add(top, mat, T((0, 0, H - 0.05)))
    for i, x in enumerate((-0.3, 0.0, 0.3)):
        for y in (-0.13, 0.13):
            lid = lathe([(0, 0), (0.105, 0), (0.108, 0.006), (0.1, 0.01), (0.03, 0.012), (0.02, 0.018), (0, 0.018)], n=20)
            part.add(lid, mat, T((x, y, H - 0.004), (0, 0, rng.u(0, 6.28))))
    # oven door (right) with enamel panel, firebox door (left), ash drawer
    od = Part('iron_stove.oven_door', rng)
    od.add(box(0.5, 0.03, 0.42, 0.01, 2), mat, T((0.25, -0.015, 0)))
    # Round E (audit #5): a pillowed porcelain panel (≈ 3 mm crown, as fired enamel on pressed steel) in a cast bead
    # frame, held by 4 domed nickel screws; rust runs from the screws, oily finger grime by the handle.
    pn = box(0.36, 0.01, 0.28, 0.004, 2, cuts={0: 10, 2: 8})
    for v in pn.verts:
        if v.co.y < -0.004:
            ku = max(0.0, math.cos(math.pi * v.co.x / 0.36)) ** 0.6
            kv = max(0.0, math.cos(math.pi * v.co.z / 0.28)) ** 0.6
            v.co.y -= 0.003 * ku * kv
    od.add(pn, enamel, T((0.25, -0.034, 0)))
    rim = [(0.25 + x, -0.04, z) for x, z in ((0.0, -0.146), (0.186, -0.146), (0.186, 0.146), (-0.186, 0.146),
                                               (-0.186, -0.146), (0.0, -0.146))]
    od.add(tube(fillet(rim, 0.012, 3)[:-1], 0.006, sides=8, closed=True), mat)
    for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        od.add(lathe([(0.0045, 0.0), (0.0042, 0.0008), (0.003, 0.0016), (0.0, 0.0019)], n=12), 'chrome_pitted',
               T((0.25 + sx * 0.163, -0.039, sz * 0.123), (math.pi / 2, 0, 0)))
    grime(od, [(6, 300, (0.25 - 0.163, -0.0401, 0.123 - 0.045), (0, 0, 0), 0.012, 0.085),     # top screws: long runs
               (7, 301, (0.25 + 0.163, -0.0401, 0.123 - 0.035), (0, 0, 0), 0.011, 0.065),
               (6, 302, (0.25 - 0.163, -0.0401, -0.123 - 0.008), (0, 0, 0), 0.01, 0.018),     # bottom: short, to the rim
               (7, 303, (0.25 + 0.163, -0.0401, -0.123 - 0.008), (0, 0, 0), 0.01, 0.018),
               (9, 310, (0.47, -0.0303, 0.0), (0, 0, 0), 0.05, 0.13)])
    od.add(tube([(0.44, -0.05, -0.08), (0.44, -0.07, 0.0), (0.44, -0.05, 0.08)], 0.008, sides=8), 'chrome_pitted')
    od.extras = {'part': 'oven_door', 'hinge_axis': [0, 0, 1]}
    part.children.append((od, T((-0.05, -D / 2, lh + 0.32))))
    fd = Part('iron_stove.fire_door', rng)
    fd.add(box(0.3, 0.03, 0.2, 0.01, 2), mat, T((0.15, -0.015, 0)))
    for k in range(5):
        fd.add(box(0.012, 0.012, 0.12, 0.003, 1), mat, T((0.06 + k * 0.045, -0.032, 0)))
    anchor(fd, 'wear_soot', (0.15, -0.03, 0.1), {'r': 0.12, 'up': 0.15})    # smoke-blacked above the draft slots
    anchor(fd, 'wear_handle', (0.27, -0.035, 0.0), {'r': 0.05})              # latch side, opened with a poker/rag
    fd.extras = {'part': 'fire_door', 'hinge_axis': [0, 0, 1]}
    part.children.append((fd, T((-W / 2 + 0.05, -D / 2, lh + 0.42))))
    part.add(box(0.3, 0.03, 0.12, 0.008, 2), mat, T((-W / 2 + 0.2, -D / 2 - 0.01, lh + 0.14)))
    part.add(tube([(-W / 2 - 0.02, -D / 2 - 0.07, H - 0.12), (W / 2 + 0.02, -D / 2 - 0.07, H - 0.12)], 0.009, sides=16),
             'chrome_pitted')
    for sx in (-1, 1):
        part.add(tube([(sx * (W / 2 + 0.02), -D / 2 - 0.07, H - 0.12), (sx * (W / 2 - 0.02), -D / 2 + 0.01, H - 0.12)],
                      0.008, sides=12), 'chrome_pitted')
    # high back with warming closet
    part.add(box(W, 0.06, 0.55, 0.008, 2, base=True), mat, T((0, D / 2 - 0.03, H)))
    part.add(box(W, 0.3, 0.3, 0.01, 2, base=True), mat, T((0, D / 2 - 0.13, H + 0.55)))
    for sx in (-1, 1):
        part.add(tube(fillet([(sx * (W / 2 - 0.05), D / 2 - 0.03, H + 0.55), (sx * (W / 2 - 0.05), D / 2 - 0.2, H + 0.45),
                              (sx * (W / 2 - 0.05), D / 2 - 0.26, H + 0.55)], 0.04, 3), 0.008, sides=12), mat)
    part.add(box(W - 0.08, 0.01, 0.2, 0.004, 1), 'chrome_pitted', T((0, D / 2 - 0.28, H + 0.7)))
    # stovepipe with damper, up to the flue (runs to +y chimney)
    px, py = 0.3, D / 2 - 0.2
    pipe = [(px, py, H + 0.85), (px, py, 2.35), (px, py + 0.45, 2.5)]
    part.add(tube(fillet(pipe, 0.12, 5), 0.075, sides=16), mat)
    part.add(cyl(0.08, 0.02, n=16), mat, T((px, py, H + 1.4)))
    part.add(tube([(px - 0.11, py, H + 1.3), (px + 0.1, py, H + 1.3)], 0.004, sides=12), mat)
    part.jitter(0.001, freq=2.0, zmin=0.001)
    part.extras['cold'] = bool(p.get('cold', True))
    return [part]


@prop('pump_sink', budget=9000)
def pump_sink(p, rng):
    """Dry-sink cabinet with a chipped enamel basin, a cast-iron pitcher pump on the drainboard and a tiled
    splashback. Front -y, wall +y."""
    enamel = p.get('mat', 'enamel_chipped')
    pm = p.get('pumpMat', 'cast_iron')
    tile = p.get('splashbackMat', 'tile_kitchen')
    part = Part('pump_sink', rng)
    W, D, H = 1.1, 0.55, 0.84
    part.add(box(W, D - 0.02, H - 0.1, 0.004, 2, base=True), 'wood_raw_plank', T((0, 0.01, 0.08)))
    part.add(box(W + 0.02, D, 0.08, 0.004, 2, base=True), 'wood_raw_plank', T((0, 0, 0)))
    for sx in (-1, 1):
        d = Part(f'pump_sink.door_{"l" if sx < 0 else "r"}', rng)
        dw = W / 2 - 0.04
        d.add(box(dw, 0.02, H - 0.24, 0.003, 2), 'wood_raw_plank', T((-sx * dw / 2, -0.01, (H - 0.24) / 2)))
        for k in range(5):
            d.add(box(0.006, 0.004, H - 0.3, 0.001, 1), 'wood_raw_plank', T((-sx * dw * (k + 1) / 6, -0.021, (H - 0.24) / 2)))
        d.add(tube([(-sx * (dw - 0.04), -0.03, 0.3), (-sx * (dw - 0.04), -0.03, 0.4)], 0.006, sides=12), 'cast_iron')
        d.extras = {'part': 'door', 'hinge_axis': [0, 0, 1]}
        part.children.append((d, T((sx * (W / 2 - 0.02), -D / 2 - 0.001, 0.12))))
    # counter + basin
    part.add(box(W + 0.04, D + 0.02, 0.03, 0.005, 2, base=True), 'wood_raw_plank', T((0, 0, H - 0.03)))
    bw, bd, bh = 0.62, 0.42, 0.14
    basin = box(bw, bd, bh, 0.02, 3, base=True)
    part.add(basin, enamel, T((-0.18, -0.02, H - bh + 0.03)))
    rim = [(-bw / 2, -bd / 2, 0), (bw / 2, -bd / 2, 0), (bw / 2, bd / 2, 0), (-bw / 2, bd / 2, 0)]
    part.add(tube(rim, 0.012, sides=8, closed=True), enamel, T((-0.18, -0.02, H + 0.035)))
    part.add(box(bw - 0.03, bd - 0.03, 0.002, 0.001, 1), 'glass_grimy', T((-0.18, -0.02, H + 0.03)))
    # pitcher pump on the drainboard
    pz = H + 0.03
    body = [(0, 0), (0.06, 0), (0.065, 0.02), (0.05, 0.04), (0.045, 0.2), (0.055, 0.22), (0.06, 0.26), (0.052, 0.28),
            (0, 0.28)]
    part.add(lathe(body, n=20), pm, T((0.3, 0.08, pz)))
    spout = [(0.3, 0.08, pz + 0.23), (0.3, -0.05, pz + 0.24), (0.3, -0.12, pz + 0.2), (0.3, -0.14, pz + 0.17)]
    part.add(tube(spout, 0.02, sides=10, radii=[1.4, 1.1, 1.0, 1.05]), pm)
    handle = Part('pump_sink.handle', rng)
    handle.add(tube([(0, 0, 0), (0, 0.12, 0.08), (0, 0.32, 0.1)], 0.01, sides=8, radii=[1.4, 1.0, 0.8]), pm)
    handle.add(sphere(0.016, 8, 6), pm, T((0, 0.33, 0.1)))
    handle.extras = {'part': 'handle', 'pivot_at': 'fulcrum', 'rotate_axis': [1, 0, 0]}
    part.children.append((handle, T((0.3, 0.12, pz + 0.3))))
    part.add(tube([(0.3, 0.14, pz + 0.26), (0.3, 0.14, pz + 0.32)], 0.012, sides=12), pm)
    # tiled splashback on the wall: 15 cm tiles, a few cracked/misaligned
    ts = 0.15
    for i in range(int(W / ts)):
        for j in range(4):
            t = box(ts - 0.004, 0.008, ts - 0.004, 0.0015, 1)
            part.add(t, tile, T((-W / 2 + ts * (i + 0.5), D / 2 - 0.004, H + 0.03 + ts * (j + 0.5)),
                                (rng.j(0.006), 0, rng.j(0.006))))
    part.add(box(W, 0.004, ts * 4, 0.001, 1, base=True), 'plaster_damp', T((0, D / 2 - 0.0005, H + 0.03)))
    part.jitter(0.0008, freq=2.0, zmin=0.001)
    part.extras['drips'] = bool(p.get('drips', False))
    return [part]


@prop('can_shelf', budget=13500)   # 8000 -> 13500: 24-seg cans/jars at 1 m, bracket screws, nail heads (PROPS-FINISH #24)
def can_shelf(p, rng):
    """Two wall shelves on iron brackets with tin cans, mason jars and a coil of wire. ORIGIN = floor-level centre
    on the wall; shelves at 1.1 and 1.45 m project -y."""
    L = float(p.get('length', 2.5))
    mat = p.get('mat', 'wood_raw_plank')
    part = Part('can_shelf', rng)
    for z in (1.1, 1.45):
        sh = box(L, 0.24, 0.025, 0.004, 2, cuts={0: 6}, base=True)
        for v in sh.verts:
            v.co.z -= 0.006 * (1 - (2 * v.co.x / L) ** 2)
        part.add(sh, mat, T((0, -0.12, z)))
        for x in (-L / 2 + 0.15, 0.0, L / 2 - 0.15):
            br = [(x, 0, z - 0.2), (x, 0, z), (x, -0.2, z)]
            part.add(tube(br, 0.01, section=rect_section(0.006, 0.03, 0.001)), 'cast_iron')
            part.add(tube([(x, -0.005, z - 0.17), (x, -0.17, z - 0.005)], 0.004, section=rect_section(0.005, 0.02)),
                     'cast_iron')
            for zs in (z - 0.06, z - 0.15):     # two #10 wood screws into the stud per bracket
                part.add(screw_head(0.0095), 'cast_iron', T((x, -0.003, zs), (math.pi / 2, 0, rng.u(0, 3.1))))
        for sx in (-1, 1):                       # cut nails through the plank into the end brackets
            for yy in (-0.06, -0.18):
                part.add(nail_head(0.005), 'rust', T((sx * (L / 2 - 0.15) + rng.j(0.01), yy, z + 0.025 - 0.006 * 0.1)))
        x = -L / 2 + 0.1
        while x < L / 2 - 0.1:
            kind = rng.random()
            if kind < 0.45:
                h, r = rng.u(0.1, 0.13), rng.u(0.035, 0.045)
                part.add(lathe([(0, 0), (r, 0), (r + 0.002, 0.004), (r, 0.01), (r, h - 0.01), (r + 0.002, h - 0.004),
                                (r, h), (0, h)], n=24), 'zinc_galvanized' if rng.chance(0.6) else 'rust',
                         T((x, -0.12 + rng.j(0.04), z + 0.02)))
                x += 2 * r + rng.u(0.01, 0.06)
            elif kind < 0.75:
                h, r = 0.17, 0.04
                part.add(lathe([(0, 0), (r, 0), (r, h * 0.8), (r * 0.8, h * 0.88), (r * 0.8, h), (0, h)], n=24),
                         'glass_grimy', T((x, -0.12 + rng.j(0.04), z + 0.02)))
                part.add(cyl(r * 0.85, 0.015, n=24), 'zinc_galvanized', T((x, -0.12, z + 0.02 + h)))
                x += 2 * r + rng.u(0.02, 0.08)
            else:
                x += rng.u(0.1, 0.3)
    return [part]
