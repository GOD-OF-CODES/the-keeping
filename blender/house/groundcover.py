"""Ground cover over the terrain: winter grass tussocks and tufts, flat weed rosettes, dead seed stalks and loose
gravel -> public/assets/<tier>/details_groundcover.glb (EXT_mesh_gpu_instancing: one glTF node per mesh variant
and room, each instanced; three r186 GLTFLoader builds an InstancedMesh per primitive, verified in
examples/jsm/loaders/GLTFLoader.js `GLTFMeshGpuInstancing`).

Where things grow (a neglected farm yard in late autumn / winter, after weeks of rain):
- open yard: sparse short tufts, a few rosettes; dense, tall tussocks along everything a mower never reaches:
  fence lines, the house foundation, post/mailbox/sign/pump bases, tree roots, the ditch banks;
- the gravel drive: a grass strip down the crown between the wheel ruts, grass encroaching 0-0.4 m from both
  edges, nothing in the ruts or puddles; road: weeds only in the cracks at the asphalt edge;
- loose gravel (2-6 cm stones) thrown to the drive edges and the crown, on the road shoulder.
Real sizes: tufts 10-25 cm, tussocks 30-60 cm (Deschampsia / fescue), blades 3-6 mm wide; dock/plantain rosettes
25-40 cm across; dead stalks 50-110 cm. Material ids: grass_wet (double-sided blades/leaves), bark_wet (dead
stalks: rain-dark), gravel_wet (stones). Not in the lightmap (probe-lit like every `details_*` node, never an
occluder in the bakes). Tier density: Max 1, Medium 0.6, Low 0.3 (no stones on Low).
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

from house import terrain

TIER_DENSITY = {'max': 1.0, 'medium': 0.6, 'low': 0.3}
GRASS = 'grass_wet@2s'


def _turf_material():
    """Dead winter turf is straw-coloured (albedo ~0.15-0.25), lighter than the wet thatch / soil it lies on; with
    the same id as the ground (grass_wet, avg albedo 0.05) the blades vanish into it in-game. Use `grass_dead` as
    soon as material-spec.json has it (requested from the lead, docs/CONTRACT-CHANGES.md), grass_wet until then."""
    import json
    from lib.scene import SHARED
    try:
        spec = json.loads((SHARED / 'material-spec.json').read_text())
        ids = {m['id'] for m in (spec['materials'] if isinstance(spec, dict) else spec)}
    except (OSError, ValueError, KeyError):
        ids = set()
    return 'grass_dead@2s' if 'grass_dead' in ids else GRASS


TURF = _turf_material()
STALK = 'bark_wet'
STONE = 'gravel_wet'
FENCE_Y = -28.25


# ------------------------------------------------------------------------------------------------ meshes
class MeshBuf:
    def __init__(self):
        self.v, self.f, self.uv = [], [], []

    def quad_strip(self, left, right, tip):
        """left/right: lists of points up a blade (same length), tip: final point. UV0 metres (u across, v up)."""
        base = len(self.v)
        n = len(left)
        s = 0.0
        vs = [0.0]
        for i in range(1, n):
            s += ((left[i] + right[i]) / 2 - (left[i - 1] + right[i - 1]) / 2).length
            vs.append(s)
        s_tip = s + (tip - (left[-1] + right[-1]) / 2).length
        for i in range(n):
            self.v += [left[i], right[i]]
        self.v.append(tip)
        w0 = (left[0] - right[0]).length
        for i in range(n - 1):
            a, b, c, d = base + 2 * i, base + 2 * i + 1, base + 2 * i + 3, base + 2 * i + 2
            self.f.append((a, b, c, d))
            self.uv.append([(0, vs[i]), (w0, vs[i]), (w0, vs[i + 1]), (0, vs[i + 1])])
        t = base + 2 * n
        self.f.append((base + 2 * n - 2, base + 2 * n - 1, t))
        self.uv.append([(0, vs[-1]), (w0, vs[-1]), (w0 / 2, s_tip)])

    def add_bm(self, bm):
        base = len(self.v)
        uvl = bm.loops.layers.uv.active
        for v in bm.verts:
            self.v.append(v.co.copy())
        for f in bm.faces:
            self.f.append(tuple(base + v.index for v in f.verts))
            self.uv.append([tuple(l[uvl].uv) if uvl else (l.vert.co.x, l.vert.co.y) for l in f.loops])
        bm.free()

    def to_mesh(self, name, mat):
        from props.kit import spec_material
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(p) for p in self.v], [], self.f)
        me.validate(clean_customdata=False)
        uv = me.uv_layers.new(name='UVMap')
        flat = [c for face in self.uv for uv_ in face for c in uv_]
        if len(flat) == len(uv.data) * 2:
            uv.data.foreach_set('uv', flat)
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
        me.materials.append(spec_material(mat))
        return me


def blade(buf, rng, root, az, h, w, lean, fold=0.0, segs=3):
    """One grass blade: a tapering strip arching away from the tuft centre; `fold` > 0 kinks it over (dead,
    rain-flattened blades) so the tip hangs toward the ground."""
    out = Vector((math.cos(az), math.sin(az), 0.0))
    side = Vector((-out.y, out.x, 0.0))
    twist = rng.uniform(-0.6, 0.6)
    pts = []
    for i in range(segs + 1):
        t = i / (segs + 1)
        z = h * t
        x = lean * h * t * t
        if fold and t > 0.45:
            k = (t - 0.45) / 0.55
            z = h * 0.45 + h * 0.55 * (k * (1 - fold * 1.6 * k))
            x = lean * h * 0.2 + h * fold * k * 0.9
        pts.append(root + out * x + Vector((0, 0, z)))
    tip_t = 1.0
    if fold:
        tip = root + out * (lean * h * 0.2 + h * fold * 0.9) + Vector((0, 0, h * 0.45 + h * 0.55 * (1 - fold * 1.6)))
    else:
        tip = root + out * (lean * h * tip_t) + Vector((0, 0, h))
    left, right = [], []
    for i, p in enumerate(pts):
        t = i / (segs + 1)
        ww = w * (1.0 - 0.75 * t ** 1.4)
        s = side * math.cos(twist * t) + Vector((0, 0, 1)) * math.sin(twist * t) * 0.2
        left.append(p - s * ww / 2)
        right.append(p + s * ww / 2)
    buf.quad_strip(left, right, tip)


def tuft(rng, kind):
    buf = MeshBuf()
    if kind == 'tuft':          # short yard tuft, 10-25 cm
        n, hr, wr, rr = rng.randint(12, 17), (0.09, 0.24), (0.003, 0.005), 0.03
    else:                       # tussock along fences / foundations / ditches, 30-60 cm
        n, hr, wr, rr = rng.randint(18, 24), (0.25, 0.6), (0.003, 0.0055), 0.06
    for _ in range(n):
        az = rng.uniform(0, math.tau)
        rad = rr * math.sqrt(rng.random())
        root = Vector((math.cos(az) * rad, math.sin(az) * rad, -0.01))
        h = rng.uniform(*hr)
        fold = rng.uniform(0.3, 0.8) if rng.random() < (0.25 if kind == 'tuft' else 0.4) else 0.0
        blade(buf, rng, root, az + rng.uniform(-0.5, 0.5), h, rng.uniform(*wr), rng.uniform(0.15, 0.6), fold,
              segs=3 if kind == 'tussock' else 2)
    return buf


def turf(rng):
    """A 0.8 x 0.8 m patch of matted winter sward for the band the player walks through (drive verges, porch
    front, the gate). Real numbers: a neglected fescue / bluegrass sward in late autumn is 8-22 cm tall, most leaves
    lodged (rain-flattened) in a common direction, blades 4-8 mm wide, ~1000-3000 tillers per m^2 in clumps 5-8 cm
    across. Rendered as ~330 blades per m^2 (a tenth of the real count at about twice the real width, so the blade
    AREA per m^2 is about right): 190 single-triangle leaves (two thirds lodged flat, the rest standing) + 20 three-triangle arching /
    folded ones."""
    buf = MeshBuf()
    lodge = rng.uniform(0, math.tau)
    clumps = [(rng.uniform(-0.38, 0.38), rng.uniform(-0.38, 0.38)) for _ in range(rng.randint(22, 28))]
    for _ in range(20):
        cx, cy = rng.choice(clumps)
        a = rng.uniform(0, math.tau)
        r = 0.04 * math.sqrt(rng.random())
        root = Vector((cx + math.cos(a) * r, cy + math.sin(a) * r, -0.012))
        fold = rng.uniform(0.4, 0.9) if rng.random() < 0.55 else 0.0
        blade(buf, rng, root, lodge + rng.gauss(0.0, 0.7), rng.uniform(0.12, 0.24), rng.uniform(0.006, 0.01),
              rng.uniform(0.4, 1.1), fold, segs=1)
    for k in range(190):
        cx, cy = rng.choice(clumps) if rng.random() < 0.75 else (rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4))
        a = rng.uniform(0, math.tau)
        r = 0.05 * math.sqrt(rng.random())
        root = Vector((cx + math.cos(a) * r, cy + math.sin(a) * r, -0.012))
        az = lodge + rng.gauss(0.0, 1.0) if rng.random() < 0.7 else rng.uniform(0, math.tau)
        if k < 130:     # lodged: lying 15-40 deg off the ground, reaching 10-30 cm
            h, reach, w = rng.uniform(0.03, 0.09), rng.uniform(0.1, 0.3), rng.uniform(0.009, 0.014)
        else:           # the few still standing
            h, reach, w = rng.uniform(0.08, 0.2), rng.uniform(0.02, 0.1), rng.uniform(0.006, 0.01)
        blade(buf, rng, root, az, h, w, reach / h, 0.0, segs=0)
    return buf


def rosette(rng):
    """Dock / plantain rosette lying flat: 6-8 broad leaves 10-18 cm long, 3-6 cm wide, edges curled up."""
    buf = MeshBuf()
    n = rng.randint(6, 8)
    for k in range(n):
        az = math.tau * k / n + rng.uniform(-0.25, 0.25)
        L = rng.uniform(0.1, 0.18)
        W = rng.uniform(0.03, 0.06)
        out = Vector((math.cos(az), math.sin(az), 0.0))
        side = Vector((-out.y, out.x, 0.0))
        left, right = [], []
        for i in range(4):
            t = i / 4
            c = out * (L * t) + Vector((0, 0, 0.012 + 0.03 * t * (1 - t) - 0.01 * t))
            ww = W * math.sin(math.pi * min(0.95, 0.12 + t)) * 0.5
            left.append(c - side * ww + Vector((0, 0, ww * 0.35)))
            right.append(c + side * ww + Vector((0, 0, ww * 0.35)))
        buf.quad_strip(left, right, out * L + Vector((0, 0, 0.004)))
    return buf


def stalks(rng):
    """2-4 dead seed stalks (goldenrod / dock): 50-110 cm, 3 mm, leaning, with a ragged seed-head cluster."""
    from props.kit import tube
    buf = MeshBuf()
    for _ in range(rng.randint(2, 4)):
        h = rng.uniform(0.5, 1.1)
        lean = Vector((rng.uniform(-0.25, 0.25), rng.uniform(-0.25, 0.25), 1.0))
        base = Vector((rng.uniform(-0.04, 0.04), rng.uniform(-0.04, 0.04), -0.02))
        pts = []
        for i in range(5):
            t = i / 4
            bend = Vector((lean.x * t * t * h, lean.y * t * t * h, h * t))
            pts.append(base + bend)
        bm = tube(pts, 0.0028, sides=3, radii=[1.0, 0.9, 0.75, 0.6, 0.45])
        buf.add_bm(bm)
        top = pts[-1]
        for j in range(rng.randint(5, 9)):     # seed-head plumes: short drooping side shoots
            a = rng.uniform(0, math.tau)
            p0 = top - Vector((0, 0, rng.uniform(0.0, 0.16)))
            L = rng.uniform(0.04, 0.1)
            p1 = p0 + Vector((math.cos(a) * L, math.sin(a) * L, -L * rng.uniform(0.1, 0.6)))
            buf.add_bm(tube([p0, (p0 + p1) / 2 + Vector((0, 0, 0.01)), p1], 0.0035, sides=3, radii=[0.8, 1.0, 0.5]))
    return buf


def stone(rng):
    """A rounded, flattened gravel stone, 2-6 cm (scaled per instance)."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.5)
    seed = rng.uniform(0, 100)
    for v in bm.verts:
        n = noise.noise(v.co * 2.2 + Vector((seed, 0, 0)))
        v.co *= 1.0 + 0.28 * n
        v.co.z *= 0.55
        v.co.x *= rng.uniform(0.95, 1.05) * 1.25
    uvl = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for l in f.loops:
            l[uvl].uv = (l.vert.co.x * 0.05 + seed, l.vert.co.y * 0.05)
    buf = MeshBuf()
    buf.add_bm(bm)
    return buf


# ------------------------------------------------------------------------------------------------ placement
def _footprint(P):
    rs = [r for r in P.L['rooms'] if r.get('kind') == 'interior' and r.get('floor') != 'car' and r['id'] != 'CAR']
    x0 = min(r['rect'][0] for r in rs)
    y0 = min(r['rect'][1] for r in rs)
    x1 = max(r['rect'][2] for r in rs)
    y1 = max(r['rect'][3] for r in rs)
    return (x0 - 0.35, y0 - 2.9, x1 + 0.35, y1 + 0.35)     # walls + the porch deck (y -2.8)


def _inside(rect, x, y, m=0.0):
    return rect[0] - m <= x <= rect[2] + m and rect[1] - m <= y <= rect[3] + m


def _edge_dist(rect, x, y):
    return min(x - rect[0], rect[2] - x, y - rect[1], rect[3] - y)


def _rect_dist(rect, x, y):
    dx = max(rect[0] - x, 0.0, x - rect[2])
    dy = max(rect[1] - y, 0.0, y - rect[3])
    return math.hypot(dx, dy)


TURF_CELL = 14.0
TURF_STEP = 0.7          # turf patch grid (patches are 0.8 m: neighbours overlap a little, no gaps)
TURF_NEAR, TURF_FADE = 2.6, 2.4     # full sward within 2.6 m of the drive / house / gate, fading out over 2.4 m


def turf_weight(fp, x, y):
    """Where the player can see grass up close: the drive and its verges, round the house, the gate and fence line."""
    d = min(_rect_dist(terrain.DRIVE, x, y), _rect_dist(fp, x, y), math.hypot(x - 1.0, y + 28.6) * 0.8)
    return 1.0 if d < TURF_NEAR else max(0.0, 1.0 - (d - TURF_NEAR) / TURF_FADE)


def placements(P, rng):
    """[(kind, x, y, scale, yaw, rank)] over the terrain rect; rank in [0, 1) selects the tier subset."""
    zs = terrain.zones(P)
    fp = _footprint(P)
    drive = terrain.DRIVE
    x0, y0, x1, y1 = terrain.RECT
    pads = []
    for p in P.L['props']:
        if p.get('room') not in ('EXT1', 'EXT2') or p['type'] in ('porch', 'foundation_skirt', 'harlan_pose_marker',
                                                                   'door_knocker', 'bell_pull_knob', 'sign_lantern',
                                                                   'vacancy_plate'):
            continue
        r = {'dead_tree': 0.9, 'sedan': 0.0, 'wreck_sedan': 2.2, 'gas_pump': 0.6, 'rain_barrel': 0.45}.get(p['type'], 0.35)
        pads.append((p['pos'][0], p['pos'][1], r, p['type']))
    out = []
    step = 0.33
    nx, ny = int((x1 - x0) / step), int((y1 - y0) / step)
    for j in range(ny):
        for i in range(nx):
            x = x0 + (i + rng.random()) * step
            y = y0 + (j + rng.random()) * step
            if _inside(fp, x, y):
                continue
            mat = terrain.mat_at(zs, x, y)
            if mat == 'asphalt_wet':
                e = min(abs(y - terrain.ROAD[0]), abs(y - terrain.ROAD[1]))
                dens, kinds = (2.0 if e < 0.12 else 0.0), (('tuft', 0.7), ('rosette', 0.3))
            elif y < terrain.DITCH[1] + 0.25 and y > terrain.DITCH[0] - 0.2:
                dens, kinds = 0.25, (('tussock', 1.0),)                       # standing water: a few reeds
            elif mat == 'gravel_wet' and _inside(drive, x, y):
                # two-track gravel (terrain.DRIVE_LINES): grass creeps 0-0.3 m onto the gravel along every boundary
                # (shoulders and crown), never into the tyre lines themselves
                rut = min(abs(x - terrain.RUTS_X[0]), abs(x - terrain.RUTS_X[1]))
                bd = terrain.drive_edge_dist(x, y)
                dens = 0.0
                if rut > 0.25:
                    dens = 12.0 * max(0.0, 1 - bd / 0.3) ** 1.3 + 0.04
                if y > drive[3] - 0.6 or y < drive[1] + 0.3:
                    dens *= 0.5
                kinds = (('tuft', 0.88), ('rosette', 0.12))
            elif mat == 'gravel_wet':
                dens, kinds = 0.25, (('tuft', 0.8), ('rosette', 0.2))           # road shoulder
            elif mat == 'mud_wet':
                ed = min(_edge_dist(r, x, y) for r, m in zs if m == 'mud_wet' and _inside(r, x, y))
                dens, kinds = 0.08 + 2.0 * max(0.0, 1 - ed / 0.5) ** 2, (('tuft', 0.5), ('rosette', 0.3), ('stalks', 0.2))
            else:   # grass (the turf patches carry the base layer near the play area: fewer lone tufts there)
                dens = 0.55 + 0.45 * max(0.0, noise.noise(Vector((x * 0.25, y * 0.25, 3.3))))
                dens *= 1.0 - 0.5 * turf_weight(fp, x, y)
                kinds = (('tuft', 0.82), ('tussock', 0.1), ('rosette', 0.06), ('stalks', 0.02))
                near = 0.0
                ed = min(abs(x - drive[0]), abs(x - drive[2])) if drive[1] - 0.5 < y < drive[3] + 0.5 else 9
                if _inside(drive, x, y):
                    ed = terrain.drive_edge_dist(x, y)      # the shoulders / crown of the two-track
                    near = max(near, 3.0 * max(0.0, 1 - ed / 0.4))   # a ragged fringe of clumps at the gravel
                near = max(near, 1.6 * max(0.0, 1 - ed / 1.4))
                if abs(y - FENCE_Y) < 0.7 and not (drive[0] - 0.3 < x < drive[2] + 0.3):
                    near = max(near, 4.0 * (1 - abs(y - FENCE_Y) / 0.7))
                if _inside(fp, x, y, 0.9):
                    near = max(near, 3.5 * (1 - max(0.0, -_edge_dist(fp, x, y)) / 0.9))
                if y < terrain.DITCH[1] + 0.9 and y > terrain.DITCH[0] - 0.6:
                    near = max(near, 3.0)
                for px, py, r, t in pads:
                    d = math.hypot(x - px, y - py)
                    if r > 0 and d < r + 0.8:
                        near = max(near, (3.5 if t != 'wreck_sedan' else 2.0) * (1 - max(0.0, d - r) / 0.8))
                dens += near
                if near > 1.0:
                    kinds = (('tussock', 0.55), ('tuft', 0.3), ('stalks', 0.1), ('rosette', 0.05))
            for px, py, r, d in terrain.PUDDLES:
                if math.hypot(x - px, y - py) < r * 0.85:
                    dens = 0.0
            for px, py, r, t in pads:     # nothing growing through a post, a car body or a tree trunk
                if t != 'dead_tree' and math.hypot(x - px, y - py) < min(r, 0.35) * 0.6:
                    dens = 0.0
                if t == 'dead_tree' and math.hypot(x - px, y - py) < 0.45:
                    dens = 0.0
            if rng.random() < dens * step * step:
                k = rng.random()
                acc = 0.0
                kind = kinds[-1][0]
                for kk, w in kinds:
                    acc += w
                    if k < acc:
                        kind = kk
                        break
                out.append((kind, x, y, rng.uniform(0.7, 1.3), rng.uniform(0, math.tau), rng.random()))
            # loose gravel: drive edges + crown, the road shoulder
            gd = 0.0
            if mat == 'gravel_wet':
                if _inside(drive, x, y):
                    gd = 10.0 * max(0.0, 1 - terrain.drive_edge_dist(x, y) / 0.5) + 1.2
                else:
                    gd = 5.0
            elif _inside(drive, x, y):          # gravel thrown onto the grass shoulders / crown by the tyres
                gd = 6.0 * max(0.0, 1 - terrain.drive_edge_dist(x, y) / 0.35)
            if gd > 0.0:
                for _ in range(3):
                    if rng.random() < gd * step * step / 3:
                        out.append(('stone', x + rng.uniform(-0.15, 0.15), y + rng.uniform(-0.15, 0.15),
                                    rng.uniform(0.02, 0.06), rng.uniform(0, math.tau), rng.random()))
    # turf patches on a jittered grid over the grass zones near the play area (see turf())
    tx, ty = int((x1 - x0) / TURF_STEP), int((y1 - y0) / TURF_STEP)
    for j in range(ty):
        for i in range(tx):
            x = x0 + (i + 0.5 + rng.uniform(-0.3, 0.3)) * TURF_STEP
            y = y0 + (j + 0.5 + rng.uniform(-0.3, 0.3)) * TURF_STEP
            w = turf_weight(fp, x, y)
            if w <= 0.0 or rng.random() > w or _inside(fp, x, y, 0.25):
                continue
            if terrain.mat_at(zs, x, y) != 'grass_wet':
                continue
            if _inside(drive, x, y, 0.35) and not (_inside(drive, x, y) and terrain.drive_edge_dist(x, y) > 0.3):
                continue
            if terrain.DITCH[0] - 0.6 < y < terrain.DITCH[1] + 0.6 or terrain.ROAD[0] - 0.3 < y < terrain.ROAD[1] + 0.3:
                continue
            if any(math.hypot(x - px, y - py) < r * 0.9 + 0.3 for px, py, r, d in terrain.PUDDLES):
                continue
            if any(math.hypot(x - px, y - py) < (0.5 if t == 'dead_tree' else min(r, 0.35) * 0.6 + 0.35)
                   for px, py, r, t in pads):
                continue
            out.append(('turf', x, y, rng.uniform(0.85, 1.2), rng.uniform(0, math.tau), rng.random()))
    # the grass crown between the wheel tracks: a matted strip of turf patches down its middle
    yy = drive[1] + 2.0
    while yy < drive[3] - 2.4:
        c0, c1 = terrain.drive_line_x(1, yy), terrain.drive_line_x(2, yy)
        if c1 - c0 > 0.5 and not any(math.hypot((c0 + c1) / 2 - px, yy - py) < r * 0.9 + 0.3
                                     for px, py, r, d in terrain.PUDDLES):
            out.append(('turf', (c0 + c1) / 2 + rng.uniform(-0.05, 0.05), yy, rng.uniform(0.7, 0.85),
                        rng.uniform(0, math.tau), rng.random()))
        yy += rng.uniform(0.5, 0.7)
    return out


# ------------------------------------------------------------------------------------------------ build + export
def build(P, terrain_ob, collection_name='__groundcover'):
    """Returns {tier: [root empties]} ready for export (call export_tiers)."""
    rng = random.Random(9187)
    variants = {
        'tuft': [tuft(random.Random(100 + i), 'tuft') for i in range(4)],
        'tussock': [tuft(random.Random(200 + i), 'tussock') for i in range(3)],
        'rosette': [rosette(random.Random(300 + i)) for i in range(2)],
        'stalks': [stalks(random.Random(400 + i)) for i in range(2)],
        'stone': [stone(random.Random(500 + i)) for i in range(3)],
        'turf': [turf(random.Random(600 + i)) for i in range(3)],
    }
    mats = {'turf': TURF, 'tuft': GRASS, 'tussock': GRASS, 'rosette': GRASS, 'stalks': STALK, 'stone': STONE}
    meshes = {k: [buf.to_mesh(f'gc_{k}_{i}', mats[k]) for i, buf in enumerate(v)] for k, v in variants.items()}
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(terrain_ob, dg)
    mw = terrain_ob.matrix_world
    pl = placements(P, rng)
    x0, y0 = terrain.RECT[0], terrain.RECT[1]
    coll = bpy.data.collections.new(collection_name)
    bpy.context.scene.collection.children.link(coll)
    items = []
    for kind, x, y, s, yaw, rank in pl:
        hit = bvh.ray_cast(Vector((x, y, 2.0)), Vector((0, 0, -1)))
        loc, nrm = (hit[0], hit[1]) if hit[0] is not None else (Vector((x, y, 0.0)), Vector((0, 0, 1)))
        loc = mw @ loc
        vi = rng.randrange(len(meshes[kind]))
        if kind == 'turf':     # one variant per turf cell: one draw call per cell (yaw/scale hide the repeat)
            ci, cj = int((x - x0) // TURF_CELL), int((y - y0) // TURF_CELL)
            vi = (ci * 7 + cj * 13) % len(meshes[kind])
        tilt = Vector((0, 0, 1)).lerp(nrm, 0.6 if kind != 'stone' else 1.0).normalized()
        R = Vector((0, 0, 1)).rotation_difference(tilt).to_matrix().to_4x4() @ Matrix.Rotation(yaw, 4, 'Z')
        if kind == 'stone':
            loc = loc + Vector((0, 0, s * 0.12))
            S = Matrix.Diagonal((s, s, s, 1.0))
        else:
            S = Matrix.Diagonal((s, s, s * rng.uniform(0.85, 1.15), 1.0))
        room = 'EXT1' if y < -28.0 else 'EXT2'
        # turf is spread over ~1000 m^2: split it into 14 m cells so each InstancedMesh's bounding sphere is
        # small enough for frustum culling to drop the patches behind the camera (one variant per cell)
        cell = f'_c{int((x - x0) // TURF_CELL)}x{int((y - y0) // TURF_CELL)}' if kind == 'turf' else ''
        items.append((kind, vi, room + cell, Matrix.Translation(loc) @ R @ S, rank))
    counts = {}
    for it in items:
        counts[it[0]] = counts.get(it[0], 0) + 1
    tris = {k: [sum(len(p.vertices) - 2 for p in me.polygons) for me in v] for k, v in meshes.items()}
    return dict(items=items, meshes=meshes, coll=coll, counts=counts, tris=tris)


def export_tiers(G, out_dirs, export_glb):
    """One GLB per tier: per (kind, variant, room) an Empty whose children share one mesh -> EXT_mesh_gpu_instancing."""
    stats = {}
    for tier, d in out_dirs.items():
        dens = TIER_DENSITY[tier]
        objs = []
        tri_total = 0
        groups = {}
        for kind, vi, room, M, rank in G['items']:
            if rank >= dens or (kind == 'stone' and tier == 'low'):
                continue
            groups.setdefault((kind, vi, room), []).append(M)
        for (kind, vi, room), Ms in sorted(groups.items()):
            root = bpy.data.objects.new(f'groundcover_{kind}{vi}_{room}', None)
            G['coll'].objects.link(root)
            for k, v in {'room': room.split('_c')[0], 'detail': True, 'kind': 'detail', 'groundcover': kind,
                         'atlas': 'LM_EXTERIOR', 'instances': len(Ms)}.items():
                root[k] = v
            objs.append(root)
            me = G['meshes'][kind][vi]
            for i, M in enumerate(Ms):
                ob = bpy.data.objects.new(f'gc_{kind}{vi}_{room}_{i}', me)
                G['coll'].objects.link(ob)
                ob.parent = root
                ob.matrix_world = M
                objs.append(ob)
            tri_total += len(Ms) * G['tris'][kind][vi]
        size = export_glb(d / 'details_groundcover.glb', objs, 'static', export_gpu_instances=True)
        stats[tier] = {'bytes': size, 'nodes': len(groups), 'instances': sum(len(v) for v in groups.values()),
                       'triangles': tri_total}
        for ob in objs:
            bpy.data.objects.remove(ob)
    return stats
