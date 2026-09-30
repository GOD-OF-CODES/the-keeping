"""Prop generator registry: type id (level-layout.json props[].type) -> generator.

    from props import registry
    objs = registry.build('candle', {'holder': 'saucer', 'height': 0.1}, seed=7)   # -> [bpy objects, roots first]

Generators are pure: build(params, seed) always produces the same geometry, placed at the origin (base centre,
front facing -y). The bake job can import this module to put static props into the lightmap atlases.
"""
import zlib
import json

from . import kit
import importlib

FAMILIES = ['lighting', 'furniture', 'small_items', 'signage', 'cabinets', 'bells_rope', 'exterior', 'architecture',
            'textiles', 'kitchen', 'sedan']
MISSING = []
for _f in FAMILIES:   # registration side effects; a family not written yet must not break the others
    try:
        importlib.import_module(f'{__package__}.{_f}')
    except ModuleNotFoundError as e:
        if e.name != f'{__package__}.{_f}':
            raise
        MISSING.append(_f)

REGISTRY = kit.REGISTRY

# Types whose geometry the house kit (blender/house, lane A 'house' job) builds into the lightmapped shell from the
# same placement. Their generators here stay as fallbacks and appear in the contact sheet, but they are NOT
# exported to props_m*.glb (no double geometry). Doors (doors[]) are the house kit's doors.glb.
HOUSE_BUILT = {
    'porch': 'built by blender/house/exterior.py from this placement (lightmapped with the facade)',
    'foundation_skirt': 'built by blender/house/exterior.py (stone foundation) - generator kept as fallback',
    'door_knocker': 'built by blender/house/doors.py mount_knocker: child node P_KNOCKER of door_D_FRONT in doors.glb',
}

# Types in the layout that intentionally have no mesh (runtime-only effects).
NO_MESH = {
    'fx_drip_emitter': 'runtime particle emitter (src/render/weather/drips.ts); nothing to model',
    'harlan_pose_marker': 'cutscene/AI pose marker for Harlan (pos/yaw/params read from the layout); no mesh',
}


def variant_key(type_id, params):
    ent = REGISTRY.get(type_id)
    keys = ent['instance_keys'] if ent else set()
    geo = {k: v for k, v in sorted((params or {}).items()) if k not in keys}
    return type_id + ':' + json.dumps(geo, sort_keys=True)


def seed_for(key):
    return zlib.crc32(key.encode('utf-8')) & 0x7FFFFFFF


def parts(type_id, params, seed):
    ent = REGISTRY[type_id]
    return ent['fn'](dict(params or {}), kit.Rng(seed))


def build(type_id, params, seed=None, collection=None, pos=(0.0, 0.0, 0.0), yaw=0.0):
    """Build a prop at the origin; returns all created objects (top-level parts first, children after).

    pos/yaw = the placement's layout pos/yaw. Path props (door_rope, bell_wire) subtract them from their absolute
    `path` so they, too, come out origin-relative (as build_props does)."""
    seed = seed_for(variant_key(type_id, params)) if seed is None else seed
    out = []
    for prt in parts(type_id, dict(params or {}, _pos=list(pos), _yaw=float(yaw)), seed):
        ob = prt.build(collection)
        out.append(ob)
        stack = list(ob.children)
        while stack:
            c = stack.pop()
            out.append(c)
            stack.extend(c.children)
    return out
