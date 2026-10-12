"""Ada's HEAD skin (escape fix round 2, ruling j): its own atlas `ada_head_*` (2048 Max / 1024 Medium / 256 Low) so the
face survives a 0.8-1.5 m close-up at 1280 px. Evaluated per texel on the baked rest-pose positions (plan space, Z-up,
she faces -Y, +X = her left) on top of tex_ada.skin (drowned base, veins, marbling, the cut section, the first-stroke
seam). Everything here is anatomy placed on the SDF landmarks of body.anatomy (`fn.face`), in metres:

  * closed lids: the lid margin 2 mm below the eyeball centre, a 0.25 mm groove + the dark lash line, WET lashes
    (6-8 mm, clumped in 3-5 hair spikes by the water film, lying down on the lower lid), the upper-lid crease 8-9 mm
    above the margin (0.35 mm), the tear trough below, periorbital darkening (sunken, venous congestion);
  * brows: sparse dark wet hairs (10-15 mm, medial hairs rising, lateral hairs running out), drawn as strokes;
  * lips: vermilion with a cupid's bow, a 0.25 mm white-roll ridge on the border, cyanotic blue-grey (deoxygenated
    Hb), dry vertical fissures 0.08 mm deep every ~1.1 mm, the philtrum columns, the dark oral slit;
  * folds: nasolabial (0.5 mm), faint forehead lines, crow's feet, the mentolabial sulcus;
  * skin: pores 0.05-0.2 mm (larger on the nose and cheeks), vellus/fine crosshatch microrelief, washerwoman
    maceration on the lips and lids only (wrinkling of the face is not typical - fingers/feet carry it, tex_ada);
  * dead colour: grey-blue pallor 0.30/0.32/0.36 (the body's base), fixed lividity in the dependent FRONT and lower
    face (she floated face-down in the cistern; dusky violet 0.20/0.13/0.18 at most 40 %), blanched nose/brow points;
  * the scalp under the hair cards is painted as wet black hair (so card gaps show hair, not grey skin).
"""
import math

import numpy as np

from lib import noise
from lib.noise import smoothstep as ss


def _mix(a, b, t):
    return a + (np.asarray(b, float) - a) * np.asarray(t, float)[..., None]


def _strokes(u, v, du, dv, seed, P):
    """Hair-like strokes: thin across v (period dv), long along u (scale du); 0..1."""
    a = noise.perlin(np.stack([u / du, v / dv, np.zeros_like(u)], 1) + 0.37, seed)
    b = noise.perlin(np.stack([u / (du * 2.3), v / (dv * 0.5), np.ones_like(u) * 3.1], 1), seed + 1)
    return ss(0.18, 0.42, a) * ss(-0.15, 0.25, b)


def head(P, N, AO, F, base, cap_on=None, seed=313):
    """P, N (n,3) rest pose; F: fn.face landmarks; base: (alb, rough, h) from tex_ada.skin(head_side=True);
    cap_on: bool mask of the cut-face texels (left exactly as tex_ada painted them)."""
    alb0, rough0, h0 = (np.array(x, float) for x in base)
    alb, rough, h = alb0.copy(), rough0.copy(), h0.copy()
    n = len(P)
    hc = np.asarray(F['hc'], float)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    front = ss(-0.1, -0.6, N[:, 1])                        # 1 on surfaces facing her front (-Y)
    face = front * ss(hc[1] - 0.02, hc[1] - 0.06, y)       # the anterior face shell
    # ---------------------------------------------------------------- the scalp under the cards: wet black hair
    rel = P - hc
    phi = np.arctan2(rel[:, 0], -rel[:, 1])                 # 0 = front
    hl = hc[2] + 0.066 * ss(0.9, 0.0, np.abs(phi)) - 0.095 * ss(1.6, 3.0, np.abs(phi)) + 0.004 * noise.fbm(P * 60, 2, seed)
    temple = ss(0.5, 1.2, np.abs(phi)) * ss(1.9, 1.4, np.abs(phi))
    hl = hl - temple * 0.03
    scalp = ss(-0.002, 0.006, z - hl) * ss(hc[2] - 0.16, hc[2] - 0.12, z)
    strand = noise.fbm(np.stack([rel[:, 0] * 900, rel[:, 1] * 900, rel[:, 2] * 60], 1), 2, seed + 1)
    hair_c = np.array([0.018, 0.016, 0.015]) * (0.8 + 0.5 * ss(-0.3, 0.5, strand))[:, None]
    alb = _mix(alb, hair_c, scalp)
    rough = rough * (1 - scalp) + scalp * 0.3
    h = h * (1 - scalp) + scalp * 0.00006 * strand
    skin = 1 - scalp
    # ---------------------------------------------------------------- dead colour over the face
    pal = np.array([0.31, 0.33, 0.37])
    alb = _mix(alb, pal * (1 + 0.06 * noise.fbm(P * 30, 3, seed + 2))[:, None], face * 0.45 * skin)
    lower = ss(hc[2] - 0.02, hc[2] - 0.09, z)
    livor = np.clip(face * (0.25 + 0.6 * lower) * (0.6 + 0.4 * noise.fbm(P * 9, 3, seed + 3)), 0, 1)
    ears = np.zeros(n)
    for s in (1, -1):
        ec = np.asarray(F['ear'][0 if s == 1 else 1], float)
        ears = np.maximum(ears, ss(0.034, 0.018, np.linalg.norm((P - ec) * [1.4, 1.0, 0.8], axis=1)))
    livor = np.clip(livor + 0.5 * ears, 0, 1)
    nose_t = np.asarray(F['nose_t'], float)
    blanch = ss(0.012, 0.004, np.linalg.norm(P - nose_t, axis=1)) + ss(0.012, 0.004, np.linalg.norm(P - np.asarray(F['chin'], float), axis=1))
    alb = _mix(alb, [0.22, 0.12, 0.17], np.clip(livor * (1 - 0.7 * blanch), 0, 1) * 0.6 * skin)
    # fix round 2 (atlas crop: the paint was too low-contrast to read at all): drowned discolouration — grey-green
    # putrefactive blotches (days in cistern water), and SKIN SLIPPAGE: the epidermis lifts and tears off in sheets,
    # exposing paler pink-grey dermis with a ragged rolled edge (forehead, cheek, temple), 0.15 mm step
    blot = ss(0.1, 0.55, noise.fbm(P * 22, 3, seed + 20)) * face * skin
    alb = _mix(alb, [0.19, 0.22, 0.19], blot * 0.35)
    sl = noise.fbm(P * 14, 3, seed + 21) + 0.25 * noise.fbm(P * 90, 2, seed + 22)
    slip = ss(0.52, 0.6, sl) * skin * (1 - scalp)
    slip_edge = np.exp(-((sl - 0.56) / 0.012) ** 2) * skin
    alb = _mix(alb, [0.34, 0.25, 0.26], slip * 0.6)
    alb = _mix(alb, [0.36, 0.35, 0.36], slip_edge * 0.3)
    rough = rough * (1 - slip) + slip * 0.3
    h = h - 0.00015 * slip + 0.0001 * slip_edge
    # wet facial skin: roughness 0.36-0.46 (a thin water film over dead, slightly macerated stratum corneum)
    rough = rough * (1 - face * skin) + face * skin * (0.41 + 0.05 * noise.fbm(P * 50, 2, seed + 15))
    # ---------------------------------------------------------------- eyes (both lids closed in the Basis)
    lid_h = np.zeros(n)
    for k, s in enumerate((1, -1)):
        E = np.asarray(F['eye_c'][k], float)
        ex = (x - E[0]) * s                                # + = lateral
        ez = z - E[2]
        near = (y < E[1] - 0.004) & (np.abs(ex) < 0.026) & (np.abs(ez) < 0.03)
        # lid margin line: 2 mm below centre, the inner canthus 1.5 mm lower, the outer 1 mm higher
        # her right eye (k 1) closes with the eye_lid.py shell: margin at -30 deg on a 13.96 mm radius = 7 mm low
        mz = (-0.002 if k == 0 else -0.0068) - 0.0015 * ss(0.0, -0.012, ex) + 0.001 * ss(0.004, 0.013, ex)
        on_eye = ss(0.0145, 0.0115, np.abs(ex)) * near
        dm = ez - mz
        margin = np.exp(-(dm / 0.0006) ** 2) * on_eye
        lid_h += -0.00025 * margin
        # wet lashes: 6-8 mm down from the margin, clumped into spikes (period ~1.6 mm), tips curling laterally
        lu = -dm                                           # 0 at the margin, + downwards
        lx = ex - 0.25 * lu * (0.4 + ex / 0.014)
        clump = 0.5 + 0.5 * np.cos(lx / 0.0016 * 2 * math.pi + 2.0 * noise.fbm(P * 400, 1, seed + 4))
        length = 0.0055 + 0.0025 * noise.fbm(P * 300, 1, seed + 5) - 0.002 * ss(0.006, 0.014, np.abs(ex))
        width = 0.35 + 0.65 * ss(length, 0.0, lu)
        lash = ss(0.85 - 0.45 * width, 1.0 - 0.1 * width, clump) * ss(-0.0002, 0.0004, lu) * ss(length, length * 0.6, lu)
        lash = np.clip(lash * on_eye + margin * 0.9, 0, 1)
        alb = _mix(alb, [0.012, 0.011, 0.011], lash * 0.95)
        rough = rough * (1 - lash) + lash * 0.22
        lid_h += 0.00012 * lash
        if k == 1:
            # M-A (13.9 insert): the tear meniscus — a 0.3-0.5 mm wet strip along the lid margins of the eye that
            # opens (lower margin + the upper lid shell's margin row share this band in the closed Basis): a near-
            # mirror film (roughness 0.06) so the flame lays one thin bright line along the aperture
            men = np.exp(-((dm + 0.0003) / 0.00045) ** 2) * on_eye
            rough = rough * (1 - men) + men * 0.06
            # the lower lid margin at the window body.eye_window carves (el = lo(az) on the globe centre): a wet
            # grey-pink margin strip (~0.7 mm), the meniscus on its inner edge, the lash line on its outer edge
            from .body import eye_window_edges
            vv = np.stack([x - E[0], y - E[1], z - E[2]], 1)
            rr = np.maximum(np.linalg.norm(vv, axis=1), 1e-9)
            u_ = np.degrees(np.arctan2(vv[:, 0], -vv[:, 1])) / 50.0
            el_ = np.degrees(np.arcsin(np.clip(vv[:, 2] / rr, -1, 1)))
            lo_, _ = eye_window_edges(np.clip(u_, -1, 1))
            de = el_ - lo_                                  # deg above the lower margin edge (+ = into the window)
            fis = ss(1.0, 0.85, np.abs(u_)) * (rr < 0.0175) * (vv[:, 1] < 0)
            strip = ss(-4.0, -2.5, de) * ss(0.8, -0.2, de) * fis
            alb = _mix(alb, [0.30, 0.17, 0.16], strip * 0.55)
            men2 = ss(-1.6, -0.6, de) * ss(0.8, 0.0, de) * fis
            rough = rough * (1 - men2) + men2 * 0.06
            lline = np.exp(-((de + 3.6) / 0.7) ** 2) * fis
            alb = _mix(alb, [0.03, 0.025, 0.025], lline * 0.8)
        # periorbital: sunken, darker violet-grey on the lids and below (venous congestion), the crease and trough
        orb = ss(0.022, 0.009, np.sqrt((ex / 1.2) ** 2 + (ez / 0.9) ** 2)) * (y < E[1] + 0.002)
        alb = _mix(alb, [0.13, 0.11, 0.16], orb * 0.8)
        crease = np.exp(-((ez - (mz + 0.0088 - 0.002 * (ex / 0.014) ** 2)) / 0.0011) ** 2) * ss(0.017, 0.010, np.abs(ex)) * near
        trough = np.exp(-((ez - (mz - 0.0115 - 0.003 * ss(0.0, -0.01, ex))) / 0.0018) ** 2) * ss(0.018, 0.006, np.abs(ex + 0.002)) * near
        lid_h += -0.00035 * crease - 0.0003 * trough
        alb = _mix(alb, [0.15, 0.13, 0.17], crease * 0.45)
        # crow's feet: 3-4 fine lines fanning from the outer canthus
        cf_a = np.arctan2(ez, ex - 0.014)
        cf_r = np.hypot(ex - 0.014, ez)
        crow = (0.5 + 0.5 * np.cos(cf_a * 9.0)) ** 6 * ss(0.002, 0.005, cf_r) * ss(0.016, 0.008, cf_r) * (ex > 0.012) * near
        lid_h += -0.00006 * crow
        # maceration on the lids: fine wrinkling across the lid
        mac = np.sin(ez / 0.00075 * 2 * math.pi + 3 * noise.fbm(P * 220, 2, seed + 6)) * orb
        lid_h += 0.00002 * mac
        # brow: ~ 13 mm above the eye centre, medial head thick and rising, tail thin
        bt = (ex + 0.016) / 0.040                          # 0 medial .. 1 lateral tail
        bz = 0.0135 + 0.006 * np.sin(np.clip(bt, 0, 1) * math.pi * 0.85) - 0.003 * ss(0.7, 1.0, bt)
        bw = 0.0028 + 0.0024 * (1 - np.clip(bt, 0, 1))
        band = ss(bw, bw * 0.5, np.abs(ez - bz)) * ss(-0.08, 0.05, bt) * ss(1.08, 0.9, bt) * (y < E[1] - 0.002)
        ang = np.where(bt < 0.25, 1.25, 0.25 + 0.2 * (1 - bt))          # hair direction: rising medially, flat laterally
        du_ = np.cos(ang) * ex + np.sin(ang) * ez
        dv_ = -np.sin(ang) * ex + np.cos(ang) * ez
        st = _strokes(du_, dv_, 0.006, 0.00045, seed + 7 + k, P)
        brow = np.clip(band * (0.25 + 0.95 * st), 0, 1)
        alb = _mix(alb, [0.016, 0.013, 0.012], brow * 0.95)
        rough = rough * (1 - brow) + brow * 0.3
        lid_h += 0.00008 * band * st
    # ---------------------------------------------------------------- mouth
    L = np.asarray(F['lips'], float)
    lx, lz = x - L[0], z - L[2]
    ax = np.abs(lx)
    mouth_front = (y < L[1] + 0.012) & (ax < 0.03) & (np.abs(lz) < 0.03)
    wq = np.sqrt(np.clip(1 - (ax / 0.0215) ** 2, 0, 1))
    zt = (0.0062 - 0.0017 * np.exp(-(lx / 0.0032) ** 2) + 0.0009 * np.exp(-((ax - 0.0058) / 0.0035) ** 2)) * wq
    zb = -0.0088 * np.sqrt(np.clip(1 - (ax / 0.0200) ** 2, 0, 1))
    lipm = ss(0.0006, -0.0006, lz - zt) * ss(-0.0006, 0.0006, lz - zb) * (ax < 0.0215) * mouth_front
    border = (np.exp(-((lz - zt) / 0.0006) ** 2) + np.exp(-((lz - zb) / 0.0007) ** 2)) * (ax < 0.021) * mouth_front
    slit = np.exp(-((lz - 0.0002 * np.cos(lx / 0.02 * math.pi)) / 0.0007) ** 2) * ss(0.0225, 0.019, ax) * mouth_front
    cyan = np.array([0.11, 0.09, 0.15]) * (1 + 0.12 * noise.fbm(P * 200, 2, seed + 8))[:, None]
    alb = _mix(alb, cyan, lipm * 0.9)
    alb = _mix(alb, [0.36, 0.36, 0.39], border * 0.25)          # the pale white roll
    alb = _mix(alb, [0.03, 0.018, 0.022], slit * 0.95)
    fiss = (0.5 + 0.5 * np.cos(lx / 0.0011 * 2 * math.pi + 2.5 * noise.fbm(P * 260, 2, seed + 9))) ** 10 * lipm
    fiss *= ss(0.0005, 0.0018, np.abs(lz)) * (0.5 + 0.5 * ss(-0.2, 0.4, noise.fbm(P * 120, 2, seed + 10)))
    alb = _mix(alb, [0.09, 0.07, 0.10], fiss * 0.6)
    rough = rough * (1 - lipm) + lipm * (0.48 - 0.15 * fiss)   # dried, flaking vermilion, a little wet in the slit
    h += 0.00025 * border - 0.00008 * fiss - 0.0004 * slit + 0.00004 * lipm * noise.fbm(P * 700, 2, seed + 11)
    # philtrum columns, mentolabial sulcus
    philt = sum(np.exp(-((lx - s * 0.0045) / 0.0012) ** 2) for s in (1, -1)) * ss(zt + 0.0004, zt + 0.002, lz) * ss(0.02, 0.013, lz) * mouth_front
    ment = np.exp(-((lz + 0.0155 + 0.003 * (lx / 0.02) ** 2) / 0.0022) ** 2) * ss(0.02, 0.008, ax) * mouth_front
    h += 0.0003 * philt - 0.0004 * ment
    # nasolabial folds: from the nose wing (12 mm out, 4 mm up from the tip's base) to 10 mm outside the mouth corner
    for s in (1, -1):
        a = nose_t + np.array([s * 0.016, 0.012, -0.002])
        b = L + np.array([s * 0.030, 0.006, -0.012])
        ab = b - a
        t = np.clip(((P - a) @ ab) / ab.dot(ab), 0, 1)
        d = np.linalg.norm(P - (a + t[:, None] * ab), axis=1)
        fold = np.exp(-(d / 0.0018) ** 2) * ss(0.0, 0.15, t) * front
        h += -0.0005 * fold
        alb = _mix(alb, [0.22, 0.20, 0.25], fold * 0.25)
    # nostrils: dark inside the alae
    for s in (1, -1):
        nc = nose_t + np.array([s * 0.0065, 0.004, -0.006])
        nos = ss(0.0045, 0.0022, np.linalg.norm((P - nc) * [1.0, 0.8, 1.6], axis=1)) * ss(0.2, -0.4, N[:, 2])
        alb = _mix(alb, [0.03, 0.022, 0.025], nos * 0.9)
    # forehead lines: 3 faint horizontals
    fh = (z - (hc[2] + 0.02)) / 0.0085
    fl = (0.5 + 0.5 * np.cos(fh * 2 * math.pi + 0.8 * noise.fbm(P * 40, 2, seed + 12))) ** 8
    fl *= face * ss(hc[2] + 0.018, hc[2] + 0.028, z) * ss(hc[2] + 0.06, hc[2] + 0.045, z) * ss(0.045, 0.02, np.abs(x))
    h += -0.00006 * fl
    # ---------------------------------------------------------------- pores + microrelief (all skin)
    f1, f2 = noise.worley(P * 2800.0, seed + 13)             # ~0.36 mm cells
    nose_zone = ss(0.03, 0.012, np.linalg.norm(P - nose_t, axis=1))
    cheek_zone = sum(ss(0.03, 0.012, np.linalg.norm(P - np.asarray(c, float), axis=1)) for c in F['cheek'])
    pore_d = 0.000035 + 0.00005 * np.clip(nose_zone + 0.6 * cheek_zone, 0, 1)
    pore = ss(0.32, 0.12, f1) * (1 - lipm) * skin
    h += -pore_d * pore
    cross = noise.ridged(P * np.array([1500.0, 1500.0, 900.0]), 2, seed + 14)
    h += 0.000012 * (cross - 0.5) * skin * (1 - lipm)
    alb = _mix(alb, alb * 0.9, pore * 0.3)
    h += lid_h
    # dirt / silt in the deepest creases and at the hairline
    crev = ss(0.8, 0.45, AO) * skin
    alb = _mix(alb, [0.08, 0.075, 0.06], crev * 0.5)
    # fix round 3 stage 2 (cine's lamp-pool list, 13.9 insert at f/1.4: a glossy plaster MANNEQUIN): under the lamp from
    # below + the floor bounce the face is lit flat, so its form must come from what a real face carries in its
    # colour: occlusion-darkened sockets, lid creases, nasolabial folds, under-nose and lip line (skin is
    # translucent and its cavities trap light: cavity ~ AO, x0.62-1.0), and a wet sheen that is BROKEN (water
    # beads / drying patches: roughness 0.36-0.58 in 1-3 cm patches) instead of one even plaster gloss.
    alb = alb * (1.0 - 0.38 * (1.0 - np.clip(AO, 0, 1)) * face)[:, None]
    rough = rough + face * skin * (0.07 * noise.fbm(P * 45.0, 3, seed + 41) + 0.04)
    if cap_on is not None and np.any(cap_on):
        alb[cap_on], rough[cap_on], h[cap_on] = alb0[cap_on], rough0[cap_on], h0[cap_on]
    return np.clip(alb, 0, 1), np.clip(rough, 0.05, 1), h
