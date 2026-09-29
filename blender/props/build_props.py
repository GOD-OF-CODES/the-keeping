"""Job `props`: every prop placement in src/shared/level-layout.json -> per-milestone GLB libraries + review renders.

  node scripts/assets.mjs --only props [--force]
  (dev) Blender ... --python blender/lib/cli.py -- blender/props/build_props.py --types candle,stool --no-export

Outputs (docs/PROPS.md):
  public/assets/<tier>/props_m1.glb, props_m2.glb   one root node per placement (named by its layout id, at the
      origin: base centre, front facing -y in PLAN space = +Z in three), children = parts. Placements whose params
      differ only in a generator's instance_keys share mesh data (glTF mesh reuse).
  .cache/props/props.json                           per-type/variant triangle counts + budgets (read by check_props)
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
from props import kit, registry

TIERS = ('low', 'medium', 'max')
ARGS = job_args()


def _local_name(ob):
    return ob.get('_local') or ob.name


def build_variant(type_id, params, coll, pos=(0, 0, 0), yaw=0.0):
    key = registry.variant_key(type_id, params)
    seed = registry.seed_for(key)
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


def main():
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
        by_ms.setdefault(pl.get('milestone', 'M2'), []).append(instance(pl, variants[key], inst_coll))

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

    # export
    files = {}
    if not ARGS.get('no_export'):
        var_coll.hide_viewport = False
        stage = CACHE / 'props'
        for ms, groups in sorted(by_ms.items()):
            objs = [o for g in groups for o in g]
            name = f'props_{ms.lower()}.glb'
            p = stage / name
            size = gexport.export_glb(p, objs, preset='static')
            info = gexport.inspect_glb(p)
            files[name] = {'bytes': size, 'meshes': len(info['meshes']), 'roots': len(groups)}
            for tier in TIERS:
                dst = REPO / 'public' / 'assets' / tier / name
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(p, dst)
            log(f'exported {name}: {len(groups)} placements, {size / 1024:.0f} KiB')
    report['files'] = files
    write_json(CACHE / 'props' / 'props.json', report)

    # review renders
    renders = []
    if not ARGS.get('no_render'):
        from props import preview
        for o in inst_coll.objects:
            o.hide_render = True
        studio = preview.Studio(int(ARGS.get('samples', 24)))
        shots = REPO / 'scratch' / 'props'
        items = []
        for key, v in sorted(variants.items(), key=lambda kv: (kv[1]['type'], kv[1]['first'])):
            fname = f"{v['type']}__{v['first']}.png"
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
