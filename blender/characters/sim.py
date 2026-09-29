"""Cloth settling by frame stepping (verified headless in Blender 5.2: Cloth modifier simulates on scene.frame_set).

The evaluated result at the last frame is copied into a new mesh (the cloth modifier is never 'applied').
"""
import bpy
import numpy as np

from lib.scene import log


def add_collider(ob, thickness=0.004, friction=5.0):
    m = ob.modifiers.new('Collision', 'COLLISION')
    c = ob.collision
    c.thickness_outer = thickness
    c.thickness_inner = 0.01
    c.cloth_friction = friction
    c.damping = 0.2
    return m


def settle(ob, frames=30, pin_group=None, rest_key=None, mass=0.35, tension=12.0, bending=0.3, shear=4.0,
           air=2.0, quality=6, self_collision=False, distance=0.003, gravity=(0, 0, -9.81), shrink=0.0,
           pressure=None):
    sc = bpy.context.scene
    sc.frame_start = 1
    sc.frame_end = frames
    sc.gravity = gravity
    m = ob.modifiers.new('Cloth', 'CLOTH')
    s = m.settings
    s.quality = quality
    s.mass = mass
    s.tension_stiffness = tension
    s.compression_stiffness = tension
    s.shear_stiffness = shear
    s.bending_stiffness = bending
    s.air_damping = air
    s.shrink_min = shrink
    if pin_group:
        s.vertex_group_mass = pin_group
        s.pin_stiffness = 1.0
    if rest_key:
        s.rest_shape_key = ob.data.shape_keys.key_blocks[rest_key]
    if pressure is not None:
        s.use_pressure = True
        s.uniform_pressure_force = pressure
    cs = m.collision_settings
    cs.use_collision = True
    cs.distance_min = distance
    cs.collision_quality = 3
    cs.use_self_collision = self_collision
    if self_collision:
        cs.self_distance_min = 0.002
    pc = m.point_cache
    pc.frame_start = 1
    pc.frame_end = frames
    for f in range(1, frames + 1):
        sc.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.clear()
    if old.shape_keys:
        ob.shape_key_clear()
    ob.data = me
    me.name = old.name
    bpy.data.meshes.remove(old)
    sc.frame_set(1)
    return ob


def remove_colliders(objs):
    for o in objs:
        for m in list(o.modifiers):
            if m.type == 'COLLISION':
                o.modifiers.remove(m)
