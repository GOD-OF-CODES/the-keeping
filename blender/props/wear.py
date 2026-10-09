"""Prop wear finishing (docs/PROPS-FINISH.md §1.3–§1.5, contract §5): support loops, weighted normals and the
per-vertex 'wear' mask bake (BYTE_COLOR, POINT -> glTF COLOR_0 unorm16x4).

Channels (each 0..1 linear, already x the prop's scalar; 0 = pristine):
  R edge     convex curvature (radius of curvature <= ~5 mm full, >= 20 mm none) or a hard (>= 60°) edge, x edge scalar
  G cavity   ray occlusion within 3 cm (8 rays) or concave curvature, x cavity scalar; + soot anchors (upward plume)
  B handled  sum of Gaussians exp(-(d/r)^2) around `wear_handle` anchors, x use scalar
  A dust     up-facing (n_z 0.35..0.85) x open to the sky (+Z ray, 2 m, same object) x (1 - B) x dust scalar
  `wear_protect` anchors subtract from R and A. Glass faces (spec family 'glass') and decal parts carry 0.

Called from kit.Part.build(): support_loops() on the fresh mesh (before sharp-by-angle), weighted_normals() after
the subsurf block, bake() last. build_props sets CURRENT_TYPE before building each variant.
"""
import json
import math
from pathlib import Path

import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ATTR = 'wear'
ENABLED = False         # OFF unless build_props turns it on (house/corridor jobs import kit.py: they must not change)
LOOPS = True            # support loops on/off (budget experiments)
CURRENT_TYPE = None     # set by build_props.build_variant
CURRENT_KEY = None      # variant key (report)
STATS = {}              # (type, part) -> bake summary (build_props report)
LEVELS = 16             # quantisation levels per channel (k / 15)

# per prop type: (edge, cavity, use, dust) — PROPS-FINISH §3.2; anything not listed gets DEFAULT
DEFAULT = (0.45, 0.7, 0.3, 0.5)
SCALARS = {
    'letter': (0.3, 0.2, 0.6, 0.0), 'locket': (0.5, 0.9, 0.8, 0.0), 'ledger_book': (0.7, 0.8, 0.7, 0.6),
    'guest_book': (0.6, 0.8, 0.6, 0.15), 'bus_ticket': (0.4, 0.0, 0.7, 0.0), 'sewing_shears': (0.8, 0.6, 0.9, 0.3),
    'claw_hammer': (0.8, 0.7, 0.9, 0.4), 'jerry_can': (0.65, 0.7, 0.6, 0.5), 'bell_pull_embroidered': (0.4, 0.6, 0.9, 0.6),
    'sedan_interior': (0.5, 0.8, 0.8, 0.3), 'candle': (0.3, 0.9, 0.4, 0.6), 'kerosene_lamp': (0.6, 0.9, 0.8, 0.7),
    'sewing_basket': (0.6, 0.8, 0.7, 0.6), 'whetstone': (0.6, 0.8, 0.5, 0.5), 'hog_cleaver': (0.8, 0.8, 0.8, 0.4),
    'nightstand': (0.6, 0.8, 0.6, 0.8), 'rocking_chair': (0.7, 0.8, 0.9, 0.6), 'dress_dummy': (0.3, 0.7, 0.3, 0.8),
    'photo_frame': (0.5, 0.9, 0.3, 0.7), 'hall_table': (0.6, 0.8, 0.5, 0.7), 'mirror_crepe': (0.4, 0.9, 0.0, 0.7),
    'bolt_box': (0.6, 0.9, 0.4, 0.6), 'rope_pulley': (0.6, 0.9, 0.4, 0.6), 'door_counterweight': (0.6, 0.9, 0.4, 0.6),
    'spring_bell': (0.6, 0.9, 0.4, 0.6), 'bell_crank': (0.6, 0.9, 0.4, 0.6),
    'mailbox': (0.7, 0.9, 0.2, 0.0), 'sign_post': (0.7, 0.9, 0.2, 0.0), 'vacancy_plate': (0.7, 0.9, 0.2, 0.0),
    'road_card': (0.7, 0.9, 0.2, 0.0), 'can_shelf': (0.5, 0.9, 0.3, 0.8), 'iron_stove': (0.6, 0.9, 0.6, 0.5),
    'pump_sink': (0.6, 0.9, 0.6, 0.5), 'coat_hooks': (0.6, 0.9, 0.6, 0.5),
    # outdoors / vehicles: rain-washed, no dust
    'sedan': (0.3, 0.6, 0.1, 0.0), 'wreck_sedan': (0.6, 0.9, 0.0, 0.0), 'logging_truck': (0.5, 0.9, 0.1, 0.0),
    'gas_pump': (0.6, 0.9, 0.3, 0.0), 'utility_pole': (0.4, 0.8, 0.0, 0.0), 'billboard': (0.4, 0.8, 0.0, 0.0),
    'diner': (0.4, 0.8, 0.0, 0.0), 'fence_run': (0.5, 0.8, 0.1, 0.0), 'farm_gate': (0.6, 0.8, 0.3, 0.0),
    'porch': (0.6, 0.8, 0.3, 0.0), 'rain_barrel': (0.5, 0.8, 0.1, 0.0), 'dead_tree': (0.0, 0.5, 0.0, 0.0),
    'deer': (0.0, 0.0, 0.0, 0.0),
    # wire: no handling, a 1.6 mm round section is not an exposed corner
    'bell_wire': (0.1, 0.6, 0.0, 0.5), 'cobweb_curtain': (0.0, 0.0, 0.0, 0.6),
}
# Low keeps the mask only on these (PROPS-FINISH §1.5 rows 1–20: props the player handles, reads or takes)
HERO = ['letter', 'locket', 'ledger_book', 'guest_book', 'bus_ticket', 'sewing_shears', 'claw_hammer', 'jerry_can',
        'bell_pull_embroidered', 'sedan_interior', 'candle', 'kerosene_lamp', 'sewing_basket', 'whetstone',
        'hog_cleaver', 'nightstand', 'rocking_chair', 'dress_dummy', 'photo_frame', 'hall_table']

# support loops cost +25–250 % tris on box-heavy sets (measured: rag_rug 9 k -> 27 k, balustrade 9 k -> 31 k,
# bricked_doorway 12 k -> 45 k): only the handled HERO props get them; the rest bake masks on their own topology
LOOP_TYPES = set(HERO) - {'sedan_interior', 'dress_dummy'}   # car: 60k -> 97k tris with loops; cloth: no edges
NO_MASK_FAMILIES = {'glass', 'skin', 'hair'}
# Floor-contact grime (props AD review, round E): what stands on a floor for decades darkens in a band at the bottom
# — a long skirt hem that has touched a dusty board floor carries a grey-brown dirt band ≈ 5–15 cm deep (the hem
# drags, wicks floor dust and mop water); written into G (cavity → the family's grime layer). (band height m, amount)
# by type; z is the part-local vertex z (dress parts are built in root space, floor = 0). dress_dummy only: its mask is dropped on Low (ruling h), so
# the Low budget is untouched.
FLOOR_GRIME = {'dress_dummy': (0.25, 1.0)}
NEAR_STEPS = 3     # edge hops from a real face within which convex curvature counts as a bevel
BIG_FACE = 0.004   # 2A/P (m) above which a face is a 'face', not an edge strip
_FAMILY = None


def family(mid):
    global _FAMILY
    if _FAMILY is None:
        spec = json.loads((Path(__file__).resolve().parents[2] / 'src/shared/material-spec.json').read_text())
        _FAMILY = {m['id']: m.get('family') for m in spec['materials']}
    return _FAMILY.get((mid or '').replace('@2s', ''))


def loop_width(verts):
    """Support-loop inset (m) by part size: furniture 8 mm, mid-size/sheet metal 5 mm, tools 3 mm, sheets 2 mm."""
    if not verts:
        return 0.0
    ext = [max(v[i] for v in verts) - min(v[i] for v in verts) for i in range(3)]
    big, small = max(ext), min(ext)
    if small < 0.004:
        return 0.002
    return 0.008 if big >= 0.4 else 0.005 if big >= 0.12 else 0.003


def _hard(e, deg=20.0):
    return len(e.link_faces) == 2 and e.calc_face_angle(0.0) > math.radians(deg)


def support_loops(me, width, skip_mats=()):
    """Inset every planar face region (min size > 4 x width) bordering a >= 20° edge by `width` (depth 0): the inner
    ring is coplanar, so the baked edge channel ramps 0 -> 1 over exactly `width` (PROPS-FINISH §1.4). UVs are
    interpolated (planar box UVs stay exact). Returns the vertex count added."""
    if width <= 0:
        return 0
    bm = bmesh.new()
    bm.from_mesh(me)
    n0 = len(bm.verts)
    # create the layer BEFORE holding any BMFace: adding customdata reallocates and invalidates face references
    ring = bm.faces.layers.int.get('wear_ring') or bm.faces.layers.int.new('wear_ring')
    bm.faces.ensure_lookup_table()
    ok = set()
    for f in bm.faces:
        if f.material_index in skip_mats or len(f.verts) < 3:
            continue
        p = f.calc_perimeter()
        if p <= 0 or 2.0 * f.calc_area() / p < 0.004:   # 2A/P = ab/(a+b) for an a x b rectangle; < 4 mm = an edge itself
            continue
        if any(_hard(e) for e in f.edges):
            ok.add(f)
    # group into coplanar connected regions: one inset per region keeps hard edges between regions looped
    seen, groups = set(), []
    for f in ok:
        if f in seen:
            continue
        grp, stack = [], [f]
        seen.add(f)
        while stack:
            g = stack.pop()
            grp.append(g)
            for e in g.edges:
                if _hard(e, 1.0):
                    continue
                for h in e.link_faces:
                    if h in ok and h not in seen:
                        seen.add(h)
                        stack.append(h)
        groups.append(grp)
    # adaptive: a narrow face (a 12 mm rib, a bar) gets a ring at 30 % of its half-width instead of none, so its
    # middle stays pristine instead of the whole face reading as 'edge'. Widths first: an inset can replace the
    # neighbouring faces of a later group (those are skipped: is_valid).
    widths = [min(width, 0.3 * max(2.0 * g.calc_area() / max(g.calc_perimeter(), 1e-9) for g in grp)) for grp in groups]
    for grp, w in zip(groups, widths):
        grp = [g for g in grp if g.is_valid]
        if not grp:
            continue
        try:
            ret = bmesh.ops.inset_region(bm, faces=grp, thickness=w, depth=0.0, use_even_offset=True,
                                         use_boundary=True, use_interpolate=True)
            for nf in ret['faces']:
                nf[ring] = 1
        except Exception:
            pass
    added = len(bm.verts) - n0
    bm.to_mesh(me)
    bm.free()
    return added


def weighted_normals(ob):
    """WEIGHTED_NORMAL (FACE_AREA, weight 50, keep_sharp), applied: big faces stay flat, bevels carry the turn."""
    from lib.scene import apply_all_modifiers
    md = ob.modifiers.new('wnorm', 'WEIGHTED_NORMAL')
    md.mode = 'FACE_AREA'
    md.weight = 50
    md.keep_sharp = True
    apply_all_modifiers(ob)


def _smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# 8 fixed hemisphere directions (cosine-ish: 30° and 60° off the normal, 4 azimuths each, rotated 45° apart)
_HEMI = []
for k in range(8):
    th = math.radians(30 if k % 2 == 0 else 62)
    ph = k * math.pi / 4
    _HEMI.append((math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)))


def bake(ob, scalars, anchors, skip_mats=()):
    """Write the 'wear' colour attribute on ob.data (object space; anchors: [(kind, Vector loc, extras)])."""
    me = ob.data
    es, cs, us, ds = scalars
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    tree = BVHTree.FromBMesh(bm)
    nv = len(bm.verts)
    E = [0.0] * nv
    C = [0.0] * nv
    # convex curvature means 'bevel' only next to a real face: a thin round section far from one (shear bows, chain
    # links, wire, strands; radius < 2.5 mm) would otherwise read as full edge all over (hero2 tiles: shears bows and
    # locket chain uniformly white). Bevel-eligible = within NEAR_STEPS edges of a vertex of a face >= BIG_FACE.
    near = [False] * nv
    front = set()
    for f in bm.faces:
        p = f.calc_perimeter()
        if p > 0 and 2.0 * f.calc_area() / p >= BIG_FACE:
            for v in f.verts:
                if not near[v.index]:
                    near[v.index] = True
                    front.add(v)
    for _ in range(NEAR_STEPS):
        nxt = set()
        for v in front:
            for e in v.link_edges:
                w = e.other_vert(v)
                if not near[w.index]:
                    near[w.index] = True
                    nxt.add(w)
        front = nxt
    for e in bm.edges:
        if len(e.link_faces) != 2:
            continue
        f1, f2 = e.link_faces
        th = f1.normal.angle(f2.normal, 0.0)
        if th < 1e-3:
            continue
        mid = (e.verts[0].co + e.verts[1].co) * 0.5
        d = 2.0 * min((f1.calc_center_median() - mid).length, (f2.calc_center_median() - mid).length)
        kappa = th / max(d, 1e-5)                      # rad/m: 1/radius of curvature
        convex = (f2.calc_center_median() - f1.calc_center_median()).dot(f1.normal) < 0
        # full edge at <= 2.5 mm radius of curvature (bevels), none at >= 10 mm (rods, lathes), or a hard >= 60° edge
        bevel = near[e.verts[0].index] or near[e.verts[1].index]
        val = max(_smooth(100.0, 400.0, kappa) if bevel else 0.0, _smooth(math.radians(45), math.radians(75), th))
        tgt = E if convex else C
        for v in e.verts:
            if val > tgt[v.index]:
                tgt[v.index] = val
    masked = [False] * nv
    onface = [False] * nv   # vertex of a real face: its ray occlusion would smear over the face -> curvature only
    ring = bm.faces.layers.int.get('wear_ring')
    for f in bm.faces:
        if f.material_index not in skip_mats:
            for v in f.verts:
                masked[v.index] = True
        # a vertex on a real face (>= 4 mm, not a support-loop strip) carries no edge value: without a ring it would
        # smear the bevel's wear across the whole face (POINT-domain interpolation)
        p = f.calc_perimeter()
        if (ring is None or not f[ring]) and p > 0 and 2.0 * f.calc_area() / p >= BIG_FACE:
            for v in f.verts:
                E[v.index] = 0.0
                onface[v.index] = True
    R, G, B, A = [0.0] * nv, [0.0] * nv, [0.0] * nv, [0.0] * nv
    up = Vector((0, 0, 1))
    fg = FLOOR_GRIME.get(CURRENT_TYPE)
    for v in bm.verts:
        i = v.index
        if not masked[i]:
            continue
        n = v.normal
        o = v.co + n * 0.0005
        # tangent frame for the AO hemisphere
        t = n.cross(Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 1, 0))).normalized()
        b = n.cross(t)
        occ = 0
        if cs > 0 and not onface[i]:
            for hx, hy, hz in _HEMI:
                if tree.ray_cast(o, t * hx + b * hy + n * hz, 0.03)[0] is not None:
                    occ += 1
        cav = max(occ / 8.0, C[i] * 0.8)
        hand = 0.0
        soot = 0.0
        prot = 0.0
        for kind, loc, ex in anchors:
            r = float(ex.get('r', 0.05))
            dv = v.co - loc
            if kind == 'wear_handle':
                hand += math.exp(-(dv.length / r) ** 2)
            elif kind == 'wear_soot':
                upz = float(ex.get('up', 0.15))
                dz = dv.z / (r + upz) if dv.z > 0 else dv.z / r
                soot += math.exp(-((dv.x / r) ** 2 + (dv.y / r) ** 2 + dz * dz))
            elif kind == 'wear_protect':
                prot += math.exp(-(dv.length / r) ** 2)
        hand = min(1.0, hand)
        prot = min(1.0, prot)
        dust = 0.0
        if ds > 0 and n.z > 0.35:
            dust = _smooth(0.35, 0.85, n.z)
            if tree.ray_cast(o, up, 2.0)[0] is not None:
                dust *= 0.15
        R[i] = E[i] * es * (1.0 - prot)
        G[i] = min(1.0, cav * cs + soot)
        if fg:
            G[i] = max(G[i], fg[1] * (1.0 - _smooth(0.0, fg[0], v.co.z)))
        B[i] = hand * us
        A[i] = dust * (1.0 - hand) * ds * (1.0 - prot)
    bm.free()
    if me.attributes.get('wear_ring') is not None:
        me.attributes.remove(me.attributes['wear_ring'])
    attr = me.color_attributes.get(ATTR) or me.color_attributes.new(ATTR, 'BYTE_COLOR', 'POINT')
    # 16 linear levels per channel: masks need no more (the runtime thresholds them with noise) and the meshopt
    # vertex codec then packs COLOR_0 ~3x tighter than free 16-bit values (measured 8.0 B/vert unquantised)
    q = float(LEVELS - 1)
    flat = []
    for i in range(nv):
        flat.extend((round(R[i] * q) / q, round(G[i] * q) / q, round(B[i] * q) / q, round(A[i] * q) / q))
    attr.data.foreach_set('color', flat)       # linear values (BYTE_COLOR stores sRGB-encoded bytes)
    try:
        me.color_attributes.active_color = attr
        me.color_attributes.render_color_index = me.color_attributes.find(ATTR)
    except Exception:
        pass
    return {'verts': nv, 'mean': [round(sum(c) / max(nv, 1), 3) for c in (R, G, B, A)]}


def color_meshopt_patch():
    """Blender 5.2's exporter builds COLOR_n accessors (BYTE_COLOR -> UNSIGNED_SHORT) straight from raw bytes
    (blender/exp/primitive_attributes.py __gather_attribute), skipping the EXT_meshopt_compression path that
    POSITION/NORMAL/TEXCOORD get in accessors.py — measured 8.0 B/vertex on the props. Wrap
    gather_primitive_attributes and meshopt-encode those buffer views the way accessors.array_to_accessor does
    (mode ATTRIBUTES, no filter; three's MeshoptDecoder decodes it generically). Returns an undo callable."""
    import numpy as np
    from io_scene_gltf2.blender.exp import primitive_attributes as pa
    from io_scene_gltf2.io.exp.meshopt import MeshoptEncoder
    orig = pa.gather_primitive_attributes

    def wrapped(blender_primitive, export_settings):
        attrs = orig(blender_primitive, export_settings)
        if not export_settings.get('gltf_meshopt_compression'):
            return attrs
        for name, acc in attrs.items():
            bv = getattr(acc, 'buffer_view', None)
            if not name.startswith('COLOR_') or bv is None or getattr(bv, 'extensions', None):
                continue
            if int(acc.component_type) != 5123:
                continue
            arr = np.frombuffer(bv.data, dtype=np.uint16).reshape(acc.count, -1)
            data, filt = MeshoptEncoder.encode_attribute(name, arr, arr.strides[0], export_settings)
            bv.set_extension(export_settings['gltf_meshopt_extension'], {
                'buffer': data, 'byteOffset': None, 'byteStride': arr.strides[0], 'byteLength': len(data),
                'count': acc.count, 'mode': 'ATTRIBUTES', 'filter': filt})
        return attrs
    pa.gather_primitive_attributes = wrapped

    def undo():
        pa.gather_primitive_attributes = orig
    return undo
