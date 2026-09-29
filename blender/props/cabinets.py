"""Slatted-cabinet generator (DESIGN: 4 hides). Variants: armoire (U1, first hide), wardrobe_coats (U2),
wardrobe_loose_back (U3: back boards are the hinged D_WARDROBE_BACK), plus the coat-hook rail of the back passage.

Louvred upper door panels have REAL gaps: slats 45 mm wide tilted 40 deg on a 42 mm pitch leave ~13 mm clear slots,
so the in-hide eye (layout hides[].eye, ~1.55 m) sees out between them. Doors are child nodes with their origin on
the hinge line (extras.hinge_axis z); `ajar` opens the right door 14 deg. A low-poly `<id>.collider` child
(extras.collider=true, no material binding needed) keeps the interior walkable for the hide logic.
"""
import math

from mathutils import Vector

from .kit import (Part, T, box, cyl, extrude, fillet, jitter, lathe, nz, prop, rect_section, sphere, tube)


def _panel(part, rng, w, h, t, mat, m, raised=True):
    """Frame-and-panel: 4 frame members + a raised/fielded panel."""
    fw = 0.06
    part.add(box(fw, t, h, 0.003, 2), mat, m @ T((-w / 2 + fw / 2, 0, 0)))
    part.add(box(fw, t, h, 0.003, 2), mat, m @ T((w / 2 - fw / 2, 0, 0)))
    part.add(box(w - 2 * fw, t, fw, 0.003, 2), mat, m @ T((0, 0, h / 2 - fw / 2)))
    part.add(box(w - 2 * fw, t, fw * 1.4, 0.003, 2), mat, m @ T((0, 0, -h / 2 + fw * 0.7)))
    ph = h - fw - fw * 1.4
    pz = (fw * 1.4 - fw) / 2
    part.add(box(w - 2 * fw + 0.01, t * 0.5, ph + 0.01, 0.002, 1), mat, m @ T((0, 0, pz)))
    if raised:
        part.add(box(w - 2 * fw - 0.05, t * 0.35, ph - 0.05, 0.012, 2), mat, m @ T((0, -t * 0.35, pz)))


def _door(name, rng, w, h, t, mat, louvre_frac=0.55, hinge_side=-1, knob=True):
    """Door leaf built from its hinge line: extends +x (hinge_side=-1, left door) or -x (right door)."""
    d = Part(name, rng)
    s = -hinge_side
    cx = s * w / 2
    fw, top_r, mid_r, bot_r = 0.058, 0.075, 0.07, 0.11
    d.add(box(fw, t, h, 0.003, 2, cuts={2: 3}), mat, T((cx - w / 2 + fw / 2, 0, h / 2)))
    d.add(box(fw, t, h, 0.003, 2, cuts={2: 3}), mat, T((cx + w / 2 - fw / 2, 0, h / 2)))
    d.add(box(w - 2 * fw, t, top_r, 0.003, 2), mat, T((cx, 0, h - top_r / 2)))
    d.add(box(w - 2 * fw, t, bot_r, 0.003, 2), mat, T((cx, 0, bot_r / 2)))
    zm = h * (1 - louvre_frac)
    d.add(box(w - 2 * fw, t, mid_r, 0.003, 2), mat, T((cx, 0, zm)))
    # lower raised panel
    ph = zm - mid_r / 2 - bot_r
    d.add(box(w - 2 * fw + 0.01, t * 0.45, ph + 0.01, 0.002, 1), mat, T((cx, 0, bot_r + ph / 2)))
    d.add(box(w - 2 * fw - 0.05, t * 0.3, ph - 0.05, 0.01, 2), mat, T((cx, -t * 0.32, bot_r + ph / 2)))
    # louvres
    z0 = zm + mid_r / 2 + 0.012
    z1 = h - top_r - 0.012
    pitch = 0.042
    n = int((z1 - z0) / pitch)
    sw = w - 2 * fw + 0.012
    for k in range(n):
        z = z0 + pitch * (k + 0.5) + ((z1 - z0) - n * pitch) / 2
        sl = box(sw, 0.045, 0.0075, 0.0025, 2)
        d.add(sl, mat, T((cx, 0, z), (math.radians(-40 + rng.j(1.5)), 0, 0)))
    if knob:
        kx = cx + s * (w / 2 - fw / 2)
        d.add(lathe([(0, 0), (0.009, 0), (0.008, 0.008), (0.014, 0.018), (0.013, 0.026), (0, 0.027)], n=12), mat,
              T((kx, -t / 2, h * 0.52), (math.pi / 2, 0, 0)))
        esc = [(0.009 * math.cos(a), 0.022 * math.sin(a)) for a in [math.tau * k / 12 for k in range(12)]]
        d.add(extrude(esc, 0.0015, 0.0005, 1), 'brass_tarnished', T((kx, -t / 2, h * 0.45), (math.pi / 2, 0, 0)))
    d.extras = {'part': 'door', 'hinge_axis': [0, 0, 1], 'hinge_side': 'left' if hinge_side < 0 else 'right'}
    return d


def _coat(part, rng, x, top_z, length, mat, depth):
    """A heavy coat on a wire hanger, shoulders across the cabinet depth, falling in a soft sack shape."""
    seed = rng.randint(0, 999)
    sh = depth * 0.72
    mat = mat if mat.endswith('@2s') else mat + '@2s'   # cloth shell: seen from inside at the hem

    def f(u, v):
        a = u * math.tau
        z = top_z - 0.05 - v * length
        wy = sh / 2 * (0.55 + 0.45 * min(1.0, v * 6)) * (1 + 0.08 * v)
        wx = 0.045 + 0.05 * min(1.0, v * 4) + 0.02 * v
        n = nz((math.cos(a), math.sin(a), v * 3), seed, 1.3)
        fold = 1 + 0.12 * math.sin(a * 5 + seed) * v + 0.05 * n.x
        return (x + wx * math.cos(a) * fold, wy * math.sin(a) * fold, z + n.z * 0.01 * v)
    part.add_grid(16, 10, f, mat, uv_size=(1.2, length), closed_u=True)
    part.add_grid(16, 1, lambda u, v: (x, 0, top_z - 0.05 - length) if v > 0.5 else
                  f(u, 1.0), mat, closed_u=True, flip=True)
    hook = [(x, 0, top_z + 0.02), (x, 0.012, top_z + 0.035), (x, 0.0, top_z + 0.05), (x, -0.01, top_z + 0.04)]
    part.add(tube(fillet(hook, 0.008, 3), 0.0015, sides=4), 'cast_iron')
    part.add(tube([(x, -sh / 2, top_z - 0.06), (x, 0, top_z + 0.0), (x, sh / 2, top_z - 0.06)], 0.0015, sides=4),
             'cast_iron')


@prop('slatted_cabinet', instance_keys=('looseBackDoor',), budget=15000)
def slatted_cabinet(p, rng):
    variant = p.get('variant', 'armoire')
    W, D, H = float(p.get('width', 1.1)), float(p.get('depth', 0.6)), float(p.get('height', 2.1))
    mat = p.get('mat', 'wood_furniture_dark')
    part = Part('slatted_cabinet', rng)
    t = 0.022
    plinth = 0.1
    corn = 0.13 if variant == 'armoire' else 0.09
    # plinth with a moulded top lip and bracket feet
    part.add(box(W + 0.02, D + 0.01, plinth - 0.02, 0.004, 2, base=True), mat, T((0, 0, 0.02)))
    part.add(box(W + 0.04, D + 0.02, 0.022, 0.008, 3, base=True), mat, T((0, 0, plinth - 0.012)))
    for sx in (-1, 1):
        for sy in (-1, 1):
            part.add(box(0.07, 0.07, 0.04, 0.006, 2, base=True), mat, T((sx * (W / 2 - 0.025), sy * (D / 2 - 0.025), 0)))
    zc0, zc1 = plinth + 0.01, H - corn
    ch = zc1 - zc0
    for sx in (-1, 1):   # panelled sides
        _panel(part, rng, D - 0.01, ch, t, mat, T((sx * (W / 2 - t / 2), 0.0, zc0 + ch / 2), (0, 0, math.pi / 2)))
    part.add(box(W - 2 * t, D - 0.02, t, 0.002, 1, base=True), mat, T((0, 0.0, zc0)))
    part.add(box(W, D, t, 0.003, 2, base=True), mat, T((0, 0, zc1 - t)))
    # front face frame (stiles + head rail) the doors close against
    part.add(box(0.05, t, ch, 0.003, 2), mat, T((-W / 2 + 0.025, -D / 2 + t / 2, zc0 + ch / 2)))
    part.add(box(0.05, t, ch, 0.003, 2), mat, T((W / 2 - 0.025, -D / 2 + t / 2, zc0 + ch / 2)))
    part.add(box(W - 0.1, t, 0.06, 0.003, 2), mat, T((0, -D / 2 + t / 2, zc1 - 0.03)))
    # cornice: cove + fillet + flat, swept round front and sides with mitred corners
    sec = [(0.0, 0.0), (0.012, 0.0), (0.016, 0.02), (0.028, 0.045), (0.05, 0.06), (0.058, 0.066), (0.058, corn - 0.01),
           (0.05, corn), (0.0, corn)]
    path = [(-W / 2 + 0.001, D / 2 - 0.01, 0), (-W / 2 + 0.001, -D / 2 + 0.001, 0), (W / 2 - 0.001, -D / 2 + 0.001, 0),
            (W / 2 - 0.001, D / 2 - 0.01, 0)]
    part.add(tube(path, 0.01, section=[(y, -x) for x, y in sec]), mat, T((0, 0, zc1)))
    part.add(box(W + 0.1, D + 0.05, 0.02, 0.004, 2, base=True), mat, T((0, -0.02, H - 0.02)))
    # back boards (tongue & groove, slightly uneven); loose-back variant makes them a hinged child
    loose = variant == 'wardrobe_loose_back'
    back = Part('slatted_cabinet.back', rng) if loose else part
    hinge_x = -(W / 2 - t)
    nb = 6
    bw = (W - 2 * t) / nb
    for k in range(nb):
        x = -W / 2 + t + bw * (k + 0.5)
        bb = box(bw - 0.002, 0.014, ch - 0.01, 0.002, 1, cuts={2: 2})
        jitter(bb, 0.002, freq=2.0, seed=rng.randint(0, 999), axes=(0, 1, 0))
        if loose:
            back.add(bb, mat, T((x - hinge_x, 0, ch / 2)))
        else:
            back.add(bb, mat, T((x, D / 2 - 0.012, zc0 + ch / 2 + 0.005)))
    if loose:
        back.add(box(0.04, 0.02, 0.02, 0.003, 1), 'cast_iron', T((W - 2 * t - 0.05, -0.012, ch * 0.5)))
        back.extras = {'part': 'back', 'hinge_axis': [0, 0, 1], 'door_id': str(p.get('looseBackDoor', '')),
                       'note': 'loose back boards: swing open into U4T after dress_visit_done'}
        part.children.append((back, T((hinge_x, D / 2 - 0.012, zc0 + 0.005))))
    # interior: hat shelf + hanging rail
    part.add(box(W - 2 * t, D - 0.06, 0.018, 0.002, 1, base=True), mat, T((0, 0.02, zc1 - 0.32)))
    rail_z = zc1 - 0.38
    part.add(tube([(-W / 2 + t, 0.0, rail_z), (W / 2 - t, 0.0, rail_z)], 0.012, sides=10), 'brass_tarnished')
    for sx in (-1, 1):
        part.add(cyl(0.022, 0.012, n=10), 'brass_tarnished', T((sx * (W / 2 - t - 0.006), 0, rail_z), (0, math.pi / 2, 0)))
    # doors
    dw = (W - 0.1) / 2 - 0.002
    dh = ch - 0.06 - 0.01
    ajar = math.radians(14) if p.get('ajar') else 0.0
    for side in (-1, 1):
        d = _door(f'slatted_cabinet.door_{"l" if side < 0 else "r"}', rng, dw, dh, t, mat, 0.55 if H > 2.0 else 0.5,
                  hinge_side=side, knob=True)
        rot = (ajar if side > 0 else 0.0) * (1 if side > 0 else -1)
        part.children.append((d, T((side * (W / 2 - 0.05), -D / 2 - t / 2 + 0.002, zc0 + 0.005), (0, 0, rot))))
    # contents
    contents = str(p.get('contents', ''))
    if 'coats' in contents:
        cm = p.get('coatMat', 'wool_coats')
        for k, x in enumerate((-0.33, -0.18, 0.02, 0.2, 0.33)):
            _coat(part, rng, x + rng.j(0.02), rail_z, rng.u(0.85, 1.05), cm, D)
        if 'handbag' in contents:
            hb = box(0.3, 0.12, 0.2, 0.03, 3, cuts={0: 2}, base=True)
            part.add(hb, 'leather_worn', T((0.25, 0.0, zc0 + t), (0, 0, 0.3)))
            part.add(tube([(-0.12, 0, 0.2), (-0.06, 0, 0.3), (0.06, 0, 0.3), (0.12, 0, 0.2)], 0.006, sides=6),
                     'leather_worn', T((0.25, 0.0, zc0 + t), (0, 0, 0.3)))
        if 'trucker_cap' in contents:
            cap = [(0, 0.1), (0.05, 0.095), (0.085, 0.07), (0.1, 0.03), (0.1, 0.0), (0.096, 0.0), (0, 0.004)]
            part.add(lathe(cap, n=16), 'flannel_red', T((-0.2, 0.05, zc1 - 0.302), scale=(1.0, 1.1, 0.9)))
            part.add(box(0.16, 0.08, 0.004, 0.002, 1), 'flannel_red', T((-0.2, -0.1, zc1 - 0.297), (0.1, 0, 0)))
    # collider (low-poly shell, interior open)
    col = Part('slatted_cabinet.collider', rng)
    for m, s in ((T((0, D / 2 - 0.01, H / 2)), (W, 0.02, H)), (T((-W / 2 + 0.01, 0, H / 2)), (0.02, D, H)),
                 (T((W / 2 - 0.01, 0, H / 2)), (0.02, D, H)), (T((0, 0, plinth / 2)), (W, D, plinth)),
                 (T((0, 0, H - corn / 2)), (W, D, corn))):
        col.add(box(*s, 0.0, 1), 'dust_sheet', m)
    col.extras = {'collider': True, 'hide_proxy': True}
    part.children.append((col, None))
    part.jitter(0.0012, freq=1.5, zmin=0.001)
    part.extras.update({'variant': variant, 'hide': True})
    return [part]


@prop('coat_hooks', instance_keys=('items',), budget=4000)
def coat_hooks(p, rng):
    """Board of cast hooks in the back passage with an oilskin coat and an empty lantern hook. ORIGIN = board
    back centre on the wall (hooks project -y)."""
    part = Part('coat_hooks', rng)
    part.add(box(0.9, 0.022, 0.12, 0.004, 2), 'wood_raw_plank', T((0, -0.011, 0)))
    for k, x in enumerate((-0.32, -0.11, 0.11, 0.32)):
        hk = [(x, -0.022, 0.02), (x, -0.07, 0.0), (x, -0.085, 0.03), (x, -0.075, 0.05)]
        part.add(tube(fillet(hk, 0.015, 4), 0.005, sides=6, radii=[1.2, 1.0, 0.9, 0.8]), 'cast_iron')
        part.add(tube([(x, -0.03, 0.0), (x, -0.06, -0.05), (x, -0.07, -0.06)], 0.0045, sides=6), 'cast_iron')
    items = str(p.get('items', ''))
    if 'oilskin' in items:   # coat hung by its loop, back to the wall: shoulders run along x
        coat = Part('tmp', rng)
        _coat(coat, rng, 0.0, 0.0, 1.05, 'rubber_black', 0.5)
        part.merge(coat, T((-0.11, -0.11, 0.02), (0, 0, math.pi / 2), (1.0, 0.8, 1.0)))
    if 'lantern_hook' in items:
        part.extras['lantern_hook'] = [0.32, -0.08, 0.04]
    return [part]
