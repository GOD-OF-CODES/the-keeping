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
CYAN_LIP = np.array([0.080, 0.068, 0.098])   # #147h r32: 0.062/0.058/0.084 read as black rubber off the core      # r12: cyanotic blue-grey; #147f r21 darker (0.10: the vermilion under the core read as pale as the skin)
MUCOSA = np.array([0.16, 0.058, 0.064])   # #147h r33: dead, deoxygenated (0.25/0.07/0.08 lit as a red puppet mouth); #147j 0.13 -> 0.16 (the interior only gets bounce: r35 9/255)
GUM = np.array([0.17, 0.075, 0.08])
TONGUE = np.array([0.17, 0.095, 0.12])     # cyanotic; #147j 0.13 -> 0.17 + a grey-white coated dorsum (below)
FRESH_CORE = np.array([0.045, 0.03, 0.055])     # r6: blue-black core
FRESH_RIM = np.array([0.15, 0.07, 0.11])        # r6: dull plum, not magenta
OLD_YG = np.array([0.36, 0.34, 0.14])
OLD_BROWN = np.array([0.24, 0.17, 0.10])
SCAR = np.array([0.50, 0.43, 0.42])     # r3: paler, pinker than the grey skin so it reads under 2900 K
CLOT = np.array([0.035, 0.0045, 0.004])     # #147f r22: 0.06/0.008 + skin SSS read as orange candle wax at +4 EV
MARBLE = np.array([0.05, 0.065, 0.075])
# #147h: the grip fingertips (rest x, z mm; her right = -x) in the torch-lit cheek, an arc from beside the mouth corner
# up toward the cheekbone (index .. little), and the thumb on her left cheek
GRIP_XZ = [(-22.0, -51.0), (-33.0, -49.0), (-41.0, -43.0), (-46.0, -34.0)]
THUMB_XZ = (31.0, -46.0)


def _mix(a, b, t):
    t = np.clip(np.asarray(t, float), 0.0, 1.0)
    return a + (np.asarray(b, float) - a) * t[..., None]


def _mix1(a, b, t):
    t = np.clip(np.asarray(t, float), 0.0, 1.0)
    return a + (b - a) * t


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
    lo = -61.8 - 9.6 * np.power(1 - u * u, 0.7) - 0.6 * ss(4.0, 12.0, -x) * ss(18.0, 12.0, -x)   # swollen RIGHT half (#147f r23)
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
    alb = alb * (1.0 + np.stack([0.10 * hue1 + 0.025 * hue2, -0.02 * hue1 + 0.03 * hue2, -0.10 * hue1 - 0.015 * hue2], 1))   # #147h: 5 mm hue halved (r30: pastel terrazzo)
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
    # #147f r22: the nostril interiors (vestibules) are dark — r1-r21 shaded them like the congested nose skin, and the
    # torch from below lit them into two pink-red slits under the tip
    nos = np.zeros(n)
    for s_ in (1.0, -1.0):
        q1 = np.linalg.norm((P - sh.V(s_ * 7.2, -34.6, -36.0)) / np.array([3.0, 4.2, 3.0]), axis=1)
        q2 = np.linalg.norm((P - sh.V(s_ * 6.9, -35.2, -39.4)) / np.array([2.6, 4.4, 2.0]), axis=1)
        nos = np.maximum(nos, 1.0 - ss(0.75, 1.2, np.minimum(q1, q2)))
    alb = _mix(alb, np.array([0.045, 0.026, 0.024]), 0.85 * nos)
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
        cc = face.E[k] + sh.V(-s * 14.6, -3.3, -1.0)                 # #147j: the new mound
        caru = np.maximum(caru, 1.0 - ss(1.9, 3.0, np.linalg.norm((P - cc) / np.array([1.15, 1.0, 1.0]), axis=1)))
        pdp, _ = poly_dist(P, face.plica_pts(k))
        caru = np.maximum(caru, 0.8 * (1.0 - ss(0.6, 1.0, pdp)))
        dd = np.linalg.norm((P - face.E[k]) / np.array([24.0, 30.0, 20.0]), axis=1)
        peri = np.maximum(peri, 1.0 - ss(0.55, 1.05, dd))
    alb = _mix(alb, np.array([0.16, 0.095, 0.14]), 0.70 * peri * (0.8 + 0.2 * m2))
    alb = _mix(alb, alb * np.array([1.05, 0.82, 0.82]), 0.45 * mar)    # #147d: a tint; the wet posterior edge is shaded
    alb = _mix(alb, np.array([0.15, 0.085, 0.088]) * (0.8 + 0.4 * ss(-0.3, 0.3, noise.fbm(P / 0.5, 2, seed + 68)))[:, None], caru)   # r10: duller flesh-pink; #147j grey-pink, mottled (x alb_gain ~0.25/0.13/0.12)
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
    alb = _mix(alb, alb * 1.16, 0.6 * roll)                           # r11: no lip-gloss white roll; #147j a paler white roll (the bow line)
    # ---- oral cavity: mucosa, gums, tongue (rest space: inside the cavity envelope)
    cav = face.cavity(P, grow=0.5)                                                                      # = scare_head cavity
    muc = (1.0 - ss(-0.5, 2.5, cav)) * ss(-34.0, -29.0, y)
    tongue = 1.0 - ss(0.0, 1.2, sh.ell(P, sh.V(*sh.TONGUE_C), sh.TONGUE_R) + 0.35 * noise.fbm(P / 3.0, 2, 1976 + 60))
    gum = np.zeros(n)
    for (y0, kk), zz in ((face.arch_up, -50.0), (face.arch_lo, -72.0)):
        dd = np.abs(y - (y0 + kk * x * x + 2.0))
        gum = np.maximum(gum, (1.0 - ss(3.0, 5.0, dd)) * (1.0 - ss(3.0, 5.5, np.abs(z - zz))) * ss(25.0, 22.0, np.abs(x)))
    inner = np.clip(muc, 0, 1)
    alb = _mix(alb, MUCOSA * (1.0 + 0.2 * m2)[:, None], inner)
    alb = _mix(alb, GUM, gum * inner)
    alb = _mix(alb, TONGUE * (1.0 + 0.25 * noise.fbm(P / 3.0, 2, seed + 9))[:, None], tongue * inner)
    # #147j: a dead tongue's dorsum carries a patchy grey-white coat (desquamated epithelium) and darker cyanotic
    # margins, papillae speckle at 1 mm — not one flat colour
    tcoat = ss(-0.05, 0.35, noise.fbm(P / 4.0, 3, seed + 66)) * ss(-4.0, 2.0, y) * tongue * inner
    alb = _mix(alb, np.array([0.30, 0.26, 0.27]) * (0.85 + 0.3 * ss(-0.3, 0.3, noise.fbm(P / 0.9, 2, seed + 67)))[:, None], 0.6 * tcoat)
    # the everted lower lip: its rolled-out wet inner face (the top 1.6 mm under the drooped free edge) is mucosa, not
    # cyanotic vermilion
    st_l, _lo_l = sh.lower_lines(x)
    evm = (1.0 - ss(0.6, 1.8, st_l - z)) * (z < st_l + 0.6) * ss(-20.0, -26.0, y) * (np.abs(x) < 22.0)
    # #147j r37 (AD r3: cyanotic, not living red): r36's 0.15/0.052/0.07 (x alb_gain = 0.255/0.08/0.095, 3:1 red) read as a
    # saturated red crescent = a clown / latex lip. Dead venous mucosa is dusky purple-grey: 0.10/0.056/0.076, weight 0.75
    alb = _mix(alb, np.array([0.10, 0.056, 0.076]) * (0.88 + 0.24 * ss(-0.3, 0.3, m3))[:, None], 0.75 * evm)
    # ---- the split lower lip: laceration (clotted red-black) + swollen bruised half
    lac, _ = poly_dist(P, sh.LACERATION)
    lacm = 1.0 - ss(0.9, 2.1, lac)          # #147h r32: wider (r31: 9/255, a hairline in shadow)
    swell = blob(P, sh.V(-9.0, -32.4, -67.0), (9.0, 6.0, 6.0), 3, 0.25)          # #147f r23: her right (the lit side); #147j on the drooped lip
    alb = _mix(alb, np.array([0.115, 0.048, 0.088]), 0.55 * swell * lip)            # #147j r37: violet bruise (r36 0.16/0.05/0.08 red)
    alb = _mix(alb, CLOT, lacm)
    # ---- epistaxis: a trickle from her right nostril over the upper lip to the vermilion (frontal x-z path)
    # #147f: blood on a WET face. r8-r19 drew one even-width red stripe with crisp edges = paint. Now: a clotted core of
    # VARYING width (0.5-2.4 mm, lumpy edges), darker where thick, a dried near-black rim; a diluted pink-red wash
    # spreading 2-6 mm into the water film (blotchy, smeared toward her right cheek); a thin second rivulet into the
    # philtrum; a clot plug at the nostril; the bead at the lip.
    path = [(-6.8, -39.5), (-7.6, -42.5), (-7.0, -45.5), (-8.1, -48.5), (-7.4, -51.5), (-8.3, -54.0), (-8.0, -56.5)]
    xz = np.stack([x, np.zeros(n), z], 1)
    dn, tn = poly_dist(xz, [sh.V(a, 0.0, b) for a, b in path])
    wn = np.clip(0.85 + 0.45 * tn + 0.9 * np.maximum(noise.fbm(P / 3.5, 2, seed + 70), 0.0) + 0.35 * noise.fbm(P / 1.0, 2, seed + 72), 0.5, 2.4)
    dn2, _ = poly_dist(xz, [sh.V(a, 0.0, b) for a, b in ((-7.4, -50.5), (-5.6, -52.5), (-4.4, -55.0))])   # philtrum rivulet
    gate_y = ss(-20.0, -26.0, y)
    core1 = 1.0 - ss(wn * 0.75, wn, dn)
    core2 = 1.0 - ss(0.35, 0.65, dn2 + 0.15 * noise.fbm(P / 1.2, 2, seed + 73))
    plug = 1.0 - ss(1.4, 2.4, np.linalg.norm((P - sh.V(-6.9, -36.5, -38.8)) * np.array([1.0, 0.8, 1.2]), axis=1))
    nose_bl = np.maximum.reduce([core1, 0.85 * core2, plug]) * gate_y
    crust = nose_bl * ss(0.0, 0.5, noise.fbm(P / 1.3, 2, seed + 71) + 0.3)
    nb_edge = core1 * gate_y * ss(0.55, 0.9, dn / np.maximum(wn, 1e-3))                      # dried rim (coffee ring)
    bead_c = sh.V(-8.1, -33.6, -57.2)
    nb_bead = 1.0 - ss(1.0, 1.9, np.linalg.norm((P - bead_c) * np.array([1.0, 1.0, 0.8]), axis=1))
    nose_bl = np.maximum(nose_bl, nb_bead)
    blot = ss(-0.3, 0.4, noise.fbm(P / 3.0, 3, seed + 74))
    smear = np.exp(-(((x + 13.0) / 6.0) ** 2 + ((z + 49.0) / 7.0) ** 2))                     # toward her right cheek
    wash = (1.0 - ss(wn, wn + 2.0 + 4.0 * blot, dn)) * (1.0 - nose_bl) * gate_y
    wash = np.clip(np.maximum(wash, 0.7 * smear * blot * gate_y), 0.0, 1.0)
    alb = _mix(alb, alb * np.array([1.06, 0.70, 0.72]), 0.65 * wash)                         # diluted blood in the film
    thick = ss(0.3, 1.0, wn - dn)                                                            # darker where the trail is thick
    alb = _mix(alb, np.array([0.10, 0.016, 0.013]) * (1.0 - 0.35 * thick)[:, None], 0.93 * nose_bl)
    alb = _mix(alb, np.array([0.032, 0.008, 0.007]), 0.8 * nb_edge)
    alb = _mix(alb, np.array([0.05, 0.02, 0.015]), 0.4 * crust)
    lacm = np.maximum(lacm, 0.0)
    # ---- strangulation: Harlan's RIGHT hand from the front -> thumb on HER RIGHT jaw angle, fingers on HER LEFT
    #      mandible border; the throat band above the cut; layered over OLD yellow-green bruises
    # #147d: Harlan's LEFT hand from the front: the 4 fingertips in a row along HER RIGHT mandible border (the side the
    # torch lights in the mirrored hero pose — the AD could not find them at -5..-7 EV on her left), thumb on her left
    # #147f r23: 10-13 mm higher and ~5 deg forward — the fingers of a hand gripping the face wrap onto the mandible BODY,
    # not only its lower border (r22: fingertips -3.8 EV under the jaw's overhang, unreadable)
    # #147h (ruling au: the horror ON the face, IN the light): the hand that held her face under the cistern water —
    # palm over her mouth, the four fingertips spread in an arc across HER RIGHT cheek (the torch side), from beside the
    # mouth corner up toward the cheekbone; the thumb on her left cheek. r23-r30 put them on the mandible under the
    # jaw's overhang: display 1-2/255 at viewing exposure (k/marks.py on look-r30). GRIP_XZ = rest (x, z) mm.
    tips = np.array([sh.V(x_, float(face.surface_y(x_, z_)[0]) + 1.0, z_) for x_, z_ in GRIP_XZ])
    fing = np.zeros(n)
    halo = np.zeros(n)
    nail = np.zeros(n)
    for i in range(4):
        c = tips[i]
        rr = 6.3 - 0.35 * i
        # #147g (AD r2: "tar ovals"): smudges, not discs — elongated along the finger pad, ragged, partly confluent
        fing = np.maximum(fing, blob(P, c, (rr * 1.05, rr * 1.2, rr * 1.45), 10 + i, 0.45))   # r29: 0.65 wobble = flame shapes
        # #147h: the 2-3-day yellow-green halo the haemoglobin breakdown spreads 3-6 mm round the purple core
        halo = np.maximum(halo, blob(P, c, (rr * 1.75, rr * 1.9, rr * 2.1), 40 + i, 0.5))
        # crescent fingernail abrasion at the leading (upper-front) edge
        cn = c + sh.V(0.0, -3.0, 6.0)
        dn = np.abs(np.linalg.norm((P - cn) / np.array([2.4, 2.4, 2.4]), axis=1) - 1.0)
        nail = np.maximum(nail, (1.0 - ss(0.0, 0.3, dn)) * ss(cn[2] - 0.5, cn[2] + 1.2, z) * (np.linalg.norm(P - cn, axis=1) < 3.4))   # #147h r32: 3.2 -> 2.4 mm
    thumb = blob(P, sh.V(THUMB_XZ[0], float(face.surface_y(THUMB_XZ[0], THUMB_XZ[1])[0]) + 1.0, THUMB_XZ[1]), (10.0, 12.0, 12.0), 20, 0.4)   # her left
    halo = np.maximum(halo, 0.8 * thumb)
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
    # #147h (ruling au: "yellow-green edge, purple core"): the 2-3-day grip marks — a yellow-green TINT of the skin (pores
    # and mottle show through) spreading 3-6 mm round each pad, a red-violet rim, a mottled purple core. The FRESH_RIM
    # plum wash now covers only the shiner and the throat band (at 0.9 it flattened the fingertips into plum discs).
    grip = np.clip(np.maximum.reduce([fing, thumb, band * 0.85]), 0, 1)
    hal = ss(0.0, 0.7, halo) * (1.0 - ss(0.25, 0.75, grip)) * (0.7 + 0.3 * ss(-0.3, 0.4, noise.fbm(P / 2.5, 2, seed + 16)))
    alb = _mix(alb, alb * np.array([1.08, 1.10, 0.62]), 0.85 * hal)
    alb = _mix(alb, FRESH_RIM, ss(0.0, 0.45, np.maximum(band * 0.85, 0.8 * shiner)) * 0.9)
    alb = _mix(alb, FRESH_CORE, ss(0.35, 0.95, 0.8 * shiner) * mot)
    # #147g: lighter red-violet rim spreading 3-5 mm, a mottled core that never fills the whole smudge (r24's 0.085
    # core next to 0.18 skin at -3 EV read as round black holes / tar ovals)
    mot2 = 0.45 + 0.55 * ss(-0.35, 0.45, noise.fbm(P / 1.6, 3, seed + 15))
    # #147h r32: r31's rim 0.14/0.065/0.115 x 0.65 + 0.20/0.06/0.05 nail dabs read as lipstick / paint smudges at 100 %:
    # a duller, darker violet-brown rim, a blue-purple core, small dark-brown nail abrasions
    alb = _mix(alb, np.array([0.115, 0.07, 0.095]), ss(0.0, 0.55, grip) * 0.55)      # violet-brown rim
    alb = _mix(alb, np.array([0.065, 0.035, 0.075]), ss(0.4, 1.0, grip) * mot2 * 0.85)  # blue-purple core
    alb = _mix(alb, np.array([0.11, 0.045, 0.035]), 0.7 * nail)
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
    # #147g: moist raw dermis (0.40/0.27/0.27 read as a pink paint blotch) and a macerated whitish-grey epidermis roll
    # RELATIVE to the skin (0.47 absolute read as a chalk ring)
    alb = _mix(alb, np.array([0.28, 0.15, 0.14]) * (0.9 + 0.2 * m3)[:, None], 0.8 * slip)
    alb = _mix(alb, np.clip(alb * np.array([1.25, 1.22, 1.16]), 0, 0.6), 0.7 * slip_e)
    # ---- old scars: her RIGHT brow (raised, pale, ridged, suture dots) + her LEFT cheekbone crescent (depressed)
    disp = np.zeros(n)
    disp += 0.6 * ss(0.2, 1.0, fing) + 0.5 * ss(0.2, 1.0, thumb)      # #147h: the bruised finger pads swell (oedema)
    sA, sB = sh.V(-21.0, -24.0, 27.0), sh.V(-33.0, -17.0, 10.0)
    ds, st = seg_dist(P * np.array([1, 0.35, 1]), sA * np.array([1, 0.35, 1]), sB * np.array([1, 0.35, 1]))
    ds = ds + 0.25 * noise.fbm(P / 2.0, 2, seed + 20)
    # #147d: wider (2.6 mm), a pale shiny ridge with a darker hyperpigmented border, so it reads at 0.13 mm/px
    ds = ds * (1.0 + 0.25 * noise.fbm(P / 5.0, 2, seed + 21))
    scar1 = (1.0 - ss(0.75, 1.35, ds)) * front
    sedge = (1.0 - ss(1.3, 2.3, ds)) * (1.0 - scar1) * front
    alb = _mix(alb, alb * np.array([0.72, 0.66, 0.68]), 0.7 * sedge)
    # #147g: the scars are visible for the first time (front-gate bug, STATUS 147g) and the absolute SCAR 0.50/0.43/0.42
    # read as CHALK on 0.2-0.25 skin: an old scar is a little paler / pinker-grey than its skin and shiny (no pores)
    scar_c = np.clip(alb * np.array([1.42, 1.30, 1.28]) + np.array([0.012, 0.0, 0.004]), 0.0, 0.6)   # #147h r32: x1.24 was invisible at 28-100/255
    alb = _mix(alb, scar_c * (1.0 + 0.06 * m2)[:, None], scar1 * 0.85)
    disp += 0.60 * scar1 * (1.0 - ss(0.0, 1.2, ds))            # #147j (AD round 3, rank 3): 0.36 -> 0.6 mm ridge
    # #147j: puckering at both scar ends — 3 short radiating stretch creases (3 mm, ~0.8 mm wide, 0.15 mm deep)
    puck = np.zeros(n)
    for end, sgn_ in ((sA, -1.0), (sB, 1.0)):
        ax_s = (sB - sA) / np.linalg.norm(sB - sA) * sgn_
        for ang_ in (-35.0, 0.0, 35.0):
            ca_, sa_ = math.cos(math.radians(ang_)), math.sin(math.radians(ang_))
            dv = np.array([ax_s[0] * ca_ - ax_s[2] * sa_, 0.0, ax_s[0] * sa_ + ax_s[2] * ca_])
            pd_, pt_ = seg_dist(P * np.array([1, 0.35, 1]), (end + dv * 1.0) * np.array([1, 0.35, 1]), (end + dv * 4.0) * np.array([1, 0.35, 1]))
            puck = np.maximum(puck, (1.0 - ss(0.25, 0.55, pd_)) * (1.0 - 0.6 * pt_) * front)
    disp -= 0.15 * puck
    for j in range(4):           # suture marks, 4 mm apart, either side
        for sgn in (1.0, -1.0):
            t = (j + 0.5) / 4.0
            c = sA + (sB - sA) * t
            perp = np.array([-(sB - sA)[2], 0.0, (sB - sA)[0]])
            perp = perp / np.linalg.norm(perp) * 2.6 * sgn
            dd = np.linalg.norm((P - (c + perp)) * np.array([1, 0.35, 1]), axis=1)
            sm = (1.0 - ss(0.45, 0.85, dd)) * front
            alb = _mix(alb, np.clip(alb * np.array([1.2, 1.1, 1.1]), 0, 0.6), 0.6 * sm)
            disp += 0.12 * sm
    # #147h: a real CRESCENT (spec: r 15, arc 25 mm ~ 95 deg) on the cheekbone under her right lateral canthus, in the
    # torch's core skirt. r3-r30: a ~260 deg ring round (-31, -24) whose lower half sank into the old cheek bruise.
    cx_, cz_ = -39.0, -13.0
    cc = sh.V(cx_, float(face.surface_y(cx_, cz_)[0]), cz_)
    q = P - cc
    rho = np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2)
    phi = np.degrees(np.arctan2(q[:, 2], q[:, 0]))
    arcw = np.abs(rho - 13.0) * (1.0 + 0.3 * noise.fbm(P / 4.0, 2, seed + 22))
    dphi = np.abs((phi + 90.0 + 180.0) % 360.0 - 180.0)                 # from straight down (a smile-shaped arc)
    arcm = ss(52.0, 40.0, dphi) * front * (np.abs(q[:, 1]) < 14.0)
    arc = (1.0 - ss(0.7, 1.3, arcw)) * arcm                                   # #147h r32: ~2.6 mm wide (r31 invisible)
    arce = (1.0 - ss(1.3, 2.4, arcw)) * (1.0 - arc) * arcm
    alb = _mix(alb, alb * np.array([0.72, 0.66, 0.68]), 0.7 * arce)
    alb = _mix(alb, np.clip(alb * np.array([1.45, 1.32, 1.30]), 0, 0.6), 0.85 * arc)
    disp += 0.45 * arc * (1.0 - ss(0.2, 1.3, arcw))            # #147j: a raised shiny ridge (r31-r35 depressed 0.24: lit but invisible)
    # #147j r37 (AD round 3, rank 3: "the brows are absent at frame scale"): r36's 557 brow strands are 64-96 um = sub-
    # pixel grey at ~10 px/mm, on undarkened skin. Real brow skin is darker under the hairs (follicle pigment + the
    # root shadow of the slicked mat): x0.6 in a band along scare_hair.brows' root line (same zc(u) / width), so the
    # brow reads as a dark band and the scar crossing it as a pale hairless break (x (1 - scar))
    bu = np.clip((np.abs(x) - 15.0) / 34.0, 0.0, 1.0)
    bzc = 13.5 + 6.0 * np.sin(bu * math.pi * 0.85) - 2.5 * bu
    bw = 1.3 * (2.6 - 1.4 * bu) * (1.0 + 0.25 * noise.fbm(P / 3.0, 2, seed + 24))
    bm = np.exp(-((z - bzc) / bw) ** 2) * ss(12.0, 16.0, np.abs(x)) * (1.0 - ss(46.0, 52.0, np.abs(x))) * front
    # (147j post-r37: the exclusion matches scare_hair's 3.8 mm hair gap (dd > 1.9), not the 2.6 mm scar: r37 darkened the
    #  bare skin either side of the scar and the pale gap fell 13 -> 7-9 /255)
    alb = _mix(alb, alb * np.array([0.60, 0.58, 0.62]), 0.85 * bm * ss(1.6, 2.2, ds) * (1.0 - 0.7 * sedge))
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
    # ---- the cut (#147g rebuild, AD round 2 rank 1): a cleaver CHOP face carrying the neck's SECTION ANATOMY
    #      (scare_head.Face.section, the same masks that shape the relief), the skin retracted 5-10 mm over a band of
    #      yellow lobulated fat, a 2-4 mm abraded / contused skin border, currant-jelly clots pooled in the recesses
    #      (matte to glossy), three fibrin strings. r9-r24: a dark red band + an even fringe of drips = "candle wax".
    cutp = face.cut_plane(P)
    hs = face.skin_line(P)
    band = face.tissue_band(P, cutp)
    near = cutp > -25.0
    sec = {k: np.zeros(n) for k in ('fat', 'muscle', 'bone', 'cancel', 'cartilage', 'membrane', 'oeso', 'artery', 'vein',
                                     'thyroid', 'canal', 'cord', 'grey', 'dura', 'rel')}
    cutd = cutp.copy()
    if near.any():
        S_ = face.section(P[near])
        for k_ in sec:
            sec[k_][near] = np.clip(S_[k_], -5.0, 5.0) if k_ == 'rel' else np.clip(S_[k_], 0.0, 1.0)
        cutd[near] = face.cut_dist(P[near], S_)
    sec['fat'] = np.where(near, sec['fat'], 1.0)
    below = ss(-0.3, 0.3, cutd)
    strings = np.zeros(n)
    for i_ in range(len(face.STRINGS)):
        pts_, rads_, ln_ = face.string_pts(i_)
        dd_, _ = poly_dist(P, pts_ + [pts_[-1] + sh.V(0.0, 0.0, -0.5)])
        strings = np.maximum(strings, 1.0 - ss(1.5, 2.6 + 0.03 * ln_, dd_))
    capm = np.clip(np.maximum.reduce([band, below, strings]), 0, 1)
    holes = face.holes(P) if near.any() else np.full(n, 1e3)
    inhole = (1.0 - ss(0.2, 0.8, holes)) * near                         # lumen walls / floors
    n1 = noise.fbm(P / 1.1, 2, seed + 33)
    n2 = noise.fbm(P / 0.55, 2, seed + 34)
    lob = ss(-0.25, 0.35, noise.fbm(P / 1.4, 3, seed + 35))             # fat lobules 1-2 mm with paler septa
    fatc = np.array([0.50, 0.40, 0.20]) * (0.86 + 0.24 * lob)[:, None]
    fatc = _mix(fatc, np.array([0.58, 0.50, 0.36]), 0.35 * (1.0 - ss(0.0, 0.12, np.abs(noise.fbm(P / 1.4, 3, seed + 35)))))
    # r30: deoxygenated dark muscle (r29's 0.22/0.036/0.032 under the 2900 K torch read as salmon-pink HAM)
    musc = np.array([0.13, 0.024, 0.022]) * (0.78 + 0.22 * ss(-0.4, 0.4, n1) + 0.18 * ss(-0.3, 0.3, n2))[:, None]
    peri = 1.0 - ss(0.0, 0.07, np.abs(noise.fbm(P * np.array([1 / 0.7, 1 / 0.7, 1 / 3.0]), 2, seed + 36)))   # perimysium streaks
    musc = _mix(musc, np.array([0.20, 0.10, 0.09]), 0.25 * peri)
    trab = ss(-0.05, 0.25, noise.fbm(P / 0.45, 2, seed + 37))           # cancellous: marrow red between pale trabeculae
    bonec = np.array([0.56, 0.51, 0.43]) * (0.92 + 0.12 * n1)[:, None]
    canc = _mix(np.array([0.30, 0.10, 0.075]), np.array([0.50, 0.42, 0.32]), trab)
    cartc = np.array([0.40, 0.34, 0.31]) * (0.9 + 0.15 * n1)[:, None]          # r27: 0.53 grey-white = PVC
    capc = fatc
    for k_, col in (('muscle', musc), ('thyroid', np.array([0.20, 0.05, 0.045])), ('oeso', np.array([0.27, 0.08, 0.07])),
                    ('membrane', np.array([0.30, 0.12, 0.12])), ('cartilage', cartc), ('vein', np.array([0.06, 0.008, 0.008])),
                    ('artery', np.array([0.30, 0.14, 0.13])), ('bone', bonec), ('canal', np.array([0.42, 0.33, 0.16])),
                    ('dura', np.array([0.60, 0.57, 0.52])), ('cord', np.array([0.58, 0.55, 0.50])), ('grey', np.array([0.38, 0.30, 0.29]))):
        capc = _mix(capc, col, sec[k_])
    capc = _mix(capc, canc, sec['cancel'])
    capc = _mix(capc, np.array([0.24, 0.085, 0.08]), 0.9 * inhole)      # mucosa / clot inside the lumens
    # blood: clotted currant jelly pooled in the recesses (notches, the ledge, round the lumens) + smeared, not a wash
    rec = ss(1.6, 3.2, sec['rel'] + np.maximum(cutd - cutp - sec['rel'], 0.0))
    smear = ss(-0.08, 0.32, noise.fbm(P / 3.2, 3, seed + 38)) * (1.0 - 0.5 * sec['bone'] - 0.2 * sec['cartilage'])   # ~55 % covered
    clotm = np.clip(np.maximum.reduce([0.85 * rec, 0.75 * smear, 0.8 * inhole * ss(0.4, 1.0, n1 + 0.6)]), 0, 1) * (1.0 - band * (1.0 - below))
    clotc = np.array([0.055, 0.007, 0.006]) * (0.5 + 0.5 * ss(-0.4, 0.4, n1))[:, None]              # r30: darker currant jelly
    clotc = _mix(clotc, np.array([0.09, 0.012, 0.010]), 0.4 * ss(0.1, 0.5, noise.fbm(P / 1.8, 2, seed + 29)))   # fresher, redder pools
    capc = _mix(capc, clotc, clotm)
    # the band (outer side, skin retracted): fat, a platysma sheet in patches, smeared blood runs
    platy = ss(0.05, 0.4, noise.fbm(P / np.array([4.0, 4.0, 1.5]), 2, seed + 39)) * band * (1.0 - below)
    capc = _mix(capc, musc, 0.6 * platy)
    # r27: the clean cream fat band read as a cake layer: blood-soaked fat, runs of clot down it (~65 % covered)
    bandx = band * (1.0 - below)
    capc = _mix(capc, np.array([0.34, 0.20, 0.10]) * (0.85 + 0.3 * lob)[:, None], 0.55 * bandx)
    capc = _mix(capc, clotc, 0.9 * bandx * ss(-0.45, 0.05, noise.fbm(P / np.array([2.5, 2.5, 6.0]), 2, seed + 30)))   # r30: ~90 % (r29: a pie crust)
    capc = _mix(capc, np.array([0.035, 0.005, 0.004]), strings)          # r30: near-black glossy fibrin (r29: red gummy worms)
    alb = _mix(alb, capc, capm)
    # the skin border: 2-4 mm abraded (raw, crusted red-brown, matte) + contused (purple-red) above the retracted edge
    above = cutp + hs                                                   # < 0 above the skin edge (mm)
    abr = (1.0 - ss(1.2, 2.6 + 1.2 * n1, -above)) * (1.0 - band) * near        # r29: narrower (r28: a painted pink ring)
    cont = (1.0 - ss(2.0, 6.0 + 3.0 * n1, -above)) * (1.0 - band) * near
    alb = _mix(alb, np.array([0.13, 0.04, 0.05]), 0.55 * cont * ss(-0.3, 0.3, noise.fbm(P / 2.0, 2, seed + 31) + 0.2))
    alb = _mix(alb, np.array([0.14, 0.04, 0.03]) * (0.7 + 0.3 * ss(-0.3, 0.3, n2))[:, None], 0.85 * abr)
    runs = (1.0 - ss(0.6, 1.4, np.abs(noise.fbm(sh.V(1.0, 0.0, 0.0) * x[:, None] / 3.0 + 50.0, 2, seed + 37)) * 4.0)) \
        * ss(-14.0, -3.0, above) * (1.0 - band) * ss(-60.0, -20.0, y - 40.0) * near
    rim = abr
    alb = _mix(alb, np.array([0.10, 0.015, 0.012]), 0.5 * runs * (1.0 - abr))
    drip = strings
    blood = np.clip(np.maximum.reduce([0.6 * clotm * capm, runs * 0.6, nose_bl, strings]), 0, 1)
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
    # #147j r37: 0.58 -> 0.80: a dead, dried vermilion is matte desquamated keratin (scare_scene also cuts its base
    # specular level, SKIN['lip_spec']). Measured r36 -> r37: the frame-scale lip means moved <= 3/255 (the sheen was NOT
    # what made the lip read pale); the visible gain is the 100 % surface (cracks + peeling flakes, scare_scene)
    rough = rough * (1 - lip) + lip * 0.80
    rough = rough * (1 - inner) + inner * 0.16
    rough = _mix1(rough, 0.25, tongue * inner)                 # #147j: the wet tongue (AD: roughness 0.25)
    rough = _mix1(rough, 0.15, caru)                           # #147j: wet caruncle
    rough = _mix1(rough, 0.28, 0.9 * evm)                      # #147j r37: dead everted mucosa wet but not glassy (r36 0.15)
    rough = rough * (1 - mar) + mar * 0.18
    rough = rough * (1 - scar1) + scar1 * 0.15                # scar tissue: no pores, a smooth sheen (#147j 0.22 -> 0.15: read by its highlight)
    rough = rough * (1 - capm) + capm * 0.12                 # #147e: wet glistening tissue (0.22)
    # #147g: bone / cartilage duller, fat greasy, clots from glossy jelly (0.06) to a matte drying skin (0.45); the
    # abraded border matte and crusted
    rough = _mix1(rough, 0.32, capm * (sec['bone'] + 0.6 * sec['cartilage']))
    rough = _mix1(rough, 0.06 + 0.40 * ss(-0.2, 0.4, n2), capm * clotm)
    rough = _mix1(rough, 0.55, 0.8 * abr)
    rough = np.minimum(rough, 0.25 + 0.75 * (1.0 - lacm))
    rough = rough * (1 - nose_bl) + nose_bl * (0.18 + 0.35 * crust)
    wet = 0.55 + 0.35 * ss(-0.3, 0.4, noise.fbm(P / 14.0, 3, seed + 50)) - 0.35 * ss(0.2, 0.7, noise.fbm(P / 30.0, 2, seed + 51))
    wet = np.clip(wet, 0.1, 1.0)
    wet = wet * (1.0 - 0.6 * ss(0.2, 0.7, fresh))              # bruised swollen skin: tight and dull, not glossy
    wet = np.maximum(wet * (1.0 - 0.7 * lip), np.maximum.reduce([inner, mar, lip * 0.15, capm, conj, caru, evm]))   # #147e: lips 0.45 -> dull
    # #147g: the coat weight on the cut follows `wet` (scare_scene: cw = max(.., tissue x wet)): clots from glossy jelly
    # to a matte drying skin, the abraded border dull
    wet = wet * (1.0 - capm * clotm * ss(0.0, 0.5, n2 + 0.1) * 0.75) * (1.0 - 0.7 * abr)
    sss = np.ones(n)
    sss = sss * (1 - 0.4 * fresh) * (1 - 0.5 * scar1) * (1 - 0.95 * capm * (1.0 - 0.35 * sec['fat'])) * (1 - 0.6 * mar)   # #147g: fat keeps a little
    sss = sss * (1.0 - 0.9 * np.maximum(drip, nose_bl))     # #147f r22: clots are opaque (skin SSS = the wax glow)
    sss = sss * (1 - lip) + lip * 0.4                          # r13: bloodless lips (1.2 glowed pink); #147j r37 0.7 -> 0.4 (the skin's glow bled across the border)
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
    rough = rough * (1 - drip) + drip * (0.08 + 0.25 * ss(-0.3, 0.3, n1))
    wet = np.maximum(wet, np.maximum(drip, nose_bl * (1.0 - 0.6 * nb_edge)))
    disp += 0.25 * nose_bl * (1.0 - 0.5 * nb_edge) * (0.6 + 0.4 * thick) + 0.35 * nb_bead + 0.30 * plug * gate_y
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
    # #147j r37: the shader's `lip` = the DRY vermilion only (matte, no film, fissures): the everted wet mucosa (evm) is
    # excluded, so it keeps the water film of the inner lip
    return dict(bru=np.clip(np.maximum(fresh, 0.7 * np.clip(old1 + old2 + old3 + old4, 0, 1)), 0, 1), alb=alb, rough=np.clip(rough, 0.08, 0.9), wet=np.clip(wet, 0, 1), sss=np.clip(sss, 0.03, 1.5), pore=np.clip(pore, 0, 1),
                pet=np.clip(pet, 0, 1), lip=np.clip(lip * (1.0 - evm), 0, 1), muc=np.clip(inner, 0, 1), cap=np.clip(capm, 0, 1),
                blood=np.clip(np.maximum(blood, lacm), 0, 1), disp=disp, scalp=scalp, mar=mar, conj=conj,
                w_h=w_h, w_v=w_v, w_c=w_c, w_d=w_d, pbig=np.clip(pbig, 0, 1), scar=np.clip(scar1, 0, 1))
