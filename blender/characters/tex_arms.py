"""First-person arms textures: black-brown leather driving gloves (perforations, stitching, snap), rain-dark wool
coat, steel two-cell flashlight (knurled grip, chipped black paint band, scratches, grimy lens + chrome reflector)."""
import math

import numpy as np

from lib import noise
from lib.noise import smoothstep as ss
from .tex_harlan import _mix, _tile


def gloves(P, N, AO, ctx):
    n = len(P)
    alb = _tile([0.032, 0.021, 0.015], n) * (1 + 0.3 * noise.fbm(P * 30, 4, 91))[:, None]
    wear = ss(0.45, 0.8, noise.fbm(P * 60, 3, 92)) * ss(0.7, 0.95, AO)
    alb = _mix(alb, [0.075, 0.05, 0.034], wear * 0.6)
    crease = ss(0.82, 0.96, noise.ridged(P * 140, 3, 93))
    alb = _mix(alb, [0.012, 0.008, 0.006], crease * 0.7)
    # perforation rows on the back of the fingers and seams (worley cell edges as a cheap stitch pattern)
    f1, f2 = noise.worley(P * 420, 94)
    perf = ss(0.18, 0.1, f1) * ss(0.3, 0.6, noise.fbm(P * 20, 2, 95))
    alb = _mix(alb, [0.005, 0.004, 0.003], perf * 0.8)
    grain, _ = noise.worley(P * 1100, 96)
    wet = ss(0.4, 0.7, noise.fbm(P * 9, 3, 97))
    rough = 0.52 - 0.18 * wet + 0.15 * crease
    h = -0.0004 * crease - 0.0003 * perf - 0.00006 * ss(0.3, 0.05, grain)
    return np.clip(alb, 0, 1), np.clip(rough, 0.05, 1), h


def wool(P, N, AO, ctx):
    n = len(P)
    alb = _tile([0.05, 0.047, 0.043], n) * (1 + 0.18 * noise.fbm(P * 40, 3, 101))[:, None]
    rain = ss(0.4, 0.75, noise.fbm(P * np.array([15, 15, 5.0]), 3, 102))
    alb *= (1 - 0.35 * rain)[:, None]
    tw = np.sin((P[:, 0] + P[:, 1] * 0.7 + P[:, 2]) * 2 * math.pi / 0.002)
    fuzz = noise.fbm(P * 600, 2, 103)
    alb *= (0.65 + 0.35 * AO)[:, None]
    rough = 0.92 - 0.25 * rain
    h = 0.00015 * tw + 0.0002 * fuzz + 0.0003 * noise.fbm(P * 80, 2, 104)
    return np.clip(alb, 0, 1), rough, h


def flashlight(P, N, AO, ctx):
    n = len(P)
    tail = ctx['tail']
    F = ctx['F']
    t = (P - tail) @ F
    radial = P - tail - np.outer(t, F)
    r = np.linalg.norm(radial, axis=1)
    up = np.array([0, 0, 1.0]) - F * F[2]
    up /= np.linalg.norm(up)
    ang = np.arctan2(radial @ np.cross(F, up), radial @ up)
    steel = _tile([0.3, 0.3, 0.31], n) * (1 + 0.08 * noise.fbm(P * 300, 2, 111))[:, None]
    scratch = ss(0.93, 0.99, noise.ridged(np.stack([t * 40, ang * 3, r * 50], 1), 3, 112))
    # black enamel band over the tube, chipped through to steel
    paint = (t > 0.04) & (t < 0.168)
    chip = ss(0.62, 0.7, noise.fbm(P * 160, 3, 113))
    band = paint * (1 - chip)
    alb = _mix(steel, [0.015, 0.015, 0.016], band)
    knurl = (t > 0.05) & (t < 0.12)
    kn = (np.sin(t * 2 * math.pi / 0.0016 + ang * 22) * np.sin(t * 2 * math.pi / 0.0016 - ang * 22))
    # lens + reflector (the face of the head, inside the bezel)
    lens = (t > 0.228) & (r < 0.0245)
    refl = lens & (r > 0.004)
    alb = _mix(alb, [0.55, 0.56, 0.57], refl.astype(float) * 0.8)
    alb = _mix(alb, [0.9, 0.85, 0.7], (lens & (r <= 0.004)).astype(float))    # the bulb
    grime = ss(0.9, 0.55, AO)
    alb = _mix(alb, [0.03, 0.028, 0.025], grime * 0.6)
    rough = np.where(band > 0.5, 0.35, 0.3 + 0.3 * noise.fbm(P * 90, 2, 114)) + 0.2 * scratch
    rough = np.where(lens, 0.06, rough)
    h = 0.00025 * kn * knurl - 0.0002 * scratch - 0.0002 * chip * paint
    return np.clip(alb, 0, 1), np.clip(rough, 0.03, 1), h


def shader(kind, ctx):
    return {
        'gloves': lambda P, N, AO, G: gloves(P, N, AO, ctx),
        'sleeves': lambda P, N, AO, G: wool(P, N, AO, ctx),
        'flashlight': lambda P, N, AO, G: flashlight(P, N, AO, ctx),
    }[kind]
