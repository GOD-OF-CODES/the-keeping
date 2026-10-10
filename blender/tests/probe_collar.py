"""One-off (fix round, lane A): where does Ada's collar sit in the atlas and what colour did the bake paint there?
Opens .cache/characters/ada.blend, samples the albedo image at the UVs of gown verts near the neck."""
import bpy
import numpy as np
from pathlib import Path
REPO = Path(bpy.path.abspath('//')).resolve() if bpy.data.filepath else Path.cwd()
bpy.ops.wm.open_mainfile(filepath=str(Path.cwd() / '.cache/characters/ada.blend'))
g = bpy.data.objects['ada_gown']
me = g.data
uv = me.uv_layers.active.data
img = None
for m in me.materials:
    for n in (m.node_tree.nodes if m and m.node_tree else []):
        if n.type == 'TEX_IMAGE' and n.image and 'albedo' in n.image.name:
            img = n.image
print('PROBE img', img and img.name, img and tuple(img.size))
W, H = img.size
px = np.empty(W * H * 4, np.float32); img.pixels.foreach_get(px); px = px.reshape(H, W, 4)
co = np.array([v.co[:] for v in me.vertices])
print('PROBE gown z max', co[:, 2].max().round(3), 'verts', len(co))
for lo, hi in ((1.30, 1.34), (1.34, 1.38), (1.38, 1.42), (1.42, 1.50)):
    cols = []
    for p in me.polygons:
        for li in p.loop_indices:
            vi = me.loops[li].vertex_index
            x, y, z = co[vi]
            if lo <= z < hi and abs(x) < 0.09 and abs(y) < 0.11:
                u, v = uv[li].uv
                cols.append(px[min(H - 1, int(v * H)), min(W - 1, int(u * W)), :3])
    if cols:
        c = np.array(cols)
        print(f'PROBE z {lo}-{hi}: n {len(c)} mean srgb {c.mean(0).round(3)} min {c.min(0).round(3)} max {c.max(0).round(3)}')
    else:
        print(f'PROBE z {lo}-{hi}: none')
# fix round 2: which bones drive the gown's top rows (the halo ring in body14)?
from collections import Counter
names = {vg.index: vg.name for vg in g.vertex_groups}
cnt = Counter()
for v in me.vertices:
    if v.co.z > 1.36:
        for gr in v.groups:
            if gr.weight > 0.05:
                cnt[names[gr.group]] += 1
print('PROBE gown z>1.36 bone counts', dict(cnt.most_common(12)))
print('PROBE gown groups', sorted(names.values())[:60])
for ob in bpy.data.objects:
    if ob.type == 'MESH':
        print('PROBE obj', ob.name, ob.parent and ob.parent.name, ob.parent_bone, len(ob.data.vertices))
