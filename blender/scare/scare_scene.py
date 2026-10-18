"""JUMPSCARE (#147) — Blender side of the scare head: meshes (cached), materials, hair curves, eyes, teeth, the
player's torch and camera (docs/STATUS-jumpscare.md Spec §1-§2). Head space is mm in scare_head; Blender objects are in
METRES, parented to the `scare_pose` empty that places the head in front of the camera (hero pose: chin-up 20 deg,
yaw 8, roll 6).
"""
import hashlib
import math
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

from characters import mesher, sdf
from lib.scene import CACHE, log
from scare import scare_hair, scare_head as sh, scare_tex

SCARE_DIR = Path(__file__).resolve().parent
CACHE_DIR = CACHE / 'scare'
MM = 0.001


def src_hash(*names, extra=''):
    h = hashlib.sha256(extra.encode())
    for n in names:
        h.update((SCARE_DIR / n).read_bytes())
    return h.hexdigest()[:12]


# ------------------------------------------------------------------------------------------------ mesh utilities
def quads_edges(Q):
    E = np.concatenate([Q[:, [0, 1]], Q[:, [1, 2]], Q[:, [2, 3]], Q[:, [3, 0]]])
    E.sort(axis=1)
    return np.unique(E, axis=0)


def laplacian(P, E, lam):
    acc = np.zeros_like(P)
    cnt = np.zeros(len(P))
    np.add.at(acc, E[:, 0], P[E[:, 1]])
    np.add.at(acc, E[:, 1], P[E[:, 0]])
    np.add.at(cnt, E[:, 0], 1)
    np.add.at(cnt, E[:, 1], 1)
    return P + (acc / np.maximum(cnt, 1)[:, None] - P) * lam


def taubin(P, E, iters=2):
    for _ in range(iters):
        P = laplacian(P, E, 0.5)
        P = laplacian(P, E, -0.53)
    return P


def vertex_normals(P, Q):
    t1 = np.cross(P[Q[:, 1]] - P[Q[:, 0]], P[Q[:, 3]] - P[Q[:, 0]])
    t2 = np.cross(P[Q[:, 3]] - P[Q[:, 2]], P[Q[:, 1]] - P[Q[:, 2]])
    fn = t1 + t2
    N = np.zeros_like(P)
    for k in range(4):
        np.add.at(N, Q[:, k], fn)
    return N / np.maximum(np.linalg.norm(N, axis=1), 1e-12)[:, None]


def sdf_mesh(fn, lo, hi, h, smooth=2):
    V, Q = mesher.surface_nets(fn, lo, hi, h, log=log)
    # weld duplicates (surface nets emits unique verts per cell, but guard), relax + re-project
    E = quads_edges(Q)
    for _ in range(smooth):
        V = taubin(V, E, 2)
        V = sdf.project(fn, V, iters=2, max_move=h)
    return V, Q


def recalc_normals(me):
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.update()


def make_mesh(name, V, Q, coll=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(V.tolist(), [], Q.tolist())
    me.validate()
    recalc_normals(me)
    n = len(me.polygons)
    me.polygons.foreach_set('use_smooth', np.ones(n, bool))
    ob = bpy.data.objects.new(name, me)
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob


def set_attr(me, name, vals, kind='FLOAT'):
    if kind == 'FLOAT_COLOR':
        a = me.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
        rgba = np.ones((len(vals), 4), np.float32)
        rgba[:, :3] = vals
        a.data.foreach_set('color', rgba.ravel())
    else:
        a = me.attributes.new(name, 'FLOAT', 'POINT')
        a.data.foreach_set('value', np.asarray(vals, np.float32))


# ------------------------------------------------------------------------------------------------ head
HEAD_LO = (-82.0, -62.0, -150.0)
HEAD_HI = (82.0, 152.0, 124.0)


def head_arrays(face, h, spasm_deg, rebuild=False):
    key = src_hash('scare_head.py', 'scare_tex.py', extra=f'{h}-{face.jaw}-{spasm_deg}')
    path = CACHE_DIR / f'head_{key}.npz'
    if path.exists() and not rebuild:
        log(f'scare head: cached {path.name}')
        z = np.load(path)
        return {k: z[k] for k in z.files}
    t0 = time.perf_counter()

    def fn(X):
        Xr, _ = face.to_rest(X)
        return face.rest(Xr)
    V, Q = sdf_mesh(fn, HEAD_LO, HEAD_HI, h)
    log(f'scare head: meshed {len(V)} verts {len(Q)} quads at h {h} mm in {time.perf_counter() - t0:.1f} s')
    Pr, w = face.to_rest(V)
    N = vertex_normals(V, Q)
    F = scare_tex.fields(face, Pr, N)
    V = V + N * F['disp'][:, None]                       # fine sculpt: creases, scars, swelling (mm along N)
    # shape key: the jaw spasm (the lower face rotates a further spasm_deg about the TMJ axis)
    w = face.jaw_weight(V)
    Vs = face.rotate_jaw(V, w, spasm_deg)
    out = dict(V=V, Q=Q, Vs=Vs, w=w, **{k: v for k, v in F.items()})
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, **out)
    log(f'scare head: fields + cache in {time.perf_counter() - t0:.1f} s total')
    return out


def build_head(face, h, spasm_deg, parent, rebuild=False):
    A = head_arrays(face, h, spasm_deg, rebuild)
    ob = make_mesh('scare_head', A['V'] * MM, A['Q'])
    me = ob.data
    set_attr(me, 'alb', A['alb'], 'FLOAT_COLOR')
    for k in ('rough', 'wet', 'sss', 'pore', 'pet', 'lip', 'muc', 'cap', 'blood', 'mar', 'w_h', 'w_v', 'w_c', 'w_d', 'pbig', 'scar'):
        set_attr(me, k, A[k])
    set_attr(me, 'bru', A['bru'] if 'bru' in A else np.zeros(len(A['V'])))     # #147e r18: bruise mask (shader mottle)
    rp = me.attributes.new('rp', 'FLOAT_VECTOR', 'POINT')     # #147d: basis position = the shader's texture coordinate
    rp.data.foreach_set('vector', (A['V'] * MM).astype(np.float32).ravel())
    ob.shape_key_add(name='Basis', from_mix=False)
    k = ob.shape_key_add(name='spasm', from_mix=False)
    k.data.foreach_set('co', (A['Vs'] * MM).astype(np.float32).ravel())
    k.value = 0.0          # Blender 5.2 creates keys at value 1.0 (#147c: every hero still r1-r8 had the spasm on)
    ob.parent = parent
    return ob, A


def build_teeth(face, spasm_deg, parent, rebuild=False):
    key = src_hash('scare_head.py', extra=f'teeth-{face.jaw}-{spasm_deg}')
    path = CACHE_DIR / f'teeth_{key}.npz'
    if path.exists() and not rebuild:
        z = np.load(path)
        A = {k: z[k] for k in z.files}
    else:
        Vu, Qu = sdf_mesh(lambda X: face.teeth(X, lower=False), (-30, -36, -66), (30, 6, -44), 0.22, smooth=1)
        Vl, Ql = sdf_mesh(lambda X: face.teeth(X, lower=True), (-30, -34, -74), (30, 8, -54), 0.22, smooth=1)
        one = np.ones(len(Vl))
        VlO = face.rotate_jaw(Vl, one, face.jaw)
        VlS = face.rotate_jaw(VlO, one, spasm_deg)           # composed exactly like the head's spasm key
        A = dict(Vu=Vu, Qu=Qu, Vl=VlO, Vls=VlS, Ql=Ql, zu=Vu[:, 2], zl=Vl[:, 2])
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(path, **A)
    up = make_mesh('scare_teeth_up', A['Vu'] * MM, A['Qu'])
    lo = make_mesh('scare_teeth_lo', A['Vl'] * MM, A['Ql'])
    # cervical stain: 0 at the incisal edge -> 1 at the gum line (crown heights ~10 mm)
    set_attr(up.data, 'cerv', np.clip((A['zu'] + 61.6) / 10.0, 0, 1))
    set_attr(lo.data, 'cerv', np.clip((-59.6 - A['zl']) / 9.0, 0, 1))
    lo.shape_key_add(name='Basis', from_mix=False)
    k = lo.shape_key_add(name='spasm', from_mix=False)
    k.data.foreach_set('co', (A['Vls'] * MM).astype(np.float32).ravel())
    k.value = 0.0
    for o in (up, lo):
        o.parent = parent
    return up, lo


def _eye_frame_dirs(ang_deg, psi_deg):
    """Unit directions in the eye-local frame (x = +x head, y = head y, z = up) for polar angle `ang` about the visual
    axis (0, -1, 0) and roll `psi` (0 = +x)."""
    a, p = np.radians(ang_deg), np.radians(psi_deg)
    return np.stack([np.sin(a) * np.cos(p), -np.cos(a), np.sin(a) * np.sin(p)], -1)


def _polar_mesh(rings_ang, nseg, radius_fn, pole=True):
    """Closed-ish polar grid (rings of constant `ang`, nseg segments) with a fan at ang 0; returns (P (n,3), faces)."""
    psi = np.arange(nseg) * (360.0 / nseg)
    A, Ps = np.meshgrid(rings_ang, psi, indexing='ij')
    D = _eye_frame_dirs(A, Ps)
    R = radius_fn(A)
    P = (D * R[..., None]).reshape(-1, 3)
    faces = []
    nr = len(rings_ang)
    for j in range(nr - 1):
        for i in range(nseg):
            a0, a1 = j * nseg + i, j * nseg + (i + 1) % nseg
            b0, b1 = (j + 1) * nseg + i, (j + 1) * nseg + (i + 1) % nseg
            faces.append([a0, b0, b1, a1])
    if pole:
        c = len(P)
        P = np.concatenate([P, [_eye_frame_dirs(np.array(0.0), np.array(0.0)) * radius_fn(np.array(0.0))]])
        for i in range(nseg):
            faces.append([c, i, (i + 1) % nseg])
    return P, faces


def _eye_uv(me, P, s):
    """Equirect (azimuth, elevation) UV, lateral to the right in both eyes (u = 0.5 + az/2pi)."""
    uv = me.uv_layers.new(name='UVMap')
    loops_v = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get('vertex_index', loops_v)
    Pl = P[loops_v]
    a_l = np.arctan2(s * Pl[:, 0], -Pl[:, 1])
    e_l = np.arcsin(np.clip(Pl[:, 2] / np.maximum(np.linalg.norm(Pl, axis=1), 1e-9), -1, 1))
    uv.data.foreach_set('uv', np.stack([0.5 + a_l / (2 * math.pi), 0.5 + e_l / math.pi], 1).astype(np.float32).ravel())


def _mesh_obj(name, P, faces, parent, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata((P * MM).tolist(), [], faces)
    me.validate()
    recalc_normals(me)
    me.polygons.foreach_set('use_smooth', np.full(len(me.polygons), smooth))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    return ob


# #147e: r9-r13 recessed an iris plane behind a dome whose FRONT carried the clouding (glass/milk mix): the material
# boundary at the dome rim stayed a crisp disc outline = the contact lens. The brief asks for iris-less milky eyes: the
# clouding is now painted on the globe sphere (soft 1.4 mm fade across the limbus, patchy, a faint pupil/iris shadow) and
# the dome is clear tear film + cornea (IOR 1.376): it adds only the wet specular, the catchlight and the bulge.
EYE_RECESS = False


def build_eyes(face, parent):
    """#147d: per eye (0 = her left, 1 = her right) three objects —
      * the globe: sclera sphere r 12 with the iris RECESSED to a plane 0.32 mm behind the limbal plane (the anterior
        chamber), equirect UV (eye_texture);
      * the cornea: a separate clear dome (7.8 mm sphere, limbus r 5.5 mm) closed by a flat back over the iris — the
        front refracts (IOR 1.376), the back and side are index-matched (Transparent: aqueous ~ cornea);
      * the haze: a frosted cap 0.35 mm inside the dome (post-mortem corneal clouding, irregular density).
    r1-r8 painted the clouding as a grey disc with a ring and a centre dot on the globe = a contact-lens bullseye."""
    globes, domes, hazes = [], [], []
    LA = sh.LIMBUS_ANG
    a_tr0 = math.degrees(math.atan(4.94 / sh.IRIS_Y))                  # 25.5 deg: iris plane edge (rho 4.94 mm)
    for k in (0, 1):
        E = face.E[k]
        s = 1.0 if k == 0 else -1.0
        rings = np.concatenate([np.linspace(0.0, LA + 3.0, 92)[1:], np.linspace(LA + 3.5, 179.0, 56)])

        def rglobe(A):
            A = np.asarray(A, float)
            if not EYE_RECESS:                 # #147e: a plain sphere under the clear dome (no iris-root crease)
                return np.full(A.shape, sh.R_GLOBE)
            plane = sh.IRIS_Y / np.cos(np.radians(np.minimum(A, 60.0)))
            t = np.clip((A - a_tr0) / (LA - a_tr0), 0.0, 1.0)
            t = t * t * (3.0 - 2.0 * t)
            return np.where(A < a_tr0, plane, np.where(A < LA, plane * (1.0 - t) + sh.R_GLOBE * t, sh.R_GLOBE))
        P, F = _polar_mesh(rings, 144, rglobe)
        ob = _mesh_obj(f'scare_eye{k}', P + E, F, parent)
        _eye_uv(ob.data, P, s)
        globes.append(ob)
        # ---- the cornea dome: cap on the cornea sphere (centre CORNEA_OFF ahead) out to the limbus, then a cone down to a
        # flat back disc 0.03 mm over the iris plane; material slot 0 = front (glass), 1 = back/side (index-matched)
        c = np.array([0.0, -sh.CORNEA_OFF, 0.0])
        # r13: the cap runs 1.7 deg PAST the limbus so its rim sinks 0.07 mm into the sclera — r9-r12 stopped exactly at
        # the limbus (+0.02 mm proud) with a transparent side wall, and the gap showed the dark iris root as a crisp
        # outline round the milky disc; now the visible edge is the dome/sclera intersection itself
        bl = math.degrees(math.asin(sh.LIMBUS_R / sh.CORNEA_R)) + 1.7
        nseg = 144
        betas = np.linspace(0.0, bl, 40)[1:]
        psi = np.arange(nseg) * (360.0 / nseg)
        B, Ps = np.meshgrid(betas, psi, indexing='ij')
        front = (c + _eye_frame_dirs(B, Ps) * sh.CORNEA_R).reshape(-1, 3)
        apex = c + np.array([0.0, -sh.CORNEA_R, 0.0])
        rb, yb = 4.90, -(sh.IRIS_Y + 0.03)
        pr = np.radians(psi)
        rim = front[-nseg:]
        mid = np.stack([np.cos(pr) * 5.3, np.full(nseg, 0.5 * (rim[0, 1] + yb)), np.sin(pr) * 5.3], 1)   # under the sclera
        back = np.stack([np.cos(pr) * rb, np.full(nseg, yb), np.sin(pr) * rb], 1)
        Pd = np.concatenate([front, mid, back, [apex], [[0.0, yb, 0.0]]])
        nf = len(betas)
        Fd, mats = [], []
        for j in range(nf - 1):
            for i in range(nseg):
                a0, a1 = j * nseg + i, j * nseg + (i + 1) % nseg
                b0, b1 = (j + 1) * nseg + i, (j + 1) * nseg + (i + 1) % nseg
                Fd.append([a0, b0, b1, a1]); mats.append(0)
        ia = len(Pd) - 2
        ib = len(Pd) - 1
        for i in range(nseg):
            Fd.append([ia, i, (i + 1) % nseg]); mats.append(0)
        o_rim, o_mid, o_back = (nf - 1) * nseg, nf * nseg, (nf + 1) * nseg
        for i in range(nseg):
            i1 = (i + 1) % nseg
            Fd.append([o_rim + i, o_mid + i, o_mid + i1, o_rim + i1]); mats.append(1)
            Fd.append([o_mid + i, o_back + i, o_back + i1, o_mid + i1]); mats.append(1)
            Fd.append([o_back + i1, o_back + i, ib]); mats.append(1)
        od = _mesh_obj(f'scare_cornea{k}', Pd + E, Fd, parent)
        od.data.polygons.foreach_set('material_index', np.array(mats, np.int32))
        domes.append(od)
        # ---- haze cap 0.25 mm inside the front, out to where it would leave the dome (axial LIMBUS_Y - 0.03, rho 5.17)
        rh = sh.CORNEA_R - 0.25
        bh = math.degrees(math.acos(np.clip((sh.LIMBUS_Y - 0.03 - sh.CORNEA_OFF) / rh, -1, 1)))
        Bh, Ph = np.meshgrid(np.linspace(0.0, bh, 30)[1:], psi, indexing='ij')
        Phz = (c + _eye_frame_dirs(Bh, Ph) * rh).reshape(-1, 3)
        Phz = np.concatenate([Phz, [c + np.array([0.0, -rh, 0.0])]])
        Fh = []
        nh = Bh.shape[0]
        for j in range(nh - 1):
            for i in range(nseg):
                a0, a1 = j * nseg + i, j * nseg + (i + 1) % nseg
                b0, b1 = (j + 1) * nseg + i, (j + 1) * nseg + (i + 1) % nseg
                Fh.append([a0, b0, b1, a1])
        for i in range(nseg):
            Fh.append([len(Phz) - 1, i, (i + 1) % nseg])
        oh = _mesh_obj(f'scare_haze{k}', Phz + E, Fh, parent)
        hazes.append(oh)
    return globes, domes, hazes


def eye_texture(k, W=2048, H=1024, seed=71):
    """#147d rebuild. Equirect albedo (u = azimuth, lateral to the right; v = elevation) + aux (R = tear-film coat
    weight, G = height for bump). Dead, dry-edged eye: dull ivory-grey sclera, diffusely injected conjunctiva (pink-red,
    densest at the fornices and canthi), a branching radial vessel net (0.05-0.15 mm), CLUSTERED petechiae of irregular
    size/opacity (asphyxia), a raised soft-edged subconjunctival haemorrhage at her right lateral canthus (k = 1),
    tache noire (dried brown band) on the exposed sclera; the IRIS (behind the clear dome, ghosted by the haze): dead
    grey-brown radial stroma, a mid-dilated slightly oval pupil. No painted cornea, no rings."""
    from lib import noise
    from lib.noise import smoothstep as ss
    rng = np.random.default_rng(seed + k)
    u = (np.arange(W) + 0.5) / W
    v = (np.arange(H) + 0.5) / H
    U, Vv = np.meshgrid(u, v)
    az = ((U - 0.5) * 360.0).ravel()
    el = ((Vv - 0.5) * 180.0).ravel()
    A, Lr = np.radians(az), np.radians(el)
    D = np.stack([np.sin(A) * np.cos(Lr), -np.cos(A) * np.cos(Lr), np.sin(Lr)], -1)
    ang = np.degrees(np.arccos(np.clip(-D[:, 1], -1, 1)))           # angle from the visual axis
    psi = np.arctan2(D[:, 2], D[:, 0])                               # roll about the axis
    P = D * 12.0
    n = len(D)
    # ---- sclera + conjunctiva
    alb = np.array([0.28, 0.262, 0.222])[None, :] * (1.0 + 0.07 * noise.fbm(P / 3.0, 3, seed))[:, None]   # #147e: 0.37 glowed
    alb = alb * (1.0 + 0.05 * noise.fbm(P / 0.9, 2, seed + 20))[:, None]
    LIMBUS = sh.LIMBUS_ANG + 0.6
    conj = ss(LIMBUS, LIMBUS + 2.0, ang)
    alb = alb * (1.0 - 0.10 * (1.0 - ss(LIMBUS, LIMBUS + 6.0, ang)))[:, None]          # thin, grey-blue near the limbus
    # r12: a soft grey-blue limbal band just outside the dome rim, so the milky cornea melts into the sclera (r10-r11:
    # the rim crease read as a crisp dark outline round a disc)
    lb = (1.0 - ss(0.0, 2.2, ang - sh.LIMBUS_ANG)) * ss(-0.4, 0.2, ang - sh.LIMBUS_ANG)
    alb = alb + (np.array([0.40, 0.42, 0.44]) - alb) * (0.7 * lb)[:, None]
    fornix = ss(35.0, 75.0, ang) * (0.55 + 0.45 * ss(8.0, 30.0, np.abs(el))) + 0.5 * ss(45.0, 75.0, np.abs(az)) * ss(30.0, 50.0, ang)
    inj = np.clip(fornix, 0, 1) * (0.65 + 0.35 * ss(-0.4, 0.4, noise.fbm(P / 2.2, 3, seed + 21)))
    alb = alb + (np.array([0.46, 0.19, 0.16]) - alb) * (0.55 * inj * conj)[:, None]
    # vessels (r9 texture look: thresholded ridged noise read as brush hatching): explicit tortuous random walks from
    # the fornices toward the limbus, branching, 0.15 -> 0.05 mm wide (0.7 -> 0.25 deg on the 12 mm globe), fading out
    # 2-10 deg before the limbus; drawn as soft lines in local texel windows
    vm = np.zeros((H, W))
    def _dir(an, ps):
        a_, p_ = math.radians(an), ps
        d = np.array([math.sin(a_) * math.cos(p_), -math.cos(a_), math.sin(a_) * math.sin(p_)])
        return math.degrees(math.atan2(d[0], -d[1])), math.degrees(math.asin(max(-1.0, min(1.0, d[2]))))
    stack = []
    for _ in range(46):
        stack.append([rng.uniform(62.0, 88.0), rng.uniform(-math.pi, math.pi), rng.uniform(-0.15, 0.15),
                      rng.uniform(0.45, 0.75), rng.uniform(0.55, 0.85), LIMBUS + rng.uniform(2.0, 11.0)])
    nseg_v = 0
    while stack and nseg_v < 9000:
        an, ps, hd, wdt, op, stop = stack.pop()
        while an > stop and wdt > 0.18:
            st = rng.uniform(0.6, 1.2)
            hd = float(np.clip(hd + rng.normal(0.0, 0.22), -0.9, 0.9))         # tortuous heading (rad off radial)
            an2 = an - st * math.cos(hd)
            ps2 = ps + st * math.sin(hd) / max(math.sin(math.radians(an)) * 57.3, 1e-3) * 1.0
            a_0, e_0 = _dir(an, ps)
            a_1, e_1 = _dir(an2, ps2)
            if abs(a_1 - a_0) < 30.0:
                ce = math.cos(math.radians(0.5 * (e_0 + e_1)))
                ia0 = int(max(0, (min(a_0, a_1) - 2 * wdt + 180.0) / 360.0 * W))
                ia1 = int(min(W, (max(a_0, a_1) + 2 * wdt + 180.0) / 360.0 * W + 2))
                ie0 = int(max(0, (min(e_0, e_1) - 2 * wdt + 90.0) / 180.0 * H))
                ie1 = int(min(H, (max(e_0, e_1) + 2 * wdt + 90.0) / 180.0 * H + 2))
                if ia1 > ia0 and ie1 > ie0:
                    gx = ((np.arange(ia0, ia1) + 0.5) / W * 360.0 - 180.0 - a_0) * ce
                    gy = (np.arange(ie0, ie1) + 0.5) / H * 180.0 - 90.0 - e_0
                    GX, GY = np.meshgrid(gx, gy)
                    bx, by = (a_1 - a_0) * ce, e_1 - e_0
                    tt = np.clip((GX * bx + GY * by) / max(bx * bx + by * by, 1e-9), 0.0, 1.0)
                    dd = np.hypot(GX - tt * bx, GY - tt * by)
                    fade = min(1.0, (an - stop) / 6.0)
                    vm[ie0:ie1, ia0:ia1] = np.maximum(vm[ie0:ie1, ia0:ia1], op * fade * (1.0 - ss(0.25 * wdt, 0.55 * wdt, dd)))
                nseg_v += 1
            if rng.random() < 0.09:
                stack.append([an2, ps2, hd + rng.choice([-1.0, 1.0]) * rng.uniform(0.35, 0.8), wdt * 0.66, op * 0.85, stop + rng.uniform(0.0, 6.0)])
            an, ps = an2, ps2
            wdt *= 0.993
    vmask = vm.ravel() * conj
    alb = alb + (np.array([0.26, 0.022, 0.028]) - alb) * vmask[:, None]
    v1 = vmask
    vden = ss(LIMBUS + 2.0, LIMBUS + 25.0, ang) * conj
    v2 = ss(0.80, 0.92, noise.ridged(np.stack([psi * 70.0, np.radians(ang) * 11.0, np.ones(n) * 3.0], 1) + noise.fbm(P / 1.5, 2, seed + 23)[:, None] * 0.5, 3, seed + 3))
    alb = alb + (np.array([0.36, 0.06, 0.05]) - alb) * (0.25 * v2 * vden * (0.4 + 0.6 * inj))[:, None]
    # petechiae: clusters (lower bulbar + canthi), irregular specks 0.05-0.25 mm (0.25-1.2 deg), some merging
    hgt = 0.08 * (v1 + 0.5 * v2) * vden
    nc = 16
    pert = 1.0 + 0.35 * noise.perlin(P / 0.35, seed + 30)               # irregular speck outlines (one field, reused)
    alb2 = alb.reshape(H, W, 3)
    ok2 = (conj * (ang > LIMBUS + 1.5)).reshape(H, W)
    pert2 = pert.reshape(H, W)
    for i in range(nc):
        a0 = float(rng.choice([-1.0, 1.0])) * rng.uniform(32.0, 72.0)
        e0 = float(np.clip(rng.normal(-12.0, 11.0), -30.0, 18.0))
        for _ in range(int(rng.integers(4, 16))):
            ca = a0 + rng.normal(0.0, 2.6)
            ce = e0 + rng.normal(0.0, 2.0)
            r0 = rng.uniform(0.2, 0.8) * (1.0 + 1.4 * (rng.random() < 0.1))
            # local texel window only (the speck is < 3.5 deg)
            ia0 = int(max(0, (ca - 3 * r0 / max(math.cos(math.radians(ce)), 0.2) + 180.0) / 360.0 * W))
            ia1 = int(min(W, (ca + 3 * r0 / max(math.cos(math.radians(ce)), 0.2) + 180.0) / 360.0 * W + 2))
            ie0 = int(max(0, (ce - 3 * r0 + 90.0) / 180.0 * H))
            ie1 = int(min(H, (ce + 3 * r0 + 90.0) / 180.0 * H + 2))
            if ia1 <= ia0 or ie1 <= ie0:
                continue
            azw = (np.arange(ia0, ia1) + 0.5) / W * 360.0 - 180.0
            elw = (np.arange(ie0, ie1) + 0.5) / H * 180.0 - 90.0
            AZw, ELw = np.meshgrid(azw, elw)
            dd = np.sqrt(((AZw - ca) * np.cos(np.radians(ce))) ** 2 + (ELw - ce) ** 2) * pert2[ie0:ie1, ia0:ia1]
            m = (1.0 - ss(r0 * 0.45, r0, dd)) * rng.uniform(0.45, 1.0) * ok2[ie0:ie1, ia0:ia1]
            col = np.array([0.22, 0.014, 0.018]) * rng.uniform(0.55, 1.0)
            win = alb2[ie0:ie1, ia0:ia1]
            alb2[ie0:ie1, ia0:ia1] = win + (col - win) * m[..., None]
    alb = alb2.reshape(-1, 3)
    if k == 1:
        # subconjunctival haemorrhage at her right lateral canthus: dense centre, feathered irregular edge, raised
        # a flat, near-uniform bright-red sheet with an irregular but fairly crisp edge (blood under the conjunctiva),
        # not a fuzzy cloud
        dd = np.sqrt(((az - 63.0) / 17.0) ** 2 + ((el + 3.0) / 12.0) ** 2)
        dd = dd * (1.0 + 0.40 * noise.fbm(P / 1.8, 3, seed + 5)) + 0.06 * noise.fbm(P / 0.4, 2, seed + 6)
        m = (1.0 - ss(0.88, 1.0, dd)) * conj
        alb = alb + (np.array([0.27, 0.014, 0.016]) * (0.9 + 0.1 * noise.fbm(P / 0.8, 2, seed + 7))[:, None] - alb) * m[:, None]
        hgt = hgt + 0.6 * (1.0 - ss(0.5, 1.0, dd)) * conj
    # tache noire: the sclera left exposed between the open lids dries brown-black, either side of the cornea
    tn = ss(LIMBUS + 2.0, LIMBUS + 7.0, ang) * ss(80.0, 62.0, np.abs(az)) * (1.0 - ss(5.0, 11.0, np.abs(el + 2.5)))
    tn = tn * ss(-0.35, 0.35, noise.fbm(P / 2.0, 3, seed + 9))
    alb = alb + (np.array([0.17, 0.11, 0.075]) - alb) * (0.55 * tn)[:, None]
    coat = np.clip(1.0 - 0.75 * tn, 0.0, 1.0) * conj
    if not EYE_RECESS:
        # #147e: post-mortem corneal clouding painted on the sphere (the clear dome above carries the gloss): grey-blue
        # milk, patchy (1-3 mm), fading across the limbus over ~1.4 mm into the grey limbal band; under it only a faint
        # blurred shadow of the pupil and iris (the brief: iris-less) — no ring, no centre dot, no crisp edge
        rho_g = 12.0 * np.sin(np.radians(np.minimum(ang, 90.0)))
        mk = 1.0 - ss(sh.LIMBUS_ANG - 3.5, sh.LIMBUS_ANG + 3.5, ang + 1.2 * noise.fbm(P / 1.2, 2, seed + 50))
        # r16: r15's milk (0.40-0.45, density 0.8-1) glowed as blank white discs brighter than the sclera; a dead
        # clouded cornea is a grey translucent film with the dark iris/pupil still dimly behind it
        dens = np.clip(0.62 + 0.26 * noise.fbm(P / 1.6, 3, seed + 51) + 0.06 * noise.fbm(P / 0.35, 2, seed + 52), 0.40, 0.92)
        milk = np.array([0.27, 0.29, 0.31])[None, :] * (1.0 + 0.05 * noise.fbm(P / 0.6, 2, seed + 53))[:, None]
        under = np.array([0.10, 0.10, 0.105])[None, :] * (1.0 - 0.5 * (1.0 - ss(1.6, 3.4, rho_g + 0.5 * noise.fbm(P / 1.0, 2, seed + 54))))[:, None]
        corn = under + (milk - under) * dens[:, None]
        alb = alb + (corn - alb) * mk[:, None]
        aux = np.stack([coat * (1.0 - mk), np.clip(hgt, 0, 1) * (1.0 - mk), np.zeros(n)], 1)
        return np.clip(alb.reshape(H, W, 3), 0.0, 1.0), aux.reshape(H, W, 3)
    # ---- iris on the recessed plane (rho = IRIS_Y tan(ang)); dead grey-brown, radial stroma, crypts, oval pupil
    rho = sh.IRIS_Y * np.tan(np.radians(np.minimum(ang, 60.0)))
    iris_m = 1.0 - conj
    fib = noise.ridged(np.stack([psi * 22.0, rho * 0.35, np.full(n, 5.0)], 1), 3, seed + 40)
    fib2 = noise.fbm(np.stack([psi * 60.0, rho * 1.2, np.full(n, 9.0)], 1), 2, seed + 41)
    ir = np.array([0.075, 0.060, 0.048]) * (0.8 + 0.5 * ss(0.55, 0.9, fib) + 0.15 * fib2)[:, None]
    coll = np.exp(-((rho - (3.55 + 0.25 * noise.perlin(np.stack([np.cos(psi) * 2, np.sin(psi) * 2, np.zeros(n)], 1), seed + 42))) / 0.35) ** 2)
    ir = ir * (1.0 + 0.35 * coll)[:, None]
    crypt = ss(0.62, 0.8, noise.perlin(np.stack([psi * 9.0, rho * 1.4, np.zeros(n)], 1), seed + 43)) * ss(2.8, 3.4, rho) * ss(5.0, 4.3, rho)
    ir = ir * (1.0 - 0.45 * crypt)[:, None]
    ir = ir * (1.0 - 0.10 * ss(4.4, 5.2, rho))[:, None]                    # r10: barely darker periphery (r9: a ring)
    rp = 2.55 * (1.0 + 0.07 * np.cos(2.0 * psi + 0.5) + 0.04 * noise.perlin(np.stack([np.cos(psi) * 3, np.sin(psi) * 3, np.ones(n)], 1), seed + 44))
    pup = 1.0 - ss(rp - 0.12, rp + 0.12, rho)
    ir = ir + (np.array([0.012, 0.011, 0.011]) - ir) * pup[:, None]
    alb = alb * (1.0 - iris_m)[:, None] + ir * iris_m[:, None]
    aux = np.stack([coat, np.clip(hgt, 0, 1), np.zeros(n)], 1)
    return np.clip(alb.reshape(H, W, 3), 0.0, 1.0), aux.reshape(H, W, 3)


def image_from(name, arr, colorspace='Linear Rec.709'):
    H, W, _ = arr.shape
    im = bpy.data.images.new(name, W, H, alpha=False, float_buffer=True)
    # colour space FIRST: changing it on a GENERATED image regenerates the buffer, so pixels set before it were lost
    # (r1: the eye albedo read back as all zeros -> black globes with only a catchlight)
    try:
        im.colorspace_settings.name = colorspace
    except Exception:
        pass
    rgba = np.ones((H, W, 4), np.float32)
    rgba[..., :3] = arr
    im.pixels.foreach_set(rgba.ravel())
    im.update()
    return im


def hair_object(name, S, R, mat, parent):
    S = np.asarray(S, np.float32) * MM
    R = np.asarray(R, np.float32) * MM
    K, NP, _ = S.shape
    cv = bpy.data.hair_curves.new(name)
    cv.add_curves([NP] * K)
    cv.attributes['position'].data.foreach_set('vector', S.reshape(-1))
    ra = cv.attributes.get('radius') or cv.attributes.new('radius', 'FLOAT', 'POINT')
    ra.data.foreach_set('value', R.reshape(-1))
    ob = bpy.data.objects.new(name, cv)
    bpy.context.scene.collection.objects.link(ob)
    cv.materials.append(mat)
    ob.parent = parent
    return ob


def hair_arrays(face, g, n_guides, children, rebuild=False):
    key = src_hash('scare_head.py', 'scare_hair.py', extra=f'{n_guides}-{children}-{np.round(g, 4).tolist()}-{face.jaw}')
    path = CACHE_DIR / f'hair_{key}.npz'
    if path.exists() and not rebuild:
        z = np.load(path)
        return {k: z[k] for k in z.files}
    t0 = time.perf_counter()
    S1, R1 = scare_hair.scalp(face, g, n_guides, children)
    S2, R2 = scare_hair.face_strands(face, g)
    S3, R3 = scare_hair.lashes(face)
    S4, R4 = scare_hair.brows(face)
    A = dict(S1=S1, R1=R1, S2=S2, R2=R2, S3=S3, R3=R3, S4=S4, R4=R4)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, **A)
    log(f'scare hair: {len(S1)} scalp + {len(S2)} face + {len(S3)} lashes + {len(S4)} brows in {time.perf_counter() - t0:.1f} s')
    return A


# ------------------------------------------------------------------------------------------------ materials
def _nodes(mat):
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    return nt, nt.nodes, nt.links


def _attr(nodes, name, x=-1200, y=0):
    a = nodes.new('ShaderNodeAttribute')
    a.attribute_name = name
    a.location = (x, y)
    return a


def _math(nodes, links, op, *args, x=0, y=0, clamp=False):
    """Math node; positional args = inputs (sockets or numbers); trailing 2 ints are NOT locations (use x=, y=)."""
    m = nodes.new('ShaderNodeMath')
    m.operation = op
    m.use_clamp = clamp
    m.location = (x, y)
    for i, v in enumerate(args):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            m.inputs[i].default_value = float(v)
        else:
            links.new(v, m.inputs[i])
    return m.outputs[0]


def _sock(coll, name, typ):
    return next(s for s in coll if s.name == name and s.type == typ)


def _mixc(nodes, links, a, b, fac, blend='MIX'):
    """RGBA Mix node (typed sockets: ShaderNodeMix has float/vector/colour sockets sharing names)."""
    m = nodes.new('ShaderNodeMix')
    m.data_type = 'RGBA'
    m.blend_type = blend
    for nm, v in (('A', a), ('B', b)):
        sk = _sock(m.inputs, nm, 'RGBA')
        if isinstance(v, (tuple, list)):
            sk.default_value = (*v[:3], 1.0)
        else:
            links.new(v, sk)
    fk = _sock(m.inputs, 'Factor', 'VALUE')
    if isinstance(fac, (int, float)):
        fk.default_value = float(fac)
    else:
        links.new(fac, fk)
    return _sock(m.outputs, 'Result', 'RGBA')


def _noise(N, L, coord, scale, detail=2.0, rough=0.5, offset=None, x=0, y=0):
    """Noise Texture Fac on `coord` (optionally offset by a constant vector, a cheap 'seed')."""
    if offset is not None:
        va = N.new('ShaderNodeVectorMath')
        va.operation = 'ADD'
        L.new(coord, va.inputs[0])
        va.inputs[1].default_value = offset
        coord = va.outputs['Vector']
    nz = N.new('ShaderNodeTexNoise')
    nz.location = (x, y)
    nz.inputs['Scale'].default_value = scale
    nz.inputs['Detail'].default_value = detail
    nz.inputs['Roughness'].default_value = rough
    L.new(coord, nz.inputs['Vector'])
    return nz.outputs['Fac']


def _mrange(N, L, val, a, b, c=0.0, d=1.0, smooth=True):
    m = N.new('ShaderNodeMapRange')
    m.interpolation_type = 'SMOOTHSTEP' if smooth else 'LINEAR'
    m.clamp = True
    L.new(val, m.inputs['Value'])
    m.inputs['From Min'].default_value = a
    m.inputs['From Max'].default_value = b
    m.inputs['To Min'].default_value = c
    m.inputs['To Max'].default_value = d
    return m.outputs['Result']


def _lines(N, L, phi_mm, lam, coord, k, width=0.16, distort=1.6, seg=1100.0):
    """Fine wrinkle lines across the phase field phi (mm): grooves every `lam` mm, wobbling (2.5 mm noise shifts the
    phase), broken into 1-3 mm segments and varying in depth. Returns 0..~1.4 (groove strength)."""
    off = (13.1 * k, 7.7 * k, 3.3 * k)
    dn = _noise(N, L, coord, 400.0, 2.0, 0.5, offset=off)
    s = _math(N, L, 'MULTIPLY_ADD', _math(N, L, 'SUBTRACT', dn, 0.5), distort, _math(N, L, 'DIVIDE', phi_mm, lam))
    tri = _math(N, L, 'PINGPONG', s, 0.5)                                   # 0 on a line, 0.5 between lines
    g = _mrange(N, L, tri, 0.0, width, 1.0, 0.0)
    mask = _mrange(N, L, _noise(N, L, coord, seg, 2.0, 0.5, offset=(off[1], off[2], off[0])), 0.47, 0.63)   # #147e: ~0.9 mm broken segments
    depth = _math(N, L, 'MULTIPLY_ADD', _noise(N, L, coord, 180.0, 1.0, 0.5, offset=(off[2], off[0], off[1])), 1.2, -0.05)
    return _math(N, L, 'MULTIPLY', _math(N, L, 'MULTIPLY', g, mask), depth)


def _mrange_mix(N, L, a, b_const, fac):
    """a * (1 - fac) + b_const * fac (float lerp)."""
    return _math(N, L, 'ADD', _math(N, L, 'MULTIPLY', a, _math(N, L, 'SUBTRACT', 1.0, fac)), _math(N, L, 'MULTIPLY', fac, b_const))


def _pores(N, L, coord, scale, dens, rmin, rspan, depth):
    """Irregular pores: Voronoi F1 cells, a random subset (cell colour R < dens) dimpled with a random radius and depth
    (r1-r8: every cell dimpled the same = a lattice)."""
    vo = N.new('ShaderNodeTexVoronoi')
    vo.voronoi_dimensions = '3D'
    vo.feature = 'F1'
    vo.inputs['Scale'].default_value = scale
    vo.inputs['Randomness'].default_value = 1.0
    L.new(coord, vo.inputs['Vector'])
    sp = N.new('ShaderNodeSeparateColor')
    L.new(vo.outputs['Color'], sp.inputs['Color'])
    sel = _math(N, L, 'LESS_THAN', sp.outputs['Red'], dens)
    rad = _math(N, L, 'MULTIPLY_ADD', sp.outputs['Green'], rspan, rmin)
    t = _math(N, L, 'SUBTRACT', 1.0, _math(N, L, 'DIVIDE', vo.outputs['Distance'], rad), clamp=True)
    t = _math(N, L, 'MULTIPLY', t, t)
    dep = _math(N, L, 'MULTIPLY_ADD', sp.outputs['Blue'], depth * 0.8, depth * 0.4)
    return _math(N, L, 'MULTIPLY', _math(N, L, 'MULTIPLY', t, sel), dep)


# #147e: skin shader tunables (the skin LAB, scratchpad fx2/lab_skin.py, overrides them per variant)
# r16: coarse pores 0.17-0.38 mm across on the nose / medial cheeks / chin (macerated, waterlogged skin swells the
# follicle mouths; r9-r15 0.13-0.27 mm were sub-pixel), deeper, + spotty specular roughness (+-0.1 at 1.4 mm)
SKIN = dict(pc_rmin=0.16, pc_rspan=0.20, pc_dens=0.85, pore_k=1.5, bump_mm=0.13, spot=0.10)


def skin_material(face=None):
    """Dead wet skin (#147d rebuild of the micro-relief): Principled RANDOM_WALK_SKIN, 2 mm SSS scale x per-vertex
    multiplier, per-vertex albedo/roughness. Micro-relief WITHOUT any cell lattice (r1-r8's Voronoi DISTANCE_TO_EDGE
    network at 0.9 mm read as crackle glaze): irregular pores at two scales (random subsets of jittered cells, random
    radius/depth, region density), fine wrinkle lines along Langer's lines in four phase families (H horizontal, V
    vertical, C radial about the lateral canthi, D oblique on the cheeks) at 0.55 and 1.25 mm spacing, wobbling and
    broken into segments, plus a faint isotropic criss-cross; lip fissures; water beads. The water film breaks into
    wet islands (coat on, roughness 0.03) and drying patches (coat off, roughness up). Texture coordinate = the
    vertex attribute `rp` (basis positions), so the micro-detail does not swim when the jaw shape key moves."""
    mat = bpy.data.materials.new('scare_skin')
    nt, N, L = _nodes(mat)
    out = N.new('ShaderNodeOutputMaterial')
    out.location = (900, 0)
    b = N.new('ShaderNodeBsdfPrincipled')
    b.location = (500, 0)
    b.subsurface_method = 'RANDOM_WALK_SKIN'
    L.new(b.outputs[0], out.inputs['Surface'])
    obj = _attr(N, 'rp', -1600, -400).outputs['Vector']
    alb = _attr(N, 'alb', -1200, 400).outputs['Color']
    rough = _attr(N, 'rough', -1200, 250).outputs['Fac']
    wet = _attr(N, 'wet', -1200, 100).outputs['Fac']
    sssm = _attr(N, 'sss', -1200, -50).outputs['Fac']
    pore = _attr(N, 'pore', -1200, -200).outputs['Fac']
    pet = _attr(N, 'pet', -1200, -350).outputs['Fac']
    lip = _attr(N, 'lip', -1200, -500).outputs['Fac']
    muc = _attr(N, 'muc', -1200, -650).outputs['Fac']
    cap = _attr(N, 'cap', -1200, -800).outputs['Fac']
    scar = _attr(N, 'scar', -1200, -950).outputs['Fac']
    pbig = _attr(N, 'pbig', -1200, -1100).outputs['Fac']
    W = {k: _attr(N, k, -1200, -1250 - 150 * i).outputs['Fac'] for i, k in enumerate(('w_h', 'w_v', 'w_c', 'w_d'))}
    tissue = _math(N, L, 'MAXIMUM', muc, cap)
    skin_mask = _math(N, L, 'SUBTRACT', 1.0, tissue, clamp=True)
    # ---- pores: fine everywhere (0.29 mm cells, 45 % of cells at full density), coarse on nose / medial cheeks / chin
    pf = _pores(N, L, obj, 3400.0, _math(N, L, 'MULTIPLY', pore, 0.45), 0.10, 0.16, 1.0)
    pc = _pores(N, L, obj, 1900.0, _math(N, L, 'MULTIPLY', _math(N, L, 'MULTIPLY', pore, pbig), SKIN['pc_dens']), SKIN['pc_rmin'], SKIN['pc_rspan'], 1.4)
    pdt = _math(N, L, 'ADD', pf, pc)
    # ---- Langer-line phase fields (mm) from the basis position
    sx = N.new('ShaderNodeSeparateXYZ')
    L.new(obj, sx.inputs[0])
    xmm = _math(N, L, 'MULTIPLY', sx.outputs['X'], 1000.0)
    zmm = _math(N, L, 'MULTIPLY', sx.outputs['Z'], 1000.0)
    axm = _math(N, L, 'ABSOLUTE', xmm)
    phi = {
        'w_h': zmm,
        'w_v': xmm,
        'w_c': _math(N, L, 'MULTIPLY', _math(N, L, 'ARCTAN2', zmm, _math(N, L, 'SUBTRACT', axm, 45.0)), 9.0),
        'w_d': _math(N, L, 'MULTIPLY', _math(N, L, 'MULTIPLY_ADD', zmm, 0.45, axm), 1.0 / 1.097),
    }
    hl = None
    for i, (k, ph) in enumerate(phi.items()):
        fam = _math(N, L, 'ADD', _math(N, L, 'MULTIPLY', _lines(N, L, ph, 0.55, obj, 2 * i + 1), 0.6),
                    _lines(N, L, ph, 1.25, obj, 2 * i + 2, width=0.12))
        term = _math(N, L, 'MULTIPLY', fam, W[k])
        hl = term if hl is None else _math(N, L, 'ADD', hl, term)
    # faint isotropic criss-cross everywhere on skin (two global families at +-40 deg), short broken segments
    s1 = _math(N, L, 'MULTIPLY_ADD', zmm, 0.64, _math(N, L, 'MULTIPLY', xmm, 0.77))
    s2 = _math(N, L, 'MULTIPLY_ADD', zmm, -0.64, _math(N, L, 'MULTIPLY', xmm, 0.77))
    cx = _math(N, L, 'ADD', _lines(N, L, s1, 0.42, obj, 11, width=0.14, seg=900.0), _lines(N, L, s2, 0.47, obj, 12, width=0.14, seg=900.0))
    hl = _math(N, L, 'ADD', hl, _math(N, L, 'MULTIPLY', cx, 0.55))      # #147e: crossing segments = a rhombic mesh, not ripples
    hl = _math(N, L, 'MULTIPLY', hl, _math(N, L, 'SUBTRACT', 1.0, scar, clamp=True))
    # ---- fine noise (0.3 mm), lip fissures (vertical, ~1.1 mm apart, wavy)
    nz = N.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 3200.0
    nz.inputs['Detail'].default_value = 3.0
    L.new(obj, nz.inputs['Vector'])
    wv = N.new('ShaderNodeTexWave')
    wv.wave_type = 'BANDS'
    wv.bands_direction = 'X'
    wv.inputs['Scale'].default_value = 900.0
    wv.inputs['Distortion'].default_value = 6.0
    wv.inputs['Detail'].default_value = 2.0
    L.new(obj, wv.inputs['Vector'])
    lf = _math(N, L, 'POWER', wv.outputs['Fac'], 6.0)
    lf = _math(N, L, 'MULTIPLY', lf, lip)
    # ---- water beads (2.9 mm cells, a fraction of the wet skin)
    vd = N.new('ShaderNodeTexVoronoi')
    vd.feature = 'F1'
    vd.inputs['Scale'].default_value = 340.0
    L.new(obj, vd.inputs['Vector'])
    sepd = N.new('ShaderNodeSeparateColor')
    L.new(vd.outputs['Color'], sepd.inputs['Color'])
    r0 = _math(N, L, 'MULTIPLY_ADD', sepd.outputs['Green'], 0.10, 0.06)
    cap_ = _math(N, L, 'SUBTRACT', 1.0, _math(N, L, 'DIVIDE', vd.outputs['Distance'], r0), clamp=True)
    cap_ = _math(N, L, 'SQRT', cap_)
    beadsel = _math(N, L, 'LESS_THAN', sepd.outputs['Red'], _math(N, L, 'MULTIPLY', wet, 0.30))
    bead = _math(N, L, 'MULTIPLY', cap_, _math(N, L, 'MULTIPLY', beadsel, skin_mask))
    # #147e: micro-droplets (1.1 mm cells, 0.07-0.16 mm caps) over most of the wet skin: under a point torch a wet face
    # sparkles; r9-r13's continuous coat islands gave broad smooth vinyl sheens
    vd2 = N.new('ShaderNodeTexVoronoi')
    vd2.feature = 'F1'
    vd2.inputs['Scale'].default_value = 900.0
    L.new(obj, vd2.inputs['Vector'])
    sepd2 = N.new('ShaderNodeSeparateColor')
    L.new(vd2.outputs['Color'], sepd2.inputs['Color'])
    r02 = _math(N, L, 'MULTIPLY_ADD', sepd2.outputs['Green'], 0.08, 0.06)
    cap2 = _math(N, L, 'SQRT', _math(N, L, 'SUBTRACT', 1.0, _math(N, L, 'DIVIDE', vd2.outputs['Distance'], r02), clamp=True))
    sel2 = _math(N, L, 'LESS_THAN', sepd2.outputs['Red'], _math(N, L, 'MULTIPLY', wet, 0.55))
    bead2 = _math(N, L, 'MULTIPLY', cap2, _math(N, L, 'MULTIPLY', sel2, skin_mask))
    # ---- height (1 unit = 0.08 mm along the normal)
    hgt = _math(N, L, 'MULTIPLY', _math(N, L, 'MULTIPLY', pdt, -SKIN['pore_k']), pore)
    hgt = _math(N, L, 'SUBTRACT', hgt, _math(N, L, 'MULTIPLY', hl, 0.45))          # #147e: 0.75 -> 0.45
    hgt = _math(N, L, 'SUBTRACT', hgt, _math(N, L, 'MULTIPLY', lf, 1.2))
    hgt = _math(N, L, 'MULTIPLY', hgt, skin_mask)
    hgt = _math(N, L, 'ADD', hgt, _math(N, L, 'MULTIPLY', _math(N, L, 'SUBTRACT', nz.outputs['Fac'], 0.5), 0.45))
    hgt = _math(N, L, 'ADD', hgt, _math(N, L, 'MULTIPLY', bead, 3.2))                # beads stand ~0.25 mm proud
    hgt = _math(N, L, 'ADD', hgt, _math(N, L, 'MULTIPLY', bead2, 1.4))
    # #147e: 0.12 mm stipple (stratum corneum scales) under everything: grain in the speculars
    hgt = _math(N, L, 'ADD', hgt, _math(N, L, 'MULTIPLY', _math(N, L, 'SUBTRACT', _noise(N, L, obj, 8000.0, 2.0, 0.5, offset=(5.0, 2.0, 8.0)), 0.5), _math(N, L, 'MULTIPLY', skin_mask, 0.5)))
    bump = N.new('ShaderNodeBump')
    bump.location = (300, -500)
    bump.inputs['Strength'].default_value = 1.0
    bump.inputs['Distance'].default_value = SKIN['bump_mm'] * 0.001     # r10: 0.08 -> 0.11 mm (r9: pores invisible at 100 %)
    L.new(hgt, bump.inputs['Height'])
    L.new(bump.outputs['Normal'], b.inputs['Normal'])
    bump2 = N.new('ShaderNodeBump')
    bump2.location = (300, -700)
    bump2.inputs['Strength'].default_value = 0.9            # r11: the film follows the relief (0.6 = a smooth varnish)
    bump2.inputs['Distance'].default_value = 0.00007
    L.new(hgt, bump2.inputs['Height'])
    L.new(bump2.outputs['Normal'], b.inputs['Coat Normal'])
    # ---- albedo: per-vertex x (1.5 mm luminance + 4 mm hue micro-variation); pores/lines hold a little silt
    var = _math(N, L, 'MULTIPLY_ADD', _noise(N, L, obj, 650.0, 4.0, 0.5), 0.24, 0.88)
    comb = N.new('ShaderNodeCombineColor')
    for c, (off, amp) in zip(('Red', 'Green', 'Blue'), (((1.0, 2.0, 3.0), 0.10), ((4.0, 5.0, 6.0), 0.05), ((7.0, 8.0, 9.0), 0.10))):
        hn = _noise(N, L, obj, 250.0, 2.0, 0.5, offset=off)
        L.new(_math(N, L, 'MULTIPLY', var, _math(N, L, 'MULTIPLY_ADD', _math(N, L, 'SUBTRACT', hn, 0.5), 2.0 * amp, 1.0)), comb.inputs[c])
    mulr = _mixc(N, L, alb, comb.outputs['Color'], 1.0, 'MULTIPLY')
    # ---- #147e r18: GRANULAR albedo below 1 mm. The r16 diffuse-colour pass (fx2/alb16.png) read as a pastel
    #      airbrush: per-vertex fields resolve ~1.2 mm and the shader added only 1.5 mm / 4 mm noise. Real skin albedo is
    #      grainy: 0.3 mm and 0.7 mm luminance grain (+-12 / +-10 %), scattered 0.25-0.6 mm pigment/capillary spots, and
    #      bruises are mottled (darker 1-3 mm clots of blood inside the patch), not a flat stain.
    gr = _math(N, L, 'MULTIPLY', _math(N, L, 'MULTIPLY_ADD', _noise(N, L, obj, 3300.0, 2.0, 0.6, offset=(1.5, 7.0, 3.0)), 0.24, 0.88),
               _math(N, L, 'MULTIPLY_ADD', _noise(N, L, obj, 1400.0, 2.0, 0.6, offset=(8.0, 2.5, 6.0)), 0.20, 0.90))
    bru = _attr(N, 'bru', -1200, -2050).outputs['Fac']
    bm = _mrange(N, L, _noise(N, L, obj, 420.0, 3.0, 0.65, offset=(4.0, 4.0, 9.0)), 0.42, 0.68, 1.0, 0.62)   # 1-3 mm clotted mottle
    gr = _math(N, L, 'MULTIPLY', gr, _math(N, L, 'ADD', _math(N, L, 'SUBTRACT', 1.0, bru, clamp=True), _math(N, L, 'MULTIPLY', bru, bm)))
    gcol = N.new('ShaderNodeCombineColor')
    for c in ('Red', 'Green', 'Blue'):
        L.new(_math(N, L, 'ADD', _math(N, L, 'MULTIPLY', gr, skin_mask), _math(N, L, 'SUBTRACT', 1.0, skin_mask, clamp=True)), gcol.inputs[c])
    mulr = _mixc(N, L, mulr, gcol.outputs['Color'], 1.0, 'MULTIPLY')
    vs = N.new('ShaderNodeTexVoronoi')
    vs.feature = 'F1'
    vs.inputs['Scale'].default_value = 520.0                 # 1.9 mm cells; 7 % hold a spot
    L.new(obj, vs.inputs['Vector'])
    sps = N.new('ShaderNodeSeparateColor')
    L.new(vs.outputs['Color'], sps.inputs['Color'])
    spot = _math(N, L, 'MULTIPLY', _math(N, L, 'LESS_THAN', sps.outputs['Red'], 0.07),
                 _math(N, L, 'LESS_THAN', vs.outputs['Distance'], _math(N, L, 'MULTIPLY_ADD', sps.outputs['Green'], 0.10, 0.06)))
    spot = _math(N, L, 'MULTIPLY', _math(N, L, 'MULTIPLY', spot, skin_mask), _math(N, L, 'MULTIPLY_ADD', sps.outputs['Blue'], 0.35, 0.3))
    mulr = _mixc(N, L, mulr, (0.075, 0.045, 0.045), spot)
    pdirt = _math(N, L, 'MULTIPLY', _math(N, L, 'ADD', _math(N, L, 'MULTIPLY', pdt, 0.55), _math(N, L, 'MULTIPLY', hl, 0.14)), skin_mask)
    mulr = _mixc(N, L, mulr, (0.06, 0.055, 0.048), _math(N, L, 'MINIMUM', pdirt, 0.6))
    vp = N.new('ShaderNodeTexVoronoi')
    vp.feature = 'F1'
    vp.inputs['Scale'].default_value = 650.0             # 1.5 mm cells
    L.new(obj, vp.inputs['Vector'])
    sep = N.new('ShaderNodeSeparateColor')
    L.new(vp.outputs['Color'], sep.inputs['Color'])
    dens = _math(N, L, 'MULTIPLY', pet, 0.38)          # r8: sparser (r7 read as a rash of paint dots)
    chosen = _math(N, L, 'LESS_THAN', sep.outputs['Red'], dens)
    dot = _math(N, L, 'LESS_THAN', vp.outputs['Distance'], _math(N, L, 'MULTIPLY_ADD', sep.outputs['Green'], 0.09, 0.045))   # r8: 0.13-0.4 mm
    pm = _math(N, L, 'MULTIPLY', _math(N, L, 'MULTIPLY', chosen, dot), _math(N, L, 'MULTIPLY_ADD', sep.outputs['Blue'], 0.6, 0.4))
    base = _mixc(N, L, mulr, (0.105, 0.022, 0.032), pm)
    # ---- lid margins, resolution-free (#147d): r = distance to the nearer globe centre. Posterior 0.6 mm wet pink
    # mucosa (mucocutaneous junction), the grey line, anterior skin with the lash roots — r1-r8 shaded the whole
    # 2 mm margin face one pink from 0.8 mm vertex colours = "a gasket"
    marm = _attr(N, 'mar', -1200, -1900).outputs['Fac']
    E0, E1 = (face.E[0], face.E[1]) if face is not None else (sh.V(31.0, 0.0, -1.2), sh.V(-31.0, 0.0, 0.0))
    dists = []
    for E in (E0, E1):
        vm = N.new('ShaderNodeVectorMath')
        vm.operation = 'DISTANCE'
        L.new(obj, vm.inputs[0])
        vm.inputs[1].default_value = tuple(float(v) * MM for v in E)
        dists.append(vm.outputs['Value'])
    rmm = _math(N, L, 'MULTIPLY', _math(N, L, 'MINIMUM', dists[0], dists[1]), 1000.0)
    post = _math(N, L, 'MULTIPLY', _mrange(N, L, rmm, sh.R_LID_IN + 0.45, sh.R_LID_IN + 0.95, 1.0, 0.0), marm)
    gline = _math(N, L, 'MULTIPLY', _mrange(N, L, _math(N, L, 'ABSOLUTE', _math(N, L, 'SUBTRACT', rmm, sh.R_LID_IN + 1.15)), 0.0, 0.22, 1.0, 0.0), marm)
    base = _mixc(N, L, base, (0.27, 0.13, 0.125), post)          # #147e: dead, less saturated (0.34/0.12/0.115 = orange rubber)
    base = _mixc(N, L, base, (0.02, 0.015, 0.015), _math(N, L, 'MULTIPLY', gline, 0.35))
    # r12: the lash line — the anterior margin is dark with lash roots (r11: a pale bare rim under a sparse fan)
    lline = _math(N, L, 'MULTIPLY', _mrange(N, L, rmm, sh.R_LID_IN + 1.25, sh.R_LID_IN + 1.75, 0.0, 1.0), marm)
    base = _mixc(N, L, base, (0.03, 0.025, 0.025), _math(N, L, 'MULTIPLY', lline, 0.65))
    L.new(base, b.inputs['Base Color'])
    # ---- the water film: wet islands (5-20 mm, broken by 2-4 mm holes) vs drying patches
    wp = _math(N, L, 'MULTIPLY', _mrange(N, L, _noise(N, L, obj, 90.0, 4.0, 0.6, offset=(3.0, 1.0, 7.0)), 0.50, 0.62),   # #147e: fewer
               _mrange(N, L, _noise(N, L, obj, 260.0, 3.0, 0.6, offset=(9.0, 4.0, 2.0)), 0.33, 0.52))
    dry = _math(N, L, 'SUBTRACT', 1.0, wp, clamp=True)
    rr = _math(N, L, 'MULTIPLY_ADD', nz.outputs['Fac'], 0.16, -0.08)
    rgh = _math(N, L, 'ADD', _math(N, L, 'ADD', rough, rr), _math(N, L, 'MULTIPLY', _math(N, L, 'MULTIPLY', dry, 0.12), skin_mask), clamp=True)
    if SKIN['spot']:          # #147e: spotty specular (sebum/water vs dry, 1-2 mm): the highlight breaks into a pebbled patch
        rgh = _math(N, L, 'ADD', rgh, _math(N, L, 'MULTIPLY', _math(N, L, 'SUBTRACT', _noise(N, L, obj, 700.0, 3.0, 0.6, offset=(2.0, 9.0, 4.0)), 0.5),
                                         _math(N, L, 'MULTIPLY', skin_mask, 2.0 * SKIN['spot'])), clamp=True)
    L.new(_mrange_mix(N, L, rgh, 0.07, post), b.inputs['Roughness'])
    b.inputs['Subsurface Weight'].default_value = 1.0
    # r16: some red back in the dermis (settled, deoxygenated blood + collagen): a warmer, softer terminator — r13-r15's
    # near-neutral 0.6 mm scatter gave the hard grey terminator of plaster
    b.inputs['Subsurface Radius'].default_value = (0.95, 0.52, 0.38)
    L.new(_math(N, L, 'MULTIPLY', sssm, 0.0012), b.inputs['Subsurface Scale'])     # r11: 1.6 -> 1.1 mm (wax); r16 1.2
    b.inputs['Subsurface Anisotropy'].default_value = 0.8
    b.inputs['IOR'].default_value = 1.4
    try:
        b.inputs['Specular IOR Level'].default_value = 0.5
    except KeyError:
        pass
    wpt = _math(N, L, 'MAXIMUM', wp, tissue)                                 # tissue / clots / blood stay wet
    cw = _math(N, L, 'MULTIPLY', wet, _math(N, L, 'MULTIPLY_ADD', wpt, 0.62, 0.03))    # r11: damp, not lacquered
    cw = _math(N, L, 'MAXIMUM', cw, _math(N, L, 'MULTIPLY', _math(N, L, 'MAXIMUM', bead, bead2), 4.0), clamp=True)
    cw = _math(N, L, 'MAXIMUM', cw, post)
    L.new(cw, b.inputs['Coat Weight'])
    wcr = _math(N, L, 'MAXIMUM', wpt, _math(N, L, 'MINIMUM', _math(N, L, 'MULTIPLY', _math(N, L, 'MAXIMUM', bead, bead2), 3.0), 1.0))
    L.new(_math(N, L, 'MULTIPLY_ADD', _math(N, L, 'SUBTRACT', 1.0, wcr, clamp=True), 0.33, 0.05), b.inputs['Coat Roughness'])   # beads glassy
    b.inputs['Coat IOR'].default_value = 1.33
    return mat


def _shadow_transparent(N, L, surf):
    """Mix(surf, Transparent) on 'Is Shadow Ray': refractive bits (cornea, tear meniscus) do not block the torch from the
    iris / lid behind them (Cycles cannot connect light through a refractive surface; those parts went black)."""
    lp = N.new('ShaderNodeLightPath')
    tr = N.new('ShaderNodeBsdfTransparent')
    mx = N.new('ShaderNodeMixShader')
    L.new(lp.outputs['Is Shadow Ray'], mx.inputs['Fac'])
    L.new(surf, mx.inputs[1])
    L.new(tr.outputs[0], mx.inputs[2])
    return mx.outputs[0]


def eye_texture_cached(k):
    """eye_texture is ~50 s of numpy per eye: cache it on the function's own source."""
    import inspect
    key = hashlib.sha256((inspect.getsource(eye_texture) + inspect.getsource(sh) + str(k)).encode()).hexdigest()[:12]
    path = CACHE_DIR / f'eye{k}_{key}.npz'
    if path.exists():
        z = np.load(path)
        return z['alb'], z['aux']
    alb, aux = eye_texture(k)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, alb=alb.astype(np.float32), aux=aux.astype(np.float32))
    return alb, aux


def eye_material(k):
    """The globe: sclera/conjunctiva + the recessed iris (eye_texture). Tear-film coat from aux R (off on the dried
    tache noire and on the iris, which sits under the cornea); aux G bumps the raised haemorrhage and vessels."""
    mat = bpy.data.materials.new(f'scare_eye{k}')
    nt, N, L = _nodes(mat)
    out = N.new('ShaderNodeOutputMaterial')
    b = N.new('ShaderNodeBsdfPrincipled')
    L.new(b.outputs[0], out.inputs['Surface'])
    alb, aux = eye_texture_cached(k)
    tex = N.new('ShaderNodeTexImage')
    tex.image = image_from(f'scare_eye{k}_alb', alb)
    tex.interpolation = 'Cubic'
    L.new(tex.outputs['Color'], b.inputs['Base Color'])
    tx2 = N.new('ShaderNodeTexImage')
    tx2.image = image_from(f'scare_eye{k}_aux', aux, colorspace='Non-Color')
    tx2.interpolation = 'Cubic'
    sp = N.new('ShaderNodeSeparateColor')
    L.new(tx2.outputs['Color'], sp.inputs['Color'])
    b.subsurface_method = 'RANDOM_WALK'
    b.inputs['Subsurface Weight'].default_value = 0.2
    b.inputs['Subsurface Radius'].default_value = (1.0, 0.6, 0.45)
    b.inputs['Subsurface Scale'].default_value = 0.0008
    L.new(_math(N, L, 'MULTIPLY_ADD', sp.outputs['Red'], -0.12, 0.42), b.inputs['Roughness'])   # dull dry sclera 0.42
    L.new(sp.outputs['Red'], b.inputs['Coat Weight'])                   # tear film over the conjunctiva
    b.inputs['Coat Roughness'].default_value = 0.015
    b.inputs['Coat IOR'].default_value = 1.336
    bump = N.new('ShaderNodeBump')
    bump.inputs['Distance'].default_value = 0.0002
    L.new(sp.outputs['Green'], bump.inputs['Height'])
    L.new(bump.outputs['Normal'], b.inputs['Normal'])
    return mat


def cornea_materials():
    """(front, back): the dome's front is the corneal surface (IOR 1.376, glossy tear film); the back/side close the
    anterior chamber index-matched (Transparent: aqueous 1.336 ~ cornea 1.376, no refraction at the back)."""
    mf = bpy.data.materials.new('scare_cornea')
    nt, N, L = _nodes(mf)
    out = N.new('ShaderNodeOutputMaterial')
    b = N.new('ShaderNodeBsdfPrincipled')
    b.inputs['Base Color'].default_value = (1.0, 1.0, 1.0, 1.0)
    b.inputs['Transmission Weight'].default_value = 1.0
    b.inputs['Roughness'].default_value = 0.0
    b.inputs['IOR'].default_value = 1.376
    L.new(_shadow_transparent(N, L, b.outputs[0]), out.inputs['Surface'])
    mb = bpy.data.materials.new('scare_cornea_back')
    nt, N, L = _nodes(mb)
    out = N.new('ShaderNodeOutputMaterial')
    L.new(N.new('ShaderNodeBsdfTransparent').outputs[0], out.inputs['Surface'])
    return mf, mb


def cornea_front_material(k):
    """r10: the clouding moved INTO the dome's front surface (r9's separate haze cap stopped 0.3 mm short of the limbus
    and the uncovered iris root read as a dark ring = the bullseye again). Per point: clear cornea (glass, shadow-
    transparent; the iris and pupil show through refracted) vs a milky stroma (grey-white diffuse + translucent under
    a glossy tear film) by density = a radial fade (0.8 centre -> 0.35 at the limbus, so the edge melts into the
    sclera) x irregular 1-3 mm patches + 0.3 mm grain."""
    mat = bpy.data.materials.new(f'scare_cornea_front{k}')
    nt, N, L = _nodes(mat)
    out = N.new('ShaderNodeOutputMaterial')
    glass = N.new('ShaderNodeBsdfPrincipled')
    glass.inputs['Base Color'].default_value = (1.0, 1.0, 1.0, 1.0)
    glass.inputs['Transmission Weight'].default_value = 1.0
    glass.inputs['Roughness'].default_value = 0.0
    glass.inputs['IOR'].default_value = 1.376
    clear = _shadow_transparent(N, L, glass.outputs[0])
    milk = N.new('ShaderNodeBsdfPrincipled')
    milk.inputs['Base Color'].default_value = (0.44, 0.46, 0.48, 1.0)
    milk.inputs['Roughness'].default_value = 0.6
    milk.inputs['Coat Weight'].default_value = 1.0
    milk.inputs['Coat Roughness'].default_value = 0.01
    milk.inputs['Coat IOR'].default_value = 1.336
    tc = N.new('ShaderNodeTexCoord')
    obj = tc.outputs['Object']
    off = (2.0 * k + 1.0, 3.0, 5.0)
    # radial position on the dome: distance from the eye's visual axis (object space, eye centre in head mm)
    E = sh.V(31.0, 0.0, -1.2) if k == 0 else sh.V(-31.0, 0.0, 0.0)
    sx = N.new('ShaderNodeSeparateXYZ')
    L.new(obj, sx.inputs[0])
    dx = _math(N, L, 'SUBTRACT', sx.outputs['X'], float(E[0]) * MM)
    dz = _math(N, L, 'SUBTRACT', sx.outputs['Z'], float(E[2]) * MM)
    rho = _math(N, L, 'MULTIPLY', _math(N, L, 'SQRT', _math(N, L, 'ADD', _math(N, L, 'MULTIPLY', dx, dx), _math(N, L, 'MULTIPLY', dz, dz))), 1000.0)
    radial = _mrange(N, L, rho, 1.2, sh.LIMBUS_R, 0.40, 0.86)    # r13: 0.40 centre: the pupil survives as a ghost
    # (r10's fade to 0.40 at the limbus let the dark iris root through as a ring)
    d1 = _mrange(N, L, _noise(N, L, obj, 520.0, 3.0, 0.6, offset=off), 0.35, 0.65, 0.84, 1.08)   # r13: less 'moon'
    d2 = _math(N, L, 'MULTIPLY', _math(N, L, 'SUBTRACT', _noise(N, L, obj, 3000.0, 2.0, 0.5, offset=(off[1], off[0], off[2])), 0.5), 0.2)
    dens = _math(N, L, 'ADD', _math(N, L, 'MULTIPLY', radial, d1), d2, clamp=True)
    mx = N.new('ShaderNodeMixShader')
    L.new(dens, mx.inputs['Fac'])
    L.new(clear, mx.inputs[1])
    L.new(milk.outputs[0], mx.inputs[2])
    L.new(mx.outputs[0], out.inputs['Surface'])
    return mat


def haze_material(k):
    """Post-mortem corneal clouding as a frosted veil inside the dome: per point a mix of clear (Transparent) and
    milky (grey-white Diffuse + Translucent) with an irregular density (0.5-0.95: 1-3 mm patches + 0.3 mm grain), so
    the iris and pupil survive only as a ghost — not a painted ring."""
    mat = bpy.data.materials.new(f'scare_haze{k}')
    nt, N, L = _nodes(mat)
    out = N.new('ShaderNodeOutputMaterial')
    tc = N.new('ShaderNodeTexCoord')
    obj = tc.outputs['Object']
    off = (2.0 * k + 1.0, 3.0, 5.0)
    d1 = _noise(N, L, obj, 520.0, 3.0, 0.6, offset=off)            # ~2 mm patches
    d2 = _noise(N, L, obj, 3000.0, 2.0, 0.5, offset=(off[1], off[0], off[2]))
    dens = _math(N, L, 'ADD', _mrange(N, L, d1, 0.35, 0.65, 0.55, 0.92), _math(N, L, 'MULTIPLY', _math(N, L, 'SUBTRACT', d2, 0.5), 0.15), clamp=True)
    diff = N.new('ShaderNodeBsdfDiffuse')
    diff.inputs['Color'].default_value = (0.70, 0.71, 0.70, 1.0)
    diff.inputs['Roughness'].default_value = 1.0
    trl = N.new('ShaderNodeBsdfTranslucent')
    trl.inputs['Color'].default_value = (0.78, 0.78, 0.76, 1.0)
    milk = N.new('ShaderNodeMixShader')
    milk.inputs['Fac'].default_value = 0.45
    L.new(diff.outputs[0], milk.inputs[1])
    L.new(trl.outputs[0], milk.inputs[2])
    clear = N.new('ShaderNodeBsdfTransparent')
    mx = N.new('ShaderNodeMixShader')
    L.new(dens, mx.inputs['Fac'])
    L.new(clear.outputs[0], mx.inputs[1])
    L.new(milk.outputs[0], mx.inputs[2])
    L.new(mx.outputs[0], out.inputs['Surface'])
    return mat


def water_material():
    """Tear meniscus / water: clear, IOR 1.333, shadow-transparent."""
    mat = bpy.data.materials.new('scare_water')
    nt, N, L = _nodes(mat)
    out = N.new('ShaderNodeOutputMaterial')
    b = N.new('ShaderNodeBsdfPrincipled')
    b.inputs['Base Color'].default_value = (1.0, 1.0, 1.0, 1.0)
    b.inputs['Transmission Weight'].default_value = 1.0
    b.inputs['Roughness'].default_value = 0.02
    b.inputs['IOR'].default_value = 1.333
    L.new(_shadow_transparent(N, L, b.outputs[0]), out.inputs['Surface'])
    return mat


def meniscus_curves(face):
    """Tear meniscus along each lower lid (r 0.30 mm) and a thinner one along the upper (0.18 mm): the bright wet line
    where the lid meets the globe (r1-r8: a dark 0.35 mm crevice). Returns (S (K, NP, 3) mm, R (K, NP) mm)."""
    S, R = [], []
    for k in (0, 1):
        E = face.E[k]
        s = 1.0 if k == 0 else -1.0
        az = np.linspace(-74.0, 74.0, 90)
        up, lo = sh.margins(az, k)
        for el, rad, rr in ((lo + 1.1, 0.30, 12.28), (up - 0.9, 0.18, 12.26)):
            a, e = np.radians(az), np.radians(el)
            d = np.stack([s * np.sin(a) * np.cos(e), -np.cos(a) * np.cos(e), np.sin(e)], 1)
            # r11: where the lid rests on the cornea dome the meniscus sits on the dome, not inside it
            b_ = -d[:, 1] * sh.CORNEA_OFF
            rc = b_ + np.sqrt(np.maximum(b_ * b_ - (sh.CORNEA_OFF ** 2 - sh.CORNEA_R ** 2), 0.0))
            S.append(E + d * np.maximum(rr, rc + 0.12)[:, None])
            taper = np.sin(np.linspace(0.0, math.pi, len(az))) ** 0.35
            R.append(rad * (0.35 + 0.65 * taper))
    return np.array(S), np.array(R)


def teeth_material():
    mat = bpy.data.materials.new('scare_teeth')
    nt, N, L = _nodes(mat)
    out = N.new('ShaderNodeOutputMaterial')
    b = N.new('ShaderNodeBsdfPrincipled')
    L.new(b.outputs[0], out.inputs['Surface'])
    cerv = _attr(N, 'cerv').outputs['Fac']
    # yellowed enamel (linear) -> stained cervical third / tartar
    L.new(_mixc(N, L, (0.37, 0.33, 0.24), (0.21, 0.14, 0.085), _math(N, L, 'POWER', cerv, 1.4)), b.inputs['Base Color'])   # r11: greyer, dead
    b.subsurface_method = 'RANDOM_WALK'
    b.inputs['Subsurface Weight'].default_value = 0.6
    b.inputs['Subsurface Radius'].default_value = (1.0, 0.75, 0.5)
    b.inputs['Subsurface Scale'].default_value = 0.0012
    b.inputs['Roughness'].default_value = 0.22
    b.inputs['Coat Weight'].default_value = 0.6
    b.inputs['Coat Roughness'].default_value = 0.05
    b.inputs['Coat IOR'].default_value = 1.33
    return mat


def hair_material(melanin=0.97, rough=0.14):
    mat = bpy.data.materials.new('scare_hair')
    nt, N, L = _nodes(mat)
    out = N.new('ShaderNodeOutputMaterial')
    hb = N.new('ShaderNodeBsdfHairPrincipled')
    hb.model = 'CHIANG'
    hb.parametrization = 'MELANIN'
    hb.inputs['Melanin'].default_value = melanin
    hb.inputs['Melanin Redness'].default_value = 0.25
    hb.inputs['Roughness'].default_value = rough + 0.04          # #147e: 0.14 -> 0.18
    hb.inputs['Radial Roughness'].default_value = 0.22
    # #147d: wet — the water film evens the cuticle: sharper, brighter primary glints (AD: "matte black wires")
    hb.inputs['Coat'].default_value = 0.5
    try:
        hb.inputs['Random Roughness'].default_value = 0.35      # #147e: per-strand spread (r15 glints all at once)
        hb.inputs['Offset'].default_value = math.radians(1.5)
    except KeyError:
        pass
    L.new(hb.outputs[0], out.inputs['Surface'])
    return mat


# ------------------------------------------------------------------------------------------------ pose, camera, torch
HERO_T = sh.V(-6.0, -24.0, -42.0)        # head-space point at the frame centre (mm)


def pose_matrix(yaw=8.0, roll=6.0, pitch=-20.0, T=HERO_T, dist=0.27):
    """Head -> world: rotation R (chin-up/yaw/roll) and translation putting T at the world origin; the camera sits at
    world (0, -dist, 0) looking +y."""
    R = sh.rot_z(yaw) @ sh.rot_y(roll) @ sh.rot_x(pitch)
    M = np.eye(4)
    M[:3, :3] = R
    M[:3, 3] = -(R @ (np.asarray(T) * MM))
    return M, R


def torch_E(d):
    """flashlight.ts near-field: E = I s2 / (s2 d^2 + D^2/8), I 2000 cd, s2 0.0036, D 0.05 m (2-D krypton)."""
    return 2000.0 * 0.0036 / (0.0036 * d * d + 0.05 ** 2 / 8.0)


# The game's live torch (src/render/look.ts LOOK.torch*, cookie in src/render/flashlight.ts), r = tan(theta) (cone 45):
#   I(theta) = 2000 cd x [ s2/s2e * exp(-r^2/s2e)  (core; near field s2e = s2 + D^2/(8 d^2), D 5 cm)
#                          + 0.0035 * (1 - smoothstep(0.4, 0.95, r))   (7 cd spill shelf)
#                          + 0.0008 * (1 - smoothstep(0.6, 1.0, r)) ]  (1.6 cd corona)
#              x smoothstep(cos 45, cos 22.5, cos theta)                (three SpotLight: angle 45, penumbra 0.5)
TORCH = dict(cd=2000.0, s2=0.0036, spill=0.0035, shelf=0.4, tail=0.0008, angle=45.0, pen=0.5, D=0.05)


def _ss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def torch_profile(theta, d):
    """Candela vs off-axis angle theta (rad) of the game torch for a surface d metres away (d None = the far field:
    the beam of a point source, no near-field widening by the 5 cm mouth)."""
    T = TORCH
    r = np.tan(np.minimum(theta, math.radians(89.0)))
    s2e = T['s2'] + (0.0 if d is None else T['D'] ** 2 / (8.0 * d * d))
    core = (T['s2'] / s2e) * np.exp(-r * r / s2e)
    spill = T['spill'] * (1.0 - _ss(T['shelf'], 0.95, r))
    tail = T['tail'] * (1.0 - _ss(0.6, 1.0, r))
    a = math.radians(T['angle'])
    cone = _ss(math.cos(a), math.cos(a * (1.0 - T['pen'])), np.cos(theta))
    return T['cd'] * (core + spill + tail) * cone


def blender_spot(theta, half):
    """Cycles spot mask with blend 1: smoothstep((cos t - cos h) / (1 - cos h)) (no extra cosine)."""
    ch = math.cos(half)
    return _ss(0.0, 1.0, (np.cos(theta) - ch) / (1.0 - ch))


def fit_torch(d, halves_deg=(2.5, 4.0, 6.0, 8.5, 12.0, 17.0, 24.0, 34.0, 46.0)):
    """Non-negative least squares (relative error) of a stack of blend-1 Cycles spots to torch_profile at distance d.
    Returns [(half_angle_deg, cd)], the max relative error over 0-30 deg and the profile samples."""
    th = np.radians(np.linspace(0.0, 44.0, 400))
    tgt = torch_profile(th, d)
    A = np.stack([blender_spot(th, math.radians(h)) for h in halves_deg], 1)
    wgt = 1.0 / (tgt + 0.5)                        # relative fit down to the ~2 cd corona
    Aw = A * wgt[:, None]
    bw = tgt * wgt
    x = np.zeros(A.shape[1])
    P = []                                          # Lawson-Hanson NNLS
    for _ in range(60):
        w = Aw.T @ (bw - Aw @ x)
        cand = [i for i in range(len(x)) if i not in P and w[i] > 1e-10]
        if not cand:
            break
        P.append(max(cand, key=lambda i: w[i]))
        while True:
            z = np.zeros_like(x)
            z[P] = np.linalg.lstsq(Aw[:, P], bw, rcond=None)[0]
            if all(z[i] > 0 for i in P):
                x = z
                break
            neg = [i for i in P if z[i] <= 0]
            al = min(x[i] / (x[i] - z[i]) for i in neg)
            x = x + al * (z - x)
            P = [i for i in P if x[i] > 1e-9]
    fit = A @ x
    m = th < math.radians(30.0)
    err = float(np.max(np.abs(fit[m] - tgt[m]) / (tgt[m] + 0.5)))
    return [(h, float(c)) for h, c in zip(halves_deg, x) if c > 1e-6], err, (th, tgt, fit)


# #147e: Cycles IES scale, MEASURED in Blender 5.2.1 (scratchpad fx2/ies_test*.py, a diffuse plane 0.34 m under a plain
# spot vs the same spot with an IES texture): a spot of W watts whose IES file gives c cd emits W/(4 pi) x IES_K x c
# (project cd = W/(4 pi)); linear in c (x3 profile -> x3, not normalised). The IES direction is taken from each point
# of the 2.5 cm light sphere, so Cycles convolves the profile with the mouth's disc (measured within 3 % of a
# disc-average model) — feeding it the FAR-field beam reproduces the game's near-field core (s2 + D^2/8d^2) within
# ~10 % at 0.25-0.42 m (fx2/smear2.py), the way a real reflector's beam forms.
IES_K = 0.0705


def torch_ies_text():
    """LM-63 text of the game torch's far-field beam (type C, 0 deg = the beam axis = the spot's -Z), project cd."""
    v = np.concatenate([np.arange(0.0, 20.0, 0.25), np.arange(20.0, 60.0, 1.0), [60.0, 90.0, 180.0]])
    c = torch_profile(np.radians(np.minimum(v, 89.0)), None)
    c[v >= 60.0] = 0.0                                   # past the 45 deg cone: dark
    lines = ['IESNA:LM-63-2002', '[TEST] THE KEEPING scare torch (2-cell D krypton, far field)', 'TILT=NONE',
             f'1 -1 1 {len(v)} 1 1 2 0 0 0', '1.0 1.0 2.4',
             ' '.join(f'{a:.2f}' for a in v), '0', ' '.join(f'{x:.5f}' for x in c)]
    return '\n'.join(lines) + '\n'


def camera_basis(dist=0.27, cam_up=0.0):
    """The player's eye: at (0, -dist, cam_up) looking at the world origin (the head point HERO_T); returns (C, F, U, Rt)
    world position, forward, up, right (unit). cam_up > 0 = eye level above the frame centre, looking down."""
    C = np.array([0.0, -dist, cam_up])
    F = -C / np.linalg.norm(C)
    Rt = np.cross(F, np.array([0.0, 0.0, 1.0]))
    Rt /= np.linalg.norm(Rt)
    U = np.cross(Rt, F)
    return C, F, U, Rt


def setup_camera_and_torch(M, R, dist=0.27, fstop=5.6, focus_head_mm=None, aim_head_mm=None, torch_off=(0.06, 0.04, -0.27),
                           cam_up=0.0):
    sc = bpy.context.scene
    cd = bpy.data.cameras.new('scare_cam')
    cd.lens = 35.0
    cd.sensor_fit = 'HORIZONTAL'
    cd.sensor_width = 36.0
    cd.clip_start = 0.01
    cam = bpy.data.objects.new('scare_cam', cd)
    sc.collection.objects.link(cam)
    C, F, U, Rt = camera_basis(dist, cam_up)
    cam.location = Vector(tuple(C))
    cam.rotation_euler = (math.radians(90.0) - math.atan2(cam_up, dist), 0.0, 0.0)      # tilted down at the frame centre
    sc.camera = cam

    def to_world(p_mm):
        return (M @ np.append(np.asarray(p_mm) * MM, 1.0))[:3]
    if focus_head_mm is not None:
        f = to_world(focus_head_mm)
        cd.dof.use_dof = True
        cd.dof.focus_distance = float((f - C) @ F)
        cd.dof.aperture_fstop = fstop
        cd.dof.aperture_blades = 6
    # torch: right hand, 0.27 m under the eye, 4 cm forward, 6 cm right; 2900 K. The beam is the GAME's torch profile
    # (torch_profile at the aim distance) built from a stack of blend-1 spots fitted by NNLS: a single 14.5 deg spot
    # was ZERO beyond 7.25 deg, so eyes and jaw bruises 9-10 deg off-axis were lit by the 7 cd spill alone (-5.5 EV).
    tp = C + np.array([torch_off[0], torch_off[1], torch_off[2]])                      # world offsets from the eye
    aim = to_world(aim_head_mm if aim_head_mm is not None else HERO_T)
    dd = float(np.linalg.norm(aim - tp))
    # #147e: ONE spot light carrying the whole beam as an IES profile. r1-r13 stacked 7 COINCIDENT spots (NNLS fit):
    # Cycles credits a BSDF-sampled ray that hits overlapping light spheres to ONE light only (the first created, the
    # 2.5 deg core) — measured (fx2/lt_test.py): a glossy catchlight 856 -> 7.7 when a narrow coincident spot aimed
    # elsewhere is added first. So every sharp highlight (cornea catchlights, tear meniscus, the wet coat at
    # roughness 0.03-0.1) beyond 2.5 deg of the aim was missing or 4-100x too dim: dead "painted" eyes, no glints.
    ld = bpy.data.lights.new('torch', 'SPOT')
    ld.spot_size = math.pi                                # the IES profile carries the beam and the 45 deg cone
    ld.spot_blend = 0.0
    ld.shadow_soft_size = 0.025                           # the 5 cm reflector mouth
    ld.energy = 4.0 * math.pi / IES_K                     # -> I(theta) = the IES candela values (see IES_K)
    ld.use_temperature = True
    ld.temperature = 2900.0
    ld.use_nodes = True
    nt = ld.node_tree
    em = next(n for n in nt.nodes if n.type == 'EMISSION')
    tx = bpy.data.texts.new('scare_torch.ies')
    tx.from_string(torch_ies_text())
    ies = nt.nodes.new('ShaderNodeTexIES')
    ies.mode = 'INTERNAL'
    ies.ies = tx
    nt.links.new(ies.outputs['Fac'], em.inputs['Strength'])
    o = bpy.data.objects.new('torch', ld)
    sc.collection.objects.link(o)
    o.location = Vector(tuple(tp))
    o.rotation_euler = (Vector(tuple(aim)) - o.location).to_track_quat('-Z', 'Y').to_euler()
    lights = [o]
    peak = float(torch_profile(np.array([0.0]), dd)[0])
    log(f'scare torch: {dd:.3f} m to the aim point, E {torch_E(dd):.0f} lx, near-field peak {peak:.0f} cd, one IES '
        f'spot (far-field {float(torch_profile(np.array([0.0]), None)[0]):.0f} cd x the 5 cm mouth)')
    return cam, lights, dict(torch_dist=dd, E=torch_E(dd), I_peak=peak, ies=True)
