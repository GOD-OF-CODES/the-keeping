"""C4-C5 cross-section of an adult female neck (docs/C2-ESCAPE.md §3.2) as procedural fields on the cut plane.

Coordinates: u = across the neck toward HER LEFT (m), v = toward her FRONT (m), origin = the rim centroid. The neck
section is ~10.5 x 11 cm. `section(u, v, inset, head_side)` -> dict(h, macro, alb, rough, film): `macro` is the
height the cap GEOMETRY carries (sever.py, full strength, 2.8 mm triangles), `h - macro` the fine detail the baked
normal map carries (fibres, marrow pits, ragged fibre ends, film edges).

Fix round (the Phase-1 caps read as flat red discs with a white vertebra "cross" like a sticker at 60-140 px):
what reads at 1.2-2.75 m is SHAPE under the 12 cd lamp, so the macro relief is big and anatomical (Gray's Anatomy
C4-C5 section; post-mortem retraction of cut skeletal muscle 2-6 mm, skin 2-4 mm; bone and cartilage do not retract):
  - vertebral body +3.5 mm proud (17 x 15 mm), its posterior arch ring, the transverse processes and the spinous process
    as low bony ridges — a vertebra, not a disc + cross;
  - the spinal canal a dark 6 mm-deep gap around a cord retracted 3 mm; the windpipe lumen a 10 mm-deep black hole
    (casts its own shadow under the lamp); carotid lumens 7 mm deep; jugulars collapsed slits;
  - muscle BUNDLES: ~9 mm cells each retracted by its own 2-6 mm and domed, thin recessed fascia between them;
  - the ragged skin margin by the real distance to the rim (`inset`): a 1.6 mm proud skin roll (cut skin curls
    outward), a jittered 2-5 mm lobulated yellow fat band, then muscle;
  - the second cleaver stroke: a 3.5 mm ledge across the posterior third (body side recessed, head side proud —
    complementary surfaces), its edge jittered +-1 mm.
Colours are linear albedo and never chalk-white: cortical bone 0.46/0.40/0.31 under a 40 % blood smear, cancellous
bone red marrow; the runtime (src/characters/skin.ts) adds a wet film to texels with r/g > 1.55-2.1 (muscle/blood),
so bone/cartilage/fat (r/g < 1.5) are painted already smeared.
"""
import numpy as np

from lib import noise

A_U, B_V = 0.0525, 0.055           # section half-axes (10.5 x 11 cm)
V_STEP = -0.034                    # the second stroke's ledge (posterior third)
# fix round 3 (AD: "a bottle with a salami-slice cut"): the ledge and the ragged skin margin are now GEOMETRY shared by
# both pieces and by the skin rim itself (sever.split_mesh moves the rim + the skin within 12 mm of it, the caps follow),
# so the cut OUTLINE steps where the second stroke landed and the skin edge is torn, not a planar ellipse.
CAP_GEOM_RELIEF = 0.0              # fix round 3 stage 2: cap interior is planar geometry (relief -> normal map)
CAP_DOME = 0.0025                  # stage 2: smooth convex bulge of the relaxed section (m)
GEOM_TO_NORMAL = 0.5               # share of the (clipped) macro relief baked into the cap normal map
LEDGE = 0.0055                     # second-stroke step (m): the blade landed 5.5 mm lower over the posterior third
LEDGE_SLOPE = 0.08                 # ... and at its own angle (~4.6 deg steeper than the first stroke)
JAG = 0.0024                       # torn skin margin: +-2.4 mm along the cut normal, 2-3 cm wavelength around the neck
TAG = 0.0042                       # a few 4-6 mm skin tags / notches (cleaver skips and tears on the second stroke)

# bony / airway landmarks (u, v, ru, rv)
VERT = (0.0, -0.008, 0.0085, 0.0075)            # vertebral body 17 x 15 mm
CANAL = (0.0, -0.0225, 0.0068, 0.0058)          # spinal canal
CORD = (0.0, -0.0225, 0.0048, 0.0038)           # cord (retracted)
ARCH = (0.0, -0.0225, 0.0098, 0.0088)           # pedicles + laminae ring around the canal
TRANS = [(0.0215, -0.0095, 0.0060, 0.0028), (-0.0215, -0.0095, 0.0060, 0.0028)]   # transverse processes
SPINE = (0.0, -0.036, 0.0016, 0.0058)           # spinous process (bifid tip blurred)
TRACHEA = (0.0, 0.031, 0.009, 0.002)            # centre u, v, outer radius (18 mm OD), C-ring wall
OESOPH = (0.0, 0.0175, 0.0085, 0.0028)
SCM = [(0.034, 0.019, 0.0125, 0.0065), (-0.034, 0.019, 0.0125, 0.0065)]
CAROTIDS = [(0.0195, 0.0165, 0.00325, 0.001), (-0.0195, 0.0165, 0.00325, 0.001)]   # u, v, outer r, wall
JUGULARS = [(0.0305, 0.0105), (-0.0305, 0.0105)]


def _ss(e0, e1, x):
    return noise.smoothstep(e0, e1, x)


def _ell(uu, vv, s):
    cu, cv, ru, rv = s
    return np.sqrt(((uu - cu) / ru) ** 2 + ((vv - cv) / rv) ** 2)


def _worley_id(Q, seed):
    """2D Worley: (F1, F2, id01 of the nearest feature point) for points Q (n, 2) in cell units."""
    i0 = np.floor(Q).astype(np.int64)
    f1 = np.full(len(Q), 9.0)
    f2 = np.full(len(Q), 9.0)
    cid = np.zeros(len(Q))
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            c = i0 + np.array([dx, dy])
            h = noise._hash(c[:, 0], c[:, 1], np.zeros(len(c), np.int64), seed)
            jit = np.stack([(h % 1024) / 1024.0, ((h >> 10) % 1024) / 1024.0], 1)
            d = np.sqrt(((c + jit - Q) ** 2).sum(1))
            idv = ((h >> 20) % 1024) / 1023.0
            f2 = np.where(d < f1, f1, np.minimum(f2, d))
            cid = np.where(d < f1, idv, cid)
            f1 = np.minimum(f1, d)
    return f1, f2, cid


def inset_dist(uv, rim):
    """Distance (m) from each (u, v) point to the rim polygon (closed, (M, 2))."""
    uv = np.asarray(uv, float)
    a = np.asarray(rim, float)
    b = np.roll(a, -1, axis=0)
    ab = b - a
    best = np.full(len(uv), 9.0)
    for i in range(len(a)):
        t = np.clip(((uv - a[i]) @ ab[i]) / max(ab[i] @ ab[i], 1e-12), 0, 1)
        d = np.linalg.norm(uv - (a[i] + t[:, None] * ab[i]), axis=1)
        best = np.minimum(best, d)
    return best


def _mixc(alb, col, w):
    return alb * (1 - w[:, None]) + np.asarray(col, float) * w[:, None]


def section(u, v, inset=None, head_side=False, seed=211):
    u = np.atleast_1d(np.asarray(u, float))
    v = np.atleast_1d(np.asarray(v, float))
    n = len(u)
    if head_side:                     # the head's face is the other side of the same cut: tissue slightly offset
        u = u + 0.002
    P3 = np.stack([u, v, np.zeros_like(u)], 1)
    # boundaries perturbed +-1.2 mm (no compass-drawn circles)
    uu = u + 0.0012 * noise.fbm(P3 * 160.0, 3, seed)
    vv = v + 0.0012 * noise.fbm(P3 * 160.0 + 7.3, 3, seed + 1)
    if inset is None:
        rho = np.sqrt((u / A_U) ** 2 + (v / B_V) ** 2)
        inset = np.clip((1.0 - rho) * 0.054, 0, None)
    inset = np.asarray(inset, float) + 0.0009 * noise.fbm(P3 * 220.0 + 3.1, 3, seed + 2)   # ragged margin
    fine = np.zeros(n)

    # ---- muscle bundles: ~9 mm cells, each retracted by its own amount and domed; fascia recessed between
    warp = 0.45 * np.stack([noise.fbm(P3 * 45.0, 3, seed + 20), noise.fbm(P3 * 45.0 + 4.1, 3, seed + 21)], 1)
    f1, f2, cid = _worley_id(np.stack([u / 0.0115, v / 0.0080], 1) + warp, seed + 3)    # irregular fascicle groups
    cid = cid * 2.0 - 1.0
    # fix round 3 (in-game ig1: the cut face read as gold crumpled foil — every 3 mm facet of 2.6-5.4 mm bundle relief
    # caught the lamp under the wet film): the pooled blood film fills the fascia grooves, so the SHAPE the lamp sees is
    # much flatter — bundles 2.4-3.6 mm retracted, 0.4 mm domes, grooves 3.6 mm (bundle colour variation unchanged)
    retr = 0.0030 + 0.0006 * cid                                 # 2.4-3.6 mm
    dome = np.clip(1.0 - (f1 / 0.62) ** 2, 0, 1)
    fascia = 1.0 - _ss(0.0, 0.10, f2 - f1)
    soft = 1.0 - _ss(0.0, 0.30, f2 - f1)                                     # bundles meet in a rounded groove
    macro = (-retr + 0.0004 * dome) * (1 - soft) + (-0.0036) * soft
    fib = noise.fbm(np.stack([u * 1100.0, v * 150.0, np.zeros(n)], 1), 3, seed + 5)     # fibre grain (one direction)
    fine += 0.00008 * fib                 # fix round 3: 0.25 -> 0.08 mm (lamp glints 'sparkled' on the wet film)
    tone = 1.0 + 0.22 * cid + 0.12 * fib
    alb = np.array([0.165, 0.052, 0.046])[None, :] * tone[:, None]
    alb = _mixc(alb, [0.26, 0.12, 0.11], 0.22 * fascia)
    rough = np.full(n, 0.32)
    # SCM: two big lateral bellies, retracted further (a long muscle pulls back hardest), coarser grain
    for s in SCM:
        w = 1 - _ss(0.85, 1.08, _ell(uu, vv, s))
        macro = macro * (1 - w) + (-0.0058 + 0.0016 * np.clip(1 - _ell(uu, vv, s) ** 2, 0, 1)) * w
        alb = _mixc(alb, np.array([0.13, 0.040, 0.037]) * (1 + 0.15 * fib)[:, None], w)

    # ---- the second stroke: a ledge across the posterior third
    step_v = V_STEP + 0.001 * noise.fbm(np.stack([u * 120.0, np.zeros(n), np.zeros(n)], 1), 2, seed + 6) + 0.12 * u * u
    post = _ss(step_v + 0.0005, step_v - 0.0005, vv)
    # fix round 3: the step itself is geometry now (plane_offset, both pieces) — only its colour/roughness live here
    alb = _mixc(alb, [0.11, 0.035, 0.032], 0.35 * post)
    rough = rough + 0.12 * post

    # ---- bone: vertebral body, arch ring, transverse + spinous processes (proud: bone does not retract)
    dv = _ell(uu, vv, VERT)
    wv = 1 - _ss(0.90, 1.04, dv)
    bone_h = 0.0035 - 0.0012 * np.clip(dv, 0, 1) ** 4
    macro = macro * (1 - wv) + bone_h * wv
    da = _ell(uu, vv, ARCH)
    dc = _ell(uu, vv, CANAL)
    wa = (1 - _ss(0.88, 1.05, da)) * _ss(0.92, 1.05, dc)
    macro = macro * (1 - wa) + 0.0028 * wa
    wt = np.zeros(n)
    for s in TRANS:
        wt = np.maximum(wt, 1 - _ss(0.85, 1.1, _ell(uu, vv, s)))
    wsp = 1 - _ss(0.85, 1.1, _ell(uu, vv, SPINE))
    wb2 = np.maximum(wt, wsp) * (1 - wv)
    macro = macro * (1 - wb2) + 0.0022 * wb2
    bone = np.clip(wv + wa + wb2, 0, 1)
    cortical = np.clip(wa + wb2 + wv * _ss(0.72, 0.9, dv), 0, 1)
    # cancellous body: red marrow with pale trabecular speckle; cortex pale ivory, never white
    w1, w2 = noise.worley(P3 * 1400.0, seed + 7)
    trab = _ss(0.05, 0.16, w2 - w1)
    canc = _mixc(np.tile([0.30, 0.115, 0.085], (n, 1)), [0.43, 0.34, 0.27], 0.55 * trab)
    fine += wv * (1 - cortical) * (-0.00018) * (1 - trab)
    bone_col = _mixc(canc, [0.46, 0.40, 0.31], cortical)
    alb = _mixc(alb, bone_col, bone)
    rough = rough * (1 - bone) + 0.38 * bone
    # canal: the cord retracted 3 mm, a 6 mm-deep dark gap around it
    wcn = 1 - _ss(0.92, 1.04, dc)
    dcd = _ell(uu, vv, CORD)
    wcd = 1 - _ss(0.85, 1.05, dcd)
    macro = macro * (1 - wcn) + (-0.0062 * (1 - wcd) - 0.003 * wcd) * wcn
    alb = _mixc(alb, [0.03, 0.009, 0.009], wcn * (1 - wcd))
    alb = _mixc(alb, [0.27, 0.15, 0.14], wcn * wcd)          # cord: grey-pink white matter under a bloody smear
    fine += wcn * wcd * 0.0002 * noise.fbm(P3 * 900.0, 2, seed + 8)

    # ---- airway + gullet
    tu, tv, tr, tw = TRACHEA
    dt = np.sqrt((uu - tu) ** 2 + (vv - tv) ** 2)
    c_open = _ss(-0.45, -0.75, (vv - tv) / tr)                                 # the C opens at the back
    ring = _ss(tr - tw - 0.0004, tr - tw, dt) * (1 - _ss(tr, tr + 0.0005, dt))
    cart = ring * (1 - c_open)
    memb = ring * c_open
    lumen = 1 - _ss(tr - tw - 0.0006, tr - tw, dt)
    macro = macro * (1 - ring) + (0.0012 * cart - 0.0025 * memb)
    alb = _mixc(alb, [0.48, 0.42, 0.36], cart)
    alb = _mixc(alb, [0.20, 0.08, 0.075], memb)
    mucosa = lumen * _ss(tr - tw - 0.0022, tr - tw - 0.0006, dt)
    macro = macro * (1 - lumen) + (-0.010 + 0.007 * mucosa) * lumen
    alb = _mixc(alb, [0.018, 0.007, 0.007], lumen)
    alb = _mixc(alb, [0.22, 0.07, 0.065], mucosa)
    do = _ell(uu, vv, OESOPH)
    wo = 1 - _ss(0.85, 1.08, do)
    macro = macro * (1 - wo) + (-0.0035 - 0.002 * (1 - _ss(0.0, 0.5, do))) * wo
    alb = _mixc(alb, [0.24, 0.10, 0.095], wo * _ss(0.35, 0.7, do))
    alb = _mixc(alb, [0.04, 0.012, 0.012], wo * (1 - _ss(0.2, 0.45, do)))   # the collapsed lumen slit
    # carotids: a pale 1 mm wall, a 7 mm-deep lumen (jet sources); jugulars: collapsed dark slits
    vessel_void = np.zeros(n)
    for cu, cv, r, wall in CAROTIDS:
        d = np.sqrt((uu - cu) ** 2 + (vv - cv) ** 2)
        wl = _ss(r - wall - 0.0003, r - wall, d) * (1 - _ss(r, r + 0.0003, d))
        lu = 1 - _ss(r - wall - 0.0003, r - wall, d)
        macro = macro * (1 - wl) + 0.0004 * wl
        alb = _mixc(alb, [0.30, 0.17, 0.15], wl)      # stage 2: 0.44 pale rings read as drawn circles (filmed wall)
        macro = macro * (1 - lu) - 0.007 * lu
        alb = _mixc(alb, [0.04, 0.004, 0.004], lu)
        vessel_void = np.maximum(vessel_void, lu)
    for cu, cv in JUGULARS:
        dj = np.sqrt(((uu - cu) / 0.0055) ** 2 + ((vv - cv) / 0.0013) ** 2)
        sl = 1 - _ss(0.8, 1.1, dj)
        macro = macro - 0.003 * sl
        alb = _mixc(alb, [0.03, 0.01, 0.012], sl)

    # ---- the margin by the real distance to the rim: skin roll (proud, curling out), lobulated fat, then muscle
    skin_w = 1 - _ss(0.0015, 0.0022, inset)
    fat_w = _ss(0.0015, 0.0022, inset) * (1 - _ss(0.0045, 0.0075 + 0.0015 * noise.fbm(P3 * 90.0, 2, seed + 9), inset))
    roll = np.exp(-((inset - 0.0009) / 0.0007) ** 2) * (0.75 + 0.5 * _ss(-0.5, 0.5, noise.fbm(P3 * 140.0, 2, seed + 10)))
    lob1, lob2 = noise.worley(P3 * 600.0, seed + 11)
    lob = np.clip(1 - (lob1 / 0.7) ** 2, 0, 1)
    edge = _ss(0.0, 0.0025, inset)                                         # 0 on the rim (meets the skin exactly)
    macro = macro * (1 - skin_w - fat_w) + skin_w * (0.0008 * roll) + fat_w * (-0.0012 + 0.0007 * lob)
    # fix round 3 (retracted skin): cut skin pulls back 2-4 mm more than the tissue under it, so the section stands
    # PROUD of the skin edge and the fat layer shows as a sloped yellow wall, not a flush painted ring
    macro = macro + 0.0028 * _ss(0.0018, 0.0095, inset)
    macro = macro * np.where(inset < 0.0025, edge ** 0.5, 1.0)
    # fix round 2 (ruling j): subcutaneous fat 3-8 mm, NOT a clean cream ring — dull yellow-tan under blood (fresh
    # subcutis ~0.30/0.20/0.10 linear), and the film below now covers it 75-90 % instead of 65 %
    # stage 2 l1 (close: the fat ring = a pale bright BEADED rim, the brightest thing on the cut): blood from the
    # vessels a few mm inside runs over the fat at once — blood-stained subcutis ~0.20/0.11/0.06, not clean 0.30/0.20/0.10
    alb = _mixc(alb, np.array([0.20, 0.11, 0.06])[None, :] * (0.85 + 0.25 * lob)[:, None], fat_w)
    dermis = _ss(0.0004, 0.0011, inset)
    alb = _mixc(alb, _mixc(np.tile([0.24, 0.22, 0.26], (n, 1)), [0.30, 0.14, 0.13], dermis), skin_w)   # fix round 2: in-game the margin read as a pale cream ring
    rough = rough * (1 - fat_w - skin_w) + 0.45 * fat_w + 0.42 * skin_w

    # ---- blood film: >= 60 %, thicker toward the front (the low side: she lay face-down), pooled in the recesses,
    # smeared thin over bone and cartilage (40 %), absent on the proud skin roll
    fn = noise.fbm(P3 * 70.0, 4, seed + 12)
    recess = np.clip((-macro - 0.003) * 150.0, 0, 1)
    film = np.clip(0.48 + 0.6 * fn + 0.3 * np.clip(v / B_V, -1, 1) + 0.8 * recess, 0, 1)
    film = film * (1 - 0.6 * np.clip(bone + cart, 0, 1) * _ss(-0.1, 0.4, fn + 0.2)) * (1 - 0.35 * skin_w)
    holes = np.clip(lumen * (1 - mucosa) + wcn * (1 - wcd), 0, 1)              # voids read black, not filmed
    film = film * (1 - 0.12 * fat_w) * (1 - 0.9 * holes)
    alb = _mixc(alb, [0.10, 0.008, 0.007], film * 0.92)
    # a thin smear on bone/cartilage (lighter red than a pooled film): 45-75 %, no clean ivory left
    smear = np.clip(bone + cart, 0, 1) * np.clip(0.6 + 0.35 * noise.fbm(P3 * 260.0, 3, seed + 14), 0, 1) * (1 - film)
    alb = _mixc(alb, [0.24, 0.06, 0.05], smear * 0.5)     # fix round 3: 0.75 -> 0.5, the vertebra reads off-white
    rough = rough * (1 - film) + 0.2 * film        # fix round 3: 0.12 -> 0.2 (wet clotting blood, not a mirror)
    fine += 0.00012 * film * (1 - _ss(0.2, 0.6, film))                    # meniscus at the film edge
    fine += 0.00004 * noise.fbm(P3 * 250.0, 2, seed + 13) * (1 - bone)       # ragged torn fibre ends (fix round 3: no sparkle)
    # fix round 3 stage 2 (cine's lamp-pool list #1, m6max-03: the cut = a crumpled gold-foil disc): ANY mm relief in the
    # cap GEOMETRY tilts its facets past skin.ts's axial-normal gate (|n_y| 0.55-0.85), so those facets kept the mirror
    # film and each threw an image of the flame. A real 3 s-old cut lying in its pool is levelled by the film (blood's
    # capillary length ~2 mm >> the relief): the cap is now PLANAR geometry (only plane_offset's ledge + torn rim stay
    # geometric, sever.py), and the anatomy reads as colour + a clipped (+-3 mm) share of the relief in the normal map.
    fine = fine + GEOM_TO_NORMAL * np.clip(macro, -0.003, 0.003)
    macro = macro * CAP_GEOM_RELIEF
    # stage 2 l1 (lamp-side close: a flat grey LID): cut soft tissue is not a planar lid — the section bulges as the
    # elastic tissue under it relaxes (a smooth 2.5 mm dome, slope <= 7 deg: inside skin.ts's axial gate, no facets),
    # and the open lumens (airway, gullet slit, carotids, canal gap) are VOIDS, not a filmed surface: matte black
    # (roughness 0.95) so no sheen lies over them.
    rho2 = (u / A_U) ** 2 + (v / B_V) ** 2
    macro = macro + CAP_DOME * np.clip(1.0 - rho2, 0, 1) ** 1.5 * _ss(0.0, 0.006, inset)
    voids = np.clip(np.maximum(np.maximum(lumen * (1 - mucosa), wcn * (1 - wcd)), np.maximum(vessel_void, wo * (1 - _ss(0.2, 0.45, do)))), 0, 1)
    rough = rough * (1 - voids) + 0.95 * voids
    return dict(h=macro + fine, macro=macro, fine=fine, alb=np.clip(alb, 0, 1), rough=np.clip(rough, 0.12, 1),
                film=film, bone=bone)


def fields(u, v, seed=211, inset=None, head_side=False):
    """Back-compat: (height m, albedo, roughness, film)."""
    s = section(u, v, inset=inset, head_side=head_side, seed=seed)
    return s['h'], s['alb'], s['rough'], s['film']


def height(u, v, inset=None, head_side=False):
    h = section(u, v, inset=inset, head_side=head_side)['macro']
    return float(h[0]) if np.ndim(u) == 0 else h


def ledge_offset(u, v, seed=211):
    """Fix round 3: metres along the cut normal +n (toward the head) of the second stroke's face — the posterior
    third lies LEDGE + LEDGE_SLOPE * depth lower than the first stroke (same field for both pieces and the skin rim)."""
    u = np.atleast_1d(np.asarray(u, float))
    v = np.atleast_1d(np.asarray(v, float))
    z = np.zeros_like(u)
    step_v = V_STEP + 0.001 * noise.fbm(np.stack([u * 120.0, z, z], 1), 2, seed + 6) + 0.12 * u * u
    post = _ss(step_v + 0.0005, step_v - 0.0005, v)
    return -(LEDGE + LEDGE_SLOPE * np.clip(step_v - v, 0, None)) * post


def rim_jag(u, v, seed=311):
    """Torn skin margin (m along +n), a periodic function of the angle around the neck: a 2-3 cm undulation plus a
    few sharp 4-6 mm tags/notches."""
    u = np.atleast_1d(np.asarray(u, float))
    v = np.atleast_1d(np.asarray(v, float))
    th = np.arctan2(v, u)
    Q = np.stack([np.cos(th), np.sin(th), np.zeros_like(th)], 1)
    j = JAG * noise.fbm(Q * 4.5, 3, seed) / 0.5
    tags = _ss(0.62, 0.9, noise.ridged(Q * 2.4, 2, seed + 1)) * np.sign(noise.fbm(Q * 1.3, 1, seed + 2) + 1e-6)
    return np.clip(j, -JAG, JAG) + TAG * tags


def plane_offset(u, v, inset=None, seed=211):
    """Fix round 3: the shared displacement (m along +n) of the cut: ledge everywhere + the rim jag fading out over
    the first 9 mm inside the rim (skin + fat), so cap and skin rim meet exactly."""
    off = ledge_offset(u, v, seed)
    if inset is None:
        return off + rim_jag(u, v)
    return off + rim_jag(u, v) * (1.0 - _ss(0.0, 0.009, np.asarray(inset, float)))

