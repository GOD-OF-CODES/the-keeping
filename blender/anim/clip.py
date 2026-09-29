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
