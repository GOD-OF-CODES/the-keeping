"""Single Blender entry point.

  Blender --background --factory-startup --python-exit-code 1 --python blender/lib/cli.py -- <job.py> [job args]

Blender's --python does not put the script directory on sys.path (and ignores PYTHONPATH without
--python-use-system-env), so this file adds blender/ and runs the job with runpy. Job arguments stay after '--'
(read them with lib.scene.job_args()); the job path itself is removed from them.
"""
import runpy
import sys
from pathlib import Path

BLENDER_DIR = Path(__file__).resolve().parents[1]
REPO = BLENDER_DIR.parent
if str(BLENDER_DIR) not in sys.path:
    sys.path.insert(0, str(BLENDER_DIR))
sys.dont_write_bytecode = True
try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass


def main():
    argv = sys.argv
    rest = argv[argv.index('--') + 1:] if '--' in argv else []
    if not rest:
        raise SystemExit('usage: cli.py -- <job.py> [args]')
    job = Path(rest[0])
    if not job.is_absolute():
        job = (REPO / job).resolve()
    if not job.exists():
        raise SystemExit(f'job script not found: {job}')
    # Hide the job path from the job's own argument parsing.
    sys.argv = argv[:argv.index('--') + 1] + rest[1:]
    runpy.run_path(str(job), run_name='__main__')


main()
