"""County Road 9 opening set (docs/C1-OPENING.md §6.3): county shield, billboard, dead diner + EAT pole sign, deer,
logging truck. All room RC9, lighting 'dynamic' (headlights, moon, lightning at runtime): no lightmap islands.
Real-world dimensions; front faces -y at yaw 0 like every generator.
"""
import math

from mathutils import Vector

from .kit import (Part, T, anchor, box, cyl, decal, extrude, jitter, lathe, prop, sag, sphere, tube)
from .exterior import wood_post


def _u_channel(part, rng, x, z0, z1, y=0.0, mat='zinc_galvanized'):
    """Punched 3 lb/ft U-channel sign post (US standard), driven 0.9 m."""
    sec = [(-0.025, -0.012), (0.025, -0.012), (0.025, 0.012), (0.018, 0.012), (0.018, -0.004), (-0.018, -0.004),
           (-0.018, 0.012), (-0.025, 0.012)]
    part.add(tube([(x, y, z0), (x, y, z1)], 0.02, section=sec), mat, T((0, 0, 0), (rng.j(0.015), rng.j(0.015), 0)))


@prop('county_shield', instance_keys=('text',), budget=300)
def county_shield(p, rng):
    """MUTCD M1-6 county route marker: 0.45 m blue pentagon, yellow border, 'COUNTY' over the route number (runtime
    decal style 'county_shield'), on a galvanised U-channel post, bottom at 1.5 m."""
    part = Part('county_shield', rng)
    w = float(p.get('w', 0.45))
    z0 = 1.5
    _u_channel(part, rng, 0.0, -0.9, z0 + w * 0.95, y=0.02)
    # pentagon: flat top, vertical sides to 60 %, then a point at the bottom (M1-6 proportions)
    hw, ht = w / 2, w * 1.05
    outline = [(-hw, 0.0), (hw, 0.0), (hw, -0.55 * ht), (0.0, -ht), (-hw, -0.55 * ht)]
    plate = extrude([(x, y) for x, y in reversed(outline)], 0.003, bevel_w=0.001, segs=1)
    part.add(plate, 'sign_sheeting', T((0, 0.003, z0 + ht), (-math.pi / 2, 0, 0)))
    part.add(cyl(0.008, 0.01, n=6), 'zinc_galvanized', T((0, -0.002, z0 + ht * 0.82), (math.pi / 2, 0, 0)))
    part.add(cyl(0.008, 0.01, n=6), 'zinc_galvanized', T((0, -0.002, z0 + ht * 0.2), (math.pi / 2, 0, 0)))
    decal(part, 'county_shield.face', w - 0.01, ht - 0.01, T((0, -0.001, z0 + ht / 2)), p.get('text', 'COUNTY|9'),
          style='county_shield', extra={'text_param': 'text', 'retro': 1.0, 'shape': 'pentagon'})
    return [part]


# ------------------------------------------------------------------------------------------------ billboard
@prop('billboard', instance_keys=('text',), budget=5000)
def billboard(p, rng):
    """Peeling 30-sheet poster billboard (12 x 25 ft = 3.7 x 7.6 m face, bottom 3.0 m) on three creosoted poles.

    The face is plywood with two paper layers (runtime decal 'billboard': the new motel ad over the old one whose
    'ROOMS 1/2 MI' shows where it peeled). 24 peeling strips (child 'billboard-peel', `flutter`: runtime vertex
    wind) curl off the face; the catwalk and four dead gooseneck lamps hang below; sawn-lumber back frame.
    """
    part = Part('billboard', rng)
    part.extras = {'low_ratio': 0.25}          # Low: seen at 40+ m in lightning only (C1-OPENING §6.5)
    W, H, Z0 = 7.6, 3.7, 3.0
    zc = Z0 + H / 2
    # poles: 0.30 m creosoted, 1.8 m in the ground, tops just under the panel top
    for i, x in enumerate((-2.6, 0.0, 2.6)):
        bm = cyl(0.15, Z0 + H - 0.25 + 1.8, n=10, r_top=0.13, z0=-1.8)
        jitter(bm, 0.008, freq=1.5, seed=rng.randint(0, 9999))
        part.add(bm, 'bark_wet', T((x + rng.j(0.03), 0.42, 0), (rng.j(0.012), rng.j(0.012), rng.u(0, 6))))
        # knee braces to the bottom stringer
        part.add(box(0.09, 0.04, 1.3, 0.004, 1), 'wood_raw_plank', T((x + 0.35, 0.3, Z0 - 0.35), (0, -0.62, 0)))
    # plywood face: 4 x 8 ft sheets, a few sheets warped/delaminating at their seams
    sw, sh = W / 6, H / 3
    for ix in range(6):
        for iz in range(3):
            bm = box(sw - 0.006, 0.019, sh - 0.006, 0.002, 1, cuts={0: 2})
            k = rng.u(0.0, 0.02) if rng.chance(0.4) else 0.0
            for v in bm.verts:     # bows BACK (away from the paper), so the face decal stays in front
                v.co.y += k * (1 - (2 * v.co.x / sw) ** 2)
            part.add(bm, 'plywood_weathered', T((-W / 2 + sw * (ix + 0.5), 0.0, Z0 + sh * (iz + 0.5))))
    # face trim (painted 1x6 moulding) — one length hanging loose at the lower right
    for z in (Z0 - 0.05, Z0 + H + 0.05):
        part.add(box(W + 0.2, 0.04, 0.14, 0.004, 1), 'trim_chipped', T((0, -0.01, z)))
    for x in (-W / 2 - 0.05, W / 2 + 0.05):
        part.add(box(0.14, 0.04, H + 0.2, 0.004, 1), 'trim_chipped', T((x, -0.01, zc)))
    part.add(box(1.6, 0.03, 0.14, 0.004, 1), 'trim_chipped', T((W / 2 - 0.9, -0.08, Z0 - 0.45), (0, 0.5, 0.15)))
    # back frame: 2x6 stringers and studs
    for z in (Z0 + 0.25, zc, Z0 + H - 0.25):
        part.add(box(W, 0.14, 0.045, 0.003, 1), 'wood_raw_plank', T((0, 0.09, z)))
    for i in range(9):
        part.add(box(0.045, 0.14, H, 0.003, 1), 'wood_raw_plank', T((-W / 2 + 0.1 + (W - 0.2) * i / 8, 0.2, zc)))
    # catwalk: brackets, 2x10 planks, a pipe rail (one plank missing)
    for x in (-3.4, -1.3, 1.3, 3.4):
        part.add(box(0.06, 1.0, 0.08, 0.004, 1), 'rust', T((x, -0.45, Z0 - 0.25)))
        part.add(tube([(x, 0.05, Z0 - 0.25), (x, 0.05, Z0 - 0.95), (x, -0.9, Z0 - 0.25)], 0.02, sides=6), 'rust')
    for i in range(4):
        if i == 2:
            continue
        part.add(box(W, 0.235, 0.038, 0.004, 1), 'wood_raw_plank',
                 T((rng.j(0.05), -0.14 - 0.24 * i, Z0 - 0.19), (rng.j(0.01), 0, 0)))
    # four gooseneck lamp arms from the catwalk, dead, cracked lenses
    for k, x in enumerate((-2.85, -0.95, 0.95, 2.85)):
        arm = [(x, -0.9, Z0 - 0.2), (x, -1.15, Z0 + 0.15), (x, -1.25, Z0 + 0.45), (x, -1.15, Z0 + 0.6)]
        part.add(tube(arm, 0.022, sides=6), 'rust')
        # shallow RLM-style reflector dish (Ø 0.36, 0.09 deep) opening toward the face
        hood = lathe([(0.0, 0.09), (0.05, 0.085), (0.12, 0.05), (0.18, 0.0), (0.185, -0.01)], n=10,
                     cap_bottom=False, cap_top=False)
        part.add(hood, 'enamel_chipped', T((x, -1.1, Z0 + 0.6), (2.4 + rng.j(0.15), 0, rng.j(0.2))))
        if k != 1:   # one lens gone
            part.add(cyl(0.17, 0.01, n=10), 'glass_grimy', T((x, -1.08, Z0 + 0.6), (2.4, 0, 0)))
    # service ladder up the centre pole (galvanised, rungs every 0.3 m), bottom section removed (anti-climb)
    for sx in (-0.2, 0.2):
        part.add(box(0.05, 0.012, Z0 - 1.2, 0.002, 1, center=(sx, 0.2, 1.2 + (Z0 - 1.2) / 2)), 'zinc_galvanized')
    for k in range(int((Z0 - 1.3) / 0.3) + 1):
        part.add(cyl(0.011, 0.4, n=6), 'zinc_galvanized', T((-0.2, 0.2, 1.3 + 0.3 * k), (0, math.pi / 2, 0)))
    # the face decal (two paper layers drawn at runtime)
    decal(part, 'billboard.face', W - 0.02, H - 0.02, T((0, -0.012, zc)), p.get('text', '58 · CARVEL EXIT 4 · EAT · SLEEP · GAS|STROUD\'S · ROOMS ½ MI'),
          mat='paper_aged', style='billboard', extra={'text_param': 'text', 'layers': 2, 'layer_note': 'line 1 = 1980s poster (torn), line 2 = 1960s hand paint under it'})
    # peeling strips: 24 rain-soaked poster sheets torn loose. Top edge still pasted flush to the face; below a
    # tear line the paper leaves the board, hangs under its own wet weight and curls outward at the free end.
    peel = Part('billboard-peel', rng.sub(5))
    for i in range(24):
        w = rng.u(0.3, 0.9)
        L = rng.u(0.4, 1.4)
        x0 = rng.u(-W / 2 + 0.5, W / 2 - 0.5)
        z0 = rng.u(Z0 + L + 0.15, Z0 + H - 0.1)
        lift = rng.u(0.04, 0.35)            # how far the free end stands off the board
        roll = rng.u(0.0, 1.0)              # a tight roll at the bottom on some strips
        skew = rng.j(0.12)
        tear = [rng.j(0.04) for _ in range(3)]

        def fn(u, v, w=w, L=L, x0=x0, z0=z0, lift=lift, roll=roll, skew=skew, tear=tear):
            # torn top edge (jagged), sheet narrows a little as it tears down
            zt = z0 + tear[min(2, int(u * 2.99))] * (1 - v)
            y = -0.014 - lift * v ** 2.2
            z = zt - L * v
            if roll > 0.6 and v > 0.75:      # rolled free end
                a = (v - 0.75) / 0.25 * math.pi * 1.2
                rr = 0.05
                y -= rr * math.sin(a)
                z += L * (v - 0.75) - rr * (1 - math.cos(a)) * 0.6
            x = x0 + (u - 0.5) * w * (1 - 0.18 * v) + skew * v * v
            y -= 0.03 * math.sin(u * math.pi) * v   # the wet sheet cups across its width
            return (x, y, z)
        peel.add_grid(3, 6, fn, 'paper_aged@2s', flip=True)
    # fallen sheets pulped into the gravel under the face
    for i in range(5):
        w, L = rng.u(0.4, 0.9), rng.u(0.5, 1.2)
        x0, y0, a = rng.u(-3.5, 3.5), rng.u(-1.6, -0.2), rng.u(0, math.pi)

        def fg(u, v, w=w, L=L, x0=x0, y0=y0, a=a):
            lx, ly = (u - 0.5) * w, (v - 0.5) * L
            return (x0 + lx * math.cos(a) - ly * math.sin(a), y0 + lx * math.sin(a) + ly * math.cos(a),
                    0.012 + 0.02 * math.sin(u * 3.1) * math.sin(v * 2.3))
        peel.add_grid(2, 2, fg, 'paper_aged@2s')
    peel.extras = {'flutter': True, 'peel_strips': 24, 'low_ratio': 0.4, 'low_min_tris': 400}
    part.children.append((peel, T((0, 0, 0))))
    return [part]


# ------------------------------------------------------------------------------------------------ dead diner
def _lap_wall(part, rng, x0, x1, z0, z1, y, mat='clapboard_peeling', t=0.16, face=-1):
    """A clapboard wall panel (x0..x1 along local x, z0..z1) at plane y; lap siding as 0.1 m reveal steps."""
    w = x1 - x0
    part.add(box(w, t, z1 - z0, 0.004, 1, center=((x0 + x1) / 2, y - face * t / 2, (z0 + z1) / 2)), mat)
    # board laps: a thin wedge every 0.1 m reads under raking headlights (every other one at Low via decimation)
    n = int((z1 - z0) / 0.1)
    for k in range(n):
        z = z0 + 0.1 * (k + 1) - 0.004
        part.add(box(w, 0.012, 0.022, 0.001, 1, center=((x0 + x1) / 2, y + face * 0.004, z)), mat)


@prop('diner', budget=12000)
def diner(p, rng):
    """Dead 1950s roadside diner, 12 x 8 m, flat roof 3.6 m + parapet, clapboard, window band boarded with weathered
    plywood (one board hand-lettered CLOSED), cracked glass door with a CLOSED card, sagging tin awning, payphone with
    its cord cut and no handset (child 'diner-payphone'), concrete pump island with no pumps, gravel lot with puddles,
    a culvert apron over the ditch. Front (the road side) faces -y."""
    part = Part('diner', rng)
    part.extras = {'low_ratio': 0.2}           # Low ladder step 2: laps collapse, boards + box + awning stay
    X, Y, H = 6.0, 4.0, 3.6
    # slab + stoop
    part.add(box(2 * X + 0.4, 2 * Y + 0.4, 0.25, 0.02, 1, center=(0, 0, 0.05)), 'concrete_wet')
    part.add(box(1.8, 0.9, 0.18, 0.02, 1, center=(-3.4, -Y - 0.6, 0.06)), 'concrete_wet')
    # front wall: door at x -3.4 (0.95 x 2.1), window band x -2.3..5.4, z 1.0..2.2 in four bays
    f = -Y
    _lap_wall(part, rng, -X, -3.9, 0.2, H, f)
    _lap_wall(part, rng, -2.9, X, 0.2, 1.0, f)
    _lap_wall(part, rng, -2.9, X, 2.2, H, f)
    _lap_wall(part, rng, -3.9, -2.9, 2.3, H, f)
    bays = [(-2.3, -0.4), (0.0, 1.9), (2.3, 4.2), (4.6, 5.5)]
    piers = [(-2.9, -2.3), (-0.4, 0.0), (1.9, 2.3), (4.2, 4.6), (5.5, X)]
    for a, b in piers:
        _lap_wall(part, rng, a, b, 1.0, 2.2, f)
    for i, (a, b) in enumerate(bays):
        # sill + the dark void behind the boards (no interior is ever seen)
        part.add(box(b - a + 0.1, 0.22, 0.05, 0.01, 1, center=((a + b) / 2, f - 0.06, 0.99)), 'trim_chipped')
        part.add(box(b - a, 0.02, 1.2, 0.001, 1, center=((a + b) / 2, f + 0.1, 1.6)), 'rubber_black')
        # plywood boards: two half sheets per bay, nailed proud of the frame, one corner sprung
        n = 2
        for k in range(n):
            bw = (b - a) / n + 0.06
            bm = box(bw - 0.01, 0.018, 1.3, 0.003, 1, cuts={0: 1})
            spring = rng.u(0.0, 0.05) if rng.chance(0.35) else 0.0
            for v in bm.verts:
                if v.co.z > 0.5 and v.co.x > 0:
                    v.co.y -= spring
            cx = a + (b - a) * (k + 0.5) / n
            part.add(bm, 'plywood_weathered', T((cx, f - 0.03, 1.6), (0, rng.j(0.02), 0)))
        if i == 1:
            decal(part, 'diner.closed_board', 1.4, 0.5, T(((a + b) / 2, f - 0.042, 1.7), (0, 0.03, 0)), 'CLOSED',
                  mat='plywood_weathered', style='hand_lettered')
    # door: aluminium storefront frame, cracked glass (spider-web crack is a material/decal job), CLOSED card
    dx = -3.4
    part.add(box(1.0, 0.1, 0.05, 0.004, 1, center=(dx, f - 0.02, 2.2)), 'chrome_pitted')
    for sx in (-0.5, 0.5):
        part.add(box(0.05, 0.1, 2.0, 0.004, 1, center=(dx + sx, f - 0.02, 1.2)), 'chrome_pitted')
    part.add(box(0.9, 0.012, 1.4, 0.002, 1, center=(dx, f - 0.02, 1.35)), 'glass_grimy')
    part.add(box(0.95, 0.06, 0.55, 0.004, 1, center=(dx, f - 0.02, 0.43)), 'chrome_pitted')
    part.add(box(0.9, 0.02, 2.0, 0.001, 1, center=(dx, f + 0.3, 1.2)), 'rubber_black')
    part.add(tube([(dx + 0.38, f - 0.08, 1.0), (dx + 0.38, f - 0.08, 1.35)], 0.012, sides=6), 'chrome_pitted')
    decal(part, 'diner.closed_card', 0.24, 0.14, T((dx - 0.15, f - 0.03, 1.55)), 'CLOSED', mat='paper_aged',
          style='sign_painted')
    # side + back walls: one boarded window each side, a kitchen door + grease-stained vent at the back
    for sx in (-1, 1):
        x = sx * X
        part.add(box(0.16, 2 * Y, H - 0.2, 0.004, 1, center=(x - sx * 0.08, 0, (H + 0.2) / 2)), 'clapboard_peeling')
        for k in range(int((H - 0.2) / 0.2)):     # sides: every other lap (seen only obliquely, at distance)
            part.add(box(0.012, 2 * Y, 0.022, 0.001, 1, center=(x + sx * 0.004, 0, 0.4 + 0.2 * k - 0.004)), 'clapboard_peeling')
        part.add(box(0.02, 1.4, 1.1, 0.003, 1, center=(x + sx * 0.02, -0.8, 1.6)), 'plywood_weathered')
    part.add(box(2 * X, 0.16, H - 0.2, 0.004, 1, center=(0, Y - 0.08, (H + 0.2) / 2)), 'clapboard_peeling')
    part.add(box(0.95, 0.06, 2.05, 0.004, 1, center=(3.6, Y + 0.02, 1.25)), 'door_painted')
    part.add(box(0.6, 0.5, 0.6, 0.01, 1, center=(1.2, Y + 0.25, 3.0)), 'rust')
    # roof: slab, parapet with sheet-metal coping, a rusted swamp cooler and a vent stack
    part.add(box(2 * X, 2 * Y, 0.2, 0.01, 1, center=(0, 0, H - 0.1)), 'concrete_wet')
    for (cx, cy, sx_, sy_) in ((0, -Y + 0.08, 2 * X, 0.16), (0, Y - 0.08, 2 * X, 0.16),
                               (-X + 0.08, 0, 0.16, 2 * Y), (X - 0.08, 0, 0.16, 2 * Y)):
        part.add(box(sx_, sy_, 0.45, 0.004, 1, center=(cx, cy, H + 0.22)), 'clapboard_peeling')
        part.add(box(sx_ + 0.04, sy_ + 0.06, 0.03, 0.003, 1, center=(cx, cy, H + 0.46)), 'zinc_galvanized')
    # the diner's one bit of chrome: a fluted stainless fascia band under the parapet (front + returns), dented
    part.add(box(2 * X + 0.06, 0.05, 0.32, 0.006, 2, center=(0, f - 0.03, H - 0.25)), 'chrome_pitted')
    for sx in (-1, 1):
        part.add(box(0.05, 1.6, 0.32, 0.006, 2, center=(sx * (X + 0.03), f + 0.8, H - 0.25)), 'chrome_pitted')
    # downspout off the roof drain at the west corner, its foot broken off and lying in the gravel
    part.add(tube([(-X + 0.12, f - 0.1, H + 0.1), (-X + 0.12, f - 0.1, 0.7)], 0.045, sides=4,
                  section=[(-0.04, -0.03), (0.04, -0.03), (0.04, 0.03), (-0.04, 0.03)]), 'zinc_galvanized')
    part.add(box(0.08, 0.06, 0.6, 0.004, 1, center=(-X + 0.5, f - 0.5, 0.05)), 'zinc_galvanized',
             T((0, 0, 0), (0, math.pi / 2 - 0.1, 0.6)))
    part.add(box(1.0, 1.0, 0.85, 0.01, 1, center=(2.5, 1.0, H + 0.43)), 'rust')
    part.add(cyl(0.12, 1.4, n=8, z0=H), 'rust', T((-3.0, 2.2, 0)))
    part.add(cyl(0.2, 0.08, n=8, z0=H + 1.4), 'rust', T((-3.0, 2.2, 0)))
    # sagging tin awning over the window band: corrugated sheet, two hanger rods, the east end torn and drooping
    def awn(u, v):
        x = -2.6 + 8.4 * u
        y = f - 1.1 * v
        droop = 0.25 * v + (0.5 * (u - 0.8) / 0.2 * v if u > 0.8 else 0.0)
        z = 2.55 - droop - 0.08 * math.sin(u * math.pi) * v + 0.012 * math.sin(u * 8.4 * math.tau / 0.07 / 10)
        return (x, y, z)
    part.add_grid(24, 3, awn, 'zinc_galvanized@2s', flip=True)
    for x in (-2.2, 2.0):
        part.add(tube([(x, f, 3.3), (x, f - 1.05, 2.33)], 0.008, sides=5), 'rust')
    # concrete pump island (no pumps): 4 anchor bolts each, a broken bollard
    for ix in (-1.0, 1.0):
        cx, cy = ix * 2.2, f - 7.0
        part.add(box(3.2, 1.0, 0.18, 0.03, 2, center=(cx, cy, 0.09)), 'concrete_wet')
        for bx in (-0.25, 0.25):
            for by in (-0.15, 0.15):
                part.add(cyl(0.012, 0.07, n=6, z0=0.18), 'rust', T((cx + bx, cy + by, 0)))
        part.add(cyl(0.1, 0.9 if ix < 0 else 0.35, n=10, z0=0.18), 'rust', T((cx + 1.45, cy, 0), (0, 0.08 * ix, 0)))
    part.add(box(4.0, 0.5, 0.04, 0.01, 1, center=(0, f - 7.0, 0.19)), 'rubber_black')
    # gravel lot (to the road shoulder, n 20 -> 9.5) + puddle strips + the culvert apron over the ditch
    part.add(box(26.0, 10.5, 0.06, 0.02, 1, center=(0, f - 5.25, 0.0)), 'gravel_wet')
    for k in range(7):
        w, l = rng.u(1.0, 3.5), rng.u(0.4, 1.0)
        part.add(box(w, l, 0.004, 0.001, 1, center=(rng.u(-11, 11), rng.u(f - 9.5, f - 2.0), 0.032),
                     ), 'water_ditch', T((0, 0, 0), (0, 0, rng.j(0.4))))
    part.add(box(8.0, 5.2, 0.5, 0.03, 1, center=(1.5, f - 12.9, -0.22)), 'gravel_wet')
    for sx in (-1, 1):
        part.add(lathe([(0.3, 0.0), (0.3, 0.6), (0.27, 0.6), (0.27, 0.0)], n=12, cap_bottom=False, cap_top=False),
                 'rust', T((1.5 + sx * 4.2, f - 12.9, -0.3), (0, math.pi / 2, 0)))
    # payphone on a post by the door: steel box, armoured cord cut short, no handset
    pp = Part('diner-payphone', rng.sub(9))
    pp.add(box(0.1, 0.1, 1.3, 0.004, 1, center=(0, 0, 0.65)), 'zinc_galvanized')
    pp.add(box(0.3, 0.2, 0.55, 0.01, 2, center=(0, -0.08, 1.45)), 'zinc_galvanized')
    pp.add(box(0.36, 0.3, 0.05, 0.01, 1, center=(0, -0.12, 1.78)), 'zinc_galvanized')
    pp.add(box(0.07, 0.03, 0.2, 0.004, 1, center=(-0.1, -0.19, 1.5)), 'chrome_pitted')    # empty cradle
    pp.add(tube([(-0.1, -0.19, 1.36), (-0.12, -0.22, 1.25), (-0.08, -0.24, 1.18), (-0.11, -0.25, 1.12)], 0.007,
                sides=6), 'chrome_pitted')     # armoured cord, cut
    for k in range(12):
        pp.add(box(0.022, 0.006, 0.018, 0.001, 1, center=(0.04 + 0.03 * (k % 3), -0.185, 1.6 - 0.035 * (k // 3))),
               'chrome_pitted')
    pp.extras = {'no_handset': True, 'low_ratio': 0.35, 'low_min_tris': 400}
    part.children.append((pp, T((-2.2, f - 0.9, 0.0), (0, 0, 0.25))))
    return [part]


# ------------------------------------------------------------------------------------------------ EAT pole sign
_NEON = {   # stroke polylines per letter in a 0.6 x 0.9 m cell (x 0..0.6, z 0..0.9)
    'E': [[(0.55, 0.9), (0.05, 0.9), (0.05, 0.0), (0.55, 0.0)], [(0.05, 0.45), (0.42, 0.45)]],
    'A': [[(0.0, 0.0), (0.3, 0.9), (0.6, 0.0)], [(0.12, 0.33), (0.48, 0.33)]],
    'T': [[(0.0, 0.9), (0.6, 0.9)], [(0.3, 0.9), (0.3, 0.0)]],
}


@prop('eat_sign', budget=2000)
def eat_sign(p, rng):
    """Roadside pole sign: 7 m steel pipe, a rusted sheet-metal can 2.6 x 1.1 x 0.35 m, and E-A-T in 12 mm glass
    neon tube (dead: dusty glass, no emissive) on standoffs across its face. Front faces -y."""
    part = Part('eat_sign', rng)
    part.add(cyl(0.11, 8.6, n=10, z0=-1.6), 'rust', T((0, 0.0, 0), (rng.j(0.01), rng.j(0.01), 0)))
    part.add(cyl(0.2, 0.1, n=10), 'concrete_wet', T((0, 0, -0.05)))
    zc = 6.45
    can = box(2.6, 0.35, 1.1, 0.03, 2)
    for v in can.verts:       # dented, oil-canned faces
        v.co.y += (0.02 * (1 - (v.co.x / 1.3) ** 2) * (1 - (v.co.z / 0.55) ** 2)) * (1 if v.co.y > 0 else -1)
    part.add(can, 'rust', T((0, 0, zc)))
    part.add(box(2.66, 0.38, 0.06, 0.01, 1, center=(0, 0, zc + 0.57)), 'zinc_galvanized')
    # bracket collar
    part.add(cyl(0.14, 0.5, n=10, z0=zc - 0.85), 'rust')
    # neon: letters 0.9 tall, 0.6 wide, 0.2 apart, centred on the face, 12 mm tube 0.06 m off the face
    neon = Part('eat_sign-neon', rng.sub(3))
    xs = -(3 * 0.6 + 2 * 0.2) / 2
    for i, ch in enumerate('EAT'):
        x0 = xs + i * 0.8
        for stroke in _NEON[ch]:
            pts = [(x0 + x, -0.24, zc - 0.45 + z) for x, z in stroke]
            neon.add(tube(pts, 0.006, sides=5), 'glass_grimy')
            for x, z in stroke:          # standoffs (glass housings on wires) at the stroke ends
                neon.add(cyl(0.008, 0.07, n=5), 'glass_grimy', T((x0 + x, -0.18, zc - 0.45 + z), (math.pi / 2, 0, 0)))
        # electrode housings behind each letter
        neon.add(box(0.06, 0.04, 0.06, 0.005, 1, center=(x0 + 0.3, -0.19, zc - 0.5)), 'rubber_black')
    neon.extras = {'neon': True, 'neon_color': [1.0, 0.18, 0.08], 'lit': False}
    part.children.append((neon, T((0, 0, 0))))
    # the back face carries the same tubes (double-faced can) — mirrored copy
    back = Part('eat_sign-neon_back', rng.sub(4))
    for i, ch in enumerate('EAT'):
        x0 = -xs - i * 0.8
        for stroke in _NEON[ch]:
            pts = [(x0 - x, 0.24, zc - 0.45 + z) for x, z in stroke]
            back.add(tube(pts, 0.006, sides=5), 'glass_grimy')
    back.extras = {'neon': True, 'lit': False}
    part.children.append((back, T((0, 0, 0))))
    return [part]


# ------------------------------------------------------------------------------------------------ logging truck
TRUCK_R = 0.52          # 11R22.5 tyre: 1.04 m overall


def _truck_wheel(prt, x, dual, rng, inner_sign=1):
    """One wheel (or a dual pair) on an axle Part whose origin is the hub; lathe axis -> local x."""
    tp = [(0.29, -0.14), (0.42, -0.145), (0.5, -0.13), (TRUCK_R, -0.09), (TRUCK_R + 0.003, 0.0), (TRUCK_R, 0.09),
          (0.5, 0.13), (0.42, 0.145), (0.29, 0.14)]
    rim = [(0.29, 0.13), (0.28, 0.06), (0.2, 0.04), (0.12, 0.05), (0.1, 0.09), (0.0, 0.09)]
    offs = [0.0] if not dual else [-0.16 * inner_sign, 0.16 * inner_sign]
    for k, o in enumerate(offs):
        m = T((x + o, 0, 0), (0, math.copysign(math.pi / 2, x), 0))   # disc faces outboard
        prt.add(lathe(tp, n=20, closed=True), 'rubber_black', m)      # closed: recalc'd normals point out
        if k == len(offs) - 1:      # only the outer wheel shows its disc
            prt.add(lathe(rim, n=16, closed=True), 'rust', m)
            for b in range(10):     # wheel nuts
                a = b * math.tau / 10
                prt.add(cyl(0.012, 0.03, n=5), 'chrome_pitted',
                        T((x + o + (0.09 if x > 0 else -0.09) * 1.0, 0.16 * math.cos(a), 0.16 * math.sin(a)), (0, math.pi / 2, 0)))


@prop('logging_truck', budget=28000)
def logging_truck(p, rng):
    """1970s-80s conventional long-nose log hauler and pole trailer, 21 m overall, nose -y.

    Day cab 2.4 m wide (roof 3.0 m), 2.4 m hood, rusted chrome grille, twin stacks, headache rack; bunks with
    stakes and binder chains; 14 logs (O 0.35-0.55 x 10-12 m, pale cut ends); mud flaps. Five axle nodes
    (`logging_truck-axle_N`, part 'wheel', spin_axis [1,0,0], 18 tyres). Lamps: -hi_l/_r (lamp 'head'),
    -clearance (5 amber), -markers (amber), -tail (red); -spray_l/_r anchors at the drive axles.
    The cab is an empty dark box (no driver)."""
    part = Part('logging_truck', rng)
    part.extras = {'low_ratio': 0.25}          # Low ladder step 1: seen 0.45 s in its own glare
    W = 2.4
    # chassis rails + crossmembers (tractor) and the reach pole to the trailer
    for sx in (-0.43, 0.43):
        part.add(box(0.08, 8.6, 0.27, 0.005, 1, center=(sx, -6.1, 0.95)), 'rust')
    part.add(tube([(0, -2.3, 0.95), (0, 7.4, 0.95)], 0.09, sides=8), 'rust')
    # front bumper (rusted chrome, one end bent), grille, hood, fenders
    bb = box(W, 0.25, 0.32, 0.02, 2, center=(0, -10.35, 0.68), cuts={0: 4})
    for v in bb.verts:
        if v.co.x > 0.8:
            v.co.y += 0.12 * (v.co.x - 0.8)
    part.add(bb, 'chrome_pitted')
    part.add(box(1.1, 0.1, 1.15, 0.02, 2, center=(0, -10.2, 1.45)), 'chrome_pitted')
    for k in range(9):      # grille bars
        part.add(box(0.025, 0.05, 1.05, 0.004, 1, center=(-0.48 + 0.12 * k, -10.27, 1.45)), 'rust')
    hood = box(1.25, 2.3, 0.75, 0.08, 3, center=(0, -9.05, 1.65), cuts={1: 3})
    for v in hood.verts:     # crowned, tapering to the grille
        f = (v.co.y + 9.05 + 1.15) / 2.3
        v.co.x *= 0.88 + 0.12 * f
        if v.co.z > 1.9:
            v.co.z += 0.05 * (1 - (v.co.x / 0.62) ** 2)
    part.add(hood, 'truck_paint')
    for sx in (-1, 1):
        fe = [(sx * 0.6, -10.3, 0.95), (sx * 1.15, -9.7, 1.25), (sx * 1.2, -8.9, 1.3), (sx * 1.2, -8.3, 0.9)]
        part.add(tube(fe, 0.18, sides=6, section=[(-0.02, -0.18), (0.02, -0.18), (0.02, 0.18), (-0.02, 0.18)]),
                 'truck_paint')
        part.add(box(0.5, 0.9, 0.1, 0.01, 1, center=(sx * 1.05, -7.6, 0.55)), 'rust')    # step / tank strap
        part.add(cyl(0.3, 1.1, n=12), 'chrome_pitted', T((sx * 0.98, -6.4, 0.75), (math.pi / 2, 0, 0)))  # fuel tanks
    # cab: day cab box with a two-piece flat windscreen, door windows; dark empty interior shell
    part.add(box(W, 1.8, 1.75, 0.06, 2, center=(0, -7.1, 2.12)), 'truck_paint')
    for sx in (-0.55, 0.55):
        part.add(box(1.0, 0.03, 0.7, 0.01, 1, center=(sx, -8.01, 2.55)), 'glass_grimy')
    part.add(box(W - 0.2, 1.4, 0.75, 0.0015, 1, center=(0, -7.05, 2.55)), 'rubber_black')
    for sx in (-1, 1):
        part.add(box(0.03, 1.0, 0.6, 0.01, 1, center=(sx * (W / 2 + 0.005), -7.3, 2.55)), 'glass_grimy')
        part.add(tube([(sx * 1.25, -7.95, 2.2), (sx * 1.45, -8.05, 2.4), (sx * 1.45, -8.05, 2.9)], 0.015, sides=5),
                 'chrome_pitted')     # west-coast mirror arm
        part.add(box(0.06, 0.18, 0.42, 0.01, 1, center=(sx * 1.47, -8.05, 2.65)), 'chrome_pitted')
    part.add(box(W - 0.1, 0.25, 0.08, 0.02, 1, center=(0, -7.95, 3.02)), 'truck_paint')   # visor
    # stacks + headache rack
    for sx in (-1, 1):
        part.add(cyl(0.065, 3.3, n=8, z0=1.0), 'chrome_pitted', T((sx * 1.05, -6.05, 0)))
        part.add(cyl(0.075, 0.03, n=8, z0=4.3), 'rust', T((sx * 1.05, -6.05, 0)))
    for sx in (-1.1, 1.1):
        part.add(box(0.1, 0.1, 2.3, 0.01, 1, center=(sx, -5.85, 2.05)), 'rust')
    for z in (1.6, 2.2, 2.8):
        part.add(box(2.3, 0.08, 0.06, 0.01, 1, center=(0, -5.85, z)), 'rust')
    part.add(box(2.3, 0.1, 0.1, 0.01, 1, center=(0, -5.85, 3.2)), 'rust')
    # bunks (tractor + trailer) with stakes, binder chains over the load
    for by in (-3.9, 7.4):
        part.add(box(2.5, 0.3, 0.3, 0.02, 1, center=(0, by, 1.3)), 'rust')
        for sx in (-1.2, 1.2):
            part.add(box(0.12, 0.12, 1.7, 0.01, 1, center=(sx, by, 2.25)), 'rust')
    # logs: 14 in a 5-4-3-2 pyramid, pale cut ends with heart rings (end cap material)
    logs = Part('logging_truck-logs', rng.sub(7))
    rows = [5, 4, 3, 2]
    z = 1.45
    for ri, nrow in enumerate(rows):
        rr = [rng.u(0.18, 0.27) for _ in range(nrow)]
        span = sum(2 * r for r in rr)
        x = -span / 2
        zr = z + max(rr)
        for r in rr:
            x += r
            L = rng.u(10.0, 12.0)
            y0 = rng.u(-5.6, -5.0)
            bm = cyl(r, L, n=9, r_top=r * rng.u(0.82, 0.92))
            jitter(bm, 0.012, freq=0.6, seed=rng.randint(0, 9999))
            logs.add(bm, 'bark_wet', T((x, y0, zr), (-math.pi / 2, 0, 0)))
            for yy, rad in ((y0, r), (y0 + L, r * 0.87)):
                logs.add(cyl(rad * 0.97, 0.01, n=9), 'wood_raw_plank',
                         T((x, yy + (-0.006 if yy == y0 else 0.006), zr), (-math.pi / 2, 0, 0)))
            x += r
        z = zr + max(rr) * 0.55
    logs.extras = {'log_load': 14, 'low_ratio': 0.3}
    part.children.append((logs, T((0, 0, 0))))
    for by in (-3.6, 2.0, 6.9):
        chain = [(-1.25, by, 1.45)] + [(1.3 * math.cos(a), by, 2.25 + 1.05 * math.sin(a))
                                      for a in [math.pi - k * math.pi / 8 for k in range(9)]] + [(1.25, by, 1.45)]
        part.add(tube(chain, 0.012, sides=4), 'rust')
    # mud flaps + trailer bumper bar
    for yy in (-2.5, 8.9):
        for sx in (-1, 1):
            part.add(box(0.6, 0.01, 0.65, 0.003, 1, center=(sx * 0.95, yy, 0.55)), 'rubber_black')
    part.add(box(2.3, 0.12, 0.12, 0.01, 1, center=(0, 8.9, 0.95)), 'rust')
    # axles (spin nodes): steer y -8.9, drives -4.5/-3.2, trailer 6.8/8.1; 18 tyres
    for i, (ay, dual) in enumerate(((-8.9, False), (-4.5, True), (-3.2, True), (6.8, True), (8.1, True))):
        ax = Part(f'logging_truck-axle_{i + 1}', rng.sub(20 + i))
        hx = 1.05 if not dual else 0.86
        for sx in (-1, 1):
            _truck_wheel(ax, sx * hx, dual, rng, inner_sign=sx)
        ax.add(cyl(0.06, 2 * hx - 0.2, n=6, z0=-(hx - 0.1)), 'rust', T((0, 0, 0), (0, math.pi / 2, 0)))
        ax.extras = {'part': 'wheel', 'spin_axis': [1, 0, 0], 'radius': TRUCK_R, 'low_ratio': 0.2, 'low_min_tris': 600}
        part.children.append((ax, T((0, ay, TRUCK_R))))
    # lamps: rectangular sealed-beam pairs on the grille shell (lamp 'head'), 5 cab clearance lamps, markers, tails
    for nm, sx in (('logging_truck-hi_l', -1), ('logging_truck-hi_r', 1)):
        L_ = Part(nm, rng.sub(40 + sx))
        for dx in (0.0, 0.2):
            L_.add(box(0.17, 0.05, 0.12, 0.01, 1, center=(sx * (0.72 + dx), -10.28, 1.22)), 'chrome_pitted')
            L_.add(box(0.15, 0.012, 0.1, 0.004, 1, center=(sx * (0.72 + dx), -10.31, 1.22)), 'glass_grimy')
        L_.extras = {'lamp': 'head', 'beam': 'high', 'emissive_color': [1.0, 0.9, 0.72], 'kelvin': 3300, 'lm': 1500,
                     'aim_local': [0, -1, -0.01]}
        part.children.append((L_, T((0, 0, 0))))
    cl = Part('logging_truck-clearance', rng.sub(50))
    for k in range(5):
        cl.add(box(0.1, 0.05, 0.05, 0.01, 1, center=(-0.6 + 0.3 * k, -7.98, 3.08)), 'glass_grimy')
    cl.extras = {'lamp': 'clearance', 'emissive_color': [1.0, 0.45, 0.05]}
    part.children.append((cl, T((0, 0, 0))))
    mk = Part('logging_truck-markers', rng.sub(51))
    for (x, y, z) in ((-1.2, -9.4, 1.35), (1.2, -9.4, 1.35), (-1.25, -0.2, 1.0), (1.25, -0.2, 1.0)):
        mk.add(box(0.04, 0.12, 0.06, 0.008, 1, center=(x, y, z)), 'glass_grimy')
    mk.extras = {'lamp': 'marker', 'emissive_color': [1.0, 0.45, 0.05]}
    part.children.append((mk, T((0, 0, 0))))
    tl = Part('logging_truck-tail', rng.sub(52))
    for sx in (-1, 1):
        tl.add(box(0.2, 0.04, 0.1, 0.01, 1, center=(sx * 0.95, 8.97, 0.95)), 'glass_grimy')
    tl.extras = {'lamp': 'tail', 'emissive_color': [0.8, 0.03, 0.02]}
    part.children.append((tl, T((0, 0, 0))))
    for nm, sx in (('logging_truck-spray_l', -1), ('logging_truck-spray_r', 1)):
        anchor(part, nm, (sx * 1.3, -3.85, 0.35), {'spray': True})
    return [part]


# ------------------------------------------------------------------------------------------------ deer
@prop('deer', instance_keys=('headYaw', 'pose'), budget=2500)
def deer(p, rng):
    """Whitetail doe standing alert at the tree line: 1.6 m nose to tail, shoulder 0.95 m, head up, ears forward.
    Faces -y. One shared mesh; the head is a child node 'deer-head' pivoting at the neck top (extras head_yaw from
    the placement's `headYaw` param: the runtime turns it, so all three does share the mesh). Anchors -eye_l/_r
    (0.1 m apart, ~1.15 m up, eye_glint) carry the tapetum glint the runtime draws in the headlights."""
    part = Part('deer', rng)
    FUR = 'fur_deer'

    def trunk(u, v):
        a = u * math.tau
        y = -0.5 + 1.08 * v
        s = math.sin(math.pi * (0.02 + 0.96 * v)) ** 0.55
        chest = 1.0 + 0.18 * math.exp(-((v - 0.22) / 0.14) ** 2)       # deep chest behind the shoulder
        haunch = 1.0 + 0.12 * math.exp(-((v - 0.82) / 0.1) ** 2)
        rz = 0.19 * s * chest * haunch
        rx = 0.17 * s * (1.0 + 0.1 * math.exp(-((v - 0.8) / 0.12) ** 2))
        zc = 0.76 + 0.03 * math.exp(-((v - 0.15) / 0.12) ** 2) - 0.02 * v
        z = zc + rz * math.sin(a) * (0.92 if math.sin(a) < 0 else 1.0)   # belly flatter than the back
        return (rx * math.cos(a), y, z)
    part.add_grid(14, 14, trunk, FUR, closed_u=True, flip=True)
    # legs: front (shoulder - elbow - carpus - fetlock - hoof) and hind (hip - stifle - hock - fetlock - hoof)
    for sx in (-1, 1):
        fx = sx * 0.085
        fl = [(fx, -0.36, 0.72), (fx * 1.05, -0.35, 0.47), (fx, -0.37, 0.3), (fx, -0.385, 0.08), (fx, -0.4, 0.015)]
        part.add(tube(fl, 0.03, sides=6, radii=[2.4, 1.3, 0.85, 0.72, 0.8]), FUR)
        hx = sx * 0.09
        hl = [(hx, 0.4, 0.8), (hx * 1.1, 0.3, 0.56), (hx, 0.47, 0.38), (hx, 0.43, 0.09), (hx, 0.425, 0.015)]
        part.add(tube(hl, 0.03, sides=6, radii=[3.0, 1.8, 0.9, 0.72, 0.8]), FUR)
        for (x, y) in ((fx, -0.405), (hx, 0.42)):    # cloven hooves
            part.add(box(0.045, 0.06, 0.04, 0.008, 1, center=(x, y, 0.02)), 'rubber_black')
    # neck: thick at the chest, up and forward to the head
    nk = [(0, -0.4, 0.84), (0, -0.48, 0.97), (0, -0.54, 1.08), (0, -0.565, 1.13)]
    part.add(tube(nk, 0.06, sides=8, radii=[1.7, 1.35, 1.05, 0.95]), FUR)
    # tail: flat, held down (alert-but-not-fleeing)
    tl = [(0, 0.56, 0.86), (0, 0.62, 0.8), (0, 0.65, 0.7)]
    part.add(tube(tl, 0.03, sides=5, radii=[1.4, 1.2, 0.6],
                  section=[(-0.045, -0.012), (0.045, -0.012), (0.045, 0.012), (-0.045, 0.012)]), FUR)
    # head (child pivoting at the neck top)
    hd = Part('deer-head', rng.sub(3))

    def head(u, v):
        a = u * math.tau
        y = 0.02 - 0.27 * v
        s = math.sin(math.pi * (0.12 + 0.82 * v)) ** 0.6
        taper = 1.0 - 0.45 * v
        rx = 0.06 * s * taper
        rz = 0.065 * s * (1.0 - 0.35 * v)
        zc = 0.03 - 0.07 * v
        return (rx * math.cos(a), y, zc + rz * math.sin(a))
    hd.add_grid(10, 8, head, FUR, closed_u=True)
    hd.add(sphere(0.018, seg=6, rings=4), 'rubber_black', T((0, -0.25, -0.03)))     # nose pad
    for sx in (-1, 1):
        # ears: cupped leaves 0.15 m, up and out, opening forward (alert)
        def ear(u, v, sx=sx):
            w = 0.042 * math.sin(math.pi * min(1.0, 0.12 + 0.88 * v)) * (1 - 0.25 * v)
            x = (u - 0.5) * 2 * w                     # across the ear
            cup = 0.018 * (1 - (2 * u - 1) ** 2) * math.sin(math.pi * v)
            return (sx * (0.04 + 0.075 * v) + x * 0.95, -0.005 - cup, 0.055 + 0.13 * v - x * 0.3 * sx)
        hd.add_grid(3, 4, ear, FUR + '@2s')
        anchor(hd, f'deer-eye_{"l" if sx < 0 else "r"}', (sx * 0.05, -0.07, 0.035),
               {'eye_glint': True, 'glint_color': [0.85, 0.95, 0.75]})
    # instance_keys share one mesh/node set across the three does, so per-deer values live only in the root's
    # `params` (headYaw, pose): the runtime reads them there and turns this node ('pivot' is reserved by GLTFLoader)
    hd.extras = {'turn_joint': 'neck', 'yaw_param': 'headYaw'}
    part.children.append((hd, T((0, -0.565, 1.13))))
    part.extras = {'pose_param': 'pose', 'low_ratio': 0.6, 'low_min_tris': 400}
    return [part]
