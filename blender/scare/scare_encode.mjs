#!/usr/bin/env node
// JUMPSCARE (#147i) encoder: linear Cycles EXR frames -> a LOG-encoded, scene-referred H.264 MP4 per tier
// (STATUS-jumpscare Spec §3). No npm dependencies: ffmpeg (system tool) decodes the EXRs and encodes the MP4;
// everything in between (linear downscale, log curve, BT.709 Y'CbCr, chroma siting, dither, round-trip check) is here.
//
//   node blender/scare/scare_encode.mjs --frames .cache/scare/frames/<tag> [--expect 30] [--ref still.exr] [--check]
//   node blender/scare/scare_encode.mjs --still scratch/jumpscare/look-r35.exr --synth 30 [--boil 0.02] --check
//   node blender/scare/scare_encode.mjs --calib --check                     (16-step grey + R/G/B ramp chart clip)
//   ... --tiers max,medium,low (default) --crf max=18,medium=20,low=24 --out scratch/jumpscare/encode --name scare_face
//   ... --ship --approved "<AD review id of the still>"   (frames mode only: copies into public/assets/<tier>/)
//
// Log curve (per channel, scene-referred): v = log2(1 + L/L0) / R, R = log2(1 + Lmax/L0), L0 = Lmax / 2^stops,
// Lmax = 4 x p99.9 of the reference frame's luminance. Decode: L = L0 * (2^(v R) - 1). With the L0 pedestal the EV
// error of a code error dv is exactly dv * R, so 1 RGB' code (1/255) = R/255 EV (0.047 EV at 12 stops).
// The stream is tagged bt709 / bt709 / iec61966-2-1 / tv: the browser converts Y'CbCr -> R'G'B' with the BT.709
// matrix and (sRGB transfer, BT.709 primaries = sRGB) needs no transfer conversion; the runtime samples it as an
// SRGBColorSpace texture (hardware sRGB decode) and re-applies sRGBTransferOETF to get v back (Spec §3).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
function opt(k, d) {
  const i = argv.indexOf('--' + k);
  if (i < 0) return d;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}
const flag = (k) => argv.includes('--' + k);
const log = (...a) => console.log('[scare-encode]', ...a);
// Runs as the scare-render POST step, i.e. after assets.mjs released the Blender lock, possibly while a headless-Chrome
// fps measurement starts: lowest CPU priority (inherited by the ffmpeg children) and x264 capped at 4 threads.
try {
  os.setPriority(19);
} catch {}
const die = (m) => {
  console.error('[scare-encode] ERROR', m);
  process.exit(1);
};

// #147n: Low ships a 640x400 crf 24 clip (94.6 KB; 960x600 crf 22 would be ~200 KB, over the ~134 KB Low had left):
// round trip EV err p50 / p95 / p99 0.064 / 0.255 / 0.425 on the lit face (Medium 1280x800 crf 20: 0.038 / 0.144 / 0.231).
const TIER_RES = { max: [1920, 1200], medium: [1280, 800], low: [640, 400] };
const CRF = { max: 18, medium: 20, low: 24 };
// Explicit H.264 levels (x264 picked 5.1 / 5.0 / 5.0 by itself from veryslow's 16 refs): 1920x1200 = 9000 MBs needs
// level 5.0 (4.2 caps at 8704); 1280x800 / 960x600 fit level 4.0 ('avc1.640028') with refs <= 8 (DPB 12288 KB).
// #147l: computed per encoded size (levelFor): level 4.0 whenever the frame fits its MaxFS 8192 MBs, refs capped by its
// MaxDpbMbs 32768 (1600x1000 = 100 x 63 = 6300 MBs -> ref 5); else level 5.0 (MaxDpbMbs 110400, ref <= 16).
function levelFor(w, h) {
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
  if (mbs <= 8192) return ['4.0', Math.min(8, Math.floor(32768 / mbs))];
  return ['5.0', Math.min(16, Math.floor(110400 / mbs))];
}
// #147l: never UPSCALE a rendered sequence (a 1600x1000 render ships at 1600x1000 on Max, not Lanczos-invented 1920x1200
// pixels): each tier is min(tier size, source size) at the tier's 16:10 aspect (even dimensions); --res max=WxH overrides.
const RES_OVERRIDE = {};
for (const kv of String(opt('res', '')).split(',').filter((s) => s.includes('='))) {
  const [k, v] = kv.split('=');
  RES_OVERRIDE[k] = v.split('x').map(Number);
}
function tierRes(t, src) {
  if (RES_OVERRIDE[t]) return RES_OVERRIDE[t];
  const [w, h] = TIER_RES[t];
  if (!src || src.w >= w) return [w, h];
  const s = src.w / w;
  return [Math.round((w * s) / 2) * 2, Math.round((h * s) / 2) * 2];
}
const RES = {};
for (const kv of String(opt('crf', '')).split(',').filter((s) => s.includes('='))) {
  const [k, v] = kv.split('=');
  CRF[k] = Number(v);
}
const TIERS = String(opt('tiers', 'max,medium,low')).split(',').map((s) => s.trim()).filter(Boolean);
for (const t of TIERS) if (!TIER_RES[t]) die(`unknown tier ${t}`);
const FPS = Number(opt('fps', 30));
const STOPS = Number(opt('stops', 12));
const NAME = String(opt('name', 'scare_face'));
const OUTDIR = path.resolve(ROOT, String(opt('out', 'scratch/jumpscare/encode')));
const PRESET = String(opt('preset', 'veryslow'));
const DITHER = Number(opt('dither', 1.0));      // TPDF peak amplitude in output code units (static pattern)

// ---------------------------------------------------------------- EXR in (native half/float planes, no swscale)
// ffmpeg's EXR decoder outputs gbr(a)pf16le natively; converting to gbrpf32le goes through swscale and is LOSSY for
// HDR values (measured on look-r35.exr: max relative error 1.0), so we take the native planes and decode halves here.
const H2F = new Float32Array(65536);
for (let x = 0; x < 65536; x++) {
  const s = x >> 15, e = (x >> 10) & 31, m = x & 1023;
  let v;
  if (e === 0) v = m * 2 ** -24;
  else if (e === 31) v = m ? NaN : Infinity;
  else v = (1 + m / 1024) * 2 ** (e - 15);
  H2F[x] = s ? -v : v;
}
function probe(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height,pix_fmt,profile,level,color_range,color_space,color_transfer,color_primaries,nb_frames,codec_name',
    '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe ${file}: ${r.stderr}`);
  return JSON.parse(r.stdout).streams[0];
}
function readExr(file) {
  const st = probe(file);
  const fmt = st.pix_fmt;
  const m = /^gbr(a?)pf(16|32)le$/.exec(fmt);
  if (!m) throw new Error(`${file}: unexpected EXR pixel format ${fmt}`);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-c:v', 'rawvideo', '-pix_fmt', fmt,
    '-f', 'rawvideo', '-'], { maxBuffer: 1 << 29 });
  if (r.status !== 0) throw new Error(`ffmpeg ${file}: ${r.stderr}`);
  const w = st.width, h = st.height, n = w * h;
  const buf = r.stdout;
  const planes = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];       // G, B, R (gbr order)
  if (m[2] === '16') {
    const u = new Uint16Array(buf.buffer, buf.byteOffset, buf.length >> 1);
    for (let p = 0; p < 3; p++) for (let i = 0, o = p * n; i < n; i++) planes[p][i] = H2F[u[o + i]];
  } else {
    const f = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
    for (let p = 0; p < 3; p++) planes[p].set(f.subarray(p * n, p * n + n));
  }
  for (const pl of planes) for (let i = 0; i < n; i++) if (!(pl[i] > 0)) pl[i] = 0;   // NaN / negative -> 0
  return { w, h, R: planes[2], G: planes[0], B: planes[1] };
}
const lum = (R, G, B, i) => 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i];
function percentileLum(img, p) {
  const n = img.w * img.h, Y = new Float32Array(n);
  for (let i = 0; i < n; i++) Y[i] = lum(img.R, img.G, img.B, i);
  Y.sort();
  return Y[Math.min(n - 1, Math.floor(p * n))];
}

// ---------------------------------------------------------------- linear-light resampling
function lanczos(x, a) {
  if (x === 0) return 1;
  if (x <= -a || x >= a) return 0;
  const px = Math.PI * x;
  return (a * Math.sin(px) * Math.sin(px / a)) / (px * px);
}
function weights(inN, outN, a = 3) {
  const scale = outN / inN, fsc = Math.min(1, scale), support = a / fsc;
  const taps = Math.ceil(support * 2) + 1;
  const idx = new Int32Array(outN * taps), w = new Float32Array(outN * taps);
  for (let o = 0; o < outN; o++) {
    const c = (o + 0.5) / scale - 0.5, i0 = Math.floor(c - support) + 1;
    let sum = 0;
    for (let t = 0; t < taps; t++) {
      const i = i0 + t, v = lanczos((i - c) * fsc, a);
      idx[o * taps + t] = Math.min(inN - 1, Math.max(0, i));
      w[o * taps + t] = v;
      sum += v;
    }
    for (let t = 0; t < taps; t++) w[o * taps + t] /= sum;
  }
  return { idx, w, taps };
}
const WCACHE = new Map();
function resize(pl, w, h, ow, oh) {
  if (ow === w && oh === h) return pl;
  const key = `${w}x${h}->${ow}x${oh}`;
  if (!WCACHE.has(key)) WCACHE.set(key, [weights(w, ow), weights(h, oh)]);
  const [WX, WY] = WCACHE.get(key);
  const tmp = new Float32Array(ow * h);
  for (let y = 0; y < h; y++) {
    const row = y * w, orow = y * ow;
    for (let o = 0; o < ow; o++) {
      let s = 0;
      const b = o * WX.taps;
      for (let t = 0; t < WX.taps; t++) s += pl[row + WX.idx[b + t]] * WX.w[b + t];
      tmp[orow + o] = s;
    }
  }
  const out = new Float32Array(ow * oh);
  for (let y = 0; y < oh; y++) {
    const b = y * WY.taps, orow = y * ow;
    for (let t = 0; t < WY.taps; t++) {
      const r = WY.idx[b + t] * ow, wt = WY.w[b + t];
      for (let x = 0; x < ow; x++) out[orow + x] += tmp[r + x] * wt;
    }
  }
  for (let i = 0; i < out.length; i++) if (out[i] < 0) out[i] = 0;   // Lanczos ringing on HDR edges
  return out;
}

// ---------------------------------------------------------------- synthetic motion proxy (size / round-trip test only)
// Mimics the planned 1.0 s arc (Spec §2 'Motion', r35 staging): f0-6 arrival from below with a spring overshoot toward
// the lens, a slow drift (yaw ~2 deg = a few px, roll +-1.5 deg), and the f26-29 lurch (0.19 -> 0.11 m = x1.7 scale) as
// the jaw shadows the torch. No motion blur, no hair/jaw motion — a size bracket, not a look.
function synthPose(f) {
  const t = f / FPS;
  const spring = (a0, k) => a0 * Math.exp(-t * k) * Math.cos(t * 2 * Math.PI * 4.2);
  let s = 1 + spring(-0.06, 9), dy = spring(48, 9), dx = 6 * Math.sin(2 * Math.PI * t / 1.3) - 3;
  dy += 4 * Math.sin(2 * Math.PI * t / 1.7 + 1);
  const rot = (1.5 * Math.sin(2 * Math.PI * t / 1.1 + 0.4) * Math.PI) / 180;
  let gain = 1;
  if (f > 25) {
    const u = (f - 25) / 4;
    s *= 1 + 0.7 * u * u;
    gain = 1 - 0.9 * u ** 1.5;
  }
  return { s, dx, dy, rot, gain };
}
function warp(pl, w, h, P) {
  const out = new Float32Array(w * h), cx = w / 2, cy = h / 2;
  const c = Math.cos(-P.rot) / P.s, sn = Math.sin(-P.rot) / P.s;
  const cr = (x) => {          // Catmull-Rom weights
    const x2 = x * x, x3 = x2 * x;
    return [(-x3 + 2 * x2 - x) / 2, (3 * x3 - 5 * x2 + 2) / 2, (-3 * x3 + 4 * x2 + x) / 2, (x3 - x2) / 2];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ux = x + 0.5 - cx - P.dx, uy = y + 0.5 - cy - P.dy;
      const sx = c * ux - sn * uy + cx - 0.5, sy = sn * ux + c * uy + cy - 0.5;
      const ix = Math.floor(sx), iy = Math.floor(sy);
      if (ix < -2 || iy < -2 || ix > w + 1 || iy > h + 1) continue;
      const wx = cr(sx - ix), wy = cr(sy - iy);
      let s = 0;
      for (let j = 0; j < 4; j++) {
        const yy = Math.min(h - 1, Math.max(0, iy - 1 + j)) * w;
        let r = 0;
        for (let i = 0; i < 4; i++) r += pl[yy + Math.min(w - 1, Math.max(0, ix - 1 + i))] * wx[i];
        s += r * wy[j];
      }
      out[y * w + x] = s > 0 ? s * P.gain : 0;
    }
  }
  return out;
}
function xorshift(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
function gauss(rnd) {
  return Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
}

// ---------------------------------------------------------------- log curve, BT.709 Y'CbCr (tv), 4:2:0 left-sited
function logEncode(pl, L0, R) {
  const out = new Float32Array(pl.length), iL0 = 1 / L0, iR = 1 / R;
  for (let i = 0; i < pl.length; i++) {
    const L = pl[i];
    out[i] = L > 0 ? Math.min(1, Math.log2(1 + L * iL0) * iR) : 0;
  }
  return out;
}
const KR = 0.2126, KB = 0.0722, KG = 1 - KR - KB;
function toYuv(vr, vg, vb, w, h, seed = 12345) {
  const n = w * h, cw = w >> 1, ch = h >> 1;
  const out = Buffer.alloc(n + 2 * cw * ch);
  const cb = new Float32Array(n), cr = new Float32Array(n);
  const rnd = xorshift(seed);
  const d = () => (rnd() + rnd() - 1) * DITHER;
  const q = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)));
  for (let i = 0; i < n; i++) {
    const y = KR * vr[i] + KG * vg[i] + KB * vb[i];
    out[i] = q(16 + 219 * y + d(), 0, 255);
    cb[i] = (vb[i] - y) / 1.8556;
    cr[i] = (vr[i] - y) / 1.5748;
  }
  // H.264 default chroma location 0 ('left'): co-sited with the even luma column, vertically between the two rows
  for (let j = 0; j < ch; j++) {
    const r0 = 2 * j * w, r1 = r0 + w;
    for (let i = 0; i < cw; i++) {
      const x = 2 * i, xm = Math.max(0, x - 1), xp = Math.min(w - 1, x + 1);
      const fu = (a) => 0.125 * (a[r0 + xm] + a[r1 + xm] + a[r0 + xp] + a[r1 + xp]) + 0.25 * (a[r0 + x] + a[r1 + x]);
      out[n + j * cw + i] = q(128 + 224 * fu(cb) + d(), 0, 255);
      out[n + cw * ch + j * cw + i] = q(128 + 224 * fu(cr) + d(), 0, 255);
    }
  }
  return out;
}
function fromYuv(buf, off, w, h) {          // -> R'G'B' (v) planes, bilinear chroma (left-sited)
  const n = w * h, cw = w >> 1, ch = h >> 1;
  const vr = new Float32Array(n), vg = new Float32Array(n), vb = new Float32Array(n);
  const U = off + n, V = off + n + cw * ch;
  for (let y = 0; y < h; y++) {
    const cy = Math.min(ch - 1, Math.max(0, (y - 0.5) / 2));
    const j0 = Math.floor(cy), j1 = Math.min(ch - 1, j0 + 1), fy = cy - j0;
    for (let x = 0; x < w; x++) {
      const cx = x / 2, i0 = Math.floor(cx), i1 = Math.min(cw - 1, i0 + 1), fx = cx - i0;
      const bil = (base) => (buf[base + j0 * cw + i0] * (1 - fx) + buf[base + j0 * cw + i1] * fx) * (1 - fy)
        + (buf[base + j1 * cw + i0] * (1 - fx) + buf[base + j1 * cw + i1] * fx) * fy;
      const yy = (buf[off + y * w + x] - 16) / 219, cb = (bil(U) - 128) / 224, cr = (bil(V) - 128) / 224;
      const i = y * w + x;
      vr[i] = yy + 1.5748 * cr;
      vb[i] = yy + 1.8556 * cb;
      vg[i] = (yy - KR * vr[i] - KB * vb[i]) / KG;
    }
  }
  return [vr, vg, vb];
}

// ---------------------------------------------------------------- ffmpeg encode / decode
function startEncoder(file, w, h, crf, level) {
  const tags = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1'];
  const args = ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${w}x${h}`, '-framerate', String(FPS),
    ...tags, '-chroma_sample_location', 'left', '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', PRESET, '-crf', String(crf), '-profile:v', 'high', '-level:v', level[0], '-pix_fmt', 'yuv420p',
    '-threads', '4', '-x264-params', `keyint=${FPS}:min-keyint=${FPS}:scenecut=0:aq-mode=3:chromaloc=0:ref=${level[1]}`,
    ...tags, '-chroma_sample_location', 'left', '-movflags', '+faststart', '-an', file];
  const p = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  const done = new Promise((res, rej) => p.on('close', (code) => (code === 0 ? res() : rej(new Error(`x264 ${file}: ${err}`)))));
  const write = (buf) => new Promise((res) => (p.stdin.write(buf) ? res() : p.stdin.once('drain', res)));
  return { write, end: () => (p.stdin.end(), done) };
}
function decodeMp4(file, w, h) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`decode ${file}: ${r.stderr}`);
  return { buf: r.stdout, frames: Math.floor(r.stdout.length / (w * h * 1.5)) };
}
function codecString(st) {          // RFC 6381 avc1.PPCCLL (High = 0x64, constraint flags 0, level_idc)
  const hex = (v) => Number(v).toString(16).padStart(2, '0');
  const prof = { High: 100, Main: 77, 'Constrained Baseline': 66, Baseline: 66 }[st.profile] ?? 100;
  return `avc1.${hex(prof)}00${hex(st.level)}`;
}
function writePng(file, rgb, w, h) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-i', '-', file], { input: rgb });
  if (r.status !== 0) throw new Error(`png ${file}: ${r.stderr}`);
}
// preview display transform for inspection only (NOT the game's AgX): exposure, Narkowicz ACES fit, sRGB OETF
function displayRgb(lr, lg, lb, ev, n) {
  const k = 2 ** ev, out = Buffer.alloc(n * 3);
  const tm = (x) => {
    x *= k;
    const y = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
    const c = Math.min(1, Math.max(0, y));
    return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
  };
  for (let i = 0; i < n; i++) {
    out[3 * i] = tm(lr[i]);
    out[3 * i + 1] = tm(lg[i]);
    out[3 * i + 2] = tm(lb[i]);
  }
  return out;
}

// ---------------------------------------------------------------- sources
const mode = opt('calib') ? 'calib' : opt('still') ? 'synth' : opt('frames') ? 'frames' : null;
if (!mode) die('need --frames DIR, --still FILE --synth N, or --calib');
let frameFiles = [];
let NF;
if (mode === 'frames') {
  const dir = path.resolve(ROOT, String(opt('frames')));
  frameFiles = fs.readdirSync(dir).filter((f) => /^f\d{4}\.exr$/.test(f)).sort().map((f) => path.join(dir, f));
  if (opt('subset')) {          // inspection clip of a few frames (e.g. the first full-res chunk 12,16,17): never shipped
    const want = String(opt('subset')).split(',').map((v) => path.join(dir, `f${String(Number(v)).padStart(4, '0')}.exr`));
    const missing = want.filter((f) => !fs.existsSync(f));
    if (missing.length) die(`--subset: missing ${missing.map((f) => path.basename(f)).join(', ')}`);
    frameFiles = want;
    argv.push('--expect', String(want.length));
  }
  const expect = Number(opt('expect', 30));
  const ok = opt('subset') ? true : frameFiles.length === expect && frameFiles.every((f, i) => path.basename(f) === `f${String(i).padStart(4, '0')}.exr`);
  if (!ok) {
    log(`incomplete: ${frameFiles.length}/${expect} frames in ${path.relative(ROOT, dir)} — not encoding (render the remaining chunks)`);
    console.log('RESULT ' + JSON.stringify({ job: 'scare-encode', incomplete: true, frames: frameFiles.length, expect }));
    process.exit(0);
  }
  NF = expect;
} else if (mode === 'synth') NF = Number(opt('synth', 30));
else NF = Number(opt('nframes', 30));
if (flag('ship') && (mode !== 'frames' || opt('subset') || typeof opt('approved') !== 'string'))
  die('--ship needs --frames (a real rendered sequence) and --approved "<AD review id of the still>" (Spec gate: the AD passes a still before any sequence ships)');

let still = null, L0 = 1, R = STOPS, LMAX = 0, refName = null, srcDims = null;
if (mode !== 'calib') {
  const ref = opt('ref') ? path.resolve(ROOT, String(opt('ref'))) : mode === 'synth' ? path.resolve(ROOT, String(opt('still')))
    : frameFiles[Math.floor(NF / 2)];
  refName = path.relative(ROOT, ref);
  const refImg = mode === 'synth' && !opt('ref') ? (still = readExr(ref)) : readExr(ref);
  srcDims = { w: refImg.w, h: refImg.h };
  if (mode === 'synth') still = still ?? readExr(path.resolve(ROOT, String(opt('still'))));
  const p999 = percentileLum(refImg, 0.999);
  LMAX = opt('lmax') ? Number(opt('lmax')) : 4 * p999;
  L0 = LMAX / 2 ** STOPS;
  R = Math.log2(1 + LMAX / L0);
  log(`reference ${refName}: p99.9 ${p999.toFixed(1)} -> Lmax ${LMAX.toFixed(1)}, L0 ${L0.toFixed(4)}, R ${R.toFixed(4)} (${STOPS} stops)`);
}

// calibration chart (v domain): row 0 = 16-step grey, rows 1-3 = R / G / B ramps (others 0); 16 x 4 patches
const CAL_COLS = 16, CAL_ROWS = 4;
function calibPlanes(w, h) {
  const n = w * h, vr = new Float32Array(n), vg = new Float32Array(n), vb = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const row = Math.min(CAL_ROWS - 1, Math.floor((y / h) * CAL_ROWS));
    for (let x = 0; x < w; x++) {
      const col = Math.min(CAL_COLS - 1, Math.floor((x / w) * CAL_COLS)), v = col / (CAL_COLS - 1), i = y * w + x;
      vr[i] = row === 0 || row === 1 ? v : 0;
      vg[i] = row === 0 || row === 2 ? v : 0;
      vb[i] = row === 0 || row === 3 ? v : 0;
    }
  }
  return [vr, vg, vb];
}

// ---------------------------------------------------------------- main
fs.mkdirSync(OUTDIR, { recursive: true });
const tag = mode === 'calib' ? `${NAME}-calib` : mode === 'synth' ? `${NAME}-synth${opt('boil') ? '-boil' : ''}`
  : opt('subset') ? `${NAME}-subset` : NAME;
const CHECK_FRAMES = new Set([0, Math.floor(NF / 4), Math.floor(NF / 2), Math.floor((3 * NF) / 4), NF - 1]);
const enc = {}, keep = {};
for (const t of TIERS) {
  RES[t] = tierRes(t, srcDims);
  const [w, h] = RES[t];
  enc[t] = startEncoder(path.join(OUTDIR, `${tag}-${t}.mp4`), w, h, CRF[t], levelFor(w, h));
  keep[t] = new Map();
}
const t0 = Date.now();
const boil = Number(opt('boil', 0));
for (let f = 0; f < NF; f++) {
  let src = null;
  if (mode === 'frames') src = readExr(frameFiles[f]);
  else if (mode === 'synth') {
    const P = synthPose(f);
    src = { w: still.w, h: still.h, R: warp(still.R, still.w, still.h, P), G: warp(still.G, still.w, still.h, P), B: warp(still.B, still.w, still.h, P) };
    if (boil > 0) {           // pessimistic bracket: i.i.d. per-pixel per-frame denoiser residual (multiplicative)
      const rnd = xorshift(1000 + f);
      for (let i = 0; i < src.R.length; i++) {
        const g = 1 + boil * gauss(rnd);
        src.R[i] *= g; src.G[i] *= g; src.B[i] *= g;
      }
    }
  }
  for (const t of TIERS) {
    const [w, h] = RES[t];
    let vr, vg, vb;
    if (mode === 'calib') [vr, vg, vb] = calibPlanes(w, h);
    else {
      vr = logEncode(resize(src.R, src.w, src.h, w, h), L0, R);
      vg = logEncode(resize(src.G, src.w, src.h, w, h), L0, R);
      vb = logEncode(resize(src.B, src.w, src.h, w, h), L0, R);
    }
    if (CHECK_FRAMES.has(f)) keep[t].set(f, [vr, vg, vb]);
    await enc[t].write(toYuv(vr, vg, vb, w, h));
  }
  if (f % 10 === 9 || f === NF - 1) log(`frame ${f + 1}/${NF}  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
for (const t of TIERS) await enc[t].end();

const out = { job: 'scare-encode', mode, tag, ref: refName, Lmax: LMAX, L0, R, stops: STOPS, fps: FPS, frames: NF, dither: DITHER,
  boil, tiers: {} };
for (const t of TIERS) {
  const [w, h] = RES[t];
  const file = path.join(OUTDIR, `${tag}-${t}.mp4`);
  const st = probe(file);
  const bytes = fs.statSync(file).size;
  const rec = { file: path.relative(ROOT, file), bytes, kb: Math.round(bytes / 102.4) / 10, w, h, crf: CRF[t], codec: codecString(st),
    profile: st.profile, level: st.level, tags: `${st.color_primaries}/${st.color_transfer}/${st.color_space}/${st.color_range}` };
  if (flag('check')) {
    const { buf, frames } = decodeMp4(file, w, h);
    rec.decodedFrames = frames;
    const n = w * h, fsz = n * 1.5;
    const errs = [], bias = [], codeErr = [];
    let calib = null;
    for (const [f, [sr, sg, sb]] of keep[t]) {
      const [dr, dg, db] = fromYuv(buf, f * fsz, w, h);
      if (mode === 'calib') {          // patch centres: mean over the middle 40 % of each patch, error in RGB' codes
        calib = calib ?? [];
        for (let row = 0; row < CAL_ROWS; row++) {
          for (let col = 0; col < CAL_COLS; col++) {
            const x0 = Math.floor(((col + 0.3) / CAL_COLS) * w), x1 = Math.floor(((col + 0.7) / CAL_COLS) * w);
            const y0 = Math.floor(((row + 0.3) / CAL_ROWS) * h), y1 = Math.floor(((row + 0.7) / CAL_ROWS) * h);
            let er = 0, eg = 0, eb = 0, c = 0;
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
              const i = y * w + x;
              er += dr[i] - sr[i]; eg += dg[i] - sg[i]; eb += db[i] - sb[i]; c++;
            }
            calib.push(Math.max(Math.abs(er / c), Math.abs(eg / c), Math.abs(eb / c)) * 255);
          }
        }
        continue;
      }
      // lit face = within 8 stops of Lmax; EV error of luminance with the L0 pedestal
      const lit = LMAX / 256;
      for (let i = 0; i < n; i += 3) {
        const Ls = KR * L0 * (2 ** (sr[i] * R) - 1) + KG * L0 * (2 ** (sg[i] * R) - 1) + KB * L0 * (2 ** (sb[i] * R) - 1);
        if (Ls < lit) continue;
        const Ld = KR * L0 * (2 ** (dr[i] * R) - 1) + KG * L0 * (2 ** (dg[i] * R) - 1) + KB * L0 * (2 ** (db[i] * R) - 1);
        const e = Math.log2((Math.max(Ld, 0) + L0) / (Ls + L0));
        errs.push(Math.abs(e));
        bias.push(e);
        codeErr.push(Math.abs(dg[i] - sg[i]) * 255);
      }
      if (f === Math.floor(NF / 2) && flag('previews')) {      // decoded vs source at the viewing exposure (inspection)
        const ev = Number(opt('ev', -10.99));
        const lin = (a) => Float32Array.from(a, (v) => L0 * (2 ** (v * R) - 1));
        writePng(path.join(OUTDIR, `${tag}-${t}-f${f}-dec.png`), displayRgb(lin(dr), lin(dg), lin(db), ev, n), w, h);
        writePng(path.join(OUTDIR, `${tag}-${t}-f${f}-src.png`), displayRgb(lin(sr), lin(sg), lin(sb), ev, n), w, h);
        writePng(path.join(OUTDIR, `${tag}-${t}-f${f}-dec+4ev.png`), displayRgb(lin(dr), lin(dg), lin(db), ev + 4, n), w, h);
      }
    }
    if (mode === 'calib') {
      calib.sort((a, b) => a - b);
      rec.calib = { patches: calib.length, maxCodeErr: +calib[calib.length - 1].toFixed(2), p50CodeErr: +calib[calib.length >> 1].toFixed(2) };
    } else {
      const s = Float32Array.from(errs).sort(), c = Float32Array.from(codeErr).sort();
      const pct = (a, p) => +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(3);
      rec.check = { litSamples: s.length, evErrP50: pct(s, 0.5), evErrP95: pct(s, 0.95), evErrP99: pct(s, 0.99),
        evBias: +(bias.reduce((a, b) => a + b, 0) / Math.max(1, bias.length)).toFixed(4), gCodeErrP50: pct(c, 0.5), gCodeErrP95: pct(c, 0.95) };
    }
  }
  out.tiers[t] = rec;
  log(`${t}: ${rec.file} ${rec.kb} KB ${rec.codec} ${rec.tags}${rec.check ? ' check ' + JSON.stringify(rec.check) : ''}${rec.calib ? ' calib ' + JSON.stringify(rec.calib) : ''}`);
}
const meta = { name: NAME, fps: FPS, frames: NF, stops: STOPS, L0, R, Lmax: LMAX, ref: refName,
  decode: 'L = L0 * (2^(v * R) - 1), v = sRGBTransferOETF(texture) (tags bt709/bt709/iec61966-2-1/tv)',
  codecs: Object.fromEntries(TIERS.map((t) => [t, out.tiers[t].codec])) };
fs.writeFileSync(path.join(OUTDIR, `${tag}.json`), JSON.stringify(meta, null, 2) + '\n');
if (mode === 'calib') fs.writeFileSync(path.join(OUTDIR, `${tag}-chart.json`), JSON.stringify({ cols: CAL_COLS, rows: CAL_ROWS,
  rows_desc: ['grey', 'red', 'green', 'blue'], v: 'col / 15 in the named channel(s), 0 elsewhere; sample the middle 40 % of each patch' }, null, 2) + '\n');
if (flag('ship')) {
  for (const t of TIERS) {
    const dst = path.join(ROOT, 'public', 'assets', t, `${NAME}.mp4`);
    fs.copyFileSync(path.join(OUTDIR, `${tag}-${t}.mp4`), dst);
    fs.copyFileSync(path.join(OUTDIR, `${tag}.json`), path.join(ROOT, 'public', 'assets', t, `${NAME}.json`));   // L0 / R / codecs
    log(`shipped ${path.relative(ROOT, dst)} + ${NAME}.json (approved: ${opt('approved')})`);
  }
  fs.writeFileSync(path.join(OUTDIR, `${tag}.shipped.json`), JSON.stringify({ approved: opt('approved'), at: new Date().toISOString(), meta }, null, 2) + '\n');
}
out.seconds = Math.round((Date.now() - t0) / 100) / 10;
console.log('RESULT ' + JSON.stringify(out));
