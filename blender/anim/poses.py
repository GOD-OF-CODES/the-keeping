"""Pose algebra for clip authoring.

A pose is a dict: bone -> (rx, ry, rz) in DEGREES about the bone's local axes (characters/skeleton.py convention:
+rx = flexion; ry = twist; rz = side-bend/abduction). Helpers take semantic, side-independent values and apply the
side sign to ry/rz (mirrored motion negates twist and side-bend on every bone). Special keys:
  '_hips': (dx, dy, dz) world-space offset of the hips (metres; Blender Z up, character faces -Y)
Missing bones are at rest. Helpers are semantic and side-aware so poses read like choreography.
"""
import math

import numpy as np

SIDES = ('l', 'r')


def sgn(side):
    return 1.0 if side == 'l' else -1.0


def P(**kw):
    """Pose from keyword args; bone names use '__' for nothing special (plain names)."""
    return dict(kw)


def add(*poses):
    out = {}
    for p in poses:
        for k, v in p.items():
            if k in out:
                out[k] = tuple(a + b for a, b in zip(out[k], v))
            else:
                out[k] = tuple(v)
    return out


def scale(p, w):
    return {k: tuple(x * w for x in v) for k, v in p.items()}


def lerp(a, b, w):
    keys = set(a) | set(b)
    out = {}
    for k in keys:
        va = a.get(k, (0.0, 0.0, 0.0))
        vb = b.get(k, (0.0, 0.0, 0.0))
        out[k] = tuple(x + (y - x) * w for x, y in zip(va, vb))
    return out


def mirror(p):
    out = {}
    for k, v in p.items():
        if k.endswith('_l'):
            nk = k[:-2] + '_r'
        elif k.endswith('_r'):
            nk = k[:-2] + '_l'
        else:
            nk = k
        if k == '_hips':
            out[nk] = (-v[0], v[1], v[2])
        else:
            out[nk] = (v[0], -v[1], -v[2])      # mirrored motion: flexion keeps its sign, twist/side-bend flip
    return out


def ease(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def ease_in(t):
    t = min(max(t, 0.0), 1.0)
    return t * t


def ease_out(t):
    t = min(max(t, 0.0), 1.0)
    return 1 - (1 - t) * (1 - t)


def track(t, keys, fn=ease):
    """keys: [(time, pose)], sorted. Eased piecewise blend."""
    if t <= keys[0][0]:
        return dict(keys[0][1])
    for (t0, p0), (t1, p1) in zip(keys[:-1], keys[1:]):
        if t <= t1:
            return lerp(p0, p1, fn((t - t0) / max(t1 - t0, 1e-6)))
    return dict(keys[-1][1])


def wobble(t, seed, freq=1.0, amp=1.0):
    """Smooth 1D noise (sum of sines with seeded phases)."""
    rng = np.random.default_rng(seed)
    ph = rng.uniform(0, 6.283, 4)
    fr = np.array([1.0, 1.93, 3.71, 7.1]) * freq
    w = np.array([1.0, 0.5, 0.25, 0.12])
    return amp * float((w * np.sin(fr * t * 6.283 + ph)).sum() / w.sum())


# ------------------------------------------------------------------------------------------------ semantic helpers
def arm(side, fwd=0.0, down=48.0, twist=0.0, elbow=0.0, wrist=0.0, wrist_side=0.0, fore_twist=0.0, shrug=0.0):
    """fwd: raise the arm forward (deg); down: lower from the A-pose toward the body (deg);
    elbow: flexion; wrist: flexion toward the palm; fore_twist: forearm pronation (+) ."""
    s = sgn(side)
    return {
        f'clavicle_{side}': (shrug, 0.0, 0.0),
        f'upperarm_{side}': (fwd, twist * s, -down * s),
        f'forearm_{side}': (elbow, fore_twist * s, 0.0),
        f'hand_{side}': (wrist, 0.0, wrist_side * s),
    }


def fingers(side, curl=10.0, spread=0.0, thumb=10.0, per=None):
    out = {}
    for f in ('index', 'middle', 'ring', 'pinky'):
        c = per.get(f, curl) if per else curl
        sp = {'index': 1.0, 'middle': 0.0, 'ring': -1.0, 'pinky': -2.0}[f] * spread * sgn(side)
        out[f'{f}_01_{side}'] = (c * 0.8, 0.0, sp)
        out[f'{f}_02_{side}'] = (c * 1.1, 0.0, 0.0)
        out[f'{f}_03_{side}'] = (c * 0.8, 0.0, 0.0)
    out[f'thumb_01_{side}'] = (thumb * 0.5, 0.0, 0.0)
    out[f'thumb_02_{side}'] = (thumb * 0.8, 0.0, 0.0)
    out[f'thumb_03_{side}'] = (thumb, 0.0, 0.0)
    return out


def claw(side, amt=1.0):
    """Dead, hooked fingers: knuckles straight, tips curled (Ada)."""
    out = {}
    for f in ('index', 'middle', 'ring', 'pinky'):
        out[f'{f}_01_{side}'] = (-8 * amt, 0.0, 0.0)
        out[f'{f}_02_{side}'] = (38 * amt, 0.0, 0.0)
        out[f'{f}_03_{side}'] = (32 * amt, 0.0, 0.0)
    out[f'thumb_02_{side}'] = (10 * amt, 0, 0)
    out[f'thumb_03_{side}'] = (22 * amt, 0, 0)
    return out


def spine(bend=0.0, side=0.0, twist=0.0, dist=(0.3, 0.35, 0.35)):
    return {f'spine_0{i + 1}': (bend * w, twist * w, side * w) for i, w in enumerate(dist)}


def neck(bend=0.0, side=0.0, twist=0.0, head_bend=None, head_side=None, head_twist=None):
    return {
        'neck_01': (bend * 0.5, twist * 0.4, side * 0.5),
        'neck_02': (bend * 0.5, twist * 0.3, side * 0.5),
        'head': (bend * 0.0 if head_bend is None else head_bend, twist * 0.3 if head_twist is None else head_twist,
                 0.0 if head_side is None else head_side),
    }


def leg(side, hip=0.0, knee=0.0, ankle=0.0, toe=0.0, abduct=0.0, twist=0.0):
    """hip: flexion (leg forward); knee: bend; ankle: dorsiflexion (toes up); abduct: leg out to the side."""
    s = sgn(side)
    return {
        f'thigh_{side}': (hip, twist * s, abduct * s),
        f'calf_{side}': (knee, 0.0, 0.0),
        f'foot_{side}': (ankle, 0.0, 0.0),
        f'toe_{side}': (toe, 0.0, 0.0),
    }


def both(fn, **kw):
    return add(fn('l', **kw), fn('r', **kw))
