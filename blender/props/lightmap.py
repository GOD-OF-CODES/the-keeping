"""Static props in the room lightmaps (docs/PROPS.md "Lightmaps").

Decision: a static prop bakes into the atlas of its ROOM (same `lm_<atlas>.klm`, same runtime lights node, same
lightning flash maps), in a band on top of that atlas that the house packer leaves free (house/lmuv.py PROPS_BAND).
The sedan interior set (room CAR) fills LM_CAR. Lightmapped prop meshes get their own mesh data (UV2 is unique per
placement), a 'Lightmap' UV layer (-> TEXCOORD_1 -> uv1) and node extras `kind: 'level'`, `lightmap: 'lm_<atlas>'`,
`atlas`, `room` - exactly what src/world/level.ts `lmFor` binds, so no runtime change is needed.

Not lightmapped (probe-lit, still occluders in every bake): moving parts (and their children), decals, colliders,
flame/lamp/liquid/reflector nodes, glass-only meshes, and whole types in EXCLUDE_TYPES (the wreck field is a
mist/lightning vista east of x 12; trees are thin branches that would explode into thousands of islands).
"""
import bpy

from lib.scene import log
from house import lmuv

EXCLUDE_TYPES = {'wreck_sedan', 'dead_tree', 'porch', 'foundation_skirt', 'cobweb_curtain', 'bell_wire',
                 'door_rope', 'fx_drip_emitter', 'harlan_pose_marker', 'sedan'}
FORCE_TYPES = {'sedan_interior'}           # layout lighting 'dynamic' (moving wheel/wipers) but the shell is a set
MOVING_KEYS = ('part', 'hinge_axis', 'swing_axis', 'slide_axis', 'slide', 'pull_axis', 'rotate_axis', 'travel_m',
               'pivot_at', 'door_id')
SKIP_KEYS = ('decal', 'collider', 'hide_proxy', 'flame', 'liquid', 'lamp', 'reflector')
MAX_TEXELS_PER_M = {'LM_EXTERIOR': 26.0, 'LM_CAR': 220.0}   # at 1024; interiors default below
DEFAULT_MAX_TPM = 70.0
PAD = 4
SMALLEST = 1024


def atlas_of_room(layout):
    out = {}
    for a in layout.get('atlases', []):
        for r in a['rooms']:
            out[r] = a['id']
    return out


def lm_file(atlas):
    return 'lm_' + atlas.replace('LM_', '').lower()


def _eligible(root):
    out = []
    stack = list(root.children)
    while stack:
        o = stack.pop()
        if any(k in o.keys() for k in MOVING_KEYS) or any(o.get(k) for k in SKIP_KEYS):
            continue
        stack.extend(o.children)
        if o.type != 'MESH' or not o.data.polygons:
            continue
        mids = [m.get('material_id', m.name) if m else '' for m in o.data.materials]
        if mids and all(str(m).startswith('glass') for m in mids):
            continue
        out.append(o)
    return out


def prepare(layout, placed):
    """placed: [(placement dict, [root, ...objects])]. Makes lightmapped meshes single-user, tags them, and returns
    {atlas: [objects]}."""
    room_atlas = atlas_of_room(layout)
    groups = {}
    for pl, objs in placed:
        t = pl['type']
        if t in EXCLUDE_TYPES:
            continue
        if pl.get('lighting') != 'static' and t not in FORCE_TYPES:
            continue
        atlas = room_atlas.get(pl.get('room', ''))
        if not atlas:
            continue
        root = objs[0]
        for o in _eligible(root):
            o.data = o.data.copy()
            sc = o.matrix_world.to_scale()
            if max(abs(sc.x - 1), abs(sc.y - 1), abs(sc.z - 1)) > 1e-4:
                o['lm_weight'] = float(abs(sc.x * sc.y * sc.z) ** (1.0 / 3.0))   # world texel density
            o['kind'] = 'level'
            o['lightmap'] = lm_file(atlas)
            o['atlas'] = atlas
            o['room'] = pl.get('room', '')
            o['lm_prop'] = pl['id']
            groups.setdefault(atlas, []).append(o)
    return groups


def pack(groups):
    stats = {}
    for atlas, objs in sorted(groups.items()):
        region = lmuv.band_region(atlas)
        if region[3] - region[1] <= 0:
            log(f'lightmap: {atlas} has no props band; {len(objs)} objects stay probe-lit')
            for o in objs:
                for k in ('kind', 'lightmap', 'atlas', 'lm_prop'):
                    if k in o.keys():
                        del o[k]
            continue
        cap = MAX_TEXELS_PER_M.get(atlas, DEFAULT_MAX_TPM)
        st = lmuv.pack_atlas(objs, pad_texels=PAD, smallest_px=SMALLEST, region=region, max_texels_per_m=cap)
        st['objects'] = len(objs)
        st['placements'] = sorted({o['lm_prop'] for o in objs})
        st['triangles'] = sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)
        stats[atlas] = st
        for o in objs:
            o.data.uv_layers.active = o.data.uv_layers[0]
            o.data.uv_layers[0].active_render = True
    return stats


def mark_occluder_only(objs):
    for o in objs:
        o['bake_occluder'] = True


def lightmapped(o):
    return o.get('kind') == 'level' and 'Lightmap' in getattr(o.data, 'uv_layers', {})
