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
            stairs(geo, False), hide_check(), hide_tear(), vigil(), catch()]


M2_TODO = [
    'ada_search (nails on plaster; under-bed head flop, side-on)', 'ada_door_push (slow)',
    'ada_dress (hand to the cut hem, near-sob, head lifts toward the wardrobe)',
    'ada_finale (stop, lift head, look, take the locket by IK and reparent, hand in the door gap, walk in)',
    'ada_finale_shadow (pre-rendered silhouette: pulls the sack, lifts the cleaver)',
    'ada_sting (seated; lifts her own head; turns the sack to camera)',
]
