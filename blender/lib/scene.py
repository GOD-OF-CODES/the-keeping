"""Fresh scene + Cycles setup + small utilities shared by every Blender job."""
import json
import os
import resource
import sys
import time
from pathlib import Path

import bpy

REPO = Path(__file__).resolve().parents[2]
BLENDER_DIR = REPO / 'blender'
SHARED = REPO / 'src' / 'shared'
CACHE = REPO / '.cache'


def log(*a):
    print('[keeping]', *a, flush=True)


def job_args(argv=None):
    """Arguments after '--' as a dict: `--size 1024 --flag` -> {'size': '1024', 'flag': True}. Positional -> '_'."""
    argv = sys.argv if argv is None else argv
    rest = argv[argv.index('--') + 1:] if '--' in argv else []
    out = {'_': []}
    i = 0
    while i < len(rest):
        a = rest[i]
        if a.startswith('--'):
            key = a[2:].replace('-', '_')
            if '=' in key:
                key, val = key.split('=', 1)
                out[key] = val
            elif i + 1 < len(rest) and not rest[i + 1].startswith('--'):
                out[key] = rest[i + 1]
                i += 1
            else:
                out[key] = True
        else:
            out['_'].append(a)
        i += 1
    return out


def peak_rss_mb():
    """Peak resident set size of this process (macOS reports bytes, Linux KiB)."""
    r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return r / (1024 * 1024) if sys.platform == 'darwin' else r / 1024


class Timer:
    def __init__(self):
        self.t = {}

    def __call__(self, name):
        timer = self

        class _Ctx:
            def __enter__(self_):
                self_.t0 = time.perf_counter()

            def __exit__(self_, *exc):
                timer.t[name] = round(time.perf_counter() - self_.t0, 4)
        return _Ctx()


def reset(fps=30):
    """Empty factory scene: metric metres, fps, Cycles, Standard view (bakes are linear data, never view-transformed)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    sc.unit_settings.length_unit = 'METERS'
    sc.render.fps = fps
    sc.render.fps_base = 1.0
    sc.render.engine = 'CYCLES'
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0
    if sc.world is None:
        sc.world = bpy.data.worlds.new('World')
    world_color((0, 0, 0), 0.0)
    return sc


def setup_cycles(samples, device='GPU', max_bounces=8, diffuse_bounces=4, seed=0, clamp_indirect=0.0):
    """Cycles with explicit samples, adaptive sampling OFF, denoise OFF (bakes are denoised by lib/oidn.py).

    device='GPU' uses Metal; falls back to CPU (and says so) when no Metal device is active.
    """
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    cy = sc.cycles
    used = 'CPU'
    if device == 'GPU':
        cp = bpy.context.preferences.addons['cycles'].preferences
        cp.compute_device_type = 'METAL'
        cp.refresh_devices()
        for d in cp.devices:
            d.use = (d.type == 'METAL')
        if cp.has_active_device():
            used = 'METAL'
        else:
            log('WARNING: no Metal device, baking on CPU')
    cy.device = 'GPU' if used == 'METAL' else 'CPU'
    cy.samples = int(samples)
    cy.use_adaptive_sampling = False
    cy.use_denoising = False
    cy.max_bounces = max_bounces
    cy.diffuse_bounces = diffuse_bounces
    cy.glossy_bounces = min(2, max_bounces)
    cy.transmission_bounces = min(4, max_bounces)
    cy.transparent_max_bounces = 8
    cy.seed = seed
    cy.sample_clamp_direct = 0.0
    cy.sample_clamp_indirect = clamp_indirect  # 0 = off (unbiased); raise only if OIDN leaves fireflies
    return used


def world_color(rgb, strength):
    w = bpy.context.scene.world
    nt = w.node_tree
    bg = next((n for n in nt.nodes if n.type == 'BACKGROUND'), None)
    if bg is None:
        bg = nt.nodes.new('ShaderNodeBackground')
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_WORLD'), None) or nt.nodes.new('ShaderNodeOutputWorld')
        nt.links.new(bg.outputs[0], out.inputs[0])
    bg.inputs['Color'].default_value = (*rgb, 1.0)
    bg.inputs['Strength'].default_value = strength


def link(ob, collection=None):
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


def select(objs, active=None):
    vl = bpy.context.view_layer
    vl.update()  # objects removed via bpy.data leave None entries until the view layer syncs
    for o in vl.objects:
        if o is not None:
            o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)


def apply_all_modifiers(ob):
    """Apply every modifier (static meshes only: do it before UV2, bake and export)."""
    if not ob.modifiers:
        return
    select([ob])
    for m in list(ob.modifiers):
        with bpy.context.temp_override(object=ob, active_object=ob):
            bpy.ops.object.modifier_apply(modifier=m.name)


def join(objs, name):
    """Join meshes into one object (one Cycles bake session per object, so join per atlas)."""
    for o in objs:
        apply_all_modifiers(o)
    select(objs, objs[0])
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def write_json(path, data):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2) + '\n')
    return p


def result(data, path=None):
    """Print a machine-readable RESULT line (scripts/assets.mjs collects it) and optionally write it as JSON."""
    data = dict(data)
    data.setdefault('peak_rss_mb', round(peak_rss_mb(), 1))
    print('RESULT ' + json.dumps(data), flush=True)
    if path:
        write_json(path, data)
    return data


def out_dir(sub):
    d = Path(os.environ.get('KEEPING_OUT', CACHE / 'out')) / sub
    d.mkdir(parents=True, exist_ok=True)
    return d
