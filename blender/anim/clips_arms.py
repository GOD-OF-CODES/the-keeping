"""First-person arm clips. The rest pose IS the idle pose (left hand gripping the flashlight, right hand relaxed);
FK offsets are small, and reaches use IK wrist targets in camera space (metres; +Y = view direction, +Z up,
player's right = +X). Interaction targets assume the player stands ~0.55 m from a door (see docs/CHARACTERS.md).
"""
import math

import numpy as np

from characters import skeleton
from . import poses as ps
from .clip import Clip
from .poses import add, lerp, wobble

REST_WR = np.array(skeleton.ARMS['right_wrist'])


def F(bone, rx=0.0, ry=0.0, rz=0.0):
    return {bone: (rx, ry, rz)}


def fist(side, amt=1.0):
    out = {}
    for f in ('index', 'middle', 'ring', 'pinky'):
        out[f'{f}_01_{side}'] = (55 * amt, 0, 0)
        out[f'{f}_02_{side}'] = (75 * amt, 0, 0)
        out[f'{f}_03_{side}'] = (45 * amt, 0, 0)
    out[f'thumb_02_{side}'] = (25 * amt, 0, 0)
    out[f'thumb_03_{side}'] = (35 * amt, 0, 0)
    return out


def open_hand(side, amt=1.0):
    out = {}
    for f in ('index', 'middle', 'ring', 'pinky'):
        for i in (1, 2, 3):
            out[f'{f}_{i:02d}_{side}'] = (-18 * amt, 0, 0)
    return out


def sway(t, k=1.0, seed=0):
    """Breathing/hand-held sway, both arms, the flashlight hand a little livelier."""
    return {
        'upperarm_l': (wobble(t, seed + 1, 0.22, 1.2 * k), wobble(t, seed + 2, 0.18, 0.8 * k), 0),
        'forearm_l': (wobble(t, seed + 3, 0.27, 0.9 * k), 0, wobble(t, seed + 4, 0.2, 0.6 * k)),
        'hand_l': (wobble(t, seed + 5, 0.35, 1.2 * k), 0, wobble(t, seed + 6, 0.3, 0.9 * k)),
        'upperarm_r': (wobble(t, seed + 7, 0.2, 0.8 * k), 0, 0),
        'forearm_r': (wobble(t, seed + 8, 0.25, 0.7 * k), 0, 0),
    }


def tremble(t, k=1.0):
    return {b: (wobble(t, 40 + i, 7.0, 1.4 * k), 0, wobble(t, 60 + i, 6.3, 1.0 * k))
            for i, b in enumerate(('upperarm_l', 'forearm_l', 'hand_l', 'upperarm_r', 'forearm_r', 'hand_r'))}


def reach(times_pts):
    """Piecewise eased path of the right wrist: [(t, (x, y, z))]."""
    def f(t):
        pts = [(tt, np.asarray(p, float)) for tt, p in times_pts]
        if t <= pts[0][0]:
            return pts[0][1]
        for (t0, p0), (t1, p1) in zip(pts[:-1], pts[1:]):
            if t <= t1:
                return p0 + (p1 - p0) * ps.ease((t - t0) / max(t1 - t0, 1e-6))
        return pts[-1][1]
    return f


def ik_r(path):
    return {'forearm_r': {'target': path, 'chain': 2}}


def idle():
    return Clip('arms_idle', 4.0, lambda t: sway(t), loop=True, note='hand-held sway; camera bob is runtime')


def toggle():
    def fn(t):
        press = math.exp(-((t - 0.2) / 0.06) ** 2)
        return add(sway(t), F('thumb_02_l', 22 * press), F('thumb_03_l', 30 * press), F('hand_l', 3 * press))
    return Clip('arms_flashlight_toggle', 0.5, fn, note='thumb on the slide switch at 0.2 s (click cue)')


def knock():
    door = np.array([0.08, 0.43, -0.1])
    back = door + np.array([0, -0.06, 0])
    path = reach([(0.0, REST_WR), (0.35, back), (0.5, door), (0.62, back), (0.75, door), (0.87, back), (1.0, door),
                  (1.2, back), (1.6, REST_WR)])

    def fn(t):
        up = ps.ease(t / 0.3) * (1 - ps.ease((t - 1.2) / 0.4))
        return add(sway(t, 0.5), fist('r', up), F('hand_r', -10 * up, 0, 0))
    return Clip('arms_knock', 1.6, fn, ik=ik_r(path), note='three raps at 0.5 / 0.75 / 1.0 s (door ~0.55 m ahead)')


def bell_pull():
    knob = np.array([0.16, 0.44, -0.06])
    down = knob + np.array([0.0, -0.03, -0.17])
    path = reach([(0.0, REST_WR), (0.5, knob), (0.62, knob), (1.15, down), (1.35, down), (2.0, REST_WR)])

    def fn(t):
        grip = ps.ease((t - 0.45) / 0.15) * (1 - ps.ease((t - 1.3) / 0.15))
        return add(sway(t, 0.5), fist('r', grip * 0.9), F('hand_r', -15 * grip, 0, 0))
    return Clip('arms_bell_pull', 2.0, fn, ik=ik_r(path), note='grip the bell knob, pull down 17 cm (0.62-1.15 s), release')


def door_rattle():
    handle = np.array([0.13, 0.42, -0.36])

    def path(t):
        k = 2 * math.pi * t / 0.6
        return handle + np.array([0.012 * math.sin(2 * k), 0.02 * math.sin(k), 0.006 * math.sin(3 * k)])

    def fn(t):
        k = 2 * math.pi * t / 0.6
        return add(sway(t, 0.4), fist('r', 0.85), F('forearm_r', 0, 22 * math.sin(k), 0), F('hand_r', 0, 0, 8 * math.sin(2 * k)))
    return Clip('arms_door_rattle', 1.2, fn, loop=True, ik=ik_r(path), note='both-directions yank on a bolted door handle')


def breath_hold():
    def fn(t):
        return add(F('upperarm_l', -8), F('forearm_l', 12), F('upperarm_r', -6), F('forearm_r', 18),
                   fist('l', 0.15), fist('r', 0.6), tremble(t, 1.0 + 0.5 * math.sin(t * 2.0)))
    return Clip('arms_breath_hold', 2.0, fn, loop=True, note='holding breath in a hide: arms drawn in, trembling, fists tight')


def freeze():
    def fn(t):
        low = ps.ease(t / 0.8)
        return add(F('upperarm_l', -6 * low), F('forearm_l', -4 * low), F('hand_l', -8 * low), tremble(t, 0.4 + 0.6 * low))
    return Clip('arms_freeze', 1.5, fn, note='threshold freeze (C2): the beam sags and trembles')


def wheel():
    c = np.array([0.0, 0.43, -0.3])

    def path(t):
        return c + np.array([0.165, -0.02, 0.1]) + np.array([0, 0, 0.004 * math.sin(t * 2.1)])

    def fn(t):
        return add(fist('r', 0.8), F('upperarm_l', 6, 0, 0), sway(t, 0.3))
    return Clip('arms_wheel', 3.0, fn, loop=True, ik=ik_r(path),
                note='hands on the wheel (C1/C6/C7); runtime hides the flashlight mesh and places the left hand by CCDIK')


def key_turn():
    ign = np.array([0.24, 0.36, -0.42])
    path = reach([(0.0, REST_WR), (0.45, ign), (1.1, ign), (1.5, REST_WR)])

    def fn(t):
        tw = ps.ease((t - 0.55) / 0.25) * (1 - ps.ease((t - 1.0) / 0.1))
        pinch = ps.ease((t - 0.35) / 0.1) * (1 - ps.ease((t - 1.1) / 0.1))
        return add(sway(t, 0.3), F('forearm_r', 0, 45 * tw, 0), fist('r', 0.6 * pinch))
    return Clip('arms_key', 1.5, fn, ik=ik_r(path), note='turn the ignition key (engine catch cue at 0.8 s)')


def hide_push():
    door = np.array([0.08, 0.36, -0.2])
    path = reach([(0.0, REST_WR), (0.3, door - np.array([0, 0.05, 0])), (0.7, door + np.array([0, 0.12, 0])), (1.0, REST_WR)])

    def fn(t):
        o = ps.ease(t / 0.25) * (1 - ps.ease((t - 0.75) / 0.25))
        return add(sway(t, 0.4), open_hand('r', o), F('hand_r', -40 * o, 0, 0))
    return Clip('arms_hide_push', 1.0, fn, ik=ik_r(path), note='push a hide door open / shut from inside (palm flat)')


def all_clips():
    return [idle(), toggle(), knock(), bell_pull(), door_rattle(), breath_hold(), freeze(), wheel(), key_turn(), hide_push()]


M2_TODO = ['arms_pickup_read', 'arms_pry_board (3-board loop)', 'arms_cut_hem (hold)', 'arms_raise_locket (open + raise)',
           'arms_slide_bolt', 'arms_pour_can']
