"""Job `corridor`: County Road 9 (RC9), 1550 m of road and forest east of the gate -> details_corridor.glb per tier.

  node scripts/assets.mjs --only corridor        (docs/C1-OPENING.md §2, §6.4; docs/HOUSE.md "Corridor")

Everything is in PLAN/world space (like every `details_*` file: src/world/level.ts adds the nodes as they are),
extras room 'RC9' (a `set` room in the layout: hidden in gameplay, shown by the C0/C1 runtime), `detail`, `kind:
'detail'`, `corridor`, probe-/runtime-lit (no lightmap atlas: headlights, moon and lightning light it).

  rc9_road          the road from x = 20 (EXT1's east edge) along road_rc9: 2 % crowned asphalt (wet ruts at n
                    +-0.9 / +-2.6), gravel shoulders, 1:3 ditches with a standing-water strip, back slopes; UV0 in
                    metres (u across, v along s); forest-floor strips to n +-48 (litter)
  rc9_paint         faded double yellow on A/B/D, a broken single line on C/E (passing), 40-70 % worn
  rc9_pine_*        instanced pines (house/pines.py), chunked every 150 m of s so three culls chunks; static LOD:
                    edge row L0 in the hero zones (gate/deer/sign, diner, billboard bend) else L1; back rows L1/L2;
                    tail (s > 1250) L2. Low: one LOD down, sparser back rows.
  rc9_snag_*        storm-killed snags among the pines (treeline 'low' skeleton), lightning silhouettes
  rc9_understory_*  edge understory clumps (n 9.2-10.5)
  rc9_canopy_*      the canopy blanket (18-24 m) from n +-40 to +-250 so the C0 aerial reads as unbroken forest; its
                    inner edge drops to 3 m at n 40 (a dark wall behind the trees). +n side only east of s 160
                    (never over the farm's eastern view).
  rc9_pole_*        creosoted poles every 45 m at n -7.2 (s < 845) / +7.2 (s > 845), one leaning 6 deg, one with a
                    broken crossarm; P_RC9_LINE carries the insulator points (extras.wire_points) for the
                    runtime's catenaries (3 conductors + neutral, sag 1.2 m per 45 m, one broken conductor)
  rc9_reflector_*   delineators at n +-4.9 every 60 m on bends / 120 m on straights, 25 % missing or leaning,
                    facing westbound traffic
  P_RC9_ROAD        marker: extras.road = road_rc9.definition() (the proposed src/shared/road-rc9.json)

Exclusions (§2): no +n trees for s < 60 (EXT2 field), 10 m clearing round P_CAR_INTERIOR (the CAR set), 3 m round
every landmark, the diner lot and the billboard clear, nothing on the road or in the ditches.
"""
import json
import math
import random

import bpy
from mathutils import Matrix, Vector

from lib.scene import REPO, SHARED, job_args, log, reset, result, write_json
from lib.export import export_glb, inspect_glb
from props import kit, registry
from house import road_rc9 as RD
from house import pines

ARGS = job_args()
TIERS = ('low', 'medium', 'max')
ROOM = 'RC9'
CHUNK = 150.0
HERO = [(-20.0, 90.0), (185.0, 275.0), (655.0, 745.0), (900.0, 960.0)]   # gate, deer + sign, diner, billboard
CAR_SET = (100.8, 1.4)
OUT = REPO / 'public' / 'assets'
SCRATCH = REPO / 'scratch' / 'opening'

# half cross-section (n >= 0): (n, z, material of the strip from the previous point to this one)
PROFILE = [(0.0, 0.07, None), (0.9, 0.052, 'asphalt_wet'), (2.6, 0.018, 'asphalt_wet'), (3.5, 0.0, 'asphalt_wet'),
           (4.7, -0.03, 'gravel_wet'), (5.3, -0.22, 'mud_wet'), (6.2, -0.56, 'mud_wet'), (6.4, -0.585, 'mud_wet'),
           (7.1, -0.585, 'water_ditch'), (7.4, -0.5, 'mud_wet'), (8.4, -0.18, 'leaf_litter_wet'),
           (9.5, 0.0, 'leaf_litter_wet')]
FLOOR = [(9.5, 0.0), (18.0, 0.0), (30.0, 0.05), (48.0, 0.1)]


def tag(ob, **kw):
    for k, v in {'room': ROOM, 'detail': True, 'kind': 'detail', 'corridor': True, **kw}.items():
        ob[k] = v
    return ob


def landmarks():
    L = json.loads((SHARED / 'level-layout.json').read_text())
    return [p for p in L['props'] if p.get('room') == ROOM]


# ------------------------------------------------------------------------------------------------ road
def road_part(tier):
    st = RD.stations(24.0 if tier == 'low' else 8.0, 6.0 if tier == 'low' else 2.5)
    part = kit.Part('rc9_road')
    full = [(-n, z, m) for n, z, m in reversed(PROFILE[1:])] + [(PROFILE[0][0], PROFILE[0][1], None)] + PROFILE[1:]
    # strip materials: for the -n half the material of strip k (between k and k+1) is that of point k
    mats = []
    for k in range(len(full) - 1):
        n0, n1 = full[k][0], full[k + 1][0]
        mats.append(full[k][2] if n1 <= 0 else full[k + 1][2])
    rows = [[RD.point(s_, n, (z + _rut(n)) * _ramp(s_)) for n, z, _ in full] for s_ in st]
    uvs = [[(n, s_) for n, _, _ in full] for s_ in st]
    # visible side up: n increases to the left of +s, so (e_n x e_s) points down -> reverse every quad
    grid(part, rows, uvs, lambda j, k: mats[k] if st[j] < 1500 or mats[k] != 'asphalt_wet' else 'leaf_litter_wet',
         lambda j, k: True)
    # forest floor out to n +-48 (sparser stations), 5 cm under the farm's flat far-field ground west of x 165
    fl = RD.stations(32.0, 16.0)
    for side in (-1, 1):
        rows = []
        for s_ in fl:
            r = []
            for n, z in FLOOR:
                p = RD.point(s_, side * n, z)
                r.append((p[0], p[1], p[2] - (0.05 if p[0] < 165 else 0.0)))
            rows.append(r)
        uvs = [[(side * n, s_) for n, _ in FLOOR] for s_ in fl]
        grid(part, rows, uvs, lambda j, k: 'leaf_litter_wet', lambda j, k: side > 0)
    return part


def grid(part, rows, uvs, face_mat, flip):
    """Shared-vertex quad grid: rows[j][k] points, uvs[j][k] (u, v), face_mat(j, k) -> material id or None."""
    base = len(part.verts)
    nk = len(rows[0])
    for r in rows:
        part.verts.extend(Vector(p) for p in r)
    for j in range(len(rows) - 1):
        for k in range(nk - 1):
            mid = face_mat(j, k)
            if mid is None:
                continue
            q = [base + j * nk + k, base + j * nk + k + 1, base + (j + 1) * nk + k + 1, base + (j + 1) * nk + k]
            uv = [uvs[j][k], uvs[j][k + 1], uvs[j + 1][k + 1], uvs[j + 1][k]]
            if flip(j, k):
                q, uv = q[::-1], uv[::-1]
            part.faces.append(q)
            part.face_mat.append(_mat_index(part, mid))
            part.face_smooth.append(True)
            part.loop_uv.append(uv)


def _ramp(s):
    t = max(0.0, min(1.0, s / 25.0))
    return t * t * (3 - 2 * t)


def _rut(n):
    a = abs(n)
    return -0.004 * (math.exp(-((a - 0.9) / 0.35) ** 2) + math.exp(-((a - 2.6) / 0.35) ** 2))


def _mat_index(part, mid):
    if mid not in part.mats:
        part.mats.append(mid)
    return part.mats.index(mid)


def paint_part(rng):
    part = kit.Part('rc9_paint')

    def strip(s0, s1, n0, n1):
        steps = max(1, int((s1 - s0) / 2.0))
        for k in range(steps):
            a = s0 + (s1 - s0) * k / steps
            b = s0 + (s1 - s0) * (k + 1) / steps
            if rng.random() < 0.18:      # worn through
                continue
            z = 0.07 - 0.02 * abs((n0 + n1) / 2)
            pts = [Vector(RD.point(a, n0, z * _ramp(a) + 0.003)), Vector(RD.point(a, n1, z * _ramp(a) + 0.003)),
                   Vector(RD.point(b, n1, z * _ramp(b) + 0.003)), Vector(RD.point(b, n0, z * _ramp(b) + 0.003))]
            bi = len(part.verts)
            part.verts.extend(pts)
            part.faces.append([bi + 3, bi + 2, bi + 1, bi])
            part.face_mat.append(_mat_index(part, 'paint_road_yellow'))
            part.face_smooth.append(False)
            part.loop_uv.append([(n0, b), (n1, b), (n1, a), (n0, a)][::-1][::-1])
    s = 0.0
    while s < RD.S_DETAIL:
        seg = RD.segment(s + 0.01)
        if seg in ('C', 'E'):
            strip(s, min(s + 3.0, RD.S_DETAIL), -0.05, 0.05)
            s += 12.0
        else:
            nxt = min(s + 12.0, RD.S_DETAIL)
            strip(s, nxt, -0.15, -0.05)
            strip(s, nxt, 0.05, 0.15)
            s = nxt
    return part


# ------------------------------------------------------------------------------------------------ placements
def _clear(s, n, marks, r=3.0):
    x, y, _ = RD.point(s, n)
    if math.hypot(x - CAR_SET[0], y - CAR_SET[1]) < 12.0:
        return False
    if n > 0 and s < 60:
        return False
    if s < 12:
        return False
    if 660 < s < 745 and 0 < n < 45:          # diner lot + EAT pole
        return False
    if 912 < s < 950 and -26 < n < 0:         # billboard
        return False
    for (mx, my, mr) in marks:
        if math.hypot(x - mx, y - my) < mr:
            return False
    return True


def tree_placements(tier, marks):
    rng = random.Random(1909)
    out = []
    # edge row (both sides) to the detail end, then the tail
    for side in (-1, 1):
        s = 0.0
        while s < RD.S_END:
            s += 4.2 * rng.uniform(0.6, 1.4)
            n = side * rng.uniform(9.7, 13.5)
            if not _clear(s, n, marks):
                continue
            hero = any(a <= s <= b for a, b in HERO)
            tail = s > RD.S_DETAIL
            kind = 'snag' if rng.random() < 0.035 and not tail else 'pine'
            lod = 'L2' if tail else ('L0' if hero else 'L1')
            if tier == 'low':
                lod = 'L2' if (tail or not hero) else 'L1'
            out.append(dict(kind=kind, s=s, n=n, lod=lod, row=0))
        rows_ = ((16.0, 8.0), (21.0, 9.0), (26.5, 9.0), (32.0, 9.0), (37.0, 10.0))
        for row, (nn, gap) in enumerate(rows_, start=1):
            if tier == 'low' and row in (2, 4, 5):
                continue
            s = rng.uniform(0, 5)
            while s < RD.S_END:
                s += gap * rng.uniform(0.6, 1.4)
                n = side * (nn + rng.uniform(-2.0, 2.0))
                if not _clear(s, n, marks):
                    continue
                lod = 'L1' if (row == 1 and s < RD.S_DETAIL and tier != 'low') else 'L2'
                out.append(dict(kind='pine', s=s, n=n, lod=lod, row=row))
    for p in out:
        p['variant'] = rng.randrange(3)
        p['yaw'] = rng.uniform(0, math.tau)
        p['scale'] = rng.uniform(0.82, 1.27) if p['kind'] == 'pine' else rng.uniform(0.9, 1.35)
        p['tilt'] = (rng.uniform(0, math.tau), rng.uniform(0.0, 0.035))
    return out


OUTER_N = 190.0      # outer edge of the instanced crown bands (Medium/Max)


def crown_placements(tier):
    """Max/Medium: a band of instanced far crowns (pine L2) from n +-40 to +-100, plus an outer band to OUTER_N (+-190), so the C0 aerial reads crown by
    crown in a flash; the blanket under them fills the gaps and carries on to n +-250."""
    if tier == 'low':
        return []
    rng = random.Random(3131)
    out = []
    for side in (-1, 1):
        s = 160.0 if side > 0 else 0.0
        while s < RD.S_END:
            n = 41.0
            while n < 100.0:
                nn = n + rng.uniform(-2.5, 2.5)
                if not (side > 0 and 660 < s < 760 and nn < 60):
                    out.append(dict(s=s + rng.uniform(-3, 3), n=side * nn, variant=rng.randrange(3),
                                    yaw=rng.uniform(0, math.tau), scale=rng.uniform(0.8, 1.2)))
                n += 8.5 * rng.uniform(0.8, 1.2)
            s += 8.5 * rng.uniform(0.85, 1.15)
    # art review r1 (corridor_aerial): past n 100 the bare blanket read as smooth bald hills under the flash (a lit
    # Lambert sheet has no self-shadow), so the forest looked like a 100 m strip. An outer crown band (sparser, larger
    # L2) carries crown-by-crown texture to n +-190; the blanket under it is lowered like the inner band's.
    rng = random.Random(3137)
    for side in (-1, 1):
        s = 160.0 if side > 0 else 0.0
        while s < RD.S_END:
            n = 100.0 + rng.uniform(0.0, 5.0)
            while n < OUTER_N:
                out.append(dict(s=s + rng.uniform(-4, 4), n=side * (n + rng.uniform(-3, 3)), variant=rng.randrange(3),
                                yaw=rng.uniform(0, math.tau), scale=rng.uniform(0.9, 1.3)))
                n += 10.5 * rng.uniform(0.8, 1.2)
            s += 10.5 * rng.uniform(0.85, 1.15)
    return out


def understory_placements(tier, marks):
    if tier == 'low':
        return []
    rng = random.Random(2020)
    out = []
    for side in (-1, 1):
        s = 0.0
        while s < RD.S_DETAIL:
            s += 7.0 * rng.uniform(0.5, 1.5)
            n = side * rng.uniform(9.2, 10.6)
            if _clear(s, n, marks, 2.0):
                out.append(dict(s=s, n=n, variant=rng.randrange(3), yaw=rng.uniform(0, math.tau),
                                scale=rng.uniform(0.7, 1.4)))
    return out


# ------------------------------------------------------------------------------------------------ canopy
def canopy_part(side, tier):
    rng = random.Random(77 + side)
    part = kit.Part(f'rc9_canopy_{"l" if side > 0 else "r"}')
    # review r3 (corridor_aerial): the blanket read as smooth bald hills ending in a cliff at n 250. Now: crown pits
    # (dark gaps), denser outer columns, and a fall-off to the ground at n 330 so the edge is a slope, not a wall.
    ns = [40.0, 44.0, 49.0] + [54.0 + 6.0 * k for k in range(9)] + [110.0, 125.0, 140.0, 160.0, 180.0, 205.0, 230.0,
                                                                     255.0, 290.0, 330.0]
    if tier == 'low':
        ns = [40.0, 46.0, 55.0, 70.0, 90.0, 120.0, 160.0, 210.0, 260.0, 330.0]
    s0 = 160.0 if side > 0 else 0.0
    step = 18.0 if tier == 'low' else 6.0
    ss = [s0 + step * k for k in range(int((RD.S_END - s0) / step) + 1)]
    rows = []
    for s in ss:
        r = []
        for n in ns:
            if n <= 40.0:
                z = 3.0
            elif n <= 44.0:
                z = 11.0 + rng.uniform(-1.5, 1.5)
            else:
                # crown-scale lumps (one vertex ~ one crown near the road, 4 m relief) on a slow 18-24 m swell
                near = 1.0 if n < 110 else 0.8
                z = 18.0 + 6.0 * (0.5 + 0.5 * math.sin(s * 0.031 + n * 0.047 + side)) + near * rng.uniform(-2.5, 2.5)
                if rng.random() < 0.28:
                    z -= rng.uniform(3.0, 6.0)      # a gap between crowns (reads dark from the C0 crane)
                if n > 255.0:
                    z *= max(0.0, (330.0 - n) / 75.0) ** 0.7     # fall off to the ground: a slope, not a cliff
                if tier != 'low' and n < OUTER_N + 4:
                    z -= 5.5          # under the instanced crown band: fills the gaps between crowns
            r.append(Vector(RD.point(s, side * n, z)))
        rows.append(r)
    uvs = [[(n, s_) for n in ns] for s_ in ss]

    def up(j, k):
        q0, q1, q3 = rows[j][k], rows[j][k + 1], rows[j + 1][k]
        nrm = (q1 - q0).cross(q3 - q0)
        if k > 1:
            return nrm.z > 0
        road = Vector(RD.point(ss[j], 0, 0)) - q0
        return nrm.dot(Vector((road.x, road.y, 8.0))) > 0
    grid(part, rows, uvs, lambda j, k: 'canopy_far', lambda j, k: not up(j, k))
    return part


# ------------------------------------------------------------------------------------------------ power line
def pole_placements():
    out = []
    s = 867.5
    k = 0
    while s < RD.S_END - 10:
        out.append(dict(s=s, n=7.2, k=len(out)))
        s += 45.0
    s = 822.5
    while s > 15:
        out.append(dict(s=s, n=-7.2, k=len(out)))
        s -= 45.0
    out.sort(key=lambda p: p['s'])
    for i, p in enumerate(out):
        p['variant'] = 'lean' if abs(p['s'] - 552.5) < 1 else 'broken' if abs(p['s'] - 1047.5) < 1 else 'std'
    return out


def pole_meshes(coll):
    from house.treeline import _insulator_tops
    meshes, tops = {}, {}
    for var in ('std', 'lean', 'broken'):
        part = registry.parts('utility_pole', {'wiresCut': False, 'mat': 'bark_wet'}, 7400)[0]
        if var == 'broken':   # crossarm snapped at one brace: its west half hangs 25 deg
            M = Matrix.Translation((-0.2, 0, 8.65)) @ Matrix.Rotation(-0.44, 4, 'Y') @ Matrix.Translation((0.2, 0, -8.65))
            part.verts = [M @ v if (v.x < -0.2 and v.z > 8.0) else v for v in part.verts]
        ins = _insulator_tops(part)
        ob = part.build(coll)
        meshes[var] = ob.data
        tops[var] = ins
        bpy.data.objects.remove(ob)
    return meshes, tops


# ------------------------------------------------------------------------------------------------ build
def instanced(coll, name, mesh, items, extras):
    root = bpy.data.objects.new(name, None)
    coll.objects.link(root)
    tag(root, instances=len(items), **extras)
    objs = [root]
    for j, M in enumerate(items):
        ob = bpy.data.objects.new(f'{name}_{j}', mesh)
        coll.objects.link(ob)
        ob.parent = root
        ob.matrix_world = M
        if len(items) == 1:
            # a single item is exported as a plain mesh node (no EXT_mesh_gpu_instancing on the root), so the
            # mesh node itself must carry the detail extras (check_house: 'missing detail extra')
            tag(ob, **extras)
        objs.append(ob)
    return objs


def trs(s, n, z, yaw, scale, tilt=(0.0, 0.0)):
    x, y, _ = RD.point(s, n)
    ta, tr = tilt
    T_ = Matrix.Rotation(tr, 4, Vector((math.cos(ta), math.sin(ta), 0.0)))
    return Matrix.Translation((x, y, z)) @ T_ @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Diagonal((scale, scale, scale, 1.0))


def main():
    reset()
    coll = bpy.data.collections.new('corridor')
    bpy.context.scene.collection.children.link(coll)
    # the §2 landmarks (s, n, clear radius) + whatever the layout places in RC9
    marks = [(*RD.point(s_, n_)[:2], r_) for s_, n_, r_ in (
        (255, 6.2, 3.5), (510, 6.0, 3.0), (1100, -6.0, 3.0), (700, 24, 14.0), (688, 11.5, 4.0), (930, -15, 9.0),
        (198, 12.5, 2.5), (205, 13.5, 2.5), (212, 13.0, 2.5))]
    for p in landmarks():
        r = 3.0 if 'DEER' not in p['id'] else 2.0
        if p['type'] in ('diner',):
            r = 14.0
        if p['type'] == 'billboard':
            r = 9.0
        marks.append((p['pos'][0], p['pos'][1], r))
    # meshes (shared by every tier)
    lib = {}
    for lod in ('L0', 'L1', 'L2'):
        for v in range(3):
            ob = pines.pine(lod, v).build(coll, sharp_angle=180.0)
            lib[('pine', lod, v)] = ob.data
            bpy.data.objects.remove(ob)
    for v in range(3):
        ob = pines.understory(v).build(coll, sharp_angle=180.0)
        lib[('under', 'L1', v)] = ob.data
        bpy.data.objects.remove(ob)
    from house import treeline
    for v in range(3):
        lib[('snag', 'L1', v)] = treeline._grow('low', coll, {'height': 13.0, 'style': 'snag', 'fitHeight': False},
                                               9300 + 41 * v, f'rc9_snag_{v}')
    rp = registry.parts('reflector_post', {}, 7501)[0]
    ob = rp.build(coll)
    lib[('reflector', 'L1', 0)] = ob.data
    bpy.data.objects.remove(ob)
    pmesh, ptops = pole_meshes(coll)
    tri = {k: sum(len(f.vertices) - 2 for f in m.polygons) for k, m in lib.items()}
    log('mesh tris', {f'{a}_{b}{c}': t for (a, b, c), t in tri.items()})
    stats = {}
    SCRATCH.mkdir(parents=True, exist_ok=True)
    (SCRATCH / 'road-rc9.json').write_text(json.dumps(RD.definition(), indent=1) + '\n')
    review = bool(ARGS.get('review'))
    for tier in (('max',) if review else TIERS):
        objs = []
        rng = random.Random(11)
        road = road_part(tier).build(coll, sharp_angle=60.0)
        tag(road, surface='road')
        paint = paint_part(random.Random(5)).build(coll, sharp_angle=180.0)
        tag(paint, surface='paint')
        objs += [road, paint]
        for side in (-1, 1):
            cp = canopy_part(side, tier).build(coll, sharp_angle=180.0)
            tag(cp, canopy=True)
            objs.append(cp)
        trees = tree_placements(tier, marks)
        groups = {}
        chunk = CHUNK * (2 if tier == 'low' else 1)
        for p in trees:
            v = 0 if (tier == 'low' and p['kind'] == 'snag') else p['variant']
            key = ('snag' if p['kind'] == 'snag' else 'pine', 'L1' if p['kind'] == 'snag' else p['lod'], v,
                   int(p['s'] // chunk))
            sc = p['scale'] * (1.0 if p['kind'] == 'pine' else 1.0)
            groups.setdefault(key, []).append(trs(p['s'], p['n'], -0.05, p['yaw'], sc, p['tilt']))
        for p in crown_placements(tier):
            groups.setdefault(('pine', 'L2', p['variant'], int(p['s'] // chunk)), []).append(
                trs(p['s'], p['n'], -0.05, p['yaw'], p['scale']))
        for p in understory_placements(tier, marks):
            groups.setdefault(('under', 'L1', p['variant'], int(p['s'] // chunk)), []).append(
                trs(p['s'], p['n'], -0.02, p['yaw'], p['scale']))
        # delineators: 60 m on bends, 120 m on straights, both sides, 25 % missing or leaning
        r2 = random.Random(31)
        s = 10.0
        while s < RD.S_DETAIL:
            for side in (-1, 1):
                u = r2.random()
                if u < 0.12:
                    continue
                h = RD.heading(s)
                yaw = math.atan2(math.cos(h), -math.sin(h))          # front (-y local) faces +s: westbound drivers
                tilt = (r2.uniform(0, math.tau), r2.uniform(0.15, 0.4)) if u > 0.87 else (0.0, 0.0)
                groups.setdefault(('reflector', 'L1', 0, int(s // chunk)), []).append(
                    trs(s, side * 4.9, -0.02, yaw + r2.uniform(-0.08, 0.08), 1.0, tilt))
            s += 60.0 if RD.segment(s) in ('B', 'D') else 120.0
        for (kind, lod, v, ch), items in sorted(groups.items()):
            name = f'rc9_{kind}_{lod}{v}_c{ch}'
            objs += instanced(coll, name, lib[(kind, lod, v)], items,
                              {'lod': lod, 'chunk': ch, 's_range': [ch * chunk, (ch + 1) * chunk], 'species': kind})
        # power line poles + the wire marker
        poles = pole_placements()
        wire_pts = []
        pg = {}
        for p in poles:
            h = RD.heading(p['s'])
            yaw = h + math.pi / 2
            tilt = (h, math.radians(6)) if p['variant'] == 'lean' else (0.0, 0.0)
            M = trs(p['s'], p['n'], 0.0, yaw, 1.0, tilt)
            var = 'std' if tier == 'low' else p['variant']
            pg.setdefault(var, []).append(M)
            wire_pts.append([[round(c, 3) for c in (M @ v)] for v in ptops[var]])
        for var, items in pg.items():
            objs += instanced(coll, f'rc9_pole_{var}', pmesh[var], items, {'species': 'utility_pole'})
        line = bpy.data.objects.new('P_RC9_LINE', None)
        coll.objects.link(line)
        tag(line, line=True, wire_points=json.dumps(wire_pts), span_m=45.0, sag_m=1.2, conductors=4,
            broken_span=int(len(wire_pts) * 0.62), note='runtime catenaries: 3 conductors + neutral, min 1 px')
        marker = bpy.data.objects.new('P_RC9_ROAD', None)
        coll.objects.link(marker)
        rdef = RD.definition()
        rdef.pop('polyline')            # 17 KB of JSON: the runtime evaluates the segments (polyline in scratch/opening)
        tag(marker, road=json.dumps(rdef))
        objs += [line, marker]
        if review:      # manual job corridor-review: render the max-tier set under the shot lights, no export
            from house import review_corridor
            review_corridor.render(objs, coll)
            return
        d = OUT / tier
        size = export_glb(d / 'details_corridor.glb', objs, 'static', export_gpu_instances=True)
        info = inspect_glb(d / 'details_corridor.glb')
        n_tris = 0
        for o in objs:
            if o.type == 'MESH':
                n_tris += sum(len(f.vertices) - 2 for f in o.data.polygons)
        stats[tier] = {'bytes': size, 'trees': len(trees), 'instanced_nodes': len(groups), 'poles': len(poles),
                       'triangles_all_instances': n_tris,
                       'lods': {l: sum(1 for t in trees if t['lod'] == l and t['kind'] == 'pine') for l in ('L0', 'L1', 'L2')},
                       'snags': sum(1 for t in trees if t['kind'] == 'snag')}
        log(f'{tier}: details_corridor.glb {size / 1024:.0f} KiB, {stats[tier]}')
        for o in objs:                     # free every name for the next tier (P_RC9_LINE must not become .001)
            bpy.data.objects.remove(o)
    write_json(REPO / '.cache' / 'corridor' / 'corridor.json', {'stats': stats, 'mesh_tris': {
        f'{a}_{b}{c}': t for (a, b, c), t in tri.items()}})
    result({'job': 'corridor', 'stats': stats})


if __name__ == '__main__':
    main()
