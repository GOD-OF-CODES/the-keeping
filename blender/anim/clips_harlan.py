"""Harlan's clips: the 15 s opening tableau (synced with ada_opening; his left hand follows her hair using her baked
head trajectory), three static lightning poses and the seated rocking-chair poses. Harlan never runs or attacks.

Staging (see clips_ada.py): his root sits at HARLAN_ROOT in Ada's frame, yawed 180 deg (he faces +Y there). The
player is on Ada's left (+X), which is HIS RIGHT.
"""
import json
import math

import numpy as np

from lib.scene import CACHE
from . import poses as ps
from .clip import FPS, Clip
from .clips_ada import HARLAN_ROOT, OPENING_SECONDS
from .poses import add, arm, both, fingers, leg, lerp, neck, spine, wobble


def stoop(t=0.0, seed=3):
    """Big, stooped, slow: rounded back, head pushed forward, knees soft, breathing."""
    br = math.sin(t * 2 * math.pi / 4.2)
    return add(spine(bend=19 + 1.2 * br, side=1.5), neck(bend=14, side=-2), {'head': (-16, 0, 0)},
               {'clavicle_l': (-7 + 1.5 * br, 0, 0), 'clavicle_r': (-7 + 1.5 * br, 0, 0)},
               both(arm, down=46, fwd=8, elbow=16, wrist=6), both(leg, hip=6, knee=10, ankle=-4),
               {'_hips': (0, 0.0, -0.018)}, fingers('l', curl=22, thumb=12))


def grip_cleaver():
    return fingers('r', curl=78, thumb=45)


def cleaver_raised(amount=1.0):
    """The second stroke raised overhead and held."""
    return lerp(arm('r', down=46, fwd=10, elbow=18), arm('r', fwd=150, down=-6, elbow=70, wrist=-28, twist=-14,
                                                         fore_twist=-20, shrug=18), amount)


def ada_head_track():
    p = CACHE / 'anims' / 'ada_opening_head.json'
    try:
        data = json.loads(p.read_text())
    except FileNotFoundError:
        return None
    M = np.array(data['head_world'])
    back = np.array([0.0, 0.075, -0.065, 1.0])       # back-top of her skull in the head bone's frame
    pts = (M @ back)[:, :3]
    # Ada's frame -> Harlan's local frame (root at HARLAN_ROOT, yawed 180 deg)
    r = np.array(HARLAN_ROOT)
    local = np.stack([-(pts[:, 0] - r[0]), -(pts[:, 1] - r[1]), pts[:, 2]], 1)
    return local


def opening():
    track = ada_head_track()

    def hold_w(t):
        return ps.ease((t - 4.1) / 0.8) * (1 - ps.ease((t - 11.4) / 0.6))

    def fn(t):
        lean = ps.ease((t - 4.2) / 1.2) * (1 - ps.ease((t - 11.6) / 1.2))
        p = add(stoop(t), spine(bend=16 * lean, twist=-6 * lean), {'_hips': (0, 0.0, -0.02 * lean)})
        # stroke raised from the start (it is the second stroke), a tremor of effort, held throughout
        p.update(cleaver_raised(1.0))
        p['forearm_r'] = tuple(a + b for a, b in zip(p['forearm_r'], (wobble(t, 11, 0.9, 1.5), 0, 0)))
        p.update(grip_cleaver())
        # left hand: resting on her back, then into her hair (IK), then out to the rope and let go
        rest = add(arm('l', fwd=55, down=30, elbow=35, wrist=10), fingers('l', curl=20))
        hair = add(arm('l', fwd=62, down=22, elbow=48, wrist=-10, fore_twist=40), fingers('l', curl=62, thumb=40))
        rope = add(arm('l', fwd=70, down=-18, elbow=62, twist=30, wrist=-10), fingers('l', curl=70, thumb=40))
        let_go = add(arm('l', fwd=66, down=-12, elbow=58, twist=30), fingers('l', curl=8, thumb=5, spread=8))
        p.update(ps.track(t, [(0.0, rest), (4.1, rest), (5.0, hair), (11.4, hair), (12.1, rope), (12.35, rope),
                              (12.5, let_go), (15.0, add(let_go, arm('l', down=10)))]))
        # the sack turns to the doorway (his right) and holds three heartbeats, then the tilt of the head
        turn = ps.ease((t - 8.0) / 1.1) * (1 - 0.35 * ps.ease((t - 13.0) / 1.5))
        p = add(p, neck(twist=-38 * turn, side=4 * turn), {'head': (6 * turn, -24 * turn, 5 * turn)})
        return p
    ik = None
    if track is not None:
        def target(t):
            i = min(int(round(t * FPS)), len(track) - 1)
            return track[i]
        ik = {'hand_l': {'target': target, 'chain': 3, 'weight': hold_w}}
    return Clip('harlan_opening', OPENING_SECONDS, fn, ik=ik,
                note='C2: stroke raised and held; turns her head by the hair (4.5-7.5 s); the sack turns to the '
                     'doorway (8-9 s); releases the rope 12.35 s ("Go on, then." before it)')


def pose_clip(name, pose, note):
    return Clip(name, 1.0 / 30.0, lambda t: pose, note=note)


def car_push():
    p = add(spine(bend=34, side=-3), neck(bend=-8), {'head': (-18, 0, 0)},
            arm('l', fwd=88, down=6, elbow=28, wrist=-55), arm('r', fwd=84, down=10, elbow=32, wrist=-55),
            fingers('l', curl=8, spread=6), fingers('r', curl=8, spread=6),
            leg('l', hip=38, knee=42, ankle=4), leg('r', hip=-22, knee=6, ankle=18),
            {'_hips': (0, 0.05, -0.08), 'hips': (8, 0, 0)})
    return pose_clip('harlan_pose_car_push', p, 'C3 flash 2: shoulder into the trunk of your car, pushing it into the row')


def look_up():
    p = add(stoop(), spine(bend=-6), neck(bend=-34, twist=6), {'head': (-26, 4, 0)},
            arm('r', down=40, fwd=10, elbow=20), grip_cleaver(), arm('l', down=44, fwd=4, elbow=12))
    return pose_clip('harlan_pose_look_up', p, 'C3 flash 3: in the field, the sack tilted up at your window')


def stairs_foot():
    p = add(stoop(), neck(bend=-12, twist=-10), {'head': (-10, -8, 0)},
            arm('l', fwd=34, down=26, elbow=40, wrist=-20), fingers('l', curl=55, thumb=30),
            arm('r', down=44, fwd=4, elbow=16), grip_cleaver(), leg('l', hip=14, knee=16))
    return pose_clip('harlan_pose_stairs_foot', p, 'lightning pose: watching from the foot of the stairs, hand on the newel')


def seated_base(t=0.0):
    br = math.sin(t * 2 * math.pi / 4.2)
    return add({'_hips': (0, 0.07, -0.43), 'hips': (-8, 0, 0)}, spine(bend=24 + br, side=2), neck(bend=18), {'head': (8, 0, 0)},
               leg('l', hip=92, knee=88, ankle=-6, abduct=8), leg('r', hip=90, knee=84, ankle=-4, abduct=10),
               arm('l', fwd=38, down=30, elbow=58, wrist=12), arm('r', fwd=36, down=32, elbow=54, wrist=8),
               fingers('l', curl=35), grip_cleaver())


def seated():
    return Clip('harlan_seated', 4.2, seated_base, loop=True,
                note='rocking chair (seat 0.42 m): the chair rocks procedurally at runtime, he rocks with it')


def seated_look_up():
    return pose_clip('harlan_seated_look_up', add(seated_base(), spine(bend=-10), neck(bend=-40), {'head': (-30, 0, 0)}),
                     'blend target: the sack tilts up at the floor grate (head-bone blend over harlan_seated)')


def all_clips(geo):
    return [opening(), car_push(), look_up(), stairs_foot(), seated(), seated_look_up()]


M2_TODO = ['harlan_finale (static in the door gap, backs away raising the cleaver)',
           'harlan_finale_shadow (pre-rendered wall-shadow clip of the fall)']
