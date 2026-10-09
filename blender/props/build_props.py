"""Job `props`: every prop placement in src/shared/level-layout.json -> per-milestone GLB libraries + review renders.

  node scripts/assets.mjs --only props [--force]
  (dev) Blender ... --python blender/lib/cli.py -- blender/props/build_props.py --types candle,stool --no-export

Outputs (docs/PROPS.md):
  public/assets/<tier>/props_m1.glb, props_m2.glb   one root node per placement (named by its layout id, at the
      origin: base centre, front facing -y in PLAN space = +Z in three), children = parts. Placements whose params
      differ only in a generator's instance_keys share mesh data (glTF mesh reuse).
  public/assets/low/props_m*.glb                    Low LOD: big non-lightmapped meshes decimated (LOW_DECIMATE)
  .cache/props/props.json                           per-type/variant triangle counts + budgets (read by check_props)
  .cache/props/props.blend                          the placed instances (at the origin, root extras plan_pos/yaw) with
                                                    their Lightmap UVs: the bake jobs append them (props/lightmap.py)
  .cache/props/lightmap.json                        per-atlas props band packing (islands, texel/m, placements)
  scratch/props/<variant>.png + docs/props-contact.png  review renders (skipped with --no-render)
Args: --types a,b (subset)  --no-render  --no-export  --samples 24
"""
import json
import shutil
import sys
from pathlib import Path

import bpy

from lib.scene import CACHE, REPO, SHARED, job_args, log, reset, result, select, write_json
from lib import export as gexport
from props import kit, registry, wear
from props import lightmap as plm

TIERS = ('low', 'medium', 'max')
# Low keeps the grime decal quads only while the Low download budget allows (ruling (h): drop them first).
LOW_WEAR_DROP = {'dress_dummy'}   # ruling (h) second lever: the dress_dummy mask goes from Low after the grime decals
LOW_GRIME = False   # round E: Low over budget by ~0.24 MB → grime decals dropped from Low first (ruling h)
ARGS = job_args()
# --export-dir <scratch dir>: write GLBs/report there only (never public/assets or .cache/props) — measurement runs
EXPORT_DIR = (REPO / ARGS['export_dir']) if isinstance(ARGS.get('export_dir'), str) else None
wear.ENABLED = not ARGS.get('no_wear')   # props only: the house/corridor jobs import kit.py with wear OFF
if ARGS.get('no_loops'):
    wear.LOOPS = False
# props-only glTF override: the 'wear' colour attribute -> COLOR_0 (docs/PROPS-FINISH.md §5.1); COMMON stays NONE
WEAR_EXPORT = dict(export_vertex_color='NAME', export_vertex_color_name=wear.ATTR, export_all_vertex_colors=False)


def _local_name(ob):
    return ob.get('_local') or ob.name


def build_variant(type_id, params, coll, pos=(0, 0, 0), yaw=0.0):
    key = registry.variant_key(type_id, params)
    seed = registry.seed_for(key)
    wear.CURRENT_TYPE = type_id
    wear.CURRENT_KEY = key
    # path props (bell_wire, door_rope) need the placement to express absolute plan paths relative to their origin
    parts = registry.parts(type_id, dict(params or {}, _pos=list(pos), _yaw=float(yaw)), seed)
    roots = []
    for prt in parts:
        ob = prt.build(coll)
        roots.append(ob)
    objs = []
    stack = list(roots)
    while stack:
        o = stack.pop()
        objs.append(o)
        stack.extend(o.children)
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs if o.type == 'MESH')
    return {'key': key, 'seed': seed, 'roots': roots, 'objs': objs, 'tris': tris}


def instance(pl, var, coll):
    """Root empty named by the placement id + copies of the variant's objects sharing mesh data."""
    pid = pl['id']
    extras = {
        'prop_id': pid, 'prop_type': pl['type'], 'room': pl.get('room', ''), 'milestone': pl.get('milestone', ''),
        'lighting': pl.get('lighting', ''), 'collider': pl.get('collider', ''),
        'plan_pos': list(pl.get('pos', [0, 0, 0])), 'plan_yaw': pl.get('yaw', 0.0),
        'params': json.dumps(pl.get('params') or {}, sort_keys=True), 'variant_seed': var['seed'],
    }
    root = kit.empty(pid, coll, extras)
    params = pl.get('params') or {}
    mapping = {}
    for o in var['objs']:
        c = o.copy()          # shares o.data
        coll.objects.link(c)
        mapping[o] = c
    for o, c in mapping.items():
        local = o['_local']
        c.name = f"{pid}-{local.replace('.', '-')}"   # three's GLTFLoader strips '.', ':', '/', '[', ']'
        del c['_local']
        if o.parent in mapping:
            c.parent = mapping[o.parent]
        else:
            c.parent = root
        c.matrix_parent_inverse.identity()
        c.matrix_basis = o.matrix_basis.copy()
        sunk = params.get('sunkInWeeds')
        if c.parent is root and isinstance(sunk, (int, float)) and sunk:
            c.matrix_basis.translation.z -= float(sunk)   # wrecks settle into the field (per placement)
        tp = c.get('text_param')
        if tp and tp in params and isinstance(params[tp], str):
            c['text'] = params[tp]
    out = [root] + list(mapping.values())
    return out


LOW_DECIMATE = {'min_tris': 1500, 'ratio': 0.45}


def low_lod(objs):
    """Replace the mesh data of big, non-lightmapped instance objects by decimated copies (one per unique mesh).
    Lightmapped meshes keep their exact UV2 charts (decimation would drag island borders into the gutters)."""
    done, before, after = {}, 0, 0
    tmp_coll = bpy.data.collections.new('__lod')
    bpy.context.scene.collection.children.link(tmp_coll)
    for o in objs:
        if o.type != 'MESH' or plm.lightmapped(o) or o.get('decal') or o.get('collider'):
            continue
        me = o.data
        n = sum(len(p.vertices) - 2 for p in me.polygons)
        # per-part overrides (extras low_ratio / low_min_tris): far, glare-lit roadside props (props/roadside.py)
        if n < float(o.get('low_min_tris', LOW_DECIMATE['min_tris'])):
            continue
        if me.name not in done and o.get('lod_twig_from'):
            # trees (props/trees.py): drop the twig/spur tail instead of collapsing thin tubes into spikes
            import bmesh
            bm = bmesh.new()
            bm.from_mesh(me)
            bm.faces.ensure_lookup_table()
            cut = int(o['lod_twig_from'])
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index >= cut], context='FACES')
            new = bpy.data.meshes.new(me.name + '_low')
            bm.to_mesh(new)
            bm.free()
            for m in me.materials:
                new.materials.append(m)
            done[me.name] = new
            before += n
            after += sum(len(p.vertices) - 2 for p in new.polygons)
        if me.name not in done:
            t = bpy.data.objects.new('__lod_' + me.name, me)
            tmp_coll.objects.link(t)
            md = t.modifiers.new('dec', 'DECIMATE')
            md.decimate_type = 'COLLAPSE'
            md.ratio = float(o.get('low_ratio', LOW_DECIMATE['ratio']))
            md.use_collapse_triangulate = True
            dg = bpy.context.evaluated_depsgraph_get()
            new = bpy.data.meshes.new_from_object(t.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
            new.name = me.name + '_low'
            new.validate(clean_customdata=False)
            for i, m in enumerate(me.materials):
                if i < len(new.materials):
                    new.materials[i] = m
            bpy.data.objects.remove(t)
            done[me.name] = new
            before += n
            after += sum(len(p.vertices) - 2 for p in new.polygons)
        o.data = done[me.name]
    bpy.data.collections.remove(tmp_coll)
    log(f'low LOD: {len(done)} meshes decimated, {before} -> {after} triangles')
    return {'meshes': len(done), 'tris_before': before, 'tris_after': after}


def low_dissolve_loops(objs):
    """Low tier, non-HERO meshes: dissolve the coplanar support rings again (planar limited dissolve, 0.5°,
    delimited by UV seams/materials/sharp edges so UV0/UV2 island borders stay exact). Returns verts before/after."""
    import bmesh
    import math as _m
    done, before, after = set(), 0, 0
    for o in objs:
        if o.type != 'MESH' or o.data.name in done or o.get('decal'):
            continue
        root = o
        while root.parent is not None:
            root = root.parent
        if root.get('prop_type') in wear.HERO and root.get('prop_type') not in LOW_WEAR_DROP:
            continue
        done.add(o.data.name)
        me = o.data
        before += len(me.vertices)
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.dissolve_limit(bm, angle_limit=_m.radians(0.5), use_dissolve_boundaries=False,
                                 verts=list(bm.verts), edges=list(bm.edges), delimit={'UV', 'MATERIAL', 'SHARP'})
        bm.to_mesh(me)
        bm.free()
        after += len(me.vertices)
    log(f'low dissolve: {before} -> {after} verts')
    return {'verts_before': before, 'verts_after': after}


def strip_low_wear(objs):
    """Low tier: only HERO props keep the 'wear' attribute (PROPS-FINISH §1.5). Runs after the Medium/Max export,
    so removing it from shared mesh data is safe. Returns the vertex counts kept/stripped."""
    kept, stripped, done = 0, 0, set()
    for o in objs:
        if o.type != 'MESH' or o.data.name in done:
            continue
        done.add(o.data.name)
        root = o
        while root.parent is not None:
            root = root.parent
        attr = o.data.color_attributes.get(wear.ATTR)
        if attr is None:
            continue
        if root.get('prop_type') in wear.HERO:
            kept += len(o.data.vertices)
        else:
            stripped += len(o.data.vertices)
            o.data.color_attributes.remove(attr)
    log(f'low wear: kept on {kept} HERO verts, stripped from {stripped}')
    return {'kept_verts': kept, 'stripped_verts': stripped}


def main():
    wear.color_meshopt_patch()       # props exports only: meshopt-compress COLOR_0 (8.0 -> ? B/vert)
    layout = json.loads((SHARED / 'level-layout.json').read_text())
    only = set(ARGS['types'].split(',')) if isinstance(ARGS.get('types'), str) else None
    reset()
    bpy.context.scene.render.engine = 'CYCLES'
    var_coll = bpy.data.collections.new('variants')
    inst_coll = bpy.data.collections.new('instances')
    bpy.context.scene.collection.children.link(var_coll)
    bpy.context.scene.collection.children.link(inst_coll)

    placements = layout.get('props', [])
    variants, skipped, missing = {}, {}, set()
    by_ms = {}
    placed = []
    for pl in placements:
        t = pl['type']
        if only and t not in only:
            continue
        if t in registry.NO_MESH:
            skipped[pl['id']] = registry.NO_MESH[t]
            continue
        if t not in registry.REGISTRY:
            missing.add(t)
            continue
        key = registry.variant_key(t, pl.get('params'))
        if key not in variants:
            log(f'build {t} for {pl["id"]}')
            variants[key] = build_variant(t, pl.get('params'), var_coll, pl.get('pos', (0, 0, 0)), pl.get('yaw', 0.0))
            variants[key]['type'] = t
            variants[key]['first'] = pl['id']
            variants[key]['placements'] = []
        variants[key]['placements'].append(pl['id'])
        if t in registry.HOUSE_BUILT:
            skipped[pl['id']] = registry.HOUSE_BUILT[t]
            continue
        objs = instance(pl, variants[key], inst_coll)
        # the County Road 9 opening set (room RC9) ships as its own library: props_road.glb (docs/C1-OPENING.md §6.3)
        by_ms.setdefault('ROAD' if pl.get('room') == 'RC9' else pl.get('milestone', 'M2'), []).append(objs)
        placed.append((pl, objs))

    # budgets
    over = []
    report = {'types': {}, 'variants': [], 'skipped': skipped, 'missing': sorted(missing),
              'families_missing': registry.MISSING}
    for key, v in variants.items():
        budget = registry.REGISTRY[v['type']]['budget']
        report['variants'].append({'type': v['type'], 'first': v['first'], 'placements': v['placements'],
                                   'tris': v['tris'], 'budget': budget})
        t = report['types'].setdefault(v['type'], {'variants': 0, 'max_tris': 0, 'budget': budget})
        t['variants'] += 1
        t['max_tris'] = max(t['max_tris'], v['tris'])
        if v['tris'] > budget:
            over.append(f"{v['first']} ({v['type']}): {v['tris']} > {budget}")
    for o in over:
        log('OVER BUDGET', o)

    # static props -> their room's lightmap band (props/lightmap.py)
    lm_stats = {}
    if not ARGS.get('no_lightmap'):
        groups = plm.prepare(layout, placed)
        lm_stats = plm.pack(groups)
        write_json(CACHE / 'props' / 'lightmap.json', lm_stats)
    report['lightmap'] = lm_stats

    # export
    files = {}
    if not ARGS.get('no_export'):
        var_coll.hide_viewport = False
        stage = EXPORT_DIR or (CACHE / 'props')
        stage.mkdir(parents=True, exist_ok=True)
        for ms, groups in sorted(by_ms.items()):
            objs = [o for g in groups for o in g]
            name = f'props_{ms.lower()}.glb'
            p = stage / name
            size = gexport.export_glb(p, objs, preset='static', **WEAR_EXPORT)
            info = gexport.inspect_glb(p)
            files[name] = {'bytes': size, 'meshes': len(info['meshes']), 'roots': len(groups)}
            for tier in (() if EXPORT_DIR else ('medium', 'max')):
                dst = REPO / 'public' / 'assets' / tier / name
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(p, dst)
            log(f'exported {name}: {len(groups)} placements, {size / 1024:.0f} KiB')
        # the bake jobs append the placed instances from here (before the Low decimation touches them)
        bpy.ops.wm.save_as_mainfile(filepath=str(stage / 'props.blend'), compress=True, copy=True)
        # Low tier: decimated copies of the big non-lightmapped meshes
        low = low_lod([o for g in by_ms.values() for grp in g for o in grp])
        report['low_lod'] = low
        report['low_wear'] = strip_low_wear([o for g in by_ms.values() for grp in g for o in grp])
        if ARGS.get('low_dissolve'):
            report['low_dissolve'] = low_dissolve_loops([o for g in by_ms.values() for grp in g for o in grp])
        for ms, groups in sorted(by_ms.items()):
            # ruling (h) 2026-10-09: on Low the grime decals go first when the 27 MB budget is tight (LOW_GRIME)
            objs = [o for g in groups for o in g if LOW_GRIME or o.get('decal') != 'grime']
            name = f'props_{ms.lower()}.glb'
            p = stage / f'low_{name}'
            size = gexport.export_glb(p, objs, preset='static', **WEAR_EXPORT)
            files[name]['low_bytes'] = size
            if not EXPORT_DIR:
                dst = REPO / 'public' / 'assets' / 'low' / name
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(p, dst)
            log(f'exported low {name}: {size / 1024:.0f} KiB')
    report['files'] = files
    report['wear'] = {f'{t}/{n}': v for (t, n), v in sorted(wear.STATS.items(), key=lambda kv: str(kv[0]))}
    write_json((EXPORT_DIR or (CACHE / 'props')) / 'props.json', report)

    # review renders
    renders = []
    if not ARGS.get('no_render') or ARGS.get('render'):
        from props import preview
        for o in inst_coll.objects:
            o.hide_render = True
        studio = preview.Studio(int(ARGS.get('samples', 24)))
        shots = REPO / 'scratch' / 'props'
        items = []
        for key, v in sorted(variants.items(), key=lambda kv: (kv[1]['type'], kv[1]['first'])):
            fname = f"{v['type']}__{v['first']}.png"
            if ARGS.get('wear_tiles'):     # PROPS-FINISH §6.2: beauty + 4 mask channels in one row per prop
                stem = (EXPORT_DIR or shots) / 'wear' / f"{v['type']}__{v['first']}"
                tiles = preview.render_wear(studio, v['objs'], stem, shot=registry.REGISTRY[v['type']].get('preview'))
                if tiles:
                    preview.contact_sheet([(t, f"{v['type']} {t.stem.split('_')[-1]}", '') for t in tiles],
                                          Path(f'{stem}_sheet.png'), cols=5, thumb=256)   # 512/256: whole render
                    renders.append(f'{stem}_sheet.png')
                continue
            dims = studio.render(v['objs'], shots / fname, shot=registry.REGISTRY[v['type']].get('preview'))
            if dims is None:
                continue
            items.append((shots / fname, f"{v['type']} {v['first'][2:]}",
                          f"{dims[0]:.2f}x{dims[1]:.2f}x{dims[2]:.2f}M {v['tris']}T"))
            renders.append(fname)
        if items and not only:
            preview.contact_sheet(items, REPO / 'docs' / 'props-contact.png')
        elif items:
            preview.contact_sheet(items, shots / '_subset-contact.png')
    result({'job': 'props', 'variants': len(variants), 'placements': sum(len(v['placements']) for v in variants.values()),
            'missing_types': sorted(missing), 'over_budget': over, 'files': files, 'renders': len(renders),
            'tris_by_type': {k: v['max_tris'] for k, v in sorted(report['types'].items())}})
    if over and not only:
        raise SystemExit('props over triangle budget: ' + '; '.join(over))


main()
