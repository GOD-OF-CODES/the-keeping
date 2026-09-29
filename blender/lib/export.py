"""glTF (GLB) export presets + a dependency-free GLB inspector.

Verified in smoke test S1 (docs/SMOKE.md): UV layers export in order (UVMap -> TEXCOORD_0, Lightmap ->
TEXCOORD_1), custom props -> extras (export_extras=True), one glTF animation per single-strip NLA track with
export_animation_mode='ACTIONS', shape keys -> morph targets with export_apply=False, EXT_meshopt_compression.
"""
import json
import struct
from pathlib import Path

import bpy

from .scene import select

COMMON = dict(
    export_format='GLB',
    export_image_format='NONE',      # textures are generated at runtime / shipped separately
    export_texcoords=True,
    export_normals=True,
    export_tangents=False,
    export_materials='EXPORT',       # material names + extras carry the material-spec id
    export_extras=True,
    export_yup=True,
    export_cameras=False,
    export_lights=False,
    export_meshopt_compression_enable=True,
    export_meshopt_extension='EXT_meshopt_compression',
    export_vertex_color='NONE',
    use_selection=True,
)

PRESETS = {
    # Level geometry: modifiers are applied in Blender first (lib.scene.apply_all_modifiers), no animation.
    'static': dict(COMMON, export_apply=True, export_animations=False, export_skins=False, export_morph=False),
    # Props: like static, may carry a node animation (e.g. door swing) authored as actions.
    'prop': dict(COMMON, export_apply=True, export_animations=True, export_animation_mode='ACTIONS',
                 export_anim_slide_to_zero=True, export_skins=False, export_morph=False, export_anim_single_armature=False),
    # Characters: one armature per file, one clip per NLA track, shape keys kept (export_apply=False).
# export_anim_single_armature=False: otherwise EVERY bone action in bpy.data (strays too) becomes a clip (S1).
# export_anim_slide_to_zero=True: otherwise clips keyed from frame 1 start at t=1/fps in three (S1).
    'character': dict(COMMON, export_apply=False, export_animations=True, export_animation_mode='ACTIONS',
                      export_anim_single_armature=False, export_anim_slide_to_zero=True, export_skins=True, export_influence_nb=4,
                      export_all_influences=False, export_morph=True, export_morph_normal=True,
                      export_morph_tangent=False, export_morph_animation=True, export_force_sampling=True,
                      export_frame_step=1, export_optimize_animation_size=True, export_reset_pose_bones=True,
                      export_rest_position_armature=True, export_def_bones=False, export_leaf_bone=False),
}


def export_glb(path, objs, preset='static', **overrides):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    select(objs)
    kw = dict(PRESETS[preset], **overrides)
    r = bpy.ops.export_scene.gltf(filepath=str(path), **kw)
    if r != {'FINISHED'}:
        raise RuntimeError(f'glTF export failed: {r}')
    return path.stat().st_size


def read_glb_json(path):
    data = Path(path).read_bytes()
    magic, version, length = struct.unpack_from('<4sII', data, 0)
    if magic != b'glTF' or version != 2:
        raise ValueError(f'not a GLB v2: {magic} {version}')
    clen, ctype = struct.unpack_from('<I4s', data, 12)
    if ctype != b'JSON':
        raise ValueError('first chunk is not JSON')
    return json.loads(data[20:20 + clen].decode('utf-8')), length


def inspect_glb(path):
    """Summary used by smoke tests and `npm run assets -- --check`."""
    g, length = read_glb_json(path)
    meshes = []
    for m in g.get('meshes', []):
        prims = m.get('primitives', [])
        attrs = sorted({a for p in prims for a in p.get('attributes', {})})
        meshes.append({'name': m.get('name'), 'attributes': attrs,
                       'morph_targets': max((len(p.get('targets', [])) for p in prims), default=0),
                       'target_names': m.get('extras', {}).get('targetNames', []), 'extras': m.get('extras', {})})
    return {
        'bytes': length,
        'extensionsUsed': g.get('extensionsUsed', []),
        'extensionsRequired': g.get('extensionsRequired', []),
        'meshes': meshes,
        'animations': [a.get('name') for a in g.get('animations', [])],
        'skins': len(g.get('skins', [])),
        'nodes_with_extras': {n.get('name'): n['extras'] for n in g.get('nodes', []) if 'extras' in n},
        'materials': [{'name': mt.get('name'), 'extras': mt.get('extras', {})} for mt in g.get('materials', [])],
    }
