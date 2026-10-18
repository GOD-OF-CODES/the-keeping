"""JUMPSCARE (#147) — Ada's hair as true CURVES for Cycles (the scare head is never exported, so no cards):
  * scalp: long black hair (25-40 cm), centre-parted, WET: plastered to the scalp, ropes clumping toward the tips
    (water bridges hairs together), hanging under gravity in the hero pose; children 0.3-2.5 mm off the scalp.
  * face: 30-60 thin wet clumps (5-30 hairs) plastered across the forehead, over her LEFT eye and cheek and INTO the
    left mouth corner, a few across the right cheek; her RIGHT eye stays clear (the eye contact).
  * lashes: upper 8-10 mm / lower 4-6 mm, curling away from the eye, wet -> clumped into 3-6 hair spikes.
  * brows: sparse wet hairs lying on the skin (medial rising, lateral running out); a hairless gap where the old scar
    crosses her right brow.
Pure numpy, head space in mm (scare_head.py). Each builder returns (S (K, NP, 3) mm, radius (K, NP) mm).
Hair diameters: scalp 70-80 um (Asian/European black hair 60-90 um), lashes 0.1 mm root, brows 80 um.
"""
import math

import numpy as np

from characters import sdf
from lib import noise
from lib.noise import smoothstep as ss
from scare import scare_head as sh


def _unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)


def stick_fn(face, globes=True):
    """Deformed-space mm SDF (head + globes) the hair lies on."""
    def fn(X):
        Xr, _ = face.to_rest(X)
        d = face.rest(Xr)
        if globes:
            for E in face.E:
                d = np.minimum(d, np.linalg.norm(X - E, axis=1) - sh.R_GLOBE - 0.3)
                # #147d: the cornea dome stands 0.94 mm proud of the sclera sphere
                d = np.minimum(d, np.linalg.norm(X - (E + sh.V(0.0, -sh.CORNEA_OFF, 0.0)), axis=1) - sh.CORNEA_R - 0.3)
        return d
    return fn


def grad(fn, P, h=0.25):
    g = np.empty_like(P)
    for i in range(3):
        e = np.zeros(3)
        e[i] = h
        g[:, i] = (fn(P + e) - fn(P - e)) / (2 * h)
    return _unit(g)


def resample(pts, n):
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    u = np.linspace(0.0, s[-1], n)
    return np.stack([np.interp(u, s, pts[:, k]) for k in range(3)], 1)


def integrate(fn, roots, dirs, lengths, g, step=5.0, offset=0.6, stick=3.0, grav=0.5, detach_dot=0.3, rng=None,
              wander=0.03):
    """Wet strands: slide along the surface under gravity while attached, detach where the surface turns to face
    down, then hang and collide (the hair.integrate idea, with a free gravity vector for the posed head)."""
    P = np.array(roots, float)
    D = _unit(np.array(dirs, float))
    K = len(P)
    n = int(np.ceil(np.max(lengths) / step))
    att = np.ones(K, bool)
    out = [P.copy()]
    for i in range(n):
        ds = fn(P)
        gr = grad(fn, P)
        att = att & (ds < stick) & ((gr @ g) < detach_dot)
        v = D + g * grav
        if wander and rng is not None:
            v = v + rng.normal(0, wander, (K, 3))
        vt = v - gr * (v * gr).sum(1)[:, None]
        vfree = D + g * 0.6
        D = _unit(np.where(att[:, None], vt, vfree))
        P = P + D * step
        d2 = fn(P)
        g2 = grad(fn, P)
        P = np.where(att[:, None], P - g2 * (d2 - offset)[:, None], P)
        push = (~att) & (d2 < offset)
        P = np.where(push[:, None], P - g2 * (d2 - offset)[:, None], P)
        Dn = D - g2 * np.minimum((D * g2).sum(1), 0.0)[:, None]
        D = np.where(push[:, None], _unit(Dn), D)
        out.append(P.copy())
    S = np.stack(out, 1)
    res = []
    for k in range(K):
        m = int(np.ceil(lengths[k] / step)) + 1
        res.append(S[k, :m])
    return res


def scalp(face, g, n_guides=1500, children=16, npts=40, seed=5):
    rng = np.random.default_rng(seed)
    fn = stick_fn(face, globes=False)
    # roots: project random directions from the cranium centre onto the surface, keep those above the hairline
    c0 = sh.V(0.0, 45.0, 20.0)
    dirs = _unit(rng.normal(size=(n_guides * 5, 3)))
    cand = sdf.project(fn, c0 + dirs * 95.0, iters=12)
    rel = cand - sh.V(0.0, 40.0, 0.0)
    ph = np.degrees(np.arctan2(np.abs(rel[:, 0]), -rel[:, 1]))
    hl = np.interp(ph, [0, 25, 45, 75, 95, 120, 180], [70, 66, 52, 8, -12, -35, -78])
    ok = (cand[:, 2] > hl + 1.0) & (np.abs(fn(cand)) < 0.5) & (cand[:, 2] > face.cut_c[2] + 30)
    roots = cand[ok][:n_guides]
    N = grad(fn, roots)
    # centre parting: hair leaves the part line sideways, then down
    side = np.where(roots[:, 0] >= 0, 1.0, -1.0)
    away = np.stack([side, np.full(len(roots), 0.25), np.full(len(roots), -0.7)], 1)
    front = roots[:, 1] < 10.0
    away[front] = away[front] * np.array([1.0, 1.0, 1.0]) + np.array([0.0, 0.6, 0.0])      # forehead hair swept back
    d0 = away - N * (away * N).sum(1)[:, None]
    lens = rng.uniform(250.0, 400.0, len(roots))
    res = integrate(fn, roots, d0, lens, g, step=5.0, offset=0.8, stick=3.5, grav=0.45, detach_dot=0.25, rng=rng,
                    wander=0.04)
    S, R = [], []
    for pts in res:
        if len(pts) < 4:
            continue
        gpts = resample(pts, npts)
        t = np.gradient(gpts, axis=0)
        t = _unit(t)
        nn = grad(fn, gpts)
        b = _unit(np.cross(t, nn))
        tt = np.linspace(0.0, 1.0, npts)
        for j in range(children):
            r0 = rng.uniform(0.0, 4.0)
            a0 = rng.uniform(0.0, 2 * math.pi)
            lift = rng.uniform(0.3, 2.5)
            tight = 1.0 - 0.85 * ss(0.05, 0.7, tt)                     # wet clumps: tips converge
            off = (b * math.cos(a0) * r0)[None] * tight[:, None] if False else (b * (math.cos(a0) * r0) * tight[:, None])
            off = off + nn * (lift * (1.0 - 0.6 * ss(0.0, 0.5, tt)))[:, None]
            off = off + rng.normal(0.0, 0.25, 3)[None] * ss(0.3, 1.0, tt)[:, None]
            S.append(gpts + off)
            R.append(np.linspace(0.040, 0.022, npts))
    return np.array(S), np.array(R)


# clumps plastered on the face: (x, z) paths in DEFORMED space (front projection), hairs per clump, width (mm)
FACE_CLUMPS = [
    ([(8, 70), (15, 46), (23, 22), (29, 6), (33, -6), (32, -26), (27, -46), (23, -58), (17, -62)], 26, 3.2),   # over L eye -> mouth
    ([(12, 70), (22, 44), (34, 18), (40, -6), (40, -34), (37, -62), (33, -90)], 30, 3.8),
    ([(4, 72), (9, 48), (15, 24), (20, 4), (25, -16), (26, -40), (24, -60), (20, -64)], 14, 2.0),
    ([(18, 70), (30, 46), (44, 24), (52, 0), (54, -30), (52, -60)], 22, 3.0),
    ([(2, 72), (5, 50), (10, 30), (16, 14)], 8, 1.2),
    ([(-6, 72), (-14, 50), (-30, 30), (-46, 14), (-54, -12), (-55, -45)], 24, 3.4),
    ([(-12, 70), (-26, 48), (-42, 30), (-56, 6), (-60, -30)], 28, 4.0),
    ([(-3, 72), (-9, 52), (-20, 34), (-36, 22), (-44, 6), (-42, -16), (-34, -42), (-27, -60)], 9, 1.4),   # stray across R cheek
    ([(28, 30), (36, 10), (42, -14), (44, -42), (41, -70)], 16, 2.2),
    ([(-40, 26), (-48, 2), (-50, -28), (-46, -58), (-40, -80)], 14, 2.0),
    ([(6, 58), (13, 36), (22, 16), (30, -2), (36, -20), (38, -44)], 10, 1.5),
    # r11: a wet rope down her left side of the nose (the side the nose shadows): the dark area reads as hair + shadow
    ([(5, 66), (8, 40), (12, 18), (15, 0), (17, -16), (19, -32), (21, -48), (19, -60), (15, -66)], 26, 4.5),
    ([(-2, 70), (-6, 46), (-12, 24), (-20, 8), (-26, -10), (-27, -34), (-24, -54)], 6, 0.9),   # stray over her lit cheek
]


def face_strands(face, g, seed=9, npts=48):
    rng = np.random.default_rng(seed)
    fn = stick_fn(face)
    S, R = [], []
    for path, nh, width in FACE_CLUMPS:
        pts = np.array([[x, 0.0, z] for x, z in path], float)
        # densify in xz, then project each point onto the face along +y
        dense = []
        for a, b in zip(pts[:-1], pts[1:]):
            m = max(2, int(np.linalg.norm(b - a) / 2.0))
            for k in range(m):
                dense.append(a + (b - a) * (k / m))
        dense.append(pts[-1])
        dense = np.array(dense)
        o = dense.copy()
        o[:, 1] = -150.0
        t, h = sh.ray_hit(fn, o, np.tile(sh.V(0.0, 1.0, 0.0), (len(o), 1)), tmax=320.0, eps=0.02, step=0.7)
        P3 = o + np.array([0.0, 1.0, 0.0]) * t[:, None]
        P3 = P3[h]
        if len(P3) < 3:
            continue
        # free continuation under gravity for 3-7 cm past the last contact
        tail = [P3[-1]]
        dlast = _unit(P3[-1] - P3[-2])
        for k in range(12):
            dlast = _unit(dlast + g * 0.5)
            tail.append(tail[-1] + dlast * rng.uniform(3.0, 5.0))
        guide = resample(np.concatenate([P3, np.array(tail[1:])]), npts)
        nn = grad(fn, guide)
        tg = _unit(np.gradient(guide, axis=0))
        bn = _unit(np.cross(tg, nn))
        tt = np.linspace(0, 1, npts)
        contact = np.concatenate([np.ones(len(P3)), np.zeros(len(tail) - 1)])
        contact = np.interp(np.linspace(0, 1, npts), np.linspace(0, 1, len(contact)), contact)
        # a wet clump is a dense, LAYERED rope (4x the hairs, centre-weighted, 0.05-0.45 mm thick where it lies on
        # the skin): 26 hairs across 3 mm read as a sparse ribbon (#147b)
        ph1, ph2 = rng.uniform(0, 6, 2)
        for j in range(int(nh * 2.5)):          # r10: x2.5 (r9 x4 = solid black tape across the face)
            u = float(np.clip(rng.normal(0.0, 0.42), -1.0, 1.0))
            across = u * width * 0.5
            pinch = 0.55 + 0.45 * np.sin(tt * math.pi * 1.7 + ph1) * (0.8 + 0.2 * math.sin(ph2 + j))   # narrows / spreads together
            lift = 0.05 + 0.40 * abs(rng.normal(0.0, 0.5)) * (1.0 - 0.7 * abs(u))
            off = bn * (across * pinch)[:, None] + nn * lift
            off = off + nn * (2.0 * (1.0 - contact))[:, None] * rng.uniform(0, 1)
            off = off + rng.normal(0.0, 0.25, 3)[None] * (1.0 - contact)[:, None]
            # #147e: each hair wanders on its own (0.05-0.12 mm, 3-9 mm wavelength): r14-r15 clumps of parallel hairs
            # glinted all at the same tangent = bright dashes across the rope
            lam = rng.uniform(3.0, 9.0)
            arc = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(guide, axis=0), axis=1))])
            off = off + bn * (rng.uniform(0.05, 0.12) * np.sin(2.0 * math.pi * arc / lam + rng.uniform(0, 6.3)))[:, None]
            S.append(guide + off)
            R.append(np.linspace(0.038, 0.026, npts))
    # re-project contact points so no hair sinks into the skin after the spread
    S = np.array(S)
    R = np.array(R)
    flat = S.reshape(-1, 3)
    d = fn(flat)
    nrm = grad(fn, flat)
    fix = d < 0.05
    flat[fix] = flat[fix] - nrm[fix] * (d[fix] - 0.08)[:, None]
    return flat.reshape(S.shape), R


def lashes(face, seed=13, npts=12):
    """#147d: WET lashes in irregular spikes (r8 read as an evenly spaced strip-lash comb). Roots in 2-3 staggered rows
    with jittered spacing; wet clumps of 3-6 whose tips converge into one spike; lengths/curl/angles vary; ~12 % strays
    that cross their neighbours. Upper 7.5-10.5 mm (longest centrally), lower 4-6.5 mm."""
    rng = np.random.default_rng(seed)
    S, R = [], []
    for k in (0, 1):
        E = face.E[k]
        s = 1.0 if k == 0 else -1.0
        for upper in (True, False):
            n = 135 if upper else 70            # #147e: 165/85 read as an even comb (with 3.5-9 deg clumps)
            az = np.sort(rng.uniform(-64.0, 70.0, n) + rng.normal(0.0, 0.6, n))
            row = rng.integers(0, 3, n)
            # clump centres: a Poisson-ish walk, 3.5-9 deg apart (~0.8-1.9 mm), then nearest-centre membership
            cs = [-66.0]
            while cs[-1] < 72.0:
                cs.append(cs[-1] + rng.uniform(6.0, 14.0))      # #147e: 1.3-3 mm apart: fewer, heavier wet spikes
            cs = np.array(cs)
            memb = np.argmin(np.abs(az[:, None] - cs[None, :]), 1)
            stray = rng.random(n) < 0.12
            paths = []
            for i, a in enumerate(az):
                up, lo = sh.margins(np.array([a]), k)
                el = (up[0] + 0.35 + 0.15 * row[i]) if upper else (lo[0] - 0.35 - 0.15 * row[i])
                r = sh.R_LID_IN + (1.55 if upper else 1.35) + 0.12 * row[i]
                ar, er = math.radians(a), math.radians(el)
                dirv = np.array([s * math.sin(ar) * math.cos(er), -math.cos(ar) * math.cos(er), math.sin(er)])
                root = E + dirv * r
                upv = _unit(np.array([0.0, 0.0, 1.0 if upper else -1.0]) - dirv * (dirv[2] if upper else -dirv[2]))
                side = _unit(np.cross(dirv, upv))
                u = 1.0 - (a / 70.0) ** 2
                L = (7.8 * (0.62 + 0.38 * u) if upper else 4.8 * (0.6 + 0.4 * u)) * rng.uniform(0.8, 1.1)
                curl = rng.uniform(1.1, 1.7) if upper else rng.uniform(0.5, 0.9)    # r10: curl more (r9: a splayed comb)
                fan = rng.normal(0.0, 0.10 if not stray[i] else 0.32)            # sideways tilt (strays cross)
                tt = np.linspace(0, 1, npts)
                pts = root[None] + (dirv[None] * np.cos(curl * tt)[:, None] * 0.7 + upv[None] * np.sin(curl * tt)[:, None]
                                    + side[None] * (fan * tt)[:, None]) * (L * tt)[:, None]
                paths.append(pts)
            paths = np.array(paths)
            for c in np.unique(memb):
                idx = np.nonzero((memb == c) & ~stray)[0]
                if len(idx) < 2:
                    continue
                spike = paths[idx].mean(0)
                w = rng.uniform(0.85, 0.99) * ss(0.1, 0.6, np.linspace(0, 1, npts))           # #147e: converge earlier
                paths[idx] = paths[idx] * (1.0 - w)[None, :, None] + spike[None] * w[None, :, None]
            for i in range(n):
                S.append(paths[i])
                rr = rng.uniform(0.055, 0.068)
                R.append(np.linspace(rr, 0.014, npts))
    return np.array(S), np.array(R)


def brows(face, seed=17, npts=8):
    """#147d: WET brows (r8: a dry, feathered fan of ~260 straight hairs per side). ~105 hairs per brow plastered flat on
    the skin (0.04 mm off), running medial-up -> lateral-out-and-down, gathered into 3-5 wet clumps whose tips converge;
    the hairless gap where the old scar crosses her right brow."""
    rng = np.random.default_rng(seed)
    fn = stick_fn(face, globes=False)
    S, R = [], []
    for k in (0, 1):
        s = 1.0 if k == 0 else -1.0
        n = 105
        u = np.clip(rng.beta(1.3, 1.6, n), 0.0, 1.0)                     # 0 medial -> 1 lateral (thinner laterally)
        xs = s * (15.0 + 34.0 * u)
        zc = 13.5 + 6.0 * np.sin(u * math.pi * 0.85) - 2.5 * u
        zs = zc + rng.normal(0.0, 1.0, n) * (2.6 - 1.4 * u)
        o = np.stack([xs, np.full(n, -150.0), zs], 1)
        t, h = sh.ray_hit(fn, o, np.tile(sh.V(0.0, 1.0, 0.0), (n, 1)), tmax=300.0, eps=0.02, step=0.7)
        roots = o + np.array([0, 1.0, 0]) * t[:, None]
        if k == 1:                                                       # scar gap (her right brow)
            dd = np.abs((roots[:, 0] + 21.0) * (17 / 20.8) - (roots[:, 2] - 27.0) * (-12.0 / 20.8))
            keep = dd > 1.6
        else:
            keep = np.ones(n, bool)
        nclump = int(rng.integers(3, 6))
        cu = np.sort(rng.uniform(0.05, 0.95, nclump))
        memb = np.argmin(np.abs(u[:, None] - cu[None, :]), 1)
        paths = []
        ids = []
        for i in np.nonzero(h & keep)[0]:
            ang = math.radians(70.0 - 92.0 * u[i] + rng.normal(0, 7))    # medial up, lateral out and down
            d2 = np.array([s * math.cos(ang), 0.0, math.sin(ang)])
            nn = grad(fn, roots[i][None])[0]
            d2 = _unit(d2 - nn * (d2 @ nn))
            L = rng.uniform(5.5, 9.5)
            tt = np.linspace(0, 1, npts)
            paths.append(roots[i][None] + d2[None] * (L * tt)[:, None])
            ids.append(i)
        paths = np.array(paths)
        ids = np.array(ids)
        for c in range(nclump):
            sel = np.nonzero(memb[ids] == c)[0]
            if len(sel) < 2:
                continue
            spike = paths[sel].mean(0)
            w = rng.uniform(0.5, 0.85) * ss(0.15, 0.9, np.linspace(0, 1, npts))
            paths[sel] = paths[sel] * (1.0 - w)[None, :, None] + spike[None] * w[None, :, None]
        for pth in paths:
            S.append(pth)
            R.append(np.linspace(0.040, 0.014, npts))
    S = np.array(S)
    flat = S.reshape(-1, 3)
    for _ in range(2):                                                   # plaster onto the skin: 0.04 mm off
        d = fn(flat)
        nrm = grad(fn, flat)
        flat = flat - nrm * (d - 0.04)[:, None]
    return flat.reshape(S.shape), np.array(R)
