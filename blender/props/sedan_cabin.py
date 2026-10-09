"""`sedan_interior` v2: the detailed cabin of the player's late-80s sedan (docs/C1-OPENING.md §6.1, docs/PROPS.md).

Built in CAR SPACE: origin = the ground under the body centre (same origin as the `sedan` prop), x right, y forward
(the nose is +y), z up from the road. Mounted in the moving sedan it sits at identity in car space (the sedan prop
itself is authored nose -y, so the runtime rotates it 180 deg about z); placed alone as the CAR set (P_CAR_INTERIOR,
yaw 0) the driver eye `DRIVER_EYE` (-0.35, -0.05, 1.12) is 1.12 m above the road and 0.19 m under the headliner.

Every glass edge, pillar and the roof line come from the exterior `sedan.Body` sections (car y = body x - 2.425,
car x = -body y), inset 15-40 mm, so the cabin fits the shell: windscreen body x 2.66-3.32, front door glass
-0.185..0.675, blacked-out B-pillar -0.305..-0.185, rear door glass -1.105..-0.305, backlite 0.77-1.12.
(The C1-OPENING table puts the B-pillar at y -0.62 and the windscreen at 0.20-0.935; the exterior wins.)

Reference class: generic 1985-89 US front-drive mid-size sedan, no badges. Tan vinyl (car_interior_tan; the C7
sting re-trims it maroon at runtime), black sun-crazed crash pad (vinyl_dash_black), nicotine-yellow knit headliner,
cut-pile carpet, colour-keyed tan two-spoke wheel with brushed spokes, 60/40 split bench with welted pleats.

Nodes (`sedan_interior.<name>` -> `P_CAR_INTERIOR-sedan_interior-<name>`): the contract children cluster, radio,
glovebox, steering, wiper_d, wiper_p, mirror, air_freshener_mount keep their names and extras; the v2 children are
listed in docs/PROPS.md. Extras axes (`rotate_axis`, `hinge_axis`, `slide_axis`, `pull_axis`, `spin_axis`) are in
the node's LOCAL Blender frame (z up); three: (x, z, -y), use Object3D.rotateOnAxis / translateOnAxis.

Lightmap (LM_CAR): the shell, seats and door cards are static and bake; moving parts, lamps, decals and every
`dressing: true` node (the clutter: cup, map, cassettes, receipts, cig pack, flashlight, keys, medal) stay
probe-lit, so the Low tier can decimate them and they cost no atlas space.
"""
import math

from mathutils import Matrix, Vector

from .kit import (Part, T, anchor, box, bisect, cyl, decal, extrude, jitter, lathe, prop, rect_section, rot_to,
                  sphere, tube, TAU)
from .sedan import Body, L

CY = L / 2                  # car y = body x - CY
B = Body()
EYE = Vector((-0.35, -0.05, 1.12))

# materials (material-spec ids)
DASH = 'vinyl_dash_black'
HEAD = 'headliner_cloth'
CARPET = 'carpet_auto'
PLAST = 'plastic_cluster'
CHROME = 'chrome_pitted'
RUB = 'rubber_black'
LENS = 'glass_grimy'


def kelvin(k):
    """Blackbody -> linear RGB, max 1 (same fit as house/scene_prep.kelvin_rgb)."""
    t = k / 100.0
    if t <= 66:
        r, g = 255, 99.4708025861 * math.log(t) - 161.1195681661
        b = 0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307
    else:
        r, g, b = 329.698727446 * ((t - 60) ** -0.1332047592), 288.1221695283 * ((t - 60) ** -0.0755148492), 255
    c = [(max(0.0, min(255.0, v)) / 255.0) ** 2.2 for v in (r, g, b)]
    m = max(c)
    return [round(v / m, 4) for v in c]


# ------------------------------------------------------------------------------------------------ exterior frame
def _bx(y):
    return min(L, max(0.0, y + CY))


def zt(y):
    """Exterior roof / glass centreline height at car y."""
    return B.zt(_bx(y))


def _f(y):
    x = _bx(y)
    return max(0.0, min(1.0, (B.zt(x) - B.belt(x) - 0.03) / 0.4))


def sec(y, k):
    """Exterior half-section point k (|x|, z) at car y (sedan.Body.section)."""
    return B.section(_bx(y))[k]


def ws_half(y):
    """Half width of the exterior windscreen / backlite opening (band 9: section point 9)."""
    return sec(y, 9)[0]


def side_top(y):
    """Inner side-glass top edge (|x|, z) at car y (exterior point 8 inset)."""
    x, z = sec(y, 8)
    return x - 0.012, z - 0.03


def side_bottom(y):
    x, z = sec(y, 7)
    return x - 0.012, z - 0.005


def ws_glass_half(y):
    """Half width of the interior windscreen at car y: 75 mm inside the side-glass / A-pillar line."""
    return side_top(y)[0] - 0.075


def ws_glass_edge(y):
    """(x, y, z) of the windscreen's right edge at nominal row y (mirror x for the left)."""
    x = ws_glass_half(y)
    yy = y - 0.05 * (x / 0.62) ** 2
    return x, yy, zt(yy) - 0.022 - 0.03 * (x / 0.62) ** 4


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0))) if e1 != e0 else (1.0 if x >= e1 else 0.0)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


# ------------------------------------------------------------------------------------------------ geometry helpers
def loft(part, rows, mat, flip=False, smooth_shade=True, closed_u=False):
    """Quad surface through rows[v][u] (3D points, equal lengths) with METRIC UV0 (cumulative edge lengths)."""
    if mat not in part.mats:
        part.mats.append(mat)
    mi = part.mats.index(mat)
    nv, nu = len(rows), len(rows[0])
    P = [[Vector(p) for p in r] for r in rows]
    U = [[0.0] * nu for _ in range(nv)]
    V = [[0.0] * nu for _ in range(nv)]
    for j in range(nv):
        for i in range(1, nu):
            U[j][i] = U[j][i - 1] + (P[j][i] - P[j][i - 1]).length
    for i in range(nu):
        for j in range(1, nv):
            V[j][i] = V[j - 1][i] + (P[j][i] - P[j - 1][i]).length
    ou, ov = part.rng.u(0, 3), part.rng.u(0, 3)
    base = len(part.verts)
    for r in P:
        part.verts.extend(v.copy() for v in r)
    cols = nu if closed_u else nu - 1
    for j in range(nv - 1):
        for i in range(cols):
            i2 = (i + 1) % nu
            q = [base + j * nu + i, base + j * nu + i2, base + (j + 1) * nu + i2, base + (j + 1) * nu + i]
            uv = [(U[j][i] + ou, V[j][i] + ov), (U[j][i2] + ou, V[j][i2] + ov),
                  (U[j + 1][i2] + ou, V[j + 1][i2] + ov), (U[j + 1][i] + ou, V[j + 1][i] + ov)]
            if flip:
                q, uv = q[::-1], uv[::-1]
            part.faces.append(q)
            part.face_mat.append(mi)
            part.face_smooth.append(smooth_shade)
            part.loop_uv.append(uv)
    return part


def quad(part, a, b, c, d, mat, uv_norm=False):
    """One quad a-b-c-d (CCW seen from the visible side)."""
    if mat not in part.mats:
        part.mats.append(mat)
    base = len(part.verts)
    pts = [Vector(p) for p in (a, b, c, d)]
    part.verts.extend(pts)
    part.faces.append([base, base + 1, base + 2, base + 3])
    part.face_mat.append(part.mats.index(mat))
    part.face_smooth.append(False)
    if uv_norm:
        part.loop_uv.append([(0, 0), (1, 0), (1, 1), (0, 1)])
    else:
        w = (pts[1] - pts[0]).length
        h = (pts[3] - pts[0]).length
        part.loop_uv.append([(0, 0), (w, 0), (w, h), (0, h)])
    return part


def rounded_rect(w, h, r, n=3):
    pts = []
    for cx, cy, a0 in ((w / 2 - r, -h / 2 + r, -math.pi / 2), (w / 2 - r, h / 2 - r, 0),
                       (-w / 2 + r, h / 2 - r, math.pi / 2), (-w / 2 + r, -h / 2 + r, math.pi)):
        for k in range(n + 1):
            a = a0 + (math.pi / 2) * k / n
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def frame_to(origin, xdir, ydir):
    """Matrix whose local x/y axes are xdir/ydir (z = x cross y) at origin."""
    x = Vector(xdir).normalized()
    y = Vector(ydir)
    y = (y - x * y.dot(x)).normalized()
    z = x.cross(y)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = Vector(origin)
    return m


def pillowed_box(sx, sy, sz, bevel_w, cuts_x, cuts_y=3, crown=0.0, grooves=(), groove_depth=0.0):
    """Upholstered block (base at z 0): bevelled box, top crowned, optional pleat grooves along y at x positions."""
    bm = box(sx, sy, sz, bevel_w, 3, cuts={1: cuts_y}, base=True)
    xs = [-sx / 2 + sx * (i + 1) / (cuts_x + 1) for i in range(cuts_x)]
    for g in grooves:
        xs += [g - 0.006, g, g + 0.006]
    bisect(bm, 0, sorted(set(round(x, 5) for x in xs if -sx / 2 + bevel_w < x < sx / 2 - bevel_w)))
    for v in bm.verts:
        if v.co.z > sz * 0.6:
            t = (v.co.z - sz * 0.6) / (sz * 0.4)
            ex = 1 - (2 * v.co.x / sx) ** 2
            ey = 1 - (2 * v.co.y / sy) ** 2
            v.co.z += crown * max(0.0, ex) * max(0.0, ey) * t
            for g in grooves:
                if abs(v.co.x - g) < 0.0015:
                    v.co.z -= groove_depth * t
    return bm


# ------------------------------------------------------------------------------------------------ shell
def _floor(part):
    """Molded carpet: rear footwell -> under the bench -> front footwell -> toe board -> firewall; small tunnel."""
    ys = [-1.30, -1.22, -1.05, -0.85, -0.78, -0.62, -0.40, -0.20, -0.10, 0.10, 0.30, 0.45, 0.55, 0.65, 0.75, 0.85,
          0.92, 0.97]
    zy = {-1.30: 0.34, -1.22: 0.30, -1.05: 0.285, -0.85: 0.285, -0.78: 0.29, -0.62: 0.30, -0.40: 0.305, -0.20: 0.30,
          -0.10: 0.292, 0.10: 0.29, 0.30: 0.29, 0.45: 0.292, 0.55: 0.30, 0.65: 0.335, 0.75: 0.38, 0.85: 0.43,
          0.92: 0.47, 0.97: 0.56}
    xs = [-0.735 + 1.47 * i / 28 for i in range(29)]
    rows = []
    for y in ys:
        r = []
        for x in xs:
            ax = abs(x)
            z = zy[y]
            z += 0.075 * (1 - smooth(0.10, 0.19, ax)) * smooth(-1.25, -1.0, y) * (1 - smooth(0.80, 0.95, y))  # tunnel
            z += 0.07 * smooth(0.64, 0.735, ax)                                                     # up to the sill
            r.append((x, y, z))
        rows.append(r)
    loft(part, rows, CARPET)
    # loose rubber floor mats, front footwells
    for xc in (-0.33, 0.36):
        part.add(box(0.42, 0.38, 0.006, 0.003, 1, cuts={0: 3, 1: 3}, base=True), RUB,
                 T((xc, 0.27, 0.2905), (0, 0, math.radians(-4 if xc < 0 else 3))))
    # sill scuff plates (chrome), each side, under the door cards
    for s in (-1, 1):
        part.add(box(0.025, 1.85, 0.012, 0.004, 1, base=True), CHROME, T((s * 0.722, -0.36, 0.352)))


def _door_cards(part, trim):
    """Front door y -0.245..0.90, rear door -0.805..-0.245 (exterior shut lines), quarter trim behind to the C-pillar.
    Card face x +-0.715 with a pleated upper insert, sill cap rolling out to the glass, armrests, chrome inside
    handles, window cranks, lock knobs, map pocket, kick-panel speaker grille."""
    for s in (-1, 1):
        # card cross-section (|x|, z) bottom -> sill cap -> glass
        prof = [(0.735, 0.31), (0.722, 0.34), (0.712, 0.42), (0.71, 0.56), (0.714, 0.63), (0.716, 0.70),
                (0.716, 0.835), (0.722, 0.862), (0.736, 0.878), (0.756, 0.884), (0.768, 0.888)]
        y0, y1 = -1.33, 0.88
        ny = 70
        rows = []
        pleat_lo, pleat_hi = 0.70, 0.835
        for i in range(ny + 1):
            y = lerp(y0, y1, i / ny)
            r = []
            for (ax, z) in prof:
                xg = side_bottom(y)[0]
                axx = ax if ax < 0.75 else min(ax, xg - 0.002)
                # card bows out a little toward the front (follows the body side)
                r.append((s * axx, y, z))
            rows.append(r)
        loft(part, rows, trim, flip=(s < 0))
        # pleated upper inserts: 75 mm flutes, rounded crowns, sharp sewn grooves (6 samples per pleat)
        for (ya, yb) in ((-0.78, -0.27), (-0.22, 0.80)):
            n = int((yb - ya) / 0.0125)
            rows = []
            for i in range(n + 1):
                y = lerp(ya, yb, i / n)
                fr = ((y - ya) / 0.075) % 1.0
                bump = 0.0055 * (1 - (2 * fr - 1) ** 2) ** 0.6
                rows.append([(s * (0.7155 - bump * w), y, z) for z, w in ((pleat_lo, 0.0), (pleat_lo + 0.012, 0.8),
                                                                           (pleat_hi - 0.012, 0.8), (pleat_hi, 0.0))])
            loft(part, rows, trim, flip=(s < 0))
        # quarter trim behind the rear door up to the C-pillar, and the A-pillar foot ahead of the front door
        # door shut gaps (dark) at the B-pillar and rear door end
        for yg in (-0.245, -0.805):
            part.add(box(0.004, 0.006, 0.55, 0.001, 1, base=True), RUB, T((s * 0.712, yg, 0.32)))
        # armrests (front long, rear short) with a pull cup
        for (ya, yb, z) in ((-0.36, 0.08, 0.66), (-0.76, -0.40, 0.655)):
            ln = yb - ya
            arm = box(0.07, ln, 0.06, 0.022, 2, cuts={1: 2}, base=True)
            for v in arm.verts:   # taper toward the front, droop at the front end
                t = (v.co.y + ln / 2) / ln
                v.co.x *= lerp(1.0, 0.75, t)
                v.co.z -= 0.012 * t * t
            part.add(arm, trim, T((s * (0.716 - 0.035), (ya + yb) / 2, z - 0.06)))
            part.add(box(0.03, 0.10, 0.025, 0.008, 2), PLAST, T((s * 0.70, ya + 0.12, z - 0.075)))   # pull cup
        # inside door handles: chrome lever in a recessed black bezel
        for yh in (0.62, -0.42):
            part.add(box(0.012, 0.15, 0.05, 0.006, 2), PLAST, T((s * 0.712, yh, 0.80)))
            lever = tube([(0, -0.055, 0), (0, 0.04, 0.002), (-0.012, 0.058, 0.0)], 0.006, section=rect_section(
                0.011, 0.016, 0.004))
            part.add(lever, CHROME, T((s * 0.707, yh, 0.80)) @ (T(scale=(-1, 1, 1)) if s < 0 else Matrix()))
        # window cranks: chrome arm + black knob (dynamic look not needed)
        for yc in (0.20, -0.60):
            o = Vector((s * 0.712, yc, 0.735))
            part.add(cyl(0.022, 0.012, n=14, bevel_w=0.003), CHROME, T(tuple(o), (0, s * math.pi / 2, 0)))
            arm = tube([(0, 0, 0), (0, -0.085, -0.03)], 0.005, section=rect_section(0.01, 0.006, 0.002))
            part.add(arm, CHROME, T(tuple(o + Vector((-s * 0.012, 0, 0)))))
            part.add(cyl(0.011, 0.035, n=10, bevel_w=0.004), PLAST,
                     T(tuple(o + Vector((-s * 0.012, -0.085, -0.03))), (0, s * math.pi / 2, 0)))
        # lock knobs on the sill cap
        for yk in (-0.08, -0.72):
            part.add(cyl(0.0065, 0.03, n=10, r_top=0.0058, bevel_w=0.003), CHROME, T((s * 0.738, yk, 0.875)))
        # carpeted lower strip on each door + bright trim lines (insert top, carpet top)
        for (ya, yb) in ((-0.80, -0.25), (-0.24, 0.84)):
            ln = yb - ya
            part.add(box(0.012, ln, 0.10, 0.004, 2, cuts={1: 4}, base=True), CARPET,
                     T((s * 0.707, (ya + yb) / 2, 0.325)))
            part.add(box(0.006, ln, 0.006, 0.002, 1), CHROME, T((s * 0.7035, (ya + yb) / 2, 0.428)))
            if ya > -0.5:
                part.add(box(0.005, ln - 0.06, 0.005, 0.002, 1), CHROME, T((s * 0.7115, (ya + yb) / 2, 0.698)))
        # map pocket on the front door
        part.add(box(0.03, 0.55, 0.12, 0.012, 2, base=True), trim, T((s * 0.698, 0.36, 0.36)))
        # kick-panel speaker grille ahead of the front door
        g = cyl(0.062, 0.012, n=20, bevel_w=0.004)
        part.add(g, PLAST, T((s * 0.70, 0.86, 0.43), (0, s * math.pi / 2, 0)))
        for k in range(5):
            part.add(box(0.003, 0.085 - abs(k - 2) * 0.012, 0.004, 0.001, 1), RUB,
                     T((s * 0.692, 0.86, 0.43 - 0.03 + k * 0.015)))


def _glass_and_pillars(part, trim, glass):
    """Windscreen, side glass, backlite (one glass_rain primitive: cutscene-fx finds the windscreen by material and
    normal), A-pillar trims, B-pillar with the belt, roof rails, C-pillar / quarter trim, parcel shelf."""
    # windscreen inner glass, 22 mm under the outer surface. Real 80s glass runs to ~0.08 m inside the side-glass
    # line (the exterior shell's band 9 is narrower; from inside its paint band is back-facing, i.e. culled).
    rows = []
    for j in range(9):
        y = lerp(0.895, 0.215, j / 8)
        hw = ws_glass_half(y)
        r = []
        for i in range(11):
            x = lerp(-hw, hw, i / 10)
            yy = y - 0.05 * (x / 0.62) ** 2           # the glass wraps back at the sides
            r.append((x, yy, zt(yy) - 0.022 - 0.03 * (x / 0.62) ** 4))
        rows.append(r)
    loft(part, rows, glass)
    # backlite (body x 0.77-1.12 -> y -1.655..-1.305)
    rows = []
    for j in range(7):
        y = lerp(-1.67, -1.29, j / 6)
        hw = ws_half(y) + 0.02
        r = []
        for i in range(7):
            x = lerp(hw, -hw, i / 6)
            yy = y + 0.03 * (x / 0.5) ** 2
            r.append((x, yy, zt(yy) - 0.024))
        rows.append(r)
    loft(part, rows, glass)
    # side glass each side: front door -0.185..0.675, rear -1.105..-0.305 (follows the exterior band 7)
    for s in (-1, 1):
        for (ya, yb) in ((-1.105, -0.305), (-0.185, 0.675)):
            rows = []
            for j in range(5):
                v = j / 4
                r = []
                for i in range(12):
                    y = lerp(ya, yb, i / 11)
                    xb, zb = side_bottom(y)
                    xt, ztp = side_top(y)
                    r.append((s * lerp(xb, xt, v), y, lerp(zb, ztp, v)))
                rows.append(r)
            loft(part, rows, glass, flip=(s > 0))
    # A-pillar trims: from under the windscreen edge to over the side-glass top, cowl -> header, plus the sail
    # panel that closes the door-card top to the (rising) side-glass bottom at the front of the door
    for s in (-1, 1):
        rows = []
        for j in range(12):
            y = lerp(0.885, 0.19, j / 11)
            xg, yg, zg = ws_glass_edge(y)
            xs, zs = side_top(y)
            inner = Vector((s * (xg - 0.025), yg - 0.004, zg - 0.006))
            outer = Vector((s * (xs - 0.006), y, zs - 0.012))
            mid = inner.lerp(outer, 0.5) + Vector((0, -0.015, -0.028))
            rows.append([tuple(inner), tuple(inner.lerp(mid, 0.6)), tuple(mid), tuple(mid.lerp(outer, 0.5)),
                         tuple(outer)])
        loft(part, rows, trim, flip=(s < 0))
        if s < 0:   # remote mirror control on the driver's sail: chrome lever in a black bezel
            mc = Vector((-0.772, 0.62, 0.925))
            part.add(box(0.014, 0.045, 0.04, 0.006, 2), PLAST, T(tuple(mc), (0, math.radians(-35), 0)))
            part.add(tube([tuple(mc + Vector((0.006, 0, 0.004))), tuple(mc + Vector((0.03, -0.006, 0.016)))],
                          0.0035, sides=8), CHROME)
            part.add(sphere(0.0055, 10, 6), CHROME, T(tuple(mc + Vector((0.032, -0.006, 0.017)))))
        rows = []
        for j in range(9):
            y = lerp(0.35, 0.885, j / 8)
            xb, zb = side_bottom(y) if y <= 0.675 else side_top(y)
            rows.append([(s * 0.756, y, 0.884), (s * 0.767, y, 0.888), (s * (xb - 0.004), y, max(0.89, zb - 0.004))])
        loft(part, rows, trim, flip=(s < 0))
    # roof rails above the side glass (cover the headliner edge), cowl to the C-pillar
    for s in (-1, 1):
        pts = []
        for k in range(16):
            y = lerp(0.20, -1.25, k / 15)
            xt, ztp = side_top(y)
            pts.append((s * (xt - 0.012), y, ztp + 0.008))
        part.add(tube(pts, 0.02, section=rect_section(0.035, 0.045, 0.012)), trim)
    # B-pillar trim + seatbelt (stowed): D-ring at z 1.18, webbing to the retractor at the floor
    for s in (-1, 1):
        yb = -0.245
        xb0, zb0 = side_bottom(yb)
        xt0, zt0 = side_top(yb)
        pillar = tube([(s * (xb0 - 0.02), yb, 0.80), (s * (xt0 - 0.018), yb, zt0 + 0.01)], 0.03,
                      section=rect_section(0.034, 0.13, 0.012))
        part.add(pillar, trim)
        # lower B-pillar (between the door cards) down to the floor
        part.add(box(0.03, 0.12, 0.52, 0.01, 2, base=True), trim, T((s * 0.722, yb, 0.30)))
        dring = Vector((s * 0.692, yb - 0.005, 1.18))
        part.add(box(0.012, 0.06, 0.03, 0.005, 2), PLAST, T(tuple(dring)))
        web = [dring + Vector((-s * 0.006, -0.012, -0.01)), Vector((s * 0.70, yb - 0.035, 0.95)),
               Vector((s * 0.71, yb - 0.04, 0.60)), Vector((s * 0.712, yb - 0.04, 0.36))]
        part.add(tube([tuple(p) for p in web], 0.004, section=rect_section(0.003, 0.048, 0.001)), trim)
        part.add(box(0.012, 0.03, 0.06, 0.004, 2), CHROME, T((s * 0.704, yb - 0.045, 0.70)))   # latch tongue
        part.add(box(0.06, 0.10, 0.11, 0.015, 2, base=True), PLAST, T((s * 0.70, yb - 0.04, 0.29)))   # retractor
    # C-pillar / rear quarter trim (behind the rear glass to the backlite) and the parcel shelf
    for s in (-1, 1):
        rows = []
        for j in range(8):
            y = lerp(-1.10, -1.70, j / 7)
            xb, zb = side_bottom(-1.10)
            xt, ztp = side_top(y)
            xw = ws_half(y) + 0.02 if y < -1.29 else xt
            zw = zt(y) - 0.026
            rows.append([(s * (xb - 0.01), y, 0.86), (s * (xb - 0.004), y, zb + 0.01), (s * (xt - 0.004), y, ztp - 0.005),
                         (s * max(xw - 0.02, 0.1), y, zw - 0.01)])
        loft(part, rows, trim, flip=(s > 0))
    shelf = box(1.40, 0.36, 0.02, 0.006, 2, cuts={0: 6, 1: 2}, base=True)
    part.add(shelf, CARPET, T((0, -1.49, 0.925)))
    for sx in (-0.42, 0.42):   # 6x9 oval speaker grilles
        oval = extrude([(0.115 * math.cos(a), 0.075 * math.sin(a)) for a in [TAU * k / 20 for k in range(20)]], 0.006)
        part.add(oval, PLAST, T((sx, -1.52, 0.944)))


def _headliner(part, trim):
    """Foam-backed knit headliner: z 1.31 front, 1.30 mid, 1.29 rear, rolling down into the roof rails, a 30 mm sag
    bubble near the rear window; the padded front header and the sun-visor clips."""
    rows = []
    ny, nx = 26, 22
    for j in range(ny + 1):
        y = lerp(0.215, -1.31, j / ny)
        xt, ztp = side_top(y)
        r = []
        for i in range(nx + 1):
            u = i / nx
            x = lerp(-(xt - 0.02), xt - 0.02, u)
            ax = abs(x) / (xt - 0.02)
            z = 1.31 - 0.02 * (0.215 - y) / 1.525
            z -= (z - (ztp + 0.0)) * smooth(0.72, 1.0, ax) ** 1.4
            z -= 0.03 * math.exp(-((x - 0.18) / 0.22) ** 2 - ((y + 1.08) / 0.14) ** 2)   # sag bubble
            z -= 0.004 * math.sin(x * 9.0 + y * 3.0) * smooth(-0.6, -1.3, y)               # slack waves at the rear
            r.append((x, y, min(z, zt(y) - 0.035)))
        rows.append(r)
    loft(part, rows, HEAD)
    # padded header across the windscreen top
    pts = [(x, 0.205 + 0.03 * (x / 0.5) ** 2 * 0.3, min(1.302, zt(0.205) - 0.045)) for x in
           [lerp(-0.62, 0.62, k / 12) for k in range(13)]]
    part.add(tube(pts, 0.02, section=rect_section(0.045, 0.03, 0.012)), HEAD)
    for s in (-1, 1):   # visor clips either side of the mirror
        part.add(box(0.025, 0.02, 0.015, 0.006, 2), PLAST, T((s * 0.17, 0.17, 1.29)))


def _dash_profiles():
    """Crash-pad cross-sections (y, z) from the windscreen base to the firewall: the normal section and the binnacle
    section (hood + cluster recess), 17 points each. The pad top stays 4-30 mm under the inner windscreen, which
    meets the cowl at a shallow angle (sedan.Body zt is smoothstepped into 0.90 at body x 3.36)."""
    normal = [(0.885, 0.878), (0.84, 0.891), (0.78, 0.906), (0.70, 0.925), (0.625, 0.935), (0.578, 0.930),
              (0.554, 0.909), (0.548, 0.88), (0.55, 0.84), (0.553, 0.79), (0.556, 0.74), (0.558, 0.69),
              (0.56, 0.64), (0.568, 0.602), (0.60, 0.586), (0.72, 0.58), (0.885, 0.58)]
    recess = [(0.885, 0.878), (0.84, 0.891), (0.78, 0.912), (0.70, 0.94), (0.645, 0.956), (0.612, 0.953),
              (0.602, 0.938), (0.618, 0.924), (0.70, 0.906), (0.748, 0.892), (0.716, 0.70), (0.62, 0.692),
              (0.559, 0.686), (0.56, 0.64), (0.568, 0.602), (0.60, 0.586), (0.885, 0.58)]
    return normal, recess


HOOD_X = (-0.605, -0.135)     # binnacle recess walls (cluster face 0.46 wide between them)


def hood_w(x):
    return smooth(-0.70, -0.62, x) * (1 - smooth(-0.12, -0.04, x))


def dash_point(x, k, rec=False):
    """Point k of the crash-pad section at x (car space), with the hood blend, the glass wrap and the end sweep."""
    normal, recess = _dash_profiles()
    w = hood_w(x)
    if rec:
        y, z = recess[k]
    elif k <= 6:
        y, z = lerp(normal[k][0], recess[k][0], w), lerp(normal[k][1], recess[k][1], w)
    elif k == 7 and w > 0:
        y, z = lerp(normal[7][0], 0.596, w), lerp(normal[7][1], 0.92, w)
    else:
        y, z = normal[k]
    ax = abs(x)
    if k <= 4:                                  # follow the windscreen wrap, stay under the glass
        y -= 0.05 * min(1.0, (x / 0.62) ** 2)
        if ax < 0.72:
            z = min(z, zt(y) - 0.028 - 0.03 * min(1.3, (x / 0.62) ** 4))
    return (x, y, z)


def face_y(x, z):
    """Driver-facing dash face y at (x, z) (normal section points 7-13)."""
    pts = [dash_point(x, k) for k in range(7, 14)]
    for a, b in zip(pts, pts[1:]):
        if b[2] <= z <= a[2]:
            return lerp(a[1], b[1], (a[2] - z) / (a[2] - b[2]))
    return pts[0][1] if z > pts[0][2] else pts[-1][1]


def _poly(part, pts, mat, want):
    """One planar n-gon facing `want` (Newell normal flipped to match)."""
    P = [Vector(p) for p in pts]
    n = Vector((0, 0, 0))
    for a, b in zip(P, P[1:] + P[:1]):
        n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
    if n.dot(Vector(want)) < 0:
        P = P[::-1]
    if mat not in part.mats:
        part.mats.append(mat)
    base = len(part.verts)
    part.verts.extend(P)
    part.faces.append(list(range(base, base + len(P))))
    part.face_mat.append(part.mats.index(mat))
    part.face_smooth.append(False)
    part.loop_uv.append([(p.y, p.z) for p in P])


def _dash(part, rng):
    """Crash pad + binnacle hood + cluster recess, defroster grille, dash-end vents, sun cracks, woodgrain band,
    centre stack face, knee bolster, pedals."""
    left = [-0.80, -0.76, -0.72, -0.69, -0.67, -0.65, -0.635, -0.62, HOOD_X[0]]
    mid = [lerp(HOOD_X[0], HOOD_X[1], k / 8) for k in range(9)]
    right = [HOOD_X[1], -0.12, -0.10, -0.08, -0.06, -0.04] + [lerp(-0.02, 0.80, k / 16) for k in range(17)]
    for xs, rec in ((left, False), (mid, True), (right, False)):
        loft(part, [[dash_point(x, k, rec) for k in range(17)] for x in xs], DASH)
    # recess side walls: the region between the hood-cheek section and the recess section at each wall
    for x, want in ((HOOD_X[0], (1, 0, 0)), (HOOD_X[1], (-1, 0, 0))):
        a = [dash_point(x, k) for k in range(6, 12)]
        b = [dash_point(x, k, True) for k in range(7, 12)]
        _poly(part, a + b[::-1], DASH, want)
    # end caps where the pad meets the door line
    for x, want in ((-0.80, (1, 0, 0)), (0.80, (-1, 0, 0))):      # seen from inside the cabin
        _poly(part, [dash_point(x, k) for k in range(17)], DASH, want)
    # defroster grille: a dark slot with 24 slats along the windscreen base
    for k in range(25):
        x = lerp(-0.55, 0.55, k / 24)
        y = 0.765 - 0.035 * (x / 0.5) ** 2
        part.add(box(0.004, 0.045, 0.004, 0.001, 1), PLAST, T((x, y, _dash_top(y, x) + 0.002)))
    for k in range(7):
        x0 = lerp(-0.56, 0.56, k / 7)
        x1 = lerp(-0.56, 0.56, (k + 1) / 7)
        xm = (x0 + x1) / 2
        y = 0.765 - 0.035 * (xm / 0.5) ** 2
        part.add(box(x1 - x0 + 0.002, 0.05, 0.003, 0.001, 1), RUB, T((xm, y, _dash_top(y, xm) + 0.0005)))
    # dash-end vents (louvred) and two centre vents above the radio
    for xc in (-0.69, 0.71, -0.02, 0.10):
        ww = 0.10 if abs(xc) > 0.5 else 0.09
        yv = face_y(xc, 0.815)
        part.add(box(ww + 0.012, 0.012, 0.06, 0.004, 2), PLAST, T((xc, yv - 0.003, 0.815)))
        for k in range(4):
            part.add(box(ww, 0.016, 0.004, 0.001, 1), RUB, T((xc, yv - 0.009, 0.795 + k * 0.013), (0.35, 0, 0)))
    # dash-top speaker grille (centre) and the stitched seam along the pad's roll edge
    gy = 0.665
    gz = _dash_top(gy, 0.0)
    part.add(box(0.17, 0.085, 0.004, 0.0015, 1), PLAST, T((0.0, gy, gz + 0.0005)))
    for k in range(9):
        part.add(box(0.15, 0.004, 0.0015, 0.0005, 1), RUB, T((0.0, gy - 0.032 + k * 0.008, gz + 0.0026)))
    seam = [dash_point(x, 5) for x in [lerp(-0.79, 0.79, k / 40) for k in range(41)]]
    seam = [(x, y - 0.002, z + 0.0012) for x, y, z in seam]
    part.add(tube(seam, 0.0011, sides=4), RUB)
    # sun cracks: three jagged splits in the pad by the defroster vent (geometry, 2-4 mm, dark)
    crng = rng.sub('cracks')
    for (x0, y0, ln, ang) in ((0.10, 0.70, 0.22, 0.4), (0.30, 0.66, 0.18, -0.6), (-0.05, 0.74, 0.12, 1.2)):
        pts = []
        for k in range(9):
            t = k / 8
            x = x0 + math.cos(ang) * ln * t + crng.j(0.006)
            y = y0 + math.sin(ang) * ln * t * 0.5 + crng.j(0.006)
            z = _dash_top(y, x) + 0.0012
            pts.append((x, y, z))
        part.add(tube(pts, 0.0015, section=[(-0.0016, 0), (0.0016, 0), (0.0008, 0.0012), (-0.0008, 0.0012)],
                      caps=True), RUB)
    # woodgrain applique band on the passenger dash face (80s), chrome edge lines
    xs = [lerp(0.15, 0.76, k / 12) for k in range(13)]
    rows = [[(x, face_y(x, z) - 0.006, z) for z in (0.801, 0.803, 0.842, 0.844)] for x in xs]
    loft(part, rows, 'wood_furniture_dark', flip=True)
    for zz in (0.8, 0.845):
        part.add(tube([(x, face_y(x, zz) - 0.0065, zz) for x in xs], 0.0018, sides=5), CHROME)
    # centre stack face (radio / HVAC / ashtray frame)
    part.add(box(0.22, 0.012, 0.25, 0.008, 2), PLAST, T((0.03, face_y(0.03, 0.67) - 0.002, 0.665)))
    # knee bolster under the column
    kb = box(0.62, 0.08, 0.10, 0.03, 3, cuts={0: 3})
    part.add(kb, DASH, T((-0.40, 0.62, 0.545)))
    # pedals: brake (wide, automatic), accelerator, parking-brake pedal, hood release
    part.add(box(0.11, 0.025, 0.07, 0.008, 2), RUB, T((-0.24, 0.66, 0.43), (math.radians(-25), 0, 0)))
    part.add(tube([(-0.24, 0.68, 0.46), (-0.24, 0.74, 0.58)], 0.008, sides=6), CHROME)
    part.add(box(0.065, 0.02, 0.13, 0.006, 2), RUB, T((-0.10, 0.80, 0.38), (math.radians(-55), 0, 0)))
    part.add(box(0.07, 0.02, 0.05, 0.006, 2), RUB, T((-0.60, 0.70, 0.46), (math.radians(-30), 0, 0)))
    part.add(box(0.05, 0.03, 0.02, 0.006, 2), PLAST, T((-0.66, 0.66, 0.52)))   # hood release


def _dash_top(y, x=0.3):
    """Crash-pad top height at (x, y) (section points 0-5 at that x)."""
    pts = sorted((p[1], p[2]) for p in (dash_point(x, k) for k in range(6)))
    for (y0, z0), (y1, z1) in zip(pts, pts[1:]):
        if y0 <= y <= y1:
            return lerp(z0, z1, (y - y0) / (y1 - y0))
    return pts[-1][1] if y > pts[-1][0] else pts[0][1]


# ------------------------------------------------------------------------------------------------ instruments
CL_C = Vector((-0.37, 0.7255, 0.785))     # cluster face centre (on the recess back wall)
CL_W, CL_H = 0.46, 0.15
CL_TILT = math.atan2(0.748 - 0.716, 0.892 - 0.70)   # back wall lean (top further away)
CL_UP = Vector((0, math.sin(CL_TILT), math.cos(CL_TILT)))
CL_N = Vector((0, -math.cos(CL_TILT), math.sin(CL_TILT)))     # face normal (toward the driver, up)


def cl_point(u, v, off=0.0):
    """Point on the cluster face at canvas UV (u 0..1 left->right, v 0..1 bottom->top), `off` m along the normal."""
    return CL_C + Vector((1, 0, 0)) * ((u - 0.5) * CL_W) + CL_UP * ((v - 0.5) * CL_H) + CL_N * off


def _cluster_frame():
    return frame_to(CL_C, (1, 0, 0), CL_UP)


DIALS = {   # canvas UV centre, radius (UV of height), story rest value, scale
    'speedo': {'uv': (0.30, 0.45), 'r': 0.40, 'zero_deg': -126.0, 'deg_per_unit': 2.1, 'range': [0, 120],
               'unit': 'mph', 'rest': 0.0, 'len': 0.052},
    'fuel': {'uv': (0.72, 0.40), 'r': 0.31, 'zero_deg': -45.0, 'deg_per_unit': 90.0, 'range': [0, 1],
             'unit': 'tank', 'rest': -7.0 / 90.0, 'len': 0.036},
    'temp': {'uv': (0.89, 0.40), 'r': 0.22, 'zero_deg': -45.0, 'deg_per_unit': 90.0, 'range': [0, 1],
             'unit': 'C..H', 'rest': 0.45, 'len': 0.026},
}
WARN = [   # id, canvas uv, emissive (linear), node suffix
    ('turn_l', (0.045, 0.86), [0.10, 0.85, 0.20]), ('turn_r', (0.555, 0.86), [0.10, 0.85, 0.20]),
    ('hibeam', (0.30, 0.17), [0.10, 0.25, 1.00]), ('fuel', (0.72, 0.13), [1.00, 0.45, 0.02]),
    ('ses', (0.83, 0.13), [1.00, 0.45, 0.02]), ('batt', (0.48, 0.13), [1.00, 0.04, 0.02]),
    ('oil', (0.53, 0.13), [1.00, 0.04, 0.02]), ('brake', (0.58, 0.13), [1.00, 0.04, 0.02]),
    ('belts', (0.63, 0.13), [1.00, 0.04, 0.02]),
]


def _instruments(part, rng):
    fr = _cluster_frame()
    # the existing contract node: one quad, decal `gauges`, 0..1 UV (canvas drawn at runtime)
    cluster = Part('sedan_interior.cluster', rng)
    cluster.add_grid(1, 1, lambda u, v: ((u - 0.5) * CL_W, (v - 0.5) * CL_H, 0.0), PLAST)
    cluster.extras = {'decal': 'gauges', 'fuelNeedle': 'below_E', 'text_param': 'fuelNeedle', 'lamp': 'dashboard',
                      'dials': {k: {'uv': list(d['uv']), 'r_uv': d['r']} for k, d in DIALS.items()},
                      'canvas_px': [512, 167]}
    # local frame: x along the face, y = face up, z = face normal (toward the driver's eye)
    part.children.append((cluster, frame_to(cl_point(0.5, 0.5, 0.0015), (1, 0, 0), CL_UP)))
    # needles (3D, orange-red, origin on the pivot; modelled at the story rest value)
    for gid, d in DIALS.items():
        n = Part(f'sedan_interior.needle_{gid}', rng)
        ln = d['len']
        nb = extrude([(-0.0012, -0.006), (0.0012, -0.006), (0.0006, ln), (-0.0006, ln)], 0.0012)
        n.add(nb, 'enamel_chipped', T((0, 0, 0.0018)))
        n.add(cyl(0.0055 if gid == 'speedo' else 0.0045, 0.004, n=14, bevel_w=0.0015), PLAST, T((0, 0, 0.0)))
        rest_deg = d['zero_deg'] + d['rest'] * d['deg_per_unit']
        n.extras = {'part': 'needle', 'gauge': gid, 'rotate_axis': [0, 0, 1], 'zero_deg': d['zero_deg'],
                    'deg_per_unit': d['deg_per_unit'], 'range': d['range'], 'unit': d['unit'],
                    'rest_deg': round(rest_deg, 2), 'positive': 'clockwise seen from the driver',
                    'emissive_color': [0.95, 0.35, 0.12], 'lamp': 'needle'}
        # local frame: x along the face, y = face up, z = face normal (toward the driver); rotate clockwise by rest
        m = frame_to(cl_point(*d['uv'], 0.002), (1, 0, 0), CL_UP) @ T((0, 0, 0), (0, 0, -math.radians(rest_deg)))
        part.children.append((n, m))
        # chrome dial ring
        ring = [(math.cos(a) * d['r'] * CL_H, math.sin(a) * d['r'] * CL_H, 0.0) for a in
                [TAU * k / 32 for k in range(32)]]
        part.add(tube(ring, 0.0012, sides=4, closed=True), CHROME, frame_to(cl_point(*d['uv'], 0.003), (1, 0, 0), CL_UP))
    # warning lamps: 12 x 8 mm windows, 1 mm proud
    for wid, (u, v), col in WARN:
        lp = Part(f'sedan_interior.lamp_{wid}', rng)
        lp.add_grid(1, 1, lambda uu, vv: ((uu - 0.5) * 0.012, (vv - 0.5) * 0.008, 0.0), LENS)
        lp.extras = {'lamp': 'warn', 'warn': wid, 'emissive_color': col}
        part.children.append((lp, frame_to(cl_point(u, v, 0.001), (1, 0, 0), CL_UP)))
    # odometer + PRNDL strips (decal `gauges` sub-keys)
    for key, (u, v), (w, h) in (('odo', (0.30, 0.30), (0.05, 0.011)), ('prndl', (0.30, 0.05), (0.12, 0.011))):
        dp = Part(f'sedan_interior.{"odometer" if key == "odo" else "prndl"}', rng)
        dp.add_grid(1, 1, lambda uu, vv, w=w, h=h: ((uu - 0.5) * w, (vv - 0.5) * h, 0.0), PLAST)
        dp.extras = {'decal': 'gauges', 'gauges': key, 'decal_size_m': [w, h], 'lamp': 'dashboard'}
        part.children.append((dp, frame_to(cl_point(u, v, 0.0016), (1, 0, 0), CL_UP)))
    # bezel frame round the face
    bz = [cl_point(u, v, 0.004) for u, v in ((-0.01, -0.03), (1.01, -0.03), (1.01, 1.03), (-0.01, 1.03))]
    part.add(tube([tuple(p) for p in bz], 0.006, section=rect_section(0.012, 0.008, 0.003), closed=True), PLAST)
    # clear lens 15 mm in front, tilted 20 deg, slightly bowed
    lens = Part('sedan_interior.cluster_lens', rng)
    t20 = math.radians(20)
    up20 = Vector((0, math.sin(t20), math.cos(t20)))
    c = cl_point(0.5, 0.5, 0.017)
    lens.add_grid(6, 2, lambda u, v: tuple((u - 0.5) * 0.48 * Vector((1, 0, 0)) + up20 * ((v - 0.5) * 0.165)
                                           + Vector((0, -0.006 * math.sin(math.pi * u), 0))), LENS)
    lens.extras = {'lens': 'cluster', 'scratches': 0.3}
    part.children.append((lens, T(tuple(c))))


def _radio_hvac(part, rng):
    radio = Part('sedan_interior.radio', rng)
    radio.add(box(0.178, 0.02, 0.050, 0.003, 2), PLAST)
    radio.add(box(0.17, 0.10, 0.046, 0.002, 1), PLAST, T((0, 0.06, 0)))
    for sx in (-1, 1):   # volume / tune knobs with chrome caps
        radio.add(cyl(0.0085, 0.014, n=14, bevel_w=0.002), PLAST, T((sx * 0.075, -0.012, 0.0), (math.pi / 2, 0, 0)))
        radio.add(cyl(0.006, 0.002, n=12), CHROME, T((sx * 0.075, -0.026, 0.0), (math.pi / 2, 0, 0)))
    for k in range(5):   # preset buttons
        radio.add(box(0.012, 0.008, 0.007, 0.002, 1), PLAST, T((-0.04 + k * 0.016, -0.012, -0.016)))
    radio.extras = {'part': 'radio', 'kind': 'cassette', 'lamp': 'dashboard'}
    part.children.append((radio, T((0.03, face_y(0.03, 0.725) - 0.012, 0.725))))
    vfd = Part('sedan_interior.radio_vfd', rng)
    vfd.add_grid(1, 1, lambda u, v: ((u - 0.5) * 0.060, 0.0, (v - 0.5) * 0.014), LENS)
    vfd.extras = {'decal': 'vfd', 'lamp': 'dashboard', 'decal_size_m': [0.06, 0.014], 'emissive_color': [0.25, 1.0, 0.85]}
    radio.children.append((vfd, T((-0.005, -0.0105, 0.009))))
    for nm, dx in (('radio_seek_dn', 0.034), ('radio_seek_up', 0.047)):
        b = Part(f'sedan_interior.{nm}', rng)
        b.add(box(0.011, 0.008, 0.007, 0.002, 1), PLAST)
        b.extras = {'part': 'button', 'slide_axis': [0, 1, 0], 'travel_m': 0.003}
        radio.children.append((b, T((dx, -0.013, 0.009))))
    cd = Part('sedan_interior.cassette_door', rng)
    cd.add(box(0.075, 0.004, 0.018, 0.001, 1), PLAST, T((0, 0, 0.009)))
    cd.extras = {'part': 'flap', 'hinge_axis': [1, 0, 0], 'open_deg': -80}
    radio.children.append((cd, T((-0.005, -0.0105, -0.012))))
    # HVAC: plate with two slider slots and knobs, fan rotary
    fy = face_y(0.03, 0.645) - 0.006
    part.add(box(0.17, 0.008, 0.05, 0.003, 1), PLAST, T((0.03, fy, 0.645)))
    for k, xs in enumerate((-0.02, 0.025)):
        part.add(box(0.11, 0.004, 0.004, 0.001, 1), RUB, T((0.03, fy - 0.0045, 0.655 - k * 0.018)))
        part.add(box(0.012, 0.012, 0.009, 0.003, 2), PLAST, T((0.03 + xs, fy - 0.009, 0.655 - k * 0.018)))
    part.add(cyl(0.011, 0.012, n=14, bevel_w=0.002), PLAST, T((0.105, fy - 0.004, 0.645), (math.pi / 2, 0, 0)))
    # ashtray drawer (open 60 mm) with five butts + cigarette lighter
    at = Part('sedan_interior.ashtray', rng)
    at.add(box(0.12, 0.10, 0.035, 0.003, 2, base=True), CHROME, T((0, 0.05, -0.0175)))
    at.add(box(0.13, 0.008, 0.042, 0.003, 2), PLAST, T((0, 0.0, 0.0)))
    brng = rng.sub('butts')
    for k in range(5):
        a = brng.u(0, TAU)
        p = (brng.u(-0.04, 0.04), 0.05 + brng.u(-0.03, 0.03), 0.012)
        at.add(cyl(0.004, 0.026, n=8), 'paper_aged', T(p, (math.pi / 2, 0, a)))
    at.add(box(0.11, 0.09, 0.006, 0.002, 1), 'mud_wet', T((0, 0.05, 0.004)))   # ash
    at.extras = {'part': 'drawer', 'slide_axis': [0, -1, 0], 'travel_m': 0.06, 'open_m': 0.06}
    part.children.append((at, T((0.03, face_y(0.03, 0.60) - 0.010 - 0.06, 0.592))))
    part.add(cyl(0.011, 0.02, n=14, bevel_w=0.002), CHROME, T((0.105, face_y(0.105, 0.60) - 0.006, 0.60), (math.pi / 2, 0, 0)))


def _glovebox(part, rng, trim):
    gb = Part('sedan_interior.glovebox', rng)
    door = box(0.34, 0.022, 0.15, 0.008, 2, base=True)
    gb.add(door, DASH, T((0, 0, 0)))
    gb.add(box(0.06, 0.012, 0.018, 0.004, 2), CHROME, T((0, -0.013, 0.12)))
    gb.extras = {'part': 'glovebox', 'hinge_axis': [1, 0, 0]}
    part.children.append((gb, T((0.40, face_y(0.40, 0.66) - 0.012, 0.592))))


def _controls(part, rng, trim):
    """Steering wheel (contract node `steering`), column, stalks, ignition + keys, headlamp knob."""
    hub = Vector((-0.37, 0.42, 0.80))
    tilt = math.radians(25)
    fwd = Vector((0, math.cos(tilt), -math.sin(tilt)))       # column axis, hub -> dash
    sw = Part('sedan_interior.steering', rng)
    R, r = 0.1905 - 0.014, 0.014
    n = 48
    ring, radii = [], []
    for k in range(n):
        a = TAU * k / n
        ring.append((R * math.cos(a), 0.0, R * math.sin(a)))
        g = 0.0
        if math.sin(a) < 0.55:   # finger grips on the lower / side arcs
            g = 0.10 * max(0.0, math.cos(a * 12)) ** 3
        radii.append(1.0 + g)
    sw.add(tube(ring, r, sides=10, closed=True, radii=radii), trim)
    for a in (math.radians(-30), math.radians(-150)):          # spokes at 4 and 8 o'clock, dished
        p0 = Vector((0.05 * math.cos(a), 0.03, 0.05 * math.sin(a) - 0.01))
        p1 = Vector(((R - 0.01) * math.cos(a), 0.004, (R - 0.01) * math.sin(a)))
        sw.add(tube([tuple(p0), tuple((p0 + p1) / 2 + Vector((0, 0.008, 0))), tuple(p1)], 0.01,
                    section=rect_section(0.012, 0.05, 0.004)), CHROME)
        sw.add(tube([tuple(p0 + Vector((0, -0.007, 0))), tuple(p1 + Vector((0, -0.007, 0)))], 0.004,
                    section=rect_section(0.003, 0.02, 0.001)), PLAST)
    pad = box(0.16, 0.05, 0.088, 0.03, 4, cuts={0: 3, 2: 2})
    for v in pad.verts:
        v.co.y -= 0.01 * (1 - (v.co.x / 0.08) ** 2) * (1 if v.co.y < 0 else 0)
    sw.add(pad, trim, T((0, 0.03, -0.03)))
    sw.add(box(0.06, 0.004, 0.014, 0.002, 1), CHROME, T((0, 0.003, -0.018)))   # plain horn emblem bar (no badge)
    sw.extras = {'part': 'steering_wheel', 'spin_axis': [0, 1, 0], 'diameter_m': 0.381}
    part.children.append((sw, T(tuple(hub), (tilt, 0, 0))))
    # column shroud (oval, tapered) hub -> dash face
    c0 = hub + fwd * 0.06
    c1 = hub + fwd * 0.33
    shroud = tube([tuple(c0), tuple(hub + fwd * 0.18), tuple(c1)], 0.045, sides=14, radii=[0.85, 1.0, 1.08])
    for v in shroud.verts:
        v.co.x = hub.x + (v.co.x - hub.x) * 1.15
    part.add(shroud, PLAST)
    part.add(tube([tuple(hub + fwd * 0.02), tuple(hub + fwd * 0.07)], 0.032, sides=14), PLAST)   # hub boss
    # turn-signal / high-beam stalk (left), tilt lever, wiper switch is on the stalk tip
    st = Part('sedan_interior.stalk_turn', rng)
    st.add(tube([(0, 0, 0), (-0.10, -0.06, -0.012), (-0.155, -0.085, -0.02)], 0.0055, sides=8, radii=[1.2, 1.0, 1.0]),
           PLAST)
    st.add(cyl(0.011, 0.04, n=12, bevel_w=0.004), PLAST, T((-0.17, -0.093, -0.022), (0, math.pi / 2, -0.5)))
    st.extras = {'part': 'stalk', 'hinge_axis': [0, 0, 1], 'pull_deg': 8, 'flash': 'pull toward the driver'}
    part.children.append((st, T(tuple(hub + fwd * 0.12 + Vector((-0.042, 0, 0.012))))))
    sh = Part('sedan_interior.stalk_shift', rng)
    sh.add(tube([(0, 0, 0), (0.12, -0.07, -0.03), (0.20, -0.10, -0.075)], 0.0065, sides=8, radii=[1.25, 1.0, 1.0]),
           CHROME)
    sh.add(sphere(0.016, 12, 8), PLAST, T((0.21, -0.105, -0.082)))
    sh.extras = {'part': 'stalk', 'hinge_axis': [1, 0, 0], 'gear': 'D'}
    part.children.append((sh, T(tuple(hub + fwd * 0.14 + Vector((0.045, 0, 0.005))))))
    part.add(tube([tuple(hub + fwd * 0.22 + Vector((-0.04, 0, -0.03))), tuple(hub + fwd * 0.20 + Vector((-0.09, -0.02, -0.05)))],
                  0.004, sides=6), PLAST)   # tilt lever
    # ignition (column, right, top) + keys dangling (pivot at the ring hole)
    ign = hub + fwd * 0.20 + Vector((0.040, 0, 0.032))
    part.add(cyl(0.013, 0.012, n=14, bevel_w=0.003), CHROME, T(tuple(ign)) @ rot_to(-fwd))
    keys = Part('sedan_interior.keys', rng)
    ringk = [(0.0, 0.012 * math.cos(a), -0.012 + 0.012 * math.sin(a)) for a in [TAU * k / 16 for k in range(16)]]
    keys.add(tube(ringk, 0.0012, sides=4, closed=True), CHROME)
    krng = rng.sub('keys')
    for k in range(5):   # 5 keys hanging off the ring at slightly different angles
        a = math.radians(-95 + krng.j(25))
        base = Vector((0, 0.012 * math.cos(a), -0.012 + 0.012 * math.sin(a)))
        key = extrude([(0, -0.0035), (0.034, -0.0035), (0.04, 0), (0.034, 0.0035), (0.010, 0.0045), (0, 0.009),
                       (-0.012, 0.0045), (-0.012, -0.0045)], 0.002)
        keys.add(key, 'brass_tarnished' if k % 2 else CHROME,
                 T(tuple(base), (krng.j(0.3), math.radians(90) + krng.j(0.25), krng.j(0.4))) @ T((0.012, 0, 0)))
    keys.add(box(0.03, 0.007, 0.045, 0.005, 2), PLAST, T((0.004, 0.0, -0.05), (0, krng.j(0.2), 0)))   # plain fob
    keys.extras = {'part': 'dangle', 'pendulum_m': 0.07, 'swing_axis': [1, 0, 0], 'dressing': True}
    part.children.append((keys, T(tuple(ign + Vector((0.006, -0.012, 0))))))
    # headlamp switch: push-pull knob on a bezel left of the binnacle
    part.add(box(0.05, 0.01, 0.04, 0.004, 2), PLAST, T((-0.665, face_y(-0.665, 0.80) - 0.004, 0.80)))
    hk = Part('sedan_interior.headlamp_knob', rng)
    hk.add(tube([(0, 0, 0), (0, -0.028, 0)], 0.0035, sides=8), CHROME)
    hk.add(cyl(0.012, 0.016, n=16, bevel_w=0.004), PLAST, T((0, -0.028, 0), (math.pi / 2, 0, 0)))
    hk.extras = {'part': 'knob', 'pull_axis': [0, -1, 0], 'rotate_axis': [0, -1, 0], 'pull_m': 0.012, 'dome_deg': 40,
                 'state': 'on'}
    part.children.append((hk, T((-0.665, face_y(-0.665, 0.80) - 0.009, 0.80))))


def _seat_back(width, height_fn, depth=0.11, pleats=()):
    """Seatback block (base at z 0, front face at +y, toward the occupant): height varies with x (integrated
    headrests)."""
    bm = box(width, depth, 1.0, 0.03, 2, cuts={2: 6}, base=True)
    xs = []
    for g in pleats:
        xs += [g - 0.006, g, g + 0.006]
    xs += [-width / 2 + width * (i + 1) / 7 for i in range(6)]
    bisect(bm, 0, sorted(set(round(x, 5) for x in xs if -width / 2 + 0.03 < x < width / 2 - 0.03)))
    for v in bm.verts:
        h = height_fn(v.co.x)
        t = v.co.z
        v.co.z = t * h
        v.co.y += 0.018 * math.sin(math.pi * min(1.0, t * 1.3)) * (1 if v.co.y > 0 else 0.3)    # lumbar crown
        v.co.y *= lerp(1.0, 0.7, t)                                                           # thinner at the top
        if v.co.y > 0 and 0.08 < t < 0.85:
            for g in pleats:
                if abs(v.co.x - g) < 0.0015:
                    v.co.y -= 0.006
    return bm


def _seats(rng, trim):
    """60/40 split front bench (welted pleats, integrated headrests, fold-down centre armrest with cup recesses) and
    the rear bench. Driver's outer edge: split seam with foam showing, duct-tape patch."""
    front = Part('sedan_interior.seat_front', rng)
    for (xa, xb) in ((-0.70, 0.115), (0.125, 0.66)):
        w = xb - xa
        xc = (xa + xb) / 2
        grooves = [g - xc for g in [xa + 0.04 + 0.08 * k for k in range(int((w - 0.08) / 0.08) + 1)] if xa + 0.06 < g < xb - 0.06]
        cush = pillowed_box(w, 0.50, 0.16, 0.03, 1, 2, crown=0.022, grooves=grooves, groove_depth=0.007)
        for v in cush.verts:      # top slopes back: 0.53 front -> 0.49 rear; front edge rolls
            t = (v.co.y + 0.25) / 0.50
            if v.co.z > 0.08:
                v.co.z += lerp(-0.04, 0.0, t)
        front.add(cush, trim, T((xc, 0.05, 0.37)))
        # welt piping round the top edge
        e = [(xa + 0.007, -0.193, 0.481), (xb - 0.007, -0.193, 0.481), (xb - 0.007, 0.293, 0.521),
             (xa + 0.007, 0.293, 0.521)]
        front.add(tube(e, 0.0032, sides=6, closed=True), trim)
        # valance under the cushion front
        front.add(box(w - 0.01, 0.02, 0.07, 0.004, 1, base=True), PLAST, T((xc, 0.29, 0.30)))
        # seatback with integrated headrest(s) (outboard positions)
        hx = -0.37 if xa < 0 else 0.40
        def hfn(x, xc=xc, hx=hx):
            ax = abs(x + xc - hx)
            return 0.59 + 0.16 * (1 - smooth(0.11, 0.16, ax))
        bk = _seat_back(w, hfn, 0.11, pleats=grooves)
        front.add(bk, trim, T((xc, -0.25, 0.47), (math.radians(24), 0, 0)))
    # fold-down centre armrest (its own node: it swings up)
    arm = Part('sedan_interior.armrest', rng)
    ab = box(0.20, 0.46, 0.12, 0.04, 3, cuts={1: 4})
    arm.add(ab, trim, T((0.0, 0.23, 0.0)))
    for yc in (0.30, 0.43):   # two cup recesses (dark rings)
        arm.add(cyl(0.0425, 0.004, n=20), PLAST, T((0.0, yc, 0.059)))
        arm.add(cyl(0.035, 0.003, n=16), RUB, T((0.0, yc, 0.061)))
    arm.extras = {'part': 'armrest', 'hinge_axis': [1, 0, 0], 'state': 'down', 'up_deg': 95}
    front.children.append((arm, T((0.05, -0.21, 0.60))))
    # buckles between the cushions
    for xb_ in (0.03, 0.20):
        front.add(box(0.03, 0.05, 0.08, 0.008, 2, base=True), PLAST, T((xb_, -0.20, 0.44), (math.radians(-20), 0, 0)))
    # wear on the driver's outer bolster: split seam + foam + duct tape
    front.add(box(0.012, 0.16, 0.012, 0.004, 2), 'paper_aged', T((-0.676, 0.12, 0.524)))
    for dx in (-0.007, 0.007):
        flap = box(0.008, 0.16, 0.003, 0.001, 1, cuts={1: 3})
        jitter(flap, 0.002, freq=20.0, seed=rng.randint(0, 999))
        front.add(flap, trim, T((-0.676 + dx, 0.12, 0.531), (0, dx * 25, 0)))
    tape = box(0.13, 0.002, 0.055, 0.0008, 1, cuts={0: 3})
    jitter(tape, 0.0012, freq=30.0, seed=rng.randint(0, 999))
    front.add(tape, 'dust_sheet', T((-0.62, -0.21 - 0.33 * math.sin(math.radians(24)), 0.47 + 0.33 * math.cos(
        math.radians(24))), (math.radians(24), 0, 0.05)))
    front.extras = {'seat': 'front_bench_60_40'}

    rear = Part('sedan_interior.seat_rear', rng)
    grooves = [lerp(-0.56, 0.56, k / 10) for k in range(11)]
    cush = pillowed_box(1.30, 0.47, 0.15, 0.035, 1, 2, crown=0.012, grooves=grooves, groove_depth=0.006)
    rear.add(cush, trim, T((0, -1.015, 0.35)))
    bk = _seat_back(1.30, lambda x: 0.47, 0.13, pleats=grooves)
    rear.add(bk, trim, T((0, -1.30, 0.47), (math.radians(19), 0, 0)))
    rear.extras = {'seat': 'rear_bench'}
    return front, rear


# ------------------------------------------------------------------------------------------------ overhead
def _overhead(part, rng, trim):
    # rear-view mirror (contract node `mirror`): glass button on the windscreen, stem, prismatic head
    mount = Vector((0.0, 0.30, zt(0.30) - 0.03))
    mir = Part('sedan_interior.mirror', rng)
    mir.add(box(0.03, 0.006, 0.035, 0.003, 2), PLAST, T((0, 0.004, 0)))
    mir.add(tube([(0, 0, -0.01), (0, -0.018, -0.045), (0, -0.02, -0.055)], 0.0055, sides=8), PLAST)
    head = box(0.245, 0.035, 0.066, 0.016, 3, cuts={0: 3})
    mir.add(head, PLAST, T((0, -0.035, -0.08), (0, 0, math.radians(-7))))
    mir.add(box(0.226, 0.003, 0.054, 0.012, 2), CHROME, T((0, -0.053, -0.08), (0, 0, math.radians(-7))))
    mir.add(box(0.02, 0.01, 0.012, 0.003, 1), PLAST, T((0, -0.04, -0.118)))   # day/night tab
    mir.extras = {'part': 'mirror', 'prismatic': True}
    part.children.append((mir, T(tuple(mount))))
    stem = mount + Vector((0, -0.018, -0.045))
    anchor(part, 'sedan_interior.air_freshener_mount', tuple(stem), {'mount': 'air_freshener'})
    # St Christopher medal on a 0.14 m bead chain (the C7 pine air freshener stays the sting's tell)
    md = Part('sedan_interior.hanger_medal', rng)
    for sx in (-0.006, 0.006):
        md.add(tube([(0, 0, 0), (sx, -0.002, -0.06), (sx * 0.4, 0, -0.115)], 0.0009, sides=4), 'brass_tarnished')
    md.add(cyl(0.0125, 0.0018, n=20, bevel_w=0.0006), 'brass_tarnished', T((0, 0.0009, -0.128), (math.pi / 2, 0, 0)))
    md.add(tube([(0.0105 * math.cos(a), -0.0012, -0.128 + 0.0105 * math.sin(a)) for a in
                 [TAU * k / 20 for k in range(20)]], 0.0006, sides=4, closed=True), 'brass_tarnished')   # raised rim
    md.add(box(0.0024, 0.0008, 0.012, 0.0003, 1), 'brass_tarnished', T((0.002, -0.0016, -0.127), (0, 0, 0.0)))  # staff relief
    md.add(sphere(0.0022, 8, 6), 'brass_tarnished', T((-0.002, -0.0016, -0.121)))                                   # figure (no face)
    md.extras = {'part': 'dangle', 'pendulum_m': 0.14, 'freq_hz': 1.33, 'swing_axis': [1, 0, 0], 'dressing': True,
                 'kind': 'st_christopher_medal'}
    part.children.append((md, T(tuple(stem + Vector((0, -0.004, -0.005))))))
    # sun visors (stowed flat under the headliner), driver's carries the faded photo under an elastic strap
    for s, nm in ((-1, 'visor_d'), (1, 'visor_p')):
        hinge = Vector((s * 0.40, 0.205, 1.283))
        vz = Part(f'sedan_interior.{nm}', rng)
        slab = box(0.38, 0.17, 0.024, 0.01, 3, cuts={0: 4, 1: 2})
        for v in slab.verts:
            v.co.z *= 1 - 0.3 * (2 * v.co.x / 0.38) ** 4
        vz.add(slab, trim, T((0, -0.095, -0.014)))
        vz.add(tube([(-0.186, -0.01, -0.002), (-0.186, -0.18, -0.002), (0.186, -0.18, -0.002), (0.186, -0.01, -0.002)],
                    0.0025, sides=5), trim, T((0, 0, -0.014)))
        vz.add(tube([(-s * 0.20, 0.0, 0.0), (s * 0.19, 0.0, 0.0)], 0.0045, sides=8), CHROME)   # hinge rod
        vz.add(box(0.025, 0.02, 0.02, 0.006, 2), PLAST, T((s * 0.20, 0.0, 0.006)))             # outboard pivot
        vz.extras = {'part': 'visor', 'hinge_axis': [1, 0, 0], 'down_deg': 85, 'state': 'stowed'}
        if s < 0:
            strap_y = -0.095 + 0.075 - 0.05
            vz.add(box(0.36, 0.025, 0.003, 0.001, 1), RUB, T((0, strap_y, -0.0275)))
            ph = Part('sedan_interior.visor_photo', rng)
            ph.add_grid(1, 1, lambda u, v: ((0.5 - u) * 0.10, (v - 0.5) * 0.15, 0.0), 'photo_print')
            ph.extras = {'decal': 'photo', 'photo': 'faded', 'decal_size_m': [0.10, 0.15], 'faces': 'none (faded, backlit)'}
            vz.children.append((ph, T((0.04, -0.095, -0.0265))))
        else:
            vz.add(box(0.14, 0.07, 0.003, 0.002, 1), PLAST, T((0.0, -0.10, -0.0265)))          # vanity mirror cover
        part.children.append((vz, T(tuple(hinge))))
    # dome lamp: bezel + yellowed lens (lamp `dome`, 2800 K) and the light anchor
    part.add(box(0.25, 0.11, 0.012, 0.005, 2), PLAST, T((0, -0.40, 1.296)))
    dl = Part('sedan_interior.dome_lamp', rng)
    lens = box(0.23, 0.09, 0.012, 0.008, 3, cuts={0: 2})
    dl.add(lens, LENS, T((0, 0, -0.008)))
    dl.extras = {'lamp': 'dome', 'emissive_color': kelvin(2800), 'lumens': 120, 'kelvin': 2800}
    part.children.append((dl, T((0, -0.40, 1.296))))
    anchor(part, 'sedan_interior.light_dome', (0, -0.40, 1.282), {'light': 'dome', 'kelvin': 2800, 'lumens': 120,
                                                                    'aim': [0, 0, -1], 'angle_deg': 80})


def _wipers(part, rng):
    """Contract nodes wiper_d / wiper_p, re-placed on the new cowl OUTSIDE the glass (parked, pointing right)."""
    for nm, x in (('wiper_d', -0.42), ('wiper_p', 0.02)):
        y = 0.92
        z = zt(0.90) + 0.02
        w = Part(f'sedan_interior.{nm}', rng)
        w.add(tube([(0, 0, 0), (0.45, -0.035, 0.022)], 0.006, section=rect_section(0.012, 0.006, 0.002)), RUB)
        w.add(tube([(0.04, -0.03, 0.03), (0.50, -0.06, 0.05)], 0.005, section=rect_section(0.01, 0.01, 0.002)), RUB)
        w.add(cyl(0.012, 0.02, n=10), RUB, T((0, 0, -0.01)))
        w.extras = {'part': 'wiper', 'pivot_at': 'spindle', 'sweep_deg': 95}
        part.children.append((w, T((x, y, z))))


# ------------------------------------------------------------------------------------------------ dressing
def _dressing(part, rng):
    """Probe-lit clutter (`dressing: true`): coffee cup, road map (folded + open), cassettes, receipts, cig pack,
    the 2-cell flashlight."""
    def node(name, extras=None):
        n = Part(f'sedan_interior.{name}', rng)
        n.extras = {'dressing': True, **(extras or {})}
        return n

    # styrofoam 12 oz cup with sip lid in the armrest's front recess (armrest top z 0.66 at y 0.09 + 0.30)
    cup = node('cup', {'kind': 'coffee_12oz'})
    prof = [(0.0, 0.0), (0.030, 0.0), (0.0305, 0.004), (0.045, 0.106), (0.047, 0.110), (0.0435, 0.110),
            (0.0425, 0.104), (0.029, 0.006), (0.0, 0.006)]
    cup.add(lathe(prof, 24, cap_bottom=False, cap_top=False), 'styrofoam')
    lid = lathe([(0.0, 0.113), (0.040, 0.113), (0.044, 0.116), (0.048, 0.112), (0.049, 0.106), (0.046, 0.104)], 24,
                cap_bottom=False, cap_top=False)
    cup.add(lid, 'styrofoam', T((0, 0, 0.002)))
    cup.add(box(0.012, 0.008, 0.003, 0.001, 1), RUB, T((0.0, -0.03, 0.1165)))    # sip hole
    part.children.append((cup, T((0.05, 0.09, 0.61))))
    # road map: folded on the passenger cushion; open (hidden under the bench until the arms take it)
    mf = node('map_folded', {'decal': 'road_map', 'state': 'folded', 'uv': 'full sheet 0..1; cover = u 0.5..1, v 0.75..1'})
    mfb = box(0.23, 0.10, 0.012, 0.003, 2, cuts={0: 1})
    mf.add(mfb, 'paper_aged')
    # UV: whole folded block maps to the cover panel region (runtime canvas covers the full sheet)
    part.children.append((mf, T((0.33, 0.12, 0.527), (0.04, -0.03, math.radians(14)))))
    mo = node('map_open', {'decal': 'road_map', 'state': 'open', 'grip': 'left hand at the origin',
                           'rest': 'stowed under the passenger bench until the arms socket takes it',
                           'decal_size_m': [0.46, 0.42]})
    def mapfn(u, v):
        x = u * 0.46
        panel = min(3, int(u * 4))
        t = u * 4 - panel
        tri = (t if panel % 2 == 0 else 1 - t) * 0.115 * math.sin(math.radians(6))
        return (x, tri + 0.01 * math.sin(math.pi * v) * 0.5, v * 0.42 - 0.21)
    mo.add_grid(16, 6, mapfn, 'paper_aged@2s')
    part.children.append((mo, T((0.18, -0.02, 0.33), (math.radians(-90), 0, 0))))
    # cassettes: 3 cases fanned + 1 loose cassette with 0.3 m of pulled tape
    cs = node('cassettes', {'decal_style': 'cassette_label', 'handwritten': True})
    crng = rng.sub('cass')
    for k in range(3):
        cs.add(box(0.109, 0.07, 0.017, 0.0015, 1), LENS, T((0.03 * k, 0.015 * k, 0.0085 + 0.017 * (k == 2)),
                                                            (0, 0, crng.j(0.35))))
        cs.add(box(0.100, 0.062, 0.003, 0.001, 1), 'paper_aged', T((0.03 * k, 0.015 * k, 0.0035 + 0.017 * (k == 2)),
                                                                     (0, 0, crng.j(0.35))))
    loose = box(0.100, 0.063, 0.012, 0.0015, 1)
    cs.add(loose, PLAST, T((-0.10, 0.03, 0.006), (0, 0, 0.6)))
    tape_pts = [(-0.08, 0.06, 0.004)]
    for k in range(1, 12):
        tape_pts.append((-0.08 + 0.025 * k + crng.j(0.01), 0.06 + 0.02 * math.sin(k * 0.9) + crng.j(0.01),
                         0.002 + 0.004 * abs(math.sin(k * 1.7))))
    cs.add(tube(tape_pts, 0.002, section=rect_section(0.0004, 0.0038, 0.0)), 'rubber_black@2s')
    part.children.append((cs, T((0.48, -0.12, 0.515), (0.0, 0.03, 0.2))))
    lbl = decal(cs, 'sedan_interior.cassette_label', 0.065, 0.025, T((-0.10, 0.03, 0.0125), (-math.pi / 2, 0, 0.6)),
                '', mat='paper_aged', style='cassette_label', extra={'dressing': True})
    # receipts: one tucked in the defroster vent, three on the passenger seat
    rrng = rng.sub('rcpt')
    spots = [((0.15, 0.775, _dash_top(0.75, 0.15) + 0.05), (math.radians(-62), 0, 0.15), 0.07, 0.14),
             ((0.40, 0.18, 0.531), (0.03, 0, 0.6), 0.075, 0.16),
             ((0.52, 0.05, 0.529), (0.02, 0, -0.4), 0.07, 0.11),
             ((0.27, -0.06, 0.52), (0.05, 0, 1.2), 0.075, 0.09)]
    for k, (p, rot, w, h) in enumerate(spots):
        rc = node(f'receipt_{k}', {'decal': 'receipt', 'text': '', 'decal_size_m': [w, h], 'receipts': True})
        curl = rrng.u(0.006, 0.014)
        rc.add_grid(3, 8, lambda u, v, w=w, h=h, c=curl: ((u - 0.5) * w, (v - 0.5) * h,
                                                           c * math.sin(math.pi * v) + 0.002 * math.sin(u * 7)), 'paper_aged@2s')
        part.children.append((rc, T(p, rot)))
    # soft pack (crumpled, no brand mark), lying on the dash top
    cp = node('cig_pack')
    pk = box(0.055, 0.088, 0.022, 0.004, 2, cuts={0: 2, 1: 3})
    jitter(pk, 0.003, freq=40.0, seed=rng.randint(0, 999))
    cp.add(pk, 'paper_aged')
    band = box(0.057, 0.030, 0.0235, 0.004, 1)
    cp.add(band, 'flannel_red', T((0, 0.02, 0)))
    part.children.append((cp, T((0.32, 0.67, _dash_top(0.67, 0.32) + 0.011), (0, 0, 0.5))))
    # the 2-cell D flashlight (same proportions as the arms rig's)
    fl = node('flashlight_seat', {'same_as': 'arms.glb flashlight'})
    prof = [(0.0, 0.0), (0.018, 0.0), (0.019, 0.004), (0.019, 0.17), (0.022, 0.18), (0.028, 0.205), (0.029, 0.24),
            (0.026, 0.243), (0.0, 0.243)]
    fl.add(lathe(prof, 20), 'steel_flashlight')
    fl.add(cyl(0.0255, 0.002, n=20), 'lens_flashlight', T((0, 0, 0.2425)))
    fl.add(box(0.012, 0.02, 0.006, 0.002, 1), RUB, T((0.0195, 0, 0.13)))
    part.children.append((fl, T((0.40, 0.15, 0.548), (math.pi / 2 - 0.03, 0, math.radians(18)))))


def split_by_material(part, mats, name, extras):
    """Move every face of `part` whose material is in `mats` into a new child Part (same frame)."""
    det = Part(name, part.rng)
    det.extras = dict(extras)
    keep_f, keep_m, keep_s, keep_uv = [], [], [], []
    vmap_keep, vmap_det = {}, {}
    new_verts = []
    for f, mi, sm, uv in zip(part.faces, part.face_mat, part.face_smooth, part.loop_uv):
        mid = part.mats[mi]
        if mid in mats:
            if mid not in det.mats:
                det.mats.append(mid)
            idx = []
            for vi in f:
                if vi not in vmap_det:
                    vmap_det[vi] = len(det.verts)
                    det.verts.append(part.verts[vi].copy())
                idx.append(vmap_det[vi])
            det.faces.append(idx)
            det.face_mat.append(det.mats.index(mid))
            det.face_smooth.append(sm)
            det.loop_uv.append(uv)
        else:
            idx = []
            for vi in f:
                if vi not in vmap_keep:
                    vmap_keep[vi] = len(new_verts)
                    new_verts.append(part.verts[vi])
                idx.append(vmap_keep[vi])
            keep_f.append(idx)
            keep_m.append(mi)
            keep_s.append(sm)
            keep_uv.append(uv)
    part.verts, part.faces, part.face_mat, part.face_smooth, part.loop_uv = new_verts, keep_f, keep_m, keep_s, keep_uv
    part.children.append((det, None))
    return det


# ------------------------------------------------------------------------------------------------ generator
@prop('sedan_interior', instance_keys=('fuelNeedle',), budget=60000,
      preview={'eye': (-0.35, -0.05, 1.12), 'target': (-0.3, 3.0, 0.95), 'lens': 18})
def sedan_interior(p, rng):
    """Detailed cabin set in car space (see module doc). params: trim (car_interior_tan), altTrim, fuelNeedle,
    radio, wipers, glassMat (glass_rain)."""
    trim = p.get('trim', 'car_interior_tan')
    glass = p.get('glassMat', 'glass_rain')
    part = Part('sedan_interior', rng)
    _glass_and_pillars(part, trim, glass)      # glass first: the root mesh carries the windscreen
    _floor(part)
    _door_cards(part, trim)
    _headliner(part, trim)
    _dash(part, rng)
    _instruments(part, rng)
    _radio_hvac(part, rng)
    _glovebox(part, rng, trim)
    _controls(part, rng, trim)
    front, rear = _seats(rng, trim)
    part.children.append((front, None))
    part.children.append((rear, None))
    _overhead(part, rng, trim)
    if p.get('wipers', True):
        _wipers(part, rng)
    _dressing(part, rng)
    # small hard trim (chrome, black plastic, rubber, woodgrain) is probe-lit: no LM_CAR islands for knobs and
    # slats, and the Low tier may decimate it. The lightmapped shell keeps the big upholstered/padded surfaces.
    split_by_material(part, {CHROME, PLAST, RUB, 'wood_furniture_dark', 'brass_tarnished'},
                      'sedan_interior.shell_details', {'probe_lit': True, 'low_ratio': 0.32})   # Low ladder: trim detail
    part.extras.update({'trim': trim, 'alt_trim': str(p.get('altTrim', '')), 'nose': '+y (car space, z 0 = road)',
                        'frame': 'car', 'driver_eye': [-0.35, -0.05, 1.12], 'version': 2})
    return [part]
