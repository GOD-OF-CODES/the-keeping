"""Island-aware lightmap fill (FINAL-BAKE #152: the U3 / U4T orange "leak lines").

Root cause it fixes: Cycles bakes a texel only when its CENTRE lies inside a triangle (we bake with margin 0). In the
house atlases most UV islands are moulding / trim profile facets, jamb slivers and prop cords thinner than one texel
(LM_UPPER_ROOMS @1024: 2103 of 3254 islands < 1 texel, 1395 cover no texel centre at all). Their runtime bilinear
footprint then held whatever the old global 8-neighbour dilation (lib/bake.dilate) and the whole-atlas OIDN carried
over from the NEIGHBOURING islands of the shelf packing — in LM_UPPER_ROOMS that is U2's lamp-lit trim (L_LAMP_U2,
60 W 2100 K), so U3's baseboards, jambs, cords and posts showed glowing orange dashed lines; in LM_KITCHEN the dark
U4T landing took G3's kitchen light the same way.

What this module does instead (pure numpy; bpy only in tri_arrays):
  1. `analyse(objs, size)`: island label per texel by the texel-centre rule (the same rule Cycles bakes with), the
     world point + normal of every covered texel, and a CONSERVATIVE raster (every texel a triangle touches).
  2. `fill(rgba, mask, isl)`: every texel an island touches but Cycles did not bake (whole sub-texel islands, the
     gaps of partly covered strips) is seeded from the 3D-nearest baked texels — same island first, then same object
     with a compatible normal (the floor beside a baseboard facet, the cord's own post) — and becomes covered (mask 1,
     so tier downsamples weight it like a baked texel); then every gutter texel is grown from ONE island only (never
     an average of two islands).
  3. The same dilation runs again after OIDN (`refill`) so the denoiser's cross-island blur is cut out of every
     island's bilinear footprint.
Rows are bottom-up (Blender pixel order): texel (x, y) has its centre at uv ((x + .5) / W, (y + .5) / H).
"""
import time

import numpy as np

try:
    from .scene import log
except Exception:  # offline (numpy-only) use outside Blender
    def log(*a):
        print('[keeping]', *a, flush=True)

NEIGH8 = ((-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1))


# ------------------------------------------------------------------ geometry extraction (bpy)
def tri_arrays(objs, uv_layer='Lightmap'):
    """Per triangle: uv (T,3,2), world positions (T,3,3), world normal (T,3), island id (T,), object index (T,)."""
    uvs, pos, nrm, isl, obj = [], [], [], [], []
    base = 0
    for oi, ob in enumerate(objs):
        me = ob.data
        me.calc_loop_triangles()
        nt = len(me.loop_triangles)
        if not nt:
            continue
        loops = np.empty(nt * 3, np.int64)
        me.loop_triangles.foreach_get('loops', loops)
        verts = np.empty(nt * 3, np.int64)
        me.loop_triangles.foreach_get('vertices', verts)
        tn = np.empty(nt * 3, np.float32)
        me.loop_triangles.foreach_get('normal', tn)
        luv = np.empty(len(me.loops) * 2, np.float32)
        me.uv_layers[uv_layer].data.foreach_get('uv', luv)
        luv = luv.reshape(-1, 2)
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get('co', co)
        mw = np.array(ob.matrix_world, np.float64)
        co = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
        nm = np.linalg.inv(mw[:3, :3]).T
        tn = tn.reshape(-1, 3) @ nm.T
        tn /= np.maximum(np.linalg.norm(tn, axis=1, keepdims=True), 1e-12)
        loops = loops.reshape(-1, 3)
        verts = verts.reshape(-1, 3)
        uvs.append(luv[loops])
        pos.append(co[verts])
        nrm.append(tn)
        obj.append(np.full(nt, oi, np.int32))
        isl.append(_uv_islands(luv, loops, verts) + base)
        base = int(isl[-1].max()) + 1
    return {'uv': np.concatenate(uvs).astype(np.float64), 'pos': np.concatenate(pos), 'nrm': np.concatenate(nrm),
            'island': np.concatenate(isl), 'obj': np.concatenate(obj)}


def _uv_islands(luv, loops, verts):
    """Triangles connected through a shared vertex with an identical Lightmap UV -> one island (label propagation)."""
    q = np.round(luv[loops.ravel()] * (1 << 20)).astype(np.int64)
    key = np.stack([verts.ravel(), q[:, 0], q[:, 1]], 1)
    _, kid = np.unique(key, axis=0, return_inverse=True)
    kid = kid.reshape(-1, 3)
    nt = len(loops)
    lab = np.arange(nt, dtype=np.int64)
    klab = np.full(int(kid.max()) + 1, nt, np.int64)
    for _ in range(100000):
        np.minimum.at(klab, kid.ravel(), np.repeat(lab, 3))
        new = np.minimum(lab, klab[kid].min(1))
        if np.array_equal(new, lab):
            break
        lab = new
    _, out = np.unique(lab, return_inverse=True)
    return out.astype(np.int32)


# ------------------------------------------------------------------ rasterisation (numpy)
def _bary(px, py, A, B, C):
    """Barycentrics of points (N,K) against triangles A,B,C (N,2)."""
    area = (B[:, 0] - A[:, 0]) * (C[:, 1] - A[:, 1]) - (C[:, 0] - A[:, 0]) * (B[:, 1] - A[:, 1])
    area = np.where(np.abs(area) < 1e-20, 1e-20, area)[:, None]
    l1 = ((B[:, 0:1] - px) * (C[:, 1:2] - py) - (C[:, 0:1] - px) * (B[:, 1:2] - py)) / area
    l2 = ((C[:, 0:1] - px) * (A[:, 1:2] - py) - (A[:, 0:1] - px) * (C[:, 1:2] - py)) / area
    return l1, l2, 1.0 - l1 - l2


def _groups(side, budget=1 << 20):
    """Triangles sorted by bbox side, grouped so that count * side^2 stays under `budget` candidate texels."""
    order = np.argsort(side, kind='stable')
    i, n = 0, len(order)
    while i < n:
        j = i + 1
        while j < n and (j - i + 1) * int(side[order[j]]) ** 2 <= budget:
            j += 1
        yield order[i:j], int(side[order[j - 1]])
        i = j


def raster_centres(uvpx, W, H):
    """Texel-centre raster (the rule Cycles bakes with) of triangles in texel units.
    Returns (texel flat index, tri index, l1, l2, l3)."""
    lo = np.floor(uvpx.min(1) - 0.5).astype(np.int64)
    hi = np.ceil(uvpx.max(1) - 0.5).astype(np.int64)
    side = np.maximum(np.maximum(hi - lo + 1, 1).max(1), 1)
    out = []
    for sel, kk in _groups(side):
        gx, gy = np.meshgrid(np.arange(kk), np.arange(kk))
        px = lo[sel, 0:1] + gx.ravel()[None] + 0.5
        py = lo[sel, 1:2] + gy.ravel()[None] + 0.5
        l1, l2, l3 = _bary(px, py, uvpx[sel, 0], uvpx[sel, 1], uvpx[sel, 2])
        ok = (l1 >= -1e-7) & (l2 >= -1e-7) & (l3 >= -1e-7) & (px > 0) & (py > 0) & (px < W) & (py < H)
        r, c = np.nonzero(ok)
        if len(r):
            out.append(((py[r, c] - 0.5).astype(np.int64) * W + (px[r, c] - 0.5).astype(np.int64), sel[r],
                        l1[r, c], l2[r, c], l3[r, c]))
    if not out:
        z = np.zeros(0)
        return z.astype(np.int64), z.astype(np.int64), z, z, z
    return tuple(np.concatenate([o[k] for o in out]) for k in range(5))


def raster_touch(uvpx, W, H, eps=1e-6):
    """Conservative raster: every texel square the triangle overlaps (separating-axis test against the 3 edge
    normals; the bbox axes are implied by the candidate range). Returns (texel flat index, tri index, l1, l2, l3)
    with the texel centre's barycentrics clamped into the triangle (a point on the surface near that texel)."""
    lo = np.floor(uvpx.min(1)).astype(np.int64)
    hi = np.floor(uvpx.max(1)).astype(np.int64)
    side = np.maximum(np.maximum(hi - lo + 1, 1).max(1), 1)
    corners = np.array([[0, 0], [1, 0], [0, 1], [1, 1]], np.float64)
    out = []
    for sel, kk in _groups(side):
        gx, gy = np.meshgrid(np.arange(kk), np.arange(kk))
        X = lo[sel, 0:1] + gx.ravel()[None]
        Y = lo[sel, 1:2] + gy.ravel()[None]
        T = uvpx[sel]
        ok = (X <= hi[sel, 0:1]) & (Y <= hi[sel, 1:2]) & (X >= 0) & (Y >= 0) & (X < W) & (Y < H)
        for e in range(3):
            a, b = T[:, e], T[:, (e + 1) % 3]
            n = np.stack([-(b[:, 1] - a[:, 1]), b[:, 0] - a[:, 0]], 1)
            tp = np.einsum('tvk,tk->tv', T, n)
            tmin, tmax = tp.min(1)[:, None], tp.max(1)[:, None]
            base = X * n[:, 0:1] + Y * n[:, 1:2]
            cp = corners @ n.T                                     # (4, t)
            smin = base + cp.min(0)[:, None]
            smax = base + cp.max(0)[:, None]
            ok &= (smax >= tmin - eps) & (smin <= tmax + eps)
        r, c = np.nonzero(ok)
        if not len(r):
            continue
        px, py = X[r, c] + 0.5, Y[r, c] + 0.5
        A, B, C = T[r, 0], T[r, 1], T[r, 2]
        l1, l2, l3 = _bary(px[:, None], py[:, None], A, B, C)
        L = np.maximum(np.concatenate([l1, l2, l3], 1), 0.0)
        L /= np.maximum(L.sum(1, keepdims=True), 1e-12)
        out.append((Y[r, c] * W + X[r, c], sel[r], L[:, 0], L[:, 1], L[:, 2]))
    if not out:
        z = np.zeros(0)
        return z.astype(np.int64), z.astype(np.int64), z, z, z
    return tuple(np.concatenate([o[k] for o in out]) for k in range(5))


# ------------------------------------------------------------------ analysis
def analyse(objs, size, uv_layer='Lightmap'):
    return analyse_tris(tri_arrays(objs, uv_layer), size)


def analyse_tris(T, size):
    t0 = time.perf_counter()
    W = H = size
    uvpx = T['uv'] * np.array([W, H], np.float64)
    q, tri, l1, l2, l3 = raster_centres(uvpx, W, H)
    label = np.full(W * H, -1, np.int32)
    label[q] = T['island'][tri]
    posc = np.zeros((W * H, 3), np.float32)
    nrmc = np.zeros((W * H, 3), np.float32)
    P = T['pos'][tri]
    posc[q] = P[:, 0] * l1[:, None] + P[:, 1] * l2[:, None] + P[:, 2] * l3[:, None]
    nrmc[q] = T['nrm'][tri]
    objc = np.full(W * H, -1, np.int32)
    objc[q] = T['obj'][tri]
    n_isl = int(T['island'].max()) + 1
    covered_isl = np.zeros(n_isl, bool)
    covered_isl[label[label >= 0]] = True
    # every texel a triangle touches but whose centre no triangle covers: the part of each island's bilinear
    # footprint Cycles never bakes (whole islands thinner than a texel, the dashed edges of partly covered strips)
    zq, zt, z1, z2, z3 = raster_touch(uvpx, W, H)
    keep = label[zq] < 0
    zq, zt, z1, z2, z3 = zq[keep], zt[keep], z1[keep], z2[keep], z3[keep]
    _, first = np.unique(zq * (n_isl + 1) + T['island'][zt], return_index=True)   # one sample per (texel, island)
    zq, zt, z1, z2, z3 = zq[first], zt[first], z1[first], z2[first], z3[first]
    ZP = T['pos'][zt]
    zpos = ZP[:, 0] * z1[:, None] + ZP[:, 1] * z2[:, None] + ZP[:, 2] * z3[:, None]
    info = {'triangles': int(len(uvpx)), 'islands': n_isl, 'islands_zero_coverage': int((~covered_isl).sum()),
            'covered_texels': int((label >= 0).sum()), 'seed_texels': int(len(np.unique(zq))),
            'seconds': round(time.perf_counter() - t0, 2)}
    log(f'islands: {info}')
    return {'W': W, 'H': H, 'label': label, 'pos': posc, 'nrm': nrmc, 'obj': objc,
            'zero_q': zq, 'zero_island': T['island'][zt], 'zero_pos': zpos.astype(np.float32),
            'zero_nrm': T['nrm'][zt].astype(np.float32), 'zero_obj': T['obj'][zt], 'info': info}


# ------------------------------------------------------------------ fill
def _knn(P, Q, k, cell):
    """k nearest points of P for every query in Q (3D), via a uniform grid of `cell` metres (27-cell neighbourhood;
    queries with no candidate there fall back to a brute-force scan). Returns (len(Q), k) indices, -1 padded."""
    out = np.full((len(Q), k), -1, np.int64)
    if not len(P) or not len(Q):
        return out
    try:                                   # inside Blender: mathutils' C KD-tree (~1 s per million points)
        from mathutils import kdtree
        kd = kdtree.KDTree(len(P))
        for i, p in enumerate(P.tolist()):
            kd.insert(p, i)
        kd.balance()
        for j, q in enumerate(Q.tolist()):
            hits = kd.find_n(q, k)
            if hits:
                out[j, :len(hits)] = [h[1] for h in hits]
        return out
    except ImportError:
        pass
    kp = np.floor(P / cell).astype(np.int64)
    kq = np.floor(Q / cell).astype(np.int64)
    M = 1 << 20
    enc = lambda a: ((a[..., 0] + M // 2) * M + (a[..., 1] + M // 2)) * M + (a[..., 2] + M // 2)  # noqa: E731
    ep = enc(kp)
    order = np.argsort(ep, kind='stable')
    eps_ = ep[order]
    uk, start = np.unique(eps_, return_index=True)
    stop = np.append(start[1:], len(eps_))
    eq = enc(kq)
    uq, inv = np.unique(eq, return_inverse=True)
    offs = np.array([(i, j, l) for i in (-1, 0, 1) for j in (-1, 0, 1) for l in (-1, 0, 1)], np.int64)
    qcell = kq[np.unique(inv, return_index=True)[1]]
    missing = []
    for ci in range(len(uq)):
        keys = enc(qcell[ci] + offs)
        pos = np.searchsorted(uk, keys)
        pos = np.minimum(pos, len(uk) - 1)
        hit = uk[pos] == keys
        cand = np.concatenate([order[start[p]:stop[p]] for p in pos[hit]]) if hit.any() else np.zeros(0, np.int64)
        qi = np.flatnonzero(inv == ci)
        if not len(cand):
            missing.extend(qi.tolist())
            continue
        d = ((Q[qi][:, None, :] - P[cand][None]) ** 2).sum(-1)
        kk = min(k, len(cand))
        part = np.argpartition(d, kk - 1, axis=1)[:, :kk]
        dd = np.take_along_axis(d, part, 1)
        srt = np.argsort(dd, 1)
        out[qi, :kk] = cand[np.take_along_axis(part, srt, 1)]
    if missing:
        qi = np.array(missing, np.int64)
        if cell < 2.0:                      # widen the grid for the few far queries
            out[qi] = _knn(P, Q[qi], k, cell * 4)
        else:
            for s0 in range(0, len(qi), 64):
                q = qi[s0:s0 + 64]
                d = ((Q[q][:, None, :] - P[None]) ** 2).sum(-1)
                kk = min(k, len(P))
                part = np.argpartition(d, kk - 1, axis=1)[:, :kk]
                srt = np.argsort(np.take_along_axis(d, part, 1), 1)
                out[q, :kk] = np.take_along_axis(part, srt, 1)
    return out


def _seed_values(rgb, cov, isl, k=24, cell=0.08):
    """Values for the zero-coverage islands' texels: mean of up to 4 of the k 3D-nearest covered texels whose normal
    is compatible (dot >= 0.3), preferring the same object. Returns (texel idx, label, rgb)."""
    zq = isl['zero_q']
    if not len(zq):
        return zq, zq.astype(np.int32), np.zeros((0, 3), np.float32)
    idx = np.flatnonzero(cov)
    nn = _knn(isl['pos'][idx].astype(np.float64), isl['zero_pos'].astype(np.float64), k, cell)
    valid = nn >= 0
    ids = np.where(valid, nn, 0)
    dots = np.einsum('qkc,qc->qk', isl['nrm'][idx][ids], isl['zero_nrm'])
    same = isl['obj'][idx][ids] == isl['zero_obj'][:, None]
    own = isl['label'][idx][ids] == isl['zero_island'][:, None]
    out = np.zeros((len(zq), 3), np.float64)
    done = np.zeros(len(zq), bool)
    for cond in (valid & own, valid & (dots >= 0.3) & same, valid & (dots >= 0.3), valid):
        rank = np.cumsum(cond, 1)
        use = cond & (rank <= 4)
        n = use.sum(1)
        todo = (~done) & (n > 0)
        if todo.any():
            v = rgb[idx][ids] * use[..., None]
            out[todo] = v[todo].sum(1) / n[todo][:, None]
            done |= todo
    # one value per (texel, island): average duplicates
    M = int(isl['zero_island'].max()) + 2
    key = zq.astype(np.int64) * M + isl['zero_island']
    uk, inv = np.unique(key, return_inverse=True)
    acc = np.zeros((len(uk), 3), np.float64)
    np.add.at(acc, inv, out)
    cnt = np.bincount(inv, minlength=len(uk))[:, None]
    return (uk // M).astype(np.int64), (uk % M).astype(np.int32), (acc / cnt).astype(np.float32)


def island_dilate(rgb, label, has=None, iterations=16, only=None):
    """Grow texels that have a value into those that do not, one island at a time. A texel with a label but no value
    (a pre-labelled footprint texel) only takes values from neighbours of ITS island; an unlabelled texel takes the
    first valued neighbour's island (fixed order) and the mean of that island's valued neighbours — never an average
    of two islands. rgb (H*W,3), label (H*W,), has (H*W,) bool (default label >= 0) -> updated in place."""
    H = W = int(round(np.sqrt(len(label))))
    if has is None:
        has = label >= 0
    for _ in range(iterations):
        h2 = has.reshape(H, W)
        pad = np.pad(h2, 1)
        near = np.zeros_like(h2)
        for dx, dy in NEIGH8:
            near |= pad[1 + dy:1 + dy + H, 1 + dx:1 + dx + W]
        fr = (near & ~h2).ravel()
        if only is not None:
            fr &= only
        free = np.flatnonzero(fr)
        if not len(free):
            break
        fx, fy = free % W, free // W
        want = label[free]
        best = want.copy()
        nb = []
        for dx, dy in NEIGH8:
            x, y = fx + dx, fy + dy
            ok = (x >= 0) & (y >= 0) & (x < W) & (y < H)
            qq = np.where(ok, y * W + x, 0)
            lb = np.where(ok & has[qq], label[qq], -1)
            nb.append((qq, lb))
            best = np.where((best < 0) & (lb >= 0), lb, best)
        acc = np.zeros((len(free), 3), np.float64)
        cnt = np.zeros(len(free), np.float64)
        for qq, lb in nb:
            m = (lb == best) & (lb >= 0)
            acc[m] += rgb[qq[m]]
            cnt[m] += 1
        g = cnt > 0
        if not g.any():
            break
        rgb[free[g]] = (acc[g] / cnt[g][:, None]).astype(rgb.dtype)
        label[free[g]] = best[g]
        has[free[g]] = True
    return rgb, label, has


def fill(rgba, mask, isl, iterations=16, strip_iterations=64):
    """Bake output (H,W,4) + Cycles coverage mask -> island-filled rgba, new mask (baked + footprint), label map."""
    t0 = time.perf_counter()
    H, W = mask.shape
    rgb = rgba[..., :3].reshape(-1, 3).astype(np.float32).copy()
    cov = mask.ravel().copy()
    label = isl['label'].copy()
    mine = label >= 0
    agree = {'cycles_texels': int(cov.sum()), 'raster_texels': int(mine.sum()),
             'cycles_not_raster': int((cov & ~mine).sum()), 'raster_not_cycles': int((mine & ~cov).sum())}
    log(f'islands: texel-centre raster vs Cycles coverage {agree}')
    label[~cov] = -1
    orphan = cov & (label < 0)          # baked by Cycles, missed by our raster (edge ties): neighbour's island
    if orphan.any():
        tmp = label.copy()
        _, tmp, _ = island_dilate(np.zeros((W * H, 3), np.float32), tmp, iterations=2)
        label[orphan] = tmp[orphan]
        cov &= label >= 0
    n_isl = int(max(isl['label'].max(), isl['zero_island'].max() if len(isl['zero_island']) else 0)) + 1
    baked_isl = np.zeros(n_isl, bool)
    baked_isl[label[cov]] = True
    zq, zi = isl['zero_q'], isl['zero_island']
    free = ~cov[zq]
    # (a) footprint texels of islands Cycles baked somewhere: label only, values come from their own baked texels
    a = free & baked_isl[zi]
    label[zq[a]] = zi[a]
    # (b) islands Cycles never baked: values from the 3D-nearest baked texels (same object, compatible normal first)
    b = free & ~baked_isl[zi]
    sub = {k: (v[b] if k.startswith('zero_') else v) for k, v in isl.items()}
    q, lab, val = _seed_values(rgb, cov & (isl['label'] >= 0), sub)
    rgb[q] = val
    label[q] = lab
    pre = np.zeros(W * H, bool)
    pre[zq[a]] = True
    pre[q] = True
    has = cov.copy()
    has[q] = True
    rgb[~has] = 0.0
    # strips first: a labelled footprint texel takes values from its own island only (along the strip)
    rgb, label, has = island_dilate(rgb, label, has, strip_iterations, only=pre)
    left = pre & ~has
    if left.any():                       # footprint texels too far along their strip: their island's mean
        v = has & (label >= 0)
        sums = np.zeros((n_isl, 3))
        cnts = np.zeros(n_isl)
        np.add.at(sums, label[v], rgb[v])
        np.add.at(cnts, label[v], 1)
        li = label[left]
        rgb[left] = (sums[li] / np.maximum(cnts[li], 1)[:, None]).astype(np.float32)
        has[left] = True
    cov = cov | pre                      # baked + footprint: weighted like baked texels by tier downsamples
    label[~cov] = -1
    has = cov.copy()
    rgb, label, has = island_dilate(rgb, label, has, iterations)        # gutters, one island per texel
    out = np.empty_like(rgba)
    out[..., :3] = rgb.reshape(H, W, 3)
    out[..., 3] = cov.reshape(H, W).astype(np.float32)
    empty = ~has.reshape(H, W)
    if empty.any() and cov.any():
        out[..., :3][empty] = rgb[cov].mean(0)
    log(f'islands fill: {int(a.sum())} footprint texels of baked islands, {len(q)} of {int((~baked_isl).sum())} '
        f'unbaked islands, {time.perf_counter() - t0:.1f} s')
    return out, cov.reshape(H, W), label.reshape(H, W)


def refill(rgba, cov, label_full, iterations=16):
    """After the denoiser: rebuild every uncovered texel from its own island's (denoised) covered texels."""
    H, W = cov.shape
    rgb = rgba[..., :3].reshape(-1, 3).copy()
    label = label_full.ravel().copy()
    label[~cov.ravel()] = -1
    rgb, label, has = island_dilate(rgb, label, None, iterations)
    out = rgba.copy()
    out[..., :3] = rgb.reshape(H, W, 3)
    return out


def downsample_labels(label, factor):
    """Label of each factor x factor block = the most common label of its labelled texels (-1 if none)."""
    if factor == 1:
        return label.copy()
    H, W = label.shape
    b = label.reshape(H // factor, factor, W // factor, factor).transpose(0, 2, 1, 3).reshape(H // factor, W // factor, -1)
    out = np.full(b.shape[:2], -1, np.int32)
    best = np.zeros(b.shape[:2], np.int32)
    for k in range(b.shape[2]):
        cand = b[..., k]
        cnt = (b == cand[..., None]).sum(-1)
        upd = (cand >= 0) & (cnt > best)
        out = np.where(upd, cand, out)
        best = np.where(upd, cnt, best)
    return out
