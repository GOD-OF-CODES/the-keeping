"""Review render of the ground cover (turf patches, tufts, tussocks, rosettes, stalks, drive gravel) the way the player
sees it: a 7 x 9 m piece of yard + drive verge, eye 1.65 m, 60 deg vertical FOV, lit by the torch only plus the
overcast-moon dome, then the same patch in a lightning flash.

  node blender/characters/dev.mjs blender/house/review_groundcover.py [--out gc] [--samples 32]

Real numbers (CLAUDE.md "Photoreal standard"): torch = 1990s 2-cell D krypton, ~2.5 kcd peak -> Blender spot
2500 * 4 pi / 683 = 46 W, 2900 K, 24 deg cone, soft spill; moon dome ~0.03 lux at the ground; lightning: a
sky-coloured (8000 K) flash ~ 2000 lux for the flash tile. Proxy materials at the spec's albedo / roughness
(grass_wet 0.045-0.06 / 0.6 wet, mud_wet 0.065 / 0.3, gravel_wet 0.17 / 0.6). The runtime TSL materials differ in
texture; this judges the geometry: density, blade size, lodging, silhouette, scale against the drive.
-> scratch/blender-r2/<out>.png (2 tiles: torch | flash)
"""
import math
import random

import bpy
import numpy as np
from mathutils import Matrix, Vector

from lib.scene import REPO, job_args, log, reset, setup_cycles
from house import groundcover as gc

A = job_args()
OUT = REPO / 'scratch' / 'blender-r2'
OUT.mkdir(parents=True, exist_ok=True)
NAME = A.get('out') or 'gc'
SAMPLES = int(A.get('samples') or 32)
RES = (int(A.get('w') or 640), int(A.get('h') or 400))

reset()
sc = bpy.context.scene
setup_cycles(SAMPLES, max_bounces=4, diffuse_bounces=2)
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = RES
sc.view_settings.view_transform = 'AgX'
sc.render.image_settings.file_format = 'PNG'


def mat(name, rgb, rough, noise_amt=0.0):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = rough
    if noise_amt:
        tex = nt.nodes.new('ShaderNodeTexNoise')
        tex.inputs['Scale'].default_value = 3.0
        mr = nt.nodes.new('ShaderNodeMapRange')
        mr.inputs['To Min'].default_value = 1 - noise_amt
        mr.inputs['To Max'].default_value = 1 + noise_amt
        nt.links.new(tex.outputs['Fac'], mr.inputs['Value'])
        mix = nt.nodes.new('ShaderNodeVectorMath')
        mix.operation = 'SCALE'
        mix.inputs[0].default_value = (*rgb,)
        nt.links.new(mr.outputs['Result'], mix.inputs['Scale'])
        nt.links.new(mix.outputs['Vector'], b.inputs['Base Color'])
    else:
        b.inputs['Base Color'].default_value = (*rgb, 1)
    return m


M = {
    'grass_wet@2s': mat('grass', (0.075, 0.07, 0.035), 0.55, 0.35),     # dead winter grass: olive-straw, wet
    'bark_wet': mat('bark', (0.06, 0.05, 0.04), 0.7),
    'gravel_wet': mat('gravel', (0.17, 0.16, 0.145), 0.5, 0.4),
}
ground_grass = mat('ground_grass', (0.05, 0.055, 0.03), 0.6, 0.5)
ground_gravel = mat('ground_gravel', (0.15, 0.14, 0.125), 0.45, 0.5)

# ground: grass everywhere, the drive verge (gravel) along x > 1.5
for name, rect, m in (('g', (-4, -1, 1.5, 10), ground_grass), ('d', (1.5, -1, 5.0, 10), ground_gravel)):
    me = bpy.data.meshes.new(name)
    x0, y0, x1, y1 = rect
    me.from_pydata([(x0, y0, 0), (x1, y0, 0), (x1, y1, 0), (x0, y1, 0)], [], [(0, 1, 2, 3)])
    me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    sc.collection.objects.link(ob)


def to_obj(buf, name, matkey):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in buf.v], [], buf.f)
    me.materials.append(M[matkey])
    return me


rng = random.Random(5)
variants = {
    'turf': [to_obj(gc.turf(random.Random(600 + i)), f'turf{i}', gc.GRASS) for i in range(3)],
    'tuft': [to_obj(gc.tuft(random.Random(100 + i), 'tuft'), f'tuft{i}', gc.GRASS) for i in range(4)],
    'tussock': [to_obj(gc.tuft(random.Random(200 + i), 'tussock'), f'tus{i}', gc.GRASS) for i in range(3)],
    'rosette': [to_obj(gc.rosette(random.Random(300 + i)), f'ros{i}', gc.GRASS) for i in range(2)],
    'stalks': [to_obj(gc.stalks(random.Random(400 + i)), f'stk{i}', gc.STALK) for i in range(2)],
    'stone': [to_obj(gc.stone(random.Random(500 + i)), f'st{i}', gc.STONE) for i in range(3)],
}
items = []
# turf over the grass at the game's grid (TURF_STEP), tufts at the yard density near the play area (~0.3 / m^2),
# a tussock line along x = -3.5 (a fence), the verge: tufts encroaching on the gravel's first 0.4 m, stones
for j in range(int(11 / gc.TURF_STEP)):
    for i in range(int(5.5 / gc.TURF_STEP)):
        x = -4 + (i + 0.5 + rng.uniform(-0.3, 0.3)) * gc.TURF_STEP
        y = -1 + (j + 0.5 + rng.uniform(-0.3, 0.3)) * gc.TURF_STEP
        d = 1.5 - x                     # distance from the drive edge -> groundcover.turf_weight
        w = 1.0 if d < gc.TURF_NEAR else max(0.0, 1.0 - (d - gc.TURF_NEAR) / gc.TURF_FADE)
        if x < 1.3 and rng.random() < w:
            items.append(('turf', x, y, rng.uniform(0.85, 1.2)))
for _ in range(int(5.5 * 11 * 0.35)):
    items.append(('tuft', rng.uniform(-4, 1.4), rng.uniform(-1, 10), rng.uniform(0.7, 1.3)))
for _ in range(int(11 / 0.35)):
    items.append(('tussock', -3.5 + rng.uniform(-0.3, 0.3), rng.uniform(-1, 10), rng.uniform(0.7, 1.3)))
for _ in range(6):
    items.append(('rosette', rng.uniform(-3, 1.3), rng.uniform(0, 9), rng.uniform(0.8, 1.2)))
for _ in range(3):
    items.append(('stalks', rng.uniform(-3.8, -3.0), rng.uniform(1, 9), 1.0))
for _ in range(int(11 * 2.2)):
    items.append(('tuft', 1.5 + rng.uniform(0, 0.4) ** 1.5, rng.uniform(-1, 10), rng.uniform(0.7, 1.2)))
for _ in range(220):
    x = 1.5 + rng.uniform(0, 3.5)
    items.append(('stone', x, rng.uniform(-1, 10), rng.uniform(0.02, 0.06)))
for k, (kind, x, y, s) in enumerate(items):
    me = rng.choice(variants[kind])
    ob = bpy.data.objects.new(f'i{k}', me)
    sc.collection.objects.link(ob)
    z = s * 0.12 if kind == 'stone' else 0.0
    ob.matrix_world = Matrix.Translation((x, y, z)) @ Matrix.Rotation(rng.uniform(0, math.tau), 4, 'Z') @ \
        Matrix.Diagonal((s, s, s, 1))

# world: overcast moon dome ~0.03 lux (flat approximation: E = pi * L -> L = 0.0095)
w = bpy.data.worlds.new('w')
sc.world = w
bg = w.node_tree.nodes['Background']
bg.inputs['Color'].default_value = (0.75, 0.82, 1.0, 1)

cd = bpy.data.cameras.new('cam')
cam = bpy.data.objects.new('cam', cd)
sc.collection.objects.link(cam)
sc.camera = cam
cd.sensor_fit = 'VERTICAL'
cd.angle = math.radians(60)
cam.location = (0.2, -1.6, 1.65)
cam.rotation_mode = 'XYZ'
cam.rotation_euler = (math.radians(90 - 24), 0, math.radians(-8))

sl = bpy.data.lights.new('torch', 'SPOT')
sl.energy = 46.0
sl.color = (1.0, 0.80, 0.58)          # ~2900 K
sl.spot_size = math.radians(24)
sl.spot_blend = 0.6
sl.shadow_soft_size = 0.02
torch = bpy.data.objects.new('torch', sl)
sc.collection.objects.link(torch)
torch.location = (0.0, -1.4, 1.3)
torch.rotation_euler = (math.radians(90 - 30), 0, math.radians(-10))

sun = bpy.data.lights.new('flash', 'SUN')
sun.color = (0.86, 0.9, 1.0)
sun.angle = math.radians(8)
flash = bpy.data.objects.new('flash', sun)
sc.collection.objects.link(flash)
flash.rotation_euler = (math.radians(35), 0, math.radians(140))


def render(exposure, torch_w, sky, flash_w):
    sl.energy = torch_w
    bg.inputs['Strength'].default_value = sky
    sun.energy = flash_w
    sc.view_settings.exposure = exposure
    p = OUT / '__t.png'
    sc.render.filepath = str(p)
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(str(p), check_existing=False)
    a = np.empty(img.size[0] * img.size[1] * 4, np.float32)
    img.pixels.foreach_get(a)
    a = a.reshape(img.size[1], img.size[0], 4)
    bpy.data.images.remove(img)
    p.unlink(missing_ok=True)
    return a


# torch tile: eye adapted to the beam (~100-200 lux at the spot); flash tile: ~2000 lux sky-coloured flash
t1 = render(float(A.get('ev') or 5.0), 46.0, 0.0095, 0.0)
t2 = render(float(A.get('ev2') or -1.0), 0.0, 0.3, 6.0)
sheet = np.concatenate([t1, t2], 1)
H, W = sheet.shape[:2]
img = bpy.data.images.new('__sheet', W, H, alpha=False)
img.pixels.foreach_set(np.ascontiguousarray(sheet).ravel())
img.filepath_raw = str(OUT / f'{NAME}.png')
img.file_format = 'PNG'
img.save()
log('groundcover review ->', OUT / f'{NAME}.png', len(items), 'items')
