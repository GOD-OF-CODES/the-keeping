"""Turntable-free review renders for prop generators: one PNG per variant + a labelled contact sheet.

Cycles (Metal) at low spp WITH Cycles denoise (this is a preview, not a bake), 512 px, AgX. A neutral studio: grey
checker floor (10 cm cells for small props, 1 m for large ones — a free scale reference), a large soft key, a rim
light and a dim grey world. Labels use the 5x7 bitmap font below (our own; no font files).
"""
import math
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

from lib.scene import log, setup_cycles

# 5x7 glyphs, one int per row, 5 bits (MSB = left column).
_FONT = {
    'A': [14, 17, 17, 31, 17, 17, 17], 'B': [30, 17, 17, 30, 17, 17, 30], 'C': [14, 17, 16, 16, 16, 17, 14],
    'D': [30, 17, 17, 17, 17, 17, 30], 'E': [31, 16, 16, 30, 16, 16, 31], 'F': [31, 16, 16, 30, 16, 16, 16],
    'G': [14, 17, 16, 23, 17, 17, 15], 'H': [17, 17, 17, 31, 17, 17, 17], 'I': [14, 4, 4, 4, 4, 4, 14],
    'J': [7, 2, 2, 2, 2, 18, 12], 'K': [17, 18, 20, 24, 20, 18, 17], 'L': [16, 16, 16, 16, 16, 16, 31],
    'M': [17, 27, 21, 21, 17, 17, 17], 'N': [17, 17, 25, 21, 19, 17, 17], 'O': [14, 17, 17, 17, 17, 17, 14],
    'P': [30, 17, 17, 30, 16, 16, 16], 'Q': [14, 17, 17, 17, 21, 18, 13], 'R': [30, 17, 17, 30, 20, 18, 17],
    'S': [15, 16, 16, 14, 1, 1, 30], 'T': [31, 4, 4, 4, 4, 4, 4], 'U': [17, 17, 17, 17, 17, 17, 14],
    'V': [17, 17, 17, 17, 17, 10, 4], 'W': [17, 17, 17, 21, 21, 21, 10], 'X': [17, 17, 10, 4, 10, 17, 17],
    'Y': [17, 17, 10, 4, 4, 4, 4], 'Z': [31, 1, 2, 4, 8, 16, 31],
    '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31],
    '3': [31, 2, 4, 2, 1, 17, 14], '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14],
    '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8], '8': [14, 17, 17, 14, 17, 17, 14],
    '9': [14, 17, 17, 15, 1, 2, 12], '_': [0, 0, 0, 0, 0, 0, 31], '.': [0, 0, 0, 0, 0, 12, 12],
    '-': [0, 0, 0, 31, 0, 0, 0], ':': [0, 12, 12, 0, 12, 12, 0], '/': [1, 1, 2, 4, 8, 16, 16],
    '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8], ' ': [0] * 7, '=': [0, 0, 31, 0, 31, 0, 0],
    '+': [0, 4, 4, 31, 4, 4, 0], 'K2': [0] * 7,
}


def draw_text(img, x, y, text, color=(0.92, 0.9, 0.85), scale=1):
    """img: HxWx4 float array, top-down rows. Draws uppercase text at (x, y) = top-left."""
    for ch in text.upper():
        g = _FONT.get(ch, _FONT[' '])
        for r, bits in enumerate(g):
            for c in range(5):
                if bits & (1 << (4 - c)):
                    y0, x0 = y + r * scale, x + c * scale
                    if 0 <= y0 < img.shape[0] - scale and 0 <= x0 < img.shape[1] - scale:
                        img[y0:y0 + scale, x0:x0 + scale, :3] = color
        x += 6 * scale
    return x


def _mat(name, rgb, rough=0.8, checker=None):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    if checker:
        tc = nt.nodes.new('ShaderNodeTexCoord')
        ck = nt.nodes.new('ShaderNodeTexChecker')
        ck.inputs['Scale'].default_value = checker
        ck.inputs['Color1'].default_value = (*rgb, 1)
        ck.inputs['Color2'].default_value = (*[c * 1.35 for c in rgb], 1)
        nt.links.new(tc.outputs['Object'], ck.inputs['Vector'])
        nt.links.new(ck.outputs['Color'], b.inputs['Base Color'])
    return m


class Studio:
    def __init__(self, samples=24):
        sc = bpy.context.scene
        setup_cycles(samples, 'GPU', max_bounces=6, diffuse_bounces=3)
        sc.cycles.use_denoising = True
        try:
            sc.cycles.denoiser = 'OPENIMAGEDENOISE'
        except Exception:
            pass
        sc.render.resolution_x = sc.render.resolution_y = 512
        sc.render.resolution_percentage = 100
        sc.render.image_settings.file_format = 'PNG'
        sc.render.film_transparent = False
        try:
            sc.view_settings.view_transform = 'AgX'
            sc.view_settings.look = 'None'
        except Exception:
            sc.view_settings.view_transform = 'Filmic'
        sc.view_settings.exposure = -0.6
        w = sc.world.node_tree
        bg = next(n for n in w.nodes if n.type == 'BACKGROUND')
        bg.inputs['Color'].default_value = (0.36, 0.38, 0.42, 1)
        bg.inputs['Strength'].default_value = 0.55
        me = bpy.data.meshes.new('_floor')
        s = 60
        me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
        self.floor = bpy.data.objects.new('_floor', me)
        sc.collection.objects.link(self.floor)
        self.mat_small = _mat('_floor_small', (0.16, 0.16, 0.15), 0.85, checker=10.0)
        self.mat_big = _mat('_floor_big', (0.16, 0.16, 0.15), 0.85, checker=1.0)
        me.materials.append(self.mat_small)
        cam_data = bpy.data.cameras.new('_cam')
        cam_data.lens = 50
        cam_data.clip_start = 0.005
        cam_data.clip_end = 400
        self.cam = bpy.data.objects.new('_cam', cam_data)
        sc.collection.objects.link(self.cam)
        sc.camera = self.cam
        kd = bpy.data.lights.new('_key', 'AREA')
        kd.shape = 'DISK'
        self.key = bpy.data.objects.new('_key', kd)
        sc.collection.objects.link(self.key)
        rd = bpy.data.lights.new('_rim', 'AREA')
        self.rim = bpy.data.objects.new('_rim', rd)
        sc.collection.objects.link(self.rim)
        self.fixtures = {self.floor, self.cam, self.key, self.rim}

    def flag_backfaces(self):
        """Paint back faces bright magenta on every single-sided material: flipped normals (invisible in three with
        doubleSided=false) show up in the review renders."""
        for m in bpy.data.materials:
            if m.name.startswith('_') or not m.use_backface_culling or m.get('_flagged'):
                continue
            nt = m.node_tree
            out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
            src = out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].links else None
            if src is None:
                continue
            geo = nt.nodes.new('ShaderNodeNewGeometry')
            em = nt.nodes.new('ShaderNodeEmission')
            em.inputs['Color'].default_value = (1, 0, 1, 1)
            em.inputs['Strength'].default_value = 2.0
            mix = nt.nodes.new('ShaderNodeMixShader')
            nt.links.new(geo.outputs['Backfacing'], mix.inputs['Fac'])
            nt.links.new(src, mix.inputs[1])
            nt.links.new(em.outputs['Emission'], mix.inputs[2])
            nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
            m['_flagged'] = True

    def _aim(self, ob, target):
        d = Vector(target) - ob.location
        ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

    def render(self, objs, path, view=(-0.5, -1.0, 0.45), shot=None):
        sc = bpy.context.scene
        self.flag_backfaces()
        keep = {o for o in objs if 'decal' not in o and not o.get('collider')} | self.fixtures   # decals are runtime-drawn
        for o in sc.objects:
            o.hide_render = o not in keep
        lo = Vector((1e9, 1e9, 1e9))
        hi = -lo
        for o in objs:
            if o.type != 'MESH':
                continue
            for c in o.bound_box:
                w = o.matrix_world @ Vector(c)
                lo = Vector(map(min, lo, w))
                hi = Vector(map(max, hi, w))
        if lo.x > hi.x:
            return None
        dims = hi - lo
        c = (lo + hi) / 2
        r = max(dims.length / 2, 0.02)
        self.floor.data.materials[0] = self.mat_small if max(dims) < 1.2 else self.mat_big
        self.floor.location.z = min(0.0, lo.z)
        v = Vector(view).normalized()
        dist = r / math.sin(math.atan(18 / 50)) * 1.08
        self.cam.data.lens = 50
        self.cam.location = c + v * dist
        self._aim(self.cam, c)
        if shot:   # explicit camera (interiors): eye/target in prop space
            self.cam.location = Vector(shot['eye'])
            self._aim(self.cam, shot['target'])
            self.cam.data.lens = shot.get('lens', 35)
        self.key.location = c + Vector((-1.2, -0.7, 1.3)).normalized() * dist * 1.2
        self._aim(self.key, c)
        self.key.data.size = max(0.3, r * 2.5)
        self.key.data.energy = 60 * (dist * 1.2) ** 2
        self.rim.location = c + Vector((1.0, 1.1, 0.9)).normalized() * dist * 1.2
        self._aim(self.rim, c)
        self.rim.data.size = max(0.2, r * 1.5)
        self.rim.data.energy = 25 * (dist * 1.2) ** 2
        sc.render.filepath = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.render.render(write_still=True)
        return [round(x, 3) for x in dims]


def contact_sheet(items, out_path, cols=6, thumb=256, label_h=26):
    """items: [(png_path, label, sublabel)] -> one PNG grid."""
    n = len(items)
    rows = max(1, math.ceil(n / cols))
    W, H = cols * thumb, rows * (thumb + label_h)
    sheet = np.zeros((H, W, 4), np.float32)
    sheet[..., :3] = 0.06
    sheet[..., 3] = 1
    for i, (png, label, sub) in enumerate(items):
        r, c = divmod(i, cols)
        x0, y0 = c * thumb, r * (thumb + label_h)
        try:
            im = bpy.data.images.load(str(png), check_existing=False)
            w, h = im.size
            a = np.empty(w * h * 4, np.float32)
            im.pixels.foreach_get(a)
            a = a.reshape(h, w, 4)[::-1]          # top-down
            f = max(1, w // thumb)
            a = a[:f * thumb, :f * thumb].reshape(thumb, f, thumb, f, 4).mean(axis=(1, 3))
            sheet[y0:y0 + thumb, x0:x0 + thumb] = a
            bpy.data.images.remove(im)
        except Exception as e:
            log(f'contact sheet: cannot load {png}: {e}')
        draw_text(sheet, x0 + 4, y0 + thumb + 3, label[:41])
        draw_text(sheet, x0 + 4, y0 + thumb + 14, sub[:41], color=(0.6, 0.6, 0.58))
    img = bpy.data.images.new('_sheet', W, H, alpha=False)
    img.pixels.foreach_set(sheet[::-1].ravel())
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    img.filepath_raw = str(out_path)
    img.file_format = 'PNG'
    img.save()
    return str(out_path)
