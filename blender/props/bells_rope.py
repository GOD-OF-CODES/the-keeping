"""The bell system and the door-rope rig (DESIGN: 'THE ROPE, one mechanism obeyed everywhere').

Wall/door-mounted items: origin = the mounting point on the surface, the item projects towards -y (front) at yaw 0.
Path props (bell_wire, door_rope): `path` is absolute PLAN coordinates; geometry is built relative to the
placement `pos` (and un-rotated by its yaw) so the prop still sits at its origin like every other prop. The runtime
rope rig can re-derive the path from extras.path_local.
"""
import math

from mathutils import Matrix, Vector

from .kit import (Part, T, anchor, bisect, box, cyl, extrude, fillet, jitter, lathe, prop, rect_section, sphere,
                  tube, rot_to)


def _local_path(p, pos, yaw):
    pts = []
    for s in str(p).split(';'):
        x, y, z = (float(v) for v in s.split(','))
        dx, dy = x - pos[0], y - pos[1]
        c, sn = math.cos(-yaw), math.sin(-yaw)
        pts.append(Vector((dx * c - dy * sn, dx * sn + dy * c, z - pos[2])))
    return pts


@prop('door_knocker', budget=2500)
def door_knocker(p, rng):
    """Cast-iron ring knocker: moulded oval backplate, knuckle, heavy ring, strike stud."""
    mat = p.get('mat', 'cast_iron')
    part = Part('door_knocker', rng)
    plate = [(0.042 * math.cos(a), 0.062 * math.sin(a)) for a in [math.tau * k / 24 for k in range(24)]]
    part.add(extrude(plate, 0.008, 0.003, 2), mat, T((0, 0, 0.0), (math.pi / 2, 0, 0)))
    part.add(lathe([(0, 0), (0.022, 0), (0.02, 0.008), (0.012, 0.016), (0, 0.018)], n=16), mat,
             T((0, -0.008, 0.02), (math.pi / 2, 0, 0)))
    part.add(cyl(0.008, 0.05, n=10, bevel_w=0.002), mat, T((-0.025, -0.02, 0.028), (0, math.pi / 2, 0)))
    ring = Part('door_knocker.ring', rng)
    R = 0.062
    pts = [(R * math.sin(a), 0, -R + R * math.cos(a)) for a in [math.tau * k / 24 for k in range(24)]]
    ring.add(tube(pts, 0.009, sides=10, closed=True, radii=[1 + 0.25 * max(0, math.cos(math.tau * k / 24 + math.pi))
                                                             for k in range(24)]), mat)
    ring.extras = {'part': 'ring', 'pivot_at': 'knuckle', 'swing_axis': [1, 0, 0]}
    part.children.append((ring, T((0, -0.02, 0.028))))
    part.add(lathe([(0, 0), (0.014, 0), (0.012, 0.01), (0, 0.013)], n=12), mat,
             T((0, -0.004, 0.028 - 2 * R + 0.004), (math.pi / 2, 0, 0)))
    return [part]


@prop('bell_pull_knob', budget=1500)
def bell_pull_knob(p, rng):
    """Brass bell-pull: turned knob on a shank through a rosette (pulled outwards, extras.pull_axis)."""
    mat = p.get('mat', 'brass_tarnished')
    part = Part('bell_pull_knob', rng)
    ros = [(0, 0), (0.038, 0), (0.039, 0.003), (0.034, 0.007), (0.02, 0.011), (0.012, 0.014), (0, 0.014)]
    part.add(lathe(ros, n=24), mat, T((0, 0, 0), (math.pi / 2, 0, 0)))
    knob = Part('bell_pull_knob.knob', rng)
    kp = [(0, 0), (0.006, 0), (0.006, 0.03), (0.012, 0.034), (0.024, 0.046), (0.026, 0.056), (0.021, 0.066),
          (0.008, 0.07), (0, 0.0705)]
    knob.add(lathe(kp, n=20), mat, T((0, 0, 0), (math.pi / 2, 0, 0)))
    knob.extras = {'part': 'knob', 'pull_axis': [0, -1, 0], 'travel_m': 0.06}
    part.children.append((knob, T((0, -0.01, 0))))
    return [part]


@prop('bell_crank', budget=1500)
def bell_crank(p, rng):
    """Brass corner bell-crank: L-lever on a pivot pin in a small wall bracket, wire eyes at both arm ends."""
    mat = p.get('mat', 'brass_tarnished')
    part = Part('bell_crank', rng)
    part.add(box(0.05, 0.004, 0.07, 0.0015, 1), mat, T((0, 0.0, 0)))
    for z in (-0.022, 0.022):
        part.add(cyl(0.004, 0.004, n=8), mat, T((0, -0.004, z), (math.pi / 2, 0, 0)))
    part.add(tube([(0, -0.002, 0), (0, -0.04, 0)], 0.008, section=rect_section(0.03, 0.004, 0.001)), mat)
    lever = Part('bell_crank.lever', rng)
    arm = [(0.06, 0, 0), (0, 0, 0), (0, 0.06, 0)]
    lever.add(tube(arm, 0.005, section=rect_section(0.012, 0.004, 0.001)), mat)
    for x, y in ((0.06, 0), (0, 0.06)):
        lever.add(tube([(x + 0.006 * math.cos(a), y + 0.006 * math.sin(a), 0) for a in
                        [math.tau * k / 8 for k in range(8)]], 0.0016, sides=5, closed=True), mat)
    lever.add(cyl(0.006, 0.012, n=10), mat, T((0, 0, -0.006)))
    lever.extras = {'part': 'lever', 'pivot_at': 'pin', 'rotate_axis': [0, 0, 1]}
    part.children.append((lever, T((0, -0.04, 0))))
    return [part]


@prop('bell_wire', instance_keys=('note', 'from', 'to'), budget=4000)
def bell_wire(p, rng, pos=(0, 0, 0), yaw=0.0):
    """Taut iron bell wire along the cornice with tight bends at the cranks and small guide staples."""
    mat = p.get('mat', 'cast_iron')
    part = Part('bell_wire', rng)
    pos = p.get('_pos', pos)
    pts = _local_path(p.get('path', '0,0,0;0,0.5,0'), pos, p.get('_yaw', yaw))
    path = fillet(pts, 0.02, 3)
    part.add(tube(path, 0.0012, sides=4), mat)
    for a, b in zip(pts, pts[1:]):
        L = (b - a).length
        for k in range(1, int(L / 0.7) + 1):
            c = a + (b - a) * (k / (int(L / 0.7) + 1))
            part.add(tube([c + Vector((0, 0, 0.004)), c + Vector((0, 0, -0.004))], 0.001, sides=3), mat)
    part.extras['path_local'] = [[round(c, 4) for c in v] for v in pts]
    return [part]


@prop('spring_bell', instance_keys=('ringsFor',), budget=4000)
def spring_bell(p, rng):
    """Parlour spring bell: flat steel spring coiled on a wall bracket, brass bell on its tip (the bell swings
    on the spring: child `bell` with pivot at the spring tip)."""
    mat = p.get('mat', 'brass_tarnished')
    part = Part('spring_bell', rng)
    part.add(box(0.05, 0.006, 0.09, 0.002, 1), 'cast_iron', T((0, 0.0, 0)))
    coil = []
    for k in range(64):
        a = k / 64 * math.tau * 4.5
        r = 0.018 + 0.003 * k / 64
        coil.append((r * math.cos(a), -0.02 - 0.012 * k / 64, r * math.sin(a)))
    coil = [(0, -0.003, 0)] + coil + [(0.0, -0.035, -0.06), (0.0, -0.06, -0.19)]
    part.add(tube(coil, 0.004, section=rect_section(0.002, 0.009, 0.0005)), 'cast_iron')
    bell = Part('spring_bell.bell', rng)
    bp = [(0, 0.0), (0.008, 0.0), (0.012, -0.012), (0.02, -0.02), (0.03, -0.04), (0.038, -0.062), (0.044, -0.07),
          (0.045, -0.074), (0.04, -0.073), (0.034, -0.064), (0.026, -0.042), (0.016, -0.024), (0, -0.018)]
    bell.add(lathe(bp, n=24), mat)
    bell.add(tube([(0, 0, -0.018), (0, 0, -0.05)], 0.0015, sides=4), 'cast_iron')
    bell.add(sphere(0.007, 8, 6), 'cast_iron', T((0, 0, -0.055)))
    bell.extras = {'part': 'bell', 'pivot_at': 'spring_tip', 'swing': True}
    part.children.append((bell, T((0, -0.06, -0.19))))
    part.extras['rings_for'] = str(p.get('ringsFor', ''))
    return [part]


@prop('rope_pulley', budget=2500)
def rope_pulley(p, rng):
    """Swivel pulley block: grooved cast-iron sheave (8 cm) in a strap frame on a swivel eye and screw hook.
    ORIGIN = sheave centre (where the rope path point is); the hook screws into the cornice above."""
    mat = p.get('mat', 'cast_iron')
    part = Part('rope_pulley', rng)
    sheave = Part('rope_pulley.sheave', rng)
    sp = [(0.008, -0.009), (0.034, -0.009), (0.04, -0.007), (0.036, -0.003), (0.031, 0), (0.036, 0.003),
          (0.04, 0.007), (0.034, 0.009), (0.008, 0.009)]
    sheave.add(lathe(sp, n=24, closed=True), mat, T((0, 0, 0), (0, math.pi / 2, 0)))
    sheave.extras = {'part': 'sheave', 'spin_axis': [1, 0, 0]}
    part.children.append((sheave, None))
    part.add(cyl(0.007, 0.036, n=8), mat, T((-0.018, 0, 0), (0, math.pi / 2, 0)))
    for sx in (-1, 1):
        strap = [(sx * 0.013, 0, -0.02), (sx * 0.013, 0, 0.03), (sx * 0.006, 0, 0.055)]
        part.add(tube(fillet(strap, 0.01, 3), 0.004, section=rect_section(0.004, 0.018, 0.001)), mat)
    part.add(lathe([(0.004, 0.055), (0.009, 0.055), (0.01, 0.062), (0.004, 0.064)], n=10, closed=True), mat)
    eye = [(0.009 * math.cos(a), 0, 0.074 + 0.009 * math.sin(a)) for a in [math.tau * k / 10 for k in range(10)]]
    part.add(tube(eye, 0.0022, sides=5, closed=True), mat)
    hook = [(0.0, 0, 0.068), (0.012, 0, 0.075), (0.01, 0, 0.088), (0.0, 0, 0.092), (0.0, 0, 0.13)]
    part.add(tube(fillet(hook, 0.006, 3), 0.003, sides=6), mat)
    return [part]


@prop('door_rope', instance_keys=('note',), budget=8000)
def door_rope(p, rng, pos=(0, 0, 0), yaw=0.0):
    """18 mm three-strand hemp rope along the rig path, with a slight catenary between supports and a coiled tail
    hanging below the cleat (the last path point). Mesh is static; the runtime rope rig animates along path_local."""
    mat = p.get('mat', 'rope_hemp')
    d = float(p.get('diameter', 0.018))
    part = Part('door_rope', rng)
    pts = _local_path(p.get('path', '0,0,0;1,0,0'), p.get('_pos', pos), p.get('_yaw', yaw))
    path = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        L = (b - a).length
        n = max(2, int(L / 0.12))
        horiz = abs((b - a).normalized().z) < 0.7
        for k in range(1, n + 1):
            t = k / n
            q = a + (b - a) * t
            if horiz and k < n:
                q = q + Vector((0, 0, -0.012 * L * 4 * t * (1 - t)))
            path.append(q)
    end = pts[-1]
    tail = [end + Vector((0.02, -0.03, -0.05)), end + Vector((0.03, -0.035, -0.35)), end + Vector((0.0, -0.04, -0.7)),
            end + Vector((-0.04, -0.03, -0.85)), end + Vector((-0.02, -0.02, -1.0))]
    full = fillet(path + tail, 0.03, 2)
    part.add(tube(full, d / 2, sides=8, twist=0.35), mat, uv_scale=1.0)
    part.add(sphere(d * 0.75, 8, 6), mat, T(tuple(tail[-1] + Vector((0, 0, -0.005)))))   # whipped end
    part.extras['path_local'] = [[round(c, 4) for c in v] for v in pts]
    part.extras['diameter'] = d
    return [part]


@prop('rope_cleat', budget=1200)
def rope_cleat(p, rng):
    """Cast horn cleat (15 cm) screwed to the parlour wall, with a figure-eight of rope made fast on it."""
    mat = p.get('mat', 'cast_iron')
    part = Part('rope_cleat', rng)
    part.add(box(0.06, 0.012, 0.03, 0.004, 2), mat, T((0, -0.006, 0)))
    for sx in (-1, 1):
        part.add(tube([(sx * 0.02, -0.01, 0), (sx * 0.02, -0.03, 0)], 0.008, sides=8, radii=[1.2, 0.9]), mat)
    horn = [(-0.075, -0.033, 0.0), (-0.04, -0.036, 0.0), (0, -0.037, 0.0), (0.04, -0.036, 0.0), (0.075, -0.033, 0.0)]
    part.add(tube(horn, 0.008, sides=10, radii=[0.55, 0.9, 1.0, 0.9, 0.55]), mat)
    fig8 = []
    for k in range(40):   # figure-eight round the horns, crossing over the waist
        a = math.tau * k / 40
        fig8.append((0.058 * math.sin(a), -0.037 - 0.011 * math.cos(2 * a) - 0.004, 0.02 * math.sin(2 * a)))
    part.add(tube(fig8, 0.0085, sides=6, closed=True), 'rope_hemp')
    return [part]


@prop('bolt_box', budget=3000)
def bolt_box(p, rng):
    """Iron drop-bolt boxed out of reach above the transom: riveted box with a brass maker's plate, the rope eye
    on top and the bolt (child, slides on z) dropping into its keeper."""
    mat = p.get('mat', 'cast_iron')
    part = Part('bolt_box', rng)
    W, D, H = 0.3, 0.1, 0.16
    part.add(box(W, D, H, 0.006, 2), mat, T((0, -D / 2, 0)))
    for x in (-W / 2 + 0.015, W / 2 - 0.015):
        for z in (-H / 2 + 0.015, H / 2 - 0.015):
            part.add(sphere(0.004, 6, 4), mat, T((x, -D - 0.001, z)))
    part.add(box(0.12, 0.003, 0.05, 0.001, 1), p.get('plateMat', 'brass_tarnished'), T((0, -D - 0.0015, 0.02)))
    eye = [(0.012 * math.cos(a), -D / 2, H / 2 + 0.018 + 0.012 * math.sin(a)) for a in
           [math.tau * k / 10 for k in range(10)]]
    part.add(tube(eye, 0.003, sides=6, closed=True), mat)
    bolt = Part('bolt_box.bolt', rng)
    bolt.add(cyl(0.011, 0.34, n=12, bevel_w=0.002, z0=-0.3), mat)
    bolt.add(sphere(0.016, 10, 6), mat, T((0, 0, -0.3)))
    bolt.extras = {'part': 'bolt', 'slide_axis': [0, 0, 1], 'travel_m': 0.12, 'state': 'dropped'}
    part.children.append((bolt, T((0, -D / 2, -H / 2))))
    part.add(box(0.05, 0.05, 0.03, 0.004, 2), mat, T((0, -D / 2, -H / 2 - 0.3)))   # keeper
    return [part]


@prop('door_counterweight', budget=2500)
def door_counterweight(p, rng):
    """Sash-weight counterweight that pulls the front door shut: a pulley on the wall, cord, 30 cm iron weight
    hanging below it. ORIGIN = pulley centre."""
    mat = p.get('mat', 'cast_iron')
    part = Part('door_counterweight', rng)
    part.add(box(0.05, 0.008, 0.1, 0.002, 1), mat, T((0, 0.0, 0)))
    part.add(lathe([(0.004, -0.006), (0.03, -0.006), (0.025, 0), (0.03, 0.006), (0.004, 0.006)], n=20, closed=True),
             mat, T((0, -0.02, 0), (math.pi / 2, 0, 0)))
    cord = p.get('cord', 'rope_hemp')
    part.add(tube([(0.028, -0.02, 0), (0.028, -0.02, -0.55)], 0.004, sides=6), cord)
    part.add(tube([(-0.028, -0.02, 0), (-0.028, -0.02, -0.02), (-0.33, -0.02, 0.0)], 0.004, sides=6), cord)
    wt = Part('door_counterweight.weight', rng)
    wt.add(cyl(0.028, 0.3, n=12, bevel_w=0.006, z0=-0.3), mat)
    wt.add(tube([(0.008 * math.cos(a), 0, 0.012 + 0.008 * math.sin(a)) for a in
                 [math.tau * k / 8 for k in range(8)]], 0.002, sides=4, closed=True), mat)
    wt.extras = {'part': 'weight', 'slide_axis': [0, 0, 1], 'travel_m': 0.5}
    part.children.append((wt, T((0.028, -0.02, -0.56))))
    return [part]


@prop('bell_pull_embroidered', budget=3000)
def bell_pull_embroidered(p, rng):
    """Embroidered bell-pull strip (1.2 m) on a brass hanger, with a brass tassel cap. Hangs from its origin."""
    L = float(p.get('length', 1.2))
    part = Part('bell_pull_embroidered', rng)
    tassel = p.get('tasselMat', 'brass_tarnished')
    part.add(box(0.12, 0.012, 0.03, 0.004, 2), tassel, T((0, -0.006, 0.0)))
    w = 0.09
    ph = rng.u(0, 6)
    part.add_grid(4, 24, lambda u, v: ((u - 0.5) * w * (1 - 0.1 * v), -0.012 - 0.01 * math.sin(v * 5 + ph) * v
                                       - 0.004 * (u - 0.5) ** 2, -0.02 - v * L), p.get('mat', 'rag_rug') + '@2s',
                  uv_size=None)
    zt = -0.02 - L
    part.add(lathe([(0, 0), (0.015, -0.005), (0.018, -0.02), (0.012, -0.035), (0, -0.04)], n=12), tassel,
             T((0, -0.015, zt)))
    for k in range(10):
        a = math.tau * k / 10
        part.add(tube([(0.008 * math.cos(a), 0.008 * math.sin(a), 0), (0.014 * math.cos(a), 0.014 * math.sin(a), -0.09)],
                      0.002, sides=3), tassel, T((0, -0.015, zt - 0.035)))
    part.extras.update({'pull_axis': [0, 0, -1], 'travel_m': 0.08})
    return [part]
