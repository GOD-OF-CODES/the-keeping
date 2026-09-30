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


def all_clips(rig=None):
    m1 = [idle(), toggle(), knock(), bell_pull(), door_rattle(), breath_hold(), freeze(), wheel(), key_turn(), hide_push()]
    if rig is None:
        return m1
    rest_frames(rig)
    return m1 + m2_clips()


# ================================================================================================ M2 clips
# Hand orientation is driven in camera space: a COPY_ROTATION target per hand (clip.py 'rot'), expressed as frames
# (hand +Y toward the knuckles, +Z toward the palm) and slerped. The left hand keeps the flashlight; it is re-aimed so
# the beam lands on what the right hand works on (its world frame = the minimal rotation taking the rest beam
# direction onto the new one, applied to the rest frame).
from mathutils import Matrix, Quaternion, Vector    # noqa: E402

REST = {}


def rest_frames(rig):
    b = rig.data.bones
    REST['R'] = b['hand_r'].matrix_local.to_3x3()
    REST['L'] = b['hand_l'].matrix_local.to_3x3()
    REST['wr_r'] = Vector(b['hand_r'].head_local)
    REST['wr_l'] = Vector(b['hand_l'].head_local)
    fl, beam = b['flashlight'], b['flashlight_beam']
    REST['beam_dir'] = (Vector(beam.tail_local) - Vector(beam.head_local)).normalized()
    REST['lens_off'] = Vector(beam.head_local) - REST['wr_l']        # wrist -> lens, rest
    return REST


def frame(y, z):
    y = Vector(y).normalized()
    z = Vector(z)
    z = (z - y * z.dot(y)).normalized()
    return Matrix((y.cross(z), y, z)).transposed()


def rotx(deg):
    return Matrix.Rotation(math.radians(deg), 3, 'X')


def about(axis, deg, M):
    """Rotate frame M about a camera-space axis."""
    return Matrix.Rotation(math.radians(deg), 3, Vector(axis)) @ M


def rpath(keys, fn=ps.ease):
    """[(t, Matrix3)] -> fn(t) -> XYZ euler (radians) of the slerped frame."""
    qs = [(t, M.to_quaternion()) for t, M in keys]
    for i in range(1, len(qs)):                     # keep the hemisphere continuous
        if qs[i][1].dot(qs[i - 1][1]) < 0:
            qs[i] = (qs[i][0], -qs[i][1])

    def f(t):
        if t <= qs[0][0]:
            q = qs[0][1]
        elif t >= qs[-1][0]:
            q = qs[-1][1]
        else:
            for (t0, q0), (t1, q1) in zip(qs[:-1], qs[1:]):
                if t <= t1:
                    q = q0.slerp(q1, fn((t - t0) / max(t1 - t0, 1e-6)))
                    break
        return tuple(q.to_matrix().to_euler('XYZ'))
    return f


def aim_l(wrist, target, k=0.6):
    """Flashlight-hand frame so that the beam from the lens points toward `target` (fixed-point passes). k < 1 turns
    only part of the way (a real hand swings the light loosely toward the work; the cone is 28 deg wide)."""
    wrist = Vector(wrist)
    target = Vector(target)
    if target.y < wrist.y + 0.4:
        # the work is at/behind the lens: aim down the eye ray through it instead (where the player is looking)
        target = target.normalized() * 1.3
    q = Quaternion()
    for _ in range(3):
        lens = wrist + q @ REST['lens_off']
        d = (target - lens).normalized()
        q = Quaternion().slerp(REST['beam_dir'].rotation_difference(d), k)
    return q.to_matrix() @ REST['L']


def lens_of(wrist, M):
    return Vector(wrist) + (M @ REST['L'].inverted()) @ REST['lens_off']


def ik2(right=None, right_rot=None, left=None, left_rot=None):
    ik = {}
    if right is not None:
        ik['forearm_r'] = {'target': right, 'chain': 2}
        if right_rot is not None:
            ik['forearm_r'].update(rot=right_rot, rot_bone='hand_r')
    if left is not None:
        ik['forearm_l'] = {'target': left, 'chain': 2}
        if left_rot is not None:
            ik['forearm_l'].update(rot=left_rot, rot_bone='hand_l')
    return ik


def jitter(path, t, amp=0.004, seed=0, freq=5.0, period=None):
    """Hand-held jitter; with `period` it uses whole cycles per period so loops close exactly."""
    if period is None:
        return np.asarray(path, float) + np.array([wobble(t, seed + k, freq, amp) for k in range(3)])
    out = []
    for k in range(3):
        rng = np.random.default_rng(seed + k)
        ph = rng.uniform(0, 6.283, 3)
        n = [max(1, round(freq * period * m)) for m in (1.0, 1.93, 3.71)]
        w = (1.0, 0.5, 0.25)
        out.append(amp * sum(wi * math.sin(2 * math.pi * ni * t / period + p) for wi, ni, p in zip(w, n, ph)) / sum(w))
    return np.asarray(path, float) + np.array(out)


def lsway(t, k=1.0):
    """Right/left finger idle for posed hands."""
    return {'upperarm_l': (wobble(t, 3, 0.2, 0.6 * k), 0, 0), 'upperarm_r': (wobble(t, 7, 0.2, 0.6 * k), 0, 0)}


def pinch(side, amt=1.0):
    """Thumb-index pinch at the fingertips (a locket's chain, a bolt knob, a page corner); the other three fingers
    curled into the palm out of the way."""
    out = {}
    for f, c in (('index', (22, 30, 18)), ('middle', (70, 85, 55)), ('ring', (75, 88, 55)), ('pinky', (78, 88, 55))):
        for i in range(3):
            out[f'{f}_0{i + 1}_{side}'] = (c[i] * amt, 0, 0)
    out[f'thumb_01_{side}'] = (18 * amt, 0, 0)
    out[f'thumb_02_{side}'] = (22 * amt, 0, 0)
    out[f'thumb_03_{side}'] = (18 * amt, 0, 0)
    return out


def fingers_c(side, curl, per=None):
    out = {}
    for f in ('index', 'middle', 'ring', 'pinky'):
        c = per.get(f, curl) if per else curl
        out[f'{f}_01_{side}'] = (c * 0.8, 0, 0)
        out[f'{f}_02_{side}'] = (c * 1.0, 0, 0)
        out[f'{f}_03_{side}'] = (c * 0.7, 0, 0)
    return out


# Locket hold (camera space): the open locket's centre, and the pinch that holds it by the bail.
LOCKET_C = Vector((0.02, 0.42, -0.1))
LOCKET_HAND_Y = Vector((-0.35, 0.6, 0.72)).normalized()
LOCKET_HAND_Z = Vector((-0.5, 0.0, -0.85))
LOCKET_REACH = 0.135                                  # wrist -> pinch along the hand
LOCKET_CHAIN = 0.075                                  # pinch (chain in the fingertips) -> locket centre, straight down


def locket_hold_frame():
    return frame(LOCKET_HAND_Y, LOCKET_HAND_Z)


def locket_wrist():
    return LOCKET_C + Vector((0, 0, LOCKET_CHAIN)) - locket_hold_frame().col[1] * LOCKET_REACH


def locket_socket_rest(rig):
    """Rest-space head/orientation of the `locket` socket such that, in the locket-hold pose, it sits at LOCKET_C
    with +Y along the view (photo face toward Ada) and +Z up."""
    rest_frames(rig)
    Mh = locket_hold_frame().to_4x4()
    Mh.translation = locket_wrist()
    S = frame((0, 1, 0), (0, 0, 1)).to_4x4()
    S.translation = LOCKET_C
    L = Mh.inverted() @ S
    Mr = rig.data.bones['hand_r'].matrix_local
    W = Mr @ L
    return W.translation.copy(), W.to_3x3()


def _flash_rest_aim():
    """A point straight down the rest beam (so aim_l(rest wrist, it) == rest frame)."""
    return REST['wr_l'] + REST['lens_off'] + REST['beam_dir'] * 2.0


def lpath(keys, k=0.6):
    """Left (flashlight) hand: [(t, wrist, aim_point)] -> (position fn, rotation fn)."""
    pos = reach([(t, tuple(w)) for t, w, _ in keys])
    rot = rpath([(t, aim_l(w, a, k)) for t, w, a in keys])
    return pos, rot


def pickup_read():
    """Reach down to a sheet on a table/floor (~0.6 m below the eye along the view), pick it up and bring it up to
    read; the flashlight is drawn in so the beam lands on the page. Ends in the reading hold (clamp the last frame;
    play it backwards to put the page down)."""
    wr0 = tuple(REST['wr_r'])
    grab = (0.13, 0.46, -0.58)
    read = (0.12, 0.27, -0.2)
    page = Vector((0.03, 0.34, -0.12))
    Rr = REST['R']
    Rgrab = frame((-0.25, 0.75, -0.6), (-0.2, 0.3, -0.95))
    Rread = frame((-0.2, 0.3, 0.93), (-1.0, 0.1, 0.0))
    right = reach([(0.0, wr0), (0.55, (0.15, 0.42, -0.52)), (0.75, grab), (0.95, grab), (1.55, read), (2.2, read)])
    rrot = rpath([(0.0, Rr), (0.6, Rgrab), (0.95, Rgrab), (1.55, Rread), (2.2, Rread)])
    fl_rest = _flash_rest_aim()
    lw0 = tuple(REST['wr_l'])
    lwr = (-0.15, 0.13, -0.3)
    left, lrot = lpath([(0.0, lw0, fl_rest), (0.5, lw0, Vector(grab) + Vector((0, 0.05, -0.05))), (0.95, lw0, Vector(grab)),
                        (1.6, lwr, page), (2.2, lwr, page)])

    def fn(t):
        g = ps.ease((t - 0.7) / 0.2)
        p = add(sway(t, 0.35), pinch('r', 0.3 + 0.7 * g))
        return p
    return Clip('arms_pickup_read', 2.2, fn, ik=ik2(right, rrot, left, lrot), milestone='M2',
                note='pick up a page/ledger (grip 0.8 s) and raise it to read (hold from 1.6 s; clamp the last frame, '
                     'reverse to put down); document on socket prop_r; the beam is drawn onto the page')


def pry_board():
    """Hammer claw hooked under a board ~0.5 m ahead; levered back in jerks with a tremble of effort. 2 s loop (one
    pry = one 2 s hold; the board height comes from the camera pitch)."""
    hook = Vector((0.12, 0.36, -0.16))
    pulled = Vector((0.14, 0.25, -0.25))
    Rhook = frame((-0.35, 0.85, 0.4), (-0.85, -0.1, -0.5))
    Rpull = about((1, 0, 0), 32, Rhook)

    def lever(t):
        # 0-0.25 settle on the hook, 0.25-1.55 three jerks of effort back, 1.55-2.0 re-hook
        u = 0.0
        for a, b, w in ((0.25, 0.6, 0.35), (0.7, 1.05, 0.35), (1.15, 1.55, 0.3)):
            u += w * ps.ease((t - a) / (b - a))
        return u * (1 - ps.ease((t - 1.6) / 0.4))

    def right(t):
        u = lever(t)
        return jitter(hook + (pulled - hook) * u, t, 0.003 * u, seed=21, freq=6.0)

    Rh = Rhook.to_quaternion()
    Rp = Rpull.to_quaternion()

    def rrot(t):
        return tuple(Rh.slerp(Rp, lever(t)).to_matrix().to_euler('XYZ'))
    lw = (-0.17, 0.3, -0.27)
    Lm = aim_l(lw, hook + Vector((0, 0.1, 0)))
    le = tuple(Lm.to_euler('XYZ'))

    def fn(t):
        u = lever(t)
        return add(fist('r', 1.0), tremble(t, 0.3 + 0.9 * u), {'upperarm_r': (0, 0, -4 * u)})
    return Clip('arms_pry_board', 2.0, fn, loop=True,
                ik=ik2(right, rrot, lambda t: jitter(lw, t, 0.002, 5, 2.0, period=2.0), lambda t: le), milestone='M2',
                note='hammer (socket prop_r) claw under a board ~0.5 m ahead, levered back in three jerks; 2 s loop = '
                     'one pry hold; the crack/screech cue at 1.2 s; the beam on the board')


def cut_hem():
    """Shears at the hem (camera pitched down onto it), two snips per 1.2 s loop, cutting forward along the seam."""
    base = Vector((0.08, 0.43, -0.25))
    R0 = frame((-0.3, 0.9, -0.3), (-0.85, 0.05, -0.5))

    def snip(t):
        return 0.5 - 0.5 * math.cos(2 * math.pi * t / 0.6)    # 0 open .. 1 closed, two per loop

    def right(t):
        k = t / 1.2
        return base + Vector((0.0, 0.012 * math.sin(2 * math.pi * k), -0.004 * snip(t)))
    re = tuple(R0.to_euler('XYZ'))
    lw = (-0.16, 0.3, -0.28)
    le = tuple(aim_l(lw, base + Vector((0, 0.12, -0.02))).to_euler('XYZ'))

    def fn(t):
        c = snip(t)
        # thumb ring vs finger ring of the shears: the thumb and the index/middle close together
        p = add(sway(t, 0.25), {
            'thumb_01_r': (10 + 18 * c, 0, 0), 'thumb_02_r': (20 + 15 * c, 0, 0), 'thumb_03_r': (15, 0, 0),
            'index_01_r': (35 - 12 * c, 0, 0), 'index_02_r': (60, 0, 0), 'index_03_r': (40, 0, 0),
            'middle_01_r': (45 - 12 * c, 0, 0), 'middle_02_r': (70, 0, 0), 'middle_03_r': (45, 0, 0),
            'ring_01_r': (60, 0, 0), 'ring_02_r': (75, 0, 0), 'ring_03_r': (45, 0, 0),
            'pinky_01_r': (60, 0, 0), 'pinky_02_r': (75, 0, 0), 'pinky_03_r': (45, 0, 0),
            'hand_r': (0, 0, 0)})
        return p
    return Clip('arms_cut_hem', 1.2, fn, loop=True, ik=ik2(right, lambda t: re, lambda t: np.asarray(lw), lambda t: le),
                milestone='M2', note='shears (socket prop_r) at the hem, camera pitched down; snips close at 0.3 / 0.9 s; '
                                     'loop while E is held')


def raise_locket():
    """Open the locket with the thumb and raise it, open, into the beam in front of the face (1.2 s); ends on the
    first frame of arms_locket_hold. The flashlight is drawn back under the chin so the beam passes the locket."""
    wr0 = tuple(REST['wr_r'])
    lw = locket_wrist()
    Rh = locket_hold_frame()
    mid = (0.16, 0.26, -0.24)
    Rmid = frame((-0.35, 0.8, 0.1), (-0.6, 0.0, -0.8))
    right = reach([(0.0, wr0), (0.45, mid), (0.6, mid), (1.2, tuple(lw))])
    rrot = rpath([(0.0, REST['R']), (0.45, Rmid), (0.6, Rmid), (1.2, Rh)])
    left, lrot = lpath([(0.0, tuple(REST['wr_l']), _flash_rest_aim()), (1.2, FLASH_HOLD_WR, FLASH_HOLD_AIM)], k=1.0)

    def fn(t):
        flick = math.exp(-((t - 0.5) / 0.07) ** 2)     # thumb flicks the case open at 0.5 s
        p = add(sway(t, 0.3), pinch('r', ps.ease(t / 0.3)))
        p['thumb_02_r'] = (p['thumb_02_r'][0] - 35 * flick, 0, 0)
        p['thumb_03_r'] = (p['thumb_03_r'][0] - 25 * flick, 0, 0)
        return p
    return Clip('arms_raise_locket', 1.2, fn, ik=ik2(right, rrot, left, lrot), milestone='M2',
                note='RMB: thumb flicks the locket open (0.5 s) and raises it into the beam in front of the face '
                     '(socket locket, photo face +Y away from the player); continue with arms_locket_hold; reverse to lower')


FLASH_HOLD_WR = (-0.12, 0.1, -0.12)
FLASH_HOLD_AIM = Vector((0.02, 1.1, -0.06))


def locket_hold():
    lw = locket_wrist()
    Rh = locket_hold_frame()
    re = tuple(Rh.to_euler('XYZ'))
    Lm = aim_l(FLASH_HOLD_WR, FLASH_HOLD_AIM, 1.0)
    le = tuple(Lm.to_euler('XYZ'))

    def right(t):
        return jitter(lw, t, 0.0025, seed=31, freq=1.6, period=3.0) + np.array([0, 0, 0.003 * math.sin(2 * math.pi * t / 3.0)])

    def left(t):
        return jitter(FLASH_HOLD_WR, t, 0.002, seed=41, freq=1.2, period=3.0)

    def fn(t):
        return add(pinch('r', 1.0), tremble(t, 0.35))
    return Clip('arms_locket_hold', 3.0, fn, loop=True, ik=ik2(right, lambda t: re, left, lambda t: le), milestone='M2',
                note='the open locket held in front of the face in the beam (hands tremble); loop while RMB is held')


def slide_bolt():
    """Grip the bolt knob (door ~0.5 m ahead, at chest height) and slide it 10 cm to the left (clack at 0.95 s)."""
    wr0 = tuple(REST['wr_r'])
    knob = Vector((0.16, 0.42, -0.26))
    slid = knob + Vector((-0.1, 0.0, 0.0))
    Rg = frame((-0.3, 0.95, 0.05), (-0.3, 0.05, -0.95))
    right = reach([(0.0, wr0), (0.45, tuple(knob + Vector((0, -0.04, 0.02)))), (0.55, tuple(knob)), (0.65, tuple(knob)),
                   (0.95, tuple(slid)), (1.1, tuple(slid)), (1.6, wr0)])
    rrot = rpath([(0.0, REST['R']), (0.45, Rg), (1.1, Rg), (1.6, REST['R'])])
    lw = tuple(REST['wr_l'])
    left, lrot = lpath([(0.0, lw, _flash_rest_aim()), (0.4, lw, knob + Vector((0, 0.05, 0))), (1.2, lw, knob + Vector((0, 0.05, 0))),
                        (1.6, lw, _flash_rest_aim())])

    def fn(t):
        g = ps.ease((t - 0.5) / 0.1) * (1 - ps.ease((t - 1.05) / 0.1))
        return add(sway(t, 0.3), fist('r', 0.2 + 0.65 * g))
    return Clip('arms_slide_bolt', 1.6, fn, ik=ik2(right, rrot, left, lrot), milestone='M2',
                note='grip a bolt knob ~0.5 m ahead, slide it 10 cm left (0.65-0.95 s, clack at 0.95 s), release')


def pour_can():
    """C6: the jerry can (socket prop_r, handle in the fist) lifted to the filler, tipped (glugs at 0.1 and 2.2 s),
    re-tipped, lowered by 4.3 s (can_in_hand off). The beam stays on the filler."""
    wr0 = tuple(REST['wr_r'])
    lift = Vector((0.2, 0.36, -0.3))
    pour = Vector((0.16, 0.4, -0.26))
    Rc = frame((-0.15, 0.95, 0.1), (0.0, 0.05, -1.0))       # palm down on the top handle
    Rt = about((1, 0, 0), -38, Rc)                           # tipped forward (spout down)
    Rt2 = about((1, 0, 0), -50, Rc)
    right = reach([(0.0, wr0), (0.35, tuple(lift)), (0.6, tuple(pour)), (3.7, tuple(pour + Vector((0, 0.01, 0.01)))),
                   (4.3, tuple(Vector(wr0) + Vector((0, 0, -0.06))))])
    rrot = rpath([(0.0, REST['R']), (0.3, Rc), (0.6, Rt), (2.0, Rt), (2.4, Rt2), (3.6, Rt2), (4.0, Rc), (4.3, REST['R'])])
    filler = Vector((0.06, 0.85, -0.42))
    lw = tuple(REST['wr_l'])
    left, lrot = lpath([(0.0, lw, _flash_rest_aim()), (0.5, lw, filler), (3.8, lw, filler), (4.3, lw, _flash_rest_aim())])

    def right_j(t):
        return np.asarray(right(t)) + np.array([0, 0, 0.004 * wobble(t, 51, 2.5, 1.0) * (0.6 < t < 3.8)])

    def fn(t):
        g = ps.ease(t / 0.3) * (1 - ps.ease((t - 4.0) / 0.3) * 0.2)
        return add(fist('r', 0.95 * g), tremble(t, 0.25 + 0.35 * ps.ease((t - 0.6) / 0.5) * (1 - ps.ease((t - 3.8) / 0.4))))
    return Clip('arms_pour_can', 4.3, fn, ik=ik2(right_j, rrot, left, lrot), milestone='M2',
                note='C6 pour (gate at 3.0): can on socket prop_r lifted to the filler by 0.6 s, tipped (glug 0.1 / 2.2 s), '
                     'lowered by 4.3 s (can_in_hand off); the beam on the filler')


def m2_clips():
    return [pickup_read(), pry_board(), cut_hem(), raise_locket(), locket_hold(), slide_bolt(), pour_can()]


M2_TODO = []
