"""Bake materials from src/shared/material-spec.json (schema: src/shared/material-types.ts).

Cycles only needs the bounce colour: avgAlbedo (linear), roughness, metalness. The runtime generates the real
textures from the same spec, so bounce light matches. When the spec file (or an id) is missing we fall back to a
neutral grey and say so — the bake still runs.
"""
import json

import bpy

from .scene import SHARED, log

SPEC_PATH = SHARED / 'material-spec.json'
FALLBACK = {'avgAlbedo': [0.4, 0.4, 0.4], 'roughness': 0.8, 'metalness': 0.0, 'family': 'fallback'}
_spec = None


def load_spec(path=SPEC_PATH):
    global _spec
    if _spec is None:
        _spec = {}
        try:
            data = json.loads(path.read_text())
            for m in data.get('materials', []):
                _spec[m['id']] = m
            log(f'material-spec: {len(_spec)} materials from {path.name}')
        except FileNotFoundError:
            log(f'material-spec: {path} missing, using grey fallback for every material')
    return _spec


def principled(mat):
    return next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')


def make(name, albedo, roughness=0.8, metalness=0.0, specular_level=0.5, emission=None):
    """Plain Principled material (5.2: node tree is pre-filled; Material.use_nodes is deprecated, not touched)."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    b = principled(mat)
    b.inputs['Base Color'].default_value = (*albedo[:3], 1.0)
    b.inputs['Roughness'].default_value = roughness
    b.inputs['Metallic'].default_value = metalness
    b.inputs['Specular IOR Level'].default_value = specular_level
    if emission:
        b.inputs['Emission Color'].default_value = (*emission[0][:3], 1.0)
        b.inputs['Emission Strength'].default_value = emission[1]
    mat.diffuse_color = (*albedo[:3], 1.0)
    return mat


def from_spec(material_id):
    """Material named after the spec id, carrying `material_id` as a custom prop (exported as glTF extras)."""
    spec = load_spec().get(material_id)
    if spec is None:
        if load_spec():
            log(f'material-spec: unknown id {material_id!r}, grey fallback')
        spec = FALLBACK
    mat = make(material_id, spec['avgAlbedo'], spec.get('roughness', 0.8), spec.get('metalness', 0.0))
    mat['material_id'] = material_id
    return mat


def assign(ob, mat):
    if mat.name not in [m.name for m in ob.data.materials if m]:
        ob.data.materials.append(mat)
    return ob.data.materials.find(mat.name)
