"""S1 — tiny GLB export gate.

Scene: a static lightmapped box (UV layers [UVMap, Lightmap], custom props on object/mesh/material) and a tiny
character (2-bone armature, weighted mesh with shape key 'Open', two layered-API actions 'Idle' and 'Wave', each on
its own NLA track, no active action) plus one STRAY action (fake user, on no track).

Exports (all GLB, export_extras=True, export_animation_mode='ACTIONS'):
  s1_plain.glb        character preset without meshopt (isolates meshopt failures)
  s1_meshopt.glb      character preset with EXT_meshopt_compression  <- the gate file
  s1_single_arm.glb   meshopt + export_anim_single_armature=True (default) -> documents the stray-action sweep
Then inspects the GLB JSON here; blender/tests/check_glb.mjs parses them with three r186 in Node.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bpy  # noqa: E402

from lib import materials, scene, uv2  # noqa: E402
from lib.export import export_glb, inspect_glb  # noqa: E402

OUT = scene.CACHE / 'smoke' / 's1'
OUT.mkdir(parents=True, exist_ok=True)

sc = scene.reset(fps=30)

# ---- static lightmapped box ----
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(2, 0, 0.5))
box = bpy.context.active_object
box.name = 'LM_Box'
box.data.name = 'LM_BoxMesh'
assert box.data.uv_layers[0].name == 'UVMap'
uv2.add_lightmap_uv([box], pad_texels=4, smallest_px=256, method='lightmap')
box['atlas'] = 'smoke_atlas'
box['room'] = 'G1'
box['collide'] = True
box.data['mesh_note'] = 'mesh-level extra'
mat = materials.from_spec('plaster_test')
materials.assign(box, mat)

# ---- tiny character ----
arm = bpy.data.armatures.new('RigData')
rig = scene.link(bpy.data.objects.new('Rig', arm))
scene.select([rig])
bpy.ops.object.mode_set(mode='EDIT')
b1 = arm.edit_bones.new('Root')
b1.head, b1.tail = (0, 0, 0), (0, 0, 1)
b2 = arm.edit_bones.new('Tip')
b2.head, b2.tail = (0, 0, 1), (0, 0, 2)
b2.parent = b1
b2.use_connect = True
bpy.ops.object.mode_set(mode='OBJECT')
rig['character'] = 'smoke'

bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 1))
body = bpy.context.active_object
body.name = 'Body'
body.scale = (0.3, 0.3, 1.0)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
# subdivide so weights have something to blend
scene.select([body])
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.subdivide(number_cuts=4)
bpy.ops.object.mode_set(mode='OBJECT')
vg_root = body.vertex_groups.new(name='Root')
vg_tip = body.vertex_groups.new(name='Tip')
for v in body.data.vertices:
    t = max(0.0, min(1.0, (v.co.z + (1.0 - 0.0)) / 2.0))  # world z 0..2 -> 0..1
    vg_root.add([v.index], 1.0 - t, 'REPLACE')
    vg_tip.add([v.index], t, 'REPLACE')
body.parent = rig
mod = body.modifiers.new('Armature', 'ARMATURE')
mod.object = rig
body.shape_key_add(name='Basis')
sk = body.shape_key_add(name='Open', from_mix=False)
for i, v in enumerate(body.data.vertices):
    if v.co.z > 0.3:  # local z spans -0.5..0.5
        sk.data[i].co.x *= 1.8
sk.value = 0.0  # NOT keyframed: no Key-datablock animation
body['mesh_role'] = 'skin'


def make_clip(name, frames):
    act = bpy.data.actions.new(name)
    slot = act.slots.new(id_type='OBJECT', name='Rig')
    cb = act.layers.new('Layer').strips.new(type='KEYFRAME').channelbag(slot, ensure=True)
    for i in range(4):
        fc = cb.fcurves.new('pose.bones["Tip"].rotation_quaternion', index=i, group_name='Tip')
        for f, q in frames:
            fc.keyframe_points.insert(f, q[i])
    return act, slot


rig.animation_data_create()
rig.pose.bones['Tip'].rotation_mode = 'QUATERNION'
clips = {
    'Idle': make_clip('Idle', [(1, (1, 0, 0, 0)), (31, (0.996, 0.087, 0, 0)), (61, (1, 0, 0, 0))]),
    'Wave': make_clip('Wave', [(1, (1, 0, 0, 0)), (16, (0.924, 0, 0.383, 0)), (31, (1, 0, 0, 0))]),
}
for name, (act, slot) in clips.items():
    tr = rig.animation_data.nla_tracks.new()
    tr.name = name
    st = tr.strips.new(name, 1, act)
    if st.action_slot is None:
        st.action_slot = slot
rig.animation_data.action = None
stray, _ = make_clip('Stray', [(1, (1, 0, 0, 0)), (5, (0.9, 0.1, 0, 0))])
stray.use_fake_user = True

objs = [box, rig, body]
sizes = {}
sizes['s1_plain.glb'] = export_glb(OUT / 's1_plain.glb', objs, 'character', export_meshopt_compression_enable=False)
sizes['s1_meshopt.glb'] = export_glb(OUT / 's1_meshopt.glb', objs, 'character')
sizes['s1_single_arm.glb'] = export_glb(OUT / 's1_single_arm.glb', objs, 'character', export_anim_single_armature=True)

checks = {}
info = {k: inspect_glb(OUT / k) for k in sizes}
for fname, g in info.items():
    box_mesh = next(m for m in g['meshes'] if m['name'] == 'LM_BoxMesh')
    body_mesh = next(m for m in g['meshes'] if m['name'] != 'LM_BoxMesh')
    checks[fname] = {
        'box_TEXCOORD_0_and_1': {'TEXCOORD_0', 'TEXCOORD_1'} <= set(box_mesh['attributes']),
        'body_morph_targets': body_mesh['morph_targets'],
        'body_target_names': body_mesh['target_names'],
        'animations': sorted(g['animations']),
        'extras_node_LM_Box': g['nodes_with_extras'].get('LM_Box'),
        'extras_node_Rig': g['nodes_with_extras'].get('Rig'),
        'extras_mesh': box_mesh['extras'],
        'extras_material': [m['extras'] for m in g['materials']],
        'extensionsUsed': g['extensionsUsed'],
        'extensionsRequired': g['extensionsRequired'],
        'skins': g['skins'],
    }

gate = checks['s1_meshopt.glb']
ok = (gate['box_TEXCOORD_0_and_1'] and gate['body_morph_targets'] == 1 and gate['animations'] == ['Idle', 'Wave']
      and (gate['extras_node_LM_Box'] or {}).get('atlas') == 'smoke_atlas'
      and 'EXT_meshopt_compression' in gate['extensionsUsed']
      and checks['s1_plain.glb']['animations'] == ['Idle', 'Wave'])
res = scene.result({'test': 'S1', 'ok': bool(ok), 'sizes': sizes, 'checks': checks,
                    'blender': bpy.app.version_string}, OUT / 'result.json')
if not ok:
    raise SystemExit('S1 structural checks failed')
