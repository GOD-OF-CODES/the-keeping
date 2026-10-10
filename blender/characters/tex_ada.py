"""Ada's procedural textures, evaluated per texel on baked 3D positions/normals (see texbake.py), plus the hair
strand atlas drawn directly in UV space. All colours linear; returns (albedo (n,3), roughness (n,), height (n,) m).
"""
import math

import numpy as np

from lib import noise
from lib.noise import smoothstep as ss


def _mix(a, b, t):
    return a + (np.asarray(b, float) - a) * np.asarray(t, float)[..., None]


def finger_masks(P, J):
    """nail (dorsal distal phalanx), pad (palmar distal) and knuckle-crease fields for all ten fingers."""
    nail = np.zeros(len(P))
    pad = np.zeros(len(P))
    free_edge = np.zeros(len(P))
    crease = np.zeros(len(P))
    for side in ('l', 'r'):
        wr = J[f'hand_{side}'][0]
        mid = J[f'middle_01_{side}'][0]
        idx = J[f'index_01_{side}'][0]
        pin = J[f'pinky_01_{side}'][0]
        a = (mid - wr) / np.linalg.norm(mid - wr)
        l = idx - pin
        l = l - a * l.dot(a)
        l /= np.linalg.norm(l)
        n = np.cross(a, l)
        th = J[f'thumb_02_{side}'][0]
        if (th - wr).dot(n) < 0:
            n = -n
        for f in ('thumb', 'index', 'middle', 'ring', 'pinky'):
            h, t = J[f'{f}_03_{side}']
            ax = t - h
            L = np.linalg.norm(ax)
            d = ax / L
            q = P - h
            tt = (q @ d) / L
            rad = q - np.outer(q @ d, d)
            rl = np.linalg.norm(rad, axis=1)
            rd = rad / np.maximum(rl, 1e-9)[:, None]
            near = (rl < 0.016) & (tt > -0.1) & (tt < 1.25)
            dors = -n if f != 'thumb' else -(n * 0.5 - l)
            dors = dors - d * dors.dot(d)
            dors /= np.linalg.norm(dors)
            c = rd @ dors
            nm = near & (tt > 0.42) & (tt < 1.08) & (c > 0.5)
            nail = np.maximum(nail, nm * ss(0.5, 0.62, c) * ss(0.42, 0.5, tt))
            free_edge = np.maximum(free_edge, nm * ss(0.9, 1.0, tt))
            pad = np.maximum(pad, near * (c < -0.2) * ss(0.25, 0.6, tt))
            for j in (1, 2):
                hj = J[f'{f}_{j + 1:02d}_{side}'][0]
                dj = np.linalg.norm(P - hj, axis=1)
                crease = np.maximum(crease, (dj < 0.014) * np.exp(-((P - hj) @ d / 0.0022) ** 2))
    return nail, pad, free_edge, crease


def skin(P, N, AO, J, wound_c, seed=101, cap=None, head_side=False, G=None):
    n = len(P)
    base = np.array([0.27, 0.31, 0.36])      # grey-blue (spec avg 0.30/0.32/0.34)
    alb = np.tile(base, (n, 1))
    m1 = noise.fbm(P * 14.0, 4, seed)
    m2 = noise.fbm(P * 55.0, 3, seed + 3)
    alb *= (1.0 + 0.2 * m1 + 0.09 * m2)[:, None]
    # livor: purple-grey pooling in the feet, shins and fingertips
    z = P[:, 2]
    # fix round 2: the shins/feet read lavender (two purple layers stacked) -> slate grey-blue cyanosis, max 0.5
    livor = 0.45 * ss(0.32, 0.02, z) + 0.2 * ss(0.0, 0.6, noise.fbm(P * 6.0, 3, seed + 5))
    alb = _mix(alb, [0.215, 0.225, 0.265], np.clip(livor, 0, 0.5))
    # fix round (#6, feet read salmon-pink): she floated face-down in the cistern, feet hanging -> fixed dependent
    # lividity in the feet and ankles: dusky purple (0.16/0.10/0.17), blanched only where the soles pressed
    # fix round 2: confined to the DEPENDENT side (soles, toe pads, heels: normal facing down) + a faint band
    # at the ankles; the dorsum stays grey-blue. Livor colour = dusky red-violet (deoxygenated Hb) 0.19/0.11/0.15.
    down = ss(0.1, -0.6, N[:, 2])
    feet = ss(0.12, 0.03, z) * (0.25 + 0.75 * down) * (0.75 + 0.25 * noise.fbm(P * 30.0, 2, seed + 6))
    alb = _mix(alb, [0.19, 0.11, 0.15], np.clip(feet, 0, 0.7))
    # veins: thin branching blue-green lines (hands, wrists, feet, neck, temples)
    rv = noise.ridged(P * np.array([28.0, 28.0, 20.0]), 4, seed + 11)
    vein = ss(0.8, 0.95, rv) * (0.55 + 0.45 * ss(-0.2, 0.4, noise.fbm(P * 8, 2, seed + 12)))
    alb = _mix(alb, [0.1, 0.15, 0.22], vein * 0.7)
    # REALISM #17 / A11: drowned-body variation — large blotchy mottling (cyanotic patches, paler pressure areas) and
    # post-mortem venous MARBLING (dark green-grey branching along the superficial veins: neck, shoulders, thighs)
    mot = noise.fbm(P * 3.2, 3, seed + 41)
    alb = _mix(alb, [0.30, 0.30, 0.38], ss(0.15, 0.6, mot) * 0.45)
    alb = _mix(alb, [0.34, 0.36, 0.38], ss(-0.2, -0.6, mot) * 0.35)
    rm = noise.ridged(P * np.array([11.0, 11.0, 7.0]), 4, seed + 42)
    zone = ss(1.05, 1.25, z) + ss(0.75, 0.55, z) * ss(0.35, 0.5, z)
    marb = ss(0.86, 0.97, rm) * np.clip(zone, 0, 1) * (0.5 + 0.5 * ss(-0.1, 0.4, noise.fbm(P * 5, 2, seed + 43)))
    alb = _mix(alb, [0.13, 0.17, 0.17], marb * 0.55)
    # cistern silt and dirt: soles, between toes, creases (AO), under the nails
    sole = ss(-0.3, -0.75, N[:, 2]) * ss(0.06, 0.0, z)
    ground = ss(0.07, 0.0, z) * 0.6
    crevice = ss(0.85, 0.45, AO)
    dirt = np.clip(0.55 * sole + ground * (0.35 + 0.35 * noise.fbm(P * 40, 3, seed + 21)) + crevice * 0.7, 0, 1)
    alb = _mix(alb, [0.055, 0.052, 0.04], dirt * 0.85)
    nail, pad, free_edge, crease = finger_masks(P, J)
    alb = _mix(alb, [0.2, 0.2, 0.19], nail * 0.9)
    alb = _mix(alb, [0.04, 0.035, 0.028], free_edge * 0.95)
    alb = _mix(alb, [0.2, 0.19, 0.24], crease * 0.5)
    # the pale line where the locket chain sat
    neck0 = J['neck_01'][0]
    ring = np.exp(-((z - (neck0[2] + 0.03)) / 0.004) ** 2) * (np.linalg.norm(P[:, :2] - neck0[:2], axis=1) < 0.07)
    alb = _mix(alb, [0.42, 0.43, 0.44], ring * 0.45)
    # the wound: black-red gash, bruised lips
    if cap is not None:
        # C2-ESCAPE A1: the first stroke is a dark wet seam ON the oblique cut plane, deepest at the nape and fading
        # toward the throat (it hides the split seam before C2); bruised, swollen lips 2-3 cm either side
        cc, cn, cf, cs = (np.asarray(x, float) for x in cap[:4])
        sd = (P - cc) @ cn
        back = np.clip(-((P - cc) @ cf) / 0.05, 0, 1)              # 0 at the throat .. 1 at the nape
        wob = 0.0015 * noise.fbm(P * 160.0, 2, seed + 40)
        dw = np.abs(sd + wob) / (0.0035 + 0.006 * back)
        near = np.linalg.norm((P - cc) - np.outer(sd, cn), axis=1) < 0.075
        gash = ss(1.0, 0.35, dw) * (0.35 + 0.65 * back) * near
        bruise = ss(0.035, 0.008, np.abs(sd)) * near * (0.4 + 0.6 * back)
    else:
        dw = np.linalg.norm((P - wound_c) * np.array([0.8, 1.0, 2.6]), axis=1)
        gash = ss(0.03, 0.012, dw)
        bruise = ss(0.06, 0.02, dw)
    alb = _mix(alb, [0.2, 0.12, 0.17], bruise * 0.6)
    alb = _mix(alb, [0.07, 0.012, 0.012], gash)
    rough = 0.42 + 0.08 * m1 + 0.25 * dirt - 0.12 * nail - 0.2 * gash
    # height: pores, fine wrinkles, raised veins, washer-woman fingertips, nail plates
    f1, _ = noise.worley(P * 650.0, seed + 31)
    h = -0.00006 * ss(0.35, 0.1, f1)
    h += 0.00008 * noise.fbm(P * 260.0, 3, seed + 32)
    h += 0.00035 * vein
    wr = np.sin((P @ np.array([0.3, 0.7, 0.6])) * 2600.0 + 6.0 * noise.fbm(P * 180.0, 2, seed + 33))
    h += 0.00018 * pad * wr
    h += 0.0002 * nail - 0.00025 * crease
    h -= 0.0012 * gash
    if cap is not None:
        # the cut faces (A2, fix round): the cap faces' own texels (G['CAP'], rasterised from the cap UV islands) get
        # the §3.2 section; the geometry carries the macro relief, the normal map only the fine detail
        from . import neck_anatomy
        if G is not None and 'CAP' in G:
            on = np.asarray(G['CAP'], bool)
        else:
            on = (np.abs((P - cc) @ cn) < 0.012) & (np.abs(N @ cn) > 0.55) & (np.linalg.norm(P - np.asarray(cap[4]), axis=1) < 0.075)
        if on.any():
            cen = np.asarray(cap[6] if head_side else cap[4], float)
            rim2d = cap[7] if head_side else cap[5]
            d = P[on] - cen
            u, v = d @ cs, d @ cf
            ins = neck_anatomy.inset_dist(np.stack([u, v], 1), rim2d)
            sec = neck_anatomy.section(u, v, inset=ins, head_side=head_side)
            alb[on] = sec['alb']
            rough[on] = sec['rough']
            h[on] = sec['fine'] * 1.5
    return np.clip(alb, 0, 1), np.clip(rough, 0.05, 1), h


def gown(P, N, AO, body_fn, J, hem_z, seed=87):
    n = len(P)
    z = P[:, 2]
    base = np.array([0.48, 0.43, 0.32])      # yellowed ivory cotton (soaked: the bake's 'dry' base, darkened below)
    f = noise.fbm(P * 3.5, 4, seed)
    alb = np.tile(base, (n, 1)) * (1.0 + 0.05 * noise.fbm(P * 40, 3, seed + 1))[:, None]
    # wet cotton goes translucent where it clings: grey-blue skin shows through
    d = body_fn(P)
    cling = ss(0.012, 0.004, d)
    # REALISM #17 / C2-ESCAPE A11: soaked cotton is translucent where it clings — the grey-blue skin shows through
    # (wet thin cotton transmits ~50-60 % against skin; the albedo trends to cloth x skin), softly graded with the
    # contact distance so the body reads under it without hard patches
    through = np.array([0.24, 0.27, 0.31])
    cl2 = ss(0.016, 0.003, d) * (0.75 + 0.25 * noise.fbm(P * 18.0, 2, seed + 11))
    alb = _mix(alb, through, np.clip(cl2, 0, 1) * 0.55)
    # cistern silt: heavier toward the hem, splotched, with dried tide lines (low contrast on the bodice: the round-1
    # review read high-contrast silt patches on the chest as flat white blotches)
    up = ss(0.9, 1.25, z)
    silt_amt = np.clip(ss(1.3, 0.3, z) * 0.85 + (0.4 - 0.25 * up) * f + 0.2 - 0.08 * up, 0, 1)
    silt = ss(0.35, 0.75, silt_amt + 0.25 * noise.fbm(P * 11, 3, seed + 2))
    alb = _mix(alb, [0.13, 0.135, 0.085], silt * (0.72 - 0.3 * up))
    tide = ss(0.94, 0.99, noise.ridged(P * np.array([4.0, 4.0, 9.0]), 3, seed + 3)) * (silt_amt > 0.3)
    alb = _mix(alb, [0.09, 0.09, 0.06], tide * 0.5)
    # rust-brown drips from the neckline (the wound)
    streak = ss(0.55, 0.85, noise.fbm(P * np.array([60.0, 60.0, 4.0]), 3, seed + 4))
    chest = ss(1.36, 1.3, z) * ss(1.05, 1.2, z) * ss(0.08, 0.02, np.abs(P[:, 0] - 0.012)) * (P[:, 1] < 0)
    alb = _mix(alb, [0.16, 0.06, 0.04], streak * chest * 0.8)
    # lace at the neckline, cuffs and hem
    nl = 1.352 - 0.034 * np.clip((0.03 - P[:, 1]) / 0.08, 0, 1)
    band = ss(0.022, 0.012, np.abs(nl - z)) + ss(hem_z + 0.04, hem_z + 0.025, z)
    for side in ('l', 'r'):
        a, b = J[f'forearm_{side}']
        ab = b - a
        t = ((P - a) @ ab) / ab.dot(ab)
        band += ss(0.9, 0.93, t) * (np.linalg.norm(P - (a + np.outer(np.clip(t, 0, 1), ab)), axis=1) < 0.05)
    band = np.clip(band, 0, 1)
    w1, _ = noise.worley(P * 340.0, seed + 5)
    holes = band * ss(0.34, 0.24, w1)
    alb = _mix(alb, [0.62, 0.6, 0.53], band * 0.2)
    alb = _mix(alb, [0.08, 0.08, 0.08], holes * 0.5)
    # sodden cotton: darker, blotchy water marks everywhere, seams (yoke under the bust, shoulders, sleeves)
    wetm = ss(0.3, 0.7, noise.fbm(P * np.array([5.0, 5.0, 3.0]), 4, seed + 8))
    alb *= (0.8 - 0.14 * wetm)[:, None]
    seam = ss(0.004, 0.0015, np.abs(z - 1.175)) * (np.abs(P[:, 1]) < 0.2)
    alb = _mix(alb, [0.2, 0.19, 0.15], seam * 0.6)
    # fix round 2 (body14: the bodice read as bare skin): GARMENT CUES a nightgown has and a body doesn't — a 3.2 cm
    # front placket from the neckline down 24 cm with its two stitch lines and 10 mm bone buttons every 3.4 cm
    # (1890s-1900s cotton nightgown), and gathered pleats falling from the yoke seam (z 1.175) over the bust.
    nl0 = 1.352 - 0.034 * np.clip((0.03 - P[:, 1]) / 0.08, 0, 1)
    fr = P[:, 1] < -0.02
    span = (z < nl0 + 0.002) & (z > nl0 - 0.24) & fr
    ax_ = np.abs(P[:, 0])
    plk = span & (ax_ < 0.016)
    stitch = span * ss(0.0012, 0.0004, np.abs(ax_ - 0.0145))
    alb = _mix(alb, [0.40, 0.36, 0.27], plk * 0.35)
    alb = _mix(alb, [0.22, 0.20, 0.15], stitch * 0.7)
    bz = np.round((nl0 - 0.022 - z) / 0.034)
    bc = nl0 - 0.022 - bz * 0.034
    bd = np.sqrt(P[:, 0] ** 2 + (z - bc) ** 2)
    btn = span * (bz >= 0) * (bz <= 6) * ss(0.0052, 0.0042, bd)
    brim = btn * ss(0.0030, 0.0042, bd)
    alb = _mix(alb, [0.56, 0.53, 0.46], btn * 0.9)
    alb = _mix(alb, [0.20, 0.18, 0.14], brim * 0.6 + span * (bz >= 0) * (bz <= 6) * ss(0.0009, 0.0003, bd) * 0.8)
    pleat_zone = fr * ss(1.19, 1.17, z) * ss(1.02, 1.10, z) * (ax_ < 0.13)
    pleat = np.sin(P[:, 0] * 2 * np.pi / 0.011 + 0.6 * noise.fbm(P * 9.0, 2, seed + 30))
    alb *= (1.0 - 0.10 * pleat_zone * ss(-0.6, -1.0, pleat))[:, None]
    G_EXTRA = (plk, stitch, btn, pleat_zone, pleat)
    # fix round (#2): the collar and the front are SOAKED — blood from the neck wound wicks down the wet cotton: near
    # black-red at the collar (wet whole blood on cotton ~0.08/0.02/0.018), water-diluted rust-pink further down in
    # gravity streaks (front 20-28 cm, back ~14 cm); silt caked at the neck
    nlz = 1.352 - 0.034 * np.clip((0.03 - P[:, 1]) / 0.08, 0, 1)
    dn = nlz - z                                                     # m below the neckline (< 0: the collar)
    front = ss(0.03, -0.05, P[:, 1])
    reach = 0.14 + 0.12 * front
    stk = noise.fbm(P * np.array([75.0, 75.0, 5.0]), 3, seed + 20)
    soak = np.clip(ss(reach, 0.0, dn - 0.05 * stk) + 0.35 * ss(0.55, 0.85, stk) * ss(reach + 0.15, 0.0, dn), 0, 1)
    collar_z = ss(-0.005, -0.02, dn)
    alb = _mix(alb, [0.21, 0.085, 0.06], soak * 0.75)                 # diluted blood (rust-pink-brown)
    core = ss(0.07 + 0.05 * front, 0.0, dn - 0.03 * stk) * (0.75 + 0.25 * front)
    alb = _mix(alb, [0.085, 0.022, 0.018], np.clip(core + collar_z, 0, 1) * 0.9)
    alb = _mix(alb, [0.10, 0.095, 0.065], collar_z * ss(0.2, 0.7, noise.fbm(P * 60.0, 3, seed + 21)) * 0.6)   # silt
    # hem weight: the turned 2.5 cm hem, sodden and silted darker
    hem = ss(hem_z + 0.03, hem_z + 0.015, z)
    alb = _mix(alb, [0.16, 0.15, 0.10], hem * 0.45)
    alb *= (0.55 + 0.45 * AO)[:, None]
    rough = 0.64 + 0.12 * silt - 0.24 * cl2 + 0.05 * f - 0.3 * np.clip(soak + collar_z, 0, 1)
    h = 0.00012 * noise.fbm(P * 220.0, 2, seed + 6) - 0.0005 * holes + 0.00025 * band
    h += 0.0003 * noise.ridged(P * np.array([30.0, 30.0, 12.0]), 3, seed + 7)
    h += 0.0012 * (noise.ridged(P * np.array([62.0, 62.0, 48.0]), 3, seed + 22) - 0.45)   # wet-cotton crinkle
    h += 0.0010 * hem * ss(hem_z + 0.003, hem_z + 0.008, z)                                 # the hem roll
    plk, stitch, btn, pleat_zone, pleat = G_EXTRA
    h += 0.0006 * plk - 0.0004 * stitch + 0.0011 * btn + 0.0009 * pleat_zone * pleat           # placket, buttons, pleats
    return np.clip(alb, 0, 1), np.clip(rough, 0.05, 1), h


def eye(P, N, center, seed=7):
    v = P - center
    v /= np.maximum(np.linalg.norm(v, axis=1), 1e-9)[:, None]
    fwd = -v[:, 1]
    cornea = ss(0.72, 0.8, fwd)
    haze = noise.fbm(P * 900.0, 3, seed)
    radial = noise.fbm(np.stack([np.arctan2(v[:, 0], v[:, 2]) * 3.0, fwd * 2, np.zeros(len(P))], 1) * 4.0, 3, seed + 1)
    # C2-ESCAPE A3: post-mortem clouding — opaque grey-white (0.55, 0.57, 0.58) with a faint darker GHOST of the
    # iris ring (0.45) and pupil, so it never reads as a Halloween contact lens
    milky = np.array([0.55, 0.57, 0.58]) * (1 + 0.06 * haze + 0.05 * radial)[:, None]
    iris = ss(0.905, 0.925, fwd) * ss(0.985, 0.97, fwd) * (0.75 + 0.25 * radial)
    milky = _mix(milky, [0.45, 0.46, 0.47], iris * 0.7)
    milky = _mix(milky, [0.47, 0.48, 0.49], ss(0.985, 0.997, fwd) * 0.4)   # the ghost of a pupil
    sclera = np.array([0.55, 0.51, 0.44]) * (1 + 0.05 * haze)[:, None]
    veins = ss(0.9, 0.98, noise.ridged(P * 700.0, 3, seed + 2)) * ss(0.7, 0.2, fwd)
    sclera = _mix(sclera, [0.35, 0.1, 0.08], veins * 0.6)
    sclera *= ss(-0.6, 0.3, fwd)[:, None] * 0.8 + 0.2
    alb = _mix(sclera, milky, cornea)
    rough = 0.2 - 0.14 * cornea
    return np.clip(alb, 0, 1), rough, np.zeros(len(P))


# ------------------------------------------------------------------------------------------------ hair atlas
def hair_atlas(w=1024, h=2048, strips=6, veil_u=0.25, seed=103):
    """RGBA (linear albedo + alpha) and tangent normal images, rows bottom-up (v = 0 root at the bottom row)."""
    rng = np.random.default_rng(seed)
    alb = np.zeros((h, w, 3))
    alpha = np.zeros((h, w))
    nx = np.zeros((h, w))
    top = np.full((h, w), -1.0)
    v = np.arange(h) / (h - 1)
    cols = np.arange(w)

    def draw(xc, width, col, a_prof, depth):
        # xc: (h,) centre column per row; draw an anti-aliased strand where it is the topmost so far
        lo = np.clip(np.floor(xc - width - 1).astype(int), 0, w - 1)
        span = int(np.ceil(width * 2 + 3))
        for k in range(span):
            c = np.clip(lo + k, 0, w - 1)
            dx = (c - xc) / max(width, 0.5)
            cov = np.clip(1.0 - np.abs(dx), 0, 1) * a_prof
            rows = np.nonzero(cov > 0.02)[0]
            if len(rows) == 0:
                continue
            cc = c[rows]
            upd = depth >= top[rows, cc]
            rr, cc = rows[upd], cc[upd]
            cv = cov[rr]
            alb[rr, cc] = alb[rr, cc] * (1 - cv[:, None]) + col * cv[:, None]
            alpha[rr, cc] = np.maximum(alpha[rr, cc], cv)
            nx[rr, cc] = np.clip(dx[rr], -1, 1)
            top[rr, cc] = depth

    def strip(u0, u1, count, clump, fill):
        x0p, x1p = u0 * w, u1 * w
        c = 0.5 * (x0p + x1p)
        half = 0.5 * (x1p - x0p)
        if fill:
            # opaque sheet up to v=0.38, then a fraying fringe of individual strands (v 0.38..0.5)
            fade = np.clip((0.4 - v) / 0.03, 0, 1)
            alb[:, int(x0p):int(x1p)] = np.array([0.01, 0.0095, 0.009])
            alpha[:, int(x0p):int(x1p)] = (0.97 * fade)[:, None]
        for i in range(count):
            off = rng.normal(0, clump) if clump else rng.uniform(-1, 1)
            off = float(np.clip(off, -0.95, 0.95)) * half
            ph = rng.uniform(0, 6.28)
            amp = rng.uniform(0.5, 3.0)
            fr = rng.uniform(1.5, 6.0)
            # clumps converge toward their centre line down the length (wet hair ropes)
            conv = 1.0 - (0.45 * v if clump else 0.0)
            xc = c + off * conv + amp * np.sin(v * fr * 6.28 + ph) + 2.0 * np.sin(v * 17.0 + ph * 2)
            end = rng.uniform(0.55, 1.0) if not fill else rng.uniform(0.36, 0.5)
            a_prof = np.clip((end - v) / 0.05, 0, 1) * rng.uniform(0.6, 1.0)
            tone = rng.uniform(0.006, 0.03)
            col = np.array([tone * 1.08, tone, tone * 0.95])
            draw(xc, rng.uniform(0.7, 1.8), col, a_prof, rng.uniform(0, 1))
    strip(0.0, veil_u, 520, None, True)
    wstrip = (1 - veil_u) / strips
    for k in range(strips):
        strip(veil_u + k * wstrip, veil_u + (k + 1) * wstrip, 150 + 25 * k, 0.33 + 0.04 * k, False)
    # silt specks
    sp = rng.random((h, w)) < 0.0015
    alb[sp] = alb[sp] * 0.5 + np.array([0.05, 0.05, 0.035]) * 0.5
    nrm = np.zeros((h, w, 3))
    nrm[..., 0] = nx * 0.6
    nrm[..., 2] = np.sqrt(np.clip(1 - nrm[..., 0] ** 2, 0, 1))
    nrm = nrm * 0.5 + 0.5
    return alb, alpha, nrm
