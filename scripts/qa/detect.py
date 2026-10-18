# SMOOTH-FRAMES lane (contract #142; promoted from scratch/glitch/detect.py): one-frame glitch detector for a frame
# sequence captured by scripts/qa/cs-frames.mjs (or scratch/glitch/c2-frames.mjs + mkseq.sh).
#
#   python3 scripts/qa/detect.py <seqdir> [--rows <rows.json | shot.log with 'ROWS [...]'>] [--out <dir>] [--top 30]
#
# <seqdir>/NNNN.jpg, rows default <seqdir>/rows.json (rows[i] ↔ NNNN = i). Writes ONLY into --out (default
# <seqdir>/../<seqname>-detect): raw.gray, report.txt (also printed) and events.json.
# Per frame, on a 128×80 grey copy split into 8×5 cells (sqrt-lifted so dark-frame changes count):
#   FLICKER  = max over cells of min(e1, e2) − e3 (the frame departs and comes back: e1 = |f − f−1|, e2 = |f+1 − f|,
#              e3 = |f+1 − f−1|) — a one-frame blink of geometry / light / shadow / exposure / a card.
#   POP      = max cell change − 3 × median cell change (one region changes, the rest does not).
#   GLOBAL   = median cell change (the whole frame changes: a cut, an exposure step, a flash).
#   LUMA     = mean linear-ish luma; PUMP = a luma peak / dip ≥ 10 % on both sides within ±8 frames (no flash, no cut).
# With rows: CUT = camera eye jump > 0.25 m and ≥ 3× the previous frame's (a car shot moves ≈ 0.6 m/frame) or look
# turn > 20° in one frame or a cutscene id change (authored cut), WHIP = 12–20°/frame,
# DRAWS = |Δ draws| ≥ max(12, 8 %) on a non-cut frame (culling / visibility change), LT = lightning level (flashes).
import json, math, os, re, subprocess, sys

a = sys.argv[1:]
if not a or a[0].startswith('-'):
    sys.exit(__doc__ if __doc__ else 'usage: detect.py <seqdir> [--rows f] [--out d] [--top n]')
seq = a.pop(0).rstrip('/')
rows_f = None; out = None; top = 30
while a:
    k = a.pop(0)
    if k == '--rows': rows_f = a.pop(0)
    elif k == '--out': out = a.pop(0)
    elif k == '--top': top = int(a.pop(0))
if rows_f is None and os.path.exists(os.path.join(seq, 'rows.json')): rows_f = os.path.join(seq, 'rows.json')
if out is None: out = os.path.join(os.path.dirname(os.path.abspath(seq)), os.path.basename(seq) + '-detect')
os.makedirs(out, exist_ok=True)

W, H = 128, 80; N = W * H
raw = os.path.join(out, 'raw.gray')
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-framerate', '30', '-i', os.path.join(seq, '%04d.jpg'), '-vf', f'scale={W}:{H},format=gray', '-f', 'rawvideo', raw], check=True)
data = open(raw, 'rb').read(); F = len(data) // N
fr = [data[i * N:(i + 1) * N] for i in range(F)]

rows = []
if rows_f:
    txt = open(rows_f).read()
    if rows_f.endswith('.json'): rows = json.loads(txt)
    else: rows = json.loads(re.search(r'ROWS (\[.*\])', txt).group(1))

lut = [math.sqrt(v / 255.0) * 255 for v in range(256)]
lin = [((v / 255.0) ** 2.2) for v in range(256)]
CX, CY = 8, 5; cw, ch = W // CX, H // CY
def cells(f):
    o = []
    for cy in range(CY):
        for cx in range(CX):
            s = 0.0
            for y in range(cy * ch, (cy + 1) * ch):
                b = y * W + cx * cw
                s += sum(lut[v] for v in f[b:b + cw])
            o.append(s / (cw * ch))
    return o
C = [cells(f) for f in fr]
L = [sum(lin[v] for v in f) / N for f in fr]
def d(i, j): return [abs(x - y) for x, y in zip(C[i], C[j])]

def row(i): return rows[i] if i < len(rows) else {}
def lab(i):
    r = row(i)
    return f"{r.get('id')}@{r.get('t')}" if r else '-'
def cam(i):
    r = row(i); return (r.get('cp'), r.get('hd'), r.get('pt'), r.get('fov')) if r and r.get('cp') else None
def turn(i):
    a, b = cam(i - 1), cam(i)
    if not a or not b: return 0.0, 0.0
    if a[1] is None or b[1] is None: return 0.0, math.dist(a[0], b[0])
    def u(c): return (math.cos(c[1]) * math.cos(c[2]), math.sin(c[1]) * math.cos(c[2]), math.sin(c[2]))
    ua, ub = u(a), u(b)
    dot = max(-1.0, min(1.0, sum(x * y for x, y in zip(ua, ub))))
    return math.degrees(math.acos(dot)), math.dist(a[0], b[0])

M = []
for i in range(F):
    m = {'n': i, 'lab': lab(i), 'luma': L[i]}
    if 0 < i < F - 1:
        e1 = d(i, i - 1); e2 = d(i + 1, i); e3 = d(i + 1, i - 1)
        m['flick'] = max(min(x, y) - z for x, y, z in zip(e1, e2, e3))
        s = sorted(e1); m['med'] = s[len(s) // 2]; m['mx'] = s[-1]; m['pop'] = s[-1] - 3 * s[len(s) // 2]
    else:
        m['flick'] = m['med'] = m['mx'] = m['pop'] = 0.0
    tdeg, step = turn(i) if i > 0 else (0.0, 0.0)
    m['turn'] = tdeg; m['step'] = step
    r = row(i)
    # a car-space shot moves the eye ≈ 0.6 m every frame: a CUT is a step that is large AND ≥ 3× the previous one
    pstep = M[i - 1]['step'] if i > 1 else 0.0
    m['cut'] = bool(i > 0 and rows and ((step > 0.25 and step > 3 * pstep and not (i > 1 and M[i - 1]['cut'] and step < 2 * M[i - 2]['step'] + 0.25)) or tdeg > 20 or (row(i - 1).get('id') != r.get('id'))))
    m['lt'] = r.get('lt', 0) if r else 0
    dr0 = row(i - 1).get('dr') if i > 0 else None; dr1 = r.get('dr') if r else None
    m['ddraw'] = (dr1[0] - dr0[0]) if (dr0 and dr1) else 0
    m['draws'] = dr1[0] if dr1 else None
    M.append(m)

# exposure pumps: a local luma peak / dip with ≥ 10 % prominence on BOTH sides within ±8 frames (log luma), no flash,
# no cut in the window — ranked by prominence (camera pans across a lamp also show up: check them in a strip)
pumps = []
LL = [math.log(max(1e-5, x)) for x in L]
for i in range(8, F - 8):
    if any((row(j).get('lt') or 0) > 0.02 for j in range(i - 8, i + 9)): continue
    if any(M[j]['cut'] for j in range(i - 7, i + 9)): continue
    lw, rw = LL[i - 8:i], LL[i + 1:i + 9]
    hi = min(LL[i] - max(lw), LL[i] - max(rw))   # peak
    lo = min(min(lw) - LL[i], min(rw) - LL[i])   # dip
    pr = max(hi, lo)
    if pr >= 0.1 and (LL[i] == max(LL[i - 8:i + 9]) or LL[i] == min(LL[i - 8:i + 9])): pumps.append((i, pr))
pumps.sort(key=lambda x: -x[1])

def fmt(m):
    flags = []
    if m['cut']: flags.append('CUT')
    if 12 <= m['turn'] <= 20 and not m['cut']: flags.append('WHIP')
    if m['lt'] and m['lt'] > 0.02: flags.append(f"LT{m['lt']:.2f}")
    if m['draws'] is not None and abs(m['ddraw']) >= max(12, 0.08 * (m['draws'] or 1)) and not m['cut']: flags.append(f"DRAWS{m['ddraw']:+d}")
    return (f"f{m['n']:04d} {m['lab']:<16} flick={m['flick']:5.1f} pop={m['pop']:5.1f} max={m['mx']:5.1f} med={m['med']:4.1f} "
            f"turn={m['turn']:5.1f}° step={m['step']:.2f}m luma={m['luma']:.4f} draws={m['draws']} {' '.join(flags)}")

lines = [f'frames {F}  rows {len(rows)}  seq {seq}']
ids = []
for r in rows:
    if r.get('id') not in ids: ids.append(r.get('id'))
lines.append('ids: ' + ' → '.join(str(x) for x in ids))
lines.append(f'--- FLICKER top {top} (one-frame departures; LT = lightning)')
lines += [fmt(m) for m in sorted(M, key=lambda x: -x['flick'])[:top]]
lines.append(f'--- LOCAL POP top {top} (non-CUT frames)')
lines += [fmt(m) for m in sorted([m for m in M if not m['cut']], key=lambda x: -x['pop'])[:top]]
lines.append(f'--- GLOBAL change top {top} (non-CUT frames: unmarked cuts, exposure steps, flashes)')
lines += [fmt(m) for m in sorted([m for m in M if not m['cut']], key=lambda x: -x['med'])[:top]]
lines.append('--- CAMERA: CUT frames / whips 12–20°/frame / turns > 20° that are not cuts are listed as CUT (check them)')
lines += [fmt(m) for m in M if m['cut'] or 12 <= m['turn']]
lines.append('--- DRAW-COUNT jumps on non-cut frames (culling / visibility)')
lines += [fmt(m) for m in M if m['draws'] is not None and abs(m['ddraw']) >= max(12, 0.08 * (m['draws'] or 1)) and not m['cut']]
lines.append(f'--- EXPOSURE pumps (luma peak/dip ≥ 10 % both sides within ±8 frames, no flash, no cut), top {top}')
lines += [f"f{i:04d} {lab(i)} prominence {pr:.2f} (log) luma={L[i]:.4f}" for i, pr in pumps[:top]]
rep = '\n'.join(lines)
open(os.path.join(out, 'report.txt'), 'w').write(rep + '\n')
json.dump({'seq': seq, 'frames': F, 'metrics': M, 'pumps': [[i, pr] for i, pr in pumps]}, open(os.path.join(out, 'events.json'), 'w'))
print(rep)
