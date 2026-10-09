"""Ada's M1 clips. All in place (root never moves); runtime applies travel and samples her at 8-12 fps.

Opening staging (shared with clips_harlan.py; see docs/CHARACTERS.md): Ada's root at the origin facing -Y, bent
across the sawbuck table whose top is at z = TABLE_Z spanning y in [TABLE_Y0, TABLE_Y1]; her head hangs over the
far edge. Harlan's root is at HARLAN_ROOT facing +Y (yaw 180 deg). The player is expected on her LEFT (+X), 3-4 m.
"""
import math

from . import gait
from . import poses as ps
from .clip import Clip
from .poses import add, arm, both, claw, fingers, leg, lerp, mirror, neck, spine, track, wobble

TABLE_Z = 0.76
TABLE_Y0, TABLE_Y1 = -0.03, -0.63
HARLAN_ROOT = (0.02, -1.08, 0.0)
OPENING_SECONDS = 15.0


def hang_head(amount=1.0, side=12.0):
    """The half-severed neck lolls: forward and to one side."""
    return add(neck(bend=38 * amount, side=side * amount, twist=6 * amount), {'head': (22 * amount, 0, 8 * amount)})


def base_stand(t=0.0, seed=1):
    j = wobble(t, seed, 0.3, 1.0)
    return add(
        spine(bend=12 + j, side=-3),
        hang_head(1.0, 14 + 2 * j),
        both(arm, down=50, fwd=4, elbow=14, wrist=10, shrug=-6),
        both(claw, amt=0.65),
        both(leg, hip=4, knee=8, ankle=-4),
        {'_hips': (0, 0, -0.012)},
    )


def lift_head(amount):
    """0 = hanging, 1 = held up level and facing forward (the LOOK)."""
    return lerp(hang_head(1.0), add(neck(bend=-6, side=-4, twist=0), {'head': (-10, 0, -3)}), amount)


def hand_to_jaw(side, amount):
    """FK approximation of the hand cupped under the jaw (IK corrects it onto jaw_hold)."""
    s = 1 if side == 'r' else -1
    held = add(arm(side, fwd=78, down=10, elbow=128, twist=-25, wrist=-18, fore_twist=40, shrug=10),
               fingers(side, curl=35, thumb=20))
    return lerp(add(arm(side, down=50, fwd=4, elbow=14), claw(side, 0.65)), held, amount)


def jaw_ik(side, when=lambda t: 1.0):
    return {f'hand_{side}': {'bone': 'jaw_hold', 'chain': 3, 'weight': when}}


# ------------------------------------------------------------------------------------------------ locomotion
def patrol(geo):
    def fn(t):
        p = gait.walk_pose(t, geo, speed=0.9, period=1.5, lift=0.04, lean=9, bob=0.018, sway=0.03,
                           drag=('r', 0.55), arm_swing=5.0, hitch=0.35, stance=0.64)
        p.update(add(hang_head(1.0, 16 + 4 * math.sin(2 * math.pi * t / 1.5)), spine(bend=10, side=-3)))
        p.update(both(claw, amt=0.7))
        # limp arms lag the body
        for s in ps.SIDES:
            ua = p.get(f'upperarm_{s}', (0, 0, 0))
            p[f'upperarm_{s}'] = (ua[0] * 0.6 + 3, ua[1], -50 * ps.sgn(s))
            p[f'forearm_{s}'] = (16 + 6 * math.sin(2 * math.pi * t / 1.5 + (0 if s == 'l' else 3)), 0, 0)
        return p
    return Clip('ada_patrol', 1.5, fn, loop=True, note='stutter-walk, head hanging, right foot drags; 0.9 m/s')


def chase(geo):
    period = 0.72

    def fn(t):
        p = gait.walk_pose(t, geo, speed=3.2, period=period, lift=0.13, lean=24, bob=0.04, sway=0.035,
                           drag=('r', 0.2), arm_swing=0.0, hitch=0.25, stance=0.42, hips_drop=0.05)
        p.update(add(spine(bend=22, side=-4, twist=4 * math.sin(2 * math.pi * t / period)), lift_head(0.85)))
        p.update(hand_to_jaw('l', 1.0))
        # the free arm claws forward, jerking
        k = math.sin(2 * math.pi * t / period)
        p.update(arm('r', fwd=55 + 18 * k, down=18, elbow=25 - 10 * k, wrist=-10, fore_twist=30))
        p.update(fingers('r', curl=20 + 20 * k, spread=8))
        return p
    return Clip('ada_chase', period, fn, loop=True, ik=jaw_ik('l'), note='lurch-run holding her head up; 3.2 m/s bursts')


def stairs(geo, up=True):
    period = 1.5
    rise, tread = 0.19, 0.26
    stance = 0.6

    def fn(t):
        climb = (2 * rise) * stance * (1 if up else -1)
        p = gait.walk_pose(t, geo, speed=2 * tread / period, period=period, lift=0.05 if up else 0.03,
                           lean=16 if up else 2, bob=0.02, sway=0.02, drag=('r', 0.25), arm_swing=3.0,
                           hitch=0.2, stance=stance, climb=climb, step_h=0.12 if up else 0.05, knee_soft=0.0)
        p.update(add(hang_head(0.9, 12), spine(bend=16 if up else 6, side=-5)))
        # right hand slides on the banister (rail to her right), left arm limp
        k = (t / period) % 1.0
        p.update(arm('r', fwd=28 + 6 * math.sin(2 * math.pi * k), down=22, elbow=35, wrist=-15, fore_twist=20))
        p.update(fingers('r', curl=45, thumb=30))
        p.update(add(arm('l', down=50, fwd=5, elbow=15), claw('l', 0.7)))
        return p
    name = 'ada_stairs_up' if up else 'ada_stairs_down'
    return Clip(name, period, fn, loop=True,
                note=f'two steps per loop (rise {rise} m, tread {tread} m); right hand on the banister (CCDIK at runtime)')


# ------------------------------------------------------------------------------------------------ states
def listen():
    def fn(t):
        a = ps.ease(t / 0.5)
        tilt = add(neck(bend=24, side=-26, twist=-22), {'head': (10, -10, -18)})
        p = lerp(base_stand(t), add(base_stand(t), tilt), a)
        p = add(p, spine(bend=0, side=0, twist=-8 * a))
        # fingers twitch once
        tw = 18 * math.exp(-((t - 1.3) / 0.08) ** 2)
        p = add(p, fingers('r', curl=tw))
        return p
    return Clip('ada_listen', 2.5, fn, note='freeze ~1 s with the head tilted toward the noise; hold the last frame')


def look():
    # 0-0.35 hand to jaw | 0.35-1.2 lift (bone crack at 1.0) | hold to 4.2 | lower to 5.0
    def fn(t):
        up = ps.ease((t - 0.35) / 0.85) * (1 - ps.ease((t - 4.2) / 0.8))
        hand = ps.ease(t / 0.35) * (1 - ps.ease((t - 4.4) / 0.6))
        p = add(base_stand(t), spine(bend=-6 * up))
        p.update(lift_head(up))
        # the crack: a sharp settle at 1.0 s, then tiny searching turns
        crack = 6 * math.exp(-((t - 1.0) / 0.05) ** 2)
        p['neck_02'] = tuple(a + b for a, b in zip(p.get('neck_02', (0, 0, 0)), (0, 0, crack)))
        search = up * wobble(t, 9, 0.35, 7.0)
        p['head'] = tuple(a + b for a, b in zip(p.get('head', (0, 0, 0)), (0, search, 0)))
        p.update(hand_to_jaw('r', hand))
        return p
    return Clip('ada_look', 5.0, fn, ik=jaw_ik('r', lambda t: ps.ease((t - 0.1) / 0.3) * (1 - ps.ease((t - 4.4) / 0.5))),
                note='hand to jaw, lift with a crack at 1.0 s, 3 s of sight, lower; runtime may shorten the wind-up')


def hide_check():
    def fn(t):
        a = ps.ease(t / 1.2)
        out = 1 - ps.ease((t - 5.0) / 1.0)
        lean = a * out
        p = add(base_stand(t), spine(bend=14 * lean, side=4 * lean), {'_hips': (0, -0.05 * lean, 0)})
        p.update(lift_head(lean * 0.92))
        p['head'] = tuple(a_ + b for a_, b in zip(p.get('head', (0, 0, 0)), (6 * lean, 8 * lean * math.sin(t * 1.3), 0)))
        p.update(hand_to_jaw('r', lean))
        # left hand flat on the slats beside her face, fingers creeping
        tap = math.sin(t * 5.0) * 4 * lean
        p.update(lerp(add(arm('l', down=50, fwd=4, elbow=14), claw('l', 0.65)),
                      add(arm('l', fwd=70, down=5, elbow=70, wrist=-30, twist=30), fingers('l', curl=10 + tap, spread=6)), lean))
        return p
    return Clip('ada_hide_check', 6.0, fn, ik=jaw_ik('r', lambda t: ps.ease((t - 0.3) / 0.9) * (1 - ps.ease((t - 5.0) / 0.8))), note='face to the slats of a hide ("...Harlan?"), ~3 s listen')


def hide_tear():
    def fn(t):
        reach = ps.ease(t / 0.25)
        pull = ps.ease((t - 0.45) / 0.4)
        p = add(base_stand(t), spine(bend=18 * reach - 22 * pull, twist=10 * pull), lift_head(0.8))
        for s in ps.SIDES:
            p.update(lerp(arm(s, fwd=85, down=8, elbow=15, fore_twist=40), arm(s, fwd=45, down=25, elbow=95, twist=-20), pull))
            p.update(lerp(fingers(s, curl=5, spread=10), fingers(s, curl=75, thumb=40), ps.ease((t - 0.3) / 0.15)))
        p['_hips'] = (0, -0.08 * reach + 0.12 * pull, -0.03)
        return p
    return Clip('ada_hide_tear', 1.4, fn, note='catch variant: grabs the hide door and tears it open')


def vigil():
    period = 4.0

    def fn(t):
        k = (t / period) % 1.0
        p = add(spine(bend=16, side=-2), neck(bend=30, side=4, twist=0), {'head': (14, 0, 3)},
                both(leg, hip=6, knee=10, ankle=-4), {'_hips': (0, -0.03, -0.015)})
        for s, ph in (('l', 0.0), ('r', 0.5)):
            u = (k + ph) % 1.0
            scrape = math.sin(2 * math.pi * u)
            p.update(arm(s, fwd=92 + 5 * scrape, down=14, elbow=78 - 8 * scrape, wrist=-25, twist=15, shrug=8))
            p.update(fingers(s, curl=30 + 25 * max(scrape, 0), thumb=20, spread=4))
        return p
    return Clip('ada_vigil', period, fn, loop=True, note='forehead to the planks of her door, scraping the nail heads')


def catch():
    def fn(t):
        lunge = ps.ease(t / 0.3)
        close = ps.ease((t - 0.35) / 0.3)
        p = add(base_stand(t), spine(bend=20 * lunge, side=-5), lift_head(lunge))
        p.update(arm('r', fwd=10 + 88 * lunge, down=50 - 40 * lunge, elbow=14 + 6 * close, wrist=-25 + 35 * close, fore_twist=70 * lunge))
        p.update(lerp(fingers('r', curl=0, spread=12, thumb=0), fingers('r', curl=70, thumb=50), close))
        p.update(arm('l', fwd=60 * lunge, down=20, elbow=40))
        p['_hips'] = (0, -0.25 * lunge, -0.03 * lunge)
        return p
    return Clip('ada_catch', 1.4, fn, note='grab over the lens: the right hand fills the camera from ~0.4 m')


# ------------------------------------------------------------------------------------------------ opening
def table_pose(t=0.0):
    """Bent across the table: folded at the hips, torso on the top, arms hanging over the sides, head over the edge."""
    br = 0.5 + 0.5 * math.sin(t * 0.8)
    return add(
        {'hips': (70, 0, 0), '_hips': (0, 0.04, -0.05)},
        spine(bend=26 + 1.5 * br, side=2),
        neck(bend=36, side=-6, twist=4), {'head': (26, 0, -6)},
        arm('l', fwd=150, down=34, elbow=40, wrist=20, fore_twist=20), arm('r', fwd=146, down=36, elbow=46, wrist=16, fore_twist=20),
        both(claw, amt=0.5),
        leg('l', hip=72, knee=12, ankle=-4, abduct=4), leg('r', hip=70, knee=14, ankle=-5, abduct=3),
    )


def opening():
    """15 s tableau (synced with harlan_opening): face-down (0-4.5) | his hand lifts and turns her head to the
    doorway (+X) by the hair (4.5-7.5) | held, both look (7.5-11.5) | released, head drops (12.4-13.2)."""
    def fn(t):
        base = table_pose(t)
        lift = ps.ease((t - 4.5) / 3.0) * (1 - ps.ease((t - 12.4) / 0.8))
        turned = add(table_pose(t), neck(bend=-38, side=-10, twist=40), {'head': (-30, 35, -10)})
        p = lerp(base, turned, lift)
        # the eye opens (runtime: eye_open cue at 9.0 s); a slight jolt when dropped
        drop = math.exp(-((t - 13.2) / 0.12) ** 2) * 8
        p['head'] = tuple(a + b for a, b in zip(p['head'], (drop, 0, 0)))
        return p
    return Clip('ada_opening', OPENING_SECONDS, fn, note='C2 tableau; cue: eye opens 9.0 s; held 3 heartbeats')


def table_idle():
    return Clip('ada_table', 4.0, lambda t: table_pose(t), loop=True, note='face-down across the table (pre-C2)')


def rise():
    """Slides off the table and rises on the half-cut neck, head lolling (4 s)."""
    def fn(t):
        a = ps.ease(t / 1.6)
        b = ps.ease((t - 1.4) / 2.0)
        mid = add({'hips': (30, 0, 8), '_hips': (0, 0.08, -0.12)}, spine(bend=30, side=6), hang_head(1.2, 25),
                  both(arm, down=40, fwd=30, elbow=20), both(claw, amt=0.8), leg('l', hip=48, knee=35, ankle=-10), leg('r', hip=40, knee=40, ankle=-8))
        p = lerp(table_pose(0), mid, a)
        p = lerp(p, add(base_stand(t), hang_head(0.4, 30)), b)
        # the head swings on the neck when she straightens
        sw = 18 * math.sin(max(t - 2.2, 0) * 6.0) * math.exp(-max(t - 2.2, 0) * 1.5) * (t > 2.2)
        p['neck_02'] = tuple(x + y for x, y in zip(p.get('neck_02', (0, 0, 0)), (0, 0, sw)))
        return p
    return Clip('ada_rise', 4.0, fn, note='C2 end: rises from the table, head lolling on the neck spring')


def all_clips(geo):
    return [table_idle(), opening(), rise(), patrol(geo), listen(), look(), chase(geo), stairs(geo, True),
            stairs(geo, False), hide_check(), hide_tear(), vigil(), catch()] + m2_clips(geo)


# ================================================================================================ M2 clips
# Ada's frame: root at the feet, facing -Y, her left = +X. IK targets below are wrist positions (forearm tail) in that
# frame; `planted` keeps both feet on the floor under a moved/pitched pelvis with the analytic leg IK.
import numpy as np                                       # noqa: E402
from mathutils import Matrix, Vector                     # noqa: E402

REST_WRIST = {'l': (0.546, -0.001, 0.95), 'r': (-0.546, -0.001, 0.95)}


def planted(geo, hips_off=(0.0, 0.0, 0.0), pitch=0.0, ankles=None, foot_pitch=(0.0, 0.0)):
    p = {'_hips': tuple(hips_off), 'hips': (pitch, 0.0, 0.0)}
    for i, s in enumerate(ps.SIDES):
        a = geo.ankle[s] if ankles is None else ankles[s]
        p.update(gait.leg_ik(geo, s, a, hips_offset=hips_off, hips_pitch=pitch, foot_pitch=foot_pitch[i]))
    return p


def wpath(keys, fn=ps.ease):
    """[(t, (x, y, z))] -> eased piecewise wrist path."""
    pts = [(t, np.asarray(p, float)) for t, p in keys]

    def f(t):
        if t <= pts[0][0]:
            return pts[0][1]
        for (t0, p0), (t1, p1) in zip(pts[:-1], pts[1:]):
            if t <= t1:
                return p0 + (p1 - p0) * fn((t - t0) / max(t1 - t0, 1e-6))
        return pts[-1][1]
    return f


def hframe(y, z):
    y = Vector(y).normalized()
    z = Vector(z)
    z = (z - y * z.dot(y)).normalized()
    return Matrix((y.cross(z), y, z)).transposed()


def rkeys(keys):
    qs = [(t, M.to_quaternion()) for t, M in keys]
    for i in range(1, len(qs)):
        if qs[i][1].dot(qs[i - 1][1]) < 0:
            qs[i] = (qs[i][0], -qs[i][1])

    def f(t):
        q = qs[0][1] if t <= qs[0][0] else qs[-1][1]
        for (t0, q0), (t1, q1) in zip(qs[:-1], qs[1:]):
            if t0 < t <= t1:
                q = q0.slerp(q1, ps.ease((t - t0) / max(t1 - t0, 1e-6)))
                break
        return tuple(q.to_matrix().to_euler('XYZ'))
    return f


def wrist_ik(side, path, weight=None, rot=None, chain=2):
    spec = {'target': path, 'chain': chain}
    if weight is not None:
        spec['weight'] = weight
    if rot is not None:
        spec.update(rot=rot, rot_bone=f'hand_{side}')
    return {f'forearm_{side}': spec}


def fist_a(side, amt=1.0):
    out = {}
    for f in ('index', 'middle', 'ring', 'pinky'):
        out[f'{f}_01_{side}'] = (60 * amt, 0, 0)
        out[f'{f}_02_{side}'] = (80 * amt, 0, 0)
        out[f'{f}_03_{side}'] = (50 * amt, 0, 0)
    out[f'thumb_02_{side}'] = (30 * amt, 0, 0)
    out[f'thumb_03_{side}'] = (30 * amt, 0, 0)
    return out


def bump(t, at, w=0.08):
    return math.exp(-((t - at) / w) ** 2)


def clutch_locket(side='l'):
    """The taken locket held in her fist against her breastbone."""
    return add(arm(side, fwd=42, down=38, elbow=128, twist=-12, wrist=14, fore_twist=35), fist_a(side, 0.95))


def search():
    """SEARCH 'plaster' (brain: 2 s between LOOKs): right hand dragging her nails down the plaster ~0.4 m ahead,
    head hanging against the wall and flopping as the stroke pulls her; the left arm limp. 2 s loop."""
    period = 2.0
    top = (-0.13, -0.47, 1.4)
    bot = (-0.11, -0.45, 1.0)
    back = (-0.2, -0.3, 1.18)

    def wrist(t):
        k = (t % period) / period
        if k < 0.72:
            u = ps.ease_in(k / 0.72) * 0.6 + 0.4 * (k / 0.72)
            return np.asarray(top) + (np.asarray(bot) - np.asarray(top)) * u
        u = (k - 0.72) / 0.28
        a = np.asarray(bot) + (np.asarray(back) - np.asarray(bot)) * ps.ease(min(u * 2, 1.0))
        return a + (np.asarray(top) - a) * ps.ease(max(u * 2 - 1, 0.0))

    def fn(t):
        k = (t % period) / period
        drag = math.sin(math.pi * min(k / 0.72, 1.0))
        p = add(spine(bend=10 + 5 * drag, side=-4 - 3 * drag, twist=-6), both(leg, hip=5, knee=9, ankle=-4),
                {'_hips': (0, -0.02, -0.012)},
                neck(bend=34 + 6 * drag, side=18 + 22 * math.sin(2 * math.pi * k + 0.6), twist=8), {'head': (18, 0, 10 + 8 * drag)})
        p.update(add(arm('r', fwd=95, down=12, elbow=40, wrist=-35, fore_twist=20, shrug=10), claw('r', 0.95)))
        p.update(add(arm('l', down=50, fwd=6, elbow=16, wrist=10), claw('l', 0.7)))
        p['index_03_r'] = (40 + 10 * drag, 0, 0)
        return p
    return Clip('ada_search', period, fn, loop=True, ik=wrist_ik('r', wrist), milestone='M2',
                note='SEARCH plaster: nails dragged down the wall ~0.4 m ahead (stroke 0-1.44 s), head flopping; '
                     'loop (cue nails_plaster)')


def search_bed(geo):
    """Look under a bed, side-on only: she folds down at the hips over bent knees, her right hand on the bed's edge
    (~0.45 m ahead, 0.45 m high), and her head flops over sideways, face side-on low by the bed's side rail; holds
    and searches; rises. 4 s."""
    def fn(t):
        d = ps.ease(t / 1.2) * (1 - ps.ease((t - 3.0) / 1.0))
        p = planted(geo, (0.0, 0.08 * d, -0.15 * d), pitch=42 * d)
        p.update(add(spine(bend=50 * d + 12, side=6 * d - 3, twist=-8 * d),
                     lerp(hang_head(1.0, 14), add(neck(bend=36, side=58, twist=20), {'head': (14, 16, 30)}), ps.ease((t - 0.7) / 0.7) * (1 - ps.ease((t - 2.9) / 0.6)))))
        srch = wobble(t, 17, 0.4, 6.0) * d
        p['head'] = tuple(a + b for a, b in zip(p['head'], (0, srch, 0)))
        p.update(add(arm('l', fwd=20 + 30 * d, down=40, elbow=20), claw('l', 0.7)))
        p.update(lerp(add(arm('r', down=50, fwd=4, elbow=14), claw('r', 0.65)),
                      add(arm('r', fwd=60, down=20, elbow=10, wrist=-60, fore_twist=10), fingers('r', curl=5, spread=10, thumb=5)), d))
        p.update(gait.gown_follow(p, amount=0.8))
        return p
    hand = wpath([(0.0, REST_WRIST['r']), (0.7, (-0.26, -0.3, 0.62)), (1.2, (-0.24, -0.46, 0.48)), (3.0, (-0.24, -0.46, 0.48)),
                  (3.6, (-0.3, -0.25, 0.6)), (4.0, REST_WRIST['r'])])
    w = lambda t: ps.ease((t - 0.2) / 0.6) * (1 - ps.ease((t - 3.2) / 0.6))
    return Clip('ada_search_bed', 4.0, fn, ik=wrist_ik('r', hand, weight=w), milestone='M2',
                note='under-bed look, side-on only: folds down, right hand on the bed edge (0.45 m ahead/high) 1.2-3.0 s, '
                     'head flopped sideways and searching, rises by 4 s')


def door_push():
    """Slow door push: right palm flat on the door (~0.4 m ahead), leaning her weight into it. 1.2 s (brain openS);
    clamp the last frame while the door swings."""
    hand = wpath([(0.0, REST_WRIST['r']), (0.45, (-0.13, -0.33, 1.2)), (0.55, (-0.13, -0.34, 1.2)), (1.2, (-0.12, -0.46, 1.2))])
    Rp = hframe((-0.1, -0.15, 0.98), (0.0, -1.0, 0.0))     # fingers up, palm to the door (-Y)

    def fn(t):
        push = ps.ease((t - 0.5) / 0.7)
        p = add(base_stand(t), spine(bend=6 * push, side=-2), {'_hips': (0, -0.05 * push, -0.012)})
        lift = ps.ease(t / 0.45)
        p.update(lerp(add(arm('r', down=50, fwd=4, elbow=14), claw('r', 0.65)),
                      add(arm('r', fwd=80, down=15, elbow=40, wrist=-55), fingers('r', curl=4, spread=10, thumb=6)), lift))
        return p
    w = lambda t: ps.ease(t / 0.35)
    return Clip('ada_door_push', 1.2, fn, ik=wrist_ik('r', hand, weight=w), milestone='M2',
                note='slow door push: palm flat on the door by 0.5 s, pushes 12 cm by 1.2 s (clamp while the door opens)')


def dress(geo):
    """C4 dress visit, 'hem' phase (brain hemS 3.5 s): she bends to the cut hem of the dress (~0.4 m ahead), lifts it
    in her right hand, and makes the long wet near-sob (shoulders heave at 1.7 / 2.25 / 2.8 s, jaw opens: drive the
    gurgle morph); the head stirs up at the end (the full lift is the following ada_look at the slats)."""
    hand = wpath([(0.0, REST_WRIST['r']), (0.9, (-0.08, -0.42, 0.5)), (1.1, (-0.08, -0.43, 0.48)), (1.7, (-0.05, -0.3, 0.92)),
                  (3.5, (-0.05, -0.27, 0.98))])

    def fn(t):
        d = ps.ease(t / 0.9) * (1 - 0.8 * ps.ease((t - 1.1) / 0.6))
        sob = sum(bump(t, a, 0.14) for a in (1.7, 2.25, 2.8))
        p = planted(geo, (0.0, 0.03 * d, -0.1 * d), pitch=22 * d)
        p.update(add(spine(bend=14 + 36 * d + 7 * sob, side=-3), hang_head(1.0, 12),
                     {'clavicle_l': (8 * sob, 0, 0), 'clavicle_r': (8 * sob, 0, 0), 'jaw': (14 * sob, 0, 0)}))
        stir = ps.ease((t - 3.0) / 0.5)
        p = add(p, neck(bend=-14 * stir, side=-6 * stir, twist=-10 * stir))
        p.update(lerp(arm('r', down=50, fwd=4, elbow=14), arm('r', fwd=60, down=20, elbow=35, wrist=-10), ps.ease(t / 0.6)))
        p.update(lerp(claw('r', 0.5), fingers('r', curl=70, thumb=45), ps.ease((t - 0.85) / 0.25)))
        # the left hand creeps up to her throat, to the gash (1.8-3.0 s)
        up = ps.ease((t - 1.6) / 1.2)
        p.update(lerp(add(arm('l', down=50, fwd=4, elbow=14), claw('l', 0.65)),
                      add(arm('l', fwd=48, down=26, elbow=132, twist=-18, wrist=8, fore_twist=30), claw('l', 0.9)), up))
        p.update(gait.gown_follow(p, amount=0.8))
        return p
    return Clip('ada_dress', 3.5, fn, ik=wrist_ik('r', hand, weight=lambda t: ps.ease(t / 0.4)), milestone='M2',
                note='C4 hem: bends and takes the cut hem (0.9-1.1 s), lifts it, near-sob heaves 1.7/2.25/2.8 s '
                     '(jaw; gurgle morph), left hand to the throat, head stirs at 3.0-3.5 s')


# ---------------------------------------------------------------------- FINALE (brain: stop 1 s, approach, look 2.5 s,
# take 0.8 s, carry). finale_look = ada_look (right hand under the jaw), so the LEFT hand takes the locket.
TAKE_CONTACT = (0.05, -0.47, 1.4)        # left wrist at the contact (the locket ~0.1 m beyond, in her fingers)
TAKE_CONTACT_T = 0.45


def finale_approach(geo):
    period = 1.5

    def fn(t):
        p = gait.walk_pose(t, geo, speed=0.8, period=period, lift=0.05, lean=5, bob=0.016, sway=0.025,
                           drag=('r', 0.35), arm_swing=3.0, hitch=0.3, stance=0.64)
        p.update(add(spine(bend=6, side=-2), lift_head(0.92)))
        p.update(hand_to_jaw('r', 1.0))
        k = math.sin(2 * math.pi * t / period)
        p.update(add(arm('l', fwd=34 + 4 * k, down=30, elbow=34, wrist=-12, fore_twist=45), fingers('l', curl=14, spread=8, thumb=8)))
        return p
    return Clip('ada_finale_approach', period, fn, loop=True, ik=jaw_ik('r'), milestone='M2',
                note='FINALE stop/approach: slow walk (0.8 m/s) holding her head up in her right hand (IK jaw_hold), '
                     'the left hand half-raised toward the light; loop')


def finale_take():
    hand = wpath([(0.0, (0.42, -0.18, 1.02)), (TAKE_CONTACT_T, TAKE_CONTACT), (0.58, TAKE_CONTACT), (1.0, (0.08, -0.2, 1.16))])

    def fn(t):
        reach = ps.ease(t / TAKE_CONTACT_T) * (1 - ps.ease((t - 0.6) / 0.4))
        p = add(base_stand(t), spine(bend=-4 + 10 * reach, side=-2), {'_hips': (0, -0.05 * reach, -0.012)})
        p.update(lift_head(1.0))
        p.update(hand_to_jaw('r', 1.0))
        close = ps.ease((t - TAKE_CONTACT_T) / 0.15)
        p.update(add(lerp(arm('l', fwd=34, down=30, elbow=34, wrist=-12, fore_twist=45), arm('l', fwd=70, down=15, elbow=30, fore_twist=60, wrist=-10), reach),
                     lerp(fingers('l', curl=6, spread=12, thumb=4), fist_a('l', 0.95), close)))
        return p
    ik = dict(jaw_ik('r'))
    ik.update(wrist_ik('l', hand, weight=lambda t: ps.ease(t / 0.2)))
    return Clip('ada_finale_take', 1.0, fn, ik=ik, milestone='M2',
                note=f'FINALE take: left hand to the locket (contact {TAKE_CONTACT_T} s, frame {int(TAKE_CONTACT_T * 30)}, '
                     f'wrist at {TAKE_CONTACT} in her frame; reparent the locket to socket prop_l there), fist closes, '
                     'drawn to her chest by 1.0 s; head held up by the right hand (brain take 0.8 s: timeScale 1.25)')


def finale_carry(geo):
    base = patrol(geo)

    def fn(t):
        p = base.fn(t)
        p.update(clutch_locket('l'))
        return p
    return Clip('ada_finale_carry', 1.5, fn, loop=True, milestone='M2',
                note='FINALE carry: the patrol stutter-walk (0.9 m/s), head hanging, the locket clutched to her chest '
                     '(left fist, socket prop_l); loop')


KNOCKS = (3.0, 4.4, 5.8)


def finale():
    """C5 at the parlor door (cued at C5 t=0, door ~0.42 m ahead): waits with the locket clutched to her chest,
    three slow knocks with her right knuckles (3.0 / 4.4 / 5.8 s), lowers the hand; the door cracks (6.4-7.0 s) and
    her hand goes into the gap at 8.6 s, fingers hooking the door's edge; C5 switches to ada_patrol at 10.0 s."""
    keys = [(0.0, REST_WRIST['r']), (2.4, (-0.1, -0.24, 1.3))]
    for k in KNOCKS:
        keys += [(k - 0.3, (-0.1, -0.24, 1.3)), (k, (-0.1, -0.33, 1.3)), (k + 0.28, (-0.1, -0.25, 1.3))]
    keys += [(6.6, (-0.14, -0.2, 1.12)), (8.25, (-0.14, -0.22, 1.14)), (8.6, (-0.17, -0.56, 1.36)), (10.0, (-0.17, -0.6, 1.36))]
    hand = wpath(keys)

    def fn(t):
        up = ps.ease((t - 1.6) / 0.8)
        thrust = ps.ease((t - 8.3) / 0.3)
        knock = sum(bump(t, k, 0.06) for k in KNOCKS)
        p = add(base_stand(t), spine(bend=4 * up + 10 * thrust - 3 * knock, side=-3), {'_hips': (0, -0.1 * thrust, -0.012)})
        p = add(p, neck(bend=-8 * up + 4 * knock, side=6 * thrust))
        p.update(clutch_locket('l'))
        grab = ps.ease((t - 8.62) / 0.25)
        fing = lerp(fist_a('r', 0.9 * up), fingers('r', curl=6, spread=14, thumb=0), ps.ease((t - 8.25) / 0.25))
        p.update(lerp(arm('r', down=50, fwd=4, elbow=14), arm('r', fwd=80, down=12, elbow=60, wrist=-5, fore_twist=10), up))
        p.update(lerp(fing, fingers('r', curl=62, thumb=30), grab))
        return p
    return Clip('ada_finale', 10.0, fn, ik=wrist_ik('r', hand, weight=lambda t: ps.ease((t - 0.8) / 1.0)), milestone='M2',
                note='C5 door: three slow knocks 3.0/4.4/5.8 s (knuckle contact), hand into the door gap at 8.6 s '
                     '(fingers hook the edge 8.6-8.9 s); the locket clutched in the left fist throughout')


def finale_shadow():
    """Pre-rendered silhouette (C5 flashes): facing Harlan (~0.5 m ahead), she pulls the sack from his head
    (grab 0.5 s, yank 0.5-0.9 s, dropped at 2.0 s), then takes his cleaver (grip 2.8 s) and lifts it overhead
    (raised 3.8 s, held)."""
    r = wpath([(0.0, REST_WRIST['r']), (0.5, (-0.1, -0.33, 1.6)), (0.55, (-0.1, -0.33, 1.6)), (0.9, (-0.26, -0.02, 1.02)),
               (2.1, (-0.28, 0.0, 1.0)), (2.7, (-0.2, -0.42, 1.08)), (2.9, (-0.2, -0.42, 1.08))])
    lft = wpath([(0.0, REST_WRIST['l']), (0.5, (0.1, -0.33, 1.6)), (0.55, (0.1, -0.33, 1.6)), (0.9, (0.2, -0.12, 1.1)),
                 (1.6, (0.4, -0.02, 0.98))])

    def fn(t):
        up = ps.ease(t / 0.5) * (1 - ps.ease((t - 0.55) / 0.35))
        yank = ps.ease((t - 0.5) / 0.4) * (1 - ps.ease((t - 1.6) / 0.8))
        lift = ps.ease((t - 2.9) / 0.9)
        p = add(base_stand(t), spine(bend=-10 * up + 16 * yank - 8 * lift, side=-2, twist=-10 * yank),
                {'_hips': (0, 0.04 * yank, 0.02 * up)}, both(leg, ankle=10 * up))
        p.update(lift_head(0.75 + 0.25 * up))
        grip = ps.ease((t - 0.45) / 0.1) * (1 - ps.ease((t - 2.0) / 0.1))
        p.update(add(arm('r', down=40, fwd=20, elbow=30, wrist=-10), fist_a('r', max(grip, ps.ease((t - 2.8) / 0.12)))))
        p.update(add(arm('l', down=40, fwd=20, elbow=30, wrist=-10), fist_a('l', ps.ease((t - 0.45) / 0.1) * (1 - ps.ease((t - 0.95) / 0.15)))))
        raised = add(arm('r', fwd=158, down=-6, elbow=62, wrist=-30, twist=-14, fore_twist=-20, shrug=18), fist_a('r', 1.0))
        p.update(lerp({k: p[k] for k in raised}, raised, lift))
        return p
    ik = wrist_ik('r', r, weight=lambda t: ps.ease(t / 0.3) * (1 - ps.ease((t - 2.9) / 0.5)))
    ik.update(wrist_ik('l', lft, weight=lambda t: ps.ease(t / 0.3) * (1 - ps.ease((t - 1.2) / 0.6))))
    return Clip('ada_finale_shadow', 4.5, fn, ik=ik, milestone='M2',
                note='silhouette: pulls the sack from his head (grab 0.5, yank 0.5-0.9, drops it 2.0 s), takes his '
                     'cleaver (grip 2.8 s, socket prop_r) and lifts it overhead (3.8 s, held)')


STING_SEAT = (0.0, 0.07, -0.36)          # hips offset in the rocker (seat 0.42 m, as harlan_seated)


def sting(geo):
    """C7 in his rocker (held on frame 0 while the rocking stops, then played from C7 23.4 s): the right hand on the
    knot of the heavy sack in her lap; the left hand lifts her own head (crack 1.0 s); the right raises the sack by
    its knot beside her face (1.4-2.4 s) and turns it (2.4-3.2 s: the hand yaws ~110 deg) so its eyeholes face the
    doorway; both look at you until the cut (~4.6 s)."""
    ank = {s: (geo.ankle[s][0] * 1.3, -0.33, geo.ankle[s][2]) for s in ps.SIDES}
    lap = (-0.08, -0.2, 0.74)
    held = (-0.27, -0.25, 1.12)
    hand = wpath([(0.0, lap), (1.4, lap), (2.4, held), (5.0, (-0.27, -0.25, 1.13))])
    Ra = hframe((0.05, -0.75, -0.66), (0.0, 0.3, -1.0))           # fist over the knot, palm down
    Rb = hframe((-0.25, -0.55, 0.8), (0.1, -0.6, -0.8))           # knot held up, sack hanging below
    Rc = Matrix.Rotation(math.radians(-110), 3, 'Z') @ Rb
    rot = rkeys([(0.0, Ra), (1.4, Ra), (2.4, Rb), (3.2, Rc), (5.0, Rc)])

    def fn(t):
        rock = 4 * math.sin(t * 6.0) * math.exp(-t * 3.0)
        up = ps.ease((t - 0.55) / 0.55)
        p = planted(geo, STING_SEAT, pitch=-8 + rock * 0.4, ankles=ank)
        p.update(add(spine(bend=20 - 12 * up + rock, side=2), {'jaw': (0, 0, 0)}))
        p.update(lift_head(up))
        crack = 6 * bump(t, 1.0, 0.05)
        p['neck_02'] = tuple(a + b for a, b in zip(p.get('neck_02', (0, 0, 0)), (0, 0, crack)))
        p.update(hand_to_jaw('l', ps.ease((t - 0.3) / 0.35)))
        p.update(add(arm('r', fwd=40, down=30, elbow=70, wrist=10), fist_a('r', 1.0)))
        p.update(gait.gown_follow(p, amount=0.9))
        return p
    ik = dict(jaw_ik('l', lambda t: ps.ease((t - 0.35) / 0.35)))
    ik.update(wrist_ik('r', hand, rot=rot))
    return Clip('ada_sting', 5.0, fn, ik=ik, milestone='M2',
                note='C7 rocker (seat 0.42 m): frame 0 = seated, sack knot in the right fist (socket prop_r); left hand '
                     'lifts her head, crack 1.0 s; sack raised by the knot 1.4-2.4 s and turned to the doorway 2.4-3.2 s')


def m2_clips(geo):
    from . import clips_escape
    return [search(), search_bed(geo), door_push(), dress(geo), finale_approach(geo), finale_take(), finale_carry(geo),
            finale(), finale_shadow(), sting(geo)] + clips_escape.ada_clips(geo)


M2_TODO = []
