"""Harlan's procedural textures (per texel, linear colour). The sack uses its baked 'Fabric' coordinates (u around
the sack, v metres down from the top seam) for the burlap weave and the stencil, drawn with our own stroke font."""
import math

import numpy as np

from lib import noise
from lib.noise import smoothstep as ss

# ---------------------------------------------------------------------------------------------- stencil stroke font
# glyph box: x in [0, 0.8], y in [0, 1] (y up). Polylines; stencil bridges are gaps (x0, y0, x1, y1) boxes.
_O = [(0.4 + 0.36 * math.cos(a), 0.5 + 0.5 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 25)]
GLYPHS = {
    'S': ([[(0.75, 0.85), (0.6, 1), (0.2, 1), (0.05, 0.85), (0.05, 0.62), (0.2, 0.52), (0.6, 0.48), (0.75, 0.38),
            (0.75, 0.15), (0.6, 0), (0.2, 0), (0.05, 0.15)]], []),
    'T': ([[(0, 1), (0.8, 1)], [(0.4, 1), (0.4, 0)]], [(0.34, 0.86, 0.46, 1.1)]),
    'R': ([[(0.05, 0), (0.05, 1), (0.55, 1), (0.72, 0.88), (0.72, 0.62), (0.55, 0.5), (0.05, 0.5)], [(0.4, 0.5), (0.75, 0)]],
          [(0.14, 0.88, 0.24, 1.1), (0.14, 0.4, 0.24, 0.6)]),
    'O': ([_O], [(0.35, 0.85, 0.45, 1.1), (0.35, -0.1, 0.45, 0.15)]),
    'U': ([[(0.05, 1), (0.05, 0.2), (0.2, 0), (0.6, 0), (0.75, 0.2), (0.75, 1)]], [(0.35, -0.1, 0.45, 0.12)]),
    'D': ([[(0.05, 0), (0.05, 1), (0.45, 1), (0.7, 0.8), (0.75, 0.5), (0.7, 0.2), (0.45, 0), (0.05, 0)]],
          [(0.14, 0.86, 0.24, 1.1), (0.14, -0.1, 0.24, 0.14)]),
    'F': ([[(0.75, 1), (0.05, 1), (0.05, 0)], [(0.05, 0.52), (0.55, 0.52)]], [(0.14, 0.88, 0.22, 1.1)]),
    'E': ([[(0.75, 1), (0.05, 1), (0.05, 0), (0.75, 0)], [(0.05, 0.52), (0.55, 0.52)]], [(0.14, 0.88, 0.22, 1.1), (0.14, -0.1, 0.22, 0.12)]),
    'N': ([[(0.05, 0), (0.05, 1), (0.75, 0), (0.75, 1)]], []),
    '&': ([[(0.8, 0), (0.25, 0.62), (0.2, 0.85), (0.35, 1), (0.5, 0.85), (0.45, 0.65), (0.1, 0.35), (0.1, 0.12), (0.3, 0),
            (0.5, 0.05), (0.75, 0.35)]], []),
    '1': ([[(0.2, 0.8), (0.45, 1), (0.45, 0)]], []),
    '0': ([_O], [(0.35, 0.85, 0.45, 1.1)]),
    'L': ([[(0.05, 1), (0.05, 0), (0.7, 0)]], []),
    'B': ([[(0.05, 0), (0.05, 1), (0.5, 1), (0.68, 0.88), (0.68, 0.64), (0.5, 0.52), (0.05, 0.52)],
           [(0.5, 0.52), (0.72, 0.4), (0.72, 0.12), (0.5, 0), (0.05, 0)]], [(0.14, 0.44, 0.24, 0.6)]),
    ' ': ([], []),
}


def text_mask(x, y, text, x0, y0, cap, width=0.13, spacing=1.05):
    """Coverage of `text` at points (x, y) (metres), baseline-left at (x0, y0) (y up), cap height `cap`."""
    out = np.zeros(len(x))
    cx = x0
    w = width * cap
    for ch in text:
        strokes, gaps = GLYPHS.get(ch, ([], []))
        gx = (x - cx) / cap
        gy = (y - y0) / cap
        near = (gx > -0.3) & (gx < 1.1) & (gy > -0.3) & (gy < 1.3)
        if near.any():
            px, py = gx[near], gy[near]
            d = np.full(len(px), 9.0)
            for st in strokes:
                for (ax, ay), (bx, by) in zip(st[:-1], st[1:]):
                    ex, ey = bx - ax, by - ay
                    l2 = ex * ex + ey * ey + 1e-12
                    tt = np.clip(((px - ax) * ex + (py - ay) * ey) / l2, 0, 1)
                    d = np.minimum(d, np.hypot(px - ax - tt * ex, py - ay - tt * ey))
            cov = ss(width * 0.62, width * 0.45, d)
            for gx0, gy0, gx1, gy1 in gaps:
                cov *= ~((px > gx0) & (px < gx1) & (py > gy0) & (py < gy1))
            sub = out[near]
            out[near] = np.maximum(sub, cov)
        cx += (0.8 + 0.25 * spacing) * cap if ch != ' ' else 0.5 * cap
    return out


def text_width(text, cap, spacing=1.05):
    return sum((0.8 + 0.25 * spacing) * cap if c != ' ' else 0.5 * cap for c in text) - 0.25 * spacing * cap


def _mix(a, b, t):
    return a + (np.asarray(b, float) - a) * np.asarray(t, float)[..., None]


def _tile(c, n):
    return np.tile(np.asarray(c, float), (n, 1))


# ---------------------------------------------------------------------------------------------- materials
def skin(P, N, AO, ctx):
    n = len(P)
    alb = _tile([0.42, 0.28, 0.22], n) * (1 + 0.12 * noise.fbm(P * 20, 4, 1))[:, None]
    spots = ss(0.6, 0.8, noise.fbm(P * 60, 3, 2))
    alb = _mix(alb, [0.2, 0.11, 0.07], spots * 0.6)
    # forearm hair: dark streaks along the arm, sparse
    hair = ss(0.8, 0.95, noise.ridged(P * np.array([300.0, 300.0, 60.0]), 2, 3)) * ss(0.2, 0.6, noise.fbm(P * 8, 2, 4))
    alb = _mix(alb, [0.05, 0.04, 0.03], hair * 0.6)
    vein = ss(0.85, 0.96, noise.ridged(P * 24, 3, 5))
    alb = _mix(alb, [0.25, 0.2, 0.22], vein * 0.4)
    grime = ss(0.85, 0.5, AO)
    alb = _mix(alb, [0.08, 0.06, 0.045], grime * 0.5)
    rough = 0.5 + 0.1 * noise.fbm(P * 30, 2, 6)
    f1, _ = noise.worley(P * 500, 7)
    h = -0.00007 * ss(0.3, 0.1, f1) + 0.0003 * vein + 0.0001 * noise.fbm(P * 200, 2, 8)
    return alb, rough, h


def _garment_coords(P, J):
    """(x, y) metres on a garment: around the torso (arc, z) or along a sleeve (angle*r, along)."""
    x = np.arctan2(P[:, 0], -(P[:, 1] - 0.0)) * 0.22
    y = P[:, 2].copy()
    for side in ('l', 'r'):
        for bone in ('upperarm', 'forearm'):
            a, b = J[f'{bone}_{side}']
            ab = b - a
            L = np.linalg.norm(ab)
            t = ((P - a) @ ab) / (L * L)
            d = np.linalg.norm(P - (a + np.outer(np.clip(t, 0, 1), ab)), axis=1)
            on = (d < 0.09) & (t > -0.05) & (t < 1.05)
            if not on.any():
                continue
            u = ab / L
            ref = np.cross(u, [0, 0, 1.0])
            ref /= np.linalg.norm(ref)
            ref2 = np.cross(u, ref)
            q = P[on] - a
            ang = np.arctan2(q @ ref2, q @ ref)
            x[on] = ang * 0.05 + (3.0 if side == 'l' else 5.0)
            y[on] = t[on] * L + (0.0 if bone == 'upperarm' else L + 0.01)
    return x, y


def flannel(P, N, AO, ctx):
    n = len(P)
    J = ctx['J']
    x, y = _garment_coords(P, J)
    warp = 0.003 * noise.fbm(P * 40, 2, 11)
    size = 0.05
    a = np.floor((x + warp) / size) % 2
    b = np.floor((y + warp) / size) % 2
    # buffalo check: red, dark (one black stripe), black (both)
    # fix round 4 (ruling t; ab2-08: 'pink-reading plaid' with olive-grey squares under the restaged lamp): a worn red-black
    # buffalo check is DARK. Red yarn ~0.25/0.04/0.03 linear new, sweat/grease-faded work flannel ~0.17-0.2 with LOW blue
    # (a 1950 K key x the 3300 K grade's blue gain turned any blue in the red into pink); black yarn ~0.02. A one-stripe
    # cell is black weft over red warp: ~75 % black by area -> ~0.06/0.015/0.012 (was 0.09/0.024/0.022 + a 70 % brown-grey
    # grime mix = olive grey). Grime is now dark red-brown and capped at 35 %.
    red = np.array([0.17, 0.038, 0.022])         # r2: lower chroma (R/G 4.5): AgX rendered the 6:1 red as salmon-pink
    blk = np.array([0.018, 0.014, 0.013])
    dark = red * 0.22 + blk * 0.78
    cid = np.floor((x + warp) / size) * 7.31 + np.floor((y + warp) / size) * 3.17
    cell = 0.88 + 0.24 * (np.sin(cid * 12.9898) * 43758.5453 % 1.0)      # per-cell dye/fade variance
    alb = np.where((a * b)[:, None] > 0.5, blk, np.where(((a + b) % 2)[:, None] > 0.5, dark, red)) * cell[:, None]
    fuzz = noise.fbm(P * 300, 2, 12)
    alb = alb * (1 + 0.15 * fuzz)[:, None]
    # wear, sweat, old blood spatter on the sleeves and chest
    grime = ss(0.9, 0.5, AO) * 0.35 + 0.2 * ss(0.3, 0.8, noise.fbm(P * 5, 3, 13))
    alb = _mix(alb, [0.035, 0.016, 0.011], np.clip(grime, 0, 0.35))
    spat = ss(0.72, 0.8, noise.fbm(P * 90, 3, 14)) * ss(0.2, 0.6, noise.fbm(P * 4, 2, 15))
    alb = _mix(alb, [0.04, 0.006, 0.004], spat * 0.8)
    # button placket down the front
    front = (P[:, 1] < -0.05) & (np.abs(P[:, 0]) < 0.012)
    btn = front & (((P[:, 2] - 1.1) % 0.085) < 0.012) & (np.abs(P[:, 0]) < 0.006)
    alb = _mix(alb, [0.3, 0.28, 0.24], btn.astype(float) * 0.9)
    rough = 0.92 + 0.05 * fuzz - 0.2 * spat          # napped wool flannel: fully diffuse (no grazing gloss)
    h = 0.00025 * noise.fbm(P * 400, 2, 16) + 0.0006 * btn - 0.0003 * front
    return np.clip(alb, 0, 1), np.clip(rough, 0.05, 1), h


def trousers(P, N, AO, ctx):
    # fix round 2 (ruling j): heavy dark wool/duck work trousers — heathered fibres (lighter speckle in a darker weave),
    # a 2.5 mm twill, outer side seams with their double stitching, knee bagging/shine, a wet dark band above the boot
    # tops (they stood in the cistern water), old blood spatter on the shins from the work at the table
    n = len(P)
    alb = _tile([0.075, 0.068, 0.055], n) * (1 + 0.15 * noise.fbm(P * 12, 3, 21))[:, None]
    f1, _ = noise.worley(P * 1400.0, 24)
    alb *= (1.0 + 0.35 * ss(0.25, 0.05, f1))[:, None]
    side = ss(0.75, 0.95, np.abs(N[:, 0])) * (P[:, 2] < 1.0)
    seam = side * ss(0.0016, 0.0006, np.abs(np.sin(P[:, 1] * 2 * math.pi / 0.006)) * 0.002)
    alb = _mix(alb, [0.035, 0.032, 0.027], side * 0.35)
    wetb = ss(0.66, 0.5, P[:, 2])
    alb *= (1.0 - 0.35 * wetb)[:, None]
    spat = ss(0.74, 0.82, noise.fbm(P * 110, 3, 25)) * ss(0.2, 0.7, noise.fbm(P * 6, 2, 26)) * (N[:, 1] < 0) * ss(0.95, 0.6, P[:, 2])
    alb = _mix(alb, [0.03, 0.006, 0.005], spat * 0.8)
    mud = ss(0.75, 0.4, P[:, 2]) * ss(0.3, 0.7, noise.fbm(P * 9, 3, 22) + 0.3)
    alb = _mix(alb, [0.09, 0.07, 0.045], mud * 0.7)
    knee = ss(0.05, 0.0, np.abs(P[:, 2] - 0.53)) * (N[:, 1] < -0.3)
    alb = _mix(alb, [0.12, 0.11, 0.095], knee * 0.5)
    tw = np.sin((P[:, 0] + P[:, 2]) * 2 * math.pi / 0.0025)
    rough = 0.9 - 0.12 * knee - 0.25 * wetb - 0.3 * spat
    h = 0.00018 * tw + 0.0002 * noise.fbm(P * 150, 2, 23) - 0.0004 * seam + 0.00015 * side
    h += 0.00005 * ss(0.25, 0.05, f1)
    alb *= (0.6 + 0.4 * AO)[:, None]
    return np.clip(alb, 0, 1), rough, h


def rubber(P, N, AO, ctx, boots=False):
    n = len(P)
    alb = _tile([0.018, 0.018, 0.019], n) * (1 + 0.2 * noise.fbm(P * 30, 3, 31))[:, None]
    scuff = ss(0.6, 0.9, noise.ridged(P * 45, 3, 32)) * 0.6
    alb = _mix(alb, [0.05, 0.05, 0.05], scuff)
    crack = ss(0.94, 0.99, noise.ridged(P * np.array([60, 60, 25.0]), 3, 33))
    alb = _mix(alb, [0.006, 0.006, 0.006], crack)
    wet = ss(0.35, 0.75, noise.fbm(P * np.array([6, 6, 2.0]), 3, 34))
    # fix round 2 (ruling j: cream glare patches on the boots/apron): worn, bloomed black rubber is ~0.45-0.6 rough dry,
    # ~0.25-0.35 where wet — the old 0.16-0.38 mirrored the lamp and the walls as flat cream sheets
    rough = 0.52 - 0.2 * wet + 0.2 * scuff + 0.15 * crack
    h = -0.0006 * crack + 0.0001 * noise.fbm(P * 200, 2, 35) + 0.00004 * noise.fbm(P * 700, 2, 30)
    if boots:
        # horizontal flex creases at the ankle, the rolled top edge, the back seam
        ank = ss(0.1, 0.14, P[:, 2]) * ss(0.26, 0.2, P[:, 2])
        cr = (0.5 + 0.5 * np.sin(P[:, 2] * 2 * math.pi / 0.014 + 3 * noise.fbm(P * 30, 2, 29))) ** 4 * ank
        h += -0.0007 * cr
        alb = _mix(alb, [0.035, 0.035, 0.036], cr * 0.5)
        mudh = 0.1 + 0.05 * noise.fbm(P * 10, 3, 36)
        mud = ss(mudh + 0.02, mudh - 0.02, P[:, 2])
        drips = ss(0.55, 0.8, noise.fbm(P * np.array([80, 80, 6.0]), 3, 37)) * ss(0.3, 0.12, P[:, 2])
        m = np.clip(mud + drips, 0, 1)
        alb = _mix(alb, [0.045, 0.034, 0.022], m * 0.9)
        rough = rough * (1 - m) + 0.85 * m
        h += 0.0015 * m * noise.fbm(P * 90, 3, 38)
    else:
        # the apron: dark blood smears, wet, low on the front
        sm = ss(0.5, 0.8, noise.fbm(P * np.array([10, 10, 3.0]), 4, 39)) * ss(1.3, 0.8, P[:, 2])
        alb = _mix(alb, [0.03, 0.006, 0.005], sm * 0.9)
        rough = rough * (1 - sm) + 0.22 * sm
    return np.clip(alb, 0, 1), np.clip(rough, 0.05, 1), h


def gauntlet(P, N, AO, ctx):
    # fix round 4 (ruling t; scratch/escfix3-review/ab2-08: 'pale tan plastic gauntlets' once the restaged lamp keys his
    # arms): black neoprene/rubber slaughterhouse gauntlets. Black rubber albedo ~0.03-0.05 linear (carbon-black filled;
    # worn rubber blooms a little greyer), roughness ~0.35-0.5 (wet/greasy film 0.25-0.35), fresh blood smeared over the
    # fingers and palm (wet whole blood film on black: ~0.06/0.009/0.007, rough 0.15-0.25), thinner tacky smears on the
    # back of the hand and dried flecks up the cuff. Flex creases across the knuckles and the wrist.
    n = len(P)
    J = ctx['J']
    alb = _tile([0.034, 0.034, 0.036], n) * (1 + 0.18 * noise.fbm(P * 30, 3, 131))[:, None]
    bloom = ss(0.55, 0.85, noise.fbm(P * np.array([14, 14, 6.0]), 3, 132))          # grey ozone/soap bloom
    alb = _mix(alb, [0.055, 0.055, 0.056], bloom * 0.5)
    wet = ss(0.4, 0.7, noise.fbm(P * np.array([8, 8, 3.0]), 3, 133))
    rough = 0.54 - 0.16 * wet + 0.08 * bloom      # r2: worn satin neoprene (0.46 read silver along the lit forearm)
    hand = np.zeros(n)
    palm = np.zeros(n)
    crease = np.zeros(n)
    for side in ('l', 'r'):
        a, b = (np.asarray(x, float) for x in J[f'hand_{side}'])
        ab = b - a
        L2 = float(ab @ ab)
        t = ((P - a) @ ab) / L2
        d = np.linalg.norm(P - (a + np.outer(np.clip(t, 0, 1.6), ab)), axis=1)
        on = ss(0.07, 0.035, d) * ss(-0.35, 0.05, t)                   # the hand + fingers (t > 1: the fingers)
        hand = np.maximum(hand, on)
        inward = -np.sign(a[0]) if abs(a[0]) > 1e-4 else 1.0
        palm = np.maximum(palm, on * ss(0.0, 0.6, N[:, 0] * inward))
        # knuckle + wrist flex creases (across the hand axis)
        cr = (0.5 + 0.5 * np.sin(t * 2 * math.pi * 7.0 + 2.5 * noise.fbm(P * 40, 2, 134))) ** 6
        crease = np.maximum(crease, cr * on * (ss(0.7, 0.85, t) + ss(0.15, 0.0, np.abs(t))))
    smear = ss(0.38, 0.62, noise.fbm(P * np.array([45, 45, 25.0]), 4, 135))
    fresh = np.clip(palm * (0.55 + 0.45 * smear) + hand * smear * 0.6, 0, 1)
    tacky = hand * ss(0.5, 0.75, noise.fbm(P * 70, 3, 136)) * (1 - fresh)
    fleck = ss(0.78, 0.86, noise.fbm(P * 160, 3, 137)) * (1 - hand) * 0.8
    alb = _mix(alb, [0.012, 0.012, 0.013], crease * 0.5)
    alb = _mix(alb, [0.06, 0.009, 0.007], fresh * 0.92)
    alb = _mix(alb, [0.045, 0.012, 0.009], tacky * 0.7)
    alb = _mix(alb, [0.05, 0.012, 0.009], fleck)
    rough = rough * (1 - fresh) + 0.2 * fresh
    rough = rough * (1 - tacky) + 0.5 * tacky
    h = -0.0005 * crease + 0.00008 * noise.fbm(P * 260, 2, 138) + 0.00012 * fresh * noise.fbm(P * 90, 2, 139)
    return np.clip(alb, 0, 1), np.clip(rough, 0.05, 1), h


def leather(P, N, AO, ctx, gloves=True):
    n = len(P)
    base = np.array([0.055, 0.036, 0.022]) if gloves else np.array([0.035, 0.022, 0.015])
    alb = _tile(base, n) * (1 + 0.25 * noise.fbm(P * 25, 4, 41))[:, None]
    wear = ss(0.3, 0.8, noise.fbm(P * 40, 3, 42)) * 0.5 + ss(0.9, 0.55, AO) * -0.3
    alb = _mix(alb, base * 1.8, np.clip(wear, 0, 1))
    alb = _mix(alb, [0.03, 0.02, 0.013], ss(0.85, 0.45, AO) * 0.7)
    crease = ss(0.8, 0.95, noise.ridged(P * 110, 3, 43))
    grain, _ = noise.worley(P * 700, 44)
    rough = 0.6 - 0.15 * wear + 0.1 * crease
    h = -0.0004 * crease - 0.00008 * ss(0.3, 0.05, grain)
    return np.clip(alb, 0, 1), rough, h


def burlap(P, N, AO, ctx, G):
    n = len(P)
    F = G.get('F') if G else None
    if F is None:
        F = np.stack([np.arctan2(P[:, 0], -P[:, 1]) / (2 * math.pi), 2.0 - P[:, 2]], 1)
    u, v = F[:, 0], F[:, 1]
    x = (((u + 0.5) % 1.0) - 0.5) * 0.9           # metres around from the front centre
    y = -v                                        # up
    p = 0.004
    fx, fy = (x / p) % 1.0, (y / p) % 1.0
    cx, cy = np.floor(x / p), np.floor(y / p)
    par = (cx + cy) % 2
    jit = 0.2 * noise.fbm(np.stack([x, y, np.zeros(n)], 1) * 80, 2, 51)
    thread = np.where(par > 0.5, np.sin(np.pi * np.clip(fx + jit * 0.2, 0, 1)), np.sin(np.pi * np.clip(fy + jit * 0.2, 0, 1)))
    gap = ss(0.12, 0.0, np.minimum(np.minimum(fx, 1 - fx), np.minimum(fy, 1 - fy)))
    base = np.array([0.33, 0.25, 0.15])
    alb = _tile(base, n) * (0.85 + 0.18 * thread[:, None] + 0.15 * noise.fbm(P * 30, 3, 52)[:, None])
    alb *= (1 - 0.5 * gap)[:, None]
    # stencil: STROUD / FEED & SEED, faded blue, patchy where the paint wore off
    ink = np.zeros(n)
    for text, cap, yc in (('STROUD', 0.046, -0.108), ('FEED & SEED', 0.027, -0.232)):
        wdt = text_width(text, cap)
        ink = np.maximum(ink, text_mask(x, y, text, -wdt / 2, yc, cap))
    rule = ss(0.0035, 0.0018, np.abs(y + 0.186)) * (np.abs(x) < 0.12)
    ink = np.maximum(ink, rule)
    ink *= ss(0.25, 0.6, noise.fbm(np.stack([x, y, np.zeros(n)], 1) * 25, 4, 53) + 0.55) * (0.55 + 0.45 * thread)
    stencil = np.array([0.018, 0.03, 0.06])     # (0.15, 0.2, 0.3) sRGB
    alb = _mix(alb, stencil, ink * 0.85)
    # grime: sweat and old blood around the eyeholes and the mouth, dirt at the gathered neck
    stains = ss(0.4, 0.75, noise.fbm(P * 7, 4, 54)) * 0.5
    mouth = ss(0.06, 0.0, np.hypot(x, (y + 0.3) * 1.2)) * 0.6
    eyes = np.zeros(n)
    for e, r in ctx['eyes']:
        eyes = np.maximum(eyes, ss(r * 2.2, r * 0.9, np.linalg.norm((P - e)[:, [0, 2]], axis=1)) * (P[:, 1] < e[1]))
    neck = ss(ctx['neck_z'] + 0.05, ctx['neck_z'], P[:, 2])
    alb = _mix(alb, [0.07, 0.045, 0.028], np.clip(stains + neck * 0.5, 0, 0.8))
    alb = _mix(alb, [0.05, 0.012, 0.008], np.clip(mouth + eyes * 0.8, 0, 0.85))
    alb *= (0.55 + 0.45 * AO)[:, None]
    rough = 0.95 - 0.1 * eyes
    h = 0.0007 * thread - 0.0006 * gap + 0.0002 * noise.fbm(P * 90, 2, 55)
    return np.clip(alb, 0, 1), rough, h


def twine(P, N, AO, ctx):
    n = len(P)
    tw = np.sin((P[:, 0] * 3 + P[:, 1] * 3 + P[:, 2] * 4) * 900)
    alb = _tile([0.17, 0.135, 0.085], n) * (0.8 + 0.2 * tw[:, None]) * (0.7 + 0.3 * AO[:, None])
    return alb, np.full(n, 0.95), 0.0003 * tw


def void(P, N, AO, ctx):
    n = len(P)
    return _tile([0.004, 0.004, 0.004], n), np.full(n, 1.0), np.zeros(n)


def cleaver(P, N, AO, ctx):
    n = len(P)
    J = ctx['J']
    wr = J['hand_r'][0]
    d = np.linalg.norm(P - wr, axis=1)
    handle = d < 0.12
    steel = _tile([0.23, 0.23, 0.235], n) * (1 + 0.1 * noise.fbm(P * 80, 3, 61))[:, None]
    rust = ss(0.5, 0.75, noise.fbm(P * 25, 4, 62))
    steel = _mix(steel, [0.16, 0.07, 0.03], rust * 0.8)
    blood = ss(0.55, 0.75, noise.fbm(P * 40, 3, 63))
    steel = _mix(steel, [0.035, 0.006, 0.005], blood * 0.85)
    wood = _tile([0.07, 0.04, 0.02], n) * (1 + 0.3 * np.sin(P[:, 0] * 900 + 5 * noise.fbm(P * 30, 2, 64)))[:, None]
    alb = np.where(handle[:, None], wood, steel)
    metal = ~handle
    rough = np.where(handle, 0.6, 0.35 + 0.45 * rust - 0.2 * blood)
    h = 0.0003 * rust * noise.fbm(P * 200, 2, 65)
    return np.clip(alb, 0, 1), rough, h


def shader(kind, ctx):
    table = {
        'body': lambda P, N, AO, G: skin(P, N, AO, ctx),
        'shirt': lambda P, N, AO, G: flannel(P, N, AO, ctx),
        'trousers': lambda P, N, AO, G: trousers(P, N, AO, ctx),
        'boots': lambda P, N, AO, G: rubber(P, N, AO, ctx, boots=True),
        'apron': lambda P, N, AO, G: rubber(P, N, AO, ctx, boots=False),
        'gloves': lambda P, N, AO, G: gauntlet(P, N, AO, ctx),        # fix round 4: black rubber gauntlets
        'suspenders': lambda P, N, AO, G: leather(P, N, AO, ctx, gloves=False),
        'sack': lambda P, N, AO, G: burlap(P, N, AO, ctx, G),
        'twine': lambda P, N, AO, G: twine(P, N, AO, ctx),
        'void': lambda P, N, AO, G: void(P, N, AO, ctx),
        'cleaver': lambda P, N, AO, G: cleaver(P, N, AO, ctx),
    }
    return table[kind]


def prepare(R):
    return None
