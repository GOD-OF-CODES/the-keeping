"""Parametric in-place gait generator (walk, stutter-walk, lurch-run, stairs) with analytic 2-bone leg IK.

Feet are planned in the character's frame (the character faces -Y). In place: a stance foot slides backward at the
travel speed (and, on stairs, downward at the climb rate) so that with root motion applied at runtime
(speed m/s along facing) it stays planted. Leg angles come from a sagittal-plane 2-bone solve, the foot pitch is
set in world space, then everything is expressed as pose-dict rotations (poses.py convention).
"""
import math

import numpy as np

from . import poses as ps


class LegGeo:
    """Rest geometry read from the rig: hip joint positions, thigh/calf lengths, ankle height."""

    def __init__(self, rig):
        b = rig.data.bones
        self.hip = {s: np.array(b[f'thigh_{s}'].head_local) for s in ps.SIDES}
        self.L1 = b['thigh_l'].length
        self.L2 = b['calf_l'].length
        self.ankle = {s: np.array(b[f'calf_{s}'].tail_local) for s in ps.SIDES}
        self.hips_z = b['hips'].head_local[2]
        self.ball = {s: np.array(b[f'toe_{s}'].head_local) for s in ps.SIDES}
        # rest leg direction in the sagittal plane (usually ~straight down, slightly forward)
        self.rest_pitch = {s: math.atan2(-(self.ankle[s][1] - self.hip[s][1]), self.hip[s][2] - self.ankle[s][2]) for s in ps.SIDES}
        self.rest_knee = {}
        for s in ps.SIDES:
            k = np.array(b[f'thigh_{s}'].tail_local)
            a1 = math.atan2(-(k[1] - self.hip[s][1]), self.hip[s][2] - k[2])
            a2 = math.atan2(-(self.ankle[s][1] - k[1]), k[2] - self.ankle[s][2])
            self.rest_knee[s] = a1 - a2
            self.rest_thigh = a1


def leg_ik(geo, side, ankle_target, hips_offset=(0, 0, 0), hips_pitch=0.0, foot_pitch=0.0):
    """ankle_target: world (x, y, z) wanted ankle position (rest frame, the character facing -Y).
    Returns leg pose dict (degrees). hips_pitch: forward tilt of the pelvis in degrees (+ = forward)."""
    hip = geo.hip[side] + np.asarray(hips_offset)
    d = np.asarray(ankle_target) - hip
    fwd = -d[1]                 # forward component
    down = -d[2]
    lat = d[0]
    D = math.sqrt(fwd * fwd + down * down)
    L1, L2 = geo.L1, geo.L2
    D = min(D, (L1 + L2) * 0.9995)
    D = max(D, abs(L1 - L2) + 1e-4)
    knee_int = math.acos(max(-1.0, min(1.0, (L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2))))
    knee = math.pi - knee_int                           # 0 = straight
    a = math.atan2(fwd, down)                           # direction hip->ankle, + = forward
    b = math.acos(max(-1.0, min(1.0, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D))))
    thigh_pitch = a + b                                 # thigh forward of the hip-ankle line (knee forward)
    hip_flex = math.degrees(thigh_pitch - geo.rest_thigh) + hips_pitch
    knee_flex = math.degrees(knee - geo.rest_knee[side])
    calf_pitch_world = hip_flex - hips_pitch - knee_flex
    ankle = foot_pitch - calf_pitch_world
    # small abduction to put the foot laterally where asked
    rest_lat = geo.ankle[side][0] - geo.hip[side][0]
    abd = math.degrees(math.atan2(lat - rest_lat, max(down, 0.2))) * (1.0 if side == 'l' else -1.0)
    return ps.leg(side, hip=hip_flex, knee=knee_flex, ankle=ankle, abduct=abd)


def foot_path(phase, stride, lift, stance=0.62, drag=0.0, climb=0.0, step_h=0.0):
    """One foot over a cycle phase in [0, 1): returns (forward offset, up offset, foot pitch deg).
    Stance: 0..stance, sliding from +stride/2 to -stride/2 (and down by `climb` on stairs).
    Swing: stance..1, forward with an arc of height `lift` (and up by `climb`)."""
    if phase < stance:
        u = phase / stance
        f = stride * (0.5 - u)
        up = climb * (0.5 - u)
        pitch = 12.0 * max(0.0, 1 - u / 0.12) - 18.0 * max(0.0, (u - 0.75) / 0.25)   # heel strike, heel-off
        return f, up, pitch
    u = (phase - stance) / (1 - stance)
    f = stride * (-0.5 + ps.ease(u))
    arc = math.sin(math.pi * u)
    up = climb * (-0.5 + ps.ease(u)) + lift * arc * (1 - drag) + step_h * arc
    pitch = -30.0 * (1 - u) ** 2 + 10.0 * u * u - 25 * drag * arc
    return f, up, pitch


def gown_follow(pose, amount=0.55, chains=8):
    """Skirt chains follow the thighs (front panels ride on the knee, back panels on the heel)."""
    th_l = pose.get('thigh_l', (0, 0, 0))[0]
    th_r = pose.get('thigh_r', (0, 0, 0))[0]
    kn_l = pose.get('calf_l', (0, 0, 0))[0]
    kn_r = pose.get('calf_r', (0, 0, 0))[0]
    out = {}
    for k in range(chains):
        ang = 2 * math.pi * k / chains
        f, s = math.cos(ang), math.sin(ang)       # f: front(1)/back(-1); s: her left(+)/right(-)
        wl = ps.ease((s + 0.6) / 1.2)
        th = th_l * wl + th_r * (1 - wl)
        kn = kn_l * wl + kn_r * (1 - wl)
        # outward flexion: front panels flex out when the thigh goes forward, back panels when it goes back
        r1 = amount * th * f
        r1 = max(r1, -4.0) if f > 0 else r1
        out[f'gown_{k}_01'] = (max(r1, -6.0), 0.0, 0.0)
        out[f'gown_{k}_02'] = (-0.35 * amount * th * f + 0.15 * kn * (f < 0), 0.0, 0.0)
        out[f'gown_{k}_03'] = (0.1 * amount * kn, 0.0, 0.0)
    return out


def walk_pose(t, geo, speed=0.9, period=1.35, lift=0.07, lean=6.0, bob=0.022, sway=0.025, drag=('r', 0.0),
              arm_swing=12.0, hitch=0.0, stance=0.62, climb=0.0, step_h=0.0, hips_drop=0.0, knee_soft=0.0):
    """Base walking pose at time t (seconds) for a loop of `period` (two steps)."""
    ph = (t / period) % 1.0
    if hitch:
        ph = (ph + hitch * math.sin(2 * math.pi * ph) / (2 * math.pi) * 0.9) % 1.0
    stride = speed * period * stance
    pose = {}
    # pelvis: bob twice per cycle (low at double support), sway toward the stance leg, forward lean
    bob_z = -bob * (0.5 + 0.5 * math.cos(4 * math.pi * (ph - 0.12))) - hips_drop
    sway_x = sway * math.sin(2 * math.pi * ph)
    hips_off = (sway_x, 0.0, bob_z)
    pose['_hips'] = hips_off
    pose['hips'] = (lean * 0.4, 8.0 * math.sin(2 * math.pi * ph), -4.0 * math.sin(2 * math.pi * ph))
    for side, off in (('l', 0.0), ('r', 0.5)):
        p = (ph + off) % 1.0
        dr = drag[1] if drag[0] == side else 0.0
        f, up, pitch = foot_path(p, stride, lift, stance, drag=dr, climb=climb, step_h=step_h)
        a = geo.ankle[side]
        target = (a[0], a[1] - f, a[2] + up + knee_soft)
        pose.update(leg_ik(geo, side, target, hips_offset=hips_off, hips_pitch=lean * 0.4, foot_pitch=pitch))
        # arms swing opposite to the legs
        sw = arm_swing * math.sin(2 * math.pi * (p + 0.5))
        pose.update(ps.arm(side, fwd=sw, down=46.0, elbow=10.0 + 0.4 * max(sw, 0.0), wrist=6.0))
    pose.update(ps.spine(bend=lean * 0.6, twist=-7.0 * math.sin(2 * math.pi * ph)))
    pose.update(gown_follow(pose))
    return pose
