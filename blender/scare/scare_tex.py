"""JUMPSCARE (#147) — skin fields of the scare head, evaluated per VERTEX in REST head space (mm; see scare_head.py).

At h 0.6-0.8 mm the vertex attributes resolve 1.5-3 mm detail (bruise mottling, scars, lip borders, lid margins,
marbling); everything finer (pores 0.1-0.3 mm, petechiae 0.2-1 mm, lip fissures, cross-hatched micro-relief, wet
beads) is shader-procedural in object space, masked by the attributes here (scare_scene.skin_material).

Colours are LINEAR albedo, from forensic photography of drowning / manual strangulation (DiMaio, Spitz & Fisher):
  dead pallor (grey-blue, perfusion gone) 0.30/0.32/0.36 with blotchy 1-3 cm mottling, cyanotic lips/nail beds,
  periorbital congestion (violet-brown), dependent lividity (the face floated down: violet on the lower face),
  post-mortem marbling (green-black venous network, 1-3 mm), fresh fingertip bruises (purple-black core, red-purple
  rim, 3 mm soft edge), old yellow-green bruises with a brown fringe, pale ridged scars, red-raw lid margins.
Returns per-vertex arrays: alb (n,3), rough, wet (coat weight), sss (SSS scale multiplier), pore, pet (petechiae
density), lip (vermilion mask), muc (mucosa / wet tissue), cap (cut surface), blood (clot), disp (mm along +N).
"""
import math

import numpy as np

from lib import noise
from lib.noise import smoothstep as ss
from scare import scare_head as sh

PALLOR = np.array([0.255, 0.257, 0.255])     # r2: grey-green drowned pallor (r1 read beige-pink under 2900 K); r16 neutral:
# the colour now comes from the zones (yellow-grey over bone, blue-violet hollows, cyanotic mouth) round a neutral grey
LIVID = np.array([0.20, 0.12, 0.17])
CYAN_LIP = np.array([0.100, 0.096, 0.122])      # r12: cyanotic blue-grey (r9-r11 still read pink under the hotspot)
MUCOSA = np.array([0.25, 0.07, 0.08])
GUM = np.array([0.30, 0.13, 0.14])
TONGUE = np.array([0.22, 0.12, 0.15])
FRESH_CORE = np.array([0.045, 0.03, 0.055])     # r6: blue-black core
FRESH_RIM = np.array([0.15, 0.07, 0.11])        # r6: dull plum, not magenta
OLD_YG = np.array([0.36, 0.34, 0.14])
OLD_BROWN = np.array([0.24, 0.17, 0.10])
SCAR = np.array([0.50, 0.43, 0.42])     # r3: paler, pinker than the grey skin so it reads under 2900 K
CLOT = np.array([0.06, 0.008, 0.008])
MARBLE = np.array([0.05, 0.065, 0.075])


def _mix(a, b, t):
    t = np.clip(np.asarray(t, float), 0.0, 1.0)
    return a + (np.asarray(b, float) - a) * t[..., None]


def seg_dist(P, A, B):
    """Distance from points P (n,3) to segment AB; also the parameter t."""
    ab = B - A
    t = np.clip(((P - A) @ ab) / max(ab @ ab, 1e-12), 0.0, 1.0)
    return np.linalg.norm(P - (A + t[:, None] * ab), axis=1), t


def poly_dist(P, pts):
    """Distance to a 3D polyline + arc-length parameter (0..1) of the nearest point."""
    pts = np.asarray(pts, float)
    L = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    best = np.full(len(P), 1e9)
    s = np.zeros(len(P))
    for i in range(len(pts) - 1):
        d, t = seg_dist(P, pts[i], pts[i + 1])
        m = d < best
        best[m] = d[m]
        s[m] = (L[i] + t[m] * (L[i + 1] - L[i])) / max(L[-1], 1e-9)
    return best, s


def on_face(face, xz_pts, y0=-140.0):
    """Project (x, z) points onto the rest face along +y (front view)."""
    out = []
    for x, z in xz_pts:
        o = sh.V(x, y0, z)
        t, h = sh.ray_hit(face.rest, o, sh.V(0.0, 1.0, 0.0)[None, :], tmax=260.0)
        out.append(o + sh.V(0.0, 1.0, 0.0) * t[0])
    return np.array(out)


def blob(P, c, r, seed, wob=0.35):
    """Soft irregular ellipsoidal patch 0..1 (r = radii mm) with a noisy edge."""
    q = (P - c) / np.asarray(r, float)
    rho = np.linalg.norm(q, axis=1)
    rho = rho * (1.0 + wob * noise.fbm(P / 6.0 + seed * 3.1, 3, seed))
    return 1.0 - ss(0.55, 1.05, rho)


def lip_borders(x):
    """Vermilion borders (z, mm) vs x: upper with the cupid's bow, lower; commissures at +-24.4."""
    u = np.clip(np.abs(x) / 24.4, 0.0, 1.0)
    up = -61.6 + 8.0 * np.power(1 - u * u, 0.55) - 0.9 * np.exp(-(x / 2.3) ** 2) + 0.5 * np.exp(-((np.abs(x) - 5.2) / 2.4) ** 2)
    lo = -61.8 - 9.6 * np.power(1 - u * u, 0.7) - 0.6 * ss(4.0, 12.0, x) * ss(18.0, 12.0, x)   # swollen left half
    return up, lo


def fields(face, P, N, seed=147):
    """P (n,3) REST positions in mm, N (n,3) normals. Returns dict of per-vertex fields."""
    n = len(P)
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    rng = np.random.default_rng(seed)
    front = ss(0.15, 0.55, -N[:, 1])                       # facing the camera (replaces fixed-y gates; #147b r1)
    alb = np.tile(PALLOR, (n, 1))
    # ---- base: blotchy dead skin (1-3 cm mottle), redder/darker around nose, lids, ears; slight yellow on the forehead
    m1 = noise.fbm(P / 22.0, 4, seed)
    m2 = noise.fbm(P / 7.0, 3, seed + 1)
    m3 = noise.fbm(P / 2.5, 2, seed + 3)
    # #147d: the AD read r8 as "an even grey" at frame scale: the 2-15 mm mottle carried +-4 % luminance and no hue.
    # Dead skin is blotchy: pallor with grey-violet, green-grey and faint yellow patches, +-12-18 % at 5-15 mm.
    alb = alb * (1.0 + 0.20 * m1 + 0.13 * m2 + 0.07 * m3)[:, None]
    hue1 = noise.fbm(P / 9.0 + 11.0, 3, seed + 62)
    hue2 = noise.fbm(P / 5.0 + 23.0, 2, seed + 63)
    alb = alb * (1.0 + np.stack([0.10 * hue1 + 0.05 * hue2, -0.02 * hue1 + 0.06 * hue2, -0.10 * hue1 - 0.03 * hue2], 1))
    # blotchy discolouration: dusky violet-grey and green-grey patches (2-4 cm), the face no longer one colour
    bl1 = ss(0.0, 0.40, noise.fbm(P / 16.0 + 3.3, 3, seed + 60))
    bl2 = ss(0.05, 0.45, noise.fbm(P / 12.0 + 7.1, 3, seed + 61))
    alb = _mix(alb, alb * np.array([0.74, 0.68, 0.90]), 0.80 * bl1)        # dusky violet-grey (r11: stronger)
    alb = _mix(alb, alb * np.array([0.90, 1.02, 0.78]), 0.70 * bl2)        # green-grey (early decomposition)
    alb = _mix(alb, alb * np.array([1.06, 1.02, 0.92]), ss(30.0, 70.0, z) * 0.6)
    # #147e: facial COLOUR ZONES (r14 face chroma p50 0.07 on screen = grey plaster). A dead face still has zones: waxy
    # yellow-grey over bone (forehead, brow, nose bridge, malar prominences), blue-violet-grey in the hollows (temples,
    # orbits, buccal), a cyanotic grey-blue ring round the mouth, grey-green on the jaw
    ax_ = np.abs(x)
    bone = np.clip(ss(-8.0, 22.0, z) * (1.0 - ss(30.0, 52.0, ax_)) + 0.8 * np.exp(-(((ax_ - 44.0) / 11.0) ** 2 + ((z + 18.0) / 8.0) ** 2))
                   + 0.7 * np.exp(-((x / 6.0) ** 2 + ((z + 12.0) / 14.0) ** 2)), 0.0, 1.0) * front
    alb = _mix(alb, alb * np.array([1.20, 1.07, 0.74]), 0.95 * bone * (0.7 + 0.3 * ss(-0.3, 0.3, m1)))
    hollow = np.clip(ss(48.0, 60.0, ax_) * ss(-40.0, -5.0, z) * (1.0 - ss(30.0, 50.0, z))
                     + np.exp(-(((ax_ - 42.0) / 12.0) ** 2 + ((z + 50.0) / 16.0) ** 2)), 0.0, 1.0)
    alb = _mix(alb, alb * np.array([0.74, 0.76, 1.02]), 0.95 * hollow)
    peri_o = np.exp(-((x / 30.0) ** 2 + ((z + 60.0) / 20.0) ** 2)) * front
    alb = _mix(alb, alb * np.array([0.78, 0.88, 1.06]), 0.85 * peri_o)
    jaw_ = ss(-70.0, -95.0, z) * ss(10.0, 30.0, ax_) * front
    alb = _mix(alb, alb * np.array([0.88, 0.97, 0.86]), 0.6 * jaw_)
    # dependent lividity (she floated face-down): violet on the lower face, chin, under the nose, lips — pooled in
    # blotches, not a gradient (#147d)
    liv = ss(-25.0, -85.0, z) * ss(-5.0, -25.0, y) * (0.40 + 0.45 * ss(-0.25, 0.45, noise.fbm(P / 8.0 + 5.0, 3, seed + 64)))
    alb = _mix(alb, LIVID, liv)
    # nose / cheeks congested red-violet (blanched at the tip and alae where pressed)
    nose = np.exp(-(((x + 1.0) / 14.0) ** 2 + ((z + 30.0) / 16.0) ** 2)) * ss(-20.0, -38.0, y)
    alb = _mix(alb, np.array([0.29, 0.15, 0.19]), 0.60 * nose)       # r12: stronger congestion (colour zones)
    # ---- periorbital congestion (sunken, violet-brown), lid margins red-raw, caruncle pink
    mar = np.zeros(n)
    caru = np.zeros(n)
    peri = np.zeros(n)
    conj = np.zeros(n)
    for k in (0, 1):
        v, r, az, el = face.eye_local(P, k)
        up, lo = sh.margins(az, k)
        ang = np.minimum(np.abs(el - up), np.abs(el - lo))
        inside = (el < up) & (el > lo) & (np.abs(az) < sh.AZ_CANTH)
        # r8 (#147c): 0.2-0.75 mm (1-3.5 deg) band; r3-r7 1.5-5 deg read as a pink rubber ring round the globe
        mk = (1.0 - ss(1.0, 3.5, ang)) * (r < sh.R_LID_IN + 3.2)
        mar = np.maximum(mar, mk)
        conj = np.maximum(conj, (inside & (r < sh.R_LID_IN + 1.0)).astype(float))
        s = 1.0 if k == 0 else -1.0
        cc = face.E[k] + sh.V(-s * 13.2, -7.6, -0.6)
        caru = np.maximum(caru, 1.0 - ss(1.5, 3.6, np.linalg.norm(P - cc, axis=1)))
        dd = np.linalg.norm((P - face.E[k]) / np.array([24.0, 30.0, 20.0]), axis=1)
        peri = np.maximum(peri, 1.0 - ss(0.55, 1.05, dd))
    alb = _mix(alb, np.array([0.16, 0.095, 0.14]), 0.70 * peri * (0.8 + 0.2 * m2))
    alb = _mix(alb, alb * np.array([1.05, 0.82, 0.82]), 0.45 * mar)    # #147d: a tint; the wet posterior edge is shaded
    alb = _mix(alb, np.array([0.22, 0.14, 0.135]), caru)               # r10: duller flesh-pink (r9: saturated bead); #147e duller
    # ---- post-mortem marbling: a branching dark venous network on the temples, jaw, forehead edges and neck
    vein = noise.ridged(P / 16.0, 4, seed + 5)
    vmask = ss(0.80, 0.93, vein)
    where = (ss(30.0, 50.0, np.abs(x)) + ss(-75.0, -100.0, z) + ss(40.0, 62.0, z) * ss(18.0, 35.0, np.abs(x)))
    alb = _mix(alb, MARBLE, 0.75 * vmask * np.clip(where, 0, 1))
    # #147d: a FAINT venous net (1-3 mm, blue-grey) over the whole lit face — r8's net sat only on the unlit temples/jaw
    fine_v = ss(0.83, 0.95, noise.ridged(P / 6.0, 3, seed + 6))
    alb = _mix(alb, alb * np.array([0.62, 0.68, 0.86]), fine_v * (0.30 + 0.35 * peri + 0.25 * np.clip(where, 0, 1)))
    # #147e: a readable 1-1.5 mm marbling net (green-violet-black) over the temples, jaw, brow sides and throat, fainter on
    # the cheeks (the brief's 'marbling (dark venous network)'; the AD could not find r8-r13's)
    mv2 = ss(0.84, 0.95, noise.ridged(P / 9.0 + 3.7, 3, seed + 8)) * (1.0 - ss(0.0, 0.5, noise.fbm(P / 14.0, 2, seed + 9)))
    wm = np.clip(0.25 + 0.75 * np.clip(where, 0, 1) + 0.4 * peri, 0.0, 1.0) * front
    alb = _mix(alb, alb * np.array([0.50, 0.55, 0.58]), 0.75 * mv2 * wm)
    mv = ss(0.86, 0.96, noise.ridged(P / 2.6, 2, seed + 7))
    alb = _mix(alb, alb * np.array([0.72, 0.76, 0.88]), 0.35 * mv)
    # ---- lips: cyanotic vermilion, white-roll border paler, the split lip clot
    lu, ll = face.lip_parts(P)
    ld = np.minimum(lu, ll)
    lip = (1.0 - ss(0.25, 0.85, ld)) * ss(-20.0, -26.0, y)
    alb = _mix(alb, CYAN_LIP * (1.0 + 0.12 * m2)[:, None], lip)
    roll = np.exp(-((ld - 0.7) / 0.35) ** 2) * ss(-20.0, -26.0, y) * ss(-55.0, -50.0, -z)
    alb = _mix(alb, alb * 1.08, 0.5 * roll)                           # r11: no lip-gloss white roll
    # ---- oral cavity: mucosa, gums, tongue (rest space: inside the cavity envelope)
    cav = face.cavity(P, grow=0.5)                                                                      # = scare_head cavity
    muc = (1.0 - ss(-0.5, 2.5, cav)) * ss(-34.0, -29.0, y)
    tongue = 1.0 - ss(0.0, 1.2, sh.ell(P, sh.V(0.0, 5.0, -67.0), (18.5, 25.0, 7.0)))
    gum = np.zeros(n)
    for (y0, kk), zz in ((face.arch_up, -50.0), (face.arch_lo, -72.0)):
        dd = np.abs(y - (y0 + kk * x * x + 2.0))
        gum = np.maximum(gum, (1.0 - ss(3.0, 5.0, dd)) * (1.0 - ss(3.0, 5.5, np.abs(z - zz))) * ss(25.0, 22.0, np.abs(x)))
    inner = np.clip(muc, 0, 1)
    alb = _mix(alb, MUCOSA * (1.0 + 0.2 * m2)[:, None], inner)
    alb = _mix(alb, GUM, gum * inner)
    alb = _mix(alb, TONGUE * (1.0 + 0.25 * noise.fbm(P / 3.0, 2, seed + 9))[:, None], tongue * inner)
    # ---- the split lower lip: laceration (clotted red-black) + swollen bruised half
    lac, _ = poly_dist(P, sh.LACERATION)
    lacm = 1.0 - ss(0.7, 1.7, lac)
    swell = blob(P, sh.V(9.0, -32.5, -64.5), (9.0, 6.0, 6.0), 3, 0.25)
    alb = _mix(alb, np.array([0.16, 0.05, 0.08]), 0.55 * swell * lip)
    alb = _mix(alb, CLOT, lacm)
    # ---- epistaxis: a trickle from her right nostril over the upper lip to the vermilion (frontal x-z path)
    path = [(-6.8, -39.5), (-7.4, -43.0), (-6.9, -46.5), (-7.6, -50.0), (-7.2, -53.5), (-8.0, -56.0)]
    xz = np.stack([x, np.zeros(n), z], 1)
    dn, tn = poly_dist(xz, [sh.V(a, 0.0, b) for a, b in path])
    wn = 1.1 + 0.6 * tn + 0.35 * noise.fbm(P / 2.0, 2, seed + 70)
    nose_bl = (1.0 - ss(wn * 0.7, wn, dn)) * ss(-20.0, -26.0, y)
    crust = nose_bl * ss(0.0, 0.5, noise.fbm(P / 1.3, 2, seed + 71) + 0.3)
    # #147d: a trail with body — darker drying edges (coffee ring), a thin translucent wet centre, a bead at the lip
    nb_edge = nose_bl * (1.0 - ss(0.45, 0.85, dn / np.maximum(wn, 1e-3))) * ss(0.25, 0.65, dn / np.maximum(wn, 1e-3))
    bead_c = sh.V(-8.1, -33.6, -57.0)
    nb_bead = 1.0 - ss(1.0, 1.9, np.linalg.norm((P - bead_c) * np.array([1.0, 1.0, 0.8]), axis=1))
    nose_bl = np.maximum(nose_bl, nb_bead)
    alb = _mix(alb, np.array([0.11, 0.014, 0.012]), 0.92 * nose_bl)
    alb = _mix(alb, np.array([0.045, 0.012, 0.010]), 0.75 * nb_edge)
    alb = _mix(alb, np.array([0.05, 0.02, 0.015]), 0.4 * crust)
    lacm = np.maximum(lacm, 0.0)
    # ---- strangulation: Harlan's RIGHT hand from the front -> thumb on HER RIGHT jaw angle, fingers on HER LEFT
    #      mandible border; the throat band above the cut; layered over OLD yellow-green bruises
    # #147d: Harlan's LEFT hand from the front: the 4 fingertips in a row along HER RIGHT mandible border (the side the
    # torch lights in the mirrored hero pose — the AD could not find them at -5..-7 EV on her left), thumb on her left
    tips = face.skin_radial([-12.0, -22.0, -32.0, -41.0], [-104.0, -101.0, -96.0, -89.0], inset=1.0)   # her right
    fing = np.zeros(n)
    nail = np.zeros(n)
    for i in range(4):
        c = tips[i]
        rr = 6.5 - 0.4 * i
        fing = np.maximum(fing, blob(P, c, (rr, rr * 1.15, rr * 1.2), 10 + i, 0.45))
        # crescent fingernail abrasion at the leading (upper-front) edge
        cn = c + sh.V(0.0, -3.0, 6.0)
        dn = np.abs(np.linalg.norm((P - cn) / np.array([3.2, 3.2, 3.2]), axis=1) - 1.0)
        nail = np.maximum(nail, (1.0 - ss(0.0, 0.35, dn)) * ss(cn[2] - 1.0, cn[2] + 1.5, z) * (np.linalg.norm(P - cn, axis=1) < 4.5))
    thumb = blob(P, face.skin_radial(40.0, -96.0, inset=1.0)[0], (10.0, 12.0, 12.0), 20, 0.4)          # her left
    band = (1.0 - ss(8.0, 18.0, np.abs(z - (-122.0 + 0.36 * (y - 0.0))))) * ss(30.0, 10.0, y) * (0.6 + 0.4 * ss(-0.2, 0.5, noise.fbm(P / 5.0, 3, seed + 13)))
    old1 = blob(P, face.skin_radial(40.0, -8.0, inset=1.0)[0], (16.0, 14.0, 11.0), 30, 0.5)     # her left temple/zygoma
    old2 = blob(P, face.skin_radial(-36.0, -90.0, inset=1.0)[0], (13.0, 13.0, 12.0), 31, 0.5)   # her right jawline
    old3 = blob(P, face.skin_radial(-25.0, -27.0, inset=1.0)[0], (14.0, 12.0, 11.0), 32, 0.55)  # her right cheek (lit)
    old4 = blob(P, face.E[0] + sh.V(2.0, -8.0, -6.0), (19.0, 14.0, 13.0), 33, 0.5) * (1.0 - conj)  # her left orbit, under the hair
    # #147d: r8's old bruise was a flat yellow decal (absolute 0.36/0.34/0.14 over 0.25 grey skin). Healing bruises are a
    # TINT of the skin (pores and mottle show through), low saturation: brown-grey fringe -> yellow-green core, the edge
    # spread over 5-10 mm, broken by the subcutaneous mottle
    for o in (old1, old2, old3, old4):
        om = o * (0.75 + 0.25 * ss(-0.3, 0.4, noise.fbm(P / 3.5, 2, seed + 34)))
        alb = _mix(alb, alb * np.array([0.86, 0.78, 0.70]), 0.75 * ss(0.0, 0.6, om))
        alb = _mix(alb, alb * np.array([1.10, 1.07, 0.66]), 0.70 * ss(0.3, 0.95, om))
    # fresh black eye (periorbital haematoma) on her RIGHT eye — the clear, torch-lit one: lower lid + lateral canthus
    shiner = blob(P, face.E[1] + sh.V(-5.0, -9.0, -8.0), (17.0, 14.0, 12.0), 22, 0.45) * (1.0 - conj)
    fresh = np.clip(np.maximum.reduce([fing, thumb, band * 0.85, 0.8 * shiner]), 0, 1)
    mot = 0.75 + 0.25 * ss(-0.4, 0.5, noise.fbm(P / 2.2, 3, seed + 14))        # subcutaneous mottling
    alb = _mix(alb, FRESH_RIM, ss(0.0, 0.45, fresh) * 0.9)
    alb = _mix(alb, FRESH_CORE, ss(0.35, 0.95, fresh) * mot)
    alb = _mix(alb, np.array([0.20, 0.06, 0.05]), 0.9 * nail)
    # ---- r11: skin slippage (a drowned body's epidermis loosens and tears off): a raw pinkish-grey dermis patch with a
    #      ragged, whitish rolled edge of loose epidermis — on her lit right temple and below the right cheekbone
    slip = np.zeros(n)
    slip_e = np.zeros(n)
    for (th_, z_, rx, rz, sd) in ((-48.0, 34.0, 9.0, 6.5, 80), (-40.0, -52.0, 6.0, 4.5, 81)):
        c_ = face.skin_radial(th_, z_)[0]
        q_ = (P - c_) / np.array([rx, 30.0, rz])
        rho_ = np.linalg.norm(q_, axis=1) * (1.0 + 0.35 * noise.fbm(P / 2.2, 3, seed + sd)) + 0.08 * noise.fbm(P / 0.7, 2, seed + sd + 1)
        slip = np.maximum(slip, (1.0 - ss(0.85, 1.0, rho_)) * front)
        slip_e = np.maximum(slip_e, (1.0 - ss(0.0, 0.14, np.abs(rho_ - 1.04))) * front)
    alb = _mix(alb, np.array([0.40, 0.27, 0.27]) * (0.9 + 0.2 * m3)[:, None], 0.85 * slip)
    alb = _mix(alb, np.array([0.47, 0.45, 0.42]), 0.75 * slip_e)
    # ---- old scars: her RIGHT brow (raised, pale, ridged, suture dots) + her LEFT cheekbone crescent (depressed)
    disp = np.zeros(n)
    sA, sB = sh.V(-21.0, -24.0, 27.0), sh.V(-33.0, -17.0, 10.0)
    ds, st = seg_dist(P * np.array([1, 0.35, 1]), sA * np.array([1, 0.35, 1]), sB * np.array([1, 0.35, 1]))
    ds = ds + 0.25 * noise.fbm(P / 2.0, 2, seed + 20)
    # #147d: wider (2.6 mm), a pale shiny ridge with a darker hyperpigmented border, so it reads at 0.13 mm/px
    ds = ds * (1.0 + 0.25 * noise.fbm(P / 5.0, 2, seed + 21))
    scar1 = (1.0 - ss(0.75, 1.35, ds)) * front
    sedge = (1.0 - ss(1.3, 2.3, ds)) * (1.0 - scar1) * front
    alb = _mix(alb, alb * np.array([0.80, 0.74, 0.76]), 0.6 * sedge)
    alb = _mix(alb, SCAR * (1.0 + 0.06 * m2)[:, None], scar1 * 0.92)
    disp += 0.36 * scar1 * (1.0 - ss(0.0, 1.2, ds))
    for j in range(4):           # suture marks, 4 mm apart, either side
        for sgn in (1.0, -1.0):
            t = (j + 0.5) / 4.0
            c = sA + (sB - sA) * t
            perp = np.array([-(sB - sA)[2], 0.0, (sB - sA)[0]])
            perp = perp / np.linalg.norm(perp) * 2.6 * sgn
            dd = np.linalg.norm((P - (c + perp)) * np.array([1, 0.35, 1]), axis=1)
            sm = (1.0 - ss(0.45, 0.85, dd)) * front
            alb = _mix(alb, SCAR * 1.05, 0.7 * sm)
            disp += 0.12 * sm
    cc = face.skin_radial(-31.0, -24.0)[0]                   # her RIGHT cheekbone (r3: the left one is under the hair)
    q = P - cc
    rho = np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2)
    phi = np.degrees(np.arctan2(q[:, 2], q[:, 0]))
    arcw = np.abs(rho - 15.0) * (1.0 + 0.3 * noise.fbm(P / 4.0, 2, seed + 22))
    arcm = ss(150.0, 130.0, np.abs(phi - 200.0 + 360.0 * (phi < 20))) * front * (np.abs(q[:, 1]) < 14.0)
    arc = (1.0 - ss(0.5, 1.0, arcw)) * arcm
    arce = (1.0 - ss(1.0, 1.9, arcw)) * (1.0 - arc) * arcm
    alb = _mix(alb, alb * np.array([0.80, 0.74, 0.76]), 0.55 * arce)
    alb = _mix(alb, SCAR * 0.97, 0.85 * arc)
    disp -= 0.24 * arc
    scar1 = np.maximum(scar1, arc)
    # ---- folds / creases (rest-space grooves, mm along -N): lid creases, nasolabial, marionette, forehead, glabella
    groove = np.zeros(n)
    for k in (0, 1):
        v, r, az, el = face.eye_local(P, k)
        up, lo = sh.margins(az, k)
        crease = (1.0 - ss(1.2, 3.8, np.abs(el - (up + 34.0)) * np.pi / 180.0 * r)) * ss(70.0, 45.0, np.abs(az)) * (r < 22)
        groove = np.maximum(groove, 0.25 * crease)
        tear = (1.0 - ss(1.2, 3.0, np.abs(el - (lo - 36.0)) * np.pi / 180.0 * r)) * ss(-40.0, 10.0, az) * ss(40.0, 15.0, az) * (r < 24)
        groove = np.maximum(groove, 0.15 * tear)
        # crow's feet: 3 rays from the lateral canthus
        lc = face.E[k] + sh.V((1.0 if k == 0 else -1.0) * 14.0, -2.0, 0.6)
        q = P - lc
        s = 1.0 if k == 0 else -1.0
        ph = np.degrees(np.arctan2(q[:, 2], s * q[:, 0]))
        rr = np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2)
        for a0 in (-28.0, -4.0, 20.0):
            groove = np.maximum(groove, 0.22 * (1.0 - ss(1.2, 3.5, np.abs(ph - a0))) * ss(3.0, 6.0, rr) * ss(16.0, 9.0, rr))
    for s in (1.0, -1.0):
        gl, _ = seg_dist(P * np.array([1.0, 0.2, 1.0]), sh.V(s * 6.5, -5.0, 13.0), sh.V(s * 7.5, -5.0, 27.0))   # glabellar lines
        groove = np.maximum(groove, 0.3 * (1.0 - ss(0.4, 1.3, gl)) * front)
    for zz in (34.0, 44.0, 54.0):
        wav = zz + 1.5 * np.sin(x / 9.0 + zz) + 0.8 * noise.fbm(P / 12.0, 2, seed + int(zz))
        groove = np.maximum(groove, 0.08 * (1.0 - ss(0.3, 1.8, np.abs(z - wav))) * ss(30.0, 12.0, np.abs(x)) * front)
    for zz in (-112.0, -121.0):
        groove = np.maximum(groove, 0.45 * (1.0 - ss(0.6, 2.0, np.abs(z - (zz + 0.36 * y)))) * ss(40.0, 10.0, y))
    # ---- #147e r17: the CREASES of a slack dead face at the mesh's resolvable scale (0.8-1.4 mm wide, 0.15-0.45 mm
    #      deep; the r1-r16 grooves were 0.08-0.3 mm = a smooth rubber mask at frame scale). Broken by noise, asymmetric.
    brk = lambda sd: ss(-0.25, 0.25, noise.fbm(P / 4.0, 2, seed + sd))           # breaks a crease into 3-8 mm pieces
    crease = np.zeros(n)
    for k in (0, 1):
        v, r, az, el = face.eye_local(P, k)
        up, lo = sh.margins(az, k)
        s_ = 1.0 if k == 0 else -1.0
        # fine lower-lid creases: 3 arcs 2.5-6.5 mm under the margin, medial to lateral, fading laterally into the
        # crow's feet (the infraorbital wrinkles every adult face has; macerated, slack skin deepens them)
        for j, (dd, dep) in enumerate(((11.0, 0.22), (17.0, 0.28), (24.0, 0.20))):
            elc = lo - dd + 3.0 * (az / 70.0)
            w_ = np.abs(el - elc) * np.pi / 180.0 * r
            crease = np.maximum(crease, dep * (1.0 - ss(0.35, 0.75, w_)) * ss(-45.0, -20.0, az) * ss(65.0, 40.0, az)
                                * (r < 26.0) * (r > 12.6) * (0.4 + 0.6 * brk(90 + 3 * k + j)))
        # crow's feet: 5 rays from the lateral canthus, deeper (r1-r16: 3 rays at 0.22)
        lc = face.E[k] + sh.V(s_ * 14.0, -2.0, 0.6)
        q = P - lc
        ph = np.degrees(np.arctan2(q[:, 2], s_ * q[:, 0]))
        rr = np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2)
        for j, a0 in enumerate((-34.0, -16.0, 0.0, 14.0, 30.0)):
            wq = np.abs(ph - a0 - 4.0 * noise.fbm(P / 6.0, 2, seed + 95 + j)) * np.pi / 180.0 * rr
            crease = np.maximum(crease, 0.36 * (1.0 - ss(0.35, 0.8, wq)) * ss(2.5, 5.0, rr) * ss(17.0, 9.0, rr) * (0.5 + 0.5 * brk(100 + j)))
    ax_ = np.abs(x)
    # the nasolabial crease (a sharp line in the slack fold), the marionette lines down from the mouth corners
    for s_ in (1.0, -1.0):
        dnl, tnl = poly_dist(np.stack([x, np.zeros(n), z], 1), [sh.V(s_ * a, 0.0, b) for a, b in ((16.5, -36.0), (21.0, -46.0), (25.0, -55.0), (27.5, -62.0))])
        crease = np.maximum(crease, 0.42 * (1.0 - ss(0.45, 1.0, dnl)) * (1.0 - 0.5 * tnl) * front)
        dmr, tmr = poly_dist(np.stack([x, np.zeros(n), z], 1), [sh.V(s_ * a, 0.0, b) for a, b in ((25.5, -64.0), (26.5, -72.0), (27.0, -80.0))])
        crease = np.maximum(crease, 0.30 * (1.0 - ss(0.4, 0.9, dmr)) * (1.0 - 0.7 * tmr) * front * (0.5 + 0.5 * brk(110)))
    # perioral (upper-lip skin) vertical lines: 7 short radial lines above the vermilion border
    rng_c = np.random.default_rng(seed + 120)
    for xl in (-17.0, -11.5, -6.5, 5.5, 10.0, 14.5, 19.0):
        xl = xl + rng_c.uniform(-1.0, 1.0)
        top = -44.5 - 0.02 * xl * xl + rng_c.uniform(-1.5, 1.5)
        dl, tl_ = seg_dist(np.stack([x, np.zeros(n), z], 1), sh.V(xl, 0.0, top), sh.V(xl * 1.06, 0.0, -51.0 - 0.02 * xl * xl))
        crease = np.maximum(crease, 0.18 * (1.0 - ss(0.3, 0.65, dl)) * (1.0 - lip) * front * ss(-20.0, -26.0, y))
    # chin: mentalis 'orange peel' dimpling (2-3 mm pits), the dead chin pad slack
    dimple = ss(0.15, 0.55, noise.fbm(P / 1.6, 2, seed + 130)) * np.exp(-((x / 13.0) ** 2 + ((z + 92.0) / 9.0) ** 2)) * front
    crease = np.maximum(crease, 0.16 * dimple)
    disp -= np.maximum(groove, crease)
    disp += 0.5 * fresh * ss(0.4, 0.9, fresh)                 # bruise swelling
    # ---- the cut (#147d): the torn skin edge retracted 4-12 mm above the cleaver plane over an exposed band — a 1-2 mm
    #      yellow subcutaneous fat line under the skin edge, then dark wet muscle with clots; the trachea stump hanging out
    #      (pale cartilage rings smeared with blood, dark mucosa inside), torn muscle tags and clotted drips below.
    cutd = face.cut_dist(P)
    hs = face.skin_line(P)
    band = face.tissue_band(P, cutd)
    below = ss(-0.3, 0.3, cutd)                                       # beyond the plane: trachea, tags, drips, cap
    capm = np.maximum(band, below)
    tout, tlum = face.trachea(P)
    trach = (1.0 - ss(0.3, 0.9, tout)) * ss(-0.5, 0.5, cutd + 3.0)   # trachea surface (stump + its emergence)
    lumen = (1.0 - ss(0.2, 0.6, tlum)) * trach
    drip = np.zeros(n)
    for xd, ln in face.DRIPS:
        c = face.neck_anchor(xd, 0.6)
        dd, _ = seg_dist(P, c + sh.V(0.0, 0.0, 1.5), c + sh.V(0.0, 0.2, -ln))
        drip = np.maximum(drip, (1.0 - ss(1.4, 2.0, dd)) * below)
    depth = cutd + hs                                                  # mm below the skin edge (on the band)
    fatl = band * (1.0 - ss(1.0, 2.2, depth))
    musc_m = np.array([0.15, 0.035, 0.03]) * (0.75 + 0.5 * ss(-0.4, 0.5, noise.fbm(P / np.array([2.0, 2.0, 5.0]), 2, seed + 33)))[:, None]
    capc = musc_m.copy()
    capc = _mix(capc, np.array([0.40, 0.31, 0.13]), 0.85 * fatl)
    capc = _mix(capc, CLOT, 0.65 * ss(0.15, 0.6, noise.fbm(P / 2.5, 3, seed + 32)) * (1.0 - fatl))
    ringc = np.array([0.36, 0.27, 0.25]) * (0.8 + 0.25 * ss(-0.5, 0.5, noise.fbm(P / 1.5, 2, seed + 35)))[:, None]   # r17: r16 0.44 = a plastic hose
    capc = _mix(capc, ringc, trach * (1.0 - lumen))
    # r10: mostly under blood (r9 read as a clean white plastic bottle neck); r16: smeared, the rings show (r15: a dark box)
    capc = _mix(capc, np.array([0.12, 0.02, 0.02]), 0.85 * trach * ss(-0.35, 0.2, noise.fbm(P / 1.8, 2, seed + 36)))   # r17: bloodier again
    capc = _mix(capc, np.array([0.03, 0.006, 0.006]), lumen)
    capc = _mix(capc, CLOT, drip)
    alb = _mix(alb, capc, capm)
    # the skin rim: 1-4 mm above the torn edge soaked and smeared with blood; runs down the throat from it
    rim = ss(-4.5, -0.6, cutd + hs) * (1.0 - band) * (1.0 - below)
    runs = (1.0 - ss(0.6, 1.4, np.abs(noise.fbm(sh.V(1.0, 0.0, 0.0) * x[:, None] / 3.0 + 50.0, 2, seed + 37)) * 4.0)) \
        * ss(-14.0, -3.0, cutd + hs) * (1.0 - band) * ss(-60.0, -20.0, y - 40.0)
    rim = np.clip(np.maximum(rim * ss(-0.2, 0.6, noise.fbm(P / 3.0, 3, seed + 31) + 0.35), 0.0), 0, 1)
    alb = _mix(alb, CLOT * 1.4, 0.85 * rim)
    alb = _mix(alb, np.array([0.10, 0.015, 0.012]), 0.55 * runs * (1.0 - rim))
    blood = np.clip(np.maximum.reduce([rim, runs * 0.6, nose_bl, drip]), 0, 1)
    alb = _mix(alb, CLOT, lacm)
    # ---- scalp under the hair: wet dark hair colour (strand gaps show hair, not skin)
    rel = P - sh.V(0.0, 40.0, 0.0)
    ph = np.degrees(np.arctan2(np.abs(rel[:, 0]), -rel[:, 1]))
    hl = np.interp(ph, [0, 25, 45, 75, 95, 120, 180], [70, 66, 52, 8, -12, -35, -78])
    scalp = ss(hl - 1.0, hl + 5.0, z + 2.0 * noise.fbm(P / 4.0, 2, seed + 40))
    alb = _mix(alb, np.array([0.016, 0.014, 0.013]), scalp)
    # ---- creases and pores collect cistern silt: SDF occlusion along the normal (1.5 / 4 / 8 mm)
    occ = np.zeros(n)
    for k_, s_ in enumerate((1.5, 4.0, 8.0)):
        dq = face.rest(P + N * s_)
        occ += np.clip((s_ - dq) / s_, 0.0, 1.0) * (0.45, 0.35, 0.2)[k_]
    occ = np.clip(occ, 0.0, 1.0) * (1.0 - capm) * (1.0 - inner)
    silt = ss(0.15, 0.6, occ)
    alb = _mix(alb, alb * np.array([0.55, 0.52, 0.45]), 0.7 * silt)
    # ---- clamp to physical range
    alb = np.clip(alb, 0.004, 0.8)
    # ---- roughness / wetness / SSS / pores / petechiae
    rough = 0.43 + 0.08 * m2                                 # r11: macerated, damp (r9-r10 0.38 + coat = lacquer)
    rough = rough * (1 - lip) + lip * 0.58                  # chapped, macerated vermilion (0.34 = rubber; #147e 0.46 still a sheen roll)
    rough = rough * (1 - inner) + inner * 0.16
    rough = rough * (1 - mar) + mar * 0.18
    rough = rough * (1 - scar1) + scar1 * 0.22                # scar tissue: no pores, a smooth sheen
    rough = rough * (1 - capm) + capm * 0.12                 # #147e: wet glistening tissue (0.22)
    rough = np.minimum(rough, 0.25 + 0.75 * (1.0 - lacm))
    rough = rough * (1 - nose_bl) + nose_bl * (0.18 + 0.35 * crust)
    wet = 0.55 + 0.35 * ss(-0.3, 0.4, noise.fbm(P / 14.0, 3, seed + 50)) - 0.35 * ss(0.2, 0.7, noise.fbm(P / 30.0, 2, seed + 51))
    wet = np.clip(wet, 0.1, 1.0)
    wet = wet * (1.0 - 0.6 * ss(0.2, 0.7, fresh))              # bruised swollen skin: tight and dull, not glossy
    wet = np.maximum(wet * (1.0 - 0.7 * lip), np.maximum.reduce([inner, mar, lip * 0.15, capm, rim, conj]))   # #147e: lips 0.45 -> dull
    sss = np.ones(n)
    sss = sss * (1 - 0.4 * fresh) * (1 - 0.5 * scar1) * (1 - 0.5 * capm) * (1 - 0.6 * mar)   # thin lids glowed orange (r1)
    sss = sss * (1 - lip) + lip * 0.7                          # r13: bloodless lips (1.2 glowed pink under the hotspot)
    pore = (1.0 - lip) * (1.0 - inner) * (1.0 - capm) * (1.0 - scalp) * (1.0 - mar) * (1.0 - scar1)
    pore = pore * (0.6 + 0.4 * nose + 0.3 * ss(-10.0, -30.0, z) * ss(-15.0, -25.0, y))
    pet = np.zeros(n)
    for k in (0, 1):
        dd = np.linalg.norm((P - face.E[k]) / np.array([26.0, 30.0, 24.0]), axis=1)
        pet = np.maximum(pet, 1.0 - ss(0.6, 1.1, dd))
    pet = np.maximum(pet, 0.45 * ss(-30.0, 10.0, z) * ss(60.0, 30.0, z) * ss(-15.0, -22.0, y))     # forehead/cheeks
    pet = np.maximum(pet, 0.9 * (1 - ss(0.0, 0.7, fresh)) * ss(0.05, 0.4, fresh))                     # around bruises
    pet = pet * (1.0 - scalp) * (1.0 - capm)
    rough = np.clip(rough + 0.08 * silt, 0.08, 0.9)
    # #147d: wet tissue, trachea and clotted drips are glossy; the nosebleed trail has body (0.25 mm) and a wet centre
    rough = rough * (1 - drip) + drip * 0.10
    wet = np.maximum(wet, np.maximum(drip, nose_bl * (1.0 - 0.6 * nb_edge)))
    disp += 0.25 * nose_bl * (1.0 - 0.5 * nb_edge) + 0.35 * nb_bead
    disp += 0.10 * slip_e - 0.08 * slip                         # rolled epidermis edge, the raw dermis a step down
    rough = rough * (1 - slip) + slip * 0.30
    wet = np.maximum(wet, 0.7 * slip)
    # ---- #147d micro-relief regions for the shader (scare_scene.skin_material): fine wrinkle line families along
    #      Langer's lines — H horizontal (forehead, nasion, lower lids, neck), V vertical (vermilion, upper-lip skin,
    #      glabella), C radial about each lateral canthus (crow's feet), D oblique down-lateral (cheeks, parallel to the
    #      nasolabial fold); weights sum <= 1. pbig = the coarse-pore regions (nose, medial cheeks, chin).
    ax = np.abs(x)
    w_v = np.maximum.reduce([lip, (1.0 - ss(14.0, 22.0, ax)) * ss(-58.0, -54.0, z) * (1.0 - ss(-46.0, -41.0, z)) * front * 0.85,
                             (1.0 - ss(6.0, 11.0, ax)) * ss(8.0, 13.0, z) * (1.0 - ss(28.0, 34.0, z)) * front * 0.7])
    w_c = np.zeros(n)
    w_hl = np.zeros(n)
    for k in (0, 1):
        sgn = 1.0 if k == 0 else -1.0
        lc = face.E[k] + sh.V(sgn * 14.0, -2.0, 0.6)
        rr = np.sqrt((x - lc[0]) ** 2 + (z - lc[2]) ** 2)
        w_c = np.maximum(w_c, ss(2.5, 5.5, rr) * (1.0 - ss(17.0, 26.0, rr)) * ss(-3.0, 2.0, sgn * (x - lc[0])) * (np.abs(y - lc[1]) < 25.0))
        v_, r_, az_, el_ = face.eye_local(P, k)
        up_, lo_ = sh.margins(az_, k)
        w_hl = np.maximum(w_hl, ss(-2.0, -5.0, el_ - lo_) * (1.0 - ss(0.65, 1.0, np.linalg.norm((P - face.E[k]) / np.array([22.0, 30.0, 18.0]), axis=1))))
    w_h = np.maximum.reduce([ss(22.0, 30.0, z) * front, ss(-100.0, -110.0, z) * (1.0 - capm),
                             (1.0 - ss(8.0, 12.0, ax)) * ss(-2.0, 3.0, z) * (1.0 - ss(8.0, 13.0, z)) * front * 0.6, 0.8 * w_hl])
    w_d = ss(14.0, 22.0, ax) * ss(-80.0, -70.0, z) * (1.0 - ss(-20.0, -10.0, z)) * (1.0 - lip) * (1.0 - w_c)
    tot = w_h + w_v + w_c + w_d
    sc_ = np.where(tot > 1.0, 1.0 / np.maximum(tot, 1e-9), 1.0)
    w_h, w_v, w_c, w_d = (w * sc_ * (1.0 - capm) * (1.0 - inner) for w in (w_h, w_v, w_c, w_d))
    pbig = np.maximum.reduce([nose, 0.8 * ss(10.0, 16.0, ax) * (1.0 - ss(30.0, 40.0, ax)) * ss(-50.0, -44.0, z) * (1.0 - ss(-18.0, -10.0, z)),
                              0.7 * (1.0 - ss(12.0, 20.0, ax)) * ss(-104.0, -98.0, z) * (1.0 - ss(-84.0, -78.0, z))]) * front * (1.0 - lip)
    return dict(bru=np.clip(np.maximum(fresh, 0.7 * np.clip(old1 + old2 + old3 + old4, 0, 1)), 0, 1), alb=alb, rough=np.clip(rough, 0.08, 0.9), wet=np.clip(wet, 0, 1), sss=np.clip(sss, 0.3, 1.5), pore=np.clip(pore, 0, 1),
                pet=np.clip(pet, 0, 1), lip=np.clip(lip, 0, 1), muc=np.clip(inner, 0, 1), cap=np.clip(capm, 0, 1),
                blood=np.clip(np.maximum.reduce([blood, lacm, rim]), 0, 1), disp=disp, scalp=scalp, mar=mar, conj=conj,
                w_h=w_h, w_v=w_v, w_c=w_c, w_d=w_d, pbig=np.clip(pbig, 0, 1), scar=np.clip(scar1, 0, 1))
