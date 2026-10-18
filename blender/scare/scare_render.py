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
    hm = S.hair_material()
    hm2 = S.hair_material(melanin=0.95, rough=0.25)
    if A.get('hairemit'):                   # #147e diagnostic: flat emission hair (glints vs. gaps between hairs)
        hm = bpy.data.materials.new('scare_hair_emit')
        _e = hm.node_tree.nodes.new('ShaderNodeEmission')
        _e.inputs['Color'].default_value = (0.0, 0.0, 0.0, 1.0)
        _o = next(n for n in hm.node_tree.nodes if n.type == 'OUTPUT_MATERIAL')
        hm.node_tree.links.new(_e.outputs[0], _o.inputs['Surface'])
    for nm, k, mat in (('scare_hair_scalp', '1', hm), ('scare_hair_face', '2', hm), ('scare_lashes', '3', hm2), ('scare_brows', '4', hm2)):
        if len(HA2['S' + k]):
            S.hair_object(nm, HA2['S' + k], HA2['R' + k], mat, pose)
            nstrands += len(HA2['S' + k])
    Sm, Rm = S.meniscus_curves(face)                       # #147d: the tear meniscus (bright wet line at the lids)
    S.hair_object('scare_meniscus', Sm, Rm, S.water_material(), pose)
    T['hair'] = round(time.perf_counter() - t0, 1)

# The spasm key value is set EXPLICITLY for both frames (#147c): Blender 5.2's shape_key_add() creates a key at value
# 1.0, so every 'hero' still r1-r8 was rendered WITH the spasm (jaw 9 + 6 deg) and the r8 spasm frame was bit-identical
# to the hero. Set here, before the camera/torch/Cycles setup: set immediately before bpy.ops.render.render, Blender
# aborted at render start (SIGABRT, NSURL initFileURLWithPath: nil) in 3 of 3 tries.
for o in (head, tl):
    o.data.shape_keys.key_blocks['spasm'].value = 1.0 if FRAME == 'spasm' else 0.0
SK = {o.name: round(o.data.shape_keys.key_blocks['spasm'].value, 3) for o in (head, tl)}

focus = face.E[1] + sh.V(0.0, -12.7, 0.0)          # her right cornea apex
AIM = sh.V(*(float(v) for v in str(A.get('aim', '-12,-34,-50')).split(',')))   # head mm: torch aim. #147d: her right
# upper lip / nasolabial (numpy irradiance search, scratchpad fx/light.py): the core on the mouth, her right eye ~-3 EV,
# the cut front / fingertips / thumb ~-5..-6 EV under the core — r4-r8 aimed at the bridge and left the lower face and
# the neck 6-10 EV down (unreadable at any exposure)
TOFF = tuple(float(v) for v in str(A.get('torch', '0.06,0.0,-0.27')).split(','))   # m from the eye: right, fwd, up
CAMUP = float(A.get('camup', 0.04))     # r5: the eye at HER eye level, looking down 8.4 deg at the frame centre (r1-r4
# had the camera level with the upper lip, looking up the nostrils)
cam, lights, tinfo = S.setup_camera_and_torch(M, R, dist=float(A.get('dist', 0.27)), fstop=float(A.get('fstop', 8.0)),
                                              focus_head_mm=focus, aim_head_mm=AIM, torch_off=TOFF, cam_up=CAMUP)
if A.get('border'):                         # inspection crop: --border x0,y0,x1,y1 in output pixels (y down)
    bx0, by0, bx1, by1 = (float(v) for v in str(A['border']).split(','))
    sc.render.use_border = True
    sc.render.use_crop_to_border = True
    sc.render.border_min_x, sc.render.border_max_x = bx0 / W, bx1 / W
    sc.render.border_min_y, sc.render.border_max_y = 1.0 - by1 / H, 1.0 - by0 / H

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
    sc.render.filepath = str(OUT / f'passes-r{RND}-')
    sc.render.image_settings.media_type = 'MULTI_LAYER_IMAGE'      # Blender 5.x: the media type selects multilayer EXR
    sc.render.image_settings.color_depth = '32'
    bpy.ops.render.render(write_still=True)
    log(f'passes written to {sc.render.filepath}')
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
        EVM = round(math.log2(float(A.get('mtarget', 0.45)) / float(np.percentile(_Y, 99.5))) + float(A.get('evoff', 0.0)), 2)
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
    f = 35.0 / 36.0 * W
    return int(W / 2 + (pw @ CB[3]) / depth * f), int(H / 2 + (pw @ CB[2]) / depth * f)   # (x, y from the bottom)


def ev_at(p_mm, r=6):
    x, y = proj(p_mm)
    if not (r <= x < W - r and r <= y < H - r):
        return None
    v = float(np.median(Y[y - r:y + r, x - r:x + r]))
    return v
spots = {'nose_tip': sh.V(-1.0, -46.5, -30.0), 'upper_lip': sh.V(0.0, -32.5, -54.5),
         'eye_R_cornea': face.E[1] + sh.V(0, -12.9, 0), 'eye_L_cornea': face.E[0] + sh.V(0, -12.9, 0),
         'split_lip': sh.V(7.0, -33.0, -64.0), 'thumb_bruise': face.skin_radial(40.0, -96.0)[0],
         'fingertips': face.skin_radial(-22.0, -101.0)[0], 'brow_scar': sh.V(-27.0, -20.0, 18.0),
         'cut_front': face.skin_radial(0.0, -124.0)[0], 'trachea': sh.V(0.0, 13.5, -131.0),
         'cheek_scar': face.skin_radial(31.0, -24.0)[0] + sh.V(0.0, 0.0, -10.0), 'forehead': sh.V(0.0, -23.0, 40.0),
         'chin': sh.V(0.0, -29.0, -95.0)}
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
