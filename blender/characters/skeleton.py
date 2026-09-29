"""Shared human skeleton (Ada, Harlan) + the first-person arms skeleton.

Blender space: Z up, the character faces -Y, its LEFT side is +X ('_l' bones), metres. Rest pose = A-pose (arms
~42 deg below horizontal, elbows and fingers slightly flexed, palms facing down/in), feet flat, legs slightly apart.

Bone-axis convention (every bone): local +Y runs along the bone, local +Z is the bone's *flexion direction* (where its
tip goes when it flexes), so a POSITIVE rotation about local X is always flexion:
  spine/neck/head -> bend forward (nod down); thigh -> hip flexion (leg forward); calf -> knee bend; foot/toe ->
  dorsiflexion (toes up); upperarm -> arm forward/up; forearm -> elbow bend; hand/fingers -> curl toward the palm;
  clavicle -> shrug up; jaw -> open. Rotations about local Y are twist, about local Z side-bend/abduction; for
  mirrored bones Y and Z rotations have opposite senses on _l and _r (anim/poses.py mirrors them).

55 core bones: root, hips, spine_01..03, neck_01..02, head, jaw, clavicle/upperarm/forearm/hand_{l,r},
thumb/index/middle/ring/pinky_01..03_{l,r}, thigh/calf/foot/toe_{l,r}. Characters append runtime chains
(hair_*, gown_*, sack_*, apron_*) and helpers (eye_r, prop bones) in their own modules.
"""
import math

import bpy
from mathutils import Matrix, Vector

FINGERS = ('thumb', 'index', 'middle', 'ring', 'pinky')


class B:
    """Bone spec. flex: world vector for the bone's +Z (made perpendicular to the bone)."""
    __slots__ = ('name', 'head', 'tail', 'parent', 'connect', 'flex', 'deform')

    def __init__(self, name, head, tail, parent=None, connect=False, flex=(0, -1, 0), deform=True):
        self.name, self.head, self.tail = name, Vector(head), Vector(tail)
        self.parent, self.connect, self.flex, self.deform = parent, connect, Vector(flex), deform


# ----------------------------------------------------------------------------------------------------------------
# Proportions (metres). Heights are standing, barefoot/booted soles at z=0.
ADA = dict(
    name='ada', height=1.62,
    hip_joint=(0.083, 0.005, 0.815), pelvis=(0.0, 0.015, 0.87), spine=[0.955, 1.055, 1.155, 1.325],
    spine_y=[0.02, 0.035, 0.04, 0.045], neck=[1.325, 1.395, 1.455], neck_y=[0.045, 0.03, 0.012],
    head_top=1.62, head_y=0.0, jaw=((0.0, 0.004, 1.51), (0.0, -0.078, 1.445)),
    clav=((0.018, 0.0, 1.318), (0.148, 0.03, 1.325)), shoulder=(0.162, 0.032, 1.295),
    upperarm=0.285, forearm=0.235, hand=0.172, palm_w=0.078, arm_down=42.0, elbow_bend=12.0,
    knee=(0.098, -0.012, 0.44), ankle=(0.1, 0.03, 0.068), ball=(0.112, -0.105, 0.02), toe_tip=(0.116, -0.168, 0.012),
)
HARLAN = dict(
    name='harlan', height=1.88,
    hip_joint=(0.098, 0.0, 0.93), pelvis=(0.0, 0.02, 0.99), spine=[1.085, 1.2, 1.32, 1.53],
    spine_y=[0.03, 0.05, 0.06, 0.07], neck=[1.53, 1.585, 1.635], neck_y=[0.07, 0.05, 0.03],
    head_top=1.87, head_y=0.005, jaw=((0.0, 0.01, 1.70), (0.0, -0.092, 1.623)),
    clav=((0.022, 0.02, 1.515), (0.182, 0.05, 1.52)), shoulder=(0.2, 0.05, 1.49),
    upperarm=0.335, forearm=0.285, hand=0.205, palm_w=0.098, arm_down=42.0, elbow_bend=12.0,
    knee=(0.112, -0.012, 0.51), ankle=(0.115, 0.035, 0.08), ball=(0.128, -0.125, 0.024), toe_tip=(0.132, -0.2, 0.014),
)


def _v(*a):
    return Vector(a)


def hand_frame(side, forearm_dir):
    """(a, n, l): along-hand axis, palm normal (out of the palm), thumb-side lateral, for an A-pose hand."""
    s = 1.0 if side == 'l' else -1.0
    a = forearm_dir.normalized()
    # palm faces down and slightly in toward the body (and a touch back)
    want = _v(-0.35 * s, 0.12, -1.0)
    n = (want - a * want.dot(a)).normalized()
    l = a.cross(n).normalized()
    if l.y > 0:        # the thumb of a palm-down hand points forward (-Y)
        l = -l
    return a, n, l


def hand_bones(side, wrist, a, n, l, L, W, parent, curl=8.0, thumb_curl=0.0):
    """Five 3-joint fingers in the hand frame. L = wrist->middle fingertip, W = palm width at the knuckles."""
    bones = []
    # (finger, knuckle along, lateral (thumb side +), length, splay deg, phalanx ratios, palm drop)
    table = {
        'index': (0.545, 0.36, 0.395, 5.0, (0.46, 0.30, 0.24)),
        'middle': (0.565, 0.12, 0.43, 0.0, (0.45, 0.31, 0.24)),
        'ring': (0.55, -0.12, 0.405, -5.0, (0.45, 0.31, 0.24)),
        'pinky': (0.505, -0.35, 0.32, -11.0, (0.44, 0.31, 0.25)),
    }
    for f, (ka, kl, flen, splay, ratios) in table.items():
        base = wrist + a * (ka * L) + l * (kl * W) + n * (0.0 if f in ('middle', 'ring') else 0.004 * L / 0.17)
        dir0 = (Matrix.Rotation(math.radians(splay), 3, n) @ a).normalized()
        p = base
        d = dir0
        prev = parent
        for i, r in enumerate(ratios):
            # each joint flexes a little toward the palm (+n)
            ang = math.radians(curl * (0.6 if i == 0 else 1.0))
            axis = d.cross(n).normalized()
            d = (Matrix.Rotation(ang, 3, axis) @ d).normalized()      # + about d x n: toward the palm
            if d.dot(n) < 0 and i > 0:
                pass
            q = p + d * (flen * L * r)
            name = f'{f}_{i + 1:02d}_{side}'
            bones.append(B(name, p, q, prev, connect=(i > 0), flex=n))
            prev, p = name, q
    # thumb: CMC near the wrist on the thumb side, angled out and toward the palm
    base = wrist + a * (0.1 * L) + l * (0.24 * W) + n * (0.12 * W)
    d = (a * 0.62 + l * 0.62 + n * 0.46).normalized()
    lens = (0.21, 0.175, 0.145)
    prev = parent
    p = base
    for i, ln in enumerate(lens):
        if i > 0:
            axis = d.cross((n - l).normalized()).normalized()
            d = (Matrix.Rotation(math.radians(10 + thumb_curl), 3, axis) @ d).normalized()
        q = p + d * (ln * L)
        name = f'thumb_{i + 1:02d}_{side}'
        # thumb flexion curls it across the palm toward the pinky side
        bones.append(B(name, p, q, prev, connect=(i > 0), flex=(n * 0.5 - l).normalized()))
        prev, p = name, q
    return bones


def body_bones(P):
    """Core skeleton for a proportions dict (ADA / HARLAN)."""
    bs = []
    add = bs.append
    add(B('root', (0, 0, 0), (0, 0.25, 0), None, flex=(0, 0, 1), deform=False))
    pel = _v(*P['pelvis'])
    sz, sy = P['spine'], P['spine_y']
    add(B('hips', pel, (0, sy[0], sz[0]), 'root'))
    names = ['spine_01', 'spine_02', 'spine_03']
    prev = 'hips'
    for i, nm in enumerate(names):
        add(B(nm, (0, sy[i], sz[i]), (0, sy[i + 1], sz[i + 1]), prev, connect=True))
        prev = nm
    nz, ny = P['neck'], P['neck_y']
    add(B('neck_01', (0, ny[0], nz[0]), (0, ny[1], nz[1]), 'spine_03', connect=True))
    add(B('neck_02', (0, ny[1], nz[1]), (0, ny[2], nz[2]), 'neck_01', connect=True))
    add(B('head', (0, ny[2], nz[2]), (0, P['head_y'], P['head_top']), 'neck_02', connect=True))
    j0, j1 = P['jaw']
    add(B('jaw', j0, j1, 'head', flex=(0, 0.6, -1)))
    for side, s in (('l', 1.0), ('r', -1.0)):
        c0, c1 = _v(*P['clav'][0]), _v(*P['clav'][1])
        c0.x *= s
        c1.x *= s
        add(B(f'clavicle_{side}', c0, c1, 'spine_03', flex=(0, 0, 1)))
        sh = _v(*P['shoulder'])
        sh.x *= s
        down = math.radians(P['arm_down'])
        d_up = Vector((s * math.cos(down), 0.03, -math.sin(down))).normalized()
        el = sh + d_up * P['upperarm']
        add(B(f'upperarm_{side}', sh, el, f'clavicle_{side}', flex=(0, -1, 0)))
        bend = math.radians(P['elbow_bend'])
        axis = d_up.cross(Vector((0, -1, 0))).normalized()
        d_fo = (Matrix.Rotation(bend, 3, axis) @ d_up).normalized()
        wr = el + d_fo * P['forearm']
        add(B(f'forearm_{side}', el, wr, f'upperarm_{side}', connect=True, flex=(0, -1, 0.2)))
        a, n, l = hand_frame(side, d_fo)
        L = P['hand']
        add(B(f'hand_{side}', wr, wr + a * (0.5 * L), f'forearm_{side}', connect=True, flex=n))
        bs.extend(hand_bones(side, wr, a, n, l, L, P['palm_w'], f'hand_{side}'))
        hj = _v(*P['hip_joint'])
        hj.x *= s
        kn = _v(*P['knee'])
        kn.x *= s
        an = _v(*P['ankle'])
        an.x *= s
        ba = _v(*P['ball'])
        ba.x *= s
        tt = _v(*P['toe_tip'])
        tt.x *= s
        add(B(f'thigh_{side}', hj, kn, 'hips', flex=(0, -1, 0)))
        add(B(f'calf_{side}', kn, an, f'thigh_{side}', connect=True, flex=(0, 1, 0)))
        add(B(f'foot_{side}', an, ba, f'calf_{side}', connect=True, flex=(0, 0, 1)))
        add(B(f'toe_{side}', ba, tt, f'foot_{side}', connect=True, flex=(0, 0, 1)))
    return bs


# ----------------------------------------------------------------------------------------------------------------
# First-person arms. Origin = the camera (eye). The camera looks along +Y in Blender (= -Z in three after glTF's
# (x, z, -y) conversion), up is +Z, so the player's LEFT is -X here. Only the forearms and hands are ever on screen.
# Rest = the idle pose: left hand in an overhand grip on the flashlight (thumb toward the lens, beam forward),
# right hand relaxed, low right. Hands are placed by frame, elbows solved with a 2-bone IK.
ARMS = dict(
    name='arms', shoulder=(0.19, -0.08, -0.26), upperarm=0.32, forearm=0.27, hand=0.19, palm_w=0.088,
    flash_center=(-0.135, 0.44, -0.235), flash_dir=(0.04, 1.0, -0.05),
    right_wrist=(0.2, 0.3, -0.36), right_a=(-0.25, 0.9, 0.25), right_n=(-0.75, 0.05, -0.65),
)


def _two_bone(S, W, l1, l2, pole):
    d = W - S
    D = min(d.length, (l1 + l2) * 0.999)
    u = d.normalized()
    a = (l1 * l1 + D * D - l2 * l2) / (2 * D)
    h = math.sqrt(max(l1 * l1 - a * a, 1e-8))
    p = pole - u * pole.dot(u)
    p.normalize()
    return S + u * a + p * h


def hand_frame_arms(a, n):
    a = Vector(a).normalized()
    n = Vector(n)
    n = (n - a * n.dot(a)).normalized()
    return a, n


def arms_bones(P=ARMS):
    bs = [B('root', (0, 0, 0), (0, 0.1, 0), None, flex=(0, 0, 1), deform=False)]
    L = P['hand']
    for side, s in (('l', -1.0), ('r', 1.0)):
        sh = Vector(P['shoulder'])
        sh.x *= s
        if side == 'l':
            F = Vector(P['flash_dir']).normalized()
            a0 = Vector((0.95, -0.05, -0.3))
            a0 = (a0 - F * a0.dot(F)).normalized()
            n = F.cross(a0).normalized()
            if n.z > 0:
                n = -n
            a, n = hand_frame_arms(a0, n)
            palm_c = Vector(P['flash_center']) - n * 0.031
            wr = palm_c - a * (0.3 * L)
            fdir = (a + F * 0.9).normalized()
            curl = 64.0
        else:
            a, n = hand_frame_arms(P['right_a'], P['right_n'])
            wr = Vector(P['right_wrist'])
            fdir = a
            curl = 22.0
        el = wr - fdir * P['forearm']
        # keep the forearm length exact and the upper arm reaching the elbow: re-solve the elbow from the shoulder
        el = _two_bone(sh, wr, P['upperarm'], P['forearm'], Vector((s * 0.6, -0.2, -1.0)))
        bs.append(B(f'upperarm_{side}', sh, el, 'root', flex=(0, 0.5, 1)))
        bs.append(B(f'forearm_{side}', el, wr, f'upperarm_{side}', connect=True, flex=(0, 0, 1)))
        l = a.cross(n).normalized()
        # the thumb of a left palm-down hand points forward; of the right hand, up/forward
        if (side == 'l' and l.y < 0) or (side == 'r' and l.z < 0):
            l = -l
        bs.append(B(f'hand_{side}', wr, wr + a * (0.5 * L), f'forearm_{side}', connect=True, flex=n))
        bs.extend(hand_bones(side, wr, a, n, l, L, P['palm_w'], f'hand_{side}', curl=curl, thumb_curl=25.0 if side == 'l' else 5.0))
    return bs


# ----------------------------------------------------------------------------------------------------------------
def build_armature(name, bones, coll=None):
    """Create the armature object from specs. Returns the object (in OBJECT mode)."""
    arm = bpy.data.armatures.new(name)
    rig = bpy.data.objects.new(name, arm)
    (coll or bpy.context.scene.collection).objects.link(rig)
    arm.display_type = 'STICK'
    vl = bpy.context.view_layer
    for o in vl.objects:
        o.select_set(False)
    rig.select_set(True)
    vl.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.edit_bones
    for b in bones:
        e = eb.new(b.name)
        e.head, e.tail = b.head, b.tail
        d = (b.tail - b.head).normalized()
        z = b.flex - d * b.flex.dot(d)
        if z.length < 1e-6:
            z = Vector((0, 0, 1)) - d * d.z
        e.align_roll(z.normalized())
        e.use_deform = b.deform
    for b in bones:
        if b.parent:
            e = eb[b.name]
            e.parent = eb[b.parent]
            e.use_connect = b.connect and (eb[b.parent].tail - e.head).length < 1e-5
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in rig.pose.bones:
        pb.rotation_mode = 'XYZ'
    return rig


def bone_map(bones):
    return {b.name: b for b in bones}
