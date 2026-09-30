"""Clip baking: a Clip samples a pose function every frame (30 fps) into a layered Action (all bones keyed, so
crossfades are always defined), optionally solves IK contacts with Blender constraints and bakes them with
nla.bake(visual_keying=True, clear_constraints=True), then puts the action on its own NLA track.
"""
import math

import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

from lib import actions
from lib.scene import log, select

FPS = 30


class Clip:
    def __init__(self, name, duration, fn, loop=False, ik=None, note='', milestone='M1'):
        self.name, self.duration, self.fn, self.loop = name, duration, fn, loop
        self.ik = ik or {}
        self.note = note
        self.milestone = milestone

    @property
    def frames(self):
        return max(2, int(round(self.duration * FPS)) + 1)


def _hips_local(rig):
    """World offset -> hips local location (rest matrix of the hips bone)."""
    b = rig.data.bones.get('hips')
    if b is None:
        return Matrix.Identity(3)
    R = b.matrix_local.to_3x3().inverted()
    return R


def _write_fcurve(cb, path, index, frames, values, group):
    fc = cb.fcurves.new(path, index=index)
    grp = next((g for g in cb.groups if g.name == group), None) or cb.groups.new(group)
    fc.group = grp
    kp = fc.keyframe_points
    kp.add(len(frames))
    co = np.empty(len(frames) * 2)
    co[0::2] = frames
    co[1::2] = values
    kp.foreach_set('co', co)
    kp.foreach_set('interpolation', [1] * len(frames))     # LINEAR (we sample every frame)
    fc.update()


def key_clip(rig, clip, name=None):
    """Sample the pose function into a new action (frames start at 1)."""
    act, cb = actions.new_action(name or clip.name, rig)
    n = clip.frames
    frames = np.arange(1, n + 1, dtype=float)
    bones = [pb.name for pb in rig.pose.bones]
    rot = {b: np.zeros((n, 3)) for b in bones}
    hips = np.zeros((n, 3))
    Rh = _hips_local(rig)
    for i in range(n):
        t = (i / FPS) if not clip.loop else (i / (n - 1)) * clip.duration
        p = clip.fn(t)
        for b, v in p.items():
            if b == '_hips':
                hips[i] = np.array(Rh @ Vector(v))
            elif b in rot:
                rot[b][i] = np.radians(v)
    if clip.loop:
        for b in bones:
            rot[b][-1] = rot[b][0]
        hips[-1] = hips[0]
    for b in bones:
        for k in range(3):
            _write_fcurve(cb, f'pose.bones["{b}"].rotation_euler', k, frames, rot[b][:, k], b)
    if 'hips' in rig.pose.bones:
        for k in range(3):
            _write_fcurve(cb, 'pose.bones["hips"].location', k, frames, hips[:, k], 'hips')
    return act


def _empty(name, coll):
    e = bpy.data.objects.new(name, None)
    coll.objects.link(e)
    e.empty_display_size = 0.05
    return e


def bake_clip(rig, clip, meshes=()):
    """Key the clip; if it has IK contacts, solve and bake them. Returns the final action (on its own track)."""
    for pb in rig.pose.bones:
        pb.rotation_mode = 'XYZ'
    act = key_clip(rig, clip, clip.name + '__fk')
    sc = bpy.context.scene
    coll = sc.collection
    made = []
    # gravity: every runtime hair chain hangs (the clip keys what verlet would roughly do at rest)
    hang = [pb for pb in rig.pose.bones if pb.name.startswith(('hair_', 'sack_', 'apron_'))]
    if hang:
        down = _empty('__gravity', coll)
        down.location = (0.0, 0.0, -40.0)
        made.append(down)
        for pb in hang:
            c = pb.constraints.new('DAMPED_TRACK')
            c.target = down
            c.track_axis = 'TRACK_Y'
            if pb.name.startswith('hair_'):
                c.influence = 0.85 if pb.name.endswith('_01') else 0.6
            else:
                c.influence = 0.5
    for m in meshes:
        m.hide_viewport = True
    cb = actions.channelbag(act)
    for tip, spec in clip.ik.items():
        if 'bone' in spec:
            c = rig.pose.bones[tip].constraints.new('IK')
            c.name = 'IK'
            c.target = rig
            c.subtarget = spec['bone']
            c.chain_count = spec.get('chain', 2)
            c.use_tail = True
            n = clip.frames
            w = np.array([float(spec.get('weight', lambda t: 1.0)(i / FPS)) for i in range(n)])
            _write_fcurve(cb, f'pose.bones["{tip}"].constraints["IK"].influence', 0, np.arange(1, n + 1, dtype=float), w, tip)
            continue
        tgt = _empty(f'__ik_{tip}', coll)
        made.append(tgt)
        ta, tcb = actions.new_action(f'__ik_{tip}_act', tgt)
        n = clip.frames
        frames = np.arange(1, n + 1, dtype=float)
        vals = np.array([spec['target'](i / FPS) for i in range(n)])
        for k in range(3):
            _write_fcurve(tcb, 'location', k, frames, vals[:, k], 'loc')
        actions.assign(tgt, ta)
        c = rig.pose.bones[tip].constraints.new('IK')
        c.name = 'IK'
        c.target = tgt
        c.chain_count = spec.get('chain', 2)
        c.use_tail = spec.get('use_tail', True)
        c.influence = spec.get('influence', 1.0)
        if 'weight' in spec:
            w = np.array([float(spec['weight'](i / FPS)) for i in range(n)])
            _write_fcurve(cb, f'pose.bones["{tip}"].constraints["IK"].influence', 0, frames, w, tip)
        if 'pole' in spec:
            pole = _empty(f'__pole_{tip}', coll)
            made.append(pole)
            pa, pcb = actions.new_action(f'__pole_{tip}_act', pole)
            pv = np.array([spec['pole'](i / FPS) for i in range(n)])
            for k in range(3):
                _write_fcurve(pcb, 'location', k, frames, pv[:, k], 'loc')
            actions.assign(pole, pa)
            c.pole_target = pole
            c.pole_angle = math.radians(spec.get('pole_angle', -90.0))
        if 'rot' in spec:
            # world-space orientation for the end bone (e.g. a planted foot, a hand gripping a rail)
            rb = spec.get('rot_bone', tip)
            ro = _empty(f'__rot_{rb}', coll)
            made.append(ro)
            ra, rcb = actions.new_action(f'__rot_{rb}_act', ro)
            rv = np.array([spec['rot'](i / FPS) for i in range(n)])
            for k in range(3):
                _write_fcurve(rcb, 'rotation_euler', k, frames, rv[:, k], 'rot')
            actions.assign(ro, ra)
            cr = rig.pose.bones[rb].constraints.new('COPY_ROTATION')
            cr.target = ro
            cr.influence = spec.get('rot_influence', 1.0)
    actions.assign(rig, act)
    select([rig], rig)
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.nla.bake(frame_start=1, frame_end=clip.frames, step=1, only_selected=True, visual_keying=True,
                     clear_constraints=True, use_current_action=False, bake_types={'POSE'},
                     channel_types={'LOCATION', 'ROTATION'})
    bpy.ops.object.mode_set(mode='OBJECT')
    baked = rig.animation_data.action
    baked.name = clip.name
    if 'gown_0_01' in rig.pose.bones:
        gown_collide(rig, baked, clip.frames, loop=clip.loop)
    rig.animation_data.action = None
    for o in made:
        if o.animation_data and o.animation_data.action:
            bpy.data.actions.remove(o.animation_data.action)
        bpy.data.objects.remove(o)
    bpy.data.actions.remove(act)
    for m in meshes:
        m.hide_viewport = False
    for pb in rig.pose.bones:
        for c in list(pb.constraints):
            pb.constraints.remove(c)
        pb.rotation_mode = 'XYZ'
    _to_track(rig, baked)
    return baked


def _to_track(rig, act):
    actions.push_to_track(rig, act)


def clear_pose(rig):
    for pb in rig.pose.bones:
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)


def world_bone_pos(rig, bone, clip, t, tail=False):
    """Evaluate the FK pose at time t and return a bone's world head/tail (used to derive IK targets)."""
    p = clip.fn(t)
    Rh = _hips_local(rig)
    for pb in rig.pose.bones:
        v = p.get(pb.name, (0, 0, 0))
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = [math.radians(x) for x in v]
        pb.location = (0, 0, 0)
    if '_hips' in p:
        rig.pose.bones['hips'].location = Rh @ Vector(p['_hips'])
    bpy.context.view_layer.update()
    pb = rig.pose.bones[bone]
    return np.array(rig.matrix_world @ (pb.tail if tail else pb.head))


# ------------------------------------------------------------------------------------------------ gown collision
# Leg capsules (Ada, slight): radius along the bone from head to tail, plus the gown's own thickness + clearance.
LEG_CAPSULES = (('thigh', 0.072, 0.05), ('calf', 0.05, 0.034))
GOWN_CLEARANCE = 0.014


def _seg_closest(a, b, p):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return a + ab * t, t


def gown_collide(rig, act, frames, loop=False, iters=2):
    """Post-bake collision of the gown chains against the leg capsules (thigh/calf, both legs), every frame.

    The pose table's gown_follow is a heuristic; on the largest chase strides the forward thigh/knee still ran
    through the front panels. For each frame and chain (top to bottom) every bone whose tail lies inside a capsule
    (+ GOWN_CLEARANCE) is swung about its head until the tail sits on the capsule surface, and its keyed rotation is
    rewritten. Loops keep identical first/last frames. Returns (frames corrected, max push in m)."""
    cb = actions.channelbag(act)
    sc = bpy.context.scene
    mw = rig.matrix_world
    chains = sorted({pb.name.rsplit('_', 1)[0] for pb in rig.pose.bones if pb.name.startswith('gown_')})
    legs = [(f'{b}_{s}', r0, r1) for s in ('l', 'r') for b, r0, r1 in LEG_CAPSULES]
    fixed, max_push = 0, 0.0
    last = frames if not loop else frames - 1
    # rest-pose distances: a chain never has to sit further out than it does at rest (the skirt hangs close to the
    # thighs at rest; only NEW penetration is corrected)
    ad = rig.animation_data
    ad.action = None
    saved_nla = ad.use_nla
    ad.use_nla = False
    clear_pose(rig)
    bpy.context.view_layer.update()
    rest = {}
    for ch in chains:
        for i in range(1, 4):
            pb = rig.pose.bones.get(f'{ch}_{i:02d}')
            if pb is None:
                continue
            T = mw @ pb.tail
            for name, r0, r1 in legs:
                q = rig.pose.bones[name]
                c, t = _seg_closest(mw @ q.head, mw @ q.tail, T)
                rest[(pb.name, name)] = (T - c).length
    ad.use_nla = saved_nla
    actions.assign(rig, act)
    rot_cache = {}
    for f in range(1, last + 1):
        sc.frame_set(f)
        caps = []
        for name, r0, r1 in legs:
            pb = rig.pose.bones[name]
            caps.append((name, mw @ pb.head, mw @ pb.tail, r0, r1))
        touched = False
        for ch in chains:
            for i in range(1, 4):
                pb = rig.pose.bones.get(f'{ch}_{i:02d}')
                if pb is None:
                    continue
                for _ in range(iters):
                    H = mw @ pb.head
                    T = mw @ pb.tail
                    push = None
                    for cname, a, b, r0, r1 in caps:
                        c, t = _seg_closest(a, b, T)
                        r = min(r0 + (r1 - r0) * t + GOWN_CLEARANCE, 0.97 * rest.get((pb.name, cname), 1.0))
                        d = (T - c)
                        if d.length < r:
                            n = d.normalized() if d.length > 1e-6 else (T - H).cross(b - a).normalized()
                            T2 = c + n * r
                            if push is None or (T2 - T).length > (push - T).length:
                                push = T2
                    if push is None:
                        break
                    # swing about the head: keep the bone length, point the tail at the pushed position
                    L = (T - H).length
                    newT = H + (push - H).normalized() * L
                    q = (T - H).normalized().rotation_difference((newT - H).normalized())
                    Mw = mw @ pb.matrix
                    R = Matrix.Translation(H) @ q.to_matrix().to_4x4() @ Matrix.Translation(-H)
                    pb.matrix = mw.inverted() @ R @ Mw
                    bpy.context.view_layer.update()
                    max_push = max(max_push, (newT - T).length)
                    touched = True
                rot_cache[(pb.name, f)] = tuple(pb.rotation_euler)
        if touched:
            fixed += 1
        # untouched bones keep their baked keys; touched ones are rewritten below
    for (bone, f), e in rot_cache.items():
        for k in range(3):
            fc = cb.fcurves.find(f'pose.bones["{bone}"].rotation_euler', index=k)
            if fc is None:
                continue
            for kp in fc.keyframe_points:
                if abs(kp.co[0] - f) < 1e-3:
                    kp.co[1] = e[k]
                    kp.handle_left[1] = kp.handle_right[1] = e[k]
                    break
            if loop and f == 1:
                for kp in fc.keyframe_points:
                    if abs(kp.co[0] - frames) < 1e-3:
                        kp.co[1] = e[k]
                        kp.handle_left[1] = kp.handle_right[1] = e[k]
    for fc in cb.fcurves:
        fc.update()
    if fixed:
        log(f'gown_collide {act.name}: {fixed}/{last} frames corrected, max push {max_push * 100:.1f} cm')
    return fixed, max_push
