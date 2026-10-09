"""Prop sockets: non-deform bones added to a rig at anim-build time (the `characters` job's .blend stays untouched,
so no re-bake). The runtime parents a prop to a socket with an identity local transform.

Socket frames (Blender, rest): head = the grip point; the bone's +Y/+Z axes are the prop's axes (see each entry).
In the GLB the socket is an ordinary node under its hand; three: `skeleton.getBoneByName(name).add(prop)`.

  arms  prop_r   child of hand_r: centre of the closed right fist (hammer / shears / can handle / document grip);
                 axes = the hand's (+Y toward the knuckles, +Z toward the palm).
  arms  locket   child of hand_r: centre of the OPEN locket pinched by its bail in the right fingertips. In
                 arms_raise_locket / arms_locket_hold its +Y points AWAY from the player (the photo face, toward
                 Ada / along the view), +Z up (hinge), +X to the player's right. Rest-pose position is only
                 meaningful during those clips.
  arms  prop_l   child of hand_l: the road map's left-edge pinch (arms_map, C1). In the map hold its +X runs along
                 the map toward its centre (player's right), +Y away from the player (printed face looks back at
                 the eye), +Z up the sheet. Rest-pose position is only meaningful during arms_map.
  ada   prop_l   child of hand_l: centre of her closed left fist (the locket she takes; +Z toward the palm).
  ada   prop_r   child of hand_r: her closed right fist (the sting sack by its knot, the cleaver in the shadow clip).
"""
import bpy
from mathutils import Matrix, Vector

from lib.scene import log, select


def _frame(y, z):
    y = Vector(y).normalized()
    z = Vector(z)
    z = (z - y * z.dot(y)).normalized()
    x = y.cross(z)
    return Matrix((x, y, z)).transposed()


def palm_point(rig, hand, forward=0.045, palm=0.025):
    """Rest-space point inside the fist: along the hand bone and toward the palm."""
    b = rig.data.bones[hand]
    M = b.matrix_local
    y = Vector(M.col[1][:3])
    z = Vector(M.col[2][:3])
    return Vector(b.head_local) + y * forward + z * palm


def add_socket(rig, name, parent, head, rot3x3, length=0.04):
    """Add (or replace) a non-deform bone `name` under `parent` at rest-space `head` with rest orientation rot3x3."""
    select([rig], rig)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = rig.data.edit_bones
    old = eb.get(name)
    if old is not None:
        eb.remove(old)
    b = eb.new(name)
    y = Vector(rot3x3.col[1])
    z = Vector(rot3x3.col[2])
    b.head = Vector(head)
    b.tail = Vector(head) + y * length
    b.align_roll(z)
    b.parent = eb[parent]
    b.use_connect = False
    b.use_deform = False
    bpy.ops.object.mode_set(mode='OBJECT')
    rig.pose.bones[name].rotation_mode = 'XYZ'
    return name


def add_sockets(char, rig, clips_mod=None):
    made = []
    if char == 'arms':
        R = rig.data.bones['hand_r'].matrix_local.to_3x3()
        made.append(add_socket(rig, 'prop_r', 'hand_r', palm_point(rig, 'hand_r', 0.05, 0.03), R))
        # the locket: its rest placement is derived from the locket-hold pose (hand frame known analytically)
        from anim import clips_arms
        head, rot = clips_arms.locket_socket_rest(rig)
        made.append(add_socket(rig, 'locket', 'hand_r', head, rot, 0.03))
        # the road map (C1 arms_map): left-hand pinch on the map's left edge, rest placement from the map hold
        head, rot = clips_arms.map_socket_rest(rig)
        made.append(add_socket(rig, 'prop_l', 'hand_l', head, rot, 0.03))
    elif char == 'harlan':
        # C2-ESCAPE: prop_l = his left fist (the crown grip on Ada's head node, C2 10.6 on); cleaver_edge = the middle
        # of the cleaver's edge (IK end for the strike: contact within 1 cm of the neck point, A4)
        R = rig.data.bones['hand_l'].matrix_local.to_3x3()
        made.append(add_socket(rig, 'prop_l', 'hand_l', palm_point(rig, 'hand_l', 0.045, 0.025), R))
        clv = bpy.data.objects.get('harlan_cleaver')
        if clv is not None and 'cleaver' in rig.data.bones:
            import numpy as np
            V = np.array([tuple(clv.matrix_world @ v.co) for v in clv.data.vertices])
            cen = V.mean(0)
            _, _, vt = np.linalg.svd(V - cen, full_matrices=False)
            hd_a, bd_a = vt[0], vt[1]                       # blade length, blade width
            grip = np.array(tuple(rig.data.bones['cleaver'].head_local))
            if np.dot(cen - grip, hd_a) < 0:
                hd_a = -hd_a
            if np.dot(cen - grip, bd_a) < 0:                # the edge is the width extreme away from the fist
                bd_a = -bd_a
            pw = (V - cen) @ bd_a
            sel = V[pw > pw.max() - 0.004]
            edge = Vector(tuple(sel.mean(0)))
            hd, bd = Vector(tuple(hd_a)), Vector(tuple(bd_a))
            log(f'cleaver: {len(V)} verts, edge mid {tuple(round(x, 3) for x in edge)} ({len(sel)} edge verts)')
            Rb = _frame(hd, bd)
            made.append(add_socket(rig, 'cleaver_edge', 'cleaver', rig.matrix_world.inverted() @ edge, Rb, 0.004))
    elif char == 'ada':
        for s in ('l', 'r'):
            R = rig.data.bones[f'hand_{s}'].matrix_local.to_3x3()
            made.append(add_socket(rig, f'prop_{s}', f'hand_{s}', palm_point(rig, f'hand_{s}', 0.045, 0.025), R))
    for n in made:
        b = rig.data.bones[n]
        log(f'socket {char}.{b.name} under {b.parent.name} at {tuple(round(x, 3) for x in b.head_local)}')
    return made
