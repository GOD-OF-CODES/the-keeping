"""Background hedgerow trees round the farm -> public/assets/<tier>/details_treeline.glb (EXT_mesh_gpu_instancing).

The layout places three hero trees in the yard (props `dead_tree`, 80k triangles each, blender/props/trees.py).
A real Midwestern farmstead sits inside old field-edge hedgerows: lines of open-grown bur oak, elm and ash along
the fence lines behind the house, beside the yard and across the road. Without them the house stands on an empty
plane and lightning has nothing to cut out against the sky. These are the same recursive trees (same biology and
bark), grown at 9-17 m with a lighter skeleton (fewer sides per order, twig tail capped by `maxTris`): at 20-60 m
a 3 mm twig is far below a pixel, the branch silhouette is what reads.

Every tree stands OUTSIDE the walkable rooms (EXT2 [-10,-28,70,16], EXT1 [-20,-38,20,-28]): behind the house
(y >= 19), west of the yard (x <= -13), south of the road ditch (y <= -42) and north-east of the wreck row; so
they need no colliders. Probe-lit like every `details_*` node (never in the bakes). Variants are shared meshes
(one draw call per variant and room on WebGPU), each placement a seeded yaw + 0.85-1.15 uniform scale (uniform
keeps the pipe-model radii). Tier policy: Max/Medium every tree ('far' skeleton); Low the nearer half on the 'low' skeleton.
"""
import math
import random

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from house import terrain

# species / form mix of a Midwestern field-edge hedgerow (by variant index): open-grown and hedge-grown bur oak,
# American elm, white ash, one storm-killed snag; and the understory shrubs that fill a real hedgerow's base.
STYLES = ('oak', 'elm', 'hedge', 'ash', 'hedge', 'oak', 'elm', 'snag')
N_VARIANTS = len(STYLES)
N_SHRUBS = 4
SHRUB_H = 3.4                 # hawthorn / sumac / box-elder suckers 2-4 m (scaled 0.65-1.25 per placement)
SHRUB_SPACING = 4.5           # one shrub clump per ~4.5 m of hedgerow, offset off the tree line
# distance skeletons (hero trees: SIDES 18/10/7/4/3/3, SEG 0.42/0.36/0.28/0.2/0.12/0.07 m, every order):
# at 20-60 m one pixel is 3-9 cm (60 deg vertical FOV, 800 px), so a 7-sided trunk is round and a 3-sided twig
# reads exactly like a 12-sided one; longer segments keep the curvature (gravity is scaled per metre in trees.py).
LODS = {
    # the nearest hedgerow (west of the yard, 12-24 m from the drive): twigs kept (max_order 4), thinned to budget
    'mid': dict(sides=(8, 5, 3, 3, 3, 3), seg=(0.6, 0.55, 0.48, 0.36, 0.22, 0.1), max_order=4, drop=3, tris=11000),
    # max_order 3: branchlets are the finest order (twigs are sub-pixel here); drop_order 3: the branchlets are
    # thinned uniformly to the triangle budget, the scaffold and branches always stay whole
    'far': dict(sides=(7, 4, 3, 3, 3, 3), seg=(0.8, 0.75, 0.65, 0.5, 0.24, 0.12), max_order=3, drop=3, tris=6500),
    'low': dict(sides=(5, 3, 3, 3, 3, 3), seg=(1.1, 0.9, 0.7, 0.5, 0.32, 0.12), max_order=3, drop=3, tris=2600),
    # understory: 3-sided stems, short segments (a 3 m shrub has 4 cm stems), branchlets the finest order
    'shrub': dict(sides=(4, 3, 3, 3, 3, 3), seg=(0.4, 0.42, 0.34, 0.22, 0.12, 0.07), max_order=3, drop=2, tris=1900),
}
TIER_LOD = {'max': 'far', 'medium': 'far', 'low': 'low'}
# distance LOD on Medium / Max (metres from the middle of the drive, (2, -12)): the treeline is static, so a fixed
# per-tree skeleton is a free LOD — no popping, no runtime cost.
LOD_MID_M, LOD_LOW_M = 24.0, 40.0


def lod_for(tier, p):
    if tier == 'low':
        return 'low'
    if p.get('shrub'):
        return 'shrub'
    return 'mid' if p['dist'] < LOD_MID_M else ('far' if p['dist'] < LOD_LOW_M else 'low')

# hedgerow lines: (x0, y0, x1, y1, spacing m, jitter m, height range m, room)
ROWS = [
    (-30.0, 21.0, 36.0, 24.0, 5.5, 2.4, (11.0, 17.0), 'EXT2'),     # field edge behind the house
    (-26.0, 30.0, 30.0, 33.0, 7.0, 3.0, (12.0, 17.0), 'EXT2'),     # second, older line further back (depth)
    (-16.0, -24.0, -17.5, 17.0, 6.0, 2.0, (9.0, 15.0), 'EXT2'),   # west of the yard, along the old fence
    (-27.0, -20.0, -26.0, 14.0, 7.5, 2.5, (11.0, 16.0), 'EXT2'),  # behind it
    (-34.0, -45.0, 30.0, -47.0, 6.5, 2.6, (10.0, 16.0), 'EXT1'),   # across the road, beyond the ditch
    (36.0, 19.0, 64.0, 22.0, 7.0, 2.5, (10.0, 15.0), 'EXT2'),      # north of the wreck row
]
KEEP_CLEAR = [(-12.5, -37.4, 3.0)]     # the utility pole and its (cut) line


def placements(seed=4711):
    rng = random.Random(seed)
    out = []
    for x0, y0, x1, y1, sp, jit, hr, room in ROWS:
        L = math.hypot(x1 - x0, y1 - y0)
        n = max(2, int(L / sp))
        for i in range(n + 1):
            if rng.random() < 0.12:            # gaps in a hedgerow (dead, felled)
                continue
            t = (i + rng.uniform(-0.3, 0.3)) / n
            x = x0 + (x1 - x0) * t + rng.uniform(-jit, jit)
            y = y0 + (y1 - y0) * t + rng.uniform(-jit, jit) * 0.6
            if any(math.hypot(x - cx, y - cy) < r for cx, cy, r in KEEP_CLEAR):
                continue
            out.append(dict(x=x, y=y, h=rng.uniform(*hr), yaw=rng.uniform(0, math.tau), room=room,
                            variant=rng.randrange(N_VARIANTS), dist=math.hypot(x - 2.0, y + 12.0),
                            tilt=_tilt(rng, 0.07)))
        # the understory: shrub clumps strung along the row, off the tree line by up to 1.6 m either side
        ux, uy = (x1 - x0) / L, (y1 - y0) / L
        for k in range(int(L / SHRUB_SPACING)):
            t = (k + rng.uniform(0.1, 0.9)) / int(L / SHRUB_SPACING)
            off = rng.uniform(-1.6, 1.6)
            x = x0 + (x1 - x0) * t - uy * off
            y = y0 + (y1 - y0) * t + ux * off
            if any(math.hypot(x - cx, y - cy) < r for cx, cy, r in KEEP_CLEAR) or _in_rooms(x, y):
                continue
            out.append(dict(x=x, y=y, h=SHRUB_H * rng.uniform(0.65, 1.25), yaw=rng.uniform(0, math.tau), room=room,
                            variant=N_VARIANTS + rng.randrange(N_SHRUBS), dist=math.hypot(x - 2.0, y + 12.0),
                            tilt=_tilt(rng, 0.12), shrub=True))
    return out


def _tilt(rng, max_rad):
    """Hedgerow trees lean a few degrees out of the row toward the light; shrub stems sprawl more."""
    return (rng.uniform(0, math.tau), rng.uniform(0.0, max_rad))


def _in_rooms(x, y, m=0.5):
    """Inside a walkable exterior room (EXT2 [-10,-28,70,16], EXT1 [-20,-38,20,-28]): no colliders out here."""
    return (-10 - m <= x <= 70 + m and -28 - m <= y <= 16 + m) or (-20 - m <= x <= 20 + m and -38 - m <= y <= -28 + m)


def _grow(lod, collection, params, seed, name):
    from props import registry, trees
    L = LODS[lod]
    keep = (trees.SIDES, trees.SEG, trees.MAX_ORDER, trees.DROP_ORDER)
    trees.SIDES, trees.SEG, trees.MAX_ORDER, trees.DROP_ORDER = L['sides'], L['seg'], L['max_order'], L['drop']
    try:
        parts = registry.parts('dead_tree', dict(params, mat='bark_wet', maxTris=L['tris']), seed)
        ob = parts[0].build(collection, sharp_angle=180.0)
        ob.data.name = name
        me = ob.data
        bpy.data.objects.remove(ob)
        return me
    finally:
        trees.SIDES, trees.SEG, trees.MAX_ORDER, trees.DROP_ORDER = keep


def variants(lod, collection):
    """lod 'mid' / 'far' / 'low': N_VARIANTS tree meshes, 13 m tall (scaled per placement) on that distance
    skeleton (LODS), same seeds in every LOD (same tree, fewer orders); lod 'shrub': N_SHRUBS understory shrubs
    SHRUB_H tall (placement variant index N_VARIANTS + k)."""
    if lod == 'shrub':
        return [None] * N_VARIANTS + [
            _grow('shrub', collection, {'height': SHRUB_H, 'style': 'shrub', 'r0': 0.028}, 9400 + 29 * k,
                  f'treeline_shrub_{k}') for k in range(N_SHRUBS)]
    return [_grow(lod, collection, {'height': 13.0, 'style': st, 'fitHeight': st != 'snag'}, 9100 + 37 * i,
                  f'treeline_{lod}_{i}') for i, st in enumerate(STYLES)]


# ------------------------------------------------------------------------------------------------ the power line
# The layout's P_UTILITY_POLE (-12.5, -37.4, yaw pi: crossarm east-west) is the end of a rural distribution spur that
# came north across the field and crossed the road to the house; that road span is cut (the pole's dangling ends).
# Alone in the fog it read as a white pillar. Here the rest of the line: two more creosoted poles due south at a
# typical rural span of 45 m (REA standard spans 45-75 m), and the four conductors to the layout pole, each a
# catenary with ~2.2 % sag (1.0 m over 45 m at 5 C: aluminium ACSR #2, 8 mm diameter). Probe-lit details, no
# colliders (outside the walkable rooms), not in the bakes.
LINE_SPAN = 45.0
LINE_SAG = 1.0
WIRE_R = 0.004


def _pole_params(P):
    for p in P.L['props']:
        if p['type'] == 'utility_pole':
            return p
    return None


def _insulator_tops(part):
    """Top of each glass pin insulator (local), west to east."""
    gi = part.mats.index('glass_grimy') if 'glass_grimy' in part.mats else -1
    vs = {}
    for f, m in zip(part.faces, part.face_mat):
        if m == gi:
            for i in f:
                v = part.verts[i]
                k = round(v.x, 1)
                if k not in vs or v.z > vs[k].z:
                    vs[k] = v.copy()
    tops = sorted(vs.values(), key=lambda v: v.x)
    # merge vertices of the same insulator (x within 6 cm)
    out = []
    for v in tops:
        if out and abs(v.x - out[-1].x) < 0.06:
            if v.z > out[-1].z:
                out[-1] = v
            continue
        out.append(v)
    return out


def pole_line(P, coll):
    from props import kit, registry
    lp = _pole_params(P)
    if lp is None:
        return [], {}
    x0, y0, z0 = lp['pos']
    yaw0 = lp.get('yaw', 0.0)

    def pole(params, pos, yaw, seed):
        part = registry.parts('utility_pole', dict(params, _pos=list(pos), _yaw=yaw), seed)[0]
        R = Matrix.Translation(pos) @ Matrix.Rotation(yaw, 4, 'Z')
        return part, [R @ v for v in _insulator_tops(part)], R

    params0 = lp.get('params', {})
    seed0 = registry.seed_for(registry.variant_key('utility_pole', params0))
    _, ins0, _ = pole(params0, (x0, y0, z0), yaw0, seed0)
    objs, tris = [], 0
    prev = ins0
    rng = random.Random(4242)
    for k in (1, 2):
        pos = (x0 + rng.uniform(-0.6, 0.6), y0 - LINE_SPAN * k + rng.uniform(-1.5, 1.5), 0.0)
        yaw = yaw0 + rng.uniform(-0.05, 0.05)
        prm = dict(params0, wiresCut=False)
        part, ins, R = pole(prm, pos, yaw, 7300 + k)
        ob = part.build(coll)
        ob.name = f'line_pole_{k}'
        ob.matrix_world = R
        objs.append(ob)
        tris += sum(len(f.vertices) - 2 for f in ob.data.polygons)
        if len(ins) == len(prev):
            wire = kit.Part(f'line_wires_{k}', kit.Rng(90 + k))
            for a, b in zip(prev, ins):
                pts = []
                n = 24
                for i in range(n + 1):
                    t = i / n
                    q = a.lerp(b, t)
                    q.z -= LINE_SAG * 4 * t * (1 - t) * (1.0 + 0.04 * (k - 1))
                    pts.append(q)
                wire.add(kit.tube(pts, WIRE_R, sides=4, caps=False), 'zinc_galvanized')
            wo = wire.build(coll, sharp_angle=180.0)
            objs.append(wo)
            tris += sum(len(f.vertices) - 2 for f in wo.data.polygons)
        else:
            log_ = f'insulator mismatch {len(prev)} vs {len(ins)}'
            print('[treeline]', log_)
        prev = ins
    return objs, {'poles': 2, 'insulators_layout_pole': [[round(c, 2) for c in v] for v in ins0], 'triangles': tris}


def build_export(P, terrain_ob, out_dirs, export_glb):
    coll = bpy.data.collections.new('__treeline')
    bpy.context.scene.collection.children.link(coll)
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(terrain_ob, dg)
    mw = terrain_ob.matrix_world
    x0, y0, x1, y1 = terrain.RECT
    pl = placements()
    for p in pl:
        z = 0.0
        if x0 <= p['x'] <= x1 and y0 <= p['y'] <= y1:
            hit = bvh.ray_cast(Vector((p['x'], p['y'], 5.0)), Vector((0, 0, -1)))
            if hit[0] is not None:
                z = (mw @ hit[0]).z
        p['z'] = z - 0.08                   # root collar settles into the turf
    stats = {}
    by_tris = {}
    for tier, d in out_dirs.items():
        trees_ = [p for p in pl if not p.get('shrub')]
        use = pl if tier != 'low' else sorted(trees_, key=lambda p: p['dist'])[: len(trees_) // 2]
        groups = {}
        for p in use:
            groups.setdefault((lod_for(tier, p), p['variant'], p['room']), []).append(p)
        objs = []
        tri_total = 0
        for (lod, vi, room), ps in sorted(groups.items()):
            if lod not in by_tris:
                by_tris[lod] = variants(lod, coll)
            meshes = by_tris[lod]
            root = bpy.data.objects.new(f'treeline_{lod}{vi}_{room}', None)
            coll.objects.link(root)
            for k, v in {'room': room, 'detail': True, 'kind': 'detail', 'treeline': True,
                         'atlas': 'LM_EXTERIOR', 'instances': len(ps)}.items():
                root[k] = v
            objs.append(root)
            me = meshes[vi]
            mt = sum(len(f.vertices) - 2 for f in me.polygons)
            for j, p in enumerate(ps):
                ob = bpy.data.objects.new(f'tl_{lod}{vi}_{room}_{j}', me)
                coll.objects.link(ob)
                ob.parent = root
                s = p['h'] / (SHRUB_H if p.get('shrub') else 13.0)
                ta, tr = p.get('tilt', (0.0, 0.0))
                tilt = Matrix.Rotation(tr, 4, Vector((math.cos(ta), math.sin(ta), 0.0)))
                ob.matrix_world = (Matrix.Translation((p['x'], p['y'], p['z'])) @ tilt
                                   @ Matrix.Rotation(p['yaw'], 4, 'Z') @ Matrix.Diagonal((s, s, s, 1.0)))
                objs.append(ob)
                tri_total += mt
        if tier != 'low':
            proot = bpy.data.objects.new('treeline_powerline_EXT1', None)
            coll.objects.link(proot)
            for k, v in {'room': 'EXT1', 'detail': True, 'kind': 'detail', 'treeline': True,
                         'atlas': 'LM_EXTERIOR'}.items():
                proot[k] = v
            lobjs, lstats = pole_line(P, coll)
            for o in lobjs:
                mw_ = o.matrix_world.copy()
                o.parent = proot
                o.matrix_world = mw_
                for k, v in {'room': 'EXT1', 'detail': True, 'kind': 'detail', 'atlas': 'LM_EXTERIOR'}.items():
                    o[k] = v
            objs += [proot] + lobjs
            tri_total += lstats.get('triangles', 0)
        size = export_glb(d / 'details_treeline.glb', objs, 'static', export_gpu_instances=True)
        stats[tier] = {'bytes': size, 'trees': len(use), 'nodes': len(groups), 'triangles': tri_total,
                       'powerline': lstats if tier != 'low' else None,
                       'lods': {lod: sum(len(v) for (l2, _, _), v in groups.items() if l2 == lod)
                                for lod in ('mid', 'far', 'low', 'shrub')},
                       'variant_tris': {lod: [sum(len(f.vertices) - 2 for f in m.polygons) for m in ms if m]
                                        for lod, ms in by_tris.items()}}
        for ob in objs:
            bpy.data.objects.remove(ob)
    return stats
