"""One-off: probe mathutils.geometry.delaunay_2d_cdt output types (Blender 5.2) for the A1 cap disc."""
import math
from mathutils import Vector
from mathutils.geometry import delaunay_2d_cdt
rim = [Vector((math.cos(a) * 0.05, math.sin(a) * 0.055)) for a in [i * 2 * math.pi / 108 for i in range(108)]]
pts = [Vector((x * 0.003, y * 0.003)) for x in range(-15, 16) for y in range(-15, 16) if (x * 0.003 / 0.047) ** 2 + (y * 0.003 / 0.052) ** 2 < 1]
for ot in range(0, 6):
    try:
        r = delaunay_2d_cdt(rim + pts, [], [list(range(108))], ot, 1e-6, True)
        vo, e, f, ov = r[0], r[1], r[2], r[3]
        print(f'CDT ot={ot}: verts {len(vo)} faces {len(f)} maxlen {max(len(x) for x in f)} orig-map first {ov[:2]} rim-kept {sum(1 for o in ov if o and min(o) < 108)}')
    except Exception as ex:
        print(f'CDT ot={ot}: ERR {ex}')
