"""Vectorised numpy noise for texture generation evaluated on baked texel positions (our own implementation).

  perlin(P, seed)            3D gradient noise in [-1, 1] approx, P: (N, 3)
  fbm(P, octaves, seed)      fractal sum (normalised to about [-1, 1])
  ridged(P, octaves, seed)   ridged multifractal in [0, 1] (veins, cracks, folds)
  worley(P, seed)            (F1, F2) cellular distances (pores, cells, clumps)
  hash01(ints, seed)         deterministic per-integer random in [0, 1)
"""
import numpy as np

_GRAD = np.array([[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
                  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1], [1, 1, 0], [-1, 1, 0], [0, -1, 1], [0, -1, -1]],
                 np.float64)


def _hash(ix, iy, iz, seed):
    h = (ix.astype(np.int64) * 73856093) ^ (iy.astype(np.int64) * 19349663) ^ (iz.astype(np.int64) * 83492791) ^ (seed * 2654435761)
    h = (h ^ (h >> 13)) * 1274126177
    h = h ^ (h >> 16)
    return h & 0x7FFFFFFF


def hash01(i, seed=0):
    i = np.asarray(i, np.int64)
    return (_hash(i, i * 7 + 3, i * 13 + 5, seed) % 1000003) / 1000003.0


def _fade(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def perlin(P, seed=0):
    P = np.asarray(P, np.float64)
    i0 = np.floor(P).astype(np.int64)
    f = P - i0
    u = _fade(f)
    out = np.zeros(len(P))
    acc = {}
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                g = _GRAD[_hash(i0[:, 0] + dx, i0[:, 1] + dy, i0[:, 2] + dz, seed) & 15]
                d = f - np.array([dx, dy, dz], np.float64)
                acc[(dx, dy, dz)] = (g * d).sum(1)
    x00 = acc[(0, 0, 0)] + u[:, 0] * (acc[(1, 0, 0)] - acc[(0, 0, 0)])
    x10 = acc[(0, 1, 0)] + u[:, 0] * (acc[(1, 1, 0)] - acc[(0, 1, 0)])
    x01 = acc[(0, 0, 1)] + u[:, 0] * (acc[(1, 0, 1)] - acc[(0, 0, 1)])
    x11 = acc[(0, 1, 1)] + u[:, 0] * (acc[(1, 1, 1)] - acc[(0, 1, 1)])
    y0 = x00 + u[:, 1] * (x10 - x00)
    y1 = x01 + u[:, 1] * (x11 - x01)
    out = y0 + u[:, 2] * (y1 - y0)
    return out * 1.1


def fbm(P, octaves=5, seed=0, lacunarity=2.03, gain=0.5):
    P = np.asarray(P, np.float64)
    s = np.zeros(len(P))
    a, norm, f = 1.0, 0.0, 1.0
    for o in range(octaves):
        s += a * perlin(P * f + o * 17.31, seed + o * 101)
        norm += a
        a *= gain
        f *= lacunarity
    return s / norm


def ridged(P, octaves=4, seed=0, lacunarity=2.1, gain=0.55):
    P = np.asarray(P, np.float64)
    s = np.zeros(len(P))
    a, norm, f = 1.0, 0.0, 1.0
    for o in range(octaves):
        n = 1.0 - np.abs(perlin(P * f + o * 9.7, seed + o * 37))
        s += a * n * n
        norm += a
        a *= gain
        f *= lacunarity
    return s / norm


def worley(P, seed=0):
    P = np.asarray(P, np.float64)
    i0 = np.floor(P).astype(np.int64)
    f1 = np.full(len(P), 9.0)
    f2 = np.full(len(P), 9.0)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                c = i0 + np.array([dx, dy, dz])
                h = _hash(c[:, 0], c[:, 1], c[:, 2], seed)
                jitter = np.stack([(h % 1024) / 1024.0, ((h >> 10) % 1024) / 1024.0, ((h >> 20) % 1024) / 1024.0], 1)
                d = np.sqrt(((c + jitter - P) ** 2).sum(1))
                f2 = np.where(d < f1, f1, np.minimum(f2, d))
                f1 = np.minimum(f1, d)
    return f1, f2


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)
