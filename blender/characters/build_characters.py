"""Job `characters`: Ada, Harlan and the first-person arms -> .cache/characters/<name>.blend (rig + skinned meshes,
shape keys, materials) + unique baked textures public/assets/<tier>/<name>_*.{webp,png}. The `anims` job opens the
.blend files, authors the clips and exports the GLBs.

  node scripts/assets.mjs --only characters
  (dev) node blender/characters/dev.mjs blender/characters/build_characters.py --only ada --tex 1024 --no-render
Args: --only ada,harlan,arms  --tex <atlas size, default 2048>  --no-render
"""
import json
import time
from pathlib import Path

import bpy
import numpy as np

from lib.scene import CACHE, REPO, job_args, log, reset, result, write_json
from lib import materials as libmat
from characters import review, texbake

ARGS = job_args()
ONLY = (ARGS.get('only') or 'ada,harlan,arms').split(',')
TEX = int(ARGS.get('tex') or 2048)
OUT_BLEND = CACHE / 'characters'
PUBLIC = REPO / 'public' / 'assets'


def tier_dir(tier):
    d = PUBLIC / tier
    d.mkdir(parents=True, exist_ok=True)
    return d


# ------------------------------------------------------------------------------------------------ materials
def material(name, spec_id, tex_base=None, alpha=None, double_sided=False, extras=None):
    """Principled material named `name` (spec avg values as factors), textures wired for review renders.
    Extras (-> three material.userData): material_id, albedo/normal texture base names, alpha mode."""
    spec = libmat.load_spec().get(spec_id, libmat.FALLBACK)
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*spec['avgAlbedo'], 1)
    b.inputs['Roughness'].default_value = spec.get('roughness', 0.6)
    b.inputs['Metallic'].default_value = spec.get('metalness', 0.0)
    m['material_id'] = spec_id
    if tex_base:
        m['albedo_tex'] = f'{tex_base}_albedo'
        m['normal_tex'] = f'{tex_base}_normal'
        m['albedo_alpha'] = 'alpha' if alpha else 'roughness'
    if alpha:
        m['alpha_mode'] = alpha
    for k, v in (extras or {}).items():
        m[k] = v
    m.use_backface_culling = not double_sided
    return m


def wire_review_textures(m, albedo_path, normal_path, alpha_is_alpha=False):
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    ia = bpy.data.images.load(str(albedo_path), check_existing=True)
    ia.colorspace_settings.name = 'sRGB'
    ia.alpha_mode = 'CHANNEL_PACKED'
    ta = nt.nodes.new('ShaderNodeTexImage')
    ta.image = ia
    nt.links.new(ta.outputs['Color'], b.inputs['Base Color'])
    if alpha_is_alpha:
        nt.links.new(ta.outputs['Alpha'], b.inputs['Alpha'])
    else:
        nt.links.new(ta.outputs['Alpha'], b.inputs['Roughness'])
    inn = bpy.data.images.load(str(normal_path), check_existing=True)
    inn.colorspace_settings.name = 'Non-Color'
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = inn
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nm.uv_map = 'UVMap'
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])


def assign(ob, m):
    ob.data.materials.clear()
    ob.data.materials.append(m)


# ------------------------------------------------------------------------------------------------ texture assembly
def bake_atlas(char, objs, importance, shaders, size, normal_strength=1.0, tiers=None, distance=0.002):
    """objs: list of objects; shaders: {obj.name: fn(P, N, AO) -> (albedo, rough, height)}."""
    t0 = time.time()
    texbake.atlas_uv(objs, importance)
    geo = texbake.bake_geometry(objs, size)
    layers = []
    for ob in objs:
        g = geo[ob.name]
        a, r, h = shaders[ob.name](g['P'], g['N'], g['AO'], g)
        layers.append((g['idx'], a, r, h))
    alb, rough, height, cov = texbake.compose(size, layers)
    alb = texbake.dilate(alb, cov, 8)
    rough = texbake.dilate(rough, cov, 8)
    height = texbake.dilate(height, cov, 8)
    nrm = texbake.bake_normal(objs, height * normal_strength, size, distance=distance)
    nrm = np.where(cov[..., None], nrm, np.array([0.5, 0.5, 1.0]))
    nrm = texbake.dilate(nrm, cov, 8)
    rgba = np.concatenate([texbake.linear_to_srgb(alb), rough[..., None]], -1)
    tilt = np.linalg.norm(nrm[..., :2] * 2 - 1, axis=-1)[cov]
    log(f'{char}: normal map mean tilt {tilt.mean():.3f}, >0.1 on {(tilt > 0.1).mean() * 100:.1f} % of covered texels')
    sizes = texbake.save_tiers(char, rgba, nrm, tier_dir, tiers=tiers)
    log(f'{char}: atlas {size}^2 in {time.time() - t0:.1f} s, bytes {sizes}')
    return sizes


def hair_textures(char, size_w=1024, size_h=2048):
    from characters import tex_ada
    alb, alpha, nrm = tex_ada.hair_atlas(size_w, size_h)
    rgba = np.concatenate([texbake.linear_to_srgb(alb), alpha[..., None]], -1)
    sizes = {}
    for tier, f in texbake.TIERS.items():
        a = texbake.downsample(rgba, f)
        n = texbake.downsample(nrm, f)
        sizes[tier] = (texbake.save_png(a, tier_dir(tier) / f'{char}_hair_albedo.webp'),
                       texbake.save_png(n, tier_dir(tier) / f'{char}_hair_normal.png', alpha=False))
    return sizes


# ------------------------------------------------------------------------------------------------ characters
def build_ada():
    from characters import ada, tex_ada
    R = ada.build()
    fn, J = R['fn'], R['J']
    ev = np.empty(len(R['eye'].data.vertices) * 3)
    R['eye'].data.vertices.foreach_get('co', ev)
    eye_c = ev.reshape(-1, 3).mean(0)
    cap = R['cap']
    shaders = {
        'ada_body': lambda P, N, AO, G=None: tex_ada.skin(P, N, AO, J, fn.wound_center, cap=cap),
        'ada_head': lambda P, N, AO, G=None: tex_ada.skin(P, N, AO, J, fn.wound_center, cap=cap, head_side=True),
        'ada_gown': lambda P, N, AO, G=None: tex_ada.gown(P, N, AO, fn.trunk, J, ada.HEM_Z),
        'ada_eye': lambda P, N, AO, G=None: tex_ada.eye(P, N, eye_c),
    }
    objs = [R['body'], R['head'], R['gown'], R['eye']]
    importance = {'ada_body': 2.2, 'ada_head': 2.6, 'ada_gown': 0.8, 'ada_eye': 5.0}
    bake_atlas('ada', objs, importance, shaders, TEX)
    hair_textures('ada')
    mats = {
        'body': material('ada_skin', 'skin_ada', 'ada', extras={'sss': 0.3}),
        'gown': material('ada_gown', 'nightgown_silt', 'ada', double_sided=True),
        'eye': material('ada_eye', 'eye_ada', 'ada', extras={'eye': 1, 'clearcoat': 1.0}),
        'hair': material('ada_hair', 'hair_wet_black', 'ada_hair', alpha='hash', double_sided=True),
    }
    for k, m in mats.items():
        assign(R[k], m)
    assign(R['head'], mats['body'])
    # A3: the clear cornea shell (no texture; the runtime gives it a clear-coat/transmission look, B3)
    mats['cornea'] = material('ada_cornea', 'eye_ada', None,
                              extras={'cornea': 1, 'ior': 1.376, 'f0': 0.025, 'roughness': 0.02, 'clearcoat': 1.0})
    assign(R['cornea'], mats['cornea'])
    R.pop('cap', None)
    return R, mats


def finish(char, R, mats):
    """Wire textures for review, record stats, save the .blend."""
    d = tier_dir('max')
    for k, m in mats.items():
        base = m.get('albedo_tex', '').replace('_albedo', '')
        if base:
            wire_review_textures(m, d / f'{base}_albedo.webp', d / f'{base}_normal.png', alpha_is_alpha=m.get('alpha_mode') is not None)
    stats = {'bones': len(R['rig'].data.bones), 'deform_bones': sum(1 for b in R['rig'].data.bones if b.use_deform)}
    tris = 0
    import bmesh
    for k, ob in R.items():
        if isinstance(ob, bpy.types.Object) and ob.type == 'MESH' and not ob.data.shape_keys:
            # glTF tangents need tris/quads: triangulate any n-gons left by deletes/dissolves
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            ng = [f for f in bm.faces if len(f.verts) > 4]
            if ng:
                bmesh.ops.triangulate(bm, faces=ng)
                bm.to_mesh(ob.data)
            bm.free()
    for k, ob in R.items():
        if isinstance(ob, bpy.types.Object) and ob.type == 'MESH':
            t = sum(len(p.vertices) - 2 for p in ob.data.polygons)
            stats[f'tris_{ob.name}'] = t
            tris += t
            ob['character'] = char
    stats['tris_total'] = tris
    R['rig']['character'] = char
    OUT_BLEND.mkdir(parents=True, exist_ok=True)
    for k in [k for k in R if not isinstance(R[k], bpy.types.Object)]:
        R.pop(k)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND / f'{char}.blend'), compress=True)
    write_json(OUT_BLEND / f'{char}.json', stats)
    log(f'{char}: {json.dumps(stats)}')
    return stats


def review_render(char, R, height):
    review.cycles((480, 720), samples=64)
    review.floor()
    review.studio_lights(0.6)
    views = review.turnaround(height * 0.55, 3.0 * height / 1.62, height=height * 0.62, lens=50, n=4, start=-20)
    review.sheet(views, review.OUT / f'{char}_turn.png', label=char)
    if char == 'harlan':
        hz = 1.77
        review.cycles((520, 520), samples=64)
        review.sheet([('sack', (0.08, -0.6, hz), (0, 0, hz - 0.03), 60), ('sack 3q', (0.4, -0.45, hz + 0.05), (0, 0, hz - 0.05), 60),
                      ('apron', (0.5, -1.4, 1.2), (0, -0.1, 1.0), 45), ('glove', (0.9, -0.5, 1.05), (0.62, -0.03, 0.95), 55)],
                     review.OUT / f'{char}_detail.png')
    if char == 'ada':
        hz = 1.5
        review.cycles((520, 520), samples=64)
        review.sheet([('face', (0.05, -0.55, hz), (0, 0, hz - 0.02), 70), ('3q', (0.35, -0.42, hz + 0.02), (0, 0, hz - 0.03), 70),
                      ('hand', (0.75, -0.35, 0.95), (0.5, -0.03, 0.9), 60), ('feet', (0.35, -0.7, 0.3), (0.05, -0.05, 0.1), 50)],
                     review.OUT / f'{char}_detail.png')


def review_arms():
    import math
    from mathutils import Vector
    review.cycles((640, 400), samples=64)
    sc = bpy.context.scene
    ld = bpy.data.lights.new('__fill', 'AREA')
    ld.energy = 60
    ld.size = 2
    lo = bpy.data.objects.new('__fill', ld)
    sc.collection.objects.link(lo)
    lo.location = (0.6, 0.3, 0.8)
    lo.rotation_mode = 'QUATERNION'
    lo.rotation_quaternion = (Vector((0, 0.4, -0.3)) - lo.location).to_track_quat('-Z', 'Y')
    sp = bpy.data.lights.new('__beam', 'SPOT')
    sp.energy = 40
    sp.spot_size = math.radians(40)
    so = bpy.data.objects.new('__beam', sp)
    sc.collection.objects.link(so)
    so.location = (-0.13, 0.7, -0.24)
    so.rotation_mode = 'QUATERNION'
    so.rotation_quaternion = Vector((0.04, 1.0, -0.05)).to_track_quat('-Z', 'Y')
    kd = bpy.data.lights.new('__key', 'POINT')
    kd.energy = 8
    ko = bpy.data.objects.new('__key', kd)
    sc.collection.objects.link(ko)
    ko.location = (0.3, 0.1, 0.1)
    # a wall 2 m ahead catches the beam
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 2.2, 0), rotation=(math.radians(90), 0, 0))
    review.sheet([('fp', (0, 0, 0), (0, 1, -0.12), 22), ('fp wide', (0, -0.02, 0.02), (0, 1, -0.2), 16),
                  ('outside', (0.9, 0.7, 0.2), (-0.05, 0.35, -0.25), 35), ('below', (-0.5, 0.3, -0.7), (-0.1, 0.4, -0.25), 35)],
                 review.OUT / 'arms_view.png')


def main():
    t0 = time.time()
    out = {}
    for char in ONLY:
        reset()
        if char == 'ada':
            R, mats = build_ada()
            h = 1.62
        elif char == 'harlan':
            from characters import harlan
            R, mats = harlan.build_all(material, bake_atlas)
            h = 1.88
        elif char == 'arms':
            from characters import arms
            R, mats = arms.build_all(material, bake_atlas)
            h = None
        else:
            raise SystemExit(f'unknown character {char}')
        stats = finish(char, R, mats)
        if not ARGS.get('no_render') and h:
            review_render(char, R, h)
        if not ARGS.get('no_render') and char == 'arms':
            review_arms()
        out[char] = stats
    result({'characters': out, 'seconds': round(time.time() - t0, 1)}, OUT_BLEND / 'result.json')


main()
