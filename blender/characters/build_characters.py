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
def bake_atlas(char, objs, importance, shaders, size, normal_strength=1.0, tiers=None, distance=1.0, planar=None, normal_tiers=None):
    """Fix round 2: distance 1.0 — our heights are in METRES and the Bump node multiplies them by `distance`; the old
    0.002 default flattened Ada's and Harlan's normal maps to ~1e-7 m relief (mean tilt 0.003 vs the arms' 0.071).
    objs: list of objects; shaders: {obj.name: fn(P, N, AO) -> (albedo, rough, height)}."""
    t0 = time.time()
    texbake.atlas_uv(objs, importance, planar=planar)
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
    sizes = texbake.save_tiers(char, rgba, nrm, tier_dir, tiers=tiers, normal_tiers=normal_tiers)
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
CAP_DENSITY = 6.0
HEAD_CAP_DENSITY = 1.6      # uv units/m vs the head skin's 1.0 in its own atlas (cap ~1.6x the face's linear density)
HEAD_TIERS = {'max': 1, 'medium': 2, 'low': 8}   # Low 256^2: the Low budget (27 MB) had 0.06 MB left


def build_ada():
    from characters import ada, tex_ada
    R = ada.build()
    fn, J = R['fn'], R['J']
    ev = np.empty(len(R['eye'].data.vertices) * 3)
    R['eye'].data.vertices.foreach_get('co', ev)
    eye_c = ev.reshape(-1, 3).mean(0)
    cap = R['cap']
    shaders = {
        'ada_body': lambda P, N, AO, G=None: tex_ada.skin(P, N, AO, J, fn.wound_center, cap=cap, G=G),
        'ada_head': lambda P, N, AO, G=None: tex_ada.skin(P, N, AO, J, fn.wound_center, cap=cap, head_side=True, G=G),
        'ada_gown': lambda P, N, AO, G=None: tex_ada.gown(P, N, AO, fn.trunk, J, ada.HEM_Z),
        'ada_eye': lambda P, N, AO, G=None: tex_ada.eye(P, N, eye_c),
    }
    # fix round 2 (ruling j): the head has its OWN atlas ada_head_* (2048 Max / 1024 Medium / 256 Low) with the face
    # anatomy of tex_head.py; the main atlas keeps body + gown + eye (the gown gets the freed space: 0.8 -> 1.1)
    from characters import tex_head
    head_shader = shaders.pop('ada_head')

    def head_tex(P, N, AO, G=None):
        base = head_shader(P, N, AO, G)
        on = np.asarray(G['CAP'], bool) if G is not None and 'CAP' in G else None
        return tex_head.head(P, N, AO, fn.face, base, cap_on=on)
    objs = [R['body'], R['gown'], R['eye']]
    importance = {'ada_body': 2.2, 'ada_gown': 1.1, 'ada_eye': 5.0}
    # the cut faces get their own planar islands at ~2.7x the body's texel density (fix round: 120-150 px at Max
    # was a flat disc; ~1.5 texel/screen px on Medium at 1.2 m)
    bake_atlas('ada', objs, importance, shaders, TEX, planar={'ada_body': CAP_DENSITY})
    bake_atlas('ada_head', [R['head']], {'ada_head': 1.0}, {'ada_head': head_tex}, TEX,
               planar={'ada_head': HEAD_CAP_DENSITY}, tiers=HEAD_TIERS)
    for ob in (R['body'], R['head']):              # build-only data: keep it out of the glTF extras
        for k in ('cap_rim2d', 'cap_side', 'cap_fwd'):
            if k in ob:
                del ob[k]
        if '_cap_faces' in ob.data:
            del ob.data['_cap_faces']
        if ob.data.attributes.get('cap') is not None:
            ob.data.attributes.remove(ob.data.attributes['cap'])
    hair_textures('ada')
    mats = {
        'body': material('ada_skin', 'skin_ada', 'ada', extras={'sss': 0.3}),
        'gown': material('ada_gown', 'nightgown_silt', 'ada', double_sided=True),
        'eye': material('ada_eye', 'eye_ada', 'ada', extras={'eye': 1, 'clearcoat': 1.0}),
        'hair': material('ada_hair', 'hair_wet_black', 'ada_hair', alpha='hash', double_sided=True),
    }
    for k, m in mats.items():
        assign(R[k], m)
    # the head's own material: same material_id (skin_ada: the runtime cut tint + sss keys on it), its own textures
    mats['head'] = material('ada_head_skin', 'skin_ada', 'ada_head', extras={'sss': 0.3})
    assign(R['head'], mats['head'])
    # A3: the clear cornea shell (no texture; the runtime gives it a clear-coat/transmission look, B3)
    if 'cornea' in R:   # M-A: no cornea shell any more (ada.py)
        mats['cornea'] = material('ada_cornea', 'eye_ada', None,
                                  extras={'cornea': 1, 'ior': 1.376, 'f0': 0.025, 'roughness': 0.02, 'clearcoat': 1.0})
        assign(R['cornea'], mats['cornea'])
    R.pop('cap', None)
    # task 8: shadow proxies (<= 5k tris in all): body + gown on ada_rig, head + hair on ada_head_rig
    R['shadow'] = shadow_proxy([R['body'], R['gown']], 'ada_shadow', 3600)
    R['head_shadow'] = shadow_proxy([R['head'], R['hair']], 'ada_head_shadow', 1400)
    return R, mats


def shadow_proxy(objs, name, target_tris):
    """Escape fix round 2 (task 8): a <= target-tri skinned copy of `objs` (same armature, same parent) for the lamp
    cube / lightning-stroke shadow layers 8/9 only — the lamp's 6-face cube drew every full figure mesh into every
    face. Material extras {shadow_proxy: 1}: the runtime hides it from the view and (cine) puts it on the caster layers."""
    from characters import garments
    from lib.scene import select
    rig = next(m.object for m in objs[0].modifiers if m.type == 'ARMATURE')
    copies = []
    for o in objs:
        c = o.copy()
        c.data = o.data.copy()
        for col in o.users_collection:
            col.objects.link(c)
        if c.data.shape_keys:
            c.shape_key_clear()
        for m in list(c.modifiers):
            c.modifiers.remove(m)
        c.data.materials.clear()
        copies.append(c)
    select(copies, copies[0])
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    for k in list(ob.keys()):
        del ob[k]
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if tris > target_tris:
        garments.decimate(ob, target_tris / tris * 0.97)
    mod = ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig
    from characters import rig as rigmod
    rigmod.cleanup(ob, rig)
    m = bpy.data.materials.new(name)
    m['shadow_proxy'] = 1
    m['material_id'] = 'shadow_proxy'
    ob.data.materials.append(m)
    log(f'shadow proxy {name}: {tris} -> {sum(len(p.vertices) - 2 for p in ob.data.polygons)} tris')
    return ob


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
            R['shadow'] = shadow_proxy([R[k] for k in ('body', 'shirt', 'trousers', 'boots', 'gloves', 'apron', 'suspenders', 'sack', 'cleaver', 'cleaver_handle')],
                                       'harlan_shadow', 5000)
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
