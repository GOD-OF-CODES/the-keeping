"""Roadside signage: STROUD'S GAS & FEED sign post (+ ROOMS board), VACANCY plate, sign lantern mount, mailbox,
1950s gas pump, NEXT SERVICES road card, reflector posts. Lettering is a runtime decal (extras.decal/text)."""
import math

from mathutils import Vector

from .kit import (Part, T, anchor, bisect, box, cyl, decal, extrude, fillet, grime, jitter, lathe, plane, prop,
                  rect_section, sag, sphere, tube, rot_to)


def plank_board(part, rng, w, h, t, mat, n_planks, m, gap=0.004, warp=0.004):
    """Board made of horizontal planks (lying in XZ, front face towards -y), each with its own cup/warp/twist."""
    ph = (h - gap * (n_planks - 1)) / n_planks
    for i in range(n_planks):
        z = -h / 2 + ph / 2 + i * (ph + gap)
        bm = box(w + rng.j(0.01), t, ph + rng.j(0.004), bevel_w=0.003, segs=2, cuts={0: 8})
        k = rng.j(warp)
        tw = rng.j(0.02)
        for v in bm.verts:
            xx = v.co.x / (w / 2)
            v.co.y += k * (1 - xx * xx) + tw * v.co.z * xx
        jitter(bm, 0.0015, freq=5.0, seed=rng.randint(0, 9999))
        part.add(bm, mat, m @ T((rng.j(0.004), 0, z)))


def bolt_head(part, mat, m, r=0.011):
    part.add(lathe([(0, 0), (r, 0), (r * 0.95, r * 0.25), (r * 0.6, r * 0.5), (0, r * 0.56)], n=10), mat, m)


@prop('sign_post', instance_keys=('text',), budget=9000)
def sign_post(p, rng):
    """Square cedar post, weathered pyramid cap, 4-plank sign bolted on two battens, a hand-lettered ROOMS board
    hung beneath on S-hooks, an iron lantern shelf bracket and a flat-bar VACANCY arm."""
    mat = p.get('mat', 'wood_raw_plank')
    part = Part('sign_post', rng)
    ps, ph = 0.14, 3.75
    post = box(ps, ps, ph + 0.5, 0.006, 2, cuts={2: 10}, center=(0, 0, (ph - 0.5) / 2))
    lean = (rng.j(0.012), rng.j(0.012))
    for v in post.verts:
        f = max(0.0, v.co.z) / ph
        v.co.x += lean[0] * f
        v.co.y += lean[1] * f
    jitter(post, 0.003, freq=1.5, seed=rng.randint(0, 999))
    part.add(post, mat)
    cap = lathe([(0, 0), (0.1, 0), (0.001, 0.05)], n=4)
    part.add(cap, mat, T((lean[0], lean[1], ph + 0.001), (0, 0, math.pi / 4), (ps * 0.72, ps * 0.72, 1)))
    # main sign
    sw, sh, st = 2.2, 0.78, 0.024
    zc = 3.0
    yb = -ps / 2 - 0.03        # battens in front of the post
    for bx in (-0.55, 0.55):
        part.add(box(0.07, 0.03, sh + 0.06, 0.004, 2), mat, T((bx * 0.001 + bx, yb + 0.015, zc)))
    part.add(box(0.5, 0.03, 0.09, 0.004, 2), mat, T((0, -ps / 2 - 0.015, zc + 0.2)))
    part.add(box(0.5, 0.03, 0.09, 0.004, 2), mat, T((0, -ps / 2 - 0.015, zc - 0.2)))
    face_y = yb - st / 2
    plank_board(part, rng, sw, sh, st, mat, 4, T((0, face_y, zc)))
    runs = []
    for bx in (-0.55, 0.55):     # 3/8" carriage bolts through each plank into the battens (Ø 22 mm domes), rust-streaked
        for k in range(4):
            zb = zc + (k - 1.5) * sh / 4 + rng.j(0.01)
            xb = bx + rng.j(0.008)
            part.add(lathe([(0.011, 0.0), (0.0095, 0.003), (0.006, 0.0052), (0.0, 0.006)], n=16), 'rust',
                     T((xb, face_y - st / 2 + 0.0005, zb), (math.pi / 2, 0, 0)))
            # Round E (audit #5): rust run under each bolt, 8–14 mm wide, down to the plank below (≤ one plank)
            ln = rng.u(0.1, sh / 4 + 0.02)
            runs.append((6 + (k + (bx > 0)) % 2, 400 + len(runs), (xb, face_y - st / 2 - 0.0045, zb - 0.006 - ln / 2),
                         (0, 0, 0), rng.u(0.008, 0.014), ln))
    grime(part, runs)
    # moulding frame round the sign face
    fy = face_y - st / 2 - 0.009
    for zz in (sh / 2 + 0.01, -sh / 2 - 0.01):
        part.add(box(sw + 0.06, 0.022, 0.04, 0.005, 2, cuts={0: 6}), mat, T((0, fy, zc + zz)))
    for xx in (sw / 2 + 0.01, -sw / 2 - 0.01):
        part.add(box(0.04, 0.022, sh, 0.005, 2), mat, T((xx, fy, zc)))
    for bx in (-0.55, 0.55):
        for dz in (-0.2, 0.2):
            bolt_head(part, 'rust', T((bx, face_y - st / 2 - 0.0005, zc + dz), (math.pi / 2, 0, 0)))
    d = decal(part, 'sign_post.face', sw - 0.06, sh - 0.06, T((0, face_y - st / 2 - 0.0035, zc)),
              p.get('text', "STROUD'S GAS & FEED"), style='sign_painted',
              extra={'paintedOut': 'GAS' if p.get('gasPaintedOut') else '', 'text_param': 'text'})
    # ROOMS board, hung on two S-hooks from eyes screwed into the bottom rail
    if p.get('board'):
        bw, bh = 0.92, 0.26
        zr = zc - sh / 2 - 0.06 - 0.09 - bh / 2
        board = Part('sign_post.rooms', rng)
        plank_board(board, rng, bw, bh, 0.02, mat, 1, T((0, 0, -0.09 - bh / 2)), warp=0.006)
        for sx in (-0.36, 0.36):
            hook = [(sx, 0, 0.0), (sx, 0, -0.03), (sx + 0.012, 0, -0.045), (sx, 0, -0.06), (sx - 0.01, 0, -0.07),
                    (sx, 0, -0.085)]
            board.add(tube(fillet(hook, 0.008, 3), 0.0028, sides=6), 'rust')
        decal(board, 'sign_post.rooms_face', bw - 0.04, bh - 0.04, T((0, -0.0115, -0.09 - bh / 2)), 'ROOMS',
              style='hand_lettered', extra={'text_param': 'board'})
        board.extras = {'part': 'rooms_board', 'pivot_at': 'hooks', 'swing_axis': [1, 0, 0]}
        board.origin = T((0, face_y, zc - sh / 2 - 0.035))
        part.children.append((board, None))
        for sx in (-0.36, 0.36):
            ring = [(sx + 0.009 * math.cos(a), 0, zc - sh / 2 - 0.03 + 0.009 * math.sin(a))
                    for a in [i * math.tau / 8 for i in range(8)]]
            part.add(tube(ring, 0.0022, sides=5, closed=True), 'rust', T((0, face_y, 0)))
    # lantern shelf bracket on the post's right face (+x), lantern box sits on it (separate prop sign_lantern)
    zl = 2.05
    br = [(ps / 2, -0.02, zl + 0.3), (ps / 2 + 0.06, -0.02, zl + 0.02), (ps / 2 + 0.26, -0.02, zl - 0.004)]
    part.add(tube(br, 0.01, section=rect_section(0.03, 0.006, 0.001)), 'rust')
    part.add(box(0.2, 0.18, 0.008, 0.002, 1), 'rust', T((ps / 2 + 0.16, -0.02, zl - 0.004)))
    anchor(part, 'sign_post.mount_lantern', (ps / 2 + 0.16, -0.02, zl), {'mount': 'sign_lantern'})
    # VACANCY arm: flat bar bolted to the front battens' left side, eye at the end
    if p.get('vacancyPlate', True):
        zv = 1.9
        arm = [(-0.02, -ps / 2 - 0.005, zv - 0.25), (-0.02, -ps / 2 - 0.005, zv), (-0.02, -ps / 2 - 0.5, zv)]
        part.add(tube(fillet(arm, 0.03, 3), 0.01, section=rect_section(0.006, 0.032, 0.001)), 'rust')
        part.add(tube(fillet([(-0.02, -ps / 2 - 0.2, zv), (-0.02, -ps / 2 - 0.005, zv - 0.2)], 0.0, 1), 0.006,
                      section=rect_section(0.005, 0.02, 0.001)), 'rust')
        anchor(part, 'sign_post.hang_vacancy', (-0.02, -ps / 2 - 0.46, zv - 0.016), {'mount': 'vacancy_plate'})
    part.extras['collider_hint'] = 'post'
    return [part]


@prop('vacancy_plate', instance_keys=('text',), budget=2000)
def vacancy_plate(p, rng):
    """Tin VACANCY plate with folded edges on two S-hooks. ORIGIN = the hang point (top of the hooks); it swings
    about local x (extras.swing_axis). Place it at sign_post's `hang_vacancy` anchor."""
    mat = p.get('mat', 'zinc_galvanized')
    part = Part('vacancy_plate', rng)
    w, h = 0.46, 0.15
    zt = -0.075
    plate = box(w, 0.0016, h, 0.0006, 1, cuts={0: 6, 2: 2})
    corner = rng.choice((-1, 1))
    for v in plate.verts:   # one bent-back corner and a soft oil-can bow
        cx = max(0.0, (v.co.x * corner - w / 2 + 0.07) / 0.07)
        cz = max(0.0, (-v.co.z - h / 2 + 0.05) / 0.05)
        v.co.y += 0.012 * cx * cz + 0.004 * (1 - (2 * v.co.x / w) ** 2)
    part.add(plate, mat, T((0, 0, zt - h / 2)))
    for zz in (zt, zt - h):   # folded hem top and bottom
        part.add(tube([(-w / 2, 0.001, zz), (w / 2, 0.001, zz)], 0.0022, sides=12), mat)
    for sx in (-0.17, 0.17):
        hook = [(sx, 0, 0.0), (sx + 0.012, 0, -0.012), (sx, 0, -0.03), (sx - 0.012, 0, -0.045), (sx, 0, -0.062),
                (sx, 0.002, zt + 0.01)]
        part.add(tube(fillet(hook, 0.008, 3), 0.0025, sides=12), 'rust')
        part.add(lathe([(0.0045, 0.0), (0.004, 0.0008), (0.0025, 0.0012), (0.0, 0.0012)], n=16), 'rust',
                 T((sx, -0.0009, zt - 0.012), (math.pi / 2, 0, 0)))          # punched-hole grommet the hook rides in
    part.add(tube([(-0.21, 0, 0.0), (0.21, 0, 0.0)], 0.004, sides=8), 'rust')   # hanger rod = the swing pivot
    decal(part, 'vacancy_plate.face', w - 0.03, h - 0.03, T((0, -0.0015, zt - h / 2)), p.get('text', 'VACANCY'),
          style='stencil', extra={'text_param': 'text'})
    grime(part, [(6 + k, 420 + k, (sx, -0.0022, zt - 0.012 - 0.04), (0, 0, 0), 0.011, 0.075)   # rust from the hook holes
                 for k, sx in enumerate((-0.17, 0.17))])
    part.extras.update({'pivot_at': 'hang_point', 'swing_axis': [1, 0, 0]})
    return [part]


def hurricane_lantern(part, rng, m, globe_mat='glass_grimy', metal='rust', lit=True):
    """Tubular 'barn' lantern (No. 2 size): fount, side tubes, globe, guard wires, vented top, bail. 0.33 m tall."""
    fount = [(0, 0), (0.07, 0), (0.074, 0.008), (0.072, 0.04), (0.06, 0.052), (0.04, 0.058), (0, 0.058)]
    part.add(lathe(fount, n=24), metal, m)
    globe = [(0.03, 0.065), (0.042, 0.075), (0.052, 0.11), (0.054, 0.14), (0.048, 0.175), (0.034, 0.195),
             (0.03, 0.2), (0.028, 0.2), (0.032, 0.195), (0.046, 0.175), (0.052, 0.14), (0.05, 0.11), (0.04, 0.076),
             (0.028, 0.066)]
    part.add(lathe(globe, n=20, closed=True), globe_mat, m)
    part.add(lathe([(0.02, 0.058), (0.036, 0.058), (0.036, 0.068), (0.02, 0.068)], n=16, closed=True), metal, m)
    top = [(0, 0.2), (0.04, 0.2), (0.058, 0.215), (0.06, 0.225), (0.045, 0.235), (0.03, 0.25), (0.032, 0.262),
           (0.022, 0.27), (0, 0.272)]
    part.add(lathe(top, n=20), metal, m)
    for s in (-1, 1):   # side air tubes
        pts = [(s * 0.07, 0, 0.045), (s * 0.085, 0, 0.08), (s * 0.085, 0, 0.19), (s * 0.06, 0, 0.225)]
        part.add(tube(fillet(pts, 0.015, 3), 0.006, sides=8), metal, m)
    for a in (math.pi / 2, -math.pi / 2):   # guard wires front/back
        pts = [(0.045 * math.cos(a), 0.045 * math.sin(a), 0.065), (0.07 * math.cos(a), 0.07 * math.sin(a), 0.14),
               (0.05 * math.cos(a), 0.05 * math.sin(a), 0.2)]
        part.add(tube(fillet(pts, 0.03, 4), 0.0018, sides=4), metal, m)
    bail = [(-0.085, 0, 0.2)] + [(0.085 * math.cos(math.pi * k / 10), 0, 0.2 + 0.11 * math.sin(math.pi * k / 10))
                                 for k in range(10, -1, -1)][1:] + [(0.085, 0, 0.2)]
    part.add(tube(bail[::-1], 0.002, sides=5), metal, m)
    if lit:
        anchor(part, part.name + '.flame', tuple(m @ Vector((0, 0, 0.11))), {'flame': True, 'kind': 'lantern'})


@prop('sign_lantern', budget=6000)
def sign_lantern(p, rng):
    """Galvanised lantern box (open front, peaked roof, cone vent) holding a tubular barn lantern. Base centre on
    the bracket shelf (sign_post `mount_lantern`)."""
    mat = p.get('mat', 'zinc_galvanized')
    part = Part('sign_lantern', rng)
    W, D, H = 0.26, 0.22, 0.4
    t = 0.0015
    part.add(box(W, D, t * 2, 0.0005, 1), mat, T((0, 0, t)))
    part.add(box(W, t, H, 0.0005, 1), mat, T((0, D / 2, H / 2)))
    for s in (-1, 1):
        side = box(t, D, H, 0.0005, 1, cuts={2: 3})
        jitter(side, 0.002, freq=8.0, seed=rng.randint(0, 999), axes=(1, 0, 0))
        part.add(side, mat, T((s * W / 2, 0, H / 2)))
        part.add(box(t * 2, D * 0.08, H, 0.0005, 1), mat, T((s * (W / 2 - 0.012), -D / 2 + 0.004, H / 2), (0, 0, s * 0.9)))
    for s in (-1, 1):   # peaked roof, overhanging
        part.add(box(W / 2 * 1.2 + 0.02, D + 0.05, t * 1.5, 0.0005, 1),
                 mat, T((s * W * 0.27, -0.01, H + 0.045), (0, s * 0.38, 0)))
    part.add(lathe([(0, 0), (0.03, 0), (0.03, 0.03), (0.055, 0.035), (0, 0.075)], n=12), mat,
             T((0, -0.01, H + 0.075)))
    for zz in (0.12, 0.3):   # rust streaks start at the rivet rows
        for x in (-W / 2 + 0.02, W / 2 - 0.02):
            part.add(sphere(0.003, 6, 4), 'rust', T((x, D / 2 - 0.002, zz)))
    hurricane_lantern(part, rng, T((0, 0.01, 0.003)), lit=bool(p.get('lit', True)))
    return [part]


@prop('gas_pump', instance_keys=('brand',), budget=12000)
def gas_pump(p, rng):
    """1950s computing pump (Tokheim/Wayne silhouette): rounded cabinet on a concrete island, chrome trim, price
    dial window, nozzle in its boot, hose, and a broken milk-glass globe."""
    mat = p.get('mat', 'rust')
    part = Part('gas_pump', rng)
    part.add(box(0.95, 0.7, 0.16, 0.025, 3, cuts={0: 3}), 'stone_foundation', T((0, 0, 0.08)))
    W, D, H = 0.52, 0.40, 1.46
    z0 = 0.16
    plan = rect_section(W, D, 0.085, 4)
    body = extrude(plan, H, bevel_w=0.006, segs=2)
    bisect(body, 2, [0.2, 0.5, 0.9, 1.2])
    for v in body.verts:   # crown: the top 18 cm rolls inwards
        if v.co.z > H - 0.18:
            k = (v.co.z - (H - 0.18)) / 0.18
            s = 1 - 0.12 * k * k
            v.co.x *= s
            v.co.y *= s
    jitter(body, 0.002, freq=3.0, seed=rng.randint(0, 999))
    part.add(body, mat, T((0, 0, z0)))
    fy = -D / 2
    # dial window bezel (chrome) + recessed window
    wz = z0 + 1.05
    bez = rect_section(0.34, 0.24, 0.04, 3)
    part.add(tube([(x, fy - 0.004, wz + y) for x, y in bez] + [(bez[0][0], fy - 0.004, wz + bez[0][1])], 0.009,
                  sides=6), 'chrome_pitted')
    part.add(box(0.32, 0.004, 0.22, 0.002, 1), 'glass_grimy', T((0, fy + 0.002, wz)))
    decal(part, 'gas_pump.dial', 0.3, 0.2, T((0, fy + 0.006, wz)), p.get('priceDial', '1976'), style='price_dial',
          extra={'faces': 'reading frozen at 1976 prices'})
    # lower door outline + key lock, vertical chrome strips on the front corners
    door = rect_section(0.38, 0.62, 0.03, 2)
    dz = z0 + 0.42
    part.add(tube([(x, fy - 0.001, dz + y) for x, y in door] + [(door[0][0], fy - 0.001, dz + door[0][1])], 0.004,
                  sides=5), mat)
    part.add(cyl(0.008, 0.01, n=10), 'chrome_pitted', T((0.15, fy, dz + 0.2), (math.pi / 2, 0, 0)))
    for sx in (-1, 1):
        part.add(tube([(sx * (W / 2 - 0.03), fy + 0.02, z0 + 0.05), (sx * (W / 2 - 0.03), fy + 0.02, z0 + H - 0.2)],
                      0.006, sides=6), 'chrome_pitted', T((sx * 0.012, -0.0, 0)))
    decal(part, 'gas_pump.brand', 0.36, 0.12, T((0, fy - 0.001, z0 + 1.32)), p.get('brand', "STROUD'S GAS & FEED"),
          style='sign_painted', extra={'text_param': 'brand'})
    # nozzle boot on the right side, nozzle, hose
    bx = W / 2 + 0.03
    part.add(box(0.07, 0.12, 0.2, 0.006, 2), mat, T((bx, -0.02, z0 + 0.95)))
    noz = [(bx, -0.04, z0 + 1.08), (bx + 0.005, -0.04, z0 + 1.0), (bx + 0.005, -0.05, z0 + 0.93)]
    part.add(tube(noz, 0.012, sides=8, radii=[1.3, 1.0, 0.6]), 'chrome_pitted')
    part.add(tube([(bx - 0.02, -0.04, z0 + 1.1), (bx + 0.03, -0.04, z0 + 1.14), (bx + 0.03, -0.04, z0 + 1.05)], 0.004,
                  sides=5), 'chrome_pitted')
    hose = [(W / 2 - 0.01, 0.1, z0 + 1.25), (W / 2 + 0.1, 0.12, z0 + 1.1), (W / 2 + 0.2, 0.1, z0 + 0.55),
            (W / 2 + 0.16, 0.05, z0 + 0.25), (W / 2 + 0.09, 0.0, z0 + 0.4), (bx + 0.01, -0.04, z0 + 0.95),
            (bx, -0.04, z0 + 1.08)]
    part.add(tube(fillet(hose, 0.12, 5), 0.014, sides=8), 'rubber_black')
    # reset crank on the left side
    part.add(tube(fillet([(-W / 2, 0.02, z0 + 1.0), (-W / 2 - 0.05, 0.02, z0 + 1.0), (-W / 2 - 0.05, 0.02, z0 + 0.88)],
                         0.02, 3), 0.007, sides=6), 'chrome_pitted')
    # globe collar + broken globe
    zt = z0 + H - 0.005
    part.add(lathe([(0, 0), (0.08, 0), (0.07, 0.03), (0.05, 0.05), (0.052, 0.07), (0, 0.07)], n=20), mat, T((0, 0, zt)))
    gz = zt + 0.07
    broken = str(p.get('globe', 'broken')) == 'broken'
    a0, a1 = (0.0, math.tau) if not broken else (rng.u(0, 1), rng.u(0, 1) + math.tau * 0.62)
    # 16-inch globe: a round lens body standing upright, lenses facing front/back (lathe axis -> y)
    shell = [(0.015, -0.072), (0.15, -0.07), (0.185, -0.055), (0.2, -0.025), (0.203, 0.0), (0.2, 0.025),
             (0.185, 0.055), (0.15, 0.07), (0.015, 0.072)]
    g = lathe(shell, n=28, a0=a0, a1=a1, cap_bottom=False, cap_top=False)
    jitter(g, 0.003, freq=20.0, seed=rng.randint(0, 999))
    part.add(g, 'glass_grimy', T((0, 0, gz + 0.2), (math.pi / 2, 0, 0)))
    part.add(tube([(0.205 * math.cos(math.tau * k / 28), 0, 0.205 * math.sin(math.tau * k / 28)) for k in range(28)],
                  0.008, sides=6, closed=True), mat, T((0, 0, gz + 0.2)))
    for k in range(4 if broken else 0):   # shards on the island
        sh = extrude([(0, 0), (0.05 + rng.j(0.02), 0.01), (0.03, 0.04 + rng.j(0.02))], 0.004)
        part.add(sh, 'glass_grimy', T((rng.u(-0.4, 0.4), rng.u(-0.32, -0.22), 0.162), (0, 0, rng.u(0, 6.28))))
    return [part]
