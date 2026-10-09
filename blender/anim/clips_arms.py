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
    """Both hands on the rim at ten-to-two (C1/C6/C7), a loose driving grip with small corrections; the left hand
    leaves the torch (the runtime hides the flashlight mesh in the car). Rim points from the sedan_interior wheel."""
    rl, Rl = rim_grip('l', 150.0)
    rr, Rr = rim_grip('r', 30.0)

    def right(t):
        return np.asarray(rr) + np.array([0.0, 0.0, 0.003 * math.sin(t * 2 * math.pi / 3.0)])

    def left(t):
        return np.asarray(rl) + np.array([0.0, 0.0, 0.003 * math.sin(t * 2 * math.pi / 3.0 + 1.3)])

    def fn(t):
        return add(fist('r', 0.82), grip_l(0.9), sway(t, 0.25))
    return Clip('arms_wheel', 3.0, fn, loop=True, ik=ik2(right, lambda t: tuple(Rr.to_euler('XYZ')), left,
                                                         lambda t: tuple(Rl.to_euler('XYZ'))),
                note='hands on the wheel at ten-to-two (C1/C6/C7); the runtime hides the flashlight mesh in the car')


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
    return m1 + m2_clips() + car_clips()


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


# ================================================================================================ car clips (C1 opening)
# Car-space control positions come from the sedan_interior generator (blender/props/sedan_cabin.py, read back from
# props_m1.glb): driver eye EYE = car (-0.35, -0.05, 1.12); camera space = car - EYE (+Y forward, +Z up, +X right).
# Wheel: hub car (-0.37, 0.42, 0.80), column tilt 25 deg, rim centre-line radius 0.1765 m (15 in wheel).
CAR_EYE = Vector((-0.35, -0.05, 1.12))
HUB = Vector((-0.37, 0.42, 0.80)) - CAR_EYE
WHEEL_TILT = math.radians(25.0)
RIM_R = 0.1765
WHEEL_FWD = Vector((0.0, math.cos(WHEEL_TILT), -math.sin(WHEEL_TILT)))
RADIO_SEEK = Vector((0.077, 0.532, 0.734)) - CAR_EYE           # radio_seek_up button face
HEADLAMP_KNOB = Vector((-0.665, 0.515, 0.80)) - CAR_EYE         # push-pull knob cap
STALK_TIP = Vector((-0.582, 0.436, 0.739)) - CAR_EYE            # turn/high-beam stalk tip (left of the column)
MAP_C = Vector((0.0, 0.40, -0.12))                              # the unfolded map's centre, propped on the upper rim
MAP_GRIP = Vector((-0.17, 0.41, -0.10))                         # left-hand pinch on the map's left edge


def rim_point(deg):
    """Point on the rim centre-line at clock angle `deg` (0 = 3 o'clock, 90 = 12, CCW seen from the driver)."""
    a = math.radians(deg)
    return HUB + Vector((RIM_R * math.cos(a), -RIM_R * math.sin(a) * math.sin(WHEEL_TILT),
                         RIM_R * math.sin(a) * math.cos(WHEEL_TILT)))


def rim_grip(side, deg):
    """(wrist, hand frame) of a power grip on the rim at `deg`: the rim runs across the palm, the knuckles point
    forward over it, the palm faces the hub; the fist centre (socket prop_r convention: 5 cm along the hand, 3 cm
    toward the palm) sits on the rim centre-line."""
    a = math.radians(deg)
    radial = Vector((math.cos(a), -math.sin(a) * math.sin(WHEEL_TILT), math.sin(a) * math.cos(WHEEL_TILT)))
    y = (WHEEL_FWD * 0.8 + radial * 0.35 + Vector((0, 0, 0.3))).normalized()
    z = (-radial * 0.85 + WHEEL_FWD * 0.2 - Vector((0, 0, 0.2)))
    M = frame(y, z)
    g = rim_point(deg)
    wr = g - M.col[1] * 0.05 - M.col[2] * 0.03
    return tuple(wr), M


def grip_l(amt=1.0):
    """Left-hand fingers: the rest pose already curls them ~64 deg round the torch barrel; this adds the last of a
    rim grip (amt 1) or opens them (amt < 0)."""
    out = {f'{f}_0{i}_l': (c * amt, 0, 0) for f in ('index', 'middle', 'ring', 'pinky') for i, c in ((1, 8), (2, 14), (3, 10))}
    out['thumb_02_l'] = (10 * amt, 0, 0)
    return out


def point_r(amt=1.0):
    """Right hand pointing: index straight, the other three curled, thumb tucked."""
    out = {}
    for f, c in (('index', (-4, -6, -4)), ('middle', (68, 85, 50)), ('ring', (72, 88, 52)), ('pinky', (75, 88, 52))):
        for i in range(3):
            out[f'{f}_0{i + 1}_r'] = (c[i] * amt, 0, 0)
    out['thumb_02_r'] = (20 * amt, 0, 0)
    out['thumb_03_r'] = (25 * amt, 0, 0)
    return out


def press_frame(target, side='r', twist=0.0):
    """Hand frame for poking/turning something on the dash ahead: knuckles toward the target from slightly above,
    palm down."""
    y = (Vector(target).normalized() + Vector((0, 0, -0.15))).normalized()
    M = frame(y, (0.0, 0.1, -1.0) if side == 'r' else (0.0, 0.1, -1.0))
    return about(y, twist, M) if twist else M


def finger_wrist(tip, M, reach=0.165):
    """Wrist position that puts the extended index fingertip at `tip` (hand + index ~16.5 cm)."""
    return tuple(Vector(tip) - M.col[1] * reach)


def radio_seek():
    """C1: the right hand leaves the wheel, the index presses SEEK twice (0.8 s, 1.3 s), back by 2.4 s."""
    rw, Rw = rim_grip('r', 30.0)
    lw, Lw = rim_grip('l', 150.0)
    Rp = press_frame(RADIO_SEEK)
    near = finger_wrist(RADIO_SEEK + Vector((0, -0.02, 0.004)), Rp)
    on = finger_wrist(RADIO_SEEK, Rp)
    right = reach([(0.0, rw), (0.55, near), (0.8, on), (0.95, near), (1.25, on), (1.4, near), (1.6, near), (2.4, rw)])
    rrot = rpath([(0.0, Rw), (0.5, Rp), (1.6, Rp), (2.4, Rw)])

    def fn(t):
        pt = ps.ease((t - 0.1) / 0.35) * (1 - ps.ease((t - 1.6) / 0.6))
        return add(sway(t, 0.25), add({k: tuple(v * (1 - pt) for v in vv) for k, vv in fist('r', 0.82).items()},
                                      point_r(pt)), grip_l(0.9))
    return Clip('arms_radio_seek', 2.4, fn, ik=ik2(right, rrot, lambda t: lw, lambda t: tuple(Lw.to_euler('XYZ'))),
                note='C1: right index presses radio SEEK at 0.8 and 1.3 s (VFD digits step on each press); left on the wheel')


def headlamp_knob():
    """C1: the left hand drops off the rim to the push-pull headlamp knob left of the binnacle, pulls it out 12 mm
    (click at 0.85 s) and returns by 1.6 s. Played reversed = pushing it in (off)."""
    rw, Rw = rim_grip('r', 30.0)
    lw, Lw = rim_grip('l', 150.0)
    Lk = frame((HEADLAMP_KNOB + Vector((0, 0.0, 0.03))).normalized(), (0.6, 0.2, -0.75))
    pinch_off = 0.115                                      # wrist -> thumb/index pinch along the hand
    at = tuple(HEADLAMP_KNOB - Lk.col[1] * pinch_off)
    pulled = tuple(Vector(at) + Vector((0, -0.012, 0)))
    left = reach([(0.0, lw), (0.5, tuple(Vector(at) + Vector((0, -0.03, 0.01)))), (0.65, at), (0.75, at), (0.85, pulled),
                  (1.0, pulled), (1.6, lw)])
    lrot = rpath([(0.0, Lw), (0.5, Lk), (1.0, Lk), (1.6, Lw)])

    def fn(t):
        k = ps.ease((t - 0.1) / 0.4) * (1 - ps.ease((t - 1.0) / 0.5))
        pin = ps.ease((t - 0.55) / 0.1) * (1 - ps.ease((t - 0.95) / 0.1))
        lp = {kk: tuple(v * pin for v in vv) for kk, vv in pinch('l', 0.6).items()}
        return add(sway(t, 0.25), fist('r', 0.82), grip_l(0.9 * (1 - k) - 1.6 * k), lp)
    return Clip('arms_headlamp_knob', 1.6, fn, ik=ik2(lambda t: rw, lambda t: tuple(Rw.to_euler('XYZ')), left, lrot),
                note='C1: left thumb+index pull the headlamp knob out 12 mm (click at 0.85 s); reverse for off')


def stalk_flick():
    """C1: left fingers slide off the rim to the turn/high-beam stalk and flick it toward the driver (0.45 s),
    then settle back on the rim by 1.0 s; the hand barely leaves the wheel."""
    rw, Rw = rim_grip('r', 30.0)
    lw, Lw = rim_grip('l', 165.0)
    tip = STALK_TIP + Vector((0.02, 0.0, 0.015))
    Ls = frame((tip - Vector(lw)).normalized(), (0.4, 0.3, -0.85))
    at = tuple(tip - Ls.col[1] * 0.13)
    pull = tuple(Vector(at) + Vector((0, -0.02, 0)))
    left = reach([(0.0, lw), (0.3, at), (0.45, pull), (0.55, pull), (1.0, lw)])
    lrot = rpath([(0.0, Lw), (0.3, Ls), (0.55, Ls), (1.0, Lw)])

    def fn(t):
        k = ps.ease(t / 0.3) * (1 - ps.ease((t - 0.55) / 0.45))
        return add(sway(t, 0.2), fist('r', 0.82), grip_l(0.9 - 1.3 * k))
    return Clip('arms_stalk_flick', 1.0, fn, ik=ik2(lambda t: rw, lambda t: tuple(Rw.to_euler('XYZ')), left, lrot),
                note='C1: left fingers flick the high-beam stalk toward the driver at 0.45 s')


def brace():
    """C1: braced for impact: both hands clamp the rim at quarter-to-three, arms lock (the body is pushed back into
    the bench), white-knuckle tremble; 1.2 s, clamp the last frame to hold."""
    rw0, Rw0 = rim_grip('r', 30.0)
    lw0, Lw0 = rim_grip('l', 150.0)
    rw1, Rw1 = rim_grip('r', 8.0)
    lw1, Lw1 = rim_grip('l', 172.0)
    right = reach([(0.0, rw0), (0.25, rw1), (1.2, rw1)])
    left = reach([(0.0, lw0), (0.25, lw1), (1.2, lw1)])
    rrot = rpath([(0.0, Rw0), (0.25, Rw1), (1.2, Rw1)])
    lrot = rpath([(0.0, Lw0), (0.25, Lw1), (1.2, Lw1)])

    def fn(t):
        k = ps.ease(t / 0.25)
        return add(fist('r', 0.82 + 0.18 * k), grip_l(0.9 + 0.5 * k), tremble(t, 0.6 * k))
    return Clip('arms_brace', 1.2, fn, ik=ik2(right, rrot, left, lrot),
                note='C1: hands clamp the rim at quarter-to-three by 0.25 s, arms locked, tremble; clamp the last frame')


def map_hold_frame():
    """Left hand pinching the map's left edge: hand upright, knuckles up/forward, palm toward the map (+X)."""
    return frame((0.18, 0.25, 0.95), (1.0, 0.05, -0.15))


def map_wrist():
    return MAP_GRIP - map_hold_frame().col[1] * 0.105 - map_hold_frame().col[2] * 0.01


def map_socket_rest(rig):
    """Rest-space head/orientation of the arms `prop_l` socket such that, in the map hold, it sits at MAP_GRIP with
    +X along the map (toward its centre, the player's right), +Y away from the player (the printed face looks back
    along -Y at the eye) and +Z up the sheet."""
    rest_frames(rig)
    Mh = map_hold_frame().to_4x4()
    Mh.translation = map_wrist()
    y = MAP_C.normalized()
    S = frame(y, (0, 0, 1)).to_4x4()
    S.translation = MAP_GRIP
    L = Mh.inverted() @ S
    W = rig.data.bones['hand_l'].matrix_local @ L
    return W.translation.copy(), W.to_3x3()


def map_read():
    """C1 (6.0 s): the left hand leaves the rim, picks the folded road map up off the bench (0-1.2 s, map attached to
    prop_l from 0.6 s), unfolds it against the upper rim (1.2-2.8 s, the right hand opens the far edge), the right
    index traces County Road 9 (2.8-5.0 s), the map is lowered to the lap and the hands go back (5.0-6.0 s)."""
    rw, Rw = rim_grip('r', 30.0)
    lw, Lw = rim_grip('l', 150.0)
    Mh = map_hold_frame()
    hold = tuple(map_wrist())
    bench = (0.02, 0.22, -0.58)
    lap = tuple(Vector(hold) + Vector((0.06, -0.08, -0.28)))
    Lpick = frame((0.3, 0.6, -0.75), (0.2, -0.3, -0.9))
    left = reach([(0.0, lw), (0.5, bench), (0.7, bench), (1.2, tuple(Vector(hold) + Vector((0.03, -0.05, -0.08)))),
                  (2.0, hold), (5.0, hold), (5.6, lap), (6.0, lw)])
    lrot = rpath([(0.0, Lw), (0.5, Lpick), (0.7, Lpick), (1.4, Mh), (5.0, Mh), (5.6, Lpick), (6.0, Lw)])
    # right: opens the far edge, then traces with the index; points on the map's face (MAP_C plane), toward the eye
    n_ = -MAP_C.normalized()
    face = lambda dx, dz: MAP_C + Vector((dx, 0, dz)) + n_ * 0.004
    trace = [face(-0.05, -0.04), face(-0.02, -0.03), face(0.01, -0.01), face(0.03, 0.0), face(0.05, 0.025), face(0.06, 0.04)]
    # the index comes up at the sheet from below-right (as a reader points at a map held against the rim): the hand
    # stays under the map's lower half instead of on the eye->map ray (round C review: the back of the glove filled
    # a third of the frame 0.24 m from the eye)
    Rpt = frame((-0.35, 0.40, 0.85), (-0.2, 0.85, -0.45))
    Redge = frame((-0.25, 0.3, 0.92), (-0.9, 0.3, -0.1))
    edge = tuple(MAP_C + Vector((0.17, 0.0, 0.0)) - Redge.col[1] * 0.1)
    rk = [(0.0, rw), (1.6, rw), (2.1, edge), (2.6, edge)]
    tt = np.linspace(2.9, 4.9, len(trace))
    rk += [(float(t_), finger_wrist(p_, Rpt)) for t_, p_ in zip(tt, trace)]
    rk += [(5.2, tuple(Vector(finger_wrist(trace[-1], Rpt)) + Vector((0, -0.04, -0.02)))), (6.0, rw)]
    right = reach(rk)
    rrot = rpath([(0.0, Rw), (1.6, Rw), (2.1, Redge), (2.6, Redge), (2.9, Rpt), (4.9, Rpt), (6.0, Rw)])

    def fn(t):
        pick = ps.ease((t - 0.5) / 0.2)
        let = 1 - ps.ease((t - 5.6) / 0.3)
        lp = {k: tuple(v * pick * let for v in vv) for k, vv in pinch('l', 0.7).items()}
        po = ps.ease((t - 2.6) / 0.3) * (1 - ps.ease((t - 5.0) / 0.4))
        rf = {k: tuple(v * (1 - po) for v in vv) for k, vv in fist('r', 0.82 * (1 - ps.ease((t - 1.6) / 0.3) * (1 - ps.ease((t - 5.4) / 0.4)))).items()}
        return add(sway(t, 0.25), rf, point_r(po), grip_l(0.9 * (1 - pick * let) - 1.0 * pick * let), lp)
    return Clip('arms_map', 6.0, fn, ik=ik2(right, rrot, left, lrot),
                note='C1: road map on socket prop_l (attach at 0.6 s, detach at 5.8 s): picked up off the bench 0-1.2, '
                     'unfolded against the rim 1.2-2.8, right index traces 2.8-5.0, lowered 5.0-6.0')


def car_clips():
    return [radio_seek(), headlamp_knob(), stalk_flick(), brace(), map_read()]


def m2_clips():
    from . import clips_escape
    return [pickup_read(), pry_board(), cut_hem(), raise_locket(), locket_hold(), slide_bolt(), pour_can()] + \
        clips_escape.arms_clips()


M2_TODO = []
