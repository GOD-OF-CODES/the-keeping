"""C2-ESCAPE clips (docs/C2-ESCAPE.md §2.1, §3.1, §4.1; lane A items A4/A5).

Clip time = C2 time - 0.6 (O). All clips are IN PLACE; the runtime moves the roots (B-CINE `place`/`moves`) along
the ROOT PATHS below (PLAN space, C2 time; heading = plan angle of facing).

HARLAN harlan_c2 (28.4 s), root path:
   0.00- 9.10  (5.15, 3.95) h -1.25 (SSE)          strike root
   9.10- 9.45  -> (5.10, 3.60) h -1.25             one step toward the fallen head (the boot nudge 9.45)
  17.90-20.00  -> (4.15, 2.05) h -2.74             three steps to the doorway (head at his left thigh)
  20.20-21.60  -> (4.05, 0.60) h -1.64             to the dark SW corner (out of the lamp->body line)
  21.60-22.10  turn in place to h 0.92 (watching her rise)
  27.00-27.40  -> (3.95, 0.95) h 2.60              to the door leaf; pushes it shut 27.40-27.60; key 28.30
Beats (C2 time): sack to the doorway 2.4 (yaw 70 deg / 0.9 s), back 4.4; wind-up 4.8 (both hands, +12 cm);
downswing 7.42-7.56 (140 ms) — CONTACT 7.5667 (frame 209 of the clip, 6.9667 s): the cleaver_edge socket is IK-held
on the neck point; bitten 12 mm into the table edge at 7.60 and released 8.20 (runtime: hide harlan_cleaver(+handle),
show P_CLEAVER state 'bitten'); the boot nudge 9.45; crouch 10.5 + hair wring 10.6 (left fist = prop_l: attach
ada_head_rig there); stands and lifts 10.9-12.9 (fist z 2.62 world); wrist turns the head 150 deg at 12.4; holds;
'Go on, then.' 17.3; walks; right hand to P_CLEAT 19.3, rope off 20.0; corner; door 27.4-27.6; key 28.3.
"""
import math

import numpy as np

from . import gait
from . import poses as ps
from .clip import FPS, Clip
from .poses import add, arm, both, fingers, leg, lerp, neck, spine, wobble

O = 0.6
HARLAN_ROOT = (5.15, 3.95)
HARLAN_H = -1.25
NECK = (5.31, 3.25, 1.40)
FLOOR = 0.6
CONTACT = 209 / FPS        # clip s (C2 7.5667)
LIFT_WRIST = (0.10, -0.40, 1.94)   # local: wrist under the fist (fist 2.02 local = 2.62 world), ahead-left
CONTACT_FIX = np.zeros(3)  # build_anims re-bakes harlan_c2 with the measured contact error subtracted (<= 1 cm gate)


def to_local(p, root, heading):
    """PLAN point -> character-local (rig faces -y at yaw 0: yaw = heading + pi/2)."""
    yaw = heading + math.pi / 2
    dx, dy = p[0] - root[0], p[1] - root[1]
    c, s = math.cos(-yaw), math.sin(-yaw)
    return (dx * c - dy * s, dx * s + dy * c, p[2] - FLOOR)


NECK_L = to_local(NECK, HARLAN_ROOT, HARLAN_H)


def _c2(t):
    return t + O


def harlan_c2(geo):
    from .clips_harlan import grip_cleaver, stoop
    nx, ny, nz = NECK_L
    shoulder = np.array([-0.19, 0.0, 1.47])            # his right shoulder (local)
    raised = np.array([-0.02, 0.18, 2.02])              # edge over the right shoulder, behind the head
    windup = raised + np.array([0.0, 0.03, 0.12])       # +12 cm at 4.8
    contact = np.array([nx, ny, nz])
    bite = contact + np.array([0.0, 0.0, -0.062])       # through the neck (r ~5 cm) + 12 mm into the edge

    def edge_path(t):
        c = _c2(t)
        if c < 5.4:
            return raised + np.array([0, 0, 0.004 * math.sin(c * 2.1)])
        if c < 7.42:
            w = ps.ease((c - 4.8) / 0.9)
            return raised + (windup - raised) * w
        if c < 7.5667:
            # the downswing: an arc about the right shoulder from windup to contact (140 ms, accelerating)
            u = (c - 7.42) / (7.5667 - 7.42)
            u = u * u * (3 - 2 * u) * 0.35 + u * u * 0.65
            a, b = windup - shoulder, contact - shoulder
            ra, rb = np.linalg.norm(a), np.linalg.norm(b)
            ax = np.cross(a, b)
            ax /= np.linalg.norm(ax)
            ang = math.acos(np.clip(np.dot(a, b) / (ra * rb), -1, 1)) * u
            ah = a / ra
            rot = ah * math.cos(ang) + np.cross(ax, ah) * math.sin(ang) + ax * np.dot(ax, ah) * (1 - math.cos(ang))
            return shoulder + rot * (ra + (rb - ra) * u)
        if c < 7.60:
            u = (c - 7.5667) / (7.60 - 7.5667)
            return contact + (bite - contact) * u
        return bite

    def ik_w(t):
        c = _c2(t)
        return ps.ease((c - 4.6) / 0.4) * (1 - ps.ease((c - 8.15) / 0.15))

    def left_on_handle(t):
        # left hand 9 cm up the handle from the right (toward the pommel), only while both hands hold it
        p = edge_path(t)
        return p + (shoulder - p) * 0.0 + np.array([0.06, 0.06, 0.03])

    def fix_w(t):
        c = _c2(t)
        return ps.ease((c - 7.0) / 0.4) * (1 - ps.ease((c - 8.2) / 0.3))

    def lift_w(t):
        c = _c2(t)
        return ps.ease((c - 10.95) / 1.3) * (1 - ps.ease((c - 17.9) / 0.5))

    def lw(t):
        c = _c2(t)
        return ps.ease((c - 4.8) / 0.5) * (1 - ps.ease((c - 8.1) / 0.2))

    def fn(t):
        c = _c2(t)
        p = stoop(t)
        # sack to the doorway at 2.4 (70 deg over 0.9 s), back at 4.4
        look = ps.ease((c - 2.4) / 0.9) * (1 - ps.ease((c - 4.4) / 0.6))
        # strike body: rise into the wind-up, drive down through the chop, settle after the bite
        wind = ps.ease((c - 4.8) / 0.9) * (1 - ps.ease((c - 7.42) / 0.14))
        chop = ps.ease_in((c - 7.42) / 0.145) * (1 - 0.6 * ps.ease((c - 8.3) / 0.6))
        p = add(p, spine(bend=-7 * wind + 30 * chop, twist=-6 * wind + 4 * chop),
                neck(bend=-6 * wind + 10 * chop, twist=-40 * look, side=3 * look), {'head': (4 * look, -30 * look, 0)},
                both(leg, hip=8 * chop, knee=16 * chop, ankle=-6 * chop), {'_hips': (0, 0.0, -0.05 * chop)})
        up = lerp(arm('r', down=46, fwd=10, elbow=18),
                  arm('r', fwd=150, down=-6, elbow=70, wrist=-28, twist=-14, fore_twist=-20, shrug=18), 1.0)
        down = arm('r', fwd=62, down=22, elbow=12, wrist=8, twist=-8)
        p.update(lerp(up, down, chop))
        p.update(grip_cleaver())
        # left: on her shoulders until 4.8, then on the handle until the release at 8.2
        rest = add(arm('l', fwd=55, down=30, elbow=35, wrist=10), fingers('l', curl=20))
        handle = add(arm('l', fwd=140, down=-14, elbow=78, twist=24, wrist=-18), fingers('l', curl=78, thumb=45))
        handle_dn = add(arm('l', fwd=64, down=24, elbow=16, wrist=6, twist=8), fingers('l', curl=78, thumb=45))
        both_h = lerp(handle, handle_dn, chop)
        p.update(lerp(rest, both_h, lw(t)))
        # 8.2 lets go of the bitten cleaver, straightens 8.6-9.1 looking down for what fell
        rel = ps.ease((c - 8.2) / 0.4)
        if rel > 0:
            hang = add(arm('r', down=50, fwd=10, elbow=16), fingers('r', curl=30, thumb=15))
            p.update(lerp({k: p[k] for k in hang}, hang, rel))
            look_dn = ps.ease((c - 8.6) / 0.5)
            p = add(p, neck(bend=22 * look_dn), {'head': (12 * look_dn, 8 * look_dn, 0)})
        # the step (9.1-9.45, root moves) and the boot nudge with the left toe (9.45-9.75)
        step = ps.ease((c - 9.1) / 0.35) * (1 - ps.ease((c - 9.45) / 0.15))
        nudge = math.sin(math.pi * np.clip((c - 9.45) / 0.3, 0, 1))
        p = add(p, leg('l', hip=22 * step + 28 * nudge, knee=30 * step + 8 * nudge, ankle=-12 * nudge))
        # crouch 10.4-10.9, hand into the crown hair 10.5, wring/close 10.6
        crouch = ps.ease((c - 10.35) / 0.4) * (1 - ps.ease((c - 10.9) / 0.6))
        p = add(p, both(leg, hip=70 * crouch, knee=110 * crouch, ankle=-40 * crouch), spine(bend=18 * crouch),
                {'_hips': (0, 0.08 * crouch, -0.42 * crouch)})
        reach = add(arm('l', fwd=70, down=40, elbow=20, wrist=-10), fingers('l', curl=20, spread=10))
        grip = add(arm('l', fwd=66, down=42, elbow=22, wrist=-20, fore_twist=30), fingers('l', curl=85, thumb=50))
        # the lift: forearm raised, elbow at shoulder height, fist at z 2.62 world (2.02 local)
        lift = add(arm('l', fwd=88, down=-4, elbow=96, twist=10, wrist=-12, fore_twist=30), fingers('l', curl=88, thumb=52))
        # the 150 deg turn of the head is a WRIST twist (a forearm twist of 150 deg flipped the elbow and dropped the
        # fist 0.3 m, review round 1)
        turned = add(lift, {'hand_l': (0, 150, 0)})
        carry = add(arm('l', down=68, fwd=6, elbow=12, fore_twist=20), fingers('l', curl=88, thumb=52))
        if c >= 10.3:
            p.update(ps.track(c, [(10.3, {k: p[k] for k in reach}), (10.5, reach), (10.6, grip), (10.9, grip),
                                  (12.4, lift), (13.0, turned), (17.9, turned), (18.4, carry), (28.4, carry)]))
        # 'Go on, then.' 17.3: a small nod of the sack
        nod = math.sin(math.pi * np.clip((c - 17.3) / 0.5, 0, 1))
        p = add(p, neck(bend=6 * nod))
        # walking segments (in place; the runtime moves the root)
        for a, b in ((17.9, 20.0), (20.2, 21.6), (27.0, 27.4)):
            g = ps.ease((c - a) / 0.25) * (1 - ps.ease((c - b) / 0.25))
            if g > 0:
                w = gait.walk_pose(c - a, geo, speed=0.75, period=1.4, lift=0.05, lean=4, bob=0.014, sway=0.022,
                                   arm_swing=6.0, stance=0.63)
                keep = {k: p[k] for k in p if k.startswith(('upperarm_l', 'forearm_l', 'hand_l', 'thumb', 'index',
                                                              'middle', 'ring', 'pinky', 'clavicle_l'))}
                p = lerp(p, w, g)
                p.update(keep)
        # right hand to the cleat 19.3, the rope off at 20.0
        cleat = ps.ease((c - 19.0) / 0.4) * (1 - ps.ease((c - 20.15) / 0.4))
        if cleat > 0:
            p.update(lerp({k: p[k] for k in ('upperarm_r', 'forearm_r', 'hand_r')},
                          arm('r', fwd=112, down=-8, elbow=34, twist=-20, wrist=-10), cleat))
        # the door 27.4-27.6 (right palm on the leaf, push), the key 28.3 (wrist turn)
        door = ps.ease((c - 27.2) / 0.25)
        if door > 0:
            push = ps.ease((c - 27.4) / 0.2)
            p.update(lerp({k: p[k] for k in ('upperarm_r', 'forearm_r', 'hand_r')},
                          arm('r', fwd=72 + 10 * push, down=8, elbow=40 - 30 * push, wrist=-30,
                              fore_twist=60 * ps.ease((c - 28.3) / 0.25)), door))
        # breathing tremor in the held arm
        p['forearm_l'] = tuple(a + b for a, b in zip(p.get('forearm_l', (0, 0, 0)), (wobble(t, 21, 2.2, 0.8), 0, 0)))
        return p

    ik = {'cleaver_edge': {'target': lambda t: tuple(edge_path(t) + CONTACT_FIX * fix_w(t)), 'chain': 5, 'use_tail': True,
                          'weight': ik_w, 'lock': ('cleaver', 'cleaver_edge')},
          'hand_l': {'target': lambda t: tuple(left_on_handle(t)), 'chain': 3, 'weight': lw},
          # the lift: the wrist IK'd so the fist is at z 2.62 world (2.02 local), in front-left of the sack
          'forearm_l': {'target': lambda t: LIFT_WRIST, 'chain': 2, 'weight': lift_w}}
    return Clip('harlan_c2', 28.4, fn, ik=ik, milestone='M2',
                note='C2 (clip t = C2 t - 0.6): two-handed strike, CONTACT 6.9667 s (C2 7.5667) cleaver_edge on the '
                     'neck point; bitten 7.0; released 7.6; nudge 8.85; crouch+wring 9.9-10.0 (attach ada_head_rig '
                     'to prop_l at 10.0); lift to 12.3; head turned 150 deg 11.8-12.4; walks 17.3-19.4, 19.6-21.0, '
                     '26.4-26.8 (root path in clips_escape.py); cleat 18.7-19.4; door 26.8-27.0; key 27.7')


def contact_check(rig, act, clip):
    """World(local) distance of cleaver_edge to the neck point at the contact frame (A4 gate: <= 1 cm)."""
    import bpy
    from mathutils import Vector
    ad = rig.animation_data
    prev, nla = ad.action, ad.use_nla
    ad.use_nla = False
    ad.action = act
    if act.slots:
        ad.action_slot = act.slots[0]
    f = 1 + int(round(CONTACT * FPS))
    bpy.context.scene.frame_set(f)
    pb = rig.pose.bones['cleaver_edge']
    p = rig.matrix_world.inverted() @ (rig.matrix_world @ pb.head)
    d = (Vector(p) - Vector(NECK_L)).length
    ad.action = prev
    ad.use_nla = nla
    return d, tuple(round(x, 4) for x in p)


# ================================================================================================ Ada (A4 / A5)
# ROOTS (B-CINE): ada_c2 at ADA_TABLE (5.93, 3.30) heading pi (the build logs where her `head` joint lands vs the
# neck point (5.31, 3.25, 1.40)). ada_rise_headless ends standing at its root (no hips offset) facing the same way;
# the runtime turns her to the doorway at C2 24.7.
ADA_TABLE = (5.93, 3.30)
ADA_H = math.pi


def headless_stand(t=0.0, listen=0.0, seed=5):
    """A14 base pose without a head: shoulders hunched forward ~4 cm, the stump 2-3 cm below the shoulder line, the
    cap tilting 25-35 deg toward what she hears (listen -1..1 = side), arms forward, elbows ~30 deg, fingers spread."""
    j = wobble(t, seed, 0.35, 1.0)
    return add(spine(bend=14 + j, side=-2), neck(bend=24 + 2 * j, side=22 * listen, twist=8 * listen),
               {'clavicle_l': (-12, 0, 5), 'clavicle_r': (-12, 0, 5)},
               both(arm, fwd=34, down=30, elbow=30, wrist=-8, fore_twist=20),
               both(fingers, curl=12, spread=14, thumb=8),
               both(leg, hip=6, knee=12, ankle=-6), {'_hips': (0, 0.0, -0.02)})


def ada_c2():
    """C2 0.6-21.9 (clip 0-21.3): face-down across the table (her table pose; arms hanging down the EAST side, out of
    sight); the clench at 7.62 (hands jerk up from below the far edge and grip it, shoulders hunch 3 cm); the slump
    8.4-9.2; stillness with finger twitches every 1.5-2.5 s; 17.9-21.3 the hands slide on the wet sheet.
    The head node leaves at C2 7.60 (runtime re-parent); neck_02/head keys after that move nothing."""
    from .clips_ada import table_pose
    from .poses import claw

    def fn(t):
        c = _c2(t)
        p = table_pose(t)
        # arms back down the east side (behind her, alongside the hips), limp
        # (round 1: fwd -28 on a horizontal torso pointed the arms at the ceiling.) Arms at her sides along the torso
        # (it lies face-down), so the hands reach the hips at the east edge and hang over it at the wrist
        hang = add(both(arm, fwd=-4, down=78, elbow=8, wrist=-60, fore_twist=10), both(claw, amt=0.4))
        p.update(hang)
        clench = ps.ease((c - 7.62) / 0.09) * (1 - 0.45 * ps.ease((c - 8.4) / 0.8))
        if clench > 0:
            grip = add(both(arm, fwd=-10, down=70, elbow=24, wrist=-75, fore_twist=10),
                       both(fingers, curl=84, thumb=55))
            p.update(lerp({k: p[k] for k in grip if k in p} | {k: (0, 0, 0) for k in grip if k not in p}, grip, clench))
            p = add(p, {'clavicle_l': (-10 * clench, 0, 6 * clench), 'clavicle_r': (-10 * clench, 0, 6 * clench)},
                    spine(bend=-4 * clench))
        # finger twitches (every ~1.5-2.5 s after the slump)
        if c > 9.2:
            for s, ph in (('l', 0.0), ('r', 0.9)):
                tw = max(0.0, math.sin((c + ph) * 2 * math.pi / 2.1)) ** 12
                p = add(p, fingers(s, curl=-18 * tw, spread=6 * tw))
        # S7 on: the hands slide on the wet sheet (a slow drag toward the body)
        sl = ps.ease((c - 17.9) / 1.5)
        if sl > 0:
            p = add(p, both(arm, fwd=-10 * sl * (1 + 0.3 * math.sin(c * 1.7)), elbow=-12 * sl))
        return p
    return Clip('ada_c2', 21.3, fn, milestone='M2',
                note='C2 (clip t = C2 t - 0.6): table pose, arms down the east side; clench 7.02; slump 7.8-8.6; '
                     'twitches; hands slide 17.3-21.3. The head node is re-parented away at clip 7.0')


def ada_rise_headless():
    """C2 21.9-25.9 (4.0 s): slides backward off the east side of the table — knees to the floor (0.3-1.2), hands on
    the edge, climbs up its own arms (1.2-3.0), stands hunched (3.0-4.0) into headless_stand."""
    from .clips_ada import table_pose

    def fn(t):
        kneel = add({'hips': (24, 0, 0), '_hips': (0, 0.10, -0.42)}, spine(bend=36, side=3), neck(bend=30),
                    both(leg, hip=82, knee=118, ankle=-30), both(arm, fwd=96, down=-4, elbow=40, wrist=-28),
                    both(fingers, curl=70, thumb=45))
        climb = add({'hips': (14, 0, 0), '_hips': (0, 0.05, -0.18)}, spine(bend=30, side=-4), neck(bend=26),
                    leg('l', hip=62, knee=70, ankle=-20), leg('r', hip=20, knee=26, ankle=-8),
                    both(arm, fwd=70, down=14, elbow=58, wrist=-36), both(fingers, curl=72, thumb=45))
        stand = headless_stand(t, listen=0.3 * ps.ease((t - 2.8) / 0.6))
        p = ps.track(t, [(0.0, table_pose(0.0)), (0.3, table_pose(0.0)), (1.2, kneel), (1.6, kneel), (3.0, climb),
                         (4.0, stand)])
        # the knees hit the boards at ~1.05 (ada_slap at C2 22.2 is the runtime's)
        jolt = math.exp(-((t - 1.05) / 0.05) ** 2)
        p = add(p, spine(bend=5 * jolt))
        return p
    return Clip('ada_rise_headless', 4.0, fn, milestone='M2',
                note='C2 21.9-25.9: off the east side of the table backward, knees down ~1.05 s, hands on the edge, '
                     'climbs her arms, stands hunched (headless_stand) at 4.0; ends at hips offset 0')


def ada_chase_headless(geo):
    """C2c flat run, 2.2 m/s, stutter-sampled at runtime: arms forward and groping, shoulders leading, no head."""
    period = 0.62

    def fn(t):
        p = gait.walk_pose(t, geo, speed=2.2, period=period, lift=0.11, lean=18, bob=0.035, sway=0.03,
                           drag=('r', 0.15), arm_swing=0.0, hitch=0.25, stance=0.45, hips_drop=0.04)
        k = math.sin(2 * math.pi * t / period)
        p.update(add(spine(bend=18, side=-3, twist=5 * k), neck(bend=26, side=-6),
                     {'clavicle_l': (-12, 0, 5), 'clavicle_r': (-12, 0, 5)}))
        p.update(arm('r', fwd=58 + 14 * k, down=16, elbow=28 - 8 * k, wrist=-12, fore_twist=26))
        p.update(arm('l', fwd=50 - 14 * k, down=20, elbow=34 + 8 * k, wrist=-10, fore_twist=20))
        p.update(both(fingers, curl=18, spread=16, thumb=8))
        return p
    return Clip('ada_chase_headless', period, fn, loop=True, milestone='M2',
                note='headless lurch-run, 2.2 m/s, arms forward groping (C2c 0-2.6)')


STAIR_RISE, STAIR_TREAD = 0.219, 0.28       # ST_MAIN: 16 risers


def ada_climb_headless(geo):
    """C2c stair climb, 1.5 risers/s: pulls herself up the RIGHT-hand rail (east balustrade; she faces north, so the
    rail is on her right = local -x). The right hand is IK'd to a grip that is fixed in the world while held (it slides
    back along the rail in local space at her climbing speed) and re-grips every 0.8 s with a jerk; the left gropes at
    chest height. Rail: 0.55 m to her right, 0.90 m above the nosing line."""
    period = 2.0 / 1.5                       # two risers per loop
    v = STAIR_TREAD * 1.5                    # horizontal speed 0.42 m/s
    slope = STAIR_RISE / STAIR_TREAD
    regrip = period / 2.0                    # 0.667 s: two re-grips per loop (keeps it loopable; doc ~0.8 s)

    def rail(t):
        ph = (t % regrip) / regrip
        y = -0.24 + v * regrip * ph          # the held grip slides back (local +y) ...
        jerk = math.exp(-((ph - 0.02) / 0.03) ** 2)
        return (-0.50, y, 0.90 + slope * (-y) + 0.03 * jerk)

    def fn(t):
        climb = (2 * STAIR_RISE) * 0.6
        p = gait.walk_pose(t, geo, speed=2 * STAIR_TREAD / period, period=period, lift=0.06, lean=18, bob=0.02,
                           sway=0.02, drag=('r', 0.2), arm_swing=0.0, hitch=0.2, stance=0.6, climb=climb, step_h=0.13)
        p.update(add(spine(bend=20, side=-6), neck(bend=26, side=-8), {'clavicle_l': (-12, 0, 5), 'clavicle_r': (-14, 0, 8)}))
        p.update(add(arm('r', fwd=38, down=24, elbow=30, wrist=-14, fore_twist=20), fingers('r', curl=62, thumb=40)))
        k = math.sin(2 * math.pi * t / period * 1.5)
        p.update(add(arm('l', fwd=52 + 10 * k, down=12, elbow=40, wrist=-10, fore_twist=24), fingers('l', curl=14, spread=16)))
        return p
    return Clip('ada_climb_headless', period, fn, loop=True, milestone='M2',
                ik={'hand_r': {'target': rail, 'chain': 3}},
                note='headless climb 1.5 risers/s (rise 0.219, tread 0.28): right hand IK on the east rail, re-grip '
                     'jerk every 0.667 s; left gropes at chest height')


def ada_carry_r():
    """The right-hand GRIP pose layer for the runtime head-carry override (lead ruling: one mechanism): her right arm
    hanging at the thigh, fist closed on the crown hair (prop_r = the crown, the head hangs cut-end down). The runtime
    takes only upperarm_r/forearm_r/hand_r and the right fingers from this clip."""
    pose = add(arm('r', down=64, fwd=8, elbow=16, wrist=4, fore_twist=10), fingers('r', curl=86, thumb=52))
    return Clip('ada_carry_r', 0.2, lambda t: pose, milestone='M2',
                note='override layer: right arm + right fingers only (head node attached to prop_r)')


def _lift_pose(w):
    hang = add(arm('r', down=64, fwd=8, elbow=16, wrist=4, fore_twist=10), fingers('r', curl=86, thumb=52),
               arm('l', down=50, fwd=4, elbow=14, wrist=10), fingers('l', curl=22, spread=8))
    # both hands at face height in front of the stump (~0.25 m ahead): right fist above (hair), left palm under the jaw
    up = add(arm('r', fwd=92, down=-2, elbow=88, twist=-14, wrist=-16, fore_twist=40), fingers('r', curl=86, thumb=52),
             arm('l', fwd=80, down=6, elbow=96, twist=18, wrist=-24, fore_twist=60), fingers('l', curl=40, thumb=30))
    return lerp(hang, up, w)


def ada_head_lift():
    return Clip('ada_head_lift', 1.0, lambda t: _lift_pose(ps.ease(t / 1.0)), milestone='M2',
                note='override layer (both arms + fingers): carried at the thigh -> held up at face height in front of '
                     'the stump (the LOOK; eye() 0.25 m ahead); replaces ada_bone_crack timing')


def ada_head_lower():
    return Clip('ada_head_lower', 1.0, lambda t: _lift_pose(1.0 - ps.ease(t / 1.0)), milestone='M2',
                note='override layer: the lifted head back down to the thigh carry')


def ada_clips(geo):
    return [ada_c2(), ada_rise_headless(), ada_chase_headless(geo), ada_climb_headless(geo), ada_carry_r(),
            ada_head_lift(), ada_head_lower()]


# ================================================================================================ FP arms (A6)
# The FP rig holds the torch in the LEFT hand (clips_arms.py); the doc's C2c assumed the right. Here: the torch fist
# (left) pumps and its beam follows; the free RIGHT glove takes the newel and the rail (the balustrade is on the east =
# the player's right going up). Camera space: +Y view, +Z up, +X right (metres).
def arms_clips():
    from .clips_arms import REST_WR, F, fist, ik_r, open_hand, reach, sway, tremble

    def run_torch():
        period = 2.0 / 3.1                 # two risers at 3.1 risers/s

        def fn(t):
            k = math.sin(2 * math.pi * t / period)
            return add(sway(t, 0.6), F('upperarm_l', 10 * k, 0, 3 * k), F('forearm_l', 8 * k, 0, 0),
                       F('hand_l', -4 * k, 0, 2 * k), F('upperarm_r', -14 * k, 0, -4), F('forearm_r', -10 * k - 10, 0, 0),
                       fist('r', 0.45), tremble(t, 0.5))
        return Clip('arms_run_torch', period, fn, loop=True, milestone='M2',
                    note='C2c run: the torch (left) pumps at the step rate, the beam follows; right glove half-closed')

    def newel_knock():
        cap = np.array([0.30, 0.40, -0.30])          # the newel cap, front-right, at hip height
        path = reach([(0.0, REST_WR), (0.12, cap + np.array([0, -0.05, 0.04])), (0.15, cap), (0.40, cap),
                      (0.65, REST_WR)])

        def fn(t):
            hit = math.exp(-((t - 0.15) / 0.03) ** 2)
            grab = ps.ease((t - 0.12) / 0.05) * (1 - ps.ease((t - 0.42) / 0.15))
            # the torch arm swings out with the 60 deg turn: the beam kicks up ~25 deg at the knock
            kick = ps.ease((t - 0.13) / 0.06) * (1 - ps.ease((t - 0.35) / 0.25))
            return add(sway(t, 0.4), fist('r', 0.7 * grab), F('hand_r', -12 * hit, 0, 0),
                       F('upperarm_l', -14 * kick, 0, -6 * kick), F('hand_l', -18 * kick, 0, 0))
        return Clip('arms_newel_knock', 0.65, fn, ik=ik_r(path), milestone='M2',
                    note='C2c 1.65: the right glove slaps/grips the newel cap at 0.15 s (knock cue) to swing round; '
                         'the torch beam kicks ~25 deg up the stairwell wall')

    def stumble_catch():
        tread = np.array([0.20, 0.42, -0.52])        # tread 13 ahead/below the dropped eye (camera pitched -28 deg)
        path = reach([(0.0, REST_WR), (0.10, tread + np.array([0, 0.04, 0.10])), (0.16, tread), (1.05, tread),
                      (1.20, REST_WR)])

        def fn(t):
            fall = ps.ease(t / 0.15)
            slap = math.exp(-((t - 0.16) / 0.03) ** 2)
            hold = ps.ease((t - 0.15) / 0.05) * (1 - ps.ease((t - 1.0) / 0.2))
            # the torch arm thrown down and forward onto the tread: the torch knocks the wood and rolls half a turn
            torch = add(F('upperarm_l', 42 * fall * (1 - 0.5 * ps.ease((t - 1.0) / 0.2)), 0, -10 * fall),
                        F('forearm_l', 22 * fall, 0, 0), F('hand_l', -10 * fall, 0, 0),
                        F('hand_l', 0, 90 * ps.ease((t - 0.2) / 0.35), 0))
            return add(sway(t, 0.3), torch, open_hand('r', hold * 0.8), F('hand_r', 24 * hold - 8 * slap, 0, 0),
                       tremble(t, 0.8 * hold))
        return Clip('arms_stumble_catch', 1.2, fn, ik=ik_r(path), milestone='M2',
                    note='C2c 6.46: the toe catches riser 12; both gloves slap tread 13 at 0.16 s (torch knock), '
                         'torch rolls half a turn in the fist; push off by 1.0-1.2 s')

    return [run_torch(), newel_knock(), stumble_catch()]
