"""Job `anims`: open .cache/characters/<char>.blend, author every clip (one action per NLA track, in place, 30 fps),
render key-frame review sheets, export public/assets/<tier>/<char>.glb (one armature per GLB; the GLB is identical
for every tier, textures differ) and write .cache/anims/<char>_clips.json.

  node scripts/assets.mjs --only anims
  (dev) node blender/characters/dev.mjs blender/anim/build_anims.py --only ada --clips ada_look,ada_patrol
Args: --only ada,harlan,arms  --clips a,b (subset, dev)  --no-render  --no-export
"""
import json
import math
import shutil
import time
from pathlib import Path

import bpy
import numpy as np

from lib import actions
from lib import export as gexport
from lib.scene import CACHE, REPO, job_args, log, result, write_json
from anim import clip as clipmod
from anim import sockets

ARGS = job_args()
ONLY = (ARGS.get('only') or 'ada,harlan,arms').split(',')
SUBSET = ARGS.get('clips')
OUT = CACHE / 'anims'
TIERS = ('low', 'medium', 'max')


def load(char):
    bpy.ops.wm.open_mainfile(filepath=str(CACHE / 'characters' / f'{char}.blend'))
    rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE' and o.get('character') == char)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.get('character') == char]
    for o in list(bpy.data.objects):
        if o not in meshes and o is not rig and o.type in ('MESH', 'CAMERA', 'LIGHT', 'EMPTY'):
            bpy.data.objects.remove(o)
    return rig, meshes


def clips_for(char, rig):
    if char == 'ada':
        from anim import clips_ada, gait
        return clips_ada.all_clips(gait.LegGeo(rig))
    if char == 'harlan':
        from anim import clips_harlan, gait
        return clips_harlan.all_clips(gait.LegGeo(rig))
    if char == 'arms':
        from anim import clips_arms
        return clips_arms.all_clips(rig)
    raise SystemExit(char)


def review_sheet(char, rig, meshes, baked):
    from characters import review
    try:
        from props.preview import draw_text
    except Exception:
        def draw_text(*a, **k):
            return 0
    review.workbench((300, 420))
    sc = bpy.context.scene
    sc.display.shading.color_type = 'MATERIAL'
    cam = review._camera()
    rows = []
    ad = rig.animation_data
    for c, act in baked:
        ad.use_nla = False
        ad.action = act
        ad.action_slot = act.slots[0]
        tiles = []
        for k in range(5):
            f = 1 + int(round((c.frames - 1) * k / 4))
            sc.frame_set(f)
            if char == 'arms':
                review.look(cam, (0.0, -0.05, 0.02), (0.0, 1.0, -0.15), 30)
            else:
                h = 1.9 if char == 'harlan' else 1.62
                review.look(cam, (2.3 * h / 1.62, -2.9 * h / 1.62, 1.2 * h / 1.62), (0, -0.2, 0.8 * h / 1.62), 40)
            a = review.render_to_array(review.OUT / '__clip.png')
            draw_text(a, 4, 4, f'{c.name} {f / 30:.1f}S' if k == 0 else f'{(f - 1) / 30:.2f}S', scale=1)
            tiles.append(a)
        rows.append(np.concatenate(tiles, 1))
    ad.action = None
    ad.use_nla = True
    sc.frame_set(1)
    W = max(r.shape[1] for r in rows)
    sheet = np.concatenate([np.pad(r, ((0, 0), (0, W - r.shape[1]), (0, 0))) for r in rows], 0)
    for i in range(0, len(rows), 7):
        part = sheet[i * rows[0].shape[0]:(i + 7) * rows[0].shape[0]]
        H, Wd = part.shape[:2]
        img = bpy.data.images.new('__s', Wd, H)
        img.pixels.foreach_set(np.ascontiguousarray(part[::-1]).ravel())
        img.filepath_raw = str(review.OUT / f'{char}_clips_{i // 7}.png')
        img.file_format = 'PNG'
        img.save()
        bpy.data.images.remove(img)


def export_head_track(rig, baked):
    """World matrices of Ada's head during ada_opening (Harlan's hand follows her hair in harlan_opening)."""
    act = next((a for c, a in baked if a.name == 'ada_opening'), None)
    if act is None:
        return
    ad = rig.animation_data
    ad.use_nla = False
    ad.action = act
    ad.action_slot = act.slots[0]
    sc = bpy.context.scene
    mats = []
    n = int(round(act.frame_range[1]))
    for f in range(1, n + 1):
        sc.frame_set(f)
        m = rig.matrix_world @ rig.pose.bones['head'].matrix
        mats.append([list(r) for r in m])
    ad.action = None
    ad.use_nla = True
    write_json(OUT / 'ada_opening_head.json', {'fps': 30, 'frames': len(mats), 'head_world': mats})


LOW = {'frame_step': 2, 'ratio': 0.5, 'min_tris': 3000}


def strip_private(objs):
    """Drop build-internal custom props ('_'-prefixed, e.g. the hair cards' '_arc' = 187 KB of JSON) from the
    objects, their data and materials before export."""
    for o in objs:
        for idb in [o, o.data] + [m for m in getattr(o.data, 'materials', []) if m]:
            for k in [k for k in idb.keys() if k.startswith('_')]:
                del idb[k]


def export_low(char, rig, meshes):
    """Low tier GLB: clips sampled every 2nd frame (15 fps, linear), meshes WITHOUT shape keys decimated to
    LOW['ratio'] (the Decimate modifier is moved in front of the Armature modifier and applied on the rest mesh;
    vertex groups and UVs are interpolated). Ada's body/hair keep jaw_open/gurgle, so they stay full resolution.
    Call after the anim .blend is saved: this edits the meshes in place."""
    before = after = 0
    for ob in meshes:
        me = ob.data
        n = sum(len(p.vertices) - 2 for p in me.polygons)
        before += n
        if me.shape_keys or n < LOW['min_tris']:
            after += n
            continue
        for o in bpy.context.selected_objects:
            o.select_set(False)
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        md = ob.modifiers.new('low_dec', 'DECIMATE')
        md.decimate_type = 'COLLAPSE'
        md.ratio = LOW['ratio']
        md.use_collapse_triangulate = True
        bpy.ops.object.modifier_move_to_index(modifier=md.name, index=0)
        bpy.ops.object.modifier_apply(modifier=md.name)
        after += sum(len(p.vertices) - 2 for p in ob.data.polygons)
    path = OUT / f'{char}_low.glb'
    n = gexport.export_glb(path, [rig] + meshes, 'character', export_tangents=True, export_frame_step=LOW['frame_step'])
    d = REPO / 'public' / 'assets' / 'low'
    d.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, d / f'{char}.glb')
    log(f'{char} low: {before} -> {after} tris, {n / 1e6:.2f} MB (15 fps)')
    return {'bytes': n, 'tris': after, 'tris_full': before, 'frame_step': LOW['frame_step']}


def main():
    t0 = time.time()
    OUT.mkdir(parents=True, exist_ok=True)
    report = {}
    for char in ONLY:
        rig, meshes = load(char)
        ad = rig.animation_data or rig.animation_data_create()
        ad.action = None
        for tr in list(ad.nla_tracks):
            ad.nla_tracks.remove(tr)
        for a in list(bpy.data.actions):
            bpy.data.actions.remove(a)
        sockets.add_sockets(char, rig)
        clipmod.clear_pose(rig)
        clips = clips_for(char, rig)
        if SUBSET:
            want = SUBSET.split(',')
            clips = [c for c in clips if c.name in want]
        baked = []
        for c in clips:
            t1 = time.time()
            act = clipmod.bake_clip(rig, c, meshes)
            baked.append((c, act))
            log(f'{char}: {c.name} {c.duration:.2f} s ({c.frames} f) {"loop " if c.loop else ""}{"IK " if c.ik else ""}in {time.time() - t1:.1f} s')
        actions.prune_actions([a.name for _, a in baked])
        clipmod.clear_pose(rig)
        table = [{'name': c.name, 'seconds': round((c.frames - 1) / 30.0, 4), 'frames': c.frames, 'loop': c.loop,
                  'ik_baked': bool(c.ik), 'note': c.note, 'milestone': c.milestone} for c, _ in baked]
        write_json(OUT / f'{char}_clips.json', table)
        strip_private([rig] + meshes)
        if not ARGS.get('no_export'):
            path = OUT / f'{char}.glb'
            n = gexport.export_glb(path, [rig] + meshes, 'character', export_tangents=True)
            for tier in ('medium', 'max'):
                d = REPO / 'public' / 'assets' / tier
                d.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, d / f'{char}.glb')
            info = gexport.inspect_glb(path)
            report[char] = {'bytes': n, 'animations': info['animations'], 'skins': info['skins'],
                            'meshes': [(m['name'], m['morph_targets']) for m in info['meshes']]}
            log(f'{char}.glb {n / 1e6:.2f} MB, {len(info["animations"])} animations')
        bpy.ops.wm.save_as_mainfile(filepath=str(OUT / f'{char}_anim.blend'), compress=True)
        if not ARGS.get('no_export'):
            report[char]['low'] = export_low(char, rig, meshes)
        # evaluate from a fresh load (in-session evaluation after nla.bake can stay stale)
        names = [(c, a.name) for c, a in baked]
        bpy.ops.wm.open_mainfile(filepath=str(OUT / f'{char}_anim.blend'))
        rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE' and o.get('character') == char)
        meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.get('character') == char]
        fresh = [(c, bpy.data.actions[n]) for c, n in names]
        if char == 'ada':
            export_head_track(rig, fresh)
        if not ARGS.get('no_render'):
            review_sheet(char, rig, meshes, fresh)
    result({'anims': report, 'seconds': round(time.time() - t0, 1)}, OUT / 'result.json')


main()
