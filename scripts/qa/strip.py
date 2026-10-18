# SMOOTH-FRAMES lane (contract #142; promoted from scratch/glitchfix/strip.py): a brightened contact strip of frames
# from any sequence dir (NNNN.jpg), tiles left→right, top→bottom; the tile legend (frame number + the cutscene id@clock
# when the dir has a rows.json) is printed (this ffmpeg has no drawtext). One strip counts as ONE image for the
# "≤ 2 screenshots per step" rule.
#
#   python3 scripts/qa/strip.py <seqdir> <out.jpg> [--crop w:h:x:y] [--gamma 1.8] [--cols 3] [--size 320x200] \
#       [--range a-b] frames…
import json, os, subprocess, sys

a = sys.argv[1:]
if len(a) < 2: sys.exit('usage: strip.py <seqdir> <out.jpg> [--crop w:h:x:y] [--gamma g] [--cols c] [--size WxH] [--range a-b] frames…')
seq = a.pop(0); out = a.pop(0)
crop = None; gamma = '1.8'; cols = 3; w = 320; h = 200; frames = []
while a:
    k = a.pop(0)
    if k == '--crop': crop = a.pop(0)
    elif k == '--gamma': gamma = a.pop(0)
    elif k == '--cols': cols = int(a.pop(0))
    elif k == '--size': w, h = map(int, a.pop(0).split('x'))
    elif k == '--range':
        lo, hi = map(int, a.pop(0).split('-')); frames += list(range(lo, hi + 1))
    else: frames.append(int(k))
rows = []
rp = os.path.join(seq, 'rows.json')
if os.path.exists(rp): rows = json.load(open(rp))
def label(c):
    r = rows[c] if c < len(rows) else None
    s = f'f{c}'
    if r: s += f" {r.get('id')}@{r.get('t')}"
    return s
ins = []
for c in frames: ins += ['-i', os.path.join(seq, f'{c:04d}.jpg')]
pre = f'crop={crop},' if crop else ''
f = ''.join(f"[{k}]{pre}scale={w}:{h},eq=gamma={gamma}:brightness=0.04[s{k}];" for k, c in enumerate(frames))
f += ''.join(f'[s{k}]' for k in range(len(frames)))
lay = '|'.join(f'{(i % cols) * w}_{(i // cols) * h}' for i in range(len(frames)))
f += f'xstack=inputs={len(frames)}:layout={lay}' if len(frames) > 1 else 'null'
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *ins, '-filter_complex', f, out], check=True)
print(out + '  tiles: ' + ' | '.join(label(c) for c in frames))
