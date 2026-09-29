"""Blender 5.x layered Action helpers (verified API: docs/research.json blender-experiments, docs/SMOKE.md S1).

  act, cb = new_action('ada_walk', rig)                 # slot OBJECT + layer + keyframe strip + channelbag
  key_bone(cb, 'hips', 'location', frame, (x, y, z))
  key_bone(cb, 'spine_01', 'rotation_euler', frame, (rx, ry, rz))
  push_to_track(rig, act)                              # its own NLA track (one clip per track), no active action

Actions exported with export_animation_mode='ACTIONS' become one glTF animation per single-strip NLA track.
Anything left as a stray action is deleted by prune_actions() (export_anim_single_armature=False anyway).
"""
import bpy


def new_action(name, ob, id_type='OBJECT'):
    old = bpy.data.actions.get(name)
    if old is not None:
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new(name)
    slot = act.slots.new(id_type=id_type, name=ob.name)
    layer = act.layers.new('Layer')
    strip = layer.strips.new(type='KEYFRAME')
    cb = strip.channelbag(slot, ensure=True)
    act['_slot'] = slot.identifier
    return act, cb


def channelbag(act):
    strip = act.layers[0].strips[0]
    return strip.channelbag(act.slots[0], ensure=True)


def _fc(cb, path, index, group):
    fc = cb.fcurves.find(path, index=index)
    if fc is None:
        fc = cb.fcurves.new(path, index=index)
        if group:
            grp = cb.groups.get(group) if hasattr(cb.groups, 'get') else None
            if grp is None:
                grp = next((g for g in cb.groups if g.name == group), None) or cb.groups.new(group)
            fc.group = grp
    return fc


def key_bone(cb, bone, prop, frame, values, interp='BEZIER'):
    path = f'pose.bones["{bone}"].{prop}'
    for i, v in enumerate(values):
        fc = _fc(cb, path, i, bone)
        kp = fc.keyframe_points.insert(frame, float(v), options={'FAST'})
        kp.interpolation = interp
    return True


def key_path(cb, path, frame, values, group=None, interp='BEZIER'):
    for i, v in enumerate(values):
        fc = _fc(cb, path, i, group)
        kp = fc.keyframe_points.insert(frame, float(v), options={'FAST'})
        kp.interpolation = interp


def finalize(cb, cyclic=False, handles='AUTO_CLAMPED'):
    for fc in cb.fcurves:
        for kp in fc.keyframe_points:
            kp.handle_left_type = handles
            kp.handle_right_type = handles
        if cyclic:
            mods = [m for m in fc.modifiers if m.type == 'CYCLES']
            if not mods:
                pass  # glTF samples the curve; loops are authored with identical first/last keys instead
        fc.update()


def frame_range(act):
    cb = channelbag(act)
    lo, hi = 1e9, -1e9
    for fc in cb.fcurves:
        if len(fc.keyframe_points):
            lo = min(lo, fc.keyframe_points[0].co.x)
            hi = max(hi, fc.keyframe_points[-1].co.x)
    return lo, hi


def push_to_track(ob, act, start=None):
    """Put `act` on its own NLA track (named like the action) and clear the active action."""
    ad = ob.animation_data or ob.animation_data_create()
    if ad.action is act:
        ad.action = None
    lo, hi = frame_range(act)
    tr = ad.nla_tracks.new()
    tr.name = act.name
    st = tr.strips.new(act.name, int(lo if start is None else start), act)
    if st.action_slot is None:
        st.action_slot = act.slots[0]
    tr.mute = False
    tr.is_solo = False
    return tr


def assign(ob, act):
    ad = ob.animation_data or ob.animation_data_create()
    ad.action = act
    ad.action_slot = act.slots[0]


def prune_actions(keep):
    keep = set(keep)
    for a in list(bpy.data.actions):
        if a.name not in keep:
            bpy.data.actions.remove(a)
