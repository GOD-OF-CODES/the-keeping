// Audio lane, fix round 4: post-process a c2-listen.mjs recording.
//   node scripts/qa/c2-listen-post.mjs [scratch/listen]
// → c2-c2c.wav (48 kHz 16-bit stereo), c2-strike.wav (20 s around the strike), sync.json, prints a summary:
// ffmpeg ebur128 (integrated LUFS, LRA, true peak), astats (clipped samples), silencedetect (gaps), the loudest
// moment, and SYNC — every scheduled event's audio onset vs the picture frame that shows it (context-time domain,
// picture converted to "heard" context time with AudioContext.getOutputTimestamp()).
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'scratch/listen';
const J = JSON.parse(readFileSync(join(dir, 'c2-listen.json'), 'utf8'));
const raw = join(dir, 'c2-c2c.raw.wav');
const full = join(dir, 'c2-c2c.wav');
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-nostats', '-y', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
const require_spawn = (args) => spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 64 << 20 }).stderr;

// 1. 48 kHz 16-bit stereo (soxr if built in, else swr)
ff(['-i', raw, '-af', 'aresample=48000:filter_size=64:phase_shift=10:cutoff=0.97', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', full]);

// 2. read PCM of the RAW file (context-rate timing is exact there)
const buf = readFileSync(raw); const sr = buf.readUInt32LE(24);
const pcm = new Int16Array(buf.buffer, buf.byteOffset + 44, (buf.length - 44) >> 1);
const N = pcm.length >> 1;
// context time of sample i from the worklet's per-chunk timestamps (exact even if the render clock ever jumped)
const CT = J.chunkT ?? null, CN = 4800;
const tOf = (i) => (CT ? CT[Math.min(CT.length - 1, Math.floor(i / CN))] + (i % CN) / sr : J.wavT0 + i / sr);
const iOf = (t) => { if (!CT) return Math.round((t - J.wavT0) * sr); let lo = 0, hi = CT.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (CT[m] <= t) lo = m; else hi = m - 1; } return lo * CN + Math.round((t - CT[lo]) * sr); };
const jumps = CT ? CT.slice(1).map((t, k) => [k + 1, t - CT[k] - CN / sr]).filter(([, d]) => Math.abs(d) > 0.5 / sr).map(([k, d]) => [+(CT[k] - J.wavT0).toFixed(2), +(d * 1000).toFixed(2)]) : null;
const absAt = (i) => Math.max(Math.abs(pcm[2 * i]), Math.abs(pcm[2 * i + 1])) / 32768;

// picture: frames [rafTs, ctxNow, outCtx, outPerf, beat, cs, csT]. "heard" ctx time of a frame shown at the next vsync:
const frames = J.frames;
const shownCtx = (f) => (f[3] > 0 ? f[2] + (f[0] + 1000 / 60 - f[3]) / 1000 : f[1]);
const firstFrame = (cs, t) => frames.find((f) => f[5] === cs && f[6] != null && f[6] >= t);
// audio "heard" ctx time of a sample = its context time (getOutputTimestamp maps contextTime → the moment it's heard)

// onset finder: in [t0, t1] find the strongest 2 ms rise (energy ratio vs the 30 ms before), then the first sample
// above 50 % of that event's local peak
function onset(t0, t1) {
  const a = Math.max(0, iOf(t0)), b = Math.min(N - 1, iOf(t1)); const w = Math.round(sr * 0.002), pre = Math.round(sr * 0.03);
  const e = []; for (let i = a; i + w < b; i += w) { let s = 0; for (let k = i; k < i + w; k++) { const l = pcm[2 * k] / 32768, r = pcm[2 * k + 1] / 32768; s += l * l + r * r; } e.push([i, s / w]); }
  let best = null;
  for (let j = 15; j < e.length; j++) { let p = 0; for (let k = j - 15; k < j; k++) p += e[k][1]; p /= 15; const ratio = (e[j][1] + 1e-12) / (p + 1e-10); if (!best || ratio > best.r) best = { j, r: ratio }; }
  if (!best) return null;
  const i0 = e[best.j][0]; let pk = 0; for (let k = i0; k < Math.min(N, i0 + Math.round(sr * 0.06)); k++) pk = Math.max(pk, absAt(k));
  let on = i0 - pre; for (let k = Math.max(a, i0 - pre); k < i0 + Math.round(sr * 0.06); k++) if (absAt(k) >= 0.5 * pk) { on = k; break; }
  return { t: tOf(on), riseDb: +(10 * Math.log10(best.r)).toFixed(1), peakDb: +(20 * Math.log10(pk + 1e-9)).toFixed(1) };
}
const plays = J.plays; // [ctxNow, id, when|null, ok, bus]
const C2 = { contact: 7.56, sever: 7.6, lands: 7.9, pulses: [7.58, 8.4, 9.3, 10.35, 22.5, 23.5], slam: 21.05, slap: 22.95 };
const pf = (cs, t) => { const f = firstFrame(cs, t); return f ? shownCtx(f) : null; };
const ms = (x) => (x == null ? null : Math.round(x * 1000));
const sync = [];
const findPlay = (id, near) => plays.filter((p) => p[1] === id).map((p) => ({ ctx: p[0], when: p[2] ?? p[0], ok: p[3] })).sort((x, y) => Math.abs(x.when - near) - Math.abs(y.when - near))[0];
const c2t0 = (() => { const f = frames.find((f) => f[5] === 'C2' && f[6] != null); return f ? f[1] - f[6] : null; })(); // ctx time of C2 clock 0 (frame-sampled)
function ev(name, id, csT, cs = 'C2', search = 0.35) {
  const pic = pf(cs, csT);
  const p = c2t0 != null ? findPlay(id, c2t0 + csT) : null;
  const o = pic != null ? onset(pic - search, pic + search) : null;
  sync.push({ name, id, csT, picHeard: pic && +pic.toFixed(4), when: p?.when != null ? +p.when.toFixed(4) : null, played: p?.ok ?? null, onset: o && +o.t.toFixed(4), riseDb: o?.riseDb, peakDb: o?.peakDb, onsetMinusPicMs: o && pic ? ms(o.t - pic) : null, whenMinusPicMs: p && pic ? ms(p.when - pic) : null });
}
ev('strike (cleaver contact)', 'cleaver_sever', C2.contact);
ev('head floor impact', 'head_drop', C2.lands);
C2.pulses.forEach((t, k) => ev(`jet pulse ${k + 1}`, 'arterial_spurt', t, 'C2', 0.25));
ev('front door slam', 'door_slam', C2.slam);
ev('Ada rise: off the table', 'ada_gown_slap', 22.2, 'C2', 0.25);
ev('Ada rise: knees on boards', 'ada_slap', C2.slap, 'C2', 0.25);

// 3. ffmpeg measurements
const eb = require_spawn(['-i', full, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-']);
const sumIdx = eb.lastIndexOf('Summary:'); const summ = eb.slice(sumIdx);
const num = (re) => { const m = summ.match(re); return m ? +m[1] : null; };
const I = num(/I:\s+(-?[\d.]+) LUFS/), LRA = num(/LRA:\s+(-?[\d.]+) LU/), TP = num(/Peak:\s+(-?[\d.]+) dBFS/);
const as = require_spawn(['-i', full, '-af', 'astats=metadata=0:measure_overall=Peak_level+RMS_level+Number_of_Infs+Flat_factor+Peak_count:measure_perchannel=none', '-f', 'null', '-']);
const sil = require_spawn(['-i', full, '-af', 'silencedetect=noise=-60dB:d=0.25', '-f', 'null', '-']);
const gaps = [...sil.matchAll(/silence_start: (-?[\d.]+)[\s\S]*?silence_end: (-?[\d.]+) \| silence_duration: ([\d.]+)/g)].map((m) => [+(+m[1]).toFixed(2), +(+m[3]).toFixed(2)]);
// clipping: samples at ±32767 in the 16-bit file
let clip = 0; for (let i = 0; i < pcm.length; i++) if (pcm[i] >= 32767 || pcm[i] <= -32768) clip++;
// loudest 400 ms momentary (K-weighting approximated by ffmpeg ebur128 framelog would be heavier; use plain RMS 400 ms
// and report the top 3 with what was playing)
const W = Math.round(sr * 0.4), H = Math.round(sr * 0.1); const mom = [];
for (let i = 0; i + W < N; i += H) { let s = 0; for (let k = i; k < i + W; k++) { const l = pcm[2 * k] / 32768, r = pcm[2 * k + 1] / 32768; s += (l * l + r * r) / 2; } mom.push([tOf(i), 10 * Math.log10(s / W + 1e-12)]); }
const csAt = (t) => { let f = null; for (const x of frames) { if (x[1] > t) break; f = x; } return f ? `${f[5] ?? f[4]}${f[6] != null ? '@' + f[6].toFixed(2) : ''}` : '?'; };
const top = [...mom].sort((x, y) => y[1] - x[1]).filter((x, i, arr) => arr.slice(0, i).every((y) => Math.abs(y[0] - x[0]) > 0.5)).slice(0, 5).map(([t, d]) => ({ at: csAt(t + 0.2), rmsDb: +d.toFixed(1) }));
// segments
const segOf = (pred) => { const fs = frames.filter(pred); return fs.length ? [fs[0][1], fs.at(-1)[1]] : null; };
const seg = { B03walk: segOf((f) => !f[5] && f[4] === 'B03'), C2: segOf((f) => f[5] === 'C2'), C2c: segOf((f) => f[5] === 'C2c'), B05: segOf((f) => !f[5] && f[4] === 'B05') };
const segRms = {}; for (const [k, v] of Object.entries(seg)) { if (!v) continue; const a = Math.max(0, iOf(v[0])), b = Math.min(N, iOf(v[1])); let s = 0; for (let i = a; i < b; i++) { const l = pcm[2 * i] / 32768, r = pcm[2 * i + 1] / 32768; s += (l * l + r * r) / 2; } segRms[k] = { from: +(v[0] - J.wavT0).toFixed(2), to: +(v[1] - J.wavT0).toFixed(2), rmsDb: +(10 * Math.log10(s / Math.max(1, b - a) + 1e-12)).toFixed(1) }; }

// EBU R128 momentary (K-weighted 400 ms) from ffmpeg's framelog, top 6 separated by > 0.6 s, with per-bus attribution
const ebv = require_spawn(['-i', full, '-af', 'ebur128', '-f', 'null', '-']);
const momK = [...ebv.matchAll(/t: *([\d.]+)\s.*?M: *(-?[\d.]+)/g)].map((m) => [+m[1], +m[2]]);
const busAt = (t) => { const o = {}; for (const [b, v] of Object.entries(J.bus ?? {})) { if (v.t0 == null) continue; const k = Math.floor((t - v.t0) / 0.1); const w = v.db.slice(Math.max(0, k - 4), k); if (w.length) o[b] = +(10 * Math.log10(w.reduce((s, d) => s + 10 ** (d / 10), 0) / w.length)).toFixed(1); } return o; };
const topK = [...momK].sort((x, y) => y[1] - x[1]).filter((x, i, arr) => arr.slice(0, i).every((y) => Math.abs(y[0] - x[0]) > 0.6)).slice(0, 6).map(([t, m]) => ({ at: csAt(J.wavT0 + t - 0.2), M: m, bus: busAt(J.wavT0 + t) }));
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate,channels,bits_per_sample:format=duration', '-of', 'compact', full], { encoding: 'utf8' }).stdout.trim();

// 4. the 20 s strike excerpt (strike − 8 s … + 12 s) from the 48 kHz file
const strike = sync[0]; const st = (strike.onset ?? strike.picHeard) - J.wavT0;
const exA = Math.max(0, st - 8);
ff(['-ss', exA.toFixed(3), '-t', '20', '-i', full, '-c:a', 'pcm_s16le', join(dir, 'c2-strike.wav')]);

// heart: the player-heart layer vs the jets (Ada's heart). Heart beats from the play log.
const hb = plays.filter((p) => /heart/.test(p[1])).map((p) => +((p[2] ?? p[0]) - (c2t0 ?? 0)).toFixed(2));
const dropped = plays.filter((p) => !p[3]).map((p) => `${p[1]}@${((p[2] ?? p[0]) - (c2t0 ?? 0)).toFixed(2)}`);
const out = { probe, topK, jumps, floatPeakDb: J.floatPeakDb, sr, durS: +(N / sr).toFixed(2), I, LRA, truePeak: TP, clipSamples: clip, gaps, top, seg: segRms, sync, heartPlaysC2clock: hb.slice(0, 60), dropped, chunkJitter: J.chunkMaxJitter, setup: J.setup, run: J.run, astats: as.split('\n').filter((l) => /Overall|Peak level|RMS level|Flat|Peak count/.test(l)).map((l) => l.replace(/^\[.*?\]\s*/, '')).slice(0, 8), strikeExcerptFrom: +exA.toFixed(2) };
writeFileSync(join(dir, 'sync.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, sync: undefined, heartPlaysC2clock: undefined }, null, 0));
for (const s of sync) console.log(`${s.name.padEnd(26)} ${s.id.padEnd(15)} played=${s.played} pic=${s.picHeard} onset-pic=${s.onsetMinusPicMs} ms when-pic=${s.whenMinusPicMs} ms rise=${s.riseDb} dB peak=${s.peakDb}`);
