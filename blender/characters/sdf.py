"""Tiny numpy signed-distance toolkit used to sculpt character meshes by script.

Every primitive takes P: (N, 3) float64 array and returns (N,) distances (negative inside). Most are exact; the
tapered-ellipse limb is an approximation that is accurate near the surface, which is all the projection needs.
The body generators compose these with smooth unions (smin) into one implicit anatomy, then project a Skin-modifier
scaffold mesh onto its zero set (project()).
"""
import numpy as np


def V(*a):
    return np.array(a, dtype=np.float64)


def norm(x, axis=-1):
    return np.sqrt((x * x).sum(axis))


def smin(a, b, k):
    """Polynomial smooth minimum (union). k = blend radius in metres."""
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def sub(a, b, k=0.0):
    """a minus b (smooth when k > 0)."""
    return smax(a, -b, k)


def sphere(P, c, r):
    return norm(P - c) - r


def frame(fwd, up):
    """Orthonormal rows (x, y, z) with y = fwd, z ~ up."""
    y = np.asarray(fwd, float)
    y = y / np.linalg.norm(y)
    z = np.asarray(up, float)
    z = z - y * z.dot(y)
    z = z / np.linalg.norm(z)
    x = np.cross(y, z)
    return np.stack([x, y, z])


def to_local(P, c, R):
    """World points -> local coords of a frame with rows R (x, y, z axes) at origin c."""
    return (P - c) @ R.T


def ellipsoid(P, c, radii, R=None):
    """Approximate ellipsoid SDF (iq): good near the surface. R = rows frame (default world axes)."""
    q = P - c if R is None else to_local(P, c, R)
    r = np.asarray(radii, float)
    k0 = norm(q / r)
    k1 = norm(q / (r * r))
    return np.where(k1 > 1e-12, k0 * (k0 - 1.0) / np.maximum(k1, 1e-12), -r.min())


def capsule(P, a, b, r):
    pa = P - a
    ba = b - a
    h = np.clip((pa @ ba) / ba.dot(ba), 0.0, 1.0)
    return norm(pa - h[:, None] * ba) - r


def round_cone(P, a, b, r1, r2):
    """Exact round cone (iq): sphere r1 at a, sphere r2 at b, tangent cone between."""
    ba = b - a
    l2 = ba.dot(ba)
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    pa = P - a
    y = pa @ ba
    z = y - l2
    xv = pa * l2 - y[:, None] * ba
    x2 = (xv * xv).sum(1)
    y2 = y * y * l2
    z2 = z * z * l2
    k = np.sign(rr) * rr * rr * x2
    d1 = np.sqrt(x2 + z2) * il2 - r2
    d2 = np.sqrt(x2 + y2) * il2 - r1
    d3 = (np.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1
    out = np.where(np.sign(z) * a2 * z2 > k, d1, np.where(np.sign(y) * a2 * y2 < k, d2, d3))
    return out


def round_box(P, c, half, r, R=None):
    q = np.abs(P - c if R is None else to_local(P, c, R)) - (np.asarray(half, float) - r)
    return norm(np.maximum(q, 0.0)) + np.minimum(q.max(1), 0.0) - r


def plane(P, point, normal):
    n = np.asarray(normal, float)
    n = n / np.linalg.norm(n)
    return (P - point) @ n


def densify(rows, step=0.02):
    """Catmull-Rom resample of a (t|z, ...) table so interpolated profiles have no kinks."""
    rows = np.asarray(rows, float)
    if len(rows) < 3:
        return rows
    x = rows[:, 0]
    out = []
    n = len(rows)
    for i in range(n - 1):
        p0 = rows[max(i - 1, 0)]
        p1, p2 = rows[i], rows[i + 1]
        p3 = rows[min(i + 2, n - 1)]
        m = max(2, int(np.ceil((x[i + 1] - x[i]) / step)))
        for k in range(m):
            t = k / m
            t2, t3 = t * t, t * t * t
            v = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
            v[0] = x[i] + (x[i + 1] - x[i]) * t
            out.append(v)
    out.append(rows[-1])
    return np.array(out)


def limb(P, a, b, front, rows, ends=0.0, power=2.0):
    """Tapered limb along a->b with an asymmetric elliptical section.

    front: world vector for the section's 'front' (made perpendicular to the axis); 'out' = axis x front.
    rows: list of (t, front, back, out, in) half-thicknesses (metres), t in [0, 1] along a->b, linearly interpolated.
    ends: how far (fraction of length) the flat caps sit past the table ends.
    power: superellipse exponent of the section (2 = ellipse, >2 boxier).
    Returns an approximate SDF (radial difference scaled by the local radius gradient).
    """
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    ax = b - a
    L = np.linalg.norm(ax)
    d = ax / L
    f = np.asarray(front, float)
    f = f - d * f.dot(d)
    f /= np.linalg.norm(f)
    o = np.cross(d, f)
    q = P - a
    t = (q @ d) / L
    y = q @ f
    x = q @ o
    rows = densify(rows, 0.04)
    ts = rows[:, 0]
    tc = np.clip(t, ts[0], ts[-1])
    rf = np.interp(tc, ts, rows[:, 1])
    rb = np.interp(tc, ts, rows[:, 2])
    ro = np.interp(tc, ts, rows[:, 3])
    ri = np.interp(tc, ts, rows[:, 4])
    ry = np.where(y >= 0, rf, rb)
    rx = np.where(x >= 0, ro, ri)
    r = np.sqrt(x * x + y * y)
    ang_c = np.where(r > 1e-9, np.abs(x) / np.maximum(r, 1e-9), 0.0)
    ang_s = np.where(r > 1e-9, np.abs(y) / np.maximum(r, 1e-9), 1.0)
    # superellipse radius in direction (cos, sin)
    R = (np.power(ang_c / rx, power) + np.power(ang_s / ry, power)) ** (-1.0 / power)
    side = r - R
    along = np.maximum((ts[0] - ends) * L - t * L, t * L - (ts[-1] + ends) * L)
    return np.minimum(np.maximum(side, along), 0.0) + np.sqrt(np.maximum(side, 0.0) ** 2 + np.maximum(along, 0.0) ** 2)


def sweep(P, rows, power=2.0):
    """Vertical sweep (torso): rows (z, cy, side, front, back[, cx]) — section centred at (cx, cy) at height z.

    'front' is toward -Y (the character faces -Y). Returns an approximate SDF (radial difference). Open at the
    ends: combine with caps/smin as needed (clamped to the end sections beyond the table).
    """
    rows = densify(rows, 0.01)
    z = np.clip(P[:, 2], rows[0, 0], rows[-1, 0])
    cy = np.interp(z, rows[:, 0], rows[:, 1])
    sx = np.interp(z, rows[:, 0], rows[:, 2])
    fr = np.interp(z, rows[:, 0], rows[:, 3])
    bk = np.interp(z, rows[:, 0], rows[:, 4])
    x = P[:, 0]
    y = cy - P[:, 1]          # + = front
    ry = np.where(y >= 0, fr, bk)
    r = np.sqrt(x * x + y * y)
    c = np.where(r > 1e-9, np.abs(x) / np.maximum(r, 1e-9), 0.0)
    s = np.where(r > 1e-9, np.abs(y) / np.maximum(r, 1e-9), 1.0)
    R = (np.power(c / sx, power) + np.power(s / ry, power)) ** (-1.0 / power)
    side = r - R
    along = np.maximum(rows[0, 0] - P[:, 2], P[:, 2] - rows[-1, 0])
    return np.minimum(np.maximum(side, along), 0.0) + np.sqrt(np.maximum(side, 0.0) ** 2 + np.maximum(along, 0.0) ** 2)


def gradient(fn, P, h=5e-4):
    g = np.empty_like(P)
    for i in range(3):
        e = np.zeros(3)
        e[i] = h
        g[:, i] = (fn(P + e) - fn(P - e)) / (2 * h)
    return g


def project(fn, P, iters=6, step=1.0, max_move=None):
    """Move points onto fn's zero set along the (numerical) gradient."""
    P = P.copy()
    for _ in range(iters):
        d = fn(P)
        g = gradient(fn, P)
        gl2 = np.maximum((g * g).sum(1), 1e-8)
        mv = (step * d / gl2)[:, None] * g
        if max_move is not None:
            ml = norm(mv)
            mv *= np.minimum(1.0, max_move / np.maximum(ml, 1e-12))[:, None]
        P -= mv
    return P
