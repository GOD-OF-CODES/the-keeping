"""THE KEEPING — Blender pipeline library (lane A).

Run every job through blender/lib/cli.py (scripts/assets.mjs does this), which puts blender/ on sys.path:
  Blender --background --factory-startup --python-exit-code 1 --python blender/lib/cli.py -- <job.py> [args]
"""
