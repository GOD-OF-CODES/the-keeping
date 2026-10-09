"""Ada's neck split (docs/C2-ESCAPE.md A0 head-node + A1 split/caps).

The head becomes its own glTF node: an armature `ada_head_rig` (33 bones = `head_root` + the 8 x 4 `hair_<g>_NN`
chains, names unchanged so src/characters/ada.ts still finds them) carrying the meshes `ada_head` (face/scalp skin +
its cut cap), `ada_hair` and `ada_eye`. Until C2 it is BONE-PARENTED to `ada_rig`'s `head` bone with an identity rest
offset, so every existing clip moves it exactly as before (no runtime change needed). The runtime severs her by
re-parenting the `ada_head_rig` Object3D to a socket (Harlan prop_l, Ada prop_r) or the world; clip keys on `head` then
move nothing (no track filtering, no pop).

The split is done on the finished body mesh with ONE bmesh bisect on an oblique C4-C5 plane, so both pieces share the
exact rim vertices; the rim's custom normals are the average of both pieces' skin normals (no shading line before C2).
Each side's cut is closed by a ring-lerp cap (K rings toward the rim centroid) with 3-8 mm anatomy relief along the
plane normal (`relief(u, v)`, mm), the head cap mirrored with a 2 mm offset (§3.2).
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

from lib.scene import log

HEAD_GROUPS = ('head', 'jaw', 'jaw_hold')
CUT_FRAC = 0.42          # along neck_01.head (C7) -> head.head (C1): C4-C5
TILT_DEG = 15.0          # oblique: the plane rises toward the nape (a blow from behind and above)
RINGS = 3                # cap rings: ~540 tris per cap with the ~108-vertex rim (doc: 600 Medium/Max)
HEAD_ROOT = 'head_root'


def cut_plane(rig):
    B = rig.data.bones
    return cut_plane_pts(B['neck_01'].head_local, B['head'].head_local)


def cut_plane_pts(a, b):
    """a = neck_01 head (C7), b = head head (C1), rest pose -> (c, n, fwd, side) Vectors."""
    a, b = Vector(tuple(a)), Vector(tuple(b))
    axis = (b - a).normalized()
    c = a.lerp(b, CUT_FRAC)
    fwd = Vector((0.0, -1.0, 0.0))
    fwd = (fwd - axis * fwd.dot(axis)).normalized()
    t = math.radians(TILT_DEG)
    n = (axis * math.cos(t) + fwd * math.sin(t)).normalized()
    side = n.cross(fwd).normalized()               # +side = her left? (Ada faces -y: +x is her left)
    fwd = side.cross(n).normalized()
    return c, n, fwd, side


def _weights(ob):
    names = {g.index: g.name for g in ob.vertex_groups}
    W = []
    for v in ob.data.vertices:
        W.append({names[g.group]: g.weight for g in v.groups if g.weight > 0.0})
    return W


def _dominant_head(w):
    if not w:
        return False
    k = max(w, key=w.get)
    return k in HEAD_GROUPS


def _order_loop(edges):
    """Boundary edges -> list of ordered vertex loops."""
    adj = {}
    for e in edges:
        a, b = e.verts
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    seen, loops = set(), []
    for start in adj:
        if start in seen:
            continue
        loop, prev, cur = [start], None, start
        seen.add(start)
        while True:
            nxt = [v for v in adj[cur] if v is not prev and v not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            seen.add(cur)
            loop.append(cur)
        loops.append(loop)
    return loops


def _join_chains(chains, name):
    """Open rim chains (a vertex of degree > 2 splits the walk) -> one closed loop, greedily joining the nearest
    endpoints. Gaps above 1 cm are an error (the cut crossed a hole in the skin)."""
    if not chains:
        raise RuntimeError(f'sever: no rim on {name}')
    chains = sorted(chains, key=len, reverse=True)
    loop = list(chains.pop(0))
    gaps = []
    while chains:
        end = loop[-1].co
        best, bi, rev = None, -1, False
        for i, ch in enumerate(chains):
            for r, p in ((False, ch[0].co), (True, ch[-1].co)):
                d = (p - end).length
                if best is None or d < best:
                    best, bi, rev = d, i, r
        ch = chains.pop(bi)
        loop += list(reversed(ch)) if rev else list(ch)
        gaps.append(round(best * 1000, 2))
    gaps.append(round((loop[0].co - loop[-1].co).length * 1000, 2))
    log(f'sever: {name} rim loop {len(loop)} verts, joins (mm) {gaps}')
    if max(gaps) > 10.0:
        raise RuntimeError(f'sever: rim gap {max(gaps)} mm on {name}')
    # drop duplicate verts (a chain revisiting a vertex)
    out, seen = [], set()
    for v in loop:
        if v not in seen:
            seen.add(v)
            out.append(v)
    return out


def relief(u, v, head_side=False):
    """Cap relief (m) along the outward cap normal at in-plane coords u (her left +), v (front +), metres.
    A2 owns the full anatomy; this is the shared height field (muscle retracted, vessels recessed, bone proud)."""
    from characters import neck_anatomy
    return neck_anatomy.height(u + (0.002 if head_side else 0.0), v)


def _cap(bm, loop, c, n, fwd, side, outward, head_side, shape_layers):
    """Fill one rim loop with RINGS rings + a centre vertex; returns the new faces."""
    rim = [v.co.copy() for v in loop]
    cen = sum(rim, Vector()) / len(rim)
    cen = cen - n * (cen - c).dot(n)
    rings = [loop]
    new_verts = []
    for k in range(1, RINGS):
        f = 1.0 - k / RINGS
        ring = []
        for v in loop:
            p = cen + (v.co - cen) * f
            p = p - n * (p - c).dot(n)                     # on the plane
            d = p - cen
            h = relief(d.dot(side), d.dot(fwd), head_side) * min(1.0, k / 1.5)
            nv = bm.verts.new(p + outward * h)
            ring.append(nv)
            new_verts.append((nv, v))
        rings.append(ring)
    h0 = relief(0.0, 0.0, head_side)
    cv = bm.verts.new(cen + outward * h0)
    new_verts.append((cv, loop[0]))
    faces = []
    m = len(loop)
    for k in range(RINGS - 1):
        A, B = rings[k], rings[k + 1]
        for i in range(m):
            j = (i + 1) % m
            try:
                faces.append(bm.faces.new((A[i], A[j], B[j], B[i])))
            except ValueError:
                pass
    last = rings[-1]
    for i in range(m):
        try:
            faces.append(bm.faces.new((last[i], last[(i + 1) % m], cv)))
        except ValueError:
            pass
    # shape keys: the cap rides with its rim vertex's offset (keys are tiny near the cut)
    for lay in shape_layers:
        for nv, src in new_verts:
            nv[lay] = nv.co + (src[lay] - src.co)
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    for f in faces:
        if f.normal.dot(outward) < 0:
            f.normal_flip()
    return faces, [nv for nv, _ in new_verts], cen


def split_mesh(ob, rig):
    """ob (skinned body skin) -> (body ob with cap, head ob with cap, rim normals)."""
    c, n, fwd, side = cut_plane(rig)
    W = _weights(ob)
    head_ob = ob.copy()
    head_ob.data = ob.data.copy()
    for col in ob.users_collection:
        col.objects.link(head_ob)
    head_ob.name = 'ada_head'
    head_ob.data.name = 'ada_head'
    axis_a = Vector(rig.data.bones['neck_01'].head_local)
    axis_b = Vector(rig.data.bones['head'].tail_local)
    axis = (axis_b - axis_a).normalized()

    # the neck section in plane coords (side, fwd) around the cut centre c (which sits on the bone line, at the BACK
    # of the neck): Ada's neck is ~10.5 cm wide, the throat ~5.5 cm in front of the bones and the nape ~3.5 cm behind.
    # A fixed ellipse (side +-64 mm, fwd -54..+78 mm) holds the whole section but not the shoulders (|side| > 65 mm).
    # (Round 1 measured it from the verts within 6 mm of the plane: too sparse after decimation, the throat was lost.)
    sc, fc, rs, rf = 0.0, 0.012, 0.064, 0.066

    def in_neck(p):
        d = p - c
        u, w = d.dot(side) - sc, d.dot(fwd) - fc
        return (u / rs) ** 2 + (w / rf) ** 2 < 1.0 and abs(d.dot(n)) < 0.05

    out = {}
    rim_normals = {}
    for piece, keep_head in ((ob, False), (head_ob, True)):
        bm = bmesh.new()
        bm.from_mesh(piece.data)
        shape_layers = list(bm.verts.layers.shape.values())
        dl = bm.verts.layers.deform.verify()
        neck = [f for f in bm.faces if all(in_neck(v.co) for v in f.verts)]
        geom = list({v for f in neck for v in f.verts}) + list({e for f in neck for e in f.edges}) + neck
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-7, plane_co=c, plane_no=n, clear_inner=False, clear_outer=False)
        kill = []
        for f in bm.faces:
            cen = f.calc_center_median()
            if in_neck(cen):
                is_head = (cen - c).dot(n) > 0
            else:
                ws = [dict((piece.vertex_groups[g].name, w) for g, w in v[dl].items()) for v in f.verts]
                votes = sum(1 for w in ws if _dominant_head(w))
                is_head = votes * 2 > len(ws)
            if is_head != keep_head:
                kill.append(f)
        # debug: the throat band (fwd > 20 mm, |s| < 30 mm)
        th = [f for f in bm.faces if (f.calc_center_median() - c).dot(fwd) > 0.02 and abs((f.calc_center_median() - c).dot(n)) < 0.03]
        kset = set(kill)
        log(f'sever dbg {piece.name}: throat faces {len(th)}, in_neck {sum(1 for f in th if in_neck(f.calc_center_median()))}, '
            f'all-verts-in {sum(1 for f in th if all(in_neck(v.co) for v in f.verts))}, killed {sum(1 for f in th if f in kset)}, '
            f'max edge {max((e.calc_length() for f in th for e in f.edges), default=0) * 1000:.0f} mm, '
            f'fwd range {min(((f.calc_center_median() - c).dot(fwd) for f in th), default=0) * 1000:.0f}..'
            f'{max(((f.calc_center_median() - c).dot(fwd) for f in th), default=0) * 1000:.0f} mm, '
            f's range {min(((f.calc_center_median() - c).dot(n) for f in th), default=0) * 1000:.0f}..'
            f'{max(((f.calc_center_median() - c).dot(n) for f in th), default=0) * 1000:.0f} mm')
        bmesh.ops.delete(bm, geom=kill, context='FACES')
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
        rim_edges = [e for e in bm.edges if e.is_boundary and all(abs((v.co - c).dot(n)) < 2e-5 for v in e.verts)]
        chains = [L for L in _order_loop(rim_edges) if len(L) > 1]
        log(f'sever: {piece.name} rim chains {[len(L) for L in chains]} ({len(rim_edges)} rim edges)')
        for L in chains:
            q = lambda p: (round((p - c).dot(side) * 1000), round((p - c).dot(fwd) * 1000))
            log(f'  chain {len(L)}: {q(L[0].co)} .. {q(L[len(L) // 2].co)} .. {q(L[-1].co)} (mm side, fwd)')
        bnd = [e for e in bm.edges if e.is_boundary]
        near = [e for e in bnd if abs((e.verts[0].co - c).dot(n)) < 0.03 and (e.verts[0].co - c).length < 0.09]
        log(f'  boundary edges {len(bnd)}, near the cut {len(near)}; sample s(mm): {sorted(round((e.verts[0].co - c).dot(n) * 1000, 2) for e in near)[:12]}')
        loop = _join_chains(chains, piece.name)
        # orient the loop CCW around the outward normal
        outward = (-n) if keep_head else n
        cen = sum((v.co for v in loop), Vector()) / len(loop)
        tw = sum(((loop[i].co - cen).cross(loop[(i + 1) % len(loop)].co - cen)).dot(outward) for i in range(len(loop)))
        if tw < 0:
            loop.reverse()
        bm.normal_update()
        for v in loop:                                    # skin-only normal at the rim (before the cap exists)
            key = tuple(round(x, 6) for x in v.co)
            rim_normals.setdefault(key, Vector())
            rim_normals[key] += v.normal
        faces, cap_verts, cap_cen = _cap(bm, loop, c, n, fwd, side, outward, keep_head, shape_layers)
        for e in bm.edges:                                # the rim is a hard edge between skin and cap
            if all(v in loop for v in e.verts) and e.is_manifold:
                e.smooth = False
        for f in faces:
            f.smooth = True
            f.material_index = 0
        # weights: cap verts copy their rim vertex (set below by nearest rim index)
        rim_w = {v: dict(v[dl]) for v in loop}
        for nv in cap_verts:
            best = min(loop, key=lambda r: (r.co - nv.co).length)
            nv[dl].clear()
            for g, w in rim_w[best].items():
                nv[dl][g] = w
        bm.faces.index_update()
        cap_ids = [f.index for f in faces]
        rim_keys = [tuple(round(x, 6) for x in v.co) for v in loop]
        bm.to_mesh(piece.data)
        bm.free()
        piece.data['_cap_faces'] = cap_ids
        piece['cap_center'] = tuple(cap_cen)
        piece.data.update()
        out[keep_head] = (piece, rim_keys)
    # averaged custom normals across the seam
    for keep_head, (piece, rim_keys) in out.items():
        me = piece.data
        rk = set(rim_keys)
        caps = set(me.get('_cap_faces', []))
        ln = [Vector((0, 0, 0))] * len(me.loops)
        ln = [None] * len(me.loops)
        for p in me.polygons:
            for li in p.loop_indices:
                vi = me.loops[li].vertex_index
                key = tuple(round(x, 6) for x in me.vertices[vi].co)
                if p.index not in caps and key in rk:
                    ln[li] = rim_normals[key].normalized()[:]
                else:
                    ln[li] = (0.0, 0.0, 0.0)
        me.normals_split_custom_set(ln)
    return ob, head_ob, (c, n, fwd, side)


def _rename_group(ob, old, new):
    g = ob.vertex_groups.get(old)
    if g:
        g.name = new


def _merge_groups(ob, srcs, dst):
    """Move the weights of groups `srcs` into `dst` (created if needed), then drop `srcs`."""
    gd = ob.vertex_groups.get(dst) or ob.vertex_groups.new(name=dst)
    idx = {ob.vertex_groups[s].index: s for s in srcs if ob.vertex_groups.get(s)}
    for v in ob.data.vertices:
        add = sum(g.weight for g in v.groups if g.group in idx)
        if add > 0:
            gd.add([v.index], add, 'ADD')
    for s in idx.values():
        ob.vertex_groups.remove(ob.vertex_groups[s])


def build_head_rig(rig):
    """ada_head_rig: head_root (= ada_rig head at rest) + the hair chains moved out of ada_rig."""
    vl = bpy.context.view_layer
    hair = [b.name for b in rig.data.bones if b.name.startswith('hair_')]
    arm = bpy.data.armatures.new('ada_head_rig')
    hr = bpy.data.objects.new('ada_head_rig', arm)
    for col in rig.users_collection:
        col.objects.link(hr)
    hr.matrix_world = rig.matrix_world.copy()
    arm.display_type = 'STICK'
    # read the source edit bones
    for o in vl.objects:
        o.select_set(False)
    vl.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    src = {}
    for name in ['head'] + hair:
        e = rig.data.edit_bones[name]
        src[name] = (e.head.copy(), e.tail.copy(), e.roll, e.parent.name if e.parent else None, e.use_connect, e.use_deform)
    for name in hair:                                   # the chains leave ada_rig
        rig.data.edit_bones.remove(rig.data.edit_bones[name])
    bpy.ops.object.mode_set(mode='OBJECT')
    # the node's ORIGIN is the crown grip (top-back of the skull, where a fist holds the hair): an identity attach to a
    # socket puts the crown in the fist (the runtime pendulum then orients it)
    crown = src['head'][1] + Vector((0.0, 0.02, -0.012))
    hr.matrix_world = rig.matrix_world @ Matrix.Translation(crown)
    rig.select_set(False)
    vl.objects.active = hr
    hr.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.edit_bones
    for name, (h, t, roll, par, conn, dfm) in src.items():
        e = eb.new(HEAD_ROOT if name == 'head' else name)
        e.head, e.tail, e.roll = h - crown, t - crown, roll
        e.use_deform = True
    for name, (h, t, roll, par, conn, dfm) in src.items():
        if name == 'head':
            continue
        e = eb[name]
        e.parent = eb[HEAD_ROOT if par == 'head' else par]
        e.use_connect = conn
    bpy.ops.object.mode_set(mode='OBJECT')
    # bone-parent to ada_rig.head with an identity rest offset (Blender bone-parent space = the bone TAIL)
    hr.parent = rig
    hr.parent_type = 'BONE'
    hr.parent_bone = 'head'
    b = rig.data.bones['head']
    tail_m = rig.matrix_world @ b.matrix_local @ Matrix.Translation((0.0, b.length, 0.0))
    hr.matrix_basis = Matrix.Identity(4)
    hr.matrix_parent_inverse = tail_m.inverted() @ rig.matrix_world @ Matrix.Translation(crown)
    hr['crown_rest'] = tuple(crown)
    hr['character_part'] = 'ada_head'
    log(f'sever: ada_head_rig {len(arm.bones)} bones; ada_rig now {len(rig.data.bones)} bones')
    return hr


def _retarget(ob, hr):
    for m in ob.modifiers:
        if m.type == 'ARMATURE':
            m.object = hr
    mw = ob.matrix_world.copy()
    ob.parent = hr
    ob.parent_type = 'OBJECT'
    ob.matrix_parent_inverse = hr.matrix_world.inverted()
    ob.matrix_world = mw


def sever(rig, body, hair, eye):
    """Split Ada (A0/A1). Returns dict(body, head, head_rig, plane)."""
    body, head, plane = split_mesh(body, rig)
    # body: everything of the head groups now hangs on neck_02
    _merge_groups(body, [g for g in HEAD_GROUPS if body.vertex_groups.get(g)], 'neck_02')
    for g in [g.name for g in body.vertex_groups if g.name.startswith('hair_')]:
        body.vertex_groups.remove(body.vertex_groups[g])
    # head skin: rigid on head_root
    for g in list(head.vertex_groups):
        head.vertex_groups.remove(g)
    gr = head.vertex_groups.new(name=HEAD_ROOT)
    gr.add(list(range(len(head.data.vertices))), 1.0, 'REPLACE')
    _merge_groups(hair, [g for g in ('jaw', 'jaw_hold') if hair.vertex_groups.get(g)], 'head')
    _rename_group(hair, 'head', HEAD_ROOT)
    for g in [g.name for g in hair.vertex_groups if g.name != HEAD_ROOT and not g.name.startswith('hair_')]:
        _merge_groups(hair, [g], HEAD_ROOT)
    _rename_group(eye, 'head', HEAD_ROOT)
    hr = build_head_rig(rig)
    for ob in (head, hair, eye):
        _retarget(ob, hr)
    c, n, fwd, side = plane
    cap = (tuple(c), tuple(n), tuple(fwd), tuple(side), tuple(body['cap_center']))
    return dict(body=body, head=head, head_rig=hr, plane=plane, cap=cap)
