"""County Road 9 corridor (RC9): the one analytic centreline Blender and the runtime share (docs/C1-OPENING.md §2).

PLAN space (x east, y north, z up, metres). Chainage s runs EASTBOUND from x = 20 (EXT1's east edge); offset n is
positive to the LEFT of eastbound (= the westbound driver's right). The westbound lane centre is n = +1.75; the gate
is at s = -17.2 (on EXT1's existing asphalt, outside this corridor).

  seg  s from -> to      kind                start (PLAN)        heading (rad)    arc centre, R
  A    0 -> 240          straight            (20, -33)           0                -
  B    240 -> 397.08     arc 30 deg, CW      (260, -33)          0 -> -pi/6       (260, -333), 300
  C    397.08 -> 847.08  straight            (410.0, -73.19)     -pi/6            -
  D    847.08 -> 1004.16 arc 30 deg, CCW     (799.71, -298.19)   -pi/6 -> 0       (949.71, -38.38), 300
  E    1004.16 -> 1550   straight (tail > 1250 low detail, fades into fog)  (949.71, -338.38)  0

SINGLE SOURCE (round C): src/shared/road-rc9.json (written by the runtime lane) — every constant below is read from
it; nothing about the road's shape is hard-coded here. `definition()` returns that JSON plus a 2 m polyline (the
corridor job writes it to scratch/opening/road-rc9.json for review).
"""
import json
import math
import os

_JSON = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'shared', 'road-rc9.json')
with open(_JSON) as _f:
    SPEC = json.load(_f)
_SEG = {g['id']: g for g in SPEC['segments']}
assert [g['id'] for g in SPEC['segments']] == ['A', 'B', 'C', 'D', 'E'], 'road-rc9.json: expected segments A..E'
assert _SEG['A']['kind'] == _SEG['C']['kind'] == _SEG['E']['kind'] == 'straight'
assert _SEG['B']['turn'] == 'cw' and _SEG['D']['turn'] == 'ccw' and _SEG['B']['radius'] == _SEG['D']['radius']

R = float(_SEG['B']['radius'])
# the JSON stores radians to 6 decimals (-0.523599); snap to 1e-4 degree so ARC is exactly pi/6 again and the
# re-export stays bit-identical to the hard-coded original
ARC = math.radians(round(math.degrees(abs(float(_SEG['B']['heading1']))), 4))
S_A = float(_SEG['A']['s1'])
S_B = S_A + R * ARC
S_C = S_B + (float(_SEG['C']['s1']) - float(_SEG['C']['s0']))     # straight C length (450 m)
S_D = S_C + R * ARC
S_END = float(SPEC['end_s'])
S_DETAIL = float(SPEC['detail_end_s'])
X0, Y0 = (float(v) for v in _SEG['A']['start'])
GATE_S = float(SPEC['gate_s'])


def _c_start():
    return (S_A + X0 + R * math.sin(ARC), Y0 - R * (1 - math.cos(ARC)))


def frame(s):
    """(x, y, heading) of the centreline at chainage s (clamped to [-50, S_END + 50], linear beyond the ends)."""
    if s <= S_A:
        return X0 + s, Y0, 0.0
    if s <= S_B:
        a = (s - S_A) / R                       # clockwise from heading 0
        cx, cy = X0 + S_A, Y0 - R
        phi = math.pi / 2 - a
        return cx + R * math.cos(phi), cy + R * math.sin(phi), -a
    x1, y1 = _c_start()
    h = -ARC
    if s <= S_C:
        d = s - S_B
        return x1 + d * math.cos(h), y1 + d * math.sin(h), h
    x2, y2 = x1 + 450.0 * math.cos(h), y1 + 450.0 * math.sin(h)
    cx, cy = x2 - R * math.sin(h), y2 + R * math.cos(h)          # centre on the left of travel (CCW turn)
    if s <= S_D:
        a = (s - S_C) / R
        phi = (h - math.pi / 2) + a
        return cx + R * math.cos(phi), cy + R * math.sin(phi), h + a
    x3, y3 = cx + R * math.cos(-math.pi / 2), cy + R * math.sin(-math.pi / 2)
    return x3 + (s - S_D), y3, 0.0


def point(s, n=0.0, z=0.0):
    x, y, h = frame(s)
    return (x - n * math.sin(h), y + n * math.cos(h), z)


def heading(s):
    return frame(s)[2]


def segment(s):
    return 'A' if s <= S_A else 'B' if s <= S_B else 'C' if s <= S_C else 'D' if s <= S_D else 'E'


def stations(step_straight=8.0, step_arc=2.0, s0=0.0, s1=S_END):
    """Chainages for the road mesh: finer on the arcs, always including the segment joints."""
    out, s = [], s0
    joints = [S_A, S_B, S_C, S_D, S_DETAIL]
    while s < s1 - 1e-6:
        out.append(round(s, 3))
        step = step_arc if segment(s + 0.01) in ('B', 'D') else step_straight
        nxt = s + step
        for j in joints:
            if s + 1e-6 < j < nxt - 1e-6:
                nxt = j
        s = nxt
    out.append(s1)
    return out


def definition():
    """src/shared/road-rc9.json as loaded, plus the 2 m centreline polyline (review/debug only)."""
    pts = []
    s = 0.0
    while s <= S_END + 1e-6:
        x, y, _ = point(s)
        pts.append([round(x, 3), round(y, 3)])
        s += 2.0
    out = json.loads(json.dumps(SPEC))
    out['polyline_step_m'] = 2.0
    out['polyline'] = pts
    return out


def _check():
    """The JSON's derived fields (C/E starts, D centre, segment ends) must agree with the analytic frame to 1 mm."""
    def near(a, b):
        return all(abs(float(u) - float(v)) <= 1.5e-3 for u, v in zip(a, b))
    assert near(_SEG['C']['start'], _c_start()), 'road-rc9.json: C.start disagrees with A/B'
    assert near(_SEG['E']['start'], point(S_D)[:2]), 'road-rc9.json: E.start disagrees with A..D'
    assert near(_SEG['B']['centre'], (X0 + S_A, Y0 - R)), 'road-rc9.json: B.centre'
    assert near([_SEG['B']['s1'], _SEG['C']['s1'], _SEG['D']['s1']], [S_B, S_C, S_D]), 'road-rc9.json: chainages'


_check()
