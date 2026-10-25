#!/usr/bin/env node
// Reflection-cube export (LOAD round, contract #157b): the game itself captures its 13 room / yard reflection cubes
// in headless Chrome (real GPU, through scripts/shot.mjs and its lock, `?refl=capture` = the runtime capture path) plus
// the yard cube's two in-game re-captures (dawn at C5 26.6 / B12, night again at C6b), reads mip 0 of every face back
// (window.__game.exportReflections) and writes public/assets/<tier>/reflections.bin (src/render/refl-file.ts layout,
// gzip'd). The game then uploads these instead of capturing (cold Medium −130 s, warm −10 s, ≈ −1.3 GB GPU memory).
//
//   node scripts/qa/refl-export.mjs                    # medium + max (Low and WebGL2 have no reflections)
//   node scripts/qa/refl-export.mjs medium             # one tier
//   node scripts/qa/refl-export.mjs --dist scratch/x   # another build dir (parallel lanes never share one)
//   node scripts/qa/refl-export.mjs --dawn-only medium # only the B11 run (dawn / night-again) against the night export
//                                                      # (with --verify: only the dawn / night-again pair)
//   node scripts/qa/refl-export.mjs --verify medium    # shipped vs a fresh runtime capture (and capture vs capture),
//                                                      # + the EXT dawn / night-again cubes after the story's own changes
//                                                      #   (content AND mip count) and the C6 + 20 s hood luminance
//
// Re-run after anything the capture sees changes. Data changes (level GLBs / lightmaps, level-layout.json,
// material-spec.json) and any LOOK value (src/render/look.ts defaults + preset amounts) are in the file's key: the game
// then logs "shipped cubes are stale" and captures at runtime (correct, but the load is ≈ 10 s slower again).
// CODE changes (materials, lightmap / probe-lit material, lights, atmosphere, the capture) are NOT: bump
// REFLECTIONS_VERSION in src/render/refl-file.ts and re-run. Then `node scripts/assets.mjs --manifest`.
//
// Each tier = two shot.mjs runs: (1) a default load → the 13 load-time ("night") cubes; (2) `--beat B11` + the strict
// playthrough (scripts/qa/playthrough.mjs, unchanged) → the yard cube exactly as the story's OWN re-captures leave it
// on the full route: dawn (C5 26.6 + the re-capture) and night again (C6b / C7). LOAD fixer (F1,
// #157i): the first version read the dawn cube right after a bare B12 load and forced the night with a direct
// `fx('blue_hour', { mist: 0 })` — a state the game never captures in: the horizon / ground half of every side face was
// 2–5× darker than the cube the live game captures in C5 (hood luminance at C6 + 20 s 57 vs 87). Both runs must carry
// the same key (`--dawn-only` re-runs (2) against an existing night export). The same file is the shot.mjs
// scenario (default export); its mode comes from the page URL.

import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRATCH = join(ROOT, 'scratch', 'refl');
const FORMAT = 1; // src/render/refl-file.ts REFL_FILE_FORMAT
/**
 * LOAD fixer (F1, #157i): the dawn / night-again runs start at B11 and PLAY C5 (the strict bot): the yard cube is then
 * captured where the full route captures it — C5 26.6 brings the dawn and its mist (blue_hour, mist 1); the runtime
 * re-capture completes ≈ 1.5–3 s later, mist cards rolling in. A bare `--beat B12` restore sets the dawn at load
 * instead, and what the runtime cube then holds depends on how long its async precompile takes (B12 gameplay state, hood
 * luminance at C6 + 20 s 57; or C6 with the car and mist in the yard, 87): measured both ways on the same build.
 */
const DAWN_BEAT = 'B11';

/** src/render/refl-file.ts layout: 'TKRF', u32 format, u32 header bytes, JSON header, RGB half blocks (4-aligned). */
export function encodeReflFile({ key, size, cubes }) {
  const header = Buffer.from(JSON.stringify({ key, size, cubes: cubes.map((c) => ({ id: c.id, state: c.state, halfs: c.rgb.length / 2 })) }));
  const pad = (n) => (n + 3) & ~3;
  const hb = pad(header.length);
  let total = 12 + hb;
  for (const c of cubes) total += pad(c.rgb.length);
  const out = Buffer.alloc(total, 0);
  out.write('TKRF', 0, 'ascii');
  out.writeUInt32LE(FORMAT, 4);
  out.writeUInt32LE(hb, 8);
  header.copy(out, 12);
  out.fill(0x20, 12 + header.length, 12 + hb);
  let o = 12 + hb;
  for (const c of cubes) {
    c.rgb.copy(out, o);
    o += pad(c.rgb.length);
  }
  return out;
}

const pollUntil = async (qa, expr, timeoutS, what) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutS * 1000) {
    if (await qa.eval(`!!(${expr})`)) return true;
    await qa.wait(0.25);
  }
  qa.assert(false, `timed out after ${timeoutS}s waiting for ${what}`);
  return false;
};

const decodeCubes = (r, state) => r.cubes.map((c) => ({ id: c.id, state, rgb: Buffer.from(c.b64, 'base64') }));

/** max |a − b| over the half floats as numbers, and the mean (RGB, all faces). */
function halfDiff(a, b) {
  const h = (u) => {
    const s = (u & 0x8000) ? -1 : 1;
    const e = (u >> 10) & 0x1f;
    const m = u & 0x3ff;
    if (e === 0) return s * m * 2 ** -24;
    if (e === 31) return m ? NaN : s * Infinity;
    return s * (1 + m / 1024) * 2 ** (e - 15);
  };
  let max = 0;
  let sum = 0;
  let ref = 0;
  const n = a.length / 2;
  for (let i = 0; i < n; i++) {
    const x = h(a.readUInt16LE(i * 2));
    const y = h(b.readUInt16LE(i * 2));
    const d = Math.abs(x - y);
    if (d > max) max = d;
    sum += d;
    ref += Math.abs(y);
  }
  return { max, mean: sum / n, relMean: ref > 0 ? sum / ref : 0 };
}

/**
 * LOAD fixer (F1, #157i): the strict playthrough from the current (B11) start through a qa proxy. An in-page hook on
 * the RoomReflections instance reads the yard cube (mip 0 + GPU mip count) right after every change the STORY makes
 * (runtime re-capture or shipped swap: `stats.recaptures` steps), so the cube is exactly what the game samples from
 * then on. The C6 + 20 s hero still's hood luminance (x 340–1020, y 490–545 of 1280 px: the review's region) rides along.
 */
async function playToDawn(qa) {
  await qa.eval(`(() => {
    const g = window.__game; const R = g.reflections; const ext = R.exteriorId; window.__reflSnaps = {};
    let seen = R.stats.recaptures; const upd = R.update.bind(R);
    R.update = (...a) => { upd(...a); const n = R.stats.recaptures; if (n !== seen) { seen = n; const at = { cs: g.director?.cutscene ?? null, t: g.cutscenes?.player?.time ?? null }; window.__reflSnaps[n] = g.exportReflections([ext]).then((r) => ({ ...r, at })); } };
    return true;
  })()`);
  let lum = null;
  const proxy = {
    ...qa,
    shot: async (label, ...rest) => {
      const path = await qa.shot(label, ...rest);
      if (label === 'c6-dawn-drive' && path && lum === null) {
        const b64 = readFileSync(path).toString('base64');
        lum = await qa.eval(`(async () => {
          const bmp = await createImageBitmap(await (await fetch('data:image/jpeg;base64,${b64}')).blob());
          const sx = bmp.width / 1280; const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
          const d = g.getImageData(Math.round(340 * sx), Math.round(490 * sx), Math.round(680 * sx), Math.round(55 * sx)).data; let s = 0;
          for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          return +(s / (d.length / 4)).toFixed(1);
        })()`);
        qa.log(`c6-dawn-drive hood luminance ${lum} (${path})`);
      }
      return path;
    },
  };
  const play = await import(pathToFileURL(join(ROOT, 'scripts', 'qa', 'playthrough.mjs')).href);
  await play.default(proxy);
  const keys = await qa.eval('Object.keys(window.__reflSnaps || {})');
  const snaps = {};
  for (const k of keys) snaps[k] = await qa.eval(`window.__reflSnaps[${JSON.stringify(k)}]`);
  for (const [k, v] of Object.entries(snaps)) qa.log(`yard cube change #${k} at ${v.at?.cs ?? '-'} ${typeof v.at?.t === 'number' ? v.at.t.toFixed(2) + ' s' : ''} (mips ${v.cubes?.[0]?.mips})`);
  return { snaps, lum };
}

export default async function (qa) {
  const tier = await qa.eval('window.__game.ctx.presetId');
  const search = await qa.eval('location.search');
  const q = new URLSearchParams(search);
  const mode = q.get('reflexport') ?? (q.get('beat') === 'B11' ? 'dawn' : 'night');
  mkdirSync(SCRATCH, { recursive: true });
  const src = await qa.eval('window.__game.reflections?.stats?.source ?? null');
  qa.report.reflExport = { tier, mode, source: src };
  if (mode === 'night' || mode === 'verify-capture' || mode === 'verify-shipped') {
    const r = await qa.eval('window.__game.exportReflections()');
    qa.assert(r && r.cubes?.length >= 13, `export returned ${r?.cubes?.length} cubes (${tier})`);
    if (!r?.cubes?.length) return;
    const file = join(SCRATCH, `${tier}-${mode}.json`);
    writeFileSync(file, JSON.stringify({ key: r.key, size: r.size, source: r.source, cubes: r.cubes }));
    qa.log(`${tier} ${mode}: ${r.cubes.length} cubes (source ${r.source}, key ${r.key}) → ${file}`);
    Object.assign(qa.report.reflExport, { key: r.key, cubes: r.cubes.length, file });
    return;
  }
  // dawn / verify-dawn-*: the strict playthrough from B11 (DAWN_BEAT); the yard cube is read right after each of the story's own
  // changes (in-page hook on RoomReflections.update), and the C6 + 20 s hero still's hood luminance is measured
  const { snaps, lum } = await playToDawn(qa);
  const dawn = snaps[1];
  const night2 = snaps[2];
  qa.assert(!!dawn && !!night2, `${tier} ${mode}: the story changed the yard cube to dawn and back to night (snaps ${Object.keys(snaps).join(',')})`);
  if (!dawn || !night2) return;
  if (mode === 'verify-dawn-shipped' || mode === 'verify-dawn-capture') {
    const file = join(SCRATCH, `${tier}-${mode}.json`);
    writeFileSync(file, JSON.stringify({ key: dawn.key, source: src, dawn: dawn.cubes[0], night2: night2.cubes[0], lum, at: { dawn: dawn.at, night2: night2.at } }));
    qa.log(`${tier} ${mode}: EXT dawn mips ${dawn.cubes[0]?.mips} · night-again mips ${night2.cubes[0]?.mips} · C6 + 20 s hood luminance ${lum} (source ${src}) → ${file}`);
    Object.assign(qa.report.reflExport, { file, lum, dawnMips: dawn.cubes[0]?.mips, night2Mips: night2.cubes[0]?.mips });
    return;
  }
  qa.assert(src === 'capture', `the dawn export runs the runtime capture (source ${src})`);
  if (src !== 'capture') return;
  const ext = await qa.eval('window.__game.reflections?.exteriorId');
  const nightFile = join(SCRATCH, `${tier}-night.json`);
  qa.assert(existsSync(nightFile), `${nightFile} exists (run the default export first)`);
  if (!existsSync(nightFile)) return;
  const night = JSON.parse(readFileSync(nightFile, 'utf8'));
  qa.assert(night.key === dawn.key && night.key === night2.key, `same key in both runs (${night.key} / ${dawn.key} / ${night2.key})`);
  if (night.key !== dawn.key) return;
  const cubes = [...decodeCubes(night, 'night'), ...decodeCubes(dawn, 'dawn'), ...decodeCubes(night2, 'night2')];
  const raw = encodeReflFile({ key: night.key, size: night.size, cubes });
  const gz = gzipSync(raw, { level: 9 });
  const out = join(ROOT, 'public', 'assets', tier, 'reflections.bin');
  writeFileSync(out, gz);
  const d = halfDiff(decodeCubes(dawn, 'dawn')[0].rgb, decodeCubes(night, 'night').find((c) => c.id === ext).rgb);
  qa.log(`wrote ${out}: ${cubes.length} cubes, ${raw.length} B raw → ${gz.length} B gzip, key ${night.key} (dawn vs night EXT: mean |Δ| ${d.mean.toExponential(2)})`);
  Object.assign(qa.report.reflExport, { key: night.key, cubes: cubes.length, rawBytes: raw.length, bytes: gz.length, file: out });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const di = args.indexOf('--dist');
  const dist = di >= 0 ? args[di + 1] : 'scratch/dist-refl';
  const verify = args.includes('--verify');
  const noBuild = args.includes('--no-build');
  const dawnOnly = args.includes('--dawn-only');
  const tiers = args.filter((a, i) => !a.startsWith('--') && (di < 0 || i !== di + 1));
  let first = !noBuild;
  let failed = 0;
  const run = (tier, query, name, beat, allowFail = false) => {
    const cmd = ['scripts/shot.mjs', '--scenario', 'scripts/qa/refl-export.mjs', '--preset', tier, '--query', query,
      '--wait', '1', '--shots', '0', '--dist', dist, '--out', 'scratch/refl', '--name', name, '--timeout', '2400'];
    if (beat) cmd.push('--beat', beat);
    if (!first) cmd.push('--no-build');
    first = false;
    console.log(`[refl] ${tier}: node ${cmd.join(' ')}`);
    const r = spawnSync(process.execPath, cmd, { cwd: ROOT, stdio: 'inherit' });
    // (allowFail: the strict playthrough from a --beat start fails its whole-game asserts — B01…B13, C1 … — by design)
    if (allowFail) return r.status === 0 || r.status === 1;
    if (r.status !== 0) {
      failed++;
      console.error(`[refl] ${tier} (${name}): shot.mjs exited ${r.status}`);
    }
    return r.status === 0;
  };
  for (const tier of tiers.length ? tiers : ['medium', 'max']) {
    if (verify) {
      // shipped (uploaded) vs a fresh runtime capture, and that capture vs the export's own capture (the baseline:
      // the runtime capture itself varies a little from load to load — candle flicker phase at capture time)
      const rd = (m) => JSON.parse(readFileSync(join(SCRATCH, `${tier}-${m}.json`), 'utf8'));
      if (!dawnOnly) {
      if (!run(tier, 'reflexport=verify-shipped', `refl-${tier}-vship`)) continue;
      if (!run(tier, 'refl=capture&reflexport=verify-capture', `refl-${tier}-vcap`)) continue;
      const ship = rd('verify-shipped');
      const cap = rd('verify-capture');
      const exp = existsSync(join(SCRATCH, `${tier}-night.json`)) ? rd('night') : null;
      if (ship.source !== 'shipped') console.error(`[refl] ${tier}: the verify load did not use the shipped cubes (source ${ship.source})`), failed++;
      let worst = { max: 0, mean: 0, relMean: 0 };
      let base = { max: 0, mean: 0, relMean: 0 };
      for (const c of ship.cubes) {
        const k = cap.cubes.find((x) => x.id === c.id);
        if (!k) continue;
        const d = halfDiff(Buffer.from(c.b64, 'base64'), Buffer.from(k.b64, 'base64'));
        console.log(`[refl] ${tier} ${c.id.padEnd(6)} shipped vs capture: max |Δ| ${d.max.toFixed(5)} · mean ${d.mean.toExponential(2)} · rel ${(d.relMean * 100).toFixed(3)} %`);
        if (d.relMean > worst.relMean) worst = d;
        const e = exp?.cubes.find((x) => x.id === c.id);
        if (e) {
          const b = halfDiff(Buffer.from(e.b64, 'base64'), Buffer.from(k.b64, 'base64'));
          if (b.relMean > base.relMean) base = b;
        }
      }
      console.log(`[refl] ${tier}: worst shipped-vs-capture rel mean ${(worst.relMean * 100).toFixed(3)} % (capture-vs-capture baseline ${(base.relMean * 100).toFixed(3)} %)`);
      } // (--dawn-only: the dawn / night-again pair below only)
      // LOAD fixer (F1, #157i): the EXT dawn / night-again cubes as the STORY's own changes leave them (strict
      // playthrough from B11), shipped vs `?refl=capture`: the same GPU mip count (the runtime dawn cube has 1), mip 0
      // within 15 % rel mean (load-to-load spread of the yard: rain / lightning / mist phase ≈ 6–9 %), and the C6 + 20 s
      // dawn-drive still's hood luminance within 8 % (the review found 57 vs 87 with the first export)
      for (const m of ['verify-dawn-shipped', 'verify-dawn-capture']) rmSync(join(SCRATCH, `${tier}-${m}.json`), { force: true });
      run(tier, 'reflexport=verify-dawn-shipped', `refl-${tier}-vdship`, DAWN_BEAT, true);
      run(tier, 'refl=capture&reflexport=verify-dawn-capture', `refl-${tier}-vdcap`, DAWN_BEAT, true);
      const has = (m) => existsSync(join(SCRATCH, `${tier}-${m}.json`));
      if (!has('verify-dawn-shipped') || !has('verify-dawn-capture')) {
        console.error(`[refl] ${tier}: a dawn verify run produced no result`);
        failed++;
        continue;
      }
      const ds = rd('verify-dawn-shipped');
      const dc = rd('verify-dawn-capture');
      if (ds.source !== 'shipped') console.error(`[refl] ${tier}: the dawn verify load did not use the shipped cubes (source ${ds.source})`), failed++;
      for (const st of ['dawn', 'night2']) {
        const d = halfDiff(Buffer.from(ds[st].b64, 'base64'), Buffer.from(dc[st].b64, 'base64'));
        const mipsOk = ds[st].mips === dc[st].mips;
        console.log(`[refl] ${tier} EXT ${st.padEnd(6)} shipped vs capture: mips ${ds[st].mips} / ${dc[st].mips}${mipsOk ? '' : ' MISMATCH'} · max |Δ| ${d.max.toFixed(5)} · rel ${(d.relMean * 100).toFixed(3)} % (at ${JSON.stringify(ds.at?.[st])} / ${JSON.stringify(dc.at?.[st])})`);
        if (!mipsOk || d.relMean > 0.15) failed++;
      }
      const rel = ds.lum !== null && dc.lum !== null && dc.lum > 0 ? Math.abs(ds.lum - dc.lum) / dc.lum : 1;
      console.log(`[refl] ${tier} C6 + 20 s hood luminance: shipped ${ds.lum} · capture ${dc.lum} (|Δ| ${(rel * 100).toFixed(1)} %; fails over 8 %)`);
      if (rel > 0.08) failed++;
      continue;
    }
    if (!dawnOnly && !run(tier, 'refl=capture&reflexport=night', `refl-${tier}-night`)) continue;
    const out = join(ROOT, 'public', 'assets', tier, 'reflections.bin');
    const before = existsSync(out) ? readFileSync(out) : null;
    // (the strict playthrough from B11 fails its whole-game asserts by design: judge the run by the file it writes)
    run(tier, 'refl=capture&reflexport=dawn', `refl-${tier}-dawn`, DAWN_BEAT, true);
    const after = existsSync(out) ? readFileSync(out) : null;
    if (!after || (before && after.equals(before) && !process.env.REFL_SAME_OK)) console.error(`[refl] ${tier}: ${out} was not (re)written — see scratch/refl/refl-${tier}-dawn-report.json`), failed++;
  }
  process.exit(failed ? 1 : 0);
}
