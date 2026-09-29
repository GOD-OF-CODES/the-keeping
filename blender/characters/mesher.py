"""Sparse surface-nets mesher for our numpy SDFs (own implementation).

A coarse grid (spacing c*h) finds cells near the surface; only those are refined to spacing h and meshed with
naive surface nets: one vertex per sign-changing cell (mean of its edge crossings), one quad per sign-changing
grid edge. The result is a watertight quad mesh that follows the implicit anatomy without the folds a projected
scaffold gets; it is then relaxed/re-projected and decimated to budget in Blender.
"""
import numpy as np

_CORNERS = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]])
_EDGES = np.array([[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]])


def _pack(ijk, dims):
    return (ijk[..., 0].astype(np.int64) + dims[0] * (ijk[..., 1].astype(np.int64) + dims[1] * ijk[..., 2].astype(np.int64)))


def _lookup(sorted_keys, keys):
    idx = np.searchsorted(sorted_keys, keys)
    idx = np.clip(idx, 0, len(sorted_keys) - 1)
    ok = sorted_keys[idx] == keys
    return idx, ok


def surface_nets(fn, lo, hi, h, coarse=4, band=1.6, chunk=400000, log=None):
    lo = np.asarray(lo, float) - 2 * h * coarse
    hi = np.asarray(hi, float) + 2 * h * coarse
    H = h * coarse
    cdims = np.ceil((hi - lo) / H).astype(int) + 1
    # ---- coarse pass
    gi = np.stack(np.meshgrid(*[np.arange(n) for n in cdims], indexing='ij'), -1).reshape(-1, 3)
    cd = _eval(fn, lo + gi * H, chunk)
    cvals = cd.reshape(tuple(cdims))
    # near-surface coarse cells: any corner within band*H or a sign change
    near = np.zeros(tuple(cdims - 1), bool)
    mn = np.full(tuple(cdims - 1), np.inf)
    sg_pos = np.zeros(tuple(cdims - 1), bool)
    sg_neg = np.zeros(tuple(cdims - 1), bool)
    for c in _CORNERS:
        v = cvals[c[0]:c[0] + cdims[0] - 1, c[1]:c[1] + cdims[1] - 1, c[2]:c[2] + cdims[2] - 1]
        mn = np.minimum(mn, np.abs(v))
        sg_pos |= v > 0
        sg_neg |= v <= 0
    near = (mn < band * H) | (sg_pos & sg_neg)
    cells_c = np.argwhere(near)
    if log:
        log(f'mesher: coarse {tuple(cdims)} -> {len(cells_c)} near cells')
    # ---- fine nodes
    fdims = (cdims - 1) * coarse + 1
    offs = np.stack(np.meshgrid(*[np.arange(coarse + 1)] * 3, indexing='ij'), -1).reshape(-1, 3)
    keys = []
    for s in range(0, len(cells_c), 20000):
        base = cells_c[s:s + 20000] * coarse
        keys.append(np.unique(_pack((base[:, None, :] + offs[None]).reshape(-1, 3), fdims)))
    nkeys = np.unique(np.concatenate(keys))
    nijk = np.stack([nkeys % fdims[0], (nkeys // fdims[0]) % fdims[1], nkeys // (fdims[0] * fdims[1])], 1)
    npos = lo + nijk * h
    nval = _eval(fn, npos, chunk)
    if log:
        log(f'mesher: {len(nkeys)} fine nodes')
    # ---- fine cells (min corner = node) with all 8 corners present
    cidx = np.empty((len(nkeys), 8), np.int64)
    cok = np.ones(len(nkeys), bool)
    for ci, c in enumerate(_CORNERS):
        k2 = _pack(nijk + c, fdims)
        idx, ok = _lookup(nkeys, k2)
        cidx[:, ci] = idx
        cok &= ok
    vals = nval[cidx]
    inside = vals < 0
    active = cok & inside.any(1) & (~inside).any(1)
    act = np.nonzero(active)[0]
    # vertex per active cell: mean of edge crossings
    a = cidx[act][:, _EDGES[:, 0]]
    b = cidx[act][:, _EDGES[:, 1]]
    va, vb = nval[a], nval[b]
    cross = (va < 0) != (vb < 0)
    t = np.where(cross, va / np.where(cross, va - vb, 1.0), 0.0)
    pa, pb = npos[a], npos[b]
    pts = pa + (pb - pa) * t[..., None]
    w = cross.astype(float)
    verts = (pts * w[..., None]).sum(1) / np.maximum(w.sum(1), 1)[:, None]
    cell_key = nkeys[act]            # cell keyed by its min-corner node
    order = np.argsort(cell_key)
    cell_key_s = cell_key[order]
    # ---- quads: for every node edge (+x, +y, +z) with a sign change, the 4 cells around it
    quads = []
    for axis in range(3):
        e = np.zeros(3, int)
        e[axis] = 1
        k2 = _pack(nijk + e, fdims)
        idx, ok = _lookup(nkeys, k2)
        s0 = nval < 0
        s1 = nval[idx] < 0
        ch = ok & (s0 != s1)
        base = nijk[ch]
        flip = s0[ch]
        u, v = [(1, 2), (2, 0), (0, 1)][axis]
        du = np.zeros(3, int)
        du[u] = 1
        dv = np.zeros(3, int)
        dv[v] = 1
        corners = [base - du - dv, base - dv, base, base - du]
        ids = []
        good = np.ones(len(base), bool)
        for c in corners:
            ck = _pack(c, fdims)
            j, okc = _lookup(cell_key_s, ck)
            good &= okc & (c >= 0).all(1)
            ids.append(order[j])
        q = np.stack(ids, 1)[good]
        fl = flip[good]
        q[fl] = q[fl][:, ::-1]
        quads.append(q)
    quads = np.concatenate(quads)
    if log:
        log(f'mesher: {len(verts)} verts, {len(quads)} quads')
    return verts, quads


def _eval(fn, P, chunk):
    out = np.empty(len(P))
    for s in range(0, len(P), chunk):
        out[s:s + chunk] = fn(P[s:s + chunk])
    return out


def bounded(fn, lo, hi, margin=0.02):
    """Evaluate fn only inside an AABB (+margin); outside, return the distance to the box (a lower bound)."""
    lo = np.asarray(lo, float) - margin
    hi = np.asarray(hi, float) + margin

    def g(P):
        q = np.maximum(np.maximum(lo - P, P - hi), 0.0)
        dbox = np.sqrt((q * q).sum(1))
        out = dbox + margin
        m = dbox <= 0
        if m.any():
            out[m] = fn(P[m])
        return out
    return g
