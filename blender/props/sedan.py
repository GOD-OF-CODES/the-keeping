"""The player's late-80s sedan (RVX-318), its 5 wreck variants, and the detailed interior set.

Body: a loft of 11-point half cross-sections sampled along the car (rear x=0 -> nose x=L), mirrored, one Catmull-Clark
level. The sections encode the whole silhouette of a mid-size 1985-89 American three-box sedan (4.85 x 1.74 x
1.37 m, 2.68 m wheelbase, 185/75R14 tyres): rounded plan corners, a body-side crease, slight tumblehome, flush glass,
a formal C-pillar, and wheel arches cut by raising the section bottom over each axle. Each face gets its material by
(band, station): paint, side glass, windscreen/backlite, blacked-out B-pillar, underbody. Door/hood/trunk shut lines
are thin dark strips on the surface.

Built in car space (x forward, y left, z up), then turned so the NOSE faces -y and the car centre sits on the origin.
Wreck variants (params.variant 1-5): flat/missing tyres, missing hood, broken glass, stripped to the ground, and a
wagon body; dents from seeded noise. sunkInWeeds is applied per placement by build_props (instance key).
"""
import math

from mathutils import Vector

from .kit import (Part, T, anchor, box, cyl, decal, extrude, fillet, jitter, lathe, nz, prop, rect_section, sphere,
                  tube)

L, HALF = 4.85, 0.87
AXLE_R, AXLE_F = 1.22, 3.9
WHEEL_R, ARCH_R = 0.32, 0.375
TRACK_Y = 0.715


def _lerp(a, b, t):
    return a + (b - a) * t


def _pw(keys, x):
    for (x0, z0), (x1, z1) in zip(keys, keys[1:]):
        if x0 <= x <= x1:
            t = (x - x0) / (x1 - x0) if x1 > x0 else 0
            t = t * t * (3 - 2 * t)   # smoothstep between keys: no kinks except where keys are doubled
            return z0 + (z1 - z0) * t
    return keys[0][1] if x < keys[0][0] else keys[-1][1]


def car_shape(wagon=False):
    top = [(0.0, 0.9), (0.08, 0.935), (0.68, 0.958), (0.72, 0.972), (1.14, 1.345), (1.28, 1.368), (2.5, 1.372),
           (2.62, 1.352), (3.36, 0.9), (3.46, 0.882), (4.55, 0.83), (4.78, 0.8), (4.85, 0.76)]
    if wagon:
        top = [(0.0, 0.93), (0.05, 1.0), (0.12, 1.3), (0.25, 1.37), (2.5, 1.382), (2.62, 1.352), (3.36, 0.9),
               (3.46, 0.882), (4.55, 0.83), (4.78, 0.8), (4.85, 0.76)]
    return top


class Body:
    def __init__(self, wagon=False, low=0.0):
        self.top = car_shape(wagon)
        self.wagon = wagon
        self.low = low

    def cabin_x(self):
        return (0.12, 3.36) if self.wagon else (0.72, 3.36)

    def zt(self, x):
        return _pw(self.top, x)

    def belt(self, x):
        return 0.86 + 0.018 * (1 - x / L)

    def wb(self, x):
        d = min(x, L - x)
        return HALF - 0.11 * (1 - min(1.0, d / 0.4)) ** 2

    def zb(self, x):
        z = 0.235
        for ax in (AXLE_R, AXLE_F):
            dx = x - ax
            if abs(dx) < ARCH_R:
                z = max(z, 0.315 + math.sqrt(ARCH_R * ARCH_R - dx * dx) * 0.98)
        return z

    def section(self, x):
        """11 half-section points (y >= 0), bottom centre -> roof centre."""
        wb, zt, zb, zbelt = self.wb(x), self.zt(x), self.zb(x), self.belt(x)
        f = max(0.0, min(1.0, (zt - zbelt - 0.03) / 0.4))
        sh_z = min(zbelt, zt - 0.02)
        pts = [
            (0.0, zb),
            (wb - 0.14, zb),
            (wb - 0.035, zb + 0.02),
            (wb - 0.004, max(zb + 0.07, 0.4)),
            (wb + 0.006, max(zb + 0.1, 0.6)),
            (wb + 0.004, max(zb + 0.12, 0.64)),
            (wb - 0.006, sh_z),
            (_lerp(wb - 0.035, wb - 0.08, f), _lerp(zt - 0.006, zbelt + 0.03, f)),
            (_lerp(wb - 0.075, 0.645, f), _lerp(zt, zt - 0.035, f)),
            (_lerp(wb * 0.5, 0.5, f), zt + _lerp(0.01, -0.004, f)),
            (0.0, zt + _lerp(0.014, 0.0, f)),
        ]
        return pts

    def side_y(self, x, z):
        """Outer body-side y at height z (between the sill and the shoulder)."""
        s = self.section(x)[1:7]
        for (y0, z0), (y1, z1) in zip(s, s[1:]):
            if min(z0, z1) <= z <= max(z0, z1) and abs(z1 - z0) > 1e-6:
                return y0 + (y1 - y0) * (z - z0) / (z1 - z0)
        return s[-1][0]


def _stations(body):
    xs = set()
    x = 0.0
    while x < L:
        xs.add(round(x, 4))
        x += 0.085
    for ax in (AXLE_R, AXLE_F):
        for k in range(-10, 11):
            xs.add(round(ax + ARCH_R * k / 10 * 1.0, 4))
    for k in (0.0, 0.015, 0.05, L - 0.05, L - 0.015, L):
        xs.add(round(k, 4))
    return sorted(x for x in xs if 0 <= x <= L)


def _band_mat(body, band, xm, glass, paint, opts):
    cx0, cx1 = body.cabin_x()
    if band <= 1:
        return opts.get('under', 'rubber_black')
    if band == 7:   # side glass band
        if opts.get('no_glass'):
            return None if 1.32 < xm < 3.1 and not (2.12 < xm < 2.24) else paint
        if 1.32 < xm < 2.12 or 2.24 < xm < 3.1:
            return glass
        if body.wagon and 0.2 < xm < 1.24:
            return glass
        if 2.12 <= xm <= 2.24:
            return 'rubber_black'
        return paint
    if band == 9:   # roof centre band: windscreen / backlite
        if 2.66 < xm < 3.32:
            return None if opts.get('no_windscreen') else glass
        if not body.wagon and 0.77 < xm < 1.12:
            return None if opts.get('no_glass') else glass
        if body.wagon and 0.07 < xm < 0.2:
            return glass
        if opts.get('no_hood') and 3.48 < xm < L - 0.08:
            return None
    if band == 8 and opts.get('no_hood') and 3.48 < xm < L - 0.08:
        return None
    return paint


def build_body(part, rng, paint, glass, opts, body):
    xs = _stations(body)
    rings = []
    for x in xs:
        half = body.section(x)
        right = [(x, -y, z) for y, z in half[1:-1]]
        left = [(x, y, z) for y, z in reversed(half[1:-1])]
        ring = [(x, 0.0, half[0][1])] + right + [(x, 0.0, half[-1][1])] + left
        rings.append(ring)
    n = len(rings[0])
    nh = 11
    # band index for ring edge k -> k+1 (right side 0..nh-2 then left mirrored)
    def band(k):
        return k if k < nh - 1 else (n - 1 - k)
    verts = [Vector(p) for r in rings for p in r]
    faces, mats = [], []
    for i in range(len(rings) - 1):
        xm = (xs[i] + xs[i + 1]) / 2
        for k in range(n):
            m = _band_mat(body, band(k), xm, glass, paint, opts)
            if m is None:
                continue
            if opts.get('under') and not m.endswith('@2s'):
                m += '@2s'   # opened wreck: every shell face can be seen from inside
            faces.append([i * n + k, (i + 1) * n + k, (i + 1) * n + (k + 1) % n, i * n + (k + 1) % n][::-1])
            mats.append(m)
    for i in (0, len(rings) - 1):   # end caps
        faces.append([i * n + k for k in range(n)])
        mats.append(paint)
    _emit(part, verts, faces, mats)


def _emit(part, verts, faces, mats, centre_z=0.72):
    """One connected shell (so subdivision stays watertight), faces oriented outward from the car's long axis
    (the shell is convex in section) so single-sided materials render correctly; per-face materials."""
    import bmesh
    bm = bmesh.new()
    bv = [bm.verts.new(v) for v in verts]
    fm = []
    for f, mat in zip(faces, mats):
        c = sum((verts[i] for i in f), Vector()) / len(f)
        nrm = (verts[f[1]] - verts[f[0]]).cross(verts[f[2]] - verts[f[0]])
        if nrm.length < 1e-12 and len(f) > 3:
            nrm = (verts[f[2]] - verts[f[0]]).cross(verts[f[3]] - verts[f[0]])
        out = Vector((0.0, c.y, c.z - centre_z))
        if len(f) > 4:   # end caps: outward along x
            out = Vector((1.0 if c.x > L / 2 else -1.0, 0, 0))
        ff = f if nrm.dot(out) >= 0 else f[::-1]
        try:
            bm.faces.new([bv[i] for i in ff])
            fm.append(mat)
        except ValueError:
            pass
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.faces.index_update()
    part.add(bm, mats[0], grain=0, face_mats=fm)


def _wheel(part, rng, m, flat=0.0, rim_only=False, tyre='rubber_black', cap='chrome_pitted'):
    tyre_prof = [(0.19, -0.088), (0.255, -0.094), (0.298, -0.09), (0.316, -0.07), (0.32, -0.035), (0.321, 0.0),
                 (0.32, 0.035), (0.316, 0.07), (0.298, 0.09), (0.255, 0.094), (0.19, 0.088)]
    if not rim_only:
        bm = lathe(tyre_prof, n=28, cap_bottom=False, cap_top=False)
        for v in bm.verts:   # flatten the contact patch (bulge) - tyre lathe axis is z here, ground is -x
            if flat > 0 and v.co.x < -0.2:
                lim = -WHEEL_R + flat
                if v.co.x < lim:
                    v.co.x = lim + (v.co.x - lim) * 0.15
                    v.co.z *= 1.0 + 0.25 * flat / 0.1
        from .kit import T as _T
        part.add(bm, tyre, m @ _T((0, 0, 0), (0, 0, 0)))
    cap_prof = [(0.0, 0.098), (0.045, 0.098), (0.06, 0.094), (0.085, 0.092), (0.14, 0.088), (0.17, 0.092),
                (0.185, 0.094), (0.195, 0.088), (0.19, 0.075)]
    rim_prof = [(0.19, 0.075), (0.186, 0.02), (0.18, -0.07), (0.19, -0.085)]
    part.add(lathe(rim_prof, n=24, cap_bottom=False, cap_top=False), 'cast_iron@2s', m)
    if not rim_only:
        part.add(lathe(cap_prof, n=24, cap_bottom=False, cap_top=False), cap, m)
        for k in range(10):   # cooling slots on the wheel cover
            a = k * math.tau / 10 + rng.j(0.02)
            part.add(box(0.035, 0.012, 0.004, 0.001, 1), 'rubber_black',
                     m @ T((0.12 * math.cos(a), 0.12 * math.sin(a), 0.0905), (0, 0, a)))
    part.add(lathe([(0.0, -0.06), (0.15, -0.06), (0.15, 0.06), (0.0, 0.06)], n=16), 'rust', m)


def _exterior_bits(part, rng, body, paint, glass, opts, plate):
    # bumpers wrap round the corners (tube along a plan path, rounded rect section)
    for front in (True, False):
        xe = L + 0.06 if front else -0.07
        xb = L - 0.28 if front else 0.28
        path = [(xb, -HALF + 0.03, 0), (xe - (0.05 if front else -0.05), -HALF + 0.2, 0), (xe, -0.55, 0), (xe, 0.55, 0),
                (xe - (0.05 if front else -0.05), HALF - 0.2, 0), (xb, HALF - 0.03, 0)]
        if not front:
            path = path[::-1]
        pts = fillet(path, 0.18, 4)
        zb = 0.4 if front else 0.42
        if not opts.get('no_front_bumper') or not front:
            part.add(tube(pts, 0.1, section=rect_section(0.12, 0.17, 0.035, 2)), 'rubber_black', T((0, 0, zb)))
            part.add(tube(pts, 0.1, section=rect_section(0.02, 0.03, 0.008, 1)), 'chrome_pitted',
                     T((0.065 if front else -0.065, 0, zb + 0.02)) @ T((0, 0, 0)))
    # grille + headlights (child: lamps)
    zg = 0.64
    heads = Part('sedan.headlights', rng)
    for s in (-1, 1):
        heads.add(box(0.03, 0.4, 0.14, 0.01, 2), 'glass_grimy', T((L + 0.005, s * 0.58, zg)))
        heads.add(box(0.02, 0.44, 0.17, 0.006, 2), 'chrome_pitted', T((L - 0.005, s * 0.58, zg)))
        heads.add(box(0.025, 0.12, 0.05, 0.006, 2), 'glass_grimy', T((L - 0.01, s * 0.8, zg - 0.13)))
    heads.extras = {'lamp': 'head', 'emissive_color': [1.0, 0.92, 0.75]}
    part.children.append((heads, None))
    part.add(box(0.03, 0.66, 0.17, 0.008, 2), 'chrome_pitted', T((L + 0.0, 0, zg)))
    for k in range(5):
        part.add(box(0.012, 0.62, 0.012, 0.003, 1), 'chrome_pitted', T((L + 0.012, 0, zg - 0.056 + k * 0.028)))
    part.add(box(0.02, 0.62, 0.14, 0.002, 1), 'rubber_black', T((L - 0.008, 0, zg)))
    # tail lamps (child), plate decal, trunk lock
    tails = Part('sedan.taillights', rng)
    for s in (-1, 1):
        tails.add(box(0.03, 0.52, 0.15, 0.012, 2), 'glass_grimy', T((-0.006, s * 0.5, 0.74)))
        tails.add(tube([(-0.004, s * 0.77, 0.74), (0.12, s * (HALF - 0.01), 0.74)], 0.05,
                       section=rect_section(0.03, 0.15, 0.01)), 'glass_grimy')
    tails.extras = {'lamp': 'tail', 'emissive_color': [0.8, 0.03, 0.02]}
    part.children.append((tails, None))
    part.add(box(0.012, 0.32, 0.17, 0.003, 1), 'chrome_pitted', T((-0.012, 0, 0.56)))
    if plate:
        decal(part, 'sedan.plate', 0.3, 0.15, T((-0.02, 0, 0.56), (0, 0, -math.pi / 2)), plate, style='plate',
              extra={'text_param': 'plate'})
    # shut lines (door, hood, trunk)
    for s in (-1, 1):
        for xd in (3.32, 2.18, 1.62):
            z0 = body.zb(xd) + 0.02
            z1 = body.belt(xd) - 0.01
            pts = [(xd + 0.02 * (z - z0), s * (body.side_y(xd, z) + 0.001), z)
                   for z in [z0 + (z1 - z0) * k / 6 for k in range(7)]]
            part.add(tube(pts, 0.0032, sides=4), 'rubber_black')
    for xa, xb_, zfun in ((3.46, L - 0.06, None), (0.07, 0.68, None)):
        for s in (-1, 1):
            pts = [(x, s * (body.wb(x) - 0.07), body.zt(x) + 0.004) for x in [xa + (xb_ - xa) * k / 10 for k in range(11)]]
            part.add(tube(pts, 0.003, sides=4), 'rubber_black')
    for x in (3.46, 0.68):
        pts = [(x, y, body.zt(x) + 0.006 + 0.012 * (1 - (y / 0.8) ** 2)) for y in [-0.8 + 1.6 * k / 10 for k in range(11)]]
        part.add(tube(pts, 0.003, sides=4), 'rubber_black')
    # mirrors, door handles, wipers, antenna, window trim
    for s in (-1, 1):
        mp = Vector((3.22, s * (body.wb(3.22) + 0.07), body.belt(3.22) + 0.07))
        part.add(box(0.1, 0.12, 0.085, 0.03, 2), 'rubber_black', T(tuple(mp)))
        part.add(box(0.005, 0.1, 0.07, 0.002, 1), 'glass_grimy', T(tuple(mp + Vector((-0.052, 0, 0)))))
        for xh in (2.45, 1.42):
            part.add(box(0.13, 0.012, 0.03, 0.005, 2), 'chrome_pitted',
                     T((xh, s * (body.side_y(xh, 0.8) + 0.004), 0.8)))
        part.add(tube([(x, s * (body.side_y(x, 0.62) + 0.003), 0.62) for x in (0.2, 1.0, 2.0, 3.0, 4.5)], 0.006,
                      section=rect_section(0.004, 0.02, 0.002)), 'chrome_pitted')
    if not opts.get('no_wipers'):
        for yy in (-0.3, 0.2):
            w = Part(f'sedan.wiper_{"d" if yy < 0 else "p"}', rng)
            w.add(tube([(0, 0, 0), (-0.02, 0.45, 0.01)], 0.006, section=rect_section(0.012, 0.006, 0.002)), 'rubber_black')
            w.add(tube([(-0.03, 0.05, 0.012), (-0.01, 0.52, 0.02)], 0.005, section=rect_section(0.01, 0.01, 0.002)),
                  'rubber_black')
            w.extras = {'part': 'wiper', 'pivot_at': 'spindle', 'sweep_axis': [0.55, 0, 0.83], 'sweep_deg': 95}
            part.children.append((w, T((3.42, yy, body.zt(3.42) + 0.01), (0, math.radians(-33), 0))))
    part.add(tube([(3.6, -body.wb(3.6) + 0.06, body.zt(3.6)), (3.5, -body.wb(3.6) + 0.06, body.zt(3.6) + 0.75)], 0.0025,
                  sides=4), 'chrome_pitted')


def _cabin_interior(part, rng, trim):
    """Low-detail cabin seen through the windows: two benches, dash, wheel (the close-up set is sedan_interior)."""
    for x, zc, h in ((1.5, 0.46, 0.5), (2.55, 0.46, 0.5)):
        part.add(box(0.5, 1.4, 0.16, 0.05, 2, base=True), trim, T((x, 0, zc - 0.12)))
        part.add(box(0.14, 1.4, h, 0.05, 2, base=True), trim, T((x - 0.3, 0, zc), (0, math.radians(-12), 0)))
    part.add(box(0.5, 1.5, 0.22, 0.06, 2, base=True), trim, T((3.2, 0, 0.66)))
    ring = [(0.0, 0.19 * math.cos(a), 0.19 * math.sin(a)) for a in [math.tau * k / 16 for k in range(16)]]
    part.add(tube(ring, 0.014, sides=6, closed=True), 'rubber_black', T((2.88, 0.38, 0.8), (0, math.radians(-25), 0)))
    part.add(box(1.2, 1.1, 0.02, 0.005, 1, base=True), trim, T((1.9, 0, 1.24)))
    part.add(box(2.4, 1.5, 0.02, 0.005, 1, base=True), 'rubber_black', T((1.8, 0, 0.26)))


def build_car(p, rng, opts):
    paint = p.get('paint', p.get('mat', 'car_paint_sedan'))
    glass = p.get('glassMat', 'glass_rain')
    trim = p.get('interior', 'car_interior_tan')
    body = Body(wagon=opts.get('wagon', False))
    if any(opts.get(k) for k in ('no_glass', 'no_windscreen', 'no_hood')):
        paint = paint + '@2s'   # openings expose the inside of the shell (and the underbody from above)
        opts = dict(opts, under='rubber_black@2s')
    shell = Part('sedan.body', rng)
    build_body(shell, rng, paint, glass, opts, body)
    shell.subsurf = 1
    if opts.get('dents'):
        shell.jitter(opts['dents'], freq=1.6)
    part = Part('sedan', rng)
    _exterior_bits(part, rng, body, paint, glass, opts, p.get('plate', ''))
    if not opts.get('stripped_interior'):
        _cabin_interior(part, rng, trim)
    if opts.get('no_hood'):
        part.add(box(0.7, 0.8, 0.45, 0.03, 2, base=True), 'rust', T((4.05, 0, 0.35)))
        part.add(cyl(0.12, 0.08, n=12), 'rust', T((4.05, 0, 0.8)))
    wheels = opts.get('wheels', 'all')
    for ax, s in ((AXLE_F, 1), (AXLE_F, -1), (AXLE_R, 1), (AXLE_R, -1)):
        key = ('F' if ax == AXLE_F else 'R') + ('L' if s > 0 else 'R')
        if wheels == 'none':
            continue
        rim_only = key in opts.get('rim_only', ())
        flat = opts.get('flat', {}).get(key, 0.0)
        m = T((ax, s * TRACK_Y, WHEEL_R - (0.13 if rim_only else 0.0)), (s * -math.pi / 2, 0, 0))
        _wheel(part, rng, m, flat=flat, rim_only=rim_only)
    part.children.append((shell, None))
    # nose to -y, centre on the origin
    m = T((0, 0, 0), (0, 0, -math.pi / 2)) @ T((-L / 2, 0, 0))
    part.apply(m)
    if opts.get('drop'):
        part.apply(T((0, 0, -opts['drop'])))
    shell.verts = [m @ v for v in shell.verts]
    if opts.get('drop'):
        shell.verts = [v - Vector((0, 0, opts['drop'])) for v in shell.verts]
    part.children = [(c, cm) if c is not shell else (c, None) for c, cm in part.children]
    return part


@prop('sedan', instance_keys=('plate', 'state'), budget=60000)
def sedan(p, rng):
    """Hero sedan RVX-318 (faded steel blue): opening car at the gate and later pushed into the wreck row."""
    part = build_car(p, rng, {'dents': 0.002})
    part.extras.update({'plate': str(p.get('plate', '')), 'state': str(p.get('state', ''))})
    return [part]


WRECKS = {
    1: {'dents': 0.012, 'flat': {'FL': 0.09, 'FR': 0.07, 'RL': 0.05}, 'no_wipers': True},
    2: {'dents': 0.015, 'no_hood': True, 'rim_only': ('RL', 'RR'), 'no_glass': True, 'no_wipers': True},
    3: {'dents': 0.018, 'no_windscreen': True, 'no_glass': True, 'flat': {'FL': 0.1, 'FR': 0.1, 'RL': 0.1, 'RR': 0.1},
        'no_front_bumper': True, 'no_wipers': True},
    4: {'dents': 0.02, 'wheels': 'none', 'drop': 0.2, 'no_glass': True, 'no_windscreen': True, 'stripped_interior': True,
        'no_wipers': True},
    5: {'dents': 0.012, 'wagon': True, 'flat': {'RL': 0.08}, 'no_wipers': True},
}


@prop('wreck_sedan', instance_keys=('sunkInWeeds',), budget=45000)
def wreck_sedan(p, rng):
    """Dead cars in the field: 5 variants of the sedan family, rusted (car_paint_wreck), sinking into the weeds."""
    v = int(p.get('variant', 1))
    opts = dict(WRECKS.get(v, WRECKS[1]))
    q = dict(p)
    q['paint'] = p.get('mat', 'car_paint_wreck')
    q['glassMat'] = 'glass_grimy'
    q['interior'] = 'car_interior_tan'
    q['plate'] = ''
    part = build_car(q, rng, opts)
    part.extras.update({'variant': v})
    return [part]


@prop('sedan_interior', instance_keys=('fuelNeedle',), budget=40000,
      preview={'eye': (-0.33, -0.1, 1.08), 'target': (0.1, 0.8, 0.8), 'lens': 18})
def sedan_interior(p, rng):
    """Close-up interior set for the car cutscenes (C1/C6/C7). Nose at +y: the dash's user-facing side is its
    front (-y), matching the CAR set (driver eye ~(-0.35, -0.05, 1.1)). Split bench seats, padded dash with a
    cluster hood (speedo + fuel gauge decals: needle below E), cassette radio, glovebox, column shifter, 2-spoke
    wheel, pedals, door cards, headliner, A/B pillars, windscreen (glass_rain) with wipers outside, rear-view
    mirror (air freshener mount). Re-trim for the sting via extras.alt_trim."""
    trim = p.get('trim', 'car_interior_tan')
    part = Part('sedan_interior', rng)
    W = 1.46
    # floor pan + transmission tunnel + carpet
    part.add(box(W, 2.4, 0.03, 0.01, 2, base=True), trim, T((0, -0.4, 0.0)))
    part.add(box(0.28, 1.8, 0.12, 0.05, 2, base=True), trim, T((0, 0.0, 0.02)))
    # front split bench + rear bench
    for x, w in ((-0.33, 0.78), (0.4, 0.62)):
        cush = box(w, 0.52, 0.14, 0.05, 3, cuts={0: 3, 1: 2}, base=True)
        for v in cush.verts:
            if v.co.z > 0.1:
                v.co.z -= 0.02 * (1 - (2 * v.co.x / w) ** 2)
        part.add(cush, trim, T((x, -0.12, 0.2)))
        back = box(w, 0.14, 0.62, 0.05, 3, cuts={0: 3, 2: 3}, base=True)
        part.add(back, trim, T((x, -0.42, 0.32), (math.radians(-14), 0, 0)))
        for k in range(1, 4):   # pleats
            part.add(box(0.008, 0.5, 0.012, 0.004, 1), trim, T((x - w / 2 + w * k / 4, -0.12, 0.345)))
    part.add(box(W - 0.06, 0.55, 0.14, 0.05, 3, base=True), trim, T((0, -1.2, 0.18)))
    part.add(box(W - 0.06, 0.14, 0.6, 0.05, 3, base=True), trim, T((0, -1.5, 0.3), (math.radians(-18), 0, 0)))
    # dashboard
    dz = 0.64
    dash = box(W, 0.42, 0.22, 0.06, 3, cuts={0: 6}, base=True)
    part.add(dash, trim, T((0, 0.58, dz)))
    part.add(box(W, 0.3, 0.07, 0.03, 3, base=True), trim, T((0, 0.66, dz + 0.22)))
    part.add(box(0.46, 0.18, 0.08, 0.035, 3, base=True), trim, T((-0.35, 0.44, dz + 0.2)))
    part.add(box(0.42, 0.02, 0.13, 0.004, 1, base=True), 'rubber_black', T((-0.35, 0.36, dz + 0.1)))
    cluster = Part('sedan_interior.cluster', rng)
    cluster.add_grid(1, 1, lambda u, v: ((u - 0.5) * 0.4, 0.0, (v - 0.5) * 0.12), 'rubber_black')
    cluster.extras = {'decal': 'gauges', 'fuelNeedle': str(p.get('fuelNeedle', 'below_E')), 'text_param': 'fuelNeedle',
                      'lamp': 'dashboard'}
    part.children.append((cluster, T((-0.35, 0.358, dz + 0.165))))
    part.add(box(0.32, 0.2, 0.3, 0.02, 2, base=True), trim, T((0.02, 0.5, dz - 0.25)))
    radio = Part('sedan_interior.radio', rng)
    radio.add(box(0.18, 0.02, 0.05, 0.004, 1), 'rubber_black')
    radio.add(box(0.08, 0.004, 0.012, 0.001, 1), 'chrome_pitted', T((0.0, -0.011, 0.0)))
    for sx in (-1, 1):
        radio.add(cyl(0.009, 0.012, n=10), 'chrome_pitted', T((sx * 0.07, -0.012, 0.0), (math.pi / 2, 0, 0)))
    radio.extras = {'part': 'radio', 'kind': str(p.get('radio', 'cassette')), 'lamp': 'dashboard'}
    part.children.append((radio, T((0.02, 0.39, dz + 0.02))))
    gb = Part('sedan_interior.glovebox', rng)
    gb.add(box(0.36, 0.02, 0.15, 0.01, 2), trim)
    gb.add(box(0.05, 0.01, 0.015, 0.003, 1), 'chrome_pitted', T((0, -0.012, 0.05)))
    gb.extras = {'part': 'glovebox', 'hinge_axis': [1, 0, 0]}
    part.children.append((gb, T((0.4, 0.37, dz + 0.1))))
    # steering column, wheel, stalks, shifter
    col_top = Vector((-0.35, 0.3, 0.78))
    part.add(tube([(-0.35, 0.55, 0.64), tuple(col_top)], 0.035, sides=12, radii=[1.3, 1.0]), 'rubber_black')
    sw = Part('sedan_interior.steering', rng)
    ring = [(0.19 * math.cos(a), 0.0, 0.19 * math.sin(a)) for a in [math.tau * k / 32 for k in range(32)]]
    sw.add(tube(ring, 0.016, sides=8, closed=True), 'rubber_black')
    for s in (-1, 1):
        sw.add(tube([(0, 0, 0), (s * 0.18, 0.0, -0.03)], 0.012, section=rect_section(0.03, 0.012, 0.005)), 'rubber_black')
    sw.add(box(0.12, 0.05, 0.09, 0.03, 3), trim, T((0, 0.0, -0.01)))
    sw.extras = {'part': 'steering_wheel', 'spin_axis': [0, 0.42, 0.9]}
    part.children.append((sw, T(tuple(col_top + Vector((0, -0.03, 0.02))), (math.radians(-65), 0, 0))))
    part.add(tube([(-0.3, 0.33, 0.8), (-0.12, 0.33, 0.78)], 0.006, sides=6), 'rubber_black')
    part.add(tube([(-0.4, 0.33, 0.8), (-0.52, 0.32, 0.8)], 0.006, sides=6), 'rubber_black')
    for i, x in enumerate((-0.43, -0.3, -0.2)):
        part.add(box(0.07 if i else 0.05, 0.02, 0.09, 0.006, 2), 'rubber_black', T((x, 0.62, 0.14), (0.5, 0, 0)))
    # doors (cards + armrests + window cranks), pillars, headliner
    for s in (-1, 1):
        part.add(box(0.06, 1.0, 0.5, 0.02, 2, base=True), trim, T((s * (W / 2 + 0.03), -0.1, 0.2)))
        part.add(box(0.09, 0.4, 0.06, 0.025, 3, base=True), trim, T((s * (W / 2 - 0.02), -0.1, 0.52)))
        part.add(tube([(s * W / 2, -0.25, 0.6), (s * (W / 2 - 0.05), -0.25, 0.6), (s * (W / 2 - 0.06), -0.3, 0.53)],
                      0.006, sides=6), 'chrome_pitted')
        part.add(tube([(s * (W / 2 + 0.01), 0.72, 0.86), (s * (W / 2 - 0.06), 0.18, 1.14)], 0.04,
                      section=rect_section(0.07, 0.05, 0.02)), trim)
        part.add(box(0.08, 0.14, 0.52, 0.03, 2, base=True), trim, T((s * (W / 2 + 0.01), -0.62, 0.65)))
        part.add(box(0.006, 0.9, 0.36, 0.002, 1), p.get('glassMat', 'glass_rain'), T((s * (W / 2 + 0.05), -0.12, 0.92)))
    part.add(box(W + 0.04, 2.0, 0.02, 0.01, 2, cuts={0: 4, 1: 4}, base=True), trim, T((0, -0.8, 1.15)))
    # windscreen + wipers (outside)
    ws = [(-W / 2 + 0.02, 0.74, 0.865), (W / 2 - 0.02, 0.74, 0.865), (W / 2 - 0.06, 0.2, 1.14), (-W / 2 + 0.06, 0.2, 1.14)]
    part.add_grid(4, 4, lambda u, v: tuple(Vector(ws[0]).lerp(Vector(ws[1]), u).lerp(
        Vector(ws[3]).lerp(Vector(ws[2]), u), v) + Vector((0, 0, 0.012 * math.sin(u * math.pi)))),
        p.get('glassMat', 'glass_rain'))
    if p.get('wipers', True):
        for x in (-0.35, 0.2):
            w = Part(f'sedan_interior.wiper_{"d" if x < 0 else "p"}', rng)
            w.add(tube([(0, 0, 0), (0.45, -0.02, 0.2)], 0.006, section=rect_section(0.012, 0.006, 0.002)), 'rubber_black')
            w.add(tube([(0.05, -0.02, 0.03), (0.5, -0.03, 0.23)], 0.005, section=rect_section(0.01, 0.01, 0.002)),
                  'rubber_black')
            w.extras = {'part': 'wiper', 'pivot_at': 'spindle', 'sweep_deg': 95}
            part.children.append((w, T((x - 0.2, 0.8, 0.86))))
    mir = Part('sedan_interior.mirror', rng)
    mir.add(tube([(0, 0, 0), (0, 0.02, -0.06)], 0.006, sides=6), 'rubber_black')
    mir.add(box(0.22, 0.03, 0.06, 0.02, 2), 'rubber_black', T((0, 0.0, -0.09)))
    mir.add(box(0.2, 0.003, 0.045, 0.01, 1), 'glass_grimy', T((0, -0.016, -0.09)))
    part.children.append((mir, T((0.0, 0.28, 1.13))))
    anchor(part, 'sedan_interior.air_freshener_mount', (0.0, 0.26, 1.03), {'mount': 'air_freshener'})
    # driving gloves left on the passenger seat
    gl = p.get('gloveMat', 'leather_worn')
    for k in range(2):
        g = box(0.1, 0.2, 0.025, 0.012, 3, cuts={1: 3}, base=True)
        jitter(g, 0.006, freq=12.0, seed=rng.randint(0, 999))
        part.add(g, gl, T((0.35 + 0.03 * k, -0.08 + 0.05 * k, 0.345 + 0.02 * k), (0, 0, rng.j(0.4))))
    part.extras.update({'trim': trim, 'alt_trim': str(p.get('altTrim', '')), 'nose': '+y (dash front faces -y)'})
    return [part]
