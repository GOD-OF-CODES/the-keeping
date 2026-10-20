"""JUMPSCARE (#147) look-round job (pipeline.json `scare-look`, manual, group `scare`): builds the Cycles-only scare
head scene (scare_scene) and renders ONE still — the hero frame (the face full-frame at the moment of max horror) or
the jaw-spasm frame (shape key `spasm` at 1, proving the rig) — with the player's torch, 35 mm / f/5.6, OIDN.

  node scripts/assets.mjs --only scare-look --force --job-args="--round 1 --spp 96 --frame hero"

Writes scratch/jumpscare/look-r<N>.png (AgX preview at a FIXED exposure, so rounds compare) + .exr (linear), and,
when the previous round exists, scratch/jumpscare/sheet-r<N>.png (previous | this, half size). Prints a RESULT line
with timings, peak RSS and the EV of key spots (thumb bruise, fingertips, eyes, split lip) relative to the nose core.
Args: --round N --spp 96 --res 1920x1200 --h 0.8 --frame hero|spasm --ev -10.5 --guides 1500 --children 16
      --pitch -4 (head chin-up, deg) --aim x,y,z (torch aim, head mm) --torch r,f,u (m from the eye)
      --border x0,y0,x1,y1 (render only that crop of the frame, px, for high-spp inspection; EV probes skipped)
      --rebuild (re-mesh / re-hair even if cached) --nohair --fstop 5.6 --dist 0.27
      --clay (anatomy gate: one grey diffuse-ish material on head/teeth/eyes, no hair; writes look-r<N>-clay.png)
      --center x,y,z (head mm at the frame centre; r7+: -6,-24,-52 with --dist 0.24) --veil (keep the free-hanging
      scalp strands in front of the face; dropped by default since r8). The spasm key is 0 for --frame hero, 1 for spasm.
"""
import math
import time
from pathlib import Path

import bpy
import numpy as np

from lib.scene import REPO, job_args, log, peak_rss_mb, reset, result, setup_cycles
from scare import scare_head as sh, scare_scene as S

A = job_args()
if A.get('lab'):            # #147h: the skin LAB (scare_lab.py) under this job's Blender lock — variants in seconds
    import runpy
    runpy.run_path(str(Path(__file__).with_name('scare_lab.py')), run_name='__main__')
    raise SystemExit(0)
RND = str(A.get('round', '0'))
SPP = int(A.get('spp', 96))
W, H = (int(v) for v in str(A.get('res', '1920x1200')).split('x'))
HMM = float(A.get('h', 0.8))
FRAME = str(A.get('frame', 'hero'))
EV = float(A.get('ev', -10.1))          # r6: +0.4 EV (r1-r5 -10.5 crushed the mid-tones)
SPASM = float(A.get('spasm', 6.0))
JAW = float(A.get('jaw', 9.0))
CLAY = bool(A.get('clay', False))
OUT = REPO / 'scratch' / 'jumpscare'
OUT.mkdir(parents=True, exist_ok=True)
T = {}
t_all = time.perf_counter()

reset()
sc = bpy.context.scene
face = sh.Face(jaw_deg=JAW)
PITCH = float(A.get('pitch', -4.0))      # chin-up (deg); 20 (r0) / 12 (r1 clay) made the nose an upturned snout
# r7 (#147c): --center = the head-space point (mm) at the frame centre. At --dist 0.24 a centre of (-6,-24,-52) puts the
# brow at the top edge and the cut ~150 px inside the bottom edge (scratchpad tools/frame.py), so the face fills the
# frame; moved DOWN rather than pitching chin-up (pitch made the nose a snout).
CENTER = sh.V(*(float(v) for v in str(A.get('center', '-6,-24,-42')).split(',')))
# r10 (#147d): --yaw 15 turns her face toward the torch (image right): the nose's cast shadow on her far cheek shrinks
# (numpy light maps, scratchpad fx/sheet_y.png); r1-r9 yaw 8
M, R = S.pose_matrix(yaw=float(A.get('yaw', 8.0)), pitch=PITCH, T=CENTER, dist=float(A.get('dist', 0.27)))
# #147d: --mirror (default ON) reflects the head (head x -> -x) so HER RIGHT side — the clear eye, the fresh black eye,
# both old scars, the nosebleed and the fingertip bruises — faces the player's torch (in the RIGHT hand, image right).
# r1-r8 lit her left (hair-covered) side and threw the nose shadow across her right cheek. Nobody can tell a mirrored
# face; the docs keep the anatomical labels (her right = head -x).
MIRROR = str(A.get('mirror', '1')) not in ('0', 'false', 'False')
if MIRROR:
    R = R @ np.diag([-1.0, 1.0, 1.0])
    M[:3, :3] = R
    M[:3, 3] = -(R @ (np.asarray(CENTER) * 0.001))         # CENTER still lands on the world origin
pose = bpy.data.objects.new('scare_pose', None)
sc.collection.objects.link(pose)
pose.matrix_world = __import__('mathutils').Matrix([list(r) for r in M])

t0 = time.perf_counter()
rebuild = bool(A.get('rebuild', False))
head, HA = S.build_head(face, HMM, SPASM, pose, rebuild=rebuild)

def clay_material():
    m = bpy.data.materials.new('scare_clay')
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(b.outputs[0], nt.nodes.new('ShaderNodeOutputMaterial').inputs['Surface'])
    b.inputs['Base Color'].default_value = (0.36, 0.36, 0.36, 1.0)
    b.inputs['Roughness'].default_value = 0.6
    return m


CLAYM = clay_material() if CLAY else None
if A.get('debugrp'):
    # #147f diagnostic: is the `rp` vertex attribute (the skin shader's texture coordinate since r9) readable in Cycles?
    # Emission = fract(rp x 2000) per axis (0.5 mm stripes) | --debugrp obj: the same on the Object texture coordinate
    CLAYM = bpy.data.materials.new('scare_debug_rp')
    _nt = CLAYM.node_tree
    for _n in list(_nt.nodes):
        _nt.nodes.remove(_n)
    if str(A['debugrp']) == 'obj':
        _co = _nt.nodes.new('ShaderNodeTexCoord').outputs['Object']
    else:
        _at = _nt.nodes.new('ShaderNodeAttribute')
        _at.attribute_name = 'rp'
        _co = _at.outputs['Vector']
    _vm = _nt.nodes.new('ShaderNodeVectorMath')
    _vm.operation = 'SCALE'
    _vm.inputs['Scale'].default_value = 2000.0
    _nt.links.new(_co, _vm.inputs[0])
    _fr = _nt.nodes.new('ShaderNodeVectorMath')
    _fr.operation = 'FRACTION'
    _nt.links.new(_vm.outputs['Vector'], _fr.inputs[0])
    _em = _nt.nodes.new('ShaderNodeEmission')
    _em.inputs['Strength'].default_value = 1.0
    _nt.links.new(_fr.outputs['Vector'], _em.inputs['Color'])
    _nt.links.new(_em.outputs[0], _nt.nodes.new('ShaderNodeOutputMaterial').inputs['Surface'])
head.data.materials.append(CLAYM or S.skin_material(face))
T['head'] = round(time.perf_counter() - t0, 1)
t0 = time.perf_counter()
tu, tl = S.build_teeth(face, SPASM, pose, rebuild=rebuild)
tm = CLAYM or S.teeth_material()
for o in (tu, tl):
    o.data.materials.append(tm)
eyes, domes, hazes = S.build_eyes(face, pose)
for k, o in enumerate(eyes):
    o.data.materials.append(CLAYM or S.eye_material(k))
if CLAY:
    for o in domes + hazes:
        bpy.data.objects.remove(o)
else:
    cf, cb = S.cornea_materials()
    for k in (0, 1):
        # #147e: a CLEAR dome (the clouding is painted on the globe, S.EYE_RECESS False); r10-r14 clouded the dome front
        domes[k].data.materials.append(cf if not S.EYE_RECESS else S.cornea_front_material(k))
        domes[k].data.materials.append(cb)
        bpy.data.objects.remove(hazes[k])                               # r9's separate cap left a dark ring at its rim
T['teeth_eyes'] = round(time.perf_counter() - t0, 1)
nstrands = 0
if not A.get('nohair') and not CLAY:
    t0 = time.perf_counter()
    g = R.T @ np.array([0.0, 0.0, -1.0])
    if A.get('hairpitch') is not None:
        # #147g: hair laid for another pitch (the neck test frame reuses the hero hair: a re-integration costs ~20 min)
        _, Rh = S.pose_matrix(yaw=float(A.get('yaw', 8.0)), pitch=float(A['hairpitch']), T=CENTER, dist=float(A.get('dist', 0.27)))
        if MIRROR:
            Rh = Rh @ np.diag([-1.0, 1.0, 1.0])
        g = Rh.T @ np.array([0.0, 0.0, -1.0])
    HA2 = S.hair_arrays(face, g, int(A.get('guides', 1500)), int(A.get('children', 16)), rebuild=rebuild)
    # r8 (#147c): drop the scalp strands that hang FREE in front of the face (a vertical veil 1-4 cm proud of the
    # skin, defocused into grey smears over her right eye — the eye contact). Wet hair on the face is plastered: the
    # FACE_CLUMPS ropes stay, as do the side curtains (|x| >= 44 mm) and everything below the chin.
    if not A.get('veil'):
        from scare import scare_hair
        S1 = HA2['S1']
        sub = S1[:, ::3, :]
        flat = sub.reshape(-1, 3)
        sel = (np.abs(flat[:, 0]) < 44.0) & (flat[:, 2] > -112.0) & (flat[:, 2] < 40.0) & (flat[:, 1] < 5.0)
        dd = np.full(len(flat), -1.0)
        dd[sel] = scare_hair.stick_fn(face)(flat[sel])
        veil = (dd > 2.5).reshape(sub.shape[:2]).any(1)
        HA2 = dict(HA2, S1=S1[~veil], R1=HA2['R1'][~veil])
        log(f'scare hair: removed {int(veil.sum())} of {len(S1)} scalp strands hanging free in front of the face')
    # #147e: lay the plastered hair ON the rendered skin. The strands are stuck 0.08 mm off the SDF, but the mesh is the
    # SDF + displacement (bruise swelling up to 0.5 mm, scars, the nosebleed body) and the curves sag between control
    # points 3-5 mm apart: 395 of 582 face strands had points under the skin (fx2/bury.py) and read as DASHED black
    # tape. Densify the face strands to 0.6 x their spacing and push every point within 1 mm of the mesh out to
    # radius + 0.03 mm along the outward mesh normal (BVH on the displaced head, head mm).
    if not A.get('keep_buried'):
        from mathutils.bvhtree import BVHTree
        from mathutils import Vector as _V
        bvh = BVHTree.FromPolygons(HA['V'].tolist(), HA['Q'].tolist(), all_triangles=False)
        cen = np.array([0.0, 40.0, -10.0])

        def _densify(S, R, n):
            out_s, out_r = [], []
            for s, r in zip(S, R):
                seg = np.linalg.norm(np.diff(s, axis=0), axis=1)
                u = np.concatenate([[0.0], np.cumsum(seg)])
                q = np.linspace(0.0, u[-1], n)
                out_s.append(np.stack([np.interp(q, u, s[:, k]) for k in range(3)], 1))
                out_r.append(np.interp(q, u, r))
            return np.array(out_s), np.array(out_r)

        def _unbury(S, R, front_only=False):
            P = S.reshape(-1, 3).copy()
            rr = R.reshape(-1)
            moved = 0
            idx = np.arange(len(P))
            if front_only:
                idx = idx[(P[:, 1] < 30.0) & (P[:, 2] > -150.0)]
            for i in idx:
                loc, nrm, _, _ = bvh.find_nearest(_V(P[i]), 1.0)
                if loc is None:
                    continue
                lo = np.array(loc)
                n = np.array(nrm)
                if n @ (lo - cen) < 0:
                    n = -n
                sd = (P[i] - lo) @ n
                need = rr[i] + 0.03
                if sd < need:
                    P[i] = P[i] + n * (need - sd)
                    moved += 1
            return P.reshape(S.shape), moved
        def _smooth(S, it=6):
            # 1-D Laplacian along each strand (ends kept): r14's face strands carried the kinks of the per-point
            # front projection; each kink caught a hair glint = a row of bright dashes across the clump
            S = S.copy()
            for _ in range(it):
                S[:, 1:-1] = S[:, 1:-1] * 0.5 + 0.25 * (S[:, :-2] + S[:, 2:])
            return S
        t1 = time.perf_counter()
        S2d, R2d = _densify(HA2['S2'], HA2['R2'], 120)
        m2 = 0
        for _ in range(3):                          # smooth, re-lay on the skin, repeat (the last pass only lifts)
            S2d, mm = _unbury(_smooth(S2d), R2d)
            m2 += mm
        S4d, m4 = _unbury(HA2['S4'], HA2['R4'])
        S1d, m1 = _unbury(HA2['S1'], HA2['R1'], front_only=True)
        HA2 = dict(HA2, S1=S1d, S2=S2d, R2=R2d, S4=S4d)
        log(f'scare hair: un-buried {m2} face / {m4} brow / {m1} scalp points in {time.perf_counter() - t1:.1f} s')
    # #147f: drop scalp strands nobody can see and that cannot shadow anything visible (the torch is in front): every
    # point behind the head's vertical axis (y > 62 mm) or below the frame (z < -175 mm). Memory: r20's render ran at
    # 3.7 GB RSS on an 8 GB machine already swapping 3.7 GB -> 56 min instead of 8.
    S1 = HA2['S1']
    hid = ((S1[:, :, 1] > 62.0) | (S1[:, :, 2] < -175.0)).all(1)
    HA2 = dict(HA2, S1=S1[~hid], R1=HA2['R1'][~hid])
    log(f'scare hair: culled {int(hid.sum())} hidden scalp strands')
    hm = S.hair_material()
    hm2 = S.hair_material(melanin=0.95, rough=0.25)
    if A.get('hairemit'):                   # #147e diagnostic: flat emission hair (glints vs. gaps between hairs)
        hm = bpy.data.materials.new('scare_hair_emit')
        _e = hm.node_tree.nodes.new('ShaderNodeEmission')
        _e.inputs['Color'].default_value = (0.0, 0.0, 0.0, 1.0)
        _o = next(n for n in hm.node_tree.nodes if n.type == 'OUTPUT_MATERIAL')
        hm.node_tree.links.new(_e.outputs[0], _o.inputs['Surface'])
    # #147j: the brows are WET like the head hair (hm: the sharper wet glint), not the dry lash material
    for nm, k, mat in (('scare_hair_scalp', '1', hm), ('scare_hair_face', '2', hm), ('scare_lashes', '3', hm2), ('scare_brows', '4', hm)):
        if len(HA2['S' + k]):
            S.hair_object(nm, HA2['S' + k], HA2['R' + k], mat, pose)
            nstrands += len(HA2['S' + k])
    Sm, Rm = S.meniscus_curves(face)                       # #147d: the tear meniscus (bright wet line at the lids)
    S.hair_object('scare_meniscus', Sm, Rm, S.water_material(), pose)
    Ss, Rs = S.saliva_curves(face)                         # #147j: watery strings across the open mouth
    if len(Ss):
        S.hair_object('scare_saliva', Ss, Rs, S.water_material(), pose)
    T['hair'] = round(time.perf_counter() - t0, 1)

# The spasm key value is set EXPLICITLY for both frames (#147c): Blender 5.2's shape_key_add() creates a key at value
# 1.0, so every 'hero' still r1-r8 was rendered WITH the spasm (jaw 9 + 6 deg) and the r8 spasm frame was bit-identical
# to the hero. Set here, before the camera/torch/Cycles setup: set immediately before bpy.ops.render.render, Blender
# aborted at render start (SIGABRT, NSURL initFileURLWithPath: nil) in 3 of 3 tries.
for o in (head, tl):
    o.data.shape_keys.key_blocks['spasm'].value = 1.0 if FRAME == 'spasm' else 0.0
SK = {o.name: round(o.data.shape_keys.key_blocks['spasm'].value, 3) for o in (head, tl)}

focus = face.E[1] + sh.V(0.0, -12.7, 0.0)          # her right cornea apex
if A.get('focus'):              # #147g: head-mm focus point (e.g. between the corneas and the nose tip with --fstop 8)
    focus = sh.V(*(float(v) for v in str(A['focus']).split(',')))
AIM = sh.V(*(float(v) for v in str(A.get('aim', '-12,-34,-50')).split(',')))   # head mm: torch aim. #147d: her right
# upper lip / nasolabial (numpy irradiance search, scratchpad fx/light.py): the core on the mouth, her right eye ~-3 EV,
# the cut front / fingertips / thumb ~-5..-6 EV under the core — r4-r8 aimed at the bridge and left the lower face and
# the neck 6-10 EV down (unreadable at any exposure)
TOFF = tuple(float(v) for v in str(A.get('torch', '0.06,0.0,-0.27')).split(','))   # m from the eye: right, fwd, up
CAMUP = float(A.get('camup', 0.04))     # r5: the eye at HER eye level, looking down 8.4 deg at the frame centre (r1-r4
# had the camera level with the upper lip, looking up the nostrils)
# #147l LEAD STAGING DECISION (AD4-r37 rank 2): --lens 47.6 --shift -0.1169,0.0184 = a tighter CROP of the same eye's
# view (the face fills the hold frames; perspective / torch / lighting unchanged); --ring 0.08,12,26 = the reflector's
# soft spill ring at 8 % of the near-field peak, flat to 12 deg, 0 at 26 deg (jaw / chin / brows / hair 2-4 EV under
# the core instead of 6+). Defaults = r37 (35 mm, no shift, no ring).
LENS = float(A.get('lens', 35.0))
SHIFT = tuple(float(v) for v in str(A.get('shift', '0,0')).split(','))
RING = tuple(float(v) for v in str(A['ring']).split(',')) if A.get('ring') else None
cam, lights, tinfo = S.setup_camera_and_torch(M, R, dist=float(A.get('dist', 0.27)), fstop=float(A.get('fstop', 8.0)),
                                              focus_head_mm=focus, aim_head_mm=AIM, torch_off=TOFF, cam_up=CAMUP,
                                              lens=LENS, shift=SHIFT, ring_frac=RING)
try:                                        # #147l: verify the crop maths with Blender's own projection (lens shift aware)
    from bpy_extras.object_utils import world_to_camera_view
    from mathutils import Vector
    sc.render.resolution_x, sc.render.resolution_y = W, H      # the frame aspect (set again below)
    # #147l restart: evaluate the depsgraph first — the camera was just placed by location/rotation_euler, so its
    # matrix_world was still the identity (l1 printed eye_R (-586, 1871), nose_tip (550, -5357): not a shift bug)
    bpy.context.view_layer.update()
    _lm ={'eye_R': face.E[1] + sh.V(0, -12.9, 0), 'eye_L': face.E[0] + sh.V(0, -12.9, 0), 'nose_tip': sh.V(-1.0, -46.5, -30.0),
           'upper_lip': sh.V(0.0, -32.5, -54.5)}
    _o = {}
    for _k, _p in _lm.items():
        _w = (np.asarray(M) @ np.append(np.asarray(_p) * 0.001, 1.0))[:3]
        _c = world_to_camera_view(sc, cam, Vector(tuple(_w)))
        _o[_k] = (round(_c.x * W), round((1.0 - _c.y) * H))
    log(f'scare frame: landmarks px (x, y down) {_o}')
except Exception as e:
    log(f'scare frame: projection check failed: {e}')
if A.get('border'):                         # inspection crop: --border x0,y0,x1,y1 in output pixels (y down)
    bx0, by0, bx1, by1 = (float(v) for v in str(A['border']).split(','))
    sc.render.use_border = True
    sc.render.use_crop_to_border = True
    sc.render.border_min_x, sc.render.border_max_x = bx0 / W, bx1 / W
    sc.render.border_min_y, sc.render.border_max_y = 1.0 - by1 / H, 1.0 - by0 / H

import gc
for _k in ('bvh', 'S1', 'S2d', 'S4d', 'S1d', 'sub', 'flat'):
    globals().pop(_k, None)
gc.collect()                                     # #147f: the mesher / field arrays of a head rebuild stayed resident
used = setup_cycles(SPP, device='GPU', max_bounces=12, diffuse_bounces=4)
cy = sc.cycles
cy.glossy_bounces = 6
cy.transmission_bounces = 8
cy.transparent_max_bounces = 32
cy.use_denoising = True
cy.denoiser = 'OPENIMAGEDENOISE'
try:
    cy.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
    cy.denoising_prefilter = 'ACCURATE'
    cy.denoising_use_gpu = True
except Exception as e:
    log(f'denoise opts: {e}')
cy.use_animated_seed = False
# #147f: NO refractive caustics. The cornea dome and the tear meniscus are glass made shadow-ray-transparent (so the torch
# reaches the painted globe), and Cycles ALSO followed globe -> diffuse bounce -> glass refraction -> torch: the light was
# counted twice and focused by the curved dome (r19g passes: cornea 224 vs the lit skin round it 39-55 with a 0.11
# albedo) = the pale "contact-lens" disc of every round. NEE through the transparent shadow ray is the direct light.
cy.caustics_refractive = False
sc.cycles_curves.shape = 'THICK'
sc.render.resolution_x, sc.render.resolution_y = W, H
sc.render.resolution_percentage = 100
sc.render.use_persistent_data = False
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'None'
sc.view_settings.exposure = EV
try:                                         # the game's camera WB indoors (look.ts wbIndoorK 3300, strength 1)
    sc.view_settings.use_white_balance = True
    sc.view_settings.white_balance_temperature = float(A.get('wb', 3300.0))
    sc.view_settings.white_balance_tint = 10.0
except Exception as e:
    log(f'white balance: {e}')

if A.get('passes'):                         # #147e diagnostic: light-path passes (multilayer EXR) for a --border crop
    vl = sc.view_layers[0]
    for nm in ('use_pass_diffuse_direct', 'use_pass_diffuse_indirect', 'use_pass_diffuse_color', 'use_pass_glossy_direct',
               'use_pass_glossy_indirect', 'use_pass_glossy_color', 'use_pass_transmission_direct', 'use_pass_emit'):
        setattr(vl, nm, True)
    try:                                    # #147f gate: the un-denoised image too (does OIDN eat the sparkle?)
        vl.cycles.denoising_store_passes = True
    except Exception as e:
        log(f'denoising_store_passes: {e}')
    sc.render.filepath = str(OUT / f'passes-r{RND}-')
    sc.render.image_settings.media_type = 'MULTI_LAYER_IMAGE'      # Blender 5.x: the media type selects multilayer EXR
    sc.render.image_settings.color_depth = '32'
    t0 = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    T['render'] = round(time.perf_counter() - t0, 1)
    log(f'passes written to {sc.render.filepath}')
    _im = bpy.data.images['Render Result']
    try:
        sc.render.image_settings.media_type = 'IMAGE'
    except Exception as e:
        log(f'media_type: {e}')
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.image_settings.color_depth = '8'
    _im.save_render(filepath=str(OUT / f'passes-r{RND}-agx.png'), scene=sc)
    result({'job': 'scare-look', 'round': RND, 'passes': True, 'crop': str(A.get('border')), 'spp': SPP, 'times': T,
            'peak_rss_mb': round(peak_rss_mb(), 1)})
    raise SystemExit(0)
if A.get('seq'):    # #147i: the keyframed 1.0 s sequence / motion test on THIS scene (scare_seq.py), same Blender lock
    from scare import scare_seq
    scare_seq.run(A, sc, pose, (head, tl), W, H, SPP, T, t_all,
                  dict(verts=int(len(HA['V'])), strands=nstrands, torch=tinfo, round=RND))
    raise SystemExit(0)
t0 = time.perf_counter()
bpy.ops.render.render(write_still=False)
T['render'] = round(time.perf_counter() - t0, 1)
tag = f'look-r{RND}' + ('' if FRAME == 'hero' else f'-{FRAME}') + ('-clay' if CLAY else '') + ('-crop' if A.get('border') else '')
png = OUT / f'{tag}.png'
exr = OUT / f'{tag}.exr'
img = bpy.data.images['Render Result']
ims = sc.render.image_settings
ims.file_format = 'OPEN_EXR'
ims.color_depth = '16'
ims.exr_codec = 'ZIP'
img.save_render(filepath=str(exr), scene=sc)
ims.file_format = 'PNG'
ims.color_mode = 'RGB'
ims.color_depth = '8'
agx_png = OUT / f'{tag}-agx.png'
img.save_render(filepath=str(agx_png), scene=sc)


def film_finish(src, dst, seed=7):
    """The game's display-referred finish (src/render/camera-fx.ts filmFinish): vignette 0.4 = 1 - smoothstep(0.3,
    0.95, |(uv - 0.5) * (1.25, 1)|) * 0.4; value-noise grain on a 1.5 px lattice, amplitude 0.03 x mid-tone bell / 2.2;
    + 1 px lateral CA at the corner (red out / blue in by 0.5 px x r)."""
    im = bpy.data.images.load(str(src), check_existing=False)
    w, h = im.size
    a = np.empty(w * h * 4, np.float32)
    im.pixels.foreach_get(a)
    a = a.reshape(h, w, 4)[..., :3].astype(np.float64)
    yy, xx = np.mgrid[0:h, 0:w]
    u = (xx + 0.5) / w - 0.5
    v = (yy + 0.5) / h - 0.5
    rr = np.sqrt(u * u + v * v) / np.sqrt(0.5)
    for ch, sgn in ((0, 1.0), (2, -1.0)):                        # lateral CA: radial resample of R and B
        sx = xx + sgn * 0.5 * rr * u / np.maximum(np.abs(u) + np.abs(v), 1e-6) * 1.0
        sy = yy + sgn * 0.5 * rr * v / np.maximum(np.abs(u) + np.abs(v), 1e-6) * 1.0
        x0 = np.clip(np.floor(sx).astype(int), 0, w - 2); y0 = np.clip(np.floor(sy).astype(int), 0, h - 2)
        fx = np.clip(sx - x0, 0, 1); fy = np.clip(sy - y0, 0, 1)
        c = a[..., ch]
        a[..., ch] = ((c[y0, x0] * (1 - fx) + c[y0, x0 + 1] * fx) * (1 - fy) + (c[y0 + 1, x0] * (1 - fx) + c[y0 + 1, x0 + 1] * fx) * fy)
    dv = np.sqrt((u * 1.25) ** 2 + v * v)
    t = np.clip((dv - 0.3) / 0.65, 0, 1)
    vig = 1.0 - t * t * (3 - 2 * t) * 0.4
    rng = np.random.default_rng(seed)
    gw, gh = int(w / 1.5) + 3, int(h / 1.5) + 3
    G = rng.random((gh, gw))
    q = np.stack([xx / 1.5, yy / 1.5], -1)
    i0 = np.floor(q).astype(int); f = q - i0
    sm = f * f * (3 - 2 * f)
    g00 = G[i0[..., 1], i0[..., 0]]; g10 = G[i0[..., 1], i0[..., 0] + 1]
    g01 = G[i0[..., 1] + 1, i0[..., 0]]; g11 = G[i0[..., 1] + 1, i0[..., 0] + 1]
    n = ((g00 * (1 - sm[..., 0]) + g10 * sm[..., 0]) * (1 - sm[..., 1]) + (g01 * (1 - sm[..., 0]) + g11 * sm[..., 0]) * sm[..., 1] - 0.5) * 3
    lum = np.clip(a @ np.array([0.2126, 0.7152, 0.0722]), 0, 1)
    bell = np.minimum(lum * (1 - lum) * 4 + 0.15, 1.0)
    g = n * 0.03 * bell / 2.2
    a = a * vig[..., None] * (1 + g)[..., None]
    # #147h (ruling au: judge stills through an ISO-1200 grain proxy before calling the black a "digital void"): the
    # sensor's read-noise FLOOR, which the game's multiplicative grain (camera-fx.ts) cannot make — zero-mean on the
    # display value, clipped at 0 (black lifts ~0.6/255), ~1.6/255 std in the shadows on a 1.2 px demosaic-correlated lattice,
    # 25 % chroma, fading out by the mid-tones. --floor 0 turns it off.
    fl = float(A.get('floor', 1.6)) / 255.0
    if fl > 0:
        rng2 = np.random.default_rng(seed + 1)
        def _vn(seed_off, cell=1.2):
            G2 = rng2.standard_normal((int(h / cell) + 3, int(w / cell) + 3))
            q2 = np.stack([xx / cell, yy / cell], -1)
            j0 = np.floor(q2).astype(int); f2 = q2 - j0
            return ((G2[j0[..., 1], j0[..., 0]] * (1 - f2[..., 0]) + G2[j0[..., 1], j0[..., 0] + 1] * f2[..., 0]) * (1 - f2[..., 1])
                    + (G2[j0[..., 1] + 1, j0[..., 0]] * (1 - f2[..., 0]) + G2[j0[..., 1] + 1, j0[..., 0] + 1] * f2[..., 0]) * f2[..., 1]) * 1.6
        nl = _vn(0)
        fade = np.clip(1.0 - lum / 0.35, 0.0, 1.0) ** 2
        for c in range(3):
            a[..., c] = a[..., c] + fl * fade * (nl + 0.25 * _vn(c + 1))
        a = np.maximum(a, 0.0)
    from characters.texbake import write_png_optimal
    write_png_optimal(np.clip(a, 0, 1).astype(np.float32), dst, alpha=False)


# #147d: METERED preview exposure (the lighting moved, so a fixed EV no longer compares rounds): the face's p99.5 sits
# +3 EV over mid grey (AgX shoulder, not clipped); the EV is logged — the game's fixed cut exposure must match it.
EVM = None
if A.get('meter', True) and not A.get('border'):
    _l = bpy.data.images.load(str(exr))
    _a = np.empty(W * H * 4, np.float32)
    _l.pixels.foreach_get(_a)
    _Y = (_a.reshape(H, W, 4)[..., :3] @ np.array([0.2126, 0.7152, 0.0722])).ravel()
    _Y = _Y[_Y > 1e-4]
    if len(_Y):
        # r10: target 0.6 (+1.7 EV over mid grey); r9's 1.44 (+3 EV) washed the face out to white plaster
        # r17 (#147e): 0.45 (r12-r16 0.75 put the face's bright half on AgX's shoulder: mottle, zones, lip darkness and
        # the pupil shadow compressed to nothing; fx2/ev16.png re-viewed r16 at -8.9/-9.6/-9.9/-10.3)
        # #147f: meter on the 90th percentile (target 0.125 = r17/r18's exposure, f3/meter.py): the wet-film glints added
        # in r19 move p99.5, and glints must not drive the exposure (a film camera meters the face, not its sparkles)
        MP = float(A.get('meterp', 90.0))
        MT = float(A.get('mtarget', 0.125 if MP == 90.0 else 0.45))
        EVM = round(math.log2(MT / float(np.percentile(_Y, MP))) + float(A.get('evoff', 0.0)), 2)
        sc.view_settings.exposure = EVM
        img.save_render(filepath=str(agx_png), scene=sc)
film_finish(agx_png, png)

# #147d: inspection crops at high spp in the SAME Blender session (one lock): --crops "x0,y0,x1,y1@spp;..."
CROPS = []
if A.get('crops'):
    for ci, spec in enumerate(str(A['crops']).split(';')):
        box, _, cspp = spec.partition('@')
        bx0, by0, bx1, by1 = (float(v) for v in box.split(','))
        sc.render.use_border = True
        sc.render.use_crop_to_border = True
        sc.render.border_min_x, sc.render.border_max_x = bx0 / W, bx1 / W
        sc.render.border_min_y, sc.render.border_max_y = 1.0 - by1 / H, 1.0 - by0 / H
        sc.cycles.samples = int(cspp or 384)
        t0 = time.perf_counter()
        bpy.ops.render.render(write_still=False)
        T[f'crop{ci}'] = round(time.perf_counter() - t0, 1)
        im2 = bpy.data.images['Render Result']
        cpng = OUT / f'{tag}-crop{ci}-agx.png'
        ims.file_format = 'PNG'
        im2.save_render(filepath=str(cpng), scene=sc)
        CROPS.append(str(cpng))
    sc.render.use_border = False

# ---- EV of key spots (linear EXR) relative to the nose/upper-lip core
lin = bpy.data.images.load(str(exr))
if tuple(lin.size) != (W, H):                # a --border crop: no probes, no sheet
    result({'job': 'scare-look', 'round': RND, 'frame': FRAME, 'crop': str(A.get('border')), 'spp': SPP, 'times': T,
            'png': str(png), 'peak_rss_mb': round(peak_rss_mb(), 1)})
    raise SystemExit(0)
px = np.empty(W * H * 4, np.float32)
lin.pixels.foreach_get(px)
px = px.reshape(H, W, 4)
Y = 0.2126 * px[..., 0] + 0.7152 * px[..., 1] + 0.0722 * px[..., 2]
Ms = np.asarray(M)
dist = float(A.get('dist', 0.27))


CB = S.camera_basis(dist, CAMUP)


def proj(p_mm):
    pw = (Ms @ np.append(np.asarray(p_mm) * 0.001, 1.0))[:3] - CB[0]
    depth = pw @ CB[1]
    f = LENS / 36.0 * W                     # #147l: the lens and its shift (units of the frame width)
    return (int(W / 2 + (pw @ CB[3]) / depth * f - SHIFT[0] * W),
            int(H / 2 + (pw @ CB[2]) / depth * f - SHIFT[1] * W))   # (x, y from the bottom)


def ev_at(p_mm, r=6):
    x, y = proj(p_mm)
    if not (r <= x < W - r and r <= y < H - r):
        return None
    v = float(np.median(Y[y - r:y + r, x - r:x + r]))
    return v
spots = {'nose_tip': sh.V(-1.0, -46.5, -30.0), 'upper_lip': sh.V(0.0, -32.5, -54.5),
         'eye_R_cornea': face.E[1] + sh.V(0, -12.9, 0), 'eye_L_cornea': face.E[0] + sh.V(0, -12.9, 0),
         'split_lip': sh.V(-7.0, -33.0, -64.0), 'thumb_bruise': face.skin_radial(40.0, -96.0)[0],
         'fingertips': face.skin_radial(-17.0, -89.0)[0],          # #147f r23: split lip + fingertips moved 'brow_scar': sh.V(-27.0, -20.0, 18.0),
         'cut_front': face.skin_radial(0.0, -124.0)[0], 'trachea': sh.V(0.0, 13.5, -131.0),
         'cheek_scar': face.skin_radial(31.0, -24.0)[0] + sh.V(0.0, 0.0, -10.0), 'forehead': sh.V(0.0, -23.0, 40.0),
         'chin': sh.V(0.0, -29.0, -95.0)}
# #147j r37: the scars' real places (the old 'cheek_scar' spot is her LEFT cheek, the pre-147h ring; the crescent is on her
# lit right at (-39, -13) r 13 since 147h; the brow scar's mid-point sA/sB) + the right brow band lateral of the scar
for _k, (_x, _z) in {'crescent_scar': (-39.0, -26.0), 'brow_scar': (-27.0, 18.5), 'brow_R': (-38.0, 17.6)}.items():
    spots[_k] = sh.V(_x, float(face.surface_y(_x, _z)[0]), _z)
core = ev_at(spots['upper_lip']) or 1.0
evs = {}
for k, p in spots.items():
    v = ev_at(p)
    evs[k] = None if v is None else round(math.log2(max(v, 1e-6) / max(core, 1e-6)), 2)

# ---- 2-up sheet: previous round | this round (half size each)
sheet = None
try:
    prev = OUT / f'look-r{int(RND) - 1}' if (FRAME == 'hero' and not CLAY) else None
    prevp = Path(str(prev) + '.png') if prev else None
    if prevp and prevp.exists():
        def half(path):
            im = bpy.data.images.load(str(path))
            w, h = im.size
            a = np.empty(w * h * 4, np.float32)
            im.pixels.foreach_get(a)
            a = a.reshape(h, w, 4)[: h // 2 * 2, : w // 2 * 2, :3]
            return a.reshape(h // 2, 2, w // 2, 2, 3).mean((1, 3))
        a, b = half(prevp), half(png)
        if a.shape == b.shape:
            from characters.texbake import write_png_optimal
            gap = np.zeros((a.shape[0], 8, 3), np.float32)
            sheet = OUT / f'sheet-r{RND}.png'
            write_png_optimal(np.concatenate([a, gap, b], 1), sheet, alpha=False)
except Exception as e:
    log(f'sheet failed: {e}')

T['total'] = round(time.perf_counter() - t_all, 1)
result({'job': 'scare-look', 'round': RND, 'frame': FRAME, 'device': used, 'spp': SPP, 'res': [W, H], 'h_mm': HMM,
        'verts': int(len(HA['V'])), 'strands': nstrands, 'spasm_key': SK, 'times': T, 'torch': tinfo, 'ev_rel_upper_lip': evs,
        'core_lum': core, 'p99_9': float(np.percentile(Y, 99.9)), 'png': str(png), 'sheet': str(sheet) if sheet else None,
        'ev_metered': EVM, 'mirror': MIRROR, 'aim': [float(v) for v in AIM], 'crops': CROPS,
        'peak_rss_mb': round(peak_rss_mb(), 1)})

# #147g: a SECOND pose in the same Blender session (one lock, one scene build): --second "pitch,cx,cy,cz,dist,ax,ay,az"
# renders look-r<N>-neck (the neck test / swing-peak frame: chin-up, the beam on the neck) after the hero; same hair.
if A.get('second'):
    sp = [float(v) for v in str(A['second']).split(',')]
    p2, c2, d2, a2 = sp[0], sh.V(*sp[1:4]), sp[4], sh.V(*sp[5:8])
    M2, R2 = S.pose_matrix(yaw=float(A.get('yaw', 8.0)), pitch=p2, T=c2, dist=d2)
    if MIRROR:
        R2 = R2 @ np.diag([-1.0, 1.0, 1.0])
        M2[:3, :3] = R2
        M2[:3, 3] = -(R2 @ (np.asarray(c2) * 0.001))
    pose.matrix_world = __import__('mathutils').Matrix([list(r) for r in M2])
    for o in [cam] + list(lights):
        bpy.data.objects.remove(o)
    cam2, lights2, tinfo2 = S.setup_camera_and_torch(M2, R2, dist=d2, fstop=float(A.get('fstop', 8.0)), focus_head_mm=focus,
                                                     aim_head_mm=a2, torch_off=TOFF, cam_up=CAMUP)
    sc.render.use_border = False
    sc.cycles.samples = SPP
    sc.view_settings.exposure = EV
    t0 = time.perf_counter()
    bpy.ops.render.render(write_still=False)
    T['render2'] = round(time.perf_counter() - t0, 1)
    tag2 = f'look-r{RND}-neck'
    img2 = bpy.data.images['Render Result']
    ims.file_format = 'OPEN_EXR'
    ims.color_depth = '16'
    ims.exr_codec = 'ZIP'
    exr2 = OUT / f'{tag2}.exr'
    img2.save_render(filepath=str(exr2), scene=sc)
    _l = bpy.data.images.load(str(exr2))
    _a = np.empty(W * H * 4, np.float32)
    _l.pixels.foreach_get(_a)
    _Y = (_a.reshape(H, W, 4)[..., :3] @ np.array([0.2126, 0.7152, 0.0722])).ravel()
    _Y = _Y[_Y > 1e-4]
    EVM2 = round(math.log2(float(A.get('mtarget', 0.125)) / float(np.percentile(_Y, 90))), 2) if len(_Y) else EV
    sc.view_settings.exposure = EVM2
    ims.file_format = 'PNG'
    ims.color_mode = 'RGB'
    ims.color_depth = '8'
    agx2 = OUT / f'{tag2}-agx.png'
    img2.save_render(filepath=str(agx2), scene=sc)
    film_finish(agx2, OUT / f'{tag2}.png')
    result({'job': 'scare-look', 'round': RND, 'frame': 'neck', 'second': sp, 'times': T, 'torch': tinfo2, 'ev_metered': EVM2,
            'png': str(OUT / f'{tag2}.png'), 'peak_rss_mb': round(peak_rss_mb(), 1)})
