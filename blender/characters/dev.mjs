#!/usr/bin/env node
// Dev runner for character/anim experiments that honours the ONE-Blender rule exactly like scripts/assets.mjs:
// it takes the same lock dir (.cache/blender.lock, owner.json {pid}), then also waits until no other
// Blender.app process runs (other builders may launch Blender directly), then runs
//   Blender --background --factory-startup --python-exit-code 1 --python blender/lib/cli.py -- <script> [args]
// and releases the lock. Output streams to the terminal and to .cache/logs/chardev-<stamp>.log.
//
//   node blender/characters/dev.mjs blender/characters/build_characters.py --only ada --no-bake
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = path.join(ROOT, '.cache');
const LOCK = path.join(CACHE, 'blender.lock');
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';
const args = process.argv.slice(2);
if (!args.length) {
  console.error('usage: node blender/characters/dev.mjs <script.py> [args]');
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};
const foreign = () => {
  try {
    return execFileSync('pgrep', ['-f', 'Blender.app/Contents/MacOS/Blender'], { encoding: 'utf8' })
      .split('\n').filter(Boolean).map(Number).filter((p) => p !== process.pid);
  } catch {
    return [];
  }
};

async function acquire() {
  fs.mkdirSync(CACHE, { recursive: true });
  let told = false;
  for (;;) {
    try {
      fs.mkdirSync(LOCK);
      fs.writeFileSync(path.join(LOCK, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), argv: args }) + '\n');
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let owner = null;
      try {
        owner = JSON.parse(fs.readFileSync(path.join(LOCK, 'owner.json'), 'utf8'));
      } catch {}
      const age = Date.now() - fs.statSync(LOCK).mtimeMs;
      if ((owner && !alive(owner.pid)) || (!owner && age > 30_000)) {
        fs.rmSync(LOCK, { recursive: true, force: true });
        continue;
      }
      if (!told) console.log(`[dev] waiting for lock (pid ${owner?.pid})`), (told = true);
      await sleep(3000);
    }
  }
  told = false;
  for (;;) {
    const o = foreign();
    if (!o.length) return;
    if (!told) console.log(`[dev] waiting: other Blender running (${o.join(',')})`), (told = true);
    await sleep(3000);
  }
}
function release() {
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(LOCK, 'owner.json'), 'utf8'));
    if (owner.pid === process.pid) fs.rmSync(LOCK, { recursive: true, force: true });
  } catch {}
}
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => (release(), process.exit(130)));

await acquire();
const t0 = Date.now();
fs.mkdirSync(path.join(CACHE, 'logs'), { recursive: true });
const logFile = path.join(CACHE, 'logs', `chardev-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const out = fs.openSync(logFile, 'w');
const child = spawn(BLENDER, ['--background', '--factory-startup', '--python-exit-code', '1', '--python',
  path.join(ROOT, 'blender/lib/cli.py'), '--', ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
const quiet = process.env.DEV_QUIET === '1';
const onData = (d) => {
  fs.writeSync(out, d);
  if (!quiet) process.stdout.write(d);
};
child.stdout.on('data', onData);
child.stderr.on('data', onData);
child.on('close', (code) => {
  release();
  fs.closeSync(out);
  console.log(`[dev] exit ${code} in ${((Date.now() - t0) / 1000).toFixed(1)} s  log ${path.relative(ROOT, logFile)}`);
  process.exit(code ?? 1);
});
