"""First-person arms textures, evaluated per texel in 3D (no seams) from the rig's own joints.

Gloves  - unlined chestnut calf driving gloves: pique-stitched finger side seams, a Bolton thumb seam, three
          stitched 'points' on the back of the hand, perforated finger backs, knuckle wrinkles over every joint
          (stretched flat on the gripping left hand, bunched on the open right), deep flexion creases on the palm
          side, a wrist vent closed by a stitched strap tab under the snap, pebble grain, hide variation, abraded
          knuckles, oil-burnished palms/fingertips and rain-dark patches.
Sleeves - heavy charcoal-brown herringbone wool overcoat: heathered fibres, a turned 4.5 cm hem with its fold
          roll, a back vent with top-stitching, fuzz, lint, rain-dark tops, an abraded edge.
Torch   - black anodised aluminium: diamond knurl on the barrel and the bezel ring, bare metal at worn edges,
          knurl crowns, scratches; chrome reflector + krypton bulb behind the lens. Rubber switch boot, nickel
          snaps, horn buttons.

Real-world values (linear albedo / roughness): chestnut aniline calf 0.07-0.11 / 0.4-0.5 (burnished 0.3, abraded
0.6), charcoal wool 0.04-0.07 / 0.9-1.0, black anodise F0 ~0.03 / 0.35-0.45, bare aluminium F0 0.9 (worn ~0.6) /
0.3, nickel F0 ~0.6 / 0.3, black rubber 0.02-0.04 / 0.7-0.85, polished horn 0.03 / 0.3. Heights are metres (the
normal bake uses Bump distance 1.0).
"""
import math

import numpy as np

from lib import noise
from lib.noise import smoothstep as ss
from . import body
from .tex_harlan import _mix, _tile

FINGERS = ('thumb', 'index', 'middle', 'ring', 'pinky')


def _n(v):
    return v / np.linalg.norm(v)


def _line(e, half, aa=0.00012):
    """1 inside |e| < half, smooth edges of width aa (metres)."""
    return ss(half + aa, np.maximum(half - aa, 0.0), np.abs(e))


def _dash(phase, duty=0.62):
    """Stitch dashes along a seam: 1 on the thread, 0 in the gaps (phase in stitch lengths)."""
    f = phase - np.floor(phase)
    return ss(0.0, 0.08, f) * ss(duty + 0.08, duty, f)


def _stitch_row(e, phase, half=0.00032):
    """A row of stitches centred on e = 0: (thread mask, needle-hole mask)."""
    thread = _line(e, half) * _dash(phase)
    f = phase - np.floor(phase)
    hole = _line(e, half * 0.9) * (ss(0.06, 0.0, np.abs(f - 0.66)) + ss(0.06, 0.0, np.minimum(f, 1 - f)))
    return thread, np.clip(hole, 0, 1)


# ------------------------------------------------------------------------------------------------ gloves
def _hand_side(P, J):
    wl = J['hand_l'][0]
    wr = J['hand_r'][0]
    return np.linalg.norm(P - wl, axis=1) < np.linalg.norm(P - wr, axis=1)


def _glove_hand(P, N, AO, J, side, site):
    n = len(P)
    wr, a, nrm, l, L = body.hand_axes(J, side)
    dors = -nrm
    fa0, fa1 = J[f'forearm_{side}']
    axf = _n(fa1 - fa0)
    q = P - wr
    u_h, v_h, w_h = q @ a, q @ l, q @ dors
    # nearest finger segment: label, distance along it, radial distance, angle about it (0 = back, +-pi = pad)
    best = np.full(n, 1e9)
    fid = np.full(n, -1)
    seg = np.zeros(n, np.int64)
    s_al = np.zeros(n)
    s_len = np.zeros(n)
    theta = np.zeros(n)
    rloc = np.zeros(n)
    joints = {}
    for fi, f in enumerate(FINGERS):
        for i in (1, 2, 3):
            h, t = J[f'{f}_{i:02d}_{side}']
            d = t - h
            Ls = float(np.linalg.norm(d))
            u = d / Ls
            s = (P - h) @ u
            sc = np.clip(s, 0.0, Ls)
            rad = P - h - sc[:, None] * u
            dist = np.linalg.norm(rad, axis=1)
            m = dist < best
            if f == 'thumb':
                ref = 0.6 * dors + 0.8 * l
            else:
                ref = np.cross(l, u)
                # cross(l, u) is a pseudo-vector: on the mirrored hand it points out of the PALM (hand_axes flips n
                # by the thumb, not by handedness), which put the pad-side flexion folds round the backs of the
                # fingers as double 'bamboo' rings. theta = 0 must be the back of the finger on both hands.
                if float(ref @ dors) < 0.0:
                    ref = -ref
            ref = _n(ref - u * (ref @ u))
            lat = np.cross(u, ref)
            th = np.arctan2(rad @ lat, rad @ ref)
            best[m], fid[m], seg[m], s_al[m], s_len[m], theta[m] = dist[m], fi, i, s[m], Ls, th[m]
            rloc[m] = np.linalg.norm(P[m] - h - s[m, None] * u, axis=1)
            joints[(f, i)] = (h, u, Ls)
    rloc = np.clip(rloc, 0.006, 0.016)
    mcp_u = {f: float((J[f'{f}_01_{side}'][0] - wr) @ a) for f in FINGERS[1:]}
    mcp_v = {f: float((J[f'{f}_01_{side}'][0] - wr) @ l) for f in FINGERS[1:]}
    u_mcp = float(np.mean(list(mcp_u.values())))
    # regions
    is_thumb = fid == 0
    on_finger = (best < 0.0165) & ((seg > 1) | (s_al > 0.002) | is_thumb)
    back = (~on_finger) & (w_h > 0.0) & (N @ dors > 0.15)
    palm = (~on_finger) & ~back
    arc = theta * rloc                              # metres around the finger from the back centre line
    gripping = side == 'l'

    h = np.zeros(n)
    thread = np.zeros(n)
    holes = np.zeros(n)
    dark = np.zeros(n)          # deep openings (vent, perforations): shadowed lining/skin
    skin = np.zeros(n)          # knuckle holes: bare skin
    wrinkle = np.zeros(n)
    abr = np.zeros(n)
    burn = np.zeros(n)
    rng_w = noise.fbm(P * 260.0, 2, 201 + gripping)

    # A. finger side seams (pique: the back panel laps over the fourchette, 0.4 mm step, stitched 1.2 mm in)
    fing = on_finger & ~is_thumb
    for sgn in (1.0, -1.0):
        e = (sgn * theta - math.pi / 2) * rloc      # > 0 toward the pad
        h += np.where(fing, 0.0004 * ss(0.0003, -0.0003, e) - 0.00025 * _line(e, 0.00025), 0.0)
        tr, ho = _stitch_row(e + 0.0012, s_al / 0.0026 + sgn * 0.3)
        thread += np.where(fing, tr, 0.0)
        holes += np.where(fing, ho, 0.0)
    # thumb: Bolton seam ring round its root and one seam along its index-facing side
    th_e = np.where(is_thumb & (seg == 1), s_al - 0.42 * s_len, 1.0)
    h += np.where(is_thumb, 0.0004 * ss(0.0003, -0.0003, th_e) - 0.0003 * _line(th_e, 0.0003), 0.0)
    tr, ho = _stitch_row(th_e + 0.0013, theta * 0.011 / 0.0026)
    thread += np.where(is_thumb, tr, 0.0)
    holes += np.where(is_thumb, ho, 0.0)
    e_t = (theta + math.pi / 2) * rloc
    tr, ho = _stitch_row(e_t, s_al / 0.0026)
    thread += np.where(is_thumb & (seg > 1), tr, 0.0)
    h += np.where(is_thumb & (seg > 1), -0.0003 * _line(e_t + 0.0011, 0.00025), 0.0)

    # B. three 'points' on the back of the hand (raised cord between two stitch rows), converging to the wrist
    order = ['index', 'middle', 'ring', 'pinky']
    top = 0.62 * u_mcp
    for k in range(3):
        vk = 0.5 * (mcp_v[order[k]] + mcp_v[order[k + 1]])
        vline = vk * (0.62 + 0.38 * np.clip(u_h / top, 0, 1))
        e = v_h - vline
        span = ss(0.006, 0.010, u_h) * ss(top + 0.002, top - 0.004, u_h) * back
        cord = _line(e, 0.00045, 0.0002) * span
        h += 0.00035 * cord
        for off in (-0.0013, 0.0013):
            tr, ho = _stitch_row(e - off, u_h / 0.0022)
            thread += tr * span
            holes += ho * span

    # C. perforated finger backs (round C review: the old 2.4 mm grid over segments 1-2 read as a rubber grip at 0.4 m).
    # Driving-glove perforation (e.g. unlined capeskin): ~1.1 mm holes on a ~3.4 x 3.0 mm grid, proximal segment only.
    perf_zone = fing & (seg == 1) & (np.abs(theta) < 0.8) & (s_al > 0.004) & (s_al < s_len - 0.004)
    gs, ga = 0.0034, 0.0030
    ds = (s_al / gs) - np.round(s_al / gs)
    row = np.round(s_al / gs)
    da = (arc / ga + 0.5 * (row % 2)) - np.round(arc / ga + 0.5 * (row % 2))
    pd = np.sqrt((ds * gs) ** 2 + (da * ga) ** 2)
    perf = ss(0.00062, 0.00046, pd) * perf_zone
    dark += perf
    h -= 0.0005 * perf

    # D. joints: wrinkles on the back, flexion creases on the pad side
    for fi, f in enumerate(FINGERS):
        for i in (2, 3):
            hj, uj, _ = joints[(f, i)]
            up_, _, _ = joints[(f, i - 1)]
            ua = _n(uj + _n(hj - up_))
            dj = (P - hj) @ ua
            near = (fid == fi) & (np.abs(dj) < 0.009)
            if not near.any():
                continue
            fade = np.clip(1 - np.abs(dj) / 0.009, 0, 1) ** 1.4
            # back: 4-7 arcing wrinkles 1.4-2.6 mm apart, each one broken and of its own depth; the gripping
            # (stretched) hand gets fewer, softer ones
            warp = 0.9 * noise.fbm(P * 260.0, 3, 210 + fi * 7 + i)
            ph = (dj + 0.0018 * (theta / 1.2) ** 2) / 0.0019 + warp
            k = np.round(ph)
            dist = np.abs(ph - k) * 0.0019
            depth = 0.45 + 0.55 * noise.hash01(k.astype(np.int64) + fi * 31 + i * 7, 211)
            width = 0.00022 + 0.00014 * noise.hash01(k.astype(np.int64) + fi * 17 + i * 3, 212)
            g = np.exp(-(dist / width) ** 2) * depth
            g *= ss(1.4, 0.5, np.abs(theta + 0.25 * noise.fbm(P * 150.0, 2, 213))) * fade
            g *= ss(-0.45, 0.05, noise.fbm(P * np.array([500.0, 500.0, 500.0]), 2, 214 + fi))
            amp = 0.00026 if gripping else 0.00042
            h -= np.where(near, amp * g, 0.0)
            wrinkle += np.where(near, g, 0.0)
            # pad side: one or two deep folds right at the crease
            pc = ss(2.25, 2.7, np.abs(theta)) * (np.exp(-((dj + 0.0004) / 0.00055) ** 2)
                                               + 0.6 * np.exp(-((dj - 0.0018) / 0.0005) ** 2))
            h -= np.where(near, (0.0007 if gripping else 0.0005) * pc, 0.0)
            wrinkle += np.where(near, pc, 0.0)
            # abraded crowns of the knuckles (the stretched leather catches everything)
            ab = np.exp(-((dj + 0.001) / 0.0035) ** 2) * ss(0.9, 0.2, np.abs(theta))
            abr += np.where(near, ab * (1.3 if gripping else 0.8), 0.0)
    # MCP knuckles: leather bunching across the back of the hand just behind the knuckle line
    mb = back & (u_h > u_mcp - 0.016) & (u_h < u_mcp + 0.004)
    ph = (u_h - (u_mcp - 0.006) + 0.0012 * noise.fbm(P * 120.0, 2, 220)) / 0.0032
    g = np.exp(-((np.abs(ph - np.round(ph)) * 0.0032) / 0.0004) ** 2) * ss(-0.3, 0.2, rng_w)
    h -= np.where(mb, (0.00015 if gripping else 0.0003) * g, 0.0)
    wrinkle += np.where(mb, g * 0.7, 0.0)
    for f in order:
        kc = J[f'{f}_01_{side}'][0] + dors * 0.008
        abr += np.exp(-(np.linalg.norm(P - kc, axis=1) / 0.0065) ** 2) * (1.2 if gripping else 0.7)
    # G. knuckle holes (classic driving glove): an oval opening over each MCP knuckle, index..pinky, 10.5 mm along the
    # hand x 12.5 mm across, the cut edge turned and bound (a raised 1.5 mm roll) with a stitch row 2 mm outside it;
    # bare skin shows through ~1.2 mm below the leather surface (shadowed rim), the knuckle crown catching light.
    for f in order:
        kc = J[f'{f}_01_{side}'][0] + dors * 0.008
        dq = P - kc
        du, dv, dw = dq @ a, dq @ l, dq @ dors
        e = np.sqrt((du / 0.00525) ** 2 + (dv / 0.00625) ** 2)
        mk = (w_h > 0.0) & (N @ dors > 0.15) & (dw > -0.007)
        open_ = ss(1.0, 0.92, e) * mk
        rim = np.exp(-((e - 1.1) / 0.09) ** 2) * mk
        skin += open_
        dark += 0.55 * ss(1.0, 0.8, e) * ss(0.7, 0.9, e) * mk           # the thin shadow under the turned edge
        h += 0.00035 * rim - 0.0012 * open_
        tr, ho = _stitch_row((e - 1.42) * 0.0058, np.arctan2(dv, du) * 0.0058 / 0.0022)
        thread += tr * mk * ss(1.7, 1.55, e)
        holes += ho * mk * ss(1.7, 1.55, e)
        abr *= 1 - open_
    # palm creases (glove leather folds where the palm flexes) + the thenar arc
    for uu, amp in ((0.80, 0.0005), (0.64, 0.0004)):
        e = u_h - uu * u_mcp - 0.004 * np.sin(v_h * 90.0) - 0.0025 * noise.fbm(P * 90.0, 2, 230)
        h -= np.where(palm, amp * np.exp(-(e / 0.0006) ** 2), 0.0)
        wrinkle += np.where(palm, np.exp(-(e / 0.0006) ** 2), 0.0)
    tb = J[f'thumb_01_{side}'][0]
    e = np.linalg.norm(P - tb, axis=1) - 0.026
    h -= np.where(palm, 0.0004 * np.exp(-(e / 0.0007) ** 2), 0.0)

    # E. wrist: vent slit closed by a strap tab under the snap
    c, nr, aa = site
    t2 = _n(np.cross(nr, aa))
    qs = P - c
    x, y, z = qs @ t2, qs @ aa, qs @ nr
    local = (np.abs(z) < 0.008) & (np.abs(x) < 0.03) & (y > -0.07) & (y < 0.02)
    xa, xb, rt = -0.009, 0.004, 0.0068
    xc = np.clip(x, xa, xb)
    d2 = np.sqrt((x - xc) ** 2 + y ** 2) - rt
    tab = ss(0.00025, -0.00025, d2) * local
    vent_hw = 0.0006 + 0.0035 * np.clip(-(y + 0.009) / 0.045, 0, 1)
    vent = _line(x + 0.0015, vent_hw, 0.0002) * ss(0.004, 0.002, y) * local * (1 - tab)
    dark += vent
    h += 0.0011 * tab - 0.0012 * vent
    # binding stitches: round the tab outline and down both edges of the vent
    ang = np.where(x < xa, np.arctan2(y, x - xa) * rt, np.where(x > xb, np.arctan2(y, x - xb) * rt, x))
    tr, ho = _stitch_row(d2 + 0.0016, ang / 0.0022)
    thread += tr * local
    holes += ho * local
    for sgn in (-1, 1):
        tr, ho = _stitch_row(x + 0.0015 - sgn * (vent_hw + 0.0018), y / 0.0024)
        m = local * (1 - tab) * ss(0.0, -0.003, y)
        thread += tr * m
        holes += ho * m
    # the cuff end (mostly under the coat sleeve): turned edge + a stitch row 5 mm in
    u_f = q @ axf
    ce = u_f + 0.062
    tr, ho = _stitch_row(ce - 0.005, (q @ np.cross(axf, dors)) / 0.0024 + (q @ dors) / 0.0024)
    cm = ce < 0.012
    thread += np.where(cm, tr, 0.0)
    h += np.where(cm, 0.0003 * ss(0.002, 0.0, ce), 0.0)

    # fine transverse creasing all along the fingers (worn-in leather), stronger on the pad side
    mc = noise.ridged(np.stack([s_al * 900.0, arc * 160.0, np.full(n, fid * 3.1)], 1), 3, 215)
    mcl = ss(0.8, 0.96, mc) * on_finger * (0.5 + 0.5 * ss(1.0, 2.6, np.abs(theta)))
    h -= 0.00012 * mcl
    wrinkle += 0.5 * mcl

    # F. burnished contact areas: palm, finger pads, finger tips, the left palm on the torch
    pad = (on_finger & (np.abs(theta) > 2.0)) | palm
    tip = on_finger & (seg == 3) & (s_al > 0.55 * s_len)
    burn = np.clip(pad * (0.8 if gripping else 0.55) + tip * 0.9, 0, 1) * ss(-0.4, 0.3, noise.fbm(P * 60.0, 3, 240))
    abr = np.clip(abr, 0, 1) * ss(-0.15, 0.35, noise.fbm(P * 150.0, 3, 241))
    return h, np.clip(thread, 0, 1), np.clip(holes, 0, 1), np.clip(dark, 0, 1), np.clip(wrinkle, 0, 1), abr, burn, tab, \
        np.clip(skin, 0, 1)


def gloves(P, N, AO, ctx):
    n = len(P)
    J = ctx['J']
    left = _hand_side(P, J)
    h = np.zeros(n)
    thread = np.zeros(n)
    holes = np.zeros(n)
    dark = np.zeros(n)
    wrinkle = np.zeros(n)
    abr = np.zeros(n)
    burn = np.zeros(n)
    tab = np.zeros(n)
    skin = np.zeros(n)
    for side, m in (('l', left), ('r', ~left)):
        idx = np.nonzero(m)[0]
        if not len(idx):
            continue
        r = _glove_hand(P[idx], N[idx], AO[idx], J, side, ctx['sites'][side])
        for arr, v in zip((h, thread, holes, dark, wrinkle, abr, burn, tab, skin), r):
            arr[idx] = v
    # chestnut aniline calf; hide variation (blotchy, slightly redder in the darker areas)
    hide = noise.fbm(P * 22.0, 4, 250)
    alb = _tile([0.088, 0.047, 0.027], n) * (1 + 0.22 * hide)[:, None]
    alb = _mix(alb, [0.066, 0.031, 0.018], ss(0.0, 0.5, -hide) * 0.5)
    # pebble grain + pores + fine hide 'break' lines
    f1, f2 = noise.worley(P * 1100.0, 251)
    grain = ss(0.16, 0.02, f2 - f1)
    pores = ss(0.12, 0.04, noise.worley(P * 2600.0, 252)[0])
    brk = ss(0.86, 0.97, noise.ridged(P * np.array([330.0, 330.0, 330.0]), 3, 253))
    peel = noise.fbm(P * 420.0, 3, 255)          # the hide's own soft undulation (orange-peel) under the grain
    alb *= (1 - 0.10 * grain - 0.12 * pores - 0.15 * brk)[:, None]
    h += -0.00004 * grain - 0.00003 * pores - 0.00007 * brk + 0.00005 * peel
    # dye pools in creases and seams, grime in the occluded folds
    alb *= (1 - 0.35 * wrinkle)[:, None]
    alb *= (0.62 + 0.38 * np.clip(AO, 0, 1) ** 0.8)[:, None]
    # abrasion: the colour coat worn through to the paler, drier corium; burnish: oil-dark and glossy
    alb = _mix(alb, [0.155, 0.105, 0.072], abr * 0.65)
    alb = _mix(alb, alb * np.array([0.72, 0.66, 0.62]), burn)
    # rain: dark, glossy patches on the up-facing leather, drying at the edges
    wet = ss(0.0, 0.35, noise.fbm(P * 14.0, 3, 254)) * ss(-0.1, 0.5, N[:, 2])
    alb *= (1 - 0.25 * wet)[:, None]
    # thread (tonal, a shade lighter) and openings (shadowed lining/skin)
    alb = _mix(alb, [0.13, 0.082, 0.05], thread * 0.85)
    alb = _mix(alb, [0.012, 0.007, 0.005], holes * 0.6 + dark * 0.9)
    h += 0.00022 * thread - 0.00012 * holes
    rough = 0.5 + 0.06 * hide + 0.12 * abr - 0.16 * burn - 0.22 * wet + 0.1 * grain + 0.1 * wrinkle + 0.05 * peel
    rough = np.where(thread > 0.5, 0.62, rough)
    rough = rough * (1 - dark) + 0.8 * dark
    # knuckle-hole skin: fair, cold, chapped back-of-hand skin (linear albedo ~0.30/0.19/0.14, roughness 0.5-0.6),
    # reddened over the knuckle crown, dry creases; it sits in the opening's shadow (AO)
    sk = _tile([0.30, 0.19, 0.14], n) * (1 + 0.12 * noise.fbm(P * 300.0, 3, 256))[:, None]
    sk = _mix(sk, [0.33, 0.15, 0.12], 0.35 * ss(-0.2, 0.4, noise.fbm(P * 80.0, 2, 257)))
    sk *= (1 - 0.3 * ss(0.85, 0.97, noise.ridged(P * 700.0, 2, 258)))[:, None]
    sk *= (0.55 + 0.45 * np.clip(AO, 0, 1))[:, None]
    alb = _mix(alb, sk, skin * (1 - thread))
    rough = rough * (1 - skin) + 0.55 * skin
    return np.clip(alb, 0, 1), np.clip(rough, 0.2, 0.9), h


# ------------------------------------------------------------------------------------------------ sleeves
def _sleeve_frame(J, side):
    fa0, fa1 = J[f'forearm_{side}']
    ax = _n(fa1 - fa0)
    cut = fa1 - ax * 0.035
    ref = _n(np.array([0, 0, 1.0]) - ax * ax[2])
    return fa0, fa1, ax, cut, ref


def wool(P, N, AO, ctx):
    n = len(P)
    J = ctx['J']
    left = P[:, 0] < 0
    edge = np.zeros(n)
    ang = np.zeros(n)
    rr = np.zeros(n)
    vent_a = np.zeros(n)
    for side, m in (('l', left), ('r', ~left)):
        fa0, fa1, ax, cut, ref = _sleeve_frame(J, side)
        q = P[m] - fa0
        rad = q - np.outer(q @ ax, ax)
        edge[m] = (cut - P[m]) @ ax
        ang[m] = np.arctan2(rad @ np.cross(ax, ref), rad @ ref)
        rr[m] = np.clip(np.linalg.norm(rad, axis=1), 0.03, 0.08)
        s = -1.0 if side == 'l' else 1.0
        o = np.array([s, 0.0, 0.55])
        out = _n(o - ax * (o @ ax))
        a_out = math.atan2(out @ np.cross(ax, ref), out @ ref)
        da = (ang[m] - a_out + math.pi) % (2 * math.pi) - math.pi
        vent_a[m] = da * rr[m]                       # metres round the sleeve from the button line
    c = ang * rr
    # herringbone twill: 3 mm ribs, the diagonal flips every 9 mm band round the sleeve
    band = np.floor(c / 0.009)
    sg = np.where(band % 2 == 0, 1.0, -1.0)
    rib = np.sin(2 * math.pi * (edge + sg * (c - band * 0.009)) / 0.0032)
    tw = 0.5 + 0.5 * rib
    hb_edge = _line(c - (band + 0.5) * 0.009 + 0.0045, 0.0003)
    # heathered charcoal-brown: dark and grey-brown fibres, slubs, some rust-brown flecks
    heat = noise.fbm(P * np.array([260.0, 260.0, 260.0]), 3, 301)
    alb = _mix(_tile([0.045, 0.042, 0.039], n), [0.095, 0.086, 0.074], ss(-0.25, 0.45, heat) * 0.55)
    fleck = ss(0.08, 0.02, noise.worley(P * 700.0, 302)[0]) * ss(0.3, 0.6, noise.fbm(P * 40.0, 2, 303))
    alb = _mix(alb, [0.12, 0.07, 0.045], fleck * 0.5)
    alb *= (0.9 + 0.12 * tw - 0.08 * hb_edge)[:, None]
    lint = ss(0.05, 0.015, noise.worley(P * 180.0, 304)[0]) * ss(0.55, 0.75, noise.fbm(P * 15.0, 2, 305))
    alb = _mix(alb, [0.16, 0.15, 0.14], lint * 0.6)
    # hem: abraded edge, the fold roll at 4.5 cm, blind-stitch dimples at 4 cm
    worn = ss(0.008, 0.0, edge) * ss(-0.2, 0.3, noise.fbm(P * 90.0, 2, 306))
    alb = _mix(alb, [0.1, 0.095, 0.088], worn * 0.6)
    fold = np.exp(-((edge - 0.045) / 0.0015) ** 2)
    blind = np.exp(-((edge - 0.040) / 0.0006) ** 2) * _dash(c / 0.006, 0.15)
    # back vent: the overlap edge 1.2 cm behind the buttons, top-stitched 6 mm in, bar-tacked at 10 cm
    vz = (edge > -0.002) & (edge < 0.105)
    ve = vent_a + 0.012
    step = ss(0.0004, -0.0004, ve) * vz
    tr, ho = _stitch_row(ve - 0.006, edge / 0.003, 0.00035)
    vthread = tr * vz * (edge < 0.098)
    tr2, _ = _stitch_row(edge - 0.1, (vent_a + 0.02) / 0.003, 0.00035)
    vthread += tr2 * ((vent_a > -0.02) & (vent_a < 0.006))
    alb = _mix(alb, [0.03, 0.028, 0.026], _line(ve, 0.0004) * vz * 0.8)
    alb = _mix(alb, [0.07, 0.065, 0.06], np.clip(vthread, 0, 1) * 0.6)
    # rain: darker on the up-facing cloth, beads sitting on the nap
    wet = ss(0.05, 0.4, noise.fbm(P * np.array([14.0, 14.0, 6.0]), 3, 307)) * ss(-0.2, 0.6, N[:, 2])
    alb *= (1 - 0.32 * wet)[:, None]
    alb *= (0.5 + 0.5 * np.clip(AO, 0, 1))[:, None]
    fuzz = noise.fbm(P * 900.0, 2, 308)
    h = 0.00016 * rib + 0.00012 * fuzz + 0.00025 * noise.fbm(P * 70.0, 2, 309) - 0.0001 * hb_edge
    h += 0.0005 * fold - 0.00025 * blind + 0.0007 * step - 0.0003 * _line(ve, 0.0003) * vz - 0.00018 * vthread
    rough = 0.92 - 0.14 * wet - 0.12 * worn + 0.03 * fuzz
    return np.clip(alb, 0, 1), np.clip(rough, 0.5, 1.0), h


# ------------------------------------------------------------------------------------------------ the torch
def _torch_coords(P, ctx):
    tail, F, up = ctx['tail'], ctx['F'], ctx['up']
    t = (P - tail) @ F
    radial = P - tail - np.outer(t, F)
    r = np.linalg.norm(radial, axis=1)
    ang = np.arctan2(radial @ np.cross(F, up), radial @ up)
    return t, r, ang


def _knurl(t, ang, r, pitch=0.0013):
    """Diamond knurl (two crossing 30-degree helices): 1 at a pyramid crown, 0 in the grooves."""
    nround = np.maximum(np.round(2 * math.pi * r / pitch), 1)
    p1 = t / pitch + ang * nround / (2 * math.pi)
    p2 = t / pitch - ang * nround / (2 * math.pi)
    tri = lambda p: 1 - 2 * np.abs(p - np.floor(p) - 0.5)
    return np.minimum(tri(p1), tri(p2))


def flashlight(P, N, AO, ctx):
    n = len(P)
    t, r, ang = _torch_coords(P, ctx)
    lens = (t > 0.2276) & (r < 0.02235)
    knurl_b = (t > 0.0446) & (t < 0.147)
    knurl_z = (t > 0.2372) & (t < 0.2468) & (r > 0.0253)
    kn = _knurl(t, ang, r)
    kz = knurl_b | knurl_z
    # wear: knurl crowns, ring crests (the profile's largest radii), the tail edge, the bezel lip, random scuffs
    # The tail end is what the first-person camera sees (the torch points away from the eye), so its wear must
    # read as chips where the cap is set down on a table, not a continuous bright ring (art-director review
    # 2026-10-07: a full bare-aluminium ring read as a shiny lens). Real anodised tail caps: 10-30 % of the edge
    # chipped through to bare metal, in patches a few mm long.
    chip = ss(0.15, 0.35, noise.fbm(np.stack([np.cos(ang) * 6.0, np.sin(ang) * 6.0, t * 60.0], 1), 3, 407))
    crest = ss(0.01945, 0.0196, r) * ((t < 0.0318) * chip + ((t > 0.164) & (t < 0.184))) * 0.5
    lip = ss(0.2486, 0.2497, t) * (r > 0.0235) + ss(0.0016, 0.0, t) * ss(0.012, 0.016, r) * chip
    scuff = ss(0.62, 0.8, noise.fbm(np.stack([t * 90, np.cos(ang) * 2, np.sin(ang) * 2], 1), 3, 401))
    scratch = ss(0.94, 0.995, noise.ridged(np.stack([t * 25.0, np.cos(ang) * 12.0, np.sin(ang) * 12.0], 1), 3, 402))
    # hand-polished where the grip wears it: the underside of the barrel and the head flare
    grip = ss(0.4, 1.0, -np.cos(ang)) * ((t > 0.05) & (t < 0.16)) * 0.4
    wear = np.clip(ss(0.72, 0.95, kn) * kz * 0.9 + crest * 0.8 + lip + scuff * 0.7 + scratch * 0.8 + grip * kz, 0, 1)
    anod = _tile([0.028, 0.028, 0.031], n) * (1 + 0.15 * noise.fbm(P * 400.0, 2, 403))[:, None]
    alu = _tile([0.62, 0.62, 0.63], n) * (1 + 0.1 * noise.fbm(P * 900.0, 2, 404))[:, None]
    alb = _mix(anod, alu, wear)
    grime = ss(0.85, 0.45, AO) + kz * ss(0.3, 0.05, kn) * 0.6
    alb = _mix(alb, [0.03, 0.026, 0.022], np.clip(grime, 0, 1) * 0.55)
    rough = 0.40 + 0.08 * noise.fbm(P * 200.0, 2, 405) - 0.1 * wear + 0.15 * scratch + 0.2 * np.clip(grime, 0, 1)
    h = np.where(kz, 0.00028 * (kn - 0.5), 0.0) - 0.00004 * scratch
    # behind the lens: chrome parabolic reflector (dark glossy under the glass), krypton bulb, dust on the glass
    bulb = lens & (r < 0.0047)
    alb = np.where(lens[:, None], _tile([0.11, 0.11, 0.115], n), alb)
    alb = np.where(bulb[:, None], _tile([0.75, 0.72, 0.62], n), alb)
    dust = ss(0.55, 0.85, noise.fbm(P * 700.0, 2, 406))
    rough = np.where(lens, 0.05 + 0.25 * dust, rough)
    alb = np.where(lens[:, None], _mix(alb, [0.2, 0.19, 0.17], dust * 0.4), alb)
    h = np.where(lens, 0.0, h)
    return np.clip(alb, 0, 1), np.clip(rough, 0.03, 1), h


def switch(P, N, AO, ctx):
    n = len(P)
    t, r, ang = _torch_coords(P, ctx)
    crown = ss(0.0206, 0.0214, r)
    alb = _tile([0.026, 0.025, 0.024], n) * (1 + 0.15 * noise.fbm(P * 600.0, 2, 411))[:, None]
    alb *= (0.7 + 0.3 * AO)[:, None]
    alb = _mix(alb, [0.05, 0.048, 0.046], ss(0.3, 0.7, noise.fbm(P * 300.0, 2, 412)) * 0.3)   # bloom/chalking
    rough = 0.8 - 0.32 * crown
    h = 0.00006 * noise.fbm(P * 1500.0, 2, 413) + 0.00015 * _line(r - 0.0201, 0.0003)
    return np.clip(alb, 0, 1), np.clip(rough, 0.3, 1), h


def snaps(P, N, AO, ctx):
    n = len(P)
    J = ctx['J']
    left = _hand_side(P, J)
    rr = np.zeros(n)
    for side, m in (('l', left), ('r', ~left)):
        c, nr, a = ctx['sites'][side]
        q = P[m] - c
        rr[m] = np.linalg.norm(q - np.outer(q @ nr, nr), axis=1)
    nickel = _tile([0.58, 0.55, 0.49], n)
    brass = _tile([0.62, 0.45, 0.22], n)
    worn = ss(0.0028, 0.001, rr) * ss(0.2, 0.6, noise.fbm(P * 2000.0, 2, 421))
    alb = _mix(nickel, brass, worn * 0.7)
    tarn = ss(0.85, 0.4, AO) + ss(0.0062, 0.0072, rr)
    alb = _mix(alb, [0.16, 0.14, 0.11], np.clip(tarn, 0, 1) * 0.6)
    rings = np.sin(rr * 2 * math.pi / 0.0006)
    rough = 0.28 + 0.15 * np.clip(tarn, 0, 1) + 0.05 * rings
    h = 0.00002 * rings - 0.0003 * ss(0.0009, 0.0004, rr)
    return np.clip(alb, 0, 1), np.clip(rough, 0.1, 1), h


def buttons(P, N, AO, ctx):
    n = len(P)
    # horn: near-black brown with paler translucent striations, polished
    st = noise.fbm(P * np.array([900.0, 120.0, 120.0]), 3, 431)
    alb = _mix(_tile([0.028, 0.02, 0.015], n), [0.085, 0.06, 0.04], ss(0.1, 0.5, st) * 0.6)
    # four holes + the thread cross (coat-coloured thread)
    f1, _ = noise.worley(P * 300.0, 432)
    holes = ss(0.18, 0.12, f1) * ss(0.85, 0.5, AO)
    alb = _mix(alb, [0.01, 0.008, 0.006], holes)
    alb *= (0.7 + 0.3 * AO)[:, None]
    rough = 0.3 + 0.2 * ss(0.85, 0.5, AO)
    h = -0.0004 * holes
    return np.clip(alb, 0, 1), np.clip(rough, 0.1, 1), h


def shader(kind, ctx):
    fn = {'gloves': gloves, 'sleeves': wool, 'flashlight': flashlight, 'switch': switch, 'snaps': snaps,
          'buttons': buttons}[kind]
    return lambda P, N, AO, G: fn(P, N, AO, ctx)
