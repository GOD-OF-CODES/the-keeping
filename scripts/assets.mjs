#!/usr/bin/env node
// THE KEEPING — serial Blender asset pipeline (lane A). Plain Node, no dependencies.
//
//   npm run assets                      run every non-manual job whose inputs changed, then write manifests
//   npm run assets -- --only smoke      only jobs whose id or group matches (comma-separated); a manual job runs
//                                       only when its id or its group is named (--only bake-release, house-review)
//   npm run assets -- --force           ignore the input-hash cache
//   npm run assets -- --check           verify manifests + GLB/lightmap invariants (no Blender)
//   npm run assets -- --list            list jobs and their cache state
//   npm run assets -- --manifest        only (re)write public/assets/<tier>/manifest.json
//   npm run assets -- --dry-run         show what would run
//   npm run assets -- --touch --only X  mark jobs fresh without running them, ONLY if they were fresh at git HEAD
//                                       (use after an uncommitted edit that cannot change their outputs)
// A non-manual job whose outputs a MANUAL job wrote later (dev bake vs release bake) is never re-run implicitly:
// it is skipped with a SKIP line (--list: 'stale/kept') unless named by exact id (--only bake-house-ground).
//
// Rules enforced here (CLAUDE.md): at most ONE Blender process at a time — a lock dir .cache/blender.lock
// (pid + stale detection) plus a wait while any foreign Blender.app process is running.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIPELINE = path.join(ROOT, 'blender/pipeline.json');
const CACHE = path.join(ROOT, '.cache');
const LOCK = path.join(CACHE, 'blender.lock');
const CHROME_LOCK = path.join(CACHE, 'chrome.lock'); // held by scripts/shot.mjs (headless-Chrome QA)
const LOGS = path.join(CACHE, 'logs');
const STATE = path.join(CACHE, 'assets-state.json');
const PUBLIC = path.join(ROOT, 'public');
const TIERS = ['low', 'medium', 'max'];

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => {
  const i = argv.indexOf(`--${n}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${n}=`));
  return eq ? eq.slice(n.length + 3) : undefined;
};

const log = (...a) => console.log('[assets]', ...a);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const readJSON = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJSON = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
};
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ---------- tiny glob: supports "*", "?" within a segment and "**" across segments ----------
function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
function walk(dir, out = []) {
  let ents = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    if (e.name === '__pycache__' || e.name === '.DS_Store') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
function expand(patterns) {
  const files = new Set();
  for (const pat of patterns) {
    if (!/[*?]/.test(pat)) {
      const p = path.join(ROOT, pat);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) files.add(rel(p));
      else if (fs.existsSync(p)) walk(p).forEach((f) => files.add(rel(f)));
      continue;
    }
    const base = pat.split('/').filter((s, i, a) => !/[*?]/.test(a.slice(0, i + 1).join('/'))).join('/');
    const re = globToRegex(pat);
    walk(path.join(ROOT, base)).forEach((f) => re.test(rel(f)) && files.add(rel(f)));
  }
  return [...files].sort();
}

// ---------- pipeline + cache ----------
const pipeline = readJSON(PIPELINE, null);
if (!pipeline) {
  console.error(`cannot read ${rel(PIPELINE)}`);
  process.exit(2);
}
const state = readJSON(STATE, { jobs: {} });

const readDisk = (f) => fs.readFileSync(path.join(ROOT, f));

/** `read(f)` supplies file contents (default: the working tree); `--touch` hashes "as of git HEAD" through it. */
function jobHash(job, read = readDisk, libDefault = pipeline.libInputs) {
  const h = createHash('sha256');
  h.update(JSON.stringify({ script: job.script, args: job.args ?? [], env: job.env ?? {}, post: job.post ?? [] }));
  const files = expand([job.script, ...(job.libInputs ?? libDefault ?? []), ...(job.inputs ?? [])]);
  for (const f of files) {
    h.update(f);
    h.update(sha256(read(f)));
  }
  return { hash: h.digest('hex').slice(0, 16), files };
}

// ---------- --touch: mark jobs fresh WITHOUT running them (like `make -t`), but only provably safe ones ----------
// A job is touched only if (a) its last run was ok and its outputs exist, and (b) the hash computed from git HEAD
// (HEAD's job definition + HEAD's content for every tracked file; untracked inputs such as .cache/*.blend from disk)
// equals its stored hash, or the hash of its last REAL run if it was touched before. (b) proves the job was fresh
// at HEAD, so the ONLY differences are the uncommitted working-tree edits — which the caller asserts do not change
// this job's outputs (e.g. an encode-policy edit that the `encode` job re-applies from the cached float atlases).
// Jobs that were already stale at HEAD are refused.
function touch() {
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, maxBuffer: 1 << 30 });
  const tracked = new Set(git('ls-tree', '-r', '--name-only', 'HEAD').toString().split('\n').filter(Boolean));
  let headPipeline;
  try {
    headPipeline = JSON.parse(git('show', 'HEAD:blender/pipeline.json').toString());
  } catch {
    headPipeline = pipeline;
  }
  const headCache = new Map();
  const readHead = (f) => {
    if (!tracked.has(f)) return readDisk(f);
    if (!headCache.has(f)) headCache.set(f, git('show', `HEAD:${f}`));
    return headCache.get(f);
  };
  const fresh = readJSON(STATE, { jobs: {} });
  let touched = 0;
  for (const job of pipeline.jobs.filter(selected)) {
    const prev = fresh.jobs[job.id];
    const headJob = headPipeline.jobs.find((j) => j.id === job.id);
    if (!prev?.ok || !outputsExist(job) || !headJob) {
      log(`touch: refuse ${job.id} (${!headJob ? 'not in HEAD pipeline' : 'never ran ok / outputs missing'})`);
      continue;
    }
    let atHead;
    try {
      atHead = jobHash(headJob, readHead, headPipeline.libInputs).hash;
    } catch (e) {
      log(`touch: refuse ${job.id} (cannot hash at HEAD: ${e.message})`);
      continue;
    }
    // touchedFrom = the hash of the job's last REAL run, kept across repeated touches (so a second uncommitted edit
    // can be touched again as long as HEAD still matches that real run)
    const runHash = prev.touchedFrom ?? prev.hash;
    if (atHead !== runHash && atHead !== prev.hash) {
      log(`touch: refuse ${job.id} (already stale at HEAD — its inputs changed since its last run; run it instead)`);
      continue;
    }
    const now = jobHash(job).hash;
    fresh.jobs[job.id] = { ...prev, hash: now, touchedAt: new Date().toISOString(), touchedFrom: runHash };
    touched++;
    log(`touch: ${job.id} ${prev.hash} -> ${now}`);
  }
  writeJSON(STATE, fresh);
  log(`touch: ${touched} job(s) marked fresh`);
}

function outputsExist(job) {
  return (job.outputs ?? []).every((o) => fs.existsSync(path.join(ROOT, o.path)));
}

// ---------- output ownership guard ----------
// Dev and release variants of a job share outputs (bake-house-X and bake-release-X both write .cache/bake/lm_X.npz
// and public/assets/*/lm_X.klm). A job that is merely stale must never silently overwrite outputs a MANUAL job
// (release bake, hours of GPU time) wrote after it: such a job runs only when named by its exact id in --only
// (not by group, not via --force). Returns the manual job that owns the outputs, or null.
function supersededBy(job) {
  if (job.manual || opt('only')?.split(',').map((s) => s.trim()).includes(job.id)) return null;
  const mine = new Set((job.outputs ?? []).map((o) => o.path));
  const myTime = Date.parse(state.jobs[job.id]?.finishedAt ?? '') || 0;
  let owner = null;
  for (const m of pipeline.jobs) {
    const s = state.jobs[m.id];
    if (!m.manual || m === job || !s?.ok || !(m.outputs ?? []).some((o) => mine.has(o.path))) continue;
    const t = Date.parse(s.finishedAt ?? '') || 0;
    if (t > myTime && (!owner || t > Date.parse(state.jobs[owner.id].finishedAt))) owner = m;
  }
  return owner;
}

/** Loud warning when a manual job's shipped outputs no longer match its inputs (e.g. `house` re-ran after the
 *  release bakes: the GLBs' UV2 may no longer match the release lightmaps). Never runs anything. */
function warnStaleManual() {
  const stale = pipeline.jobs.filter((m) => {
    const s = state.jobs[m.id];
    if (!m.manual || !s?.ok || !outputsExist(m) || !pipeline.jobs.some((j) => j !== m && supersededBy(j)?.id === m.id))
      return false;
    try {
      return jobHash(m).hash !== s.hash;
    } catch {
      return true;
    }
  });
  if (stale.length)
    log(`WARNING: shipped outputs of ${stale.map((m) => m.id).join(', ')} are stale vs their inputs (house/props changed`
      + ` since?) — re-run them (--only ${[...new Set(stale.map((m) => m.group))].join(',')}) or the lightmaps may not match the GLBs`);
  return stale;
}

function selected(job) {
  const only = opt('only');
  if (only) {
    const keys = only.split(',').map((s) => s.trim());
    // manual jobs run only when named exactly: by id, or by their group (`--only bake-release`)
    if (keys.includes(job.id) || (job.manual && keys.includes(job.group))) return true;
    return !job.manual && keys.some((k) => k === job.group || job.id.startsWith(k + '-'));
  }
  return !job.manual;
}

// ---------- Blender lock ----------
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}
function foreignBlender() {
  try {
    const out = execFileSync('pgrep', ['-f', 'Blender.app/Contents/MacOS/Blender'], { encoding: 'utf8' });
    return out.split('\n').filter(Boolean).map(Number);
  } catch {
    return [];
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function acquireLock(timeoutMs = 60 * 60 * 1000) {
  fs.mkdirSync(CACHE, { recursive: true });
  const t0 = Date.now();
  let told = false;
  for (;;) {
    try {
      fs.mkdirSync(LOCK);
      writeJSON(path.join(LOCK, 'owner.json'), { pid: process.pid, startedAt: new Date().toISOString(), argv });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const owner = readJSON(path.join(LOCK, 'owner.json'), null);
      const age = Date.now() - fs.statSync(LOCK).mtimeMs;
      if ((owner && !pidAlive(owner.pid)) || (!owner && age > 30_000)) {
        log(`removing stale lock (pid ${owner?.pid ?? '?'} not running)`);
        fs.rmSync(LOCK, { recursive: true, force: true });
        continue;
      }
      if (!told) log(`waiting for Blender lock held by pid ${owner?.pid} …`), (told = true);
      if (Date.now() - t0 > timeoutMs) throw new Error('timed out waiting for the Blender lock');
      await sleep(3000);
    }
  }
  // The lock only covers cooperating runners; also wait out any other Blender (one-off experiments).
  told = false;
  for (;;) {
    const others = foreignBlender();
    if (!others.length) break;
    if (!told) log(`waiting: another Blender is running (pid ${others.join(', ')}) …`), (told = true);
    if (Date.now() - t0 > timeoutMs) throw new Error('timed out waiting for a foreign Blender to exit');
    await sleep(3000);
  }
  // 8 GB machine: never run Blender while a headless-Chrome QA session (scripts/shot.mjs) is up. We hold the
  // Blender lock while waiting; shot.mjs backs off whenever this lock exists, so the two can't deadlock.
  told = false;
  for (;;) {
    const owner = Number(readText(path.join(CHROME_LOCK, 'pid')));
    if (!owner || !pidAlive(owner)) return;
    if (!told) log(`waiting: a headless-Chrome QA session (pid ${owner}) is running …`), (told = true);
    if (Date.now() - t0 > timeoutMs) throw new Error('timed out waiting for the headless-Chrome QA session');
    await sleep(3000);
  }
}
function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}
function releaseLock() {
  const owner = readJSON(path.join(LOCK, 'owner.json'), null);
  if (owner?.pid === process.pid) fs.rmSync(LOCK, { recursive: true, force: true });
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    releaseLock();
    process.exit(130);
  });
}

// ---------- run one job ----------
function runProcess(cmd, args, logFile, env) {
  return new Promise((resolve) => {
    const out = fs.openSync(logFile, 'a');
    fs.writeSync(out, `$ ${cmd} ${args.join(' ')}\n`);
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    const onData = (d) => {
      text += d;
      fs.writeSync(out, d);
      if (flag('verbose')) process.stdout.write(d);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => {
      fs.closeSync(out);
      resolve({ code, text });
    });
  });
}

async function runJob(job, hash) {
  fs.mkdirSync(LOGS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(LOGS, `${job.id}-${stamp}.log`);
  const blender = pipeline.blender;
  const bargs = ['--background', '--factory-startup', '--python-exit-code', '1'];
  if (job.cyclesLog) bargs.push('--log', 'cycles', '--log-level', 'info');
  bargs.push('--python', path.join(ROOT, 'blender/lib/cli.py'), '--', job.script, ...(job.args ?? []));
  const t0 = Date.now();
  await acquireLock();
  let res;
  try {
    res = await runProcess('/usr/bin/time', ['-l', blender, ...bargs], logFile, job.env);
  } finally {
    releaseLock();
  }
  const wall = (Date.now() - t0) / 1000;
  const rss = /(\d+)\s+maximum resident set size/.exec(res.text);
  const results = [...res.text.matchAll(/^RESULT (.*)$/gm)].map((m) => {
    try {
      return JSON.parse(m[1]);
    } catch {
      return { unparsable: m[1] };
    }
  });
  const device = [...new Set([...res.text.matchAll(/Path tracing on: ([^\n]*)/g)].map((m) => m[1].trim()))];
  let ok = res.code === 0;
  const post = [];
  if (ok) {
    for (const cmd of job.post ?? []) {
      const [bin, ...a] = cmd;
      const p = await runProcess(bin === 'node' ? process.execPath : bin, a, logFile, job.env);
      post.push({ cmd: cmd.join(' '), code: p.code });
      if (p.code !== 0) ok = false;
    }
  }
  const record = {
    hash,
    ok,
    exitCode: res.code,
    finishedAt: new Date().toISOString(),
    wallSeconds: Math.round(wall * 10) / 10,
    peakRssMB: rss ? Math.round(Number(rss[1]) / 1048576) : null,
    cyclesDevices: device,
    results,
    post,
    log: rel(logFile),
  };
  // Merge into the CURRENT state file: another runner may have finished a job while we waited for the lock.
  const fresh = readJSON(STATE, { jobs: {} });
  fresh.jobs[job.id] = record;
  writeJSON(STATE, fresh);
  state.jobs = fresh.jobs;
  pruneLogs(job.id);
  log(`${ok ? 'ok  ' : 'FAIL'} ${job.id}  ${record.wallSeconds}s  peak ${record.peakRssMB} MB  log ${record.log}`);
  if (!ok) {
    const tail = res.text.split('\n').slice(-25).join('\n');
    console.error(tail);
  }
  return ok;
}

function pruneLogs(id, keep = 5) {
  const mine = fs.readdirSync(LOGS).filter((f) => f.startsWith(id + '-2')).sort();
  for (const f of mine.slice(0, Math.max(0, mine.length - keep))) fs.rmSync(path.join(LOGS, f));
}

// ---------- manifests ----------
function inferKind(file) {
  const b = path.basename(file);
  if (/^lm_.*\.(klm|exr|gz|json)$/.test(b)) return 'lightmap';
  if (/^collision.*\.glb$/.test(b)) return 'collision';
  if (/^(ada|harlan|arms|char_)/.test(b)) return 'character';
  if (/^(house|level|ext|room)_?.*\.glb$/.test(b)) return 'level';
  if (/\.glb$/.test(b)) return 'prop';
  if (/probes/.test(b)) return 'probes';
  if (/\.(webp|png|ktx2)$/.test(b)) return 'texture';
  if (/\.mp3$/.test(b)) return 'voice';
  if (/\.json$/.test(b) && file.includes('/voice/')) return 'voice-timing';
  return 'data';
}
function writeManifests() {
  const declared = new Map();
  for (const j of pipeline.jobs) for (const o of j.outputs ?? []) if (o.kind) declared.set(o.path, o);
  const totals = {};
  for (const tier of TIERS) {
    const dirs = [path.join(PUBLIC, 'assets', tier), ...(pipeline.sharedAssetDirs ?? []).map((d) => path.join(ROOT, d))];
    const files = [];
    for (const d of dirs) {
      for (const f of walk(d)) {
        if (path.basename(f) === 'manifest.json') continue;
        const r = rel(f);
        const pubRel = path.relative(PUBLIC, f).split(path.sep).join('/');
        const buf = fs.readFileSync(f);
        const decl = declared.get(r.replace(`/${tier}/`, '/{tier}/')) ?? declared.get(r);
        files.push({
          id: decl?.id ?? path.basename(f).replace(/\.(glb|klm|exr|json|webp|mp3|gz)$/, '').replace(/\.f16$/, '') + (f.endsWith('.json') && /^lm_/.test(path.basename(f)) ? '.meta' : ''),
          kind: decl?.kind ?? inferKind(r),
          path: pubRel,
          bytes: buf.length,
          hash: sha256(buf).slice(0, 16),
        });
      }
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    const manifest = {
      tier,
      generatedAt: new Date().toISOString(),
      totalBytes: files.reduce((s, f) => s + f.bytes, 0),
      files,
    };
    writeJSON(path.join(PUBLIC, 'assets', tier, 'manifest.json'), manifest);
    totals[tier] = `${files.length} files, ${(manifest.totalBytes / 1048576).toFixed(2)} MB`;
  }
  log('manifests:', JSON.stringify(totals));
}

// ---------- --check ----------
function readGlbJson(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error('bad GLB magic');
  const len = buf.readUInt32LE(12);
  if (buf.toString('ascii', 16, 20) !== 'JSON') throw new Error('first chunk not JSON');
  return JSON.parse(buf.toString('utf8', 20, 20 + len));
}
function check() {
  let bad = 0;
  const fail = (m) => (bad++, console.error('  ✗', m));
  const expectations = new Map();
  for (const j of pipeline.jobs) for (const o of j.outputs ?? []) if (o.expect) expectations.set(path.basename(o.path), o.expect);
  for (const tier of TIERS) {
    const mf = path.join(PUBLIC, 'assets', tier, 'manifest.json');
    const m = readJSON(mf, null);
    if (!m) {
      fail(`${rel(mf)} missing (run npm run assets)`);
      continue;
    }
    if (m.tier !== tier) fail(`${rel(mf)}: tier ${m.tier}`);
    let sum = 0;
    for (const f of m.files) {
      const p = path.join(PUBLIC, f.path);
      if (!fs.existsSync(p)) {
        fail(`${tier}: ${f.path} listed but missing`);
        continue;
      }
      const buf = fs.readFileSync(p);
      sum += buf.length;
      if (buf.length !== f.bytes || sha256(buf).slice(0, 16) !== f.hash) fail(`${tier}: ${f.path} changed since manifest`);
      if (f.path.endsWith('.glb')) {
        try {
          const g = readGlbJson(p);
          const exp = expectations.get(path.basename(p)) ?? {};
          if (f.kind === 'level' || exp.lightmapped) {
            for (const mesh of g.meshes ?? [])
              for (const pr of mesh.primitives)
                if (!('TEXCOORD_1' in pr.attributes)) fail(`${f.path}: mesh ${mesh.name} lacks TEXCOORD_1`);
          }
          const anims = (g.animations ?? []).map((a) => a.name).sort();
          if (exp.animations) {
            const want = [...exp.animations].sort();
            if (JSON.stringify(anims) !== JSON.stringify(want)) fail(`${f.path}: animations ${anims} != ${want}`);
          } else if (f.kind !== 'character' && anims.length && !exp.allowAnimations) {
            fail(`${f.path}: unexpected (stray?) animations ${anims}`);
          }
        } catch (e) {
          fail(`${f.path}: ${e.message}`);
        }
      }
      if (f.kind === 'lightmap' && f.path.endsWith('.json')) {
        const s = readJSON(p, {});
        if (s.rowOrder !== 'bottom-up') fail(`${f.path}: rowOrder ${s.rowOrder}`);
        const data = path.join(path.dirname(p), s.file ?? '');
        if (!s.file || !fs.existsSync(data)) fail(`${f.path}: data file ${s.file} missing`);
        else if (s.container === 'klm') {
          try {
            const raw = gunzipSync(fs.readFileSync(data));
            const w = raw.readUInt16LE(4), h = raw.readUInt16LE(6);
            if (raw.toString('ascii', 0, 4) !== 'KLM1' || w !== s.width || h !== s.height || raw[8] !== s.channels
              || raw[10] !== 0 || raw.length !== 16 + w * h * raw[8] * 2)
              fail(`${s.file}: KLM header/size does not match its sidecar`);
          } catch (e) {
            fail(`${s.file}: not a readable KLM (${e.message})`);
          }
        }
      }
    }
    if (sum !== m.totalBytes) fail(`${tier}: totalBytes ${m.totalBytes} != ${sum}`);
    const budget = pipeline.budgetsMB?.[tier];
    const mb = m.totalBytes / 1048576;
    log(`${tier}: ${m.files.length} files, ${mb.toFixed(2)} MB${budget ? ` (budget ${budget} MB)` : ''}`);
    if (budget && mb > budget) fail(`${tier}: ${mb.toFixed(1)} MB over budget ${budget} MB`);
  }
  for (const j of pipeline.jobs) {
    const s = state.jobs[j.id];
    if (s && !s.ok) fail(`job ${j.id} last run failed (${s.log})`);
  }
  for (const m of warnStaleManual()) fail(`manual job ${m.id}: shipped outputs are stale vs its inputs`);
  if (foreignBlender().length && !fs.existsSync(LOCK)) fail('a Blender process is running outside the runner');
  log(bad ? `check: ${bad} problem(s)` : 'check: ok');
  return bad === 0;
}

// ---------- main ----------
async function main() {
  if (flag('check')) process.exit(check() ? 0 : 1);
  if (flag('manifest')) return writeManifests();
  if (flag('touch')) {
    if (!opt('only')) throw new Error('--touch needs --only <ids|groups>');
    return touch();
  }
  const jobs = pipeline.jobs.filter(selected);
  if (flag('list')) {
    for (const j of pipeline.jobs) {
      const { hash } = jobHash(j);
      const s = state.jobs[j.id];
      const st = j.placeholder && !fs.existsSync(path.join(ROOT, j.script)) ? 'placeholder'
        : s?.hash === hash && s.ok && outputsExist(j) ? 'cached' : supersededBy(j) ? 'stale/kept' : 'stale';
      console.log(`${j.id.padEnd(22)} ${String(j.group).padEnd(10)} ${st.padEnd(12)} ${j.manual ? 'manual ' : ''}${j.description ?? ''}`);
    }
    return;
  }
  let failed = 0;
  let skippedGuard = 0;
  for (const job of jobs) {
    if (!fs.existsSync(path.join(ROOT, job.script))) {
      log(`skip ${job.id}: ${job.placeholder ? 'placeholder (not implemented yet)' : 'script missing'} — ${job.script}`);
      continue;
    }
    const { hash } = jobHash(job);
    const prev = state.jobs[job.id];
    if (!flag('force') && prev?.ok && prev.hash === hash && outputsExist(job)) {
      log(`cached ${job.id} (${hash})`);
      continue;
    }
    const owner = supersededBy(job);
    if (owner) {
      log(`SKIP ${job.id}: its outputs were last written by manual job ${owner.id} (${state.jobs[owner.id].finishedAt}),`
        + ` which a run of ${job.id} would overwrite. Keep them: do nothing. Replace them with this job's output:`
        + ` --only ${job.id}. Re-run the manual job: --only ${owner.id} (or its group ${owner.group}).`);
      skippedGuard++;
      continue;
    }
    if (flag('dry-run')) {
      log(`would run ${job.id} (${hash})`);
      continue;
    }
    log(`run ${job.id} …`);
    if (!(await runJob(job, hash))) {
      failed++;
      if (!flag('keep-going')) break;
    }
  }
  if (skippedGuard) log(`note: ${skippedGuard} job(s) skipped to protect newer manual-job outputs (see SKIP lines)`);
  warnStaleManual();
  if (!flag('dry-run')) writeManifests();
  const still = foreignBlender();
  if (still.length) log(`note: Blender still running (pid ${still.join(', ')})`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  releaseLock();
  console.error(e);
  process.exit(1);
});
